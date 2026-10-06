import React from "react";
import type { OnboardingStatus } from "../../services/storeOnboardingStatusApi";
import type { CustomPhaseStatus } from "../../services/storesDb";
import type { ExtendedStoreRecord } from "../Stores";
import { sanitizeSetupError } from "../../services/storeSetupDataService";

function getStatusVisual(status: OnboardingStatus) {
  if (status === "COMPLETED") {
    return { symbol: "✓", background: "rgba(34, 197, 94, 0.16)", color: "#22c55e", border: "rgba(34, 197, 94, 0.30)", label: "Completed" };
  }
  if (status === "IN_PROGRESS") {
    return { symbol: "⏳", background: "rgba(245, 158, 11, 0.16)", color: "#f59e0b", border: "rgba(245, 158, 11, 0.30)", label: "In Progress" };
  }
  return { symbol: "○", background: "rgba(148, 163, 184, 0.14)", color: "#94a3b8", border: "rgba(148, 163, 184, 0.24)", label: status === "NOT_YET_STARTED" ? "Not Yet Started" : "Unknown" };
}

export const StatusChip: React.FC<{ short: string; fullName: string; status: OnboardingStatus }> = ({ short, fullName, status }) => {
  const visual = getStatusVisual(status);
  return (
    <span
      title={`${fullName}: ${visual.label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        padding: "3px 6px",
        borderRadius: 6,
        background: visual.background,
        color: visual.color,
        border: `1px solid ${visual.border}`,
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <span>{short}</span>
      <span style={{ fontSize: 9 }}>{visual.symbol}</span>
    </span>
  );
};

export const StatusChipGroup: React.FC<{ items: Array<{ short: string; fullName: string; status: OnboardingStatus }> }> = ({ items }) => (
  <div style={{ display: "inline-flex", gap: 4, flexWrap: "nowrap", alignItems: "center" }}>
    {items.map((item) => (
      <StatusChip key={item.fullName} short={item.short} fullName={item.fullName} status={item.status} />
    ))}
  </div>
);

export const UnifiedMetricChip: React.FC<{
  label: string;
  value: string | number;
  variant?: "primary" | "secondary" | "success" | "warn";
  title?: string;
}> = ({ label, value, variant = "primary", title }) => {
  const styles = {
    primary: { bg: "rgba(56, 189, 248, 0.12)", text: "#38bdf8", border: "rgba(56, 189, 248, 0.28)" },
    secondary: { bg: "rgba(192, 132, 252, 0.12)", text: "#c084fc", border: "rgba(192, 132, 252, 0.28)" },
    success: { bg: "rgba(74, 222, 128, 0.12)", text: "#4ade80", border: "rgba(74, 222, 128, 0.28)" },
    warn: { bg: "rgba(248, 113, 113, 0.12)", text: "#f87171", border: "rgba(248, 113, 113, 0.28)" },
  }[variant];

  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 6px",
        borderRadius: 4,
        background: styles.bg,
        color: styles.text,
        border: `1px solid ${styles.border}`,
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1.2,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ opacity: 0.8, fontSize: 9 }}>{label}</span>
      <span>{value}</span>
    </span>
  );
};

export const SetupDataCell: React.FC<{ row: ExtendedStoreRecord }> = ({ row }) => {
  const mapData = row.preprod_validation;
  const rawError = row.setup_data_error;

  // 1. If Setup Data has an error
  if (rawError) {
    const cleanError = sanitizeSetupError(rawError);

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 170 }}>
        <span
          title={rawError}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 6px",
            borderRadius: 4,
            background: "rgba(239, 68, 68, 0.14)",
            color: "#f87171",
            border: "1px solid rgba(239, 68, 68, 0.30)",
            fontSize: 10,
            fontWeight: 700,
            whiteSpace: "nowrap",
            width: "fit-content",
            cursor: "help",
          }}
        >
          <span>⚠</span>
          <span>{cleanError}</span>
        </span>

        {/* Unified 2nd Automation Fallback Chips */}
        {mapData && (
          <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
            <UnifiedMetricChip
              label="MAP"
              value={mapData.isValidTenant ? "✓ Active" : "Invalid"}
              variant={mapData.isValidTenant ? "success" : "warn"}
              title={`Tenant: ${mapData.tenantName || "—"}`}
            />
            {mapData.employeeCount && mapData.employeeCount !== "—" && (
              <UnifiedMetricChip
                label="EMP"
                value={Number(mapData.employeeCount).toLocaleString()}
                variant="primary"
                title={`Employees: ${mapData.employeeCount}`}
              />
            )}
            {mapData.accountNumberCount !== undefined && (
              <UnifiedMetricChip
                label="ACCTS"
                value={mapData.accountNumberCount.toLocaleString()}
                variant="secondary"
                title={`acct_dms_account_number records: ${mapData.accountNumberCount}`}
              />
            )}
          </div>
        )}
      </div>
    );
  }

  // 2. Setup Data not yet fetched
  if (!row.setup_data) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 140 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "2px 6px",
            borderRadius: 4,
            background: "rgba(148, 163, 184, 0.10)",
            color: "#64748b",
            border: "1px solid rgba(148, 163, 184, 0.20)",
            fontSize: 10,
            fontWeight: 600,
            width: "fit-content",
          }}
        >
          — Not Fetched
        </span>

        {mapData && (
          <div style={{ display: "inline-flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
            <UnifiedMetricChip
              label="MAP"
              value={mapData.isValidTenant ? "✓ Active" : "Invalid"}
              variant={mapData.isValidTenant ? "success" : "warn"}
            />
            {mapData.accountNumberCount !== undefined && (
              <UnifiedMetricChip
                label="ACCTS"
                value={mapData.accountNumberCount.toLocaleString()}
                variant="secondary"
              />
            )}
          </div>
        )}
      </div>
    );
  }

  // 3. Normal successful setup data
  const oemCodes = row.setup_data.oemDealerCodes || [];
  const hasOem = oemCodes.length > 0;
  const firstCode = oemCodes[0] || "—";
  const oemDisplay = oemCodes.length > 1 ? `${firstCode} (+${oemCodes.length - 1})` : firstCode;
  const oemFull = hasOem ? oemCodes.join(", ") : "None";

  const journalsCount = row.setup_data.journalsAccessibleDealerCount ?? 0;
  const salesChainsCount = row.setup_data.salesChainsAccessibleDealerCount ?? 0;
  const coaCount = row.setup_data.coaAccessibleDealerCount ?? 0;

  return (
    <div style={{ display: "inline-flex", gap: 4, flexWrap: "nowrap", alignItems: "center" }}>
      <UnifiedMetricChip label="OEM" value={oemDisplay} variant={hasOem ? "primary" : "secondary"} title={`OEM: ${oemFull}`} />
      <UnifiedMetricChip label="JRN" value={journalsCount} variant={journalsCount > 0 ? "primary" : "secondary"} title={`Journals: ${journalsCount}`} />
      <UnifiedMetricChip label="SC" value={salesChainsCount} variant={salesChainsCount > 0 ? "primary" : "secondary"} title={`Sales Chains: ${salesChainsCount}`} />
      <UnifiedMetricChip label="COA" value={coaCount} variant={coaCount > 0 ? "primary" : "secondary"} title={`COA: ${coaCount}`} />
    </div>
  );
};

export const CustomStatusSelect: React.FC<{
  value?: CustomPhaseStatus;
  onChange: (newVal: CustomPhaseStatus) => void;
}> = ({ value, onChange }) => {
  const currentVal = value || "TO DO";
  const colors = {
    "TO DO": { bg: "rgba(148, 163, 184, 0.14)", text: "#94a3b8", border: "rgba(148, 163, 184, 0.24)" },
    WIP: { bg: "rgba(245, 158, 11, 0.16)", text: "#f59e0b", border: "rgba(245, 158, 11, 0.30)" },
    Completed: { bg: "rgba(34, 197, 94, 0.16)", text: "#22c55e", border: "rgba(34, 197, 94, 0.30)" },
  } as const;

  const style = colors[currentVal as keyof typeof colors] || colors["TO DO"];

  return (
    <div style={{ position: "relative", display: "inline-block", width: 110, minWidth: 110 }}>
      <select
        value={currentVal}
        onChange={(e) => onChange(e.target.value as CustomPhaseStatus)}
        style={{
          width: "100%",
          minWidth: 110,
          background: style.bg,
          color: style.text,
          border: `1px solid ${style.border}`,
          borderRadius: 8,
          padding: "5px 22px 5px 8px",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          appearance: "none",
        }}
      >
        <option value="TO DO">TO DO</option>
        <option value="WIP">WIP</option>
        <option value="Completed">Completed</option>
      </select>
      <span
        style={{
          position: "absolute",
          right: 8,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
          fontSize: 8,
          color: style.text,
        }}
      >
        ▼
      </span>
    </div>
  );
};