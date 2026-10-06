import { loadTekionApiSettingsBundle } from "./tekionApiSettings";
import { loadLatestExtensionCapture } from "./extensionBridge";
const FORMS_API_URL = "https://us-west1-tapapi-01.tekioncloud.com/dealer-onboarding/u/forms/responses";
const log = {
    info: (...args) => console.info("[storeOnboardingStatusApi]", ...args),
    debug: (...args) => console.debug("[storeOnboardingStatusApi]", ...args),
    warn: (...args) => console.warn("[storeOnboardingStatusApi]", ...args),
    error: (...args) => console.error("[storeOnboardingStatusApi]", ...args),
};
const DEFAULT_BLUEPRINT = {
    parts: "UNKNOWN",
    parts_last_released_time: "",
    service: "UNKNOWN",
    service_last_released_time: "",
    accounting: "UNKNOWN",
    accounting_last_released_time: "",
    crm: "UNKNOWN",
    crm_last_released_time: "",
    analytics: "UNKNOWN",
    analytics_last_released_time: "",
};
const DEFAULT_SIGNOFF = {
    parts: "UNKNOWN",
    parts_last_released_time: "",
    service: "UNKNOWN",
    service_last_released_time: "",
    accounting: "UNKNOWN",
    accounting_last_released_time: "",
};
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function cleanString(val) {
    return val.toLowerCase().replace(/[\s\-_–—]+/g, " ").trim();
}
function normalizeStatus(value) {
    const s = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");
    if (!s)
        return "UNKNOWN";
    if ([
        "COMPLETED",
        "COMPLETE",
        "DONE",
        "APPROVED",
        "RELEASED",
        "SIGNED_OFF",
        "SUCCESS",
    ].includes(s)) {
        return "COMPLETED";
    }
    if ([
        "IN_PROGRESS",
        "PROGRESS",
        "PENDING",
        "DRAFT",
        "STARTED",
        "SUBMITTED",
        "UNDER_REVIEW",
    ].includes(s)) {
        return "IN_PROGRESS";
    }
    if (["NOT_YET_STARTED", "NOT_STARTED", "NEW", "UNTOUCHED"].includes(s)) {
        return "NOT_YET_STARTED";
    }
    return "UNKNOWN";
}
function detectBlueprintKey(cleanedName) {
    if (!cleanedName.includes("blueprint"))
        return null;
    if (cleanedName.includes("parts"))
        return "parts";
    if (cleanedName.includes("service"))
        return "service";
    if (cleanedName.includes("accounting"))
        return "accounting";
    if (cleanedName.includes("crm"))
        return "crm";
    if (cleanedName.includes("analytics"))
        return "analytics";
    return null;
}
function detectSignoffKey(cleanedName) {
    const isSignoff = cleanedName.includes("sign off") ||
        cleanedName.includes("signoff") ||
        cleanedName.includes("operational");
    if (!isSignoff)
        return null;
    if (cleanedName.includes("parts"))
        return "parts";
    if (cleanedName.includes("service"))
        return "service";
    if (cleanedName.includes("accounting"))
        return "accounting";
    return null;
}
function getLatestTimestamp(timestamps) {
    const valid = timestamps.map((t) => String(t ?? "").trim()).filter(Boolean);
    if (valid.length === 0)
        return "";
    valid.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    return valid[0];
}
function resolveModuleStatus(items) {
    if (items.length === 0)
        return { status: "UNKNOWN", time: "" };
    const completedItems = items.filter((i) => i.status === "COMPLETED");
    if (completedItems.length > 0) {
        return {
            status: "COMPLETED",
            time: getLatestTimestamp(completedItems.map((i) => i.time)),
        };
    }
    const inProgressItems = items.filter((i) => i.status === "IN_PROGRESS");
    if (inProgressItems.length > 0) {
        return {
            status: "IN_PROGRESS",
            time: getLatestTimestamp(inProgressItems.map((i) => i.time)),
        };
    }
    if (items.every((i) => i.status === "NOT_YET_STARTED")) {
        return { status: "NOT_YET_STARTED", time: "" };
    }
    return { status: "UNKNOWN", time: "" };
}
function maskHeadersForLog(headers) {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => {
        const lower = key.toLowerCase();
        if (lower.includes("token") || lower === "authorization" || lower === "cookie") {
            return [key, `present(${value.length})`];
        }
        return [key, value];
    }));
}
function resolveDynamicHeaders() {
    const bundle = loadTekionApiSettingsBundle();
    const latestCapture = loadLatestExtensionCapture();
    const customCaptures = latestCapture?.customCaptures ?? {};
    let selectedCapture;
    if (bundle.values?.storesApiCaptureId && customCaptures[bundle.values.storesApiCaptureId]) {
        selectedCapture = customCaptures[bundle.values.storesApiCaptureId];
    }
    if (!selectedCapture &&
        bundle.values?.storesCustomCaptureId &&
        customCaptures[bundle.values.storesCustomCaptureId]) {
        selectedCapture = customCaptures[bundle.values.storesCustomCaptureId];
    }
    if (!selectedCapture) {
        const list = Object.values(customCaptures);
        selectedCapture = list.find((c) => {
            const p = (c.pattern || "").toLowerCase();
            const m = (c.matchedUrl || "").toLowerCase();
            const l = (c.label || "").toLowerCase();
            return (p.includes("tapapi") ||
                m.includes("tapapi") ||
                l.includes("stores") ||
                l.includes("tap"));
        });
    }
    const baseHeaders = {
        accept: "application/json, text/plain, */*",
        "content-type": "application/json",
        origin: "https://tap.tekioncloud.com",
        referer: "https://tap.tekioncloud.com/",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    };
    if (selectedCapture?.headers && Object.keys(selectedCapture.headers).length > 0) {
        for (const [key, value] of Object.entries(selectedCapture.headers)) {
            const lower = key.toLowerCase().trim();
            const val = String(value ?? "").trim();
            if (!val || ["host", "connection", "content-length"].includes(lower)) {
                continue;
            }
            baseHeaders[lower] = val;
        }
    }
    else if (latestCapture?.tekionImplementationHeaders) {
        for (const [key, value] of Object.entries(latestCapture.tekionImplementationHeaders)) {
            const lower = key.toLowerCase().trim();
            const val = String(value ?? "").trim();
            if (!val || ["host", "connection", "content-length"].includes(lower)) {
                continue;
            }
            baseHeaders[lower] = val;
        }
    }
    if (Array.isArray(bundle.globalHeaders)) {
        for (const pair of bundle.globalHeaders) {
            if (pair.enabled && pair.key && pair.value) {
                baseHeaders[pair.key.toLowerCase().trim()] = pair.value.trim();
            }
        }
    }
    const tapToken = baseHeaders["tap-duo-api-token"] ||
        selectedCapture?.headers?.["tap-duo-api-token"] ||
        selectedCapture?.token ||
        bundle.values?.tapDuoApiToken?.trim() ||
        latestCapture?.tapDuoApiToken?.trim();
    if (tapToken) {
        baseHeaders["tap-duo-api-token"] = tapToken;
    }
    if (!baseHeaders["tap-duo-api-token"] && !baseHeaders.authorization) {
        log.error("No valid auth header found for onboarding status API");
        throw new Error("No valid tap-duo-api-token or authorization header found in Stores Dashboard captures or settings. Please select an active Stores capture in Settings.");
    }
    log.info("Resolved onboarding status headers", {
        selectedCapture: selectedCapture
            ? {
                id: selectedCapture.id,
                label: selectedCapture.label,
                pattern: selectedCapture.pattern,
                matchedUrl: selectedCapture.matchedUrl,
                expiresAt: selectedCapture.decodedToken?.expiresAt,
                isExpired: selectedCapture.decodedToken?.isExpired,
            }
            : null,
        headerKeys: Object.keys(baseHeaders).sort(),
        headersPreview: maskHeadersForLog(baseHeaders),
    });
    return baseHeaders;
}
function chunkArray(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
        chunks.push(items.slice(i, i + size));
    }
    return chunks;
}
async function fetchBatch(tekionIds, headers) {
    const payload = {
        sort: [{ field: "dealerName.keyword", order: "ASC" }],
        filters: [
            {
                field: "tekionId.keyword",
                operator: "IN",
                values: tekionIds,
                key: "tekionId.keyword",
            },
        ],
        groupBy: [],
        includeFields: [
            "tekionId",
            "formName",
            "status",
            "permission",
            "lastReleasedTime",
        ],
        searchableFields: [],
        excludeFields: [],
        pageInfo: {
            start: 0,
            rows: 9999,
        },
    };
    log.info("Fetching onboarding batch", {
        tekionIdsCount: tekionIds.length,
        sampleTekionIds: tekionIds.slice(0, 10),
        payload,
    });
    const requestBody = {
        url: FORMS_API_URL,
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    };
    const res = await fetch("http://localhost:4000/api/proxy", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
    });
    log.info("Received onboarding batch proxy response", {
        responseStatus: res.status,
        responseStatusText: res.statusText,
        tekionIdsCount: tekionIds.length,
    });
    const proxyData = (await res.json());
    log.info("Parsed onboarding batch proxy wrapper", {
        upstreamStatus: proxyData.status,
        upstreamStatusText: proxyData.statusText,
        bodyType: typeof proxyData.body,
    });
    if (!res.ok) {
        log.error("Onboarding batch proxy failed", {
            responseStatus: res.status,
            proxyData,
        });
        throw new Error(String(proxyData.error ?? `HTTP ${res.status}`));
    }
    const body = typeof proxyData.body === "string"
        ? JSON.parse(proxyData.body)
        : proxyData.body;
    const hits = isRecord(body) &&
        isRecord(body.data) &&
        Array.isArray(body.data.hits)
        ? body.data.hits
        : [];
    log.info("Parsed onboarding batch upstream body", {
        bodyKeys: isRecord(body) ? Object.keys(body) : [],
        hasData: isRecord(body) && isRecord(body.data),
        hitsLength: hits.length,
    });
    if (isRecord(body) && typeof body.status === "number" && body.status !== 200 && !isRecord(body.data)) {
        log.warn("Tekion onboarding API returned non-200 warning body", body);
    }
    log.info("Extracted onboarding batch hits", {
        tekionIdsCount: tekionIds.length,
        hitsCount: hits.length,
        sampleHits: hits.slice(0, 3),
    });
    return hits;
}
async function runWithConcurrency(items, worker, concurrency) {
    const results = new Array(items.length);
    let currentIndex = 0;
    async function runner() {
        while (true) {
            const index = currentIndex;
            currentIndex += 1;
            if (index >= items.length)
                return;
            results[index] = await worker(items[index]);
        }
    }
    const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => runner());
    await Promise.all(runners);
    return results;
}
function deriveStatusesFromHits(hits) {
    const blueprint = { ...DEFAULT_BLUEPRINT };
    const signoff = { ...DEFAULT_SIGNOFF };
    const bpGroups = {
        parts: [],
        service: [],
        accounting: [],
        crm: [],
        analytics: [],
    };
    const soGroups = {
        parts: [],
        service: [],
        accounting: [],
    };
    for (const hit of hits) {
        const rawFormName = String(hit.formName ?? "").trim();
        if (!rawFormName)
            continue;
        const cleaned = cleanString(rawFormName);
        const normalized = normalizeStatus(hit.status);
        const releaseTime = hit.lastReleasedTime ? String(hit.lastReleasedTime) : "";
        const item = {
            status: normalized,
            time: releaseTime,
            permission: hit.permission,
        };
        const bpKey = detectBlueprintKey(cleaned);
        if (bpKey) {
            bpGroups[bpKey].push(item);
            continue;
        }
        const soKey = detectSignoffKey(cleaned);
        if (soKey) {
            soGroups[soKey].push(item);
        }
    }
    Object.keys(bpGroups).forEach((key) => {
        const group = bpGroups[key];
        if (group.length > 0) {
            const resolved = resolveModuleStatus(group);
            blueprint[key] = resolved.status;
            blueprint[`${key}_last_released_time`] =
                resolved.time;
        }
    });
    Object.keys(soGroups).forEach((key) => {
        const group = soGroups[key];
        if (group.length > 0) {
            const resolved = resolveModuleStatus(group);
            signoff[key] = resolved.status;
            signoff[`${key}_last_released_time`] =
                resolved.time;
        }
    });
    return {
        blueprint_statuses: blueprint,
        signoff_statuses: signoff,
    };
}
export async function fetchStoreOnboardingStatuses(tekionIds, options) {
    const uniqueTekionIds = Array.from(new Set(tekionIds.map((x) => String(x).trim()).filter(Boolean)));
    log.info("Starting onboarding status fetch", {
        requestedTekionIdsCount: tekionIds.length,
        uniqueTekionIdsCount: uniqueTekionIds.length,
        sampleTekionIds: uniqueTekionIds.slice(0, 15),
        options,
    });
    const result = {};
    if (uniqueTekionIds.length === 0) {
        log.warn("No Tekion IDs supplied for onboarding status fetch");
        return result;
    }
    for (const tekionId of uniqueTekionIds) {
        result[tekionId] = {
            blueprint_statuses: { ...DEFAULT_BLUEPRINT },
            signoff_statuses: { ...DEFAULT_SIGNOFF },
        };
    }
    const headers = resolveDynamicHeaders();
    const chunkSize = options?.chunkSize ?? 25;
    const concurrency = options?.concurrency ?? 3;
    const chunks = chunkArray(uniqueTekionIds, chunkSize);
    log.info("Prepared onboarding status batches", {
        chunkSize,
        concurrency,
        batchCount: chunks.length,
        batchSizes: chunks.map((chunk) => chunk.length),
    });
    const batchResults = await runWithConcurrency(chunks, async (chunk) => fetchBatch(chunk, headers), concurrency);
    const allHits = batchResults.flat();
    if (allHits.length > 0) {
        log.info("✅ Successfully downloaded detailed onboarding records", {
            totalHitCount: allHits.length,
        });
    }
    else {
        log.warn("⚠️ 0 onboarding status records found");
    }
    const hitsByTekionId = new Map();
    for (const hit of allHits) {
        const tekionId = String(hit.tekionId ?? "").trim();
        if (!tekionId)
            continue;
        if (!hitsByTekionId.has(tekionId)) {
            hitsByTekionId.set(tekionId, []);
        }
        hitsByTekionId.get(tekionId)?.push(hit);
    }
    log.info("Grouped onboarding hits by Tekion ID", {
        groupedTekionIdCount: hitsByTekionId.size,
    });
    for (const tekionId of uniqueTekionIds) {
        const hits = hitsByTekionId.get(tekionId) ?? [];
        result[tekionId] = deriveStatusesFromHits(hits);
    }
    log.info("Derived onboarding statuses complete", {
        finalStoreCount: Object.keys(result).length,
        sample: Object.entries(result)
            .slice(0, 3)
            .map(([tekionId, value]) => ({
            tekionId,
            blueprint: value.blueprint_statuses,
            signoff: value.signoff_statuses,
        })),
    });
    return result;
}
