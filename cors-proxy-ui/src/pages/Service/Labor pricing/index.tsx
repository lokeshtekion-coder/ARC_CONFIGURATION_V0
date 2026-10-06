import React, { useCallback, useEffect, useMemo, useState } from "react";
import { loadTekionCapturedProfiles } from "../../../services/tekionCapturedProfiles";
import { loadTekionApiSettingsBundle } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";
import { useServiceBlueprint } from "../../../Context/Blueprint_Service_Context";

const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";
const PROXY_ENDPOINT = "http://localhost:4000/api/proxy";
const DEFAULT_HOST = "https://preprodapp.tekioncloud.com";

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
  key: "cp" | "ip" | "wp";
  code: string;
  description: string;
  rateType: number;
  accent: string;
  blueprintQuestion: string;
};

const PRESET_RATES: LaborPreset[] = [
  {
    key: "cp",
    code: "CP",
    description: "Customer Labor Rate",
    rateType: 0,
    accent: "#3b82f6",
    blueprintQuestion: "What is your default Customer labor rate?",
  },
  {
    key: "ip",
    code: "IP",
    description: "Internal Labor Rate",
    rateType: 0,
    accent: "#f59e0b",
    blueprintQuestion: "What is your default Internal labor rate?",
  },
  {
    key: "wp",
    code: "WP",
    description: "Warranty Labor Rate",
    rateType: 0,
    accent: "#22c55e",
    blueprintQuestion: "What is your default Warranty labor rate?",
  },
];

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeUpper(value: unknown): string {
  return normalize(value).toUpperCase();
}

function extractRateFromText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return String(value);
  }

  const str = String(value).trim();
  if (!str) return "";

  const cleanDirect = str.replace(/[$,\s]/g, "");
  if (!Number.isNaN(Number(cleanDirect)) && Number(cleanDirect) >= 0) {
    return cleanDirect;
  }

  const dollarMatch = str.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (dollarMatch?.[1] && Number(dollarMatch[1]) >= 0) {
    return dollarMatch[1];
  }

  const hourlyMatch = str.match(/\b(\d+(?:\.\d{1,2})?)\s*(?:\/|\bper\b)?\s*(?:hr|hour)\b/i);
  if (hourlyMatch?.[1] && Number(hourlyMatch[1]) >= 0) {
    return hourlyMatch[1];
  }

  const allNumbers = str.match(/\b\d+(?:\.\d{1,2})?\b/g);
  if (allNumbers && allNumbers.length > 0) {
    const plausible = allNumbers.find((nStr) => {
      const n = parseFloat(nStr);
      return n >= 0 && n <= 1500;
    });
    if (plausible) return plausible;
    return allNumbers[0];
  }

  return "";
}

function resolveActiveHeaders(): { headers: Record<string, string>; baseHost: string; siteId: string } {
  const storedProfileId = localStorage.getItem(SELECTED_DEALER_PROFILE_KEY);
  const profiles = loadTekionCapturedProfiles();

  const matchedProfile = storedProfileId
    ? profiles.find(
        (p) =>
          p.id === storedProfileId ||
          p.profileKey === storedProfileId ||
          p.dealerId === storedProfileId
      )
    : profiles[0] ?? null;

  let headers: Record<string, string> = {};
  let baseHost = DEFAULT_HOST;
  let siteId = matchedProfile?.tekSiteId || "";

  if (matchedProfile?.bootstrapHeaders && Object.keys(matchedProfile.bootstrapHeaders).length > 0) {
    headers = { ...matchedProfile.bootstrapHeaders };
    if (matchedProfile.sourceUrl) {
      try {
        baseHost = new URL(matchedProfile.sourceUrl).origin;
      } catch {
        baseHost = DEFAULT_HOST;
      }
    }
  } else {
    const bundle = loadTekionApiSettingsBundle();
    const rows = (bundle.globalHeaders ?? []).filter(
      (h: KeyValuePair) => h.enabled && h.key?.trim() && String(h.value ?? "").trim()
    );
    for (const row of rows) {
      const lower = row.key.trim().toLowerCase();
      headers[lower] = String(row.value).trim();
      if (lower === "tek-siteid" && !siteId) {
        siteId = String(row.value).trim();
      }
    }
  }

  headers["content-type"] = "application/json";
  return { headers, baseHost, siteId: siteId || "-1_7896" };
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
  if (value === null || value === undefined || value === "") return "—";

  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) {
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

function getDisplayEffectiveDate(rate: LaborRateRow): string {
  const latest = getLatestVersion(rate);
  return formatDateLabel(latest?.effectiveDate);
}

function buildEffectiveDateInfo(inputDate: string): { iso: string; timestamp: number } {
  const selected = new Date(inputDate);
  const now = new Date();

  if (Number.isNaN(selected.getTime())) {
    const fallback = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return {
      iso: fallback.toISOString(),
      timestamp: fallback.getTime(),
    };
  }

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
  fontSize: 11,
  whiteSpace: "nowrap",
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
  width: "100%",
  minWidth: 650,
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
  verticalAlign: "middle",
};

function zebraRowStyle(index: number): React.CSSProperties {
  return {
    background: index % 2 === 1 ? "rgba(255,255,255,0.015)" : "transparent",
  };
}

export const LaborPricingView: React.FC = () => {
  const { getAnswer, hasBlueprint, loading: blueprintLoading } = useServiceBlueprint();

  const [loading, setLoading] = useState(false);
  const [creatingKey, setCreatingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<UiMessage | null>(null);

  const [laborRates, setLaborRates] = useState<LaborRateRow[]>([]);
  const [rawGetResponse, setRawGetResponse] = useState<unknown>(null);
  const [showRawGetResponse, setShowRawGetResponse] = useState(false);

  // Individual preset rates (pre-filled from Blueprint)
  const [presetRates, setPresetRates] = useState<Record<"cp" | "ip" | "wp", string>>({
    cp: "0",
    ip: "0",
    wp: "0",
  });

  const [hourlyRate, setHourlyRate] = useState("0");
  const [effectiveDate, setEffectiveDate] = useState(buildTomorrowInputDate());

  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customCode, setCustomCode] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customRate, setCustomRate] = useState("");

  const [search, setSearch] = useState("");

  const { headers: activeHeaders, baseHost, siteId } = useMemo(() => resolveActiveHeaders(), []);
  const headerCount = useMemo(() => Object.keys(activeHeaders).length, [activeHeaders]);

  // Extract Blueprint Rates for presets
  const blueprintRates = useMemo(() => {
    if (!hasBlueprint) return { cp: "", ip: "", wp: "" };

    const cpRaw = getAnswer("What is your default Customer labor rate?");
    const ipRaw = getAnswer("What is your default Internal labor rate?");
    const wpRaw = getAnswer("What is your default Warranty labor rate?");

    return {
      cp: extractRateFromText(cpRaw),
      ip: extractRateFromText(ipRaw),
      wp: extractRateFromText(wpRaw),
    };
  }, [hasBlueprint, getAnswer]);

  // Auto-populate preset inputs when blueprint is loaded
  useEffect(() => {
    if (!hasBlueprint) return;

    setPresetRates((prev) => {
      const next = { ...prev };
      let changed = false;

      (["cp", "ip", "wp"] as const).forEach((key) => {
        const bpRate = blueprintRates[key];
        if (bpRate !== "" && (prev[key] === "0" || prev[key] === "")) {
          next[key] = bpRate;
          changed = true;
        }
      });

      return changed ? next : prev;
    });

    if (blueprintRates.cp !== "" && (hourlyRate === "0" || !hourlyRate)) {
      setHourlyRate(blueprintRates.cp);
    }
  }, [blueprintRates, hasBlueprint, hourlyRate]);

  const handleReloadFromBlueprint = useCallback(() => {
    setPresetRates({
      cp: blueprintRates.cp !== "" ? blueprintRates.cp : "0",
      ip: blueprintRates.ip !== "" ? blueprintRates.ip : "0",
      wp: blueprintRates.wp !== "" ? blueprintRates.wp : "0",
    });

    if (blueprintRates.cp !== "") {
      setHourlyRate(blueprintRates.cp);
    }

    setMessage({
      ok: true,
      text: "Labor rates reloaded from Service Blueprint.",
    });
  }, [blueprintRates]);

  const proxyRequest = useCallback(
    async (payload: {
      url: string;
      method: "GET" | "POST";
      body?: unknown;
    }) => {
      const res = await fetch(PROXY_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: payload.url,
          method: payload.method,
          headers: activeHeaders,
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
    [activeHeaders]
  );

  const fetchLaborRates = useCallback(async () => {
    setLoading(true);
    try {
      if (headerCount === 0) {
        throw new Error("Active headers are empty. Please configure a dealer profile in Settings.");
      }

      const targetUrl = `${baseHost}/api/service-module/u/labor-pricing/laborRate`;

      const response = (await proxyRequest({
        url: targetUrl,
        method: "GET",
      })) as LaborRateApiResponse;

      const rows = Array.isArray(response?.data)
        ? response.data
        : Array.isArray(response)
        ? (response as unknown as LaborRateRow[])
        : [];

      setRawGetResponse(response);
      setLaborRates(rows);
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
  }, [baseHost, headerCount, proxyRequest]);

  // Auto-fetch labor rates on mount
  useEffect(() => {
    void fetchLaborRates();
  }, [fetchLaborRates]);

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
          throw new Error("Active headers are empty. Please configure a dealer profile in Settings.");
        }

        if (!effectiveDate) {
          throw new Error("Please select an effective date.");
        }

        // Allows 0 and positive numbers (blocks negative or NaN)
        if (!Number.isFinite(params.rateValue) || params.rateValue < 0) {
          throw new Error(`Please enter a valid non-negative hourly labor rate for ${params.name}.`);
        }

        const payload = buildCreatePayload({
          siteId,
          name: params.name,
          description: params.description,
          rateType: params.rateType,
          hourLaborRate: params.rateValue,
          effectiveDateInput: effectiveDate,
        });

        const targetUrl = `${baseHost}/api/service-module/u/labor-pricing/laborRate`;

        const response = (await proxyRequest({
          url: targetUrl,
          method: "POST",
          body: payload,
        })) as CreateResponse;

        setMessage({
          ok: true,
          text: `✓ Labor rate "${params.name}" created successfully${
            response?.data?.id ? ` (ID: ${response.data.id})` : ""
          }. Refreshed server state.`,
        });

        if (params.key === "custom") {
          setCustomCode("");
          setCustomDescription("");
          setCustomRate("");
          setShowCustomForm(false);
        }

        // Auto-refresh via GET after POST
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
    [baseHost, effectiveDate, fetchLaborRates, headerCount, proxyRequest, siteId]
  );

  const handleCreatePreset = useCallback(
    async (preset: LaborPreset) => {
      const presetStr = presetRates[preset.key];
      // Explicitly check for empty string so '0' is preserved and not bypassed by fallback
      const chosenStr = presetStr !== "" && presetStr !== undefined ? presetStr : hourlyRate;
      const specificRate = Number(chosenStr);

      await createLaborRate({
        key: preset.key,
        name: preset.code,
        description: preset.description,
        rateType: preset.rateType,
        rateValue: specificRate,
      });
    },
    [createLaborRate, hourlyRate, presetRates]
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
      ].join(" ");

      return text.includes(q);
    });
  }, [laborRates, search]);

  const hasAnyBlueprintRate = Boolean(
    blueprintRates.cp || blueprintRates.ip || blueprintRates.wp
  );

  return (
    <div
      style={{
        display: "grid",
        gap: 14,
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

      {/* Meta Indicators Header */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span style={badgeStyle}>
          Tek Site ID: <b style={{ color: siteId ? "#86efac" : "#fcd34d" }}>{siteId}</b>
        </span>
        <span style={badgeStyle}>
          Active Headers: <b style={{ color: "#f8fafc" }}>{headerCount}</b>
        </span>
        <span
          style={{
            ...badgeStyle,
            background: hasAnyBlueprintRate ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.03)",
            border: hasAnyBlueprintRate ? "1px solid rgba(34,197,94,0.25)" : "1px solid rgba(255,255,255,0.08)",
            color: hasAnyBlueprintRate ? "#86efac" : "#94a3b8",
          }}
        >
          Blueprint Rates:{" "}
          <b style={{ color: hasAnyBlueprintRate ? "#86efac" : "#f8fafc" }}>
            {blueprintLoading ? "Loading..." : hasAnyBlueprintRate ? "Detected" : "None Found"}
          </b>
        </span>

        {hasAnyBlueprintRate && (
          <button
            type="button"
            onClick={handleReloadFromBlueprint}
            style={{
              background: "rgba(34,197,94,0.12)",
              border: "1px solid rgba(34,197,94,0.3)",
              color: "#86efac",
              fontSize: "11px",
              padding: "4px 8px",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            ↻ Sync from Blueprint
          </button>
        )}

        <button
          className="btn-secondary btn-sm"
          onClick={() => void fetchLaborRates()}
          disabled={loading}
          style={{ marginLeft: "auto" }}
        >
          {loading ? "Refreshing..." : "↻ Refresh Server List"}
        </button>
      </div>

      {message && (
        <div
          style={{
            borderRadius: 12,
            padding: "10px 12px",
            fontSize: 13,
            color: message.ok ? "#bbf7d0" : "#fecaca",
            background: message.ok ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
            border: message.ok ? "1px solid rgba(34,197,94,0.22)" : "1px solid rgba(239,68,68,0.22)",
          }}
        >
          {message.text}
        </div>
      )}

      {/* Shared Create Settings */}
      <div style={cardStyle}>
        <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 12 }}>
          Effective Date & Settings
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 14,
          }}
        >
          <div>
            <label style={{ display: "block", color: "#cbd5e1", fontSize: 13, marginBottom: 6 }}>
              Default Fallback Rate ($)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.03)",
                color: "#f8fafc",
                outline: "none",
                boxSizing: "border-box",
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
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.03)",
                color: "#f8fafc",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
        </div>
      </div>

      {/* Quick Create Presets */}
      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <div>
            <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800 }}>
              Deploy Standard Labor Rates
            </div>
            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2 }}>
              Pre-filled from Service Blueprint. Creates rates and refreshes the server data automatically.
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {PRESET_RATES.map((preset) => {
            const currentVal = presetRates[preset.key] || "";
            const bpDetected = blueprintRates[preset.key];

            return (
              <div
                key={preset.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  padding: "10px 14px",
                  borderRadius: 10,
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

                  <div>
                    <div style={{ color: "#f8fafc", fontSize: 14, fontWeight: 600 }}>
                      {preset.description}
                    </div>
                    {bpDetected !== "" && bpDetected !== undefined ? (
                      <div style={{ color: "#86efac", fontSize: 11, marginTop: 2 }}>
                        ✨ Blueprint: {formatCurrency(bpDetected)}
                      </div>
                    ) : (
                      <div style={{ color: "#94a3b8", fontSize: 11, marginTop: 2 }}>
                        No Blueprint rate found
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "#cbd5e1", fontSize: 13 }}>Rate ($):</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={currentVal}
                      onChange={(e) => {
                        const val = e.target.value;
                        setPresetRates((prev) => ({
                          ...prev,
                          [preset.key]: val,
                        }));
                      }}
                      placeholder="0.00"
                      style={{
                        width: 100,
                        padding: "6px 10px",
                        borderRadius: 8,
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "rgba(0,0,0,0.3)",
                        color: "#86efac",
                        fontWeight: 700,
                        outline: "none",
                        fontSize: 13,
                      }}
                    />
                  </div>

                  <button
                    className="btn-primary"
                    onClick={() => void handleCreatePreset(preset)}
                    disabled={creatingKey !== null || headerCount === 0}
                    style={{
                      background: preset.accent,
                      borderColor: preset.accent,
                      padding: "8px 16px",
                      fontSize: 13,
                    }}
                  >
                    {creatingKey === preset.key ? "Creating..." : `Create ${preset.code}`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Custom Labor Rate */}
      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: showCustomForm ? 12 : 0,
          }}
        >
          <div>
            <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800 }}>
              Custom Labor Rate
            </div>
            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2 }}>
              Create an ad-hoc custom labor code with a unique description.
            </div>
          </div>

          <button
            className="btn-secondary btn-sm"
            onClick={() => setShowCustomForm((v) => !v)}
          >
            {showCustomForm ? "Hide Form" : "+ Create Custom"}
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
              borderRadius: 10,
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
                  borderRadius: 8,
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
                  borderRadius: 8,
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
                placeholder="0.00"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "9px 12px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(255,255,255,0.03)",
                  color: "#f8fafc",
                  outline: "none",
                  fontSize: 13,
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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

      {/* Live Server Rates Table */}
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
            <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800 }}>
              Existing Server Labor Rates ({laborRates.length})
            </div>
            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2 }}>
              Live server records fetched via GET. Updates automatically after any rate is created.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search server rates..."
              style={{
                width: 220,
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.03)",
                color: "#f8fafc",
                outline: "none",
                fontSize: 13,
              }}
            />

            {rawGetResponse ? (
              <button
                className="btn-secondary btn-sm"
                onClick={() => setShowRawGetResponse((v) => !v)}
              >
                {showRawGetResponse ? "Hide JSON" : "Raw JSON"}
              </button>
            ) : null}
          </div>
        </div>

        <div className="labor-pricing-scroll" style={tableScrollWrapStyle(450)}>
          <table className="bx-table" style={tableElementStyle}>
            <thead>
              <tr>
                <th style={stickyThStyle}>Name</th>
                <th style={stickyThStyle}>Description</th>
                <th style={stickyThStyle}>Hourly Rate</th>
                <th style={stickyThStyle}>Effective Date</th>
                <th style={stickyThStyle}>ID</th>
              </tr>
            </thead>
            <tbody>
              {filteredRates.length > 0 ? (
                filteredRates.map((rate, index) => {
                  return (
                    <tr key={`${rate.id || rate.name || "rate"}-${index}`} style={zebraRowStyle(index)}>
                      <td style={tdStyle}>
                        <div style={{ color: "#f8fafc", fontWeight: 800 }}>
                          {rate.name || "—"}
                        </div>
                      </td>
                      <td style={tdStyle}>{rate.description || "—"}</td>
                      <td style={tdStyle}>
                        <span style={{ color: "#86efac", fontWeight: 700 }}>
                          {formatCurrency(getDisplayHourlyRate(rate))}
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
                  <td style={tdStyle} colSpan={5}>
                    <div style={{ color: "#94a3b8", padding: "16px 0", textAlign: "center" }}>
                      {loading
                        ? "Fetching current labor rates from server..."
                        : laborRates.length === 0
                        ? "No labor rates found on the server."
                        : "No rates matched your search."}
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
                borderRadius: 8,
                background: "#0f172a",
                maxHeight: 280,
                overflow: "auto",
              }}
            >
              {JSON.stringify(rawGetResponse, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default LaborPricingView;