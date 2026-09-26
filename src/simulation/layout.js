// Геометрия склада, общая для 3D-сцены (WarehouseScene) и экономического
// адаптера (warehouseAdapter): площадь зоны уборки должна совпадать в обоих
// местах, иначе расчёт CAPEX/OPEX разъедется с тем, что видно в симуляции.
//
// Сцена всегда 100 × 100 условных единиц (канва пола/стен не меняет размер —
// произвольная форма склада, нарисованная в конструкторе, просто маскирует
// часть этой канвы, см. shape/). Сколько это метров — решает площадь
// помещения (см. chunkGrid.js), здесь только относительная раскладка.

import { boundingBoxOf, computeGateClusters } from "./shape/shapeGeometry.js";
import { FLOOR } from "./floorConstants.js";

export { FLOOR };
export const MARGIN = 10;

// Ворота пресета по умолчанию — в северной стене (z = -FLOOR/2): при стартовом
// положении камеры это дальняя правая стена, проёмы в ней хорошо видны. Для
// произвольной формы фактические ворота считаются из неё (computeGateClusters
// в computeLayout ниже) — эти константы нужны только пресету по умолчанию и
// коду погрузчиков, который для него не тронут (storageLayout.js/GATE_XS).
export const WALL_HEIGHT = 10;
export const WALL_THICKNESS = 1.2;
export const GATE_XS = [-40, -20, 0, 20, 40];
export const GATE_WIDTH = 12;
export const GATE_HEIGHT = 7.5;

// Роботов одного типа не больше, чем помещается без наложения моделей.
export const MAX_VACUUM_COUNT = 8;
export const MAX_LOADER_COUNT = GATE_XS.length; // пресет по умолчанию; для своей формы — layout.maxLoaderCount
const ARM_ROW_PITCH_MIN = 21.4; // длина конвейера роборуки с запасом
const ARM_COLUMN_PITCH_MIN = 14; // ширина роборуки с конвейерами + проезд пылесоса между колонками
export const MAX_ARM_COUNT = 16;

export const ROBOT_TYPES = ["vacuum", "arm", "loader"];

// Что можно выбрать на первом экране: одна симуляция — один тип робота, плюс
// демонстрационная связка «пылесосы + роборуки».
export const ROBOT_SCENARIOS = [
  { id: "vacuum", label: "🧹 Пылесосы", types: ["vacuum"] },
  { id: "arm", label: "🦾 Роборуки", types: ["arm"] },
  { id: "loader", label: "🚜 Погрузчики", types: ["loader"] },
  { id: "demo", label: "Демо: пылесосы + роборуки", types: ["vacuum", "arm"] },
];

export const DEFAULT_ROBOT_TYPES = ["vacuum", "arm"];

// Сохранённый выбор из старых версий мог содержать другие сочетания —
// принимаем только те, что есть в списке сценариев.
export function normalizeRobotTypes(types) {
  const key = Array.isArray(types) ? types.join(",") : "";
  return ROBOT_SCENARIOS.find((s) => s.types.join(",") === key)?.types ?? DEFAULT_ROBOT_TYPES;
}

// Раскладка по выбранным типам роботов. shape — форма склада (shape/shapeTypes.js,
// buildDefaultShape() для стандартного прямоугольника); robotTypes — массив id
// из ROBOT_TYPES; workZoneShare (0..1) — какая часть пола доступна роботам,
// остальное — участок, где они не работают (оборудование, запретные зоны).
export function computeLayout(shape, robotTypes, workZoneShare = 1) {
  const useVacuum = robotTypes.includes("vacuum");
  const useArm = robotTypes.includes("arm");
  const useLoader = robotTypes.includes("loader");

  // Для пресета по умолчанию bounds — ровно {-50..50, -50..50}, то есть то же
  // самое, что раньше давали константы LANE_MIN_X/LANE_MAX_X/Z_MIN/Z_MAX —
  // отступы (MARGIN, +3, −8) те же, просто считаются от границ формы.
  const bounds = boundingBoxOf(shape);
  const laneMinX = bounds.xMin + MARGIN;
  const laneMaxX = bounds.xMax - MARGIN;
  const zMin = bounds.zMin + 3;
  // Южнее zMax — полоса зарядных станций пылесосов, в зону уборки она не входит.
  const zMax = bounds.zMax - 8;

  const usableWidth = laneMaxX - laneMinX;
  // Роботам доступна южная часть пола; у северной стены (у ворот) — зона разгрузки,
  // куда пылесосы и роборуки не заходят.
  const share = Math.min(1, Math.max(0.3, workZoneShare));
  const workZMin = zMax - (zMax - zMin) * share;
  const workZMax = zMax;

  // Пылесосы мобильны и убирают весь рабочий пол, включая зону роборук — зоны
  // описывают, где стоит стационарное оборудование, а не делят пол физически.
  const vacuumZone = useVacuum
    ? { xMin: laneMinX, width: usableWidth, zMin: workZMin, zMax: workZMax }
    : null;

  // Роборуки стационарны — у них своя полоса с конвейерами: правые 45% пола,
  // если рядом работают пылесосы, иначе весь пол.
  const armWidth = useVacuum ? usableWidth * 0.45 : usableWidth;
  const armZone = useArm
    ? {
        xMin: useVacuum ? laneMinX + usableWidth * 0.55 : laneMinX,
        width: armWidth,
        zMin: workZMin,
        zMax: workZMax,
      }
    : null;

  // Зона разгрузки у ворот, недоступная роботам (рисуется штриховкой).
  const restrictedZone = workZMin > zMin + 0.01 && !useLoader ? { zMin: bounds.zMin, zMax: workZMin } : null;

  const gates = computeGateClusters(shape);

  return {
    useVacuum,
    useArm,
    useLoader,
    restrictedZone,
    vacuumZone,
    armZone,
    maxArmCount: maxArmCountOf(armWidth, workZMax - workZMin),
    maxLoaderCount: Math.max(1, gates.length),
    gates,
    bounds,
  };
}

function maxArmCountOf(zoneWidth, zoneLength) {
  const rows = Math.max(1, Math.floor(zoneLength / ARM_ROW_PITCH_MIN));
  const columns = Math.max(1, Math.floor(zoneWidth / ARM_COLUMN_PITCH_MIN));
  return Math.min(MAX_ARM_COUNT, rows * columns);
}

// Места роборук в зоне. Пока рук не больше, чем помещается в одну линию, они
// стоят в ряд вдоль Z; когда больше — выстраиваются параллельными колонками
// (рук в колонках поровну, внутри колонки — с равным шагом).
export function computeArmSlots(zone, count) {
  const zoneLength = zone.zMax - zone.zMin;
  const rowsMax = Math.max(1, Math.floor(zoneLength / ARM_ROW_PITCH_MIN));
  const columnsMax = Math.max(1, Math.floor(zone.width / ARM_COLUMN_PITCH_MIN));
  const columns = Math.min(columnsMax, Math.max(1, Math.ceil(count / rowsMax)));
  const columnWidth = zone.width / columns;

  const slots = [];

  for (let c = 0; c < columns; c++) {
    const inColumn = Math.floor(count / columns) + (c < count % columns ? 1 : 0);
    const rowSpacing = zoneLength / Math.max(1, inColumn);

    for (let r = 0; r < inColumn; r++) {
      slots.push({
        x: zone.xMin + columnWidth * (c + 0.5),
        z: zone.zMin + rowSpacing * (r + 0.5),
        padRadius: 0.46 * Math.min(columnWidth, rowSpacing),
      });
    }
  }

  return slots;
}

// Площадь зоны уборки в м²: доля пола, которую занимает зона, от заданной
// пользователем площади помещения.
export function computeVacuumZoneAreaM2(layout, floorAreaM2) {
  const zone = layout.vacuumZone;
  if (!zone) return 0;

  return Math.round((floorAreaM2 * zone.width * (zone.zMax - zone.zMin)) / (FLOOR * FLOOR));
}
