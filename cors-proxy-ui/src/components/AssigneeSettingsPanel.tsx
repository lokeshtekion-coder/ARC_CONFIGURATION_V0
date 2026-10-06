import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ASSIGNEE_OPTIONS,
  hydrateAssigneeStateFromBackend,
  loadAssigneeConfig,
  loadAssignmentLog,
  runAutoAssign,
  saveAssigneeConfig,
  summarizeAssignments,
  isEligibleForAutoAssign,
  type AssigneeConfig,
  type AssignmentEvent,
} from "../services/assigneeService";
import { getStores, saveStores, type StoreRecord } from "../services/storesDb";
import { patchSingleStoreAssigneeInGraph } from "../services/storesGraphSync";

const SOURCE_LABEL: Record<string, string> = {
  bot: "🤖 Bot",
  manual: "✋ Manual",
  excel: "📗 Excel edit",
};

export const AssigneeSettingsPanel: React.FC = () => {
  const [config, setConfig] = useState<AssigneeConfig>(() => loadAssigneeConfig());
  const [log, setLog] = useState<AssignmentEvent[]>(() => loadAssignmentLog());
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const refresh = useCallback(async () => {
    await hydrateAssigneeStateFromBackend();
    setConfig(loadAssigneeConfig());
    setLog(loadAssignmentLog());
    setStores(await getStores());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = (next: AssigneeConfig) => {
    setConfig(next);
    saveAssigneeConfig(next);
  };

  const toggle = (name: string) => {
    const has = config.selected.includes(name);
    update({
      ...config,
      selected: has ? config.selected.filter((n) => n !== name) : [...config.selected, name],
    });
  };

  const allSelected = config.selected.length === ASSIGNEE_OPTIONS.length;

  const eligibleUnassigned = useMemo(
    () =>
      stores.filter(
        (s) => isEligibleForAutoAssign(s) && !String((s as any).custom_assignee ?? "").trim()
      ).length,
    [stores]
  );

  const summary = useMemo(() => summarizeAssignments(stores, log), [stores, log]);
  const recent = useMemo(() => [...log].reverse().slice(0, 40), [log]);

  const assignNow = async () => {
    setBusy(true);
    setNote("");
    try {
      const current = await getStores();
      const { updated, events } = runAutoAssign(current, { ...config, autoAssignEnabled: true });

      if (!updated.length) {
        setNote("No unassigned stores met criteria (POD 1, 2, or 3 with completed Parts & Service and pending Fixed Ops).");
        return;
      }

      const byId = new Map(updated.map((u) => [u.tekion_id, u]));
      const nextStores = current.map((s) => byId.get(s.tekion_id) ?? s);
      await saveStores(nextStores);

      for (const u of updated) {
        try {
          await patchSingleStoreAssigneeInGraph(u.tekion_id, String((u as any).custom_assignee));
        } catch {}
      }

      setNote(`✅ Assigned ${events.length} store(s) and notified #operations channel!`);
      await refresh();
    } catch (err: unknown) {
      setNote(`❌ Error: ${err instanceof Error ? err.message : "Assignment failed"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="section-card" style={{ padding: 18, display: "grid", gap: 16 }}>
      <div>
        <h3 style={{ margin: "0 0 6px 0", fontSize: 18 }}>Assignees &amp; Auto-Assignment</h3>
        <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>
          Auto-assigns stores in <strong>POD 1, 2, and 3</strong> where Parts &amp; Service
          blueprints are <strong>Completed</strong> and Fixed Ops is pending. Immediately notifies channel{" "}
          <strong>#C0C5QBWEM8X</strong> for each assigned dealership.
        </p>
      </div>

      <div className="compact-card" style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ color: "#f8fafc" }}>Assignees ({config.selected.length} selected)</strong>
          <button
            className="btn-secondary btn-sm"
            type="button"
            onClick={() =>
              update({ ...config, selected: allSelected ? [] : [...ASSIGNEE_OPTIONS] })
            }
          >
            {allSelected ? "Clear all" : "Select all"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {ASSIGNEE_OPTIONS.map((name) => (
            <label key={name} style={{ display: "flex", gap: 6, alignItems: "center", color: "#e2e8f0", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={config.selected.includes(name)}
                onChange={() => toggle(name)}
                style={{ accentColor: "#38bdf8" }}
              />
              {name}
            </label>
          ))}
        </div>

        <label style={{ display: "flex", gap: 8, alignItems: "center", color: "#e2e8f0", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={config.autoAssignEnabled}
            onChange={(e) => update({ ...config, autoAssignEnabled: e.target.checked })}
            style={{ accentColor: "#38bdf8" }}
          />
          Auto-assign automatically while the Stores dashboard is open
        </label>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
          <button
            className="btn-postman btn-sm"
            type="button"
            disabled={busy || config.selected.length === 0 || eligibleUnassigned === 0}
            onClick={() => void assignNow()}
            style={{ fontWeight: 800 }}
          >
            {busy ? "Assigning..." : `⚡ Assign ${eligibleUnassigned} eligible store(s) now`}
          </button>
          {note && <span style={{ color: "#38bdf8", fontSize: 12, fontWeight: 600 }}>{note}</span>}
        </div>
      </div>

      {/* Target Operations Channel Notification Info */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          background: "rgba(56, 189, 248, 0.05)",
          border: "1px solid rgba(56, 189, 248, 0.2)",
          borderRadius: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>📢</span>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>
            Alerts Channel: <strong style={{ color: "#38bdf8" }}>#C0C5QBWEM8X</strong> (Dispatched per assigned store)
          </span>
        </div>
        <span style={{ fontSize: 11, color: "#64748b" }}>Live Individual Alerts</span>
      </div>

      <div className="compact-card" style={{ display: "grid", gap: 8 }}>
        <strong style={{ color: "#f8fafc" }}>Assignment tracking</strong>
        <table style={{ width: "100%", fontSize: 12, color: "#e2e8f0", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#94a3b8" }}>
              <th>Assignee</th>
              <th>Stores now</th>
              <th>Given by bot</th>
              <th>Received manually</th>
              <th>Moved away manually</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td>{r.current}</td>
                <td>{r.byBot}</td>
                <td>{r.receivedManually}</td>
                <td>{r.movedAwayManually}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="compact-card" style={{ display: "grid", gap: 8 }}>
        <strong style={{ color: "#f8fafc" }}>Recent changes</strong>
        {recent.length === 0 ? (
          <span style={{ color: "#94a3b8", fontSize: 12 }}>No assignment changes recorded yet.</span>
        ) : (
          <div style={{ maxHeight: 280, overflow: "auto", display: "grid", gap: 4 }}>
            {recent.map((e) => (
              <div key={e.id} style={{ fontSize: 12, color: "#e2e8f0" }}>
                <span style={{ color: "#94a3b8" }}>{new Date(e.at).toLocaleString()}</span>{" "}
                {SOURCE_LABEL[e.source] ?? e.source} · {e.dealerName} ({e.dealerId}):{" "}
                {e.previousAssignee || "Unassigned"} → <strong>{e.assignee || "Unassigned"}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AssigneeSettingsPanel;