// Standalone HTML version of the TAP Overdue & T-SLA report.
// Includes every flagged task; filters and sorting only change what is shown.
import { esc, REPORT_BASE_CSS, REPORT_BASE_JS } from "./reportHtmlKit";

export interface TapOverdueHtmlItem {
  dealerId: string;
  dbaName: string;
  tekionId: string;
  taskId: number | string;
  taskName: string;
  taskStatus: string;
  taskUrl: string;
  assigneeName: string;
  goLiveDate: string;
  goLiveTLabel: string;
  goLiveTimestamp: number;
  dueDate: string;
  dueDateTimestamp: number;
  daysRemaining: number;
  isOverdue: boolean;
  urgencyLevel: "CRITICAL_OVERDUE_NO_COMMENT" | "OVERDUE_WITH_COMMENT" | "T3_IMMINENT" | "T7_APPROACHING";
  latestCommentText: string;
  latestCommentAuthor: string;
  latestCommentTime: string;
  source?: "blueprint" | "integrations";
}

export interface TapAssigneeStats {
  totalOverdue: number;
  criticalOverdue: number;
  inProgress: number;
  newStatus: number;
  dueSoon: number;
}

export function renderTapOverdueHtml(args: {
  items: TapOverdueHtmlItem[];
  assignees: Array<[string, TapAssigneeStats]>;
  slaWindow: number;
}): string {
  const { items, assignees, slaWindow } = args;
  const generatedAt = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const dealerCount = new Set(items.map((i) => i.dealerId)).size;
  const count = (pred: (i: TapOverdueHtmlItem) => boolean) => items.filter(pred).length;
  const noCommentOverdue = count((i) => i.urgencyLevel === "CRITICAL_OVERDUE_NO_COMMENT");
  const commentedOverdue = count((i) => i.urgencyLevel === "OVERDUE_WITH_COMMENT");
  const within3 = count((i) => i.urgencyLevel === "T3_IMMINENT");
  const withinWindow = count((i) => !i.isOverdue);
  const allAssignees = Array.from(new Set(items.map((i) => i.assigneeName))).sort((a, b) => a.localeCompare(b));

  const urgencyLabel: Record<TapOverdueHtmlItem["urgencyLevel"], string> = {
    CRITICAL_OVERDUE_NO_COMMENT: "Overdue, no update since due",
    OVERDUE_WITH_COMMENT: "Overdue, updated since due",
    T3_IMMINENT: "Due in 0–3 days",
    T7_APPROACHING: `Due within ${slaWindow} days`,
  };
  const urgencyBadge: Record<TapOverdueHtmlItem["urgencyLevel"], string> = {
    CRITICAL_OVERDUE_NO_COMMENT: "b-danger",
    OVERDUE_WITH_COMMENT: "b-critical",
    T3_IMMINENT: "b-wip",
    T7_APPROACHING: "b-todo",
  };

  const rowsHtml = items
    .map((t) => {
      const sla = t.isOverdue ? `${Math.abs(t.daysRemaining)} day(s) overdue` : `${t.daysRemaining} day(s) left`;
      const hasComment = t.latestCommentText && t.latestCommentText !== "None";
      const comment = hasComment
        ? `<div>${esc(t.latestCommentText)}</div><span class="sub">${esc(t.latestCommentAuthor)}${t.latestCommentTime ? " · " + esc(t.latestCommentTime) : ""}</span>`
        : `<span class="sub">No comment yet</span>`;
      const statusBadge =
        t.taskStatus === "inprogress"
          ? '<span class="badge b-brand">In progress</span>'
          : '<span class="badge b-todo">Not started</span>';
      return `<tr class="data-row${t.urgencyLevel === "CRITICAL_OVERDUE_NO_COMMENT" ? " hot" : ""}"
          data-status="${esc(t.taskStatus)}" data-assignee="${esc(t.assigneeName.toLowerCase())}"
          data-urgency="${esc(t.urgencyLevel)}" data-overdue="${t.isOverdue ? "1" : "0"}"
          data-search="${esc(`${t.dealerId} ${t.dbaName} ${t.tekionId} ${t.taskName} ${t.assigneeName}`.toLowerCase())}">
        <td data-v="${t.goLiveTimestamp}"><span class="strong">${esc(t.goLiveDate)}</span><span class="sub">${esc(t.goLiveTLabel)}</span></td>
        <td data-v="${esc(t.dealerId)}"><span class="dealer">#${esc(t.dealerId)}</span></td>
        <td data-v="${esc(t.dbaName)}">${esc(t.dbaName)}<span class="sub mono">${esc(t.tekionId)}</span></td>
        <td data-v="${esc(t.tekionId)}" class="mono">${esc(t.tekionId)}</td>
        <td data-v="${esc(t.taskName)}"><a class="task-link" href="${esc(t.taskUrl)}" target="_blank" rel="noopener">${esc(t.taskName)}</a><span class="sub mono">Task #${esc(t.taskId)}</span></td>
        <td data-v="${esc(t.taskStatus)}">${statusBadge}</td>
        <td data-v="${esc(t.assigneeName)}" class="strong">${esc(t.assigneeName)}</td>
        <td data-v="${t.dueDateTimestamp}"><span class="strong">${esc(t.dueDate)}</span><span class="badge ${urgencyBadge[t.urgencyLevel]} sla-pill">${esc(sla)}</span></td>
        <td data-v="${esc(urgencyLabel[t.urgencyLevel])}"><span class="badge ${urgencyBadge[t.urgencyLevel]}">${esc(urgencyLabel[t.urgencyLevel])}</span><div class="comment">${comment}</div></td>
      </tr>`;
    })
    .join("");

  const assigneeRows = assignees
    .map(
      ([name, s]) => `<tr>
        <td class="strong">${esc(name)}</td>
        <td class="num">${s.totalOverdue + s.dueSoon}</td>
        <td class="num ${s.totalOverdue ? "bad" : ""}">${s.totalOverdue}</td>
        <td class="num ${s.criticalOverdue ? "bad" : ""}">${s.criticalOverdue}</td>
        <td class="num">${s.inProgress}</td>
        <td class="num">${s.newStatus}</td>
        <td class="num">${s.dueSoon}</td>
      </tr>`
    )
    .join("");

  const assigneeOptions = allAssignees.map((n) => `<option value="${esc(n.toLowerCase())}">${esc(n)}</option>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>TAP Overdue & T-${esc(slaWindow)} Report</title>
<style>${REPORT_BASE_CSS}
  .task-link { color: var(--brand); font-weight: 700; text-decoration: none; }
  .task-link:hover { text-decoration: underline; }
  .sla-pill { margin-top: 4px; }
  .comment { margin-top: 4px; max-width: 360px; font-size: 12.5px; color: var(--ink-soft); }
  .summary { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; margin-bottom: 18px; }
  @media (min-width: 1000px) { .summary { grid-template-columns: 1fr 1fr; } }
  .summary h2 { font-size: 14px; margin: 0; padding: 12px 14px; border-bottom: 1px solid var(--line); }
  table.summary-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.summary-table th { text-align: left; font-size: 11px; text-transform: uppercase; color: var(--muted); padding: 8px 12px; background: #f8fafc; }
  table.summary-table th.num, table.summary-table td.num { text-align: right; }
  table.summary-table td { padding: 8px 12px; border-top: 1px solid #f1f5f9; }
  td.bad { color: var(--danger); font-weight: 700; }
</style>
</head>
<body>
<div class="wrap">
  <div class="page-head">
    <div>
      <h1 class="page-title">TAP Blueprint Tasks — Overdue &amp; T-${esc(slaWindow)} Report</h1>
      <div class="page-meta">Generated ${esc(generatedAt)} · Sorted by go-live, earliest first</div>
    </div>
  </div>

  <div class="why"><strong>What this shows.</strong> Blueprint configuration tasks that are overdue, or due within ${esc(slaWindow)} days. Overdue tasks with no comment posted after the due date are highlighted first, because nobody has updated them since they went overdue.</div>

  <div class="kpis">
    <div class="kpi"><div class="kpi-label">Tasks flagged</div><div class="kpi-value">${items.length}</div><div class="kpi-hint">Across ${dealerCount} dealer(s)</div></div>
    <div class="kpi danger"><div class="kpi-label">Overdue, no update since due</div><div class="kpi-value">${noCommentOverdue}</div><div class="kpi-hint">Needs an owner update</div></div>
    <div class="kpi warn"><div class="kpi-label">Overdue, updated since due</div><div class="kpi-value">${commentedOverdue}</div><div class="kpi-hint">Being worked, but late</div></div>
    <div class="kpi warn"><div class="kpi-label">Due in 0–3 days</div><div class="kpi-value">${within3}</div><div class="kpi-hint">Imminent</div></div>
    <div class="kpi"><div class="kpi-label">Due within ${esc(slaWindow)} days</div><div class="kpi-value">${withinWindow}</div><div class="kpi-hint">Not yet overdue</div></div>
  </div>

  <div class="summary">
    <div class="panel">
      <h2>By assignee</h2>
      <table class="summary-table">
        <thead><tr><th>Assignee</th><th class="num">Flagged</th><th class="num">Overdue</th><th class="num">Overdue 7+ days</th><th class="num">In progress</th><th class="num">Not started</th><th class="num">Due soon</th></tr></thead>
        <tbody>${assigneeRows}</tbody>
      </table>
    </div>
    <div class="panel">
      <h2 style="font-size:14px;margin:0;padding:12px 14px;border-bottom:1px solid var(--line);">How to read the table</h2>
      <div style="padding:12px 14px;font-size:13px;color:var(--ink-soft);">
        <p style="margin:0 0 8px"><span class="badge b-danger">Overdue, no update since due</span> Past due, and no comment was posted after the due date. Start here.</p>
        <p style="margin:0 0 8px"><span class="badge b-critical">Overdue, updated since due</span> Past due, but someone commented after the due date.</p>
        <p style="margin:0 0 8px"><span class="badge b-wip">Due in 0–3 days</span> Due very soon.</p>
        <p style="margin:0"><span class="badge b-todo">Due within ${esc(slaWindow)} days</span> Coming up, not urgent yet.</p>
      </div>
    </div>
  </div>

  <div class="panel">
    <div class="toolbar">
      <input class="search" id="search" type="search" placeholder="Search dealer, store, Tekion ID, task, assignee…" />
      <div class="field"><label>Status</label><select class="filter" id="f-status"><option value="ALL">All</option><option value="inprogress">In progress</option><option value="new">Not started</option></select></div>
      <div class="field"><label>Assignee</label><select class="filter" id="f-assignee"><option value="ALL">All</option>${assigneeOptions}</select></div>
      <div class="field"><label>Urgency</label><select class="filter" id="f-urgency">
        <option value="ALL">All</option>
        <option value="OVERDUE_ONLY">Overdue only</option>
        <option value="CRITICAL_OVERDUE_NO_COMMENT">Overdue, no update since due</option>
        <option value="OVERDUE_WITH_COMMENT">Overdue, updated since due</option>
        <option value="T3_IMMINENT">Due in 0–3 days</option>
        <option value="T7_APPROACHING">Due within ${esc(slaWindow)} days</option>
      </select></div>
      <div class="field"><label>Sort by</label><select class="filter" id="f-sort">
        <option value="golive">Go-live date</option>
        <option value="due">Task due date</option>
        <option value="dealer">Dealer #</option>
        <option value="assignee">Assignee</option>
      </select></div>
      <button class="btn" id="reset">Reset</button>
      <button class="btn" id="copy">Copy for Excel</button>
      <button class="btn primary" id="xls">Export to Excel</button>
      <div class="count" id="count"></div>
    </div>
    <div class="table-scroll">
      <table class="data" id="tbl">
        <thead><tr>
          <th data-label="Go-Live">Go-Live</th>
          <th data-label="Dealer ID">Dealer</th>
          <th data-label="Dealership">Dealership</th>
          <th data-label="Tekion ID">Tekion ID</th>
          <th data-label="Task">Task</th>
          <th data-label="Status">Status</th>
          <th data-label="Assignee">Assignee</th>
          <th data-label="Task Due / SLA">Due / SLA</th>
          <th data-label="Urgency &amp; latest comment">Urgency &amp; latest comment</th>
        </tr></thead>
        <tbody id="tbody">${rowsHtml}</tbody>
      </table>
      <div class="empty" id="empty">No tasks match these filters.</div>
    </div>
  </div>
  <div class="foot">All ${items.length} flagged task(s) are included. Filters and sorting only change what is shown; Copy and Export include the rows currently visible.</div>
</div>
<div class="toast" id="toast"></div>
<script>
${REPORT_BASE_JS}
(function () {
  var tbl = document.getElementById('tbl');
  var tbody = document.getElementById('tbody');
  var rows = Array.prototype.slice.call(tbody.querySelectorAll('tr.data-row'));
  var total = rows.length;
  var countEl = document.getElementById('count');
  var empty = document.getElementById('empty');
  var el = function (id) { return document.getElementById(id); };

  function apply() {
    var q = el('search').value.trim().toLowerCase();
    var st = el('f-status').value, as = el('f-assignee').value, ur = el('f-urgency').value;
    var shown = 0;
    rows.forEach(function (r) {
      var ok = true;
      if (q && r.getAttribute('data-search').indexOf(q) === -1) ok = false;
      if (st !== 'ALL' && r.getAttribute('data-status') !== st) ok = false;
      if (as !== 'ALL' && r.getAttribute('data-assignee') !== as) ok = false;
      if (ur === 'OVERDUE_ONLY' && r.getAttribute('data-overdue') !== '1') ok = false;
      else if (ur !== 'ALL' && ur !== 'OVERDUE_ONLY' && r.getAttribute('data-urgency') !== ur) ok = false;
      r.hidden = !ok;
      if (ok) shown++;
    });
    countEl.innerHTML = 'Showing <strong>' + shown + '</strong> of ' + total;
    empty.style.display = shown ? 'none' : 'block';
  }

  function sortRows() {
    var key = el('f-sort').value;
    var idx = { golive: 0, dealer: 1, assignee: 6, due: 7 }[key];
    rows.sort(function (a, b) {
      var av = a.children[idx].getAttribute('data-v'), bv = b.children[idx].getAttribute('data-v');
      var an = Number(av), bn = Number(bv);
      if (key === 'golive' || key === 'due') return an - bn;
      return String(av).localeCompare(String(bv), undefined, { numeric: true });
    });
    rows.forEach(function (r) { tbody.appendChild(r); });
    apply();
  }

  function exportXls() {
    var head = ['Go-Live Date', 'Dealer ID', 'Dealership Name', 'Tekion ID', 'Task Name', 'Status', 'Assignee', 'Task Due / SLA', 'Urgency & Latest Comment'];
    var cell = function (s) { return '<td>' + String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</td>'; };
    var body = rows.filter(function (r) { return !r.hidden; }).map(function (r) {
      return '<tr>' + Array.prototype.map.call(r.children, function (td) {
        return cell(td.textContent.replace(/\\s+/g, ' ').trim());
      }).join('') + '</tr>';
    }).join('');
    var table = '<table border="1"><thead><tr>' + head.map(function (h) {
      return '<th style="background:#0f172a;color:#fff;">' + h + '</th>';
    }).join('') + '</tr></thead><tbody>' + body + '</tbody></table>';
    var doc = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>TAP_Tasks_Audit</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body>' + table + '</body></html>';
    var blob = new Blob([doc], { type: 'application/vnd.ms-excel;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'TAP_Overdue_Tasks_Audit_${new Date().toISOString().slice(0, 10)}.xls';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    var exported = rows.filter(function (r) { return !r.hidden; }).length;
    flash('Exported ' + exported + ' row(s)');
  }

  ['search', 'f-status', 'f-assignee', 'f-urgency'].forEach(function (id) {
    el(id).addEventListener(id === 'search' ? 'input' : 'change', apply);
  });
  el('f-sort').addEventListener('change', sortRows);
  el('reset').addEventListener('click', function () {
    el('search').value = '';
    el('f-status').value = 'ALL'; el('f-assignee').value = 'ALL'; el('f-urgency').value = 'ALL'; el('f-sort').value = 'golive';
    sortRows();
  });
  el('copy').addEventListener('click', function () { copyForExcel(tbl); });
  el('xls').addEventListener('click', exportXls);
  sortRows();
})();
</script>
</body>
</html>`;
}
