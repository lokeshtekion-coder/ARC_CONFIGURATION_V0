import React, { useEffect, useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../../services/tekionApiSettings";
import { SUBSECTION_ITEMS, SUBSECTION_META } from "./constants";
import { useSchedulingApi } from "./hooks/useSchedulingApi";
import ConsumerSchedulingSection from "./sections/ConsumerSchedulingSection";
import GeneralSection from "./sections/GeneralSection";
import ServiceAdvisorsSection from "./sections/ServiceAdvisorsSection";
import ShopsSection from "./sections/ShopsSection";
import TransportationSection from "./sections/TransportationSection";
import type {
  ConsumerSchedulingResponse,
  DayState,
  OperationKey,
  SchedulingSubsectionKey,
  ShopRecord,
  TransportationSummaryRow,
  UiMessage,
} from "./types";
import {
  buildDefaultDayState,
  extractDealerIdFromHeaders,
  toEnabledHeaderMap,
} from "./utils";

type TransportationResultRow = {
  name: string;
  ok: boolean;
  text: string;
};

const cardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  padding: 16,
};

const badgeStyle: React.CSSProperties = {
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

const SchedulingSettingsView: React.FC = () => {
  const [subsection, setSubsection] = useState<SchedulingSubsectionKey>("consumer-scheduling");

  // FIX: Initialize with a valid OperationKey to satisfy strict TypeScript props in child components
  const [operation, setOperation] = useState<OperationKey>(
    SUBSECTION_META["consumer-scheduling"].ops[0]
  );

  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);

  const [consumerSettings, setConsumerSettings] = useState<ConsumerSchedulingResponse | null>(null);
  const [serviceAdvisorsRaw, setServiceAdvisorsRaw] = useState<unknown>(null);
  const [generalRaw, setGeneralRaw] = useState<unknown>(null);
  const [shops, setShops] = useState<ShopRecord[]>([]);
  const [transportationRows, setTransportationRows] = useState<TransportationSummaryRow[]>([]);
  const [transportationResult, setTransportationResult] = useState<TransportationResultRow[] | null>(null);

  const [advisorSchedule, setAdvisorSchedule] = useState<DayState>(buildDefaultDayState());
  const [shopSchedule, setShopSchedule] = useState<DayState>(buildDefaultDayState());

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
      } else if (subsection === "service-advisors") {
        const data = await api.fetchServiceAdvisors();
        setServiceAdvisorsRaw(data);
      } else if (subsection === "general") {
        const data = await api.fetchGeneralSettings();
        setGeneralRaw(data);
      } else if (subsection === "shops") {
        const data = await api.fetchShops();
        setShops(data);
      } else if (subsection === "transportation") {
        const data = await api.fetchTransportation();
        setTransportationRows(data);
      } else {
        setMessage({ ok: true, text: "Operation view ready." });
      }
    } catch (e: unknown) {
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Operation failed",
      });
    } finally {
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
      } else if (subsection === "service-advisors" && operation === "post") {
        const count = await api.autoConfigureServiceAdvisors(advisorSchedule);
        setMessage({
          ok: true,
          text: `Configured ${count} service advisor(s) successfully.`,
        });
      } else if (subsection === "general" && operation === "post") {
        const result = await api.postGeneralSettings();
        setMessage({ ok: true, text: result.message });
      } else if (subsection === "shops" && operation === "configure") {
        const result = await api.configureMainShop(shopSchedule);
        setShops(result.shops);
        setMessage({
          ok: true,
          text: `Main Shop configured successfully with ${result.serviceAdvisorCount} service advisor(s).`,
        });
      } else if (subsection === "transportation" && operation === "configure") {
        const result = await api.autoConfigureTransportation();
        setTransportationResult(result);
        setMessage({
          ok: true,
          text: `Transportation auto-config completed for ${result.length} item(s).`,
        });
      } else {
        setMessage({
          ok: true,
          text: "No execution needed for this operation.",
        });
      }
    } catch (e: unknown) {
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Execution failed",
      });
    } finally {
      setRunning(false);
    }
  };

  const sectionKey = `${subsection}-${operation || "none"}`;

  return (
    <div
      style={{
        display: "grid",
        gap: 16,
        maxHeight: "100%",
        overflow: "auto",
      }}
      className="service-scheduling-scroll"
    >
      <style>{`
        .service-scheduling-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .service-scheduling-scroll::-webkit-scrollbar-track { background: transparent; }
        .service-scheduling-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 8px; }
        .service-scheduling-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.24); }
      `}</style>

      <div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc", marginBottom: 6 }}>
          📅 Scheduling Settings
        </div>
        <div style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.6 }}>
          Configure scheduling-related service settings using Global Headers from Settings.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={badgeStyle}>
          Dealer ID: <b style={{ color: dealerId ? "#86efac" : "#fca5a5" }}>{dealerId || "Not found"}</b>
        </span>
        <span style={badgeStyle}>
          Global Headers: <b style={{ color: "#f8fafc" }}>{Object.keys(enabledHeaders).length}</b>
        </span>
      </div>

      <div style={{ ...cardStyle, display: "grid", gap: 14 }}>
        <div>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 8 }}>
            Subsections
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {SUBSECTION_ITEMS.map((item) => {
              const isActive = subsection === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={isActive ? "btn-primary" : "btn-secondary btn-sm"}
                  onClick={() => setSubsection(item.key)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          style={{
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.018)",
            padding: 14,
            display: "grid",
            gap: 12,
          }}
        >
          <div>
            <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 4 }}>
              {subsectionMeta.title}
            </div>
            <div style={{ color: "#94a3b8", fontSize: 13 }}>
              {subsectionMeta.description}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {subsectionMeta.ops.map((op) => {
              const active = operation === op;
              return (
                <button
                  key={op}
                  type="button"
                  className={active ? "btn-primary" : "btn-secondary btn-sm"}
                  onClick={() => setOperation(op)}
                >
                  {op.toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div key={sectionKey} style={{ display: "grid", gap: 16 }}>
        {subsection === "consumer-scheduling" && (
          <ConsumerSchedulingSection
            operation={operation}
            loading={loading}
            running={running}
            message={message}
            consumerSettings={consumerSettings}
            onLoad={() => void runLoad()}
            onExecute={() => void runExecute()}
          />
        )}

        {subsection === "transportation" && (
          <TransportationSection
            operation={operation}
            loading={loading}
            running={running}
            message={message}
            rows={transportationRows}
            result={transportationResult}
            onLoad={() => void runLoad()}
            onExecute={() => void runExecute()}
          />
        )}

        {subsection === "service-advisors" && (
          <ServiceAdvisorsSection
            operation={operation}
            loading={loading}
            running={running}
            message={message}
            serviceAdvisorsRaw={serviceAdvisorsRaw}
            advisorSchedule={advisorSchedule}
            setAdvisorSchedule={setAdvisorSchedule}
            onLoad={() => void runLoad()}
            onExecute={() => void runExecute()}
          />
        )}

        {subsection === "shops" && (
          <ShopsSection
            operation={operation}
            loading={loading}
            running={running}
            message={message}
            shops={shops}
            shopSchedule={shopSchedule}
            setShopSchedule={setShopSchedule}
            onLoad={() => void runLoad()}
            onExecute={() => void runExecute()}
          />
        )}

        {subsection === "general" && (
          <GeneralSection
            operation={operation}
            loading={loading}
            running={running}
            message={message}
            generalRaw={generalRaw}
            onLoad={() => void runLoad()}
            onExecute={() => void runExecute()}
          />
        )}
      </div>
    </div> // FIX: Missing closing tags added here
  );
};

export default SchedulingSettingsView;