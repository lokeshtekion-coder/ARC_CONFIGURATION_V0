import { useState } from "react";
import type { DealerRunEntry, DealerRunStatus, IntegrationRunState } from "../../services/integrationRun";

interface IntegrationRunPanelProps {
  run: IntegrationRunState;
  onClose: () => void;
  onClear: () => void;
  onRerun: () => void;
  onSendReport: () => void;
}

const STATUS_STYLE: Record<DealerRunStatus, { label: string; color: string }> = {
  pending: { label: "Pending", color: "#94a3b8" },
  running: { label: "Fetching…", color: "#38bdf8" },
  ok: { label: "Fetched", color: "#4ade80" },
  failed: { label: "Failed", color: "#f87171" },
  skipped: { label: "Not fetched (stopped)", color: "#fbbf24" },
};

const FILTERS: Array<{ key: "all" | DealerRunStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "running", label: "Running" },
  { key: "ok", label: "Fetched" },
  { key: "failed", label: "Failed" },
  { key: "skipped", label: "Not fetched" },
];

function DealerCard({ dealer }: { dealer: DealerRunEntry }) {
  const [open, setOpen] = useState(false);
  const style = STATUS_STYLE[dealer.status];
  return (
    <div style={{ border: "1px solid rgba(148,163,184,0.25)", borderRadius: 8, background: "#111c33" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          padding: "8px 10px",
          background: "transparent",
          border: "none",
          color: "#e2e8f0",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 13 }}>
          <strong>#{dealer.dealerId}</strong> {dealer.name}
          {dealer.status === "ok" && dealer.tasks !== null && (
            <span style={{ color: "#94a3b8" }}> · {dealer.tasks} task(s)</span>
          )}
        </span>
        <span style={{ fontSize: 12, color: style.color, whiteSpace: "nowrap" }}>
          {style.label} {open ? "▾" : "▸"}
        </span>
      </button>
      {dealer.error && !open && (
        <div style={{ padding: "0 10px 8px", fontSize: 12, color: "#fca5a5" }}>{dealer.error}</div>
      )}
      {open && (
        <pre
          style={{
            margin: 0,
            padding: "8px 10px 10px",
            borderTop: "1px solid rgba(148,163,184,0.15)",
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            color: "#cbd5e1",
          }}
        >
          {dealer.lines.length === 0 ? "No steps yet." : dealer.lines.join("\n")}
        </pre>
      )}
    </div>
  );
}

export function IntegrationRunPanel({ run, onClose, onClear, onRerun, onSendReport }: IntegrationRunPanelProps) {
  const [filter, setFilter] = useState<"all" | DealerRunStatus>("all");
  const running = run.status === "running";
  const counts = {
    ok: run.dealers.filter((d) => d.status === "ok").length,
    failed: run.dealers.filter((d) => d.status === "failed").length,
    skipped: run.dealers.filter((d) => d.status === "skipped").length,
    pending: run.dealers.filter((d) => d.status === "pending" || d.status === "running").length,
  };
  const visible = filter === "all" ? run.dealers : run.dealers.filter((d) => d.status === filter);
  const statusText =
    run.status === "running" ? "Running in background" : run.status === "idle" ? "No run yet today" : run.status;

  return (
    <div
      role="dialog"
      aria-label="Integration report log"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#0f172a", color: "#e2e8f0", borderRadius: 10, padding: 16, width: 760, maxWidth: "95vw", maxHeight: "85vh", display: "flex", flexDirection: "column", gap: 10 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <strong>🧩 Integration report · {run.dateKey}</strong>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn" onClick={onRerun} disabled={running}>
              ⚡ Resume / run
            </button>
            <button type="button" className="btn" onClick={onSendReport} disabled={running}>
              📢 Send report now
            </button>
            <button type="button" className="btn" onClick={onClear} disabled={running}>
              🧹 Clear log
            </button>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        <div style={{ fontSize: 13 }}>
          Status: <strong>{statusText}</strong>
          {" · "}Fetched <strong style={{ color: "#4ade80" }}>{counts.ok}</strong>
          {" · "}Failed <strong style={{ color: "#f87171" }}>{counts.failed}</strong>
          {" · "}Not fetched <strong style={{ color: "#fbbf24" }}>{counts.skipped}</strong>
          {" · "}Pending <strong style={{ color: "#38bdf8" }}>{counts.pending}</strong>
          {" of "}{run.total}
        </div>
        {(run.reportNote || run.dealers.length > 0) && (
          <div style={{ fontSize: 12, color: run.reportSent ? "#4ade80" : "#fbbf24" }}>
            Report: {run.reportSent ? "sent" : "not sent yet"}{run.reportNote ? ` · ${run.reportNote}` : ""}
          </div>
        )}
        <div style={{ fontSize: 12, color: "#94a3b8" }}>
          Closing this window does not stop the run. Click a dealer to see every step for that dealer.
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="btn"
              onClick={() => setFilter(f.key)}
              style={{ opacity: filter === f.key ? 1 : 0.6, fontSize: 12 }}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div style={{ overflow: "auto", display: "flex", flexDirection: "column", gap: 6, minHeight: 120 }}>
          {run.dealers.length === 0 ? (
            <div style={{ fontSize: 13, color: "#94a3b8" }}>No dealers in today's run yet.</div>
          ) : visible.length === 0 ? (
            <div style={{ fontSize: 13, color: "#94a3b8" }}>No dealers in this filter.</div>
          ) : (
            visible.map((d) => <DealerCard key={d.tekionId} dealer={d} />)
          )}
        </div>

        {run.lines.length > 0 && (
          <details>
            <summary style={{ cursor: "pointer", fontSize: 12, color: "#94a3b8" }}>Run-level log ({run.lines.length} lines)</summary>
            <pre style={{ margin: "6px 0 0", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>
              {run.lines.join("\n")}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}

export default IntegrationRunPanel;
