import { FLOOR } from "./layout.js";

// Пол разбит на квадратные чанки. Сцена всегда 100 × 100 единиц, поэтому чем
// больше площадь помещения, тем больше метров в одной единице сцены — и тем
// медленнее в ней (визуально) едут роботы с той же реальной скоростью.
//
// Размер чанка подбираем «круглым» (5/10/20/25/50 м), чтобы подписи были
// читаемыми, а чанков на стороне — не больше MAX_CHUNKS_PER_SIDE.
const NICE_CHUNK_SIDES_M = [5, 10, 20, 25, 50];
const MAX_CHUNKS_PER_SIDE = 10;
const MIN_CHUNKS_PER_SIDE = 2;

export function computeFloorChunks(floorAreaM2) {
  const sideM = Math.sqrt(floorAreaM2);

  const targetSideM =
    NICE_CHUNK_SIDES_M.find((side) => sideM / side <= MAX_CHUNKS_PER_SIDE) ??
    NICE_CHUNK_SIDES_M[NICE_CHUNK_SIDES_M.length - 1];

  const perSide = Math.max(MIN_CHUNKS_PER_SIDE, Math.round(sideM / targetSideM));
  const chunkSideM = sideM / perSide;

  return {
    perSide,
    chunkCount: perSide * perSide,
    chunkSideM,
    chunkAreaM2: chunkSideM * chunkSideM,
    chunkSizeUnits: FLOOR / perSide,
    metersPerUnit: sideM / FLOOR,
    // Сколько м² в одной квадратной единице сцены (нужно для скорости пылесосов).
    areaPerUnit2: (sideM / FLOOR) ** 2,
  };
}

function formatNumber(value) {
  const rounded = Math.round(value * 10) / 10;
  return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)).replace(".", ",");
}

// Две строки подписи чанка: размеры и площадь.
export function chunkLabelLines(grid) {
  return [
    `${formatNumber(grid.chunkSideM)} × ${formatNumber(grid.chunkSideM)} м`,
    `${Math.round(grid.chunkAreaM2).toLocaleString("ru-RU")} м²`,
  ];
}
