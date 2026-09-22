import React, { useCallback, useEffect, useMemo, useState } from "react";
import { GlamSectionHeader } from "../../../components/glamShared";
import { useAccountingBlueprint } from "../../../../../../Context/Blueprint_Accounting_Context/AccountingBlueprintContext";
import { idbGetAllBlueprints } from "../../../../../../utils/blueprintDb";
import {
  idbFindBootstrapByDealerId,
  type BootstrapRecord,
} from "../../../../../../utils/bootstrapDb";
import { loadGlobalHeaders } from "../../../../../../services/tekionApiSettings";
import {
  idbSaveGlamMappingDraft,
  type GlamMappingDraftPayload,
  type GlamMappingRow,
} from "../../../../../../utils/glamMappingDraftDb";

const GLAM_MAPPING_RULE_URL =
  "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/rule";

const MODULE = "PAYABLES";
const NAME = "Lien Payoff";
const RULE_ASSET = "GLACCOUNT";

const PAYABLE_RULES = [
  {
    mappingValue: "LIEN_PAYOFF",
    label: "Lien Payoff",
    blueprintTitle: "Vehicle Sales Payables",
    blueprintQuestion: "Lien Payoff GL Account",
    sectionVariants: ["vehicle sales payables"],
  },
  {
    mappingValue: "ACCESSORIES_DUE",
    label: "Accessories Due",
    blueprintTitle: "Service - Payment Method - Internal",
    blueprintQuestion: "We Owe GL Account Number",
    sectionVariants: [
      "service payment method internal",
      "payment method service internal",
      "payment methods service internal",
      "service internal payment method",
    ],
  },
] as const;

type PayableType = (typeof PAYABLE_RULES)[number]["mappingValue"];

type BlueprintFlatRow = {
  title?: string | null;
  decodedValue?: unknown;
  subsectionName?: string | null;
  sectionName?: string | null;
};

type SavedBlueprintRecord = {
  dealerId?: string;
  formName?: string;
  savedAt?: string;
  data?: unknown;
  decodedResponse?: unknown;
};

type BootstrapAccount = {
  accountNumber: string;
  accountName: string;
  id: string;
  key: string;
  active: boolean;
};

type MappingDefinition = {
  mappingValue: PayableType;
  label: string;
  blueprintTitle: string;
  blueprintQuestion: string;
  blueprintValue: string;
  accountNumber: string | null;
  bootstrapAccount: BootstrapAccount | null;
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeLower(value: unknown): string {
  return normalize(value).toLowerCase();
}

function normalizeComparable(value: unknown): string {
  return normalizeLower(value)
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function generateRowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `lien-payoff-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getDealerIdFromHeaders(): string {
  for (const header of loadGlobalHeaders()) {
    if (!header.enabled) continue;

    const key = normalizeLower(header.key);
    const value = normalize(header.value);

    if (
      value &&
      ["dealerid", "dealer-id", "x-dealer-id", "x-dealerid"].includes(key)
    ) {
      return value;
    }
  }

  return "";
}

function extractGlAccountNumber(value: unknown): string | null {
  const text = normalize(value);

  if (!text) {
    return null;
  }

  const lowered = normalizeLower(text);

  if (
    lowered === "n/a" ||
    lowered === "na" ||
    lowered === "none" ||
    lowered === "null" ||
    lowered === "not applicable"
  ) {
    return null;
  }

  const match = text.match(/\d{2,}/);

  return match?.[0] ?? null;
}

function isAccountingBlueprintForm(formName?: string): boolean {
  const normalized = normalizeLower(formName);

  return (
    normalized.includes("blueprint") &&
    normalized.includes("accounting") &&
    normalized.includes("conquest")
  );
}

function getFlatRowsFromRecord(record: SavedBlueprintRecord): BlueprintFlatRow[] {
  const decoded = record.decodedResponse as
    | {
        populatedFlatRows?: BlueprintFlatRow[];
        allFields?: BlueprintFlatRow[];
      }
    | undefined;

  if (Array.isArray(decoded?.populatedFlatRows)) {
    return decoded.populatedFlatRows;
  }

  if (Array.isArray(decoded?.allFields)) {
    return decoded.allFields;
  }

  const data = record.data as
    | {
        populatedFlatRows?: BlueprintFlatRow[];
        allFields?: BlueprintFlatRow[];
      }
    | undefined;

  if (Array.isArray(data?.populatedFlatRows)) {
    return data.populatedFlatRows;
  }

  if (Array.isArray(data?.allFields)) {
    return data.allFields;
  }

  return [];
}

async function getIndexedDbBlueprintRows(
  dealerId: string
): Promise<BlueprintFlatRow[]> {
  const records =
    (await idbGetAllBlueprints()) as unknown as SavedBlueprintRecord[];

  const candidates = records
    .filter((record) => normalize(record.dealerId) === dealerId)
    .filter((record) => {
      if (!record.formName) {
        return true;
      }

      return isAccountingBlueprintForm(record.formName);
    })
    .sort((left, right) =>
      normalize(right.savedAt).localeCompare(normalize(left.savedAt))
    );

  for (const candidate of candidates) {
    const rows = getFlatRowsFromRecord(candidate);

    if (rows.length > 0) {
      return rows;
    }
  }

  return [];
}

function sectionMatches(
  row: BlueprintFlatRow,
  variants: readonly string[]
): boolean {
  const section = normalizeComparable(row.sectionName);
  const subsection = normalizeComparable(row.subsectionName);
  const combined = `${section} ${subsection}`.trim();

  return variants.some((variant) => {
    const expected = normalizeComparable(variant);

    return (
      section === expected ||
      subsection === expected ||
      combined.includes(expected) ||
      expected.includes(section) ||
      expected.includes(subsection)
    );
  });
}

function findBlueprintValue(
  rows: BlueprintFlatRow[],
  sectionVariants: readonly string[],
  question: string
): unknown {
  const expectedQuestion = normalizeComparable(question);

  const exact = rows.find((row) => {
    const rowQuestion = normalizeComparable(row.title);

    return rowQuestion === expectedQuestion && sectionMatches(row, sectionVariants);
  });

  if (exact) {
    return exact.decodedValue;
  }

  const questionContains = rows.find((row) => {
    const rowQuestion = normalizeComparable(row.title);

    return (
      sectionMatches(row, sectionVariants) &&
      (rowQuestion.includes(expectedQuestion) ||
        expectedQuestion.includes(rowQuestion))
    );
  });

  return questionContains?.decodedValue;
}

function getBootstrapAccounts(record: BootstrapRecord | null): BootstrapAccount[] {
  if (!record) {
    return [];
  }

  const foundAccounts = new Map<string, BootstrapAccount>();
  const visited = new WeakSet<object>();

  const visit = (value: unknown, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 10) {
      return;
    }

    if (visited.has(value as object)) {
      return;
    }

    visited.add(value as object);

    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }

    const objectValue = value as Record<string, unknown>;

    const accountNumber =
      normalize(objectValue.accountNumber) ||
      normalize(objectValue["#"]) ||
      normalize(objectValue.account_number);

    const accountName =
      normalize(objectValue.accountName) ||
      normalize(objectValue.NAME) ||
      normalize(objectValue.account_name);

    const id = normalize(objectValue.id) || normalize(objectValue.ID);
    const key = normalize(objectValue.key) || normalize(objectValue.KEY);

    if (accountNumber) {
      const account: BootstrapAccount = {
        accountNumber,
        accountName,
        id,
        key,
        active: objectValue.active !== false,
      };

      const dedupeKey = `${accountNumber}__${id}__${key}`;

      if (!foundAccounts.has(dedupeKey)) {
        foundAccounts.set(dedupeKey, account);
      }
    }

    Object.values(objectValue).forEach((child) => visit(child, depth + 1));
  };

  visit(record.data);

  return Array.from(foundAccounts.values());
}

function findBootstrapAccount(
  accountNumber: string | null,
  accounts: BootstrapAccount[]
): BootstrapAccount | null {
  if (!accountNumber) {
    return null;
  }

  return (
    accounts.find((account) => account.accountNumber === accountNumber) ?? null
  );
}

function createMappingRow(
  dealerId: string,
  mappingValue: PayableType,
  accountNumber: string | null
): GlamMappingRow {
  const resolvedAccountNumber = accountNumber || "9999";

  return {
    rowId: generateRowId(),
    attributes: {
      PAYABLE_TYPE: mappingValue,
    },
    mappedAssetId: `${dealerId}_${resolvedAccountNumber}`,
    mappedDealerId: dealerId,
    targetFieldToValueMapping: {},
  };
}

function getBootstrapValidation(definition: MappingDefinition): {
  text: string;
  color: string;
} {
  if (!definition.accountNumber) {
    return {
      text: "No Blueprint GL value → fallback 9999",
      color: "#fcd34d",
    };
  }

  if (!definition.bootstrapAccount) {
    return {
      text: `GL ${definition.accountNumber} not found in Bootstrap`,
      color: "#fca5a5",
    };
  }

  if (!definition.bootstrapAccount.active) {
    return {
      text: `GL ${definition.accountNumber} is inactive`,
      color: "#fcd34d",
    };
  }

  return {
    text: `✓ Valid: ${
      definition.bootstrapAccount.accountName || "Bootstrap GL Account"
    }`,
    color: "#86efac",
  };
}

const cardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  padding: 16,
  minWidth: 0,
};

const headerStyle: React.CSSProperties = {
  padding: "10px 12px",
  color: "#94a3b8",
  textAlign: "left",
  fontSize: 12,
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const cellStyle: React.CSSProperties = {
  padding: "10px 12px",
  color: "#e2e8f0",
  verticalAlign: "top",
  fontSize: 12,
  borderTop: "1px solid rgba(255,255,255,0.06)",
};

const LienPayoffAccessoriesView: React.FC = () => {
  const accountingBlueprint = useAccountingBlueprint();

  const [dealerId, setDealerId] = useState("");
  const [blueprintRows, setBlueprintRows] = useState<BlueprintFlatRow[]>([]);
  const [bootstrap, setBootstrap] = useState<BootstrapRecord | null>(null);
  const [mappingList, setMappingList] = useState<GlamMappingRow[]>([]);
  const [blueprintSource, setBlueprintSource] = useState<
    "CONTEXT" | "INDEXED_DB" | "NOT_FOUND"
  >("NOT_FOUND");
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deployMessage, setDeployMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const contextBlueprintRows = useMemo<BlueprintFlatRow[]>(
    () =>
      (accountingBlueprint.blueprint?.populatedFlatRows ??
        accountingBlueprint.blueprint?.allFields ??
        []) as BlueprintFlatRow[],
    [accountingBlueprint.blueprint]
  );

  const bootstrapAccounts = useMemo(
    () => getBootstrapAccounts(bootstrap),
    [bootstrap]
  );

  const mappingDefinitions = useMemo<MappingDefinition[]>(
    () =>
      PAYABLE_RULES.map((rule) => {
        const rawValue = findBlueprintValue(
          blueprintRows,
          rule.sectionVariants,
          rule.blueprintQuestion
        );

        const blueprintValue = normalize(rawValue);
        const accountNumber = extractGlAccountNumber(rawValue);
        const bootstrapAccount = findBootstrapAccount(
          accountNumber,
          bootstrapAccounts
        );

        return {
          mappingValue: rule.mappingValue,
          label: rule.label,
          blueprintTitle: rule.blueprintTitle,
          blueprintQuestion: rule.blueprintQuestion,
          blueprintValue,
          accountNumber,
          bootstrapAccount,
        };
      }),
    [blueprintRows, bootstrapAccounts]
  );

  const saveDraft = useCallback(
    async (activeDealerId: string, rows: GlamMappingRow[]) => {
      if (!activeDealerId) {
        return;
      }

      const payload: GlamMappingDraftPayload = {
        module: MODULE,
        name: NAME,
        criteriaList: [],
        mappingColumns: ["PAYABLE_TYPE"],
        mappingList: rows,
        ruleAsset: RULE_ASSET,
      };

      await idbSaveGlamMappingDraft(activeDealerId, payload);
    },
    []
  );

  const buildRowsFromDefinitions = useCallback(
    (activeDealerId: string, definitions: MappingDefinition[]) =>
      definitions.map((definition) =>
        createMappingRow(
          activeDealerId,
          definition.mappingValue,
          definition.accountNumber
        )
      ),
    []
  );

  const syncBlueprintAndBuildRows = useCallback(async () => {
    const resolvedDealerId =
      normalize(accountingBlueprint.selectedDealerId) || getDealerIdFromHeaders();

    if (!resolvedDealerId) {
      setDealerId("");
      setBlueprintRows([]);
      setBootstrap(null);
      setMappingList([]);
      setBlueprintSource("NOT_FOUND");
      setMessage(
        "Dealer ID was not found. Select a Dealer Profile and apply Global Headers."
      );
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessage(null);
    setDeployMessage(null);

    try {
      let resolvedBlueprintRows = contextBlueprintRows;
      let source: "CONTEXT" | "INDEXED_DB" | "NOT_FOUND" = "CONTEXT";

      if (!resolvedBlueprintRows.length) {
        resolvedBlueprintRows = await getIndexedDbBlueprintRows(resolvedDealerId);
        source = resolvedBlueprintRows.length > 0 ? "INDEXED_DB" : "NOT_FOUND";
      }

      const foundBootstrap = await idbFindBootstrapByDealerId(resolvedDealerId);
      const foundAccounts = getBootstrapAccounts(foundBootstrap);

      const definitions: MappingDefinition[] = PAYABLE_RULES.map((rule) => {
        const rawValue = findBlueprintValue(
          resolvedBlueprintRows,
          rule.sectionVariants,
          rule.blueprintQuestion
        );

        const blueprintValue = normalize(rawValue);
        const accountNumber = extractGlAccountNumber(rawValue);

        return {
          mappingValue: rule.mappingValue,
          label: rule.label,
          blueprintTitle: rule.blueprintTitle,
          blueprintQuestion: rule.blueprintQuestion,
          blueprintValue,
          accountNumber,
          bootstrapAccount: findBootstrapAccount(accountNumber, foundAccounts),
        };
      });

      const rows = resolvedBlueprintRows.length
        ? buildRowsFromDefinitions(resolvedDealerId, definitions)
        : [];

      setDealerId(resolvedDealerId);
      setBlueprintRows(resolvedBlueprintRows);
      setBlueprintSource(source);
      setBootstrap(foundBootstrap);
      setMappingList(rows);

      if (rows.length > 0) {
        await saveDraft(resolvedDealerId, rows);
      }

      if (!resolvedBlueprintRows.length) {
        setMessage(
          "No saved Accounting Blueprint was found for this dealer. Sync/save the Accounting Blueprint first, then click Sync Blueprint & Build Rows."
        );
      } else if (!foundBootstrap) {
        setMessage(
          "Blueprint was loaded, but no Bootstrap snapshot exists for this dealer. Sync Bootstrap before sending so account validation can run."
        );
      } else {
        const missingDefinitions = definitions.filter(
          (definition) => !definition.accountNumber
        );

        const invalidDefinitions = definitions.filter(
          (definition) =>
            definition.accountNumber &&
            (!definition.bootstrapAccount || !definition.bootstrapAccount.active)
        );

        if (missingDefinitions.length > 0) {
          setMessage(
            `Blueprint loaded from ${
              source === "CONTEXT" ? "active Accounting Blueprint" : "IndexedDB"
            }. Missing GL value for ${missingDefinitions
              .map((item) => item.mappingValue)
              .join(", ")}; those row(s) use fallback 9999.`
          );
        } else if (invalidDefinitions.length > 0) {
          setMessage(
            `Blueprint loaded from ${
              source === "CONTEXT" ? "active Accounting Blueprint" : "IndexedDB"
            }. Some GL values could not be validated against Bootstrap. Review the validation table before sending.`
          );
        } else {
          setMessage(
            `Lien Payoff and Accessories Due rows were built from ${
              source === "CONTEXT"
                ? "the active Accounting Blueprint"
                : "saved Blueprint IndexedDB data"
            }.`
          );
        }
      }
    } catch (error: unknown) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to sync Lien Payoff and Accessories data."
      );
    } finally {
      setLoading(false);
    }
  }, [
    accountingBlueprint.selectedDealerId,
    buildRowsFromDefinitions,
    contextBlueprintRows,
    saveDraft,
  ]);

  useEffect(() => {
    void syncBlueprintAndBuildRows();
  }, [syncBlueprintAndBuildRows]);

  const restoreBlueprintRows = async () => {
    if (!dealerId) {
      return;
    }

    if (!blueprintRows.length) {
      setMessage(
        "No Blueprint is loaded. Sync/save Accounting Blueprint first, then click Sync Blueprint & Build Rows."
      );
      return;
    }

    const rows = buildRowsFromDefinitions(dealerId, mappingDefinitions);

    setMappingList(rows);
    await saveDraft(dealerId, rows);

    setMessage(
      "LIEN_PAYOFF and ACCESSORIES_DUE rows were rebuilt from current Blueprint values."
    );
  };

  const updateMappedAssetId = (
    rowId: string | null | undefined,
    index: number,
    mappedAssetId: string
  ) => {
    setMappingList((currentRows) =>
      currentRows.map((row, rowIndex) => {
        const selected = rowId ? row.rowId === rowId : rowIndex === index;

        return selected
          ? {
              ...row,
              mappedAssetId,
            }
          : row;
      })
    );
  };

  const saveMappedAssetIdEdit = async (
    rowId: string | null | undefined,
    index: number,
    mappedAssetId: string
  ) => {
    const updatedRows = mappingList.map((row, rowIndex) => {
      const selected = rowId ? row.rowId === rowId : rowIndex === index;

      return selected
        ? {
            ...row,
            mappedAssetId,
          }
        : row;
    });

    setMappingList(updatedRows);
    await saveDraft(dealerId, updatedRows);
  };

  const deleteRow = async (
    rowId: string | null | undefined,
    index: number
  ) => {
    const row = mappingList[index];

    if (!row) {
      return;
    }

    const payableType = row.attributes.PAYABLE_TYPE || "this payable row";

    const confirmed = window.confirm(
      `Remove "${payableType}" from the active payload and outgoing Tekion request?`
    );

    if (!confirmed) {
      return;
    }

    const updatedRows = mappingList.filter((item, rowIndex) =>
      rowId ? item.rowId !== rowId : rowIndex !== index
    );

    setMappingList(updatedRows);
    await saveDraft(dealerId, updatedRows);

    setMessage(`"${payableType}" was removed from the active payload.`);
  };

  const payloadPreview = useMemo<GlamMappingDraftPayload>(
    () => ({
      module: MODULE,
      name: NAME,
      criteriaList: [],
      mappingColumns: ["PAYABLE_TYPE"],
      mappingList,
      ruleAsset: RULE_ASSET,
    }),
    [mappingList]
  );

  const deployToTekion = async () => {
    if (!dealerId) {
      setDeployMessage({
        ok: false,
        text: "Dealer ID is missing. Select a Dealer Profile in Settings first.",
      });
      return;
    }

    if (!blueprintRows.length) {
      setDeployMessage({
        ok: false,
        text: "Accounting Blueprint is not loaded. Sync/save Blueprint first, then rebuild the rows.",
      });
      return;
    }

    if (!bootstrap) {
      setDeployMessage({
        ok: false,
        text: "Bootstrap snapshot is not loaded. Sync Bootstrap first so GL accounts can be validated.",
      });
      return;
    }

    if (mappingList.length === 0) {
      setDeployMessage({
        ok: false,
        text: "There are no active Lien Payoff mapping rows to send.",
      });
      return;
    }

    const blankRows = mappingList.filter(
      (row) => !normalize(row.mappedAssetId)
    );

    if (blankRows.length > 0) {
      setDeployMessage({
        ok: false,
        text: `${blankRows.length} row(s) have a blank mappedAssetId. Enter a GL mapping or delete those rows before sending.`,
      });
      return;
    }

    const enabledHeaders: Record<string, string> = {};

    for (const header of loadGlobalHeaders()) {
      if (!header.enabled) {
        continue;
      }

      const key = normalize(header.key);
      const value = normalize(header.value);

      if (key && value) {
        enabledHeaders[key] = value;
      }
    }

    if (Object.keys(enabledHeaders).length === 0) {
      setDeployMessage({
        ok: false,
        text: "No enabled Global Headers were found. Select a Dealer Profile in Settings first.",
      });
      return;
    }

    setDeploying(true);
    setDeployMessage(null);

    try {
      await saveDraft(dealerId, mappingList);

      const response = await fetch("http://localhost:4000/api/proxy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: GLAM_MAPPING_RULE_URL,
          method: "POST",
          headers: {
            ...enabledHeaders,
            "content-type": "application/json",
          },
          body: payloadPreview,
          timeout: 60000,
        }),
      });

      if (!response.ok) {
        throw new Error(`Proxy request failed with HTTP ${response.status}`);
      }

      const responseJson = (await response.json()) as {
        status?: number;
        statusText?: string;
      };

      if ((responseJson.status ?? 200) >= 400) {
        throw new Error(
          `${responseJson.status ?? ""} ${
            responseJson.statusText ?? "Tekion request failed"
          }`.trim()
        );
      }

      setDeployMessage({
        ok: true,
        text: `Successfully sent ${mappingList.length} Lien Payoff mapping row(s) to Tekion.`,
      });
    } catch (error: unknown) {
      setDeployMessage({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : "Failed to send Lien Payoff mappings to Tekion.",
      });
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <GlamSectionHeader
        title="Lien Payoff & Accessories"
        description="Maps Lien Payoff and Accessories Due payable accounts from Accounting Blueprint values."
        breadcrumb="Accounting / Variable Operations / Payables / Lien Payoff & Accessories"
      />

      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <span style={{ color: "#94a3b8", fontSize: 12 }}>
            Dealer:{" "}
            <b style={{ color: "#f8fafc" }}>{dealerId || "Not found"}</b>
          </span>

          <span style={{ color: "#94a3b8", fontSize: 12 }}>
            Blueprint:{" "}
            <b
              style={{
                color:
                  blueprintSource === "NOT_FOUND" ? "#fca5a5" : "#86efac",
              }}
            >
              {blueprintSource === "CONTEXT"
                ? "Active Context"
                : blueprintSource === "INDEXED_DB"
                  ? "IndexedDB"
                  : "Not found"}
            </b>
          </span>

          <span style={{ color: "#94a3b8", fontSize: 12 }}>
            Bootstrap:{" "}
            <b style={{ color: bootstrap ? "#86efac" : "#fca5a5" }}>
              {bootstrap
                ? `${bootstrapAccounts.length} GL account(s)`
                : "Not found"}
            </b>
          </span>

          <span style={{ color: "#94a3b8", fontSize: 12 }}>
            Rule Name: <b style={{ color: "#f8fafc" }}>{NAME}</b>
          </span>

          <span style={{ color: "#94a3b8", fontSize: 12 }}>
            Active Rows:{" "}
            <b style={{ color: "#f8fafc" }}>{mappingList.length}</b>
          </span>

          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={loading || deploying}
              onClick={() => void syncBlueprintAndBuildRows()}
            >
              {loading ? "Syncing..." : "⟳ Sync Blueprint & Build Rows"}
            </button>

            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={
                loading ||
                deploying ||
                !dealerId ||
                !blueprintRows.length
              }
              onClick={() => void restoreBlueprintRows()}
              title="Rebuild LIEN_PAYOFF and ACCESSORIES_DUE from current Blueprint values."
            >
              ↺ Restore Blueprint Rows
            </button>

            <button
              type="button"
              className="btn-postman"
              disabled={
                loading ||
                deploying ||
                !dealerId ||
                !bootstrap ||
                !blueprintRows.length ||
                mappingList.length === 0
              }
              onClick={() => void deployToTekion()}
              title="Uses Global Headers for the selected Dealer Profile."
            >
              {deploying
                ? "Sending to Tekion..."
                : `⇢ Send ${mappingList.length} Row${
                    mappingList.length === 1 ? "" : "s"
                  } to Tekion`}
            </button>
          </div>
        </div>
      </div>

      {message ? (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            background: "rgba(59,130,246,0.08)",
            border: "1px solid rgba(59,130,246,0.22)",
            color: "#bfdbfe",
            fontSize: 13,
          }}
        >
          {message}
        </div>
      ) : null}

      {deployMessage ? (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            background: deployMessage.ok
              ? "rgba(34,197,94,0.10)"
              : "rgba(239,68,68,0.10)",
            border: deployMessage.ok
              ? "1px solid rgba(34,197,94,0.25)"
              : "1px solid rgba(239,68,68,0.25)",
            color: deployMessage.ok ? "#bbf7d0" : "#fecaca",
            fontSize: 13,
          }}
        >
          {deployMessage.text}
        </div>
      ) : null}

      <div style={{ ...cardStyle, padding: 0, overflow: "auto" }}>
        <div
          style={{
            padding: "14px 16px",
            color: "#f8fafc",
            fontSize: 16,
            fontWeight: 800,
          }}
        >
          Blueprint / Bootstrap Validation
        </div>

        <table
          style={{
            width: "100%",
            minWidth: 1100,
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.04)" }}>
              <th style={headerStyle}>PAYABLE_TYPE</th>
              <th style={headerStyle}>Blueprint Title</th>
              <th style={headerStyle}>Blueprint Question</th>
              <th style={headerStyle}>Blueprint Value</th>
              <th style={headerStyle}>Resolved GL</th>
              <th style={headerStyle}>Bootstrap Validation</th>
              <th style={headerStyle}>Default mappedAssetId</th>
            </tr>
          </thead>

          <tbody>
            {mappingDefinitions.map((definition) => {
              const validation = getBootstrapValidation(definition);

              return (
                <tr key={definition.mappingValue}>
                  <td
                    style={{
                      ...cellStyle,
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {definition.mappingValue}
                  </td>

                  <td style={cellStyle}>{definition.blueprintTitle}</td>

                  <td style={cellStyle}>{definition.blueprintQuestion}</td>

                  <td style={cellStyle}>
                    {definition.blueprintValue || "n/a / empty"}
                  </td>

                  <td
                    style={{
                      ...cellStyle,
                      fontFamily: "ui-monospace, monospace",
                      color: definition.accountNumber ? "#e2e8f0" : "#fcd34d",
                    }}
                  >
                    {definition.accountNumber || "9999"}
                  </td>

                  <td style={cellStyle}>
                    <span
                      style={{
                        color: validation.color,
                        fontWeight: 700,
                      }}
                    >
                      {validation.text}
                    </span>
                  </td>

                  <td
                    style={{
                      ...cellStyle,
                      color: "#86efac",
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {dealerId
                      ? `${dealerId}_${definition.accountNumber || "9999"}`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ ...cardStyle, padding: 0, overflow: "auto" }}>
        <div
          style={{
            padding: "14px 16px",
            color: "#f8fafc",
            fontSize: 16,
            fontWeight: 800,
          }}
        >
          Active Payload Mapping Rows ({mappingList.length})
        </div>

        <table
          style={{
            width: "100%",
            minWidth: 950,
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.04)" }}>
              <th style={headerStyle}>#</th>
              <th style={headerStyle}>PAYABLE_TYPE</th>
              <th style={headerStyle}>mappedAssetId</th>
              <th style={headerStyle}>mappedDealerId</th>
              <th style={headerStyle}>Action</th>
            </tr>
          </thead>

          <tbody>
            {mappingList.map((row, index) => (
              <tr
                key={row.rowId || `${row.mappedAssetId}-${index}`}
                style={{
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <td style={cellStyle}>{index + 1}</td>

                <td
                  style={{
                    ...cellStyle,
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  {row.attributes.PAYABLE_TYPE || "—"}
                </td>

                <td style={cellStyle}>
                  <input
                    type="text"
                    value={row.mappedAssetId || ""}
                    onChange={(event) =>
                      updateMappedAssetId(
                        row.rowId,
                        index,
                        event.target.value
                      )
                    }
                    onBlur={(event) =>
                      void saveMappedAssetIdEdit(
                        row.rowId,
                        index,
                        event.currentTarget.value
                      )
                    }
                    placeholder={`${dealerId || "dealerId"}_GLAccount`}
                    title="Manual override. Normal format: dealerId_GLAccount, such as 8111_26100."
                    style={{
                      width: "100%",
                      minWidth: 200,
                      boxSizing: "border-box",
                      padding: "7px 8px",
                      borderRadius: 6,
                      border: `1px solid ${
                        normalize(row.mappedAssetId)
                          ? "rgba(134,239,172,0.38)"
                          : "rgba(248,113,113,0.72)"
                      }`,
                      background: "rgba(15,23,42,0.80)",
                      color: "#86efac",
                      fontFamily: "ui-monospace, monospace",
                      fontSize: 12,
                      outline: "none",
                    }}
                  />

                  <div
                    style={{
                      marginTop: 5,
                      color: "#94a3b8",
                      fontSize: 10,
                    }}
                  >
                    Manual override — saved when leaving this field.
                  </div>
                </td>

                <td
                  style={{
                    ...cellStyle,
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  {row.mappedDealerId}
                </td>

                <td style={cellStyle}>
                  <button
                    type="button"
                    className="btn-danger btn-xs"
                    title="Remove this row from the active payload."
                    onClick={() => void deleteRow(row.rowId, index)}
                  >
                    🗑 Delete
                  </button>
                </td>
              </tr>
            ))}

            {!loading && mappingList.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    ...cellStyle,
                    color: "#94a3b8",
                  }}
                >
                  No active payload rows. Sync the Accounting Blueprint, then
                  click Restore Blueprint Rows.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <details style={cardStyle}>
        <summary
          style={{
            color: "#e2e8f0",
            cursor: "pointer",
            fontWeight: 800,
          }}
        >
          Show Payload Preview
        </summary>

        <pre
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 10,
            overflow: "auto",
            background: "#0f172a",
            color: "#e2e8f0",
            fontSize: 12,
          }}
        >
          {JSON.stringify(payloadPreview, null, 2)}
        </pre>
      </details>
    </div>
  );
};

export default LienPayoffAccessoriesView;
