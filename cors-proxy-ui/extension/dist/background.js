const STORAGE_KEY = "arcLatestCaptureState";
const CUSTOM_RULES_STORAGE_KEY = "arcCustomWatchedApis";
const DEFAULT_CUSTOM_EXPIRY_HOURS = 48;
const LOCALHOST_APP_MATCHES = [
    "http://localhost:5174/*",
    "http://127.0.0.1:5174/*",
];
const REQUEST_FILTER = {
    urls: ["<all_urls>"],
};
const GRAPH_ALLOWED_INITIATORS = new Set([
    "https://webshell.suite.office.com",
]);
const DROP_TEKION_HEADERS = new Set([
    "accept-encoding",
    "accept-language",
    "cache-control",
    "connection",
    "content-length",
    "cookie",
    "host",
    "origin",
    "pragma",
    "priority",
    "referer",
    "user-agent",
]);
const DROP_CUSTOM_CAPTURE_HEADERS = new Set([
    "accept-encoding",
    "connection",
    "content-length",
    "cookie",
    "host",
]);
let cachedCustomRules = [];
function parseUrl(raw) {
    try {
        return new URL(raw);
    }
    catch {
        return null;
    }
}
function normalizeHeaders(headers) {
    const out = {};
    for (const header of headers ?? []) {
        const name = (header.name || "").trim().toLowerCase();
        const value = typeof header.value === "string" ? header.value.trim() : "";
        if (!name || !value)
            continue;
        out[name] = value;
    }
    return out;
}
function extractBearerToken(authHeader) {
    if (!authHeader)
        return "";
    const value = authHeader.trim();
    if (!/^bearer\s+/i.test(value))
        return "";
    return value.replace(/^bearer\s+/i, "").trim();
}
function getOrigin(value) {
    if (!value)
        return null;
    try {
        return new URL(value).origin;
    }
    catch {
        return null;
    }
}
function isAllowedGraphInitiator(details) {
    const origin = getOrigin(details.initiator);
    return origin ? GRAPH_ALLOWED_INITIATORS.has(origin) : false;
}
function isGraphPhotoRequest(rawUrl) {
    const url = parseUrl(rawUrl);
    return Boolean(url &&
        url.origin === "https://graph.microsoft.com" &&
        url.pathname === "/v1.0/users/tlreddy@tekion.com/photo/$value");
}
function isTekionImplementationRequest(rawUrl) {
    const url = parseUrl(rawUrl);
    return Boolean(url &&
        url.origin === "https://us-west1-tapapi.tekioncloud.com" &&
        url.pathname.startsWith("/tapapi/tap-crm-implementations-backend/public/v1/implementation-dealer-st"));
}
function isTekionBootstrapRequest(rawUrl) {
    const url = parseUrl(rawUrl);
    return Boolean(url &&
        url.origin === "https://preprodapp.tekioncloud.com" &&
        url.pathname === "/api/accounting/u/configurable/bootstrap");
}
function isTekionProdTechMotorsProfileRequest(rawUrl) {
    const url = parseUrl(rawUrl);
    return Boolean(url &&
        url.origin === "https://app.tekioncloud.com" &&
        url.pathname === "/api/userservice/u/employee/profile");
}
function detectCaptureKind(details) {
    if (isGraphPhotoRequest(details.url)) {
        return isAllowedGraphInitiator(details) ? "graph" : null;
    }
    if (isTekionImplementationRequest(details.url))
        return "tekionImplementation";
    if (isTekionBootstrapRequest(details.url))
        return "tekionBootstrap";
    if (isTekionProdTechMotorsProfileRequest(details.url))
        return "tekionProdTechMotors";
    return null;
}
function filterTekionHeaders(headers) {
    const out = {};
    for (const [key, value] of Object.entries(headers)) {
        const lower = key.toLowerCase();
        if (!value.trim())
            continue;
        if (DROP_TEKION_HEADERS.has(lower))
            continue;
        if (lower.startsWith("sec-"))
            continue;
        out[lower] = value;
    }
    return out;
}
function filterCustomCaptureHeaders(headers) {
    const out = {};
    for (const [key, value] of Object.entries(headers)) {
        const lower = key.toLowerCase();
        if (!value.trim())
            continue;
        if (DROP_CUSTOM_CAPTURE_HEADERS.has(lower))
            continue;
        if (lower.startsWith("sec-"))
            continue;
        out[lower] = value;
    }
    return out;
}
function sortHeaderMap(input) {
    if (!input)
        return undefined;
    const out = {};
    for (const key of Object.keys(input).sort())
        out[key] = input[key];
    return out;
}
function normalizeString(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}
function decodeJwt(token) {
    if (!token)
        return undefined;
    try {
        const parts = token.split(".");
        if (parts.length !== 3)
            return undefined;
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
        const payload = JSON.parse(atob(padded));
        const exp = typeof payload.exp === "number" ? payload.exp : undefined;
        const iat = typeof payload.iat === "number" ? payload.iat : undefined;
        return {
            email: typeof payload.email === "string" ? payload.email : undefined,
            originalTenantId: typeof payload.originalTenantId === "string"
                ? payload.originalTenantId
                : undefined,
            exp,
            iat,
            expiresAt: exp ? new Date(exp * 1000).toISOString() : undefined,
            issuedAt: iat ? new Date(iat * 1000).toISOString() : undefined,
            isExpired: typeof exp === "number" ? Date.now() >= exp * 1000 : undefined,
        };
    }
    catch {
        return undefined;
    }
}
function buildProfileKey(headers, decodedToken) {
    return [
        headers["tenantname"] || decodedToken?.originalTenantId || "",
        headers["dealerid"] || "",
        headers["tek-siteid"] || "",
        headers["roleid"] || "",
    ].join("::");
}
function normalizeProfiles(input) {
    if (!Array.isArray(input))
        return [];
    const out = [];
    for (const item of input) {
        if (!item || typeof item !== "object")
            continue;
        const raw = item;
        if (typeof raw.id !== "string" ||
            typeof raw.profileKey !== "string" ||
            typeof raw.capturedAt !== "string") {
            continue;
        }
        const profile = {
            id: raw.id,
            profileKey: raw.profileKey,
            capturedAt: raw.capturedAt,
            sourceUrl: normalizeString(raw.sourceUrl),
            dealerId: normalizeString(raw.dealerId),
            tenantName: normalizeString(raw.tenantName),
            tekSiteId: normalizeString(raw.tekSiteId),
            roleId: normalizeString(raw.roleId),
            applicationId: normalizeString(raw.applicationId),
            clientId: normalizeString(raw.clientId),
            locale: normalizeString(raw.locale),
            token: normalizeString(raw.token),
            decodedToken: raw.decodedToken && typeof raw.decodedToken === "object"
                ? raw.decodedToken
                : undefined,
            bootstrapHeaders: raw.bootstrapHeaders && typeof raw.bootstrapHeaders === "object"
                ? { ...raw.bootstrapHeaders }
                : {},
        };
        out.push(profile);
    }
    return out;
}
function upsertTekionProfile(current, headers, sourceUrl, capturedAt) {
    const token = normalizeString(headers["tekion-api-token"]);
    const decodedToken = decodeJwt(token);
    const profileKey = buildProfileKey(headers, decodedToken);
    if (!profileKey.replace(/:/g, "").trim()) {
        return normalizeProfiles(current.tekionProfiles);
    }
    const nextProfile = {
        id: profileKey,
        profileKey,
        capturedAt,
        sourceUrl,
        dealerId: normalizeString(headers["dealerid"]),
        tenantName: normalizeString(headers["tenantname"]),
        tekSiteId: normalizeString(headers["tek-siteid"]),
        roleId: normalizeString(headers["roleid"]),
        applicationId: normalizeString(headers["applicationid"]),
        clientId: normalizeString(headers["clientid"]),
        locale: normalizeString(headers["locale"]),
        token,
        decodedToken,
        bootstrapHeaders: { ...headers },
    };
    const profiles = normalizeProfiles(current.tekionProfiles);
    const existingIndex = profiles.findIndex((profile) => profile.profileKey === profileKey);
    if (existingIndex >= 0) {
        profiles[existingIndex] = {
            ...profiles[existingIndex],
            ...nextProfile,
            bootstrapHeaders: {
                ...profiles[existingIndex].bootstrapHeaders,
                ...nextProfile.bootstrapHeaders,
            },
        };
    }
    else {
        profiles.unshift(nextProfile);
    }
    profiles.sort((a, b) => {
        const at = new Date(a.capturedAt).getTime();
        const bt = new Date(b.capturedAt).getTime();
        return bt - at;
    });
    return profiles;
}
function isExpired(capturedAt, expiryHours) {
    const ts = new Date(capturedAt).getTime();
    if (Number.isNaN(ts))
        return true;
    return Date.now() - ts > expiryHours * 60 * 60 * 1000;
}
function pruneExpiredCustomCaptures(captures) {
    if (!captures)
        return undefined;
    const next = {};
    for (const [key, value] of Object.entries(captures)) {
        const expiryHours = typeof value.expiryHours === "number" && value.expiryHours > 0
            ? value.expiryHours
            : DEFAULT_CUSTOM_EXPIRY_HOURS;
        if (!isExpired(value.capturedAt, expiryHours)) {
            next[key] = value;
        }
    }
    return Object.keys(next).length > 0 ? next : undefined;
}
function comparableSnapshot(state) {
    const customCaptures = pruneExpiredCustomCaptures(state.customCaptures);
    return JSON.stringify({
        graphApiToken: state.graphApiToken ?? "",
        tapDuoApiToken: state.tapDuoApiToken ?? "",
        graphHeaders: sortHeaderMap(state.graphHeaders) ?? {},
        tekionImplementationHeaders: sortHeaderMap(state.tekionImplementationHeaders) ?? {},
        tekionBootstrapHeaders: sortHeaderMap(state.tekionBootstrapHeaders) ?? {},
        tekionProdTechMotorsHeaders: sortHeaderMap(state.tekionProdTechMotorsHeaders) ?? {},
        customCaptures: customCaptures
            ? Object.fromEntries(Object.entries(customCaptures).map(([key, value]) => [
                key,
                { ...value, headers: sortHeaderMap(value.headers) ?? {} },
            ]))
            : {},
        tekionProfiles: normalizeProfiles(state.tekionProfiles).map((profile) => ({
            id: profile.id,
            profileKey: profile.profileKey,
            capturedAt: profile.capturedAt,
            sourceUrl: profile.sourceUrl ?? "",
            dealerId: profile.dealerId ?? "",
            tenantName: profile.tenantName ?? "",
            tekSiteId: profile.tekSiteId ?? "",
            roleId: profile.roleId ?? "",
            applicationId: profile.applicationId ?? "",
            clientId: profile.clientId ?? "",
            locale: profile.locale ?? "",
            token: profile.token ?? "",
            bootstrapHeaders: sortHeaderMap(profile.bootstrapHeaders) ?? {},
        })),
    });
}
function getStorageValue(key) {
    return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
            resolve(result[key]);
        });
    });
}
function setStorageValue(key, value) {
    return new Promise((resolve, reject) => {
        chrome.storage.local.set({ [key]: value }, () => {
            const err = chrome.runtime.lastError;
            if (err) {
                reject(new Error(err.message));
                return;
            }
            resolve();
        });
    });
}
function queryLocalhostTabs() {
    return new Promise((resolve) => {
        chrome.tabs.query({ url: LOCALHOST_APP_MATCHES }, (tabs) => {
            resolve(tabs ?? []);
        });
    });
}
function sendMessageToTab(tabId, message) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, message, () => resolve());
    });
}
async function loadStoredState() {
    const state = (await getStorageValue(STORAGE_KEY)) ?? {};
    return {
        ...state,
        customCaptures: pruneExpiredCustomCaptures(state.customCaptures),
    };
}
async function persistState(state) {
    await setStorageValue(STORAGE_KEY, {
        ...state,
        customCaptures: pruneExpiredCustomCaptures(state.customCaptures),
    });
}
async function pushStateToLocalhostTabs(state) {
    const tabs = await queryLocalhostTabs();
    const message = { type: "ARC_PUSH_CAPTURE", payload: state };
    await Promise.allSettled(tabs
        .filter((tab) => typeof tab.id === "number")
        .map((tab) => sendMessageToTab(tab.id, message)));
}
function mergeCapture(current, kind, url, normalizedHeaders) {
    const now = new Date().toISOString();
    const next = { ...current };
    if (kind === "graph") {
        const token = extractBearerToken(normalizedHeaders["authorization"]);
        if (!token)
            return null;
        next.graphApiToken = token;
        next.graphHeaders = { authorization: `Bearer ${token}` };
        next.lastGraphSourceUrl = url;
        next.lastGraphCaptureAt = now;
        return next;
    }
    const filteredTekionHeaders = filterTekionHeaders(normalizedHeaders);
    const tapToken = (normalizedHeaders["tap-duo-api-token"] || "").trim();
    if (kind === "tekionImplementation") {
        if (!tapToken && Object.keys(filteredTekionHeaders).length === 0)
            return null;
        if (tapToken)
            next.tapDuoApiToken = tapToken;
        next.tekionImplementationHeaders = filteredTekionHeaders;
        next.lastTekionImplementationSourceUrl = url;
        next.lastTekionImplementationCaptureAt = now;
        return next;
    }
    if (kind === "tekionBootstrap") {
        if (!tapToken && Object.keys(filteredTekionHeaders).length === 0)
            return null;
        if (tapToken)
            next.tapDuoApiToken = tapToken;
        next.tekionBootstrapHeaders = filteredTekionHeaders;
        next.lastTekionBootstrapSourceUrl = url;
        next.lastTekionBootstrapCaptureAt = now;
        next.tekionProfiles = upsertTekionProfile(next, filteredTekionHeaders, url, now);
        return next;
    }
    if (kind === "tekionProdTechMotors") {
        if (Object.keys(filteredTekionHeaders).length === 0)
            return null;
        console.log("[ARC BG] PRODTechMOTORS profile request detected", {
            url,
            headerKeys: Object.keys(filteredTekionHeaders).sort(),
            dealerId: filteredTekionHeaders["dealerid"],
            tenantName: filteredTekionHeaders["tenantname"],
        });
        next.tekionProdTechMotorsHeaders = filteredTekionHeaders;
        next.lastTekionProdTechMotorsSourceUrl = url;
        next.lastTekionProdTechMotorsCaptureAt = now;
        return next;
    }
    return null;
}
function normalizeRuleList(input) {
    if (!Array.isArray(input))
        return [];
    return input
        .filter((item) => item && typeof item === "object")
        .map((item) => {
        const raw = item;
        const id = normalizeString(raw.id);
        const pattern = normalizeString(raw.pattern);
        const matchMode = raw.matchMode === "exact" ? "exact" : "includes";
        const label = normalizeString(raw.label) || pattern || "";
        const expiryHoursRaw = typeof raw.expiryHours === "number"
            ? raw.expiryHours
            : Number.parseInt(String(raw.expiryHours ?? ""), 10);
        const expiryHours = Number.isFinite(expiryHoursRaw) && expiryHoursRaw > 0
            ? expiryHoursRaw
            : DEFAULT_CUSTOM_EXPIRY_HOURS;
        const createdAt = normalizeString(raw.createdAt) || new Date().toISOString();
        if (!id || !pattern)
            return null;
        return {
            id,
            label,
            pattern,
            matchMode,
            expiryHours,
            createdAt,
        };
    })
        .filter((item) => Boolean(item));
}
function matchCustomRule(url) {
    const normalizedUrl = url.trim().toLowerCase();
    for (const rule of cachedCustomRules) {
        const pattern = rule.pattern.trim().toLowerCase();
        if (!pattern)
            continue;
        if (rule.matchMode === "exact") {
            if (normalizedUrl === pattern)
                return rule;
        }
        else {
            if (normalizedUrl.includes(pattern))
                return rule;
        }
    }
    return null;
}
function mergeCustomCapture(current, rule, url, normalizedHeaders) {
    const filteredHeaders = filterCustomCaptureHeaders(normalizedHeaders);
    const authToken = extractBearerToken(normalizedHeaders["authorization"]) ||
        normalizeString(normalizedHeaders["tekion-api-token"]) ||
        normalizeString(normalizedHeaders["tap-duo-api-token"]) ||
        undefined;
    if (Object.keys(filteredHeaders).length === 0 && !authToken) {
        return null;
    }
    const now = new Date().toISOString();
    console.log("[ARC BG] storing custom capture headers", {
        ruleId: rule.id,
        label: rule.label,
        matchedUrl: url,
        rawHeaderKeys: Object.keys(normalizedHeaders).sort(),
        filteredHeaderKeys: Object.keys(filteredHeaders).sort(),
        hasOrigin: Boolean(filteredHeaders["origin"]),
        hasReferer: Boolean(filteredHeaders["referer"]),
        hasUserAgent: Boolean(filteredHeaders["user-agent"]),
        hasAcceptLanguage: Boolean(filteredHeaders["accept-language"]),
        hasTapDuoToken: Boolean(filteredHeaders["tap-duo-api-token"]),
    });
    return {
        ...current,
        customCaptures: {
            ...(current.customCaptures ?? {}),
            [rule.id]: {
                id: rule.id,
                label: rule.label,
                pattern: rule.pattern,
                matchMode: rule.matchMode,
                expiryHours: rule.expiryHours,
                matchedUrl: url,
                capturedAt: current.customCaptures?.[rule.id]?.capturedAt || now,
                lastSeenAt: now,
                token: authToken,
                headers: filteredHeaders,
            },
        },
    };
}
async function cleanupExpiredCustomCapturesAndSync() {
    const current = await loadStoredState();
    const next = {
        ...current,
        customCaptures: pruneExpiredCustomCaptures(current.customCaptures),
    };
    if (comparableSnapshot(current) !== comparableSnapshot(next)) {
        await persistState(next);
        await pushStateToLocalhostTabs(next);
    }
}
async function handleBeforeSendHeaders(details) {
    const normalizedHeaders = normalizeHeaders(details.requestHeaders);
    const current = await loadStoredState();
    const kind = detectCaptureKind(details);
    let next = null;
    if (kind) {
        console.log("[ARC BG] matched known request", {
            kind,
            url: details.url,
            initiator: details.initiator,
        });
        next = mergeCapture(current, kind, details.url, normalizedHeaders);
    }
    else {
        const customRule = matchCustomRule(details.url);
        if (customRule) {
            console.log("[ARC BG] matched custom rule", {
                ruleId: customRule.id,
                label: customRule.label,
                pattern: customRule.pattern,
                matchMode: customRule.matchMode,
                url: details.url,
            });
            next = mergeCustomCapture(current, customRule, details.url, normalizedHeaders);
        }
    }
    if (!next)
        return;
    const before = comparableSnapshot(current);
    const after = comparableSnapshot(next);
    await persistState(next);
    if (before !== after) {
        console.log("[ARC BG] state changed, pushing to localhost tabs");
        await pushStateToLocalhostTabs(next);
    }
    else {
        console.log("[ARC BG] state unchanged");
    }
}
chrome.storage.local.get([CUSTOM_RULES_STORAGE_KEY], (result) => {
    cachedCustomRules = normalizeRuleList(result[CUSTOM_RULES_STORAGE_KEY]);
    console.log("[ARC BG] custom watch rules initialized", cachedCustomRules);
});
chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local")
        return;
    if (changes[CUSTOM_RULES_STORAGE_KEY]) {
        cachedCustomRules = normalizeRuleList(changes[CUSTOM_RULES_STORAGE_KEY].newValue);
        console.log("[ARC BG] custom watch rules updated", cachedCustomRules);
    }
});
chrome.webRequest.onBeforeSendHeaders.addListener((details) => {
    void handleBeforeSendHeaders(details);
    return undefined;
}, REQUEST_FILTER, ["requestHeaders", "extraHeaders"]);
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "ARC_GET_LATEST_CAPTURE") {
        void cleanupExpiredCustomCapturesAndSync().then(async () => {
            const state = await loadStoredState();
            console.log("[ARC BG] latest capture requested", state);
            sendResponse({ payload: state });
        });
        return true;
    }
    return false;
});
chrome.alarms.create("arc-custom-capture-cleanup", {
    periodInMinutes: 60,
});
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "arc-custom-capture-cleanup") {
        void cleanupExpiredCustomCapturesAndSync();
    }
});
export {};
