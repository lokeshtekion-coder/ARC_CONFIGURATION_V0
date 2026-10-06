import { extractBootstrapData, } from "../utils/bootstrapExtractor";
import { idbSaveBootstrapWithRawSections, } from "../utils/bootstrapDb";
const PROXY_URL = "http://localhost:4000/api/proxy";
const BOOTSTRAP_URL = "https://preprodapp.tekioncloud.com/api/accounting/u/configurable/bootstrap";
const VALIDATION_SAVE_URL = "http://localhost:4000/api/validation/save";
const BOOTSTRAP_ASSET_TYPES = [
    "apSetup",
    "accountingSettings",
    "allAccounts",
    "allJournals",
    "arSetup",
    "lookupAssetSupport",
    "glAccountDynamicKeys",
    "customField",
    "salesChains",
];
function normalize(value) {
    return String(value ?? "").trim();
}
function buildBootstrapRequestBody(dealerId) {
    return {
        requestInfo: BOOTSTRAP_ASSET_TYPES.map((assetType) => ({
            assetType,
            dealerMetaDataInfo: [{ dealerId }],
        })),
    };
}
async function requestBootstrap(dealerId, headers) {
    const response = await fetch(PROXY_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            url: BOOTSTRAP_URL,
            method: "POST",
            headers: {
                ...headers,
                "content-type": "application/json",
            },
            body: buildBootstrapRequestBody(dealerId),
            timeout: 60000,
        }),
    });
    if (!response.ok) {
        throw new Error(`Bootstrap proxy request failed with HTTP ${response.status}`);
    }
    const proxyJson = (await response.json());
    if ((proxyJson.status ?? 200) >= 400) {
        throw new Error(`Bootstrap request failed: ${proxyJson.status ?? ""} ${proxyJson.statusText ?? "Request failed"}`.trim());
    }
    return proxyJson.body ?? proxyJson.data ?? proxyJson;
}
async function saveBootstrapToServer(dealerId, bootstrap, timestamp) {
    const response = await fetch(VALIDATION_SAVE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            dealerId,
            bootstrap,
            timestamp: timestamp.replace(/[:.]/g, "-"),
        }),
    });
    if (!response.ok) {
        throw new Error(`Bootstrap server snapshot save failed with HTTP ${response.status}`);
    }
}
/**
 * Fetches complete accounting Bootstrap for one dealer and saves it:
 *
 * 1. Extracted GL/custom-field/journal data into IndexedDB.
 * 2. Approved raw Bootstrap sections into IndexedDB.
 * 3. Extracted result to the backend validation snapshot endpoint.
 *
 * The local IndexedDB save happens even if the backend snapshot save fails.
 * This keeps GLAM usable while still returning a server warning.
 */
export async function syncAccountingBootstrapForDealer(params) {
    const dealerId = normalize(params.dealerId);
    const dealerName = normalize(params.dealerName) || dealerId;
    if (!dealerId) {
        throw new Error("Cannot auto-sync Bootstrap: dealer ID is missing.");
    }
    if (Object.keys(params.headers).length === 0) {
        throw new Error("Cannot auto-sync Bootstrap: no selected Dealer Profile headers are available.");
    }
    const rawPayload = await requestBootstrap(dealerId, params.headers);
    const bootstrap = extractBootstrapData(rawPayload);
    const savedAt = new Date().toISOString();
    const localRecord = await idbSaveBootstrapWithRawSections({
        key: dealerId,
        dealerName,
        envName: dealerId,
        extractedData: bootstrap,
        rawPayload,
        savedAt,
    });
    let serverSaved = false;
    let serverWarning = null;
    try {
        await saveBootstrapToServer(dealerId, bootstrap, savedAt);
        serverSaved = true;
    }
    catch (error) {
        serverWarning =
            error instanceof Error
                ? error.message
                : "Bootstrap was saved locally, but backend snapshot save failed.";
    }
    return {
        dealerId,
        dealerName,
        bootstrap,
        localRecord,
        serverSaved,
        serverWarning,
        savedAt,
    };
}
