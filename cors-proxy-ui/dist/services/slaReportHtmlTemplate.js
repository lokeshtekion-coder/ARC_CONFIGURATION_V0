import { SLA_REPORT_CSS } from "./slaReportStyles";
import { getReportClientScript } from "./slaReportClientScript";
export function renderFullReportHtml(reportData) {
    const generatedAt = new Date().toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
    });
    const serializedData = JSON.stringify(reportData);
    const clientScript = getReportClientScript(serializedData);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${reportData.title}</title>
  <style>
    ${SLA_REPORT_CSS}
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
    ${clientScript}
  </script>
</body>
</html>`;
}
