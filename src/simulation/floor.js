import { FLOOR, GATE_XS } from "./layout.js";
import { CANVAS_PX, PALETTE } from "./constants.js";
import { toPx, rectToPx } from "./canvasCoords.js";
import { PAD_WIDTH, PAD_Z, STORAGE_Z_MIN, STORAGE_Z_MAX, LANE_PITCH, laneXsOfGate } from "./loaders/loaderLayout.js";
import { chargingStationPositions, STATION_PAD_WIDTH, STATION_PAD_DEPTH } from "./vacuums/chargingStations.js";

function fillRect(ctx, rect) {
  ctx.fillRect(rect.x0, rect.z0, rect.x1 - rect.x0, rect.z1 - rect.z0);
}

function strokeRect(ctx, rect) {
  ctx.strokeRect(rect.x0, rect.z0, rect.x1 - rect.x0, rect.z1 - rect.z0);
}

// Площадки роборук — круглые, по одной под каждой роборукой.
function drawArmPads(ctx, armZone, armCount) {
  const center = toPx(armZone.xMin + armZone.width / 2, 0);
  const radiusPx = ((armZone.width / FLOOR) * CANVAS_PX) * 0.32;
  const spacing = (armZone.zMax - armZone.zMin) / armCount;

  ctx.fillStyle = PALETTE.pad;

  for (let i = 0; i < armCount; i++) {
    const { z } = toPx(0, armZone.zMin + spacing * (i + 0.5));

    ctx.beginPath();
    ctx.arc(center.x, z, radiusPx, 0, Math.PI * 2);
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

// Зона погрузки: затемнённая полоса вдоль стены, площадки у ворот и разметка
// полос хранения.
function drawLoaderBand(ctx, band) {
  ctx.fillStyle = "rgba(55,57,79,0.55)";
  fillRect(ctx, rectToPx(-FLOOR / 2, FLOOR / 2, band.zMin, band.zMax));

  ctx.fillStyle = "rgba(229,161,63,0.22)";
  ctx.strokeStyle = PALETTE.dockPad;
  ctx.lineWidth = 2;
  ctx.setLineDash([9, 6]);

  for (const gateX of GATE_XS) {
    const pad = rectToPx(gateX - PAD_WIDTH / 2, gateX + PAD_WIDTH / 2, PAD_Z - 2.6, PAD_Z + 2.4);
    fillRect(ctx, pad);
    strokeRect(ctx, pad);
  }

  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255,255,255,0.13)";
  ctx.lineWidth = 1;

  for (const gateX of GATE_XS) {
    for (const x of laneXsOfGate(gateX)) {
      strokeRect(ctx, rectToPx(x - LANE_PITCH / 2 + 0.3, x + LANE_PITCH / 2 - 0.3, STORAGE_Z_MIN, STORAGE_Z_MAX));
    }
  }
}

// Площадки зарядных станций пылесосов — зелёные, по одной на робота.
function drawChargingStations(ctx, vacuumCount) {
  ctx.fillStyle = "rgba(79,155,144,0.28)";
  ctx.strokeStyle = "#4F9B90";
  ctx.lineWidth = 2;

  for (const { x, z } of chargingStationPositions(vacuumCount)) {
    const pad = rectToPx(x - STATION_PAD_WIDTH / 2, x + STATION_PAD_WIDTH / 2, z - STATION_PAD_DEPTH / 2, z + STATION_PAD_DEPTH / 2);
    fillRect(ctx, pad);
    strokeRect(ctx, pad);
  }
}

// Статичный слой пола: один цвет по всей площади + площадки роборук + сетка
// чанков + зона погрузки (если есть погрузчики). Покрытие пылесосов на нём не
// рисуется — оно видно только по следу.
export function drawFloorBase(ctx, { layout, armCount, vacuumCount, chunkGrid }) {
  ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);
  ctx.fillStyle = PALETTE.floor;
  ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

  if (layout.loaderBand) drawLoaderBand(ctx, layout.loaderBand);
  if (layout.armZone && armCount > 0) drawArmPads(ctx, layout.armZone, armCount);
  if (layout.useVacuum) drawChargingStations(ctx, vacuumCount);

  drawChunkGrid(ctx, chunkGrid);

  ctx.strokeStyle = "rgba(255,255,255,0.13)";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, CANVAS_PX - 3, CANVAS_PX - 3);
}
