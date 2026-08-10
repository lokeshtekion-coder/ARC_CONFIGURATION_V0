import React, { useState } from "react";
import { Arrow, GlamSectionHeader } from "../../components/glamShared";
import FactoryReceivablesView from "./Factory Receivables";
import FinanceReserveView from "./Finance reserve";

type ReceivablesSectionKey = "home" | "factory-receivables" | "finance-reserve";

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

const ReceivablesHome: React.FC<{
  onOpen: (key: ReceivablesSectionKey) => void;
}> = ({ onOpen }) => {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <GlamSectionHeader
        title="Receivables"
        description="Receivables configuration area"
        breadcrumb="Accounting / Variable Operations / Receivables"
      />

      <div style={cardStyle}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800 }}>
            Receivables Folders
          </div>
          <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>
            Select a receivables configuration folder to continue.
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        <button
          type="button"
          onClick={() => onOpen("factory-receivables")}
          style={itemButtonStyle}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ color: "#f8fafc", fontSize: 15, fontWeight: 800, marginBottom: 4 }}>
                Factory Receivables
              </div>
              <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>
                Configure Holdback, Rebates, and Incentives factory receivable GL mappings.
              </div>
            </div>
            <Arrow open={false} />
          </div>
        </button>

        <button
          type="button"
          onClick={() => onOpen("finance-reserve")}
          style={itemButtonStyle}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ color: "#f8fafc", fontSize: 15, fontWeight: 800, marginBottom: 4 }}>
                Finance reserve
              </div>
              <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>
                Placeholder for future Finance reserve configuration.
              </div>
            </div>
            <Arrow open={false} />
          </div>
        </button>
      </div>
    </div>
  );
};

const ReceivablesView: React.FC = () => {
  const [activeSection, setActiveSection] = useState<ReceivablesSectionKey>("home");

  if (activeSection === "factory-receivables") {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setActiveSection("home")}
          >
            ← Back to Receivables
          </button>
        </div>
        <FactoryReceivablesView />
      </div>
    );
  }

  if (activeSection === "finance-reserve") {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setActiveSection("home")}
          >
            ← Back to Receivables
          </button>
        </div>
        <FinanceReserveView />
      </div>
    );
  }

  return <ReceivablesHome onOpen={setActiveSection} />;
};

export default ReceivablesView;
