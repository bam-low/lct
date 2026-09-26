import { makeStorageCubeRobot } from "../robots/storageCubeRobot.js";
import { createEnergyMeter } from "../energy.js";
import { disposeTree } from "../sceneUtils.js";

const CUBE_SCALE = 2.4;
const CYCLE_SECONDS = 6; // время одного подъёма/спуска шаттла внутри башни — чисто декоративно
const INWARD_STEP = 6; // насколько башня отступает от ворот внутрь помещения, и шаг между башнями одних ворот
const LATERAL_NUDGE = 2; // небольшой боковой сдвиг, чтобы башня не стояла ровно по центру проёма

// Роботизированная кубическая система хранения («Биомусорка» — реальная
// модель пользователя) — альтернатива вилочному погрузчику на процессе
// «Погрузка и складирование», но принципиально другой механики: стационарная
// башня с шаттлом внутри, не ездит по складу. loaderSystem.js (дороги, фуры,
// маршрутизация по полосам) сюда не подходит — груз в реальности подаёт
// манипулятор/конвейер или напрямую погрузчик, поэтому у этого флота нет
// собственного движения по складу, только сама башня с лифтом-шаттлом.
//
// count — сколько башен нужно по расчёту; gates — кластеры ворот формы склада
// (computeGateClusters, работает и для стандартного прямоугольника, и для своей
// формы) — башни распределяются по воротам round-robin и отступают внутрь
// помещения от каждых ворот по их нормали, а не жёстко на юг.
export function createStorageCubeFleet({ group, gates, count, energyProfile, throughputPerHour = 0 }) {
  const cubes = gates.length ? Array.from({ length: count }, (_, i) => createCube(i)) : [];

  function createCube(index) {
    const model = makeStorageCubeRobot();
    model.scale.setScalar(CUBE_SCALE);

    const gate = gates[index % gates.length];
    const row = Math.floor(index / gates.length);
    const [nx, nz] = gate.normal;
    const inward = { x: -nx, z: -nz };
    const tangent = { x: -nz, z: nx };
    const depth = INWARD_STEP + row * INWARD_STEP;

    model.position.set(
      gate.worldCenter.x + inward.x * depth + tangent.x * LATERAL_NUDGE,
      0,
      gate.worldCenter.z + inward.z * depth + tangent.z * LATERAL_NUDGE
    );
    group.add(model);

    const lift = model.getObjectByName("СТОЙКА") ?? model.getObjectByName("Это база") ?? model;

    return { model, lift, phase: Math.random(), meter: createEnergyMeter(energyProfile) };
  }

  let movedUnits = 0;
  let time = 0;

  function step(dt) {
    time += dt;

    for (const cube of cubes) {
      cube.meter.consume(dt, "work");
      cube.phase = (cube.phase + dt / CYCLE_SECONDS) % 1;

      // Шаттл едет вверх-вниз по башне — простая декоративная анимация лифта.
      const t = cube.phase < 0.5 ? cube.phase * 2 : 2 - cube.phase * 2;
      cube.lift.position.y = t * 1.4;
    }

    movedUnits += (throughputPerHour * count * dt) / 3600;
  }

  function getStats() {
    return {
      phase: "storage",
      cycles: Math.round(movedUnits),
      storedKg: 0,
      fillPercent: 0,
      dockUnits: 0,
      trucksAtGates: 0,
      trucksWaiting: 0,
      trucksIn: 0,
      trucksOut: 0,
      receivedKg: 0,
      shippedKg: 0,
      movedPerHour: time > 60 ? Math.round((movedUnits * 3600) / time) : 0,
      receivedPerHour: 0,
      shippedPerHour: 0,
      avgRouteM: 0,
      busyLoaders: cubes.length,
    };
  }

  function dispose() {
    for (const cube of cubes) {
      group.remove(cube.model);
      disposeTree(cube.model);
    }
  }

  return { step, getStats, dispose, meters: cubes.map((c) => c.meter), payload: 1, storageCapacityUnits: 0 };
}
