const DB_NAME = "arc-config-db";
const DB_VERSION = 4;

const BLUEPRINTS_STORE = "blueprints";
const STORES_STORE = "stores";

function log(...args: unknown[]) {
  console.log("[arcConfigDb]", ...args);
}

function createBlueprintsStore(db: IDBDatabase): void {
  if (db.objectStoreNames.contains(BLUEPRINTS_STORE)) return;

  log("creating store", BLUEPRINTS_STORE);

  const store = db.createObjectStore(BLUEPRINTS_STORE, { keyPath: "key" });
  store.createIndex("tekionId", "tekionId", { unique: false });
  store.createIndex("dealerId", "dealerId", { unique: false });
  store.createIndex("formName", "formName", { unique: false });
  store.createIndex("savedAt", "savedAt", { unique: false });
}

function createStoresStore(db: IDBDatabase): void {
  if (db.objectStoreNames.contains(STORES_STORE)) return;

  log("creating store", STORES_STORE);

  const store = db.createObjectStore(STORES_STORE, { keyPath: "tekion_id" });
  store.createIndex("dealer_id", "dealer_id", { unique: false });
  store.createIndex("dba_name", "dba_name", { unique: false });
  store.createIndex("launch_date", "launch_date", { unique: false });
  store.createIndex("implementation_type", "implementation_type", { unique: false });
  store.createIndex("superpod_id", "superpod_id", { unique: false });
}

function ensureRequiredStores(db: IDBDatabase): void {
  const missing: string[] = [];

  if (!db.objectStoreNames.contains(BLUEPRINTS_STORE)) {
    missing.push(BLUEPRINTS_STORE);
  }

  if (!db.objectStoreNames.contains(STORES_STORE)) {
    missing.push(STORES_STORE);
  }

  if (missing.length > 0) {
    throw new Error(
      `IndexedDB "${DB_NAME}" is missing store(s): ${missing.join(", ")}`
    );
  }
}

export function openArcConfigDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    log("opening DB", { DB_NAME, DB_VERSION });

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = req.result;
      const oldVersion = event.oldVersion;
      const newVersion = db.version;

      log("onupgradeneeded", {
        oldVersion,
        newVersion,
        existingStores: Array.from(db.objectStoreNames),
      });

      createBlueprintsStore(db);
      createStoresStore(db);

      log("stores after upgrade", Array.from(db.objectStoreNames));
    };

    req.onsuccess = () => {
      const db = req.result;

      try {
        log("open success", {
          name: db.name,
          version: db.version,
          stores: Array.from(db.objectStoreNames),
        });

        ensureRequiredStores(db);
        resolve(db);
      } catch (err) {
        log("open success but validation failed", err);
        db.close();
        reject(err);
      }
    };

    req.onerror = () => {
      console.error("[arcConfigDb] open error", req.error);
      reject(req.error);
    };

    req.onblocked = () => {
      console.warn("[arcConfigDb] open blocked - close other tabs using IndexedDB");
    };
  });
}

export function ensureStoreExists(db: IDBDatabase, storeName: string): void {
  if (!db.objectStoreNames.contains(storeName)) {
    throw new Error(`IndexedDB store "${storeName}" not found in DB "${DB_NAME}"`);
  }
}

export function getArcConfigDbMeta() {
  return {
    DB_NAME,
    DB_VERSION,
    BLUEPRINTS_STORE,
    STORES_STORE,
  };
}
