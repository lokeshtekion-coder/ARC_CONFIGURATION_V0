import React, { useEffect, useMemo, useState } from "react";
import { loadTekionApiSettingsBundle } from "../../../../services/tekionApiSettings";
import { usePartsBlueprint } from "../../../../Context/Blueprint_Parts_Context";
import type { KeyValuePair } from "../../../../types/proxy.types";

const BASE_URL =
  "https://preprodapp.tekioncloud.com/api/parts/proxy/u/settings/return-reason";

const TARGET_RETURN_REASON = {
  reasonCode: "Customer Return w/ Restocking",
  description: "Customer Return w/ Restocking",
  active: true,
  restocking: true,
  restockingFee: "SALE_PERCENTAGE_FEE",
  reviewRequired: false,
  refundFreight: false,
} as const;

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
}

interface ReturnReasonRecord {
  id: string | number;
  active?: boolean | null;
  reasonCode?: string | null;
  detail?: ReturnReasonDetail | null;
  dealerId?: string | null;
  tenantId?: string | null;
}

interface ReturnReasonListResponse {
  data: ReturnReasonRecord[];
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

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeLower(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function parsePositiveInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

/**
 * Handles boolean or string representations of Yes/No
 */
function parseYesNo(val: unknown): boolean | null {
  if (val === null || val === undefined) return null;
  // MULTIPLE_CHOICE blueprint fields decode to an array of selected option(s)
  // (e.g. decodedValue: ["Yes"]), not a plain string. Without this, the
  // array fell through every check below and returned null - which the UI
  // then rendered as "No" while the reset action treated it as "not false"
  // (i.e. proceeded as Yes), showing contradictory answers for the same
  // question. Unwrap it and parse the first selected option instead.
  if (Array.isArray(val)) {
    return val.length > 0 ? parseYesNo(val[0]) : null;
  }
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val > 0;
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    if (!s) return null;
    if (s === "yes" || s === "y" || s === "true" || s === "1") return true;
    if (s === "no" || s === "n" || s === "false" || s === "0") return false;
  }
  return null;
}

/**
 * Extracts percentage digits from text formats:
 * "20%", "20 %", "Cost + 15%", "15 percent", or empty text -> defaults to "0"
 */
function extractRestockPercentage(raw: unknown): string {
  if (raw === null || raw === undefined) return "0";
  if (typeof raw === "number") return String(Math.max(0, Math.round(raw)));

  const str = String(raw).trim();
  if (!str) return "0";

  const match = str.match(/(\d+(?:\.\d+)?)/);
  if (match) {
    const num = Math.round(parseFloat(match[1]));
    return String(Math.max(0, num));
  }

  return "0";
}

function getEnabledGlobalHeaders(): Record<string, string> {
  const bundle = loadTekionApiSettingsBundle();
  return (bundle.globalHeaders ?? [])
    .filter(
      (header: KeyValuePair) =>
        Boolean(header.enabled) &&
        normalizeText(header.key) &&
        normalizeText(header.value)
    )
    .reduce<Record<string, string>>((acc, header) => {
      acc[normalizeText(header.key)] = normalizeText(header.value);
      return acc;
    }, {});
}

async function fetchReturnReasons(headers: Record<string, string>): Promise<ReturnReasonRecord[]> {
  logger.info("GET return reasons started", { url: BASE_URL });
  const response = await fetch(BASE_URL, { method: "GET", headers });
  if (!response.ok) {
    throw new Error(`GET return-reason failed with status ${response.status}`);
  }
  const json = (await response.json()) as ReturnReasonListResponse;
  return Array.isArray(json?.data) ? json.data : [];
}

async function createReturnReason(
  payload: ReturnReasonPayload,
  headers: Record<string, string>
): Promise<void> {
  logger.info("POST create return reason started", { payload });
  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`POST return-reason failed with status ${response.status}`);
  }
}

async function updateReturnReason(
  id: string,
  payload: ReturnReasonPayload,
  headers: Record<string, string>
): Promise<void> {
  logger.info("PUT update return reason started", { id, payload });
  const response = await fetch(`${BASE_URL}/${id}`, {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`PUT return-reason failed with status ${response.status}`);
  }
}

export const ReturnReasonsView: React.FC = () => {
  const { hasBlueprint, getAnswer } = usePartsBlueprint();

  const [rows, setRows] = useState<ReturnReasonRecord[]>([]);
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready to check return reasons");
  const [errorText, setErrorText] = useState("");
  const [amountInput, setAmountInput] = useState("0");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  // 1. Resolve blueprint answers
  const rawChargesFeeAnswer = useMemo(() => {
    if (!hasBlueprint) return null;
    return (
      getAnswer("Do you charge a restocking fee?") ??
      getAnswer("charge a restocking fee") ??
      getAnswer("restocking fee")
    );
  }, [hasBlueprint, getAnswer]);

  const rawFeeAmountAnswer = useMemo(() => {
    if (!hasBlueprint) return null;
    return (
      getAnswer("what amount is your restocking fee") ??
      getAnswer("If yes, what amount is your restocking fee?") ??
      getAnswer("restocking fee amount")
    );
  }, [hasBlueprint, getAnswer]);

  const chargesRestockFee = useMemo(() => {
    return parseYesNo(rawChargesFeeAnswer);
  }, [rawChargesFeeAnswer]);

  const extractedBlueprintAmount = useMemo(() => {
    if (chargesRestockFee === false) return "0";
    return extractRestockPercentage(rawFeeAmountAnswer);
  }, [chargesRestockFee, rawFeeAmountAnswer]);

  // 2. Pre-fill input from Blueprint
  useEffect(() => {
    if (chargesRestockFee === null) return;

    if (chargesRestockFee === false) {
      setAmountInput("0");
      setStatusText('Blueprint specifies "No" to Restocking Fee. Creation is not required.');
      setRunState("warning");
    } else {
      setAmountInput(extractedBlueprintAmount);
      setStatusText(`✓ Blueprint specifies "Yes" with ${extractedBlueprintAmount}% Restock Fee.`);
      setRunState("idle");
    }
  }, [chargesRestockFee, extractedBlueprintAmount]);

  const handleResetToBlueprint = () => {
    // Guard against the null ("couldn't determine yes/no") case falling
    // through to the Yes-branch by accident - only act on a confirmed answer.
    if (chargesRestockFee === null) {
      setStatusText("Blueprint answer for the restocking-fee question could not be determined - leaving input unchanged.");
      setRunState("warning");
      return;
    }
    if (chargesRestockFee === false) {
      setAmountInput("0");
    } else {
      setAmountInput(extractedBlueprintAmount);
    }
  };

  useEffect(() => {
    logger.info("component mounted");
    return () => logger.info("component unmounted");
  }, []);

  const matchedRecord = useMemo(() => {
    return (
      rows.find(
        (r) => normalizeLower(r.reasonCode) === normalizeLower(TARGET_RETURN_REASON.reasonCode)
      ) ?? null
    );
  }, [rows]);

  const parsedAmount = useMemo(() => parsePositiveInteger(amountInput), [amountInput]);

  const refreshData = async (headers: Record<string, string>): Promise<ReturnReasonRecord[]> => {
    const data = await fetchReturnReasons(headers);
    setRows(data);
    return data;
  };

  const handleFetchAndValidate = async (): Promise<void> => {
    setRunState("loading");
    setStatusText("Fetching latest return reasons...");
    setErrorText("");

    try {
      const headers = getEnabledGlobalHeaders();
      if (Object.keys(headers).length === 0) {
        setRunState("error");
        setStatusText("Global headers missing");
        setErrorText("Configure and save active Global Headers in Settings.");
        return;
      }

      const latestRows = await refreshData(headers);
      const exists = latestRows.some(
        (r) => normalizeLower(r.reasonCode) === normalizeLower(TARGET_RETURN_REASON.reasonCode)
      );

      setRunState(exists ? "success" : "warning");
      setStatusText(
        exists
          ? `✓ "${TARGET_RETURN_REASON.reasonCode}" exists on server`
          : `⚠ "${TARGET_RETURN_REASON.reasonCode}" is missing from server`
      );
    } catch (err: unknown) {
      logger.error("Fetch failed", err);
      setRunState("error");
      setStatusText("Validation failed");
      setErrorText(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSmartSave = async (): Promise<void> => {
    if (parsedAmount === null) {
      setRunState("error");
      setStatusText("Invalid restock fee");
      setErrorText("Please enter a valid non-negative integer percentage.");
      return;
    }

    setIsSubmitting(true);
    setRunState("loading");
    setErrorText("");

    try {
      const headers = getEnabledGlobalHeaders();
      if (Object.keys(headers).length === 0) {
        setRunState("error");
        setStatusText("Global headers missing");
        setErrorText("Configure and save active Global Headers in Settings.");
        return;
      }

      const currentRows = rows.length > 0 ? rows : await refreshData(headers);
      const existing = currentRows.find(
        (r) => normalizeLower(r.reasonCode) === normalizeLower(TARGET_RETURN_REASON.reasonCode)
      );

      if (existing) {
        setStatusText(`Updating "${TARGET_RETURN_REASON.reasonCode}"...`);
        const payload: ReturnReasonPayload = {
          active: TARGET_RETURN_REASON.active,
          reasonCode: TARGET_RETURN_REASON.reasonCode,
          detail: {
            description: TARGET_RETURN_REASON.description,
            restocking: TARGET_RETURN_REASON.restocking,
            restockingFee: TARGET_RETURN_REASON.restockingFee,
            reviewRequired: TARGET_RETURN_REASON.reviewRequired,
            amount: parsedAmount,
            refundFreight: TARGET_RETURN_REASON.refundFreight,
            languages: null,
          },
        };
        await updateReturnReason(normalizeText(existing.id), payload, headers);
        setStatusText(`✓ Successfully updated "${TARGET_RETURN_REASON.reasonCode}"`);
      } else {
        setStatusText(`Creating "${TARGET_RETURN_REASON.reasonCode}"...`);
        const payload: ReturnReasonPayload = {
          active: TARGET_RETURN_REASON.active,
          reasonCode: TARGET_RETURN_REASON.reasonCode,
          detail: {
            description: TARGET_RETURN_REASON.description,
            restocking: TARGET_RETURN_REASON.restocking,
            restockingFee: TARGET_RETURN_REASON.restockingFee,
            reviewRequired: TARGET_RETURN_REASON.reviewRequired,
            amount: String(parsedAmount),
            refundFreight: TARGET_RETURN_REASON.refundFreight,
            languages: null,
          },
        };
        await createReturnReason(payload, headers);
        setStatusText(`✓ Successfully created "${TARGET_RETURN_REASON.reasonCode}"`);
      }

      await refreshData(headers);
      setRunState("success");
    } catch (err: unknown) {
      logger.error("Save failed", err);
      setRunState("error");
      setStatusText("Save operation failed");
      setErrorText(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const banner = useMemo(() => {
    switch (runState) {
      case "error":
        return { bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.25)", text: "#fecaca" };
      case "success":
        return { bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.25)", text: "#bbf7d0" };
      case "warning":
        return { bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.25)", text: "#fde68a" };
      default:
        return { bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.08)", text: "#cbd5e1" };
    }
  }, [runState]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Executive Action Header */}
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#f8fafc" }}>
              Return reasons
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
              title="Toggle Info"
            >
              i
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="btn-postman"
              type="button"
              onClick={() => void handleFetchAndValidate()}
              disabled={runState === "loading" || isSubmitting}
            >
              {runState === "loading" && !isSubmitting ? "Running..." : "GET"}
            </button>

            <button
              className="btn-secondary btn-sm"
              type="button"
              onClick={() => void handleSmartSave()}
              disabled={isSubmitting || runState === "loading"}
            >
              {isSubmitting
                ? "Processing..."
                : matchedRecord
                ? "Update Target"
                : "Create Target"}
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
            Validates whether <code>{TARGET_RETURN_REASON.reasonCode}</code> exists on the server.
            The action button automatically routes to <b>Update</b> if found or <b>Create</b> if missing.
          </div>
        )}

        {/* Blueprint Review Card */}
        {hasBlueprint && rawChargesFeeAnswer !== null && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              background:
                chargesRestockFee === null
                  ? "rgba(248, 113, 113, 0.08)"
                  : chargesRestockFee
                    ? "rgba(59, 130, 246, 0.08)"
                    : "rgba(245, 158, 11, 0.08)",
              border: `1px solid ${
                chargesRestockFee === null
                  ? "rgba(248, 113, 113, 0.3)"
                  : chargesRestockFee
                    ? "rgba(59, 130, 246, 0.25)"
                    : "rgba(245, 158, 11, 0.25)"
              }`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: chargesRestockFee === null ? "#f87171" : chargesRestockFee ? "#60a5fa" : "#fbbf24",
                  textTransform: "uppercase",
                }}
              >
                📋 Blueprint Response:
              </span>
              <div style={{ color: "#f8fafc", fontSize: 12, marginTop: 2 }}>
                Charge Restocking Fee:{" "}
                <b>{chargesRestockFee === null ? "Unknown" : chargesRestockFee ? "Yes" : "No"}</b>
                {chargesRestockFee === true && (
                  <span>
                    {" "}• Answered Amount: <b>{normalizeText(rawFeeAmountAnswer) || "None (defaulted to 0%)"}</b>
                  </span>
                )}
                {chargesRestockFee === false && (
                  <span style={{ color: "#fde68a" }}>
                    {" "}— Dealer does not charge a restock fee. Creation is not needed.
                  </span>
                )}
                {chargesRestockFee === null && (
                  <span style={{ color: "#f87171" }}>
                    {" "}— Could not parse a Yes/No answer from the blueprint (raw value:{" "}
                    {JSON.stringify(rawChargesFeeAnswer)}). Verify manually before resetting.
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={handleResetToBlueprint}
              title="Reset input to blueprint answers"
            >
              ↺ Reset to Blueprint
            </button>
          </div>
        )}

        {/* Compact Form Input Row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 140px",
            gap: 12,
            alignItems: "end",
          }}
        >
          <div>
            <div style={labelStyle}>Target Preset</div>
            <div
              style={{
                ...inputStyle,
                display: "flex",
                alignItems: "center",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                color: "#e2e8f0",
                fontWeight: 600,
              }}
            >
              {TARGET_RETURN_REASON.reasonCode}
            </div>
          </div>

          <div>
            <div style={labelStyle}>Restock Fee (%)</div>
            <input
              className="st-input"
              type="text"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="0"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Status Feedback Banner */}
        <div
          style={{
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: 13,
            border: `1px solid ${banner.border}`,
            background: banner.bg,
            color: banner.text,
          }}
        >
          <div style={{ fontWeight: 700 }}>{statusText}</div>
          {errorText && <div style={{ fontSize: 12, marginTop: 4 }}>{errorText}</div>}
        </div>
      </div>

      {/* Target Diagnostic Snapshot */}
      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: 16,
          display: "grid",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 800, color: "#f8fafc" }}>
            Target Configuration Snapshot
          </div>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              background: matchedRecord ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.12)",
              color: matchedRecord ? "#86efac" : "#fde68a",
              border: `1px solid ${
                matchedRecord ? "rgba(34,197,94,0.25)" : "rgba(245,158,11,0.25)"
              }`,
            }}
          >
            {matchedRecord ? "✓ Configured on Server" : "○ Not on Server"}
          </span>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 8,
          }}
        >
          <StatMini label="Restocking Active" value="Yes" />
          <StatMini label="Fee Strategy" value="Percentage of Sale" />
          <StatMini label="Refund Freight" value="No" />
          <StatMini label="Configured Fee" value={`${parsedAmount ?? 0}%`} />
          <StatMini
            label="Server Record ID"
            value={matchedRecord ? normalizeText(matchedRecord.id) : "—"}
          />
        </div>
      </div>

      {/* Live Server Table */}
      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 800, color: "#f8fafc" }}>
            Existing Return Reasons{" "}
            {rows.length > 0 && (
              <span style={{ color: "#94a3b8", fontSize: 12 }}>({rows.length})</span>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
          <div
            style={{
              borderRadius: 12,
              border: "1px dashed rgba(255,255,255,0.1)",
              padding: 24,
              color: "#94a3b8",
              textAlign: "center",
              fontSize: 13,
            }}
          >
            No data loaded yet. Click GET.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>ID</th>
                  <th style={thStyle}>Reason Code</th>
                  <th style={thStyle}>Restock</th>
                  <th style={thStyle}>Fee Strategy</th>
                  <th style={thStyle}>Amount</th>
                  <th style={thStyle}>Active</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const isTarget =
                    normalizeLower(TARGET_RETURN_REASON.reasonCode) ===
                    normalizeLower(row.reasonCode);

                  return (
                    <tr
                      key={`${row.id}-${index}`}
                      style={{
                        borderTop: "1px solid rgba(255,255,255,0.06)",
                        background: isTarget ? "rgba(59,130,246,0.06)" : "transparent",
                      }}
                    >
                      <td style={tdStyle}>{index + 1}</td>
                      <td style={tdMonoStyle}>{normalizeText(row.id) || "—"}</td>
                      <td style={tdStyle}>{normalizeText(row.reasonCode) || "—"}</td>
                      <td style={tdStyle}>{row.detail?.restocking ? "Yes" : "No"}</td>
                      <td style={tdStyle}>{normalizeText(row.detail?.restockingFee) || "—"}</td>
                      <td style={tdStyle}>{normalizeText(row.detail?.amount) || "—"}</td>
                      <td style={tdStyle}>{row.active ? "Yes" : "No"}</td>
                      <td style={tdStyle}>
                        {isTarget ? (
                          <span
                            style={{
                              display: "inline-flex",
                              padding: "2px 8px",
                              borderRadius: 999,
                              background: "rgba(59,130,246,0.15)",
                              color: "#93c5fd",
                              border: "1px solid rgba(59,130,246,0.3)",
                              fontSize: 11,
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

const StatMini: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div
    style={{
      padding: "8px 10px",
      borderRadius: 8,
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.05)",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      fontSize: 12,
    }}
  >
    <span style={{ color: "#94a3b8" }}>{label}</span>
    <strong style={{ color: "#f8fafc" }}>{value}</strong>
  </div>
);

const labelStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 11,
  fontWeight: 700,
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 38,
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  boxSizing: "border-box",
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
  padding: "10px 8px",
  color: "#e2e8f0",
  fontSize: 12,
  verticalAlign: "middle",
};

const tdMonoStyle: React.CSSProperties = {
  ...tdStyle,
  fontFamily: "ui-monospace, monospace",
};

export default ReturnReasonsView;