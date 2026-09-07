import React from "react";
import type { OperationKey, TransportationSummaryRow, UiMessage } from "../types";

type ResultRow = { name: string; ok: boolean; text: string };

type Props = {
  operation: OperationKey | "";
  loading: boolean;
  running: boolean;
  message: UiMessage | null;
  rows: TransportationSummaryRow[];
  result: ResultRow[] | null;
  onLoad: () => void;
  onExecute: () => void;
};

const cardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  padding: 16,
};

const TransportationSection: React.FC<Props> = ({
  operation,
  loading,
  running,
  message,
  rows,
  result,
  onLoad,
  onExecute,
}) => {
  if (operation !== "get" && operation !== "configure") return null;

  return (
    <>
      <div style={{ ...cardStyle, display: "grid", gap: 12 }}>
        <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
          Transportation Settings
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn-secondary btn-sm" onClick={onLoad} disabled={loading}>
            {loading ? "Loading..." : "▶ Load"}
          </button>

          {operation === "configure" ? (
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

      {rows.length > 0 ? (
        <div style={{ ...cardStyle, display: "grid", gap: 10 }}>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
            Transportation Types
          </div>

          {rows.map((row, index) => (
            <div
              key={`${row.id || row.transportationType || "transport"}-${index}`}
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.02)",
                padding: "12px 14px",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ color: "#f8fafc", fontWeight: 700 }}>
                  {row.displayName || row.transportationType || "Unknown"}
                </div>
                <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
                  Type: {row.transportationType || "—"} · ID: {row.id || "—"}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {operation === "configure" && result ? (
        <div style={cardStyle}>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
            Transportation Configuration Results
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {result.map((row, idx) => (
              <div
                key={`${row.name}-${idx}`}
                style={{
                  borderRadius: 12,
                  border: row.ok
                    ? "1px solid rgba(34,197,94,0.18)"
                    : "1px solid rgba(239,68,68,0.18)",
                  background: row.ok
                    ? "rgba(34,197,94,0.06)"
                    : "rgba(239,68,68,0.06)",
                  padding: "10px 12px",
                  color: row.ok ? "#bbf7d0" : "#fecaca",
                  fontSize: 13,
                }}
              >
                <b>{row.name}</b> — {row.text}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
};

export default TransportationSection;
