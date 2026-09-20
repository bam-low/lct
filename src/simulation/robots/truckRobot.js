import * as THREE from "three";
import { createGlbModel } from "./glbModel.js";
import { TRUCK_MODEL_SCALE } from "../constants.js";

// Модель фуры лежит в public/models/truck.glb: кабина смотрит в +Z модели,
// задняя стенка с двумя дверями (узлы "Cube002" / "Cube003" — three.js убирает точки из имён) — в −Z.
const DOOR_NODE_NAMES = ["Cube002", "Cube003"];
const DOOR_OPEN_ANGLE = Math.PI / 2;
const DOOR_HINGE_OUTSET = 0.5; // шарнир чуть снаружи кузова, чтобы открытая дверь ложилась вдоль борта

// Начало координат фуры — центр задней стенки на уровне земли, поэтому фуру
// удобно «подкатывать» задом к воротам: достаточно поставить её туда, где должна
// быть задняя стенка.
function prepareTruck(gltfScene) {
  gltfScene.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  const box = new THREE.Box3().setFromObject(gltfScene);
  const center = box.getCenter(new THREE.Vector3());
  gltfScene.position.set(-center.x, -box.min.y, -box.min.z);

  const root = new THREE.Group();
  root.add(gltfScene);
  root.updateMatrixWorld(true);

  const size = box.getSize(new THREE.Vector3());

  root.userData.measure = {
    length: size.z,
    width: size.x,
    height: size.y,
    // Высота пола кузова над землёй: самая нижняя точка кузова (без колёс) в
    // модели — у узла кузова "Cube001".
    bedY: (new THREE.Box3().setFromObject(gltfScene.getObjectByName("Cube001")).min.y - box.min.y) + 0.15,
  };

  return root;
}

export const truckModel = createGlbModel("truck.glb", prepareTruck);

// Вызывать только когда truckModel.isReady().
//
// group — то, что двигаем по сцене (позиция = центр задней стенки, rotation.y =
// курс кабины). setDoors(0..1) — открыть/закрыть задние двери;
// bedY и length — в единицах сцены.
export function makeTruck() {
  const model = truckModel.clone();
  const measure = truckModel.getTemplate().userData.measure;
  const doors = DOOR_NODE_NAMES.map((name) => model.getObjectByName(name)).filter(Boolean);

  const hinges = doors.map((door) => {
    const side = Math.sign(door.position.x) || 1;
    const hingeX = side * (Math.abs(door.position.x) + door.scale.x + DOOR_HINGE_OUTSET);

    const pivot = new THREE.Group();
    pivot.position.set(hingeX, door.position.y, door.position.z);
    door.parent.add(pivot);
    pivot.add(door);
    door.position.set(door.position.x - hingeX, 0, 0);

    return { pivot, side };
  });

  // Тёмный проём открытого кузова: закрывает заднюю стенку, пока двери открыты.
  const opening = new THREE.Mesh(
    new THREE.PlaneGeometry(4.5, 4.4),
    new THREE.MeshBasicMaterial({ color: 0x16172a, toneMapped: false })
  );
  const doorFrame = hinges[0]?.pivot;
  opening.position.set(0, doorFrame?.position.y ?? 3.6, (doorFrame?.position.z ?? -18.4) - 0.2);
  opening.rotation.y = Math.PI;
  opening.visible = false;
  doorFrame?.parent.add(opening);

  const group = new THREE.Group();
  group.add(model);
  group.scale.setScalar(TRUCK_MODEL_SCALE);

  let openness = 0;

  return {
    group,
    length: measure.length * TRUCK_MODEL_SCALE,
    bedY: measure.bedY * TRUCK_MODEL_SCALE,

    setDoors(value) {
      openness = Math.min(1, Math.max(0, value));

      for (const { pivot, side } of hinges) {
        pivot.rotation.y = side * DOOR_OPEN_ANGLE * openness;
      }

      opening.visible = openness > 0.05;
    },

    get doors() {
      return openness;
    },
  };
}
