import { useState } from "react";
import { getStores, saveStores } from "../services/storesDb";
import type { StoreRecord } from "../services/storesDb";
import { fetchIntegrationTasks } from "../services/tapTasksApi";
import { dispatchIntegrationReport } from "../services/slackAlertsService";
import { isUpcoming } from "../services/storeAssessment";

interface IntegrationReportProps {
  onBack: () => void;
}

/**
 * Integration report tool. Separate from Sync TAP (T-n): it fetches only the Integrations
 * implementation-stage tasks for upcoming stores, stores them on each store, and can send the
 * overdue integration report to Slack.
 */
export function IntegrationReport({ onBack }: IntegrationReportProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const upcomingStores = async (): Promise<StoreRecord[]> => {
    const all = await getStores();
    return all.filter((s) => isUpcoming(s));
  };

  const handleFetch = async () => {
    setBusy(true);
    setMessage("Fetching Integrations tasks...");
    try {
      const stores = await upcomingStores();
      const all = await getStores();
      const byId = new Map(all.map((s) => [s.tekion_id, s]));
      let done = 0;
      let failed = 0;

      for (const store of stores) {
        try {
          const tasks = await fetchIntegrationTasks(
            store.onboarding_project_id || "",
            { tenantId: store.tenant_id, dealerId: store.dealer_id, tenantCode: store.tenant_code },
            store.ds_onboarding_project_id
          );
          const current = byId.get(store.tekion_id) ?? store;
          byId.set(store.tekion_id, {
            ...current,
            integration_tasks: { fetchedAt: new Date().toISOString(), tasks },
          } as StoreRecord);
          done++;
        } catch (err) {
          failed++;
          const current = byId.get(store.tekion_id) ?? store;
          byId.set(store.tekion_id, {
            ...current,
            integration_tasks: {
              fetchedAt: new Date().toISOString(),
              tasks: (current as any).integration_tasks?.tasks ?? [],
              error: err instanceof Error ? err.message : "Integrations fetch failed",
            },
          } as StoreRecord);
        }
        setMessage(`Fetching Integrations tasks... ${done + failed}/${stores.length}`);
      }

      await saveStores(Array.from(byId.values()));
      setMessage(`Integrations fetched for ${done} store(s)${failed ? `, ${failed} failed (last known list kept)` : ""}.`);
    } catch (err) {
      setMessage(`Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const handleSend = async () => {
    setBusy(true);
    setMessage("Sending Integration report...");
    try {
      const stores = await upcomingStores();
      const res = await dispatchIntegrationReport(stores);
      setMessage(
        res.sent
          ? `Sent Integration report to Slack (${res.totalFlagged} overdue task(s)).`
          : `Not sent: ${res.reason ?? "no data"}`
      );
    } catch (err) {
      setMessage(`Send failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <button type="button" onClick={onBack} className="btn" style={{ marginBottom: 16 }}>
        ← Back
      </button>
      <h2 style={{ marginTop: 0 }}>🧩 Integration report</h2>
      <p style={{ color: "#555" }}>
        Checks the Integrations stage of TAP for upcoming stores. A task is flagged when its due date has
        passed and no comment was posted on or after that date.
      </p>
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <button type="button" className="btn" disabled={busy} onClick={handleFetch}>
          ⚡ Fetch Integrations tasks
        </button>
        <button type="button" className="btn primary" disabled={busy} onClick={handleSend}>
          📢 Send Integration report
        </button>
      </div>
      {message && <div style={{ fontSize: 14 }}>{message}</div>}
    </div>
  );
}

export default IntegrationReport;
