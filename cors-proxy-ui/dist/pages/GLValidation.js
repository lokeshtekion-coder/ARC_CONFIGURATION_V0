import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { idbGetAllBlueprints } from "../utils/blueprintDb";
import { idbGetAllBootstraps } from "../utils/bootstrapDb";
import { getStores } from "../services/storesDb";
function normalize(value) {
    return String(value ?? "").trim();
}
function normalizeLower(value) {
    return normalize(value).toLowerCase();
}
function fmt(value) {
    if (value === null || value === undefined)
        return "";
    if (typeof value === "string")
        return value.trim();
    if (typeof value === "boolean")
        return value ? "true" : "false";
    if (typeof value === "number")
        return String(value);
    if (Array.isArray(value))
        return value.map((x) => fmt(x)).filter(Boolean).join(", ");
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function isAccountingBlueprintForm(formName) {
    const name = normalizeLower(formName);
    return (name.includes("blueprint") &&
        name.includes("conquest") &&
        name.includes("accounting"));
}
function getBootstrapDealerId(record) {
    const raw = record.data;
    const directDealerId = normalize(raw?.dealerId);
    if (directDealerId)
        return directDealerId;
    const wrappedDealerId = normalize(raw?.bootstrap?.dealerId);
    if (wrappedDealerId)
        return wrappedDealerId;
    const nestedDealerId = normalize(raw?.data?.dealerId);
    if (nestedDealerId)
        return nestedDealerId;
    const nestedNestedDealerId = normalize(raw?.data?.data?.dealerId);
    if (nestedNestedDealerId)
        return nestedNestedDealerId;
    const glDealerId = normalize(raw?.glDealerId);
    if (glDealerId)
        return glDealerId;
    const nestedGlDealerId = normalize(raw?.data?.glDealerId);
    if (nestedGlDealerId)
        return nestedGlDealerId;
    const nestedKeys = Object.keys(raw?.data?.allAccounts?.dealerAssetDocMap ?? {});
    if (nestedKeys.length > 0)
        return normalize(nestedKeys[0]);
    const nestedNestedKeys = Object.keys(raw?.data?.data?.allAccounts?.dealerAssetDocMap ?? {});
    if (nestedNestedKeys.length > 0)
        return normalize(nestedNestedKeys[0]);
    const rootKeys = Object.keys(raw?.allAccounts?.dealerAssetDocMap ?? {});
    if (rootKeys.length > 0)
        return normalize(rootKeys[0]);
    return normalize(record.key);
}
function getBlueprintFlatRows(record) {
    const decoded = record.decodedResponse;
    if (Array.isArray(decoded?.populatedFlatRows))
        return decoded.populatedFlatRows;
    if (Array.isArray(decoded?.allFields))
        return decoded.allFields;
    const data = record.data;
    if (Array.isArray(data?.populatedFlatRows))
        return data.populatedFlatRows;
    if (Array.isArray(data?.allFields))
        return data.allFields;
    return [];
}
function extractBootstrapAccounts(record, dealerId) {
    if (!record)
        return [];
    const raw = record.data;
    const requestedDealerId = normalize(dealerId);
    const detectedDealerId = getBootstrapDealerId(record);
    const dealerIds = Array.from(new Set([requestedDealerId, detectedDealerId].filter(Boolean)));
    const results = [];
    function pushAccount(item) {
        if (!item || typeof item !== "object")
            return;
        const obj = item;
        const accountNumber = normalize(obj.accountNumber) ||
            normalize(obj["#"]) ||
            normalize(obj["account_number"]);
        const accountName = normalize(obj.accountName) ||
            normalize(obj["NAME"]) ||
            normalize(obj["account_name"]);
        const id = normalize(obj.id) || normalize(obj["ID"]);
        const key = normalize(obj.key) || normalize(obj["KEY"]);
        const accountType = normalize(obj.accountTypeId) ||
            normalize(obj["TYPE"]) ||
            normalize(obj["accountType"]);
        if (!accountNumber && !accountName && !id && !key)
            return;
        results.push({
            id,
            key,
            accountNumber,
            accountName,
            accountType,
        });
    }
    function pushArray(arr) {
        if (!Array.isArray(arr))
            return;
        for (const item of arr) {
            pushAccount(item);
        }
    }
    function pushFromContainer(container) {
        if (Array.isArray(container)) {
            for (const item of container)
                pushAccount(item);
            return;
        }
        if (container && typeof container === "object") {
            for (const value of Object.values(container)) {
                if (Array.isArray(value)) {
                    for (const item of value)
                        pushAccount(item);
                }
                else {
                    pushAccount(value);
                }
            }
        }
    }
    pushArray(raw?.glAccounts);
    pushArray(raw?.data?.glAccounts);
    pushArray(raw?.data?.data?.glAccounts);
    pushArray(raw?.bootstrap?.glAccounts);
    pushArray(raw?.body?.glAccounts);
    pushArray(raw?.body?.data?.glAccounts);
    pushArray(raw?.body?.data?.data?.glAccounts);
    for (const candidateDealerId of dealerIds) {
        pushArray(raw?.data?.allAccounts?.dealerAssetDocMap?.[candidateDealerId]);
        pushArray(raw?.data?.data?.allAccounts?.dealerAssetDocMap?.[candidateDealerId]);
        pushArray(raw?.allAccounts?.dealerAssetDocMap?.[candidateDealerId]);
        pushArray(raw?.body?.data?.allAccounts?.dealerAssetDocMap?.[candidateDealerId]);
        pushArray(raw?.body?.data?.data?.allAccounts?.dealerAssetDocMap?.[candidateDealerId]);
    }
    pushFromContainer(raw?.allAccounts?.dealerAssetDocMap);
    pushFromContainer(raw?.data?.allAccounts?.dealerAssetDocMap);
    pushFromContainer(raw?.data?.data?.allAccounts?.dealerAssetDocMap);
    pushFromContainer(raw?.body?.data?.allAccounts?.dealerAssetDocMap);
    pushFromContainer(raw?.body?.data?.data?.allAccounts?.dealerAssetDocMap);
    pushFromContainer(raw?.allAccounts?.masterAssetDocMap);
    pushFromContainer(raw?.data?.allAccounts?.masterAssetDocMap);
    pushFromContainer(raw?.data?.data?.allAccounts?.masterAssetDocMap);
    pushFromContainer(raw?.body?.data?.allAccounts?.masterAssetDocMap);
    pushFromContainer(raw?.body?.data?.data?.allAccounts?.masterAssetDocMap);
    const deduped = new Map();
    for (const account of results) {
        const dedupeKey = `${account.id}__${account.key}__${account.accountNumber}__${account.accountName}`;
        if (!deduped.has(dedupeKey)) {
            deduped.set(dedupeKey, account);
        }
    }
    return Array.from(deduped.values());
}
function looksLikeAccountingField(row) {
    const text = [
        normalizeLower(row.title),
        normalizeLower(row.sectionName),
        normalizeLower(row.subsectionName),
    ].join(" ");
    if (!text)
        return false;
    if (!text.includes("account"))
        return false;
    return true;
}
function isDocumentLikeDecodedValue(value) {
    const lower = normalizeLower(value);
    if (!lower)
        return false;
    if (lower.includes('"mediaid"') ||
        lower.includes('"uploadstatus"') ||
        lower.includes('"filename"') ||
        lower.includes('"mimetype"') ||
        lower.includes('"mediacategory"') ||
        lower.includes('"url"') ||
        lower.includes('"mediasize"') ||
        lower.includes('"createdtime"')) {
        return true;
    }
    if (lower.includes("application/vnd.ms-excel") ||
        lower.includes("application/pdf") ||
        lower.includes("image/png") ||
        lower.includes("image/jpeg") ||
        lower.includes("http://") ||
        lower.includes("https://") ||
        lower.includes(".xls") ||
        lower.includes(".xlsx") ||
        lower.includes(".pdf") ||
        lower.includes(".doc") ||
        lower.includes(".docx")) {
        return true;
    }
    try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            const obj = parsed;
            const keys = Object.keys(obj).map((k) => k.toLowerCase());
            const docKeys = [
                "mediaid",
                "uploadstatus",
                "filename",
                "mimetype",
                "mediacategory",
                "url",
                "mediasize",
                "createdtime",
            ];
            if (docKeys.some((key) => keys.includes(key))) {
                return true;
            }
        }
    }
    catch {
        // ignore
    }
    return false;
}
function extractTokens(value) {
    const input = normalize(value);
    if (!input)
        return [];
    const found = new Set();
    const broadMatches = input.match(/\b[A-Za-z0-9][A-Za-z0-9/_-]{1,}\b/g) ?? [];
    for (const raw of broadMatches) {
        const token = normalize(raw);
        if (!token)
            continue;
        if (/[0-9]/.test(token)) {
            found.add(token);
        }
        const parts = token.split(/[-/_]/).map((x) => normalize(x)).filter(Boolean);
        for (const part of parts) {
            if (/[0-9]/.test(part)) {
                found.add(part);
            }
        }
        const alphaNumChunks = token.match(/[A-Za-z]*\d+[A-Za-z\d]*/g) ?? [];
        for (const chunk of alphaNumChunks) {
            if (/[0-9]/.test(chunk)) {
                found.add(normalize(chunk));
            }
        }
        const numericChunks = token.match(/\d{2,}/g) ?? [];
        for (const chunk of numericChunks) {
            found.add(normalize(chunk));
        }
    }
    return Array.from(found).sort((a, b) => {
        const aHasSep = /[-/_]/.test(a) ? 1 : 0;
        const bHasSep = /[-/_]/.test(b) ? 1 : 0;
        if (aHasSep !== bHasSep)
            return bHasSep - aHasSep;
        const aAlpha = /[A-Za-z]/.test(a) ? 1 : 0;
        const bAlpha = /[A-Za-z]/.test(b) ? 1 : 0;
        if (aAlpha !== bAlpha)
            return bAlpha - aAlpha;
        return b.length - a.length;
    });
}
function detectTerminology(row) {
    const text = [
        normalizeLower(row.title),
        normalizeLower(row.sectionName),
        normalizeLower(row.subsectionName),
    ].join(" ");
    const hits = [];
    if (text.includes("sale"))
        hits.push("sale");
    if (text.includes("cost"))
        hits.push("cost");
    if (text.includes("inventory"))
        hits.push("inventory");
    if (text.includes("receivable"))
        hits.push("receivable");
    if (text.includes("payable"))
        hits.push("payable");
    if (text.includes("cash"))
        hits.push("cash");
    if (text.includes("tax"))
        hits.push("tax");
    if (text.includes("discount"))
        hits.push("discount");
    if (text.includes("reserve"))
        hits.push("reserve");
    if (text.includes("expense"))
        hits.push("expense");
    if (text.includes("liability"))
        hits.push("liability");
    if (text.includes("asset"))
        hits.push("asset");
    if (text.includes("revenue"))
        hits.push("revenue");
    return hits;
}
function scoreAccountMatch(account, token, dealerId) {
    const t = normalize(token);
    const accountNumber = normalize(account.accountNumber);
    const accountId = normalize(account.id);
    const accountKey = normalize(account.key);
    if (!t)
        return -1;
    if (accountNumber === t)
        return 1000;
    if (accountId === t)
        return 950;
    if (accountId === `${dealerId}_${t}`)
        return 930;
    if (accountKey === t)
        return 900;
    if (accountKey === `${dealerId}_${dealerId}_${t}`)
        return 890;
    if (accountId.endsWith(`_${t}`))
        return 850;
    if (accountKey.endsWith(`_${t}`))
        return 840;
    if (accountId.includes(`_${t}_`))
        return 800;
    if (accountKey.includes(`_${t}_`))
        return 790;
    if (accountId.includes(`-${t}`) || accountKey.includes(`-${t}`))
        return 760;
    if (accountNumber.replace(/\s+/g, "") === t.replace(/\s+/g, ""))
        return 740;
    return -1;
}
function findBestAccountForToken(bootstrapAccounts, token, dealerId) {
    let best = null;
    let bestScore = -1;
    for (const account of bootstrapAccounts) {
        const score = scoreAccountMatch(account, token, dealerId);
        if (score > bestScore) {
            best = account;
            bestScore = score;
        }
    }
    return bestScore >= 0 ? best : null;
}
function buildValidationResults(row) {
    const flatRows = getBlueprintFlatRows(row.blueprint).filter(looksLikeAccountingField);
    const dealerId = normalize(row.matchedDealerId || row.blueprintDealerId || row.storeDealerId);
    const bootstrapAccounts = extractBootstrapAccounts(row.bootstrap, dealerId);
    const results = [];
    console.log("[GL] dealerId", dealerId);
    console.log("[GL] bootstrap count", bootstrapAccounts.length);
    console.log("[GL] bootstrap has 201", bootstrapAccounts.find((a) => normalize(a.accountNumber) === "201") ?? null);
    for (const flatRow of flatRows) {
        const decodedValue = fmt(flatRow.decodedValue);
        if (!decodedValue)
            continue;
        if (isDocumentLikeDecodedValue(decodedValue)) {
            console.log("[GL] skipped document/media decoded value", decodedValue);
            continue;
        }
        const tokens = extractTokens(decodedValue);
        const terminology = detectTerminology(flatRow);
        if (tokens.length === 0) {
            results.push({
                decodedValue,
                extractedToken: "",
                accountNumber: "",
                id: "",
                accountName: "",
                matched: false,
                accountName_Detected: terminology,
            });
            continue;
        }
        for (const token of tokens) {
            const normalizedToken = normalize(token);
            const matchedAccount = findBestAccountForToken(bootstrapAccounts, normalizedToken, dealerId);
            results.push({
                decodedValue,
                extractedToken: normalizedToken,
                accountNumber: matchedAccount?.accountNumber ?? "",
                id: matchedAccount?.id ?? "",
                accountName: matchedAccount?.accountName ?? "",
                matched: Boolean(matchedAccount),
                accountName_Detected: terminology,
            });
        }
    }
    return results;
}
export const GLValidation = ({ onBack }) => {
    const [blueprints, setBlueprints] = useState([]);
    const [bootstraps, setBootstraps] = useState([]);
    const [stores, setStores] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [selectedPairKey, setSelectedPairKey] = useState("");
    const [results, setResults] = useState([]);
    const [resultFilter, setResultFilter] = useState("all");
    useEffect(() => {
        let cancelled = false;
        async function loadAll() {
            setLoading(true);
            setError(null);
            try {
                const [bp, bs, st] = await Promise.all([
                    idbGetAllBlueprints(),
                    idbGetAllBootstraps(),
                    getStores(),
                ]);
                if (cancelled)
                    return;
                setBlueprints(bp);
                setBootstraps(bs);
                setStores(st);
            }
            catch (e) {
                if (cancelled)
                    return;
                setError(e instanceof Error ? e.message : "Failed to load IndexedDB data");
            }
            finally {
                if (!cancelled)
                    setLoading(false);
            }
        }
        void loadAll();
        return () => {
            cancelled = true;
        };
    }, []);
    const accountingBlueprints = useMemo(() => blueprints.filter((row) => isAccountingBlueprintForm(row.formName)), [blueprints]);
    const rows = useMemo(() => {
        const storeByTekionId = new Map();
        const latestBootstrapByDealerId = new Map();
        for (const store of stores) {
            const tekionId = normalize(store.tekion_id);
            if (tekionId) {
                storeByTekionId.set(tekionId, store);
            }
        }
        for (const bootstrap of bootstraps) {
            const dealerId = getBootstrapDealerId(bootstrap);
            if (!dealerId)
                continue;
            const existing = latestBootstrapByDealerId.get(dealerId);
            if (!existing) {
                latestBootstrapByDealerId.set(dealerId, bootstrap);
                continue;
            }
            const existingTime = normalize(existing.savedAt);
            const nextTime = normalize(bootstrap.savedAt);
            if (nextTime > existingTime) {
                latestBootstrapByDealerId.set(dealerId, bootstrap);
            }
        }
        return accountingBlueprints.map((bp) => {
            const blueprintDealerId = normalize(bp.dealerId);
            const blueprintTekionId = normalize(bp.tekionId);
            const blueprintDealerName = normalize(bp.dealerName);
            const blueprintFormName = normalize(bp.formName);
            const storeFromTekion = blueprintTekionId
                ? storeByTekionId.get(blueprintTekionId) ?? null
                : null;
            const derivedDealerId = blueprintDealerId || normalize(storeFromTekion?.dealer_id);
            let matchedBootstrap = null;
            let matchSource = "none";
            if (blueprintDealerId && latestBootstrapByDealerId.has(blueprintDealerId)) {
                matchedBootstrap = latestBootstrapByDealerId.get(blueprintDealerId) ?? null;
                matchSource = "dealerId";
            }
            else if (derivedDealerId && latestBootstrapByDealerId.has(derivedDealerId)) {
                matchedBootstrap = latestBootstrapByDealerId.get(derivedDealerId) ?? null;
                matchSource = "storeMapping";
            }
            return {
                blueprintKey: bp.key,
                blueprintSavedAt: bp.savedAt,
                blueprintFormName,
                blueprintDealerId,
                blueprintTekionId,
                blueprintDealerName,
                matchedDealerId: derivedDealerId,
                bootstrapKey: matchedBootstrap?.key ?? null,
                bootstrapSavedAt: matchedBootstrap?.savedAt ?? null,
                bootstrapDealerName: matchedBootstrap?.dealerName ?? null,
                storeTekionId: normalize(storeFromTekion?.tekion_id) || null,
                storeDealerId: normalize(storeFromTekion?.dealer_id) || null,
                storeDbaName: normalize(storeFromTekion?.dba_name) || null,
                matchSource,
                matched: Boolean(matchedBootstrap),
                blueprint: bp,
                bootstrap: matchedBootstrap,
                store: storeFromTekion,
            };
        });
    }, [accountingBlueprints, bootstraps, stores]);
    useEffect(() => {
        const firstMatched = rows.find((row) => row.matched);
        if (!selectedPairKey && firstMatched) {
            setSelectedPairKey(`${firstMatched.blueprintKey}__${firstMatched.bootstrapKey ?? "none"}`);
        }
    }, [rows, selectedPairKey]);
    const matchedCount = rows.filter((r) => r.matched).length;
    const unmatchedCount = rows.filter((r) => !r.matched).length;
    const filteredRows = useMemo(() => {
        return rows
            .filter((r) => filter === "all" ? true :
            filter === "matched" ? r.matched :
                !r.matched)
            .filter((r) => {
            if (!search.trim())
                return true;
            const q = search.toLowerCase();
            return [
                r.blueprintFormName,
                r.blueprintDealerId,
                r.blueprintTekionId,
                r.blueprintDealerName,
                r.matchedDealerId,
                r.storeTekionId,
                r.storeDealerId,
                r.storeDbaName,
                r.bootstrapDealerName,
                r.bootstrapKey,
            ]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(q));
        });
    }, [rows, filter, search]);
    const selectedPair = useMemo(() => {
        return (rows.find((row) => `${row.blueprintKey}__${row.bootstrapKey ?? "none"}` === selectedPairKey) ?? null);
    }, [rows, selectedPairKey]);
    const handleRunValidation = () => {
        if (!selectedPair || !selectedPair.matched) {
            setResults([]);
            return;
        }
        const next = buildValidationResults(selectedPair);
        setResults(next);
        setResultFilter("all");
    };
    const resultMatched = results.filter((r) => r.matched).length;
    const resultUnmatched = results.filter((r) => !r.matched).length;
    const resultMatchPct = results.length > 0 ? ((resultMatched / results.length) * 100).toFixed(1) : "0.0";
    const filteredResults = useMemo(() => {
        return results
            .filter((r) => resultFilter === "all" ? true :
            resultFilter === "matched" ? r.matched :
                !r.matched)
            .filter((r) => {
            if (!search.trim())
                return true;
            const q = search.toLowerCase();
            return (r.extractedToken.toLowerCase().includes(q) ||
                r.accountNumber.toLowerCase().includes(q) ||
                r.accountName.toLowerCase().includes(q) ||
                r.decodedValue.toLowerCase().includes(q));
        });
    }, [results, resultFilter, search]);
    return (_jsxs("div", { className: "bx-shell", children: [_jsxs("div", { className: "bx-header", children: [_jsxs("div", { className: "bx-header-left", children: [_jsx("button", { className: "btn-secondary btn-sm", onClick: onBack, children: "\u2190 Back" }), _jsx("span", { className: "bx-title", children: "\uD83D\uDD0D GL Account Validation" })] }), !loading && (_jsxs("div", { className: "bx-stats-row", children: [_jsxs("span", { className: "bx-stat", children: ["Accounting Blueprints: ", _jsx("b", { children: accountingBlueprints.length })] }), _jsxs("span", { className: "bx-stat", style: { color: "#30d158" }, children: ["Pair Matched: ", _jsx("b", { children: matchedCount })] }), _jsxs("span", { className: "bx-stat", style: { color: "#ff453a" }, children: ["Pair Unmatched: ", _jsx("b", { children: unmatchedCount })] }), results.length > 0 && (_jsxs(_Fragment, { children: [_jsxs("span", { className: "bx-stat", style: { color: "#30d158" }, children: ["GL Matched: ", _jsxs("b", { children: [resultMatched, " (", resultMatchPct, "%)"] })] }), _jsxs("span", { className: "bx-stat", style: { color: "#ff453a" }, children: ["GL Unmatched: ", _jsx("b", { children: resultUnmatched })] })] }))] }))] }), _jsxs("div", { className: "bx-body", children: [_jsxs("div", { className: "bx-input-panel", children: [_jsx("span", { className: "bx-panel-label", children: "IndexedDB Sources" }), _jsxs("div", { className: "bx-legend", children: [_jsxs("div", { className: "bx-legend-row", children: [_jsx("span", { className: "bx-legend-key", children: "Blueprints" }), _jsx("span", { className: "bx-muted", children: blueprints.length })] }), _jsxs("div", { className: "bx-legend-row", children: [_jsx("span", { className: "bx-legend-key", children: "Accounting Blueprints" }), _jsx("span", { className: "bx-muted", children: accountingBlueprints.length })] }), _jsxs("div", { className: "bx-legend-row", children: [_jsx("span", { className: "bx-legend-key", children: "Bootstraps" }), _jsx("span", { className: "bx-muted", children: bootstraps.length })] }), _jsxs("div", { className: "bx-legend-row", children: [_jsx("span", { className: "bx-legend-key", children: "Stores" }), _jsx("span", { className: "bx-muted", children: stores.length })] })] }), error && _jsxs("div", { className: "bx-error", children: ["\u26A0 ", error] }), _jsx("div", { className: "bx-input-actions", children: _jsx("button", { className: "btn-secondary btn-sm", onClick: () => window.location.reload(), disabled: loading, children: loading ? "Loading..." : "⟳ Reload" }) }), _jsxs("div", { className: "bx-legend", style: { marginTop: 14 }, children: [_jsx("div", { className: "bx-legend-title", children: "Match Rules" }), _jsxs("div", { className: "bx-legend-row", children: [_jsx("span", { className: "bx-legend-key", children: "dealerId" }), _jsx("span", { className: "bx-muted", children: "blueprint.dealerId \u2192 bootstrap dealerId" })] }), _jsxs("div", { className: "bx-legend-row", children: [_jsx("span", { className: "bx-legend-key", children: "storeMapping" }), _jsx("span", { className: "bx-muted", children: "blueprint.tekionId \u2192 stores.dealer_id \u2192 bootstrap dealerId" })] }), _jsxs("div", { className: "bx-legend-row", children: [_jsx("span", { className: "bx-legend-key", children: "smart tokenization" }), _jsx("span", { className: "bx-muted", children: "supports 201, K448, 452-K448, 7269_201, etc." })] }), _jsxs("div", { className: "bx-legend-row", children: [_jsx("span", { className: "bx-legend-key", children: "exclude noise" }), _jsx("span", { className: "bx-muted", children: "skips media/document/url/json blob values" })] })] }), _jsxs("div", { style: { marginTop: 14 }, children: [_jsx("span", { className: "bx-panel-label", children: "Select Matched Pair" }), _jsxs("select", { className: "bx-json-textarea", style: { minHeight: "unset", height: "38px", padding: "6px 10px" }, value: selectedPairKey, onChange: (e) => {
                                            setSelectedPairKey(e.target.value);
                                            setResults([]);
                                        }, children: [_jsx("option", { value: "", children: "\u2014 Select Pair \u2014" }), rows
                                                .filter((row) => row.matched)
                                                .map((row) => {
                                                const value = `${row.blueprintKey}__${row.bootstrapKey ?? "none"}`;
                                                const label = `${row.matchedDealerId || row.blueprintDealerId || "—"} | ${row.blueprintFormName || "—"}`;
                                                return (_jsx("option", { value: value, children: label }, value));
                                            })] })] }), selectedPair && (_jsxs("div", { style: {
                                    marginTop: 12,
                                    padding: "10px 12px",
                                    borderRadius: 12,
                                    border: "1px solid rgba(255,255,255,0.08)",
                                    background: "rgba(255,255,255,0.03)",
                                    display: "grid",
                                    gap: 6,
                                    fontSize: 12,
                                }, children: [_jsxs("div", { children: [_jsx("b", { children: "Dealer:" }), " ", selectedPair.matchedDealerId || "—"] }), _jsxs("div", { children: [_jsx("b", { children: "Tekion:" }), " ", selectedPair.blueprintTekionId || "—"] }), _jsxs("div", { children: [_jsx("b", { children: "Form:" }), " ", selectedPair.blueprintFormName || "—"] }), _jsxs("div", { children: [_jsx("b", { children: "Blueprint Saved:" }), " ", selectedPair.blueprintSavedAt || "—"] }), _jsxs("div", { children: [_jsx("b", { children: "Bootstrap Saved:" }), " ", selectedPair.bootstrapSavedAt || "—"] })] })), _jsxs("div", { className: "bx-input-actions", style: { marginTop: 12 }, children: [_jsx("button", { className: "btn-primary", onClick: handleRunValidation, disabled: !selectedPair || !selectedPair.matched, children: "\u25B6 Run GL Validation" }), results.length > 0 && (_jsx("button", { className: "btn-secondary btn-sm", onClick: () => {
                                            setResults([]);
                                            setResultFilter("all");
                                        }, children: "Clear Results" }))] })] }), _jsx("div", { className: "bx-output-panel", children: loading ? (_jsxs("div", { className: "bx-empty-state", children: [_jsx("span", { className: "bx-empty-icon", children: "\u23F3" }), _jsx("span", { children: "Loading IndexedDB data\u2026" })] })) : rows.length === 0 ? (_jsxs("div", { className: "bx-empty-state", children: [_jsx("span", { className: "bx-empty-icon", children: "\uD83D\uDCED" }), _jsx("span", { children: "No Blueprint conquest Accounting records found" }), _jsx("span", { className: "bx-empty-sub", children: "Save accounting blueprint responses first" })] })) : results.length === 0 ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "bx-tabs-bar", children: _jsx("div", { style: { display: "flex", gap: 6 }, children: ["all", "matched", "unmatched"].map((f) => {
                                            const count = f === "all" ? rows.length :
                                                f === "matched" ? matchedCount :
                                                    unmatchedCount;
                                            return (_jsxs("button", { className: `tab-btn ${filter === f ? "tab-active" : ""}`, onClick: () => setFilter(f), children: [f.charAt(0).toUpperCase() + f.slice(1), _jsx("span", { className: "bx-tab-count", children: count })] }, f));
                                        }) }) }), _jsxs("div", { className: "bx-output-content", children: [_jsxs("div", { className: "bx-search-bar", children: [_jsx("input", { className: "bx-search-input", placeholder: "Search dealerId, tekionId, dealer name, form name\u2026", value: search, onChange: (e) => setSearch(e.target.value) }), _jsxs("span", { className: "bx-count-badge", children: [filteredRows.length, " rows"] })] }), _jsx("div", { className: "bx-table-wrap", children: _jsxs("table", { className: "bx-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "#" }), _jsx("th", { children: "Blueprint Form" }), _jsx("th", { children: "Blueprint Dealer" }), _jsx("th", { children: "Tekion ID" }), _jsx("th", { children: "Store Dealer" }), _jsx("th", { children: "Matched Dealer" }), _jsx("th", { children: "Bootstrap" }), _jsx("th", { children: "Match Source" }), _jsx("th", { children: "Status" })] }) }), _jsx("tbody", { children: filteredRows.map((row, i) => (_jsxs("tr", { children: [_jsx("td", { className: "bx-muted bx-mono", children: i + 1 }), _jsxs("td", { children: [_jsx("div", { style: { fontWeight: 600 }, children: row.blueprintFormName || "—" }), _jsxs("div", { className: "bx-muted", style: { fontSize: 12 }, children: ["saved: ", row.blueprintSavedAt || "—"] })] }), _jsxs("td", { children: [_jsx("div", { children: row.blueprintDealerId || "—" }), _jsx("div", { className: "bx-muted", style: { fontSize: 12 }, children: row.blueprintDealerName || "—" })] }), _jsx("td", { className: "bx-mono", children: row.blueprintTekionId || "—" }), _jsxs("td", { children: [_jsx("div", { children: row.storeDealerId || "—" }), _jsx("div", { className: "bx-muted", style: { fontSize: 12 }, children: row.storeDbaName || "—" })] }), _jsx("td", { className: "bx-mono", children: row.matchedDealerId || "—" }), _jsx("td", { children: row.bootstrapKey ? (_jsxs(_Fragment, { children: [_jsx("div", { className: "bx-mono", children: row.bootstrapDealerName || "—" }), _jsxs("div", { className: "bx-muted", style: { fontSize: 12 }, children: ["saved: ", row.bootstrapSavedAt || "—"] })] })) : (_jsx("span", { className: "bx-muted", children: "\u2014" })) }), _jsx("td", { children: _jsx("span", { className: "bx-type-badge", style: row.matchSource === "dealerId"
                                                                            ? {
                                                                                color: "#30d158",
                                                                                borderColor: "rgba(48,209,88,.3)",
                                                                                background: "rgba(48,209,88,.08)",
                                                                            }
                                                                            : row.matchSource === "storeMapping"
                                                                                ? {
                                                                                    color: "#0a84ff",
                                                                                    borderColor: "rgba(10,132,255,.3)",
                                                                                    background: "rgba(10,132,255,.08)",
                                                                                }
                                                                                : {
                                                                                    color: "#98989d",
                                                                                    borderColor: "rgba(152,152,157,.3)",
                                                                                    background: "rgba(152,152,157,.08)",
                                                                                }, children: row.matchSource }) }), _jsx("td", { children: _jsx("span", { className: "bx-type-badge", style: row.matched
                                                                            ? {
                                                                                color: "#30d158",
                                                                                borderColor: "rgba(48,209,88,.3)",
                                                                                background: "rgba(48,209,88,.08)",
                                                                            }
                                                                            : {
                                                                                color: "#ff453a",
                                                                                borderColor: "rgba(255,69,58,.3)",
                                                                                background: "rgba(255,69,58,.08)",
                                                                            }, children: row.matched ? "✓ Matched" : "✗ Unmatched" }) })] }, `${row.blueprintKey}__${row.bootstrapKey ?? "none"}`))) })] }) }), _jsx("div", { style: { marginTop: 12, fontSize: 12, color: "#94a3b8" }, children: "Select one matched pair and click Run GL Validation." })] })] })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "bx-tabs-bar", children: _jsx("div", { style: { display: "flex", gap: "6px" }, children: ["all", "matched", "unmatched"].map((f) => {
                                            const count = f === "all"
                                                ? results.length
                                                : f === "matched"
                                                    ? resultMatched
                                                    : resultUnmatched;
                                            return (_jsxs("button", { className: `tab-btn ${resultFilter === f ? "tab-active" : ""}`, onClick: () => setResultFilter(f), children: [f.charAt(0).toUpperCase() + f.slice(1), _jsx("span", { className: "bx-tab-count", children: count })] }, f));
                                        }) }) }), _jsxs("div", { className: "bx-output-content", children: [_jsxs("div", { className: "bx-search-bar", children: [_jsx("input", { className: "bx-search-input", placeholder: "Search token, account #, account name\u2026", value: search, onChange: (e) => setSearch(e.target.value) }), _jsxs("span", { className: "bx-count-badge", children: [filteredResults.length, " rows"] })] }), _jsx("div", { className: "bx-table-wrap", children: _jsxs("table", { className: "bx-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "#" }), _jsx("th", { children: "Decoded Value" }), _jsx("th", { children: "Token" }), _jsx("th", { children: "Account #" }), _jsx("th", { children: "Account Name" }), _jsx("th", { children: "Matched" }), _jsx("th", { children: "Terminology Detected" })] }) }), _jsx("tbody", { children: filteredResults.map((r, i) => (_jsxs("tr", { children: [_jsx("td", { className: "bx-muted bx-mono", children: i + 1 }), _jsx("td", { children: r.decodedValue || _jsx("span", { className: "bx-muted", children: "\u2014" }) }), _jsx("td", { className: "bx-mono", children: r.extractedToken || _jsx("span", { className: "bx-muted", children: "\u2014" }) }), _jsx("td", { className: "bx-mono", children: r.accountNumber || _jsx("span", { className: "bx-muted", children: "\u2014" }) }), _jsx("td", { children: r.accountName || _jsx("span", { className: "bx-muted", children: "\u2014" }) }), _jsx("td", { children: _jsx("span", { className: "bx-type-badge", style: r.matched
                                                                            ? {
                                                                                color: "#30d158",
                                                                                borderColor: "rgba(48,209,88,.3)",
                                                                                background: "rgba(48,209,88,.08)",
                                                                            }
                                                                            : {
                                                                                color: "#ff453a",
                                                                                borderColor: "rgba(255,69,58,.3)",
                                                                                background: "rgba(255,69,58,.08)",
                                                                            }, children: r.matched ? "✓ Yes" : "✗ No" }) }), _jsx("td", { children: r.accountName_Detected.length > 0 ? (r.accountName_Detected.map((t, j) => (_jsx("span", { className: "bx-type-badge", style: {
                                                                            marginRight: 4,
                                                                            color: "#0a84ff",
                                                                            borderColor: "rgba(10,132,255,.3)",
                                                                            background: "rgba(10,132,255,.08)",
                                                                        }, children: t }, j)))) : (_jsx("span", { className: "bx-muted", children: "\u2014" })) })] }, `${r.extractedToken}-${r.id}-${i}`))) })] }) }), _jsx("div", { style: { marginTop: 12, fontSize: 12, color: "#94a3b8" }, children: "Smart validation excludes media/document/url blobs and supports composite values like 452-K448 by testing split token parts such as K448 and 452." })] })] })) })] })] }));
};
export default GLValidation;
