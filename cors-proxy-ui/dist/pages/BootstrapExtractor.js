import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { extractBootstrapData, computeStats, toCsvString, downloadFile, COST_CENTER_KEYS, } from "../utils/bootstrapExtractor";
import { idbSaveBootstrapWithRawSections, idbGetAllBootstraps, idbDeleteBootstrap, } from "../utils/bootstrapDb";
import { loadGlobalHeaders } from "../services/tekionApiSettings";
/**
 * HOW INDEXEDDB SAVE WORKS
 * ------------------------------------------------------------------
 * This screen extracts a simplified bootstrap view for UI usage
 * (dealerId, glAccounts, costCenterSetup, journals).
 *
 * During save, we preserve BOTH:
 * 1. The extracted bootstrap result used by the UI
 * 2. Only the approved raw accounting bootstrap asset sections from
 *    the original JSON payload
 *
 * The saved IndexedDB record goes into:
 *   db rc_bootstrap_db
 *   Store : bootstraps
 *
 * using dealerId as the key.
 *
 * Inside record.Data, we keep extracted fields and attach only:
 * - apSetup
 * - accountingSettings
 * - allAccounts
 * - allJournals
 * - arSetup
 * - lookupAssetSupport
 * - glAccountDynamicKeys
 * - customField
 * - salesChains
 *
 * This keeps the snapshot reusable for downstream Accounting and
 * GL Validation screens without saving unrelated bootstrap assets.
 * ------------------------------------------------------------------
 */
const ACCT_TYPE_COLORS = {
    ASSET: "#30d158",
    LIABILITY: "#ff453a",
    EQUITY: "#bf5af2",
    REVENUE: "#0a84ff",
    EXPENSE: "#ff9f0a",
    CONTRA: "#ff6c37",
};
const acctColor = (t) => ACCT_TYPE_COLORS[t?.toUpperCase()] ?? "#98989d";
const BOOTSTRAP_URL = "https://preprodapp.tekioncloud.com/api/accounting/u/configurable/bootstrap";
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
function toEnabledHeaderMap(headers) {
    const out = {};
    for (const row of headers) {
        if (!row?.enabled)
            continue;
        const key = row.key?.trim();
        const value = row.value ?? "";
        if (!key || !String(value).trim())
            continue;
        out[key] = String(value);
    }
    return out;
}
function findHeaderValueCaseInsensitive(headers, candidates) {
    const entries = Object.entries(headers);
    for (const candidate of candidates) {
        const found = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
        if (found && String(found[1]).trim()) {
            return String(found[1]).trim();
        }
    }
    return null;
}
function extractDealerIdFromHeaders(headers) {
    return findHeaderValueCaseInsensitive(headers, [
        "dealerid",
        "dealerId",
        "dealer-id",
        "x-dealer-id",
    ]);
}
function buildBootstrapRequestBody(dealerId) {
    return {
        requestInfo: BOOTSTRAP_ASSET_TYPES.map((assetType) => ({
            assetType,
            dealerMetaDataInfo: [{ dealerId }],
        })),
    };
}
function asObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    return value;
}
function normalize(value) {
    return String(value ?? "").trim();
}
function getSalesChainsRoot(data) {
    const root = asObject(data);
    if (!root)
        return null;
    if (root.salesChains) {
        return asObject(root.salesChains);
    }
    const innerData = asObject(root.data);
    if (innerData?.salesChains) {
        return asObject(innerData.salesChains);
    }
    return null;
}
function mapObjectValuesToRows(source) {
    const obj = asObject(source);
    if (!obj)
        return [];
    return Object.entries(obj).flatMap(([entryKey, entryValue]) => {
        if (Array.isArray(entryValue)) {
            return entryValue
                .filter((item) => item && typeof item === "object")
                .map((item) => ({
                __entryKey: entryKey,
                ...item,
            }));
        }
        if (entryValue && typeof entryValue === "object") {
            return [
                {
                    __entryKey: entryKey,
                    ...entryValue,
                },
            ];
        }
        return [
            {
                __entryKey: entryKey,
                value: entryValue,
            },
        ];
    });
}
function getSalesChainsRows(data) {
    const salesChains = getSalesChainsRoot(data);
    if (!salesChains)
        return [];
    const rows = [];
    rows.push(...mapObjectValuesToRows(salesChains.masterAssetDocMap).map((r) => ({
        ...r,
        __source: "MASTER",
    })));
    rows.push(...mapObjectValuesToRows(salesChains.dealerAssetDocMap).map((r) => ({
        ...r,
        __source: "DEALER",
    })));
    const deduped = new Map();
    rows.forEach((row, index) => {
        const id = normalize(row.id);
        const entryKey = normalize(row.__entryKey);
        const dedupeKey = id ? `${id}-${row.__source}` : `${entryKey}-${index}-${row.__source}`;
        if (!deduped.has(dedupeKey)) {
            deduped.set(dedupeKey, row);
        }
    });
    return Array.from(deduped.values());
}
function getSalesChainsAccessibleRows(data) {
    const salesChains = getSalesChainsRoot(data);
    const accessibleMap = asObject(salesChains?.accessibleAssetMap);
    if (!accessibleMap)
        return [];
    return Object.entries(accessibleMap).map(([dealerId, assetIds]) => ({
        dealerId,
        assetIds: Array.isArray(assetIds) ? assetIds.map((x) => String(x)) : [],
    }));
}
const GLAccountsView = ({ accounts }) => {
    const [search, setSearch] = useState("");
    const [sortBy, setSortBy] = useState("accountNumber");
    const [sortAsc, setSortAsc] = useState(true);
    const filtered = useMemo(() => {
        const q = search.toLowerCase();
        return [...accounts]
            .filter((a) => !q ||
            (a.accountName ?? "").toLowerCase().includes(q) ||
            (a.accountNumber ?? "").toLowerCase().includes(q) ||
            (a.accountTypeId ?? "").toLowerCase().includes(q))
            .sort((a, b) => {
            const av = String(a[sortBy]);
            const bv = String(b[sortBy]);
            return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
        });
    }, [accounts, search, sortBy, sortAsc]);
    const handleSort = (col) => {
        if (sortBy === col)
            setSortAsc((v) => !v);
        else {
            setSortBy(col);
            setSortAsc(true);
        }
    };
    const Sorter = ({ col }) => (_jsx("span", { style: { opacity: sortBy === col ? 1 : 0.3, marginLeft: 3 }, children: sortBy === col ? (sortAsc ? "▲" : "▼") : "⇅" }));
    return (_jsxs("div", { className: "bx-table-wrap", children: [_jsxs("div", { className: "bx-search-bar", children: [_jsx("input", { className: "bx-search-input", type: "text", placeholder: "Search name, number, type...", value: search, onChange: (e) => setSearch(e.target.value) }), _jsxs("span", { className: "bx-count-badge", children: [filtered.length, " / ", accounts.length] })] }), _jsxs("table", { className: "bx-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsxs("th", { className: "bx-th-sort", onClick: () => handleSort("accountNumber"), children: ["# ", _jsx(Sorter, { col: "accountNumber" })] }), _jsxs("th", { className: "bx-th-sort", onClick: () => handleSort("accountName"), children: ["Name ", _jsx(Sorter, { col: "accountName" })] }), _jsxs("th", { className: "bx-th-sort", onClick: () => handleSort("accountTypeId"), children: ["Type ", _jsx(Sorter, { col: "accountTypeId" })] }), _jsx("th", { children: "ID" })] }) }), _jsx("tbody", { children: filtered.map((a, i) => (_jsxs("tr", { children: [_jsx("td", { children: _jsx("code", { className: "bx-mono", children: a.accountNumber }) }), _jsx("td", { children: a.accountName }), _jsx("td", { children: _jsx("span", { className: "bx-type-badge", style: {
                                            color: acctColor(a.accountTypeId),
                                            borderColor: acctColor(a.accountTypeId) + "44",
                                        }, children: a.accountTypeId }) }), _jsx("td", { children: _jsx("code", { className: "bx-mono bx-muted", children: a.id }) })] }, a.key || a.id || a.accountNumber || i))) })] })] }));
};
const CostCenterView = ({ setup, stats }) => (_jsxs("div", { className: "bx-cc-wrap", children: [_jsx("div", { className: "bx-key-grid", children: [...COST_CENTER_KEYS].map((key) => {
                const found = stats.foundKeys.includes(key);
                const entry = setup.find((cc) => cc.customFieldKey === key);
                const optionCount = entry?.options?.length ?? 0;
                return (_jsxs("div", { className: `bx-key-card ${found ? "bx-key-ok" : "bx-key-miss"}`, children: [_jsxs("div", { className: "bx-key-top", children: [_jsx("span", { children: found ? "✅" : "❌" }), _jsx("code", { className: "bx-key-label", children: key })] }), _jsx("div", { className: "bx-key-sub", children: found
                                ? `${optionCount} option${optionCount !== 1 ? "s" : ""}`
                                : "not found in data" })] }, key));
            }) }), setup.map((cc, index) => (_jsxs("div", { className: "bx-cc-block", children: [_jsxs("div", { className: "bx-cc-header", children: [_jsx("code", { className: "bx-key-label", children: cc.customFieldKey }), _jsxs("span", { className: "bx-count-badge", children: [cc.options?.length ?? 0, " options"] })] }), !cc.options || cc.options.length === 0 ? (_jsx("div", { className: "bx-no-opts", children: "No options configured" })) : (_jsxs("table", { className: "bx-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Option ID" }), _jsx("th", { children: "Option Name" })] }) }), _jsx("tbody", { children: cc.options.map((opt, idx) => (_jsxs("tr", { children: [_jsx("td", { children: _jsx("code", { className: "bx-mono", children: opt.id }) }), _jsx("td", { children: opt.name })] }, opt.id || idx))) })] }))] }, cc.key || cc.customFieldKey || index)))] }));
const JournalsView = ({ journals }) => (_jsxs("table", { className: "bx-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Journal Name" }), _jsx("th", { children: "Number" }), _jsx("th", { children: "ID" })] }) }), _jsx("tbody", { children: journals.map((j, i) => (_jsxs("tr", { children: [_jsx("td", { children: j.journalName }), _jsx("td", { children: _jsx("code", { className: "bx-mono", children: j.journalNumber }) }), _jsx("td", { children: _jsx("code", { className: "bx-mono bx-muted", children: j.id }) })] }, j.key || j.id || j.journalNumber || i))) })] }));
const MetricCard = ({ label, value }) => (_jsxs("div", { style: {
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
    }, children: [_jsx("span", { style: { fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 }, children: label }), _jsx("span", { style: { fontSize: 16, fontWeight: 600, color: "#f8fafc" }, children: value })] }));
const SalesChainsView = ({ data, glAccounts }) => {
    const [sortBy, setSortBy] = useState(null);
    const [sortAsc, setSortAsc] = useState(true);
    const [isAccessibleMapOpen, setIsAccessibleMapOpen] = useState(true);
    const [selectedDealerFilter, setSelectedDealerFilter] = useState("ALL");
    const rows = useMemo(() => getSalesChainsRows(data), [data]);
    const accessibleRows = useMemo(() => getSalesChainsAccessibleRows(data), [data]);
    const salesChains = useMemo(() => getSalesChainsRoot(data), [data]);
    const filteredAccessibleRows = useMemo(() => {
        if (selectedDealerFilter === "ALL")
            return accessibleRows;
        return accessibleRows.filter((r) => r.dealerId === selectedDealerFilter);
    }, [accessibleRows, selectedDealerFilter]);
    const glMap = useMemo(() => {
        const map = new Map();
        glAccounts.forEach((acc) => map.set(acc.id, acc));
        return map;
    }, [glAccounts]);
    const sortedRows = useMemo(() => {
        if (!sortBy)
            return rows;
        return [...rows].sort((a, b) => {
            const getVal = (row) => {
                const acctId = row[sortBy];
                if (acctId === null || acctId === undefined || acctId === "")
                    return "\uFFFF";
                const gl = glMap.get(String(acctId));
                if (gl)
                    return (gl.accountName ?? "").toLowerCase();
                return String(acctId).toLowerCase();
            };
            const valA = getVal(a);
            const valB = getVal(b);
            return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
        });
    }, [rows, sortBy, sortAsc, glMap]);
    const handleSort = (col) => {
        if (sortBy === col) {
            setSortAsc((v) => !v);
        }
        else {
            setSortBy(col);
            setSortAsc(true);
        }
    };
    const Sorter = ({ col }) => (_jsx("span", { style: { opacity: sortBy === col ? 1 : 0.3, marginLeft: 3 }, children: sortBy === col ? (sortAsc ? "▲" : "▼") : "⇅" }));
    const SmartAccountCell = ({ acctId }) => {
        if (acctId === null || acctId === undefined || acctId === "") {
            return _jsx("span", { style: { color: "#475569" }, children: "\u2014" });
        }
        const strId = String(acctId);
        const gl = glMap.get(strId);
        if (!gl) {
            return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: [_jsx("code", { className: "bx-mono", style: { color: "#cbd5e1" }, children: strId }), _jsx("span", { style: { fontSize: 10, color: "#ef4444", fontWeight: 600 }, children: "\u26A0 Not in GL list" })] }));
        }
        const typeColor = acctColor(gl.accountTypeId);
        return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [_jsx("code", { className: "bx-mono", style: { color: "#f8fafc", fontSize: 13, fontWeight: 600 }, children: gl.accountNumber }), _jsx("span", { style: {
                                fontSize: 10,
                                padding: "2px 6px",
                                borderRadius: 4,
                                border: `1px solid ${typeColor}40`,
                                color: typeColor,
                                background: `${typeColor}15`,
                                textTransform: "uppercase",
                                letterSpacing: 0.5,
                            }, children: gl.accountTypeId })] }), _jsx("span", { style: { fontSize: 12, color: "#94a3b8", lineHeight: 1.3 }, children: gl.accountName })] }));
    };
    if (!salesChains) {
        return (_jsxs("div", { className: "bx-empty-state", children: [_jsx("span", { className: "bx-empty-icon", children: "\uD83E\uDDFE" }), _jsx("p", { children: "No salesChains object found in saved snapshot or pasted JSON" })] }));
    }
    return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 20 }, children: [_jsxs("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }, children: [_jsx(MetricCard, { label: "Configured Chains", value: rows.length }), _jsx(MetricCard, { label: "Asset Level", value: String(salesChains.assetLevel ?? "—") }), _jsx(MetricCard, { label: "Object Type", value: String(salesChains.typeOfObject ?? "—") }), _jsx(MetricCard, { label: "Accessible Dealers", value: accessibleRows.length })] }), accessibleRows.length > 0 && (_jsxs("div", { className: "bx-table-wrap", children: [_jsxs("div", { className: "bx-search-bar", style: {
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: 10,
                            padding: "10px 14px",
                        }, children: [_jsxs("div", { onClick: () => setIsAccessibleMapOpen((prev) => !prev), style: {
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    cursor: "pointer",
                                    userSelect: "none",
                                }, children: [_jsx("span", { style: { fontSize: 12, color: "#60a5fa" }, children: isAccessibleMapOpen ? "▼" : "▶" }), _jsxs("span", { className: "bx-count-badge", style: {
                                            background: "rgba(10,132,255,0.15)",
                                            color: "#60a5fa",
                                            border: "1px solid rgba(10,132,255,0.3)",
                                        }, children: ["accessibleAssetMap (", accessibleRows.length, " dealer", accessibleRows.length !== 1 ? "s" : "", ")"] }), _jsx("span", { style: { fontSize: 12, color: "#94a3b8" }, children: isAccessibleMapOpen ? "Click to collapse" : "Click to expand" })] }), isAccessibleMapOpen && (_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("label", { htmlFor: "dealer-filter-select", style: { fontSize: 12, color: "#94a3b8" }, children: "Filter Dealer:" }), _jsxs("select", { id: "dealer-filter-select", className: "bx-search-input", style: {
                                            maxWidth: 240,
                                            padding: "4px 8px",
                                            fontSize: 12,
                                            cursor: "pointer",
                                            height: 30,
                                        }, value: selectedDealerFilter, onChange: (e) => setSelectedDealerFilter(e.target.value), children: [_jsxs("option", { value: "ALL", children: ["All Dealers (", accessibleRows.length, ")"] }), accessibleRows.map((row) => (_jsxs("option", { value: row.dealerId, children: [row.dealerId, " (", row.assetIds.length, " assets)"] }, row.dealerId)))] }), selectedDealerFilter !== "ALL" && (_jsx("button", { className: "btn-secondary btn-xs", onClick: () => setSelectedDealerFilter("ALL"), children: "Reset" }))] }))] }), isAccessibleMapOpen && (_jsxs("table", { className: "bx-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { style: { width: 180 }, children: "Dealer ID" }), _jsxs("th", { children: ["Accessible Asset IDs (", filteredAccessibleRows.reduce((acc, r) => acc + r.assetIds.length, 0), " total)"] })] }) }), _jsx("tbody", { children: filteredAccessibleRows.map((row) => (_jsxs("tr", { children: [_jsxs("td", { style: { verticalAlign: "top" }, children: [_jsx("code", { className: "bx-mono", style: { color: "#60a5fa", fontWeight: 600 }, children: row.dealerId }), _jsxs("div", { style: { fontSize: 11, color: "#94a3b8", marginTop: 4 }, children: [row.assetIds.length, " asset", row.assetIds.length !== 1 ? "s" : ""] })] }), _jsx("td", { children: _jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 }, children: row.assetIds.length > 0 ? (row.assetIds.map((id) => (_jsx("span", { style: {
                                                        padding: "4px 8px",
                                                        background: "rgba(255,255,255,0.06)",
                                                        border: "1px solid rgba(255,255,255,0.1)",
                                                        borderRadius: 6,
                                                        fontSize: 12,
                                                        fontFamily: "monospace",
                                                    }, children: id }, id)))) : (_jsx("span", { style: { color: "#64748b" }, children: "\u2014" })) }) })] }, row.dealerId))) })] }))] })), sortedRows.length > 0 ? (_jsxs("div", { className: "bx-table-wrap", children: [_jsx("div", { className: "bx-search-bar", style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: _jsx("span", { className: "bx-count-badge", children: "Master & Dealer Core GL Mappings" }) }), _jsxs("table", { className: "bx-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { style: { width: 160 }, children: "ID / Source" }), _jsx("th", { style: { width: 120 }, children: "Type" }), _jsxs("th", { className: "bx-th-sort", onClick: () => handleSort("saleAccountId"), children: ["Sale ", _jsx(Sorter, { col: "saleAccountId" })] }), _jsxs("th", { className: "bx-th-sort", onClick: () => handleSort("costOfSaleAccountId"), children: ["Cost of Sale ", _jsx(Sorter, { col: "costOfSaleAccountId" })] }), _jsxs("th", { className: "bx-th-sort", onClick: () => handleSort("costOffsetAccountId"), children: ["Cost Offset ", _jsx(Sorter, { col: "costOffsetAccountId" })] })] }) }), _jsx("tbody", { children: sortedRows.map((row, index) => {
                                    const id = row.id ?? row.__entryKey;
                                    const type = row.accountingChainType ?? "—";
                                    const source = row.__source;
                                    return (_jsxs("tr", { children: [_jsx("td", { style: { verticalAlign: "top" }, children: _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 6 }, children: [_jsx("code", { className: "bx-mono", style: { color: "#cbd5e1", fontSize: 13, wordBreak: "break-all" }, children: String(id) }), source && (_jsx("span", { style: {
                                                                alignSelf: "flex-start",
                                                                fontSize: 10,
                                                                padding: "2px 6px",
                                                                borderRadius: 4,
                                                                background: source === "MASTER" ? "rgba(191,90,242,0.15)" : "rgba(10,132,255,0.15)",
                                                                color: source === "MASTER" ? "#d946ef" : "#60a5fa",
                                                                border: `1px solid ${source === "MASTER" ? "rgba(191,90,242,0.3)" : "rgba(10,132,255,0.3)"}`,
                                                                fontWeight: 600,
                                                            }, children: source }))] }) }), _jsx("td", { style: { verticalAlign: "top" }, children: _jsx("span", { style: {
                                                        padding: "4px 8px",
                                                        borderRadius: 6,
                                                        border: "1px solid rgba(255,255,255,0.1)",
                                                        background: "rgba(255,255,255,0.05)",
                                                        fontSize: 12,
                                                        color: "#e2e8f0",
                                                    }, children: String(type) }) }), _jsx("td", { style: { verticalAlign: "top" }, children: _jsx(SmartAccountCell, { acctId: row.saleAccountId }) }), _jsx("td", { style: { verticalAlign: "top" }, children: _jsx(SmartAccountCell, { acctId: row.costOfSaleAccountId }) }), _jsx("td", { style: { verticalAlign: "top" }, children: _jsx(SmartAccountCell, { acctId: row.costOffsetAccountId }) })] }, `${String(id)}-${index}`));
                                }) })] })] })) : null] }));
};
const HistoryPanel = ({ records, onLoad, onDelete, onDownloadJson, onDownloadCsv }) => {
    if (records.length === 0) {
        return _jsx("div", { className: "bx-history-empty", children: "No saved snapshots yet" });
    }
    return (_jsx("div", { className: "bx-history-list", children: records.map((r) => (_jsxs("div", { className: "bx-history-row", children: [_jsxs("div", { className: "bx-history-meta", style: { cursor: "pointer", flex: 1 }, title: "Click to load this snapshot", onClick: () => onLoad(r), children: [_jsxs("span", { className: "bx-history-dealer", children: ["\uD83C\uDFEA ", r.dealerName] }), _jsx("span", { className: "bx-history-time", children: new Date(r.savedAt).toLocaleString() }), _jsx("span", { style: { fontSize: 10, color: "#0a84ff" }, children: "click to load \u2192" })] }), _jsxs("div", { className: "bx-history-actions", children: [_jsx("button", { className: "btn-secondary btn-xs", title: "Download JSON", onClick: () => onDownloadJson(r), children: "\u2B07 JSON" }), _jsx("button", { className: "btn-secondary btn-xs", title: "Download CSV", onClick: () => onDownloadCsv(r), children: "\u2B07 CSV" }), _jsx("button", { className: "btn-danger btn-xs", title: "Delete from IndexedDB", onClick: () => onDelete(r.key), children: "\uD83D\uDDD1" })] })] }, r.key))) }));
};
export const BootstrapExtractor = ({ onBack }) => {
    const [jsonText, setJsonText] = useState("");
    const [result, setResult] = useState(null);
    const [rawJson, setRawJson] = useState(null);
    const [stats, setStats] = useState(null);
    const [error, setError] = useState(null);
    const [tab, setTab] = useState("glAccounts");
    const [showLeftPanel, setShowLeftPanel] = useState(true);
    const fileRef = useRef(null);
    const [saving, setSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState(null);
    const [idbHistory, setIdbHistory] = useState([]);
    const [showHistory, setShowHistory] = useState(false);
    const [globalHeaders, setGlobalHeaders] = useState([]);
    const [fetchingBootstrap, setFetchingBootstrap] = useState(false);
    const [fetchMsg, setFetchMsg] = useState(null);
    const enabledHeaderMap = useMemo(() => toEnabledHeaderMap(globalHeaders), [globalHeaders]);
    const detectedDealerId = useMemo(() => extractDealerIdFromHeaders(enabledHeaderMap), [enabledHeaderMap]);
    const enabledHeaderCount = useMemo(() => globalHeaders.filter((row) => row.enabled && row.key.trim() && row.value.trim()).length, [globalHeaders]);
    const loadHistory = useCallback(async () => {
        try {
            const records = await idbGetAllBootstraps();
            setIdbHistory(records.sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
        }
        catch {
            /* silent */
        }
    }, []);
    const refreshGlobalHeaders = useCallback(() => {
        try {
            setGlobalHeaders(loadGlobalHeaders());
        }
        catch {
            setGlobalHeaders([]);
        }
    }, []);
    useEffect(() => {
        void loadHistory();
        refreshGlobalHeaders();
        const onFocus = () => refreshGlobalHeaders();
        const onVisibility = () => {
            if (document.visibilityState === "visible")
                refreshGlobalHeaders();
        };
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [loadHistory, refreshGlobalHeaders]);
    const runExtractionFromText = useCallback((text) => {
        if (!text.trim()) {
            setError("Paste JSON first.");
            setResult(null);
            setStats(null);
            setRawJson(null);
            return;
        }
        try {
            const parsed = JSON.parse(text);
            const output = extractBootstrapData(parsed);
            let payloadToSave;
            try {
                payloadToSave = structuredClone(parsed);
            }
            catch {
                payloadToSave = JSON.parse(JSON.stringify(parsed));
            }
            const rawRows = getSalesChainsRows(payloadToSave);
            if (rawRows.length > 0) {
                const glMap = new Map();
                if (Array.isArray(output.glAccounts)) {
                    output.glAccounts.forEach((acc) => glMap.set(acc.id, acc));
                }
                const decodedRows = rawRows.map((row) => {
                    const decodedRow = { ...row };
                    ["saleAccountId", "costOfSaleAccountId", "costOffsetAccountId"].forEach((key) => {
                        const acctId = row[key];
                        if (acctId) {
                            const gl = glMap.get(String(acctId));
                            if (gl) {
                                decodedRow[`${key}_Name`] = gl.accountName;
                                decodedRow[`${key}_Number`] = gl.accountNumber;
                                decodedRow[`${key}_Type`] = gl.accountTypeId;
                            }
                        }
                    });
                    return decodedRow;
                });
                output.SalesChains_Decoded = decodedRows;
                const rootData = (asObject(payloadToSave.data) ? payloadToSave.data : payloadToSave);
                if (rootData) {
                    rootData.SalesChains_Decoded = decodedRows;
                }
            }
            setResult(output);
            setRawJson(payloadToSave);
            setStats(computeStats(output));
            setError(null);
            return output;
        }
        catch (e) {
            setError(e instanceof Error ? e.message : "Invalid JSON");
            setResult(null);
            setStats(null);
            setRawJson(null);
            return null;
        }
    }, []);
    const handleLoad = useCallback((record) => {
        try {
            const rec = record;
            const output = (rec.data || rec.extractedData);
            setResult(output);
            setRawJson(rec.rawPayload || rec.data || rec.extractedData || {});
            setStats(computeStats(output));
            setError(null);
            setSaveMsg({ ok: true, text: `📂 Loaded snapshot for dealer: ${record.dealerName}` });
            setShowHistory(false);
        }
        catch {
            setError("Failed to load snapshot");
        }
    }, []);
    const handleExtract = useCallback(() => {
        setFetchMsg(null);
        setSaveMsg(null);
        void runExtractionFromText(jsonText);
    }, [jsonText, runExtractionFromText]);
    const handleFetchBootstrap = useCallback(async () => {
        setFetchMsg(null);
        setSaveMsg(null);
        setError(null);
        refreshGlobalHeaders();
        const currentHeaders = toEnabledHeaderMap(loadGlobalHeaders());
        const dealerId = extractDealerIdFromHeaders(currentHeaders);
        if (!dealerId) {
            setFetchMsg({
                ok: false,
                text: "No dealerid found in enabled Global Headers. Select a dealer in Settings first.",
            });
            return;
        }
        if (Object.keys(currentHeaders).length === 0) {
            setFetchMsg({
                ok: false,
                text: "No enabled Global Headers found. Select a dealer in Settings first.",
            });
            return;
        }
        setFetchingBootstrap(true);
        try {
            const proxyRes = await fetch("http://localhost:4000/api/proxy", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    url: BOOTSTRAP_URL,
                    method: "POST",
                    headers: currentHeaders,
                    body: buildBootstrapRequestBody(dealerId),
                    timeout: 60000,
                }),
            });
            if (!proxyRes.ok) {
                throw new Error(`Proxy request failed with HTTP ${proxyRes.status}`);
            }
            const proxyJson = (await proxyRes.json());
            if ((proxyJson.status ?? 200) >= 400) {
                throw new Error(`Bootstrap request failed: ${proxyJson.status ?? ""} ${proxyJson.statusText ?? ""}`.trim());
            }
            const actualPayload = proxyJson.body ?? proxyJson.data ?? proxyJson;
            const rawResponseText = JSON.stringify(actualPayload, null, 2);
            setJsonText(rawResponseText);
            const output = runExtractionFromText(rawResponseText);
            if (!output) {
                setFetchMsg({
                    ok: false,
                    text: `Bootstrap fetched for dealer ${dealerId}, but extraction failed.`,
                });
                return;
            }
            setFetchMsg({
                ok: true,
                text: `✅ Bootstrap fetched and extracted for dealer ${dealerId}`,
            });
        }
        catch (e) {
            setFetchMsg({
                ok: false,
                text: e instanceof Error ? e.message : "Failed to fetch bootstrap response",
            });
        }
        finally {
            setFetchingBootstrap(false);
            refreshGlobalHeaders();
        }
    }, [refreshGlobalHeaders, runExtractionFromText]);
    const handleClear = useCallback(() => {
        setJsonText("");
        setResult(null);
        setRawJson(null);
        setStats(null);
        setError(null);
        setSaveMsg(null);
        setFetchMsg(null);
    }, []);
    const handleFile = useCallback((e) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        const reader = new FileReader();
        reader.onload = (ev) => setJsonText(ev.target?.result);
        reader.readAsText(file);
        e.target.value = "";
    }, []);
    const handleSave = async () => {
        if (!result || result.dealerId === "UNKNOWN")
            return;
        setSaving(true);
        setSaveMsg(null);
        try {
            const timestamp = new Date().toISOString();
            const res = await fetch("http://localhost:4000/api/validation/save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    dealerId: result.dealerId,
                    bootstrap: result,
                    timestamp: timestamp.replace(/[:.]/g, "-"),
                }),
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            const data = (await res.json());
            let rawPayload = undefined;
            try {
                rawPayload = jsonText ? JSON.parse(jsonText) : undefined;
            }
            catch {
                rawPayload = undefined;
            }
            await idbSaveBootstrapWithRawSections({
                key: result.dealerId,
                dealerName: result.dealerId,
                envName: result.dealerId,
                extractedData: result,
                rawPayload,
                savedAt: timestamp,
            });
            await loadHistory();
            setSaveMsg({
                ok: true,
                text: `✅ Saved snapshot for dealer: ${data.timestamp ?? result.dealerId}`,
            });
        }
        catch (err) {
            setSaveMsg({
                ok: false,
                text: err instanceof Error ? err.message : "Save failed",
            });
        }
        finally {
            setSaving(false);
        }
    };
    const handleDownloadJSON = () => result && downloadFile(JSON.stringify(result, null, 2), "bootstrap.json", "application/json");
    const handleDownloadCSV = () => result && downloadFile(toCsvString(result), "bootstrap.csv", "text/csv");
    const handleHistoryDownloadJson = (record) => {
        const tag = `bootstrap__${record.dealerName}__${record.savedAt.replace(/[:.]/g, "-")}`;
        const rec = record;
        const dataToDownload = rec.data || rec.extractedData;
        downloadFile(JSON.stringify(dataToDownload, null, 2), `${tag}.json`, "application/json");
    };
    const handleHistoryDownloadCsv = (record) => {
        const tag = `bootstrap__${record.dealerName}__${record.savedAt.replace(/[:.]/g, "-")}`;
        const rec = record;
        const dataToDownload = rec.data || rec.extractedData;
        downloadFile(toCsvString(dataToDownload), `${tag}.csv`, "text/csv");
    };
    const handleIdbDelete = async (key) => {
        try {
            await idbDeleteBootstrap(key);
            await loadHistory();
        }
        catch {
            /* silent */
        }
    };
    const salesChainsCount = useMemo(() => {
        if (!rawJson)
            return 0;
        return getSalesChainsRows(rawJson).length;
    }, [rawJson]);
    const TABS = [
        ["glAccounts", "GL Accounts", stats?.totalGLAccounts],
        ["costCenter", "Cost Centers", stats?.costCenterKeysFound],
        ["journals", "Journals", stats?.totalJournals],
        ["salesChains", "Sales Chains", salesChainsCount],
    ];
    const allKeysFound = stats
        ? stats.costCenterKeysFound === stats.costCenterKeysExpected
        : null;
    return (_jsxs("div", { className: "bx-shell", children: [_jsxs("div", { className: "bx-header", children: [_jsxs("div", { className: "bx-header-left", children: [_jsx("button", { className: "btn-secondary btn-sm", onClick: onBack, children: "\u2190 Back" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => setShowLeftPanel((prev) => !prev), title: showLeftPanel ? "Collapse left panel" : "Expand left panel", children: showLeftPanel ? "◀ Hide Panel" : "▶ Show Panel" }), _jsx("span", { className: "bx-title", children: "\uD83D\uDDC3 Bootstrap Extractor" })] }), stats && (_jsxs("div", { className: "bx-stats-row", children: [_jsxs("span", { className: "bx-stat", children: [_jsx("b", { children: stats.totalGLAccounts }), " GL accounts"] }), _jsxs("span", { className: "bx-stat", children: [_jsxs("b", { style: { color: allKeysFound ? "#30d158" : "#ff9f0a" }, children: [stats.costCenterKeysFound, "/", stats.costCenterKeysExpected] }), " ", "keys", !allKeysFound && (_jsxs("span", { className: "bx-missing-hint", children: ["\u00A0(missing: ", stats.missingKeys.join(", "), ")"] }))] }), _jsxs("span", { className: "bx-stat", children: [_jsx("b", { children: stats.totalJournals }), " journals"] }), _jsxs("span", { className: "bx-stat", children: [_jsx("b", { children: salesChainsCount }), " salesChains"] })] })), result && (_jsxs("div", { style: { display: "flex", gap: "8px" }, children: [_jsx("button", { className: "btn-secondary btn-sm", onClick: handleDownloadJSON, children: "\u2B07 JSON" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: handleDownloadCSV, children: "\u2B07 CSV" })] }))] }), _jsxs("div", { className: "bx-body", style: !showLeftPanel ? { gridTemplateColumns: "1fr" } : undefined, children: [showLeftPanel && (_jsxs("div", { className: "bx-input-panel", children: [_jsxs("div", { style: {
                                    marginBottom: 14,
                                    padding: 12,
                                    borderRadius: 14,
                                    border: "1px solid rgba(59,130,246,0.18)",
                                    background: "rgba(59,130,246,0.08)",
                                    display: "grid",
                                    gap: 10,
                                }, children: [_jsx("div", { style: { color: "#f8fafc", fontWeight: 700, fontSize: 14 }, children: "\u26A1 Auto Fetch from Selected Dealer Headers" }), _jsx("div", { style: { color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }, children: "Uses the enabled Global Headers from Settings. Select a dealer in Captured Dealer Profiles, then fetch the bootstrap response automatically." }), _jsxs("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 }, children: [_jsxs("span", { style: {
                                                    padding: "6px 10px",
                                                    borderRadius: 999,
                                                    border: "1px solid rgba(255,255,255,0.08)",
                                                    background: "rgba(255,255,255,0.04)",
                                                    color: "#cbd5e1",
                                                    fontSize: 12,
                                                }, children: ["Enabled Headers: ", _jsx("b", { style: { color: "#f8fafc" }, children: enabledHeaderCount })] }), _jsxs("span", { style: {
                                                    padding: "6px 10px",
                                                    borderRadius: 999,
                                                    border: "1px solid rgba(255,255,255,0.08)",
                                                    background: "rgba(255,255,255,0.04)",
                                                    color: "#cbd5e1",
                                                    fontSize: 12,
                                                }, children: ["Dealer ID: ", _jsx("b", { style: { color: detectedDealerId ? "#86efac" : "#fca5a5" }, children: detectedDealerId ?? "Not found" })] })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-postman", onClick: () => void handleFetchBootstrap(), disabled: fetchingBootstrap || !detectedDealerId || enabledHeaderCount === 0, children: fetchingBootstrap ? "Fetching..." : "⇢ Fetch Bootstrap" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: refreshGlobalHeaders, children: "\u27F3 Refresh Headers" })] }), fetchMsg ? (_jsx("div", { style: {
                                            color: fetchMsg.ok ? "#bbf7d0" : "#fecaca",
                                            background: fetchMsg.ok
                                                ? "rgba(34,197,94,0.10)"
                                                : "rgba(239,68,68,0.10)",
                                            border: fetchMsg.ok
                                                ? "1px solid rgba(34,197,94,0.22)"
                                                : "1px solid rgba(239,68,68,0.22)",
                                            borderRadius: 12,
                                            padding: "10px 12px",
                                            fontSize: 13,
                                        }, children: fetchMsg.text })) : null] }), _jsx("div", { className: "bx-panel-label", children: "Paste Bootstrap Response JSON" }), _jsx("textarea", { className: "bx-json-textarea", value: jsonText, onChange: (e) => setJsonText(e.target.value), placeholder: `Paste full bootstrap API response...\n\n{\n  "data": {\n    "allAccounts": { ... },\n    "customField": { ... },\n    "allJournals": { ... },\n    "salesChains": { ... }\n  }\n}`, spellCheck: false }), error && _jsxs("div", { className: "bx-error", children: ["\u26A0 ", error] }), _jsxs("div", { className: "bx-input-actions", children: [_jsx("button", { className: "btn-postman", onClick: handleExtract, children: "\u25B6 Extract" }), _jsx("button", { className: "btn-cancel-bulk", onClick: handleClear, children: "\u2715 Clear" }), _jsx("button", { className: "btn-secondary btn-sm", title: "Upload .json file", onClick: () => fileRef.current?.click(), children: "\uD83D\uDCC2 Upload File" }), _jsx("input", { ref: fileRef, type: "file", accept: ".json", style: { display: "none" }, onChange: handleFile })] }), result && (_jsxs("div", { className: "glv-save-block", children: [_jsxs("div", { className: "glv-step-label", children: [_jsx("span", { className: "glv-step-num", children: "\uD83D\uDCBE" }), " Save for GL Validation"] }), _jsxs("div", { className: "bd-save-key-row", children: [_jsx("span", { className: "bd-save-key-label", children: "Dealer ID" }), _jsx("span", { className: "bd-save-key-value", children: result.dealerId })] }), _jsx("button", { className: "btn-primary", style: { width: "100%" }, disabled: result.dealerId === "UNKNOWN" || saving, onClick: handleSave, children: saving ? "Saving…" : "💾 Save Snapshot" }), saveMsg && (_jsx("div", { className: saveMsg.ok ? "glv-save-ok" : "bx-error", children: saveMsg.text }))] })), _jsxs("div", { className: "bx-legend", children: [_jsx("div", { className: "bx-legend-title", children: "Cost Center Keys (5)" }), [...COST_CENTER_KEYS].map((key) => {
                                        const found = stats?.foundKeys.includes(key);
                                        return (_jsxs("div", { className: "bx-legend-row", children: [_jsx("span", { children: found === undefined ? "○" : found ? "✅" : "❌" }), _jsx("code", { className: "bx-legend-key", children: key }), found === false && _jsx("span", { className: "bx-legend-miss", children: "missing" })] }, key));
                                    })] }), _jsxs("div", { className: "bx-history-section", children: [_jsxs("button", { className: "bx-history-toggle", onClick: () => setShowHistory((v) => !v), children: [_jsxs("span", { children: ["\uD83D\uDCDA Saved Snapshots (", idbHistory.length, ")"] }), _jsx("span", { children: showHistory ? "▲" : "▼" })] }), showHistory && (_jsx(HistoryPanel, { records: idbHistory, onLoad: handleLoad, onDelete: handleIdbDelete, onDownloadJson: handleHistoryDownloadJson, onDownloadCsv: handleHistoryDownloadCsv }))] })] })), _jsx("div", { className: "bx-output-panel", style: {
                            gridColumn: !showLeftPanel ? "1 / -1" : undefined,
                            width: "100%",
                            minWidth: 0,
                        }, children: !result ? (_jsxs("div", { className: "bx-empty-state", children: [_jsx("span", { className: "bx-empty-icon", children: "\uD83D\uDDC3" }), _jsxs("p", { children: ["Paste JSON and click ", _jsx("strong", { children: "Extract" })] }), _jsx("p", { className: "bx-empty-sub", children: "Supports bootstrapresponse.json" })] })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "bx-tabs-bar", children: _jsx("div", { className: "kv-mode-tabs", children: TABS.map(([id, label, count]) => (_jsxs("button", { className: `kv-mode-btn ${tab === id ? "kv-mode-active" : ""}`, onClick: () => setTab(id), children: [label, count !== undefined && _jsx("span", { className: "bx-tab-count", children: count })] }, id))) }) }), _jsxs("div", { className: "bx-output-content", children: [tab === "glAccounts" && _jsx(GLAccountsView, { accounts: result.glAccounts }), tab === "costCenter" && stats && (_jsx(CostCenterView, { setup: result.costCenterSetup, stats: stats })), tab === "journals" && _jsx(JournalsView, { journals: result.journals }), tab === "salesChains" && (_jsx(SalesChainsView, { data: rawJson, glAccounts: result.glAccounts }))] })] })) })] })] }));
};
export default BootstrapExtractor;
