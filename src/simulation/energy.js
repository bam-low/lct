// Учёт электроэнергии — один и тот же для всех роботов (пылесосы, роборуки,
// погрузчики). Конкретные цифры у каждого робота свои и берутся из каталога
// (technical.autonomyHours + technical.energy); когда они будут уточнены, менять
// нужно только каталог, а не симуляцию.
//
// Профиль робота (energyProfileOf):
//   runtimeHours  — сколько работает на одной зарядке; null — питание от сети
//   chargeHours   — сколько заряжается с нуля до полной
//   workPowerKw   — средняя мощность при работе
//   idlePowerKw   — мощность в простое
//
// Счётчик различает два вида энергии:
//   usedKwh — сколько робот израсходовал на работу и простой;
//   gridKwh — сколько он взял из сети (это и есть счёт за электричество):
//     у робота с батареей — энергия зарядки (с потерями), у роботов от сети
//     и у роботов без моделирования батареи — то, что они израсходовали.

export const CHARGE_EFFICIENCY = 0.9; // доля энергии из сети, что попадает в батарею

const SECONDS_PER_HOUR = 3600;

export function energyProfileOf(solution) {
  const technical = solution?.technical;
  const energy = technical?.energy;

  return {
    runtimeHours: technical?.autonomyHours ?? null,
    chargeHours: energy?.chargeHours ?? null,
    workPowerKw: energy?.workPowerKw ?? 0,
    idlePowerKw: energy?.idlePowerKw ?? 0,
  };
}

// simulateBattery — моделировать ли разряд и зарядку (сейчас только у
// пылесосов). Без неё батарея у робота «условно бесконечная», а энергия всё
// равно считается.
export function createEnergyMeter(profile, { simulateBattery = false, initialSoc = 1 } = {}) {
  const runtimeSec = profile.runtimeHours ? profile.runtimeHours * SECONDS_PER_HOUR : null;
  const chargeSec = profile.chargeHours ? profile.chargeHours * SECONDS_PER_HOUR : null;
  const hasBattery = simulateBattery && runtimeSec !== null && chargeSec !== null;

  // Мощность из сети при зарядке: ёмкость батареи / время зарядки / КПД.
  const batteryKwh = profile.workPowerKw * (profile.runtimeHours ?? 0);
  const chargePowerKw = hasBattery ? batteryKwh / profile.chargeHours / CHARGE_EFFICIENCY : 0;

  let soc = hasBattery ? initialSoc : null; // уровень заряда, 0..1
  let usedKwh = 0;
  let gridKwh = 0;

  return {
    hasBattery,

    get soc() {
      return soc;
    },
    get usedKwh() {
      return usedKwh;
    },
    get gridKwh() {
      return gridKwh;
    },

    // Расход за dt секунд: activity — 'work' или 'idle'.
    consume(dt, activity) {
      const powerKw = activity === "work" ? profile.workPowerKw : profile.idlePowerKw;
      const kwh = (powerKw * dt) / SECONDS_PER_HOUR;

      usedKwh += kwh;

      if (hasBattery) {
        // Разряд пропорционален мощности: на работе — за runtimeSec от полной.
        const workShare = profile.workPowerKw > 0 ? powerKw / profile.workPowerKw : 0;
        soc = Math.max(0, soc - (dt / runtimeSec) * workShare);
      } else {
        gridKwh += kwh;
      }
    },

    // Зарядка за dt секунд (только с батареей).
    charge(dt) {
      if (!hasBattery || soc >= 1) return;

      soc = Math.min(1, soc + dt / chargeSec);
      gridKwh += (chargePowerKw * dt) / SECONDS_PER_HOUR;
    },

    isFull: () => !hasBattery || soc >= 1,

    // Сколько секунд работы осталось на текущем заряде.
    workSecondsLeft: () => (hasBattery ? soc * runtimeSec : Infinity),

    // Какую долю заряда съест dt секунд работы (для расчёта «хватит ли доехать»).
    socCostOf: (seconds) => (hasBattery ? seconds / runtimeSec : 0),
  };
}
