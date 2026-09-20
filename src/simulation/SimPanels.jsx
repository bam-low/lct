export function Stat({ label, value }) {
  return (
    <div className="bg-white/60 rounded-xl p-2.5">
      <div className="text-xs text-[#6b5f7a] font-semibold">{label}</div>
      <div className="text-lg text-[#3F4159] font-bold">{value}</div>
    </div>
  );
}

export function RobotCountPanel({ title, count, description, onManualChange, min, max }) {
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

      <div className="text-xs text-[#6b5f7a]">{description}</div>
    </div>
  );
}

// Легенда карты: типовые зоны, маршруты, роботы, точки операций и зарядки (ТЗ 3.6.1).
export function MapLegend({ items }) {
  return (
    <div className="bg-white/40 rounded-xl p-3">
      <div className="text-sm font-bold text-[#3F4159] mb-2">Условные обозначения</div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        {items.map(({ color, kind, label, dashed }) => (
          <div key={label} className="flex items-center gap-2 text-xs text-[#3F4159]">
            <span
              className="inline-block shrink-0"
              style={{
                width: 22,
                height: kind === "line" ? 0 : 14,
                borderRadius: kind === "dot" ? 999 : 3,
                background: kind === "line" ? "transparent" : color,
                borderTop: kind === "line" ? `3px ${dashed ? "dashed" : "solid"} ${color}` : "none",
                border: kind === "zone" && dashed ? `2px dashed ${color}` : undefined,
              }}
            />
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const formatMetric = (value) => (value === null ? "—" : Math.round(value).toLocaleString("ru-RU"));

// Отклонение симуляции от расчёта, %: «+4%» / «−12%»; null, пока данных мало.
function deviationLabel(simulated, calculated) {
  if (simulated === null || !calculated) return "—";

  const pct = Math.round(((simulated - calculated) / calculated) * 100);
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

// Подтверждение расчёта симуляцией (ТЗ 3.6.2): для каждого типа роботов —
// потребность объекта, расчётная мощность парка (по выбранному решению) и то,
// что реально показала симуляция.
export function VerificationPanel({ rows }) {
  return (
    <div className="bg-white/40 rounded-xl p-3">
      <div className="text-sm font-bold text-[#3F4159]">Подтверждение расчёта симуляцией</div>
      <div className="text-xs text-[#6b5f7a] mb-2">
        Расчётная мощность считается по параметрам выбранного решения и объекта; «в симуляции» — то, что
        роботы реально успели сделать за время модели.
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-[#3F4159]">
          <thead>
            <tr className="text-left text-[#6b5f7a]">
              <th className="font-semibold py-1 pr-3">Показатель</th>
              <th className="font-semibold py-1 pr-3">Нужно</th>
              <th className="font-semibold py-1 pr-3">Расчёт парка</th>
              <th className="font-semibold py-1 pr-3">В симуляции</th>
              <th className="font-semibold py-1">Отклонение</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-white/50">
                <td className="py-1 pr-3 font-semibold">
                  {row.label}, {row.unit}
                </td>
                <td className="py-1 pr-3">{formatMetric(row.required)}</td>
                <td className="py-1 pr-3">{formatMetric(row.calculated)}</td>
                <td className="py-1 pr-3 font-bold">{formatMetric(row.simulated)}</td>
                <td className="py-1">{deviationLabel(row.simulated, row.calculated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.map((row) => row.note && (
        <div key={row.label} className="text-xs text-[#6b5f7a] mt-1.5">
          {row.note}
        </div>
      ))}
    </div>
  );
}
