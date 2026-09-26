import { computeGateClusters } from "../shape/shapeGeometry.js";
import { CELL, cellAt, cellWorldOrigin } from "../shape/shapeTypes.js";
import { createCargoFactory } from "./cargo.js";
import { createEnergyMeter } from "../energy.js";
import { disposeTree } from "../sceneUtils.js";
import { makeForkliftRobot } from "../robots/forkliftRobot.js";
import { LOAD_SLOWDOWN } from "../constants.js";

const PAUSE_SECONDS = 1.4; // пауза на погрузку/разгрузку у стеллажа и у ворот
const FORK_LIFT_HEIGHT = 1.1;
const ARRIVE_EPS = 0.15;
const TURN_RATE = 6; // рад/с

// Погрузчики для «своей» формы склада (конструктор): в отличие от штатного
// loaderSystem.js (проезды/полосы/LIFO-ячейки, roads.js/traffic.js), здесь
// упрощённый маршрут в 2 плеча — ворота ↔ ближайший назначенный стеллаж по
// прямой линии, без системы проездов (см. план: экономика по площади, полноценная
// раскладка проездов для произвольной формы — вне рамок этого захода). Фуры не
// симулируются — груз просто появляется/исчезает у ворот при погрузке/разгрузке.
const headingZForward = (dx, dz) => Math.atan2(dx, dz);

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
      myRacks: racksByGate.get(gate.id),
      rackIndex: 0,
      state: "idle", // idle (нет стеллажей) | toRack | atRack | toGate | atGate
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

  let cycles = 0;
  let simSeconds = 0;

  function updateLoader(loader, dt) {
    if (loader.myRacks.length === 0) {
      loader.state = "idle";
      loader.meter.consume(dt, "idle");
      return;
    }

    const speed = speedUnitsPerSec * (loader.carrying ? loadSlowFactor : 1);

    switch (loader.state) {
      case "idle":
        loader.state = "toRack";
        break;

      case "toRack": {
        loader.meter.consume(dt, "work");
        const target = loader.myRacks[loader.rackIndex % loader.myRacks.length];

        if (driveToward(loader, target, dt, speed)) {
          loader.state = "atRack";
          loader.timer = 0;
        }

        break;
      }

      case "atRack":
        loader.meter.consume(dt, "idle");
        loader.timer += dt;

        if (loader.timer >= PAUSE_SECONDS) {
          loader.carrying = true;
          loader.model.setForkLift(FORK_LIFT_HEIGHT);
          loader.cargoUnit = cargoFactory.create();
          loader.cargoUnit.position.y = 0;
          loader.model.carry.add(loader.cargoUnit);
          loader.rackIndex++;
          loader.state = "toGate";
        }

        break;

      case "toGate": {
        loader.meter.consume(dt, "work");

        if (driveToward(loader, loader.gate.worldCenter, dt, speed)) {
          loader.state = "atGate";
          loader.timer = 0;
        }

        break;
      }

      case "atGate":
        loader.meter.consume(dt, "idle");
        loader.timer += dt;

        if (loader.timer >= PAUSE_SECONDS) {
          loader.carrying = false;
          loader.model.setForkLift(0);

          if (loader.cargoUnit) {
            loader.model.carry.remove(loader.cargoUnit);
            disposeTree(loader.cargoUnit);
            loader.cargoUnit = null;
          }

          cycles++;
          loader.state = "toRack";
        }

        break;

      default:
        break;
    }
  }

  function step(dt) {
    simSeconds += dt;
    for (const loader of loaders) updateLoader(loader, dt);
  }

  function getStats() {
    const hours = simSeconds / 3600;
    const movedPerHour = hours > 0 ? Math.round(cycles / hours) : 0;

    return {
      phase: "mixed",
      cycles,
      storedKg: 0,
      fillPercent: 0,
      dockUnits: 0,
      trucksAtGates: 0,
      trucksWaiting: 0,
      trucksIn: 0,
      trucksOut: 0,
      receivedKg: Math.round(cycles * cargoWeightKg),
      shippedKg: 0,
      movedPerHour,
      receivedPerHour: movedPerHour,
      shippedPerHour: 0,
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
  }

  return { step, getStats, dispose, meters: loaders.map((l) => l.meter) };
}
