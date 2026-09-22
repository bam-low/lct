// Загрузка параметров объекта из файла (ТЗ 3.2.3–3.2.4): шаблон CSV,
// сгенерированный из paramSchema конкретного типа объекта, — открывается и
// редактируется в Excel (сохранить как «CSV UTF-8»), затем загружается обратно.
// Работает для любого типа объекта, у которого есть paramSchema (ТЗ 4.2.6) —
// ничего здесь не завязано на склад.

const COLUMNS = ["Параметр", "Ключ", "Ед. изм.", "Значение", "Допустимые значения", "Подсказка"];

function csvEscape(field) {
  const text = String(field ?? "");
  return /[;,"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function allowedValuesOf(field) {
  if (field.type === "select") return field.options.map((o) => o.value).join(" | ");
  if (field.type === "number") return `${field.min ?? "—"}…${field.max ?? "—"}`;
  return "";
}

// Экспорт текущих значений как CSV-шаблон (UTF-8 с BOM — чтобы Excel не путал кодировку).
export function exportParamsCsv(objectType, params) {
  const rows = [COLUMNS];

  for (const field of objectType.paramSchema) {
    rows.push([
      field.label,
      field.key,
      field.unit ?? "",
      params[field.key] ?? field.default,
      allowedValuesOf(field),
      field.hint ?? "",
    ]);
  }

  const csv = rows.map((row) => row.map(csvEscape).join(";")).join("\r\n");
  return "﻿" + csv;
}

// Малый устойчивый CSV-парсер: поддерживает кавычки, экранирование "" внутри
// поля и перевод строки внутри кавычек — на случай, если пользователь
// отредактировал подсказки/значения в Excel и тот переформатировал файл.
function parseCsvText(text) {
  const delimiter = (text.slice(0, text.indexOf("\n")).match(/;/g)?.length ?? 0) >=
  (text.slice(0, text.indexOf("\n")).match(/,/g)?.length ?? 0)
    ? ";"
    : ",";

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  const body = text.replace(/^﻿/, "");

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];

    if (inQuotes) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') inQuotes = true;
    else if (ch === delimiter) pushField();
    else if (ch === "\r") continue;
    else if (ch === "\n") pushRow();
    else field += ch;
  }
  if (field !== "" || row.length > 0) pushRow();

  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// "7,5" (ru-Excel) и "7.5" — оба валидны; пробелы-разделители тысяч игнорируются.
function parseLocaleNumber(raw) {
  const cleaned = raw.replace(/\s/g, "").replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

// Разбирает загруженный CSV в { values, errors } по схеме objectType.paramSchema.
// values — только успешно провалидированные поля (можно сразу применять),
// errors — с понятным текстом и указанием, что делать (ТЗ 4.5.4).
export function parseParamsCsv(text, objectType) {
  const rows = parseCsvText(text);
  if (rows.length === 0) return { values: {}, errors: [{ message: "Файл пуст или не удалось его прочитать." }] };

  const header = rows[0].map((h) => h.trim());
  const keyCol = header.indexOf("Ключ");
  const valueCol = header.indexOf("Значение");

  if (keyCol === -1 || valueCol === -1) {
    return {
      values: {},
      errors: [
        {
          message:
            'В файле нет колонок "Ключ" и/или "Значение" — используйте шаблон, скачанный на этой странице, и не переименовывайте заголовки.',
        },
      ],
    };
  }

  const byKey = Object.fromEntries(objectType.paramSchema.map((f) => [f.key, f]));
  const values = {};
  const errors = [];

  for (let i = 1; i < rows.length; i++) {
    const key = rows[i][keyCol]?.trim();
    const raw = rows[i][valueCol]?.trim();
    if (!key) continue;

    const field = byKey[key];
    if (!field) {
      errors.push({ row: i + 1, key, message: `Неизвестный ключ параметра "${key}" — пропущен.` });
      continue;
    }
    if (raw === undefined || raw === "") {
      errors.push({ row: i + 1, key, label: field.label, message: `Пустое значение для «${field.label}» — оставлено прежним.` });
      continue;
    }

    if (field.type === "select") {
      const valid = field.options.some((o) => o.value === raw);
      if (!valid) {
        errors.push({
          row: i + 1,
          key,
          label: field.label,
          message: `«${field.label}»: значение "${raw}" не из списка (${field.options.map((o) => o.value).join(", ")}).`,
        });
        continue;
      }
      values[key] = raw;
      continue;
    }

    const num = parseLocaleNumber(raw);
    if (num === null) {
      errors.push({ row: i + 1, key, label: field.label, message: `«${field.label}»: "${raw}" — не число.` });
      continue;
    }
    if (field.min !== undefined && num < field.min) {
      errors.push({ row: i + 1, key, label: field.label, message: `«${field.label}»: ${num} меньше допустимого минимума ${field.min}${field.unit ? " " + field.unit : ""}.` });
      continue;
    }
    if (field.max !== undefined && num > field.max) {
      errors.push({ row: i + 1, key, label: field.label, message: `«${field.label}»: ${num} больше допустимого максимума ${field.max}${field.unit ? " " + field.unit : ""}.` });
      continue;
    }

    values[key] = num;
  }

  return { values, errors };
}

export function downloadTextFile(filename, content, mimeType = "text/csv;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
