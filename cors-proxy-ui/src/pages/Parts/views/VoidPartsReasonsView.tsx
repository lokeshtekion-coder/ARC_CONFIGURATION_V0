import React, { useEffect, useState } from "react";
import { loadTekionApiSettingsBundle } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";

const TARGET_REASON_CODE = "Customer Cancelled - with Lost Sale";
const TARGET_REASON_ID = "23";
const BASE_URL = "https://preprodapp.tekioncloud.com/api/parts/proxy/u/settings/void-reason";

const logger = {
  debug: (...args: unknown[]) => console.debug("[Parts][VoidPartsReasons]", ...args),
  info: (...args: unknown[]) => console.info("[Parts][VoidPartsReasons]", ...args),
  warn: (...args: unknown[]) => console.warn("[Parts][VoidPartsReasons]", ...args),
  error: (...args: unknown[]) => console.error("[Parts][VoidPartsReasons]", ...args),
};

interface VoidReasonLanguages {
  documentDefault?: string | null;
  locale?: Record<string, { reasonCode?: string | null }> | null;
  keyValueMapList?: unknown;
}

interface VoidReasonDetail {
  reasonCode: string;
  countInLostSale: boolean;
  languages?: VoidReasonLanguages | null;
}

interface VoidReasonRecord {
  id: string | number;
  active: boolean;
  type: string;
  detail: VoidReasonDetail;
  dealerId?: string;
  tenantId?: string;
  modifiedTime?: number;
  createdTime?: number;
}

interface VoidReasonsResponse {
  data: VoidReasonRecord[];
  status?: string;
}

interface VoidReasonUpdatePayload {
  active: boolean;
  detail: {
    countInLostSale: boolean;
    reasonCode: string;
    languages?: VoidReasonLanguages | null;
  };
  type: string;
}

type RunState = "idle" | "loading" | "success" | "error" | "warning";

function getEnabledGlobalHeaders(): Record<string, string> {
  const bundle = loadTekionApiSettingsBundle();
  const headers = (bundle.globalHeaders ?? [])
    .filter((header: KeyValuePair) => header.enabled && header.key.trim() && String(header.value).trim())
    .reduce<Record<string, string>>((acc, header) => {
      acc[header.key] = String(header.value);
      return acc;
    }, {});

  logger.info("loaded global headers from settings", {
    count: Object.keys(headers).length,
    keys: Object.keys(headers),
  });

  return headers;
}

function findTargetReason(items: VoidReasonRecord[]): VoidReasonRecord | null {
  return (
    items.find((item) => item.detail?.reasonCode === TARGET_REASON_CODE) ??
    items.find((item) => String(item.id) === TARGET_REASON_ID) ??
    null
  );
}

function needsFix(item: VoidReasonRecord | null): boolean {
  if (!item) return false;
  return item.detail?.countInLostSale !== true;
}

function buildUpdatePayload(item: VoidReasonRecord): VoidReasonUpdatePayload {
  return {
    active: item.active,
    detail: {
      countInLostSale: true,
      reasonCode: item.detail.reasonCode,
      languages: item.detail.languages ?? null,
    },
    type: item.type,
  };
}

function isValidVoidReasonRecord(value: unknown): value is VoidReasonRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<VoidReasonRecord>;
  return (
    (typeof record.id === "string" || typeof record.id === "number") &&
    typeof record.active === "boolean" &&
    typeof record.type === "string" &&
    !!record.detail &&
    typeof record.detail.reasonCode === "string" &&
    typeof record.detail.countInLostSale === "boolean"
  );
}

function isValidVoidReasonsResponse(value: unknown): value is VoidReasonsResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<VoidReasonsResponse>;
  return Array.isArray(response.data) && response.data.every(isValidVoidReasonRecord);
}

async function fetchVoidReasons(headers: Record<string, string>): Promise<VoidReasonsResponse> {
  logger.info("GET request started", {
    url: BASE_URL,
    headerKeys: Object.keys(headers),
  });

  const response = await fetch(BASE_URL, {
    method: "GET",
    headers,
  });

  logger.info("GET response received", {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("GET failed", {
      status: response.status,
      body: text,
    });
    throw new Error(`GET failed with status ${response.status}`);
  }

  const json: unknown = await response.json();
  logger.debug("GET response json", json);

  if (!isValidVoidReasonsResponse(json)) {
    logger.error("GET response validation failed", json);
    throw new Error("Invalid GET response structure for void reasons");
  }

  logger.info("GET response validated", {
    rows: json.data.length,
  });

  return json;
}

async function updateVoidReason(
  target: VoidReasonRecord,
  payload: VoidReasonUpdatePayload,
  headers: Record<string, string>
): Promise<void> {
  const url = `${BASE_URL}/${String(target.id)}`;

  logger.info("PUT request started", {
    url,
    targetId: String(target.id),
    targetReasonCode: target.detail.reasonCode,
    payload,
  });

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      ...headers,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  logger.info("PUT response received", {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("PUT failed", {
      status: response.status,
      body: text,
    });
    throw new Error(`PUT failed with status ${response.status}`);
  }

  const json = await response.json();
  logger.debug("PUT response json", json);
}

export const VoidPartsReasonsView: React.FC = () => {
  const [rows, setRows] = useState<VoidReasonRecord[]>([]);
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready to validate and fix Void Parts Reasons");
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    logger.info("component mounted");
    return () => logger.info("component unmounted");
  }, []);

  const handleRun = async (): Promise<void> => {
    logger.info("run button clicked");

    setRunState("loading");
    setStatusText("Loading void reasons...");
    setErrorText("");

    try {
      const headers = getEnabledGlobalHeaders();

      if (Object.keys(headers).length === 0) {
        logger.warn("no global headers available from settings");
        setRunState("error");
        setStatusText("Global headers are missing");
        setErrorText(
          "No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers."
        );
        return;
      }

      const firstResponse = await fetchVoidReasons(headers);
      setRows(firstResponse.data);

      const target = findTargetReason(firstResponse.data);

      if (!target) {
        logger.warn("target reason not found", {
          targetId: TARGET_REASON_ID,
          targetReasonCode: TARGET_REASON_CODE,
        });
        setRunState("warning");
        setStatusText(`Target reason "${TARGET_REASON_CODE}" not found`);
        return;
      }

      logger.info("target reason found", target);

      if (!needsFix(target)) {
        logger.info("target already configured correctly");
        setRunState("success");
        setStatusText(`Count In Lost Sale is already enabled for "${TARGET_REASON_CODE}"`);
        return;
      }

      const payload = buildUpdatePayload(target);
      logger.info("built PUT payload", payload);

      setStatusText(`Fixing "${TARGET_REASON_CODE}"...`);
      await updateVoidReason(target, payload, headers);

      setStatusText("Fix applied successfully. Refreshing latest data...");
      const refreshed = await fetchVoidReasons(headers);
      setRows(refreshed.data);

      logger.info("refresh completed after PUT");
      setRunState("success");
      setStatusText(`Count In Lost Sale has been fixed for "${TARGET_REASON_CODE}"`);
    } catch (error: unknown) {
      logger.error("run failed", error);
      setRunState("error");
      setStatusText("Validation / update failed");
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div
        style={{
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: "#f8fafc",
                marginBottom: 6,
                wordBreak: "break-word",
              }}
            >
              Void parts reasons
            </div>
          </div>

          <button
            className="btn-postman"
            type="button"
            onClick={() => {
              void handleRun();
            }}
            disabled={runState === "loading"}
          >
            {runState === "loading" ? "Running..." : "Send"}
          </button>
        </div>

        <div
          style={{
            borderRadius: 14,
            padding: "12px 14px",
            fontSize: 13,
            lineHeight: 1.6,
            border:
              runState === "error"
                ? "1px solid rgba(239,68,68,0.25)"
                : runState === "success"
                ? "1px solid rgba(34,197,94,0.25)"
                : runState === "warning"
                ? "1px solid rgba(245,158,11,0.25)"
                : "1px solid rgba(255,255,255,0.08)",
            background:
              runState === "error"
                ? "rgba(239,68,68,0.10)"
                : runState === "success"
                ? "rgba(34,197,94,0.10)"
                : runState === "warning"
                ? "rgba(245,158,11,0.10)"
                : "rgba(255,255,255,0.03)",
            color:
              runState === "error"
                ? "#fecaca"
                : runState === "success"
                ? "#bbf7d0"
                : runState === "warning"
                ? "#fde68a"
                : "#cbd5e1",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: errorText ? 6 : 0 }}>{statusText}</div>
          {errorText ? <div>{errorText}</div> : null}
        </div>
      </div>

      <div
        style={{
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: 18,
        }}
      >
        <div
          style={{
            fontSize: 18,
            fontWeight: 800,
            color: "#f8fafc",
            marginBottom: 12,
          }}
        >
          Void Reasons Table
        </div>

        {rows.length === 0 ? (
          <div
            style={{
              borderRadius: 14,
              border: "1px dashed rgba(148,163,184,0.30)",
              padding: 24,
              color: "#94a3b8",
              textAlign: "center",
            }}
          >
            No data loaded yet. Click Send.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                minWidth: 900,
              }}
            >
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>ID</th>
                  <th style={thStyle}>Reason</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Active</th>
                  <th style={thStyle}>Count In Lost Sale</th>
                  <th style={thStyle}>Target</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const isTarget =
                    String(row.id) === TARGET_REASON_ID ||
                    row.detail?.reasonCode === TARGET_REASON_CODE;

                  return (
                    <tr
                      key={`${row.id}-${index}`}
                      style={{
                        borderTop: "1px solid rgba(255,255,255,0.08)",
                        background: isTarget ? "rgba(59,130,246,0.08)" : "transparent",
                      }}
                    >
                      <td style={tdStyle}>{index + 1}</td>
                      <td style={tdMonoStyle}>{String(row.id)}</td>
                      <td style={tdStyle}>{row.detail?.reasonCode || "—"}</td>
                      <td style={tdStyle}>{row.type || "—"}</td>
                      <td style={tdStyle}>{row.active ? "Yes" : "No"}</td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            display: "inline-flex",
                            padding: "4px 10px",
                            borderRadius: 999,
                            border: row.detail?.countInLostSale
                              ? "1px solid rgba(34,197,94,0.25)"
                              : "1px solid rgba(239,68,68,0.25)",
                            background: row.detail?.countInLostSale
                              ? "rgba(34,197,94,0.10)"
                              : "rgba(239,68,68,0.10)",
                            color: row.detail?.countInLostSale ? "#86efac" : "#fca5a5",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {row.detail?.countInLostSale ? "True" : "False"}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        {isTarget ? (
                          <span
                            style={{
                              display: "inline-flex",
                              padding: "4px 10px",
                              borderRadius: 999,
                              border: "1px solid rgba(59,130,246,0.25)",
                              background: "rgba(59,130,246,0.10)",
                              color: "#93c5fd",
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            Target
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 10px",
  color: "#cbd5e1",
  fontSize: 12,
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 10px",
  color: "#e2e8f0",
  fontSize: 13,
  verticalAlign: "top",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const tdMonoStyle: React.CSSProperties = {
  ...tdStyle,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};