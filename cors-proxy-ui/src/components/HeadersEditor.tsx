import React, { useState } from "react";
import type { KeyValuePair } from "../types/proxy.types";

interface Props {
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  placeholder?: [string, string];
}

type EditorMode = "table" | "bulk";

// Parse raw pasted headers into key-value pairs
// Supports both formats:
//   Content-Type: application/json
//   {"Content-Type": "application/json"}
function parseBulkHeaders(raw: string): KeyValuePair[] {
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
    } catch {
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
      const key   = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      return { key, value, enabled: true };
    })
    .filter((pair) => pair.key.length > 0);
}

// Convert key-value pairs back to "Key: Value" text
function pairsToText(pairs: KeyValuePair[]): string {
  return pairs
    .filter((p) => p.key.trim())
    .map((p) => `${p.key}: ${p.value}`)
    .join("\n");
}

export const KeyValueEditor: React.FC<Props> = ({
  pairs,
  onChange,
  placeholder = ["Key", "Value"],
}) => {
  const [mode, setMode]         = useState<EditorMode>("table");
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
    } catch {
      setBulkError("Could not parse headers. Check format and try again.");
    }
  };

  const cancelBulk = () => {
    setBulkError("");
    setMode("table");
  };

  // Table mode helpers
  const update = (index: number, field: keyof KeyValuePair, value: string | boolean) => {
    const updated = pairs.map((p, i) => (i === index ? { ...p, [field]: value } : p));
    onChange(updated);
  };

  const addRow    = () => onChange([...pairs, { key: "", value: "", enabled: true }]);
  const removeRow = (index: number) => onChange(pairs.filter((_, i) => i !== index));

  return (
    <div className="kv-editor">

      {/* Mode Toggle Bar */}
      <div className="kv-mode-bar">
        <div className="kv-mode-tabs">
          <button
            className={`kv-mode-btn ${mode === "table" ? "kv-mode-active" : ""}`}
            onClick={() => mode === "bulk" ? cancelBulk() : undefined}
          >
            Key-Value
          </button>
          <button
            className={`kv-mode-btn ${mode === "bulk" ? "kv-mode-active" : ""}`}
            onClick={switchToBulk}
          >
            Bulk Paste
          </button>
        </div>
        {mode === "table" && (
          <span className="kv-count">{pairs.filter((p) => p.enabled && p.key).length} active</span>
        )}
      </div>

      {/* ── TABLE MODE ── */}
      {mode === "table" && (
        <>
          {pairs.map((pair, i) => (
            <div key={i} className="kv-row">
              <input
                type="checkbox"
                checked={pair.enabled}
                onChange={(e) => update(i, "enabled", e.target.checked)}
                className="kv-check"
              />
              <input
                type="text"
                value={pair.key}
                placeholder={placeholder[0]}
                onChange={(e) => update(i, "key", e.target.value)}
                className="kv-input"
              />
              <input
                type="text"
                value={pair.value}
                placeholder={placeholder[1]}
                onChange={(e) => update(i, "value", e.target.value)}
                className="kv-input"
              />
              <button onClick={() => removeRow(i)} className="kv-remove" title="Remove">
                ✕
              </button>
            </div>
          ))}
          <button onClick={addRow} className="kv-add">+ Add Row</button>
        </>
      )}

      {/* ── BULK PASTE MODE ── */}
      {mode === "bulk" && (
        <div className="bulk-editor">

          <div className="bulk-hint">
            Paste headers in any format:
          </div>

          {/* Format examples */}
          <div className="bulk-formats">
            <div className="bulk-format-block">
              <span className="bulk-format-label">Format A — Key: Value</span>
              <pre className="bulk-format-example">{`Content-Type: application/json
Authorization: Bearer eyJhbG...
X-Custom-Header: myvalue`}</pre>
            </div>
            <div className="bulk-format-block">
              <span className="bulk-format-label">Format B — JSON</span>
              <pre className="bulk-format-example">{`{
  "Content-Type": "application/json",
  "Authorization": "Bearer eyJhbG..."
}`}</pre>
            </div>
          </div>

          <textarea
            className="bulk-textarea"
            value={bulkText}
            onChange={(e) => {
              setBulkText(e.target.value);
              setBulkError("");
            }}
            placeholder={`Content-Type: application/json\nAuthorization: Bearer token\nX-Custom-Header: value`}
            rows={10}
            spellCheck={false}
            autoFocus
          />

          {bulkError && (
            <div className="bulk-error">⚠ {bulkError}</div>
          )}

          <div className="bulk-actions">
            <button onClick={applyBulk} className="btn-apply">
              ✓ Apply Headers
            </button>
            <button onClick={cancelBulk} className="btn-cancel-bulk">
              Cancel
            </button>
            <button
              onClick={() => setBulkText("")}
              className="btn-clear-bulk"
            >
              Clear
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
