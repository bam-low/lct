import { useMemo, useState } from "react";
import Slider from "../ui/Slider.jsx";
import { buildSensitivityScenario } from "../../domain/warehouseAdapter.js";
import { formatCurrencyRUB } from "../../domain/economics.js";

export default function SensitivityPanel({ params, vacuumZoneAreaM2, vacuumSolution, armSolution }) {
  const [equipmentDelta, setEquipmentDelta] = useState(0);
  const [laborDelta, setLaborDelta] = useState(0);
  const [demandDelta, setDemandDelta] = useState(0);

  const result = useMemo(
    () =>
      buildSensitivityScenario({
        params,
        vacuumZoneAreaM2,
        vacuumSolution,
        armSolution,
        equipmentFactor: 1 + equipmentDelta / 100,
        laborFactor: 1 + laborDelta / 100,
        demandFactor: 1 + demandDelta / 100,
      }),
    [params, vacuumZoneAreaM2, vacuumSolution, armSolution, equipmentDelta, laborDelta, demandDelta]
  );

  return (
    <div className="bg-white/40 rounded-xl p-4 space-y-3">
      <div>
        <div className="text-sm font-bold text-[#3F4159]">
          What-if: чувствительность сценария «Покупка» (ТЗ 3.5.6)
        </div>
        <div className="text-xs text-[#6b5f7a] mt-0.5">
          Всегда считается от расчётного состава парка роботов, даже если в симуляции включена
          ручная корректировка количества.
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3">
        <Slider
          label="Стоимость оборудования/обслуживания"
          value={equipmentDelta}
          min={-50}
          max={50}
          step={5}
          onChange={setEquipmentDelta}
          fmt={(v) => `${v > 0 ? "+" : ""}${v}%`}
        />
        <Slider
          label="Стоимость труда"
          value={laborDelta}
          min={-50}
          max={50}
          step={5}
          onChange={setLaborDelta}
          fmt={(v) => `${v > 0 ? "+" : ""}${v}%`}
        />
        <Slider
          label="Требуемый объём операций"
          value={demandDelta}
          min={-50}
          max={50}
          step={5}
          onChange={setDemandDelta}
          fmt={(v) => `${v > 0 ? "+" : ""}${v}%`}
        />
      </div>

      <div className="flex flex-wrap gap-4 text-sm pt-1 border-t border-white/40">
        <div>
          <div className="text-[#6b5f7a]">Годовой эффект</div>
          <div className="font-bold text-[#3F4159]">{formatCurrencyRUB(result.effect)}</div>
        </div>
        <div>
          <div className="text-[#6b5f7a]">Срок окупаемости</div>
          <div className="font-bold text-[#3F4159]">
            {result.paybackYears === null ? "не окупается" : `${result.paybackYears.toFixed(1)} лет`}
          </div>
        </div>
        <div>
          <div className="text-[#6b5f7a]">ROI</div>
          <div className="font-bold text-[#3F4159]">
            {result.roiPct === null ? "—" : `${result.roiPct.toFixed(0)}%`}
          </div>
        </div>
      </div>
    </div>
  );
}
