import React, { useCallback, useEffect, useMemo, useState } from "react";
import { GlamSectionHeader } from "../../../components/glamShared";
import { idbGetAllBlueprints } from "../../../../../../utils/blueprintDb";
import { idbGetAllBootstraps } from "../../../../../../utils/bootstrapDb";
import { loadGlobalHeaders } from "../../../../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../../../../types/proxy.types";
import terminologyMap from "../../../../../../terminology/terminology_mapping.json";

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

type BlueprintRecordLite = {
  key: string;
  dealerId?: string;
  tekionId?: string;
  dealerName?: string;
  formName?: string;
  data?: unknown;
  decodedResponse?: unknown;
  savedAt: string;
};

type BootstrapRecordLite = {
  key: string;
  dealerName: string;
  envName: string;
  data: unknown;
  savedAt: string;
};

type FlatRowLike = {
  title?: string | null;
  decodedValue?: unknown;
  subsectionName?: string | null;
  sectionName?: string | null;
};

type BootstrapAccount = {
  id: string;
  key?: string;
  accountNumber: string;
  accountName: string;
  accountType?: string;
};

type ExistingRuleSummary = {
  id: string;
  module: string;
  name: string;
  raw: unknown;
};

type PayableType = "LIEN_PAYOFF" | "ACCESSORIES_DUE";

type BlueprintQuestionKey =
  | "LIEN_PAYOFF"
  | "SERVICE_WE_OWE"
  | "PARTS_WE_OWE";

type BlueprintAnswer = {
  key: BlueprintQuestionKey;
  label: string;
  decodedValue: string;
  extractedToken: string;
  account: BootstrapAccount | null;
  terminologyHits: string[];
};

type MappingRowPlan = {
  payableType: PayableType;
  mappedAssetId: string;
  mappedDealerId: string;
  sourceLabel: string;
  sourceDecodedValue: string;
  sourceToken: string;
  matched: boolean;
};

type BuildResult = {
  dealerId: string;
  blueprint: BlueprintRecordLite | null;
  bootstrap: BootstrapRecordLite | null;
  answers: BlueprintAnswer[];
  rows: MappingRowPlan[];
  payload: Record<string, unknown>;
  payloadName: string;
  existingRule: ExistingRuleSummary | null;
  warnings: string[];
};

type CollapsibleSectionKey =
  | "answerResolution"
  | "warnings"
  | "finalRows"
  | "payloadPreview";

const GET_RULES_URL =
  "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/rule/asset/GLACCOUNT";

const CREATE_RULE_URL =
  "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/rule";

const rawTerminology = terminologyMap as TerminologyPayload;
const terminologyRules: TerminologyRule[] = Array.isArray(rawTerminology)
  ? rawTerminology
  : rawTerminology?.terminology_mapping ?? [];

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeLower(value: unknown): string {
  return normalize(value).toLowerCase();
}

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((x) => fmt(x)).filter(Boolean).join(", ");
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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
    if (found && normalize(found[1])) return normalize(found[1]);
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

function isAccountingBlueprintForm(formName?: string): boolean {
  const name = normalizeLower(formName);
  return name.includes("blueprint") && name.includes("conquest") && name.includes("accounting");
}

function getBlueprintDealerId(record: BlueprintRecordLite): string {
  return normalize(record.dealerId);
}

function getBootstrapDealerId(record: BootstrapRecordLite): string {
  const raw = record.data as any;

  return (
    normalize(raw?.dealerId) ||
    normalize(raw?.bootstrap?.dealerId) ||
    normalize(raw?.data?.dealerId) ||
    normalize(raw?.data?.data?.dealerId) ||
    normalize(raw?.glDealerId) ||
    normalize(raw?.data?.glDealerId) ||
    normalize(Object.keys(raw?.data?.allAccounts?.dealerAssetDocMap ?? {})[0]) ||
    normalize(Object.keys(raw?.data?.data?.allAccounts?.dealerAssetDocMap ?? {})[0]) ||
    normalize(Object.keys(raw?.allAccounts?.dealerAssetDocMap ?? {})[0]) ||
    normalize(record.key)
  );
}

function getBlueprintFlatRows(record: BlueprintRecordLite): FlatRowLike[] {
  const decoded = record.decodedResponse as
    | { populatedFlatRows?: FlatRowLike[]; allFields?: FlatRowLike[] }
    | undefined;

  if (Array.isArray(decoded?.populatedFlatRows)) return decoded.populatedFlatRows;
  if (Array.isArray(decoded?.allFields)) return decoded.allFields;

  const data = record.data as
    | { populatedFlatRows?: FlatRowLike[]; allFields?: FlatRowLike[] }
    | undefined;

  if (Array.isArray(data?.populatedFlatRows)) return data.populatedFlatRows;
  if (Array.isArray(data?.allFields)) return data.allFields;

  return [];
}

function extractBootstrapAccounts(
  record: BootstrapRecordLite | null,
  dealerId?: string | null
): BootstrapAccount[] {
  if (!record) return [];

  const raw = record.data as any;
  const requestedDealerId = normalize(dealerId);
  const detectedDealerId = getBootstrapDealerId(record);
  const dealerIds = Array.from(new Set([requestedDealerId, detectedDealerId].filter(Boolean)));
  const results: BootstrapAccount[] = [];

  function pushAccount(item: unknown) {
    if (!item || typeof item !== "object") return;
    const obj = item as Record<string, unknown>;

    const accountNumber =
      normalize(obj.accountNumber) ||
      normalize(obj["#"]) ||
      normalize(obj["account_number"]);

    const accountName =
      normalize(obj.accountName) ||
      normalize(obj["NAME"]) ||
      normalize(obj["account_name"]);

    const id = normalize(obj.id) || normalize(obj["ID"]);
    const key = normalize(obj.key) || normalize(obj["KEY"]);
    const accountType =
      normalize(obj.accountTypeId) ||
      normalize(obj["TYPE"]) ||
      normalize(obj["accountType"]);

    if (!accountNumber && !accountName && !id && !key) return;

    results.push({
      id,
      key,
      accountNumber,
      accountName,
      accountType,
    });
  }

  function pushArray(arr: unknown) {
    if (!Array.isArray(arr)) return;
    for (const item of arr) pushAccount(item);
  }

  function pushFromContainer(container: unknown) {
    if (Array.isArray(container)) {
      for (const item of container) pushAccount(item);
      return;
    }

    if (container && typeof container === "object") {
      for (const value of Object.values(container as Record<string, unknown>)) {
        if (Array.isArray(value)) {
          for (const item of value) pushAccount(item);
        } else {
          pushAccount(value);
        }
      }
    }
  }

  pushArray(raw?.glAccounts);
  pushArray(raw?.data?.glAccounts);
  pushArray(raw?.data?.data?.glAccounts);
  pushArray(raw?.bootstrap?.glAccounts);
  pushArray(raw?.body?.glAccounts);
  pushArray(raw?.body?.data?.glAccounts);
  pushArray(raw?.body?.data?.data?.glAccounts);

  for (const candidateDealerId of dealerIds) {
    pushArray(raw?.data?.allAccounts?.dealerAssetDocMap?.[candidateDealerId]);
    pushArray(raw?.data?.data?.allAccounts?.dealerAssetDocMap?.[candidateDealerId]);
    pushArray(raw?.allAccounts?.dealerAssetDocMap?.[candidateDealerId]);
    pushArray(raw?.body?.data?.allAccounts?.dealerAssetDocMap?.[candidateDealerId]);
    pushArray(raw?.body?.data?.data?.allAccounts?.dealerAssetDocMap?.[candidateDealerId]);
  }

  pushFromContainer(raw?.allAccounts?.dealerAssetDocMap);
  pushFromContainer(raw?.data?.allAccounts?.dealerAssetDocMap);
  pushFromContainer(raw?.data?.data?.allAccounts?.dealerAssetDocMap);

  const deduped = new Map<string, BootstrapAccount>();
  for (const account of results) {
    const key = `${account.id}__${account.key}__${account.accountNumber}__${account.accountName}`;
    if (!deduped.has(key)) deduped.set(key, account);
  }

  return Array.from(deduped.values());
}

function titleContains(text: string, needle: string): boolean {
  return normalizeLower(text).includes(normalizeLower(needle));
}

function findAnswerValue(
  rows: FlatRowLike[],
  predicate: (row: FlatRowLike) => boolean
): string {
  const row = rows.find(predicate);
  return row ? fmt(row.decodedValue) : "";
}

function extractTokens(value: string): string[] {
  const input = normalize(value);
  if (!input) return [];

  const found = new Set<string>();
  const broadMatches = input.match(/\b[A-Za-z0-9][A-Za-z0-9/_-]*\b/g) ?? [];

  for (const raw of broadMatches) {
    const token = normalize(raw);
    if (!token) continue;

    if (/[0-9]/.test(token)) found.add(token);

    const parts = token.split(/[-/_]/).map((x) => normalize(x)).filter(Boolean);
    for (const part of parts) {
      if (/[0-9]/.test(part)) found.add(part);
    }

    const alphaNumChunks = token.match(/[A-Za-z]*\d+[A-Za-z\d]*/g) ?? [];
    for (const chunk of alphaNumChunks) {
      if (/[0-9]/.test(chunk)) found.add(normalize(chunk));
    }
  }

  return Array.from(found).sort((a, b) => b.length - a.length);
}

function scoreAccountMatch(account: BootstrapAccount, token: string, dealerId: string): number {
  const t = normalize(token);
  const accountNumber = normalize(account.accountNumber);
  const accountId = normalize(account.id);
  const accountKey = normalize(account.key);

  if (!t) return -1;
  if (accountNumber === t) return 1000;
  if (accountId === t) return 950;
  if (accountId === `${dealerId}_${t}`) return 930;
  if (accountKey === t) return 900;
  if (accountKey === `${dealerId}_${dealerId}_${t}`) return 890;
  if (accountId.endsWith(`_${t}`)) return 850;
  if (accountKey.endsWith(`_${t}`)) return 840;
  return -1;
}

function findBestAccountForValue(
  decodedValue: string,
  bootstrapAccounts: BootstrapAccount[],
  dealerId: string
): { token: string; account: BootstrapAccount | null } {
  const tokens = extractTokens(decodedValue);

  let bestAccount: BootstrapAccount | null = null;
  let bestToken = "";
  let bestScore = -1;

  for (const token of tokens) {
    for (const account of bootstrapAccounts) {
      const score = scoreAccountMatch(account, token, dealerId);
      if (score > bestScore) {
        bestScore = score;
        bestAccount = account;
        bestToken = token;
      }
    }
  }

  return {
    token: bestToken || normalize(tokens[0] ?? ""),
    account: bestScore >= 0 ? bestAccount : null,
  };
}

function detectTerminologyFromText(text: string): string[] {
  const lowered = normalizeLower(text);
  if (!lowered) return [];

  const hits: string[] = [];

  for (const rule of terminologyRules) {
    const target = normalize(rule.targetMapping);
    const includeAny = Array.isArray(rule.includeAny) ? rule.includeAny : [];
    const exclude = Array.isArray(rule.exclude) ? rule.exclude : [];

    const included = includeAny.some((term) => lowered.includes(normalizeLower(term)));
    if (!included) continue;

    const excluded = exclude.some((term) => lowered.includes(normalizeLower(term)));
    if (excluded) continue;

    if (target && !hits.includes(target)) hits.push(target);
  }

  return hits;
}

function buildBlueprintAnswers(
  blueprint: BlueprintRecordLite | null,
  bootstrap: BootstrapRecordLite | null,
  dealerId: string
): BlueprintAnswer[] {
  if (!blueprint || !bootstrap) return [];

  const rows = getBlueprintFlatRows(blueprint);
  const bootstrapAccounts = extractBootstrapAccounts(bootstrap, dealerId);

  const questionDefs: Array<{
    key: BlueprintQuestionKey;
    label: string;
    find: (row: FlatRowLike) => boolean;
  }> = [
    {
      key: "LIEN_PAYOFF",
      label: "Vehicle Sales Payables > Lien Payoff GL Account",
      find: (row) => {
        const title = normalize(row.title);
        const combined = `${normalize(row.sectionName)} ${normalize(row.subsectionName)} ${title}`;
        return titleContains(combined, "vehicle sales payables") && titleContains(title, "lien payoff gl account");
      },
    },
    {
      key: "SERVICE_WE_OWE",
      label: "Payment Method - Service -Internal > We Owe GL Account Number",
      find: (row) => {
        const title = normalize(row.title);
        const combined = `${normalize(row.sectionName)} ${normalize(row.subsectionName)} ${title}`;
        return titleContains(combined, "payment method - service -internal") && titleContains(title, "we owe gl account number");
      },
    },
    {
      key: "PARTS_WE_OWE",
      label: "Internal Parts Payment Method > We Owe GL Account",
      find: (row) => {
        const title = normalize(row.title);
        const combined = `${normalize(row.sectionName)} ${normalize(row.subsectionName)} ${title}`;
        return titleContains(combined, "internal parts payment method") && titleContains(title, "we owe gl account");
      },
    },
  ];

  return questionDefs.map((def) => {
    const decodedValue = findAnswerValue(rows, def.find);
    const matched = findBestAccountForValue(decodedValue, bootstrapAccounts, dealerId);
    const terminologyHits = detectTerminologyFromText(
      `${def.label} ${decodedValue} ${matched.account?.accountName ?? ""}`
    );

    return {
      key: def.key,
      label: def.label,
      decodedValue,
      extractedToken: matched.token,
      account: matched.account,
      terminologyHits,
    };
  });
}

function buildMappedAssetId(dealerId: string, account: BootstrapAccount | null): string {
  if (!account) return "";
  if (normalize(account.id)) return normalize(account.id);
  if (normalize(account.accountNumber)) return `${dealerId}_${normalize(account.accountNumber)}`;
  return "";
}

function pickAccessoriesAccount(answers: BlueprintAnswer[], warnings: string[]): BlueprintAnswer | null {
  const service = answers.find((a) => a.key === "SERVICE_WE_OWE") ?? null;
  const parts = answers.find((a) => a.key === "PARTS_WE_OWE") ?? null;

  const serviceAsset = service?.account ? service.account : null;
  const partsAsset = parts?.account ? parts.account : null;

  if (serviceAsset && partsAsset) {
    const serviceId = normalize(serviceAsset.id || serviceAsset.accountNumber);
    const partsId = normalize(partsAsset.id || partsAsset.accountNumber);

    if (serviceId && partsId && serviceId !== partsId) {
      warnings.push(
        `Service and Parts We Owe accounts are different. Using Service We Owe account: ${serviceAsset.accountNumber || serviceAsset.id}.`
      );
    }

    return service;
  }

  if (serviceAsset) return service;
  if (partsAsset) return parts;
  return null;
}

function buildRows(dealerId: string, answers: BlueprintAnswer[], warnings: string[]): MappingRowPlan[] {
  const rows: MappingRowPlan[] = [];

  const lien = answers.find((a) => a.key === "LIEN_PAYOFF") ?? null;
  const accessories = pickAccessoriesAccount(answers, warnings);

  if (lien) {
    rows.push({
      payableType: "LIEN_PAYOFF",
      mappedAssetId: buildMappedAssetId(dealerId, lien.account),
      mappedDealerId: dealerId,
      sourceLabel: lien.label,
      sourceDecodedValue: lien.decodedValue,
      sourceToken: lien.extractedToken,
      matched: Boolean(lien.account && buildMappedAssetId(dealerId, lien.account)),
    });
  }

  if (accessories) {
    rows.push({
      payableType: "ACCESSORIES_DUE",
      mappedAssetId: buildMappedAssetId(dealerId, accessories.account),
      mappedDealerId: dealerId,
      sourceLabel: accessories.label,
      sourceDecodedValue: accessories.decodedValue,
      sourceToken: accessories.extractedToken,
      matched: Boolean(accessories.account && buildMappedAssetId(dealerId, accessories.account)),
    });
  }

  return rows;
}

function buildPayload(
  dealerId: string,
  rows: MappingRowPlan[],
  payloadName: string
): Record<string, unknown> {
  const finalRows = rows.filter((row) => row.matched && row.mappedAssetId);

  return {
    module: "PAYABLES",
    name: payloadName,
    criteriaList: [],
    mappingColumns: ["PAYABLE_TYPE"],
    mappingList: finalRows.map((row) => ({
      attributes: {
        PAYABLE_TYPE: row.payableType,
      },
      mappedAssetId: row.mappedAssetId,
      mappedDealerId: dealerId,
      rowId:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `row-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      targetFieldToValueMapping: {},
    })),
    ruleAsset: "GLACCOUNT",
  };
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

function looksLikeLienPayoffRuleName(name: string): boolean {
  const lowered = normalizeLower(name);
  return lowered.includes("lien payoff") || lowered.includes("accessories and lien payoff");
}

function findExistingPayablesRule(payload: unknown): ExistingRuleSummary | null {
  const rows = extractRulesPayloadArray(payload);

  for (const item of rows) {
    const obj = asObject(item);
    if (!obj) continue;

    const moduleName = normalize(obj.module);
    const name = normalize(obj.name);
    const id = normalize(obj.id);

    if (moduleName !== "PAYABLES") continue;
    if (!looksLikeLienPayoffRuleName(name)) continue;
    if (!id) continue;

    return { id, module: moduleName, name, raw: obj };
  }

  return null;
}

const badgeStyle: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.03)",
  color: "#cbd5e1",
  fontSize: 12,
  whiteSpace: "nowrap",
};

const sectionStyle: React.CSSProperties = {
  display: "grid",
  gap: 16,
  minWidth: 0,
  maxHeight: "100vh",
  overflowY: "auto",
  overflowX: "hidden",
  boxSizing: "border-box",
  paddingRight: 4,
};

const cardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  padding: 16,
  minWidth: 0,
};

const monoStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  color: "#e2e8f0",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const statGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
};

const rowCountBadgeStyle: React.CSSProperties = {
  ...badgeStyle,
  fontSize: 11,
  color: "#94a3b8",
};

const collapsibleHeaderStyle: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  flexWrap: "wrap",
  background: "transparent",
  border: "none",
  padding: "4px 6px",
  margin: "-4px -6px 6px -6px",
  borderRadius: 8,
  cursor: "pointer",
  textAlign: "left",
  font: "inherit",
};

function tableScrollWrapStyle(maxHeight: number): React.CSSProperties {
  return {
    maxHeight,
    overflowY: "auto",
    overflowX: "auto",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.06)",
  };
}

const tableElementStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

const stickyThStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  background: "#111827",
  color: "#94a3b8",
  textAlign: "left",
  padding: "8px 10px",
  fontSize: 12,
  fontWeight: 700,
  zIndex: 1,
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 13,
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  verticalAlign: "middle",
};

function zebraRowStyle(index: number): React.CSSProperties {
  return {
    background: index % 2 === 1 ? "rgba(255,255,255,0.015)" : "transparent",
  };
}

function ChevronIcon({ open }: { open: boolean }) {
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
      style={{
        flexShrink: 0,
        color: "#94a3b8",
        transform: open ? "rotate(180deg)" : "rotate(-90deg)",
        transition: "transform 0.15s ease",
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
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
}) {
  return (
    <button
      type="button"
      className="lp-section-header"
      onClick={onToggle}
      aria-expanded={open}
      style={collapsibleHeaderStyle}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <ChevronIcon open={open} />
        <span className="lp-section-header-title" style={{ color: "#f8fafc", fontSize: 15, fontWeight: 800 }}>
          {title}
        </span>
      </span>
      {badge}
    </button>
  );
}

const LienPayoffAccessoriesView: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  const [fetchHeaders, setFetchHeaders] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const [collapsedSections, setCollapsedSections] = useState<Record<CollapsibleSectionKey, boolean>>({
    answerResolution: false,
    warnings: false,
    finalRows: false,
    payloadPreview: false,
  });

  const detectedDealerId = useMemo(
    () => extractDealerIdFromHeaders(fetchHeaders) ?? "",
    [fetchHeaders]
  );

  const toggleSection = useCallback((key: CollapsibleSectionKey) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const expandAllSections = useCallback(() => {
    setCollapsedSections({
      answerResolution: false,
      warnings: false,
      finalRows: false,
      payloadPreview: false,
    });
  }, []);

  const collapseAllSections = useCallback(() => {
    setCollapsedSections({
      answerResolution: true,
      warnings: true,
      finalRows: true,
      payloadPreview: true,
    });
  }, []);

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

    if (!dealerId) throw new Error("Dealer ID not found in enabled Global Headers.");

    const [allBlueprints, allBootstraps] = await Promise.all([
      idbGetAllBlueprints() as Promise<BlueprintRecordLite[]>,
      idbGetAllBootstraps() as Promise<BootstrapRecordLite[]>,
    ]);

    const blueprint = allBlueprints
      .filter((bp) => isAccountingBlueprintForm(bp.formName))
      .filter((bp) => getBlueprintDealerId(bp) === dealerId)
      .sort((a, b) => normalize(b.savedAt).localeCompare(normalize(a.savedAt)))[0] ?? null;

    if (!blueprint) throw new Error(`No accounting blueprint found in IndexedDB for dealer ${dealerId}.`);

    const bootstrap = allBootstraps
      .filter((bs) => getBootstrapDealerId(bs) === dealerId)
      .sort((a, b) => normalize(b.savedAt).localeCompare(normalize(a.savedAt)))[0] ?? null;

    if (!bootstrap) throw new Error(`No bootstrap snapshot found in IndexedDB for dealer ${dealerId}.`);

    const answers = buildBlueprintAnswers(blueprint, bootstrap, dealerId);

    const missing = answers.filter((a) => !a.decodedValue);
    if (missing.length > 0) {
      warnings.push(`Blueprint answers missing: ${missing.map((m) => m.label).join(" | ")}`);
    }

    const unmatched = answers.filter((a) => a.decodedValue && !a.account);
    if (unmatched.length > 0) {
      warnings.push(
        `Blueprint answers could not be matched to bootstrap GL account: ${unmatched
          .map((m) => `${m.label} => ${m.decodedValue}`)
          .join(" | ")}`
      );
    }

    const rows = buildRows(dealerId, answers, warnings);
    const hasAccessories = rows.some(
      (row) => row.payableType === "ACCESSORIES_DUE" && row.matched && row.mappedAssetId
    );
    const payloadName = hasAccessories ? "Accessories and Lien Payoff" : "Lien Payoff";
    const payload = buildPayload(dealerId, rows, payloadName);

    const payloadCount = Array.isArray((payload as any)?.mappingList)
      ? (payload as any).mappingList.length
      : 0;

    if (payloadCount === 0) {
      warnings.push("Payload mappingList is empty. No matched payable rows found.");
    }

    const proxyRes = await fetch("http://localhost:4000/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: GET_RULES_URL,
        method: "GET",
        headers: enabledHeaders,
        timeout: 60000,
      }),
    });

    if (!proxyRes.ok) throw new Error(`Rule lookup failed with HTTP ${proxyRes.status}`);

    const proxyJson = (await proxyRes.json()) as {
      status?: number;
      statusText?: string;
      body?: unknown;
      data?: unknown;
    };

    if ((proxyJson.status ?? 200) >= 400) {
      throw new Error(`Rule lookup failed: ${proxyJson.status ?? ""} ${proxyJson.statusText ?? ""}`.trim());
    }

    const actualPayload = proxyJson.body ?? proxyJson.data ?? proxyJson;
    const existingRule = findExistingPayablesRule(actualPayload);

    if (existingRule) {
      warnings.push(`Existing PAYABLES rule found: ${existingRule.name} (${existingRule.id}). Create will be skipped.`);
    }

    return {
      dealerId,
      blueprint,
      bootstrap,
      answers,
      rows,
      payload,
      payloadName,
      existingRule,
      warnings,
    };
  }, []);

  const handleAnalyze = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      refreshHeaders();
      const result = await buildConfig();
      setBuildResult(result);

      const matchedCount = result.rows.filter((row) => row.matched).length;
      const unmatchedCount = result.rows.filter((row) => !row.matched).length;
      const payloadCount = Array.isArray((result.payload as any)?.mappingList)
        ? (result.payload as any).mappingList.length
        : 0;

      setMessage({
        ok: true,
        text: result.existingRule
          ? `✅ Existing PAYABLES rule found (${result.existingRule.id}). Preview ready. Matched rows: ${matchedCount}, Unmatched rows: ${unmatchedCount}, Payload rows: ${payloadCount}.`
          : `✅ Lien Payoff & Accessories configuration prepared. Matched rows: ${matchedCount}, Unmatched rows: ${unmatchedCount}, Payload rows: ${payloadCount}.`,
      });
    } catch (e: unknown) {
      setBuildResult(null);
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Failed to analyze Lien Payoff & Accessories config",
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
      const result = buildResult ?? (await buildConfig());
      setBuildResult(result);

      if (result.existingRule) {
        setMessage({
          ok: false,
          text: `Create skipped. Existing PAYABLES rule already exists with id ${result.existingRule.id}.`,
        });
        return;
      }

      const mappingList = Array.isArray((result.payload as any)?.mappingList)
        ? (result.payload as any).mappingList
        : [];

      if (mappingList.length === 0) throw new Error("Payload mappingList is empty. Nothing to create.");

      const enabledHeaders = toEnabledHeaderMap(loadGlobalHeaders());

      const proxyRes = await fetch("http://localhost:4000/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: CREATE_RULE_URL,
          method: "POST",
          headers: enabledHeaders,
          body: result.payload,
          timeout: 60000,
        }),
      });

      if (!proxyRes.ok) throw new Error(`Create request failed with HTTP ${proxyRes.status}`);

      const proxyJson = (await proxyRes.json()) as {
        status?: number;
        statusText?: string;
      };

      if ((proxyJson.status ?? 200) >= 400) {
        throw new Error(`Create request failed: ${proxyJson.status ?? ""} ${proxyJson.statusText ?? ""}`.trim());
      }

      setMessage({
        ok: true,
        text: `✅ Payables mapping rule created successfully for dealer ${result.dealerId}.`,
      });

      const refreshed = await buildConfig();
      setBuildResult(refreshed);
    } catch (e: unknown) {
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Failed to create Payables rule",
      });
    } finally {
      setRunning(false);
    }
  }, [buildConfig, buildResult, refreshHeaders]);

  const matchedCount = buildResult?.rows.filter((row) => row.matched).length ?? 0;
  const unmatchedCount = buildResult?.rows.filter((row) => !row.matched).length ?? 0;
  const payloadCount = Array.isArray((buildResult?.payload as any)?.mappingList)
    ? (buildResult?.payload as any).mappingList.length
    : 0;

  return (
    <div style={sectionStyle} className="lp-scroll">
      <style>{`
        .lp-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .lp-scroll::-webkit-scrollbar-track { background: transparent; }
        .lp-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 8px; }
        .lp-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.24); }
        .lp-section-header:hover { background: rgba(255,255,255,0.04); }
        .lp-section-header:hover .lp-section-header-title { color: #ffffff; }
      `}</style>

      <GlamSectionHeader
        title="Lien Payoff & Accessories"
        description="Auto build Payables mapping from Blueprint + Bootstrap"
        breadcrumb="Accounting / Variable Operations / Payables / Lien Payoff & Accessories"
      />

      <div style={cardStyle}>
        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800, marginBottom: 6 }}>
              Auto Configure
            </div>
            <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>
              Extracts Lien Payoff and Accessories Due answers from Blueprint and maps them to Bootstrap GL accounts.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={badgeStyle}>Dealer ID: <b style={{ color: detectedDealerId ? "#86efac" : "#fca5a5" }}>{detectedDealerId || "Not found"}</b></span>
            <span style={badgeStyle}>Module: <b style={{ color: "#f8fafc" }}>PAYABLES</b></span>
            <span style={badgeStyle}>Rule Asset: <b style={{ color: "#f8fafc" }}>GLACCOUNT</b></span>
            <span style={badgeStyle}>Mapping Column: <b style={{ color: "#f8fafc" }}>PAYABLE_TYPE</b></span>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn-secondary btn-sm" onClick={refreshHeaders} disabled={loading || running}>⟳ Refresh Headers</button>
            <button className="btn-secondary btn-sm" onClick={() => void handleAnalyze()} disabled={loading || running || !detectedDealerId}>
              {loading ? "Analyzing..." : "🧪 Analyze Configuration"}
            </button>
            <button className="btn-primary" onClick={() => void handleCreate()} disabled={loading || running || !detectedDealerId}>
              {running ? "Creating..." : "⚙ Auto Configure Payables"}
            </button>
            {buildResult?.payload ? (
              <button className="btn-secondary btn-sm" onClick={() => setPreviewOpen((v) => !v)}>
                {previewOpen ? "Hide Payload" : "Show Payload"}
              </button>
            ) : null}
          </div>

          {message ? (
            <div
              style={{
                borderRadius: 12,
                padding: "10px 12px",
                fontSize: 13,
                color: message.ok ? "#bbf7d0" : "#fecaca",
                background: message.ok ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
                border: message.ok ? "1px solid rgba(34,197,94,0.22)" : "1px solid rgba(239,68,68,0.22)",
              }}
            >
              {message.text}
            </div>
          ) : null}

          {buildResult ? (
            <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
              <div style={statGridStyle}>
                <div style={cardStyle}><div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>Dealer</div><div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800 }}>{buildResult.dealerId}</div></div>
                <div style={cardStyle}><div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>Blueprint Answers</div><div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800 }}>{buildResult.answers.length}</div></div>
                <div style={cardStyle}><div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>Matched Rows</div><div style={{ color: "#30d158", fontSize: 16, fontWeight: 800 }}>{matchedCount}</div></div>
                <div style={cardStyle}><div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>Unmatched Rows</div><div style={{ color: "#ff9f0a", fontSize: 16, fontWeight: 800 }}>{unmatchedCount}</div></div>
                <div style={cardStyle}><div style={{ color: "#94a3b8", fontSize: 12, marginBottom: 6 }}>Payload Rows</div><div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800 }}>{payloadCount}</div></div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="btn-secondary btn-sm" onClick={expandAllSections} type="button">Expand All</button>
                <button className="btn-secondary btn-sm" onClick={collapseAllSections} type="button">Collapse All</button>
              </div>

              <div style={cardStyle}>
                <SectionHeader
                  title="Blueprint Answer Resolution"
                  open={!collapsedSections.answerResolution}
                  onToggle={() => toggleSection("answerResolution")}
                  badge={<span style={rowCountBadgeStyle}>{buildResult.answers.length} row{buildResult.answers.length === 1 ? "" : "s"}</span>}
                />
                {!collapsedSections.answerResolution ? (
                  <div className="lp-scroll" style={tableScrollWrapStyle(340)}>
                    <table className="bx-table" style={tableElementStyle}>
                      <thead>
                        <tr>
                          <th style={stickyThStyle}>Question</th>
                          <th style={stickyThStyle}>Decoded Value</th>
                          <th style={stickyThStyle}>Token</th>
                          <th style={stickyThStyle}>Account #</th>
                          <th style={stickyThStyle}>Account Name</th>
                          <th style={stickyThStyle}>ID</th>
                          <th style={stickyThStyle}>Terminology</th>
                          <th style={stickyThStyle}>Matched</th>
                        </tr>
                      </thead>
                      <tbody>
                        {buildResult.answers.map((row, index) => (
                          <tr key={row.key} style={zebraRowStyle(index)}>
                            <td style={tdStyle}>{row.label}</td>
                            <td style={tdStyle}>{row.decodedValue || "—"}</td>
                            <td style={tdStyle}><code style={monoStyle}>{row.extractedToken || "—"}</code></td>
                            <td style={tdStyle}><code style={monoStyle}>{row.account?.accountNumber || "—"}</code></td>
                            <td style={tdStyle}>{row.account?.accountName || "—"}</td>
                            <td style={tdStyle}><code style={monoStyle}>{row.account?.id || "—"}</code></td>
                            <td style={tdStyle}>{row.terminologyHits.length > 0 ? row.terminologyHits.join(", ") : "—"}</td>
                            <td style={tdStyle}>
                              <span style={{ ...badgeStyle, color: row.account ? "#30d158" : "#ff453a" }}>
                                {row.account ? "YES" : "NO"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>

              {buildResult.warnings.length > 0 ? (
                <div style={cardStyle}>
                  <SectionHeader
                    title="Warnings"
                    open={!collapsedSections.warnings}
                    onToggle={() => toggleSection("warnings")}
                    badge={<span style={rowCountBadgeStyle}>{buildResult.warnings.length} warning{buildResult.warnings.length === 1 ? "" : "s"}</span>}
                  />
                  {!collapsedSections.warnings ? (
                    <div style={{ maxHeight: 220, overflow: "auto", paddingRight: 4 }}>
                      <ul style={{ margin: 0, paddingLeft: 18, color: "#fbbf24", fontSize: 13 }}>
                        {buildResult.warnings.map((warning, index) => (
                          <li key={index} style={{ marginBottom: 8 }}>{warning}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div style={cardStyle}>
                <SectionHeader
                  title="Final Mapping Rows"
                  open={!collapsedSections.finalRows}
                  onToggle={() => toggleSection("finalRows")}
                  badge={<span style={rowCountBadgeStyle}>{buildResult.rows.length} row{buildResult.rows.length === 1 ? "" : "s"}</span>}
                />
                {!collapsedSections.finalRows ? (
                  <div className="lp-scroll" style={tableScrollWrapStyle(320)}>
                    <table className="bx-table" style={tableElementStyle}>
                      <thead>
                        <tr>
                          <th style={stickyThStyle}>Payable Type</th>
                          <th style={stickyThStyle}>Mapped Asset ID</th>
                          <th style={stickyThStyle}>Source Question</th>
                          <th style={stickyThStyle}>Source Value</th>
                          <th style={stickyThStyle}>Token</th>
                          <th style={stickyThStyle}>Matched</th>
                        </tr>
                      </thead>
                      <tbody>
                        {buildResult.rows.map((row, index) => (
                          <tr key={`${row.payableType}-${index}`} style={zebraRowStyle(index)}>
                            <td style={tdStyle}>{row.payableType}</td>
                            <td style={tdStyle}><code style={monoStyle}>{row.mappedAssetId || "—"}</code></td>
                            <td style={tdStyle}>{row.sourceLabel || "—"}</td>
                            <td style={tdStyle}>{row.sourceDecodedValue || "—"}</td>
                            <td style={tdStyle}><code style={monoStyle}>{row.sourceToken || "—"}</code></td>
                            <td style={tdStyle}>
                              <span style={{ ...badgeStyle, color: row.matched ? "#30d158" : "#ff453a" }}>
                                {row.matched ? "YES" : "NO"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>

              {previewOpen ? (
                <div style={cardStyle}>
                  <SectionHeader
                    title="Payload Preview"
                    open={!collapsedSections.payloadPreview}
                    onToggle={() => toggleSection("payloadPreview")}
                    badge={<span style={rowCountBadgeStyle}>{payloadCount} payload row{payloadCount === 1 ? "" : "s"}</span>}
                  />
                  {!collapsedSections.payloadPreview ? (
                    <div className="lp-scroll" style={tableScrollWrapStyle(360)}>
                      <pre style={{ ...monoStyle, margin: 0, padding: 10 }}>
                        {JSON.stringify(buildResult.payload, null, 2)}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default LienPayoffAccessoriesView;
