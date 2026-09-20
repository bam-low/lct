import { FLOOR } from "./layout.js";
import { PX_PER_M } from "./constants.js";

// Мир сцены → пиксели канвас-текстуры пола/следа. Единицы сцены → пиксели:
// один масштаб для обоих слоёв (PX_PER_M), чтобы след точно ложился на пол.
export function toPx(worldX, worldZ) {
  return { x: (worldX + FLOOR / 2) * PX_PER_M, z: (worldZ + FLOOR / 2) * PX_PER_M };
}

// Прямоугольник в мире → прямоугольник в пикселях {x0, x1, z0, z1}.
export function rectToPx(xMin, xMax, zMin, zMax) {
  const a = toPx(xMin, zMin);
  const b = toPx(xMax, zMax);

  return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) };
}
