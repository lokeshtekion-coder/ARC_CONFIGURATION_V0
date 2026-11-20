// Background Integration report run.
//
// Design (why it behaves this way):
// - The saved store records are the source of truth. A dealer counts as "fetched" for today when
//   its integration_tasks.fetchedAt is today and it has no error. A resumed run only processes the
//   dealers that are not fetched yet, so it continues where it stopped instead of starting over.
// - Each dealer is saved to the store database as soon as it finishes, so a reload loses at most
//   the dealer that was in progress.
// - The Slack report is a separate step with its own flag (reportSent). If the run was cut off
//   before the report, the next run or "Send report now" sends it. Nothing is lost.

import { getStores, saveStores } from "./storesDb";
import type { StoreRecord } from "./storesDb";
import { describeTapCaptureState, fetchIntegrationTasks, TapTaskApiError } from "./tapTasksApi";
import { dispatchIntegrationReport } from "./slackAlertsService";
import { isUpcoming } from "./storeAssessment";

const LOG_KEY = "arc_integration_run_log";

export type DealerRunStatus = "pending" | "running" | "ok" | "failed" | "skipped";

export interface DealerRunEntry {
  tekionId: string;
  dealerId: string;
  name: string;
  status: DealerRunStatus;
  tasks: number | null;
  error: string;
  lines: string[];
}

export interface IntegrationRunState {
  status: "idle" | "running" | "done" | "stopped" | "interrupted";
  dateKey: string;
  total: number;
  processed: number;
  failed: number;
  lines: string[];
  dealers: DealerRunEntry[];
  reportSent: boolean;
  reportNote: string;
  startedAt: string | null;
  finishedAt: string | null;
}

type Listener = (state: IntegrationRunState) => void;

const todayKey = () => new Date().toLocaleDateString("en-CA");
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA");
const stamp = () => new Date().toLocaleTimeString();

function emptyState(): IntegrationRunState {
  return {
    status: "idle",
    dateKey: todayKey(),
    total: 0,
    processed: 0,
    failed: 0,
    lines: [],
    dealers: [],
    reportSent: false,
    reportNote: "",
    startedAt: null,
    finishedAt: null,
  };
}

function loadSavedLog(): IntegrationRunState {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as IntegrationRunState;
      if (saved?.dateKey === todayKey()) {
        // A run cut off by a reload or restart is shown as interrupted, never as still running.
        if (saved.status === "running") saved.status = "interrupted";
        return { ...emptyState(), ...saved };
      }
    }
  } catch {
    /* corrupt log: start clean */
  }
  return emptyState();
}

let state: IntegrationRunState = loadSavedLog();
const listeners = new Set<Listener>();

function snapshot(): IntegrationRunState {
  return {
    ...state,
    lines: [...state.lines],
    dealers: state.dealers.map((d) => ({ ...d, lines: [...d.lines] })),
  };
}

function emit() {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: in-memory log still works */
  }
  const snap = snapshot();
  listeners.forEach((l) => l(snap));
}

function runLog(line: string) {
  state.lines.push(`[${stamp()}] ${line}`);
  emit();
}

function dealerLog(entry: DealerRunEntry, line: string) {
  entry.lines.push(`[${stamp()}] ${line}`);
  emit();
}

function isFetchedToday(store: StoreRecord): boolean {
  const it = (store as any).integration_tasks as { fetchedAt?: string; error?: string } | undefined;
  return Boolean(it?.fetchedAt && !it.error && dayOf(it.fetchedAt) === todayKey());
}

function pendingCount() {
  return state.dealers.filter((d) => d.status === "pending" || d.status === "running").length;
}

export function subscribeIntegrationRun(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function getIntegrationRunState(): IntegrationRunState {
  return snapshot();
}

export function isIntegrationRunning(): boolean {
  return state.status === "running";
}

/** True when today's run finished and its report was sent (a second run should be confirmed). */
export function integrationRunDoneToday(): boolean {
  return state.dateKey === todayKey() && state.status === "done" && state.reportSent;
}

/** Clears today's log. Not allowed while a run is in progress. Saved store data is not touched. */
export function clearIntegrationLog(): boolean {
  if (state.status === "running") return false;
  state = emptyState();
  emit();
  return true;
}

/** Sends the report from the saved store data. Does not fetch anything. */
export async function sendIntegrationReportNow(): Promise<void> {
  if (state.status === "running") return;
  const all = await getStores();
  const fetchedToday = all.filter((s) => isUpcoming(s) && isFetchedToday(s));
  runLog(`Sending Integration report from saved data: ${fetchedToday.length} dealer(s).`);
  await sendReport(fetchedToday, fetchedToday.length, all.filter((s) => isUpcoming(s)).length);
}

async function sendReport(fetchedToday: StoreRecord[], fetchedCount: number, upcomingCount: number) {
  const notFetched = upcomingCount - fetchedCount;
  state.reportNote = `${fetchedCount} dealer(s) included${notFetched > 0 ? `, ${notFetched} not fetched today` : ""}`;
  try {
    const res = await dispatchIntegrationReport(fetchedToday);
    if (res.sent) {
      state.reportSent = true;
      runLog(`✅ Report sent (${res.totalFlagged} overdue task(s)). ${state.reportNote}.`);
    } else {
      // Nothing overdue is a valid outcome, so the report counts as handled.
      state.reportSent = res.reason?.startsWith("No overdue") ?? false;
      runLog(`Report not sent: ${res.reason ?? "no data"}`);
    }
  } catch (err) {
    state.reportSent = false;
    runLog(`✖ Slack send failed, use "Send report now" to retry: ${err instanceof Error ? err.message : String(err)}`);
  }
  emit();
}

export async function startIntegrationRun(): Promise<void> {
  if (state.status === "running") return;

  const sameDay = state.dateKey === todayKey();
  const previousDealers = sameDay ? new Map(state.dealers.map((d) => [d.tekionId, d])) : new Map<string, DealerRunEntry>();
  const previousLines = sameDay ? state.lines : [];
  const alreadySent = sameDay && state.reportSent;

  state = {
    ...emptyState(),
    status: "running",
    lines: [...previousLines],
    startedAt: new Date().toISOString(),
  };
  runLog(sameDay && previousDealers.size > 0 ? "▶ Resuming today's run." : "▶ Integration run started.");

  const byId = new Map((await getStores()).map((s) => [s.tekion_id, s]));
  const upcoming = Array.from(byId.values()).filter((s) => isUpcoming(s));
  const queue = upcoming.filter((s) => !isFetchedToday(s));

  state.total = upcoming.length;
  state.processed = upcoming.length - queue.length;
  state.dealers = upcoming.map((s) => {
    const prev = previousDealers.get(s.tekion_id);
    const fetched = isFetchedToday(s);
    return {
      tekionId: s.tekion_id,
      dealerId: String(s.dealer_id ?? ""),
      name: s.dba_name || "",
      status: (fetched ? "ok" : "pending") as DealerRunStatus,
      tasks: fetched ? ((s as any).integration_tasks?.tasks?.length ?? 0) : null,
      error: "",
      // Keep the earlier steps for this dealer so the card shows the whole history for today.
      lines: prev ? [...prev.lines] : [],
    };
  });
  state.reportSent = alreadySent;
  runLog(
    `${upcoming.length - queue.length} already fetched today (kept), ${queue.length} pending in queue.`
  );
  emit();

  let stopReason = "";
  for (const store of queue) {
    const entry = state.dealers.find((d) => d.tekionId === store.tekion_id);
    if (!entry) continue;
    entry.status = "running";
    entry.error = "";
    dealerLog(entry, `▶ Start · dealer #${entry.dealerId} ${entry.name}`.trim());
    dealerLog(entry, `   Tekion ID ${store.tekion_id} · onboarding project ${store.onboarding_project_id || "—"} · alternate ${store.ds_onboarding_project_id || "—"}`);

    try {
      const tasks = await fetchIntegrationTasks(
        store.onboarding_project_id || "",
        { tenantId: store.tenant_id, dealerId: store.dealer_id, tenantCode: store.tenant_code },
        store.ds_onboarding_project_id,
        (msg) => dealerLog(entry, `   ${msg}`)
      );
      byId.set(store.tekion_id, {
        ...store,
        integration_tasks: { fetchedAt: new Date().toISOString(), tasks },
      } as StoreRecord);
      entry.status = "ok";
      entry.tasks = tasks.length;
      dealerLog(entry, `✔ Done · ${tasks.length} integration task(s) saved`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Integrations fetch failed";
      entry.status = "failed";
      entry.error = message;
      state.failed++;
      dealerLog(entry, `✖ Failed: ${message}`);
      if (err instanceof TapTaskApiError && err.upstreamStatus !== undefined) {
        dealerLog(entry, `   HTTP status from TAP: ${err.upstreamStatus}`);
      }
      if (err instanceof TapTaskApiError && err.rawResponse !== undefined) {
        dealerLog(entry, `   TAP response: ${JSON.stringify(err.rawResponse).slice(0, 300)}`);
      }
      const prevTasks = (store as any).integration_tasks?.tasks ?? [];
      byId.set(store.tekion_id, {
        ...store,
        integration_tasks: {
          fetchedAt: (store as any).integration_tasks?.fetchedAt ?? "",
          tasks: prevTasks,
          error: message,
        },
      } as StoreRecord);

      // A missing or expired capture fails every dealer the same way, so stop the queue here.
      if (/Capture|expired|authorization|Missing project/i.test(message)) {
        stopReason = message;
        dealerLog(entry, `   Diagnostic: ${describeTapCaptureState()}`);
        break;
      }
    }

    state.processed++;
    // Save after every dealer so a reload never loses finished work.
    await saveStores(Array.from(byId.values()));
    runLog(`Progress ${state.processed}/${state.total} · pending in queue: ${pendingCount()}`);
  }

  if (stopReason) {
    for (const d of state.dealers) if (d.status === "pending") d.status = "skipped";
    runLog(`■ Run stopped: ${stopReason}`);
    runLog(`   Remaining dealers left pending (resume after fixing the capture). Diagnostic: ${describeTapCaptureState()}`);
    state.status = "stopped";
  }

  const all = Array.from(byId.values());
  const upcomingNow = all.filter((s) => isUpcoming(s));
  const fetchedToday = upcomingNow.filter((s) => isFetchedToday(s));
  if (!state.reportSent) {
    runLog("Sending Integration report.");
    await sendReport(fetchedToday, fetchedToday.length, upcomingNow.length);
  } else {
    runLog("Report for today was already sent; nothing to resend.");
  }

  if (state.status === "running") state.status = "done";
  state.finishedAt = new Date().toISOString();
  runLog(
    `Run finished · fetched ${fetchedToday.length}/${upcomingNow.length} · failed ${state.failed} · still pending ${pendingCount()}`
  );
}
