import { checkSolutionApplicability } from "./applicability.js";

// Явное ранжирование решений каталога (ТЗ 3.4.5: "ранжирование должно быть
// объяснимым, пользователь должен видеть критерии и вклад ключевых факторов
// в итоговую оценку"). Критерий один и понятный — не скрытый скоринг из
// нескольких весов, а индекс "производительность на млн ₽ стоимости
// оборудования": чем выше, тем эффективнее вложение в этот тип решения.
// Показывается рядом с каждой карточкой (см. SolutionPicker.jsx), поэтому
// пользователь видит и число, и то, из чего оно считается.
//
// Неприменимые решения (applicable=false, ТЗ 3.4.3) всегда идут после
// применимых — сортировка не должна прятать предупреждение наверх списка.
export function rankSolutions(options, params) {
  return options
    .map((item) => {
      const { applicable, reasons } = params ? checkSolutionApplicability(item, params) : { applicable: true, reasons: [] };
      const cost = item.economics.equipmentCost || 0;
      const throughput = item.technical.throughput || 0;
      const efficiencyIndex = cost > 0 ? throughput / (cost / 1_000_000) : 0;

      return { item, applicable, reasons, efficiencyIndex };
    })
    .sort((a, b) => {
      if (a.applicable !== b.applicable) return a.applicable ? -1 : 1;
      return b.efficiencyIndex - a.efficiencyIndex;
    });
}
