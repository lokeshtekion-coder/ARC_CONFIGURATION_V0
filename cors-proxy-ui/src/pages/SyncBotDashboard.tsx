import { useCallback, useEffect, useState } from "react";
import {
  runDataSyncHealthCheck,
  fetchBotHealthDetail,
  deleteStaleSnapshots,
  type SyncHealthReport,
  type BotHealthData,
} from "../services/dataSyncBot";

interface Props {
  onBack: () => void;
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#f87171",
  warn: "#fbbf24",
  ok: "#4ade80",
};

export function SyncBotDashboard({ onBack }: Props) {
  const [report, setReport] = useState<SyncHealthReport | null>(null);
  const [health, setHealth] = useState<BotHealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmingCleanup, setConfirmingCleanup] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);
  const [cleanupBusy, setCleanupBusy] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    void Promise.all([runDataSyncHealthCheck(), fetchBotHealthDetail()]).then(
      ([nextReport, nextHealth]) => {
        setReport(nextReport);
        setHealth(nextHealth);
        setLoading(false);
      }
    );
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const staleDealerIds = health?.staleDealerIds ?? [];

  const handleConfirmCleanup = useCallback(async () => {
    setCleanupBusy(true);
    setCleanupStatus(null);
    try {
      const result = await deleteStaleSnapshots(staleDealerIds);
      const deletedCount = result.deleted.reduce((sum, d) => sum + d.fileCount, 0);
      setCleanupStatus(
        `Deleted ${deletedCount} snapshot file(s) across ${result.deleted.length} dealer(s).` +
          (result.skipped.length > 0 ? ` Skipped ${result.skipped.length} (no longer stale).` : "")
      );
      setConfirmingCleanup(false);
      refresh();
    } catch (err: unknown) {
      setCleanupStatus(`Cleanup failed: ${err instanceof Error ? err.message : "unknown error"}`);
    } finally {
      setCleanupBusy(false);
    }
  }, [staleDealerIds, refresh]);

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn-secondary btn-sm" type="button" onClick={onBack}>
            ← Back
          </button>
          <h1 style={{ margin: 0, fontSize: 20 }}>🤖 ARC Data Sync Bot</h1>
        </div>
        <button className="btn-secondary btn-sm" type="button" onClick={refresh} disabled={loading}>
          {loading ? "⏳ Checking..." : "Recheck"}
        </button>
      </div>

      {report && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderRadius: 12,
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${SEVERITY_COLOR[report.overall]}55`,
            marginBottom: 20,
          }}
        >
          <span style={{ fontSize: 18 }}>
            {report.overall === "ok" ? "✅" : report.overall === "warn" ? "⚠️" : "⛔"}
          </span>
          <span style={{ fontWeight: 700, color: SEVERITY_COLOR[report.overall] }}>
            {report.overall === "ok"
              ? "Everything looks healthy"
              : `${report.alerts.length} issue(s) need attention`}
          </span>
          <span style={{ color: "#64748b", fontSize: 12, marginLeft: "auto" }}>
            Checked {new Date(report.checkedAt).toLocaleTimeString()}
          </span>
        </div>
      )}

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Alerts</h2>
        {!report || report.alerts.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 13, fontStyle: "italic" }}>No active alerts.</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {report.alerts.map((alert) => (
              <div
                key={alert.id}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: "rgba(255,255,255,0.02)",
                  border: `1px solid ${SEVERITY_COLOR[alert.severity]}33`,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13, color: SEVERITY_COLOR[alert.severity] }}>
                  {alert.title}
                </div>
                <div style={{ fontSize: 12, color: "#cbd5e1", marginTop: 2 }}>{alert.detail}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Dealer Snapshot Freshness</h2>
          {staleDealerIds.length > 0 && !confirmingCleanup && (
            <button
              className="btn-secondary btn-sm"
              type="button"
              onClick={() => setConfirmingCleanup(true)}
            >
              🗑 Delete stale snapshots ({staleDealerIds.length})
            </button>
          )}
        </div>

        {confirmingCleanup && (
          <div
            style={{
              padding: "12px 16px",
              borderRadius: 10,
              background: "rgba(248, 113, 113, 0.08)",
              border: "1px solid rgba(248, 113, 113, 0.3)",
              marginBottom: 14,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, color: "#f87171", marginBottom: 6 }}>
              Permanently delete snapshot history for {staleDealerIds.length} dealer(s)?
            </div>
            <div style={{ fontSize: 12, color: "#cbd5e1", marginBottom: 10 }}>
              This removes every saved snapshot file for: <b>{staleDealerIds.join(", ")}</b>. This
              cannot be undone - if you still need this history, cancel and export/back it up first.
              A new sync will start a fresh history for these dealers.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn-secondary btn-sm"
                type="button"
                onClick={handleConfirmCleanup}
                disabled={cleanupBusy}
                style={{ color: "#f87171", borderColor: "rgba(248, 113, 113, 0.4)" }}
              >
                {cleanupBusy ? "⏳ Deleting..." : `Yes, delete ${staleDealerIds.length} dealer(s)`}
              </button>
              <button
                className="btn-secondary btn-sm"
                type="button"
                onClick={() => setConfirmingCleanup(false)}
                disabled={cleanupBusy}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {cleanupStatus && (
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>{cleanupStatus}</div>
        )}

        {!health || health.dealers.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 13, fontStyle: "italic" }}>
            No dealer snapshots found yet.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#94a3b8", fontSize: 11, textTransform: "uppercase" }}>
                <th style={{ padding: "6px 10px" }}>Dealer</th>
                <th style={{ padding: "6px 10px" }}>Latest Snapshot</th>
                <th style={{ padding: "6px 10px" }}>Age</th>
                <th style={{ padding: "6px 10px" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {health.dealers
                .slice()
                .sort((a, b) => (b.ageHours ?? Infinity) - (a.ageHours ?? Infinity))
                .map((dealer) => (
                  <tr key={dealer.dealerId} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <td style={{ padding: "8px 10px", fontWeight: 700, color: "#f8fafc" }}>{dealer.dealerId}</td>
                    <td style={{ padding: "8px 10px", color: "#94a3b8", fontFamily: "monospace", fontSize: 11 }}>
                      {dealer.latestTimestamp ?? "—"}
                    </td>
                    <td style={{ padding: "8px 10px", color: "#cbd5e1" }}>
                      {dealer.ageHours !== null ? `~${dealer.ageHours}h` : "unknown"}
                    </td>
                    <td style={{ padding: "8px 10px" }}>
                      <span style={{ color: dealer.stale ? SEVERITY_COLOR.warn : SEVERITY_COLOR.ok, fontWeight: 700 }}>
                        {dealer.stale ? "Stale" : "Fresh"}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
