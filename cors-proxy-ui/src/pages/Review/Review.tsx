import React, { useState } from "react";
import ValidationAccounting from "../VALIDATION_ACCOUNTING/ValidationAccounting";
import ValidationParts from "../VALIDATION_PARTS/ValidationParts";
import ValidationService from "../VALIDATION_SERVICE/ValidationService";

interface Props {
  onBack: () => void;
}

type ReviewKey = "accounting" | "parts" | "service";

const ITEMS: Array<{ key: ReviewKey; label: string; icon: string; description: string }> = [
  { key: "accounting", label: "Accounting", icon: "📒", description: "Bootstrap & GL mapping review" },
  { key: "parts", label: "Parts", icon: "🧩", description: "Parts configuration review" },
  { key: "service", label: "Service", icon: "🛠️", description: "Service configuration review" },
];

export const Review: React.FC<Props> = ({ onBack }) => {
  const [active, setActive] = useState<ReviewKey>("accounting");

  return (
    <div style={{ display: "flex", height: "100%", minHeight: "calc(100vh - 60px)" }}>
      <aside
        style={{
          width: 230,
          flexShrink: 0,
          background: "#0f172a",
          borderRight: "1px solid rgba(148,163,184,0.18)",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div style={{ color: "#94a3b8", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, margin: "4px 6px 8px" }}>
          Review
        </div>
        {ITEMS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setActive(item.key)}
            title={item.description}
            style={{
              textAlign: "left",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid transparent",
              cursor: "pointer",
              color: active === item.key ? "#38bdf8" : "#e2e8f0",
              background: active === item.key ? "rgba(56,189,248,0.14)" : "transparent",
              borderColor: active === item.key ? "rgba(56,189,248,0.35)" : "transparent",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            {item.icon} {item.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onBack}
          style={{ marginTop: "auto", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(148,163,184,0.25)", background: "transparent", color: "#94a3b8", cursor: "pointer" }}
        >
          ← Back
        </button>
      </aside>

      <div style={{ flex: 1, overflow: "auto" }}>
        {active === "accounting" && <ValidationAccounting />}
        {active === "parts" && <ValidationParts />}
        {active === "service" && <ValidationService />}
      </div>
    </div>
  );
};
