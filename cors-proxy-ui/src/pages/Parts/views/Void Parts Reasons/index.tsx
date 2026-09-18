import React, { useEffect, useState } from "react";
import { loadTekionApiSettingsBundle } from "../../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../../types/proxy.types";
import "./VoidPartsReasonsView.css";

const TARGET_REASON_CODE = "Customer Cancelled - with Lost Sale";
const TARGET_REASON_ID = "23";
const BASE_URL =
  "https://preprodapp.tekioncloud.com/api/parts/proxy/u/settings/void-reason";

// Required default reasons configuration
const REQUIRED_REASONS: Array<{
  reasonCode: string;
  type: "SALES_ORDER" | "RETURN";
  countInLostSale: boolean;
}> = [
  {
    reasonCode: "Customer Cancelled",
    type: "SALES_ORDER",
    countInLostSale: false,
  },
  {
    reasonCode: "Customer Cancelled - with Lost Sale",
    type: "SALES_ORDER",
    countInLostSale: true, // Configured with lost sale enabled
  },
  {
    reasonCode: "Part No Longer Available",
    type: "SALES_ORDER",
    countInLostSale: false,
  },
  {
    reasonCode: "Invoice Not Needed",
    type: "SALES_ORDER",
    countInLostSale: false,
  },
  {
    reasonCode: "Incorrect Credit",
    type: "RETURN",
    countInLostSale: false,
  },
];

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

interface VoidReasonPayload {
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

function buildUpdatePayload(item: VoidReasonRecord): VoidReasonPayload {
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

  return json;
}

async function createVoidReason(
  payload: VoidReasonPayload,
  headers: Record<string, string>
): Promise<void> {
  logger.info("POST create void reason started", payload);

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("POST failed", {
      status: response.status,
      body: text,
      payload,
    });
    throw new Error(`Failed to create reason "${payload.detail.reasonCode}" (${response.status})`);
  }

  logger.info(`Created reason: ${payload.detail.reasonCode}`);
}

async function updateVoidReason(
  target: VoidReasonRecord,
  payload: VoidReasonPayload,
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

  if (!response.ok) {
    const text = await response.text();
    logger.error("PUT failed", {
      status: response.status,
      body: text,
    });
    throw new Error(`PUT failed with status ${response.status}`);
  }
}

export const VoidPartsReasonsView: React.FC = () => {
  const [rows, setRows] = useState<VoidReasonRecord[]>([]);
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready");
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    logger.info("component mounted");
    return () => logger.info("component unmounted");
  }, []);

  const handleRun = async (): Promise<void> => {
    logger.info("run button clicked");
    setRunState("loading");
    setStatusText("Fetching current void reasons...");
    setErrorText("");

    try {
      const headers = getEnabledGlobalHeaders();

      if (Object.keys(headers).length === 0) {
        setRunState("error");
        setStatusText("Global headers are missing");
        setErrorText(
          "No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers."
        );
        return;
      }

      // 1. Fetch current reasons
      let res = await fetchVoidReasons(headers);
      let currentItems = res.data;
      setRows(currentItems);

      let createdCount = 0;
      let updatedCount = 0;

      // 2. Identify and create any missing reasons
      for (const req of REQUIRED_REASONS) {
        const exists = currentItems.some(
          (item) =>
            item.detail?.reasonCode?.trim().toLowerCase() ===
              req.reasonCode.trim().toLowerCase() &&
            item.type?.trim().toUpperCase() === req.type.trim().toUpperCase()
        );

        if (!exists) {
          setStatusText(`Creating missing reason: "${req.reasonCode}"...`);
          await createVoidReason(
            {
              active: true,
              detail: {
                countInLostSale: req.countInLostSale,
                reasonCode: req.reasonCode,
                languages: null,
              },
              type: req.type,
            },
            headers
          );
          createdCount++;
        }
      }

      // 3. If items were created, re-fetch list to inspect full state with IDs
      if (createdCount > 0) {
        setStatusText("Re-fetching void reasons after creation...");
        res = await fetchVoidReasons(headers);
        currentItems = res.data;
        setRows(currentItems);
      }

      // 4. Check if "Customer Cancelled - with Lost Sale" needs countInLostSale enabled
      const target = findTargetReason(currentItems);

      if (target && needsFix(target)) {
        setStatusText(`Enabling Count in Lost Sale for "${TARGET_REASON_CODE}"...`);
        const updatePayload = buildUpdatePayload(target);
        await updateVoidReason(target, updatePayload, headers);
        updatedCount++;

        // Re-fetch after update
        res = await fetchVoidReasons(headers);
        setRows(res.data);
      }

      // 5. Finalize status presentation
      setRunState("success");
      if (createdCount > 0 || updatedCount > 0) {
        setStatusText(
          `✅ Successfully created ${createdCount} reason(s) and updated "${TARGET_REASON_CODE}".`
        );
      } else {
        setStatusText(
          `✅ All void reasons exist and "${TARGET_REASON_CODE}" is already set to Count in Lost Sale.`
        );
      }
    } catch (error: unknown) {
      logger.error("run failed", error);
      setRunState("error");
      setStatusText("Process failed");
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