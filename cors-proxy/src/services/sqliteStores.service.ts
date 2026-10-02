import Database from "better-sqlite3";
import fs from "fs";
import crypto from "crypto";
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

  CREATE TABLE IF NOT EXISTS store_change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tekion_id TEXT NOT NULL,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_change_log_tekion ON store_change_log(tekion_id);
`);

const HISTORY_DIR = path.join(BACKUP_DIR, "history");
const EXCEL_SNAPSHOT_DIR = path.join(BACKUP_DIR, "excel");
// Large/derived blobs are not worth diffing field-by-field in the change log.
const CHANGE_LOG_SKIP_FIELDS = new Set(["fetched_blueprint_tasks", "blueprint_statuses", "signoff_statuses"]);

for (const dir of [HISTORY_DIR, EXCEL_SNAPSHOT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Fields where an explicit empty value is a legitimate user action (e.g. unassigning).
const ALLOW_CLEAR_FIELDS = new Set(["custom_assignee", "setup_data_error"]);

function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/**
 * Merge an incoming store into the stored one WITHOUT losing data:
 * blank incoming values never erase stored values, and keys the incoming
 * payload does not know about are preserved.
 */
function mergeStoreRecord(existing: Record<string, any> | null, incoming: Record<string, any>) {
  if (!existing) return { merged: incoming, changes: [] as Array<{ field: string; oldValue: any; newValue: any }> };
  const merged: Record<string, any> = { ...existing };
  const changes: Array<{ field: string; oldValue: any; newValue: any }> = [];
  for (const [key, value] of Object.entries(incoming)) {
    if (isBlank(value) && !(ALLOW_CLEAR_FIELDS.has(key) && value !== undefined)) continue;
    const before = existing[key];
    if (JSON.stringify(before) !== JSON.stringify(value)) {
      if (!CHANGE_LOG_SKIP_FIELDS.has(key)) changes.push({ field: key, oldValue: before, newValue: value });
      merged[key] = value;
    }
  }
  return { merged, changes };
}

function mergeNested(a: Record<string, any> = {}, b: Record<string, any> = {}) {
  const out: Record<string, any> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])
        ? { ...a[k], ...v }
        : v;
  }
  return out;
}

let lastSnapshotHash = "";

/**
 * Snapshot the current backup file before EVERY save that would change it
 * (identical content is skipped), then thin old snapshots by age:
 *   last 30 min: keep all (max 300) | to 6 h: 1 per 10 min | to 7 d: 1 per hour | to 60 d: 1 per day
 */
function rotateHistoryBackup(): void {
  try {
    if (!fs.existsSync(BACKUP_FILE)) return;
    const content = fs.readFileSync(BACKUP_FILE);
    const hash = crypto.createHash("sha1").update(content).digest("hex");
    if (hash !== lastSnapshotHash) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.writeFileSync(path.join(HISTORY_DIR, `stores_backup_${stamp}.json`), content);
      lastSnapshotHash = hash;
    }
    pruneHistory();
  } catch (err) {
    console.warn("[sqliteStores] History backup failed:", err);
  }
}

function pruneHistory(): void {
  const now = Date.now();
  const MIN = 60_000;
  const files = fs
    .readdirSync(HISTORY_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ f, t: fs.statSync(path.join(HISTORY_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t); // newest first

  const seen = new Set<string>();
  let recentKept = 0;
  for (const { f, t } of files) {
    const age = now - t;
    let bucket: string | null;
    if (age <= 30 * MIN) {
      bucket = recentKept++ < 300 ? `recent-${f}` : null;
    } else if (age <= 6 * 60 * MIN) {
      bucket = `m10-${Math.floor(t / (10 * MIN))}`;
    } else if (age <= 7 * 24 * 60 * MIN) {
      bucket = `h-${Math.floor(t / (60 * MIN))}`;
    } else if (age <= 60 * 24 * 60 * MIN) {
      bucket = `d-${Math.floor(t / (24 * 60 * MIN))}`;
    } else {
      bucket = null;
    }
    if (bucket === null || seen.has(bucket)) {
      fs.unlinkSync(path.join(HISTORY_DIR, f));
    } else {
      seen.add(bucket);
    }
  }
}

interface SyncPayload {
  stores: any[];
  vault?: Record<string, any>;
  timeline?: Record<string, any>;
}

export function saveStoresDualSync(payload: SyncPayload): void {
  const { stores, vault, timeline } = payload;
  const now = new Date().toISOString();

  // 0. Keep a rolling history of the previous backup before touching anything.
  rotateHistoryBackup();

  const selectStore = db.prepare("SELECT data_json FROM stores WHERE tekion_id = ?");
  const insertLog = db.prepare(
    "INSERT INTO store_change_log (tekion_id, field, old_value, new_value) VALUES (?, ?, ?, ?)"
  );
  const readState = (key: string): Record<string, any> => {
    const row = db.prepare("SELECT value_json FROM app_state WHERE key = ?").get(key) as any;
    try {
      return row ? JSON.parse(row.value_json) : {};
    } catch {
      return {};
    }
  };

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
      const id = String(item.tekion_id || "");
      if (!id) continue;
      const row = selectStore.get(id) as { data_json: string } | undefined;
      let existing: Record<string, any> | null = null;
      try {
        existing = row ? JSON.parse(row.data_json) : null;
      } catch {
        existing = null;
      }

      const { merged, changes } = mergeStoreRecord(existing, item);
      for (const c of changes) {
        insertLog.run(id, c.field, JSON.stringify(c.oldValue ?? null), JSON.stringify(c.newValue ?? null));
      }

      upsertStore.run({
        tekion_id: id,
        dealer_id: String(merged.dealer_id || ""),
        dba_name: String(merged.dba_name || ""),
        launch_date: String(merged.launch_date || ""),
        data_json: JSON.stringify(merged),
      });
    }

    if (vault) {
      upsertState.run({
        key: "stores_status_vault",
        value_json: JSON.stringify(mergeNested(readState("stores_status_vault"), vault)),
      });
    }
    if (timeline) {
      upsertState.run({
        key: "stores_status_timeline",
        value_json: JSON.stringify(mergeNested(readState("stores_status_timeline"), timeline)),
      });
    }
  });

  executeBatch(stores);

  // 2. Atomic write of the FULL data set (not just the incoming subset).
  const allRows = db.prepare("SELECT data_json FROM stores ORDER BY launch_date ASC").all() as Array<{ data_json: string }>;
  const fullStores = allRows.map((r) => JSON.parse(r.data_json));
  const fileContent = JSON.stringify({
    stores: fullStores,
    vault: readState("stores_status_vault"),
    timeline: readState("stores_status_timeline"),
    updatedAt: now,
    count: fullStores.length,
  });

  fs.writeFileSync(TMP_FILE, fileContent, "utf-8");
  fs.renameSync(TMP_FILE, BACKUP_FILE);
}

export function saveExcelSnapshot(sheetName: string, rows: unknown): string {
  const safe = sheetName.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 60) || "sheet";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(EXCEL_SNAPSHOT_DIR, `${safe}__${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify({ sheetName, savedAt: new Date().toISOString(), rows }), "utf-8");
  const mine = fs.readdirSync(EXCEL_SNAPSHOT_DIR).filter((f) => f.startsWith(`${safe}__`)).sort();
  for (const old of mine.slice(0, Math.max(0, mine.length - 30))) {
    fs.unlinkSync(path.join(EXCEL_SNAPSHOT_DIR, old));
  }
  return path.basename(file);
}

export function getChangeLog(tekionId?: string, limit = 500) {
  const q = tekionId
    ? db.prepare("SELECT * FROM store_change_log WHERE tekion_id = ? ORDER BY id DESC LIMIT ?").all(tekionId, limit)
    : db.prepare("SELECT * FROM store_change_log ORDER BY id DESC LIMIT ?").all(limit);
  return q;
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

const APP_STATE_KEYS = new Set(["assignee_config", "assignment_log", "assignment_state"]);

export function getAppState(key: string): unknown {
  if (!APP_STATE_KEYS.has(key)) throw new Error("Unknown app-state key");
  const row = db.prepare("SELECT value_json FROM app_state WHERE key = ?").get(key) as any;
  return row ? JSON.parse(row.value_json) : null;
}

export function setAppState(key: string, value: unknown): void {
  if (!APP_STATE_KEYS.has(key)) throw new Error("Unknown app-state key");
  db.prepare(
    `INSERT INTO app_state (key, value_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP`
  ).run(key, JSON.stringify(value));
}
