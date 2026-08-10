import {
  readBlueprint,
  readBootstrap,
  readTerminology,
  saveValidation,
} from "./storage.service";

// ─── Log Helper ───────────────────────────────────────────────────────────────

function log(type: "INFO" | "SUCCESS" | "ERROR" | "WARN", message: string): void {
  const time  = new Date().toISOString();
  const icons = { INFO: "🔍", SUCCESS: "✅", ERROR: "❌", WARN: "⚠️ " };
  console.log(`[${time}] ${icons[type]} [VALIDATION] ${message}`);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface DecodedEntry {
  sectionName:  string;
  sectionId:    string;
  fieldId:      string;
  title:        string;
  type:         string;
  required:     string;
  decodedValue: string;
}

interface GLAccount {
  key:           string;
  accountName:   string;
  accountNumber: string;
  active:        boolean;
  id:            string;
  accountTypeId: string;
}

interface BootstrapData {
  glAccounts:      GLAccount[];
  costCenterSetup: unknown[];
  journals:        unknown[];
}

interface TerminologyMapping {
  terminology_mapping: Record<string, string[]>;
  unmapped_terms:      string[];
}

export interface ValidationResult {
  decodedValue:         string;
  extractedToken:       string;
  accountNumber:        string;
  id:                   string;
  accountName:          string;
  matched:              boolean;
  accountName_Detected: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalize(value: string): string {
  return value
    .toUpperCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function extractAccountTokens(raw: string): string[] {
  const tokens = raw
    .split(/[\s,;()\[\]\/\\]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return [...new Set(tokens.filter((t) => /\d/.test(t)))];
}

function buildTerminologyLookup(
  terminology: TerminologyMapping
): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const [key, aliases] of Object.entries(terminology.terminology_mapping)) {
    lookup.set(normalize(key), key);
    for (const alias of aliases) {
      lookup.set(normalize(alias), key);
    }
  }
  return lookup;
}

function detectTerminologyKeys(
  accountName: string,
  lookup: Map<string, string>
): string[] {
  if (!accountName) return [];
  const detectedKeys = new Set<string>();
  const tokens = accountName
    .split(/[\s\-\/\\_\.&]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  for (const token of tokens) {
    const key = lookup.get(normalize(token));
    if (key) detectedKeys.add(key);
  }

  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 2; j <= Math.min(i + 4, tokens.length); j++) {
      const slice = tokens.slice(i, j);
      for (const joiner of [" ", "-"]) {
        const combo = normalize(slice.join(joiner));
        const key   = lookup.get(combo);
        if (key) detectedKeys.add(key);
      }
    }
  }

  const fullKey = lookup.get(normalize(accountName));
  if (fullKey) detectedKeys.add(fullKey);

  return [...detectedKeys];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runValidation(
  dealerId:  string,
  timestamp: string
): Promise<ValidationResult[]> {

  // ── Load Data ──────────────────────────────────────────────────────────────
  log("INFO", `──────────────────────────────────────────`);
  log("INFO", `Starting validation`);
  log("INFO", `Dealer ID            : ${dealerId}`);
  log("INFO", `Timestamp            : ${timestamp}`);
  log("INFO", `──────────────────────────────────────────`);

  const decodedEntries = readBlueprint(dealerId, timestamp) as DecodedEntry[];
  log("INFO", `Blueprint entries    : ${decodedEntries.length}`);

  const bootstrap = readBootstrap(dealerId, timestamp) as BootstrapData;
  log("INFO", `GL Accounts loaded   : ${bootstrap.glAccounts.length}`);
  log("INFO", `Cost Centers loaded  : ${(bootstrap.costCenterSetup ?? []).length}`);
  log("INFO", `Journals loaded      : ${(bootstrap.journals ?? []).length}`);

  const terminology = readTerminology() as TerminologyMapping;
  const lookup      = buildTerminologyLookup(terminology);
  log("INFO", `Terminology keys     : ${Object.keys(terminology.terminology_mapping).length}`);

  // ── Build GL Map ───────────────────────────────────────────────────────────
  const glMap = new Map<string, GLAccount>();
  for (const account of bootstrap.glAccounts) {
    glMap.set(normalize(account.accountNumber), account);
  }
  log("INFO", `GL Map built         : ${glMap.size} entries`);

  // ── Process Entries ────────────────────────────────────────────────────────
  log("INFO", `──────────────────────────────────────────`);
  log("INFO", `Processing entries...`);

  const results: ValidationResult[] = [];

  for (const entry of decodedEntries) {
    const raw = (entry.decodedValue ?? "").trim();
    if (!raw) continue;

    const tokens = extractAccountTokens(raw);

    if (tokens.length === 0) {
      results.push({
        decodedValue:         raw,
        extractedToken:       "",
        accountNumber:        "",
        id:                   "",
        accountName:          "",
        matched:              false,
        accountName_Detected: [],
      });
      continue;
    }

    for (const token of tokens) {
      const match       = glMap.get(normalize(token));
      const accountName = match?.accountName ?? "";
      results.push({
        decodedValue:         raw,
        extractedToken:       token,
        accountNumber:        match?.accountNumber ?? "",
        id:                   match?.id ?? "",
        accountName,
        matched:              !!match,
        accountName_Detected: match
          ? detectTerminologyKeys(accountName, lookup)
          : [],
      });
    }
  }

  // ── Deduplicate ────────────────────────────────────────────────────────────
  log("INFO", `Deduplicating results...`);

  const seenTokens = new Map<string, ValidationResult>();
  for (const r of results) {
    const key = normalize(r.extractedToken);
    if (!key) {
      seenTokens.set(`__no_token__${r.decodedValue}`, r);
      continue;
    }
    const existing = seenTokens.get(key);
    if (!existing) {
      seenTokens.set(key, r);
    } else {
      const currentIsStandalone  = normalize(r.decodedValue) === key;
      const existingIsStandalone = normalize(existing.decodedValue) === normalize(existing.extractedToken);
      if (currentIsStandalone && !existingIsStandalone) {
        seenTokens.set(key, r);
      }
    }
  }

  const finalResults = Array.from(seenTokens.values());

  // ── Summary ────────────────────────────────────────────────────────────────
  const matched   = finalResults.filter((r) => r.matched).length;
  const unmatched = finalResults.filter((r) => !r.matched).length;
  const withTerms = finalResults.filter((r) => r.accountName_Detected.length > 0).length;
  const matchPct  = finalResults.length > 0 ? ((matched / finalResults.length) * 100).toFixed(1) : "0.0";

  log("INFO",    `──────────────────────────────────────────`);
  log("SUCCESS", `Validation complete`);
  log("INFO",    `Total rows           : ${finalResults.length}`);
  log("SUCCESS", `Matched              : ${matched} (${matchPct}%)`);
  log("WARN",    `Unmatched            : ${unmatched}`);
  log("INFO",    `With Terminology     : ${withTerms}`);
  log("INFO",    `──────────────────────────────────────────`);

  // ── Save ───────────────────────────────────────────────────────────────────
  saveValidation(dealerId, timestamp, finalResults);

  return finalResults;
}
