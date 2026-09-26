// Временное хранилище проекта поверх localStorage. Единственная точка, которую
// нужно будет заменить на реальный backend/API (ТЗ 4.2.6) — интерфейс load/save
// намеренно узкий и не завязан на localStorage снаружи модуля.

const STORAGE_KEY = "warehouse-sim/project/v1";

// key — отдельный проект на тип объекта (ТЗ 3.1.3: сравнение сценариев ведётся
// внутри проекта, а не между объектами разных типов); склад держит исходный
// ключ ради обратной совместимости с уже сохранёнными проектами.
export function loadProject(key = STORAGE_KEY) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveProject(project, key = STORAGE_KEY) {
  try {
    window.localStorage.setItem(key, JSON.stringify(project));
  } catch {
    // localStorage недоступен (приватный режим, квота) — молча пропускаем,
    // проект просто не переживёт перезагрузку страницы.
  }
}

export function clearProject(key = STORAGE_KEY) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // см. saveProject
  }
}
