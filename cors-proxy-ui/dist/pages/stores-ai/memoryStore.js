const COPILOT_MEMORY_KEY = "arc_copilot_memory_v1";
export function loadLearnedRules() {
    try {
        const raw = localStorage.getItem(COPILOT_MEMORY_KEY);
        return raw ? JSON.parse(raw) : [];
    }
    catch {
        return [];
    }
}
export function saveLearnedRules(rules) {
    try {
        localStorage.setItem(COPILOT_MEMORY_KEY, JSON.stringify(rules, null, 2));
    }
    catch { }
}
