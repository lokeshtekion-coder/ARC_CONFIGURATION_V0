import { loadLatestExtensionCapture } from "./extensionBridge";
import { decodeJwt } from "../utils/jwt";

export type SyncHealthSeverity = "ok" | "warn" | "critical";

export interface SyncHealthAlert {
  id: string;
  severity: SyncHealthSeverity;
  title: string;
  detail: string;
}

export interface SyncHealthReport {
  alerts: SyncHealthAlert[];
  overall: SyncHealthSeverity;
  checkedAt: string;
}

export interface BotHealthDealerInfo {
  dealerId: string;
  latestTimestamp: string | null;
  ageHours: number | null;
  stale: boolean;
}

export interface BotHealthData {
  totalDealers: number;
  staleDealerCount: number;
  staleDealerIds: string[];
  newestSnapshotAgeHours: number | null;
  staleThresholdHours: number;
  dealers: BotHealthDealerInfo[];
}

interface BotHealthResponse {
  success: boolean;
  data?: BotHealthData;
  error?: string;
}

const EXPIRY_WARN_WINDOW_MS = 5 * 60 * 1000; // warn once a token has < 5m left
const MAX_DEALER_IDS_IN_DETAIL = 5;

function severityRank(severity: SyncHealthSeverity): number {
  return severity === "critical" ? 2 : severity === "warn" ? 1 : 0;
}

function summarizeDealerIds(ids: string[]): string {
  if (ids.length <= MAX_DEALER_IDS_IN_DETAIL) return ids.join(", ");
  const shown = ids.slice(0, MAX_DEALER_IDS_IN_DETAIL).join(", ");
  return `${shown}, and ${ids.length - MAX_DEALER_IDS_IN_DETAIL} more`;
}

function checkTokenFreshness(
  label: string,
  idPrefix: string,
  token: string | undefined,
  expiresAt: number | undefined,
  missingSeverity: SyncHealthSeverity,
  missingDetail: string
): SyncHealthAlert | null {
  if (!token) {
    return { id: `${idPrefix}-missing`, severity: missingSeverity, title: `${label} missing`, detail: missingDetail };
  }

  if (typeof expiresAt === "number") {
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      return { id: `${idPrefix}-expired`, severity: "critical", title: `${label} expired`, detail: missingDetail };
    }
    if (remainingMs <= EXPIRY_WARN_WINDOW_MS) {
      return {
        id: `${idPrefix}-expiring`,
        severity: "warn",
        title: `${label} expiring soon`,
        detail: `Expires in ~${Math.max(1, Math.round(remainingMs / 60000))}m - ${missingDetail}`,
      };
    }
  }

  return null;
}

function extractBearerToken(headerValue: string | undefined): string | undefined {
  if (!headerValue) return undefined;
  return headerValue.replace(/^Bearer\s+/i, "").trim() || undefined;
}

// Checks a captured header-map's "authorization" JWT for expiry, same as
// the graph/slack checks but for the three Tekion header captures + TapDuo.
function checkHeaderMapJwtFreshness(
  label: string,
  idPrefix: string,
  headers: Record<string, string> | undefined,
  missingDetail: string
): SyncHealthAlert | null {
  const token = extractBearerToken(headers?.authorization);
  if (!token) {
    return { id: `${idPrefix}-missing`, severity: "warn", title: `${label} missing`, detail: missingDetail };
  }

  const decoded = decodeJwt(token);
  if (decoded.error) return null; // not a decodable JWT - can't say anything useful, don't guess

  if (decoded.isExpired) {
    return { id: `${idPrefix}-expired`, severity: "critical", title: `${label} expired`, detail: missingDetail };
  }

  return null;
}

async function fetchBotHealth(): Promise<BotHealthData | null> {
  try {
    const res = await fetch("/api/bot/health");
    if (!res.ok) return null;
    const json = (await res.json()) as BotHealthResponse;
    return json.success && json.data ? json.data : null;
  } catch {
    // Backend not reachable - don't fail the whole report over it, just skip.
    return null;
  }
}

// Exposed separately (not just folded into alerts) so the dedicated
// dashboard page can render the full per-dealer table, not just a summary.
export async function fetchBotHealthDetail(): Promise<BotHealthData | null> {
  return fetchBotHealth();
}

export interface DeleteStaleSnapshotsResult {
  deleted: { dealerId: string; fileCount: number }[];
  skipped: string[];
}

// Manual cleanup only - call this from an explicit, user-confirmed dashboard
// action, never automatically. The backend independently re-verifies each
// dealer is still stale before deleting, so this can't be used to wipe fresh
// data even if the caller passes a stale list.
export async function deleteStaleSnapshots(dealerIds: string[]): Promise<DeleteStaleSnapshotsResult> {
  const res = await fetch("/api/bot/health/snapshots", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealerIds }),
  });

  const json = (await res.json()) as { success: boolean; data?: DeleteStaleSnapshotsResult; error?: string };
  if (!res.ok || !json.success || !json.data) {
    throw new Error(json.error || `Cleanup failed: HTTP ${res.status}`);
  }
  return json.data;
}

function checkBootstrapFreshness(data: BotHealthData | null): SyncHealthAlert | null {
  if (!data) return null;

  const { totalDealers, staleDealerCount, staleDealerIds, newestSnapshotAgeHours, staleThresholdHours } = data;

  if (totalDealers === 0) {
    return {
      id: "bootstrap-none",
      severity: "warn",
      title: "No bootstrap snapshots captured yet",
      detail: "Run a bootstrap/stores sync at least once to establish a baseline.",
    };
  }

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
export async function runDataSyncHealthCheck(): Promise<SyncHealthReport> {
  const capture = loadLatestExtensionCapture() ?? {};
  const alerts: SyncHealthAlert[] = [];

  const graphAlert = checkTokenFreshness(
    "Graph token",
    "graph",
    capture.graphApiToken,
    capture.graphExpiresAt,
    "critical",
    "open the SharePoint T-90 page in your browser so the extension can auto-capture a fresh one."
  );
  if (graphAlert) alerts.push(graphAlert);

  const slackTokenMissing = !capture.slackToken || !capture.slackDCookie;
  if (slackTokenMissing) {
    alerts.push({
      id: "slack-missing",
      severity: "warn",
      title: "Slack session not detected",
      detail: "Open or reload a Slack tab so the extension can capture your session.",
    });
  }

  if (!capture.tapDuoApiToken) {
    alerts.push({
      id: "tapduo-missing",
      severity: "warn",
      title: "TapDuo API token missing",
      // Captured as a byproduct of the Tekion Implementation/Bootstrap
      // header captures below (background.ts reads the "tap-duo-api-token"
      // header off those requests) - not from a dedicated TapDuo endpoint.
      // Used by blueprintFormsApi.ts (Blueprint Decode Bot) and
      // storeOnboardingStatusApi.ts (Stores onboarding status) as a
      // fallback auth header.
      detail: "Not captured yet - it piggybacks on the Tekion Implementation/Bootstrap header captures below, so visiting either of those pages will also populate this. Needed by Blueprint fetching and the Stores onboarding-status check.",
    });
  }

  const implementationAlert = checkHeaderMapJwtFreshness(
    "Tekion Implementation header",
    "tekion-implementation",
    capture.tekionImplementationHeaders,
    // Real consumers: blueprintFormsApi.ts (Blueprint Decode Bot fallback
    // headers) and storeOnboardingStatusApi.ts (Stores onboarding status).
    // Captured from any request to us-west1-tapapi.tekioncloud.com's
    // implementation-dealer-st endpoint.
    "used as a fallback auth header for Blueprint fetching and Stores onboarding status - reopen a Tekion Implementation/Dealer Setup page so the extension can re-capture it."
  );
  if (implementationAlert) alerts.push(implementationAlert);

  const bootstrapHeaderAlert = checkHeaderMapJwtFreshness(
    "Tekion Bootstrap header",
    "tekion-bootstrap",
    capture.tekionBootstrapHeaders,
    // Real consumers: Accounts_Payable_Settings.tsx (Phase 2 GL account
    // fetch) and Service/"Check in setup" - not unused, despite the name
    // suggesting it's just a freshness check.
    "used by Accounts Payable settings (Phase 2 GL fetch) and Service Check-in setup - reopen the Tekion accounting/bootstrap page so the extension can re-capture a fresh header."
  );
  if (bootstrapHeaderAlert) alerts.push(bootstrapHeaderAlert);

  const techMotorsAlert = checkHeaderMapJwtFreshness(
    "Tekion TechMotors header",
    "tekion-techmotors",
    capture.tekionProdTechMotorsHeaders,
    // Real consumers: Parts > Dealer Configuration and Parts > OEM ID
    // request views. Captured from app.tekioncloud.com's employee profile
    // endpoint specifically.
    "used by Parts > Dealer Configuration and Parts > OEM ID Request - reopen the Tekion employee profile page (app.tekioncloud.com) so the extension can re-capture a fresh header."
  );
  if (techMotorsAlert) alerts.push(techMotorsAlert);

  const botHealth = await fetchBotHealth();
  const bootstrapAlert = checkBootstrapFreshness(botHealth);
  if (bootstrapAlert) alerts.push(bootstrapAlert);

  alerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  const overall: SyncHealthSeverity = alerts.some((a) => a.severity === "critical")
    ? "critical"
    : alerts.some((a) => a.severity === "warn")
      ? "warn"
      : "ok";

  return { alerts, overall, checkedAt: new Date().toISOString() };
}
