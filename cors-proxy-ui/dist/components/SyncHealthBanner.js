import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import { runDataSyncHealthCheck } from "../services/dataSyncBot";
import { subscribeToExtensionCapture } from "../services/extensionBridge";
const RECHECK_INTERVAL_MS = 60000;
const DISMISS_STORAGE_KEY = "arc-sync-health-banner-dismissed";
export function SyncHealthBanner({ onOpenSettings, onOpenDashboard }) {
    const [report, setReport] = useState(null);
    // Dismissal is per browser tab session, not per recheck - previously this
    // was keyed off report.checkedAt, which changes on every 60s recheck, so
    // the banner popped back up right after being dismissed. Now it stays
    // dismissed for the rest of the tab session once closed, and only comes
    // back if the page is reloaded.
    const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_STORAGE_KEY) === "1");
    const [expanded, setExpanded] = useState(false);
    const runCheck = useCallback(() => {
        void runDataSyncHealthCheck().then(setReport);
    }, []);
    useEffect(() => {
        runCheck();
        const interval = setInterval(runCheck, RECHECK_INTERVAL_MS);
        const unsubscribe = subscribeToExtensionCapture(() => runCheck());
        return () => {
            clearInterval(interval);
            unsubscribe();
        };
    }, [runCheck]);
    const handleDismiss = useCallback(() => {
        sessionStorage.setItem(DISMISS_STORAGE_KEY, "1");
        setDismissed(true);
    }, []);
    if (dismissed)
        return null;
    if (!report || report.alerts.length === 0)
        return null;
    const tone = report.overall === "critical" ? "critical" : "warn";
    return (_jsxs("div", { className: `sync-health-banner sync-health-banner--${tone}`, children: [_jsxs("div", { className: "sync-health-banner-row", children: [_jsx("span", { className: "sync-health-banner-icon", children: tone === "critical" ? "⛔" : "⚠️" }), _jsx("span", { className: "sync-health-banner-summary", children: report.alerts.length === 1
                            ? report.alerts[0].title
                            : `${report.alerts.length} data sync issues need attention` }), _jsxs("div", { className: "sync-health-banner-actions", children: [_jsx("button", { type: "button", className: "sync-health-banner-link", onClick: () => setExpanded((v) => !v), children: expanded ? "Hide details" : "Details" }), _jsx("button", { type: "button", className: "sync-health-banner-link", onClick: onOpenDashboard, children: "Open Dashboard" }), _jsx("button", { type: "button", className: "sync-health-banner-link", onClick: onOpenSettings, children: "Open Settings" }), _jsx("button", { type: "button", className: "sync-health-banner-link", onClick: runCheck, children: "Recheck" }), _jsx("button", { type: "button", className: "sync-health-banner-dismiss", onClick: handleDismiss, "aria-label": "Dismiss", children: "\u2715" })] })] }), expanded && (_jsx("ul", { className: "sync-health-banner-list", children: report.alerts.map((alert) => (_jsxs("li", { className: `sync-health-banner-item sync-health-banner-item--${alert.severity}`, children: [_jsx("span", { className: "sync-health-banner-item-title", children: alert.title }), _jsx("span", { className: "sync-health-banner-item-detail", children: alert.detail }), alert.actionUrl && (_jsxs("a", { className: "sync-health-banner-link", href: alert.actionUrl, target: "_blank", rel: "noreferrer", style: { display: "inline-block", marginTop: 4 }, children: [alert.actionLabel || "Open page", " \u2192"] }))] }, alert.id))) }))] }));
}
