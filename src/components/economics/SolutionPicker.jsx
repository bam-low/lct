import { formatCurrencyRUB } from "../../domain/economics.js";

export default function SolutionPicker({ title, options, selectedId, onChange }) {
  return (
    <div className="bg-white/40 rounded-xl p-4 space-y-2">
      <div className="text-sm font-bold text-[#3F4159]">{title}</div>

      <div className="grid grid-cols-1 gap-2">
        {options.map((item) => {
          const isSelected = item.id === selectedId;

          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`text-left rounded-lg px-3 py-2 text-sm transition ${
                isSelected ? "bg-[#3F4159] text-white" : "bg-white/70 hover:bg-white text-[#3F4159]"
              }`}
            >
              <div className="font-bold">{item.identification.name}</div>

              <div className={isSelected ? "text-white/80" : "text-[#6b5f7a]"}>
                {item.identification.vendor} · {item.technical.throughput} {item.technical.throughputUnit}
                {" · "}
                {formatCurrencyRUB(item.economics.equipmentCost)}
              </div>
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
