import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ISO_ELEV } from "../constants.js";
import { disposeTree } from "../sceneUtils.js";
import { createAirportScene } from "./airportSceneSetup.js";
import { gatePositions, RUNWAY, DEPOT_ZONE } from "./airportLayout3D.js";
import { makeTransporterRobot } from "../robots/transporterRobot.js";
import { makeAircraft } from "./robots/aircraftModel.js";

const MAX_FRAME_SECONDS = 0.1;
const STATS_INTERVAL_MS = 150;

function lerp(a, b, t) {
  return a + (b - a) * t;
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

    // Декоративные самолёты на ВПП живут в статичной группе (не сбрасываются
    // вместе с составом парка) — но старый массив состояния заменяется новым
    // пустым ниже, так что те, что были в полёте, нужно снять со сцены сейчас,
    // иначе они зависают на месте навсегда и накапливаются при каждой правке параметров.
    if (st.entities) {
      for (const plane of st.entities.runwayPlanes) {
        st.runwayPlanes.remove(plane.mesh);
        disposeTree(plane.mesh);
      }
    }

    const gates = gatePositions(gatesCount).map((pos) => {
      const aircraft = makeAircraft();
      aircraft.scale.setScalar(0.85);
      st.dynamicGroup.add(aircraft);

      return { ...pos, aircraftMesh: aircraft, pad: makeGatePad(pos, st.dynamicGroup) };
    });

    const transporters = Array.from({ length: Math.min(16, transportCount) }, (_, i) => {
      const base = depotBaseOf(i);
      const mesh = makeTransporterRobot().group;
      mesh.position.set(base.x, 0, base.z);
      st.dynamicGroup.add(mesh);
      return { id: i, phase: "toGate", t: 0, gateIndex: gates.length ? i % gates.length : 0, baseX: base.x, baseZ: base.z, x: base.x, z: base.z, mesh };
    });

    st.entities = { gates, transporters, runwayPlanes: [], nextPlaneIn: 4 };
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
        step(st, dt, { transportThroughput, groundOpsPerFlight });

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

function makeGatePad(pos, group) {
  const geometry = new THREE.CylinderGeometry(1.6, 1.6, 0.05, 16);
  const material = new THREE.MeshStandardMaterial({ color: 0xc9c3dd, flatShading: true, roughness: 0.8 });
  const pad = new THREE.Mesh(geometry, material);
  pad.position.set(pos.x, 0.03, pos.z + 3);
  pad.receiveShadow = true;
  group.add(pad);
  return pad;
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

function step(st, dt, params) {
  const { transportThroughput } = params;
  const { gates, transporters } = st.entities;

  st.simSeconds += dt;

  // Гейты — просто точки, где стоят самолёты (декоративно, всегда видны;
  // прогресс обслуживания больше не считаем отдельным процессом «рамп»).
  for (const gate of gates) {
    gate.aircraftMesh.position.set(gate.x, 0, gate.z + 3);
    gate.aircraftMesh.rotation.y = Math.PI / 2; // носом к терминалу (мировая −Z)
  }

  // --- транспортировщики: депо ↔ гейт ---
  const tripS = Math.max(4, 3600 / Math.max(1, transportThroughput));
  for (const bot of transporters) {
    bot.t += dt;
    const gate = gates[bot.gateIndex % gates.length];
    const leg = tripS / 2;

    if (bot.phase === "toGate") {
      const p = Math.min(1, bot.t / leg);
      bot.x = lerp(bot.baseX, gate.x, p);
      bot.z = lerp(bot.baseZ, gate.z - 1, p);
      bot.mesh.rotation.y = headingZForward(gate.x - bot.baseX, gate.z - 1 - bot.baseZ);
      if (p >= 1) {
        bot.phase = "atGate";
        bot.t = 0;
      }
    } else if (bot.phase === "atGate") {
      if (bot.t >= 2) {
        bot.phase = "toBase";
        bot.t = 0;
        st.opsDone += 1;
      }
    } else if (bot.phase === "toBase") {
      const p = Math.min(1, bot.t / leg);
      bot.x = lerp(gate.x, bot.baseX, p);
      bot.z = lerp(gate.z - 1, bot.baseZ, p);
      bot.mesh.rotation.y = headingZForward(bot.baseX - gate.x, bot.baseZ - (gate.z - 1));
      if (p >= 1) {
        bot.phase = "atBase";
        bot.t = 0;
      }
    } else if (bot.phase === "atBase" && bot.t >= 1.5) {
      bot.phase = "toGate";
      bot.t = 0;
      bot.gateIndex = (bot.gateIndex + 1) % gates.length;
    }

    bot.mesh.position.set(bot.x, 0, bot.z);
  }

  // --- декоративные самолёты на ВПП ---
  stepRunwayPlanes(st, dt);
}

function stepRunwayPlanes(st, dt) {
  const planes = st.entities.runwayPlanes;

  st.entities.nextPlaneIn -= dt;
  if (st.entities.nextPlaneIn <= 0) {
    // Мелкий масштаб и приглушённая скорость — декоративный фон сбоку, а не
    // конкурирующий по значимости объект.
    const mesh = makeAircraft();
    mesh.scale.setScalar(0.3);
    st.runwayPlanes.add(mesh);
    planes.push({ kind: Math.random() > 0.5 ? "land" : "takeoff", t: 0, mesh });
    st.entities.nextPlaneIn = 10 + Math.random() * 8;
  }

  for (const plane of planes) plane.t += dt / 14;

  for (let i = planes.length - 1; i >= 0; i--) {
    const plane = planes[i];
    if (plane.t >= 1) {
      st.runwayPlanes.remove(plane.mesh);
      disposeTree(plane.mesh); // собственная geometry на самолёт (не шаблон) — освобождаем при вылете за сцену
      planes.splice(i, 1);
      continue;
    }

    const p = plane.kind === "land" ? plane.t : 1 - plane.t;
    const altitude = plane.kind === "land" ? (1 - plane.t) * 7 : plane.t * 7;

    plane.mesh.position.set(lerp(RUNWAY.x1, RUNWAY.x2, p), altitude, lerp(RUNWAY.z1, RUNWAY.z2, p));

    const dx = (RUNWAY.x2 - RUNWAY.x1) * (plane.kind === "land" ? 1 : -1);
    const dz = (RUNWAY.z2 - RUNWAY.z1) * (plane.kind === "land" ? 1 : -1);
    plane.mesh.rotation.set(0, headingXForward(dx, dz), 0);
    plane.mesh.rotateZ(plane.kind === "land" ? -0.12 : 0.12);
  }
}
