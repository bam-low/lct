import * as THREE from "three";
import { LANE_MIN_X } from "../layout.js";
import { PALETTE } from "../constants.js";

// Зарядные станции пылесосов — в юго-западном углу склада (левый угол при
// стартовом положении камеры), вдоль южной стены. Полоса z > Z_MAX занята
// станциями и не входит в зону уборки (см. layout.js).
export const STATION_Z = 46.8; // центр припаркованного пылесоса
const STATION_PITCH = 4.6;
const CHARGER_Z = 49.35;

export const STATION_PAD_WIDTH = 4;
export const STATION_PAD_DEPTH = 5.6;

// Пылесос заезжает на станцию носом к стене, где стоит зарядное устройство.
export const STATION_HEADING = 0;

export function chargingStationPositions(count) {
  return Array.from({ length: count }, (_, i) => ({
    x: LANE_MIN_X + 2 + i * STATION_PITCH,
    z: STATION_Z,
  }));
}

const LED_COLORS = {
  charging: 0xe5a13f, // идёт зарядка
  full: 0x4f9b90, // заряжен
  off: 0x555870, // робот в работе
};

const bodyGeometry = new THREE.BoxGeometry(1.8, 0.9, 0.8);
const ledGeometry = new THREE.BoxGeometry(0.5, 0.18, 0.05);
const bodyMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.storage, flatShading: true, roughness: 0.7 });

// Зарядное устройство с индикатором: цвет светодиода показывает, что делает
// робот на станции.
export function createCharger(x) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.45;
  body.castShadow = true;

  const ledMaterial = new THREE.MeshBasicMaterial({ color: LED_COLORS.off, toneMapped: false });
  const led = new THREE.Mesh(ledGeometry, ledMaterial);
  led.position.set(0, 0.62, -0.42);

  group.add(body, led);
  group.position.set(x, 0, CHARGER_Z);

  let current = null;

  return {
    group,
    setLed(kind) {
      if (kind === current) return;
      current = kind;
      ledMaterial.color.setHex(LED_COLORS[kind]);
    },
  };
}
