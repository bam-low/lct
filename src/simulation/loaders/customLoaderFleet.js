import { computeGateClusters } from "../shape/shapeGeometry.js";
import { CELL, cellAt, cellWorldOrigin } from "../shape/shapeTypes.js";
import { createCargoFactory } from "./cargo.js";
import { createEnergyMeter } from "../energy.js";
import { disposeTree, createMaterializeFade } from "../sceneUtils.js";
import { makeForkliftRobot } from "../robots/forkliftRobot.js";
import { makeTruck } from "../robots/truckRobot.js";
import { LOAD_SLOWDOWN } from "../constants.js";

const PAUSE_SECONDS = 1.4; // пауза на погрузку/разгрузку у стеллажа и у ворот
const FORK_LIFT_HEIGHT = 1.1;
const ARRIVE_EPS = 0.15;
const TURN_RATE = 6; // рад/с

// Фуры на воротах конструктора формы склада: заезжают/уезжают по нормали к
// стене (та же сторона, что и проём) — упрощённо, без разворотов/полос,
// как и весь остальной маршрут в этом файле.
const TRUCK_DOCK_DISTANCE = 3.2;
const TRUCK_APPROACH_DISTANCE = 16;
const TRUCK_DRIVE_SECONDS = 3.5;
const TRUCK_DOCKED_SECONDS = 9;
const TRUCK_GAP_MIN_S = 3;
const TRUCK_GAP_MAX_S = 8;
const TRUCK_FADE_SECONDS = 1.2;

// Погрузчики для «своей» формы склада (конструктор): в отличие от штатного
// loaderSystem.js (проезды/полосы/LIFO-ячейки, roads.js/traffic.js), здесь
// упрощённый маршрут в 2 плеча — ворота ↔ ближайший назначенный стеллаж по
// прямой линии, без системы проездов. На зоне выгрузки (GATE_IN) поток идёт
// от ворот к стеллажу (фура привозит), на зоне загрузки (GATE_OUT) — от
// стеллажа к воротам (фура забирает); у ворот погрузчик ждёт, пока
// подъедет фура (см. stepGateTruck) — без неё передавать груз некому.
const headingZForward = (dx, dz) => Math.atan2(dx, dz);

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function collectRackCells(shape) {
  const cells = [];

  for (let gz = 0; gz < shape.gridSize; gz++) {
    for (let gx = 0; gx < shape.gridSize; gx++) {
      if (cellAt(shape, gx, gz) !== CELL.RACK) continue;

      const a = cellWorldOrigin(gx, gz);
      cells.push({ x: a.x + shape.cellSize / 2, z: a.z + shape.cellSize / 2 });
    }
  }

  return cells;
}

function nearestGateOf(point, gates) {
  let best = gates[0];
  let bestDist = Infinity;

  for (const gate of gates) {
    const d = Math.hypot(point.x - gate.worldCenter.x, point.z - gate.worldCenter.z);
    if (d < bestDist) {
      bestDist = d;
      best = gate;
    }
  }

  return best;
}

function truckPointAt(gate, distance) {
  return { x: gate.worldCenter.x + gate.normal[0] * distance, z: gate.worldCenter.z + gate.normal[1] * distance };
}

export function createCustomLoaderFleet({
  group,
  shape,
  count,
  capacityKg,
  cargoWeightKg,
  speedMps,
  metersPerUnit,
  cargo,
  energyProfile,
  robotFactory = makeForkliftRobot,
}) {
  const gates = computeGateClusters(shape);
  for (const gate of gates) {
    gate.truck = null;
    gate.truckTimer = TRUCK_GAP_MIN_S + Math.random() * (TRUCK_GAP_MAX_S - TRUCK_GAP_MIN_S);
  }

  const cargoFactory = createCargoFactory(cargo);
  const speedUnitsPerSec = speedMps / Math.max(1e-6, metersPerUnit);
  const loadSlowFactor = 1 - LOAD_SLOWDOWN * Math.min(1, cargoWeightKg / Math.max(1, capacityKg));

  const racksByGate = new Map(gates.map((gate) => [gate.id, []]));
  for (const rack of collectRackCells(shape)) {
    racksByGate.get(nearestGateOf(rack, gates).id).push(rack);
  }

  const loaderCount = Math.min(count, Math.max(1, gates.length));
  const loaders = gates.length ? Array.from({ length: loaderCount }, (_, i) => createLoader(i)) : [];

  function createLoader(index) {
    const gate = gates[index % gates.length];
    const model = robotFactory();

    model.group.position.set(gate.worldCenter.x, 0, gate.worldCenter.z);
    group.add(model.group);

    return {
      model,
      gate,
      kind: gate.kind, // 'in' — выгрузка (ворота→стеллаж), иначе — загрузка (стеллаж→ворота)
      myRacks: racksByGate.get(gate.id),
      rackIndex: 0,
      state: "idle",
      timer: 0,
      carrying: false,
      cargoUnit: null,
      meter: createEnergyMeter(energyProfile),
      pos: { x: gate.worldCenter.x, z: gate.worldCenter.z },
      heading: 0,
    };
  }

  function placeAt(loader, x, z) {
    loader.pos.x = x;
    loader.pos.z = z;
    loader.model.group.position.set(x, 0, z);
  }

  function driveToward(loader, target, dt, speed) {
    const dx = target.x - loader.pos.x;
    const dz = target.z - loader.pos.z;
    const distance = Math.hypot(dx, dz);

    if (distance < ARRIVE_EPS) {
      placeAt(loader, target.x, target.z);
      return true;
    }

    const step = speed * dt;

    if (distance <= step) {
      placeAt(loader, target.x, target.z);
      return true;
    }

    loader.pos.x += (dx / distance) * step;
    loader.pos.z += (dz / distance) * step;
    loader.heading = turnToward(loader.heading, headingZForward(dx, dz), TURN_RATE * dt);
    placeAt(loader, loader.pos.x, loader.pos.z);
    loader.model.group.rotation.y = loader.heading;

    return false;
  }

  function turnToward(heading, target, maxTurn) {
    const diff = Math.atan2(Math.sin(target - heading), Math.cos(target - heading));
    return heading + (Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn);
  }

  function attachCargo(loader) {
    loader.carrying = true;
    loader.model.setForkLift(FORK_LIFT_HEIGHT);
    loader.cargoUnit = cargoFactory.create();
    loader.cargoUnit.position.y = 0;
    loader.model.carry.add(loader.cargoUnit);
  }

  function detachCargo(loader) {
    loader.carrying = false;
    loader.model.setForkLift(0);

    if (loader.cargoUnit) {
      loader.model.carry.remove(loader.cargoUnit);
      disposeTree(loader.cargoUnit);
      loader.cargoUnit = null;
    }
  }

  let cyclesOut = 0; // забрано со стеллажа и сдано в фуру (загрузка)
  let cyclesIn = 0; // забрано из фуры и поставлено на стеллаж (выгрузка)
  let simSeconds = 0;

  function updateLoader(loader, dt) {
    if (loader.myRacks.length === 0) {
      loader.state = "idle";
      loader.meter.consume(dt, "idle");
      return;
    }

    const speed = speedUnitsPerSec * (loader.carrying ? loadSlowFactor : 1);
    const outbound = loader.kind !== "in";

    switch (loader.state) {
      case "idle":
        loader.state = outbound ? "toRack" : "toGateEmpty";
        break;

      // --- загрузка (GATE_OUT / generic): стеллаж → ворота → фура ---
      case "toRack": {
        loader.meter.consume(dt, "work");
        const target = loader.myRacks[loader.rackIndex % loader.myRacks.length];
        if (driveToward(loader, target, dt, speed)) {
          loader.state = "atRackPickup";
          loader.timer = 0;
        }
        break;
      }

      case "atRackPickup":
        loader.meter.consume(dt, "idle");
        loader.timer += dt;
        if (loader.timer >= PAUSE_SECONDS) {
          attachCargo(loader);
          loader.rackIndex++;
          loader.state = "toGateDrop";
        }
        break;

      case "toGateDrop":
        loader.meter.consume(dt, "work");
        if (driveToward(loader, loader.gate.worldCenter, dt, speed)) {
          loader.state = "atGateDrop";
          loader.timer = 0;
        }
        break;

      case "atGateDrop":
        loader.meter.consume(dt, "idle");
        if (!loader.gate.truck || loader.gate.truck.state !== "docked") break; // ждём фуру

        loader.timer += dt;
        if (loader.timer >= PAUSE_SECONDS) {
          detachCargo(loader);
          cyclesOut++;
          loader.state = "toRack";
        }
        break;

      // --- выгрузка (GATE_IN): фура → ворота → стеллаж ---
      case "toGateEmpty":
        loader.meter.consume(dt, "work");
        if (driveToward(loader, loader.gate.worldCenter, dt, speed)) {
          loader.state = "atGatePickup";
          loader.timer = 0;
        }
        break;

      case "atGatePickup":
        loader.meter.consume(dt, "idle");
        if (!loader.gate.truck || loader.gate.truck.state !== "docked") break; // ждём фуру

        loader.timer += dt;
        if (loader.timer >= PAUSE_SECONDS) {
          attachCargo(loader);
          loader.state = "toRackDrop";
        }
        break;

      case "toRackDrop": {
        loader.meter.consume(dt, "work");
        const target = loader.myRacks[loader.rackIndex % loader.myRacks.length];
        if (driveToward(loader, target, dt, speed)) {
          loader.state = "atRackDrop";
          loader.timer = 0;
        }
        break;
      }

      case "atRackDrop":
        loader.meter.consume(dt, "idle");
        loader.timer += dt;
        if (loader.timer >= PAUSE_SECONDS) {
          detachCargo(loader);
          loader.rackIndex++;
          cyclesIn++;
          loader.state = "toGateEmpty";
        }
        break;

      default:
        break;
    }
  }

  function spawnTruckFor(gate) {
    const model = makeTruck();
    const heading = headingZForward(gate.normal[0], gate.normal[1]); // кабина смотрит наружу — фура «пятится» к воротам
    const from = truckPointAt(gate, TRUCK_APPROACH_DISTANCE);
    const to = truckPointAt(gate, TRUCK_DOCK_DISTANCE);

    model.group.position.set(from.x, 0, from.z);
    model.group.rotation.y = heading;
    group.add(model.group);

    return {
      model,
      state: "arriving",
      from,
      to,
      t: 0,
      timer: 0,
      fade: createMaterializeFade(model.group, TRUCK_FADE_SECONDS),
    };
  }

  function removeTruck(gate) {
    const truck = gate.truck;
    group.remove(truck.model.group);
    truck.model.dispose();
    truck.fade.disposeMaterials();
    gate.truck = null;
    gate.truckTimer = TRUCK_GAP_MIN_S + Math.random() * (TRUCK_GAP_MAX_S - TRUCK_GAP_MIN_S);
  }

  function stepGateTruck(gate, dt) {
    if (!gate.truck) {
      gate.truckTimer -= dt;
      if (gate.truckTimer <= 0) gate.truck = spawnTruckFor(gate);
      return;
    }

    const truck = gate.truck;
    truck.fade.update(dt);

    if (truck.state === "arriving") {
      truck.t += dt;
      const p = Math.min(1, truck.t / TRUCK_DRIVE_SECONDS);
      truck.model.group.position.set(lerp(truck.from.x, truck.to.x, p), 0, lerp(truck.from.z, truck.to.z, p));

      if (p >= 1) {
        truck.state = "docked";
        truck.timer = 0;
        truck.model.setDoors(1);
      }
    } else if (truck.state === "docked") {
      truck.timer += dt;
      if (truck.timer >= TRUCK_DOCKED_SECONDS) {
        truck.state = "leaving";
        truck.t = 0;
        truck.model.setDoors(0);
        truck.fade.reverse(TRUCK_FADE_SECONDS);
      }
    } else if (truck.state === "leaving") {
      truck.t += dt;
      const p = Math.min(1, truck.t / TRUCK_DRIVE_SECONDS);
      truck.model.group.position.set(lerp(truck.to.x, truck.from.x, p), 0, lerp(truck.to.z, truck.from.z, p));

      if (p >= 1) removeTruck(gate);
    }
  }

  function step(dt) {
    simSeconds += dt;
    for (const loader of loaders) updateLoader(loader, dt);
    for (const gate of gates) stepGateTruck(gate, dt);
  }

  function getStats() {
    const hours = simSeconds / 3600;
    const cycles = cyclesIn + cyclesOut;
    const movedPerHour = hours > 0 ? Math.round(cycles / hours) : 0;

    return {
      phase: "mixed",
      cycles,
      storedKg: 0,
      fillPercent: 0,
      dockUnits: 0,
      trucksAtGates: gates.filter((g) => g.truck?.state === "docked").length,
      trucksWaiting: 0,
      trucksIn: 0,
      trucksOut: 0,
      receivedKg: Math.round(cyclesIn * cargoWeightKg),
      shippedKg: Math.round(cyclesOut * cargoWeightKg),
      movedPerHour,
      receivedPerHour: hours > 0 ? Math.round(cyclesIn / hours) : 0,
      shippedPerHour: hours > 0 ? Math.round(cyclesOut / hours) : 0,
      avgRouteM: 0,
      busyLoaders: loaders.filter((l) => l.state !== "idle").length,
    };
  }

  function dispose() {
    cargoFactory.dispose();

    for (const loader of loaders) {
      if (loader.cargoUnit) disposeTree(loader.cargoUnit);
      group.remove(loader.model.group);
      loader.model.dispose?.();
    }

    for (const gate of gates) {
      if (gate.truck) removeTruck(gate);
    }
  }

  return { step, getStats, dispose, meters: loaders.map((l) => l.meter) };
}
