import * as THREE from "three";
import { FLOOR, MARGIN, WALL_HEIGHT } from "./layout.js";
import { CANVAS_PX, PALETTE, TRAIL_OPACITY } from "./constants.js";
import { applyColorSpace, disposeTree } from "./sceneUtils.js";
import { createWalls } from "./walls.js";

// Расстояние между этажами по высоте: стены + перекрытие (оно как раз ложится
// на верх стен нижнего этажа).
export const FLOOR_PITCH = WALL_HEIGHT + 2;
const SLAB_THICKNESS = 2;

// Материалы и текстуры, общие для всех этажей: пол выглядит одинаково, а роботы
// каждого этажа живут в своей группе и на своём слое следа.
export function createSharedLevelAssets() {
  const floorCanvas = document.createElement("canvas");
  floorCanvas.width = CANVAS_PX;
  floorCanvas.height = CANVAS_PX;

  const floorTexture = new THREE.CanvasTexture(floorCanvas);
  floorTexture.anisotropy = 8;
  applyColorSpace(floorTexture, false);

  return {
    floorCtx: floorCanvas.getContext("2d"),
    floorTexture,
    floorMaterial: new THREE.MeshStandardMaterial({
      map: floorTexture,
      flatShading: true,
      roughness: 0.68,
      metalness: 0.04,
    }),
    slabGeometry: new THREE.BoxGeometry(FLOOR, SLAB_THICKNESS, FLOOR),
    trailGeometry: new THREE.PlaneGeometry(FLOOR, FLOOR),
  };
}

function createTrailLayer() {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_PX;
  canvas.height = CANVAS_PX;

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  applyColorSpace(texture, false);

  return { ctx: canvas.getContext("2d"), texture };
}

// Декоративные ящики вдоль боковых стен; возвращает группу, чтобы их можно было
// убрать (на складе погрузчиков там ворота и проезды).
function addSideCrates(parent) {
  const group = new THREE.Group();
  parent.add(group);

  const crateColors = [PALETTE.crateA, PALETTE.crateB, PALETTE.crateC];

  [-1, 1].forEach((side) => {
    for (let i = 0; i < 5; i++) {
      const h = 3 + ((i * 7) % 5);

      const material = new THREE.MeshStandardMaterial({
        color: crateColors[i % crateColors.length],
        flatShading: true,
        roughness: 0.6,
        metalness: 0.0,
      });

      const crate = new THREE.Mesh(new THREE.BoxGeometry(MARGIN - 3, h, 6), material);
      crate.position.set(side * (FLOOR / 2 - MARGIN / 2), h / 2, -40 + i * 18);
      crate.castShadow = true;
      crate.receiveShadow = true;
      group.add(crate);

      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(MARGIN - 3.05, 0.08, 6.05),
        new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.13, roughness: 0.58, metalness: 0 })
      );
      edge.position.y = h / 2 + 0.05;
      crate.add(edge);
    }
  });

  return group;
}

// Один этаж: перекрытие с полом, слой следа пылесосов, подписи чанков, стены и
// группы роботов. Этаж целиком лежит в group на своей высоте.
//
//   decals — то, что не показываем на «прозрачных» этажах (стены, след, подписи);
//   dispose — освобождает то, что этаж создал сам.
export function createFloorLevel(shared, chunkLabels, index, shape) {
  const group = new THREE.Group();
  group.position.y = index * FLOOR_PITCH;

  const slab = new THREE.Mesh(shared.slabGeometry, shared.floorMaterial);
  slab.position.y = -SLAB_THICKNESS / 2;
  slab.receiveShadow = true;
  group.add(slab);

  // Слой следа: отдельный прозрачный слой поверх пола, чтобы след можно было
  // стереть/растворить для одного робота, не трогая пол.
  const trail = createTrailLayer();
  const trailPlane = new THREE.Mesh(
    shared.trailGeometry,
    new THREE.MeshBasicMaterial({
      map: trail.texture,
      transparent: true,
      opacity: TRAIL_OPACITY,
      depthWrite: false,
      toneMapped: false, // чтобы белый оставался белым, а не серел от tone mapping
    })
  );
  trailPlane.rotation.x = -Math.PI / 2;
  trailPlane.position.y = 0.02;
  group.add(trailPlane);

  const labelPlane = chunkLabels.mesh.clone();
  group.add(labelPlane);

  const crates = addSideCrates(group);

  const walls = createWalls(shape);
  group.add(walls.group);

  const vacuumGroup = new THREE.Group();
  const armGroup = new THREE.Group();
  const loaderGroup = new THREE.Group();
  group.add(vacuumGroup, armGroup, loaderGroup);

  const level = {
    index,
    group,
    walls,
    shape,
    trailCtx: trail.ctx,
    trailTexture: trail.texture,
    vacuumGroup,
    armGroup,
    loaderGroup,
    crates,
    decals: [trailPlane, labelPlane, walls.group],
    // Состояние симуляции этого этажа (заполняет WarehouseScene).
    grid: new Uint8Array(FLOOR * FLOOR),
    vacuumFleet: null,
    armFleet: null,
    loaderSystem: null,

    // Общие геометрии, материал пола и подписи чанков принадлежат сцене; здесь —
    // только своё: слой следа, ящики и стены.
    dispose() {
      trail.texture.dispose();
      trailPlane.material.dispose();
      disposeTree(crates);
      disposeTree(walls.group);
    },
  };

  return level;
}

// Стены живут по этажам (у каждого своя group), а форма склада — общая на все
// этажи и меняется реже, чем что-либо ещё, поэтому setLevelCount (sceneSetup.js)
// не пересоздаёт этажи целиком при смене формы — только стены, через эту
// функцию, когда shape действительно изменился (сравнение по ссылке).
export function rebuildLevelWalls(level, shape) {
  if (level.shape === shape) return;

  const decalIndex = level.decals.indexOf(level.walls.group);
  level.group.remove(level.walls.group);
  disposeTree(level.walls.group);

  const walls = createWalls(shape);
  level.group.add(walls.group);
  if (decalIndex >= 0) level.decals[decalIndex] = walls.group;

  level.walls = walls;
  level.shape = shape;
}
