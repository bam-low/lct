const OPTIONS = [
  { id: "vacuum", label: "🧹 Пылесосы" },
  { id: "arm", label: "🦾 Роборуки" },
  { id: "both", label: "Оба типа" },
];

export default function ModeSelect({ mode, onChange }) {
  return (
    <div className="bg-white/40 rounded-xl p-4 space-y-2">
      <div className="text-sm font-bold text-[#3F4159]">Какие роботы нужны на объекте</div>

      <div className="flex gap-1.5">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={`text-sm px-3 py-1.5 rounded-full font-semibold transition ${
              mode === opt.id ? "bg-[#3F4159] text-white" : "bg-white/70 text-[#3F4159] hover:bg-white"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
