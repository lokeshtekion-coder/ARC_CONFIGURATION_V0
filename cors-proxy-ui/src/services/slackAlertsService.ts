import type { StoreRecord } from "./storesDb";
import {
  sendSlackChannelMessage,
  sendSlackDocument,
  getSlackSession,
} from "./storeSlackHelper";
import {
  ASSIGNEE_OPTIONS,
  loadAssignmentLog,
  resolveStoreAssignee,
} from "./assigneeService";
import {
  evaluateAnalyticsReport,
  evaluateFixedOpsReport,
  evaluateVariableOpsReport,
  generateHtmlReport,
  generateExcelAuditWorkbook,
} from "./slaReportGenerator";
import type { ExtendedStoreRecord } from "../pages/Stores";

/** Target Slack Channel for Bot-to-Bot & Operations Communication */
export const ALERT_CHANNEL_ID = "C0C5QBWEM8X";

const CONFIG_KEY = "arc-slack-alerts-config";
const STATE_KEY = "arc-slack-alerts-state";
const DIGEST_HOUR = 9; // local time (09:00 AM)

export const REPORTS_DISPATCH_KEY = "arc_last_3_reports_sent_ms";
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

export interface SlackAlertsConfig {
  statusAlerts: boolean;
  t7Alerts: boolean;
  dailyDigest: boolean;
  botToBotEvents: boolean;
}

interface AlertState {
  statuses: Record<string, { fixed?: string; variable?: string }>;
  t7Notified: Record<string, true>;
  digestDate: string;
  initialized: boolean;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadSlackAlertsConfig(): SlackAlertsConfig {
  return read<SlackAlertsConfig>(CONFIG_KEY, {
    statusAlerts: true,
    t7Alerts: true,
    dailyDigest: true,
    botToBotEvents: true,
  });
}

export function saveSlackAlertsConfig(c: SlackAlertsConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
}

function loadState(): AlertState {
  return read<AlertState>(STATE_KEY, {
    statuses: {},
    t7Notified: {},
    digestDate: "",
    initialized: false,
  });
}

function saveState(s: AlertState): void {
  localStorage.setItem(STATE_KEY, JSON.stringify(s));
}

function daysUntilLaunch(value: string): number | null {
  if (!value) return null;
  const d = /^\d+$/.test(value)
    ? new Date(value.length <= 10 ? Number(value) * 1000 : Number(value))
    : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((b - a) / 86400000);
}

const label = (s: StoreRecord) => `${s.dba_name} (${s.dealer_id} /${s.tekion_id})`;

let running = false;

export function isSlackSessionActive(): boolean {
  const session = getSlackSession();
  return Boolean(session.slackToken && session.slackDCookie);
}

export function shouldSendScheduledReports(): boolean {
  if (!isSlackSessionActive()) return false;
  const lastSent = Number(localStorage.getItem(REPORTS_DISPATCH_KEY) || 0);
  return Date.now() - lastSent >= FOUR_HOURS_MS;
}

/**
 * Dispatches all three reports (Analytics, Fixed Ops, Variable Ops) to Slack as HTML reports
 * AND attaches a unified 3-sheet XLSX Excel workbook.
 * Deduplicates using a 4-hour cooldown window unless options.force is set.
 */
export async function dispatchAllThreeReports(
  records: (StoreRecord | ExtendedStoreRecord)[],
  options: { force?: boolean } = {}
): Promise<{ sent: boolean; reason?: string }> {
  if (!records.length) {
    return { sent: false, reason: "No store records available" };
  }

  if (!isSlackSessionActive()) {
    return { sent: false, reason: "Slack session inactive (missing token/d-cookie)" };
  }

  if (!options.force && !shouldSendScheduledReports()) {
    return { sent: false, reason: "Inside 4-hour cooldown window" };
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

  // 1. Analytics Report (T-7 focus up to T-90)
  const analyticsData = evaluateAnalyticsReport(records as any);
  const analyticsHtml = generateHtmlReport(analyticsData);
  await sendSlackDocument({
    channelId: ALERT_CHANNEL_ID,
    fileName: `Analytics_Report_${dateStr}_${Date.now()}.html`,
    fileContent: analyticsHtml,
    title: `Analytics Report - ${dateStr}${timeStr}`,
    initialComment:
      `📊 *Analytics Status Report (Focus: T-7 to T-90)*\n` +
      `Total stores in scope: *${analyticsData.totalEvaluated}*\n` +
      `🚨 *High-Priority T-7 Stores:* *${analyticsData.priorityT7Count}* (due before T-1)\n` +
      `Analytics BP Completed: *${analyticsData.analyticsCompletedCount}* | In-Progress: *${analyticsData.analyticsInProgressCount}* \vert{} Not Started: *${analyticsData.analyticsNotStartedCount}*.`,
  });

  // 2. Fixed Ops Report (T-90, breaches <= 85d)
  const fixedOpsData = evaluateFixedOpsReport(records as any, 85);
  const fixedOpsHtml = generateHtmlReport(fixedOpsData);
  await sendSlackDocument({
    channelId: ALERT_CHANNEL_ID,
    fileName: `Fixed_Ops_SLA_Report_${dateStr}_${Date.now()}.html`,
    fileContent: fixedOpsHtml,
    title: `Fixed Ops SLA Report - ${dateStr}${timeStr}`,
    initialComment:
      `🔧 *Fixed Ops SLA Audit (T-90 Window)*\n` +
      `Total Evaluated: *${fixedOpsData.totalEvaluated}*\n` +
      `Breached (<= 85d to go-live): *${fixedOpsData.breachedCount}*\n` +
      `Blueprint Incomplete: Parts (*${fixedOpsData.partsBlueprintIncompleteCount}*), Service (*${fixedOpsData.serviceBlueprintIncompleteCount}*).`,
  });

  // 3. Variable Ops Report (T-65, standard breach <= 65d, critical escalation <= 55d)
  const variableOpsData = evaluateVariableOpsReport(records as any, 65, 55);
  const variableOpsHtml = generateHtmlReport(variableOpsData);
  await sendSlackDocument({
    channelId: ALERT_CHANNEL_ID,
    fileName: `Variable_Ops_SLA_Report_${dateStr}_${Date.now()}.html`,
    fileContent: variableOpsHtml,
    title: `Variable Ops SLA Report - ${dateStr}${timeStr}`,
    initialComment:
      `📈 *Variable Ops SLA Audit (T-65 Window)*\n` +
      `Total Evaluated: *${variableOpsData.totalEvaluated}*\n` +
      `Standard Breaches (<= 65d): *${variableOpsData.breachedCount}*\n` +
      `🚨 *Critical Escalations (<= 55d):* *${variableOpsData.criticalBreachedCount}*\n` +
      `⛔ *Blocked by Incomplete Fixed Ops:* *${variableOpsData.blockedByFixedOpsCount}*\n` +
      `Accounting Blueprint Incomplete: *${variableOpsData.accountingBlueprintIncompleteCount}*.`,
  });

  // 4. Unified 3-Sheet XLSX Excel Workbook
  try {
    const excelData = generateExcelAuditWorkbook(records as any);
    await sendSlackDocument({
      channelId: ALERT_CHANNEL_ID,
      fileName: `Operations_Audit_Report_${dateStr}_${Date.now()}.xlsx`,
      fileContent: excelData.base64,
      title: `Operations Audit Workbook - ${dateStr}${timeStr}`,
      isBase64: true,
      initialComment:
        `📗 *Unified Operations Audit Excel Spreadsheet* (${dateStr}${timeStr})\n` +
        `Includes 3 sheets: *Analytics (T-7 to T-90)*, *Fixed Ops (T-90)*, and *Variable Ops (T-65)*.\n` +
        `Directly viewable and editable in Microsoft Excel or Google Sheets.`,
    });
  } catch (excelErr) {
    console.error("[slackAlertsService] Excel report upload failed:", excelErr);
  }

  // Reset the shared 4-hour countdown
  localStorage.setItem(REPORTS_DISPATCH_KEY, String(Date.now()));

  return { sent: true };
}

export async function runSlackAlerts(records: StoreRecord[]): Promise<number> {
  if (running || records.length === 0) return 0;
  const cfg = loadSlackAlertsConfig();
  const state = loadState();
  const completedLines: string[] = [];
  const t7Lines: string[] = [];
  const machineEvents: Array<{
    event: "STATUS_COMPLETED" | "T7_REACHED";
    tekionId: string;
    dealerId: string;
    department?: "Fixed Ops" | "Variable Ops";
    daysUntil?: number;
  }> = [];

  for (const r of records) {
    const prev = state.statuses[r.tekion_id];
    const nowStatus = { fixed: r.fixed_ops_status, variable: r.variable_ops_status };

    if (state.initialized && prev) {
      if (prev.fixed === "WIP" && nowStatus.fixed === "Completed") {
        completedLines.push(`*Fixed Ops* WIP → *Completed* for ${label(r)}`);
        machineEvents.push({
          event: "STATUS_COMPLETED",
          tekionId: r.tekion_id,
          dealerId: r.dealer_id,
          department: "Fixed Ops",
        });
      }
      if (prev.variable === "WIP" && nowStatus.variable === "Completed") {
        completedLines.push(`*Variable Ops* WIP → *Completed* for ${label(r)}`);
        machineEvents.push({
          event: "STATUS_COMPLETED",
          tekionId: r.tekion_id,
          dealerId: r.dealer_id,
          department: "Variable Ops",
        });
      }
    }

    const days = daysUntilLaunch(r.launch_date);
    if (days !== null && days >= 0 && days <= 7 && !state.t7Notified[r.tekion_id]) {
      state.t7Notified[r.tekion_id] = true;
      if (state.initialized) {
        const timeLabel = days === 0 ? "TODAY" : `${days}d (T-${days})`;
        t7Lines.push(`${label(r)} launches in *${timeLabel}*`);
        machineEvents.push({
          event: "T7_REACHED",
          tekionId: r.tekion_id,
          dealerId: r.dealer_id,
          daysUntil: days,
        });
      }
    }

    state.statuses[r.tekion_id] = nowStatus;
  }

  const sections: string[] = [];
  if (cfg.statusAlerts && completedLines.length > 0) {
    sections.push(`✅ *Status Transitions (WIP → Completed)*\n${completedLines.join("\n")}`);
  }
  if (cfg.t7Alerts && t7Lines.length > 0) {
    sections.push(`⏰ *Entered T-7 Go-Live Window*\n${t7Lines.join("\n")}`);
  }

  if (cfg.botToBotEvents && machineEvents.length > 0) {
    sections.push(
      `\`\`\`json\n${JSON.stringify(
        { source: "arc-stores-bot", timestamp: new Date().toISOString(), events: machineEvents },
        null,
        2
      )}\n\`\`\``
    );
  }

  if (sections.length > 0) {
    if (!getSlackSession().slackToken) return 0;
    running = true;
    try {
      await sendSlackChannelMessage({
        channelId: ALERT_CHANNEL_ID,
        text: `🤖 *ARC Stores Bot Event Dispatch*\n\n${sections.join("\n\n")}`,
      });
    } catch (err) {
      console.warn("[slackAlerts] Message send to C0C5QBWEM8X failed, will retry on next change", err);
      return 0;
    } finally {
      running = false;
    }
  }

  state.initialized = true;
  saveState(state);
  return completedLines.length + t7Lines.length;
}

export function buildAssigneeDigest(records: StoreRecord[]): string {
  const counts = new Map<string, number>(ASSIGNEE_OPTIONS.map((n) => [n, 0]));
  let unassigned = 0;
  for (const r of records) {
    const a = resolveStoreAssignee(r);
    if (a && counts.has(a)) counts.set(a, (counts.get(a) ?? 0) + 1);
    else unassigned++;
  }

  const since = Date.now() - 24 * 3600 * 1000;
  const recent = loadAssignmentLog().filter((e) => new Date(e.at).getTime() >= since);
  const bot = recent.filter((e) => e.source === "bot").length;
  const manual = recent.length - bot;

  const rows = [...counts.entries()].map(([n, c]) => `${n}: *${c}*`).join("\n");
  return (
    `👥 *ARC Daily Assignee Digest* (${new Date().toLocaleDateString()})\n\n` +
    `${rows}\nUnassigned: *${unassigned}*\n\n` +
    `_Activity (Last 24h):_ ${bot} assigned by bot,${manual} changed manually/Excel.\n` +
    `_Active Stores in Scope:_ ${records.length}`
  );
}

export async function sendAssigneeDigest(records: StoreRecord[]): Promise<void> {
  await sendSlackChannelMessage({ channelId: ALERT_CHANNEL_ID, text: buildAssigneeDigest(records) });
}

export async function maybeSendDailyDigest(records: StoreRecord[]): Promise<boolean> {
  if (!loadSlackAlertsConfig().dailyDigest || records.length === 0) return false;
  const now = new Date();
  if (now.getHours() < DIGEST_HOUR || !getSlackSession().slackToken) return false;
  const today = now.toISOString().slice(0, 10);
  const state = loadState();
  if (state.digestDate === today) return false;
  try {
    await sendAssigneeDigest(records);
    saveState({ ...loadState(), digestDate: today });
    return true;
  } catch (err) {
    console.warn("[slackAlerts] Digest dispatch to C0C5QBWEM8X failed", err);
    return false;
  }
}

export interface BotSignalPayload {
  action: "SYNC_REQUEST" | "SNAPSHOT_PRUNED" | "SLA_ALERT" | "SETUP_COMPLETE";
  sender: "ARC_CONSOLE_BOT";
  metadata: Record<string, unknown>;
}

export async function broadcastBotSignal(payload: BotSignalPayload): Promise<void> {
  const text = `🤖 \`[BOT_SIGNAL]\` *${payload.action}*\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
  await sendSlackChannelMessage({ channelId: ALERT_CHANNEL_ID, text });
}