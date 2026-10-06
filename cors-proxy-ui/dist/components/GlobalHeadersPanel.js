import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
const TEKION_HEADERS = new Set([
    "accept",
    "accept-language",
    "applicationid",
    "cache-control",
    "clientid",
    "content-type",
    "dealerid",
    "dnt",
    "flattenedaecprogramsmap",
    "locale",
    "oemid",
    "original-tenantid",
    "pragma",
    "productids",
    "program",
    "roleid",
    "subapplicationid",
    "tek-siteid",
    "tekion-api-token",
    "tenantname",
]);
function decodeToken(token) {
    try {
        const part = token.split(".")[1];
        if (!part)
            return null;
        const payload = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/")));
        const now = Date.now() / 1000;
        const isExpired = now > payload.exp;
        return {
            exp: payload.exp,
            iat: payload.iat,
            email: payload.email ?? "",
            tenantId: payload.originalTenantId ?? "",
            isExpired,
            isExpiringSoon: !isExpired && payload.exp - now < 300,
        };
    }
    catch {
        return null;
    }
}
function formatTimeLeft(exp) {
    const diff = exp - Date.now() / 1000;
    const abs = Math.abs(diff);
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    const s = Math.floor(abs % 60);
    const str = [h ? `${h}h` : "", `${m}m`, `${s}s`]
        .filter(Boolean)
        .join(" ");
    return diff < 0 ? `Expired ${str} ago` : `${str} remaining`;
}
function parseBulk(raw) {
    const trimmed = raw.trim();
    let rows = [];
    if (trimmed.startsWith("{")) {
        try {
            const obj = JSON.parse(trimmed);
            rows = Object.entries(obj).map(([k, v]) => ({
                key: k.toLowerCase(),
                value: String(v),
            }));
        }
        catch {
            // fall through
        }
    }
    if (rows.length === 0) {
        rows = trimmed
            .split("\n")
            .filter((line) => line.includes(":"))
            .map((line) => {
            const idx = line.indexOf(":");
            return {
                key: line.slice(0, idx).trim().toLowerCase(),
                value: line.slice(idx + 1).trim(),
            };
        })
            .filter((row) => row.key.length > 0);
    }
    return rows
        .filter((row) => TEKION_HEADERS.has(row.key))
        .map((row) => ({
        key: row.key,
        value: row.value,
        enabled: true,
    }));
}
export const GlobalHeadersPanel = ({ pairs, onChange, defaultOpen = false, title = "Global Headers", }) => {
    const [open, setOpen] = useState(defaultOpen);
    const [mode, setMode] = useState("table");
    const [bulkText, setBulkText] = useState("");
    const [bulkError, setBulkError] = useState("");
    const [, setTick] = useState(0);
    const tokenValue = pairs.find((pair) => pair.key.toLowerCase() === "tekion-api-token")?.value ?? "";
    const tokenMeta = tokenValue ? decodeToken(tokenValue) : null;
    const timeLeft = tokenMeta ? formatTimeLeft(tokenMeta.exp) : null;
    const activeCount = pairs.filter((pair) => pair.enabled && pair.key.trim()).length;
    useEffect(() => {
        if (!tokenValue)
            return;
        const id = window.setInterval(() => setTick((t) => t + 1), 1000);
        return () => window.clearInterval(id);
    }, [tokenValue]);
    const applyBulk = () => {
        if (!bulkText.trim()) {
            setBulkError("Nothing to parse.");
            return;
        }
        const parsed = parseBulk(bulkText);
        if (!parsed.length) {
            setBulkError("No Tekion headers found. Check format.");
            return;
        }
        onChange(parsed);
        setBulkText("");
        setBulkError("");
        setMode("table");
    };
    const updateRow = (index, field, value) => {
        onChange(pairs.map((pair, idx) => idx === index ? { ...pair, [field]: value } : pair));
    };
    const removeRow = (index) => {
        onChange(pairs.filter((_, idx) => idx !== index));
    };
    return (_jsxs("div", { className: "gh-root", children: [_jsxs("button", { className: "gh-strip", onClick: () => setOpen((prev) => !prev), children: [_jsxs("div", { className: "gh-strip-left", children: [_jsx("span", { className: "gh-icon", children: "\uD83D\uDD11" }), _jsx("span", { className: "gh-label", children: title }), _jsxs("span", { className: "gh-badge-count", children: [activeCount, " active"] }), tokenMeta && (_jsx("span", { className: `gh-token-pill ${tokenMeta.isExpired
                                    ? "pill-red"
                                    : tokenMeta.isExpiringSoon
                                        ? "pill-orange"
                                        : "pill-green"}`, children: tokenMeta.isExpired
                                    ? `⛔ ${timeLeft}`
                                    : tokenMeta.isExpiringSoon
                                        ? `⚠ ${timeLeft}`
                                        : `✓ ${timeLeft}` })), !tokenMeta && pairs.length === 0 && (_jsx("span", { className: "gh-token-pill pill-muted", children: "Paste once \u2014 auto-applied to every request" }))] }), _jsx("span", { className: "gh-chevron", children: open ? "▲" : "▼" })] }), open && (_jsxs("div", { className: "gh-body", children: [tokenMeta && (_jsxs("div", { className: `gh-token-card ${tokenMeta.isExpired
                            ? "tc-expired"
                            : tokenMeta.isExpiringSoon
                                ? "tc-soon"
                                : "tc-ok"}`, children: [_jsxs("div", { className: "gh-tc-header", children: [_jsx("span", { children: "\uD83D\uDD10 tekion-api-token" }), _jsx("span", { className: tokenMeta.isExpired
                                            ? "color-red"
                                            : tokenMeta.isExpiringSoon
                                                ? "color-orange"
                                                : "color-green", children: tokenMeta.isExpired
                                            ? "EXPIRED"
                                            : tokenMeta.isExpiringSoon
                                                ? "EXPIRING SOON"
                                                : "VALID" })] }), _jsxs("div", { className: "gh-tc-grid", children: [_jsxs("div", { className: "gh-tc-row", children: [_jsx("span", { children: "\u23F1 Time Left" }), _jsx("code", { className: tokenMeta.isExpired
                                                    ? "color-red"
                                                    : tokenMeta.isExpiringSoon
                                                        ? "color-orange"
                                                        : "color-green", children: timeLeft })] }), tokenMeta.email && (_jsxs("div", { className: "gh-tc-row", children: [_jsx("span", { children: "\u2709 Email" }), _jsx("code", { children: tokenMeta.email })] })), tokenMeta.tenantId && (_jsxs("div", { className: "gh-tc-row", children: [_jsx("span", { children: "\uD83C\uDFE2 Tenant" }), _jsx("code", { children: tokenMeta.tenantId })] })), _jsxs("div", { className: "gh-tc-row", children: [_jsx("span", { children: "\uD83D\uDCC5 Issued" }), _jsx("code", { children: new Date(tokenMeta.iat * 1000).toLocaleString() })] }), _jsxs("div", { className: "gh-tc-row", children: [_jsx("span", { children: "\uD83D\uDCC5 Expires" }), _jsx("code", { children: new Date(tokenMeta.exp * 1000).toLocaleString() })] })] })] })), _jsxs("div", { className: "gh-mode-bar", children: [_jsxs("div", { className: "kv-mode-tabs", children: [_jsx("button", { className: `kv-mode-btn ${mode === "table" ? "kv-mode-active" : ""}`, onClick: () => setMode("table"), children: "Edit" }), _jsx("button", { className: `kv-mode-btn ${mode === "bulk" ? "kv-mode-active" : ""}`, onClick: () => {
                                            setMode("bulk");
                                            setBulkError("");
                                        }, children: "Bulk Paste" })] }), _jsx("button", { className: "gh-clear", onClick: () => onChange([]), children: "\u2715 Clear All" })] }), mode === "table" && (_jsx("div", { className: "gh-rows", children: pairs.length === 0 ? (_jsxs("div", { className: "gh-empty-hint", children: [_jsx("span", { children: "\uD83D\uDCCB" }), _jsxs("span", { children: ["Use ", _jsx("strong", { children: "Bulk Paste" }), " \u2014 paste headers from Chrome DevTools. Sec-*, origin, user-agent are auto-stripped."] })] })) : (pairs.map((pair, index) => (_jsxs("div", { className: "kv-row", children: [_jsx("input", { type: "checkbox", checked: pair.enabled, onChange: (e) => updateRow(index, "enabled", e.target.checked), className: "kv-check" }), _jsx("input", { type: "text", value: pair.key, onChange: (e) => updateRow(index, "key", e.target.value), className: "kv-input gh-key-input" }), _jsx("input", { type: pair.key === "tekion-api-token" ? "password" : "text", value: pair.value, onChange: (e) => updateRow(index, "value", e.target.value), className: "kv-input", placeholder: "value" }), _jsx("button", { onClick: () => removeRow(index), className: "kv-remove", title: "Remove", children: "\u2715" })] }, index)))) })), mode === "bulk" && (_jsxs("div", { className: "bulk-editor", children: [_jsxs("div", { className: "bulk-hint", children: ["Paste raw headers from Chrome DevTools \u2192 Network \u2192 any request \u2192 Request Headers.", _jsx("br", {}), _jsx("strong", { children: "sec-*, origin, user-agent" }), " are auto-stripped. Only Tekion headers are kept."] }), _jsx("textarea", { className: "bulk-textarea", value: bulkText, onChange: (e) => {
                                    setBulkText(e.target.value);
                                    setBulkError("");
                                }, placeholder: "tekion-api-token: eyJhbG...\ndealerid: 7270\napplicationid: ARC_NA\nclientid: web\nlocale: en_US\n...", rows: 14, spellCheck: false, autoFocus: true }), bulkError && _jsxs("div", { className: "bulk-error", children: ["\u26A0 ", bulkError] }), _jsxs("div", { className: "bulk-actions", children: [_jsx("button", { onClick: applyBulk, className: "btn-apply", children: "\u2713 Apply Headers" }), _jsx("button", { onClick: () => {
                                            setMode("table");
                                            setBulkError("");
                                        }, className: "btn-cancel-bulk", children: "Cancel" }), _jsx("button", { onClick: () => setBulkText(""), className: "btn-clear-bulk", children: "Clear" })] })] }))] }))] }));
};
