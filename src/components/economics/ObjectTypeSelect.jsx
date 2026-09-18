import { OBJECT_TYPE_LIST } from "../../domain/objectTypes.js";

export default function ObjectTypeSelect({ selected }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {OBJECT_TYPE_LIST.map((type) => {
        const isSelected = type.id === selected;

        return (
          <div
            key={type.id}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-base font-semibold transition ${
              isSelected
                ? "bg-[#3F4159] text-white"
                : "bg-white/50 text-[#6b5f7a] opacity-60 cursor-not-allowed"
            }`}
            title={type.comingSoon ? "Появится в следующей фазе" : undefined}
          >
            <span>{type.icon}</span>
            <span>{type.label}</span>
            {type.comingSoon && (
              <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-white/30">
                скоро
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
