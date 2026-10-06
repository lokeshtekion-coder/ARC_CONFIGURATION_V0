import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { loadTekionApiSettingsBundle } from "../../../services/tekionApiSettings";
const MODULE_NAME = "Price Break Formulas";
const PRICE_FORMULA_URL = "https://preprodapp.tekioncloud.com/api/parts/proxy/u/settings/price-formula";
const VARIABLE_TYPES = ["cost", "list", "trade", "comp", "warranty"];
const OPERATORS = ["add", "subtract"];
const logger = {
    debug: (...args) => console.debug("[Parts][PriceBreakFormulas]", ...args),
    info: (...args) => console.info("[Parts][PriceBreakFormulas]", ...args),
    warn: (...args) => console.warn("[Parts][PriceBreakFormulas]", ...args),
    error: (...args) => console.error("[Parts][PriceBreakFormulas]", ...args),
};
function normalizeText(value) {
    return String(value ?? "").trim();
}
function capitalize(value) {
    if (!value)
        return "";
    return value.charAt(0).toUpperCase() + value.slice(1);
}
function getEnabledGlobalHeaders() {
    const bundle = loadTekionApiSettingsBundle();
    const headers = (bundle.globalHeaders ?? [])
        .filter((header) => header.enabled &&
        header.key.trim() &&
        String(header.value).trim())
        .reduce((acc, header) => {
        acc[header.key] = String(header.value);
        return acc;
    }, {});
    logger.info("loaded global headers from settings", {
        count: Object.keys(headers).length,
        keys: Object.keys(headers),
    });
    return headers;
}
function parseCommaSeparatedNumbers(rawValue, options) {
    const trimmed = rawValue.trim();
    if (!trimmed) {
        return { success: false, error: "Input cannot be empty" };
    }
    const parts = rawValue.split(",");
    const parsed = [];
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
function validateEndAmounts(values) {
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
function buildPreviewRows(endAmounts, values, defaultVariableType, defaultOperator, existingRows) {
    if (endAmounts.length === 0)
        return [];
    const rows = [];
    let previousEnd = 0.01;
    for (let index = 0; index < endAmounts.length; index += 1) {
        const startAmount = (index === 0 ? 0.01 : previousEnd + 0.01).toFixed(2);
        const endAmount = endAmounts[index].toFixed(2);
        const existing = existingRows?.[index];
        rows.push({
            startAmount,
            endAmount,
            variableType: existing ? existing.variableType : defaultVariableType,
            operator: existing ? existing.operator : defaultOperator,
            value: values[index] ?? (existing ? existing.value : 0),
        });
        previousEnd = endAmounts[index];
    }
    const finalStartAmount = (previousEnd + 0.01).toFixed(2);
    const finalExisting = existingRows?.[endAmounts.length];
    rows.push({
        startAmount: finalStartAmount,
        endAmount: "999999999.00",
        variableType: finalExisting ? finalExisting.variableType : defaultVariableType,
        operator: finalExisting ? finalExisting.operator : defaultOperator,
        value: values[endAmounts.length] ?? (finalExisting ? finalExisting.value : 0),
    });
    return rows;
}
function buildPayload(name, baseVariableType, previewRows) {
    const payload = {
        name,
        baseVariableType,
        priceBreaks: previewRows.map((row) => ({
            startAmount: Number(row.startAmount) || 0,
            endAmount: row.endAmount === "999999999.00" ||
                row.endAmount === "999999999" ||
                row.endAmount === "∞"
                ? "999999999.00"
                : Number(row.endAmount) || 0,
            expression: {
                variableType: row.variableType,
                operator: row.operator,
                value: Number(row.value) || 0,
                valueType: "percentage",
            },
        })),
    };
    logger.debug("built price formula payload", payload);
    return payload;
}
async function submitPriceFormula(payload, headers) {
    const requestHeaders = { ...headers };
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
export const PriceBreakFormulasView = () => {
    const [formulaName, setFormulaName] = useState("");
    const [baseVariableType, setBaseVariableType] = useState("cost");
    const [globalVariableType, setGlobalVariableType] = useState("cost");
    const [globalOperator, setGlobalOperator] = useState("add");
    const [endAmounts, setEndAmounts] = useState([]);
    const [values, setValues] = useState([]);
    const [previewRows, setPreviewRows] = useState([]);
    const [popupType, setPopupType] = useState(null);
    const [popupInput, setPopupInput] = useState("");
    const [popupError, setPopupError] = useState("");
    const [runState, setRunState] = useState("idle");
    const [statusText, setStatusText] = useState("Ready to create price break formula");
    const [errorText, setErrorText] = useState("");
    const [lastRunAt, setLastRunAt] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    useEffect(() => {
        logger.info("component mounted");
        return () => {
            logger.info("component unmounted");
        };
    }, []);
    const syncOutsideFromRows = (rows) => {
        const ends = [];
        for (let i = 0; i < rows.length; i += 1) {
            const isLast = i === rows.length - 1;
            const isInf = rows[i].endAmount === "999999999.00" ||
                rows[i].endAmount === "999999999" ||
                rows[i].endAmount === "∞";
            if (!isLast || !isInf) {
                const parsed = parseFloat(rows[i].endAmount);
                if (Number.isFinite(parsed) && parsed > 0) {
                    ends.push(parsed);
                }
            }
        }
        const vals = rows.map((r) => Number(r.value) || 0);
        setEndAmounts(ends);
        setValues(vals);
    };
    const isReadyToSubmit = useMemo(() => {
        return normalizeText(formulaName).length > 0 && previewRows.length > 0;
    }, [formulaName, previewRows.length]);
    const popupMeta = useMemo(() => {
        if (popupType === "endAmounts") {
            return {
                title: "Configure End Amounts",
                label: "Enter comma-separated end amounts",
                placeholder: "e.g. 0.75, 1.00, 5.00",
                hint: "Define price break thresholds. An infinity tier will be automatically added after your last value.",
            };
        }
        if (popupType === "values") {
            return {
                title: "Configure Values",
                label: "Enter comma-separated percentage values",
                placeholder: "e.g. 300, 275, 250, 0",
                hint: "Each value is the percentage markup for the corresponding price break. If fewer values are entered, missing ones will auto-fill with 0 during submit.",
            };
        }
        if (popupType === "preview") {
            return {
                title: "Price Breaks Preview & Fine Tuning",
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
    const openConfigPopup = (type) => {
        logger.info("open config popup clicked", { type });
        setPopupType(type);
        setPopupError("");
        if (type === "endAmounts") {
            setPopupInput(endAmounts.join(", "));
        }
        else if (type === "values") {
            setPopupInput(values.join(", "));
        }
        else {
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
        if (!popupType)
            return;
        if (popupType === "endAmounts") {
            const parsed = parseCommaSeparatedNumbers(popupInput);
            if (!parsed.success) {
                setPopupError(parsed.error);
                return;
            }
            const validation = validateEndAmounts(parsed.values);
            if (!validation.success) {
                setPopupError(validation.error);
                return;
            }
            setEndAmounts(parsed.values);
            let nextValues = [...values];
            if (nextValues.length < parsed.values.length + 1) {
                while (nextValues.length < parsed.values.length + 1) {
                    nextValues.push(0);
                }
                setValues(nextValues);
            }
            const rows = buildPreviewRows(parsed.values, nextValues, globalVariableType, globalOperator, previewRows);
            setPreviewRows(rows);
            closePopup();
            return;
        }
        if (popupType === "values") {
            const parsed = parseCommaSeparatedNumbers(popupInput, { allowEmptyAsZero: true });
            if (!parsed.success) {
                setPopupError(parsed.error);
                return;
            }
            let nextValues = [...parsed.values];
            if (endAmounts.length > 0 && nextValues.length < endAmounts.length + 1) {
                while (nextValues.length < endAmounts.length + 1) {
                    nextValues.push(0);
                }
            }
            setValues(nextValues);
            const rows = buildPreviewRows(endAmounts, nextValues, globalVariableType, globalOperator, previewRows);
            setPreviewRows(rows);
            closePopup();
            return;
        }
    };
    const handleGlobalVariableTypeChange = (type) => {
        setGlobalVariableType(type);
        setPreviewRows((prev) => prev.map((r) => ({ ...r, variableType: type })));
    };
    const handleGlobalOperatorChange = (op) => {
        setGlobalOperator(op);
        setPreviewRows((prev) => prev.map((r) => ({ ...r, operator: op })));
    };
    const handleUpdatePreviewRow = (index, field, newValue) => {
        setPreviewRows((prev) => {
            const updated = prev.map((r) => ({ ...r }));
            updated[index] = { ...updated[index], [field]: newValue };
            if (field === "endAmount" && index + 1 < updated.length) {
                const valStr = String(newValue).trim();
                const parsedEnd = parseFloat(valStr);
                if (Number.isFinite(parsedEnd) &&
                    parsedEnd > 0 &&
                    valStr !== "999999999.00" &&
                    valStr !== "999999999" &&
                    valStr !== "∞") {
                    const nextStart = (Math.round((parsedEnd + 0.01) * 100) / 100).toFixed(2);
                    updated[index + 1] = {
                        ...updated[index + 1],
                        startAmount: nextStart,
                    };
                }
            }
            syncOutsideFromRows(updated);
            return updated;
        });
    };
    const handleAddPreviewRow = () => {
        setPreviewRows((prev) => {
            const last = prev[prev.length - 1];
            let nextStart = "0.01";
            if (last) {
                const parsed = parseFloat(last.endAmount);
                if (!Number.isNaN(parsed) && last.endAmount !== "999999999.00") {
                    nextStart = (Math.round((parsed + 0.01) * 100) / 100).toFixed(2);
                }
            }
            const updated = [
                ...prev,
                {
                    startAmount: nextStart,
                    endAmount: "999999999.00",
                    variableType: globalVariableType,
                    operator: globalOperator,
                    value: 0,
                },
            ];
            syncOutsideFromRows(updated);
            return updated;
        });
    };
    const handleDeletePreviewRow = (index) => {
        setPreviewRows((prev) => {
            const updated = prev.filter((_, i) => i !== index);
            syncOutsideFromRows(updated);
            return updated;
        });
    };
    const handleResetPreview = () => {
        const rows = buildPreviewRows(endAmounts, values, globalVariableType, globalOperator);
        setPreviewRows(rows);
        syncOutsideFromRows(rows);
    };
    const handleSubmit = async () => {
        if (isSubmitting)
            return;
        if (!normalizeText(formulaName)) {
            setRunState("warning");
            setStatusText("Please enter a formula name");
            setErrorText("");
            return;
        }
        if (previewRows.length === 0) {
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
                setRunState("error");
                setStatusText("Global headers are missing");
                setErrorText("No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers.");
                return;
            }
            const payload = buildPayload(normalizeText(formulaName), baseVariableType, previewRows);
            await submitPriceFormula(payload, headers);
            setRunState("success");
            setStatusText(`Price formula "${normalizeText(formulaName)}" created successfully`);
            setErrorText("");
            setLastRunAt(new Date().toLocaleString());
            setFormulaName("");
            setBaseVariableType("cost");
            setGlobalVariableType("cost");
            setGlobalOperator("add");
            setEndAmounts([]);
            setValues([]);
            setPreviewRows([]);
            setPopupType(null);
            setPopupInput("");
            setPopupError("");
        }
        catch (error) {
            logger.error("submit failed", error);
            setRunState("error");
            setStatusText("Failed to create price formula");
            setErrorText(error instanceof Error ? error.message : String(error));
            setLastRunAt(new Date().toLocaleString());
        }
        finally {
            setIsSubmitting(false);
        }
    };
    return (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsxs("div", { style: {
                    borderRadius: 18,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 20,
                }, children: [_jsxs("div", { style: {
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: 12,
                            flexWrap: "wrap",
                            marginBottom: 14,
                        }, children: [_jsxs("div", { style: { minWidth: 0, flex: "1 1 200px" }, children: [_jsx("div", { style: {
                                            fontSize: 24,
                                            fontWeight: 800,
                                            color: "#f8fafc",
                                            marginBottom: 6,
                                            wordBreak: "break-word",
                                        }, children: "Price break formulas" }), _jsx("div", { style: {
                                            color: "#94a3b8",
                                            fontSize: 14,
                                            lineHeight: 1.7,
                                            whiteSpace: "pre-wrap",
                                            overflowWrap: "anywhere",
                                        }, children: "Create tiered price formulas with custom breakpoints and percentage expressions using active Global Headers from Settings." })] }), _jsxs("div", { style: {
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 12,
                                    flexWrap: "wrap",
                                }, children: [_jsx("button", { type: "button", onClick: () => openConfigPopup("info"), style: {
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
                                        }, title: "View Information", children: "\u2139\uFE0F" }), _jsxs("button", { type: "button", onClick: () => openConfigPopup("preview"), disabled: previewRows.length === 0, style: {
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
                                        }, children: ["Preview (", previewRows.length, ")"] }), _jsx("button", { className: "btn-postman", type: "button", onClick: () => {
                                            void handleSubmit();
                                        }, disabled: !isReadyToSubmit || isSubmitting, children: isSubmitting ? "Creating..." : "Submit Price Formula" })] })] }), _jsxs("div", { style: {
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                            gap: 12,
                            marginBottom: 16,
                        }, children: [_jsxs("div", { children: [_jsx("div", { style: labelStyle, children: "Formula Name" }), _jsx("input", { className: "st-input", type: "text", value: formulaName, onChange: (e) => {
                                            logger.debug("formula name input changed", { value: e.target.value });
                                            setFormulaName(e.target.value);
                                        }, placeholder: "e.g. Matrix", style: inputStyle })] }), _jsxs("div", { children: [_jsx("div", { style: labelStyle, children: "Base Variable Type" }), _jsx("select", { className: "st-input", value: baseVariableType, onChange: (e) => {
                                            const nextValue = e.target.value;
                                            logger.info("base variable type select changed", { value: nextValue });
                                            setBaseVariableType(nextValue);
                                        }, style: inputStyle, children: VARIABLE_TYPES.map((type) => (_jsx("option", { value: type, children: capitalize(type) }, type))) })] })] }), _jsxs("div", { style: {
                            borderRadius: 16,
                            border: "1px solid rgba(255,255,255,0.08)",
                            background: "rgba(255,255,255,0.02)",
                            padding: 16,
                            marginBottom: 16,
                        }, children: [_jsx("div", { style: {
                                    color: "#f8fafc",
                                    fontSize: 16,
                                    fontWeight: 800,
                                    marginBottom: 12,
                                }, children: "Global Configuration" }), _jsxs("div", { style: {
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                                    gap: 16,
                                }, children: [_jsxs("div", { children: [_jsx("div", { style: smallLabelStyle, children: "Variable Type" }), _jsx("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: VARIABLE_TYPES.map((type) => {
                                                    const isActive = globalVariableType === type;
                                                    return (_jsx("button", { type: "button", onClick: () => handleGlobalVariableTypeChange(type), style: {
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
                                                        }, children: capitalize(type) }, type));
                                                }) })] }), _jsxs("div", { children: [_jsx("div", { style: smallLabelStyle, children: "Operator" }), _jsx("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: OPERATORS.map((operator) => {
                                                    const isActive = globalOperator === operator;
                                                    return (_jsx("button", { type: "button", onClick: () => handleGlobalOperatorChange(operator), style: {
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
                                                        }, children: operator === "add" ? "+ Add" : "- Subtract" }, operator));
                                                }) })] })] })] }), _jsxs("div", { style: {
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                            gap: 12,
                            marginBottom: 16,
                        }, children: [_jsx(ConfigCard, { title: "Configure End Amounts", subtitle: "Define price break thresholds", icon: "\uD83D\uDCCA", buttonLabel: "Configure", statusText: endAmounts.length > 0
                                    ? `✓ ${endAmounts.length + 1} tier${endAmounts.length + 1 === 1 ? "" : "s"} (${endAmounts.length} + ∞)`
                                    : "Not configured", statusColor: endAmounts.length > 0 ? "#27A644" : "#62666D", onClick: () => openConfigPopup("endAmounts") }), _jsx(ConfigCard, { title: "Configure Values", subtitle: "Set markup percentages for each tier", icon: "\uD83D\uDCB0", buttonLabel: "Configure", statusText: values.length > 0
                                    ? `✓ ${values.length} value${values.length === 1 ? "" : "s"}`
                                    : "Not configured", statusColor: values.length > 0 ? "#27A644" : "#62666D", onClick: () => openConfigPopup("values") })] }), _jsxs("div", { style: {
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                            marginBottom: 14,
                        }, children: [_jsx(Pill, { label: "Module", value: MODULE_NAME }), _jsx(Pill, { label: "End Amounts", value: String(endAmounts.length) }), _jsx(Pill, { label: "Values", value: String(values.length) }), _jsx(Pill, { label: "Preview Tiers", value: String(previewRows.length) }), lastRunAt ? _jsx(Pill, { label: "Last Run", value: lastRunAt }) : null] }), _jsxs("div", { style: {
                            borderRadius: 14,
                            padding: "12px 14px",
                            fontSize: 13,
                            lineHeight: 1.6,
                            border: runState === "error"
                                ? "1px solid rgba(239,68,68,0.25)"
                                : runState === "success"
                                    ? "1px solid rgba(34,197,94,0.25)"
                                    : runState === "warning"
                                        ? "1px solid rgba(245,158,11,0.25)"
                                        : "1px solid rgba(255,255,255,0.08)",
                            background: runState === "error"
                                ? "rgba(239,68,68,0.10)"
                                : runState === "success"
                                    ? "rgba(34,197,94,0.10)"
                                    : runState === "warning"
                                        ? "rgba(245,158,11,0.10)"
                                        : "rgba(255,255,255,0.03)",
                            color: runState === "error"
                                ? "#fecaca"
                                : runState === "success"
                                    ? "#bbf7d0"
                                    : runState === "warning"
                                        ? "#fde68a"
                                        : "#cbd5e1",
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                        }, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: errorText ? 6 : 0 }, children: statusText }), errorText ? _jsx("div", { children: errorText }) : null] })] }), popupType && popupMeta ? (_jsx("div", { role: "dialog", "aria-modal": "true", "aria-labelledby": "price-break-popup-title", style: {
                    position: "fixed",
                    inset: 0,
                    background: "rgba(0,0,0,0.75)",
                    backdropFilter: "blur(8px)",
                    zIndex: 1000,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 16,
                }, onClick: (e) => {
                    if (e.target === e.currentTarget) {
                        logger.info("popup backdrop clicked");
                        closePopup();
                    }
                }, children: _jsxs("div", { style: {
                        width: popupType === "preview" ? "95vw" : "100%",
                        maxWidth: popupType === "preview" ? 1380 : popupType === "info" ? 760 : 640,
                        maxHeight: "94vh",
                        borderRadius: 16,
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "#0F1011",
                        boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
                        display: "flex",
                        flexDirection: "column",
                    }, children: [_jsxs("div", { style: {
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 12,
                                padding: "16px 20px",
                                borderBottom: "1px solid rgba(255,255,255,0.08)",
                            }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12 }, children: [_jsx("div", { id: "price-break-popup-title", style: {
                                                margin: 0,
                                                color: "#F7F8F8",
                                                fontSize: 18,
                                                fontWeight: 700,
                                            }, children: popupMeta.title }), popupType === "preview" && (_jsxs("span", { style: {
                                                padding: "2px 8px",
                                                borderRadius: 999,
                                                background: "rgba(0,184,204,0.15)",
                                                color: "#67e8f9",
                                                fontSize: 12,
                                                fontWeight: 700,
                                                border: "1px solid rgba(0,184,204,0.3)",
                                            }, children: [previewRows.length, " Tiers"] }))] }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [popupType === "preview" && (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: handleResetPreview, style: {
                                                        padding: "4px 10px",
                                                        background: "rgba(255,255,255,0.05)",
                                                        border: "1px solid rgba(255,255,255,0.15)",
                                                        borderRadius: 6,
                                                        color: "#cbd5e1",
                                                        fontSize: 12,
                                                        cursor: "pointer",
                                                    }, title: "Reset rows back to initial generator thresholds", children: "Reset" }), _jsx("button", { type: "button", onClick: handleAddPreviewRow, style: {
                                                        padding: "4px 10px",
                                                        background: "rgba(0,184,204,0.15)",
                                                        border: "1px solid rgba(0,184,204,0.3)",
                                                        borderRadius: 6,
                                                        color: "#67e8f9",
                                                        fontSize: 12,
                                                        fontWeight: 700,
                                                        cursor: "pointer",
                                                    }, children: "+ Add Tier" })] })), _jsx("button", { type: "button", onClick: () => {
                                                logger.info("popup close button clicked");
                                                closePopup();
                                            }, style: {
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
                                            }, children: "\u2715" })] })] }), _jsxs("div", { style: { padding: 20, overflowY: "auto" }, children: [(popupType === "endAmounts" || popupType === "values") && (_jsxs(_Fragment, { children: [_jsx("div", { style: {
                                                display: "block",
                                                marginBottom: 8,
                                                color: "#D0D6E0",
                                                fontSize: 14,
                                                fontWeight: 600,
                                            }, children: popupMeta.label }), _jsx("textarea", { className: "st-input", rows: 6, value: popupInput, onChange: (e) => {
                                                logger.debug("popup input changed", {
                                                    popupType,
                                                    value: e.target.value,
                                                });
                                                setPopupInput(e.target.value);
                                            }, placeholder: popupMeta.placeholder, style: {
                                                ...textareaStyle,
                                                minHeight: 140,
                                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                            } }), _jsx("div", { style: {
                                                marginTop: 10,
                                                color: "#62666D",
                                                fontSize: 12,
                                                lineHeight: 1.5,
                                            }, children: popupMeta.hint }), popupError ? (_jsx("div", { style: {
                                                marginTop: 12,
                                                borderRadius: 12,
                                                border: "1px solid rgba(239,68,68,0.25)",
                                                background: "rgba(239,68,68,0.10)",
                                                color: "#fecaca",
                                                padding: "10px 12px",
                                                fontSize: 13,
                                                lineHeight: 1.5,
                                            }, children: popupError })) : null, _jsx("button", { type: "button", onClick: () => {
                                                logger.info("popup save button clicked");
                                                savePopupConfig();
                                            }, style: {
                                                width: "100%",
                                                marginTop: 16,
                                                padding: "12px 16px",
                                                background: "linear-gradient(135deg, #00B8CC 0%, #00D4E8 100%)",
                                                border: "none",
                                                borderRadius: 9999,
                                                color: "#FFFFFF",
                                                fontSize: 14,
                                                fontWeight: 700,
                                                cursor: "pointer",
                                            }, children: "Save Configuration" })] })), popupType === "preview" && (_jsxs("div", { style: { display: "grid", gap: 12 }, children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 12 }, children: "Adjust threshold amounts, variable type routing, arithmetic operators, or markup percentages directly per tier:" }), _jsx("div", { style: {
                                                maxHeight: "72vh",
                                                overflowY: "auto",
                                                overflowX: "auto",
                                                borderRadius: 10,
                                                border: "1px solid rgba(255,255,255,0.08)",
                                            }, children: _jsxs("table", { style: {
                                                    width: "100%",
                                                    borderCollapse: "collapse",
                                                    minWidth: 920,
                                                }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "rgba(255,255,255,0.04)", position: "sticky", top: 0, zIndex: 1 }, children: [_jsx("th", { style: thStyle, children: "#" }), _jsx("th", { style: thStyle, children: "Start Amount ($)" }), _jsx("th", { style: thStyle, children: "End Amount ($)" }), _jsx("th", { style: thStyle, children: "Variable Type" }), _jsx("th", { style: thStyle, children: "Operator (+ / -)" }), _jsx("th", { style: thStyle, children: "Value (%)" }), _jsx("th", { style: { ...thStyle, textAlign: "center", width: 50 }, children: "\u2715" })] }) }), _jsx("tbody", { children: previewRows.map((row, index) => {
                                                            const isInfinity = row.endAmount === "999999999.00";
                                                            return (_jsxs("tr", { style: {
                                                                    borderTop: "1px solid rgba(255,255,255,0.06)",
                                                                }, children: [_jsx("td", { style: tdMonoStyle, children: index + 1 }), _jsx("td", { style: tdStyle, children: _jsx("input", { type: "number", step: "0.01", value: row.startAmount, onChange: (e) => handleUpdatePreviewRow(index, "startAmount", e.target.value), style: {
                                                                                ...previewInputStyle,
                                                                                width: 105,
                                                                                color: "#67e8f9",
                                                                                fontFamily: "monospace",
                                                                            } }) }), _jsx("td", { style: tdStyle, children: _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [_jsx("input", { type: "text", value: isInfinity ? "999999999.00" : row.endAmount, onChange: (e) => handleUpdatePreviewRow(index, "endAmount", e.target.value), style: {
                                                                                        ...previewInputStyle,
                                                                                        width: 120,
                                                                                        color: isInfinity ? "#a7f3d0" : "#67e8f9",
                                                                                        fontFamily: "monospace",
                                                                                    } }), _jsx("button", { type: "button", onClick: () => handleUpdatePreviewRow(index, "endAmount", isInfinity ? "50.00" : "999999999.00"), title: "Toggle infinity end amount", style: {
                                                                                        padding: "4px 8px",
                                                                                        borderRadius: 6,
                                                                                        fontSize: 11,
                                                                                        fontWeight: 700,
                                                                                        cursor: "pointer",
                                                                                        background: isInfinity
                                                                                            ? "rgba(0,184,204,0.2)"
                                                                                            : "rgba(255,255,255,0.05)",
                                                                                        border: `1px solid ${isInfinity ? "rgba(0,184,204,0.4)" : "rgba(255,255,255,0.12)"}`,
                                                                                        color: isInfinity ? "#67e8f9" : "#94a3b8",
                                                                                    }, children: "\u221E" })] }) }), _jsx("td", { style: tdStyle, children: _jsx("select", { value: row.variableType, onChange: (e) => handleUpdatePreviewRow(index, "variableType", e.target.value), style: previewSelectStyle, children: VARIABLE_TYPES.map((type) => (_jsx("option", { value: type, style: { background: "#18181b", color: "#f8fafc" }, children: capitalize(type) }, type))) }) }), _jsx("td", { style: tdStyle, children: _jsxs("select", { value: row.operator, onChange: (e) => handleUpdatePreviewRow(index, "operator", e.target.value), style: {
                                                                                ...previewSelectStyle,
                                                                                fontWeight: 700,
                                                                                color: row.operator === "add" ? "#86efac" : "#fca5a5",
                                                                                background: row.operator === "add"
                                                                                    ? "rgba(34,197,94,0.08)"
                                                                                    : "rgba(239,68,68,0.08)",
                                                                                border: `1px solid ${row.operator === "add"
                                                                                    ? "rgba(34,197,94,0.3)"
                                                                                    : "rgba(239,68,68,0.3)"}`,
                                                                            }, children: [_jsx("option", { value: "add", style: { background: "#18181b", color: "#86efac" }, children: "+ Add" }), _jsx("option", { value: "subtract", style: { background: "#18181b", color: "#fca5a5" }, children: "- Subtract" })] }) }), _jsx("td", { style: tdStyle, children: _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [_jsx("input", { type: "number", value: row.value, onChange: (e) => handleUpdatePreviewRow(index, "value", parseFloat(e.target.value) || 0), style: {
                                                                                        ...previewInputStyle,
                                                                                        width: 90,
                                                                                        color: "#f8fafc",
                                                                                        fontWeight: 700,
                                                                                        fontFamily: "monospace",
                                                                                    } }), _jsx("span", { style: { color: "#94a3b8", fontSize: 13, fontWeight: 700 }, children: "%" })] }) }), _jsx("td", { style: { ...tdStyle, textAlign: "center" }, children: _jsx("button", { type: "button", onClick: () => handleDeletePreviewRow(index), title: "Delete Tier", style: {
                                                                                background: "none",
                                                                                border: "none",
                                                                                color: "#ef4444",
                                                                                cursor: "pointer",
                                                                                fontSize: 14,
                                                                            }, children: "\u2715" }) })] }, `preview-tier-${index}`));
                                                        }) })] }) }), _jsx("div", { style: { display: "flex", justifyContent: "flex-end", marginTop: 8 }, children: _jsx("button", { type: "button", onClick: closePopup, className: "btn-postman", style: { padding: "8px 24px" }, children: "Done Editing" }) })] })), popupType === "info" && (_jsxs("div", { style: { display: "grid", gap: 16, maxHeight: "70vh", overflowY: "auto" }, children: [_jsxs(SectionCard, { title: "Current Configuration Snapshot", children: [_jsx(RowLine, { left: "Formula Name", right: normalizeText(formulaName) || "—" }), _jsx(RowLine, { left: "Base Variable Type", right: capitalize(baseVariableType) }), _jsx(RowLine, { left: "Global Variable Type", right: capitalize(globalVariableType) }), _jsx(RowLine, { left: "Operator", right: globalOperator === "add" ? "Add" : "Subtract" }), _jsx(RowLine, { left: "End Amounts", right: endAmounts.length ? endAmounts.join(", ") : "—" }), _jsx(RowLine, { left: "Values", right: values.length ? values.join(", ") : "—" }), _jsx(RowLine, { left: "Configured Preview Tiers", right: String(previewRows.length) })] }), _jsxs(SectionCard, { title: "Write API Info", children: [_jsx(RowLine, { left: "Method", right: "POST", rightColor: "#86efac" }), _jsx(RowLine, { left: "Endpoint", right: PRICE_FORMULA_URL }), _jsx(RowLine, { left: "GET Available?", right: "Not required for current implementation" }), _jsx(RowLine, { left: "PUT Available?", right: "Not required for current implementation" })] })] }))] })] }) })) : null] }));
};
const labelStyle = {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 6,
};
const smallLabelStyle = {
    color: "#8A8F98",
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 6,
    textTransform: "uppercase",
};
const inputStyle = {
    width: "100%",
    minHeight: 40,
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 13,
    boxSizing: "border-box",
};
const textareaStyle = {
    width: "100%",
    borderRadius: 12,
    padding: "12px 14px",
    fontSize: 13,
    boxSizing: "border-box",
    resize: "vertical",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
};
const thStyle = {
    textAlign: "left",
    padding: "12px 10px",
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: "nowrap",
};
const tdStyle = {
    textAlign: "left",
    padding: "8px 10px",
    color: "#e2e8f0",
    fontSize: 13,
    verticalAlign: "middle",
    whiteSpace: "nowrap",
};
const tdMonoStyle = {
    ...tdStyle,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};
const previewInputStyle = {
    padding: "6px 8px",
    background: "rgba(0,0,0,0.3)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 6,
    color: "#f8fafc",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
};
const previewSelectStyle = {
    padding: "6px 8px",
    background: "rgba(0,0,0,0.3)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 6,
    color: "#f8fafc",
    fontSize: 12,
    outline: "none",
    cursor: "pointer",
    boxSizing: "border-box",
};
const Pill = ({ label, value }) => {
    return (_jsxs("span", { style: {
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
            color: "#cbd5e1",
            fontSize: 12,
        }, children: [label, _jsx("b", { style: { color: "#f8fafc" }, children: value })] }));
};
const SectionCard = ({ title, children }) => {
    return (_jsxs("div", { style: {
            borderRadius: 18,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
            padding: 16,
            minWidth: 0,
        }, children: [_jsx("div", { style: {
                    fontSize: 16,
                    fontWeight: 800,
                    color: "#f8fafc",
                    marginBottom: 12,
                }, children: title }), _jsx("div", { style: { display: "grid", gap: 8 }, children: children })] }));
};
const RowLine = ({ left, right, rightColor = "#cbd5e1" }) => {
    return (_jsxs("div", { style: {
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
            flexWrap: "wrap",
        }, children: [_jsx("div", { style: {
                    color: "#e2e8f0",
                    fontSize: 13,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    maxWidth: "100%",
                }, children: left }), _jsx("div", { style: {
                    color: rightColor,
                    fontSize: 12,
                    fontWeight: 700,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    textAlign: "right",
                    maxWidth: "100%",
                }, children: right })] }));
};
const ConfigCard = ({ title, subtitle, icon, buttonLabel, statusText, statusColor, onClick }) => {
    return (_jsxs("div", { style: {
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            padding: 14,
        }, children: [_jsxs("div", { style: {
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                    marginBottom: 12,
                }, children: [_jsx("div", { style: {
                            flexShrink: 0,
                            width: 36,
                            height: 36,
                            display: "grid",
                            placeItems: "center",
                            background: "rgba(0,184,204,0.12)",
                            borderRadius: 10,
                            fontSize: 18,
                        }, children: icon }), _jsxs("div", { style: { minWidth: 0 }, children: [_jsx("div", { style: {
                                    margin: "0 0 4px 0",
                                    color: "#F7F8F8",
                                    fontSize: 14,
                                    fontWeight: 700,
                                }, children: title }), _jsx("div", { style: {
                                    margin: 0,
                                    color: "#8A8F98",
                                    fontSize: 12,
                                    lineHeight: 1.5,
                                }, children: subtitle })] })] }), _jsx("button", { type: "button", onClick: onClick, style: {
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
                }, children: buttonLabel }), _jsx("div", { style: {
                    color: statusColor,
                    fontSize: 12,
                    fontWeight: 700,
                    textAlign: "center",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                }, children: statusText })] }));
};
export default PriceBreakFormulasView;
