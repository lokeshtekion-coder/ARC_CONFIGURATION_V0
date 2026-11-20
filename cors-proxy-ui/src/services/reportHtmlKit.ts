// Shared building blocks for the standalone HTML reports sent to Slack.
// Everything written into the page goes through esc() so store names, comments
// and task names can never break the markup.

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Base look shared by every report: light, print-friendly, mobile-safe. */
export const REPORT_BASE_CSS = `
  :root {
    --ink: #0f172a;
    --ink-soft: #334155;
    --muted: #64748b;
    --line: #e2e8f0;
    --panel: #ffffff;
    --canvas: #f1f5f9;
    --brand: #0369a1;
    --brand-soft: #e0f2fe;
    --danger: #b91c1c;
    --danger-soft: #fee2e2;
    --warn: #b45309;
    --warn-soft: #fef3c7;
    --ok: #15803d;
    --ok-soft: #dcfce7;
    --neutral-soft: #f1f5f9;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 28px 20px 48px;
    background: var(--canvas);
    color: var(--ink);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  .wrap { max-width: 1400px; margin: 0 auto; }
  .page-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 18px; }
  .page-title { margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.2px; }
  .page-meta { margin-top: 4px; color: var(--muted); font-size: 13px; }
  .why {
    background: var(--brand-soft); border: 1px solid #bae6fd; color: #075985;
    border-radius: 10px; padding: 12px 14px; margin-bottom: 18px; font-size: 13px;
  }
  .why strong { font-weight: 700; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-bottom: 18px; }
  .kpi { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; box-shadow: 0 1px 2px rgba(15,23,42,0.04); }
  .kpi-label { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.4px; }
  .kpi-value { font-size: 28px; font-weight: 800; margin-top: 6px; color: var(--ink); }
  .kpi-hint { font-size: 12px; color: var(--muted); margin-top: 2px; }
  .kpi.danger .kpi-value { color: var(--danger); }
  .kpi.warn .kpi-value { color: var(--warn); }
  .kpi.ok .kpi-value { color: var(--ok); }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 1px 2px rgba(15,23,42,0.04); }
  .toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 12px; border-bottom: 1px solid var(--line); }
  .tabs { display: flex; flex-wrap: wrap; gap: 6px; }
  .tab {
    border: 1px solid var(--line); background: #fff; color: var(--ink-soft);
    border-radius: 999px; padding: 6px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer;
  }
  .tab:hover { border-color: #94a3b8; }
  .tab.active { background: var(--ink); border-color: var(--ink); color: #fff; }
  .tab .n { opacity: 0.7; margin-left: 4px; font-weight: 700; }
  .search {
    flex: 1 1 240px; min-width: 200px; border: 1px solid var(--line); border-radius: 8px;
    padding: 8px 10px; font-size: 13px; background: #f8fafc; outline: none;
  }
  .search:focus { border-color: var(--brand); background: #fff; }
  .field { display: flex; flex-direction: column; gap: 2px; }
  .field label { font-size: 10.5px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.4px; }
  select.filter {
    border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; font-size: 13px; background: #f8fafc; min-width: 150px;
  }
  .btn {
    border: 1px solid var(--line); background: #fff; color: var(--ink); border-radius: 8px;
    padding: 8px 12px; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .btn:hover { background: #f8fafc; }
  .btn.primary { background: var(--ink); border-color: var(--ink); color: #fff; }
  .btn.primary:hover { background: #1e293b; }
  .count { font-size: 13px; color: var(--muted); margin-left: auto; }
  .count strong { color: var(--ink); }
  .table-scroll { overflow-x: auto; }
  table.data { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; }
  table.data thead th {
    position: sticky; top: 0; z-index: 1; background: #f8fafc; color: var(--muted);
    text-align: left; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.4px;
    padding: 10px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; cursor: pointer; user-select: none;
  }
  table.data thead th .arrow { opacity: 0.35; margin-left: 4px; }
  table.data thead th.sorted .arrow { opacity: 1; color: var(--brand); }
  table.data tbody td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  table.data tbody tr:hover td { background: #f8fafc; }
  table.data tbody tr.hot td:first-child { box-shadow: inset 3px 0 0 var(--danger); }
  table.data tbody tr.hot td { background: #fee2e2; }
  table.data tbody tr[hidden] { display: none; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--muted); }
  .strong { font-weight: 700; }
  .dealer { font-weight: 800; color: var(--brand); }
  .sub { display: block; font-size: 11.5px; color: var(--muted); margin-top: 2px; }
  .badge {
    display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 999px;
    font-size: 11.5px; font-weight: 700; white-space: nowrap; border: 1px solid transparent;
  }
  .b-ok { background: var(--ok-soft); color: var(--ok); border-color: #bbf7d0; }
  .b-wip { background: var(--warn-soft); color: var(--warn); border-color: #fde68a; }
  .b-todo { background: var(--neutral-soft); color: var(--ink-soft); border-color: #cbd5e1; }
  .b-danger { background: var(--danger-soft); color: var(--danger); border-color: #fecaca; }
  .b-critical { background: #7f1d1d; color: #fff; }
  .b-excluded { background: #f3e8ff; color: #6b21a8; border-color: #e9d5ff; }
  .b-brand { background: var(--brand-soft); color: #075985; border-color: #bae6fd; }
  .empty { text-align: center; padding: 36px 12px; color: var(--muted); display: none; }
  .foot { margin-top: 12px; font-size: 12px; color: var(--muted); }
  .toast {
    position: fixed; right: 20px; bottom: 20px; background: var(--ink); color: #fff;
    padding: 10px 14px; border-radius: 8px; font-size: 13px; opacity: 0; transition: opacity .2s; pointer-events: none;
  }
  .toast.show { opacity: 1; }
  @media (max-width: 720px) {
    body { padding: 16px 10px 32px; }
    .page-title { font-size: 19px; }
    .kpi-value { font-size: 24px; }
    .count { margin-left: 0; width: 100%; }
  }
  @media print {
    body { background: #fff; padding: 0; }
    .toolbar .btn, .toolbar .search, .toolbar select, .toolbar .tabs { display: none; }
    .panel { box-shadow: none; }
    table.data thead th { position: static; }
  }
`;

/** Clipboard / download helpers used by the reports' inline scripts. */
export const REPORT_BASE_JS = `
  function flash(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }
  function tableRowsForExport(tbl) {
    var head = Array.prototype.map.call(tbl.querySelectorAll('thead th'), function (th) {
      return th.getAttribute('data-label') || th.textContent.replace(/[↕↑↓]/g, '').trim();
    });
    var rows = Array.prototype.filter.call(tbl.querySelectorAll('tbody tr.data-row'), function (tr) {
      return !tr.hidden;
    }).map(function (tr) {
      return Array.prototype.map.call(tr.children, function (td) {
        return td.textContent.replace(/\\s+/g, ' ').trim();
      });
    });
    return { head: head, rows: rows };
  }
  function copyForExcel(tbl) {
    var data = tableRowsForExport(tbl);
    if (!data.rows.length) { flash('No rows visible to copy'); return; }
    var tsv = [data.head.join('\\t')].concat(data.rows.map(function (r) {
      return r.map(function (c) { return c.replace(/\\t/g, ' '); }).join('\\t');
    })).join('\\n');
    navigator.clipboard.writeText(tsv).then(function () {
      flash('Copied ' + data.rows.length + ' row(s). Paste into Excel.');
    }, function () { flash('Clipboard blocked by browser'); });
  }
  function downloadCsv(tbl, fileName) {
    var data = tableRowsForExport(tbl);
    if (!data.rows.length) { flash('No rows visible to download'); return; }
    var q = function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; };
    var csv = [data.head.map(q).join(',')].concat(data.rows.map(function (r) {
      return r.map(q).join(',');
    })).join('\\r\\n');
    var blob = new Blob(['\\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    flash('Downloaded ' + data.rows.length + ' row(s)');
  }
`;
