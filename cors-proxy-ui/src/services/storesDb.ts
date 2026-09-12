import type {
  StoreBlueprintStatuses,
  StoreSignoffStatuses,
} from "./storeOnboardingStatusApi";
import {
  ensureStoreExists,
  getArcConfigDbMeta,
  openArcConfigDb,
} from "./arcConfigDb";

export type CustomPhaseStatus = "TO DO" | "WIP" | "Completed";

export interface StoreRecord {
  tekion_id: string;
  dealer_id: string;
  dba_name: string;
  launch_date: string;
  implementation_type: string;
  pre_production_environment_status: string;
  superpod_id: string;
  product_types?: string;

  blueprint_statuses?: StoreBlueprintStatuses;
  signoff_statuses?: StoreSignoffStatuses;
  onboarding_status_fetched_at?: string;

  // Split into Fixed Ops and Variable Ops
  configuration_status?: CustomPhaseStatus; // Kept for legacy backward compatibility
  fixed_ops_status?: CustomPhaseStatus;
  variable_ops_status?: CustomPhaseStatus;
  testing_status?: CustomPhaseStatus;

  workorder_consolidated_pdl?: string;
  dealer_pdl?: string;
  arc_pdl?: string;

  project_implementation_tm_sync_status_tracking_id?: string;
  implementation_tm_sync_status_tracking_id?: string;
  base_entity_instance_id?: string;

  project_engagement_manager_1781169293313734451?: string;
  fixed_ops_track_lead_1773369946675032982?: string;
  conversion_track_lead_1773369950325147526?: string;
  accounting_track_lead_1773369945455468395?: string;

  tenant_code?: string;
  tenant_id?: string;
}

const { STORES_STORE: STORE_NAME } = getArcConfigDbMeta();
const STATUS_VAULT_KEY = "TEKION_STORES_STATUS_VAULT_V1";

export interface StoreStatusOverride {
  fixed_ops_status?: CustomPhaseStatus;
  variable_ops_status?: CustomPhaseStatus;
  testing_status?: CustomPhaseStatus;
}

/**
 * Bulletproof synchronous backup in localStorage.
 * Survives IndexedDB crashes, drops, or backend API wipes.
 */
export function getStoredStatusVault(): Record<string, StoreStatusOverride> {
  try {
    const raw = localStorage.getItem(STATUS_VAULT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.error("Failed to read from localStorage status vault", e);
    return {};
  }
}

export function saveStatusToVault(
  tekion_id: string,
  field: "fixed_ops_status" | "variable_ops_status" | "testing_status",
  value: CustomPhaseStatus
): void {
  try {
    const vault = getStoredStatusVault();
    vault[tekion_id] = {
      ...vault[tekion_id],
      [field]: value,
    };
    localStorage.setItem(STATUS_VAULT_KEY, JSON.stringify(vault));
  } catch (e) {
    console.error("Failed to write to localStorage status vault", e);
  }
}

export async function saveStores(records: StoreRecord[]): Promise<void> {
  const db = await openArcConfigDb();

  return new Promise<void>((resolve, reject) => {
    ensureStoreExists(db, STORE_NAME);

    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    store.clear();

    for (const record of records) {
      store.put(record);
    }

    tx.oncomplete = () => {
      console.log(`💾 Successfully saved ${records.length} stores to local memory.`);
      db.close();
      resolve();
    };

    tx.onerror = () => {
      console.error("❌ Failed to save stores to local memory.", tx.error);
      db.close();
      reject(tx.error);
    };

    tx.onabort = () => {
      console.warn("⚠️ Save operation was aborted.");
      db.close();
      reject(new Error("Save transaction aborted."));
    };
  });
}

export async function getStores(): Promise<StoreRecord[]> {
  const db = await openArcConfigDb();

  return new Promise<StoreRecord[]>((resolve, reject) => {
    ensureStoreExists(db, STORE_NAME);

    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const rows = (req.result as StoreRecord[]) ?? [];
      console.log(`📂 Loaded ${rows.length} stores from local memory.`);
      db.close();
      resolve(rows);
    };

    req.onerror = () => {
      console.error("❌ Failed to load stores from local memory.", req.error);
      db.close();
      reject(req.error);
    };
  });
}

export async function clearStores(): Promise<void> {
  const db = await openArcConfigDb();

  return new Promise<void>((resolve, reject) => {
    ensureStoreExists(db, STORE_NAME);

    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();

    req.onsuccess = () => {
      console.log("🧹 Successfully cleared all stores from local memory.");
      db.close();
      resolve();
    };

    req.onerror = () => {
      console.error("❌ Failed to clear stores.", req.error);
      db.close();
      reject(req.error);
    };
  });
}