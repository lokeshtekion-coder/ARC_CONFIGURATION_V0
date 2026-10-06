import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
// Parse raw pasted headers into key-value pairs
// Supports both formats:
//   Content-Type: application/json
//   {"Content-Type": "application/json"}
function parseBulkHeaders(raw) {
    const trimmed = raw.trim();
    // Try JSON format first
    if (trimmed.startsWith("{")) {
        try {
            const parsed = JSON.parse(trimmed);
            return Object.entries(parsed).map(([key, value]) => ({
                key,
                value: String(value),
                enabled: true,
            }));
        }
        catch {
            // fall through to line-by-line
        }
    }
    // Parse line-by-line "Key: Value" format
    return trimmed
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && line.includes(":"))
        .map((line) => {
        const colonIndex = line.indexOf(":");
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        return { key, value, enabled: true };
    })
        .filter((pair) => pair.key.length > 0);
}
// Convert key-value pairs back to "Key: Value" text
function pairsToText(pairs) {
    return pairs
        .filter((p) => p.key.trim())
        .map((p) => `${p.key}: ${p.value}`)
        .join("\n");
}
export const KeyValueEditor = ({ pairs, onChange, placeholder = ["Key", "Value"], }) => {
    const [mode, setMode] = useState("table");
    const [bulkText, setBulkText] = useState("");
    const [bulkError, setBulkError] = useState("");
    // Switch from table → bulk: pre-fill textarea with current pairs
    const switchToBulk = () => {
        setBulkText(pairsToText(pairs));
        setBulkError("");
        setMode("bulk");
    };
    // Switch from bulk → table: parse and apply
    const applyBulk = () => {
        if (!bulkText.trim()) {
            onChange([]);
            setMode("table");
            return;
        }
        try {
            const parsed = parseBulkHeaders(bulkText);
            if (parsed.length === 0) {
                setBulkError("No valid headers found. Use  Key: Value  or JSON format.");
                return;
            }
            onChange(parsed);
            setBulkError("");
            setMode("table");
        }
        catch {
            setBulkError("Could not parse headers. Check format and try again.");
        }
    };
    const cancelBulk = () => {
        setBulkError("");
        setMode("table");
    };
    // Table mode helpers
    const update = (index, field, value) => {
        const updated = pairs.map((p, i) => (i === index ? { ...p, [field]: value } : p));
        onChange(updated);
    };
    const addRow = () => onChange([...pairs, { key: "", value: "", enabled: true }]);
    const removeRow = (index) => onChange(pairs.filter((_, i) => i !== index));
    return (_jsxs("div", { className: "kv-editor", children: [_jsxs("div", { className: "kv-mode-bar", children: [_jsxs("div", { className: "kv-mode-tabs", children: [_jsx("button", { className: `kv-mode-btn ${mode === "table" ? "kv-mode-active" : ""}`, onClick: () => mode === "bulk" ? cancelBulk() : undefined, children: "Key-Value" }), _jsx("button", { className: `kv-mode-btn ${mode === "bulk" ? "kv-mode-active" : ""}`, onClick: switchToBulk, children: "Bulk Paste" })] }), mode === "table" && (_jsxs("span", { className: "kv-count", children: [pairs.filter((p) => p.enabled && p.key).length, " active"] }))] }), mode === "table" && (_jsxs(_Fragment, { children: [pairs.map((pair, i) => (_jsxs("div", { className: "kv-row", children: [_jsx("input", { type: "checkbox", checked: pair.enabled, onChange: (e) => update(i, "enabled", e.target.checked), className: "kv-check" }), _jsx("input", { type: "text", value: pair.key, placeholder: placeholder[0], onChange: (e) => update(i, "key", e.target.value), className: "kv-input" }), _jsx("input", { type: "text", value: pair.value, placeholder: placeholder[1], onChange: (e) => update(i, "value", e.target.value), className: "kv-input" }), _jsx("button", { onClick: () => removeRow(i), className: "kv-remove", title: "Remove", children: "\u2715" })] }, i))), _jsx("button", { onClick: addRow, className: "kv-add", children: "+ Add Row" })] })), mode === "bulk" && (_jsxs("div", { className: "bulk-editor", children: [_jsx("div", { className: "bulk-hint", children: "Paste headers in any format:" }), _jsxs("div", { className: "bulk-formats", children: [_jsxs("div", { className: "bulk-format-block", children: [_jsx("span", { className: "bulk-format-label", children: "Format A \u2014 Key: Value" }), _jsx("pre", { className: "bulk-format-example", children: `Content-Type: application/json
Authorization: Bearer eyJhbG...
X-Custom-Header: myvalue` })] }), _jsxs("div", { className: "bulk-format-block", children: [_jsx("span", { className: "bulk-format-label", children: "Format B \u2014 JSON" }), _jsx("pre", { className: "bulk-format-example", children: `{
  "Content-Type": "application/json",
  "Authorization": "Bearer eyJhbG..."
}` })] })] }), _jsx("textarea", { className: "bulk-textarea", value: bulkText, onChange: (e) => {
                            setBulkText(e.target.value);
                            setBulkError("");
                        }, placeholder: `Content-Type: application/json\nAuthorization: Bearer token\nX-Custom-Header: value`, rows: 10, spellCheck: false, autoFocus: true }), bulkError && (_jsxs("div", { className: "bulk-error", children: ["\u26A0 ", bulkError] })), _jsxs("div", { className: "bulk-actions", children: [_jsx("button", { onClick: applyBulk, className: "btn-apply", children: "\u2713 Apply Headers" }), _jsx("button", { onClick: cancelBulk, className: "btn-cancel-bulk", children: "Cancel" }), _jsx("button", { onClick: () => setBulkText(""), className: "btn-clear-bulk", children: "Clear" })] })] }))] }));
};
