import React, { useEffect, useState } from "react";
import { loadTekionApiSettingsBundle } from "../../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../../types/proxy.types";
import "./VoidPartsReasonsView.css";

const TARGET_REASON_CODE = "Customer Cancelled - with Lost Sale";
const TARGET_REASON_ID = "23";
const BASE_URL =
  "https://preprodapp.tekioncloud.com/api/parts/proxy/u/settings/void-reason";

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
    .filter(
      (header: KeyValuePair) =>
        header.enabled && header.key.trim() && String(header.value).trim()
    )
    .reduce<Record<string, string>>((acc: Record<string, string>, header: KeyValuePair) => {
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

async function fetchVoidReasons(
  headers: Record<string, string>
): Promise<VoidReasonsResponse> {
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
  const [statusText, setStatusText] = useState(
    "Ready"
  );
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
        setStatusText(
          `Count In Lost Sale is already enabled for "${TARGET_REASON_CODE}"`
        );
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
      setStatusText(
        `Count In Lost Sale has been fixed for "${TARGET_REASON_CODE}"`
      );
    } catch (error: unknown) {
      logger.error("run failed", error);
      setRunState("error");
      setStatusText("Validation / update failed");
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  };

  const getStatusClass = () => {
    if (runState === "error") return "status-error";
    if (runState === "success") return "status-success";
    if (runState === "warning") return "status-warning";
    return "";
  };

  return (
    <div className="void-parts-container">
      <div className="card card-top">
        <div className="header-row">
          <div className="title-container">
            <div className="page-title">Void parts reasons</div>
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

        <div className={`status-box ${getStatusClass()}`}>
          <div className={`status-text-main ${errorText ? "status-text-margin" : ""}`}>
            {statusText}
          </div>
          {errorText ? <div>{errorText}</div> : null}
        </div>
      </div>

      <div className="card card-bottom">
        <div className="section-title">Void Reasons Table</div>

        {rows.length === 0 ? (
          <div className="empty-state">No data loaded yet. Click Send.</div>
        ) : (
          <div className="table-container">
            <table className="void-reasons-table">
              <thead>
                <tr className="table-header-row">
                  <th>#</th>
                  <th>ID</th>
                  <th>Reason</th>
                  <th>Type</th>
                  <th>Active</th>
                  <th>Count In Lost Sale</th>
                  <th>Target</th>
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
                      className={`table-row ${isTarget ? "table-row-target" : ""}`}
                    >
                      <td>{index + 1}</td>
                      <td className="td-mono">{String(row.id)}</td>
                      <td>{row.detail?.reasonCode || "—"}</td>
                      <td>{row.type || "—"}</td>
                      <td>{row.active ? "Yes" : "No"}</td>
                      <td>
                        <span
                          className={`badge ${
                            row.detail?.countInLostSale ? "badge-true" : "badge-false"
                          }`}
                        >
                          {row.detail?.countInLostSale ? "True" : "False"}
                        </span>
                      </td>
                      <td>
                        {isTarget ? (
                          <span className="badge badge-target">Target</span>
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

export default VoidPartsReasonsView;
