import { formatCurrencyRUB } from "../../domain/economics.js";

const FORMULAS = [
  ["Количество роботов", "(пиковая потребность / (производительность × загрузка × доступность)) × коэффициент резерва"],
  ["CAPEX", "оборудование + инфраструктура + ПО + интеграция + пусконаладка + обучение + резерв (5%)"],
  ["OPEX", "сервис/аренда + ремонт и обслуживание + электроэнергия"],
  ["Годовой эффект", "экономия труда + прочая экономия − доп. OPEX"],
  ["Срок окупаемости", "CAPEX / годовой эффект"],
  ["ROI", "накопленный эффект за горизонт / CAPEX × 100%"],
  ["TCO", "CAPEX + Σ OPEX за горизонт (с заменой оборудования по сроку службы) − остаточная стоимость на конец горизонта"],
];

// composition — [[label, count], ...] произвольный состав парка объекта (у
// склада — пылесосы/роборуки/погрузчики, у аэропорта — багаж/рамп/уборка);
// компонент не завязан на конкретный тип объекта (ТЗ 4.2.6).
export default function EconomicsDetail({ scenario, composition = [], floors = 1 }) {
  return (
    <details className="bg-white/40 rounded-xl p-4 text-sm text-[#3F4159]">
      <summary className="font-bold cursor-pointer">Методология расчётов и допущения</summary>

      <div className="mt-3 space-y-3">
        <div>
          <div className="font-semibold mb-1">Формулы (ТЗ, табл. 3.5.2)</div>
          <ul className="space-y-0.5 text-[#6b5f7a]">
            {FORMULAS.map(([name, formula]) => (
              <li key={name}>
                <span className="text-[#3F4159] font-semibold">{name}:</span> {formula}
              </li>
            ))}
          </ul>
        </div>

        {composition.length > 0 && (
          <div>
            <div className="font-semibold mb-1">
              Состав парка в этом сценарии{floors > 1 ? ` (всё здание, ${floors} эт.)` : ""}
            </div>
            <div className="text-[#6b5f7a]">
              {composition
                .filter(([, count]) => count > 0)
                .map(([label, count]) => `${label}: ${count} шт`)
                .join(" · ")}
            </div>
          </div>
        )}

        {scenario.depreciationPerYear > 0 && (
          <div>
            <div className="font-semibold mb-1">Амортизация (справочно)</div>
            <div className="text-[#6b5f7a]">
              Линейная, {formatCurrencyRUB(scenario.depreciationPerYear)}/год при сроке службы{" "}
              {scenario.assumptions.lifespanYears?.toFixed(1)} лет — не вычитается из годового
              эффекта по умолчанию.
            </div>
          </div>
        )}

        <div>
          <div className="font-semibold mb-1">Допущения</div>
          <div className="text-[#6b5f7a] space-y-1">
            <p>{scenario.assumptions.laborSavingsAssumption}</p>
            {scenario.assumptions.payrollAssumption && <p>{scenario.assumptions.payrollAssumption}</p>}
            {scenario.assumptions.pickComplexityAssumption && <p>{scenario.assumptions.pickComplexityAssumption}</p>}
            {scenario.assumptions.staffModelAssumption && <p>{scenario.assumptions.staffModelAssumption}</p>}
            {scenario.assumptions.raasModelAssumption && <p>{scenario.assumptions.raasModelAssumption}</p>}
            {scenario.assumptions.capexReserveRatio !== undefined && (
              <p>
                Финансовый резерв CAPEX: {Math.round(scenario.assumptions.capexReserveRatio * 100)}% сверх суммы
                статей (на непредвиденные расходы внедрения).
              </p>
            )}
            {scenario.assumptions.fleetReserveFactor > 1 && (
              <p>
                Эксплуатационный резерв парка: ×{scenario.assumptions.fleetReserveFactor.toFixed(2)} к расчётному
                числу роботов (на пики нагрузки, поломки и обслуживание, ТЗ 3.5.2) — уже учтён в составе парка выше.
              </p>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}
