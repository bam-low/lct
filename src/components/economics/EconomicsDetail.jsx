import { formatCurrencyRUB } from "../../domain/economics.js";

const FORMULAS = [
  ["Количество роботов", "пиковая потребность / (производительность × загрузка × доступность)"],
  ["CAPEX", "оборудование + ПО + внедрение + резерв (5%)"],
  ["OPEX", "сервис/аренда + ремонт и обслуживание"],
  ["Годовой эффект", "экономия труда + прочая экономия − доп. OPEX"],
  ["Срок окупаемости", "CAPEX / годовой эффект"],
  ["ROI", "накопленный эффект за горизонт / CAPEX × 100%"],
  ["TCO", "CAPEX + Σ OPEX за горизонт (с заменой оборудования по сроку службы)"],
];

export default function EconomicsDetail({ scenario, counts }) {
  return (
    <details className="bg-white/40 rounded-xl p-4 text-sm text-[#3F4159]">
      <summary className="font-bold cursor-pointer">Как посчитано и какие допущения приняты</summary>

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

        <div>
          <div className="font-semibold mb-1">Состав парка в этом сценарии</div>
          <div className="text-[#6b5f7a]">
            Пылесосы: {counts.vacuumCount} шт · Роборуки: {counts.armCount} шт
          </div>
        </div>

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
          <div className="text-[#6b5f7a]">{scenario.assumptions.laborSavingsAssumption}</div>
        </div>
      </div>
    </details>
  );
}
