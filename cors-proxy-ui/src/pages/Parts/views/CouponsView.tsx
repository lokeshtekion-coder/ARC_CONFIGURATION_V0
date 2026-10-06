import React, { useEffect, useMemo, useState } from "react";
import { loadTekionCapturedProfiles } from "../../../services/tekionCapturedProfiles";
import { loadGlobalHeaders } from "../../../services/tekionApiSettings";
import { usePartsBlueprint } from "../../../Context/Blueprint_Parts_Context";


const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";
const PROXY_ENDPOINT = "http://127.0.0.1:4000/api/proxy";
const DEFAULT_HOST = "https://preprodapp.tekioncloud.com";

const TGPT_TOKEN_KEY = "tgpt_access_token";
const TGPT_BASE = "https://tapapi.tekioncloud.com/tapapi/tgpt";

const QUESTION_HAS_COUPONS = "Do you have any parts coupons/discounts?";
const QUESTION_COUPON_DETAILS =
  "If yes, please provide the details for all additional discounts or other information here:";

const MASTER_PARTS_PROMPT = `You are a lossless Automotive DMS Data Extraction Engine specializing specifically in PARTS Coupons and Discounts.
The input contains arbitrary text from dealer parts notes, price lists, parts percentages, and spreadsheet exports.
Your highest-priority task is to extract these parts coupons into strict JSON. DO NOT DISCARD OR SILENTLY IGNORE ANY INPUT TEXT.

All coupons here are strictly for the PARTS department.

OUTPUT FORMAT:
Return valid JSON only. Do not return markdown fences or extra explanations.
{
  "records": [
    {
      "couponCode": "STRING (Max 15 chars, Alphanumeric UPPERCASE. Generate if missing using exact parts description keywords)",
      "description": "STRING (Preserve the parts wording clearly)",
      "glAccount": "STRING (G/L Account string, default 'SALESP')",
      "discount": {
        "type": "percentage" | "flat_amount" | "none",
        "value": NUMBER | null,
        "capAmount": NUMBER | null
      },
      "confidence": NUMBER (0.0 to 1.0)
    }
  ],
  "unclassifiedSegments": ["STRING"]
}

EXTRACTION RULES:
1. ALL coupons extracted here are strictly applied to PARTS only.

2. DISCOUNTS:
- "10% OFF PARTS", "15% DISCOUNT" -> discount.type = "percentage", value = 10 or 15.
- "$20 OFF", "5.00 OFF", "DOLLAR OFF" -> discount.type = "flat_amount", value = 20 or 5.
- If a cap exists (e.g. "Up to $100"), set discount.capAmount to 100.

3. If no number is mentioned but discount is indicated, set discount.type = "flat_amount" and value = 1.
4. Clean the description to be human-readable and meaningful.

RAW DATA:
`;

export interface ParsedPartsCoupon {
  id: string;
  code: string;
  description: string;
  glAccount: string;
  pricingMethod: "FLAT" | "PERCENTAGE";
  value: string;
  capAmount: string;
  confidence: number;
}

interface UiMessage {
  ok: boolean;
  text: string;
}

function normalize(value: unknown): string {
  if (Array.isArray(value)) return normalize(value[0]);
  return String(value ?? "").trim();
}

/**
 * Resolves active dealer headers from canonical profile first,
 * falling back to global settings headers.
 */
function resolveActiveHeaders(): { headers: Record<string, string>; baseHost: string; dealerId: string } {
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
  let dealerId = matchedProfile?.dealerId || "";

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
    const rawHeaders = loadGlobalHeaders();
    for (const row of rawHeaders) {
      if (!row?.enabled) continue;
      const key = normalize(row.key).toLowerCase();
      const value = normalize(row.value);
      if (!key || !value) continue;
      headers[key] = value;
      if (key === "dealerid" && !dealerId) {
        dealerId = value;
      }
    }
  }

  headers["content-type"] = "application/json";
  return { headers, baseHost, dealerId };
}

export const CouponsView: React.FC = () => {
  const { getAnswer, hasBlueprint, loading: blueprintLoading } = usePartsBlueprint();

  const [token, setToken] = useState<string>("");
  const [draftToken, setDraftToken] = useState<string>("");
  const [inputText, setInputText] = useState<string>("");
  const [parsedData, setParsedData] = useState<ParsedPartsCoupon[]>([]);
  const [unclassifiedData, setUnclassifiedData] = useState<string[]>([]);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [isPushing, setIsPushing] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [overrideNoCoupons, setOverrideNoCoupons] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(TGPT_TOKEN_KEY);
    if (saved) setToken(saved);
  }, []);

  const { headers: activeHeaders, baseHost, dealerId } = useMemo(() => resolveActiveHeaders(), []);
  const activeHeaderCount = useMemo(() => Object.keys(activeHeaders).length, [activeHeaders]);

  // Handle both string and array representations from blueprint
  const blueprintCouponStatus = useMemo(() => {
    const ans = getAnswer(QUESTION_HAS_COUPONS);
    return normalize(ans);
  }, [getAnswer]);

  const hasCouponsInBlueprint = useMemo(() => {
    return blueprintCouponStatus.toLowerCase() === "yes";
  }, [blueprintCouponStatus]);

  const isExplicitNoInBlueprint = useMemo(() => {
    return blueprintCouponStatus.toLowerCase() === "no";
  }, [blueprintCouponStatus]);

  const blueprintDetailsText = useMemo(() => {
    const ans = getAnswer(QUESTION_COUPON_DETAILS);
    return normalize(ans);
  }, [getAnswer]);

  useEffect(() => {
    if (hasBlueprint && hasCouponsInBlueprint && blueprintDetailsText && !inputText) {
      setInputText(blueprintDetailsText);
    }
  }, [hasBlueprint, hasCouponsInBlueprint, blueprintDetailsText, inputText]);

  const handleSaveToken = () => {
    if (!draftToken.trim()) return;
    localStorage.setItem(TGPT_TOKEN_KEY, draftToken.trim());
    setToken(draftToken.trim());
  };

  const handleAIParse = async () => {
    if (!inputText.trim() || !token) return;

    setIsAiLoading(true);
    setLoadingText("Initializing TGPT...");
    setUnclassifiedData([]);
    setMessage(null);

    try {
      const createRes = await fetch(`${TGPT_BASE}/conversations`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-5.4",
          title: "Parts Coupon Parsing Workflow",
          is_temporary: true,
          thinking: false,
        }),
      });

      if (!createRes.ok) {
        throw new Error("Failed to create TGPT conversation. Token might be invalid or expired.");
      }

      const { id: convId } = await createRes.json();
      setLoadingText("Extracting Parts Coupons...");

      const payload = {
        content: MASTER_PARTS_PROMPT + inputText,
        attachments: [],
        thinking: false,
        web_search_enabled: false,
        code_execution_enabled: false,
        artifacts_enabled: false,
      };

      const streamRes = await fetch(`${TGPT_BASE}/conversations/${convId}/messages/stream`, {
        method: "POST",
        headers: {
          accept: "*/*",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!streamRes.ok || !streamRes.body) {
        throw new Error("Stream communication failed");
      }

      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (!part.trim()) continue;
          const lines = part.split("\n");
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const rawData = line.substring(6).trim();
            if (rawData === "[DONE]") continue;

            try {
              const data = JSON.parse(rawData);
              if (data.type === "content_delta") {
                assistantContent += data.delta || "";
              }
            } catch {}
          }
        }
      }

      const jsonMatch = assistantContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("AI did not return a valid JSON structure.");
      }

      const jsonData = JSON.parse(jsonMatch[0]);
      const formatted: ParsedPartsCoupon[] = (jsonData.records || []).map((item: any, idx: number) => {
        const isPercentage = item.discount?.type === "percentage";
        const val =
          item.discount?.value !== null && item.discount?.value !== undefined
            ? String(item.discount.value)
            : "0";

        return {
          id: `parts-coupon-${idx}-${Date.now()}`,
          code: item.couponCode || "",
          description: item.description || "",
          glAccount: item.glAccount || "SALESP",
          pricingMethod: isPercentage ? "PERCENTAGE" : "FLAT",
          value: val,
          capAmount: item.discount?.capAmount ? String(item.discount.capAmount) : "",
          confidence: item.confidence ?? 1,
        };
      });

      setParsedData(formatted);
      setUnclassifiedData(jsonData.unclassifiedSegments || []);
      setMessage({
        ok: true,
        text: `✓ Parsed ${formatted.length} Parts coupon(s) successfully.`,
      });
    } catch (error: any) {
      setMessage({
        ok: false,
        text: `AI Error: ${error.message}`,
      });
    } finally {
      setIsAiLoading(false);
      setLoadingText("");
    }
  };

  const handleManualParse = () => {
    const trimmed = inputText.trim();
    setMessage(null);

    try {
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        const jsonData = JSON.parse(trimmed);
        const formatted: ParsedPartsCoupon[] = (jsonData.records || []).map((item: any, idx: number) => {
          const isPercentage =
            item.discount?.type === "percentage" || item.pricingMethod === "PERCENTAGE";
          const val =
            item.discount?.value !== null && item.discount?.value !== undefined
              ? String(item.discount.value)
              : item.value || "0";

          return {
            id: `parts-coupon-${idx}-${Date.now()}`,
            code: item.couponCode || item.code || "",
            description: item.description || item.name || "",
            glAccount: item.glAccount || "SALESP",
            pricingMethod: isPercentage ? "PERCENTAGE" : "FLAT",
            value: val,
            capAmount: item.discount?.capAmount ? String(item.discount.capAmount) : item.capAmount || "",
            confidence: item.confidence ?? 1,
          };
        });

        setParsedData(formatted);
        setUnclassifiedData(jsonData.unclassifiedSegments || []);
        setMessage({
          ok: true,
          text: `✓ Loaded ${formatted.length} coupon(s) from JSON.`,
        });
      } else {
        setMessage({
          ok: false,
          text: "For manual parsing, paste a valid JSON object or use AI Parse for raw notes.",
        });
      }
    } catch {
      setMessage({
        ok: false,
        text: "Invalid JSON format for Manual Parse.",
      });
    }
  };

  const buildPartsTekionPayload = () => {
    const startTimeVal = String(Date.now());

    return parsedData.map((coupon) => {
      const isPercentage = coupon.pricingMethod === "PERCENTAGE";
      const numericVal = coupon.value || "0";
      const cleanGl = coupon.glAccount ? coupon.glAccount.trim() : "SALESP";

      const basePayload: any = {
        couponCode: coupon.code,
        description: coupon.description,
        department: "PARTS",
        opcodes: [],
        serviceTypeIds: [],
        sourceCodeIds: [],
        partIds: [],
        startTime: startTimeVal,
        expiryTime: isPercentage ? null : "",
        discountType: "FLAT",
        appliedOn: "PARTS",
        pricingDetail: {
          pricingMethod: coupon.pricingMethod,
          flatAmount: isPercentage ? null : numericVal,
          percentage: isPercentage ? numericVal : null,
          capAmount: isPercentage ? (coupon.capAmount ? coupon.capAmount : null) : null,
          ...(isPercentage ? { flatSellingPrice: null } : {}),
        },
        pricingMethod: coupon.pricingMethod,
        splitByType: "FLAT",
        departments: [
          {
            value: 100,
            department: "PARTS",
            glAccountDetailList: [
              {
                glAccount: cleanGl,
                value: 100,
              },
            ],
          },
        ],
        considerForGrossCalculation: false,
        taxable: false,
        roLevelOnly: false,
        subPayTypes: ["ALL_CUSTOMER_PAY"],
        payTypes: [],
        allowedMultipleTimesInSameRo: true,
        languages: isPercentage
          ? { documentDefault: "en_US", locale: null }
          : { documentDefault: "en_US" },
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

      if (isPercentage) {
        basePayload.accountingGroupId = null;
      }

      return basePayload;
    });
  };

  const handleCopyPayload = () => {
    const payload = buildPartsTekionPayload();
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  const handlePushToTekion = async () => {
    if (parsedData.length === 0) {
      setMessage({ ok: false, text: "No parsed coupon data available to push." });
      return;
    }

    if (!dealerId || activeHeaderCount === 0) {
      setMessage({
        ok: false,
        text: "Active dealer headers or Dealer ID missing. Please select an active dealer profile in Settings.",
      });
      return;
    }

    setIsPushing(true);
    setMessage(null);

    const targetUrl = `${baseHost}/api/service-module/u/coupon?locale=en_US`;

    try {
      const payloadArray = buildPartsTekionPayload();
      let successCount = 0;
      const failures: string[] = [];

      for (const item of payloadArray) {
        const res = await fetch(PROXY_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: targetUrl,
            method: "POST",
            headers: {
              ...activeHeaders,
              accept: "application/json, text/plain, */*",
              "content-type": "application/json",
              locale: "en_US",
            },
            body: item,
            timeout: 60000,
          }),
        });

        if (!res.ok) {
          failures.push(`${item.couponCode}: Proxy server HTTP ${res.status}`);
          continue;
        }

        const proxyResponse = await res.json();
        const upstreamStatus = proxyResponse?.status ?? 200;
        const tekionBody = proxyResponse?.body ?? proxyResponse;

        const isHttpError = typeof upstreamStatus === "number" && upstreamStatus >= 400;
        const isTekionError =
          tekionBody?.status === "ERROR" ||
          tekionBody?.status === "FAILED" ||
          Boolean(tekionBody?.errors?.length) ||
          Boolean(tekionBody?.errorMessage);

        const isSettingDocument = tekionBody?.data?.id?.endsWith("_part_setting");

        if (isHttpError || isTekionError || isSettingDocument) {
          const detail =
            tekionBody?.errorMessage ||
            tekionBody?.errors?.[0]?.message ||
            tekionBody?.message ||
            (isSettingDocument ? "Routed to settings endpoint instead of coupon service" : "") ||
            proxyResponse?.statusText ||
            "Creation failed";

          failures.push(`${item.couponCode}: ${detail}`);
          continue;
        }

        successCount += 1;
      }

      if (failures.length === 0) {
        setMessage({
          ok: true,
          text: `✓ Successfully created ${successCount} of ${payloadArray.length} parts coupon(s) in Tekion.`,
        });
      } else {
        setMessage({
          ok: false,
          text: `Created ${successCount} of ${payloadArray.length} coupon(s).\n\nFailed:\n${failures.join("\n")}`,
        });
      }
    } catch (err: any) {
      setMessage({ ok: false, text: `Push Error: ${err.message}` });
    } finally {
      setIsPushing(false);
    }
  };

  const handleEditRow = (index: number, field: keyof ParsedPartsCoupon, value: any) => {
    const updated = [...parsedData];
    updated[index] = { ...updated[index], [field]: value };
    setParsedData(updated);
  };

  const handleDeleteRow = (id: string) => {
    setParsedData((prev) => prev.filter((row) => row.id !== id));
  };

  if (!token) {
    return (
      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.02)",
          padding: 32,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 280,
          textAlign: "center",
          gap: 16,
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 800, color: "#f8fafc" }}>
          🔑 Authentication Required
        </div>
        <p style={{ color: "#94a3b8", fontSize: 13, maxWidth: 420, lineHeight: 1.6, margin: 0 }}>
          Please connect your <b>TGPT Access Token</b> to unlock AI-assisted data extraction for Parts Coupons.
        </p>
        <div style={{ display: "flex", gap: 8, width: "100%", maxWidth: 400 }}>
          <input
            type="password"
            value={draftToken}
            onChange={(e) => setDraftToken(e.target.value)}
            placeholder="Paste TGPT Token Here..."
            className="st-input"
            style={{ flex: 1, height: 40 }}
          />
          <button onClick={handleSaveToken} className="btn-postman" type="button">
            Connect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Executive Header */}
      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: 18,
          display: "grid",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#f8fafc" }}>
              Parts Coupons & Discounts
            </div>
            <button
              type="button"
              onClick={() => setShowInfo((p) => !p)}
              style={{
                width: 20,
                height: 20,
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "#94a3b8",
                fontSize: 11,
                cursor: "pointer",
                fontWeight: 700,
              }}
              title="Toggle Description"
            >
              i
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => {
                localStorage.removeItem(TGPT_TOKEN_KEY);
                setToken("");
              }}
              className="btn-secondary btn-sm"
              type="button"
            >
              Disconnect TGPT
            </button>
          </div>
        </div>

        {showInfo && (
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
              color: "#94a3b8",
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            Extracts parts-specific coupons directly from unformatted notes or spreadsheets. All payloads are automatically formatted with{" "}
            <code>department: &quot;PARTS&quot;</code> and <code>appliedOn: &quot;PARTS&quot;</code>, pre-filling customer pay accounts and default GLs.
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={badgeStyle}>
            Dealer ID: <b style={{ color: dealerId ? "#86efac" : "#fca5a5" }}>{dealerId || "Not found"}</b>
          </span>
          <span style={badgeStyle}>
            Active Headers: <b style={{ color: "#f8fafc" }}>{activeHeaderCount}</b>
          </span>
          <span style={badgeStyle}>
            Target Host: <b style={{ color: "#60a5fa", fontFamily: "monospace" }}>{baseHost.replace("https://", "")}</b>
          </span>
          <span style={badgeStyle}>
            Department: <b style={{ color: "#38bdf8" }}>PARTS Only</b>
          </span>
          {blueprintLoading ? (
            <span style={badgeStyle}>Blueprint: <b style={{ color: "#fde047" }}>Loading...</b></span>
          ) : (
            <span
              style={{
                ...badgeStyle,
                background: hasCouponsInBlueprint
                  ? "rgba(34, 197, 94, 0.12)"
                  : isExplicitNoInBlueprint
                  ? "rgba(245, 158, 11, 0.12)"
                  : "rgba(255, 255, 255, 0.04)",
                borderColor: hasCouponsInBlueprint
                  ? "rgba(34, 197, 94, 0.3)"
                  : isExplicitNoInBlueprint
                  ? "rgba(245, 158, 11, 0.3)"
                  : "rgba(255, 255, 255, 0.08)",
              }}
            >
              Blueprint Coupon Answer:{" "}
              <b style={{ color: hasCouponsInBlueprint ? "#86efac" : isExplicitNoInBlueprint ? "#fde68a" : "#94a3b8" }}>
                {blueprintCouponStatus || "Not Answered"}
              </b>
            </span>
          )}
        </div>

        {/* EXPLICIT NO WARNING BANNER */}
        {hasBlueprint && isExplicitNoInBlueprint && !overrideNoCoupons && (
          <div
            style={{
              padding: "12px 16px",
              borderRadius: 12,
              background: "rgba(245, 158, 11, 0.08)",
              border: "1px solid rgba(245, 158, 11, 0.25)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div>
              <div style={{ color: "#fde68a", fontSize: 13, fontWeight: 700 }}>
                ⚠️ Blueprint Specifies "No" to Parts Coupons
              </div>
              <div style={{ color: "#cbd5e1", fontSize: 12, marginTop: 2 }}>
                The dealership answered <b>"No"</b> to having parts coupons or discounts. No coupons need to be configured for this store.
              </div>
            </div>

            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setOverrideNoCoupons(true)}
              style={{ fontSize: 11, color: "#fde68a", borderColor: "rgba(245, 158, 11, 0.3)" }}
            >
              Override & Enter Coupons Anyway
            </button>
          </div>
        )}

        {message && (
          <div
            style={{
              borderRadius: 12,
              padding: "10px 14px",
              fontSize: 13,
              whiteSpace: "pre-wrap",
              background: message.ok ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
              border: message.ok ? "1px solid rgba(34,197,94,0.22)" : "1px solid rgba(239,68,68,0.22)",
              color: message.ok ? "#bbf7d0" : "#fecaca",
            }}
          >
            {message.text}
          </div>
        )}
      </div>

      {/* Raw Note Input */}
      {(!isExplicitNoInBlueprint || overrideNoCoupons) && (
        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
            padding: 18,
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>
              Paste Raw Dealer Notes or Spreadsheet Rows
            </label>
            {hasCouponsInBlueprint && blueprintDetailsText && (
              <button
                type="button"
                onClick={() => setInputText(blueprintDetailsText)}
                className="btn-secondary btn-sm"
                style={{ fontSize: 11, padding: "4px 8px" }}
              >
                ⟳ Re-sync from Blueprint Details
              </button>
            )}
          </div>

          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Example:
PARTS10: 10% OFF ALL PARTS - MAX 100 CAP
TIRE25 - $25.00 OFF TIRES PURCHASE
BATTERY15 - $15.00 FLAT DISCOUNT"
            disabled={isAiLoading}
            style={{
              width: "100%",
              height: 120,
              background: "rgba(0,0,0,0.25)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              padding: 12,
              color: "#86efac",
              fontFamily: "ui-monospace, monospace",
              fontSize: 13,
              outline: "none",
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={handleAIParse}
              disabled={isAiLoading || !inputText.trim()}
              className="btn-postman"
              type="button"
            >
              {isAiLoading ? `⏳ ${loadingText}` : "✨ Parse with AI (Auto)"}
            </button>

            <button
              onClick={handleManualParse}
              disabled={isAiLoading || !inputText.trim()}
              className="btn-secondary btn-sm"
              type="button"
            >
              Parse Local JSON
            </button>

            {overrideNoCoupons && (
              <button
                onClick={() => {
                  setOverrideNoCoupons(false);
                  setParsedData([]);
                  setInputText("");
                }}
                className="btn-secondary btn-sm"
                type="button"
                style={{ marginLeft: "auto", color: "#94a3b8" }}
              >
                Cancel Override
              </button>
            )}
          </div>
        </div>
      )}

      {/* Unclassified Warnings */}
      {unclassifiedData.length > 0 && (
        <div
          style={{
            background: "rgba(245, 158, 11, 0.1)",
            border: "1px solid rgba(245, 158, 11, 0.25)",
            borderRadius: 12,
            padding: "12px 16px",
            color: "#fde68a",
            fontSize: 12,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 4 }}>
            ⚠️ Ignored Segments (Not Classified as Valid Coupons):
          </div>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {unclassifiedData.map((txt, i) => (
              <li key={i}>{txt}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Editable Parsed Coupons Table */}
      {parsedData.length > 0 && (
        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
            padding: 16,
            display: "grid",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#f8fafc" }}>
              Extracted Parts Coupons ({parsedData.length})
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={handleCopyPayload} className="btn-secondary btn-sm" type="button">
                {copySuccess ? "✓ Copied JSON" : "📋 Copy Payload"}
              </button>
              <button
                onClick={handlePushToTekion}
                disabled={isPushing}
                className="btn-postman"
                type="button"
              >
                {isPushing ? "Pushing..." : "🚀 Push to Tekion"}
              </button>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                  <th style={thStyle}>Coupon Code</th>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Method</th>
                  <th style={thStyle}>Value ($ / %)</th>
                  <th style={thStyle}>Cap ($)</th>
                  <th style={thStyle}>G/L Account</th>
                  <th style={thStyle}>Conf.</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>✕</th>
                </tr>
              </thead>
              <tbody>
                {parsedData.map((row, idx) => (
                  <tr key={row.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        value={row.code}
                        onChange={(e) => handleEditRow(idx, "code", e.target.value.toUpperCase())}
                        style={{ ...cellInputStyle, color: "#93c5fd", fontWeight: 700 }}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        value={row.description}
                        onChange={(e) => handleEditRow(idx, "description", e.target.value)}
                        style={cellInputStyle}
                      />
                    </td>
                    <td style={tdStyle}>
                      <select
                        value={row.pricingMethod}
                        onChange={(e) =>
                          handleEditRow(idx, "pricingMethod", e.target.value as "FLAT" | "PERCENTAGE")
                        }
                        style={{ ...cellInputStyle, cursor: "pointer" }}
                      >
                        <option value="FLAT" style={{ background: "#18181b" }}>
                          Dollar ($)
                        </option>
                        <option value="PERCENTAGE" style={{ background: "#18181b" }}>
                          Percentage (%)
                        </option>
                      </select>
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        value={row.value}
                        onChange={(e) => handleEditRow(idx, "value", e.target.value)}
                        placeholder="0"
                        style={{ ...cellInputStyle, color: "#86efac", fontWeight: 700 }}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        value={row.capAmount}
                        disabled={row.pricingMethod === "FLAT"}
                        onChange={(e) => handleEditRow(idx, "capAmount", e.target.value)}
                        placeholder={row.pricingMethod === "FLAT" ? "N/A" : "-"}
                        style={{
                          ...cellInputStyle,
                          opacity: row.pricingMethod === "FLAT" ? 0.4 : 1,
                          color: "#fde047",
                        }}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="text"
                        value={row.glAccount}
                        onChange={(e) => handleEditRow(idx, "glAccount", e.target.value)}
                        style={{ ...cellInputStyle, color: "#fca5a5", fontFamily: "monospace" }}
                      />
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <span
                        style={{
                          padding: "2px 6px",
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 700,
                          background:
                            row.confidence >= 0.8
                              ? "rgba(16, 185, 129, 0.15)"
                              : "rgba(245, 158, 11, 0.15)",
                          color: row.confidence >= 0.8 ? "#86efac" : "#fde68a",
                        }}
                      >
                        {Math.round((row.confidence ?? 1) * 100)}%
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "center" }}>
                      <button
                        type="button"
                        onClick={() => handleDeleteRow(row.id)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#ef4444",
                          cursor: "pointer",
                          fontSize: 13,
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const badgeStyle: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "#cbd5e1",
  fontSize: 11,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  color: "#94a3b8",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "6px 8px",
  color: "#e2e8f0",
  fontSize: 12,
  verticalAlign: "middle",
};

const cellInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  background: "rgba(0,0,0,0.3)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 6,
  color: "#f8fafc",
  fontSize: 12,
  outline: "none",
  boxSizing: "border-box",
};

export default CouponsView;