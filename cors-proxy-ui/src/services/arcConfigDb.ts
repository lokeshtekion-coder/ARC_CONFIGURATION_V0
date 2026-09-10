///Users/tlreddy/Desktop/ARC_CONFIGURATION_V0/cors-proxy-ui/src/services/arcConfigDb.ts
const DB_NAME = "arc-config-db";
const DB_VERSION = 4;

const BLUEPRINTS_STORE = "blueprints";
const STORES_STORE = "stores";

function createBlueprintsStore(db: IDBDatabase): void {
  if (db.objectStoreNames.contains(BLUEPRINTS_STORE)) return;
  const store = db.createObjectStore(BLUEPRINTS_STORE, { keyPath: "key" });
  store.createIndex("tekionId", "tekionId", { unique: false });
  store.createIndex("dealerId", "dealerId", { unique: false });
  store.createIndex("formName", "formName", { unique: false });
  store.createIndex("savedAt", "savedAt", { unique: false });
}

function createStoresStore(db: IDBDatabase): void {
  if (db.objectStoreNames.contains(STORES_STORE)) return;
  const store = db.createObjectStore(STORES_STORE, { keyPath: "tekion_id" });
  store.createIndex("dealer_id", "dealer_id", { unique: false });
  store.createIndex("dba_name", "dba_name", { unique: false });
  store.createIndex("launch_date", "launch_date", { unique: false });
  store.createIndex("implementation_type", "implementation_type", { unique: false });
  store.createIndex("superpod_id", "superpod_id", { unique: false });
}

function ensureRequiredStores(db: IDBDatabase): void {
  const missing: string[] = [];

  if (!db.objectStoreNames.contains(BLUEPRINTS_STORE)) missing.push(BLUEPRINTS_STORE);
  if (!db.objectStoreNames.contains(STORES_STORE)) missing.push(STORES_STORE);

  if (missing.length > 0) {
    throw new Error(`Database is missing required tables: ${missing.join(", ")}. Try clearing your browser data.`);
  }
}

export function openArcConfigDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      createBlueprintsStore(db);
      createStoresStore(db);
      console.log("🛠️ Local database upgraded successfully.");
    };

    req.onsuccess = () => {
      const db = req.result;
      try {
        ensureRequiredStores(db);
        resolve(db);
      } catch (err) {
        console.error("❌ Failed to validate local database.", err);
        db.close();
        reject(err);
      }
    };

    req.onerror = () => {
      console.error("❌ Cannot access local database. Are you in Private/Incognito mode?", req.error);
      reject(req.error);
    };

    req.onblocked = () => {
      console.warn("⚠️ Database update blocked. Please close other tabs running this application.");
    };
  });
}

export function ensureStoreExists(db: IDBDatabase, storeName: string): void {
  if (!db.objectStoreNames.contains(storeName)) {
    throw new Error(`Cannot find the "${storeName}" table in the local database.`);
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