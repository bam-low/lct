import { useState } from "react";
import { useEconomicsState } from "./state/useEconomicsState.js";
import { getObjectType } from "./domain/objectTypes.js";
import { catalogFor } from "./domain/catalog.js";
import WarehouseScene from "./simulation/WarehouseScene.jsx";
import ObjectTypeSelect from "./components/economics/ObjectTypeSelect.jsx";
import ModeSelect from "./components/economics/ModeSelect.jsx";
import ParamsForm from "./components/economics/ParamsForm.jsx";
import SolutionPicker from "./components/economics/SolutionPicker.jsx";
import ScenarioComparisonTable from "./components/economics/ScenarioComparisonTable.jsx";
import EconomicsDetail from "./components/economics/EconomicsDetail.jsx";
import SensitivityPanel from "./components/economics/SensitivityPanel.jsx";
import VerdictNote from "./components/economics/VerdictNote.jsx";

export default function App() {
  const eco = useEconomicsState();
  const objectType = getObjectType(eco.objectTypeId);
  const [screen, setScreen] = useState("setup"); // 'setup' | 'results'

  const vacuumOptions = catalogFor(eco.objectTypeId, "floor_cleaning");
  const armOptions = catalogFor(eco.objectTypeId, "sorting");

  const activeScenario = eco.scenarios[eco.activeScenario];

  const goTo = (next) => {
    setScreen(next);
    window.scrollTo(0, 0);
  };

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background: "linear-gradient(160deg, #CBB8E8 0%, #E3B7C9 35%, #F3CDAE 65%, #FBE6C9 100%)",
      }}
    >
      <div
        className="max-w-6xl mx-auto p-4 sm:p-6 space-y-4"
        style={{ fontFamily: "'Baloo 2', ui-rounded, 'Segoe UI Rounded', sans-serif" }}
      >
        <header className="px-1">
          <h1 className="text-3xl sm:text-4xl font-bold text-[#3F4159]">
            Платформа подбора роботизированных решений
          </h1>
          <p className="text-sm text-[#6b5f7a] mt-1">
            Экспресс-предынвестиционная оценка: параметры объекта → подбор решения → экономика →
            проверка симуляцией
          </p>
        </header>

        {screen === "setup" && (
          <>
            <ObjectTypeSelect selected={eco.objectTypeId} />

            <ParamsForm objectType={objectType} params={eco.params} onChange={eco.setParam} />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <SolutionPicker
                title="🧹 Решение для уборки"
                options={vacuumOptions}
                selectedId={eco.vacuumSolution?.id}
                onChange={eco.setVacuumSolutionId}
              />
              <SolutionPicker
                title="🦾 Решение для сортировки"
                options={armOptions}
                selectedId={eco.armSolution?.id}
                onChange={eco.setArmSolutionId}
              />
            </div>

            <ModeSelect mode={eco.mode} onChange={eco.setMode} />

            <div className="flex justify-end px-1 pt-2">
              <button
                onClick={() => goTo("results")}
                className="text-base px-6 py-3 rounded-full bg-[#3F4159] hover:brightness-110 text-white font-bold shadow-sm transition"
              >
                Перейти к расчётам →
              </button>
            </div>
          </>
        )}

        {screen === "results" && (
          <>
            <button
              onClick={() => goTo("setup")}
              className="text-sm px-4 py-2 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-bold shadow-sm transition"
            >
              ← Назад к настройкам
            </button>

            <WarehouseScene
              mode={eco.mode}
              vacuumCount={eco.scenarios.counts.vacuumCount}
              vacuumProd={eco.vacuumSolution?.technical.throughput ?? 0}
              armCount={eco.scenarios.counts.armCount}
              armProd={(eco.armSolution?.technical.throughput ?? 0) / 60}
              onManualVacuumCountChange={eco.setManualVacuumCount}
              onManualArmCountChange={eco.setManualArmCount}
            />

            <ScenarioComparisonTable
              scenarios={eco.scenarios}
              activeScenario={eco.activeScenario}
              onSelectScenario={eco.setActiveScenario}
            />

            {eco.activeScenario !== "baseline" && (
              <VerdictNote paybackYears={activeScenario.paybackYears} />
            )}

            <EconomicsDetail scenario={activeScenario} counts={eco.scenarios.counts} />

            <SensitivityPanel
              params={eco.params}
              vacuumZoneAreaM2={eco.zones.vacuumZoneAreaM2}
              vacuumSolution={eco.vacuumSolution}
              armSolution={eco.armSolution}
            />

            <p className="text-xs text-[#6b5f7a] px-1">
              Результат — предварительная оценка на демо-каталоге и допущениях команды, требует
              верификации при обследовании объекта.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
