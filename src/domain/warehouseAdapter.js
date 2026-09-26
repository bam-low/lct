// Адаптер «параметры склада + выбранные решения → нормализованные входы
// scenarioEngine.js/economics.js». Единственный модуль, который придётся
// продублировать (adapters/airportAdapter.js, adapters/medicalAdapter.js), когда
// другие типы объектов станут рабочими: он даёт общему ядру (scenarioEngine.js)
// пиковый спрос и эффективную производительность по формулам, специфичным для
// склада, а само ядро расчёта экономики и структура сценария не меняются
// (ТЗ 4.2.6). Ядро больше не знает и про ФОТ (baselineOpex) — его тоже считает
// адаптер и передаёт уже готовым числом (та же логика, что раньше применили к
// laborSavingsFraction), потому что модель персонала (роли, начисления, потери
// рабочего времени) — целиком специфика склада.

import { computeGroupCounts, buildScenario, scaleSolutionCosts, hoursPerShift, operatingHoursPerDay, fleetPeakPowerKw } from "./scenarioEngine.js";
import { LOAD_SLOWDOWN } from "../simulation/constants.js";
import { selectOption } from "./objectTypes.js";

const LOADER_HANDLING_SECONDS = 25; // подъём/опускание вил, повороты, заезд в полосу и выезд за один рейс

// Производительность персонала (manualProductivity) — общая для обеих ролей, а
// не своя у отборщиков и операторов погрузчиков (в демо-датасете организатора
// есть только выработка отборщика). Упрощение для экспресс-оценки (ТЗ 3.5.1).
const STAFF_MODEL_ASSUMPTION =
  "Производительность персонала (оп/чел·ч) задана одним значением на обе роли (отборщики, операторы " +
  "погрузчиков) — в демо-датасете организатора есть выработка только для отборщиков; для точного ФОТ " +
  "по операторам погрузчиков нужна отдельная норма.";

export { hoursPerShift, operatingHoursPerDay };

// Во сколько раз ограничения планировки (колонны, узкие проходы) замедляют роботов.
export const speedFactorOf = (params) => selectOption("warehouse", "layoutRestriction", params.layoutRestriction)?.speedFactor ?? 1;

// Мелкоштучный отбор медленнее (роборука делает больше движений на операцию),
// ходовые SKU А-класса — быстрее (короче путь до места хранения, отработанный
// маршрут). Множитель к эффективной производительности сортировочных решений;
// 0.4 — нижний предел, чтобы даже крайние доли не обнуляли пропускную способность.
export function pickComplexityFactor(params) {
  const piece = Math.min(1, Math.max(0, (params.piecePickSharePct ?? 0) / 100));
  const fast = Math.min(1, Math.max(0, (params.fastSkuSharePct ?? 0) / 100));
  return Math.max(0.4, 1 - piece * 0.35 + fast * 0.15);
}

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
// у пылесоса — паспортная с поправкой на планировку, у роборуки — паспортная с
// поправкой на сложность отбора (мелкоштучность/доля ходовых SKU), у погрузчика —
// меньшая из паспортной и рассчитанной по длине маршрута.
export function effectiveThroughput(solution, params) {
  if (!solution) return 0;

  const nominal = solution.technical.throughput ?? 0;
  const type = solution.identification.type;

  if (type === "loader") {
    return Math.min(nominal, 3600 / loaderCycleSeconds(solution, params)) * speedFactorOf(params);
  }
  if (type === "arm") {
    return nominal * pickComplexityFactor(params);
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

// Численность роли, реально доступная в моменте (для сравнения с почасовым
// пиковым спросом): весь штат делится на число смен, а затем ещё на потери
// рабочего времени (отпуска/больничные/текучесть) — платформа сама переводит
// «весь штат» из параметров в «сколько человек реально стоит у процесса сейчас».
function perShiftEffectiveStaff(rosterCount, params) {
  const perShift = (rosterCount ?? 0) / (params.shiftsPerDay ?? 1);
  return perShift / (1 + (params.staffLossFactor ?? 0));
}

// Потребность склада в операциях, которые сейчас делает персонал, против
// фактически доступной численности обеих ролей (без уборки — она измеряется в м²
// и для неё в модели персонала нет отдельной статьи, см. laborSavingsAssumptionOf).
export function currentProcessOf(params, { useArm, useLoader }) {
  const pickerCapacity = perShiftEffectiveStaff(params.pickerCount, params) * (params.manualProductivity ?? 0);
  const forkliftCapacity = perShiftEffectiveStaff(params.forkliftOperatorCount, params) * (params.manualProductivity ?? 0);

  const demand = (useArm ? armPeakDemand(params) : 0) + (useLoader ? loaderPeakDemand(params) : 0);
  const capacity = (useArm ? pickerCapacity : 0) + (useLoader ? forkliftCapacity : 0);

  return {
    demand,
    capacity,
    coveragePct: demand > 0 ? Math.min(999, (capacity / demand) * 100) : null,
    pickerCapacity,
    forkliftCapacity,
  };
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

// ФОТ базового (безроботизированного) сценария по ролям — раздельно, чтобы
// экономия труда считалась по каждой роли отдельно (см. laborSavingsFractionOf),
// а не одной цифрой на весь персонал. hours — часы одного человека за год: роль
// задана как весь штат по всем сменам (см. objectTypes.js), поэтому здесь именно
// hoursPerShift × daysPerYear, а не operatingHoursPerDay (тот уже включает
// умножение на число смен — иначе часы каждого человека посчитались бы за все
// смены сразу, а не за одну его собственную).
export function baselineOpexOf(params) {
  const hours = hoursPerShift(params) * (params.daysPerYear ?? 0);
  const taxFactor = params.payrollTaxFactor ?? 1;

  const pickerCost = (params.pickerCount ?? 0) * (params.pickerHourlyWage ?? 0) * hours * taxFactor;
  const forkliftCost = (params.forkliftOperatorCount ?? 0) * (params.forkliftHourlyWage ?? 0) * hours * taxFactor;

  return { pickerCost, forkliftCost, total: pickerCost + forkliftCost };
}

export { fleetPeakPowerKw };

// Суммарная требуемая длина конвейера, м: только у решений, которым он нужен по
// каталогу (infra.conveyorRequired) — для сверки с введённой протяжённостью
// конвейерной системы объекта.
export function requiredConveyorM(groups) {
  return groups.reduce((sum, g) => {
    if (!g.solution?.infra?.conveyorRequired) return sum;
    return sum + (g.solution.infra.conveyorPerRobotM ?? 0) * (g.count ?? 0);
  }, 0);
}

// Эффективная глубина полос хранения для симуляции: базовая — от типа хранения
// (storageType), дополнительно на ±1 ячейку плотнее/реже, если плотность
// паллетомест (шт/м²) заметно выше/ниже демо-датасета организатора (20000
// паллетомест / 20000 м² = 1.0) — так введённое количество паллетомест реально
// меняет вид раскладки стеллажей в 3D-сцене, а не остаётся только цифрой в форме.
const PALLET_DENSITY_BASELINE = 1; // паллетомест/м² в датасете организатора

export function effectiveSlotsPerLane(params) {
  const base = selectOption("warehouse", "storageType", params.storageType)?.slotsPerLane ?? 2;
  const density = (params.palletSlots ?? 20000) / Math.max(1, params.floorAreaM2 ?? 20000);
  const ratio = density / PALLET_DENSITY_BASELINE;
  const adjust = ratio >= 1.5 ? 1 : ratio <= 0.5 ? -1 : 0;

  return Math.max(1, Math.min(4, base + adjust));
}

// Экономия ФОТ ограничена пропускной способностью купленного парка относительно
// производительности именно той роли, которую он замещает (роборуки — отборщики,
// погрузчики — операторы погрузчиков), а не произвольной долей на весь персонал
// сразу (ТЗ 3.5.2: эффект — измеримое следствие расчёта, а не декларация).
// Уборка (м²/ч) сюда не входит — единицы несопоставимы с оп/чел·ч, а отдельной
// статьи ФОТ на уборщиков в модели персонала нет вовсе (см. baselineOpexOf).
//
// Второй, независимый потолок — доля негабаритных грузов: такой груз роботы не
// берут ни при каком размере парка, поэтому экономия не может превышать
// (1 − доля_негабарита) даже при 100%-й пропускной способности.
export function laborSavingsFractionOf(params, counts) {
  const userFraction = Math.min(1, Math.max(0, (params.staffReplacedPct ?? 100) / 100));
  const oversizedCeiling = 1 - Math.min(1, Math.max(0, (params.oversizedCargoPct ?? 0) / 100));
  const capFraction = Math.min(userFraction, oversizedCeiling);

  const pickerCapacity = perShiftEffectiveStaff(params.pickerCount, params) * (params.manualProductivity ?? 0);
  const forkliftCapacity = perShiftEffectiveStaff(params.forkliftOperatorCount, params) * (params.manualProductivity ?? 0);

  const armThroughputTotal = (counts.armCount ?? 0) * (counts.armThroughput ?? 0);
  const loaderThroughputTotal = (counts.loaderCount ?? 0) * (counts.loaderThroughput ?? 0);

  const armCapacityFraction = armThroughputTotal > 0 ? (pickerCapacity > 0 ? Math.min(1, armThroughputTotal / pickerCapacity) : 1) : null;
  const loaderCapacityFraction = loaderThroughputTotal > 0 ? (forkliftCapacity > 0 ? Math.min(1, loaderThroughputTotal / forkliftCapacity) : 1) : null;

  return {
    capFraction,
    oversizedCeiling,
    pickerFraction: armCapacityFraction === null ? capFraction : Math.min(capFraction, armCapacityFraction),
    forkliftFraction: loaderCapacityFraction === null ? capFraction : Math.min(capFraction, loaderCapacityFraction),
    armCapacityFraction,
    loaderCapacityFraction,
    pickerCapacity,
    forkliftCapacity,
  };
}

function roleAssumptionLine(roleName, fraction, capacityFraction) {
  if (capacityFraction !== null && capacityFraction < 1 && capacityFraction <= fraction + 1e-9) {
    return `${roleName} — парк физически успевает выполнить ${Math.round(capacityFraction * 100)}% того, что делает эта роль сейчас, экономия по ней ограничена этой долей.`;
  }
  if (fraction >= 1) return `${roleName} — заменяется полностью.`;
  return `${roleName} — заменяется на ${Math.round(fraction * 100)}%.`;
}

function laborSavingsAssumptionOf(savings, { hasArm, hasLoader }) {
  const lines = [];
  if (hasArm) lines.push(roleAssumptionLine("отборщики/роборуки", savings.pickerFraction, savings.armCapacityFraction));
  if (hasLoader) lines.push(roleAssumptionLine("операторы погрузчиков", savings.forkliftFraction, savings.loaderCapacityFraction));

  const ceilingNote =
    savings.oversizedCeiling < 1
      ? ` Верхний потолок экономии по всем ролям — ${Math.round(savings.oversizedCeiling * 100)}% (доля негабаритных грузов остаётся ручной независимо от размера парка).`
      : "";

  if (lines.length === 0) {
    return (
      "Допущение: для уборки (пылесосы) в модели персонала нет отдельной статьи ФОТ (в демо-датасете " +
      "организатора нет численности/ставки уборщиков) — экономия труда по сценариям «только пылесосы» не считается, " +
      "только эффект по CAPEX/OPEX самой уборки."
    );
  }

  return `Допущение: экономия труда считается отдельно по каждой роли — пропускная способность купленного парка против производительности именно этой роли. ${lines.join(" ")}${ceilingNote}`;
}

function payrollAssumptionOf(params) {
  const tax = params.payrollTaxFactor ?? 1;
  const loss = params.staffLossFactor ?? 0;

  return (
    `ФОТ считается по gross-ставкам ролей ×${tax.toFixed(3)} (начисления на ФОТ). ` +
    `При сравнении пропускной способности с потребностью штат дополнительно делится на (1+${loss.toFixed(2)}) ` +
    `(отпуска/больничные/текучесть) — платится всему штату, но фактически доступна в моменте меньшая часть.`
  );
}

function pickComplexityAssumptionOf(params) {
  const factor = pickComplexityFactor(params);
  const sign = factor >= 1 ? "выше" : "ниже";

  return (
    `Паспортная производительность сортировочных решений скорректирована на состав отбора: ` +
    `${params.piecePickSharePct ?? 0}% мелкоштучного (медленнее) и ${params.fastSkuSharePct ?? 0}% SKU А-класса (быстрее) ` +
    `дают множитель ×${factor.toFixed(2)} — эффективная производительность на ${Math.round(Math.abs(1 - factor) * 100)}% ${sign} паспортной.`
  );
}

function groupsOf(vacuumSolution, armSolution, loaderSolution, counts) {
  return [
    { solution: vacuumSolution, count: counts.vacuumCount },
    { solution: armSolution, count: counts.armCount },
    { solution: loaderSolution, count: counts.loaderCount ?? 0 },
  ];
}

// Строит один сценарий: 'baseline' | 'purchase' | 'raas'.
// counts — { vacuumCount, armCount, loaderCount, armThroughput, loaderThroughput },
// обычно из computeRobotCounts(), но может быть подменено вручную (what-if /
// ручная корректировка — ТЗ 3.5.3–3.5.4); throughput-поля нужны только для
// ограничения экономии пропускной способностью и пересчитываются здесь же,
// если их не передали (ручная корректировка меняет только количество).
export function buildWarehouseScenario(kind, { params, vacuumSolution, armSolution, loaderSolution, counts }) {
  const countsWithThroughput = {
    ...counts,
    armThroughput: counts.armThroughput ?? effectiveThroughput(armSolution, params),
    loaderThroughput: counts.loaderThroughput ?? effectiveThroughput(loaderSolution, params),
  };

  const baseline = baselineOpexOf(params);
  const savings = laborSavingsFractionOf(params, countsWithThroughput);

  const hasArm = (counts.armCount ?? 0) > 0 && !!armSolution;
  const hasLoader = (counts.loaderCount ?? 0) > 0 && !!loaderSolution;

  const laborSavings =
    (hasArm ? baseline.pickerCost * savings.pickerFraction : 0) + (hasLoader ? baseline.forkliftCost * savings.forkliftFraction : 0);

  return buildScenario(kind, {
    params,
    groups: groupsOf(vacuumSolution, armSolution, loaderSolution, counts),
    baselineOpex: baseline.total,
    laborSavings,
    extraAssumptions: {
      staffModelAssumption: STAFF_MODEL_ASSUMPTION,
      laborSavingsAssumption: laborSavingsAssumptionOf(savings, { hasArm, hasLoader }),
      payrollAssumption: payrollAssumptionOf(params),
      pickComplexityAssumption: hasArm ? pickComplexityAssumptionOf(params) : null,
    },
  });
}

// What-if / sensitivity (ТЗ 3.5.6): пересчёт сценария "покупка" при сдвиге
// стоимости оборудования, стоимости труда (обе ставки — отборщика и оператора
// погрузчика) и требуемого объёма операций — без побочных эффектов на основной
// state приложения.
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
    pickerHourlyWage: (params.pickerHourlyWage ?? 0) * laborFactor,
    forkliftHourlyWage: (params.forkliftHourlyWage ?? 0) * laborFactor,
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

// 'baseline' | 'purchase' | 'raas' сразу все три (ТЗ 3.5.5) — тонкая обёртка
// над buildWarehouseScenario, чтобы ограничение экономии пропускной
// способностью считалось одинаково для всех сценариев, а не дублировалось.
// counts всегда приходит из вызывающего кода (в проекте — ручной ввод
// пользователя, см. useEconomicsState); computeRobotCounts() остаётся
// отдельной утилитой для тех мест, где нужна именно расчётная рекомендация
// (например, стартовое значение или SensitivityPanel).
export function buildAllScenarios({ params, vacuumSolution, armSolution, loaderSolution, counts }) {
  const input = { params, vacuumSolution, armSolution, loaderSolution, counts };

  return {
    baseline: buildWarehouseScenario("baseline", input),
    purchase: buildWarehouseScenario("purchase", input),
    raas: buildWarehouseScenario("raas", input),
  };
}
