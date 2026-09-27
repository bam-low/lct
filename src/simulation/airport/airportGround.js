import * as THREE from "three";
import { PALETTE } from "../constants.js";
import { applyColorSpace } from "../sceneUtils.js";
import { TERMINAL, APRON, DEPOT_ZONE, DEPOT_CHARGE, GROUND, TAXI_Z, GATE_STAND_OFFSET_Z } from "./airportLayout3D.js";
import { gatePositions } from "./airportLayout3D.js";

// Канвас-текстура земли аэропорта — по образцу пола склада (floor.js): один
// CanvasTexture на всю площадку вместо плоских залитых Mesh без разметки.
// Раньше терминал/перрон/депо были просто залиты цветом — с воздуха и в
// изометрии это читалось как «пустой серый прямоугольник», без разметки,
// понятной по складу (чанки, полосы движения, зоны). Здесь та же логика:
// перрон получает стоянки гейтов и осевую линию руления, депо — маркировку
// зоны (как «зона разгрузки» склада), сетка чанков — по всей площадке.
const PX_PER_M = 6;

function groundToPx(worldX, worldZ) {
  return { x: (worldX - GROUND.xMin) * PX_PER_M, z: (worldZ - GROUND.zMin) * PX_PER_M };
}

function rectToPx(xMin, xMax, zMin, zMax) {
  const a = groundToPx(xMin, zMin);
  const b = groundToPx(xMax, zMax);
  return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) };
}

function fillRect(ctx, rect) {
  ctx.fillRect(rect.x0, rect.z0, rect.x1 - rect.x0, rect.z1 - rect.z0);
}

function strokeRect(ctx, rect) {
  ctx.strokeRect(rect.x0, rect.z0, rect.x1 - rect.x0, rect.z1 - rect.z0);
}

export function createGroundTexture() {
  const width = Math.round((GROUND.xMax - GROUND.xMin) * PX_PER_M);
  const height = Math.round((GROUND.zMax - GROUND.zMin) * PX_PER_M);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  applyColorSpace(texture, false);

  return { ctx: canvas.getContext("2d"), texture, width, height };
}

function drawChunkGrid(ctx, width, height) {
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;

  const step = 8 * PX_PER_M; // 8м «чанк», как у склада

  for (let x = 0; x <= width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let z = 0; z <= height; z += step) {
    ctx.beginPath();
    ctx.moveTo(0, z);
    ctx.lineTo(width, z);
    ctx.stroke();
  }
}

// Депо транспортировщиков — тот же визуальный язык, что «зона разгрузки»
// склада (floor.js/drawRestrictedZone): штриховка + подписанная рамка,
// вместо просто залитого прозрачным цветом прямоугольника.
function drawDepotZone(ctx) {
  const rect = rectToPx(DEPOT_ZONE.xMin, DEPOT_ZONE.xMax, DEPOT_ZONE.zMin, DEPOT_ZONE.zMax);

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x0, rect.z0, rect.x1 - rect.x0, rect.z1 - rect.z0);
  ctx.clip();

  ctx.fillStyle = "rgba(229,161,63,0.22)";
  fillRect(ctx, rect);

  ctx.strokeStyle = "rgba(229,161,63,0.35)";
  ctx.lineWidth = 2;
  const h = rect.z1 - rect.z0;
  for (let x = rect.x0 - h; x < rect.x1; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, rect.z1);
    ctx.lineTo(x + h, rect.z0);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(229,161,63,0.75)";
  ctx.lineWidth = 2;
  strokeRect(ctx, rect);

  ctx.fillStyle = "rgba(63,65,89,0.9)";
  ctx.font = "700 10px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const cx = (rect.x0 + rect.x1) / 2;
  const cy = (rect.z0 + rect.z1) / 2;
  ctx.fillText("ДЕПО", cx, cy - 7);
  ctx.fillText("ТРАНСПОРТИРОВЩИКОВ", cx, cy + 7);
}

function drawChargePad(ctx) {
  const c = groundToPx(DEPOT_CHARGE.x, DEPOT_CHARGE.z);
  const r = 1.4 * PX_PER_M;

  ctx.fillStyle = "rgba(79,155,144,0.3)";
  ctx.beginPath();
  ctx.arc(c.x, c.z, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#4F9B90";
  ctx.lineWidth = 2;
  ctx.stroke();
}

// Стоянка гейта: пронумерованный круг + короткая пунктирная линия руления к
// осевой линии перрона — гейт перестаёт быть «точкой в пустоте» и читается
// как размеченное место стоянки, как доки склада.
function drawGateStand(ctx, gate, taxiZ) {
  const c = groundToPx(gate.x, gate.z + GATE_STAND_OFFSET_Z);
  const r = 1.5 * PX_PER_M;

  ctx.strokeStyle = "rgba(229,161,63,0.8)";
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.arc(c.x, c.z, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  const lead = groundToPx(gate.x, taxiZ);
  ctx.strokeStyle = "rgba(255,224,168,0.55)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(c.x, c.z + r);
  ctx.lineTo(lead.x, lead.z);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(63,65,89,0.85)";
  ctx.font = "700 11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(gate.index + 1), c.x, c.z);
}

function drawTaxiway(ctx, taxiZ) {
  const line = rectToPx(APRON.xMin, APRON.xMax, taxiZ, taxiZ);
  ctx.strokeStyle = "rgba(255,205,90,0.7)";
  ctx.lineWidth = 2.5;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(line.x0, line.z0);
  ctx.lineTo(line.x1, line.z0);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Полная перерисовка (фон + терминал + перрон + депо + сетка). Гейты
// передаются отдельно — их состав зависит от параметров объекта и меняется
// чаще, чем всё остальное на этой текстуре.
export function redrawGround(ctx, width, height, gatesCount) {
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#C7CBE0";
  fillRect(ctx, { x0: 0, x1: width, z0: 0, z1: height });

  const apronRect = rectToPx(APRON.xMin, APRON.xMax, APRON.zMin, APRON.zMax);
  ctx.fillStyle = "#8992AD";
  fillRect(ctx, apronRect);

  drawTaxiway(ctx, TAXI_Z);
  for (const gate of gatePositions(gatesCount)) drawGateStand(ctx, gate, TAXI_Z);

  const terminalRect = rectToPx(TERMINAL.xMin, TERMINAL.xMax, TERMINAL.zMin, TERMINAL.zMax);
  ctx.fillStyle = PALETTE.floor;
  fillRect(ctx, terminalRect);

  drawDepotZone(ctx);
  drawChargePad(ctx);

  drawChunkGrid(ctx, width, height);

  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 2;
  strokeRect(ctx, terminalRect);
}
