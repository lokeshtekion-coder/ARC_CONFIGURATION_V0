import React, { useEffect, useMemo, useState } from "react";
import { loadTekionApiSettingsBundle } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";

const MODULE_NAME = "Price Break Formulas";
const PRICE_FORMULA_URL =
  "https://preprodapp.tekioncloud.com/api/parts/proxy/u/settings/price-formula";

const VARIABLE_TYPES = ["cost", "list", "trade", "comp", "warranty"] as const;
const OPERATORS = ["add", "subtract"] as const;

const logger = {
  debug: (...args: unknown[]) => console.debug("[Parts][PriceBreakFormulas]", ...args),
  info: (...args: unknown[]) => console.info("[Parts][PriceBreakFormulas]", ...args),
  warn: (...args: unknown[]) => console.warn("[Parts][PriceBreakFormulas]", ...args),
  error: (...args: unknown[]) => console.error("[Parts][PriceBreakFormulas]", ...args),
};

type RunState = "idle" | "loading" | "success" | "error" | "warning";
type VariableType = (typeof VARIABLE_TYPES)[number];
type OperatorType = (typeof OPERATORS)[number];
type PopupType = "endAmounts" | "values" | "preview" | "info" | null;

interface PreviewRow {
  startAmount: string;
  endAmount: string;
  variableType: VariableType;
  operator: OperatorType;
  value: number;
}

interface PriceBreakExpressionPayload {
  variableType: VariableType;
  operator: OperatorType;
  value: number;
  valueType: "percentage";
}

interface PriceBreakItemPayload {
  startAmount: number;
  endAmount: number | string;
  expression: PriceBreakExpressionPayload;
}

interface PriceFormulaPayload {
  baseVariableType: VariableType;
  priceBreaks: PriceBreakItemPayload[];
  name: string;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function capitalize(value: string): string {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
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

function parseCommaSeparatedNumbers(
  rawValue: string,
  options?: { allowEmptyAsZero?: boolean }
): { success: true; values: number[] } | { success: false; error: string } {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { success: false, error: "Input cannot be empty" };
  }
  const parts = rawValue.split(",");
  const parsed: number[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const item = parts[index].trim();
    if (item === "") {
      if (options?.allowEmptyAsZero) {
        parsed.push(0);
        continue;
      }
      return {
        success: false,
        error: `Value ${index + 1} is empty`,
      };
    }
    const num = Number(item);
    if (!Number.isFinite(num)) {
      return {
        success: false,
        error: `Value ${index + 1} is not a valid number: ${item}`,
      };
    }
    parsed.push(num);
  }
  return { success: true, values: parsed };
}

function validateEndAmounts(values: number[]): { success: true } | { success: false; error: string } {
  if (values.length === 0) {
    return { success: false, error: "At least one end amount is required" };
  }
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value <= 0) {
      return {
        success: false,
        error: `End amount ${index + 1} must be greater than 0`,
      };
    }
    if (index > 0 && value <= values[index - 1]) {
      return {
        success: false,
        error: `End amount ${index + 1} must be greater than previous value`,
      };
    }
  }
  return { success: true };
}

function buildPreviewRows(
  endAmounts: number[],
  values: number[],
  variableType: VariableType,
  operator: OperatorType
): PreviewRow[] {
  if (endAmounts.length === 0) return [];
  const rows: PreviewRow[] = [];
  let previousEnd = 0.01;
  for (let index = 0; index < endAmounts.length; index += 1) {
    const startAmount = (index === 0 ? 0.01 : previousEnd + 0.01).toFixed(2);
    const endAmount = endAmounts[index].toFixed(2);
    const value = values[index] ?? 0;
    rows.push({
      startAmount,
      endAmount,
      variableType,
      operator,
      value,
    });
    previousEnd = endAmounts[index];
  }
  const finalStartAmount = (previousEnd + 0.01).toFixed(2);
  const finalValue = values[endAmounts.length] ?? 0;
  rows.push({
    startAmount: finalStartAmount,
    endAmount: "999999999.00",
    variableType,
    operator,
    value: finalValue,
  });
  return rows;
}

function buildPayload(
  name: string,
  baseVariableType: VariableType,
  previewRows: PreviewRow[]
): PriceFormulaPayload {
  const payload: PriceFormulaPayload = {
    name,
    baseVariableType,
    priceBreaks: previewRows.map((row) => ({
      startAmount: Number(row.startAmount),
      endAmount: row.endAmount === "999999999.00" ? "999999999.00" : Number(row.endAmount),
      expression: {
        variableType: row.variableType,
        operator: row.operator,
        value: row.value,
        valueType: "percentage",
      },
    })),
  };
  logger.debug("built price formula payload", payload);
  return payload;
}

async function submitPriceFormula(
  payload: PriceFormulaPayload,
  headers: Record<string, string>
): Promise<unknown> {
  const requestHeaders: Record<string, string> = { ...headers };
  delete requestHeaders["Content-Type"];
  delete requestHeaders["content-type"];
  delete requestHeaders["CONTENT-TYPE"];
  requestHeaders["content-type"] = "application/json";
  logger.info("POST price formula started", {
    url: PRICE_FORMULA_URL,
    name: payload.name,
    baseVariableType: payload.baseVariableType,
    priceBreakCount: payload.priceBreaks.length,
    headerKeys: Object.keys(requestHeaders),
    payloadSize: JSON.stringify(payload).length,
  });
  const response = await fetch(PRICE_FORMULA_URL, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(payload),
  });
  logger.info("POST price formula response", {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  });
  if (!response.ok) {
    const text = await response.text();
    logger.error("POST price formula failed", {
      status: response.status,
      body: text,
    });
    throw new Error(`HTTP ${response.status}: ${text.substring(0, 300)}`);
  }
  const json = await response.json();
  logger.debug("POST price formula success json", json);
  return json;
}

export const PriceBreakFormulasView: React.FC = () => {
  const [formulaName, setFormulaName] = useState("");
  const [baseVariableType, setBaseVariableType] = useState<VariableType>("cost");
  const [globalVariableType, setGlobalVariableType] = useState<VariableType>("cost");
  const [globalOperator, setGlobalOperator] = useState<OperatorType>("add");
  const [endAmounts, setEndAmounts] = useState<number[]>([]);
  const [values, setValues] = useState<number[]>([]);
  const [popupType, setPopupType] = useState<PopupType>(null);
  const [popupInput, setPopupInput] = useState("");
  const [popupError, setPopupError] = useState("");
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready to create price break formula");
  const [errorText, setErrorText] = useState("");
  const [lastRunAt, setLastRunAt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    logger.info("component mounted");
    logger.info("variable types loaded", VARIABLE_TYPES);
    logger.info("operators loaded", OPERATORS);
    return () => {
      logger.info("component unmounted");
    };
  }, []);

  useEffect(() => {
    logger.info("formula name changed", { formulaName });
  }, [formulaName]);

  useEffect(() => {
    logger.info("base variable type changed", { baseVariableType });
  }, [baseVariableType]);

  useEffect(() => {
    logger.info("global variable type changed", { globalVariableType });
  }, [globalVariableType]);

  useEffect(() => {
    logger.info("global operator changed", { globalOperator });
  }, [globalOperator]);

  useEffect(() => {
    logger.info("end amounts changed", { endAmounts });
  }, [endAmounts]);

  useEffect(() => {
    logger.info("values changed", { values });
  }, [values]);

  const previewRows = useMemo(() => {
    const rows = buildPreviewRows(endAmounts, values, globalVariableType, globalOperator);
    logger.debug("preview rows recalculated", rows);
    return rows;
  }, [endAmounts, values, globalVariableType, globalOperator]);

  const isReadyToSubmit = useMemo(() => {
    const ready = normalizeText(formulaName).length > 0 && endAmounts.length > 0 && values.length > 0;
    logger.debug("submit readiness recalculated", {
      ready,
      formulaName: normalizeText(formulaName),
      endAmountsCount: endAmounts.length,
      valuesCount: values.length,
    });
    return ready;
  }, [formulaName, endAmounts.length, values.length]);

  const popupMeta = useMemo(() => {
    if (popupType === "endAmounts") {
      return {
        title: "Configure End Amounts",
        label: "Enter comma-separated end amounts",
        placeholder: "e.g. 0.75, 1.00, 5.00",
        hint:
          "Define price break thresholds. An infinity tier will be automatically added after your last value.",
      };
    }
    if (popupType === "values") {
      return {
        title: "Configure Values",
        label: "Enter comma-separated percentage values",
        placeholder: "e.g. 300, 275, 250, 0",
        hint:
          "Each value is the percentage markup for the corresponding price break. If fewer values are entered, missing ones will auto-fill with 0 during submit.",
      };
    }
    if (popupType === "preview") {
      return {
        title: "Price Breaks Preview",
        label: "",
        placeholder: "",
        hint: "",
      };
    }
    if (popupType === "info") {
      return {
        title: "Configuration & API Info",
        label: "",
        placeholder: "",
        hint: "",
      };
    }
    return null;
  }, [popupType]);

  const openConfigPopup = (type: Exclude<PopupType, null>) => {
    logger.info("open config popup clicked", { type });
    setPopupType(type);
    setPopupError("");
    if (type === "endAmounts") {
      setPopupInput(endAmounts.join(", "));
    } else if (type === "values") {
      setPopupInput(values.join(", "));
    } else {
      setPopupInput("");
    }
  };

  const closePopup = () => {
    logger.info("close popup clicked", { popupType });
    setPopupType(null);
    setPopupInput("");
    setPopupError("");
  };

  const savePopupConfig = () => {
    logger.info("save popup config clicked", {
      popupType,
      popupInput,
    });
    if (!popupType) {
      logger.warn("save popup ignored because popupType is null");
      return;
    }
    if (popupType === "endAmounts") {
      const parsed = parseCommaSeparatedNumbers(popupInput);
      if (!parsed.success) {
        logger.warn("end amounts parse failed", parsed.error);
        setPopupError(parsed.error);
        return;
      }
      const validation = validateEndAmounts(parsed.values);
      if (!validation.success) {
        logger.warn("end amounts validation failed", validation.error);
        setPopupError(validation.error);
        return;
      }
      setEndAmounts(parsed.values);
      if (values.length < parsed.values.length + 1) {
        const nextValues = [...values];
        while (nextValues.length < parsed.values.length + 1) {
          nextValues.push(0);
        }
        logger.info("auto-filled values after end amounts save", { nextValues });
        setValues(nextValues);
      }
      logger.info("end amounts saved successfully", {
        savedEndAmounts: parsed.values,
        totalTiers: parsed.values.length + 1,
      });
      closePopup();
      return;
    }
    if (popupType === "values") {
      const parsed = parseCommaSeparatedNumbers(popupInput, { allowEmptyAsZero: true });
      if (!parsed.success) {
        logger.warn("values parse failed", parsed.error);
        setPopupError(parsed.error);
        return;
      }
      setValues(parsed.values);
      logger.info("values saved successfully", { savedValues: parsed.values });
      closePopup();
      return;
    }
    // "preview" and "info" modals don't have a save action
  };

  const handleSubmit = async (): Promise<void> => {
    logger.info("submit price formula clicked", {
      formulaName,
      baseVariableType,
      globalVariableType,
      globalOperator,
      endAmounts,
      values,
    });
    if (isSubmitting) {
      logger.warn("submit ignored because request already in progress");
      return;
    }
    if (!normalizeText(formulaName)) {
      logger.warn("submit blocked because formula name is missing");
      setRunState("warning");
      setStatusText("Please enter a formula name");
      setErrorText("");
      return;
    }
    if (endAmounts.length === 0) {
      logger.warn("submit blocked because end amounts are missing");
      setRunState("warning");
      setStatusText("Please configure end amounts first");
      setErrorText("");
      return;
    }
    if (previewRows.length === 0) {
      logger.warn("submit blocked because preview rows are empty");
      setRunState("warning");
      setStatusText("Please complete price break configuration first");
      setErrorText("");
      return;
    }
    setIsSubmitting(true);
    setRunState("loading");
    setStatusText(`Creating price formula "${normalizeText(formulaName)}"...`);
    setErrorText("");
    try {
      const headers = getEnabledGlobalHeaders();
      if (Object.keys(headers).length === 0) {
        logger.warn("global headers missing before submit");
        setRunState("error");
        setStatusText("Global headers are missing");
        setErrorText(
          "No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers."
        );
        return;
      }
      const payload = buildPayload(normalizeText(formulaName), baseVariableType, previewRows);
      await submitPriceFormula(payload, headers);
      setRunState("success");
      setStatusText(`Price formula "${normalizeText(formulaName)}" created successfully`);
      setErrorText("");
      setLastRunAt(new Date().toLocaleString());
      logger.info("submit succeeded, resetting form");
      setFormulaName("");
      setBaseVariableType("cost");
      setGlobalVariableType("cost");
      setGlobalOperator("add");
      setEndAmounts([]);
      setValues([]);
      setPopupType(null);
      setPopupInput("");
      setPopupError("");
    } catch (error: unknown) {
      logger.error("submit failed", error);
      setRunState("error");
      setStatusText("Failed to create price formula");
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
          <div style={{ minWidth: 0, flex: "1 1 200px" }}>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: "#f8fafc",
                marginBottom: 6,
                wordBreak: "break-word",
              }}
            >
              Price break formulas
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
              Create tiered price formulas with custom breakpoints and percentage expressions using active Global Headers from Settings.
            </div>
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={() => openConfigPopup("info")}
              style={{
                width: 36,
                height: 36,
                display: "grid",
                placeItems: "center",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 8,
                color: "#8A8F98",
                fontSize: 16,
                cursor: "pointer",
              }}
              title="View Information"
            >
              ℹ️
            </button>
            <button
              type="button"
              onClick={() => openConfigPopup("preview")}
              disabled={previewRows.length === 0}
              style={{
                padding: "0 16px",
                height: 36,
                background: "rgba(0,184,204,0.10)",
                border: "1px solid rgba(0,184,204,0.28)",
                borderRadius: 8,
                color: "#67e8f9",
                fontSize: 13,
                fontWeight: 700,
                cursor: previewRows.length === 0 ? "not-allowed" : "pointer",
                opacity: previewRows.length === 0 ? 0.5 : 1,
              }}
            >
              Preview
            </button>
            <button
              className="btn-postman"
              type="button"
              onClick={() => {
                void handleSubmit();
              }}
              disabled={!isReadyToSubmit || isSubmitting}
            >
              {isSubmitting ? "Creating..." : "Submit Price Formula"}
            </button>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div>
            <div style={labelStyle}>Formula Name</div>
            <input
              className="st-input"
              type="text"
              value={formulaName}
              onChange={(e) => {
                logger.debug("formula name input changed", { value: e.target.value });
                setFormulaName(e.target.value);
              }}
              placeholder="e.g. Matrix"
              style={inputStyle}
            />
          </div>
          <div>
            <div style={labelStyle}>Base Variable Type</div>
            <select
              className="st-input"
              value={baseVariableType}
              onChange={(e) => {
                const nextValue = e.target.value as VariableType;
                logger.info("base variable type select changed", { value: nextValue });
                setBaseVariableType(nextValue);
              }}
              style={inputStyle}
            >
              {VARIABLE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {capitalize(type)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              color: "#f8fafc",
              fontSize: 16,
              fontWeight: 800,
              marginBottom: 12,
            }}
          >
            Global Configuration
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 16,
            }}
          >
            <div>
              <div style={smallLabelStyle}>Variable Type</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {VARIABLE_TYPES.map((type) => {
                  const isActive = globalVariableType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        logger.info("global variable type button clicked", { type });
                        setGlobalVariableType(type);
                      }}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 9999,
                        border: isActive
                          ? "1px solid rgba(0,184,204,0.55)"
                          : "1px solid rgba(255,255,255,0.10)",
                        background: isActive
                          ? "rgba(0,184,204,0.14)"
                          : "rgba(255,255,255,0.03)",
                        color: isActive ? "#67e8f9" : "#d0d6e0",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {capitalize(type)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <div style={smallLabelStyle}>Operator</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {OPERATORS.map((operator) => {
                  const isActive = globalOperator === operator;
                  return (
                    <button
                      key={operator}
                      type="button"
                      onClick={() => {
                        logger.info("global operator button clicked", { operator });
                        setGlobalOperator(operator);
                      }}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 9999,
                        border: isActive
                          ? "1px solid rgba(0,184,204,0.55)"
                          : "1px solid rgba(255,255,255,0.10)",
                        background: isActive
                          ? "rgba(0,184,204,0.14)"
                          : "rgba(255,255,255,0.03)",
                        color: isActive ? "#67e8f9" : "#d0d6e0",
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {operator === "add" ? "+ Add" : "- Subtract"}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 12,
            marginBottom: 16,
          }}
        >
          <ConfigCard
            title="Configure End Amounts"
            subtitle="Define price break thresholds"
            icon="📊"
            buttonLabel="Configure"
            statusText={
              endAmounts.length > 0
                ? `✓ ${endAmounts.length + 1} tier${endAmounts.length + 1 === 1 ? "" : "s"} (${endAmounts.length} + ∞)`
                : "Not configured"
            }
            statusColor={endAmounts.length > 0 ? "#27A644" : "#62666D"}
            onClick={() => openConfigPopup("endAmounts")}
          />
          <ConfigCard
            title="Configure Values"
            subtitle="Set markup percentages for each tier"
            icon="💰"
            buttonLabel="Configure"
            statusText={
              values.length > 0
                ? `✓ ${values.length} value${values.length === 1 ? "" : "s"}`
                : "Not configured"
            }
            statusColor={values.length > 0 ? "#27A644" : "#62666D"}
            onClick={() => openConfigPopup("values")}
          />
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
          <Pill label="End Amounts" value={String(endAmounts.length)} />
          <Pill label="Values" value={String(values.length)} />
          <Pill label="Preview Tiers" value={String(previewRows.length)} />
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

      {popupType && popupMeta ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="price-break-popup-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(8px)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              logger.info("popup backdrop clicked");
              closePopup();
            }
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: popupType === "preview" ? 840 : 560,
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "#0F1011",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                padding: 16,
                borderBottom: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div
                id="price-break-popup-title"
                style={{
                  margin: 0,
                  color: "#F7F8F8",
                  fontSize: 18,
                  fontWeight: 700,
                }}
              >
                {popupMeta.title}
              </div>
              <button
                type="button"
                onClick={() => {
                  logger.info("popup close button clicked");
                  closePopup();
                }}
                style={{
                  width: 32,
                  height: 32,
                  display: "grid",
                  placeItems: "center",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 8,
                  color: "#8A8F98",
                  fontSize: 18,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: 16 }}>
              {(popupType === "endAmounts" || popupType === "values") && (
                <>
                  <div
                    style={{
                      display: "block",
                      marginBottom: 8,
                      color: "#D0D6E0",
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    {popupMeta.label}
                  </div>
                  <textarea
                    className="st-input"
                    rows={4}
                    value={popupInput}
                    onChange={(e) => {
                      logger.debug("popup input changed", {
                        popupType,
                        value: e.target.value,
                      });
                      setPopupInput(e.target.value);
                    }}
                    placeholder={popupMeta.placeholder}
                    style={{
                      ...textareaStyle,
                      minHeight: 120,
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    }}
                  />
                  <div
                    style={{
                      marginTop: 10,
                      color: "#62666D",
                      fontSize: 12,
                      lineHeight: 1.5,
                    }}
                  >
                    {popupMeta.hint}
                  </div>
                  {popupError ? (
                    <div
                      style={{
                        marginTop: 12,
                        borderRadius: 12,
                        border: "1px solid rgba(239,68,68,0.25)",
                        background: "rgba(239,68,68,0.10)",
                        color: "#fecaca",
                        padding: "10px 12px",
                        fontSize: 13,
                        lineHeight: 1.5,
                      }}
                    >
                      {popupError}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      logger.info("popup save button clicked");
                      savePopupConfig();
                    }}
                    style={{
                      width: "100%",
                      marginTop: 16,
                      padding: "10px 16px",
                      background: "linear-gradient(135deg, #00B8CC 0%, #00D4E8 100%)",
                      border: "none",
                      borderRadius: 9999,
                      color: "#FFFFFF",
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Save Configuration
                  </button>
                </>
              )}

              {popupType === "preview" && (
                <div
                  style={{
                    maxHeight: "65vh",
                    overflowY: "auto",
                    overflowX: "auto",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      minWidth: 500,
                    }}
                  >
                    <thead>
                      <tr style={{ background: "rgba(255,255,255,0.04)", position: "sticky", top: 0, zIndex: 1 }}>
                        <th style={thStyle}>#</th>
                        <th style={thStyle}>Range</th>
                        <th style={thStyle}>Expression</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, index) => {
                        const isInfinity = row.endAmount === "999999999.00";
                        const operatorSymbol = row.operator === "add" ? "+" : "-";
                        const operatorColor = row.operator === "add" ? "#27A644" : "#EB5757";
                        return (
                          <tr
                            key={`${row.startAmount}-${row.endAmount}-${index}`}
                            style={{
                              borderTop: "1px solid rgba(255,255,255,0.08)",
                            }}
                          >
                            <td style={tdMonoStyle}>{index + 1}</td>
                            <td style={tdStyle}>
                              <code style={codePillStyle}>${row.startAmount}</code>
                              <span style={{ color: "#62666D", margin: "0 6px" }}>—</span>
                              <code style={codePillStyle}>{isInfinity ? "∞" : `$${row.endAmount}`}</code>
                            </td>
                            <td style={tdStyle}>
                              <span style={softPillStyle}>{capitalize(row.variableType)}</span>
                              <span
                                style={{
                                  color: operatorColor,
                                  fontFamily:
                                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                  fontSize: 12,
                                  margin: "0 6px",
                                  fontWeight: 700,
                                }}
                              >
                                {operatorSymbol}
                              </span>
                              <span
                                style={{
                                  color: "#f8fafc",
                                  fontFamily:
                                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                  fontSize: 13,
                                  fontWeight: 700,
                                }}
                              >
                                {row.value}%
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {popupType === "info" && (
                <div style={{ display: "grid", gap: 16, maxHeight: "65vh", overflowY: "auto" }}>
                  <SectionCard title="Current Configuration Snapshot">
                    <RowLine left="Formula Name" right={normalizeText(formulaName) || "—"} />
                    <RowLine left="Base Variable Type" right={capitalize(baseVariableType)} />
                    <RowLine left="Global Variable Type" right={capitalize(globalVariableType)} />
                    <RowLine left="Operator" right={globalOperator === "add" ? "Add" : "Subtract"} />
                    <RowLine left="End Amounts" right={endAmounts.length ? endAmounts.join(", ") : "—"} />
                    <RowLine left="Values" right={values.length ? values.join(", ") : "—"} />
                  </SectionCard>
                  <SectionCard title="Write API Info">
                    <RowLine left="Method" right="POST" rightColor="#86efac" />
                    <RowLine left="Endpoint" right={PRICE_FORMULA_URL} />
                    <RowLine left="GET Available?" right="Not required for current implementation" />
                    <RowLine left="PUT Available?" right="Not required for current implementation" />
                  </SectionCard>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 6,
};
const smallLabelStyle: React.CSSProperties = {
  color: "#8A8F98",
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 6,
  textTransform: "uppercase",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 40,
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 13,
  boxSizing: "border-box",
};
const textareaStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 12,
  padding: "12px 14px",
  fontSize: 13,
  boxSizing: "border-box",
  resize: "vertical",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
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
const codePillStyle: React.CSSProperties = {
  color: "#00B8CC",
  background: "rgba(0,184,204,.12)",
  padding: "3px 6px",
  borderRadius: 6,
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};
const softPillStyle: React.CSSProperties = {
  padding: "2px 8px",
  background: "rgba(255,255,255,.05)",
  borderRadius: 9999,
  color: "#D0D6E0",
  fontSize: 12,
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
const ConfigCard: React.FC<{
  title: string;
  subtitle: string;
  icon: string;
  buttonLabel: string;
  statusText: string;
  statusColor: string;
  onClick: () => void;
}> = ({ title, subtitle, icon, buttonLabel, statusText, statusColor, onClick }) => {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 16,
        padding: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            flexShrink: 0,
            width: 36,
            height: 36,
            display: "grid",
            placeItems: "center",
            background: "rgba(0,184,204,0.12)",
            borderRadius: 10,
            fontSize: 18,
          }}
        >
          {icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              margin: "0 0 4px 0",
              color: "#F7F8F8",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {title}
          </div>
          <div
            style={{
              margin: 0,
              color: "#8A8F98",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            {subtitle}
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        style={{
          width: "100%",
          padding: "8px 12px",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 8,
          color: "#00B8CC",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          marginBottom: 8,
        }}
      >
        {buttonLabel}
      </button>
      <div
        style={{
          color: statusColor,
          fontSize: 12,
          fontWeight: 700,
          textAlign: "center",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        }}
      >
        {statusText}
      </div>
    </div>
  );
};