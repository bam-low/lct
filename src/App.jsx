import { useState } from "react";
import ObjectTypeSelect from "./components/economics/ObjectTypeSelect.jsx";
import WarehouseApp from "./apps/WarehouseApp.jsx";
import AirportApp from "./apps/AirportApp.jsx";

// Тонкий роутер по типу объекта (ТЗ 4.2.6): каждый рабочий тип — свой
// компонент со своим экономическим хуком (useEconomicsState/
// useAirportEconomicsState). Смена типа объекта переключает, какой из них
// смонтирован, а не то, какой из них вызывает свой хук условно — так не
// нарушаются правила хуков React.
const OBJECT_APPS = {
  warehouse: WarehouseApp,
  airport: AirportApp,
};

export default function App() {
  const [objectTypeId, setObjectTypeId] = useState("warehouse");
  const ObjectApp = OBJECT_APPS[objectTypeId] ?? WarehouseApp;

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

        <ObjectTypeSelect selected={objectTypeId} onSelect={setObjectTypeId} />

        <ObjectApp key={objectTypeId} />
      </div>
    </div>
  );
}
