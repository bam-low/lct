// Временное хранилище проекта поверх localStorage. Единственная точка, которую
// нужно будет заменить на реальный backend/API (ТЗ 4.2.6) — интерфейс load/save
// намеренно узкий и не завязан на localStorage снаружи модуля.

const STORAGE_KEY = "warehouse-sim/project/v1";

export function loadProject() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveProject(project) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    // localStorage недоступен (приватный режим, квота) — молча пропускаем,
    // проект просто не переживёт перезагрузку страницы.
  }
}

export function clearProject() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // см. saveProject
  }
}
