import React from "react";
import { GlamSectionHeader } from "../../../components/glamShared";

const VehicleSaleCommissionView: React.FC = () => {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <GlamSectionHeader
        title="Vehicle Sale Commission"
        description="Placeholder for Vehicle Sale Commission configuration"
        breadcrumb="Accounting / Variable Operations / Payables / Vehicle Sale Commission"
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
        Vehicle Sale Commission configuration will be added in a separate implementation.
      </div>
    </div>
  );
};

export default VehicleSaleCommissionView;
