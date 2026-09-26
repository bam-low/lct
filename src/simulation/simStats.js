// Показатели симуляции для панелей: что считает сцена и как это показывать.

export const EMPTY_VACUUM_STATS = { finished: 0, passes: 0, charging: 0, minSoc: null, cleanedCells: 0, activeSeconds: 0 };

export const EMPTY_LOADER_STATS = {
  phase: "loading",
  cycles: 0,
  storedKg: 0,
  fillPercent: 0,
  dockUnits: 0,
  trucksAtGates: 0,
  trucksWaiting: 0,
  trucksIn: 0,
  trucksOut: 0,
  receivedKg: 0,
  shippedKg: 0,
  movedPerHour: 0,
  receivedPerHour: 0,
  shippedPerHour: 0,
  avgRouteM: 0,
  busyLoaders: 0,
};

// Всё, что сцена отдаёт панелям: показатели выбранного этажа и энергия/время здания.
export const EMPTY_STATS = {
  coverage: 0,
  opsDone: 0,
  simSeconds: 0,
  energyKwh: 0,
  vacuum: EMPTY_VACUUM_STATS,
  loader: EMPTY_LOADER_STATS,
};

// Одинаковы ли два набора показателей (по полям, вложенные — тоже): если да, состояние
// React не обновляем и панели не перерисовываются впустую.
export function sameStats(a, b) {
  return Object.keys(b).every((key) => {
    const x = a[key];
    const y = b[key];

    return x !== null && typeof x === "object" ? sameStats(x, y) : x === y;
  });
}

// Клетки сетки покрытия, помеченные как убранные, — в процентах от клеток зоны.
export function coveragePercent(grid, zoneCells) {
  if (zoneCells <= 0) return 0;

  let total = 0;
  for (let i = 0; i < grid.length; i++) total += grid[i];

  return Math.min(100, (total / zoneCells) * 100);
}

// Снимок показателей: этаж floorIndex (роботы этого этажа) + здание целиком (энергия).
export function readStats(levels, floorIndex, zoneCells, simSeconds) {
  const level = levels[floorIndex] ?? levels[0];
  if (!level) return EMPTY_STATS;

  const meters = levels.flatMap((l) => [l.vacuumFleet, l.armFleet, l.loaderSystem].flatMap((fleet) => fleet?.meters ?? []));

  return {
    coverage: level.vacuumFleet ? coveragePercent(level.grid, zoneCells) : 0,
    opsDone: level.armFleet ? level.armFleet.getOpsDone() : 0,
    simSeconds,
    energyKwh: meters.reduce((sum, meter) => sum + meter.gridKwh, 0),
    vacuum: level.vacuumFleet ? level.vacuumFleet.getStats() : EMPTY_VACUUM_STATS,
    loader: level.loaderSystem ? level.loaderSystem.getStats() : EMPTY_LOADER_STATS,
  };
}

export const ROBOT_TITLES = { vacuum: "пылесосы", arm: "роборуки", loader: "погрузчики" };
export const PHASE_LABELS = {
  loading: "Приёмка груза",
  unloading: "Отгрузка груза",
  mixed: "Приёмка / отгрузка",
  storage: "Роботизированное хранение",
};

export const formatHours = (hours) => `${hours.toLocaleString("ru-RU")} ч`;

export function formatSimTime(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const mm = String(minutes).padStart(2, "0");
  const ss = String(Math.floor(seconds % 60)).padStart(2, "0");

  return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
}
