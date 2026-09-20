import * as THREE from "three";
import { PALETTE } from "../constants.js";

// Одна грузовая единица (50 кг): поддон с ящиком. Единицы ставятся друг на
// друга в «башню» — так погрузчик берёт за рейс сразу несколько.
const PALLET_SIZE = 1.7;
const PALLET_HEIGHT = 0.35;
const CRATE_SIZE = 1.5;
const CRATE_HEIGHT = 1.3;

// Шаг по высоте между единицами в башне.
export const CARGO_UNIT_HEIGHT = PALLET_HEIGHT + CRATE_HEIGHT + 0.02;

const palletGeometry = new THREE.BoxGeometry(PALLET_SIZE, PALLET_HEIGHT, PALLET_SIZE);
const crateGeometry = new THREE.BoxGeometry(CRATE_SIZE, CRATE_HEIGHT, CRATE_SIZE);
const strapGeometry = new THREE.BoxGeometry(CRATE_SIZE + 0.04, 0.18, CRATE_SIZE + 0.04);

const palletMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.cargoPallet, flatShading: true, roughness: 0.85 });
const crateMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.cargoCrate, flatShading: true, roughness: 0.6 });
const strapMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.cargoStrap, flatShading: true, roughness: 0.7 });

// Начало координат — центр основания поддона на полу.
export function createCargoUnit() {
  const unit = new THREE.Group();

  const pallet = new THREE.Mesh(palletGeometry, palletMaterial);
  pallet.position.y = PALLET_HEIGHT / 2;

  const crate = new THREE.Mesh(crateGeometry, crateMaterial);
  crate.position.y = PALLET_HEIGHT + CRATE_HEIGHT / 2;

  const strap = new THREE.Mesh(strapGeometry, strapMaterial);
  strap.position.y = PALLET_HEIGHT + CRATE_HEIGHT / 2;

  for (const mesh of [pallet, crate, strap]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    unit.add(mesh);
  }

  return unit;
}
