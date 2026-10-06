import React, { useEffect, useState, useMemo } from "react";
import { loadTekionApiSettingsBundle } from "../../../../services/tekionApiSettings";
import { loadTekionCapturedProfiles } from "../../../../services/tekionCapturedProfiles";
import type { KeyValuePair } from "../../../../types/proxy.types";
import "./VoidPartsReasonsView.css";

const TARGET_REASON_CODE = "Customer Cancelled - with Lost Sale";
const TARGET_REASON_ID = "23";
const DEFAULT_ENDPOINT = "/api/parts/proxy/u/settings/void-reason";
const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";
const PROXY_URL = "http://127.0.0.1:4000/api/proxy";

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
    countInLostSale: true,
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

/**
 * Resolves target base URL and headers from the active dealer profile,
 * falling back to global settings.
 */
function resolveActiveContext(): { baseUrl: string; headers: Record<string, string> } {
  const storedProfileId = localStorage.getItem(SELECTED_DEALER_PROFILE_KEY);
  const profiles = loadTekionCapturedProfiles();
  const activeProfile = profiles.find(
    (p) => p.id === storedProfileId || p.profileKey === storedProfileId || p.dealerId === storedProfileId
  );

  const bundle = loadTekionApiSettingsBundle();
  const resolvedHeaders: Record<string, string> = {};

  // 1. Load global headers as base
  (bundle.globalHeaders ?? []).forEach((h: KeyValuePair) => {
    if (h.enabled && h.key.trim() && String(h.value).trim()) {
      resolvedHeaders[h.key.trim().toLowerCase()] = String(h.value).trim();
    }
  });

  // 2. Overlay dealer-specific headers from canonical profile
  if (activeProfile?.bootstrapHeaders) {
    Object.entries(activeProfile.bootstrapHeaders).forEach(([k, v]) => {
      if (k.trim() && typeof v === "string" && v.trim()) {
        resolvedHeaders[k.trim().toLowerCase()] = v.trim();
      }
    });
  }

  // Ensure authorization token is aligned
  if (activeProfile?.token) {
    resolvedHeaders["tekion-api-token"] = activeProfile.token;
    resolvedHeaders["authorization"] = `Bearer ${activeProfile.token}`;
  }

  // 3. Resolve host
  let host = "https://preprodapp.tekioncloud.com";
  if (activeProfile?.sourceUrl) {
    try {
      const parsed = new URL(activeProfile.sourceUrl);
      host = parsed.origin;
    } catch {
      // keep fallback
    }
  }

  const baseUrl = `${host}${DEFAULT_ENDPOINT}`;

  logger.info("Resolved active context", {
    dealerId: activeProfile?.dealerId,
    baseUrl,
    headerCount: Object.keys(resolvedHeaders).length,
  });

  return { baseUrl, headers: resolvedHeaders };
}

/**
 * Sends request via proxy to bypass CORS and apply secure headers
 */
async function sendProxyRequest<T>(params: {
  url: string;
  method: "GET" | "POST" | "PUT";
  headers: Record<string, string>;
  body?: unknown;
}): Promise<T> {
  const payload = {
    url: params.url,
    method: params.method,
    headers: params.headers,
    body: params.body,
    timeout: 30000,
  };

  const response = await fetch(PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => ({}));
    throw new Error(
      errorJson?.error?.message ||
        `Proxy request failed with status ${response.status} (${response.statusText})`
    );
  }

  const result = await response.json();

  if (result.status >= 400) {
    const upstreamBody =
      typeof result.body === "string" ? result.body : JSON.stringify(result.body);
    throw new Error(`Upstream ${params.method} failed (${result.status}): ${upstreamBody}`);
  }

  return result.body as T;
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

export const VoidPartsReasonsView: React.FC = () => {
  const [rows, setRows] = useState<VoidReasonRecord[]>([]);
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready");
  const [errorText, setErrorText] = useState("");

  const activeContext = useMemo(() => resolveActiveContext(), []);

  const handleRun = async (): Promise<void> => {
    logger.info("Run button clicked");
    setRunState("loading");
    setStatusText("Fetching current void reasons via proxy...");
    setErrorText("");

    try {
      const { baseUrl, headers } = resolveActiveContext();

      if (Object.keys(headers).length === 0) {
        setRunState("error");
        setStatusText("Authentication headers are missing");
        setErrorText(
          "No active headers found. Please select a valid dealer profile in Settings or verify extension sync."
        );
        return;
      }

      // 1. Fetch current reasons
      let currentItems: VoidReasonRecord[] = [];
      const res = await sendProxyRequest<VoidReasonsResponse>({
        url: baseUrl,
        method: "GET",
        headers,
      });

      currentItems = Array.isArray(res?.data) ? res.data : [];
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
          await sendProxyRequest({
            url: baseUrl,
            method: "POST",
            headers: {
              ...headers,
              "content-type": "application/json",
            },
            body: {
              active: true,
              detail: {
                countInLostSale: req.countInLostSale,
                reasonCode: req.reasonCode,
                languages: null,
              },
              type: req.type,
            },
          });
          createdCount++;
        }
      }

      // 3. Re-fetch list if items were added
      if (createdCount > 0) {
        setStatusText("Re-fetching void reasons after creation...");
        const refreshedRes = await sendProxyRequest<VoidReasonsResponse>({
          url: baseUrl,
          method: "GET",
          headers,
        });
        currentItems = Array.isArray(refreshedRes?.data) ? refreshedRes.data : [];
        setRows(currentItems);
      }

      // 4. Update TARGET_REASON_CODE if countInLostSale is disabled
      const target = findTargetReason(currentItems);
      if (target && needsFix(target)) {
        setStatusText(`Enabling Count in Lost Sale for "${TARGET_REASON_CODE}"...`);
        const updateUrl = `${baseUrl}/${String(target.id)}`;
        const updatePayload = buildUpdatePayload(target);

        await sendProxyRequest({
          url: updateUrl,
          method: "PUT",
          headers: {
            ...headers,
            "content-type": "application/json",
          },
          body: updatePayload,
        });
        updatedCount++;

        // Final list refresh
        const finalRes = await sendProxyRequest<VoidReasonsResponse>({
          url: baseUrl,
          method: "GET",
          headers,
        });
        setRows(Array.isArray(finalRes?.data) ? finalRes.data : []);
      }

      // 5. Final status message
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
      logger.error("Run failed", error);
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