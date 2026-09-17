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

export async function getStores(): Promise<StoreRecord[]> {
  const db = await getDb();
  return db.getAll("stores");
}

export async function saveStores(stores: StoreRecord[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("stores", "readwrite");
  const store = tx.objectStore("stores");
  await Promise.all(stores.map((s) => store.put(s)));
  await tx.done;
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