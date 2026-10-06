import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GlamSectionHeader } from "../../../components/glamShared";
import { idbGetAllBlueprints } from "../../../../../../utils/blueprintDb";
import { idbGetAllBootstraps } from "../../../../../../utils/bootstrapDb";
import { loadGlobalHeaders } from "../../../../../../services/tekionApiSettings";
const GLAM_MAPPING_RULE_URL = "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/rule";
const MODULE = "PAYABLES";
const NAME = "Deal Fees";
const RULE_ASSET = "GLACCOUNT";
const BLUEPRINT_SECTION = "Vehicle Sales Payables";
const DEAL_FEE_RULES = [
    {
        feeType: "TITLE_FEE",
        question: "Title Fee GL Account Number",
    },
    {
        feeType: "REGISTRATION_CHARGES",
        question: "Registration GL Account Number",
    },
    {
        feeType: "EMISSION_TESTING_CHARGE",
        question: "Emissions GL Account Number",
    },
    {
        feeType: "DOCUMENTATION_FEE",
        question: "Documentation Fee GL Account Number",
    },
    {
        feeType: "BANK_OR_ACQUISITION_FEE",
        question: "Bank or Acquisition Fee GL Account Number",
    },
    {
        feeType: "LEMON_LAW_FEE",
        question: "Lemon Law Fee GL Account Number",
    },
    {
        feeType: "LIEN_FEE",
        question: "Lien Fee GL Account Number",
    },
    {
        feeType: "ENVIRONMENT_PROTECT_FEE",
        question: "Environment Protect Fee GL Account Number",
    },
    {
        feeType: "STATE_FEE",
        question: "State Fee GL Account Number",
    },
    {
        feeType: "WASTE_TIRE_FEE",
        question: "Waste Tire Fee GL Account Number",
    },
    {
        feeType: "TIRE_FEE",
        question: "Tire Fee GL Account Number",
    },
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
function fmt(value) {
    if (value === null || value === undefined) {
        return "";
    }
    if (typeof value === "string") {
        return value.trim();
    }
    if (typeof value === "number") {
        return String(value);
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (Array.isArray(value)) {
        return value.map((item) => fmt(item)).filter(Boolean).join(", ");
    }
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
}
function generateRowId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return `deal-fees-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function toEnabledHeaderMap(headers) {
    const result = {};
    for (const header of headers) {
        if (!header?.enabled) {
            continue;
        }
        const key = normalize(header.key);
        const value = normalize(header.value);
        if (key && value) {
            result[key] = value;
        }
    }
    return result;
}
function getDealerIdFromHeaders(headers) {
    for (const [key, value] of Object.entries(headers)) {
        const normalizedKey = normalizeLower(key);
        if ([
            "dealerid",
            "dealer-id",
            "x-dealer-id",
            "x-dealerid",
        ].includes(normalizedKey)) {
            return normalize(value);
        }
    }
    return "";
}
function isAccountingBlueprintForm(formName) {
    const form = normalizeLower(formName);
    return form.includes("blueprint") && form.includes("accounting");
}
function getBlueprintFlatRows(record) {
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
function getBootstrapDealerId(record) {
    const raw = record.data;
    return (normalize(raw?.dealerId) ||
        normalize(raw?.bootstrap?.dealerId) ||
        normalize(raw?.data?.dealerId) ||
        normalize(raw?.data?.data?.dealerId) ||
        normalize(raw?.glDealerId) ||
        normalize(raw?.data?.glDealerId) ||
        normalize(Object.keys(raw?.data?.allAccounts?.dealerAssetDocMap ?? {})[0]) ||
        normalize(Object.keys(raw?.data?.data?.allAccounts?.dealerAssetDocMap ?? {})[0]) ||
        normalize(Object.keys(raw?.allAccounts?.dealerAssetDocMap ?? {})[0]) ||
        normalize(record.key));
}
function extractBootstrapAccounts(record) {
    if (!record) {
        return [];
    }
    const raw = record.data;
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
        const objectValue = value;
        const accountNumber = normalize(objectValue.accountNumber) ||
            normalize(objectValue["#"]) ||
            normalize(objectValue.account_number);
        const accountName = normalize(objectValue.accountName) ||
            normalize(objectValue.NAME) ||
            normalize(objectValue.account_name);
        const id = normalize(objectValue.id) || normalize(objectValue.ID);
        const key = normalize(objectValue.key) || normalize(objectValue.KEY);
        if (accountNumber) {
            const account = {
                accountNumber,
                accountName,
                id,
                key,
                active: objectValue.active !== false,
            };
            const dedupeKey = `${accountNumber}__${id}__${key}`;
            if (!found.has(dedupeKey)) {
                found.set(dedupeKey, account);
            }
        }
        Object.values(objectValue).forEach((item) => visit(item, depth + 1));
    };
    visit(raw);
    return Array.from(found.values());
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
function findScopedBlueprintValue(rows, sectionName, question) {
    const expectedSection = normalizeComparable(sectionName);
    const expectedQuestion = normalizeComparable(question);
    const exactMatch = rows.find((row) => {
        const title = normalizeComparable(row.title);
        const section = normalizeComparable(row.sectionName);
        const subsection = normalizeComparable(row.subsectionName);
        return (title === expectedQuestion &&
            (section === expectedSection || subsection === expectedSection));
    });
    if (exactMatch) {
        return exactMatch.decodedValue;
    }
    const sectionMatch = rows.find((row) => {
        const title = normalizeComparable(row.title);
        const section = normalizeComparable(row.sectionName);
        const subsection = normalizeComparable(row.subsectionName);
        const combined = `${section} ${subsection}`.trim();
        return (title === expectedQuestion &&
            (combined.includes(expectedSection) ||
                expectedSection.includes(section) ||
                expectedSection.includes(subsection)));
    });
    if (sectionMatch) {
        return sectionMatch.decodedValue;
    }
    /*
     * The title-only fallback handles Blueprints where the parent section is
     * unavailable in populatedFlatRows. The Deal Fee question titles are unique.
     */
    const titleOnlyMatch = rows.find((row) => normalizeComparable(row.title) === expectedQuestion);
    return titleOnlyMatch?.decodedValue;
}
function findBootstrapAccount(accountNumber, accounts) {
    if (!accountNumber) {
        return null;
    }
    return (accounts.find((account) => account.accountNumber === accountNumber) ?? null);
}
function createMappingRow(dealerId, feeType, accountNumber) {
    /*
     * Missing/N-A Blueprint answers intentionally map to dealerId_9999.
     * Users can manually edit this mappedAssetId before sending the payload.
     */
    const resolvedAccountNumber = accountNumber || "9999";
    return {
        rowId: generateRowId(),
        attributes: {
            FEE_TYPE: feeType,
        },
        mappedAssetId: `${dealerId}_${resolvedAccountNumber}`,
        mappedDealerId: dealerId,
        targetFieldToValueMapping: {},
    };
}
function buildDefinitions(blueprintRows, bootstrapAccounts) {
    return DEAL_FEE_RULES.map((rule) => {
        const rawValue = findScopedBlueprintValue(blueprintRows, BLUEPRINT_SECTION, rule.question);
        const sourceValue = fmt(rawValue);
        const accountNumber = extractGlAccountNumber(rawValue);
        return {
            feeType: rule.feeType,
            question: rule.question,
            sourceValue,
            accountNumber,
            bootstrapAccount: findBootstrapAccount(accountNumber, bootstrapAccounts),
        };
    });
}
function getValidation(definition) {
    if (!definition.accountNumber) {
        return {
            text: "N/A or missing → fallback 9999",
            color: "#fcd34d",
        };
    }
    if (!definition.bootstrapAccount) {
        return {
            text: `GL ${definition.accountNumber} not found in Bootstrap`,
            color: "#fca5a5",
        };
    }
    if (!definition.bootstrapAccount.active) {
        return {
            text: `GL ${definition.accountNumber} is inactive`,
            color: "#fcd34d",
        };
    }
    return {
        text: `✓ Valid: ${definition.bootstrapAccount.accountName || "Bootstrap GL Account"}`,
        color: "#86efac",
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
const DealFeesView = () => {
    const [dealerId, setDealerId] = useState("");
    const [blueprintRows, setBlueprintRows] = useState([]);
    const [bootstrap, setBootstrap] = useState(null);
    const [mappingList, setMappingList] = useState([]);
    const [loading, setLoading] = useState(false);
    const [sending, setSending] = useState(false);
    const [message, setMessage] = useState(null);
    const bootstrapAccounts = useMemo(() => extractBootstrapAccounts(bootstrap), [bootstrap]);
    const definitions = useMemo(() => buildDefinitions(blueprintRows, bootstrapAccounts), [blueprintRows, bootstrapAccounts]);
    const payload = useMemo(() => ({
        module: MODULE,
        name: NAME,
        criteriaList: [],
        mappingColumns: ["FEE_TYPE"],
        mappingList,
        ruleAsset: RULE_ASSET,
    }), [mappingList]);
    const syncBlueprintAndBuildRows = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        try {
            const enabledHeaders = toEnabledHeaderMap(loadGlobalHeaders());
            const activeDealerId = getDealerIdFromHeaders(enabledHeaders);
            if (!activeDealerId) {
                throw new Error("Dealer ID was not found in enabled Global Headers. Select a Dealer Profile in Settings first.");
            }
            const [allBlueprints, allBootstraps] = await Promise.all([
                idbGetAllBlueprints(),
                idbGetAllBootstraps(),
            ]);
            const accountingBlueprints = allBlueprints
                .filter((record) => normalize(record.dealerId) === activeDealerId &&
                isAccountingBlueprintForm(record.formName))
                .sort((left, right) => normalize(right.savedAt).localeCompare(normalize(left.savedAt)));
            /*
             * Fallback supports older saved Blueprint records without formName.
             */
            const fallbackBlueprints = allBlueprints
                .filter((record) => normalize(record.dealerId) === activeDealerId)
                .sort((left, right) => normalize(right.savedAt).localeCompare(normalize(left.savedAt)));
            const blueprint = accountingBlueprints[0] ?? fallbackBlueprints[0] ?? null;
            if (!blueprint) {
                throw new Error(`No saved Accounting Blueprint was found for dealer ${activeDealerId}. Sync/save Blueprint first, then return here.`);
            }
            const rows = getBlueprintFlatRows(blueprint);
            if (rows.length === 0) {
                throw new Error("The saved Accounting Blueprint has no populated flat rows. Sync/save the Accounting Blueprint again.");
            }
            const matchingBootstraps = allBootstraps
                .filter((record) => getBootstrapDealerId(record) === activeDealerId)
                .sort((left, right) => normalize(right.savedAt).localeCompare(normalize(left.savedAt)));
            const selectedBootstrap = matchingBootstraps[0] ?? null;
            const accounts = extractBootstrapAccounts(selectedBootstrap);
            const nextDefinitions = buildDefinitions(rows, accounts);
            const nextMappingList = nextDefinitions.map((definition) => createMappingRow(activeDealerId, definition.feeType, definition.accountNumber));
            const fallbackRows = nextDefinitions.filter((definition) => !definition.accountNumber);
            const invalidBootstrapRows = nextDefinitions.filter((definition) => definition.accountNumber &&
                (!definition.bootstrapAccount ||
                    !definition.bootstrapAccount.active));
            setDealerId(activeDealerId);
            setBlueprintRows(rows);
            setBootstrap(selectedBootstrap);
            setMappingList(nextMappingList);
            if (!selectedBootstrap) {
                setMessage({
                    ok: true,
                    text: `Built ${nextMappingList.length} Deal Fees rows from Blueprint. ` +
                        "No Bootstrap snapshot was found, so GL validation is unavailable.",
                });
            }
            else if (fallbackRows.length > 0 ||
                invalidBootstrapRows.length > 0) {
                setMessage({
                    ok: true,
                    text: `Built ${nextMappingList.length} Deal Fees rows. ` +
                        `${fallbackRows.length} row(s) use fallback 9999 and ` +
                        `${invalidBootstrapRows.length} GL value(s) need Bootstrap review.`,
                });
            }
            else {
                setMessage({
                    ok: true,
                    text: `Built ${nextMappingList.length} Deal Fees rows from Blueprint. ` +
                        "All resolved GL accounts were found in Bootstrap.",
                });
            }
        }
        catch (error) {
            setDealerId("");
            setBlueprintRows([]);
            setBootstrap(null);
            setMappingList([]);
            setMessage({
                ok: false,
                text: error instanceof Error
                    ? error.message
                    : "Unable to build Deal Fees mappings.",
            });
        }
        finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => {
        const headers = toEnabledHeaderMap(loadGlobalHeaders());
        const activeDealerId = getDealerIdFromHeaders(headers);
        if (activeDealerId) {
            void syncBlueprintAndBuildRows();
        }
    }, [syncBlueprintAndBuildRows]);
    const restoreBlueprintRows = async () => {
        if (!dealerId || blueprintRows.length === 0) {
            setMessage({
                ok: false,
                text: "No Blueprint is loaded. Click Sync Blueprint & Build Rows first.",
            });
            return;
        }
        const restoredRows = definitions.map((definition) => createMappingRow(dealerId, definition.feeType, definition.accountNumber));
        setMappingList(restoredRows);
        setMessage({
            ok: true,
            text: "Restored all standard Deal Fees rows from the current Blueprint answers.",
        });
    };
    const updateMappedAssetId = (rowId, mappedAssetId) => {
        setMappingList((currentRows) => currentRows.map((row) => row.rowId === rowId
            ? {
                ...row,
                mappedAssetId,
            }
            : row));
    };
    const deleteRow = (rowId) => {
        const row = mappingList.find((item) => item.rowId === rowId);
        if (!row) {
            return;
        }
        const feeType = row.attributes.FEE_TYPE;
        if (!window.confirm(`Remove "${feeType}" from the active payload and outgoing Tekion request?`)) {
            return;
        }
        setMappingList((currentRows) => currentRows.filter((item) => item.rowId !== rowId));
        setMessage({
            ok: true,
            text: `"${feeType}" was removed from the active payload.`,
        });
    };
    const sendToTekion = async () => {
        if (!dealerId) {
            setMessage({
                ok: false,
                text: "Dealer ID is missing. Click Sync Blueprint & Build Rows first.",
            });
            return;
        }
        if (mappingList.length === 0) {
            setMessage({
                ok: false,
                text: "There are no active Deal Fees rows to send.",
            });
            return;
        }
        const blankRows = mappingList.filter((row) => !normalize(row.mappedAssetId));
        if (blankRows.length > 0) {
            setMessage({
                ok: false,
                text: `${blankRows.length} row(s) have a blank mappedAssetId. ` +
                    "Enter an account or delete those rows before sending.",
            });
            return;
        }
        const enabledHeaders = toEnabledHeaderMap(loadGlobalHeaders());
        if (Object.keys(enabledHeaders).length === 0) {
            setMessage({
                ok: false,
                text: "No enabled Global Headers were found. Select a Dealer Profile in Settings first.",
            });
            return;
        }
        setSending(true);
        setMessage(null);
        try {
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
                    body: payload,
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
            setMessage({
                ok: true,
                text: `Successfully sent ${mappingList.length} Deal Fees mapping row(s) ` +
                    "to Tekion.",
            });
        }
        catch (error) {
            setMessage({
                ok: false,
                text: error instanceof Error
                    ? error.message
                    : "Failed to send Deal Fees mappings to Tekion.",
            });
        }
        finally {
            setSending(false);
        }
    };
    return (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsx(GlamSectionHeader, { title: "Deal Fees", description: "Maps Vehicle Sales Payables fee accounts from Accounting Blueprint answers.", breadcrumb: "Accounting / Variable Operations / Payables / Deal Fees" }), _jsx("div", { style: cardStyle, children: _jsxs("div", { style: {
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                    }, children: [_jsxs("span", { style: { color: "#94a3b8", fontSize: 12 }, children: ["Dealer:", " ", _jsx("b", { style: { color: dealerId ? "#f8fafc" : "#fca5a5" }, children: dealerId || "Not loaded" })] }), _jsxs("span", { style: { color: "#94a3b8", fontSize: 12 }, children: ["Blueprint Rows:", " ", _jsx("b", { style: { color: blueprintRows.length ? "#86efac" : "#fca5a5" }, children: blueprintRows.length })] }), _jsxs("span", { style: { color: "#94a3b8", fontSize: 12 }, children: ["Bootstrap:", " ", _jsx("b", { style: { color: bootstrap ? "#86efac" : "#fcd34d" }, children: bootstrap
                                        ? `${bootstrapAccounts.length} GL account(s)`
                                        : "Not available" })] }), _jsxs("span", { style: { color: "#94a3b8", fontSize: 12 }, children: ["Active Rows:", " ", _jsx("b", { style: { color: "#f8fafc" }, children: mappingList.length })] }), _jsxs("div", { style: {
                                marginLeft: "auto",
                                display: "flex",
                                gap: 8,
                                flexWrap: "wrap",
                            }, children: [_jsx("button", { type: "button", className: "btn-secondary btn-sm", disabled: loading || sending, onClick: () => void syncBlueprintAndBuildRows(), children: loading ? "Syncing..." : "⟳ Sync Blueprint & Build Rows" }), _jsx("button", { type: "button", className: "btn-secondary btn-sm", disabled: loading ||
                                        sending ||
                                        !dealerId ||
                                        blueprintRows.length === 0, onClick: () => void restoreBlueprintRows(), children: "\u21BA Restore Blueprint Rows" }), _jsx("button", { type: "button", className: "btn-postman", disabled: loading ||
                                        sending ||
                                        !dealerId ||
                                        mappingList.length === 0, onClick: () => void sendToTekion(), children: sending
                                        ? "Sending to Tekion..."
                                        : `⇢ Send ${mappingList.length} Row${mappingList.length === 1 ? "" : "s"} to Tekion` })] })] }) }), message ? (_jsx("div", { style: {
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: message.ok
                        ? "1px solid rgba(34,197,94,0.25)"
                        : "1px solid rgba(239,68,68,0.25)",
                    background: message.ok
                        ? "rgba(34,197,94,0.10)"
                        : "rgba(239,68,68,0.10)",
                    color: message.ok ? "#bbf7d0" : "#fecaca",
                    fontSize: 13,
                }, children: message.text })) : null, _jsxs("div", { style: { ...cardStyle, padding: 0, overflow: "auto" }, children: [_jsx("div", { style: {
                            padding: "14px 16px",
                            color: "#f8fafc",
                            fontSize: 16,
                            fontWeight: 800,
                        }, children: "Blueprint / Bootstrap Validation" }), _jsxs("table", { style: {
                            width: "100%",
                            minWidth: 1060,
                            borderCollapse: "collapse",
                        }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "rgba(255,255,255,0.04)" }, children: [_jsx("th", { style: headerStyle, children: "FEE_TYPE" }), _jsx("th", { style: headerStyle, children: "Blueprint Section" }), _jsx("th", { style: headerStyle, children: "Blueprint Question" }), _jsx("th", { style: headerStyle, children: "Blueprint Value" }), _jsx("th", { style: headerStyle, children: "Resolved GL" }), _jsx("th", { style: headerStyle, children: "Bootstrap Validation" }), _jsx("th", { style: headerStyle, children: "Default mappedAssetId" })] }) }), _jsxs("tbody", { children: [definitions.map((definition) => {
                                        const validation = getValidation(definition);
                                        return (_jsxs("tr", { children: [_jsx("td", { style: {
                                                        ...cellStyle,
                                                        fontFamily: "ui-monospace, monospace",
                                                    }, children: definition.feeType }), _jsx("td", { style: cellStyle, children: BLUEPRINT_SECTION }), _jsx("td", { style: cellStyle, children: definition.question }), _jsx("td", { style: cellStyle, children: definition.sourceValue || "N/A / empty" }), _jsx("td", { style: {
                                                        ...cellStyle,
                                                        color: definition.accountNumber ? "#e2e8f0" : "#fcd34d",
                                                        fontFamily: "ui-monospace, monospace",
                                                    }, children: definition.accountNumber || "9999" }), _jsx("td", { style: cellStyle, children: _jsx("span", { style: {
                                                            color: validation.color,
                                                            fontWeight: 700,
                                                        }, children: validation.text }) }), _jsx("td", { style: {
                                                        ...cellStyle,
                                                        color: "#86efac",
                                                        fontFamily: "ui-monospace, monospace",
                                                    }, children: dealerId
                                                        ? `${dealerId}_${definition.accountNumber || "9999"}`
                                                        : "—" })] }, definition.feeType));
                                    }), !loading && definitions.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 7, style: {
                                                ...cellStyle,
                                                color: "#94a3b8",
                                            }, children: "Click Sync Blueprint & Build Rows to load Deal Fees values." }) })) : null] })] })] }), _jsxs("div", { style: { ...cardStyle, padding: 0, overflow: "auto" }, children: [_jsxs("div", { style: {
                            padding: "14px 16px",
                            color: "#f8fafc",
                            fontSize: 16,
                            fontWeight: 800,
                        }, children: ["Active Payload Mapping Rows (", mappingList.length, ")"] }), _jsxs("table", { style: {
                            width: "100%",
                            minWidth: 960,
                            borderCollapse: "collapse",
                        }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "rgba(255,255,255,0.04)" }, children: [_jsx("th", { style: headerStyle, children: "#" }), _jsx("th", { style: headerStyle, children: "FEE_TYPE" }), _jsx("th", { style: headerStyle, children: "mappedAssetId" }), _jsx("th", { style: headerStyle, children: "mappedDealerId" }), _jsx("th", { style: headerStyle, children: "Action" })] }) }), _jsxs("tbody", { children: [mappingList.map((row, index) => (_jsxs("tr", { style: {
                                            borderTop: "1px solid rgba(255,255,255,0.06)",
                                        }, children: [_jsx("td", { style: cellStyle, children: index + 1 }), _jsx("td", { style: {
                                                    ...cellStyle,
                                                    fontFamily: "ui-monospace, monospace",
                                                }, children: row.attributes.FEE_TYPE }), _jsxs("td", { style: cellStyle, children: [_jsx("input", { type: "text", value: row.mappedAssetId, onChange: (event) => updateMappedAssetId(row.rowId, event.target.value), placeholder: `${dealerId || "dealerId"}_GLAccount`, title: "Manual override. For example: 8111_91000.", style: {
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
                                                        }, children: "Manual override \u2014 this exact value is sent to Tekion." })] }), _jsx("td", { style: {
                                                    ...cellStyle,
                                                    fontFamily: "ui-monospace, monospace",
                                                }, children: row.mappedDealerId }), _jsx("td", { style: cellStyle, children: _jsx("button", { type: "button", className: "btn-danger btn-xs", title: "Remove this row from the active payload.", onClick: () => deleteRow(row.rowId), children: "\uD83D\uDDD1 Delete" }) })] }, row.rowId))), !loading && mappingList.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: 5, style: {
                                                ...cellStyle,
                                                color: "#94a3b8",
                                            }, children: "No active payload rows. Click Sync Blueprint & Build Rows to create the standard Deal Fees mappings." }) })) : null] })] })] }), _jsxs("details", { style: cardStyle, children: [_jsx("summary", { style: {
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
                        }, children: JSON.stringify(payload, null, 2) })] })] }));
};
export default DealFeesView;
