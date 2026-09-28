import { MODEL_SCALE } from "../constants.js";
import { makeStackerRobot } from "../robots/stackerRobot.js";
import { createEnergyMeter } from "../energy.js";
import { computeArmObstacles } from "../obstacles.js";
import { computeArmSlots } from "../layout.js";
import { disposeTree } from "../sceneUtils.js";

// ============================================================
// Роботизированный комплекс укладки заготовок (каталог "stacker-1",
// реальная модель пользователя — public/models/stacker.glb): в отличие от
// процедурной роборуки (armRobot.js) со сменной кистью (weldArmRobot.js),
// эта модель самодостаточна — своя мини-лента, стол и манипулятор уже внутри
// файла, парные конвейеры armRobot.js ей не нужны. Поэтому у неё свой флот,
// а не robotFactory для createArmFleet — но наружу отдаёт тот же интерфейс
// {step, obstacles, meters, dispose, getOpsDone}, что и createArmFleet, чтобы
// useSimulation.js/simStats.js не знали о разнице (см. ветку armType==="stacker"
// в useSimulation.js — прямая параллель loaderType==="storagecube").
// ============================================================

// Имена узлов внутри stacker.glb (заданы автором модели) — двигаем их каждый
// цикл, чтобы установка не стояла истуканом: манипулятор поднимает-опускает
// заготовку, экструдер приминает её на стол, грузы едут по мини-ленте и
// возвращаются в начало на новом цикле.
const NODE_NAMES = {
  manipulator: "мини манипулятор",
  extruder: "Экструдер",
  cargoBig: "Большой груз",
  cargoSmall: "маленький груз",
};

export function createStackerFleet({ group, zone, count, armProd, energyProfile }) {
  const cycleDuration = 1 / Math.max(armProd / 60, 0.001);
  const slots = computeArmSlots(zone, count);

  const arms = slots.map((slot, i) => {
    const model = makeStackerRobot();
    model.position.set(slot.x, 0, slot.z);
    model.rotation.y = i % 2 === 0 ? 0 : Math.PI;
    model.scale.setScalar(MODEL_SCALE);
    group.add(model);

    const nodes = {};
    const restPos = {};
    for (const [key, name] of Object.entries(NODE_NAMES)) {
      const node = model.getObjectByName(name);
      if (node) {
        nodes[key] = node;
        restPos[key] = node.position.clone();
      }
    }

    return { group: model, nodes, restPos, phase: Math.random() };
  });

  const meters = arms.map(() => createEnergyMeter(energyProfile));
  const obstacles = computeArmObstacles(arms);
  let opsDone = 0;

  function step(dt) {
    for (let i = 0; i < arms.length; i++) {
      const arm = arms[i];
      meters[i].consume(dt, "work");

      const prevPhase = arm.phase;
      arm.phase = (arm.phase + dt / cycleDuration) % 1;
      if (arm.phase < prevPhase) opsDone += 1;

      const t = arm.phase;
      const punch = Math.sin(t * Math.PI * 2) * 0.5 + 0.5; // 0..1..0 за цикл — приход/отход манипулятора и экструдера

      const { manipulator, extruder, cargoBig, cargoSmall } = arm.nodes;
      const rest = arm.restPos;

      if (manipulator) {
        manipulator.position.y = rest.manipulator.y - punch * 0.18;
        manipulator.position.x = rest.manipulator.x + Math.sin(t * Math.PI * 2) * 0.1;
      }
      if (extruder) {
        extruder.position.y = rest.extruder.y - punch * 0.12;
      }
      // Грузы едут по мини-ленте вдоль локальной Z и на новом цикле возвращаются к началу.
      if (cargoSmall) cargoSmall.position.z = rest.cargoSmall.z - t * 1.4;
      if (cargoBig) cargoBig.position.z = rest.cargoBig.z - t * 0.9;
    }
  }

  function getOpsDone() {
    return opsDone;
  }

  function dispose() {
    for (const arm of arms) {
      group.remove(arm.group);
      disposeTree(arm.group);
    }
  }

  return { step, obstacles, meters, dispose, getOpsDone };
}
