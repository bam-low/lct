import { ARM_OBSTACLE_HALF_X, ARM_OBSTACLE_HALF_Z } from "./constants.js";

// Роборуки стационарны, поэтому их препятствия можно посчитать один раз
// при пересборке сцены — из их же положения в группе.
export function computeArmObstacles(arms) {
  return arms.map((a) => ({
    x: a.group.position.x,
    z: a.group.position.z,
    halfX: ARM_OBSTACLE_HALF_X,
    halfZ: ARM_OBSTACLE_HALF_Z,
  }));
}

// Ширина зоны (по Z), на которой манёвр объезда плавно включается/выключается,
// чтобы пылесос не «телепортировался» в сторону у самой границы препятствия.
const DODGE_TRANSITION_Z = 1.2;

// Возвращает X, смещённый в сторону от препятствий на дистанцию clearance,
// если номинальная точка (x, z) в них попадает — иначе возвращает x как есть.
// Логика покрытия/следа продолжает использовать номинальный x; смещённый —
// только для рендера модели и следа, чтобы они визуально не пересекали роборуку.
export function dodgeX(x, z, obstacles, clearance) {
  let result = x;

  for (const ob of obstacles) {
    const padX = ob.halfX + clearance;
    if (Math.abs(x - ob.x) >= padX) continue;

    const outerZ = ob.halfZ + DODGE_TRANSITION_Z;
    const dz = Math.abs(z - ob.z);
    if (dz >= outerZ) continue;

    const side = x >= ob.x ? 1 : -1;
    const targetX = ob.x + side * padX;

    let t = 1;
    if (dz > ob.halfZ) {
      t = 1 - (dz - ob.halfZ) / DODGE_TRANSITION_Z;
    }

    result = x + (targetX - x) * t;
  }

  return result;
}
