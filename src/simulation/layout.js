// Геометрия склада, общая для 3D-сцены (WarehouseScene) и экономического
// адаптера (warehouseAdapter): площадь зоны уборки должна совпадать в обоих
// местах, иначе расчёт CAPEX/OPEX разъедется с тем, что видно в симуляции.
//
// Сцена всегда 100 × 100 условных единиц. Сколько это метров — решает площадь
// помещения (см. chunkGrid.js), здесь только относительная раскладка.

export const FLOOR = 100;
export const MARGIN = 10;

export const LANE_MIN_X = -FLOOR / 2 + MARGIN;
export const LANE_MAX_X = FLOOR / 2 - MARGIN;

export const Z_MIN = -FLOOR / 2 + 3;
// Южнее Z_MAX — полоса зарядных станций пылесосов, в зону уборки она не входит.
export const Z_MAX = FLOOR / 2 - 8;

// Стены. Ворота — в северной стене (z = -FLOOR/2): при стартовом положении
// камеры это дальняя правая стена, проёмы в ней хорошо видны.
export const WALL_HEIGHT = 10;
export const WALL_THICKNESS = 1.2;
export const GATE_XS = [-25, 0, 25];
export const GATE_WIDTH = 12;
export const GATE_HEIGHT = 7.5;

// Зона погрузки — полоса вдоль северной стены (площадки у ворот + места
// хранения). Пылесосы и роборуки работают южнее неё.
export const LOADER_BAND_MAX_Z = -25;

// Роботов одного типа не больше, чем помещается без наложения моделей.
export const MAX_VACUUM_COUNT = 8;
export const MAX_LOADER_COUNT = GATE_XS.length;
const ARM_MIN_SPACING_Z = 21.4; // длина конвейера роборуки с запасом

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

// Раскладка по выбранным типам роботов. robotTypes — массив id из ROBOT_TYPES.
export function computeLayout(robotTypes) {
  const useVacuum = robotTypes.includes("vacuum");
  const useArm = robotTypes.includes("arm");
  const useLoader = robotTypes.includes("loader");

  const usableWidth = LANE_MAX_X - LANE_MIN_X;
  const workZMin = useLoader ? LOADER_BAND_MAX_Z : Z_MIN;
  const workZMax = Z_MAX;

  // Пылесосы мобильны и убирают весь рабочий пол, включая зону роборук — зоны
  // описывают, где стоит стационарное оборудование, а не делят пол физически.
  const vacuumZone = useVacuum
    ? { xMin: LANE_MIN_X, width: usableWidth, zMin: workZMin, zMax: workZMax }
    : null;

  // Роборуки стационарны — у них своя полоса с конвейерами: правые 45% пола,
  // если рядом работают пылесосы, иначе весь пол.
  const armWidth = useVacuum ? usableWidth * 0.45 : usableWidth;
  const armZone = useArm
    ? {
        xMin: useVacuum ? LANE_MIN_X + usableWidth * 0.55 : LANE_MIN_X,
        width: armWidth,
        zMin: workZMin,
        zMax: workZMax,
      }
    : null;

  const loaderBand = useLoader ? { zMin: -FLOOR / 2, zMax: LOADER_BAND_MAX_Z } : null;

  return {
    useVacuum,
    useArm,
    useLoader,
    vacuumZone,
    armZone,
    loaderBand,
    maxArmCount: Math.max(1, Math.floor((workZMax - workZMin) / ARM_MIN_SPACING_Z)),
  };
}

// Площадь зоны уборки в м²: доля пола, которую занимает зона, от заданной
// пользователем площади помещения.
export function computeVacuumZoneAreaM2(layout, floorAreaM2) {
  const zone = layout.vacuumZone;
  if (!zone) return 0;

  return Math.round((floorAreaM2 * zone.width * (zone.zMax - zone.zMin)) / (FLOOR * FLOOR));
}
