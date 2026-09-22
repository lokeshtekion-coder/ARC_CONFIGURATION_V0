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

const MODULE = "RECEIVABLES";
const NAME = "Factory Receivables";
const RULE_ASSET = "GLACCOUNT";
const BLUEPRINT_SECTION = "Factory Receivables";

const FACTORY_RECEIVABLE_RULES = [
  {
    mappingValue: "HOLDBACK",
    label: "Holdback",
    question: "Holdback GL Account Number",
  },
  {
    mappingValue: "REBATES",
    label: "Rebates",
    question: "Rebate GL Account Number",
  },
  {
    mappingValue: "INCENTIVES",
    label: "Incentives",
    question: "Incentives GL Account Number",
  },
] as const;

type FactoryReceivableType =
  (typeof FACTORY_RECEIVABLE_RULES)[number]["mappingValue"];

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
  mappingValue: FactoryReceivableType;
  label: string;
  question: string;
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

  return `factory-receivables-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
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

  if (!text) return null;

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
  const blueprints =
    (await idbGetAllBlueprints()) as unknown as SavedBlueprintRecord[];

  const matchingBlueprints = blueprints
    .filter((record) => normalize(record.dealerId) === dealerId)
    .sort((left, right) =>
      normalize(right.savedAt).localeCompare(normalize(left.savedAt))
    );

  for (const blueprint of matchingBlueprints) {
    const rows = getFlatRowsFromRecord(blueprint);

    if (rows.length > 0) {
      return rows;
    }
  }

  return [];
}

function findScopedBlueprintValue(
  rows: BlueprintFlatRow[],
  sectionName: string,
  questionTitle: string
): unknown {
  const expectedSection = normalizeComparable(sectionName);
  const expectedQuestion = normalizeComparable(questionTitle);

  const strictMatch = rows.find((row) => {
    const title = normalizeComparable(row.title);
    const section = normalizeComparable(row.sectionName);
    const subsection = normalizeComparable(row.subsectionName);

    return (
      title === expectedQuestion &&
      (section === expectedSection || subsection === expectedSection)
    );
  });

  if (strictMatch) {
    return strictMatch.decodedValue;
  }

  const looseSectionMatch = rows.find((row) => {
    const title = normalizeComparable(row.title);
    const section = normalizeComparable(row.sectionName);
    const subsection = normalizeComparable(row.subsectionName);

    return (
      title === expectedQuestion &&
      (section.includes(expectedSection) ||
        subsection.includes(expectedSection) ||
        expectedSection.includes(section) ||
        expectedSection.includes(subsection))
    );
  });

  if (looseSectionMatch) {
    return looseSectionMatch.decodedValue;
  }

  const titleOnlyMatch = rows.find(
    (row) => normalizeComparable(row.title) === expectedQuestion
  );

  return titleOnlyMatch?.decodedValue;
}

function getBootstrapAccounts(record: BootstrapRecord | null): BootstrapAccount[] {
  if (!record) return [];

  const results = new Map<string, BootstrapAccount>();
  const visited = new WeakSet<object>();

  const visit = (value: unknown, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 9) {
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

      if (!results.has(dedupeKey)) {
        results.set(dedupeKey, account);
      }
    }

    Object.values(objectValue).forEach((child) => visit(child, depth + 1));
  };

  visit(record.data);

  return Array.from(results.values());
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
  mappingValue: FactoryReceivableType,
  accountNumber: string | null
): GlamMappingRow {
  const resolvedAccountNumber = accountNumber || "9999";

  return {
    rowId: generateRowId(),
    attributes: {
      FACTORY_RECEIVABLE_TYPE: mappingValue,
    },
    mappedAssetId: `${dealerId}_${resolvedAccountNumber}`,
    mappedDealerId: dealerId,
    targetFieldToValueMapping: {},
  };
}

function getBootstrapValidation(
  definition: MappingDefinition
): {
  text: string;
  color: string;
} {
  if (!definition.accountNumber) {
    return {
      text: "No Blueprint GL → fallback 9999",
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
    text: `✓ Valid: ${definition.bootstrapAccount.accountName || "Bootstrap GL"}`,
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

const FactoryReceivablesView: React.FC = () => {
  const accountingBlueprint = useAccountingBlueprint();

  const [dealerId, setDealerId] = useState("");
  const [bootstrap, setBootstrap] = useState<BootstrapRecord | null>(null);
  const [mappingList, setMappingList] = useState<GlamMappingRow[]>([]);
  const [blueprintRows, setBlueprintRows] = useState<BlueprintFlatRow[]>([]);
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
      FACTORY_RECEIVABLE_RULES.map((rule) => {
        const rawValue = findScopedBlueprintValue(
          blueprintRows,
          BLUEPRINT_SECTION,
          rule.question
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
          question: rule.question,
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
        mappingColumns: ["FACTORY_RECEIVABLE_TYPE"],
        mappingList: rows,
        ruleAsset: RULE_ASSET,
      };

      await idbSaveGlamMappingDraft(activeDealerId, payload);
    },
    []
  );

  const buildDefaultRows = useCallback(
    (activeDealerId: string) =>
      mappingDefinitions.map((definition) =>
        createMappingRow(
          activeDealerId,
          definition.mappingValue,
          definition.accountNumber
        )
      ),
    [mappingDefinitions]
  );

  const syncBlueprintAndBuildRows = useCallback(
    async (restoreRows = true) => {
      const resolvedDealerId =
        normalize(accountingBlueprint.selectedDealerId) || getDealerIdFromHeaders();

      if (!resolvedDealerId) {
        setDealerId("");
        setBootstrap(null);
        setBlueprintRows([]);
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
        let rows = contextBlueprintRows;
        let source: "CONTEXT" | "INDEXED_DB" | "NOT_FOUND" = "CONTEXT";

        if (rows.length === 0) {
          rows = await getIndexedDbBlueprintRows(resolvedDealerId);
          source = rows.length > 0 ? "INDEXED_DB" : "NOT_FOUND";
        }

        const foundBootstrap = await idbFindBootstrapByDealerId(resolvedDealerId);

        setDealerId(resolvedDealerId);
        setBootstrap(foundBootstrap);
        setBlueprintRows(rows);
        setBlueprintSource(source);

        if (!rows.length) {
          setMessage(
            "No saved Accounting Blueprint was found. Sync/save the Accounting Blueprint first, then click Sync Blueprint & Build Rows."
          );
          return;
        }

        if (!foundBootstrap) {
          setMessage(
            "Blueprint was found, but no Bootstrap snapshot exists for this dealer. Sync Bootstrap first so GL validation can run."
          );
          return;
        }

        if (restoreRows) {
          /*
           * Definitions update after blueprintRows/bootstrap state updates.
           * The next effect below rebuilds the default payload rows.
           */
          setMessage(
            `Blueprint loaded from ${
              source === "CONTEXT" ? "active Blueprint context" : "IndexedDB"
            }. Resolving Factory Receivables mappings...`
          );
        }
      } catch (error: unknown) {
        setMessage(
          error instanceof Error
            ? error.message
            : "Unable to sync Factory Receivables Blueprint/Bootstrap data."
        );
      } finally {
        setLoading(false);
      }
    },
    [
      accountingBlueprint.selectedDealerId,
      contextBlueprintRows,
    ]
  );

  useEffect(() => {
    void syncBlueprintAndBuildRows(false);
  }, [syncBlueprintAndBuildRows]);

  useEffect(() => {
    if (!dealerId || !blueprintRows.length) {
      return;
    }

    const rows = buildDefaultRows(dealerId);

    setMappingList(rows);
    void saveDraft(dealerId, rows);
  }, [dealerId, blueprintRows, buildDefaultRows, saveDraft]);

  const restoreDefaultRows = async () => {
    if (!dealerId) {
      return;
    }

    const rows = buildDefaultRows(dealerId);

    setMappingList(rows);
    await saveDraft(dealerId, rows);

    setMessage(
      "Factory Receivables rows were rebuilt from the current Blueprint answers."
    );
  };

  const updateMappedAssetId = (
    rowId: string | null | undefined,
    index: number,
    mappedAssetId: string
  ) => {
    setMappingList((currentRows) =>
      currentRows.map((row, rowIndex) => {
        const isSelected = rowId ? row.rowId === rowId : rowIndex === index;

        return isSelected
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
      const isSelected = rowId ? row.rowId === rowId : rowIndex === index;

      return isSelected
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

    const mappingValue =
      row.attributes.FACTORY_RECEIVABLE_TYPE || "this Factory Receivable row";

    const confirmed = window.confirm(
      `Remove "${mappingValue}" from the active payload and outgoing Tekion request?`
    );

    if (!confirmed) {
      return;
    }

    const updatedRows = mappingList.filter((item, rowIndex) =>
      rowId ? item.rowId !== rowId : rowIndex !== index
    );

    setMappingList(updatedRows);
    await saveDraft(dealerId, updatedRows);

    setMessage(`"${mappingValue}" was removed from the active payload.`);
  };

  const payloadPreview = useMemo<GlamMappingDraftPayload>(
    () => ({
      module: MODULE,
      name: NAME,
      criteriaList: [],
      mappingColumns: ["FACTORY_RECEIVABLE_TYPE"],
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

    if (mappingList.length === 0) {
      setDeployMessage({
        ok: false,
        text: "There are no active Factory Receivables mapping rows to send.",
      });
      return;
    }

    const blankRows = mappingList.filter(
      (row) => !normalize(row.mappedAssetId)
    );

    if (blankRows.length > 0) {
      setDeployMessage({
        ok: false,
        text: `${blankRows.length} row(s) have a blank mappedAssetId. Enter an account mapping or delete those rows before sending.`,
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
        text: "No enabled Global Headers were found. Select a Dealer Profile in Settings.",
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
        text: `Successfully sent ${mappingList.length} Factory Receivables mapping row(s) to Tekion.`,
      });
    } catch (error: unknown) {
      setDeployMessage({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : "Failed to send Factory Receivables mappings to Tekion.",
      });
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <GlamSectionHeader
        title="Factory Receivables"
        description=""
        breadcrumb=""
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
            Payload Rows:{" "}
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
              onClick={() => void syncBlueprintAndBuildRows(true)}
            >
              {loading ? "Syncing..." : "⟳ Sync Blueprint"}
            </button>

            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={loading || deploying || !dealerId}
              onClick={() => void restoreDefaultRows()}
              title="Rebuilds HOLDBACK, REBATES, and INCENTIVES from current Blueprint values."
            >
              ↺ Restore Blueprint Rows
            </button>

            <button
              type="button"
              className="btn-postman"
              disabled={loading || deploying || !dealerId || mappingList.length === 0}
              onClick={() => void deployToTekion()}
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
            minWidth: 1050,
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.04)" }}>
              <th style={headerStyle}>Factory Receivable Type</th>
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

                  <td style={cellStyle}>{definition.question}</td>

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
              <th style={headerStyle}>FACTORY_RECEIVABLE_TYPE</th>
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
                  {row.attributes.FACTORY_RECEIVABLE_TYPE || "—"}
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
                    title="Manual override. Normal format is dealerId_GLAccount, for example 8111_26100."
                    style={{
                      width: "100%",
                      minWidth: 190,
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
                  No active payload rows. Click Restore Blueprint Rows to recreate
                  the standard Factory Receivables mappings.
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

export default FactoryReceivablesView;
