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
import {
  loadSlackAlertsConfig,
  saveSlackAlertsConfig,
  sendAssigneeDigest,
  type SlackAlertsConfig,
} from "../services/slackAlertsService";
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
  const [alerts, setAlerts] = useState<SlackAlertsConfig>(() => loadSlackAlertsConfig());
  const [digestNote, setDigestNote] = useState("");

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
      const { updated, events } = runAutoAssign(current, config);
      if (!updated.length) {
        setNote("Nothing to assign: no eligible unassigned stores (or no assignees selected).");
        return;
      }
      const byId = new Map(updated.map((u) => [u.tekion_id, u]));
      await saveStores(current.map((s) => byId.get(s.tekion_id) ?? s));
      for (const u of updated) {
        try {
          await patchSingleStoreAssigneeInGraph(u.tekion_id, String((u as any).custom_assignee));
        } catch {
          /* Excel catches up on the next sync */
        }
      }
      setNote(`Assigned ${events.length} store(s). Reload the Stores page to see them.`);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="section-card" style={{ padding: 18, display: "grid", gap: 16 }}>
      <div>
        <h3 style={{ margin: "0 0 6px 0", fontSize: 18 }}>Assignees &amp; Auto-Assignment</h3>
        <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>
          Pick which assignees the bot may use. When a store&apos;s Parts <em>and</em> Service
          blueprints are both Completed and it has no assignee, the bot assigns it to the selected
          person with the fewest stores, so the split stays equal. Existing assignees are never
          overridden.
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
            <label key={name} style={{ display: "flex", gap: 6, alignItems: "center", color: "#e2e8f0" }}>
              <input
                type="checkbox"
                checked={config.selected.includes(name)}
                onChange={() => toggle(name)}
              />
              {name}
            </label>
          ))}
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center", color: "#e2e8f0" }}>
          <input
            type="checkbox"
            checked={config.autoAssignEnabled}
            onChange={(e) => update({ ...config, autoAssignEnabled: e.target.checked })}
          />
          Auto-assign automatically while the Stores page is open
        </label>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="btn-primary btn-sm"
            type="button"
            disabled={busy || config.selected.length === 0 || eligibleUnassigned === 0}
            onClick={() => void assignNow()}
          >
            {busy ? "Assigning..." : `Assign ${eligibleUnassigned} eligible store(s) now`}
          </button>
          {note && <span style={{ color: "#94a3b8", fontSize: 12 }}>{note}</span>}
        </div>
      </div>

      <div className="compact-card" style={{ display: "grid", gap: 8 }}>
        <strong style={{ color: "#f8fafc" }}>Slack alerts (sent to the same DM as the SLA report)</strong>
        {(
          [
            ["statusAlerts", "Alert when a store goes WIP → Completed"],
            ["t7Alerts", "Alert when a store enters the T-7 window"],
            ["dailyDigest", "Daily assignee digest (first open after 9:00)"],
          ] as const
        ).map(([key, text]) => (
          <label key={key} style={{ display: "flex", gap: 8, alignItems: "center", color: "#e2e8f0" }}>
            <input
              type="checkbox"
              checked={alerts[key]}
              onChange={(e) => {
                const next = { ...alerts, [key]: e.target.checked };
                setAlerts(next);
                saveSlackAlertsConfig(next);
              }}
            />
            {text}
          </label>
        ))}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            className="btn-secondary btn-sm"
            type="button"
            onClick={async () => {
              try {
                await sendAssigneeDigest(await getStores());
                setDigestNote("Digest sent.");
              } catch (e) {
                setDigestNote(`Failed: ${e instanceof Error ? e.message : "unknown error"}`);
              }
            }}
          >
            Send digest now
          </button>
          {digestNote && <span style={{ color: "#94a3b8", fontSize: 12 }}>{digestNote}</span>}
        </div>
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
