import { useEffect, useMemo, useState } from "react";
import { defaultParamsFor } from "../domain/objectTypes.js";
import { catalogFor, getCatalogItem } from "../domain/catalog.js";
import { buildAllScenarios, computeRobotCounts } from "../domain/warehouseAdapter.js";
import { computeZoneWidths } from "../simulation/layout.js";
import { loadProject, saveProject } from "./projectStore.js";

const OBJECT_TYPE_ID = "warehouse"; // единственный рабочий тип объекта в этом заходе

function initialState() {
  const saved = loadProject();

  const params = saved?.params ?? defaultParamsFor(OBJECT_TYPE_ID);
  const mode = saved?.mode ?? "both";
  const vacuumSolutionId =
    saved?.vacuumSolutionId ?? catalogFor(OBJECT_TYPE_ID, "floor_cleaning")[0]?.id ?? null;
  const armSolutionId = saved?.armSolutionId ?? catalogFor(OBJECT_TYPE_ID, "sorting")[0]?.id ?? null;

  // Количество роботов теперь всегда задаётся вручную (степпер в симуляции),
  // но стартовое значение подсказываем расчётом, чтобы не начинать с "1" или "8".
  let manualVacuumCount = saved?.manualVacuumCount;
  let manualArmCount = saved?.manualArmCount;

  if (manualVacuumCount === undefined || manualArmCount === undefined) {
    const zones = computeZoneWidths(mode);

    const auto = computeRobotCounts({
      params,
      vacuumZoneAreaM2: zones.vacuumZoneAreaM2,
      vacuumSolution: getCatalogItem(vacuumSolutionId),
      armSolution: getCatalogItem(armSolutionId),
    });

    manualVacuumCount = manualVacuumCount ?? Math.max(1, auto.vacuumCount);
    manualArmCount = manualArmCount ?? Math.max(1, auto.armCount);
  }

  return {
    params,
    mode,
    vacuumSolutionId,
    armSolutionId,
    manualVacuumCount,
    manualArmCount,
    activeScenario: saved?.activeScenario ?? "purchase",
  };
}

export function useEconomicsState() {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    saveProject(state);
  }, [state]);

  const vacuumSolution = useMemo(
    () => getCatalogItem(state.vacuumSolutionId),
    [state.vacuumSolutionId]
  );

  const armSolution = useMemo(() => getCatalogItem(state.armSolutionId), [state.armSolutionId]);

  const zones = useMemo(() => computeZoneWidths(state.mode), [state.mode]);

  const scenarios = useMemo(
    () =>
      buildAllScenarios({
        params: state.params,
        vacuumSolution,
        armSolution,
        counts: { vacuumCount: state.manualVacuumCount, armCount: state.manualArmCount },
      }),
    [state.params, state.manualVacuumCount, state.manualArmCount, vacuumSolution, armSolution]
  );

  const setParam = (key, value) =>
    setState((s) => ({ ...s, params: { ...s.params, [key]: value } }));

  const setMode = (mode) => setState((s) => ({ ...s, mode }));

  const setVacuumSolutionId = (id) => setState((s) => ({ ...s, vacuumSolutionId: id }));

  const setArmSolutionId = (id) => setState((s) => ({ ...s, armSolutionId: id }));

  const setManualVacuumCount = (n) => setState((s) => ({ ...s, manualVacuumCount: n }));

  const setManualArmCount = (n) => setState((s) => ({ ...s, manualArmCount: n }));

  const setActiveScenario = (kind) => setState((s) => ({ ...s, activeScenario: kind }));

  return {
    objectTypeId: OBJECT_TYPE_ID,
    params: state.params,
    mode: state.mode,
    zones,
    vacuumSolution,
    armSolution,
    manualVacuumCount: state.manualVacuumCount,
    manualArmCount: state.manualArmCount,
    activeScenario: state.activeScenario,
    scenarios,

    setParam,
    setMode,
    setVacuumSolutionId,
    setArmSolutionId,
    setManualVacuumCount,
    setManualArmCount,
    setActiveScenario,
  };
}
