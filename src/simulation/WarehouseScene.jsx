import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { FLOOR, LANE_MIN_X, Z_MIN, Z_MAX, computeZoneWidths } from "./layout.js";
import {
  GRID,
  PALETTE,
  VACUUM_SWATH,
  MODEL_SCALE,
  VACUUM_MODEL_SCALE,
  VACUUM_HALF_WIDTH,
  VACUUM_FLOOR_OFFSET,
  ARM_PICKUP_Z,
  ARM_BELT_X,
  ARM_BELT_START_Z,
  ARM_BELT_END_Z,
  BOX_GAP,
  ARM_LEFT_ANGLE,
  ARM_RIGHT_ANGLE,
  ARM_PICKUP_Y,
  ARM_CARRY_Y,
} from "./constants.js";
import { computeChunks, buildRowCenters, easeInOut } from "./sceneUtils.js";
import { computeArmObstacles, dodgeX } from "./obstacles.js";
import { drawTrailSegment, fadeTrailRect, clearTrailRect, chunkToPixelRect, TRAIL_FADE_SECONDS } from "./trail.js";
import { drawFloorBase } from "./floor.js";
import { loadVacuumModel, makeVacuumRobot } from "./robots/vacuumRobot.js";
import { makeArmRobot } from "./robots/armRobot.js";
import { createWarehouseScene } from "./sceneSetup.js";
import { Stat, RobotCountPanel } from "./SimPanels.jsx";

// ============================================================
// Управляемый (controlled) компонент: mode/counts/productivity приходят из
// useEconomicsState, чтобы 3D-сцена и расчёт экономики никогда не
// расходились в цифрах. Плейбек (running/скорость/камера) — внутреннее
// состояние сцены, на экономику не влияет.
//
// Сама сборка Three.js-сцены и отрисовка живут в соседних модулях
// (sceneSetup/floor/trail/obstacles/robots) — этот файл только связывает их
// с React-состоянием и ведёт покадровую симуляцию.
// ============================================================

export default function WarehouseScene({
  mode,
  vacuumCount,
  vacuumProd,
  armCount,
  armProd,
  onManualVacuumCountChange,
  onManualArmCountChange,
}) {
  const mountRef = useRef(null);
  const st = useRef({}).current;

  const [running, setRunning] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [coverage, setCoverage] = useState(0);
  const [opsDone, setOpsDone] = useState(0);
  const [simSeconds, setSimSeconds] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  // Зум чуть отдалённый по умолчанию, чтобы весь пол и стеллажи помещались
  // в кадр до того, как пользователь сам начнёт приближать/отдалять камеру.
  const [camZoom, setCamZoom] = useState(52);
  const [speedMult, setSpeedMult] = useState(1);
  // glb-модель пылесоса грузится асинхронно; роботов собираем только после неё.
  const [modelState, setModelState] = useState("loading"); // 'loading' | 'ready' | 'error'

  const useVacuum = mode === "vacuum" || mode === "both";
  const useArm = mode === "arm" || mode === "both";

  const { vacuumZoneWidth, armZoneWidth, zoneSplitX, vacuumZoneAreaM2 } = computeZoneWidths(mode);

  const vacuumSpeed = useVacuum ? vacuumProd / (VACUUM_SWATH * 3600) : 0;
  const armCycleHz = useArm ? armProd / 60 : 0;
  const totalOpsCapacity = useArm ? armCount * armProd * 60 : 0;

  // ==========================================================
  // СЦЕНА (создаётся один раз)
  // ==========================================================

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const created = createWarehouseScene(mount);

    Object.assign(st, created, {
      vacuums: [],
      arms: [],
      armObstacles: [],
      clock: new THREE.Timer(),
      grid: new Uint8Array(GRID * GRID),
      raf: null,
      opsAcc: 0,
      simAcc: 0,
      lastDone: 0,
    });

    loadVacuumModel()
      .then(() => setModelState("ready"))
      .catch((error) => {
        console.error("Не удалось загрузить модель пылесоса:", error);
        setModelState("error");
      });

    return () => created.dispose(st.raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================
  // Zoom
  // ============================================================

  useEffect(() => {
    if (!st.scene) return;
    st.cameraState.zoom = camZoom;
    st.applyFrustum();
  }, [camZoom]);

  // ============================================================
  // Пересборка роботов
  // ============================================================

  useEffect(() => {
    if (!st.scene || modelState !== "ready") return;

    st.vacuumGroup.clear();
    st.armGroup.clear();
    st.vacuums = [];
    st.arms = [];

    if (useArm && armCount > 0) {
      const armX = zoneSplitX + armZoneWidth / 2;
      const spacing = (Z_MAX - Z_MIN) / armCount;

      for (let i = 0; i < armCount; i++) {
        const z = Z_MIN + spacing * (i + 0.5);
        const built = makeArmRobot(PALETTE.armAccents[i % PALETTE.armAccents.length], st.beltTexture);

        built.group.position.set(armX, 0, z);
        built.group.scale.setScalar(MODEL_SCALE);
        st.armGroup.add(built.group);

        st.arms.push({ ...built, phase: Math.random(), transferBox: null, lastGoingRight: undefined });
      }
    }

    // Роборуки стационарны — их препятствия для объезда считаются один раз,
    // сразу после того, как они расставлены.
    st.armObstacles = computeArmObstacles(st.arms);

    if (useVacuum && vacuumCount > 0) {
      const vacuumChunks = computeChunks(vacuumCount, vacuumZoneWidth, LANE_MIN_X);

      vacuumChunks.forEach((chunk) => {
        const rowCenters = buildRowCenters(chunk);
        const g = makeVacuumRobot();

        g.scale.setScalar(VACUUM_MODEL_SCALE);
        g.position.set(rowCenters[0], VACUUM_FLOOR_OFFSET, chunk.zMin);
        st.vacuumGroup.add(g);

        st.vacuums.push({
          group: g,
          chunk,
          chunkPx: chunkToPixelRect(chunk),
          rowCenters,
          rowIdx: 0,
          x: rowCenters[0],
          z: chunk.zMin,
          lastRenderX: rowCenters[0],
          lastZ: chunk.zMin,
          dirZ: 1,
          done: false,
          fading: false,
          fadeTime: 0,
        });
      });
    }

    // След — отдельный слой поверх статичного пола, чистим его при каждой
    // пересборке, иначе старые следы останутся видны после сброса/смены режима.
    st.trailCtx.clearRect(0, 0, st.trailCtx.canvas.width, st.trailCtx.canvas.height);
    st.trailTexture.needsUpdate = true;

    drawFloorBase(st.floorCtx, { armCount, armZoneWidth, zoneSplitX });
    st.floorTexture.needsUpdate = true;

    st.grid.fill(0);
    st.opsAcc = 0;
    st.simAcc = 0;
    st.lastDone = 0;

    setCoverage(0);
    setOpsDone(0);
    setSimSeconds(0);
    setDoneCount(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, vacuumCount, armCount, resetKey, modelState]);

  // ============================================================
  // Анимация
  // ============================================================

  useEffect(() => {
    if (!st.scene) return;

    const EPS = 1e-6;
    const MARK_RADIUS = (VACUUM_SWATH / 2) * 1.2;

    const advanceVacuum = (dt) => {
      let newly = 0;

      for (const r of st.vacuums) {
        if (!r.done) {
          r.z += r.dirZ * vacuumSpeed * dt;

          const atMax = r.dirZ > 0 && r.z >= r.chunk.zMax;
          const atMin = r.dirZ < 0 && r.z <= r.chunk.zMin;

          if (atMax || atMin) {
            r.z = atMax ? r.chunk.zMax : r.chunk.zMin;
            r.rowIdx++;

            if (r.rowIdx >= r.rowCenters.length) {
              r.done = true;
              r.fading = true;
            } else {
              r.dirZ *= -1;
              r.x = r.rowCenters[r.rowIdx];
            }
          }

          // Пылесос физически чистит номинальную клетку (r.x/r.z), но
          // визуально слегка объезжает роборуки, если те попадаются на пути —
          // модельки не должны наезжать друг на друга.
          const renderX = dodgeX(r.x, r.z, st.armObstacles, VACUUM_HALF_WIDTH);

          r.group.position.set(renderX, VACUUM_FLOOR_OFFSET, r.z);
          r.group.rotation.y = r.dirZ > 0 ? 0 : Math.PI;

          if (Math.abs(renderX - r.lastRenderX) > 0.0001 || Math.abs(r.z - r.lastZ) > 0.0001) {
            drawTrailSegment(st.trailCtx, { x: r.lastRenderX, z: r.lastZ }, { x: renderX, z: r.z }, r.chunkPx);
            r.lastRenderX = renderX;
            r.lastZ = r.z;
            st.trailTexture.needsUpdate = true;
          }
        }

        // Расчёт покрытия — по номинальной траектории, без объезда.
        const c = r.chunk;
        const minGX = Math.max(0, Math.floor(Math.max(r.x - MARK_RADIUS, c.xMin) + FLOOR / 2));
        const maxGX = Math.min(GRID - 1, Math.ceil(Math.min(r.x + MARK_RADIUS, c.xMax) + FLOOR / 2));
        const minGZ = Math.max(0, Math.floor(Math.max(r.z - MARK_RADIUS, c.zMin) + FLOOR / 2));
        const maxGZ = Math.min(GRID - 1, Math.ceil(Math.min(r.z + MARK_RADIUS, c.zMax) + FLOOR / 2));

        for (let gx = minGX; gx <= maxGX; gx++) {
          for (let gz = minGZ; gz <= maxGZ; gz++) {
            const wx = gx - FLOOR / 2 + 0.5;
            const wz = gz - FLOOR / 2 + 0.5;

            if (wx < c.xMin - EPS || wx > c.xMax + EPS || wz < c.zMin - EPS || wz > c.zMax + EPS) continue;

            if ((wx - r.x) ** 2 + (wz - r.z) ** 2 <= MARK_RADIUS ** 2) {
              const idx = gz * GRID + gx;
              if (!st.grid[idx]) {
                st.grid[idx] = 1;
                newly++;
              }
            }
          }
        }
      }

      return newly;
    };

    // Как только робот заканчивает участок, его след начинает растворяться —
    // в реальном времени, независимо от множителя скорости симуляции.
    const updateFades = (dt) => {
      for (const r of st.vacuums) {
        if (!r.fading) continue;

        r.fadeTime += dt;
        fadeTrailRect(st.trailCtx, r.chunkPx, dt);
        st.trailTexture.needsUpdate = true;

        if (r.fadeTime >= TRAIL_FADE_SECONDS) {
          clearTrailRect(st.trailCtx, r.chunkPx);
          st.trailTexture.needsUpdate = true;
          r.fading = false;
        }
      }
    };

    const findWaitingBox = (a) => {
      let best = null;
      let bestDistance = Infinity;

      for (const box of a.boxes) {
        if (box.userData.state !== "waiting") continue;

        const distance = Math.abs(box.userData.z - ARM_PICKUP_Z);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = box;
        }
      }

      return best;
    };

    const advanceInputQueue = (boxesSide, dt, rate) => {
      const queue = boxesSide.filter((b) => b.userData.state === "input" || b.userData.state === "waiting");
      queue.sort((a, b) => b.userData.z - a.userData.z);

      let limit = ARM_PICKUP_Z;

      queue.forEach((box) => {
        let z = box.userData.z + rate * dt;
        if (z > limit) z = limit;

        box.userData.z = z;
        box.position.set(-ARM_BELT_X, 0.82, z);
        box.userData.state = z >= ARM_PICKUP_Z - 1e-3 ? "waiting" : "input";
        limit = z - BOX_GAP;
      });
    };

    const advanceOutputQueue = (boxesSide, dt, rate) => {
      const queue = boxesSide.filter((b) => b.userData.state === "output");
      queue.sort((a, b) => a.userData.z - b.userData.z);

      let limit = -Infinity;

      queue.forEach((box) => {
        let z = box.userData.z + rate * dt;
        if (z < limit) z = limit;

        box.userData.z = z;
        box.position.set(ARM_BELT_X, 0.82, z);
        box.rotation.y += dt * 0.8;
        limit = z + BOX_GAP;

        if (box.userData.z >= ARM_BELT_END_Z) {
          box.userData.state = "input";
          box.userData.side = -1;
          box.userData.z = ARM_BELT_START_Z;
          box.position.set(-ARM_BELT_X, 0.82, ARM_BELT_START_Z);
          box.rotation.set(0, 0, 0);
        }
      });
    };

    const advanceArm = (dt) => {
      for (const a of st.arms) {
        const cycleDuration = 1 / Math.max(armCycleHz, 0.001);
        a.phase = (a.phase + dt / cycleDuration) % 1;
        if (a.phase < 0) a.phase += 1;

        const phase = a.phase;
        const goingRight = phase < 0.5;
        const legPhase = goingRight ? phase * 2 : (phase - 0.5) * 2;
        const eased = easeInOut(legPhase);

        const ARM_RIGHT_FAR = ARM_RIGHT_ANGLE + Math.PI * 2;

        const angle = goingRight
          ? ARM_LEFT_ANGLE + (ARM_RIGHT_FAR - ARM_LEFT_ANGLE) * eased
          : ARM_RIGHT_FAR - (ARM_RIGHT_FAR - ARM_LEFT_ANGLE) * eased;

        const dip = Math.cos(Math.PI * legPhase) ** 2;
        const clawY = ARM_CARRY_Y + (ARM_PICKUP_Y - ARM_CARRY_Y) * dip;

        a.pivot.rotation.y = angle;
        a.claw.position.y = clawY;

        const boxes = a.boxes;
        if (!boxes?.length) continue;

        const rate = 1.45 * Math.max(1, armProd / 15);

        const inputSide = boxes.filter((b) => b.userData.side === -1 && b.userData.state !== "carried");
        const outputSide = boxes.filter((b) => b.userData.side === 1 && b.userData.state !== "carried");

        advanceInputQueue(inputSide, dt, rate);
        advanceOutputQueue(outputSide, dt, rate);

        if (a.lastGoingRight === undefined) a.lastGoingRight = goingRight;

        // Передача
        if (a.lastGoingRight && !goingRight) {
          if (a.transferBox) {
            const box = a.transferBox;
            a.claw.remove(box);
            box.userData.state = "output";
            box.userData.side = 1;
            box.userData.z = ARM_PICKUP_Z;
            box.rotation.set(0, 0, 0);
            box.position.set(ARM_BELT_X, 0.82, ARM_PICKUP_Z);
            a.group.add(box);
            a.transferBox = null;
            st.opsAcc += 1;
          }
        }

        // Захват
        if (!a.lastGoingRight && goingRight) {
          if (!a.transferBox) {
            const pickupBox = findWaitingBox(a);

            if (pickupBox) {
              a.transferBox = pickupBox;
              pickupBox.userData.state = "carried";
              a.claw.add(pickupBox);
              pickupBox.position.set(0, -0.34, 0);
              pickupBox.rotation.set(0, 0, 0);
            }
          }
        }

        a.lastGoingRight = goingRight;
      }
    };

    const tick = (timestamp) => {
      st.raf = requestAnimationFrame(tick);
      st.clock.update(timestamp);
      const realDt = Math.min(st.clock.getDelta(), 0.1);

      st.cameraState.theta += (st.cameraState.thetaTarget - st.cameraState.theta) * 0.12;
      st.updateCamera();

      if (running) {
        const mult = speedMult;

        if (st.beltTexture) {
          st.beltTexture.offset.y -= 0.45 * realDt * mult;
        }

        let newlyTotal = 0;
        st.simAcc += realDt * mult;

        for (let step = 0; step < mult; step++) {
          if (useVacuum) newlyTotal += advanceVacuum(realDt);
          if (useArm) advanceArm(realDt);
        }

        // Угасание следа — в реальном времени, один раз за кадр (не за суб-шаг).
        updateFades(realDt);

        setSimSeconds(st.simAcc);

        if (useVacuum) {
          if (newlyTotal > 0) {
            let total = 0;
            for (let i = 0; i < st.grid.length; i++) total += st.grid[i];

            setCoverage(vacuumZoneAreaM2 > 0 ? Math.min(100, (total / vacuumZoneAreaM2) * 100) : 0);
          }

          const nowDone = st.vacuums.filter((r) => r.done).length;

          if (nowDone !== st.lastDone) {
            st.lastDone = nowDone;
            setDoneCount(nowDone);
          }
        }

        if (useArm) {
          setOpsDone(Math.floor(st.opsAcc));
        }
      }

      st.renderer.render(st.scene, st.camera);
    };

    tick();

    return () => cancelAnimationFrame(st.raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, vacuumSpeed, armCycleHz, useVacuum, useArm, armCount, armProd, vacuumZoneAreaM2, speedMult]);

  // ============================================================
  // Controls
  // ============================================================

  const rotate = (dir) => {
    st.cameraState.thetaTarget += dir * (Math.PI / 2);
  };

  const zoomBy = (delta) => setCamZoom((z) => Math.max(22, Math.min(60, z + delta)));

  const fmtTime = (s) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;

  const allVacuumsDone = useVacuum && vacuumCount > 0 && doneCount === vacuumCount;

  // ============================================================
  // UI
  // ============================================================

  return (
    <div
      className="w-full rounded-2xl p-4"
      style={{
        background: "linear-gradient(160deg, #CBB8E8 0%, #E3B7C9 35%, #F3CDAE 65%, #FBE6C9 100%)",
        fontFamily: "'Baloo 2', ui-rounded, 'Segoe UI Rounded', sans-serif",
      }}
    >
      <div className="flex items-baseline justify-between mb-3 px-1">
        <div>
          <h2 className="text-2xl font-bold text-[#3F4159]">Склад мечты · пылесосы и роборуки</h2>
          <p className="text-sm text-[#6b5f7a]">100 × 100 м · 10 000 м²</p>
        </div>

        <div className="flex gap-1.5">
          <button onClick={() => zoomBy(6)} className="w-8 h-8 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition">−</button>
          <button onClick={() => zoomBy(-6)} className="w-8 h-8 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition">+</button>
          <button onClick={() => rotate(-1)} className="w-8 h-8 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition">↺</button>
          <button onClick={() => rotate(1)} className="w-8 h-8 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition">↻</button>
        </div>
      </div>

      <div ref={mountRef} className="w-full rounded-xl overflow-hidden" style={{ height: 460 }} />

      {modelState === "error" && (
        <p className="text-xs text-[#9C3B3B] font-semibold mt-2 px-1">
          Не удалось загрузить 3D-модель пылесоса (public/models/vacuum.glb) — подробности в консоли браузера.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4">
        {useVacuum && <Stat label="Отполировано" value={`${coverage.toFixed(1)}%`} />}
        {useVacuum && <Stat label="Роботов закончило" value={`${doneCount}/${vacuumCount}`} />}
        {useArm && <Stat label="Обработано, шт" value={opsDone} />}
        {useArm && <Stat label="Темп рук" value={`${totalOpsCapacity.toFixed(0)} оп/ч`} />}
        <Stat label="Время" value={fmtTime(simSeconds)} />
      </div>

      {allVacuumsDone && (
        <p className="text-xs text-[#2C6E49] font-semibold mt-2 px-1">
          🎉 Все пылесосы закончили свои участки — зона убрана на {coverage.toFixed(0)}%.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 px-1">
        {useVacuum && (
          <RobotCountPanel
            title="🧹 Пылесосы"
            count={vacuumCount}
            prod={vacuumProd}
            prodUnit="м²/ч"
            onManualChange={onManualVacuumCountChange}
            min={1}
            max={8}
          />
        )}

        {useArm && (
          <RobotCountPanel
            title="🦾 Роборуки"
            count={armCount}
            prod={armProd * 60}
            prodUnit="оп/ч"
            onManualChange={onManualArmCountChange}
            min={1}
            max={6}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-2 mt-4 px-1 items-center">
        <button
          onClick={() => setRunning(!running)}
          className="text-sm px-4 py-2 rounded-full bg-[#E8B15A] hover:brightness-105 text-[#3F4159] font-bold shadow-sm transition"
        >
          {running ? "⏸ Пауза" : "▶ Дальше"}
        </button>

        <button
          onClick={() => setResetKey((k) => k + 1)}
          className="text-sm px-4 py-2 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition"
        >
          ↺ Сброс
        </button>

        <div className="flex gap-1 ml-1 flex-wrap">
          {[1, 2, 4, 8, 18, 32].map((m) => (
            <button
              key={m}
              onClick={() => setSpeedMult(m)}
              className={`text-xs px-3 py-2 rounded-full font-bold transition ${
                speedMult === m ? "bg-[#3F4159] text-white" : "bg-white/70 hover:bg-white text-[#3F4159]"
              }`}
            >
              {m}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
