const log = {
    info: (...args) => console.info("[storeSetupDataService]", ...args),
    warn: (...args) => console.warn("[storeSetupDataService]", ...args),
    error: (...args) => console.error("[storeSetupDataService]", ...args),
};
export function hasSetupData(record) {
    return Boolean(record.setup_data && record.setup_data.fetchedAt);
}
/**
 * Normalizes raw backend error JSON strings into clean, concise messages
 * suitable for table badges, Excel cells, and Slack alert text.
 */
export function sanitizeSetupError(rawError) {
    let err = String(rawError || "").trim();
    // Strip leading "Error: " wrapper prefix
    err = err.replace(/^Error:\s*/i, "");
    // 1. Identify specific Token / Authentication issues
    if (err.includes("Login174") || err.includes("unauthorized.request.error")) {
        return "Unauthorized (Login174)";
    }
    if (err.includes("API3_GENERATE_TOKEN")) {
        return "Token Generation Failed (403)";
    }
    // 2. Identify Dealer Master status issues
    if (err.includes("Dealer has been disabled") || err.includes("invalid Dealer")) {
        return "Disabled Dealer (Inactive in Master)";
    }
    if (err.includes("No dealer properties returned")) {
        return "Unprovisioned (No Master Properties Found)";
    }
    // 3. Extract nested displayMessage or message if JSON payload is present
    const displayMsgMatch = err.match(/"displayMessage"\s*:\s*"([^"]+)"/i);
    if (displayMsgMatch?.[1]) {
        return displayMsgMatch[1].trim();
    }
    const msgMatch = err.match(/"message"\s*:\s*"([^"]+)"/i);
    if (msgMatch?.[1]) {
        return msgMatch[1].trim();
    }
    // 4. Standard HTTP status patterns
    if (err.includes("401") || err.includes("Unauthorized")) {
        return "Unauthorized (Dealer Access Blocked)";
    }
    if (err.includes("403") || err.includes("Forbidden")) {
        return "Forbidden (Insufficient Permissions)";
    }
    if (err.includes("404") || err.includes("Not Found")) {
        return "Dealer Not Found in Pre-Prod";
    }
    if (err.includes("timeout") || err.includes("ETIMEDOUT") || err.includes("504")) {
        return "Request Timed Out";
    }
    if (err.includes("500") || err.includes("Internal Server Error")) {
        return "Server Error (500)";
    }
    // Fallback for long or nested responses: trim cleanly
    return err.length > 32 ? `${err.slice(0, 32)}…` : err;
}
/**
 * Setup data is "complete" only when EVERY part was fetched with a value:
 * OEM dealer codes, Journals, Sales Chains and COA. If even one is blank/zero,
 * the dealer must be included in the next fetch.
 */
export function isSetupDataComplete(record) {
    const d = record.setup_data;
    if (!d || !d.fetchedAt)
        return false;
    return ((d.oemDealerCodes?.length ?? 0) > 0 &&
        (d.journalsAccessibleDealerCount ?? 0) > 0 &&
        (d.salesChainsAccessibleDealerCount ?? 0) > 0 &&
        (d.coaAccessibleDealerCount ?? 0) > 0);
}
/** Never let a blank/zero new value erase a previously fetched good value. */
export function mergeSetupData(prev, next) {
    if (!prev)
        return next;
    const pick = (n, p) => ((n ?? 0) > 0 ? n : p ?? n ?? 0);
    return {
        ...prev,
        ...next,
        oemDealerCodes: next.oemDealerCodes?.length ? next.oemDealerCodes : prev.oemDealerCodes ?? [],
        journalsAccessibleDealerCount: pick(next.journalsAccessibleDealerCount, prev.journalsAccessibleDealerCount),
        salesChainsAccessibleDealerCount: pick(next.salesChainsAccessibleDealerCount, prev.salesChainsAccessibleDealerCount),
        coaAccessibleDealerCount: pick(next.coaAccessibleDealerCount, prev.coaAccessibleDealerCount),
    };
}
export async function fetchSetupDataForStore(store, options = {}) {
    if (!options.force && isSetupDataComplete(store) && store.setup_data) {
        log.info("Setup data already complete - skipping", {
            dealerId: store.dealer_id,
            tekionId: store.tekion_id,
            fetchedAt: store.setup_data.fetchedAt,
        });
        return store.setup_data;
    }
    log.info("Calling setup route", {
        dealerId: store.dealer_id,
        tekionId: store.tekion_id,
        tenant: store.tenant_code,
        env: "preprod",
        force: Boolean(options.force),
    });
    let res;
    try {
        res = await fetch("http://localhost:4000/api/stores/setup", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                dealerId: store.dealer_id,
                tenant: store.tenant_code,
                env: "preprod",
            }),
        });
    }
    catch (netErr) {
        const message = netErr instanceof Error ? netErr.message : "Network failure";
        throw new Error(sanitizeSetupError(message));
    }
    log.info("Setup route HTTP response", {
        status: res.status,
        statusText: res.statusText,
        dealerId: store.dealer_id,
        tekionId: store.tekion_id,
    });
    const json = (await res.json().catch(() => ({})));
    if (!res.ok || !json.ok || !json.setupData) {
        const rawError = json.error || `HTTP ${res.status}: Failed to fetch setup data`;
        const cleanError = sanitizeSetupError(rawError);
        log.error("Setup route failed", {
            dealerId: store.dealer_id,
            tekionId: store.tekion_id,
            cleanError,
            rawError,
        });
        throw new Error(cleanError);
    }
    log.info("Setup route success", {
        dealerId: store.dealer_id,
        tekionId: store.tekion_id,
        oemDealerCodesCount: json.setupData.oemDealerCodes?.length ?? 0,
        journals: json.setupData.journalsAccessibleDealerCount,
        salesChains: json.setupData.salesChainsAccessibleDealerCount,
        coa: json.setupData.coaAccessibleDealerCount,
    });
    return mergeSetupData(store.setup_data, json.setupData);
}
