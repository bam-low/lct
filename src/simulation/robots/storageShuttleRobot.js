import * as THREE from "three";
import { PALETTE } from "../constants.js";

// Шаттл СтойкаБокс — единственный робот, который ездит поверх плотной сетки
// башен (ТЗ-правка пользователя: раньше в каждой башне был свой лифт, теперь
// один робот сверху возит груз между башнями). Готовой модели под этот узел
// не было — процедурная тележка на раме, в стиле остальной низкополигональной
// техники приложения (baggageTugModel.js, warehouseRacks.js).
export function makeStorageShuttle() {
  const group = new THREE.Group();

  const frameMat = new THREE.MeshStandardMaterial({ color: PALETTE.storage, flatShading: true, roughness: 0.6 });
  const accentMat = new THREE.MeshStandardMaterial({ color: PALETTE.dockPad, flatShading: true, roughness: 0.5 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x2c2e3f, flatShading: true, roughness: 0.55 });

  const rail = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.14, 1.15), railMat);
  rail.position.y = -0.07;
  rail.castShadow = true;
  group.add(rail);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.32, 0.85), frameMat);
  body.position.y = 0.16;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: new THREE.Color(0xe5a13f), emissiveIntensity: 0.6, flatShading: true })
  );
  beacon.position.y = 0.42;
  group.add(beacon);

  for (const [sx, sz] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]) {
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.14), accentMat);
    foot.position.set(sx * 0.5, -0.14, sz * 0.5);
    group.add(foot);
  }

  return group;
}

// Груз, который шаттл везёт между башнями, пока едет над сеткой — простая
// цветная коробка (не кусок настоящей glb-башни: тянуть меш из чужого клона
// между сценами усложнило бы жизненный цикл диспоуза без видимой пользы).
export function makeCarriedCrate(colorKey = "crateA") {
  const mat = new THREE.MeshStandardMaterial({ color: PALETTE[colorKey] ?? PALETTE.crateA, flatShading: true, roughness: 0.6 });
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.5), mat);
  crate.castShadow = true;
  crate.receiveShadow = true;
  return crate;
}
