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
import { formatCurrencyRUB } from "./economics.js";

// Финансовый резерв на непредвиденные расходы внедрения — процент сверх суммы
// статей CAPEX (не путать с params.reserveFactor: тот — эксплуатационный запас
// парка роботов на пики/поломки, применяется отдельно при расчёте их количества).
export const CAPEX_RESERVE_RATIO = 0.05;

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
            reserveFactor: params.reserveFactor,
          })
        : 0,
      throughputPerRobot: process.throughputPerRobot,
      peakDemand: process.peakDemand,
    };
  }

  return result;
}

// Суммарная пиковая электрическая мощность парка, кВт — общая для любого типа
// объекта (нужна только структура групп и technical.energy.workPowerKw из
// каталога), поэтому живёт в ядре, а не дублируется в каждом адаптере.
export function fleetPeakPowerKw(groups) {
  return groups.reduce((sum, g) => sum + (g.solution?.technical?.energy?.workPowerKw ?? 0) * (g.count ?? 0), 0);
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
    return {
      equipment: 0,
      infrastructure: 0,
      software: 0,
      integration: 0,
      commissioning: 0,
      training: 0,
      service: 0,
      repair: 0,
      energy: 0,
      lifespanYears: 0,
    };
  }

  const e = solution.economics;
  const energy = energyCostPerYear(solution, count, params);

  if (kind === "raas") {
    return {
      equipment: 0,
      infrastructure: 0,
      software: 0,
      integration: 0,
      commissioning: 0,
      training: 0,
      service: count * (e.raas?.monthlyRate ?? 0) * 12,
      repair: 0,
      energy,
      lifespanYears: e.lifespanYears,
    };
  }

  return {
    equipment: count * e.equipmentCost,
    infrastructure: count * (e.infrastructureCost ?? 0),
    software: count * e.softwareCost,
    integration: count * e.implementationCost,
    commissioning: count * (e.commissioningCost ?? 0),
    training: count * (e.trainingCost ?? 0),
    service: count * e.serviceCostPerYear,
    repair: count * e.maintenanceCostPerYear,
    energy,
    lifespanYears: e.lifespanYears,
  };
}

function weightedLifespan(groups) {
  const spans = groups.map((g) => g.lifespanYears).filter((v) => v > 0);
  if (spans.length === 0) return 0;
  return spans.reduce((a, b) => a + b, 0) / spans.length;
}

// Модель RaaS выбрана как фиксированная ежемесячная плата за робота, без
// CAPEX (ТЗ Дополнения 2.4 оставляет структуру платежа и условия контракта на
// усмотрение команды) — здесь эта договорённость становится явной и видимой
// пользователю (ТЗ 3.5.8), а не просто цифрой в OPEX. Условия (срок контракта,
// опция выкупа) лежат в каталоге у каждого решения (economics.raas), но раньше
// нигде не показывались.
function raasModelAssumptionOf(groups) {
  const active = groups.filter((g) => g.solution && g.count > 0);
  if (active.length === 0) return null;

  const terms = active.map((g) => {
    const raas = g.solution.economics.raas;
    if (!raas) return `${g.solution.identification.name} — условия RaaS не заданы в каталоге`;

    const buyout = raas.buyoutOption ? "выкуп по истечении контракта возможен" : "выкуп не предусмотрен";
    return `${g.solution.identification.name} — ${formatCurrencyRUB(raas.monthlyRate)}/мес за робота, контракт ${raas.contractMonths} мес., ${buyout}`;
  });

  return `Модель RaaS: фиксированная ежемесячная плата за робота, CAPEX≈0 — вся стоимость в OPEX. ${terms.join("; ")}.`;
}

// Строит один сценарий: 'baseline' | 'purchase' | 'raas'.
// groups — [{ solution, count }], произвольное число групп роботов (у склада —
// 3: пылесосы/роборуки/погрузчики; у другого объекта может быть иначе).
// baselineOpex — годовой ФОТ текущего ручного процесса, ₽; laborSavings —
// сколько из него реально экономит парк, ₽ (не доля — абсолютная сумма). Оба
// считает адаптер объекта: только он знает модель персонала (роли, начисления,
// потери рабочего времени) и как сопоставить пропускную способность купленных
// роботов с производительностью персонала для своих процессов — здесь это уже
// готовые числа, а не формулы (ТЗ 4.2.6: ядро не должно знать про склад/
// аэропорт/медучреждение и про то, как у них устроен персонал).
// extraAssumptions — допущения адаптера объекта, которые нужно показать
// пользователю вместе с формулами (ТЗ 3.5.1, 3.5.8); может переопределить
// laborSavingsAssumption по умолчанию своим текстом.
export function buildScenario(kind, { params, groups, baselineOpex = 0, laborSavings = 0, extraAssumptions = {} }) {
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
    infrastructure: sumOf("infrastructure"),
    software: sumOf("software"),
    integration: sumOf("integration"),
    commissioning: sumOf("commissioning"),
    training: sumOf("training"),
  });

  const capex = rawCapex + rawCapex * CAPEX_RESERVE_RATIO;

  const opexPerYear = opexTotal({
    service: sumOf("service"),
    repair: sumOf("repair"),
    energy: sumOf("energy"),
  });

  const effect = annualEffect({
    laborSavings,
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
      // Дефолт на случай, если адаптер объекта не передал своё описание модели
      // персонала через extraAssumptions (у склада — всегда передаёт, см.
      // warehouseAdapter.js laborSavingsAssumptionOf).
      laborSavingsAssumption:
        baselineOpex > 0
          ? `Допущение: экономия труда — ${Math.round(Math.min(100, (laborSavings / baselineOpex) * 100))}% текущего ФОТ процесса.`
          : "Базовый ФОТ процесса не задан — экономия труда не считается.",
      capexReserveRatio: CAPEX_RESERVE_RATIO,
      fleetReserveFactor: params.reserveFactor ?? 1,
      lifespanYears,
      raasModelAssumption: kind === "raas" ? raasModelAssumptionOf(groups) : null,
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
      infrastructureCost: (e.infrastructureCost ?? 0) * factor,
      softwareCost: e.softwareCost * factor,
      implementationCost: e.implementationCost * factor,
      commissioningCost: (e.commissioningCost ?? 0) * factor,
      trainingCost: (e.trainingCost ?? 0) * factor,
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
