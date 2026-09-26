import * as THREE from "three";
import { PALETTE } from "../../constants.js";

// Тестовая модель воздушного судна — фюзеляж-цилиндр, крылья-пластины, киль,
// нос-конус. Используется и у гейтов (обслуживание), и в декоративном фоне
// (заходы на посадку/взлёты на ВПП сбоку) — один и тот же placeholder.
export function makeAircraft() {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe9e7f0, flatShading: true, roughness: 0.4, metalness: 0.05 });
  const accentMat = new THREE.MeshStandardMaterial({ color: PALETTE.pad, flatShading: true, roughness: 0.45 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x2b3350, flatShading: true, roughness: 0.3 });

  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 6.5, 4, 10), bodyMat);
  fuselage.rotation.z = Math.PI / 2;
  fuselage.position.y = 1.4;
  fuselage.castShadow = true;
  fuselage.receiveShadow = true;
  group.add(fuselage);

  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 10), glassMat);
  cockpit.position.set(4.1, 1.5, 0);
  group.add(cockpit);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 9), accentMat);
  wing.position.set(-0.3, 1.2, 0);
  wing.castShadow = true;
  wing.receiveShadow = true;
  group.add(wing);

  const tailWing = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 3.4), accentMat);
  tailWing.position.set(-3.7, 1.9, 0);
  group.add(tailWing);

  const fin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.8, 0.14), accentMat);
  fin.position.set(-3.7, 2.6, 0);
  fin.castShadow = true;
  group.add(fin);

  const gearMat = new THREE.MeshStandardMaterial({ color: PALETTE.storage, flatShading: true, roughness: 0.7 });
  [-2.2, 0.8].forEach((x) => {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6), gearMat);
    strut.position.set(x, 0.6, 0);
    group.add(strut);
  });

  return group;
}
