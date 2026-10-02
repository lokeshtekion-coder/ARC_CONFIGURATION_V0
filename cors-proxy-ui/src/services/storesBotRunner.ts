import { loadLatestExtensionCapture } from "./extensionBridge";
import { fetchStores } from "./tekionStoresApi";
import {
  getStores,
  saveStores,
  getStoredStatusVault,
  bulkUpdateStatusVault,
  type StoreRecord,
} from "./storesDb";
import { fetchStoreOnboardingStatuses } from "./storeOnboardingStatusApi";
import {
  pullStatusUpdatesFromGraph,
  patchSingleStoreAssigneeInGraph,
  syncProdDealersToGraph,
} from "./storesGraphSync";
import { fetchSetupDataForStore, isSetupDataComplete } from "./storeSetupDataService";
import {
  loadAssigneeConfig,
  reconcileAssignments,
  runAutoAssign,
} from "./assigneeService";
import { batchFetchRealTapStatuses } from "./tapTasksApi";
import {
  runSlackAlerts,
  maybeSendDailyDigest,
  shouldSendScheduledReports,
  dispatchAllThreeReports,
} from "./slackAlertsService";
import { getSlackSession } from "./storeSlackHelper";
import type { ExtendedStoreRecord } from "../pages/Stores";

export type BotPhase =
  | "idle"
  | "token_check"
  | "ingesting_stores"
  | "enriching_statuses"
  | "scanning_tap"
  | "enriching_setup"
  | "reconciling_assignees"
  | "syncing_excel"
  | "evaluating_sla";

export interface BotState {
  enabled: boolean;
  phase: BotPhase;
  statusText: string;
  lastRunTimestamp: string | null;
  error: string | null;
}

const BOT_CONFIG_KEY = "arc-stores-bot-config";
const TAP_SCAN_CACHE_KEY = "arc_tap_scan_cache_v1";
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // Run every 1 hour while app is open
const SETUP_FETCH_DELAY_MS = 600;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function loadTapScanCache(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TAP_SCAN_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveTapScanCache(cache: Record<string, string>): void {
  try {
    localStorage.setItem(TAP_SCAN_CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

function mergeIncomingStore(
  existing: ExtendedStoreRecord | undefined,
  incoming: StoreRecord
): ExtendedStoreRecord {
  if (!existing) return incoming as ExtendedStoreRecord;
  const merged: Record<string, any> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    const blank =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    if (!blank) merged[key] = value;
  }
  return merged as ExtendedStoreRecord;
}

function checkTokensValid(): { valid: boolean; reason?: string } {
  const capture = loadLatestExtensionCapture() ?? {};

  // 1. Check Graph token
  if (!capture.graphApiToken) {
    return { valid: false, reason: "Missing Graph API Token" };
  }
  if (typeof capture.graphExpiresAt === "number" && capture.graphExpiresAt <= Date.now()) {
    return { valid: false, reason: "Graph API Token Expired" };
  }

  // 2. Check Slack session
  const slack = getSlackSession();
  if (!slack.slackToken || !slack.slackDCookie) {
    return { valid: false, reason: "Missing Slack session" };
  }

  // 3. Check TOC API / tapDuo token
  const hasTocApi = Object.values(capture.customCaptures ?? {}).some((c) => {
    const pat = (c.pattern || "").toLowerCase();
    const url = (c.matchedUrl || "").toLowerCase();
    return pat.includes("getuserprofile") || url.includes("getuserprofile");
  });

  if (!hasTocApi && !capture.tapDuoApiToken) {
    return { valid: false, reason: "Missing TOC API / TAP token" };
  }

  return { valid: true };
}

class StoresBotRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private isExecuting = false;
  private listeners: Set<(state: BotState) => void> = new Set();

  private state: BotState = {
    enabled: localStorage.getItem(BOT_CONFIG_KEY) === "true",
    phase: "idle",
    statusText: "Bot Idle",
    lastRunTimestamp: null,
    error: null,
  };

  constructor() {
    if (this.state.enabled) {
      this.start();
    }
  }

  public getState(): BotState {
    return { ...this.state };
  }

  public subscribe(listener: (state: BotState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const current = this.getState();
    this.listeners.forEach((l) => l(current));
  }

  private updateStatus(phase: BotPhase, statusText: string, error: string | null = null) {
    this.state.phase = phase;
    this.state.statusText = statusText;
    this.state.error = error;
    this.notify();
  }

  public setEnabled(enabled: boolean) {
    this.state.enabled = enabled;
    localStorage.setItem(BOT_CONFIG_KEY, String(enabled));
    if (enabled) {
      this.start();
      void this.executeCycle(true);
    } else {
      this.stop();
    }
    this.notify();
  }

  public start() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.executeCycle(false);
    }, DEFAULT_INTERVAL_MS);
    this.updateStatus("idle", "Bot active (waiting for next run)");
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.updateStatus("idle", "Bot paused");
  }

  /**
   * Main Autonomous Execution Pipeline
   */
  public async executeCycle(force = false): Promise<void> {
    if (this.isExecuting) return;
    if (!this.state.enabled && !force) return;

    this.isExecuting = true;
    try {
      // 0. Verify Tokens
      this.updateStatus("token_check", "Verifying token freshness...");
      const tokenCheck = checkTokensValid();
      if (!tokenCheck.valid) {
        this.updateStatus("idle", `Paused: ${tokenCheck.reason}`);
        return;
      }

      // 1. Ingest T-90 stores
      this.updateStatus("ingesting_stores", "Auto-refreshing store records...");
      const rawStores = await fetchStores(90);
      const existingDb = await getStores();
      const existingMap = new Map(existingDb.map((s) => [s.tekion_id, s]));
      const vault = getStoredStatusVault();

      const mergedStores: ExtendedStoreRecord[] = Array.from(
        new Map<string, ExtendedStoreRecord>(
          rawStores.map((store) => {
            const existing = existingMap.get(store.tekion_id) as ExtendedStoreRecord | undefined;
            const override = vault[store.tekion_id];
            const base = mergeIncomingStore(existing, store);
            return [
              store.tekion_id,
              {
                ...base,
                onboarding_project_id: store.onboarding_project_id || existing?.onboarding_project_id,
                ds_onboarding_project_id: store.ds_onboarding_project_id || existing?.ds_onboarding_project_id,
                fixed_ops_status:
                  override?.fixed_ops_status ||
                  existing?.fixed_ops_status ||
                  "TO DO",
                variable_ops_status:
                  override?.variable_ops_status ||
                  existing?.variable_ops_status ||
                  "TO DO",
                testing_status:
                  override?.testing_status ||
                  existing?.testing_status ||
                  "TO DO",
                not_worked:
                  override?.not_worked ||
                  existing?.not_worked ||
                  store.not_worked,
                custom_assignee:
                  override?.custom_assignee ||
                  existing?.custom_assignee ||
                  (store as any).custom_assignee,
                custom_variable_assignee:
                  override?.custom_variable_assignee ||
                  existing?.custom_variable_assignee ||
                  (store as any).custom_variable_assignee,
                fetched_blueprint_tasks: existing?.fetched_blueprint_tasks,
                attachments_incomplete: existing?.attachments_incomplete,
                fixed_ops_attachments: existing?.fixed_ops_attachments,
                variable_ops_attachments: existing?.variable_ops_attachments,
                tap_tasks_scanned_at: (existing as any)?.tap_tasks_scanned_at,
              },
            ];
          })
        ).values()
      );

      const fetchedIds = new Set(mergedStores.map((s) => s.tekion_id));
      let currentRecords: ExtendedStoreRecord[] = [
        ...mergedStores,
        ...(existingDb as ExtendedStoreRecord[]).filter((s) => !fetchedIds.has(s.tekion_id)),
      ];
      await saveStores(currentRecords);

      // 2. Blueprint / Sign-Off Onboarding Statuses
      this.updateStatus("enriching_statuses", "Checking blueprint statuses...");
      const needsStatusCheck = currentRecords.filter((r) => !isSameLocalDay(r.onboarding_status_fetched_at));
      if (needsStatusCheck.length > 0) {
        const ids = needsStatusCheck.map((s) => s.tekion_id);
        const statusMap = await fetchStoreOnboardingStatuses(ids, { chunkSize: 25, concurrency: 3 });
        const nowIso = new Date().toISOString();
        currentRecords = currentRecords.map((r) => {
          const s = statusMap[r.tekion_id];
          return s
            ? {
                ...r,
                blueprint_statuses: s.blueprint_statuses,
                signoff_statuses: s.signoff_statuses,
                onboarding_status_fetched_at: nowIso,
              }
            : r;
        });
        await saveStores(currentRecords);
      }

      // 3. Scan Real TAP Tasks with Granular Task-Level Diffing
      const scanCache = loadTapScanCache();

      const storesNeedingTapScan = currentRecords.filter((r) => {
        // Skip stores that are already 100% Completed
        if (r.fixed_ops_status === "Completed" && r.variable_ops_status === "Completed") {
          return false;
        }

        // Must have an active TAP project ID
        if (!r.onboarding_project_id && !r.ds_onboarding_project_id) {
          return false;
        }

        // Skip if scanned today and has complete attachments
        const lastScanned =
          scanCache[r.tekion_id] ||
          (r as any).tap_tasks_scanned_at ||
          r.fetched_blueprint_tasks?.fetchedAt;

        if (lastScanned && isSameLocalDay(lastScanned) && !r.attachments_incomplete) {
          return false;
        }

        return true;
      });

      if (storesNeedingTapScan.length > 0) {
        this.updateStatus(
          "scanning_tap",
          `Scanning TAP tasks: 0/${storesNeedingTapScan.length} pending stores...`
        );

        try {
          const { updatedStores, updatedCount } = await batchFetchRealTapStatuses(
            storesNeedingTapScan,
            (processed, total, updated, skippedTasks) => {
              if (this.state.enabled) {
                this.updateStatus(
                  "scanning_tap",
                  `Scanning TAP tasks: Store ${processed}/${total} (Updated: ${updated}, Cached Tasks: ${skippedTasks})`
                );
              }
            }
          );

          const nowIso = new Date().toISOString();
          for (const s of storesNeedingTapScan) {
            scanCache[s.tekion_id] = nowIso;
            (s as any).tap_tasks_scanned_at = nowIso;
          }
          saveTapScanCache(scanCache);

          if (updatedCount > 0) {
            const updatedMap = new Map(updatedStores.map((u) => [u.tekion_id, u as ExtendedStoreRecord]));
            currentRecords = currentRecords.map((r) => {
              const u = updatedMap.get(r.tekion_id);
              return u ? { ...u, tap_tasks_scanned_at: nowIso } : r;
            });
          }

          await saveStores(currentRecords);
        } catch (err) {
          console.warn("[StoresBot] TAP tasks background scan skipped:", err);
        }
      } else {
        this.updateStatus("scanning_tap", "TAP tasks up to date (0 pending stores)");
      }

      // 4. Auto-Enrich Missing Setup Data
      this.updateStatus("enriching_setup", "Scanning for missing setup data...");
      const missingSetup = currentRecords.filter((r) => !isSetupDataComplete(r));
      let setupFetched = 0;
      let hasSetupUpdates = false;

      for (const record of missingSetup) {
        if (!this.state.enabled) break;
        this.updateStatus(
          "enriching_setup",
          `Fetching setup data: ${record.dealer_id} (${setupFetched + 1}/${missingSetup.length})`
        );
        try {
          const setup = await fetchSetupDataForStore(record, { force: true });
          record.setup_data = setup;
          record.setup_data_fetched_at = setup.fetchedAt;
          record.setup_data_error = "";
          setupFetched++;
          hasSetupUpdates = true;
          await delay(SETUP_FETCH_DELAY_MS);
        } catch (err) {
          record.setup_data_error = err instanceof Error ? err.message : "Setup error";
        }
      }

      if (hasSetupUpdates) {
        await saveStores(currentRecords);
      }

      // 5. Auto-Reconcile & Run Auto-Assign Bot
      this.updateStatus("reconciling_assignees", "Running auto-assign bot rules...");
      reconcileAssignments(currentRecords);
      const assignConfig = loadAssigneeConfig();
      if (assignConfig.autoAssignEnabled) {
        const { updated } = runAutoAssign(currentRecords, assignConfig);
        if (updated.length > 0) {
          const updatedMap = new Map(updated.map((u) => [u.tekion_id, u as ExtendedStoreRecord]));
          currentRecords = currentRecords.map((r) => {
            const u = updatedMap.get(r.tekion_id);
            return u && !r.custom_assignee ? { ...r, custom_assignee: u.custom_assignee } : r;
          });
          await saveStores(currentRecords);
          for (const u of updated) {
            try {
              await patchSingleStoreAssigneeInGraph(u.tekion_id, String((u as ExtendedStoreRecord).custom_assignee));
            } catch {
              /* Excel catches up on sync */
            }
          }
        }
      }

      // 6. Excel 2-Way Synchronization
      this.updateStatus("syncing_excel", "Synchronizing with Excel workbook...");
      try {
        const { updatedStores, hasChanges } = await pullStatusUpdatesFromGraph(currentRecords);
        if (hasChanges) {
          const updatedMap = new Map(updatedStores.map((s) => [s.tekion_id, s]));
          currentRecords = currentRecords.map((r) => {
            const u = updatedMap.get(r.tekion_id);
            return u
              ? {
                  ...r,
                  fixed_ops_status: u.fixed_ops_status,
                  variable_ops_status: u.variable_ops_status,
                  testing_status: u.testing_status,
                  not_worked: u.not_worked ?? r.not_worked,
                  custom_assignee: u.custom_assignee ?? r.custom_assignee,
                  custom_variable_assignee: (u as any).custom_variable_assignee ?? r.custom_variable_assignee,
                }
              : r;
          });
          await saveStores(currentRecords);
          bulkUpdateStatusVault(
            currentRecords.map((s) => ({
              tekionId: s.tekion_id,
              fixed_ops_status: s.fixed_ops_status,
              variable_ops_status: s.variable_ops_status,
              testing_status: s.testing_status,
              not_worked: s.not_worked,
              custom_assignee: s.custom_assignee,
              custom_variable_assignee: s.custom_variable_assignee,
            }))
          );
        }
        await syncProdDealersToGraph(currentRecords);
      } catch (err) {
        console.warn("[StoresBot] Background Excel sync skipped:", err);
      }

      // 7. SLA Evaluation, Slack Dispatches & 4-Hour Scheduled Reports
      this.updateStatus("evaluating_sla", "Checking 4-hr report cadence & dispatching alerts...");
      await runSlackAlerts(currentRecords);
      await maybeSendDailyDigest(currentRecords);

      if (shouldSendScheduledReports()) {
        try {
          this.updateStatus("evaluating_sla", "Sending scheduled 4-hr reports (Analytics, Fixed, Variable)...");
          await dispatchAllThreeReports(currentRecords);
        } catch (reportErr) {
          console.error("[StoresBot] 4-hour scheduled reports auto-dispatch failed:", reportErr);
        }
      }

      // Signal completion
      this.state.lastRunTimestamp = new Date().toISOString();
      this.updateStatus("idle", `All stores up to date (${currentRecords.length} records)`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Bot cycle encountered an error";
      console.error("[StoresBotRunner] Cycle failed:", err);
      this.updateStatus("idle", "Encountered issue during execution", msg);
    } finally {
      this.isExecuting = false;
    }
  }
}

export const storesBotRunner = new StoresBotRunner();