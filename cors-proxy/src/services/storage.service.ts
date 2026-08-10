import * as fs from "fs";
import * as path from "path";

// ─── Log Helper ───────────────────────────────────────────────────────────────

function log(type: "INFO" | "SUCCESS" | "ERROR" | "WARN", message: string): void {
  const time  = new Date().toISOString();
  const icons = { INFO: "📋", SUCCESS: "✅", ERROR: "❌", WARN: "⚠️ " };
  console.log(`[${time}] ${icons[type]} [STORAGE] ${message}`);
}

// ─── Base Paths ───────────────────────────────────────────────────────────────

const DATA_ROOT       = path.resolve(__dirname, "../data");
const BLUEPRINT_DIR   = path.join(DATA_ROOT, "blueprint");
const BOOTSTRAP_DIR   = path.join(DATA_ROOT, "bootstrap");
const TERMINOLOGY_DIR = path.join(DATA_ROOT, "terminology");
const VALIDATION_DIR  = path.join(DATA_ROOT, "validation");
const INDEX_FILE      = path.join(DATA_ROOT, "index.json");

// ─── Timestamp Generator ──────────────────────────────────────────────────────

function getTimestamp(): string {
  return new Date()
    .toISOString()
    .replace(/T/, "_")
    .replace(/:/g, "-")
    .split(".")[0];
}

// ─── Index Manager ────────────────────────────────────────────────────────────

interface IndexEntry {
  dealerId:   string;
  timestamp:  string;
  blueprint:  string;
  bootstrap:  string;
  validation: string;
  validated:  boolean;
  createdAt:  string;
}

function readIndex(): IndexEntry[] {
  if (!fs.existsSync(INDEX_FILE)) return [];
  return JSON.parse(fs.readFileSync(INDEX_FILE, "utf-8"));
}

function writeIndex(entries: IndexEntry[]): void {
  fs.writeFileSync(INDEX_FILE, JSON.stringify(entries, null, 2), "utf-8");
}

function upsertIndex(entry: IndexEntry): void {
  const entries = readIndex();
  const existing = entries.findIndex(
    (e) => e.dealerId === entry.dealerId && e.timestamp === entry.timestamp
  );
  if (existing >= 0) {
    entries[existing] = { ...entries[existing], ...entry };
  } else {
    entries.push(entry);
  }
  writeIndex(entries);
}

// ─── Save Blueprint ───────────────────────────────────────────────────────────

export function saveBlueprint(dealerId: string, data: unknown): string {
  const timestamp = getTimestamp();
  const fileName  = `blueprint_${dealerId}_${timestamp}.json`;
  const filePath  = path.join(BLUEPRINT_DIR, fileName);

  log("INFO",    `Saving blueprint for dealer : ${dealerId}`);
  log("INFO",    `File name                  : ${fileName}`);
  log("INFO",    `Entries                    : ${Array.isArray(data) ? (data as unknown[]).length : "unknown"}`);

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");

  log("SUCCESS", `Blueprint saved            → ${filePath}`);

  upsertIndex({
    dealerId,
    timestamp,
    blueprint:  `blueprint/${fileName}`,
    bootstrap:  "",
    validation: "",
    validated:  false,
    createdAt:  new Date().toISOString(),
  });

  log("SUCCESS", `Index updated for dealer   : ${dealerId}`);
  return filePath;
}

// ─── Save Bootstrap ───────────────────────────────────────────────────────────

export function saveBootstrap(dealerId: string, data: unknown): string {
  const timestamp = getTimestamp();
  const fileName  = `bootstrap_${dealerId}_${timestamp}.json`;
  const filePath  = path.join(BOOTSTRAP_DIR, fileName);
  const d         = data as { glAccounts?: unknown[]; costCenterSetup?: unknown[]; journals?: unknown[] };

  log("INFO",    `Saving bootstrap for dealer : ${dealerId}`);
  log("INFO",    `File name                  : ${fileName}`);
  log("INFO",    `GL Accounts                : ${d?.glAccounts?.length ?? "unknown"}`);
  log("INFO",    `Cost Centers               : ${d?.costCenterSetup?.length ?? "unknown"}`);
  log("INFO",    `Journals                   : ${d?.journals?.length ?? "unknown"}`);

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");

  log("SUCCESS", `Bootstrap saved            → ${filePath}`);

  upsertIndex({
    dealerId,
    timestamp,
    blueprint:  "",
    bootstrap:  `bootstrap/${fileName}`,
    validation: "",
    validated:  false,
    createdAt:  new Date().toISOString(),
  });

  log("SUCCESS", `Index updated for dealer   : ${dealerId}`);
  return filePath;
}

// ─── Save Validation ──────────────────────────────────────────────────────────

export function saveValidation(dealerId: string, timestamp: string, data: unknown): string {
  const fileName = `validation_${dealerId}_${timestamp}.json`;
  const filePath = path.join(VALIDATION_DIR, fileName);

  log("INFO",    `Saving validation for dealer : ${dealerId}`);
  log("INFO",    `Timestamp                   : ${timestamp}`);
  log("INFO",    `File name                   : ${fileName}`);

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");

  const entries = readIndex();
  const existing = entries.findIndex(
    (e) => e.dealerId === dealerId && e.timestamp === timestamp
  );

  if (existing >= 0) {
    entries[existing].validation = `validation/${fileName}`;
    entries[existing].validated  = true;
    writeIndex(entries);
    log("SUCCESS", `Index marked as validated   : ${dealerId} @ ${timestamp}`);
  } else {
    log("WARN",    `No index entry found        : ${dealerId} @ ${timestamp}`);
  }

  log("SUCCESS", `Validation saved            → ${filePath}`);
  return filePath;
}

// ─── Read Blueprint ───────────────────────────────────────────────────────────

export function readBlueprint(dealerId: string, timestamp: string): unknown {
  const fileName = `blueprint_${dealerId}_${timestamp}.json`;
  const filePath = path.join(BLUEPRINT_DIR, fileName);

  log("INFO", `Reading blueprint : ${fileName}`);

  if (!fs.existsSync(filePath)) {
    log("ERROR", `Blueprint not found : ${fileName}`);
    throw new Error(`Blueprint not found: ${fileName}`);
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  log("SUCCESS", `Blueprint loaded  : ${Array.isArray(data) ? data.length + " entries" : "ok"}`);
  return data;
}

// ─── Read Bootstrap ───────────────────────────────────────────────────────────

export function readBootstrap(dealerId: string, timestamp: string): unknown {
  const fileName = `bootstrap_${dealerId}_${timestamp}.json`;
  const filePath = path.join(BOOTSTRAP_DIR, fileName);

  log("INFO", `Reading bootstrap : ${fileName}`);

  if (!fs.existsSync(filePath)) {
    log("ERROR", `Bootstrap not found : ${fileName}`);
    throw new Error(`Bootstrap not found: ${fileName}`);
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
    glAccounts?: unknown[];
    costCenterSetup?: unknown[];
    journals?: unknown[];
  };

  log("SUCCESS", `Bootstrap loaded  : GL=${data?.glAccounts?.length ?? 0} | CC=${data?.costCenterSetup?.length ?? 0} | J=${data?.journals?.length ?? 0}`);
  return data;
}

// ─── Read Terminology ─────────────────────────────────────────────────────────

export function readTerminology(): unknown {
  const filePath = path.join(TERMINOLOGY_DIR, "terminology_mapping.json");

  log("INFO", `Reading terminology_mapping.json`);

  if (!fs.existsSync(filePath)) {
    log("ERROR", `terminology_mapping.json not found`);
    throw new Error("terminology_mapping.json not found");
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
    terminology_mapping?: Record<string, unknown>;
  };

  log("SUCCESS", `Terminology loaded : ${Object.keys(data?.terminology_mapping ?? {}).length} keys`);
  return data;
}

// ─── Read Validation ──────────────────────────────────────────────────────────

export function readValidation(dealerId: string, timestamp: string): unknown {
  const fileName = `validation_${dealerId}_${timestamp}.json`;
  const filePath = path.join(VALIDATION_DIR, fileName);

  log("INFO", `Reading validation : ${fileName}`);

  if (!fs.existsSync(filePath)) {
    log("ERROR", `Validation not found : ${fileName}`);
    throw new Error(`Validation not found: ${fileName}`);
  }

  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  log("SUCCESS", `Validation loaded  : ${Array.isArray(data) ? data.length + " rows" : "ok"}`);
  return data;
}

// ─── Get All Index ────────────────────────────────────────────────────────────

export function getAllIndex(): IndexEntry[] {
  log("INFO", `Reading index.json`);
  const entries = readIndex();
  log("SUCCESS", `Index loaded : ${entries.length} entries`);
  return entries;
}

// ─── Get Latest For Dealer ────────────────────────────────────────────────────

export function getLatestForDealer(dealerId: string): IndexEntry | null {
  log("INFO", `Looking up latest entry for dealer : ${dealerId}`);
  const entries = readIndex().filter((e) => e.dealerId === dealerId);

  if (!entries.length) {
    log("WARN", `No entries found for dealer : ${dealerId}`);
    return null;
  }

  const latest = entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
  log("SUCCESS", `Latest entry found : ${latest.timestamp} — validated: ${latest.validated}`);
  return latest;
}

// ─── Snapshot Directory (for GL Validation save flow) ────────────────────────
const SNAPSHOT_DIR = path.join(DATA_ROOT, "snapshots");
if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });

// ── Save a dealer bootstrap snapshot ─────────────────────────────────────────
export function saveDealerSnapshot(
  dealerId:  string,
  timestamp: string,
  bootstrap: unknown
): void {
  const dir  = path.join(SNAPSHOT_DIR, dealerId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const file = path.join(dir, `${timestamp}.json`);
  log("INFO",    `Saving snapshot  : ${dealerId} @ ${timestamp}`);
  fs.writeFileSync(
    file,
    JSON.stringify({ dealerId, timestamp, bootstrap }, null, 2),
    "utf-8"
  );
  log("SUCCESS", `Snapshot saved   → ${file}`);
}

// ── List all dealers that have snapshots ──────────────────────────────────────
export function getDealers(): string[] {
  log("INFO", `Listing dealers in snapshots dir`);
  if (!fs.existsSync(SNAPSHOT_DIR)) return [];
  const dealers = fs
    .readdirSync(SNAPSHOT_DIR)
    .filter((f) => fs.statSync(path.join(SNAPSHOT_DIR, f)).isDirectory());
  log("SUCCESS", `Found ${dealers.length} dealer(s)`);
  return dealers;
}

// ── List all timestamps for a dealer (newest first) ───────────────────────────
export function getTimestamps(dealerId: string): string[] {
  log("INFO", `Listing timestamps for dealer : ${dealerId}`);
  const dir = path.join(SNAPSHOT_DIR, dealerId);
  if (!fs.existsSync(dir)) {
    log("WARN", `No snapshot dir for dealer : ${dealerId}`);
    return [];
  }
  const timestamps = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f)    => f.replace(".json", ""))
    .sort()
    .reverse();                          // newest first
  log("SUCCESS", `Found ${timestamps.length} snapshot(s)`);
  return timestamps;
}

// ── Save blueprint by unique key (no versioning) ──────────────────────────────
export function saveBlueprintByKey(key: string, data: unknown): string {
  const safeKey  = key.replace(/[^a-zA-Z0-9_\-]/g, "");
  const fileName = `blueprint_${safeKey}.json`;
  const filePath = path.join(BLUEPRINT_DIR, fileName);

  log("INFO",    `Saving blueprint by key : ${safeKey}`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  log("SUCCESS", `Blueprint saved (key)   → ${filePath}`);
  return filePath;
}
