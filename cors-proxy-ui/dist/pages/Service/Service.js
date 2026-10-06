import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
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
import { loadLatestExtensionCapture, subscribeToExtensionCapture, } from "../../services/extensionBridge";
import { ServiceBlueprintProvider, useServiceBlueprint, } from "../../Context/Blueprint_Service_Context";
const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";
const SERVICE_ITEMS = [
    { key: "scheduling-settings", label: "1. Scheduling settings" },
    { key: "dealer-config", label: "2. Dealer config" },
    { key: "setup-fields", label: "3. Setup fields" },
    { key: "labor-pricing", label: "4. Labor pricing" },
    { key: "opcode-management", label: "5. Opcode management" },
    { key: "service-settings", label: "6. Service settings" },
    { key: "fees", label: "7. Fees" },
    { key: "coupons", label: "8. Coupons" },
    { key: "pdf", label: "9. Pdf" },
    { key: "check-in-setup", label: "10. Check in setup" },
    { key: "mpvi", label: "11. Mpvi" },
    { key: "dispatch-settings", label: "12. Dispatch Settings" },
];
const TopBlueprintBadges = () => {
    const { tekionId, hasBlueprint, blueprint, loading } = useServiceBlueprint();
    const answerCount = useMemo(() => {
        if (!blueprint)
            return 0;
        const rows = blueprint.populatedFlatRows ?? blueprint.allFields ?? [];
        return rows.filter((r) => r.decodedValue !== undefined && r.decodedValue !== null && r.decodedValue !== "").length;
    }, [blueprint]);
    return (_jsxs(_Fragment, { children: [_jsxs("div", { style: {
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
                }, children: [_jsx("span", { style: { color: "#94a3b8" }, children: "Tekion ID" }), _jsx("span", { style: { color: "#f8fafc", fontWeight: 800 }, children: tekionId ?? "Not Found" })] }), _jsx("div", { style: {
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: hasBlueprint
                        ? "1px solid rgba(34, 197, 94, 0.35)"
                        : "1px solid rgba(244, 63, 94, 0.35)",
                    background: hasBlueprint
                        ? "rgba(34, 197, 94, 0.12)"
                        : "rgba(244, 63, 94, 0.12)",
                    color: hasBlueprint ? "#86efac" : "#fca5a5",
                    fontSize: 12,
                    fontWeight: 700,
                    lineHeight: 1.2,
                    whiteSpace: "nowrap",
                }, children: loading ? ("Loading Blueprint...") : hasBlueprint ? (`✓ Blueprint Linked (${answerCount} answers)`) : ("⚠ No Blueprint Linked") })] }));
};
function renderServiceSection(activeKey) {
    switch (activeKey) {
        case "scheduling-settings":
            return _jsx(SchedulingSettingsView, {});
        case "dealer-config":
            return _jsx(DealerConfigView, {});
        case "setup-fields":
            return _jsx(SetupFieldsView, {});
        case "labor-pricing":
            return _jsx(LaborPricingView, {});
        case "opcode-management":
            return _jsx(OpcodeManagementView, {});
        case "service-settings":
            return _jsx(ServiceSettingsView, {});
        case "fees":
            return _jsx(FeesView, {});
        case "coupons":
            return _jsx(CouponsView, {});
        case "pdf":
            return _jsx(PdfView, {});
        case "check-in-setup":
            return _jsx(CheckInSetupView, {});
        case "mpvi":
            return _jsx(MpviView, {});
        case "dispatch-settings":
            return _jsx(DispatchSettingsView, {});
        default:
            return _jsx(SchedulingSettingsView, {});
    }
}
export const Service = ({ onBack }) => {
    const [activeKey, setActiveKey] = useState("scheduling-settings");
    const [selectedDealerProfileId, setSelectedDealerProfileId] = useState(null);
    const [selectedDealerId, setSelectedDealerId] = useState("");
    const [selectedDealerTenant, setSelectedDealerTenant] = useState("");
    useEffect(() => {
        const syncSelectedDealer = () => {
            const storedProfileId = localStorage.getItem(SELECTED_DEALER_PROFILE_KEY);
            const latestCapture = loadLatestExtensionCapture();
            const matchedProfile = latestCapture?.tekionProfiles?.find((profile) => profile.id === storedProfileId) ?? null;
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
    const activeMeta = useMemo(() => SERVICE_ITEMS.find((item) => item.key === activeKey) ?? SERVICE_ITEMS[0], [activeKey]);
    const selectedDealerDisplay = selectedDealerId || "Not Selected";
    const selectedDealerSubText = selectedDealerTenant
        ? selectedDealerTenant
        : selectedDealerProfileId
            ? "Dealer profile selected"
            : "Select a dealer in Settings to apply dealer-specific headers";
    return (_jsx(ServiceBlueprintProvider, { dealerId: selectedDealerId, children: _jsxs("div", { style: {
                minHeight: "100vh",
                maxHeight: "100vh",
                overflow: "auto",
                padding: "24px 16px 36px",
                boxSizing: "border-box",
            }, className: "service-page-scroll", children: [_jsx("style", { children: `
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
          ` }), _jsxs("div", { style: { maxWidth: 1400, margin: "0 auto", display: "grid", gap: 16 }, children: [_jsxs("div", { style: {
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 12,
                                flexWrap: "wrap",
                            }, children: [_jsxs("div", { children: [_jsxs("div", { style: {
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 10,
                                                flexWrap: "wrap",
                                                marginBottom: 4,
                                            }, children: [_jsx("div", { style: {
                                                        fontSize: 28,
                                                        fontWeight: 800,
                                                        color: "#f8fafc",
                                                    }, children: "\uD83D\uDEE0 Service" }), _jsxs("div", { style: {
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
                                                    }, children: [_jsx("span", { style: { color: "#94a3b8" }, children: "Selected Dealer ID" }), _jsx("span", { style: { color: "#f8fafc", fontWeight: 800 }, children: selectedDealerDisplay })] }), _jsx(TopBlueprintBadges, {})] }), _jsx("div", { style: {
                                                color: "#64748b",
                                                fontSize: 12,
                                                lineHeight: 1.6,
                                                marginTop: 4,
                                                whiteSpace: "pre-wrap",
                                                overflowWrap: "anywhere",
                                            }, children: selectedDealerSubText })] }), _jsx("button", { className: "btn-secondary btn-sm", onClick: onBack, children: "\u2190 Back" })] }), _jsxs("div", { style: {
                                display: "grid",
                                gridTemplateColumns: "320px minmax(0, 1fr)",
                                gap: 16,
                                alignItems: "start",
                            }, children: [_jsxs("div", { style: {
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
                                    }, className: "service-left-scroll", children: [_jsx("div", { style: {
                                                color: "#f8fafc",
                                                fontSize: 18,
                                                fontWeight: 800,
                                                padding: "4px 4px 2px",
                                            }, children: "Service Sections" }), _jsx("div", { style: { display: "grid", gap: 8 }, children: SERVICE_ITEMS.map((item) => {
                                                const isActive = item.key === activeKey;
                                                return (_jsx("button", { type: "button", onClick: () => setActiveKey(item.key), style: {
                                                        width: "100%",
                                                        textAlign: "left",
                                                        borderRadius: 14,
                                                        cursor: "pointer",
                                                        padding: "10px 14px",
                                                        border: isActive
                                                            ? "1px solid rgba(59,130,246,0.35)"
                                                            : "1px solid rgba(255,255,255,0.08)",
                                                        background: isActive
                                                            ? "rgba(59,130,246,0.12)"
                                                            : "rgba(255,255,255,0.02)",
                                                    }, children: _jsx("div", { style: {
                                                            color: isActive ? "#dbeafe" : "#f8fafc",
                                                            fontSize: 14,
                                                            fontWeight: 700,
                                                        }, children: item.label }) }, item.key));
                                            }) })] }), _jsxs("div", { style: {
                                        minWidth: 0,
                                        borderRadius: 18,
                                        border: "1px solid rgba(255,255,255,0.08)",
                                        background: "rgba(255,255,255,0.03)",
                                        padding: 18,
                                        maxHeight: "calc(100vh - 48px)",
                                        overflow: "auto",
                                    }, className: "service-content-scroll", children: [_jsx("div", { style: { marginBottom: 14 }, children: _jsx("div", { style: { color: "#f8fafc", fontSize: 18, fontWeight: 800 }, children: activeMeta.label }) }), renderServiceSection(activeKey)] })] })] })] }) }));
};
export default Service;
