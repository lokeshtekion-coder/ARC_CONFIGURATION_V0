import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { loadTekionApiSettingsBundle } from "../../../services/tekionApiSettings";
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
    debug: (...args) => console.debug("[Parts][CodeSetup]", ...args),
    info: (...args) => console.info("[Parts][CodeSetup]", ...args),
    warn: (...args) => console.warn("[Parts][CodeSetup]", ...args),
    error: (...args) => console.error("[Parts][CodeSetup]", ...args),
};
function normalizeCode(value) {
    return String(value ?? "").trim().toUpperCase();
}
function normalizeDescription(value) {
    return String(value ?? "").trim();
}
function normalizeText(value) {
    return String(value ?? "").trim();
}
function getRecordCode(record) {
    return normalizeCode(record.code || record.priorityCode);
}
function getRecordDescription(record) {
    return normalizeDescription(record.description);
}
function getRecordIsDefault(record) {
    return Boolean(record.isDefault ?? record.default ?? false);
}
function isPriorityCodeRecord(value) {
    return Boolean(value && typeof value === "object" && "id" in value);
}
function isPriorityCodeListResponse(value) {
    return Boolean(value &&
        typeof value === "object" &&
        Array.isArray(value.data) &&
        value.data.every(isPriorityCodeRecord));
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
    return headers;
}
async function fetchPriorityCodes(headers) {
    const response = await fetch(BASE_URL, {
        method: "GET",
        headers,
    });
    if (!response.ok) {
        throw new Error(`GET priority-code failed with status ${response.status}`);
    }
    const json = await response.json();
    if (!isPriorityCodeListResponse(json)) {
        throw new Error("Invalid priority-code GET response structure");
    }
    return json;
}
function validatePriorityCodes(records, requiredList) {
    const requiredMap = new Map(requiredList.map((item) => [normalizeCode(item.code), item.description]));
    const validRecords = [];
    const invalidRecords = [];
    for (const record of records) {
        const code = getRecordCode(record);
        if (requiredMap.has(code)) {
            validRecords.push(record);
        }
        else {
            invalidRecords.push(record);
        }
    }
    const existingRequiredCodes = new Set(records.map((record) => getRecordCode(record)).filter(Boolean));
    const missingRequiredCodes = requiredList
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
function buildDeletePayload(record) {
    return {
        id: normalizeText(record.id),
        priorityCode: getRecordCode(record),
        description: getRecordDescription(record),
        isDefault: getRecordIsDefault(record),
        deleted: true,
    };
}
async function deletePriorityCode(record, headers) {
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
async function createPriorityCode(payload, headers) {
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
export const CodeSetupView = () => {
    const [rows, setRows] = useState([]);
    const [runState, setRunState] = useState("idle");
    const [statusText, setStatusText] = useState("Ready to validate priority codes");
    const [errorText, setErrorText] = useState("");
    const [isAutoFixing, setIsAutoFixing] = useState(false);
    const [showInfo, setShowInfo] = useState(false);
    const [requiredCodes, setRequiredCodes] = useState(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY_REQUIRED_CODES);
            if (saved)
                return JSON.parse(saved);
        }
        catch (e) {
            logger.warn("Failed to parse saved required codes, falling back to default.");
        }
        return DEFAULT_REQUIRED_CODES;
    });
    const [newCodeInput, setNewCodeInput] = useState("");
    const [newDescInput, setNewDescInput] = useState("");
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY_REQUIRED_CODES, JSON.stringify(requiredCodes));
        }
        catch (error) {
            logger.error("Failed to save required codes to localStorage", error);
        }
    }, [requiredCodes]);
    const validation = useMemo(() => {
        return validatePriorityCodes(rows, requiredCodes);
    }, [rows, requiredCodes]);
    const allRequiredPresent = validation.missingRequiredCodes.length === 0;
    const hasInvalidCodes = validation.invalidRecords.length > 0;
    const refreshData = async (headers) => {
        const response = await fetchPriorityCodes(headers);
        setRows(response.data);
        return response.data;
    };
    const handleRunValidation = async () => {
        setRunState("loading");
        setStatusText("Loading and validating priority codes...");
        setErrorText("");
        try {
            const headers = getEnabledGlobalHeaders();
            if (Object.keys(headers).length === 0) {
                setRunState("error");
                setStatusText("Global headers are missing");
                setErrorText("No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers.");
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
            setStatusText(`Found ${summary.invalidRecords.length} invalid code(s) and ${summary.missingRequiredCodes.length} missing included code(s)`);
        }
        catch (error) {
            setRunState("error");
            setStatusText("Validation failed");
            setErrorText(error instanceof Error ? error.message : String(error));
        }
    };
    const handleAutoFix = async () => {
        const headers = getEnabledGlobalHeaders();
        if (Object.keys(headers).length === 0) {
            setRunState("error");
            setStatusText("Global headers are missing");
            setErrorText("No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers.");
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
            const confirmed = window.confirm([
                "Analysis Complete. Auto Fix will perform the following:",
                latestValidation.invalidRecords.length > 0
                    ? `• Delete ${latestValidation.invalidRecords.length} invalid code(s)`
                    : "• No invalid codes to delete",
                latestValidation.missingRequiredCodes.length > 0
                    ? `• Create ${latestValidation.missingRequiredCodes.length} missing included code(s)`
                    : "• No missing codes to create",
                "",
                "Do you want to continue?",
            ].join("\n"));
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
                const payload = {
                    code: missing.code,
                    description: missing.description,
                };
                await createPriorityCode(payload, headers);
            }
            const refreshedRows = await refreshData(headers);
            const refreshedValidation = validatePriorityCodes(refreshedRows, requiredCodes);
            if (refreshedValidation.invalidRecords.length === 0 &&
                refreshedValidation.missingRequiredCodes.length === 0) {
                setRunState("success");
                setStatusText("Auto Fix completed successfully. Included priority codes are now correct.");
                return;
            }
            setRunState("warning");
            setStatusText(`Auto Fix completed, but still found ${refreshedValidation.invalidRecords.length} invalid and ${refreshedValidation.missingRequiredCodes.length} missing code(s)`);
        }
        catch (error) {
            setRunState("error");
            setStatusText("Auto Fix failed");
            setErrorText(error instanceof Error ? error.message : String(error));
        }
        finally {
            setIsAutoFixing(false);
        }
    };
    const handleAddCustomCode = () => {
        if (!newCodeInput.trim() || !newDescInput.trim())
            return;
        const cleanCode = newCodeInput.trim().toUpperCase();
        if (requiredCodes.some((c) => normalizeCode(c.code) === cleanCode)) {
            alert("This code is already in the Included List.");
            return;
        }
        setRequiredCodes((prev) => [...prev, { code: cleanCode, description: newDescInput.trim() }]);
        setNewCodeInput("");
        setNewDescInput("");
    };
    const handleRemoveCustomCode = (codeToRemove) => {
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
    return (_jsxs("div", { className: "csv-container", children: [_jsxs("div", { className: "csv-header-card", children: [_jsxs("div", { className: "csv-header-row", children: [_jsxs("div", { className: "csv-title-group", children: [_jsx("div", { className: "csv-title", children: "Code setup" }), _jsxs("div", { className: "csv-info-wrapper", children: [_jsx("button", { type: "button", onClick: () => setShowInfo((prev) => !prev), className: `csv-info-btn ${showInfo ? "active" : ""}`, title: "Show Info", children: "i" }), showInfo && (_jsx("div", { className: "csv-info-tooltip", children: "Validates priority codes, removes invalid ones, and creates missing included codes using active Global Headers from Settings." }))] })] }), _jsxs("div", { className: "csv-action-group", children: [_jsx("button", { className: "btn-postman", type: "button", onClick: () => void handleRunValidation(), disabled: runState === "loading" || isAutoFixing, children: runState === "loading" && !isAutoFixing ? "Running..." : "GET" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => void handleAutoFix(), disabled: isAutoFixing ||
                                            runState === "loading" ||
                                            (validation.invalidRecords.length === 0 &&
                                                validation.missingRequiredCodes.length === 0 &&
                                                rows.length > 0), children: isAutoFixing ? "Analyzing & Fixing..." : "Auto Fix" })] })] }), _jsxs("div", { className: `csv-status-box ${getStatusBannerClass()}`, children: [_jsx("div", { className: "csv-status-title", style: { marginBottom: errorText ? 6 : 0 }, children: statusText }), errorText ? _jsx("div", { children: errorText }) : null] })] }), _jsxs("div", { className: "csv-grid", children: [_jsxs(SectionCard, { title: "Included List", count: requiredCodes.length, children: [_jsxs("div", { className: "csv-input-group", children: [_jsx("input", { className: "st-input csv-input", value: newCodeInput, onChange: (e) => setNewCodeInput(e.target.value), placeholder: "Code (e.g. RUSH)" }), _jsx("input", { className: "st-input csv-input csv-input-flex", value: newDescInput, onChange: (e) => setNewDescInput(e.target.value), placeholder: "Description" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: handleAddCustomCode, disabled: !newCodeInput || !newDescInput, children: "Add" })] }), requiredCodes.length === 0 ? (_jsx(EmptyText, { text: "No included priority codes configured." })) : (requiredCodes.map((item) => {
                                const exists = rows.some((row) => getRecordCode(row) === normalizeCode(item.code));
                                return (_jsx(RowLine, { left: _jsxs(_Fragment, { children: [_jsx("button", { type: "button", onClick: () => handleRemoveCustomCode(item.code), className: "csv-remove-btn", title: "Remove from included list", children: "\u00D7" }), item.code, " \u2014 ", item.description] }), right: exists ? "✓ Valid" : "Missing", rightColor: exists ? "#86efac" : "#fca5a5" }, item.code));
                            })), _jsx("div", { className: "csv-reset-container", children: _jsx("button", { className: "btn-secondary btn-sm csv-reset-btn", type: "button", onClick: handleResetCodes, children: "Reset to Defaults" }) })] }), _jsx(SectionCard, { title: "Invalid Existing Codes", count: validation.invalidRecords.length, children: validation.invalidRecords.length === 0 ? (_jsx(EmptyText, { text: "No invalid existing codes found." })) : (validation.invalidRecords.map((item, index) => (_jsx(RowLine, { left: `${getRecordCode(item) || "—"} — ${getRecordDescription(item) || "—"}`, right: `ID: ${normalizeText(item.id) || "None"}`, rightColor: "#fde68a" }, `${item.id ?? "no-id"}-${index}`)))) })] }), _jsxs(SectionCard, { title: "Existing Priority Codes on Server", count: rows.length, children: [rows.length === 0 ? (_jsx("div", { className: "csv-empty-table-state", children: "No data loaded yet. Click GET." })) : (_jsx("div", { className: "csv-table-wrapper", children: _jsxs("table", { className: "csv-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "#" }), _jsx("th", { children: "ID" }), _jsx("th", { children: "Code" }), _jsx("th", { children: "Description" }), _jsx("th", { children: "Default" }), _jsx("th", { children: "Dealer ID" }), _jsx("th", { children: "Status" })] }) }), _jsx("tbody", { children: rows.map((row, index) => {
                                        const code = getRecordCode(row);
                                        const isValid = requiredCodes.some((item) => normalizeCode(item.code) === code);
                                        return (_jsxs("tr", { className: isValid ? "csv-tr-valid" : "csv-tr-invalid", children: [_jsx("td", { children: index + 1 }), _jsx("td", { className: "csv-td-mono", children: normalizeText(row.id) || "—" }), _jsx("td", { className: "csv-td-mono", children: code || "—" }), _jsx("td", { children: getRecordDescription(row) || "—" }), _jsx("td", { children: getRecordIsDefault(row) ? "Yes" : "No" }), _jsx("td", { children: normalizeText(row.dealerId) || "—" }), _jsx("td", { children: _jsx("span", { className: `csv-table-status-pill ${isValid ? "csv-table-status-valid" : "csv-table-status-invalid"}`, children: isValid ? "✓ Valid" : "Invalid" }) })] }, `${row.id ?? "no-id"}-${index}`));
                                    }) })] }) })), rows.length > 0 ? (_jsxs("div", { className: "csv-bottom-summary", children: [_jsxs("div", { children: [_jsx("b", { className: "csv-summary-bold", children: "All required codes present:" }), " ", allRequiredPresent ? "Yes" : "No"] }), _jsxs("div", { children: [_jsx("b", { className: "csv-summary-bold", children: "Has invalid codes:" }), " ", hasInvalidCodes ? "Yes" : "No"] }), _jsxs("div", { children: [_jsx("b", { className: "csv-summary-bold", children: "Expected final state:" }), " Only included list codes should remain valid."] })] })) : null] })] }));
};
const SectionCard = ({ title, count, children }) => {
    const [isExpanded, setIsExpanded] = useState(true);
    return (_jsxs("div", { className: "csv-section-card", children: [_jsxs("div", { onClick: () => setIsExpanded(!isExpanded), className: "csv-section-header", style: { marginBottom: isExpanded ? 12 : 0 }, children: [_jsxs("div", { className: "csv-section-title", children: [title, " ", count !== undefined && _jsxs("span", { className: "csv-count-badge", children: ["(", count, ")"] })] }), _jsx("button", { type: "button", className: "csv-section-toggle", title: isExpanded ? "Collapse section" : "Expand section", children: isExpanded ? "▲" : "▼" })] }), isExpanded && _jsx("div", { className: "csv-section-content", children: children })] }));
};
const RowLine = ({ left, right, rightColor = "#cbd5e1" }) => {
    return (_jsxs("div", { className: "csv-row-line", children: [_jsx("div", { className: "csv-row-left", children: left }), _jsx("div", { className: "csv-row-right", style: { color: rightColor }, children: right })] }));
};
const EmptyText = ({ text }) => {
    return _jsx("div", { className: "csv-empty-text", children: text });
};
export default CodeSetupView;
