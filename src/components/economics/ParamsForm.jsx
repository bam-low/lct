import Slider from "../ui/Slider.jsx";

// Порядок групп — как в ТЗ (входные данные по объекту); поля без группы идут в конце.
function groupFields(schema) {
  const groups = [];

  for (const field of schema) {
    const title = field.group ?? "Параметры";
    let group = groups.find((g) => g.title === title);

    if (!group) {
      group = { title, fields: [] };
      groups.push(group);
    }

    group.fields.push(field);
  }

  return groups;
}

function SelectField({ field, value, onChange }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-[#3F4159]">{field.label}</span>

      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg bg-white/80 text-sm text-[#3F4159] px-2 py-1.5 shadow-sm"
      >
        {field.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {field.hint && <span className="block text-xs text-[#6b5f7a] mt-0.5">{field.hint}</span>}
    </label>
  );
}

export default function ParamsForm({ objectType, params, onChange }) {
  return (
    <div className="bg-white/40 rounded-xl p-4 space-y-4">
      <div className="text-sm font-bold text-[#3F4159]">Параметры объекта, процессов и труда</div>

      {groupFields(objectType.paramSchema).map((group) => (
        <div key={group.title} className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wide text-[#6b5f7a]">{group.title}</div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            {group.fields.map((field) =>
              field.type === "select" ? (
                <SelectField
                  key={field.key}
                  field={field}
                  value={params[field.key] ?? field.default}
                  onChange={(v) => onChange(field.key, v)}
                />
              ) : (
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
              )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
