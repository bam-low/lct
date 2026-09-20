import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { MAX_VACUUM_COUNT, MAX_LOADER_COUNT, computeLayout } from "./layout.js";
import { computeFloorChunks } from "./chunkGrid.js";
import { GRID, SCENE_HEIGHT_PX, CARGO_WEIGHT_KG, LOAD_SLOWDOWN, VACUUM_SWATH } from "./constants.js";
import { drawFloorBase } from "./floor.js";
import { areRobotModelsReady, loadRobotModels } from "./robots/models.js";
import { createVacuumFleet } from "./vacuums/vacuumFleet.js";
import { createArmFleet } from "./arms/armFleet.js";
import { createLoaderSystem } from "./loaders/loaderSystem.js";
import { createWarehouseScene } from "./sceneSetup.js";
import { Stat, RobotCountPanel } from "./SimPanels.jsx";

// ============================================================
// Управляемый (controlled) компонент: состав роботов, площадь, counts,
// productivity и энергопрофили приходят из useEconomicsState, чтобы 3D-сцена и
// расчёт экономики никогда не расходились в цифрах. Плейбек
// (running/скорость/камера) — внутреннее состояние сцены, на экономику не влияет.
//
// Здесь только связка React ↔ Three.js: сборка сцены, пересборка роботов и
// покадровый цикл. Сама симуляция каждого типа роботов живёт в своём модуле:
//   vacuums/vacuumFleet.js  — уборка, заряд батарей, возврат на станцию
//   arms/armFleet.js        — роборуки и конвейеры
//   loaders/loaderSystem.js — погрузчики, груз, ворота, хранение
// Учёт электроэнергии — energy.js, общий для всех.
// ============================================================

const EMPTY_VACUUM_STATS = { finished: 0, charging: 0, minSoc: null };
const EMPTY_LOADER_STATS = { storedKg: 0, fillPercent: 0, waitingUnits: 0, phase: "loading", cycles: 0, shippedKg: 0 };

const ROBOT_TITLES = { vacuum: "пылесосы", arm: "роборуки", loader: "погрузчики" };
const PHASE_LABELS = { loading: "Загрузка", unloading: "Разгрузка", mixed: "Загрузка / разгрузка" };
const SPEED_OPTIONS = [1, 2, 4, 8, 18, 32, 64, 128];

const formatHours = (hours) => `${hours.toLocaleString("ru-RU")} ч`;

// Ставит новое значение в состояние, только если оно отличается по полям —
// иначе каждый кадр перерисовывал бы панель статистики впустую.
const sameFields = (a, b) => Object.keys(b).every((key) => a[key] === b[key]);

export default function WarehouseScene({
  robotTypes,
  floorAreaM2,
  vacuumCount,
  vacuumProd,
  armCount,
  armProd,
  loaderCount,
  loaderCapacityKg,
  cargoPerHour,
  energyProfiles,
  onManualVacuumCountChange,
  onManualArmCountChange,
  onManualLoaderCountChange,
}) {
  const mountRef = useRef(null);
  const st = useRef({}).current;

  const [running, setRunning] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [coverage, setCoverage] = useState(0);
  const [opsDone, setOpsDone] = useState(0);
  const [simSeconds, setSimSeconds] = useState(0);
  const [vacuumStats, setVacuumStats] = useState(EMPTY_VACUUM_STATS);
  const [loaderStats, setLoaderStats] = useState(EMPTY_LOADER_STATS);
  const [energyKwh, setEnergyKwh] = useState(0);
  // Зум чуть отдалённый по умолчанию, чтобы весь пол и стеллажи помещались
  // в кадр до того, как пользователь сам начнёт приближать/отдалять камеру.
  const [camZoom, setCamZoom] = useState(52);
  const [speedMult, setSpeedMult] = useState(1);
  // glb-модели роботов грузятся асинхронно (обычно их прогревает main.jsx, и
  // они уже готовы). Пол, стены и роборуки строим сразу, пылесосы и
  // погрузчики — когда модели готовы.
  const [modelState, setModelState] = useState(areRobotModelsReady() ? "ready" : "loading"); // 'loading' | 'ready' | 'error'

  const typesKey = robotTypes.join(",");
  const layout = useMemo(() => computeLayout(robotTypes), [robotTypes]);
  const chunkGrid = useMemo(() => computeFloorChunks(floorAreaM2), [floorAreaM2]);
  const { useVacuum, useArm, useLoader } = layout;

  // Пылесос убирает свою полосу за время, которое задаёт его производительность
  // (м²/ч) и площадь помещения: единица сцены — это areaPerUnit2 м², поэтому чем
  // больше помещение, тем медленнее он едет в сцене.
  const vacuumSpeed = useVacuum ? vacuumProd / (VACUUM_SWATH * 3600 * chunkGrid.areaPerUnit2) : 0;
  const totalOpsCapacity = useArm ? armCount * armProd * 60 : 0;

  // Клетки сетки покрытия внутри зоны уборки (1 клетка = 1×1 единица сцены).
  const vacuumZoneCells = layout.vacuumZone
    ? layout.vacuumZone.width * (layout.vacuumZone.zMax - layout.vacuumZone.zMin)
    : 0;

  // ==========================================================
  // СЦЕНА (создаётся один раз)
  // ==========================================================

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const created = createWarehouseScene(mount);

    Object.assign(st, created, {
      vacuumFleet: null,
      armFleet: null,
      loaderSystem: null,
      chunkGrid: null,
      clock: new THREE.Timer(),
      grid: new Uint8Array(GRID * GRID),
      raf: null,
      simAcc: 0,
    });

    loadRobotModels()
      .then(() => setModelState("ready"))
      .catch((error) => {
        console.error("Не удалось загрузить 3D-модели роботов:", error);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camZoom]);

  // ============================================================
  // Подписи чанков (зависят только от площади помещения)
  // ============================================================

  useEffect(() => {
    if (!st.scene) return;
    st.chunkGrid = chunkGrid;
    st.chunkLabels.setGrid(chunkGrid, st.cameraState.theta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunkGrid]);

  // ============================================================
  // Пересборка роботов
  // ============================================================

  useEffect(() => {
    if (!st.scene) return;

    st.vacuumGroup.clear();
    st.armGroup.clear();
    st.loaderGroup.clear();
    st.vacuumFleet = null;
    st.armFleet = null;
    st.loaderSystem = null;

    // След — отдельный слой поверх статичного пола, чистим его при каждой
    // пересборке, иначе старые следы останутся видны после сброса/смены режима.
    st.trailCtx.clearRect(0, 0, st.trailCtx.canvas.width, st.trailCtx.canvas.height);
    st.trailTexture.needsUpdate = true;
    st.grid.fill(0);

    if (useArm && armCount > 0) {
      st.armFleet = createArmFleet({
        group: st.armGroup,
        zone: layout.armZone,
        count: armCount,
        beltTexture: st.beltTexture,
        armProd,
        energyProfile: energyProfiles.arm,
      });
    }

    if (useVacuum && vacuumCount > 0 && modelState === "ready") {
      st.vacuumFleet = createVacuumFleet({
        group: st.vacuumGroup,
        zone: layout.vacuumZone,
        count: vacuumCount,
        cleaningSpeed: vacuumSpeed,
        energyProfile: energyProfiles.vacuum,
        obstacles: st.armFleet?.obstacles ?? [],
        trail: { ctx: st.trailCtx, texture: st.trailTexture },
        grid: st.grid,
      });
    }

    if (useLoader && loaderCount > 0 && modelState === "ready") {
      st.loaderSystem = createLoaderSystem({
        group: st.loaderGroup,
        count: loaderCount,
        capacityKg: loaderCapacityKg,
        metersPerUnit: chunkGrid.metersPerUnit,
        cargoPerHour,
        energyProfile: energyProfiles.loader,
      });
    }

    drawFloorBase(st.floorCtx, { layout, armCount, vacuumCount, chunkGrid });
    st.floorTexture.needsUpdate = true;

    st.simAcc = 0;

    setCoverage(0);
    setOpsDone(0);
    setSimSeconds(0);
    setEnergyKwh(0);
    setVacuumStats(EMPTY_VACUUM_STATS);
    setLoaderStats(EMPTY_LOADER_STATS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    typesKey,
    vacuumCount,
    armCount,
    loaderCount,
    loaderCapacityKg,
    cargoPerHour,
    floorAreaM2,
    vacuumSpeed,
    armProd,
    energyProfiles,
    resetKey,
    modelState,
  ]);

  // ============================================================
  // Анимация
  // ============================================================

  useEffect(() => {
    if (!st.scene) return;

    // Обновляет панели статистики из текущего состояния симуляции.
    const publishStats = (newlyCovered) => {
      if (newlyCovered > 0) {
        let total = 0;
        for (let i = 0; i < st.grid.length; i++) total += st.grid[i];

        setCoverage(vacuumZoneCells > 0 ? Math.min(100, (total / vacuumZoneCells) * 100) : 0);
      }

      if (st.vacuumFleet) {
        const next = st.vacuumFleet.getStats();
        setVacuumStats((prev) => (sameFields(prev, next) ? prev : next));
      }

      if (st.armFleet) setOpsDone(st.armFleet.getOpsDone());

      if (st.loaderSystem) {
        const next = st.loaderSystem.getStats();
        setLoaderStats((prev) => (sameFields(prev, next) ? prev : next));
      }

      const meters = [st.vacuumFleet, st.armFleet, st.loaderSystem].flatMap((fleet) => fleet?.meters ?? []);
      setEnergyKwh(meters.reduce((sum, meter) => sum + meter.gridKwh, 0));
    };

    const tick = (timestamp) => {
      st.raf = requestAnimationFrame(tick);
      st.clock.update(timestamp);
      const realDt = Math.min(st.clock.getDelta(), 0.1);

      st.cameraState.theta += (st.cameraState.thetaTarget - st.cameraState.theta) * 0.12;
      st.updateCamera();
      st.chunkLabels.update(st.cameraState.theta);

      if (running) {
        const mult = speedMult;

        if (st.beltTexture) {
          st.beltTexture.offset.y -= 0.45 * realDt * mult;
        }

        let newlyCovered = 0;
        st.simAcc += realDt * mult;

        for (let step = 0; step < mult; step++) {
          if (st.vacuumFleet) newlyCovered += st.vacuumFleet.step(realDt);
          if (st.armFleet) st.armFleet.step(realDt);
          if (st.loaderSystem) st.loaderSystem.step(realDt);
        }

        // Угасание следа — в реальном времени, один раз за кадр (не за суб-шаг).
        st.vacuumFleet?.updateFades(realDt);

        setSimSeconds(st.simAcc);
        publishStats(newlyCovered);
      }

      st.renderer.render(st.scene, st.camera);
    };

    tick();

    return () => cancelAnimationFrame(st.raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, speedMult, vacuumZoneCells]);

  // ============================================================
  // Controls
  // ============================================================

  const rotate = (dir) => {
    st.cameraState.thetaTarget += dir * (Math.PI / 2);
  };

  const zoomBy = (delta) => setCamZoom((z) => Math.max(22, Math.min(60, z + delta)));

  const fmtTime = (s) => {
    const hours = Math.floor(s / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = Math.floor(s % 60);
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");

    return hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
  };

  const allVacuumsDone = useVacuum && vacuumCount > 0 && vacuumStats.finished === vacuumCount;

  const sceneTitle = robotTypes.map((type) => ROBOT_TITLES[type]).join(", ");
  const fullLoadSlowdownPct = Math.round(LOAD_SLOWDOWN * 100);
  const vacuumProfile = energyProfiles.vacuum;

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
          <h2 className="text-2xl font-bold text-[#3F4159]">Склад мечты · {sceneTitle}</h2>
          <p className="text-sm text-[#6b5f7a]">
            {floorAreaM2.toLocaleString("ru-RU")} м² · {chunkGrid.perSide} × {chunkGrid.perSide} чанков (
            {chunkGrid.chunkCount})
          </p>
        </div>

        <div className="flex gap-1.5">
          <button onClick={() => zoomBy(6)} className="w-8 h-8 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition">−</button>
          <button onClick={() => zoomBy(-6)} className="w-8 h-8 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition">+</button>
          <button onClick={() => rotate(-1)} className="w-8 h-8 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition">↺</button>
          <button onClick={() => rotate(1)} className="w-8 h-8 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition">↻</button>
        </div>
      </div>

      <div ref={mountRef} className="w-full rounded-xl overflow-hidden" style={{ height: SCENE_HEIGHT_PX }} />

      {modelState === "error" && (
        <p className="text-xs text-[#9C3B3B] font-semibold mt-2 px-1">
          Не удалось загрузить 3D-модели роботов (public/models/*.glb) — подробности в консоли браузера.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4">
        {useVacuum && <Stat label="Отполировано" value={`${coverage.toFixed(1)}%`} />}
        {useVacuum && <Stat label="Роботов закончило" value={`${vacuumStats.finished}/${vacuumCount}`} />}
        {useVacuum && (
          <Stat
            label="Заряд, мин."
            value={vacuumStats.minSoc === null ? "—" : `${Math.round(vacuumStats.minSoc * 100)}%`}
          />
        )}
        {useVacuum && <Stat label="На зарядке" value={`${vacuumStats.charging}/${vacuumCount}`} />}
        {useArm && <Stat label="Обработано, шт" value={opsDone} />}
        {useArm && <Stat label="Темп рук" value={`${totalOpsCapacity.toFixed(0)} оп/ч`} />}
        {useLoader && <Stat label="Склад" value={PHASE_LABELS[loaderStats.phase]} />}
        {useLoader && <Stat label="Заполнено" value={`${loaderStats.fillPercent}%`} />}
        {useLoader && <Stat label="На складе, кг" value={loaderStats.storedKg} />}
        {useLoader && <Stat label="Груза у ворот, ед." value={loaderStats.waitingUnits} />}
        {useLoader && <Stat label="Отгружено, кг" value={loaderStats.shippedKg} />}
        {useLoader && <Stat label="Полных циклов" value={loaderStats.cycles} />}
        <Stat label="Электроэнергия" value={`${energyKwh.toFixed(2)} кВт·ч`} />
        <Stat label="Время" value={fmtTime(simSeconds)} />
      </div>

      {allVacuumsDone && (
        <p className="text-xs text-[#2C6E49] font-semibold mt-2 px-1">
          🎉 Все пылесосы закончили свои участки — зона убрана на {coverage.toFixed(0)}%, роботы вернулись на зарядку.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 px-1">
        {useVacuum && (
          <RobotCountPanel
            title="🧹 Пылесосы"
            count={vacuumCount}
            description={
              `Производительность одного робота: ${vacuumProd.toFixed(0)} м²/ч. ` +
              (vacuumProfile.runtimeHours
                ? `На одной зарядке работает ${formatHours(vacuumProfile.runtimeHours)}, заряжается ${formatHours(vacuumProfile.chargeHours)}.`
                : "Питание от сети.")
            }
            onManualChange={onManualVacuumCountChange}
            min={1}
            max={MAX_VACUUM_COUNT}
          />
        )}

        {useArm && (
          <RobotCountPanel
            title="🦾 Роборуки"
            count={armCount}
            description={`Производительность одного робота: ${(armProd * 60).toFixed(0)} оп/ч (по выбранному решению в каталоге)`}
            onManualChange={onManualArmCountChange}
            min={1}
            max={layout.maxArmCount}
          />
        )}

        {useLoader && (
          <RobotCountPanel
            title="🚜 Погрузчики"
            count={loaderCount}
            description={`Грузоподъёмность ${loaderCapacityKg} кг, груз — по ${CARGO_WEIGHT_KG} кг за единицу. Чем тяжелее груз, тем медленнее едет погрузчик (до −${fullLoadSlowdownPct}% при полной загрузке).`}
            onManualChange={onManualLoaderCountChange}
            min={1}
            max={MAX_LOADER_COUNT}
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
          {SPEED_OPTIONS.map((m) => (
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
