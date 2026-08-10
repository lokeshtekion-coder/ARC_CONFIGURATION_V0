import React, { useState } from "react";
import type { ResponseData } from "../types/proxy.types";

interface Props {
  response: ResponseData | null;
  loading:  boolean;
  error?:   string | null;
}

type ViewTab = "body" | "headers" | "info";

function getStatusClass(status: number): string {
  if (status >= 200 && status < 300) return "status-ok";
  if (status >= 300 && status < 400) return "status-redirect";
  return "status-client-err";
}

function tryPretty(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export const ResponseViewer: React.FC<Props> = ({ response, loading, error }) => {
  const [tab, setTab] = useState<ViewTab>("body");

  /* Loading */
  if (loading) {
    return (
      <div className="response-panel response-loading" style={{ display: "flex" }}>
        <div className="spinner" />
        <span>Sending request…</span>
      </div>
    );
  }

  /* Error */
  if (error) {
    return (
      <div className="response-panel response-error" style={{ display: "flex" }}>
        <span className="error-icon">⚠</span>
        <pre className="error-text">{error}</pre>
      </div>
    );
  }

  /* Empty */
  if (!response) {
    return (
      <div className="response-panel response-empty" style={{ display: "flex" }}>
        <span className="empty-icon">📡</span>
        <span>Send a request to see the response</span>
      </div>
    );
  }

  const headerEntries = Object.entries(response.headers);

  return (
    <div className="response-panel">

      {/* Status bar */}
      <div className="response-statusbar">
        <span className={`status-badge ${getStatusClass(response.status)}`}>
          {response.status} {response.statusText}
        </span>
        <span className="response-meta">⏱ {response.duration}ms</span>
        <span className="response-meta">
          📦 {new Blob([response.body]).size} B
        </span>

        {/* View tabs */}
        <div style={{ marginLeft: "auto", display: "flex", gap: "4px" }}>
          {(["body", "headers", "info"] as ViewTab[]).map((t) => (
            <button
              key={t}
              className={`btn-secondary btn-sm ${tab === t ? "btn-tab-active" : ""}`}
              onClick={() => setTab(t)}
              style={tab === t ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              {t === "headers" && (
                <span style={{ marginLeft: "4px", opacity: .6 }}>
                  ({headerEntries.length})
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Body tab */}
      {tab === "body" && (
        <pre className="response-body">{tryPretty(response.body)}</pre>
      )}

      {/* Headers tab */}
      {tab === "headers" && (
        <div style={{ overflow: "auto", flex: 1 }}>
          <table className="headers-table">
            <thead>
              <tr>
                <th>Header</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {headerEntries.map(([k, v]) => (
                <tr key={k}>
                  <td className="header-key">{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Info tab */}
      {tab === "info" && (
        <div className="info-grid">
          <div className="info-row">
            <span>Status</span>
            <code className={getStatusClass(response.status)}>
              {response.status} {response.statusText}
            </code>
          </div>
          <div className="info-row">
            <span>Duration</span>
            <code>{response.duration}ms</code>
          </div>
          <div className="info-row">
            <span>Size</span>
            <code>{new Blob([response.body]).size} bytes</code>
          </div>
        </div>
      )}

    </div>
  );
};
