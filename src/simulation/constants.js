import { FLOOR } from "./layout.js";

// Текстура пола/следа — общий канвас-пиксельный масштаб сцены.
export const CANVAS_PX = 512;
export const PX_PER_M = CANVAS_PX / FLOOR;
export const GRID = FLOOR;

// Высота 3D-вида в пикселях (общая для рендерера и контейнера в React).
export const SCENE_HEIGHT_PX = 600;

export const MODEL_SCALE = 1.7;

// Пылесос — загруженная glb-модель (~1 м шириной, ~1.4 м длиной, низ на y = 0).
// VACUUM_MODEL_SCALE — во сколько раз увеличиваем её в сцене.
export const VACUUM_MODEL_SCALE = 3.0;

// Пылесос всегда ориентирован вдоль оси Z, поэтому для объезда роборук важна
// половина его ширины (по X).
export const VACUUM_HALF_WIDTH = 0.5 * VACUUM_MODEL_SCALE;

// Ширина захвата = ширина корпуса: белая полоса совпадает с роботом, а соседние
// пылесосы у границ чанков не наезжают друг на друга.
export const VACUUM_SWATH = 2 * VACUUM_HALF_WIDTH;

// Цикл зарядки пылесоса: в пути на станцию и обратно он едет быстрее, чем
// убирает; возвращается, когда заряда остаётся на дорогу плюс этот запас;
// стартует с заряда VACUUM_START_SOC и сразу едет работать.
export const VACUUM_TRANSIT_FACTOR = 1.6;
export const VACUUM_RETURN_RESERVE = 0.04;
export const VACUUM_START_SOC = 0.95;

// Прозрачность белого следа (общая для всего слоя, задаётся на материале).
export const TRAIL_OPACITY = 0.7;

// Лёгкий зазор над полом, чтобы колёса не мерцали вместе с плоскостью следа.
export const VACUUM_FLOOR_OFFSET = 0.03;

// Роборуки
export const ARM_BELT_X = 2.0;
export const ARM_BELT_HALF_WIDTH = 1.45 / 2;
export const ARM_BELT_HALF_LENGTH = 6;
export const ARM_BELT_START_Z = -5.85;
export const ARM_BELT_END_Z = 5.85;
export const ARM_PICKUP_Z = 0;
export const ARM_LENGTH = 2.0;
export const BOX_GAP = 0.85;
export const ARM_LEFT_ANGLE = Math.PI;
export const ARM_RIGHT_ANGLE = 0;
export const ARM_PICKUP_Y = -0.92;
export const ARM_CARRY_Y = -0.15;

// Габариты препятствия «роборука» (основание + оба конвейера, с учётом
// MODEL_SCALE и небольшого запаса) — чтобы пылесосы визуально объезжали
// роборуки, а не проезжали сквозь их модельки.
export const ARM_OBSTACLE_HALF_X = (ARM_BELT_X + ARM_BELT_HALF_WIDTH) * MODEL_SCALE + 0.5;
export const ARM_OBSTACLE_HALF_Z = ARM_BELT_HALF_LENGTH * MODEL_SCALE + 0.5;

// Погрузчик — glb-модель (вилы — отдельный узел, смотрят в +Z модели).
export const FORKLIFT_MODEL_SCALE = 1.5;

// Скорость погрузчика берётся из каталога (м/с) и в сцене делится на metersPerUnit
// (см. chunkGrid.js): чем больше помещение, тем медленнее он едет.
export const FORKLIFT_TURN_RATE = 2.4; // рад/с, разворот на месте
export const FORK_LIFT_SPEED = 2.4; // ед. сцены/с
export const FORK_CARRY_LIFT = 0.6; // на сколько вилы приподняты при езде с грузом
export const FORK_CLEARANCE = 0.3; // запас по высоте, чтобы подцепить/поставить груз, не задев стопку

// Насколько груз замедляет погрузчик: при полной загрузке скорость падает на
// эту долю, при половинной — на половину от неё.
export const LOAD_SLOWDOWN = 0.5;

// Насыщенная пастельная палитра
export const PALETTE = {
  // floor/wall — из реальных материалов 3D-модели «Стены и пол» (walls_floor.glb),
  // цвета сконвертированы из линейного baseColorFactor в sRGB-hex.
  floor: "#464549",
  exterior: "#2B2A33", // снаружи нарисованного контура формы склада (конструктор)
  rack: "#C85E70", // клетки-стеллажи, нарисованные в конструкторе формы склада
  invalidGate: "#9C3B3B", // клетка ворот в конструкторе, не касающаяся края формы — не станет настоящими воротами
  pad: "#8B78C7",
  storage: "#37394F",
  crateA: "#E5A13F",
  crateB: "#C85E70",
  crateC: "#5D9E96",
  robotBody: "#FFF1DC",
  armAccents: ["#8B78C7", "#C85E70", "#4F9B90", "#E5A13F", "#8B78C7", "#C85E70"],
  belt: "#292B3D",
  beltStripe: "#D4B96F",
  wall: "#86909E",
  wallTrim: "#E5A13F",
  dockPad: "#E5A13F",
  cargoPallet: "#9A7B55",
  cargoCrate: "#D9A45B",
  cargoStrap: "#8B5E34",
};

export const ISO_ELEV = Math.atan(1 / Math.sqrt(2));

// Фура: масштаб модели, скорость и то, как груз тяжелит энергопотребление.
export const TRUCK_MODEL_SCALE = 1.0;
export const TRUCK_SPEED_MPS = 6; // м/с; в сцене делится на metersPerUnit, как и скорость погрузчика
export const LOAD_POWER_GAIN = 0.6; // при полной загрузке мощность на работе выше на эту долю
