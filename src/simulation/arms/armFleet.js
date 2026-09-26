import {
  MODEL_SCALE,
  PALETTE,
  ARM_PICKUP_Z,
  ARM_BELT_X,
  ARM_BELT_START_Z,
  ARM_BELT_END_Z,
  BOX_GAP,
  ARM_LEFT_ANGLE,
  ARM_RIGHT_ANGLE,
  ARM_PICKUP_Y,
  ARM_CARRY_Y,
} from "../constants.js";
import { easeInOut, disposeTree } from "../sceneUtils.js";
import { computeArmObstacles } from "../obstacles.js";
import { makeArmRobot } from "../robots/armRobot.js";
import { createEnergyMeter } from "../energy.js";
import { computeArmSlots } from "../layout.js";

// ============================================================
// Роборуки: стационарные, перекладывают коробки с входного конвейера на
// выходной. Питаются от сети, поэтому батарею не моделируем — только считаем
// энергию (энергопрофиль из каталога).
//
// armProd — оп/мин одной руки: от неё зависят скорость цикла и лент.
// Места рук — computeArmSlots (одна линия, а при большом числе — колонки).
// ============================================================

// robotFactory(accentColor, beltTexture) — какую модель руки строить на каждом
// месте; по умолчанию процедурная ArmTech-модель, но тот же автомат состояний
// (конвейеры, захват/передача коробок, счётчик операций) подходит любой руке,
// у которой есть {group, pivot, claw, boxes} — см. makeWeldArmRig.js для
// альтернативы с настоящей моделью клешни.
export function createArmFleet({ group, zone, count, beltTexture, armProd, energyProfile, robotFactory = makeArmRobot }) {
  const cycleDuration = 1 / Math.max(armProd / 60, 0.001);
  const beltRate = 1.45 * Math.max(1, armProd / 15);

  const slots = computeArmSlots(zone, count);

  const arms = slots.map((slot, i) => {
    const built = robotFactory(PALETTE.armAccents[i % PALETTE.armAccents.length], beltTexture);

    built.group.position.set(slot.x, 0, slot.z);
    built.group.scale.setScalar(MODEL_SCALE);
    group.add(built.group);

    return { ...built, phase: Math.random(), transferBox: null, lastGoingRight: undefined };
  });

  const meters = arms.map(() => createEnergyMeter(energyProfile));
  let opsDone = 0;

  // Роборуки стационарны — препятствия для объезда пылесосов считаются один раз.
  const obstacles = computeArmObstacles(arms);

  // ----------------------------------------------------------
  // Конвейеры
  // ----------------------------------------------------------

  function findWaitingBox(arm) {
    let best = null;
    let bestDistance = Infinity;

    for (const box of arm.boxes) {
      if (box.userData.state !== "waiting") continue;

      const distance = Math.abs(box.userData.z - ARM_PICKUP_Z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = box;
      }
    }

    return best;
  }

  function advanceInputQueue(boxes, dt) {
    const queue = boxes.filter((b) => b.userData.state === "input" || b.userData.state === "waiting");
    queue.sort((a, b) => b.userData.z - a.userData.z);

    let limit = ARM_PICKUP_Z;

    queue.forEach((box) => {
      let z = box.userData.z + beltRate * dt;
      if (z > limit) z = limit;

      box.userData.z = z;
      box.position.set(-ARM_BELT_X, 0.82, z);
      box.userData.state = z >= ARM_PICKUP_Z - 1e-3 ? "waiting" : "input";
      limit = z - BOX_GAP;
    });
  }

  function advanceOutputQueue(boxes, dt) {
    const queue = boxes.filter((b) => b.userData.state === "output");
    queue.sort((a, b) => a.userData.z - b.userData.z);

    let limit = -Infinity;

    queue.forEach((box) => {
      let z = box.userData.z + beltRate * dt;
      if (z < limit) z = limit;

      box.userData.z = z;
      box.position.set(ARM_BELT_X, 0.82, z);
      box.rotation.y += dt * 0.8;
      limit = z + BOX_GAP;

      if (box.userData.z >= ARM_BELT_END_Z) {
        box.userData.state = "input";
        box.userData.side = -1;
        box.userData.z = ARM_BELT_START_Z;
        box.position.set(-ARM_BELT_X, 0.82, ARM_BELT_START_Z);
        box.rotation.set(0, 0, 0);
      }
    });
  }

  // ----------------------------------------------------------
  // Рука
  // ----------------------------------------------------------

  function advanceArm(arm, dt) {
    arm.phase = (arm.phase + dt / cycleDuration) % 1;
    if (arm.phase < 0) arm.phase += 1;

    const goingRight = arm.phase < 0.5;
    const legPhase = goingRight ? arm.phase * 2 : (arm.phase - 0.5) * 2;
    const eased = easeInOut(legPhase);

    const ARM_RIGHT_FAR = ARM_RIGHT_ANGLE + Math.PI * 2;

    const angle = goingRight
      ? ARM_LEFT_ANGLE + (ARM_RIGHT_FAR - ARM_LEFT_ANGLE) * eased
      : ARM_RIGHT_FAR - (ARM_RIGHT_FAR - ARM_LEFT_ANGLE) * eased;

    const dip = Math.cos(Math.PI * legPhase) ** 2;

    arm.pivot.rotation.y = angle;
    arm.claw.position.y = ARM_CARRY_Y + (ARM_PICKUP_Y - ARM_CARRY_Y) * dip;

    const boxes = arm.boxes;
    if (!boxes?.length) return;

    advanceInputQueue(boxes.filter((b) => b.userData.side === -1 && b.userData.state !== "carried"), dt);
    advanceOutputQueue(boxes.filter((b) => b.userData.side === 1 && b.userData.state !== "carried"), dt);

    if (arm.lastGoingRight === undefined) arm.lastGoingRight = goingRight;

    // Передача: рука дошла до выходного конвейера и отпускает коробку.
    if (arm.lastGoingRight && !goingRight && arm.transferBox) {
      const box = arm.transferBox;

      arm.claw.remove(box);
      box.userData.state = "output";
      box.userData.side = 1;
      box.userData.z = ARM_PICKUP_Z;
      box.rotation.set(0, 0, 0);
      box.position.set(ARM_BELT_X, 0.82, ARM_PICKUP_Z);
      arm.group.add(box);
      arm.transferBox = null;
      opsDone += 1;
    }

    // Захват: рука вернулась ко входному конвейеру и берёт коробку.
    if (!arm.lastGoingRight && goingRight && !arm.transferBox) {
      const pickupBox = findWaitingBox(arm);

      if (pickupBox) {
        arm.transferBox = pickupBox;
        pickupBox.userData.state = "carried";
        arm.claw.add(pickupBox);
        pickupBox.position.set(0, -0.34, 0);
        pickupBox.rotation.set(0, 0, 0);
      }
    }

    arm.lastGoingRight = goingRight;
  }

  // ----------------------------------------------------------
  // Публичный интерфейс
  // ----------------------------------------------------------

  function step(dt) {
    arms.forEach((arm, i) => {
      meters[i].consume(dt, "work");
      advanceArm(arm, dt);
    });
  }

  // У каждой роборуки свои геометрии и материалы (текстура ленты общая).
  function dispose() {
    for (const arm of arms) {
      group.remove(arm.group);
      disposeTree(arm.group);
    }
  }

  return { step, obstacles, meters, dispose, getOpsDone: () => opsDone };
}
