import { GATE_XS } from "../layout.js";

// Раскладка склада погрузчиков (единицы сцены, x — на восток, z — на юг).
//
// Склад разделён на полосы по числу ворот: у каждых ворот своя полоса шириной
// STRIP_WIDTH на всю глубину склада, и за ней закреплены свои погрузчики. Погрузчики
// разных ворот ездят только в своих полосах и потому пересекаться не могут.
//
//   z = -50    стена с воротами; у каждых ворот — площадка выгрузки фуры
//              (3 полосы по несколько ячеек), доступная с проезда H0
//   проезды    горизонтальные (AISLE_ZS) и вертикальный под воротами (свой у каждой
//              полосы); ездят по осевой линии — встречного движения нет
//   хранение   по обе стороны вертикального проезда, южнее каждого горизонтального:
//              короткие полосы (drive-in) — погрузчик заезжает, ставит груз в самую
//              дальнюю свободную ячейку и сдаёт назад; в каждой ячейке до
//              MAX_LAYERS единиц друг на друге
//   стоянки    у северной стены рядом с площадкой своих ворот
export const AISLE_ZS = [-40, -18, 4, 26];
export const ROAD_XS = GATE_XS;
export const AISLE_HALF_WIDTH = 3.6;

export const STRIP_WIDTH = 20;
export const STORAGE_LANE_OFFSET = 7; // на каком расстоянии от вертикального проезда стоят полосы хранения
export const LANE_PITCH = 3.8;
export const SLOT_PITCH = 2.4;
export const DEFAULT_SLOTS_PER_LANE = 2; // глубина полосы хранения по умолчанию (задаётся типом хранения)
export const MAX_LAYERS = 2;
const FIRST_SLOT_OFFSET = AISLE_HALF_WIDTH + 1.4; // от оси проезда до ближайшей ячейки

export const DOCK_LANES = 3;
export const DOCK_SLOTS = 3;
export const DOCK_SLOT_PITCH = 2.0;
const DOCK_FIRST_SLOT_OFFSET = 4.4; // от оси проезда H0 на север

export const BAY_Z = -46.2;
const BAY_OFFSET = 8;

// Курс = rotation.y; вперёд (вилы) смотрят в (sin курс, cos курс).
export const HEADING_NORTH = Math.PI;
export const HEADING_SOUTH = 0;

// Где стоит погрузчик ворот: рядом с площадкой, внутри своей полосы.
export const bayXOf = (gateIndex) => GATE_XS[gateIndex] + BAY_OFFSET;

// Полоса: ячейки идут от самой дальней от проезда (slots[0]) к ближайшей, груз
// кладут и берут в порядке LIFO — так проезд всегда свободен.
function makeLane({ id, kind, x, aisleIndex, dir, slotZs, gate }) {
  return {
    id,
    kind, // 'storage' | 'dock'
    x,
    aisleIndex,
    aisleZ: AISLE_ZS[aisleIndex],
    dir, // +1 — полоса уходит на юг от проезда, -1 — на север
    heading: dir > 0 ? HEADING_SOUTH : HEADING_NORTH,
    gate, // индекс ворот, которым принадлежит полоса
    claimedBy: null, // погрузчик/фура, который сейчас работает с полосой
    slots: slotZs.map((z) => ({ z, units: [], reserved: 0 })),
  };
}

function storageSlotZs(aisleZ, slotsPerLane) {
  return Array.from({ length: slotsPerLane }, (_, j) => aisleZ + FIRST_SLOT_OFFSET + (slotsPerLane - 1 - j) * SLOT_PITCH);
}

function dockSlotZs() {
  const nearest = AISLE_ZS[0] - DOCK_FIRST_SLOT_OFFSET;
  return Array.from({ length: DOCK_SLOTS }, (_, j) => nearest - (DOCK_SLOTS - 1 - j) * DOCK_SLOT_PITCH);
}

// Свежее (пустое) состояние склада; slotsPerLane — глубина полос хранения (тип
// хранения). У каждых ворот (docks[i]) — своя площадка (lanes) и свои полосы
// хранения (storageLanes).
export function createStorage({ slotsPerLane = DEFAULT_SLOTS_PER_LANE } = {}) {
  const docks = GATE_XS.map((x, index) => ({
    index,
    x,
    lanes: Array.from({ length: DOCK_LANES }, (_, k) =>
      makeLane({
        id: `dock${index}.${k}`,
        kind: "dock",
        x: x + (k - (DOCK_LANES - 1) / 2) * LANE_PITCH,
        aisleIndex: 0,
        dir: -1,
        slotZs: dockSlotZs(),
        gate: index,
      })
    ),
    storageLanes: AISLE_ZS.flatMap((aisleZ, aisleIndex) =>
      [-1, 1].map((side) =>
        makeLane({
          id: `store${index}.${aisleIndex}.${side}`,
          kind: "storage",
          x: x + side * STORAGE_LANE_OFFSET,
          aisleIndex,
          dir: 1,
          slotZs: storageSlotZs(aisleZ, slotsPerLane),
          gate: index,
        })
      )
    ),
  }));

  return {
    docks,
    storageLanes: docks.flatMap((dock) => dock.storageLanes),
    dockLanes: docks.flatMap((dock) => dock.lanes),
  };
}

// ----------------------------------------------------------
// Запросы к полосам
// ----------------------------------------------------------

export const slotLoad = (slot) => slot.units.length + slot.reserved;

// Индекс ячейки, куда класть следующую единицу (самая дальняя со свободным слоем).
export function freeSlotIndex(lane) {
  return lane.slots.findIndex((slot) => slotLoad(slot) < MAX_LAYERS);
}

// Ячейка, откуда можно взять единицу: ближайшая к проезду непустая.
export function topSlotIndex(lane) {
  for (let i = lane.slots.length - 1; i >= 0; i--) {
    if (lane.slots[i].units.length > 0) return i;
  }

  return -1;
}

export const laneUnitCount = (lane) => lane.slots.reduce((sum, slot) => sum + slot.units.length, 0);
export const laneFreeCapacity = (lane) => lane.slots.reduce((sum, slot) => sum + Math.max(0, MAX_LAYERS - slotLoad(slot)), 0);
export const laneCapacity = (lane) => lane.slots.length * MAX_LAYERS;

// Есть ли на полосе единица, которую можно брать, и никто не собирается класть новую.
export const laneHasPickable = (lane) => topSlotIndex(lane) >= 0 && lane.slots.every((slot) => slot.reserved === 0);

export const laneAnchor = (lane) => ({ ai: lane.aisleIndex, x: lane.x });

// ----------------------------------------------------------
// Остатки на площадке и в хранении одних ворот
// (gate — ворота из loaderSystem: gate.dock.lanes — площадка, gate.storageLanes — хранение)
// ----------------------------------------------------------

export const gateDockUnits = (gate) => gate.dock.lanes.reduce((sum, lane) => sum + laneUnitCount(lane), 0);
export const gateDockFreeCapacity = (gate) => gate.dock.lanes.reduce((sum, lane) => sum + laneFreeCapacity(lane), 0);
export const gateStorageFreeCapacity = (gate) => gate.storageLanes.reduce((sum, lane) => sum + laneFreeCapacity(lane), 0);
export const gateStorageUnits = (gate) => gate.storageLanes.reduce((sum, lane) => sum + laneUnitCount(lane), 0);
export const gateStorageCapacity = (gate) => gate.storageLanes.reduce((sum, lane) => sum + laneCapacity(lane), 0);
