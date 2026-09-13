// /Users/tlreddy/Desktop/ARC_CONFIGURATION_V0/cors-proxy-ui/src/pages/Service/Coupons/index.tsx

import React, { useEffect, useMemo, useState } from "react";
import {
  loadGlobalHeaders,
  loadTekionApiSettingsBundle,
} from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";
import { ParsedCoupon, TGPT_TOKEN_KEY, TGPT_BASE, MASTER_PROMPT } from "./constants";

const COUPON_CREATE_URL =
  "https://preprodapp.tekioncloud.com/api/service-module/u/coupon?locale=en_US";

type UiMessage = {
  ok: boolean;
  text: string;
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

const CouponsView: React.FC = () => {
  const [token, setToken] = useState<string>("");
  const [draftToken, setDraftToken] = useState<string>("");
  const [inputText, setInputText] = useState<string>("");
  const [parsedData, setParsedData] = useState<ParsedCoupon[]>([]);
  const [unclassifiedData, setUnclassifiedData] = useState<string[]>([]);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [isPushing, setIsPushing] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(TGPT_TOKEN_KEY);
    if (saved) setToken(saved);
  }, []);

  const enabledHeaders = useMemo(
    () => toEnabledHeaderMap(loadGlobalHeaders()),
    []
  );

  const dealerId = useMemo(
    () => extractDealerIdFromHeaders(enabledHeaders),
    [enabledHeaders]
  );

  const globalHeaderCount = useMemo(
    () => Object.keys(enabledHeaders).length,
    [enabledHeaders]
  );

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
          title: "Coupon Parsing Workflow",
          is_temporary: true,
          thinking: false,
        }),
      });

      if (!createRes.ok) {
        throw new Error("Failed to create TGPT conversation. Token might be invalid.");
      }

      const { id: convId } = await createRes.json();

      setLoadingText("Extracting Data...");

      const payload = {
        content: MASTER_PROMPT + inputText,
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
        throw new Error("Stream failed");
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
            } catch {
              // ignore malformed chunk
            }
          }
        }
      }

      const jsonMatch = assistantContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("AI did not return a valid JSON object.");
      }

      const jsonData = JSON.parse(jsonMatch[0]);
      const formatted = (jsonData.records || []).map((item: any, idx: number) => ({
        id: `coupon-${idx}-${Date.now()}`,
        code: item.couponCode || "",
        name: item.description || "",
        appliedOn: item.appliedOn || "Labor & Parts",
        glAcct: item.glAccounts || ["9999", "9999"],
        discountType:
          item.discount?.type === "percentage"
            ? "Percentage"
            : item.discount?.type === "flat_amount"
            ? "Flat"
            : "None",
        discountAmount: item.discount?.value ?? null,
        capAmount: item.discount?.capAmount ?? null,
        priceType:
          item.price?.type === "target_price"
            ? "Target Price"
            : item.price?.type === "fixed_price"
            ? "Fixed Price"
            : "None",
        priceAmount: item.price?.amount ?? null,
        confidence: item.confidence ?? 1,
      }));

      setParsedData(formatted);
      setUnclassifiedData(jsonData.unclassifiedSegments || []);
      setMessage({
        ok: true,
        text: `Parsed ${formatted.length} coupon(s) successfully.`,
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
        const formatted = (jsonData.records || []).map((item: any, idx: number) => ({
          id: `coupon-${idx}-${Date.now()}`,
          code: item.couponCode || "",
          name: item.description || "",
          appliedOn: item.appliedOn || "Labor & Parts",
          glAcct: item.glAccounts || ["9999", "9999"],
          discountType:
            item.discount?.type === "percentage"
              ? "Percentage"
              : item.discount?.type === "flat_amount"
              ? "Flat"
              : "None",
          discountAmount: item.discount?.value ?? null,
          capAmount: item.discount?.capAmount ?? null,
          priceType:
            item.price?.type === "target_price"
              ? "Target Price"
              : item.price?.type === "fixed_price"
              ? "Fixed Price"
              : "None",
          priceAmount: item.price?.amount ?? null,
          confidence: item.confidence ?? 1,
        }));

        setParsedData(formatted);
        setUnclassifiedData(jsonData.unclassifiedSegments || []);
        setMessage({
          ok: true,
          text: `Loaded ${formatted.length} coupon(s) from JSON.`,
        });
      } else {
        setMessage({
          ok: false,
          text: "For manual parsing, paste a valid JSON object or use AI Parse for raw text.",
        });
      }
    } catch {
      setMessage({
        ok: false,
        text: "Invalid format for Manual Parse.",
      });
    }
  };

  const buildTekionPayload = () => {
    const dealerPrefix = dealerId || "9999";
    const startTimeVal = String(Date.now() + 120000);

    return parsedData.map((coupon) => {
      const isFixedPrice = coupon.priceAmount !== null && coupon.priceAmount > 0 && (coupon.discountAmount === null || coupon.discountType === "None");
      const isPercentage = !isFixedPrice && coupon.discountType === "Percentage";

      const discountTypeVal = isFixedPrice ? "FIXED" : "FLAT";
      const pricingMethod = isFixedPrice ? "FLAT" : (isPercentage ? "PERCENTAGE" : "FLAT");

      let appliedOnTekion = "LABOR_PLUS_PARTS";
      if (coupon.appliedOn === "Labor") appliedOnTekion = "LABOR";
      else if (coupon.appliedOn === "Parts") appliedOnTekion = "PARTS";

      const splitByType = appliedOnTekion === "LABOR_PLUS_PARTS" ? "GROSS" : "FLAT";

      const formatGl = (acct: string) => {
        if (!acct) return `${dealerPrefix}_9999`;
        return acct.includes("_") ? acct : `${dealerPrefix}_${acct}`;
      };

      let departments: Array<{
        value: number;
        department: string;
        glAccountDetailList: Array<{ glAccount: string; value: number }>;
      }> = [];

      if (appliedOnTekion === "LABOR_PLUS_PARTS") {
        const serviceGl = coupon.glAcct[0] || "9999";
        const partsGl = coupon.glAcct[1] || coupon.glAcct[0] || "9999";
        departments = [
          {
            value: 0,
            department: "SERVICE",
            glAccountDetailList: [{ glAccount: formatGl(serviceGl), value: 100 }],
          },
          {
            value: 0,
            department: "PARTS",
            glAccountDetailList: [{ glAccount: formatGl(partsGl), value: 100 }],
          },
        ];
      } else if (appliedOnTekion === "LABOR") {
        const laborGl = coupon.glAcct[0] || "9999";
        departments = [
          {
            value: 100,
            department: "SERVICE",
            glAccountDetailList: [{ glAccount: formatGl(laborGl), value: 100 }],
          },
        ];
      } else {
        const partsGl = coupon.glAcct[0] || "9999";
        departments = [
          {
            value: 100,
            department: "PARTS",
            glAccountDetailList: [{ glAccount: formatGl(partsGl), value: 100 }],
          },
        ];
      }

      const numericVal = isFixedPrice
        ? coupon.priceAmount!
        : (coupon.discountAmount !== null ? coupon.discountAmount : 1);

      return {
        couponCode: coupon.code,
        description: coupon.name,
        department: "SERVICE",
        opcodes: [],
        serviceTypeIds: [],
        sourceCodeIds: [],
        partIds: [],
        startTime: startTimeVal,
        expiryTime: null,
        discountType: discountTypeVal,
        appliedOn: appliedOnTekion,
        pricingDetail: {
          pricingMethod,
          flatAmount: isFixedPrice ? numericVal : (isPercentage ? null : String(numericVal)),
          percentage: isPercentage ? String(numericVal) : null,
          capAmount: coupon.capAmount !== null ? String(coupon.capAmount) : null,
          ...(isFixedPrice ? { flatSellingPrice: numericVal } : {}),
        },
        pricingMethod,
        splitByType,
        departments,
        considerForGrossCalculation: false,
        taxable: false,
        roLevelOnly: false,
        subPayTypes: ["ALL_CUSTOMER_PAY"],
        payTypes: [],
        allowedMultipleTimesInSameRo: true,
        languages: { documentDefault: "en_US", locale: null },
        eligibleCustomerTypes: [],
        accountingGroupId: null,
        skillIds: [],
        autoAddConfig: {
          autoAddToJobsEnabled: false,
          enabledConfigs: [],
          criteria: { filters: [] },
        },
      };
    });
  };

  const handleCopyPayload = () => {
    const payload = buildTekionPayload();
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  const handlePushToTekion = async () => {
    if (parsedData.length === 0) {
      setMessage({
        ok: false,
        text: "No parsed coupon data available to push.",
      });
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
      const payloadArray = buildTekionPayload();
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
          text: `Successfully pushed ${successCount} of ${payloadArray.length} coupons to Tekion Preprod.`,
        });
      } else {
        setMessage({
          ok: false,
          text:
            `Pushed ${successCount} of ${payloadArray.length} coupons.\n\nFailed:\n` +
            failures.join("\n"),
        });
      }
    } catch (err: any) {
      setMessage({
        ok: false,
        text: `Push Error: ${err.message}`,
      });
    } finally {
      setIsPushing(false);
    }
  };

  const handleCodeEdit = (index: number, newCode: string) => {
    const updated = [...parsedData];
    updated[index].code = newCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    setParsedData(updated);
  };

  const handleNameEdit = (index: number, newName: string) => {
    const updated = [...parsedData];
    updated[index].name = newName;
    setParsedData(updated);
  };

  const handleValueEdit = (index: number, valStr: string) => {
    const updated = [...parsedData];
    const clean = valStr.trim();

    if (clean.endsWith("%")) {
      updated[index].discountType = "Percentage";
      updated[index].discountAmount = parseFloat(clean) || 0;
      updated[index].priceAmount = null;
    } else {
      const num = parseFloat(clean.replace(/[^0-9.]/g, ""));
      if (!isNaN(num)) {
        if (updated[index].priceAmount !== null) {
          updated[index].priceAmount = num;
        } else {
          updated[index].discountType = "Flat";
          updated[index].discountAmount = num;
        }
      } else {
        if (updated[index].priceAmount !== null) {
          updated[index].priceAmount = null;
        } else {
          updated[index].discountAmount = null;
        }
      }
    }

    setParsedData(updated);
  };

  const handleCapEdit = (index: number, capStr: string) => {
    const updated = [...parsedData];
    const num = parseFloat(capStr);
    updated[index].capAmount = isNaN(num) ? null : num;
    setParsedData(updated);
  };

  const handleAppliedOnEdit = (index: number, newAppliedOn: string) => {
    const updated = [...parsedData];
    updated[index].appliedOn = newAppliedOn;

    if (newAppliedOn === "Labor & Parts") {
      if (updated[index].glAcct.length < 2) {
        updated[index].glAcct = [updated[index].glAcct[0] || "9999", "9999"];
      }
    } else {
      updated[index].glAcct = [updated[index].glAcct[0] || "9999"];
    }

    setParsedData(updated);
  };

  const handleGlAcctEdit = (index: number, glStr: string) => {
    const updated = [...parsedData];
    const cleaned = glStr.replace(/[\[\]]/g, "");
    const parts = cleaned
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    updated[index].glAcct = parts.length > 0 ? parts : ["9999"];
    setParsedData(updated);
  };

  const handleDeleteRow = (id: string) => {
    setParsedData(parsedData.filter((row) => row.id !== id));
  };

  const getEditableValueInput = (row: ParsedCoupon) => {
    if (row.discountType === "Percentage" && row.discountAmount !== null) {
      return `${row.discountAmount}%`;
    }
    const val = row.priceAmount !== null ? row.priceAmount : row.discountAmount;
    return val !== null ? `${val}` : "";
  };

  if (!token) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[320px] bg-[#18181b] rounded-2xl border border-zinc-800 p-8 text-zinc-200">
        <h2 className="text-xl font-bold mb-2">Authentication Required</h2>
        <p className="text-zinc-400 text-sm mb-6 text-center max-w-sm">
          Please provide your TGPT access token.
        </p>
        <div className="flex gap-2 w-full max-w-sm">
          <input
            type="password"
            value={draftToken}
            onChange={(e) => setDraftToken(e.target.value)}
            placeholder="Paste Token Here..."
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 outline-none focus:border-[#3b82f6]"
          />
          <button
            onClick={handleSaveToken}
            className="bg-[#3b82f6] text-white font-semibold rounded-lg px-4 py-2 hover:bg-blue-600 transition-colors"
          >
            Connect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: 220,
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.02)",
        padding: 20,
        color: "#cbd5e1",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: "1.25rem", color: "#fff" }}>
        </h2>
        <button
          onClick={() => {
            localStorage.removeItem(TGPT_TOKEN_KEY);
            setToken("");
          }}
          style={{
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.2)",
            padding: "4px 10px",
            borderRadius: "6px",
            color: "#9ca3af",
            fontSize: "12px",
            cursor: "pointer",
          }}
        >
          Logout TGPT
        </button>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            padding: "6px 10px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            fontSize: 12,
          }}
        >
          Dealer ID: <b style={{ color: dealerId ? "#86efac" : "#fca5a5" }}>{dealerId || "Not found"}</b>
        </span>
        <span
          style={{
            padding: "6px 10px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            fontSize: 12,
          }}
        >
          Global Headers: <b style={{ color: "#f8fafc" }}>{globalHeaderCount}</b>
        </span>
      </div>

      {message ? (
        <div
          style={{
            borderRadius: 10,
            padding: "10px 12px",
            whiteSpace: "pre-wrap",
            background: message.ok ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
            border: message.ok
              ? "1px solid rgba(34,197,94,0.22)"
              : "1px solid rgba(239,68,68,0.22)",
            color: message.ok ? "#bbf7d0" : "#fecaca",
            fontSize: 13,
          }}
        >
          {message.text}
        </div>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <label htmlFor="coupon-input" style={{ fontSize: "0.9rem" }}>
          Paste raw dealer blueprint notes below:
        </label>
        <textarea
          id="coupon-input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="Paste notes here..."
          disabled={isAiLoading}
          style={{
            width: "100%",
            height: "150px",
            background: "rgba(0,0,0,0.2)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: "8px",
            padding: "12px",
            color: "#a7f3d0",
            fontFamily: "monospace",
            resize: "vertical",
            opacity: isAiLoading ? 0.5 : 1,
          }}
        />
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={handleAIParse}
            disabled={isAiLoading || !inputText.trim()}
            style={{
              padding: "10px 24px",
              background: isAiLoading ? "#60a5fa" : "#3b82f6",
              border: "none",
              borderRadius: "6px",
              color: "#fff",
              fontWeight: 600,
              cursor: isAiLoading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            {isAiLoading ? `⏳ ${loadingText}` : "✨ Parse with AI (Auto)"}
          </button>

          <button
            onClick={handleManualParse}
            disabled={isAiLoading || !inputText.trim()}
            style={{
              padding: "10px 24px",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: "6px",
              color: "#cbd5e1",
              fontWeight: 600,
              cursor: isAiLoading ? "not-allowed" : "pointer",
            }}
          >
            Parse Local JSON (Manual)
          </button>
        </div>
      </div>

      {unclassifiedData.length > 0 && (
        <div
          style={{
            background: "rgba(234, 179, 8, 0.1)",
            border: "1px solid rgba(234, 179, 8, 0.3)",
            borderRadius: "8px",
            padding: "12px 16px",
            color: "#fef08a",
            fontSize: "0.9rem",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
            <span>⚠️</span>
            AI Note: The following text was ignored because it did not look like a valid coupon:
          </div>
          <ul style={{ margin: 0, paddingLeft: "24px", color: "#fde047" }}>
            {unclassifiedData.map((text, i) => (
              <li key={i} style={{ marginBottom: "4px" }}>
                {text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {parsedData.length > 0 && (
        <div style={{ marginTop: "20px" }}>
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                textAlign: "left",
                fontSize: "0.9rem",
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                  <th style={{ padding: "12px 8px", width: "140px" }}>Coupon Code</th>
                  <th style={{ padding: "12px 8px" }}>Name / Description</th>
                  <th style={{ padding: "12px 8px", width: "95px" }}>Value ($ / %)</th>
                  <th style={{ padding: "12px 8px", width: "85px" }}>Cap ($)</th>
                  <th style={{ padding: "12px 8px", width: "140px" }}>Applied On</th>
                  <th style={{ padding: "12px 8px", width: "160px" }}>G/L Acct Array</th>
                  <th style={{ padding: "12px 8px", width: "70px", textAlign: "center" }}>Conf.</th>
                  <th style={{ padding: "12px 8px", width: "50px", textAlign: "center" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {parsedData.map((row, idx) => (
                  <tr key={row.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <td style={{ padding: "8px" }}>
                      <input
                        type="text"
                        value={row.code}
                        onChange={(e) => handleCodeEdit(idx, e.target.value)}
                        style={{
                          width: "100%",
                          padding: "6px",
                          background: "rgba(0,0,0,0.2)",
                          border: "1px solid rgba(255,255,255,0.2)",
                          borderRadius: "4px",
                          color: "#93c5fd",
                          fontWeight: "bold",
                          outline: "none",
                        }}
                      />
                    </td>

                    <td style={{ padding: "8px" }}>
                      <input
                        type="text"
                        value={row.name}
                        onChange={(e) => handleNameEdit(idx, e.target.value)}
                        style={{
                          width: "100%",
                          padding: "6px",
                          background: "rgba(0,0,0,0.2)",
                          border: "1px solid rgba(255,255,255,0.2)",
                          borderRadius: "4px",
                          color: "#cbd5e1",
                          outline: "none",
                        }}
                      />
                    </td>

                    <td style={{ padding: "8px" }}>
                      <input
                        type="text"
                        value={getEditableValueInput(row)}
                        onChange={(e) => handleValueEdit(idx, e.target.value)}
                        placeholder="e.g. 10 or 15%"
                        style={{
                          width: "100%",
                          padding: "6px",
                          background: "rgba(0,0,0,0.2)",
                          border: "1px solid rgba(255,255,255,0.2)",
                          borderRadius: "4px",
                          color: "#a7f3d0",
                          fontWeight: "600",
                          outline: "none",
                        }}
                      />
                    </td>

                    <td style={{ padding: "8px" }}>
                      <input
                        type="number"
                        value={row.capAmount !== null ? row.capAmount : ""}
                        onChange={(e) => handleCapEdit(idx, e.target.value)}
                        placeholder="-"
                        style={{
                          width: "100%",
                          padding: "6px",
                          background: "rgba(0,0,0,0.2)",
                          border: "1px solid rgba(255,255,255,0.2)",
                          borderRadius: "4px",
                          color: "#fde047",
                          outline: "none",
                        }}
                      />
                    </td>

                    <td style={{ padding: "8px" }}>
                      <select
                        value={row.appliedOn || "Labor & Parts"}
                        onChange={(e) => handleAppliedOnEdit(idx, e.target.value)}
                        style={{
                          width: "100%",
                          padding: "6px",
                          background: "rgba(0,0,0,0.3)",
                          border: "1px solid rgba(255,255,255,0.2)",
                          borderRadius: "4px",
                          color: "#a7f3d0",
                          fontWeight: "500",
                          outline: "none",
                          cursor: "pointer",
                        }}
                      >
                        <option value="Labor & Parts" style={{ background: "#18181b", color: "#cbd5e1" }}>
                          Labor & Parts
                        </option>
                        <option value="Labor" style={{ background: "#18181b", color: "#cbd5e1" }}>
                          Labor
                        </option>
                        <option value="Parts" style={{ background: "#18181b", color: "#cbd5e1" }}>
                          Parts
                        </option>
                      </select>
                    </td>

                    <td style={{ padding: "8px" }}>
                      <input
                        type="text"
                        value={row.glAcct.join(", ")}
                        onChange={(e) => handleGlAcctEdit(idx, e.target.value)}
                        style={{
                          width: "100%",
                          padding: "6px",
                          background: "rgba(0,0,0,0.2)",
                          border: "1px solid rgba(255,255,255,0.2)",
                          borderRadius: "4px",
                          color: "#fca5a5",
                          fontFamily: "monospace",
                          outline: "none",
                        }}
                      />
                    </td>

                    <td style={{ padding: "12px 8px", textAlign: "center" }}>
                      <span
                        style={{
                          padding: "2px 6px",
                          borderRadius: "4px",
                          fontSize: "0.8rem",
                          background:
                            row.confidence >= 0.8
                              ? "rgba(16, 185, 129, 0.2)"
                              : "rgba(245, 158, 11, 0.2)",
                          color: row.confidence >= 0.8 ? "#34d399" : "#fbbf24",
                        }}
                      >
                        {Math.round(row.confidence * 100)}%
                      </span>
                    </td>

                    <td style={{ padding: "12px 8px", textAlign: "center" }}>
                      <button
                        onClick={() => handleDeleteRow(row.id)}
                        title="Remove row"
                        style={{
                          background: "transparent",
                          border: "none",
                          color: "#ef4444",
                          cursor: "pointer",
                          fontSize: "1.1rem",
                        }}
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end", gap: "12px" }}>
            <button
              onClick={handleCopyPayload}
              style={{
                padding: "10px 24px",
                background: copySuccess ? "#10b981" : "#059669",
                border: "none",
                borderRadius: "6px",
                color: "#fff",
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 0.2s",
              }}
            >
              {copySuccess ? "✅ Copied Payload!" : "📋 Copy Tekion Payload JSON"}
            </button>

            <button
              onClick={handlePushToTekion}
              disabled={isPushing}
              style={{
                padding: "10px 24px",
                background: isPushing ? "#60a5fa" : "#2563eb",
                border: "none",
                borderRadius: "6px",
                color: "#fff",
                fontWeight: 600,
                cursor: isPushing ? "not-allowed" : "pointer",
                transition: "background 0.2s",
              }}
            >
              {isPushing ? "🚀 Pushing to Tekion..." : "🚀 Push to Tekion Preprod"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default CouponsView;