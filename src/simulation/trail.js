import { FLOOR } from "./layout.js";
import { PX_PER_M, VACUUM_SWATH } from "./constants.js";

function toPx(worldX, worldZ) {
  return { x: (worldX + FLOOR / 2) * PX_PER_M, z: (worldZ + FLOOR / 2) * PX_PER_M };
}

// Пиксельный прямоугольник чанка на текстуре следа — считается один раз при
// спавне робота и переиспользуется как область клипа при рисовании (чтобы
// скруглённые концы полосы на разворотах не вылезали за границу чанка) и как
// область стирания при угасании следа по завершении уборки.
export function chunkToPixelRect(chunk) {
  const a = toPx(chunk.xMin, chunk.zMin);
  const b = toPx(chunk.xMax, chunk.zMax);
  return { x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) };
}

function clipToRect(ctx, rectPx) {
  ctx.beginPath();
  ctx.rect(rectPx.x0, rectPx.z0, rectPx.x1 - rectPx.x0, rectPx.z1 - rectPx.z0);
  ctx.clip();
}

// След — ровная белая полоса шириной с захват пылесоса. Рисуется непрозрачным
// белым: полупрозрачность задаётся один раз на материале слоя (TRAIL_OPACITY),
// поэтому перекрывающиеся куски полосы не дают ярких пятен на стыках.
// Рисуется только внутри чанка робота (clipRectPx) — иначе скруглённые концы
// у разворотов выходят за его границу и не стираются при угасании
// (destination-out бьёт строго по чанку).
export function drawTrailSegment(ctx, fromWorld, toWorld, clipRectPx) {
  const from = toPx(fromWorld.x, fromWorld.z);
  const to = toPx(toWorld.x, toWorld.z);

  ctx.save();

  if (clipRectPx) {
    clipToRect(ctx, clipRectPx);
  }

  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = VACUUM_SWATH * PX_PER_M;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(from.x, from.z);
  ctx.lineTo(to.x, to.z);
  ctx.stroke();

  ctx.restore();
}

// Сколько реального (не игрового, не зависящего от speedMult) времени, в
// секундах, занимает полное растворение следа после того, как робот закончил.
export const TRAIL_FADE_SECONDS = 1.4;

const FADE_RATE = 3.2; // экспоненциальная скорость растворения

// Постепенно стирает след в пределах прямоугольника через destination-out —
// прозрачность растёт с реальным временем, независимо от FPS. Прямоугольник
// совпадает с областью клипа при рисовании, поэтому стирает без остатка.
export function fadeTrailRect(ctx, rectPx, dt) {
  const alpha = 1 - Math.exp(-FADE_RATE * dt);

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.fillRect(rectPx.x0, rectPx.z0, rectPx.x1 - rectPx.x0, rectPx.z1 - rectPx.z0);
  ctx.restore();
}

// Финальная гарантированная очистка — на случай, если экспоненциальное
// растворение оставило едва заметный остаток.
export function clearTrailRect(ctx, rectPx) {
  ctx.clearRect(rectPx.x0, rectPx.z0, rectPx.x1 - rectPx.x0, rectPx.z1 - rectPx.z0);
}
