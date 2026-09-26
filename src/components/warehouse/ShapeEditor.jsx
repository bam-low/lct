import { useEffect, useMemo, useRef, useState } from "react";
import { CELL, GRID_SIZE, buildDefaultShape, cellAt, cloneShape, setCellAt } from "../../simulation/shape/shapeTypes.js";
import { boundingBoxOf, computeGateClusters } from "../../simulation/shape/shapeGeometry.js";

const PX_PER_CELL = 20;
const CANVAS_PX = GRID_SIZE * PX_PER_CELL;

const CELL_COLOR = {
  [CELL.EMPTY]: "#EDEDF2",
  [CELL.FLOOR]: "#464549",
  [CELL.GATE]: "#E5A13F",
  [CELL.RACK]: "#C85E70",
};

const TOOLS = [
  { id: "floor", label: "🧱 Пол", cell: CELL.FLOOR },
  { id: "loading", label: "🚚 Зона загрузки", cell: CELL.GATE },
  { id: "unloading", label: "📤 Зона выгрузки", cell: CELL.GATE },
  { id: "rack", label: "📦 Стеллаж", cell: CELL.RACK },
  { id: "erase", label: "⬜ Ластик", cell: CELL.EMPTY },
];

// Ворота считаются настоящими, только если клетка GATE касается края
// нарисованной формы (computeGateClusters — как и в остальном приложении);
// клетка GATE где-то в глубине пола молча ничего не делает. В редакторе такие
// клетки нужно явно показать, иначе пользователь не поймёт, почему поставленная
// им «зона выгрузки» никак не проявляется в 3D-сцене.
function invalidGateCellsOf(shape) {
  const clustered = new Set();
  for (const cluster of computeGateClusters(shape)) {
    for (const cell of cluster.cells) clustered.add(`${cell.gx},${cell.gz}`);
  }

  const invalid = new Set();
  for (let gz = 0; gz < shape.gridSize; gz++) {
    for (let gx = 0; gx < shape.gridSize; gx++) {
      if (cellAt(shape, gx, gz) === CELL.GATE && !clustered.has(`${gx},${gz}`)) invalid.add(`${gx},${gz}`);
    }
  }

  return invalid;
}

function drawGrid(ctx, shape) {
  ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX);
  const invalidGates = invalidGateCellsOf(shape);

  for (let gz = 0; gz < shape.gridSize; gz++) {
    for (let gx = 0; gx < shape.gridSize; gx++) {
      const isInvalidGate = invalidGates.has(`${gx},${gz}`);
      ctx.fillStyle = isInvalidGate ? "#5c3030" : CELL_COLOR[cellAt(shape, gx, gz)];
      ctx.fillRect(gx * PX_PER_CELL, gz * PX_PER_CELL, PX_PER_CELL, PX_PER_CELL);

      if (isInvalidGate) {
        ctx.strokeStyle = "rgba(255,120,120,0.9)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(gx * PX_PER_CELL + 3, gz * PX_PER_CELL + 3);
        ctx.lineTo(gx * PX_PER_CELL + PX_PER_CELL - 3, gz * PX_PER_CELL + PX_PER_CELL - 3);
        ctx.moveTo(gx * PX_PER_CELL + PX_PER_CELL - 3, gz * PX_PER_CELL + 3);
        ctx.lineTo(gx * PX_PER_CELL + 3, gz * PX_PER_CELL + PX_PER_CELL - 3);
        ctx.stroke();
      }
    }
  }

  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= shape.gridSize; i++) {
    const p = i * PX_PER_CELL;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, CANVAS_PX);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(CANVAS_PX, p);
    ctx.stroke();
  }

  return invalidGates.size;
}

// Конструктор формы склада: рисуем контур как пиксель-арт по сетке чанков и
// расставляем зону загрузки/выгрузки (обе красят одну и ту же клетку GATE —
// разделение чисто визуальное, для удобства разметки, см. план) и стеллажи.
// Не модальное окно — тот же инлайн-панельный стиль, что RobotTypesSelect/ParamsForm.
export default function ShapeEditor({ shape, floorAreaM2, onSave, onClose }) {
  const [draft, setDraft] = useState(() => cloneShape(shape ?? buildDefaultShape()));
  const [tool, setTool] = useState("floor");
  const canvasRef = useRef(null);
  const paintingRef = useRef(false);

  const stats = useMemo(() => {
    let floorCells = 0;
    let rackCells = 0;
    for (let i = 0; i < draft.cells.length; i++) {
      if (draft.cells[i] === CELL.FLOOR || draft.cells[i] === CELL.GATE) floorCells++;
      if (draft.cells[i] === CELL.RACK) rackCells++;
    }

    const totalCells = draft.gridSize * draft.gridSize;
    const areaM2 = floorAreaM2 ? Math.round((floorAreaM2 * floorCells) / totalCells) : null;
    const gates = computeGateClusters(draft);
    const invalidGateCount = invalidGateCellsOf(draft).size;

    return { floorCells, rackCells, areaM2, gateCount: gates.length, invalidGateCount };
  }, [draft, floorAreaM2]);

  const canSave = stats.floorCells > 0 && stats.gateCount > 0;

  const redraw = (next) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx) drawGrid(ctx, next);
  };

  useEffect(() => redraw(draft), []); // eslint-disable-line react-hooks/exhaustive-deps

  const paintAt = (clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const gx = Math.floor(((clientX - rect.left) / rect.width) * draft.gridSize);
    const gz = Math.floor(((clientY - rect.top) / rect.height) * draft.gridSize);
    if (gx < 0 || gz < 0 || gx >= draft.gridSize || gz >= draft.gridSize) return;

    const cellValue = TOOLS.find((t) => t.id === tool).cell;
    if (cellAt(draft, gx, gz) === cellValue) return;

    setCellAt(draft, gx, gz, cellValue);
    redraw(draft);
    setDraft((s) => ({ ...s })); // триггерим пересчёт stats (сам массив мутируется на месте)
  };

  const onPointerDown = (e) => {
    paintingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    paintAt(e.clientX, e.clientY);
  };

  const onPointerMove = (e) => {
    if (!paintingRef.current) return;
    paintAt(e.clientX, e.clientY);
  };

  const onPointerUp = () => {
    paintingRef.current = false;
  };

  const resetToDefault = () => {
    const next = buildDefaultShape();
    setDraft(next);
    redraw(next);
  };

  const handleSave = () => {
    const bbox = boundingBoxOf(draft);
    onSave({ ...cloneShape(draft), isDefault: false, bbox });
    onClose();
  };

  return (
    <div className="bg-white/40 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-bold text-[#3F4159]">🏗️ Конструктор формы склада</div>
        <button onClick={onClose} className="text-xs px-3 py-1 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-semibold transition">
          Закрыть
        </button>
      </div>

      <p className="text-xs text-[#6b5f7a]">
        Нарисуйте контур склада и расставьте зоны как пиксель-арт по сетке. Зона загрузки и зона выгрузки — просто
        две кисти для удобства разметки, ворота при этом двунаправленные, как и сегодня.
      </p>

      <div className="flex flex-wrap gap-1.5">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            className={`text-sm px-3 py-1.5 rounded-full font-semibold transition ${
              tool === t.id ? "bg-[#3F4159] text-white" : "bg-white/70 text-[#3F4159] hover:bg-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <canvas
        ref={canvasRef}
        width={CANVAS_PX}
        height={CANVAS_PX}
        className="rounded-lg touch-none w-full max-w-[500px] cursor-crosshair"
        style={{ aspectRatio: "1 / 1" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#3F4159]">
        <span>Площадь пола: {stats.areaM2 !== null ? `${stats.areaM2.toLocaleString("ru-RU")} м²` : "—"}</span>
        <span>Ворот: {stats.gateCount}</span>
        <span>Стеллажей: {stats.rackCells}</span>
      </div>

      {!canSave && (
        <p className="text-xs text-[#9C3B3B] font-semibold">
          Нужна хотя бы одна клетка пола и хотя бы одни ворота, касающиеся края формы.
        </p>
      )}

      {stats.invalidGateCount > 0 && (
        <p className="text-xs text-[#9C3B3B] font-semibold">
          {stats.invalidGateCount === 1 ? "Клетка ворот отмечена" : `${stats.invalidGateCount} клеток ворот отмечены`}{" "}
          красным крестом на плане: они не касаются края нарисованной формы, поэтому воротами не станут — перенесите
          их на границу контура (можно на любую сторону, не только север).
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-1">
        <button
          onClick={resetToDefault}
          className="text-sm px-4 py-2 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-semibold transition"
        >
          Сбросить к стандартной форме
        </button>
        <button onClick={onClose} className="text-sm px-4 py-2 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-semibold transition">
          Отмена
        </button>
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="text-sm px-5 py-2 rounded-full bg-[#3F4159] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold shadow-sm transition"
        >
          Сохранить
        </button>
      </div>
    </div>
  );
}
