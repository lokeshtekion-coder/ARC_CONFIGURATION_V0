import React, { useEffect, useMemo, useState } from "react";
import { PARTS_NAV_ITEMS, type PartsSectionKey } from "./partsConfig";
import { loadLatestExtensionCapture, subscribeToExtensionCapture } from "../../services/extensionBridge";
import { VoidPartsReasonsView } from "./views/VoidPartsReasonsView";
import { CodeSetupView } from "./views/CodeSetupView";
import { ReturnReasonsView } from "./views/ReturnReasonsView";
import { CoreManagementSetupView } from "./views/CoreManagementSetupView";
import { AdjustmentReasonsView } from "./views/AdjustmentReasonsView";
import { CouponsView } from "./views/CouponsView";
import { FeesView } from "./views/FeesView";
import { PriceCodeView } from "./views/PriceCodeView";
import { PriceBreakFormulasView } from "./views/PriceBreakFormulasView";
import { CustomisedPriceSetupView } from "./views/CustomisedPriceSetupView";
import { DefaultPricingView } from "./views/DefaultPricingView";
import { WarehouseManagementView } from "./views/WarehouseManagementView";
import { ManufacturerView } from "./views/ManufacturerView";
import { DealerConfigView } from "./views/DealerConfigView";
import { PartsSettingsView } from "./views/PartsSettingsView";
import { UserResetView } from "./views/UserResetView";
import { RaiseOemIdRequestView } from "./views/RaiseOemIdRequestView";

interface Props {
  onBack: () => void;
}

const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";

const PAGE_STYLE: React.CSSProperties = {
  height: "100vh",           // Constrains the container to the height of the viewport
  maxHeight: "1080px",       // Strictly caps the maximum height at 1080px
  overflowY: "auto",         // Adds a vertical scrollbar only if content exceeds the height
  padding: "20px 16px 28px",
  boxSizing: "border-box",
};

const CONTAINER_STYLE: React.CSSProperties = {
  maxWidth: 1400,
  margin: "0 auto",
  display: "grid",
  gap: 16,
};

const HEADER_STYLE: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const LAYOUT_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "240px minmax(0, 1fr)",
  gap: 16,
  alignItems: "start",
};

const SIDEBAR_STYLE: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  padding: 10,
  position: "sticky",
  top: 10,
  maxHeight: "calc(100vh - 80px)",
  overflowY: "auto",
};

const CONTENT_STYLE: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 16,
};

const TITLE_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  marginBottom: 4,
};

const DEALER_PILL_STYLE: React.CSSProperties = {
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

function renderActiveView(activeKey: PartsSectionKey): React.ReactNode {
  switch (activeKey) {
    case "void-parts-reasons":
      return <VoidPartsReasonsView />;
    case "code-setup":
      return <CodeSetupView />;
    case "return-reasons":
      return <ReturnReasonsView />;
    case "core-management-setup":
      return <CoreManagementSetupView />;
    case "adjustment-reasons":
      return <AdjustmentReasonsView />;
    case "coupons":
      return <CouponsView />;
    case "fees":
      return <FeesView />;
    case "price-code":
      return <PriceCodeView />;
    case "price-break-formulas":
      return <PriceBreakFormulasView />;
    case "customised-price-setup":
      return <CustomisedPriceSetupView />;
    case "default-pricing":
      return <DefaultPricingView />;
    case "warehouse-management":
      return <WarehouseManagementView />;
    case "manufacturer":
      return <ManufacturerView />;
    case "dealer-config":
      return <DealerConfigView />;
    case "parts-settings":
      return <PartsSettingsView />;
    case "user-reset":
      return <UserResetView />;
    case "raise-oem-id-request":
      return <RaiseOemIdRequestView />;
    default:
      return <VoidPartsReasonsView />;
  }
}

export const Parts: React.FC<Props> = ({ onBack }) => {
  const [activeKey, setActiveKey] = useState<PartsSectionKey>("void-parts-reasons");
  const [selectedDealerProfileId, setSelectedDealerProfileId] = useState<string | null>(null);
  const [selectedDealerId, setSelectedDealerId] = useState<string>("");
  const [selectedDealerTenant, setSelectedDealerTenant] = useState<string>("");

  useEffect(() => {
    console.log("[Parts] page mounted");
    console.log("[Parts] nav items loaded", PARTS_NAV_ITEMS);

    const syncSelectedDealer = () => {
      const storedProfileId = localStorage.getItem(SELECTED_DEALER_PROFILE_KEY);
      const latestCapture = loadLatestExtensionCapture();
      const matchedProfile =
        latestCapture?.tekionProfiles?.find((profile) => profile.id === storedProfileId) ?? null;

      setSelectedDealerProfileId(storedProfileId);
      setSelectedDealerId(matchedProfile?.dealerId ?? "");
      setSelectedDealerTenant(matchedProfile?.tenantName ?? "");

      console.log("[Parts] synced selected dealer profile", {
        storedProfileId,
        matchedDealerId: matchedProfile?.dealerId ?? null,
        matchedTenantName: matchedProfile?.tenantName ?? null,
      });
    };

    syncSelectedDealer();

    const unsubscribe = subscribeToExtensionCapture(() => {
      console.log("[Parts] extension capture update received, resyncing selected dealer");
      syncSelectedDealer();
    });

    const handleWindowFocus = () => {
      console.log("[Parts] window focused, resyncing selected dealer");
      syncSelectedDealer();
    };

    window.addEventListener("focus", handleWindowFocus);

    return () => {
      console.log("[Parts] page unmounted");
      unsubscribe();
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, []);

  useEffect(() => {
    console.log("[Parts] active section changed", { activeKey });
  }, [activeKey]);

  const activeItem = useMemo(() => {
    const found = PARTS_NAV_ITEMS.find((item) => item.key === activeKey);
    console.log("[Parts] resolving active item", { activeKey, found });
    return found ?? PARTS_NAV_ITEMS[0];
  }, [activeKey]);

  const activeView = useMemo(() => {
    console.log("[Parts] rendering active view", { activeKey });
    return renderActiveView(activeKey);
  }, [activeKey]);

  const selectedDealerDisplay = selectedDealerId || "Not Selected";
  const selectedDealerSubText = selectedDealerTenant
    ? selectedDealerTenant
    : selectedDealerProfileId
    ? "Dealer profile selected"
    : "Select a dealer in Settings to apply dealer-specific headers";

  return (
    <div style={PAGE_STYLE}>
      <div style={CONTAINER_STYLE}>
        <div style={HEADER_STYLE}>
          <div>
            <div style={TITLE_ROW_STYLE}>
              <div
                style={{
                  fontSize: 30,
                  fontWeight: 800,
                  color: "#f8fafc",
                  wordBreak: "break-word",
                }}
              >
                🧩 Parts
              </div>

              <div style={DEALER_PILL_STYLE}>
                <span style={{ color: "#94a3b8" }}>Selected Dealer ID</span>
                <span style={{ color: "#f8fafc", fontWeight: 800 }}>{selectedDealerDisplay}</span>
              </div>
            </div>

            <div
              style={{
                color: "#94a3b8",
                fontSize: 14,
                lineHeight: 1.7,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              Parts auto-configuration workspace
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

          <button
            className="btn-secondary btn-sm"
            onClick={() => {
              console.log("[Parts] back button clicked");
              onBack();
            }}
          >
            ← Back
          </button>
        </div>

        <div className="parts-responsive-grid" style={LAYOUT_STYLE}>
          <aside style={SIDEBAR_STYLE}>
            <div
              style={{
                color: "#f8fafc",
                fontSize: 14,
                fontWeight: 800,
                marginBottom: 10,
              }}
            >
              Parts Modules
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              {PARTS_NAV_ITEMS.map((item, index) => {
                const isActive = item.key === activeKey;

                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      console.log("[Parts] sidebar button clicked", {
                        index,
                        key: item.key,
                        label: item.label,
                      });
                      setActiveKey(item.key);
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: isActive
                        ? "1px solid rgba(59,130,246,0.45)"
                        : "1px solid rgba(255,255,255,0.08)",
                      background: isActive
                        ? "rgba(59,130,246,0.14)"
                        : "rgba(255,255,255,0.02)",
                      color: "#e2e8f0",
                      cursor: "pointer",
                      fontSize: 13,
                      fontWeight: 700,
                      lineHeight: 1.35,
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                    }}
                    title={item.label}
                  >
                    {index + 1}. {item.label}
                  </button>
                );
              })}
            </div>
          </aside>

          <main style={CONTENT_STYLE}>
            <div
              style={{
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
                padding: 18,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 800,
                      color: "#f8fafc",
                      marginBottom: 6,
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {activeItem.label}
                  </div>

                  <div
                    style={{
                      fontSize: 13,
                      color: "#94a3b8",
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {activeItem.description}
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                    <span style={{ color: "#f8fafc", fontWeight: 700 }}>{activeItem.label}</span>
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
              </div>
            </div>

            <div style={{ minWidth: 0 }}>{activeView}</div>
          </main>
        </div>
      </div>

      <style>
        {`
          @media (max-width: 980px) {
            .parts-responsive-grid {
              grid-template-columns: 1fr !important;
            }
          }
        `}
      </style>
    </div>
  );
};
