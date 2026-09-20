import * as THREE from "three";
import { FLOOR, WALL_HEIGHT, WALL_THICKNESS, GATE_XS, GATE_WIDTH, GATE_HEIGHT } from "./layout.js";
import { PALETTE } from "./constants.js";

// Прозрачность стен, обращённых к камере: почти невидимы, но контур читается.
const NEAR_WALL_OPACITY = 0.06;

const TRIM_THICKNESS = 0.5;

const HALF = FLOOR / 2;
const OUTER = HALF + WALL_THICKNESS; // внешняя грань стены

// Нормаль — куда «смотрит» стена изнутри наружу (x, z). Стена считается
// обращённой к камере, если камера с той же стороны от склада.
const SIDES = {
  north: { normal: [0, -1] },
  south: { normal: [0, 1] },
  west: { normal: [-1, 0] },
  east: { normal: [1, 0] },
};

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

// Северная стена — с проёмами для грузовиков: стена между воротами, перемычка
// над каждым проёмом и жёлтая окантовка проёма.
function buildNorthWall(group, wallMaterial, trimMaterial) {
  const z = [-OUTER, -HALF];
  const gateEdges = GATE_XS.map((x) => [x - GATE_WIDTH / 2, x + GATE_WIDTH / 2]);

  let cursor = -OUTER;
  for (const [left, right] of gateEdges) {
    addBox(group, wallMaterial, [cursor, left], [0, WALL_HEIGHT], z);
    addBox(group, wallMaterial, [left, right], [GATE_HEIGHT, WALL_HEIGHT], z);

    // окантовка: две стойки и верхняя планка проёма
    addBox(group, trimMaterial, [left, left + TRIM_THICKNESS], [0, GATE_HEIGHT], [-OUTER - 0.05, -HALF + 0.05]);
    addBox(group, trimMaterial, [right - TRIM_THICKNESS, right], [0, GATE_HEIGHT], [-OUTER - 0.05, -HALF + 0.05]);
    addBox(group, trimMaterial, [left, right], [GATE_HEIGHT - TRIM_THICKNESS, GATE_HEIGHT], [-OUTER - 0.05, -HALF + 0.05]);

    cursor = right;
  }

  addBox(group, wallMaterial, [cursor, OUTER], [0, WALL_HEIGHT], z);
}

function buildSolidWall(group, material, side) {
  switch (side) {
    case "south":
      addBox(group, material, [-OUTER, OUTER], [0, WALL_HEIGHT], [HALF, OUTER]);
      break;
    case "west":
      addBox(group, material, [-OUTER, -HALF], [0, WALL_HEIGHT], [-HALF, HALF]);
      break;
    case "east":
      addBox(group, material, [HALF, OUTER], [0, WALL_HEIGHT], [-HALF, HALF]);
      break;
    default:
      break;
  }
}

// Четыре стены вокруг склада. У каждой свой материал — так можно независимо
// менять прозрачность: две стены, ближайшие к камере, растворяются, и
// внутренность склада видна целиком (при повороте камеры — соответственно).
export function createWalls() {
  const group = new THREE.Group();
  const walls = [];

  for (const [name, { normal }] of Object.entries(SIDES)) {
    const material = makeMaterial(PALETTE.wall);
    const materials = [material];
    const wallGroup = new THREE.Group();

    if (name === "north") {
      const trimMaterial = makeMaterial(PALETTE.wallTrim);
      materials.push(trimMaterial);
      buildNorthWall(wallGroup, material, trimMaterial);
    } else {
      buildSolidWall(wallGroup, material, name);
    }

    group.add(wallGroup);
    walls.push({ normal, materials });
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
