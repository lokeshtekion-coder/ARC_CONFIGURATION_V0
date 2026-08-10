import React from "react";
import { GlamSectionHeader } from "../../../components/glamShared";

const CostAdjustmentsView: React.FC = () => {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <GlamSectionHeader
        title="Cost Adjustments"
        description="Placeholder for Cost Adjustments configuration"
        breadcrumb="Accounting / Variable Operations / Payables / Cost Adjustments"
      />
      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.02)",
          padding: 16,
          color: "#cbd5e1",
          fontSize: 14,
        }}
      >
        Cost Adjustments configuration will be added in a separate implementation.
      </div>
    </div>
  );
};

export default CostAdjustmentsView;
