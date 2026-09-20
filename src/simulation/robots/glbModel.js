import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Общая загрузка glb-моделей роботов: асинхронно, один раз на приложение
// (повторные вызовы получают тот же промис), с прогревом до открытия сцены.
//
// prepare(gltfScene) получает сырую сцену из файла и возвращает "шаблон" —
// нормализованную группу. Из шаблона потом клонируются отдельные роботы.
export function createGlbModel(fileName, prepare) {
  // BASE_URL учитывает base из vite.config.js (на GitHub Pages это '/lct/').
  const url = `${import.meta.env.BASE_URL}models/${fileName}`;

  let template = null;
  let loadingPromise = null;

  return {
    load() {
      if (!loadingPromise) {
        loadingPromise = new GLTFLoader().loadAsync(url).then((gltf) => {
          template = prepare(gltf.scene);
        });
      }

      return loadingPromise;
    },

    isReady: () => template !== null,

    // Запускает загрузку заранее; ошибку не глотаем — она придёт в тот же
    // промис, когда сцена запросит модель, и покажется в UI.
    preload() {
      this.load().catch(() => {});
    },

    getTemplate: () => template,

    // Геометрия и материалы общие у всех клонов — копируется только иерархия.
    clone: () => template.clone(true),
  };
}

// Приводит модель к общему виду: тени включены, центр по XZ, низ (колёса) на
// уровне пола. Размер остаётся «как в файле» — итоговый масштаб задают
// константы в constants.js.
export function normalizeModel(gltfScene) {
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
  root.updateMatrixWorld(true);

  return root;
}
