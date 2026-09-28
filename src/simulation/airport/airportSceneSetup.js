import * as THREE from "three";
import { PALETTE, ISO_ELEV, SCENE_HEIGHT_PX } from "../constants.js";
import { applyColorSpace, disposeTree } from "../sceneUtils.js";
import { TERMINAL, APRON, DEPOT_CHARGE, RUNWAY, GROUND } from "./airportLayout3D.js";
import { createAirportWalls } from "./airportWalls.js";
import { createGroundTexture, redrawGround } from "./airportGround.js";

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

  // near/far отодвинуты за пределы всей площадки (диагональ GROUND ~185 ед. +
  // CAM_DIST=130, худший случай ~230) — туман не должен ложиться дымкой на
  // перрон/гейты при обычном вращении камеры (жалоба: «пол под пеленой»).
  // Для эффекта «выныривания из тумана» у новых самолётов/фур — отдельная,
  // управляемая анимация прозрачности (createMaterializeFade), не завязанная
  // на дистанцию до камеры.
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x77798f, 280, 460);

  addLights(scene);

  const staticGroup = new THREE.Group();
  const ground = addGround(staticGroup);
  addControlTower(staticGroup);
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

  // preserveDrawingBuffer: снимок сцены (ТЗ 3.7.4) читает canvas по клику вне
  // цикла рендера — без этого флага буфер к тому моменту может быть уже очищен.
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
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
    ground.dispose();
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
    redrawGround: ground.redraw,
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

// Единая канвас-текстура на всю площадку (airportGround.js) вместо плоских
// залитых Mesh без разметки — терминал, перрон со стоянками гейтов и осевой
// линией руления, депо со штриховкой и подписью, сетка чанков. redraw()
// вызывается заново при смене числа гейтов (позиции стоянок меняются).
function addGround(group) {
  const { ctx, texture, width, height } = createGroundTexture();

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND.xMax - GROUND.xMin, GROUND.zMax - GROUND.zMin),
    new THREE.MeshStandardMaterial({ map: texture, flatShading: true, roughness: 0.92 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((GROUND.xMin + GROUND.xMax) / 2, 0, (GROUND.zMin + GROUND.zMax) / 2);
  mesh.receiveShadow = true;
  group.add(mesh);

  const redraw = (gatesCount) => {
    redrawGround(ctx, width, height, gatesCount);
    texture.needsUpdate = true;
  };
  redraw(1);

  return { redraw, dispose: () => texture.dispose() };
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

// Круглая площадка зарядки нарисована на текстуре земли (airportGround.js);
// здесь — только вертикальный маркер (столбик + светодиод), заметный в 3D.
function addChargeStations(group) {
  const mat = new THREE.MeshStandardMaterial({ color: PALETTE.storage, flatShading: true, roughness: 0.6 });
  const ledMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(0x4f9b90), emissiveIntensity: 0.7, flatShading: true });

  const p = DEPOT_CHARGE;
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
// ВАЖНО: полоса строится из BoxGeometry с поворотом только вокруг Y (не
// PlaneGeometry с составным поворотом X+Z) — раньше составной поворот визуально
// разворачивал полосу мимо фактической линии захода самолёта (та всегда честно
// считалась по RUNWAY.x1/z1→x2/z2), из-за чего самолёты «летали вопреки
// полосе». Поворот вокруг одной оси однозначен: локальная +Z (длина бокса)
// совпадает с направлением (dx,dz) при rotation.y = atan2(dx,dz).
function addRunway(group) {
  const dx = RUNWAY.x2 - RUNWAY.x1;
  const dz = RUNWAY.z2 - RUNWAY.z1;
  const length = Math.hypot(dx, dz);
  const yaw = Math.atan2(dx, dz);

  const stripGeometry = new THREE.BoxGeometry(RUNWAY.width, 0.03, length);
  const stripMaterial = new THREE.MeshStandardMaterial({ color: 0x6c6f85, flatShading: true, roughness: 0.9, transparent: true, opacity: 0.75 });
  const strip = new THREE.Mesh(stripGeometry, stripMaterial);
  strip.rotation.y = yaw;
  strip.position.set((RUNWAY.x1 + RUNWAY.x2) / 2, 0.015, (RUNWAY.z1 + RUNWAY.z2) / 2);
  strip.receiveShadow = true;
  group.add(strip);

  // Осевая пунктирная линия — короткие штрихи вдоль всей полосы, чтобы «полоса»
  // читалась как ВПП с одного взгляда, а не как случайная серая лента.
  const dashGeometry = new THREE.BoxGeometry(0.35, 0.02, length / 14);
  const dashMaterial = new THREE.MeshStandardMaterial({ color: 0xf5efe0, flatShading: true, roughness: 0.6 });
  const dashCount = 7;
  for (let i = 0; i < dashCount; i++) {
    const dash = new THREE.Mesh(dashGeometry, dashMaterial);
    const t = (i + 0.5) / dashCount;
    dash.rotation.y = yaw;
    dash.position.set(RUNWAY.x1 + dx * t, 0.03, RUNWAY.z1 + dz * t);
    group.add(dash);
  }

  const runwayGroup = new THREE.Group();
  group.add(runwayGroup);

  return {
    group: runwayGroup,
    dispose: () => {
      stripGeometry.dispose();
      stripMaterial.dispose();
      dashGeometry.dispose();
      dashMaterial.dispose();
    },
  };
}
