// Демо-каталог роботизированных решений (ТЗ 3.3). Стоимости — ориентировочные
// допущения для хакатон-демо (ТЗ 7.5), не реальные прайсы вендоров; у каждой
// позиции есть source с пометкой "demo-assumption" для честности перед жюри (ТЗ 3.3.4).
//
// Поля сгруппированы по табл. 3.3.7: identification / technical / infra / economics /
// applicability / dataQuality.

export const CATALOG = [
  {
    id: "vac-lite",
    identification: {
      vendor: "CleanBot",
      name: "CleanBot Lite 500",
      type: "vacuum",
      purpose: "Автономная уборка складских полов",
      country: "РФ",
      availability: "в наличии",
    },
    technical: {
      throughput: 1800,
      throughputUnit: "м²/ч",
      speed: 1.1,
      autonomyHours: 4,
      positioningAccuracyMm: 50,
      navigationType: "LIDAR + SLAM",
    },
    infra: {
      floorRequirement: "ровный пол, уклон < 2%",
      chargingStations: 1,
    },
    economics: {
      equipmentCost: 950000,
      softwareCost: 40000,
      implementationCost: 60000,
      maintenanceCostPerYear: 85000,
      serviceCostPerYear: 45000,
      lifespanYears: 5,
      raas: { monthlyRate: 42000, contractMonths: 24, buyoutOption: true },
    },
    applicability: {
      objectTypes: ["warehouse"],
      processes: ["floor_cleaning"],
      limitations: ["не работает на щебне/гравии"],
      cases: ["3PL-склад, Москва, 2025"],
    },
    dataQuality: {
      source: "demo-assumption",
      lastUpdated: "2026-09",
      confidence: "средняя",
    },
  },
  {
    id: "vac-pro",
    identification: {
      vendor: "CleanBot",
      name: "CleanBot Pro 1200",
      type: "vacuum",
      purpose: "Автономная уборка складских полов, высокая производительность",
      country: "РФ",
      availability: "в наличии",
    },
    technical: {
      throughput: 3200,
      throughputUnit: "м²/ч",
      speed: 1.6,
      autonomyHours: 6,
      positioningAccuracyMm: 30,
      navigationType: "LIDAR + SLAM",
    },
    infra: {
      floorRequirement: "ровный пол, уклон < 3%",
      chargingStations: 2,
    },
    economics: {
      equipmentCost: 1650000,
      softwareCost: 60000,
      implementationCost: 90000,
      maintenanceCostPerYear: 120000,
      serviceCostPerYear: 70000,
      lifespanYears: 6,
      raas: { monthlyRate: 68000, contractMonths: 24, buyoutOption: true },
    },
    applicability: {
      objectTypes: ["warehouse"],
      processes: ["floor_cleaning"],
      limitations: [],
      cases: ["Дарксторы, Санкт-Петербург, 2025"],
    },
    dataQuality: {
      source: "demo-assumption",
      lastUpdated: "2026-09",
      confidence: "средняя",
    },
  },
  {
    id: "arm-sorter",
    identification: {
      vendor: "ArmTech",
      name: "ArmTech Sorter S1",
      type: "arm",
      purpose: "Сортировка и перегрузка штучных грузов между лентами",
      country: "РФ",
      availability: "в наличии",
    },
    technical: {
      throughput: 900,
      throughputUnit: "оп/ч",
      speed: null,
      autonomyHours: null,
      positioningAccuracyMm: 5,
      navigationType: "фиксированная база",
    },
    infra: {
      floorRequirement: "конвейерные линии по обе стороны",
      power: "380В, 3кВт",
    },
    economics: {
      equipmentCost: 2800000,
      softwareCost: 120000,
      implementationCost: 250000,
      maintenanceCostPerYear: 180000,
      serviceCostPerYear: 90000,
      lifespanYears: 7,
      raas: { monthlyRate: 95000, contractMonths: 36, buyoutOption: true },
    },
    applicability: {
      objectTypes: ["warehouse"],
      processes: ["sorting"],
      limitations: ["грузы до 15 кг", "габариты до 60×40×40 см"],
      cases: ["Сортировочный хаб маркетплейса, 2024"],
    },
    dataQuality: {
      source: "demo-assumption",
      lastUpdated: "2026-09",
      confidence: "средняя",
    },
  },
  {
    id: "arm-heavy",
    identification: {
      vendor: "ArmTech",
      name: "ArmTech Sorter S2 Heavy",
      type: "arm",
      purpose: "Сортировка тяжёлых и крупногабаритных грузов",
      country: "РФ",
      availability: "под заказ",
    },
    technical: {
      throughput: 600,
      throughputUnit: "оп/ч",
      speed: null,
      autonomyHours: null,
      positioningAccuracyMm: 8,
      navigationType: "фиксированная база",
    },
    infra: {
      floorRequirement: "усиленный фундамент под основание",
      power: "380В, 5кВт",
    },
    economics: {
      equipmentCost: 4100000,
      softwareCost: 150000,
      implementationCost: 320000,
      maintenanceCostPerYear: 240000,
      serviceCostPerYear: 130000,
      lifespanYears: 8,
      raas: { monthlyRate: 140000, contractMonths: 36, buyoutOption: true },
    },
    applicability: {
      objectTypes: ["warehouse"],
      processes: ["sorting"],
      limitations: ["грузы до 40 кг"],
      cases: [],
    },
    dataQuality: {
      source: "demo-assumption",
      lastUpdated: "2026-09",
      confidence: "низкая — нет подтверждённого кейса",
    },
  },
];

export function catalogFor(objectTypeId, processId) {
  return CATALOG.filter(
    (item) =>
      item.applicability.objectTypes.includes(objectTypeId) &&
      (!processId || item.applicability.processes.includes(processId))
  );
}

export function getCatalogItem(id) {
  return CATALOG.find((item) => item.id === id) ?? null;
}
