import * as THREE from "three";
import { VACUUM_SWATH } from "./constants.js";

// Делит зону уборки zone {xMin, width, zMin, zMax} на count примерно квадратных
// участков — по одному на пылесос. (Не путать с чанками пола из chunkGrid.js:
// чанки — подписанная сетка пола, участок — то, что убирает один робот.)
export function computeSectors(count, zone) {
  const zoneLength = zone.zMax - zone.zMin;
  const cols = Math.max(1, Math.round(Math.sqrt((count * zone.width) / zoneLength)));
  const fullRows = Math.floor(count / cols);
  const remainder = count - fullRows * cols;
  const totalRows = fullRows + (remainder > 0 ? 1 : 0);
  const rowHeight = zoneLength / totalRows;

  const sectors = [];

  for (let row = 0; row < totalRows; row++) {
    const colsInRow = row < fullRows ? cols : remainder;
    if (colsInRow <= 0) continue;

    const colWidth = zone.width / colsInRow;

    for (let c = 0; c < colsInRow; c++) {
      sectors.push({
        xMin: zone.xMin + c * colWidth,
        xMax: zone.xMin + (c + 1) * colWidth,
        zMin: zone.zMin + row * rowHeight,
        zMax: zone.zMin + (row + 1) * rowHeight,
        row,
        col: c,
      });
    }
  }

  return sectors;
}

// Ряды прохода пылесоса внутри участка, с шагом VACUUM_SWATH.
export function buildRowCenters(sector) {
  const width = sector.xMax - sector.xMin;
  const numRows = Math.max(1, Math.ceil(width / VACUUM_SWATH));
  const centers = [];

  for (let i = 0; i < numRows; i++) {
    let rx = sector.xMin + VACUUM_SWATH * (i + 0.5);
    if (rx > sector.xMax - VACUUM_SWATH / 2) rx = sector.xMax - VACUUM_SWATH / 2;
    centers.push(rx);
  }

  return centers;
}

export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function applyColorSpace(target, isRenderer) {
  if (isRenderer) {
    target.outputColorSpace = THREE.SRGBColorSpace;
  } else {
    target.colorSpace = THREE.SRGBColorSpace;
  }
}
