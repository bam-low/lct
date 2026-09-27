import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ISO_ELEV, PALETTE } from "../constants.js";
import { disposeTree, createMaterializeFade } from "../sceneUtils.js";
import { createAirportScene } from "./airportSceneSetup.js";
import {
  gatePositions,
  RUNWAY,
  DEPOT_ZONE,
  TERMINAL,
  GATE_Z,
  TAXI_Z,
  GATE_STAND_OFFSET_Z,
  TRANSPORTER_STAND_X_OFFSET,
  TRANSPORTER_STAND_Z_OFFSET,
} from "./airportLayout3D.js";
import { makeTransporterRobot } from "../robots/transporterRobot.js";
import { makeAircraft } from "./robots/aircraftModel.js";
import { createCargoFactory } from "../loaders/cargo.js";

const MAX_FRAME_SECONDS = 0.1;
const STATS_INTERVAL_MS = 150;

// Груз, который транспортировщик привозит из депо, не пропадает молча —
// уезжает по конвейеру к выходу в стене (дальше — сортировка/развоз, за
// кадром). Сама лента не доходит до стены вплотную — заканчивается чуть
// раньше, а в стене на её продолжении — проём-хатч (makeConveyorExit), чтобы
// лента не «протыкала» стену насквозь (жалоба пользователя).
const CONVEYOR_Z = (DEPOT_ZONE.zMin + DEPOT_ZONE.zMax) / 2;
const CONVEYOR_START = { x: DEPOT_ZONE.xMin + 2, z: CONVEYOR_Z };
const CONVEYOR_END = { x: TERMINAL.xMin + 0.6, z: CONVEYOR_Z };
const CONVEYOR_DURATION_S = 1.8;

// Точка, куда транспортировщик подъезжает, чтобы выгрузить груз на ленту —
// рядом с её началом, не на самой ленте.
const CONVEYOR_SERVICE = { x: CONVEYOR_START.x + 1.6, z: CONVEYOR_Z + 1.6 };

const TRANSPORTER_SPEED = 4.5; // ед. сцены/с — единая скорость на всех участках маршрута
const AT_GATE_SECONDS = 2;
const AT_CONVEYOR_SECONDS = 1.2;
const AT_BASE_SECONDS = 1;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function dist(ax, az, bx, bz) {
  return Math.hypot(bx - ax, bz - az);
}

// Кратчайший поворот от a к b (в радианах), а не мгновенный «снап» на целевой
// угол — раньше смена курса при посадка→руление была мгновенной и выглядела
// как разворот поперёк полосы (жалоба пользователя).
function lerpAngle(a, b, t) {
  const twoPi = Math.PI * 2;
  let diff = (b - a) % twoPi;
  if (diff > Math.PI) diff -= twoPi;
  if (diff < -Math.PI) diff += twoPi;
  return a + diff * t;
}

// Курс (rotation.y) для моделей, у которых локальный «нос» смотрит вдоль +Z
// (транспортировщик) — угол, при котором локальная +Z совпадает с
// направлением (dx, dz) в мировых координатах сцены.
function headingZForward(dx, dz) {
  return Math.atan2(dx, dz);
}

// То же самое, но для модели самолёта — её фюзеляж лежит вдоль локальной +X
// (см. aircraftModel.js), поэтому формула другая.
function headingXForward(dx, dz) {
  return Math.atan2(-dz, dx);
}

function depotBaseOf(i) {
  const cols = 6;
  return {
    x: DEPOT_ZONE.xMin + 3 + (i % cols) * 3.6,
    z: DEPOT_ZONE.zMax - 3 - Math.floor(i / cols) * 3.2,
  };
}

// Дверной проём гейта в стене — транспортировщик едет из депо и обратно
// именно через него, а не напрямик через здание (жалоба: «выезжают не пойми
// как»). Место обслуживания борта — сбоку от фюзеляжа (тот стоит по оси
// гейта, см. GATE_STAND_OFFSET_Z), со сдвигом по «полосе» (lane) на бота,
// чтобы несколько транспортировщиков у одного гейта не стояли в одной точке.
function gateDoorOf(gate) {
  return { x: gate.x, z: GATE_Z };
}

function serviceSpotOf(bot, gate) {
  const lane = bot.id % 3;
  return {
    x: gate.x + TRANSPORTER_STAND_X_OFFSET + (lane - 1) * 1.6,
    z: gate.z + GATE_STAND_OFFSET_Z - TRANSPORTER_STAND_Z_OFFSET,
  };
}

// Место ожидания своей очереди у конвейера (жалоба: несколько ботов
// одновременно валили груз в одну точку) — со сдвигом по боту, чтобы
// ожидающие не стояли друг в друге; на разгрузку выезжает только один
// (см. st.entities.conveyorOccupiedBy).
function conveyorWaitSpot(bot) {
  const lane = bot.id % 3;
  return { x: CONVEYOR_SERVICE.x + (lane - 1) * 1.6, z: CONVEYOR_SERVICE.z + 2.2 };
}

// Начинает новый прямолинейный участок маршрута от текущей позиции бота —
// длительность считается от расстояния и единой скорости, поэтому дальние
// гейты едут дольше ближних, а не все за одно и то же время.
function startLeg(bot, to, phase) {
  bot.legFrom = { x: bot.x, z: bot.z };
  bot.legTo = to;
  bot.legDuration = Math.max(0.15, dist(bot.x, bot.z, to.x, to.z) / TRANSPORTER_SPEED);
  bot.phase = phase;
  bot.t = 0;
  bot.mesh.rotation.y = headingZForward(to.x - bot.x, to.z - bot.z);
}

// Продвигает бота по текущему участку; возвращает true, когда участок
// пройден (после этого можно стартовать следующий). Если участок уже пройден
// раньше (например, бот ждёт своей очереди у конвейера), просто держит его в
// конечной точке и продолжает возвращать true каждый кадр — вызывающий код
// сам решает, можно ли уже перейти дальше.
function advanceLeg(bot, dt) {
  bot.t += dt;
  const p = Math.min(1, bot.t / bot.legDuration);
  bot.x = lerp(bot.legFrom.x, bot.legTo.x, p);
  bot.z = lerp(bot.legFrom.z, bot.legTo.z, p);
  bot.mesh.position.set(bot.x, 0, bot.z);
  return p >= 1;
}

// Раздаёт свободных (ещё не назначенных) транспортировщиков занятым гейтам, у
// которых пока нет своего — по одному на гейт, в порядке появления самолётов.
// Пока у гейта нет самолёта, никто к нему не едет; пока все свободные
// транспортировщики разобраны, остальные гейты просто ждут своей очереди
// (по просьбе пользователя: «первый начинает работу, остальные ждут»). Гейт,
// который уже получил своего бота, держит его насовсем — тот и обслуживает
// этот рейс всеми последующими рейсами.
function dispatchTransporters(st) {
  const { gates, transporters } = st.entities;

  for (const gate of gates) {
    if (!gate.occupied || gate.servedBy !== null) continue;

    const idleBot = transporters.find((bot) => bot.phase === "idle");
    if (!idleBot) break;

    gate.servedBy = idleBot.id;
    idleBot.gateIndex = gate.index;
    startLeg(idleBot, gateDoorOf(gate), "toGateDoor");
  }
}

// React ↔ Three.js для аэропорта — 3D как основа (та же изометрия, что у
// склада), с переключением на вид сверху («2D») тем же способом (наклон
// камеры), см. useSimulation.js склада. Временно один процесс —
// транспортировка грузов (реальная модель пользователя, см.
// robots/transporterRobot.js); гейты остаются точками доставки — самолёты
// стоят у них, транспортировщики возят груз туда и обратно из депо.
export function useAirportSimulation3D({
  gatesCount,
  transportCount,
  transportThroughput,
  groundOpsPerFlight,
  running,
  speedMult,
  topView,
  camZoom,
  resetKey,
}) {
  const mountRef = useRef(null);
  const st = useRef({}).current;
  const [stats, setStats] = useState({ opsDone: 0, simSeconds: 0 });

  // --- сцена (один раз) ---
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const created = createAirportScene(mount);
    Object.assign(st, created, { clock: new THREE.Timer(), raf: null, simSeconds: 0, lastPublish: 0, entities: null });

    return () => {
      created.dispose(st.raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- камера: 3D/2D, зум ---
  useEffect(() => {
    if (!st.scene) return;
    st.cameraState.elevationTarget = topView ? st.TOP_ELEVATION : ISO_ELEV;
    st.cameraState.thetaTarget = topView
      ? Math.round(st.cameraState.thetaTarget / (4 * st.QUARTER)) * 4 * st.QUARTER
      : Math.round((st.cameraState.thetaTarget - Math.PI / 4) / st.QUARTER) * st.QUARTER + Math.PI / 4;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topView]);

  useEffect(() => {
    if (!st.scene) return;
    st.cameraState.zoom = camZoom;
    st.applyFrustum();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camZoom]);

  // --- пересборка гейтов/роботов/самолётов при смене состава парка ---
  useEffect(() => {
    if (!st.scene) return;

    disposeDynamicGroup(st.dynamicGroup);
    st.redrawGround(gatesCount);

    // Гейты стартуют пустыми — самолёт появляется, только когда реально
    // «прилетает» и занимает место (см. stepPlanes), а не стоит там с самого
    // начала. Телетрап — часть инфраструктуры терминала, виден всегда.
    const gates = gatePositions(gatesCount).map((pos) => {
      makeJetBridge(pos, st.dynamicGroup);
      return { ...pos, occupied: false, servedBy: null };
    });

    // Груз на платформе — иначе транспортировщик просто ездит туда-сюда без
    // видимой цели. Свежая фабрика на каждую пересборку — её геометрии
    // освобождаются вместе со всей dynamicGroup в disposeDynamicGroup,
    // отдельно диспоузить не нужно.
    const cargoFactory = createCargoFactory({ lengthCm: 90, widthCm: 70, heightCm: 60 });
    makeConveyorBelt(st.dynamicGroup);
    makeConveyorExit(st.dynamicGroup);

    // Все транспортировщики стартуют незанятыми в депо — к гейту едет только
    // тот, кого назначит dispatchTransporters, когда у гейта появится самолёт.
    const transporters = Array.from({ length: Math.min(16, transportCount) }, (_, i) => {
      const base = depotBaseOf(i);
      const robot = makeTransporterRobot();
      robot.group.position.set(base.x, 0, base.z);
      st.dynamicGroup.add(robot.group);
      return {
        id: i,
        phase: "idle",
        t: 0,
        gateIndex: null,
        baseX: base.x,
        baseZ: base.z,
        x: base.x,
        z: base.z,
        legFrom: null,
        legTo: null,
        legDuration: 0,
        mesh: robot.group,
        carry: robot.carry,
        cargoUnit: null,
      };
    });

    st.entities = {
      gates,
      transporters,
      cargoFactory,
      conveyorCargo: [],
      conveyorOccupiedBy: null,
      planes: [],
      nextPlaneIn: 3,
    };
    st.opsDone = 0;
    st.simSeconds = 0;
    setStats({ opsDone: 0, simSeconds: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gatesCount, transportCount, resetKey]);

  // --- покадровый цикл ---
  useEffect(() => {
    if (!st.scene) return;

    const tick = (timestamp) => {
      st.raf = requestAnimationFrame(tick);
      st.clock.update(timestamp);
      const realDt = Math.min(st.clock.getDelta(), MAX_FRAME_SECONDS);

      st.cameraState.theta += (st.cameraState.thetaTarget - st.cameraState.theta) * 0.12;
      st.updateCamera();
      st.walls.update(st.cameraState.theta);

      if (running && st.entities) {
        const dt = realDt * speedMult;
        step(st, dt);

        if (timestamp - st.lastPublish >= STATS_INTERVAL_MS) {
          st.lastPublish = timestamp;
          const hours = st.simSeconds / 3600;
          setStats({ opsDone: hours > 0 ? st.opsDone / hours : 0, simSeconds: st.simSeconds });
        }
      }

      st.render();
    };

    tick(performance.now());
    return () => cancelAnimationFrame(st.raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, speedMult, transportCount, transportThroughput, groundOpsPerFlight]);

  return {
    mountRef,
    stats,
    rotate: (direction) => {
      st.cameraState.thetaTarget += direction * st.QUARTER;
    },
  };
}

// Телетрап: короткий переход от стены терминала к месту стоянки — без него
// самолёты выглядели рядом со зданием случайно, а не пристыкованными к гейту.
// Длина — до нескольких единиц перед носом припаркованного борта (см.
// GATE_STAND_OFFSET_Z), не доходя до фюзеляжа: раньше нос протыкал стену,
// потому что сам борт стоял слишком близко к ней (жалоба пользователя).
function makeJetBridge(pos, group) {
  const material = new THREE.MeshStandardMaterial({ color: 0xd8d3e6, flatShading: true, roughness: 0.55 });
  const length = GATE_STAND_OFFSET_Z - 5;
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.1, length), material);
  bridge.position.set(pos.x, 1.3, TERMINAL.zMax + length / 2);
  bridge.castShadow = true;
  bridge.receiveShadow = true;
  group.add(bridge);
}

// Конвейер, увозящий груз от депо к выходу в стене. Лента статичная (полосы
// имитируют направление), едет по ней сам груз — см. stepConveyor.
function makeConveyorBelt(group) {
  const length = CONVEYOR_START.x - CONVEYOR_END.x;
  const centerX = (CONVEYOR_START.x + CONVEYOR_END.x) / 2;

  const bedMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.belt, flatShading: true, roughness: 0.6 });
  const bed = new THREE.Mesh(new THREE.BoxGeometry(length, 0.3, 1.6), bedMaterial);
  bed.position.set(centerX, 0.15, CONVEYOR_Z);
  bed.castShadow = true;
  bed.receiveShadow = true;
  group.add(bed);

  const stripeMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.beltStripe, flatShading: true, roughness: 0.5 });
  const stripeCount = Math.max(3, Math.round(length / 1.2));
  for (let i = 0; i < stripeCount; i++) {
    const t = (i + 0.5) / stripeCount;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 1.7), stripeMaterial);
    stripe.position.set(CONVEYOR_START.x - length * t, 0.31, CONVEYOR_Z);
    group.add(stripe);
  }

  const railMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.storage, flatShading: true, roughness: 0.6 });
  for (const zOffset of [-0.85, 0.85]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.28, 0.1), railMaterial);
    rail.position.set(centerX, 0.3, CONVEYOR_Z + zOffset);
    group.add(rail);
  }
}

// Проём-выход в стене на продолжении ленты — рамка + тёмный фон (как чёрный
// проём кузова у фуры, см. robots/truckRobot.js), чтобы лента читалась как
// «уходит в проём», а не утыкалась в глухую стену и не протыкала её насквозь
// (жалоба пользователя: раньше геометрия ленты реально выходила за стену).
function makeConveyorExit(group) {
  const wallX = TERMINAL.xMin;

  const frameMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.wallTrim, flatShading: true, roughness: 0.6 });
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.9), frameMaterial);
  frame.position.set(wallX + 0.02, 0.95, CONVEYOR_Z);
  frame.rotation.y = Math.PI / 2;
  group.add(frame);

  const blackMaterial = new THREE.MeshBasicMaterial({ color: 0x14121c, toneMapped: false });
  const black = new THREE.Mesh(new THREE.PlaneGeometry(1.85, 1.5), blackMaterial);
  black.position.set(wallX + 0.04, 0.95, CONVEYOR_Z);
  black.rotation.y = Math.PI / 2;
  group.add(black);
}

// Гейты/транспортировщики/пэды — собственная geometry на каждый инстанс, её
// нужно освобождать явно при пересборке, иначе состав парка копится в
// видеопамяти при каждом изменении параметров.
function disposeDynamicGroup(group) {
  for (const child of [...group.children]) {
    disposeTree(child);
    group.remove(child);
  }
}

function step(st, dt) {
  st.simSeconds += dt;

  dispatchTransporters(st);
  stepTransporters(st, dt);
  stepConveyor(st, dt);
  stepPlanes(st, dt);
}

// Транспортировщик едет по маршруту депо → дверь гейта → место у борта
// (жалоба: раньше срезал напрямик через здание, не через гейт) → забирает
// груз → дверь гейта → очередь у конвейера → сама лента (разгружает груз) →
// депо. Гейт без самолёта никого не получает; пока все свободные боты
// разобраны, остальные гейты ждут (dispatchTransporters).
function stepTransporters(st, dt) {
  const { gates, transporters, cargoFactory } = st.entities;

  for (const bot of transporters) {
    if (bot.phase === "idle") continue;

    const gate = gates[bot.gateIndex];

    switch (bot.phase) {
      case "toGateDoor":
        if (advanceLeg(bot, dt)) startLeg(bot, serviceSpotOf(bot, gate), "toStand");
        break;

      case "toStand":
        if (advanceLeg(bot, dt)) {
          bot.phase = "atGate";
          bot.t = 0;
        }
        break;

      case "atGate":
        bot.t += dt;
        if (bot.t >= AT_GATE_SECONDS) {
          bot.cargoUnit = cargoFactory.create();
          bot.carry.add(bot.cargoUnit);
          st.opsDone += 1;
          startLeg(bot, gateDoorOf(gate), "toDoorReturn");
        }
        break;

      case "toDoorReturn":
        if (advanceLeg(bot, dt)) startLeg(bot, conveyorWaitSpot(bot), "toConveyorWait");
        break;

      case "toConveyorWait":
        if (advanceLeg(bot, dt) && st.entities.conveyorOccupiedBy === null) {
          st.entities.conveyorOccupiedBy = bot.id;
          startLeg(bot, CONVEYOR_SERVICE, "toConveyorDock");
        }
        // Место занято другим ботом — просто ждёт здесь, проверяя каждый кадр.
        break;

      case "toConveyorDock":
        if (advanceLeg(bot, dt)) {
          bot.carry.remove(bot.cargoUnit);
          bot.cargoUnit.position.set(CONVEYOR_START.x, 0, CONVEYOR_START.z);
          st.dynamicGroup.add(bot.cargoUnit);
          st.entities.conveyorCargo.push({ unit: bot.cargoUnit, t: 0 });
          bot.cargoUnit = null;
          bot.phase = "atConveyor";
          bot.t = 0;
        }
        break;

      case "atConveyor":
        bot.t += dt;
        if (bot.t >= AT_CONVEYOR_SECONDS) {
          st.entities.conveyorOccupiedBy = null;
          startLeg(bot, { x: bot.baseX, z: bot.baseZ }, "toBase");
        }
        break;

      case "toBase":
        if (advanceLeg(bot, dt)) {
          bot.phase = "atBase";
          bot.t = 0;
        }
        break;

      case "atBase":
        bot.t += dt;
        if (bot.t >= AT_BASE_SECONDS) startLeg(bot, gateDoorOf(gate), "toGateDoor");
        break;

      default:
        break;
    }
  }
}

function stepConveyor(st, dt) {
  const belt = st.entities.conveyorCargo;

  for (let i = belt.length - 1; i >= 0; i--) {
    const item = belt[i];
    item.t += dt;
    const p = Math.min(1, item.t / CONVEYOR_DURATION_S);
    item.unit.position.set(lerp(CONVEYOR_START.x, CONVEYOR_END.x, p), 0, CONVEYOR_Z);

    if (p >= 1) {
      st.dynamicGroup.remove(item.unit);
      belt.splice(i, 1);
    }
  }
}

const LANDING_DURATION_S = 7;
const ROLLOUT_DURATION_S = 4;
const TAXIWAY_DURATION_S = 5;
const FINAL_APPROACH_DURATION_S = 3;
const TAXI_LEG_DURATIONS = [ROLLOUT_DURATION_S, TAXIWAY_DURATION_S, FINAL_APPROACH_DURATION_S];
const TURN_RATE = 1.8; // рад/с — насколько быстро курс «догоняет» направление движения
const PLANE_FADE_DURATION_S = 1.6;

// Путь после касания — не прямая от торца полосы до гейта (та шла наискось
// через всю площадку и требовала мгновенного разворота почти на 180°,
// выглядело как «летают перпендикулярно полосе»), а рулёжка по трём коленам
// вдоль уже нарисованной на полу линии руления (airportGround.js): скатиться
// с полосы → доехать по линии руления до своего гейта → довернуть на стоянку.
function taxiWaypoints(gate) {
  return [
    { x: RUNWAY.x2, z: RUNWAY.z2 },
    { x: TERMINAL.xMax + 4, z: TAXI_Z },
    { x: gate.x, z: TAXI_Z },
    { x: gate.x, z: gate.z + GATE_STAND_OFFSET_Z },
  ];
}

// Жизненный цикл самолёта: заходит на посадку по декоративной ВПП → рулит на
// свободный гейт → паркуется и остаётся там. Новая посадка планируется, только
// если есть свободный гейт — когда все заняты, новые самолёты просто
// перестают появляться (по просьбе пользователя: без вылетов, без второй
// волны — цикл на этом останавливается).
function stepPlanes(st, dt) {
  const { gates, planes } = st.entities;

  st.entities.nextPlaneIn -= dt;
  if (st.entities.nextPlaneIn <= 0) {
    const freeGate = gates.find((g) => !g.occupied);
    if (freeGate) {
      freeGate.occupied = true;
      const mesh = makeAircraft();
      mesh.scale.setScalar(0.85);
      st.dynamicGroup.add(mesh);
      planes.push({
        phase: "landing",
        t: 0,
        mesh,
        gate: freeGate,
        heading: headingXForward(RUNWAY.x2 - RUNWAY.x1, RUNWAY.z2 - RUNWAY.z1),
        waypoints: taxiWaypoints(freeGate),
        leg: 0,
        // Плавно проявляется вместо мгновенного «спавна» — как будто выныривает
        // из дымки на подлёте (по просьбе пользователя).
        fade: createMaterializeFade(mesh, PLANE_FADE_DURATION_S),
      });
    }
    st.entities.nextPlaneIn = 6 + Math.random() * 4;
  }

  for (const plane of planes) {
    plane.fade.update(dt);

    if (plane.phase === "landing") {
      plane.t += dt;
      const p = Math.min(1, plane.t / LANDING_DURATION_S);
      const altitude = (1 - p) * 10;
      plane.mesh.position.set(lerp(RUNWAY.x1, RUNWAY.x2, p), altitude, lerp(RUNWAY.z1, RUNWAY.z2, p));

      plane.mesh.rotation.set(0, plane.heading, 0);
      plane.mesh.rotateZ(-0.12 * (1 - p));

      if (p >= 1) {
        plane.phase = "taxi";
        plane.t = 0;
      }
    } else if (plane.phase === "taxi") {
      const from = plane.waypoints[plane.leg];
      const to = plane.waypoints[plane.leg + 1];
      const duration = TAXI_LEG_DURATIONS[plane.leg];

      plane.t += dt;
      const p = Math.min(1, plane.t / duration);
      plane.mesh.position.set(lerp(from.x, to.x, p), 0, lerp(from.z, to.z, p));

      const dx = to.x - from.x;
      const dz = to.z - from.z;
      if (Math.abs(dx) + Math.abs(dz) > 0.001) {
        plane.heading = lerpAngle(plane.heading, headingXForward(dx, dz), Math.min(1, dt * TURN_RATE));
      }
      plane.mesh.rotation.set(0, plane.heading, 0);

      if (p >= 1) {
        plane.leg += 1;
        plane.t = 0;
        if (plane.leg >= plane.waypoints.length - 1) {
          plane.phase = "parked";
          plane.heading = Math.PI / 2; // точно носом к терминалу на стоянке
          plane.mesh.rotation.set(0, plane.heading, 0);
        }
      }
    }
    // "parked" — самолёт занял гейт и остаётся там неподвижно.
  }
}
