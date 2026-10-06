import * as XLSX from "xlsx";
export function isFixedOpsExcludedByNotWorked(notWorked) {
    const nw = String(notWorked || "").trim();
    return (nw === "Fixed Ops handled by POD" ||
        nw === "Fixed + Variable handled by POD" ||
        nw === "Fixed Ops OFS" ||
        nw === "Fixed + Variable OFS");
}
export function isVariableOpsExcludedByNotWorked(notWorked) {
    const nw = String(notWorked || "").trim();
    return (nw === "Variable Ops handled by POD" ||
        nw === "Fixed + Variable handled by POD" ||
        nw === "Variable Ops OFS" ||
        nw === "Fixed + Variable OFS");
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
function formatDisplayDate(date) {
    if (!date)
        return "—";
    const dd = `${date.getDate()}`.padStart(2, "0");
    const mm = `${date.getMonth() + 1}`.padStart(2, "0");
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}
function calculateDaysUntilLaunch(launchDateObj) {
    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const launchStartDay = new Date(launchDateObj.getFullYear(), launchDateObj.getMonth(), launchDateObj.getDate());
    return Math.round((launchStartDay.getTime() - startToday.getTime()) / 86400000);
}
function getTLabel(daysUntilLaunch) {
    if (daysUntilLaunch > 0)
        return `T-${daysUntilLaunch}`;
    if (daysUntilLaunch === 0)
        return "T-0 (Launch Today)";
    return `Launched (+${Math.abs(daysUntilLaunch)}d)`;
}
function extractBlueprintSummary(store) {
    const bp = store.blueprint_statuses || {};
    const isComplete = (status) => String(status || "").trim().toUpperCase() === "COMPLETED";
    const rawAnalytics = String(bp.analytics || "").trim().toUpperCase();
    let analyticsNormalized = "NONE";
    if (rawAnalytics === "COMPLETED" || rawAnalytics === "COMPLETE") {
        analyticsNormalized = "COMPLETED";
    }
    else if (rawAnalytics === "IN_PROGRESS" || rawAnalytics === "WIP") {
        analyticsNormalized = "IN_PROGRESS";
    }
    else if (rawAnalytics === "NOT_YET_STARTED" || rawAnalytics === "NOT_STARTED") {
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
function extractTasksFromStore(store, departmentFilter) {
    const tasks = [];
    const bp = store.fetched_blueprint_tasks;
    if (!bp)
        return tasks;
    const pushDepartment = (list, dept) => {
        if (!Array.isArray(list))
            return;
        if (departmentFilter && departmentFilter !== "All" && departmentFilter !== dept)
            return;
        for (const t of list) {
            const attachments = Array.isArray(t.attachments) ? t.attachments : [];
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
export function evaluateAnalyticsReport(records, includeCompleted = false) {
    const items = [];
    let priorityT7Count = 0;
    let analyticsInProgressCount = 0;
    let analyticsNotStartedCount = 0;
    for (const store of records) {
        const launchDateObj = parseFlexibleDate(store.launch_date);
        if (!launchDateObj)
            continue;
        const daysUntilLaunch = calculateDaysUntilLaunch(launchDateObj);
        if (daysUntilLaunch < 0 || daysUntilLaunch > 90)
            continue;
        const bp = extractBlueprintSummary(store);
        // If we only focus on pending, skip already-completed blueprints
        if (!includeCompleted && bp.analyticsNormalized === "COMPLETED") {
            continue;
        }
        const isPriorityT7 = daysUntilLaunch <= 7;
        if (isPriorityT7)
            priorityT7Count++;
        if (bp.analyticsNormalized === "IN_PROGRESS") {
            analyticsInProgressCount++;
        }
        else if (bp.analyticsNormalized !== "COMPLETED") {
            analyticsNotStartedCount++;
        }
        let statusLabel = "Not Started / None";
        if (bp.analyticsNormalized === "COMPLETED")
            statusLabel = "Completed";
        else if (bp.analyticsNormalized === "IN_PROGRESS")
            statusLabel = "In Progress";
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
export function evaluateFixedOpsReport(records, thresholdDays = 85, includeCompleted = false) {
    const items = [];
    let breachedCount = 0;
    let excludedCount = 0;
    let partsIncomplete = 0;
    let serviceIncomplete = 0;
    for (const store of records) {
        const launchDateObj = parseFlexibleDate(store.launch_date);
        if (!launchDateObj)
            continue;
        const daysUntilLaunch = calculateDaysUntilLaunch(launchDateObj);
        if (daysUntilLaunch < 0 || daysUntilLaunch > 90)
            continue;
        const fixedOpsStatus = (store.fixed_ops_status || "TO DO").trim();
        const isFixedOpsCompleted = fixedOpsStatus.toLowerCase() === "completed";
        // Skip fully completed stores if focusing strictly on pending SLA items
        if (!includeCompleted && isFixedOpsCompleted) {
            continue;
        }
        const notWorked = String(store.not_worked || "").trim();
        const isExcluded = isFixedOpsExcludedByNotWorked(notWorked);
        if (isExcluded)
            excludedCount++;
        // Breached ONLY if not completed, not excluded, and inside threshold window
        const isBreached = !isExcluded && !isFixedOpsCompleted && daysUntilLaunch <= thresholdDays;
        if (isBreached)
            breachedCount++;
        const bp = extractBlueprintSummary(store);
        if (!bp.partsCompleted)
            partsIncomplete++;
        if (!bp.serviceCompleted)
            serviceIncomplete++;
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
        if (a.isBreached !== b.isBreached)
            return a.isBreached ? -1 : 1;
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
export function evaluateVariableOpsReport(records, standardThreshold = 65, criticalThreshold = 55, includeCompleted = false) {
    const items = [];
    let breachedCount = 0;
    let criticalBreachedCount = 0;
    let blockedByFixedOps = 0;
    let excludedCount = 0;
    let accountingIncomplete = 0;
    for (const store of records) {
        const launchDateObj = parseFlexibleDate(store.launch_date);
        if (!launchDateObj)
            continue;
        const daysUntilLaunch = calculateDaysUntilLaunch(launchDateObj);
        if (daysUntilLaunch < 0 || daysUntilLaunch > standardThreshold)
            continue;
        const variableOpsStatus = (store.variable_ops_status || "TO DO").trim();
        const isVariableOpsCompleted = variableOpsStatus.toLowerCase() === "completed";
        // Focus strictly on not marked completed
        if (!includeCompleted && isVariableOpsCompleted) {
            continue;
        }
        const notWorked = String(store.not_worked || "").trim();
        const isExcluded = isVariableOpsExcludedByNotWorked(notWorked);
        if (isExcluded)
            excludedCount++;
        const fixedOpsStatus = (store.fixed_ops_status || "TO DO").trim();
        const fixedOpsHandledElsewhere = isFixedOpsExcludedByNotWorked(notWorked);
        const isFixedOpsCompleted = fixedOpsStatus.toLowerCase() === "completed" || fixedOpsHandledElsewhere;
        // Breached if pending, not excluded, and inside thresholds
        const isBreached = !isExcluded && !isVariableOpsCompleted && daysUntilLaunch <= standardThreshold;
        const isCriticalBreached = !isExcluded && !isVariableOpsCompleted && daysUntilLaunch <= criticalThreshold;
        if (isBreached)
            breachedCount++;
        if (isCriticalBreached)
            criticalBreachedCount++;
        const isBlocked = !isFixedOpsCompleted && !isExcluded;
        if (isBlocked)
            blockedByFixedOps++;
        const bp = extractBlueprintSummary(store);
        if (!bp.accountingCompleted)
            accountingIncomplete++;
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
            tasks: extractTasksFromStore(store, "Accounting"),
        });
    }
    items.sort((a, b) => {
        if (a.isCriticalBreached !== b.isCriticalBreached)
            return a.isCriticalBreached ? -1 : 1;
        if (a.isBreached !== b.isBreached)
            return a.isBreached ? -1 : 1;
        return a.daysUntilLaunch - b.daysUntilLaunch;
    });
    return {
        type: "variable_ops",
        title: "📈 Pending Variable Ops Audit & SLA Report",
        windowLabel: `Window: T-65 Days (SLA Breach <= ${standardThreshold}d, Critical Breach <= ${criticalThreshold}d)`,
        items,
        totalEvaluated: items.length,
        breachedCount,
        criticalBreachedCount,
        blockedByFixedOpsCount: blockedByFixedOps,
        excludedCount,
        variableOpsThresholdDays: standardThreshold,
        criticalThresholdDays: criticalThreshold,
        accountingBlueprintIncompleteCount: accountingIncomplete,
    };
}
// ==========================================
// 4. MULTI-TAB EXCEL WORKBOOK GENERATOR (.xlsx)
// ==========================================
export function generateExcelAuditWorkbook(records) {
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
        if (item.isExcluded)
            slaText = `EXCLUDED (${item.notWorked})`;
        else if (item.isFixedOpsCompleted)
            slaText = "COMPLETED";
        else if (item.isBreached)
            slaText = "BREACHED";
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
        if (item.isExcluded)
            slaText = `EXCLUDED (${item.notWorked})`;
        else if (item.isVariableOpsCompleted)
            slaText = "COMPLETED";
        else if (item.isCriticalBreached)
            slaText = "CRITICAL (<=55d)";
        else if (item.isBreached)
            slaText = "BREACHED (<=65d)";
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
            "Accounting Blueprint": item.blueprint.accountingCompleted ? "Completed" : "Pending",
        };
    });
    const wsVariableOps = XLSX.utils.json_to_sheet(variableOpsRows);
    XLSX.utils.book_append_sheet(wb, wsVariableOps, "Pending Variable Ops (T-65)");
    const base64 = XLSX.write(wb, { bookType: "xlsx", type: "base64" });
    const rawArray = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    return { base64, buffer: new Uint8Array(rawArray) };
}
// ==========================================
// 5. HTML REPORT GENERATOR
// ==========================================
export function generateHtmlReport(reportData) {
    const generatedAt = new Date().toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
    });
    const serializedData = JSON.stringify(reportData);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${reportData.title}</title>
  <style>
    :root {
      --bg: #0b0f17;
      --card-bg: #121824;
      --card-border: rgba(255, 255, 255, 0.08);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #38bdf8;
      --danger: #fb7185;
      --danger-bg: rgba(244, 63, 94, 0.12);
      --danger-border: rgba(244, 63, 94, 0.28);
      --success: #4ade80;
      --success-bg: rgba(74, 222, 128, 0.12);
      --warning: #fbbf24;
      --warning-bg: rgba(251, 191, 36, 0.12);
      --purple: #c084fc;
      --purple-bg: rgba(168, 85, 247, 0.12);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      padding: 24px;
      line-height: 1.4;
    }
    .header-panel {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 20px;
      gap: 16px;
      flex-wrap: wrap;
    }
    .header-title { font-size: 22px; font-weight: 800; color: #fff; }
    .header-subtitle { font-size: 13px; color: var(--text-muted); margin-top: 4px; }
    .header-actions { display: flex; gap: 8px; align-items: center; }
    .btn {
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid var(--card-border);
      background: var(--card-bg);
      color: var(--text);
      transition: all 0.15s ease;
    }
    .btn:hover { background: rgba(255,255,255,0.08); color: #fff; }
    .btn-copy { background: #0284c7; border-color: #38bdf8; color: #fff; }
    .btn-copy:hover { background: #0369a1; }
    .btn-copy.copied { background: #16a34a !important; border-color: #4ade80 !important; color: #fff !important; }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 14px 16px;
    }
    .kpi-label { font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--text-muted); }
    .kpi-value { font-size: 24px; font-weight: 800; margin-top: 6px; }
    .kpi-desc { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

    .toolbar-strip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      gap: 12px;
      flex-wrap: wrap;
    }
    .filter-pills { display: inline-flex; background: var(--card-bg); padding: 3px; border-radius: 8px; border: 1px solid var(--card-border); }
    .filter-pill {
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 700;
      border: none;
      background: transparent;
      color: var(--text-muted);
      cursor: pointer;
    }
    .filter-pill.active { background: #1e293b; color: var(--accent); }
    .records-count { font-size: 12px; color: var(--text-muted); }
    .records-count strong { color: #fff; }

    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      overflow-x: auto;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; text-align: left; }

    .th-title-row th {
      background: #141b27;
      color: #94a3b8;
      padding: 12px 10px 6px 10px;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: none;
      white-space: nowrap;
    }
    .th-filter-row th {
      background: #101622;
      padding: 4px 10px 12px 10px;
      border-bottom: 2px solid rgba(255, 255, 255, 0.12);
      vertical-align: middle;
    }
    .col-filter-input, .col-filter-select {
      width: 100%;
      padding: 5px 8px;
      background: #090d14;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 6px;
      color: #f8fafc;
      font-size: 11px;
      outline: none;
    }
    .col-filter-input:focus, .col-filter-select:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.15);
    }

    td {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: #e2e8f0;
      vertical-align: middle;
    }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }
    tr.priority-row td { background: rgba(244, 63, 94, 0.04); }
    tr.priority-row:hover td { background: rgba(244, 63, 94, 0.08); }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 10.5px;
      font-weight: 700;
      white-space: nowrap;
    }
    .badge-ok { background: var(--success-bg); color: var(--success); border: 1px solid rgba(74, 222, 128, 0.28); }
    .badge-wip { background: var(--warning-bg); color: var(--warning); border: 1px solid rgba(251, 191, 36, 0.28); }
    .badge-breach { background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger-border); }
    .badge-t7 { background: rgba(244, 63, 94, 0.2); color: #fb7185; border: 1px solid rgba(244, 63, 94, 0.4); font-weight: 800; }
    .badge-neutral { background: rgba(148, 163, 184, 0.12); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25); }
    .badge-critical { background: #e11d48; color: #fff; font-weight: 800; }
    .badge-excluded { background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.35); }
  </style>
</head>
<body>
  <div class="header-panel">
    <div>
      <div class="header-title">${reportData.title}</div>
      <div class="header-subtitle">${reportData.windowLabel} • Generated: ${generatedAt}</div>
    </div>
    <div class="header-actions">
      <button class="btn" onclick="resetFilters()">↺ Reset Filters</button>
      <button id="copyBtn" class="btn btn-copy" onclick="copyTableForExcel()">📋 Copy for Excel</button>
    </div>
  </div>

  <div id="kpis" class="kpi-grid"></div>

  <div class="toolbar-strip">
    <div id="pills" class="filter-pills"></div>
    <div class="records-count">
      Showing <strong id="visible-count">0</strong> of ${reportData.totalEvaluated} pending dealerships
    </div>
  </div>

  <div class="table-container">
    <table id="mainTable">
      <thead id="tableHead"></thead>
      <tbody id="tableBody"></tbody>
    </table>
  </div>

  <script>
    const DATA = ${serializedData};
    let currentPreset = 'all';
    const columnFilters = {};
    let renderedRowsData = [];

    function renderKpis() {
      const container = document.getElementById('kpis');
      const pillsContainer = document.getElementById('pills');

      if (DATA.type === 'analytics') {
        container.innerHTML = \`
          <div class="kpi-card" style="border-color: rgba(244, 63, 94, 0.4);">
            <div class="kpi-label" style="color: #fb7185;">🚨 High Priority (&le; T-7 Days)</div>
            <div class="kpi-value" style="color: #fb7185;">\${DATA.priorityT7Count}</div>
            <div class="kpi-desc">Launches within 7 days</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Pending In Progress</div>
            <div class="kpi-value" style="color: var(--warning);">\${DATA.analyticsInProgressCount}</div>
            <div class="kpi-desc">Active configuration</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Pending Not Started</div>
            <div class="kpi-value" style="color: var(--text-muted);">\${DATA.analyticsNotStartedCount}</div>
            <div class="kpi-desc">Pending action</div>
          </div>
        \`;

        pillsContainer.innerHTML = \`
          <button id="pill-all" class="filter-pill active" onclick="setPreset('all')">All Pending (\${DATA.totalEvaluated})</button>
          <button id="pill-priority" class="filter-pill" onclick="setPreset('priority')">🚨 Priority T-7 Only (\${DATA.priorityT7Count})</button>
          <button id="pill-inprogress" class="filter-pill" onclick="setPreset('inprogress')">In Progress (\${DATA.analyticsInProgressCount})</button>
        \`;
      } else if (DATA.type === 'fixed_ops') {
        container.innerHTML = \`
          <div class="kpi-card">
            <div class="kpi-label">Total Pending (T-90)</div>
            <div class="kpi-value">\${DATA.totalEvaluated}</div>
            <div class="kpi-desc">Stores requiring completion</div>
          </div>
          <div class="kpi-card" style="border-color: rgba(244, 63, 94, 0.4);">
            <div class="kpi-label" style="color: var(--danger);">🚨 SLA Breached (&le;85d)</div>
            <div class="kpi-value" style="color: var(--danger);">\${DATA.breachedCount}</div>
            <div class="kpi-desc">Pending within 85 days</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Excluded (POD / OFS)</div>
            <div class="kpi-value" style="color: var(--purple);">\${DATA.excludedCount}</div>
            <div class="kpi-desc">Not handled by our team</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Parts / Service BP Pending</div>
            <div class="kpi-value" style="color: var(--warning);">\${DATA.partsBlueprintIncompleteCount + DATA.serviceBlueprintIncompleteCount}</div>
            <div class="kpi-desc">Blueprint config incomplete</div>
          </div>
        \`;

        pillsContainer.innerHTML = \`
          <button id="pill-all" class="filter-pill active" onclick="setPreset('all')">All Pending (\${DATA.totalEvaluated})</button>
          <button id="pill-breached" class="filter-pill" onclick="setPreset('breached')">🚨 Breaches Only (\${DATA.breachedCount})</button>
          <button id="pill-excluded" class="filter-pill" onclick="setPreset('excluded')">POD / OFS Excluded (\${DATA.excludedCount})</button>
        \`;
      } else if (DATA.type === 'variable_ops') {
        container.innerHTML = \`
          <div class="kpi-card">
            <div class="kpi-label">Total Pending (T-65)</div>
            <div class="kpi-value">\${DATA.totalEvaluated}</div>
            <div class="kpi-desc">Stores requiring completion</div>
          </div>
          <div class="kpi-card" style="border-color: rgba(251, 191, 36, 0.4);">
            <div class="kpi-label" style="color: var(--warning);">SLA Breached (&le;65d)</div>
            <div class="kpi-value" style="color: var(--warning);">\${DATA.breachedCount}</div>
            <div class="kpi-desc">Variable Ops not done</div>
          </div>
          <div class="kpi-card" style="border-color: rgba(244, 63, 94, 0.4);">
            <div class="kpi-label" style="color: var(--danger);">🚨 Critical Breaches (&le;55d)</div>
            <div class="kpi-value" style="color: var(--danger);">\${DATA.criticalBreachedCount}</div>
            <div class="kpi-desc">Critical escalation threshold</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Blocked by Fixed Ops</div>
            <div class="kpi-value" style="color: #f87171;">\${DATA.blockedByFixedOpsCount}</div>
            <div class="kpi-desc">Prerequisite not done</div>
          </div>
        \`;

        pillsContainer.innerHTML = \`
          <button id="pill-all" class="filter-pill active" onclick="setPreset('all')">All Pending (\${DATA.totalEvaluated})</button>
          <button id="pill-breached" class="filter-pill" onclick="setPreset('breached')">🚨 Breaches (&le;65d) (\${DATA.breachedCount})</button>
          <button id="pill-critical" class="filter-pill" onclick="setPreset('critical')">🔥 Critical (&le;55d) (\${DATA.criticalBreachedCount})</button>
          <button id="pill-blocked" class="filter-pill" onclick="setPreset('blocked')">⛔ Blocked by Fixed Ops (\${DATA.blockedByFixedOpsCount})</button>
        \`;
      }
    }

    function populateDropdownOptions() {
      const timelineSet = new Set();
      const podSet = new Set();
      const bpSet = new Set();
      const notWorkedSet = new Set();

      DATA.items.forEach(item => {
        if (item.tLabel) timelineSet.add(item.tLabel);
        if (item.superpodId) podSet.add(item.superpodId);
        if (item.notWorked) notWorkedSet.add(item.notWorked);
        if (DATA.type === 'analytics') {
          bpSet.add(item.analyticsStatusLabel);
        }
      });

      const timelineSelect = document.getElementById('filter-timeline');
      const podSelect = document.getElementById('filter-pod');
      const bpSelect = document.getElementById('filter-bp');
      const notWorkedSelect = document.getElementById('filter-notworked');

      if (timelineSelect) {
        Array.from(timelineSet).sort().forEach(val => {
          const opt = document.createElement('option');
          opt.value = val;
          opt.textContent = val;
          timelineSelect.appendChild(opt);
        });
      }

      if (podSelect) {
        Array.from(podSet).sort().forEach(val => {
          const opt = document.createElement('option');
          opt.value = val;
          opt.textContent = val;
          podSelect.appendChild(opt);
        });
      }

      if (bpSelect) {
        Array.from(bpSet).sort().forEach(val => {
          const opt = document.createElement('option');
          opt.value = val;
          opt.textContent = val;
          bpSelect.appendChild(opt);
        });
      }

      if (notWorkedSelect) {
        Array.from(notWorkedSet).sort().forEach(val => {
          const opt = document.createElement('option');
          opt.value = val;
          opt.textContent = val;
          notWorkedSelect.appendChild(opt);
        });
      }
    }

    function renderTable() {
      const thead = document.getElementById('tableHead');
      const tbody = document.getElementById('tableBody');
      tbody.innerHTML = '';
      renderedRowsData = [];
      let visible = 0;

      if (DATA.type === 'analytics') {
        thead.innerHTML = \`
          <tr class="th-title-row">
            <th>Tekion ID</th>
            <th>Dealer ID</th>
            <th>Dealership Name</th>
            <th>Go-Live Date</th>
            <th>Timeline</th>
            <th>POD</th>
            <th>Not Worked?</th>
            <th>Analytics Blueprint Status</th>
          </tr>
          <tr class="th-filter-row">
            <th><input type="text" class="col-filter-input" placeholder="Filter..." oninput="onFilterChange(0, this.value)" /></th>
            <th><input type="text" class="col-filter-input" placeholder="Filter..." oninput="onFilterChange(1, this.value)" /></th>
            <th><input type="text" class="col-filter-input" placeholder="Filter..." oninput="onFilterChange(2, this.value)" /></th>
            <th><input type="text" class="col-filter-input" placeholder="Filter..." oninput="onFilterChange(3, this.value)" /></th>
            <th>
              <select id="filter-timeline" class="col-filter-select" onchange="onFilterChange(4, this.value)">
                <option value="">All Timelines</option>
              </select>
            </th>
            <th>
              <select id="filter-pod" class="col-filter-select" onchange="onFilterChange(5, this.value)">
                <option value="">All PODs</option>
              </select>
            </th>
            <th>
              <select id="filter-notworked" class="col-filter-select" onchange="onFilterChange(6, this.value)">
                <option value="">All Ownership</option>
              </select>
            </th>
            <th>
              <select id="filter-bp" class="col-filter-select" onchange="onFilterChange(7, this.value)">
                <option value="">All Statuses</option>
              </select>
            </th>
          </tr>
        \`;

        DATA.items.forEach(item => {
          if (currentPreset === 'priority' && !item.isPriorityT7) return;
          if (currentPreset === 'inprogress' && item.blueprint.analyticsNormalized !== 'IN_PROGRESS') return;

          const rowValues = [
            item.tekionId,
            item.dealerId,
            item.dbaName,
            item.launchDate,
            item.tLabel,
            item.superpodId,
            item.notWorked || "Handled by ARC",
            item.analyticsStatusLabel
          ];

          let matches = true;
          for (const [colIdx, filterVal] of Object.entries(columnFilters)) {
            if (!filterVal) continue;
            const val = String(rowValues[colIdx] || '').toLowerCase();
            if (!val.includes(filterVal.toLowerCase())) {
              matches = false;
              break;
            }
          }
          if (!matches) return;
          visible++;

          renderedRowsData.push(rowValues);

          let bpBadge = '<span class="badge badge-neutral">Not Started / None</span>';
          if (item.blueprint.analyticsNormalized === 'COMPLETED') {
            bpBadge = '<span class="badge badge-ok">✓ Completed</span>';
          } else if (item.blueprint.analyticsNormalized === 'IN_PROGRESS') {
            bpBadge = '<span class="badge badge-wip">⏳ In Progress</span>';
          }

          const timelineBadge = item.isPriorityT7
            ? '<span class="badge badge-t7">🔥 ' + item.tLabel + '</span>'
            : '<span class="badge badge-neutral">' + item.tLabel + '</span>';

          const notWorkedBadge = item.notWorked
            ? '<span class="badge badge-excluded">' + item.notWorked + '</span>'
            : '<span style="color:#64748b; font-size:11px;">Handled by ARC</span>';

          const tr = document.createElement('tr');
          if (item.isPriorityT7) tr.className = 'priority-row';
          tr.innerHTML = \`
            <td><strong>\${item.tekionId}</strong></td>
            <td><strong style="color:var(--accent);">\${item.dealerId}</strong></td>
            <td>\${item.dbaName}</td>
            <td>\${item.launchDate}</td>
            <td>\${timelineBadge}</td>
            <td>\${item.superpodId}</td>
            <td>\${notWorkedBadge}</td>
            <td>\${bpBadge}</td>
          \`;
          tbody.appendChild(tr);
        });

      } else if (DATA.type === 'fixed_ops') {
        thead.innerHTML = \`
          <tr class="th-title-row">
            <th>Tekion ID</th>
            <th>Dealer ID</th>
            <th>Dealership Name</th>
            <th>Go-Live Date</th>
            <th>Timeline</th>
            <th>POD</th>
            <th>Not Worked?</th>
            <th>Fixed Ops Status</th>
            <th>SLA Status (&le;85d)</th>
            <th>Parts Blueprint</th>
            <th>Service Blueprint</th>
          </tr>
          <tr class="th-filter-row">
            <th><input type="text" class="col-filter-input" placeholder="Filter..." oninput="onFilterChange(0, this.value)" /></th>
            <th><input type="text" class="col-filter-input" placeholder="Filter..." oninput="onFilterChange(1, this.value)" /></th>
            <th><input type="text" class="col-filter-input" placeholder="Filter..." oninput="onFilterChange(2, this.value)" /></th>
            <th><input type="text" class="col-filter-input" placeholder="Filter..." oninput="onFilterChange(3, this.value)" /></th>
            <th>
              <select id="filter-timeline" class="col-filter-select" onchange="onFilterChange(4, this.value)">
                <option value="">All Timelines</option>
              </select>
            </th>
            <th>
              <select id="filter-pod" class="col-filter-select" onchange="onFilterChange(5, this.value)">
                <option value="">All PODs</option>
              </select>
            </th>
            <th>
              <select id="filter-notworked" class="col-filter-select" onchange="onFilterChange(6, this.value)">
                <option value="">All Ownership</option>
              </select>
            </th>
            <th>
              <select class="col-filter-select" onchange="onFilterChange(7, this.value)">
                <option value="">All</option>
                <option value="WIP">WIP</option>
                <option value="TO DO">TO DO</option>
              </select>
            </th>
            <th>
              <select class="col-filter-select" onchange="onFilterChange(8, this.value)">
                <option value="">All</option>
                <option value="BREACHED">Breached</option>
                <option value="EXCLUDED">Excluded (POD/OFS)</option>
                <option value="ON TRACK">On Track</option>
              </select>
            </th>
            <th>
              <select class="col-filter-select" onchange="onFilterChange(9, this.value)">
                <option value="">All</option>
                <option value="Completed">Completed</option>
                <option value="Pending">Pending</option>
              </select>
            </th>
            <th>
              <select class="col-filter-select" onchange="onFilterChange(10, this.value)">
                <option value="">All</option>
                <option value="Completed">Completed</option>
                <option value="Pending">Pending</option>
              </select>
            </th>
          </tr>
        \`;

        DATA.items.forEach(item => {
          if (currentPreset === 'breached' && !item.isBreached) return;
          if (currentPreset === 'excluded' && !item.isExcluded) return;

          let slaLabel = "ON TRACK";
          if (item.isExcluded) slaLabel = "EXCLUDED";
          else if (item.isBreached) slaLabel = "BREACHED";

          const partsLabel = item.blueprint.partsCompleted ? "Completed" : "Pending";
          const serviceLabel = item.blueprint.serviceCompleted ? "Completed" : "Pending";

          const rowValues = [
            item.tekionId,
            item.dealerId,
            item.dbaName,
            item.launchDate,
            item.tLabel,
            item.superpodId,
            item.notWorked || "Handled by ARC",
            item.fixedOpsStatus,
            slaLabel,
            partsLabel,
            serviceLabel
          ];

          let matches = true;
          for (const [colIdx, filterVal] of Object.entries(columnFilters)) {
            if (!filterVal) continue;
            const val = String(rowValues[colIdx] || '').toLowerCase();
            if (!val.includes(filterVal.toLowerCase())) {
              matches = false;
              break;
            }
          }
          if (!matches) return;
          visible++;

          renderedRowsData.push(rowValues);

          const statusBadge = item.fixedOpsStatus === 'WIP'
            ? '<span class="badge badge-wip">WIP</span>'
            : '<span class="badge badge-neutral">TO DO</span>';

          let slaBadge = '<span class="badge badge-neutral">On Track</span>';
          if (item.isExcluded) {
            slaBadge = '<span class="badge badge-excluded">○ Excluded (' + item.notWorked + ')</span>';
          } else if (item.isBreached) {
            slaBadge = '<span class="badge badge-breach">⚠ BREACHED (&le;85d)</span>';
          }

          const notWorkedBadge = item.notWorked
            ? '<span class="badge badge-excluded">' + item.notWorked + '</span>'
            : '<span style="color:#64748b; font-size:11px;">Handled by ARC</span>';

          const tr = document.createElement('tr');
          if (item.isBreached) tr.className = 'priority-row';
          tr.innerHTML = \`
            <td><strong>\${item.tekionId}</strong></td>
            <td><strong style="color:var(--accent);">\${item.dealerId}</strong></td>
            <td>\${item.dbaName}</td>
            <td>\${item.launchDate}</td>
            <td><span class="badge badge-neutral">\${item.tLabel}</span></td>
            <td>\${item.superpodId}</td>
            <td>\${notWorkedBadge}</td>
            <td>\${statusBadge}</td>
            <td>\${slaBadge}</td>
            <td>\${item.blueprint.partsCompleted ? '<span class="badge badge-ok">✓ Done</span>' : '<span class="badge badge-wip">Pending</span>'}</td>
            <td>\${item.blueprint.serviceCompleted ? '<span class="badge badge-ok">✓ Done</span>' : '<span class="badge badge-wip">Pending</span>'}</td>
          \`;
          tbody.appendChild(tr);
        });

      } else if (DATA.type === 'variable_ops') {
        thead.innerHTML = \`
          <tr class="th-title-row">
            <th>Tekion ID</th>
            <th>Dealer ID</th>
            <th>Dealership Name</th>
            <th>Go-Live Date</th>
            <th>Timeline</th>
            <th>POD</th>
            <th>Not Worked?</th>
            <th>Fixed Ops Prereq</th>
            <th>Variable Ops Status</th>
            <th>SLA Status (&le;65d)</th>
            <th>Accounting BP</th>
          </tr>
          <tr class="th-filter-row">
            <th><input type="text" class="col-filter-input" placeholder="Filter..." oninput="onFilterChange(0, this.value)" /></th>
            <th><input type="text" class="col-filter-input" placeholder="Filter..." oninput="onFilterChange(1, this.value)" /></th>
            <th><input type="text" class="col-filter-input" placeholder="Filter..." oninput="onFilterChange(2, this.value)" /></th>
            <th><input type="text" class="col-filter-input" placeholder="Filter..." oninput="onFilterChange(3, this.value)" /></th>
            <th>
              <select id="filter-timeline" class="col-filter-select" onchange="onFilterChange(4, this.value)">
                <option value="">All Timelines</option>
              </select>
            </th>
            <th>
              <select id="filter-pod" class="col-filter-select" onchange="onFilterChange(5, this.value)">
                <option value="">All PODs</option>
              </select>
            </th>
            <th>
              <select id="filter-notworked" class="col-filter-select" onchange="onFilterChange(6, this.value)">
                <option value="">All Ownership</option>
              </select>
            </th>
            <th>
              <select class="col-filter-select" onchange="onFilterChange(7, this.value)">
                <option value="">All</option>
                <option value="Done">Done</option>
                <option value="Blocked">Blocked</option>
              </select>
            </th>
            <th>
              <select class="col-filter-select" onchange="onFilterChange(8, this.value)">
                <option value="">All</option>
                <option value="WIP">WIP</option>
                <option value="TO DO">TO DO</option>
              </select>
            </th>
            <th>
              <select class="col-filter-select" onchange="onFilterChange(9, this.value)">
                <option value="">All</option>
                <option value="CRITICAL">Critical &le;55d</option>
                <option value="BREACHED">Breached &le;65d</option>
                <option value="EXCLUDED">Excluded (POD/OFS)</option>
                <option value="ON TRACK">On Track</option>
              </select>
            </th>
            <th>
              <select class="col-filter-select" onchange="onFilterChange(10, this.value)">
                <option value="">All</option>
                <option value="Completed">Completed</option>
                <option value="Pending">Pending</option>
              </select>
            </th>
          </tr>
        \`;

        DATA.items.forEach(item => {
          if (currentPreset === 'breached' && !item.isBreached) return;
          if (currentPreset === 'critical' && !item.isCriticalBreached) return;
          if (currentPreset === 'blocked' && !item.isBlockedByFixedOps) return;
          if (currentPreset === 'excluded' && !item.isExcluded) return;

          const prereqLabel = item.isFixedOpsCompleted ? "Done" : "Blocked";
          let slaLabel = "ON TRACK";
          if (item.isExcluded) slaLabel = "EXCLUDED";
          else if (item.isCriticalBreached) slaLabel = "CRITICAL";
          else if (item.isBreached) slaLabel = "BREACHED";

          const acctLabel = item.blueprint.accountingCompleted ? "Completed" : "Pending";

          const rowValues = [
            item.tekionId,
            item.dealerId,
            item.dbaName,
            item.launchDate,
            item.tLabel,
            item.superpodId,
            item.notWorked || "Handled by ARC",
            prereqLabel,
            item.variableOpsStatus,
            slaLabel,
            acctLabel
          ];

          let matches = true;
          for (const [colIdx, filterVal] of Object.entries(columnFilters)) {
            if (!filterVal) continue;
            const val = String(rowValues[colIdx] || '').toLowerCase();
            if (!val.includes(filterVal.toLowerCase())) {
              matches = false;
              break;
            }
          }
          if (!matches) return;
          visible++;

          renderedRowsData.push(rowValues);

          const prereqBadge = item.isFixedOpsCompleted
            ? '<span class="badge badge-ok">✓ Done</span>'
            : '<span class="badge badge-breach">⛔ Fixed Ops Incomplete</span>';

          const varStatusBadge = item.variableOpsStatus === 'WIP'
            ? '<span class="badge badge-wip">WIP</span>'
            : '<span class="badge badge-neutral">TO DO</span>';

          let slaBadge = '<span class="badge badge-neutral">On Track</span>';
          if (item.isExcluded) {
            slaBadge = '<span class="badge badge-excluded">○ Excluded (' + item.notWorked + ')</span>';
          } else if (item.isCriticalBreached) {
            slaBadge = '<span class="badge badge-critical">🚨 CRITICAL (&le;55d)</span>';
          } else if (item.isBreached) {
            slaBadge = '<span class="badge badge-breach">⚠ BREACHED (&le;65d)</span>';
          }

          const notWorkedBadge = item.notWorked
            ? '<span class="badge badge-excluded">' + item.notWorked + '</span>'
            : '<span style="color:#64748b; font-size:11px;">Handled by ARC</span>';

          const tr = document.createElement('tr');
          if (item.isCriticalBreached) tr.className = 'priority-row';
          tr.innerHTML = \`
            <td><strong>\${item.tekionId}</strong></td>
            <td><strong style="color:var(--accent);">\${item.dealerId}</strong></td>
            <td>\${item.dbaName}</td>
            <td>\${item.launchDate}</td>
            <td><span class="badge badge-neutral">\${item.tLabel}</span></td>
            <td>\${item.superpodId}</td>
            <td>\${notWorkedBadge}</td>
            <td>\${prereqBadge}</td>
            <td>\${varStatusBadge}</td>
            <td>\${slaBadge}</td>
            <td>\${item.blueprint.accountingCompleted ? '<span class="badge badge-ok">✓ Done</span>' : '<span class="badge badge-wip">Pending</span>'}</td>
          \`;
          tbody.appendChild(tr);
        });
      }

      document.getElementById('visible-count').textContent = visible;
    }

    function onFilterChange(colIndex, value) {
      columnFilters[colIndex] = value.trim();
      renderTable();
    }

    function setPreset(preset) {
      currentPreset = preset;
      document.querySelectorAll('.filter-pill').forEach(el => el.classList.remove('active'));
      const activeBtn = document.getElementById('pill-' + preset);
      if (activeBtn) activeBtn.classList.add('active');
      renderTable();
    }

    function resetFilters() {
      document.querySelectorAll('th input').forEach(el => el.value = '');
      document.querySelectorAll('th select').forEach(el => el.value = '');
      for (const key in columnFilters) delete columnFilters[key];
      setPreset('all');
    }

    function copyTableForExcel() {
      if (renderedRowsData.length === 0) {
        alert("No rows visible to copy.");
        return;
      }

      const headers = [];
      document.querySelectorAll(".th-title-row th").forEach(th => headers.push(th.textContent.trim()));

      const tsvLines = [headers.join("\\t")];
      renderedRowsData.forEach(row => {
        tsvLines.push(row.map(cell => String(cell || '').replace(/\\t|\\r?\\n/g, ' ')).join("\\t"));
      });

      const tsvContent = tsvLines.join("\\n");

      navigator.clipboard.writeText(tsvContent).then(() => {
        const btn = document.getElementById("copyBtn");
        const originalText = btn.textContent;
        btn.textContent = "✓ Copied " + renderedRowsData.length + " Rows!";
        btn.classList.add("copied");
        setTimeout(() => {
          btn.textContent = originalText;
          btn.classList.remove("copied");
        }, 2000);
      }).catch(err => {
        alert("Could not copy directly to clipboard. Please allow clipboard permissions.");
      });
    }

    renderKpis();
    renderTable();
    populateDropdownOptions();
  </script>
</body>
</html>`;
}
