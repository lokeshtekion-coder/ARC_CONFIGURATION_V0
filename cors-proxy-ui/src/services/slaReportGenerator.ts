import type { StoreRecord } from "./storesDb";

export interface SlaRecordItem {
  tekionId: string;
  dealerId: string;
  dbaName: string;
  launchDate: string;
  tLabel: string;
  daysUntilLaunch: number;
  superpodId: string;
  fixedOpsStatus: string;
  variableOpsStatus: string;
  isFixedOpsBreached: boolean;
  isVariableOpsBreached: boolean;
  isBreached: boolean;
  urgencyLabel: string;
}

export interface SlaReportData {
  items: SlaRecordItem[];
  totalEvaluated: number;
  breachedCount: number;
  fixedOpsBreachedCount: number;
  variableOpsBreachedCount: number;
  fixedOpsThresholdDays: number;
  variableOpsThresholdDays: number;
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

export function evaluateSlaBreaches(
  records: StoreRecord[],
  fixedOpsThresholdDays = 80,
  variableOpsThresholdDays = 75
): SlaReportData {
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const items: SlaRecordItem[] = [];
  let fixedOpsBreachedCount = 0;
  let variableOpsBreachedCount = 0;

  for (const store of records) {
    const launchDateObj = parseFlexibleDate(store.launch_date);
    if (!launchDateObj) continue;

    const launchStartDay = new Date(
      launchDateObj.getFullYear(),
      launchDateObj.getMonth(),
      launchDateObj.getDate()
    );

    const daysUntilLaunch = Math.round(
      (launchStartDay.getTime() - startToday.getTime()) / 86400000
    );

    let tLabel = "T";
    if (daysUntilLaunch > 0) {
      tLabel = `T-${daysUntilLaunch}`;
    } else if (daysUntilLaunch < 0) {
      tLabel = `Launched (+${Math.abs(daysUntilLaunch)}d)`;
    }

    const fixedOpsStatus = (store.fixed_ops_status || "TO DO").trim();
    const variableOpsStatus = (store.variable_ops_status || "TO DO").trim();

    const isFixedOpsCompleted = fixedOpsStatus.toLowerCase() === "completed";
    const isVariableOpsCompleted = variableOpsStatus.toLowerCase() === "completed";

    const isFixedOpsBreached = !isFixedOpsCompleted && daysUntilLaunch <= fixedOpsThresholdDays;
    const isVariableOpsBreached =
      !isVariableOpsCompleted && daysUntilLaunch <= variableOpsThresholdDays;

    if (isFixedOpsBreached) fixedOpsBreachedCount++;
    if (isVariableOpsBreached) variableOpsBreachedCount++;

    const isBreached = isFixedOpsBreached || isVariableOpsBreached;

    let urgencyLabel = "On Track";
    if (daysUntilLaunch <= 0 && isBreached) {
      urgencyLabel = "CRITICAL (Launched)";
    } else if (daysUntilLaunch <= 14 && isBreached) {
      urgencyLabel = "HIGH (<= 14d)";
    } else if (isBreached) {
      urgencyLabel = `DUE (${daysUntilLaunch}d left)`;
    }

    items.push({
      tekionId: store.tekion_id,
      dealerId: store.dealer_id,
      dbaName: store.dba_name || "—",
      launchDate: formatDisplayDate(launchDateObj),
      tLabel,
      daysUntilLaunch,
      superpodId: store.superpod_id || "—",
      fixedOpsStatus,
      variableOpsStatus,
      isFixedOpsBreached,
      isVariableOpsBreached,
      isBreached,
      urgencyLabel,
    });
  }

  items.sort((a, b) => {
    if (a.isBreached !== b.isBreached) {
      return a.isBreached ? -1 : 1;
    }
    return a.daysUntilLaunch - b.daysUntilLaunch;
  });

  const breachedCount = items.filter((item) => item.isBreached).length;

  return {
    items,
    totalEvaluated: items.length,
    breachedCount,
    fixedOpsBreachedCount,
    variableOpsBreachedCount,
    fixedOpsThresholdDays,
    variableOpsThresholdDays,
  };
}

export function generateSlaHtmlReport(data: SlaReportData): string {
  const generatedAt = new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const serializedRows = JSON.stringify(data.items);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Dealership SLA Breach Audit Report</title>
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
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
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
    .header-title { font-size: 22px; font-weight: 800; color: #fff; letter-spacing: -0.3px; }
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
    .btn-primary { background: #0284c7; border-color: #38bdf8; color: #fff; }
    .btn-primary:hover { background: #0369a1; }
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
    .kpi-label { font-size: 11px; text-transform: uppercase; font-weight: 700; color: var(--text-muted); letter-spacing: 0.5px; }
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
      padding: 6px 14px;
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
      padding: 6px 8px;
      background: #090d14;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 6px;
      color: #f8fafc;
      font-size: 11px;
      outline: none;
      transition: border-color 0.15s ease;
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
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 10.5px;
      font-weight: 700;
      white-space: nowrap;
    }
    .badge-breach { background: var(--danger-bg); color: var(--danger); border: 1px solid var(--danger-border); }
    .badge-ok { background: var(--success-bg); color: var(--success); border: 1px solid rgba(74, 222, 128, 0.28); }
    .badge-future { background: rgba(148, 163, 184, 0.12); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25); }
    .badge-wip { background: var(--warning-bg); color: var(--warning); border: 1px solid rgba(251, 191, 36, 0.28); }
    .badge-todo { background: rgba(148, 163, 184, 0.12); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25); }
  </style>
</head>
<body>
  <div class="header-panel">
    <div>
      <div class="header-title">🚨 Dealership SLA Breach Audit Report</div>
      <div class="header-subtitle">
        Active Window: Fixed Ops &le; <strong>${data.fixedOpsThresholdDays} Days to Go-Live</strong> • Variable Ops &le; <strong>${data.variableOpsThresholdDays} Days to Go-Live</strong> • Generated: ${generatedAt}
      </div>
    </div>
    <div class="header-actions">
      <button class="btn" onclick="resetFilters()">↺ Reset Filters</button>
      <button class="btn btn-primary" onclick="exportCsv()">📥 Export to CSV</button>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="kpi-label">Total Stores Audited</div>
      <div class="kpi-value" style="color: #f8fafc;">${data.totalEvaluated}</div>
      <div class="kpi-desc">Dealerships evaluated</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Total Breached Stores</div>
      <div class="kpi-value" style="color: var(--danger);">${data.breachedCount}</div>
      <div class="kpi-desc">Incomplete within 80d / 75d window</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Fixed Ops Breaches</div>
      <div class="kpi-value" style="color: var(--warning);">${data.fixedOpsBreachedCount}</div>
      <div class="kpi-desc">Incomplete &le; ${data.fixedOpsThresholdDays}d to go-live</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">Variable Ops Breaches</div>
      <div class="kpi-value" style="color: var(--warning);">${data.variableOpsBreachedCount}</div>
      <div class="kpi-desc">Incomplete &le; ${data.variableOpsThresholdDays}d to go-live</div>
    </div>
  </div>

  <div class="toolbar-strip">
    <div class="filter-pills">
      <button id="pill-breached" class="filter-pill active" onclick="setPreset('breached')">🚨 Breaches Only (${data.breachedCount})</button>
      <button id="pill-all" class="filter-pill" onclick="setPreset('all')">All Dealerships (${data.totalEvaluated})</button>
      <button id="pill-fixed" class="filter-pill" onclick="setPreset('fixed')">Fixed Ops Breached (${data.fixedOpsBreachedCount})</button>
      <button id="pill-var" class="filter-pill" onclick="setPreset('var')">Variable Ops Breached (${data.variableOpsBreachedCount})</button>
    </div>
    <div class="records-count">
      Showing <strong id="visible-count">${data.breachedCount}</strong> of ${data.totalEvaluated} dealerships
    </div>
  </div>

  <div class="table-container">
    <table id="slaTable">
      <thead>
        <tr class="th-title-row">
          <th>Tekion ID</th>
          <th>Dealer ID</th>
          <th>Dealership Name</th>
          <th>Go-Live Date</th>
          <th>Timeline</th>
          <th>POD</th>
          <th>Fixed Ops Status</th>
          <th>Fixed Ops SLA (&le;${data.fixedOpsThresholdDays}d)</th>
          <th>Variable Ops Status</th>
          <th>Variable Ops SLA (&le;${data.variableOpsThresholdDays}d)</th>
        </tr>

        <tr class="th-filter-row">
          <th>
            <input type="text" class="col-filter-input" placeholder="Search ID..." oninput="onFilterChange(0, this.value)" />
          </th>
          <th>
            <input type="text" class="col-filter-input" placeholder="Search Dealer..." oninput="onFilterChange(1, this.value)" />
          </th>
          <th>
            <input type="text" class="col-filter-input" placeholder="Search Name..." oninput="onFilterChange(2, this.value)" />
          </th>
          <th>
            <input type="text" class="col-filter-input" placeholder="Search Date..." oninput="onFilterChange(3, this.value)" />
          </th>
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
            <select class="col-filter-select" onchange="onFilterChange(6, this.value)">
              <option value="">All Statuses</option>
              <option value="Completed">Completed</option>
              <option value="WIP">WIP</option>
              <option value="TO DO">TO DO</option>
            </select>
          </th>
          <th>
            <select class="col-filter-select" onchange="onFilterChange(7, this.value)">
              <option value="">All SLAs</option>
              <option value="BREACHED">Breached</option>
              <option value="COMPLETED">Completed</option>
              <option value="FUTURE">Future (&gt;80d)</option>
            </select>
          </th>
          <th>
            <select class="col-filter-select" onchange="onFilterChange(8, this.value)">
              <option value="">All Statuses</option>
              <option value="Completed">Completed</option>
              <option value="WIP">WIP</option>
              <option value="TO DO">TO DO</option>
            </select>
          </th>
          <th>
            <select class="col-filter-select" onchange="onFilterChange(9, this.value)">
              <option value="">All SLAs</option>
              <option value="BREACHED">Breached</option>
              <option value="COMPLETED">Completed</option>
              <option value="FUTURE">Future (&gt;75d)</option>
            </select>
          </th>
        </tr>
      </thead>
      <tbody id="tableBody"></tbody>
    </table>
  </div>

  <script>
    const RAW_ITEMS = ${serializedRows};
    let currentPreset = 'breached';
    const columnFilters = {};

    function renderStatusBadge(status) {
      const s = (status || '').toLowerCase();
      if (s === 'completed') return '<span class="badge badge-ok">Completed</span>';
      if (s === 'wip') return '<span class="badge badge-wip">WIP</span>';
      return '<span class="badge badge-todo">' + (status || 'TO DO') + '</span>';
    }

    function renderSlaBadge(isBreached, status, daysUntil, threshold) {
      const s = (status || '').toLowerCase();
      if (s === 'completed') {
        return '<span class="badge badge-ok">✓ COMPLETED</span>';
      }
      if (isBreached) {
        return '<span class="badge badge-breach">⚠ BREACHED (' + daysUntil + 'd left)</span>';
      }
      return '<span class="badge badge-future">○ FUTURE (&gt;' + threshold + 'd)</span>';
    }

    function populateDropdownOptions() {
      const timelineSet = new Set();
      const podSet = new Set();

      RAW_ITEMS.forEach(item => {
        if (item.tLabel) timelineSet.add(item.tLabel);
        if (item.superpodId) podSet.add(item.superpodId);
      });

      const timelineSelect = document.getElementById('filter-timeline');
      const podSelect = document.getElementById('filter-pod');

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
    }

    function renderTable() {
      const tbody = document.getElementById('tableBody');
      tbody.innerHTML = '';

      let visible = 0;

      RAW_ITEMS.forEach(item => {
        if (currentPreset === 'breached' && !item.isBreached) return;
        if (currentPreset === 'fixed' && !item.isFixedOpsBreached) return;
        if (currentPreset === 'var' && !item.isVariableOpsBreached) return;

        const fixedSlaLabel = (item.fixedOpsStatus.toLowerCase() === 'completed')
          ? 'COMPLETED'
          : (item.isFixedOpsBreached ? 'BREACHED' : 'FUTURE');

        const varSlaLabel = (item.variableOpsStatus.toLowerCase() === 'completed')
          ? 'COMPLETED'
          : (item.isVariableOpsBreached ? 'BREACHED' : 'FUTURE');

        const rowValues = [
          item.tekionId,
          item.dealerId,
          item.dbaName,
          item.launchDate,
          item.tLabel,
          item.superpodId,
          item.fixedOpsStatus,
          fixedSlaLabel,
          item.variableOpsStatus,
          varSlaLabel
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

        const tr = document.createElement('tr');
        tr.innerHTML =
          '<td><strong>' + item.tekionId + '</strong></td>' +
          '<td><span style="color:var(--accent); font-weight:700;">' + item.dealerId + '</span></td>' +
          '<td>' + item.dbaName + '</td>' +
          '<td>' + item.launchDate + '</td>' +
          '<td><span class="badge" style="background:#1e293b; color:#f8fafc;">' + item.tLabel + '</span></td>' +
          '<td>' + item.superpodId + '</td>' +
          '<td>' + renderStatusBadge(item.fixedOpsStatus) + '</td>' +
          '<td>' + renderSlaBadge(item.isFixedOpsBreached, item.fixedOpsStatus, item.daysUntilLaunch, 80) + '</td>' +
          '<td>' + renderStatusBadge(item.variableOpsStatus) + '</td>' +
          '<td>' + renderSlaBadge(item.isVariableOpsBreached, item.variableOpsStatus, item.daysUntilLaunch, 75) + '</td>';
        tbody.appendChild(tr);
      });

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
      setPreset('breached');
    }

    function exportCsv() {
      const headers = ['Tekion ID','Dealer ID','Dealership','Go-Live','Timeline','POD','Fixed Ops Status','Fixed Ops SLA','Variable Ops Status','Variable Ops SLA'];
      const rows = [];

      RAW_ITEMS.forEach(item => {
        if (currentPreset === 'breached' && !item.isBreached) return;
        if (currentPreset === 'fixed' && !item.isFixedOpsBreached) return;
        if (currentPreset === 'var' && !item.isVariableOpsBreached) return;

        rows.push([
          '"' + item.tekionId + '"',
          '"' + item.dealerId + '"',
          '"' + item.dbaName.replace(/"/g, '""') + '"',
          '"' + item.launchDate + '"',
          '"' + item.tLabel + '"',
          '"' + item.superpodId + '"',
          '"' + item.fixedOpsStatus + '"',
          '"' + (item.fixedOpsStatus.toLowerCase() === 'completed' ? 'COMPLETED' : (item.isFixedOpsBreached ? 'BREACHED' : 'FUTURE')) + '"',
          '"' + item.variableOpsStatus + '"',
          '"' + (item.variableOpsStatus.toLowerCase() === 'completed' ? 'COMPLETED' : (item.isVariableOpsBreached ? 'BREACHED' : 'FUTURE')) + '"'
        ].join(','));
      });

      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', 'Dealership_SLA_Breaches_' + new Date().toISOString().slice(0,10) + '.csv');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    populateDropdownOptions();
    renderTable();
  </script>
</body>
</html>`;
}