import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadGlobalHeaders } from "../../../services/tekionApiSettings";
import { idbGetBlueprint, idbGetAllBlueprints, } from "../../../utils/blueprintDb";
import { getStores } from "../../../services/storesDb";
import { useServiceBlueprint } from "../../../Context/Blueprint_Service_Context";
const ACCOUNTING_BOOTSTRAP_URL = "https://preprodapp.tekioncloud.com/api/accounting/u/configurable/bootstrap";
const INVENTORY_COLLAPSE_KEYWORDS = [
    "new car inventory",
    "new truck inventory",
    "used car inventory",
    "used truck inventory",
    "vehicle inventory -invv",
    "vehicle inventory",
];
const logger = {
    debug: (...args) => console.debug("[SetupFields]", ...args),
    info: (...args) => console.info("[SetupFields]", ...args),
    warn: (...args) => console.warn("[SetupFields]", ...args),
    error: (...args) => console.error("[SetupFields]", ...args),
};
function normalize(value) {
    return String(value ?? "").trim();
}
function normalizeLower(value) {
    return normalize(value).toLowerCase();
}
function cleanString(str) {
    return normalizeLower(str).replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}
function isOptionInactive(opt) {
    if (opt.deleted === true)
        return true;
    const extrasInactive = opt.extras?.inactive;
    if (Array.isArray(extrasInactive)) {
        return extrasInactive.length > 0 && String(extrasInactive[0]).toLowerCase() === "true";
    }
    return String(extrasInactive).toLowerCase() === "true";
}
function toEnabledHeaderMap(headers) {
    const out = {};
    for (const row of headers) {
        if (!row?.enabled)
            continue;
        const key = normalize(row.key);
        const value = normalize(row.value);
        if (!key || !value)
            continue;
        out[key] = value;
    }
    return out;
}
function findHeaderValueCaseInsensitive(headers, candidates) {
    const entries = Object.entries(headers);
    for (const candidate of candidates) {
        const found = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
        if (found?.[1])
            return normalize(found[1]);
    }
    return "";
}
function extractDealerIdFromHeaders(headers) {
    return findHeaderValueCaseInsensitive(headers, [
        "dealerid",
        "dealerId",
        "dealer-id",
        "x-dealer-id",
    ]);
}
/** Unified Requirements & Rules Popover for all 4 Cost Centers */
const UnifiedRequirementsTip = ({ blueprintMethodsCount, }) => {
    const [open, setOpen] = useState(false);
    const containerRef = useRef(null);
    useEffect(() => {
        const handleOutsideClick = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) {
                setOpen(false);
            }
        };
        if (open)
            document.addEventListener("mousedown", handleOutsideClick);
        return () => document.removeEventListener("mousedown", handleOutsideClick);
    }, [open]);
    const rules = [
        {
            title: "RO- CP Insur/Warr Split",
            targets: ["Service Contracts"],
            rule: "Matches against existing options containing 'service contract'. Creates 'Service Contracts' if not found.",
        },
        {
            title: "RO Warranty",
            targets: ["Warranty Receivable", "PDI"],
            rule: "Audits both target options independently. Injects any missing option without duplicating existing items.",
        },
        {
            title: "Parts Internal",
            targets: ["Vehicle Inventory - INVV", "Other Supplies"],
            rule: "Inactivates deprecated legacy IDs (NEW_TRUCK, USED_CAR, USED_TRUCK). Enforces Vehicle Inventory and Other Supplies.",
        },
        {
            title: "RO Internal",
            targets: ["Vehicle Inventory - INVV", `+${blueprintMethodsCount} Blueprint Methods`],
            rule: "Always provisions Vehicle Inventory - INVV as default. Syncs internal payment methods from Accounting Conquest Blueprint.",
        },
    ];
    return (_jsxs("div", { ref: containerRef, style: { position: "relative", display: "inline-flex" }, children: [_jsxs("button", { type: "button", onClick: () => setOpen((prev) => !prev), style: {
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 8px",
                    borderRadius: 4,
                    background: open ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    color: open ? "#f1f5f9" : "#94a3b8",
                    fontSize: 12,
                    cursor: "pointer",
                    fontWeight: 500,
                }, title: "View requirements and rules for all 4 cost centers", children: [_jsx("span", { style: {
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 14,
                            height: 14,
                            borderRadius: "50%",
                            background: "rgba(255,255,255,0.1)",
                            fontSize: 10,
                            fontWeight: 700,
                        }, children: "i" }), _jsx("span", { children: "Requirements & Rules" })] }), open && (_jsxs("div", { style: {
                    position: "absolute",
                    top: "125%",
                    right: 0,
                    width: 440,
                    maxWidth: "90vw",
                    background: "#0f172a",
                    border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: 8,
                    boxShadow: "0 12px 30px rgba(0,0,0,0.6)",
                    padding: 14,
                    zIndex: 100,
                    display: "grid",
                    gap: 10,
                }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 6 }, children: [_jsx("span", { style: { fontSize: 13, fontWeight: 600, color: "#f1f5f9" }, children: "Cost Center Target Requirements Matrix" }), _jsx("button", { type: "button", onClick: () => setOpen(false), style: { background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 13 }, children: "\u2715" })] }), _jsx("div", { style: { display: "grid", gap: 8 }, children: rules.map((item, idx) => (_jsxs("div", { style: {
                                background: "rgba(255,255,255,0.02)",
                                border: "1px solid rgba(255,255,255,0.05)",
                                borderRadius: 5,
                                padding: "8px 10px",
                                display: "grid",
                                gap: 4,
                            }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsx("span", { style: { fontSize: 12, fontWeight: 600, color: "#cbd5e1" }, children: item.title }), _jsx("div", { style: { display: "flex", gap: 4, flexWrap: "wrap" }, children: item.targets.map((tgt, tIdx) => (_jsx("span", { style: {
                                                    fontSize: 10,
                                                    fontFamily: "monospace",
                                                    color: "#94a3b8",
                                                    background: "rgba(255,255,255,0.04)",
                                                    padding: "1px 5px",
                                                    borderRadius: 3,
                                                    border: "1px solid rgba(255,255,255,0.06)",
                                                }, children: tgt }, tIdx))) })] }), _jsx("div", { style: { fontSize: 11, color: "#64748b", lineHeight: 1.4 }, children: item.rule })] }, idx))) })] }))] }));
};
function findMatchingExistingOption(target, existingList) {
    const targetClean = cleanString(target);
    if (targetClean.includes("vehicle inventory")) {
        const match = existingList.find((opt) => cleanString(opt.name ?? "").includes("vehicle inventory"));
        if (match)
            return match;
    }
    if (targetClean === "pdi" || targetClean.startsWith("pdi ")) {
        const match = existingList.find((opt) => {
            const optClean = cleanString(opt.name ?? "");
            return /\bpdi\b/.test(optClean);
        });
        if (match)
            return match;
    }
    if (targetClean.includes("service contract")) {
        const match = existingList.find((opt) => cleanString(opt.name ?? "").includes("service contract"));
        if (match)
            return match;
    }
    if (targetClean.includes("warranty receivable")) {
        const match = existingList.find((opt) => {
            const optClean = cleanString(opt.name ?? "");
            return optClean.includes("warranty receivable") || optClean === "warranty";
        });
        if (match)
            return match;
    }
    return (existingList.find((opt) => cleanString(opt.name ?? "") === targetClean) ?? null);
}
function validateAndProcessRepairOrderInternal(existingOptions, selectedChips) {
    const candidateNames = ["Vehicle Inventory -INVV"];
    for (const name of selectedChips) {
        const lower = normalizeLower(name);
        if (INVENTORY_COLLAPSE_KEYWORDS.includes(lower))
            continue;
        if (!candidateNames.some((c) => normalizeLower(c) === lower)) {
            candidateNames.push(name.trim());
        }
    }
    const audits = [];
    const optionsToAdd = [];
    for (const candidate of candidateNames) {
        const match = findMatchingExistingOption(candidate, existingOptions);
        if (match) {
            audits.push({
                candidate,
                status: "EXISTS",
                detail: `Already present as "${match.name}"`,
            });
        }
        else {
            audits.push({
                candidate,
                status: "WILL_ADD",
                detail: "Missing in Tekion; marked to add",
            });
            optionsToAdd.push({
                name: candidate,
                extras: {
                    enableControl: [false],
                    enableControl2: [false],
                    inactive: ["false"],
                },
            });
        }
    }
    return {
        mergedOptions: [...existingOptions, ...optionsToAdd],
        hasNewOptions: optionsToAdd.length > 0,
        audits,
        addedCount: optionsToAdd.length,
    };
}
function validateAndProcessCpIwSplit(existingOptions) {
    const match = findMatchingExistingOption("Service Contracts", existingOptions);
    const audits = [];
    let merged = existingOptions;
    let hasNew = false;
    if (match) {
        audits.push({
            candidate: "Service Contracts",
            status: "EXISTS",
            detail: `Matched option: "${match.name}"`,
        });
    }
    else {
        audits.push({
            candidate: "Service Contracts",
            status: "WILL_ADD",
            detail: "Missing; will add 'Service Contracts'",
        });
        merged = [
            ...existingOptions,
            {
                name: "Service Contracts",
                extras: { inactive: ["false"] },
            },
        ];
        hasNew = true;
    }
    return { mergedOptions: merged, hasNewOptions: hasNew, audits, addedCount: hasNew ? 1 : 0 };
}
function validateAndProcessWarranty(existingOptions) {
    const audits = [];
    const optionsToAdd = [];
    const matchWarranty = findMatchingExistingOption("Warranty Receivable", existingOptions);
    if (matchWarranty) {
        audits.push({
            candidate: "Warranty Receivable",
            status: "EXISTS",
            detail: `Matched option: "${matchWarranty.name}"`,
        });
    }
    else {
        audits.push({
            candidate: "Warranty Receivable",
            status: "WILL_ADD",
            detail: "Missing; will add 'Warranty Receivable'",
        });
        optionsToAdd.push({
            name: "Warranty Receivable",
            extras: { inactive: ["false"] },
        });
    }
    const matchPdi = findMatchingExistingOption("PDI", existingOptions);
    if (matchPdi) {
        audits.push({
            candidate: "PDI",
            status: "EXISTS",
            detail: `Matched option: "${matchPdi.name}"`,
        });
    }
    else {
        audits.push({
            candidate: "PDI",
            status: "WILL_ADD",
            detail: "Missing; will add 'PDI'",
        });
        optionsToAdd.push({
            name: "PDI",
            extras: { inactive: ["false"] },
        });
    }
    return {
        mergedOptions: [...existingOptions, ...optionsToAdd],
        hasNewOptions: optionsToAdd.length > 0,
        audits,
        addedCount: optionsToAdd.length,
    };
}
function validateAndProcessPartsInternal(existingOptions) {
    const inactiveIds = ["NEW_TRUCK_INVENTORY", "USED_CAR_INVENTORY", "USED_TRUCK_INVENTORY"];
    const audits = [];
    let changesNeeded = false;
    let addedCount = 0;
    const processedOptions = existingOptions.map((option) => {
        const shouldBeInactive = inactiveIds.includes(normalize(option.id));
        const currentlyInactive = option.extras?.inactive?.[0] === "true";
        const currentlyDeleted = option.deleted === true;
        if (shouldBeInactive) {
            if (!currentlyInactive || !currentlyDeleted) {
                changesNeeded = true;
                addedCount += 1;
                audits.push({
                    candidate: option.name ?? option.id ?? "Inventory",
                    status: "INACTIVATED",
                    detail: `Inactivate obsolete ID (${option.id})`,
                });
            }
            else {
                audits.push({
                    candidate: option.name ?? option.id ?? "Inventory",
                    status: "EXISTS",
                    detail: `Inactive verified (${option.id})`,
                });
            }
        }
        return {
            ...option,
            deleted: shouldBeInactive,
            extras: {
                ...(option.extras ?? {}),
                inactive: [shouldBeInactive ? "true" : "false"],
            },
        };
    });
    const vehicleInvMatch = findMatchingExistingOption("Vehicle Inventory", processedOptions);
    if (!vehicleInvMatch) {
        processedOptions.push({
            name: "Vehicle Inventory - INVV",
            formEditable: true,
            extras: {
                enableControl: [false],
                enableControl2: [false],
                inactive: ["false"],
            },
            deleted: false,
            systemDefined: false,
        });
        changesNeeded = true;
        addedCount += 1;
        audits.push({
            candidate: "Vehicle Inventory - INVV",
            status: "WILL_ADD",
            detail: "Missing; will add 'Vehicle Inventory - INVV'",
        });
    }
    else {
        audits.push({
            candidate: "Vehicle Inventory - INVV",
            status: "EXISTS",
            detail: `Matched option: "${vehicleInvMatch.name}"`,
        });
    }
    const otherSuppliesMatch = findMatchingExistingOption("Other Supplies", processedOptions);
    if (!otherSuppliesMatch) {
        processedOptions.push({
            id: "OTHER_SUPPLIES",
            name: "Other Supplies",
            formEditable: true,
            extras: {
                default: ["true"],
                code: ["OTHER_SUPPLIES"],
                inactive: ["false"],
            },
            deleted: false,
            systemDefined: false,
            details: null,
            languages: null,
        });
        changesNeeded = true;
        addedCount += 1;
        audits.push({
            candidate: "Other Supplies",
            status: "WILL_ADD",
            detail: "Missing; will add 'Other Supplies'",
        });
    }
    else {
        audits.push({
            candidate: "Other Supplies",
            status: "EXISTS",
            detail: `Matched option: "${otherSuppliesMatch.name}"`,
        });
    }
    return {
        mergedOptions: processedOptions,
        hasNewOptions: changesNeeded,
        audits,
        addedCount,
    };
}
export const SetupFieldsView = () => {
    const serviceBlueprint = useServiceBlueprint();
    const [headerMap, setHeaderMap] = useState({});
    const [activeTab, setActiveTab] = useState("audit");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);
    const [costCenterFields, setCostCenterFields] = useState([]);
    const [configureResults, setConfigureResults] = useState([]);
    const [dryRunReports, setDryRunReports] = useState([]);
    const [rawBootstrapResponse, setRawBootstrapResponse] = useState(null);
    const [showRawBootstrap, setShowRawBootstrap] = useState(false);
    const [internalChips, setInternalChips] = useState([]);
    const [customChipInput, setCustomChipInput] = useState("");
    const [chipSearch, setChipSearch] = useState("");
    const [blueprintSynced, setBlueprintSynced] = useState(false);
    const [blueprintSyncDetail, setBlueprintSyncDetail] = useState(null);
    // Dropdown state for Pre-Flight Delta Audit Trail
    const [showAuditTrail, setShowAuditTrail] = useState(false);
    const rawDealerId = useMemo(() => serviceBlueprint?.selectedDealerId || extractDealerIdFromHeaders(headerMap), [serviceBlueprint?.selectedDealerId, headerMap]);
    const dealerId = normalize(rawDealerId);
    const tekionId = serviceBlueprint?.tekionId || null;
    const headerCount = useMemo(() => Object.keys(headerMap).length, [headerMap]);
    const refreshHeaders = useCallback(() => {
        try {
            const loaded = toEnabledHeaderMap(loadGlobalHeaders());
            setHeaderMap(loaded);
            return loaded;
        }
        catch (e) {
            logger.error("Failed to refresh global headers", e);
            setHeaderMap({});
            return {};
        }
    }, []);
    useEffect(() => {
        refreshHeaders();
    }, [refreshHeaders]);
    const syncInternalMethodsFromBlueprint = useCallback(async () => {
        if (!dealerId && !tekionId)
            return [];
        try {
            let resolvedTekionId = tekionId;
            if (!resolvedTekionId) {
                const stores = await getStores();
                const store = stores.find((s) => s.dealer_id?.trim().toLowerCase() === dealerId.toLowerCase());
                resolvedTekionId = store?.tekion_id?.trim() ?? null;
            }
            let accountingBp;
            if (resolvedTekionId) {
                const expectedKey = `${resolvedTekionId}-Blueprint_-_Conquest_-_Accounting`;
                accountingBp = await idbGetBlueprint(expectedKey);
            }
            if (!accountingBp) {
                const all = await idbGetAllBlueprints();
                const matches = all.filter((rec) => {
                    const isAccounting = (rec.formName ?? "").toLowerCase().includes("accounting") ||
                        rec.key.toLowerCase().includes("accounting");
                    if (!isAccounting)
                        return false;
                    const matchTekion = resolvedTekionId &&
                        (rec.tekionId?.trim() === resolvedTekionId ||
                            rec.key.startsWith(resolvedTekionId));
                    const matchDealer = rec.dealerId?.trim() === dealerId || rec.key.includes(dealerId);
                    return matchTekion || matchDealer;
                });
                if (matches.length > 0) {
                    matches.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
                    accountingBp = matches[0];
                }
            }
            if (!accountingBp) {
                setBlueprintSynced(false);
                setBlueprintSyncDetail("No Accounting Blueprint found");
                return [];
            }
            const decoded = (accountingBp.decodedResponse ??
                accountingBp.data);
            const flatRows = decoded?.populatedFlatRows ?? decoded?.allFields ?? [];
            const targetRow = flatRows.find((r) => {
                const title = normalizeLower(r.title);
                return (title.includes("which internal payment methods do you use") ||
                    title.includes("internal payment methods"));
            });
            if (!targetRow || targetRow.decodedValue === undefined || targetRow.decodedValue === null) {
                setBlueprintSynced(false);
                setBlueprintSyncDetail("Unanswered in Blueprint");
                return [];
            }
            const rawVal = targetRow.decodedValue;
            let rawList = [];
            if (Array.isArray(rawVal)) {
                rawList = rawVal.map((x) => String(x).trim()).filter(Boolean);
            }
            else if (typeof rawVal === "string") {
                rawList = rawVal.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
            }
            const nonInventory = rawList.filter((item) => !INVENTORY_COLLAPSE_KEYWORDS.includes(normalizeLower(item)));
            setInternalChips(nonInventory);
            setBlueprintSynced(true);
            setBlueprintSyncDetail(`Imported ${nonInventory.length} methods from Blueprint`);
            return nonInventory;
        }
        catch (err) {
            logger.error("Failed to load Accounting Blueprint for internal payment methods", err);
            setBlueprintSynced(false);
            setBlueprintSyncDetail("Error reading Blueprint");
            return [];
        }
    }, [dealerId, tekionId]);
    const proxyRequest = useCallback(async (payload, headersOverride) => {
        const activeHeaders = headersOverride ?? headerMap;
        const res = await fetch("http://localhost:4000/api/proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url: payload.url,
                method: payload.method,
                headers: {
                    ...activeHeaders,
                    ...(payload.body ? { "content-type": "application/json" } : {}),
                },
                body: payload.body,
                timeout: 60000,
            }),
        });
        if (!res.ok) {
            throw new Error(`Proxy request failed with HTTP ${res.status}`);
        }
        const json = await res.json();
        if ((json?.status ?? 200) >= 400) {
            throw new Error(`${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim());
        }
        return json?.body ?? json?.data ?? json;
    }, [headerMap]);
    const fetchBootstrapCustomFields = useCallback(async (headersOverride) => {
        if (!dealerId) {
            throw new Error("Dealer ID not found in Global Headers or Service Context.");
        }
        const payload = {
            requestInfo: [
                {
                    assetType: "customField",
                    dealerMetaDataInfo: [{ dealerId }],
                },
            ],
        };
        const response = (await proxyRequest({
            url: ACCOUNTING_BOOTSTRAP_URL,
            method: "POST",
            body: payload,
        }, headersOverride));
        const customField = (response?.data?.customField ??
            response?.customField ??
            null);
        if (!customField) {
            throw new Error("customField data not found in bootstrap response.");
        }
        const masterMap = (customField?.masterAssetDocMap ?? {});
        const dealerMap = (customField?.dealerAssetDocMap?.[dealerId] ??
            customField?.dealerAssetDocMap ??
            {});
        const mergedMap = { ...masterMap, ...dealerMap };
        const allFields = Object.values(mergedMap);
        const fields = allFields.filter((field) => normalize(field?.assetSubType) === "cost_center");
        setRawBootstrapResponse(response);
        setCostCenterFields(fields);
        return fields;
    }, [dealerId, proxyRequest]);
    const runDryRunAudit = useCallback(async (providedFields, chipsOverride) => {
        setLoading(true);
        setConfigureResults([]);
        try {
            const fields = providedFields ?? (await fetchBootstrapCustomFields());
            const activeChips = chipsOverride ?? internalChips;
            const reports = [];
            for (const field of fields) {
                const key = normalize(field.key);
                const existing = field.options || [];
                if (key === "REPAIR_ORDER_INTERNAL") {
                    const res = validateAndProcessRepairOrderInternal(existing, activeChips);
                    reports.push({
                        fieldKey: key,
                        fieldName: field.name || "Repair Order Internal",
                        fieldId: field.id || "—",
                        existingCount: existing.length,
                        newOptionsCount: res.addedCount,
                        verdict: res.hasNewOptions ? "WOULD_UPDATE" : "WOULD_SKIP",
                        summary: res.hasNewOptions
                            ? `Will add ${res.addedCount} option(s)`
                            : "Options verified in Tekion",
                        audits: res.audits,
                    });
                }
                else if (key === "REPAIR_ORDER_CP_IW_SPLIT") {
                    const res = validateAndProcessCpIwSplit(existing);
                    reports.push({
                        fieldKey: key,
                        fieldName: field.name || "Repair Order CP IW Split",
                        fieldId: field.id || "—",
                        existingCount: existing.length,
                        newOptionsCount: res.addedCount,
                        verdict: res.hasNewOptions ? "WOULD_UPDATE" : "WOULD_SKIP",
                        summary: res.hasNewOptions
                            ? "Will add Service Contracts"
                            : "Matched existing option",
                        audits: res.audits,
                    });
                }
                else if (key === "REPAIR_ORDER_WARRANTY") {
                    const res = validateAndProcessWarranty(existing);
                    reports.push({
                        fieldKey: key,
                        fieldName: field.name || "Repair Order Warranty",
                        fieldId: field.id || "—",
                        existingCount: existing.length,
                        newOptionsCount: res.addedCount,
                        verdict: res.hasNewOptions ? "WOULD_UPDATE" : "WOULD_SKIP",
                        summary: res.hasNewOptions
                            ? `Will add ${res.addedCount} option(s)`
                            : "Matched existing options",
                        audits: res.audits,
                    });
                }
                else if (key === "PARTS_SALES_ORDER_INTERNAL") {
                    const res = validateAndProcessPartsInternal(existing);
                    reports.push({
                        fieldKey: key,
                        fieldName: field.name || "Parts Sales Order Internal",
                        fieldId: field.id || "—",
                        existingCount: existing.length,
                        newOptionsCount: res.addedCount,
                        verdict: res.hasNewOptions ? "WOULD_UPDATE" : "WOULD_SKIP",
                        summary: res.hasNewOptions
                            ? `Will apply ${res.addedCount} modification(s)`
                            : "All options verified",
                        audits: res.audits,
                    });
                }
            }
            setDryRunReports(reports);
            const updatesCount = reports.filter((r) => r.verdict === "WOULD_UPDATE").length;
            setMessage({
                ok: true,
                text: `Audit finished: ${updatesCount} field(s) require modifications.`,
            });
        }
        catch (e) {
            logger.error("Audit dry run failed", e);
            setMessage({
                ok: false,
                text: e instanceof Error ? e.message : "Dry run failed",
            });
        }
        finally {
            setLoading(false);
        }
    }, [fetchBootstrapCustomFields, internalChips]);
    const handleSyncAll = useCallback(async () => {
        const freshHeaders = refreshHeaders();
        const freshChips = await syncInternalMethodsFromBlueprint();
        const fields = await fetchBootstrapCustomFields(freshHeaders);
        await runDryRunAudit(fields, freshChips);
    }, [fetchBootstrapCustomFields, refreshHeaders, runDryRunAudit, syncInternalMethodsFromBlueprint]);
    useEffect(() => {
        let isMounted = true;
        const init = async () => {
            if (!dealerId)
                return;
            try {
                const freshChips = await syncInternalMethodsFromBlueprint();
                if (!isMounted)
                    return;
                const fields = await fetchBootstrapCustomFields();
                if (!isMounted)
                    return;
                await runDryRunAudit(fields, freshChips);
            }
            catch (e) {
                logger.error("Initialization failed", e);
            }
        };
        void init();
        return () => {
            isMounted = false;
        };
    }, [dealerId]); // eslint-disable-line react-hooks/exhaustive-deps
    const handleApply = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        setConfigureResults([]);
        try {
            const fields = await fetchBootstrapCustomFields();
            const results = [];
            for (const field of fields) {
                const key = normalize(field.key);
                const existing = field.options || [];
                let validationResult = null;
                if (key === "REPAIR_ORDER_INTERNAL") {
                    validationResult = validateAndProcessRepairOrderInternal(existing, internalChips);
                }
                else if (key === "REPAIR_ORDER_CP_IW_SPLIT") {
                    validationResult = validateAndProcessCpIwSplit(existing);
                }
                else if (key === "REPAIR_ORDER_WARRANTY") {
                    validationResult = validateAndProcessWarranty(existing);
                }
                else if (key === "PARTS_SALES_ORDER_INTERNAL") {
                    validationResult = validateAndProcessPartsInternal(existing);
                }
                if (validationResult === null) {
                    results.push({
                        field: normalize(field.name) || "Unknown Field",
                        key,
                        status: "skipped",
                        message: "No configuration rule defined",
                    });
                    continue;
                }
                const { mergedOptions, hasNewOptions, addedCount } = validationResult;
                if (!hasNewOptions) {
                    results.push({
                        field: normalize(field.name) || "Unknown Field",
                        key,
                        status: "skipped",
                        message: `Current configuration valid (${existing.length} options)`,
                    });
                    continue;
                }
                try {
                    const updatePayload = {
                        ...field,
                        options: mergedOptions,
                        tenantId: null,
                        defaultValue: null,
                        defaultValueEnabled: false,
                    };
                    await proxyRequest({
                        url: `https://preprodapp.tekioncloud.com/api/settings/u/customField/accounts/${field.id}`,
                        method: "PUT",
                        body: updatePayload,
                    });
                    results.push({
                        field: normalize(field.name) || "Unknown Field",
                        key,
                        status: "success",
                        message: `Updated with ${addedCount} change(s)`,
                    });
                }
                catch (err) {
                    results.push({
                        field: normalize(field.name) || "Unknown Field",
                        key,
                        status: "error",
                        message: err instanceof Error ? err.message : "PUT request failed",
                    });
                }
            }
            setConfigureResults(results);
            const successCount = results.filter((r) => r.status === "success").length;
            const errorCount = results.filter((r) => r.status === "error").length;
            setMessage({
                ok: errorCount === 0,
                text: `Deployment completed: ${successCount} updated, ${errorCount} error(s).`,
            });
            const updatedFields = await fetchBootstrapCustomFields();
            await runDryRunAudit(updatedFields, internalChips);
        }
        catch (e) {
            logger.error("Apply failed", e);
            setMessage({
                ok: false,
                text: e instanceof Error ? e.message : "Failed to apply configuration",
            });
        }
        finally {
            setLoading(false);
        }
    }, [fetchBootstrapCustomFields, internalChips, proxyRequest, runDryRunAudit]);
    const addChip = (name) => {
        const trimmed = name.trim();
        if (!trimmed)
            return;
        const lower = normalizeLower(trimmed);
        if (INVENTORY_COLLAPSE_KEYWORDS.includes(lower)) {
            setMessage({
                ok: false,
                text: `"${trimmed}" is reserved by inventory rules and is handled automatically.`,
            });
            return;
        }
        if (internalChips.some((c) => normalizeLower(c) === lower)) {
            setMessage({
                ok: false,
                text: `"${trimmed}" is already added.`,
            });
            return;
        }
        const updatedChips = [...internalChips, trimmed];
        setInternalChips(updatedChips);
        setCustomChipInput("");
        setChipSearch("");
        void runDryRunAudit(costCenterFields, updatedChips);
    };
    const removeChip = (chipToRemove) => {
        const updatedChips = internalChips.filter((c) => normalizeLower(c) !== normalizeLower(chipToRemove));
        setInternalChips(updatedChips);
        void runDryRunAudit(costCenterFields, updatedChips);
    };
    const fieldKeyMap = useMemo(() => {
        const map = new Map();
        costCenterFields.forEach((f) => map.set(normalize(f.key), f));
        return map;
    }, [costCenterFields]);
    const pendingUpdatesCount = useMemo(() => {
        return dryRunReports.filter((r) => r.verdict === "WOULD_UPDATE").length;
    }, [dryRunReports]);
    const filteredChips = useMemo(() => {
        if (!chipSearch.trim())
            return internalChips;
        return internalChips.filter((c) => c.toLowerCase().includes(chipSearch.toLowerCase()));
    }, [internalChips, chipSearch]);
    const columnsData = useMemo(() => {
        const fSplit = fieldKeyMap.get("REPAIR_ORDER_CP_IW_SPLIT");
        const rSplit = dryRunReports.find((x) => x.fieldKey === "REPAIR_ORDER_CP_IW_SPLIT");
        const isMatchedSplit = rSplit
            ? rSplit.verdict === "WOULD_SKIP"
            : fSplit?.options?.some((o) => !isOptionInactive(o) && cleanString(o.name ?? "").includes("service contract"));
        const fWarr = fieldKeyMap.get("REPAIR_ORDER_WARRANTY");
        const rWarr = dryRunReports.find((x) => x.fieldKey === "REPAIR_ORDER_WARRANTY");
        const isMatchedWarr = rWarr
            ? rWarr.verdict === "WOULD_SKIP"
            : Boolean(fWarr?.options?.some((o) => !isOptionInactive(o) && cleanString(o.name ?? "").includes("warranty receivable")) &&
                fWarr?.options?.some((o) => !isOptionInactive(o) && /\bpdi\b/.test(cleanString(o.name ?? ""))));
        const fParts = fieldKeyMap.get("PARTS_SALES_ORDER_INTERNAL");
        const rParts = dryRunReports.find((x) => x.fieldKey === "PARTS_SALES_ORDER_INTERNAL");
        const isMatchedParts = rParts
            ? rParts.verdict === "WOULD_SKIP"
            : Boolean(fParts?.options?.some((o) => !isOptionInactive(o) && cleanString(o.name ?? "").includes("other supplies")) &&
                fParts?.options?.some((o) => !isOptionInactive(o) && cleanString(o.name ?? "").includes("vehicle inventory")));
        const fInternal = fieldKeyMap.get("REPAIR_ORDER_INTERNAL");
        const rInternal = dryRunReports.find((x) => x.fieldKey === "REPAIR_ORDER_INTERNAL");
        const isOkInternal = rInternal
            ? rInternal.verdict === "WOULD_SKIP"
            : Boolean(fInternal?.options?.some((o) => !isOptionInactive(o) && cleanString(o.name ?? "").includes("vehicle inventory")));
        return [
            {
                title: "RO- CP Insur/Warr Split",
                inSync: Boolean(isMatchedSplit),
                options: fSplit?.options ?? [],
                summary: rSplit?.summary ?? "Pending check",
            },
            {
                title: "RO Warranty",
                inSync: Boolean(isMatchedWarr),
                options: fWarr?.options ?? [],
                summary: rWarr?.summary ?? "Pending check",
            },
            {
                title: "Parts Internal",
                inSync: Boolean(isMatchedParts),
                options: fParts?.options ?? [],
                summary: rParts?.summary ?? "Pending check",
            },
            {
                title: "RO Internal",
                inSync: Boolean(isOkInternal),
                options: fInternal?.options ?? [],
                summary: rInternal?.summary ?? "Pending check",
            },
        ];
    }, [fieldKeyMap, dryRunReports]);
    return (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsxs("div", { style: {
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.02)",
                    padding: 16,
                    display: "grid",
                    gap: 14,
                }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }, children: [_jsx("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: _jsx("span", { style: { fontSize: 16, fontWeight: 600, color: "#f1f5f9" }, children: "Cost Center Setup Engine" }) }), _jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [_jsx("button", { type: "button", className: "btn-secondary btn-sm", onClick: () => void handleSyncAll(), disabled: loading || !dealerId, children: loading ? "Syncing..." : "Sync All" }), _jsx("button", { type: "button", className: "btn-primary btn-sm", onClick: () => void handleApply(), disabled: loading || !dealerId, children: loading ? "Deploying..." : pendingUpdatesCount > 0 ? `Deploy (${pendingUpdatesCount})` : "In Sync" })] })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }, children: [_jsxs("div", { style: {
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "4px 10px",
                                    borderRadius: 4,
                                    background: "rgba(255,255,255,0.03)",
                                    border: "1px solid rgba(255,255,255,0.06)",
                                    fontSize: 12,
                                    color: "#94a3b8",
                                }, children: [_jsx("span", { children: "Dealer:" }), _jsx("span", { style: { color: "#f1f5f9", fontWeight: 500 }, children: dealerId || "Not detected" })] }), tekionId && (_jsxs("div", { style: {
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "4px 10px",
                                    borderRadius: 4,
                                    background: "rgba(255,255,255,0.03)",
                                    border: "1px solid rgba(255,255,255,0.06)",
                                    fontSize: 12,
                                    color: "#94a3b8",
                                }, children: [_jsx("span", { children: "Tekion ID:" }), _jsx("span", { style: { color: "#f1f5f9", fontWeight: 500 }, children: tekionId })] })), _jsxs("div", { style: {
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "4px 10px",
                                    borderRadius: 4,
                                    background: "rgba(255,255,255,0.03)",
                                    border: "1px solid rgba(255,255,255,0.06)",
                                    fontSize: 12,
                                    color: "#94a3b8",
                                }, children: [_jsx("span", { children: "Headers:" }), _jsx("span", { style: { color: "#f1f5f9", fontWeight: 500 }, children: headerCount })] }), _jsxs("div", { style: {
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "4px 10px",
                                    borderRadius: 4,
                                    background: "rgba(255,255,255,0.03)",
                                    border: "1px solid rgba(255,255,255,0.06)",
                                    fontSize: 12,
                                    color: blueprintSynced ? "#cbd5e1" : "#94a3b8",
                                }, children: [_jsx("span", { children: blueprintSynced ? "Blueprint Linked" : "Blueprint Unlinked" }), blueprintSyncDetail && (_jsxs("span", { style: { fontSize: 11, color: "#64748b" }, children: ["(", blueprintSyncDetail, ")"] }))] }), _jsx("div", { style: {
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "4px 10px",
                                    borderRadius: 4,
                                    background: "rgba(255,255,255,0.03)",
                                    border: "1px solid rgba(255,255,255,0.06)",
                                    fontSize: 12,
                                    color: pendingUpdatesCount > 0 ? "#e2e8f0" : "#94a3b8",
                                    marginLeft: "auto",
                                }, children: _jsx("span", { children: pendingUpdatesCount > 0 ? `${pendingUpdatesCount} Updates Required` : "All 4 Cost Centers In Sync" }) })] })] }), _jsxs("div", { style: {
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                    paddingBottom: 6,
                    flexWrap: "wrap",
                    gap: 8,
                }, children: [_jsxs("div", { style: { display: "flex", gap: 4 }, children: [_jsxs("button", { type: "button", onClick: () => setActiveTab("audit"), style: {
                                    background: activeTab === "audit" ? "rgba(255,255,255,0.06)" : "transparent",
                                    border: "none",
                                    color: activeTab === "audit" ? "#f1f5f9" : "#94a3b8",
                                    padding: "6px 14px",
                                    borderRadius: 4,
                                    cursor: "pointer",
                                    fontWeight: 500,
                                    fontSize: 13,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                }, children: [_jsx("span", { children: "Diff Audit" }), dryRunReports.length > 0 && (_jsxs("span", { style: {
                                            fontSize: 11,
                                            color: pendingUpdatesCount > 0 ? "#cbd5e1" : "#64748b",
                                        }, children: ["(", pendingUpdatesCount, ")"] }))] }), _jsxs("button", { type: "button", onClick: () => setActiveTab("configure"), style: {
                                    background: activeTab === "configure" ? "rgba(255,255,255,0.06)" : "transparent",
                                    border: "none",
                                    color: activeTab === "configure" ? "#f1f5f9" : "#94a3b8",
                                    padding: "6px 14px",
                                    borderRadius: 4,
                                    cursor: "pointer",
                                    fontWeight: 500,
                                    fontSize: 13,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                }, children: [_jsx("span", { children: "Payment Methods Studio" }), _jsxs("span", { style: { fontSize: 11, color: "#64748b" }, children: ["(", internalChips.length + 1, ")"] })] })] }), _jsx("button", { type: "button", className: "btn-secondary btn-sm", onClick: () => void runDryRunAudit(), disabled: loading || !dealerId, children: "Run Pre-Flight Audit" })] }), message && (_jsxs("div", { style: {
                    padding: "10px 14px",
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 400,
                    background: "rgba(255,255,255,0.03)",
                    color: message.ok ? "#cbd5e1" : "#f87171",
                    border: `1px solid ${message.ok ? "rgba(255,255,255,0.08)" : "rgba(248,113,113,0.2)"}`,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                }, children: [_jsx("span", { children: message.text }), _jsx("button", { type: "button", onClick: () => setMessage(null), style: { background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 13 }, children: "\u2715" })] })), activeTab === "audit" && (_jsxs("div", { style: { display: "grid", gap: 14 }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsx("span", { style: { color: "#94a3b8", fontSize: 12, fontWeight: 500 }, children: "Live DMS Configuration Status" }), _jsx(UnifiedRequirementsTip, { blueprintMethodsCount: internalChips.length })] }), _jsx("div", { style: {
                            display: "grid",
                            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                            background: "rgba(255,255,255,0.015)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 6,
                            overflow: "hidden",
                        }, children: columnsData.map((col, idx) => (_jsxs("div", { style: {
                                display: "flex",
                                flexDirection: "column",
                                borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.08)" : "none",
                                minWidth: 0,
                            }, children: [_jsxs("div", { style: {
                                        padding: "10px 12px",
                                        background: "rgba(255,255,255,0.03)",
                                        borderBottom: "1px solid rgba(255,255,255,0.08)",
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        gap: 6,
                                    }, children: [_jsx("span", { style: {
                                                color: "#f1f5f9",
                                                fontWeight: 600,
                                                fontSize: 13,
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }, title: col.title, children: col.title }), _jsx("span", { style: {
                                                fontSize: 10,
                                                fontWeight: 600,
                                                letterSpacing: "0.02em",
                                                color: col.inSync ? "#22c55e" : "#e2e8f0",
                                                background: col.inSync ? "rgba(34, 197, 94, 0.1)" : "rgba(255, 255, 255, 0.05)",
                                                border: `1px solid ${col.inSync ? "rgba(34, 197, 94, 0.25)" : "rgba(255, 255, 255, 0.1)"}`,
                                                padding: "2px 6px",
                                                borderRadius: 3,
                                                flexShrink: 0,
                                            }, children: col.inSync ? "IN SYNC" : "UPDATE" })] }), _jsxs("div", { style: {
                                        padding: "12px",
                                        flex: 1,
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 6,
                                        minHeight: 220,
                                        maxHeight: 340,
                                        overflowY: "auto",
                                    }, children: [_jsxs("div", { style: { color: "#64748b", fontSize: 10, textTransform: "uppercase", fontWeight: 600, marginBottom: 4 }, children: ["Live Options (", col.options.length, ")"] }), col.options.length > 0 ? (_jsx("div", { style: { display: "flex", flexDirection: "column", gap: 5 }, children: col.options.map((opt, optIdx) => {
                                                const inactive = isOptionInactive(opt);
                                                return (_jsxs("div", { style: {
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "space-between",
                                                        fontSize: 12,
                                                        padding: "2px 0",
                                                    }, children: [_jsx("span", { style: {
                                                                color: inactive ? "#64748b" : "#22c55e",
                                                                textDecoration: inactive ? "line-through" : "none",
                                                                fontWeight: inactive ? 400 : 500,
                                                                whiteSpace: "nowrap",
                                                                overflow: "hidden",
                                                                textOverflow: "ellipsis",
                                                            }, title: opt.name ?? opt.id, children: opt.name ?? opt.id }), inactive && (_jsx("span", { style: { fontSize: 9, color: "#64748b", flexShrink: 0, marginLeft: 4 }, children: "(Inactive)" }))] }, optIdx));
                                            }) })) : (_jsx("div", { style: { color: "#64748b", fontSize: 11, fontStyle: "italic" }, children: "0 options configured" }))] }), _jsx("div", { style: {
                                        padding: "8px 12px",
                                        background: "rgba(255,255,255,0.02)",
                                        borderTop: "1px solid rgba(255,255,255,0.05)",
                                        fontSize: 11,
                                        color: "#94a3b8",
                                    }, children: col.summary })] }, col.title))) }), dryRunReports.length > 0 && (_jsxs("div", { style: {
                            borderRadius: 6,
                            border: "1px solid rgba(255,255,255,0.08)",
                            background: "rgba(255,255,255,0.015)",
                            overflow: "hidden",
                        }, children: [_jsxs("button", { type: "button", onClick: () => setShowAuditTrail((prev) => !prev), style: {
                                    width: "100%",
                                    padding: "12px 14px",
                                    background: "transparent",
                                    border: "none",
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    cursor: "pointer",
                                    textAlign: "left",
                                }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("span", { style: { color: "#f1f5f9", fontSize: 13, fontWeight: 600 }, children: "Pre-Flight Delta Audit Trail" }), _jsx("span", { style: {
                                                    fontSize: 11,
                                                    color: pendingUpdatesCount > 0 ? "#cbd5e1" : "#64748b",
                                                    background: "rgba(255,255,255,0.04)",
                                                    border: "1px solid rgba(255,255,255,0.08)",
                                                    padding: "1px 6px",
                                                    borderRadius: 3,
                                                }, children: pendingUpdatesCount > 0 ? `${pendingUpdatesCount} Pending` : "All Match" })] }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6, color: "#94a3b8", fontSize: 12 }, children: [_jsx("span", { children: showAuditTrail ? "Hide Details" : "Show Details" }), _jsx("span", { style: { fontSize: 10 }, children: showAuditTrail ? "▲" : "▼" })] })] }), showAuditTrail && (_jsx("div", { style: {
                                    padding: "0 14px 14px 14px",
                                    display: "grid",
                                    gap: 8,
                                    borderTop: "1px solid rgba(255,255,255,0.05)",
                                    paddingTop: 12,
                                }, children: dryRunReports.map((report) => (_jsxs("div", { style: {
                                        borderRadius: 4,
                                        background: "rgba(255,255,255,0.02)",
                                        border: "1px solid rgba(255,255,255,0.04)",
                                        padding: 10,
                                    }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }, children: [_jsx("span", { style: { color: "#f1f5f9", fontWeight: 500, fontSize: 13 }, children: report.fieldName }), _jsx("span", { style: { fontSize: 12, color: "#94a3b8" }, children: report.summary })] }), _jsx("div", { style: { display: "grid", gap: 4 }, children: report.audits.map((item, idx) => (_jsxs("div", { style: {
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    alignItems: "center",
                                                    fontSize: 12,
                                                    padding: "4px 8px",
                                                    borderRadius: 3,
                                                    background: "rgba(255,255,255,0.015)",
                                                }, children: [_jsx("span", { style: { color: "#cbd5e1" }, children: item.candidate }), _jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center" }, children: [_jsx("span", { style: { fontSize: 11, color: "#64748b" }, children: item.detail }), _jsx("span", { style: {
                                                                    fontSize: 10,
                                                                    fontWeight: 500,
                                                                    padding: "1px 6px",
                                                                    borderRadius: 3,
                                                                    color: item.status === "EXISTS" ? "#94a3b8" : "#f1f5f9",
                                                                    background: "rgba(255,255,255,0.04)",
                                                                    border: "1px solid rgba(255,255,255,0.08)",
                                                                }, children: item.status })] })] }, idx))) })] }, report.fieldKey))) }))] }))] })), activeTab === "configure" && (_jsxs("div", { style: { display: "grid", gap: 14 }, children: [_jsxs("div", { style: {
                            borderRadius: 6,
                            border: "1px solid rgba(255,255,255,0.08)",
                            background: "rgba(255,255,255,0.015)",
                            padding: 16,
                            display: "grid",
                            gap: 14,
                        }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }, children: [_jsx("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: _jsx("span", { style: { color: "#f1f5f9", fontSize: 15, fontWeight: 600 }, children: "RO Internal Payment Methods Studio" }) }), _jsxs("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: [_jsx("button", { type: "button", className: "btn-secondary btn-xs", onClick: () => void handleSyncAll(), title: "Re-read from Blueprint and re-audit", children: "Reset to Blueprint" }), _jsx("button", { type: "button", className: "btn-secondary btn-xs", onClick: () => {
                                                    setInternalChips([]);
                                                    void runDryRunAudit(costCenterFields, []);
                                                }, title: "Clears all custom chips", children: "Clear All" })] })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsxs("div", { style: { flex: 1, minWidth: 260, display: "flex", gap: 6 }, children: [_jsx("input", { type: "text", placeholder: "Type payment method and press Enter...", value: customChipInput, onChange: (e) => setCustomChipInput(e.target.value), onKeyDown: (e) => {
                                                    if (e.key === "Enter") {
                                                        e.preventDefault();
                                                        addChip(customChipInput);
                                                    }
                                                }, style: {
                                                    flex: 1,
                                                    padding: "8px 12px",
                                                    borderRadius: 4,
                                                    border: "1px solid rgba(255,255,255,0.12)",
                                                    background: "rgba(255,255,255,0.03)",
                                                    color: "#f1f5f9",
                                                    fontSize: 13,
                                                    outline: "none",
                                                } }), _jsx("button", { type: "button", className: "btn-secondary btn-sm", onClick: () => addChip(customChipInput), disabled: !customChipInput.trim(), children: "Add" })] }), _jsx("div", { style: { width: 220 }, children: _jsx("input", { type: "text", placeholder: "Filter active methods...", value: chipSearch, onChange: (e) => setChipSearch(e.target.value), style: {
                                                width: "100%",
                                                padding: "8px 12px",
                                                borderRadius: 4,
                                                border: "1px solid rgba(255,255,255,0.08)",
                                                background: "rgba(255,255,255,0.02)",
                                                color: "#f1f5f9",
                                                fontSize: 12,
                                                outline: "none",
                                                boxSizing: "border-box",
                                            } }) })] }), _jsxs("div", { style: {
                                    padding: 12,
                                    borderRadius: 4,
                                    background: "rgba(0,0,0,0.2)",
                                    border: "1px solid rgba(255,255,255,0.05)",
                                    minHeight: 60,
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: 6,
                                    alignItems: "center",
                                }, children: [_jsx("span", { style: {
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 6,
                                            padding: "4px 10px",
                                            borderRadius: 3,
                                            background: "rgba(255,255,255,0.05)",
                                            border: "1px solid rgba(255,255,255,0.12)",
                                            color: "#f1f5f9",
                                            fontSize: 12,
                                            userSelect: "none",
                                        }, children: "Vehicle Inventory -INVV (Default)" }), filteredChips.map((chip) => (_jsxs("span", { style: {
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 6,
                                            padding: "4px 10px",
                                            borderRadius: 3,
                                            background: "rgba(255,255,255,0.03)",
                                            border: "1px solid rgba(255,255,255,0.08)",
                                            color: "#cbd5e1",
                                            fontSize: 12,
                                        }, children: [_jsx("span", { children: chip }), _jsx("button", { type: "button", onClick: () => removeChip(chip), style: {
                                                    background: "none",
                                                    border: "none",
                                                    color: "#64748b",
                                                    cursor: "pointer",
                                                    padding: 0,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    fontSize: 11,
                                                }, title: `Remove ${chip}`, children: "\u2715" })] }, chip))), internalChips.length === 0 && (_jsxs("span", { style: { color: "#64748b", fontSize: 12 }, children: ["No extra methods imported. Only ", _jsx("b", { children: "Vehicle Inventory -INVV" }), " will be enforced."] }))] })] }), _jsxs("div", { style: {
                            padding: 12,
                            borderRadius: 6,
                            border: "1px solid rgba(255,255,255,0.08)",
                            background: "rgba(255,255,255,0.015)",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: 12,
                        }, children: [_jsx("span", { style: { color: "#f1f5f9", fontWeight: 500, fontSize: 13 }, children: "Deploy Execution" }), _jsxs("div", { style: { display: "flex", gap: 8 }, children: [_jsx("button", { type: "button", className: "btn-secondary btn-sm", onClick: () => {
                                            setActiveTab("audit");
                                            void runDryRunAudit();
                                        }, disabled: loading || !dealerId, children: "Run Dry Run First" }), _jsx("button", { type: "button", className: "btn-primary", onClick: () => void handleApply(), disabled: loading || !dealerId, children: loading ? "Deploying..." : "Confirm & Deploy to Tekion" })] })] }), configureResults.length > 0 && (_jsxs("div", { style: {
                            borderRadius: 6,
                            border: "1px solid rgba(255,255,255,0.08)",
                            background: "rgba(255,255,255,0.015)",
                            padding: 14,
                        }, children: [_jsx("div", { style: { color: "#f1f5f9", fontSize: 14, fontWeight: 600, marginBottom: 10 }, children: "Deployment Results" }), _jsx("div", { style: { overflowX: "auto" }, children: _jsxs("table", { className: "bx-table", style: { width: "100%", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { style: { textAlign: "left", padding: "8px 10px", color: "#64748b", fontSize: 12 }, children: "Field" }), _jsx("th", { style: { textAlign: "left", padding: "8px 10px", color: "#64748b", fontSize: 12 }, children: "Key" }), _jsx("th", { style: { textAlign: "left", padding: "8px 10px", color: "#64748b", fontSize: 12 }, children: "Status" }), _jsx("th", { style: { textAlign: "left", padding: "8px 10px", color: "#64748b", fontSize: 12 }, children: "Message" })] }) }), _jsx("tbody", { children: configureResults.map((res, i) => (_jsxs("tr", { style: { borderBottom: "1px solid rgba(255,255,255,0.04)" }, children: [_jsx("td", { style: { padding: "8px 10px", color: "#f1f5f9", fontWeight: 500 }, children: res.field }), _jsx("td", { style: { padding: "8px 10px" }, children: _jsx("code", { style: { fontSize: 11, color: "#94a3b8" }, children: res.key }) }), _jsx("td", { style: { padding: "8px 10px" }, children: _jsx("span", { style: {
                                                                fontSize: 11,
                                                                fontWeight: 500,
                                                                padding: "2px 6px",
                                                                borderRadius: 3,
                                                                color: "#f1f5f9",
                                                                background: "rgba(255,255,255,0.05)",
                                                                border: "1px solid rgba(255,255,255,0.08)",
                                                            }, children: res.status.toUpperCase() }) }), _jsx("td", { style: { padding: "8px 10px", color: "#94a3b8", fontSize: 13 }, children: res.message })] }, i))) })] }) })] })), _jsx("div", { style: { display: "flex", justifyContent: "flex-end" }, children: rawBootstrapResponse && (_jsx("button", { type: "button", className: "btn-secondary btn-xs", onClick: () => setShowRawBootstrap((v) => !v), children: showRawBootstrap ? "Hide Raw Bootstrap JSON" : "Show Raw Bootstrap JSON" })) }), showRawBootstrap && rawBootstrapResponse ? (_jsx("pre", { style: {
                            margin: 0,
                            padding: 12,
                            borderRadius: 4,
                            background: "#0f172a",
                            maxHeight: 280,
                            overflow: "auto",
                            fontFamily: "monospace",
                            fontSize: 11,
                            color: "#94a3b8",
                            border: "1px solid rgba(255,255,255,0.06)",
                        }, children: JSON.stringify(rawBootstrapResponse, null, 2) })) : null] }))] }));
};
export default SetupFieldsView;
