import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useEffect, useMemo, useRef, useState, useCallback, useDeferredValue, } from "react";
import "./Settings.css";
import { loadTekionApiSettingsBundle, saveTekionApiSettings, saveGlobalHeaders, clearGlobalHeaders, clearTekionApiSettings, clearTekionApiSetting, getSelectedDealerProfileId, saveSelectedDealerProfileId, clearSelectedDealerProfileId, } from "../services/tekionApiSettings";
import { requestLatestCaptureFromExtension, subscribeToExtensionCapture, loadLatestExtensionCapture, } from "../services/extensionBridge";
import { useArcRules } from "../hooks/useArcRules";
import { JwtDebugger } from "../components/JwtDebugger";
import { AssigneeSettingsPanel } from "../components/AssigneeSettingsPanel";
import { GlobalHeadersPanel } from "../components/GlobalHeadersPanel";
import { SelectableHeaderMap } from "../components/SelectableHeaderMap";
import { getStores } from "../services/storesDb";
import { decodeBlueprintsForDealer, persistBlueprintDecodeResult, ALL_BLUEPRINT_MODULES, } from "../services/blueprintDecodeBot";
import { syncAccountingBootstrapForDealer } from "../services/bootstrapSyncBot";
const MAX_PROFILE_AGE_MS = 48 * 60 * 60 * 1000;
const TOC_API_ENDPOINT = "https://us-west1-tapapi.tekioncloud.com/tapapi/v2/usermanagement/getuserprofile";
const logger = {
    info: (...args) => console.info("[Settings]", ...args),
    debug: (...args) => console.debug("[Settings]", ...args),
    warn: (...args) => console.warn("[Settings]", ...args),
    error: (...args) => console.error("[Settings]", ...args),
};
const TOKEN_FIELDS = [
    {
        key: "tapDuoApiToken",
        icon: "🔑",
        title: "Tekion Stores API Token",
        label: "tap-duo-api-token",
        placeholder: "Legacy tap-duo-api-token field",
        rows: 7,
        authType: "header",
        headerName: "tap-duo-api-token",
        infoText: "Legacy field preserved for older flows. Stores dashboard now uses TOC API captured request headers automatically.",
    },
    {
        key: "graphApiToken",
        icon: "☁️",
        title: "Microsoft Graph API Token",
        label: "GRAPH API Token",
        placeholder: "Auto-captured via SPFx or paste Microsoft Graph bearer token here",
        rows: 8,
        authType: "bearer",
        extraPreviewLines: [
            "Target: T-90 Arc Dealerss.xlsx",
            "Site: tekion.sharepoint.com/sites/configteam",
            "Auto-Sniffed: Via SPFx single sign-on",
        ],
        validate: (value) => {
            const trimmed = value.trim();
            if (!trimmed)
                return undefined;
            const parts = trimmed.split(".");
            const looksLikeJwt = parts.length === 3 && parts.every((part) => part.trim().length > 0);
            return looksLikeJwt
                ? undefined
                : "This token does not look like a JWT bearer token. Please verify the pasted value.";
        },
        infoText: "Captured automatically by the ARC extension when visiting the SharePoint T-90 Arc Dealerss workbook, or paste manually.",
    },
];
function buildEmptyTokens() {
    return { tapDuoApiToken: "", graphApiToken: "" };
}
function buildHiddenMap() {
    return { tapDuoApiToken: true, graphApiToken: true };
}
function formatSavedAt(value) {
    if (!value)
        return "Not saved yet";
    const d = new Date(value);
    if (Number.isNaN(d.getTime()))
        return "Not saved yet";
    return d.toLocaleString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}
function getHeaderPreviewValue(config) {
    return config.authType === "bearer"
        ? "Authorization: Bearer {token}"
        : config.headerName || config.label;
}
function toKeyValuePairs(headers) {
    if (!headers)
        return [];
    return Object.entries(headers)
        .filter(([key, value]) => key.trim() && String(value).trim())
        .map(([key, value]) => ({ key, value: String(value), enabled: true }));
}
function arePairsEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
function areTokenMapsEqual(a, b) {
    return (a.tapDuoApiToken === b.tapDuoApiToken &&
        a.graphApiToken === b.graphApiToken);
}
const InfoTooltip = React.memo(({ text }) => {
    const [isVisible, setIsVisible] = useState(false);
    return (_jsxs("div", { onMouseEnter: () => setIsVisible(true), onMouseLeave: () => setIsVisible(false), onFocus: () => setIsVisible(true), onBlur: () => setIsVisible(false), style: {
            position: "relative",
            display: "inline-flex",
            cursor: "help",
            marginLeft: 8,
        }, children: [_jsx("span", { tabIndex: 0, "aria-label": "More info", style: {
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    background: "rgba(255,255,255,0.15)",
                    color: "#cbd5e1",
                    fontSize: 11,
                    fontWeight: "bold",
                }, children: "i" }), isVisible && (_jsx("div", { role: "tooltip", style: {
                    position: "absolute",
                    bottom: "100%",
                    left: "50%",
                    transform: "translateX(-50%)",
                    marginBottom: 8,
                    padding: "8px 12px",
                    background: "#1e293b",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    color: "#e2e8f0",
                    fontSize: 12,
                    width: 250,
                    zIndex: 100,
                    boxShadow: "0 10px 25px rgba(0,0,0,0.4)",
                    pointerEvents: "none",
                    fontWeight: "normal",
                    lineHeight: 1.4,
                }, children: text }))] }));
});
const ConfirmButton = React.memo(({ onConfirm, confirmText = "⚠️ Sure?", baseText, requireConfirm = true, className, style, disabled, }) => {
    const [confirming, setConfirming] = useState(false);
    useEffect(() => {
        let t;
        if (confirming)
            t = setTimeout(() => setConfirming(false), 3000);
        return () => clearTimeout(t);
    }, [confirming]);
    return (_jsx("button", { type: "button", className: `${className || ""} ${confirming ? "btn-confirming" : ""}`.trim(), disabled: disabled, style: style, onClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (disabled)
                return;
            if (!requireConfirm) {
                onConfirm();
                return;
            }
            if (confirming) {
                setConfirming(false);
                onConfirm();
            }
            else {
                setConfirming(true);
            }
        }, children: confirming ? confirmText : baseText }));
});
const SecretTextArea = React.memo(({ value, hidden, rows = 7, placeholder, onChange }) => {
    return (_jsxs("div", { style: { position: "relative" }, children: [_jsx("textarea", { className: `st-input secret-textarea ${hidden ? "hidden-mode" : ""}`, value: hidden ? (value ? "••••••••••••••••••••••••••••••••" : "") : value, onChange: (e) => {
                    if (!hidden)
                        onChange(e.target.value);
                }, onFocus: (e) => {
                    if (hidden)
                        e.currentTarget.blur();
                }, placeholder: hidden ? "Hidden — click Show to reveal" : placeholder, rows: rows, spellCheck: false, autoCapitalize: "off", autoCorrect: "off", autoComplete: "off", "aria-label": hidden ? "Token value hidden" : "Token value input", style: { minHeight: Math.max(rows * 24, 150) }, readOnly: hidden }), hidden && value && (_jsx("div", { "aria-hidden": "true", className: "secret-textarea-overlay" }))] }));
});
const TokenCard = React.memo(({ config, value, warning, savedAt, hidden, onUpdateToken, onCopy, onClear, onToggleHidden, }) => {
    const [showJwt, setShowJwt] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    return (_jsxs("section", { className: "section-card", children: [_jsxs("div", { style: {
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 14,
                    flexWrap: "wrap",
                    marginBottom: isExpanded ? 20 : 0,
                }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [_jsx("div", { style: {
                                    width: 34,
                                    height: 34,
                                    borderRadius: 10,
                                    display: "grid",
                                    placeItems: "center",
                                    background: "rgba(59, 130, 246, 0.14)",
                                    border: "1px solid rgba(59, 130, 246, 0.20)",
                                    fontSize: 16,
                                }, children: config.icon }), _jsxs("div", { style: { display: "flex", alignItems: "center" }, children: [_jsx("h4", { style: {
                                            fontSize: 18,
                                            fontWeight: 700,
                                            color: "#f8fafc",
                                            margin: 0,
                                        }, children: config.title }), config.infoText && _jsx(InfoTooltip, { text: config.infoText })] })] }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => setIsExpanded((prev) => !prev), children: isExpanded ? "Hide Details" : "Manage Token" })] }), isExpanded && (_jsxs("div", { style: { paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)" }, children: [_jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }, children: [_jsxs("span", { className: "ui-pill", children: [_jsx("span", { style: { color: "#94a3b8" }, children: "Field" }), _jsx("code", { className: "st-req-url", children: config.label })] }), _jsxs("span", { className: "ui-pill", children: [_jsx("span", { style: { color: "#94a3b8" }, children: "Last saved" }), _jsx("span", { style: { color: "#e2e8f0", fontWeight: 600 }, children: formatSavedAt(savedAt) })] })] }), _jsx(SecretTextArea, { value: value, hidden: hidden, rows: config.rows ?? 7, placeholder: config.placeholder, onChange: (val) => onUpdateToken(config.key, val) }), warning && (_jsxs("div", { style: {
                            marginTop: 10,
                            color: "#fde68a",
                            background: "rgba(245, 158, 11, 0.10)",
                            border: "1px solid rgba(245, 158, 11, 0.22)",
                            borderRadius: 12,
                            padding: "10px 12px",
                            fontSize: 13,
                        }, children: ["\u26A0 ", warning] })), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }, children: [_jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => onToggleHidden(config.key), children: hidden ? "👁 Show Text" : "🙈 Hide Text" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => setShowJwt((prev) => !prev), disabled: !value.trim(), children: showJwt ? "🧾 Hide JWT Debugger" : "🧾 Show JWT Debugger" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => onCopy(value, config.title), disabled: !value.trim(), children: "\uD83D\uDCCB Copy" }), _jsx(ConfirmButton, { className: "btn-cancel-bulk", baseText: "\uD83D\uDDD1 Clear", confirmText: "\u26A0\uFE0F Confirm", onConfirm: () => onClear(config.key, config.title), disabled: !value.trim() })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }, children: [_jsxs("span", { className: "ui-pill", children: [_jsx("span", { style: { color: "#94a3b8" }, children: "Header" }), _jsx("code", { className: "st-req-url", children: getHeaderPreviewValue(config) })] }), (config.extraPreviewLines ?? []).map((line) => (_jsx("span", { className: "ui-pill", children: line }, line)))] }), showJwt && (_jsx("div", { style: { marginTop: 14 }, children: _jsx(JwtDebugger, { title: `${config.title} JWT Debugger`, token: value }) }))] }))] }));
});
const DealerProfileCard = React.memo(({ profile, isSelected, onSelect }) => {
    return (_jsx("div", { className: `compact-card dealer-profile-card ${isSelected ? "selected" : ""}`, children: _jsxs("div", { style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 10,
                flexWrap: "wrap",
            }, children: [_jsxs("div", { style: { minWidth: 0, flex: 1 }, children: [_jsxs("div", { style: { color: "#f8fafc", fontSize: 15, fontWeight: 800, wordBreak: "break-word" }, children: ["\uD83C\uDFEC ", profile.dealerId || "Unknown Dealer"] }), _jsx("div", { style: { color: "#94a3b8", fontSize: 12, marginTop: 4, wordBreak: "break-word" }, children: profile.tenantName || "Unknown Tenant" })] }), _jsx("button", { className: isSelected ? "btn-postman" : "btn-secondary btn-sm", type: "button", onClick: () => onSelect(profile), children: isSelected ? "✅ Selected" : "Select Profile" })] }) }));
});
const CustomCaptureCard = ({ capture, isSelectedForStoresProfile, isSelectedForStoresApi, isTocApi, onApply, onSelectForStoresProfile, onSelectForStoresApi, }) => {
    const tokenExpired = capture.decodedToken?.isExpired === true;
    return (_jsxs("div", { className: "compact-card", style: {
            display: "grid",
            gap: 10,
            border: isTocApi ? "1px solid rgba(56, 189, 248, 0.4)" : undefined,
            background: isTocApi ? "rgba(56, 189, 248, 0.03)" : undefined,
        }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }, children: [_jsxs("div", { children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("span", { style: { color: "#f8fafc", fontSize: 15, fontWeight: 800 }, children: capture.label }), isTocApi && (_jsx("span", { style: {
                                            background: "rgba(56, 189, 248, 0.15)",
                                            color: "#38bdf8",
                                            border: "1px solid rgba(56, 189, 248, 0.3)",
                                            fontSize: 10,
                                            fontWeight: 800,
                                            padding: "2px 8px",
                                            borderRadius: 999,
                                        }, children: "\uD83C\uDFAF TOC API (Default)" }))] }), _jsx("div", { style: { color: "#94a3b8", fontSize: 12, marginTop: 4 }, children: capture.pattern })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { className: isSelectedForStoresProfile ? "btn-postman" : "btn-secondary btn-sm", type: "button", onClick: () => onSelectForStoresProfile(capture.id), children: isSelectedForStoresProfile ? "✅ Stores Profile Source" : "Use As Stores Profile Source" }), _jsx("button", { className: isSelectedForStoresApi ? "btn-postman" : "btn-secondary btn-sm", type: "button", onClick: () => onSelectForStoresApi(capture.id), children: isSelectedForStoresApi ? "✅ Stores API Source" : "Use As Stores API Source" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => onApply(toKeyValuePairs(capture.headers), capture.label), children: "Use Captured Headers" })] })] }), tokenExpired && (_jsx("div", { style: {
                    color: "#fecaca",
                    background: "rgba(239, 68, 68, 0.14)",
                    border: "1px solid rgba(239, 68, 68, 0.28)",
                    borderRadius: 12,
                    padding: "10px 12px",
                    fontSize: 13,
                    fontWeight: 600,
                }, children: "Captured token expired. Please reload the website to capture a fresh token." })), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsxs("span", { className: "ui-pill", children: [_jsx("span", { style: { color: "#94a3b8" }, children: "Captured" }), _jsx("span", { style: { color: "#e2e8f0", fontWeight: 600 }, children: formatSavedAt(capture.capturedAt) })] }), _jsxs("span", { className: "ui-pill", children: [_jsx("span", { style: { color: "#94a3b8" }, children: "Last Seen" }), _jsx("span", { style: { color: "#e2e8f0", fontWeight: 600 }, children: formatSavedAt(capture.lastSeenAt) })] }), _jsxs("span", { className: "ui-pill", children: [_jsx("span", { style: { color: "#94a3b8" }, children: "Token Expires" }), _jsx("span", { style: { color: tokenExpired ? "#fca5a5" : "#86efac", fontWeight: 600 }, children: capture.decodedToken?.expiresAt
                                    ? formatSavedAt(capture.decodedToken.expiresAt)
                                    : "Unknown" })] })] }), _jsx(SelectableHeaderMap, { title: `${capture.label} Headers`, headers: capture.headers, capturedAt: capture.capturedAt, sourceUrl: capture.matchedUrl, applyButtonLabel: "Use Selected Headers", onApplySelected: (pairs) => onApply(pairs, capture.label) })] }));
};
const WatchRulesManager = () => {
    const { rules, isExtensionConnected, addRule, removeRule } = useArcRules();
    const [pattern, setPattern] = useState("");
    const [label, setLabel] = useState("");
    const [matchMode, setMatchMode] = useState("includes");
    const [expiryHours, setExpiryHours] = useState(48);
    const handleAdd = (e) => {
        e.preventDefault();
        if (!pattern.trim())
            return;
        addRule({
            pattern: pattern.trim(),
            label: label.trim() || pattern.trim(),
            matchMode,
            expiryHours,
        });
        setPattern("");
        setLabel("");
        setExpiryHours(48);
    };
    return (_jsxs("div", { className: "section-card", style: { padding: 18 }, children: [_jsxs("div", { style: { marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }, children: [_jsxs("div", { children: [_jsx("h3", { style: { margin: "0 0 6px 0", fontSize: 18 }, children: "Target API Watch Rules" }), _jsx("p", { style: { margin: 0, color: "#94a3b8", fontSize: 13 }, children: "Add patterns for the ARC extension to watch and automatically capture auth headers." })] }), _jsx("span", { className: "ui-pill", style: {
                            background: isExtensionConnected ? "rgba(34, 197, 94, 0.15)" : "rgba(245, 158, 11, 0.15)",
                            border: `1px solid ${isExtensionConnected ? "rgba(34, 197, 94, 0.3)" : "rgba(245, 158, 11, 0.3)"}`,
                            color: isExtensionConnected ? "#86efac" : "#fde68a",
                            fontWeight: 700,
                            whiteSpace: "nowrap",
                        }, children: isExtensionConnected ? "● Extension Connected" : "◐ Waiting For Extension" })] }), _jsxs("form", { onSubmit: handleAdd, style: { display: "grid", gap: 12, marginBottom: 20 }, children: [_jsxs("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }, children: [_jsx("input", { className: "st-input", placeholder: "URL pattern or path (e.g. /public/v1/dealers)", value: pattern, onChange: (e) => setPattern(e.target.value) }), _jsx("input", { className: "st-input", placeholder: "Label (e.g. Stores Dealer Profile)", value: label, onChange: (e) => setLabel(e.target.value) })] }), _jsxs("div", { style: { display: "flex", gap: 10 }, children: [_jsxs("select", { className: "st-input", value: matchMode, onChange: (e) => setMatchMode(e.target.value), style: { width: 160 }, children: [_jsx("option", { value: "includes", children: "Match: Contains" }), _jsx("option", { value: "exact", children: "Match: Exact URL" })] }), _jsx("input", { className: "st-input", type: "number", min: 1, value: expiryHours, onChange: (e) => setExpiryHours(Number(e.target.value)), placeholder: "Expiry (hours)", style: { width: 140 } }), _jsx("button", { type: "submit", className: "btn-postman", style: { flex: 1 }, children: "+ Add Watch Rule" })] })] }), _jsx("div", { style: { display: "grid", gap: 8 }, children: rules.length === 0 ? (_jsx("div", { style: { color: "#64748b", fontSize: 13, fontStyle: "italic" }, children: "No custom rules active. Added rules will immediately sync to the Chrome extension." })) : (rules.map((rule) => (_jsxs("div", { className: "compact-card", style: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }, children: [_jsxs("div", { style: { minWidth: 0, flex: 1, wordBreak: "break-word" }, children: [_jsx("div", { style: { color: "#f8fafc", fontWeight: 700, fontSize: 14 }, children: rule.label }), _jsx("div", { style: { color: "#94a3b8", fontSize: 12, fontFamily: "monospace" }, children: rule.pattern }), _jsxs("div", { style: { color: "#64748b", fontSize: 11, marginTop: 4 }, children: ["Mode: ", rule.matchMode, " \u2022 Expiry: ", rule.expiryHours, "h"] })] }), _jsx("button", { type: "button", className: "btn-cancel-bulk", onClick: () => removeRule(rule.id), style: { padding: "6px 12px", fontSize: 12, flexShrink: 0 }, children: "Remove" })] }, rule.id)))) })] }));
};
export const Settings = ({ onBack }) => {
    const [activeTab, setActiveTab] = useState("toc");
    const [tokens, setTokens] = useState(buildEmptyTokens());
    const [savedAtByKey, setSavedAtByKey] = useState({});
    const [hiddenByKey, setHiddenByKey] = useState(buildHiddenMap());
    const [message, setMessage] = useState(null);
    const [latestCapture, setLatestCapture] = useState(null);
    const [globalHeaders, setGlobalHeaders] = useState([]);
    const [storesCustomCaptureId, setStoresCustomCaptureId] = useState("");
    const [storesApiCaptureId, setStoresApiCaptureId] = useState("");
    const [hideSlackToken, setHideSlackToken] = useState(true);
    const [hideSlackCookie, setHideSlackCookie] = useState(true);
    const [showTocDetails, setShowTocDetails] = useState(false);
    const [savedTokensSnapshot, setSavedTokensSnapshot] = useState(buildEmptyTokens());
    const [savedGlobalHeadersSnapshot, setSavedGlobalHeadersSnapshot] = useState([]);
    const [dealerSearchQuery, setDealerSearchQuery] = useState("");
    const deferredSearchQuery = useDeferredValue(dealerSearchQuery);
    const [selectedDealerProfileId, setSelectedDealerProfileId] = useState(() => getSelectedDealerProfileId());
    const messageTimerRef = useRef(null);
    const lastFailedDecodeProfileRef = useRef(null);
    const latestStateRef = useRef({
        tokens,
        globalHeaders,
        savedTokensSnapshot,
        savedGlobalHeadersSnapshot,
    });
    useEffect(() => {
        latestStateRef.current = {
            tokens,
            globalHeaders,
            savedTokensSnapshot,
            savedGlobalHeadersSnapshot,
        };
    }, [tokens, globalHeaders, savedTokensSnapshot, savedGlobalHeadersSnapshot]);
    const tokensAreDirty = !areTokenMapsEqual(tokens, savedTokensSnapshot);
    const headersAreDirty = !arePairsEqual(globalHeaders, savedGlobalHeadersSnapshot);
    const hasUnsavedChanges = tokensAreDirty || headersAreDirty;
    const activeProfiles = useMemo(() => {
        const rawProfiles = latestCapture?.tekionProfiles ?? [];
        const now = Date.now();
        return rawProfiles.filter((p) => {
            if (!p.capturedAt)
                return false;
            return now - new Date(p.capturedAt).getTime() <= MAX_PROFILE_AGE_MS;
        });
    }, [latestCapture]);
    const customCaptures = useMemo(() => {
        return Object.values(latestCapture?.customCaptures ?? {}).sort((a, b) => {
            return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
        });
    }, [latestCapture]);
    // Find TOC API (/getuserprofile) capture
    const tocCapture = useMemo(() => {
        return (customCaptures.find((c) => {
            const pattern = (c.pattern || "").toLowerCase();
            const url = (c.matchedUrl || "").toLowerCase();
            return (pattern.includes("getuserprofile") ||
                pattern.includes("usermanagement") ||
                url.includes("getuserprofile"));
        }) || null);
    }, [customCaptures]);
    // Auto-make TOC API the default Stores API & Profile source
    useEffect(() => {
        if (tocCapture) {
            if (storesCustomCaptureId !== tocCapture.id || storesApiCaptureId !== tocCapture.id) {
                setStoresCustomCaptureId(tocCapture.id);
                setStoresApiCaptureId(tocCapture.id);
                saveTekionApiSettings({
                    storesCustomCaptureId: tocCapture.id,
                    storesApiCaptureId: tocCapture.id,
                });
                logger.info("Automatically set TOC API as default Stores capture source", {
                    id: tocCapture.id,
                    matchedUrl: tocCapture.matchedUrl,
                });
            }
        }
    }, [tocCapture, storesCustomCaptureId, storesApiCaptureId]);
    const filteredProfiles = useMemo(() => {
        if (!deferredSearchQuery.trim())
            return activeProfiles;
        const q = deferredSearchQuery.toLowerCase();
        return activeProfiles.filter((p) => p.dealerId?.toLowerCase().includes(q) ||
            p.tenantName?.toLowerCase().includes(q) ||
            p.tekSiteId?.toLowerCase().includes(q));
    }, [activeProfiles, deferredSearchQuery]);
    const showMessage = useCallback((type, text) => {
        setMessage({ type, text });
        if (messageTimerRef.current)
            window.clearTimeout(messageTimerRef.current);
        messageTimerRef.current = window.setTimeout(() => setMessage(null), 3000);
    }, []);
    const refreshFromStorage = useCallback((options) => {
        try {
            const bundle = loadTekionApiSettingsBundle();
            const nextTokens = {
                ...buildEmptyTokens(),
                tapDuoApiToken: bundle.values.tapDuoApiToken ?? "",
                graphApiToken: bundle.values.graphApiToken ?? "",
            };
            const nextGlobalHeaders = bundle.globalHeaders;
            const nextCapture = loadLatestExtensionCapture();
            setSavedAtByKey(bundle.savedAtByKey);
            setLatestCapture(nextCapture);
            setStoresCustomCaptureId(bundle.values.storesCustomCaptureId ?? "");
            setStoresApiCaptureId(bundle.values.storesApiCaptureId ?? "");
            setSavedTokensSnapshot(nextTokens);
            setSavedGlobalHeadersSnapshot(nextGlobalHeaders);
            if (!options?.preserveEdits) {
                setTokens(nextTokens);
                setGlobalHeaders(nextGlobalHeaders);
            }
        }
        catch {
            showMessage("error", "Failed to load settings from storage");
        }
    }, [showMessage]);
    useEffect(() => {
        refreshFromStorage();
        const unsubscribe = subscribeToExtensionCapture(() => {
            const current = latestStateRef.current;
            const currentDirty = !areTokenMapsEqual(current.tokens, current.savedTokensSnapshot) ||
                !arePairsEqual(current.globalHeaders, current.savedGlobalHeadersSnapshot);
            refreshFromStorage({ preserveEdits: currentDirty });
            if (currentDirty) {
                showMessage("warning", "Extension synced new capture. Unsaved edits were preserved.");
            }
            else {
                showMessage("success", "Tokens synced from extension");
            }
        });
        requestLatestCaptureFromExtension();
        return () => unsubscribe();
    }, [refreshFromStorage, showMessage]);
    const updateToken = useCallback((key, value) => setTokens((prev) => ({ ...prev, [key]: value })), []);
    const toggleHidden = useCallback((key) => setHiddenByKey((prev) => ({ ...prev, [key]: !prev[key] })), []);
    const warnings = useMemo(() => {
        return TOKEN_FIELDS.reduce((acc, field) => {
            const warning = field.validate?.(tokens[field.key] ?? "");
            if (warning)
                acc[field.key] = warning;
            return acc;
        }, {});
    }, [tokens]);
    const warningCount = Object.keys(warnings).length;
    // Blueprint Decode Bot: auto-fetch + decode Parts/Service/Accounting
    // blueprints for whichever dealer was just selected. Bridges the two
    // separate "selected dealer" identities in this app - the profile here
    // only has dealerId/tenantName, while the blueprint APIs need the
    // matching StoreRecord's tekion_id - by looking up the Stores IndexedDB
    // for a record whose dealer_id matches. Fire-and-forget: never blocks or
    // fails the header-apply action above, and stays silent if no matching
    // store is found (not every profile will have one).
    const autoDecodeBlueprintsForProfile = useCallback(async (profile) => {
        const dealerId = profile.dealerId?.trim();
        if (!dealerId)
            return;
        try {
            const stores = await getStores();
            const store = stores.find((s) => s.dealer_id === dealerId);
            if (!store?.tekion_id)
                return;
            const results = await decodeBlueprintsForDealer(store.tekion_id, ALL_BLUEPRINT_MODULES, store.dba_name);
            if (results.length === 0) {
                showMessage("warning", `No blueprint forms found for Dealer ${dealerId} (Parts/Service/Accounting).`);
                return;
            }
            await Promise.all(results.map((item) => persistBlueprintDecodeResult(store.tekion_id, dealerId, item)));
            const totalMissingRequired = results.reduce((sum, r) => sum + r.missingRequiredCount, 0);
            const moduleSummary = results
                .map((r) => `${r.module} (${r.missingRequiredCount} required missing)`)
                .join(", ");
            // Lead with actual question titles, not just a count, so you don't have
            // to separately open Blueprint Decoder to find what's missing.
            const titleHint = results
                .flatMap((r) => r.missingRequiredTitles)
                .slice(0, 5)
                .join("; ");
            showMessage(totalMissingRequired > 0 ? "warning" : "success", `Blueprint Decode Bot: decoded ${results.length} form(s) for Dealer ${dealerId} - ${moduleSummary}.` +
                (titleHint ? ` Missing: ${titleHint}${totalMissingRequired > 5 ? "…" : ""}` : ""));
            lastFailedDecodeProfileRef.current = null;
        }
        catch (err) {
            logger.warn("Blueprint Decode Bot auto-fetch failed", err);
            showMessage("warning", `Blueprint Decode Bot could not auto-fetch for Dealer ${dealerId}: ${err instanceof Error ? err.message : "unknown error"}`);
            // Remembered so a fresh extension capture (e.g. the token this failed
            // on getting re-captured) can retry automatically - see the effect
            // below - instead of requiring the dealer profile to be re-selected
            // by hand.
            lastFailedDecodeProfileRef.current = profile;
        }
    }, [showMessage]);
    // Retries the auto-decode above once new capture data comes in, but only
    // for the profile that actually failed - avoids re-decoding on every
    // unrelated token refresh.
    useEffect(() => {
        const unsubscribe = subscribeToExtensionCapture(() => {
            const pending = lastFailedDecodeProfileRef.current;
            if (!pending)
                return;
            lastFailedDecodeProfileRef.current = null;
            void autoDecodeBlueprintsForProfile(pending);
        });
        return () => unsubscribe();
    }, [autoDecodeBlueprintsForProfile]);
    /**
     * Mirrors Blueprint Decode Bot behavior for Accounting Bootstrap.
     *
     * The selected Dealer Profile is the source of truth:
     * - profile.dealerId identifies the Bootstrap tenant/dealer.
     * - profile.bootstrapHeaders authenticate the request.
     *
     * The result is saved into Bootstrap IndexedDB and then posted to
     * the existing backend validation snapshot endpoint.
     */
    const autoSyncAccountingBootstrapForProfile = useCallback(async (profile) => {
        const dealerId = profile.dealerId?.trim();
        if (!dealerId) {
            return;
        }
        const profileHeaderPairs = toKeyValuePairs(profile.bootstrapHeaders);
        const headers = profileHeaderPairs.reduce((result, pair) => {
            const key = pair.key.trim();
            const value = pair.value.trim();
            if (pair.enabled && key && value) {
                result[key] = value;
            }
            return result;
        }, {});
        if (Object.keys(headers).length === 0) {
            logger.warn("Bootstrap auto-sync skipped because selected profile has no headers", {
                dealerId,
                profileId: profile.id,
            });
            return;
        }
        try {
            const result = await syncAccountingBootstrapForDealer({
                dealerId,
                dealerName: profile.tenantName || dealerId,
                headers,
            });
            const summary = `Bootstrap synced for Dealer ${dealerId}: ` +
                `${result.bootstrap.glAccounts.length} GL account(s), ` +
                `${result.bootstrap.costCenterSetup.length} cost-center field(s), ` +
                `${result.bootstrap.journals.length} journal(s).`;
            if (result.serverWarning) {
                logger.warn("Bootstrap server snapshot warning", {
                    dealerId,
                    warning: result.serverWarning,
                });
                showMessage("warning", `${summary} Local IndexedDB save succeeded. Server warning: ${result.serverWarning}`);
                return;
            }
            showMessage("success", summary);
        }
        catch (error) {
            logger.warn("Bootstrap auto-sync failed", {
                dealerId,
                error,
            });
            showMessage("warning", `Bootstrap auto-sync failed for Dealer ${dealerId}: ${error instanceof Error ? error.message : "unknown error"}`);
        }
    }, [showMessage]);
    const handleSelectDealerProfile = useCallback((profile) => {
        const pairs = toKeyValuePairs(profile.bootstrapHeaders);
        setSelectedDealerProfileId(profile.id);
        saveSelectedDealerProfileId(profile.id);
        setGlobalHeaders(pairs);
        saveGlobalHeaders(pairs);
        showMessage("success", `Applied ${pairs.length} headers from Dealer ${profile.dealerId}`);
        // Run both automations using the currently selected dealer profile.
        // Neither blocks the UI or prevents the other workflow from finishing.
        void autoDecodeBlueprintsForProfile(profile);
        void autoSyncAccountingBootstrapForProfile(profile);
    }, [
        showMessage,
        autoDecodeBlueprintsForProfile,
        autoSyncAccountingBootstrapForProfile,
    ]);
    const handleSelectStoresProfileCapture = useCallback((captureId) => {
        setStoresCustomCaptureId(captureId);
        saveTekionApiSettings({ storesCustomCaptureId: captureId });
        showMessage("success", "Selected custom profile capture for Stores");
    }, [showMessage]);
    const handleSelectStoresApiCapture = useCallback((captureId) => {
        setStoresApiCaptureId(captureId);
        saveTekionApiSettings({ storesApiCaptureId: captureId });
        showMessage("success", "Selected direct Stores API capture");
    }, [showMessage]);
    const handleSaveAll = useCallback(() => {
        try {
            const trimmed = TOKEN_FIELDS.reduce((acc, field) => {
                acc[field.key] = (tokens[field.key] ?? "").trim();
                return acc;
            }, buildEmptyTokens());
            saveTekionApiSettings({
                ...trimmed,
                storesCustomCaptureId,
                storesApiCaptureId,
            });
            saveGlobalHeaders(globalHeaders);
            refreshFromStorage();
            if (warningCount > 0)
                showMessage("warning", "Settings saved with validation warnings");
            else
                showMessage("success", "Settings saved");
        }
        catch {
            showMessage("error", "Failed to save settings");
        }
    }, [tokens, globalHeaders, storesCustomCaptureId, storesApiCaptureId, warningCount, refreshFromStorage, showMessage]);
    const handleClearAll = useCallback(() => {
        try {
            clearTekionApiSettings();
            clearGlobalHeaders();
            setTokens(buildEmptyTokens());
            setSavedAtByKey({});
            setHiddenByKey(buildHiddenMap());
            setGlobalHeaders([]);
            setStoresCustomCaptureId("");
            setStoresApiCaptureId("");
            setSelectedDealerProfileId(null);
            clearSelectedDealerProfileId();
            refreshFromStorage();
            showMessage("success", "Settings cleared");
        }
        catch {
            showMessage("error", "Failed to clear settings");
        }
    }, [refreshFromStorage, showMessage]);
    const handleClearField = useCallback((key, title) => {
        clearTekionApiSetting(key);
        refreshFromStorage();
        showMessage("success", `${title} cleared`);
    }, [refreshFromStorage, showMessage]);
    const handleCopy = useCallback(async (value, title) => {
        const val = value.trim();
        if (!val)
            return;
        await navigator.clipboard.writeText(val);
        showMessage("success", `${title} copied`);
    }, [showMessage]);
    const handleGlobalHeadersChange = useCallback((pairs) => {
        setGlobalHeaders(pairs);
    }, []);
    const applySelectedHeadersToGlobal = useCallback((pairs, sourceLabel) => {
        setGlobalHeaders(pairs);
        saveGlobalHeaders(pairs);
        showMessage("success", `Applied ${pairs.length} selected headers from ${sourceLabel}`);
    }, [showMessage]);
    const expiredSelectedStoresCapture = useMemo(() => {
        const all = customCaptures;
        const selected = all.find((item) => item.id === storesApiCaptureId) ||
            all.find((item) => item.id === storesCustomCaptureId) ||
            null;
        return selected?.decodedToken?.isExpired === true ? selected : null;
    }, [customCaptures, storesApiCaptureId, storesCustomCaptureId]);
    const renderSidebarButton = (id, label, isDirty = false) => {
        const isActive = activeTab === id;
        return (_jsxs("button", { onClick: () => setActiveTab(id), className: `sidebar-btn ${isActive ? "active" : ""}`, children: [label, isDirty && _jsx("span", { className: "dirty-dot", title: "Unsaved changes" })] }));
    };
    const slackToken = latestCapture?.slackToken ?? "";
    const slackDCookie = latestCapture?.slackDCookie ?? "";
    const lastSlackCaptureAt = latestCapture?.lastSlackCaptureAt;
    const lastSlackSourceUrl = latestCapture?.lastSlackSourceUrl;
    const hasSlackToken = Boolean(slackToken);
    const hasSlackCookie = Boolean(slackDCookie);
    const isSlackActive = hasSlackToken && hasSlackCookie;
    const isSlackPartial = !isSlackActive && (hasSlackToken || hasSlackCookie);
    const copySlackCurlTemplate = useCallback((endpoint) => {
        const curlSnippet = endpoint === "conversations.open"
            ? `curl --url 'https://tekion.enterprise.slack.com/api/conversations.open' \\
  -H 'accept: */*' \\
  -b 'd=${encodeURIComponent(slackDCookie)}' \\
  -F 'token=${slackToken}' \\
  -F 'users=U0694AQFMGQ' \\
  -F '_x_sonic=true' \\
  -F '_x_app_name=client'`
            : `curl --url 'https://tekion.enterprise.slack.com/api/chat.postMessage' \\
  -H 'accept: */*' \\
  -b 'd=${encodeURIComponent(slackDCookie)}' \\
  -F 'token=${slackToken}' \\
  -F 'channel=D0694BGT61W' \\
  -F 'text=Hello from ARC integration' \\
  -F '_x_sonic=true' \\
  -F '_x_app_name=client'`;
        handleCopy(curlSnippet, `curl (${endpoint})`);
    }, [slackDCookie, slackToken, handleCopy]);
    return (_jsxs("div", { className: "settings-layout", children: [_jsxs("div", { className: "settings-sidebar", children: [_jsxs("div", { style: {
                            padding: "8px 16px 24px",
                            color: "#f8fafc",
                            fontWeight: 700,
                            fontSize: 16,
                            display: "flex",
                            alignItems: "center",
                        }, children: [_jsx("span", { style: { marginRight: 12, cursor: "pointer", display: "flex", alignItems: "center" }, onClick: onBack, title: "Go Back", children: _jsx("span", { style: { fontSize: 20 }, children: "\u2190" }) }), "\u2699\uFE0F Settings"] }), _jsx("div", { style: {
                            color: "#64748b",
                            fontSize: 11,
                            fontWeight: 700,
                            padding: "0 16px 8px",
                            textTransform: "uppercase",
                            letterSpacing: 0.5,
                        }, children: "Configuration" }), renderSidebarButton("toc", "🎯 TOC API (Default)"), renderSidebarButton("tokens", "🔐 API Tokens", tokensAreDirty), renderSidebarButton("slack", "💬 Slack Session"), renderSidebarButton("assignees", "👥 Assignees"), renderSidebarButton("profiles", "🏬 Dealer Profiles"), renderSidebarButton("headers", "📮 Global Headers", headersAreDirty), renderSidebarButton("extension", "🔄 Extension Data")] }), _jsxs("div", { className: "settings-main-content", children: [_jsxs("div", { className: "settings-header-bar", children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 13 }, children: hasUnsavedChanges ? "You have unsaved changes" : "✓ All changes saved" }), _jsxs("div", { style: { display: "flex", gap: 12 }, children: [_jsx(ConfirmButton, { className: "btn-cancel-bulk", baseText: "\uD83D\uDDD1 Clear All Data", confirmText: "\u26A0\uFE0F Sure?", onConfirm: handleClearAll }), _jsx("button", { className: "btn-postman", onClick: handleSaveAll, children: "\uD83D\uDCBE Save Settings" })] })] }), _jsx("div", { className: "settings-content-scroll-area", children: _jsxs("div", { className: "settings-content-inner", children: [message && _jsx("div", { className: `message-box ${message.type}`, children: message.text }), expiredSelectedStoresCapture && (_jsxs("div", { style: {
                                        marginBottom: 16,
                                        color: "#fecaca",
                                        background: "rgba(239, 68, 68, 0.14)",
                                        border: "1px solid rgba(239, 68, 68, 0.28)",
                                        borderRadius: 12,
                                        padding: "12px 14px",
                                        fontSize: 14,
                                        fontWeight: 600,
                                    }, children: ["Selected Stores token expired at ", formatSavedAt(expiredSelectedStoresCapture.decodedToken?.expiresAt), ". Please reload the website to capture a fresh token."] })), activeTab === "toc" && (_jsxs("section", { className: "section-card", children: [_jsxs("div", { style: {
                                                display: "flex",
                                                justifyContent: "space-between",
                                                alignItems: "flex-start",
                                                gap: 14,
                                                flexWrap: "wrap",
                                                marginBottom: 18,
                                            }, children: [_jsxs("div", { children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [_jsx("h2", { style: { fontSize: 22, margin: 0 }, children: "TOC API (Default Profile)" }), _jsx("span", { className: "ui-pill", style: {
                                                                        background: tocCapture
                                                                            ? "rgba(34, 197, 94, 0.15)"
                                                                            : "rgba(245, 158, 11, 0.15)",
                                                                        border: `1px solid ${tocCapture
                                                                            ? "rgba(34, 197, 94, 0.3)"
                                                                            : "rgba(245, 158, 11, 0.3)"}`,
                                                                        color: tocCapture ? "#86efac" : "#fde68a",
                                                                        fontWeight: 700,
                                                                    }, children: tocCapture ? "● Auto-Selected Default" : "○ Not Captured Yet" })] }), _jsxs("p", { style: { color: "#94a3b8", margin: "6px 0 0", fontSize: 13 }, children: ["Primary user profile endpoint: ", _jsx("code", { children: TOC_API_ENDPOINT })] })] }), _jsxs("div", { style: { display: "flex", gap: 8 }, children: [_jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => requestLatestCaptureFromExtension(), children: "\uD83D\uDD04 Re-Sync From Extension" }), tocCapture && (_jsx("button", { className: "btn-postman btn-sm", type: "button", onClick: () => setShowTocDetails((prev) => !prev), children: showTocDetails ? "Hide TOC API Data" : "Inspect TOC API Data" }))] })] }), tocCapture ? (_jsxs("div", { style: { display: "grid", gap: 14 }, children: [_jsxs("div", { className: "compact-card", style: {
                                                        background: "rgba(56, 189, 248, 0.04)",
                                                        border: "1px solid rgba(56, 189, 248, 0.25)",
                                                        display: "grid",
                                                        gap: 10,
                                                    }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsxs("div", { children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 15, fontWeight: 800 }, children: tocCapture.label || "TOC User Profile API" }), _jsx("div", { style: { color: "#94a3b8", fontSize: 12, marginTop: 2 }, children: tocCapture.matchedUrl || tocCapture.pattern })] }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => applySelectedHeadersToGlobal(toKeyValuePairs(tocCapture.headers), "TOC API"), children: "Copy All Headers to Global" })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }, children: [_jsxs("span", { className: "ui-pill", children: [_jsx("span", { style: { color: "#94a3b8" }, children: "Captured At" }), _jsx("span", { style: { color: "#e2e8f0", fontWeight: 600 }, children: formatSavedAt(tocCapture.capturedAt) })] }), _jsxs("span", { className: "ui-pill", children: [_jsx("span", { style: { color: "#94a3b8" }, children: "Last Seen" }), _jsx("span", { style: { color: "#e2e8f0", fontWeight: 600 }, children: formatSavedAt(tocCapture.lastSeenAt) })] }), _jsxs("span", { className: "ui-pill", children: [_jsx("span", { style: { color: "#94a3b8" }, children: "Token Expires" }), _jsx("span", { style: {
                                                                                color: tocCapture.decodedToken?.isExpired ? "#fca5a5" : "#86efac",
                                                                                fontWeight: 600,
                                                                            }, children: tocCapture.decodedToken?.expiresAt
                                                                                ? formatSavedAt(tocCapture.decodedToken.expiresAt)
                                                                                : "Unknown" })] })] })] }), showTocDetails && (_jsx("div", { style: { marginTop: 8 }, children: _jsx(SelectableHeaderMap, { title: "TOC API Captured Request Headers", headers: tocCapture.headers, capturedAt: tocCapture.capturedAt, sourceUrl: tocCapture.matchedUrl, applyButtonLabel: "Apply Selected Headers", onApplySelected: (pairs) => applySelectedHeadersToGlobal(pairs, "TOC API") }) }))] })) : (_jsxs("div", { className: "compact-card", style: {
                                                background: "rgba(245, 158, 11, 0.06)",
                                                border: "1px solid rgba(245, 158, 11, 0.25)",
                                                padding: 20,
                                                display: "grid",
                                                gap: 12,
                                            }, children: [_jsx("div", { style: { color: "#fde68a", fontSize: 14, fontWeight: 700 }, children: "\u26A0 TOC API has not been intercepted yet" }), _jsx("p", { style: { color: "#94a3b8", fontSize: 13, margin: 0, lineHeight: 1.6 }, children: "To automatically capture this API without manual configuration, simply open or reload TAP Workorders in another browser tab:" }), _jsx("div", { children: _jsx("a", { href: "https://tap.tekioncloud.com/workorders/list", target: "_blank", rel: "noreferrer", className: "btn-postman", style: { display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }, children: "Open TAP Workorders \u2197" }) }), _jsxs("div", { style: { color: "#64748b", fontSize: 12 }, children: ["Once opened, the ARC extension automatically captures ", _jsx("code", { children: "/tapapi/v2/usermanagement/getuserprofile" }), " and applies it as the default Stores profile."] })] }))] })), activeTab === "tokens" && (_jsxs("section", { children: [_jsxs("div", { style: { marginBottom: 20 }, children: [_jsx("h2", { style: { fontSize: 24, margin: "0 0 8px 0" }, children: "API Tokens" }), _jsx("p", { style: { color: "#94a3b8", margin: 0 }, children: "Manage credentials for your external API integrations." })] }), _jsx("div", { style: { display: "grid", gap: 16 }, children: TOKEN_FIELDS.map((field) => (_jsx(TokenCard, { config: field, value: tokens[field.key] ?? "", warning: warnings[field.key], savedAt: savedAtByKey[field.key], hidden: hiddenByKey[field.key], onUpdateToken: updateToken, onCopy: handleCopy, onClear: handleClearField, onToggleHidden: toggleHidden }, field.key))) })] })), activeTab === "slack" && (_jsxs("section", { className: "section-card", children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap", marginBottom: 18 }, children: [_jsxs("div", { children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [_jsx("h2", { style: { fontSize: 22, margin: 0 }, children: "Tekion Slack Workspace Session" }), _jsx("span", { className: "ui-pill", style: {
                                                                        background: isSlackActive
                                                                            ? "rgba(34, 197, 94, 0.15)"
                                                                            : isSlackPartial
                                                                                ? "rgba(245, 158, 11, 0.15)"
                                                                                : "rgba(239, 68, 68, 0.15)",
                                                                        border: `1px solid ${isSlackActive
                                                                            ? "rgba(34, 197, 94, 0.3)"
                                                                            : isSlackPartial
                                                                                ? "rgba(245, 158, 11, 0.3)"
                                                                                : "rgba(239, 68, 68, 0.3)"}`,
                                                                        color: isSlackActive ? "#86efac" : isSlackPartial ? "#fde68a" : "#fca5a5",
                                                                        fontWeight: 700,
                                                                    }, children: isSlackActive ? "● Active & Synced" : isSlackPartial ? "◐ Partially Detected" : "○ Not Detected" })] }), _jsx("p", { style: { color: "#94a3b8", margin: "6px 0 0", fontSize: 13 }, children: "Credentials are automatically intercepted by the ARC Helper background script whenever Slack reloads or calls an API." })] }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => requestLatestCaptureFromExtension(), children: "\uD83D\uDD04 Re-Sync From Extension" })] }), _jsxs("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }, children: [_jsxs("span", { className: "ui-pill", children: [_jsx("span", { style: { color: "#94a3b8" }, children: "Last Captured" }), _jsx("span", { style: { color: "#e2e8f0", fontWeight: 600 }, children: formatSavedAt(lastSlackCaptureAt) })] }), lastSlackSourceUrl && (_jsxs("span", { className: "ui-pill", children: [_jsx("span", { style: { color: "#94a3b8" }, children: "Source" }), _jsx("code", { className: "st-req-url", children: lastSlackSourceUrl })] }))] }), _jsxs("div", { style: { display: "grid", gap: 18 }, children: [_jsxs("div", { className: "compact-card", style: { display: "grid", gap: 10 }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsxs("div", { style: { fontWeight: 700, color: "#f8fafc", fontSize: 14 }, children: ["Slack Client Token (", _jsx("code", { children: "token" }), " / ", _jsx("code", { children: "xoxc-..." }), ")"] }), _jsxs("div", { style: { display: "flex", gap: 8 }, children: [_jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => setHideSlackToken((prev) => !prev), children: hideSlackToken ? "👁 Show" : "🙈 Hide" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => handleCopy(slackToken, "Slack Token"), disabled: !slackToken, children: "\uD83D\uDCCB Copy Token" })] })] }), _jsx(SecretTextArea, { value: slackToken, hidden: hideSlackToken, rows: 3, placeholder: "No Slack xoxc token detected yet. Open or reload your Slack tab.", onChange: () => { } })] }), _jsxs("div", { className: "compact-card", style: { display: "grid", gap: 10 }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsxs("div", { style: { fontWeight: 700, color: "#f8fafc", fontSize: 14 }, children: ["Slack Session Cookie (", _jsx("code", { children: "Cookie: d=..." }), " / ", _jsx("code", { children: "xoxd-..." }), ")"] }), _jsxs("div", { style: { display: "flex", gap: 8 }, children: [_jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => setHideSlackCookie((prev) => !prev), children: hideSlackCookie ? "👁 Show" : "🙈 Hide" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => handleCopy(slackDCookie, "Slack 'd' Cookie Value"), disabled: !slackDCookie, children: "\uD83D\uDCCB Copy Value" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => handleCopy(`Cookie: d=${encodeURIComponent(slackDCookie)}`, "Full Cookie Header"), disabled: !slackDCookie, children: "\uD83D\uDCCB Copy Header" })] })] }), _jsx(SecretTextArea, { value: slackDCookie, hidden: hideSlackCookie, rows: 3, placeholder: "No Slack 'd' cookie detected yet. Open or reload your Slack tab.", onChange: () => { } })] }), _jsxs("div", { className: "compact-card", style: { display: "grid", gap: 10 }, children: [_jsx("div", { style: { fontWeight: 700, color: "#f8fafc", fontSize: 14 }, children: "Quick Automation Templates (1-Click Copy)" }), _jsx("p", { style: { margin: 0, color: "#94a3b8", fontSize: 12 }, children: "Templates pre-populate with the captured session credentials for instant terminal testing:" }), _jsxs("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }, children: [_jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => copySlackCurlTemplate("conversations.open"), disabled: !isSlackActive, children: "\uD83D\uDCCB Copy curl: conversations.open (Get DM Channel)" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => copySlackCurlTemplate("chat.postMessage"), disabled: !isSlackActive, children: "\uD83D\uDCCB Copy curl: chat.postMessage (Send DM)" })] })] })] })] })), activeTab === "assignees" && _jsx(AssigneeSettingsPanel, {}), activeTab === "profiles" && (_jsxs("section", { className: "section-card", children: [_jsx("div", { style: { marginBottom: 16 }, children: _jsx("input", { className: "st-input", type: "text", placeholder: "Search dealer ID, tenant name, or site ID...", value: dealerSearchQuery, onChange: (e) => setDealerSearchQuery(e.target.value), style: { width: "100%" } }) }), _jsxs("div", { style: { display: "grid", gap: 16 }, children: [filteredProfiles.map((profile) => (_jsx(DealerProfileCard, { profile: profile, isSelected: selectedDealerProfileId === profile.id, onSelect: handleSelectDealerProfile }, profile.id))), filteredProfiles.length === 0 && (_jsx("div", { style: { color: "#94a3b8", textAlign: "center", padding: 20 }, children: "No dealer profiles match your search." }))] })] })), activeTab === "headers" && (_jsx("section", { className: "section-card", children: _jsx(GlobalHeadersPanel, { pairs: globalHeaders, onChange: handleGlobalHeadersChange, defaultOpen: true, title: "Unified Global Headers" }) })), activeTab === "extension" && (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 24 }, children: [_jsx(WatchRulesManager, {}), _jsxs("div", { className: "section-card", style: { padding: 18 }, children: [_jsxs("div", { style: { marginBottom: 14 }, children: [_jsx("h3", { style: { margin: "0 0 6px 0", fontSize: 18 }, children: "Custom API Captures" }), _jsx("p", { style: { margin: 0, color: "#94a3b8", fontSize: 13 }, children: "Expired token-based captures are automatically ignored. Reload the website to capture a fresh token." })] }), customCaptures.length === 0 ? (_jsx("div", { className: "compact-card", style: { color: "#94a3b8", textAlign: "center", padding: 24 }, children: "No active custom API captures found." })) : (_jsx("div", { style: { display: "grid", gap: 16 }, children: customCaptures.map((capture) => (_jsx(CustomCaptureCard, { capture: capture, isTocApi: capture.pattern.toLowerCase().includes("getuserprofile") ||
                                                            capture.matchedUrl.toLowerCase().includes("getuserprofile"), isSelectedForStoresProfile: storesCustomCaptureId === capture.id, isSelectedForStoresApi: storesApiCaptureId === capture.id, onApply: applySelectedHeadersToGlobal, onSelectForStoresProfile: handleSelectStoresProfileCapture, onSelectForStoresApi: handleSelectStoresApiCapture }, capture.id))) }))] })] }))] }) })] })] }));
};
export default Settings;
