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
  idbSaveBootstrapWithRawSections,
  idbGetAllBootstraps,
  idbDeleteBootstrap,
} from "../utils/bootstrapDb";
import type { BootstrapRecord } from "../utils/bootstrapDb";
import { loadGlobalHeaders } from "../services/tekionApiSettings";
import type { KeyValuePair } from "../types/proxy.types";

/**
 * HOW INDEXEDDB SAVE WORKS
 * ------------------------------------------------------------------
 * This screen extracts a simplified bootstrap view for UI usage
 * (dealerId, glAccounts, costCenterSetup, journals).
 *
 * During save, we preserve BOTH:
 * 1. the extracted bootstrap result used by the UI
 * 2. only the approved raw accounting bootstrap asset sections from
 *    the original JSON payload
 *
 * The saved IndexedDB record goes into:
 *   DB    : arc_bootstrap_db
 *   Store : bootstraps
 *
 * using dealerId as the key.
 *
 * Inside record.data, we keep extracted fields and attach only:
 * - apSetup
 * - accountingSettings
 * - allAccounts
 * - allJournals
 * - arSetup
 * - lookupAssetSupport
 * - glAccountDynamicKeys
 * - customField
 * - salesChains
 *
 * This keeps the snapshot reusable for downstream Accounting and
 * GL Validation screens without saving unrelated bootstrap assets.
 * ------------------------------------------------------------------
 */

const ACCT_TYPE_COLORS: Record<string, string> = {
  ASSET: "#30d158",
  LIABILITY: "#ff453a",
  EQUITY: "#bf5af2",
  REVENUE: "#0a84ff",
  EXPENSE: "#ff9f0a",
  CONTRA: "#ff6c37",
};

const acctColor = (t: string) => ACCT_TYPE_COLORS[t?.toUpperCase()] ?? "#98989d";

type Tab = "glAccounts" | "costCenter" | "journals" | "salesChains";

const BOOTSTRAP_URL =
  "https://preprodapp.tekioncloud.com/api/accounting/u/configurable/bootstrap";

const BOOTSTRAP_ASSET_TYPES = [
  "apSetup",
  "accountingSettings",
  "allAccounts",
  "allJournals",
  "arSetup",
  "lookupAssetSupport",
  "glAccountDynamicKeys",
  "customField",
  "salesChains",
] as const;

function toEnabledHeaderMap(headers: KeyValuePair[]): Record<string, string> {
  const out: Record<string, string> = {};

  for (const row of headers) {
    if (!row?.enabled) continue;
    const key = row.key?.trim();
    const value = row.value ?? "";
    if (!key || !String(value).trim()) continue;
    out[key] = String(value);
  }

  return out;
}

function findHeaderValueCaseInsensitive(
  headers: Record<string, string>,
  candidates: string[]
): string | null {
  const entries = Object.entries(headers);
  for (const candidate of candidates) {
    const found = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
    if (found && String(found[1]).trim()) {
      return String(found[1]).trim();
    }
  }
  return null;
}

function extractDealerIdFromHeaders(headers: Record<string, string>): string | null {
  return findHeaderValueCaseInsensitive(headers, [
    "dealerid",
    "dealerId",
    "dealer-id",
    "x-dealer-id",
  ]);
}

function buildBootstrapRequestBody(dealerId: string) {
  return {
    requestInfo: BOOTSTRAP_ASSET_TYPES.map((assetType) => ({
      assetType,
      dealerMetaDataInfo: [{ dealerId }],
    })),
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function getSalesChainsRoot(data: unknown): Record<string, unknown> | null {
  const root = asObject(data);
  if (!root) return null;

  if (root.salesChains) {
    return asObject(root.salesChains);
  }

  const innerData = asObject(root.data);
  if (innerData?.salesChains) {
    return asObject(innerData.salesChains);
  }

  return null;
}

function mapObjectValuesToRows(source: unknown): Array<Record<string, unknown>> {
  const obj = asObject(source);
  if (!obj) return [];

  return Object.entries(obj).flatMap(([entryKey, entryValue]) => {
    if (Array.isArray(entryValue)) {
      return entryValue
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          __entryKey: entryKey,
          ...(item as Record<string, unknown>),
        }));
    }

    if (entryValue && typeof entryValue === "object") {
      return [
        {
          __entryKey: entryKey,
          ...(entryValue as Record<string, unknown>),
        },
      ];
    }

    return [
      {
        __entryKey: entryKey,
        value: entryValue,
      },
    ];
  });
}

function getSalesChainsRows(data: unknown): Array<Record<string, unknown>> {
  const salesChains = getSalesChainsRoot(data);
  if (!salesChains) return [];

  const rows: Array<Record<string, unknown>> = [];

  // Inject __source to distinguish where the config came from
  rows.push(
    ...mapObjectValuesToRows(salesChains.masterAssetDocMap).map((r) => ({
      ...r,
      __source: "MASTER",
    }))
  );
  rows.push(
    ...mapObjectValuesToRows(salesChains.dealerAssetDocMap).map((r) => ({
      ...r,
      __source: "DEALER",
    }))
  );

  const deduped = new Map<string, Record<string, unknown>>();

  for (const row of rows) {
    const id = normalize(row.id);
    const entryKey = normalize(row.__entryKey);
    // Include source in dedupe to prevent collisions if IDs match
    const dedupeKey = `${id || entryKey}-${row.__source}`;
    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, row);
    }
  }

  return Array.from(deduped.values());
}

function getSalesChainsAccessibleRows(data: unknown): Array<{
  dealerId: string;
  assetIds: string[];
}> {
  const salesChains = getSalesChainsRoot(data);
  const accessibleMap = asObject(salesChains?.accessibleAssetMap);
  if (!accessibleMap) return [];

  return Object.entries(accessibleMap).map(([dealerId, assetIds]) => ({
    dealerId,
    assetIds: Array.isArray(assetIds) ? assetIds.map((x) => String(x)) : [],
  }));
}

const GLAccountsView: React.FC<{ accounts: GLAccount[] }> = ({ accounts }) => {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<keyof GLAccount>("accountNumber");
  const [sortAsc, setSortAsc] = useState(true);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return [...accounts]
      .filter(
        (a) =>
          !q ||
          a.accountName.toLowerCase().includes(q) ||
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
    else {
      setSortBy(col);
      setSortAsc(true);
    }
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
        <span className="bx-count-badge">
          {filtered.length} / {accounts.length}
        </span>
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
              <td>
                <code className="bx-mono">{a.accountNumber}</code>
              </td>
              <td>{a.accountName}</td>
              <td>
                <span
                  className="bx-type-badge"
                  style={{
                    color: acctColor(a.accountTypeId),
                    borderColor: acctColor(a.accountTypeId) + "44",
                  }}
                >
                  {a.accountTypeId}
                </span>
              </td>
              <td>
                <code className="bx-mono bx-muted">{a.id}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const CostCenterView: React.FC<{
  setup: CostCenterSetup[];
  stats: BootstrapStats;
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
              <tr>
                <th>Option ID</th>
                <th>Option Name</th>
              </tr>
            </thead>
            <tbody>
              {cc.options.map((opt) => (
                <tr key={opt.id}>
                  <td>
                    <code className="bx-mono">{opt.id}</code>
                  </td>
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
          <td>
            <code className="bx-mono">{j.journalNumber}</code>
          </td>
          <td>
            <code className="bx-mono bx-muted">{j.id}</code>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

const MetricCard: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div
    style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 12,
      padding: "12px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
    }}
  >
    <span style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.5 }}>
      {label}
    </span>
    <span style={{ fontSize: 16, fontWeight: 600, color: "#f8fafc" }}>{value}</span>
  </div>
);

const SalesChainsView: React.FC<{ data: unknown; glAccounts: GLAccount[] }> = ({ data, glAccounts }) => {
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const rows = useMemo(() => getSalesChainsRows(data), [data]);
  const accessibleRows = useMemo(() => getSalesChainsAccessibleRows(data), [data]);
  const salesChains = useMemo(() => getSalesChainsRoot(data), [data]);

  // Create an O(1) lookup map for GL Accounts based on ID
  const glMap = useMemo(() => {
    const map = new Map<string, GLAccount>();
    glAccounts.forEach((acc) => map.set(acc.id, acc));
    return map;
  }, [glAccounts]);

  const sortedRows = useMemo(() => {
    if (!sortBy) return rows;

    return [...rows].sort((a, b) => {
      const getVal = (row: Record<string, unknown>) => {
        const acctId = row[sortBy];
        // If null or missing, sort it to the bottom
        if (acctId === null || acctId === undefined || acctId === "") return "\uFFFF";

        const gl = glMap.get(String(acctId));
        // Sort by the GL Account Name if found, otherwise fallback to the ID itself
        if (gl) return gl.accountName.toLowerCase();
        return String(acctId).toLowerCase();
      };

      const valA = getVal(a);
      const valB = getVal(b);
      return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    });
  }, [rows, sortBy, sortAsc, glMap]);

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortAsc((v) => !v);
    } else {
      setSortBy(col);
      setSortAsc(true);
    }
  };

  const Sorter = ({ col }: { col: string }) => (
    <span style={{ opacity: sortBy === col ? 1 : 0.3, marginLeft: 3 }}>
      {sortBy === col ? (sortAsc ? "▲" : "▼") : "⇅"}
    </span>
  );

  // Smart Sub-component to render an Account Cell
  const SmartAccountCell = ({ acctId }: { acctId: unknown }) => {
    if (acctId === null || acctId === undefined || acctId === "") {
      return <span style={{ color: "#475569" }}>—</span>;
    }

    const strId = String(acctId);
    const gl = glMap.get(strId);

    if (!gl) {
      // Account ID exists in config, but isn't found in GL extraction
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <code className="bx-mono" style={{ color: "#cbd5e1" }}>
            {strId}
          </code>
          <span style={{ fontSize: 10, color: "#ef4444", fontWeight: 600 }}>⚠ Not in GL list</span>
        </div>
      );
    }

    // Beautifully rendered GL Account block
    const typeColor = acctColor(gl.accountTypeId);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <code className="bx-mono" style={{ color: "#f8fafc", fontSize: 13, fontWeight: 600 }}>
            {gl.accountNumber}
          </code>
          <span
            style={{
              fontSize: 10,
              padding: "2px 6px",
              borderRadius: 4,
              border: `1px solid ${typeColor}40`,
              color: typeColor,
              background: `${typeColor}15`,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            {gl.accountTypeId}
          </span>
        </div>
        <span style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.3 }}>
          {gl.accountName}
        </span>
      </div>
    );
  };

  if (!salesChains) {
    return (
      <div className="bx-empty-state">
        <span className="bx-empty-icon">🧾</span>
        <p>No salesChains object found in saved snapshot or pasted JSON</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Metrics Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
        <MetricCard label="Configured Chains" value={rows.length} />
        <MetricCard label="Asset Level" value={String(salesChains.assetLevel ?? "—")} />
        <MetricCard label="Object Type" value={String(salesChains.typeOfObject ?? "—")} />
        <MetricCard label="Accessible Dealers" value={accessibleRows.length} />
      </div>

      {/* Accessible Assets Mapping */}
      {accessibleRows.length > 0 && (
        <div className="bx-table-wrap">
          <div className="bx-search-bar" style={{ background: "transparent", borderBottom: "none", paddingBottom: 0 }}>
            <span
              className="bx-count-badge"
              style={{ background: "rgba(10,132,255,0.15)", color: "#60a5fa", border: "1px solid rgba(10,132,255,0.3)" }}
            >
              accessibleAssetMap
            </span>
          </div>
          <table className="bx-table">
            <thead>
              <tr>
                <th style={{ width: 150 }}>Dealer ID</th>
                <th>Accessible Asset IDs</th>
              </tr>
            </thead>
            <tbody>
              {accessibleRows.map((row) => (
                <tr key={row.dealerId}>
                  <td>
                    <code className="bx-mono">{row.dealerId}</code>
                  </td>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {row.assetIds.length > 0 ? (
                        row.assetIds.map((id) => (
                          <span
                            key={id}
                            style={{
                              padding: "4px 8px",
                              background: "rgba(255,255,255,0.06)",
                              border: "1px solid rgba(255,255,255,0.1)",
                              borderRadius: 6,
                              fontSize: 12,
                              fontFamily: "monospace",
                            }}
                          >
                            {id}
                          </span>
                        ))
                      ) : (
                        <span style={{ color: "#64748b" }}>—</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Main Configurations Table */}
      {sortedRows.length > 0 ? (
        <div className="bx-table-wrap">
          <div className="bx-search-bar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="bx-count-badge">Master & Dealer Core GL Mappings</span>
          </div>
          <table className="bx-table">
            <thead>
              <tr>
                <th style={{ width: 160 }}>ID / Source</th>
                <th style={{ width: 120 }}>Type</th>
                <th className="bx-th-sort" onClick={() => handleSort("saleAccountId")}>
                  Sale <Sorter col="saleAccountId" />
                </th>
                <th className="bx-th-sort" onClick={() => handleSort("costOfSaleAccountId")}>
                  Cost of Sale <Sorter col="costOfSaleAccountId" />
                </th>
                <th className="bx-th-sort" onClick={() => handleSort("costOffsetAccountId")}>
                  Cost Offset <Sorter col="costOffsetAccountId" />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, index) => {
                const id = row.id ?? row.__entryKey;
                const type = row.accountingChainType ?? "—";
                const source = row.__source as string;

                return (
                  <tr key={`${String(id)}-${index}`}>
                    <td style={{ verticalAlign: "top" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <code className="bx-mono" style={{ color: "#cbd5e1", fontSize: 13, wordBreak: "break-all" }}>
                          {String(id)}
                        </code>
                        {source && (
                          <span
                            style={{
                              alignSelf: "flex-start",
                              fontSize: 10,
                              padding: "2px 6px",
                              borderRadius: 4,
                              background: source === "MASTER" ? "rgba(191,90,242,0.15)" : "rgba(10,132,255,0.15)",
                              color: source === "MASTER" ? "#d946ef" : "#60a5fa",
                              border: `1px solid ${
                                source === "MASTER" ? "rgba(191,90,242,0.3)" : "rgba(10,132,255,0.3)"
                              }`,
                              fontWeight: 600,
                            }}
                          >
                            {source}
                          </span>
                        )}
                      </div>
                    </td>
                    <td style={{ verticalAlign: "top" }}>
                      <span
                        style={{
                          padding: "4px 8px",
                          borderRadius: 6,
                          border: "1px solid rgba(255,255,255,0.1)",
                          background: "rgba(255,255,255,0.05)",
                          fontSize: 12,
                          color: "#e2e8f0"
                        }}
                      >
                        {String(type)}
                      </span>
                    </td>
                    <td style={{ verticalAlign: "top" }}>
                      <SmartAccountCell acctId={row.saleAccountId} />
                    </td>
                    <td style={{ verticalAlign: "top" }}>
                      <SmartAccountCell acctId={row.costOfSaleAccountId} />
                    </td>
                    <td style={{ verticalAlign: "top" }}>
                      <SmartAccountCell acctId={row.costOffsetAccountId} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
};

const HistoryPanel: React.FC<{
  records: BootstrapRecord[];
  onLoad: (record: BootstrapRecord) => void;
  onDelete: (key: string) => void;
  onDownloadJson: (record: BootstrapRecord) => void;
  onDownloadCsv: (record: BootstrapRecord) => void;
}> = ({ records, onLoad, onDelete, onDownloadJson, onDownloadCsv }) => {
  if (records.length === 0) {
    return <div className="bx-history-empty">No saved snapshots yet</div>;
  }

  return (
    <div className="bx-history-list">
      {records.map((r) => (
        <div key={r.key} className="bx-history-row">
          <div
            className="bx-history-meta"
            style={{ cursor: "pointer", flex: 1 }}
            title="Click to load this snapshot"
            onClick={() => onLoad(r)}
          >
            <span className="bx-history-dealer">🏪 {r.dealerName}</span>
            <span className="bx-history-time">{new Date(r.savedAt).toLocaleString()}</span>
            <span style={{ fontSize: 10, color: "#0a84ff" }}>click to load →</span>
          </div>

          <div className="bx-history-actions">
            <button className="btn-secondary btn-xs" title="Download JSON" onClick={() => onDownloadJson(r)}>
              ⬇ JSON
            </button>
            <button className="btn-secondary btn-xs" title="Download CSV" onClick={() => onDownloadCsv(r)}>
              ⬇ CSV
            </button>
            <button className="btn-danger btn-xs" title="Delete from IndexedDB" onClick={() => onDelete(r.key)}>
              🗑
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};

interface Props {
  onBack: () => void;
}

export const BootstrapExtractor: React.FC<Props> = ({ onBack }) => {
  const [jsonText, setJsonText] = useState("");
  const [result, setResult] = useState<BootstrapOutput | null>(null);
  const [rawJson, setRawJson] = useState<Record<string, unknown> | null>(null);
  const [stats, setStats] = useState<BootstrapStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("glAccounts");
  const fileRef = useRef<HTMLInputElement>(null);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [idbHistory, setIdbHistory] = useState<BootstrapRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const [globalHeaders, setGlobalHeaders] = useState<KeyValuePair[]>([]);
  const [fetchingBootstrap, setFetchingBootstrap] = useState(false);
  const [fetchMsg, setFetchMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const enabledHeaderMap = useMemo(() => toEnabledHeaderMap(globalHeaders), [globalHeaders]);
  const detectedDealerId = useMemo(
    () => extractDealerIdFromHeaders(enabledHeaderMap),
    [enabledHeaderMap]
  );
  const enabledHeaderCount = useMemo(
    () => globalHeaders.filter((row) => row.enabled && row.key.trim() && row.value.trim()).length,
    [globalHeaders]
  );

  const loadHistory = useCallback(async () => {
    try {
      const records = await idbGetAllBootstraps();
      setIdbHistory(records.sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
    } catch {
      /* silent */
    }
  }, []);

  const refreshGlobalHeaders = useCallback(() => {
    try {
      setGlobalHeaders(loadGlobalHeaders());
    } catch {
      setGlobalHeaders([]);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
    refreshGlobalHeaders();

    const onFocus = () => refreshGlobalHeaders();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshGlobalHeaders();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadHistory, refreshGlobalHeaders]);

  const runExtractionFromText = useCallback((text: string) => {
    if (!text.trim()) {
      setError("Paste JSON first.");
      setResult(null);
      setStats(null);
      setRawJson(null);
      return;
    }

    try {
      const parsed = JSON.parse(text);
      // We cast to any so we can seamlessly inject the decoded sales chains for storage
      const output = extractBootstrapData(parsed) as any;

      // Extract and enrich sales chains directly into the output object for storage
      const rawRows = getSalesChainsRows(parsed);
      if (rawRows.length > 0) {
        const glMap = new Map<string, GLAccount>();
        if (Array.isArray(output.glAccounts)) {
          output.glAccounts.forEach((acc: GLAccount) => glMap.set(acc.id, acc));
        }

        const decodedRows = rawRows.map(row => {
          const decodedRow: Record<string, unknown> = { ...row };
          ['saleAccountId', 'costOfSaleAccountId', 'costOffsetAccountId'].forEach(key => {
            const acctId = row[key];
            if (acctId) {
              const gl = glMap.get(String(acctId));
              if (gl) {
                decodedRow[`${key}_Name`] = gl.accountName;
                decodedRow[`${key}_Number`] = gl.accountNumber;
                decodedRow[`${key}_Type`] = gl.accountTypeId;
              }
            }
          });
          return decodedRow;
        });

        // 1. Attach to the extracted result (ensures it is saved as extractedData and included in Download JSON)
        output.SalesChains_Decoded = decodedRows;

        // 2. Attach to the raw payload structure exactly alongside standard salesChains
        const rootData = (asObject(parsed.data) ? parsed.data : parsed) as any;
        if (rootData) {
          rootData.SalesChains_Decoded = decodedRows;
        }
      }

      setResult(output);
      setRawJson(parsed);
      setStats(computeStats(output));
      setError(null);
      return output;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
      setResult(null);
      setStats(null);
      setRawJson(null);
      return null;
    }
  }, []);

  const handleLoad = useCallback((record: BootstrapRecord) => {
    try {
      // Cast to any momentarily just in case the db structure has drift
      const rec = record as any;
      const output = (rec.data || rec.extractedData) as BootstrapOutput;

      setResult(output);
      setRawJson(rec.rawPayload || rec.data || rec.extractedData || {});
      setStats(computeStats(output));
      setError(null);
      setSaveMsg({ ok: true, text: `📂 Loaded snapshot for dealer: ${record.dealerName}` });
      setShowHistory(false);
    } catch {
      setError("Failed to load snapshot");
    }
  }, []);

  const handleExtract = useCallback(() => {
    setFetchMsg(null);
    setSaveMsg(null);
    void runExtractionFromText(jsonText);
  }, [jsonText, runExtractionFromText]);

  const handleFetchBootstrap = useCallback(async () => {
    setFetchMsg(null);
    setSaveMsg(null);
    setError(null);

    refreshGlobalHeaders();
    const currentHeaders = toEnabledHeaderMap(loadGlobalHeaders());
    const dealerId = extractDealerIdFromHeaders(currentHeaders);

    if (!dealerId) {
      setFetchMsg({
        ok: false,
        text: "No dealerid found in enabled Global Headers. Select a dealer in Settings first.",
      });
      return;
    }

    if (Object.keys(currentHeaders).length === 0) {
      setFetchMsg({
        ok: false,
        text: "No enabled Global Headers found. Select a dealer in Settings first.",
      });
      return;
    }

    setFetchingBootstrap(true);

    try {
      const proxyRes = await fetch("http://localhost:4000/api/proxy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: BOOTSTRAP_URL,
          method: "POST",
          headers: currentHeaders,
          body: buildBootstrapRequestBody(dealerId),
          timeout: 60000,
        }),
      });

      if (!proxyRes.ok) {
        throw new Error(`Proxy request failed with HTTP ${proxyRes.status}`);
      }

      const proxyJson = (await proxyRes.json()) as {
        status?: number;
        statusText?: string;
        body?: unknown;
        data?: unknown;
      };

      if ((proxyJson.status ?? 200) >= 400) {
        throw new Error(
          `Bootstrap request failed: ${proxyJson.status ?? ""} ${proxyJson.statusText ?? ""}`.trim()
        );
      }

      const actualPayload = proxyJson.body ?? proxyJson.data ?? proxyJson;
      const rawResponseText = JSON.stringify(actualPayload, null, 2);
      setJsonText(rawResponseText);

      const output = runExtractionFromText(rawResponseText);
      if (!output) {
        setFetchMsg({
          ok: false,
          text: `Bootstrap fetched for dealer ${dealerId}, but extraction failed.`,
        });
        return;
      }

      setFetchMsg({
        ok: true,
        text: `✅ Bootstrap fetched and extracted for dealer ${dealerId}`,
      });
    } catch (e: unknown) {
      setFetchMsg({
        ok: false,
        text: e instanceof Error ? e.message : "Failed to fetch bootstrap response",
      });
    } finally {
      setFetchingBootstrap(false);
      refreshGlobalHeaders();
    }
  }, [refreshGlobalHeaders, runExtractionFromText]);

  const handleClear = useCallback(() => {
    setJsonText("");
    setResult(null);
    setRawJson(null);
    setStats(null);
    setError(null);
    setSaveMsg(null);
    setFetchMsg(null);
  }, []);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setJsonText(ev.target?.result as string);
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const handleSave = async () => {
    if (!result || result.dealerId === "UNKNOWN") return;

    setSaving(true);
    setSaveMsg(null);

    try {
      const timestamp = new Date().toISOString();

      const res = await fetch("http://localhost:4000/api/validation/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dealerId: result.dealerId,
          bootstrap: result,
          timestamp: timestamp.replace(/[:.]/g, "-"),
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { timestamp?: string };

      let rawPayload: unknown = undefined;
      try {
        rawPayload = jsonText ? JSON.parse(jsonText) : undefined;
      } catch {
        rawPayload = undefined;
      }

      // If we correctly updated rawPayload inside runExtractionFromText, IDB receives it natively
      await idbSaveBootstrapWithRawSections({
        key: result.dealerId,
        dealerName: result.dealerId,
        envName: result.dealerId,
        extractedData: result, // Now natively includes SalesChains_Decoded
        rawPayload,
        savedAt: timestamp,
      });

      await loadHistory();

      setSaveMsg({
        ok: true,
        text: `✅ Saved snapshot for dealer: ${data.timestamp ?? result.dealerId}`,
      });
    } catch (err: unknown) {
      setSaveMsg({
        ok: false,
        text: err instanceof Error ? err.message : "Save failed",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadJSON = () =>
    result && downloadFile(JSON.stringify(result, null, 2), "bootstrap.json", "application/json");

  const handleDownloadCSV = () =>
    result && downloadFile(toCsvString(result), "bootstrap.csv", "text/csv");

  const handleHistoryDownloadJson = (record: BootstrapRecord) => {
    const tag = `bootstrap__${record.dealerName}__${record.savedAt.replace(/[:.]/g, "-")}`;
    downloadFile(JSON.stringify(record.data, null, 2), `${tag}.json`, "application/json");
  };

  const handleHistoryDownloadCsv = (record: BootstrapRecord) => {
    const tag = `bootstrap__${record.dealerName}__${record.savedAt.replace(/[:.]/g, "-")}`;
    downloadFile(toCsvString(record.data as BootstrapOutput), `${tag}.csv`, "text/csv");
  };

  const handleIdbDelete = async (key: string) => {
    try {
      await idbDeleteBootstrap(key);
      await loadHistory();
    } catch {
      /* silent */
    }
  };

  const salesChainsCount = useMemo(() => {
    if (!rawJson) return 0;
    return getSalesChainsRows(rawJson).length;
  }, [rawJson]);

  const TABS: [Tab, string, number | undefined][] = [
    ["glAccounts", "GL Accounts", stats?.totalGLAccounts],
    ["costCenter", "Cost Centers", stats?.costCenterKeysFound],
    ["journals", "Journals", stats?.totalJournals],
    ["salesChains", "Sales Chains", salesChainsCount],
  ];

  const allKeysFound = stats
    ? stats.costCenterKeysFound === stats.costCenterKeysExpected
    : null;

  return (
    <div className="bx-shell">
      <div className="bx-header">
        <div className="bx-header-left">
          <button className="btn-secondary btn-sm" onClick={onBack}>
            ← Back
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
              </b>{" "}
              keys
              {!allKeysFound && (
                <span className="bx-missing-hint">
                  &nbsp;(missing: {stats.missingKeys.join(", ")})
                </span>
              )}
            </span>
            <span className="bx-stat">
              <b>{stats.totalJournals}</b> journals
            </span>
            <span className="bx-stat">
              <b>{salesChainsCount}</b> salesChains
            </span>
          </div>
        )}

        {result && (
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn-secondary btn-sm" onClick={handleDownloadJSON}>
              ⬇ JSON
            </button>
            <button className="btn-secondary btn-sm" onClick={handleDownloadCSV}>
              ⬇ CSV
            </button>
          </div>
        )}
      </div>

      <div className="bx-body">
        <div className="bx-input-panel">
          <div
            style={{
              marginBottom: 14,
              padding: 12,
              borderRadius: 14,
              border: "1px solid rgba(59,130,246,0.18)",
              background: "rgba(59,130,246,0.08)",
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ color: "#f8fafc", fontWeight: 700, fontSize: 14 }}>
              ⚡ Auto Fetch from Selected Dealer Headers
            </div>

            <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>
              Uses the enabled Global Headers from Settings. Select a dealer in Captured Dealer Profiles,
              then fetch the bootstrap response automatically.
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <span
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.04)",
                  color: "#cbd5e1",
                  fontSize: 12,
                }}
              >
                Enabled Headers: <b style={{ color: "#f8fafc" }}>{enabledHeaderCount}</b>
              </span>

              <span
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.04)",
                  color: "#cbd5e1",
                  fontSize: 12,
                }}
              >
                Dealer ID: <b style={{ color: detectedDealerId ? "#86efac" : "#fca5a5" }}>
                  {detectedDealerId ?? "Not found"}
                </b>
              </span>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn-postman"
                onClick={() => void handleFetchBootstrap()}
                disabled={fetchingBootstrap || !detectedDealerId || enabledHeaderCount === 0}
              >
                {fetchingBootstrap ? "Fetching..." : "⇢ Fetch Bootstrap"}
              </button>

              <button className="btn-secondary btn-sm" onClick={refreshGlobalHeaders}>
                ⟳ Refresh Headers
              </button>
            </div>

            {fetchMsg ? (
              <div
                style={{
                  color: fetchMsg.ok ? "#bbf7d0" : "#fecaca",
                  background: fetchMsg.ok
                    ? "rgba(34,197,94,0.10)"
                    : "rgba(239,68,68,0.10)",
                  border: fetchMsg.ok
                    ? "1px solid rgba(34,197,94,0.22)"
                    : "1px solid rgba(239,68,68,0.22)",
                  borderRadius: 12,
                  padding: "10px 12px",
                  fontSize: 13,
                }}
              >
                {fetchMsg.text}
              </div>
            ) : null}
          </div>

          <div className="bx-panel-label">Paste Bootstrap Response JSON</div>
          <textarea
            className="bx-json-textarea"
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            placeholder={`Paste full bootstrap API response...\n\n{\n  "data": {\n    "allAccounts": { ... },\n    "customField": { ... },\n    "allJournals": { ... },\n    "salesChains": { ... }\n  }\n}`}
            spellCheck={false}
          />
          {error && <div className="bx-error">⚠ {error}</div>}

          <div className="bx-input-actions">
            <button className="btn-postman" onClick={handleExtract}>
              ▶ Extract
            </button>
            <button className="btn-cancel-bulk" onClick={handleClear}>
              ✕ Clear
            </button>
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

          {result && (
            <div className="glv-save-block">
              <div className="glv-step-label">
                <span className="glv-step-num">💾</span> Save for GL Validation
              </div>
              <div className="bd-save-key-row">
                <span className="bd-save-key-label">Dealer ID</span>
                <span className="bd-save-key-value">{result.dealerId}</span>
              </div>
              <button
                className="btn-primary"
                style={{ width: "100%" }}
                disabled={result.dealerId === "UNKNOWN" || saving}
                onClick={handleSave}
              >
                {saving ? "Saving…" : "💾 Save Snapshot"}
              </button>
              {saveMsg && (
                <div className={saveMsg.ok ? "glv-save-ok" : "bx-error"}>{saveMsg.text}</div>
              )}
            </div>
          )}

          <div className="bx-legend">
            <div className="bx-legend-title">Cost Center Keys (5)</div>
            {[...COST_CENTER_KEYS].map((key) => {
              const found = stats?.foundKeys.includes(key);
              return (
                <div key={key} className="bx-legend-row">
                  <span>{found === undefined ? "○" : found ? "✅" : "❌"}</span>
                  <code className="bx-legend-key">{key}</code>
                  {found === false && <span className="bx-legend-miss">missing</span>}
                </div>
              );
            })}
          </div>

          <div className="bx-history-section">
            <button className="bx-history-toggle" onClick={() => setShowHistory((v) => !v)}>
              <span>📚 Saved Snapshots ({idbHistory.length})</span>
              <span>{showHistory ? "▲" : "▼"}</span>
            </button>
            {showHistory && (
              <HistoryPanel
                records={idbHistory}
                onLoad={handleLoad}
                onDelete={handleIdbDelete}
                onDownloadJson={handleHistoryDownloadJson}
                onDownloadCsv={handleHistoryDownloadCsv}
              />
            )}
          </div>
        </div>

        <div className="bx-output-panel">
          {!result ? (
            <div className="bx-empty-state">
              <span className="bx-empty-icon">🗃</span>
              <p>
                Paste JSON and click <strong>Extract</strong>
              </p>
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
                      {count !== undefined && <span className="bx-tab-count">{count}</span>}
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
                {tab === "salesChains" && (
                  <SalesChainsView data={rawJson} glAccounts={result.glAccounts} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default BootstrapExtractor;