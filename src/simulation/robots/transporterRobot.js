import * as THREE from "three";
import { createGlbModel, normalizeModel } from "./glbModel.js";

// Транспортировщик — реальная модель пользователя (public/models/transporter.glb):
// низкая платформа на колёсах, груз на неё ставит погрузчик или манипулятор,
// сама она только возит (без вил — в отличие от forkliftRobot.js). Общая для
// склада (альтернатива вилочному погрузчику на процессе «Погрузка и
// складирование») и аэропорта (единственный тип робота).
//
// Тот же интерфейс, что у makeForkliftRobot() ({group, carry, setForkLift,
// setCargoDepth}), поэтому loaderSystem.js работает с ним без изменений —
// setForkLift здесь просто ничего не поднимает (грузовая площадка на
// фиксированной высоте верха платформы), а не завязан на именованный узел вил.
export const transporterModel = createGlbModel("transporter.glb", normalizeModel);

export function makeTransporterRobot() {
  const model = transporterModel.clone();
  const deckY = new THREE.Box3().setFromObject(model).max.y;

  const carry = new THREE.Group();
  carry.position.y = deckY;

  const group = new THREE.Group();
  group.add(model, carry);

  return {
    group,
    carry,
    setForkLift: () => {},
    setCargoDepth: () => {},
  };
}
