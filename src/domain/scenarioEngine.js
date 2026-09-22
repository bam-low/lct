// Ядро расчёта экономического сценария (ТЗ 3.5.2, 3.5.5) — не зависит от типа
// объекта. Работает с произвольным набором «групп роботов» (процесс + решение +
// количество), которые ему выдаёт адаптер конкретного объекта (warehouseAdapter.js,
// а в будущем airportAdapter.js/medicalAdapter.js — ТЗ 4.2.6: новый тип объекта не
// должен требовать переработки этого модуля, только свой адаптер).
//
// Адаптер отвечает за то, как для его объекта считается пиковый спрос и
// эффективная производительность одного робота (это у каждого типа объекта
// своё — м²/ч для уборки, оп/ч для сортировки, рейсы/ч для перрона и т.д.);
// само превращение "спрос + производительность" → "количество роботов" и
// "решения + количества" → "CAPEX/OPEX/эффект/окупаемость/ROI/TCO" — общее.

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

export const RESERVE_RATIO = 0.05;

export const hoursPerShift = (params) => params.shiftHoursPerDay || 8;
export const operatingHoursPerDay = (params) => hoursPerShift(params) * (params.shiftsPerDay || 1);

// Количество роботов «по расчёту» для набора процессов (ТЗ 3.5.2):
// processes — [{ key, peakDemand, solution, throughputPerRobot }].
// Возвращает { [key]: { count, throughputPerRobot, peakDemand } }.
export function computeGroupCounts(params, processes) {
  const result = {};

  for (const process of processes) {
    result[process.key] = {
      count: process.solution
        ? requiredRobotCount({
            peakDemand: process.peakDemand,
            throughputPerRobot: process.throughputPerRobot,
            loadFactor: params.loadFactor,
          })
        : 0,
      throughputPerRobot: process.throughputPerRobot,
      peakDemand: process.peakDemand,
    };
  }

  return result;
}

// Электроэнергия за год, ₽: работа и простой в смену с учётом коэффициента
// загрузки. Робот с батареей берёт из сети больше, чем расходует, — потери
// зарядки (CHARGE_EFFICIENCY).
function energyCostPerYear(solution, count, params) {
  const energy = solution.technical.energy;
  if (!energy) return 0;

  const hours = operatingHoursPerDay(params) * (params.daysPerYear ?? 0);
  const load = params.loadFactor ?? 1;
  const usedKwh = (energy.workPowerKw * load + energy.idlePowerKw * (1 - load)) * hours;
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

// Годовой ФОТ текущего ручного процесса: часы считаем как operatingHoursPerDay
// (смена × число смен в сутки) — иначе при нескольких сменах эта функция занижала
// бы затраты на персонал, а вместе с ними и «экономию труда» от роботизации.
export function baselineOpexOf(params) {
  return (params.staffCount ?? 0) * (params.hourlyWage ?? 0) * operatingHoursPerDay(params) * (params.daysPerYear ?? 0);
}

function weightedLifespan(groups) {
  const spans = groups.map((g) => g.lifespanYears).filter((v) => v > 0);
  if (spans.length === 0) return 0;
  return spans.reduce((a, b) => a + b, 0) / spans.length;
}

// Строит один сценарий: 'baseline' | 'purchase' | 'raas'.
// groups — [{ solution, count }], произвольное число групп роботов (у склада —
// 3: пылесосы/роборуки/погрузчики; у другого объекта может быть иначе).
// extraAssumptions — допущения адаптера объекта, которые нужно показать
// пользователю вместе с формулами (ТЗ 3.5.1, 3.5.8).
export function buildScenario(kind, { params, groups, extraAssumptions = {} }) {
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
        ...extraAssumptions,
      },
    };
  }

  const econGroups = groups.map((g) => groupEconomics(g.solution, g.count, kind, params));
  const sumOf = (field) => econGroups.reduce((sum, g) => sum + g[field], 0);

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
  const lifespanYears = weightedLifespan(econGroups);

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
      ...extraAssumptions,
    },
  };
}

export function scaleSolutionCosts(solution, factor) {
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

// 'baseline' | 'purchase' | 'raas' сразу все три — сравнение сценариев (ТЗ 3.5.5).
export function buildAllScenarios({ params, groups, extraAssumptions }) {
  const input = { params, groups, extraAssumptions };

  return {
    baseline: buildScenario("baseline", input),
    purchase: buildScenario("purchase", input),
    raas: buildScenario("raas", input),
  };
}
