import { GATE_XS } from "../layout.js";

// Раскладка зоны погрузки (все числа — единицы сцены, z растёт к югу):
//
//   z = -50   стена с воротами; у каждых ворот — площадка, где ждёт груз
//   z = -42   проезд вдоль стены (погрузчики ездят по нему вдоль x)
//   z = -37…-27  «свои» полосы хранения у каждых ворот: погрузчик заезжает в
//             полосу до самой дальней (южной) свободной ячейки, ставит груз и
//             сдаёт назад. В каждой ячейке до MAX_LAYERS единиц друг на друге.
//             Полоса заполняется «в глубину», а проезд всегда свободен.
export const PAD_Z = -47.2; // центр груза на площадке
export const CORRIDOR_Z = -42;

export const LANES_PER_GATE = 3;
export const LANE_PITCH = 3.8;
export const SLOT_PITCH = 2.4;
export const SLOTS_PER_LANE = 4;
export const DEEPEST_SLOT_Z = -29;
export const MAX_LAYERS = 2;

export const PAD_WIDTH = 10;

export const STORAGE_Z_MIN = DEEPEST_SLOT_Z - (SLOTS_PER_LANE - 1) * SLOT_PITCH - SLOT_PITCH / 2;
export const STORAGE_Z_MAX = DEEPEST_SLOT_Z + SLOT_PITCH / 2;

// Центры полос хранения ворот: одна ровно под воротами и по бокам от неё.
// Порядок = порядок заполнения (от центра наружу).
export function laneXsOfGate(gateX) {
  const offsets = Array.from({ length: LANES_PER_GATE }, (_, i) => Math.ceil(i / 2) * (i % 2 === 1 ? -1 : 1));
  return offsets.map((k) => gateX + k * LANE_PITCH);
}

// Ворота с площадкой и «своим» хранилищем. Каждое хранилище ходит по
// собственному циклу: загрузка → заполнено → разгрузка → пусто → загрузка.
export function createGates() {
  return GATE_XS.map((x, index) => ({
    index,
    x,
    // Площадка: единицы друг на друге (стопкой снизу вверх).
    pad: { units: [], claimedBy: null, reserved: 0 },
    lanes: laneXsOfGate(x).map((laneX) => ({
      x: laneX,
      // slots[0] — самая дальняя (южная) ячейка, заполняются по порядку.
      slots: Array.from({ length: SLOTS_PER_LANE }, (_, j) => ({
        z: DEEPEST_SLOT_Z - j * SLOT_PITCH,
        units: [], // слои снизу вверх
        busy: false, // ячейку сейчас обслуживает погрузчик
      })),
    })),
    mode: "loading", // 'loading' | 'unloading'
    busy: false, // хранилище ворот сейчас обслуживает погрузчик
    cycles: 0, // сколько раз хранилище прошло полный цикл
  }));
}

// Первая ячейка, куда ещё можно поставить единицу (глубокие — первыми).
export function findFreeCell(gate) {
  for (const lane of gate.lanes) {
    for (const slot of lane.slots) {
      if (!slot.busy && slot.units.length < MAX_LAYERS) return { lane, slot, layer: slot.units.length };
    }
  }

  return null;
}

// Откуда снимать при разгрузке: с конца, то есть сначала то, что положили
// последним — оно ближе к выезду и ничем не перекрыто.
export function findTopCell(gate) {
  for (let l = gate.lanes.length - 1; l >= 0; l--) {
    const lane = gate.lanes[l];

    for (let s = lane.slots.length - 1; s >= 0; s--) {
      const slot = lane.slots[s];
      if (!slot.busy && slot.units.length > 0) return { lane, slot, layer: slot.units.length - 1 };
    }
  }

  return null;
}

export function countStoredUnits(gate) {
  return gate.lanes.reduce((sum, lane) => sum + lane.slots.reduce((s, slot) => s + slot.units.length, 0), 0);
}

export function storageCapacityUnits(gate) {
  return gate.lanes.reduce((sum, lane) => sum + lane.slots.length * MAX_LAYERS, 0);
}
