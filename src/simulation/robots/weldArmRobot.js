import { createGlbModel, normalizeModel } from "./glbModel.js";
import { makeArmRobot } from "./armRobot.js";

// Роборука-манипулятор — реальная модель пользователя (public/models/weld_arm.glb):
// клешня, которая может варить металл и поднимать коробки. Альтернатива
// ArmTech Sorter на процессе «Сортировка/перегрузка» — тот же цикл приёма/
// выдачи груза на тех же конвейерах (armFleet.js целиком переиспользуется,
// не дублируем автомат состояний), только вместо процедурного кубика-захвата
// на конце руки — настоящая модель клешни.
export const weldArmModel = createGlbModel("weld_arm.glb", normalizeModel);

// makeClaw для makeArmRobot(): сама модель становится «кистью» руки и получает
// коробки как своих детей на время переноса (armFleet.js делает claw.add(box)).
function makeWeldClaw() {
  const claw = weldArmModel.clone();
  claw.scale.setScalar(0.45);
  return claw;
}

export function makeWeldArmRig(accentColor, beltTexture) {
  return makeArmRobot(accentColor, beltTexture, makeWeldClaw);
}
