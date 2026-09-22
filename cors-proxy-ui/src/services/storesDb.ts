import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type CustomPhaseStatus = "TO DO" | "WIP" | "Completed";

export interface StoreSetupData {
  oemDealerCodes: string[];
  journalsAccessibleDealerCount: number;
  salesChainsAccessibleDealerCount: number;
  coaAccessibleDealerCount: number;
  fetchedAt: string;
  sourceUsername?: string;
  siteId?: string;
  userId?: string;
}

export interface StoreRecord {
  tekion_id: string;
  dealer_id: string;
  dba_name: string;
  tenant_id?: string;
  tenant_code?: string;
  launch_date: string;
  implementation_type?: string;
  product_types?: string;
  pre_production_environment_status?: string;
  superpod_id?: string;
  base_entity_instance_id?: string;
  implementation_tm_sync_status_tracking_id?: string;
  project_implementation_tm_sync_status_tracking_id?: string;

  /** TAP project ID used by the Tasks panel APIs. */
  onboarding_project_id?: string;

  // PDL & Leadership Contacts (used by storeSlackHelper)
  workorder_consolidated_pdl?: string;
  dealer_pdl?: string;
  arc_pdl?: string;
  project_engagement_manager_1781169293313734451?: string;
  fixed_ops_track_lead_1773369946675032982?: string;
  conversion_track_lead_1773369950325147526?: string;
  accounting_track_lead_1773369945455468395?: string;

  // Operational & Custom Statuses
  fixed_ops_status?: CustomPhaseStatus;
  variable_ops_status?: CustomPhaseStatus;
  testing_status?: CustomPhaseStatus;
  configuration_status?: CustomPhaseStatus;
  blueprint_statuses?: any;
  signoff_statuses?: any;
  onboarding_status_fetched_at?: string;
  setup_data?: StoreSetupData;
  setup_data_fetched_at?: string;
  setup_data_error?: string;
}

interface StoresDbSchema extends DBSchema {
  stores: {
    key: string;
    value: StoreRecord;
  };
}

const DB_NAME = "stores_database";
const DB_VERSION = 1;
const STORE_VAULT_KEY = "stores_status_vault";
const STATUS_TIMELINE_KEY = "stores_status_timeline";
const BACKUP_API_URL = "http://localhost:4000/api/stores/backup";

let dbPromise: Promise<IDBPDatabase<StoresDbSchema>> | null = null;

function getDb(): Promise<IDBPDatabase<StoresDbSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<StoresDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("stores")) {
          db.createObjectStore("stores", { keyPath: "tekion_id" });
        }
      },
    });
  }

  return dbPromise;
}

export function getStoredStatusVault(): Record<
  string,
  {
    fixed_ops_status?: CustomPhaseStatus;
    variable_ops_status?: CustomPhaseStatus;
    testing_status?: CustomPhaseStatus;
  }
> {
  try {
    const raw = localStorage.getItem(STORE_VAULT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getStatusTimeline(): Record<
  string,
  Record<string, { wipAt?: string; completedAt?: string }>
> {
  try {
    const raw = localStorage.getItem(STATUS_TIMELINE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

async function pushBackupToBackend(stores: StoreRecord[]): Promise<void> {
  if (!stores || stores.length === 0) return;

  try {
    const vault = getStoredStatusVault();
    const timeline = getStatusTimeline();

    await fetch(BACKUP_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stores, vault, timeline }),
    });
  } catch (err) {
    console.warn("[storesDb] Dual backup push failed:", err);
  }
}

export async function getStores(): Promise<StoreRecord[]> {
  const db = await getDb();
  const localStores = await db.getAll("stores");

  if (!localStores || localStores.length === 0) {
    console.info("[storesDb] IndexedDB empty. Initiating recovery from SQLite/Backup...");

    try {
      const res = await fetch(BACKUP_API_URL);
      if (res.ok) {
        const data = await res.json();
        const recoveredStores: StoreRecord[] = Array.isArray(data?.stores)
          ? data.stores
          : [];

        if (recoveredStores.length > 0) {
          const tx = db.transaction("stores", "readwrite");
          const store = tx.objectStore("stores");
          await Promise.all(recoveredStores.map((item) => store.put(item)));
          await tx.done;

          if (data.vault && Object.keys(data.vault).length > 0) {
            localStorage.setItem(STORE_VAULT_KEY, JSON.stringify(data.vault));
          }

          if (data.timeline && Object.keys(data.timeline).length > 0) {
            localStorage.setItem(STATUS_TIMELINE_KEY, JSON.stringify(data.timeline));
          }

          console.info(
            `[storesDb] ✅ Restored ${recoveredStores.length} stores and timelines.`
          );
          return recoveredStores;
        }
      }
    } catch (err) {
      console.warn("[storesDb] Recovery failed:", err);
    }
  }

  return localStores;
}

export async function saveStores(stores: StoreRecord[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("stores", "readwrite");
  const store = tx.objectStore("stores");

  await Promise.all(stores.map((item) => store.put(item)));
  await tx.done;

  void pushBackupToBackend(stores);
}

export function saveStatusToVault(
  tekionId: string,
  field: "fixed_ops_status" | "variable_ops_status" | "testing_status",
  value: CustomPhaseStatus
): void {
  try {
    const vault = getStoredStatusVault();
    if (!vault[tekionId]) vault[tekionId] = {};

    vault[tekionId][field] = value;
    localStorage.setItem(STORE_VAULT_KEY, JSON.stringify(vault));
  } catch (err) {
    console.error("[storesDb] Failed save status to vault:", err);
  }
}

/**
 * Bulk updates the vault with safety rules:
 * Completed statuses are locked and cannot be demoted to 'TO DO' or 'WIP'
 * by automated background sync calls unless allowDowngrade is explicitly true.
 */
export function bulkUpdateStatusVault(
  updates: Array<{
    tekionId: string;
    fixed_ops_status?: CustomPhaseStatus;
    variable_ops_status?: CustomPhaseStatus;
    testing_status?: CustomPhaseStatus;
  }>,
  allowDowngrade = false
): void {
  try {
    const vault = getStoredStatusVault();
    const priorityScore: Record<string, number> = { Completed: 3, WIP: 2, "TO DO": 1 };

    for (const item of updates) {
      if (!vault[item.tekionId]) vault[item.tekionId] = {};

      if (item.fixed_ops_status) {
        const current = vault[item.tekionId].fixed_ops_status;
        if (
          allowDowngrade ||
          (priorityScore[item.fixed_ops_status] ?? 1) >= (priorityScore[current || "TO DO"] ?? 1)
        ) {
          vault[item.tekionId].fixed_ops_status = item.fixed_ops_status;
        }
      }
      if (item.variable_ops_status) {
        const current = vault[item.tekionId].variable_ops_status;
        if (
          allowDowngrade ||
          (priorityScore[item.variable_ops_status] ?? 1) >= (priorityScore[current || "TO DO"] ?? 1)
        ) {
          vault[item.tekionId].variable_ops_status = item.variable_ops_status;
        }
      }
      if (item.testing_status) {
        const current = vault[item.tekionId].testing_status;
        if (
          allowDowngrade ||
          (priorityScore[item.testing_status] ?? 1) >= (priorityScore[current || "TO DO"] ?? 1)
        ) {
          vault[item.tekionId].testing_status = item.testing_status;
        }
      }
    }

    localStorage.setItem(STORE_VAULT_KEY, JSON.stringify(vault));
  } catch (err) {
    console.error("[storesDb] Bulk update status vault failed:", err);
  }
}

export function recordStatusTransition(
  tekionId: string,
  field: "fixed_ops_status" | "variable_ops_status" | "testing_status",
  value: CustomPhaseStatus,
  customIsoTime?: string
): void {
  try {
    const timeline = getStatusTimeline();

    if (!timeline[tekionId]) timeline[tekionId] = {};
    if (!timeline[tekionId][field]) timeline[tekionId][field] = {};

    const timestamp = customIsoTime || new Date().toISOString();

    if (value === "WIP") {
      timeline[tekionId][field].wipAt = timestamp;
    } else if (value === "Completed") {
      timeline[tekionId][field].completedAt = timestamp;
    } else if (value === "TO DO") {
      timeline[tekionId][field] = {};
    }

    localStorage.setItem(STATUS_TIMELINE_KEY, JSON.stringify(timeline));
  } catch (err) {
    console.error("[storesDb] Record status transition failed:", err);
  }
}