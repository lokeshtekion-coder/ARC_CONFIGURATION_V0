import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../../../../services/tekionApiSettings";
import { idbFindBootstrapByDealerId } from "../../../../../utils/bootstrapDb";
import { useAccountingBlueprint } from "../../../../../Context/Blueprint_Accounting_Context/AccountingBlueprintContext";
import { idbGetGlamMappingDraft, idbSaveGlamMappingDraft, } from "../../../../../utils/glamMappingDraftDb";
const GLAM_MAPPING_RULE_URL = "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/rule";
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
function getDealerIdFromHeaders() {
    const headers = loadGlobalHeaders();
    for (const header of headers) {
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
function generateRowId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `glam-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
/**
 * Extracts the primary account token from raw blueprint text,
 * preserving alphanumeric codes (e.g. "220CC - Retail Cash" -> "220CC").
 */
function sanitizeRawGlInput(value) {
    const text = normalize(value);
    if (!text)
        return null;
    const normalized = normalizeLower(text);
    if (normalized === "n/a" ||
        normalized === "na" ||
        normalized === "none" ||
        normalized === "null" ||
        normalized === "not applicable") {
        return null;
    }
    const token = text.split(/[\s:–—-]+/)[0]?.trim();
    const candidate = token || text;
    // Must contain at least one digit or alphanumeric standard identifier
    if (!/\d/.test(candidate) && candidate.toLowerCase() !== "invv")
        return null;
    return candidate.replace(/[.,;:]+$/, "");
}
/**
 * Generates fallback candidates by progressively stripping suffixes,
 * delimiters, and sub-codes from any GL account string.
 */
function generateGlFallbackCandidates(rawInput) {
    const candidates = [];
    const trimmed = rawInput.trim();
    // 1. Strip trailing non-digit characters (e.g. "220CC" -> "220", "1010A" -> "1010")
    const trailingAlphaStripped = trimmed.replace(/[^0-9]+$/g, "");
    if (trailingAlphaStripped && trailingAlphaStripped !== trimmed) {
        candidates.push(trailingAlphaStripped);
    }
    // 2. Strip separator-based sub-accounts (e.g. "220-01" -> "220", "1010.CC" -> "1010")
    const delimiterSplit = trimmed.split(/[-_./:\s]/)[0];
    if (delimiterSplit &&
        delimiterSplit !== trimmed &&
        !candidates.includes(delimiterSplit)) {
        candidates.push(delimiterSplit);
    }
    // 3. Extract purely numeric core (e.g. "GL-220-X" -> "220")
    const numericCore = trimmed.replace(/\D/g, "");
    if (numericCore &&
        !candidates.includes(numericCore) &&
        numericCore !== trimmed) {
        candidates.push(numericCore);
    }
    return candidates;
}
/**
 * Generic resolver for any GL Account code against Bootstrap accounts:
 * 1. Checks if exact alphanumeric code exists in Bootstrap accounts.
 * 2. If not, strips suffixes/delimiters and checks if base account exists.
 * 3. Falls back gracefully to candidate or 9999 if neither exists.
 */
export function resolveGlAccountWithBootstrap(rawInput, accounts = []) {
    const rawCode = sanitizeRawGlInput(rawInput);
    if (!rawCode) {
        return {
            accountNumber: "9999",
            accountFound: false,
            matchType: "not_found",
        };
    }
    const accountMap = new Map();
    for (const acc of accounts) {
        if (acc?.accountNumber) {
            accountMap.set(normalize(acc.accountNumber).toUpperCase(), acc);
        }
    }
    // STEP 1: Check if the exact alphanumeric account exists in bootstrap (e.g. "220CC")
    const exactMatch = accountMap.get(rawCode.toUpperCase());
    if (exactMatch) {
        return {
            accountNumber: exactMatch.accountNumber,
            accountFound: true,
            matchType: "exact",
        };
    }
    // STEP 2: Exact match missing -> Check fallback stripped candidates (e.g. "220")
    const fallbacks = generateGlFallbackCandidates(rawCode);
    for (const candidate of fallbacks) {
        const fallbackMatch = accountMap.get(candidate.toUpperCase());
        if (fallbackMatch) {
            return {
                accountNumber: fallbackMatch.accountNumber,
                accountFound: true,
                matchType: "fallback_stripped",
            };
        }
    }
    // STEP 3: Neither exists in bootstrap -> return best candidate or rawCode
    return {
        accountNumber: fallbacks[0] || rawCode,
        accountFound: false,
        matchType: "not_found",
    };
}
function getBootstrapRoot(data) {
    if (!data || typeof data !== "object" || Array.isArray(data))
        return {};
    return data;
}
function getBootstrapAccounts(record) {
    if (!record)
        return [];
    const root = getBootstrapRoot(record.data);
    const outputAccounts = Array.isArray(root.glAccounts) ? root.glAccounts : [];
    const accounts = outputAccounts
        .filter((entry) => Boolean(entry && typeof entry === "object"))
        .map((entry) => ({
        accountNumber: normalize(entry.accountNumber),
        id: normalize(entry.id),
        key: normalize(entry.key),
        accountName: normalize(entry.accountName),
        active: entry.active !== false,
    }))
        .filter((account) => Boolean(account.accountNumber));
    return accounts;
}
function getRawCustomFieldOptions(record, dealerId, fieldKey) {
    if (!record)
        return [];
    const root = getBootstrapRoot(record.data);
    const customField = getBootstrapRoot(root.customField);
    const dealerMapCandidate = customField.dealerAssetDocMap;
    const dealerMap = dealerMapCandidate &&
        typeof dealerMapCandidate === "object" &&
        !Array.isArray(dealerMapCandidate)
        ? dealerMapCandidate
        : {};
    const directDealerFields = dealerMap[dealerId] &&
        typeof dealerMap[dealerId] === "object" &&
        !Array.isArray(dealerMap[dealerId])
        ? dealerMap[dealerId]
        : dealerMap;
    const masterMap = customField.masterAssetDocMap &&
        typeof customField.masterAssetDocMap === "object" &&
        !Array.isArray(customField.masterAssetDocMap)
        ? customField.masterAssetDocMap
        : {};
    const mergedFields = {
        ...masterMap,
        ...directDealerFields,
    };
    const field = Object.values(mergedFields).find((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item))
            return false;
        return normalize(item.key) === fieldKey;
    });
    if (!field || typeof field !== "object" || Array.isArray(field))
        return [];
    const options = field.options;
    if (!Array.isArray(options))
        return [];
    return options
        .filter((option) => Boolean(option && typeof option === "object"))
        .map((option) => ({
        id: normalize(option.id),
        name: normalize(option.name),
        deleted: option.deleted === true,
    }));
}
function findGeneratedPaymentMethodId(record, dealerId, fieldKey, optionName) {
    const options = getRawCustomFieldOptions(record, dealerId, fieldKey);
    const matched = options.find((option) => !option.deleted &&
        normalizeComparable(option.name) === normalizeComparable(optionName));
    return matched?.id ?? "";
}
function isPaymentMethodColumn(column) {
    return normalize(column).includes("PAYMENT_METHOD");
}
function findPaymentMethodNameByGeneratedId(rules, row, column, bootstrap, dealerId) {
    if (!isPaymentMethodColumn(column))
        return "";
    const generatedId = normalize(row.attributes[column]);
    if (!generatedId ||
        generatedId === "MISSING_GENERATED_PAYMENT_METHOD_ID") {
        return "";
    }
    for (const rule of rules) {
        const paymentField = rule.paymentMethodField;
        if (!paymentField)
            continue;
        const options = getRawCustomFieldOptions(bootstrap, dealerId, paymentField.customFieldKey);
        const option = options.find((item) => !item.deleted && normalize(item.id) === generatedId);
        if (option?.name) {
            return option.name;
        }
    }
    return "";
}
function doesRowMatchRule(row, rule, bootstrap, dealerId) {
    for (const [attributeKey, expectedValue] of Object.entries(rule.attributes)) {
        const actualValue = normalize(row.attributes[attributeKey]);
        if (isPaymentMethodColumn(attributeKey) && rule.paymentMethodField) {
            const generatedId = findGeneratedPaymentMethodId(bootstrap, dealerId, rule.paymentMethodField.customFieldKey, rule.paymentMethodField.optionName);
            if (generatedId) {
                if (actualValue !== generatedId)
                    return false;
                continue;
            }
            if (rule.alwaysInclude &&
                normalize(rule.mappedAssetIdOverride) &&
                normalize(row.mappedAssetId) === normalize(rule.mappedAssetIdOverride)) {
                continue;
            }
            return false;
        }
        if (actualValue !== normalize(expectedValue)) {
            return false;
        }
    }
    return true;
}
function findScopedBlueprintValue(rows, sectionName, questionTitle) {
    const expectedSection = normalizeComparable(sectionName);
    const expectedQuestion = normalizeComparable(questionTitle);
    const exact = rows.find((row) => {
        const rowSection = normalizeComparable(row.sectionName);
        const rowSubsection = normalizeComparable(row.subsectionName);
        const rowQuestion = normalizeComparable(row.title);
        return (rowQuestion === expectedQuestion &&
            (rowSection === expectedSection || rowSubsection === expectedSection));
    });
    if (exact && exact.decodedValue !== undefined && exact.decodedValue !== null) {
        return exact.decodedValue;
    }
    const loose = rows.find((row) => {
        const rowSection = normalizeComparable(row.sectionName);
        const rowSubsection = normalizeComparable(row.subsectionName);
        const rowQuestion = normalizeComparable(row.title);
        return (rowQuestion === expectedQuestion &&
            (rowSection.includes(expectedSection) ||
                rowSubsection.includes(expectedSection) ||
                expectedSection.includes(rowSection) ||
                expectedSection.includes(rowSubsection)));
    });
    return loose?.decodedValue;
}
function isValueDefinedInBlueprint(val) {
    if (val === undefined || val === null)
        return false;
    const s = normalize(val);
    if (!s)
        return false;
    const l = normalizeLower(s);
    return (l !== "n/a" &&
        l !== "na" &&
        l !== "none" &&
        l !== "null" &&
        l !== "not applicable");
}
function buildRow(dealerId, rule, decodedValue, accounts, bootstrap) {
    let glSuffix;
    if (normalize(rule.mappedAssetSuffix)) {
        glSuffix = normalize(rule.mappedAssetSuffix);
    }
    else {
        const resolution = resolveGlAccountWithBootstrap(decodedValue, accounts);
        glSuffix = resolution.accountNumber || "9999";
    }
    const paymentMethodId = rule.paymentMethodField
        ? findGeneratedPaymentMethodId(bootstrap, dealerId, rule.paymentMethodField.customFieldKey, rule.paymentMethodField.optionName)
        : "";
    const attributes = { ...rule.attributes };
    if (rule.paymentMethodField) {
        const key = Object.keys(attributes).find((attributeKey) => attributeKey.includes("PAYMENT_METHOD"));
        if (key) {
            attributes[key] = paymentMethodId || "MISSING_GENERATED_PAYMENT_METHOD_ID";
        }
    }
    return {
        rowId: generateRowId(),
        attributes,
        mappedAssetId: normalize(rule.mappedAssetIdOverride) || `${dealerId}_${glSuffix}`,
        mappedDealerId: dealerId,
        targetFieldToValueMapping: {},
    };
}
function getStatusColor(value) {
    return value ? "#86efac" : "#fca5a5";
}
function getAttributesKey(attributes) {
    return Object.entries(attributes)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([key, value]) => `${key}=${value}`)
        .join("|");
}
export const PaymentMappingView = ({ config }) => {
    const accountingBlueprint = useAccountingBlueprint();
    const [dealerId, setDealerId] = useState("");
    const [bootstrap, setBootstrap] = useState(null);
    const [mappingList, setMappingList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [deploying, setDeploying] = useState(false);
    const [message, setMessage] = useState(null);
    const [deployMessage, setDeployMessage] = useState(null);
    const flatRows = useMemo(() => accountingBlueprint.blueprint?.populatedFlatRows ??
        accountingBlueprint.blueprint?.allFields ??
        [], [accountingBlueprint.blueprint]);
    const accounts = useMemo(() => getBootstrapAccounts(bootstrap), [bootstrap]);
    /**
     * Only includes rules that are either:
     * 1. Hardcoded system defaults (alwaysInclude or mappedAssetSuffix)
     * 2. Actually found and populated in the Blueprint
     */
    const buildDefaultRows = useCallback((activeDealerId, activeBootstrap) => {
        const activeAccounts = getBootstrapAccounts(activeBootstrap);
        return config.rules
            .filter((rule) => {
            if (rule.alwaysInclude || normalize(rule.mappedAssetSuffix)) {
                return true;
            }
            const decodedValue = findScopedBlueprintValue(flatRows, rule.blueprintSection, rule.blueprintQuestion);
            return isValueDefinedInBlueprint(decodedValue);
        })
            .map((rule) => {
            const decodedValue = findScopedBlueprintValue(flatRows, rule.blueprintSection, rule.blueprintQuestion);
            return buildRow(activeDealerId, rule, decodedValue, activeAccounts, activeBootstrap);
        });
    }, [config.rules, flatRows]);
    const findMatchingRuleForRow = useCallback((row) => config.rules.find((rule) => doesRowMatchRule(row, rule, bootstrap, dealerId)), [bootstrap, config.rules, dealerId]);
    const ensureRequiredDefaultRows = useCallback((rows, activeDealerId, activeBootstrap) => {
        const defaults = buildDefaultRows(activeDealerId, activeBootstrap);
        const existingKeys = new Set(rows.map((row) => getAttributesKey(row.attributes)));
        const requiredRows = defaults.filter((row) => {
            const matchingRule = config.rules.find((rule) => doesRowMatchRule(row, rule, activeBootstrap, activeDealerId));
            return Boolean(matchingRule?.alwaysInclude);
        });
        const missingRequiredRows = requiredRows.filter((row) => !existingKeys.has(getAttributesKey(row.attributes)));
        return missingRequiredRows.length > 0
            ? [...rows, ...missingRequiredRows]
            : rows;
    }, [buildDefaultRows, config.rules]);
    const saveDraft = useCallback(async (rows, activeDealerId) => {
        if (!activeDealerId)
            return;
        const payload = {
            module: config.module,
            name: config.name,
            criteriaList: [],
            mappingColumns: config.mappingColumns,
            mappingList: rows,
            ruleAsset: "GLACCOUNT",
        };
        await idbSaveGlamMappingDraft(activeDealerId, payload);
    }, [config.mappingColumns, config.module, config.name]);
    const reload = useCallback(async () => {
        const resolvedDealerId = normalize(accountingBlueprint.selectedDealerId) || getDealerIdFromHeaders();
        if (!resolvedDealerId) {
            setDealerId("");
            setBootstrap(null);
            setMappingList([]);
            setMessage("Dealer ID was not found. Select a dealer and apply Global Headers.");
            setLoading(false);
            return;
        }
        setLoading(true);
        setMessage(null);
        try {
            const foundBootstrap = await idbFindBootstrapByDealerId(resolvedDealerId);
            const existingDraft = await idbGetGlamMappingDraft(resolvedDealerId, config.module, config.name);
            setDealerId(resolvedDealerId);
            setBootstrap(foundBootstrap);
            if (existingDraft) {
                const hydratedRows = ensureRequiredDefaultRows(existingDraft.payload.mappingList, resolvedDealerId, foundBootstrap);
                setMappingList(hydratedRows);
                if (hydratedRows.length !== existingDraft.payload.mappingList.length) {
                    await saveDraft(hydratedRows, resolvedDealerId);
                    setMessage("Loaded saved GLAM draft and restored required Vehicle Inventory - INVV default mapping.");
                }
                else {
                    setMessage(`Loaded saved GLAM draft from ${new Date(existingDraft.savedAt).toLocaleString()}.`);
                }
            }
            else {
                const defaults = buildDefaultRows(resolvedDealerId, foundBootstrap);
                const hydratedRows = ensureRequiredDefaultRows(defaults, resolvedDealerId, foundBootstrap);
                setMappingList(hydratedRows);
                await saveDraft(hydratedRows, resolvedDealerId);
            }
            if (!foundBootstrap) {
                setMessage("No Bootstrap snapshot found for this dealer. All unresolved GL accounts use the 9999 fallback.");
            }
        }
        catch (error) {
            setMessage(error instanceof Error ? error.message : "Unable to load mapping data.");
        }
        finally {
            setLoading(false);
        }
    }, [
        accountingBlueprint.selectedDealerId,
        buildDefaultRows,
        config.module,
        config.name,
        ensureRequiredDefaultRows,
        saveDraft,
    ]);
    useEffect(() => {
        void reload();
    }, [reload]);
    /**
     * Only show in source rows if the question is populated in Blueprint
     * or is marked as an always-included system default.
     */
    const sourceRows = useMemo(() => config.rules
        .filter((rule) => {
        if (rule.alwaysInclude || normalize(rule.mappedAssetSuffix)) {
            return true;
        }
        const decodedValue = findScopedBlueprintValue(flatRows, rule.blueprintSection, rule.blueprintQuestion);
        return isValueDefinedInBlueprint(decodedValue);
    })
        .map((rule) => {
        const decodedValue = findScopedBlueprintValue(flatRows, rule.blueprintSection, rule.blueprintQuestion);
        let accountNumber;
        let accountFound;
        let matchType = "not_found";
        if (normalize(rule.mappedAssetSuffix)) {
            accountNumber = normalize(rule.mappedAssetSuffix);
            accountFound = true;
            matchType = "exact";
        }
        else {
            const resolution = resolveGlAccountWithBootstrap(decodedValue, accounts);
            accountNumber = resolution.accountNumber;
            accountFound = resolution.accountFound;
            matchType = resolution.matchType;
        }
        const generatedPaymentMethodId = rule.paymentMethodField
            ? findGeneratedPaymentMethodId(bootstrap, dealerId, rule.paymentMethodField.customFieldKey, rule.paymentMethodField.optionName)
            : "";
        const hasGlAccount = Boolean(decodedValue && accountNumber && accountNumber !== "9999");
        const isMissingCustomOption = Boolean(rule.paymentMethodField && hasGlAccount && !generatedPaymentMethodId);
        return {
            rule,
            decodedValue: normalize(rule.mappedAssetSuffix)
                ? `System default: ${rule.mappedAssetSuffix}`
                : normalize(Array.isArray(decodedValue) ? decodedValue.join(", ") : decodedValue),
            accountNumber,
            accountFound,
            matchType,
            generatedPaymentMethodId,
            isMissingCustomOption,
        };
    }), [accounts, bootstrap, config.rules, dealerId, flatRows]);
    const missingOptionsList = useMemo(() => sourceRows.filter((item) => item.isMissingCustomOption), [sourceRows]);
    const updateMappedAssetIdDraft = (rowId, index, mappedAssetId) => {
        setMappingList((currentRows) => currentRows.map((row, rowIndex) => {
            const isTargetRow = rowId ? row.rowId === rowId : rowIndex === index;
            return isTargetRow
                ? {
                    ...row,
                    mappedAssetId,
                }
                : row;
        }));
    };
    const saveMappedAssetIdEdit = async (rowId, index, mappedAssetId) => {
        const nextRows = mappingList.map((row, rowIndex) => {
            const isTargetRow = rowId ? row.rowId === rowId : rowIndex === index;
            return isTargetRow
                ? {
                    ...row,
                    mappedAssetId,
                }
                : row;
        });
        setMappingList(nextRows);
        await saveDraft(nextRows, dealerId);
    };
    const deleteRow = async (rowId, index) => {
        const rowToDelete = mappingList[index];
        const matchingRule = rowToDelete
            ? findMatchingRuleForRow(rowToDelete)
            : undefined;
        if (matchingRule?.alwaysInclude) {
            setMessage(`"${matchingRule.label}" is a required system default and cannot be deleted.`);
            return;
        }
        const nextRows = mappingList.filter((row, rowIndex) => rowId ? row.rowId !== rowId : rowIndex !== index);
        setMappingList(nextRows);
        await saveDraft(nextRows, dealerId);
    };
    const resetFromBlueprint = async () => {
        const rows = buildDefaultRows(dealerId, bootstrap);
        setMappingList(rows);
        await saveDraft(rows, dealerId);
        setMessage(`Mapping rows were rebuilt from Blueprint. Populated ${rows.length} row(s).`);
    };
    const syncActiveRowsFromValidatedBlueprint = async () => {
        if (!dealerId) {
            setMessage("Dealer ID is missing. Select a Dealer Profile in Settings first.");
            return;
        }
        const rebuiltRows = buildDefaultRows(dealerId, bootstrap);
        const rebuiltByAttributes = new Map(rebuiltRows.map((row) => [getAttributesKey(row.attributes), row]));
        // Keep existing rows that are still in Blueprint, drop ones that were removed in Blueprint
        const synchronizedRows = mappingList
            .filter((currentRow) => rebuiltByAttributes.has(getAttributesKey(currentRow.attributes)))
            .map((currentRow) => {
            const rebuiltRow = rebuiltByAttributes.get(getAttributesKey(currentRow.attributes));
            if (!rebuiltRow) {
                return currentRow;
            }
            return {
                ...rebuiltRow,
                rowId: currentRow.rowId ?? rebuiltRow.rowId,
            };
        });
        setMappingList(synchronizedRows);
        await saveDraft(synchronizedRows, dealerId);
        setMessage(`Synced ${synchronizedRows.length} active row(s) from validated Blueprint. Empty/missing Blueprint questions were excluded.`);
    };
    const deployMappingToTekion = async () => {
        if (!dealerId) {
            setDeployMessage({
                ok: false,
                text: "Dealer ID is missing. Select a Dealer Profile in Settings first.",
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
        const rowsForDeploy = ensureRequiredDefaultRows(mappingList, dealerId, bootstrap);
        if (rowsForDeploy.length !== mappingList.length) {
            setMappingList(rowsForDeploy);
        }
        const unmappedOptionRows = rowsForDeploy.filter((row) => Object.entries(row.attributes).some(([k, v]) => isPaymentMethodColumn(k) &&
            (v === "MISSING_GENERATED_PAYMENT_METHOD_ID" || v === "")));
        if (unmappedOptionRows.length > 0) {
            setDeployMessage({
                ok: false,
                text: `Deployment blocked: ${unmappedOptionRows.length} mapping row(s) require custom field options in Tekion that are not yet created or loaded in Bootstrap. Check the alert banner above.`,
            });
            return;
        }
        const payload = {
            module: config.module,
            name: config.name,
            criteriaList: [],
            mappingColumns: config.mappingColumns,
            mappingList: rowsForDeploy,
            ruleAsset: "GLACCOUNT",
        };
        setDeploying(true);
        setDeployMessage(null);
        try {
            await saveDraft(rowsForDeploy, dealerId);
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
            const json = (await response.json());
            if ((json.status ?? 200) >= 400) {
                throw new Error(`${json.status ?? ""} ${json.statusText ?? "Tekion request failed"}`.trim());
            }
            setDeployMessage({
                ok: true,
                text: `Successfully sent ${mappingList.length} mapping row(s) for "${config.name}" to Tekion.`,
            });
        }
        catch (error) {
            setDeployMessage({
                ok: false,
                text: error instanceof Error ? error.message : "Failed to send mapping to Tekion.",
            });
        }
        finally {
            setDeploying(false);
        }
    };
    const payloadPreview = useMemo(() => ({
        module: config.module,
        name: config.name,
        criteriaList: [],
        mappingColumns: config.mappingColumns,
        mappingList,
        ruleAsset: "GLACCOUNT",
    }), [config.mappingColumns, config.module, config.name, mappingList]);
    return (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsxs("div", { style: { display: "grid", gap: 6 }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 22, fontWeight: 800 }, children: config.title }), _jsx("div", { style: { color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }, children: config.description })] }), _jsxs("div", { style: {
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    alignItems: "center",
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.025)",
                }, children: [_jsxs("span", { style: { color: "#94a3b8", fontSize: 12 }, children: ["Dealer: ", _jsx("b", { style: { color: "#f8fafc" }, children: dealerId || "Not found" })] }), _jsxs("span", { style: { color: "#94a3b8", fontSize: 12 }, children: ["Blueprint:", " ", _jsx("b", { style: { color: accountingBlueprint.hasBlueprint ? "#86efac" : "#fca5a5" }, children: accountingBlueprint.hasBlueprint ? "Connected" : "Not found" })] }), _jsxs("span", { style: { color: "#94a3b8", fontSize: 12 }, children: ["Bootstrap:", " ", _jsx("b", { style: { color: bootstrap ? "#86efac" : "#fca5a5" }, children: bootstrap ? `${accounts.length} GL accounts` : "Not found" })] }), _jsxs("div", { style: { marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => void reload(), children: "\u27F3 Reload" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => void resetFromBlueprint(), children: "Reset From Blueprint" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", disabled: loading || !dealerId, onClick: () => void syncActiveRowsFromValidatedBlueprint(), title: "Updates active payload rows from Blueprint and Bootstrap, removing unanswered questions", children: "\u21E3 Sync Validated Rows" }), _jsx("button", { className: "btn-postman", type: "button", disabled: deploying || !dealerId, onClick: () => void deployMappingToTekion(), title: "Uses Global Headers from the selected Dealer Profile in Settings", children: deploying
                                    ? "Sending to Tekion..."
                                    : `⇢ Send ${mappingList.length} Row${mappingList.length === 1 ? "" : "s"} to Tekion` })] })] }), missingOptionsList.length > 0 && (_jsxs("div", { style: {
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: "1px solid rgba(245, 158, 11, 0.35)",
                    background: "rgba(245, 158, 11, 0.12)",
                    color: "#fbbf24",
                    fontSize: 12.5,
                    lineHeight: 1.5,
                }, children: [_jsx("strong", { style: { fontSize: 13 }, children: "\u26A0 Missing Custom Field Option Detected:" }), _jsx("div", { style: { marginTop: 4 }, children: "The Blueprint assigns GL accounts to the following payment method(s), but their corresponding options are missing from Tekion custom fields:" }), _jsx("ul", { style: { margin: "6px 0 0 18px", padding: 0 }, children: missingOptionsList.map((item) => (_jsxs("li", { children: [_jsx("strong", { children: item.rule.paymentMethodField?.optionName }), " (GL: ", _jsx("code", { children: item.accountNumber }), ") is missing under custom field ", _jsx("code", { children: item.rule.paymentMethodField?.customFieldKey }), ". Create this option in Tekion before deploying."] }, item.rule.key))) })] })), message ? (_jsx("div", { style: {
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(59,130,246,0.22)",
                    background: "rgba(59,130,246,0.08)",
                    color: "#bfdbfe",
                    fontSize: 13,
                }, children: message })) : null, deployMessage ? (_jsx("div", { style: {
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: deployMessage.ok
                        ? "1px solid rgba(34,197,94,0.25)"
                        : "1px solid rgba(239,68,68,0.25)",
                    background: deployMessage.ok
                        ? "rgba(34,197,94,0.10)"
                        : "rgba(239,68,68,0.10)",
                    color: deployMessage.ok ? "#bbf7d0" : "#fecaca",
                    fontSize: 13,
                }, children: deployMessage.text })) : null, _jsxs("div", { style: {
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.08)",
                    overflow: "auto",
                }, children: [_jsx("div", { style: { padding: "10px 14px", color: "#94a3b8", fontSize: 12 }, children: "Blueprint Verification Table (Only displaying answers populated in Blueprint + Required Defaults)" }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: 1080 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "rgba(255,255,255,0.05)" }, children: [_jsx("th", { style: headerStyle, children: "Blueprint Section" }), _jsx("th", { style: headerStyle, children: "Blueprint Question" }), _jsx("th", { style: headerStyle, children: "Decoded Value" }), _jsx("th", { style: headerStyle, children: "GL Account #" }), _jsx("th", { style: headerStyle, children: "Bootstrap GL Status" }), _jsx("th", { style: headerStyle, children: "Generated Payment Method ID" })] }) }), _jsxs("tbody", { children: [sourceRows.map((source) => (_jsxs("tr", { style: { borderTop: "1px solid rgba(255,255,255,0.06)" }, children: [_jsx("td", { style: cellStyle, children: source.rule.blueprintSection }), _jsx("td", { style: cellStyle, children: source.rule.blueprintQuestion }), _jsx("td", { style: { ...cellStyle, fontFamily: "ui-monospace, monospace" }, children: source.decodedValue || "—" }), _jsx("td", { style: { ...cellStyle, fontFamily: "ui-monospace, monospace" }, children: source.accountNumber ?? "9999" }), _jsx("td", { style: cellStyle, children: _jsxs("span", { style: { color: getStatusColor(source.accountFound), fontWeight: 700 }, children: [source.matchType === "exact" && "✓ Valid", source.matchType === "fallback_stripped" && "✓ Valid (Stripped Suffix)", source.matchType === "not_found" && "Fallback → 9999"] }) }), _jsx("td", { style: { ...cellStyle, fontFamily: "ui-monospace, monospace" }, children: source.rule.paymentMethodField ? (source.generatedPaymentMethodId ? (source.generatedPaymentMethodId) : source.isMissingCustomOption ? (_jsxs("span", { style: { color: "#f87171", fontWeight: 700 }, children: ["\u26A0 Option \"", source.rule.paymentMethodField.optionName, "\" Missing in Tekion"] })) : (_jsx("span", { style: { color: "#94a3b8" }, children: "Missing generated ID" }))) : ("Not required") })] }, source.rule.key))), sourceRows.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 6, style: { ...cellStyle, color: "#94a3b8" }, children: "No matching questions answered in this Blueprint." }) }))] })] })] }), _jsxs("div", { style: {
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.08)",
                    overflow: "auto",
                }, children: [_jsxs("div", { style: { padding: "12px 14px", color: "#f8fafc", fontWeight: 800 }, children: ["Active Payload Mapping Rows (", mappingList.length, ")"] }), _jsxs("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: 980 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "rgba(255,255,255,0.05)" }, children: [_jsx("th", { style: headerStyle, children: "#" }), config.mappingColumns.map((column) => (_jsx("th", { style: headerStyle, children: column }, column))), _jsx("th", { style: headerStyle, children: "mappedAssetId" }), _jsx("th", { style: {
                                                ...headerStyle,
                                                position: "sticky",
                                                right: 0,
                                                zIndex: 2,
                                                background: "#172033",
                                            }, children: "Action" })] }) }), _jsxs("tbody", { children: [mappingList.map((row, index) => (_jsxs("tr", { style: { borderTop: "1px solid rgba(255,255,255,0.06)" }, children: [_jsx("td", { style: cellStyle, children: index + 1 }), config.mappingColumns.map((column) => {
                                                const paymentMethodName = findPaymentMethodNameByGeneratedId(config.rules, row, column, bootstrap, dealerId);
                                                return (_jsxs("td", { style: {
                                                        ...cellStyle,
                                                        fontFamily: "ui-monospace, monospace",
                                                    }, children: [_jsx("code", { style: { color: "#e2e8f0", fontSize: 12 }, children: row.attributes[column] || "—" }), paymentMethodName ? (_jsx("div", { title: paymentMethodName, style: {
                                                                marginTop: 5,
                                                                color: "#94a3b8",
                                                                fontFamily: "inherit",
                                                                fontSize: 11,
                                                                lineHeight: 1.35,
                                                                overflowWrap: "anywhere",
                                                            }, children: paymentMethodName })) : null] }, column));
                                            }), _jsxs("td", { style: cellStyle, children: [_jsx("input", { type: "text", value: row.mappedAssetId || "", onChange: (event) => updateMappedAssetIdDraft(row.rowId, index, event.target.value), onBlur: (event) => void saveMappedAssetIdEdit(row.rowId, index, event.currentTarget.value), placeholder: `${dealerId || "dealerId"}_GLAccount`, title: "Editable mappedAssetId. Normal GL mappings use dealerId_GLAccount, for example 8111_32400. " +
                                                            "The protected Vehicle Inventory default normally remains INVV.", style: {
                                                            width: "100%",
                                                            minWidth: 175,
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
                                                            lineHeight: 1.35,
                                                        }, children: "Manual override \u2014 saved when you leave this field." })] }), _jsx("td", { style: {
                                                    ...cellStyle,
                                                    position: "sticky",
                                                    right: 0,
                                                    zIndex: 1,
                                                    background: "#111827",
                                                }, children: (() => {
                                                    const matchingRule = findMatchingRuleForRow(row);
                                                    const isRequiredDefault = Boolean(matchingRule?.alwaysInclude);
                                                    return (_jsx("button", { type: "button", className: isRequiredDefault ? "btn-secondary btn-xs" : "btn-danger btn-xs", disabled: isRequiredDefault, onClick: () => void deleteRow(row.rowId, index), title: isRequiredDefault
                                                            ? "Required Vehicle Inventory - INVV system default"
                                                            : "Remove this row from the saved draft and outgoing Tekion payload", children: isRequiredDefault ? "🔒 Required Default" : "🗑 Delete" }));
                                                })() })] }, row.rowId ?? `${index}-${row.mappedAssetId}`))), !loading && mappingList.length === 0 ? (_jsx("tr", { children: _jsx("td", { colSpan: config.mappingColumns.length + 3, style: { ...cellStyle, color: "#94a3b8" }, children: "No mapping rows populated from Blueprint. The synchronized payload will send an empty mappingList." }) })) : null] })] })] }), _jsxs("details", { children: [_jsxs("summary", { style: { cursor: "pointer", color: "#cbd5e1", fontWeight: 700 }, children: ["Show synchronized payload preview (", mappingList.length, " rows)"] }), _jsx("pre", { style: {
                            marginTop: 10,
                            padding: 12,
                            borderRadius: 12,
                            background: "#0f172a",
                            color: "#e2e8f0",
                            overflow: "auto",
                            fontSize: 12,
                        }, children: JSON.stringify(payloadPreview, null, 2) })] })] }));
};
const headerStyle = {
    textAlign: "left",
    padding: "10px 12px",
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: 800,
};
const cellStyle = {
    padding: "10px 12px",
    color: "#e2e8f0",
    fontSize: 12,
    verticalAlign: "top",
};
