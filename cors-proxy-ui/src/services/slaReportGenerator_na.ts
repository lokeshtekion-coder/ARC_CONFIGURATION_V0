import {
  acctsCount,
  acctsReady,
  assessStore,
  attachmentsOf,
  coaCount,
  isNotWorkedByArc,
  type StoreAssessment,
} from "./storeAssessment";

/** Variable Ops scope: go-live from today through this many days. */
export const VARIABLE_OPS_SCOPE_DAYS = 90;

export type VariableOpsAction = "CONFIGURE_NOW" | "IN_PROGRESS" | "FETCH_AGAIN" | "BLOCKED_FIXED_OPS" | "HANDLED_ELSEWHERE";

export const ACTION_LABEL: Record<VariableOpsAction, string> = {
  CONFIGURE_NOW: "Configure now (ACCTS ok, Variable Ops not started)",
  IN_PROGRESS: "In progress (inform)",
  FETCH_AGAIN: "Fetch setup and MAP again (ACCTS 50 or below)",
  BLOCKED_FIXED_OPS: "Blocked by Fixed Ops",
  HANDLED_ELSEWHERE: "Handled by POD/OFS (not ARC)",
};

/**
 * What the user should do next for a Variable Ops store:
 * - Fixed Ops prerequisite not done: blocked, nothing to do yet.
 * - ACCTS 50 or below: fetch setup and MAP again.
 * - ACCTS above 50 and Variable Ops in progress: in progress (inform).
 * - ACCTS above 50 and Variable Ops not started: configure now.
 */
export function variableOpsActionFor(
  store: StoreRecord,
  fixedOpsPrerequisite: boolean,
  variableOpsStatus: string,
  excludedByPodOfs = false
): VariableOpsAction {
  if (excludedByPodOfs) return "HANDLED_ELSEWHERE";
  if (!fixedOpsPrerequisite) return "BLOCKED_FIXED_OPS";
  if (!acctsReady(store)) return "FETCH_AGAIN";
  const status = variableOpsStatus.trim().toLowerCase();
  if (status === "wip" || status.includes("progress")) return "IN_PROGRESS";
  return "CONFIGURE_NOW";
}
import { renderSlaReportHtml } from "./slaReportHtml";
import * as XLSX from "xlsx";
import type { StoreRecord } from "./storesDb";
import type { TapAttachmentItem } from "./tapTasksApi";

export type ReportType = "analytics" | "fixed_ops" | "variable_ops";

export interface SlaTaskDetailItem {
  taskId: number;
  taskName: string;
  status: string;
  department: string;
  attachmentCount: number;
  attachments: TapAttachmentItem[];
}

export interface BlueprintSummary {
  partsStatus?: string;
  partsCompleted: boolean;
  serviceStatus?: string;
  serviceCompleted: boolean;
  accountingStatus?: string;
  accountingCompleted: boolean;
  analyticsStatus?: string;
  analyticsNormalized: "COMPLETED" | "IN_PROGRESS" | "NOT_YET_STARTED" | "NONE";
}

export function isFixedOpsExcludedByNotWorked(notWorked?: string): boolean {
  const nw = String(notWorked || "").trim();
  return (
    nw === "Fixed Ops handled by POD" ||
    nw === "Fixed + Variable handled by POD" ||
    nw === "Fixed Ops OFS" ||
    nw === "Fixed + Variable OFS"
  );
}

export function isVariableOpsExcludedByNotWorked(notWorked?: string): boolean {
  const nw = String(notWorked || "").trim();
  return (
    nw === "Variable Ops handled by POD" ||
    nw === "Fixed + Variable handled by POD" ||
    nw === "Variable Ops OFS" ||
    nw === "Fixed + Variable OFS"
  );
}

export interface AnalyticsReportRecord {
  tekionId: string;
  dealerId: string;
  dbaName: string;
  launchDate: string;
  tLabel: string;
  daysUntilLaunch: number;
  superpodId: string;
  isPriorityT7: boolean;
  blueprint: BlueprintSummary;
  analyticsStatusLabel: string;
  notWorked: string;
}

export interface AnalyticsReportData {
  type: "analytics";
  title: string;
  windowLabel: string;
  items: AnalyticsReportRecord[];
  totalEvaluated: number;
  priorityT7Count: number;
  analyticsInProgressCount: number;
  analyticsNotStartedCount: number;
}

export interface FixedOpsReportRecord {
  tekionId: string;
  dealerId: string;
  dbaName: string;
  launchDate: string;
  tLabel: string;
  daysUntilLaunch: number;
  superpodId: string;
  fixedOpsStatus: string;
  isFixedOpsCompleted: boolean;
  isBreached: boolean;
  isExcluded: boolean;
  notWorked: string;
  blueprint: BlueprintSummary;
  partsAndServiceComplete: boolean;
  tasks: SlaTaskDetailItem[];
}

export interface FixedOpsReportData {
  type: "fixed_ops";
  title: string;
  windowLabel: string;
  items: FixedOpsReportRecord[];
  totalEvaluated: number;
  breachedCount: number;
  excludedCount: number;
  fixedOpsThresholdDays: number;
  partsBlueprintIncompleteCount: number;
  serviceBlueprintIncompleteCount: number;
}

export interface VariableOpsReportRecord {
  /** Readiness + conflict assessment (see storeAssessment.ts). */
  assessment: StoreAssessment;
  tekionId: string;
  dealerId: string;
  dbaName: string;
  launchDate: string;
  tLabel: string;
  daysUntilLaunch: number;
  superpodId: string;
  fixedOpsStatus: string;
  isFixedOpsCompleted: boolean;
  variableOpsStatus: string;
  isVariableOpsCompleted: boolean;
  isBreached: boolean;
  isCriticalBreached: boolean;
  isBlockedByFixedOps: boolean;
  isExcluded: boolean;
  notWorked: string;
  blueprint: BlueprintSummary;
  accountingComplete: boolean;
  /** Raw Accounting blueprint status text (shown as-is in the report). */
  accountingStatusText: string;
  /** What the user should do next for this store (see variableOpsActionFor). */
  action: VariableOpsAction;
  /** Attachments on the Accounting blueprint tasks. */
  accountingAttachmentCount: number;
  /** COA count (optional data; never decides readiness). */
  coaCount: number;
  /** ACCTS count from MAP (decides readiness: above 50 = done). */
  acctsCount: number;
  tasks: SlaTaskDetailItem[];
}

export interface VariableOpsReportData {
  type: "variable_ops";
  title: string;
  windowLabel: string;
  items: VariableOpsReportRecord[];
  /** Same as configureNowCount (kept for the existing callers). */
  needsActionCount: number;
  /** ARC-worked pending stores (excludes POD/OFS-handled). */
  pendingCount: number;
  configureNowCount: number;
  inProgressCount: number;
  fetchAgainCount: number;
  /** Open stores (not blocked) with no attachments on the Accounting blueprint tasks. */
  noAttachmentCount: number;
  totalEvaluated: number;
  breachedCount: number;
  criticalBreachedCount: number;
  blockedByFixedOpsCount: number;
  excludedCount: number;
  variableOpsThresholdDays: number;
  criticalThresholdDays: number;
  accountingBlueprintIncompleteCount: number;
}

function parseFlexibleDate(value: string): Date | null {
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

function formatDisplayDate(date: Date | null): string {
  if (!date) return "—";
  const dd = `${date.getDate()}`.padStart(2, "0");
  const mm = `${date.getMonth() + 1}`.padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function calculateDaysUntilLaunch(launchDateObj: Date): number {
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const launchStartDay = new Date(
    launchDateObj.getFullYear(),
    launchDateObj.getMonth(),
    launchDateObj.getDate()
  );
  return Math.round((launchStartDay.getTime() - startToday.getTime()) / 86400000);
}

function getTLabel(daysUntilLaunch: number): string {
  if (daysUntilLaunch > 0) return `T-${daysUntilLaunch}`;
  if (daysUntilLaunch === 0) return "T-0 (Launch Today)";
  return `Launched (+${Math.abs(daysUntilLaunch)}d)`;
}

function extractBlueprintSummary(store: StoreRecord): BlueprintSummary {
  const bp = store.blueprint_statuses || {};
  const isComplete = (status?: string) =>
    String(status || "").trim().toUpperCase() === "COMPLETED";

  const rawAnalytics = String(bp.analytics || "").trim().toUpperCase();
  let analyticsNormalized: "COMPLETED" | "IN_PROGRESS" | "NOT_YET_STARTED" | "NONE" = "NONE";

  if (rawAnalytics === "COMPLETED" || rawAnalytics === "COMPLETE") {
    analyticsNormalized = "COMPLETED";
  } else if (rawAnalytics === "IN_PROGRESS" || rawAnalytics === "WIP") {
    analyticsNormalized = "IN_PROGRESS";
  } else if (rawAnalytics === "NOT_YET_STARTED" || rawAnalytics === "NOT_STARTED") {
    analyticsNormalized = "NOT_YET_STARTED";
  }

  return {
    partsStatus: bp.parts,
    partsCompleted: isComplete(bp.parts),
    serviceStatus: bp.service,
    serviceCompleted: isComplete(bp.service),
    accountingStatus: bp.accounting,
    accountingCompleted: isComplete(bp.accounting),
    analyticsStatus: bp.analytics,
    analyticsNormalized,
  };
}

function extractTasksFromStore(
  store: StoreRecord & { fetched_blueprint_tasks?: any },
  departmentFilter?: "Parts" | "Service" | "Accounting" | "All"
): SlaTaskDetailItem[] {
  const tasks: SlaTaskDetailItem[] = [];
  const bp = store.fetched_blueprint_tasks;
  if (!bp) return tasks;

  const pushDepartment = (list: any[] | undefined, dept: string) => {
    if (!Array.isArray(list)) return;
    if (departmentFilter && departmentFilter !== "All" && departmentFilter !== dept) return;

    for (const t of list) {
      const attachments: TapAttachmentItem[] = Array.isArray(t.attachments) ? t.attachments : [];
      const attachmentCount = Number(t.taskAttachmentCount ?? attachments.length ?? 0);

      tasks.push({
        taskId: Number(t.taskId || t.id || 0),
        taskName: String(t.taskName || t.name || "Task"),
        status: String(t.status || "new").toUpperCase(),
        department: dept,
        attachmentCount,
        attachments,
      });
    }
  };

  pushDepartment(bp.partsTasks, "Parts");
  pushDepartment(bp.serviceTasks, "Service");
  pushDepartment(bp.accountingTasks, "Accounting");

  return tasks;
}

// ==========================================
// 1. ANALYTICS REPORT EVALUATOR (Focus on Pending: T-7 Priority to T-90)
// ==========================================
export function evaluateAnalyticsReport(
  records: Array<StoreRecord & { fetched_blueprint_tasks?: any }>,
  includeCompleted = false
): AnalyticsReportData {
  const items: AnalyticsReportRecord[] = [];
  let priorityT7Count = 0;
  let analyticsInProgressCount = 0;
  let analyticsNotStartedCount = 0;

  for (const store of records) {
    const launchDateObj = parseFlexibleDate(store.launch_date);
    if (!launchDateObj) continue;

    const daysUntilLaunch = calculateDaysUntilLaunch(launchDateObj);
    if (daysUntilLaunch < 0 || daysUntilLaunch > 90) continue;

    const bp = extractBlueprintSummary(store);

    // If we only focus on pending, skip already-completed blueprints
    if (!includeCompleted && bp.analyticsNormalized === "COMPLETED") {
      continue;
    }

    const isPriorityT7 = daysUntilLaunch <= 7;
    if (isPriorityT7) priorityT7Count++;

    if (bp.analyticsNormalized === "IN_PROGRESS") {
      analyticsInProgressCount++;
    } else if (bp.analyticsNormalized !== "COMPLETED") {
      analyticsNotStartedCount++;
    }

    let statusLabel = "Not Started / None";
    if (bp.analyticsNormalized === "COMPLETED") statusLabel = "Completed";
    else if (bp.analyticsNormalized === "IN_PROGRESS") statusLabel = "In Progress";

    items.push({
      tekionId: store.tekion_id,
      dealerId: store.dealer_id,
      dbaName: store.dba_name || "—",
      launchDate: formatDisplayDate(launchDateObj),
      tLabel: getTLabel(daysUntilLaunch),
      daysUntilLaunch,
      superpodId: store.superpod_id || "—",
      isPriorityT7,
      blueprint: bp,
      analyticsStatusLabel: statusLabel,
      notWorked: String(store.not_worked || "").trim(),
    });
  }

  items.sort((a, b) => {
    if (a.isPriorityT7 !== b.isPriorityT7) {
      return a.isPriorityT7 ? -1 : 1;
    }
    return a.daysUntilLaunch - b.daysUntilLaunch;
  });

  return {
    type: "analytics",
    title: "📊 Pending Analytics Readiness Report",
    windowLabel: "Actionable Focus: T-7 High Priority • Window: Up to T-90 Days",
    items,
    totalEvaluated: items.length,
    priorityT7Count,
    analyticsInProgressCount,
    analyticsNotStartedCount,
  };
}

// ==========================================
// 2. FIXED OPS REPORT EVALUATOR (Focus on Pending & Breaches <= 85d)
// ==========================================
export function evaluateFixedOpsReport(
  records: Array<StoreRecord & { fetched_blueprint_tasks?: any }>,
  thresholdDays = 85,
  includeCompleted = false
): FixedOpsReportData {
  const items: FixedOpsReportRecord[] = [];
  let breachedCount = 0;
  let excludedCount = 0;
  let partsIncomplete = 0;
  let serviceIncomplete = 0;

  for (const store of records) {
    if (isNotWorkedByArc(store)) continue; // ARC does not work decommissioned or Enterprise dealers
    const launchDateObj = parseFlexibleDate(store.launch_date);
    if (!launchDateObj) continue;

    const daysUntilLaunch = calculateDaysUntilLaunch(launchDateObj);
    if (daysUntilLaunch < 0 || daysUntilLaunch > 90) continue;

    const fixedOpsStatus = (store.fixed_ops_status || "TO DO").trim();
    const isFixedOpsCompleted = fixedOpsStatus.toLowerCase() === "completed";

    // Skip fully completed stores if focusing strictly on pending SLA items
    if (!includeCompleted && isFixedOpsCompleted) {
      continue;
    }

    const notWorked = String(store.not_worked || "").trim();
    const isExcluded = isFixedOpsExcludedByNotWorked(notWorked);
    if (isExcluded) excludedCount++;

    // Breached ONLY if not completed, not excluded, and inside threshold window
    const isBreached = !isExcluded && !isFixedOpsCompleted && daysUntilLaunch <= thresholdDays;
    if (isBreached) breachedCount++;

    const bp = extractBlueprintSummary(store);
    if (!bp.partsCompleted) partsIncomplete++;
    if (!bp.serviceCompleted) serviceIncomplete++;

    items.push({
      tekionId: store.tekion_id,
      dealerId: store.dealer_id,
      dbaName: store.dba_name || "—",
      launchDate: formatDisplayDate(launchDateObj),
      tLabel: getTLabel(daysUntilLaunch),
      daysUntilLaunch,
      superpodId: store.superpod_id || "—",
      fixedOpsStatus,
      isFixedOpsCompleted,
      isBreached,
      isExcluded,
      notWorked,
      blueprint: bp,
      partsAndServiceComplete: bp.partsCompleted && bp.serviceCompleted,
      tasks: [
        ...extractTasksFromStore(store, "Parts"),
        ...extractTasksFromStore(store, "Service"),
      ],
    });
  }

  items.sort((a, b) => {
    if (a.isBreached !== b.isBreached) return a.isBreached ? -1 : 1;
    return a.daysUntilLaunch - b.daysUntilLaunch;
  });

  return {
    type: "fixed_ops",
    title: "🔧 Pending Fixed Ops Audit & SLA Report",
    windowLabel: `Window: T-90 Days (SLA Breach Threshold: <= ${thresholdDays}d)`,
    items,
    totalEvaluated: items.length,
    breachedCount,
    excludedCount,
    fixedOpsThresholdDays: thresholdDays,
    partsBlueprintIncompleteCount: partsIncomplete,
    serviceBlueprintIncompleteCount: serviceIncomplete,
  };
}

// ==========================================
// 3. VARIABLE OPS REPORT EVALUATOR (Focus on Pending: standard <= 65d, critical <= 55d)
// ==========================================
export function evaluateVariableOpsReport(
  records: Array<StoreRecord & { fetched_blueprint_tasks?: any }>,
  standardThreshold = 65,
  criticalThreshold = 55,
  includeCompleted = false
): VariableOpsReportData {
  const items: VariableOpsReportRecord[] = [];
  let breachedCount = 0;
  let criticalBreachedCount = 0;
  let blockedByFixedOps = 0;
  let excludedCount = 0;
  let accountingIncomplete = 0;
  let readyExcludedCount = 0;

  for (const store of records) {
    if (isNotWorkedByArc(store)) continue; // ARC does not work decommissioned or Enterprise dealers
    const launchDateObj = parseFlexibleDate(store.launch_date);
    if (!launchDateObj) continue;

    const daysUntilLaunch = calculateDaysUntilLaunch(launchDateObj);
    // Scope: today through 90 days
    if (daysUntilLaunch < 0 || daysUntilLaunch > VARIABLE_OPS_SCOPE_DAYS) continue;

    const variableOpsStatus = (store.variable_ops_status || "TO DO").trim();
    const isVariableOpsCompleted = variableOpsStatus.toLowerCase() === "completed";

    // Focus strictly on not marked completed
    if (!includeCompleted && isVariableOpsCompleted) {
      continue;
    }


    const notWorked = String(store.not_worked || "").trim();
    const isExcluded = isVariableOpsExcludedByNotWorked(notWorked);
    if (isExcluded) excludedCount++;

    const fixedOpsStatus = (store.fixed_ops_status || "TO DO").trim();
    const fixedOpsHandledElsewhere = isFixedOpsExcludedByNotWorked(notWorked);
    const isFixedOpsCompleted =
      fixedOpsStatus.toLowerCase() === "completed" || fixedOpsHandledElsewhere;

    // Breached if pending, not excluded, and inside thresholds
    const isBreached = !isExcluded && !isVariableOpsCompleted && daysUntilLaunch <= standardThreshold;
    const isCriticalBreached = !isExcluded && !isVariableOpsCompleted && daysUntilLaunch <= criticalThreshold;

    if (isBreached) breachedCount++;
    if (isCriticalBreached) criticalBreachedCount++;

    const isBlocked = !isFixedOpsCompleted && !isExcluded;
    if (isBlocked) blockedByFixedOps++;

    const bp = extractBlueprintSummary(store);
    if (!bp.accountingCompleted) accountingIncomplete++;

    items.push({
      tekionId: store.tekion_id,
      dealerId: store.dealer_id,
      dbaName: store.dba_name || "—",
      launchDate: formatDisplayDate(launchDateObj),
      tLabel: getTLabel(daysUntilLaunch),
      daysUntilLaunch,
      superpodId: store.superpod_id || "—",
      fixedOpsStatus,
      isFixedOpsCompleted,
      variableOpsStatus,
      isVariableOpsCompleted,
      isBreached,
      isCriticalBreached,
      isBlockedByFixedOps: isBlocked,
      isExcluded,
      notWorked,
      blueprint: bp,
      accountingComplete: bp.accountingCompleted,
      accountingStatusText: String(bp.accountingStatus ?? "").trim() || "—",
      action: variableOpsActionFor(store, isFixedOpsCompleted, variableOpsStatus, isExcluded),
      accountingAttachmentCount: attachmentsOf(store).variable,
      coaCount: coaCount(store),
      acctsCount: acctsCount(store),
      assessment: assessStore(store),
      tasks: extractTasksFromStore(store, "Accounting"),
    });
  }

  const actionRank: Record<VariableOpsAction, number> = {
    CONFIGURE_NOW: 0,
    FETCH_AGAIN: 1,
    IN_PROGRESS: 2,
    BLOCKED_FIXED_OPS: 3,
    HANDLED_ELSEWHERE: 4,
  };
  items.sort((a, b) => {
    if (actionRank[a.action] !== actionRank[b.action]) return actionRank[a.action] - actionRank[b.action];
    if (a.isCriticalBreached !== b.isCriticalBreached) return a.isCriticalBreached ? -1 : 1;
    if (a.isBreached !== b.isBreached) return a.isBreached ? -1 : 1;
    return a.daysUntilLaunch - b.daysUntilLaunch;
  });
  const configureNowCount = items.filter((i) => i.action === "CONFIGURE_NOW").length;
  const inProgressCount = items.filter((i) => i.action === "IN_PROGRESS").length;
  const fetchAgainCount = items.filter((i) => i.action === "FETCH_AGAIN").length;
  const noAttachmentCount = items.filter(
    (i) => i.accountingAttachmentCount === 0 && i.action !== "BLOCKED_FIXED_OPS" && i.action !== "HANDLED_ELSEWHERE"
  ).length;
  // "All pending" counts ARC-worked stores only; POD/OFS-handled stores have their own tab.
  const pendingCount = items.filter((i) => !i.isExcluded).length;

  return {
    type: "variable_ops",
    title: "📈 Pending Variable Ops Audit & SLA Report",
    windowLabel: `Window: T-65 Days (SLA Breach <= ${standardThreshold}d, Critical Breach <= ${criticalThreshold}d)`,
    items,
    totalEvaluated: pendingCount,
    breachedCount,
    criticalBreachedCount,
    blockedByFixedOpsCount: blockedByFixedOps,
    excludedCount,
    variableOpsThresholdDays: standardThreshold,
    criticalThresholdDays: criticalThreshold,
    needsActionCount: configureNowCount,
    pendingCount,
    configureNowCount,
    inProgressCount,
    fetchAgainCount,
    noAttachmentCount,
    accountingBlueprintIncompleteCount: accountingIncomplete,
  };
}

// ==========================================
// 4. MULTI-TAB EXCEL WORKBOOK GENERATOR (.xlsx)
// ==========================================
export function generateExcelAuditWorkbook(
  records: Array<StoreRecord & { fetched_blueprint_tasks?: any }>
): {
  base64: string;
  buffer: Uint8Array;
} {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Analytics (Pending Only)
  const analyticsData = evaluateAnalyticsReport(records, false);
  const analyticsRows = analyticsData.items.map((item) => ({
    "Tekion ID": item.tekionId,
    "Dealer ID": item.dealerId,
    "Dealership Name": item.dbaName,
    "Go-Live Date": item.launchDate,
    "Timeline": item.tLabel,
    "Days to Go-Live": item.daysUntilLaunch,
    "POD": item.superpodId,
    "Not Worked?": item.notWorked || "Handled by ARC",
    "Priority Tier": item.isPriorityT7 ? "CRITICAL (<= T-7d)" : "Standard (T-8 to T-90d)",
    "Analytics Blueprint Status": item.analyticsStatusLabel,
  }));
  const wsAnalytics = XLSX.utils.json_to_sheet(analyticsRows);
  XLSX.utils.book_append_sheet(wb, wsAnalytics, "Pending Analytics (T-90)");

  // Sheet 2: Fixed Ops (Pending Only)
  const fixedOpsData = evaluateFixedOpsReport(records, 85, false);
  const fixedOpsRows = fixedOpsData.items.map((item) => {
    let slaText = "ON TRACK";
    if (item.isExcluded) slaText = `EXCLUDED (${item.notWorked})`;
    else if (item.isFixedOpsCompleted) slaText = "COMPLETED";
    else if (item.isBreached) slaText = "BREACHED";

    return {
      "Tekion ID": item.tekionId,
      "Dealer ID": item.dealerId,
      "Dealership Name": item.dbaName,
      "Go-Live Date": item.launchDate,
      "Timeline": item.tLabel,
      "Days to Go-Live": item.daysUntilLaunch,
      "POD": item.superpodId,
      "Not Worked?": item.notWorked || "Handled by ARC",
      "Fixed Ops Status": item.fixedOpsStatus,
      "SLA Status (<=85d)": slaText,
      "Parts Blueprint": item.blueprint.partsCompleted ? "Completed" : "Pending",
      "Service Blueprint": item.blueprint.serviceCompleted ? "Completed" : "Pending",
      "Both BP Complete": item.partsAndServiceComplete ? "YES" : "NO",
    };
  });
  const wsFixedOps = XLSX.utils.json_to_sheet(fixedOpsRows);
  XLSX.utils.book_append_sheet(wb, wsFixedOps, "Pending Fixed Ops (T-90)");

  // Sheet 3: Variable Ops (Pending Only)
  const variableOpsData = evaluateVariableOpsReport(records, 65, 55, false);
  const variableOpsRows = variableOpsData.items.map((item) => {
    let slaText = "ON TRACK";
    if (item.isExcluded) slaText = `EXCLUDED (${item.notWorked})`;
    else if (item.isVariableOpsCompleted) slaText = "COMPLETED";
    else if (item.isCriticalBreached) slaText = "CRITICAL (<=55d)";
    else if (item.isBreached) slaText = "BREACHED (<=65d)";

    return {
      "Tekion ID": item.tekionId,
      "Dealer ID": item.dealerId,
      "Dealership Name": item.dbaName,
      "Go-Live Date": item.launchDate,
      "Timeline": item.tLabel,
      "Days to Go-Live": item.daysUntilLaunch,
      "POD": item.superpodId,
      "Not Worked?": item.notWorked || "Handled by ARC",
      "Fixed Ops Prerequisite": item.isFixedOpsCompleted ? "Completed (Ready)" : "BLOCKED (Fixed Ops Incomplete)",
      "Variable Ops Status": item.variableOpsStatus,
      "SLA Status": slaText,
      "Accounting Blueprint": item.accountingStatusText,
      "COA Count": item.coaCount,
      "ACCTS Count (needs >50)": item.acctsCount,
      "Accounting Attachments": item.accountingAttachmentCount === 0 ? "MISSING" : item.accountingAttachmentCount,
      "Next Action": ACTION_LABEL[item.action],
    };
  });
  const wsVariableOps = XLSX.utils.json_to_sheet(variableOpsRows);
  XLSX.utils.book_append_sheet(wb, wsVariableOps, "Pending Variable Ops (T-90)");

  const base64 = XLSX.write(wb, { bookType: "xlsx", type: "base64" });
  const rawArray = XLSX.write(wb, { bookType: "xlsx", type: "array" });

  return { base64, buffer: new Uint8Array(rawArray) };
}

// ==========================================
// 5. HTML REPORT GENERATOR
// ==========================================

/** Standalone, all-rows HTML report (see slaReportHtml.ts). */
export function generateHtmlReport(
  reportData: AnalyticsReportData | FixedOpsReportData | VariableOpsReportData
): string {
  return renderSlaReportHtml(reportData);
}
