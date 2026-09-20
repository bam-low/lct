import { createGlbModel, normalizeModel } from "./glbModel.js";

// Модель пылесоса лежит в public/models/vacuum.glb.
export const vacuumModel = createGlbModel("vacuum.glb", normalizeModel);

// Вызывать только когда vacuumModel.isReady().
export function makeVacuumRobot() {
  return vacuumModel.clone();
}
