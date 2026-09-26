import { FLOOR } from "../floorConstants.js";
import { CELL, cellAt, cellWorldOrigin } from "./shapeTypes.js";

// Геометрия, выводимая из нарисованной формы склада: границы, кластеры ворот,
// сегменты стен. Работает на любой форме (не только прямоугольной) — обход
// границ клеток, без диагоналей (пиксель-арт по квадратной сетке).

const DIRECTIONS = [
  { key: "north", dgx: 0, dgz: -1, normal: [0, -1] },
  { key: "south", dgx: 0, dgz: 1, normal: [0, 1] },
  { key: "west", dgx: -1, dgz: 0, normal: [-1, 0] },
  { key: "east", dgx: 1, dgz: 0, normal: [1, 0] },
];

function isInterior(shape, gx, gz) {
  return cellAt(shape, gx, gz) !== CELL.EMPTY;
}

// Мировые границы залитых (не EMPTY) клеток. Для buildDefaultShape() это ровно
// {xMin:-50,xMax:50,zMin:-50,zMax:50} — сегодняшний FLOOR.
export function boundingBoxOf(shape) {
  let minGx = Infinity;
  let maxGx = -Infinity;
  let minGz = Infinity;
  let maxGz = -Infinity;

  for (let gz = 0; gz < shape.gridSize; gz++) {
    for (let gx = 0; gx < shape.gridSize; gx++) {
      if (!isInterior(shape, gx, gz)) continue;
      if (gx < minGx) minGx = gx;
      if (gx > maxGx) maxGx = gx;
      if (gz < minGz) minGz = gz;
      if (gz > maxGz) maxGz = gz;
    }
  }

  if (minGx === Infinity) return { xMin: -FLOOR / 2, xMax: FLOOR / 2, zMin: -FLOOR / 2, zMax: FLOOR / 2 };

  const a = cellWorldOrigin(minGx, minGz);
  const b = cellWorldOrigin(maxGx + 1, maxGz + 1);
  return { xMin: a.x, xMax: b.x, zMin: a.z, zMax: b.z };
}

// Связные (4-связность) группы клеток GATE, каждая обязана касаться границы
// формы (иметь хотя бы одну грань к EMPTY/за пределами сетки) — иначе это не
// настоящие ворота, а стеллаж/пол, помеченные по ошибке, и в кластер не берутся.
export function computeGateClusters(shape) {
  const visited = new Uint8Array(shape.gridSize * shape.gridSize);
  const clusters = [];
  let nextId = 0;

  for (let gz = 0; gz < shape.gridSize; gz++) {
    for (let gx = 0; gx < shape.gridSize; gx++) {
      const idx = gz * shape.gridSize + gx;
      if (visited[idx] || cellAt(shape, gx, gz) !== CELL.GATE) continue;

      const cells = [];
      const exposedCount = { north: 0, south: 0, west: 0, east: 0 };
      const stack = [[gx, gz]];
      visited[idx] = 1;

      while (stack.length) {
        const [cx, cz] = stack.pop();
        cells.push({ gx: cx, gz: cz });

        for (const { key, dgx, dgz } of DIRECTIONS) {
          const nx = cx + dgx;
          const nz = cz + dgz;

          if (!isInterior(shape, nx, nz)) {
            exposedCount[key]++;
            continue;
          }

          const nIdx = nz * shape.gridSize + nx;
          if (cellAt(shape, nx, nz) === CELL.GATE && !visited[nIdx]) {
            visited[nIdx] = 1;
            stack.push([nx, nz]);
          }
        }
      }

      const boundarySide = Object.entries(exposedCount).sort((a, b) => b[1] - a[1])[0][0];
      if (exposedCount[boundarySide] === 0) continue; // не касается границы — не настоящие ворота

      const normal = DIRECTIONS.find((d) => d.key === boundarySide).normal;
      const worldCells = cells.map(({ gx: cx, gz: cz }) => cellWorldOrigin(cx, cz));
      const centerX = worldCells.reduce((sum, p) => sum + p.x, 0) / worldCells.length + shape.cellSize / 2;
      const centerZ = worldCells.reduce((sum, p) => sum + p.z, 0) / worldCells.length + shape.cellSize / 2;

      const tangential = boundarySide === "north" || boundarySide === "south" ? worldCells.map((p) => p.x) : worldCells.map((p) => p.z);

      clusters.push({
        id: nextId++,
        cells,
        boundarySide,
        normal,
        worldCenter: { x: centerX, z: centerZ },
        worldSpan: { min: Math.min(...tangential), max: Math.max(...tangential) + shape.cellSize },
      });
    }
  }

  return clusters;
}

// Список сегментов стен вдоль границы формы: {normal:[nx,nz], hasGate, x0,x1,z0,z1}.
// Для north/south — x0<x1 (протяжённость вдоль стены), z0===z1 (мировая линия
// границы, до выдавливания по толщине — этим занимается walls.js). Для
// west/east — наоборот. Готовые "куски" мержатся вдоль каждой линии границы в
// прямые прогоны одного типа (сплошной/ворота), как сегодняшний buildNorthWall,
// но обобщённо для любой линии и любой стороны.
export function computeWallSegments(shape) {
  const segments = [];

  // north/south: построчный обход, прогоны вдоль gx на каждой границе-строке gz.
  collectRuns(shape, "north", segments);
  collectRuns(shape, "south", segments);
  collectRuns(shape, "west", segments);
  collectRuns(shape, "east", segments);

  return segments;
}

// Собирает граничные грани для одной стороны (north/south/west/east) построчно
// и мержит соседние клетки одного типа (ворота/сплошная) в прогоны.
function collectRuns(shape, side, out) {
  const { dgx, dgz, normal } = DIRECTIONS.find((d) => d.key === side);
  const cellSize = shape.cellSize;
  const worldOf = (index) => -FLOOR / 2 + index * cellSize;

  // north/south — построчно по gz (линия — верх/низ строки), прогон вдоль gx.
  // west/east — по столбцам gx (линия — левая/правая грань столбца), прогон вдоль gz.
  const lineIsRow = side === "north" || side === "south";
  const lineCount = shape.gridSize;
  const tangentialCount = shape.gridSize;

  for (let line = 0; line < lineCount; line++) {
    let run = null; // {start, end, isGate}

    for (let t = 0; t <= tangentialCount; t++) {
      const gx = lineIsRow ? t : line;
      const gz = lineIsRow ? line : t;
      const isBoundary = t < tangentialCount && isInterior(shape, gx, gz) && !isInterior(shape, gx + dgx, gz + dgz);
      const isGate = isBoundary && cellAt(shape, gx, gz) === CELL.GATE;

      if (isBoundary && run && run.isGate === isGate) {
        run.end = t;
        continue;
      }

      if (run) out.push(finalizeRun(run, side, normal, line, worldOf));
      run = isBoundary ? { start: t, end: t, isGate } : null;
    }
  }
}

function finalizeRun(run, side, normal, line, worldOf) {
  // Линия границы (до выдавливания толщины стены) — верх/низ строки для
  // north/south, левая/правая грань столбца для west/east.
  const lineWorld = worldOf(side === "north" || side === "west" ? line : line + 1);
  const t0 = worldOf(run.start);
  const t1 = worldOf(run.end + 1);

  const isRow = side === "north" || side === "south";
  return isRow
    ? { normal, hasGate: run.isGate, x0: t0, x1: t1, z0: lineWorld, z1: lineWorld }
    : { normal, hasGate: run.isGate, x0: lineWorld, x1: lineWorld, z0: t0, z1: t1 };
}

export function isDefaultShape(shape) {
  return !!shape?.isDefault;
}
