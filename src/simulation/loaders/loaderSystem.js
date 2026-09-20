import * as THREE from "three";
import {
  FORKLIFT_TURN_RATE,
  FORK_LIFT_SPEED,
  FORK_CARRY_LIFT,
  FORK_CLEARANCE,
  LOAD_SLOWDOWN,
  TRUCK_SPEED_MPS,
} from "../constants.js";
import { makeForkliftRobot } from "../robots/forkliftRobot.js";
import { createEnergyMeter } from "../energy.js";
import { createCargoFactory } from "./cargo.js";
import {
  AISLE_ZS,
  BAY_Z,
  DOCK_LANES,
  DOCK_SLOTS,
  MAX_LAYERS,
  HEADING_NORTH,
  bayXOf,
  createStorage,
  freeSlotIndex,
  topSlotIndex,
  laneUnitCount,
  laneFreeCapacity,
  laneCapacity,
  laneHasPickable,
  laneAnchor,
} from "./storageLayout.js";
import { routeBetween, routeLength } from "./roads.js";
import { findBlocker } from "./traffic.js";
import { createTruckBay } from "./truckBay.js";

const ARRIVE_EPS = 0.02;
const ROTATE_EPS = 0.02;
const AIM_MIN_DISTANCE = 0.4; // ближе этого к цели погрузчик уже не доворачивает — иначе на подходе рыскал бы

const UNLOAD_INTERVAL = 0.22; // с между единицами груза, выезжающими из фуры
const FLIGHT_SECONDS = 0.9; // сколько груз летит от кузова до площадки и обратно
const FLIGHT_ARC = 1.6;
const OUTBOUND_WAIT_SECONDS = 20; // сколько фура ждёт недостающий груз, прежде чем уехать неполной
const MAX_TRUCKS_WAITING = 2; // сколько фур одних ворот ждут своей очереди
const GATE_STAGGER_SECONDS = 5; // на сколько позже первая фура приезжает к каждым следующим воротам

const angleDiff = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

// ============================================================
// Погрузчики, фуры и склад — вся логика погрузки в одном месте.
//
// Склад поделён на зоны по числу ворот (storageLayout.js). У каждых ворот свои
// площадка, места хранения, фуры и закреплённые погрузчики — они ездят только в
// своей зоне и потому не пересекаются с погрузчиками других ворот. Если погрузчиков
// меньше, чем ворот, погрузчик обслуживает несколько соседних ворот подряд, и
// зоны разных погрузчиков всё равно не пересекаются. Погрузчиков не больше, чем
// ворот, поэтому в одной зоне никогда не работают двое.
//
// Каждые ворота живут по циклу:
//   загрузка   — фуры по очереди подъезжают, разом выгружают весь груз на площадку
//                и уезжают; погрузчик развозит груз по местам хранения своей зоны,
//                пока места не останется;
//   разгрузка  — погрузчик возвращает груз к тем же воротам, и фуры его увозят;
//                когда зона опустела, снова загрузка.
//
// Один рейс — одна единица груза; чем она тяжелее относительно грузоподъёмности,
// тем медленнее едет погрузчик (LOAD_SLOWDOWN).
// ============================================================

export function createLoaderSystem({
  group,
  count,
  capacityKg,
  cargoWeightKg,
  speedMps,
  metersPerUnit,
  cargoPerHour,
  truckPayload,
  slotsPerLane,
  cargo,
  routeLengthM,
  startDelay = 0,
  energyProfile,
}) {
  const { docks } = createStorage({ slotsPerLane });
  const cargoFactory = createCargoFactory(cargo);
  const layerLift = (layer) => layer * cargoFactory.unitHeight;
  const targetRouteUnits = routeLengthM / metersPerUnit; // куда стремятся развозить груз

  const baseSpeed = speedMps / metersPerUnit; // ед. сцены/с
  const truckSpeed = Math.min(30, Math.max(3, TRUCK_SPEED_MPS / metersPerUnit));
  const loadRatio = Math.min(1, cargoWeightKg / capacityKg);

  const dockCapacity = DOCK_LANES * DOCK_SLOTS * MAX_LAYERS;
  const payload = Math.max(1, Math.min(dockCapacity, Math.round(truckPayload)));

  // Входящий поток делится между воротами поровну.
  const arrivalInterval = cargoPerHour > 0 ? (payload * 3600 * docks.length) / cargoPerHour : Infinity;

  const gates = docks.map((dock) => ({
    dock,
    index: dock.index,
    storageLanes: dock.storageLanes,
    roadXs: [dock.x],
    bay: createTruckBay({ group, gateX: dock.x, gateIndex: dock.index, speed: truckSpeed }),
    mode: "loading", // 'loading' | 'unloading'
    cycles: 0,
    startTimer: startDelay + dock.index * GATE_STAGGER_SECONDS, // до приезда первой фуры
    trucksWaiting: 0,
    arrivalTimer: 0,
    owed: 0, // сколько единиц ворот лежит на хранении
    transfer: null, // перегрузка у ворот: { kind, ... }
    loaders: [],
  }));

  const flights = []; // единицы, летящие между кузовом и площадкой
  const loaders = Array.from({ length: Math.min(count, gates.length) }, (_, index) => createLoader(index));

  let time = 0;
  let receivedUnits = 0;
  let shippedUnits = 0;
  let movedUnits = 0;
  let routeUnitsTotal = 0; // суммарная длина маршрутов (ед. сцены) перевезённых единиц
  let trucksIn = 0;
  let trucksOut = 0;

  addYard(group);

  // ----------------------------------------------------------
  // Создание
  // ----------------------------------------------------------

  // Ворота делятся между погрузчиками подряд (например, 5 ворот и 2 погрузчика:
  // {0,1,2} и {3,4}), чтобы зоны разных погрузчиков не пересекались.
  function gatesOfLoader(index, loaderCount) {
    return gates.filter((gate) => Math.floor((gate.index * loaderCount) / gates.length) === index);
  }

  function createLoader(index) {
    const myGates = gatesOfLoader(index, Math.min(count, gates.length));
    const bayX = bayXOf(myGates[0].index);
    const robot = makeForkliftRobot();
    robot.setCargoDepth(cargoFactory.depth);

    robot.group.position.set(bayX, 0.02, BAY_Z);
    robot.group.rotation.y = HEADING_NORTH;
    group.add(robot.group);

    const loader = {
      id: index,
      robot,
      meter: createEnergyMeter(energyProfile),
      gates: myGates,
      roadXs: myGates.map((gate) => gate.dock.x),
      bayX,
      atBay: true,
      anchor: { ai: 0, x: bayX },
      x: bayX,
      z: BAY_Z,
      heading: HEADING_NORTH,
      forkLift: 0,
      forkTarget: 0,
      carried: null,
      steps: [],
      gateCursor: 0,
    };

    for (const gate of myGates) gate.loaders.push(loader);

    return loader;
  }

  // Асфальтовая площадка за воротами, по которой ездят фуры.
  function addYard(target) {
    const yard = new THREE.Mesh(
      new THREE.BoxGeometry(112, 1, 66),
      new THREE.MeshStandardMaterial({ color: 0x3b3e5a, flatShading: true, roughness: 0.95 })
    );
    yard.position.set(0, -0.53, -50 - 33);
    yard.receiveShadow = true;
    target.add(yard);
  }

  // ----------------------------------------------------------
  // Груз в полёте (из кузова на площадку и обратно)
  // ----------------------------------------------------------

  function launch(unit, from, to, onLand) {
    flights.push({ unit, from, to, t: 0, onLand });
  }

  function updateFlights(dt) {
    for (let i = flights.length - 1; i >= 0; i--) {
      const flight = flights[i];
      flight.t = Math.min(1, flight.t + dt / FLIGHT_SECONDS);

      const { t, from, to } = flight;
      flight.unit.position.set(
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t + FLIGHT_ARC * 4 * t * (1 - t),
        from.z + (to.z - from.z) * t
      );

      if (t >= 1) {
        flights.splice(i, 1);
        flight.onLand();
      }
    }
  }

  // ----------------------------------------------------------
  // Остатки на площадке и в хранении одних ворот
  // ----------------------------------------------------------

  const dockUnits = (gate) => gate.dock.lanes.reduce((sum, lane) => sum + laneUnitCount(lane), 0);
  const dockFreeCapacity = (gate) => gate.dock.lanes.reduce((sum, lane) => sum + laneFreeCapacity(lane), 0);
  const storageFreeCapacity = (gate) => gate.storageLanes.reduce((sum, lane) => sum + laneFreeCapacity(lane), 0);
  const storageUnits = (gate) => gate.storageLanes.reduce((sum, lane) => sum + laneUnitCount(lane), 0);

  // ----------------------------------------------------------
  // Фуры у ворот
  // ----------------------------------------------------------

  // Пора ли отправлять за грузом фуру: набралась полная фура или больше груза
  // этих ворот на хранении не осталось.
  function outboundReady(gate) {
    const units = dockUnits(gate);
    return units > 0 && (units >= payload || gate.owed === 0);
  }

  function updateDispatch(gate, dt) {
    if (gate.startTimer > 0) {
      gate.startTimer -= dt;
      if (gate.startTimer <= 0) gate.trucksWaiting = 1;
    }

    if (gate.mode === "loading" && gate.startTimer <= 0) {
      gate.arrivalTimer += dt;

      if (gate.arrivalTimer >= arrivalInterval) {
        gate.arrivalTimer -= arrivalInterval;
        gate.trucksWaiting = Math.min(MAX_TRUCKS_WAITING, gate.trucksWaiting + 1);
      }
    }

    if (gate.bay.busy) return;

    if (gate.mode === "loading" && gate.trucksWaiting > 0 && storageFreeCapacity(gate) > 0 && dockFreeCapacity(gate) >= payload) {
      gate.bay.begin("inbound");
      gate.trucksWaiting--;
    } else if (gate.mode === "unloading" && outboundReady(gate)) {
      gate.bay.begin("outbound");
    }
  }

  // Полоса площадки, куда можно выгрузить очередную единицу: свободная, не занятая
  // погрузчиком, с наибольшим запасом места — так груз ложится по всем полосам поровну.
  function dockLaneForIncoming(gate) {
    let best = null;

    for (const lane of gate.dock.lanes) {
      if ((lane.claimedBy && lane.claimedBy !== gate.bay) || laneFreeCapacity(lane) === 0) continue;
      if (!best || laneFreeCapacity(lane) > laneFreeCapacity(best)) best = lane;
    }

    return best;
  }

  function startTransfer(gate) {
    gate.transfer = { kind: gate.bay.kind, remaining: payload, timer: 0, inFlight: 0, taken: 0, waited: 0, claimed: new Set() };
  }

  function finishTransfer(gate) {
    const { transfer } = gate;

    for (const lane of transfer.claimed) {
      if (lane.claimedBy === gate.bay) lane.claimedBy = null;
    }

    if (transfer.kind === "inbound") trucksIn++;
    else trucksOut++;

    gate.transfer = null;
    gate.bay.depart();
  }

  function stepInbound(gate, dt) {
    const { transfer, bay } = gate;

    transfer.timer -= dt;

    while (transfer.timer <= 0 && transfer.remaining > 0) {
      const lane = dockLaneForIncoming(gate);
      if (!lane) break; // все полосы заняты погрузчиком — ждём

      lane.claimedBy = bay;
      transfer.claimed.add(lane);

      const slot = lane.slots[freeSlotIndex(lane)];
      const layer = slot.units.length + slot.reserved;
      slot.reserved++;

      const unit = cargoFactory.create();
      unit.userData.origin = gate.index;
      group.add(unit);

      const door = bay.doorway();
      transfer.inFlight++;
      transfer.remaining--;
      transfer.timer += UNLOAD_INTERVAL;
      receivedUnits++;

      launch(unit, { x: door.x, y: door.y, z: door.z }, { x: lane.x, y: layerLift(layer), z: slot.z }, () => {
        slot.reserved--;
        slot.units.push(unit);
        transfer.inFlight--;
      });
    }

    if (transfer.remaining === 0 && transfer.inFlight === 0) finishTransfer(gate);
  }

  const takeableDockLanes = (gate) => gate.dock.lanes.filter((l) => (!l.claimedBy || l.claimedBy === gate.bay) && laneHasPickable(l));

  function stepOutbound(gate, dt) {
    const { transfer, bay } = gate;

    transfer.timer -= dt;

    while (transfer.timer <= 0 && transfer.taken < payload) {
      const lane = takeableDockLanes(gate).sort((a, b) => laneUnitCount(b) - laneUnitCount(a))[0];
      if (!lane) break;

      lane.claimedBy = bay;
      transfer.claimed.add(lane);

      const slot = lane.slots[topSlotIndex(lane)];
      const layer = slot.units.length - 1;
      const unit = slot.units.pop();
      const door = bay.doorway();

      transfer.inFlight++;
      transfer.taken++;
      transfer.waited = 0;
      transfer.timer += UNLOAD_INTERVAL;

      launch(unit, { x: lane.x, y: layerLift(layer), z: slot.z }, { x: door.x, y: door.y, z: door.z }, () => {
        group.remove(unit);
        shippedUnits++;
        transfer.inFlight--;
      });
    }

    if (transfer.inFlight > 0) return;

    // Фура уезжает полной. Если груза пока не хватает (его ещё несёт погрузчик),
    // она ждёт, но не дольше OUTBOUND_WAIT_SECONDS, а когда везти больше нечего —
    // уезжает сразу.
    const full = transfer.taken >= payload;
    const canTakeMore = takeableDockLanes(gate).length > 0;
    const loaderBusy = gate.dock.lanes.some((l) => l.claimedBy && l.claimedBy !== bay);

    if (full || (gate.owed === 0 && !loaderBusy && !canTakeMore)) {
      finishTransfer(gate);
      return;
    }

    if (!canTakeMore) {
      transfer.waited += dt;
      if (transfer.waited > OUTBOUND_WAIT_SECONDS) finishTransfer(gate);
    }
  }

  function updateBay(gate, dt) {
    gate.bay.update(dt);

    if (gate.bay.docked && !gate.transfer) startTransfer(gate);
    if (!gate.transfer) return;

    if (gate.transfer.kind === "inbound") stepInbound(gate, dt);
    else stepOutbound(gate, dt);
  }

  // ----------------------------------------------------------
  // Фазы ворот
  // ----------------------------------------------------------

  const carriedFor = (gate) => gate.loaders.some((loader) => loader.carried?.userData.origin === gate.index);

  function updateMode(gate) {
    if (gate.mode === "loading" && storageFreeCapacity(gate) === 0 && gate.bay.kind !== "inbound") {
      gate.mode = "unloading";
      gate.trucksWaiting = 0;
      gate.arrivalTimer = 0;
      return;
    }

    const nothingLeft = storageUnits(gate) === 0 && !carriedFor(gate) && dockUnits(gate) === 0 && !gate.bay.busy;

    if (gate.mode === "unloading" && nothingLeft) {
      gate.mode = "loading";
      gate.cycles++;
      gate.trucksWaiting = 1;
    }
  }

  // ----------------------------------------------------------
  // Задания погрузчикам: цепочки шагов
  // ----------------------------------------------------------

  const drive = (x, z, reverse = false) => ({ kind: "drive", x, z, reverse });
  const face = (heading) => ({ kind: "face", heading });
  const fork = (lift) => ({ kind: "fork", lift });
  const waitFork = () => ({ kind: "waitFork" });
  const act = (run) => ({ kind: "act", run });

  const routeSteps = (loader, from, to) => routeBetween(from, to, loader.roadXs).map((p) => drive(p.x, p.z));

  const goTo = (anchor) =>
    act((loader) => {
      loader.anchor = anchor;
    });

  // Со стоянки погрузчик сначала выезжает задом на ось проезда H0 — разворачиваться
  // прямо на стоянке нельзя, рядом стоит груз площадки.
  function leaveBaySteps(loader) {
    if (!loader.atBay) return [];

    return [
      act(() => {
        loader.atBay = false;
      }),
      drive(loader.bayX, AISLE_ZS[0], true),
    ];
  }

  // Заезд в полосу, подбор единицы и выезд обратно на проезд.
  function pickSteps(loader, lane, slot, layer) {
    const carryZ = loader.robot.carry.position.z;

    return [
      fork(layerLift(layer)),
      face(lane.heading),
      waitFork(),
      drive(lane.x, slot.z - lane.dir * carryZ),
      act(() => takeUnit(loader, slot.units.pop())),
      fork(layerLift(layer) + FORK_CLEARANCE),
      drive(lane.x, lane.aisleZ, true),
      act(() => {
        lane.claimedBy = null;
      }),
      fork(FORK_CARRY_LIFT),
    ];
  }

  // Заезд в полосу, установка единицы и выезд обратно.
  function putSteps(loader, lane, slot, layer, onPut) {
    const carryZ = loader.robot.carry.position.z;

    return [
      fork(layerLift(layer) + FORK_CLEARANCE),
      face(lane.heading),
      waitFork(),
      drive(lane.x, slot.z - lane.dir * carryZ),
      fork(layerLift(layer)),
      waitFork(),
      act(() => {
        const unit = placeUnit(loader, lane.x, layer, slot.z);
        slot.reserved--;
        slot.units.push(unit);
        onPut(unit);
      }),
      drive(lane.x, lane.aisleZ, true),
      act(() => {
        lane.claimedBy = null;
      }),
      fork(FORK_CLEARANCE),
    ];
  }

  // Общая цепочка: взять единицу с полосы from, довезти до полосы to и поставить.
  function buildTransferJob(loader, from, to, onPut) {
    const fromSlot = from.slots[topSlotIndex(from)];
    const fromLayer = fromSlot.units.length - 1;

    const toSlot = to.slots[freeSlotIndex(to)];
    const toLayer = toSlot.units.length + toSlot.reserved;

    from.claimedBy = loader;
    to.claimedBy = loader;
    toSlot.reserved++;

    return [
      ...leaveBaySteps(loader),
      ...routeSteps(loader, loader.anchor, laneAnchor(from)),
      goTo(laneAnchor(from)),
      ...pickSteps(loader, from, fromSlot, fromLayer),
      ...routeSteps(loader, laneAnchor(from), laneAnchor(to)),
      goTo(laneAnchor(to)),
      ...putSteps(loader, to, toSlot, toLayer, onPut),
      act(() => {
        movedUnits++;
        routeUnitsTotal += routeLength(laneAnchor(from), laneAnchor(to), loader.roadXs);
      }),
    ];
  }

  // Полоса площадки, откуда взять груз в хранение: самая полная.
  function pickDockLaneToStore(gate) {
    return gate.dock.lanes
      .filter((lane) => !lane.claimedBy && laneHasPickable(lane))
      .sort((a, b) => laneUnitCount(b) - laneUnitCount(a))[0];
  }

  // Свободная полоса хранения зоны, маршрут до которой ближе всего к заданной
  // средней протяжённости (routeLengthM).
  function pickStorageLane(gate, from) {
    let best = null;
    let bestScore = Infinity;

    for (const lane of gate.storageLanes) {
      if (lane.claimedBy || laneFreeCapacity(lane) === 0) continue;

      const score = Math.abs(routeLength(laneAnchor(from), laneAnchor(lane), [gate.dock.x]) - targetRouteUnits);

      if (score < bestScore) {
        bestScore = score;
        best = lane;
      }
    }

    return best;
  }

  // Что вернуть на площадку: единица на верху ближайшей полосы хранения зоны.
  function pickRetrieve(loader, gate) {
    const target = gate.dock.lanes
      .filter((lane) => !lane.claimedBy && laneFreeCapacity(lane) > 0)
      .sort((a, b) => laneFreeCapacity(b) - laneFreeCapacity(a))[0];

    if (!target) return null;

    let best = null;
    let bestDistance = Infinity;

    for (const lane of gate.storageLanes) {
      if (lane.claimedBy || !laneHasPickable(lane)) continue;

      const distance = routeLength(loader.anchor, laneAnchor(lane), loader.roadXs);

      if (distance < bestDistance) {
        bestDistance = distance;
        best = lane;
      }
    }

    return best && { from: best, to: target };
  }

  function buildParkSteps(loader) {
    const bayAnchor = { ai: 0, x: loader.bayX };

    return [
      ...routeSteps(loader, loader.anchor, bayAnchor),
      goTo(bayAnchor),
      drive(loader.bayX, BAY_Z),
      face(HEADING_NORTH),
      act(() => {
        loader.atBay = true;
      }),
    ];
  }

  // Ищет работу в своих воротах (по кругу, чтобы обслуживать их поровну); без
  // работы едет на стоянку.
  function assignJob(loader) {
    for (let k = 0; k < loader.gates.length; k++) {
      const gate = loader.gates[(loader.gateCursor + k) % loader.gates.length];

      if (gate.mode === "loading") {
        const from = pickDockLaneToStore(gate);
        const to = from && storageFreeCapacity(gate) > 0 ? pickStorageLane(gate, from) : null;

        if (from && to) {
          const origin = from.slots[topSlotIndex(from)].units.at(-1).userData.origin;

          loader.steps = buildTransferJob(loader, from, to, () => {
            gates[origin].owed++;
          });
          loader.gateCursor = (loader.gateCursor + k + 1) % loader.gates.length;
          return;
        }
      } else {
        const job = pickRetrieve(loader, gate);

        if (job) {
          loader.steps = buildTransferJob(loader, job.from, job.to, () => {
            gate.owed--;
          });
          loader.gateCursor = (loader.gateCursor + k + 1) % loader.gates.length;
          return;
        }
      }
    }

    if (!loader.atBay) loader.steps = buildParkSteps(loader);
  }

  // ----------------------------------------------------------
  // Движение и движение вил
  // ----------------------------------------------------------

  // С грузом едем медленнее: чем тяжелее относительно грузоподъёмности, тем сильнее.
  const currentSpeed = (loader) => baseSpeed * (1 - LOAD_SLOWDOWN * (loader.carried ? loadRatio : 0));

  function tryMove(loader, next) {
    if (findBlocker(loader, next, loaders)) return false;

    loader.x = next.x;
    loader.z = next.z;
    loader.heading = next.heading;

    return true;
  }

  // Разворот на месте; true — уже смотрит куда нужно.
  function turnTo(loader, heading, dt) {
    const diff = angleDiff(loader.heading, heading);
    if (Math.abs(diff) <= ROTATE_EPS) return true;

    const maxTurn = FORKLIFT_TURN_RATE * dt;
    const turned = loader.heading + (Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn);

    tryMove(loader, { x: loader.x, z: loader.z, heading: turned });

    return Math.abs(angleDiff(loader.heading, heading)) <= ROTATE_EPS;
  }

  // Едет к точке; вперёд — с поворотом на месте в нужную сторону, назад
  // (reverse) — сохраняя курс. true, когда приехал.
  function driveTo(loader, step, dt) {
    const dx = step.x - loader.x;
    const dz = step.z - loader.z;
    const distance = Math.hypot(dx, dz);

    if (distance < ARRIVE_EPS) return true;
    if (!step.reverse && distance > AIM_MIN_DISTANCE && !turnTo(loader, Math.atan2(dx, dz), dt)) return false;

    const travel = Math.min(distance, currentSpeed(loader) * dt);
    const moved = tryMove(loader, {
      x: loader.x + (dx / distance) * travel,
      z: loader.z + (dz / distance) * travel,
      heading: loader.heading,
    });

    return moved && travel >= distance;
  }

  function moveFork(loader, dt) {
    const diff = loader.forkTarget - loader.forkLift;
    const stepSize = FORK_LIFT_SPEED * dt;

    loader.forkLift += Math.abs(diff) <= stepSize ? diff : Math.sign(diff) * stepSize;
    loader.robot.setForkLift(loader.forkLift);
  }

  // ----------------------------------------------------------
  // Действия с грузом
  // ----------------------------------------------------------

  // Единица переезжает на вилы: стоит там же, где стояла, поэтому «прыжка» нет.
  function takeUnit(loader, unit) {
    loader.carried = unit;
    loader.robot.carry.add(unit);
    unit.position.set(0, 0, 0);
  }

  function placeUnit(loader, x, layer, z) {
    const unit = loader.carried;

    loader.robot.carry.remove(unit);
    unit.position.set(x, layerLift(layer), z);
    group.add(unit);
    loader.carried = null;

    return unit;
  }

  // Выполняет текущий шаг задания; true — шаг завершён.
  function runStep(loader, step, dt) {
    switch (step.kind) {
      case "drive":
        return driveTo(loader, step, dt);

      case "face":
        return turnTo(loader, step.heading, dt);

      case "fork":
        loader.forkTarget = step.lift;
        return true;

      case "waitFork":
        return Math.abs(loader.forkTarget - loader.forkLift) < 1e-3;

      case "act":
        step.run(loader);
        return true;

      default:
        return true;
    }
  }

  function updateLoader(loader, dt) {
    if (loader.steps.length === 0) assignJob(loader);

    const working = loader.steps.length > 0;
    loader.meter.consume(dt, working ? "work" : "idle", loader.carried ? loadRatio : 0);

    if (working && runStep(loader, loader.steps[0], dt)) loader.steps.shift();

    moveFork(loader, dt);

    loader.robot.group.position.set(loader.x, 0.02, loader.z);
    loader.robot.group.rotation.y = loader.heading;
  }

  // ----------------------------------------------------------
  // Публичный интерфейс
  // ----------------------------------------------------------

  function step(dt) {
    time += dt;

    for (const gate of gates) {
      updateDispatch(gate, dt);
      updateBay(gate, dt);
      updateMode(gate);
    }

    updateFlights(dt);
    loaders.forEach((loader) => updateLoader(loader, dt));
  }

  const sum = (fn) => gates.reduce((total, gate) => total + fn(gate), 0);

  function getStats() {
    const stored = sum(storageUnits);
    const capacity = sum((gate) => gate.storageLanes.reduce((total, lane) => total + laneCapacity(lane), 0));
    const modes = new Set(gates.map((gate) => gate.mode));

    return {
      phase: modes.size > 1 ? "mixed" : [...modes][0],
      cycles: Math.min(...gates.map((gate) => gate.cycles)),
      storedKg: Math.round(stored * cargoWeightKg),
      fillPercent: Math.round((stored / capacity) * 100),
      dockUnits: sum(dockUnits),
      trucksAtGates: gates.filter((gate) => gate.bay.busy).length,
      trucksWaiting: sum((gate) => gate.trucksWaiting),
      trucksIn,
      trucksOut,
      receivedKg: Math.round(receivedUnits * cargoWeightKg),
      shippedKg: Math.round(shippedUnits * cargoWeightKg),
      // Фактические потоки за время работы: перевезено погрузчиками, принято и
      // отгружено (единиц в час), и средняя длина маршрута груза, м.
      movedPerHour: time > 60 ? Math.round((movedUnits * 3600) / time) : 0,
      receivedPerHour: time > 60 ? Math.round((receivedUnits * 3600) / time) : 0,
      shippedPerHour: time > 60 ? Math.round((shippedUnits * 3600) / time) : 0,
      avgRouteM: movedUnits > 0 ? Math.round((routeUnitsTotal / movedUnits) * metersPerUnit) : 0,
      // Занятость погрузчиков: сколько сейчас на задании.
      busyLoaders: loaders.filter((loader) => !loader.atBay && loader.steps.length > 0).length,
    };
  }

  return {
    step,
    getStats,
    meters: loaders.map((loader) => loader.meter),
    payload,
    storageCapacityUnits: sum((gate) => gate.storageLanes.reduce((total, lane) => total + laneCapacity(lane), 0)),
  };
}
