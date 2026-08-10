import React from "react";
import { GlamSectionHeader } from "../../../components/glamShared";

const DealFeesView: React.FC = () => {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <GlamSectionHeader
        title="Deal Fees"
        description="Placeholder for Deal Fees configuration"
        breadcrumb="Accounting / Variable Operations / Payables / Deal Fees"
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
        Deal Fees configuration will be added in a separate implementation.
      </div>
    </div>
  );
};

export default DealFeesView;
