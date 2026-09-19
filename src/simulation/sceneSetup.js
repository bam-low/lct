import * as THREE from "three";
import { FLOOR, MARGIN } from "./layout.js";
import { CANVAS_PX, PALETTE, ISO_ELEV, TRAIL_OPACITY } from "./constants.js";
import { applyColorSpace } from "./sceneUtils.js";

const CAM_DIST = 108;
const CANVAS_HEIGHT = 460;

// Единоразовая сборка сцены: свет, пол (два слоя — статичный + след),
// стеллажи, камера, рендерер. Возвращает всё, что нужно компоненту, чтобы
// не пересобирать сцену на каждый ре-рендер.
export function createWarehouseScene(mount) {
  const width = mount.clientWidth;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x77798f, 145, 245);

  addLights(scene);

  const floorLayer = createCanvasTexture(CANVAS_PX, CANVAS_PX);
  const trailLayer = createCanvasTexture(CANVAS_PX, CANVAS_PX);

  addFloor(scene, floorLayer.texture, trailLayer.texture);
  addCrates(scene);

  const beltTexture = createBeltTexture();

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, CANVAS_HEIGHT);
  applyColorSpace(renderer, true);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mount.appendChild(renderer.domElement);

  const vacuumGroup = new THREE.Group();
  const armGroup = new THREE.Group();
  scene.add(vacuumGroup, armGroup);

  const cameraState = { theta: Math.PI / 4, thetaTarget: Math.PI / 4, zoom: 40 };

  const updateCamera = () => {
    const t = cameraState.theta;

    camera.position.set(
      CAM_DIST * Math.cos(ISO_ELEV) * Math.sin(t),
      CAM_DIST * Math.sin(ISO_ELEV),
      CAM_DIST * Math.cos(ISO_ELEV) * Math.cos(t)
    );

    camera.lookAt(0, 0, 0);
  };

  const applyFrustum = () => {
    const a = mount.clientWidth / CANVAS_HEIGHT;
    const hh = cameraState.zoom;

    camera.left = -hh * a;
    camera.right = hh * a;
    camera.top = hh;
    camera.bottom = -hh;
    camera.updateProjectionMatrix();
  };

  updateCamera();
  applyFrustum();

  const onResize = () => {
    renderer.setSize(mount.clientWidth, CANVAS_HEIGHT);
    applyFrustum();
  };

  window.addEventListener("resize", onResize);

  const dispose = (raf) => {
    window.removeEventListener("resize", onResize);
    cancelAnimationFrame(raf);
    renderer.dispose();

    if (renderer.domElement.parentNode === mount) {
      mount.removeChild(renderer.domElement);
    }
  };

  return {
    scene,
    renderer,
    camera,
    floorCtx: floorLayer.ctx,
    floorTexture: floorLayer.texture,
    trailCtx: trailLayer.ctx,
    trailTexture: trailLayer.texture,
    beltTexture,
    vacuumGroup,
    armGroup,
    cameraState,
    updateCamera,
    applyFrustum,
    dispose,
  };
}

function createCanvasTexture(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  applyColorSpace(texture, false);

  return { ctx, texture };
}

function addLights(scene) {
  const hemisphereLight = new THREE.HemisphereLight(0xe9e3ff, 0x35384e, 3);
  scene.add(hemisphereLight);

  const ambientLight = new THREE.AmbientLight(0x777b9d, 0.17);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffdca2, 3);
  keyLight.position.set(38, 90, 32);
  keyLight.castShadow = true;
  keyLight.shadow.camera.left = -70;
  keyLight.shadow.camera.right = 70;
  keyLight.shadow.camera.top = 70;
  keyLight.shadow.camera.bottom = -70;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 230;
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

function addFloor(scene, floorTexture, trailTexture) {
  const floorMaterial = new THREE.MeshStandardMaterial({
    map: floorTexture,
    flatShading: true,
    roughness: 0.68,
    metalness: 0.04,
  });

  const floorTop = new THREE.Mesh(new THREE.BoxGeometry(FLOOR, 2, FLOOR), floorMaterial);
  floorTop.position.y = -1;
  floorTop.receiveShadow = true;
  scene.add(floorTop);

  // Отдельный прозрачный слой поверх пола — на нём рисуется след пылесосов.
  // Раздельный слой нужен, чтобы след можно было стереть/растворить для
  // одного робота, не трогая статичный рисунок пола и площадки роборук.
  const trailMaterial = new THREE.MeshBasicMaterial({
    map: trailTexture,
    transparent: true,
    opacity: TRAIL_OPACITY,
    depthWrite: false,
    toneMapped: false, // чтобы белый оставался белым, а не серел от tone mapping
  });

  const trailPlane = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR, FLOOR), trailMaterial);
  trailPlane.rotation.x = -Math.PI / 2;
  trailPlane.position.y = 0.02;
  scene.add(trailPlane);

  const floorBaseMaterial = new THREE.MeshStandardMaterial({
    color: 0x27293b,
    flatShading: true,
    roughness: 0.92,
    metalness: 0.0,
  });

  const floorBase = new THREE.Mesh(new THREE.BoxGeometry(FLOOR + 6, 6, FLOOR + 6), floorBaseMaterial);
  floorBase.position.y = -5.35;
  floorBase.receiveShadow = true;
  scene.add(floorBase);
}

function addCrates(scene) {
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
      scene.add(crate);

      const edge = new THREE.Mesh(
        new THREE.BoxGeometry(MARGIN - 3.05, 0.08, 6.05),
        new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.13, roughness: 0.58, metalness: 0 })
      );
      edge.position.y = h / 2 + 0.05;
      crate.add(edge);
    }
  });
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
