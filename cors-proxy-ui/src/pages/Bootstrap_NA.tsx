import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
  extractBootstrapData,
  computeStats,
  toCsvString,
  downloadFile,
  COST_CENTER_KEYS,
} from "../utils/bootstrapExtractor";
import type {
  BootstrapOutput,
  GLAccount,
  CostCenterSetup,
  Journal,
  BootstrapStats,
} from "../utils/bootstrapExtractor";
import {
  idbSaveBootstrap,
  idbGetAllBootstraps,
  idbDeleteBootstrap,
} from "../utils/bootstrapDb";
import type { BootstrapRecord } from "../utils/bootstrapDb";

/* ─── Account type colours ──────────────────────────────────────────── */
const ACCT_TYPE_COLORS: Record<string, string> = {
  ASSET:     "#30d158",
  LIABILITY: "#ff453a",
  EQUITY:    "#bf5af2",
  REVENUE:   "#0a84ff",
  EXPENSE:   "#ff9f0a",
  CONTRA:    "#ff6c37",
};
const acctColor = (t: string) => ACCT_TYPE_COLORS[t?.toUpperCase()] ?? "#98989d";

/* ─── Tabs ──────────────────────────────────────────────────────────── */
type Tab = "glAccounts" | "costCenter" | "journals" | "salesChains";

/* ─── GL Accounts Sub-view ──────────────────────────────────────────── */
const GLAccountsView: React.FC<{ accounts: GLAccount[] }> = ({ accounts }) => {
  const [search, setSearch]   = useState("");
  const [sortBy, setSortBy]   = useState<keyof GLAccount>("accountNumber");
  const [sortAsc, setSortAsc] = useState(true);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return [...accounts]
      .filter((a) =>
        !q ||
        a.accountName.toLowerCase().includes(q)  ||
        a.accountNumber.toLowerCase().includes(q) ||
        a.accountTypeId.toLowerCase().includes(q)
      )
      .sort((a, b) => {
        const av = String(a[sortBy]);
        const bv = String(b[sortBy]);
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
  }, [accounts, search, sortBy, sortAsc]);

  const handleSort = (col: keyof GLAccount) => {
    if (sortBy === col) setSortAsc((v) => !v);
    else { setSortBy(col); setSortAsc(true); }
  };

  const Sorter = ({ col }: { col: keyof GLAccount }) => (
    <span style={{ opacity: sortBy === col ? 1 : 0.3, marginLeft: 3 }}>
      {sortBy === col ? (sortAsc ? "▲" : "▼") : "⇅"}
    </span>
  );

  return (
    <div className="bx-table-wrap">
      <div className="bx-search-bar">
        <input
          className="bx-search-input"
          type="text"
          placeholder="Search name, number, type..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="bx-count-badge">{filtered.length} / {accounts.length}</span>
      </div>
      <table className="bx-table">
        <thead>
          <tr>
            <th className="bx-th-sort" onClick={() => handleSort("accountNumber")}>
              # <Sorter col="accountNumber" />
            </th>
            <th className="bx-th-sort" onClick={() => handleSort("accountName")}>
              Name <Sorter col="accountName" />
            </th>
            <th className="bx-th-sort" onClick={() => handleSort("accountTypeId")}>
              Type <Sorter col="accountTypeId" />
            </th>
            <th>ID</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((a) => (
            <tr key={a.key}>
              <td><code className="bx-mono">{a.accountNumber}</code></td>
              <td>{a.accountName}</td>
              <td>
                <span
                  className="bx-type-badge"
                  style={{
                    color:       acctColor(a.accountTypeId),
                    borderColor: acctColor(a.accountTypeId) + "44",
                  }}
                >
                  {a.accountTypeId}
                </span>
              </td>
              <td><code className="bx-mono bx-muted">{a.id}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/* ─── Cost Centers Sub-view ─────────────────────────────────────────── */
const CostCenterView: React.FC<{
  setup:  CostCenterSetup[];
  stats:  BootstrapStats;
}> = ({ setup, stats }) => (
  <div className="bx-cc-wrap">
    <div className="bx-key-grid">
      {[...COST_CENTER_KEYS].map((key) => {
        const found = stats.foundKeys.includes(key);
        const entry = setup.find((cc) => cc.customFieldKey === key);
        return (
          <div key={key} className={`bx-key-card ${found ? "bx-key-ok" : "bx-key-miss"}`}>
            <div className="bx-key-top">
              <span>{found ? "✅" : "❌"}</span>
              <code className="bx-key-label">{key}</code>
            </div>
            <div className="bx-key-sub">
              {found
                ? `${entry!.options.length} option${entry!.options.length !== 1 ? "s" : ""}`
                : "not found in data"}
            </div>
          </div>
        );
      })}
    </div>
    {setup.map((cc) => (
      <div key={cc.key} className="bx-cc-block">
        <div className="bx-cc-header">
          <code className="bx-key-label">{cc.customFieldKey}</code>
          <span className="bx-count-badge">{cc.options.length} options</span>
        </div>
        {cc.options.length === 0 ? (
          <div className="bx-no-opts">No options configured</div>
        ) : (
          <table className="bx-table">
            <thead>
              <tr><th>Option ID</th><th>Option Name</th></tr>
            </thead>
            <tbody>
              {cc.options.map((opt) => (
                <tr key={opt.id}>
                  <td><code className="bx-mono">{opt.id}</code></td>
                  <td>{opt.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    ))}
  </div>
);

/* ─── Journals Sub-view ─────────────────────────────────────────────── */
const JournalsView: React.FC<{ journals: Journal[] }> = ({ journals }) => (
  <table className="bx-table">
    <thead>
      <tr>
        <th>Journal Name</th>
        <th>Number</th>
        <th>ID</th>
      </tr>
    </thead>
    <tbody>
      {journals.map((j) => (
        <tr key={j.key}>
          <td>{j.journalName}</td>
          <td><code className="bx-mono">{j.journalNumber}</code></td>
          <td><code className="bx-mono bx-muted">{j.id}</code></td>
        </tr>
      ))}
    </tbody>
  </table>
);

/* ─── Sales Chains Sub-view ─────────────────────────────────────────── */
interface SalesChainsProps {
  assetMap: Record<string, any> | null;
}

const SalesChainsView: React.FC<SalesChainsProps> = ({ assetMap }) => {
  const assetKeys = useMemo(() => {
    if (!assetMap || typeof assetMap !== "object") return [];
    return Object.keys(assetMap);
  }, [assetMap]);

  const [filterAssetKey, setFilterAssetKey] = useState<string>("ALL");
  const [expandedKeys, setExpandedKeys]     = useState<Record<string, boolean>>({});
  const [showRawMap, setShowRawMap]         = useState<boolean>(false);

  // Initialize: expand the first asset or all if count <= 3
  useEffect(() => {
    if (assetKeys.length > 0) {
      const initial: Record<string, boolean> = {};
      assetKeys.forEach((key, idx) => {
        initial[key] = idx === 0 || assetKeys.length <= 3;
      });
      setExpandedKeys(initial);
    }
  }, [assetKeys]);

  if (!assetMap || assetKeys.length === 0) {
    return (
      <div className="bx-empty-state">
        <span className="bx-empty-icon">⛓</span>
        <p>No <code>accessibleAssetMap</code> entries found in this payload.</p>
      </div>
    );
  }

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    assetKeys.forEach((k) => { next[k] = true; });
    setExpandedKeys(next);
  };

  const collapseAll = () => {
    const next: Record<string, boolean> = {};
    assetKeys.forEach((k) => { next[k] = false; });
    setExpandedKeys(next);
  };

  const displayedKeys = filterAssetKey === "ALL"
    ? assetKeys
    : assetKeys.filter((k) => k === filterAssetKey);

  return (
    <div className="bx-table-wrap">
      {/* Asset Map Dropdown & Accordion Actions */}
      <div className="bx-search-bar" style={{ gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
        <label htmlFor="asset-map-select" style={{ fontSize: "13px", fontWeight: 600 }}>
          accessibleAssetMap:
        </label>
        <select
          id="asset-map-select"
          className="bx-search-input"
          style={{ maxWidth: "340px", cursor: "pointer" }}
          value={filterAssetKey}
          onChange={(e) => setFilterAssetKey(e.target.value)}
        >
          <option value="ALL">Show All Assets ({assetKeys.length})</option>
          {assetKeys.map((key) => {
            const entry = assetMap[key];
            const displayName = entry?.name || entry?.dealerName || entry?.assetName;
            return (
              <option key={key} value={key}>
                {key}{displayName ? ` — ${displayName}` : ""}
              </option>
            );
          })}
        </select>

        <div style={{ display: "flex", gap: "6px" }}>
          <button className="btn-secondary btn-xs" onClick={expandAll}>Expand All</button>
          <button className="btn-secondary btn-xs" onClick={collapseAll}>Collapse All</button>
        </div>
      </div>

      {/* Expandable/Collapsible Asset Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}>
        {displayedKeys.map((key) => {
          const currentAsset = assetMap[key] ?? {};
          const rawChains =
            currentAsset.salesChains ??
            currentAsset.salesChain ??
            currentAsset.chains ??
            null;

          const chainsList: any[] = Array.isArray(rawChains)
            ? rawChains
            : rawChains && typeof rawChains === "object"
            ? Object.values(rawChains)
            : [];

          const displayName = currentAsset.name || currentAsset.dealerName || currentAsset.assetName;
          const isExpanded = !!expandedKeys[key];

          return (
            <div key={key} className="bx-cc-block" style={{ margin: 0 }}>
              <div
                className="bx-cc-header"
                onClick={() => toggleExpand(key)}
                style={{ cursor: "pointer", userSelect: "none" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "11px" }}>{isExpanded ? "▼" : "▶"}</span>
                  <code className="bx-key-label">{key}</code>
                  {displayName && (
                    <span style={{ fontSize: "13px", fontWeight: 500 }}>{displayName}</span>
                  )}
                </div>
                <span className="bx-count-badge">
                  {chainsList.length} Chain{chainsList.length !== 1 ? "s" : ""}
                </span>
              </div>

              {isExpanded && (
                <div style={{ padding: "8px 0 0 0" }}>
                  {chainsList.length > 0 ? (
                    <table className="bx-table">
                      <thead>
                        <tr>
                          <th>Chain Name</th>
                          <th>Code / Key</th>
                          <th>Chain ID</th>
                          <th>Status / Default</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chainsList.map((c, idx) => (
                          <tr key={c.id ?? c.key ?? c.code ?? idx}>
                            <td>{c.name ?? c.chainName ?? "—"}</td>
                            <td><code className="bx-mono">{c.code ?? c.chainCode ?? c.key ?? "—"}</code></td>
                            <td><code className="bx-mono bx-muted">{c.id ?? c.chainId ?? "—"}</code></td>
                            <td>
                              {c.isDefault || c.defaultChain ? (
                                <span className="bx-type-badge" style={{ color: "#30d158", borderColor: "#30d15844" }}>
                                  DEFAULT
                                </span>
                              ) : (
                                <span className="bx-muted">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: "12px" }}>
                      <div className="bx-no-opts" style={{ marginBottom: "8px" }}>
                        No explicit sales chains array found under this asset. Full asset payload:
                      </div>
                      <pre
                        className="bx-mono"
                        style={{
                          padding: "10px",
                          background: "#1c1c1e",
                          borderRadius: "6px",
                          fontSize: "12px",
                          overflowX: "auto",
                        }}
                      >
                        {JSON.stringify(currentAsset, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Collapsible Raw accessibleAssetMap JSON */}
      <div style={{ marginTop: "16px" }}>
        <button
          className="bx-history-toggle"
          style={{
            width: "100%",
            justifyContent: "space-between",
            display: "flex",
            padding: "8px 12px",
            cursor: "pointer",
          }}
          onClick={() => setShowRawMap((v) => !v)}
        >
          <span>🔍 Raw <code>accessibleAssetMap</code> JSON ({assetKeys.length} assets)</span>
          <span>{showRawMap ? "▲ Collapse" : "▼ Expand"}</span>
        </button>
        {showRawMap && (
          <pre
            className="bx-mono"
            style={{
              marginTop: "8px",
              padding: "12px",
              background: "#1c1c1e",
              borderRadius: "6px",
              fontSize: "12px",
              maxHeight: "340px",
              overflow: "auto",
            }}
          >
            {JSON.stringify(assetMap, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
};

/* ─── History Panel ─────────────────────────────────────────────────── */
const HistoryPanel: React.FC<{
  records:         BootstrapRecord[];
  onDelete:        (key: string) => void;
  onDownloadJson:  (record: BootstrapRecord) => void;
  onDownloadCsv:   (record: BootstrapRecord) => void;
}> = ({ records, onDelete, onDownloadJson, onDownloadCsv }) => {
  if (records.length === 0) {
    return <div className="bx-history-empty">No saved snapshots yet</div>;
  }
  return (
    <div className="bx-history-list">
      {records.map((r) => (
        <div key={r.key} className="bx-history-row">
          <div className="bx-history-meta">
            <span className="bx-history-dealer">{r.dealerName}</span>
            <span className="bx-history-time">
              {new Date(r.savedAt).toLocaleString()}
            </span>
          </div>
          <div className="bx-history-actions">
            <button
              className="btn-secondary btn-xs"
              title="Download JSON to laptop"
              onClick={() => onDownloadJson(r)}
            >
              ⬇ JSON
            </button>
            <button
              className="btn-secondary btn-xs"
              title="Download CSV to laptop"
              onClick={() => onDownloadCsv(r)}
            >
              ⬇ CSV
            </button>
            <button
              className="btn-danger btn-xs"
              title="Delete from IndexedDB"
              onClick={() => onDelete(r.key)}
            >
              🗑
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════════
 * Main Page
 * ═══════════════════════════════════════════════════════════════════ */
interface Props { onBack: () => void; }

export const BootstrapExtractor: React.FC<Props> = ({ onBack }) => {

  /* ── Core state ─────────────────────────────────────────────────── */
  const [jsonText, setJsonText]                     = useState("");
  const [result,   setResult]                       = useState<BootstrapOutput | null>(null);
  const [stats,    setStats]                        = useState<BootstrapStats   | null>(null);
  const [accessibleAssetMap, setAccessibleAssetMap] = useState<Record<string, any> | null>(null);
  const [error,    setError]                        = useState<string           | null>(null);
  const [tab,      setTab]                          = useState<Tab>("glAccounts");
  const [showLeftPanel, setShowLeftPanel]           = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── Save Snapshot state ────────────────────────────────────────── */
  const [saveDealer, setSaveDealer] = useState("");
  const [saving,     setSaving]     = useState(false);
  const [saveMsg,    setSaveMsg]    = useState<{ ok: boolean; text: string } | null>(null);

  /* ── IndexedDB history state ────────────────────────────────────── */
  const [idbHistory,  setIdbHistory]  = useState<BootstrapRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  /* ── Load history from IndexedDB ────────────────────────────────── */
  const loadHistory = useCallback(async () => {
    try {
      const records = await idbGetAllBootstraps();
      setIdbHistory(records.sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
    } catch {
      /* silent */
    }
  }, []);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  /* ── Save Snapshot handler ──────────────────────────────────────── */
  const handleSave = async () => {
    if (!saveDealer.trim() || !result) return;
    setSaving(true);
    setSaveMsg(null);

    try {
      const timestamp = new Date().toISOString();

      /* 1️⃣  Save to backend */
      const res = await fetch("http://localhost:4000/api/validation/save", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealerId:  saveDealer.trim(),
          bootstrap: result,
          timestamp: timestamp.replace(/[:.]/g, "-"),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { timestamp?: string };

      /* 2️⃣  Save to IndexedDB */
      const record: BootstrapRecord = {
        key:        `${saveDealer.trim()}__${timestamp}`,
        dealerName: saveDealer.trim(),
        envName:    timestamp,
        data:       result,
        savedAt:    timestamp,
      };
      await idbSaveBootstrap(record);
      await loadHistory();

      setSaveMsg({ ok: true, text: `✅ Saved snapshot: ${data.timestamp ?? ""}` });
    } catch (err: unknown) {
      setSaveMsg({
        ok:   false,
        text: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setSaving(false);
    }
  };

  /* ── Extract ────────────────────────────────────────────────────── */
  const handleExtract = useCallback(() => {
    if (!jsonText.trim()) { setError("Paste JSON first."); return; }
    try {
      const parsed = JSON.parse(jsonText);
      const output = extractBootstrapData(parsed);
      setResult(output);
      setStats(computeStats(output));

      const rawMap =
        parsed?.data?.accessibleAssetMap ??
        parsed?.accessibleAssetMap ??
        (output as Record<string, any>)?.accessibleAssetMap ??
        null;
      setAccessibleAssetMap(rawMap && typeof rawMap === "object" ? rawMap : null);

      setError(null);
      setSaveMsg(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
      setResult(null);
      setStats(null);
      setAccessibleAssetMap(null);
    }
  }, [jsonText]);

  /* ── Clear ──────────────────────────────────────────────────────── */
  const handleClear = useCallback(() => {
    setJsonText("");
    setResult(null);
    setStats(null);
    setAccessibleAssetMap(null);
    setError(null);
    setSaveDealer("");
    setSaveMsg(null);
  }, []);

  /* ── File upload ────────────────────────────────────────────────── */
  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setJsonText(ev.target?.result as string);
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  /* ── Downloads — current result ─────────────────────────────────── */
  const handleDownloadJSON = () =>
    result && downloadFile(JSON.stringify(result, null, 2), "bootstrap.json", "application/json");

  const handleDownloadCSV = () =>
    result && downloadFile(toCsvString(result), "bootstrap.csv", "text/csv");

  /* ── Downloads — from IndexedDB history ─────────────────────────── */
  const handleHistoryDownloadJson = (record: BootstrapRecord) => {
    const tag = `bootstrap__${record.dealerName}__${record.savedAt.replace(/[:.]/g, "-")}`;
    downloadFile(JSON.stringify(record.data, null, 2), `${tag}.json`, "application/json");
  };

  const handleHistoryDownloadCsv = (record: BootstrapRecord) => {
    const tag = `bootstrap__${record.dealerName}__${record.savedAt.replace(/[:.]/g, "-")}`;
    downloadFile(toCsvString(record.data as BootstrapOutput), `${tag}.csv`, "text/csv");
  };

  /* ── Delete from IndexedDB ──────────────────────────────────────── */
  const handleIdbDelete = async (key: string) => {
    try {
      await idbDeleteBootstrap(key);
      await loadHistory();
    } catch {
      /* silent */
    }
  };

  /* ── Tab config ─────────────────────────────────────────────────── */
  const TABS: [Tab, string, number | undefined][] = [
    ["glAccounts",  "GL Accounts",  stats?.totalGLAccounts],
    ["costCenter",   "Cost Centers", stats?.costCenterKeysFound],
    ["journals",     "Journals",     stats?.totalJournals],
    ["salesChains",  "Sales Chains", accessibleAssetMap ? Object.keys(accessibleAssetMap).length : undefined],
  ];

  const allKeysFound = stats
    ? stats.costCenterKeysFound === stats.costCenterKeysExpected
    : null;

  /* ── Render ─────────────────────────────────────────────────────── */
  return (
    <div className="bx-shell">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="bx-header">
        <div className="bx-header-left">
          <button className="btn-secondary btn-sm" onClick={onBack}>← Back</button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => setShowLeftPanel((prev) => !prev)}
            title={showLeftPanel ? "Collapse left panel" : "Expand left panel"}
          >
            {showLeftPanel ? "◀ Hide Panel" : "▶ Show Panel"}
          </button>
          <span className="bx-title">🗃 Bootstrap Extractor</span>
        </div>

        {stats && (
          <div className="bx-stats-row">
            <span className="bx-stat">
              <b>{stats.totalGLAccounts}</b> GL accounts
            </span>
            <span className="bx-stat">
              <b style={{ color: allKeysFound ? "#30d158" : "#ff9f0a" }}>
                {stats.costCenterKeysFound}/{stats.costCenterKeysExpected}
              </b>{" "}keys
              {!allKeysFound && (
                <span className="bx-missing-hint">
                  &nbsp;(missing: {stats.missingKeys.join(", ")})
                </span>
              )}
            </span>
            <span className="bx-stat">
              <b>{stats.totalJournals}</b> journals
            </span>
          </div>
        )}

        {result && (
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn-secondary btn-sm" onClick={handleDownloadJSON}>⬇ JSON</button>
            <button className="btn-secondary btn-sm" onClick={handleDownloadCSV}>⬇ CSV</button>
          </div>
        )}
      </div>

      {/* ── Body ────────────────────────────────────────────────────── */}
      <div className="bx-body">

        {/* ── Left Input Panel (Collapsible) ────────────────────────── */}
        {showLeftPanel && (
          <div className="bx-input-panel">
            <div className="bx-panel-label">Paste Bootstrap Response JSON</div>
            <textarea
              className="bx-json-textarea"
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              placeholder={`Paste full bootstrap API response...\n\n{\n  "data": {\n    "allAccounts": { ... },\n    "customField": { ... },\n    "allJournals":  { ... },\n    "accessibleAssetMap": { ... }\n  }\n}`}
              spellCheck={false}
            />
            {error && <div className="bx-error">⚠ {error}</div>}

            <div className="bx-input-actions">
              <button className="btn-postman" onClick={handleExtract}>▶ Extract</button>
              <button className="btn-cancel-bulk" onClick={handleClear}>✕ Clear</button>
              <button
                className="btn-secondary btn-sm"
                title="Upload .json file"
                onClick={() => fileRef.current?.click()}
              >
                📂 Upload File
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".json"
                style={{ display: "none" }}
                onChange={handleFile}
              />
            </div>

            {/* ── Save Snapshot ──────────────────────────────────────── */}
            {result && (
              <div className="glv-save-block">
                <div className="glv-step-label">
                  <span className="glv-step-num">💾</span> Save for GL Validation
                </div>
                <input
                  className="glv-input"
                  placeholder="Dealer ID e.g. DEALER_001"
                  value={saveDealer}
                  onChange={(e) => { setSaveDealer(e.target.value); setSaveMsg(null); }}
                />
                <button
                  className="btn-primary"
                  style={{ width: "100%" }}
                  disabled={!saveDealer.trim() || saving}
                  onClick={handleSave}
                >
                  {saving ? "Saving…" : "💾 Save Snapshot"}
                </button>
                {saveMsg && (
                  <div className={saveMsg.ok ? "glv-save-ok" : "bx-error"}>
                    {saveMsg.text}
                  </div>
                )}
              </div>
            )}

            {/* ── Cost Center Key Status Legend ───────────────────────── */}
            <div className="bx-legend">
              <div className="bx-legend-title">Cost Center Keys (5)</div>
              {[...COST_CENTER_KEYS].map((key) => {
                const found = stats?.foundKeys.includes(key);
                return (
                  <div key={key} className="bx-legend-row">
                    <span>{found === undefined ? "○" : found ? "✅" : "❌"}</span>
                    <code className="bx-legend-key">{key}</code>
                    {found === false && (
                      <span className="bx-legend-miss">missing</span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── IndexedDB Saved Snapshots ───────────────────────────── */}
            <div className="bx-history-section">
              <button
                className="bx-history-toggle"
                onClick={() => setShowHistory((v) => !v)}
              >
                <span>📚 Saved Snapshots ({idbHistory.length})</span>
                <span>{showHistory ? "▲" : "▼"}</span>
              </button>
              {showHistory && (
                <HistoryPanel
                  records={idbHistory}
                  onDelete={handleIdbDelete}
                  onDownloadJson={handleHistoryDownloadJson}
                  onDownloadCsv={handleHistoryDownloadCsv}
                />
              )}
            </div>
          </div>
        )}

        {/* ── Output Panel ──────────────────────────────────────────── */}
        <div
          className="bx-output-panel"
          style={{ flex: 1, width: showLeftPanel ? undefined : "100%" }}
        >
          {!result ? (
            <div className="bx-empty-state">
              <span className="bx-empty-icon">🗃</span>
              <p>Paste JSON and click <strong>Extract</strong></p>
              <p className="bx-empty-sub">Supports bootstrapresponse.json</p>
            </div>
          ) : (
            <>
              <div className="bx-tabs-bar">
                <div className="kv-mode-tabs">
                  {TABS.map(([id, label, count]) => (
                    <button
                      key={id}
                      className={`kv-mode-btn ${tab === id ? "kv-mode-active" : ""}`}
                      onClick={() => setTab(id)}
                    >
                      {label}
                      {count !== undefined && (
                        <span className="bx-tab-count">{count}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
              <div className="bx-output-content">
                {tab === "glAccounts" && <GLAccountsView accounts={result.glAccounts} />}
                {tab === "costCenter" && stats && (
                  <CostCenterView setup={result.costCenterSetup} stats={stats} />
                )}
                {tab === "journals" && <JournalsView journals={result.journals} />}
                {tab === "salesChains" && <SalesChainsView assetMap={accessibleAssetMap} />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};