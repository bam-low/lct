import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ISO_ELEV } from "./constants.js";
import { drawFloorBase } from "./floor.js";
import { areRobotModelsReady, loadRobotModels } from "./robots/models.js";
import { createVacuumFleet } from "./vacuums/vacuumFleet.js";
import { createArmFleet } from "./arms/armFleet.js";
import { createLoaderSystem } from "./loaders/loaderSystem.js";
import { createWarehouseScene } from "./sceneSetup.js";
import { EMPTY_STATS, readStats, sameStats } from "./simStats.js";

// Связка React ↔ Three.js: сборка сцены один раз, пересборка этажей и роботов при
// смене параметров и покадровый цикл симуляции. Компонент WarehouseScene остаётся
// только интерфейсом. На каждом этаже работает свой такой же парк роботов;
// симуляция каждого типа роботов живёт в своём модуле:
//   vacuums/vacuumFleet.js  — уборка, заряд батарей, возврат на станцию
//   arms/armFleet.js        — роборуки и конвейеры
//   loaders/loaderSystem.js — фуры, погрузчики, груз, склад

const MAX_FRAME_SECONDS = 0.1; // шаг симуляции за кадр не больше — вкладка в фоне не «прыгает»
const STATS_INTERVAL_MS = 120; // как часто обновлять панели показателей
const STEP_BUDGET_MS = 12; // сколько миллисекунд кадра можно тратить на шаги симуляции

const FLOOR_STAGGER_SECONDS = 7; // на сколько позже на каждом следующем этаже приезжает первая фура
const QUARTER = Math.PI / 2;
const YARD_FOCUS_Z = -16; // со складом погрузчиков камера смотрит ближе к воротам и фурам

function disposeFleets(level) {
  level.armFleet?.dispose();
  level.vacuumFleet?.dispose();
  level.loaderSystem?.dispose();
  level.armFleet = null;
  level.vacuumFleet = null;
  level.loaderSystem = null;
}

// cfg — всё, что нужно сцене (см. WarehouseScene): состав роботов, площадь, счётчики,
// производительность, энергопрофили и состояние воспроизведения. Возвращает
// mountRef (куда монтировать canvas), показатели и управление камерой.
export function useSimulation(cfg) {
  const {
    layout,
    chunkGrid,
    floorsCount,
    floorIndex,
    running,
    speedMult,
    topView,
    camZoom,
    resetKey,
    vacuumCount,
    vacuumSpeed,
    armCount,
    armProd,
    loaderCount,
    energyProfiles,
    loader,
  } = cfg;

  const mountRef = useRef(null);
  const st = useRef({}).current;

  const [stats, setStats] = useState(EMPTY_STATS);
  // glb-модели (роботы и фура) грузятся асинхронно (обычно их прогревает main.jsx, и
  // они уже готовы). Пол, стены и роборуки строим сразу, пылесосы, погрузчики и
  // фуры — когда модели готовы.
  const [modelState, setModelState] = useState(areRobotModelsReady() ? "ready" : "loading"); // 'loading' | 'ready' | 'error'

  const { useVacuum, useArm, useLoader } = layout;

  // Клетки сетки покрытия внутри зоны уборки (1 клетка = 1×1 единица сцены).
  const vacuumZoneCells = layout.vacuumZone ? layout.vacuumZone.width * (layout.vacuumZone.zMax - layout.vacuumZone.zMin) : 0;

  st.activeFloor = floorIndex;

  const publish = () => {
    const next = readStats(st.levels, st.activeFloor, vacuumZoneCells, st.simAcc);
    setStats((prev) => (sameStats(prev, next) ? prev : next));
  };

  // ==========================================================
  // Сцена (создаётся один раз)
  // ==========================================================

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const created = createWarehouseScene(mount);

    Object.assign(st, created, {
      clock: new THREE.Timer(),
      raf: null,
      simAcc: 0,
      lastPublish: 0,
    });

    loadRobotModels()
      .then(() => setModelState("ready"))
      .catch((error) => {
        console.error("Не удалось загрузить 3D-модели роботов:", error);
        setModelState("error");
      });

    return () => {
      created.levels.forEach(disposeFleets);
      created.dispose(st.raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==========================================================
  // Камера: фокус, вид (3D/2D), зум
  // ==========================================================

  useEffect(() => {
    if (st.scene) st.cameraState.focusZTarget = useLoader ? YARD_FOCUS_Z : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useLoader]);

  // 3D-изометрия ↔ 2D-вид сверху: камера поднимается над складом и встаёт на ось,
  // подписи чанков разворачиваются под новый вид.
  useEffect(() => {
    if (!st.scene) return;

    const camera = st.cameraState;

    camera.elevationTarget = topView ? st.TOP_ELEVATION : ISO_ELEV;
    camera.thetaTarget = topView
      ? Math.round(camera.thetaTarget / (4 * QUARTER)) * 4 * QUARTER // север сверху
      : Math.round((camera.thetaTarget - Math.PI / 4) / QUARTER) * QUARTER + Math.PI / 4;

    st.chunkLabels.setTopView(topView, camera.thetaTarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topView]);

  useEffect(() => {
    if (!st.scene) return;
    st.cameraState.zoom = camZoom;
    st.applyFrustum();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camZoom]);

  // Подписи чанков зависят только от площади помещения.
  useEffect(() => {
    if (!st.scene) return;
    st.chunkLabels.setGrid(chunkGrid, st.cameraState.theta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chunkGrid]);

  // ==========================================================
  // Пересборка этажей и роботов
  // ==========================================================

  useEffect(() => {
    if (!st.scene) return;

    st.setLevelCount(floorsCount);

    st.levels.forEach((level, index) => {
      disposeFleets(level);
      level.crates.visible = !useLoader;
      level.vacuumGroup.clear();
      level.armGroup.clear();
      level.loaderGroup.clear();

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
          capacityKg: loader.capacityKg,
          cargoWeightKg: loader.cargoWeightKg,
          speedMps: loader.speedMps,
          metersPerUnit: chunkGrid.metersPerUnit,
          cargoPerHour: loader.cargoPerHour / floorsCount,
          truckPayload: loader.truckPayload,
          slotsPerLane: loader.slotsPerLane,
          routeLengthM: loader.routeLengthM,
          cargo: loader.cargo,
          startDelay: index * FLOOR_STAGGER_SECONDS,
          energyProfile: energyProfiles.loader,
        });
      }
    });

    drawFloorBase(st.floorCtx, { layout, armCount, vacuumCount, chunkGrid, slotsPerLane: loader.slotsPerLane });
    st.floorTexture.needsUpdate = true;

    st.simAcc = 0;
    setStats(EMPTY_STATS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    layout,
    chunkGrid,
    floorsCount,
    vacuumCount,
    vacuumSpeed,
    armCount,
    armProd,
    loaderCount,
    energyProfiles,
    loader.capacityKg,
    loader.speedMps,
    loader.cargoWeightKg,
    loader.cargoPerHour,
    loader.truckPayload,
    loader.slotsPerLane,
    loader.routeLengthM,
    loader.cargo.lengthCm,
    loader.cargo.widthCm,
    loader.cargo.heightCm,
    loader.cargo.skuCount,
    resetKey,
    modelState,
  ]);

  // ==========================================================
  // Покадровый цикл
  // ==========================================================

  useEffect(() => {
    if (!st.scene) return;

    // Все шаги множителя скорости за один кадр; если кадр не укладывается в бюджет
    // времени, лишние шаги пропускаются — симуляция замедляется, а страница не
    // зависает. Возвращает, сколько шагов выполнено.
    const stepSimulation = (dt, wanted) => {
      const startedAt = performance.now();
      let executed = 0;

      while (executed < wanted && (executed === 0 || performance.now() - startedAt < STEP_BUDGET_MS)) {
        for (const level of st.levels) {
          level.vacuumFleet?.step(dt);
          level.armFleet?.step(dt);
          level.loaderSystem?.step(dt);
        }

        executed++;
      }

      return executed;
    };

    const tick = (timestamp) => {
      st.raf = requestAnimationFrame(tick);
      st.clock.update(timestamp);
      const realDt = Math.min(st.clock.getDelta(), MAX_FRAME_SECONDS);

      st.cameraState.theta += (st.cameraState.thetaTarget - st.cameraState.theta) * 0.12;
      st.updateCamera(st.activeFloor);
      st.chunkLabels.update(st.cameraState.theta);

      if (running) {
        const executed = stepSimulation(realDt, speedMult);

        st.simAcc += realDt * executed;
        if (st.beltTexture) st.beltTexture.offset.y -= 0.45 * realDt * executed;

        // Угасание следа — в реальном времени, один раз за кадр (не за шаг).
        for (const level of st.levels) level.vacuumFleet?.updateFades(realDt);

        if (timestamp - st.lastPublish >= STATS_INTERVAL_MS) {
          st.lastPublish = timestamp;
          publish();
        }
      }

      st.render(st.activeFloor);
    };

    tick(performance.now());

    return () => cancelAnimationFrame(st.raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, speedMult, vacuumZoneCells]);

  // Переключение этажа: показатели сразу берём с нового этажа, а не ждём следующего обновления.
  useEffect(() => {
    if (st.scene) publish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorIndex]);

  return {
    mountRef,
    stats,
    modelState,
    rotate: (direction) => {
      st.cameraState.thetaTarget += direction * QUARTER;
    },
  };
}
