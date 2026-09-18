// Реестр типов объектов (ТЗ 3.2.1). Склад — рабочий, с полной схемой параметров.
// Аэропорт и мед.учреждение — заглушки, показывают расширяемость архитектуры
// (ТЗ 4.2.6): добавление нового типа объекта не требует переработки ядра
// (economics.js / catalog.js / useEconomicsState.js), только новую схему + адаптер.

export const OBJECT_TYPES = {
  warehouse: {
    id: "warehouse",
    label: "Склад",
    icon: "📦",
    comingSoon: false,
    processes: [
      { id: "floor_cleaning", label: "Уборка пола" },
      { id: "sorting", label: "Сортировка/перегрузка" },
    ],
    paramSchema: [
      {
        key: "shiftHoursPerDay",
        label: "Часов в смену",
        unit: "ч",
        type: "number",
        min: 1,
        max: 24,
        step: 1,
        default: 8,
        hint: "Продолжительность рабочей смены на объекте",
      },
      {
        key: "daysPerYear",
        label: "Рабочих дней в году",
        unit: "дн",
        type: "number",
        min: 1,
        max: 366,
        step: 1,
        default: 305,
        hint: "Например, 365 минус выходные и простои",
      },
      {
        key: "staffCount",
        label: "Персонал на процессе сейчас",
        unit: "чел",
        type: "number",
        min: 0,
        max: 50,
        step: 1,
        default: 6,
        hint: "Сколько человек сейчас выполняют уборку/сортировку вручную",
      },
      {
        key: "hourlyWage",
        label: "Стоимость часа персонала",
        unit: "₽/ч",
        type: "number",
        min: 0,
        max: 2000,
        step: 10,
        default: 450,
        hint: "С учётом налогов и страховых взносов",
      },
      {
        key: "requiredSortThroughput",
        label: "Требуемый поток сортировки",
        unit: "посылок/ч",
        type: "number",
        min: 0,
        max: 5000,
        step: 50,
        default: 900,
        hint: "Пиковая потребность в операциях роборук (табл. 3.5.2)",
      },
      {
        key: "loadFactor",
        label: "Коэффициент загрузки оборудования",
        unit: "доля",
        type: "number",
        min: 0.1,
        max: 1,
        step: 0.05,
        default: 0.85,
        hint: "Доля времени, когда робот реально работает",
      },
      {
        key: "horizonYears",
        label: "Горизонт расчёта TCO",
        unit: "лет",
        type: "number",
        min: 1,
        max: 15,
        step: 1,
        default: 5,
        hint: "ТЗ требует не менее 5 лет",
      },
    ],
  },

  airport: {
    id: "airport",
    label: "Аэропорт",
    icon: "✈️",
    comingSoon: true,
    processes: [{ id: "baggage", label: "Перемещение багажа" }],
    paramSchema: [
      {
        key: "peakPassengerFlow",
        label: "Пиковый пассажиропоток",
        unit: "пасс/ч",
        type: "number",
        min: 0,
        max: 20000,
        default: 1200,
        hint: "Заполняется при реализации сценария «Аэропорт»",
      },
    ],
  },

  medical: {
    id: "medical",
    label: "Медицинское учреждение",
    icon: "🏥",
    comingSoon: true,
    processes: [{ id: "logistics", label: "Логистика грузов/белья/медикаментов" }],
    paramSchema: [
      {
        key: "transportRunsPerDay",
        label: "Перевозок в сутки",
        unit: "рейсов",
        type: "number",
        min: 0,
        max: 2000,
        default: 80,
        hint: "Заполняется при реализации сценария «Медучреждение»",
      },
    ],
  },
};

export const OBJECT_TYPE_LIST = Object.values(OBJECT_TYPES);

export function getObjectType(id) {
  return OBJECT_TYPES[id] ?? null;
}

export function defaultParamsFor(objectTypeId) {
  const type = getObjectType(objectTypeId);
  if (!type) return {};

  return Object.fromEntries(
    type.paramSchema.map((field) => [field.key, field.default])
  );
}
