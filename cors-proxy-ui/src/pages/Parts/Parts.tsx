import React, { useEffect, useMemo, useState } from "react";
import { PARTS_NAV_ITEMS, type PartsSectionKey } from "./partsConfig";
import {
  loadLatestExtensionCapture,
  subscribeToExtensionCapture,
} from "../../services/extensionBridge";
import {
  PartsBlueprintProvider,
  usePartsBlueprint,
} from "../../Context/Blueprint_Parts_Context";

import { VoidPartsReasonsView } from "./views/Void Parts Reasons";
import { CodeSetupView } from "./views/CodeSetupView";
import ReturnReasonsView from "./views/Return_Reasons/ReturnReasonsView";
import { CoreManagementSetupView } from "./views/CoreManagementSetupView";
import { AdjustmentReasonsView } from "./views/AdjustmentReasonsView";
import { CouponsView } from "./views/CouponsView";
import { FeesView } from "./views/Fees/index";
import { PriceCodeView } from "./views/PriceCodeView";
import { PriceBreakFormulasView } from "./views/PriceBreakFormulasView";
import { CustomisedPriceSetupView } from "./views/CustomisedPriceSetupView";
import { DefaultPricingView } from "./views/DefaultPricingView";
import { WarehouseManagementView } from "./views/WarehouseManagementView";
import { ManufacturerView } from "./views/ManufacturerView";
import { DealerConfigView } from "./views/Dealer_Configuration/DealerConfigView";
import PartsSettingsView from "./views/Parts_Settings_PDFs";
import { UserResetView } from "./views/User Setup";
import { RaiseOemIdRequestView } from "./views/OEM ID/RaiseOemIdRequestView";

interface Props {
  onBack: () => void;
}

interface PartsNavItem {
  key: PartsSectionKey;
  label: string;
}

const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";

const PAGE_STYLE: React.CSSProperties = {
  height: "100vh",
  maxHeight: "1080px",
  overflowY: "auto",
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
  gap: 16,
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
  padding: 13,
  position: "sticky",
  top: 10,
  maxHeight: "calc(100vh - 190px)",
  overflowY: "auto",
};

const CONTENT_STYLE: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 1,
};

const TITLE_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const PILL_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 12px",
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

const PartsLayout: React.FC<Props & { selectedDealerTenant: string }> = ({
  onBack,
  selectedDealerTenant,
}) => {
  const [activeKey, setActiveKey] = useState<PartsSectionKey>("void-parts-reasons");
  const {
    selectedDealerId,
    tekionId,
    hasBlueprint,
    blueprint,
    loading,
    refresh,
  } = usePartsBlueprint();

  const activeView = useMemo(() => renderActiveView(activeKey), [activeKey]);

  const selectedDealerDisplay = selectedDealerId || "Not Selected";
  const selectedDealerSubText = selectedDealerTenant
    ? selectedDealerTenant
    : "Select a dealer in Settings to apply dealer-specific headers";

  const answeredCount = blueprint?.populatedFlatRows?.length ?? 0;

  return (
    <div style={PAGE_STYLE}>
      <div style={CONTAINER_STYLE}>
        <div style={HEADER_STYLE}>
          <div>
            <div style={TITLE_ROW_STYLE}>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#f8fafc" }}>
                🧩 Parts
              </div>

              <div style={PILL_STYLE}>
                <span style={{ color: "#94a3b8" }}>Dealer ID:</span>
                <span style={{ color: "#f8fafc", fontWeight: 800 }}>
                  {selectedDealerDisplay}
                </span>
              </div>

              {tekionId && (
                <div style={PILL_STYLE}>
                  <span style={{ color: "#94a3b8" }}>Tekion ID:</span>
                  <span style={{ color: "#60a5fa", fontWeight: 800, fontFamily: "monospace" }}>
                    {tekionId}
                  </span>
                </div>
              )}

              <div
                style={{
                  ...PILL_STYLE,
                  borderColor: hasBlueprint
                    ? "rgba(34, 197, 94, 0.3)"
                    : "rgba(239, 68, 68, 0.3)",
                  background: hasBlueprint
                    ? "rgba(34, 197, 94, 0.08)"
                    : "rgba(239, 68, 68, 0.08)",
                  cursor: "pointer",
                }}
                onClick={() => void refresh()}
                title="Click to re-check blueprint from IndexedDB"
              >
                <span style={{ color: hasBlueprint ? "#4ade80" : "#f87171", fontWeight: 700 }}>
                  {loading
                    ? "↻ Resolving..."
                    : hasBlueprint
                    ? `✓ Blueprint Linked (${answeredCount} answers)`
                    : "✕ No Parts Blueprint"}
                </span>
              </div>
            </div>

            <div style={{ color: "#64748b", fontSize: 12, marginTop: 4 }}>
              {selectedDealerSubText}
            </div>
          </div>

          <button className="btn-secondary btn-sm" onClick={onBack}>
            ← Back
          </button>
        </div>

        <div className="parts-responsive-grid" style={LAYOUT_STYLE}>
          <aside style={SIDEBAR_STYLE}>
            <div style={{ display: "grid", gap: 6 }}>
              {PARTS_NAV_ITEMS.map((item: PartsNavItem, index: number) => {
                const isActive = item.key === activeKey;

                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setActiveKey(item.key)}
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
            <div style={{ minWidth: 0 }}>{activeView}</div>
          </main>
        </div>
      </div>

      <style>
        {`
          @media (max-width: 1080px) {
            .parts-responsive-grid {
              grid-template-columns: 1fr !important;
            }
          }
        `}
      </style>
    </div>
  );
};

export const Parts: React.FC<Props> = (props) => {
  const [selectedDealerId, setSelectedDealerId] = useState<string>("");
  const [selectedDealerTenant, setSelectedDealerTenant] = useState<string>("");

  useEffect(() => {
    const syncSelectedDealer = () => {
      const storedProfileId = localStorage.getItem(SELECTED_DEALER_PROFILE_KEY);
      const latestCapture = loadLatestExtensionCapture();
      const matchedProfile =
        latestCapture?.tekionProfiles?.find((p) => p.id === storedProfileId) ?? null;

      setSelectedDealerId(matchedProfile?.dealerId ?? "");
      setSelectedDealerTenant(matchedProfile?.tenantName ?? "");
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

  return (
    <PartsBlueprintProvider dealerId={selectedDealerId}>
      <PartsLayout {...props} selectedDealerTenant={selectedDealerTenant} />
    </PartsBlueprintProvider>
  );
};

export default Parts;