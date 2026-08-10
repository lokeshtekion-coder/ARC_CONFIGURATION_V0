import React, { useEffect, useMemo, useRef, useState } from "react";
import type { KeyValuePair } from "../types/proxy.types";

interface SelectableHeaderMapProps {
  title: string;
  headers?: Record<string, string>;
  capturedAt?: string;
  sourceUrl?: string;
  applyButtonLabel?: string;
  initialSelectedKeys?: string[];
  onApplySelected: (pairs: KeyValuePair[]) => void;
}

const CARD_STYLE: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.025)",
  padding: 14,
};

function formatSavedAt(value?: string): string {
  if (!value) return "Not captured";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Not captured";

  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizeHeaders(headers?: Record<string, string>): Array<[string, string]> {
  return Object.entries(headers ?? {})
    .filter(([key, value]) => key.trim() && String(value).trim())
    .sort(([a], [b]) => a.localeCompare(b));
}

function buildSelectionMap(
  entries: Array<[string, string]>,
  initialSelectedKeys?: string[]
): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  const selectedSet =
    initialSelectedKeys && initialSelectedKeys.length > 0
      ? new Set(initialSelectedKeys)
      : null;

  for (const [key] of entries) {
    next[key] = selectedSet ? selectedSet.has(key) : true;
  }

  return next;
}

export const SelectableHeaderMap: React.FC<SelectableHeaderMapProps> = ({
  title,
  headers,
  capturedAt,
  sourceUrl,
  applyButtonLabel = "Use Selected as Global Headers",
  initialSelectedKeys,
  onApplySelected,
}) => {
  const entries = useMemo(() => normalizeHeaders(headers), [headers]);
  const headerSignature = useMemo(() => JSON.stringify(entries), [entries]);

  const [selectedKeys, setSelectedKeys] = useState<Record<string, boolean>>({});
  const lastSignatureRef = useRef<string>("");

  useEffect(() => {
    if (lastSignatureRef.current === headerSignature) return;
    lastSignatureRef.current = headerSignature;
    setSelectedKeys(buildSelectionMap(entries, initialSelectedKeys));
  }, [headerSignature, entries, initialSelectedKeys]);

  const selectedCount = entries.filter(([key]) => Boolean(selectedKeys[key])).length;

  const toggleKey = (key: string) => {
    setSelectedKeys((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleSelectAll = () => {
    setSelectedKeys(() => {
      const next: Record<string, boolean> = {};
      for (const [key] of entries) next[key] = true;
      return next;
    });
  };

  const handleClearAll = () => {
    setSelectedKeys(() => {
      const next: Record<string, boolean> = {};
      for (const [key] of entries) next[key] = false;
      return next;
    });
  };

  const handleApply = () => {
    const pairs: KeyValuePair[] = entries
      .filter(([key]) => Boolean(selectedKeys[key]))
      .map(([key, value]) => ({
        key,
        value,
        enabled: true,
      }));

    onApplySelected(pairs);
  };

  return (
    <section style={CARD_STYLE}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 700 }}>{title}</div>
          <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>
            Captured: {formatSavedAt(capturedAt)} · {entries.length} headers · {selectedCount} selected
          </div>

          {sourceUrl ? (
            <div
              style={{
                color: "#94a3b8",
                fontSize: 12,
                marginTop: 6,
                wordBreak: "break-word",
                overflowWrap: "anywhere",
              }}
            >
              Source: {sourceUrl}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn-secondary btn-sm" type="button" onClick={handleSelectAll}>
            ☑ Select All
          </button>

          <button className="btn-secondary btn-sm" type="button" onClick={handleClearAll}>
            ☐ Clear All
          </button>

          <button
            className="btn-postman"
            type="button"
            onClick={handleApply}
            disabled={selectedCount === 0}
          >
            ⇢ {applyButtonLabel}
          </button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div style={{ color: "#94a3b8", fontSize: 14 }}>No headers captured.</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {entries.map(([key, value]) => (
            <div
              key={key}
              style={{
                display: "grid",
                gridTemplateColumns: "20px minmax(180px, 260px) minmax(0, 1fr)",
                gap: 12,
                alignItems: "start",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(15,23,42,0.32)",
              }}
            >
              <input
                type="checkbox"
                checked={Boolean(selectedKeys[key])}
                onChange={() => toggleKey(key)}
                style={{ marginTop: 3 }}
              />

              <button
                type="button"
                onClick={() => toggleKey(key)}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  margin: 0,
                  textAlign: "left",
                  color: "#93c5fd",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                }}
              >
                {key}
              </button>

              <button
                type="button"
                onClick={() => toggleKey(key)}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  margin: 0,
                  textAlign: "left",
                  color: "#e2e8f0",
                  fontSize: 12,
                  lineHeight: 1.5,
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  cursor: "pointer",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  overflowWrap: "anywhere",
                }}
              >
                {value}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
