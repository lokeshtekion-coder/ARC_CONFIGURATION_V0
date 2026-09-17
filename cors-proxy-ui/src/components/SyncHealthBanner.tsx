import { useCallback, useEffect, useState } from "react";
import { runDataSyncHealthCheck, type SyncHealthReport } from "../services/dataSyncBot";
import { subscribeToExtensionCapture } from "../services/extensionBridge";

const RECHECK_INTERVAL_MS = 60_000;
const DISMISS_STORAGE_KEY = "arc-sync-health-banner-dismissed";

interface Props {
  onOpenSettings: () => void;
  onOpenDashboard: () => void;
}

export function SyncHealthBanner({ onOpenSettings, onOpenDashboard }: Props) {
  const [report, setReport] = useState<SyncHealthReport | null>(null);
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

  if (dismissed) return null;
  if (!report || report.alerts.length === 0) return null;

  const tone = report.overall === "critical" ? "critical" : "warn";

  return (
    <div className={`sync-health-banner sync-health-banner--${tone}`}>
      <div className="sync-health-banner-row">
        <span className="sync-health-banner-icon">{tone === "critical" ? "⛔" : "⚠️"}</span>
        <span className="sync-health-banner-summary">
          {report.alerts.length === 1
            ? report.alerts[0].title
            : `${report.alerts.length} data sync issues need attention`}
        </span>

        <div className="sync-health-banner-actions">
          <button type="button" className="sync-health-banner-link" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Hide details" : "Details"}
          </button>
          <button type="button" className="sync-health-banner-link" onClick={onOpenDashboard}>
            Open Dashboard
          </button>
          <button type="button" className="sync-health-banner-link" onClick={onOpenSettings}>
            Open Settings
          </button>
          <button type="button" className="sync-health-banner-link" onClick={runCheck}>
            Recheck
          </button>
          <button
            type="button"
            className="sync-health-banner-dismiss"
            onClick={handleDismiss}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>

      {expanded && (
        <ul className="sync-health-banner-list">
          {report.alerts.map((alert) => (
            <li key={alert.id} className={`sync-health-banner-item sync-health-banner-item--${alert.severity}`}>
              <span className="sync-health-banner-item-title">{alert.title}</span>
              <span className="sync-health-banner-item-detail">{alert.detail}</span>
              {alert.actionUrl && (
                <a
                  className="sync-health-banner-link"
                  href={alert.actionUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ display: "inline-block", marginTop: 4 }}
                >
                  {alert.actionLabel || "Open page"} →
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
