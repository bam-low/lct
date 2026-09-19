import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// BASE_URL учитывает base из vite.config.js (на GitHub Pages это '/lct/').
const MODEL_URL = `${import.meta.env.BASE_URL}models/vacuum.glb`;

let template = null;
let loadingPromise = null;

// Нормализуем модель один раз: центр по XZ, низ (колёса) на уровне пола, тени.
// Размер остаётся «как в файле» (~1 м по ширине) — итоговый масштаб задаёт
// VACUUM_MODEL_SCALE в constants.js.
function prepare(gltfScene) {
  gltfScene.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  const box = new THREE.Box3().setFromObject(gltfScene);
  const center = box.getCenter(new THREE.Vector3());
  gltfScene.position.set(-center.x, -box.min.y, -center.z);

  const root = new THREE.Group();
  root.add(gltfScene);
  return root;
}

// Загружает модель один раз на всё приложение; повторные вызовы возвращают
// тот же промис.
export function loadVacuumModel() {
  if (!loadingPromise) {
    loadingPromise = new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
      template = prepare(gltf.scene);
    });
  }

  return loadingPromise;
}

// Вызывать только после loadVacuumModel(). Геометрия и материалы общие у всех
// клонов — копируется только иерархия узлов.
export function makeVacuumRobot() {
  return template.clone(true);
}
