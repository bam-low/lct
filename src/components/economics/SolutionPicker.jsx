import { formatCurrencyRUB } from "../../domain/economics.js";
import { checkSolutionApplicability } from "../../domain/applicability.js";

// Подбор решения из каталога (ТЗ 3.4): для каждого варианта показывает
// ограничения из карточки решения (applicability.limitations) и, если можно
// однозначно проверить численно (сейчас — грузоподъёмность погрузчика),
// явное предупреждение о несоответствии объекту. Решение всё равно можно
// выбрать — предупреждение не блокирует (ТЗ 3.4.4).
export default function SolutionPicker({ title, options, selectedId, onChange, params }) {
  return (
    <div className="bg-white/40 rounded-xl p-4 space-y-2">
      <div className="text-sm font-bold text-[#3F4159]">{title}</div>

      <div className="grid grid-cols-1 gap-2">
        {options.map((item) => {
          const isSelected = item.id === selectedId;
          const { applicable, reasons } = params ? checkSolutionApplicability(item, params) : { applicable: true, reasons: [] };
          const limitations = item.applicability.limitations;

          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`text-left rounded-lg px-3 py-2 text-sm transition ${
                isSelected ? "bg-[#3F4159] text-white" : "bg-white/70 hover:bg-white text-[#3F4159]"
              }`}
            >
              <div className="font-bold flex items-center gap-1.5">
                {item.identification.name}
                {!applicable && <span title={reasons.join(" ")}>⚠️</span>}
              </div>

              <div className={isSelected ? "text-white/80" : "text-[#6b5f7a]"}>
                {item.identification.vendor} · {item.technical.throughput} {item.technical.throughputUnit}
                {" · "}
                {formatCurrencyRUB(item.economics.equipmentCost)}
              </div>

              {limitations.length > 0 && (
                <div className={`text-xs mt-0.5 ${isSelected ? "text-white/70" : "text-[#6b5f7a]"}`}>
                  Ограничения: {limitations.join("; ")}
                </div>
              )}

              {!applicable && (
                <div className={`text-xs mt-0.5 font-semibold ${isSelected ? "text-white" : "text-[#9C3B3B]"}`}>
                  {reasons.join(" ")}
                </div>
              )}
            </button>
          );
        })}

        {options.length === 0 && (
          <div className="text-xs text-[#6b5f7a]">Нет решений для этого процесса в каталоге.</div>
        )}
      </div>
    </div>
  );
}
