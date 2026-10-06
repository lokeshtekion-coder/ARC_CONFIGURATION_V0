import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../../services/tekionApiSettings";
import { SUBSECTION_ITEMS, SUBSECTION_META } from "./constants";
import { useSchedulingApi } from "./hooks/useSchedulingApi";
import ConsumerSchedulingSection from "./sections/ConsumerSchedulingSection";
import GeneralSection from "./sections/GeneralSection";
import ServiceAdvisorsSection from "./sections/ServiceAdvisorsSection";
import ShopsSection from "./sections/ShopsSection";
import TransportationSection from "./sections/TransportationSection";
import { buildDefaultDayState, extractDealerIdFromHeaders, toEnabledHeaderMap, } from "./utils";
const cardStyle = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    padding: 16,
};
const badgeStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#cbd5e1",
    fontSize: 12,
};
const SchedulingSettingsView = () => {
    const [subsection, setSubsection] = useState("consumer-scheduling");
    // FIX: Initialize with a valid OperationKey to satisfy strict TypeScript props in child components
    const [operation, setOperation] = useState(SUBSECTION_META["consumer-scheduling"].ops[0]);
    const [loading, setLoading] = useState(false);
    const [running, setRunning] = useState(false);
    const [message, setMessage] = useState(null);
    const [consumerSettings, setConsumerSettings] = useState(null);
    const [serviceAdvisorsRaw, setServiceAdvisorsRaw] = useState(null);
    const [generalRaw, setGeneralRaw] = useState(null);
    const [shops, setShops] = useState([]);
    const [transportationRows, setTransportationRows] = useState([]);
    const [transportationResult, setTransportationResult] = useState(null);
    const [advisorSchedule, setAdvisorSchedule] = useState(buildDefaultDayState());
    const [shopSchedule, setShopSchedule] = useState(buildDefaultDayState());
    const enabledHeaders = useMemo(() => toEnabledHeaderMap(loadGlobalHeaders()), []);
    const dealerId = useMemo(() => extractDealerIdFromHeaders(enabledHeaders), [enabledHeaders]);
    const subsectionMeta = useMemo(() => SUBSECTION_META[subsection], [subsection]);
    const api = useSchedulingApi({
        enabledHeaders,
        dealerId,
    });
    const resetViewState = () => {
        setMessage(null);
        setConsumerSettings(null);
        setServiceAdvisorsRaw(null);
        setGeneralRaw(null);
        setShops([]);
        setTransportationRows([]);
        setTransportationResult(null);
        setLoading(false);
        setRunning(false);
    };
    useEffect(() => {
        // FIX: Set operation to the first valid op of the new subsection
        setOperation(SUBSECTION_META[subsection].ops[0]);
        resetViewState();
    }, [subsection]);
    useEffect(() => {
        setMessage(null);
    }, [operation]);
    const runLoad = async () => {
        setLoading(true);
        setMessage(null);
        try {
            if (!dealerId) {
                throw new Error("Dealer ID not found in Global Headers. Please set Global Headers first.");
            }
            if (subsection === "consumer-scheduling") {
                const data = await api.fetchConsumerScheduling();
                setConsumerSettings(data);
            }
            else if (subsection === "service-advisors") {
                const data = await api.fetchServiceAdvisors();
                setServiceAdvisorsRaw(data);
            }
            else if (subsection === "general") {
                const data = await api.fetchGeneralSettings();
                setGeneralRaw(data);
            }
            else if (subsection === "shops") {
                const data = await api.fetchShops();
                setShops(data);
            }
            else if (subsection === "transportation") {
                const data = await api.fetchTransportation();
                setTransportationRows(data);
            }
            else {
                setMessage({ ok: true, text: "Operation view ready." });
            }
        }
        catch (e) {
            setMessage({
                ok: false,
                text: e instanceof Error ? e.message : "Operation failed",
            });
        }
        finally {
            setLoading(false);
        }
    };
    const runExecute = async () => {
        setRunning(true);
        setMessage(null);
        try {
            if (subsection === "consumer-scheduling" && operation === "put") {
                const result = await api.autoConfigureConsumerScheduling();
                setConsumerSettings(result.current);
                setMessage({ ok: true, text: result.message });
            }
            else if (subsection === "service-advisors" && operation === "post") {
                const count = await api.autoConfigureServiceAdvisors(advisorSchedule);
                setMessage({
                    ok: true,
                    text: `Configured ${count} service advisor(s) successfully.`,
                });
            }
            else if (subsection === "general" && operation === "post") {
                const result = await api.postGeneralSettings();
                setMessage({ ok: true, text: result.message });
            }
            else if (subsection === "shops" && operation === "configure") {
                const result = await api.configureMainShop(shopSchedule);
                setShops(result.shops);
                setMessage({
                    ok: true,
                    text: `Main Shop configured successfully with ${result.serviceAdvisorCount} service advisor(s).`,
                });
            }
            else if (subsection === "transportation" && operation === "configure") {
                const result = await api.autoConfigureTransportation();
                setTransportationResult(result);
                setMessage({
                    ok: true,
                    text: `Transportation auto-config completed for ${result.length} item(s).`,
                });
            }
            else {
                setMessage({
                    ok: true,
                    text: "No execution needed for this operation.",
                });
            }
        }
        catch (e) {
            setMessage({
                ok: false,
                text: e instanceof Error ? e.message : "Execution failed",
            });
        }
        finally {
            setRunning(false);
        }
    };
    const sectionKey = `${subsection}-${operation || "none"}`;
    return (_jsxs("div", { style: {
            display: "grid",
            gap: 16,
            maxHeight: "100%",
            overflow: "auto",
        }, className: "service-scheduling-scroll", children: [_jsx("style", { children: `
        .service-scheduling-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .service-scheduling-scroll::-webkit-scrollbar-track { background: transparent; }
        .service-scheduling-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 8px; }
        .service-scheduling-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.24); }
      ` }), _jsx("div", {}), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsxs("span", { style: badgeStyle, children: ["Dealer ID: ", _jsx("b", { style: { color: dealerId ? "#86efac" : "#fca5a5" }, children: dealerId || "Not found" })] }), _jsxs("span", { style: badgeStyle, children: ["Global Headers: ", _jsx("b", { style: { color: "#f8fafc" }, children: Object.keys(enabledHeaders).length })] })] }), _jsxs("div", { style: { ...cardStyle, display: "grid", gap: 14 }, children: [_jsxs("div", { children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 8 }, children: "Subsections" }), _jsx("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: SUBSECTION_ITEMS.map((item) => {
                                    const isActive = subsection === item.key;
                                    return (_jsx("button", { type: "button", className: isActive ? "btn-primary" : "btn-secondary btn-sm", onClick: () => setSubsection(item.key), children: item.label }, item.key));
                                }) })] }), _jsxs("div", { style: {
                            borderRadius: 14,
                            border: "1px solid rgba(255,255,255,0.06)",
                            background: "rgba(255,255,255,0.018)",
                            padding: 14,
                            display: "grid",
                            gap: 12,
                        }, children: [_jsxs("div", { children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 4 }, children: subsectionMeta.title }), _jsx("div", { style: { color: "#94a3b8", fontSize: 13 }, children: subsectionMeta.description })] }), _jsx("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: subsectionMeta.ops.map((op) => {
                                    const active = operation === op;
                                    return (_jsx("button", { type: "button", className: active ? "btn-primary" : "btn-secondary btn-sm", onClick: () => setOperation(op), children: op.toUpperCase() }, op));
                                }) })] })] }), _jsxs("div", { style: { display: "grid", gap: 16 }, children: [subsection === "consumer-scheduling" && (_jsx(ConsumerSchedulingSection, { operation: operation, loading: loading, running: running, message: message, consumerSettings: consumerSettings, onLoad: () => void runLoad(), onExecute: () => void runExecute() })), subsection === "transportation" && (_jsx(TransportationSection, { operation: operation, loading: loading, running: running, message: message, rows: transportationRows, result: transportationResult, onLoad: () => void runLoad(), onExecute: () => void runExecute() })), subsection === "service-advisors" && (_jsx(ServiceAdvisorsSection, { operation: operation, loading: loading, running: running, message: message, serviceAdvisorsRaw: serviceAdvisorsRaw, advisorSchedule: advisorSchedule, setAdvisorSchedule: setAdvisorSchedule, onLoad: () => void runLoad(), onExecute: () => void runExecute() })), subsection === "shops" && (_jsx(ShopsSection, { operation: operation, loading: loading, running: running, message: message, shops: shops, shopSchedule: shopSchedule, setShopSchedule: setShopSchedule, onLoad: () => void runLoad(), onExecute: () => void runExecute() })), subsection === "general" && (_jsx(GeneralSection, { operation: operation, loading: loading, running: running, message: message, generalRaw: generalRaw, onLoad: () => void runLoad(), onExecute: () => void runExecute() }))] }, sectionKey)] }) // FIX: Missing closing tags added here
    );
};
export default SchedulingSettingsView;
