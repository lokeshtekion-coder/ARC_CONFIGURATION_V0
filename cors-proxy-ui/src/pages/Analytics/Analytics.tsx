import React from "react";

interface Props {
  onBack: () => void;
}

export const Analytics: React.FC<Props> = ({ onBack }) => {
  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "24px 16px 36px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gap: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 28, fontWeight: 800, color: "#f8fafc", marginBottom: 4 }}>
              📊 Analytics
            </div>
            <div style={{ color: "#94a3b8", fontSize: 14 }}>
              Analytics auto-configuration workspace
            </div>
          </div>

          <button className="btn-secondary btn-sm" onClick={onBack}>
            ← Back
          </button>
        </div>

        <div
          style={{
            borderRadius: 18,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
            padding: 20,
          }}
        >
          <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            Analytics Actions
          </div>
          <div style={{ color: "#94a3b8", fontSize: 14, marginBottom: 16 }}>
            Blank UI for now. Later we can add multiple Analytics buttons and keep related logic inside this folder.
          </div>

          <div
            style={{
              minHeight: 260,
              borderRadius: 14,
              border: "1px dashed rgba(148,163,184,0.30)",
              padding: 24,
              color: "#94a3b8",
              display: "grid",
              placeItems: "center",
              textAlign: "center",
            }}
          >
            Analytics page placeholder
          </div>
        </div>
      </div>
    </div>
  );
};
