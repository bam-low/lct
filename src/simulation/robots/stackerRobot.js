import { createGlbModel, normalizeModel } from "./glbModel.js";

// Роботизированный комплекс укладки заготовок — реальная модель пользователя
// (public/models/stacker.glb, карточка каталога ФЦ БАС: ООО «Битроботикс»,
// «Роботизированный комплекс по укладке заготовок»). Модель самодостаточна —
// база, мини-манипулятор, своя мини-лента и укладочный стол уже внутри файла,
// поэтому, в отличие от weldArmRobot.js (где реальная модель — только кисть
// процедурной роборуки), это отдельная стационарная установка со своим циклом
// (см. arms/stackerFleet.js), а не замена claw в makeArmRobot.
export const stackerModel = createGlbModel("stacker.glb", normalizeModel);

export function makeStackerRobot() {
  return stackerModel.clone();
}
