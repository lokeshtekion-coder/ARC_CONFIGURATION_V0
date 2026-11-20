// Renders the Analytics, Fixed Ops and Variable Ops SLA reports as one standalone HTML page.
// Every row from the evaluation is included; nothing is trimmed.
import type {
  AnalyticsReportData,
  AnalyticsReportRecord,
  FixedOpsReportData,
  FixedOpsReportRecord,
  VariableOpsReportData,
  VariableOpsReportRecord,
} from "./slaReportGenerator_na";
import { esc, REPORT_BASE_CSS, REPORT_BASE_JS } from "./reportHtmlKit";

type ReportData = AnalyticsReportData | FixedOpsReportData | VariableOpsReportData;

interface Column {
  label: string;
  /** Key used for filter dropdowns (data-f-<key> on each row). Omit for non-filterable columns. */
  filterKey?: string;
  /** Sortable columns sort by the cell's data-v attribute. */
  sortable?: boolean;
  align?: "left" | "center";
}

interface Row {
  flags: string[];
  hot: boolean;
  search: string;
  filters: Record<string, string>;
  cells: string[]; // HTML for each cell (already escaped)
  sortValues: Array<string | number>;
  plain: string[];
}

const DONE = (ok: boolean) =>
  ok ? '<span class="badge b-ok">✓ Done</span>' : '<span class="badge b-wip">Pending</span>';

function baseCells(
  item: { tekionId: string; dealerId: string; dbaName: string; launchDate: string; tLabel: string; daysUntilLaunch: number; superpodId: string; notWorked?: string },
  timelineHtml: string
) {
  const notWorked = item.notWorked || "";
  const owner = notWorked ? notWorked : "Handled by ARC";
  return {
    cells: [
      `<span class="mono">${esc(item.tekionId)}</span>`,
      `<span class="dealer">#${esc(item.dealerId)}</span>`,
      `<span class="strong">${esc(item.dbaName)}</span>`,
      esc(item.launchDate),
      timelineHtml,
      esc(item.superpodId || "—"),
      notWorked
        ? `<span class="badge b-excluded">${esc(notWorked)}</span>`
        : `<span class="sub" style="margin:0">Handled by ARC</span>`,
    ],
    plain: [
      item.tekionId,
      item.dealerId,
      item.dbaName,
      item.launchDate,
      item.tLabel,
      item.superpodId || "",
      owner,
    ],
    sortValues: [item.tekionId, item.dealerId, item.dbaName, item.daysUntilLaunch, item.tLabel, item.superpodId || "", owner],
    filters: {
      timeline: item.tLabel,
      pod: item.superpodId || "—",
      notworked: owner,
    },
  };
}

function timelineBadge(label: string, hot: boolean) {
  return `<span class="badge ${hot ? "b-critical" : "b-brand"}">${esc(label)}</span>`;
}

function buildAnalytics(data: AnalyticsReportData): { columns: Column[]; rows: Row[]; tabs: Array<{ key: string; label: string; count: number }>; kpis: string; why: string } {
  const columns: Column[] = [
    { label: "Tekion ID" },
    { label: "Dealer ID", sortable: true },
    { label: "Dealership", sortable: true },
    { label: "Go-Live", sortable: true },
    { label: "Timeline", filterKey: "timeline", sortable: true },
    { label: "POD", filterKey: "pod", sortable: true },
    { label: "Ownership", filterKey: "notworked", sortable: true },
    { label: "Analytics Blueprint", filterKey: "bp", sortable: true },
  ];
  const rows: Row[] = data.items.map((item: AnalyticsReportRecord) => {
    const base = baseCells(item, timelineBadge(item.tLabel, item.isPriorityT7));
    const n = item.blueprint.analyticsNormalized;
    const bp =
      n === "COMPLETED"
        ? '<span class="badge b-ok">✓ Completed</span>'
        : n === "IN_PROGRESS"
          ? '<span class="badge b-wip">⏳ In Progress</span>'
          : '<span class="badge b-todo">Not Started / None</span>';
    const flags: string[] = [];
    if (item.isPriorityT7) flags.push("priority");
    if (n === "IN_PROGRESS") flags.push("inprogress");
    return {
      flags,
      hot: item.isPriorityT7,
      search: [item.tekionId, item.dealerId, item.dbaName, item.tLabel, item.superpodId, base.filters.notworked, item.analyticsStatusLabel].join(" ").toLowerCase(),
      filters: { ...base.filters, bp: item.analyticsStatusLabel || "" },
      cells: [...base.cells, bp],
      sortValues: [...base.sortValues, item.analyticsStatusLabel || ""],
      plain: [...base.plain, item.analyticsStatusLabel || ""],
    };
  });
  return {
    columns,
    rows,
    tabs: [
      { key: "all", label: "All pending", count: data.totalEvaluated },
      { key: "priority", label: "🔥 Go-live within T-7", count: data.priorityT7Count },
      { key: "inprogress", label: "In progress", count: data.analyticsInProgressCount },
    ],
    kpis: [
      kpi("Pending stores", data.totalEvaluated, "Going live in the next 90 days", ""),
      kpi("Go-live within 7 days", data.priorityT7Count, "Needs attention first", "danger"),
      kpi("In progress", data.analyticsInProgressCount, "Analytics work started", "warn"),
      kpi("Not started", data.analyticsNotStartedCount, "Analytics work not begun", ""),
    ].join(""),
    why: `Stores still missing Analytics blueprint work, sorted by go-live. Stores going live within 7 days are highlighted.`,
  };
}

function buildFixedOps(data: FixedOpsReportData): { columns: Column[]; rows: Row[]; tabs: Array<{ key: string; label: string; count: number }>; kpis: string; why: string } {
  const columns: Column[] = [
    { label: "Tekion ID" },
    { label: "Dealer ID", sortable: true },
    { label: "Dealership", sortable: true },
    { label: "Go-Live", sortable: true },
    { label: "Timeline", filterKey: "timeline", sortable: true },
    { label: "POD", filterKey: "pod", sortable: true },
    { label: "Ownership", filterKey: "notworked", sortable: true },
    { label: "Fixed Ops Status", filterKey: "fostatus", sortable: true },
    { label: `SLA (≤${data.fixedOpsThresholdDays}d)`, filterKey: "sla", sortable: true },
    { label: "Parts Blueprint", filterKey: "parts", sortable: true },
    { label: "Service Blueprint", filterKey: "service", sortable: true },
  ];
  const rows: Row[] = data.items.map((item: FixedOpsReportRecord) => {
    const base = baseCells(item, timelineBadge(item.tLabel, false));
    const sla = item.isExcluded ? "EXCLUDED" : item.isBreached ? "BREACHED" : "ON TRACK";
    const slaHtml = item.isExcluded
      ? `<span class="badge b-excluded">○ Excluded (${esc(item.notWorked)})</span>`
      : item.isBreached
        ? `<span class="badge b-danger">⚠ Breached (≤${data.fixedOpsThresholdDays}d)</span>`
        : `<span class="badge b-ok">On track</span>`;
    const fo = item.fixedOpsStatus === "WIP" ? "WIP" : "TO DO";
    const parts = item.blueprint.partsCompleted ? "Done" : "Pending";
    const service = item.blueprint.serviceCompleted ? "Done" : "Pending";
    const flags: string[] = [];
    if (item.isBreached) flags.push("breached");
    if (item.isExcluded) flags.push("excluded");
    return {
      flags,
      hot: item.isBreached,
      search: [item.tekionId, item.dealerId, item.dbaName, item.tLabel, item.superpodId, base.filters.notworked].join(" ").toLowerCase(),
      filters: { ...base.filters, fostatus: fo, sla, parts, service },
      cells: [
        ...base.cells,
        fo === "WIP" ? '<span class="badge b-wip">WIP</span>' : '<span class="badge b-todo">TO DO</span>',
        slaHtml,
        DONE(item.blueprint.partsCompleted),
        DONE(item.blueprint.serviceCompleted),
      ],
      sortValues: [...base.sortValues, fo, sla, parts, service],
      plain: [...base.plain, fo, sla, parts, service],
    };
  });
  return {
    columns,
    rows,
    tabs: [
      { key: "all", label: "All pending", count: data.totalEvaluated },
      { key: "breached", label: "⚠ Breached", count: data.breachedCount },
      { key: "excluded", label: "POD / OFS excluded", count: data.excludedCount },
    ],
    kpis: [
      kpi("Pending stores (T-90)", data.totalEvaluated, "Need Fixed Ops completion", ""),
      kpi(`Breached (≤${data.fixedOpsThresholdDays} days)`, data.breachedCount, "Past the target date", "danger"),
      kpi("Excluded (POD / OFS)", data.excludedCount, "Not handled by our team", ""),
      kpi("Blueprint incomplete", data.partsBlueprintIncompleteCount + data.serviceBlueprintIncompleteCount, `Parts ${data.partsBlueprintIncompleteCount} · Service ${data.serviceBlueprintIncompleteCount}`, "warn"),
    ].join(""),
    why: `Fixed Ops (Parts and Service) should be complete at least ${data.fixedOpsThresholdDays} days before go-live. Stores past that point are marked Breached. POD and OFS stores are shown as Excluded because another team handles them.`,
  };
}

function buildVariableOps(data: VariableOpsReportData): { columns: Column[]; rows: Row[]; tabs: Array<{ key: string; label: string; count: number }>; kpis: string; why: string } {
  const columns: Column[] = [
    { label: "Tekion ID" },
    { label: "Dealer ID", sortable: true },
    { label: "Dealership", sortable: true },
    { label: "Go-Live", sortable: true },
    { label: "Timeline", filterKey: "timeline", sortable: true },
    { label: "POD", filterKey: "pod", sortable: true },
    { label: "Ownership", filterKey: "notworked", sortable: true },
    { label: "Fixed Ops Prerequisite", filterKey: "prereq", sortable: true },
    { label: "Variable Ops Status", filterKey: "vostatus", sortable: true },
    { label: `SLA (≤${data.variableOpsThresholdDays}d)`, filterKey: "sla", sortable: true },
    { label: "Accounting Blueprint", filterKey: "acct", sortable: true },
    { label: "COA (optional)", sortable: true },
    { label: "ACCTS (needs >50)", filterKey: "accts", sortable: true },
    { label: "Accounting Attachments", filterKey: "attach", sortable: true },
    { label: "Next Action", filterKey: "action", sortable: true },
  ];
  const actionText: Record<string, string> = {
    CONFIGURE_NOW: "Configure now",
    IN_PROGRESS: "In progress",
    FETCH_AGAIN: "Fetch again",
    BLOCKED_FIXED_OPS: "Blocked by Fixed Ops",
    HANDLED_ELSEWHERE: "Handled by POD/OFS",
  };
  const actionBadge: Record<string, string> = {
    CONFIGURE_NOW: "b-ok",
    IN_PROGRESS: "b-wip",
    FETCH_AGAIN: "b-danger",
    BLOCKED_FIXED_OPS: "b-todo",
    HANDLED_ELSEWHERE: "b-excluded",
  };
  const rows: Row[] = data.items.map((item: VariableOpsReportRecord) => {
    const base = baseCells(item, timelineBadge(item.tLabel, item.isCriticalBreached));
    const sla = item.isExcluded ? "EXCLUDED" : item.isCriticalBreached ? "CRITICAL" : item.isBreached ? "BREACHED" : "ON TRACK";
    const slaHtml = item.isExcluded
      ? `<span class="badge b-excluded">○ Excluded (${esc(item.notWorked)})</span>`
      : item.isCriticalBreached
        ? `<span class="badge b-critical">🔥 Critical (≤${data.criticalThresholdDays}d)</span>`
        : item.isBreached
          ? `<span class="badge b-danger">⚠ Breached (≤${data.variableOpsThresholdDays}d)</span>`
          : `<span class="badge b-ok">On track</span>`;
    const prereq = item.isFixedOpsCompleted ? "Done" : "Blocked";
    const vo = item.variableOpsStatus === "WIP" ? "WIP" : "TO DO";
    const acct = item.accountingStatusText;
    const attach = item.accountingAttachmentCount === 0 ? "MISSING" : "Present";
    const actionKey = actionText[item.action] ? item.action : "BLOCKED_FIXED_OPS";
    const flags: string[] = [];
    if (item.isBreached) flags.push("breached");
    if (item.isCriticalBreached) flags.push("critical");
    if (item.isBlockedByFixedOps) flags.push("blocked");
    if (item.action === "CONFIGURE_NOW") flags.push("configure");
    if (item.action === "IN_PROGRESS") flags.push("inprogress");
    if (item.action === "FETCH_AGAIN") flags.push("fetch");
    if (item.isExcluded) flags.push("excluded");
    if (attach === "MISSING" && item.action !== "BLOCKED_FIXED_OPS" && !item.isExcluded) flags.push("noattach");
    return {
      flags,
      hot: item.action === "CONFIGURE_NOW" || (attach === "MISSING" && item.action !== "BLOCKED_FIXED_OPS" && !item.isExcluded),
      search: [item.tekionId, item.dealerId, item.dbaName, item.tLabel, item.superpodId, base.filters.notworked, actionText[actionKey]].join(" ").toLowerCase(),
      filters: { ...base.filters, prereq, vostatus: vo, sla, acct, accts: item.acctsCount > 50 ? "OK" : "Low", attach, action: actionText[actionKey] },
      cells: [
        ...base.cells,
        prereq === "Done" ? '<span class="badge b-ok">✓ Done</span>' : '<span class="badge b-danger">⛔ Fixed Ops incomplete</span>',
        vo === "WIP" ? '<span class="badge b-wip">WIP</span>' : '<span class="badge b-todo">TO DO</span>',
        slaHtml,
        esc(acct),
        `<span class="badge ${item.coaCount > 50 ? "b-ok" : "b-todo"}">${item.coaCount}</span>`,
        `<span class="badge ${item.acctsCount > 50 ? "b-ok" : "b-danger"}">${item.acctsCount}</span>`,
        attach === "MISSING" ? '<span class="badge b-danger">⚠ Missing</span>' : '<span class="badge b-ok">✓ Present</span>',
        `<span class="badge ${actionBadge[actionKey]}">${esc(actionText[actionKey])}</span>`,
      ],
      sortValues: [...base.sortValues, prereq, vo, sla, acct, item.coaCount, item.acctsCount, attach, actionText[actionKey]],
      plain: [...base.plain, prereq, vo, sla, acct, String(item.coaCount), String(item.acctsCount), attach, actionText[actionKey]],
    };
  });
  return {
    columns,
    rows,
    tabs: [
      { key: "all", label: "All pending", count: data.totalEvaluated },
      { key: "configure", label: "✅ Configure now", count: data.configureNowCount },
      { key: "inprogress", label: "🔧 In progress", count: data.inProgressCount },
      { key: "fetch", label: "🔁 Fetch again", count: data.fetchAgainCount },
      { key: "noattach", label: "📎 No attachments", count: data.noAttachmentCount },
      { key: "breached", label: `⚠ Breached (≤${data.variableOpsThresholdDays}d)`, count: data.breachedCount },
      { key: "critical", label: `🔥 Critical (≤${data.criticalThresholdDays}d)`, count: data.criticalBreachedCount },
      { key: "blocked", label: "⛔ Blocked by Fixed Ops", count: data.blockedByFixedOpsCount },
      { key: "excluded", label: "○ Handled by POD/OFS", count: data.excludedCount },
    ],
    kpis: [
      kpi("Configure now", data.configureNowCount, "ACCTS above 50, Variable Ops not started", "danger"),
      kpi("In progress", data.inProgressCount, "ACCTS above 50, Variable Ops WIP", "warn"),
      kpi("Fetch again", data.fetchAgainCount, "ACCTS 50 or below", ""),
      kpi("No attachments", data.noAttachmentCount, "Accounting blueprint tasks have no attachments", "warn"),
      kpi(`Breached (≤${data.variableOpsThresholdDays} days)`, data.breachedCount, "Variable Ops not done", "warn"),
      kpi(`Critical (≤${data.criticalThresholdDays} days)`, data.criticalBreachedCount, "Escalate today", "danger"),
    ].join(""),
    why: `Scope is today through 90 days. Rows are sorted by what to do next: Configure now first, then Fetch again, In progress, and Blocked by Fixed Ops. Fixed Ops prerequisite is Done when the tracker is Completed or handled by POD/OFS. ACCTS above 50 means data is ready; COA is shown for information only. A missing attachment on the Accounting blueprint tasks is flagged on every open row. Variable Ops should be complete at least ${data.variableOpsThresholdDays} days before go-live (critical at ${data.criticalThresholdDays} days).`,
  };
}

function kpi(label: string, value: number, hint: string, tone: "" | "danger" | "warn" | "ok") {
  return `<div class="kpi ${tone}"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div><div class="kpi-hint">${esc(hint)}</div></div>`;
}

export function renderSlaReportHtml(data: ReportData): string {
  const generatedAt = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const built =
    data.type === "analytics"
      ? buildAnalytics(data)
      : data.type === "fixed_ops"
        ? buildFixedOps(data)
        : buildVariableOps(data);

  // Filter dropdown options come from the data, so they always match what is in the table.
  const filterOptions: Record<string, string[]> = {};
  for (const col of built.columns) {
    if (!col.filterKey) continue;
    const values = new Set<string>();
    for (const r of built.rows) if (r.filters[col.filterKey]) values.add(r.filters[col.filterKey]);
    filterOptions[col.filterKey] = Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  const filterSelects = built.columns
    .filter((c) => c.filterKey)
    .map((c) => {
      const opts = (filterOptions[c.filterKey!] || [])
        .map((v) => `<option value="${esc(v)}">${esc(v)}</option>`)
        .join("");
      return `<div class="field"><label>${esc(c.label)}</label><select class="filter" data-filter="${esc(c.filterKey)}"><option value="">All</option>${opts}</select></div>`;
    })
    .join("");

  const headerCells = built.columns
    .map((c, i) => {
      const attrs = [`data-col="${i}"`, `data-label="${esc(c.label)}"`];
      if (c.sortable) attrs.push(`data-sortable="1"`);
      return `<th ${attrs.join(" ")}>${esc(c.label)}${c.sortable ? '<span class="arrow">↕</span>' : ""}</th>`;
    })
    .join("");

  const bodyRows = built.rows
    .map((r) => {
      const filterAttrs = Object.entries(r.filters)
        .map(([k, v]) => `data-f-${esc(k)}="${esc(v)}"`)
        .join(" ");
      const cells = r.cells
        .map((html, i) => {
          const v = r.sortValues[i];
          return `<td data-v="${esc(v)}">${html}</td>`;
        })
        .join("");
      return `<tr class="data-row${r.hot ? " hot" : ""}" data-flags="${esc(r.flags.join(" "))}" data-search="${esc(r.search)}" ${filterAttrs}>${cells}</tr>`;
    })
    .join("");

  const tabs = built.tabs
    .map((t, i) => `<button class="tab${i === 0 ? " active" : ""}" data-preset="${esc(t.key)}">${esc(t.label)}<span class="n">${esc(t.count)}</span></button>`)
    .join("");

  const title = data.title;
  const windowLabel = data.windowLabel;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<style>${REPORT_BASE_CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="page-head">
    <div>
      <h1 class="page-title">${esc(title)}</h1>
      <div class="page-meta">${esc(windowLabel)} · Generated ${esc(generatedAt)}</div>
    </div>
  </div>

  <div class="why"><strong>What this shows.</strong> ${esc(built.why)}</div>

  <div class="kpis">${built.kpis}</div>

  <div class="panel">
    <div class="toolbar">
      <div class="tabs" id="presets">${tabs}</div>
      <input class="search" id="search" type="search" placeholder="Search tekion ID, dealer, dealership, POD…" />
      ${filterSelects}
      <button class="btn" id="reset">Reset</button>
      <button class="btn" id="copy">Copy for Excel</button>
      <button class="btn primary" id="csv">Download CSV</button>
      <div class="count" id="count"></div>
    </div>
    <div class="table-scroll">
      <table class="data" id="tbl">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
      <div class="empty" id="empty">No stores match these filters.</div>
    </div>
  </div>
  <div class="foot">All ${esc(built.rows.length)} rows from the evaluation are included. Filters, search and sort only change what is shown; Copy and CSV export the rows currently visible.</div>
</div>
<div class="toast" id="toast"></div>
<script>
${REPORT_BASE_JS}
(function () {
  var tbl = document.getElementById('tbl');
  var rows = Array.prototype.slice.call(tbl.querySelectorAll('tbody tr.data-row'));
  var countEl = document.getElementById('count');
  var empty = document.getElementById('empty');
  var state = { preset: 'all', search: '', filters: {} };
  var total = rows.length;

  function matches(tr) {
    if (state.preset !== 'all' && (' ' + tr.getAttribute('data-flags') + ' ').indexOf(' ' + state.preset + ' ') === -1) return false;
    if (state.search && tr.getAttribute('data-search').indexOf(state.search) === -1) return false;
    for (var key in state.filters) {
      var want = state.filters[key];
      if (want && tr.getAttribute('data-f-' + key) !== want) return false;
    }
    return true;
  }
  function apply() {
    var shown = 0;
    rows.forEach(function (tr) {
      var ok = matches(tr);
      tr.hidden = !ok;
      if (ok) shown++;
    });
    countEl.innerHTML = 'Showing <strong>' + shown + '</strong> of ' + total;
    empty.style.display = shown ? 'none' : 'block';
  }

  document.querySelectorAll('#presets .tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('#presets .tab').forEach(function (b) { b.classList.remove('active'); });
      btn.classList.add('active');
      state.preset = btn.getAttribute('data-preset');
      apply();
    });
  });
  document.getElementById('search').addEventListener('input', function (e) {
    state.search = e.target.value.trim().toLowerCase();
    apply();
  });
  document.querySelectorAll('select.filter').forEach(function (sel) {
    sel.addEventListener('change', function () {
      state.filters[sel.getAttribute('data-filter')] = sel.value;
      apply();
    });
  });
  document.getElementById('reset').addEventListener('click', function () {
    state = { preset: 'all', search: '', filters: {} };
    document.getElementById('search').value = '';
    document.querySelectorAll('select.filter').forEach(function (s) { s.value = ''; });
    document.querySelectorAll('#presets .tab').forEach(function (b, i) { b.classList.toggle('active', i === 0); });
    apply();
  });
  document.getElementById('copy').addEventListener('click', function () { copyForExcel(tbl); });
  document.getElementById('csv').addEventListener('click', function () {
    downloadCsv(tbl, ${JSON.stringify(`${data.type}_report.csv`)});
  });

  // Sorting: click a sortable header to toggle ascending / descending.
  var sortCol = -1, sortDir = 1;
  tbl.querySelectorAll('thead th[data-sortable]').forEach(function (th) {
    th.addEventListener('click', function () {
      var col = Number(th.getAttribute('data-col'));
      sortDir = sortCol === col ? -sortDir : 1;
      sortCol = col;
      tbl.querySelectorAll('thead th').forEach(function (h) {
        h.classList.remove('sorted');
        var a = h.querySelector('.arrow'); if (a) a.textContent = '↕';
      });
      th.classList.add('sorted');
      var arrow = th.querySelector('.arrow'); if (arrow) arrow.textContent = sortDir === 1 ? '↑' : '↓';
      var body = tbl.querySelector('tbody');
      rows.sort(function (a, b) {
        var av = a.children[col].getAttribute('data-v');
        var bv = b.children[col].getAttribute('data-v');
        var an = Number(av), bn = Number(bv);
        var cmp = (av !== '' && bv !== '' && !isNaN(an) && !isNaN(bn))
          ? an - bn
          : String(av).localeCompare(String(bv), undefined, { numeric: true });
        return cmp * sortDir;
      });
      rows.forEach(function (r) { body.appendChild(r); });
    });
  });
  apply();
})();
</script>
</body>
</html>`;
}
