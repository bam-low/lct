// Маршрут пылесоса в обход роборук.
//
// Роборуки стоят на месте, поэтому обход планируем заранее: строим граф из точек
// старта и цели и углов роборук (с запасом) и ищем кратчайший путь по прямым, не
// пересекающим роборуки (алгоритм Дейкстры). Одного «отталкивания» от препятствий
// не хватает: у роборуки длинные бока, и робот, упёршийся в такой бок, не находил
// пути вокруг и застревал.
const CORNER_MARGIN = 2.0; // на сколько дальше габарита роборуки лежат путевые точки
const NEAR_MARGIN = 1.2; // запас у роборуки для отрезков, у которых начало или конец совсем рядом с ней
const FLOOR_LIMIT = 46; // путевые точки не выходят за пол

const inflate = (box, margin) => ({
  x0: box.x - box.halfX - margin,
  x1: box.x + box.halfX + margin,
  z0: box.z - box.halfZ - margin,
  z1: box.z + box.halfZ + margin,
});

const inside = (p, r) => p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1;

// Пересекает ли отрезок a→b внутренность прямоугольника (касание — не пересечение).
function segmentCrossesRect(a, b, r) {
  let tMin = 0;
  let tMax = 1;

  for (const [from, delta, lo, hi] of [
    [a.x, b.x - a.x, r.x0, r.x1],
    [a.z, b.z - a.z, r.z0, r.z1],
  ]) {
    if (Math.abs(delta) < 1e-9) {
      if (from <= lo || from >= hi) return false;
    } else {
      const t1 = (lo - from) / delta;
      const t2 = (hi - from) / delta;

      tMin = Math.max(tMin, Math.min(t1, t2));
      tMax = Math.min(tMax, Math.max(t1, t2));
      if (tMin >= tMax - 1e-9) return false;
    }
  }

  return true;
}

// Точки маршрута от from до to (без from; последняя — to).
export function planRoute(from, to, obstacles) {
  if (obstacles.length === 0) return [to];

  const normal = obstacles.map((box) => inflate(box, CORNER_MARGIN));
  const near = obstacles.map((box) => inflate(box, NEAR_MARGIN));

  // Если конец отрезка лежит у роборуки ближе запаса, для этого отрезка запас меньше.
  const blocked = (a, b) =>
    normal.some((rect, i) => {
      const close = inside(a, rect) || inside(b, rect);
      return segmentCrossesRect(a, b, close ? near[i] : rect);
    });

  const nodes = [from, to];

  for (const rect of normal) {
    for (const [x, z] of [
      [rect.x0, rect.z0],
      [rect.x1, rect.z0],
      [rect.x0, rect.z1],
      [rect.x1, rect.z1],
    ]) {
      const corner = { x: Math.max(-FLOOR_LIMIT, Math.min(FLOOR_LIMIT, x)), z: Math.max(-FLOOR_LIMIT, Math.min(FLOOR_LIMIT, z)) };
      if (!normal.some((other) => inside(corner, other))) nodes.push(corner);
    }
  }

  const dist = nodes.map(() => Infinity);
  const previous = nodes.map(() => -1);
  const done = nodes.map(() => false);
  dist[0] = 0;

  for (let step = 0; step < nodes.length; step++) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) {
      if (!done[i] && (u === -1 || dist[i] < dist[u])) u = i;
    }

    if (u === -1 || dist[u] === Infinity || u === 1) break;
    done[u] = true;

    for (let v = 0; v < nodes.length; v++) {
      if (done[v] || blocked(nodes[u], nodes[v])) continue;

      const length = dist[u] + Math.hypot(nodes[u].x - nodes[v].x, nodes[u].z - nodes[v].z);

      if (length < dist[v]) {
        dist[v] = length;
        previous[v] = u;
      }
    }
  }

  if (dist[1] === Infinity) return [to]; // пути нет — едем напрямую, отталкивание справится

  const route = [];
  for (let node = 1; node !== 0 && node !== -1; node = previous[node]) route.unshift(nodes[node]);

  return route;
}
