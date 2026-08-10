import React, { useEffect } from "react";

interface Props {
  title: string;
  description: string;
}

export const PartsPlaceholderView: React.FC<Props> = ({ title, description }) => {
  useEffect(() => {
    console.log("[PartsPlaceholderView] mounted", { title, description });
    return () => {
      console.log("[PartsPlaceholderView] unmounted", { title });
    };
  }, [title, description]);

  return (
    <div
      style={{
        display: "grid",
        gap: 16,
      }}
    >
      <div
        style={{
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: 20,
        }}
      >
        <div
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: "#f8fafc",
            marginBottom: 8,
            wordBreak: "break-word",
          }}
        >
          {title}
        </div>

        <div
          style={{
            color: "#94a3b8",
            fontSize: 14,
            lineHeight: 1.7,
            marginBottom: 16,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {description}
        </div>

        <div
          style={{
            minHeight: 280,
            borderRadius: 14,
            border: "1px dashed rgba(148,163,184,0.30)",
            padding: 24,
            color: "#94a3b8",
            display: "grid",
            placeItems: "center",
            textAlign: "center",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {title} page placeholder
        </div>
      </div>
    </div>
  );
};
