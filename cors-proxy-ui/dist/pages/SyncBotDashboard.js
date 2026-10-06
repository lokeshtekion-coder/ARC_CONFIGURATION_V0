import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { runDataSyncHealthCheck, fetchBotHealthDetail, deleteStaleSnapshots, } from "../services/dataSyncBot";
const SEVERITY_COLOR = {
    critical: "#f87171",
    warn: "#fbbf24",
    ok: "#4ade80",
};
export function SyncBotDashboard({ onBack }) {
    const [report, setReport] = useState(null);
    const [health, setHealth] = useState(null);
    const [loading, setLoading] = useState(true);
    const [confirmingCleanup, setConfirmingCleanup] = useState(false);
    const [cleanupStatus, setCleanupStatus] = useState(null);
    const [cleanupBusy, setCleanupBusy] = useState(false);
    const refresh = useCallback(() => {
        setLoading(true);
        void Promise.all([runDataSyncHealthCheck(), fetchBotHealthDetail()]).then(([nextReport, nextHealth]) => {
            setReport(nextReport);
            setHealth(nextHealth);
            setLoading(false);
        });
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
            setCleanupStatus(`Deleted ${deletedCount} snapshot file(s) across ${result.deleted.length} dealer(s).` +
                (result.skipped.length > 0 ? ` Skipped ${result.skipped.length} (no longer stale).` : ""));
            setConfirmingCleanup(false);
            refresh();
        }
        catch (err) {
            setCleanupStatus(`Cleanup failed: ${err instanceof Error ? err.message : "unknown error"}`);
        }
        finally {
            setCleanupBusy(false);
        }
    }, [staleDealerIds, refresh]);
    return (_jsxs("div", { style: { padding: 24, maxWidth: 1000, margin: "0 auto" }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 12 }, children: [_jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: onBack, children: "\u2190 Back" }), _jsx("h1", { style: { margin: 0, fontSize: 20 }, children: "\uD83E\uDD16 ARC Data Sync Bot" })] }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: refresh, disabled: loading, children: loading ? "⏳ Checking..." : "Recheck" })] }), report && (_jsxs("div", { style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 16px",
                    borderRadius: 12,
                    background: "rgba(255,255,255,0.03)",
                    border: `1px solid ${SEVERITY_COLOR[report.overall]}55`,
                    marginBottom: 20,
                }, children: [_jsx("span", { style: { fontSize: 18 }, children: report.overall === "ok" ? "✅" : report.overall === "warn" ? "⚠️" : "⛔" }), _jsx("span", { style: { fontWeight: 700, color: SEVERITY_COLOR[report.overall] }, children: report.overall === "ok"
                            ? "Everything looks healthy"
                            : `${report.alerts.length} issue(s) need attention` }), _jsxs("span", { style: { color: "#64748b", fontSize: 12, marginLeft: "auto" }, children: ["Checked ", new Date(report.checkedAt).toLocaleTimeString()] })] })), _jsxs("section", { style: { marginBottom: 28 }, children: [_jsx("h2", { style: { fontSize: 15, margin: "0 0 10px" }, children: "Alerts" }), !report || report.alerts.length === 0 ? (_jsx("div", { style: { color: "#94a3b8", fontSize: 13, fontStyle: "italic" }, children: "No active alerts." })) : (_jsx("div", { style: { display: "grid", gap: 8 }, children: report.alerts.map((alert) => (_jsxs("div", { style: {
                                padding: "10px 14px",
                                borderRadius: 10,
                                background: "rgba(255,255,255,0.02)",
                                border: `1px solid ${SEVERITY_COLOR[alert.severity]}33`,
                            }, children: [_jsx("div", { style: { fontWeight: 700, fontSize: 13, color: SEVERITY_COLOR[alert.severity] }, children: alert.title }), _jsx("div", { style: { fontSize: 12, color: "#cbd5e1", marginTop: 2 }, children: alert.detail }), alert.actionUrl && (_jsxs("a", { href: alert.actionUrl, target: "_blank", rel: "noreferrer", style: { display: "inline-block", marginTop: 6, fontSize: 12, color: "#60a5fa", fontWeight: 700 }, children: [alert.actionLabel || "Open page", " \u2192"] }))] }, alert.id))) }))] }), _jsxs("section", { children: [_jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }, children: [_jsx("h2", { style: { fontSize: 15, margin: 0 }, children: "Dealer Snapshot Freshness" }), staleDealerIds.length > 0 && !confirmingCleanup && (_jsxs("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => setConfirmingCleanup(true), children: ["\uD83D\uDDD1 Delete stale snapshots (", staleDealerIds.length, ")"] }))] }), confirmingCleanup && (_jsxs("div", { style: {
                            padding: "12px 16px",
                            borderRadius: 10,
                            background: "rgba(248, 113, 113, 0.08)",
                            border: "1px solid rgba(248, 113, 113, 0.3)",
                            marginBottom: 14,
                        }, children: [_jsxs("div", { style: { fontWeight: 700, fontSize: 13, color: "#f87171", marginBottom: 6 }, children: ["Permanently delete snapshot history for ", staleDealerIds.length, " dealer(s)?"] }), _jsxs("div", { style: { fontSize: 12, color: "#cbd5e1", marginBottom: 10 }, children: ["This removes every saved snapshot file for: ", _jsx("b", { children: staleDealerIds.join(", ") }), ". This cannot be undone - if you still need this history, cancel and export/back it up first. A new sync will start a fresh history for these dealers."] }), _jsxs("div", { style: { display: "flex", gap: 8 }, children: [_jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: handleConfirmCleanup, disabled: cleanupBusy, style: { color: "#f87171", borderColor: "rgba(248, 113, 113, 0.4)" }, children: cleanupBusy ? "⏳ Deleting..." : `Yes, delete ${staleDealerIds.length} dealer(s)` }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => setConfirmingCleanup(false), disabled: cleanupBusy, children: "Cancel" })] })] })), cleanupStatus && (_jsx("div", { style: { fontSize: 12, color: "#94a3b8", marginBottom: 10 }, children: cleanupStatus })), !health || health.dealers.length === 0 ? (_jsx("div", { style: { color: "#94a3b8", fontSize: 13, fontStyle: "italic" }, children: "No dealer snapshots found yet." })) : (_jsxs("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 13 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: "left", color: "#94a3b8", fontSize: 11, textTransform: "uppercase" }, children: [_jsx("th", { style: { padding: "6px 10px" }, children: "Dealer" }), _jsx("th", { style: { padding: "6px 10px" }, children: "Latest Snapshot" }), _jsx("th", { style: { padding: "6px 10px" }, children: "Age" }), _jsx("th", { style: { padding: "6px 10px" }, children: "Status" })] }) }), _jsx("tbody", { children: health.dealers
                                    .slice()
                                    .sort((a, b) => (b.ageHours ?? Infinity) - (a.ageHours ?? Infinity))
                                    .map((dealer) => (_jsxs("tr", { style: { borderTop: "1px solid rgba(255,255,255,0.06)" }, children: [_jsx("td", { style: { padding: "8px 10px", fontWeight: 700, color: "#f8fafc" }, children: dealer.dealerId }), _jsx("td", { style: { padding: "8px 10px", color: "#94a3b8", fontFamily: "monospace", fontSize: 11 }, children: dealer.latestTimestamp ?? "—" }), _jsx("td", { style: { padding: "8px 10px", color: "#cbd5e1" }, children: dealer.ageHours !== null ? `~${dealer.ageHours}h` : "unknown" }), _jsx("td", { style: { padding: "8px 10px" }, children: _jsx("span", { style: { color: dealer.stale ? SEVERITY_COLOR.warn : SEVERITY_COLOR.ok, fontWeight: 700 }, children: dealer.stale ? "Stale" : "Fresh" }) })] }, dealer.dealerId))) })] }))] })] }));
}
