import React, { useEffect, useState } from "react";
import type { KeyValuePair } from "../types/proxy.types";

const TEKION_HEADERS = new Set([
  "accept",
  "accept-language",
  "applicationid",
  "cache-control",
  "clientid",
  "content-type",
  "dealerid",
  "dnt",
  "flattenedaecprogramsmap",
  "locale",
  "oemid",
  "original-tenantid",
  "pragma",
  "productids",
  "program",
  "roleid",
  "subapplicationid",
  "tek-siteid",
  "tekion-api-token",
  "tenantname",
]);

interface TokenMeta {
  exp: number;
  iat: number;
  email: string;
  tenantId: string;
  isExpired: boolean;
  isExpiringSoon: boolean;
}

function decodeToken(token: string): TokenMeta | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;

    const payload = JSON.parse(
      atob(part.replace(/-/g, "+").replace(/_/g, "/"))
    );

    const now = Date.now() / 1000;
    const isExpired = now > payload.exp;

    return {
      exp: payload.exp,
      iat: payload.iat,
      email: payload.email ?? "",
      tenantId: payload.originalTenantId ?? "",
      isExpired,
      isExpiringSoon: !isExpired && payload.exp - now < 300,
    };
  } catch {
    return null;
  }
}

function formatTimeLeft(exp: number): string {
  const diff = exp - Date.now() / 1000;
  const abs = Math.abs(diff);

  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = Math.floor(abs % 60);

  const str = [h ? `${h}h` : "", `${m}m`, `${s}s`]
    .filter(Boolean)
    .join(" ");

  return diff < 0 ? `Expired ${str} ago` : `${str} remaining`;
}

function parseBulk(raw: string): KeyValuePair[] {
  const trimmed = raw.trim();
  let rows: Array<{ key: string; value: string }> = [];

  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed);
      rows = Object.entries(obj).map(([k, v]) => ({
        key: k.toLowerCase(),
        value: String(v),
      }));
    } catch {
      // fall through
    }
  }

  if (rows.length === 0) {
    rows = trimmed
      .split("\n")
      .filter((line) => line.includes(":"))
      .map((line) => {
        const idx = line.indexOf(":");
        return {
          key: line.slice(0, idx).trim().toLowerCase(),
          value: line.slice(idx + 1).trim(),
        };
      })
      .filter((row) => row.key.length > 0);
  }

  return rows
    .filter((row) => TEKION_HEADERS.has(row.key))
    .map((row) => ({
      key: row.key,
      value: row.value,
      enabled: true,
    }));
}

interface Props {
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  defaultOpen?: boolean;
  title?: string;
}

export const GlobalHeadersPanel: React.FC<Props> = ({
  pairs,
  onChange,
  defaultOpen = false,
  title = "Global Headers",
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const [mode, setMode] = useState<"table" | "bulk">("table");
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState("");
  const [, setTick] = useState(0);

  const tokenValue =
    pairs.find((pair) => pair.key.toLowerCase() === "tekion-api-token")?.value ?? "";

  const tokenMeta = tokenValue ? decodeToken(tokenValue) : null;
  const timeLeft = tokenMeta ? formatTimeLeft(tokenMeta.exp) : null;
  const activeCount = pairs.filter((pair) => pair.enabled && pair.key.trim()).length;

  useEffect(() => {
    if (!tokenValue) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [tokenValue]);

  const applyBulk = () => {
    if (!bulkText.trim()) {
      setBulkError("Nothing to parse.");
      return;
    }

    const parsed = parseBulk(bulkText);

    if (!parsed.length) {
      setBulkError("No Tekion headers found. Check format.");
      return;
    }

    onChange(parsed);
    setBulkText("");
    setBulkError("");
    setMode("table");
  };

  const updateRow = (
    index: number,
    field: keyof KeyValuePair,
    value: string | boolean
  ) => {
    onChange(
      pairs.map((pair, idx) =>
        idx === index ? { ...pair, [field]: value } : pair
      )
    );
  };

  const removeRow = (index: number) => {
    onChange(pairs.filter((_, idx) => idx !== index));
  };

  return (
    <div className="gh-root">
      <button className="gh-strip" onClick={() => setOpen((prev) => !prev)}>
        <div className="gh-strip-left">
          <span className="gh-icon">🔑</span>
          <span className="gh-label">{title}</span>
          <span className="gh-badge-count">{activeCount} active</span>

          {tokenMeta && (
            <span
              className={`gh-token-pill ${
                tokenMeta.isExpired
                  ? "pill-red"
                  : tokenMeta.isExpiringSoon
                  ? "pill-orange"
                  : "pill-green"
              }`}
            >
              {tokenMeta.isExpired
                ? `⛔ ${timeLeft}`
                : tokenMeta.isExpiringSoon
                ? `⚠ ${timeLeft}`
                : `✓ ${timeLeft}`}
            </span>
          )}

          {!tokenMeta && pairs.length === 0 && (
            <span className="gh-token-pill pill-muted">
              Paste once — auto-applied to every request
            </span>
          )}
        </div>

        <span className="gh-chevron">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="gh-body">
          {tokenMeta && (
            <div
              className={`gh-token-card ${
                tokenMeta.isExpired
                  ? "tc-expired"
                  : tokenMeta.isExpiringSoon
                  ? "tc-soon"
                  : "tc-ok"
              }`}
            >
              <div className="gh-tc-header">
                <span>🔐 tekion-api-token</span>
                <span
                  className={
                    tokenMeta.isExpired
                      ? "color-red"
                      : tokenMeta.isExpiringSoon
                      ? "color-orange"
                      : "color-green"
                  }
                >
                  {tokenMeta.isExpired
                    ? "EXPIRED"
                    : tokenMeta.isExpiringSoon
                    ? "EXPIRING SOON"
                    : "VALID"}
                </span>
              </div>

              <div className="gh-tc-grid">
                <div className="gh-tc-row">
                  <span>⏱ Time Left</span>
                  <code
                    className={
                      tokenMeta.isExpired
                        ? "color-red"
                        : tokenMeta.isExpiringSoon
                        ? "color-orange"
                        : "color-green"
                    }
                  >
                    {timeLeft}
                  </code>
                </div>

                {tokenMeta.email && (
                  <div className="gh-tc-row">
                    <span>✉ Email</span>
                    <code>{tokenMeta.email}</code>
                  </div>
                )}

                {tokenMeta.tenantId && (
                  <div className="gh-tc-row">
                    <span>🏢 Tenant</span>
                    <code>{tokenMeta.tenantId}</code>
                  </div>
                )}

                <div className="gh-tc-row">
                  <span>📅 Issued</span>
                  <code>{new Date(tokenMeta.iat * 1000).toLocaleString()}</code>
                </div>

                <div className="gh-tc-row">
                  <span>📅 Expires</span>
                  <code>{new Date(tokenMeta.exp * 1000).toLocaleString()}</code>
                </div>
              </div>
            </div>
          )}

          <div className="gh-mode-bar">
            <div className="kv-mode-tabs">
              <button
                className={`kv-mode-btn ${mode === "table" ? "kv-mode-active" : ""}`}
                onClick={() => setMode("table")}
              >
                Edit
              </button>

              <button
                className={`kv-mode-btn ${mode === "bulk" ? "kv-mode-active" : ""}`}
                onClick={() => {
                  setMode("bulk");
                  setBulkError("");
                }}
              >
                Bulk Paste
              </button>
            </div>

            <button className="gh-clear" onClick={() => onChange([])}>
              ✕ Clear All
            </button>
          </div>

          {mode === "table" && (
            <div className="gh-rows">
              {pairs.length === 0 ? (
                <div className="gh-empty-hint">
                  <span>📋</span>
                  <span>
                    Use <strong>Bulk Paste</strong> — paste headers from Chrome
                    DevTools. Sec-*, origin, user-agent are auto-stripped.
                  </span>
                </div>
              ) : (
                pairs.map((pair, index) => (
                  <div key={index} className="kv-row">
                    <input
                      type="checkbox"
                      checked={pair.enabled}
                      onChange={(e) =>
                        updateRow(index, "enabled", e.target.checked)
                      }
                      className="kv-check"
                    />

                    <input
                      type="text"
                      value={pair.key}
                      onChange={(e) => updateRow(index, "key", e.target.value)}
                      className="kv-input gh-key-input"
                    />

                    <input
                      type={pair.key === "tekion-api-token" ? "password" : "text"}
                      value={pair.value}
                      onChange={(e) =>
                        updateRow(index, "value", e.target.value)
                      }
                      className="kv-input"
                      placeholder="value"
                    />

                    <button
                      onClick={() => removeRow(index)}
                      className="kv-remove"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {mode === "bulk" && (
            <div className="bulk-editor">
              <div className="bulk-hint">
                Paste raw headers from Chrome DevTools → Network → any request →
                Request Headers.
                <br />
                <strong>sec-*, origin, user-agent</strong> are auto-stripped.
                Only Tekion headers are kept.
              </div>

              <textarea
                className="bulk-textarea"
                value={bulkText}
                onChange={(e) => {
                  setBulkText(e.target.value);
                  setBulkError("");
                }}
                placeholder={
                  "tekion-api-token: eyJhbG...\ndealerid: 7270\napplicationid: ARC_NA\nclientid: web\nlocale: en_US\n..."
                }
                rows={14}
                spellCheck={false}
                autoFocus
              />

              {bulkError && <div className="bulk-error">⚠ {bulkError}</div>}

              <div className="bulk-actions">
                <button onClick={applyBulk} className="btn-apply">
                  ✓ Apply Headers
                </button>

                <button
                  onClick={() => {
                    setMode("table");
                    setBulkError("");
                  }}
                  className="btn-cancel-bulk"
                >
                  Cancel
                </button>

                <button onClick={() => setBulkText("")} className="btn-clear-bulk">
                  Clear
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
