import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { GlamSectionHeader } from "../../components/glamShared";
import FactoryReceivablesView from "./Factory Receivables";
import FinanceReserveView from "./Finance reserve";
const topNavigationStyle = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
};
function getNavigationButtonStyle(active) {
    return {
        border: active
            ? "1px solid rgba(96,165,250,0.75)"
            : "1px solid rgba(255,255,255,0.10)",
        background: active
            ? "rgba(59,130,246,0.18)"
            : "rgba(255,255,255,0.025)",
        color: active ? "#dbeafe" : "#cbd5e1",
        borderRadius: 10,
        padding: "10px 14px",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 800,
        transition: "all 0.15s ease",
        boxShadow: active ? "0 0 0 1px rgba(96,165,250,0.12)" : "none",
    };
}
const ReceivablesView = () => {
    const [activeSection, setActiveSection] = useState("factory-receivables");
    return (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsx(GlamSectionHeader, { title: "Receivables", description: "", breadcrumb: "Accounting / Variable Operations / Receivables" }), _jsxs("div", { style: topNavigationStyle, children: [_jsx("div", { style: {
                            color: "#94a3b8",
                            fontSize: 12,
                            fontWeight: 800,
                            marginRight: 2,
                        }, children: "RECEIVABLES:" }), _jsx("button", { type: "button", onClick: () => setActiveSection("factory-receivables"), "aria-pressed": activeSection === "factory-receivables", style: getNavigationButtonStyle(activeSection === "factory-receivables"), title: "", children: "Factory Receivables" }), _jsx("button", { type: "button", onClick: () => setActiveSection("finance-reserve"), "aria-pressed": activeSection === "finance-reserve", style: getNavigationButtonStyle(activeSection === "finance-reserve"), title: "", children: "Finance Reserve" }), _jsx("div", { style: {
                            marginLeft: "auto",
                            color: "#64748b",
                            fontSize: 12,
                            fontStyle: "italic",
                        }, children: activeSection === "factory-receivables"
                            ? "Holdback · Rebates · Incentives"
                            : "Finance Reserve configuration" })] }), activeSection === "factory-receivables" ? (_jsx(FactoryReceivablesView, {})) : (_jsx(FinanceReserveView, {}))] }));
};
export default ReceivablesView;
