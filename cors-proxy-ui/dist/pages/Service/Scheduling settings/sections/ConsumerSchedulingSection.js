import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { renderBoolToneStyles } from "../utils";
const cardStyle = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    padding: 16,
    display: "grid",
    gap: 12,
};
const ConsumerSchedulingSection = ({ operation, loading, running, message, consumerSettings, onLoad, onExecute, }) => {
    if (operation !== "get" && operation !== "put")
        return null;
    return (_jsxs(_Fragment, { children: [_jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800 }, children: "Consumer Scheduling Settings" }), _jsxs("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-secondary btn-sm", onClick: onLoad, disabled: loading, children: loading ? "Loading..." : "▶ Load" }), operation === "put" ? (_jsx("button", { className: "btn-primary", onClick: onExecute, disabled: running, children: running ? "Running..." : "⚙ Auto Configure" })) : null] }), message ? (_jsx("div", { style: {
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
                        }, children: message.text })) : null] }), consumerSettings ? (_jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800 }, children: "Current Consumer Scheduling Values" }), _jsxs("div", { style: { display: "grid", gap: 10 }, children: [_jsxs("div", { style: {
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    borderRadius: 12,
                                    padding: "12px 14px",
                                    background: "rgba(255,255,255,0.02)",
                                    border: "1px solid rgba(255,255,255,0.06)",
                                }, children: [_jsx("span", { style: { color: "#e2e8f0" }, children: "Allow to Remove Vehicle" }), _jsx("span", { style: renderBoolToneStyles(Boolean(consumerSettings?.data?.allowToRemoveVehicle)), children: consumerSettings?.data?.allowToRemoveVehicle ? "Enabled" : "Disabled" })] }), _jsxs("div", { style: {
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    borderRadius: 12,
                                    padding: "12px 14px",
                                    background: "rgba(255,255,255,0.02)",
                                    border: "1px solid rgba(255,255,255,0.06)",
                                }, children: [_jsx("span", { style: { color: "#e2e8f0" }, children: "Allow Customer to Add VIN" }), _jsx("span", { style: renderBoolToneStyles(Boolean(consumerSettings?.data?.allowCustomerToAddVin)), children: consumerSettings?.data?.allowCustomerToAddVin ? "Enabled" : "Disabled" })] })] })] })) : null] }));
};
export default ConsumerSchedulingSection;
