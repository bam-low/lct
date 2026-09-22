// Применимость решения к объекту (ТЗ 3.4.1–3.4.4). Пока проверяются только
// структурные числовые ограничения, которые есть и в схеме параметров объекта,
// и в карточке решения каталога (табл. 3.3.7) — текстовые "limitations"
// каталога сюда не парсятся (это было бы хрупко), а просто показываются
// пользователю отдельно как есть, см. SolutionPicker.jsx.
//
// Решение с найденным ограничением не исключается из списка — пользователь
// по-прежнему может его выбрать, но видит явное предупреждение (ТЗ 3.4.3–3.4.4:
// "не рекомендовать... при недостатке данных — пометить как требующее
// проверки", "позволять добавить решение вручную, даже если не подходит, с
// отображением предупреждения").

// Единственное жёсткое числовое ограничение, которое сейчас можно проверить не
// гадая: грузоподъёмность погрузчика против средней массы грузовой единицы объекта.
export function checkSolutionApplicability(solution, params) {
  const reasons = [];

  if (solution.identification.type === "loader" && solution.technical.capacityKg) {
    const cargoWeight = params.cargoWeightKg ?? 0;
    if (cargoWeight > solution.technical.capacityKg) {
      reasons.push(
        `Средняя масса грузовой единицы (${cargoWeight} кг) больше грузоподъёмности решения (${solution.technical.capacityKg} кг) — решение физически не сможет её поднять.`
      );
    }
  }

  return { applicable: reasons.length === 0, reasons };
}

// Сравнение расчётного CAPEX сценария с заявленным бюджетом объекта — не
// исключение, а информационное предупреждение (бюджет — ориентир, ТЗ 3.4.1).
export function checkBudget(scenarioCapex, budgetCapexMRub) {
  if (!budgetCapexMRub) return null;

  const budgetRub = budgetCapexMRub * 1_000_000;
  const overBy = scenarioCapex - budgetRub;

  return { budgetRub, withinBudget: overBy <= 0, overBy: Math.max(0, overBy) };
}
