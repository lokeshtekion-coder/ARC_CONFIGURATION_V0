import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadGlobalHeaders } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";

type CouponType = "FLAT";
type AppliedOn = "LABOR" | "PARTS" | "LABOR_PLUS_PARTS";
type PricingMethod = "FLAT" | "PERCENTAGE";
type ScenarioKey =
  | "labor-flat"
  | "labor-percentage"
  | "parts-flat"
  | "parts-percentage"
  | "labor-plus-parts-flat"
  | "labor-plus-parts-percentage";

type CouponPayload = {
  couponCode: string;
  description: string;
  department: string;
  opcodes: unknown[];
  serviceTypeIds: unknown[];
  sourceCodeIds: unknown[];
  partIds: unknown[];
  startTime: string;
  expiryTime: string | null;
  discountType: "FLAT";
  appliedOn: AppliedOn;
  pricingDetail: {
    pricingMethod: PricingMethod;
    flatAmount: string | null;
    percentage: string | null;
    capAmount: string | null;
    flatSellingPrice?: string | null;
  };
  pricingMethod: PricingMethod;
  splitByType: "FLAT" | "GROSS";
  departments: Array<{
    value: number;
    department: "SERVICE" | "PARTS";
    glAccountDetailList: Array<{
      glAccount: "SALESL" | "SALESP";
      value: number;
    }>;
  }>;
  considerForGrossCalculation: boolean;
  taxable: boolean;
  roLevelOnly: boolean;
  subPayTypes: string[];
  payTypes: unknown[];
  allowedMultipleTimesInSameRo: boolean;
  languages: {
    documentDefault: string;
    locale?: string | null;
  };
  eligibleCustomerTypes: unknown[];
  accountingGroupId?: null;
  skillIds: unknown[];
  autoAddConfig: {
    autoAddToJobsEnabled: boolean;
    enabledConfigs: unknown[];
    criteria: {
      filters: unknown[];
    };
  };
};

type ScenarioConfig = {
  key: ScenarioKey;
  title: string;
  couponType: CouponType;
  appliedOn: AppliedOn;
  pricingMethod: PricingMethod;
  splitByType: "FLAT" | "GROSS";
};

type PersistedCouponState = {
  appliedOn: AppliedOn;
  pricingMethod: PricingMethod;
  couponCode: string;
  description: string;
  couponValue: string;
  expiryTime: string;
};

const CREATE_COUPON_URL =
  "https://preprodapp.tekioncloud.com/api/service-module/u/coupon?locale=en_US";

const STORAGE_KEY = "ARC_COUPONS_VIEW_STATE_V1";

const SCENARIOS: ScenarioConfig[] = [
  {
    key: "labor-flat",
    title: "Labor + Dollar",
    couponType: "FLAT",
    appliedOn: "LABOR",
    pricingMethod: "FLAT",
    splitByType: "FLAT",
  },
  {
    key: "labor-percentage",
    title: "Labor + Percentage",
    couponType: "FLAT",
    appliedOn: "LABOR",
    pricingMethod: "PERCENTAGE",
    splitByType: "FLAT",
  },
  {
    key: "parts-flat",
    title: "Parts + Dollar",
    couponType: "FLAT",
    appliedOn: "PARTS",
    pricingMethod: "FLAT",
    splitByType: "FLAT",
  },
  {
    key: "parts-percentage",
    title: "Parts + Percentage",
    couponType: "FLAT",
    appliedOn: "PARTS",
    pricingMethod: "PERCENTAGE",
    splitByType: "FLAT",
  },
  {
    key: "labor-plus-parts-flat",
    title: "Labor + Parts + Dollar",
    couponType: "FLAT",
    appliedOn: "LABOR_PLUS_PARTS",
    pricingMethod: "FLAT",
    splitByType: "GROSS",
  },
  {
    key: "labor-plus-parts-percentage",
    title: "Labor + Parts + Percentage",
    couponType: "FLAT",
    appliedOn: "LABOR_PLUS_PARTS",
    pricingMethod: "PERCENTAGE",
    splitByType: "GROSS",
  },
];

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
): string | null {
  const entries = Object.entries(headers);
  for (const candidate of candidates) {
    const found = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
    if (found && normalize(found[1])) return normalize(found[1]);
  }
  return null;
}

function extractDealerIdFromHeaders(headers: Record<string, string>): string | null {
  return findHeaderValueCaseInsensitive(headers, [
    "dealerid",
    "dealerId",
    "dealer-id",
    "x-dealer-id",
  ]);
}

function getLiveStartTime(): string {
  return String(Date.now());
}

function buildDepartments(appliedOn: AppliedOn): CouponPayload["departments"] {
  if (appliedOn === "LABOR") {
    return [
      {
        value: 100,
        department: "SERVICE",
        glAccountDetailList: [
          {
            glAccount: "SALESL",
            value: 100,
          },
        ],
      },
    ];
  }

  if (appliedOn === "PARTS") {
    return [
      {
        value: 100,
        department: "PARTS",
        glAccountDetailList: [
          {
            glAccount: "SALESP",
            value: 100,
          },
        ],
      },
    ];
  }

  return [
    {
      value: 0,
      department: "SERVICE",
      glAccountDetailList: [
        {
          glAccount: "SALESL",
          value: 100,
        },
      ],
    },
    {
      value: 0,
      department: "PARTS",
      glAccountDetailList: [
        {
          glAccount: "SALESP",
          value: 100,
        },
      ],
    },
  ];
}

function buildPayload(
  scenario: ScenarioConfig,
  couponCode: string,
  description: string,
  couponValue: string,
  expiryTime: string
): CouponPayload {
  const cleanValue = normalize(couponValue);
  const isFlat = scenario.pricingMethod === "FLAT";
  const isPartsScenario = scenario.appliedOn === "PARTS";

  const payload: CouponPayload = {
    couponCode: normalize(couponCode),
    description: normalize(description),
    department: "SERVICE",
    opcodes: [],
    serviceTypeIds: [],
    sourceCodeIds: [],
    partIds: [],
    startTime: getLiveStartTime(),
    expiryTime: normalize(expiryTime) || (isPartsScenario ? null : ""),
    discountType: scenario.couponType,
    appliedOn: scenario.appliedOn,
    pricingDetail: {
      pricingMethod: scenario.pricingMethod,
      flatAmount: isFlat ? cleanValue : null,
      percentage: isFlat ? null : cleanValue,
      capAmount: null,
    },
    pricingMethod: scenario.pricingMethod,
    splitByType: scenario.splitByType,
    departments: buildDepartments(scenario.appliedOn),
    considerForGrossCalculation: false,
    taxable: false,
    roLevelOnly: false,
    subPayTypes: ["ALL_CUSTOMER_PAY"],
    payTypes: [],
    allowedMultipleTimesInSameRo: true,
    languages: {
      documentDefault: "en_US",
    },
    eligibleCustomerTypes: [],
    skillIds: [],
    autoAddConfig: {
      autoAddToJobsEnabled: false,
      enabledConfigs: [],
      criteria: {
        filters: [],
      },
    },
  };

  if (isPartsScenario) {
    payload.pricingDetail.flatSellingPrice = null;
    payload.languages.locale = null;
    payload.accountingGroupId = null;
  }

  return payload;
}

function detectPricingMethodFromDescription(description: string): PricingMethod | null {
  const text = normalize(description).toLowerCase();
  if (!text) return null;

  if (text.includes("%") || text.includes("percentage")) {
    return "PERCENTAGE";
  }

  return null;
}

function detectFirstNumber(description: string): string {
  const text = normalize(description);
  if (!text) return "";

  const match = text.match(/\d+(?:\.\d+)?/);
  return match ? match[0] : "";
}

function buildCouponCodeFromDescription(
  description: string,
  appliedOn: AppliedOn,
  pricingMethod: PricingMethod
): string {
  const number = detectFirstNumber(description);
  if (!number) return "";

  const numericPart = number.replace(/\.0+$/, "").replace(/\./g, "");
  const appliedSuffix =
    appliedOn === "LABOR"
      ? "L"
      : appliedOn === "PARTS"
      ? "P"
      : "LP";

  if (pricingMethod === "PERCENTAGE") {
    return `${numericPart}${appliedSuffix}`;
  }

  return `${numericPart}${appliedSuffix}C`;
}

function safeLoadPersistedState(): PersistedCouponState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedCouponState>;
    if (!parsed) return null;

    const appliedOn = parsed.appliedOn;
    const pricingMethod = parsed.pricingMethod;

    if (
      appliedOn !== "LABOR" &&
      appliedOn !== "PARTS" &&
      appliedOn !== "LABOR_PLUS_PARTS"
    ) {
      return null;
    }

    if (pricingMethod !== "FLAT" && pricingMethod !== "PERCENTAGE") {
      return null;
    }

    return {
      appliedOn,
      pricingMethod,
      couponCode: normalize(parsed.couponCode),
      description: normalize(parsed.description),
      couponValue: normalize(parsed.couponValue),
      expiryTime: normalize(parsed.expiryTime),
    };
  } catch {
    return null;
  }
}

function safeSavePersistedState(state: PersistedCouponState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

const shellStyle: React.CSSProperties = {
  display: "grid",
  gap: 16,
};

const cardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  borderRadius: 18,
  padding: 18,
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "#94a3b8",
  marginBottom: 8,
  display: "block",
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 42,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.04)",
  color: "#f8fafc",
  padding: "0 12px",
  outline: "none",
  fontSize: 14,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 90,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.04)",
  color: "#f8fafc",
  padding: 12,
  outline: "none",
  fontSize: 14,
  resize: "vertical",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: "pointer",
};

const badgeStyle: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "#cbd5e1",
  fontSize: 12,
};

export const CouponsView: React.FC = () => {
  const persisted = useMemo(() => safeLoadPersistedState(), []);

  const [couponType] = useState<CouponType>("FLAT");
  const [appliedOn, setAppliedOn] = useState<AppliedOn>(persisted?.appliedOn ?? "LABOR");
  const [pricingMethod, setPricingMethod] = useState<PricingMethod>(
    persisted?.pricingMethod ?? "FLAT"
  );

  const [couponCode, setCouponCode] = useState(persisted?.couponCode ?? "");
  const [description, setDescription] = useState(persisted?.description ?? "");
  const [couponValue, setCouponValue] = useState(persisted?.couponValue ?? "");
  const [expiryTime, setExpiryTime] = useState(persisted?.expiryTime ?? "");

  const [headerMap, setHeaderMap] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [responseText, setResponseText] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const descriptionManuallyEditedRef = useRef(false);
  const couponCodeManuallyEditedRef = useRef(false);
  const valueManuallyEditedRef = useRef(false);
  const isApplyingDetectionRef = useRef(false);

  useEffect(() => {
    console.log("[Parts][CouponsView] mounted");
    try {
      const headers = loadGlobalHeaders();
      const enabled = toEnabledHeaderMap(headers);
      console.log("[Parts][CouponsView] loaded global headers", enabled);
      setHeaderMap(enabled);
    } catch (error) {
      console.error("[Parts][CouponsView] failed to load global headers", error);
      setHeaderMap({});
    }

    return () => console.log("[Parts][CouponsView] unmounted");
  }, []);

  const dealerId = useMemo(() => extractDealerIdFromHeaders(headerMap) ?? "", [headerMap]);

  const selectedScenario = useMemo(() => {
    return (
      SCENARIOS.find(
        (item) =>
          item.couponType === couponType &&
          item.appliedOn === appliedOn &&
          item.pricingMethod === pricingMethod
      ) ?? SCENARIOS[0]
    );
  }, [couponType, appliedOn, pricingMethod]);

  const valueLabel = pricingMethod === "FLAT" ? "Coupon Value ($)" : "Coupon Value (%)";

  const payload = useMemo(() => {
    return buildPayload(
      selectedScenario,
      couponCode,
      description,
      couponValue,
      expiryTime
    );
  }, [selectedScenario, couponCode, description, couponValue, expiryTime]);

  useEffect(() => {
    safeSavePersistedState({
      appliedOn,
      pricingMethod,
      couponCode,
      description,
      couponValue,
      expiryTime,
    });
  }, [appliedOn, pricingMethod, couponCode, description, couponValue, expiryTime]);

  useEffect(() => {
    if (!description || isApplyingDetectionRef.current) return;

    const detectedPricingMethod = detectPricingMethodFromDescription(description);
    const detectedNumber = detectFirstNumber(description);
    const detectedCode = buildCouponCodeFromDescription(
      description,
      appliedOn,
      detectedPricingMethod ?? pricingMethod
    );

    isApplyingDetectionRef.current = true;

    try {
      if (detectedPricingMethod && detectedPricingMethod !== pricingMethod) {
        setPricingMethod(detectedPricingMethod);
      }

      if (!valueManuallyEditedRef.current && detectedNumber && !normalize(couponValue)) {
        setCouponValue(detectedNumber);
      }

      if (!couponCodeManuallyEditedRef.current && detectedCode) {
        setCouponCode(detectedCode);
      }
    } finally {
      setTimeout(() => {
        isApplyingDetectionRef.current = false;
      }, 0);
    }
  }, [description, appliedOn, pricingMethod, couponValue]);

  const refreshHeaders = useCallback(() => {
    try {
      const headers = loadGlobalHeaders();
      const enabled = toEnabledHeaderMap(headers);
      console.log("[Parts][CouponsView] refresh headers", enabled);
      setHeaderMap(enabled);
      setMessage({
        ok: true,
        text: "✅ Global headers refreshed",
      });
    } catch (error) {
      console.error("[Parts][CouponsView] refresh headers failed", error);
      setMessage({
        ok: false,
        text: "❌ Failed to refresh global headers",
      });
    }
  }, []);

  const handleResetForm = useCallback(() => {
    descriptionManuallyEditedRef.current = false;
    couponCodeManuallyEditedRef.current = false;
    valueManuallyEditedRef.current = false;

    setAppliedOn("LABOR");
    setPricingMethod("FLAT");
    setCouponCode("");
    setDescription("");
    setCouponValue("");
    setExpiryTime("");
    setResponseText("");
    setMessage({
      ok: true,
      text: "✅ Coupon form reset",
    });

    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const handleCreateCoupon = useCallback(async () => {
    console.log("[Parts][CouponsView] create clicked", {
      selectedScenarioKey: selectedScenario.key,
      payload,
    });

    setMessage(null);
    setResponseText("");

    if (!dealerId) {
      setMessage({
        ok: false,
        text: "❌ Dealer ID not found in enabled global headers",
      });
      return;
    }

    if (!normalize(couponCode)) {
      setMessage({
        ok: false,
        text: "❌ Coupon Code is required",
      });
      return;
    }

    if (!normalize(description)) {
      setMessage({
        ok: false,
        text: "❌ Description is required",
      });
      return;
    }

    if (!normalize(couponValue)) {
      setMessage({
        ok: false,
        text: `❌ ${valueLabel} is required`,
      });
      return;
    }

    setSubmitting(true);

    try {
      const latestHeaders = toEnabledHeaderMap(loadGlobalHeaders());

      const proxyRes = await fetch("http://localhost:4000/api/proxy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: CREATE_COUPON_URL,
          method: "POST",
          headers: latestHeaders,
          body: payload,
          timeout: 60000,
        }),
      });

      if (!proxyRes.ok) {
        throw new Error(`Proxy request failed with HTTP ${proxyRes.status}`);
      }

      const proxyJson = (await proxyRes.json()) as {
        status?: number;
        statusText?: string;
        body?: unknown;
        data?: unknown;
      };

      console.log("[Parts][CouponsView] proxy response", proxyJson);

      if ((proxyJson.status ?? 200) >= 400) {
        throw new Error(
          `Coupon create failed: ${proxyJson.status ?? ""} ${proxyJson.statusText ?? ""}`.trim()
        );
      }

      const actualPayload = proxyJson.body ?? proxyJson.data ?? proxyJson;
      setResponseText(JSON.stringify(actualPayload, null, 2));
      setMessage({
        ok: true,
        text: `✅ Coupon created successfully for dealer ${dealerId}`,
      });
    } catch (error: unknown) {
      console.error("[Parts][CouponsView] create failed", error);
      setMessage({
        ok: false,
        text: error instanceof Error ? `❌ ${error.message}` : "❌ Failed to create coupon",
      });
    } finally {
      setSubmitting(false);
    }
  }, [dealerId, couponCode, description, couponValue, valueLabel, payload, selectedScenario]);

  return (
    <div style={shellStyle}>
      <div style={cardStyle}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc" }}>Coupons</div>
          <div style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.7 }}>
            Smart coupon payload generator with auto detection, persisted user selections, payload preview, and proxy POST using global headers.
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
            <span style={badgeStyle}>
              Dealer ID: <b style={{ color: dealerId ? "#86efac" : "#fca5a5" }}>{dealerId || "Not found"}</b>
            </span>
            <span style={badgeStyle}>
              Coupon Type: <b style={{ color: "#f8fafc" }}>{couponType}</b>
            </span>
            <span style={badgeStyle}>
              Applied On: <b style={{ color: "#f8fafc" }}>{appliedOn}</b>
            </span>
            <span style={badgeStyle}>
              Pricing Method: <b style={{ color: "#f8fafc" }}>{pricingMethod}</b>
            </span>
            <span style={badgeStyle}>
              Scenario: <b style={{ color: "#f8fafc" }}>{selectedScenario.title}</b>
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "420px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
        <div style={{ ...cardStyle, display: "grid", gap: 16 }}>
          <div>
            <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800, marginBottom: 12 }}>
              Options
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={labelStyle}>Coupon Type</label>
                <input style={inputStyle} value="FLAT" disabled />
              </div>

              <div>
                <label style={labelStyle}>Applied On</label>
                <select
                  style={selectStyle}
                  value={appliedOn}
                  onChange={(e) => {
                    setAppliedOn(e.target.value as AppliedOn);
                    setMessage(null);
                  }}
                >
                  <option value="LABOR">LABOR</option>
                  <option value="PARTS">PARTS</option>
                  <option value="LABOR_PLUS_PARTS">LABOR_PLUS_PARTS</option>
                </select>
              </div>

              <div>
                <label style={labelStyle}>Pricing Method</label>
                <select
                  style={selectStyle}
                  value={pricingMethod}
                  onChange={(e) => {
                    setPricingMethod(e.target.value as PricingMethod);
                    setMessage(null);
                  }}
                >
                  <option value="FLAT">FLAT / DOLLAR</option>
                  <option value="PERCENTAGE">PERCENTAGE</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800, marginBottom: 12 }}>
              Manual Inputs
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label style={labelStyle}>Coupon Code</label>
                <input
                  style={inputStyle}
                  value={couponCode}
                  onChange={(e) => {
                    couponCodeManuallyEditedRef.current = true;
                    setCouponCode(e.target.value);
                    setMessage(null);
                  }}
                  placeholder="Auto-detected from description number, or enter manually"
                />
              </div>

              <div>
                <label style={labelStyle}>Description</label>
                <textarea
                  style={textareaStyle}
                  value={description}
                  onChange={(e) => {
                    descriptionManuallyEditedRef.current = true;
                    setDescription(e.target.value);
                    setMessage(null);
                  }}
                  placeholder='Example: 10% DISCOUNT ON LABOR or 100.00 SERVICE CHECK COUPON'
                />
              </div>

              <div>
                <label style={labelStyle}>{valueLabel}</label>
                <input
                  style={inputStyle}
                  value={couponValue}
                  onChange={(e) => {
                    valueManuallyEditedRef.current = true;
                    setCouponValue(e.target.value);
                    setMessage(null);
                  }}
                  placeholder={pricingMethod === "FLAT" ? "Enter dollar amount" : "Enter percentage"}
                />
              </div>

              <div>
                <label style={labelStyle}>Expiry Time (optional)</label>
                <input
                  style={inputStyle}
                  value={expiryTime}
                  onChange={(e) => {
                    setExpiryTime(e.target.value);
                    setMessage(null);
                  }}
                  placeholder='Leave blank for "" / null based on scenario'
                />
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <button
              className="btn-secondary btn-sm"
              onClick={refreshHeaders}
              type="button"
            >
              ⟳ Refresh Global Headers
            </button>

            <button
              className="btn-secondary btn-sm"
              onClick={handleResetForm}
              type="button"
            >
              Reset Form
            </button>

            <button
              className="btn-primary"
              onClick={() => void handleCreateCoupon()}
              type="button"
              disabled={submitting}
            >
              {submitting ? "Creating..." : "⚙ Create Coupon"}
            </button>
          </div>

          {message ? (
            <div
              style={{
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

        <div style={{ display: "grid", gap: 16 }}>
          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800, marginBottom: 10 }}>
              Smart Detection Summary
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <span style={badgeStyle}>
                Description Detects %: <b style={{ color: "#f8fafc" }}>
                  {detectPricingMethodFromDescription(description) === "PERCENTAGE" ? "YES" : "NO"}
                </b>
              </span>
              <span style={badgeStyle}>
                First Number: <b style={{ color: "#f8fafc" }}>{detectFirstNumber(description) || "—"}</b>
              </span>
              <span style={badgeStyle}>
                Suggested Code: <b style={{ color: "#f8fafc" }}>
                  {buildCouponCodeFromDescription(description, appliedOn, pricingMethod) || "—"}
                </b>
              </span>
              <span style={badgeStyle}>
                Scenario: <b style={{ color: "#f8fafc" }}>{selectedScenario.title}</b>
              </span>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800, marginBottom: 10 }}>
              Payload Preview
            </div>
            <div
              style={{
                maxHeight: 520,
                overflow: "auto",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
                padding: 12,
              }}
            >
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  color: "#e2e8f0",
                  fontSize: 12,
                  lineHeight: 1.6,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {JSON.stringify(payload, null, 2)}
              </pre>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800, marginBottom: 10 }}>
              API Response
            </div>

            <div
              style={{
                maxHeight: 320,
                overflow: "auto",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
                padding: 12,
              }}
            >
              <pre
                style={{
                  margin: 0,
                  minHeight: 120,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  color: responseText ? "#e2e8f0" : "#94a3b8",
                  fontSize: 12,
                  lineHeight: 1.6,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                }}
              >
                {responseText || "No response yet"}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CouponsView;
