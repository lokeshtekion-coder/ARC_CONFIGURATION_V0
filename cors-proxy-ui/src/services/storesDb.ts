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
  conversion_track_lead_1773369950325147526?: string;
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

/**
 * Pushes the latest snapshot of stores to the Node.js backend disk.
 */
async function pushBackupToBackend(stores: StoreRecord[]): Promise<void> {
  if (!stores || stores.length === 0) return;
  try {
    const res = await fetch(BACKUP_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stores }),
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`[storesDb] ✅ Backup pushed to backend (port 4000): ${data.count} stores.`);
    } else {
      console.warn(`[storesDb] ❌ Backup push returned status: ${res.status}`);
    }
  } catch (err) {
    console.warn("[storesDb] Backend backup push failed:", err);
  }
}

/**
 * Recovers the latest stores snapshot from the Node.js backend disk.
 */
async function fetchBackupFromBackend(): Promise<StoreRecord[]> {
  try {
    const res = await fetch(BACKUP_API_URL);
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.stores) ? data.stores : [];
  } catch (err) {
    console.warn("[storesDb] Failed to recover backup from backend:", err);
    return [];
  }
}

/**
 * Reads stores from IndexedDB. If IndexedDB is empty (e.g., cleared on system reboot),
 * it queries the backend disk backup, populates IndexedDB, and returns the records.
 */
export async function getStores(): Promise<StoreRecord[]> {
  const db = await getDb();
  let localStores = await db.getAll("stores");

  if (!localStores || localStores.length === 0) {
    console.info("[storesDb] IndexedDB is empty. Attempting recovery from backend backup...");
    const recovered = await fetchBackupFromBackend();
    if (recovered.length > 0) {
      const tx = db.transaction("stores", "readwrite");
      const store = tx.objectStore("stores");
      await Promise.all(recovered.map((s) => store.put(s)));
      await tx.done;
      console.info(`[storesDb] Successfully restored ${recovered.length} stores from backend.`);
      return recovered;
    }
  }

  return localStores;
}

/**
 * Persists stores into IndexedDB and asynchronously updates the backend backup file.
 */
export async function saveStores(stores: StoreRecord[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("stores", "readwrite");
  const store = tx.objectStore("stores");
  await Promise.all(stores.map((s) => store.put(s)));
  await tx.done;

  // Asynchronously overwrite the backup on the backend
  void pushBackupToBackend(stores);
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

export function saveStatusToVault(
  tekionId: string,
  field: "fixed_ops_status" | "variable_ops_status" | "testing_status",
  value: CustomPhaseStatus
): void {
  try {
    const vault = getStoredStatusVault();
    if (!vault[tekionId]) {
      vault[tekionId] = {};
    }
    vault[tekionId][field] = value;
    localStorage.setItem(STORE_VAULT_KEY, JSON.stringify(vault));
  } catch (err) {
    console.error("[storesDb] Failed to save status to vault", err);
  }
}

/**
 * Bulk updates the Status Vault cache for multiple stores.
 * Directly modifies localStorage so cached values match live Excel state.
 */
export function bulkUpdateStatusVault(
  updates: Array<{
    tekionId: string;
    fixed_ops_status?: CustomPhaseStatus;
    variable_ops_status?: CustomPhaseStatus;
    testing_status?: CustomPhaseStatus;
  }>
): void {
  try {
    const vault = getStoredStatusVault();
    for (const item of updates) {
      if (!vault[item.tekionId]) {
        vault[item.tekionId] = {};
      }
      if (item.fixed_ops_status) vault[item.tekionId].fixed_ops_status = item.fixed_ops_status;
      if (item.variable_ops_status) vault[item.tekionId].variable_ops_status = item.variable_ops_status;
      if (item.testing_status) vault[item.tekionId].testing_status = item.testing_status;
    }
    localStorage.setItem(STORE_VAULT_KEY, JSON.stringify(vault));
  } catch (err) {
    console.error("[storesDb] Failed bulk update status vault", err);
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

export function recordStatusTransition(
  tekionId: string,
  field: "fixed_ops_status" | "variable_ops_status" | "testing_status",
  value: CustomPhaseStatus,
  customIsoTime?: string
): void {
  try {
    const timeline = getStatusTimeline();
    if (!timeline[tekionId]) {
      timeline[tekionId] = {};
    }
    if (!timeline[tekionId][field]) {
      timeline[tekionId][field] = {};
    }

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
    console.error("[storesDb] Failed to record status transition", err);
  }
}