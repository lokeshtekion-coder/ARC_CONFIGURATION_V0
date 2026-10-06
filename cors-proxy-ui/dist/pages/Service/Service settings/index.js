import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../../services/tekionApiSettings";
const ACCOUNTING_BOOTSTRAP_URL = "https://preprodapp.tekioncloud.com/api/accounting/u/configurable/bootstrap";
const SERVICE_SETTINGS_URL = "https://preprodapp.tekioncloud.com/api/service-module/u/settings/service-settings";
const logger = {
    debug: (...args) => console.debug("[ServiceSettings]", ...args),
    info: (...args) => console.info("[ServiceSettings]", ...args),
    warn: (...args) => console.warn("[ServiceSettings]", ...args),
    error: (...args) => console.error("[ServiceSettings]", ...args),
};
function normalize(value) {
    return String(value ?? "").trim();
}
function normalizeUpper(value) {
    return normalize(value).toUpperCase();
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
function generateFlagId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 10);
    return `${timestamp}${random}`;
}
function centsFromDollarsInput(value) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return 0;
    return Math.round(n * 100);
}
function formatCurrencyFromCents(value) {
    const cents = Number(value);
    if (!Number.isFinite(cents))
        return "—";
    return `$${(cents / 100).toFixed(2)}`;
}
function getStatusTone(ok) {
    return {
        color: ok ? "#bbf7d0" : "#fecaca",
        background: ok ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
        border: ok
            ? "1px solid rgba(34,197,94,0.22)"
            : "1px solid rgba(239,68,68,0.22)",
        borderRadius: 12,
        padding: "10px 12px",
        fontSize: 13,
    };
}
function extractWarrantyBootstrapInfo(payload) {
    const response = payload;
    const customField = response?.data?.customField ??
        response?.customField ??
        null;
    if (!customField) {
        throw new Error("customField block not found in bootstrap response.");
    }
    const masterAssetDocMap = customField?.masterAssetDocMap ?? {};
    const allFields = Object.values(masterAssetDocMap);
    const warrantyField = allFields.find((field) => {
        const name = normalizeUpper(field.name);
        const label = normalizeUpper(field.label);
        const key = normalizeUpper(field.key);
        return (key === "REPAIR_ORDER_WARRANTY" ||
            name.includes("WARRANTY") ||
            label.includes("WARRANTY") ||
            name.includes("REPAIR ORDER WARRANTY"));
    }) ?? null;
    if (!warrantyField) {
        throw new Error("Warranty field not found in bootstrap customField metadata.");
    }
    const warrantyOption = (warrantyField.options ?? []).find((opt) => normalizeUpper(opt.name).includes("WARRANTY RECEIVABLE")) ?? null;
    if (!warrantyOption?.id) {
        throw new Error('Option "Warranty Receivable" not found in warranty field options.');
    }
    return {
        warrantyFieldId: normalize(warrantyField.id),
        warrantyFieldKey: normalize(warrantyField.key),
        warrantyFieldName: normalize(warrantyField.name || warrantyField.label),
        warrantyOptionId: normalize(warrantyOption.id),
        warrantyOptionName: normalize(warrantyOption.name),
        totalCustomFields: allFields.length,
    };
}
function evaluateValidationSnapshot(params) {
    const { currentSettingsData, warrantyCostCenterId, targetWarrantyLaborRateInCents, targetInternalLaborRateInCents, targetCustomerPayLaborRateInCents, enableNoFlag, enableQuotesFlag, customerConcernEditable, updateFlagHoursOn, } = params;
    const roSetting = currentSettingsData?.roSetting ?? {};
    const quoteSetting = currentSettingsData?.quoteSetting ?? {};
    const warrantyCostCenters = Array.isArray(roSetting.warrantyCostCenters)
        ? roSetting.warrantyCostCenters
        : [];
    const roFlagsList = Array.isArray(roSetting.roFlagsList) ? roSetting.roFlagsList : [];
    const quoteFlagsList = Array.isArray(quoteSetting.quoteFlagsList)
        ? quoteSetting.quoteFlagsList
        : [];
    const hasCorrectWarrantyCostCenter = warrantyCostCenters.some((cc) => normalize(cc.costCenter) === warrantyCostCenterId &&
        Number(cc.value) === 100);
    const hasNoFlag = roFlagsList.some((flag) => normalizeUpper(flag.description) === "NO FLAG");
    const hasQuotesFlag = quoteFlagsList.some((flag) => normalizeUpper(flag.description) === "QUOTES");
    const currentWarrantyLaborRateInCents = typeof roSetting.warrantyLaborRateInCents === "number"
        ? roSetting.warrantyLaborRateInCents
        : null;
    const currentInternalLaborRateInCents = typeof roSetting.internalLaborRateInCents === "number"
        ? roSetting.internalLaborRateInCents
        : null;
    const currentCustomerPayLaborRateInCents = typeof roSetting.customerPayLaborRateInCents === "number"
        ? roSetting.customerPayLaborRateInCents
        : null;
    const currentCustomerConcernEditable = typeof roSetting.jobClockPunchTimeSetting?.customerConcernEditable === "boolean"
        ? roSetting.jobClockPunchTimeSetting.customerConcernEditable
        : null;
    const currentUpdateFlagHoursOn = normalize(roSetting.updateFlagHoursOn);
    const needsUpdate = !hasCorrectWarrantyCostCenter ||
        currentWarrantyLaborRateInCents !== targetWarrantyLaborRateInCents ||
        currentInternalLaborRateInCents !== targetInternalLaborRateInCents ||
        currentCustomerPayLaborRateInCents !== targetCustomerPayLaborRateInCents ||
        (enableNoFlag && !hasNoFlag) ||
        (enableQuotesFlag && !hasQuotesFlag) ||
        currentCustomerConcernEditable !== customerConcernEditable ||
        currentUpdateFlagHoursOn !== updateFlagHoursOn;
    return {
        hasCorrectWarrantyCostCenter,
        hasNoFlag,
        hasQuotesFlag,
        currentWarrantyLaborRateInCents,
        currentInternalLaborRateInCents,
        currentCustomerPayLaborRateInCents,
        currentCustomerConcernEditable,
        currentUpdateFlagHoursOn,
        needsUpdate,
    };
}
const badgeStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#cbd5e1",
    fontSize: 12,
    whiteSpace: "nowrap",
};
const cardStyle = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    padding: 16,
    minWidth: 0,
};
const monoStyle = {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    color: "#e2e8f0",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
};
function scrollWrapStyle(maxHeight) {
    return {
        maxHeight,
        overflowY: "auto",
        overflowX: "auto",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.06)",
    };
}
const ServiceSettingsView = () => {
    const [headerMap, setHeaderMap] = useState({});
    const [activeView, setActiveView] = useState("home");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);
    const [warrantyLaborRate, setWarrantyLaborRate] = useState("186.40");
    const [internalLaborRate, setInternalLaborRate] = useState("190.00");
    const [customerPayLaborRate, setCustomerPayLaborRate] = useState("190.00");
    const [enableNoFlag, setEnableNoFlag] = useState(true);
    const [enableQuotesFlag, setEnableQuotesFlag] = useState(true);
    const [customerConcernEditable, setCustomerConcernEditable] = useState(true);
    const [updateFlagHoursOn, setUpdateFlagHoursOn] = useState("JOB_COMPLETE");
    const [currentSettingsRaw, setCurrentSettingsRaw] = useState(null);
    const [currentSettingsData, setCurrentSettingsData] = useState(null);
    const [bootstrapRaw, setBootstrapRaw] = useState(null);
    const [warrantyBootstrapInfo, setWarrantyBootstrapInfo] = useState(null);
    const [showRawCurrent, setShowRawCurrent] = useState(false);
    const [showRawBootstrap, setShowRawBootstrap] = useState(false);
    const [executionLogs, setExecutionLogs] = useState([]);
    const dealerId = useMemo(() => extractDealerIdFromHeaders(headerMap), [headerMap]);
    const headerCount = useMemo(() => Object.keys(headerMap).length, [headerMap]);
    const targetWarrantyLaborRateInCents = useMemo(() => centsFromDollarsInput(warrantyLaborRate), [warrantyLaborRate]);
    const targetInternalLaborRateInCents = useMemo(() => centsFromDollarsInput(internalLaborRate), [internalLaborRate]);
    const targetCustomerPayLaborRateInCents = useMemo(() => centsFromDollarsInput(customerPayLaborRate), [customerPayLaborRate]);
    const appendLog = useCallback((level, text, meta) => {
        const time = new Date().toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
        const entry = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            time,
            level,
            message: text,
            meta,
        };
        setExecutionLogs((prev) => [entry, ...prev].slice(0, 200));
        if (level === "error")
            logger.error(text, meta);
        else if (level === "warn")
            logger.warn(text, meta);
        else if (level === "debug")
            logger.debug(text, meta);
        else if (level === "success")
            logger.info(`SUCCESS: ${text}`, meta);
        else
            logger.info(text, meta);
    }, []);
    const clearLogs = useCallback(() => {
        setExecutionLogs([]);
    }, []);
    const refreshHeaders = useCallback(() => {
        try {
            const loaded = toEnabledHeaderMap(loadGlobalHeaders());
            setHeaderMap(loaded);
            appendLog("info", "Global headers refreshed", {
                headerCount: Object.keys(loaded).length,
                dealerId: extractDealerIdFromHeaders(loaded),
                headerKeys: Object.keys(loaded),
            });
        }
        catch (e) {
            appendLog("error", "Failed to refresh global headers", e);
            setHeaderMap({});
        }
    }, [appendLog]);
    useEffect(() => {
        appendLog("info", "Service Settings view mounted");
        refreshHeaders();
    }, [appendLog, refreshHeaders]);
    const validationSnapshot = useMemo(() => {
        if (!currentSettingsData || !warrantyBootstrapInfo?.warrantyOptionId)
            return null;
        return evaluateValidationSnapshot({
            currentSettingsData,
            warrantyCostCenterId: warrantyBootstrapInfo.warrantyOptionId,
            targetWarrantyLaborRateInCents,
            targetInternalLaborRateInCents,
            targetCustomerPayLaborRateInCents,
            enableNoFlag,
            enableQuotesFlag,
            customerConcernEditable,
            updateFlagHoursOn,
        });
    }, [
        currentSettingsData,
        warrantyBootstrapInfo,
        targetWarrantyLaborRateInCents,
        targetInternalLaborRateInCents,
        targetCustomerPayLaborRateInCents,
        enableNoFlag,
        enableQuotesFlag,
        customerConcernEditable,
        updateFlagHoursOn,
    ]);
    const proxyRequest = useCallback(async (payload) => {
        appendLog("info", "Proxy request started", {
            method: payload.method,
            url: payload.url,
            dealerId,
            headerCount,
        });
        const res = await fetch("http://localhost:4000/api/proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url: payload.url,
                method: payload.method,
                headers: {
                    ...headerMap,
                    ...(payload.body ? { "content-type": "application/json" } : {}),
                },
                body: payload.body,
                timeout: 60000,
            }),
        });
        if (!res.ok) {
            appendLog("error", "Proxy HTTP failure", {
                status: res.status,
                url: payload.url,
            });
            throw new Error(`Proxy request failed with HTTP ${res.status}`);
        }
        const json = await res.json();
        appendLog("info", "Proxy response received", {
            url: payload.url,
            status: json?.status,
            statusText: json?.statusText,
        });
        if ((json?.status ?? 200) >= 400) {
            appendLog("error", "Proxy logical failure", {
                url: payload.url,
                status: json?.status,
                statusText: json?.statusText,
            });
            throw new Error(`${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim());
        }
        return json?.body ?? json?.data ?? json;
    }, [appendLog, dealerId, headerCount, headerMap]);
    const loadCurrentData = useCallback(async () => {
        if (!dealerId) {
            throw new Error("Dealer ID not found in Global Headers.");
        }
        appendLog("info", "Step 1: Fetching bootstrap customField data for warranty cost center");
        const bootstrapPayload = {
            requestInfo: [
                {
                    assetType: "customField",
                    dealerMetaDataInfo: [{ dealerId }],
                },
            ],
        };
        const bootstrapResponse = await proxyRequest({
            url: ACCOUNTING_BOOTSTRAP_URL,
            method: "POST",
            body: bootstrapPayload,
        });
        setBootstrapRaw(bootstrapResponse);
        const bootstrapInfo = extractWarrantyBootstrapInfo(bootstrapResponse);
        setWarrantyBootstrapInfo(bootstrapInfo);
        appendLog("success", "Warranty field resolved from bootstrap", bootstrapInfo);
        appendLog("info", "Step 2: Fetching current service settings");
        const settingsResponse = await proxyRequest({
            url: SERVICE_SETTINGS_URL,
            method: "GET",
        });
        const settingsData = (settingsResponse?.data ?? settingsResponse);
        setCurrentSettingsRaw(settingsResponse);
        setCurrentSettingsData(settingsData);
        appendLog("success", "Current service settings retrieved", {
            hasRoSetting: Boolean(settingsData?.roSetting),
            hasQuoteSetting: Boolean(settingsData?.quoteSetting),
        });
        return {
            bootstrapInfo,
            settingsData,
            bootstrapResponse,
            settingsResponse,
        };
    }, [appendLog, dealerId, proxyRequest]);
    const handleLoadCurrentSettings = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        clearLogs();
        try {
            appendLog("info", "Load Current Settings started");
            await loadCurrentData();
            setMessage({
                ok: true,
                text: "Current Service Settings loaded successfully.",
            });
        }
        catch (e) {
            appendLog("error", "Load Current Settings failed", e);
            setMessage({
                ok: false,
                text: e instanceof Error ? e.message : "Failed to load current service settings",
            });
        }
        finally {
            setLoading(false);
        }
    }, [appendLog, clearLogs, loadCurrentData]);
    const handleResetDefaults = useCallback(() => {
        setWarrantyLaborRate("186.40");
        setInternalLaborRate("190.00");
        setCustomerPayLaborRate("190.00");
        setEnableNoFlag(true);
        setEnableQuotesFlag(true);
        setCustomerConcernEditable(true);
        setUpdateFlagHoursOn("JOB_COMPLETE");
        appendLog("info", "Form reset to recommended defaults");
    }, [appendLog]);
    const handleConfigure = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        clearLogs();
        try {
            appendLog("info", "Configure All Service Settings started", {
                dealerId,
                warrantyLaborRate,
                internalLaborRate,
                customerPayLaborRate,
                enableNoFlag,
                enableQuotesFlag,
                customerConcernEditable,
                updateFlagHoursOn,
            });
            if (!dealerId) {
                throw new Error("Dealer ID not found in Global Headers.");
            }
            if (targetWarrantyLaborRateInCents <= 0) {
                throw new Error("Warranty Labor Rate must be greater than 0.");
            }
            if (targetInternalLaborRateInCents <= 0) {
                throw new Error("Internal Labor Rate must be greater than 0.");
            }
            if (targetCustomerPayLaborRateInCents <= 0) {
                throw new Error("Customer Pay Labor Rate must be greater than 0.");
            }
            const { bootstrapInfo, settingsData } = await loadCurrentData();
            const snapshot = evaluateValidationSnapshot({
                currentSettingsData: settingsData,
                warrantyCostCenterId: bootstrapInfo.warrantyOptionId,
                targetWarrantyLaborRateInCents,
                targetInternalLaborRateInCents,
                targetCustomerPayLaborRateInCents,
                enableNoFlag,
                enableQuotesFlag,
                customerConcernEditable,
                updateFlagHoursOn,
            });
            appendLog("info", "Validation snapshot computed", snapshot);
            if (!snapshot.needsUpdate) {
                appendLog("warn", "Service settings already configured correctly. No update required.");
                setMessage({
                    ok: true,
                    text: "Service settings are already configured correctly. No update required.",
                });
                return;
            }
            appendLog("info", "Step 3: Building update payload");
            const currentRoSetting = settingsData?.roSetting ?? {};
            const currentQuoteSetting = settingsData?.quoteSetting ?? {};
            let roFlagsList = Array.isArray(currentRoSetting.roFlagsList)
                ? [...currentRoSetting.roFlagsList]
                : [];
            if (enableNoFlag && !snapshot.hasNoFlag) {
                appendLog("info", 'Adding "No Flag" to RO flags');
                roFlagsList = [
                    {
                        id: generateFlagId(),
                        order: 0,
                        colorCode: "#ffffff",
                        description: "No Flag",
                        defaultFlag: false,
                        languages: null,
                    },
                    ...roFlagsList,
                ];
            }
            let quoteFlagsList = Array.isArray(currentQuoteSetting.quoteFlagsList)
                ? [...currentQuoteSetting.quoteFlagsList]
                : [];
            if (enableQuotesFlag && !snapshot.hasQuotesFlag) {
                appendLog("info", 'Adding "Quotes" flag to quote settings');
                quoteFlagsList = [
                    {
                        id: generateFlagId(),
                        order: 0,
                        colorCode: "#18bcdc",
                        description: "Quotes",
                        defaultFlag: false,
                        languages: null,
                    },
                    ...quoteFlagsList,
                ];
            }
            const updatePayload = {
                ...settingsData,
                roSetting: {
                    ...currentRoSetting,
                    warrantyCostCenters: [
                        {
                            costCenter: bootstrapInfo.warrantyOptionId,
                            value: 100,
                        },
                    ],
                    warrantyLaborRateInCents: targetWarrantyLaborRateInCents,
                    internalLaborRateInCents: targetInternalLaborRateInCents,
                    customerPayLaborRateInCents: targetCustomerPayLaborRateInCents,
                    warrantyTaxable: false,
                    roFlagsList,
                    updateFlagHoursOn,
                    jobClockPunchTimeSetting: {
                        ...(currentRoSetting.jobClockPunchTimeSetting ?? {}),
                        customerConcernEditable,
                    },
                },
                quoteSetting: {
                    ...currentQuoteSetting,
                    quoteFlagsList,
                    quoteExpirationTime: currentQuoteSetting.quoteExpirationTime || {
                        unit: "YEARS",
                        timePeriod: 1,
                    },
                },
            };
            appendLog("debug", "Update payload ready", updatePayload);
            appendLog("info", "Step 4: Posting updated service settings");
            await proxyRequest({
                url: SERVICE_SETTINGS_URL,
                method: "POST",
                body: updatePayload,
            });
            appendLog("success", "Service settings updated successfully");
            appendLog("info", "Step 5: Reloading current settings after update");
            await loadCurrentData();
            setMessage({
                ok: true,
                text: "Service settings configured successfully.",
            });
        }
        catch (e) {
            appendLog("error", "Configure All Service Settings failed", e);
            setMessage({
                ok: false,
                text: e instanceof Error ? e.message : "Failed to configure service settings",
            });
        }
        finally {
            setLoading(false);
        }
    }, [
        appendLog,
        clearLogs,
        customerConcernEditable,
        dealerId,
        enableNoFlag,
        enableQuotesFlag,
        internalLaborRate,
        loadCurrentData,
        proxyRequest,
        targetCustomerPayLaborRateInCents,
        targetInternalLaborRateInCents,
        targetWarrantyLaborRateInCents,
        updateFlagHoursOn,
        warrantyLaborRate,
        customerPayLaborRate,
    ]);
    return (_jsxs("div", { style: {
            display: "grid",
            gap: 16,
            maxHeight: "100%",
            overflow: "auto",
        }, className: "service-settings-scroll", children: [_jsx("style", { children: `
        .service-settings-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .service-settings-scroll::-webkit-scrollbar-track { background: transparent; }
        .service-settings-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 8px; }
        .service-settings-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.24); }
      ` }), _jsxs("div", { children: [_jsx("div", { style: { fontSize: 24, fontWeight: 800, color: "#f8fafc", marginBottom: 6 }, children: "\u2699\uFE0F Service Settings" }), _jsx("div", { style: { color: "#94a3b8", fontSize: 14, lineHeight: 1.6 }, children: "Configure warranty cost center, labor rates, RO flags, quote flags, and job settings using Global Headers." })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsxs("span", { style: badgeStyle, children: ["Dealer ID:", " ", _jsx("b", { style: { color: dealerId ? "#86efac" : "#fca5a5" }, children: dealerId || "Not found" })] }), _jsxs("span", { style: badgeStyle, children: ["Global Headers: ", _jsx("b", { style: { color: "#f8fafc" }, children: headerCount })] }), _jsxs("span", { style: badgeStyle, children: ["Module: ", _jsx("b", { style: { color: "#f8fafc" }, children: "service-settings" })] })] }), _jsxs("div", { style: cardStyle, children: [_jsxs("div", { style: {
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: 12,
                            flexWrap: "wrap",
                            marginBottom: 12,
                        }, children: [_jsxs("div", { children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 18, fontWeight: 800, marginBottom: 4 }, children: "Navigation" }), _jsx("div", { style: { color: "#94a3b8", fontSize: 13 }, children: "Open the configure workspace or review the module overview." })] }), _jsx("button", { className: "btn-secondary btn-sm", onClick: refreshHeaders, children: "\u27F3 Refresh Headers" })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { className: activeView === "home" ? "btn-primary" : "btn-secondary btn-sm", onClick: () => setActiveView("home"), children: "Home" }), _jsx("button", { className: activeView === "configure" ? "btn-primary" : "btn-secondary btn-sm", onClick: () => setActiveView("configure"), children: "Configure" })] }), message ? _jsx("div", { style: { ...getStatusTone(message.ok), marginTop: 12 }, children: message.text }) : null] }), activeView === "home" ? (_jsx("div", { style: { display: "grid", gap: 16 }, children: _jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }, children: "What this automation configures" }), _jsxs("div", { style: {
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                                gap: 12,
                            }, children: [_jsxs("div", { style: {
                                        borderRadius: 14,
                                        border: "1px solid rgba(255,255,255,0.06)",
                                        background: "rgba(255,255,255,0.02)",
                                        padding: 14,
                                    }, children: [_jsx("div", { style: { color: "#f8fafc", fontWeight: 800, marginBottom: 6 }, children: "\uD83D\uDCB0 Labor Rates" }), _jsx("div", { style: { color: "#cbd5e1", fontSize: 13, lineHeight: 1.6 }, children: "Warranty, Internal, and Customer Pay labor rates are set in cents." })] }), _jsxs("div", { style: {
                                        borderRadius: 14,
                                        border: "1px solid rgba(255,255,255,0.06)",
                                        background: "rgba(255,255,255,0.02)",
                                        padding: 14,
                                    }, children: [_jsx("div", { style: { color: "#f8fafc", fontWeight: 800, marginBottom: 6 }, children: "\uD83E\uDDFE Warranty Cost Center" }), _jsx("div", { style: { color: "#cbd5e1", fontSize: 13, lineHeight: 1.6 }, children: "Reads Warranty Receivable from bootstrap custom fields and applies it as the warranty cost center." })] }), _jsxs("div", { style: {
                                        borderRadius: 14,
                                        border: "1px solid rgba(255,255,255,0.06)",
                                        background: "rgba(255,255,255,0.02)",
                                        padding: 14,
                                    }, children: [_jsx("div", { style: { color: "#f8fafc", fontWeight: 800, marginBottom: 6 }, children: "\uD83D\uDEA9 Flags" }), _jsx("div", { style: { color: "#cbd5e1", fontSize: 13, lineHeight: 1.6 }, children: "Can add \"No Flag\" for ROs and \"Quotes\" for quote settings if missing." })] }), _jsxs("div", { style: {
                                        borderRadius: 14,
                                        border: "1px solid rgba(255,255,255,0.06)",
                                        background: "rgba(255,255,255,0.02)",
                                        padding: 14,
                                    }, children: [_jsx("div", { style: { color: "#f8fafc", fontWeight: 800, marginBottom: 6 }, children: "\uD83D\uDEE0 Job Settings" }), _jsx("div", { style: { color: "#cbd5e1", fontSize: 13, lineHeight: 1.6 }, children: "Controls customer concern editability and update flag timing." })] })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }, children: [_jsx("button", { className: "btn-primary", onClick: () => setActiveView("configure"), children: "Open Configure Panel" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => void handleLoadCurrentSettings(), disabled: loading || headerCount === 0, children: loading ? "Loading..." : "Load Current Settings" })] })] }) })) : null, activeView === "configure" ? (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsxs("div", { style: cardStyle, children: [_jsxs("div", { style: {
                                    display: "flex",
                                    alignItems: "flex-start",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    flexWrap: "wrap",
                                    marginBottom: 14,
                                }, children: [_jsxs("div", { children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 18, fontWeight: 800, marginBottom: 4 }, children: "Service Settings Configuration" }), _jsx("div", { style: { color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }, children: "Configure labor rates, warranty setup, RO flags, quote flags, and job behavior." })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-secondary btn-sm", onClick: () => void handleLoadCurrentSettings(), disabled: loading || headerCount === 0, children: loading ? "Loading..." : "Load Current Settings" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: handleResetDefaults, disabled: loading, children: "Reset Defaults" }), _jsx("button", { className: "btn-primary", onClick: () => void handleConfigure(), disabled: loading || headerCount === 0, children: loading ? "Configuring..." : "⚙️ Configure All Service Settings" })] })] }), _jsxs("div", { style: {
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                                    gap: 14,
                                }, children: [_jsxs("div", { style: {
                                            borderRadius: 14,
                                            border: "1px solid rgba(255,255,255,0.06)",
                                            background: "rgba(255,255,255,0.018)",
                                            padding: 14,
                                        }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 12 }, children: "\uD83D\uDCB0 Labor Rates Configuration" }), _jsxs("div", { style: { display: "grid", gap: 12 }, children: [_jsxs("div", { children: [_jsx("label", { style: { display: "block", color: "#cbd5e1", fontSize: 13, marginBottom: 6 }, children: "Warranty Labor Rate ($ / hour)" }), _jsx("input", { type: "number", min: "0", step: "0.01", value: warrantyLaborRate, onChange: (e) => setWarrantyLaborRate(e.target.value), style: {
                                                                    width: "100%",
                                                                    padding: "12px 14px",
                                                                    borderRadius: 12,
                                                                    border: "1px solid rgba(255,255,255,0.10)",
                                                                    background: "rgba(255,255,255,0.03)",
                                                                    color: "#f8fafc",
                                                                    outline: "none",
                                                                } })] }), _jsxs("div", { children: [_jsx("label", { style: { display: "block", color: "#cbd5e1", fontSize: 13, marginBottom: 6 }, children: "Internal Labor Rate ($ / hour)" }), _jsx("input", { type: "number", min: "0", step: "0.01", value: internalLaborRate, onChange: (e) => setInternalLaborRate(e.target.value), style: {
                                                                    width: "100%",
                                                                    padding: "12px 14px",
                                                                    borderRadius: 12,
                                                                    border: "1px solid rgba(255,255,255,0.10)",
                                                                    background: "rgba(255,255,255,0.03)",
                                                                    color: "#f8fafc",
                                                                    outline: "none",
                                                                } })] }), _jsxs("div", { children: [_jsx("label", { style: { display: "block", color: "#cbd5e1", fontSize: 13, marginBottom: 6 }, children: "Customer Pay Labor Rate ($ / hour)" }), _jsx("input", { type: "number", min: "0", step: "0.01", value: customerPayLaborRate, onChange: (e) => setCustomerPayLaborRate(e.target.value), style: {
                                                                    width: "100%",
                                                                    padding: "12px 14px",
                                                                    borderRadius: 12,
                                                                    border: "1px solid rgba(255,255,255,0.10)",
                                                                    background: "rgba(255,255,255,0.03)",
                                                                    color: "#f8fafc",
                                                                    outline: "none",
                                                                } })] })] })] }), _jsxs("div", { style: {
                                            borderRadius: 14,
                                            border: "1px solid rgba(255,255,255,0.06)",
                                            background: "rgba(255,255,255,0.018)",
                                            padding: 14,
                                        }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 12 }, children: "\uD83D\uDEA9 RO Flags & Quote Settings" }), _jsxs("div", { style: { display: "grid", gap: 12 }, children: [_jsxs("label", { style: { display: "flex", alignItems: "flex-start", gap: 10, color: "#e2e8f0", fontSize: 13 }, children: [_jsx("input", { type: "checkbox", checked: enableNoFlag, onChange: (e) => setEnableNoFlag(e.target.checked) }), _jsxs("span", { children: [_jsx("b", { children: "Enable \"No Flag\"" }), _jsx("div", { style: { color: "#94a3b8", marginTop: 4 }, children: "White flag for ROs without a specific flag." })] })] }), _jsxs("label", { style: { display: "flex", alignItems: "flex-start", gap: 10, color: "#e2e8f0", fontSize: 13 }, children: [_jsx("input", { type: "checkbox", checked: enableQuotesFlag, onChange: (e) => setEnableQuotesFlag(e.target.checked) }), _jsxs("span", { children: [_jsx("b", { children: "Enable \"Quotes\" Flag" }), _jsx("div", { style: { color: "#94a3b8", marginTop: 4 }, children: "Blue flag for quote documents." })] })] })] })] }), _jsxs("div", { style: {
                                            borderRadius: 14,
                                            border: "1px solid rgba(255,255,255,0.06)",
                                            background: "rgba(255,255,255,0.018)",
                                            padding: 14,
                                        }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 12 }, children: "\uD83D\uDEE0 Job Settings" }), _jsxs("div", { style: { display: "grid", gap: 12 }, children: [_jsxs("label", { style: { display: "flex", alignItems: "flex-start", gap: 10, color: "#e2e8f0", fontSize: 13 }, children: [_jsx("input", { type: "checkbox", checked: customerConcernEditable, onChange: (e) => setCustomerConcernEditable(e.target.checked) }), _jsxs("span", { children: [_jsx("b", { children: "Customer Concern Editable" }), _jsx("div", { style: { color: "#94a3b8", marginTop: 4 }, children: "Allow technicians to edit customer concerns during clock in / out." })] })] }), _jsxs("div", { children: [_jsx("label", { style: { display: "block", color: "#cbd5e1", fontSize: 13, marginBottom: 6 }, children: "Update Flag Hours On" }), _jsxs("select", { value: updateFlagHoursOn, onChange: (e) => setUpdateFlagHoursOn(e.target.value), style: {
                                                                    width: "100%",
                                                                    padding: "12px 14px",
                                                                    borderRadius: 12,
                                                                    border: "1px solid rgba(255,255,255,0.10)",
                                                                    background: "rgba(255,255,255,0.03)",
                                                                    color: "#f8fafc",
                                                                    outline: "none",
                                                                }, children: [_jsx("option", { value: "JOB_COMPLETE", children: "Job Complete" }), _jsx("option", { value: "RO_INVOICED", children: "RO Invoiced" })] })] })] })] })] })] }), warrantyBootstrapInfo ? (_jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }, children: "Bootstrap Warranty Resolution" }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }, children: [_jsxs("span", { style: badgeStyle, children: ["Field: ", _jsx("b", { style: { color: "#f8fafc" }, children: warrantyBootstrapInfo.warrantyFieldName })] }), _jsxs("span", { style: badgeStyle, children: ["Field Key: ", _jsx("b", { style: { color: "#f8fafc" }, children: warrantyBootstrapInfo.warrantyFieldKey })] }), _jsxs("span", { style: badgeStyle, children: ["Warranty Option: ", _jsx("b", { style: { color: "#86efac" }, children: warrantyBootstrapInfo.warrantyOptionName })] }), _jsxs("span", { style: badgeStyle, children: ["Cost Center ID: ", _jsx("b", { style: { color: "#86efac" }, children: warrantyBootstrapInfo.warrantyOptionId })] })] }), bootstrapRaw ? (_jsx("button", { className: "btn-secondary btn-sm", onClick: () => setShowRawBootstrap((v) => !v), children: showRawBootstrap ? "Hide Bootstrap JSON" : "Show Bootstrap JSON" })) : null, showRawBootstrap && bootstrapRaw ? (_jsx("div", { style: { marginTop: 12 }, children: _jsx("div", { className: "service-settings-scroll", style: scrollWrapStyle(320), children: _jsx("pre", { style: { ...monoStyle, margin: 0, padding: 12 }, children: JSON.stringify(bootstrapRaw, null, 2) }) }) })) : null] })) : null, currentSettingsData ? (_jsxs("div", { style: cardStyle, children: [_jsxs("div", { style: {
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    flexWrap: "wrap",
                                    marginBottom: 12,
                                }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800 }, children: "Current Settings Snapshot" }), validationSnapshot ? (_jsx("span", { style: {
                                            display: "inline-flex",
                                            alignItems: "center",
                                            borderRadius: 999,
                                            padding: "4px 10px",
                                            fontSize: 12,
                                            fontWeight: 700,
                                            color: validationSnapshot.needsUpdate ? "#fcd34d" : "#86efac",
                                            background: validationSnapshot.needsUpdate
                                                ? "rgba(245,158,11,0.10)"
                                                : "rgba(34,197,94,0.10)",
                                            border: validationSnapshot.needsUpdate
                                                ? "1px solid rgba(245,158,11,0.22)"
                                                : "1px solid rgba(34,197,94,0.22)",
                                        }, children: validationSnapshot.needsUpdate ? "Update Needed" : "Already Configured" })) : null] }), _jsxs("div", { style: {
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                                    gap: 12,
                                }, children: [_jsxs("div", { style: {
                                            borderRadius: 12,
                                            border: "1px solid rgba(255,255,255,0.06)",
                                            background: "rgba(255,255,255,0.02)",
                                            padding: 12,
                                        }, children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 11, marginBottom: 6 }, children: "Current Warranty Labor Rate" }), _jsx("div", { style: { color: "#f8fafc", fontWeight: 800 }, children: formatCurrencyFromCents(validationSnapshot?.currentWarrantyLaborRateInCents) })] }), _jsxs("div", { style: {
                                            borderRadius: 12,
                                            border: "1px solid rgba(255,255,255,0.06)",
                                            background: "rgba(255,255,255,0.02)",
                                            padding: 12,
                                        }, children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 11, marginBottom: 6 }, children: "Current Internal Labor Rate" }), _jsx("div", { style: { color: "#f8fafc", fontWeight: 800 }, children: formatCurrencyFromCents(validationSnapshot?.currentInternalLaborRateInCents) })] }), _jsxs("div", { style: {
                                            borderRadius: 12,
                                            border: "1px solid rgba(255,255,255,0.06)",
                                            background: "rgba(255,255,255,0.02)",
                                            padding: 12,
                                        }, children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 11, marginBottom: 6 }, children: "Current Customer Pay Labor Rate" }), _jsx("div", { style: { color: "#f8fafc", fontWeight: 800 }, children: formatCurrencyFromCents(validationSnapshot?.currentCustomerPayLaborRateInCents) })] }), _jsxs("div", { style: {
                                            borderRadius: 12,
                                            border: "1px solid rgba(255,255,255,0.06)",
                                            background: "rgba(255,255,255,0.02)",
                                            padding: 12,
                                        }, children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 11, marginBottom: 6 }, children: "Update Flag Hours On" }), _jsx("div", { style: { color: "#f8fafc", fontWeight: 800 }, children: validationSnapshot?.currentUpdateFlagHoursOn || "—" })] })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }, children: [_jsxs("span", { style: badgeStyle, children: ["Warranty Cost Center Match:", " ", _jsx("b", { style: { color: validationSnapshot?.hasCorrectWarrantyCostCenter ? "#86efac" : "#fcd34d" }, children: validationSnapshot?.hasCorrectWarrantyCostCenter ? "YES" : "NO" })] }), _jsxs("span", { style: badgeStyle, children: ["\"No Flag\":", " ", _jsx("b", { style: { color: validationSnapshot?.hasNoFlag ? "#86efac" : "#fcd34d" }, children: validationSnapshot?.hasNoFlag ? "Present" : "Missing" })] }), _jsxs("span", { style: badgeStyle, children: ["\"Quotes\" Flag:", " ", _jsx("b", { style: { color: validationSnapshot?.hasQuotesFlag ? "#86efac" : "#fcd34d" }, children: validationSnapshot?.hasQuotesFlag ? "Present" : "Missing" })] }), _jsxs("span", { style: badgeStyle, children: ["Customer Concern Editable:", " ", _jsx("b", { style: { color: "#f8fafc" }, children: validationSnapshot?.currentCustomerConcernEditable === null
                                                    ? "Unknown"
                                                    : validationSnapshot?.currentCustomerConcernEditable
                                                        ? "Yes"
                                                        : "No" })] })] }), currentSettingsRaw ? (_jsx("div", { style: { marginTop: 12 }, children: _jsx("button", { className: "btn-secondary btn-sm", onClick: () => setShowRawCurrent((v) => !v), children: showRawCurrent ? "Hide Current Settings JSON" : "Show Current Settings JSON" }) })) : null, showRawCurrent && currentSettingsRaw ? (_jsx("div", { style: { marginTop: 12 }, children: _jsx("div", { className: "service-settings-scroll", style: scrollWrapStyle(320), children: _jsx("pre", { style: { ...monoStyle, margin: 0, padding: 12 }, children: JSON.stringify(currentSettingsRaw, null, 2) }) }) })) : null] })) : null, _jsxs("div", { style: cardStyle, children: [_jsxs("div", { style: {
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    flexWrap: "wrap",
                                    marginBottom: 12,
                                }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800 }, children: "Execution Logs" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: clearLogs, children: "Clear Logs" })] }), _jsx("div", { className: "service-settings-scroll", style: scrollWrapStyle(320), children: _jsx("div", { style: { display: "grid", gap: 8, padding: 12 }, children: executionLogs.length > 0 ? (executionLogs.map((log) => (_jsxs("div", { style: {
                                            borderRadius: 12,
                                            border: log.level === "error"
                                                ? "1px solid rgba(239,68,68,0.18)"
                                                : log.level === "warn"
                                                    ? "1px solid rgba(245,158,11,0.18)"
                                                    : log.level === "success"
                                                        ? "1px solid rgba(34,197,94,0.18)"
                                                        : "1px solid rgba(255,255,255,0.06)",
                                            background: log.level === "error"
                                                ? "rgba(239,68,68,0.06)"
                                                : log.level === "warn"
                                                    ? "rgba(245,158,11,0.06)"
                                                    : log.level === "success"
                                                        ? "rgba(34,197,94,0.06)"
                                                        : "rgba(255,255,255,0.02)",
                                            padding: 10,
                                        }, children: [_jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }, children: [_jsx("span", { style: { color: "#94a3b8", fontSize: 11 }, children: log.time }), _jsx("span", { style: {
                                                            color: log.level === "error"
                                                                ? "#fca5a5"
                                                                : log.level === "warn"
                                                                    ? "#fcd34d"
                                                                    : log.level === "success"
                                                                        ? "#86efac"
                                                                        : "#93c5fd",
                                                            fontSize: 11,
                                                            fontWeight: 800,
                                                            textTransform: "uppercase",
                                                        }, children: log.level })] }), _jsx("div", { style: { color: "#e2e8f0", fontSize: 13 }, children: log.message }), log.meta !== undefined ? (_jsxs("details", { style: { marginTop: 8 }, children: [_jsx("summary", { style: { cursor: "pointer", color: "#93c5fd", fontSize: 12 }, children: "View meta" }), _jsx("pre", { style: {
                                                            ...monoStyle,
                                                            margin: "8px 0 0",
                                                            padding: 10,
                                                            borderRadius: 10,
                                                            background: "#0f172a",
                                                            overflow: "auto",
                                                        }, children: JSON.stringify(log.meta, null, 2) })] })) : null] }, log.id)))) : (_jsx("div", { style: { color: "#94a3b8", fontSize: 13 }, children: "No logs yet. Run \"Load Current Settings\" or \"Configure All Service Settings\"." })) }) })] })] })) : null] }));
};
export default ServiceSettingsView;
