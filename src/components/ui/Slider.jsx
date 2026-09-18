export default function Slider({ label, value, min, max, step, onChange, fmt = (v) => v, hint }) {
  return (
    <label className="text-sm block">
      <div className="flex justify-between mb-1 text-[#3F4159] font-semibold">
        <span>{label}</span>
        <span>{fmt(value)}</span>
      </div>

      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full pretty-range"
      />

      {hint && <div className="text-xs text-[#6b5f7a] mt-0.5">{hint}</div>}
    </label>
  );
}
