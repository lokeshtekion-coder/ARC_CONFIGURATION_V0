import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { loadTekionApiSettingsBundle, getSelectedDealerProfileId, } from "../../../../services/tekionApiSettings";
import { loadLatestExtensionCapture, requestLatestCaptureFromExtension, subscribeToExtensionCapture, } from "../../../../services/extensionBridge";
import { usePartsBlueprint } from "../../../../Context/Blueprint_Parts_Context";
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
/**
 * Robust extraction logic to handle pure codes, comma/tab separated strings,
 * or conversational text like:
 * "PARTS PURCHASING CODE= 307120///////////////////////115903=DEALER CODE"
 */
function extractOemDealerCodes(rawText) {
    if (!rawText || !rawText.trim())
        return [];
    const BLACKLIST_WORDS = new Set([
        "PARTS",
        "PURCHASING",
        "DEALER",
        "DEALERS",
        "CODE",
        "CODES",
        "FACTORY",
        "ORDERS",
        "ORDER",
        "SUBMIT",
        "WHAT",
        "NONE",
        "NULL",
        "TRUE",
        "FALSE",
        "SAME",
        "MAIN",
        "STORE",
        "SETUP",
        "TEST",
        "OEM",
        "ID",
        "AND",
        "THE",
        "FOR",
        "OUR",
    ]);
    // Replace delimiters with spaces
    const cleanSeparators = rawText.replace(/[/\\,=;:|\t\r\n]+/g, " ");
    const tokens = cleanSeparators.split(/\s+/).map((t) => t.trim()).filter(Boolean);
    const candidates = [];
    for (const token of tokens) {
        const upper = token.toUpperCase();
        // Skip blacklisted common vocabulary words
        if (BLACKLIST_WORDS.has(upper))
            continue;
        // OEM codes in auto DMS are typically 4-10 alphanumeric characters and contain numbers
        const isAlphanumericLength = /^[A-Z0-9]{4,10}$/i.test(upper);
        const hasAtLeastOneDigit = /\d/.test(upper);
        if (isAlphanumericLength && hasAtLeastOneDigit) {
            if (!candidates.includes(upper)) {
                candidates.push(upper);
            }
        }
    }
    // Fallback: If heuristic found nothing, return trimmed raw text
    if (candidates.length === 0 && rawText.trim()) {
        return [rawText.trim().toUpperCase()];
    }
    return candidates;
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
    return `{\n "oemDealerCodes": [\n${oemCodes
        .map((code) => ` "${code}"`)
        .join(",\n")}\n ]\n}`;
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
    return kind === "tenant"
        ? "Waiting to call tenants API."
        : "Waiting to call dealers API.";
}
const InfoIcon = ({ text }) => {
    const [visible, setVisible] = useState(false);
    return (_jsxs("div", { style: { position: "relative", display: "inline-flex", alignItems: "center" }, onMouseEnter: () => setVisible(true), onMouseLeave: () => setVisible(false), onFocus: () => setVisible(true), onBlur: () => setVisible(false), children: [_jsx("button", { type: "button", "aria-label": "More info", style: {
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.04)",
                    color: "#94a3b8",
                    fontSize: 11,
                    fontWeight: 800,
                    cursor: "help",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                }, children: "i" }), visible ? (_jsx("div", { role: "tooltip", style: {
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    left: 0,
                    zIndex: 20,
                    width: 300,
                    maxWidth: "min(300px, 80vw)",
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "#0f172a",
                    color: "#cbd5e1",
                    fontSize: 12,
                    lineHeight: 1.6,
                    boxShadow: "0 18px 40px rgba(0,0,0,0.32)",
                    whiteSpace: "normal",
                }, children: text })) : null] }));
};
const CompactStepCard = ({ step, title, info, children }) => (_jsxs("div", { style: {
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        padding: 16,
        display: "grid",
        gap: 12,
        minWidth: 0,
    }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [_jsx("span", { style: {
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: "#93c5fd",
                        background: "rgba(59,130,246,0.12)",
                        border: "1px solid rgba(59,130,246,0.20)",
                        borderRadius: 999,
                        padding: "4px 8px",
                    }, children: step }), _jsx("span", { style: { fontSize: 15, fontWeight: 800, color: "#f8fafc" }, children: title }), info ? _jsx(InfoIcon, { text: info }) : null] }), children] }));
export const RaiseOemIdRequestView = () => {
    // Blueprint Context Integration
    const { hasBlueprint, getAnswer } = usePartsBlueprint();
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
    // Retrieve raw OEM code string from Blueprint
    const rawBlueprintAnswer = useMemo(() => {
        if (!hasBlueprint)
            return "";
        const ans = getAnswer("factory parts orders") ??
            getAnswer("Dealer code(s) (OEM ID#)") ??
            getAnswer("Dealer code(s)");
        return typeof ans === "string" ? ans.trim() : ans ? String(ans).trim() : "";
    }, [hasBlueprint, getAnswer]);
    // Pre-fill OEM Codes input when blueprint data is detected
    useEffect(() => {
        if (!rawBlueprintAnswer)
            return;
        setOemDealerCodesInput((prev) => {
            if (prev.trim())
                return prev; // Preserve manual user input if already typed
            const extracted = extractOemDealerCodes(rawBlueprintAnswer);
            return extracted.join("\n");
        });
    }, [rawBlueprintAnswer]);
    const handleResetToBlueprint = () => {
        if (!rawBlueprintAnswer)
            return;
        const extracted = extractOemDealerCodes(rawBlueprintAnswer);
        setOemDealerCodesInput(extracted.join("\n"));
    };
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
            .map((item) => normalize(item).toUpperCase())
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
        setDealerValidationState("idle");
        try {
            if (headerInfo.headerCount === 0) {
                throw new Error('No captured PRODTechMOTORS headers or Global Headers found. Open app.tekioncloud.com and trigger "/api/userservice/u/employee/profile" first.');
            }
            const body = {
                envPod: [{ env: "PREPROD", pod: null }],
                platform: "ARC",
            };
            const response = (await proxyPost(TENANTS_URL, body, headerInfo.headers));
            const tenantInfos = response.data?.flatMap((item) => item.tenantInfos ?? []) ?? [];
            setTenants(tenantInfos);
            const matchedTenant = preferredTenantId
                ? tenantInfos.find((tenant) => normalize(tenant.tenantId) === preferredTenantId) ?? null
                : null;
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
                    setAutoSelectionMessage(`Selected dealer profile tenant "${preferredTenantId}" was not found in tenants results.`);
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
            const dealerRows = response.data?.PREPROD ?? [];
            setDealers(dealerRows);
            setSelectedDealerId("");
            const matchedDealer = preferredDealerId
                ? dealerRows.find((dealer) => normalize(dealer.dealerId) === preferredDealerId) ?? null
                : null;
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
            const dealerRows = await loadDealers(validatedTenantId);
            const matchedDealer = dealerRows.find((dealer) => normalize(dealer.dealerId) === preferredDealerId) ?? null;
            if (!matchedDealer?.dealerId) {
                throw new Error(`Selected profile dealer "${preferredDealerId}" not found in dealers API response for tenant "${validatedTenantId}".`);
            }
            const validatedDealerId = normalize(matchedDealer.dealerId);
            setSelectedTenantId(validatedTenantId);
            setSelectedDealerId(validatedDealerId);
            setTenantValidationState("matched");
            setDealerValidationState("matched");
            setRunState("success");
            setStatusText(`Auto-validation completed. Tenant "${validatedTenantId}" and dealer "${validatedDealerId}" are ready.`);
            setAutoSelectionMessage(`✅ Auto-validated tenant ${validatedTenantId} and dealer ${validatedDealerId}. You can now review OEM dealer codes and preview/submit.`);
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
        if (!tenantIdForPayload) {
            throw new Error("Preview unavailable: tenant is not selected or validated yet.");
        }
        if (!dealerIdForPayload) {
            throw new Error("Preview unavailable: dealer is not selected or validated yet.");
        }
        if (parsedOemDealerCodes.length === 0) {
            throw new Error("Preview unavailable: please enter at least one OEM dealer code.");
        }
        return {
            moduleName: "CONTRACT_CENTER",
            actionType: "RESTRICTED_API",
            requestName: `Dealer codes: ${parsedOemDealerCodes.join(", ")}`,
            tagId: null,
            releaseType: null,
            labels: {
                ENV: { value: ["PREPROD"] },
                TEMPLATE_ID: { value: TEMPLATE_ID },
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
                        "Content-Type": { format: "application/json", params: [], required: true },
                        "tek-sandbox-id": { format: "${tekSandboxId}", params: ["tekSandboxId"], required: false },
                    },
                    headerParams: { tekSandboxId: "" },
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
    };
    const handlePreviewPayload = () => {
        try {
            const payload = buildApprovalPayload();
            setLastApprovalPayload(payload);
            setShowPayloadPreview(true);
            setRunState("success");
            setStatusText("Approval payload preview generated successfully.");
            setErrorText("");
        }
        catch (error) {
            setShowPayloadPreview(false);
            setLastApprovalPayload(null);
            setRunState("warning");
            setStatusText("Could not generate preview payload yet.");
            setErrorText(error instanceof Error ? error.message : String(error));
        }
    };
    const submitApprovalRequest = async () => {
        setIsSubmitting(true);
        setRunState("loading");
        setStatusText("Submitting approval request...");
        setErrorText("");
        try {
            const payload = buildApprovalPayload();
            setLastApprovalPayload(payload);
            await proxyPost(APPROVAL_URL, payload, headerInfo.headers);
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
        }
    };
    return (_jsxs("div", { style: { display: "grid", gap: 14 }, children: [_jsxs("div", { style: {
                    borderRadius: 18,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 18,
                    display: "grid",
                    gap: 12,
                }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 22, fontWeight: 800 }, children: "Raise OEM ID Request" }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx(Pill, { label: "Header Source", value: headerInfo.source }), _jsx(Pill, { label: "Header Count", value: String(headerInfo.headerCount) }), _jsx(Pill, { label: "Profile Tenant", value: preferredTenantId || "Not selected" }), _jsx(Pill, { label: "Profile Dealer", value: preferredDealerId || "Not selected" }), _jsx(Pill, { label: "Resolved Tenant", value: resolvedTenantId || "Pending" }), _jsx(Pill, { label: "Resolved Dealer", value: resolvedDealerId || "Pending" }), _jsx(Pill, { label: "OEM Codes", value: String(parsedOemDealerCodes.length) })] }), autoSelectionMessage ? (_jsx("div", { style: {
                            borderRadius: 12,
                            border: "1px solid rgba(59,130,246,0.22)",
                            background: "rgba(59,130,246,0.10)",
                            color: "#bfdbfe",
                            padding: "10px 12px",
                            fontSize: 13,
                            whiteSpace: "pre-wrap",
                        }, children: autoSelectionMessage })) : null] }), _jsx(StatusBox, { runState: runState, statusText: statusText, errorText: errorText }), _jsxs("div", { style: {
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                    gap: 14,
                    alignItems: "start",
                }, children: [_jsxs(CompactStepCard, { step: "Step 1", title: "Capture Headers", info: _jsxs(_Fragment, { children: ["Trigger this API in browser:", _jsx("br", {}), _jsx("code", { children: "https://app.tekioncloud.com/api/userservice/u/employee/profile" }), _jsx("br", {}), _jsx("br", {}), "These headers are used for authentication/session. Selected profile tenant/dealer values are used for validation."] }), children: [_jsx(MiniInfoRow, { label: "Source", value: headerInfo.source }), _jsx(MiniInfoRow, { label: "Headers", value: String(headerInfo.headerCount) }), _jsx(MiniInfoRow, { label: "Profile Tenant", value: preferredTenantId || "Not selected" }), _jsx(MiniInfoRow, { label: "Profile Dealer", value: preferredDealerId || "Not selected" }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }, children: [_jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => {
                                            requestLatestCaptureFromExtension();
                                            setCaptureVersion((prev) => prev + 1);
                                        }, children: "Refresh Headers" }), _jsx("button", { className: "btn-postman", type: "button", disabled: isAutoResolving ||
                                            headerInfo.headerCount === 0 ||
                                            !preferredTenantId ||
                                            !preferredDealerId, onClick: () => {
                                            void autoResolveTenantAndDealer();
                                        }, children: isAutoResolving ? "Validating..." : "Auto Validate" })] })] }), _jsxs(CompactStepCard, { step: "Step 2", title: "Load Tenants", info: "Validate the selected profile tenant against the tenants API response. If matched, it is auto-selected.", children: [_jsx(ValidationRow, { label: "Target Tenant", value: preferredTenantId || "Not selected", state: tenantValidationState, reason: getValidationReason(preferredTenantId, tenantValidationState, "tenant"), compact: true }), _jsx("button", { className: "btn-postman", type: "button", disabled: isLoadingTenants, onClick: () => {
                                    void loadTenants();
                                }, children: isLoadingTenants ? "Loading..." : "Load Tenants" }), tenants.length > 0 ? (_jsxs("div", { children: [_jsx("div", { style: labelStyle, children: "Tenant" }), _jsxs("select", { className: "st-input", value: selectedTenantId, onChange: (e) => {
                                            setSelectedTenantId(e.target.value);
                                            setSelectedDealerId("");
                                            setDealers([]);
                                            setDealerValidationState("idle");
                                        }, style: inputStyle, children: [_jsx("option", { value: "", children: "Select tenant" }), tenants.map((tenant, index) => {
                                                const tenantId = normalize(tenant.tenantId);
                                                return (_jsxs("option", { value: tenantId, children: [tenantId, " ", tenant.active ? "✅" : "❌"] }, `${tenantId}-${index}`));
                                            })] })] })) : null] }), _jsxs(CompactStepCard, { step: "Step 3", title: "Load Dealers", info: "Validate the selected profile dealer against the dealer list returned for the resolved tenant.", children: [_jsx(ValidationRow, { label: "Target Dealer", value: preferredDealerId || "Not selected", state: dealerValidationState, reason: getValidationReason(preferredDealerId, dealerValidationState, "dealer"), compact: true }), _jsx("button", { className: "btn-postman", type: "button", disabled: isLoadingDealers || !resolvedTenantId, onClick: () => {
                                    void loadDealers();
                                }, children: isLoadingDealers ? "Loading..." : "Load Dealers" }), dealers.length > 0 ? (_jsxs("div", { children: [_jsx("div", { style: labelStyle, children: "Dealer" }), _jsxs("select", { className: "st-input", value: selectedDealerId, onChange: (e) => {
                                            setSelectedDealerId(e.target.value);
                                        }, style: inputStyle, children: [_jsx("option", { value: "", children: "Select dealer" }), dealers.map((dealer, index) => {
                                                const dealerId = normalize(dealer.dealerId);
                                                const displayName = normalize(dealer.displayName || dealer.dealerName) || dealerId;
                                                return (_jsxs("option", { value: dealerId, children: [dealerId, " - ", displayName, " ", dealer.active ? "✅" : "❌"] }, `${dealerId}-${index}`));
                                            })] })] })) : null] })] }), _jsxs(SectionCard, { title: "Step 4 \u00B7 Enter OEM Dealer Codes", children: [rawBlueprintAnswer && (_jsxs("div", { style: {
                            padding: "10px 14px",
                            borderRadius: 10,
                            background: "rgba(59, 130, 246, 0.08)",
                            border: "1px solid rgba(59, 130, 246, 0.25)",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: 10,
                        }, children: [_jsxs("div", { children: [_jsx("span", { style: { fontSize: 11, fontWeight: 700, color: "#60a5fa", textTransform: "uppercase" }, children: "\uD83D\uDCCB Blueprint Raw Answer:" }), _jsx("div", { style: { color: "#f8fafc", fontSize: 12, marginTop: 2, fontFamily: "monospace" }, children: rawBlueprintAnswer })] }), _jsx("button", { type: "button", className: "btn-secondary btn-sm", onClick: handleResetToBlueprint, title: "Re-run extraction and populate input", children: "\u21BA Re-extract from Blueprint" })] })), _jsx("textarea", { className: "st-input", value: oemDealerCodesInput, onChange: (e) => {
                            setOemDealerCodesInput(e.target.value);
                        }, placeholder: "Multiple IDs can be entered line-by-line or comma-separated\ne.g.\n318190\nA318190\n115903", rows: 6, style: {
                            ...inputStyle,
                            minHeight: 140,
                            resize: "vertical",
                            fontFamily: "monospace",
                        } }), _jsxs("div", { style: { fontSize: 12, color: "#94a3b8" }, children: ["Parsed OEM Codes (", parsedOemDealerCodes.length, "):", " ", _jsx("b", { style: { color: "#86efac" }, children: parsedOemDealerCodes.length > 0 ? parsedOemDealerCodes.join(", ") : "None detected" })] })] }), _jsxs(SectionCard, { title: "Step 5 \u00B7 Preview / Raise Request", info: "Preview becomes available after tenant and dealer are resolved and at least one OEM code is entered.", children: [_jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-postman", type: "button", disabled: isSubmitting || !canPreviewPayload, onClick: () => {
                                    void submitApprovalRequest();
                                }, children: isSubmitting ? "Submitting..." : "Raise OEM ID Request" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: handlePreviewPayload, disabled: !canPreviewPayload, children: showPayloadPreview ? "Refresh Preview Payload" : "Preview Payload" })] }), _jsx("div", { style: { color: canPreviewPayload ? "#86efac" : "#94a3b8", fontSize: 12 }, children: canPreviewPayload
                            ? "Ready for preview/submission ✅"
                            : "Waiting for validated tenant, validated dealer, and OEM codes" })] }), showPayloadPreview && lastApprovalPayload ? (_jsx(SectionCard, { title: "Approval Payload Preview", children: _jsx("pre", { style: {
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
                                    const isMatched = Boolean(preferredDealerId && dealerId === preferredDealerId);
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
    }, children: [label, " ", _jsx("b", { style: { color: "#f8fafc" }, children: value })] }));
const MiniInfoRow = ({ label, value }) => (_jsxs("div", { style: {
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        fontSize: 12,
        lineHeight: 1.5,
    }, children: [_jsx("span", { style: { color: "#94a3b8" }, children: label }), _jsx("span", { style: { color: "#f8fafc", fontWeight: 700, textAlign: "right" }, children: value })] }));
const SectionCard = ({ title, info, children }) => (_jsxs("div", { style: {
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        padding: 18,
        display: "grid",
        gap: 12,
    }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [_jsx("div", { style: { fontSize: 16, fontWeight: 800, color: "#f8fafc" }, children: title }), info ? _jsx(InfoIcon, { text: info }) : null] }), children] }));
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
const ValidationRow = ({ label, value, state, reason, compact = false }) => {
    const isMatched = state === "matched";
    const isNotFound = state === "not-found";
    const isLoading = state === "loading";
    return (_jsxs("div", { style: {
            display: "grid",
            gap: compact ? 6 : 8,
            padding: compact ? "8px 10px" : "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
        }, children: [_jsxs("div", { style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }, children: [_jsxs("div", { style: { color: "#94a3b8", fontSize: 12, fontWeight: 700 }, children: [label, ":"] }), _jsx("div", { style: {
                            fontSize: 13,
                            fontWeight: 800,
                            color: isMatched ? "#86efac" : isNotFound ? "#fca5a5" : isLoading ? "#93c5fd" : "#f8fafc",
                        }, children: value }), isMatched ? (_jsx("span", { style: validatedBadgeStyle, children: "\u2713 Validated" })) : isNotFound ? (_jsx("span", { style: invalidBadgeStyle, children: "\u2715 Not found" })) : isLoading ? (_jsx("span", { style: loadingBadgeStyle, children: "Loading..." })) : (_jsx("span", { style: neutralBadgeStyle, children: "Waiting" }))] }), _jsx("div", { style: { color: "#94a3b8", fontSize: 12 }, children: reason })] }));
};
export default RaiseOemIdRequestView;
