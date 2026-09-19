// Геометрия склада, общая для 3D-сцены (WarehouseScene) и экономического
// адаптера (warehouseAdapter): площадь зоны уборки должна совпадать в обоих
// местах, иначе расчёт CAPEX/OPEX разъедется с тем, что видно в симуляции.

export const FLOOR = 100;
export const MARGIN = 10;

export const LANE_MIN_X = -FLOOR / 2 + MARGIN;
export const LANE_MAX_X = FLOOR / 2 - MARGIN;

export const Z_MIN = -FLOOR / 2 + 3;
export const Z_MAX = FLOOR / 2 - 3;

export function computeZoneWidths(mode) {
  const usableWidth = LANE_MAX_X - LANE_MIN_X;

  const vacuumActive = mode === "vacuum" || mode === "both";
  const armActive = mode === "arm" || mode === "both";

  // Роборуки стационарны — у них своя полоса с конвейерами. При "both" это
  // правые 45% пола, при "arm" — весь пол.
  const armZoneWidth = armActive ? (mode === "both" ? usableWidth * 0.45 : usableWidth) : 0;
  const zoneSplitX = mode === "both" ? LANE_MIN_X + usableWidth * 0.55 : LANE_MIN_X;

  // Пылесосы мобильны и убирают пол целиком, включая зону роборук — зоны
  // описывают, где стоит стационарное оборудование, а не делят пол физически.
  const vacuumZoneWidth = vacuumActive ? usableWidth : 0;

  const vacuumZoneAreaM2 = Math.round(vacuumZoneWidth * (Z_MAX - Z_MIN));

  return { usableWidth, vacuumZoneWidth, armZoneWidth, zoneSplitX, vacuumZoneAreaM2 };
}
