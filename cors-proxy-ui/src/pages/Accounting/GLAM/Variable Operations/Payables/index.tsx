import React, { useState } from "react";
import { Arrow, GlamSectionHeader } from "../../components/glamShared";
import LienPayoffAccessoriesView from "./Lien Payoff & Accessories";
import DealFeesView from "./Deal Fees";
import DealTaxesView from "./Deal Taxes";
import VehicleSaleCommissionView from "./Vehicle Sale Commission";
import CostAdjustmentsView from "./Cost Adjustments";

type PayablesSectionKey =
  | "home"
  | "lien-payoff-accessories"
  | "deal-fees"
  | "deal-taxes"
  | "vehicle-sale-commission"
  | "cost-adjustments";

const cardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  padding: 16,
  minWidth: 0,
};

const itemButtonStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  color: "#f8fafc",
  padding: "14px 16px",
  borderRadius: 14,
  cursor: "pointer",
  textAlign: "left",
};

const PayablesHome: React.FC<{
  onOpen: (key: PayablesSectionKey) => void;
}> = ({ onOpen }) => {
  const items: Array<{
    key: PayablesSectionKey;
    title: string;
    description: string;
  }> = [
    {
      key: "lien-payoff-accessories",
      title: "Lien Payoff & Accessories",
      description: "Configure Lien Payoff and Accessories Due payable mappings.",
    },
    {
      key: "deal-fees",
      title: "Deal Fees",
      description: "Placeholder for Deal Fees configuration.",
    },
    {
      key: "deal-taxes",
      title: "Deal Taxes",
      description: "Placeholder for Deal Taxes configuration.",
    },
    {
      key: "vehicle-sale-commission",
      title: "Vehicle Sale Commission",
      description: "Placeholder for Vehicle Sale Commission configuration.",
    },
    {
      key: "cost-adjustments",
      title: "Cost Adjustments",
      description: "Placeholder for Cost Adjustments configuration.",
    },
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <GlamSectionHeader
        title="Payables"
        description="Payables configuration area"
        breadcrumb="Accounting / Variable Operations / Payables"
      />

      <div style={cardStyle}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800 }}>
            Payables Folders
          </div>
          <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>
            Select a payable mapping configuration folder to continue.
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => onOpen(item.key)}
            style={itemButtonStyle}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{
                    color: "#f8fafc",
                    fontSize: 15,
                    fontWeight: 800,
                    marginBottom: 4,
                  }}
                >
                  {item.title}
                </div>
                <div
                  style={{
                    color: "#94a3b8",
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                >
                  {item.description}
                </div>
              </div>
              <Arrow open={false} />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

const PayablesView: React.FC = () => {
  const [activeSection, setActiveSection] = useState<PayablesSectionKey>("home");

  const wrapChild = (child: React.ReactNode) => (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => setActiveSection("home")}
        >
          ← Back to Payables
        </button>
      </div>
      {child}
    </div>
  );

  if (activeSection === "lien-payoff-accessories") {
    return wrapChild(<LienPayoffAccessoriesView />);
  }

  if (activeSection === "deal-fees") {
    return wrapChild(<DealFeesView />);
  }

  if (activeSection === "deal-taxes") {
    return wrapChild(<DealTaxesView />);
  }

  if (activeSection === "vehicle-sale-commission") {
    return wrapChild(<VehicleSaleCommissionView />);
  }

  if (activeSection === "cost-adjustments") {
    return wrapChild(<CostAdjustmentsView />);
  }

  return <PayablesHome onOpen={setActiveSection} />;
};

export default PayablesView;
