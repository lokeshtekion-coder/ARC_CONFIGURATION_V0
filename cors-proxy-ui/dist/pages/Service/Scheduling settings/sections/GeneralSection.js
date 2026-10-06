import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
const cardStyle = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    padding: 16,
};
const GeneralSection = ({ operation, loading, running, message, generalRaw, onLoad, onExecute, }) => {
    if (operation !== "get" && operation !== "post")
        return null;
    return (_jsxs(_Fragment, { children: [_jsxs("div", { style: { ...cardStyle, display: "grid", gap: 12 }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800 }, children: "General Scheduling" }), _jsxs("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-secondary btn-sm", onClick: onLoad, disabled: loading, children: loading ? "Loading..." : "▶ Load" }), operation === "post" ? (_jsx("button", { className: "btn-primary", onClick: onExecute, disabled: running, children: running ? "Running..." : "⚙ Execute" })) : null] }), message ? (_jsx("div", { style: {
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
                        }, children: message.text })) : null] }), operation === "get" && generalRaw ? (_jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }, children: "General Scheduling Response" }), _jsx("pre", { style: {
                            margin: 0,
                            padding: 12,
                            borderRadius: 12,
                            background: "#0f172a",
                            color: "#e2e8f0",
                            overflow: "auto",
                            fontSize: 12,
                        }, children: JSON.stringify(generalRaw, null, 2) })] })) : null] }));
};
export default GeneralSection;
