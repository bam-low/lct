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

// Имена узлов внутри stacker.glb (заданы автором модели). По уточнению
// пользователя движутся по-разному: манипулятор — влево-вправо, экструдер и
// его тяги (стержни внутри стойки, которые толкают его вверх-вниз) — вместе
// вверх-вниз в такте манипулятора, а грузы — непрерывно едут по мини-ленте
// своим отдельным циклом, не завязанным на такт манипулятора.
const NODE_NAMES = {
  manipulator: "мини манипулятор",
  extruder: "Экструдер",
  extruderRod: "тяги экструдера",
  cargoBig: "Большой груз",
  cargoSmall: "маленький груз",
};

const BELT_CYCLE_S = 1.6; // отдельный, более быстрый цикл ленты — груз едет непрерывно, а не раз за такт манипулятора

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

    return { group: model, nodes, restPos, phase: Math.random(), beltPhase: Math.random() };
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
      arm.beltPhase = (arm.beltPhase + dt / BELT_CYCLE_S) % 1;

      const t = arm.phase;
      const punch = Math.sin(t * Math.PI * 2) * 0.5 + 0.5; // 0..1..0 за такт — ход экструдера с тягами

      const { manipulator, extruder, extruderRod, cargoBig, cargoSmall } = arm.nodes;
      const rest = arm.restPos;

      // Манипулятор — только влево-вправо.
      if (manipulator) manipulator.position.x = rest.manipulator.x + Math.sin(t * Math.PI * 2) * 0.35;

      // Экструдер и его тяги — синхронно вверх-вниз, одним и тем же ходом.
      if (extruder) extruder.position.y = rest.extruder.y - punch * 0.16;
      if (extruderRod) extruderRod.position.y = rest.extruderRod.y - punch * 0.16;

      // Грузы едут по мини-ленте вдоль локальной Z непрерывно, своим циклом.
      if (cargoSmall) cargoSmall.position.z = rest.cargoSmall.z - arm.beltPhase * 1.4;
      if (cargoBig) cargoBig.position.z = rest.cargoBig.z - arm.beltPhase * 0.9;
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
