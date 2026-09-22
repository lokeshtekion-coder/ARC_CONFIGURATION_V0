import React, { useState } from "react";
import { GlamSectionHeader } from "../../components/glamShared";
import LienPayoffAccessoriesView from "./Lien Payoff & Accessories";
import DealFeesView from "./Deal Fees";
import DealTaxesView from "./Deal Taxes";
import VehicleSaleCommissionView from "./Vehicle Sale Commission";
import CostAdjustmentsView from "./Cost Adjustments";

type PayablesSectionKey =
  | "lien-payoff-accessories"
  | "deal-fees"
  | "deal-taxes"
  | "vehicle-sale-commission"
  | "cost-adjustments";

const topNavigationStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
};

function getNavigationButtonStyle(active: boolean): React.CSSProperties {
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

const PayablesView: React.FC = () => {
  const [activeSection, setActiveSection] =
    useState<PayablesSectionKey>("lien-payoff-accessories");

  const activeLabel =
    activeSection === "lien-payoff-accessories"
      ? "Lien Payoff & Accessories"
      : activeSection === "deal-fees"
        ? "Deal Fees"
        : activeSection === "deal-taxes"
          ? "Deal Taxes"
          : activeSection === "vehicle-sale-commission"
            ? "Vehicle Sale Commission"
            : "Cost Adjustments";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <GlamSectionHeader
        title="Payables"
        description="Configure Variable Operations payable GL account mappings."
        breadcrumb="Accounting / Variable Operations / Payables"
      />

      <div style={topNavigationStyle}>
        <div
          style={{
            color: "#94a3b8",
            fontSize: 12,
            fontWeight: 800,
            marginRight: 2,
          }}
        >
          PAYABLES:
        </div>

        <button
          type="button"
          onClick={() => setActiveSection("lien-payoff-accessories")}
          aria-pressed={activeSection === "lien-payoff-accessories"}
          style={getNavigationButtonStyle(
            activeSection === "lien-payoff-accessories"
          )}
        >
          Lien Payoff & Accessories
        </button>

        <button
          type="button"
          onClick={() => setActiveSection("deal-fees")}
          aria-pressed={activeSection === "deal-fees"}
          style={getNavigationButtonStyle(activeSection === "deal-fees")}
        >
          Deal Fees
        </button>

        <button
          type="button"
          onClick={() => setActiveSection("deal-taxes")}
          aria-pressed={activeSection === "deal-taxes"}
          style={getNavigationButtonStyle(activeSection === "deal-taxes")}
        >
          Deal Taxes
        </button>

        <button
          type="button"
          onClick={() => setActiveSection("vehicle-sale-commission")}
          aria-pressed={activeSection === "vehicle-sale-commission"}
          style={getNavigationButtonStyle(
            activeSection === "vehicle-sale-commission"
          )}
        >
          Vehicle Sale Commission
        </button>

        <button
          type="button"
          onClick={() => setActiveSection("cost-adjustments")}
          aria-pressed={activeSection === "cost-adjustments"}
          style={getNavigationButtonStyle(activeSection === "cost-adjustments")}
        >
          Cost Adjustments
        </button>

        <div
          style={{
            marginLeft: "auto",
            color: "#64748b",
            fontSize: 12,
            fontStyle: "italic",
          }}
        >
          {activeLabel}
        </div>
      </div>

      {activeSection === "lien-payoff-accessories" ? (
        <LienPayoffAccessoriesView />
      ) : null}

      {activeSection === "deal-fees" ? <DealFeesView /> : null}

      {activeSection === "deal-taxes" ? <DealTaxesView /> : null}

      {activeSection === "vehicle-sale-commission" ? (
        <VehicleSaleCommissionView />
      ) : null}

      {activeSection === "cost-adjustments" ? (
        <CostAdjustmentsView />
      ) : null}
    </div>
  );
};

export default PayablesView;
