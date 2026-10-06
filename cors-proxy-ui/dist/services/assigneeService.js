export const ASSIGNEE_OPTIONS = [
    "Amaresh M",
    "Lokesh Reddy",
    "Karan",
    "Sujatha",
    "Arun",
    "Nanjunda",
];
/** Display/export assignee: explicit pick first, else inferred from lead-name fields. */
export function resolveStoreAssignee(row) {
    const custom = String(row.custom_assignee ?? "").trim();
    if (custom && ASSIGNEE_OPTIONS.includes(custom))
        return custom;
    const anyRow = row;
    const textBlob = `${anyRow.lead_assignee || ""} ${anyRow.primary_lead_name || ""} ${anyRow.implementation_consultant || ""} ${anyRow.fixed_ops_lead_name || ""} ${anyRow.variable_ops_lead_name || ""} ${anyRow.conversion_track_lead_1773369950325147526 || ""}`.toLowerCase();
    for (const opt of ASSIGNEE_OPTIONS) {
        if (textBlob.includes(opt.split(" ")[0].toLowerCase()))
            return opt;
    }
    return "";
}
const API = "http://localhost:4000/api/stores/app-state";
const CONFIG_KEY = "assignee_config";
const LOG_KEY = "assignment_log";
const STATE_KEY = "assignment_state";
const MAX_LOG = 5000;
const DEFAULT_CONFIG = { selected: [...ASSIGNEE_OPTIONS], autoAssignEnabled: false };
function readLocal(key, fallback) {
    try {
        const raw = localStorage.getItem(`arc-${key}`);
        return raw ? JSON.parse(raw) : fallback;
    }
    catch {
        return fallback;
    }
}
function writeLocal(key, value) {
    try {
        localStorage.setItem(`arc-${key}`, JSON.stringify(value));
    }
    catch {
        /* ignore quota errors; backend copy still written below */
    }
    void fetch(`${API}/${key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
    }).catch(() => undefined);
}
/** Restores anything missing locally from the backend copy (e.g. cleared browser). */
export async function hydrateAssigneeStateFromBackend() {
    for (const key of [CONFIG_KEY, LOG_KEY, STATE_KEY]) {
        if (localStorage.getItem(`arc-${key}`))
            continue;
        try {
            const res = await fetch(`${API}/${key}`);
            if (!res.ok)
                continue;
            const json = (await res.json());
            if (json.value)
                localStorage.setItem(`arc-${key}`, JSON.stringify(json.value));
        }
        catch {
            /* backend offline - fine */
        }
    }
}
export function loadAssigneeConfig() {
    const c = readLocal(CONFIG_KEY, {});
    return {
        selected: Array.isArray(c.selected) ? c.selected : DEFAULT_CONFIG.selected,
        autoAssignEnabled: Boolean(c.autoAssignEnabled),
    };
}
export function saveAssigneeConfig(config) {
    writeLocal(CONFIG_KEY, config);
}
export function loadAssignmentLog() {
    return readLocal(LOG_KEY, []);
}
function appendLog(events) {
    if (!events.length)
        return;
    const next = [...loadAssignmentLog(), ...events].slice(-MAX_LOG);
    writeLocal(LOG_KEY, next);
}
function loadState() {
    return readLocal(STATE_KEY, {});
}
function makeEvent(store, assignee, previousAssignee, source) {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        tekionId: store.tekion_id,
        dealerName: store.dba_name,
        dealerId: store.dealer_id,
        assignee,
        previousAssignee,
        source,
        at: new Date().toISOString(),
    };
}
/** Call when a person changes an assignee in the Stores table. */
export function recordManualAssignment(store, newAssignee) {
    const state = loadState();
    const previous = state[store.tekion_id]?.assignee ?? store.custom_assignee ?? "";
    if (previous === newAssignee)
        return;
    state[store.tekion_id] = { assignee: newAssignee, source: "manual" };
    writeLocal(STATE_KEY, state);
    appendLog([makeEvent(store, newAssignee, previous, "manual")]);
}
/**
 * Detects assignee changes we did not make (e.g. someone edited the Excel
 * sheet) and logs them, so every change is tracked.
 */
export function reconcileAssignments(records) {
    const state = loadState();
    const events = [];
    let dirty = false;
    for (const r of records) {
        const current = String(r.custom_assignee ?? "").trim();
        const known = state[r.tekion_id];
        if (!known) {
            if (current) {
                state[r.tekion_id] = { assignee: current, source: "manual" };
                dirty = true;
            }
            continue;
        }
        if (known.assignee !== current) {
            events.push(makeEvent(r, current, known.assignee, "excel"));
            state[r.tekion_id] = { assignee: current, source: "excel" };
            dirty = true;
        }
    }
    if (dirty)
        writeLocal(STATE_KEY, state);
    appendLog(events);
}
/** Parts AND Service blueprints are both completed. */
export function isEligibleForAutoAssign(store) {
    const b = store.blueprint_statuses;
    return b?.parts === "COMPLETED" && b?.service === "COMPLETED";
}
/**
 * Assigns every eligible, currently-unassigned store to the selected assignee
 * with the fewest stores so far (keeps the split equal). Never overrides an
 * existing assignee. Returns the changed stores.
 */
export function runAutoAssign(records, config) {
    const pool = config.selected.filter((n) => ASSIGNEE_OPTIONS.includes(n));
    if (!pool.length)
        return { updated: [], events: [] };
    const load = new Map(pool.map((n) => [n, 0]));
    for (const r of records) {
        const a = String(r.custom_assignee ?? "");
        if (load.has(a))
            load.set(a, (load.get(a) ?? 0) + 1);
    }
    const candidates = records
        .filter((r) => isEligibleForAutoAssign(r) && !String(r.custom_assignee ?? "").trim())
        .sort((a, b) => String(a.launch_date).localeCompare(String(b.launch_date)));
    const state = loadState();
    const updated = [];
    const events = [];
    for (const store of candidates) {
        let pick = pool[0];
        for (const n of pool)
            if ((load.get(n) ?? 0) < (load.get(pick) ?? 0))
                pick = n;
        load.set(pick, (load.get(pick) ?? 0) + 1);
        updated.push({ ...store, custom_assignee: pick });
        state[store.tekion_id] = { assignee: pick, source: "bot" };
        events.push(makeEvent(store, pick, "", "bot"));
    }
    if (events.length) {
        writeLocal(STATE_KEY, state);
        appendLog(events);
    }
    return { updated, events };
}
export function summarizeAssignments(records, log) {
    const rows = ASSIGNEE_OPTIONS.map((name) => {
        const current = records.filter((r) => r.custom_assignee === name).length;
        const byBot = log.filter((e) => e.source === "bot" && e.assignee === name).length;
        const movedAwayManually = log.filter((e) => e.source !== "bot" && e.previousAssignee === name).length;
        const receivedManually = log.filter((e) => e.source !== "bot" && e.assignee === name).length;
        return { name, current, byBot, receivedManually, movedAwayManually };
    });
    return rows;
}
