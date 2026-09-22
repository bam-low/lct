// Подтверждение расчёта симуляцией (ТЗ 3.6.2) и легенда карты (ТЗ 3.6.1): что
// показать в таблице и какие обозначения нужны для выбранного типа роботов.

// Не показывать подтверждение расчёта, пока симуляция идёт слишком мало (цифры «прыгают»).
export const MIN_VERIFY_SECONDS = 120;

// Строки таблицы «нужно / расчёт парка / в симуляции». input:
//   layout          — какие типы роботов включены;
//   demand          — потребность объекта на этаж { vacuum, arm, loader };
//   fleet           — расчётная мощность парка { vacuum (м²/ч, с учётом зарядки), arm, loader };
//   stats           — показатели симуляции (simSeconds, opsDone, vacuum, loader);
//   areaPerUnit2    — сколько м² в квадратной единице сцены;
//   inflowPerFloor  — входящий и исходящий поток на этаж { inbound, outbound };
//   routeLengthM    — заданная средняя протяжённость маршрута.
export function buildVerifyRows({ layout, demand, fleet, stats, areaPerUnit2, inflowPerFloor, routeLengthM }) {
  const rows = [];
  const simHours = stats.simSeconds / 3600;
  const enoughTime = stats.simSeconds >= MIN_VERIFY_SECONDS;

  if (layout.useVacuum) {
    const cleaning = stats.vacuum.activeSeconds >= MIN_VERIFY_SECONDS;

    rows.push({
      label: "Уборка",
      unit: "м²/ч",
      required: demand.vacuum,
      calculated: fleet.vacuum,
      simulated: cleaning ? (stats.vacuum.cleanedCells * areaPerUnit2) / (stats.vacuum.activeSeconds / 3600) : null,
      note: "Расчёт учитывает время на зарядку; в симуляции — убранная площадь за время, пока роботы убирают.",
    });
  }

  if (layout.useArm) {
    rows.push({
      label: "Внутрискладские операции",
      unit: "оп/ч",
      required: demand.arm,
      calculated: fleet.arm,
      simulated: enoughTime ? stats.opsDone / simHours : null,
    });
  }

  if (layout.useLoader) {
    rows.push(
      {
        label: "Операции погрузчиков (приём + отгрузка)",
        unit: "ед./ч",
        required: demand.loader,
        calculated: fleet.loader,
        simulated: stats.loader.movedPerHour || null,
        note: "Производительность погрузчика ограничена длиной маршрута, скоростью и массой груза; если парк не успевает, фуры ждут в очереди.",
      },
      {
        label: "Входящий поток",
        unit: "ед./ч",
        required: inflowPerFloor.inbound,
        calculated: null,
        simulated: stats.loader.receivedPerHour || null,
      },
      {
        label: "Исходящий поток",
        unit: "ед./ч",
        required: inflowPerFloor.outbound,
        calculated: null,
        simulated: stats.loader.shippedPerHour || null,
      },
      {
        label: "Средняя протяжённость маршрута",
        unit: "м",
        required: routeLengthM,
        calculated: routeLengthM,
        simulated: stats.loader.avgRouteM || null,
      }
    );
  }

  return rows;
}

// Обозначения на карте: типовые зоны, маршруты, роботы, точки операций и зарядки.
export function buildLegendItems(layout) {
  const { useVacuum, useArm, useLoader } = layout;

  return [
    { kind: "zone", color: "#4C5070", label: "Рабочая зона роботов (пол разбит на подписанные чанки)" },
    ...(layout.restrictedZone ? [{ kind: "zone", color: "#E5A13F", dashed: true, label: "Зона разгрузки у ворот — недоступна роботам" }] : []),
    ...(useVacuum
      ? [
          { kind: "line", color: "#ffffff", label: "Маршрут пылесоса — белый след, растворяется после уборки" },
          { kind: "zone", color: "#4F9B90", label: "Зарядная станция (светодиод: жёлтый — заряжается, зелёный — заряжен)" },
          { kind: "dot", color: "#f3efe6", label: "Робот-пылесос" },
        ]
      : []),
    ...(useArm
      ? [
          { kind: "zone", color: "#8B78C7", label: "Площадка роборуки — точка выполнения операции" },
          { kind: "line", color: "#D4B96F", label: "Конвейеры: вход и выход коробок" },
          { kind: "dot", color: "#C85E70", label: "Роборука" },
        ]
      : []),
    ...(useLoader
      ? [
          { kind: "line", color: "#E5A13F", dashed: true, label: "Маршруты погрузчиков: проезды; в зоне каждых ворот ездит только свой погрузчик" },
          { kind: "line", color: "#ffffff", dashed: true, label: "Границы зон ворот: за каждыми воротами — свой погрузчик" },
          { kind: "zone", color: "#E5A13F", dashed: true, label: "Площадка у ворот — точка выгрузки и отгрузки фур" },
          { kind: "zone", color: "#9A7B55", label: "Грузовая единица (цвет — по SKU) и места хранения" },
          { kind: "dot", color: "#F08A24", label: "Погрузчик; стоянки — у северной стены" },
        ]
      : []),
  ];
}
