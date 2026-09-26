import * as THREE from "three";
import { WALL_HEIGHT, WALL_THICKNESS, GATE_HEIGHT } from "./layout.js";
import { PALETTE } from "./constants.js";
import { computeWallSegments } from "./shape/shapeGeometry.js";

// Прозрачность стен, обращённых к камере: почти невидимы, но контур читается.
const NEAR_WALL_OPACITY = 0.06;
const TRIM_THICKNESS = 0.5;
const TRIM_EPS = 0.05; // небольшой вынос окантовки за толщину стены — без z-fighting со сплошными кусками

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function makeMaterial(color) {
  // depthWrite выключен: прозрачные стены не должны «съедать» то, что рисуется
  // за ними (след пылесосов, подписи чанков).
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.85,
    metalness: 0,
    transparent: true,
    depthWrite: false,
  });
}

// Коробка по границам [x0,x1] × [y0,y1] × [z0,z1].
function addBox(group, material, [x0, x1], [y0, y1], [z0, z1]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material);
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  group.add(mesh);
}

const sortAsc = (a, b) => (a < b ? [a, b] : [b, a]);

// Сегмент стены (shapeGeometry.js) описывает протяжённость вдоль границы формы
// (x0..x1 с z0===z1 для north/south, z0..z1 с x0===x1 для west/east) — эта
// функция достаёт из него общую для north/south/west/east ось «вдоль стены»
// (tangential) и координату линии границы вместе с компонентой нормали вдоль
// оси выдавливания толщины стены.
function axesOf(segment) {
  const isRow = segment.z0 === segment.z1; // north/south — линия по z, протяжённость по x
  return {
    isRow,
    tMin: isRow ? segment.x0 : segment.z0,
    tMax: isRow ? segment.x1 : segment.z1,
    lineCoord: isRow ? segment.z0 : segment.x0,
    normalComponent: isRow ? segment.normal[1] : segment.normal[0],
  };
}

// Собирает [x0,x1]/[z0,z1] для addBox из протяжённости вдоль стены (tRange) и
// диапазона выдавливания по толщине (extrudeRange), в зависимости от ориентации.
function boxRanges(axes, tRange, extrudeRange) {
  return axes.isRow ? { x: tRange, z: extrudeRange } : { x: extrudeRange, z: tRange };
}

function solidSegment(group, material, segment) {
  const axes = axesOf(segment);
  const extrude = sortAsc(axes.lineCoord, axes.lineCoord + axes.normalComponent * WALL_THICKNESS);
  const { x, z } = boxRanges(axes, [axes.tMin, axes.tMax], extrude);
  addBox(group, material, x, [0, WALL_HEIGHT], z);
}

// Ворота: перемычка над проёмом (во всю высоту стены выше GATE_HEIGHT) + рамка
// (2 стойки + верхняя планка) — тот же приём, что раньше был жёстко зашит
// только для северной стены (buildNorthWall), теперь для любой стороны.
function gateSegment(group, wallMaterial, trimMaterial, segment) {
  const axes = axesOf(segment);
  const extrude = sortAsc(axes.lineCoord, axes.lineCoord + axes.normalComponent * WALL_THICKNESS);
  const trimExtrude = sortAsc(
    axes.lineCoord + axes.normalComponent * (WALL_THICKNESS + TRIM_EPS),
    axes.lineCoord - axes.normalComponent * TRIM_EPS
  );

  const lintel = boxRanges(axes, [axes.tMin, axes.tMax], extrude);
  addBox(group, wallMaterial, lintel.x, [GATE_HEIGHT, WALL_HEIGHT], lintel.z);

  const left = boxRanges(axes, [axes.tMin, axes.tMin + TRIM_THICKNESS], trimExtrude);
  addBox(group, trimMaterial, left.x, [0, GATE_HEIGHT], left.z);

  const right = boxRanges(axes, [axes.tMax - TRIM_THICKNESS, axes.tMax], trimExtrude);
  addBox(group, trimMaterial, right.x, [0, GATE_HEIGHT], right.z);

  const header = boxRanges(axes, [axes.tMin, axes.tMax], trimExtrude);
  addBox(group, trimMaterial, header.x, [GATE_HEIGHT - TRIM_THICKNESS, GATE_HEIGHT], header.z);
}

// Стены по границе формы склада: сегменты из computeWallSegments(shape) —
// сплошные куски и проёмы ворот, для любой формы (не только прямоугольной), с
// тем же приёмом растворения ближних к камере стен, что и раньше. Для пресета
// по умолчанию (buildDefaultShape) сегменты воспроизводят ровно сегодняшнюю
// геометрию — 4 стороны, 5 проёмов в северной.
export function createWalls(shape) {
  const group = new THREE.Group();
  const walls = [];

  for (const segment of computeWallSegments(shape)) {
    const wallMaterial = makeMaterial(PALETTE.wall);
    const materials = [wallMaterial];
    const segmentGroup = new THREE.Group();

    if (segment.hasGate) {
      const trimMaterial = makeMaterial(PALETTE.wallTrim);
      materials.push(trimMaterial);
      gateSegment(segmentGroup, wallMaterial, trimMaterial, segment);
    } else {
      solidSegment(segmentGroup, wallMaterial, segment);
    }

    group.add(segmentGroup);
    walls.push({ normal: segment.normal, materials });
  }

  // theta — угол камеры вокруг склада (тот же, что в sceneSetup.updateCamera).
  const update = (theta) => {
    const cameraX = Math.sin(theta);
    const cameraZ = Math.cos(theta);

    for (const wall of walls) {
      const towardCamera = wall.normal[0] * cameraX + wall.normal[1] * cameraZ;
      const fade = smoothstep(0.02, 0.5, towardCamera);
      const opacity = 1 - fade * (1 - NEAR_WALL_OPACITY);

      for (const material of wall.materials) material.opacity = opacity;
    }
  };

  return { group, update };
}
