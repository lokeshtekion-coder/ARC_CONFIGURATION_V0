import React from "react";

export const sectionCardStyle: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.025)",
};

export const leftPanelStyle: React.CSSProperties = {
  ...sectionCardStyle,
  padding: 14,
  display: "grid",
  gap: 10,
  minHeight: 620,
  alignContent: "start",
};

export const itemButtonBaseStyle: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  color: "#e2e8f0",
  padding: "10px 12px",
  cursor: "pointer",
};

export const contentCardStyle: React.CSSProperties = {
  ...sectionCardStyle,
  padding: 18,
  minHeight: 620,
  minWidth: 0,
};

export const Arrow: React.FC<{ open: boolean }> = ({ open }) => (
  <span
    style={{
      display: "inline-block",
      transform: open ? "rotate(90deg)" : "rotate(0deg)",
      transition: "transform 0.18s ease",
      color: "#cbd5e1",
      fontSize: 12,
    }}
  >
    ▶
  </span>
);

export const MetricCard: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <div
    style={{
      borderRadius: 14,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.02)",
      padding: 14,
      minWidth: 0,
    }}
  >
    <div
      style={{
        color: "#94a3b8",
        fontSize: 12,
        marginBottom: 6,
      }}
    >
      {label}
    </div>
    <div
      style={{
        color: "#f8fafc",
        fontSize: 15,
        fontWeight: 800,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      }}
    >
      {value}
    </div>
  </div>
);

/**
 * Clean Header component without placeholder metrics or dashed content box
 */
export const GlamSectionHeader: React.FC<{
  title: string;
  description: string;
  breadcrumb: string;
}> = ({ title, description, breadcrumb }) => {
  return (
    <div style={{ display: "grid", gap: 4, minWidth: 0, marginBottom: 8 }}>
      <div
        style={{
          color: "#60a5fa",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        {breadcrumb}
      </div>

      <div
        style={{
          color: "#f8fafc",
          fontSize: 24,
          fontWeight: 800,
        }}
      >
        {title}
      </div>

      <div
        style={{
          color: "#94a3b8",
          fontSize: 14,
          lineHeight: 1.7,
          maxWidth: 900,
        }}
      >
        {description}
      </div>
    </div>
  );
};

export const GlamSectionPlaceholder: React.FC<{
  title: string;
  description: string;
  breadcrumb: string;
}> = ({ title, description, breadcrumb }) => {
  return (
    <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
      <GlamSectionHeader
        title={title}
        description={description}
        breadcrumb={breadcrumb}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        <MetricCard label="Section" value={title} />
        <MetricCard label="Area" value={breadcrumb.split(" / ")[1] || "GLAM"} />
        <MetricCard label="Status" value="UI Ready" />
      </div>

      <div
        style={{
          minHeight: 420,
          borderRadius: 16,
          border: "1px dashed rgba(148,163,184,0.30)",
          background: "rgba(255,255,255,0.015)",
          display: "grid",
          placeItems: "center",
          textAlign: "center",
          padding: 24,
          color: "#94a3b8",
        }}
      >
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 700 }}>
            {title}
          </div>
          <div style={{ fontSize: 14 }}>
            This is the content area for the selected GLAM section.
          </div>
          <div style={{ fontSize: 13 }}>
            Next step: wire the actual GLAM data and mapping UI here.
          </div>
        </div>
      </div>
    </div>
  );
};