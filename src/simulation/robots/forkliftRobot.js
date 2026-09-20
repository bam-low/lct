import * as THREE from "three";
import { createGlbModel, normalizeModel } from "./glbModel.js";
import { FORKLIFT_MODEL_SCALE } from "../constants.js";

// Модель погрузчика лежит в public/models/forklift.glb. Вилы в ней — отдельный
// узел (их поднимаем/опускаем), смотрят вперёд по +Z модели. Имя узла вил в
// файле: "Forks"/"Fork" или (как сейчас в экспорте из Blender) "Cube".
const FORK_NODE_NAMES = ["Forks", "Fork", "Cube"];

function findFork(root) {
  for (const name of FORK_NODE_NAMES) {
    const node = root.getObjectByName(name);
    if (node) return node;
  }

  throw new Error(`В forklift.glb не найден узел вил (${FORK_NODE_NAMES.join(", ")})`);
}

// Нормализуем модель и заодно измеряем вилы (в единицах файла): где нижняя
// плоскость вил и в каком месте перед корпусом лежит груз. Измеряем по самой
// модели, чтобы замена glb не требовала подгонки констант.
function prepareForklift(gltfScene) {
  const root = normalizeModel(gltfScene);
  const fork = findFork(root);

  const forkBox = new THREE.Box3().setFromObject(fork);

  const bodyBox = new THREE.Box3();
  root.traverse((obj) => {
    let isForkPart = false;
    obj.traverseAncestors((ancestor) => {
      if (ancestor === fork) isForkPart = true;
    });

    if (obj.isMesh && obj !== fork && !isForkPart) bodyBox.expandByObject(obj);
  });

  root.userData.forkMeasure = {
    bottomY: forkBox.min.y,
    // Центр открытой части вил: между передней кромкой корпуса и кончиками вил.
    carryZ: (bodyBox.max.z + forkBox.max.z) / 2,
    bodyFrontZ: bodyBox.max.z, // передняя кромка корпуса
  };

  return root;
}

export const forkliftModel = createGlbModel("forklift.glb", prepareForklift);

// Вызывать только когда forkliftModel.isReady().
//
// group — то, что двигаем по сцене (позиция + rotation.y = курс). Внутри:
//   model — сама glb-модель (масштабируется);
//   carry — точка на вилах, к которой крепится груз: ездит вместе с вилами.
// setForkLift(h) — поднять вилы на h единиц сцены над полом.
export function makeForkliftRobot() {
  const model = forkliftModel.clone();
  const fork = findFork(model);
  const measure = forkliftModel.getTemplate().userData.forkMeasure;
  const forkBaseY = fork.position.y;

  model.scale.setScalar(FORKLIFT_MODEL_SCALE);

  const carry = new THREE.Group();
  carry.position.z = measure.carryZ * FORKLIFT_MODEL_SCALE;

  const group = new THREE.Group();
  group.add(model, carry);

  // Груз глубиной depth (вдоль вил) должен стоять целиком перед корпусом, а не
  // «утопать» в нём: точку крепления сдвигаем вперёд, если поддон длиннее вил.
  const setCargoDepth = (depth) => {
    const openCentre = measure.carryZ * FORKLIFT_MODEL_SCALE;
    const clearOfBody = measure.bodyFrontZ * FORKLIFT_MODEL_SCALE + depth / 2 + 0.08;

    carry.position.z = Math.max(openCentre, clearOfBody);
  };

  const setForkLift = (height) => {
    // fork.position.y задан в единицах файла — перевод в единицы сцены через масштаб.
    fork.position.y = forkBaseY + height / FORKLIFT_MODEL_SCALE;
    carry.position.y = measure.bottomY * FORKLIFT_MODEL_SCALE + height;
  };

  setForkLift(0);

  return { group, carry, setForkLift, setCargoDepth };
}
