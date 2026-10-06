import type { ExtendedStoreRecord } from "../Stores";
import type { StoreFact } from "../types/queryDsl";
import { calculateDiffDays } from "./timeline";

export function normalizeStoreRecord(r: ExtendedStoreRecord): StoreFact {
  const launchDays = calculateDiffDays(r.launch_date);
  const notWorkedRaw = (r.not_worked || "").trim();
  const nwLower = notWorkedRaw.toLowerCase();

  // Comprehensive OFS and POD exclusion detection
  const isOfs = nwLower.includes("ofs");
  const isPodHandled = nwLower.includes("handled by pod") || nwLower.includes("by pod");

  const isPodFixed =
    isOfs ||
    nwLower.includes("fixed ops handled by pod") ||
    nwLower.includes("fixed + variable");

  const isPodVariable =
    isOfs ||
    nwLower.includes("variable ops handled by pod") ||
    nwLower.includes("fixed + variable");

  const isFullyExcluded =
    nwLower === "ofs" ||
    nwLower.includes("fixed + variable handled by pod") ||
    nwLower.includes("fixed + variable ofs") ||
    (isPodFixed && isPodVariable);

  const partsBpDone = r.blueprint_statuses?.parts === "COMPLETED";
  const serviceBpDone = r.blueprint_statuses?.service === "COMPLETED";
  const acctBpDone = r.blueprint_statuses?.accounting === "COMPLETED";

  const fixedStatus = (r.fixed_ops_status || "TO DO").trim();
  const varStatus = (r.variable_ops_status || "TO DO").trim();

  const isFixedOpsUnblocked = partsBpDone && serviceBpDone;

  const fixedPrereqMet = fixedStatus === "Completed" || isPodFixed;
  const isVariableOpsBlocked =
    !isPodVariable &&
    ["TO DO", "WIP"].includes(varStatus) &&
    (!acctBpDone || !fixedPrereqMet);

  const hasAnalytics = (r.product_types || "").toLowerCase().includes("analytics");
  const analyticsBpDone = r.blueprint_statuses?.analytics === "COMPLETED";
  const isAnalyticsEscalated = hasAnalytics && !analyticsBpDone && launchDays >= 0 && launchDays <= 2;

  // A store is actionable by ARC if it is NOT excluded, unblocked, and pending
  const isActionableByArc =
    !isFullyExcluded &&
    !isPodFixed &&
    isFixedOpsUnblocked &&
    fixedStatus !== "Completed";

  const totalAttachments =
    r.fixed_ops_attachments ??
    ((r.fetched_blueprint_tasks?.partsTasks || []).reduce((acc: number, t: any) => acc + (t.taskAttachmentCount || 0), 0) +
      (r.fetched_blueprint_tasks?.serviceTasks || []).reduce((acc: number, t: any) => acc + (t.taskAttachmentCount || 0), 0));

  return {
    dealerId: r.dealer_id,
    tekionId: r.tekion_id,
    dbaName: r.dba_name || "Unknown",
    launchDays,
    fixedOpsStatus: fixedStatus,
    variableOpsStatus: varStatus,
    testingStatus: r.testing_status || "TO DO",
    partsBlueprint: r.blueprint_statuses?.parts || "NOT_YET_STARTED",
    serviceBlueprint: r.blueprint_statuses?.service || "NOT_YET_STARTED",
    accountingBlueprint: r.blueprint_statuses?.accounting || "NOT_YET_STARTED",
    analyticsBlueprint: r.blueprint_statuses?.analytics || "NOT_YET_STARTED",
    attachments: Number(totalAttachments || 0),
    assignee: r.custom_assignee ? String(r.custom_assignee).trim() : null,
    variableAssignee: r.custom_variable_assignee ? String(r.custom_variable_assignee).trim() : null,
    setupDataError: r.setup_data_error ? r.setup_data_error.trim() : null,
    notWorked: notWorkedRaw || null,
    isPodFixed,
    isPodVariable,
    isFullyExcluded,
    isFixedOpsUnblocked,
    isVariableOpsBlocked,
    isAnalyticsEscalated,
    isActionableByArc,
  };
}

export function normalizeStoreList(records: ExtendedStoreRecord[]): StoreFact[] {
  return records.map(normalizeStoreRecord);
}
