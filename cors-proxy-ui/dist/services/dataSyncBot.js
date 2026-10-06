import { loadLatestExtensionCapture } from "./extensionBridge";
import { decodeJwt } from "../utils/jwt";
// Real page URLs used to re-trigger each capture, kept in one place so the
// alert text and the "Open Page" links can't drift apart from each other.
const RECAPTURE_URLS = {
    sharePointT90: "https://tekion.sharepoint.com/:x:/r/sites/configteam/_layouts/15/Doc.aspx?sourcedoc=%7B5888FB41-2664-43BE-A422-A79E7D2E7FB6%7D&file=T-90%20Arc%20Dealerss.xlsx&action=default&mobileredirect=true",
    slack: "https://tekion.enterprise.slack.com",
    // TOC API (/getuserprofile) auto-captures from this page - see Settings.tsx.
    tapWorkorders: "https://tap.tekioncloud.com/workorders/list",
    techMotorsEmployeeProfile: "https://app.tekioncloud.com",
};
const EXPIRY_WARN_WINDOW_MS = 5 * 60 * 1000; // warn once a token has < 5m left
const MAX_DEALER_IDS_IN_DETAIL = 5;
function severityRank(severity) {
    return severity === "critical" ? 2 : severity === "warn" ? 1 : 0;
}
function summarizeDealerIds(ids) {
    if (ids.length <= MAX_DEALER_IDS_IN_DETAIL)
        return ids.join(", ");
    const shown = ids.slice(0, MAX_DEALER_IDS_IN_DETAIL).join(", ");
    return `${shown}, and ${ids.length - MAX_DEALER_IDS_IN_DETAIL} more`;
}
function checkTokenFreshness(label, idPrefix, token, expiresAt, missingSeverity, missingDetail, actionUrl, actionLabel) {
    if (!token) {
        return { id: `${idPrefix}-missing`, severity: missingSeverity, title: `${label} missing`, detail: missingDetail, actionUrl, actionLabel };
    }
    if (typeof expiresAt === "number") {
        const remainingMs = expiresAt - Date.now();
        if (remainingMs <= 0) {
            return { id: `${idPrefix}-expired`, severity: "critical", title: `${label} expired`, detail: missingDetail, actionUrl, actionLabel };
        }
        if (remainingMs <= EXPIRY_WARN_WINDOW_MS) {
            return {
                id: `${idPrefix}-expiring`,
                severity: "warn",
                title: `${label} expiring soon`,
                detail: `Expires in ~${Math.max(1, Math.round(remainingMs / 60000))}m - ${missingDetail}`,
                actionUrl,
                actionLabel,
            };
        }
    }
    return null;
}
function extractBearerToken(headerValue) {
    if (!headerValue)
        return undefined;
    return headerValue.replace(/^Bearer\s+/i, "").trim() || undefined;
}
// Checks a captured header-map's "authorization" JWT for expiry, same as
// the graph/slack checks but for the three Tekion header captures + TapDuo.
function checkHeaderMapJwtFreshness(label, idPrefix, headers, missingDetail, actionUrl, actionLabel) {
    const token = extractBearerToken(headers?.authorization);
    if (!token) {
        return { id: `${idPrefix}-missing`, severity: "warn", title: `${label} missing`, detail: missingDetail, actionUrl, actionLabel };
    }
    const decoded = decodeJwt(token);
    if (decoded.error)
        return null; // not a decodable JWT - can't say anything useful, don't guess
    if (decoded.isExpired) {
        return { id: `${idPrefix}-expired`, severity: "critical", title: `${label} expired`, detail: missingDetail, actionUrl, actionLabel };
    }
    return null;
}
// TOC API (/getuserprofile custom capture, see Settings.tsx) is now the
// primary auth source for Blueprint fetching and Stores onboarding status.
// TapDuo/Implementation headers are only a legacy fallback the code checks
// *after* TOC API - so they're only worth alerting on when TOC API is ALSO
// missing; otherwise the fallback is simply unused and the alert is noise.
function hasTocApiCapture(capture) {
    const captures = Object.values(capture.customCaptures ?? {});
    return captures.some((c) => {
        const pattern = (c.pattern || "").toLowerCase();
        const url = (c.matchedUrl || "").toLowerCase();
        return pattern.includes("getuserprofile") || url.includes("getuserprofile");
    });
}
async function fetchBotHealth() {
    try {
        const res = await fetch("/api/bot/health");
        if (!res.ok)
            return null;
        const json = (await res.json());
        return json.success && json.data ? json.data : null;
    }
    catch (err) {
        // Backend not reachable - don't fail the whole report over it, just skip,
        // but still log it once so "why is bootstrap data missing" is answerable
        // from the console instead of failing completely silently.
        console.warn("[dataSyncBot] Backend /api/bot/health unreachable:", err instanceof Error ? err.message : err);
        return null;
    }
}
// Exposed separately (not just folded into alerts) so the dedicated
// dashboard page can render the full per-dealer table, not just a summary.
export async function fetchBotHealthDetail() {
    return fetchBotHealth();
}
// Manual cleanup only - call this from an explicit, user-confirmed dashboard
// action, never automatically. The backend independently re-verifies each
// dealer is still stale before deleting, so this can't be used to wipe fresh
// data even if the caller passes a stale list.
export async function deleteStaleSnapshots(dealerIds) {
    const res = await fetch("/api/bot/health/snapshots", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dealerIds }),
    });
    const json = (await res.json());
    if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error || `Cleanup failed: HTTP ${res.status}`);
    }
    return json.data;
}
// Only ever warns about staleness/expiry of snapshots that already exist -
// "no snapshots yet" is not itself a problem (a dealer profile existing in
// Settings doesn't imply a bootstrap sync has been run, or needs to have
// been), so it's intentionally not flagged here.
function checkBootstrapFreshness(data) {
    if (!data)
        return null;
    const { staleDealerCount, staleDealerIds, newestSnapshotAgeHours, staleThresholdHours } = data;
    if (staleDealerCount > 0) {
        return {
            id: "bootstrap-stale",
            severity: "warn",
            title: `${staleDealerCount} dealer snapshot(s) are stale`,
            detail: `Newest snapshot is ~${newestSnapshotAgeHours ?? "?"}h old (stale threshold is ${staleThresholdHours}h). Stale dealers: ${summarizeDealerIds(staleDealerIds)}. Consider re-running the bootstrap/stores sync.`,
        };
    }
    return null;
}
// Report-only health check: never triggers a sync itself, only surfaces what
// looks stale/missing/expired so you can decide whether to re-sync.
export async function runDataSyncHealthCheck() {
    const capture = loadLatestExtensionCapture() ?? {};
    const alerts = [];
    const graphAlert = checkTokenFreshness("Graph token", "graph", capture.graphApiToken, capture.graphExpiresAt, "critical", "open the SharePoint T-90 page in your browser so the extension can auto-capture a fresh one.", RECAPTURE_URLS.sharePointT90, "Open T-90 SharePoint");
    if (graphAlert)
        alerts.push(graphAlert);
    const slackTokenMissing = !capture.slackToken || !capture.slackDCookie;
    if (slackTokenMissing) {
        alerts.push({
            id: "slack-missing",
            severity: "warn",
            title: "Slack session not detected",
            detail: "Open or reload a Slack tab so the extension can capture your session.",
            actionUrl: RECAPTURE_URLS.slack,
            actionLabel: "Open Slack",
        });
    }
    // TapDuo API token and the Tekion Implementation header are both legacy
    // fallbacks - Blueprint fetching and Stores onboarding status now prefer
    // the TOC API (/getuserprofile) custom capture (auto-selected as default
    // in Settings > TOC API). Only alert on these if TOC API is ALSO missing,
    // otherwise they're an unused fallback and the alert is just noise.
    const tocCaptured = hasTocApiCapture(capture);
    if (!tocCaptured && !capture.tapDuoApiToken) {
        alerts.push({
            id: "tapduo-missing",
            severity: "warn",
            title: "TapDuo API token missing",
            detail: "Not captured yet, and TOC API (/getuserprofile) hasn't been captured either - open TAP Workorders so the extension can capture TOC API, which covers Blueprint fetching and the Stores onboarding-status check.",
            actionUrl: RECAPTURE_URLS.tapWorkorders,
            actionLabel: "Open TAP Workorders",
        });
    }
    const implementationAlert = tocCaptured
        ? null
        : checkHeaderMapJwtFreshness("Tekion Implementation header", "tekion-implementation", capture.tekionImplementationHeaders, "TOC API (/getuserprofile) hasn't been captured either - open TAP Workorders so the extension can capture it; that covers Blueprint fetching and Stores onboarding status without needing this fallback header.", RECAPTURE_URLS.tapWorkorders, "Open TAP Workorders");
    if (implementationAlert)
        alerts.push(implementationAlert);
    const bootstrapHeaderAlert = checkHeaderMapJwtFreshness("Tekion Bootstrap header", "tekion-bootstrap", capture.tekionBootstrapHeaders, 
    // Real consumers: Accounts_Payable_Settings.tsx (Phase 2 GL account
    // fetch) and Service/"Check in setup" - not unused, despite the name
    // suggesting it's just a freshness check.
    "used by Accounts Payable settings (Phase 2 GL fetch) and Service Check-in setup - reopen the Tekion accounting/bootstrap page so the extension can re-capture a fresh header.");
    if (bootstrapHeaderAlert)
        alerts.push(bootstrapHeaderAlert);
    const techMotorsAlert = checkHeaderMapJwtFreshness("Tekion TechMotors header", "tekion-techmotors", capture.tekionProdTechMotorsHeaders, 
    // Real consumers: Parts > Dealer Configuration and Parts > OEM ID
    // request views. Captured from app.tekioncloud.com's employee profile
    // endpoint specifically.
    "used by Parts > Dealer Configuration and Parts > OEM ID Request - reopen the Tekion employee profile page (app.tekioncloud.com) so the extension can re-capture a fresh header.", RECAPTURE_URLS.techMotorsEmployeeProfile, "Open app.tekioncloud.com");
    if (techMotorsAlert)
        alerts.push(techMotorsAlert);
    const botHealth = await fetchBotHealth();
    const bootstrapAlert = checkBootstrapFreshness(botHealth);
    if (bootstrapAlert)
        alerts.push(bootstrapAlert);
    alerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
    const overall = alerts.some((a) => a.severity === "critical")
        ? "critical"
        : alerts.some((a) => a.severity === "warn")
            ? "warn"
            : "ok";
    return { alerts, overall, checkedAt: new Date().toISOString() };
}
