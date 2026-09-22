// Элементы управления над сценой и под ней: вид камеры, этажи, пуск/пауза/сброс, скорость.

const SPEED_OPTIONS = [1, 2, 4, 8, 18, 32, 64, 128];

const ROUND_BUTTON = "w-8 h-8 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition";
const pill = (on) =>
  on ? "bg-[#3F4159] text-white" : "bg-white/70 hover:bg-white text-[#3F4159]";

// 3D / 2D-план, зум и поворот камеры.
export function ViewToolbar({ topView, onToggleTopView, onZoom, onRotate }) {
  return (
    <div className="flex gap-1.5 items-center">
      <button
        onClick={onToggleTopView}
        aria-pressed={topView}
        title="Переключить вид: 3D-изометрия или 2D-план сверху"
        className={`h-8 px-3 rounded-full font-bold text-sm shadow-sm transition ${pill(topView)}`}
      >
        {topView ? "2D план" : "3D"}
      </button>
      <button onClick={() => onZoom(6)} className={ROUND_BUTTON}>−</button>
      <button onClick={() => onZoom(-6)} className={ROUND_BUTTON}>+</button>
      <button onClick={() => onRotate(-1)} className={ROUND_BUTTON}>↺</button>
      <button onClick={() => onRotate(1)} className={ROUND_BUTTON}>↻</button>
    </div>
  );
}

// Переключатель этажей (нужен только в зданиях с несколькими этажами).
export function FloorSwitcher({ count, active, onSelect }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-3 px-1">
      <span className="text-sm font-semibold text-[#3F4159] mr-1">Этаж:</span>

      {Array.from({ length: count }, (_, index) => (
        <button
          key={index}
          onClick={() => onSelect(index)}
          aria-pressed={index === active}
          className={`text-sm px-3 py-1 rounded-full font-bold transition ${pill(index === active)}`}
        >
          {index + 1}
        </button>
      ))}

      <span className="text-xs text-[#6b5f7a] ml-1">остальные этажи показаны прозрачными</span>
    </div>
  );
}

// Пуск/пауза, сброс и скорость воспроизведения (ТЗ 3.6.3).
export function PlaybackControls({ running, onToggleRunning, onReset, speed, onSpeed }) {
  return (
    <div className="flex flex-wrap gap-2 mt-4 px-1 items-center">
      <button
        onClick={onToggleRunning}
        className="text-sm px-4 py-2 rounded-full bg-[#E8B15A] hover:brightness-105 text-[#3F4159] font-bold shadow-sm transition"
      >
        {running ? "⏸ Пауза" : "▶ Дальше"}
      </button>

      <button
        onClick={onReset}
        className="text-sm px-4 py-2 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition"
      >
        ↺ Сброс
      </button>

      <div className="flex gap-1 ml-1 flex-wrap">
        {SPEED_OPTIONS.map((multiplier) => (
          <button
            key={multiplier}
            onClick={() => onSpeed(multiplier)}
            className={`text-xs px-3 py-2 rounded-full font-bold transition ${pill(speed === multiplier)}`}
          >
            {multiplier}×
          </button>
        ))}
      </div>
    </div>
  );
}
