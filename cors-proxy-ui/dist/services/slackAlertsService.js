import { sendSlackChannelMessage, sendSlackDocument, getSlackSession, } from "./storeSlackHelper";
import { evaluateAnalyticsReport, evaluateFixedOpsReport, evaluateVariableOpsReport, generateHtmlReport, generateExcelAuditWorkbook, isFixedOpsExcludedByNotWorked, isVariableOpsExcludedByNotWorked, } from "./slaReportGenerator_na";
/** Target Slack Channel for Bot-to-Bot & Operations Communication */
export const ALERT_CHANNEL_ID = "C0C5QBWEM8X";
const CONFIG_KEY = "arc-slack-alerts-config";
const STATE_KEY = "arc-slack-alerts-state";
const DIGEST_HOUR = 9; // local time (09:00 AM)
export const REPORTS_DISPATCH_KEY = "arc_last_3_reports_sent_ms";
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
function read(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
    }
    catch {
        return fallback;
    }
}
export function loadSlackAlertsConfig() {
    return read(CONFIG_KEY, {
        statusAlerts: true,
        t7Alerts: true,
        dailyDigest: true,
        botToBotEvents: true,
    });
}
export function saveSlackAlertsConfig(c) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
}
function loadState() {
    return read(STATE_KEY, {
        statuses: {},
        t7Notified: {},
        digestDate: "",
        initialized: false,
    });
}
function saveState(s) {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
}
function parseFlexibleDate(value) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed)
        return null;
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
function daysUntilLaunch(value) {
    const d = parseFlexibleDate(value);
    if (!d)
        return null;
    const now = new Date();
    const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const b = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return Math.round((b - a) / 86400000);
}
function getTLabel(days) {
    if (days > 0)
        return `T-${days}`;
    if (days === 0)
        return "T-0 (Launch Today)";
    return `Launched (+${Math.abs(days)}d)`;
}
function formatDisplayDate(date) {
    if (!date)
        return "—";
    const dd = `${date.getDate()}`.padStart(2, "0");
    const mm = `${date.getMonth() + 1}`.padStart(2, "0");
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}
const label = (s) => `${s.dba_name} (${s.dealer_id} /${s.tekion_id})`;
let running = false;
export function isSlackSessionActive() {
    const session = getSlackSession();
    return Boolean(session.slackToken && session.slackDCookie);
}
export function shouldSendScheduledReports() {
    if (!isSlackSessionActive())
        return false;
    const lastSent = Number(localStorage.getItem(REPORTS_DISPATCH_KEY) || 0);
    return Date.now() - lastSent >= FOUR_HOURS_MS;
}
/**
 * Dispatches all three reports (Analytics, Fixed Ops, Variable Ops) to Slack as HTML reports
 * AND attaches a unified 3-sheet XLSX Excel workbook.
 * Deduplicates using a 4-hour cooldown window unless options.force is set.
 */
export async function dispatchAllThreeReports(records, options = {}) {
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
    // 1. Analytics Report (Pending focus: T-7 up to T-90)
    const analyticsData = evaluateAnalyticsReport(records);
    const analyticsHtml = generateHtmlReport(analyticsData);
    await sendSlackDocument({
        channelId: ALERT_CHANNEL_ID,
        fileName: `Analytics_Report_${dateStr}_${Date.now()}.html`,
        fileContent: analyticsHtml,
        title: `Analytics Report - ${dateStr}${timeStr}`,
        initialComment: `📊 *Analytics Status Report (Focus: T-7 to T-90)*\n` +
            `Pending stores in scope: *${analyticsData.totalEvaluated}*\n` +
            `🚨 *High-Priority T-7 Stores:* *${analyticsData.priorityT7Count}* (due before T-1)\n` +
            `In-Progress: *${analyticsData.analyticsInProgressCount}* \vert{} Not Started / None: *${analyticsData.analyticsNotStartedCount}*.`,
    });
    // 2. Fixed Ops Report (T-90, breaches <= 85d)
    const fixedOpsData = evaluateFixedOpsReport(records, 85);
    const fixedOpsHtml = generateHtmlReport(fixedOpsData);
    await sendSlackDocument({
        channelId: ALERT_CHANNEL_ID,
        fileName: `Fixed_Ops_SLA_Report_${dateStr}_${Date.now()}.html`,
        fileContent: fixedOpsHtml,
        title: `Fixed Ops SLA Report - ${dateStr}${timeStr}`,
        initialComment: `🔧 *Fixed Ops SLA Audit (T-90 Window)*\n` +
            `Total Evaluated: *${fixedOpsData.totalEvaluated}*\n` +
            `Breached (<= 85d to go-live): *${fixedOpsData.breachedCount}*\n` +
            `Blueprint Incomplete: Parts (*${fixedOpsData.partsBlueprintIncompleteCount}*), Service (*${fixedOpsData.serviceBlueprintIncompleteCount}*).`,
    });
    // 3. Variable Ops Report (T-65, standard breach <= 65d, critical escalation <= 55d)
    const variableOpsData = evaluateVariableOpsReport(records, 65, 55);
    const variableOpsHtml = generateHtmlReport(variableOpsData);
    await sendSlackDocument({
        channelId: ALERT_CHANNEL_ID,
        fileName: `Variable_Ops_SLA_Report_${dateStr}_${Date.now()}.html`,
        fileContent: variableOpsHtml,
        title: `Variable Ops SLA Report - ${dateStr}${timeStr}`,
        initialComment: `📈 *Variable Ops SLA Audit (T-65 Window)*\n` +
            `Total Evaluated: *${variableOpsData.totalEvaluated}*\n` +
            `Standard Breaches (<= 65d): *${variableOpsData.breachedCount}*\n` +
            `🚨 *Critical Escalations (<= 55d):* *${variableOpsData.criticalBreachedCount}*\n` +
            `⛔ *Blocked by Incomplete Fixed Ops:* *${variableOpsData.blockedByFixedOpsCount}*\n` +
            `Accounting Blueprint Incomplete: *${variableOpsData.accountingBlueprintIncompleteCount}*.`,
    });
    // 4. Unified 3-Sheet XLSX Excel Workbook
    try {
        const excelData = generateExcelAuditWorkbook(records);
        await sendSlackDocument({
            channelId: ALERT_CHANNEL_ID,
            fileName: `Operations_Audit_Report_${dateStr}_${Date.now()}.xlsx`,
            fileContent: excelData.base64,
            title: `Operations Audit Workbook - ${dateStr}${timeStr}`,
            isBase64: true,
            initialComment: `📗 *Unified Operations Audit Excel Spreadsheet* (${dateStr}${timeStr})\n` +
                `Includes 3 sheets: *Pending Analytics (T-90)*, *Pending Fixed Ops (T-90)*, and *Pending Variable Ops (T-65)*.\n` +
                `Directly viewable and editable in Microsoft Excel or Google Sheets.`,
        });
    }
    catch (excelErr) {
        console.error("[slackAlertsService] Excel report upload failed:", excelErr);
    }
    // Reset the shared 4-hour countdown
    localStorage.setItem(REPORTS_DISPATCH_KEY, String(Date.now()));
    return { sent: true };
}
export async function runSlackAlerts(records) {
    if (running || records.length === 0)
        return 0;
    const cfg = loadSlackAlertsConfig();
    const state = loadState();
    const completedLines = [];
    const t7Lines = [];
    const machineEvents = [];
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
    const sections = [];
    if (cfg.statusAlerts && completedLines.length > 0) {
        sections.push(`✅ *Status Transitions (WIP → Completed)*\n${completedLines.join("\n")}`);
    }
    if (cfg.t7Alerts && t7Lines.length > 0) {
        sections.push(`⏰ *Entered T-7 Go-Live Window*\n${t7Lines.join("\n")}`);
    }
    if (cfg.botToBotEvents && machineEvents.length > 0) {
        sections.push(`\`\`\`json\n${JSON.stringify({ source: "arc-stores-bot", timestamp: new Date().toISOString(), events: machineEvents }, null, 2)}\n\`\`\``);
    }
    if (sections.length > 0) {
        if (!getSlackSession().slackToken)
            return 0;
        running = true;
        try {
            await sendSlackChannelMessage({
                channelId: ALERT_CHANNEL_ID,
                text: `🤖 *ARC Stores Bot Event Dispatch*\n\n${sections.join("\n\n")}`,
            });
        }
        catch (err) {
            console.warn("[slackAlerts] Message send to C0C5QBWEM8X failed, will retry on next change", err);
            return 0;
        }
        finally {
            running = false;
        }
    }
    state.initialized = true;
    saveState(state);
    return completedLines.length + t7Lines.length;
}
/**
 * Builds an actionable daily priority digest for each assignee:
 * Top 5 most critical Fixed Ops stores + Top 5 most critical Variable Ops stores.
 */
export function buildAssigneeDigest(records) {
    const todayDateStr = new Date().toLocaleDateString("en-US", {
        month: "numeric",
        day: "numeric",
        year: "numeric",
    });
    const assigneeSet = new Set();
    records.forEach((r) => {
        if (r.custom_assignee && r.custom_assignee.trim()) {
            assigneeSet.add(r.custom_assignee.trim());
        }
        if (r.custom_variable_assignee && r.custom_variable_assignee.trim()) {
            assigneeSet.add(r.custom_variable_assignee.trim());
        }
    });
    const assignees = Array.from(assigneeSet).sort();
    const lines = [
        `🎯 *ARC Daily Actionable Priority Digest (${todayDateStr})*`,
        `Focusing on the *Top 5 most urgent deadlines* per assignee for today.`,
        `────────────────────────────────────────`,
    ];
    for (const assignee of assignees) {
        const pendingFixed = [];
        const pendingVariable = [];
        for (const r of records) {
            const launchObj = parseFlexibleDate(r.launch_date);
            if (!launchObj)
                continue;
            const days = daysUntilLaunch(r.launch_date);
            if (days === null || days < 0)
                continue; // Skip launched stores
            const notWorked = r.not_worked || "";
            // Fixed Ops check
            const fixedOwner = (r.custom_assignee || "").trim();
            const fixedStatus = (r.fixed_ops_status || "TO DO").trim();
            const isFixedPending = fixedOwner === assignee &&
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
            // Variable Ops check
            const varOwner = (r.custom_variable_assignee || "").trim();
            const varStatus = (r.variable_ops_status || "TO DO").trim();
            const isVarPending = varOwner === assignee &&
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
        const top5Fixed = pendingFixed.slice(0, 5);
        const top5Variable = pendingVariable.slice(0, 5);
        lines.push(`\n👤 *${assignee}*`);
        // Fixed Ops Section
        lines.push(`  📦 *Fixed Ops Priority (Top ${top5Fixed.length} of${pendingFixed.length} pending):*`);
        if (top5Fixed.length > 0) {
            top5Fixed.forEach((s, idx) => {
                lines.push(`    ${idx + 1}. *#${s.dealerId}*${s.dbaName} • \`${s.tLabel}\` (${s.launchDate}) • [${s.status}]`);
            });
        }
        else {
            lines.push(`    _All assigned Fixed Ops stores completed or none pending._`);
        }
        // Variable Ops Section
        lines.push(`  📊 *Variable Ops Priority (Top ${top5Variable.length} of${pendingVariable.length} pending):*`);
        if (top5Variable.length > 0) {
            top5Variable.forEach((s, idx) => {
                lines.push(`    ${idx + 1}. *#${s.dealerId}*${s.dbaName} • \`${s.tLabel}\` (${s.launchDate}) • [${s.status}]`);
            });
        }
        else {
            lines.push(`    _All assigned Variable Ops stores completed or none pending._`);
        }
    }
    // Summary counts for unassigned work
    const unassignedFixed = records.filter((r) => !r.custom_assignee &&
        (r.fixed_ops_status || "TO DO").toLowerCase() !== "completed" &&
        !isFixedOpsExcludedByNotWorked(r.not_worked)).length;
    const unassignedVariable = records.filter((r) => !r.custom_variable_assignee &&
        (r.variable_ops_status || "TO DO").toLowerCase() !== "completed" &&
        !isVariableOpsExcludedByNotWorked(r.not_worked)).length;
    if (unassignedFixed > 0 || unassignedVariable > 0) {
        lines.push(`\n⚠️ *Unassigned Queue:*`);
        if (unassignedFixed > 0)
            lines.push(`• *Fixed Ops Unassigned:* ${unassignedFixed} pending store(s)`);
        if (unassignedVariable > 0)
            lines.push(`• *Variable Ops Unassigned:* ${unassignedVariable} pending store(s)`);
    }
    lines.push(`\n_Tip: Mark tasks completed in the Stores Tracker once verified to cycle in the next batch._`);
    return lines.join("\n");
}
export async function sendAssigneeDigest(records) {
    await sendSlackChannelMessage({ channelId: ALERT_CHANNEL_ID, text: buildAssigneeDigest(records) });
}
export async function maybeSendDailyDigest(records) {
    if (!loadSlackAlertsConfig().dailyDigest || records.length === 0)
        return false;
    const now = new Date();
    if (now.getHours() < DIGEST_HOUR || !getSlackSession().slackToken)
        return false;
    const today = now.toISOString().slice(0, 10);
    const state = loadState();
    if (state.digestDate === today)
        return false;
    try {
        await sendAssigneeDigest(records);
        saveState({ ...loadState(), digestDate: today });
        return true;
    }
    catch (err) {
        console.warn("[slackAlerts] Digest dispatch to C0C5QBWEM8X failed", err);
        return false;
    }
}
export async function broadcastBotSignal(payload) {
    const text = `🤖 \`[BOT_SIGNAL]\` *${payload.action}*\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``;
    await sendSlackChannelMessage({ channelId: ALERT_CHANNEL_ID, text });
}
