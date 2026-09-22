import { useState } from "react";
import { useEconomicsState } from "./state/useEconomicsState.js";
import { getObjectType, selectOption } from "./domain/objectTypes.js";
import { vacuumPeakDemand, armPeakDemand, loaderPeakDemand } from "./domain/warehouseAdapter.js";
import { catalogFor } from "./domain/catalog.js";
import { checkBudget } from "./domain/applicability.js";
import { formatCurrencyRUB } from "./domain/economics.js";
import WarehouseScene from "./simulation/WarehouseScene.jsx";
import ObjectTypeSelect from "./components/economics/ObjectTypeSelect.jsx";
import RobotTypesSelect from "./components/economics/RobotTypesSelect.jsx";
import ParamsForm from "./components/economics/ParamsForm.jsx";
import ParamsFileImport from "./components/economics/ParamsFileImport.jsx";
import SolutionPicker from "./components/economics/SolutionPicker.jsx";
import ScenarioComparisonTable from "./components/economics/ScenarioComparisonTable.jsx";
import EconomicsDetail from "./components/economics/EconomicsDetail.jsx";
import SensitivityPanel from "./components/economics/SensitivityPanel.jsx";
import VerdictNote from "./components/economics/VerdictNote.jsx";

const SCENARIO_LABELS = { baseline: "без роботизации", purchase: "покупка", raas: "роботы как услуга" };

export default function App() {
  const eco = useEconomicsState();
  const objectType = getObjectType(eco.objectTypeId);
  const [screen, setScreen] = useState("setup"); // 'setup' | 'results'

  const { useVacuum, useArm, useLoader } = eco.layout;
  const { vacuum: vacuumSolution, arm: armSolution, loader: loaderSolution } = eco.selectedSolutions;

  const activeScenario = eco.scenarios[eco.activeScenario];
  const { params } = eco;

  // Потребность объекта в производительности (на этаж) — с ней симуляция сверяет расчёт.
  const demand = {
    vacuum: vacuumPeakDemand(params, eco.vacuumZoneAreaM2),
    arm: armPeakDemand(params) / eco.floors,
    loader: loaderPeakDemand(params) / eco.floors,
  };

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

            <RobotTypesSelect selected={eco.robotTypes} onSelect={eco.setRobotTypes} />

            <ParamsFileImport objectType={objectType} params={eco.params} onApply={eco.setParams} />

            <ParamsForm objectType={objectType} params={eco.params} onChange={eco.setParam} />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {useVacuum && (
                <SolutionPicker
                  title="🧹 Решение для уборки"
                  options={catalogFor(eco.objectTypeId, "floor_cleaning")}
                  selectedId={vacuumSolution?.id}
                  onChange={eco.setVacuumSolutionId}
                  params={params}
                />
              )}
              {useArm && (
                <SolutionPicker
                  title="🦾 Решение для сортировки"
                  options={catalogFor(eco.objectTypeId, "sorting")}
                  selectedId={armSolution?.id}
                  onChange={eco.setArmSolutionId}
                  params={params}
                />
              )}
              {useLoader && (
                <SolutionPicker
                  title="🚜 Решение для погрузки"
                  options={catalogFor(eco.objectTypeId, "loading")}
                  selectedId={loaderSolution?.id}
                  onChange={eco.setLoaderSolutionId}
                  params={params}
                />
              )}
            </div>

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

            <RobotTypesSelect selected={eco.robotTypes} onSelect={eco.setRobotTypes} />

            <WarehouseScene
              robotTypes={eco.robotTypes}
              floorAreaM2={params.floorAreaM2}
              floorsCount={eco.floors}
              workZoneShare={eco.workZoneShare}
              scenarioLabel={SCENARIO_LABELS[eco.activeScenario]}
              demand={demand}
              vacuumCount={eco.counts.vacuumCount}
              vacuumProd={eco.throughputs.vacuum}
              armCount={eco.counts.armCount}
              armProd={eco.throughputs.arm / 60}
              loaderCount={eco.counts.loaderCount}
              recommendedVacuumCount={eco.recommendedCounts.vacuumCount}
              recommendedArmCount={eco.recommendedCounts.armCount}
              recommendedLoaderCount={eco.recommendedCounts.loaderCount}
              loaderCapacityKg={loaderSolution?.technical.capacityKg ?? 100}
              loaderSpeedMps={(loaderSolution?.technical.speed ?? 2) * eco.speedFactor}
              loaderThroughput={eco.throughputs.loader}
              cargoWeightKg={params.cargoWeightKg}
              cargoLengthCm={params.cargoLengthCm}
              cargoWidthCm={params.cargoWidthCm}
              cargoHeightCm={params.cargoHeightCm}
              skuCount={params.skuCount}
              slotsPerLane={selectOption(eco.objectTypeId, "storageType", params.storageType)?.slotsPerLane}
              routeLengthM={params.routeLengthM}
              cargoPerHour={params.requiredLoadThroughput}
              outboundPerHour={params.requiredOutboundThroughput}
              truckPayload={params.truckPayloadUnits}
              energyProfiles={eco.energyProfiles}
              onManualVacuumCountChange={eco.setManualVacuumCount}
              onManualArmCountChange={eco.setManualArmCount}
              onManualLoaderCountChange={eco.setManualLoaderCount}
            />

            <ScenarioComparisonTable
              scenarios={eco.scenarios}
              activeScenario={eco.activeScenario}
              onSelectScenario={eco.setActiveScenario}
            />

            {(() => {
              const budget = eco.activeScenario !== "baseline" ? checkBudget(activeScenario.capex, params.budgetCapexMRub) : null;
              if (!budget) return null;

              return (
                <p className={`text-sm rounded-xl px-4 py-3 ${budget.withinBudget ? "bg-white/40 text-[#3F4159]" : "bg-[#f6d9d9] text-[#9C3B3B] font-semibold"}`}>
                  Бюджет на роботизацию: {params.budgetCapexMRub} млн ₽. Расчётный CAPEX сценария «{SCENARIO_LABELS[eco.activeScenario]}»:{" "}
                  {formatCurrencyRUB(activeScenario.capex)}
                  {budget.withinBudget ? " — укладывается." : ` — превышает бюджет на ${formatCurrencyRUB(budget.overBy)}.`}
                </p>
              );
            })()}

            {eco.currentProcess.demand > 0 && (
              <p className="text-sm text-[#3F4159] bg-white/40 rounded-xl px-4 py-3">
                <span className="font-bold">Текущий процесс:</span> {params.staffCount} чел × {params.manualProductivity}{" "}
                оп/чел·ч = {Math.round(eco.currentProcess.capacity).toLocaleString("ru-RU")} оп/ч при потребности{" "}
                {Math.round(eco.currentProcess.demand).toLocaleString("ru-RU")} оп/ч — персонал закрывает{" "}
                {Math.round(eco.currentProcess.coveragePct)}% потребности.
              </p>
            )}

            {eco.activeScenario !== "baseline" && (
              <VerdictNote paybackYears={activeScenario.paybackYears} />
            )}

            <EconomicsDetail scenario={activeScenario} counts={eco.totalCounts} floors={eco.floors} />

            <SensitivityPanel
              params={eco.params}
              vacuumZoneAreaM2={eco.vacuumZoneAreaM2}
              vacuumSolution={eco.activeSolutions.vacuum}
              armSolution={eco.activeSolutions.arm}
              loaderSolution={eco.activeSolutions.loader}
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
