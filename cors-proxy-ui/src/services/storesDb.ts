import type {
  StoreBlueprintStatuses,
  StoreSignoffStatuses,
} from "./storeOnboardingStatusApi";
import { ensureStoreExists, getArcConfigDbMeta, openArcConfigDb } from "./arcConfigDb";

export interface StoreRecord {
  tekion_id: string;
  dealer_id: string;
  dba_name: string;
  launch_date: string;
  implementation_type: string;
  pre_production_environment_status: string;
  superpod_id: string;
  blueprint_statuses?: StoreBlueprintStatuses;
  signoff_statuses?: StoreSignoffStatuses;
  onboarding_status_fetched_at?: string;
}

const { STORES_STORE: STORE_NAME } = getArcConfigDbMeta();

function log(...args: unknown[]) {
  console.log("[storesDb]", ...args);
}

export async function saveStores(records: StoreRecord[]): Promise<void> {
  const db = await openArcConfigDb();

  return new Promise<void>((resolve, reject) => {
    try {
      ensureStoreExists(db, STORE_NAME);

      log("saveStores start", { count: records.length });

      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);

      store.clear();

      for (const record of records) {
        store.put(record);
      }

      tx.oncomplete = () => {
        log("saveStores complete", { count: records.length });
        db.close();
        resolve();
      };

      tx.onerror = () => {
        console.error("[storesDb] saveStores tx error", tx.error);
        db.close();
        reject(tx.error);
      };

      tx.onabort = () => {
        console.error("[storesDb] saveStores tx abort", tx.error);
        db.close();
        reject(tx.error ?? new Error("saveStores transaction aborted"));
      };
    } catch (err) {
      console.error("[storesDb] saveStores failed before tx", err);
      db.close();
      reject(err);
    }
  });
}

export async function getStores(): Promise<StoreRecord[]> {
  const db = await openArcConfigDb();

  return new Promise((resolve, reject) => {
    try {
      ensureStoreExists(db, STORE_NAME);

      log("getStores start");

      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const rows = (req.result as StoreRecord[]) ?? [];
        log("getStores success", { count: rows.length });
        db.close();
        resolve(rows);
      };

      req.onerror = () => {
        console.error("[storesDb] getStores req error", req.error);
        db.close();
        reject(req.error);
      };

      tx.onabort = () => {
        console.error("[storesDb] getStores tx abort", tx.error);
        db.close();
        reject(tx.error ?? new Error("getStores transaction aborted"));
      };
    } catch (err) {
      console.error("[storesDb] getStores failed before tx", err);
      db.close();
      reject(err);
    }
  });
}

export async function clearStores(): Promise<void> {
  const db = await openArcConfigDb();

  return new Promise<void>((resolve, reject) => {
    try {
      ensureStoreExists(db, STORE_NAME);

      log("clearStores start");

      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();

      req.onsuccess = () => {
        log("clearStores success");
        db.close();
        resolve();
      };

      req.onerror = () => {
        console.error("[storesDb] clearStores req error", req.error);
        db.close();
        reject(req.error);
      };

      tx.onabort = () => {
        console.error("[storesDb] clearStores tx abort", tx.error);
        db.close();
        reject(tx.error ?? new Error("clearStores transaction aborted"));
      };
    } catch (err) {
      console.error("[storesDb] clearStores failed before tx", err);
      db.close();
      reject(err);
    }
  });
}
