import React, { useEffect, useMemo, useState, useCallback } from "react";
import { fetchStores, getTDaysRange } from "../services/tekionStoresApi";
import type { TRange, StoreRecord as ApiStoreRecord } from "../services/tekionStoresApi";
import { getStores, saveStores } from "../services/storesDb";
import type { StoreRecord } from "../services/storesDb";
import type {
  OnboardingStatus,
  StoreBlueprintStatuses,
  StoreSignoffStatuses,
} from "../services/storeOnboardingStatusApi";
import { fetchStoreOnboardingStatuses } from "../services/storeOnboardingStatusApi";
import { exportStoresToExcel } from "../services/storesExcelExport";
import { syncStoresToGraphWorkbook } from "../services/storesGraphSync";

interface Props {
  onBack: () => void;
}

function parseLaunchDate(value: string): Date | null {
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    const num = Number(value);
    const ms = value.length <= 10 ? num * 1000 : num;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatLaunchDate(value: string): string {
  const d = parseLaunchDate(value);
  if (!d) return value || "—";

  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  const year = d.getFullYear();

  return `${weekday} ${month}/${day}/${year}`;
}

function getTLabel(value: string): { label: string; tone: "future" | "today" | "past" | "unknown" } {
  const d = parseLaunchDate(value);
  if (!d) return { label: "Unknown", tone: "unknown" };

  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const launchDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const diffMs = launchDay.getTime() - startToday.getTime();
  const diffDays = Math.round(diffMs / 86400000);

  if (diffDays > 0) return { label: `T-${diffDays}`, tone: "future" };
  if (diffDays === 0) return { label: "T", tone: "today" };
  return { label: "Launched", tone: "past" };
}

function toInputDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfDayUnix(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`);
  return Math.floor(d.getTime() / 1000);
}

function endOfDayUnix(dateStr: string): number {
  const d = new Date(`${dateStr}T23:59:59`);
  return Math.floor(d.getTime() / 1000);
}

function isSameLocalDay(isoString?: string): boolean {
  if (!isoString) return false;
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return false;

  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function shouldAutoFetchStatuses(records: StoreRecord[]): boolean {
  if (records.length === 0) return true;
  return records.some((row) => !isSameLocalDay(row.onboarding_status_fetched_at));
}

function getStatusVisual(status: OnboardingStatus): {
  symbol: string;
  background: string;
  color: string;
  border: string;
  label: string;
} {
  if (status === "COMPLETED") {
    return {
      symbol: "✓",
      background: "rgba(34, 197, 94, 0.16)",
      color: "#22c55e",
      border: "rgba(34, 197, 94, 0.30)",
      label: "Completed",
    };
  }

  if (status === "IN_PROGRESS") {
    return {
      symbol: "⏳",
      background: "rgba(245, 158, 11, 0.16)",
      color: "#f59e0b",
      border: "rgba(245, 158, 11, 0.30)",
      label: "In Progress",
    };
  }

  return {
    symbol: "○",
    background: "rgba(148, 163, 184, 0.14)",
    color: "#94a3b8",
    border: "rgba(148, 163, 184, 0.24)",
    label: status === "NOT_YET_STARTED" ? "Not Yet Started" : "Unknown",
  };
}

function isPod2(superpodId?: string): boolean {
  const normalized = (superpodId || "").trim().toLowerCase();
  return normalized === "2" || normalized === "pod 2" || normalized === "pod-2";
}

const StatusChip: React.FC<{
  short: string;
  fullName: string;
  status: OnboardingStatus;
}> = ({ short, fullName, status }) => {
  const visual = getStatusVisual(status);

  return (
    <span
      title={`${fullName}: ${visual.label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        borderRadius: 999,
        background: visual.background,
        color: visual.color,
        border: `1px solid ${visual.border}`,
        fontSize: 11,
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <span>{short}</span>
      <span>{visual.symbol}</span>
    </span>
  );
};

const StatusChipGroup: React.FC<{
  items: Array<{
    short: string;
    fullName: string;
    status: OnboardingStatus;
  }>;
}> = ({ items }) => (
  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minWidth: 180 }}>
    {items.map((item) => (
      <StatusChip
        key={item.fullName}
        short={item.short}
        fullName={item.fullName}
        status={item.status}
      />
    ))}
  </div>
);

const StatusChipSkeleton: React.FC<{ count: number }> = ({ count }) => (
  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", minWidth: 180 }}>
    {Array.from({ length: count }).map((_, i) => (
      <span
        key={i}
        style={{
          display: "inline-block",
          width: i === count - 1 && count > 3 ? 44 : 36,
          height: 24,
          borderRadius: 999,
          background:
            "linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.06) 75%)",
          backgroundSize: "200% 100%",
          animation: "storesSkeletonPulse 1.2s ease-in-out infinite",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      />
    ))}
  </div>
);

const StatusUnavailable: React.FC<{ onRetry: () => void }> = ({ onRetry }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 180 }}>
    <span
      title="Onboarding status fetch failed"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 8px",
        borderRadius: 999,
        background: "rgba(239, 68, 68, 0.12)",
        color: "#f87171",
        border: "1px solid rgba(239, 68, 68, 0.24)",
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      ⚠ Data Unavailable
    </span>

    <button className="btn-secondary btn-sm" onClick={onRetry} title="Retry onboarding statuses">
      ↻
    </button>
  </div>
);

const StickyLegend: React.FC = () => {
  const items = [
    { label: "Completed", bg: "rgba(34, 197, 94, 0.16)", color: "#22c55e", border: "rgba(34, 197, 94, 0.30)", symbol: "✓" },
    { label: "In Progress", bg: "rgba(245, 158, 11, 0.16)", color: "#f59e0b", border: "rgba(245, 158, 11, 0.30)", symbol: "⏳" },
    { label: "Not Started / Unknown", bg: "rgba(148, 163, 184, 0.14)", color: "#94a3b8", border: "rgba(148, 163, 184, 0.24)", symbol: "○" },
  ];

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        padding: "10px 12px",
        marginBottom: 10,
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(15,16,20,0.96)",
        backdropFilter: "blur(6px)",
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
      }}
    >
      {items.map((item) => (
        <span
          key={item.label}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 8px",
            borderRadius: 999,
            background: item.bg,
            color: item.color,
            border: `1px solid ${item.border}`,
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          <span>{item.symbol}</span>
          <span>{item.label}</span>
        </span>
      ))}
    </div>
  );
};

function withOnboardingStatuses(
  stores: ApiStoreRecord[],
  statusMap: Record<
    string,
    {
      blueprint_statuses: StoreBlueprintStatuses;
      signoff_statuses: StoreSignoffStatuses;
    }
  >
): StoreRecord[] {
  const fetchedAt = new Date().toISOString();

  return stores.map((store) => {
    const statuses = statusMap[store.tekion_id];
    return {
      ...store,
      blueprint_statuses: statuses?.blueprint_statuses,
      signoff_statuses: statuses?.signoff_statuses,
      onboarding_status_fetched_at: fetchedAt,
    };
  });
}

export const Stores: React.FC<Props> = ({ onBack }) => {
  const [records, setRecords] = useState<StoreRecord[]>([]);
  const [loadingStores, setLoadingStores] = useState(false);
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  const [syncingExcel, setSyncingExcel] = useState(false);
  const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);

  const [range, setRange] = useState<TRange>(90);
  const [search, setSearch] = useState("");
  const [superpodId, setSuperpodId] = useState("");
  const [implementationType, setImplementationType] = useState("");

  const presetRange = useMemo(() => getTDaysRange(range), [range]);

  const [fromDate, setFromDate] = useState(toInputDate(presetRange.fromDate));
  const [toDate, setToDate] = useState(toInputDate(presetRange.toDate));

  useEffect(() => {
    setFromDate(toInputDate(presetRange.fromDate));
    setToDate(toInputDate(presetRange.toDate));
  }, [range, presetRange.fromDate, presetRange.toDate]);

  const showActionMessage = useCallback((msg: string) => {
    setActionMessage(msg);
    window.setTimeout(() => setActionMessage(""), 3000);
  }, []);

  const loadStatusesForStores = useCallback(async (stores: ApiStoreRecord[]) => {
    const tekionIds = stores.map((item) => item.tekion_id).filter(Boolean);
    if (tekionIds.length === 0) {
      setStatusError("");
      return;
    }

    setLoadingStatuses(true);
    setStatusError("");

    try {
      const statusMap = await fetchStoreOnboardingStatuses(tekionIds, {
        chunkSize: 25,
        concurrency: 3,
      });

      const merged = withOnboardingStatuses(stores, statusMap);
      setRecords(merged);
      await saveStores(merged);
    } catch (err: unknown) {
      setStatusError(err instanceof Error ? err.message : "Failed to fetch onboarding statuses");
    } finally {
      setLoadingStatuses(false);
    }
  }, []);

  const handleFetch = useCallback(async (forceStatusRefresh = true) => {
    setLoadingStores(true);
    setError("");
    setActionMessage("");

    try {
      const stores = await fetchStores(range);
      setRecords(stores as StoreRecord[]);
      await saveStores(stores as StoreRecord[]);

      if (forceStatusRefresh) {
        void loadStatusesForStores(stores);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to fetch stores");
    } finally {
      setLoadingStores(false);
    }
  }, [range, loadStatusesForStores]);

  const handleRetryStatuses = useCallback(async () => {
    const baseStores: ApiStoreRecord[] = records.map((row) => ({
      tekion_id: row.tekion_id,
      dealer_id: row.dealer_id,
      dba_name: row.dba_name,
      launch_date: row.launch_date,
      implementation_type: row.implementation_type,
      pre_production_environment_status: row.pre_production_environment_status,
      superpod_id: row.superpod_id,
    }));

    await loadStatusesForStores(baseStores);
  }, [records, loadStatusesForStores]);

  const handleLoadIndexedDb = useCallback(async () => {
    try {
      const data = await getStores();
      setRecords(data);

      if (shouldAutoFetchStatuses(data)) {
        const baseStores: ApiStoreRecord[] = data.map((row) => ({
          tekion_id: row.tekion_id,
          dealer_id: row.dealer_id,
          dba_name: row.dba_name,
          launch_date: row.launch_date,
          implementation_type: row.implementation_type,
          pre_production_environment_status: row.pre_production_environment_status,
          superpod_id: row.superpod_id,
        }));

        if (baseStores.length > 0) {
          void loadStatusesForStores(baseStores);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load IndexedDB data");
    }
  }, [loadStatusesForStores]);

  useEffect(() => {
    void handleLoadIndexedDb();
  }, [handleLoadIndexedDb]);

  useEffect(() => {
    getStores()
      .then((data) => {
        if (data.length === 0) {
          void handleFetch(true);
        }
      })
      .catch(() => {
        void handleFetch(true);
      });
  }, [handleFetch]);

  const superpodOptions = useMemo(
    () => Array.from(new Set(records.map((r) => r.superpod_id).filter(Boolean))).sort(),
    [records]
  );

  const implementationTypeOptions = useMemo(
    () => Array.from(new Set(records.map((r) => r.implementation_type).filter(Boolean))).sort(),
    [records]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromUnix = startOfDayUnix(fromDate);
    const toUnix = endOfDayUnix(toDate);

    return records
      .filter((item) => {
        const matchesSearch =
          !q ||
          item.tekion_id.toLowerCase().includes(q) ||
          item.dealer_id.toLowerCase().includes(q) ||
          item.dba_name.toLowerCase().includes(q);

        const matchesSuperpod = !superpodId || item.superpod_id === superpodId;
        const matchesImplementationType =
          !implementationType || item.implementation_type === implementationType;

        const launch = parseLaunchDate(item.launch_date);
        const launchUnix = launch ? Math.floor(launch.getTime() / 1000) : null;
        const matchesDate =
          launchUnix == null ? true : launchUnix >= fromUnix && launchUnix <= toUnix;

        return matchesSearch && matchesSuperpod && matchesImplementationType && matchesDate;
      })
      .sort((a, b) => {
        const aDate = parseLaunchDate(a.launch_date);
        const bDate = parseLaunchDate(b.launch_date);

        const aTime = aDate ? aDate.getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = bDate ? bDate.getTime() : Number.MAX_SAFE_INTEGER;

        return aTime - bTime;
      });
  }, [records, search, superpodId, implementationType, fromDate, toDate]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stores-t${range}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportExcel = () => {
    try {
      exportStoresToExcel(filtered, `stores-t${range}`);
      showActionMessage(`✅ Excel exported (${filtered.length} rows)`);
    } catch (err: unknown) {
      showActionMessage(`❌ ${err instanceof Error ? err.message : "Excel export failed"}`);
    }
  };

  const handleSyncExcel = async () => {
    if (records.length === 0) {
      showActionMessage("❌ No loaded records available to sync");
      return;
    }

    setSyncingExcel(true);
    setActionMessage("");

    try {
      const result = await syncStoresToGraphWorkbook(records);
      showActionMessage(
        `✅ Synced ${result.rowCount} stores to ${result.sheetCount} month sheets and colored ${result.formattedCellCount} status cells in ${result.workbookPath}`
      );
    } catch (err: unknown) {
      showActionMessage(`❌ ${err instanceof Error ? err.message : "Graph sync failed"}`);
    } finally {
      setSyncingExcel(false);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setSuperpodId("");
    setImplementationType("");
    setFromDate(toInputDate(presetRange.fromDate));
    setToDate(toInputDate(presetRange.toDate));
  };

  return (
    <div className="stores-shell">
      <style>
        {`
          @keyframes storesSkeletonPulse {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}
      </style>

      <div className="stores-topbar">
        <div className="stores-topbar-left">
          <button className="btn-secondary btn-sm" onClick={onBack}>
            ← Back
          </button>
          <div>
            <div className="stores-page-title">🏬 Stores</div>
            <div className="stores-page-subtitle">
              Explore implementation dealer store data
            </div>
          </div>
        </div>

        <div className="stores-topbar-right">
          <button className="btn-secondary btn-sm" onClick={() => void handleLoadIndexedDb()}>
            Load IndexedDB
          </button>
          <button className="btn-secondary btn-sm" onClick={exportJson}>
            ⬇ Export JSON
          </button>
          <button className="btn-secondary btn-sm" onClick={handleExportExcel}>
            ⬇ Export Excel
          </button>
          <button
            className="btn-secondary btn-sm"
            onClick={() => void handleSyncExcel()}
            disabled={syncingExcel}
            title="Sync to T-90 Dealers GoLive - ARC.xlsx"
          >
            {syncingExcel ? "⏳ Syncing Excel..." : "☁ Sync Excel"}
          </button>
          <button className="btn-postman" onClick={() => void handleFetch(true)} disabled={loadingStores}>
            {loadingStores ? "⏳ Fetching..." : "🔄 Refresh"}
          </button>
        </div>
      </div>

      {actionMessage && (
        <div style={{ marginBottom: 12 }}>
          <div
            className={actionMessage.startsWith("✅") ? "glv-save-ok" : "bx-error"}
            style={{ display: "inline-block" }}
          >
            {actionMessage}
          </div>
        </div>
      )}

      <div
        className="stores-layout"
        style={{
          display: "grid",
          gridTemplateColumns: filtersCollapsed ? "1fr" : "320px minmax(0, 1fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        {!filtersCollapsed && (
          <aside className="stores-sidebar" style={{ minWidth: 0 }}>
            <div className="stores-panel">
              <div className="stores-panel-title">Filters</div>

              <div className="stores-field">
                <label className="stores-label">Search</label>
                <input
                  className="stores-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="tekion_id, dealer_id, dba_name"
                />
              </div>

              <div className="stores-field">
                <label className="stores-label">T Range Presets</label>
                <div className="stores-range-grid">
                  {[7, 30, 60, 90].map((days) => (
                    <button
                      key={days}
                      className={range === days ? "btn-postman" : "btn-secondary btn-sm"}
                      onClick={() => setRange(days as TRange)}
                    >
                      T-{days}
                    </button>
                  ))}
                </div>
              </div>

              <div className="stores-field">
                <label className="stores-label">Date Window</label>
                <div className="stores-calendar-box">
                  <div className="stores-date-grid">
                    <div>
                      <label className="stores-mini-label">From</label>
                      <input
                        type="date"
                        className="stores-input"
                        value={fromDate}
                        onChange={(e) => setFromDate(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="stores-mini-label">To</label>
                      <input
                        type="date"
                        className="stores-input"
                        value={toDate}
                        onChange={(e) => setToDate(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="stores-field">
                <label className="stores-label">Superpod ID</label>
                <select
                  className="stores-input"
                  value={superpodId}
                  onChange={(e) => setSuperpodId(e.target.value)}
                >
                  <option value="">All Superpods</option>
                  {superpodOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stores-field">
                <label className="stores-label">Implementation Type</label>
                <select
                  className="stores-input"
                  value={implementationType}
                  onChange={(e) => setImplementationType(e.target.value)}
                >
                  <option value="">All Types</option>
                  {implementationTypeOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stores-actions">
                <button className="btn-postman" onClick={() => void handleFetch(true)} disabled={loadingStores}>
                  {loadingStores ? "⏳ Fetching..." : "Refresh Data"}
                </button>
                <button className="btn-secondary btn-sm" onClick={clearFilters}>
                  Clear Filters
                </button>
              </div>

              <div className="stores-stats">
                <div className="stores-stat-card">
                  <span className="stores-stat-label">Total</span>
                  <span className="stores-stat-value">{records.length}</span>
                </div>
                <div className="stores-stat-card">
                  <span className="stores-stat-label">Filtered</span>
                  <span className="stores-stat-value">{filtered.length}</span>
                </div>
              </div>

              {error && <div className="bx-error">❌ {error}</div>}
            </div>
          </aside>
        )}

        <section className="stores-content" style={{ minWidth: 0 }}>
          <div className="stores-table-card">
            <div
              className="stores-table-header"
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div className="stores-panel-title">Store Records</div>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => setFiltersCollapsed((prev) => !prev)}
                    title={filtersCollapsed ? "Show filters" : "Hide filters"}
                  >
                    {filtersCollapsed ? "☰ Show Filters" : "✕ Hide Filters"}
                  </button>
                </div>

                <div className="stores-table-subtitle">
                  {filtered.length} shown · {records.length} total · Excel sync target: T-90 Dealers GoLive - ARC.xlsx
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {loadingStatuses && (
                  <span
                    style={{
                      fontSize: 12,
                      color: "#a1a1aa",
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.03)",
                    }}
                  >
                    ⏳ Loading Blueprint / Sign_Off statuses...
                  </span>
                )}

                {statusError && (
                  <>
                    <span
                      style={{
                        fontSize: 12,
                        color: "#f87171",
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: "1px solid rgba(239,68,68,0.24)",
                        background: "rgba(239,68,68,0.10)",
                      }}
                    >
                      ⚠ Status data unavailable
                    </span>
                    <button className="btn-secondary btn-sm" onClick={() => void handleRetryStatuses()}>
                      Retry Statuses
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="stores-table-wrap stores-table-wrap-tall">
              <StickyLegend />

              <table className="stores-table">
                <thead>
                  <tr>
                    <th>Tekion ID</th>
                    <th>Dealer ID</th>
                    <th>Dealership</th>
                    <th>Go Live</th>
                    <th>IMP Type</th>
                    <th>Pre-Prod</th>
                    <th>POD</th>
                    <th>Blueprint</th>
                    <th>Sign_Off</th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((row, i) => {
                    const tLabel = getTLabel(row.launch_date);
                    const blueprint = row.blueprint_statuses;
                    const signoff = row.signoff_statuses;
                    const pod2 = isPod2(row.superpod_id);

                    return (
                      <tr key={`${row.tekion_id}__${row.dealer_id}__${i}`}>
                        <td>
                          <button
                            type="button"
                            className="stores-copy-btn"
                            onClick={() => navigator.clipboard.writeText(row.tekion_id)}
                            title="Copy Tekion ID"
                          >
                            {row.tekion_id}
                          </button>
                        </td>

                        <td>
                          <button
                            type="button"
                            className="stores-copy-btn"
                            onClick={() => navigator.clipboard.writeText(row.dealer_id)}
                            title="Copy Dealer ID"
                          >
                            {row.dealer_id}
                          </button>
                        </td>

                        <td>
                          <button
                            type="button"
                            className="stores-copy-btn"
                            onClick={() => navigator.clipboard.writeText(row.dba_name)}
                            title="Copy Dealership"
                          >
                            {row.dba_name}
                          </button>
                        </td>

                        <td>
                          <button
                            type="button"
                            className="stores-copy-btn stores-copy-btn-left"
                            onClick={() => navigator.clipboard.writeText(formatLaunchDate(row.launch_date))}
                            title="Copy Go Live"
                          >
                            <div className="stores-date-cell">
                              <div className="stores-date-main">{formatLaunchDate(row.launch_date)}</div>
                              <div className={`stores-date-sub stores-date-${tLabel.tone}`}>
                                {tLabel.label}
                              </div>
                            </div>
                          </button>
                        </td>

                        <td>{row.implementation_type || "—"}</td>
                        <td>{row.pre_production_environment_status || "—"}</td>

                        <td>
                          <button
                            type="button"
                            className="stores-copy-btn"
                            onClick={() => navigator.clipboard.writeText(row.superpod_id || "")}
                            title="Copy POD"
                            style={{ padding: 0, background: "transparent", border: "none" }}
                          >
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                padding: "4px 10px",
                                borderRadius: 999,
                                fontSize: 12,
                                fontWeight: 700,
                                border: "1px solid",
                                background: pod2
                                  ? "rgba(59, 130, 246, 0.16)"
                                  : "rgba(148, 163, 184, 0.12)",
                                color: pod2 ? "#60a5fa" : "#cbd5e1",
                                borderColor: pod2
                                  ? "rgba(59, 130, 246, 0.30)"
                                  : "rgba(148, 163, 184, 0.22)",
                              }}
                            >
                              {row.superpod_id || "—"}
                            </span>
                          </button>
                        </td>

                        <td>
                          {loadingStatuses && !blueprint ? (
                            <StatusChipSkeleton count={5} />
                          ) : statusError && !blueprint ? (
                            <StatusUnavailable onRetry={() => void handleRetryStatuses()} />
                          ) : (
                            <StatusChipGroup
                              items={[
                                { short: "P", fullName: "Blueprint - Conquest - Parts", status: blueprint?.parts ?? "UNKNOWN" },
                                { short: "S", fullName: "Blueprint - Conquest - Service", status: blueprint?.service ?? "UNKNOWN" },
                                { short: "A", fullName: "Blueprint - Conquest - Accounting", status: blueprint?.accounting ?? "UNKNOWN" },
                                { short: "C", fullName: "Blueprint - Conquest - CRM", status: blueprint?.crm ?? "UNKNOWN" },
                                { short: "AN", fullName: "Blueprint - Analytics", status: blueprint?.analytics ?? "UNKNOWN" },
                              ]}
                            />
                          )}
                        </td>

                        <td>
                          {loadingStatuses && !signoff ? (
                            <StatusChipSkeleton count={3} />
                          ) : statusError && !signoff ? (
                            <StatusUnavailable onRetry={() => void handleRetryStatuses()} />
                          ) : (
                            <StatusChipGroup
                              items={[
                                { short: "P", fullName: "Parts Operational Sign-Off", status: signoff?.parts ?? "UNKNOWN" },
                                { short: "S", fullName: "Service Operational Sign-Off", status: signoff?.service ?? "UNKNOWN" },
                                { short: "A", fullName: "Accounting Operational Sign-Off", status: signoff?.accounting ?? "UNKNOWN" },
                              ]}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {!loadingStores && filtered.length === 0 && (
                <div className="stores-empty">
                  <div className="stores-empty-icon">🏬</div>
                  <div className="stores-empty-title">No records found</div>
                  <div className="stores-empty-sub">Try changing filters or refresh data</div>
                </div>
              )}
            </div>

            {error && (
              <div style={{ padding: "0 16px 16px" }}>
                <div className="bx-error">❌ {error}</div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
