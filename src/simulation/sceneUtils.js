import * as THREE from "three";
import { VACUUM_SWATH } from "./constants.js";

// Делит зону уборки zone {xMin, width, zMin, zMax} на count примерно квадратных
// участков — по одному на пылесос. (Не путать с чанками пола из chunkGrid.js:
// чанки — подписанная сетка пола, участок — то, что убирает один робот.)
export function computeSectors(count, zone) {
  const zoneLength = zone.zMax - zone.zMin;
  const cols = Math.max(1, Math.round(Math.sqrt((count * zone.width) / zoneLength)));
  const fullRows = Math.floor(count / cols);
  const remainder = count - fullRows * cols;
  const totalRows = fullRows + (remainder > 0 ? 1 : 0);
  const rowHeight = zoneLength / totalRows;

  const sectors = [];

  for (let row = 0; row < totalRows; row++) {
    const colsInRow = row < fullRows ? cols : remainder;
    if (colsInRow <= 0) continue;

    const colWidth = zone.width / colsInRow;

    for (let c = 0; c < colsInRow; c++) {
      sectors.push({
        xMin: zone.xMin + c * colWidth,
        xMax: zone.xMin + (c + 1) * colWidth,
        zMin: zone.zMin + row * rowHeight,
        zMax: zone.zMin + (row + 1) * rowHeight,
        row,
        col: c,
      });
    }
  }

  return sectors;
}

// Ряды прохода пылесоса внутри участка, с шагом VACUUM_SWATH.
export function buildRowCenters(sector) {
  const width = sector.xMax - sector.xMin;
  const numRows = Math.max(1, Math.ceil(width / VACUUM_SWATH));
  const centers = [];

  for (let i = 0; i < numRows; i++) {
    let rx = sector.xMin + VACUUM_SWATH * (i + 0.5);
    if (rx > sector.xMax - VACUUM_SWATH / 2) rx = sector.xMax - VACUUM_SWATH / 2;
    centers.push(rx);
  }

  return centers;
}

// Освобождает видеопамять, которую занимают геометрии и материалы объекта и всех
// его потомков. Текстуры не трогает (они общие), поэтому вызывать можно только для
// того, чем объект владеет сам: общие геометрии и материалы (шаблоны glb, ящики,
// корпус зарядки) освобождать нельзя.
export function disposeTree(root) {
  root.traverse((object) => {
    if (!object.isMesh) return;

    object.geometry.dispose();

    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      material.dispose();
    }
  });
}

export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// «Материализация» новоприбывшего объекта (самолёт, фура) — плавный переход
// от прозрачного к обычному виду вместо мгновенного появления. Материалы у
// glb-моделей общие на все клоны (см. glbModel.js), поэтому перед анимацией
// клонируем их для этого конкретного инстанса — иначе непрозрачность одной
// фуры откатывала бы прозрачность всех остальных клонов той же модели.
export function createMaterializeFade(object3D, durationS = 1.2) {
  const entries = [];

  object3D.traverse((obj) => {
    if (!obj.isMesh) return;

    const isArray = Array.isArray(obj.material);
    const originals = isArray ? obj.material : [obj.material];
    const clones = originals.map((material) => material.clone());
    obj.material = isArray ? clones : clones[0];

    for (let i = 0; i < clones.length; i++) {
      entries.push({
        material: clones[i],
        targetOpacity: originals[i].opacity,
        wasTransparent: originals[i].transparent,
        wasDepthWrite: originals[i].depthWrite,
      });
      clones[i].transparent = true;
      clones[i].depthWrite = false;
      clones[i].opacity = 0;
    }
  });

  let t = 0;
  let done = false;
  let direction = 1; // 1 — проявляется (0 → обычная непрозрачность), -1 — растворяется (обратно)

  return {
    // Возвращает true, пока анимация идёт; false — когда она закончилась
    // (при проявлении материалы возвращены к исходным transparent/depthWrite,
    // чтобы не платить за сортировку прозрачности зря) или уже была закончена
    // раньше — дешёвый no-op, можно звать каждый кадр не проверяя.
    update(dt) {
      if (done) return false;

      t += dt;
      const eased = easeInOut(Math.min(1, t / durationS));
      const p = direction === 1 ? eased : 1 - eased;

      for (const entry of entries) entry.material.opacity = entry.targetOpacity * p;

      if (t >= durationS) {
        if (direction === 1) {
          for (const entry of entries) {
            entry.material.transparent = entry.wasTransparent;
            entry.material.depthWrite = entry.wasDepthWrite;
          }
        }
        done = true;
        return false;
      }

      return true;
    },

    // Запускает обратное отыгрывание — растворение в дымке вместо мгновенного
    // исчезновения (жалоба: фуры резко пропадали, когда уезжали). Работает по
    // тем же клонированным материалам, что и проявление; можно звать в любой
    // момент, в том числе пока проявление ещё не закончилось.
    reverse(newDurationS = durationS) {
      direction = -1;
      durationS = newDurationS;
      t = 0;
      done = false;
      for (const entry of entries) {
        entry.material.transparent = true;
        entry.material.depthWrite = false;
      }
    },

    // Клонированные материалы (см. выше) не входят ни в один общий шаблон —
    // если объект не проходит через disposeTree при удалении (как самолёты
    // аэропорта), их нужно освободить явно, иначе течёт видеопамять при каждом
    // повторном спавне (как фуры склада, которые приезжают и уезжают многократно).
    disposeMaterials() {
      for (const entry of entries) entry.material.dispose();
    },
  };
}

// Скачивает текущий кадр сцены как PNG (ТЗ 3.7.4 — экспорт визуализации):
// рендерер рисует в canvas без preserveDrawingBuffer, поэтому берём буфер сразу
// после кадра, который уже отрисован (requestAnimationFrame уже прошёл к
// моменту клика), — просто ищем canvas внутри контейнера сцены и сохраняем его.
export function downloadCanvasSnapshot(mountRef, fileName) {
  const canvas = mountRef.current?.querySelector("canvas");
  if (!canvas) return;

  canvas.toBlob((blob) => {
    if (!blob) return;

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}

export function applyColorSpace(target, isRenderer) {
  if (isRenderer) {
    target.outputColorSpace = THREE.SRGBColorSpace;
  } else {
    target.colorSpace = THREE.SRGBColorSpace;
  }
}
