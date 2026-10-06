import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
function getStatusClass(status) {
    if (status >= 200 && status < 300)
        return "status-ok";
    if (status >= 300 && status < 400)
        return "status-redirect";
    return "status-client-err";
}
function tryPretty(raw) {
    try {
        return JSON.stringify(JSON.parse(raw), null, 2);
    }
    catch {
        return raw;
    }
}
export const ResponseViewer = ({ response, loading, error }) => {
    const [tab, setTab] = useState("body");
    /* Loading */
    if (loading) {
        return (_jsxs("div", { className: "response-panel response-loading", style: { display: "flex" }, children: [_jsx("div", { className: "spinner" }), _jsx("span", { children: "Sending request\u2026" })] }));
    }
    /* Error */
    if (error) {
        return (_jsxs("div", { className: "response-panel response-error", style: { display: "flex" }, children: [_jsx("span", { className: "error-icon", children: "\u26A0" }), _jsx("pre", { className: "error-text", children: error })] }));
    }
    /* Empty */
    if (!response) {
        return (_jsxs("div", { className: "response-panel response-empty", style: { display: "flex" }, children: [_jsx("span", { className: "empty-icon", children: "\uD83D\uDCE1" }), _jsx("span", { children: "Send a request to see the response" })] }));
    }
    const headerEntries = Object.entries(response.headers);
    return (_jsxs("div", { className: "response-panel", children: [_jsxs("div", { className: "response-statusbar", children: [_jsxs("span", { className: `status-badge ${getStatusClass(response.status)}`, children: [response.status, " ", response.statusText] }), _jsxs("span", { className: "response-meta", children: ["\u23F1 ", response.duration, "ms"] }), _jsxs("span", { className: "response-meta", children: ["\uD83D\uDCE6 ", new Blob([response.body]).size, " B"] }), _jsx("div", { style: { marginLeft: "auto", display: "flex", gap: "4px" }, children: ["body", "headers", "info"].map((t) => (_jsxs("button", { className: `btn-secondary btn-sm ${tab === t ? "btn-tab-active" : ""}`, onClick: () => setTab(t), style: tab === t ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}, children: [t.charAt(0).toUpperCase() + t.slice(1), t === "headers" && (_jsxs("span", { style: { marginLeft: "4px", opacity: .6 }, children: ["(", headerEntries.length, ")"] }))] }, t))) })] }), tab === "body" && (_jsx("pre", { className: "response-body", children: tryPretty(response.body) })), tab === "headers" && (_jsx("div", { style: { overflow: "auto", flex: 1 }, children: _jsxs("table", { className: "headers-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "Header" }), _jsx("th", { children: "Value" })] }) }), _jsx("tbody", { children: headerEntries.map(([k, v]) => (_jsxs("tr", { children: [_jsx("td", { className: "header-key", children: k }), _jsx("td", { children: v })] }, k))) })] }) })), tab === "info" && (_jsxs("div", { className: "info-grid", children: [_jsxs("div", { className: "info-row", children: [_jsx("span", { children: "Status" }), _jsxs("code", { className: getStatusClass(response.status), children: [response.status, " ", response.statusText] })] }), _jsxs("div", { className: "info-row", children: [_jsx("span", { children: "Duration" }), _jsxs("code", { children: [response.duration, "ms"] })] }), _jsxs("div", { className: "info-row", children: [_jsx("span", { children: "Size" }), _jsxs("code", { children: [new Blob([response.body]).size, " bytes"] })] })] }))] }));
};
