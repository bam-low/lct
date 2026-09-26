import { createGlbModel, normalizeModel } from "./glbModel.js";

// Роботизированная кубическая система хранения — реальная модель пользователя
// (public/models/storage_cube.glb), по аналогии с CleanBotics Model 400 Pro:
// стационарная башня хранения с шаттлом/лифтом внутри, а не подвижный робот.
// Альтернатива вилочному погрузчику на процессе «Погрузка и складирование» —
// груз в неё подаёт манипулятор/конвейер или погрузчик напрямую, сама она не ездит.
export const storageCubeModel = createGlbModel("storage_cube.glb", normalizeModel);

export function makeStorageCubeRobot() {
  return storageCubeModel.clone();
}
