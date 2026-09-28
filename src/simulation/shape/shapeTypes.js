import { FLOOR } from "../floorConstants.js";

// Клетка формы склада, которую рисует пользователь в конструкторе (пиксель-арт
// по сетке): EMPTY — снаружи здания, FLOOR — пол внутри, GATE — двунаправленные
// ворота пресета по умолчанию (buildDefaultShape — фура и приезжает, и уезжает
// через любые, как и раньше), RACK — стеллаж (только для конструктора «своей»
// формы, у пресета по умолчанию полосы хранения по-прежнему считаются формулой
// storageLayout.js). GATE_IN/GATE_OUT — направленные ворота конструктора «своей»
// формы: на GATE_IN («зона выгрузки») фура привозит груз — робот везёт его от
// ворот к стеллажу; на GATE_OUT («зона загрузки») фура забирает груз — робот
// везёт от стеллажа к воротам (см. customLoaderFleet.js). Раньше «зона
// загрузки»/«зона выгрузки» в редакторе были только двумя кистями для одной и
// той же GATE без разницы в поведении; теперь это по-настоящему разные клетки.
export const CELL = { EMPTY: 0, FLOOR: 1, GATE: 2, RACK: 3, GATE_IN: 4, GATE_OUT: 5 };

export const GRID_SIZE = 25; // клеток на сторону

// Размер клетки в единицах сцены. Подобран так, чтобы пресет по умолчанию
// воспроизводил сегодняшние GATE_XS/GATE_WIDTH побитово точно (см.
// buildDefaultShape) — не менять без пересчёта соответствия.
export const CELL_SIZE = FLOOR / GRID_SIZE;

const HALF_GRID = GRID_SIZE / 2;

// Мировая X/Z координата левого/переднего угла клетки (gx,gz), см. ту же
// систему координат, что canvasCoords.js: origin в (-FLOOR/2, -FLOOR/2).
export function cellWorldOrigin(gx, gz) {
  return { x: -FLOOR / 2 + gx * CELL_SIZE, z: -FLOOR / 2 + gz * CELL_SIZE };
}

export function makeEmptyShape(gridSize = GRID_SIZE) {
  return { gridSize, cellSize: CELL_SIZE, cells: new Uint8Array(gridSize * gridSize) };
}

export function cellAt(shape, gx, gz) {
  if (gx < 0 || gz < 0 || gx >= shape.gridSize || gz >= shape.gridSize) return CELL.EMPTY;
  return shape.cells[gz * shape.gridSize + gx];
}

export function setCellAt(shape, gx, gz, value) {
  if (gx < 0 || gz < 0 || gx >= shape.gridSize || gz >= shape.gridSize) return;
  shape.cells[gz * shape.gridSize + gx] = value;
}

// Пресет по умолчанию: заполненный прямоугольник 100×100 (весь GRID_SIZE×GRID_SIZE)
// с 5 воротами в северном ряду (gz=0) — координаты клеток подобраны так, чтобы
// после computeGateClusters/computeWallSegments (shapeGeometry.js) получилась
// ровно сегодняшняя геометрия: GATE_XS=[-40,-20,0,20,40], GATE_WIDTH=12.
export function buildDefaultShape() {
  const shape = makeEmptyShape();
  shape.cells.fill(CELL.FLOOR);

  const gateColumnGroups = [
    [1, 2, 3],
    [6, 7, 8],
    [11, 12, 13],
    [16, 17, 18],
    [21, 22, 23],
  ];

  for (const columns of gateColumnGroups) {
    for (const gx of columns) setCellAt(shape, gx, 0, CELL.GATE);
  }

  return shape;
}

// Сериализация в/из JSON (Uint8Array не переживает JSON.stringify напрямую) —
// используется useEconomicsState.js при сохранении/загрузке проекта. Форма
// «по умолчанию» определяется структурным сравнением клеток
// (shapeGeometry.js/isDefaultShape), а не отдельным флагом — флаг слишком
// легко потерять или выставить неверно при сохранении/клонировании.
export function serializeShape(shape) {
  return { gridSize: shape.gridSize, cellSize: shape.cellSize, cells: Array.from(shape.cells) };
}

export function deserializeShape(raw) {
  if (!raw || !Array.isArray(raw.cells) || !Number.isFinite(raw.gridSize)) return buildDefaultShape();

  const shape = makeEmptyShape(raw.gridSize);
  shape.cells.set(raw.cells.slice(0, shape.cells.length));
  return shape;
}

export function cloneShape(shape) {
  return { gridSize: shape.gridSize, cellSize: shape.cellSize, cells: shape.cells.slice() };
}

export { HALF_GRID };
