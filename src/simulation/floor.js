import { FLOOR } from "./layout.js";
import { CANVAS_PX, PALETTE } from "./constants.js";

// Статичный слой пола: один цвет по всей площади (тот же, что раньше был
// только под роборуками) + площадки роборук + лёгкая сетка. Больше не красит
// чанки пылесосов отдельным фоном — покрытие видно только по следу.
export function drawFloorBase(ctx, { armCount, armZoneWidth, zoneSplitX }) {
  ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);
  ctx.fillStyle = PALETTE.floor;
  ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

  if (armZoneWidth > 0) {
    const startPx = ((zoneSplitX + FLOOR / 2) / FLOOR) * CANVAS_PX;
    const widthPx = (armZoneWidth / FLOOR) * CANVAS_PX;
    const centerXpx = startPx + widthPx / 2;
    const spacing = CANVAS_PX / Math.max(1, armCount);

    ctx.fillStyle = PALETTE.pad;

    for (let i = 0; i < armCount; i++) {
      ctx.beginPath();
      ctx.arc(centerXpx, spacing * (i + 0.5), widthPx * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.strokeStyle = "rgba(255,255,255,0.04)";
  ctx.lineWidth = 1;
  const gridStep = CANVAS_PX / 10;

  for (let i = 0; i <= 10; i++) {
    const p = i * gridStep;

    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, CANVAS_PX);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(CANVAS_PX, p);
    ctx.stroke();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.13)";
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, CANVAS_PX - 3, CANVAS_PX - 3);
}
