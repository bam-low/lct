import Slider from "../ui/Slider.jsx";

export default function ParamsForm({ objectType, params, onChange }) {
  return (
    <div className="bg-white/40 rounded-xl p-4 space-y-3">
      <div className="text-sm font-bold text-[#3F4159]">Параметры объекта и труда</div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        {objectType.paramSchema.map((field) => (
          <Slider
            key={field.key}
            label={field.label}
            value={params[field.key] ?? field.default}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            onChange={(v) => onChange(field.key, v)}
            fmt={(v) => `${field.step && field.step < 1 ? v.toFixed(2) : Math.round(v)} ${field.unit}`}
            hint={field.hint}
          />
        ))}
      </div>
    </div>
  );
}
