import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { loadTekionApiSettingsBundle, getSelectedDealerProfileId, } from "../../../services/tekionApiSettings";
import { loadLatestExtensionCapture, requestLatestCaptureFromExtension, subscribeToExtensionCapture, } from "../../../services/extensionBridge";
const TENANTS_URL = "https://app.tekioncloud.com/api/tekapproval/u/dealer-tenant/tenants";
const DEALERS_URL = "https://app.tekioncloud.com/api/tekapproval/u/dealer-tenant/tenants/dealers";
const APPROVAL_URL = "https://app.tekioncloud.com/api/tekapproval/u/v1/approvalRequest/";
const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";
const TEMPLATE_ID = "9392abe9-2ded-42cc-88b5-f84343078ff8";
const logger = {
    info: (...args) => console.info("[Parts][RaiseOemIdRequestView]", ...args),
    warn: (...args) => console.warn("[Parts][RaiseOemIdRequestView]", ...args),
    error: (...args) => console.error("[Parts][RaiseOemIdRequestView]", ...args),
    debug: (...args) => console.debug("[Parts][RaiseOemIdRequestView]", ...args),
    group: (label, ...args) => console.group(`[Parts][RaiseOemIdRequestView] ${label}`, ...args),
    groupEnd: () => console.groupEnd(),
};
function normalize(value) {
    return String(value ?? "").trim();
}
function getEnabledGlobalHeaders() {
    const bundle = loadTekionApiSettingsBundle();
    return (bundle.globalHeaders ?? [])
        .filter((header) => header.enabled && normalize(header.key) && normalize(header.value))
        .reduce((acc, header) => {
        acc[String(header.key).toLowerCase()] = String(header.value);
        return acc;
    }, {});
}
function getProdTechMotorsHeaders() {
    const capture = loadLatestExtensionCapture();
    const raw = capture?.tekionProdTechMotorsHeaders ?? {};
    const normalizedHeaders = {};
    Object.entries(raw).forEach(([key, value]) => {
        normalizedHeaders[key.toLowerCase()] = value;
    });
    return normalizedHeaders;
}
function buildHeadersForProdTechMotors() {
    const captured = getProdTechMotorsHeaders();
    if (Object.keys(captured).length > 0) {
        return {
            headers: { ...captured, "content-type": "application/json" },
            source: "captured-prodtechmotors",
        };
    }
    const global = getEnabledGlobalHeaders();
    return {
        headers: { ...global, "content-type": "application/json" },
        source: "global",
    };
}
function loadSelectedDealerProfileFromCapture() {
    const selectedProfileId = getSelectedDealerProfileId() ||
        localStorage.getItem(SELECTED_DEALER_PROFILE_KEY) ||
        "";
    if (!selectedProfileId)
        return null;
    const capture = loadLatestExtensionCapture();
    return capture?.tekionProfiles?.find((item) => item.id === selectedProfileId) ?? null;
}
async function proxyPost(url, body, headers) {
    logger.group("proxyPost");
    logger.debug("target url", url);
    logger.debug("request body", body);
    logger.debug("request header keys", Object.keys(headers).sort());
    const response = await fetch("http://localhost:4000/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            url,
            method: "POST",
            headers,
            body,
            timeout: 60000,
        }),
    });
    logger.debug("proxy http status", response.status);
    if (!response.ok) {
        logger.groupEnd();
        throw new Error(`Proxy request failed with HTTP ${response.status}`);
    }
    const json = await response.json();
    logger.debug("proxy json response", json);
    if ((json?.status ?? 200) >= 400) {
        logger.groupEnd();
        throw new Error(`${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim());
    }
    logger.groupEnd();
    return json?.body ?? json?.data ?? json;
}
function buildApprovalBodyFormat(oemCodes) {
    return `{\n    "oemDealerCodes": [\n${oemCodes
        .map((code) => `        "${code}"`)
        .join(",\n")}\n    ]\n}`;
}
function getValidationReason(preferredValue, state, kind) {
    if (!preferredValue) {
        return `No selected profile ${kind} found yet.`;
    }
    if (state === "loading") {
        return `Validating ${kind} from API response...`;
    }
    if (state === "matched") {
        return `${kind} validated successfully against API response.`;
    }
    if (state === "not-found") {
        return `${kind} value from selected profile was not found in API response.`;
    }
    return `${kind === "tenant" ? "Waiting to call tenants API." : "Waiting to call dealers API."}`;
}
export const RaiseOemIdRequestView = () => {
    const [runState, setRunState] = useState("idle");
    const [statusText, setStatusText] = useState("Ready");
    const [errorText, setErrorText] = useState("");
    const [tenants, setTenants] = useState([]);
    const [dealers, setDealers] = useState([]);
    const [selectedTenantId, setSelectedTenantId] = useState("");
    const [selectedDealerId, setSelectedDealerId] = useState("");
    const [oemDealerCodesInput, setOemDealerCodesInput] = useState("");
    const [isLoadingTenants, setIsLoadingTenants] = useState(false);
    const [isLoadingDealers, setIsLoadingDealers] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isAutoResolving, setIsAutoResolving] = useState(false);
    const [tenantValidationState, setTenantValidationState] = useState("idle");
    const [dealerValidationState, setDealerValidationState] = useState("idle");
    const [lastApprovalPayload, setLastApprovalPayload] = useState(null);
    const [showPayloadPreview, setShowPayloadPreview] = useState(false);
    const [captureVersion, setCaptureVersion] = useState(0);
    const [autoSelectionMessage, setAutoSelectionMessage] = useState("");
    useEffect(() => {
        logger.info("mounted");
        requestLatestCaptureFromExtension();
        const unsubscribe = subscribeToExtensionCapture((result) => {
            logger.info("extension capture updated", result.capture);
            setCaptureVersion((prev) => prev + 1);
        });
        const handleFocus = () => {
            logger.info("window focus -> refreshing extension capture snapshot");
            setCaptureVersion((prev) => prev + 1);
            requestLatestCaptureFromExtension();
        };
        window.addEventListener("focus", handleFocus);
        return () => {
            logger.info("unmounted");
            unsubscribe();
            window.removeEventListener("focus", handleFocus);
        };
    }, []);
    const headerInfo = useMemo(() => {
        const { headers, source } = buildHeadersForProdTechMotors();
        logger.group("headerInfo recomputed");
        logger.debug("source", source);
        logger.debug("header count", Object.keys(headers).length);
        logger.debug("header keys", Object.keys(headers).sort());
        logger.groupEnd();
        return {
            headers,
            source,
            headerCount: Object.keys(headers).length,
        };
    }, [captureVersion]);
    const selectedDealerProfile = useMemo(() => {
        const profile = loadSelectedDealerProfileFromCapture();
        logger.group("selectedDealerProfile recomputed");
        logger.debug("selected profile id", getSelectedDealerProfileId());
        logger.debug("profile", profile);
        logger.groupEnd();
        return profile;
    }, [captureVersion]);
    const preferredTenantId = useMemo(() => normalize(selectedDealerProfile?.tenantName), [selectedDealerProfile]);
    const preferredDealerId = useMemo(() => normalize(selectedDealerProfile?.dealerId), [selectedDealerProfile]);
    const parsedOemDealerCodes = useMemo(() => {
        const parsed = oemDealerCodesInput
            .split(/[\n,]/)
            .map((item) => normalize(item))
            .filter(Boolean);
        logger.debug("parsed OEM dealer codes", parsed);
        return parsed;
    }, [oemDealerCodesInput]);
    const tenantAutoMatch = useMemo(() => {
        if (!preferredTenantId || tenants.length === 0)
            return null;
        return tenants.find((tenant) => normalize(tenant.tenantId) === preferredTenantId) ?? null;
    }, [preferredTenantId, tenants]);
    const dealerAutoMatch = useMemo(() => {
        if (!preferredDealerId || dealers.length === 0)
            return null;
        return dealers.find((dealer) => normalize(dealer.dealerId) === preferredDealerId) ?? null;
    }, [preferredDealerId, dealers]);
    const resolvedTenantId = useMemo(() => {
        if (normalize(selectedTenantId))
            return normalize(selectedTenantId);
        if (tenantAutoMatch?.tenantId)
            return normalize(tenantAutoMatch.tenantId);
        return "";
    }, [selectedTenantId, tenantAutoMatch]);
    const resolvedDealerId = useMemo(() => {
        if (normalize(selectedDealerId))
            return normalize(selectedDealerId);
        if (dealerAutoMatch?.dealerId)
            return normalize(dealerAutoMatch.dealerId);
        return "";
    }, [selectedDealerId, dealerAutoMatch]);
    const canPreviewPayload = useMemo(() => {
        return Boolean(resolvedTenantId &&
            resolvedDealerId &&
            parsedOemDealerCodes.length > 0);
    }, [resolvedTenantId, resolvedDealerId, parsedOemDealerCodes.length]);
    useEffect(() => {
        logger.group("validation snapshot");
        logger.debug("preferredTenantId", preferredTenantId);
        logger.debug("preferredDealerId", preferredDealerId);
        logger.debug("selectedTenantId", selectedTenantId);
        logger.debug("selectedDealerId", selectedDealerId);
        logger.debug("resolvedTenantId", resolvedTenantId);
        logger.debug("resolvedDealerId", resolvedDealerId);
        logger.debug("tenants loaded", tenants.length);
        logger.debug("dealers loaded", dealers.length);
        logger.debug("tenantValidationState", tenantValidationState);
        logger.debug("dealerValidationState", dealerValidationState);
        logger.debug("canPreviewPayload", canPreviewPayload);
        logger.groupEnd();
    }, [
        preferredTenantId,
        preferredDealerId,
        selectedTenantId,
        selectedDealerId,
        resolvedTenantId,
        resolvedDealerId,
        tenants.length,
        dealers.length,
        tenantValidationState,
        dealerValidationState,
        canPreviewPayload,
    ]);
    const loadTenants = async () => {
        logger.group("loadTenants start");
        setIsLoadingTenants(true);
        setTenantValidationState(preferredTenantId ? "loading" : "idle");
        setRunState("loading");
        setStatusText("Loading tenants...");
        setErrorText("");
        setAutoSelectionMessage("");
        setDealers([]);
        setSelectedTenantId("");
        setSelectedDealerId("");
        setDealerValidationState(preferredDealerId ? "idle" : "idle");
        try {
            if (headerInfo.headerCount === 0) {
                throw new Error('No captured PRODTechMOTORS headers or Global Headers found. Open app.tekioncloud.com and trigger "/api/userservice/u/employee/profile" first.');
            }
            logger.debug("using auth header source", headerInfo.source);
            logger.debug("selected profile tenant target", preferredTenantId);
            logger.debug("selected profile dealer target", preferredDealerId);
            const body = {
                envPod: [{ env: "PREPROD", pod: null }],
                platform: "ARC",
            };
            const response = (await proxyPost(TENANTS_URL, body, headerInfo.headers));
            logger.debug("tenants response", response);
            const tenantInfos = response.data?.flatMap((item) => item.tenantInfos ?? []) ?? [];
            setTenants(tenantInfos);
            const tenantIds = tenantInfos.map((x) => normalize(x.tenantId)).filter(Boolean);
            logger.debug("tenant ids from API", tenantIds);
            const matchedTenant = preferredTenantId
                ? tenantInfos.find((tenant) => normalize(tenant.tenantId) === preferredTenantId) ?? null
                : null;
            logger.debug("matchedTenant", matchedTenant);
            if (preferredTenantId) {
                if (matchedTenant) {
                    const tenantId = normalize(matchedTenant.tenantId);
                    setSelectedTenantId(tenantId);
                    setTenantValidationState("matched");
                    setAutoSelectionMessage(`✅ Tenant validated and auto-selected from selected dealer profile: ${tenantId}`);
                    setRunState("success");
                    setStatusText(`Loaded ${tenantInfos.length} tenant(s). Auto-selected tenant ${tenantId}.`);
                }
                else {
                    setTenantValidationState("not-found");
                    setAutoSelectionMessage(`Selected dealer profile tenant "${preferredTenantId}" was not found in Step 2 tenant results.`);
                    setRunState("warning");
                    setStatusText(`Loaded ${tenantInfos.length} tenant(s), but selected profile tenant was not found.`);
                }
            }
            else {
                setTenantValidationState("idle");
                setRunState("success");
                setStatusText(`Loaded ${tenantInfos.length} tenant(s)`);
            }
            return tenantInfos;
        }
        catch (error) {
            logger.error("load tenants failed", error);
            setTenantValidationState(preferredTenantId ? "not-found" : "idle");
            setRunState("error");
            setStatusText("Failed to load tenants");
            setErrorText(error instanceof Error ? error.message : String(error));
            throw error;
        }
        finally {
            setIsLoadingTenants(false);
            logger.groupEnd();
        }
    };
    const loadDealers = async (tenantIdOverride) => {
        logger.group("loadDealers start");
        setIsLoadingDealers(true);
        setDealerValidationState(preferredDealerId ? "loading" : "idle");
        setRunState("loading");
        setStatusText("Loading dealers...");
        setErrorText("");
        try {
            const tenantIdForRequest = normalize(tenantIdOverride) || resolvedTenantId;
            logger.debug("tenantIdForRequest", tenantIdForRequest);
            logger.debug("selected profile dealer target", preferredDealerId);
            if (!tenantIdForRequest) {
                throw new Error("Please select or validate a tenant first.");
            }
            const body = {
                podId: null,
                tenantId: tenantIdForRequest,
                envs: ["PREPROD"],
                platform: "ARC",
                cluster: null,
            };
            const response = (await proxyPost(DEALERS_URL, body, headerInfo.headers));
            logger.debug("dealers response", response);
            const dealerRows = response.data?.PREPROD ?? [];
            setDealers(dealerRows);
            setSelectedDealerId("");
            const dealerIds = dealerRows.map((x) => normalize(x.dealerId)).filter(Boolean);
            logger.debug("dealer ids from API", dealerIds);
            const matchedDealer = preferredDealerId
                ? dealerRows.find((dealer) => normalize(dealer.dealerId) === preferredDealerId) ?? null
                : null;
            logger.debug("matchedDealer", matchedDealer);
            if (preferredDealerId) {
                if (matchedDealer) {
                    const dealerId = normalize(matchedDealer.dealerId);
                    setSelectedDealerId(dealerId);
                    setDealerValidationState("matched");
                    setAutoSelectionMessage(`✅ Dealer validated and auto-selected from selected dealer profile: ${dealerId}`);
                    setRunState("success");
                    setStatusText(`Loaded ${dealerRows.length} dealer(s) for tenant ${tenantIdForRequest}. Auto-selected dealer ${dealerId}.`);
                }
                else {
                    setDealerValidationState("not-found");
                    setAutoSelectionMessage(`Selected dealer profile dealer "${preferredDealerId}" was not found under tenant "${tenantIdForRequest}".`);
                    setRunState("warning");
                    setStatusText(`Loaded ${dealerRows.length} dealer(s), but selected profile dealer was not found.`);
                }
            }
            else {
                setDealerValidationState("idle");
                setRunState("success");
                setStatusText(`Loaded ${dealerRows.length} dealer(s) for tenant ${tenantIdForRequest}`);
            }
            return dealerRows;
        }
        catch (error) {
            logger.error("load dealers failed", error);
            setDealerValidationState(preferredDealerId ? "not-found" : "idle");
            setRunState("error");
            setStatusText("Failed to load dealers");
            setErrorText(error instanceof Error ? error.message : String(error));
            throw error;
        }
        finally {
            setIsLoadingDealers(false);
            logger.groupEnd();
        }
    };
    const autoResolveTenantAndDealer = async () => {
        logger.group("autoResolveTenantAndDealer");
        setIsAutoResolving(true);
        setErrorText("");
        setShowPayloadPreview(false);
        try {
            if (!preferredTenantId) {
                throw new Error("No selected dealer profile tenant found.");
            }
            if (!preferredDealerId) {
                throw new Error("No selected dealer profile dealer found.");
            }
            const tenantRows = await loadTenants();
            const matchedTenant = tenantRows.find((tenant) => normalize(tenant.tenantId) === preferredTenantId) ?? null;
            if (!matchedTenant?.tenantId) {
                throw new Error(`Selected profile tenant "${preferredTenantId}" not found in tenants API response.`);
            }
            const validatedTenantId = normalize(matchedTenant.tenantId);
            logger.info("validated tenant from Step 2", validatedTenantId);
            const dealerRows = await loadDealers(validatedTenantId);
            const matchedDealer = dealerRows.find((dealer) => normalize(dealer.dealerId) === preferredDealerId) ?? null;
            if (!matchedDealer?.dealerId) {
                throw new Error(`Selected profile dealer "${preferredDealerId}" not found in dealers API response for tenant "${validatedTenantId}".`);
            }
            const validatedDealerId = normalize(matchedDealer.dealerId);
            logger.info("validated dealer from Step 3", validatedDealerId);
            setSelectedTenantId(validatedTenantId);
            setSelectedDealerId(validatedDealerId);
            setTenantValidationState("matched");
            setDealerValidationState("matched");
            setRunState("success");
            setStatusText(`Auto-validation completed. Tenant "${validatedTenantId}" and dealer "${validatedDealerId}" are ready.`);
            setAutoSelectionMessage(`✅ Auto-validated tenant ${validatedTenantId} and dealer ${validatedDealerId}. You can now enter OEM dealer codes and preview/submit.`);
        }
        catch (error) {
            logger.error("autoResolveTenantAndDealer failed", error);
            setRunState("error");
            setStatusText("Auto-validation failed");
            setErrorText(error instanceof Error ? error.message : String(error));
        }
        finally {
            setIsAutoResolving(false);
            logger.groupEnd();
        }
    };
    const buildApprovalPayload = () => {
        const tenantIdForPayload = resolvedTenantId;
        const dealerIdForPayload = resolvedDealerId;
        logger.group("buildApprovalPayload");
        logger.debug("tenantIdForPayload", tenantIdForPayload);
        logger.debug("dealerIdForPayload", dealerIdForPayload);
        logger.debug("parsedOemDealerCodes", parsedOemDealerCodes);
        if (!tenantIdForPayload) {
            logger.groupEnd();
            throw new Error("Preview unavailable: tenant is not selected or validated yet.");
        }
        if (!dealerIdForPayload) {
            logger.groupEnd();
            throw new Error("Preview unavailable: dealer is not selected or validated yet.");
        }
        if (parsedOemDealerCodes.length === 0) {
            logger.groupEnd();
            throw new Error("Preview unavailable: please enter at least one OEM dealer code.");
        }
        const payload = {
            moduleName: "CONTRACT_CENTER",
            actionType: "RESTRICTED_API",
            requestName: `Dealer codes: ${parsedOemDealerCodes.join(", ")}`,
            tagId: null,
            releaseType: null,
            labels: {
                ENV: {
                    value: ["PREPROD"],
                },
                TEMPLATE_ID: {
                    value: TEMPLATE_ID,
                },
            },
            platform: "ARC",
            cluster: "ARC_DEFAULT",
            approvalEnvType: "MULTI_ENV",
            notes: {
                note: `Dealer codes: ${parsedOemDealerCodes.join(", ")}`,
            },
            metaDataByEnv: {
                PREPROD: {
                    templateId: TEMPLATE_ID,
                    templateName: "update dealer-master internal ",
                    headers: {
                        "Content-Type": {
                            format: "application/json",
                            params: [],
                            required: true,
                        },
                        "tek-sandbox-id": {
                            format: "${tekSandboxId}",
                            params: ["tekSandboxId"],
                            required: false,
                        },
                    },
                    headerParams: {
                        tekSandboxId: "",
                    },
                    bodyParams: {},
                    preDefinedValuesParams: {},
                    url: "/dealer-settings/restricted/dealer-master/internal/update",
                    urlParams: {},
                    body: {
                        format: buildApprovalBodyFormat(parsedOemDealerCodes),
                        params: [],
                    },
                    tenantDealerKeys: [
                        {
                            tenantId: tenantIdForPayload,
                            dealerIds: [dealerIdForPayload],
                            runForAllDealers: false,
                        },
                    ],
                    runForAllTenantsOfPod: false,
                    runForAllDealersOfPod: false,
                    podIds: null,
                    runForAllDealersOfPrograms: false,
                    product: "",
                    programs: [],
                    templateCategory: null,
                },
            },
        };
        logger.debug("payload built successfully", payload);
        logger.groupEnd();
        return payload;
    };
    const handlePreviewPayload = () => {
        logger.group("handlePreviewPayload");
        try {
            const payload = buildApprovalPayload();
            setLastApprovalPayload(payload);
            setShowPayloadPreview(true);
            setRunState("success");
            setStatusText("Approval payload preview generated successfully.");
            setErrorText("");
            logger.info("preview payload generated");
        }
        catch (error) {
            setShowPayloadPreview(false);
            setLastApprovalPayload(null);
            setRunState("warning");
            setStatusText("Could not generate preview payload yet.");
            setErrorText(error instanceof Error ? error.message : String(error));
            logger.warn("preview payload failed", error);
        }
        finally {
            logger.groupEnd();
        }
    };
    const submitApprovalRequest = async () => {
        logger.group("submitApprovalRequest");
        setIsSubmitting(true);
        setRunState("loading");
        setStatusText("Submitting approval request...");
        setErrorText("");
        try {
            const payload = buildApprovalPayload();
            setLastApprovalPayload(payload);
            const response = await proxyPost(APPROVAL_URL, payload, headerInfo.headers);
            logger.debug("approval response", response);
            setRunState("success");
            setStatusText("Approval request submitted successfully.");
            setErrorText("");
        }
        catch (error) {
            logger.error("submit approval request failed", error);
            setRunState("error");
            setStatusText("Failed to submit approval request");
            setErrorText(error instanceof Error ? error.message : String(error));
        }
        finally {
            setIsSubmitting(false);
            logger.groupEnd();
        }
    };
    return (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsxs("div", { style: {
                    borderRadius: 18,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 18,
                }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 22, fontWeight: 800, marginBottom: 6 }, children: "Raise OEM ID Request" }), _jsx("div", { style: { color: "#94a3b8", fontSize: 14, lineHeight: 1.7 }, children: "Uses PRODTechMOTORS API headers for authentication and selected dealer profile values for tenant/dealer validation." }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }, children: [_jsx(Pill, { label: "Header Source", value: headerInfo.source }), _jsx(Pill, { label: "Header Count", value: String(headerInfo.headerCount) }), _jsx(Pill, { label: "Selected Profile Tenant", value: preferredTenantId || "Not selected" }), _jsx(Pill, { label: "Selected Profile Dealer", value: preferredDealerId || "Not selected" }), _jsx(Pill, { label: "Resolved Tenant", value: resolvedTenantId || "Pending" }), _jsx(Pill, { label: "Resolved Dealer", value: resolvedDealerId || "Pending" }), _jsx(Pill, { label: "OEM Codes", value: String(parsedOemDealerCodes.length) })] }), autoSelectionMessage ? (_jsx("div", { style: {
                            marginTop: 12,
                            borderRadius: 12,
                            border: "1px solid rgba(59,130,246,0.22)",
                            background: "rgba(59,130,246,0.10)",
                            color: "#bfdbfe",
                            padding: "10px 12px",
                            fontSize: 13,
                            whiteSpace: "pre-wrap",
                        }, children: autoSelectionMessage })) : null] }), _jsx(StatusBox, { runState: runState, statusText: statusText, errorText: errorText }), _jsxs(SectionCard, { title: "Step 1 - Capture / Refresh Headers", children: [_jsxs("div", { style: { color: "#cbd5e1", fontSize: 13, lineHeight: 1.7 }, children: ["Trigger this API in browser:", _jsx("br", {}), _jsx("code", { children: "https://app.tekioncloud.com/api/userservice/u/employee/profile" }), _jsx("br", {}), "These headers are used for authentication/session while selected profile tenant/dealer are used for validation."] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => {
                                    logger.info("manual refresh captured headers clicked");
                                    requestLatestCaptureFromExtension();
                                    setCaptureVersion((prev) => prev + 1);
                                }, children: "Refresh Captured Headers" }), _jsx("button", { className: "btn-postman", type: "button", disabled: isAutoResolving || headerInfo.headerCount === 0 || !preferredTenantId || !preferredDealerId, onClick: () => {
                                    void autoResolveTenantAndDealer();
                                }, children: isAutoResolving ? "Auto Validating..." : "Auto Validate Tenant + Dealer" })] })] }), _jsxs(SectionCard, { title: "Step 2 - Load Tenants", children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 12, lineHeight: 1.6 }, children: "Validate selected profile tenant against 1st API response. If found, it gets auto-selected." }), _jsx(ValidationRow, { label: "Selected profile tenant target", value: preferredTenantId || "Not selected", state: tenantValidationState, reason: getValidationReason(preferredTenantId, tenantValidationState, "tenant") }), _jsx("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: _jsx("button", { className: "btn-postman", type: "button", disabled: isLoadingTenants, onClick: () => {
                                void loadTenants();
                            }, children: isLoadingTenants ? "Loading..." : "Load Tenants" }) }), tenants.length > 0 ? (_jsxs("div", { children: [_jsx("div", { style: labelStyle, children: "Tenant" }), _jsxs("select", { className: "st-input", value: selectedTenantId, onChange: (e) => {
                                    logger.info("manual tenant selection changed", e.target.value);
                                    setSelectedTenantId(e.target.value);
                                    setSelectedDealerId("");
                                    setDealers([]);
                                    setDealerValidationState(preferredDealerId ? "idle" : "idle");
                                }, style: inputStyle, children: [_jsx("option", { value: "", children: "Select tenant" }), tenants.map((tenant, index) => {
                                        const tenantId = normalize(tenant.tenantId);
                                        return (_jsxs("option", { value: tenantId, children: [tenantId, " ", tenant.active ? "✅" : "❌"] }, `${tenantId}-${index}`));
                                    })] })] })) : null] }), _jsxs(SectionCard, { title: "Step 3 - Load Dealers for Selected Tenant", children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 12, lineHeight: 1.6 }, children: "Validate selected profile dealer against 2nd API response. If found, it gets auto-selected." }), _jsx(ValidationRow, { label: "Selected profile dealer target", value: preferredDealerId || "Not selected", state: dealerValidationState, reason: getValidationReason(preferredDealerId, dealerValidationState, "dealer") }), _jsx("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: _jsx("button", { className: "btn-postman", type: "button", disabled: isLoadingDealers || !resolvedTenantId, onClick: () => {
                                void loadDealers();
                            }, children: isLoadingDealers ? "Loading..." : "Load Dealers" }) }), dealers.length > 0 ? (_jsxs("div", { children: [_jsx("div", { style: labelStyle, children: "Dealer" }), _jsxs("select", { className: "st-input", value: selectedDealerId, onChange: (e) => {
                                    logger.info("manual dealer selection changed", e.target.value);
                                    setSelectedDealerId(e.target.value);
                                }, style: inputStyle, children: [_jsx("option", { value: "", children: "Select dealer" }), dealers.map((dealer, index) => {
                                        const dealerId = normalize(dealer.dealerId);
                                        const displayName = normalize(dealer.displayName || dealer.dealerName) || dealerId;
                                        return (_jsxs("option", { value: dealerId, children: [dealerId, " - ", displayName, " ", dealer.active ? "✅" : "❌"] }, `${dealerId}-${index}`));
                                    })] })] })) : null] }), _jsxs(SectionCard, { title: "Step 4 - Enter OEM Dealer Codes", children: [_jsx("div", { style: labelStyle, children: "OEM Dealer Codes" }), _jsx("textarea", { className: "st-input", value: oemDealerCodesInput, onChange: (e) => {
                            logger.debug("OEM codes input changed", e.target.value);
                            setOemDealerCodesInput(e.target.value);
                        }, placeholder: "34125\n34126\n34127\nor comma separated", rows: 8, style: {
                            ...inputStyle,
                            minHeight: 160,
                            resize: "vertical",
                        } }), _jsx("div", { style: { color: "#94a3b8", fontSize: 12 }, children: "Supports one code per line or comma-separated values." })] }), _jsxs(SectionCard, { title: "Step 5 - Raise Request", children: [_jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-postman", type: "button", disabled: isSubmitting, onClick: () => {
                                    void submitApprovalRequest();
                                }, children: isSubmitting ? "Submitting..." : "Raise OEM ID Request" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: handlePreviewPayload, disabled: !canPreviewPayload, children: showPayloadPreview ? "Refresh Preview Payload" : "Preview Payload" })] }), _jsxs("div", { style: { color: canPreviewPayload ? "#86efac" : "#94a3b8", fontSize: 12 }, children: ["Preview readiness:", " ", canPreviewPayload
                                ? "Ready ✅"
                                : "Waiting for validated tenant, validated dealer, and OEM codes"] })] }), showPayloadPreview && lastApprovalPayload ? (_jsx(SectionCard, { title: "Approval Payload Preview", children: _jsx("pre", { style: {
                        margin: 0,
                        padding: 12,
                        borderRadius: 12,
                        background: "#0f172a",
                        color: "#e2e8f0",
                        overflow: "auto",
                        fontSize: 12,
                        whiteSpace: "pre-wrap",
                    }, children: JSON.stringify(lastApprovalPayload, null, 2) }) })) : null, dealers.length > 0 ? (_jsx(SectionCard, { title: `Dealer Results (${dealers.length})`, children: _jsx("div", { style: { overflowX: "auto", overflowY: "auto", maxHeight: "420px" }, children: _jsxs("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: 920 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "rgba(255,255,255,0.04)" }, children: [_jsx("th", { style: thStyle, children: "#" }), _jsx("th", { style: thStyle, children: "Tenant ID" }), _jsx("th", { style: thStyle, children: "Dealer ID" }), _jsx("th", { style: thStyle, children: "Display Name" }), _jsx("th", { style: thStyle, children: "Active" }), _jsx("th", { style: thStyle, children: "Matched" })] }) }), _jsx("tbody", { children: dealers.map((dealer, index) => {
                                    const dealerId = normalize(dealer.dealerId);
                                    const isMatched = preferredDealerId && dealerId === preferredDealerId;
                                    return (_jsxs("tr", { style: { borderTop: "1px solid rgba(255,255,255,0.08)" }, children: [_jsx("td", { style: tdStyle, children: index + 1 }), _jsx("td", { style: tdMonoStyle, children: normalize(dealer.tenantId) || "—" }), _jsx("td", { style: tdMonoStyle, children: dealerId || "—" }), _jsx("td", { style: tdStyle, children: normalize(dealer.displayName || dealer.dealerName) || "—" }), _jsx("td", { style: tdStyle, children: dealer.active ? "Yes" : "No" }), _jsx("td", { style: tdStyle, children: isMatched ? (_jsx("span", { style: validatedBadgeStyle, children: "\u2713 Matched" })) : (_jsx("span", { style: neutralBadgeStyle, children: "\u2014" })) })] }, `${dealer.tenantId}-${dealer.dealerId}-${index}`));
                                }) })] }) }) })) : null] }));
};
const inputStyle = {
    width: "100%",
    minHeight: 42,
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 13,
    boxSizing: "border-box",
};
const labelStyle = {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 6,
};
const thStyle = {
    textAlign: "left",
    padding: "12px 10px",
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: "nowrap",
};
const tdStyle = {
    textAlign: "left",
    padding: "12px 10px",
    color: "#e2e8f0",
    fontSize: 13,
    verticalAlign: "top",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
};
const tdMonoStyle = {
    ...tdStyle,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};
const validatedBadgeStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 999,
    color: "#86efac",
    border: "1px solid rgba(34,197,94,0.35)",
    background: "rgba(34,197,94,0.12)",
    boxShadow: "0 0 12px rgba(34,197,94,0.22)",
    fontSize: 12,
    fontWeight: 800,
};
const neutralBadgeStyle = {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: 999,
    color: "#94a3b8",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    fontSize: 12,
    fontWeight: 700,
};
const loadingBadgeStyle = {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 10px",
    borderRadius: 999,
    color: "#93c5fd",
    border: "1px solid rgba(59,130,246,0.30)",
    background: "rgba(59,130,246,0.10)",
    fontSize: 12,
    fontWeight: 800,
};
const invalidBadgeStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 999,
    color: "#fca5a5",
    border: "1px solid rgba(239,68,68,0.30)",
    background: "rgba(239,68,68,0.10)",
    fontSize: 12,
    fontWeight: 800,
};
const Pill = ({ label, value }) => (_jsxs("span", { style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        color: "#cbd5e1",
        fontSize: 12,
    }, children: [label, _jsx("b", { style: { color: "#f8fafc" }, children: value })] }));
const SectionCard = ({ title, children }) => (_jsxs("div", { style: {
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        padding: 18,
        display: "grid",
        gap: 12,
    }, children: [_jsx("div", { style: {
                fontSize: 18,
                fontWeight: 800,
                color: "#f8fafc",
            }, children: title }), children] }));
const StatusBox = ({ runState, statusText, errorText }) => (_jsxs("div", { style: {
        borderRadius: 14,
        padding: "12px 14px",
        fontSize: 13,
        lineHeight: 1.6,
        border: runState === "error"
            ? "1px solid rgba(239,68,68,0.25)"
            : runState === "success"
                ? "1px solid rgba(34,197,94,0.25)"
                : runState === "warning"
                    ? "1px solid rgba(245,158,11,0.25)"
                    : runState === "loading"
                        ? "1px solid rgba(59,130,246,0.25)"
                        : "1px solid rgba(255,255,255,0.08)",
        background: runState === "error"
            ? "rgba(239,68,68,0.10)"
            : runState === "success"
                ? "rgba(34,197,94,0.10)"
                : runState === "warning"
                    ? "rgba(245,158,11,0.10)"
                    : runState === "loading"
                        ? "rgba(59,130,246,0.10)"
                        : "rgba(255,255,255,0.03)",
        color: runState === "error"
            ? "#fecaca"
            : runState === "success"
                ? "#bbf7d0"
                : runState === "warning"
                    ? "#fde68a"
                    : runState === "loading"
                        ? "#bfdbfe"
                        : "#cbd5e1",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
    }, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: errorText ? 6 : 0 }, children: statusText }), errorText ? _jsx("div", { children: errorText }) : null] }));
const ValidationRow = ({ label, value, state, reason }) => {
    const isMatched = state === "matched";
    const isNotFound = state === "not-found";
    const isLoading = state === "loading";
    return (_jsxs("div", { style: {
            display: "grid",
            gap: 8,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
        }, children: [_jsxs("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }, children: [_jsxs("div", { style: { color: "#94a3b8", fontSize: 12, fontWeight: 700 }, children: [label, ":"] }), _jsx("div", { style: {
                            fontSize: 14,
                            fontWeight: 800,
                            color: isMatched ? "#86efac" : isNotFound ? "#fca5a5" : isLoading ? "#93c5fd" : "#f8fafc",
                            textShadow: isMatched ? "0 0 10px rgba(34,197,94,0.28)" : "none",
                        }, children: value }), isMatched ? (_jsx("span", { style: validatedBadgeStyle, children: "\u2713 Validated" })) : isNotFound ? (_jsx("span", { style: invalidBadgeStyle, children: "\u2715 Not found" })) : isLoading ? (_jsx("span", { style: loadingBadgeStyle, children: "Loading..." })) : (_jsx("span", { style: neutralBadgeStyle, children: "Waiting" }))] }), _jsx("div", { style: { color: "#94a3b8", fontSize: 12 }, children: reason })] }));
};
export default RaiseOemIdRequestView;
