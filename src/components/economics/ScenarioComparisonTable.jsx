import { formatCurrencyRUB } from "../../domain/economics.js";

const SCENARIO_LABELS = {
  baseline: "Без роботизации",
  purchase: "Покупка",
  raas: "Роботы как услуга",
};

const ROWS = [
  { key: "capex", label: "CAPEX", fmt: formatCurrencyRUB },
  { key: "opexPerYear", label: "OPEX / год", fmt: formatCurrencyRUB },
  { key: "effect", label: "Годовой эффект", fmt: formatCurrencyRUB },
  {
    key: "paybackYears",
    label: "Срок окупаемости",
    fmt: (v) => (v === null ? "не окупается" : `${v.toFixed(1)} лет`),
  },
  {
    key: "roiPct",
    label: "ROI",
    fmt: (v) => (v === null ? "—" : `${v.toFixed(0)}%`),
  },
  { key: "tcoValue", label: "TCO (горизонт)", fmt: formatCurrencyRUB },
];

export default function ScenarioComparisonTable({ scenarios, activeScenario, onSelectScenario }) {
  const kinds = ["baseline", "purchase", "raas"];

  return (
    <div className="bg-white/40 rounded-xl p-4 overflow-x-auto">
      <div className="text-sm font-bold text-[#3F4159] mb-3">Сравнение сценариев</div>

      <table className="w-full text-sm min-w-[420px]">
        <thead>
          <tr>
            <th className="text-left text-[#6b5f7a] font-semibold pb-2 pr-2">Показатель</th>
            {kinds.map((kind) => (
              <th key={kind} className="text-left pb-2 px-2">
                <button
                  onClick={() => onSelectScenario(kind)}
                  className={`px-2.5 py-1 rounded-full font-bold transition ${
                    activeScenario === kind
                      ? "bg-[#3F4159] text-white"
                      : "bg-white/70 hover:bg-white text-[#3F4159]"
                  }`}
                >
                  {SCENARIO_LABELS[kind]}
                </button>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {ROWS.map((row) => (
            <tr key={row.key} className="border-t border-white/40">
              <td className="py-1.5 pr-2 text-[#6b5f7a]">{row.label}</td>
              {kinds.map((kind) => (
                <td key={kind} className="py-1.5 px-2 font-semibold text-[#3F4159]">
                  {row.fmt(scenarios[kind][row.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
