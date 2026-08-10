import { ensureStoreExists, getArcConfigDbMeta, openArcConfigDb } from "../services/arcConfigDb";

export interface BlueprintRecord {
  key: string;
  tekionId?: string;
  dealerId?: string;
  dealerName?: string;
  formName?: string;
  formId?: string;
  releaseId?: string;
  status?: string;
  rawResponse?: unknown;
  decodedResponse?: unknown;
  data?: unknown;
  savedAt: string;
}

const { BLUEPRINTS_STORE: STORE_NAME } = getArcConfigDbMeta();

function log(...args: unknown[]) {
  console.log("[blueprintDb]", ...args);
}

export async function idbSaveBlueprint(record: BlueprintRecord): Promise<void> {
  const db = await openArcConfigDb();

  return new Promise<void>((resolve, reject) => {
    try {
      ensureStoreExists(db, STORE_NAME);

      log("save blueprint start", {
        key: record.key,
        dealerId: record.dealerId,
        tekionId: record.tekionId,
        formName: record.formName,
      });

      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.put(record);

      tx.oncomplete = () => {
        log("save blueprint complete", { key: record.key });
        db.close();
        resolve();
      };

      tx.onerror = () => {
        console.error("[blueprintDb] save blueprint tx error", tx.error);
        db.close();
        reject(tx.error);
      };

      tx.onabort = () => {
        console.error("[blueprintDb] save blueprint tx abort", tx.error);
        db.close();
        reject(tx.error ?? new Error("idbSaveBlueprint transaction aborted"));
      };
    } catch (err) {
      console.error("[blueprintDb] save blueprint failed before tx", err);
      db.close();
      reject(err);
    }
  });
}

export async function idbGetBlueprint(key: string): Promise<BlueprintRecord | undefined> {
  const db = await openArcConfigDb();

  return new Promise((resolve, reject) => {
    try {
      ensureStoreExists(db, STORE_NAME);

      log("get blueprint start", { key });

      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);

      req.onsuccess = () => {
        log("get blueprint success", {
          key,
          found: Boolean(req.result),
        });
        db.close();
        resolve(req.result as BlueprintRecord | undefined);
      };

      req.onerror = () => {
        console.error("[blueprintDb] get blueprint req error", req.error);
        db.close();
        reject(req.error);
      };

      tx.onabort = () => {
        console.error("[blueprintDb] get blueprint tx abort", tx.error);
        db.close();
        reject(tx.error ?? new Error("idbGetBlueprint transaction aborted"));
      };
    } catch (err) {
      console.error("[blueprintDb] get blueprint failed before tx", err);
      db.close();
      reject(err);
    }
  });
}

export async function idbGetAllBlueprints(): Promise<BlueprintRecord[]> {
  const db = await openArcConfigDb();

  return new Promise((resolve, reject) => {
    try {
      ensureStoreExists(db, STORE_NAME);

      log("get all blueprints start");

      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const rows = (req.result as BlueprintRecord[]) ?? [];
        log("get all blueprints success", { count: rows.length });
        db.close();
        resolve(rows);
      };

      req.onerror = () => {
        console.error("[blueprintDb] get all blueprints req error", req.error);
        db.close();
        reject(req.error);
      };

      tx.onabort = () => {
        console.error("[blueprintDb] get all blueprints tx abort", tx.error);
        db.close();
        reject(tx.error ?? new Error("idbGetAllBlueprints transaction aborted"));
      };
    } catch (err) {
      console.error("[blueprintDb] get all blueprints failed before tx", err);
      db.close();
      reject(err);
    }
  });
}
