const DB_NAME = "ARC_AUTO_CONFIG";
const DB_VERSION = 1;
const STORE_NAME = "gl_validation_results";

export interface SavedGLValidationRecord {
  key: string; // tekionId_dealerId_Accounting
  tekionId: string;
  dealerId: string;
  module: "Accounting";
  blueprintKey: string;
  blueprintFormName: string;
  blueprintSavedAt: string;
  bootstrapKey: string | null;
  bootstrapSavedAt: string | null;
  storeDealerId: string | null;
  storeTekionId: string | null;
  storeDbaName: string | null;
  matchSource: "dealerId" | "storeMapping" | "none";
  resultCount: number;
  matchedCount: number;
  unmatchedCount: number;
  results: unknown[];
  savedAt: string;
}

function log(...args: unknown[]) {
  console.log("[glValidationDb]", ...args);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    log("opening DB", { DB_NAME, DB_VERSION });

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
        log("created object store", { STORE_NAME });
      }
    };

    req.onsuccess = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      log("open success", {
        name: db.name,
        version: db.version,
        stores: Array.from(db.objectStoreNames),
      });
      resolve(db);
    };

    req.onerror = () => {
      console.error("[glValidationDb] open error", req.error);
      reject(req.error);
    };
  });
}

export async function idbSaveGLValidation(record: SavedGLValidationRecord): Promise<void> {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    try {
      log("save start", {
        key: record.key,
        tekionId: record.tekionId,
        dealerId: record.dealerId,
        resultCount: record.resultCount,
      });

      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(record);

      tx.oncomplete = () => {
        log("save complete", { key: record.key });
        db.close();
        resolve();
      };

      tx.onerror = () => {
        console.error("[glValidationDb] save tx error", tx.error);
        db.close();
        reject(tx.error);
      };

      tx.onabort = () => {
        console.error("[glValidationDb] save tx abort", tx.error);
        db.close();
        reject(tx.error ?? new Error("idbSaveGLValidation transaction aborted"));
      };
    } catch (err) {
      console.error("[glValidationDb] save failed before tx", err);
      db.close();
      reject(err);
    }
  });
}

export async function idbGetGLValidation(
  key: string
): Promise<SavedGLValidationRecord | null> {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    try {
      log("get start", { key });

      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);

      req.onsuccess = () => {
        log("get success", { key, found: Boolean(req.result) });
        db.close();
        resolve((req.result as SavedGLValidationRecord) ?? null);
      };

      req.onerror = () => {
        console.error("[glValidationDb] get req error", req.error);
        db.close();
        reject(req.error);
      };

      tx.onabort = () => {
        console.error("[glValidationDb] get tx abort", tx.error);
        db.close();
        reject(tx.error ?? new Error("idbGetGLValidation transaction aborted"));
      };
    } catch (err) {
      console.error("[glValidationDb] get failed before tx", err);
      db.close();
      reject(err);
    }
  });
}

export async function idbGetAllGLValidations(): Promise<SavedGLValidationRecord[]> {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    try {
      log("get all start");

      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const rows = (req.result as SavedGLValidationRecord[]) ?? [];
        log("get all success", { count: rows.length });
        db.close();
        resolve(rows);
      };

      req.onerror = () => {
        console.error("[glValidationDb] get all req error", req.error);
        db.close();
        reject(req.error);
      };

      tx.onabort = () => {
        console.error("[glValidationDb] get all tx abort", tx.error);
        db.close();
        reject(tx.error ?? new Error("idbGetAllGLValidations transaction aborted"));
      };
    } catch (err) {
      console.error("[glValidationDb] get all failed before tx", err);
      db.close();
      reject(err);
    }
  });
}

export async function idbDeleteGLValidation(key: string): Promise<void> {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    try {
      log("delete start", { key });

      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);

      req.onsuccess = () => {
        log("delete success", { key });
        db.close();
        resolve();
      };

      req.onerror = () => {
        console.error("[glValidationDb] delete req error", req.error);
        db.close();
        reject(req.error);
      };

      tx.onabort = () => {
        console.error("[glValidationDb] delete tx abort", tx.error);
        db.close();
        reject(tx.error ?? new Error("idbDeleteGLValidation transaction aborted"));
      };
    } catch (err) {
      console.error("[glValidationDb] delete failed before tx", err);
      db.close();
      reject(err);
    }
  });
}
