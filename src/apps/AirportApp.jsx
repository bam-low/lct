import { useState } from "react";
import { useAirportEconomicsState } from "../state/useAirportEconomicsState.js";
import { getObjectType } from "../domain/objectTypes.js";
import { transportPeakDemand, buildSensitivityScenario } from "../domain/airportAdapter.js";
import { catalogFor } from "../domain/catalog.js";
import { checkBudget } from "../domain/applicability.js";
import { formatCurrencyRUB } from "../domain/economics.js";
import Slider from "../components/ui/Slider.jsx";
import ParamsForm from "../components/economics/ParamsForm.jsx";
import ParamsFileImport from "../components/economics/ParamsFileImport.jsx";
import SolutionPicker from "../components/economics/SolutionPicker.jsx";
import ScenarioComparisonTable from "../components/economics/ScenarioComparisonTable.jsx";
import EconomicsDetail from "../components/economics/EconomicsDetail.jsx";
import SensitivityPanel from "../components/economics/SensitivityPanel.jsx";
import VerdictNote from "../components/economics/VerdictNote.jsx";
import AirportScene from "../simulation/AirportScene.jsx";

const SCENARIO_LABELS = { baseline: "без роботизации", purchase: "покупка", raas: "роботы как услуга" };

// Временно единственный процесс аэропорта — транспортировка грузов (по
// прямому указанию: багаж/рамп/уборка убраны, остаётся только выбор
// транспортировщика — той же модели, что и у склада).
export default function AirportApp() {
  const eco = useAirportEconomicsState();
  const objectType = getObjectType(eco.objectTypeId);
  const [screen, setScreen] = useState("setup");

  const activeScenario = eco.scenarios[eco.activeScenario];
  const { params } = eco;
  const demand = { transport: transportPeakDemand(params) };

  const goTo = (next) => {
    setScreen(next);
    window.scrollTo(0, 0);
  };

  return (
    <>
      {screen === "setup" && (
        <>
          <ParamsFileImport objectType={objectType} params={eco.params} onApply={eco.setParams} />

          <ParamsForm objectType={objectType} params={eco.params} onChange={eco.setParam} />

          <div className="space-y-2 max-w-xl">
            <SolutionPicker
              title="🚚 Решение для транспортировки"
              options={catalogFor(eco.objectTypeId, "transport")}
              selectedId={eco.selectedSolutions.transport?.id}
              onChange={eco.setTransportSolutionId}
              params={params}
            />
            <div className="bg-white/40 rounded-xl px-4 py-3">
              <Slider
                label="Количество роботов"
                value={eco.counts.transportCount}
                min={0}
                max={30}
                step={1}
                onChange={eco.setManualTransportCount}
                fmt={(v) => `${Math.round(v)} шт`}
                hint={`По расчёту: ${eco.recommendedCounts.transportCount} шт`}
              />
            </div>
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

          <AirportScene
            gatesCount={params.gatesCount}
            transportCount={eco.counts.transportCount}
            transportThroughput={eco.throughputs.transport}
            groundOpsPerFlight={params.groundOpsPerFlight}
            demand={demand}
            scenarioLabel={SCENARIO_LABELS[eco.activeScenario]}
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

          {eco.powerCheck && (
            <p
              className={`text-sm rounded-xl px-4 py-3 ${eco.powerCheck.sufficient ? "bg-white/40 text-[#3F4159]" : "bg-[#f6d9d9] text-[#9C3B3B] font-semibold"}`}
            >
              Мощность зарядной инфраструктуры: доступно {eco.powerCheck.availableValue.toLocaleString("ru-RU")} кВт. Расчётная
              пиковая мощность парка: {Math.round(eco.powerCheck.requiredValue).toLocaleString("ru-RU")} кВт
              {eco.powerCheck.sufficient ? " — укладывается." : ` — не хватает ${Math.round(eco.powerCheck.overBy).toLocaleString("ru-RU")} кВт.`}
            </p>
          )}

          {eco.currentProcess.demand > 0 && (
            <p className="text-sm text-[#3F4159] bg-white/40 rounded-xl px-4 py-3">
              <span className="font-bold">Текущий процесс (рамп):</span> {params.rampStaffCount} чел (весь штат) с поправкой на смены и текучесть ×{" "}
              {params.rampOpsPerPersonHour} оп/чел·ч = {Math.round(eco.currentProcess.capacity).toLocaleString("ru-RU")} оп/ч при потребности{" "}
              {Math.round(eco.currentProcess.demand).toLocaleString("ru-RU")} оп/ч — персонал закрывает{" "}
              {Math.round(eco.currentProcess.coveragePct)}% потребности.
            </p>
          )}

          {eco.activeScenario !== "baseline" && <VerdictNote paybackYears={activeScenario.paybackYears} />}

          <EconomicsDetail scenario={activeScenario} composition={[["Транспортировщики", eco.counts.transportCount]]} />

          <SensitivityPanel
            buildSensitivity={(factors) => buildSensitivityScenario({ params, transportSolution: eco.selectedSolutions.transport, ...factors })}
          />

          <p className="text-xs text-[#6b5f7a] px-1">
            Результат — предварительная оценка на демо-каталоге и допущениях команды, требует
            верификации при обследовании объекта.
          </p>
        </>
      )}
    </>
  );
}
