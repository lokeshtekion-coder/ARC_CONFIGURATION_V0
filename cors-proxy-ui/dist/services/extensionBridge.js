import { saveTekionApiSettings } from "./tekionApiSettings";
import { saveTekionCapturedProfiles, loadTekionCapturedProfiles, } from "./tekionCapturedProfiles";
import { storeCapturedMapHeaders } from "./preprodMapApiService";
export const PAGE_SYNC_EVENT = "ARC_EXTENSION_SYNC_CAPTURE";
export const PAGE_REQUEST_EVENT = "ARC_EXTENSION_BRIDGE_REQUEST_LATEST";
export const PAGE_GET_RULES_EVENT = "ARC_EXTENSION_BRIDGE_GET_RULES";
export const PAGE_SAVE_RULES_EVENT = "ARC_EXTENSION_BRIDGE_SAVE_RULES";
export const PAGE_SYNC_RULES_EVENT = "ARC_EXTENSION_SYNC_RULES";
const DEFAULT_CUSTOM_EXPIRY_HOURS = 48;
const LOCAL_CAPTURE_STORAGE_KEY = "arc-extension-latest-capture";
const BROWSER_CAPTURE_STORAGE_KEY = "arc-extension-browser-capture";
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
/**
 * Validates and normalizes ISO timestamps. Rejects invalid strings ("hello", numbers, etc.)
 */
function normalizeIsoTimestamp(value) {
    if (typeof value !== "string" || !value.trim())
        return undefined;
    const time = new Date(value.trim()).getTime();
    return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}
/**
 * Header Normalizer: Lowercases header keys while preserving exact header values.
 */
export function normalizeHeaderMap(input) {
    if (!isRecord(input))
        return undefined;
    const out = {};
    for (const [key, value] of Object.entries(input)) {
        if (typeof value === "string") {
            const normKey = key.trim().toLowerCase();
            if (normKey) {
                out[normKey] = value.trim();
            }
        }
    }
    return Object.keys(out).length ? out : undefined;
}
/**
 * Strips query parameters from recorded URLs to avoid logging or persisting tokens.
 */
function sanitizeSourceUrl(rawUrl) {
    if (!rawUrl || typeof rawUrl !== "string")
        return undefined;
    try {
        const parsed = new URL(rawUrl.trim());
        return `${parsed.origin}${parsed.pathname}`;
    }
    catch {
        return rawUrl.split("?")[0].trim();
    }
}
export function decodeJwt(token) {
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
            exp,
            iat,
            expiresAt: exp ? new Date(exp * 1000).toISOString() : undefined,
            issuedAt: iat ? new Date(iat * 1000).toISOString() : undefined,
            isExpired: typeof exp === "number" ? Date.now() >= exp * 1000 : undefined,
            sub: typeof payload.sub === "string" ? payload.sub : undefined,
            email: typeof payload.email === "string" ? payload.email : undefined,
            aud: typeof payload.aud === "string" ? payload.aud : undefined,
            iss: typeof payload.iss === "string" ? payload.iss : undefined,
        };
    }
    catch {
        return undefined;
    }
}
function extractTokenFromHeaders(headers) {
    if (!headers)
        return undefined;
    const auth = headers["authorization"];
    if (auth && /^bearer\s+/i.test(auth)) {
        return auth.replace(/^bearer\s+/i, "").trim() || undefined;
    }
    const tapDuo = headers["tap-duo-api-token"]?.trim();
    if (tapDuo)
        return tapDuo;
    const tekionApiToken = headers["tekion-api-token"]?.trim();
    if (tekionApiToken)
        return tekionApiToken;
    return undefined;
}
function isExpiredByCapturedAt(capturedAt, expiryHours) {
    const ts = new Date(capturedAt).getTime();
    if (Number.isNaN(ts))
        return true;
    return Date.now() - ts > expiryHours * 60 * 60 * 1000;
}
export function isCustomCaptureExpired(input) {
    if (input.decodedToken?.isExpired === true) {
        return true;
    }
    if (typeof input.decodedToken?.exp === "number" &&
        Date.now() >= input.decodedToken.exp * 1000) {
        return true;
    }
    return isExpiredByCapturedAt(input.capturedAt, input.expiryHours);
}
export function hasExpiredCustomToken(capture) {
    if (!capture)
        return true;
    return isCustomCaptureExpired({
        capturedAt: capture.capturedAt,
        expiryHours: capture.expiryHours || DEFAULT_CUSTOM_EXPIRY_HOURS,
        token: capture.token,
        decodedToken: capture.decodedToken,
    });
}
function normalizeTekionProfiles(input) {
    if (!Array.isArray(input))
        return undefined;
    const profiles = input
        .map((item) => {
        if (!isRecord(item))
            return null;
        if (typeof item.id !== "string" || !item.id.trim())
            return null;
        const validCapturedAt = normalizeIsoTimestamp(item.capturedAt);
        if (!validCapturedAt)
            return null;
        const profileKey = typeof item.profileKey === "string" && item.profileKey.trim()
            ? item.profileKey.trim()
            : "";
        return {
            id: item.id.trim(),
            profileKey,
            capturedAt: validCapturedAt,
            sourceUrl: sanitizeSourceUrl(typeof item.sourceUrl === "string" ? item.sourceUrl : undefined),
            dealerId: typeof item.dealerId === "string" ? item.dealerId.trim() : undefined,
            tenantName: typeof item.tenantName === "string" ? item.tenantName.trim() : undefined,
            tekSiteId: typeof item.tekSiteId === "string" ? item.tekSiteId.trim() : undefined,
            roleId: typeof item.roleId === "string" ? item.roleId.trim() : undefined,
            applicationId: typeof item.applicationId === "string" ? item.applicationId.trim() : undefined,
            clientId: typeof item.clientId === "string" ? item.clientId.trim() : undefined,
            locale: typeof item.locale === "string" ? item.locale.trim() : undefined,
            token: typeof item.token === "string" ? item.token.trim() : undefined,
            decodedToken: isRecord(item.decodedToken)
                ? {
                    email: typeof item.decodedToken.email === "string" ? item.decodedToken.email : undefined,
                    originalTenantId: typeof item.decodedToken.originalTenantId === "string"
                        ? item.decodedToken.originalTenantId
                        : undefined,
                    exp: typeof item.decodedToken.exp === "number" ? item.decodedToken.exp : undefined,
                    iat: typeof item.decodedToken.iat === "number" ? item.decodedToken.iat : undefined,
                    expiresAt: normalizeIsoTimestamp(item.decodedToken.expiresAt),
                    issuedAt: normalizeIsoTimestamp(item.decodedToken.issuedAt),
                    isExpired: typeof item.decodedToken.isExpired === "boolean" ? item.decodedToken.isExpired : undefined,
                }
                : undefined,
            bootstrapHeaders: normalizeHeaderMap(item.bootstrapHeaders),
        };
    })
        .filter((item) => Boolean(item));
    return profiles.length ? profiles : undefined;
}
function normalizeCustomCaptures(input) {
    if (!isRecord(input))
        return undefined;
    const out = {};
    for (const [key, value] of Object.entries(input)) {
        if (!isRecord(value))
            continue;
        const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : key;
        const label = typeof value.label === "string" && value.label.trim() ? value.label.trim() : id;
        const pattern = typeof value.pattern === "string" ? value.pattern.trim() : "";
        const matchMode = value.matchMode === "exact" ? "exact" : "includes";
        const expiryHoursRaw = typeof value.expiryHours === "number"
            ? value.expiryHours
            : Number.parseInt(String(value.expiryHours ?? ""), 10);
        const expiryHours = Number.isFinite(expiryHoursRaw) && expiryHoursRaw > 0
            ? expiryHoursRaw
            : DEFAULT_CUSTOM_EXPIRY_HOURS;
        const matchedUrl = sanitizeSourceUrl(typeof value.matchedUrl === "string" ? value.matchedUrl : "") || "";
        const capturedAt = normalizeIsoTimestamp(value.capturedAt);
        const lastSeenAt = normalizeIsoTimestamp(value.lastSeenAt) || capturedAt;
        const headers = normalizeHeaderMap(value.headers) ?? {};
        if (!id || !pattern || !capturedAt)
            continue;
        const tokenFromValue = typeof value.token === "string" ? value.token.trim() : "";
        const token = tokenFromValue || extractTokenFromHeaders(headers);
        const decodedToken = isRecord(value.decodedToken)
            ? {
                exp: typeof value.decodedToken.exp === "number" ? value.decodedToken.exp : undefined,
                iat: typeof value.decodedToken.iat === "number" ? value.decodedToken.iat : undefined,
                expiresAt: normalizeIsoTimestamp(value.decodedToken.expiresAt),
                issuedAt: normalizeIsoTimestamp(value.decodedToken.issuedAt),
                isExpired: typeof value.decodedToken.isExpired === "boolean" ? value.decodedToken.isExpired : undefined,
                sub: typeof value.decodedToken.sub === "string" ? value.decodedToken.sub : undefined,
                email: typeof value.decodedToken.email === "string" ? value.decodedToken.email : undefined,
                aud: typeof value.decodedToken.aud === "string" ? value.decodedToken.aud : undefined,
                iss: typeof value.decodedToken.iss === "string" ? value.decodedToken.iss : undefined,
            }
            : token
                ? decodeJwt(token)
                : undefined;
        if (isCustomCaptureExpired({
            capturedAt,
            expiryHours,
            token: token || undefined,
            decodedToken,
        })) {
            continue;
        }
        out[key] = {
            id,
            label,
            pattern,
            matchMode,
            expiryHours,
            matchedUrl,
            capturedAt,
            lastSeenAt: lastSeenAt || capturedAt,
            token: token || undefined,
            decodedToken,
            headers,
        };
    }
    return Object.keys(out).length ? out : undefined;
}
export function normalizeCapture(input) {
    if (!isRecord(input))
        return null;
    const out = {};
    if (typeof input.graphApiToken === "string" && input.graphApiToken.trim()) {
        out.graphApiToken = input.graphApiToken.trim();
    }
    if (typeof input.graphExpiresAt === "number") {
        out.graphExpiresAt = input.graphExpiresAt;
    }
    if (typeof input.spfxRefreshToken === "string" && input.spfxRefreshToken.trim()) {
        out.spfxRefreshToken = input.spfxRefreshToken.trim();
    }
    if (typeof input.spfxRefreshTokenExpiresAt === "number") {
        out.spfxRefreshTokenExpiresAt = input.spfxRefreshTokenExpiresAt;
    }
    // Preserve SharePoint URL without query parameters if safe
    if (typeof input.sharepointWorkbookUrl === "string" && input.sharepointWorkbookUrl.trim()) {
        out.sharepointWorkbookUrl = input.sharepointWorkbookUrl.trim();
    }
    if (typeof input.tapDuoApiToken === "string" && input.tapDuoApiToken.trim()) {
        out.tapDuoApiToken = input.tapDuoApiToken.trim();
    }
    if (typeof input.slackToken === "string" && input.slackToken.trim()) {
        out.slackToken = input.slackToken.trim();
    }
    if (typeof input.slackDCookie === "string" && input.slackDCookie.trim()) {
        out.slackDCookie = input.slackDCookie.trim();
    }
    out.lastSlackSourceUrl = sanitizeSourceUrl(typeof input.lastSlackSourceUrl === "string" ? input.lastSlackSourceUrl : undefined);
    out.lastSlackCaptureAt = normalizeIsoTimestamp(input.lastSlackCaptureAt);
    // Pre-Prod MAP API
    if (typeof input.preprodMapToken === "string" && input.preprodMapToken.trim()) {
        out.preprodMapToken = input.preprodMapToken.trim();
    }
    out.preprodMapHeaders = normalizeHeaderMap(input.preprodMapHeaders);
    out.lastPreprodMapSourceUrl = sanitizeSourceUrl(typeof input.lastPreprodMapSourceUrl === "string" ? input.lastPreprodMapSourceUrl : undefined);
    out.lastPreprodMapCaptureAt = normalizeIsoTimestamp(input.lastPreprodMapCaptureAt);
    out.graphHeaders = normalizeHeaderMap(input.graphHeaders);
    out.tekionImplementationHeaders = normalizeHeaderMap(input.tekionImplementationHeaders);
    out.tekionBootstrapHeaders = normalizeHeaderMap(input.tekionBootstrapHeaders);
    out.tekionProdTechMotorsHeaders = normalizeHeaderMap(input.tekionProdTechMotorsHeaders);
    out.lastGraphSourceUrl = sanitizeSourceUrl(typeof input.lastGraphSourceUrl === "string" ? input.lastGraphSourceUrl : undefined);
    out.lastGraphCaptureAt = normalizeIsoTimestamp(input.lastGraphCaptureAt);
    out.lastTekionImplementationSourceUrl = sanitizeSourceUrl(typeof input.lastTekionImplementationSourceUrl === "string" ? input.lastTekionImplementationSourceUrl : undefined);
    out.lastTekionImplementationCaptureAt = normalizeIsoTimestamp(input.lastTekionImplementationCaptureAt);
    out.lastTekionBootstrapSourceUrl = sanitizeSourceUrl(typeof input.lastTekionBootstrapSourceUrl === "string" ? input.lastTekionBootstrapSourceUrl : undefined);
    out.lastTekionBootstrapCaptureAt = normalizeIsoTimestamp(input.lastTekionBootstrapCaptureAt);
    out.lastTekionProdTechMotorsSourceUrl = sanitizeSourceUrl(typeof input.lastTekionProdTechMotorsSourceUrl === "string" ? input.lastTekionProdTechMotorsSourceUrl : undefined);
    out.lastTekionProdTechMotorsCaptureAt = normalizeIsoTimestamp(input.lastTekionProdTechMotorsCaptureAt);
    out.tekionProfiles = normalizeTekionProfiles(input.tekionProfiles);
    out.customCaptures = normalizeCustomCaptures(input.customCaptures);
    return out;
}
/**
 * Robust identity resolution: avoids returning empty strings or "_" when fields are blank.
 */
function getProfileIdentity(profile) {
    if (profile.profileKey && profile.profileKey.trim()) {
        return profile.profileKey.trim();
    }
    const tenant = profile.tenantName?.trim() ?? "";
    const dealer = profile.dealerId?.trim() ?? "";
    if (tenant || dealer) {
        return `${tenant}_${dealer}`;
    }
    return profile.id;
}
/**
 * Merges newly captured Tekion Profiles into the canonical profile repository.
 * Resolves conflicts by comparing timestamps so older captures never overwrite newer ones.
 */
function mergeIncomingProfilesIntoCanonicalStore(newProfiles) {
    if (!newProfiles || newProfiles.length === 0)
        return;
    const existing = loadTekionCapturedProfiles();
    const profileMap = new Map();
    // Index existing canonical profiles
    for (const p of existing) {
        const key = getProfileIdentity(p);
        profileMap.set(key, p);
    }
    // Merge in incoming profiles
    for (const np of newProfiles) {
        const key = getProfileIdentity(np);
        const prev = profileMap.get(key);
        const incomingTime = new Date(np.capturedAt).getTime();
        const previousTime = prev ? new Date(prev.capturedAt).getTime() : -Infinity;
        const useIncoming = Number.isFinite(incomingTime) && incomingTime >= previousTime;
        const merged = {
            id: prev?.id || np.id,
            profileKey: key,
            capturedAt: useIncoming ? np.capturedAt : (prev?.capturedAt || np.capturedAt),
            sourceUrl: useIncoming ? (np.sourceUrl || prev?.sourceUrl) : (prev?.sourceUrl || np.sourceUrl),
            dealerId: useIncoming ? (np.dealerId || prev?.dealerId) : (prev?.dealerId || np.dealerId),
            tenantName: useIncoming ? (np.tenantName || prev?.tenantName) : (prev?.tenantName || np.tenantName),
            tekSiteId: useIncoming ? (np.tekSiteId || prev?.tekSiteId) : (prev?.tekSiteId || np.tekSiteId),
            roleId: useIncoming ? (np.roleId || prev?.roleId) : (prev?.roleId || np.roleId),
            applicationId: useIncoming ? (np.applicationId || prev?.applicationId) : (prev?.applicationId || np.applicationId),
            clientId: useIncoming ? (np.clientId || prev?.clientId) : (prev?.clientId || np.clientId),
            locale: useIncoming ? (np.locale || prev?.locale) : (prev?.locale || np.locale),
            token: useIncoming ? (np.token || prev?.token) : (prev?.token || np.token),
            decodedToken: useIncoming ? (np.decodedToken || prev?.decodedToken) : (prev?.decodedToken || np.decodedToken),
            bootstrapHeaders: useIncoming
                ? (np.bootstrapHeaders || prev?.bootstrapHeaders)
                : (prev?.bootstrapHeaders || np.bootstrapHeaders),
        };
        profileMap.set(key, merged);
    }
    saveTekionCapturedProfiles(Array.from(profileMap.values()));
}
export function loadLatestExtensionCapture() {
    try {
        const raw = localStorage.getItem(LOCAL_CAPTURE_STORAGE_KEY);
        if (!raw)
            return null;
        const normalized = normalizeCapture(JSON.parse(raw));
        if (normalized) {
            localStorage.setItem(LOCAL_CAPTURE_STORAGE_KEY, JSON.stringify(normalized));
        }
        return normalized;
    }
    catch {
        return null;
    }
}
/**
 * Normalizes all payload data before writing to localStorage and merging profiles.
 */
export function saveLatestExtensionCapture(capture) {
    const normalized = normalizeCapture(capture);
    if (!normalized)
        return;
    if (normalized.tekionProfiles && normalized.tekionProfiles.length > 0) {
        mergeIncomingProfilesIntoCanonicalStore(normalized.tekionProfiles);
    }
    // Auto-sync captured Pre-Prod MAP headers if present
    if (normalized.preprodMapHeaders && Object.keys(normalized.preprodMapHeaders).length > 0) {
        storeCapturedMapHeaders(normalized.preprodMapHeaders);
    }
    localStorage.setItem(LOCAL_CAPTURE_STORAGE_KEY, JSON.stringify(normalized));
}
export function syncExtensionCaptureToSettings(capture) {
    const nextSettings = {};
    const savedKeys = [];
    const tapDuoToken = capture.tapDuoApiToken?.trim() ||
        capture.tekionImplementationHeaders?.["tap-duo-api-token"]?.trim() ||
        capture.tekionBootstrapHeaders?.["tap-duo-api-token"]?.trim() ||
        "";
    if (tapDuoToken) {
        nextSettings.tapDuoApiToken = tapDuoToken;
        savedKeys.push("tapDuoApiToken");
    }
    if (capture.graphApiToken?.trim()) {
        nextSettings.graphApiToken = capture.graphApiToken.trim();
        savedKeys.push("graphApiToken");
    }
    if (savedKeys.length > 0) {
        saveTekionApiSettings(nextSettings);
    }
    saveLatestExtensionCapture(capture);
    return { savedKeys, capture };
}
export function requestLatestCaptureFromExtension() {
    window.postMessage({ type: PAGE_REQUEST_EVENT }, window.location.origin);
}
export function subscribeToExtensionCapture(onSync) {
    const handler = (event) => {
        if (event.source !== window)
            return;
        if (event.origin !== window.location.origin)
            return;
        if (event.data?.type !== PAGE_SYNC_EVENT)
            return;
        const capture = normalizeCapture(event.data.payload);
        if (!capture)
            return;
        const result = syncExtensionCaptureToSettings(capture);
        onSync(result);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
}
export function requestCustomRulesFromExtension() {
    window.postMessage({ type: PAGE_GET_RULES_EVENT }, window.location.origin);
}
export function saveCustomRulesToExtension(rules) {
    window.postMessage({ type: PAGE_SAVE_RULES_EVENT, payload: rules }, window.location.origin);
}
export function subscribeToExtensionRules(onSync) {
    const handler = (event) => {
        if (event.source !== window || event.origin !== window.location.origin)
            return;
        if (event.data?.type !== PAGE_SYNC_RULES_EVENT)
            return;
        const rules = Array.isArray(event.data.payload) ? event.data.payload : [];
        onSync(rules);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
}
function normalizeBrowserCaptureState(input) {
    if (!input || typeof input !== "object") {
        return {};
    }
    const raw = input;
    const normStr = (value) => typeof value === "string" ? value.trim() : undefined;
    return {
        graphApiToken: normStr(raw.graphApiToken),
        graphExpiresAt: typeof raw.graphExpiresAt === "number" ? raw.graphExpiresAt : undefined,
        spfxRefreshToken: normStr(raw.spfxRefreshToken),
        sharepointWorkbookUrl: normStr(raw.sharepointWorkbookUrl),
        tapDuoApiToken: normStr(raw.tapDuoApiToken),
        slackToken: normStr(raw.slackToken),
        slackDCookie: normStr(raw.slackDCookie),
        // Pre-Prod MAP Credentials
        preprodMapToken: normStr(raw.preprodMapToken),
        preprodMapHeaders: normalizeHeaderMap(raw.preprodMapHeaders),
        lastPreprodMapSourceUrl: normStr(raw.lastPreprodMapSourceUrl),
        lastPreprodMapCaptureAt: normalizeIsoTimestamp(raw.lastPreprodMapCaptureAt),
        graphHeaders: normalizeHeaderMap(raw.graphHeaders),
        tekionImplementationHeaders: normalizeHeaderMap(raw.tekionImplementationHeaders),
        tekionBootstrapHeaders: normalizeHeaderMap(raw.tekionBootstrapHeaders),
        tekionProdTechMotorsHeaders: normalizeHeaderMap(raw.tekionProdTechMotorsHeaders),
        lastGraphSourceUrl: sanitizeSourceUrl(typeof raw.lastGraphSourceUrl === "string" ? raw.lastGraphSourceUrl : undefined),
        lastTekionImplementationSourceUrl: sanitizeSourceUrl(typeof raw.lastTekionImplementationSourceUrl === "string" ? raw.lastTekionImplementationSourceUrl : undefined),
        lastTekionBootstrapSourceUrl: sanitizeSourceUrl(typeof raw.lastTekionBootstrapSourceUrl === "string" ? raw.lastTekionBootstrapSourceUrl : undefined),
        lastTekionProdTechMotorsSourceUrl: sanitizeSourceUrl(typeof raw.lastTekionProdTechMotorsSourceUrl === "string" ? raw.lastTekionProdTechMotorsSourceUrl : undefined),
        lastSlackSourceUrl: sanitizeSourceUrl(typeof raw.lastSlackSourceUrl === "string" ? raw.lastSlackSourceUrl : undefined),
        lastGraphCaptureAt: normalizeIsoTimestamp(raw.lastGraphCaptureAt),
        lastTekionImplementationCaptureAt: normalizeIsoTimestamp(raw.lastTekionImplementationCaptureAt),
        lastTekionBootstrapCaptureAt: normalizeIsoTimestamp(raw.lastTekionBootstrapCaptureAt),
        lastTekionProdTechMotorsCaptureAt: normalizeIsoTimestamp(raw.lastTekionProdTechMotorsCaptureAt),
        lastSlackCaptureAt: normalizeIsoTimestamp(raw.lastSlackCaptureAt),
    };
}
export function loadArcBrowserCapture() {
    try {
        const raw = localStorage.getItem(BROWSER_CAPTURE_STORAGE_KEY);
        if (!raw)
            return {};
        return normalizeBrowserCaptureState(JSON.parse(raw));
    }
    catch {
        return {};
    }
}
export function saveArcBrowserCapture(next) {
    const current = loadArcBrowserCapture();
    const normalizedNext = normalizeBrowserCaptureState(next);
    const merged = {
        ...current,
        ...normalizedNext,
    };
    // Auto-sync captured Pre-Prod MAP headers if present
    if (merged.preprodMapHeaders && Object.keys(merged.preprodMapHeaders).length > 0) {
        storeCapturedMapHeaders(merged.preprodMapHeaders);
    }
    localStorage.setItem(BROWSER_CAPTURE_STORAGE_KEY, JSON.stringify(merged));
    return merged;
}
