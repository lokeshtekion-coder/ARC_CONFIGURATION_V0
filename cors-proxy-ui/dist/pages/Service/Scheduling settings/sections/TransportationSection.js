import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
const cardStyle = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    padding: 16,
};
const TransportationSection = ({ operation, loading, running, message, rows, result, onLoad, onExecute, }) => {
    // Track whether this is the initial load when the user opened the section
    const isFirstRender = useRef(true);
    useEffect(() => {
        // Skip the automatic trigger on mount
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        // Only triggers when the user actively clicks GET or CONFIGURE
        if (operation === "get") {
            onLoad();
        }
        else if (operation === "configure") {
            onExecute();
        }
    }, [operation]);
    if (operation !== "get" && operation !== "configure")
        return null;
    const isActive = loading || running;
    const statusText = loading
        ? "Fetching transportation types..."
        : running
            ? "Fetching and auto-configuring..."
            : null;
    return (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsxs("div", { style: { ...cardStyle, display: "grid", gap: 12 }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800 }, children: operation === "get" ? "Transportation Types" : "Auto-Configuration" }), isActive && (_jsx("span", { style: { color: "#94a3b8", fontSize: 13, fontStyle: "italic" }, children: statusText }))] }), message && (_jsx("div", { style: {
                            borderRadius: 12,
                            padding: "10px 12px",
                            fontSize: 13,
                            color: message.ok ? "#bbf7d0" : "#fecaca",
                            background: message.ok
                                ? "rgba(34,197,94,0.10)"
                                : "rgba(239,68,68,0.10)",
                            border: message.ok
                                ? "1px solid rgba(34,197,94,0.22)"
                                : "1px solid rgba(239,68,68,0.22)",
                        }, children: message.text }))] }), rows.length > 0 && (_jsxs("div", { style: { ...cardStyle, display: "grid", gap: 10 }, children: [_jsxs("div", { style: { color: "#f8fafc", fontSize: 15, fontWeight: 700 }, children: ["Configured Types (", rows.length, ")"] }), rows.map((row, index) => (_jsx("div", { style: {
                            borderRadius: 12,
                            border: "1px solid rgba(255,255,255,0.06)",
                            background: "rgba(255,255,255,0.02)",
                            padding: "12px 14px",
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            flexWrap: "wrap",
                        }, children: _jsxs("div", { children: [_jsx("div", { style: { color: "#f8fafc", fontWeight: 700 }, children: row.displayName || row.transportationType || "Unknown" }), _jsxs("div", { style: { color: "#94a3b8", fontSize: 12, marginTop: 4 }, children: ["Type: ", row.transportationType || "—", " \u00B7 ID: ", row.id || "—"] })] }) }, `${row.id || row.transportationType || "transport"}-${index}`)))] })), operation === "configure" && result && (_jsxs("div", { style: cardStyle, children: [_jsx("div", { style: {
                            color: "#f8fafc",
                            fontSize: 15,
                            fontWeight: 700,
                            marginBottom: 12,
                        }, children: "Execution Results" }), _jsx("div", { style: { display: "grid", gap: 8 }, children: result.map((row, idx) => (_jsxs("div", { style: {
                                borderRadius: 12,
                                border: row.ok
                                    ? "1px solid rgba(34,197,94,0.18)"
                                    : "1px solid rgba(239,68,68,0.18)",
                                background: row.ok
                                    ? "rgba(34,197,94,0.06)"
                                    : "rgba(239,68,68,0.06)",
                                padding: "10px 12px",
                                color: row.ok ? "#bbf7d0" : "#fecaca",
                                fontSize: 13,
                            }, children: [_jsx("b", { children: row.name }), " \u2014 ", row.text] }, `${row.name}-${idx}`))) })] }))] }));
};
export default TransportationSection;
