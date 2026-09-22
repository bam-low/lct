import { FLOOR } from "../layout.js";
import {
  GRID,
  VACUUM_SWATH,
  VACUUM_MODEL_SCALE,
  VACUUM_HALF_WIDTH,
  VACUUM_FLOOR_OFFSET,
  VACUUM_TRANSIT_FACTOR,
  VACUUM_RETURN_RESERVE,
  VACUUM_START_SOC,
} from "../constants.js";
import { computeSectors, buildRowCenters } from "../sceneUtils.js";
import { dodgeX } from "../obstacles.js";
import { drawTrailSegment, fadeTrailRect, clearTrailRect, sectorToPixelRect, TRAIL_FADE_SECONDS } from "../trail.js";
import { makeVacuumRobot } from "../robots/vacuumRobot.js";
import { createEnergyMeter } from "../energy.js";
import { chargingStationPositions, createCharger, STATION_HEADING, STATION_APPROACH_DISTANCE } from "./chargingStations.js";
import { steerAround, pushOut, bodyBox, TIGHT_DISTANCE } from "./avoidance.js";
import { planRoute } from "./routing.js";

const ARRIVE_EPS = 0.15;
const TURN_RATE = 6; // рад/с — как быстро едущий робот поворачивается
const RETURN_SLACK = 1.3; // запас времени на объезды по дороге к станции
const PASS_REST_SECONDS = 20; // сколько робот стоит на станции между проходами уборки
const APPROACH_REACHED = 1.2; // на каком расстоянии от точки подъезда считаем, что робот на ней
const WAYPOINT_REACHED = 1.0; // на каком расстоянии от промежуточной точки маршрута робот сворачивает к следующей
const EPS = 1e-6;
const MARK_RADIUS = (VACUUM_SWATH / 2) * 1.2;

const angleDiff = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

function turnToward(heading, target, maxTurn) {
  const diff = angleDiff(heading, target);
  return heading + (Math.abs(diff) <= maxTurn ? diff : Math.sign(diff) * maxTurn);
}

// Участки по возрастанию расстояния от юго-западного угла (там станции), чтобы
// i-й от угла робот получил i-й от угла участок.
function sortByDistanceFromCorner(sectors) {
  const distance = (s) => Math.hypot((s.xMin + s.xMax) / 2 + FLOOR / 2, (s.zMin + s.zMax) / 2 - FLOOR / 2);
  return [...sectors].sort((a, b) => distance(a) - distance(b));
}

// ============================================================
// Флот пылесосов. Каждый убирает свой сектор «змейкой» и живёт по циклу:
//
//   toWork → working → (батарея на исходе) toStation → charging → toWork → …
//                    → (сектор убран)      toStation → charging → новый проход → toWork …
//
// Цикл бесконечный: убрав сектор, робот едет на станцию, заряжается до полной,
// ждёт, пока растворится след, и начинает уборку сектора заново.
//
// Стартуют пылесосы с частично заряженной батареей (VACUUM_START_SOC) и сразу
// едут работать; заряжаются уже потом, когда батарея на исходе.
//
// Участки раздаются по расстоянию от угла со станциями: ближайший к углу робот
// едет на ближайший к углу участок, самый дальний — на самый дальний. Едущие
// роботы объезжают друг друга и роборуки (avoidance.js).
//
// Разряд и зарядка считаются счётчиком энергии (energy.js), поэтому время
// работы на одной зарядке берётся из каталога. Возвращаться на станцию робот
// начинает заранее — когда заряда остаётся ровно на дорогу плюс небольшой запас.
// После зарядки он едет обратно в ту точку сектора, где остановился.
// ============================================================

export function createVacuumFleet({ group, zone, count, cleaningSpeed, energyProfile, obstacles, trail, grid }) {
  const transitSpeed = cleaningSpeed * VACUUM_TRANSIT_FACTOR;
  const stations = chargingStationPositions(count);
  const sectors = sortByDistanceFromCorner(computeSectors(count, zone));

  const robots = sectors.map((sector, index) => createRobot(sector, stations[index]));

  // ----------------------------------------------------------
  // Создание
  // ----------------------------------------------------------

  function createRobot(sector, station) {
    const rowCenters = buildRowCenters(sector);
    const model = makeVacuumRobot();
    const charger = createCharger(station.x);

    model.scale.setScalar(VACUUM_MODEL_SCALE);
    model.position.set(station.x, VACUUM_FLOOR_OFFSET, station.z);
    model.rotation.y = STATION_HEADING;
    group.add(model, charger.group);

    const meter = createEnergyMeter(energyProfile, { simulateBattery: true, initialSoc: VACUUM_START_SOC });

    return {
      model,
      charger,
      meter,
      station,
      sector,
      sectorPx: sectorToPixelRect(sector),
      rowCenters,
      rowIdx: 0,
      // Номинальная точка уборки (по ней считается покрытие) и то, где робот
      // стоит на самом деле (с учётом объезда роборук).
      x: rowCenters[0],
      z: sector.zMin,
      pos: { x: station.x, z: station.z },
      // Последняя точка следа: рисуем от неё, поэтому она — начало ряда, а не станция.
      lastDrawn: { x: rowCenters[0], z: sector.zMin },
      dirZ: 1,
      heading: STATION_HEADING,
      state: "toWork",
      approach: true, // сначала выехать на точку подъезда у станции, потом к цели
      route: [], // путевые точки в обход роборук
      routeKey: "",
      finished: false, // сектор убран, идёт возвращение и подготовка к новому проходу
      passes: 0, // сколько проходов уборки закончено
      restLeft: 0,
      fading: false,
      fadeTime: 0,
    };
  }

  // ----------------------------------------------------------
  // Движение
  // ----------------------------------------------------------

  function placeAt(robot, x, z, heading) {
    robot.pos.x = x;
    robot.pos.z = z;
    robot.model.position.set(x, VACUUM_FLOOR_OFFSET, z);

    if (heading !== undefined) {
      robot.heading = heading;
      robot.model.rotation.y = heading;
    }
  }

  // Едущие сейчас роботы — для них остальные едущие «круги», а не корпуса.
  const isTransit = (robot) => robot.state === "toWork" || robot.state === "toStation";

  function obstaclesFor(robot) {
    const boxes = [];
    const circles = [];

    for (const other of robots) {
      if (other === robot) continue;

      if (isTransit(other)) circles.push(other.pos);
      else boxes.push(bodyBox(other.pos));
    }

    return { boxes, circles };
  }

  // Едет к точке, объезжая роботов и роборуки; true — приехал.
  function driveToward(robot, target, dt) {
    const dx = target.x - robot.pos.x;
    const dz = target.z - robot.pos.z;
    const distance = Math.hypot(dx, dz);

    if (distance < ARRIVE_EPS) return true;

    const step = transitSpeed * dt;

    if (distance <= step) {
      placeAt(robot, target.x, target.z);
      return true;
    }

    // Роборуки обходит маршрут (routing.js), а уворачивается робот только от других роботов.
    const { boxes, circles } = obstaclesFor(robot);
    const dir = steerAround(robot.pos, { x: dx / distance, z: dz / distance }, boxes, circles);

    robot.pos.x += dir.x * step;
    robot.pos.z += dir.z * step;
    pushOut(robot.pos, { arms: obstacles, boxes, circles, tight: distance < TIGHT_DISTANCE });

    robot.heading = turnToward(robot.heading, Math.atan2(dir.x, dir.z), TURN_RATE * dt);
    placeAt(robot, robot.pos.x, robot.pos.z, robot.heading);

    return false;
  }

  // Едет к цели по маршруту в обход роборук; true — приехал.
  function driveAlong(robot, goal, dt) {
    const key = `${goal.x.toFixed(2)},${goal.z.toFixed(2)}`;

    if (robot.routeKey !== key) {
      robot.route = planRoute(robot.pos, goal, obstacles);
      robot.routeKey = key;
    }

    const next = robot.route[0];
    const last = robot.route.length === 1;

    if (!last && Math.hypot(next.x - robot.pos.x, next.z - robot.pos.z) < WAYPOINT_REACHED) {
      robot.route.shift();
      return false;
    }

    const arrived = driveToward(robot, next, dt);

    if (arrived && !last) robot.route.shift();
    if (arrived && last) robot.routeKey = "";

    return arrived && last;
  }

  // Едет к цели через точку подъезда у своей станции: и к станции, и от неё
  // пылесосы ездят только по прямой с севера — в ряду станций иначе не проехать
  // (соседние станции заняты). Без этого робот упирался бы в стоящих соседей и
  // застревал.
  function driveVia(robot, target, dt) {
    if (robot.approach) {
      const point = { x: robot.station.x, z: robot.station.z - STATION_APPROACH_DISTANCE };
      const alignedAlready = robot.state === "toStation" && robot.pos.z >= point.z - 0.5 && Math.abs(robot.pos.x - point.x) < 2.5;

      if (alignedAlready || driveAlong(robot, point, dt) || Math.hypot(point.x - robot.pos.x, point.z - robot.pos.z) < APPROACH_REACHED) {
        robot.approach = false;
        robot.routeKey = "";
      }

      return false;
    }

    return driveAlong(robot, target, dt);
  }

  // Где робот должен стоять, чтобы продолжить уборку (с учётом объезда).
  const resumePoint = (robot) => ({ x: dodgeX(robot.x, robot.z, obstacles, VACUUM_HALF_WIDTH), z: robot.z });

  // ----------------------------------------------------------
  // Уборка
  // ----------------------------------------------------------

  // Помечает покрытые клетки вокруг номинальной точки (без объезда) и
  // возвращает, сколько клеток покрыто впервые.
  function markCoverage(robot) {
    const s = robot.sector;
    const minGX = Math.max(0, Math.floor(Math.max(robot.x - MARK_RADIUS, s.xMin) + FLOOR / 2));
    const maxGX = Math.min(GRID - 1, Math.ceil(Math.min(robot.x + MARK_RADIUS, s.xMax) + FLOOR / 2));
    const minGZ = Math.max(0, Math.floor(Math.max(robot.z - MARK_RADIUS, s.zMin) + FLOOR / 2));
    const maxGZ = Math.min(GRID - 1, Math.ceil(Math.min(robot.z + MARK_RADIUS, s.zMax) + FLOOR / 2));

    let newly = 0;

    for (let gx = minGX; gx <= maxGX; gx++) {
      for (let gz = minGZ; gz <= maxGZ; gz++) {
        const wx = gx - FLOOR / 2 + 0.5;
        const wz = gz - FLOOR / 2 + 0.5;

        if (wx < s.xMin - EPS || wx > s.xMax + EPS || wz < s.zMin - EPS || wz > s.zMax + EPS) continue;

        if ((wx - robot.x) ** 2 + (wz - robot.z) ** 2 <= MARK_RADIUS ** 2) {
          const idx = gz * GRID + gx;

          if (!grid[idx]) {
            grid[idx] = 1;
            newly++;
          }
        }
      }
    }

    return newly;
  }

  // Новый проход: сектор снова не убран, робот встаёт в начало первого ряда.
  function startNewPass(robot) {
    const s = robot.sector;

    robot.passes++;
    robot.finished = false;
    robot.rowIdx = 0;
    robot.dirZ = 1;
    robot.x = robot.rowCenters[0];
    robot.z = s.zMin;
    robot.lastDrawn = { x: robot.x, z: robot.z };

    // Убранное в прошлом проходе снова считается неубранным.
    for (let gx = 0; gx < GRID; gx++) {
      const wx = gx - FLOOR / 2 + 0.5;
      if (wx < s.xMin - EPS || wx > s.xMax + EPS) continue;

      for (let gz = 0; gz < GRID; gz++) {
        const wz = gz - FLOOR / 2 + 0.5;
        if (wz >= s.zMin - EPS && wz <= s.zMax + EPS) grid[gz * GRID + gx] = 0;
      }
    }
  }

  // Хватит ли заряда доехать до станции прямо отсюда (с запасом)?
  function mustReturnToStation(robot) {
    if (!robot.meter.hasBattery) return false;

    const backSeconds =
      (Math.hypot(robot.station.x - robot.pos.x, robot.station.z - robot.pos.z) / transitSpeed) * RETURN_SLACK;
    return robot.meter.soc <= robot.meter.socCostOf(backSeconds) + VACUUM_RETURN_RESERVE;
  }

  // Один шаг «змейки»: двигаемся вдоль сектора, на краю переходим на новый ряд.
  function advanceSweep(robot, dt) {
    robot.z += robot.dirZ * cleaningSpeed * dt;

    const atMax = robot.dirZ > 0 && robot.z >= robot.sector.zMax;
    const atMin = robot.dirZ < 0 && robot.z <= robot.sector.zMin;

    if (atMax || atMin) {
      robot.z = atMax ? robot.sector.zMax : robot.sector.zMin;
      robot.rowIdx++;

      if (robot.rowIdx >= robot.rowCenters.length) {
        robot.finished = true;
        robot.fading = true; // след растворяется, как только сектор убран
        robot.fadeTime = 0;
      } else {
        robot.dirZ *= -1;
        robot.x = robot.rowCenters[robot.rowIdx];
      }
    }

    // Физически чистим номинальную клетку, но визуально слегка объезжаем
    // роборуки — модельки не должны наезжать друг на друга.
    const renderX = dodgeX(robot.x, robot.z, obstacles, VACUUM_HALF_WIDTH);

    placeAt(robot, renderX, robot.z, robot.dirZ > 0 ? 0 : Math.PI);

    if (Math.abs(renderX - robot.lastDrawn.x) > 0.0001 || Math.abs(robot.z - robot.lastDrawn.z) > 0.0001) {
      drawTrailSegment(trail.ctx, robot.lastDrawn, robot.pos, robot.sectorPx);
      robot.lastDrawn = { x: renderX, z: robot.z };
      trail.texture.needsUpdate = true;
    }
  }

  // ----------------------------------------------------------
  // Автомат состояний
  // ----------------------------------------------------------

  // Возвращает число впервые покрытых клеток (только на уборке).
  function updateRobot(robot, dt) {
    let newly = 0;

    switch (robot.state) {
      case "charging":
        // Стоим на станции: заряжаемся и потребляем в режиме ожидания.
        robot.meter.consume(dt, "idle");
        robot.meter.charge(dt);

        if (robot.finished) robot.restLeft -= dt;

        // После законченного прохода ждём полной зарядки, паузы и того, чтобы
        // растворился след, — и убираем сектор заново.
        if (robot.meter.isFull() && (!robot.finished || (robot.restLeft <= 0 && !robot.fading))) {
          if (robot.finished) startNewPass(robot);
          robot.state = "toWork";
          robot.approach = true;
        }
        break;

      case "toWork":
        robot.meter.consume(dt, "work");
        if (driveVia(robot, resumePoint(robot), dt)) robot.state = "working";
        break;

      case "working":
        robot.meter.consume(dt, "work");

        if (mustReturnToStation(robot)) {
          robot.state = "toStation";
          robot.approach = true;
          break;
        }

        advanceSweep(robot, dt);
        newly = markCoverage(robot);
        if (robot.finished) {
          robot.state = "toStation";
          robot.approach = true;
        }
        break;

      case "toStation":
        robot.meter.consume(dt, "work");

        if (driveVia(robot, robot.station, dt)) {
          placeAt(robot, robot.station.x, robot.station.z, STATION_HEADING);
          robot.state = "charging";
          robot.restLeft = PASS_REST_SECONDS;
        }
        break;

      default:
        break;
    }

    robot.charger.setLed(chargerLedOf(robot));

    return newly;
  }

  function chargerLedOf(robot) {
    if (robot.state !== "charging") return "off";

    return robot.meter.isFull() ? "full" : "charging";
  }

  // ----------------------------------------------------------
  // Публичный интерфейс
  // ----------------------------------------------------------

  // Для проверки расчётной производительности: сколько клеток убрано и сколько
  // секунд шла уборка (время, пока хотя бы один робот ещё не закончил проход).
  let cleanedCells = 0;
  let activeSeconds = 0;

  // Шаг симуляции; возвращает, сколько клеток пола покрыто впервые.
  function step(dt) {
    const newly = robots.reduce((sum, robot) => sum + updateRobot(robot, dt), 0);

    cleanedCells += newly;
    if (robots.some((robot) => !robot.finished)) activeSeconds += dt;

    return newly;
  }

  // Растворение следа — в реальном времени, независимо от множителя скорости.
  function updateFades(dt) {
    for (const robot of robots) {
      if (!robot.fading) continue;

      robot.fadeTime += dt;
      fadeTrailRect(trail.ctx, robot.sectorPx, dt);
      trail.texture.needsUpdate = true;

      if (robot.fadeTime >= TRAIL_FADE_SECONDS) {
        clearTrailRect(trail.ctx, robot.sectorPx);
        robot.fading = false;
      }
    }
  }

  function getStats() {
    const socs = robots.map((r) => r.meter.soc).filter((soc) => soc !== null);

    return {
      finished: robots.filter((r) => r.finished).length,
      passes: robots.reduce((sum, r) => sum + r.passes, 0),
      charging: robots.filter((r) => r.state === "charging").length,
      minSoc: socs.length > 0 ? Math.min(...socs) : null,
      cleanedCells,
      activeSeconds: Math.round(activeSeconds),
    };
  }

  function dispose() {
    for (const robot of robots) {
      group.remove(robot.model, robot.charger.group);
      robot.charger.dispose();
    }
  }

  return { step, updateFades, getStats, dispose, meters: robots.map((r) => r.meter), stations };
}
