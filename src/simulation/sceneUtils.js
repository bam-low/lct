import * as THREE from "three";
import { Z_MIN, Z_MAX } from "./layout.js";
import { VACUUM_SWATH } from "./constants.js";

// Делит зону шириной zoneWidth (начиная с zoneOffsetX) на count примерно
// квадратных чанков — по одному на пылесос.
export function computeChunks(count, zoneWidth, zoneOffsetX) {
  const zoneLength = Z_MAX - Z_MIN;
  const cols = Math.max(1, Math.round(Math.sqrt((count * zoneWidth) / zoneLength)));
  const fullRows = Math.floor(count / cols);
  const remainder = count - fullRows * cols;
  const totalRows = fullRows + (remainder > 0 ? 1 : 0);
  const rowHeight = zoneLength / totalRows;

  const chunks = [];

  for (let row = 0; row < totalRows; row++) {
    const colsInRow = row < fullRows ? cols : remainder;
    if (colsInRow <= 0) continue;

    const colWidth = zoneWidth / colsInRow;

    for (let c = 0; c < colsInRow; c++) {
      chunks.push({
        xMin: zoneOffsetX + c * colWidth,
        xMax: zoneOffsetX + (c + 1) * colWidth,
        zMin: Z_MIN + row * rowHeight,
        zMax: Z_MIN + (row + 1) * rowHeight,
        row,
        col: c,
      });
    }
  }

  return chunks;
}

// Ряды прохода пылесоса внутри чанка, с шагом VACUUM_SWATH.
export function buildRowCenters(chunk) {
  const width = chunk.xMax - chunk.xMin;
  const numRows = Math.max(1, Math.ceil(width / VACUUM_SWATH));
  const centers = [];

  for (let i = 0; i < numRows; i++) {
    let rx = chunk.xMin + VACUUM_SWATH * (i + 0.5);
    if (rx > chunk.xMax - VACUUM_SWATH / 2) rx = chunk.xMax - VACUUM_SWATH / 2;
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
