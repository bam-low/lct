import { AISLE_ZS, ROAD_XS } from "./storageLayout.js";

// Маршруты по дорогам склада: вдоль горизонтальных проездов и вертикального
// проезда своих ворот, по осевым линиям. Разворачиваться погрузчик может только на
// оси проезда — там между ним и ячейками с грузом достаточно места, а у входа в
// полосу хранения он уже смотрит куда нужно.
//
// «Якорь» — место на оси горизонтального проезда: { ai — номер проезда, x }.
// Погрузчик всегда начинает и заканчивает маршрут на якоре (например, у входа в
// полосу хранения), а между ними едет по дорогам. Встречных погрузчиков на дорогах
// нет: в каждой зоне ворот ездит только свой погрузчик (loaderSystem.js).

// Вертикальный проезд (из roadXs), на котором путь между якорями короче.
function pickRoad(from, to, roadXs) {
  return roadXs.reduce((best, x) =>
    Math.abs(from.x - x) + Math.abs(x - to.x) < Math.abs(from.x - best) + Math.abs(best - to.x) ? x : best
  );
}

// Точки маршрута от якоря from до якоря to (без начальной точки). roadXs —
// вертикальные проезды, которыми можно ехать: погрузчик пользуется только
// проездами своих ворот.
export function routeBetween(from, to, roadXs = ROAD_XS) {
  const fromZ = AISLE_ZS[from.ai];
  const toZ = AISLE_ZS[to.ai];

  if (from.ai === to.ai) {
    return Math.abs(from.x - to.x) < 0.01 ? [] : [{ x: to.x, z: toZ }];
  }

  const roadX = pickRoad(from, to, roadXs);
  const points = [];

  if (Math.abs(from.x - roadX) > 0.01) points.push({ x: roadX, z: fromZ }); // выезд на вертикальный проезд
  points.push({ x: roadX, z: toZ }); // вдоль него до нужного проезда
  if (Math.abs(to.x - roadX) > 0.01) points.push({ x: to.x, z: toZ }); // и по проезду до якоря

  return points;
}

// Примерная длина маршрута — чтобы выбирать ближайшую работу.
export function routeLength(from, to, roadXs = ROAD_XS) {
  let x = from.x;
  let z = AISLE_ZS[from.ai];
  let total = 0;

  for (const p of routeBetween(from, to, roadXs)) {
    total += Math.abs(p.x - x) + Math.abs(p.z - z);
    x = p.x;
    z = p.z;
  }

  return total;
}
