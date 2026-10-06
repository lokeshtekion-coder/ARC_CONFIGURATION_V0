import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useMemo } from "react";
import { loadTekionApiSettingsBundle } from "../../../../services/tekionApiSettings";
import { loadTekionCapturedProfiles } from "../../../../services/tekionCapturedProfiles";
import "./VoidPartsReasonsView.css";
const TARGET_REASON_CODE = "Customer Cancelled - with Lost Sale";
const TARGET_REASON_ID = "23";
const DEFAULT_ENDPOINT = "/api/parts/proxy/u/settings/void-reason";
const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";
const PROXY_URL = "http://127.0.0.1:4000/api/proxy";
// Required default reasons configuration
const REQUIRED_REASONS = [
    {
        reasonCode: "Customer Cancelled",
        type: "SALES_ORDER",
        countInLostSale: false,
    },
    {
        reasonCode: "Customer Cancelled - with Lost Sale",
        type: "SALES_ORDER",
        countInLostSale: true,
    },
    {
        reasonCode: "Part No Longer Available",
        type: "SALES_ORDER",
        countInLostSale: false,
    },
    {
        reasonCode: "Invoice Not Needed",
        type: "SALES_ORDER",
        countInLostSale: false,
    },
    {
        reasonCode: "Incorrect Credit",
        type: "RETURN",
        countInLostSale: false,
    },
];
const logger = {
    debug: (...args) => console.debug("[Parts][VoidPartsReasons]", ...args),
    info: (...args) => console.info("[Parts][VoidPartsReasons]", ...args),
    warn: (...args) => console.warn("[Parts][VoidPartsReasons]", ...args),
    error: (...args) => console.error("[Parts][VoidPartsReasons]", ...args),
};
/**
 * Resolves target base URL and headers from the active dealer profile,
 * falling back to global settings.
 */
function resolveActiveContext() {
    const storedProfileId = localStorage.getItem(SELECTED_DEALER_PROFILE_KEY);
    const profiles = loadTekionCapturedProfiles();
    const activeProfile = profiles.find((p) => p.id === storedProfileId || p.profileKey === storedProfileId || p.dealerId === storedProfileId);
    const bundle = loadTekionApiSettingsBundle();
    const resolvedHeaders = {};
    // 1. Load global headers as base
    (bundle.globalHeaders ?? []).forEach((h) => {
        if (h.enabled && h.key.trim() && String(h.value).trim()) {
            resolvedHeaders[h.key.trim().toLowerCase()] = String(h.value).trim();
        }
    });
    // 2. Overlay dealer-specific headers from canonical profile
    if (activeProfile?.bootstrapHeaders) {
        Object.entries(activeProfile.bootstrapHeaders).forEach(([k, v]) => {
            if (k.trim() && typeof v === "string" && v.trim()) {
                resolvedHeaders[k.trim().toLowerCase()] = v.trim();
            }
        });
    }
    // Ensure authorization token is aligned
    if (activeProfile?.token) {
        resolvedHeaders["tekion-api-token"] = activeProfile.token;
        resolvedHeaders["authorization"] = `Bearer ${activeProfile.token}`;
    }
    // 3. Resolve host
    let host = "https://preprodapp.tekioncloud.com";
    if (activeProfile?.sourceUrl) {
        try {
            const parsed = new URL(activeProfile.sourceUrl);
            host = parsed.origin;
        }
        catch {
            // keep fallback
        }
    }
    const baseUrl = `${host}${DEFAULT_ENDPOINT}`;
    logger.info("Resolved active context", {
        dealerId: activeProfile?.dealerId,
        baseUrl,
        headerCount: Object.keys(resolvedHeaders).length,
    });
    return { baseUrl, headers: resolvedHeaders };
}
/**
 * Sends request via proxy to bypass CORS and apply secure headers
 */
async function sendProxyRequest(params) {
    const payload = {
        url: params.url,
        method: params.method,
        headers: params.headers,
        body: params.body,
        timeout: 30000,
    };
    const response = await fetch(PROXY_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson?.error?.message ||
            `Proxy request failed with status ${response.status} (${response.statusText})`);
    }
    const result = await response.json();
    if (result.status >= 400) {
        const upstreamBody = typeof result.body === "string" ? result.body : JSON.stringify(result.body);
        throw new Error(`Upstream ${params.method} failed (${result.status}): ${upstreamBody}`);
    }
    return result.body;
}
function findTargetReason(items) {
    return (items.find((item) => item.detail?.reasonCode === TARGET_REASON_CODE) ??
        items.find((item) => String(item.id) === TARGET_REASON_ID) ??
        null);
}
function needsFix(item) {
    if (!item)
        return false;
    return item.detail?.countInLostSale !== true;
}
function buildUpdatePayload(item) {
    return {
        active: item.active,
        detail: {
            countInLostSale: true,
            reasonCode: item.detail.reasonCode,
            languages: item.detail.languages ?? null,
        },
        type: item.type,
    };
}
export const VoidPartsReasonsView = () => {
    const [rows, setRows] = useState([]);
    const [runState, setRunState] = useState("idle");
    const [statusText, setStatusText] = useState("Ready");
    const [errorText, setErrorText] = useState("");
    const activeContext = useMemo(() => resolveActiveContext(), []);
    const handleRun = async () => {
        logger.info("Run button clicked");
        setRunState("loading");
        setStatusText("Fetching current void reasons via proxy...");
        setErrorText("");
        try {
            const { baseUrl, headers } = resolveActiveContext();
            if (Object.keys(headers).length === 0) {
                setRunState("error");
                setStatusText("Authentication headers are missing");
                setErrorText("No active headers found. Please select a valid dealer profile in Settings or verify extension sync.");
                return;
            }
            // 1. Fetch current reasons
            let currentItems = [];
            const res = await sendProxyRequest({
                url: baseUrl,
                method: "GET",
                headers,
            });
            currentItems = Array.isArray(res?.data) ? res.data : [];
            setRows(currentItems);
            let createdCount = 0;
            let updatedCount = 0;
            // 2. Identify and create any missing reasons
            for (const req of REQUIRED_REASONS) {
                const exists = currentItems.some((item) => item.detail?.reasonCode?.trim().toLowerCase() ===
                    req.reasonCode.trim().toLowerCase() &&
                    item.type?.trim().toUpperCase() === req.type.trim().toUpperCase());
                if (!exists) {
                    setStatusText(`Creating missing reason: "${req.reasonCode}"...`);
                    await sendProxyRequest({
                        url: baseUrl,
                        method: "POST",
                        headers: {
                            ...headers,
                            "content-type": "application/json",
                        },
                        body: {
                            active: true,
                            detail: {
                                countInLostSale: req.countInLostSale,
                                reasonCode: req.reasonCode,
                                languages: null,
                            },
                            type: req.type,
                        },
                    });
                    createdCount++;
                }
            }
            // 3. Re-fetch list if items were added
            if (createdCount > 0) {
                setStatusText("Re-fetching void reasons after creation...");
                const refreshedRes = await sendProxyRequest({
                    url: baseUrl,
                    method: "GET",
                    headers,
                });
                currentItems = Array.isArray(refreshedRes?.data) ? refreshedRes.data : [];
                setRows(currentItems);
            }
            // 4. Update TARGET_REASON_CODE if countInLostSale is disabled
            const target = findTargetReason(currentItems);
            if (target && needsFix(target)) {
                setStatusText(`Enabling Count in Lost Sale for "${TARGET_REASON_CODE}"...`);
                const updateUrl = `${baseUrl}/${String(target.id)}`;
                const updatePayload = buildUpdatePayload(target);
                await sendProxyRequest({
                    url: updateUrl,
                    method: "PUT",
                    headers: {
                        ...headers,
                        "content-type": "application/json",
                    },
                    body: updatePayload,
                });
                updatedCount++;
                // Final list refresh
                const finalRes = await sendProxyRequest({
                    url: baseUrl,
                    method: "GET",
                    headers,
                });
                setRows(Array.isArray(finalRes?.data) ? finalRes.data : []);
            }
            // 5. Final status message
            setRunState("success");
            if (createdCount > 0 || updatedCount > 0) {
                setStatusText(`✅ Successfully created ${createdCount} reason(s) and updated "${TARGET_REASON_CODE}".`);
            }
            else {
                setStatusText(`✅ All void reasons exist and "${TARGET_REASON_CODE}" is already set to Count in Lost Sale.`);
            }
        }
        catch (error) {
            logger.error("Run failed", error);
            setRunState("error");
            setStatusText("Process failed");
            setErrorText(error instanceof Error ? error.message : String(error));
        }
    };
    const getStatusClass = () => {
        if (runState === "error")
            return "status-error";
        if (runState === "success")
            return "status-success";
        if (runState === "warning")
            return "status-warning";
        return "";
    };
    return (_jsxs("div", { className: "void-parts-container", children: [_jsxs("div", { className: "card card-top", children: [_jsxs("div", { className: "header-row", children: [_jsx("div", { className: "title-container", children: _jsx("div", { className: "page-title", children: "Void parts reasons" }) }), _jsx("button", { className: "btn-postman", type: "button", onClick: () => {
                                    void handleRun();
                                }, disabled: runState === "loading", children: runState === "loading" ? "Running..." : "Send" })] }), _jsxs("div", { className: `status-box ${getStatusClass()}`, children: [_jsx("div", { className: `status-text-main ${errorText ? "status-text-margin" : ""}`, children: statusText }), errorText ? _jsx("div", { children: errorText }) : null] })] }), _jsxs("div", { className: "card card-bottom", children: [_jsx("div", { className: "section-title", children: "Void Reasons Table" }), rows.length === 0 ? (_jsx("div", { className: "empty-state", children: "No data loaded yet. Click Send." })) : (_jsx("div", { className: "table-container", children: _jsxs("table", { className: "void-reasons-table", children: [_jsx("thead", { children: _jsxs("tr", { className: "table-header-row", children: [_jsx("th", { children: "#" }), _jsx("th", { children: "ID" }), _jsx("th", { children: "Reason" }), _jsx("th", { children: "Type" }), _jsx("th", { children: "Active" }), _jsx("th", { children: "Count In Lost Sale" }), _jsx("th", { children: "Target" })] }) }), _jsx("tbody", { children: rows.map((row, index) => {
                                        const isTarget = String(row.id) === TARGET_REASON_ID ||
                                            row.detail?.reasonCode === TARGET_REASON_CODE;
                                        return (_jsxs("tr", { className: `table-row ${isTarget ? "table-row-target" : ""}`, children: [_jsx("td", { children: index + 1 }), _jsx("td", { className: "td-mono", children: String(row.id) }), _jsx("td", { children: row.detail?.reasonCode || "—" }), _jsx("td", { children: row.type || "—" }), _jsx("td", { children: row.active ? "Yes" : "No" }), _jsx("td", { children: _jsx("span", { className: `badge ${row.detail?.countInLostSale ? "badge-true" : "badge-false"}`, children: row.detail?.countInLostSale ? "True" : "False" }) }), _jsx("td", { children: isTarget ? (_jsx("span", { className: "badge badge-target", children: "Target" })) : ("—") })] }, `${row.id}-${index}`));
                                    }) })] }) }))] })] }));
};
export default VoidPartsReasonsView;
