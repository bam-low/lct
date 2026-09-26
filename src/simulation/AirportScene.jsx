import { useState } from "react";
import { useAirportSimulation3D } from "./airport/useAirportSimulation3D.js";
import { Stat, MapLegend, VerificationPanel } from "./SimPanels.jsx";
import { ViewToolbar, PlaybackControls } from "./SimControls.jsx";
import { SCENE_HEIGHT_PX } from "./constants.js";
import { formatSimTime } from "./simStats.js";

const ZOOM_MIN = 24;
const ZOOM_MAX = 110;
const ZOOM_DEFAULT = 62;

const LEGEND_ITEMS = [
  { color: "#9C94C0", kind: "zone", label: "Терминал" },
  { color: "#b7bcd6", kind: "zone", label: "Перрон" },
  { color: "#E5A13F", kind: "zone", label: "Депо транспортировщиков" },
  { color: "#9be3c2", kind: "zone", label: "Зарядная станция" },
  { color: "#1b1d28", kind: "dot", label: "Транспортировщик (реальная модель — низкая платформа на колёсах)" },
  { color: "rgba(154,160,189,0.7)", kind: "line", label: "ВПП сбоку — декоративный фон" },
];

// 3D-визуализация аэропорта — та же основа, что у склада (изометрия +
// переключение на вид сверху). Временно один процесс — транспортировка
// грузов (см. objectTypes.js/airportAdapter.js): багаж/рамп/уборка убраны.
export default function AirportScene({ gatesCount, transportCount, transportThroughput, groundOpsPerFlight, demand, scenarioLabel }) {
  const [running, setRunning] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [speedMult, setSpeedMult] = useState(1);
  const [topView, setTopView] = useState(false);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);

  const { mountRef, stats, rotate } = useAirportSimulation3D({
    gatesCount,
    transportCount,
    transportThroughput,
    groundOpsPerFlight,
    running,
    speedMult,
    topView,
    camZoom: zoom,
    resetKey,
  });

  const zoomBy = (delta) => setZoom((z) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z + delta)));

  const verifyRows = [
    {
      label: "Транспортировка",
      unit: "оп/ч",
      required: demand.transport,
      calculated: transportCount * transportThroughput,
      simulated: stats.opsDone,
    },
  ];

  return (
    <div className="bg-white/40 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <div>
          <div className="text-sm font-bold text-[#3F4159]">Схема аэропорта · сценарий «{scenarioLabel}»</div>
          <div className="text-xs text-[#6b5f7a]">{gatesCount} гейтов · {transportCount} транспортировщиков</div>
        </div>
        <ViewToolbar topView={topView} onToggleTopView={() => setTopView((v) => !v)} onZoom={zoomBy} onRotate={rotate} />
      </div>

      <div className="rounded-xl overflow-hidden relative" style={{ height: SCENE_HEIGHT_PX }}>
        <div ref={mountRef} className="absolute inset-0" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
        <Stat label="Время модели" value={formatSimTime(stats.simSeconds)} />
        <Stat label="Рейсов обслужено/ч" value={Math.round(stats.opsDone)} />
      </div>

      <PlaybackControls
        running={running}
        onToggleRunning={() => setRunning((r) => !r)}
        onReset={() => setResetKey((k) => k + 1)}
        speed={speedMult}
        onSpeed={setSpeedMult}
      />

      <div className="mt-3">
        <MapLegend items={LEGEND_ITEMS} />
      </div>

      <div className="mt-3">
        <VerificationPanel rows={verifyRows} />
      </div>
    </div>
  );
}
