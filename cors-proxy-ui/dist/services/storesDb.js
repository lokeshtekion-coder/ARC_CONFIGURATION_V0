import { openDB } from "idb";
export const NOT_WORKED_OPTIONS = [
    "Fixed Ops handled by POD",
    "Variable Ops handled by POD",
    "Fixed + Variable handled by POD",
    "Fixed Ops OFS",
    "Variable Ops OFS",
    "Fixed + Variable OFS",
];
/**
 * Resolves the active TAP project ID using whichever field is populated:
 * checks onboarding_project_id first, then falls back to ds_onboarding_project_id.
 */
export function resolveStoreProjectId(store) {
    if (!store)
        return "";
    const primary = (store.onboarding_project_id || "").trim();
    if (primary)
        return primary;
    const secondary = (store.ds_onboarding_project_id || "").trim();
    return secondary;
}
const DB_NAME = "stores_database";
const DB_VERSION = 1;
const STORE_VAULT_KEY = "stores_status_vault";
const STATUS_TIMELINE_KEY = "stores_status_timeline";
const BACKUP_API_URL = "http://localhost:4000/api/stores/backup";
let dbPromise = null;
function getDb() {
    if (!dbPromise) {
        dbPromise = openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                if (!db.objectStoreNames.contains("stores")) {
                    db.createObjectStore("stores", { keyPath: "tekion_id" });
                }
            },
        });
    }
    return dbPromise;
}
export function getStoredStatusVault() {
    try {
        const raw = localStorage.getItem(STORE_VAULT_KEY);
        return raw ? JSON.parse(raw) : {};
    }
    catch {
        return {};
    }
}
export function getStatusTimeline() {
    try {
        const raw = localStorage.getItem(STATUS_TIMELINE_KEY);
        return raw ? JSON.parse(raw) : {};
    }
    catch {
        return {};
    }
}
async function pushBackupToBackend(stores) {
    if (!stores || stores.length === 0)
        return;
    try {
        const vault = getStoredStatusVault();
        const timeline = getStatusTimeline();
        await fetch(BACKUP_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stores, vault, timeline }),
        });
    }
    catch (err) {
        console.warn("[storesDb] Dual backup push failed:", err);
    }
}
export async function getStores() {
    const db = await getDb();
    const localStores = await db.getAll("stores");
    if (!localStores || localStores.length === 0) {
        console.info("[storesDb] IndexedDB empty. Initiating recovery from SQLite/Backup...");
        try {
            const res = await fetch(BACKUP_API_URL);
            if (res.ok) {
                const data = await res.json();
                const recoveredStores = Array.isArray(data?.stores)
                    ? data.stores
                    : [];
                if (recoveredStores.length > 0) {
                    const tx = db.transaction("stores", "readwrite");
                    const store = tx.objectStore("stores");
                    await Promise.all(recoveredStores.map((item) => store.put(item)));
                    await tx.done;
                    if (data.vault && Object.keys(data.vault).length > 0) {
                        localStorage.setItem(STORE_VAULT_KEY, JSON.stringify(data.vault));
                    }
                    if (data.timeline && Object.keys(data.timeline).length > 0) {
                        localStorage.setItem(STATUS_TIMELINE_KEY, JSON.stringify(data.timeline));
                    }
                    console.info(`[storesDb] ✅ Restored ${recoveredStores.length} stores and timelines.`);
                    return recoveredStores;
                }
            }
        }
        catch (err) {
            console.warn("[storesDb] Recovery failed:", err);
        }
    }
    return localStores;
}
export async function saveStores(stores) {
    const db = await getDb();
    const tx = db.transaction("stores", "readwrite");
    const store = tx.objectStore("stores");
    await Promise.all(stores.map((item) => store.put(item)));
    await tx.done;
    void pushBackupToBackend(stores);
}
export function saveStatusToVault(tekionId, field, value) {
    try {
        const vault = getStoredStatusVault();
        if (!vault[tekionId])
            vault[tekionId] = {};
        vault[tekionId][field] = value;
        localStorage.setItem(STORE_VAULT_KEY, JSON.stringify(vault));
    }
    catch (err) {
        console.error("[storesDb] Failed save status to vault:", err);
    }
}
export function saveNotWorkedToVault(tekionId, value) {
    try {
        const vault = getStoredStatusVault();
        if (!vault[tekionId])
            vault[tekionId] = {};
        vault[tekionId].not_worked = value;
        localStorage.setItem(STORE_VAULT_KEY, JSON.stringify(vault));
    }
    catch (err) {
        console.error("[storesDb] Failed save not_worked to vault:", err);
    }
}
export function saveAssigneesToVault(tekionId, assignees) {
    try {
        const vault = getStoredStatusVault();
        if (!vault[tekionId])
            vault[tekionId] = {};
        if (assignees.custom_assignee !== undefined) {
            vault[tekionId].custom_assignee = assignees.custom_assignee;
        }
        if (assignees.custom_variable_assignee !== undefined) {
            vault[tekionId].custom_variable_assignee = assignees.custom_variable_assignee;
        }
        localStorage.setItem(STORE_VAULT_KEY, JSON.stringify(vault));
    }
    catch (err) {
        console.error("[storesDb] Failed save assignees to vault:", err);
    }
}
/**
 * Bulk updates the vault with safety rules:
 * - Completed statuses are locked and cannot be demoted to 'TO DO' or 'WIP'
 *   by automated background sync calls unless allowDowngrade is explicitly true.
 * - Updates and preserves Fixed Ops, Variable Ops assignees, and Not Worked flags if provided.
 */
export function bulkUpdateStatusVault(updates, allowDowngrade = false) {
    try {
        const vault = getStoredStatusVault();
        const priorityScore = { Completed: 3, WIP: 2, "TO DO": 1 };
        for (const item of updates) {
            if (!vault[item.tekionId])
                vault[item.tekionId] = {};
            if (item.fixed_ops_status) {
                const current = vault[item.tekionId].fixed_ops_status;
                if (allowDowngrade ||
                    (priorityScore[item.fixed_ops_status] ?? 1) >= (priorityScore[current || "TO DO"] ?? 1)) {
                    vault[item.tekionId].fixed_ops_status = item.fixed_ops_status;
                }
            }
            if (item.variable_ops_status) {
                const current = vault[item.tekionId].variable_ops_status;
                if (allowDowngrade ||
                    (priorityScore[item.variable_ops_status] ?? 1) >= (priorityScore[current || "TO DO"] ?? 1)) {
                    vault[item.tekionId].variable_ops_status = item.variable_ops_status;
                }
            }
            if (item.testing_status) {
                const current = vault[item.tekionId].testing_status;
                if (allowDowngrade ||
                    (priorityScore[item.testing_status] ?? 1) >= (priorityScore[current || "TO DO"] ?? 1)) {
                    vault[item.tekionId].testing_status = item.testing_status;
                }
            }
            if (item.custom_assignee !== undefined) {
                vault[item.tekionId].custom_assignee = item.custom_assignee;
            }
            if (item.custom_variable_assignee !== undefined) {
                vault[item.tekionId].custom_variable_assignee = item.custom_variable_assignee;
            }
            if (item.not_worked !== undefined) {
                vault[item.tekionId].not_worked = item.not_worked;
            }
        }
        localStorage.setItem(STORE_VAULT_KEY, JSON.stringify(vault));
    }
    catch (err) {
        console.error("[storesDb] Bulk update status vault failed:", err);
    }
}
export function recordStatusTransition(tekionId, field, value, customIsoTime) {
    try {
        const timeline = getStatusTimeline();
        if (!timeline[tekionId])
            timeline[tekionId] = {};
        if (!timeline[tekionId][field])
            timeline[tekionId][field] = {};
        const timestamp = customIsoTime || new Date().toISOString();
        if (value === "WIP") {
            timeline[tekionId][field].wipAt = timestamp;
        }
        else if (value === "Completed") {
            timeline[tekionId][field].completedAt = timestamp;
        }
        else if (value === "TO DO") {
            timeline[tekionId][field] = {};
        }
        localStorage.setItem(STATUS_TIMELINE_KEY, JSON.stringify(timeline));
    }
    catch (err) {
        console.error("[storesDb] Record status transition failed:", err);
    }
}
