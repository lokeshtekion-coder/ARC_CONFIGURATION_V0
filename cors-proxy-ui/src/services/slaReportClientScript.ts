export function getReportClientScript(serializedData: string): string {
  return `
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
  `;
}