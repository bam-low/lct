import { ROBOT_SCENARIOS } from "../../simulation/layout.js";

// Что показывать в симуляции: один тип робота или демонстрационная связка.
// Выбирается ровно один вариант.
export default function RobotTypesSelect({ selected, onSelect }) {
  const selectedKey = selected.join(",");

  return (
    <div className="bg-white/40 rounded-xl p-4 space-y-2">
      <div className="text-sm font-bold text-[#3F4159]">Какие роботы показать в симуляции</div>

      <div className="flex flex-wrap gap-1.5">
        {ROBOT_SCENARIOS.map((option) => {
          const isOn = option.types.join(",") === selectedKey;

          return (
            <button
              key={option.id}
              onClick={() => onSelect(option.types)}
              aria-pressed={isOn}
              className={`text-sm px-3 py-1.5 rounded-full font-semibold transition ${
                isOn ? "bg-[#3F4159] text-white" : "bg-white/70 text-[#3F4159] hover:bg-white"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
