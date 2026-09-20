import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { MAX_VACUUM_COUNT, MAX_LOADER_COUNT, computeLayout } from "./layout.js";
import { computeFloorChunks } from "./chunkGrid.js";
import { SCENE_HEIGHT_PX, LOAD_SLOWDOWN, VACUUM_SWATH, ISO_ELEV } from "./constants.js";
import { drawFloorBase } from "./floor.js";
import { areRobotModelsReady, loadRobotModels } from "./robots/models.js";
import { createVacuumFleet } from "./vacuums/vacuumFleet.js";
import { createArmFleet } from "./arms/armFleet.js";
import { createLoaderSystem } from "./loaders/loaderSystem.js";
import { createWarehouseScene } from "./sceneSetup.js";
import { Stat, RobotCountPanel, MapLegend, VerificationPanel } from "./SimPanels.jsx";

// ============================================================
// Управляемый (controlled) компонент: состав роботов, площадь, этажи, counts,
// productivity и энергопрофили приходят из useEconomicsState, чтобы 3D-сцена и
// расчёт экономики никогда не расходились в цифрах. Плейбек
// (running/скорость/камера/выбранный этаж) — внутреннее состояние сцены, на
// экономику не влияет.
//
// Здесь только связка React ↔ Three.js: сборка сцены, пересборка роботов и
// покадровый цикл. На каждом этаже работает свой такой же парк роботов;
// симуляция каждого типа роботов живёт в своём модуле:
//   vacuums/vacuumFleet.js  — уборка, заряд батарей, возврат на станцию
//   arms/armFleet.js        — роборуки и конвейеры
//   loaders/loaderSystem.js — фуры, погрузчики, груз, склад
// Учёт электроэнергии — energy.js, общий для всех.
// ============================================================

const EMPTY_VACUUM_STATS = { finished: 0, charging: 0, minSoc: null, cleanedCells: 0, activeSeconds: 0 };
const EMPTY_LOADER_STATS = {
  phase: "loading",
  cycles: 0,
  receivedPerHour: 0,
  shippedPerHour: 0,
  avgRouteM: 0,
  storedKg: 0,
  fillPercent: 0,
  dockUnits: 0,
  trucksAtGates: 0,
  trucksWaiting: 0,
  trucksIn: 0,
  trucksOut: 0,
  receivedKg: 0,
  shippedKg: 0,
  movedPerHour: 0,
  busyLoaders: 0,
};

const ROBOT_TITLES = { vacuum: "пылесосы", arm: "роборуки", loader: "погрузчики" };
const PHASE_LABELS = { loading: "Приёмка груза", unloading: "Отгрузка груза", mixed: "Приёмка / отгрузка" };
const SPEED_OPTIONS = [1, 2, 4, 8, 18, 32, 64, 128];

// Не показывать подтверждение расчёта, пока симуляция идёт слишком мало (цифры «прыгают»).
const MIN_VERIFY_SECONDS = 120;
const FLOOR_STAGGER_SECONDS = 7; // на сколько позже на каждом следующем этаже приезжает первая фура

const formatHours = (hours) => `${hours.toLocaleString("ru-RU")} ч`;

// Ставит новое значение в состояние, только если оно отличается по полям —
// иначе каждый кадр перерисовывал бы панель статистики впустую.
const sameFields = (a, b) => Object.keys(b).every((key) => a[key] === b[key]);

// Со складом погрузчиков за воротами видна площадка для фур — отъезжаем чуть дальше.
const zoomDefaultFor = (floors, hasYard) => 52 + 8 * (floors - 1) + (hasYard ? 8 : 0);
const zoomMaxFor = (floors) => 70 + 14 * (floors - 1);
const YARD_FOCUS_Z = -16;

export default function WarehouseScene({
  robotTypes,
  floorAreaM2,
  floorsCount,
  vacuumCount,
  vacuumProd,
  armCount,
  armProd,
  loaderCount,
  loaderCapacityKg,
  loaderSpeedMps,
  loaderThroughput,
  cargoWeightKg,
  cargoLengthCm,
  cargoWidthCm,
  cargoHeightCm,
  skuCount,
  slotsPerLane,
  routeLengthM,
  cargoPerHour,
  outboundPerHour,
  truckPayload,
  workZoneShare,
  demand,
  scenarioLabel,
  energyProfiles,
  onManualVacuumCountChange,
  onManualArmCountChange,
  onManualLoaderCountChange,
}) {
  const mountRef = useRef(null);
  const st = useRef({}).current;

  const [running, setRunning] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [activeFloor, setActiveFloor] = useState(0);
  const [coverage, setCoverage] = useState(0);
  const [opsDone, setOpsDone] = useState(0);
  const [simSeconds, setSimSeconds] = useState(0);
  const [vacuumStats, setVacuumStats] = useState(EMPTY_VACUUM_STATS);
  const [loaderStats, setLoaderStats] = useState(EMPTY_LOADER_STATS);
  const [energyKwh, setEnergyKwh] = useState(0);
  // Зум чуть отдалённый по умолчанию, чтобы весь пол и стеллажи помещались
  // в кадр до того, как пользователь сам начнёт приближать/отдалять камеру.
  const [camZoom, setCamZoom] = useState(() => zoomDefaultFor(floorsCount, robotTypes.includes("loader")));
  const [speedMult, setSpeedMult] = useState(1);
  const [topView, setTopView] = useState(false); // 2D-вид сверху вместо 3D-изометрии
  // glb-модели (роботы и фура) грузятся асинхронно (обычно их прогревает main.jsx, и
  // они уже готовы). Пол, стены и роборуки строим сразу, пылесосы, погрузчики и
  // фуры — когда модели готовы.
  const [modelState, setModelState] = useState(areRobotModelsReady() ? "ready" : "loading"); // 'loading' | 'ready' | 'error'

  const typesKey = robotTypes.join(",");
  const layout = useMemo(() => computeLayout(robotTypes, workZoneShare), [robotTypes, workZoneShare]);
  const chunkGrid = useMemo(() => computeFloorChunks(floorAreaM2), [floorAreaM2]);
  const { useVacuum, useArm, useLoader } = layout;

  const floorIndex = Math.min(activeFloor, floorsCount - 1);
  st.activeFloor = floorIndex;

  // Пылесос убирает свою полосу за время, которое задаёт его производительность
  // (м²/ч) и площадь помещения: единица сцены — это areaPerUnit2 м², поэтому чем
  // больше помещение, тем медленнее он едет в сцене.
  const vacuumSpeed = useVacuum ? vacuumProd / (VACUUM_SWATH * 3600 * chunkGrid.areaPerUnit2) : 0;
  const totalOpsCapacity = useArm ? armCount * armProd * 60 : 0;
  const cargoPerFloorHour = cargoPerHour / floorsCount;
  const outboundPerFloorHour = outboundPerHour / floorsCount;

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
      clock: new THREE.Timer(),
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
    setCamZoom(zoomDefaultFor(floorsCount, useLoader));
    if (st.scene) st.cameraState.focusZTarget = useLoader ? YARD_FOCUS_Z : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorsCount, useLoader]);

  // 3D-изометрия ↔ 2D-вид сверху: камера поднимается над складом и встаёт на ось,
  // подписи чанков разворачиваются под новый вид.
  useEffect(() => {
    if (!st.scene) return;

    const camera = st.cameraState;
    const quarter = Math.PI / 2;

    camera.elevationTarget = topView ? st.TOP_ELEVATION : ISO_ELEV;
    camera.thetaTarget = topView
      ? Math.round(camera.thetaTarget / (4 * quarter)) * 4 * quarter // север сверху
      : Math.round((camera.thetaTarget - Math.PI / 4) / quarter) * quarter + Math.PI / 4;

    st.chunkLabels.setTopView(topView, camera.thetaTarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topView]);

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
    st.chunkLabels.setGrid(chunkGrid, st.cameraState.theta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunkGrid]);

  // ============================================================
  // Пересборка этажей и роботов
  // ============================================================

  useEffect(() => {
    if (!st.scene) return;

    st.setLevelCount(floorsCount);

    st.levels.forEach((level, index) => {
      level.crates.visible = !useLoader;
      level.vacuumGroup.clear();
      level.armGroup.clear();
      level.loaderGroup.clear();
      level.vacuumFleet = null;
      level.armFleet = null;
      level.loaderSystem = null;

      // След — отдельный слой поверх статичного пола, чистим его при каждой
      // пересборке, иначе старые следы останутся видны после сброса/смены режима.
      level.trailCtx.clearRect(0, 0, level.trailCtx.canvas.width, level.trailCtx.canvas.height);
      level.trailTexture.needsUpdate = true;
      level.grid.fill(0);

      if (useArm && armCount > 0) {
        level.armFleet = createArmFleet({
          group: level.armGroup,
          zone: layout.armZone,
          count: armCount,
          beltTexture: st.beltTexture,
          armProd,
          energyProfile: energyProfiles.arm,
        });
      }

      if (useVacuum && vacuumCount > 0 && modelState === "ready") {
        level.vacuumFleet = createVacuumFleet({
          group: level.vacuumGroup,
          zone: layout.vacuumZone,
          count: vacuumCount,
          cleaningSpeed: vacuumSpeed,
          energyProfile: energyProfiles.vacuum,
          obstacles: level.armFleet?.obstacles ?? [],
          trail: { ctx: level.trailCtx, texture: level.trailTexture },
          grid: level.grid,
        });
      }

      // Ворота и фуры — только на первом этаже; выше склад пуст.
      if (useLoader && index === 0 && loaderCount > 0 && modelState === "ready") {
        level.loaderSystem = createLoaderSystem({
          group: level.loaderGroup,
          count: loaderCount,
          capacityKg: loaderCapacityKg,
          cargoWeightKg,
          speedMps: loaderSpeedMps,
          metersPerUnit: chunkGrid.metersPerUnit,
          cargoPerHour: cargoPerFloorHour,
          truckPayload,
          slotsPerLane,
          routeLengthM,
          cargo: { lengthCm: cargoLengthCm, widthCm: cargoWidthCm, heightCm: cargoHeightCm, skuCount },
          startDelay: index * FLOOR_STAGGER_SECONDS,
          energyProfile: energyProfiles.loader,
        });
      }
    });

    drawFloorBase(st.floorCtx, { layout, armCount, vacuumCount, chunkGrid, slotsPerLane });
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
    floorsCount,
    vacuumCount,
    armCount,
    loaderCount,
    loaderCapacityKg,
    loaderSpeedMps,
    cargoWeightKg,
    cargoLengthCm,
    cargoWidthCm,
    cargoHeightCm,
    skuCount,
    slotsPerLane,
    routeLengthM,
    cargoPerHour,
    truckPayload,
    layout,
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

    // Обновляет панели статистики: показатели выбранного этажа + энергия всего здания.
    const publishStats = (newlyCovered) => {
      const level = st.levels[st.activeFloor] ?? st.levels[0];
      if (!level) return;

      if (level.vacuumFleet) {
        if (newlyCovered > 0) {
          let total = 0;
          for (let i = 0; i < level.grid.length; i++) total += level.grid[i];

          setCoverage(vacuumZoneCells > 0 ? Math.min(100, (total / vacuumZoneCells) * 100) : 0);
        }

        const next = level.vacuumFleet.getStats();
        setVacuumStats((prev) => (sameFields(prev, next) ? prev : next));
      }

      if (level.armFleet) setOpsDone(level.armFleet.getOpsDone());

      if (level.loaderSystem) {
        const next = level.loaderSystem.getStats();
        setLoaderStats((prev) => (sameFields(prev, next) ? prev : next));
      }

      const meters = st.levels.flatMap((l) => [l.vacuumFleet, l.armFleet, l.loaderSystem].flatMap((fleet) => fleet?.meters ?? []));
      setEnergyKwh(meters.reduce((sum, meter) => sum + meter.gridKwh, 0));
    };

    const tick = (timestamp) => {
      st.raf = requestAnimationFrame(tick);
      st.clock.update(timestamp);
      const realDt = Math.min(st.clock.getDelta(), 0.1);

      st.cameraState.theta += (st.cameraState.thetaTarget - st.cameraState.theta) * 0.12;
      st.updateCamera(st.activeFloor);
      st.chunkLabels.update(st.cameraState.theta);

      if (running) {
        const mult = speedMult;

        if (st.beltTexture) {
          st.beltTexture.offset.y -= 0.45 * realDt * mult;
        }

        const activeLevel = st.levels[st.activeFloor];
        let newlyCovered = 0;
        st.simAcc += realDt * mult;

        for (let step = 0; step < mult; step++) {
          for (const level of st.levels) {
            const covered = level.vacuumFleet?.step(realDt) ?? 0;
            if (level === activeLevel) newlyCovered += covered;

            level.armFleet?.step(realDt);
            level.loaderSystem?.step(realDt);
          }
        }

        // Угасание следа — в реальном времени, один раз за кадр (не за суб-шаг).
        for (const level of st.levels) level.vacuumFleet?.updateFades(realDt);

        setSimSeconds(st.simAcc);
        publishStats(newlyCovered);
      }

      st.render(st.activeFloor);
    };

    tick();

    return () => cancelAnimationFrame(st.raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, speedMult, vacuumZoneCells]);

  // Переключение этажа: статистику сразу берём с нового этажа, а не ждём кадра.
  useEffect(() => {
    if (!st.scene) return;

    const level = st.levels[floorIndex];
    if (!level) return;

    setVacuumStats(level.vacuumFleet ? level.vacuumFleet.getStats() : EMPTY_VACUUM_STATS);
    setLoaderStats(level.loaderSystem ? level.loaderSystem.getStats() : EMPTY_LOADER_STATS);
    setOpsDone(level.armFleet ? level.armFleet.getOpsDone() : 0);

    if (level.vacuumFleet) {
      let total = 0;
      for (let i = 0; i < level.grid.length; i++) total += level.grid[i];
      setCoverage(vacuumZoneCells > 0 ? Math.min(100, (total / vacuumZoneCells) * 100) : 0);
    } else {
      setCoverage(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorIndex]);

  // ============================================================
  // Controls
  // ============================================================

  const rotate = (dir) => {
    st.cameraState.thetaTarget += dir * (Math.PI / 2);
  };

  const zoomBy = (delta) => setCamZoom((z) => Math.max(22, Math.min(zoomMaxFor(floorsCount), z + delta)));

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
  const fullLoadSlowdownPct = Math.round(LOAD_SLOWDOWN * Math.min(1, cargoWeightKg / loaderCapacityKg) * 100);
  const vacuumProfile = energyProfiles.vacuum;
  const multiFloor = floorsCount > 1;

  // ============================================================
  // Подтверждение расчёта и легенда карты
  // ============================================================

  const simHours = simSeconds / 3600;
  const enoughTime = simSeconds >= MIN_VERIFY_SECONDS;

  const verifyRows = [];

  if (useVacuum) {
    const duty = vacuumProfile.runtimeHours ? vacuumProfile.runtimeHours / (vacuumProfile.runtimeHours + vacuumProfile.chargeHours) : 1;
    const cleaning = vacuumStats.activeSeconds >= MIN_VERIFY_SECONDS;

    verifyRows.push({
      label: "Уборка",
      unit: "м²/ч",
      required: demand.vacuum,
      calculated: vacuumCount * vacuumProd * duty,
      simulated: cleaning ? (vacuumStats.cleanedCells * chunkGrid.areaPerUnit2) / (vacuumStats.activeSeconds / 3600) : null,
      note: "Расчёт учитывает время на зарядку; в симуляции — убранная площадь за время до окончания уборки.",
    });
  }

  if (useArm) {
    verifyRows.push({
      label: "Внутрискладские операции",
      unit: "оп/ч",
      required: demand.arm,
      calculated: totalOpsCapacity,
      simulated: enoughTime ? opsDone / simHours : null,
    });
  }

  if (useLoader) {
    verifyRows.push(
      {
        label: "Операции погрузчиков (приём + отгрузка)",
        unit: "ед./ч",
        required: demand.loader,
        calculated: loaderCount * loaderThroughput,
        simulated: loaderStats.movedPerHour || null,
        note: "Производительность погрузчика ограничена длиной маршрута, скоростью и массой груза; если парк не успевает, фуры ждут в очереди.",
      },
      {
        label: "Входящий поток",
        unit: "ед./ч",
        required: cargoPerFloorHour,
        calculated: null,
        simulated: loaderStats.receivedPerHour || null,
      },
      {
        label: "Исходящий поток",
        unit: "ед./ч",
        required: outboundPerFloorHour,
        calculated: null,
        simulated: loaderStats.shippedPerHour || null,
      },
      {
        label: "Средняя протяжённость маршрута",
        unit: "м",
        required: routeLengthM,
        calculated: routeLengthM,
        simulated: loaderStats.avgRouteM || null,
      }
    );
  }

  const legendItems = [
    { kind: "zone", color: "#4C5070", label: "Рабочая зона роботов (пол разбит на подписанные чанки)" },
    ...(layout.restrictedZone ? [{ kind: "zone", color: "#E5A13F", dashed: true, label: "Зона разгрузки у ворот — недоступна роботам" }] : []),
    ...(useVacuum
      ? [
          { kind: "line", color: "#ffffff", label: "Маршрут пылесоса — белый след, растворяется после уборки" },
          { kind: "zone", color: "#4F9B90", label: "Зарядная станция (светодиод: жёлтый — заряжается, зелёный — заряжен)" },
          { kind: "dot", color: "#f3efe6", label: "Робот-пылесос" },
        ]
      : []),
    ...(useArm
      ? [
          { kind: "zone", color: "#8B78C7", label: "Площадка роборуки — точка выполнения операции" },
          { kind: "line", color: "#D4B96F", label: "Конвейеры: вход и выход коробок" },
          { kind: "dot", color: "#C85E70", label: "Роборука" },
        ]
      : []),
    ...(useLoader
      ? [
          { kind: "line", color: "#E5A13F", dashed: true, label: "Маршруты погрузчиков: проезды; в зоне каждых ворот ездит только свой погрузчик" },
          { kind: "line", color: "#ffffff", dashed: true, label: "Границы зон ворот: за каждыми воротами — свой погрузчик" },
          { kind: "zone", color: "#E5A13F", dashed: true, label: "Площадка у ворот — точка выгрузки и отгрузки фур" },
          { kind: "zone", color: "#9A7B55", label: "Грузовая единица (цвет — по SKU) и места хранения" },
          { kind: "dot", color: "#F08A24", label: "Погрузчик; стоянки — у северной стены" },
        ]
      : []),
  ];

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
          {scenarioLabel && <p className="text-xs font-semibold text-[#6b5f7a]">Сценарий расчёта: {scenarioLabel}</p>}
          <p className="text-sm text-[#6b5f7a]">
            {floorAreaM2.toLocaleString("ru-RU")} м²{multiFloor ? ` × ${floorsCount} эт.` : ""} · {chunkGrid.perSide} ×{" "}
            {chunkGrid.perSide} чанков ({chunkGrid.chunkCount}){multiFloor ? " на этаж" : ""}
          </p>
        </div>

        <div className="flex gap-1.5 items-center">
          <button
            onClick={() => setTopView((v) => !v)}
            aria-pressed={topView}
            title="Переключить вид: 3D-изометрия или 2D-план сверху"
            className={`h-8 px-3 rounded-full font-bold text-sm shadow-sm transition ${
              topView ? "bg-[#3F4159] text-white" : "bg-white/70 hover:bg-white text-[#3F4159]"
            }`}
          >
            {topView ? "2D план" : "3D"}
          </button>
          <button onClick={() => zoomBy(6)} className="w-8 h-8 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition">−</button>
          <button onClick={() => zoomBy(-6)} className="w-8 h-8 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition">+</button>
          <button onClick={() => rotate(-1)} className="w-8 h-8 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition">↺</button>
          <button onClick={() => rotate(1)} className="w-8 h-8 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition">↻</button>
        </div>
      </div>

      {multiFloor && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3 px-1">
          <span className="text-sm font-semibold text-[#3F4159] mr-1">Этаж:</span>

          {Array.from({ length: floorsCount }, (_, index) => (
            <button
              key={index}
              onClick={() => setActiveFloor(index)}
              aria-pressed={index === floorIndex}
              className={`text-sm px-3 py-1 rounded-full font-bold transition ${
                index === floorIndex ? "bg-[#3F4159] text-white" : "bg-white/70 hover:bg-white text-[#3F4159]"
              }`}
            >
              {index + 1}
            </button>
          ))}

          <span className="text-xs text-[#6b5f7a] ml-1">остальные этажи показаны прозрачными</span>
        </div>
      )}

      <div ref={mountRef} className="w-full rounded-xl overflow-hidden" style={{ height: SCENE_HEIGHT_PX }} />

      {modelState === "error" && (
        <p className="text-xs text-[#9C3B3B] font-semibold mt-2 px-1">
          Не удалось загрузить 3D-модели (public/models/*.glb) — подробности в консоли браузера.
        </p>
      )}

      {multiFloor && (
        <p className="text-xs text-[#6b5f7a] font-semibold mt-3 px-1">
          Показатели этажа {floorIndex + 1}; электроэнергия и время — по всему зданию.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-2">
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
        {useLoader && <Stat label="На площадках, ед." value={loaderStats.dockUnits} />}
        {useLoader && <Stat label="Фуры у ворот / в очереди" value={`${loaderStats.trucksAtGates} / ${loaderStats.trucksWaiting}`} />}
        {useLoader && <Stat label="Фур принято / отправлено" value={`${loaderStats.trucksIn} / ${loaderStats.trucksOut}`} />}
        {useLoader && <Stat label="Принято, кг" value={loaderStats.receivedKg} />}
        {useLoader && <Stat label="Отгружено, кг" value={loaderStats.shippedKg} />}
        {useLoader && <Stat label="Погрузчиков в работе" value={`${loaderStats.busyLoaders}/${loaderCount}`} />}
        {useLoader && (
          <Stat
            label="Поток факт / нужен, ед./ч"
            value={`${loaderStats.movedPerHour || "—"} / ${Math.round(cargoPerFloorHour)}`}
          />
        )}
        {useLoader && <Stat label="Полных циклов" value={loaderStats.cycles} />}
        <Stat label="Электроэнергия" value={`${energyKwh.toFixed(2)} кВт·ч`} />
        <Stat label="Время" value={fmtTime(simSeconds)} />
      </div>

      {allVacuumsDone && (
        <p className="text-xs text-[#2C6E49] font-semibold mt-2 px-1">
          🎉 Все пылесосы этажа закончили свои участки — зона убрана на {coverage.toFixed(0)}%, роботы вернулись на зарядку.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 px-1">
        {useVacuum && (
          <RobotCountPanel
            title={multiFloor ? "🧹 Пылесосы на каждом этаже" : "🧹 Пылесосы"}
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
            title={multiFloor ? "🦾 Роборуки на каждом этаже" : "🦾 Роборуки"}
            count={armCount}
            description={`Производительность одного робота: ${(armProd * 60).toFixed(0)} оп/ч (по выбранному решению в каталоге). Больше четырёх рук выстраиваются параллельными колонками.`}
            onManualChange={onManualArmCountChange}
            min={1}
            max={layout.maxArmCount}
          />
        )}

        {useLoader && (
          <RobotCountPanel
            title={multiFloor ? "🚜 Погрузчики на каждом этаже" : "🚜 Погрузчики"}
            count={loaderCount}
            description={`Скорость ${loaderSpeedMps} м/с, грузоподъёмность ${loaderCapacityKg} кг, единица груза — ${cargoWeightKg} кг: с грузом погрузчик едет на ${fullLoadSlowdownPct}% медленнее. Фура привозит ${truckPayload} ед. и выгружает их разом.`}
            onManualChange={onManualLoaderCountChange}
            min={1}
            max={MAX_LOADER_COUNT}
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4 px-1">
        <VerificationPanel rows={verifyRows} />
        <MapLegend items={legendItems} />
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
