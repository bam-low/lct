// Адаптер «параметры склада + выбранные решения → нормализованные входы economics.js».
// Единственный модуль, который придётся продублировать (adapters/airportAdapter.js,
// adapters/medicalAdapter.js), когда другие типы объектов станут рабочими — сам
// economics.js и структура сценария меняться не должны (ТЗ 4.2.6).

import {
  requiredRobotCount,
  capexTotal,
  opexTotal,
  annualEffect,
  paybackPeriod,
  roi,
  tco,
  linearDepreciationPerYear,
} from "./economics.js";
import { CHARGE_EFFICIENCY } from "../simulation/energy.js";

const RESERVE_RATIO = 0.05;

// Пиковая потребность в уборке, м²/ч: площадь зоны нужно убрать за одну смену.
export function vacuumPeakDemand(params, vacuumZoneAreaM2) {
  const hours = params.shiftHoursPerDay || 8;
  return vacuumZoneAreaM2 / hours;
}

// Пиковая потребность сортировки, оп/ч — напрямую задаётся параметром объекта.
export function armPeakDemand(params) {
  return params.requiredSortThroughput ?? 0;
}

// Пиковая потребность погрузки, грузовых единиц/ч (одна единица — 50 кг).
export function loaderPeakDemand(params) {
  return params.requiredLoadThroughput ?? 0;
}

// Количество роботов «по расчёту» (ТЗ 3.5.2) — единый источник для симуляции и экономики.
export function computeRobotCounts({ params, vacuumZoneAreaM2, vacuumSolution, armSolution, loaderSolution }) {
  const vacuumThroughput = vacuumSolution?.technical.throughput ?? 0;
  const vacuumPeak = vacuumPeakDemand(params, vacuumZoneAreaM2);

  const vacuumCount = vacuumSolution
    ? requiredRobotCount({
        peakDemand: vacuumPeak,
        throughputPerRobot: vacuumThroughput,
        loadFactor: params.loadFactor,
      })
    : 0;

  const armThroughput = armSolution?.technical.throughput ?? 0;
  const armPeak = armPeakDemand(params);

  const armCount = armSolution
    ? requiredRobotCount({
        peakDemand: armPeak,
        throughputPerRobot: armThroughput,
        loadFactor: params.loadFactor,
      })
    : 0;

  const loaderThroughput = loaderSolution?.technical.throughput ?? 0;
  const loaderPeak = loaderPeakDemand(params);

  const loaderCount = loaderSolution
    ? requiredRobotCount({
        peakDemand: loaderPeak,
        throughputPerRobot: loaderThroughput,
        loadFactor: params.loadFactor,
      })
    : 0;

  return {
    vacuumCount,
    vacuumThroughput,
    vacuumPeak,
    armCount,
    armThroughput,
    armPeak,
    loaderCount,
    loaderThroughput,
    loaderPeak,
  };
}

// Электроэнергия за год, ₽: работа и простой в смену с учётом коэффициента
// загрузки. Робот с батареей берёт из сети больше, чем расходует, — потери
// зарядки (CHARGE_EFFICIENCY). Для симуляции те же цифры считает energy.js.
function energyCostPerYear(solution, count, params) {
  const energy = solution.technical.energy;
  if (!energy) return 0;

  const shiftHours = (params.shiftHoursPerDay ?? 0) * (params.daysPerYear ?? 0);
  const load = params.loadFactor ?? 1;
  const usedKwh = (energy.workPowerKw * load + energy.idlePowerKw * (1 - load)) * shiftHours;
  const gridKwh = solution.technical.autonomyHours ? usedKwh / CHARGE_EFFICIENCY : usedKwh;

  return count * gridKwh * (params.electricityTariff ?? 0);
}

function groupEconomics(solution, count, kind, params) {
  if (!solution || count <= 0) {
    return { equipment: 0, software: 0, integration: 0, service: 0, repair: 0, energy: 0, lifespanYears: 0 };
  }

  const e = solution.economics;
  const energy = energyCostPerYear(solution, count, params);

  if (kind === "raas") {
    return {
      equipment: 0,
      software: 0,
      integration: 0,
      service: count * (e.raas?.monthlyRate ?? 0) * 12,
      repair: 0,
      energy,
      lifespanYears: e.lifespanYears,
    };
  }

  return {
    equipment: count * e.equipmentCost,
    software: count * e.softwareCost,
    integration: count * e.implementationCost,
    service: count * e.serviceCostPerYear,
    repair: count * e.maintenanceCostPerYear,
    energy,
    lifespanYears: e.lifespanYears,
  };
}

function baselineOpexOf(params) {
  return (
    (params.staffCount ?? 0) *
    (params.hourlyWage ?? 0) *
    (params.shiftHoursPerDay ?? 0) *
    (params.daysPerYear ?? 0)
  );
}

function weightedLifespan(...groups) {
  const spans = groups.map((g) => g.lifespanYears).filter((v) => v > 0);
  if (spans.length === 0) return 0;
  return spans.reduce((a, b) => a + b, 0) / spans.length;
}

// Строит один сценарий: 'baseline' | 'purchase' | 'raas'.
// counts — { vacuumCount, armCount, loaderCount }, обычно из computeRobotCounts(), но может
// быть подменено вручную (what-if / ручная корректировка — ТЗ 3.5.3–3.5.4).
export function buildWarehouseScenario(kind, { params, vacuumSolution, armSolution, loaderSolution, counts }) {
  const baselineOpex = baselineOpexOf(params);

  if (kind === "baseline") {
    return {
      kind,
      capex: 0,
      opexPerYear: baselineOpex,
      effect: 0,
      paybackYears: null,
      roiPct: null,
      tcoValue: baselineOpex * (params.horizonYears ?? 5),
      depreciationPerYear: 0,
      assumptions: {
        laborSavingsAssumption:
          "Базовый сценарий — текущий ручной процесс, эффект не считается относительно самого себя.",
      },
    };
  }

  const vacuumEcon = groupEconomics(vacuumSolution, counts.vacuumCount, kind, params);
  const armEcon = groupEconomics(armSolution, counts.armCount, kind, params);
  const loaderEcon = groupEconomics(loaderSolution, counts.loaderCount ?? 0, kind, params);
  const groups = [vacuumEcon, armEcon, loaderEcon];
  const sumOf = (field) => groups.reduce((sum, g) => sum + g[field], 0);

  const rawCapex = capexTotal({
    equipment: sumOf("equipment"),
    software: sumOf("software"),
    integration: sumOf("integration"),
  });

  const capex = rawCapex + rawCapex * RESERVE_RATIO;

  const opexPerYear = opexTotal({
    service: sumOf("service"),
    repair: sumOf("repair"),
    energy: sumOf("energy"),
  });

  const effect = annualEffect({
    laborSavings: baselineOpex,
    additionalOpex: opexPerYear,
  });

  const horizonYears = params.horizonYears ?? 5;
  const lifespanYears = weightedLifespan(...groups);

  return {
    kind,
    capex,
    opexPerYear,
    effect,
    paybackYears: paybackPeriod(capex, effect),
    roiPct: roi(effect, capex, horizonYears),
    tcoValue: tco({ capex, opexPerYear, horizonYears, lifespanYears }),
    depreciationPerYear: linearDepreciationPerYear(capex, lifespanYears),
    assumptions: {
      laborSavingsAssumption:
        "Допущение: роботизация полностью заменяет ручной труд на данном процессе — экономия труда = текущий ФОТ процесса.",
      reserveRatio: RESERVE_RATIO,
      lifespanYears,
    },
  };
}

function scaleSolutionCosts(solution, factor) {
  if (!solution) return null;

  const e = solution.economics;

  return {
    ...solution,
    economics: {
      ...e,
      equipmentCost: e.equipmentCost * factor,
      softwareCost: e.softwareCost * factor,
      implementationCost: e.implementationCost * factor,
      maintenanceCostPerYear: e.maintenanceCostPerYear * factor,
      serviceCostPerYear: e.serviceCostPerYear * factor,
      raas: e.raas ? { ...e.raas, monthlyRate: e.raas.monthlyRate * factor } : e.raas,
    },
  };
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
  const input = { params, vacuumSolution, armSolution, loaderSolution, counts };

  return {
    counts,
    baseline: buildWarehouseScenario("baseline", input),
    purchase: buildWarehouseScenario("purchase", input),
    raas: buildWarehouseScenario("raas", input),
  };
}
