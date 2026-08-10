import React, { useMemo, useState } from "react";
import GLAM from "./GLAM/GLAM";

interface Props {
  onBack: () => void;
}

type AccountingNavKey =
  | "ap-setup"
  | "ar-setup"
  | "accounting-global-settings"
  | "auto-posting-settings"
  | "user-access-setup"
  | "field-rules-setup"
  | "journal-mapping"
  | "glam";

interface AccountingNavItem {
  key: AccountingNavKey;
  label: string;
  description: string;
}

const ACCOUNTING_ITEMS: AccountingNavItem[] = [
  {
    key: "ap-setup",
    label: "AP Setup",
    description: "Accounts Payable setup workspace",
  },
  {
    key: "ar-setup",
    label: "AR Setup",
    description: "Accounts Receivable setup workspace",
  },
  {
    key: "accounting-global-settings",
    label: "Accounting Global Settings",
    description: "Global accounting settings and controls",
  },
  {
    key: "auto-posting-settings",
    label: "Auto Posting Settings",
    description: "Posting automation settings",
  },
  {
    key: "user-access-setup",
    label: "User Access Setup",
    description: "Accounting permissions and user access",
  },
  {
    key: "field-rules-setup",
    label: "Field Rules Setup",
    description: "Accounting field rule configuration",
  },
  {
    key: "journal-mapping",
    label: "Journal Mapping",
    description: "Journal mapping workspace",
  },
  {
    key: "glam",
    label: "GLAM",
    description: "General Ledger Account Mapping workspace",
  },
];

const logger = {
  info: (...args: unknown[]) => console.info("[Accounting]", ...args),
};

const cardStyle: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  backdropFilter: "blur(6px)",
};

const leftPanelStyle: React.CSSProperties = {
  ...cardStyle,
  padding: 14,
  display: "grid",
  gap: 8,
  alignContent: "start",
  minHeight: 520,
};

const rightPanelStyle: React.CSSProperties = {
  ...cardStyle,
  padding: 18,
  minHeight: 520,
  minWidth: 0,
};

const navButtonBaseStyle: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  color: "#e2e8f0",
  padding: "12px 14px",
  cursor: "pointer",
  transition: "all 0.18s ease",
};

function PlaceholderContent({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            color: "#f8fafc",
            marginBottom: 6,
          }}
        >
          {title}
        </div>
        <div
          style={{
            color: "#94a3b8",
            fontSize: 14,
            lineHeight: 1.7,
          }}
        >
          {description}
        </div>
      </div>

      <div
        style={{
          minHeight: 380,
          borderRadius: 16,
          border: "1px dashed rgba(148,163,184,0.30)",
          display: "grid",
          placeItems: "center",
          padding: 24,
          color: "#94a3b8",
          textAlign: "center",
          background: "rgba(255,255,255,0.015)",
        }}
      >
        {title} placeholder
      </div>
    </div>
  );
}

export const Accounting: React.FC<Props> = ({ onBack }) => {
  const [activeKey, setActiveKey] = useState<AccountingNavKey>("glam");

  const activeItem = useMemo(
    () => ACCOUNTING_ITEMS.find((item) => item.key === activeKey) ?? ACCOUNTING_ITEMS[0],
    [activeKey]
  );

  logger.info("render", { activeKey });

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "24px 16px 36px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 1480, margin: "0 auto", display: "grid", gap: 16 }}>
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
            <div
              style={{
                fontSize: 28,
                fontWeight: 800,
                color: "#f8fafc",
                marginBottom: 4,
              }}
            >
              📒 Accounting
            </div>
            <div style={{ color: "#94a3b8", fontSize: 14 }}>
              Accounting auto-configuration workspace
            </div>
          </div>

          <button className="btn-secondary btn-sm" onClick={onBack}>
            ← Back
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "280px minmax(0, 1fr)",
            gap: 16,
            alignItems: "start",
          }}
        >
          <div style={leftPanelStyle}>
            <div
              style={{
                color: "#f8fafc",
                fontSize: 18,
                fontWeight: 800,
                padding: "6px 4px 10px",
              }}
            >
              Accounting Modules
            </div>

            {ACCOUNTING_ITEMS.map((item) => {
              const isActive = item.key === activeKey;

              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    logger.info("left nav click", { key: item.key, label: item.label });
                    setActiveKey(item.key);
                  }}
                  style={{
                    ...navButtonBaseStyle,
                    border: isActive
                      ? "1px solid rgba(59,130,246,0.35)"
                      : navButtonBaseStyle.border,
                    background: isActive
                      ? "rgba(59,130,246,0.12)"
                      : navButtonBaseStyle.background,
                    boxShadow: isActive
                      ? "inset 0 0 0 1px rgba(59,130,246,0.18)"
                      : "none",
                  }}
                >
                  <div
                    style={{
                      color: isActive ? "#dbeafe" : "#f8fafc",
                      fontSize: 14,
                      fontWeight: 800,
                      marginBottom: 4,
                    }}
                  >
                    {item.label}
                  </div>
                  <div
                    style={{
                      color: isActive ? "#bfdbfe" : "#94a3b8",
                      fontSize: 12,
                      lineHeight: 1.5,
                    }}
                  >
                    {item.description}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={rightPanelStyle}>
            {activeItem.key === "glam" ? (
              <GLAM />
            ) : (
              <PlaceholderContent
                title={activeItem.label}
                description={activeItem.description}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Accounting;
