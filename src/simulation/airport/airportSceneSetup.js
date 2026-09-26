import * as THREE from "three";
import { PALETTE, ISO_ELEV, SCENE_HEIGHT_PX } from "../constants.js";
import { applyColorSpace, disposeTree } from "../sceneUtils.js";
import { TERMINAL, APRON, DEPOT_ZONE, DEPOT_CHARGE, RUNWAY, GROUND } from "./airportLayout3D.js";
import { createAirportWalls } from "./airportWalls.js";

const CAM_DIST = 130;
const FOCUS_EASE = 0.12;
const TOP_ELEVATION = 1.553;
const QUARTER = Math.PI / 2;

// Единоразовая сборка 3D-сцены аэропорта: свет, статичная геометрия (терминал,
// перрон, багажная сортировка, декоративная ВПП сбоку), камера и рендерер.
// Отдельно от sceneSetup.js склада — та завязана на этажи/стены/чанки пола,
// которых у аэропорта нет (другая схема, не проходы и стеллажи).
export function createAirportScene(mount) {
  const width = mount.clientWidth;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x77798f, 170, 300);

  addLights(scene);

  const staticGroup = new THREE.Group();
  addGround(staticGroup);
  addControlTower(staticGroup);
  addDepotZone(staticGroup);
  addChargeStations(staticGroup);
  const runway = addRunway(staticGroup);
  scene.add(staticGroup);

  // Стены терминала — отдельная группа (не staticGroup): их прозрачность
  // меняется каждый кадр в зависимости от угла камеры (см. airportWalls.js),
  // поэтому им не место среди статичной геометрии, которая никогда не трогается.
  const walls = createAirportWalls();
  scene.add(walls.group);

  const dynamicGroup = new THREE.Group(); // гейты, роботы, самолёты — пересобираются при смене состава парка
  scene.add(dynamicGroup);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 600);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, SCENE_HEIGHT_PX);
  applyColorSpace(renderer, true);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  mount.appendChild(renderer.domElement);

  const focusX = (TERMINAL.xMin + RUNWAY.x2) / 2 - 10;
  const focusZTarget = (TERMINAL.zMin + APRON.zMax) / 2;

  const cameraState = {
    theta: Math.PI / 4,
    thetaTarget: Math.PI / 4,
    zoom: 62,
    focusX,
    focusXTarget: focusX,
    focusZ: focusZTarget,
    focusZTarget,
    elevation: ISO_ELEV,
    elevationTarget: ISO_ELEV,
  };

  const updateCamera = () => {
    cameraState.focusX += (cameraState.focusXTarget - cameraState.focusX) * FOCUS_EASE;
    cameraState.focusZ += (cameraState.focusZTarget - cameraState.focusZ) * FOCUS_EASE;
    cameraState.elevation += (cameraState.elevationTarget - cameraState.elevation) * FOCUS_EASE;

    const elevation = cameraState.elevation;
    const t = cameraState.theta;

    camera.position.set(
      cameraState.focusX + CAM_DIST * Math.cos(elevation) * Math.sin(t),
      CAM_DIST * Math.sin(elevation),
      cameraState.focusZ + CAM_DIST * Math.cos(elevation) * Math.cos(t)
    );

    camera.lookAt(cameraState.focusX, 0, cameraState.focusZ);
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
    disposeTree(staticGroup);
    disposeTree(dynamicGroup);
    disposeTree(walls.group);
    runway.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
  };

  return {
    scene,
    renderer,
    camera,
    dynamicGroup,
    walls,
    TOP_ELEVATION,
    QUARTER,
    cameraState,
    runwayPlanes: runway.group,
    updateCamera,
    applyFrustum,
    render: () => renderer.render(scene, camera),
    dispose,
  };
}

function addLights(scene) {
  const hemisphereLight = new THREE.HemisphereLight(0xe9e3ff, 0x35384e, 3);
  scene.add(hemisphereLight);

  const ambientLight = new THREE.AmbientLight(0x777b9d, 0.17);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xffdca2, 3);
  keyLight.position.set(60, 110, 40);
  keyLight.castShadow = true;
  keyLight.shadow.camera.left = -130;
  keyLight.shadow.camera.right = 130;
  keyLight.shadow.camera.top = 130;
  keyLight.shadow.camera.bottom = -130;
  keyLight.shadow.camera.near = 1;
  keyLight.shadow.camera.far = 320;
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

function addGround(group) {
  const w = GROUND.xMax - GROUND.xMin;
  const d = GROUND.zMax - GROUND.zMin;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({ color: 0xc7cbe0, flatShading: true, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set((GROUND.xMin + GROUND.xMax) / 2, 0, (GROUND.zMin + GROUND.zMax) / 2);
  ground.receiveShadow = true;
  group.add(ground);

  const apronW = APRON.xMax - APRON.xMin;
  const apronD = APRON.zMax - APRON.zMin;
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(apronW, apronD),
    new THREE.MeshStandardMaterial({ color: 0xb7bcd6, flatShading: true, roughness: 0.9 })
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set((APRON.xMin + APRON.xMax) / 2, 0.01, (APRON.zMin + APRON.zMax) / 2);
  apron.receiveShadow = true;
  group.add(apron);
}

// Терминал сам по себе — теперь только стены (airportWalls.js, растворяются
// у камеры, как у склада) без крыши, поэтому внутри всегда видно багажную
// сортировку и уборщиков. Диспетчерская вышка — отдельный, узнаваемый силуэт
// аэропорта рядом с терминалом (жалоба пользователя «какой-то куб, непонятно
// что происходит» — решена и прозрачными стенами, и этим ориентиром).
function addControlTower(group) {
  const towerMat = new THREE.MeshStandardMaterial({ color: PALETTE.storage, flatShading: true, roughness: 0.6 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x2b3350,
    flatShading: true,
    roughness: 0.15,
    metalness: 0.3,
    emissive: new THREE.Color(0x3a5691),
    emissiveIntensity: 0.15,
  });
  const roofMat = new THREE.MeshStandardMaterial({ color: PALETTE.wallTrim, flatShading: true, roughness: 0.6 });

  const towerShaft = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.7, 14, 12), towerMat);
  towerShaft.position.set(TERMINAL.xMin - 6, 7, TERMINAL.zMin + 6);
  towerShaft.castShadow = true;
  group.add(towerShaft);

  const towerCab = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.6, 3, 12), glassMat);
  towerCab.position.set(TERMINAL.xMin - 6, 15.5, TERMINAL.zMin + 6);
  towerCab.castShadow = true;
  group.add(towerCab);

  const towerRoof = new THREE.Mesh(new THREE.ConeGeometry(3.4, 1.2, 12), roofMat);
  towerRoof.position.set(TERMINAL.xMin - 6, 17.6, TERMINAL.zMin + 6);
  group.add(towerRoof);
}

function addDepotZone(group) {
  const w = DEPOT_ZONE.xMax - DEPOT_ZONE.xMin;
  const d = DEPOT_ZONE.zMax - DEPOT_ZONE.zMin;

  const patch = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({ color: PALETTE.crateA, flatShading: true, roughness: 0.85, opacity: 0.7, transparent: true })
  );
  patch.rotation.x = -Math.PI / 2;
  patch.position.set((DEPOT_ZONE.xMin + DEPOT_ZONE.xMax) / 2, 0.02, (DEPOT_ZONE.zMin + DEPOT_ZONE.zMax) / 2);
  patch.receiveShadow = true;
  group.add(patch);
}

function addChargeStations(group) {
  const mat = new THREE.MeshStandardMaterial({ color: PALETTE.storage, flatShading: true, roughness: 0.6 });
  const ledMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(0x4f9b90), emissiveIntensity: 0.7, flatShading: true });

  const p = DEPOT_CHARGE;
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.05, 16), new THREE.MeshStandardMaterial({ color: 0x9be3c2, flatShading: true, roughness: 0.8 }));
  pad.position.set(p.x, 0.03, p.z);
  pad.receiveShadow = true;
  group.add(pad);

  const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3), mat);
  post.position.set(p.x, 0.6, p.z);
  post.castShadow = true;
  group.add(post);

  const led = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 10), ledMat);
  led.position.set(p.x, 1.3, p.z);
  group.add(led);
}

// Декоративная ВПП «сбоку на фоне» — не участвует в расчётах. Возвращает
// group с самолётами-плейсхолдерами, которые useAirportSimulation3D двигает
// по ней (заход на посадку / взлёт), плюс dispose для геометрии полосы.
function addRunway(group) {
  const dx = RUNWAY.x2 - RUNWAY.x1;
  const dz = RUNWAY.z2 - RUNWAY.z1;
  const length = Math.hypot(dx, dz);
  const angle = Math.atan2(dx, dz);

  const stripGeometry = new THREE.PlaneGeometry(RUNWAY.width, length);
  const stripMaterial = new THREE.MeshStandardMaterial({ color: 0xacb0c4, flatShading: true, roughness: 0.9, transparent: true, opacity: 0.4 });
  const strip = new THREE.Mesh(stripGeometry, stripMaterial);
  strip.rotation.x = -Math.PI / 2;
  strip.rotation.z = -angle;
  strip.position.set((RUNWAY.x1 + RUNWAY.x2) / 2, 0.015, (RUNWAY.z1 + RUNWAY.z2) / 2);
  strip.receiveShadow = true;
  group.add(strip);

  const runwayGroup = new THREE.Group();
  group.add(runwayGroup);

  return {
    group: runwayGroup,
    dispose: () => {
      stripGeometry.dispose();
      stripMaterial.dispose();
    },
  };
}
