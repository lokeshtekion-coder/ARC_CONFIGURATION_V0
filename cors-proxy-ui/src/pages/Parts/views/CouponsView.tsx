import React, { useEffect, useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";

const TGPT_TOKEN_KEY = "tgpt_access_token";
const TGPT_BASE = "https://tapapi.tekioncloud.com/tapapi/tgpt";
const COUPON_CREATE_URL =
  "https://preprodapp.tekioncloud.com/api/parts/proxy/u/settings/coupon";

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
      "glAccount": "STRING (G/L Account string, default '9999')",
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

export const CouponsView: React.FC = () => {
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

  useEffect(() => {
    const saved = localStorage.getItem(TGPT_TOKEN_KEY);
    if (saved) setToken(saved);
  }, []);

  const enabledHeaders = useMemo(() => toEnabledHeaderMap(loadGlobalHeaders()), []);
  const dealerId = useMemo(() => extractDealerIdFromHeaders(enabledHeaders), [enabledHeaders]);
  const globalHeaderCount = useMemo(() => Object.keys(enabledHeaders).length, [enabledHeaders]);

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
        const val = item.discount?.value !== null && item.discount?.value !== undefined ? String(item.discount.value) : "0";

        return {
          id: `parts-coupon-${idx}-${Date.now()}`,
          code: item.couponCode || "",
          description: item.description || "",
          glAccount: item.glAccount || "9999",
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
          const isPercentage = item.discount?.type === "percentage" || item.pricingMethod === "PERCENTAGE";
          const val = item.discount?.value !== null && item.discount?.value !== undefined ? String(item.discount.value) : item.value || "0";

          return {
            id: `parts-coupon-${idx}-${Date.now()}`,
            code: item.couponCode || item.code || "",
            description: item.description || item.name || "",
            glAccount: item.glAccount || "9999",
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
    const dealerPrefix = dealerId || "8126";
    const startTimeVal = String(Date.now());

    return parsedData.map((coupon) => {
      const isPercentage = coupon.pricingMethod === "PERCENTAGE";
      const cleanGl = coupon.glAccount.includes("_") ? coupon.glAccount : `${dealerPrefix}_${coupon.glAccount}`;
      const numericVal = coupon.value || "0";

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
        subPayTypes: [],
        payTypes: ["CUSTOMER_PAY"],
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

    if (!dealerId || globalHeaderCount === 0) {
      setMessage({
        ok: false,
        text: "Global Headers or Dealer ID missing. Please apply dealer headers in Settings first.",
      });
      return;
    }

    setIsPushing(true);
    setMessage(null);

    try {
      const payloadArray = buildPartsTekionPayload();
      let successCount = 0;
      const failures: string[] = [];

      for (const item of payloadArray) {
        const res = await fetch("http://localhost:4000/api/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: COUPON_CREATE_URL,
            method: "POST",
            headers: {
              ...enabledHeaders,
              accept: "application/json, text/plain, */*",
              "content-type": "application/json",
            },
            body: item,
            timeout: 60000,
          }),
        });

        if (!res.ok) {
          failures.push(`${item.couponCode}: proxy HTTP ${res.status}`);
          continue;
        }

        const json = await res.json();
        if ((json?.status ?? 200) >= 400) {
          failures.push(
            `${item.couponCode}: ${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim()
          );
          continue;
        }

        successCount += 1;
      }

      if (failures.length === 0) {
        setMessage({
          ok: true,
          text: `✓ Successfully created ${successCount} of ${payloadArray.length} parts coupons in Tekion Preprod.`,
        });
      } else {
        setMessage({
          ok: false,
          text: `Created ${successCount} of ${payloadArray.length} coupons.\n\nFailed:\n${failures.join("\n")}`,
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
            Active Global Headers: <b style={{ color: "#f8fafc" }}>{globalHeaderCount}</b>
          </span>
          <span style={badgeStyle}>
            Department: <b style={{ color: "#38bdf8" }}>PARTS Only</b>
          </span>
        </div>

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
        <label style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>
          Paste Raw Dealer Notes or Spreadsheet Rows
        </label>
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
        </div>
      </div>

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
          <div style={{ fontWeight: 800, marginBottom: 4 }}>⚠️ Ignored Segments (Not Classified as Valid Coupons):</div>
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
                        onChange={(e) => handleEditRow(idx, "pricingMethod", e.target.value as "FLAT" | "PERCENTAGE")}
                        style={{ ...cellInputStyle, cursor: "pointer" }}
                      >
                        <option value="FLAT" style={{ background: "#18181b" }}>Dollar ($)</option>
                        <option value="PERCENTAGE" style={{ background: "#18181b" }}>Percentage (%)</option>
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
                          background: row.confidence >= 0.8 ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
                          color: row.confidence >= 0.8 ? "#86efac" : "#fde68a",
                        }}
                      >
                        {Math.round(row.confidence * 100)}%
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