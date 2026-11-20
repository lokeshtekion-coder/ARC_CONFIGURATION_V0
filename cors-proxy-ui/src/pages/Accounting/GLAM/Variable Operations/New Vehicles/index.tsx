import React, { useCallback, useEffect, useMemo, useState } from "react";
import { GlamSectionHeader } from "../../components/glamShared";
import { idbGetAllBootstraps } from "../../../../../utils/bootstrapDb";
import { loadGlobalHeaders } from "../../../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../../../types/proxy.types";
import makeModelsRaw from "../../../../../terminology/MAKE_MODELS_DATA.json";
import terminologyMapRaw from "../../../../../terminology/terminology_mapping.json" with { type: "json" };
import "./index.css"; // Added import

type MakeModelsEntry = {
  Makes?: string;
  IncludeAny?: string[];
  models?: string[];
};

type TerminologyRule = {
  targetMapping?: string;
  includeAny?: string[];
  exclude?: string[];
};

type TerminologyPayload =
  | TerminologyRule[]
  | {
      terminology_mapping?: TerminologyRule[];
      unmapped_terms?: string[];
    };

type BootstrapRecordLite = {
  key: string;
  dealerName: string;
  envName: string;
  data: unknown;
  savedAt: string;
  [key: string]: unknown;
};

type SalesChainDecodedRow = {
  id?: string | null;
  __entryKey?: string | null;
  __source?: string | null;
  accountingChainType?: string | null;

  saleAccountId?: string | null;
  saleAccountId_Name?: string | null;
  saleAccountId_Number?: string | null;
  saleAccountId_Type?: string | null;

  costOfSaleAccountId?: string | null;
  costOfSaleAccountId_Name?: string | null;
  costOfSaleAccountId_Number?: string | null;
  costOfSaleAccountId_Type?: string | null;

  costOffsetAccountId?: string | null;
  costOffsetAccountId_Name?: string | null;
  costOffsetAccountId_Number?: string | null;
  costOffsetAccountId_Type?: string | null;

  [key: string]: unknown;
};

type ExistingRuleSummary = {
  id: string;
  module: string;
  name: string;
  raw: unknown;
};

type CandidateSaleAccount = {
  saleAccountId: string;
  saleAccountId_Number: string;
  saleAccountId_Name: string;
  costOffsetAccountId: string;
  costOffsetAccountId_Name: string;
  detectedBodyClasses: string[];
  detectedMake: string;
  detectedMakeReason: string;
  detectedModelHints: string[];
};

type CostOffsetBucket = {
  costOffsetAccountId: string;
  costOffsetAccountName: string;
  bucketRows: SalesChainDecodedRow[];
};

type MakePayloadPlan = {
  make: string;
  ruleName: string;
  candidateSaleAccounts: CandidateSaleAccount[];
  modelMatches: ModelMatchRow[];
  payload: Record<string, unknown>;
};

type ModelMatchRow = {
  model: string;
  make: string;
  mappedAssetId: string;
  saleAccountId: string;
  saleAccountId_Number: string;
  saleAccountId_Name: string;
  costOffsetAccountId: string;
  costOffsetAccountId_Name: string;
  matched: boolean;
  matchReason: string;
  sortBucket: 0 | 1;
  bodyClasses: string[];
};

type BuildResult = {
  dealerId: string;
  metadataMakes: string[];
  resolvedMakes: string[];
  ruleName: string;
  existingRule: ExistingRuleSummary | null;
  costOffsetBuckets: CostOffsetBucket[];
  bucketRows: SalesChainDecodedRow[];
  makePlans: MakePayloadPlan[];
  modelMatches: ModelMatchRow[];
  payloads: Array<{
    make: string;
    ruleName: string;
    payload: Record<string, unknown>;
  }>;
  warnings: string[];
  /** Sale account id -> reason it could not be mapped because the model is already taken. */
  duplicateNotes: Record<string, string>;
};

type MakeAliasEntry = {
  canonicalMake: string;
  aliases: string[];
  models: string[];
};

const makeModelsData = (makeModelsRaw as MakeModelsEntry[]) ?? [];

const rawTerminology = terminologyMapRaw as TerminologyPayload;
const terminologyRules: TerminologyRule[] = Array.isArray(rawTerminology)
  ? rawTerminology
  : rawTerminology?.terminology_mapping ?? [];

const GET_RULES_URL =
  "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/rule/asset/GLACCOUNT";
const CREATE_RULE_URL =
  "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/rule";
const GET_METADATA_URL =
  "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/metadata";

const GENERIC_MODEL_IGNORE = new Set([
  "CHEVY", "CHEVROLET", "CHEV", "GM", "GMC", "FORD", "TOYOTA", "HONDA", "KIA",
  "CAR", "CARS", "TRUCK", "TRUCKS", "VAN", "VANS", "WAGON", "AUTO",
  "NEW", "USED", "PREOWNED", "VEHICLE", "VEHICLES", "CLASSIC", "HD", "LD"
]);

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeUpper(value: unknown): string {
  return normalize(value).toUpperCase();
}

function normalizeLoose(value: unknown): string {
  return normalize(value)
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[.,/_-]+/g, " ")
    .replace(/\bRET\b/g, " RETAIL ")
    .replace(/\bRETAI\b/g, " RETAIL ")
    .replace(/\bRTL\b/g, " RETAIL ")
    .replace(/\bSLS\b/g, " SALES ")
    .replace(/\bCOMP\b/g, " COMP ")
    .replace(/\bN\/C\b/g, " NEW CAR ")
    .replace(/\bN C\b/g, " NEW CAR ")
    .replace(/\bNC\b/g, " NEW CAR ")
    .replace(/\bN\/T\b/g, " NEW TRUCK ")
    .replace(/\bN T\b/g, " NEW TRUCK ")
    .replace(/\bNT\b/g, " NEW TRUCK ")
    .replace(/\bU\/C\b/g, " USED CAR ")
    .replace(/\bU C\b/g, " USED CAR ")
    .replace(/\bUC\b/g, " USED CAR ")
    .replace(/\bU\/T\b/g, " USED TRUCK ")
    .replace(/\bU T\b/g, " USED TRUCK ")
    .replace(/\bUT\b/g, " USED TRUCK ")
    .replace(/\bTRKS\b/g, " TRUCKS ")
    .replace(/\bTRK\b/g, " TRUCK ")
    .replace(/\bCHEVY\b/g, " CHEVROLET ")
    .replace(/\bCHEV\b/g, " CHEVROLET ")
    .replace(/\bGM\b/g, " GENERAL MOTORS ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeModelAlias(value: string): string {
  return normalizeLoose(value)
    .replace(/\bPLUG IN\b/g, " PLUG-IN ")
    .replace(/\b5 DOOR\b/g, " 5-DOOR ")
    .replace(/\s+/g, " ")
    .trim();
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toEnabledHeaderMap(headers: KeyValuePair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of headers) {
    if (!row?.enabled) continue;
    const key = normalize(row.key);
    const value = normalize(row.value);
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function findHeaderValueCaseInsensitive(
  headers: Record<string, string>,
  candidates: string[]
): string | null {
  const entries = Object.entries(headers);
  for (const candidate of candidates) {
    const found = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
    if (found && normalize(found[1])) {
      return normalize(found[1]);
    }
  }
  return null;
}

function extractDealerIdFromHeaders(headers: Record<string, string>): string | null {
  return findHeaderValueCaseInsensitive(headers, [
    "dealerid",
    "dealerId",
    "dealer-id",
    "x-dealer-id",
  ]);
}

function getBootstrapDealerId(record: BootstrapRecordLite): string {
  const raw = record.data as any;

  const directDealerId = normalize(raw?.dealerId);
  if (directDealerId) return directDealerId;

  const nestedDealerId = normalize(raw?.data?.dealerId);
  if (nestedDealerId) return nestedDealerId;

  const allAccountsKey = Object.keys(raw?.allAccounts?.dealerAssetDocMap ?? {})[0];
  if (allAccountsKey) return normalize(allAccountsKey);

  const nestedAllAccountsKey = Object.keys(raw?.data?.allAccounts?.dealerAssetDocMap ?? {})[0];
  if (nestedAllAccountsKey) return normalize(nestedAllAccountsKey);

  return normalize(record.key);
}

function getBestBootstrapForDealer(
  records: BootstrapRecordLite[],
  dealerId: string
): BootstrapRecordLite | null {
  const normalizedDealerId = normalize(dealerId);
  const matches = records.filter((record) => getBootstrapDealerId(record) === normalizedDealerId);

  if (matches.length === 0) return null;

  matches.sort((a, b) => normalize(b.savedAt).localeCompare(normalize(a.savedAt)));
  return matches[0] ?? null;
}

function getSalesChainsDecodedRows(record: BootstrapRecordLite | null): SalesChainDecodedRow[] {
  if (!record) return [];

  const raw = record.data as any;
  const candidates = [
    raw?.SalesChains_Decoded,
    raw?.data?.SalesChains_Decoded,
    raw?.body?.SalesChains_Decoded,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate as SalesChainDecodedRow[];
    }
  }

  return [];
}

function containsLoose(haystack: string, needle: string): boolean {
  const h = ` ${normalizeLoose(haystack)} `;
  const n = ` ${normalizeLoose(needle)} `;
  return Boolean(n.trim()) && h.includes(n);
}

function buildMatchedCostOffsetBuckets(rows: SalesChainDecodedRow[]): CostOffsetBucket[] {
  const buckets = new Map<string, CostOffsetBucket>();

  for (const row of rows) {
    const type = normalizeUpper(row.accountingChainType || "salesChain");
    const isSalesChain = type === "SALESCHAIN" || type === "SALES_CHAIN" || type === "";
    if (!isSalesChain) continue;

    const id = normalize(row.costOffsetAccountId);
    const rawName = normalize(row.costOffsetAccountId_Name);
    if (!id || !rawName) continue;

    const name = normalizeLoose(rawName);

    const isNew = containsLoose(name, "NEW");
    const isVehicleClass =
      containsLoose(name, "VEHICLE") ||
      containsLoose(name, "VEHICLES") ||
      containsLoose(name, "CAR") ||
      containsLoose(name, "CARS") ||
      containsLoose(name, "TRUCK") ||
      containsLoose(name, "TRUCKS") ||
      containsLoose(name, "VAN") ||
      containsLoose(name, "VANS") ||
      containsLoose(name, "SUV") ||
      containsLoose(name, "SUVS");

    if (!isNew || !isVehicleClass) continue;

    if (
      containsLoose(name, "USED") ||
      containsLoose(name, "PREOWNED") ||
      containsLoose(name, "PRE OWNED")
    ) {
      continue;
    }

    const bucket = buckets.get(id) ?? {
      costOffsetAccountId: id,
      costOffsetAccountName: rawName,
      bucketRows: [],
    };

    bucket.bucketRows.push(row);
    buckets.set(id, bucket);
  }

  return Array.from(buckets.values());
}

function getMakeAliasEntries(): MakeAliasEntry[] {
  const rows: MakeAliasEntry[] = [];

  for (const entry of makeModelsData) {
    const canonicalMake = normalize(entry.Makes);
    if (!canonicalMake) continue;

    const aliases = Array.from(
      new Set(
        [canonicalMake, ...(Array.isArray(entry.IncludeAny) ? entry.IncludeAny : [])]
          .map((v) => normalize(v))
          .filter(Boolean)
      )
    );

    const models = (Array.isArray(entry.models) ? entry.models : [])
      .map((v) => normalize(v))
      .filter(Boolean);

    rows.push({
      canonicalMake,
      aliases,
      models,
    });
  }

  return rows;
}

function getAllModelsWithMakes(): Array<{ make: string; model: string }> {
  const rows: Array<{ make: string; model: string }> = [];

  for (const entry of makeModelsData) {
    const make = normalize(entry.Makes);
    const models = Array.isArray(entry.models) ? entry.models : [];

    for (const model of models) {
      const normalizedModel = normalize(model);
      if (!normalizedModel) continue;
      rows.push({ make, model: normalizedModel });
    }
  }

  const deduped = new Map<string, { make: string; model: string }>();
  for (const row of rows) {
    const key = `${normalizeUpper(row.make)}__${normalizeUpper(row.model)}`;
    if (!deduped.has(key)) {
      deduped.set(key, row);
    }
  }

  return Array.from(deduped.values());
}

function buildMappedAssetId(dealerId: string, saleAccountId: string, saleAccountNumber: string): string {
  if (normalize(saleAccountId)) return normalize(saleAccountId);
  if (normalize(saleAccountNumber)) return `${dealerId}_${normalize(saleAccountNumber)}`;
  return "";
}

function generateRowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function looksLikeNewVehicleRuleName(name: string): boolean {
  const lowered = normalize(name).toLowerCase();
  if (!lowered) return false;
  const hasNew = lowered.includes("new");
  const hasVehicle = lowered.includes("vehicle") || lowered.includes("vehicles");
  return hasNew || hasVehicle;
}

function extractRulesPayloadArray(payload: unknown): unknown[] {
  const obj = asObject(payload);
  if (!obj) return [];

  const body = obj.body;
  const data = obj.data;

  if (Array.isArray(data)) return data;
  if (Array.isArray(body)) return body;

  const bodyObj = asObject(body);
  if (bodyObj && Array.isArray(bodyObj.data)) return bodyObj.data as unknown[];

  const dataObj = asObject(data);
  if (dataObj && Array.isArray(dataObj.data)) return dataObj.data as unknown[];

  return [];
}

function findExistingNewVehicleRule(payload: unknown): ExistingRuleSummary | null {
  const rows = extractRulesPayloadArray(payload);

  for (const item of rows) {
    const obj = asObject(item);
    if (!obj) continue;

    const moduleName = normalize(obj.module);
    const name = normalize(obj.name);
    const id = normalize(obj.id);

    if (moduleName !== "NEW_VEHICLE") continue;
    if (!looksLikeNewVehicleRuleName(name)) continue;
    if (!id) continue;

    return {
      id,
      module: moduleName,
      name,
      raw: obj,
    };
  }

  return null;
}

function extractMetadataMakes(payload: unknown): string[] {
  const obj = asObject(payload);
  const root = asObject(obj?.body) ?? asObject(obj?.data) ?? obj;
  const data = asObject(root?.data) ?? root;

  const makesCandidate = data?.makes;
  if (!Array.isArray(makesCandidate)) return [];

  const values = makesCandidate
    .map((item) => {
      if (typeof item === "string") return normalize(item);

      const row = asObject(item);
      return (
        normalize(row?.value) ||
        normalize(row?.name) ||
        normalize(row?.label) ||
        normalize(row?.make) ||
        normalize(row?.code)
      );
    })
    .filter(Boolean);

  return Array.from(new Set(values));
}

function findTerminologyRule(targetMapping: string): TerminologyRule | null {
  return (
    terminologyRules.find(
      (rule) => normalizeUpper(rule.targetMapping) === normalizeUpper(targetMapping)
    ) ?? null
  );
}

function ruleMatchesText(rule: TerminologyRule | null, text: string): boolean {
  if (!rule) return false;

  const haystack = normalizeLoose(text);
  const includeAny = Array.isArray(rule.includeAny) ? rule.includeAny : [];
  const exclude = Array.isArray(rule.exclude) ? rule.exclude : [];

  const included =
    includeAny.length > 0 &&
    includeAny.some((term) => containsLoose(haystack, normalizeLoose(term)));

  if (!included) return false;

  const hasExcluded = exclude.some((term) => containsLoose(haystack, normalizeLoose(term)));
  if (hasExcluded) return false;

  return true;
}

function detectBodyClassesFromSaleAccountName(name: string): string[] {
  const classes = new Set<string>();

  const carRule = findTerminologyRule("Car");
  const truckRule = findTerminologyRule("Truck/Van");

  if (ruleMatchesText(carRule, name)) {
    classes.add("Car");
  }

  if (ruleMatchesText(truckRule, name)) {
    classes.add("Truck/Van");
    classes.add("SUV");
  }

  return Array.from(classes);
}

function detectCanonicalMakeFromAccountName(name: string): {
  canonicalMake: string;
  reason: string;
} {
  const aliasEntries = getMakeAliasEntries();
  const saleName = normalizeLoose(name);

  let bestMake = "";
  let bestReason = "";
  let bestLen = -1;

  for (const entry of aliasEntries) {
    const allAliases = Array.from(new Set([entry.canonicalMake, ...entry.aliases]));
    for (const alias of allAliases) {
      const aliasLoose = normalizeLoose(alias);
      if (!aliasLoose) continue;

      if (containsLoose(saleName, aliasLoose) && aliasLoose.length > bestLen) {
        bestLen = aliasLoose.length;
        bestMake = entry.canonicalMake;
        bestReason = `makeAlias:${alias}`;
      }
    }
  }

  return {
    canonicalMake: bestMake,
    reason: bestReason,
  };
}

function buildGenericModelAliases(model: string): string[] {
  const base = normalize(model);
  const loose = normalizeModelAlias(base);
  const aliases = new Set<string>();

  if (!loose) return [];

  aliases.add(loose);
  aliases.add(loose.replace(/-/g, " "));
  aliases.add(loose.replace(/\s+/g, " ").trim());

  const compact = loose
    .replace(/\bPLUG IN\b/g, "PLUGIN")
    .replace(/\bPLUG-IN\b/g, "PLUGIN")
    .replace(/\b5 DOOR\b/g, "5DOOR")
    .replace(/\b5-DOOR\b/g, "5DOOR")
    .replace(/\s+/g, " ")
    .trim();
  aliases.add(compact);

  const tokens = loose.split(" ").filter(Boolean);

  if (tokens.length > 1) {
    aliases.add(tokens.join(" "));
  }

  const withoutMarketingWords = tokens.filter(
    (token) =>
      token !== "HYBRID" &&
      token !== "PLUGIN" &&
      token !== "PLUG" &&
      token !== "IN" &&
      token !== "EV" &&
      token !== "PHEV"
  );

  if (withoutMarketingWords.length > 0) {
    aliases.add(withoutMarketingWords.join(" "));
  }

  if (tokens.length > 0) {
    const firstToken = tokens[0];
    if (firstToken.length > 2 && !GENERIC_MODEL_IGNORE.has(normalizeUpper(firstToken))) {
      aliases.add(firstToken);
    }
  }

  if (withoutMarketingWords.length > 0) {
    const firstNoMarketing = withoutMarketingWords[0];
    if (firstNoMarketing.length > 2 && !GENERIC_MODEL_IGNORE.has(normalizeUpper(firstNoMarketing))) {
      aliases.add(firstNoMarketing);
    }
  }

  const numericNormalized = loose
    .replace(/\b(\d+)\s+HD\b/g, "$1HD")
    .replace(/\b(\d+)\s+DOOR\b/g, "$1DOOR")
    .trim();
  aliases.add(numericNormalized);

  const decompacted = loose
    .replace(/\b(\d+)HD\b/g, "$1 HD")
    .replace(/\b(\d+)DOOR\b/g, "$1 DOOR")
    .trim();
  aliases.add(decompacted);

  return Array.from(aliases)
    .map((v) => normalizeModelAlias(v))
    .filter((v) => {
      const upper = normalizeUpper(v);
      if (GENERIC_MODEL_IGNORE.has(upper)) return false;
      if (upper.length < 3 && !/^\d+$/.test(upper)) return false;
      return true;
    });
}

function getModelAliases(model: string): string[] {
  return Array.from(new Set(buildGenericModelAliases(model)));
}

function extractModelHintsFromAccountName(name: string, canonicalMake: string): string[] {
  const normalizedName = normalizeLoose(name);
  const makeModels = getAllModelsWithMakes().filter(
    (row) => normalizeUpper(row.make) === normalizeUpper(canonicalMake)
  );

  const hits = new Set<string>();

  const aliasesToRows: Array<{ model: string; alias: string }> = [];
  for (const row of makeModels) {
    for (const alias of getModelAliases(row.model)) {
      aliasesToRows.push({ model: row.model, alias: normalizeModelAlias(alias) });
    }
  }

  aliasesToRows.sort((a, b) => b.alias.length - a.alias.length);

  for (const entry of aliasesToRows) {
    if (containsLoose(normalizedName, entry.alias)) {
      hits.add(entry.model);
    }
  }

  return Array.from(hits);
}

function uniqueCandidateSaleAccounts(bucketRows: SalesChainDecodedRow[]): CandidateSaleAccount[] {
  const map = new Map<string, CandidateSaleAccount>();

  for (const row of bucketRows) {
    const saleAccountId = normalize(row.saleAccountId);
    const saleAccountId_Number = normalize(row.saleAccountId_Number);
    const saleAccountId_Name = normalize(row.saleAccountId_Name);
    const costOffsetAccountId = normalize(row.costOffsetAccountId);

    // "TBD" and "Discontinued" in the name already say the account is not a live model.
    if (/\b(TBD|DISCONTINUED)\b/i.test(saleAccountId_Name)) continue;
    const costOffsetAccountId_Name = normalize(row.costOffsetAccountId_Name);

    if (!saleAccountId && !saleAccountId_Number && !saleAccountId_Name) continue;

    const detectedMake = detectCanonicalMakeFromAccountName(saleAccountId_Name);
    const detectedModelHints = detectedMake.canonicalMake
      ? extractModelHintsFromAccountName(saleAccountId_Name, detectedMake.canonicalMake)
      : [];

    const key = `${saleAccountId}__${saleAccountId_Number}__${saleAccountId_Name}`;
    if (!map.has(key)) {
      map.set(key, {
        saleAccountId,
        saleAccountId_Number,
        saleAccountId_Name,
        costOffsetAccountId,
        costOffsetAccountId_Name,
        detectedBodyClasses: detectBodyClassesFromSaleAccountName(saleAccountId_Name),
        detectedMake: detectedMake.canonicalMake,
        detectedMakeReason: detectedMake.reason,
        detectedModelHints,
      });
    }
  }

  return Array.from(map.values());
}

// ----------------------------------------------------------------------
// Account name -> model scoring (token based, handles short-form GL names)
// ----------------------------------------------------------------------

const ACCOUNT_NOISE_TOKENS = new Set([
  "SALES", "SALE", "SLS", "RETAIL", "RET", "NEW", "USED", "CAR", "CARS", "VEHICLE", "VEHICLES",
  "TRUCK", "TRUCKS", "SUV", "SUVS", "VAN", "VANS", "GL", "ACCT", "ACCOUNT", "ACCOUNTS",
  "OFFSET", "COST", "INCOME", "AND", "THE", "OF", "FOR",
]);

const MODEL_NOISE_TOKENS = new Set(["HYBRID", "PLUGIN", "PLUG", "IN", "EV", "PHEV", "ALL"]);

/** Words of a sale account name. A leading GL number (e.g. "425A - SALES - ...") is dropped. */
function accountNameTokens(name: string): string[] {
  const tokens = normalizeLoose(name)
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(" ")
    .filter(Boolean);

  if (tokens.length > 1 && /^\d{3,}[A-Z]?$/.test(tokens[0])) {
    tokens.shift();
  }

  return tokens.filter((t) => t.length >= 2 && !ACCOUNT_NOISE_TOKENS.has(t));
}

/** Deal type from the account name. A model is claimed once per deal type (sale vs lease). */
function dealTypeOf(name: string): string {
  const n = normalizeLoose(name);
  if (/\bONE\s*TIME\s*LEASE\b/.test(n)) return "ONE_TIME_LEASE";
  if (/\bLEASE\b/.test(n)) return "LEASE";
  if (/\b(SALE|SALES|RETAIL|RET)\b/.test(n)) return "SALE";
  return "OTHER";
}

/** PAYMENT_TYPE_VAR_OPS value for a sale account: lease accounts get LEASE / ONE_TIME_LEASE, everything else ALL. */
function paymentTypeOf(name: string): "ALL" | "LEASE" | "ONE_TIME_LEASE" {
  const n = normalizeLoose(name);
  if (/\bONE\s*TIME\s*LEASE\b/.test(n)) return "ONE_TIME_LEASE";
  if (/\bLEASE\b/.test(n)) return "LEASE";
  return "ALL";
}

function modelTokensOf(model: string): string[] {
  return normalizeLoose(model)
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(" ")
    .filter((t) => t.length >= 2 && !MODEL_NOISE_TOKENS.has(t) && !GENERIC_MODEL_IGNORE.has(t));
}

/**
 * Scores how well a sale account name points at a model.
 * - exact word match: +3 (number +4)
 * - short form (name word is the start of the model word, e.g. SILV -> SILVERADO): +2
 * - model number missing from the name: -1 (still allowed, lower priority)
 * - number in the name that the model does not carry (e.g. 2500 vs 1500): -2
 * - whole model text found in name (or compact form, e.g. F150 for F-150): bonus
 * Returns null when nothing relevant matches.
 */
function scoreModelForAccount(
  nameTokens: string[],
  nameLoose: string,
  model: string
): { score: number; notes: string[] } | null {
  const mTokens = modelTokensOf(model);
  if (mTokens.length === 0) return null;

  const primary = mTokens.find((tok) => !/^\d/.test(tok));
  const covered = new Set<string>();
  const notes: string[] = [];
  let score = 0;

  // Whole-word matches first. A word may also match as a short form (name word is the start of
  // the model word, e.g. SILV -> SILVERADO), but only for words of 3+ letters.
  for (const mt of mTokens) {
    const isNumber = /^\d/.test(mt);
    if (nameTokens.includes(mt)) {
      score += isNumber ? 4 : 3;
      covered.add(mt);
      notes.push(`exact ${mt}`);
    } else if (!isNumber) {
      const shortForm = nameTokens.find((nt) => nt.length >= 3 && mt.startsWith(nt));
      if (shortForm) {
        score += 2;
        covered.add(mt);
        notes.push(`short ${shortForm}→${mt}`);
      }
    } else {
      score -= 1;
      notes.push(`no ${mt} in name`);
    }
  }

  // Compact form (e.g. C-Max -> CMAX, F-150 -> F150) must equal a run of whole name words.
  const modelCompact = normalizeLoose(model).replace(/[^A-Z0-9]/g, "");
  if (modelCompact.length >= 3 && !covered.size) {
    for (let i = 0; i < nameTokens.length; i++) {
      let joined = "";
      for (let j = i; j < nameTokens.length; j++) {
        joined += nameTokens[j];
        if (joined === modelCompact) {
          mTokens.forEach((tok) => covered.add(tok));
          if (primary) covered.add(primary);
          score += 3;
          notes.push(`compact ${modelCompact}`);
          break;
        }
        if (joined.length > modelCompact.length) break;
      }
      if (covered.size) break;
    }
  }

  // Coverage rule: the model's main word must be in the name. Otherwise the model is not a candidate.
  if (primary && !covered.has(primary)) return null;

  // Other words of the model that the name does not carry lower the score (not excluded).
  for (const mt of mTokens) {
    if (!/^\d/.test(mt) && !covered.has(mt)) {
      score -= 2;
      notes.push(`missing ${mt}`);
    }
  }

  if (containsLoose(nameLoose, model)) {
    score += 5;
    notes.push("full phrase");
  }

  // Numbers in the name that the model does not carry (e.g. 2500 vs 1500) are a conflict.
  for (const nt of nameTokens) {
    if (/^\d{3,}/.test(nt) && !mTokens.includes(nt)) {
      score -= 2;
      notes.push(`conflict ${nt}`);
    }
  }

  if (score <= 0) return null;
  return { score, notes };
}

// ----------------------------------------------------------------------
// Review store (good / bad per account-model pair), saved in local storage
// ----------------------------------------------------------------------

type ReviewVerdict = "good" | "bad";

type ReviewEntry = {
  verdict: ReviewVerdict;
  make: string;
  model: string;
  saleAccountId: string;
  saleAccountNumber: string;
  saleAccountName: string;
  at: string;
};

type ReviewOverride = {
  make: string;
  model: string;
  saleAccountName: string;
  saleAccountNumber: string;
  at: string;
};

type ReviewStore = {
  version: 1;
  updatedAt: string;
  entries: Record<string, ReviewEntry>;
  /** Manual make/model choice per sale account id (set from box 2). */
  overrides: Record<string, ReviewOverride>;
};

const REVIEW_STORAGE_KEY = "glam_new_vehicle_review_v1";

function reviewKey(saleAccountId: string, model: string): string {
  return `${normalize(saleAccountId)}|${normalizeUpper(model)}`;
}

function loadReviewStore(): ReviewStore {
  const empty: ReviewStore = { version: 1, updatedAt: "", entries: {}, overrides: {} };
  try {
    const raw = localStorage.getItem(REVIEW_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<ReviewStore>;
    if (!parsed || typeof parsed.entries !== "object" || parsed.entries === null) return empty;
    return {
      version: 1,
      updatedAt: parsed.updatedAt ?? "",
      entries: { ...parsed.entries },
      overrides: { ...(parsed.overrides ?? {}) },
    };
  } catch {
    return empty;
  }
}

function saveReviewStore(store: ReviewStore): void {
  store.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage unavailable: the review is kept only for this view */
  }
}

function buildModelMatchesForMake(
  dealerId: string,
  candidates: CandidateSaleAccount[],
  modelRows: Array<{ make: string; model: string }>,
  blockedNotes?: Map<string, string>
): ModelMatchRow[] {
  const makeKeyword = modelRows[0]?.make ?? "";
  const matchedRows: ModelMatchRow[] = [];
  // model key -> name of the account that already took it
  const claimedModels = new Map<string, string>();

  const modelRowsSorted = [...modelRows].sort((a, b) => {
    const aLen = Math.max(...getModelAliases(a.model).map((x) => normalizeModelAlias(x).length), 0);
    const bLen = Math.max(...getModelAliases(b.model).map((x) => normalizeModelAlias(x).length), 0);
    return bLen - aLen;
  });

  const review = loadReviewStore();

  for (const candidate of candidates) {
    let best: { make: string; model: string } | null = null;
    let bestScore = -Infinity;
    let blockedScore = 0;
    let blockedBy = "";
    let bestModelLen = Infinity;
    let bestReason = "";

    const nameLoose = normalizeLoose(candidate.saleAccountId_Name);
    const nameTokens = accountNameTokens(candidate.saleAccountId_Name);

    for (const { make, model } of modelRowsSorted) {
      const dealType = dealTypeOf(candidate.saleAccountId_Name);
      const key = `${normalizeUpper(make)}__${normalizeUpper(model)}__${dealType}`;
      if (claimedModels.has(key)) {
        const blocked = scoreModelForAccount(nameTokens, nameLoose, model);
        if (blocked && blocked.score > blockedScore) {
          blockedScore = blocked.score;
          blockedBy = `${make} ${model} is already mapped to "${claimedModels.get(key)}"`;
        }
        continue;
      }

      const verdict = review.entries[reviewKey(candidate.saleAccountId, model)]?.verdict;
      if (verdict === "bad") continue;

      const scored = scoreModelForAccount(nameTokens, nameLoose, model);
      if (!scored) continue;

      const total = scored.score + (verdict === "good" ? 100 : 0);
      if (total > bestScore || (total === bestScore && model.length < bestModelLen)) {
        best = { make, model };
        bestScore = total;
        bestModelLen = model.length;
        bestReason =
          `account→model score ${total}: ${scored.notes.join(", ")}` +
          (verdict === "good" ? " (reviewed good)" : "");
      }
    }

    if (!best && blockedBy && blockedNotes) {
      blockedNotes.set(candidate.saleAccountId, `Duplicate mapping: ${blockedBy}`);
    }

    if (best) {
      claimedModels.set(
        `${normalizeUpper(best.make)}__${normalizeUpper(best.model)}__${dealTypeOf(candidate.saleAccountId_Name)}`,
        candidate.saleAccountId_Name
      );

      const baseMappedAssetId = buildMappedAssetId(
        dealerId,
        candidate.saleAccountId,
        candidate.saleAccountId_Number
      );

      const bodyClasses = candidate.detectedBodyClasses;
      const shouldExpandByBodyClass = bodyClasses.length > 0;

      if (shouldExpandByBodyClass) {
        for (const bodyClass of bodyClasses) {
          matchedRows.push({
            make: best.make,
            model: best.model,
            mappedAssetId: baseMappedAssetId,
            saleAccountId: candidate.saleAccountId,
            saleAccountId_Number: candidate.saleAccountId_Number,
            saleAccountId_Name: candidate.saleAccountId_Name,
            costOffsetAccountId: candidate.costOffsetAccountId,
            costOffsetAccountId_Name: candidate.costOffsetAccountId_Name,
            matched: true,
            matchReason: `${bestReason}, bodyClass:${bodyClass}`,
            sortBucket: 0,
            bodyClasses: [bodyClass],
          });
        }
      } else {
        matchedRows.push({
          make: best.make,
          model: best.model,
          mappedAssetId: baseMappedAssetId,
          saleAccountId: candidate.saleAccountId,
          saleAccountId_Number: candidate.saleAccountId_Number,
          saleAccountId_Name: candidate.saleAccountId_Name,
          costOffsetAccountId: candidate.costOffsetAccountId,
          costOffsetAccountId_Name: candidate.costOffsetAccountId_Name,
          matched: true,
          matchReason: bestReason,
          sortBucket: 0,
          bodyClasses: [],
        });
      }
    }
  }

  const claimedIds = new Set(matchedRows.map((row) => row.saleAccountId));

  const fallbackAccount =
    candidates.find((c) => {
      const n = normalizeLoose(c.saleAccountId_Name);
      const isGenericNew =
        containsLoose(n, "NEW CAR") ||
        containsLoose(n, "NEW TRUCK") ||
        containsLoose(n, "NEW VEHICLE") ||
        containsLoose(n, "NEW VEHICLES") ||
        containsLoose(n, "SALES NEW");
      return isGenericNew && !claimedIds.has(c.saleAccountId);
    }) ??
    // No evidence, no fallback: an account is only used as the catch-all when its name
    // carries the make keyword (or is a generic new-vehicle account above).
    candidates.find(
      (c) =>
        !claimedIds.has(c.saleAccountId) &&
        (normalizeUpper(c.detectedMake) === normalizeUpper(makeKeyword) ||
          containsLoose(c.saleAccountId_Name, makeKeyword))
    ) ?? null;

  if (fallbackAccount) {
    const fallbackMappedAssetId = buildMappedAssetId(
      dealerId,
      fallbackAccount.saleAccountId,
      fallbackAccount.saleAccountId_Number
    );

    const fallbackBodyClasses =
      fallbackAccount.detectedBodyClasses.length > 0
        ? fallbackAccount.detectedBodyClasses
        : [];

    if (fallbackBodyClasses.length > 0) {
      for (const bodyClass of fallbackBodyClasses) {
        matchedRows.push({
          make: "",
          model: "All",
          mappedAssetId: fallbackMappedAssetId,
          saleAccountId: fallbackAccount.saleAccountId,
          saleAccountId_Number: fallbackAccount.saleAccountId_Number,
          saleAccountId_Name: fallbackAccount.saleAccountId_Name,
          costOffsetAccountId: fallbackAccount.costOffsetAccountId,
          costOffsetAccountId_Name: fallbackAccount.costOffsetAccountId_Name,
          matched: false,
          matchReason: `fallback:weak-or-no-model-match, bodyClass:${bodyClass}`,
          sortBucket: 1,
          bodyClasses: [bodyClass],
        });
      }
    } else {
      matchedRows.push({
        make: "",
        model: "All",
        mappedAssetId: fallbackMappedAssetId,
        saleAccountId: fallbackAccount.saleAccountId,
        saleAccountId_Number: fallbackAccount.saleAccountId_Number,
        saleAccountId_Name: fallbackAccount.saleAccountId_Name,
        costOffsetAccountId: fallbackAccount.costOffsetAccountId,
        costOffsetAccountId_Name: fallbackAccount.costOffsetAccountId_Name,
        matched: false,
        matchReason: "fallback:weak-or-no-model-match",
        sortBucket: 1,
        bodyClasses: [],
      });
    }
  }

  return matchedRows;
}

function buildPayload(
  dealerId: string,
  ruleName: string,
  modelMatches: ModelMatchRow[]
): Record<string, unknown> {
  // Any lease / one-time-lease account adds the PAYMENT_TYPE_VAR_OPS column to the whole payload.
  // Sales and retail accounts map to ALL. Body class is not sent in this mode.
  const hasLease = modelMatches.some((row) => paymentTypeOf(row.saleAccountId_Name) !== "ALL");

  // Lease row -> emitted as LEASE and ONE_TIME_LEASE (one row each). Sales/retail/other -> ALL.
  // Non-ALL options are listed first, ALL last.
  const expanded = modelMatches.flatMap((row) => {
    if (!hasLease) return [{ row, paymentType: null as string | null }];
    const type = paymentTypeOf(row.saleAccountId_Name);
    const types = type === "ALL" ? ["ALL"] : [type, "ONE_TIME_LEASE"].filter((t, i, a) => a.indexOf(t) === i);
    return types.map((paymentType) => ({ row, paymentType }));
  });
  const ordered = hasLease
    ? [...expanded.filter((e) => e.paymentType !== "ALL"), ...expanded.filter((e) => e.paymentType === "ALL")]
    : expanded;

  return {
    module: "NEW_VEHICLE",
    name: ruleName,
    criteriaList: [],
    mappingColumns: hasLease ? ["MODEL", "PAYMENT_TYPE_VAR_OPS"] : ["MODEL"],
    mappingList: ordered.map(({ row, paymentType }) => ({
      attributes: paymentType
        ? {
            MODEL: row.model,
            PAYMENT_TYPE_VAR_OPS: paymentType,
          }
        : {
            MODEL: row.model,
          },
      targetFieldToValueMapping: {},
      mappedAssetId: row.mappedAssetId,
      mappedDealerId: dealerId,
      rowId: generateRowId(),
    })),
    ruleAsset: "GLACCOUNT",
  };
}

function findMakeModels(make: string): Array<{ make: string; model: string }> {
  return getAllModelsWithMakes().filter(
    (row) => normalizeUpper(row.make) === normalizeUpper(make)
  );
}

function findResolvedMakesFromMetadata(metadataMakes: string[]): string[] {
  const aliasEntries = getMakeAliasEntries();
  const resolved: string[] = [];

  for (const rawMake of metadataMakes) {
    const normalizedRaw = normalizeUpper(rawMake);

    for (const entry of aliasEntries) {
      const aliases = [entry.canonicalMake, ...entry.aliases];
      if (aliases.some((alias) => normalizeUpper(alias) === normalizedRaw)) {
        resolved.push(entry.canonicalMake);
        break;
      }
    }
  }

  return Array.from(new Set(resolved));
}

// ----------------------------------------------------------------------
// View Components
// ----------------------------------------------------------------------

function ChevronIcon({ open }: { open: boolean }): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`nv-chevron-icon ${open ? "nv-chevron-open" : "nv-chevron-closed"}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function InfoIcon({ open }: { open: boolean }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`nv-info-button ${open ? "nv-info-icon-open" : ""}`}
    >
      i
    </span>
  );
}

function SectionHeader({
  title,
  open,
  onToggle,
  badge,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  badge?: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      className="nv-collapsible-header"
      onClick={onToggle}
      aria-expanded={open}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <ChevronIcon open={open} />
        <span
          className="nv-section-header-title"
          style={{ color: "#f8fafc", fontSize: 15, fontWeight: 800 }}
        >
          {title}
        </span>
      </span>
      {badge}
    </button>
  );
}

type CollapsibleSectionKey =
  | "matchSummary"
  | "linkedSaleAccounts"
  | "warnings"
  | "modelMapping"
  | "payloads";

const NewVehiclesView: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  const [fetchHeaders, setFetchHeaders] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState<
    Record<CollapsibleSectionKey, boolean>
  >({
    matchSummary: false,
    linkedSaleAccounts: false,
    warnings: false,
    modelMapping: false,
    payloads: false,
  });

  const [reviewStore, setReviewStore] = useState<ReviewStore>(() => loadReviewStore());
  const [pickerAccountId, setPickerAccountId] = useState<string | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");

  const saveOverride = useCallback(
    (accountId: string, account: CandidateSaleAccount, make: string, model: string) => {
      const store = loadReviewStore();
      store.overrides[accountId] = {
        make,
        model,
        saleAccountName: account.saleAccountId_Name,
        saleAccountNumber: account.saleAccountId_Number,
        at: new Date().toISOString(),
      };
      saveReviewStore(store);
      setReviewStore(store);
    },
    []
  );

  const clearOverride = useCallback((accountId: string) => {
    const store = loadReviewStore();
    delete store.overrides[accountId];
    saveReviewStore(store);
    setReviewStore(store);
  }, []);

  const allModelOptions = useMemo(() => getAllModelsWithMakes(), []);
  const pickerOptions = useMemo(() => {
    const words = normalizeLoose(pickerQuery).split(" ").filter(Boolean);
    const pool =
      words.length === 0
        ? allModelOptions
        : allModelOptions.filter((o) => {
            const hay = normalizeLoose(`${o.make} ${o.model}`);
            return words.every((w) => hay.includes(w));
          });
    return pool.slice(0, 60);
  }, [allModelOptions, pickerQuery]);

  const setRowVerdict = useCallback((row: ModelMatchRow, make: string, verdict: ReviewVerdict) => {
    const store = loadReviewStore();
    const key = reviewKey(row.saleAccountId, row.model);
    if (store.entries[key]?.verdict === verdict) {
      delete store.entries[key];
    } else {
      store.entries[key] = {
        verdict,
        make,
        model: row.model,
        saleAccountId: row.saleAccountId,
        saleAccountNumber: row.saleAccountId_Number,
        saleAccountName: row.saleAccountId_Name,
        at: new Date().toISOString(),
      };
    }
    saveReviewStore(store);
    setReviewStore(store);
  }, []);

  const exportReviewJson = useCallback(() => {
    const store = loadReviewStore();
    const payload = {
      exportedAt: new Date().toISOString(),
      dealerId: buildResult?.dealerId ?? "",
      reviewEntries: Object.values(store.entries),
      analysisRows: buildResult
        ? buildResult.makePlans.flatMap((plan) =>
            plan.modelMatches.map((row) => ({
              make: plan.make,
              model: row.model,
              bodyClass: row.bodyClasses[0] ?? "",
              saleAccountNumber: row.saleAccountId_Number,
              saleAccountName: row.saleAccountId_Name,
              mappedAssetId: row.mappedAssetId,
              matched: row.matched,
              matchReason: row.matchReason,
              verdict: store.entries[reviewKey(row.saleAccountId, row.model)]?.verdict ?? null,
            }))
          )
        : [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `new-vehicles-review-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, [buildResult]);

  const reviewCounts = useMemo(() => {
    const values = Object.values(reviewStore.entries);
    return {
      good: values.filter((e) => e.verdict === "good").length,
      bad: values.filter((e) => e.verdict === "bad").length,
    };
  }, [reviewStore]);

  const toggleSection = useCallback((key: CollapsibleSectionKey) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const expandAllSections = useCallback(() => {
    setCollapsedSections({
      matchSummary: false,
      linkedSaleAccounts: false,
      warnings: false,
      modelMapping: false,
      payloads: false,
    });
  }, []);

  const collapseAllSections = useCallback(() => {
    setCollapsedSections({
      matchSummary: true,
      linkedSaleAccounts: true,
      warnings: true,
      modelMapping: true,
      payloads: true,
    });
  }, []);

  const detectedDealerId = useMemo(
    () => extractDealerIdFromHeaders(fetchHeaders) ?? "",
    [fetchHeaders]
  );

  const refreshHeaders = useCallback(() => {
    try {
      const headers = loadGlobalHeaders();
      setFetchHeaders(toEnabledHeaderMap(headers));
    } catch {
      setFetchHeaders({});
    }
  }, []);

  useEffect(() => {
    refreshHeaders();
  }, [refreshHeaders]);

  const buildConfig = useCallback(async (): Promise<BuildResult> => {
    const warnings: string[] = [];

    const enabledHeaders = toEnabledHeaderMap(loadGlobalHeaders());
    const dealerId = extractDealerIdFromHeaders(enabledHeaders);

    if (!dealerId) {
      throw new Error("Dealer ID not found in enabled Global Headers.");
    }

    const allBootstraps = (await idbGetAllBootstraps()) as BootstrapRecordLite[];
    const bootstrap = getBestBootstrapForDealer(allBootstraps, dealerId);

    if (!bootstrap) {
      throw new Error(`No bootstrap snapshot found in IndexedDB for dealer ${dealerId}.`);
    }

    const salesChainsDecoded = getSalesChainsDecodedRows(bootstrap);
    if (salesChainsDecoded.length === 0) {
      throw new Error(
        `No SalesChains_Decoded found in bootstrap record for dealer ${dealerId}. Please re-save bootstrap snapshot first.`
      );
    }

    const metadataRes = await fetch("http://localhost:4000/api/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: GET_METADATA_URL,
        method: "GET",
        headers: enabledHeaders,
        timeout: 60000,
      }),
    });

    if (!metadataRes.ok) {
      throw new Error(`Metadata request failed with HTTP ${metadataRes.status}`);
    }

    const metadataJson = (await metadataRes.json()) as {
      status?: number;
      statusText?: string;
      body?: unknown;
      data?: unknown;
    };

    if ((metadataJson.status ?? 200) >= 400) {
      throw new Error(
        `Metadata request failed: ${metadataJson.status ?? ""} ${metadataJson.statusText ?? ""}`.trim()
      );
    }

    const metadataPayload = metadataJson.body ?? metadataJson.data ?? metadataJson;
    const metadataMakes = extractMetadataMakes(metadataPayload);

    if (metadataMakes.length === 0) {
      throw new Error("No makes found in mapping metadata response at data.makes.");
    }

    const resolvedMakes = findResolvedMakesFromMetadata(metadataMakes);

    if (resolvedMakes.length === 0) {
      throw new Error(
        "None of the metadata makes matched MAKE_MODELS_DATA.json Makes/IncludeAny values."
      );
    }




    const costOffsetBuckets = buildMatchedCostOffsetBuckets(salesChainsDecoded);

    if (costOffsetBuckets.length === 0) {
      throw new Error(
        "No New Vehicles cost offset accounts detected in SalesChains_Decoded (looked for NEW + CARS/TRUCKS/VANS/SUV/VEHICLES in costOffsetAccountId_Name)."
      );
    }



    const bucketRows = costOffsetBuckets.flatMap((bucket) => bucket.bucketRows);
    const allCandidateSaleAccounts = uniqueCandidateSaleAccounts(bucketRows);

    if (allCandidateSaleAccounts.length === 0) {
      throw new Error("No sale accounts found linked to the detected cost offset accounts.");
    }

    // Accounts with no make in their name: assign each to the make whose model scores best.
    const blankAccountMake = new Map<string, string>();
    for (const candidate of allCandidateSaleAccounts) {
      if (candidate.detectedMake) continue;
      const nameTokens = accountNameTokens(candidate.saleAccountId_Name);
      const nameLoose = normalizeLoose(candidate.saleAccountId_Name);
      let bestMake = "";
      let bestScore = 0;
      for (const make of resolvedMakes) {
        for (const { model } of findMakeModels(make)) {
          const scored = scoreModelForAccount(nameTokens, nameLoose, model);
          if (scored && scored.score > bestScore) {
            bestScore = scored.score;
            bestMake = make;
          }
        }
      }
      if (bestMake) blankAccountMake.set(candidate.saleAccountId, bestMake);
    }
    if (blankAccountMake.size > 0) {

    }

    // Manual choices from box 2 win over automatic matching.
    const reviewForOverrides = loadReviewStore();
    const overrideRowsByMake = new Map<string, ModelMatchRow[]>();
    const claimedAccountIds = new Set<string>();
    for (const acc of allCandidateSaleAccounts) {
      const ov = reviewForOverrides.overrides[acc.saleAccountId];
      if (!ov) continue;
      claimedAccountIds.add(acc.saleAccountId);
      const rows = overrideRowsByMake.get(ov.make) ?? [];
      rows.push({
        make: ov.make,
        model: ov.model,
        mappedAssetId: buildMappedAssetId(dealerId, acc.saleAccountId, acc.saleAccountId_Number),
        saleAccountId: acc.saleAccountId,
        saleAccountId_Number: acc.saleAccountId_Number,
        saleAccountId_Name: acc.saleAccountId_Name,
        costOffsetAccountId: acc.costOffsetAccountId,
        costOffsetAccountId_Name: acc.costOffsetAccountId_Name,
        matched: true,
        matchReason: "manual selection",
        sortBucket: 0,
        bodyClasses: acc.detectedBodyClasses.slice(0, 1),
      });
      overrideRowsByMake.set(ov.make, rows);
    }
    const makesToProcess = Array.from(new Set([...resolvedMakes, ...overrideRowsByMake.keys()]));
    const duplicateNotes = new Map<string, string>();
    const makePlans: MakePayloadPlan[] = [];
    const allModelMatches: ModelMatchRow[] = [];
    const payloads: Array<{ make: string; ruleName: string; payload: Record<string, unknown> }> = [];

    for (const make of makesToProcess) {
      const makeModels = findMakeModels(make);

      if (makeModels.length === 0) {

        continue;
      }

      const makeCandidates = allCandidateSaleAccounts.filter((candidate) => {
        // An account already mapped under an earlier make is not mapped again.
        if (claimedAccountIds.has(candidate.saleAccountId)) return false;
        if (normalizeUpper(candidate.detectedMake) === normalizeUpper(make)) return true;
        if (containsLoose(candidate.saleAccountId_Name, make)) return true;
        // Accounts that name no make (e.g. "SILVERADO 1500") go to the make whose models fit best.
        if (!candidate.detectedMake && blankAccountMake.get(candidate.saleAccountId) === make) return true;
        return false;
      });

      // Only accounts that belong to this make (named in the account, or assigned by model match).
      // No fallback to other makes' accounts.
      const resolvedCandidates = makeCandidates;

      if (makeCandidates.length === 0 && !overrideRowsByMake.has(make)) {

        continue;
      }

      const modelMatches = [
        ...(overrideRowsByMake.get(make) ?? []),
        ...buildModelMatchesForMake(dealerId, resolvedCandidates, makeModels, duplicateNotes),
      ];
      for (const row of modelMatches) {
        if (row.matched) claimedAccountIds.add(row.saleAccountId);
      }
      const ruleName = `New Vehicles - ${make}`;
      const payload = buildPayload(dealerId, ruleName, modelMatches);

      makePlans.push({
        make,
        ruleName,
        candidateSaleAccounts: resolvedCandidates,
        modelMatches,
        payload,
      });

      allModelMatches.push(...modelMatches);
      payloads.push({ make, ruleName, payload });

      const fallbackRows = modelMatches.filter((row) => !row.matched);
      if (fallbackRows.length > 0) {

      }
    }

    if (makePlans.length === 0) {
      throw new Error("No make-based payload plans could be created.");
    }

    const rulesRes = await fetch("http://localhost:4000/api/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: GET_RULES_URL,
        method: "GET",
        headers: enabledHeaders,
        timeout: 60000,
      }),
    });

    if (!rulesRes.ok) {
      throw new Error(`Rule lookup failed with HTTP ${rulesRes.status}`);
    }

    const rulesJson = (await rulesRes.json()) as {
      status?: number;
      statusText?: string;
      body?: unknown;
      data?: unknown;
    };

    if ((rulesJson.status ?? 200) >= 400) {
      throw new Error(
        `Rule lookup failed: ${rulesJson.status ?? ""} ${rulesJson.statusText ?? ""}`.trim()
      );
    }

    const actualPayload = rulesJson.body ?? rulesJson.data ?? rulesJson;
    const existingRule = findExistingNewVehicleRule(actualPayload);

    if (existingRule) {
      warnings.push(
        `Existing NEW_VEHICLE rule found: ${existingRule.name} (${existingRule.id}). Create will be skipped.`
      );
    }

    return {
      dealerId,
      metadataMakes,
      resolvedMakes,
      ruleName: "New Vehicles",
      existingRule,
      costOffsetBuckets,
      bucketRows,
      makePlans,
      modelMatches: allModelMatches,
      payloads,
      warnings,
      duplicateNotes: Object.fromEntries(duplicateNotes),
    };
  }, []);

  const handleAnalyze = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      refreshHeaders();
      const result = await buildConfig();
      setBuildResult(result);

      const matchedCount = result.modelMatches.filter((row) => row.matched).length;
      const fallbackCount = result.modelMatches.filter((row) => !row.matched).length;

      setMessage({
        ok: true,
        text: result.existingRule
          ? `✅ Existing NEW_VEHICLE rule found (${result.existingRule.id}). Preview ready. Makes: ${result.makePlans.length}, Matched: ${matchedCount}, Fallback(All): ${fallbackCount}.`
          : `✅ New Vehicles configuration prepared. Makes: ${result.makePlans.length}, Matched: ${matchedCount}, Fallback(All): ${fallbackCount}.`,
      });
    } catch (e: unknown) {
      setBuildResult(null);
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Failed to analyze New Vehicles config",
      });
    } finally {
      setLoading(false);
    }
  }, [buildConfig, refreshHeaders]);

  const handleCreate = useCallback(async () => {
    setRunning(true);
    setMessage(null);

    try {
      refreshHeaders();
      const result = await buildConfig();
      setBuildResult(result);

      // An existing NEW_VEHICLE rule is only detected, never changed. Payloads are posted as new rules.

      const enabledHeaders = toEnabledHeaderMap(loadGlobalHeaders());

      for (const plan of result.makePlans) {
        const proxyRes = await fetch("http://localhost:4000/api/proxy", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: CREATE_RULE_URL,
            method: "POST",
            headers: enabledHeaders,
            body: plan.payload,
            timeout: 60000,
          }),
        });

        if (!proxyRes.ok) {
          throw new Error(`Create request failed for ${plan.make} with HTTP ${proxyRes.status}`);
        }

        const proxyJson = (await proxyRes.json()) as {
          status?: number;
          statusText?: string;
          body?: unknown;
          data?: unknown;
        };

        if ((proxyJson.status ?? 200) >= 400) {
          throw new Error(
            `Create request failed for ${plan.make}: ${proxyJson.status ?? ""} ${proxyJson.statusText ?? ""}`.trim()
          );
        }
      }

      setMessage({
        ok: true,
        text: `✅ New Vehicles mapping rule(s) created successfully for dealer ${result.dealerId}. Created payloads: ${result.makePlans.length}.`,
      });

      const refreshed = await buildConfig();
      setBuildResult(refreshed);
    } catch (e: unknown) {
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Failed to create New Vehicles rule(s)",
      });
    } finally {
      setRunning(false);
    }
  }, [buildConfig, buildResult, refreshHeaders]);

  const matchedCount = buildResult?.modelMatches.filter((row) => row.matched).length ?? 0;
  const fallbackCount = buildResult?.modelMatches.filter((row) => !row.matched).length ?? 0;

  const allCandidateSaleAccounts = useMemo(
    () =>
      buildResult
        ? Array.from(
            new Map(
              buildResult.makePlans
                .flatMap((plan) => plan.candidateSaleAccounts)
                .map((row) => [`${row.saleAccountId}__${row.saleAccountId_Number}`, row] as const)
            ).values()
          )
        : [],
    [buildResult]
  );

  const infoMetrics = useMemo(() => {
    const payloadCount = buildResult?.payloads.length ?? 0;
    const metadataMakesCount = buildResult?.metadataMakes.length ?? 0;
    const resolvedMakesCount = buildResult?.makePlans.length ?? 0;
    const costOffsetBucketsCount = buildResult?.costOffsetBuckets.length ?? 0;
    const linkedSaleAccountsCount = allCandidateSaleAccounts.length;
    const existingRuleLabel = buildResult?.existingRule
      ? `${buildResult.existingRule.name} (${buildResult.existingRule.id})`
      : "None found";

    return {
      dealerId: buildResult?.dealerId || detectedDealerId || "Not found",
      metadataMakesCount,
      resolvedMakesCount,
      costOffsetBucketsCount,
      linkedSaleAccountsCount,
      matchedCount,
      fallbackCount,
      payloadCount,
      existingRuleLabel,
    };
  }, [allCandidateSaleAccounts.length, buildResult, detectedDealerId, fallbackCount, matchedCount]);

  // Box 1 and Box 2 data (UI only)
  const detectedSaleAccounts = useMemo(
    () => (buildResult ? uniqueCandidateSaleAccounts(buildResult.bucketRows) : []),
    [buildResult]
  );

  const accountMappingRows = useMemo(() => {
    if (!buildResult) return [] as Array<{
      account: CandidateSaleAccount;
      make: string;
      model: string;
      bodyClass: string;
      status: "Matched" | "Fallback" | "Not mapped" | "Manual" | "Duplicate";
      row: ModelMatchRow | null;
      verdict: ReviewVerdict | undefined;
    }>;

    const rows: Array<{
      account: CandidateSaleAccount;
      make: string;
      model: string;
      bodyClass: string;
      status: "Matched" | "Fallback" | "Not mapped" | "Manual" | "Duplicate";
      row: ModelMatchRow | null;
      verdict: ReviewVerdict | undefined;
    }> = [];
    const mappedIds = new Set<string>();

    for (const plan of buildResult.makePlans) {
      for (const row of plan.modelMatches) {
        if (reviewStore.overrides[row.saleAccountId]) continue; // shown as Manual below
        const verdict = reviewStore.entries[reviewKey(row.saleAccountId, row.model)]?.verdict;
        mappedIds.add(row.saleAccountId);
        rows.push({
          account: {
            saleAccountId: row.saleAccountId,
            saleAccountId_Number: row.saleAccountId_Number,
            saleAccountId_Name: row.saleAccountId_Name,
            costOffsetAccountId: row.costOffsetAccountId,
            costOffsetAccountId_Name: row.costOffsetAccountId_Name,
            detectedBodyClasses: [],
            detectedMake: plan.make,
            detectedMakeReason: "",
            detectedModelHints: [],
          },
          make: plan.make,
          model: row.matched ? row.model : "All other models",
          bodyClass: row.bodyClasses[0] ?? "",
          status: row.matched ? "Matched" : "Fallback",
          row,
          verdict,
        });
      }
    }

    for (const acc of uniqueCandidateSaleAccounts(buildResult.bucketRows)) {
      const ov = reviewStore.overrides[acc.saleAccountId];
      if (!ov) continue;
      mappedIds.add(acc.saleAccountId);
      rows.push({
        account: acc,
        make: ov.make,
        model: ov.model,
        bodyClass: acc.detectedBodyClasses.join(", "),
        status: "Manual",
        row: null,
        verdict: undefined,
      });
    }

    for (const acc of uniqueCandidateSaleAccounts(buildResult.bucketRows)) {
      if (mappedIds.has(acc.saleAccountId)) continue;
      rows.push({
        account: acc,
        make: "",
        model: "—",
        bodyClass: acc.detectedBodyClasses.join(", "),
        status: buildResult.duplicateNotes[acc.saleAccountId] ? "Duplicate" : "Not mapped",
        row: null,
        verdict: undefined,
      });
    }

    return rows;
  }, [buildResult, reviewStore]);

  const mappedAccountCount = useMemo(
    () => new Set(accountMappingRows.filter((r) => r.status === "Matched").map((r) => r.account.saleAccountId)).size,
    [accountMappingRows]
  );
  const fallbackAccountCount = useMemo(
    () => new Set(accountMappingRows.filter((r) => r.status === "Fallback").map((r) => r.account.saleAccountId)).size,
    [accountMappingRows]
  );
  const unmappedAccountCount = useMemo(
    () => accountMappingRows.filter((r) => r.status === "Not mapped").length,
    [accountMappingRows]
  );

  const manualCount = accountMappingRows.filter((r) => r.status === "Manual").length;

  const statusStyle = (status: string): { label: string; color: string } => {
    switch (status) {
      case "Matched":
        return { label: "Matched", color: "#30d158" };
      case "Manual":
        return { label: "Manual", color: "#64d2ff" };
      case "Fallback":
        return { label: "Fallback", color: "#ff9f0a" };
      case "Duplicate":
        return { label: "Duplicate mapping", color: "#ff453a" };
      default:
        return { label: "Not mapped", color: "#94a3b8" };
    }
  };

  return (
    <div className="nv-page-scroll nv-page">
      <GlamSectionHeader
        title="New Vehicles"
        description="Sale accounts mapped to vehicle models"
        breadcrumb="Accounting / Variable Operations / New Vehicles"
      />

      <div className="nv-card" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ color: "#94a3b8", fontSize: 13 }}>
            Dealer <b style={{ color: detectedDealerId ? "#86efac" : "#fca5a5" }}>{detectedDealerId || "not found"}</b>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn-secondary btn-sm"
              onClick={() => void handleAnalyze()}
              disabled={loading || running || !detectedDealerId}
            >
              {loading ? "Analyzing..." : "Analyze"}
            </button>
            <button
              className="btn-primary"
              onClick={() => void handleCreate()}
              disabled={loading || running || !detectedDealerId}
            >
              {running ? "Creating..." : "Auto Configure"}
            </button>
            {buildResult ? (
              <button className="btn-secondary btn-sm" onClick={exportReviewJson} type="button">
                Export review
              </button>
            ) : null}
          </div>
        </div>
        {message ? (
          <div className={`nv-msg-panel ${message.ok ? "nv-msg-success" : "nv-msg-error"}`}>{message.text}</div>
        ) : null}
      </div>

      {buildResult ? (
        <div className="nv-card" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ color: "#f8fafc", fontWeight: 800 }}>{detectedSaleAccounts.length} sale accounts</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
              <span style={{ color: "#30d158" }}>{mappedAccountCount} matched</span>
              <span style={{ color: "#64d2ff" }}>{manualCount} manual</span>
              <span style={{ color: "#ff9f0a" }}>{fallbackAccountCount} fallback</span>
              <span style={{ color: "#94a3b8" }}>{unmappedAccountCount} not mapped</span>
            </div>
          </div>

          <div className="nv-scroll nv-table-scroll-wrap" style={{ height: "min(1100px, 80vh)", minHeight: 520 }}>
            <table className="bx-table nv-table-element">
              <thead>
                <tr>
                  <th className="nv-sticky-th">GL #</th>
                  <th className="nv-sticky-th">Sale account</th>
                  <th className="nv-sticky-th">Make</th>
                  <th className="nv-sticky-th">Model</th>
                  <th className="nv-sticky-th">Status</th>
                  <th className="nv-sticky-th">Review</th>
                </tr>
              </thead>
              <tbody>
                {accountMappingRows.map((item, i) => {
                  const accId = item.account.saleAccountId;
                  const isPicking = pickerAccountId === accId;
                  const hasOverride = Boolean(reviewStore.overrides[accId]);
                  const st = statusStyle(item.status === "Not mapped" && buildResult.duplicateNotes[accId] ? "Duplicate" : item.status);
                  return (
                    <React.Fragment key={`${accId}-${item.model}-${i}`}>
                      <tr className="nv-zebra-row">
                        <td className="nv-td"><code className="nv-mono">{item.account.saleAccountId_Number || "—"}</code></td>
                        <td className="nv-td">{item.account.saleAccountId_Name || "—"}</td>
                        <td className="nv-td" style={{ textTransform: "capitalize" }}>{item.make || "—"}</td>
                        <td className="nv-td">
                          <span style={{ fontWeight: 600 }}>{item.model}</span>
                          <button
                            type="button"
                            className="btn-secondary btn-sm"
                            style={{ marginLeft: 8 }}
                            onClick={() => {
                              setPickerQuery("");
                              setPickerAccountId(isPicking ? null : accId);
                            }}
                          >
                            {isPicking ? "Close" : "Change"}
                          </button>
                        </td>
                        <td className="nv-td" style={{ color: st.color, fontWeight: 600, whiteSpace: "nowrap" }}>{st.label}</td>
                        <td className="nv-td">
                          {item.row ? (
                            <span style={{ display: "inline-flex", gap: 4 }}>
                              <button type="button" className="btn-secondary btn-sm" title="Correct"
                                onClick={() => {
                                  setRowVerdict(item.row!, item.make, "good");
                                  void handleAnalyze();
                                }}
                                style={{ color: item.verdict === "good" ? "#30d158" : undefined }}>✓</button>
                              <button type="button" className="btn-secondary btn-sm" title="Wrong"
                                onClick={() => {
                                  setRowVerdict(item.row!, item.make, "bad");
                                  void handleAnalyze();
                                }}
                                style={{ color: item.verdict === "bad" ? "#ff453a" : undefined }}>✗</button>
                            </span>
                          ) : null}
                        </td>
                      </tr>
                      {isPicking ? (
                        <tr>
                          <td className="nv-td" colSpan={6}>
                            <div style={{ display: "grid", gap: 8 }}>
                              <input
                                autoFocus
                                value={pickerQuery}
                                onChange={(e) => setPickerQuery(e.target.value)}
                                placeholder="Search make or model"
                                style={{
                                  padding: "6px 8px",
                                  background: "#0b1120",
                                  color: "#f8fafc",
                                  border: "1px solid rgba(255,255,255,0.12)",
                                  borderRadius: 6,
                                }}
                              />
                              <div style={{ maxHeight: 220, overflow: "auto", display: "grid", gap: 4 }}>
                                {pickerOptions.map((opt) => (
                                  <button
                                    key={`${opt.make}-${opt.model}`}
                                    type="button"
                                    className="btn-secondary btn-sm"
                                    style={{ textAlign: "left", textTransform: "capitalize" }}
                                    onClick={() => {
                                      saveOverride(accId, item.account, opt.make, opt.model);
                                      setPickerAccountId(null);
                                    }}
                                  >
                                    {opt.make} · {opt.model}
                                  </button>
                                ))}
                              </div>
                              {hasOverride ? (
                                <button
                                  type="button"
                                  className="btn-secondary btn-sm"
                                  style={{ justifySelf: "start" }}
                                  onClick={() => {
                                    clearOverride(accId);
                                    setPickerAccountId(null);
                                  }}
                                >
                                  Use automatic match
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default NewVehiclesView;