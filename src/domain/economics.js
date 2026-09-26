// Формулы по табл. 3.5.2 ТЗ «Платформа подбора роботизированных решений».
// Модуль без React/Three.js — переиспользуется любым адаптером объекта.

// reserveFactor — мультипликативный запас на пики/поломки/обслуживание сверх
// базового расчёта (напр. 1.1 = +10% роботов), а не количество штук: ТЗ 3.5.2
// перечисляет загрузку, доступность и резерв как однородные коэффициенты
// ("производительность... с учётом коэффициента загрузки, доступности и
// резерва"), поэтому резерв применяется тем же способом, что и они, — до
// округления вверх. По умолчанию 1 (без резерва) — не меняет поведение мест,
// которые его не передают.
export function requiredRobotCount({
  peakDemand,
  throughputPerRobot,
  loadFactor = 0.85,
  availability = 0.95,
  reserveFactor = 1,
}) {
  if (!throughputPerRobot || throughputPerRobot <= 0) return 0;

  const effective = throughputPerRobot * loadFactor * availability;
  if (effective <= 0) return 0;

  return Math.max(0, Math.ceil((peakDemand / effective) * reserveFactor));
}

export function capexTotal({
  equipment = 0,
  infrastructure = 0,
  software = 0,
  integration = 0,
  commissioning = 0,
  training = 0,
  reserve = 0,
}) {
  return (
    equipment +
    infrastructure +
    software +
    integration +
    commissioning +
    training +
    reserve
  );
}

export function opexTotal({
  service = 0,
  licenses = 0,
  energy = 0,
  communications = 0,
  consumables = 0,
  repair = 0,
  opsStaff = 0,
}) {
  return (
    service +
    licenses +
    energy +
    communications +
    consumables +
    repair +
    opsStaff
  );
}

// Годовой эффект = сокращение текущих затрат + доп.доход/предотвращённые потери − доп.OPEX
export function annualEffect({
  laborSavings = 0,
  otherSavings = 0,
  additionalOpex = 0,
}) {
  return laborSavings + otherSavings - additionalOpex;
}

// Простой срок окупаемости. null, если эффект не положителен (окупаемости нет).
export function paybackPeriod(capex, effect) {
  if (effect <= 0) return null;
  return capex / effect;
}

// ROI = накопленный эффект за период / CAPEX × 100%. null при нулевом CAPEX.
export function roi(effect, capex, years) {
  if (!capex || capex <= 0) return null;
  return ((effect * years) / capex) * 100;
}

// TCO = CAPEX + операционные затраты за горизонт, с заменой оборудования по
// истечении срока службы (каждые lifespanYears снова добавляется capex) минус
// остаточная стоимость последнего поколения оборудования на конец горизонта
// (оно ещё не самортизировано полностью — учитываем как актив, а не как
// списанную в ноль затрату; линейная амортизация, допущение 2.2 приложения к ТЗ).
export function tco({ capex, opexPerYear, horizonYears, lifespanYears }) {
  let total = capex + opexPerYear * horizonYears;
  let replacements = 0;

  if (lifespanYears > 0 && lifespanYears < horizonYears) {
    replacements = Math.floor((horizonYears - 1) / lifespanYears);
    total += replacements * capex;
  }

  if (lifespanYears > 0) {
    const yearsSinceLastPurchase = horizonYears - replacements * lifespanYears;
    const remainingLifeFraction = Math.max(0, 1 - yearsSinceLastPurchase / lifespanYears);
    total -= capex * remainingLifeFraction;
  }

  return total;
}

// Линейная амортизация CAPEX — информационная строка (допущение 2.2 приложения к ТЗ).
export function linearDepreciationPerYear(capex, lifespanYears) {
  if (!lifespanYears || lifespanYears <= 0) return 0;
  return capex / lifespanYears;
}

export function paybackBucket(years) {
  if (years === null || years === undefined) return "none";
  if (years <= 3) return "fast";
  if (years <= 5) return "medium";
  return "slow";
}

export function formatCurrencyRUB(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";

  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value);
}
