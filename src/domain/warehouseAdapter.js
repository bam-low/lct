// Адаптер «параметры склада + выбранные решения → нормализованные входы
// scenarioEngine.js/economics.js». Единственный модуль, который придётся
// продублировать (adapters/airportAdapter.js, adapters/medicalAdapter.js), когда
// другие типы объектов станут рабочими: он даёт общему ядру (scenarioEngine.js)
// пиковый спрос и эффективную производительность по формулам, специфичным для
// склада, а само ядро расчёта экономики и структура сценария не меняются
// (ТЗ 4.2.6).

import { computeGroupCounts, buildScenario, buildAllScenarios as buildAllScenariosGeneric, scaleSolutionCosts, hoursPerShift, operatingHoursPerDay } from "./scenarioEngine.js";
import { LOAD_SLOWDOWN } from "../simulation/constants.js";
import { selectOption } from "./objectTypes.js";

const LOADER_HANDLING_SECONDS = 25; // подъём/опускание вил, повороты, заезд в полосу и выезд за один рейс

// Допущение об одной агрегированной роли персонала (ТЗ 3.5.1 требует явно
// документировать допущения). На реальном складе за один и тот же процесс
// обычно отвечает несколько ролей с разными ФОТ и выработкой (например, по
// демо-датасету организатора: отборщики, операторы погрузчиков, операторы
// упаковки — 100/25/20 чел. с разными окладами); здесь они свёрнуты в одну
// пару "staffCount × hourlyWage × manualProductivity".
const STAFF_MODEL_ASSUMPTION =
  "Персонал текущего процесса задан одной агрегированной ролью (численность × ставка × выработка), " +
  "а не по фактическим ролям (отборщики, операторы погрузчиков, упаковка и т.д. со своими окладами) — " +
  "упрощение для экспресс-оценки; для точного ФОТ нужна разбивка по ролям.";

export { hoursPerShift, operatingHoursPerDay };

// Во сколько раз ограничения планировки (колонны, узкие проходы) замедляют роботов.
export const speedFactorOf = (params) => selectOption("warehouse", "layoutRestriction", params.layoutRestriction)?.speedFactor ?? 1;

// Расчётный цикл погрузчика (с): порожний путь до груза, путь с грузом (он медленнее
// — LOAD_SLOWDOWN) и возня с вилами. Протяжённость маршрута задана в параметрах.
export function loaderCycleSeconds(solution, params) {
  const speed = solution.technical.speed ?? 2;
  const capacity = solution.technical.capacityKg ?? 100;
  const loadRatio = Math.min(1, (params.cargoWeightKg ?? 50) / capacity);
  const route = params.routeLengthM ?? 60;

  return route / speed + route / (speed * (1 - LOAD_SLOWDOWN * loadRatio)) + LOADER_HANDLING_SECONDS;
}

// Производительность одного робота, которую реально можно ждать на этом объекте:
// у пылесоса и роборуки — паспортная (пылесос — с поправкой на планировку), у
// погрузчика — меньшая из паспортной и рассчитанной по длине маршрута.
export function effectiveThroughput(solution, params) {
  if (!solution) return 0;

  const nominal = solution.technical.throughput ?? 0;
  const type = solution.identification.type;

  if (type === "loader") {
    return Math.min(nominal, 3600 / loaderCycleSeconds(solution, params)) * speedFactorOf(params);
  }

  return type === "vacuum" ? nominal * speedFactorOf(params) : nominal;
}

// Пиковая потребность в уборке, м²/ч: площадь зоны нужно убрать за одну смену.
export function vacuumPeakDemand(params, vacuumZoneAreaM2) {
  return vacuumZoneAreaM2 / hoursPerShift(params);
}

// Пиковая потребность сортировки, оп/ч: среднечасовой поток параметра объекта,
// переведённый в пиковый через peakLoadFactor (ТЗ 3.5.2 — считать роботов по
// пиковой, а не средней нагрузке).
export function armPeakDemand(params) {
  return (params.requiredSortThroughput ?? 0) * (params.peakLoadFactor ?? 1);
}

// Пиковая потребность погрузчиков, грузовых единиц/ч: принять входящий груз и
// подать исходящий к воротам, тоже с поправкой на пиковый коэффициент. Сама
// симуляция при этом продолжает ехать на среднечасовом потоке (params.requiredLoad/
// OutboundThroughput без поправки) — так в «Подтверждении расчёта симуляцией»
// видно резерв мощности парка, рассчитанного на пик, над средним фактическим потоком.
export function loaderPeakDemand(params) {
  return ((params.requiredLoadThroughput ?? 0) + (params.requiredOutboundThroughput ?? 0)) * (params.peakLoadFactor ?? 1);
}

// Потребность склада в операциях, которые сейчас делает персонал: то, что
// закрывают выбранные роботы (без уборки — она измеряется в м²).
export function currentProcessOf(params, { useArm, useLoader }) {
  const demand = (useArm ? armPeakDemand(params) : 0) + (useLoader ? loaderPeakDemand(params) : 0);
  const capacity = (params.staffCount ?? 0) * (params.manualProductivity ?? 0);

  return { demand, capacity, coveragePct: demand > 0 ? Math.min(999, (capacity / demand) * 100) : null };
}

// Количество роботов «по расчёту» (ТЗ 3.5.2) — единый источник для симуляции и
// экономики. Собирает три процесса склада в общий формат scenarioEngine.js
// (computeGroupCounts) и раскладывает результат обратно в именованные поля,
// которые ждут остальные модули (useEconomicsState.js и т.д.).
export function computeRobotCounts({ params, vacuumZoneAreaM2, vacuumSolution, armSolution, loaderSolution }) {
  const groups = computeGroupCounts(params, [
    { key: "vacuum", solution: vacuumSolution, peakDemand: vacuumPeakDemand(params, vacuumZoneAreaM2), throughputPerRobot: effectiveThroughput(vacuumSolution, params) },
    { key: "arm", solution: armSolution, peakDemand: armPeakDemand(params), throughputPerRobot: effectiveThroughput(armSolution, params) },
    { key: "loader", solution: loaderSolution, peakDemand: loaderPeakDemand(params), throughputPerRobot: effectiveThroughput(loaderSolution, params) },
  ]);

  return {
    vacuumCount: groups.vacuum.count,
    vacuumThroughput: groups.vacuum.throughputPerRobot,
    vacuumPeak: groups.vacuum.peakDemand,
    armCount: groups.arm.count,
    armThroughput: groups.arm.throughputPerRobot,
    armPeak: groups.arm.peakDemand,
    loaderCount: groups.loader.count,
    loaderThroughput: groups.loader.throughputPerRobot,
    loaderPeak: groups.loader.peakDemand,
  };
}

// Строит один сценарий: 'baseline' | 'purchase' | 'raas'.
// counts — { vacuumCount, armCount, loaderCount }, обычно из computeRobotCounts(), но может
// быть подменено вручную (what-if / ручная корректировка — ТЗ 3.5.3–3.5.4).
export function buildWarehouseScenario(kind, { params, vacuumSolution, armSolution, loaderSolution, counts }) {
  return buildScenario(kind, {
    params,
    groups: [
      { solution: vacuumSolution, count: counts.vacuumCount },
      { solution: armSolution, count: counts.armCount },
      { solution: loaderSolution, count: counts.loaderCount ?? 0 },
    ],
    extraAssumptions: { staffModelAssumption: STAFF_MODEL_ASSUMPTION },
  });
}

// What-if / sensitivity (ТЗ 3.5.6): пересчёт сценария "покупка" при сдвиге
// стоимости оборудования, стоимости труда и требуемого объёма операций —
// без побочных эффектов на основной state приложения.
export function buildSensitivityScenario({
  params,
  vacuumZoneAreaM2,
  vacuumSolution,
  armSolution,
  loaderSolution,
  equipmentFactor = 1,
  laborFactor = 1,
  demandFactor = 1,
}) {
  const shiftedParams = {
    ...params,
    hourlyWage: (params.hourlyWage ?? 0) * laborFactor,
    requiredSortThroughput: (params.requiredSortThroughput ?? 0) * demandFactor,
    requiredLoadThroughput: (params.requiredLoadThroughput ?? 0) * demandFactor,
    requiredOutboundThroughput: (params.requiredOutboundThroughput ?? 0) * demandFactor,
  };

  const shiftedVacuumSolution = scaleSolutionCosts(vacuumSolution, equipmentFactor);
  const shiftedArmSolution = scaleSolutionCosts(armSolution, equipmentFactor);
  const shiftedLoaderSolution = scaleSolutionCosts(loaderSolution, equipmentFactor);

  const counts = computeRobotCounts({
    params: shiftedParams,
    vacuumZoneAreaM2: vacuumZoneAreaM2 * demandFactor,
    vacuumSolution: shiftedVacuumSolution,
    armSolution: shiftedArmSolution,
    loaderSolution: shiftedLoaderSolution,
  });

  return buildWarehouseScenario("purchase", {
    params: shiftedParams,
    vacuumSolution: shiftedVacuumSolution,
    armSolution: shiftedArmSolution,
    loaderSolution: shiftedLoaderSolution,
    counts,
  });
}

// counts всегда приходит из вызывающего кода (в проекте — ручной ввод
// пользователя, см. useEconomicsState); computeRobotCounts() остаётся
// отдельной утилитой для тех мест, где нужна именно расчётная рекомендация
// (например, стартовое значение или SensitivityPanel).
export function buildAllScenarios({ params, vacuumSolution, armSolution, loaderSolution, counts }) {
  return buildAllScenariosGeneric({
    params,
    groups: [
      { solution: vacuumSolution, count: counts.vacuumCount },
      { solution: armSolution, count: counts.armCount },
      { solution: loaderSolution, count: counts.loaderCount ?? 0 },
    ],
    extraAssumptions: { staffModelAssumption: STAFF_MODEL_ASSUMPTION },
  });
}
