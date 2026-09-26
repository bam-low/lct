import { createGlbModel, normalizeModel } from "./glbModel.js";

// Мойщик полов — реальная модель пользователя (public/models/floor_washer.glb):
// моющая щётка, а не всасывающий пылесос. Альтернатива CleanBot на процессе
// «Уборка пола» — та же формула площади/производительности (м²/ч), другой
// физический принцип уборки (влажная мойка щёткой, а не сухая уборка).
export const floorWasherModel = createGlbModel("floor_washer.glb", normalizeModel);

export function makeFloorWasherRobot() {
  return floorWasherModel.clone();
}
