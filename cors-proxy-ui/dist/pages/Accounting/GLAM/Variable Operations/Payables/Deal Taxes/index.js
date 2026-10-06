import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GlamSectionHeader } from "../../../components/glamShared";
import { useAccountingBlueprint } from "../../../../../../Context/Blueprint_Accounting_Context/AccountingBlueprintContext";
import { idbGetAllBlueprints } from "../../../../../../utils/blueprintDb";
import { idbFindBootstrapByDealerId, } from "../../../../../../utils/bootstrapDb";
import { loadGlobalHeaders } from "../../../../../../services/tekionApiSettings";
import { idbSaveGlamMappingDraft, } from "../../../../../../utils/glamMappingDraftDb";
const GLAM_MAPPING_RULE_URL = "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/rule";
const MODULE = "PAYABLES";
const NAME = "Deal Taxes";
const RULE_ASSET = "GLACCOUNT";
const BLUEPRINT_SECTION = "Fixed Ops Other Accounts";
const LABOR_QUESTION = "Sales Tax - Labor GL Account";
const PARTS_QUESTION = "Sales Tax - Parts GL Account";
const DEAL_TAX_TYPES = [
    "SALES_TAX_VAR_OPS",
    "COUNTY_SALES_TAX",
    "CITY_TAX",
    "CAP_REDUCTION_TAX",
    "VIT_TAX",
    "BUSINESS_TAX",
    "BPOL_TAX",
    "LOCAL_TAX",
    "SINGLE_ARTICLE_TAX",
    "SERVICE_CONTRACTS_SALES_TAX",
    "CORPORATE_ACTIVITY_TAX",
    "LUXURY_TAX",
];
function normalize(value) {
    return String(value ?? "").trim();
}
function normalizeLower(value) {
    return normalize(value).toLowerCase();
}
function normalizeComparable(value) {
    return normalizeLower(value)
        .replace(/[–—]/g, "-")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function generateRowId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `deal-taxes-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function getDealerIdFromHeaders() {
    for (const header of loadGlobalHeaders()) {
        if (!header.enabled)
            continue;
        const key = normalizeLower(header.key);
        const value = normalize(header.value);
        if (value &&
            ["dealerid", "dealer-id", "x-dealer-id", "x-dealerid"].includes(key)) {
            return value;
        }
    }
    return "";
}
function extractGlAccountNumber(value) {
    const text = normalize(value);
    if (!text) {
        return null;
    }
    const lowered = normalizeLower(text);
    if (lowered === "n/a" ||
        lowered === "na" ||
        lowered === "none" ||
        lowered === "null" ||
        lowered === "not applicable") {
        return null;
    }
    return text.match(/\d{2,}/)?.[0] ?? null;
}
function resolveTaxGlAccount(laborRawValue, partsRawValue) {
    const laborValue = extractGlAccountNumber(laborRawValue);
    const partsValue = extractGlAccountNumber(partsRawValue);
    if (laborValue && partsValue) {
        if (laborValue === partsValue) {
            return {
                laborValue,
                partsValue,
                selectedValue: laborValue,
                status: "MATCHED",
                detail: `Labor and Parts both resolve to GL ${laborValue}.`,
            };
        }
        return {
            laborValue,
            partsValue,
            selectedValue: null,
            status: "MISMATCH",
            detail: `Sales Tax GL mismatch: Labor is ${laborValue}, but Parts is ${partsValue}. ` +
                "Correct the Blueprint before sending Deal Taxes to Tekion.",
        };
    }
    if (laborValue) {
        return {
            laborValue,
            partsValue,
            selectedValue: laborValue,
            status: "LABOR_ONLY",
            detail: `Sales Tax - Parts GL Account is empty or n/a. ` +
                `Using Labor GL ${laborValue} for all Deal Taxes mappings.`,
        };
    }
    if (partsValue) {
        return {
            laborValue,
            partsValue,
            selectedValue: partsValue,
            status: "PARTS_ONLY",
            detail: `Sales Tax - Labor GL Account is empty or n/a. ` +
                `Using Parts GL ${partsValue} for all Deal Taxes mappings.`,
        };
    }
    return {
        laborValue,
        partsValue,
        selectedValue: null,
        status: "MISSING",
        detail: "Both Sales Tax GL Account values are empty or n/a. Deal Taxes mappings use fallback 9999.",
    };
}
function getFlatRowsFromRecord(record) {
    const decoded = record.decodedResponse;
    if (Array.isArray(decoded?.populatedFlatRows)) {
        return decoded.populatedFlatRows;
    }
    if (Array.isArray(decoded?.allFields)) {
        return decoded.allFields;
    }
    const data = record.data;
    if (Array.isArray(data?.populatedFlatRows)) {
        return data.populatedFlatRows;
    }
    if (Array.isArray(data?.allFields)) {
        return data.allFields;
    }
    return [];
}
async function getIndexedDbBlueprintRows(dealerId) {
    const records = (await idbGetAllBlueprints());
    const matchingRecords = records
        .filter((record) => normalize(record.dealerId) === dealerId)
        .sort((a, b) => normalize(b.savedAt).localeCompare(normalize(a.savedAt)));
    for (const record of matchingRecords) {
        const rows = getFlatRowsFromRecord(record);
        if (rows.length > 0) {
            return rows;
        }
    }
    return [];
}
function findScopedBlueprintValue(rows, sectionName, questionTitle) {
    const expectedSection = normalizeComparable(sectionName);
    const expectedQuestion = normalizeComparable(questionTitle);
    const exact = rows.find((row) => {
        const rowTitle = normalizeComparable(row.title);
        const section = normalizeComparable(row.sectionName);
        const subsection = normalizeComparable(row.subsectionName);
        return (rowTitle === expectedQuestion &&
            (section === expectedSection || subsection === expectedSection));
    });
    if (exact) {
        return exact.decodedValue;
    }
    const loose = rows.find((row) => {
        const rowTitle = normalizeComparable(row.title);
        const section = normalizeComparable(row.sectionName);
        const subsection = normalizeComparable(row.subsectionName);
        return (rowTitle === expectedQuestion &&
            (section.includes(expectedSection) ||
                subsection.includes(expectedSection) ||
                expectedSection.includes(section) ||
                expectedSection.includes(subsection)));
    });
    if (loose) {
        return loose.decodedValue;
    }
    return rows.find((row) => normalizeComparable(row.title) === expectedQuestion)?.decodedValue;
}
function getBootstrapAccounts(record) {
    if (!record) {
        return [];
    }
    const found = new Map();
    const visited = new WeakSet();
    const visit = (value, depth = 0) => {
        if (!value || typeof value !== "object" || depth > 10) {
            return;
        }
        if (visited.has(value)) {
            return;
        }
        visited.add(value);
        if (Array.isArray(value)) {
            value.forEach((item) => visit(item, depth + 1));
            return;
        }
        const item = value;
        const accountNumber = normalize(item.accountNumber) ||
            normalize(item["#"]) ||
            normalize(item.account_number);
        const accountName = normalize(item.accountName) ||
            normalize(item.NAME) ||
            normalize(item.account_name);
        const id = normalize(item.id) || normalize(item.ID);
        const key = normalize(item.key) || normalize(item.KEY);
        if (accountNumber) {
            const account = {
                accountNumber,
                accountName,
                id,
                key,
                active: item.active !== false,
            };
            const dedupeKey = `${accountNumber}__${id}__${key}`;
            if (!found.has(dedupeKey)) {
                found.set(dedupeKey, account);
            }
        }
        Object.values(item).forEach((child) => visit(child, depth + 1));
    };
    visit(record.data);
    return Array.from(found.values());
}
function findBootstrapAccount(accountNumber, accounts) {
    if (!accountNumber) {
        return null;
    }
    return accounts.find((item) => item.accountNumber === accountNumber) ?? null;
}
function createMappingRow(dealerId, taxType, accountNumber) {
    const resolvedAccountNumber = accountNumber || "9999";
    return {
        rowId: generateRowId(),
        attributes: {
            SALES_TAX_TYPE: taxType,
        },
        mappedAssetId: `${dealerId}_${resolvedAccountNumber}`,
        mappedDealerId: dealerId,
        targetFieldToValueMapping: {},
    };
}
const cardStyle = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    padding: 16,
    minWidth: 0,
};
const headerStyle = {
    padding: "10px 12px",
    color: "#94a3b8",
    textAlign: "left",
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: "nowrap",
};
const cellStyle = {
    padding: "10px 12px",
    color: "#e2e8f0",
    verticalAlign: "top",
    fontSize: 12,
    borderTop: "1px solid rgba(255,255,255,0.06)",
};
const DealTaxesView = () => {
    const accountingBlueprint = useAccountingBlueprint();
    const [dealerId, setDealerId] = useState("");
    const [bootstrap, setBootstrap] = useState(null);
    const [blueprintRows, setBlueprintRows] = useState([]);
    const [mappingList, setMappingList] = useState([]);
    const [blueprintSource, setBlueprintSource] = useState("NOT_FOUND");
    const [loading, setLoading] = useState(true);
    const [deploying, setDeploying] = useState(false);
    const [message, setMessage] = useState(null);
    const [deployMessage, setDeployMessage] = useState(null);
    const contextBlueprintRows = useMemo(() => (accountingBlueprint.blueprint?.populatedFlatRows ??
        accountingBlueprint.blueprint?.allFields ??
        []), [accountingBlueprint.blueprint]);
    const bootstrapAccounts = useMemo(() => getBootstrapAccounts(bootstrap), [bootstrap]);
    const taxResolution = useMemo(() => {
        const laborValue = findScopedBlueprintValue(blueprintRows, BLUEPRINT_SECTION, LABOR_QUESTION);
        const partsValue = findScopedBlueprintValue(blueprintRows, BLUEPRINT_SECTION, PARTS_QUESTION);
        return resolveTaxGlAccount(laborValue, partsValue);
    }, [blueprintRows]);
    const selectedBootstrapAccount = useMemo(() => findBootstrapAccount(taxResolution.selectedValue, bootstrapAccounts), [bootstrapAccounts, taxResolution.selectedValue]);
    const saveDraft = useCallback(async (activeDealerId, rows) => {
        if (!activeDealerId) {
            return;
        }
        const payload = {
            module: MODULE,
            name: NAME,
            criteriaList: [],
            mappingColumns: ["SALES_TAX_TYPE"],
            mappingList: rows,
            ruleAsset: RULE_ASSET,
        };
        await idbSaveGlamMappingDraft(activeDealerId, payload);
    }, []);
    const buildRows = useCallback((activeDealerId, accountNumber) => DEAL_TAX_TYPES.map((taxType) => createMappingRow(activeDealerId, taxType, accountNumber)), []);
    const syncBlueprintAndBuildRows = useCallback(async () => {
        const resolvedDealerId = normalize(accountingBlueprint.selectedDealerId) || getDealerIdFromHeaders();
        if (!resolvedDealerId) {
            setDealerId("");
            setBootstrap(null);
            setBlueprintRows([]);
            setMappingList([]);
            setBlueprintSource("NOT_FOUND");
            setMessage("Dealer ID was not found. Select a Dealer Profile and apply Global Headers.");
            setLoading(false);
            return;
        }
        setLoading(true);
        setMessage(null);
        setDeployMessage(null);
        try {
            let rows = contextBlueprintRows;
            let source = "CONTEXT";
            if (rows.length === 0) {
                rows = await getIndexedDbBlueprintRows(resolvedDealerId);
                source = rows.length > 0 ? "INDEXED_DB" : "NOT_FOUND";
            }
            const foundBootstrap = await idbFindBootstrapByDealerId(resolvedDealerId);
            const laborRawValue = findScopedBlueprintValue(rows, BLUEPRINT_SECTION, LABOR_QUESTION);
            const partsRawValue = findScopedBlueprintValue(rows, BLUEPRINT_SECTION, PARTS_QUESTION);
            const resolution = resolveTaxGlAccount(laborRawValue, partsRawValue);
            const nextRows = rows.length
                ? buildRows(resolvedDealerId, resolution.status === "MISMATCH"
                    ? null
                    : resolution.selectedValue)
                : [];
            setDealerId(resolvedDealerId);
            setBlueprintRows(rows);
            setBootstrap(foundBootstrap);
            setBlueprintSource(source);
            setMappingList(nextRows);
            if (nextRows.length > 0) {
                await saveDraft(resolvedDealerId, nextRows);
            }
            if (!rows.length) {
                setMessage("No saved Accounting Blueprint was found. Sync/save the Accounting Blueprint first, then click Sync Blueprint & Build Rows.");
            }
            else if (resolution.status === "MISMATCH") {
                setMessage(resolution.detail);
            }
            else if (!foundBootstrap) {
                setMessage("Blueprint was loaded, but no Bootstrap snapshot was found. Deal Taxes rows were built, but GL validation is unavailable.");
            }
            else {
                setMessage(`Built ${nextRows.length} Deal Taxes rows from ${source === "CONTEXT"
                    ? "the active Accounting Blueprint"
                    : "saved Blueprint IndexedDB data"}.`);
            }
        }
        catch (error) {
            setMessage(error instanceof Error
                ? error.message
                : "Unable to sync Deal Taxes Blueprint/Bootstrap data.");
        }
        finally {
            setLoading(false);
        }
    }, [
        accountingBlueprint.selectedDealerId,
        buildRows,
        contextBlueprintRows,
        saveDraft,
    ]);
    useEffect(() => {
        void syncBlueprintAndBuildRows();
    }, [syncBlueprintAndBuildRows]);
    const restoreBlueprintRows = async () => {
        if (!dealerId || !blueprintRows.length) {
            setMessage("No Blueprint is loaded. Sync/save Accounting Blueprint first, then rebuild the Deal Taxes rows.");
            return;
        }
        const rows = buildRows(dealerId, taxResolution.status === "MISMATCH"
            ? null
            : taxResolution.selectedValue);
        setMappingList(rows);
        await saveDraft(dealerId, rows);
        setMessage(`Restored ${rows.length} standard Deal Taxes rows from current Blueprint values.`);
    };
    const updateMappedAssetId = (rowId, index, mappedAssetId) => {
        setMappingList((currentRows) => currentRows.map((row, rowIndex) => {
            const selected = rowId ? row.rowId === rowId : rowIndex === index;
            return selected
                ? {
                    ...row,
                    mappedAssetId,
                }
                : row;
        }));
    };
    const saveMappedAssetIdEdit = async (rowId, index, mappedAssetId) => {
        const updatedRows = mappingList.map((row, rowIndex) => {
            const selected = rowId ? row.rowId === rowId : rowIndex === index;
            return selected
                ? {
                    ...row,
                    mappedAssetId,
                }
                : row;
        });
        setMappingList(updatedRows);
        await saveDraft(dealerId, updatedRows);
    };
    const deleteRow = async (rowId, index) => {
        const row = mappingList[index];
        if (!row) {
            return;
        }
        const taxType = row.attributes.SALES_TAX_TYPE || "this Deal Taxes row";
        if (!window.confirm(`Remove "${taxType}" from the active payload and outgoing Tekion request?`)) {
            return;
        }
        const updatedRows = mappingList.filter((item, rowIndex) => rowId ? item.rowId !== rowId : rowIndex !== index);
        setMappingList(updatedRows);
        await saveDraft(dealerId, updatedRows);
        setMessage(`"${taxType}" was removed from the active payload.`);
    };
    const payloadPreview = useMemo(() => ({
        module: MODULE,
        name: NAME,
        criteriaList: [],
        mappingColumns: ["SALES_TAX_TYPE"],
        mappingList,
        ruleAsset: RULE_ASSET,
    }), [mappingList]);
    const deployToTekion = async () => {
        if (!dealerId) {
            setDeployMessage({
                ok: false,
                text: "Dealer ID is missing. Select a Dealer Profile in Settings first.",
            });
            return;
        }
        if (!blueprintRows.length) {
            setDeployMessage({
                ok: false,
                text: "Accounting Blueprint is not loaded. Sync/save Blueprint first, then rebuild the rows.",
            });
            return;
        }
        if (taxResolution.status === "MISMATCH") {
            setDeployMessage({
                ok: false,
                text: taxResolution.detail,
            });
            return;
        }
        if (mappingList.length === 0) {
            setDeployMessage({
                ok: false,
                text: "There are no active Deal Taxes mapping rows to send.",
            });
            return;
        }
        const blankRows = mappingList.filter((row) => !normalize(row.mappedAssetId));
        if (blankRows.length > 0) {
            setDeployMessage({
                ok: false,
                text: `${blankRows.length} row(s) have a blank mappedAssetId. Enter an account mapping or delete those rows before sending.`,
            });
            return;
        }
        const enabledHeaders = {};
        for (const header of loadGlobalHeaders()) {
            if (!header.enabled)
                continue;
            const key = normalize(header.key);
            const value = normalize(header.value);
            if (key && value) {
                enabledHeaders[key] = value;
            }
        }
        if (Object.keys(enabledHeaders).length === 0) {
            setDeployMessage({
                ok: false,
                text: "No enabled Global Headers found. Select a Dealer Profile in Settings first.",
            });
            return;
        }
        setDeploying(true);
        setDeployMessage(null);
        try {
            await saveDraft(dealerId, mappingList);
            const response = await fetch("http://localhost:4000/api/proxy", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    url: GLAM_MAPPING_RULE_URL,
                    method: "POST",
                    headers: {
                        ...enabledHeaders,
                        "content-type": "application/json",
                    },
                    body: payloadPreview,
                    timeout: 60000,
                }),
            });
            if (!response.ok) {
                throw new Error(`Proxy request failed with HTTP ${response.status}`);
            }
            const responseJson = (await response.json());
            if ((responseJson.status ?? 200) >= 400) {
                throw new Error(`${responseJson.status ?? ""} ${responseJson.statusText ?? "Tekion request failed"}`.trim());
            }
            setDeployMessage({
                ok: true,
                text: `Successfully sent ${mappingList.length} Deal Taxes row(s) to Tekion.`,
            });
        }
        catch (error) {
            setDeployMessage({
                ok: false,
                text: error instanceof Error
                    ? error.message
                    : "Failed to send Deal Taxes mappings to Tekion.",
            });
        }
        finally {
            setDeploying(false);
        }
    };
    const validationText = !taxResolution.selectedValue
        ? taxResolution.status === "MISMATCH"
            ? "Blocked by Labor / Parts mismatch"
            : "Fallback 9999"
        : !selectedBootstrapAccount
            ? `GL ${taxResolution.selectedValue} not found in Bootstrap`
            : !selectedBootstrapAccount.active
                ? `GL ${taxResolution.selectedValue} is inactive`
                : `✓ Valid: ${selectedBootstrapAccount.accountName || "Bootstrap GL Account"}`;
    const validationColor = !taxResolution.selectedValue
        ? taxResolution.status === "MISMATCH"
            ? "#fca5a5"
            : "#fcd34d"
        : !selectedBootstrapAccount
            ? "#fca5a5"
            : !selectedBootstrapAccount.active
                ? "#fcd34d"
                : "#86efac";
    return (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsx(GlamSectionHeader, { title: "Deal Taxes", description: "Maps all Variable Operations Deal Taxes from Fixed Ops Other Accounts Sales Tax GL values.", breadcrumb: "Accounting / Variable Operations / Payables / Deal Taxes" }), _jsx("div", { style: cardStyle, children: _jsxs("div", { style: {
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                    }, children: [_jsxs("span", { style: { color: "#94a3b8", fontSize: 12 }, children: ["Dealer:", " ", _jsx("b", { style: { color: "#f8fafc" }, children: dealerId || "Not found" })] }), _jsxs("span", { style: { color: "#94a3b8", fontSize: 12 }, children: ["Blueprint:", " ", _jsx("b", { style: {
                                        color: blueprintSource === "NOT_FOUND" ? "#fca5a5" : "#86efac",
                                    }, children: blueprintSource === "CONTEXT"
                                        ? "Active Context"
                                        : blueprintSource === "INDEXED_DB"
                                            ? "IndexedDB"
                                            : "Not found" })] }), _jsxs("span", { style: { color: "#94a3b8", fontSize: 12 }, children: ["Bootstrap:", " ", _jsx("b", { style: { color: bootstrap ? "#86efac" : "#fca5a5" }, children: bootstrap
                                        ? `${bootstrapAccounts.length} GL account(s)`
                                        : "Not found" })] }), _jsxs("span", { style: { color: "#94a3b8", fontSize: 12 }, children: ["Tax Validation:", " ", _jsx("b", { style: {
                                        color: taxResolution.status === "MATCHED"
                                            ? "#86efac"
                                            : taxResolution.status === "MISMATCH"
                                                ? "#fca5a5"
                                                : "#fcd34d",
                                    }, children: taxResolution.status })] }), _jsxs("span", { style: { color: "#94a3b8", fontSize: 12 }, children: ["Active Rows:", " ", _jsx("b", { style: { color: "#f8fafc" }, children: mappingList.length })] }), _jsxs("div", { style: {
                                marginLeft: "auto",
                                display: "flex",
                                gap: 8,
                                flexWrap: "wrap",
                            }, children: [_jsx("button", { type: "button", className: "btn-secondary btn-sm", disabled: loading || deploying, onClick: () => void syncBlueprintAndBuildRows(), children: loading ? "Syncing..." : "⟳ Sync Blueprint & Build Rows" }), _jsx("button", { type: "button", className: "btn-secondary btn-sm", disabled: loading || deploying || !dealerId || !blueprintRows.length, onClick: () => void restoreBlueprintRows(), title: "Rebuilds all 12 Deal Taxes rows from current Blueprint values.", children: "\u21BA Restore Blueprint Rows" }), _jsx("button", { type: "button", className: "btn-postman", disabled: loading ||
                                        deploying ||
                                        !dealerId ||
                                        !blueprintRows.length ||
                                        taxResolution.status === "MISMATCH" ||
                                        mappingList.length === 0, onClick: () => void deployToTekion(), title: taxResolution.status === "MISMATCH"
                                        ? "Sales Tax Labor and Parts GL accounts differ. Correct Blueprint before sending."
                                        : "Uses enabled Global Headers from Settings.", children: deploying
                                        ? "Sending to Tekion..."
                                        : `⇢ Send ${mappingList.length} Row${mappingList.length === 1 ? "" : "s"} to Tekion` })] })] }) }), _jsxs("div", { style: {
                    padding: "11px 12px",
                    borderRadius: 10,
                    border: taxResolution.status === "MISMATCH"
                        ? "1px solid rgba(239,68,68,0.30)"
                        : taxResolution.status === "MATCHED"
                            ? "1px solid rgba(34,197,94,0.25)"
                            : "1px solid rgba(245,158,11,0.25)",
                    background: taxResolution.status === "MISMATCH"
                        ? "rgba(239,68,68,0.10)"
                        : taxResolution.status === "MATCHED"
                            ? "rgba(34,197,94,0.10)"
                            : "rgba(245,158,11,0.10)",
                    color: taxResolution.status === "MISMATCH"
                        ? "#fecaca"
                        : taxResolution.status === "MATCHED"
                            ? "#bbf7d0"
                            : "#fde68a",
                    fontSize: 13,
                }, children: [_jsx("b", { children: "Sales Tax Validation: " }), taxResolution.detail] }), message ? (_jsx("div", { style: {
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: "rgba(59,130,246,0.08)",
                    border: "1px solid rgba(59,130,246,0.22)",
                    color: "#bfdbfe",
                    fontSize: 13,
                }, children: message })) : null, deployMessage ? (_jsx("div", { style: {
                    padding: "10px 12px",
                    borderRadius: 10,
                    background: deployMessage.ok
                        ? "rgba(34,197,94,0.10)"
                        : "rgba(239,68,68,0.10)",
                    border: deployMessage.ok
                        ? "1px solid rgba(34,197,94,0.25)"
                        : "1px solid rgba(239,68,68,0.25)",
                    color: deployMessage.ok ? "#bbf7d0" : "#fecaca",
                    fontSize: 13,
                }, children: deployMessage.text })) : null, _jsxs("div", { style: { ...cardStyle, padding: 0, overflow: "auto" }, children: [_jsx("div", { style: {
                            padding: "14px 16px",
                            color: "#f8fafc",
                            fontSize: 16,
                            fontWeight: 800,
                        }, children: "Blueprint / Bootstrap Validation" }), _jsxs("table", { style: {
                            width: "100%",
                            minWidth: 1100,
                            borderCollapse: "collapse",
                        }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "rgba(255,255,255,0.04)" }, children: [_jsx("th", { style: headerStyle, children: "Blueprint Section" }), _jsx("th", { style: headerStyle, children: "Blueprint Question" }), _jsx("th", { style: headerStyle, children: "Blueprint Value" }), _jsx("th", { style: headerStyle, children: "Resolved GL" }), _jsx("th", { style: headerStyle, children: "Bootstrap Validation" }), _jsx("th", { style: headerStyle, children: "Applies To" })] }) }), _jsxs("tbody", { children: [_jsxs("tr", { children: [_jsx("td", { style: cellStyle, children: BLUEPRINT_SECTION }), _jsx("td", { style: cellStyle, children: LABOR_QUESTION }), _jsx("td", { style: cellStyle, children: taxResolution.laborValue || "n/a / empty" }), _jsx("td", { style: {
                                                    ...cellStyle,
                                                    fontFamily: "ui-monospace, monospace",
                                                }, children: taxResolution.laborValue || "—" }), _jsx("td", { style: cellStyle, rowSpan: 2, children: _jsx("span", { style: { color: validationColor, fontWeight: 700 }, children: validationText }) }), _jsx("td", { style: cellStyle, rowSpan: 2, children: _jsxs("span", { style: { color: "#cbd5e1" }, children: ["All ", DEAL_TAX_TYPES.length, " Deal Taxes mapping rows"] }) })] }), _jsxs("tr", { children: [_jsx("td", { style: cellStyle, children: BLUEPRINT_SECTION }), _jsx("td", { style: cellStyle, children: PARTS_QUESTION }), _jsx("td", { style: cellStyle, children: taxResolution.partsValue || "n/a / empty" }), _jsx("td", { style: {
                                                    ...cellStyle,
                                                    fontFamily: "ui-monospace, monospace",
                                                }, children: taxResolution.partsValue || "—" })] })] })] })] }), _jsxs("div", { style: { ...cardStyle, padding: 0, overflow: "auto" }, children: [_jsxs("div", { style: {
                            padding: "14px 16px",
                            color: "#f8fafc",
                            fontSize: 16,
                            fontWeight: 800,
                        }, children: ["Active Payload Mapping Rows (", mappingList.length, ")"] }), _jsxs("table", { style: {
                            width: "100%",
                            minWidth: 950,
                            borderCollapse: "collapse",
                        }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "rgba(255,255,255,0.04)" }, children: [_jsx("th", { style: headerStyle, children: "#" }), _jsx("th", { style: headerStyle, children: "SALES_TAX_TYPE" }), _jsx("th", { style: headerStyle, children: "mappedAssetId" }), _jsx("th", { style: headerStyle, children: "mappedDealerId" }), _jsx("th", { style: headerStyle, children: "Action" })] }) }), _jsxs("tbody", { children: [mappingList.map((row, index) => (_jsxs("tr", { style: {
                                            borderTop: "1px solid rgba(255,255,255,0.06)",
                                        }, children: [_jsx("td", { style: cellStyle, children: index + 1 }), _jsx("td", { style: {
                                                    ...cellStyle,
                                                    fontFamily: "ui-monospace, monospace",
                                                }, children: row.attributes.SALES_TAX_TYPE || "—" }), _jsxs("td", { style: cellStyle, children: [_jsx("input", { type: "text", value: row.mappedAssetId || "", onChange: (event) => updateMappedAssetId(row.rowId, index, event.target.value), onBlur: (event) => void saveMappedAssetIdEdit(row.rowId, index, event.currentTarget.value), placeholder: `${dealerId || "dealerId"}_GLAccount`, title: "Manual override. Standard format: dealerId_GLAccount, for example 8111_32400.", style: {
                                                            width: "100%",
                                                            minWidth: 210,
                                                            boxSizing: "border-box",
                                                            padding: "7px 8px",
                                                            borderRadius: 6,
                                                            border: `1px solid ${normalize(row.mappedAssetId)
                                                                ? "rgba(134,239,172,0.38)"
                                                                : "rgba(248,113,113,0.72)"}`,
                                                            background: "rgba(15,23,42,0.80)",
                                                            color: "#86efac",
                                                            fontFamily: "ui-monospace, monospace",
                                                            fontSize: 12,
                                                            outline: "none",
                                                        } }), _jsx("div", { style: {
                                                            marginTop: 5,
                                                            color: "#94a3b8",
                                                            fontSize: 10,
                                                        }, children: "Manual override \u2014 saved when leaving this field." })] }), _jsx("td", { style: {
                                                    ...cellStyle,
                                                    fontFamily: "ui-monospace, monospace",
                                                }, children: row.mappedDealerId }), _jsx("td", { style: cellStyle, children: _jsx("button", { type: "button", className: "btn-danger btn-xs", title: "Remove this row from the active payload.", onClick: () => void deleteRow(row.rowId, index), children: "\uD83D\uDDD1 Delete" }) })] }, row.rowId || `${row.mappedAssetId}-${index}`))), !loading && mappingList.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 5, style: {
                                                ...cellStyle,
                                                color: "#94a3b8",
                                            }, children: "No active payload rows. Sync the Accounting Blueprint, then click Restore Blueprint Rows." }) })) : null] })] })] }), _jsxs("details", { style: cardStyle, children: [_jsx("summary", { style: {
                            color: "#e2e8f0",
                            cursor: "pointer",
                            fontWeight: 800,
                        }, children: "Show Payload Preview" }), _jsx("pre", { style: {
                            marginTop: 14,
                            padding: 12,
                            borderRadius: 10,
                            overflow: "auto",
                            background: "#0f172a",
                            color: "#e2e8f0",
                            fontSize: 12,
                        }, children: JSON.stringify(payloadPreview, null, 2) })] })] }));
};
export default DealTaxesView;
