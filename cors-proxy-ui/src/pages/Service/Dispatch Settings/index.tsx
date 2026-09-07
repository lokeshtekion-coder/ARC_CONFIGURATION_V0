import React, { useCallback, useEffect, useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";

type ViewKey = "home" | "get" | "post";
type LogLevel = "debug" | "info" | "warn" | "error" | "success";

type UiMessage = {
  ok: boolean;
  text: string;
};

type ExecutionLog = {
  id: string;
  time: string;
  level: LogLevel;
  message: string;
  meta?: unknown;
};

type DispatchGeneralSettings = {
  dealerId?: string;
  tenantId?: string;
  maxRoIdleTimeInMin?: number;
  reserveTechnicians?: boolean;
  jobDispatchSetting?: {
    autoAssignTechToJob?: boolean;
    chooseAmongTechsInRo?: boolean;
    requiredMatchingSkills?: boolean;
    [key: string]: unknown;
  };
  recommendationDispatchSetting?: {
    autoAssignTechToRecommendation?: boolean;
    autoAssignTechToDeferredRecommendation?: boolean;
    requiredMatchingSkills?: boolean;
    [key: string]: unknown;
  };
  returnJobDispatchSetting?: {
    assignTechFromReturnJob?: boolean;
    [key: string]: unknown;
  };
  dispatchAcrossTeams?: {
    allowDispatchAcrossTeams?: boolean;
    teamCompositions?: unknown[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type ValidationResult = {
  isValid: boolean;
  issues: string[];
};

const DISPATCH_SETTINGS_URL =
  "https://preprodapp.tekioncloud.com/api/service-module/u/dispatch-settings/generalsettings";

const logger = {
  debug: (...args: unknown[]) => console.debug("[DispatchSettings]", ...args),
  info: (...args: unknown[]) => console.info("[DispatchSettings]", ...args),
  warn: (...args: unknown[]) => console.warn("[DispatchSettings]", ...args),
  error: (...args: unknown[]) => console.error("[DispatchSettings]", ...args),
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function toEnabledHeaderMap(headers: KeyValuePair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of headers) {
    if (!row?.enabled) continue;
    const key = normalize(row.key);
    const value = normalize(row.value);
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function findHeaderValueCaseInsensitive(
  headers: Record<string, string>,
  candidates: string[]
): string {
  const entries = Object.entries(headers);
  for (const candidate of candidates) {
    const found = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
    if (found?.[1]) return normalize(found[1]);
  }
  return "";
}

function extractDealerIdFromHeaders(headers: Record<string, string>): string {
  return findHeaderValueCaseInsensitive(headers, [
    "dealerid",
    "dealerId",
    "dealer-id",
    "x-dealer-id",
  ]);
}

function validateSettings(current: DispatchGeneralSettings | null): ValidationResult {
  const issues: string[] = [];

  if (!current?.jobDispatchSetting?.autoAssignTechToJob) {
    issues.push("Auto-assign tech to jobs is disabled");
  }

  if (!current?.recommendationDispatchSetting?.autoAssignTechToRecommendation) {
    issues.push("Auto-assign tech to recommendations is disabled");
  }

  if (!current?.recommendationDispatchSetting?.autoAssignTechToDeferredRecommendation) {
    issues.push("Auto-assign tech to deferred recommendations is disabled");
  }

  if (!current?.returnJobDispatchSetting?.assignTechFromReturnJob) {
    issues.push("Assign tech from return jobs is disabled");
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}

function getStatusTone(ok: boolean): React.CSSProperties {
  return {
    color: ok ? "#bbf7d0" : "#fecaca",
    background: ok ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
    border: ok
      ? "1px solid rgba(34,197,94,0.22)"
      : "1px solid rgba(239,68,68,0.22)",
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 13,
  };
}

const badgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "#cbd5e1",
  fontSize: 12,
  whiteSpace: "nowrap",
};

const cardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  padding: 16,
  minWidth: 0,
};

const monoStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  color: "#e2e8f0",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

function scrollWrapStyle(maxHeight: number): React.CSSProperties {
  return {
    maxHeight,
    overflowY: "auto",
    overflowX: "auto",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.06)",
  };
}

function getBoolBadge(value: boolean | undefined, trueText = "Enabled", falseText = "Disabled") {
  const ok = Boolean(value);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 700,
        color: ok ? "#86efac" : "#fca5a5",
        background: ok ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
        border: ok
          ? "1px solid rgba(34,197,94,0.22)"
          : "1px solid rgba(239,68,68,0.22)",
      }}
    >
      {ok ? `✅ ${trueText}` : `❌ ${falseText}`}
    </span>
  );
}

const DispatchSettingsView: React.FC = () => {
  const [headerMap, setHeaderMap] = useState<Record<string, string>>({});
  const [activeView, setActiveView] = useState<ViewKey>("home");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);

  const [settingsData, setSettingsData] = useState<DispatchGeneralSettings | null>(null);
  const [rawResponse, setRawResponse] = useState<unknown>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<ExecutionLog[]>([]);

  const dealerId = useMemo(() => extractDealerIdFromHeaders(headerMap), [headerMap]);
  const headerCount = useMemo(() => Object.keys(headerMap).length, [headerMap]);

  const validation = useMemo(() => validateSettings(settingsData), [settingsData]);

  const appendLog = useCallback((level: LogLevel, text: string, meta?: unknown) => {
    const time = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const entry: ExecutionLog = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time,
      level,
      message: text,
      meta,
    };

    setExecutionLogs((prev) => [entry, ...prev].slice(0, 200));

    if (level === "error") logger.error(text, meta);
    else if (level === "warn") logger.warn(text, meta);
    else if (level === "debug") logger.debug(text, meta);
    else if (level === "success") logger.info(`SUCCESS: ${text}`, meta);
    else logger.info(text, meta);
  }, []);

  const clearLogs = useCallback(() => {
    setExecutionLogs([]);
  }, []);

  const refreshHeaders = useCallback(() => {
    try {
      const loaded = toEnabledHeaderMap(loadGlobalHeaders());
      setHeaderMap(loaded);
      appendLog("info", "Global headers refreshed", {
        headerCount: Object.keys(loaded).length,
        dealerId: extractDealerIdFromHeaders(loaded),
        headerKeys: Object.keys(loaded),
      });
    } catch (e) {
      appendLog("error", "Failed to refresh global headers", e);
      setHeaderMap({});
    }
  }, [appendLog]);

  useEffect(() => {
    appendLog("info", "Dispatch Settings view mounted");
    refreshHeaders();
  }, [appendLog, refreshHeaders]);

  const proxyRequest = useCallback(
    async (payload: {
      url: string;
      method: "GET" | "PUT";
      body?: unknown;
    }) => {
      appendLog("info", "Proxy request started", {
        method: payload.method,
        url: payload.url,
        dealerId,
        headerCount,
      });

      const res = await fetch("http://localhost:4000/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: payload.url,
          method: payload.method,
          headers: {
            ...headerMap,
            ...(payload.body ? { "content-type": "application/json" } : {}),
          },
          body: payload.body,
          timeout: 60000,
        }),
      });

      if (!res.ok) {
        appendLog("error", "Proxy HTTP failure", {
          status: res.status,
          url: payload.url,
        });
        throw new Error(`Proxy request failed with HTTP ${res.status}`);
      }

      const json = await res.json();

      appendLog("debug", "Proxy response envelope", {
        status: json?.status,
        statusText: json?.statusText,
        topLevelKeys: json && typeof json === "object" ? Object.keys(json) : [],
      });

      if ((json?.status ?? 200) >= 400) {
        appendLog("error", "Proxy logical failure", {
          status: json?.status,
          statusText: json?.statusText,
          url: payload.url,
        });
        throw new Error(
          `${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim()
        );
      }

      return json?.body ?? json?.data ?? json;
    },
    [appendLog, dealerId, headerCount, headerMap]
  );

  const fetchDispatchSettings = useCallback(async () => {
    appendLog("info", "Fetching current dispatch settings");

    const start = performance.now();
    const response = await proxyRequest({
      url: DISPATCH_SETTINGS_URL,
      method: "GET",
    });
    const end = performance.now();

    const data = ((response as any)?.data ?? response) as DispatchGeneralSettings;

    setRawResponse(response);
    setSettingsData(data);

    appendLog("success", "Dispatch settings fetched successfully", {
      durationMs: Number((end - start).toFixed(2)),
      dealerId: data?.dealerId,
      tenantId: data?.tenantId,
    });

    return data;
  }, [appendLog, proxyRequest]);

  const handleGet = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    clearLogs();

    try {
      const data = await fetchDispatchSettings();
      setMessage({
        ok: true,
        text: `Dispatch settings loaded successfully for dealer ${data?.dealerId || dealerId || "N/A"}.`,
      });
    } catch (e: unknown) {
      appendLog("error", "GET dispatch settings failed", e);
      setSettingsData(null);
      setRawResponse(null);
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Failed to fetch dispatch settings",
      });
    } finally {
      setLoading(false);
    }
  }, [appendLog, clearLogs, dealerId, fetchDispatchSettings]);

  const handleValidateAndConfigure = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    clearLogs();

    try {
      appendLog("info", "Validate & Configure flow started");

      const current = await fetchDispatchSettings();
      const result = validateSettings(current);

      appendLog("info", "Validation result computed", result);

      if (result.isValid) {
        appendLog("success", "Dispatch settings already configured");
        setMessage({
          ok: true,
          text: "Dispatch Settings already configured. All automation is enabled.",
        });
        return;
      }

      const updatePayload = {
        jobDispatchSetting: {
          autoAssignTechToJob: true,
        },
        recommendationDispatchSetting: {
          autoAssignTechToRecommendation: true,
          autoAssignTechToDeferredRecommendation: true,
        },
        returnJobDispatchSetting: {
          assignTechFromReturnJob: true,
        },
      };

      appendLog("info", "Update payload prepared", updatePayload);

      await proxyRequest({
        url: DISPATCH_SETTINGS_URL,
        method: "PUT",
        body: updatePayload,
      });

      appendLog("success", "Dispatch settings updated successfully");

      const refreshed = await fetchDispatchSettings();

      setMessage({
        ok: true,
        text: `Dispatch Settings updated successfully for dealer ${refreshed?.dealerId || dealerId || "N/A"}.`,
      });
    } catch (e: unknown) {
      appendLog("error", "Validate & Configure failed", e);
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Failed to configure dispatch settings",
      });
    } finally {
      setLoading(false);
    }
  }, [appendLog, clearLogs, dealerId, fetchDispatchSettings, proxyRequest]);

  const settings = settingsData;
  const jobSettings = settings?.jobDispatchSetting || {};
  const recSettings = settings?.recommendationDispatchSetting || {};
  const returnSettings = settings?.returnJobDispatchSetting || {};
  const teamSettings = settings?.dispatchAcrossTeams || {};

  return (
    <div
      style={{
        display: "grid",
        gap: 16,
        maxHeight: "100%",
        overflow: "auto",
      }}
      className="dispatch-settings-scroll"
    >
      <style>{`
        .dispatch-settings-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .dispatch-settings-scroll::-webkit-scrollbar-track { background: transparent; }
        .dispatch-settings-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 8px; }
        .dispatch-settings-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.24); }
      `}</style>

      <div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc", marginBottom: 6 }}>
          🚀 Dispatch Settings
        </div>
        <div style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.6 }}>
          View, validate, and configure automatic dispatch settings for jobs, recommendations, return jobs, and team dispatch using Global Headers.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={badgeStyle}>
          Dealer ID: <b style={{ color: dealerId ? "#86efac" : "#fca5a5" }}>{dealerId || "Not found"}</b>
        </span>
        <span style={badgeStyle}>
          Global Headers: <b style={{ color: "#f8fafc" }}>{headerCount}</b>
        </span>
        <span style={badgeStyle}>
          Endpoint: <b style={{ color: "#f8fafc" }}>dispatch-settings/generalsettings</b>
        </span>
      </div>

      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 12,
          }}
        >
          <div>
            <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800, marginBottom: 4 }}>
              Actions
            </div>
            <div style={{ color: "#94a3b8", fontSize: 13 }}>
              Fetch current settings or validate and auto-configure recommended dispatch automation.
            </div>
          </div>

          <button className="btn-secondary btn-sm" onClick={refreshHeaders}>
            ⟳ Refresh Headers
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button
            className={activeView === "home" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => setActiveView("home")}
          >
            Home
          </button>
          <button
            className={activeView === "get" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => setActiveView("get")}
          >
            📥 GET Settings
          </button>
          <button
            className={activeView === "post" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => setActiveView("post")}
          >
            🚀 Configure & Validate
          </button>
        </div>

        {message ? <div style={getStatusTone(message.ok)}>{message.text}</div> : null}
      </div>

      {activeView === "home" ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
              Quick Actions
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 12,
              }}
            >
              <button
                className="btn-primary"
                onClick={() => {
                  setActiveView("get");
                  void handleGet();
                }}
                disabled={loading || headerCount === 0}
                style={{ minHeight: 68 }}
              >
                {loading ? "Loading..." : "📥 View Dispatch Settings"}
              </button>

              <button
                className="btn-secondary btn-sm"
                onClick={() => {
                  setActiveView("post");
                }}
                style={{ minHeight: 68 }}
              >
                🚀 Open Configure & Validate
              </button>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
              What this automation checks
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.02)",
                  padding: 14,
                }}
              >
                <div style={{ color: "#f8fafc", fontWeight: 800, marginBottom: 6 }}>
                  🔧 Job Dispatch
                </div>
                <div style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.6 }}>
                  Ensures auto-assign tech to jobs is enabled.
                </div>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.02)",
                  padding: 14,
                }}
              >
                <div style={{ color: "#f8fafc", fontWeight: 800, marginBottom: 6 }}>
                  💡 Recommendations
                </div>
                <div style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.6 }}>
                  Enables recommendation and deferred recommendation auto-assignment.
                </div>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.02)",
                  padding: 14,
                }}
              >
                <div style={{ color: "#f8fafc", fontWeight: 800, marginBottom: 6 }}>
                  🔄 Return Jobs
                </div>
                <div style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.6 }}>
                  Ensures assign tech from return job is enabled.
                </div>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.02)",
                  padding: 14,
                }}
              >
                <div style={{ color: "#f8fafc", fontWeight: 800, marginBottom: 6 }}>
                  👥 Team Dispatch
                </div>
                <div style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.6 }}>
                  Shows cross-team dispatch and team composition visibility.
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeView === "get" ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={cardStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 4 }}>
                  View Dispatch Settings
                </div>
                <div style={{ color: "#94a3b8", fontSize: 13 }}>
                  Retrieves and displays current dispatch configuration.
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn-primary"
                  onClick={() => void handleGet()}
                  disabled={loading || headerCount === 0}
                >
                  {loading ? "Fetching..." : "📥 Get Dispatch Settings"}
                </button>

                {rawResponse ? (
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => setShowRawJson((v) => !v)}
                  >
                    {showRawJson ? "Hide Raw JSON" : "Show Raw JSON"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {settings ? (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={badgeStyle}>
                  Dealer: <b style={{ color: "#f8fafc" }}>{settings.dealerId || "N/A"}</b>
                </span>
                <span style={badgeStyle}>
                  Tenant: <b style={{ color: "#f8fafc" }}>{settings.tenantId || "N/A"}</b>
                </span>
                <span style={badgeStyle}>
                  Validation:{" "}
                  <b style={{ color: validation.isValid ? "#86efac" : "#fcd34d" }}>
                    {validation.isValid ? "Already Configured" : "Needs Update"}
                  </b>
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: 12,
                }}
              >
                <div style={cardStyle}>
                  <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 10 }}>
                    🔧 Job Dispatch Settings
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <span style={{ color: "#e2e8f0", fontSize: 13 }}>Auto-assign Tech to Job</span>
                      {getBoolBadge(jobSettings.autoAssignTechToJob)}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <span style={{ color: "#e2e8f0", fontSize: 13 }}>Choose Among Techs in RO</span>
                      {getBoolBadge(jobSettings.chooseAmongTechsInRo)}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <span style={{ color: "#e2e8f0", fontSize: 13 }}>Required Matching Skills</span>
                      {getBoolBadge(jobSettings.requiredMatchingSkills)}
                    </div>
                  </div>
                </div>

                <div style={cardStyle}>
                  <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 10 }}>
                    💡 Recommendation Dispatch
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <span style={{ color: "#e2e8f0", fontSize: 13 }}>Auto-assign Tech to Recommendation</span>
                      {getBoolBadge(recSettings.autoAssignTechToRecommendation)}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <span style={{ color: "#e2e8f0", fontSize: 13 }}>Auto-assign Deferred Recommendation</span>
                      {getBoolBadge(recSettings.autoAssignTechToDeferredRecommendation)}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <span style={{ color: "#e2e8f0", fontSize: 13 }}>Required Matching Skills</span>
                      {getBoolBadge(recSettings.requiredMatchingSkills)}
                    </div>
                  </div>
                </div>

                <div style={cardStyle}>
                  <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 10 }}>
                    🔄 Return Jobs
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <span style={{ color: "#e2e8f0", fontSize: 13 }}>Assign Tech from Return Job</span>
                      {getBoolBadge(returnSettings.assignTechFromReturnJob)}
                    </div>
                  </div>
                </div>

                <div style={cardStyle}>
                  <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 10 }}>
                    👥 Team Dispatch
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <span style={{ color: "#e2e8f0", fontSize: 13 }}>Allow Dispatch Across Teams</span>
                      {getBoolBadge(teamSettings.allowDispatchAcrossTeams)}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <span style={{ color: "#e2e8f0", fontSize: 13 }}>Team Compositions</span>
                      <span style={{ color: "#f8fafc", fontWeight: 700, fontSize: 13 }}>
                        {Array.isArray(teamSettings.teamCompositions)
                          ? teamSettings.teamCompositions.length
                          : 0}
                      </span>
                    </div>
                  </div>
                </div>

                <div style={cardStyle}>
                  <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 10 }}>
                    ⚙️ Additional Settings
                  </div>
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <span style={{ color: "#e2e8f0", fontSize: 13 }}>Max RO Idle Time</span>
                      <span style={{ color: "#f8fafc", fontWeight: 700, fontSize: 13 }}>
                        {settings.maxRoIdleTimeInMin ? `${settings.maxRoIdleTimeInMin} min` : "Not set"}
                      </span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <span style={{ color: "#e2e8f0", fontSize: 13 }}>Reserve Technicians</span>
                      {getBoolBadge(settings.reserveTechnicians)}
                    </div>
                  </div>
                </div>
              </div>

              {!validation.isValid ? (
                <div style={cardStyle}>
                  <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 10 }}>
                    Validation Issues
                  </div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {validation.issues.map((issue, index) => (
                      <div
                        key={`${issue}-${index}`}
                        style={{
                          borderRadius: 12,
                          padding: "10px 12px",
                          color: "#fde68a",
                          background: "rgba(245,158,11,0.10)",
                          border: "1px solid rgba(245,158,11,0.20)",
                          fontSize: 13,
                        }}
                      >
                        ⚠ {issue}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {showRawJson && rawResponse ? (
                <div style={cardStyle}>
                  <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 10 }}>
                    Raw JSON
                  </div>
                  <div className="dispatch-settings-scroll" style={scrollWrapStyle(360)}>
                    <pre style={{ ...monoStyle, margin: 0, padding: 12 }}>
                      {JSON.stringify(rawResponse, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {activeView === "post" ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={cardStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <div>
                <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 4 }}>
                  Dispatch Settings Configuration
                </div>
                <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>
                  Validates current settings and enables dispatch automation if required.
                </div>
              </div>

              <button
                className="btn-primary"
                onClick={() => void handleValidateAndConfigure()}
                disabled={loading || headerCount === 0}
              >
                {loading ? "Configuring..." : "🚀 Validate & Configure"}
              </button>
            </div>

            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.02)",
                padding: 14,
              }}
            >
              <div style={{ color: "#f8fafc", fontWeight: 800, marginBottom: 8 }}>
                This automation will ensure:
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, color: "#cbd5e1", fontSize: 13, lineHeight: 1.8 }}>
                <li>Auto-assign tech to jobs</li>
                <li>Auto-assign tech to recommendations</li>
                <li>Auto-assign tech to deferred recommendations</li>
                <li>Assign tech from return jobs</li>
              </ul>
            </div>
          </div>

          {settings ? (
            <div style={cardStyle}>
              <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 10 }}>
                Current Validation Snapshot
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                {validation.isValid ? (
                  <div style={getStatusTone(true)}>
                    All required dispatch automation settings are already enabled.
                  </div>
                ) : (
                  validation.issues.map((issue, index) => (
                    <div
                      key={`${issue}-${index}`}
                      style={{
                        borderRadius: 12,
                        padding: "10px 12px",
                        color: "#fde68a",
                        background: "rgba(245,158,11,0.10)",
                        border: "1px solid rgba(245,158,11,0.20)",
                        fontSize: 13,
                      }}
                    >
                      ⚠ {issue}
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          <div style={cardStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
                Execution Logs
              </div>
              <button className="btn-secondary btn-sm" onClick={clearLogs}>
                Clear Logs
              </button>
            </div>

            <div className="dispatch-settings-scroll" style={scrollWrapStyle(340)}>
              <div style={{ display: "grid", gap: 8, padding: 12 }}>
                {executionLogs.length > 0 ? (
                  executionLogs.map((log) => (
                    <div
                      key={log.id}
                      style={{
                        borderRadius: 12,
                        border:
                          log.level === "error"
                            ? "1px solid rgba(239,68,68,0.18)"
                            : log.level === "warn"
                            ? "1px solid rgba(245,158,11,0.18)"
                            : log.level === "success"
                            ? "1px solid rgba(34,197,94,0.18)"
                            : "1px solid rgba(255,255,255,0.06)",
                        background:
                          log.level === "error"
                            ? "rgba(239,68,68,0.06)"
                            : log.level === "warn"
                            ? "rgba(245,158,11,0.06)"
                            : log.level === "success"
                            ? "rgba(34,197,94,0.06)"
                            : "rgba(255,255,255,0.02)",
                        padding: 10,
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                        <span style={{ color: "#94a3b8", fontSize: 11 }}>{log.time}</span>
                        <span
                          style={{
                            color:
                              log.level === "error"
                                ? "#fca5a5"
                                : log.level === "warn"
                                ? "#fcd34d"
                                : log.level === "success"
                                ? "#86efac"
                                : "#93c5fd",
                            fontSize: 11,
                            fontWeight: 800,
                            textTransform: "uppercase",
                          }}
                        >
                          {log.level}
                        </span>
                      </div>
                      <div style={{ color: "#e2e8f0", fontSize: 13 }}>{log.message}</div>
                      {log.meta !== undefined ? (
                        <details style={{ marginTop: 8 }}>
                          <summary style={{ cursor: "pointer", color: "#93c5fd", fontSize: 12 }}>
                            View meta
                          </summary>
                          <pre
                            style={{
                              ...monoStyle,
                              margin: "8px 0 0",
                              padding: 10,
                              borderRadius: 10,
                              background: "#0f172a",
                              overflow: "auto",
                            }}
                          >
                            {JSON.stringify(log.meta, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div style={{ color: "#94a3b8", fontSize: 13 }}>
                    No logs yet. Run "Validate & Configure" or fetch settings first.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default DispatchSettingsView;
