import React, { useEffect, useMemo, useState } from "react";
import GLAM from "./GLAM/GLAM";
import FieldRulesSetup from "./FieldRulesSetup";
import AutoPostingSettings from "./AutoPostingSettings";
import {
  loadLatestExtensionCapture,
  subscribeToExtensionCapture,
} from "../../services/extensionBridge";

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
}

const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";

const ACCOUNTING_ITEMS: AccountingNavItem[] = [
  {
    key: "ap-setup",
    label: "AP Setup",

  },
  {
    key: "ar-setup",
    label: "AR Setup",

  },
  {
    key: "accounting-global-settings",
    label: "Accounting Global Settings",

  },
  {
    key: "auto-posting-settings",
    label: "Auto Posting Settings",

  },
  {
    key: "user-access-setup",
    label: "User Access Setup",

  },
  {
    key: "field-rules-setup",
    label: "Field Rules Setup",

  },
  {
    key: "journal-mapping",
    label: "Journal Mapping",

  },
  {
    key: "glam",
    label: "GLAM",

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

const titleRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  marginBottom: 4,
};

const dealerPillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "#cbd5e1",
  fontSize: 12,
  lineHeight: 1.2,
  whiteSpace: "nowrap",
};

function PlaceholderContent({
  title,

}: {
  title: string;

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
  const [selectedDealerProfileId, setSelectedDealerProfileId] = useState<string | null>(null);
  const [selectedDealerId, setSelectedDealerId] = useState<string>("");
  const [selectedDealerTenant, setSelectedDealerTenant] = useState<string>("");

  useEffect(() => {
    const syncSelectedDealer = () => {
      const storedProfileId = localStorage.getItem(SELECTED_DEALER_PROFILE_KEY);
      const latestCapture = loadLatestExtensionCapture();
      const matchedProfile =
        latestCapture?.tekionProfiles?.find((profile) => profile.id === storedProfileId) ?? null;

      setSelectedDealerProfileId(storedProfileId);
      setSelectedDealerId(matchedProfile?.dealerId ?? "");
      setSelectedDealerTenant(matchedProfile?.tenantName ?? "");

      logger.info("synced selected dealer profile", {
        storedProfileId,
        matchedDealerId: matchedProfile?.dealerId ?? null,
        matchedTenantName: matchedProfile?.tenantName ?? null,
      });
    };

    logger.info("page mounted");
    syncSelectedDealer();

    const unsubscribe = subscribeToExtensionCapture(() => {
      logger.info("extension capture update received, resyncing selected dealer");
      syncSelectedDealer();
    });

    const handleWindowFocus = () => {
      logger.info("window focused, resyncing selected dealer");
      syncSelectedDealer();
    };

    window.addEventListener("focus", handleWindowFocus);

    return () => {
      logger.info("page unmounted");
      unsubscribe();
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, []);

  const activeItem = useMemo(
    () => ACCOUNTING_ITEMS.find((item) => item.key === activeKey) ?? ACCOUNTING_ITEMS[0],
    [activeKey]
  );

  logger.info("render", { activeKey });

  const selectedDealerDisplay = selectedDealerId || "Not Selected";
  const selectedDealerSubText = selectedDealerTenant
    ? selectedDealerTenant
    : selectedDealerProfileId
    ? "Dealer profile selected"
    : "Select a dealer in Settings to apply dealer-specific headers";

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
            <div style={titleRowStyle}>
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color: "#f8fafc",
                }}
              >
                📒 Accounting
              </div>

              <div style={dealerPillStyle}>
                <span style={{ color: "#94a3b8" }}>Selected Dealer ID</span>
                <span style={{ color: "#f8fafc", fontWeight: 800 }}>
                  {selectedDealerDisplay}
                </span>
              </div>
            </div>



            <div
              style={{
                color: "#64748b",
                fontSize: 12,
                lineHeight: 1.6,
                marginTop: 4,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {selectedDealerSubText}
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


                </button>
              );
            })}
          </div>

          <div style={rightPanelStyle}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    color: "#cbd5e1",
                    fontSize: 12,
                  }}
                >
                  Active Module
                  <span style={{ color: "#f8fafc", fontWeight: 700 }}>
                    {activeItem.label}
                  </span>
                </div>

                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    color: "#cbd5e1",
                    fontSize: 12,
                  }}
                >
                  Dealer ID
                  <span style={{ color: "#f8fafc", fontWeight: 700 }}>
                    {selectedDealerDisplay}
                  </span>
                </div>
              </div>

              <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800 }}>
                {activeItem.label}
              </div>


            </div>

            {activeItem.key === "glam" ? (
              <GLAM />
            ) : activeItem.key === "field-rules-setup" ? (
              <FieldRulesSetup />
            ) : activeItem.key === "auto-posting-settings" ? (
              <AutoPostingSettings />
            ) : (
              <PlaceholderContent
                title={activeItem.label}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Accounting;
