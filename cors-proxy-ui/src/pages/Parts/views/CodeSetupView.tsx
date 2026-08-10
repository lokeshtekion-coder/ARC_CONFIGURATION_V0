import React, { useEffect, useMemo, useState } from "react";
import { loadTekionApiSettingsBundle } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";

const MODULE_NAME = "Code Setup";
const BASE_URL = "https://preprodapp.tekioncloud.com/api/parts/proxy/u/settings/priority-code";
const STORAGE_KEY_REQUIRED_CODES = "parts_code_setup_required_codes_v1";

const DEFAULT_REQUIRED_CODES = [
  { code: "STK", description: "Stock Order" },
  { code: "OVN", description: "Over Night Order" },
  { code: "SPAC", description: "Back Order Part Order" },
  { code: "CSO", description: "Customer Order" },
  { code: "KEY", description: "Key Order" },
];

const logger = {
  debug: (...args: unknown[]) => console.debug("[Parts][CodeSetup]", ...args),
  info: (...args: unknown[]) => console.info("[Parts][CodeSetup]", ...args),
  warn: (...args: unknown[]) => console.warn("[Parts][CodeSetup]", ...args),
  error: (...args: unknown[]) => console.error("[Parts][CodeSetup]", ...args),
};

type RunState = "idle" | "loading" | "success" | "error" | "warning";

interface PriorityCodeRecord {
  id: string | null;
  code?: string | null;
  priorityCode?: string | null;
  description?: string | null;
  default?: boolean | null;
  isDefault?: boolean | null;
  deleted?: boolean | null;
  dealerId?: string | null;
  tenantId?: string | null;
  modifiedTime?: number | null;
  createdTime?: number | null;
  siteId?: string | null;
  languages?: unknown;
}

interface PriorityCodeListResponse {
  data: PriorityCodeRecord[];
  status?: string;
}

interface CreatePriorityCodePayload {
  code: string;
  description: string;
}

interface DeletePriorityCodePayload {
  id: string;
  priorityCode: string;
  description: string;
  isDefault: boolean;
  deleted: true;
}

interface MissingRequiredCode {
  code: string;
  description: string;
}

interface ValidationSummary {
  existingRecords: PriorityCodeRecord[];
  validRecords: PriorityCodeRecord[];
  invalidRecords: PriorityCodeRecord[];
  missingRequiredCodes: MissingRequiredCode[];
}

function normalizeCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeDescription(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function getRecordCode(record: PriorityCodeRecord): string {
  return normalizeCode(record.code || record.priorityCode);
}

function getRecordDescription(record: PriorityCodeRecord): string {
  return normalizeDescription(record.description);
}

function getRecordIsDefault(record: PriorityCodeRecord): boolean {
  return Boolean(record.isDefault ?? record.default ?? false);
}

function isPriorityCodeRecord(value: unknown): value is PriorityCodeRecord {
  return Boolean(value && typeof value === "object" && "id" in (value as Record<string, unknown>));
}

function isPriorityCodeListResponse(value: unknown): value is PriorityCodeListResponse {
  return Boolean(
    value &&
      typeof value === "object" &&
      Array.isArray((value as PriorityCodeListResponse).data) &&
      (value as PriorityCodeListResponse).data.every(isPriorityCodeRecord)
  );
}

function getEnabledGlobalHeaders(): Record<string, string> {
  const bundle = loadTekionApiSettingsBundle();

  const headers = (bundle.globalHeaders ?? [])
    .filter(
      (header: KeyValuePair) =>
        header.enabled &&
        header.key.trim() &&
        String(header.value).trim()
    )
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

async function fetchPriorityCodes(headers: Record<string, string>): Promise<PriorityCodeListResponse> {
  logger.info("GET priority codes started", {
    url: BASE_URL,
    headerKeys: Object.keys(headers),
  });

  const response = await fetch(BASE_URL, {
    method: "GET",
    headers,
  });

  logger.info("GET priority codes response", {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("GET priority codes failed", {
      status: response.status,
      body: text,
    });
    throw new Error(`GET priority-code failed with status ${response.status}`);
  }

  const json: unknown = await response.json();
  logger.debug("GET priority codes raw json", json);

  if (!isPriorityCodeListResponse(json)) {
    logger.error("Invalid GET priority-code response shape", json);
    throw new Error("Invalid priority-code GET response structure");
  }

  logger.info("GET priority codes validated", {
    rowCount: json.data.length,
  });

  return json;
}

function validatePriorityCodes(
  records: PriorityCodeRecord[],
  requiredList: { code: string; description: string }[]
): ValidationSummary {
  logger.info("validating priority codes", { rowCount: records.length });

  const requiredMap = new Map(
    requiredList.map((item) => [normalizeCode(item.code), item.description])
  );

  const validRecords: PriorityCodeRecord[] = [];
  const invalidRecords: PriorityCodeRecord[] = [];

  for (const record of records) {
    const code = getRecordCode(record);
    if (requiredMap.has(code)) {
      validRecords.push(record);
    } else {
      invalidRecords.push(record);
    }
  }

  const existingRequiredCodes = new Set(
    records.map((record) => getRecordCode(record)).filter(Boolean)
  );

  const missingRequiredCodes: MissingRequiredCode[] = requiredList
    .filter((required) => !existingRequiredCodes.has(normalizeCode(required.code)))
    .map((required) => ({
      code: required.code,
      description: required.description,
    }));

  const summary: ValidationSummary = {
    existingRecords: records,
    validRecords,
    invalidRecords,
    missingRequiredCodes,
  };

  logger.info("validation summary", {
    total: summary.existingRecords.length,
    valid: summary.validRecords.length,
    invalid: summary.invalidRecords.length,
    missing: summary.missingRequiredCodes.length,
    invalidCodes: summary.invalidRecords.map((record) => getRecordCode(record)),
    missingCodes: summary.missingRequiredCodes.map((record) => record.code),
  });

  return summary;
}

function buildDeletePayload(record: PriorityCodeRecord): DeletePriorityCodePayload {
  const payload: DeletePriorityCodePayload = {
    id: normalizeText(record.id),
    priorityCode: getRecordCode(record),
    description: getRecordDescription(record),
    isDefault: getRecordIsDefault(record),
    deleted: true,
  };

  logger.debug("built delete payload", payload);
  return payload;
}

async function deletePriorityCode(
  record: PriorityCodeRecord,
  headers: Record<string, string>
): Promise<void> {
  const id = normalizeText(record.id);
  const url = `${BASE_URL}/${id}`;
  const payload = buildDeletePayload(record);

  logger.info("PUT delete priority code started", {
    url,
    id,
    code: getRecordCode(record),
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

  logger.info("PUT delete priority code response", {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    id,
    code: getRecordCode(record),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("PUT delete priority code failed", {
      status: response.status,
      body: text,
      id,
      code: getRecordCode(record),
    });
    throw new Error(`Failed deleting invalid code ${getRecordCode(record)}. HTTP ${response.status}`);
  }

  const json: unknown = await response.json();
  logger.debug("PUT delete priority code response json", json);
}

async function createPriorityCode(
  payload: CreatePriorityCodePayload,
  headers: Record<string, string>
): Promise<void> {
  logger.info("POST create priority code started", {
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

  logger.info("POST create priority code response", {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    payload,
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("POST create priority code failed", {
      status: response.status,
      body: text,
      payload,
    });
    throw new Error(`Failed creating missing code ${payload.code}. HTTP ${response.status}`);
  }

  const json: unknown = await response.json();
  logger.debug("POST create priority code response json", json);
}

export const CodeSetupView: React.FC = () => {
  const [rows, setRows] = useState<PriorityCodeRecord[]>([]);
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready to validate priority codes");
  const [errorText, setErrorText] = useState("");
  const [lastRunAt, setLastRunAt] = useState("");
  const [isAutoFixing, setIsAutoFixing] = useState(false);

  // Dynamic state for Included List
  const [requiredCodes, setRequiredCodes] = useState<{ code: string; description: string }[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_REQUIRED_CODES);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      logger.warn("Failed to parse saved required codes, falling back to default.");
    }
    return DEFAULT_REQUIRED_CODES;
  });

  const [newCodeInput, setNewCodeInput] = useState("");
  const [newDescInput, setNewDescInput] = useState("");

  useEffect(() => {
    logger.info("component mounted");
    return () => logger.info("component unmounted");
  }, []);

  // Sync Included List to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_REQUIRED_CODES, JSON.stringify(requiredCodes));
    } catch (error) {
      logger.error("Failed to save required codes to localStorage", error);
    }
  }, [requiredCodes]);

  const validation = useMemo(() => {
    const result = validatePriorityCodes(rows, requiredCodes);
    logger.debug("validation memo recalculated", result);
    return result;
  }, [rows, requiredCodes]);

  const allRequiredPresent = validation.missingRequiredCodes.length === 0;
  const hasInvalidCodes = validation.invalidRecords.length > 0;

  const refreshData = async (headers: Record<string, string>): Promise<PriorityCodeRecord[]> => {
    logger.info("refreshing latest priority-code data");
    const response = await fetchPriorityCodes(headers);
    setRows(response.data);
    setLastRunAt(new Date().toLocaleString());
    return response.data;
  };

  const handleRunValidation = async (): Promise<void> => {
    logger.info("Send clicked for validation");

    setRunState("loading");
    setStatusText("Loading and validating priority codes...");
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
      const summary = validatePriorityCodes(latestRows, requiredCodes);

      if (summary.invalidRecords.length === 0 && summary.missingRequiredCodes.length === 0) {
        setRunState("success");
        setStatusText("All included priority codes are present and valid");
        logger.info("validation passed fully");
        return;
      }

      if (summary.invalidRecords.length > 0 && summary.missingRequiredCodes.length > 0) {
        setRunState("warning");
        setStatusText(
          `Found ${summary.invalidRecords.length} invalid code(s) and ${summary.missingRequiredCodes.length} missing included code(s)`
        );
        logger.warn("validation found invalid and missing codes");
        return;
      }

      if (summary.invalidRecords.length > 0) {
        setRunState("warning");
        setStatusText(`Found ${summary.invalidRecords.length} invalid code(s)`);
        logger.warn("validation found invalid codes only");
        return;
      }

      setRunState("warning");
      setStatusText(`Found ${summary.missingRequiredCodes.length} missing included code(s)`);
      logger.warn("validation found missing included codes only");
    } catch (error: unknown) {
      logger.error("validation failed", error);
      setRunState("error");
      setStatusText("Validation failed");
      setErrorText(error instanceof Error ? error.message : String(error));
      setLastRunAt(new Date().toLocaleString());
    }
  };

  const handleAutoFix = async (): Promise<void> => {
    logger.info("Auto Fix clicked", {
      invalidCount: validation.invalidRecords.length,
      missingCount: validation.missingRequiredCodes.length,
    });

    const headers = getEnabledGlobalHeaders();

    if (Object.keys(headers).length === 0) {
      logger.warn("global headers missing before auto fix");
      setRunState("error");
      setStatusText("Global headers are missing");
      setErrorText(
        "No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers."
      );
      return;
    }

    const confirmed = window.confirm(
      [
        "Auto Fix will do the following:",
        validation.invalidRecords.length > 0
          ? `• Delete ${validation.invalidRecords.length} invalid code(s)`
          : "• No invalid codes to delete",
        validation.missingRequiredCodes.length > 0
          ? `• Create ${validation.missingRequiredCodes.length} missing included code(s)`
          : "• No missing codes to create",
        "",
        "Do you want to continue?",
      ].join("\n")
    );

    if (!confirmed) {
      logger.info("user cancelled auto fix");
      return;
    }

    setIsAutoFixing(true);
    setRunState("loading");
    setStatusText("Running auto fix for priority codes...");
    setErrorText("");

    try {
      for (const record of validation.invalidRecords) {
        logger.info("deleting invalid priority code", {
          id: record.id,
          code: getRecordCode(record),
          description: getRecordDescription(record),
        });
        await deletePriorityCode(record, headers);
      }

      for (const missing of validation.missingRequiredCodes) {
        const payload: CreatePriorityCodePayload = {
          code: missing.code,
          description: missing.description,
        };

        logger.info("creating missing priority code", payload);
        await createPriorityCode(payload, headers);
      }

      const refreshedRows = await refreshData(headers);
      const refreshedValidation = validatePriorityCodes(refreshedRows, requiredCodes);

      if (
        refreshedValidation.invalidRecords.length === 0 &&
        refreshedValidation.missingRequiredCodes.length === 0
      ) {
        setRunState("success");
        setStatusText("Auto Fix completed successfully. Included priority codes are now correct.");
        logger.info("auto fix completed successfully");
        return;
      }

      setRunState("warning");
      setStatusText(
        `Auto Fix completed, but still found ${refreshedValidation.invalidRecords.length} invalid and ${refreshedValidation.missingRequiredCodes.length} missing code(s)`
      );
      logger.warn("auto fix completed but validation still not clean", refreshedValidation);
    } catch (error: unknown) {
      logger.error("auto fix failed", error);
      setRunState("error");
      setStatusText("Auto Fix failed");
      setErrorText(error instanceof Error ? error.message : String(error));
      setLastRunAt(new Date().toLocaleString());
    } finally {
      setIsAutoFixing(false);
    }
  };

  const handleAddCustomCode = () => {
    if (!newCodeInput.trim() || !newDescInput.trim()) return;
    const cleanCode = newCodeInput.trim().toUpperCase();

    if (requiredCodes.some((c) => normalizeCode(c.code) === cleanCode)) {
      alert("This code is already in the Included List.");
      return;
    }

    setRequiredCodes((prev) => [...prev, { code: cleanCode, description: newDescInput.trim() }]);
    setNewCodeInput("");
    setNewDescInput("");
  };

  const handleRemoveCustomCode = (codeToRemove: string) => {
    setRequiredCodes((prev) => prev.filter((c) => c.code !== codeToRemove));
  };

  const handleResetCodes = () => {
    if (window.confirm("Reset the Included List to system defaults?")) {
      setRequiredCodes(DEFAULT_REQUIRED_CODES);
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
              Code setup
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
              Validates priority codes, removes invalid ones, and creates missing included codes using the active Global Headers from Settings.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn-postman"
              type="button"
              onClick={() => {
                void handleRunValidation();
              }}
              disabled={runState === "loading" || isAutoFixing}
            >
              {runState === "loading" && !isAutoFixing ? "Running..." : "Send"}
            </button>

            <button
              className="btn-secondary btn-sm"
              type="button"
              onClick={() => {
                void handleAutoFix();
              }}
              disabled={
                isAutoFixing ||
                runState === "loading" ||
                (validation.invalidRecords.length === 0 &&
                  validation.missingRequiredCodes.length === 0)
              }
            >
              {isAutoFixing ? "Auto Fixing..." : "Auto Fix"}
            </button>
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
          <Pill label="Valid" value={String(validation.validRecords.length)} />
          <Pill label="Invalid" value={String(validation.invalidRecords.length)} />
          <Pill label="Missing" value={String(validation.missingRequiredCodes.length)} />
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
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        <SectionCard title="Included List">
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <input
              className="st-input"
              value={newCodeInput}
              onChange={(e) => setNewCodeInput(e.target.value)}
              placeholder="Code (e.g. RUSH)"
              style={inputStyle}
            />
            <input
              className="st-input"
              value={newDescInput}
              onChange={(e) => setNewDescInput(e.target.value)}
              placeholder="Description"
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              className="btn-secondary btn-sm"
              type="button"
              onClick={handleAddCustomCode}
              disabled={!newCodeInput || !newDescInput}
            >
              Add
            </button>
          </div>

          {requiredCodes.length === 0 ? (
            <EmptyText text="No included priority codes configured." />
          ) : (
            requiredCodes.map((item, index) => {
              const exists = rows.some((row) => getRecordCode(row) === normalizeCode(item.code));
              return (
                <RowLine
                  key={item.code}
                  left={
                    <>
                      <button
                        type="button"
                        onClick={() => handleRemoveCustomCode(item.code)}
                        style={{
                          border: "none",
                          background: "rgba(239,68,68,0.1)",
                          color: "#fca5a5",
                          borderRadius: "4px",
                          width: "20px",
                          height: "20px",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          marginRight: "6px",
                          fontSize: "12px",
                        }}
                        title="Remove from included list"
                      >
                        ×
                      </button>
                      {index + 1}. {item.code} — {item.description}
                    </>
                  }
                  right={exists ? "✓ Valid" : "Missing"}
                  rightColor={exists ? "#86efac" : "#fca5a5"}
                />
              );
            })
          )}

          <div style={{ marginTop: 8, textAlign: "right" }}>
            <button
              className="btn-secondary btn-sm"
              style={{ fontSize: 11, padding: "4px 8px" }}
              type="button"
              onClick={handleResetCodes}
            >
              Reset to Defaults
            </button>
          </div>
        </SectionCard>

        <SectionCard title="Missing Included Codes">
          {validation.missingRequiredCodes.length === 0 ? (
            <EmptyText text="No missing included codes" />
          ) : (
            validation.missingRequiredCodes.map((item) => (
              <RowLine
                key={item.code}
                left={`${item.code} — ${item.description}`}
                right="Missing"
                rightColor="#fca5a5"
              />
            ))
          )}
        </SectionCard>

        <SectionCard title="Invalid Existing Codes">
          {validation.invalidRecords.length === 0 ? (
            <EmptyText text="No invalid existing codes" />
          ) : (
            validation.invalidRecords.map((item, index) => (
              <RowLine
                key={`${item.id ?? "no-id"}-${index}`}
                left={`${getRecordCode(item) || "—"} — ${getRecordDescription(item) || "—"}`}
                right={normalizeText(item.id) || "No ID"}
                rightColor="#fde68a"
              />
            ))
          )}
        </SectionCard>
      </div>

      <SectionCard title="Existing Priority Codes">
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
                minWidth: 980,
              }}
            >
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>ID</th>
                  <th style={thStyle}>Code</th>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Default</th>
                  <th style={thStyle}>Dealer ID</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const code = getRecordCode(row);
                  const isValid = requiredCodes.some(
                    (item) => normalizeCode(item.code) === code
                  );

                  return (
                    <tr
                      key={`${row.id ?? "no-id"}-${index}`}
                      style={{
                        borderTop: "1px solid rgba(255,255,255,0.08)",
                        background: isValid ? "transparent" : "rgba(239,68,68,0.05)",
                      }}
                    >
                      <td style={tdStyle}>{index + 1}</td>
                      <td style={tdMonoStyle}>{normalizeText(row.id) || "—"}</td>
                      <td style={tdMonoStyle}>{code || "—"}</td>
                      <td style={tdStyle}>{getRecordDescription(row) || "—"}</td>
                      <td style={tdStyle}>{getRecordIsDefault(row) ? "Yes" : "No"}</td>
                      <td style={tdStyle}>{normalizeText(row.dealerId) || "—"}</td>
                      <td style={tdStyle}>
                        <span
                          style={{
                            display: "inline-flex",
                            padding: "4px 10px",
                            borderRadius: 999,
                            border: isValid
                              ? "1px solid rgba(34,197,94,0.25)"
                              : "1px solid rgba(239,68,68,0.25)",
                            background: isValid
                              ? "rgba(34,197,94,0.10)"
                              : "rgba(239,68,68,0.10)",
                            color: isValid ? "#86efac" : "#fca5a5",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {isValid ? "✓ Valid" : "Invalid"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 ? (
          <div
            style={{
              marginTop: 16,
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              padding: 14,
              display: "grid",
              gap: 6,
              fontSize: 13,
              color: "#cbd5e1",
            }}
          >
            <div>
              <b style={{ color: "#f8fafc" }}>All required codes present:</b>{" "}
              {allRequiredPresent ? "Yes" : "No"}
            </div>
            <div>
              <b style={{ color: "#f8fafc" }}>Has invalid codes:</b> {hasInvalidCodes ? "Yes" : "No"}
            </div>
            <div>
              <b style={{ color: "#f8fafc" }}>Expected final state:</b> Only included list codes should remain valid.
            </div>
          </div>
        ) : null}
      </SectionCard>
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

const inputStyle: React.CSSProperties = {
  minHeight: 36,
  borderRadius: 8,
  padding: "6px 10px",
  fontSize: 13,
  boxSizing: "border-box",
  width: "auto",
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
      {label}
      <b style={{ color: "#f8fafc" }}>{value}</b>
    </span>
  );
};

const SectionCard: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => {
  const [isExpanded, setIsExpanded] = useState(true);

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
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
          marginBottom: isExpanded ? 12 : 0,
        }}
      >
        <div
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: "#f8fafc",
          }}
        >
          {title}
        </div>
        <button
          type="button"
          style={{
            border: "none",
            background: "transparent",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: 14,
            padding: "4px",
          }}
          title={isExpanded ? "Collapse section" : "Expand section"}
        >
          {isExpanded ? "▲" : "▼"}
        </button>
      </div>
      {isExpanded && (
        <div
          style={{
            display: "grid",
            gap: 8,
            maxHeight: "500px",
            overflowY: "auto",
            paddingRight: 4,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};

const RowLine: React.FC<{
  left: React.ReactNode;
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
          display: "flex",
          alignItems: "center",
        }}
      >
        {left}
      </div>

      <div
        style={{
          color: rightColor,
          fontSize: 12,
          fontWeight: 700,
          whiteSpace: "nowrap",
          marginTop: 2,
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