const STORAGE_KEY = "tekion-api-settings";
const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";
const DEFAULT_SETTINGS = {
    tapDuoApiToken: "",
    graphApiToken: "",
    storesCustomCaptureId: "",
    storesApiCaptureId: "",
};
function normalizeStringMap(input) {
    if (!input || typeof input !== "object")
        return {};
    const out = {};
    for (const [key, value] of Object.entries(input)) {
        if (typeof value === "string") {
            out[key] = value;
        }
    }
    return out;
}
function normalizeGlobalHeaders(input) {
    if (!Array.isArray(input))
        return [];
    return input
        .map((item) => {
        if (!item || typeof item !== "object")
            return null;
        const row = item;
        const key = typeof row.key === "string" ? row.key : "";
        const value = typeof row.value === "string" ? row.value : "";
        const enabled = typeof row.enabled === "boolean" ? row.enabled : true;
        if (!key.trim())
            return null;
        return {
            key,
            value,
            enabled,
        };
    })
        .filter((item) => Boolean(item));
}
function withDefaults(values) {
    return {
        ...DEFAULT_SETTINGS,
        ...values,
    };
}
function persistBundle(bundle) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            version: 5,
            values: bundle.values,
            savedAtByKey: bundle.savedAtByKey,
            updatedAt: bundle.updatedAt,
            globalHeaders: bundle.globalHeaders,
        }));
    }
    catch (error) {
        console.error("[SettingsService] Failed to persist bundle to localStorage", error);
    }
}
export function loadTekionApiSettingsBundle() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return {
                values: withDefaults({}),
                savedAtByKey: {},
                updatedAt: null,
                globalHeaders: [],
            };
        }
        const parsed = JSON.parse(raw);
        if (parsed &&
            typeof parsed === "object" &&
            "values" in parsed &&
            parsed.values &&
            typeof parsed.values === "object") {
            return {
                values: withDefaults(normalizeStringMap(parsed.values)),
                savedAtByKey: normalizeStringMap(parsed.savedAtByKey),
                updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
                globalHeaders: normalizeGlobalHeaders(parsed.globalHeaders),
            };
        }
        return {
            values: withDefaults(normalizeStringMap(parsed)),
            savedAtByKey: {},
            updatedAt: null,
            globalHeaders: [],
        };
    }
    catch {
        return {
            values: withDefaults({}),
            savedAtByKey: {},
            updatedAt: null,
            globalHeaders: [],
        };
    }
}
export function loadTekionApiSettings() {
    return loadTekionApiSettingsBundle().values;
}
export function loadGlobalHeaders() {
    return loadTekionApiSettingsBundle().globalHeaders;
}
export function saveTekionApiSettings(next) {
    const current = loadTekionApiSettingsBundle();
    const incoming = normalizeStringMap(next);
    const now = new Date().toISOString();
    const mergedValues = {
        ...current.values,
    };
    const nextSavedAtByKey = {
        ...current.savedAtByKey,
    };
    for (const [key, value] of Object.entries(incoming)) {
        mergedValues[key] = value;
        if (value.trim()) {
            nextSavedAtByKey[key] = now;
        }
        else {
            delete nextSavedAtByKey[key];
        }
    }
    const bundle = {
        values: withDefaults(mergedValues),
        savedAtByKey: nextSavedAtByKey,
        updatedAt: now,
        globalHeaders: current.globalHeaders,
    };
    persistBundle(bundle);
    return bundle.values;
}
export function saveGlobalHeaders(globalHeaders) {
    const current = loadTekionApiSettingsBundle();
    const now = new Date().toISOString();
    const bundle = {
        values: current.values,
        savedAtByKey: current.savedAtByKey,
        updatedAt: now,
        globalHeaders: normalizeGlobalHeaders(globalHeaders),
    };
    persistBundle(bundle);
    return bundle.globalHeaders;
}
export function clearGlobalHeaders() {
    saveGlobalHeaders([]);
}
export function clearTekionApiSetting(key) {
    const current = loadTekionApiSettingsBundle();
    const now = new Date().toISOString();
    const nextValues = {
        ...current.values,
        [key]: "",
    };
    const nextSavedAtByKey = {
        ...current.savedAtByKey,
    };
    delete nextSavedAtByKey[key];
    const bundle = {
        values: withDefaults(nextValues),
        savedAtByKey: nextSavedAtByKey,
        updatedAt: now,
        globalHeaders: current.globalHeaders,
    };
    persistBundle(bundle);
    return bundle.values;
}
export function clearTekionApiSettings() {
    try {
        const bundle = {
            values: withDefaults({}),
            savedAtByKey: {},
            updatedAt: new Date().toISOString(),
            globalHeaders: [],
        };
        persistBundle(bundle);
    }
    catch (error) {
        console.error("[SettingsService] Failed to clear API settings", error);
    }
}
export function getSelectedDealerProfileId() {
    try {
        return localStorage.getItem(SELECTED_DEALER_PROFILE_KEY);
    }
    catch (error) {
        console.error("[SettingsService] Failed to read selected dealer profile ID", error);
        return null;
    }
}
export function saveSelectedDealerProfileId(profileId) {
    try {
        localStorage.setItem(SELECTED_DEALER_PROFILE_KEY, profileId);
    }
    catch (error) {
        console.error("[SettingsService] Failed to save selected dealer profile ID", error);
    }
}
export function clearSelectedDealerProfileId() {
    try {
        localStorage.removeItem(SELECTED_DEALER_PROFILE_KEY);
    }
    catch (error) {
        console.error("[SettingsService] Failed to clear selected dealer profile ID", error);
    }
}
