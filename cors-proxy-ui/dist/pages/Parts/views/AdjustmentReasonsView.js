import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadTekionApiSettingsBundle } from "../../../services/tekionApiSettings";
const STORAGE_KEY = "parts_adjustment_reasons_config_v1";
const API_URL = "https://preprodapp.tekioncloud.com/api/parts/proxy/u/settings/adjustments/reasons";
const DEFAULT_BUCKET_SPECS = [
    {
        key: "trueIncrease",
        label: "TRUE + Increase",
        expectedReason: "Bin Check Increase",
        glPosting: true,
        type: "INCREASE",
    },
    {
        key: "trueDecrease",
        label: "TRUE + Decrease",
        expectedReason: "Bin Check Decrease",
        glPosting: true,
        type: "DECREASE",
    },
    {
        key: "falseIncrease",
        label: "FALSE + Increase",
        expectedReason: "Bin Check (+)",
        glPosting: false,
        type: "INCREASE",
    },
    {
        key: "falseDecrease",
        label: "FALSE + Decrease",
        expectedReason: "Bin Check (–)",
        glPosting: false,
        type: "DECREASE",
    },
];
const DEFAULT_CUSTOMIZATION = {
    trueIncrease: {
        aliases: ["Physical Inventory (+)", "Core Increase"],
        excluded: [],
    },
    trueDecrease: {
        aliases: ["Physical Inventory (–)", "Physical Inventory (-)", "Core Decrease"],
        excluded: [],
    },
    falseIncrease: {
        aliases: ["Core +"],
        excluded: [],
    },
    falseDecrease: {
        aliases: ["Bin Check (-)", "Core -"],
        excluded: [],
    },
};
const logger = {
    debug: (...args) => console.debug("[Parts][AdjustmentReasons]", ...args),
    info: (...args) => console.info("[Parts][AdjustmentReasons]", ...args),
    warn: (...args) => console.warn("[Parts][AdjustmentReasons]", ...args),
    error: (...args) => console.error("[Parts][AdjustmentReasons]", ...args),
};
function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
}
function normalizeReason(value) {
    return String(value ?? "").trim();
}
function loadHeadersFromSettings() {
    const bundle = loadTekionApiSettingsBundle();
    const headers = (bundle.globalHeaders ?? [])
        .filter((header) => header.enabled && header.key.trim())
        .reduce((acc, header) => {
        acc[header.key] = String(header.value ?? "");
        return acc;
    }, {});
    headers.accept = headers.accept || "application/json, text/plain, */*";
    headers["content-type"] = headers["content-type"] || "application/json";
    return headers;
}
function loadSavedCustomization() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw)
            return DEFAULT_CUSTOMIZATION;
        const parsed = JSON.parse(raw);
        return {
            trueIncrease: {
                aliases: parsed.trueIncrease?.aliases ?? DEFAULT_CUSTOMIZATION.trueIncrease.aliases,
                excluded: parsed.trueIncrease?.excluded ?? DEFAULT_CUSTOMIZATION.trueIncrease.excluded,
            },
            trueDecrease: {
                aliases: parsed.trueDecrease?.aliases ?? DEFAULT_CUSTOMIZATION.trueDecrease.aliases,
                excluded: parsed.trueDecrease?.excluded ?? DEFAULT_CUSTOMIZATION.trueDecrease.excluded,
            },
            falseIncrease: {
                aliases: parsed.falseIncrease?.aliases ?? DEFAULT_CUSTOMIZATION.falseIncrease.aliases,
                excluded: parsed.falseIncrease?.excluded ?? DEFAULT_CUSTOMIZATION.falseIncrease.excluded,
            },
            falseDecrease: {
                aliases: parsed.falseDecrease?.aliases ?? DEFAULT_CUSTOMIZATION.falseDecrease.aliases,
                excluded: parsed.falseDecrease?.excluded ?? DEFAULT_CUSTOMIZATION.falseDecrease.excluded,
            },
        };
    }
    catch {
        return DEFAULT_CUSTOMIZATION;
    }
}
function saveCustomization(config) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    }
    catch (error) {
        logger.warn("failed to save customization", error);
    }
}
async function fetchAdjustmentReasons() {
    const headers = loadHeadersFromSettings();
    if (Object.keys(headers).length === 0) {
        throw new Error("No active global headers found. Please configure headers in Settings.");
    }
    const response = await fetch(API_URL, { method: "GET", headers });
    const text = await response.text();
    let json = {};
    try {
        json = text ? JSON.parse(text) : {};
    }
    catch {
        throw new Error(`Non-JSON response received: ${text.slice(0, 300)}`);
    }
    if (!response.ok) {
        throw new Error(json?.message || `HTTP ${response.status}`);
    }
    return Array.isArray(json.data) ? json.data : [];
}
function buildValidationResult(records, customization) {
    const activeItems = records.filter((item) => normalize(item.status || "ACTIVE") !== "inactive");
    const buckets = DEFAULT_BUCKET_SPECS.reduce((acc, spec) => {
        const custom = customization[spec.key];
        const acceptedNames = [spec.expectedReason, ...(custom?.aliases ?? [])]
            .map(normalizeReason)
            .filter(Boolean);
        const excludedNames = new Set((custom?.excluded ?? []).map(normalize));
        const eligibleItems = activeItems.filter((item) => item.type === spec.type &&
            Boolean(item.glAccountPosting) === spec.glPosting);
        const excludedItems = eligibleItems.filter((item) => excludedNames.has(normalize(item.reason)));
        const matchedItems = eligibleItems.filter((item) => {
            const itemReason = normalizeReason(item.reason);
            const isAccepted = acceptedNames.some((candidate) => normalize(candidate) === normalize(itemReason));
            const isExcluded = excludedNames.has(normalize(itemReason));
            return isAccepted && !isExcluded;
        });
        const preferredItem = matchedItems.find((item) => normalize(item.reason) === normalize(spec.expectedReason)) ||
            matchedItems[0] ||
            (eligibleItems.length === 1 && excludedItems.length === 0 ? eligibleItems[0] : null);
        acc[spec.key] = {
            spec,
            matchedItems,
            eligibleItems,
            excludedItems,
            hasMatch: Boolean(preferredItem),
            preferredItem,
        };
        return acc;
    }, {});
    const bucketEligibleIds = new Set(Object.values(buckets)
        .flatMap((bucket) => bucket.eligibleItems)
        .map((item) => item.id || `${item.reason}-${item.type}-${String(item.glAccountPosting)}`));
    const uncategorizedActiveItems = activeItems.filter((item) => {
        const key = item.id || `${item.reason}-${item.type}-${String(item.glAccountPosting)}`;
        return !bucketEligibleIds.has(key);
    });
    const duplicateSummary = Object.values(buckets)
        .filter((bucket) => bucket.eligibleItems.length > 1)
        .map((bucket) => ({
        bucket: bucket.spec.key,
        count: bucket.eligibleItems.length,
        reasons: bucket.eligibleItems.map((item) => normalizeReason(item.reason) || "Unnamed"),
    }));
    const hasAllFour = Object.values(buckets).every((bucket) => bucket.hasMatch);
    const isValid = hasAllFour && activeItems.length === 4;
    return {
        isValid,
        totalItems: records.length,
        activeItems: activeItems.length,
        buckets,
        uncategorizedActiveItems,
        duplicateSummary,
    };
}
async function updateAdjustmentReasonStatus(id, adjustmentStatus, headers) {
    const url = `${API_URL}/${id}`;
    const response = await fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({ adjustmentStatus }),
    });
    if (!response.ok) {
        throw new Error(`Failed to update record ${id}: HTTP ${response.status}`);
    }
}
async function createAdjustmentReason(payload, headers) {
    const response = await fetch(API_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
    });
    if (!response.ok) {
        throw new Error(`Failed to create "${payload.reason}": HTTP ${response.status}`);
    }
}
export const AdjustmentReasonsView = () => {
    const [runState, setRunState] = useState("idle");
    const [statusText, setStatusText] = useState("Ready to check adjustment reasons");
    const [errorText, setErrorText] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isFixing, setIsFixing] = useState(false);
    const [showInfo, setShowInfo] = useState(false);
    const [records, setRecords] = useState([]);
    const [customization, setCustomization] = useState(() => loadSavedCustomization());
    const [activeInputBucket, setActiveInputBucket] = useState(null);
    const [inputValue, setInputValue] = useState("");
    useEffect(() => {
        saveCustomization(customization);
    }, [customization]);
    const validation = useMemo(() => buildValidationResult(records, customization), [records, customization]);
    const handleFetch = useCallback(async () => {
        setIsLoading(true);
        setRunState("loading");
        setStatusText("Fetching latest adjustment reasons...");
        setErrorText("");
        try {
            const rows = await fetchAdjustmentReasons();
            setRecords(rows);
            const nextValidation = buildValidationResult(rows, customization);
            if (nextValidation.isValid) {
                setRunState("success");
                setStatusText(`✓ All 4 required adjustment reasons are present and clean (${rows.length} total rows)`);
            }
            else {
                setRunState("warning");
                setStatusText(`⚠ Validation issues detected: review required buckets (${rows.length} total rows)`);
            }
        }
        catch (error) {
            setRunState("error");
            setStatusText("Failed to fetch adjustment reasons");
            setErrorText(error instanceof Error ? error.message : String(error));
        }
        finally {
            setIsLoading(false);
        }
    }, [customization]);
    const handleAutoFix = useCallback(async () => {
        setIsFixing(true);
        setRunState("loading");
        setStatusText("Running Auto-Fix...");
        setErrorText("");
        try {
            const headers = loadHeadersFromSettings();
            const latestRows = await fetchAdjustmentReasons();
            const activeRows = latestRows.filter((item) => normalize(item.status || "ACTIVE") !== "inactive");
            const idsToInactivate = new Set();
            const specsByKey = Object.fromEntries(DEFAULT_BUCKET_SPECS.map((spec) => [spec.key, spec]));
            for (const bucketKey of Object.keys(specsByKey)) {
                const spec = specsByKey[bucketKey];
                const custom = customization[bucketKey];
                const eligible = activeRows.filter((item) => item.type === spec.type &&
                    Boolean(item.glAccountPosting) === spec.glPosting);
                const excluded = eligible.filter((item) => custom.excluded.map(normalize).includes(normalize(item.reason)));
                excluded.forEach((item) => {
                    if (item.id)
                        idsToInactivate.add(item.id);
                });
                const accepted = eligible.filter((item) => {
                    const r = normalize(item.reason);
                    return [spec.expectedReason, ...custom.aliases].map(normalize).includes(r) && !excluded.map(x => normalize(x.reason)).includes(r);
                });
                const preferred = accepted.find((item) => normalize(item.reason) === normalize(spec.expectedReason)) ||
                    accepted[0] ||
                    null;
                for (const item of eligible) {
                    if (!item.id)
                        continue;
                    if (excluded.some((x) => x.id === item.id))
                        continue;
                    if (preferred && item.id === preferred.id)
                        continue;
                    idsToInactivate.add(item.id);
                }
            }
            for (const id of idsToInactivate) {
                await updateAdjustmentReasonStatus(id, "INACTIVE", headers);
            }
            const rowsAfterInactivate = await fetchAdjustmentReasons();
            const activeAfterInactivate = rowsAfterInactivate.filter((item) => normalize(item.status || "ACTIVE") !== "inactive");
            for (const spec of DEFAULT_BUCKET_SPECS) {
                const custom = customization[spec.key];
                const hasAcceptedActive = activeAfterInactivate.some((item) => {
                    const r = normalize(item.reason);
                    return (item.type === spec.type &&
                        Boolean(item.glAccountPosting) === spec.glPosting &&
                        [spec.expectedReason, ...custom.aliases].map(normalize).includes(r) &&
                        !custom.excluded.map(normalize).includes(r));
                });
                if (!hasAcceptedActive) {
                    await createAdjustmentReason({
                        reason: spec.expectedReason,
                        type: spec.type,
                        glAccountPosting: spec.glPosting,
                        physicalInventoryReasonType: null,
                    }, headers);
                }
            }
            const refreshed = await fetchAdjustmentReasons();
            setRecords(refreshed);
            const nextValidation = buildValidationResult(refreshed, customization);
            if (nextValidation.isValid) {
                setRunState("success");
                setStatusText("✓ Auto-fix completed. All 4 required adjustment reasons are valid.");
            }
            else {
                setRunState("warning");
                setStatusText("Auto-fix applied, but some records still require manual review.");
            }
        }
        catch (error) {
            setRunState("error");
            setStatusText("Auto-fix failed");
            setErrorText(error instanceof Error ? error.message : String(error));
        }
        finally {
            setIsFixing(false);
        }
    }, [customization]);
    const handleAddItem = (bucketKey, field) => {
        if (!inputValue.trim())
            return;
        const val = inputValue.trim();
        setCustomization((prev) => {
            const current = prev[bucketKey];
            return {
                ...prev,
                [bucketKey]: {
                    aliases: field === "alias" ? [...new Set([...current.aliases, val])] : current.aliases,
                    excluded: field === "exclude" ? [...new Set([...current.excluded, val])] : current.excluded,
                },
            };
        });
        setInputValue("");
        setActiveInputBucket(null);
    };
    const removeItem = (bucketKey, field, val) => {
        setCustomization((prev) => {
            const current = prev[bucketKey];
            return {
                ...prev,
                [bucketKey]: {
                    aliases: field === "alias" ? current.aliases.filter((x) => x !== val) : current.aliases,
                    excluded: field === "exclude" ? current.excluded.filter((x) => x !== val) : current.excluded,
                },
            };
        });
    };
    const banner = useMemo(() => {
        switch (runState) {
            case "error":
                return { bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.25)", text: "#fecaca" };
            case "success":
                return { bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.25)", text: "#bbf7d0" };
            case "warning":
                return { bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.25)", text: "#fde68a" };
            default:
                return { bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.08)", text: "#cbd5e1" };
        }
    }, [runState]);
    return (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsxs("div", { style: {
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 18,
                    display: "grid",
                    gap: 14,
                }, children: [_jsxs("div", { style: {
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: 12,
                        }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("div", { style: { fontSize: 20, fontWeight: 800, color: "#f8fafc" }, children: "Adjustment Reasons" }), _jsx("button", { type: "button", onClick: () => setShowInfo((p) => !p), style: {
                                            width: 20,
                                            height: 20,
                                            borderRadius: 999,
                                            background: "rgba(255,255,255,0.08)",
                                            border: "1px solid rgba(255,255,255,0.15)",
                                            color: "#94a3b8",
                                            fontSize: 11,
                                            cursor: "pointer",
                                            fontWeight: 700,
                                        }, title: "Toggle Description", children: "i" })] }), _jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [_jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => setCustomization(DEFAULT_CUSTOMIZATION), children: "Reset Rules" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => void handleAutoFix(), disabled: isLoading || isFixing, children: isFixing ? "Fixing..." : "Auto Fix" }), _jsx("button", { className: "btn-postman", type: "button", onClick: () => void handleFetch(), disabled: isLoading || isFixing, children: isLoading ? "Running..." : "GET" })] })] }), showInfo && (_jsxs("div", { style: {
                            padding: 12,
                            borderRadius: 10,
                            background: "rgba(255,255,255,0.02)",
                            border: "1px solid rgba(255,255,255,0.06)",
                            color: "#94a3b8",
                            fontSize: 12,
                            lineHeight: 1.6,
                        }, children: ["Validates that exactly 4 adjustment reasons exist across the required permutations (GL Posting True/False \u00D7 Increase/Decrease). ", _jsx("b", { children: "Auto Fix" }), " marks excess duplicates or excluded records as INACTIVE and creates any missing baseline codes."] })), _jsxs("div", { style: {
                            borderRadius: 12,
                            padding: "10px 14px",
                            fontSize: 13,
                            border: `1px solid ${banner.border}`,
                            background: banner.bg,
                            color: banner.text,
                        }, children: [_jsx("div", { style: { fontWeight: 700 }, children: statusText }), errorText && _jsx("div", { style: { fontSize: 12, marginTop: 4 }, children: errorText })] })] }), _jsxs("div", { style: {
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 16,
                    display: "grid",
                    gap: 12,
                }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsx("span", { style: { fontSize: 14, fontWeight: 800, color: "#f8fafc" }, children: "Required Permutation Rules" }), _jsxs("span", { style: { fontSize: 12, color: "#94a3b8" }, children: [Object.values(validation.buckets).filter((b) => b.hasMatch).length, " / 4 Configured"] })] }), _jsx("div", { style: { display: "grid", gap: 8 }, children: DEFAULT_BUCKET_SPECS.map((spec) => {
                            const res = validation.buckets[spec.key];
                            const custom = customization[spec.key];
                            const isMatching = res.hasMatch;
                            const isInputActive = activeInputBucket?.key === spec.key;
                            return (_jsxs("div", { style: {
                                    borderRadius: 12,
                                    border: `1px solid ${isMatching ? "rgba(34,197,94,0.22)" : "rgba(245,158,11,0.22)"}`,
                                    background: isMatching ? "rgba(34,197,94,0.03)" : "rgba(245,158,11,0.03)",
                                    padding: "12px 14px",
                                    display: "grid",
                                    gap: 8,
                                }, children: [_jsxs("div", { style: {
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            flexWrap: "wrap",
                                            gap: 10,
                                        }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }, children: [_jsx("span", { style: { fontSize: 14, fontWeight: 800, color: "#f8fafc", minWidth: 140 }, children: spec.label }), _jsx("span", { style: {
                                                            padding: "2px 8px",
                                                            borderRadius: 999,
                                                            fontSize: 10,
                                                            fontWeight: 800,
                                                            background: isMatching ? "rgba(34,197,94,0.15)" : "rgba(245,158,11,0.15)",
                                                            color: isMatching ? "#86efac" : "#fde68a",
                                                            border: `1px solid ${isMatching ? "rgba(34,197,94,0.3)" : "rgba(245,158,11,0.3)"}`,
                                                        }, children: isMatching ? "✓ Matched" : "Missing" }), _jsxs("span", { style: { fontSize: 12, color: "#94a3b8" }, children: ["Target: ", _jsx("strong", { style: { color: "#f8fafc" }, children: spec.expectedReason })] }), res.preferredItem && res.preferredItem.reason !== spec.expectedReason && (_jsxs("span", { style: { fontSize: 12, color: "#38bdf8" }, children: ["(Matched Alias: ", _jsx("strong", { children: res.preferredItem.reason }), ")"] })), res.eligibleItems.length > 1 && (_jsxs("span", { style: { fontSize: 11, color: "#fca5a5" }, children: ["\u26A0 ", res.eligibleItems.length, " active eligible"] }))] }), _jsxs("div", { style: { display: "flex", gap: 6 }, children: [_jsx("button", { type: "button", onClick: () => {
                                                            setActiveInputBucket({ key: spec.key, field: "alias" });
                                                            setInputValue("");
                                                        }, style: {
                                                            background: "rgba(56,189,248,0.08)",
                                                            border: "1px solid rgba(56,189,248,0.25)",
                                                            borderRadius: 6,
                                                            color: "#38bdf8",
                                                            fontSize: 11,
                                                            padding: "2px 8px",
                                                            fontWeight: 700,
                                                            cursor: "pointer",
                                                        }, children: "+ Alias" }), _jsx("button", { type: "button", onClick: () => {
                                                            setActiveInputBucket({ key: spec.key, field: "exclude" });
                                                            setInputValue("");
                                                        }, style: {
                                                            background: "rgba(239,68,68,0.08)",
                                                            border: "1px solid rgba(239,68,68,0.25)",
                                                            borderRadius: 6,
                                                            color: "#f87171",
                                                            fontSize: 11,
                                                            padding: "2px 8px",
                                                            fontWeight: 700,
                                                            cursor: "pointer",
                                                        }, children: "+ Exclude" })] })] }), _jsxs("div", { style: { display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", fontSize: 12 }, children: [custom.aliases.length > 0 && (_jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }, children: [_jsx("span", { style: { color: "#64748b", fontSize: 11, fontWeight: 700 }, children: "Aliases:" }), custom.aliases.map((alias) => (_jsxs("span", { style: {
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            gap: 6,
                                                            padding: "1px 6px",
                                                            borderRadius: 4,
                                                            background: "rgba(56,189,248,0.1)",
                                                            color: "#7dd3fc",
                                                            fontSize: 11,
                                                            border: "1px solid rgba(56,189,248,0.2)",
                                                        }, children: [alias, _jsx("span", { onClick: () => removeItem(spec.key, "alias", alias), style: { cursor: "pointer", fontWeight: 900 }, children: "\u00D7" })] }, alias)))] })), custom.excluded.length > 0 && (_jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }, children: [_jsx("span", { style: { color: "#64748b", fontSize: 11, fontWeight: 700 }, children: "Excluded:" }), custom.excluded.map((exc) => (_jsxs("span", { style: {
                                                            display: "inline-flex",
                                                            alignItems: "center",
                                                            gap: 6,
                                                            padding: "1px 6px",
                                                            borderRadius: 4,
                                                            background: "rgba(239,68,68,0.1)",
                                                            color: "#fca5a5",
                                                            fontSize: 11,
                                                            border: "1px solid rgba(239,68,68,0.2)",
                                                        }, children: [exc, _jsx("span", { onClick: () => removeItem(spec.key, "exclude", exc), style: { cursor: "pointer", fontWeight: 900 }, children: "\u00D7" })] }, exc)))] }))] }), isInputActive && (_jsxs("div", { style: { display: "flex", gap: 6, marginTop: 4 }, children: [_jsx("input", { type: "text", className: "st-input", value: inputValue, autoFocus: true, placeholder: activeInputBucket.field === "alias"
                                                    ? `Add alias for ${spec.label}`
                                                    : `Add exclusion for ${spec.label}`, onChange: (e) => setInputValue(e.target.value), onKeyDown: (e) => {
                                                    if (e.key === "Enter")
                                                        handleAddItem(spec.key, activeInputBucket.field);
                                                    if (e.key === "Escape")
                                                        setActiveInputBucket(null);
                                                }, style: { height: 32, fontSize: 12, flex: 1 } }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => handleAddItem(spec.key, activeInputBucket.field), children: "Save" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => setActiveInputBucket(null), children: "\u2715" })] }))] }, spec.key));
                        }) })] }), _jsxs("div", { style: {
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 16,
                }, children: [_jsxs("div", { style: {
                            fontSize: 14,
                            fontWeight: 800,
                            color: "#f8fafc",
                            marginBottom: 12,
                            display: "flex",
                            justifyContent: "space-between",
                        }, children: [_jsxs("span", { children: ["Server Records ", records.length > 0 && `(${records.length})`] }), _jsxs("span", { style: { fontSize: 12, color: "#94a3b8", fontWeight: 500 }, children: ["Active: ", validation.activeItems, " / 4 Expected"] })] }), records.length === 0 ? (_jsx("div", { style: {
                            padding: 24,
                            color: "#94a3b8",
                            textAlign: "center",
                            fontSize: 13,
                            borderRadius: 12,
                            border: "1px dashed rgba(255,255,255,0.1)",
                        }, children: "No records loaded yet. Click GET." })) : (_jsx("div", { style: { overflowX: "auto" }, children: _jsxs("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: 800 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "rgba(255,255,255,0.04)" }, children: [_jsx("th", { style: thStyle, children: "#" }), _jsx("th", { style: thStyle, children: "Reason" }), _jsx("th", { style: thStyle, children: "Type" }), _jsx("th", { style: thStyle, children: "GL Posting" }), _jsx("th", { style: thStyle, children: "Status" }), _jsx("th", { style: thStyle, children: "Bucket" }), _jsx("th", { style: thStyle, children: "Role" }), _jsx("th", { style: thStyle, children: "ID" })] }) }), _jsx("tbody", { children: records.map((item, index) => {
                                        const bucketEntry = Object.values(validation.buckets).find((bucket) => bucket.eligibleItems.some((candidate) => candidate.id === item.id));
                                        const isPreferred = Object.values(validation.buckets).some((bucket) => bucket.preferredItem?.id === item.id);
                                        const isExcluded = Object.values(validation.buckets).some((bucket) => bucket.excludedItems.some((candidate) => candidate.id === item.id));
                                        return (_jsxs("tr", { style: {
                                                borderTop: "1px solid rgba(255,255,255,0.06)",
                                                background: isPreferred ? "rgba(34,197,94,0.05)" : "transparent",
                                            }, children: [_jsx("td", { style: tdStyle, children: index + 1 }), _jsx("td", { style: { ...tdStyle, fontWeight: isPreferred ? 700 : 400 }, children: item.reason || "—" }), _jsx("td", { style: tdStyle, children: item.type || "—" }), _jsx("td", { style: tdStyle, children: item.glAccountPosting ? "TRUE" : "FALSE" }), _jsx("td", { style: tdStyle, children: item.status || "—" }), _jsx("td", { style: tdStyle, children: bucketEntry?.spec.label || "Uncategorized" }), _jsx("td", { style: tdStyle, children: isPreferred ? (_jsx("span", { style: badgeGreen, children: "Preferred" })) : isExcluded ? (_jsx("span", { style: badgeRed, children: "Excluded" })) : (_jsx("span", { style: badgeGray, children: "Secondary" })) }), _jsx("td", { style: tdMonoStyle, children: String(item.id ?? "—") })] }, `${item.id || item.reason || "row"}-${index}`));
                                    }) })] }) }))] })] }));
};
const thStyle = {
    textAlign: "left",
    padding: "10px 8px",
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    whiteSpace: "nowrap",
};
const tdStyle = {
    textAlign: "left",
    padding: "10px 8px",
    color: "#e2e8f0",
    fontSize: 12,
    verticalAlign: "middle",
};
const tdMonoStyle = {
    ...tdStyle,
    fontFamily: "ui-monospace, monospace",
};
const badgeGreen = {
    display: "inline-flex",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 800,
    background: "rgba(34,197,94,0.15)",
    color: "#86efac",
    border: "1px solid rgba(34,197,94,0.3)",
};
const badgeRed = {
    display: "inline-flex",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 800,
    background: "rgba(239,68,68,0.15)",
    color: "#fca5a5",
    border: "1px solid rgba(239,68,68,0.3)",
};
const badgeGray = {
    display: "inline-flex",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 800,
    background: "rgba(255,255,255,0.06)",
    color: "#94a3b8",
};
export default AdjustmentReasonsView;
