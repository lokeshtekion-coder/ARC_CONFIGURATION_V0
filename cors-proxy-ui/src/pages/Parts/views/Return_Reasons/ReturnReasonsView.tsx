import React, { useEffect, useMemo, useState } from "react";
import { loadTekionApiSettingsBundle } from "../../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../../types/proxy.types";

const MODULE_NAME = "Return Reasons";
const BASE_URL =
  "https://preprodapp.tekioncloud.com/api/parts/proxy/u/settings/return-reason";

const TARGET_RETURN_REASONS = [
  {
    reasonCode: "Customer Return w/ Restocking",
    description: "Customer Return w/ Restocking",
    active: true,
    restocking: true,
    restockingFee: "SALE_PERCENTAGE_FEE",
    reviewRequired: false,
    refundFreight: false,
  },
] as const;

const logger = {
  debug: (...args: unknown[]) => console.debug("[Parts][ReturnReasons]", ...args),
  info: (...args: unknown[]) => console.info("[Parts][ReturnReasons]", ...args),
  warn: (...args: unknown[]) => console.warn("[Parts][ReturnReasons]", ...args),
  error: (...args: unknown[]) => console.error("[Parts][ReturnReasons]", ...args),
};

type RunState = "idle" | "loading" | "success" | "error" | "warning";

interface ReturnReasonDetail {
  description?: string | null;
  restocking?: boolean | null;
  restockingFee?: string | null;
  amount?: number | string | null;
  refundFreight?: boolean | null;
  reviewRequired?: boolean | null;
  languages?: unknown;
}

interface ReturnReasonRecord {
  id: string | number;
  active?: boolean | null;
  reasonCode?: string | null;
  detail?: ReturnReasonDetail | null;
  dealerId?: string | null;
  tenantId?: string | null;
  modifiedTime?: number | null;
  createdTime?: number | null;
  siteId?: string | null;
  deleted?: boolean | null;
  oldId?: string | null;
}

interface ReturnReasonListResponse {
  data: ReturnReasonRecord[];
  status?: string;
}

interface ReturnReasonSingleResponse {
  data?: ReturnReasonRecord | null;
  status?: string;
}

interface ReturnReasonPayload {
  active: boolean;
  reasonCode: string;
  detail: {
    description: string;
    restocking: boolean;
    restockingFee: string;
    reviewRequired: boolean;
    amount: number | string;
    refundFreight: boolean;
    languages: null;
  };
}

interface TargetValidationItem {
  config: (typeof TARGET_RETURN_REASONS)[number];
  existing: ReturnReasonRecord | null;
  exists: boolean;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeLower(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function parsePositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return null;

  const num = Number(trimmed);
  if (!Number.isFinite(num)) return null;
  return num;
}

function isReturnReasonRecord(value: unknown): value is ReturnReasonRecord {
  return Boolean(value && typeof value === "object" && "id" in (value as Record<string, unknown>));
}

function isReturnReasonListResponse(value: unknown): value is ReturnReasonListResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as ReturnReasonListResponse).data) &&
      (value as ReturnReasonListResponse).data.every(isReturnReasonRecord)
  );
}

function getEnabledGlobalHeaders(): Record<string, string> {
  const bundle = loadTekionApiSettingsBundle();

  const headers = (bundle.globalHeaders ?? [])
    .filter(
      (header: KeyValuePair) =>
        Boolean(header.enabled) &&
        normalizeText(header.key) &&
        normalizeText(header.value)
    )
    .reduce<Record<string, string>>((acc: Record<string, string>, header: KeyValuePair) => {
      acc[normalizeText(header.key)] = normalizeText(header.value);
      return acc;
    }, {});

  logger.info("loaded global headers from settings", {
    count: Object.keys(headers).length,
    keys: Object.keys(headers),
  });

  return headers;
}

async function fetchReturnReasons(
  headers: Record<string, string>
): Promise<ReturnReasonListResponse> {
  logger.info("GET return reasons started", {
    url: BASE_URL,
    headerKeys: Object.keys(headers),
  });

  const response = await fetch(BASE_URL, {
    method: "GET",
    headers,
  });

  logger.info("GET return reasons response", {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("GET return reasons failed", {
      status: response.status,
      body: text,
    });
    throw new Error(`GET return-reason failed with status ${response.status}`);
  }

  const json: unknown = await response.json();
  logger.debug("GET return reasons raw json", json);

  if (!isReturnReasonListResponse(json)) {
    logger.error("Invalid GET return reasons response shape", json);
    throw new Error("Invalid return-reason GET response structure");
  }

  logger.info("GET return reasons validated", {
    rowCount: json.data.length,
  });

  return json;
}

function findReasonByCode(
  rows: ReturnReasonRecord[],
  reasonCode: string
): ReturnReasonRecord | null {
  return rows.find((row) => normalizeLower(row.reasonCode) === normalizeLower(reasonCode)) ?? null;
}

function buildCreatePayload(
  target: (typeof TARGET_RETURN_REASONS)[number],
  amount: number
): ReturnReasonPayload {
  const payload: ReturnReasonPayload = {
    active: target.active,
    reasonCode: target.reasonCode,
    detail: {
      description: target.description,
      restocking: target.restocking,
      restockingFee: target.restockingFee,
      reviewRequired: target.reviewRequired,
      amount: String(amount),
      refundFreight: target.refundFreight,
      languages: null,
    },
  };

  logger.debug("built create payload", payload);
  return payload;
}

function buildUpdatePayload(
  target: (typeof TARGET_RETURN_REASONS)[number],
  amount: number
): ReturnReasonPayload {
  const payload: ReturnReasonPayload = {
    active: target.active,
    reasonCode: target.reasonCode,
    detail: {
      description: target.description,
      restocking: target.restocking,
      restockingFee: target.restockingFee,
      reviewRequired: target.reviewRequired,
      amount,
      refundFreight: target.refundFreight,
      languages: null,
    },
  };

  logger.debug("built update payload", payload);
  return payload;
}

async function createReturnReason(
  payload: ReturnReasonPayload,
  headers: Record<string, string>
): Promise<ReturnReasonSingleResponse> {
  logger.info("POST create return reason started", {
    url: BASE_URL,
    payload,
  });

  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  logger.info("POST create return reason response", {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("POST create return reason failed", {
      status: response.status,
      body: text,
      payload,
    });
    throw new Error(`POST return-reason failed with status ${response.status}`);
  }

  const json = (await response.json()) as ReturnReasonSingleResponse;
  logger.debug("POST create return reason json", json);
  return json;
}

async function updateReturnReason(
  id: string,
  payload: ReturnReasonPayload,
  headers: Record<string, string>
): Promise<ReturnReasonSingleResponse> {
  const url = `${BASE_URL}/${id}`;

  logger.info("PUT update return reason started", {
    url,
    id,
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

  logger.info("PUT update return reason response", {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    id,
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("PUT update return reason failed", {
      status: response.status,
      body: text,
      id,
      payload,
    });
    throw new Error(`PUT return-reason failed with status ${response.status}`);
  }

  const json = (await response.json()) as ReturnReasonSingleResponse;
  logger.debug("PUT update return reason json", json);
  return json;
}

export const ReturnReasonsView: React.FC = () => {
  const [rows, setRows] = useState<ReturnReasonRecord[]>([]);
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready to validate return reasons");
  const [errorText, setErrorText] = useState("");
  const [lastRunAt, setLastRunAt] = useState("");
  const [amountInput, setAmountInput] = useState("0");
  const [selectedReasonCode, setSelectedReasonCode] = useState<string>(
    TARGET_RETURN_REASONS[0]?.reasonCode ?? ""
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    logger.info("component mounted");
    return () => logger.info("component unmounted");
  }, []);

  const selectedTarget = useMemo(() => {
    const found =
      TARGET_RETURN_REASONS.find(
        (item) => normalizeLower(item.reasonCode) === normalizeLower(selectedReasonCode)
      ) ?? TARGET_RETURN_REASONS[0];

    logger.debug("selected target recalculated", found);
    return found;
  }, [selectedReasonCode]);

  const validationItems = useMemo<TargetValidationItem[]>(() => {
    const results = TARGET_RETURN_REASONS.map((config) => {
      const existing = findReasonByCode(rows, config.reasonCode);
      return {
        config,
        existing,
        exists: Boolean(existing),
      };
    });

    logger.debug("validation items recalculated", results);
    return results;
  }, [rows]);

  const selectedExistingRecord = useMemo(() => {
    const found = findReasonByCode(rows, selectedTarget.reasonCode);
    logger.debug("selected existing record recalculated", found);
    return found;
  }, [rows, selectedTarget]);

  const parsedAmount = useMemo(() => parsePositiveInteger(amountInput), [amountInput]);

  const refreshData = async (headers: Record<string, string>): Promise<ReturnReasonRecord[]> => {
    logger.info("refreshing return reasons");
    const response = await fetchReturnReasons(headers);
    setRows(response.data);
    setLastRunAt(new Date().toLocaleString());
    return response.data;
  };

  const handleValidate = async (): Promise<void> => {
    logger.info("validate button clicked");
    setRunState("loading");
    setStatusText("Loading and validating return reasons...");
    setErrorText("");

    try {
      const headers = getEnabledGlobalHeaders();

      if (Object.keys(headers).length === 0) {
        logger.warn("global headers missing before validation");
        setRunState("error");
        setStatusText("Global headers are missing");
        setErrorText(
          "No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers."
        );
        return;
      }

      const latestRows = await refreshData(headers);
      const found = findReasonByCode(latestRows, selectedTarget.reasonCode);

      if (found) {
        setRunState("success");
        setStatusText(`"${selectedTarget.reasonCode}" already exists`);
        logger.info("selected target exists", found);
        return;
      }

      setRunState("warning");
      setStatusText(`"${selectedTarget.reasonCode}" is missing`);
      logger.warn("selected target missing");
    } catch (error: unknown) {
      logger.error("validation failed", error);
      setRunState("error");
      setStatusText("Validation failed");
      setErrorText(error instanceof Error ? error.message : String(error));
      setLastRunAt(new Date().toLocaleString());
    }
  };

  const handleCreate = async (): Promise<void> => {
    logger.info("create button clicked", {
      selectedReasonCode,
      amountInput,
    });

    if (parsedAmount === null) {
      logger.warn("invalid amount for create", { amountInput });
      setRunState("error");
      setStatusText("Invalid amount");
      setErrorText("Please enter a valid positive integer amount.");
      return;
    }

    setIsSubmitting(true);
    setRunState("loading");
    setStatusText(`Creating "${selectedTarget.reasonCode}"...`);
    setErrorText("");

    try {
      const headers = getEnabledGlobalHeaders();

      if (Object.keys(headers).length === 0) {
        logger.warn("global headers missing before create");
        setRunState("error");
        setStatusText("Global headers are missing");
        setErrorText(
          "No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers."
        );
        return;
      }

      const existingRows = rows.length > 0 ? rows : await refreshData(headers);
      const found = findReasonByCode(existingRows, selectedTarget.reasonCode);

      if (found) {
        logger.warn("create skipped because target already exists", found);
        setRunState("warning");
        setStatusText(`"${selectedTarget.reasonCode}" already exists. Use Update instead.`);
        return;
      }

      const payload = buildCreatePayload(selectedTarget, parsedAmount);
      await createReturnReason(payload, headers);
      await refreshData(headers);

      setRunState("success");
      setStatusText(`Created "${selectedTarget.reasonCode}" successfully`);
      logger.info("create completed successfully");
    } catch (error: unknown) {
      logger.error("create failed", error);
      setRunState("error");
      setStatusText("Create failed");
      setErrorText(error instanceof Error ? error.message : String(error));
      setLastRunAt(new Date().toLocaleString());
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (): Promise<void> => {
    logger.info("update button clicked", {
      selectedReasonCode,
      amountInput,
    });

    if (parsedAmount === null) {
      logger.warn("invalid amount for update", { amountInput });
      setRunState("error");
      setStatusText("Invalid amount");
      setErrorText("Please enter a valid positive integer amount.");
      return;
    }

    setIsSubmitting(true);
    setRunState("loading");
    setStatusText(`Updating "${selectedTarget.reasonCode}"...`);
    setErrorText("");

    try {
      const headers = getEnabledGlobalHeaders();

      if (Object.keys(headers).length === 0) {
        logger.warn("global headers missing before update");
        setRunState("error");
        setStatusText("Global headers are missing");
        setErrorText(
          "No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers."
        );
        return;
      }

      const existingRows = rows.length > 0 ? rows : await refreshData(headers);
      const found = findReasonByCode(existingRows, selectedTarget.reasonCode);

      if (!found) {
        logger.warn("update skipped because target does not exist");
        setRunState("warning");
        setStatusText(`"${selectedTarget.reasonCode}" does not exist yet. Use Create first.`);
        return;
      }

      const id = normalizeText(found.id);
      const payload = buildUpdatePayload(selectedTarget, parsedAmount);

      await updateReturnReason(id, payload, headers);
      await refreshData(headers);

      setRunState("success");
      setStatusText(`Updated "${selectedTarget.reasonCode}" successfully`);
      logger.info("update completed successfully", { id });
    } catch (error: unknown) {
      logger.error("update failed", error);
      setRunState("error");
      setStatusText("Update failed");
      setErrorText(error instanceof Error ? error.message : String(error));
      setLastRunAt(new Date().toLocaleString());
    } finally {
      setIsSubmitting(false);
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
              Return reasons
            </div>

            <div
              style={{
                color: "#94a3b8",
                fontSize: 14,
                lineHeight: 1.7,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              Validates whether configured return reasons exist, and lets you create or update them using active Global Headers from Settings.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn-postman"
              type="button"
              onClick={() => {
                void handleValidate();
              }}
              disabled={runState === "loading" || isSubmitting}
            >
              {runState === "loading" && !isSubmitting ? "Running..." : "Send"}
            </button>

            <button
              className="btn-secondary btn-sm"
              type="button"
              onClick={() => {
                void handleCreate();
              }}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Processing..." : "Create"}
            </button>

            <button
              className="btn-secondary btn-sm"
              type="button"
              onClick={() => {
                void handleUpdate();
              }}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Processing..." : "Update"}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div>
            <div style={labelStyle}>Target Return Reason</div>
            <select
              className="st-input"
              value={selectedReasonCode}
              onChange={(e) => {
                logger.info("target reason selection changed", { value: e.target.value });
                setSelectedReasonCode(e.target.value);
              }}
              style={inputStyle}
            >
              {TARGET_RETURN_REASONS.map((item) => (
                <option key={item.reasonCode} value={item.reasonCode}>
                  {item.reasonCode}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={labelStyle}>Amount</div>
            <input
              className="st-input"
              type="text"
              value={amountInput}
              onChange={(e) => {
                logger.debug("amount input changed", { value: e.target.value });
                setAmountInput(e.target.value);
              }}
              placeholder="Enter integer amount"
              style={inputStyle}
            />
          </div>

          <div>
            <div style={labelStyle}>Reason Code</div>
            <input
              className="st-input"
              value={selectedTarget.reasonCode}
              readOnly
              style={{ ...inputStyle, opacity: 0.85 }}
            />
          </div>

          <div>
            <div style={labelStyle}>Description</div>
            <input
              className="st-input"
              value={selectedTarget.description}
              readOnly
              style={{ ...inputStyle, opacity: 0.85 }}
            />
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <Pill label="Module" value={MODULE_NAME} />
          <Pill label="Rows Loaded" value={String(rows.length)} />
          <Pill label="Configured Targets" value={String(TARGET_RETURN_REASONS.length)} />
          {lastRunAt ? <Pill label="Last Run" value={lastRunAt} /> : null}
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
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
        }}
      >
        <SectionCard title="Configured Validation Targets">
          {validationItems.map((item) => (
            <RowLine
              key={item.config.reasonCode}
              left={`${item.config.reasonCode} — ${item.config.description}`}
              right={item.exists ? "Exists" : "Missing"}
              rightColor={item.exists ? "#86efac" : "#fca5a5"}
            />
          ))}
        </SectionCard>

        <SectionCard title="Selected Target Snapshot">
          <RowLine left="Reason Code" right={selectedTarget.reasonCode} />
          <RowLine left="Description" right={selectedTarget.description} />
          <RowLine left="Restocking" right={String(selectedTarget.restocking)} />
          <RowLine left="Restocking Fee" right={selectedTarget.restockingFee} />
          <RowLine left="Refund Freight" right={String(selectedTarget.refundFreight)} />
          <RowLine left="Review Required" right={String(selectedTarget.reviewRequired)} />
          <RowLine
            left="Entered Amount"
            right={parsedAmount !== null ? String(parsedAmount) : "Invalid"}
            rightColor={parsedAmount !== null ? "#86efac" : "#fca5a5"}
          />
        </SectionCard>

        <SectionCard title="Selected Target Existing Record">
          {selectedExistingRecord ? (
            <>
              <RowLine left="ID" right={normalizeText(selectedExistingRecord.id)} />
              <RowLine left="Reason Code" right={normalizeText(selectedExistingRecord.reasonCode)} />
              <RowLine
                left="Description"
                right={normalizeText(selectedExistingRecord.detail?.description)}
              />
              <RowLine
                left="Restocking"
                right={String(Boolean(selectedExistingRecord.detail?.restocking))}
              />
              <RowLine
                left="Restocking Fee"
                right={normalizeText(selectedExistingRecord.detail?.restockingFee) || "—"}
              />
              <RowLine
                left="Amount"
                right={normalizeText(selectedExistingRecord.detail?.amount) || "—"}
              />
            </>
          ) : (
            <EmptyText text="No existing record found for selected target" />
          )}
        </SectionCard>
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
          Existing Return Reasons
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
                minWidth: 1150,
              }}
            >
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>ID</th>
                  <th style={thStyle}>Reason Code</th>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Restocking</th>
                  <th style={thStyle}>Restocking Fee</th>
                  <th style={thStyle}>Amount</th>
                  <th style={thStyle}>Refund Freight</th>
                  <th style={thStyle}>Active</th>
                  <th style={thStyle}>Target</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((row, index) => {
                  const isTarget = TARGET_RETURN_REASONS.some(
                    (target) => normalizeLower(target.reasonCode) === normalizeLower(row.reasonCode)
                  );

                  return (
                    <tr
                      key={`${row.id}-${index}`}
                      style={{
                        borderTop: "1px solid rgba(255,255,255,0.08)",
                        background: isTarget ? "rgba(59,130,246,0.08)" : "transparent",
                      }}
                    >
                      <td style={tdStyle}>{index + 1}</td>
                      <td style={tdMonoStyle}>{normalizeText(row.id) || "—"}</td>
                      <td style={tdStyle}>{normalizeText(row.reasonCode) || "—"}</td>
                      <td style={tdStyle}>{normalizeText(row.detail?.description) || "—"}</td>
                      <td style={tdStyle}>{String(Boolean(row.detail?.restocking))}</td>
                      <td style={tdStyle}>{normalizeText(row.detail?.restockingFee) || "—"}</td>
                      <td style={tdStyle}>{normalizeText(row.detail?.amount) || "—"}</td>
                      <td style={tdStyle}>{String(Boolean(row.detail?.refundFreight))}</td>
                      <td style={tdStyle}>{String(Boolean(row.active))}</td>
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

const labelStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 6,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 40,
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 13,
  boxSizing: "border-box",
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

const Pill: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        color: "#cbd5e1",
        fontSize: 12,
      }}
    >
      {label} <b style={{ color: "#f8fafc" }}>{value}</b>
    </span>
  );
};

const SectionCard: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => {
  return (
    <div
      style={{
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        padding: 16,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 16,
          fontWeight: 800,
          color: "#f8fafc",
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      <div style={{ display: "grid", gap: 8 }}>{children}</div>
    </div>
  );
};

const RowLine: React.FC<{
  left: string;
  right: string;
  rightColor?: string;
}> = ({ left, right, rightColor = "#cbd5e1" }) => {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        alignItems: "flex-start",
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.02)",
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          color: "#e2e8f0",
          fontSize: 13,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          maxWidth: "100%",
        }}
      >
        {left}
      </div>
      <div
        style={{
          color: rightColor,
          fontSize: 12,
          fontWeight: 700,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          textAlign: "right",
          maxWidth: "100%",
        }}
      >
        {right}
      </div>
    </div>
  );
};

const EmptyText: React.FC<{ text: string }> = ({ text }) => {
  return (
    <div
      style={{
        color: "#94a3b8",
        fontSize: 13,
        lineHeight: 1.6,
      }}
    >
      {text}
    </div>
  );
};

export default ReturnReasonsView;
