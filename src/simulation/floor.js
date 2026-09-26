import { FLOOR, GATE_XS, computeArmSlots } from "./layout.js";
import { CANVAS_PX, PALETTE } from "./constants.js";
import { toPx, rectToPx } from "./canvasCoords.js";
import { CELL, cellAt, cellWorldOrigin } from "./shape/shapeTypes.js";
import { isDefaultShape } from "./shape/shapeGeometry.js";
import {
  AISLE_ZS,
  AISLE_HALF_WIDTH,
  ROAD_XS,
  LANE_PITCH,
  SLOT_PITCH,
  DOCK_SLOT_PITCH,
  DOCK_LANES,
  STRIP_WIDTH,
  bayXOf,
  BAY_Z,
  createStorage,
} from "./loaders/storageLayout.js";
import { chargingStationPositions, STATION_PAD_WIDTH, STATION_PAD_DEPTH } from "./vacuums/chargingStations.js";

function fillRect(ctx, rect) {
  ctx.fillRect(rect.x0, rect.z0, rect.x1 - rect.x0, rect.z1 - rect.z0);
}

function strokeRect(ctx, rect) {
  ctx.strokeRect(rect.x0, rect.z0, rect.x1 - rect.x0, rect.z1 - rect.z0);
}

// Площадки роборук — круглые, по одной под каждой роборукой.
function drawArmPads(ctx, armZone, armCount) {
  ctx.fillStyle = PALETTE.pad;

  for (const slot of computeArmSlots(armZone, armCount)) {
    const center = toPx(slot.x, slot.z);

    ctx.beginPath();
    ctx.arc(center.x, center.z, (slot.padRadius / FLOOR) * CANVAS_PX, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Сетка чанков: границы чанков — тонкие линии по всему полу. Размеры чанка
// подписаны отдельно (chunkLabels.js).
function drawChunkGrid(ctx, grid) {
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1.5;

  const step = CANVAS_PX / grid.perSide;

  for (let i = 1; i < grid.perSide; i++) {
    const p = i * step;

    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, CANVAS_PX);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(CANVAS_PX, p);
    ctx.stroke();
  }
}

// Зона погрузки: светлые полосы проездов, площадки у ворот, разметка полос
// хранения и стоянки погрузчиков.
function drawLoaderFloor(ctx, slotsPerLane) {
  const { docks, storageLanes } = createStorage({ slotsPerLane });
  const lastAisleZ = AISLE_ZS[AISLE_ZS.length - 1];

  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (const z of AISLE_ZS) fillRect(ctx, rectToPx(-FLOOR / 2 + 1, FLOOR / 2 - 1, z - AISLE_HALF_WIDTH, z + AISLE_HALF_WIDTH));

  // Границы полос ворот: за каждыми воротами закреплены свои погрузчики.
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 5]);
  for (let i = 0; i < GATE_XS.length - 1; i++) {
    const x = GATE_XS[i] + STRIP_WIDTH / 2;
    const line = rectToPx(x, x, -FLOOR / 2, FLOOR / 2);

    ctx.beginPath();
    ctx.moveTo(line.x0, line.z0);
    ctx.lineTo(line.x0, line.z1);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const x of ROAD_XS) fillRect(ctx, rectToPx(x - AISLE_HALF_WIDTH, x + AISLE_HALF_WIDTH, AISLE_ZS[0], lastAisleZ));

  // Осевая разметка проездов.
  ctx.strokeStyle = "rgba(229,161,63,0.22)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 6]);
  for (const z of AISLE_ZS) {
    const line = rectToPx(-FLOOR / 2 + 1, FLOOR / 2 - 1, z, z);
    ctx.beginPath();
    ctx.moveTo(line.x0, line.z0);
    ctx.lineTo(line.x1, line.z0);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Площадки у ворот.
  ctx.fillStyle = "rgba(229,161,63,0.2)";
  ctx.strokeStyle = PALETTE.dockPad;
  ctx.lineWidth = 2;
  ctx.setLineDash([9, 6]);

  for (const dock of docks) {
    const half = (DOCK_LANES * LANE_PITCH) / 2;
    const zs = dock.lanes[0].slots.map((slot) => slot.z);
    const pad = rectToPx(dock.x - half, dock.x + half, Math.min(...zs) - DOCK_SLOT_PITCH / 2, Math.max(...zs) + DOCK_SLOT_PITCH / 2);
    fillRect(ctx, pad);
    strokeRect(ctx, pad);
  }

  ctx.setLineDash([]);

  // Полосы хранения.
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;

  for (const lane of storageLanes) {
    const zs = lane.slots.map((slot) => slot.z);
    strokeRect(ctx, rectToPx(lane.x - LANE_PITCH / 2 + 0.3, lane.x + LANE_PITCH / 2 - 0.3, Math.min(...zs) - SLOT_PITCH / 2, Math.max(...zs) + SLOT_PITCH / 2));
  }

  // Стоянки погрузчиков.
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  GATE_XS.forEach((_, index) => {
    const x = bayXOf(index);
    strokeRect(ctx, rectToPx(x - 2, x + 2, BAY_Z - 3, BAY_Z + 3));
  });
}

// Площадки зарядных станций пылесосов — зелёные, по одной на робота.
function drawChargingStations(ctx, vacuumCount, laneMinX) {
  ctx.fillStyle = "rgba(79,155,144,0.28)";
  ctx.strokeStyle = "#4F9B90";
  ctx.lineWidth = 2;

  for (const { x, z } of chargingStationPositions(vacuumCount, laneMinX)) {
    const pad = rectToPx(x - STATION_PAD_WIDTH / 2, x + STATION_PAD_WIDTH / 2, z - STATION_PAD_DEPTH / 2, z + STATION_PAD_DEPTH / 2);
    fillRect(ctx, pad);
    strokeRect(ctx, pad);
  }
}

// Зона разгрузки у ворот, недоступная роботам: штриховка с подписью.
function drawRestrictedZone(ctx, zone) {
  const rect = rectToPx(-FLOOR / 2, FLOOR / 2, zone.zMin, zone.zMax);

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x0, rect.z0, rect.x1 - rect.x0, rect.z1 - rect.z0);
  ctx.clip();

  ctx.fillStyle = "rgba(20,20,35,0.35)";
  ctx.fillRect(rect.x0, rect.z0, rect.x1 - rect.x0, rect.z1 - rect.z0);

  ctx.strokeStyle = "rgba(229,161,63,0.35)";
  ctx.lineWidth = 2;

  for (let x = rect.x0 - (rect.z1 - rect.z0); x < rect.x1; x += 16) {
    ctx.beginPath();
    ctx.moveTo(x, rect.z1);
    ctx.lineTo(x + (rect.z1 - rect.z0), rect.z0);
    ctx.stroke();
  }

  ctx.restore();
  ctx.strokeStyle = "rgba(229,161,63,0.6)";
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x0, rect.z0, rect.x1 - rect.x0, rect.z1 - rect.z0);

  ctx.fillStyle = "rgba(255,241,220,0.85)";
  ctx.font = "700 13px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("ЗОНА РАЗГРУЗКИ · недоступна роботам", (rect.x0 + rect.x1) / 2, (rect.z0 + rect.z1) / 2);
}

// Клетки формы за пределами нарисованного контура (EMPTY) закрашиваются
// внешним тоном поверх заливки пола — визуально читается как «снаружи здания».
// На пресете по умолчанию таких клеток нет (весь грид залит FLOOR/GATE), так
// что для него это no-op и картинка не меняется.
function drawExteriorMask(ctx, shape) {
  ctx.fillStyle = PALETTE.exterior;

  for (let gz = 0; gz < shape.gridSize; gz++) {
    for (let gx = 0; gx < shape.gridSize; gx++) {
      if (cellAt(shape, gx, gz) !== CELL.EMPTY) continue;

      const a = cellWorldOrigin(gx, gz);
      const b = cellWorldOrigin(gx + 1, gz + 1);
      fillRect(ctx, rectToPx(a.x, b.x, a.z, b.z));
    }
  }
}

// Клетки-стеллажи, нарисованные в конструкторе формы склада (CELL.RACK) —
// нужен видимый маркер на полу, иначе они физически используются
// (customLoaderFleet.js возит груз именно туда), но визуально неотличимы от
// обычного пола, и пользователь не видит, где на самом деле его стеллажи.
function drawRackCells(ctx, shape) {
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1.5;

  for (let gz = 0; gz < shape.gridSize; gz++) {
    for (let gx = 0; gx < shape.gridSize; gx++) {
      if (cellAt(shape, gx, gz) !== CELL.RACK) continue;

      const a = cellWorldOrigin(gx, gz);
      const b = cellWorldOrigin(gx + 1, gz + 1);
      const outer = rectToPx(a.x, b.x, a.z, b.z);
      const inset = (outer.x1 - outer.x0) * 0.14;
      const rect = { x0: outer.x0 + inset, x1: outer.x1 - inset, z0: outer.z0 + inset, z1: outer.z1 - inset };

      ctx.fillStyle = PALETTE.rack;
      fillRect(ctx, rect);
      strokeRect(ctx, rect);
    }
  }
}

// Статичный слой пола: один цвет по всей площади + площадки роборук + сетка
// чанков + проезды и склад (если есть погрузчики). Покрытие пылесосов на нём не
// рисуется — оно видно только по следу.
//
// Проезды/полосы хранения/парковки погрузчиков (drawLoaderFloor) — формула от
// GATE_XS, рисуются только на пресете по умолчанию; на своей форме склада
// маркеры стеллажей рисует drawRackCells (сама логистика — customLoaderFleet.js,
// упрощённый маршрут без проездов, см. план).
export function drawFloorBase(ctx, { shape, layout, armCount, vacuumCount, chunkGrid, slotsPerLane }) {
  ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);
  ctx.fillStyle = PALETTE.floor;
  ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

  if (shape) drawExteriorMask(ctx, shape);

  if (layout.restrictedZone) drawRestrictedZone(ctx, layout.restrictedZone);
  if (layout.useLoader && (!shape || isDefaultShape(shape))) drawLoaderFloor(ctx, slotsPerLane);
  if (shape && !isDefaultShape(shape)) drawRackCells(ctx, shape);
  if (layout.armZone && armCount > 0) drawArmPads(ctx, layout.armZone, armCount);
  if (layout.useVacuum) drawChargingStations(ctx, vacuumCount, layout.vacuumZone.xMin);

  drawChunkGrid(ctx, chunkGrid);

  ctx.strokeStyle = "rgba(255,255,255,0.13)";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, CANVAS_PX - 3, CANVAS_PX - 3);
}
