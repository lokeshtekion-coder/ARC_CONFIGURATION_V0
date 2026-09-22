import React from "react";
import { GlamSectionHeader } from "../../../components/glamShared";

const FinanceReserveView: React.FC = () => {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <GlamSectionHeader
        title="Finance Reserve"
        description="Placeholder for Finance Reserve configuration"
        breadcrumb=""
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
        Finance Reserve configuration will be added in a separate
        implementation.
      </div>
    </div>
  );
};

export default FinanceReserveView;
