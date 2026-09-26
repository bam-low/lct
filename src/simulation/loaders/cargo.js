import * as THREE from "three";
import { PALETTE } from "../constants.js";

// Одна грузовая единица: поддон с ящиком. Размеры ящика берутся из габаритов
// единицы (см), цвет — из SKU: у разных товарных позиций разные цвета (различаются
// первые SKU_COLORS.length). Единицы ставятся друг на друга в два слоя.
const PALLET_HEIGHT = 0.35;
const PALLET_OVERHANG = 0.1; // поддон чуть шире ящика
const UNIT_GAP = 0.02;

// Сантиметры → единицы сцены. Длина единицы идёт поперёк полосы, ширина — вдоль
// неё; пределы — чтобы единица помещалась в полосу (3,8) и в ячейку (2,4).
const CM_TO_XZ = 0.0213;
const CM_TO_Y = 0.013;
const MAX_ACROSS = 3.2;
const MAX_ALONG = 2.2;

export const SKU_COLORS = [0xd9a45b, 0xc85e70, 0x5d9e96, 0x8b78c7, 0xe5a13f, 0x6f9bd1, 0xa3b565, 0xd98a5b];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const palletMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.cargoPallet, flatShading: true, roughness: 0.85 });
const strapMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.cargoStrap, flatShading: true, roughness: 0.7 });
// Негабаритный груз (params.oversizedCargoPct) визуально помечен предупреждающей
// (оранжево-чёрной) обвязкой — он остаётся в общем потоке груза сцены, но заметен
// как единица, которую роботы не берут ни при каком размере парка (см.
// warehouseAdapter.js laborSavingsFractionOf — доля негабарита ограничивает
// экономию труда независимо от пропускной способности).
const oversizedStrapMaterial = new THREE.MeshStandardMaterial({ color: 0xe07a2b, flatShading: true, roughness: 0.6 });
const crateMaterials = SKU_COLORS.map((color) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.6 }));

// Фабрика грузовых единиц под заданные габариты и число SKU. Начало координат
// каждой единицы — центр основания поддона на полу. oversizedSharePct — доля
// единиц, которая рождается визуально помеченной как негабарит (детерминированно
// по счётчику, а не случайно — чтобы доля была стабильной и воспроизводимой между
// перезапусками сцены).
export function createCargoFactory({ lengthCm = 120, widthCm = 80, heightCm = 100, skuCount = 1, oversizedSharePct = 0 } = {}) {
  const across = clamp(lengthCm * CM_TO_XZ, 0.8, MAX_ACROSS);
  const along = clamp(widthCm * CM_TO_XZ, 0.8, MAX_ALONG);
  const crateHeight = clamp(heightCm * CM_TO_Y, 0.4, 2.2);

  const oversizedAcross = clamp(across * 1.2, 0.8, MAX_ACROSS);
  const oversizedAlong = clamp(along * 1.2, 0.8, MAX_ALONG);

  const palletGeometry = new THREE.BoxGeometry(across + PALLET_OVERHANG, PALLET_HEIGHT, along + PALLET_OVERHANG);
  const crateGeometry = new THREE.BoxGeometry(across, crateHeight, along);
  const strapGeometry = new THREE.BoxGeometry(across + 0.04, 0.18, along + 0.04);

  const oversizedPalletGeometry = new THREE.BoxGeometry(oversizedAcross + PALLET_OVERHANG, PALLET_HEIGHT, oversizedAlong + PALLET_OVERHANG);
  const oversizedCrateGeometry = new THREE.BoxGeometry(oversizedAcross, crateHeight, oversizedAlong);
  const oversizedStrapGeometry = new THREE.BoxGeometry(oversizedAcross + 0.04, 0.18, oversizedAlong + 0.04);

  const share = clamp(oversizedSharePct, 0, 100) / 100;
  let counter = 0;
  let oversizedAccumulator = 0;

  // Равномерно распределяет долю share по потоку единиц (накопительный остаток,
  // а не случайность) — так доля негабарита в сцене стабильно совпадает с
  // params.oversizedCargoPct, а не гуляет от прогона к прогону.
  function nextIsOversized() {
    oversizedAccumulator += share;
    if (oversizedAccumulator >= 1) {
      oversizedAccumulator -= 1;
      return true;
    }
    return false;
  }

  return {
    // Геометрии принадлежат фабрике (материалы общие, их не трогаем).
    dispose() {
      palletGeometry.dispose();
      crateGeometry.dispose();
      strapGeometry.dispose();
      oversizedPalletGeometry.dispose();
      oversizedCrateGeometry.dispose();
      oversizedStrapGeometry.dispose();
    },

    // Шаг по высоте между единицами в стопке и глубина поддона вдоль вил —
    // одинаковые для обычных и негабаритных единиц, чтобы раскладка по ячейкам
    // не ломалась (масштаб негабарита выражен только в ширине/длине).
    unitHeight: PALLET_HEIGHT + crateHeight + UNIT_GAP,
    depth: along + PALLET_OVERHANG,

    // sku — номер товарной позиции; без него позиции чередуются по кругу.
    // oversized — форсировать статус явно; без него решает доля oversizedSharePct.
    create(sku = counter++ % Math.max(1, skuCount), oversized = nextIsOversized()) {
      const unit = new THREE.Group();

      const pallet = new THREE.Mesh(oversized ? oversizedPalletGeometry : palletGeometry, palletMaterial);
      pallet.position.y = PALLET_HEIGHT / 2;

      const crate = new THREE.Mesh(oversized ? oversizedCrateGeometry : crateGeometry, crateMaterials[sku % crateMaterials.length]);
      crate.position.y = PALLET_HEIGHT + crateHeight / 2;

      const strap = new THREE.Mesh(
        oversized ? oversizedStrapGeometry : strapGeometry,
        oversized ? oversizedStrapMaterial : strapMaterial
      );
      strap.position.y = PALLET_HEIGHT + crateHeight / 2;

      for (const mesh of [pallet, crate, strap]) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        unit.add(mesh);
      }

      unit.userData.sku = sku;
      unit.userData.oversized = oversized;

      return unit;
    },
  };
}
