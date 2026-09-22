import {
  freeSlotIndex,
  topSlotIndex,
  laneUnitCount,
  laneFreeCapacity,
  laneHasPickable,
  gateDockUnits,
  gateDockFreeCapacity,
  gateStorageFreeCapacity,
  gateStorageUnits,
} from "./storageLayout.js";

const UNLOAD_INTERVAL = 0.22; // с между единицами груза, выезжающими из фуры
const FLIGHT_SECONDS = 0.9; // сколько груз летит от кузова до площадки и обратно
const FLIGHT_ARC = 1.6;
const OUTBOUND_WAIT_SECONDS = 20; // сколько фура ждёт недостающий груз, прежде чем уехать неполной
const MAX_TRUCKS_WAITING = 2; // сколько фур одних ворот ждут своей очереди

// ============================================================
// Цикл ворот: как груз попадает на склад и уходит с него.
//
// У каждых ворот свой цикл:
//   загрузка   — фуры по очереди подъезжают, разом выгружают весь груз на площадку
//                и уезжают, пока в хранении зоны не кончится место;
//   разгрузка  — груз, который вернули на площадку, увозят фуры; когда зона
//                опустела, снова загрузка.
// Перевозят груз между площадкой и хранением погрузчики (loaderSystem.js).
//
// gates — ворота (см. loaderSystem.js); cargoFactory — фабрика грузовых единиц;
// payload — единиц в одной фуре; arrivalInterval — как часто приезжает фура к
// одним воротам, с. Возвращает step(dt) — шаг всех ворот, counters — счётчики
// принятого/отгруженного груза и фур, dispose().
// ============================================================

export function createGateOperations({ group, gates, cargoFactory, payload, arrivalInterval }) {
  const layerLift = (layer) => layer * cargoFactory.unitHeight;

  const counters = { received: 0, shipped: 0, trucksIn: 0, trucksOut: 0 };
  const flights = []; // единицы, летящие между кузовом и площадкой

  const dockUnits = gateDockUnits;
  const dockFreeCapacity = gateDockFreeCapacity;
  const storageFreeCapacity = gateStorageFreeCapacity;
  const storageUnits = gateStorageUnits;

  // ----------------------------------------------------------
  // Груз в полёте (из кузова на площадку и обратно)
  // ----------------------------------------------------------

  function launch(unit, from, to, onLand) {
    flights.push({ unit, from, to, t: 0, onLand });
  }

  function updateFlights(dt) {
    for (let i = flights.length - 1; i >= 0; i--) {
      const flight = flights[i];
      flight.t = Math.min(1, flight.t + dt / FLIGHT_SECONDS);

      const { t, from, to } = flight;
      flight.unit.position.set(
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t + FLIGHT_ARC * 4 * t * (1 - t),
        from.z + (to.z - from.z) * t
      );

      if (t >= 1) {
        flights.splice(i, 1);
        flight.onLand();
      }
    }
  }

  // ----------------------------------------------------------
  // Фуры у ворот
  // ----------------------------------------------------------

  // Пора ли отправлять за грузом фуру: набралась полная фура или больше груза
  // этих ворот на хранении не осталось.
  function outboundReady(gate) {
    const units = dockUnits(gate);
    return units > 0 && (units >= payload || gate.owed === 0);
  }

  function updateDispatch(gate, dt) {
    if (gate.startTimer > 0) {
      gate.startTimer -= dt;
      if (gate.startTimer <= 0) gate.trucksWaiting = 1;
    }

    if (gate.mode === "loading" && gate.startTimer <= 0) {
      gate.arrivalTimer += dt;

      if (gate.arrivalTimer >= arrivalInterval) {
        gate.arrivalTimer -= arrivalInterval;
        gate.trucksWaiting = Math.min(MAX_TRUCKS_WAITING, gate.trucksWaiting + 1);
      }
    }

    if (gate.bay.busy) return;

    if (gate.mode === "loading" && gate.trucksWaiting > 0 && storageFreeCapacity(gate) > 0 && dockFreeCapacity(gate) >= payload) {
      gate.bay.begin("inbound");
      gate.trucksWaiting--;
    } else if (gate.mode === "unloading" && outboundReady(gate)) {
      gate.bay.begin("outbound");
    }
  }

  // Полоса площадки, куда можно выгрузить очередную единицу: свободная, не занятая
  // погрузчиком, с наибольшим запасом места — так груз ложится по всем полосам поровну.
  function dockLaneForIncoming(gate) {
    let best = null;

    for (const lane of gate.dock.lanes) {
      if ((lane.claimedBy && lane.claimedBy !== gate.bay) || laneFreeCapacity(lane) === 0) continue;
      if (!best || laneFreeCapacity(lane) > laneFreeCapacity(best)) best = lane;
    }

    return best;
  }

  function startTransfer(gate) {
    gate.transfer = { kind: gate.bay.kind, remaining: payload, timer: 0, inFlight: 0, taken: 0, waited: 0, claimed: new Set() };
  }

  function finishTransfer(gate) {
    const { transfer } = gate;

    for (const lane of transfer.claimed) {
      if (lane.claimedBy === gate.bay) lane.claimedBy = null;
    }

    if (transfer.kind === "inbound") counters.trucksIn++;
    else counters.trucksOut++;

    gate.transfer = null;
    gate.bay.depart();
  }

  function stepInbound(gate, dt) {
    const { transfer, bay } = gate;

    transfer.timer -= dt;

    while (transfer.timer <= 0 && transfer.remaining > 0) {
      const lane = dockLaneForIncoming(gate);
      if (!lane) break; // все полосы заняты погрузчиком — ждём

      lane.claimedBy = bay;
      transfer.claimed.add(lane);

      const slot = lane.slots[freeSlotIndex(lane)];
      const layer = slot.units.length + slot.reserved;
      slot.reserved++;

      const unit = cargoFactory.create();
      unit.userData.origin = gate.index;
      group.add(unit);

      const door = bay.doorway();
      transfer.inFlight++;
      transfer.remaining--;
      transfer.timer += UNLOAD_INTERVAL;
      counters.received++;

      launch(unit, { x: door.x, y: door.y, z: door.z }, { x: lane.x, y: layerLift(layer), z: slot.z }, () => {
        slot.reserved--;
        slot.units.push(unit);
        transfer.inFlight--;
      });
    }

    if (transfer.remaining === 0 && transfer.inFlight === 0) finishTransfer(gate);
  }

  const takeableDockLanes = (gate) => gate.dock.lanes.filter((l) => (!l.claimedBy || l.claimedBy === gate.bay) && laneHasPickable(l));

  function stepOutbound(gate, dt) {
    const { transfer, bay } = gate;

    transfer.timer -= dt;

    while (transfer.timer <= 0 && transfer.taken < payload) {
      const lane = takeableDockLanes(gate).sort((a, b) => laneUnitCount(b) - laneUnitCount(a))[0];
      if (!lane) break;

      lane.claimedBy = bay;
      transfer.claimed.add(lane);

      const slot = lane.slots[topSlotIndex(lane)];
      const layer = slot.units.length - 1;
      const unit = slot.units.pop();
      const door = bay.doorway();

      transfer.inFlight++;
      transfer.taken++;
      transfer.waited = 0;
      transfer.timer += UNLOAD_INTERVAL;

      launch(unit, { x: lane.x, y: layerLift(layer), z: slot.z }, { x: door.x, y: door.y, z: door.z }, () => {
        group.remove(unit);
        counters.shipped++;
        transfer.inFlight--;
      });
    }

    if (transfer.inFlight > 0) return;

    // Фура уезжает полной. Если груза пока не хватает (его ещё несёт погрузчик),
    // она ждёт, но не дольше OUTBOUND_WAIT_SECONDS, а когда везти больше нечего —
    // уезжает сразу.
    const full = transfer.taken >= payload;
    const canTakeMore = takeableDockLanes(gate).length > 0;
    const loaderBusy = gate.dock.lanes.some((l) => l.claimedBy && l.claimedBy !== bay);

    if (full || (gate.owed === 0 && !loaderBusy && !canTakeMore)) {
      finishTransfer(gate);
      return;
    }

    if (!canTakeMore) {
      transfer.waited += dt;
      if (transfer.waited > OUTBOUND_WAIT_SECONDS) finishTransfer(gate);
    }
  }

  function updateBay(gate, dt) {
    gate.bay.update(dt);

    if (gate.bay.docked && !gate.transfer) startTransfer(gate);
    if (!gate.transfer) return;

    if (gate.transfer.kind === "inbound") stepInbound(gate, dt);
    else stepOutbound(gate, dt);
  }

  // ----------------------------------------------------------
  // Фазы ворот
  // ----------------------------------------------------------

  const carriedFor = (gate) => gate.loaders.some((loader) => loader.carried?.userData.origin === gate.index);

  function updateMode(gate) {
    if (gate.mode === "loading" && storageFreeCapacity(gate) === 0 && gate.bay.kind !== "inbound") {
      gate.mode = "unloading";
      gate.trucksWaiting = 0;
      gate.arrivalTimer = 0;
      return;
    }

    const nothingLeft = storageUnits(gate) === 0 && !carriedFor(gate) && dockUnits(gate) === 0 && !gate.bay.busy;

    if (gate.mode === "unloading" && nothingLeft) {
      gate.mode = "loading";
      gate.cycles++;
      gate.trucksWaiting = 1;
    }
  }


  function step(dt) {
    for (const gate of gates) {
      updateDispatch(gate, dt);
      updateBay(gate, dt);
      updateMode(gate);
    }

    updateFlights(dt);
  }

  function dispose() {
    for (const gate of gates) gate.bay.dispose();
    for (const flight of flights) group.remove(flight.unit);
  }

  return { step, counters, dispose };
}
