import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve(__dirname, "../../data");
const BACKUP_DIR = path.join(DATA_DIR, "backup");
const BACKUP_FILE = path.join(BACKUP_DIR, "stores_backup.json");
const TMP_FILE = path.join(BACKUP_DIR, "stores_backup.tmp");
const DB_PATH = path.join(DATA_DIR, "stores.db");

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS stores (
    tekion_id TEXT PRIMARY KEY,
    dealer_id TEXT,
    dba_name TEXT,
    launch_date TEXT,
    data_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_stores_dealer_id ON stores(dealer_id);
`);

interface SyncPayload {
  stores: any[];
  vault?: Record<string, any>;
  timeline?: Record<string, any>;
}

export function saveStoresDualSync(payload: SyncPayload): void {
  const { stores, vault, timeline } = payload;
  const now = new Date().toISOString();

  // 1. Transactional write to SQLite
  const upsertStore = db.prepare(`
    INSERT INTO stores (tekion_id, dealer_id, dba_name, launch_date, data_json, updated_at)
    VALUES (@tekion_id, @dealer_id, @dba_name, @launch_date, @data_json, CURRENT_TIMESTAMP)
    ON CONFLICT(tekion_id) DO UPDATE SET
      dealer_id = excluded.dealer_id,
      dba_name = excluded.dba_name,
      launch_date = excluded.launch_date,
      data_json = excluded.data_json,
      updated_at = CURRENT_TIMESTAMP;
  `);

  const upsertState = db.prepare(`
    INSERT INTO app_state (key, value_json, updated_at)
    VALUES (@key, @value_json, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = CURRENT_TIMESTAMP;
  `);

  const executeBatch = db.transaction((items: any[]) => {
    for (const item of items) {
      upsertStore.run({
        tekion_id: String(item.tekion_id || ""),
        dealer_id: String(item.dealer_id || ""),
        dba_name: String(item.dba_name || ""),
        launch_date: String(item.launch_date || ""),
        data_json: JSON.stringify(item),
      });
    }

    if (vault) {
      upsertState.run({ key: "stores_status_vault", value_json: JSON.stringify(vault) });
    }
    if (timeline) {
      upsertState.run({ key: "stores_status_timeline", value_json: JSON.stringify(timeline) });
    }
  });

  executeBatch(stores);

  // 2. Atomic write to stores_backup.json
  const fileContent = JSON.stringify({
    stores,
    vault: vault || {},
    timeline: timeline || {},
    updatedAt: now,
    count: stores.length,
  });

  fs.writeFileSync(TMP_FILE, fileContent, "utf-8");
  fs.renameSync(TMP_FILE, BACKUP_FILE);
}

export function getStoresSnapshot(): {
  stores: any[];
  vault: Record<string, any>;
  timeline: Record<string, any>;
  updatedAt: string | null;
} {
  try {
    const rows = db.prepare("SELECT data_json FROM stores ORDER BY launch_date ASC").all() as Array<{ data_json: string }>;

    if (rows.length > 0) {
      const stores = rows.map((r) => JSON.parse(r.data_json));
      const vaultRow = db.prepare("SELECT value_json FROM app_state WHERE key = 'stores_status_vault'").get() as any;
      const timelineRow = db.prepare("SELECT value_json FROM app_state WHERE key = 'stores_status_timeline'").get() as any;

      return {
        stores,
        vault: vaultRow ? JSON.parse(vaultRow.value_json) : {},
        timeline: timelineRow ? JSON.parse(timelineRow.value_json) : {},
        updatedAt: new Date().toISOString(),
      };
    }
  } catch (err) {
    console.warn("[sqliteStores] SQLite read failed, attempting JSON fallback:", err);
  }

  // Fallback to stores_backup.json if SQLite is empty
  if (fs.existsSync(BACKUP_FILE)) {
    try {
      const raw = fs.readFileSync(BACKUP_FILE, "utf-8");
      return JSON.parse(raw);
    } catch {}
  }

  return { stores: [], vault: {}, timeline: {}, updatedAt: null };
}