import React, { useEffect, useMemo, useState } from "react";
import { loadTekionApiSettingsBundle } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";
import "./CodeSetupView.css";

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

  return headers;
}

async function fetchPriorityCodes(headers: Record<string, string>): Promise<PriorityCodeListResponse> {
  const response = await fetch(BASE_URL, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    throw new Error(`GET priority-code failed with status ${response.status}`);
  }

  const json: unknown = await response.json();
  if (!isPriorityCodeListResponse(json)) {
    throw new Error("Invalid priority-code GET response structure");
  }

  return json;
}

function validatePriorityCodes(
  records: PriorityCodeRecord[],
  requiredList: { code: string; description: string }[]
): ValidationSummary {
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

  return {
    existingRecords: records,
    validRecords,
    invalidRecords,
    missingRequiredCodes,
  };
}

function buildDeletePayload(record: PriorityCodeRecord): DeletePriorityCodePayload {
  return {
    id: normalizeText(record.id),
    priorityCode: getRecordCode(record),
    description: getRecordDescription(record),
    isDefault: getRecordIsDefault(record),
    deleted: true,
  };
}

async function deletePriorityCode(
  record: PriorityCodeRecord,
  headers: Record<string, string>
): Promise<void> {
  const id = normalizeText(record.id);
  const url = `${BASE_URL}/${id}`;
  const payload = buildDeletePayload(record);

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      ...headers,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed deleting invalid code ${getRecordCode(record)}. HTTP ${response.status}`);
  }
}

async function createPriorityCode(
  payload: CreatePriorityCodePayload,
  headers: Record<string, string>
): Promise<void> {
  const response = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Failed creating missing code ${payload.code}. HTTP ${response.status}`);
  }
}

export const CodeSetupView: React.FC = () => {
  const [rows, setRows] = useState<PriorityCodeRecord[]>([]);
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready to validate priority codes");
  const [errorText, setErrorText] = useState("");
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

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
    try {
      localStorage.setItem(STORAGE_KEY_REQUIRED_CODES, JSON.stringify(requiredCodes));
    } catch (error) {
      logger.error("Failed to save required codes to localStorage", error);
    }
  }, [requiredCodes]);

  const validation = useMemo(() => {
    return validatePriorityCodes(rows, requiredCodes);
  }, [rows, requiredCodes]);

  const allRequiredPresent = validation.missingRequiredCodes.length === 0;
  const hasInvalidCodes = validation.invalidRecords.length > 0;

  const refreshData = async (headers: Record<string, string>): Promise<PriorityCodeRecord[]> => {
    const response = await fetchPriorityCodes(headers);
    setRows(response.data);
    return response.data;
  };

  const handleRunValidation = async (): Promise<void> => {
    setRunState("loading");
    setStatusText("Loading and validating priority codes...");
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

      const latestRows = await refreshData(headers);
      const summary = validatePriorityCodes(latestRows, requiredCodes);

      if (summary.invalidRecords.length === 0 && summary.missingRequiredCodes.length === 0) {
        setRunState("success");
        setStatusText("All included priority codes are present and valid");
        return;
      }

      setRunState("warning");
      setStatusText(
        `Found ${summary.invalidRecords.length} invalid code(s) and ${summary.missingRequiredCodes.length} missing included code(s)`
      );
    } catch (error: unknown) {
      setRunState("error");
      setStatusText("Validation failed");
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  };

  const handleAutoFix = async (): Promise<void> => {
    const headers = getEnabledGlobalHeaders();

    if (Object.keys(headers).length === 0) {
      setRunState("error");
      setStatusText("Global headers are missing");
      setErrorText(
        "No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers."
      );
      return;
    }

    setIsAutoFixing(true);
    setRunState("loading");
    setStatusText("Analyzing data before Auto Fix...");
    setErrorText("");

    try {
      const latestRows = await refreshData(headers);
      const latestValidation = validatePriorityCodes(latestRows, requiredCodes);

      if (latestValidation.invalidRecords.length === 0 && latestValidation.missingRequiredCodes.length === 0) {
        setRunState("success");
        setStatusText("All included priority codes are already present and valid. No fixes needed.");
        setIsAutoFixing(false);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));

      const confirmed = window.confirm(
        [
          "Analysis Complete. Auto Fix will perform the following:",
          latestValidation.invalidRecords.length > 0
            ? `• Delete ${latestValidation.invalidRecords.length} invalid code(s)`
            : "• No invalid codes to delete",
          latestValidation.missingRequiredCodes.length > 0
            ? `• Create ${latestValidation.missingRequiredCodes.length} missing included code(s)`
            : "• No missing codes to create",
          "",
          "Do you want to continue?",
        ].join("\n")
      );

      if (!confirmed) {
        setRunState("idle");
        setStatusText("Auto Fix cancelled by user.");
        setIsAutoFixing(false);
        return;
      }

      setStatusText("Running auto fix for priority codes...");

      for (const record of latestValidation.invalidRecords) {
        await deletePriorityCode(record, headers);
      }

      for (const missing of latestValidation.missingRequiredCodes) {
        const payload: CreatePriorityCodePayload = {
          code: missing.code,
          description: missing.description,
        };
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
        return;
      }

      setRunState("warning");
      setStatusText(
        `Auto Fix completed, but still found ${refreshedValidation.invalidRecords.length} invalid and ${refreshedValidation.missingRequiredCodes.length} missing code(s)`
      );
    } catch (error: unknown) {
      setRunState("error");
      setStatusText("Auto Fix failed");
      setErrorText(error instanceof Error ? error.message : String(error));
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

  const getStatusBannerClass = () => {
    switch (runState) {
      case "error":
        return "csv-status-error";
      case "success":
        return "csv-status-success";
      case "warning":
        return "csv-status-warning";
      default:
        return "csv-status-default";
    }
  };

  return (
    <div className="csv-container">
      {/* Top Header Card */}
      <div className="csv-header-card">
        <div className="csv-header-row">
          <div className="csv-title-group">
            <div className="csv-title">Code setup</div>
            <div className="csv-info-wrapper">
              <button
                type="button"
                onClick={() => setShowInfo((prev) => !prev)}
                className={`csv-info-btn ${showInfo ? "active" : ""}`}
                title="Show Info"
              >
                i
              </button>
              {showInfo && (
                <div className="csv-info-tooltip">
                  Validates priority codes, removes invalid ones, and creates missing included
                  codes using active Global Headers from Settings.
                </div>
              )}
            </div>
          </div>

          <div className="csv-action-group">
            <button
              className="btn-postman"
              type="button"
              onClick={() => void handleRunValidation()}
              disabled={runState === "loading" || isAutoFixing}
            >
              {runState === "loading" && !isAutoFixing ? "Running..." : "GET"}
            </button>

            <button
              className="btn-secondary btn-sm"
              type="button"
              onClick={() => void handleAutoFix()}
              disabled={
                isAutoFixing ||
                runState === "loading" ||
                (validation.invalidRecords.length === 0 &&
                  validation.missingRequiredCodes.length === 0 &&
                  rows.length > 0)
              }
            >
              {isAutoFixing ? "Analyzing & Fixing..." : "Auto Fix"}
            </button>
          </div>
        </div>

        <div className={`csv-status-box ${getStatusBannerClass()}`}>
          <div className="csv-status-title" style={{ marginBottom: errorText ? 6 : 0 }}>
            {statusText}
          </div>
          {errorText ? <div>{errorText}</div> : null}
        </div>
      </div>

      {/* Grid for Configuration & Errors */}
      <div className="csv-grid">
        <SectionCard title="Included List" count={requiredCodes.length}>
          <div className="csv-input-group">
            <input
              className="st-input csv-input"
              value={newCodeInput}
              onChange={(e) => setNewCodeInput(e.target.value)}
              placeholder="Code (e.g. RUSH)"
            />
            <input
              className="st-input csv-input csv-input-flex"
              value={newDescInput}
              onChange={(e) => setNewDescInput(e.target.value)}
              placeholder="Description"
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
            requiredCodes.map((item) => {
              const exists = rows.some((row) => getRecordCode(row) === normalizeCode(item.code));
              return (
                <RowLine
                  key={item.code}
                  left={
                    <>
                      <button
                        type="button"
                        onClick={() => handleRemoveCustomCode(item.code)}
                        className="csv-remove-btn"
                        title="Remove from included list"
                      >
                        ×
                      </button>
                      {item.code} — {item.description}
                    </>
                  }
                  right={exists ? "✓ Valid" : "Missing"}
                  rightColor={exists ? "#86efac" : "#fca5a5"}
                />
              );
            })
          )}

          <div className="csv-reset-container">
            <button
              className="btn-secondary btn-sm csv-reset-btn"
              type="button"
              onClick={handleResetCodes}
            >
              Reset to Defaults
            </button>
          </div>
        </SectionCard>

        <SectionCard title="Invalid Existing Codes" count={validation.invalidRecords.length}>
          {validation.invalidRecords.length === 0 ? (
            <EmptyText text="No invalid existing codes found." />
          ) : (
            validation.invalidRecords.map((item, index) => (
              <RowLine
                key={`${item.id ?? "no-id"}-${index}`}
                left={`${getRecordCode(item) || "—"} — ${getRecordDescription(item) || "—"}`}
                right={`ID: ${normalizeText(item.id) || "None"}`}
                rightColor="#fde68a"
              />
            ))
          )}
        </SectionCard>
      </div>

      {/* Main Existing Codes Table */}
      <SectionCard title="Existing Priority Codes on Server" count={rows.length}>
        {rows.length === 0 ? (
          <div className="csv-empty-table-state">No data loaded yet. Click GET.</div>
        ) : (
          <div className="csv-table-wrapper">
            <table className="csv-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>ID</th>
                  <th>Code</th>
                  <th>Description</th>
                  <th>Default</th>
                  <th>Dealer ID</th>
                  <th>Status</th>
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
                      className={isValid ? "csv-tr-valid" : "csv-tr-invalid"}
                    >
                      <td>{index + 1}</td>
                      <td className="csv-td-mono">{normalizeText(row.id) || "—"}</td>
                      <td className="csv-td-mono">{code || "—"}</td>
                      <td>{getRecordDescription(row) || "—"}</td>
                      <td>{getRecordIsDefault(row) ? "Yes" : "No"}</td>
                      <td>{normalizeText(row.dealerId) || "—"}</td>
                      <td>
                        <span
                          className={`csv-table-status-pill ${
                            isValid ? "csv-table-status-valid" : "csv-table-status-invalid"
                          }`}
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
          <div className="csv-bottom-summary">
            <div>
              <b className="csv-summary-bold">All required codes present:</b>{" "}
              {allRequiredPresent ? "Yes" : "No"}
            </div>
            <div>
              <b className="csv-summary-bold">Has invalid codes:</b>{" "}
              {hasInvalidCodes ? "Yes" : "No"}
            </div>
            <div>
              <b className="csv-summary-bold">Expected final state:</b> Only included list codes
              should remain valid.
            </div>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
};

const SectionCard: React.FC<{
  title: string;
  count?: number;
  children: React.ReactNode;
}> = ({ title, count, children }) => {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div className="csv-section-card">
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="csv-section-header"
        style={{ marginBottom: isExpanded ? 12 : 0 }}
      >
        <div className="csv-section-title">
          {title} {count !== undefined && <span className="csv-count-badge">({count})</span>}
        </div>
        <button
          type="button"
          className="csv-section-toggle"
          title={isExpanded ? "Collapse section" : "Expand section"}
        >
          {isExpanded ? "▲" : "▼"}
        </button>
      </div>
      {isExpanded && <div className="csv-section-content">{children}</div>}
    </div>
  );
};

const RowLine: React.FC<{
  left: React.ReactNode;
  right: string;
  rightColor?: string;
}> = ({ left, right, rightColor = "#cbd5e1" }) => {
  return (
    <div className="csv-row-line">
      <div className="csv-row-left">{left}</div>
      <div className="csv-row-right" style={{ color: rightColor }}>
        {right}
      </div>
    </div>
  );
};

const EmptyText: React.FC<{ text: string }> = ({ text }) => {
  return <div className="csv-empty-text">{text}</div>;
};

export default CodeSetupView;