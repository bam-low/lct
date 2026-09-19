export function Stat({ label, value }) {
  return (
    <div className="bg-white/60 rounded-xl p-2.5">
      <div className="text-xs text-[#6b5f7a] font-semibold">{label}</div>
      <div className="text-lg text-[#3F4159] font-bold">{value}</div>
    </div>
  );
}

export function RobotCountPanel({ title, count, prod, prodUnit, onManualChange, min, max }) {
  return (
    <div className="bg-white/40 rounded-xl p-3 space-y-2">
      <div className="text-sm font-bold text-[#3F4159]">{title}</div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => onManualChange(Math.max(min, count - 1))}
          disabled={count <= min}
          className="w-7 h-7 rounded-full bg-white/80 hover:bg-white disabled:opacity-30 text-[#3F4159] font-bold shadow-sm"
        >
          −
        </button>
        <span className="font-mono w-6 text-center text-sm text-[#3F4159]">{count}</span>
        <button
          onClick={() => onManualChange(Math.min(max, count + 1))}
          disabled={count >= max}
          className="w-7 h-7 rounded-full bg-white/80 hover:bg-white disabled:opacity-30 text-[#3F4159] font-bold shadow-sm"
        >
          +
        </button>
      </div>

      <div className="text-xs text-[#6b5f7a]">
        Производительность одного робота: {prod.toFixed(0)} {prodUnit} (по выбранному решению в каталоге)
      </div>
    </div>
  );
}
