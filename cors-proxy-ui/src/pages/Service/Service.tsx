import React, { useEffect, useMemo, useState } from "react";
import SchedulingSettingsView from "./Scheduling settings";
import DealerConfigView from "./Dealer config";
import SetupFieldsView from "./Setup fields";
import LaborPricingView from "./Labor pricing";
import OpcodeManagementView from "./Opcode management";
import ServiceSettingsView from "./Service settings";
import FeesView from "./Fees";
import CouponsView from "./Coupons";
import PdfView from "./Pdf";
import CheckInSetupView from "./Check in setup";
import MpviView from "./Mpvi";
import DispatchSettingsView from "./Dispatch Settings";
import {
  loadLatestExtensionCapture,
  subscribeToExtensionCapture,
} from "../../services/extensionBridge";

interface Props {
  onBack: () => void;
}

type ServiceSectionKey =
  | "scheduling-settings"
  | "dealer-config"
  | "setup-fields"
  | "labor-pricing"
  | "opcode-management"
  | "service-settings"
  | "fees"
  | "coupons"
  | "pdf"
  | "check-in-setup"
  | "mpvi"
  | "dispatch-settings";

type ServiceNavItem = {
  key: ServiceSectionKey;
  label: string;
  description: string;
};

const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";

const SERVICE_ITEMS: ServiceNavItem[] = [
  {
    key: "scheduling-settings",
    label: "1. Scheduling settings",
    description:
      "Consumer scheduling, transportation, advisors, shops, and general scheduling settings.",
  },
  {
    key: "dealer-config",
    label: "2. Dealer config",
    description: "Placeholder for dealer-level service configuration.",
  },
  {
    key: "setup-fields",
    label: "3. Setup fields",
    description: "Placeholder for service setup fields automation.",
  },
  {
    key: "labor-pricing",
    label: "4. Labor pricing",
    description: "Placeholder for labor pricing automation.",
  },
  {
    key: "opcode-management",
    label: "5. Opcode management",
    description: "Placeholder for opcode automation.",
  },
  {
    key: "service-settings",
    label: "6. Service settings",
    description: "Placeholder for general service settings automation.",
  },
  {
    key: "fees",
    label: "7. Fees",
    description: "Placeholder for fees automation.",
  },
  {
    key: "coupons",
    label: "8. Coupons",
    description: "Placeholder for coupons automation.",
  },
  {
    key: "pdf",
    label: "9. Pdf",
    description: "Placeholder for PDF-related service configuration.",
  },
  {
    key: "check-in-setup",
    label: "10. Check in setup",
    description: "Placeholder for check-in setup automation.",
  },
  {
    key: "mpvi",
    label: "11. Mpvi",
    description: "Placeholder for MPVI automation.",
  },
  {
    key: "dispatch-settings",
    label: "12. Dispatch Settings",
    description: "Placeholder for dispatch settings automation.",
  },
];

function renderServiceSection(activeKey: ServiceSectionKey): React.ReactNode {
  switch (activeKey) {
    case "scheduling-settings":
      return <SchedulingSettingsView />;
    case "dealer-config":
      return <DealerConfigView />;
    case "setup-fields":
      return <SetupFieldsView />;
    case "labor-pricing":
      return <LaborPricingView />;
    case "opcode-management":
      return <OpcodeManagementView />;
    case "service-settings":
      return <ServiceSettingsView />;
    case "fees":
      return <FeesView />;
    case "coupons":
      return <CouponsView />;
    case "pdf":
      return <PdfView />;
    case "check-in-setup":
      return <CheckInSetupView />;
    case "mpvi":
      return <MpviView />;
    case "dispatch-settings":
      return <DispatchSettingsView />;
    default:
      return <SchedulingSettingsView />;
  }
}

export const Service: React.FC<Props> = ({ onBack }) => {
  const [activeKey, setActiveKey] =
    useState<ServiceSectionKey>("scheduling-settings");
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

      console.log("[Service] synced selected dealer profile", {
        storedProfileId,
        matchedDealerId: matchedProfile?.dealerId ?? null,
        matchedTenantName: matchedProfile?.tenantName ?? null,
      });
    };

    console.log("[Service] page mounted");
    syncSelectedDealer();

    const unsubscribe = subscribeToExtensionCapture(() => {
      console.log("[Service] extension capture update received, resyncing selected dealer");
      syncSelectedDealer();
    });

    const handleWindowFocus = () => {
      console.log("[Service] window focused, resyncing selected dealer");
      syncSelectedDealer();
    };

    window.addEventListener("focus", handleWindowFocus);

    return () => {
      console.log("[Service] page unmounted");
      unsubscribe();
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, []);

  useEffect(() => {
    console.log("[Service] active section changed", { activeKey });
  }, [activeKey]);

  const activeMeta = useMemo(
    () => SERVICE_ITEMS.find((item) => item.key === activeKey) ?? SERVICE_ITEMS[0],
    [activeKey]
  );

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
        maxHeight: "100vh",
        overflow: "auto",
        padding: "24px 16px 36px",
        boxSizing: "border-box",
      }}
      className="service-page-scroll"
    >
      <style>
        {`
          .service-page-scroll::-webkit-scrollbar {
            width: 8px;
            height: 8px;
          }

          .service-page-scroll::-webkit-scrollbar-track {
            background: transparent;
          }

          .service-page-scroll::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.14);
            border-radius: 8px;
          }

          .service-page-scroll::-webkit-scrollbar-thumb:hover {
            background: rgba(255,255,255,0.24);
          }
        `}
      </style>

      <div style={{ maxWidth: 1400, margin: "0 auto", display: "grid", gap: 16 }}>
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
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                marginBottom: 4,
              }}
            >
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 800,
                  color: "#f8fafc",
                }}
              >
                🛠 Service
              </div>

              <div
                style={{
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
                }}
              >
                <span style={{ color: "#94a3b8" }}>Selected Dealer ID</span>
                <span style={{ color: "#f8fafc", fontWeight: 800 }}>
                  {selectedDealerDisplay}
                </span>
              </div>
            </div>

            <div style={{ color: "#94a3b8", fontSize: 14 }}>
              Service auto-configuration workspace
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
            gridTemplateColumns: "320px minmax(0, 1fr)",
            gap: 16,
            alignItems: "start",
          }}
        >
          <div
            style={{
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              padding: 14,
              display: "grid",
              gap: 12,
              position: "sticky",
              top: 12,
              maxHeight: "calc(100vh - 48px)",
              overflow: "auto",
            }}
            className="service-left-scroll"
          >
            <div
              style={{
                color: "#f8fafc",
                fontSize: 18,
                fontWeight: 800,
                padding: "4px 4px 2px",
              }}
            >
              Service Sections
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {SERVICE_ITEMS.map((item) => {
                const isActive = item.key === activeKey;

                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveKey(item.key)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      borderRadius: 14,
                      cursor: "pointer",
                      padding: "12px 14px",
                      border: isActive
                        ? "1px solid rgba(59,130,246,0.35)"
                        : "1px solid rgba(255,255,255,0.08)",
                      background: isActive
                        ? "rgba(59,130,246,0.12)"
                        : "rgba(255,255,255,0.02)",
                    }}
                  >
                    <div
                      style={{
                        color: isActive ? "#dbeafe" : "#f8fafc",
                        fontSize: 14,
                        fontWeight: 700,
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
          </div>

          <div
            style={{
              minWidth: 0,
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              padding: 18,
              maxHeight: "calc(100vh - 48px)",
              overflow: "auto",
            }}
            className="service-content-scroll"
          >
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
                  Active Section
                  <span style={{ color: "#f8fafc", fontWeight: 700 }}>
                    {activeMeta.label}
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
                {activeMeta.label}
              </div>

              <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>
                {activeMeta.description}
              </div>
            </div>

            {renderServiceSection(activeKey)}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Service;
