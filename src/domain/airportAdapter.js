// Адаптер «параметры аэропорта + выбранное решение → нормализованные входы
// scenarioEngine.js/economics.js» — второй рабочий тип объекта после склада,
// построенный по тому же принципу (ТЗ 4.2.6): ядро (scenarioEngine.js/
// economics.js) не изменилось ни на строку ради аэропорта.
//
// Временно упрощён до одного процесса — «Транспортировка грузов» (по прямому
// указанию: багаж/рамп/уборка убраны, остаётся только выбор транспортировщика,
// той же модели, что и у склада, см. robots/transporterRobot.js). Параметры
// терминала/пассажиропотока/рампа в схеме объекта (objectTypes.js) не тронуты —
// это контекст объекта, просто сейчас считается только транспортировка.
//
// Отличия от warehouseAdapter.js, специфичные для аэропорта (ТЗ 7.5 — явно
// документированы, а не спрятаны в коде):
// 1) Аэропорт работает практически непрерывно — в датасете организатора нет
//    полей «часов в смену»/«смен в сутки», поэтому режим работы (24 ч/сутки,
//    365 дн/год, условно 3 смены) — фиксированные допущения ниже, а не поля формы.
// 2) Пиковый спрос по рейсам задан в датасете НАПРЯМУЮ (peakFlightsPerHour), а
//    не выводится из среднего коэффициентом (как peakLoadFactor у склада).
// 3) Нормы выработки на человека (оп/чел·ч) в датасете организатора для
//    аэропорта нет — задана оценочным полем схемы (rampOpsPerPersonHour),
//    это прямо отмечено в его hint.

import { computeGroupCounts, buildScenario, scaleSolutionCosts, fleetPeakPowerKw } from "./scenarioEngine.js";

const ASSUMED_SHIFTS_PER_DAY = 3; // круглосуточная работа, смена ~8 ч — своего поля в датасете аэропорта нет

const STAFF_MODEL_ASSUMPTION =
  "Норма выработки на человека (оп/чел·ч) в демо-датасете организатора для аэропорта не задана — используется " +
  "оценочное поле схемы (Выработка сотрудника рампа), отмечено как ориентировочное в его подсказке (ТЗ 7.5).";

export { fleetPeakPowerKw };

// Пиковая потребность в транспортировке груза, оп/ч: пиковые рейсы/ч (заданы
// напрямую в датасете) × операций наземного обслуживания на рейс.
export function transportPeakDemand(params) {
  return (params.peakFlightsPerHour ?? 0) * (params.groundOpsPerFlight ?? 1);
}

export function effectiveThroughput(solution) {
  return solution?.technical?.throughput ?? 0;
}

export function computeRobotCounts({ params, transportSolution }) {
  const groups = computeGroupCounts(params, [
    { key: "transport", solution: transportSolution, peakDemand: transportPeakDemand(params), throughputPerRobot: effectiveThroughput(transportSolution) },
  ]);

  return {
    transportCount: groups.transport.count,
    transportThroughput: groups.transport.throughputPerRobot,
  };
}

// Численность роли, реально доступная в моменте: весь штат делится на условные
// 3 смены, а затем на годовую текучесть (та же математика, что «потери рабочего
// времени» у склада — другое HR-явление, но тот же эффект на доступность штата).
function perShiftEffectiveStaff(rosterCount, params) {
  const perShift = (rosterCount ?? 0) / ASSUMED_SHIFTS_PER_DAY;
  return perShift / (1 + (params.staffTurnoverPct ?? 0) / 100);
}

export function currentProcessOf(params, { useTransport }) {
  const capacity = perShiftEffectiveStaff(params.rampStaffCount, params) * (params.rampOpsPerPersonHour ?? 0);
  const demand = useTransport ? transportPeakDemand(params) : 0;

  return {
    demand,
    capacity: useTransport ? capacity : 0,
    coveragePct: demand > 0 ? Math.min(999, (capacity / demand) * 100) : null,
  };
}

// ФОТ базового сценария: персонал рампа — единственная роль с численностью/
// окладом, которая теперь участвует в расчёте (багаж/уборка убраны). Оклад
// месячный — умножается на 12, а не на часы: роструту платят оклад независимо
// от сменного графика (в отличие от почасовых ставок склада).
export function baselineOpexOf(params) {
  const taxFactor = params.payrollTaxFactor ?? 1;
  const total = (params.rampStaffCount ?? 0) * (params.rampWageRubMonth ?? 0) * 12 * taxFactor;

  return { total };
}

// Экономия ФОТ ограничена пропускной способностью купленного парка
// транспортировщиков относительно производительности персонала — та же логика,
// что у склада.
export function laborSavingsFractionOf(params, counts) {
  const userFraction = Math.min(1, Math.max(0, (params.staffReplacedPct ?? 100) / 100));
  const capacity = perShiftEffectiveStaff(params.rampStaffCount, params) * (params.rampOpsPerPersonHour ?? 0);
  const throughputTotal = (counts.transportCount ?? 0) * (counts.transportThroughput ?? 0);

  const capacityFraction = throughputTotal > 0 ? (capacity > 0 ? Math.min(1, throughputTotal / capacity) : 1) : null;

  return {
    fraction: capacityFraction === null ? userFraction : Math.min(userFraction, capacityFraction),
    capacityFraction,
    capacity,
  };
}

function laborSavingsAssumptionOf(savings, hasTransport) {
  if (!hasTransport) {
    return "Транспортировщики не выбраны — экономия труда не считается.";
  }

  if (savings.capacityFraction !== null && savings.capacityFraction < 1 && savings.capacityFraction <= savings.fraction + 1e-9) {
    return `Допущение: парк транспортировщиков физически успевает выполнить ${Math.round(savings.capacityFraction * 100)}% того, что делает персонал рампа сейчас — экономия труда ограничена этой долей.`;
  }

  if (savings.fraction >= 1) return "Допущение: транспортировщики полностью заменяют персонал рампа.";
  return `Допущение: транспортировщики замещают ${Math.round(savings.fraction * 100)}% ФОТ персонала рампа.`;
}

function payrollAssumptionOf(params) {
  const tax = params.payrollTaxFactor ?? 1;
  const turnover = params.staffTurnoverPct ?? 0;

  return (
    `ФОТ считается по месячному gross-окладу рампа × 12 × ${tax.toFixed(3)} (начисления на ФОТ). ` +
    `При сравнении пропускной способности с потребностью штат дополнительно делится на условные ${ASSUMED_SHIFTS_PER_DAY} смены ` +
    `и на (1+${(turnover / 100).toFixed(2)}) (годовая текучесть).`
  );
}

// Строит один сценарий: 'baseline' | 'purchase' | 'raas' — те же три, что у склада (ТЗ 3.5.5).
export function buildAirportScenario(kind, { params, transportSolution, counts }) {
  const countsWithThroughput = { ...counts, transportThroughput: counts.transportThroughput ?? effectiveThroughput(transportSolution) };

  const baseline = baselineOpexOf(params);
  const savings = laborSavingsFractionOf(params, countsWithThroughput);
  const hasTransport = (counts.transportCount ?? 0) > 0 && !!transportSolution;

  const laborSavings = hasTransport ? baseline.total * savings.fraction : 0;

  return buildScenario(kind, {
    params,
    groups: [{ solution: transportSolution, count: counts.transportCount }],
    baselineOpex: baseline.total,
    laborSavings,
    extraAssumptions: {
      staffModelAssumption: STAFF_MODEL_ASSUMPTION,
      laborSavingsAssumption: laborSavingsAssumptionOf(savings, hasTransport),
      payrollAssumption: payrollAssumptionOf(params),
    },
  });
}

// What-if / sensitivity (ТЗ 3.5.6).
export function buildSensitivityScenario({ params, transportSolution, equipmentFactor = 1, laborFactor = 1, demandFactor = 1 }) {
  const shiftedParams = {
    ...params,
    rampWageRubMonth: (params.rampWageRubMonth ?? 0) * laborFactor,
    peakFlightsPerHour: (params.peakFlightsPerHour ?? 0) * demandFactor,
  };

  const shiftedTransportSolution = scaleSolutionCosts(transportSolution, equipmentFactor);
  const counts = computeRobotCounts({ params: shiftedParams, transportSolution: shiftedTransportSolution });

  return buildAirportScenario("purchase", { params: shiftedParams, transportSolution: shiftedTransportSolution, counts });
}

// 'baseline' | 'purchase' | 'raas' сразу все три.
export function buildAllScenarios({ params, transportSolution, counts }) {
  const input = { params, transportSolution, counts };

  return {
    baseline: buildAirportScenario("baseline", input),
    purchase: buildAirportScenario("purchase", input),
    raas: buildAirportScenario("raas", input),
  };
}
