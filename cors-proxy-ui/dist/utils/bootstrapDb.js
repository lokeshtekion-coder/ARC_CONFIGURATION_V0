// ─────────────────────────────────────────────────────────────
// bootstrapDb.ts — IndexedDB service for Bootstrap records
// ─────────────────────────────────────────────────────────────
//
// HOW DATA GETS SAVED IN INDEXEDDB
// -----------------------------------------------------------------
// This file stores bootstrap snapshots in IndexedDB database
// "arc_bootstrap_db", object store "bootstraps", using "key" as the
// primary key.
//
// Existing functions like idbSaveBootstrap / idbGetAllBootstraps stay
// valid and continue working as before.
//
// In addition, idbSaveBootstrapWithRawSections(...) allows saving:
// 1. extracted bootstrap output used by the UI
// 2. only the approved raw accounting bootstrap asset sections from
//    the original API payload
//
// Those approved raw sections are merged into record.data:
//
// - apSetup
// - accountingSettings
// - allAccounts
// - allJournals
// - arSetup
// - lookupAssetSupport
// - glAccountDynamicKeys
// - customField
// - salesChains
//
// This preserves backward compatibility while keeping the IndexedDB
// snapshot intentionally limited to only the accounting assets that
// your project currently wants to retain.
// -----------------------------------------------------------------
const DB_NAME = "arc_bootstrap_db";
const DB_VERSION = 1;
const STORE_NAME = "bootstraps";
function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "key" });
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = () => reject(req.error);
    });
}
export async function idbSaveBootstrap(record) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(record);
        req.onsuccess = () => {
            db.close();
            resolve();
        };
        req.onerror = () => {
            db.close();
            reject(req.error);
        };
    });
}
export async function idbGetBootstrap(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => {
            db.close();
            resolve(req.result ?? null);
        };
        req.onerror = () => {
            db.close();
            reject(req.error);
        };
    });
}
export async function idbGetAllBootstraps() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
            db.close();
            resolve(req.result ?? []);
        };
        req.onerror = () => {
            db.close();
            reject(req.error);
        };
    });
}
export async function idbDeleteBootstrap(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(key);
        req.onsuccess = () => {
            db.close();
            resolve();
        };
        req.onerror = () => {
            db.close();
            reject(req.error);
        };
    });
}
function normalize(value) {
    return String(value ?? "").trim();
}
function asObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    return value;
}
function getNestedValue(root, path) {
    let current = root;
    for (const key of path) {
        const obj = asObject(current);
        if (!obj)
            return undefined;
        current = obj[key];
    }
    return current;
}
function firstDefined(...values) {
    for (const value of values) {
        if (value !== undefined)
            return value;
    }
    return undefined;
}
function cleanUndefinedKeys(input) {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
function getRecordDealerId(record) {
    const raw = record.data;
    const directDealerId = normalize(raw?.dealerId);
    if (directDealerId)
        return directDealerId;
    const normalizedDealerId = normalize(raw?.data?.dealerId);
    if (normalizedDealerId)
        return normalizedDealerId;
    const glDealerId = normalize(raw?.glDealerId);
    if (glDealerId)
        return glDealerId;
    const allAccountsKey = Object.keys(raw?.allAccounts?.dealerAssetDocMap ?? {})[0];
    if (allAccountsKey)
        return normalize(allAccountsKey);
    const apSetupKey = Object.keys(raw?.apSetup?.dealerAssetDocMap ?? {})[0];
    if (apSetupKey)
        return normalize(apSetupKey);
    return normalize(record.key);
}
export async function idbFindBootstrapByDealerId(dealerId) {
    const normalizedDealerId = normalize(dealerId);
    if (!normalizedDealerId)
        return null;
    const all = await idbGetAllBootstraps();
    const candidates = all.filter((record) => getRecordDealerId(record) === normalizedDealerId);
    if (candidates.length === 0)
        return null;
    candidates.sort((a, b) => {
        const ta = normalize(a.savedAt);
        const tb = normalize(b.savedAt);
        return tb.localeCompare(ta);
    });
    return candidates[0] ?? null;
}
export async function idbMergeBootstrapData(key, partialData, meta) {
    const existing = await idbGetBootstrap(key);
    const next = {
        key,
        dealerName: meta?.dealerName ?? existing?.dealerName ?? key,
        envName: meta?.envName ?? existing?.envName ?? key,
        data: {
            ...(existing?.data ?? {}),
            ...partialData,
        },
        savedAt: new Date().toISOString(),
    };
    await idbSaveBootstrap(next);
    return next;
}
export function extractRawBootstrapSections(payload) {
    return cleanUndefinedKeys({
        apSetup: firstDefined(getNestedValue(payload, ["data", "apSetup"]), getNestedValue(payload, ["body", "data", "apSetup"]), getNestedValue(payload, ["apSetup"])),
        accountingSettings: firstDefined(getNestedValue(payload, ["data", "accountingSettings"]), getNestedValue(payload, ["body", "data", "accountingSettings"]), getNestedValue(payload, ["accountingSettings"])),
        allAccounts: firstDefined(getNestedValue(payload, ["data", "allAccounts"]), getNestedValue(payload, ["body", "data", "allAccounts"]), getNestedValue(payload, ["allAccounts"])),
        allJournals: firstDefined(getNestedValue(payload, ["data", "allJournals"]), getNestedValue(payload, ["body", "data", "allJournals"]), getNestedValue(payload, ["allJournals"])),
        arSetup: firstDefined(getNestedValue(payload, ["data", "arSetup"]), getNestedValue(payload, ["body", "data", "arSetup"]), getNestedValue(payload, ["arSetup"])),
        lookupAssetSupport: firstDefined(getNestedValue(payload, ["data", "lookupAssetSupport"]), getNestedValue(payload, ["body", "data", "lookupAssetSupport"]), getNestedValue(payload, ["lookupAssetSupport"])),
        glAccountDynamicKeys: firstDefined(getNestedValue(payload, ["data", "glAccountDynamicKeys"]), getNestedValue(payload, ["body", "data", "glAccountDynamicKeys"]), getNestedValue(payload, ["glAccountDynamicKeys"])),
        customField: firstDefined(getNestedValue(payload, ["data", "customField"]), getNestedValue(payload, ["body", "data", "customField"]), getNestedValue(payload, ["customField"])),
        salesChains: firstDefined(getNestedValue(payload, ["data", "salesChains"]), getNestedValue(payload, ["body", "data", "salesChains"]), getNestedValue(payload, ["salesChains"])),
    });
}
export function mergeBootstrapDataWithRawSections(extractedData, rawPayload) {
    const baseData = extractedData && typeof extractedData === "object" && !Array.isArray(extractedData)
        ? extractedData
        : {};
    const rawSections = rawPayload ? extractRawBootstrapSections(rawPayload) : {};
    return {
        ...baseData,
        ...rawSections,
    };
}
export async function idbSaveBootstrapWithRawSections(params) {
    const mergedData = mergeBootstrapDataWithRawSections(params.extractedData, params.rawPayload);
    const record = {
        key: params.key,
        dealerName: params.dealerName ?? params.key,
        envName: params.envName ?? params.key,
        data: mergedData,
        savedAt: params.savedAt ?? new Date().toISOString(),
    };
    await idbSaveBootstrap(record);
    return record;
}
