import { PX_PER_M, VACUUM_SWATH } from "./constants.js";
import { toPx, rectToPx } from "./canvasCoords.js";

// Пиксельный прямоугольник участка на текстуре следа — считается один раз при
// спавне робота и переиспользуется как область клипа при рисовании (чтобы
// скруглённые концы полосы на разворотах не вылезали за границу участка) и как
// область стирания при угасании следа по завершении уборки.
//
// Границы округлены до целых пикселей: с дробными краем клипа и стирания
// оставался бы неполностью стёртый столбец пикселей — тонкая полоска следа между
// соседними участками. Соседние участки делят одну и ту же целую границу.
export function sectorToPixelRect(sector) {
  const rect = rectToPx(sector.xMin, sector.xMax, sector.zMin, sector.zMax);

  return { x0: Math.round(rect.x0), x1: Math.round(rect.x1), z0: Math.round(rect.z0), z1: Math.round(rect.z1) };
}

function clipToRect(ctx, rectPx) {
  ctx.beginPath();
  ctx.rect(rectPx.x0, rectPx.z0, rectPx.x1 - rectPx.x0, rectPx.z1 - rectPx.z0);
  ctx.clip();
}

// След — ровная белая полоса шириной с захват пылесоса. Рисуется непрозрачным
// белым: полупрозрачность задаётся один раз на материале слоя (TRAIL_OPACITY),
// поэтому перекрывающиеся куски полосы не дают ярких пятен на стыках.
// Рисуется только внутри участка робота (clipRectPx) — иначе скруглённые концы
// у разворотов выходят за его границу и не стираются при угасании
// (destination-out бьёт строго по участку).
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
