import React from "react";
import type { OperationKey, UiMessage } from "../types";

type Props = {
  operation: OperationKey | "";
  loading: boolean;
  running: boolean;
  message: UiMessage | null;
  generalRaw: unknown;
  onLoad: () => void;
  onExecute: () => void;
};

const cardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  padding: 16,
};

const GeneralSection: React.FC<Props> = ({
  operation,
  loading,
  running,
  message,
  generalRaw,
  onLoad,
  onExecute,
}) => {
  if (operation !== "get" && operation !== "post") return null;

  return (
    <>
      <div style={{ ...cardStyle, display: "grid", gap: 12 }}>
        <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
          General Scheduling
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn-secondary btn-sm" onClick={onLoad} disabled={loading}>
            {loading ? "Loading..." : "▶ Load"}
          </button>

          {operation === "post" ? (
            <button className="btn-primary" onClick={onExecute} disabled={running}>
              {running ? "Running..." : "⚙ Execute"}
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

      {operation === "get" && generalRaw ? (
        <div style={cardStyle}>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }}>
            General Scheduling Response
          </div>

          <pre
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 12,
              background: "#0f172a",
              color: "#e2e8f0",
              overflow: "auto",
              fontSize: 12,
            }}
          >
            {JSON.stringify(generalRaw, null, 2)}
          </pre>
        </div>
      ) : null}
    </>
  );
};

export default GeneralSection;
