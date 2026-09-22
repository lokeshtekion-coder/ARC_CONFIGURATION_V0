const DB_NAME = "arc_glam_mapping_drafts_db";
const DB_VERSION = 1;
const STORE_NAME = "mappingDrafts";

export interface GlamMappingRow {
  attributes: Record<string, string>;
  mappedAssetId: string;
  mappedDealerId: string;
  rowId: string | null;
  targetFieldToValueMapping: Record<string, string>;
}

export interface GlamMappingDraftPayload {
  module: string;
  name: string;
  criteriaList: unknown[];
  mappingColumns: string[];
  mappingList: GlamMappingRow[];
  ruleAsset: "GLACCOUNT";
}

export interface GlamMappingDraftRecord {
  key: string;
  dealerId: string;
  module: string;
  name: string;
  payload: GlamMappingDraftPayload;
  savedAt: string;
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

export function buildGlamMappingDraftKey(
  dealerId: string,
  module: string,
  name: string
): string {
  return `${normalize(dealerId)}::${normalize(module)}::${normalize(name)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export async function idbSaveGlamMappingDraft(
  dealerId: string,
  payload: GlamMappingDraftPayload
): Promise<GlamMappingDraftRecord> {
  const normalizedDealerId = normalize(dealerId);

  if (!normalizedDealerId) {
    throw new Error("Cannot save GLAM mapping draft: Dealer ID is missing.");
  }

  const record: GlamMappingDraftRecord = {
    key: buildGlamMappingDraftKey(normalizedDealerId, payload.module, payload.name),
    dealerId: normalizedDealerId,
    module: payload.module,
    name: payload.name,
    payload,
    savedAt: new Date().toISOString(),
  };

  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(record);

    request.onsuccess = () => {
      db.close();
      resolve(record);
    };

    request.onerror = () => {
      db.close();
      reject(request.error);
    };

    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? new Error("GLAM draft save transaction aborted."));
    };
  });
}

export async function idbGetGlamMappingDraft(
  dealerId: string,
  module: string,
  name: string
): Promise<GlamMappingDraftRecord | null> {
  const key = buildGlamMappingDraftKey(dealerId, module, name);
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => {
      db.close();
      resolve((request.result as GlamMappingDraftRecord) ?? null);
    };

    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}

export async function idbDeleteGlamMappingDraft(
  dealerId: string,
  module: string,
  name: string
): Promise<void> {
  const key = buildGlamMappingDraftKey(dealerId, module, name);
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(key);

    request.onsuccess = () => {
      db.close();
      resolve();
    };

    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}
