import React, { useEffect, useMemo, useState } from "react";
import { AccountingBlueprintProvider } from "../../Context/Blueprint_Accounting_Context/AccountingBlueprintContext";
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
  icon: string;
  category: string;
  description: string;
}

const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";

const ACCOUNTING_ITEMS: AccountingNavItem[] = [
  {
    key: "glam",
    label: "GLAM",
    icon: "📊",
    category: "Core Ledgers",
    description: "General Ledger & Account Mapping",
  },
  {
    key: "auto-posting-settings",
    label: "Auto Posting Settings",
    icon: "⚡",
    category: "Automation",
    description: "Automated batch & transaction posting rules",
  },
  {
    key: "field-rules-setup",
    label: "Field Rules Setup",
    icon: "⚙️",
    category: "Configuration",
    description: "Mandatory validations & default field values",
  },
  {
    key: "journal-mapping",
    label: "Journal Mapping",
    icon: "📑",
    category: "Configuration",
    description: "Subledger to main journal entry maps",
  },
  {
    key: "ap-setup",
    label: "AP Setup",
    icon: "💳",
    category: "Payables & Receivables",
    description: "Accounts Payable defaults, terms & vouchers",
  },
  {
    key: "ar-setup",
    label: "AR Setup",
    icon: "📥",
    category: "Payables & Receivables",
    description: "Accounts Receivable aging & credit limits",
  },
  {
    key: "accounting-global-settings",
    label: "Accounting Global Settings",
    icon: "🌐",
    category: "System Defaults",
    description: "Fiscal year, lock periods & company currency",
  },
  {
    key: "user-access-setup",
    label: "User Access Setup",
    icon: "👥",
    category: "Security",
    description: "Entity permissions & journal posting rights",
  },
];

const logger = {
  info: (...args: unknown[]) => console.info("[Accounting]", ...args),
};

function PlaceholderContent({
  title,
  icon,
  description,
}: {
  title: string;
  icon: string;
  description: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 460,
        borderRadius: 14,
        border: "1px dashed rgba(255, 255, 255, 0.12)",
        background: "rgba(15, 23, 42, 0.3)",
        padding: 40,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: "rgba(56, 189, 248, 0.1)",
          border: "1px solid rgba(56, 189, 248, 0.25)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 28,
          marginBottom: 16,
        }}
      >
        {icon}
      </div>

      <div
        style={{
          fontSize: 18,
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
          fontSize: 13,
          maxWidth: 420,
          lineHeight: 1.5,
          marginBottom: 20,
        }}
      >
        {description}
      </div>

      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 12px",
          borderRadius: 999,
          background: "rgba(148, 163, 184, 0.12)",
          border: "1px solid rgba(148, 163, 184, 0.2)",
          color: "#94a3b8",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
        }}
      >
        Module In Development
      </span>
    </div>
  );
}

export const Accounting: React.FC<Props> = ({ onBack }) => {
  const [activeKey, setActiveKey] = useState<AccountingNavKey>("glam");
  const [selectedDealerProfileId, setSelectedDealerProfileId] = useState<string | null>(null);
  const [selectedDealerId, setSelectedDealerId] = useState("");
  const [selectedDealerTenant, setSelectedDealerTenant] = useState("");

  // Sidebar collapse and proximity state
  const [isSidebarPinnedOpen, setIsSidebarPinnedOpen] = useState(false);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);

  // Panel is expanded if user pins it open OR hovers cursor over it
  const isExpanded = isSidebarPinnedOpen || isSidebarHovered;

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

    syncSelectedDealer();

    const unsubscribe = subscribeToExtensionCapture(() => {
      syncSelectedDealer();
    });

    const handleWindowFocus = () => {
      syncSelectedDealer();
    };

    window.addEventListener("focus", handleWindowFocus);

    return () => {
      unsubscribe();
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, []);

  const activeItem = useMemo(
    () => ACCOUNTING_ITEMS.find((item) => item.key === activeKey) ?? ACCOUNTING_ITEMS[0],
    [activeKey]
  );

  const selectedDealerDisplay = selectedDealerId || "Not Selected";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#090d14",
        color: "#f8fafc",
        padding: "20px 24px 40px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 1600, margin: "0 auto", display: "grid", gap: 16 }}>
        {/* Top Navigation Bar */}
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingBottom: 16,
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button
              className="btn-secondary btn-sm"
              onClick={onBack}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontWeight: 700,
              }}
            >
              ← Back
            </button>

            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 22,
                  fontWeight: 800,
                  letterSpacing: "-0.3px",
                }}
              >
                <span>📒 Accounting Engine</span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    textTransform: "uppercase",
                    letterSpacing: "0.6px",
                    background: "rgba(56, 189, 248, 0.14)",
                    color: "#38bdf8",
                    border: "1px solid rgba(56, 189, 248, 0.3)",
                    borderRadius: 6,
                    padding: "2px 8px",
                  }}
                >
                  Blueprint v2
                </span>
              </div>
              <div style={{ color: "#64748b", fontSize: 12, marginTop: 2 }}>
                Financial master setups, chart of accounts mapping, and automated posting rules
              </div>
            </div>
          </div>

          {/* Dealer Telemetry HUD */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "rgba(15, 23, 42, 0.6)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              padding: "6px 14px",
              borderRadius: 10,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 800,
                  color: "#94a3b8",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                Active Tenant Context
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: selectedDealerTenant ? "#f8fafc" : "#64748b",
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={
                  selectedDealerProfileId
                    ? `Profile ID: ${selectedDealerProfileId}`
                    : "No profile active"
                }
              >
                {selectedDealerTenant || "Default System Session"}
              </span>
            </div>

            <div
              style={{
                width: 1,
                height: 24,
                background: "rgba(255, 255, 255, 0.1)",
              }}
            />

            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: 800,
                  color: "#94a3b8",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                Dealer ID
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  color: selectedDealerId ? "#38bdf8" : "#f43f5e",
                }}
                title={
                  selectedDealerProfileId
                    ? `Configured under profile ${selectedDealerProfileId}`
                    : undefined
                }
              >
                {selectedDealerDisplay}
              </span>
            </div>
          </div>
        </header>

        {/* Master-Detail Workspace Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `${isExpanded ? "280px" : "68px"} minmax(0, 1fr)`,
            gap: 16,
            alignItems: "start",
            transition: "grid-template-columns 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        >
          {/* Left Navigation Sidebar with 80% auto-close and hover reveal */}
          <aside
            onMouseEnter={() => setIsSidebarHovered(true)}
            onMouseLeave={() => setIsSidebarHovered(false)}
            style={{
              background: "#0f172a",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 14,
              padding: "12px 8px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              overflow: "hidden",
              width: "100%",
              boxSizing: "border-box",
              transition: "all 0.22s cubic-bezier(0.4, 0, 0.2, 1)",
              boxShadow: isSidebarHovered && !isSidebarPinnedOpen
                ? "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 15px rgba(56, 189, 248, 0.15)"
                : "none",
            }}
          >
            {/* Header / Pin Button */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: isExpanded ? "space-between" : "center",
                padding: "6px 8px 10px",
                borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
                marginBottom: 4,
                gap: 6,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  color: "#64748b",
                  textTransform: "uppercase",
                  letterSpacing: "0.6px",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: isExpanded ? "190px" : "36px",
                  transition: "max-width 0.2s ease",
                }}
                title="Setup & Ledger Modules"
              >
                {isExpanded ? "Setup & Ledger Modules" : "Setup..."}
              </span>

              <button
                type="button"
                onClick={() => setIsSidebarPinnedOpen((prev) => !prev)}
                title={isSidebarPinnedOpen ? "Auto-collapse on mouse leave" : "Pin panel open"}
                style={{
                  background: isSidebarPinnedOpen
                    ? "rgba(56, 189, 248, 0.16)"
                    : "rgba(255, 255, 255, 0.04)",
                  border: isSidebarPinnedOpen
                    ? "1px solid rgba(56, 189, 248, 0.35)"
                    : "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: 6,
                  color: isSidebarPinnedOpen ? "#38bdf8" : "#94a3b8",
                  fontSize: 10,
                  fontWeight: 700,
                  cursor: "pointer",
                  padding: "3px 6px",
                  lineHeight: 1,
                }}
              >
                {isSidebarPinnedOpen ? "📌" : "⚡"}
              </button>
            </div>

            {ACCOUNTING_ITEMS.map((item) => {
              const isActive = item.key === activeKey;

              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    logger.info("left nav click", {
                      key: item.key,
                      label: item.label,
                    });
                    setActiveKey(item.key);
                  }}
                  title={!isExpanded ? `${item.label} (${item.category})` : undefined}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 8px",
                    borderRadius: 8,
                    cursor: "pointer",
                    border: isActive
                      ? "1px solid rgba(56, 189, 248, 0.35)"
                      : "1px solid transparent",
                    background: isActive
                      ? "rgba(56, 189, 248, 0.08)"
                      : "transparent",
                    transition: "all 0.15s ease",
                    overflow: "hidden",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = "transparent";
                    }
                  }}
                >
                  <span
                    style={{
                      fontSize: 18,
                      lineHeight: 1,
                      minWidth: 24,
                      textAlign: "center",
                      display: "inline-block",
                    }}
                  >
                    {item.icon}
                  </span>

                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: isActive ? 800 : 600,
                        color: isActive ? "#38bdf8" : "#cbd5e1",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: isExpanded ? "190px" : "28px",
                        transition: "max-width 0.2s ease",
                      }}
                    >
                      {item.label}
                    </div>
                  </div>

                  {isActive && isExpanded && (
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#38bdf8",
                        boxShadow: "0 0 8px #38bdf8",
                        flexShrink: 0,
                      }}
                    />
                  )}
                </button>
              );
            })}
          </aside>

          {/* Right Main Content Pane */}
          <main
            style={{
              background: "#0f172a",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 14,
              padding: 20,
              minHeight: 680,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Active Header Section */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                paddingBottom: 16,
                marginBottom: 20,
                borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>{activeItem.icon}</span>
                  <h1
                    style={{
                      margin: 0,
                      fontSize: 20,
                      fontWeight: 800,
                      color: "#f8fafc",
                      letterSpacing: "-0.2px",
                    }}
                  >
                    {activeItem.label}
                  </h1>
                </div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                  {activeItem.description}
                </div>
              </div>

              {/* Module Metadata Chips */}
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: 6,
                    background: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    color: "#94a3b8",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  Category: <strong style={{ color: "#cbd5e1" }}>{activeItem.category}</strong>
                </span>

                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: 6,
                    background: selectedDealerId
                      ? "rgba(34, 197, 94, 0.12)"
                      : "rgba(239, 68, 68, 0.12)",
                    border: selectedDealerId
                      ? "1px solid rgba(34, 197, 94, 0.25)"
                      : "1px solid rgba(239, 68, 68, 0.25)",
                    color: selectedDealerId ? "#4ade80" : "#f87171",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {selectedDealerId ? `● Active: #${selectedDealerId}` : "○ No Dealer Attached"}
                </span>
              </div>
            </div>

            {/* Dynamic Content Switching */}
            <div style={{ flex: 1, minWidth: 0 }}>
              {activeItem.key === "glam" ? (
                <AccountingBlueprintProvider dealerId={selectedDealerId}>
                  <GLAM />
                </AccountingBlueprintProvider>
              ) : activeItem.key === "field-rules-setup" ? (
                <FieldRulesSetup />
              ) : activeItem.key === "auto-posting-settings" ? (
                <AutoPostingSettings />
              ) : (
                <PlaceholderContent
                  title={activeItem.label}
                  icon={activeItem.icon}
                  description={activeItem.description}
                />
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

export default Accounting;