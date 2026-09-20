// Страховка от наезда погрузчиков друг на друга.
//
// Погрузчики разных ворот работают в разных полосах склада (storageLayout.js) и
// вообще не встречаются, а внутри полосы работает один погрузчик, так что на деле
// это правило не срабатывает. Оно остаётся на случай изменений раскладки: корпус
// — два круга вдоль курса, и погрузчик не делает шаг, после которого подойдёт к
// другому ближе, чем позволяют корпуса.
export const BODY_RADIUS = 1.65;
const BODY_OFFSETS = [-0.85, 0.85];

function bodyCircles(pose) {
  const fx = Math.sin(pose.heading);
  const fz = Math.cos(pose.heading);

  return BODY_OFFSETS.map((offset) => ({ x: pose.x + fx * offset, z: pose.z + fz * offset }));
}

// Расстояние между центрами ближайших кругов двух корпусов.
function bodyDistance(a, b) {
  let best = Infinity;

  for (const ca of bodyCircles(a)) {
    for (const cb of bodyCircles(b)) {
      best = Math.min(best, Math.hypot(ca.x - cb.x, ca.z - cb.z));
    }
  }

  return best;
}

// Возвращает погрузчика, из-за которого нельзя перейти из позы me в позу next
// (иначе null). Приближаться к другому ближе допустимого нельзя, удаляться можно.
export function findBlocker(me, next, others) {
  const limit = 2 * BODY_RADIUS;

  for (const other of others) {
    if (other === me) continue;

    const after = bodyDistance(next, other);
    if (after < limit && after < bodyDistance(me, other)) return other;
  }

  return null;
}
