///Users/tlreddy/Desktop/ARC_CONFIGURATION_V0/cors-proxy-ui/src/services/storesDb.ts
import type {
  StoreBlueprintStatuses,
  StoreSignoffStatuses,
} from "./storeOnboardingStatusApi";
import { ensureStoreExists, getArcConfigDbMeta, openArcConfigDb } from "./arcConfigDb";

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

  // Custom Manual Trackers
  configuration_status?: CustomPhaseStatus;
  testing_status?: CustomPhaseStatus;
}

const { STORES_STORE: STORE_NAME } = getArcConfigDbMeta();

export async function saveStores(records: StoreRecord[]): Promise<void> {
  const db = await openArcConfigDb();

  return new Promise<void>((resolve, reject) => {
    ensureStoreExists(db, STORE_NAME);

    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    // Clear old data and write the new list
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

  return new Promise((resolve, reject) => {
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