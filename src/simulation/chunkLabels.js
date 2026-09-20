import * as THREE from "three";
import { FLOOR } from "./layout.js";
import { chunkLabelLines } from "./chunkGrid.js";
import { applyColorSpace } from "./sceneUtils.js";

// Подписи чанков «нарисованы на полу»: один прозрачный слой над полом (ниже
// следа пылесосов и ниже всех моделей), поэтому роботов они не перекрывают, а
// белый след закрывает их так же, как сам пол.
//
// Текст стоит в углу каждого чанка, тёмно-серый (темнее пола) и повёрнут так,
// чтобы читаться с текущей стороны. Камера крутится шагами по 90°, и подписи
// разворачиваются вместе с ней — в момент, когда камера прошла половину шага.
const LAYER_CANVAS_PX = 2048;
const LAYER_Y = 0.012;

const TEXT_COLOR = "rgba(34,36,54,0.78)";

// Размеры в долях стороны чанка.
const FONT_MAIN = 0.11;
const FONT_SUB = 0.085;
const CORNER_INSET = 0.36; // центр подписи от угла чанка

const CAMERA_START_THETA = Math.PI / 4;
const QUARTER = Math.PI / 2;

export function createChunkLabelLayer() {
  const canvas = document.createElement("canvas");
  canvas.width = LAYER_CANVAS_PX;
  canvas.height = LAYER_CANVAS_PX;

  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  applyColorSpace(texture, false);

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR, FLOOR), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = LAYER_Y;

  let grid = null;
  let quarter = null;

  // Сколько четвертей оборота от стартового положения камеры.
  const quarterOf = (theta) => Math.round((theta - CAMERA_START_THETA) / QUARTER);

  function draw() {
    ctx.clearRect(0, 0, LAYER_CANVAS_PX, LAYER_CANVAS_PX);
    if (!grid) return;

    // Направление «от камеры» на полу и связанные с ним оси текста: у канваса
    // ось x — мировой +x, ось y — мировой +z.
    const theta = CAMERA_START_THETA + quarter * QUARTER;
    const awayX = Math.sign(-Math.sin(theta));
    const awayZ = Math.sign(-Math.cos(theta));

    const pxPerUnit = LAYER_CANVAS_PX / FLOOR;
    const chunkPx = grid.chunkSizeUnits * pxPerUnit;
    const lines = chunkLabelLines(grid);

    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let row = 0; row < grid.perSide; row++) {
      for (let col = 0; col < grid.perSide; col++) {
        const centerX = (col + 0.5) * chunkPx;
        const centerY = (row + 0.5) * chunkPx;

        // Центр подписи — на диагонали чанка, ближе к дальнему от камеры углу.
        const offset = (0.5 - CORNER_INSET) * chunkPx;

        ctx.save();
        ctx.translate(centerX + awayX * offset, centerY + awayZ * offset);
        ctx.rotate(-theta); // текст идёт вдоль экранного «вправо»

        ctx.font = `700 ${FONT_MAIN * chunkPx}px sans-serif`;
        ctx.fillText(lines[0], 0, -FONT_MAIN * chunkPx * 0.55);
        ctx.font = `600 ${FONT_SUB * chunkPx}px sans-serif`;
        ctx.fillText(lines[1], 0, FONT_SUB * chunkPx * 0.85);

        ctx.restore();
      }
    }

    texture.needsUpdate = true;
  }

  return {
    mesh,

    // Новая сетка чанков (например, поменяли площадь) — перерисовать всё.
    setGrid(nextGrid, theta) {
      grid = nextGrid;
      quarter = quarterOf(theta);
      draw();
    },

    // Вызывается каждый кадр: перерисовывает только когда камера перешла в
    // другую четверть.
    update(theta) {
      const next = quarterOf(theta);

      if (grid && next !== quarter) {
        quarter = next;
        draw();
      }
    },

    dispose() {
      texture.dispose();
      material.dispose();
      mesh.geometry.dispose();
    },
  };
}
