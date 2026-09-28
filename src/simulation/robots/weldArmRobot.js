import * as THREE from "three";
import { ARM_LENGTH, ARM_CARRY_Y } from "../constants.js";
import { buildConveyors } from "./armRobot.js";
import { createGlbModel, normalizeModel } from "./glbModel.js";

// Роборука-манипулятор — реальная модель пользователя (public/models/weld_arm.glb):
// клешня, которая может варить металл и поднимать коробки. Альтернатива
// ArmTech Sorter на процессе «Сортировка/перегрузка» — те же ленты, что и у
// процедурной руки (buildConveyors переиспользуется), но, в отличие от
// прежней версии, модель здесь НЕ подвешена кистью на процедурный
// основание+бар (жалоба: «роборука её передвигает», получалось два робота
// сразу) — модель сама целиком стоит на пивоте и поворачивается им между
// лентами, никакой второй, нарисованной вручную руки под ней нет.
export const weldArmModel = createGlbModel("weld_arm.glb", normalizeModel);

export function makeWeldArmRig(accentColor, beltTexture) {
  const group = new THREE.Group();

  const pivot = new THREE.Group();
  pivot.position.y = 1.4;
  group.add(pivot);

  // Модель стоит у оси пивота (X=Z=0) — поворот пивота крутит её на месте
  // вокруг своей же вертикали, а не носит на конце постороннего рычага.
  // По Y компенсируем высоту пивота, чтобы собственное основание модели
  // (normalizeModel уже поставило его на 0) визуально стояло на полу.
  const model = weldArmModel.clone();
  model.position.y = -pivot.position.y;
  pivot.add(model);

  // Невидимая точка захвата — на том же радиусе ARM_LENGTH от пивота, что и у
  // процедурной руки, чтобы доставать до обеих лент; коробка едет вместе с
  // пивотом (armFleet.js делает claw.add(box)), поэтому визуально уезжает в
  // ту же сторону, куда поворачивается сама модель.
  const claw = new THREE.Group();
  claw.position.set(ARM_LENGTH, ARM_CARRY_Y, 0);
  pivot.add(claw);

  const beltMat = new THREE.MeshStandardMaterial({ map: beltTexture, flatShading: true, roughness: 0.7, metalness: 0.0 });
  const boxes = buildConveyors(group, beltMat);

  return { group, pivot, claw, boxes };
}
