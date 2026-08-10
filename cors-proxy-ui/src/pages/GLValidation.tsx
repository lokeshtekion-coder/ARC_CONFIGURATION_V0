import React, { useEffect, useMemo, useState } from "react";
import { idbGetAllBlueprints } from "../utils/blueprintDb";
import type { BlueprintRecord } from "../utils/blueprintDb";
import { idbGetAllBootstraps } from "../utils/bootstrapDb";
import type { BootstrapRecord } from "../utils/bootstrapDb";
import { getStores } from "../services/storesDb";
import type { StoreRecord } from "../services/storesDb";

interface Props {
  onBack: () => void;
}

type Filter = "all" | "matched" | "unmatched";

interface ValidationResult {
  decodedValue: string;
  extractedToken: string;
  accountNumber: string;
  id: string;
  accountName: string;
  matched: boolean;
  accountName_Detected: string[];
}

interface ValidationMatchRow {
  blueprintKey: string;
  blueprintSavedAt: string;
  blueprintFormName: string;
  blueprintDealerId: string;
  blueprintTekionId: string;
  blueprintDealerName: string;

  matchedDealerId: string;
  bootstrapKey: string | null;
  bootstrapSavedAt: string | null;
  bootstrapDealerName: string | null;

  storeTekionId: string | null;
  storeDealerId: string | null;
  storeDbaName: string | null;

  matchSource: "dealerId" | "storeMapping" | "none";
  matched: boolean;

  blueprint: BlueprintRecord;
  bootstrap: BootstrapRecord | null;
  store: StoreRecord | null;
}

interface FlatRowLike {
  title?: string | null;
  decodedValue?: unknown;
  subsectionName?: string | null;
  sectionName?: string | null;
}

interface BootstrapAccount {
  id: string;
  key?: string;
  accountNumber: string;
  accountName: string;
  accountType?: string;
}

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

function isAccountingBlueprintForm(formName?: string): boolean {
  const name = normalizeLower(formName);
  return (
    name.includes("blueprint") &&
    name.includes("conquest") &&
    name.includes("accounting")
  );
}

function getBootstrapDealerId(record: BootstrapRecord): string {
  const raw = record.data as any;

  const directDealerId = normalize(raw?.dealerId);
  if (directDealerId) return directDealerId;

  const wrappedDealerId = normalize(raw?.bootstrap?.dealerId);
  if (wrappedDealerId) return wrappedDealerId;

  const nestedDealerId = normalize(raw?.data?.dealerId);
  if (nestedDealerId) return nestedDealerId;

  const nestedNestedDealerId = normalize(raw?.data?.data?.dealerId);
  if (nestedNestedDealerId) return nestedNestedDealerId;

  const glDealerId = normalize(raw?.glDealerId);
  if (glDealerId) return glDealerId;

  const nestedGlDealerId = normalize(raw?.data?.glDealerId);
  if (nestedGlDealerId) return nestedGlDealerId;

  const nestedKeys = Object.keys(raw?.data?.allAccounts?.dealerAssetDocMap ?? {});
  if (nestedKeys.length > 0) return normalize(nestedKeys[0]);

  const nestedNestedKeys = Object.keys(raw?.data?.data?.allAccounts?.dealerAssetDocMap ?? {});
  if (nestedNestedKeys.length > 0) return normalize(nestedNestedKeys[0]);

  const rootKeys = Object.keys(raw?.allAccounts?.dealerAssetDocMap ?? {});
  if (rootKeys.length > 0) return normalize(rootKeys[0]);

  return normalize(record.key);
}

function getBlueprintFlatRows(record: BlueprintRecord): FlatRowLike[] {
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
  record: BootstrapRecord | null,
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
    for (const item of arr) {
      pushAccount(item);
    }
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
  pushFromContainer(raw?.body?.data?.allAccounts?.dealerAssetDocMap);
  pushFromContainer(raw?.body?.data?.data?.allAccounts?.dealerAssetDocMap);

  pushFromContainer(raw?.allAccounts?.masterAssetDocMap);
  pushFromContainer(raw?.data?.allAccounts?.masterAssetDocMap);
  pushFromContainer(raw?.data?.data?.allAccounts?.masterAssetDocMap);
  pushFromContainer(raw?.body?.data?.allAccounts?.masterAssetDocMap);
  pushFromContainer(raw?.body?.data?.data?.allAccounts?.masterAssetDocMap);

  const deduped = new Map<string, BootstrapAccount>();
  for (const account of results) {
    const dedupeKey = `${account.id}__${account.key}__${account.accountNumber}__${account.accountName}`;
    if (!deduped.has(dedupeKey)) {
      deduped.set(dedupeKey, account);
    }
  }

  return Array.from(deduped.values());
}

function looksLikeAccountingField(row: FlatRowLike): boolean {
  const text = [
    normalizeLower(row.title),
    normalizeLower(row.sectionName),
    normalizeLower(row.subsectionName),
  ].join(" ");

  if (!text) return false;
  if (!text.includes("account")) return false;
  return true;
}

function isDocumentLikeDecodedValue(value: string): boolean {
  const lower = normalizeLower(value);
  if (!lower) return false;

  if (
    lower.includes('"mediaid"') ||
    lower.includes('"uploadstatus"') ||
    lower.includes('"filename"') ||
    lower.includes('"mimetype"') ||
    lower.includes('"mediacategory"') ||
    lower.includes('"url"') ||
    lower.includes('"mediasize"') ||
    lower.includes('"createdtime"')
  ) {
    return true;
  }

  if (
    lower.includes("application/vnd.ms-excel") ||
    lower.includes("application/pdf") ||
    lower.includes("image/png") ||
    lower.includes("image/jpeg") ||
    lower.includes("http://") ||
    lower.includes("https://") ||
    lower.includes(".xls") ||
    lower.includes(".xlsx") ||
    lower.includes(".pdf") ||
    lower.includes(".doc") ||
    lower.includes(".docx")
  ) {
    return true;
  }

  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      const keys = Object.keys(obj).map((k) => k.toLowerCase());
      const docKeys = [
        "mediaid",
        "uploadstatus",
        "filename",
        "mimetype",
        "mediacategory",
        "url",
        "mediasize",
        "createdtime",
      ];
      if (docKeys.some((key) => keys.includes(key))) {
        return true;
      }
    }
  } catch {
    // ignore
  }

  return false;
}

function extractTokens(value: string): string[] {
  const input = normalize(value);
  if (!input) return [];

  const found = new Set<string>();

  const broadMatches = input.match(/\b[A-Za-z0-9][A-Za-z0-9/_-]{1,}\b/g) ?? [];

  for (const raw of broadMatches) {
    const token = normalize(raw);
    if (!token) continue;

    if (/[0-9]/.test(token)) {
      found.add(token);
    }

    const parts = token.split(/[-/_]/).map((x) => normalize(x)).filter(Boolean);
    for (const part of parts) {
      if (/[0-9]/.test(part)) {
        found.add(part);
      }
    }

    const alphaNumChunks = token.match(/[A-Za-z]*\d+[A-Za-z\d]*/g) ?? [];
    for (const chunk of alphaNumChunks) {
      if (/[0-9]/.test(chunk)) {
        found.add(normalize(chunk));
      }
    }

    const numericChunks = token.match(/\d{2,}/g) ?? [];
    for (const chunk of numericChunks) {
      found.add(normalize(chunk));
    }
  }

  return Array.from(found).sort((a, b) => {
    const aHasSep = /[-/_]/.test(a) ? 1 : 0;
    const bHasSep = /[-/_]/.test(b) ? 1 : 0;
    if (aHasSep !== bHasSep) return bHasSep - aHasSep;

    const aAlpha = /[A-Za-z]/.test(a) ? 1 : 0;
    const bAlpha = /[A-Za-z]/.test(b) ? 1 : 0;
    if (aAlpha !== bAlpha) return bAlpha - aAlpha;

    return b.length - a.length;
  });
}

function detectTerminology(row: FlatRowLike): string[] {
  const text = [
    normalizeLower(row.title),
    normalizeLower(row.sectionName),
    normalizeLower(row.subsectionName),
  ].join(" ");

  const hits: string[] = [];

  if (text.includes("sale")) hits.push("sale");
  if (text.includes("cost")) hits.push("cost");
  if (text.includes("inventory")) hits.push("inventory");
  if (text.includes("receivable")) hits.push("receivable");
  if (text.includes("payable")) hits.push("payable");
  if (text.includes("cash")) hits.push("cash");
  if (text.includes("tax")) hits.push("tax");
  if (text.includes("discount")) hits.push("discount");
  if (text.includes("reserve")) hits.push("reserve");
  if (text.includes("expense")) hits.push("expense");
  if (text.includes("liability")) hits.push("liability");
  if (text.includes("asset")) hits.push("asset");
  if (text.includes("revenue")) hits.push("revenue");

  return hits;
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

  if (accountId.includes(`_${t}_`)) return 800;
  if (accountKey.includes(`_${t}_`)) return 790;

  if (accountId.includes(`-${t}`) || accountKey.includes(`-${t}`)) return 760;

  if (accountNumber.replace(/\s+/g, "") === t.replace(/\s+/g, "")) return 740;

  return -1;
}

function findBestAccountForToken(
  bootstrapAccounts: BootstrapAccount[],
  token: string,
  dealerId: string
): BootstrapAccount | null {
  let best: BootstrapAccount | null = null;
  let bestScore = -1;

  for (const account of bootstrapAccounts) {
    const score = scoreAccountMatch(account, token, dealerId);
    if (score > bestScore) {
      best = account;
      bestScore = score;
    }
  }

  return bestScore >= 0 ? best : null;
}

function buildValidationResults(row: ValidationMatchRow): ValidationResult[] {
  const flatRows = getBlueprintFlatRows(row.blueprint).filter(looksLikeAccountingField);
  const dealerId = normalize(row.matchedDealerId || row.blueprintDealerId || row.storeDealerId);
  const bootstrapAccounts = extractBootstrapAccounts(row.bootstrap, dealerId);

  const results: ValidationResult[] = [];

  console.log("[GL] dealerId", dealerId);
  console.log("[GL] bootstrap count", bootstrapAccounts.length);
  console.log(
    "[GL] bootstrap has 201",
    bootstrapAccounts.find((a) => normalize(a.accountNumber) === "201") ?? null
  );

  for (const flatRow of flatRows) {
    const decodedValue = fmt(flatRow.decodedValue);
    if (!decodedValue) continue;

    if (isDocumentLikeDecodedValue(decodedValue)) {
      console.log("[GL] skipped document/media decoded value", decodedValue);
      continue;
    }

    const tokens = extractTokens(decodedValue);
    const terminology = detectTerminology(flatRow);

    if (tokens.length === 0) {
      results.push({
        decodedValue,
        extractedToken: "",
        accountNumber: "",
        id: "",
        accountName: "",
        matched: false,
        accountName_Detected: terminology,
      });
      continue;
    }

    for (const token of tokens) {
      const normalizedToken = normalize(token);
      const matchedAccount = findBestAccountForToken(
        bootstrapAccounts,
        normalizedToken,
        dealerId
      );

      results.push({
        decodedValue,
        extractedToken: normalizedToken,
        accountNumber: matchedAccount?.accountNumber ?? "",
        id: matchedAccount?.id ?? "",
        accountName: matchedAccount?.accountName ?? "",
        matched: Boolean(matchedAccount),
        accountName_Detected: terminology,
      });
    }
  }

  return results;
}

export const GLValidation: React.FC<Props> = ({ onBack }) => {
  const [blueprints, setBlueprints] = useState<BlueprintRecord[]>([]);
  const [bootstraps, setBootstraps] = useState<BootstrapRecord[]>([]);
  const [stores, setStores] = useState<StoreRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const [selectedPairKey, setSelectedPairKey] = useState("");
  const [results, setResults] = useState<ValidationResult[]>([]);
  const [resultFilter, setResultFilter] = useState<Filter>("all");

  useEffect(() => {
    let cancelled = false;

    async function loadAll(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const [bp, bs, st] = await Promise.all([
          idbGetAllBlueprints(),
          idbGetAllBootstraps(),
          getStores(),
        ]);

        if (cancelled) return;

        setBlueprints(bp);
        setBootstraps(bs);
        setStores(st);
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load IndexedDB data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadAll();

    return () => {
      cancelled = true;
    };
  }, []);

  const accountingBlueprints = useMemo(
    () => blueprints.filter((row) => isAccountingBlueprintForm(row.formName)),
    [blueprints]
  );

  const rows = useMemo<ValidationMatchRow[]>(() => {
    const storeByTekionId = new Map<string, StoreRecord>();
    const latestBootstrapByDealerId = new Map<string, BootstrapRecord>();

    for (const store of stores) {
      const tekionId = normalize(store.tekion_id);
      if (tekionId) {
        storeByTekionId.set(tekionId, store);
      }
    }

    for (const bootstrap of bootstraps) {
      const dealerId = getBootstrapDealerId(bootstrap);
      if (!dealerId) continue;

      const existing = latestBootstrapByDealerId.get(dealerId);
      if (!existing) {
        latestBootstrapByDealerId.set(dealerId, bootstrap);
        continue;
      }

      const existingTime = normalize(existing.savedAt);
      const nextTime = normalize(bootstrap.savedAt);

      if (nextTime > existingTime) {
        latestBootstrapByDealerId.set(dealerId, bootstrap);
      }
    }

    return accountingBlueprints.map((bp) => {
      const blueprintDealerId = normalize(bp.dealerId);
      const blueprintTekionId = normalize(bp.tekionId);
      const blueprintDealerName = normalize(bp.dealerName);
      const blueprintFormName = normalize(bp.formName);

      const storeFromTekion = blueprintTekionId
        ? storeByTekionId.get(blueprintTekionId) ?? null
        : null;

      const derivedDealerId =
        blueprintDealerId || normalize(storeFromTekion?.dealer_id);

      let matchedBootstrap: BootstrapRecord | null = null;
      let matchSource: ValidationMatchRow["matchSource"] = "none";

      if (blueprintDealerId && latestBootstrapByDealerId.has(blueprintDealerId)) {
        matchedBootstrap = latestBootstrapByDealerId.get(blueprintDealerId) ?? null;
        matchSource = "dealerId";
      } else if (derivedDealerId && latestBootstrapByDealerId.has(derivedDealerId)) {
        matchedBootstrap = latestBootstrapByDealerId.get(derivedDealerId) ?? null;
        matchSource = "storeMapping";
      }

      return {
        blueprintKey: bp.key,
        blueprintSavedAt: bp.savedAt,
        blueprintFormName,
        blueprintDealerId,
        blueprintTekionId,
        blueprintDealerName,

        matchedDealerId: derivedDealerId,
        bootstrapKey: matchedBootstrap?.key ?? null,
        bootstrapSavedAt: matchedBootstrap?.savedAt ?? null,
        bootstrapDealerName: matchedBootstrap?.dealerName ?? null,

        storeTekionId: normalize(storeFromTekion?.tekion_id) || null,
        storeDealerId: normalize(storeFromTekion?.dealer_id) || null,
        storeDbaName: normalize(storeFromTekion?.dba_name) || null,

        matchSource,
        matched: Boolean(matchedBootstrap),

        blueprint: bp,
        bootstrap: matchedBootstrap,
        store: storeFromTekion,
      };
    });
  }, [accountingBlueprints, bootstraps, stores]);

  useEffect(() => {
    const firstMatched = rows.find((row) => row.matched);
    if (!selectedPairKey && firstMatched) {
      setSelectedPairKey(`${firstMatched.blueprintKey}__${firstMatched.bootstrapKey ?? "none"}`);
    }
  }, [rows, selectedPairKey]);

  const matchedCount = rows.filter((r) => r.matched).length;
  const unmatchedCount = rows.filter((r) => !r.matched).length;

  const filteredRows = useMemo(() => {
    return rows
      .filter((r) =>
        filter === "all" ? true :
        filter === "matched" ? r.matched :
        !r.matched
      )
      .filter((r) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();

        return [
          r.blueprintFormName,
          r.blueprintDealerId,
          r.blueprintTekionId,
          r.blueprintDealerName,
          r.matchedDealerId,
          r.storeTekionId,
          r.storeDealerId,
          r.storeDbaName,
          r.bootstrapDealerName,
          r.bootstrapKey,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(q));
      });
  }, [rows, filter, search]);

  const selectedPair = useMemo(() => {
    return (
      rows.find(
        (row) => `${row.blueprintKey}__${row.bootstrapKey ?? "none"}` === selectedPairKey
      ) ?? null
    );
  }, [rows, selectedPairKey]);

  const handleRunValidation = (): void => {
    if (!selectedPair || !selectedPair.matched) {
      setResults([]);
      return;
    }

    const next = buildValidationResults(selectedPair);
    setResults(next);
    setResultFilter("all");
  };

  const resultMatched = results.filter((r) => r.matched).length;
  const resultUnmatched = results.filter((r) => !r.matched).length;
  const resultMatchPct =
    results.length > 0 ? ((resultMatched / results.length) * 100).toFixed(1) : "0.0";

  const filteredResults = useMemo(() => {
    return results
      .filter((r) =>
        resultFilter === "all" ? true :
        resultFilter === "matched" ? r.matched :
        !r.matched
      )
      .filter((r) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          r.extractedToken.toLowerCase().includes(q) ||
          r.accountNumber.toLowerCase().includes(q) ||
          r.accountName.toLowerCase().includes(q) ||
          r.decodedValue.toLowerCase().includes(q)
        );
      });
  }, [results, resultFilter, search]);

  return (
    <div className="bx-shell">
      <div className="bx-header">
        <div className="bx-header-left">
          <button className="btn-secondary btn-sm" onClick={onBack}>
            ← Back
          </button>
          <span className="bx-title">🔍 GL Account Validation</span>
        </div>

        {!loading && (
          <div className="bx-stats-row">
            <span className="bx-stat">
              Accounting Blueprints: <b>{accountingBlueprints.length}</b>
            </span>
            <span className="bx-stat" style={{ color: "#30d158" }}>
              Pair Matched: <b>{matchedCount}</b>
            </span>
            <span className="bx-stat" style={{ color: "#ff453a" }}>
              Pair Unmatched: <b>{unmatchedCount}</b>
            </span>
            {results.length > 0 && (
              <>
                <span className="bx-stat" style={{ color: "#30d158" }}>
                  GL Matched: <b>{resultMatched} ({resultMatchPct}%)</b>
                </span>
                <span className="bx-stat" style={{ color: "#ff453a" }}>
                  GL Unmatched: <b>{resultUnmatched}</b>
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="bx-body">
        <div className="bx-input-panel">
          <span className="bx-panel-label">IndexedDB Sources</span>

          <div className="bx-legend">
            <div className="bx-legend-row">
              <span className="bx-legend-key">Blueprints</span>
              <span className="bx-muted">{blueprints.length}</span>
            </div>
            <div className="bx-legend-row">
              <span className="bx-legend-key">Accounting Blueprints</span>
              <span className="bx-muted">{accountingBlueprints.length}</span>
            </div>
            <div className="bx-legend-row">
              <span className="bx-legend-key">Bootstraps</span>
              <span className="bx-muted">{bootstraps.length}</span>
            </div>
            <div className="bx-legend-row">
              <span className="bx-legend-key">Stores</span>
              <span className="bx-muted">{stores.length}</span>
            </div>
          </div>

          {error && <div className="bx-error">⚠ {error}</div>}

          <div className="bx-input-actions">
            <button
              className="btn-secondary btn-sm"
              onClick={() => window.location.reload()}
              disabled={loading}
            >
              {loading ? "Loading..." : "⟳ Reload"}
            </button>
          </div>

          <div className="bx-legend" style={{ marginTop: 14 }}>
            <div className="bx-legend-title">Match Rules</div>
            <div className="bx-legend-row">
              <span className="bx-legend-key">dealerId</span>
              <span className="bx-muted">blueprint.dealerId → bootstrap dealerId</span>
            </div>
            <div className="bx-legend-row">
              <span className="bx-legend-key">storeMapping</span>
              <span className="bx-muted">blueprint.tekionId → stores.dealer_id → bootstrap dealerId</span>
            </div>
            <div className="bx-legend-row">
              <span className="bx-legend-key">smart tokenization</span>
              <span className="bx-muted">supports 201, K448, 452-K448, 7269_201, etc.</span>
            </div>
            <div className="bx-legend-row">
              <span className="bx-legend-key">exclude noise</span>
              <span className="bx-muted">skips media/document/url/json blob values</span>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <span className="bx-panel-label">Select Matched Pair</span>
            <select
              className="bx-json-textarea"
              style={{ minHeight: "unset", height: "38px", padding: "6px 10px" }}
              value={selectedPairKey}
              onChange={(e) => {
                setSelectedPairKey(e.target.value);
                setResults([]);
              }}
            >
              <option value="">— Select Pair —</option>
              {rows
                .filter((row) => row.matched)
                .map((row) => {
                  const value = `${row.blueprintKey}__${row.bootstrapKey ?? "none"}`;
                  const label = `${row.matchedDealerId || row.blueprintDealerId || "—"} | ${row.blueprintFormName || "—"}`;
                  return (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  );
                })}
            </select>
          </div>

          {selectedPair && (
            <div
              style={{
                marginTop: 12,
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
                display: "grid",
                gap: 6,
                fontSize: 12,
              }}
            >
              <div><b>Dealer:</b> {selectedPair.matchedDealerId || "—"}</div>
              <div><b>Tekion:</b> {selectedPair.blueprintTekionId || "—"}</div>
              <div><b>Form:</b> {selectedPair.blueprintFormName || "—"}</div>
              <div><b>Blueprint Saved:</b> {selectedPair.blueprintSavedAt || "—"}</div>
              <div><b>Bootstrap Saved:</b> {selectedPair.bootstrapSavedAt || "—"}</div>
            </div>
          )}

          <div className="bx-input-actions" style={{ marginTop: 12 }}>
            <button
              className="btn-primary"
              onClick={handleRunValidation}
              disabled={!selectedPair || !selectedPair.matched}
            >
              ▶ Run GL Validation
            </button>
            {results.length > 0 && (
              <button
                className="btn-secondary btn-sm"
                onClick={() => {
                  setResults([]);
                  setResultFilter("all");
                }}
              >
                Clear Results
              </button>
            )}
          </div>
        </div>

        <div className="bx-output-panel">
          {loading ? (
            <div className="bx-empty-state">
              <span className="bx-empty-icon">⏳</span>
              <span>Loading IndexedDB data…</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="bx-empty-state">
              <span className="bx-empty-icon">📭</span>
              <span>No Blueprint conquest Accounting records found</span>
              <span className="bx-empty-sub">
                Save accounting blueprint responses first
              </span>
            </div>
          ) : results.length === 0 ? (
            <>
              <div className="bx-tabs-bar">
                <div style={{ display: "flex", gap: 6 }}>
                  {(["all", "matched", "unmatched"] as Filter[]).map((f) => {
                    const count =
                      f === "all" ? rows.length :
                      f === "matched" ? matchedCount :
                      unmatchedCount;

                    return (
                      <button
                        key={f}
                        className={`tab-btn ${filter === f ? "tab-active" : ""}`}
                        onClick={() => setFilter(f)}
                      >
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                        <span className="bx-tab-count">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bx-output-content">
                <div className="bx-search-bar">
                  <input
                    className="bx-search-input"
                    placeholder="Search dealerId, tekionId, dealer name, form name…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <span className="bx-count-badge">{filteredRows.length} rows</span>
                </div>

                <div className="bx-table-wrap">
                  <table className="bx-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Blueprint Form</th>
                        <th>Blueprint Dealer</th>
                        <th>Tekion ID</th>
                        <th>Store Dealer</th>
                        <th>Matched Dealer</th>
                        <th>Bootstrap</th>
                        <th>Match Source</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row, i) => (
                        <tr key={`${row.blueprintKey}__${row.bootstrapKey ?? "none"}`}>
                          <td className="bx-muted bx-mono">{i + 1}</td>

                          <td>
                            <div style={{ fontWeight: 600 }}>
                              {row.blueprintFormName || "—"}
                            </div>
                            <div className="bx-muted" style={{ fontSize: 12 }}>
                              saved: {row.blueprintSavedAt || "—"}
                            </div>
                          </td>

                          <td>
                            <div>{row.blueprintDealerId || "—"}</div>
                            <div className="bx-muted" style={{ fontSize: 12 }}>
                              {row.blueprintDealerName || "—"}
                            </div>
                          </td>

                          <td className="bx-mono">{row.blueprintTekionId || "—"}</td>

                          <td>
                            <div>{row.storeDealerId || "—"}</div>
                            <div className="bx-muted" style={{ fontSize: 12 }}>
                              {row.storeDbaName || "—"}
                            </div>
                          </td>

                          <td className="bx-mono">{row.matchedDealerId || "—"}</td>

                          <td>
                            {row.bootstrapKey ? (
                              <>
                                <div className="bx-mono">{row.bootstrapDealerName || "—"}</div>
                                <div className="bx-muted" style={{ fontSize: 12 }}>
                                  saved: {row.bootstrapSavedAt || "—"}
                                </div>
                              </>
                            ) : (
                              <span className="bx-muted">—</span>
                            )}
                          </td>

                          <td>
                            <span
                              className="bx-type-badge"
                              style={
                                row.matchSource === "dealerId"
                                  ? {
                                      color: "#30d158",
                                      borderColor: "rgba(48,209,88,.3)",
                                      background: "rgba(48,209,88,.08)",
                                    }
                                  : row.matchSource === "storeMapping"
                                  ? {
                                      color: "#0a84ff",
                                      borderColor: "rgba(10,132,255,.3)",
                                      background: "rgba(10,132,255,.08)",
                                    }
                                  : {
                                      color: "#98989d",
                                      borderColor: "rgba(152,152,157,.3)",
                                      background: "rgba(152,152,157,.08)",
                                    }
                              }
                            >
                              {row.matchSource}
                            </span>
                          </td>

                          <td>
                            <span
                              className="bx-type-badge"
                              style={
                                row.matched
                                  ? {
                                      color: "#30d158",
                                      borderColor: "rgba(48,209,88,.3)",
                                      background: "rgba(48,209,88,.08)",
                                    }
                                  : {
                                      color: "#ff453a",
                                      borderColor: "rgba(255,69,58,.3)",
                                      background: "rgba(255,69,58,.08)",
                                    }
                              }
                            >
                              {row.matched ? "✓ Matched" : "✗ Unmatched"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 12, fontSize: 12, color: "#94a3b8" }}>
                  Select one matched pair and click Run GL Validation.
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="bx-tabs-bar">
                <div style={{ display: "flex", gap: "6px" }}>
                  {(["all", "matched", "unmatched"] as Filter[]).map((f) => {
                    const count =
                      f === "all"
                        ? results.length
                        : f === "matched"
                        ? resultMatched
                        : resultUnmatched;

                    return (
                      <button
                        key={f}
                        className={`tab-btn ${resultFilter === f ? "tab-active" : ""}`}
                        onClick={() => setResultFilter(f)}
                      >
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                        <span className="bx-tab-count">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bx-output-content">
                <div className="bx-search-bar">
                  <input
                    className="bx-search-input"
                    placeholder="Search token, account #, account name…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <span className="bx-count-badge">{filteredResults.length} rows</span>
                </div>

                <div className="bx-table-wrap">
                  <table className="bx-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Decoded Value</th>
                        <th>Token</th>
                        <th>Account #</th>
                        <th>Account Name</th>
                        <th>Matched</th>
                        <th>Terminology Detected</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredResults.map((r, i) => (
                        <tr key={`${r.extractedToken}-${r.id}-${i}`}>
                          <td className="bx-muted bx-mono">{i + 1}</td>
                          <td>{r.decodedValue || <span className="bx-muted">—</span>}</td>
                          <td className="bx-mono">{r.extractedToken || <span className="bx-muted">—</span>}</td>
                          <td className="bx-mono">{r.accountNumber || <span className="bx-muted">—</span>}</td>
                          <td>{r.accountName || <span className="bx-muted">—</span>}</td>
                          <td>
                            <span
                              className="bx-type-badge"
                              style={
                                r.matched
                                  ? {
                                      color: "#30d158",
                                      borderColor: "rgba(48,209,88,.3)",
                                      background: "rgba(48,209,88,.08)",
                                    }
                                  : {
                                      color: "#ff453a",
                                      borderColor: "rgba(255,69,58,.3)",
                                      background: "rgba(255,69,58,.08)",
                                    }
                              }
                            >
                              {r.matched ? "✓ Yes" : "✗ No"}
                            </span>
                          </td>
                          <td>
                            {r.accountName_Detected.length > 0 ? (
                              r.accountName_Detected.map((t, j) => (
                                <span
                                  key={j}
                                  className="bx-type-badge"
                                  style={{
                                    marginRight: 4,
                                    color: "#0a84ff",
                                    borderColor: "rgba(10,132,255,.3)",
                                    background: "rgba(10,132,255,.08)",
                                  }}
                                >
                                  {t}
                                </span>
                              ))
                            ) : (
                              <span className="bx-muted">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: 12, fontSize: 12, color: "#94a3b8" }}>
                  Smart validation excludes media/document/url blobs and supports composite values like 452-K448 by testing split token parts such as K448 and 452.
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default GLValidation;
