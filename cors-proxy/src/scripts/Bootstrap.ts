import * as fs   from "fs";
import * as path from "path";

/* =========================================================
 * Raw Response Shape — zero `any`
 * ========================================================= */

interface RawOption {
  id:   string;
  name: string;
}

interface RawAccount {
  accountName:   string;
  accountNumber: string;
  active:        boolean;
  id:            string;
  accountTypeId: string;
}

interface RawCustomField {
  key:      string;
  options?: RawOption[];
}

interface RawJournal {
  id:            string;
  journalName:   string;
  journalNumber: string;
}

interface RawData {
  allAccounts: { masterAssetDocMap: Record<string, RawAccount>      };
  customField:  { masterAssetDocMap: Record<string, RawCustomField> };
  allJournals:  { masterAssetDocMap: Record<string, RawJournal>     };
}

interface RawResponse { data: RawData; }

/* =========================================================
 * Output Types
 * ========================================================= */

export interface GLAccount {
  key:           string;
  accountName:   string;
  accountNumber: string;
  active:        boolean;
  id:            string;
  accountTypeId: string;
}

export interface CostCenterOption {
  id:   string;
  name: string;
}

export interface CostCenterSetup {
  key:            string;
  customFieldKey: string;
  options:        CostCenterOption[];
}

export interface Journal {
  key:           string;
  id:            string;
  journalName:   string;
  journalNumber: string;
}

export interface BootstrapOutput {
  glAccounts:      GLAccount[];
  costCenterSetup: CostCenterSetup[];
  journals:        Journal[];
}

/* =========================================================
 * Constants
 * ========================================================= */

export const COST_CENTER_KEYS = new Set<string>([
  "DEPARTMENT",
  "REPAIR_ORDER_WARRANTY",
  "REPAIR_ORDER_CP_IW_SPLIT",
  "PARTS_SALES_ORDER_INTERNAL",
  "REPAIR_ORDER_INTERNAL",
]);

/* =========================================================
 * Validation
 * ========================================================= */

function validateRawData(response: unknown): RawData {
  const r = response as Record<string, unknown>;
  const d = r?.data as Record<string, unknown>;

  if (!d) throw new Error("Missing 'data' field in response");

  const required: Array<[string, unknown]> = [
    ["data.allAccounts",                    d.allAccounts],
    ["data.allAccounts.masterAssetDocMap",  (d.allAccounts as Record<string, unknown>)?.masterAssetDocMap],
    ["data.customField",                    d.customField],
    ["data.customField.masterAssetDocMap",  (d.customField as Record<string, unknown>)?.masterAssetDocMap],
    ["data.allJournals",                    d.allJournals],
    ["data.allJournals.masterAssetDocMap",  (d.allJournals as Record<string, unknown>)?.masterAssetDocMap],
  ];

  for (const [key, value] of required) {
    if (!value || typeof value !== "object") {
      throw new Error(`Missing or invalid: ${key}`);
    }
  }

  return d as unknown as RawData;
}

/* =========================================================
 * Extraction
 * ========================================================= */

function extractBootstrapData(inputPath: string): BootstrapOutput {
  const raw      = fs.readFileSync(inputPath, "utf-8");
  const response = JSON.parse(raw) as RawResponse;
  const data     = validateRawData(response);

  // GL Accounts — active only
  const glAccounts: GLAccount[] = Object.entries(data.allAccounts.masterAssetDocMap)
    .filter(([, account]) => account.active === true)
    .map(([mapKey, account]) => ({
      key:           mapKey,
      accountName:   account.accountName   ?? "",
      accountNumber: account.accountNumber ?? "",
      active:        account.active        ?? false,
      id:            account.id            ?? "",
      accountTypeId: account.accountTypeId ?? "",
    }));

  // Cost Centers — only keys in COST_CENTER_KEYS
  const costCenterSetup: CostCenterSetup[] = Object.entries(data.customField.masterAssetDocMap)
    .filter(([, cf]) => COST_CENTER_KEYS.has(cf.key))
    .map(([mapKey, cf]) => ({
      key:            mapKey,
      customFieldKey: cf.key ?? "",
      options:        (cf.options ?? []).map((opt) => ({
        id:   opt.id   ?? "",
        name: opt.name ?? "",
      })),
    }));

  // Journals — all
  const journals: Journal[] = Object.entries(data.allJournals.masterAssetDocMap)
    .map(([mapKey, journal]) => ({
      key:           mapKey,
      id:            journal.id            ?? "",
      journalName:   journal.journalName   ?? "",
      journalNumber: journal.journalNumber ?? "",
    }));

  return { glAccounts, costCenterSetup, journals };
}

/* =========================================================
 * CSV Builder
 * ========================================================= */

function escapeCSV(value: string | boolean | number): string {
  const str = String(value);
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

function toCSV(output: BootstrapOutput): string {
  const lines: string[] = [];

  lines.push("=== GL ACCOUNTS ===");
  lines.push("key,accountName,accountNumber,active,id,accountTypeId");
  for (const a of output.glAccounts) {
    lines.push([
      escapeCSV(a.key), escapeCSV(a.accountName), escapeCSV(a.accountNumber),
      escapeCSV(a.active), escapeCSV(a.id), escapeCSV(a.accountTypeId),
    ].join(","));
  }

  lines.push("");
  lines.push("=== COST CENTER SETUP ===");
  lines.push("key,customFieldKey,optionId,optionName");
  for (const cc of output.costCenterSetup) {
    if (cc.options.length === 0) {
      lines.push([escapeCSV(cc.key), escapeCSV(cc.customFieldKey), "", ""].join(","));
    } else {
      for (const opt of cc.options) {
        lines.push([
          escapeCSV(cc.key), escapeCSV(cc.customFieldKey),
          escapeCSV(opt.id), escapeCSV(opt.name),
        ].join(","));
      }
    }
  }

  lines.push("");
  lines.push("=== JOURNALS ===");
  lines.push("key,id,journalName,journalNumber");
  for (const j of output.journals) {
    lines.push([
      escapeCSV(j.key), escapeCSV(j.id),
      escapeCSV(j.journalName), escapeCSV(j.journalNumber),
    ].join(","));
  }

  return lines.join("\n");
}

/* =========================================================
 * Run
 * ========================================================= */

const INPUT_FILE  = path.resolve(__dirname, "bootstrapresponse.json");
const OUTPUT_JSON = path.resolve(__dirname, "bootstrap.json");
const OUTPUT_CSV  = path.resolve(__dirname, "bootstrap.csv");

try {
  console.log("📂 Reading:", INPUT_FILE);
  const result = extractBootstrapData(INPUT_FILE);

  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(result, null, 2), "utf-8");
  console.log(
    `✅ bootstrap.json — ${result.glAccounts.length} GL accounts, ` +
    `${result.costCenterSetup.length}/${COST_CENTER_KEYS.size} cost center keys, ` +
    `${result.journals.length} journals`
  );

  fs.writeFileSync(OUTPUT_CSV, toCSV(result), "utf-8");
  console.log("✅ bootstrap.csv written");

  // Per-key status
  console.log("\n── Cost Center Keys ──────────────────────────────────");
  const foundKeys = new Set(result.costCenterSetup.map((cc) => cc.customFieldKey));
  for (const key of COST_CENTER_KEYS) {
    const found = foundKeys.has(key);
    const entry = result.costCenterSetup.find((cc) => cc.customFieldKey === key);
    console.log(
      `  ${found ? "✅" : "❌"} ${key.padEnd(34)}` +
      (found ? `→ ${entry!.options.length} options` : "(not found in data)")
    );
  }

  console.log("\n── Journals ──────────────────────────────────────────");
  result.journals.forEach((j) =>
    console.log(`  ${j.journalName.padEnd(30)} ${j.journalNumber}  →  ${j.id}`)
  );

} catch (err) {
  console.error("❌ Error:", err);
  process.exit(1);
}
