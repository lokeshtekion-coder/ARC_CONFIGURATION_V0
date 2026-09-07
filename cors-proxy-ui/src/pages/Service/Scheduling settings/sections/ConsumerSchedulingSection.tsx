import React from "react";
import type { ConsumerSchedulingResponse, OperationKey, UiMessage } from "../types";
import { renderBoolToneStyles } from "../utils";

type Props = {
  operation: OperationKey | "";
  loading: boolean;
  running: boolean;
  message: UiMessage | null;
  consumerSettings: ConsumerSchedulingResponse | null;
  onLoad: () => void;
  onExecute: () => void;
};

const cardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  padding: 16,
  display: "grid",
  gap: 12,
};

const ConsumerSchedulingSection: React.FC<Props> = ({
  operation,
  loading,
  running,
  message,
  consumerSettings,
  onLoad,
  onExecute,
}) => {
  if (operation !== "get" && operation !== "put") return null;

  return (
    <>
      <div style={cardStyle}>
        <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
          Consumer Scheduling Settings
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn-secondary btn-sm" onClick={onLoad} disabled={loading}>
            {loading ? "Loading..." : "▶ Load"}
          </button>

          {operation === "put" ? (
            <button className="btn-primary" onClick={onExecute} disabled={running}>
              {running ? "Running..." : "⚙ Auto Configure"}
            </button>
          ) : null}
        </div>

        {message ? (
          <div
            style={{
              borderRadius: 12,
              padding: "10px 12px",
              fontSize: 13,
              color: message.ok ? "#bbf7d0" : "#fecaca",
              background: message.ok
                ? "rgba(34,197,94,0.10)"
                : "rgba(239,68,68,0.10)",
              border: message.ok
                ? "1px solid rgba(34,197,94,0.22)"
                : "1px solid rgba(239,68,68,0.22)",
            }}
          >
            {message.text}
          </div>
        ) : null}
      </div>

      {consumerSettings ? (
        <div style={cardStyle}>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
            Current Consumer Scheduling Values
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                borderRadius: 12,
                padding: "12px 14px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <span style={{ color: "#e2e8f0" }}>Allow to Remove Vehicle</span>
              <span style={renderBoolToneStyles(Boolean(consumerSettings?.data?.allowToRemoveVehicle))}>
                {consumerSettings?.data?.allowToRemoveVehicle ? "Enabled" : "Disabled"}
              </span>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                borderRadius: 12,
                padding: "12px 14px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <span style={{ color: "#e2e8f0" }}>Allow Customer to Add VIN</span>
              <span style={renderBoolToneStyles(Boolean(consumerSettings?.data?.allowCustomerToAddVin))}>
                {consumerSettings?.data?.allowCustomerToAddVin ? "Enabled" : "Disabled"}
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default ConsumerSchedulingSection;
