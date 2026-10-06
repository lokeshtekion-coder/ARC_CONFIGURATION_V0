import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { PARTS_NAV_ITEMS } from "./partsConfig";
import { loadLatestExtensionCapture, subscribeToExtensionCapture, } from "../../services/extensionBridge";
import { PartsBlueprintProvider, usePartsBlueprint, } from "../../Context/Blueprint_Parts_Context";
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
const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";
const PAGE_STYLE = {
    height: "100vh",
    maxHeight: "1080px",
    overflowY: "auto",
    padding: "20px 16px 28px",
    boxSizing: "border-box",
};
const CONTAINER_STYLE = {
    maxWidth: 1400,
    margin: "0 auto",
    display: "grid",
    gap: 16,
};
const HEADER_STYLE = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
};
const LAYOUT_STYLE = {
    display: "grid",
    gridTemplateColumns: "240px minmax(0, 1fr)",
    gap: 16,
    alignItems: "start",
};
const SIDEBAR_STYLE = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: 13,
    position: "sticky",
    top: 10,
    maxHeight: "calc(100vh - 190px)",
    overflowY: "auto",
};
const CONTENT_STYLE = {
    minWidth: 0,
    display: "grid",
    gap: 1,
};
const TITLE_ROW_STYLE = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
};
const PILL_STYLE = {
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
function renderActiveView(activeKey) {
    switch (activeKey) {
        case "void-parts-reasons":
            return _jsx(VoidPartsReasonsView, {});
        case "code-setup":
            return _jsx(CodeSetupView, {});
        case "return-reasons":
            return _jsx(ReturnReasonsView, {});
        case "core-management-setup":
            return _jsx(CoreManagementSetupView, {});
        case "adjustment-reasons":
            return _jsx(AdjustmentReasonsView, {});
        case "coupons":
            return _jsx(CouponsView, {});
        case "fees":
            return _jsx(FeesView, {});
        case "price-code":
            return _jsx(PriceCodeView, {});
        case "price-break-formulas":
            return _jsx(PriceBreakFormulasView, {});
        case "customised-price-setup":
            return _jsx(CustomisedPriceSetupView, {});
        case "default-pricing":
            return _jsx(DefaultPricingView, {});
        case "warehouse-management":
            return _jsx(WarehouseManagementView, {});
        case "manufacturer":
            return _jsx(ManufacturerView, {});
        case "dealer-config":
            return _jsx(DealerConfigView, {});
        case "parts-settings":
            return _jsx(PartsSettingsView, {});
        case "user-reset":
            return _jsx(UserResetView, {});
        case "raise-oem-id-request":
            return _jsx(RaiseOemIdRequestView, {});
        default:
            return _jsx(VoidPartsReasonsView, {});
    }
}
const PartsLayout = ({ onBack, selectedDealerTenant, }) => {
    const [activeKey, setActiveKey] = useState("void-parts-reasons");
    const { selectedDealerId, tekionId, hasBlueprint, blueprint, loading, refresh, } = usePartsBlueprint();
    const activeView = useMemo(() => renderActiveView(activeKey), [activeKey]);
    const selectedDealerDisplay = selectedDealerId || "Not Selected";
    const selectedDealerSubText = selectedDealerTenant
        ? selectedDealerTenant
        : "Select a dealer in Settings to apply dealer-specific headers";
    const answeredCount = blueprint?.populatedFlatRows?.length ?? 0;
    return (_jsxs("div", { style: PAGE_STYLE, children: [_jsxs("div", { style: CONTAINER_STYLE, children: [_jsxs("div", { style: HEADER_STYLE, children: [_jsxs("div", { children: [_jsxs("div", { style: TITLE_ROW_STYLE, children: [_jsx("div", { style: { fontSize: 28, fontWeight: 800, color: "#f8fafc" }, children: "\uD83E\uDDE9 Parts" }), _jsxs("div", { style: PILL_STYLE, children: [_jsx("span", { style: { color: "#94a3b8" }, children: "Dealer ID:" }), _jsx("span", { style: { color: "#f8fafc", fontWeight: 800 }, children: selectedDealerDisplay })] }), tekionId && (_jsxs("div", { style: PILL_STYLE, children: [_jsx("span", { style: { color: "#94a3b8" }, children: "Tekion ID:" }), _jsx("span", { style: { color: "#60a5fa", fontWeight: 800, fontFamily: "monospace" }, children: tekionId })] })), _jsx("div", { style: {
                                                    ...PILL_STYLE,
                                                    borderColor: hasBlueprint
                                                        ? "rgba(34, 197, 94, 0.3)"
                                                        : "rgba(239, 68, 68, 0.3)",
                                                    background: hasBlueprint
                                                        ? "rgba(34, 197, 94, 0.08)"
                                                        : "rgba(239, 68, 68, 0.08)",
                                                    cursor: "pointer",
                                                }, onClick: () => void refresh(), title: "Click to re-check blueprint from IndexedDB", children: _jsx("span", { style: { color: hasBlueprint ? "#4ade80" : "#f87171", fontWeight: 700 }, children: loading
                                                        ? "↻ Resolving..."
                                                        : hasBlueprint
                                                            ? `✓ Blueprint Linked (${answeredCount} answers)`
                                                            : "✕ No Parts Blueprint" }) })] }), _jsx("div", { style: { color: "#64748b", fontSize: 12, marginTop: 4 }, children: selectedDealerSubText })] }), _jsx("button", { className: "btn-secondary btn-sm", onClick: onBack, children: "\u2190 Back" })] }), _jsxs("div", { className: "parts-responsive-grid", style: LAYOUT_STYLE, children: [_jsx("aside", { style: SIDEBAR_STYLE, children: _jsx("div", { style: { display: "grid", gap: 6 }, children: PARTS_NAV_ITEMS.map((item, index) => {
                                        const isActive = item.key === activeKey;
                                        return (_jsxs("button", { type: "button", onClick: () => setActiveKey(item.key), style: {
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
                                            }, title: item.label, children: [index + 1, ". ", item.label] }, item.key));
                                    }) }) }), _jsx("main", { style: CONTENT_STYLE, children: _jsx("div", { style: { minWidth: 0 }, children: activeView }) })] })] }), _jsx("style", { children: `
          @media (max-width: 1080px) {
            .parts-responsive-grid {
              grid-template-columns: 1fr !important;
            }
          }
        ` })] }));
};
export const Parts = (props) => {
    const [selectedDealerId, setSelectedDealerId] = useState("");
    const [selectedDealerTenant, setSelectedDealerTenant] = useState("");
    useEffect(() => {
        const syncSelectedDealer = () => {
            const storedProfileId = localStorage.getItem(SELECTED_DEALER_PROFILE_KEY);
            const latestCapture = loadLatestExtensionCapture();
            const matchedProfile = latestCapture?.tekionProfiles?.find((p) => p.id === storedProfileId) ?? null;
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
    return (_jsx(PartsBlueprintProvider, { dealerId: selectedDealerId, children: _jsx(PartsLayout, { ...props, selectedDealerTenant: selectedDealerTenant }) }));
};
export default Parts;
