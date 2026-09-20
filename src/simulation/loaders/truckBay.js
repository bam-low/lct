import * as THREE from "three";
import { FLOOR, WALL_THICKNESS } from "../layout.js";
import { makeTruck } from "../robots/truckRobot.js";

// Проём ворот с фурой: фура подъезжает задом, открывает двери, стоит, пока идёт
// перегрузка (её ведёт loaderSystem), закрывает двери и уезжает.
//
//   arriving → opening → docked → closing → leaving → (фуры нет)
//
// Задняя стенка стоит у наружной грани северной стены; груз проходит через
// открытые двери и ворота прямо на площадку внутри склада.
export const REAR_Z = -FLOOR / 2 - WALL_THICKNESS;

const APPROACH_DISTANCE = 60; // с какого расстояния от ворот фура начинает движение
const DEPART_DISTANCE = 62; // на каком расстоянии от ворот фура исчезает
const LATERAL_SPAN = 42; // на протяжении скольких единиц фура «выруливает» на ось ворот
const LATERAL_OFFSET = 4; // насколько в стороне от оси она начинает
const DOOR_SECONDS = 1.4;
const CREEP_ZONE = 14; // у ворот фура сбрасывает скорость
const DEPART_RAMP = 10;

const smooth = (u) => {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
};

export function createTruckBay({ group, gateX, gateIndex, speed }) {
  const side = gateIndex % 2 === 0 ? 1 : -1; // с какой стороны фура выруливает на ворота
  let truck = null;

  function offsetAt(z) {
    return side * LATERAL_OFFSET * smooth((REAR_Z - z) / LATERAL_SPAN);
  }

  // moving: +1 — едет к югу (к воротам), -1 — к северу. Курс кабины идёт по
  // направлению движения; задом (reversing) кабина смотрит против движения.
  function place(z, moving, reversing) {
    const slope = (offsetAt(z + 0.5) - offsetAt(z)) / 0.5;
    const sign = reversing ? -1 : 1;

    truck.model.group.position.set(gateX + offsetAt(z), 0, z);
    truck.model.group.rotation.y = Math.atan2(sign * slope * moving, sign * moving);
    truck.z = z;
  }

  function begin(kind) {
    const model = makeTruck();
    group.add(model.group);

    truck = { model, kind, state: "arriving", z: REAR_Z - APPROACH_DISTANCE, timer: 0, leaveSpeed: 0 };
    model.setDoors(0);
    place(truck.z, 1, true);
  }

  function update(dt) {
    if (!truck) return;

    switch (truck.state) {
      case "arriving": {
        const remaining = REAR_Z - truck.z;
        const v = speed * Math.min(1, Math.max(0.2, remaining / CREEP_ZONE));

        place(Math.min(REAR_Z, truck.z + v * dt), 1, true);

        if (REAR_Z - truck.z < 0.03) {
          place(REAR_Z, 1, true);
          truck.state = "opening";
          truck.timer = 0;
        }
        break;
      }

      case "opening":
        truck.timer += dt;
        truck.model.setDoors(truck.timer / DOOR_SECONDS);

        if (truck.timer >= DOOR_SECONDS) truck.state = "docked";
        break;

      case "closing":
        truck.timer += dt;
        truck.model.setDoors(1 - truck.timer / DOOR_SECONDS);

        if (truck.timer >= DOOR_SECONDS) {
          truck.state = "leaving";
          truck.leaveSpeed = 0;
        }
        break;

      case "leaving": {
        const travelled = REAR_Z - truck.z;
        truck.leaveSpeed = speed * Math.min(1, 0.2 + travelled / DEPART_RAMP);

        place(truck.z - truck.leaveSpeed * dt, -1, false);

        if (REAR_Z - truck.z > DEPART_DISTANCE) {
          group.remove(truck.model.group);
          truck = null;
        }
        break;
      }

      default:
        break;
    }
  }

  return {
    begin,
    update,

    // Фура закончила: закрывает двери и уезжает.
    depart() {
      if (truck?.state === "docked") {
        truck.state = "closing";
        truck.timer = 0;
      }
    },

    get busy() {
      return truck !== null;
    },
    get docked() {
      return truck?.state === "docked";
    },
    get kind() {
      return truck?.kind ?? null;
    },

    // Где в воротах груз выходит из кузова / входит в него (мировые координаты).
    doorway() {
      return new THREE.Vector3(gateX, truck ? truck.model.bedY : 0.8, REAR_Z - 0.4);
    },
  };
}
