import { loadLatestExtensionCapture } from "./extensionBridge";
import { fetchStores } from "./tekionStoresApi";
import {
  getStores,
  saveStores,
  getStoredStatusVault,
  type StoreRecord,
} from "./storesDb";
import { fetchStoreOnboardingStatuses } from "./storeOnboardingStatusApi";
import {
  pullStatusUpdatesFromGraph,
  syncProdDealersToGraph,
} from "./storesGraphSync";
import { acctsReady, daysToGoLive, fixedOpsPrerequisiteDone } from "./storeAssessment";
import { fetchSetupWithMapFallback } from "./storeSetupWithFallback";
import { persistStatusVault, runAssigneeAutomation, patchAssigneesInGraph } from "./storesSyncCore";
import { refreshVariableReadiness, notifyReadyToConfigure, RECHECK_INTERVAL_MS } from "./storeReadiness";
import { batchFetchRealTapStatuses } from "./tapTasksApi";
import {
  runSlackAlerts,
  maybeSendDailyDigest,
  shouldSendScheduledReports,
  dispatchAllThreeReports,
} from "./slackAlertsService";
import { getSlackSession, sendSlackChannelMessage } from "./storeSlackHelper";
import { dedupeStoreList } from "./storeDedupe";

// Same channel as the other Stores notices (readiness, new assignments, reports).
const STORES_ALERT_CHANNEL_ID = "C0C5QBWEM8X";
import type { ExtendedStoreRecord } from "../pages/Stores";

export type BotPhase =
  | "idle"
  | "enriching_readiness"
  | "token_check"
  | "ingesting_stores"
  | "enriching_statuses"
  | "scanning_tap"
  | "enriching_setup"
  | "ai_reasoning"
  | "reconciling_assignees"
  | "syncing_excel"
  | "evaluating_sla"
  | "standby";

export interface BotState {
  enabled: boolean;
  phase: BotPhase;
  statusText: string;
  lastRunTimestamp: string | null;
  nextRunTimestamp: string | null;
  error: string | null;
  isLeader: boolean;
  /** Short, timestamped lines describing background setup / MAP fetches. */
  logs: string[];
}

const BOT_CONFIG_KEY = "arc-stores-bot-config";
const TAP_SCAN_CACHE_KEY = "arc_tap_scan_cache_v1";
const TAB_LOCK_KEY = "arc_stores_bot_leader_lock";
const SYNC_BUS_NAME = "arc_stores_bus";
const NEXT_RUN_STORAGE_KEY = "arc_stores_bot_next_run_ms";
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1 hour cadence
const SETUP_CONCURRENCY = 3;

// Internal Tekion TGPT Configuration
const TGPT_TOKEN_KEY = "tgpt_access_token";
const TGPT_BASE = "https://tapapi.tekioncloud.com/tapapi/tgpt";

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

function formatNextRunText(nextRunMs: number | null): string {
  if (!nextRunMs) return "Bot active";
  const diffMs = nextRunMs - Date.now();
  if (diffMs <= 0) return "Running shortly...";

  const targetDate = new Date(nextRunMs);
  const timeStr = targetDate.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const remainingMinutes = Math.max(1, Math.round(diffMs / 60000));
  if (remainingMinutes < 60) {
    return `Next run at ${timeStr} (in${remainingMinutes}m)`;
  }

  const hours = Math.floor(remainingMinutes / 60);
  const mins = remainingMinutes % 60;
  return `Next run at ${timeStr} (in ${hours}h${mins}m)`;
}

function loadAndPruneTapScanCache(): Record<string, string> {
  try {
    const raw = localStorage.getItem(TAP_SCAN_CACHE_KEY);
    if (!raw) return {};
    const parsed: Record<string, string> = JSON.parse(raw);
    const now = Date.now();
    const pruned: Record<string, string> = {};

    for (const [id, iso] of Object.entries(parsed)) {
      const timestamp = new Date(iso).getTime();
      if (!Number.isNaN(timestamp) && now - timestamp < 48 * 3600 * 1000) {
        pruned[id] = iso;
      }
    }
    return pruned;
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

  if (!capture.graphApiToken) {
    return { valid: false, reason: "Missing Graph API Token" };
  }
  if (typeof capture.graphExpiresAt === "number" && capture.graphExpiresAt <= Date.now()) {
    return { valid: false, reason: "Graph API Token Expired" };
  }

  const slack = getSlackSession();
  if (!slack.slackToken || !slack.slackDCookie) {
    return { valid: false, reason: "Missing Slack session" };
  }

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

async function queryStoresAi(prompt: string, systemPrompt?: string): Promise<string> {
  const token = localStorage.getItem(TGPT_TOKEN_KEY);
  if (!token) return "";

  try {
    const createRes = await fetch(`${TGPT_BASE}/conversations`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4",
        title: "StoresBot Operations Intelligence",
        is_temporary: true,
        thinking: false,
      }),
    });

    if (!createRes.ok) return "";
    const { id: convId } = await createRes.json();

    const fullContent = systemPrompt ? `${systemPrompt}\n\nDATA TO ANALYZE:\n${prompt}` : prompt;

    const streamRes = await fetch(`${TGPT_BASE}/conversations/${convId}/messages/stream`, {
      method: "POST",
      headers: {
        accept: "*/*",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: fullContent,
        attachments: [],
        thinking: false,
        web_search_enabled: false,
        code_execution_enabled: false,
        artifacts_enabled: false,
      }),
    });

    if (!streamRes.ok || !streamRes.body) return "";

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assistantContent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        if (!part.trim()) continue;
        const lines = part.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const rawData = line.substring(6).trim();
          if (rawData === "[DONE]") continue;

          try {
            const data = JSON.parse(rawData);
            if (data.type === "content_delta") {
              assistantContent += data.delta || "";
            }
          } catch {}
        }
      }
    }

    return assistantContent.trim();
  } catch (err) {
    console.warn("[StoresBot AI] TGPT request bypassed:", err);
    return "";
  }
}

class StoresBotRunner {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private nextRunTimestampMs: number | null = null;
  private isExecuting = false;
  private isLeader = false;
  private tabLockAbort: AbortController | null = null;
  private syncChannel: BroadcastChannel | null = null;
  private listeners: Set<(state: BotState) => void> = new Set();

  private state: BotState = {
    enabled: localStorage.getItem(BOT_CONFIG_KEY) === "true",
    phase: "idle",
    statusText: "Bot Idle",
    lastRunTimestamp: null,
    nextRunTimestamp: null,
    error: null,
    isLeader: false,
    logs: [],
  };

  constructor() {
    const savedNextRun = Number(localStorage.getItem(NEXT_RUN_STORAGE_KEY) || 0);
    if (savedNextRun && savedNextRun > Date.now()) {
      this.nextRunTimestampMs = savedNextRun;
      this.state.nextRunTimestamp = new Date(savedNextRun).toISOString();
    }

    this.initBroadcastChannel();
    this.initVisibilityListener();
    this.acquireTabLeaderLock();
  }

  private initBroadcastChannel() {
    if (typeof BroadcastChannel !== "undefined") {
      this.syncChannel = new BroadcastChannel(SYNC_BUS_NAME);
      this.syncChannel.addEventListener("message", (event) => {
        if (event.data?.type === "BOT_CYCLE_COMPLETED" && !this.isLeader) {
          console.info("[StoresBot] 📡 Synced with primary tab completion.");
        }
      });
    }
  }

  private initVisibilityListener() {
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (
          document.visibilityState === "visible" &&
          this.isLeader &&
          this.state.enabled &&
          !this.isExecuting
        ) {
          if (this.nextRunTimestampMs && Date.now() >= this.nextRunTimestampMs) {
            console.info("[StoresBot] ⏰ Time elapsed while inactive. Triggering cycle now...");
            void this.executeCycle(false);
          } else {
            this.updateCountdownDisplay();
          }
        }
      });
    }
  }

  private acquireTabLeaderLock() {
    if (typeof navigator !== "undefined" && "locks" in navigator) {
      this.tabLockAbort = new AbortController();
      navigator.locks
        .request(TAB_LOCK_KEY, { signal: this.tabLockAbort.signal }, async () => {
          this.isLeader = true;
          this.state.isLeader = true;
          console.info("[StoresBot] 👑 Acquired leader lock for this tab.");
          this.notify();

          if (this.state.enabled) {
            this.start();
          }

          return new Promise<void>(() => {});
        })
        .catch((err) => {
          if (err.name !== "AbortError") {
            this.isLeader = false;
            this.state.isLeader = false;
            console.warn("[StoresBot] Secondary tab. Standing by.");
            this.updateStatus("standby", "Standby (Another tab is primary runner)");
          }
        });
    } else {
      this.isLeader = true;
      this.state.isLeader = true;
      if (this.state.enabled) {
        this.start();
      }
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

  private log(line: string) {
    const stamp = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    this.state.logs = [`${stamp}  ${line}`, ...this.state.logs].slice(0, 40);
    this.notify();
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
    if (enabled && this.isLeader) {
      this.start();
      void this.executeCycle(true);
    } else {
      this.stop();
    }
    this.notify();
  }

  private scheduleNextRun() {
    this.nextRunTimestampMs = Date.now() + DEFAULT_INTERVAL_MS;
    localStorage.setItem(NEXT_RUN_STORAGE_KEY, String(this.nextRunTimestampMs));
    this.state.nextRunTimestamp = new Date(this.nextRunTimestampMs).toISOString();
  }

  private updateCountdownDisplay() {
    if (this.state.phase === "idle" && this.state.enabled && this.nextRunTimestampMs) {
      this.updateStatus("idle", formatNextRunText(this.nextRunTimestampMs));
    }
  }

  public start() {
    if (!this.isLeader) {
      this.updateStatus("standby", "Standby (Another tab is primary runner)");
      return;
    }

    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    if (!this.nextRunTimestampMs || this.nextRunTimestampMs <= Date.now()) {
      this.scheduleNextRun();
    }

    this.heartbeatTimer = setInterval(() => {
      if (!this.state.enabled || !this.isLeader || this.isExecuting) return;

      const now = Date.now();
      if (this.nextRunTimestampMs && now >= this.nextRunTimestampMs) {
        console.info("[StoresBot] 🚀 Heartbeat triggered scheduled cycle.");
        void this.executeCycle(false);
      } else {
        this.updateCountdownDisplay();
      }
    }, 5000);

    this.updateCountdownDisplay();
  }

  public stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.nextRunTimestampMs = null;
    localStorage.removeItem(NEXT_RUN_STORAGE_KEY);
    this.state.nextRunTimestamp = null;
    this.updateStatus("idle", "Bot paused");
  }

  /**
   * Main Autonomous Pipeline with Distinct Active T-90 vs Historical Scope
   */
  public async executeCycle(force = false): Promise<void> {
    if (this.isExecuting) {
      console.warn("[StoresBot] Cycle already in progress. Skipping.");
      return;
    }
    if (!this.isLeader && !force) {
      console.warn("[StoresBot] Not leader tab. Skipping.");
      return;
    }
    if (!this.state.enabled && !force) return;

    this.isExecuting = true;
    console.info(`[StoresBot] 🎬 Starting execution cycle at ${new Date().toLocaleTimeString()}...`);

    try {
      // Phase 0: Token Freshness
      this.updateStatus("token_check", "Verifying token freshness...");
      const tokenCheck = checkTokensValid();
      if (!tokenCheck.valid) {
        console.warn(`[StoresBot] Token check failed: ${tokenCheck.reason}`);
        this.scheduleNextRun();
        this.updateStatus("idle", `Paused: ${tokenCheck.reason}`);
        return;
      }

      // Phase 1: Ingest T-90 Stores and establish active vs. historical partition
      this.updateStatus("ingesting_stores", "Auto-refreshing store records...");
      // Same duplicate rule as the Stores page: one row per tekion_id, more products wins, then more data.
      const rawStores = dedupeStoreList(await fetchStores(90));
      const allStoredRecords = await getStores();
      const existingMap = new Map(allStoredRecords.map((s) => [s.tekion_id, s]));
      const vault = getStoredStatusVault();

      // Active T-90 stores live from the TAP API
      let activeT90Records: ExtendedStoreRecord[] = Array.from(
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
                fixed_ops_status: override?.fixed_ops_status || existing?.fixed_ops_status || "TO DO",
                variable_ops_status: override?.variable_ops_status || existing?.variable_ops_status || "TO DO",
                testing_status: override?.testing_status || existing?.testing_status || "TO DO",
                // The status vault is the saved source for Not Worked, so an explicit blank (cleared) value must win.
                not_worked:
                  override?.not_worked !== undefined
                    ? override.not_worked
                    : existing?.not_worked || store.not_worked,
                custom_assignee:
                  override?.custom_assignee || existing?.custom_assignee || (store as any).custom_assignee,
                custom_variable_assignee:
                  override?.custom_variable_assignee ||
                  existing?.custom_variable_assignee ||
                  (store as any).custom_variable_assignee,
                fetched_blueprint_tasks: existing?.fetched_blueprint_tasks,
                attachments_incomplete: existing?.attachments_incomplete,
                fixed_ops_attachments: existing?.fixed_ops_attachments,
                variable_ops_attachments: existing?.variable_ops_attachments,
                tap_tasks_scanned_at: (existing as any)?.tap_tasks_scanned_at,
                setup_data: existing?.setup_data,
                setup_data_fetched_at: existing?.setup_data_fetched_at,
                setup_data_error: existing?.setup_data_error,
                setup_data_error_at: (existing as any)?.setup_data_error_at,
              },
            ];
          })
        ).values()
      );

      const fetchedIds = new Set(activeT90Records.map((s) => s.tekion_id));

      // Stores outside active T-90 (T-180, past launched, etc.) kept for historical persistence
      const historicalRecords: ExtendedStoreRecord[] = (allStoredRecords as ExtendedStoreRecord[]).filter(
        (s) => !fetchedIds.has(s.tekion_id)
      );

      // Save complete dataset back to local DB so historical data is never lost
      await saveStores([...activeT90Records, ...historicalRecords]);

      // Phase 2: Blueprint / Sign-Off Onboarding Statuses (Active T-90 Only)
      try {
        this.updateStatus("enriching_statuses", `Checking blueprint statuses for ${activeT90Records.length} T-90 stores...`);
        const needsStatusCheck = activeT90Records.filter((r) => !isSameLocalDay(r.onboarding_status_fetched_at));
        if (needsStatusCheck.length > 0) {
          const ids = needsStatusCheck.map((s) => s.tekion_id);
          const statusMap = await fetchStoreOnboardingStatuses(ids, { chunkSize: 25, concurrency: 3 });
          const nowIso = new Date().toISOString();
          activeT90Records = activeT90Records.map((r) => {
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
          await saveStores([...activeT90Records, ...historicalRecords]);
        }
      } catch (bpErr) {
        console.warn("[StoresBot] Blueprint statuses check warning:", bpErr);
      }

      // Phase 3: Scan Real TAP Tasks (Active T-90 Only)
      const scanCache = loadAndPruneTapScanCache();
      const storesNeedingTapScan = activeT90Records.filter((r) => {
        if (r.fixed_ops_status === "Completed" && r.variable_ops_status === "Completed") return false;
        if (!r.onboarding_project_id && !r.ds_onboarding_project_id) return false;
        const lastScanned =
          scanCache[r.tekion_id] || (r as any).tap_tasks_scanned_at || r.fetched_blueprint_tasks?.fetchedAt;
        if (lastScanned && isSameLocalDay(lastScanned) && !r.attachments_incomplete) return false;
        return true;
      });

      if (storesNeedingTapScan.length > 0) {
        this.updateStatus("scanning_tap", `Scanning TAP tasks: 0/${storesNeedingTapScan.length} pending T-90 stores...`);
        try {
          const { updatedStores, updatedCount } = await batchFetchRealTapStatuses(
            storesNeedingTapScan,
            (processed, total, updated, skippedTasks) => {
              if (this.state.enabled) {
                this.updateStatus(
                  "scanning_tap",
                  `Scanning TAP tasks: Store ${processed}/${total} (Updated: ${updated}, Cached Tasks:${skippedTasks ?? 0})`
                );
              }
            }
          );

          const nowIso = new Date().toISOString();
          const updatedSet = new Set(updatedStores.map((u) => u.tekion_id));
          for (const s of storesNeedingTapScan) {
            if (updatedSet.has(s.tekion_id) || !s.attachments_incomplete) {
              scanCache[s.tekion_id] = nowIso;
              (s as any).tap_tasks_scanned_at = nowIso;
            }
          }
          saveTapScanCache(scanCache);

          if (updatedCount > 0) {
            const updatedMap = new Map(updatedStores.map((u) => [u.tekion_id, u as ExtendedStoreRecord]));
            activeT90Records = activeT90Records.map((r) => {
              const u = updatedMap.get(r.tekion_id);
              return u ? { ...u, tap_tasks_scanned_at: nowIso } : r;
            });
          }
          await saveStores([...activeT90Records, ...historicalRecords]);
        } catch (tapErr) {
          console.warn("[StoresBot] TAP tasks scan warning:", tapErr);
        }
      } else {
        this.updateStatus("scanning_tap", "TAP tasks up to date (0 pending T-90 stores)");
      }

      // Phase 4: Setup Data Enrichment (Active T-90 Only)
      try {
        this.updateStatus("enriching_setup", "Scanning for missing setup data in T-90 scope...");

        const missingSetup = activeT90Records.filter((r) => {
          // Variable Ops data rule: today to 90 days, Fixed Ops prerequisite done, ACCTS above 50 = done.
          const days = daysToGoLive(r);
          if (days === null || days < 0 || days > 90) return false;
          if (!fixedOpsPrerequisiteDone(r)) return false;
          if (String(r.variable_ops_status ?? "").trim().toLowerCase() === "completed") return false; // Variable Ops done
          if (acctsReady(r)) return false;

          // Incomplete or failed setup data is re-checked at most every 4 hours (failures also stamp coa_checked_at).
          if (r.coa_checked_at && Date.now() - Date.parse(r.coa_checked_at) < RECHECK_INTERVAL_MS) return false;

          return true;
        });

        let setupFetched = 0;
        const failedSetupDealers: Array<{ dealerId: string; dbaName: string; error: string; mapResult: string }> = [];
        const incompleteSetupDealers: Array<{ dealerId: string; dbaName: string; missing: string[]; mapResult: string }> = [];

        for (let i = 0; i < missingSetup.length; i += SETUP_CONCURRENCY) {
          if (!this.state.enabled) break;
          const chunk = missingSetup.slice(i, i + SETUP_CONCURRENCY);

          this.updateStatus(
            "enriching_setup",
            `Fetching setup data: (${Math.min(i + chunk.length, missingSetup.length)}/${missingSetup.length})`
          );

          const nowIso = new Date().toISOString();

          await Promise.all(
            chunk.map(async (record) => {
              // Same path as the Stores buttons: fetch, then MAP fallback when setup is missing or incomplete.
              const outcome = await fetchSetupWithMapFallback(record);
              const dealerLabel = `#${record.dealer_id} ${record.dba_name || ""}`.trim();

              if (outcome.setupData) {
                record.setup_data = outcome.setupData;
                record.setup_data_fetched_at = outcome.setupData.fetchedAt;
              }
              if (outcome.preprodValidation) record.preprod_validation = outcome.preprodValidation;
              record.setup_data_error = outcome.errorNote;
              (record as any).setup_data_error_at = outcome.errorNote ? nowIso : undefined;
              record.coa_checked_at = nowIso;

              if (outcome.setupError) {
                this.log(`Setup data: ${dealerLabel} failed (${outcome.setupError.slice(0, 60)})`);
                failedSetupDealers.push({
                  dealerId: record.dealer_id,
                  dbaName: record.dba_name || "Unknown Dealer",
                  error: outcome.setupError,
                  mapResult: outcome.preprodValidation
                    ? outcome.preprodValidation.isValidTenant ? "MAP verified" : `MAP invalid: ${outcome.preprodValidation.validationError}`
                    : outcome.mapError || "MAP not run",
                });
              } else if (!outcome.complete) {
                this.log(`Setup data: ${dealerLabel} ACCTS ${outcome.accts}, still below 50`);
                incompleteSetupDealers.push({
                  dealerId: record.dealer_id,
                  dbaName: record.dba_name || "Unknown Dealer",
                  missing: [`ACCTS ${outcome.accts} (needs >50)`],
                  mapResult: outcome.preprodValidation
                    ? outcome.preprodValidation.isValidTenant ? "MAP verified" : `MAP invalid: ${outcome.preprodValidation.validationError}`
                    : outcome.mapError || "MAP not run",
                });
              } else {
                this.log(`Setup data: ${dealerLabel} complete, COA count ${outcome.setupData?.coaAccessibleDealerCount ?? 0}`);
                setupFetched++;
              }
            })
          );

          const freshDb = await getStores();
          const freshMap = new Map(freshDb.map((s) => [s.tekion_id, s]));

          activeT90Records = activeT90Records.map((memStore) => {
            const fresh = freshMap.get(memStore.tekion_id);
            return {
              ...memStore,
              setup_data: memStore.setup_data ?? fresh?.setup_data,
              setup_data_fetched_at: memStore.setup_data_fetched_at ?? fresh?.setup_data_fetched_at,
              setup_data_error: memStore.setup_data_error ?? fresh?.setup_data_error,
              setup_data_error_at: (memStore as any)?.setup_data_error_at ?? (fresh as any)?.setup_data_error_at,
            };
          });
          await saveStores([...activeT90Records, ...historicalRecords]);

          await delay(250);
        }

        // AI Error Root-Cause & Action Recommendation for active setup failures
        if (failedSetupDealers.length > 0 || incompleteSetupDealers.length > 0) {
          this.updateStatus("ai_reasoning", "TGPT analyzing setup errors & drafting solution...");

          const aiPrompt = `Here is a list of Tekion DMS setup fetch errors for preprod stores:\n${JSON.stringify(
            failedSetupDealers,
            null,
            2
          )}\n\nGive 2 concise bullet points: 1) The exact root cause for these failures. 2) The exact operational action the ARC engineer should take. Format cleanly for Slack.`;

          const aiDiagnosis = failedSetupDealers.length > 0
            ? await queryStoresAi(aiPrompt, "You are a Tekion DMS Data Architect. Be concise, precise, and practical.")
            : "";

          try {
            const slack = getSlackSession();
            if (slack.slackToken) {
              const failLines = failedSetupDealers.map(
                (f) => `*Dealer #${f.dealerId}* (${f.dbaName}): \`${f.error}\` · ${f.mapResult}`
              );
              const incompleteLines = incompleteSetupDealers.map(
                (f) => `*Dealer #${f.dealerId}* (${f.dbaName}): missing ${f.missing.join(", ")} · ${f.mapResult}`
              );

              const alertSections: string[] = [`⚠️ *Setup Data Alert*`];
              if (failedSetupDealers.length > 0) {
                alertSections.push(
                  `*Fetch failed* for ${failedSetupDealers.length} dealer(s) (will retry in 4 hours):`,
                  ...failLines
                );
              }
              if (incompleteSetupDealers.length > 0) {
                alertSections.push(
                  "",
                  `*Setup incomplete* for ${incompleteSetupDealers.length} dealer(s) (will retry in 4 hours):`,
                  ...incompleteLines
                );
              }

              if (aiDiagnosis) {
                alertSections.push("", `🧠 *TGPT AI Diagnostic & Solution:*`, aiDiagnosis);
              }

              await sendSlackChannelMessage({
                channelId: STORES_ALERT_CHANNEL_ID,
                text: alertSections.join("\n"),
              });
            }
          } catch (slackAlertErr) {
            console.warn("[StoresBot] Could not send setup failure alert to Slack:", slackAlertErr);
          }
        }
      } catch (setupPhaseErr) {
        console.warn("[StoresBot] Setup enrichment warning:", setupPhaseErr);
      }

      // Phase 4b: Variable Ops readiness (COA + ACCTS counts, 4-hour re-check when a count is 0)
      try {
        this.updateStatus("enriching_readiness", "Checking Variable Ops readiness data...");
        const readiness = await refreshVariableReadiness(activeT90Records, {
          onLog: (line) => this.log(line),
        });
        activeT90Records = readiness.stores as ExtendedStoreRecord[];
        await saveStores([...activeT90Records, ...historicalRecords]);
        if (readiness.newlyReady.length > 0) {
          await notifyReadyToConfigure(readiness.newlyReady);
        }
      } catch (readinessErr) {
        console.warn("[StoresBot] Readiness phase warning:", readinessErr);
        this.log(`Readiness check failed: ${readinessErr instanceof Error ? readinessErr.message : "unknown error"}`);
      }

      // Phase 5: Auto-Reconcile & Auto-Assign (Active T-90 Only)
      try {
        this.updateStatus("reconciling_assignees", "Running auto-assign bot rules on T-90 stores...");
        const automation = runAssigneeAutomation(activeT90Records);
        if (automation) {
          const { updated } = automation;
          if (updated.length > 0) {
            this.log(`Assigned ${updated.length} store${updated.length === 1 ? "" : "s"} to team members`);
            const updatedMap = new Map(updated.map((u) => [u.tekion_id, u as ExtendedStoreRecord]));
            activeT90Records = activeT90Records.map((r) => {
              const u = updatedMap.get(r.tekion_id);
              return u && !r.custom_assignee ? { ...r, custom_assignee: u.custom_assignee } : r;
            });
            await saveStores([...activeT90Records, ...historicalRecords]);
            await patchAssigneesInGraph(updated);
          }
        }
      } catch (assignErr) {
        console.warn("[StoresBot] Assignee reconciliation warning:", assignErr);
      }

      // Phase 6: Excel 2-Way Synchronization
      try {
        this.updateStatus("syncing_excel", "Synchronizing with Excel workbook...");
        const completeDataset = [...activeT90Records, ...historicalRecords];
        const { updatedStores, hasChanges } = await pullStatusUpdatesFromGraph(completeDataset);
        if (hasChanges) {
          const updatedMap = new Map(updatedStores.map((s) => [s.tekion_id, s]));
          activeT90Records = activeT90Records.map((r) => {
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
          const allMerged = [...activeT90Records, ...historicalRecords];
          await saveStores(allMerged);
          persistStatusVault(allMerged);
        }
        await syncProdDealersToGraph([...activeT90Records, ...historicalRecords]);
      } catch (excelErr) {
        console.warn("[StoresBot] Background Excel sync warning:", excelErr);
      }

      // Phase 7: SLA Evaluation & Scheduled Reports (Active T-90 Only)
      try {
        this.updateStatus("evaluating_sla", "Checking 4-hr report cadence & dispatching alerts for T-90 scope...");
        await runSlackAlerts(activeT90Records);
        await maybeSendDailyDigest(activeT90Records);

        if (shouldSendScheduledReports()) {
          this.updateStatus("evaluating_sla", "Generating & dispatching 4-hr audit reports...");
          await dispatchAllThreeReports(activeT90Records);
        }
      } catch (slaErr) {
        console.error("[StoresBot] SLA/Report dispatch warning:", slaErr);
      }

      this.syncChannel?.postMessage({ type: "BOT_CYCLE_COMPLETED", timestamp: Date.now() });

      const now = new Date();
      this.state.lastRunTimestamp = now.toISOString();
      this.scheduleNextRun();
      this.updateStatus("idle", formatNextRunText(this.nextRunTimestampMs));
    } catch (criticalErr: unknown) {
      const msg = criticalErr instanceof Error ? criticalErr.message : "Fatal bot cycle error";
      console.error("[StoresBotRunner] Fatal cycle crash:", criticalErr);
      this.scheduleNextRun();
      this.updateStatus("idle", `Error occurred. ${formatNextRunText(this.nextRunTimestampMs)}`, msg);
    } finally {
      this.isExecuting = false;
    }
  }
}

export const storesBotRunner = new StoresBotRunner();
