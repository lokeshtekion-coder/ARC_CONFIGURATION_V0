import type { StoreRecord } from "./storesDb";
import { isNotWorkedByArc } from "./storeAssessment";
import { renderTapOverdueHtml } from "./tapOverdueHtmlReport";
import {
  sendSlackChannelMessage,
  sendSlackDocument,
  getSlackSession,
} from "./storeSlackHelper";
import {
  evaluateAnalyticsReport,
  evaluateFixedOpsReport,
  evaluateVariableOpsReport,
  generateHtmlReport,
  generateExcelAuditWorkbook,
  isFixedOpsExcludedByNotWorked,
  isVariableOpsExcludedByNotWorked,
} from "./slaReportGenerator_na";
import type { ExtendedStoreRecord } from "../pages/Stores";
import {
  formatDueDateInfo,
  fetchTapUsersMap,
  resolveTapAssigneeName,
  type TapTask,
} from "./tapTasksApi";

export const ALERT_CHANNEL_ID = "C0C5QBWEM8X";

const CONFIG_KEY = "arc-slack-alerts-config";
const STATE_KEY = "arc-slack-alerts-state";
const DIGEST_HOUR = 9;

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

interface PrioritizedStoreItem {
  tekionId: string;
  dealerId: string;
  dbaName: string;
  launchDate: string;
  tLabel: string;
  daysUntilLaunch: number;
  status: string;
}

export interface TapOverdueReportItem {
  dealerId: string;
  dbaName: string;
  tekionId: string;
  taskId: number;
  taskName: string;
  taskStatus: string;
  taskUrl: string;
  assigneeName: string;
  goLiveDate: string;
  goLiveTimestamp: number;
  goLiveTLabel: string;
  dueDate: string;
  dueDateTimestamp: number;
  daysRemaining: number;
  isOverdue: boolean;
  urgencyLevel: "CRITICAL_OVERDUE_NO_COMMENT" | "OVERDUE_WITH_COMMENT" | "T3_IMMINENT" | "T7_APPROACHING";
  latestCommentText: string;
  latestCommentAuthor: string;
  latestCommentTime: string;
  /** "integrations" rows come from the Integrations stage group; hidden in the report until ticked. */
  source?: "blueprint" | "integrations";
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

function parseFlexibleDate(value?: string): Date | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    const ms = trimmed.length <= 10 ? num * 1000 : num;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const cleaned = trimmed.replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+/i, "");
  const date = new Date(cleaned);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntilLaunch(value: string): number | null {
  const d = parseFlexibleDate(value);
  if (!d) return null;
  const now = new Date();
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((b - a) / 86400000);
}

function getTLabel(days: number): string {
  if (days > 0) return `T-${days}`;
  if (days === 0) return "T-0 (Launch Today)";
  return `Launched (+${Math.abs(days)}d)`;
}

function formatDisplayDate(date: Date | null): string {
  if (!date) return "—";
  const dd = `${date.getDate()}`.padStart(2, "0");
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function getEnrichedTaskName(task: TapTask, fallbackModule?: string): string {
  const rawName = (task.taskName || "").trim();
  const rawDesc = (task.descriptionPlain || "").toLowerCase();

  if (rawName.toLowerCase() === "blueprint configuration - accounting") {
    return "Blueprint Configuration - Accounting";
  }

  if (rawName.toLowerCase() === "blueprint configuration") {
    if (rawDesc.includes("parts blueprint") || fallbackModule === "parts") {
      return "Blueprint Configuration - Parts Blueprint";
    }
    if (rawDesc.includes("service blueprint") || fallbackModule === "service") {
      return "Blueprint Configuration - Service Blueprint";
    }
    if (rawDesc.includes("accounting blueprint") || fallbackModule === "accounting") {
      return "Blueprint Configuration - Accounting Blueprint";
    }
  }

  return rawName || "Blueprint Configuration";
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

  const analyticsData = evaluateAnalyticsReport(records as any);
  const analyticsHtml = generateHtmlReport(analyticsData);
  await sendSlackDocument({
    channelId: ALERT_CHANNEL_ID,
    fileName: `Analytics_Report_${dateStr}_${Date.now()}.html`,
    fileContent: analyticsHtml,
    title: `Analytics Report - ${dateStr}${timeStr}`,
    initialComment:
      `📊 *Analytics status (stores going live in the next 7 to 90 days)*\n` +
      `• Stores still open: *${analyticsData.totalEvaluated}*\n` +
      `• Due within 1 day or less: *${analyticsData.priorityT7Count}*\n` +
      `• In progress: *${analyticsData.analyticsInProgressCount}* · Not started: *${analyticsData.analyticsNotStartedCount}*\n` +
      `_Why: sent on the 4-hour schedule. The attached file has the full list._`,
  });

  const fixedOpsData = evaluateFixedOpsReport(records as any, 85);
  const fixedOpsHtml = generateHtmlReport(fixedOpsData);
  await sendSlackDocument({
    channelId: ALERT_CHANNEL_ID,
    fileName: `Fixed_Ops_SLA_Report_${dateStr}_${Date.now()}.html`,
    fileContent: fixedOpsHtml,
    title: `Fixed Ops SLA Report - ${dateStr}${timeStr}`,
    initialComment:
      `🔧 *Fixed Ops SLA check (stores 90 days or less from go-live)*\n` +
      `• Stores checked: *${fixedOpsData.totalEvaluated}*\n` +
      `• Past the 85-day target: *${fixedOpsData.breachedCount}*\n` +
      `• Blueprint still incomplete: Parts *${fixedOpsData.partsBlueprintIncompleteCount}* · Service *${fixedOpsData.serviceBlueprintIncompleteCount}*\n` +
      `_Why: Fixed Ops should be configured at least 85 days before go-live._`,
  });

  const variableOpsData = evaluateVariableOpsReport(records as any, 65, 55);
  const variableOpsHtml = generateHtmlReport(variableOpsData);
  await sendSlackDocument({
    channelId: ALERT_CHANNEL_ID,
    fileName: `Variable_Ops_SLA_Report_${dateStr}_${Date.now()}.html`,
    fileContent: variableOpsHtml,
    title: `Variable Ops SLA Report - ${dateStr}${timeStr}`,
    initialComment:
      `📈 *Variable Ops SLA check (stores 65 days or less from go-live)*\n` +
      `• Stores checked: *${variableOpsData.totalEvaluated}*\n` +
      `• Past the 65-day target: *${variableOpsData.breachedCount}*\n` +
      `• Critical (55 days or less): *${variableOpsData.criticalBreachedCount}*\n` +
      `• Waiting on Fixed Ops: *${variableOpsData.blockedByFixedOpsCount}*\n` +
      `• Accounting blueprint incomplete: *${variableOpsData.accountingBlueprintIncompleteCount}*\n` +
      `_Why: Variable Ops should be configured at least 65 days before go-live._`,
  });

  try {
    const excelData = generateExcelAuditWorkbook(records as any);
    await sendSlackDocument({
      channelId: ALERT_CHANNEL_ID,
      fileName: `Operations_Audit_Report_${dateStr}_${Date.now()}.xlsx`,
      fileContent: excelData.base64,
      title: `Operations Audit Workbook - ${dateStr}${timeStr}`,
      isBase64: true,
      initialComment:
        `📗 *Operations audit workbook* (${dateStr} ${timeStr})\n` +
        `Three tabs: Analytics (90 days), Fixed Ops (90 days), Variable Ops (65 days). Opens in Excel or Google Sheets.`,
    });
  } catch (excelErr) {
    console.error("[slackAlertsService] Excel report upload failed:", excelErr);
  }

  localStorage.setItem(REPORTS_DISPATCH_KEY, String(Date.now()));

  return { sent: true };
}

export async function runSlackAlerts(records: StoreRecord[]): Promise<number> {
  if (running || records.length === 0) return 0;
  const cfg = loadSlackAlertsConfig();
  const state = loadState();
  const completedLines: string[] = [];
  const t7Lines: string[] = [];

  for (const r of records) {
    // Decommissioned (Pre-Prod) or Enterprise stores are not worked by ARC: no alerts for them.
    if (isNotWorkedByArc(r)) continue;
    const prev = state.statuses[r.tekion_id];
    const nowStatus = { fixed: r.fixed_ops_status, variable: r.variable_ops_status };

    if (state.initialized && prev) {
      if (prev.fixed === "WIP" && nowStatus.fixed === "Completed") {
        completedLines.push(`• Fixed Ops finished for ${label(r)}`);
      }
      if (prev.variable === "WIP" && nowStatus.variable === "Completed") {
        completedLines.push(`• Variable Ops finished for ${label(r)}`);
      }
    }

    const days = daysUntilLaunch(r.launch_date);
    if (days !== null && days >= 0 && days <= 7 && !state.t7Notified[r.tekion_id]) {
      state.t7Notified[r.tekion_id] = true;
      if (state.initialized) {
        const timeLabel = days === 0 ? "TODAY" : `${days}d (T-${days})`;
        t7Lines.push(`• ${label(r)} goes live in ${timeLabel === "TODAY" ? "*today*" : `*${days} day${days === 1 ? "" : "s"}*`}`);
      }
    }

    state.statuses[r.tekion_id] = nowStatus;
  }

  const sections: string[] = [];
  if (cfg.statusAlerts && completedLines.length > 0) {
    sections.push(
      `✅ *Work finished since the last check*\n${completedLines.join("\n")}\n` +
        `_Why: a Fixed Ops or Variable Ops status moved from WIP to Completed._`
    );
  }
  if (cfg.t7Alerts && t7Lines.length > 0) {
    sections.push(
      `⏰ *Go-live is close*\n${t7Lines.join("\n")}\n` +
        `_Why: these stores entered the 7-day go-live window (T-7)._`
    );
  }

  if (sections.length > 0) {
    if (!getSlackSession().slackToken) return 0;
    running = true;
    try {
      await sendSlackChannelMessage({
        channelId: ALERT_CHANNEL_ID,
        text: `🔔 *Stores update*\n\n${sections.join("\n\n")}`,
      });
    } catch (err) {
      console.warn("[slackAlerts] Message send failed, will retry on next change", err);
      return 0;
    } finally {
      running = false;
    }
  }

  state.initialized = true;
  saveState(state);
  return completedLines.length + t7Lines.length;
}

export function buildAssigneeDigest(records: (StoreRecord | ExtendedStoreRecord)[]): string {
  const todayDateStr = new Date().toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "numeric",
  });

  const assigneeSet = new Set<string>();
  records.forEach((r: any) => {
    if (r.custom_assignee && r.custom_assignee.trim()) {
      assigneeSet.add(r.custom_assignee.trim());
    }
    if (r.custom_variable_assignee && r.custom_variable_assignee.trim()) {
      assigneeSet.add(r.custom_variable_assignee.trim());
    }
  });

  const assignees = Array.from(assigneeSet).sort();

  const lines: string[] = [
    `🎯 *Your priority list for ${todayDateStr}*`,
    `_Why you're getting this: every open store assigned to you, nearest go-live first._`,
  ];

  for (const assignee of assignees) {
    const pendingFixed: PrioritizedStoreItem[] = [];
    const pendingVariable: PrioritizedStoreItem[] = [];

    for (const r of records) {
      const launchObj = parseFlexibleDate(r.launch_date);
      if (!launchObj) continue;
      const days = daysUntilLaunch(r.launch_date);
      if (days === null || days < 0) continue;

      const notWorked = (r as any).not_worked || "";

      const fixedOwner = ((r as any).custom_assignee || "").trim();
      const fixedStatus = (r.fixed_ops_status || "TO DO").trim();
      const isFixedPending =
        fixedOwner === assignee &&
        fixedStatus.toLowerCase() !== "completed" &&
        !isFixedOpsExcludedByNotWorked(notWorked);

      if (isFixedPending) {
        pendingFixed.push({
          tekionId: r.tekion_id,
          dealerId: r.dealer_id,
          dbaName: r.dba_name || "Dealership",
          launchDate: formatDisplayDate(launchObj),
          tLabel: getTLabel(days),
          daysUntilLaunch: days,
          status: fixedStatus,
        });
      }

      const varOwner = ((r as any).custom_variable_assignee || "").trim();
      const varStatus = (r.variable_ops_status || "TO DO").trim();
      const isVarPending =
        varOwner === assignee &&
        varStatus.toLowerCase() !== "completed" &&
        !isVariableOpsExcludedByNotWorked(notWorked);

      if (isVarPending) {
        pendingVariable.push({
          tekionId: r.tekion_id,
          dealerId: r.dealer_id,
          dbaName: r.dba_name || "Dealership",
          launchDate: formatDisplayDate(launchObj),
          tLabel: getTLabel(days),
          daysUntilLaunch: days,
          status: varStatus,
        });
      }
    }

    if (pendingFixed.length === 0 && pendingVariable.length === 0) {
      continue;
    }

    pendingFixed.sort((a, b) => a.daysUntilLaunch - b.daysUntilLaunch);
    pendingVariable.sort((a, b) => a.daysUntilLaunch - b.daysUntilLaunch);


    lines.push(`\n👤 *${assignee}*`);

    lines.push(`📦 *Fixed Ops* — ${pendingFixed.length} open`);
    if (pendingFixed.length > 0) {
      pendingFixed.forEach((s, idx) => {
        lines.push(`${idx + 1}. *${s.dbaName}* (#${s.dealerId}) — ${s.tLabel}, go-live ${s.launchDate}, status: ${s.status}`);
      });
    } else {
      lines.push(`_Nothing open._`);
    }

    lines.push(`📊 *Variable Ops* — ${pendingVariable.length} open`);
    if (pendingVariable.length > 0) {
      pendingVariable.forEach((s, idx) => {
        lines.push(`${idx + 1}. *${s.dbaName}* (#${s.dealerId}) — ${s.tLabel}, go-live ${s.launchDate}, status: ${s.status}`);
      });
    } else {
      lines.push(`_Nothing open._`);
    }
  }

  const unassignedFixed = records.filter(
    (r: any) =>
      !r.custom_assignee &&
      (r.fixed_ops_status || "TO DO").toLowerCase() !== "completed" &&
      !isFixedOpsExcludedByNotWorked(r.not_worked)
  ).length;

  const unassignedVariable = records.filter(
    (r: any) =>
      !r.custom_variable_assignee &&
      (r.variable_ops_status || "TO DO").toLowerCase() !== "completed" &&
      !isVariableOpsExcludedByNotWorked(r.not_worked)
  ).length;

  if (unassignedFixed > 0 || unassignedVariable > 0) {
    lines.push(`\n⚠️ *No owner yet*`);
    if (unassignedFixed > 0) lines.push(`• Fixed Ops: ${unassignedFixed} open store(s)`);
    if (unassignedVariable > 0) lines.push(`• Variable Ops: ${unassignedVariable} open store(s)`);
  }

  lines.push(`\n_Tip: mark a store completed in the Stores Tracker once it is verified; it drops off this list on the next refresh._`);

  return lines.join("\n");
}

export async function sendAssigneeDigest(records: (StoreRecord | ExtendedStoreRecord)[]): Promise<void> {
  await sendSlackChannelMessage({ channelId: ALERT_CHANNEL_ID, text: buildAssigneeDigest(records) });
}

export async function maybeSendDailyDigest(records: (StoreRecord | ExtendedStoreRecord)[]): Promise<boolean> {
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
    console.warn("[slackAlerts] Digest dispatch failed", err);
    return false;
  }
}

export interface BotSignalPayload {
  action: "SYNC_REQUEST" | "SNAPSHOT_PRUNED" | "SLA_ALERT" | "SETUP_COMPLETE";
  sender: "ARC_CONSOLE_BOT";
  metadata: Record<string, unknown>;
}

export async function broadcastBotSignal(payload: BotSignalPayload): Promise<void> {
  const text = `🤖 *Bot signal: ${payload.action.replace(/_/g, " ").toLowerCase()}* from ${payload.sender}`;
  await sendSlackChannelMessage({ channelId: ALERT_CHANNEL_ID, text });
}

/**
 * Builds and dispatches the TAP Overdue & T-SLA Alert Report to Slack channel.
 * Dynamically accepts options.slaDaysWindow (from T-7 up to T-90). Defaults to 7.
 */
export async function dispatchTapOverdueReport(
  stores: (StoreRecord | ExtendedStoreRecord)[],
  options?: { channelId?: string; slaDaysWindow?: number }
): Promise<{ sent: boolean; totalFlagged: number; reason?: string }> {
  if (!isSlackSessionActive()) {
    return { sent: false, totalFlagged: 0, reason: "Slack session is inactive." };
  }

  const slaWindow = options?.slaDaysWindow ?? Number(localStorage.getItem("tap_sla_window_days") || 7);
  const usersMap = await fetchTapUsersMap();
  const flaggedTasks: TapOverdueReportItem[] = [];

  for (const s of stores) {
    const bp = (s as ExtendedStoreRecord).fetched_blueprint_tasks;
    if (!bp) continue;

    const launchObj = parseFlexibleDate(s.launch_date);
    const formattedGoLive = formatDisplayDate(launchObj);
    const goLiveDays = s.launch_date ? daysUntilLaunch(s.launch_date) : null;
    const goLiveT = goLiveDays !== null ? getTLabel(goLiveDays) : "—";
    const goLiveTs = launchObj ? launchObj.getTime() : Number.MAX_SAFE_INTEGER;

    const modules: Array<{ key: "parts" | "service" | "accounting"; list: TapTask[] }> = [
      { key: "parts", list: bp.partsTasks || [] },
      { key: "service", list: bp.serviceTasks || [] },
      { key: "accounting", list: bp.accountingTasks || [] },
    ];

    for (const mod of modules) {
      for (const t of mod.list) {
        const rawStatus = String(t.status || "new").toLowerCase();
        if (rawStatus === "completed" || rawStatus === "duplicate") continue;

        const dueInfo = formatDueDateInfo(t.dueDate);
        if (!dueInfo) continue;

        if (dueInfo.isOverdue || dueInfo.daysRemaining <= slaWindow) {
          // A comment only counts as an update if it was posted on or after the due date.
          const dueMs = t.dueDate ? (t.dueDate < 10000000000 ? t.dueDate * 1000 : t.dueDate) : 0;
          const commentMs = t.latestComment?.createdAt
            ? (t.latestComment.createdAt < 10000000000 ? t.latestComment.createdAt * 1000 : t.latestComment.createdAt)
            : 0;
          const hasComment = Boolean(t.latestComment?.content?.trim()) && commentMs >= dueMs;
          let urgency: TapOverdueReportItem["urgencyLevel"] = "T7_APPROACHING";

          if (dueInfo.isOverdue) {
            urgency = hasComment ? "OVERDUE_WITH_COMMENT" : "CRITICAL_OVERDUE_NO_COMMENT";
          } else if (dueInfo.daysRemaining <= 3) {
            urgency = "T3_IMMINENT";
          }

          const commentTime = t.latestComment?.createdAt
            ? new Date(
                t.latestComment.createdAt < 10000000000
                  ? t.latestComment.createdAt * 1000
                  : t.latestComment.createdAt
              ).toLocaleDateString([], { month: "short", day: "numeric" })
            : "";

          const author =
            typeof t.latestComment?.createdBy === "object"
              ? t.latestComment.createdBy.name || "User"
              : t.latestComment?.createdBy || "";

          const resolvedAssignee = resolveTapAssigneeName(t.assignee, usersMap);
          const enrichedName = getEnrichedTaskName(t, mod.key);
          const dueTs = t.dueDate ? (t.dueDate < 10000000000 ? t.dueDate * 1000 : t.dueDate) : Number.MAX_SAFE_INTEGER;

          flaggedTasks.push({
            dealerId: s.dealer_id || "—",
            dbaName: s.dba_name || "Dealership",
            tekionId: s.tekion_id,
            taskId: t.taskId,
            taskName: enrichedName,
            taskStatus: rawStatus,
            taskUrl: `https://tap.tekioncloud.com/tm/task/${t.taskId}`,
            assigneeName: resolvedAssignee,
            goLiveDate: formattedGoLive,
            goLiveTimestamp: goLiveTs,
            goLiveTLabel: goLiveT,
            dueDate: dueInfo.formattedDate,
            dueDateTimestamp: dueTs,
            daysRemaining: dueInfo.daysRemaining,
            isOverdue: dueInfo.isOverdue,
            urgencyLevel: urgency,
            latestCommentText: t.latestComment?.content || "None",
            latestCommentAuthor: author,
            latestCommentTime: commentTime,
          });
        }
      }
    }
  }

  if (flaggedTasks.length === 0) {
    return { sent: false, totalFlagged: 0, reason: `No overdue or T-${slaWindow} blueprint tasks found.` };
  }

  flaggedTasks.sort((a, b) => {
    if (a.goLiveTimestamp !== b.goLiveTimestamp) {
      return a.goLiveTimestamp - b.goLiveTimestamp;
    }
    return a.daysRemaining - b.daysRemaining;
  });

  const assigneeStats = new Map<
    string,
    { totalOverdue: number; criticalOverdue: number; inProgress: number; newStatus: number; dueSoon: number }
  >();

  for (const t of flaggedTasks) {
    const current = assigneeStats.get(t.assigneeName) || {
      totalOverdue: 0,
      criticalOverdue: 0,
      inProgress: 0,
      newStatus: 0,
      dueSoon: 0,
    };

    if (t.taskStatus === "inprogress") {
      current.inProgress++;
    } else {
      current.newStatus++;
    }

    if (t.isOverdue) {
      current.totalOverdue++;
      if (t.daysRemaining <= -7) {
        current.criticalOverdue++;
      }
    } else {
      current.dueSoon++;
    }
    assigneeStats.set(t.assigneeName, current);
  }

  const sortedAssignees = Array.from(assigneeStats.entries()).sort(
    (a, b) => b[1].totalOverdue - a[1].totalOverdue || b[1].dueSoon - a[1].dueSoon
  );

  const criticalNoCommentCount = flaggedTasks.filter((t) => t.urgencyLevel === "CRITICAL_OVERDUE_NO_COMMENT").length;
  const overdueCommentedCount = flaggedTasks.filter((t) => t.urgencyLevel === "OVERDUE_WITH_COMMENT").length;
  const t3Count = flaggedTasks.filter((t) => t.urgencyLevel === "T3_IMMINENT").length;
  const tUpcomingCount = flaggedTasks.filter((t) => !t.isOverdue).length;

  const statusLabel = (st: string) => (st === "inprogress" ? "In progress" : "Not started");
  const slaLabel = (t: TapOverdueReportItem) =>
    t.isOverdue ? `${Math.abs(t.daysRemaining)} day(s) overdue` : `due in ${t.daysRemaining} day(s)`;

  const tasksByAssignee = new Map<string, TapOverdueReportItem[]>();
  for (const t of flaggedTasks) {
    const list = tasksByAssignee.get(t.assigneeName) || [];
    list.push(t);
    tasksByAssignee.set(t.assigneeName, list);
  }

  const assigneeSections = sortedAssignees.map(([name, stats]) => {
    const items = tasksByAssignee.get(name) || [];
    const header =
      `👤 *${name}* — ${items.length} task(s)` +
      (stats.totalOverdue > 0 ? `, *${stats.totalOverdue} overdue*` : "");
    const rows = items.map((t) => {
      const comment =
        t.latestCommentText && t.latestCommentText !== "None"
          ? `\n      _Last comment${t.latestCommentAuthor ? ` by ${t.latestCommentAuthor}` : ""}: "${t.latestCommentText.trim().slice(0, 120)}${t.latestCommentText.trim().length > 120 ? "…" : ""}"_`
          : `\n      _No comment yet_`;
      return `  • *#${t.dealerId} ${t.dbaName}* — <${t.taskUrl}|${t.taskName.replace(/^Blueprint Configuration - /i, "")}>\n      ${statusLabel(t.taskStatus)} · ${slaLabel(t)} · go-live ${t.goLiveDate}${comment}`;
    });
    return [header, ...rows].join("\n");
  });

  const slackLines: string[] = [
    `🚨 *TAP blueprint tasks that need attention*`,
    `_Why you're getting this: these tasks are overdue or due within ${slaWindow} days. Overdue tasks with no comment posted after the due date need an owner update first._`,
    ``,
    `*${flaggedTasks.length}* task(s) across *${new Set(flaggedTasks.map((t) => t.dealerId)).size}* dealer(s)`,
    `🔴 Overdue, no update since due: *${criticalNoCommentCount}*  ·  ⚠️ Overdue, updated since due: *${overdueCommentedCount}*`,
    `🟠 Due in 0–3 days: *${t3Count}*  ·  🟡 Due within ${slaWindow} days: *${tUpcomingCount}*`,
    ``,
    ...assigneeSections.flatMap((sec) => [sec, ``]),
    `_Sorted by go-live date, earliest first. Click a task name to open it in TAP._`,
  ];

  await sendSlackChannelMessage({
    channelId: ALERT_CHANNEL_ID,
    text: slackLines.join("\n"),
  });

  // Full interactive report: every flagged task, no trimming.
  const htmlDocument = renderTapOverdueHtml({
    items: flaggedTasks,
    assignees: sortedAssignees,
    slaWindow,
  });

  const dateTag = new Date().toISOString().slice(0, 10);
  await sendSlackDocument({
    channelId: ALERT_CHANNEL_ID,
    fileName: `TAP_Overdue_Report_${dateTag}_${Date.now()}.html`,
    fileContent: htmlDocument,
    title: `TAP Overdue & T-${slaWindow} Report - ${dateTag}`,
    initialComment: `📄 *Complete Interactive HTML Audit Report attached* (${flaggedTasks.length} flagged tasks — Filter, sort, or click 'Export to Excel' to download spreadsheet).`,
  });

  return { sent: true, totalFlagged: flaggedTasks.length };
}

/**
 * Integration report: overdue tasks in the "Integrations" stage (due date passed and no comment
 * posted on or after the due date). Uses the integration_tasks saved by the Integration report tool.
 */
export async function dispatchIntegrationReport(
  stores: (StoreRecord | ExtendedStoreRecord)[],
  options?: { channelId?: string }
): Promise<{ sent: boolean; totalFlagged: number; reason?: string }> {
  if (!isSlackSessionActive()) {
    return { sent: false, totalFlagged: 0, reason: "Slack session is inactive." };
  }

  const usersMap = await fetchTapUsersMap();
  const flaggedTasks: TapOverdueReportItem[] = [];

  for (const s of stores) {
    const tasks = (s as ExtendedStoreRecord).integration_tasks?.tasks ?? [];
    if (tasks.length === 0) continue;

    const launchObj = parseFlexibleDate(s.launch_date);
    const formattedGoLive = formatDisplayDate(launchObj);
    const goLiveDays = s.launch_date ? daysUntilLaunch(s.launch_date) : null;
    const goLiveT = goLiveDays !== null ? getTLabel(goLiveDays) : "—";
    const goLiveTs = launchObj ? launchObj.getTime() : Number.MAX_SAFE_INTEGER;

    for (const t of tasks) {
      const rawStatus = String(t.status || "new").toLowerCase();
      if (rawStatus === "completed" || rawStatus === "duplicate") continue;
      const dueInfo = formatDueDateInfo(t.dueDate);
      if (!dueInfo || !dueInfo.isOverdue) continue;
      const dueMs = t.dueDate ? (t.dueDate < 10000000000 ? t.dueDate * 1000 : t.dueDate) : 0;
      const commentMs = t.latestComment?.createdAt
        ? (t.latestComment.createdAt < 10000000000 ? t.latestComment.createdAt * 1000 : t.latestComment.createdAt)
        : 0;
      const hasCommentAfterDue = Boolean(t.latestComment?.content?.trim()) && commentMs >= dueMs;
      if (hasCommentAfterDue) continue;

      flaggedTasks.push({
        dealerId: s.dealer_id || "—",
        dbaName: s.dba_name || "Dealership",
        tekionId: s.tekion_id,
        taskId: t.taskId,
        taskName: String(t.taskName || "").trim() || "Integration task",
        taskStatus: rawStatus,
        taskUrl: `https://tap.tekioncloud.com/tm/task/${t.taskId}`,
        assigneeName: resolveTapAssigneeName(t.assignee, usersMap),
        goLiveDate: formattedGoLive,
        goLiveTimestamp: goLiveTs,
        goLiveTLabel: goLiveT,
        dueDate: dueInfo.formattedDate,
        dueDateTimestamp: dueMs || Number.MAX_SAFE_INTEGER,
        daysRemaining: dueInfo.daysRemaining,
        isOverdue: true,
        urgencyLevel: "CRITICAL_OVERDUE_NO_COMMENT",
        latestCommentText: "None",
        latestCommentAuthor: "",
        latestCommentTime: "",
      });
    }
  }

  if (flaggedTasks.length === 0) {
    return { sent: false, totalFlagged: 0, reason: "No overdue integration tasks without a comment after due date." };
  }

  flaggedTasks.sort((a, b) => a.goLiveTimestamp - b.goLiveTimestamp || a.daysRemaining - b.daysRemaining);

  const byAssignee = new Map<string, TapOverdueReportItem[]>();
  for (const t of flaggedTasks) {
    const list = byAssignee.get(t.assigneeName) || [];
    list.push(t);
    byAssignee.set(t.assigneeName, list);
  }
  const sortedAssignees: Array<[string, { totalOverdue: number; criticalOverdue: number; inProgress: number; newStatus: number; dueSoon: number }]> =
    Array.from(byAssignee.entries())
      .map(([name, items]) => [
        name,
        {
          totalOverdue: items.length,
          criticalOverdue: items.filter((t) => t.daysRemaining <= -7).length,
          inProgress: items.filter((t) => t.taskStatus === "inprogress").length,
          newStatus: items.filter((t) => t.taskStatus !== "inprogress").length,
          dueSoon: 0,
        },
      ] as [string, { totalOverdue: number; criticalOverdue: number; inProgress: number; newStatus: number; dueSoon: number }])
      .sort((a, b) => b[1].totalOverdue - a[1].totalOverdue);

  const dealerCount = new Set(flaggedTasks.map((t) => t.dealerId)).size;
  const slackLines: string[] = [
    `🧩 *Integration tasks overdue with no update*`,
    `_Why you're getting this: these Integrations tasks are past due and have no comment posted after the due date._`,
    ``,
    `*${flaggedTasks.length}* task(s) across *${dealerCount}* dealer(s)`,
    ``,
    ...sortedAssignees.flatMap(([name, stats]) => {
      const items = byAssignee.get(name) || [];
      const rows = items.map(
        (t) =>
          `  • *#${t.dealerId} ${t.dbaName}* — <${t.taskUrl}|${t.taskName}> · ${Math.abs(t.daysRemaining)} day(s) overdue · go-live ${t.goLiveDate}`
      );
      return [`👤 *${name}* — ${stats.totalOverdue} overdue`, ...rows, ``];
    }),
  ];

  await sendSlackChannelMessage({ channelId: options?.channelId ?? ALERT_CHANNEL_ID, text: slackLines.join("\n") });

  const htmlDocument = renderTapOverdueHtml({
    items: flaggedTasks,
    assignees: sortedAssignees,
    slaWindow: 0,
  });
  const dateTag = new Date().toISOString().slice(0, 10);
  await sendSlackDocument({
    channelId: options?.channelId ?? ALERT_CHANNEL_ID,
    fileName: `Integration_Report_${dateTag}_${Date.now()}.html`,
    fileContent: htmlDocument,
    title: `Integration Report - ${dateTag}`,
    initialComment: `📄 *Integration report attached* (${flaggedTasks.length} overdue task(s)).`,
  });

  return { sent: true, totalFlagged: flaggedTasks.length };
}