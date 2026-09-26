import { useEffect, useMemo, useState } from "react";
import { defaultParamsFor } from "../domain/objectTypes.js";
import { catalogFor, getCatalogItem } from "../domain/catalog.js";
import {
  buildAllScenarios,
  computeRobotCounts,
  currentProcessOf,
  effectiveThroughput,
  effectiveSlotsPerLane,
  fleetPeakPowerKw,
  requiredConveyorM,
  speedFactorOf,
} from "../domain/warehouseAdapter.js";
import { checkCapacity } from "../domain/applicability.js";
import { energyProfileOf } from "../simulation/energy.js";
import {
  MAX_VACUUM_COUNT,
  computeLayout,
  computeVacuumZoneAreaM2,
  normalizeRobotTypes,
} from "../simulation/layout.js";
import { deserializeShape, serializeShape } from "../simulation/shape/shapeTypes.js";
import { loadProject, saveProject } from "./projectStore.js";

const OBJECT_TYPE_ID = "warehouse"; // единственный рабочий тип объекта в этом заходе

// Какие процессы каталога закрывает каждый тип робота.
const PROCESS_OF_TYPE = { vacuum: "floor_cleaning", arm: "sorting", loader: "loading" };

// Старый формат сохранения хранил режим строкой ('vacuum' | 'arm' | 'both').
function typesFromLegacyMode(mode) {
  if (mode === "vacuum") return ["vacuum"];
  if (mode === "arm") return ["arm"];
  return ["vacuum", "arm"];
}

// Одна симуляция — один тип робота (или демо-связка): всё остальное из
// сохранённого состояния заменяется на демо.
function initialRobotTypes(saved) {
  return normalizeRobotTypes(saved?.robotTypes ?? (saved?.mode ? typesFromLegacyMode(saved.mode) : null));
}

function firstSolutionId(type) {
  return catalogFor(OBJECT_TYPE_ID, PROCESS_OF_TYPE[type])[0]?.id ?? null;
}

function initialState() {
  const saved = loadProject();

  // Параметры, добавленные позже (площадь, поток погрузки), берём из значений по
  // умолчанию — иначе в старых сохранениях они были бы пустыми.
  const params = { ...defaultParamsFor(OBJECT_TYPE_ID), ...saved?.params };
  const robotTypes = initialRobotTypes(saved);

  const solutionIds = {
    vacuum: saved?.vacuumSolutionId ?? firstSolutionId("vacuum"),
    arm: saved?.armSolutionId ?? firstSolutionId("arm"),
    loader: saved?.loaderSolutionId ?? firstSolutionId("loader"),
  };

  const shape = deserializeShape(saved?.shape);

  // Количество роботов всегда задаётся вручную (степпер в симуляции), но
  // стартовое значение подсказываем расчётом, чтобы не начинать с крайних.
  const layout = computeLayout(shape, robotTypes, workZoneShareOf(params));

  // Стартовое количество считаем на один этаж: на каждом этаже свой такой же парк,
  // а потоки операций заданы на всё здание.
  const auto = computeRobotCounts({
    params: perFloorParams(params),
    vacuumZoneAreaM2: computeVacuumZoneAreaM2(layout, params.floorAreaM2),
    vacuumSolution: getCatalogItem(solutionIds.vacuum),
    armSolution: getCatalogItem(solutionIds.arm),
    loaderSolution: getCatalogItem(solutionIds.loader),
  });

  return {
    params,
    robotTypes,
    shape,
    vacuumSolutionId: solutionIds.vacuum,
    armSolutionId: solutionIds.arm,
    loaderSolutionId: solutionIds.loader,
    manualVacuumCount: saved?.manualVacuumCount ?? Math.max(1, auto.vacuumCount),
    manualArmCount: saved?.manualArmCount ?? Math.max(1, auto.armCount),
    manualLoaderCount: saved?.manualLoaderCount ?? Math.max(1, auto.loaderCount),
    activeScenario: saved?.activeScenario ?? "purchase",
  };
}

const workZoneShareOf = (params) => (params.workZonePct ?? 100) / 100;

const clamp = (value, max) => Math.max(1, Math.min(max, value));

// Склад одноэтажный: система этажей осталась в симуляции (floorLevel.js) для
// медучреждений, а параметр «этажи» из схемы склада убран.
const floorsOf = () => 1;

// Потоки операций заданы на всё здание; на одном этаже — их доля.
function perFloorParams(params) {
  const floors = floorsOf(params);

  return {
    ...params,
    requiredSortThroughput: (params.requiredSortThroughput ?? 0) / floors,
    requiredLoadThroughput: (params.requiredLoadThroughput ?? 0) / floors,
    requiredOutboundThroughput: (params.requiredOutboundThroughput ?? 0) / floors,
  };
}

export function useEconomicsState() {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    // shape.cells — Uint8Array, не переживает JSON.stringify как обычный массив
    // (превратится в объект с числовыми ключами) — сериализуем явно.
    saveProject({ ...state, shape: serializeShape(state.shape) });
  }, [state]);

  const typesKey = state.robotTypes.join(",");
  const workZoneShare = workZoneShareOf(state.params);
  const layout = useMemo(
    () => computeLayout(state.shape, state.robotTypes, workZoneShare),
    [state.shape, state.robotTypes, workZoneShare]
  );
  const floors = floorsOf(state.params);
  // Площадь уборки одного этажа и всего здания (для расчёта потребности в уборке).
  const floorVacuumZoneAreaM2 = computeVacuumZoneAreaM2(layout, state.params.floorAreaM2);
  const vacuumZoneAreaM2 = floorVacuumZoneAreaM2 * floors;

  const selectedSolutions = {
    vacuum: getCatalogItem(state.vacuumSolutionId),
    arm: getCatalogItem(state.armSolutionId),
    loader: getCatalogItem(state.loaderSolutionId),
  };

  // В расчёт идут только выбранные типы роботов: невыбранный тип не даёт ни
  // роботов, ни стоимости.
  const activeSolutions = {
    vacuum: layout.useVacuum ? selectedSolutions.vacuum : null,
    arm: layout.useArm ? selectedSolutions.arm : null,
    loader: layout.useLoader ? selectedSolutions.loader : null,
  };

  // Количество на одном этаже — то, что реально помещается на площади и стоит на экране.
  const counts = {
    vacuumCount: layout.useVacuum ? clamp(state.manualVacuumCount, MAX_VACUUM_COUNT) : 0,
    armCount: layout.useArm ? clamp(state.manualArmCount, layout.maxArmCount) : 0,
    loaderCount: layout.useLoader ? clamp(state.manualLoaderCount, layout.maxLoaderCount) : 0,
  };

  // Расчётная рекомендация «по ТЗ 3.5.2» — пересчитывается на каждое изменение
  // параметров/решения, чтобы степпер мог показать актуальное «по расчёту: N»
  // и вернуть к нему одним кликом, а не только один раз при первой загрузке.
  const recommended = useMemo(
    () =>
      computeRobotCounts({
        params: perFloorParams(state.params),
        vacuumZoneAreaM2: floorVacuumZoneAreaM2,
        vacuumSolution: activeSolutions.vacuum,
        armSolution: activeSolutions.arm,
        loaderSolution: activeSolutions.loader,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.params, floorVacuumZoneAreaM2, state.vacuumSolutionId, state.armSolutionId, state.loaderSolutionId, typesKey]
  );

  const recommendedCounts = {
    vacuumCount: layout.useVacuum ? clamp(recommended.vacuumCount, MAX_VACUUM_COUNT) : 0,
    armCount: layout.useArm ? clamp(recommended.armCount, layout.maxArmCount) : 0,
    loaderCount: layout.useLoader ? clamp(recommended.loaderCount, layout.maxLoaderCount) : 0,
  };

  // Энергопрофили выбранных решений: время работы на зарядке, мощность и т.д.
  // Считаются здесь, чтобы у сцены была стабильная ссылка и она не пересобиралась зря.
  const energyProfiles = useMemo(
    () => ({
      vacuum: energyProfileOf(activeSolutions.vacuum),
      arm: energyProfileOf(activeSolutions.arm),
      loader: energyProfileOf(activeSolutions.loader),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.vacuumSolutionId, state.armSolutionId, state.loaderSolutionId, typesKey]
  );

  // В экономику идёт парк всего здания: на каждом этаже такие же роботы.
  const totalCounts = {
    vacuumCount: counts.vacuumCount * floors,
    armCount: counts.armCount * floors,
    loaderCount: counts.loaderCount * floors,
  };

  // Инфраструктурная применимость выбранного парка (ТЗ 3.4.1/3.4.3) — сверка с
  // тем, что реально доступно на объекте: мощность электроснабжения и длина
  // конвейера (только у решений, которым он нужен по каталогу).
  const fleetGroups = [
    { solution: activeSolutions.vacuum, count: totalCounts.vacuumCount },
    { solution: activeSolutions.arm, count: totalCounts.armCount },
    { solution: activeSolutions.loader, count: totalCounts.loaderCount },
  ];
  const powerCheck = checkCapacity(fleetPeakPowerKw(fleetGroups), state.params.availablePowerKw, "кВт");
  const conveyorCheck = checkCapacity(requiredConveyorM(fleetGroups), state.params.conveyorLengthM, "м");

  const scenarios = useMemo(
    () =>
      buildAllScenarios({
        params: state.params,
        vacuumSolution: activeSolutions.vacuum,
        armSolution: activeSolutions.arm,
        loaderSolution: activeSolutions.loader,
        counts: totalCounts,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      state.params,
      state.vacuumSolutionId,
      state.armSolutionId,
      state.loaderSolutionId,
      typesKey,
      totalCounts.vacuumCount,
      totalCounts.armCount,
      totalCounts.loaderCount,
    ]
  );

  const setParam = (key, value) =>
    setState((s) => ({ ...s, params: { ...s.params, [key]: value } }));

  // Массовое применение — например, после загрузки параметров из файла
  // (ТЗ 3.2.3), одним обновлением состояния вместо цепочки setParam.
  const setParams = (partial) => setState((s) => ({ ...s, params: { ...s.params, ...partial } }));

  const setRobotTypes = (types) => setState((s) => ({ ...s, robotTypes: normalizeRobotTypes(types) }));
  const setShape = (shape) => setState((s) => ({ ...s, shape }));

  const setVacuumSolutionId = (id) => setState((s) => ({ ...s, vacuumSolutionId: id }));
  const setArmSolutionId = (id) => setState((s) => ({ ...s, armSolutionId: id }));
  const setLoaderSolutionId = (id) => setState((s) => ({ ...s, loaderSolutionId: id }));

  const setManualVacuumCount = (n) => setState((s) => ({ ...s, manualVacuumCount: n }));
  const setManualArmCount = (n) => setState((s) => ({ ...s, manualArmCount: n }));
  const setManualLoaderCount = (n) => setState((s) => ({ ...s, manualLoaderCount: n }));

  const setActiveScenario = (kind) => setState((s) => ({ ...s, activeScenario: kind }));

  return {
    objectTypeId: OBJECT_TYPE_ID,
    params: state.params,
    robotTypes: state.robotTypes,
    shape: state.shape,
    layout,
    floors,
    vacuumZoneAreaM2,
    selectedSolutions,
    activeSolutions,
    energyProfiles,
    counts,
    recommendedCounts,
    totalCounts,
    workZoneShare,
    speedFactor: speedFactorOf(state.params),
    slotsPerLane: effectiveSlotsPerLane(state.params),
    currentProcess: currentProcessOf(state.params, layout),
    throughputs: {
      vacuum: effectiveThroughput(activeSolutions.vacuum, state.params),
      arm: effectiveThroughput(activeSolutions.arm, state.params),
      loader: effectiveThroughput(activeSolutions.loader, state.params),
    },
    powerCheck,
    conveyorCheck,
    activeScenario: state.activeScenario,
    scenarios,

    setParam,
    setParams,
    setRobotTypes,
    setShape,
    setVacuumSolutionId,
    setArmSolutionId,
    setLoaderSolutionId,
    setManualVacuumCount,
    setManualArmCount,
    setManualLoaderCount,
    setActiveScenario,
  };
}
