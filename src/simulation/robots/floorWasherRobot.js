import * as THREE from "three";
import { createGlbModel, normalizeModel } from "./glbModel.js";

// Мойщик полов — реальная модель пользователя (public/models/floor_washer.glb):
// моющая щётка, а не всасывающий пылесос. Альтернатива CleanBot на процессе
// «Уборка пола» — та же формула площади/производительности (м²/ч), другой
// физический принцип уборки (влажная мойка щёткой, а не сухая уборка).
export const floorWasherModel = createGlbModel("floor_washer.glb", normalizeModel);

// vacuumFleet.js считает курс как Math.atan2(dir.x, dir.z) и КАЖДЫЙ кадр
// перезаписывает model.rotation.y = heading напрямую (та же договорённость,
// что у всех остальных моделей: локальный "нос" должен смотреть вдоль +Z) —
// поэтому поправку разворота нельзя один раз поставить на сам клон и вернуть
// его: она слетит на первом же кадре. Заворачиваем модель в обёртку: fleet
// крутит обёртку по курсу движения, а фиксированная поправка внутри остаётся.
// В файле щётка смотрит вдоль локальной +X, флажок-антенна — над ней же, с
// той же стороны (жалоба пользователя: «ездит боком», антенна должна быть
// сзади) — разворачиваем на -90°, чтобы щётка (ведущая рабочая часть) была
// спереди по +Z, а флажок — сзади.
const FORWARD_CORRECTION_Y = -Math.PI / 2;

export function makeFloorWasherRobot() {
  const wrapper = new THREE.Group();
  const model = floorWasherModel.clone();
  model.rotation.y = FORWARD_CORRECTION_Y;
  wrapper.add(model);
  return wrapper;
}
