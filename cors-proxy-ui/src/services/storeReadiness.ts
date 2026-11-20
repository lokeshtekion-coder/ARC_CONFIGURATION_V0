// Variable Ops readiness: decides whether a store can be configured for Accounting.
//
// Gate order (each step must pass before the next is checked):
//   1. Fixed Ops configured  -> Parts blueprint AND Service blueprint are COMPLETED
//   2. Accounting blueprint  -> Accounting blueprint is COMPLETED
//   3. COA data              -> setup_data.coaAccessibleDealerCount > 50
//   4. ACCTS data            -> MAP acct_dms_account_number count > 50
//
// When a data count is missing or 0 the data is fetched in the background, at most once
// every 4 hours per store, so newly loaded data is picked up without hammering the APIs.

import type { StoreRecord } from "./storesDb";
import { fetchSetupDataForStore } from "./storeSetupDataService";
import { executePreprodMapPipeline } from "./preprodMapApiService";
import {
  READY_MIN_COUNT,
  acctsCount,
  coaCount,
  fixedOpsPrerequisiteDone,
  isVariableScope,
  readinessStage as readinessOf,
} from "./storeAssessment";
import { getSlackSession, sendSlackChannelMessage } from "./storeSlackHelper";

const STORES_CHANNEL_ID = "C0C5QBWEM8X";

export const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function dueForRecheck(checkedAt: string | undefined, now: number): boolean {
  if (!checkedAt) return true;
  const t = Date.parse(checkedAt);
  return Number.isNaN(t) || now - t >= RECHECK_INTERVAL_MS;
}

export interface ReadinessRefreshResult {
  stores: StoreRecord[];
  newlyReady: StoreRecord[];
}

/**
 * Fetches missing COA (setup data) and ACCTS (MAP) counts for Variable Ops stores,
 * then recalculates each store's readiness stage. Runs sequentially to keep load low.
 * `onLog` receives short human-readable lines for the bot dashboard.
 */
export async function refreshVariableReadiness(
  stores: StoreRecord[],
  options: { delayMs?: number; onLog?: (line: string) => void; now?: Date } = {}
): Promise<ReadinessRefreshResult> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const log = options.onLog ?? (() => undefined);
  const delayMs = options.delayMs ?? 1500;
  const newlyReady: StoreRecord[] = [];
  const out = stores.map((s) => ({ ...s }));

  for (const store of out) {
    // Scope: today to 90 days, Fixed Ops prerequisite done. Stores with ACCTS above 50 are never refetched.
    if (!isVariableScope(store, now, 90)) continue;
    if (!fixedOpsPrerequisiteDone(store)) continue;
    if (acctsCount(store) > READY_MIN_COUNT) continue;
    const tag = `#${store.dealer_id} ${store.dba_name || ""}`.trim();

    if (coaCount(store) <= READY_MIN_COUNT && dueForRecheck(store.coa_checked_at, nowMs)) {
      log(`Setup data: fetching COA count for ${tag}`);
      try {
        const setup = await fetchSetupDataForStore(store, { force: true });
        store.setup_data = setup;
        store.setup_data_fetched_at = setup.fetchedAt;
        store.setup_data_error = "";
        log(`Setup data: ${tag} COA count ${coaCount(store)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "failed";
        store.setup_data_error = msg;
        log(`Setup data: ${tag} failed (${msg.slice(0, 60)})`);
      }
      store.coa_checked_at = nowIso;
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }

    const tenant = store.tenant_code || (store as any).tenant_name || "";
    if (acctsCount(store) <= READY_MIN_COUNT && dueForRecheck(store.acct_checked_at, nowMs) && tenant) {
      log(`MAP: fetching ACCTS count for ${tag}`);
      try {
        const pre = await executePreprodMapPipeline(tenant, store.dealer_id);
        store.preprod_validation = pre;
        log(
          pre.accountNumberCount !== undefined
            ? `MAP: ${tag} ACCTS count ${pre.accountNumberCount}`
            : `MAP: ${tag} no ACCTS count (${pre.validationError ?? "tenant not found"})`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "failed";
        log(`MAP: ${tag} failed (${msg.slice(0, 60)})`);
      }
      store.acct_checked_at = nowIso;
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }

    const { stage } = readinessOf(store);
    store.readiness_stage = stage;
    if (stage === "READY" && !store.variable_ready_at) {
      store.variable_ready_at = nowIso;
      newlyReady.push(store);
      log(`Ready: ${tag} can be configured for Accounting`);
    }
  }

  return { stores: out, newlyReady };
}

/**
 * Slack notice for stores that became ready to configure Accounting during this run.
 * Lists the four checks each store passed, so the reader knows why it is ready.
 */
export async function notifyReadyToConfigure(stores: StoreRecord[]): Promise<void> {
  if (!stores.length) return;
  if (!getSlackSession().slackToken) return;
  const stamp = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  const lines: string[] = [
    `✅ *${stores.length} store${stores.length === 1 ? "" : "s"} ready to configure Accounting* · ${stamp}`,
    `_Why you're getting this: each store has Fixed Ops (Parts and Service) and Accounting blueprints complete, and both COA and ACCTS data above ${READY_MIN_COUNT}._`,
    "",
  ];
  stores.forEach((s, i) => {
    lines.push(
      `${i + 1}. *${s.dba_name || "Dealership"}* · #${s.dealer_id || "—"} · Go-live ${s.launch_date || "—"}`,
      `      Fixed Ops ✓  ·  Accounting blueprint ✓  ·  COA *${coaCount(s)}*  ·  ACCTS *${acctsCount(s)}*`
    );
  });
  try {
    await sendSlackChannelMessage({ channelId: STORES_CHANNEL_ID, text: lines.join("\n") });
  } catch (err) {
    console.error("[storeReadiness] Failed to send ready notice:", err);
  }
}
