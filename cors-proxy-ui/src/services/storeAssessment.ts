// Pure store assessment used by the Stores table, the Variable Ops SLA report and the bot.
// No network or UI imports here, so it can be used from anywhere without import cycles.
//
// Required items (every one must be met before a store is green):
//   1. Parts AND Service blueprints COMPLETED (Fixed Ops configured)
//   2. Fixed Ops tracker status Completed
//   3. Accounting blueprint COMPLETED
//   4. COA count (setup_data.coaAccessibleDealerCount) > 50
//   5. ACCTS count (MAP acct_dms_account_number count) > 50
//   6. Attachments present on the blueprint tasks (Fixed Ops and Accounting)
//
// Severity (what the user sees):
//   red    = at least one required item is missing (the list says which)
//   green  = every required item is met (ready to configure, in progress, or completed)
//   none   = not worked by ARC: decommissioned in Pre-Prod, Enterprise tenant, or both
//            trackers handled by POD / OFS

import type { StoreRecord } from "./storesDb";

export const READY_MIN_COUNT = 50;
export const VARIABLE_WINDOW_DAYS = 65;
export const FIXED_OPS_THRESHOLD_DAYS = 85;
export const VARIABLE_OPS_THRESHOLD_DAYS = 65;
export const VARIABLE_CRITICAL_DAYS = 55;
export const URGENT_DAYS = 7;

/** Tenants ARC never works. They are treated as "Enterprise" (not worked) by default. */
export const ENTERPRISE_TENANTS = new Set(["kengarffautomotive", "asburyautomotivemanagementllc"]);

export type ReadinessStage =
  | "DECOMMISSIONED"
  | "NOT_WORKED"
  | "BLUEPRINT_PENDING"
  | "FIXED_OPS_PENDING"
  | "ACCOUNTING_PENDING"
  | "COA_PENDING"
  | "ACCTS_PENDING"
  | "READY";

export type Severity = "red" | "amber" | "green" | "none";

export interface StoreAssessment {
  severity: Severity;
  /** Single most important line for the user. */
  headline: string;
  /** Every missing item (red) or the met state (green), most important first. */
  reasons: string[];
  stage: ReadinessStage;
  /** Short stage label, e.g. "Parts blueprint pending". */
  stageLabel: string;
  coa: number;
  accts: number;
  daysToGoLive: number | null;
  attachments: { fixed: number; variable: number; incomplete: boolean };
  /** True when ARC does not work this store (decommissioned or Enterprise). */
  decommissioned: boolean;
  /** Set when the store is Enterprise (by tenant or by Not Worked value). */
  enterprise: boolean;
}

const isCompleted = (status?: string) => String(status ?? "").trim().toUpperCase() === "COMPLETED";

const FIXED_EXCLUDED = new Set([
  "Enterprise",
  "Fixed Ops handled by POD",
  "Fixed + Variable handled by POD",
  "Fixed Ops OFS",
  "Fixed + Variable OFS",
]);
const VARIABLE_EXCLUDED = new Set([
  "Enterprise",
  "Variable Ops handled by POD",
  "Fixed + Variable handled by POD",
  "Variable Ops OFS",
  "Fixed + Variable OFS",
]);

export function fixedOpsExcluded(notWorked?: string): boolean {
  return FIXED_EXCLUDED.has(String(notWorked ?? "").trim());
}
export function variableOpsExcluded(notWorked?: string): boolean {
  return VARIABLE_EXCLUDED.has(String(notWorked ?? "").trim());
}

/** Pre-Prod environment marked Decommissioned: ARC does not work this dealer. */
export function isDecommissioned(store: StoreRecord): boolean {
  return /decommissioned/i.test(String(store.pre_production_environment_status ?? ""));
}

/** Tenant is one of the Enterprise tenants ARC never works. */
export function isEnterpriseTenant(store: StoreRecord): boolean {
  const tenant = String(store.tenant_code || (store as any).tenant_name || "").trim().toLowerCase();
  return ENTERPRISE_TENANTS.has(tenant);
}

/** Not Worked value after applying the Enterprise tenant default. */
export function effectiveNotWorked(store: StoreRecord): string {
  if (isEnterpriseTenant(store)) return "Enterprise";
  return String(store.not_worked ?? "").trim();
}

/** ARC does not work this store: decommissioned in Pre-Prod, or Enterprise. */
export function isNotWorkedByArc(store: StoreRecord): boolean {
  return isDecommissioned(store) || effectiveNotWorked(store) === "Enterprise";
}

export function partsBlueprintDone(store: StoreRecord): boolean {
  return isCompleted(store.blueprint_statuses?.parts);
}
export function serviceBlueprintDone(store: StoreRecord): boolean {
  return isCompleted(store.blueprint_statuses?.service);
}
export function fixedOpsBlueprintDone(store: StoreRecord): boolean {
  return partsBlueprintDone(store) && serviceBlueprintDone(store);
}
export function accountingBlueprintDone(store: StoreRecord): boolean {
  return isCompleted(store.blueprint_statuses?.accounting);
}

export function coaCount(store: StoreRecord): number {
  return Number(store.setup_data?.coaAccessibleDealerCount ?? 0) || 0;
}

export function acctsCount(store: StoreRecord): number {
  return Number(store.preprod_validation?.accountNumberCount ?? 0) || 0;
}

/**
 * Variable Ops data rule: ACCTS (MAP) above 50 means the store is done and is left out of the report
 * and the background fetch. COA is optional (its fetch often fails), so it never decides readiness.
 */
export function acctsReady(store: StoreRecord): boolean {
  return acctsCount(store) > READY_MIN_COUNT;
}

/**
 * Fixed Ops prerequisite: Done when the tracker is Completed, or the store is excluded because
 * POD / OFS handles Fixed Ops.
 */
export function fixedOpsPrerequisiteDone(store: StoreRecord): boolean {
  return isCompleted(store.fixed_ops_status) || fixedOpsExcluded(effectiveNotWorked(store));
}

/** Attachment counts: stored totals when present, otherwise summed from the fetched TAP tasks. */
export function attachmentsOf(store: StoreRecord): { fixed: number; variable: number; incomplete: boolean } {
  const tasks: any = store.fetched_blueprint_tasks ?? {};
  const sum = (list?: any[]) => (list ?? []).reduce((acc, t) => acc + Number(t?.taskAttachmentCount ?? 0), 0);
  const fixed = store.fixed_ops_attachments ?? sum(tasks.partsTasks) + sum(tasks.serviceTasks);
  const variable = store.variable_ops_attachments ?? sum(tasks.accountingTasks);
  return { fixed: Number(fixed) || 0, variable: Number(variable) || 0, incomplete: Boolean(store.attachments_incomplete) };
}

/** Calendar days from today to go-live. Null when the launch date cannot be read. */
export function daysToGoLive(store: StoreRecord, now = new Date()): number | null {
  const trimmed = String(store.launch_date ?? "").trim();
  if (!trimmed) return null;
  let d: Date;
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    d = new Date(trimmed.length <= 10 ? n * 1000 : n);
  } else {
    d = new Date(trimmed);
  }
  if (Number.isNaN(d.getTime())) return null;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startLaunch = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startLaunch - startToday) / 86_400_000);
}

/** Not yet launched (go-live today or later). Launched stores are not checked by ARC. */
export function isUpcoming(store: StoreRecord, now = new Date()): boolean {
  const days = daysToGoLive(store, now);
  return days !== null && days >= 0;
}

/** Stores in the Variable Ops window that are not completed, not worked by ARC, or handled elsewhere. */
export function isVariableScope(store: StoreRecord, now = new Date(), windowDays = VARIABLE_WINDOW_DAYS): boolean {
  if (isNotWorkedByArc(store)) return false;
  const days = daysToGoLive(store, now);
  if (days === null || days < 0 || days > windowDays) return false;
  if (isCompleted(store.variable_ops_status)) return false;
  return !variableOpsExcluded(effectiveNotWorked(store));
}

/** Which blueprint(s) are still pending, in words. */
function blueprintPendingLabel(store: StoreRecord): string {
  const p = partsBlueprintDone(store);
  const s = serviceBlueprintDone(store);
  if (!p && !s) return "Parts and Service blueprints pending";
  if (!p) return "Parts blueprint pending";
  return "Service blueprint pending";
}

/** Gate chain for the stage column. Labels carry only the facts, no thresholds in words. */
export function readinessStage(store: StoreRecord): { stage: ReadinessStage; label: string } {
  if (isDecommissioned(store)) {
    return { stage: "DECOMMISSIONED", label: "Decommissioned: not worked by ARC" };
  }
  if (isNotWorkedByArc(store)) {
    return { stage: "NOT_WORKED", label: "Enterprise tenant: not worked by ARC" };
  }
  if (!fixedOpsBlueprintDone(store)) {
    return { stage: "BLUEPRINT_PENDING", label: blueprintPendingLabel(store) };
  }
  const fixedStatus = String(store.fixed_ops_status ?? "TO DO").trim() || "TO DO";
  if (!isCompleted(fixedStatus)) {
    return { stage: "FIXED_OPS_PENDING", label: `Fixed Ops not completed (${fixedStatus})` };
  }
  if (!accountingBlueprintDone(store)) {
    return { stage: "ACCOUNTING_PENDING", label: "Accounting blueprint pending" };
  }
  const coa = coaCount(store);
  if (coa <= READY_MIN_COUNT) {
    return { stage: "COA_PENDING", label: `COA count ${coa}` };
  }
  const accts = acctsCount(store);
  if (accts <= READY_MIN_COUNT) {
    return { stage: "ACCTS_PENDING", label: `ACCTS count ${accts}` };
  }
  return { stage: "READY", label: "Ready to configure Accounting" };
}

const pluralDays = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/**
 * Lists every required item that is missing. Red when any is missing, green when none is.
 * The headline is the first missing item, prefixed with the go-live countdown when it is close.
 */
export function assessStore(store: StoreRecord, now = new Date()): StoreAssessment {
  const { stage, label } = readinessStage(store);
  const coa = coaCount(store);
  const accts = acctsCount(store);
  const days = daysToGoLive(store, now);
  const attachments = attachmentsOf(store);
  const decommissioned = isDecommissioned(store);
  const enterprise = effectiveNotWorked(store) === "Enterprise";
  const base = { stage, stageLabel: label, coa, accts, daysToGoLive: days, attachments, decommissioned, enterprise };

  if (decommissioned || enterprise) {
    const headline = decommissioned
      ? "Decommissioned: ARC does not work this dealer"
      : "Enterprise: ARC does not work this dealer";
    return { ...base, severity: "none", headline, reasons: [] };
  }
  const notWorked = effectiveNotWorked(store);
  if (fixedOpsExcluded(notWorked) && variableOpsExcluded(notWorked)) {
    return { ...base, severity: "none", headline: `Handled by ${notWorked}`, reasons: [] };
  }

  const fixedTracker = String(store.fixed_ops_status ?? "").trim();
  const fixedDone = isCompleted(fixedTracker);
  const fixedInProgress = fixedTracker.toUpperCase() === "WIP";
  const fixedRequired = !fixedOpsExcluded(notWorked);
  const fixedBp = fixedOpsBlueprintDone(store);
  const acctBp = accountingBlueprintDone(store);
  const varTracker = String(store.variable_ops_status ?? "").trim();
  const varDone = isCompleted(varTracker);
  const varStarted = varTracker.toUpperCase() === "WIP" || varDone;
  const varRequired = !variableOpsExcluded(notWorked);

  const missing: string[] = [];

  // Fixed Ops: blueprints, then the tracker
  if (fixedRequired) {
    if (!fixedBp) {
      missing.push(blueprintPendingLabel(store));
      if (fixedDone) missing.push("Fixed Ops is marked Completed, but the blueprint is not complete");
    } else if (!fixedDone) {
      missing.push(fixedInProgress ? "Fixed Ops is not completed (WIP)" : "Fixed Ops is not completed (TO DO)");
    }
  }

  // Variable Ops: Accounting blueprint, COA and ACCTS data
  if (varRequired) {
    if (varStarted && !fixedDone && fixedRequired) {
      missing.push(`Variable Ops started (${varTracker}) before Fixed Ops is Completed`);
    }
    if (!acctBp) missing.push("Accounting blueprint pending");
    if (!varDone) {
      if (coa <= READY_MIN_COUNT) missing.push(`COA count ${coa}`);
      if (accts <= READY_MIN_COUNT) missing.push(`ACCTS count ${accts}`);
    }
  }

  // Attachments on the blueprint tasks are evidence the work was documented
  if (fixedRequired && fixedBp && attachments.fixed === 0) {
    missing.push("No attachments on the Parts / Service blueprint tasks");
  }
  if (varRequired && acctBp && attachments.variable === 0) {
    missing.push("No attachments on the Accounting blueprint tasks");
  }
  if (attachments.incomplete) {
    missing.push("Attachment scan incomplete, so attachment counts may be low");
  }

  if (missing.length > 0) {
    const urgent = days !== null && days >= 0 && days <= VARIABLE_CRITICAL_DAYS;
    const prefix = urgent ? `Go-live in ${pluralDays(days as number)}: ` : "";
    return {
      ...base,
      severity: "red",
      headline: prefix + missing[0],
      reasons: missing,
    };
  }

  const greenText = varDone
    ? "Variable Ops is Completed"
    : varStarted
      ? "Variable Ops in progress"
      : days !== null && days >= 0 && days <= VARIABLE_CRITICAL_DAYS
        ? `Ready to configure Accounting (${pluralDays(days)} to go-live)`
        : "Ready to configure Accounting";
  return { ...base, severity: "green", headline: greenText, reasons: [greenText] };
}

export function severityRank(s: Severity): number {
  return { red: 3, amber: 2, green: 1, none: 0 }[s];
}
