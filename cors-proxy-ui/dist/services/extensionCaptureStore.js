const STORAGE_KEY = "arc-extension-browser-capture";
function normalizeString(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
}
function normalizeHeaderMap(input) {
    if (!input || typeof input !== "object" || Array.isArray(input))
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
function normalizeCaptureState(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        return {};
    }
    const raw = input;
    return {
        graphApiToken: normalizeString(raw.graphApiToken),
        graphExpiresAt: typeof raw.graphExpiresAt === "number" ? raw.graphExpiresAt : undefined,
        spfxRefreshToken: normalizeString(raw.spfxRefreshToken),
        sharepointWorkbookUrl: normalizeString(raw.sharepointWorkbookUrl),
        tapDuoApiToken: normalizeString(raw.tapDuoApiToken),
        slackToken: normalizeString(raw.slackToken),
        slackDCookie: normalizeString(raw.slackDCookie),
        // Pre-Prod MAP
        preprodMapToken: normalizeString(raw.preprodMapToken),
        preprodMapHeaders: normalizeHeaderMap(raw.preprodMapHeaders),
        lastPreprodMapSourceUrl: normalizeString(raw.lastPreprodMapSourceUrl),
        lastPreprodMapCaptureAt: normalizeString(raw.lastPreprodMapCaptureAt),
        graphHeaders: normalizeHeaderMap(raw.graphHeaders),
        tekionImplementationHeaders: normalizeHeaderMap(raw.tekionImplementationHeaders),
        tekionBootstrapHeaders: normalizeHeaderMap(raw.tekionBootstrapHeaders),
        tekionProdTechMotorsHeaders: normalizeHeaderMap(raw.tekionProdTechMotorsHeaders),
        lastGraphSourceUrl: normalizeString(raw.lastGraphSourceUrl),
        lastTekionImplementationSourceUrl: normalizeString(raw.lastTekionImplementationSourceUrl),
        lastTekionBootstrapSourceUrl: normalizeString(raw.lastTekionBootstrapSourceUrl),
        lastTekionProdTechMotorsSourceUrl: normalizeString(raw.lastTekionProdTechMotorsSourceUrl),
        lastSlackSourceUrl: normalizeString(raw.lastSlackSourceUrl),
        lastGraphCaptureAt: normalizeString(raw.lastGraphCaptureAt),
        lastTekionImplementationCaptureAt: normalizeString(raw.lastTekionImplementationCaptureAt),
        lastTekionBootstrapCaptureAt: normalizeString(raw.lastTekionBootstrapCaptureAt),
        lastTekionProdTechMotorsCaptureAt: normalizeString(raw.lastTekionProdTechMotorsCaptureAt),
        lastSlackCaptureAt: normalizeString(raw.lastSlackCaptureAt),
    };
}
export function loadArcBrowserCapture() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return {};
        return normalizeCaptureState(JSON.parse(raw));
    }
    catch {
        return {};
    }
}
export function saveArcBrowserCapture(next) {
    const current = loadArcBrowserCapture();
    const normalizedNext = normalizeCaptureState(next);
    const merged = {
        ...current,
        ...normalizedNext,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
}
