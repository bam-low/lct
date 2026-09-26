// Состояние экономики аэропорта — зеркало useEconomicsState.js (склад), тот же
// контракт (params/scenarios/setParam/...), но через airportAdapter.js.
// Временно один процесс — «Транспортировка грузов» (см. objectTypes.js и
// airportAdapter.js), остальное убрано по прямому указанию.
import { useEffect, useMemo, useState } from "react";
import { defaultParamsFor } from "../domain/objectTypes.js";
import { catalogFor, getCatalogItem } from "../domain/catalog.js";
import { buildAllScenarios, computeRobotCounts, currentProcessOf, effectiveThroughput, fleetPeakPowerKw } from "../domain/airportAdapter.js";
import { checkCapacity } from "../domain/applicability.js";
import { loadProject, saveProject } from "./projectStore.js";

const OBJECT_TYPE_ID = "airport";
const STORAGE_KEY = "warehouse-sim/project/airport/v1";

function firstSolutionId() {
  return catalogFor(OBJECT_TYPE_ID, "transport")[0]?.id ?? null;
}

function initialState() {
  const saved = loadProject(STORAGE_KEY);
  const params = { ...defaultParamsFor(OBJECT_TYPE_ID), ...saved?.params };
  const transportSolutionId = saved?.transportSolutionId ?? firstSolutionId();

  const auto = computeRobotCounts({ params, transportSolution: getCatalogItem(transportSolutionId) });

  return {
    params,
    transportSolutionId,
    manualTransportCount: saved?.manualTransportCount ?? Math.max(1, auto.transportCount),
    activeScenario: saved?.activeScenario ?? "purchase",
  };
}

export function useAirportEconomicsState() {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    saveProject(state, STORAGE_KEY);
  }, [state]);

  const selectedSolutions = { transport: getCatalogItem(state.transportSolutionId) };
  const counts = { transportCount: Math.max(0, state.manualTransportCount) };

  const recommended = useMemo(
    () => computeRobotCounts({ params: state.params, transportSolution: selectedSolutions.transport }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.params, state.transportSolutionId]
  );

  const fleetGroups = [{ solution: selectedSolutions.transport, count: counts.transportCount }];
  const powerCheck = checkCapacity(fleetPeakPowerKw(fleetGroups), state.params.chargingPowerKw, "кВт");

  const scenarios = useMemo(
    () => buildAllScenarios({ params: state.params, transportSolution: selectedSolutions.transport, counts }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.params, state.transportSolutionId, counts.transportCount]
  );

  const setParam = (key, value) => setState((s) => ({ ...s, params: { ...s.params, [key]: value } }));
  const setParams = (partial) => setState((s) => ({ ...s, params: { ...s.params, ...partial } }));
  const setTransportSolutionId = (id) => setState((s) => ({ ...s, transportSolutionId: id }));
  const setManualTransportCount = (n) => setState((s) => ({ ...s, manualTransportCount: n }));
  const setActiveScenario = (kind) => setState((s) => ({ ...s, activeScenario: kind }));

  return {
    objectTypeId: OBJECT_TYPE_ID,
    params: state.params,
    selectedSolutions,
    counts,
    recommendedCounts: recommended,
    currentProcess: currentProcessOf(state.params, { useTransport: counts.transportCount > 0 }),
    throughputs: { transport: effectiveThroughput(selectedSolutions.transport) },
    powerCheck,
    activeScenario: state.activeScenario,
    scenarios,

    setParam,
    setParams,
    setTransportSolutionId,
    setManualTransportCount,
    setActiveScenario,
  };
}
