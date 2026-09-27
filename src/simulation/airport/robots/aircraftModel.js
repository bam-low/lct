import * as THREE from "three";
import { PALETTE } from "../../constants.js";

// Модель воздушного судна — фюзеляж с цветной «ливреей» (полоса вдоль борта,
// как у остальных объектов сцены — единый акцентный цвет PALETTE.pad),
// крылья с двигателями-пилонами, киль и стабилизатор. Используется и у гейтов
// (стоянка), и в декоративном фоне (заходы на посадку/взлёты на ВПП сбоку).
export function makeAircraft() {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: PALETTE.robotBody, flatShading: true, roughness: 0.4, metalness: 0.05 });
  const accentMat = new THREE.MeshStandardMaterial({ color: PALETTE.pad, flatShading: true, roughness: 0.45 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x2b3350, flatShading: true, roughness: 0.3 });
  const engineMat = new THREE.MeshStandardMaterial({ color: PALETTE.storage, flatShading: true, roughness: 0.55 });

  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.75, 6.6, 4, 10), bodyMat);
  fuselage.rotation.z = Math.PI / 2;
  fuselage.position.y = 1.4;
  fuselage.castShadow = true;
  fuselage.receiveShadow = true;
  group.add(fuselage);

  // Цветная полоса вдоль борта (ливрея) — тонкая, чуть выступает над обшивкой.
  const cheatline = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.22, 1.56), accentMat);
  cheatline.position.set(0, 1.15, 0);
  group.add(cheatline);

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 1.3), glassMat);
  cockpit.position.set(3.85, 1.55, 0);
  group.add(cockpit);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 9.4), bodyMat);
  wing.position.set(0.4, 1.15, 0);
  wing.castShadow = true;
  wing.receiveShadow = true;
  group.add(wing);

  [-2.9, 2.9].forEach((z) => {
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 1.3, 10), engineMat);
    engine.rotation.z = Math.PI / 2;
    engine.position.set(0.1, 0.75, z);
    engine.castShadow = true;
    group.add(engine);
  });

  const tailWing = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 3.4), bodyMat);
  tailWing.position.set(-3.7, 1.9, 0);
  group.add(tailWing);

  const fin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.9, 0.14), accentMat);
  fin.position.set(-3.7, 2.65, 0);
  fin.castShadow = true;
  group.add(fin);

  return group;
}
