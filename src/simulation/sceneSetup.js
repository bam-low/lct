import * as THREE from "three";
import { FLOOR } from "./layout.js";
import { PALETTE, ISO_ELEV, SCENE_HEIGHT_PX } from "./constants.js";
import { applyColorSpace, disposeTree } from "./sceneUtils.js";
import { createChunkLabelLayer } from "./chunkLabels.js";
import { createFloorLevel, createSharedLevelAssets, FLOOR_PITCH } from "./floorLevel.js";

const CAM_DIST = 108;
const FOCUS_EASE = 0.12;
const TOP_ELEVATION = 1.553; // ~89°: почти строго сверху (строго — вырожденный «вверх» камеры)

// Как выглядят «прозрачные» этажи: полупрозрачный силуэт вместо обычных материалов.
const GHOST_OPACITY = 0.17;

// Единоразовая сборка сцены: свет, основание, камера, рендерер и то, что общее
// для всех этажей. Сами этажи (createFloorLevel) добавляются и убираются по
// мере надобности через setLevelCount.
export function createWarehouseScene(mount) {
  const width = mount.clientWidth;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x77798f, 145, 245);

  addLights(scene);

  const shared = createSharedLevelAssets();
  const chunkLabels = createChunkLabelLayer();
  const beltTexture = createBeltTexture();

  const staticGroup = new THREE.Group(); // основание — не участвует в «прозрачном» проходе
  addBase(staticGroup);
  scene.add(staticGroup);

  const levelsGroup = new THREE.Group();
  scene.add(levelsGroup);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, SCENE_HEIGHT_PX);
  applyColorSpace(renderer, true);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mount.appendChild(renderer.domElement);

  const ghostMaterial = new THREE.MeshStandardMaterial({
    color: 0xd8d0f5,
    transparent: true,
    opacity: GHOST_OPACITY,
    depthWrite: false,
    flatShading: true,
    roughness: 0.8,
  });

  const levels = [];
  // focusZ — куда смотрит камера по оси Z: со складом погрузчиков она смещена к
  // воротам, чтобы фуры на подъезде были в кадре.
  const cameraState = { theta: Math.PI / 4, thetaTarget: Math.PI / 4, zoom: 40, focusY: 0, focusZ: 0, focusZTarget: 0, elevation: ISO_ELEV, elevationTarget: ISO_ELEV };

  const updateCamera = (activeFloor = 0) => {
    const t = cameraState.theta;
    const targetY = activeFloor * FLOOR_PITCH;
    cameraState.focusY += (targetY - cameraState.focusY) * FOCUS_EASE;
    cameraState.focusZ += (cameraState.focusZTarget - cameraState.focusZ) * FOCUS_EASE;
    cameraState.elevation += (cameraState.elevationTarget - cameraState.elevation) * FOCUS_EASE;

    const elevation = cameraState.elevation;

    camera.position.set(
      CAM_DIST * Math.cos(elevation) * Math.sin(t),
      cameraState.focusY + CAM_DIST * Math.sin(elevation),
      cameraState.focusZ + CAM_DIST * Math.cos(elevation) * Math.cos(t)
    );

    camera.lookAt(0, cameraState.focusY, cameraState.focusZ);

    // Стены, ближайшие к камере, растворяются — считаем от того же угла.
    for (const level of levels) level.walls.update(t);
  };

  const applyFrustum = () => {
    const a = mount.clientWidth / SCENE_HEIGHT_PX;
    const hh = cameraState.zoom;

    camera.left = -hh * a;
    camera.right = hh * a;
    camera.top = hh;
    camera.bottom = -hh;
    camera.updateProjectionMatrix();
  };

  // Ровно столько этажей, сколько нужно: лишние убираем, недостающие строим.
  const setLevelCount = (count) => {
    while (levels.length > count) {
      const level = levels.pop();
      levelsGroup.remove(level.group);
      level.dispose();
    }

    while (levels.length < count) {
      const level = createFloorLevel(shared, chunkLabels, levels.length);
      levels.push(level);
      levelsGroup.add(level.group);
    }
  };

  // Активный этаж рисуется как обычно, остальные — полупрозрачными силуэтами:
  // вторым проходом с подменой материала и без стен, следа и подписей.
  const render = (activeFloor) => {
    if (levels.length <= 1) {
      renderer.render(scene, camera);
      return;
    }

    renderer.autoClear = false;
    renderer.clear();

    levels.forEach((level, i) => {
      level.group.visible = i === activeFloor;
    });
    renderer.render(scene, camera);

    levels.forEach((level, i) => {
      level.group.visible = i !== activeFloor;
      level.decals.forEach((decal) => {
        decal.visible = false;
      });
    });
    staticGroup.visible = false;
    scene.overrideMaterial = ghostMaterial;
    renderer.render(scene, camera);

    scene.overrideMaterial = null;
    staticGroup.visible = true;
    levels.forEach((level) => {
      level.group.visible = true;
      level.decals.forEach((decal) => {
        decal.visible = true;
      });
    });
    renderer.autoClear = true;
  };

  updateCamera();
  applyFrustum();

  const onResize = () => {
    renderer.setSize(mount.clientWidth, SCENE_HEIGHT_PX);
    applyFrustum();
  };

  window.addEventListener("resize", onResize);

  const dispose = (raf) => {
    window.removeEventListener("resize", onResize);
    cancelAnimationFrame(raf);
    setLevelCount(0);
    renderer.dispose();
    chunkLabels.dispose();
    ghostMaterial.dispose();
    beltTexture.dispose();
    disposeTree(staticGroup);

    shared.floorTexture.dispose();
    shared.floorMaterial.dispose();
    shared.slabGeometry.dispose();
    shared.trailGeometry.dispose();

    if (renderer.domElement.parentNode === mount) {
      mount.removeChild(renderer.domElement);
    }
  };

  return {
    scene,
    renderer,
    camera,
    levels,
    TOP_ELEVATION,
    floorCtx: shared.floorCtx,
    floorTexture: shared.floorTexture,
    beltTexture,
    chunkLabels,
    cameraState,
    setLevelCount,
    updateCamera,
    applyFrustum,
    render,
    dispose,
  };
}

function addLights(scene) {
  const hemisphereLight = new THREE.HemisphereLight(0xe9e3ff, 0x35384e, 3);
  scene.add(hemisphereLight);

  const ambientLight = new THREE.AmbientLight(0x777b9d, 0.17);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffdca2, 3);
  keyLight.position.set(38, 90, 32);
  keyLight.castShadow = true;
  keyLight.shadow.camera.left = -85;
  keyLight.shadow.camera.right = 85;
  keyLight.shadow.camera.top = 85;
  keyLight.shadow.camera.bottom = -85;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 260;
  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;
  keyLight.shadow.bias = -0.00012;
  keyLight.shadow.normalBias = 0.035;
  keyLight.shadow.radius = 4;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x8498d4, 0.3);
  fillLight.position.set(-45, 48, -42);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffb36f, 0.26);
  rimLight.position.set(-25, 34, 58);
  scene.add(rimLight);
}

// Тёмное основание под самым нижним этажом.
function addBase(group) {
  const floorBase = new THREE.Mesh(
    new THREE.BoxGeometry(FLOOR + 6, 6, FLOOR + 6),
    new THREE.MeshStandardMaterial({ color: 0x27293b, flatShading: true, roughness: 0.92, metalness: 0.0 })
  );
  floorBase.position.y = -5.35;
  floorBase.receiveShadow = true;
  group.add(floorBase);
}

function createBeltTexture() {
  const beltCanvas = document.createElement("canvas");
  beltCanvas.width = 128;
  beltCanvas.height = 32;

  const bctx = beltCanvas.getContext("2d");
  bctx.fillStyle = PALETTE.belt;
  bctx.fillRect(0, 0, 128, 32);
  bctx.fillStyle = PALETTE.beltStripe;

  for (let i = -32; i < 128; i += 24) {
    bctx.beginPath();
    bctx.moveTo(i, 32);
    bctx.lineTo(i + 12, 0);
    bctx.lineTo(i + 17, 0);
    bctx.lineTo(i + 5, 32);
    bctx.fill();
  }

  const beltTexture = new THREE.CanvasTexture(beltCanvas);
  beltTexture.wrapS = THREE.RepeatWrapping;
  beltTexture.wrapT = THREE.RepeatWrapping;
  beltTexture.repeat.set(3, 1);
  beltTexture.anisotropy = 8;
  applyColorSpace(beltTexture, false);

  return beltTexture;
}
