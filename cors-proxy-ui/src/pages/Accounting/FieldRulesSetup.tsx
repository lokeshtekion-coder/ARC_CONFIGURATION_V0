import React, { useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../services/tekionApiSettings";
import type { KeyValuePair } from "../../types/proxy.types";

const SAVE_URL =
  "https://preprodapp.tekioncloud.com/api/retail/sales/u/sales/settings/v1.0.0/sales/mandatoryFieldRules/save?locale=en_US";

type UiMessage = {
  ok: boolean;
  text: string;
};

const logger = {
  info: (...args: unknown[]) => console.info("[Accounting][FieldRulesSetup]", ...args),
  warn: (...args: unknown[]) => console.warn("[Accounting][FieldRulesSetup]", ...args),
  error: (...args: unknown[]) => console.error("[Accounting][FieldRulesSetup]", ...args),
};

const cardStyle: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  padding: 18,
};

const pillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  color: "#cbd5e1",
  fontSize: 12,
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

function extractDealerIdFromHeaders(headers: Record<string, string>): string {
  const candidates = ["dealerid", "dealerId", "dealer-id", "x-dealer-id"];
  const entries = Object.entries(headers);
  for (const candidate of candidates) {
    const hit = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
    if (hit?.[1]) return normalize(hit[1]);
  }
  return "";
}

const FieldRulesSetup: React.FC = () => {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);
  const [lastPayload, setLastPayload] = useState<Record<string, unknown> | null>(null);
  const [lastResponse, setLastResponse] = useState<unknown>(null);
  const [showPayload, setShowPayload] = useState(false);
  const [showResponse, setShowResponse] = useState(false);

  const enabledHeaders = useMemo(
    () => toEnabledHeaderMap(loadGlobalHeaders()),
    []
  );

  const dealerId = useMemo(
    () => extractDealerIdFromHeaders(enabledHeaders),
    [enabledHeaders]
  );

  const headerCount = Object.keys(enabledHeaders).length;

  const buildPayload = (): Record<string, unknown> => {
    return {
      mandatoryFieldActions: [
        {
          id: "MRT64WJ75RNJJ",
          fields: [
            { displayName: "Salesperson", key: "SALES_PERSON" },
            { displayName: "Sales Manager", key: "SALES_MANAGER" },
            { displayName: "F&I Manager", key: "F_N_I_MANAGER" },
          ],
          action: "MARK_AS_MANDATORY",
        },
      ],
      mandatoryFieldConditions: [
        {
          id: "MRT64WJ7IF6Q8",
          key: "DEAL_TYPE",
          operator: "PRESENT",
          value: ["PERSONAL", "BUSINESS"],
        },
      ],
      mandatoryFieldSituations: [
        {
          id: "MRT64WJ7FVNNJ",
          situation: "STATUS_CHANGE",
          value: "FINANCE_AND_INSURANCE",
        },
      ],
      status: "ACTIVE",
      displayName: "Assignee",
    };
  };

  const runAutomation = async () => {
    setRunning(true);
    setMessage(null);
    setLastResponse(null);

    try {
      if (!dealerId) {
        throw new Error(
          "Dealer ID not found in Global Headers. Please select/apply dealer headers in Settings first."
        );
      }

      if (headerCount === 0) {
        throw new Error("No active Global Headers found.");
      }

      const payload = buildPayload();
      setLastPayload(payload);

      logger.info("field rules save started", {
        dealerId,
        url: SAVE_URL,
        headerKeys: Object.keys(enabledHeaders),
        payload,
      });

      const requestHeaders: Record<string, string> = {
        ...enabledHeaders,
        "content-type": "application/json",
      };

      const response = await fetch("http://localhost:4000/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: SAVE_URL,
          method: "POST",
          headers: requestHeaders,
          body: payload,
          timeout: 60000,
        }),
      });

      if (!response.ok) {
        throw new Error(`Proxy request failed with HTTP ${response.status}`);
      }

      const json = await response.json();
      logger.info("field rules save raw response", json);

      if ((json?.status ?? 200) >= 400) {
        throw new Error(
          `${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim()
        );
      }

      const body = json?.body ?? json?.data ?? json;
      setLastResponse(body);
      setMessage({
        ok: true,
        text: "Field Rules Setup saved successfully.",
      });
    } catch (error: unknown) {
      logger.error("field rules save failed", error);
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Field Rules Setup failed",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={cardStyle}>
        <div style={{ color: "#f8fafc", fontSize: 22, fontWeight: 800, marginBottom: 6 }}>
          Field Rules Setup
        </div>
        <div style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.7 }}>
          Configure mandatory sales field rules using Global Headers from Settings.
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <span style={pillStyle}>
            Dealer ID
            <b style={{ color: dealerId ? "#f8fafc" : "#fca5a5" }}>
              {dealerId || "Not found"}
            </b>
          </span>
          <span style={pillStyle}>
            Global Headers
            <b style={{ color: "#f8fafc" }}>{headerCount}</b>
          </span>
          <span style={pillStyle}>
            Display Name
            <b style={{ color: "#f8fafc" }}>Assignee</b>
          </span>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
          Automation Summary
        </div>
        <div style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.8 }}>
          <div>• Marks fields as mandatory: Salesperson, Sales Manager, F&amp;I Manager</div>
          <div>• Applies when Deal Type is: PERSONAL or BUSINESS</div>
          <div>• Applies on situation: STATUS_CHANGE → FINANCE_AND_INSURANCE</div>
          <div>• Saves with status: ACTIVE</div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          <button
            className="btn-postman"
            type="button"
            onClick={() => void runAutomation()}
            disabled={running}
          >
            {running ? "Running..." : "⚙ Run Field Rules Automation"}
          </button>

          <button
            className="btn-secondary btn-sm"
            type="button"
            onClick={() => setShowPayload((prev) => !prev)}
          >
            {showPayload ? "Hide Payload" : "Show Payload"}
          </button>

          <button
            className="btn-secondary btn-sm"
            type="button"
            onClick={() => setShowResponse((prev) => !prev)}
            disabled={!lastResponse}
          >
            {showResponse ? "Hide Response" : "Show Response"}
          </button>
        </div>

        {message ? (
          <div
            style={{
              marginTop: 16,
              borderRadius: 14,
              padding: "10px 12px",
              fontSize: 13,
              border: message.ok
                ? "1px solid rgba(34,197,94,0.22)"
                : "1px solid rgba(239,68,68,0.22)",
              background: message.ok
                ? "rgba(34,197,94,0.10)"
                : "rgba(239,68,68,0.10)",
              color: message.ok ? "#bbf7d0" : "#fecaca",
            }}
          >
            {message.text}
          </div>
        ) : null}
      </div>

      {showPayload ? (
        <div style={cardStyle}>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }}>
            Request Payload
          </div>
          <pre
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 12,
              background: "#0f172a",
              color: "#e2e8f0",
              overflow: "auto",
              fontSize: 12,
            }}
          >
            {JSON.stringify(lastPayload ?? buildPayload(), null, 2)}
          </pre>
        </div>
      ) : null}

      {showResponse && lastResponse ? (
        <div style={cardStyle}>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }}>
            Response
          </div>
          <pre
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 12,
              background: "#0f172a",
              color: "#e2e8f0",
              overflow: "auto",
              fontSize: 12,
            }}
          >
            {JSON.stringify(lastResponse, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
};

export default FieldRulesSetup;
