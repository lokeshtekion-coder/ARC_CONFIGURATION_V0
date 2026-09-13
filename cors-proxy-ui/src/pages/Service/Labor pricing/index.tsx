import React, { useCallback, useEffect, useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";

type OperationKey = "get" | "post";

type UiMessage = {
  ok: boolean;
  text: string;
};

type LaborRateVersion = {
  id?: string;
  rateType?: number;
  effectiveDate?: string | number;
  effectiveStatus?: string;
  isLastRow?: boolean;
  hourLaborRate?: number;
  pricingGrid?: unknown;
};

type LaborRateRow = {
  id?: string;
  name?: string;
  description?: string;
  rateType?: number;
  hourLaborRate?: number;
  laborRateVersions?: LaborRateVersion[];
  languages?: unknown;
  [key: string]: unknown;
};

type LaborRateApiResponse = {
  data?: LaborRateRow[];
  [key: string]: unknown;
};

type CreateResponse = {
  data?: {
    id?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type LaborPreset = {
  key: string;
  code: string;
  description: string;
  rateType: number;
  accent: string;
};

const LABOR_RATE_URL =
  "https://preprodapp.tekioncloud.com/api/service-module/u/labor-pricing/laborRate";

const PRESET_RATES: LaborPreset[] = [
  {
    key: "cp",
    code: "CP",
    description: "Customer Labor Rate",
    rateType: 0,
    accent: "#3b82f6",
  },
  {
    key: "ip",
    code: "IP",
    description: "Internal Labor Rate",
    rateType: 0,
    accent: "#f59e0b",
  },
  {
    key: "wp",
    code: "WP",
    description: "Warranty Labor Rate",
    rateType: 0,
    accent: "#22c55e",
  },
];

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeUpper(value: unknown): string {
  return normalize(value).toUpperCase();
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

function extractSiteIdFromHeaders(headers: Record<string, string>): string {
  return findHeaderValueCaseInsensitive(headers, [
    "tek-siteid",
    "tek-siteId",
    "teksiteid",
    "siteid",
    "site-id",
  ]);
}

function buildTomorrowInputDate(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split("T")[0];
}

function formatCurrency(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function formatDateLabel(value: unknown): string {
  if (!value) return "—";

  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    !(value instanceof Date)
  ) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getLatestVersion(rate: LaborRateRow): LaborRateVersion | null {
  if (!Array.isArray(rate.laborRateVersions) || rate.laborRateVersions.length === 0) {
    return null;
  }
  return rate.laborRateVersions[0] ?? null;
}

function getDisplayHourlyRate(rate: LaborRateRow): number {
  const latest = getLatestVersion(rate);
  return Number(latest?.hourLaborRate ?? rate.hourLaborRate ?? 0);
}

function getDisplayStatus(rate: LaborRateRow): string {
  const latest = getLatestVersion(rate);
  return normalize(latest?.effectiveStatus || "INACTIVE") || "INACTIVE";
}

function getDisplayEffectiveDate(rate: LaborRateRow): string {
  const latest = getLatestVersion(rate);
  return formatDateLabel(latest?.effectiveDate);
}

function getDisplayRateType(rate: LaborRateRow): string {
  const name = normalizeUpper(rate.name);
  const description = normalizeUpper(rate.description);

  if (name === "CP" || description.includes("CUSTOMER")) return "Customer Pay";
  if (name === "IP" || description.includes("INTERNAL")) return "Internal";
  if (name === "WP" || description.includes("WARRANTY")) return "Warranty";

  const map: Record<number, string> = {
    0: "Customer Pay",
    1: "Warranty",
    2: "Internal",
  };

  return map[Number(rate.rateType)] || String(rate.rateType ?? "—");
}

function getStatusVisual(status: string): {
  text: string;
  color: string;
  background: string;
  border: string;
} {
  const normalized = normalizeUpper(status);

  if (normalized === "ACTIVE") {
    return {
      text: "ACTIVE",
      color: "#86efac",
      background: "rgba(34,197,94,0.10)",
      border: "1px solid rgba(34,197,94,0.22)",
    };
  }

  if (normalized === "UPCOMING") {
    return {
      text: "UPCOMING",
      color: "#fcd34d",
      background: "rgba(245,158,11,0.10)",
      border: "1px solid rgba(245,158,11,0.22)",
    };
  }

  if (normalized === "EXPIRED") {
    return {
      text: "EXPIRED",
      color: "#fca5a5",
      background: "rgba(239,68,68,0.10)",
      border: "1px solid rgba(239,68,68,0.22)",
    };
  }

  return {
    text: "INACTIVE",
    color: "#cbd5e1",
    background: "rgba(148,163,184,0.10)",
    border: "1px solid rgba(148,163,184,0.20)",
  };
}

function buildEffectiveDateInfo(inputDate: string): { iso: string; timestamp: number } {
  const selected = new Date(inputDate);
  const now = new Date();

  if (selected.getTime() <= now.getTime()) {
    const adjusted = new Date(now.getTime() + 60 * 60 * 1000);
    return {
      iso: adjusted.toISOString(),
      timestamp: adjusted.getTime(),
    };
  }

  selected.setHours(0, 0, 0, 0);

  return {
    iso: selected.toISOString(),
    timestamp: selected.getTime(),
  };
}

function buildCreatePayload(params: {
  siteId: string;
  name: string;
  description: string;
  rateType: number;
  hourLaborRate: number;
  effectiveDateInput: string;
}): Record<string, unknown> {
  const { siteId, name, description, rateType, hourLaborRate, effectiveDateInput } = params;
  const effective = buildEffectiveDateInfo(effectiveDateInput);

  const pricingGrid = {
    centRounding: [],
    dollarRounding: [],
    pricingRule: [],
    defaultLaborRate: "",
  };

  const versionPricingGrid = {
    pricingRule: [],
  };

  return {
    timePreference: 0,
    warrantyPreferenceTime: {
      timePreference: 1,
      id: "warrantyPreferenceTime",
      multiplierValue: 1,
    },
    customerPreferenceTime: {
      timePreference: 0,
      id: "customerPreferenceTime",
      multiplierValue: 1,
    },
    partPriceIdBySiteMap: {
      [siteId]: "",
    },
    name,
    languages: {
      locale: {
        en_US: {
          name,
        },
      },
    },
    description,
    laborRateVersions: [
      {
        rateType: [rateType],
        effectiveDate: effective.iso,
        effectiveStatus: "UPCOMING",
        isLastRow: true,
        hourLaborRate,
      },
    ],
    addedLaborRateVersionReqDtoList: [
      {
        rateType,
        effectiveDate: effective.timestamp,
        effectiveStatus: "UPCOMING",
        isLastRow: true,
        hourLaborRate,
        pricingGrid: versionPricingGrid,
      },
    ],
    updatedLaborRateVersionReqDtoList: [],
    deletedLaborRateVersionIds: [],
    rateType,
    hourLaborRate,
    pricingGrid,
    laborTimePreference: [
      {
        timePreference: 0,
        multiplierValue: 1,
      },
      {
        timePreference: 1,
        multiplierValue: 1,
      },
    ],
    partPriceCode: null,
  };
}

const badgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  borderRadius: 899,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "#cbd5e1",
  fontSize: 10,
  whiteSpace: "wrap",
};

const cardStyle: React.CSSProperties = {
  borderRadius: 10,
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

function tableScrollWrapStyle(maxHeight: number): React.CSSProperties {
  return {
    maxHeight,
    overflowY: "auto",
    overflowX: "auto",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.06)",
  };
}

const tableElementStyle: React.CSSProperties = {
  width: "80%",
  minWidth: 880,
  borderCollapse: "collapse",
};

const stickyThStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  background: "#111827",
  color: "#94a3b8",
  textAlign: "left",
  padding: "10px 12px",
  fontSize: 12,
  fontWeight: 800,
  zIndex: 1,
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 13,
  borderBottom: "1px solid rgba(255,255,255,0.05)",
  verticalAlign: "top",
};

function zebraRowStyle(index: number): React.CSSProperties {
  return {
    background: index % 2 === 1 ? "rgba(255,255,255,0.015)" : "transparent",
  };
}

const LaborPricingView: React.FC = () => {
  const [headerMap, setHeaderMap] = useState<Record<string, string>>({});
  const [operation, setOperation] = useState<OperationKey>("get");

  const [loading, setLoading] = useState(false);
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<UiMessage | null>(null);

  const [laborRates, setLaborRates] = useState<LaborRateRow[]>([]);
  const [rawGetResponse, setRawGetResponse] = useState<unknown>(null);
  const [showRawGetResponse, setShowRawGetResponse] = useState(false);

  const [hourlyRate, setHourlyRate] = useState("0");
  const [effectiveDate, setEffectiveDate] = useState(buildTomorrowInputDate());

  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customCode, setCustomCode] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customRate, setCustomRate] = useState("");

  const [search, setSearch] = useState("");

  const refreshHeaders = useCallback(() => {
    try {
      const headers = loadGlobalHeaders();
      setHeaderMap(toEnabledHeaderMap(headers));
    } catch {
      setHeaderMap({});
    }
  }, []);

  useEffect(() => {
    refreshHeaders();
  }, [refreshHeaders]);

  const detectedSiteId = useMemo(() => extractSiteIdFromHeaders(headerMap), [headerMap]);
  const effectiveSiteId = detectedSiteId || "-1_7896";
  const headerCount = useMemo(() => Object.keys(headerMap).length, [headerMap]);

  const proxyRequest = useCallback(
    async (payload: {
      url: string;
      method: "GET" | "POST";
      body?: unknown;
    }) => {
      const res = await fetch("http://localhost:4000/api/proxy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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
        throw new Error(`Proxy request failed with HTTP ${res.status}`);
      }

      const json = await res.json();

      if ((json?.status ?? 200) >= 400) {
        throw new Error(
          `${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim()
        );
      }

      return json?.body ?? json?.data ?? json;
    },
    [headerMap]
  );

  const fetchLaborRates = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      if (headerCount === 0) {
        throw new Error("Global Headers are empty. Please configure them in Settings first.");
      }

      const response = (await proxyRequest({
        url: LABOR_RATE_URL,
        method: "GET",
      })) as LaborRateApiResponse;

      const rows = Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response)
        ? (response as unknown as LaborRateRow[])
        : [];

      setRawGetResponse(response);
      setLaborRates(rows);
      setMessage({
        ok: true,
        text: `Fetched ${rows.length} labor rate record(s) successfully.`,
      });
    } catch (e: unknown) {
      setLaborRates([]);
      setRawGetResponse(null);
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Failed to fetch labor pricing",
      });
    } finally {
      setLoading(false);
    }
  }, [headerCount, proxyRequest]);

  const createLaborRate = useCallback(
    async (params: {
      key: string;
      name: string;
      description: string;
      rateType: number;
      rateValue: number;
    }) => {
      setCreatingKey(params.key);
      setMessage(null);

      try {
        if (headerCount === 0) {
          throw new Error("Global Headers are empty. Please configure them in Settings first.");
        }

        if (!effectiveDate) {
          throw new Error("Please select an effective date.");
        }

        if (!Number.isFinite(params.rateValue) || params.rateValue <= 0) {
          throw new Error("Please enter a valid hourly labor rate.");
        }

        const payload = buildCreatePayload({
          siteId: effectiveSiteId,
          name: params.name,
          description: params.description,
          rateType: params.rateType,
          hourLaborRate: params.rateValue,
          effectiveDateInput: effectiveDate,
        });

        const response = (await proxyRequest({
          url: LABOR_RATE_URL,
          method: "POST",
          body: payload,
        })) as CreateResponse;

        setMessage({
          ok: true,
          text: `Labor rate "${params.name}" created successfully${response?.data?.id ? ` (ID: ${response.data.id})` : ""}.`,
        });

        setHourlyRate("0");
        if (params.key === "custom") {
          setCustomCode("");
          setCustomDescription("");
          setCustomRate("");
          setShowCustomForm(false);
        }

        await fetchLaborRates();
      } catch (e: unknown) {
        setMessage({
          ok: false,
          text: e instanceof Error ? e.message : "Failed to create labor rate",
        });
      } finally {
        setCreatingKey(null);
      }
    },
    [effectiveDate, effectiveSiteId, fetchLaborRates, headerCount, proxyRequest]
  );

  const handleCreatePreset = useCallback(
    async (preset: LaborPreset) => {
      const rateValue = Number(hourlyRate);
      await createLaborRate({
        key: preset.key,
        name: preset.code,
        description: preset.description,
        rateType: preset.rateType,
        rateValue,
      });
    },
    [createLaborRate, hourlyRate]
  );

  const handleCreateCustom = useCallback(async () => {
    const code = normalizeUpper(customCode);
    const description = normalize(customDescription);
    const rateValue = Number(customRate);

    if (!code) {
      setMessage({ ok: false, text: "Please enter a custom code." });
      return;
    }

    if (!description) {
      setMessage({ ok: false, text: "Please enter a custom description." });
      return;
    }

    await createLaborRate({
      key: "custom",
      name: code,
      description,
      rateType: 0,
      rateValue,
    });
  }, [createLaborRate, customCode, customDescription, customRate]);

  const filteredRates = useMemo(() => {
    const q = normalizeUpper(search);
    if (!q) return laborRates;

    return laborRates.filter((rate) => {
      const text = [
        normalizeUpper(rate.name),
        normalizeUpper(rate.description),
        normalizeUpper(rate.id),
        normalizeUpper(getDisplayRateType(rate)),
        normalizeUpper(getDisplayStatus(rate)),
      ].join(" ");

      return text.includes(q);
    });
  }, [laborRates, search]);

  const previewPayload = useMemo(() => {
    return buildCreatePayload({
      siteId: effectiveSiteId,
      name: normalizeUpper(customCode) || "CP",
      description: normalize(customDescription) || "Customer Labor Rate",
      rateType: 0,
      hourLaborRate: Number(customRate || hourlyRate || 0),
      effectiveDateInput: effectiveDate || buildTomorrowInputDate(),
    });
  }, [customCode, customDescription, customRate, effectiveDate, effectiveSiteId, hourlyRate]);

  return (
    <div
      style={{
        display: "grid",
        gap: 10,
        maxHeight: "50%",
        overflow: "auto",
      }}
      className="labor-pricing-scroll"
    >
      <style>{`
        .labor-pricing-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .labor-pricing-scroll::-webkit-scrollbar-track { background: transparent; }
        .labor-pricing-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 8px; }
        .labor-pricing-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.24); }
      `}</style>

      {/* Meta Indicators */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={badgeStyle}>
          Tek Site ID: <b style={{ color: detectedSiteId ? "#86efac" : "#fcd34d" }}>{effectiveSiteId}</b>
        </span>
        <span style={badgeStyle}>
          Global Headers: <b style={{ color: "#f8fafc" }}>{headerCount}</b>
        </span>
      </div>

      {/* Action Bar */}
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
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className={operation === "get" ? "btn-primary" : "btn-secondary btn-sm"}
              onClick={() => {
                setOperation("get");
                void fetchLaborRates();
              }}
              disabled={loading || headerCount === 0}
            >
              {loading && operation === "get" ? "Fetching..." : "📥 GET"}
            </button>
            <button
              className={operation === "post" ? "btn-primary" : "btn-secondary btn-sm"}
              onClick={() => setOperation("post")}
            >
              📤 POST
            </button>
          </div>

          <button className="btn-secondary btn-sm" onClick={refreshHeaders}>
            ⟳ Refresh Headers
          </button>
        </div>

        {message ? (
          <div
            style={{
              marginTop: 12,
              borderRadius: 12,
              padding: "10px 12px",
              fontSize: 13,
              color: message.ok ? "#bbf7d0" : "#fecaca",
              background: message.ok
                ? "rgba(34,197,94,0.10)"
                : "rgba(239,68,68,0.10)",
              border: message.ok
                ? "1px solid rgba(34,197,94,0.22)"
                : "1px solid rgba(239,68,68,0.22)",
            }}
          >
            {message.text}
          </div>
        ) : null}
      </div>

      {operation === "get" ? (
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
            <div>
              <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>Labor Rate Results</div>
              <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>
                Search by name, description, type, ID, or status.
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search labor rates..."
                style={{
                  minWidth: 260,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.03)",
                  color: "#f8fafc",
                  outline: "none",
                }}
              />

              {rawGetResponse ? (
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => setShowRawGetResponse((v) => !v)}
                >
                  {showRawGetResponse ? "Hide Raw JSON" : "Show Raw JSON"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="labor-pricing-scroll" style={tableScrollWrapStyle(520)}>
            <table className="bx-table" style={tableElementStyle}>
              <thead>
                <tr>
                  <th style={stickyThStyle}>Name</th>
                  <th style={stickyThStyle}>Description</th>
                  <th style={stickyThStyle}>Rate Type</th>
                  <th style={stickyThStyle}>Hourly Rate</th>
                  <th style={stickyThStyle}>Status</th>
                  <th style={stickyThStyle}>Effective Date</th>
                  <th style={stickyThStyle}>ID</th>
                </tr>
              </thead>
              <tbody>
                {filteredRates.length > 0 ? (
                  filteredRates.map((rate, index) => {
                    const status = getStatusVisual(getDisplayStatus(rate));
                    return (
                      <tr key={`${rate.id || rate.name || "rate"}-${index}`} style={zebraRowStyle(index)}>
                        <td style={tdStyle}>
                          <div style={{ color: "#f8fafc", fontWeight: 800 }}>
                            {rate.name || "—"}
                          </div>
                        </td>
                        <td style={tdStyle}>{rate.description || "—"}</td>
                        <td style={tdStyle}>{getDisplayRateType(rate)}</td>
                        <td style={tdStyle}>
                          <span style={{ color: "#e2e8f0", fontWeight: 700 }}>
                            {formatCurrency(getDisplayHourlyRate(rate))}
                          </span>
                        </td>
                        <td style={tdStyle}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              borderRadius: 999,
                              padding: "4px 10px",
                              fontSize: 12,
                              fontWeight: 700,
                              color: status.color,
                              background: status.background,
                              border: status.border,
                            }}
                          >
                            {status.text}
                          </span>
                        </td>
                        <td style={tdStyle}>{getDisplayEffectiveDate(rate)}</td>
                        <td style={tdStyle}>
                          <code style={monoStyle}>{rate.id || "—"}</code>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td style={tdStyle} colSpan={7}>
                      <div style={{ color: "#94a3b8", padding: "8px 0" }}>
                        {laborRates.length === 0
                          ? "No labor rates loaded yet."
                          : "No labor rates matched your search."}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {showRawGetResponse && Boolean(rawGetResponse) && (
            <div style={{ marginTop: 14 }}>
              <pre
                style={{
                  ...monoStyle,
                  margin: 0,
                  padding: 12,
                  borderRadius: 12,
                  background: "#0f172a",
                  maxHeight: 320,
                  overflow: "auto",
                }}
              >
                {JSON.stringify(rawGetResponse, null, 2)}
              </pre>
            </div>
          )}
        </div>
      ) : null}

      {operation === "post" ? (
        <>
          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
              Shared Create Settings
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 14,
              }}
            >
              <div>
                <label style={{ display: "block", color: "#cbd5e1", fontSize: 13, marginBottom: 6 }}>
                  Hourly Labor Rate ($)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.03)",
                    color: "#f8fafc",
                    outline: "none",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", color: "#cbd5e1", fontSize: 13, marginBottom: 6 }}>
                  Effective Date
                </label>
                <input
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.03)",
                    color: "#f8fafc",
                    outline: "none",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Quick Create Presets as Sleek Rows */}
          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
              Quick Create Presets
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              {PRESET_RATES.map((preset) => (
                <div
                  key={preset.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: `1px solid ${preset.accent}24`,
                    background: `${preset.accent}0d`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "4px 10px",
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 800,
                        color: preset.accent,
                        background: `${preset.accent}1a`,
                        border: `1px solid ${preset.accent}33`,
                        minWidth: 44,
                      }}
                    >
                      {preset.code}
                    </span>

                    <span style={{ color: "#f8fafc", fontSize: 14, fontWeight: 600 }}>
                      {preset.description}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ color: "#cbd5e1", fontSize: 13 }}>
                      Rate: <b style={{ color: "#f8fafc" }}>{formatCurrency(hourlyRate)}</b>
                    </div>

                    <button
                      className="btn-primary"
                      onClick={() => void handleCreatePreset(preset)}
                      disabled={creatingKey !== null || headerCount === 0}
                      style={{
                        background: preset.accent,
                        borderColor: preset.accent,
                        padding: "6px 14px",
                        fontSize: 13,
                      }}
                    >
                      {creatingKey === preset.key ? "Creating..." : `Create ${preset.code}`}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Custom Labor Rate as Inline Row */}
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
              <div>
                <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
                  Custom Labor Rate
                </div>
                <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>
                  Create any custom labor code with its own description and rate.
                </div>
              </div>

              <button
                className="btn-secondary btn-sm"
                onClick={() => setShowCustomForm((v) => !v)}
              >
                {showCustomForm ? "Hide Custom Form" : "Show Custom Form"}
              </button>
            </div>

            {showCustomForm ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 10,
                  flexWrap: "wrap",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.018)",
                }}
              >
                <div style={{ flex: "1 1 110px", minWidth: 100 }}>
                  <label style={{ display: "block", color: "#94a3b8", fontSize: 12, marginBottom: 4 }}>
                    Code
                  </label>
                  <input
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                    placeholder="e.g. DIAG"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "9px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(255,255,255,0.03)",
                      color: "#f8fafc",
                      outline: "none",
                      fontSize: 13,
                    }}
                  />
                </div>

                <div style={{ flex: "2 1 200px", minWidth: 180 }}>
                  <label style={{ display: "block", color: "#94a3b8", fontSize: 12, marginBottom: 4 }}>
                    Description
                  </label>
                  <input
                    value={customDescription}
                    onChange={(e) => setCustomDescription(e.target.value)}
                    placeholder="e.g. Diagnostic Labor Rate"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "9px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(255,255,255,0.03)",
                      color: "#f8fafc",
                      outline: "none",
                      fontSize: 13,
                    }}
                  />
                </div>

                <div style={{ flex: "1 1 120px", minWidth: 110 }}>
                  <label style={{ display: "block", color: "#94a3b8", fontSize: 12, marginBottom: 4 }}>
                    Rate ($)
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={customRate}
                    onChange={(e) => setCustomRate(e.target.value)}
                    placeholder="e.g. 150"
                    style={{
                      width: "100%",
                      boxSizing: "border-box",
                      padding: "9px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(255,255,255,0.03)",
                      color: "#f8fafc",
                      outline: "none",
                      fontSize: 13,
                    }}
                  />
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center", paddingBottom: 1 }}>
                  <button
                    className="btn-primary"
                    onClick={() => void handleCreateCustom()}
                    disabled={creatingKey !== null || headerCount === 0}
                    style={{
                      background: "#9333ea",
                      borderColor: "#9333ea",
                      padding: "9px 14px",
                      fontSize: 13,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {creatingKey === "custom" ? "Creating..." : "🚀 Create"}
                  </button>

                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      setCustomCode("");
                      setCustomDescription("");
                      setCustomRate("");
                    }}
                    style={{ padding: "8px 12px" }}
                  >
                    Reset
                  </button>
                </div>
              </div>
            ) : null}
          </div>

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
              <div>
                <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
                  Payload Preview
                </div>
                <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>
                  Preview of the payload shape that will be sent for create requests.
                </div>
              </div>
            </div>

            <div className="labor-pricing-scroll" style={tableScrollWrapStyle(320)}>
              <pre style={{ ...monoStyle, margin: 0, padding: 12 }}>
                {JSON.stringify(previewPayload, null, 2)}
              </pre>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
};

export default LaborPricingView;