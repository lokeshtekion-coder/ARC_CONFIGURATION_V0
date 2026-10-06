export const SLA_REPORT_CSS = `
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

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

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

  .header-title {
    font-size: 22px;
    font-weight: 800;
    color: #fff;
  }

  .header-subtitle {
    font-size: 13px;
    color: var(--text-muted);
    margin-top: 4px;
  }

  .header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

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

  .btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
  }

  .btn-copy {
    background: #0284c7;
    border-color: #38bdf8;
    color: #fff;
  }

  .btn-copy:hover {
    background: #0369a1;
  }

  .btn-copy.copied {
    background: #16a34a !important;
    border-color: #4ade80 !important;
    color: #fff !important;
  }

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

  .kpi-label {
    font-size: 11px;
    text-transform: uppercase;
    font-weight: 700;
    color: var(--text-muted);
  }

  .kpi-value {
    font-size: 24px;
    font-weight: 800;
    margin-top: 6px;
  }

  .kpi-desc {
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 2px;
  }

  .toolbar-strip {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
    gap: 12px;
    flex-wrap: wrap;
  }

  .filter-pills {
    display: inline-flex;
    background: var(--card-bg);
    padding: 3px;
    border-radius: 8px;
    border: 1px solid var(--card-border);
  }

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

  .filter-pill.active {
    background: #1e293b;
    color: var(--accent);
  }

  .records-count {
    font-size: 12px;
    color: var(--text-muted);
  }

  .records-count strong {
    color: #fff;
  }

  .table-container {
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 12px;
    overflow-x: auto;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  }

  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 12px;
    text-align: left;
  }

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

  tr:hover td {
    background: rgba(255, 255, 255, 0.02);
  }

  tr.priority-row td {
    background: rgba(244, 63, 94, 0.04);
  }

  tr.priority-row:hover td {
    background: rgba(244, 63, 94, 0.08);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 10.5px;
    font-weight: 700;
    white-space: nowrap;
  }

  .badge-ok {
    background: var(--success-bg);
    color: var(--success);
    border: 1px solid rgba(74, 222, 128, 0.28);
  }

  .badge-wip {
    background: var(--warning-bg);
    color: var(--warning);
    border: 1px solid rgba(251, 191, 36, 0.28);
  }

  .badge-breach {
    background: var(--danger-bg);
    color: var(--danger);
    border: 1px solid var(--danger-border);
  }

  .badge-t7 {
    background: rgba(244, 63, 94, 0.2);
    color: #fb7185;
    border: 1px solid rgba(244, 63, 94, 0.4);
    font-weight: 800;
  }

  .badge-neutral {
    background: rgba(148, 163, 184, 0.12);
    color: #94a3b8;
    border: 1px solid rgba(148, 163, 184, 0.25);
  }

  .badge-critical {
    background: #e11d48;
    color: #fff;
    font-weight: 800;
  }

  .badge-excluded {
    background: rgba(168, 85, 247, 0.15);
    color: #c084fc;
    border: 1px solid rgba(168, 85, 247, 0.35);
  }
`;
