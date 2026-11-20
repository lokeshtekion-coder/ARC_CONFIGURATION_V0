import type { ExtendedStoreRecord } from "../../Stores";
import type { StoreEvaluatedState } from "../types";
import { calculateDiffDays } from "./timeline";
import { isNotWorkedByArc, readinessStage } from "../../../services/storeAssessment";

export function evaluateDependencies(t90Stores: ExtendedStoreRecord[]): StoreEvaluatedState[] {
  const report: StoreEvaluatedState[] = [];

  for (const r of t90Stores) {
    const notWorked = (r.not_worked || "").trim();
    const diffDays = calculateDiffDays(r.launch_date);

    const isTotallyExcluded =
      notWorked === "Fixed + Variable handled by POD" ||
      notWorked === "Fixed + Variable OFS";
    if (isTotallyExcluded || isNotWorkedByArc(r)) continue;

    const variableBlockers: string[] = [];
    const partsBpDone = r.blueprint_statuses?.parts === "COMPLETED";
    const serviceBpDone = r.blueprint_statuses?.service === "COMPLETED";
    const acctBpDone = r.blueprint_statuses?.accounting === "COMPLETED";

    const fixedStatus = (r.fixed_ops_status || "TO DO").trim();
    const varStatus = (r.variable_ops_status || "TO DO").trim();
    const fixedOwner = (r.custom_assignee || "").trim();
    const varOwner = (r.custom_variable_assignee || "").trim();

    const fixedOpsExempted =
      notWorked === "Fixed Ops handled by POD" ||
      notWorked === "Fixed Ops OFS";
    const varOpsExempted =
      notWorked === "Variable Ops handled by POD" ||
      notWorked === "Variable Ops OFS";

    const isFixedConfigurable = ["TO DO", "WIP"].includes(fixedStatus);
    const isVarConfigurable = ["TO DO", "WIP"].includes(varStatus);

    const fixedOpsBpUnblocked = partsBpDone && serviceBpDone;
    const isFixedPending = !fixedOpsExempted && isFixedConfigurable;

    const fixedOpsReadyToConfigure = isFixedPending && fixedOpsBpUnblocked && Boolean(fixedOwner);
    const fixedOpsUnassignedAlert = isFixedPending && fixedOpsBpUnblocked && !fixedOwner;

    const fixedAttCount = r.fixed_ops_attachments ?? 0;
    const fixedOpsMissingAttachments =
      fixedStatus === "Completed" && !fixedOpsExempted && fixedAttCount === 0;

    let variableOpsReadyToConfigure = false;
    let variableOpsUnassignedAlert = false;

    if (!varOpsExempted && isVarConfigurable) {
      const fixedOpsSatisfied = fixedStatus === "Completed" || fixedOpsExempted;

      if (!acctBpDone) {
        variableBlockers.push(
          `Accounting Blueprint is [${r.blueprint_statuses?.accounting || "NOT_YET_STARTED"}]`
        );
      }
      if (!fixedOpsSatisfied) {
        variableBlockers.push(
          `Fixed Ops is still [${fixedStatus}] (not Completed and not POD/OFS)`
        );
      }

      // Same readiness rule as the Stores table: blueprints, Fixed Ops, Accounting blueprint, COA and ACCTS counts.
      const readiness = readinessStage(r);
      if (acctBpDone && fixedOpsSatisfied && readiness.stage !== "READY") {
        variableBlockers.push(readiness.label);
      }
      if (acctBpDone && fixedOpsSatisfied && readiness.stage === "READY") {
        if (varOwner) {
          variableOpsReadyToConfigure = true;
        } else {
          variableOpsUnassignedAlert = true;
        }
      }
    }

    const hasAnalytics = (r.product_types || "").toLowerCase().includes("analytics");
    const analyticsBpDone = r.blueprint_statuses?.analytics === "COMPLETED";
    const analyticsEscalated =
      hasAnalytics &&
      !analyticsBpDone &&
      diffDays >= 0 &&
      diffDays <= 2;

    if (
      fixedOpsReadyToConfigure ||
      fixedOpsUnassignedAlert ||
      variableOpsReadyToConfigure ||
      variableOpsUnassignedAlert ||
      variableBlockers.length > 0 ||
      fixedOpsMissingAttachments ||
      analyticsEscalated
    ) {
      report.push({
        dealerId: r.dealer_id,
        dbaName: r.dba_name || "Unknown Dealer",
        timeline: diffDays < 0 ? "Launched" : `T-${diffDays}`,
        diffDays,
        fixedOpsStatus: fixedStatus,
        variableOpsStatus: varStatus,
        fixedAssignee: fixedOwner || "Unassigned",
        varAssignee: varOwner || "Unassigned",
        notWorked: notWorked || "Handled by ARC",
        fixedOpsReadyToConfigure,
        fixedOpsUnassignedAlert,
        variableOpsReadyToConfigure,
        variableOpsUnassignedAlert,
        fixedOpsMissingAttachments,
        variableBlockers,
        analyticsEscalated,
      });
    }
  }

  return report;
}

export function buildStoreDossier(r: ExtendedStoreRecord) {
  const diffDays = calculateDiffDays(r.launch_date);
  return {
    tekionId: r.tekion_id,
    dealerId: r.dealer_id,
    dbaName: r.dba_name || "Unknown Dealer",
    launchDate: r.launch_date || "Unknown",
    timeline: diffDays < 0 ? `Launched (+${Math.abs(diffDays)}d)` : `T-${diffDays}`,
    diffDays,
    superpod: r.superpod_id || "Unassigned",
    productTypes: r.product_types || "—",
    notWorkedTag: r.not_worked || "Handled by ARC",
    fixedOps: {
      status: r.fixed_ops_status || "TO DO",
      assignee: r.custom_assignee || "Unassigned",
      attachments: r.fixed_ops_attachments ?? 0,
      partsBlueprint: r.blueprint_statuses?.parts ?? "UNKNOWN",
      serviceBlueprint: r.blueprint_statuses?.service ?? "UNKNOWN",
    },
    variableOps: {
      status: r.variable_ops_status || "TO DO",
      assignee: r.custom_variable_assignee || "Unassigned",
      attachments: r.variable_ops_attachments ?? 0,
      accountingBlueprint: r.blueprint_statuses?.accounting ?? "UNKNOWN",
    },
    analytics: {
      inProductTypes: (r.product_types || "").toLowerCase().includes("analytics"),
      blueprintStatus: r.blueprint_statuses?.analytics ?? "UNKNOWN",
    },
    testingStatus: r.testing_status || "TO DO",
    setup: {
      isComplete: Boolean(
        r.setup_data &&
          (r.setup_data.oemDealerCodes?.length ?? 0) > 0 &&
          (r.setup_data.journalsAccessibleDealerCount ?? 0) > 0 &&
          (r.setup_data.coaAccessibleDealerCount ?? 0) > 0 &&
          (r.setup_data.salesChainsAccessibleDealerCount ?? 0) > 0
      ),
      oemCodes: r.setup_data?.oemDealerCodes || [],
      journals: r.setup_data?.journalsAccessibleDealerCount ?? 0,
      salesChains: r.setup_data?.salesChainsAccessibleDealerCount ?? 0,
      coa: r.setup_data?.coaAccessibleDealerCount ?? 0,
      error: r.setup_data_error || null,
    },
  };
}

export function buildFullT90Roster(stores: ExtendedStoreRecord[]): string {
  const header =
    "DLR|TEK|NAME|T_DAYS|FIX_ST|VAR_ST|FIX_OWN|VAR_OWN|PARTS|SERV|ACCT|AN|SETUP|NOT_WRK|FIX_ATT|TEST_ST";

  const rows = stores.map((s) => {
    const diff = calculateDiffDays(s.launch_date);
    const parts = s.blueprint_statuses?.parts === "COMPLETED" ? "DONE" : "PEND";
    const serv = s.blueprint_statuses?.service === "COMPLETED" ? "DONE" : "PEND";
    const acct = s.blueprint_statuses?.accounting === "COMPLETED" ? "DONE" : "PEND";

    const hasAn = (s.product_types || "").toLowerCase().includes("analytics");
    const an = !hasAn
      ? "NA"
      : s.blueprint_statuses?.analytics === "COMPLETED"
      ? "DONE"
      : "PEND";

    let setup = "OK";
    if (s.setup_data_error && s.setup_data_error.trim()) {
      setup = `ERR:${s.setup_data_error.replace(/\|/g, " ").slice(0, 18)}`;
    } else if (!s.setup_data) {
      setup = "NONE";
    }

    const fixAtt = s.fixed_ops_attachments ?? 0;
    const cleanName = (s.dba_name || "—").replace(/\|/g, "/").slice(0, 24);

    return [
      s.dealer_id,
      s.tekion_id,
      cleanName,
      diff,
      s.fixed_ops_status || "TO DO",
      s.variable_ops_status || "TO DO",
      s.custom_assignee || "NONE",
      s.custom_variable_assignee || "NONE",
      parts,
      serv,
      acct,
      an,
      setup,
      s.not_worked || "ARC",
      fixAtt,
      s.testing_status || "TO DO",
    ].join("|");
  });

  return [header, ...rows].join("\n");
}
