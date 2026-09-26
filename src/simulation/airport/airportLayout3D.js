// Геометрия 3D-сцены аэропорта — мировые координаты сцены (X — восток, Z — юг),
// тот же масштаб «единица сцены», что у склада (см. simulation/layout.js), но
// схема принципиально другая: терминал с гейтами вдоль перрона и багажной
// сортировкой внутри, а не проходы и стеллажи — поэтому не переиспользуем
// layout.js напрямую, а заводим отдельный набор констант.

// Терминал — здание, гейты стоят на его южной границе (перед перроном).
export const TERMINAL = { xMin: -75, xMax: -5, zMin: -45, zMax: 5 };
export const TERMINAL_HEIGHT = 9;
export const GATE_Z = TERMINAL.zMax;

// Перрон — открытая зона южнее терминала, где стоят гейты и рулят самолёты.
export const APRON = { xMin: TERMINAL.xMin, xMax: TERMINAL.xMax, zMin: GATE_Z, zMax: GATE_Z + 42 };

// Депо транспортировщиков — зона внутри терминала, откуда они везут груз к
// гейтам и куда возвращаются (пол промаркирован другим цветом). Раньше здесь
// была отдельная багажная сортировка — упразднена вместе с процессами
// багажа/уборки (временно остался только один процесс — транспортировка).
export const DEPOT_ZONE = { xMin: -72, xMax: -50, zMin: -42, zMax: -18 };
export const DEPOT_CHARGE = { x: -46, z: -40 };

export const MAX_VISIBLE_GATES = 10;

// Позиции гейтов вдоль южной границы терминала.
export function gatePositions(gatesCount) {
  const count = Math.max(1, Math.min(MAX_VISIBLE_GATES, gatesCount));
  const margin = 8;
  const usable = TERMINAL.xMax - TERMINAL.xMin - margin * 2;
  const step = count > 1 ? usable / (count - 1) : 0;

  return Array.from({ length: count }, (_, i) => ({
    index: i,
    x: TERMINAL.xMin + margin + step * i,
    z: GATE_Z,
  }));
}

// Декоративная ВПП «сбоку на фоне» — короткая и тонкая, с явным отступом
// восточнее перрона (перрон заканчивается на APRON.xMax), чтобы не спорить
// по масштабу с рабочей площадкой (было: полоса длиной с весь аэропорт —
// жалоба пользователя, что самолёты «занимают больше половины места»).
export const RUNWAY = { x1: 26, z1: -28, x2: 50, z2: 6, width: 4 };

export const GROUND = { xMin: TERMINAL.xMin - 10, xMax: RUNWAY.x2 + 12, zMin: TERMINAL.zMin - 10, zMax: APRON.zMax + 10 };
