import * as THREE from "three";
import { TERMINAL, TERMINAL_HEIGHT } from "./airportLayout3D.js";
import { PALETTE } from "../constants.js";

// Стены терминала — по образцу walls.js склада: четыре стены вокруг здания,
// каждая растворяется, когда обращена к камере (та же формула fade), поэтому
// с любого ракурса видно, что происходит внутри (багажная сортировка,
// уборщики) — здание перестаёт быть непрозрачным «кубом», как было раньше.
// Крыши нет вовсе (как и у склада) — не нужна ни для вида сверху, ни для
// изометрии, и не блокирует обзор.
const NEAR_WALL_OPACITY = 0.06;
const WALL_THICKNESS = 0.6;

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function makeMaterial(color, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    flatShading: true,
    roughness: 0.8,
    transparent: true,
    depthWrite: false,
    ...extra,
  });
}

function addBox(group, material, [x0, x1], [y0, y1], [z0, z1]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material);
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  group.add(mesh);
}

// Южная стена (к перрону, вдоль гейтов) — почти сплошное остекление с
// переплётами, а не глухая стена: сюда причаливают самолёты и заходит
// перронная спецтехника, поэтому она должна визуально читаться как «вход»,
// а не как продолжение фасада.
function buildGlassWall(group, glassMaterial, mullionMaterial) {
  const w = TERMINAL.xMax - TERMINAL.xMin;
  const glassHeight = TERMINAL_HEIGHT * 0.7;

  addBox(group, glassMaterial, [TERMINAL.xMin, TERMINAL.xMax], [0, glassHeight], [TERMINAL.zMax, TERMINAL.zMax + WALL_THICKNESS]);

  const mullionCount = 16;
  for (let i = 0; i <= mullionCount; i++) {
    const x = TERMINAL.xMin + (w / mullionCount) * i;
    addBox(group, mullionMaterial, [x - 0.06, x + 0.06], [0, glassHeight], [TERMINAL.zMax - 0.02, TERMINAL.zMax + WALL_THICKNESS + 0.02]);
  }

  // Верхняя перемычка над остеклением.
  addBox(group, mullionMaterial, [TERMINAL.xMin, TERMINAL.xMax], [glassHeight, glassHeight + 0.4], [TERMINAL.zMax, TERMINAL.zMax + WALL_THICKNESS]);
}

function buildSolidWall(group, material, side) {
  switch (side) {
    case "north":
      addBox(group, material, [TERMINAL.xMin, TERMINAL.xMax], [0, TERMINAL_HEIGHT], [TERMINAL.zMin - WALL_THICKNESS, TERMINAL.zMin]);
      break;
    case "west":
      addBox(group, material, [TERMINAL.xMin - WALL_THICKNESS, TERMINAL.xMin], [0, TERMINAL_HEIGHT], [TERMINAL.zMin, TERMINAL.zMax]);
      break;
    case "east":
      addBox(group, material, [TERMINAL.xMax, TERMINAL.xMax + WALL_THICKNESS], [0, TERMINAL_HEIGHT], [TERMINAL.zMin, TERMINAL.zMax]);
      break;
    default:
      break;
  }
}

export function createAirportWalls() {
  const group = new THREE.Group();
  const walls = [];

  const sideDefs = {
    north: { normal: [0, -1] },
    south: { normal: [0, 1] },
    west: { normal: [-1, 0] },
    east: { normal: [1, 0] },
  };

  for (const [name, { normal }] of Object.entries(sideDefs)) {
    const wallGroup = new THREE.Group();

    if (name === "south") {
      const glassMaterial = makeMaterial(0x2b3350, { metalness: 0.25, emissive: new THREE.Color(0x3a5691), emissiveIntensity: 0.12 });
      const mullionMaterial = makeMaterial(PALETTE.wallTrim);
      buildGlassWall(wallGroup, glassMaterial, mullionMaterial);
      group.add(wallGroup);
      walls.push({ normal, materials: [glassMaterial, mullionMaterial] });
    } else {
      const material = makeMaterial(PALETTE.wall);
      buildSolidWall(wallGroup, material, name);
      group.add(wallGroup);
      walls.push({ normal, materials: [material] });
    }
  }

  // theta — угол камеры вокруг терминала (тот же смысл, что у cameraState.theta).
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
