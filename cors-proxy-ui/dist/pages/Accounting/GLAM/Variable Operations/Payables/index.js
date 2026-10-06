import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { GlamSectionHeader } from "../../components/glamShared";
import LienPayoffAccessoriesView from "./Lien Payoff & Accessories";
import DealFeesView from "./Deal Fees";
import DealTaxesView from "./Deal Taxes";
import VehicleSaleCommissionView from "./Vehicle Sale Commission";
import CostAdjustmentsView from "./Cost Adjustments";
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
const PayablesView = () => {
    const [activeSection, setActiveSection] = useState("lien-payoff-accessories");
    const activeLabel = activeSection === "lien-payoff-accessories"
        ? "Lien Payoff & Accessories"
        : activeSection === "deal-fees"
            ? "Deal Fees"
            : activeSection === "deal-taxes"
                ? "Deal Taxes"
                : activeSection === "vehicle-sale-commission"
                    ? "Vehicle Sale Commission"
                    : "Cost Adjustments";
    return (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsx(GlamSectionHeader, { title: "Payables", description: "Configure Variable Operations payable GL account mappings.", breadcrumb: "Accounting / Variable Operations / Payables" }), _jsxs("div", { style: topNavigationStyle, children: [_jsx("div", { style: {
                            color: "#94a3b8",
                            fontSize: 12,
                            fontWeight: 800,
                            marginRight: 2,
                        }, children: "PAYABLES:" }), _jsx("button", { type: "button", onClick: () => setActiveSection("lien-payoff-accessories"), "aria-pressed": activeSection === "lien-payoff-accessories", style: getNavigationButtonStyle(activeSection === "lien-payoff-accessories"), children: "Lien Payoff & Accessories" }), _jsx("button", { type: "button", onClick: () => setActiveSection("deal-fees"), "aria-pressed": activeSection === "deal-fees", style: getNavigationButtonStyle(activeSection === "deal-fees"), children: "Deal Fees" }), _jsx("button", { type: "button", onClick: () => setActiveSection("deal-taxes"), "aria-pressed": activeSection === "deal-taxes", style: getNavigationButtonStyle(activeSection === "deal-taxes"), children: "Deal Taxes" }), _jsx("button", { type: "button", onClick: () => setActiveSection("vehicle-sale-commission"), "aria-pressed": activeSection === "vehicle-sale-commission", style: getNavigationButtonStyle(activeSection === "vehicle-sale-commission"), children: "Vehicle Sale Commission" }), _jsx("button", { type: "button", onClick: () => setActiveSection("cost-adjustments"), "aria-pressed": activeSection === "cost-adjustments", style: getNavigationButtonStyle(activeSection === "cost-adjustments"), children: "Cost Adjustments" }), _jsx("div", { style: {
                            marginLeft: "auto",
                            color: "#64748b",
                            fontSize: 12,
                            fontStyle: "italic",
                        }, children: activeLabel })] }), activeSection === "lien-payoff-accessories" ? (_jsx(LienPayoffAccessoriesView, {})) : null, activeSection === "deal-fees" ? _jsx(DealFeesView, {}) : null, activeSection === "deal-taxes" ? _jsx(DealTaxesView, {}) : null, activeSection === "vehicle-sale-commission" ? (_jsx(VehicleSaleCommissionView, {})) : null, activeSection === "cost-adjustments" ? (_jsx(CostAdjustmentsView, {})) : null] }));
};
export default PayablesView;
