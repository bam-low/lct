import {
  CARGO_WEIGHT_KG,
  FORKLIFT_SPEED_MPS,
  FORKLIFT_TURN_RATE,
  FORK_LIFT_SPEED,
  FORK_CARRY_LIFT,
  FORK_CLEARANCE,
  LOAD_SLOWDOWN,
} from "../constants.js";
import { makeForkliftRobot } from "../robots/forkliftRobot.js";
import { createEnergyMeter } from "../energy.js";
import { createCargoUnit, CARGO_UNIT_HEIGHT } from "./cargo.js";
import {
  CORRIDOR_Z,
  PAD_Z,
  MAX_LAYERS,
  createGates,
  findFreeCell,
  findTopCell,
  countStoredUnits,
  storageCapacityUnits,
} from "./loaderLayout.js";

// Курс = rotation.y; вперёд (вилы) смотрят в (sin курс, cos курс).
const HEADING_NORTH = Math.PI; // к воротам (-z)
const HEADING_SOUTH = 0; // вглубь полос хранения (+z)

const UNIT_FALL_SPEED = 14; // ед./с — груз «спрыгивает» с борта грузовика на площадку
const SHIP_DELAY_SECONDS = 4; // сколько разгруженный груз лежит у ворот, пока его не заберёт грузовик
const ARRIVE_EPS = 0.02;

const angleDiff = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

// ============================================================
// Погрузчики, груз, ворота и хранение — вся логика погрузки в одном месте.
//
// У каждых ворот своё хранилище, и оно живёт по циклу:
//   загрузка   — груз приходит к воротам, погрузчик уносит его в ячейку
//                (до двух единиц друг на друге);
//   разгрузка  — когда все ячейки заполнены, погрузчик возвращает груз к тем же
//                воротам, откуда он был взят, и его забирают грузовики;
//   когда хранилище опустело — снова загрузка.
//
// Рейс погрузчика: приехал к ворот (или ячейке) → подвёл вилы на нужную высоту →
// подцепил единицу → отъехал → доехал по проезду → поставил → сдал назад.
// Груз тяжелит погрузчик: чем больше масса относительно грузоподъёмности, тем
// медленнее он едет (LOAD_SLOWDOWN).
// ============================================================

export function createLoaderSystem({ group, count, capacityKg, metersPerUnit, cargoPerHour, energyProfile }) {
  const gates = createGates();
  const baseSpeed = FORKLIFT_SPEED_MPS / metersPerUnit; // ед. сцены/с
  const arrivalInterval = cargoPerHour > 0 ? 3600 / cargoPerHour : Infinity;

  const falling = []; // единицы, которые ещё опускаются на площадку
  let arrivalTimer = 0;
  let nextGate = 0;
  let shippedUnits = 0;

  const loaders = Array.from({ length: count }, (_, index) => createLoader(index));

  // ----------------------------------------------------------
  // Создание
  // ----------------------------------------------------------

  // Ворота делятся между погрузчиками подряд (0,1 | 2), чтобы зоны разных
  // погрузчиков не пересекались и им не нужно было уступать друг другу.
  function gatesOfLoader(index) {
    return gates.filter((gate) => Math.floor((gate.index * count) / gates.length) === index);
  }

  function createLoader(index) {
    const robot = makeForkliftRobot();
    const myGates = gatesOfLoader(index);
    const home = myGates[0] ?? gates[0];

    robot.group.position.set(home.x, 0.02, CORRIDOR_Z);
    robot.group.rotation.y = HEADING_NORTH;
    group.add(robot.group);

    return {
      robot,
      // Батарею не моделируем (зарядку погрузчиков добавим позже), но энергию считаем.
      meter: createEnergyMeter(energyProfile),
      gates: myGates,
      x: home.x,
      z: CORRIDOR_Z,
      heading: HEADING_NORTH,
      forkLift: 0,
      forkTarget: 0,
      carried: null, // единица груза на вилах
      steps: [],
    };
  }

  // ----------------------------------------------------------
  // Поступление и отгрузка груза (позже здесь будут приезжать грузовики)
  // ----------------------------------------------------------

  const padIsFree = (gate) => !gate.pad.claimedBy && gate.pad.units.length + gate.pad.reserved < MAX_LAYERS;

  function tryDeliverCargo() {
    for (let k = 0; k < gates.length; k++) {
      const gate = gates[(nextGate + k) % gates.length];

      if (gate.mode !== "loading" || !padIsFree(gate) || !findFreeCell(gate)) continue;

      const layer = gate.pad.units.length;
      const unit = createCargoUnit();
      unit.position.set(gate.x, layer * CARGO_UNIT_HEIGHT + 6, PAD_Z);
      group.add(unit);

      gate.pad.units.push(unit);
      falling.push({ unit, targetY: layer * CARGO_UNIT_HEIGHT });

      nextGate = (gate.index + 1) % gates.length;
      return true;
    }

    return false;
  }

  function updateArrivals(dt) {
    arrivalTimer = Math.min(arrivalTimer + dt, arrivalInterval);

    if (arrivalTimer >= arrivalInterval && tryDeliverCargo()) {
      arrivalTimer = 0;
    }

    for (let i = falling.length - 1; i >= 0; i--) {
      const item = falling[i];
      item.unit.position.y = Math.max(item.targetY, item.unit.position.y - UNIT_FALL_SPEED * dt);

      if (item.unit.position.y <= item.targetY) falling.splice(i, 1);
    }
  }

  // Разгруженный груз лежит на площадке, пока его не заберёт грузовик, —
  // забирают сверху вниз.
  function updateShipping(gate, dt) {
    const { units } = gate.pad;
    const top = units[units.length - 1];

    if (gate.mode !== "unloading" || !top || gate.pad.claimedBy) return;

    top.userData.shipTimer = (top.userData.shipTimer ?? SHIP_DELAY_SECONDS) - dt;

    if (top.userData.shipTimer <= 0) {
      group.remove(top);
      units.pop();
      shippedUnits++;
    }
  }

  // Смена фаз хранилища: заполнено → разгрузка, опустело → загрузка. Остаток
  // груза на площадке при переходе к разгрузке просто уезжает с грузовиком.
  function updateMode(gate) {
    if (gate.busy || gate.pad.reserved > 0) return;

    if (gate.mode === "loading" && !findFreeCell(gate)) {
      gate.mode = "unloading";
    } else if (gate.mode === "unloading" && countStoredUnits(gate) === 0 && gate.pad.units.length === 0) {
      gate.mode = "loading";
      gate.cycles++;
    }
  }

  // ----------------------------------------------------------
  // Задания: цепочки шагов
  // ----------------------------------------------------------

  const drive = (x, z, reverse = false) => ({ kind: "drive", x, z, reverse });
  const face = (heading) => ({ kind: "face", heading });
  const fork = (lift) => ({ kind: "fork", lift });
  const layerLift = (layer) => layer * CARGO_UNIT_HEIGHT;

  // Груз с площадки ворот → в ячейку (верхняя единица площадки → следующий слой ячейки).
  function buildLoadJob(loader, gate, cell) {
    const carryZ = loader.robot.carry.position.z;
    const padLayer = gate.pad.units.length - 1;
    const { lane, slot, layer } = cell;

    return [
      drive(gate.x, CORRIDOR_Z),
      face(HEADING_NORTH),
      fork(layerLift(padLayer)),
      drive(gate.x, PAD_Z + carryZ),
      { kind: "pickFromPad", gate },
      fork(layerLift(padLayer) + FORK_CLEARANCE),
      drive(gate.x, CORRIDOR_Z, true),
      { kind: "releasePad", gate },
      fork(FORK_CARRY_LIFT),
      drive(lane.x, CORRIDOR_Z),
      face(HEADING_SOUTH),
      fork(layerLift(layer) + FORK_CLEARANCE),
      drive(lane.x, slot.z - carryZ),
      fork(layerLift(layer)),
      { kind: "putInCell", lane, slot, layer },
      drive(lane.x, CORRIDOR_Z, true),
      { kind: "finish", gate },
    ];
  }

  // Груз из ячейки → на площадку тех же ворот (верхняя единица ячейки → следующий слой площадки).
  function buildUnloadJob(loader, gate, cell, padLayer) {
    const carryZ = loader.robot.carry.position.z;
    const { lane, slot, layer } = cell;

    return [
      drive(lane.x, CORRIDOR_Z),
      face(HEADING_SOUTH),
      fork(layerLift(layer)),
      drive(lane.x, slot.z - carryZ),
      { kind: "pickFromCell", slot },
      fork(layerLift(layer) + FORK_CLEARANCE),
      drive(lane.x, CORRIDOR_Z, true),
      fork(FORK_CARRY_LIFT),
      drive(gate.x, CORRIDOR_Z),
      face(HEADING_NORTH),
      fork(layerLift(padLayer) + FORK_CLEARANCE),
      drive(gate.x, PAD_Z + carryZ),
      fork(layerLift(padLayer)),
      { kind: "putOnPad", gate },
      drive(gate.x, CORRIDOR_Z, true),
      { kind: "releasePad", gate },
      { kind: "finish", gate },
    ];
  }

  // Ищет погрузчику работу среди его ворот: сначала загрузка (груз ждёт у
  // ворот), потом разгрузка.
  function assignJob(loader) {
    const free = loader.gates.filter((gate) => !gate.busy && !gate.pad.claimedBy);

    const toLoad = free.find((gate) => gate.mode === "loading" && gate.pad.units.length > 0 && findFreeCell(gate));

    if (toLoad) {
      const cell = findFreeCell(toLoad);

      toLoad.busy = true;
      toLoad.pad.claimedBy = loader;
      cell.slot.busy = true;
      loader.steps = buildLoadJob(loader, toLoad, cell);
      return;
    }

    const toUnload = free.find((gate) => gate.mode === "unloading" && padIsFree(gate) && findTopCell(gate));

    if (toUnload) {
      const cell = findTopCell(toUnload);
      const padLayer = toUnload.pad.units.length + toUnload.pad.reserved;

      toUnload.busy = true;
      toUnload.pad.claimedBy = loader; // пока не поставим, груз на площадке не забирают
      toUnload.pad.reserved++;
      cell.slot.busy = true;
      loader.steps = buildUnloadJob(loader, toUnload, cell, padLayer);
    }
  }

  // ----------------------------------------------------------
  // Движение
  // ----------------------------------------------------------

  // С грузом едем медленнее: чем тяжелее относительно грузоподъёмности, тем сильнее.
  const currentSpeed = (loader) =>
    baseSpeed * (1 - LOAD_SLOWDOWN * Math.min(1, (loader.carried ? CARGO_WEIGHT_KG : 0) / capacityKg));

  function turnTo(loader, heading, dt) {
    const diff = angleDiff(loader.heading, heading);
    const maxTurn = FORKLIFT_TURN_RATE * dt;

    loader.heading += Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn;

    return Math.abs(diff) <= maxTurn;
  }

  // Едет к точке; вперёд — с поворотом на месте в нужную сторону, назад
  // (reverse) — сохраняя курс. true, когда приехал.
  function driveTo(loader, step, dt) {
    const dx = step.x - loader.x;
    const dz = step.z - loader.z;
    const distance = Math.hypot(dx, dz);

    if (distance < ARRIVE_EPS) return true;

    if (!step.reverse && !turnTo(loader, Math.atan2(dx, dz), dt)) return false;

    const travel = Math.min(distance, currentSpeed(loader) * dt);
    loader.x += (dx / distance) * travel;
    loader.z += (dz / distance) * travel;

    return travel >= distance;
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

  // Единица переезжает на вилы: стоит там же, где стояла, поэтому «прыжка» нет,
  // а дальше она едет вместе с вилами.
  function takeUnit(loader, unit) {
    loader.carried = unit;
    loader.robot.carry.add(unit);
    unit.position.set(0, 0, 0);
    unit.userData.shipTimer = undefined;

    const fallingIndex = falling.findIndex((item) => item.unit === unit);
    if (fallingIndex >= 0) falling.splice(fallingIndex, 1);
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
        return Math.abs(loader.forkTarget - loader.forkLift) < 1e-3;

      case "pickFromPad":
        takeUnit(loader, step.gate.pad.units.pop());
        return true;

      // Площадка свободна для нового груза только когда погрузчик от неё отъехал.
      case "releasePad":
        step.gate.pad.claimedBy = null;
        return true;

      case "putInCell":
        step.slot.units.push(placeUnit(loader, step.lane.x, step.layer, step.slot.z));
        step.slot.busy = false;
        return true;

      case "pickFromCell":
        takeUnit(loader, step.slot.units.pop());
        step.slot.busy = false;
        return true;

      case "putOnPad": {
        const layer = step.gate.pad.units.length;
        step.gate.pad.units.push(placeUnit(loader, step.gate.x, layer, PAD_Z));
        step.gate.pad.reserved--;
        return true;
      }

      case "finish":
        step.gate.busy = false;
        return true;

      default:
        return true;
    }
  }

  function updateLoader(loader, dt) {
    if (loader.steps.length === 0) assignJob(loader);

    const working = loader.steps.length > 0;
    loader.meter.consume(dt, working ? "work" : "idle");

    if (working && runStep(loader, loader.steps[0], dt)) {
      loader.steps.shift();
    }

    moveFork(loader, dt);

    loader.robot.group.position.set(loader.x, 0.02, loader.z);
    loader.robot.group.rotation.y = loader.heading;
  }

  // ----------------------------------------------------------
  // Публичный интерфейс
  // ----------------------------------------------------------

  function step(dt) {
    updateArrivals(dt);

    for (const gate of gates) {
      updateShipping(gate, dt);
      updateMode(gate);
    }

    loaders.forEach((loader) => updateLoader(loader, dt));
  }

  function getStats() {
    const storedUnits = gates.reduce((sum, gate) => sum + countStoredUnits(gate), 0);
    const capacityUnits = gates.reduce((sum, gate) => sum + storageCapacityUnits(gate), 0);
    const modes = new Set(gates.map((gate) => gate.mode));

    return {
      storedKg: storedUnits * CARGO_WEIGHT_KG,
      fillPercent: capacityUnits > 0 ? Math.round((storedUnits / capacityUnits) * 100) : 0,
      waitingUnits: gates.reduce((sum, gate) => sum + gate.pad.units.length, 0),
      phase: modes.size > 1 ? "mixed" : [...modes][0],
      cycles: Math.min(...gates.map((gate) => gate.cycles)),
      shippedKg: shippedUnits * CARGO_WEIGHT_KG,
    };
  }

  return { step, getStats, meters: loaders.map((loader) => loader.meter) };
}
