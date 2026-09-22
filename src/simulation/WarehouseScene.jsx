import { useMemo, useState } from "react";
import { MAX_VACUUM_COUNT, MAX_LOADER_COUNT, computeLayout } from "./layout.js";
import { computeFloorChunks } from "./chunkGrid.js";
import { SCENE_HEIGHT_PX, LOAD_SLOWDOWN, VACUUM_SWATH } from "./constants.js";
import { useSimulation } from "./useSimulation.js";
import { buildVerifyRows, buildLegendItems } from "./verification.js";
import { ROBOT_TITLES, PHASE_LABELS, formatHours, formatSimTime } from "./simStats.js";
import { Stat, RobotCountPanel, MapLegend, VerificationPanel } from "./SimPanels.jsx";
import { ViewToolbar, FloorSwitcher, PlaybackControls } from "./SimControls.jsx";

// ============================================================
// Управляемый (controlled) компонент: состав роботов, площадь, этажи, counts,
// productivity и энергопрофили приходят из useEconomicsState, чтобы 3D-сцена и
// расчёт экономики никогда не расходились в цифрах. Плейбек
// (running/скорость/камера/выбранный этаж) — внутреннее состояние сцены, на
// экономику не влияет.
//
// Сама симуляция и работа с Three.js — в useSimulation; здесь только интерфейс.
// ============================================================

// Со складом погрузчиков за воротами видна площадка для фур — отъезжаем чуть дальше.
const zoomDefaultFor = (floors, hasYard) => 52 + 8 * (floors - 1) + (hasYard ? 8 : 0);
const zoomMaxFor = (floors) => 70 + 14 * (floors - 1);
const ZOOM_MIN = 22;

export default function WarehouseScene({
  robotTypes,
  floorAreaM2,
  floorsCount,
  vacuumCount,
  vacuumProd,
  armCount,
  armProd,
  loaderCount,
  recommendedVacuumCount,
  recommendedArmCount,
  recommendedLoaderCount,
  loaderCapacityKg,
  loaderSpeedMps,
  loaderThroughput,
  cargoWeightKg,
  cargoLengthCm,
  cargoWidthCm,
  cargoHeightCm,
  skuCount,
  slotsPerLane,
  routeLengthM,
  cargoPerHour,
  outboundPerHour,
  truckPayload,
  workZoneShare,
  demand,
  scenarioLabel,
  energyProfiles,
  onManualVacuumCountChange,
  onManualArmCountChange,
  onManualLoaderCountChange,
}) {
  const [running, setRunning] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [activeFloor, setActiveFloor] = useState(0);
  const [speedMult, setSpeedMult] = useState(1);
  const [topView, setTopView] = useState(false); // 2D-вид сверху вместо 3D-изометрии

  const layout = useMemo(() => computeLayout(robotTypes, workZoneShare), [robotTypes, workZoneShare]);
  const chunkGrid = useMemo(() => computeFloorChunks(floorAreaM2), [floorAreaM2]);
  const { useVacuum, useArm, useLoader } = layout;

  // Зум чуть отдалённый по умолчанию, чтобы весь пол и стеллажи помещались в кадр
  // до того, как пользователь сам начнёт приближать/отдалять камеру. Если от состава
  // сцены меняется зум по умолчанию, пользовательский зум сбрасывается на него.
  const zoomDefault = zoomDefaultFor(floorsCount, useLoader);
  const [zoomState, setZoomState] = useState({ base: zoomDefault, zoom: zoomDefault });
  if (zoomState.base !== zoomDefault) setZoomState({ base: zoomDefault, zoom: zoomDefault });
  const camZoom = zoomState.zoom;

  const floorIndex = Math.min(activeFloor, floorsCount - 1);
  const multiFloor = floorsCount > 1;

  // Пылесос убирает свою полосу за время, которое задаёт его производительность
  // (м²/ч) и площадь помещения: единица сцены — это areaPerUnit2 м², поэтому чем
  // больше помещение, тем медленнее он едет в сцене.
  const vacuumSpeed = useVacuum ? vacuumProd / (VACUUM_SWATH * 3600 * chunkGrid.areaPerUnit2) : 0;

  const { mountRef, stats, modelState, rotate } = useSimulation({
    layout,
    chunkGrid,
    floorsCount,
    floorIndex,
    running,
    speedMult,
    topView,
    camZoom,
    resetKey,
    vacuumCount,
    vacuumSpeed,
    armCount,
    armProd,
    loaderCount,
    energyProfiles,
    loader: {
      capacityKg: loaderCapacityKg,
      cargoWeightKg,
      speedMps: loaderSpeedMps,
      cargoPerHour,
      truckPayload,
      slotsPerLane,
      routeLengthM,
      cargo: { lengthCm: cargoLengthCm, widthCm: cargoWidthCm, heightCm: cargoHeightCm, skuCount },
    },
  });

  const zoomBy = (delta) =>
    setZoomState((state) => ({ ...state, zoom: Math.max(ZOOM_MIN, Math.min(zoomMaxFor(floorsCount), state.zoom + delta)) }));

  const { vacuum: vacuumStats, loader: loaderStats } = stats;
  const vacuumProfile = energyProfiles.vacuum;
  const armOpsPerHour = useArm ? armCount * armProd * 60 : 0;
  const sceneTitle = robotTypes.map((type) => ROBOT_TITLES[type]).join(", ");
  const fullLoadSlowdownPct = Math.round(LOAD_SLOWDOWN * Math.min(1, cargoWeightKg / loaderCapacityKg) * 100);

  // Расчётная мощность парка для подтверждения расчёта симуляцией; у пылесосов — с
  // учётом времени на зарядку.
  const chargeDuty = vacuumProfile.runtimeHours ? vacuumProfile.runtimeHours / (vacuumProfile.runtimeHours + vacuumProfile.chargeHours) : 1;

  const verifyRows = buildVerifyRows({
    layout,
    demand,
    fleet: { vacuum: vacuumCount * vacuumProd * chargeDuty, arm: armOpsPerHour, loader: loaderCount * loaderThroughput },
    stats,
    areaPerUnit2: chunkGrid.areaPerUnit2,
    inflowPerFloor: { inbound: cargoPerHour / floorsCount, outbound: outboundPerHour / floorsCount },
    routeLengthM,
  });

  return (
    <div
      className="w-full rounded-2xl p-4"
      style={{
        background: "linear-gradient(160deg, #CBB8E8 0%, #E3B7C9 35%, #F3CDAE 65%, #FBE6C9 100%)",
        fontFamily: "'Baloo 2', ui-rounded, 'Segoe UI Rounded', sans-serif",
      }}
    >
      <div className="flex items-baseline justify-between mb-3 px-1">
        <div>
          <h2 className="text-2xl font-bold text-[#3F4159]">Склад мечты · {sceneTitle}</h2>
          {scenarioLabel && <p className="text-xs font-semibold text-[#6b5f7a]">Сценарий расчёта: {scenarioLabel}</p>}
          <p className="text-sm text-[#6b5f7a]">
            {floorAreaM2.toLocaleString("ru-RU")} м²{multiFloor ? ` × ${floorsCount} эт.` : ""} · {chunkGrid.perSide} ×{" "}
            {chunkGrid.perSide} чанков ({chunkGrid.chunkCount}){multiFloor ? " на этаж" : ""}
          </p>
        </div>

        <ViewToolbar
          topView={topView}
          onToggleTopView={() => setTopView((v) => !v)}
          onZoom={zoomBy}
          onRotate={rotate}
        />
      </div>

      {multiFloor && <FloorSwitcher count={floorsCount} active={floorIndex} onSelect={setActiveFloor} />}

      <div ref={mountRef} className="w-full rounded-xl overflow-hidden" style={{ height: SCENE_HEIGHT_PX }} />

      {modelState === "error" && (
        <p className="text-xs text-[#9C3B3B] font-semibold mt-2 px-1">
          Не удалось загрузить 3D-модели (public/models/*.glb) — подробности в консоли браузера.
        </p>
      )}

      {multiFloor && (
        <p className="text-xs text-[#6b5f7a] font-semibold mt-3 px-1">
          Показатели этажа {floorIndex + 1}; электроэнергия и время — по всему зданию.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-2">
        {useVacuum && <Stat label="Отполировано" value={`${stats.coverage.toFixed(1)}%`} />}
        {useVacuum && <Stat label="Проходов уборки" value={vacuumStats.passes} />}
        {useVacuum && (
          <Stat
            label="Заряд, мин."
            value={vacuumStats.minSoc === null ? "—" : `${Math.round(vacuumStats.minSoc * 100)}%`}
          />
        )}
        {useVacuum && <Stat label="На зарядке" value={`${vacuumStats.charging}/${vacuumCount}`} />}
        {useArm && <Stat label="Обработано, шт" value={stats.opsDone} />}
        {useArm && <Stat label="Темп рук" value={`${armOpsPerHour.toFixed(0)} оп/ч`} />}
        {useLoader && <Stat label="Склад" value={PHASE_LABELS[loaderStats.phase]} />}
        {useLoader && <Stat label="Заполнено" value={`${loaderStats.fillPercent}%`} />}
        {useLoader && <Stat label="На складе, кг" value={loaderStats.storedKg} />}
        {useLoader && <Stat label="На площадках, ед." value={loaderStats.dockUnits} />}
        {useLoader && <Stat label="Фуры у ворот / в очереди" value={`${loaderStats.trucksAtGates} / ${loaderStats.trucksWaiting}`} />}
        {useLoader && <Stat label="Фур принято / отправлено" value={`${loaderStats.trucksIn} / ${loaderStats.trucksOut}`} />}
        {useLoader && <Stat label="Принято, кг" value={loaderStats.receivedKg} />}
        {useLoader && <Stat label="Отгружено, кг" value={loaderStats.shippedKg} />}
        {useLoader && <Stat label="Погрузчиков в работе" value={`${loaderStats.busyLoaders}/${loaderCount}`} />}
        {useLoader && (
          <Stat
            label="Поток факт / нужен, ед./ч"
            value={`${loaderStats.movedPerHour || "—"} / ${Math.round(demand.loader)}`}
          />
        )}
        {useLoader && <Stat label="Полных циклов" value={loaderStats.cycles} />}
        <Stat label="Электроэнергия" value={`${stats.energyKwh.toFixed(2)} кВт·ч`} />
        <Stat label="Время" value={formatSimTime(stats.simSeconds)} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 px-1">
        {useVacuum && (
          <RobotCountPanel
            title={multiFloor ? "🧹 Пылесосы на каждом этаже" : "🧹 Пылесосы"}
            count={vacuumCount}
            description={
              `Производительность одного робота: ${vacuumProd.toFixed(0)} м²/ч. ` +
              (vacuumProfile.runtimeHours
                ? `На одной зарядке работает ${formatHours(vacuumProfile.runtimeHours)}, заряжается ${formatHours(vacuumProfile.chargeHours)}. `
                : "Питание от сети. ") +
              "Убрав свой участок, робот заряжается и убирает его заново — цикл бесконечный."
            }
            onManualChange={onManualVacuumCountChange}
            min={1}
            max={MAX_VACUUM_COUNT}
            recommended={recommendedVacuumCount}
          />
        )}

        {useArm && (
          <RobotCountPanel
            title={multiFloor ? "🦾 Роборуки на каждом этаже" : "🦾 Роборуки"}
            count={armCount}
            description={`Производительность одного робота: ${(armProd * 60).toFixed(0)} оп/ч (по выбранному решению в каталоге). Больше четырёх рук выстраиваются параллельными колонками.`}
            onManualChange={onManualArmCountChange}
            min={1}
            max={layout.maxArmCount}
            recommended={recommendedArmCount}
          />
        )}

        {useLoader && (
          <RobotCountPanel
            title={multiFloor ? "🚜 Погрузчики на каждом этаже" : "🚜 Погрузчики"}
            count={loaderCount}
            description={`Скорость ${loaderSpeedMps.toFixed(1)} м/с, грузоподъёмность ${loaderCapacityKg} кг, единица груза — ${cargoWeightKg} кг: с грузом погрузчик едет на ${fullLoadSlowdownPct}% медленнее. За каждыми воротами закреплён свой погрузчик. Фура привозит ${truckPayload} ед. и выгружает их разом.`}
            onManualChange={onManualLoaderCountChange}
            min={1}
            max={MAX_LOADER_COUNT}
            recommended={recommendedLoaderCount}
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4 px-1">
        <VerificationPanel rows={verifyRows} />
        <MapLegend items={buildLegendItems(layout)} />
      </div>

      <PlaybackControls
        running={running}
        onToggleRunning={() => setRunning((value) => !value)}
        onReset={() => setResetKey((key) => key + 1)}
        speed={speedMult}
        onSpeed={setSpeedMult}
      />
    </div>
  );
}
