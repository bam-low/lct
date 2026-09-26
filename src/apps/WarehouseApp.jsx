import { useState } from "react";
import { useEconomicsState } from "../state/useEconomicsState.js";
import { getObjectType } from "../domain/objectTypes.js";
import { vacuumPeakDemand, armPeakDemand, loaderPeakDemand, buildSensitivityScenario } from "../domain/warehouseAdapter.js";
import { catalogFor } from "../domain/catalog.js";
import { checkBudget } from "../domain/applicability.js";
import { formatCurrencyRUB } from "../domain/economics.js";
import WarehouseScene from "../simulation/WarehouseScene.jsx";
import ShapeEditor from "../components/warehouse/ShapeEditor.jsx";
import { isDefaultShape, computeGateClusters } from "../simulation/shape/shapeGeometry.js";
import RobotTypesSelect from "../components/economics/RobotTypesSelect.jsx";
import ParamsForm from "../components/economics/ParamsForm.jsx";
import ParamsFileImport from "../components/economics/ParamsFileImport.jsx";
import SolutionPicker from "../components/economics/SolutionPicker.jsx";
import ScenarioComparisonTable from "../components/economics/ScenarioComparisonTable.jsx";
import EconomicsDetail from "../components/economics/EconomicsDetail.jsx";
import SensitivityPanel from "../components/economics/SensitivityPanel.jsx";
import VerdictNote from "../components/economics/VerdictNote.jsx";

const SCENARIO_LABELS = { baseline: "без роботизации", purchase: "покупка", raas: "роботы как услуга" };

export default function WarehouseApp() {
  const eco = useEconomicsState();
  const objectType = getObjectType(eco.objectTypeId);
  const [screen, setScreen] = useState("setup"); // 'setup' | 'results'
  const [shapeEditorOpen, setShapeEditorOpen] = useState(false);

  const shapeIsDefault = isDefaultShape(eco.shape);
  const shapeGateCount = computeGateClusters(eco.shape).length;

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
    <>
      {screen === "setup" && (
        <>
          <RobotTypesSelect selected={eco.robotTypes} onSelect={eco.setRobotTypes} />

          {shapeEditorOpen ? (
            <ShapeEditor
              shape={eco.shape}
              floorAreaM2={eco.params.floorAreaM2}
              onSave={eco.setShape}
              onClose={() => setShapeEditorOpen(false)}
            />
          ) : (
            <div className="bg-white/40 rounded-xl p-4 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm text-[#3F4159]">
                <span className="font-bold">Форма склада:</span>{" "}
                {shapeIsDefault ? "стандартный прямоугольник" : "своя"} · {shapeGateCount} ворот
              </div>
              <button
                onClick={() => setShapeEditorOpen(true)}
                className="text-sm px-4 py-2 rounded-full bg-white/70 hover:bg-white text-[#3F4159] font-semibold transition"
              >
                🏗️ Своя форма склада
              </button>
            </div>
          )}

          {!shapeIsDefault && useLoader && loaderSolution?.identification.type !== "storagecube" && (
            <p className="text-xs text-[#3F4159] bg-white/40 rounded-xl px-4 py-3">
              На своей форме склада погрузчики ездят по упрощённому маршруту — ворота ↔ ближайший стеллаж по прямой,
              без системы проездов и полос хранения, как на стандартном прямоугольнике.
            </p>
          )}

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
            shape={eco.shape}
            robotTypes={eco.robotTypes}
            floorAreaM2={params.floorAreaM2}
            floorsCount={eco.floors}
            workZoneShare={eco.workZoneShare}
            scenarioLabel={SCENARIO_LABELS[eco.activeScenario]}
            demand={demand}
            vacuumCount={eco.counts.vacuumCount}
            vacuumProd={eco.throughputs.vacuum}
            vacuumType={vacuumSolution?.identification.type}
            armCount={eco.counts.armCount}
            armProd={eco.throughputs.arm / 60}
            armType={armSolution?.identification.type}
            loaderCount={eco.counts.loaderCount}
            loaderType={loaderSolution?.identification.type}
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
            oversizedCargoPct={params.oversizedCargoPct}
            slotsPerLane={eco.slotsPerLane}
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

          {[
            { check: eco.powerCheck, label: "Мощность электроснабжения", need: "Расчётная пиковая мощность парка" },
            { check: eco.conveyorCheck, label: "Конвейерная система", need: "Требуется по каталогу решений" },
          ].map(
            ({ check, label, need }) =>
              check && (
                <p
                  key={label}
                  className={`text-sm rounded-xl px-4 py-3 ${check.sufficient ? "bg-white/40 text-[#3F4159]" : "bg-[#f6d9d9] text-[#9C3B3B] font-semibold"}`}
                >
                  {label}: доступно {check.availableValue.toLocaleString("ru-RU")} {check.unit}. {need}: {Math.round(check.requiredValue).toLocaleString("ru-RU")} {check.unit}
                  {check.sufficient ? " — укладывается." : ` — не хватает ${Math.round(check.overBy).toLocaleString("ru-RU")} ${check.unit}.`}
                </p>
              )
          )}

          {eco.currentProcess.demand > 0 && (
            <p className="text-sm text-[#3F4159] bg-white/40 rounded-xl px-4 py-3">
              <span className="font-bold">Текущий процесс:</span> {params.pickerCount} отборщиков + {params.forkliftOperatorCount} операторов погрузчиков (с поправкой на смены и потери рабочего времени) ×{" "}
              {params.manualProductivity} оп/чел·ч = {Math.round(eco.currentProcess.capacity).toLocaleString("ru-RU")} оп/ч при потребности{" "}
              {Math.round(eco.currentProcess.demand).toLocaleString("ru-RU")} оп/ч — персонал закрывает{" "}
              {Math.round(eco.currentProcess.coveragePct)}% потребности.
            </p>
          )}

          {eco.activeScenario !== "baseline" && <VerdictNote paybackYears={activeScenario.paybackYears} />}

          <EconomicsDetail
            scenario={activeScenario}
            composition={[
              ["Пылесосы", eco.totalCounts.vacuumCount],
              ["Роборуки", eco.totalCounts.armCount],
              ["Погрузчики", eco.totalCounts.loaderCount],
            ]}
            floors={eco.floors}
          />

          <SensitivityPanel
            buildSensitivity={(factors) =>
              buildSensitivityScenario({
                params,
                vacuumZoneAreaM2: eco.vacuumZoneAreaM2,
                vacuumSolution: eco.activeSolutions.vacuum,
                armSolution: eco.activeSolutions.arm,
                loaderSolution: eco.activeSolutions.loader,
                ...factors,
              })
            }
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
