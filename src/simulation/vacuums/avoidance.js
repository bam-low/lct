import { VACUUM_HALF_WIDTH } from "../constants.js";

// Как пылесосы не сталкиваются друг с другом и с роборуками.
//
// Работающий, стоящий или заряжающийся робот занимает прямоугольник (он всегда
// смотрит вдоль оси Z). Едущий (в пути на станцию или к участку) — круг. Едущий
// робот:
//   1) заранее сворачивает от препятствий впереди (steerAround) — при лобовой
//      встрече оба держатся правой стороны;
//   2) если всё же оказался внутри чужого корпуса, выталкивается наружу
//      (pushOut) — работающих и стоящих роботов никто не сдвигает, чтобы они не
//      сбивались со своих рядов.
export const BODY_HALF_LENGTH = 2.1;
export const TRANSIT_RADIUS = 2.2;

// Радиусы выталкивания поменьше — иначе робот не смог бы доехать до цели, которая
// стоит вплотную к препятствию:
//   у роборук — их габарит уже с запасом, а точка, где пылесос убирает рядом с
//                 рукой, отстоит от него ровно на полуширину корпуса;
//   у уборщиков — на подъезде к цели (TIGHT_DISTANCE): соседние ряды на границе
//                 участков стоят вплотную, корпус к корпусу.
const ARM_PUSH_RADIUS = VACUUM_HALF_WIDTH - 0.3;
const TIGHT_PUSH_RADIUS = VACUUM_HALF_WIDTH - 0.2;
export const TIGHT_DISTANCE = 5;

const CLEARANCE = 0.2;
const LOOKAHEAD = 9;
const STEER_GAIN = 1.7;
const HEAD_ON_EPS = 0.12;

// Прямоугольник, который занимает неподвижный (или работающий) пылесос.
export const bodyBox = (pos) => ({ x: pos.x, z: pos.z, halfX: VACUUM_HALF_WIDTH, halfZ: BODY_HALF_LENGTH });

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Ближайшая к точке (x, z) точка прямоугольника.
function nearestOnBox(x, z, box) {
  return {
    x: clamp(x, box.x - box.halfX, box.x + box.halfX),
    z: clamp(z, box.z - box.halfZ, box.z + box.halfZ),
  };
}

// Куда свернуть, чтобы объехать препятствия впереди. dir — единичный вектор
// желаемого движения; возвращает новый единичный вектор.
export function steerAround(pos, dir, boxes, circles) {
  const right = { x: -dir.z, z: dir.x }; // справа по ходу движения
  let steerX = 0;
  let steerZ = 0;

  const consider = (nearest) => {
    const rx = nearest.x - pos.x;
    const rz = nearest.z - pos.z;
    const distance = Math.hypot(rx, rz);

    if (distance > LOOKAHEAD || distance < 1e-6) return;
    if ((rx * dir.x + rz * dir.z) / distance < 0.2) return; // позади или сбоку

    const side = (rx * right.x + rz * right.z) / distance; // >0 — препятствие справа
    const turn = Math.abs(side) < HEAD_ON_EPS ? 1 : -Math.sign(side); // лоб в лоб — вправо
    const weight = (1 - distance / LOOKAHEAD) * STEER_GAIN * turn;

    steerX += right.x * weight;
    steerZ += right.z * weight;
  };

  for (const box of boxes) consider(nearestOnBox(pos.x, pos.z, box));
  for (const circle of circles) consider(circle);

  const x = dir.x + steerX;
  const z = dir.z + steerZ;
  const length = Math.hypot(x, z) || 1;

  return { x: x / length, z: z / length };
}

// Выталкивает круг радиуса r с центром pos из прямоугольника; true — сдвинули.
function pushOutOfBox(pos, r, box) {
  const nearest = nearestOnBox(pos.x, pos.z, box);
  const dx = pos.x - nearest.x;
  const dz = pos.z - nearest.z;
  const distance = Math.hypot(dx, dz);

  if (distance >= r + CLEARANCE) return false;

  if (distance > 1e-6) {
    const push = (r + CLEARANCE - distance) / distance;
    pos.x += dx * push;
    pos.z += dz * push;
    return true;
  }

  // Центр внутри прямоугольника — выходим через ближайшую грань.
  const toLeft = pos.x - (box.x - box.halfX);
  const toRight = box.x + box.halfX - pos.x;
  const toTop = pos.z - (box.z - box.halfZ);
  const toBottom = box.z + box.halfZ - pos.z;
  const smallest = Math.min(toLeft, toRight, toTop, toBottom);

  if (smallest === toLeft) pos.x = box.x - box.halfX - r - CLEARANCE;
  else if (smallest === toRight) pos.x = box.x + box.halfX + r + CLEARANCE;
  else if (smallest === toTop) pos.z = box.z - box.halfZ - r - CLEARANCE;
  else pos.z = box.z + box.halfZ + r + CLEARANCE;

  return true;
}

function pushOutOfCircle(pos, other) {
  const minDistance = 2 * TRANSIT_RADIUS + CLEARANCE;
  const dx = pos.x - other.x;
  const dz = pos.z - other.z;
  const distance = Math.hypot(dx, dz);

  if (distance >= minDistance) return false;

  const ux = distance > 1e-6 ? dx / distance : 1;
  const uz = distance > 1e-6 ? dz / distance : 0;
  const push = (minDistance - distance) / 2; // расходятся оба едущих

  pos.x += ux * push;
  pos.z += uz * push;
  other.x -= ux * push;
  other.z -= uz * push;

  return true;
}

// Разводит едущий робот (pos — его точка, меняется на месте) с остальными:
// arms — роборуки, boxes — неподвижные корпуса пылесосов, circles — другие едущие
// роботы (их точки тоже сдвигаются, поэтому передаём сами объекты позиций).
// tight — робот на подъезде к цели.
export function pushOut(pos, { arms, boxes, circles, tight }) {
  for (const box of arms) pushOutOfBox(pos, ARM_PUSH_RADIUS, box);
  for (const box of boxes) pushOutOfBox(pos, tight ? TIGHT_PUSH_RADIUS : TRANSIT_RADIUS, box);
  for (const circle of circles) pushOutOfCircle(pos, circle);
}
