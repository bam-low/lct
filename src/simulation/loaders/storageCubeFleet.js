import * as THREE from "three";
import { makeStorageCubeRobot } from "../robots/storageCubeRobot.js";
import { makeStorageShuttle, makeCarriedCrate } from "../robots/storageShuttleRobot.js";
import { createEnergyMeter } from "../energy.js";
import { disposeTree } from "../sceneUtils.js";

const CUBE_SCALE = 2.4;
const SHUTTLE_CLEARANCE = 0.35; // насколько шаттл едет выше макушек башен, чтобы не проваливаться в геометрию
const SHUTTLE_SPEED = 2.2; // ед. сцены/с — переезд между башнями
const RISE_SECONDS = 2.2; // подъём/спуск коробки внутри шахты
const AT_TOWER_PAUSE_S = 0.6;
const INWARD_STEP = 10; // насколько сетка отступает от ворот внутрь помещения
const BOX_RISE_LOCAL = 1.4; // локальный ход узла "БОКС" вверх — визуально подобранное значение, см. createTower

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// СтойкаБокс, версия 2 (по правке пользователя): раньше каждая башня возила
// собственный лифт-шаттл независимо друг от друга и была разбросана по всем
// воротам. Теперь это единая плотная сетка стационарных башен ("чёрные стойки
// плотно друг к другу"), а перекладывает груз между ними ОДИН робот-шаттл,
// который ездит поверх сетки по X/Z и поднимает/опускает коробку внутри
// шахты той башни, у которой сейчас стоит — визуально "лифт к роботу, когда
// он подъезжает". Как и раньше: своего движения по остальному складу нет,
// груз в реальности подаёт манипулятор/конвейер или погрузчик снаружи сетки.
// throughputPerHour больше не используется впрямую: раньше им симулировали
// движение (throughput * count/час — просто пересчёт входного параметра
// обратно в статистику, без настоящей связи с анимацией). Теперь throughput
// в статистике честно берётся из реальных циклов шаттла (см. cyclesDone) —
// сравнение с расчётной потребностью в панели "Подтверждение расчёта" может
// разойтись сильнее, чем раньше: один шаттл физически не масштабируется с
// count так же линейно, как раньше масштабировались независимые лифты в
// каждой башне. Оставлено в сигнатуре ради обратной совместимости вызова.
export function createStorageCubeFleet({ group, gates, count, energyProfile, throughputPerHour: _throughputPerHour = 0 }) {
  const anchor = anchorOf(gates);
  const towers = gates.length ? Array.from({ length: count }, (_, i) => createTower(i, count, anchor)) : [];

  // Кому изначально есть что везти: часть башен стартует с коробкой, часть
  // пустая — иначе шаттлу не из чего/некуда было бы возить с самого начала.
  for (let i = 0; i < towers.length; i++) {
    const hasBox = towers.length < 2 ? true : i % 5 !== 4; // примерно 4 из 5 полны, минимум одна пустая
    setTowerBox(towers[i], hasBox, towers[i].restY);
  }

  const topY = towers.length ? Math.max(...towers.map((t) => t.topWorldY)) : 0;
  const shuttle = towers.length ? makeStorageShuttle() : null;
  let carriedCrate = null;
  if (shuttle) {
    const start = towers[0];
    shuttle.position.set(start.x, topY + SHUTTLE_CLEARANCE, start.z);
    group.add(shuttle);
  }

  function anchorOf(gateList) {
    if (!gateList.length) return { x: 0, z: 0, inward: { x: 0, z: -1 } };
    const gate = gateList[0];
    const [nx, nz] = gate.normal;
    return { x: gate.worldCenter.x, z: gate.worldCenter.z, inward: { x: -nx, z: -nz } };
  }

  function createTower(index, total, anchorPoint) {
    const model = makeStorageCubeRobot();
    model.scale.setScalar(CUBE_SCALE);
    group.add(model);

    const node = model.getObjectByName("БОКС") ?? null;

    // Габариты каркаса без узла "БОКС": в исходном файле он стоит в стороне
    // от остальной модели на много единиц ниже (похоже на огрех самого
    // файла) — если мерить границы вместе с ним, вся башня (и, значит, высота
    // езды шаттла) улетает на десятки единиц вверх. Меряем каркас отдельно, а
    // подъём/спуск самого узла — фиксированным, визуально проверенным ходом.
    if (node) node.visible = false;
    const footprint = new THREE.Box3().setFromObject(model);
    if (node) node.visible = true;

    const spanX = Math.max(0.1, footprint.max.x - footprint.min.x) + 0.05;
    const spanZ = Math.max(0.1, footprint.max.z - footprint.min.z) + 0.05;

    const cols = Math.max(1, Math.ceil(Math.sqrt(total)));
    const col = index % cols;
    const row = Math.floor(index / cols);
    const rows = Math.ceil(total / cols);

    const gridX = anchorPoint.x + anchorPoint.inward.x * INWARD_STEP + (col - (cols - 1) / 2) * spanX;
    const gridZ = anchorPoint.z + anchorPoint.inward.z * INWARD_STEP + (row - (rows - 1) / 2) * spanZ;

    model.position.set(gridX, 0, gridZ);

    const restY = node ? node.position.y : 0;
    const localTopY = restY + BOX_RISE_LOCAL;

    return { model, node, restY, localTopY, topWorldY: footprint.max.y, x: gridX, z: gridZ, hasBox: true };
  }

  function setTowerBox(tower, hasBox, atLocalY) {
    tower.hasBox = hasBox;
    if (tower.node) {
      tower.node.visible = hasBox;
      tower.node.position.y = atLocalY;
    }
  }

  const meter = createEnergyMeter(energyProfile);

  let shuttleState = "idle";
  let stateT = 0;
  let source = null;
  let dest = null;
  let cyclesDone = 0;
  let simSeconds = 0;

  function pickPair() {
    const withBox = towers.filter((t) => t.hasBox);
    const empty = towers.filter((t) => !t.hasBox);
    if (!withBox.length || !empty.length) return null;

    return {
      source: withBox[Math.floor(Math.random() * withBox.length)],
      dest: empty[Math.floor(Math.random() * empty.length)],
    };
  }

  function travelDuration(from, to) {
    return Math.max(0.2, Math.hypot(to.x - from.x, to.z - from.z) / SHUTTLE_SPEED);
  }

  function step(dt) {
    simSeconds += dt;
    meter.consume(dt, shuttleState === "idle" ? "idle" : "work");

    if (!shuttle) return;

    stateT += dt;

    switch (shuttleState) {
      case "idle": {
        const pair = pickPair();
        if (!pair) break;
        source = pair.source;
        dest = pair.dest;
        shuttleState = "toSource";
        stateT = 0;
        shuttle.userData.travelFrom = { x: shuttle.position.x, z: shuttle.position.z };
        shuttle.userData.travelDuration = travelDuration(shuttle.userData.travelFrom, source);
        break;
      }

      case "toSource": {
        const p = Math.min(1, stateT / shuttle.userData.travelDuration);
        shuttle.position.x = lerp(shuttle.userData.travelFrom.x, source.x, p);
        shuttle.position.z = lerp(shuttle.userData.travelFrom.z, source.z, p);
        if (p >= 1) {
          shuttleState = "boxUp";
          stateT = 0;
        }
        break;
      }

      case "boxUp": {
        const p = Math.min(1, stateT / RISE_SECONDS);
        if (source.node) source.node.position.y = lerp(source.restY, source.localTopY, p);
        if (p >= 1) {
          setTowerBox(source, false, source.restY);
          carriedCrate = makeCarriedCrate(pickCrateColor(cyclesDone));
          carriedCrate.position.y = 0.05;
          shuttle.add(carriedCrate);

          shuttleState = "toDest";
          stateT = 0;
          shuttle.userData.travelFrom = { x: shuttle.position.x, z: shuttle.position.z };
          shuttle.userData.travelDuration = travelDuration(shuttle.userData.travelFrom, dest);
        }
        break;
      }

      case "toDest": {
        const p = Math.min(1, stateT / shuttle.userData.travelDuration);
        shuttle.position.x = lerp(shuttle.userData.travelFrom.x, dest.x, p);
        shuttle.position.z = lerp(shuttle.userData.travelFrom.z, dest.z, p);
        if (p >= 1) {
          if (carriedCrate) {
            shuttle.remove(carriedCrate);
            disposeTree(carriedCrate);
            carriedCrate = null;
          }
          setTowerBox(dest, true, dest.localTopY);
          shuttleState = "boxDown";
          stateT = 0;
        }
        break;
      }

      case "boxDown": {
        const p = Math.min(1, stateT / RISE_SECONDS);
        if (dest.node) dest.node.position.y = lerp(dest.localTopY, dest.restY, p);
        if (p >= 1) {
          cyclesDone += 1;
          source = null;
          dest = null;
          shuttleState = "atRestPause";
          stateT = 0;
        }
        break;
      }

      case "atRestPause": {
        if (stateT >= AT_TOWER_PAUSE_S) {
          shuttleState = "idle";
          stateT = 0;
        }
        break;
      }

      default:
        break;
    }
  }

  function pickCrateColor(seed) {
    const keys = ["crateA", "crateB", "crateC"];
    return keys[seed % keys.length];
  }

  function getStats() {
    const hours = simSeconds / 3600;
    return {
      phase: "storage",
      cycles: cyclesDone,
      storedKg: 0,
      fillPercent: towers.length ? Math.round((towers.filter((t) => t.hasBox).length / towers.length) * 100) : 0,
      dockUnits: 0,
      trucksAtGates: 0,
      trucksWaiting: 0,
      trucksIn: 0,
      trucksOut: 0,
      receivedKg: 0,
      shippedKg: 0,
      movedPerHour: hours > 0 ? Math.round(cyclesDone / hours) : 0,
      receivedPerHour: 0,
      shippedPerHour: 0,
      avgRouteM: 0,
      busyLoaders: shuttleState === "idle" || shuttleState === "atRestPause" ? 0 : 1,
    };
  }

  function dispose() {
    for (const tower of towers) {
      group.remove(tower.model);
      disposeTree(tower.model);
    }
    if (carriedCrate) disposeTree(carriedCrate);
    if (shuttle) {
      group.remove(shuttle);
      disposeTree(shuttle);
    }
  }

  return {
    step,
    getStats,
    dispose,
    meters: [meter],
    payload: 1,
    storageCapacityUnits: 0,
  };
}
