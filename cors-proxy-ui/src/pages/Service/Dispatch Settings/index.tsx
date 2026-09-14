import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadGlobalHeaders } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";

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

const statusBadge = (ok: boolean, trueText = "Enabled", falseText = "Disabled") => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      borderRadius: 999,
      padding: "3px 10px",
      fontSize: 12,
      fontWeight: 700,
      color: ok ? "#86efac" : "#fca5a5",
      background: ok ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
      border: ok ? "1px solid rgba(34,197,94,0.25)" : "1px solid rgba(239,68,68,0.25)",
      whiteSpace: "nowrap",
    }}
  >
    {ok ? "✓" : "✕"} {ok ? trueText : falseText}
  </span>
);

export const DispatchSettingsView: React.FC = () => {
  const [headerMap, setHeaderMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);

  const [settingsData, setSettingsData] = useState<DispatchGeneralSettings | null>(null);
  const [rawResponse, setRawResponse] = useState<unknown>(null);
  const [executionLogs, setExecutionLogs] = useState<ExecutionLog[]>([]);
  const [bottomTab, setBottomTab] = useState<"none" | "logs" | "json">("none");

  const hasAutoFetchedRef = useRef(false);

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

  const clearLogs = useCallback(() => setExecutionLogs([]), []);

  const refreshHeaders = useCallback(() => {
    try {
      const loaded = toEnabledHeaderMap(loadGlobalHeaders());
      setHeaderMap(loaded);
      appendLog("info", "Global headers refreshed", {
        headerCount: Object.keys(loaded).length,
        dealerId: extractDealerIdFromHeaders(loaded),
      });
    } catch (e) {
      appendLog("error", "Failed to refresh global headers", e);
      setHeaderMap({});
    }
  }, [appendLog]);

  const proxyRequest = useCallback(
    async (payload: { url: string; method: "GET" | "PUT"; body?: unknown }) => {
      appendLog("info", "Proxy request started", {
        method: payload.method,
        url: payload.url,
        dealerId,
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
        appendLog("error", "Proxy HTTP failure", { status: res.status, url: payload.url });
        throw new Error(`Proxy request failed with HTTP ${res.status}`);
      }

      const json = await res.json();

      if ((json?.status ?? 200) >= 400) {
        appendLog("error", "Proxy logical failure", {
          status: json?.status,
          statusText: json?.statusText,
        });
        throw new Error(`${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim());
      }

      return json?.body ?? json?.data ?? json;
    },
    [appendLog, dealerId, headerMap]
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

    appendLog("success", "Dispatch settings loaded", {
      durationMs: Number((end - start).toFixed(2)),
      dealerId: data?.dealerId,
    });
    return data;
  }, [appendLog, proxyRequest]);

  useEffect(() => {
    appendLog("info", "Dispatch Settings view mounted");
    refreshHeaders();
  }, [appendLog, refreshHeaders]);

  useEffect(() => {
    if (hasAutoFetchedRef.current || Object.keys(headerMap).length === 0) return;

    hasAutoFetchedRef.current = true;

    const runInitialFetch = async () => {
      setLoading(true);
      setMessage(null);
      try {
        const data = await fetchDispatchSettings();
        setMessage({
          ok: true,
          text: `Settings auto-loaded for dealer ${data?.dealerId || dealerId || "N/A"}.`,
        });
      } catch (e: unknown) {
        appendLog("error", "Initial auto-fetch failed", e);
        setMessage({
          ok: false,
          text: e instanceof Error ? e.message : "Failed to fetch dispatch settings",
        });
      } finally {
        setLoading(false);
      }
    };

    void runInitialFetch();
  }, [headerMap, dealerId, fetchDispatchSettings, appendLog]);

  const handleGet = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const data = await fetchDispatchSettings();
      setMessage({
        ok: true,
        text: `Settings loaded for dealer ${data?.dealerId || dealerId || "N/A"}.`,
      });
    } catch (e: unknown) {
      appendLog("error", "GET dispatch settings failed", e);
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Failed to fetch dispatch settings",
      });
    } finally {
      setLoading(false);
    }
  }, [appendLog, dealerId, fetchDispatchSettings]);

  const handleValidateAndConfigure = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      appendLog("info", "Validate & Configure started");
      const current = await fetchDispatchSettings();
      const result = validateSettings(current);

      if (result.isValid) {
        appendLog("success", "Dispatch settings already optimal");
        setMessage({
          ok: true,
          text: "Dispatch settings already configured. All rules are active.",
        });
        return;
      }

      const updatePayload = {
        jobDispatchSetting: { autoAssignTechToJob: true },
        recommendationDispatchSetting: {
          autoAssignTechToRecommendation: true,
          autoAssignTechToDeferredRecommendation: true,
        },
        returnJobDispatchSetting: { assignTechFromReturnJob: true },
      };

      appendLog("info", "Applying dispatch configuration updates", updatePayload);

      await proxyRequest({
        url: DISPATCH_SETTINGS_URL,
        method: "PUT",
        body: updatePayload,
      });

      const refreshed = await fetchDispatchSettings();
      setMessage({
        ok: true,
        text: `Successfully updated dispatch automation for dealer ${refreshed?.dealerId || dealerId || "N/A"}.`,
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
  }, [appendLog, dealerId, fetchDispatchSettings, proxyRequest]);

  const jobSettings = settingsData?.jobDispatchSetting || {};
  const recSettings = settingsData?.recommendationDispatchSetting || {};
  const returnSettings = settingsData?.returnJobDispatchSetting || {};

  const coreRules = [
    {
      title: "Auto-assign Tech to Jobs",
      enabled: jobSettings.autoAssignTechToJob,
    },
    {
      title: "Auto-assign Tech to Recommendations",
      enabled: recSettings.autoAssignTechToRecommendation,
    },
    {
      title: "Auto-assign Tech to Deferred Recommendations",
      enabled: recSettings.autoAssignTechToDeferredRecommendation,
    },
    {
      title: "Assign Tech from Return Job",
      enabled: returnSettings.assignTechFromReturnJob,
    },
  ];

  return (
    <div style={{ display: "grid", gap: 16, paddingBottom: 24 }}>
      {/* Top Header & Quick Actions */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          padding: "16px 20px",
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: "#94a3b8", fontSize: 13 }}>
              Dealer ID:{" "}
              <b style={{ color: dealerId ? "#86efac" : "#fca5a5" }}>{dealerId || "Not found"}</b>
            </span>
            <span style={{ color: "#475569" }}>•</span>
            <span style={{ color: "#94a3b8", fontSize: 13 }}>
              Headers: <b style={{ color: "#f8fafc" }}>{headerCount}</b>
            </span>
            <button
              className="btn-secondary btn-sm"
              onClick={refreshHeaders}
              style={{ fontSize: 11, padding: "2px 8px", marginLeft: 4 }}
            >
              ⟳ Sync
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn-secondary btn-sm"
            onClick={() => void handleGet()}
            disabled={loading || headerCount === 0}
          >
            {loading ? "Loading..." : "📥 Fetch Settings"}
          </button>
          <button
            className="btn-primary"
            onClick={() => void handleValidateAndConfigure()}
            disabled={loading || headerCount === 0}
          >
            {loading ? "Processing..." : "🚀 Validate & Auto-Configure"}
          </button>
        </div>
      </div>

      {/* Action Feedback Message */}
      {message && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 12,
            fontSize: 13,
            color: message.ok ? "#bbf7d0" : "#fecaca",
            background: message.ok ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
            border: message.ok ? "1px solid rgba(34,197,94,0.22)" : "1px solid rgba(239,68,68,0.22)",
          }}
        >
          {message.ok ? "✓ " : "⚠ "} {message.text}
        </div>
      )}

      {/* Core Automation Rules Checklist */}
      <div
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 16,
          padding: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800 }}>
            Required Automation Rules
          </div>
          {settingsData && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: validation.isValid ? "#86efac" : "#fcd34d",
              }}
            >
              {validation.isValid ? "All 4 Rules Passing" : `${validation.issues.length} Missing`}
            </span>
          )}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {coreRules.map((rule, idx) => (
            <div
              key={idx}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.05)",
              }}
            >
              <span style={{ color: "#f1f5f9", fontSize: 13, fontWeight: 600 }}>
                {rule.title}
              </span>
              {settingsData ? (
                statusBadge(Boolean(rule.enabled))
              ) : (
                <span style={{ color: "#64748b", fontSize: 12 }}>Unchecked</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Diagnostics Section: Logs & Raw JSON Drawer */}
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.02)",
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 16px",
            borderBottom: bottomTab !== "none" ? "1px solid rgba(255,255,255,0.08)" : "none",
            background: "rgba(255,255,255,0.01)",
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => setBottomTab((v) => (v === "logs" ? "none" : "logs"))}
              style={{
                background: bottomTab === "logs" ? "rgba(255,255,255,0.08)" : "transparent",
                border: "none",
                color: bottomTab === "logs" ? "#f8fafc" : "#94a3b8",
                fontSize: 12,
                fontWeight: 600,
                padding: "6px 10px",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Logs ({executionLogs.length})
            </button>
            <button
              onClick={() => setBottomTab((v) => (v === "json" ? "none" : "json"))}
              disabled={!rawResponse}
              style={{
                background: bottomTab === "json" ? "rgba(255,255,255,0.08)" : "transparent",
                border: "none",
                color: !rawResponse ? "#475569" : bottomTab === "json" ? "#f8fafc" : "#94a3b8",
                fontSize: 12,
                fontWeight: 600,
                padding: "6px 10px",
                borderRadius: 6,
                cursor: rawResponse ? "pointer" : "not-allowed",
              }}
            >
              Raw Payload
            </button>
          </div>

          {bottomTab === "logs" && executionLogs.length > 0 && (
            <button
              className="btn-secondary btn-sm"
              onClick={clearLogs}
              style={{ fontSize: 11, padding: "2px 8px" }}
            >
              Clear Logs
            </button>
          )}
        </div>

        {bottomTab === "logs" && (
          <div style={{ maxHeight: 240, overflowY: "auto", padding: 12, display: "grid", gap: 6 }}>
            {executionLogs.length === 0 ? (
              <div style={{ color: "#64748b", fontSize: 12 }}>No logs recorded yet.</div>
            ) : (
              executionLogs.map((log) => (
                <div
                  key={log.id}
                  style={{
                    fontSize: 12,
                    fontFamily: "ui-monospace, monospace",
                    display: "flex",
                    gap: 8,
                    alignItems: "baseline",
                  }}
                >
                  <span style={{ color: "#64748b" }}>{log.time}</span>
                  <span
                    style={{
                      fontWeight: 700,
                      color:
                        log.level === "error"
                          ? "#fca5a5"
                          : log.level === "warn"
                          ? "#fcd34d"
                          : log.level === "success"
                          ? "#86efac"
                          : "#93c5fd",
                    }}
                  >
                    [{log.level.toUpperCase()}]
                  </span>
                  <span style={{ color: "#cbd5e1" }}>{log.message}</span>
                </div>
              ))
            )}
          </div>
        )}

        {bottomTab === "json" && Boolean(rawResponse) && (
          <pre
            style={{
              maxHeight: 260,
              overflow: "auto",
              margin: 0,
              padding: 12,
              fontSize: 12,
              fontFamily: "ui-monospace, monospace",
              color: "#94a3b8",
              background: "#090d16",
            }}
          >
            {JSON.stringify(rawResponse, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
};

export default DispatchSettingsView;