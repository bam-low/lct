import * as THREE from "three";
import { PALETTE } from "../../constants.js";

// Второй вид робота для аэропорта (по ТЗ — «Беспилотный тягач», багажный
// тягач с прицепными тележками; в примерах решений аэропорта указан рядом с
// AMR/FMR/уборщиком как отдельная категория «круглогодичная работа на
// перроне и в багажных зонах»). Процедурная модель — готового GLB под тягач
// не поступало, только у транспортировщика и техники склада.
const wheelGeometry = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 8);

function addWheels(group, material, positions) {
  for (const [x, z] of positions) {
    const wheel = new THREE.Mesh(wheelGeometry, material);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.16, z);
    group.add(wheel);
  }
}

function makeTugHead() {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({ color: PALETTE.robotBody, flatShading: true, roughness: 0.5 });
  const cabMat = new THREE.MeshStandardMaterial({ color: PALETTE.storage, flatShading: true, roughness: 0.6 });
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1c1d29, flatShading: true, roughness: 0.7 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.5, 1.3), bodyMat);
  body.position.y = 0.42;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.42, 0.55), cabMat);
  cab.position.set(0, 0.85, 0.32);
  cab.castShadow = true;
  group.add(cab);

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xffd27a, emissive: new THREE.Color(0xe5a13f), emissiveIntensity: 0.6, flatShading: true })
  );
  beacon.position.set(0, 1.1, 0.32);
  group.add(beacon);

  addWheels(group, wheelMat, [
    [-0.42, -0.42],
    [0.42, -0.42],
    [-0.42, 0.42],
    [0.42, 0.42],
  ]);

  return group;
}

function makeBaggageCart(colorIndex) {
  const group = new THREE.Group();
  const suitcaseColors = [PALETTE.crateA, PALETTE.crateB, PALETTE.crateC, PALETTE.pad];

  const frameMat = new THREE.MeshStandardMaterial({ color: PALETTE.storage, flatShading: true, roughness: 0.6 });
  const bed = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.08, 1.05), frameMat);
  bed.position.y = 0.26;
  bed.castShadow = true;
  bed.receiveShadow = true;
  group.add(bed);

  addWheels(group, frameMat, [
    [-0.34, -0.4],
    [0.34, -0.4],
    [-0.34, 0.4],
    [0.34, 0.4],
  ]);

  for (let i = 0; i < 2; i++) {
    const mat = new THREE.MeshStandardMaterial({
      color: suitcaseColors[(colorIndex + i) % suitcaseColors.length],
      flatShading: true,
      roughness: 0.55,
    });
    const suitcase = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.3), mat);
    suitcase.position.set(0, 0.3 + 0.15, -0.28 + i * 0.56);
    suitcase.castShadow = true;
    group.add(suitcase);
  }

  return group;
}

// Состав из тягача и нескольких прицепных тележек — единая жёсткая группа
// (без сочленений, упрощённо): тележки просто расставлены следом вдоль
// локальной -Z, все вместе двигаются и поворачиваются как одно целое.
export function makeBaggageTrain(cartCount = 3) {
  const group = new THREE.Group();
  group.add(makeTugHead());

  let z = -1.05;
  for (let i = 0; i < cartCount; i++) {
    const cart = makeBaggageCart(i);
    cart.position.z = z;
    group.add(cart);
    z -= 1.25;
  }

  return group;
}
