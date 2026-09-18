// Формулы по табл. 3.5.2 ТЗ «Платформа подбора роботизированных решений».
// Модуль без React/Three.js — переиспользуется любым адаптером объекта.

export function requiredRobotCount({
  peakDemand,
  throughputPerRobot,
  loadFactor = 0.85,
  availability = 0.95,
  reserve = 0,
}) {
  if (!throughputPerRobot || throughputPerRobot <= 0) return 0;

  const effective = throughputPerRobot * loadFactor * availability;
  if (effective <= 0) return 0;

  return Math.max(0, Math.ceil(peakDemand / effective) + reserve);
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

// TCO = CAPEX + операционные затраты за горизонт, с заменой оборудования
// по истечении срока службы (каждые lifespanYears снова добавляется capex).
export function tco({ capex, opexPerYear, horizonYears, lifespanYears }) {
  let total = capex + opexPerYear * horizonYears;

  if (lifespanYears > 0 && lifespanYears < horizonYears) {
    const replacements = Math.floor((horizonYears - 1) / lifespanYears);
    total += replacements * capex;
  }

  return total;
}

// Линейная амортизация CAPEX — информационная строка (допущение 2.2 приложения к ТЗ).
export function linearDepreciationPerYear(capex, lifespanYears) {
  if (!lifespanYears || lifespanYears <= 0) return 0;
  return capex / lifespanYears;
}

// Пересчёт сценария с процентным сдвигом одного входа — для what-if/sensitivity.
export function buildSensitivity(baseInputs, computeScenario, param, deltas) {
  return deltas.map((deltaPct) => {
    const factor = 1 + deltaPct / 100;

    const shifted = {
      ...baseInputs,
      [param]: baseInputs[param] * factor,
    };

    const result = computeScenario(shifted);

    return { deltaPct, ...result };
  });
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
