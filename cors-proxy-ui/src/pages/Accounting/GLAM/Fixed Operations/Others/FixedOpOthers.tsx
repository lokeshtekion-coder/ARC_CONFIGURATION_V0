import React, { useCallback, useEffect, useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../../../../services/tekionApiSettings";
import { idbFindBootstrapByDealerId } from "../../../../../utils/bootstrapDb";
import type { BootstrapRecord } from "../../../../../utils/bootstrapDb";
import { useAccountingBlueprint } from "../../../../../Context/Blueprint_Accounting_Context/AccountingBlueprintContext";
import {
  idbSaveGlamMappingDraft,
  type GlamMappingDraftPayload,
  type GlamMappingRow,
} from "../../../../../utils/glamMappingDraftDb";

const GLAM_MAPPING_RULE_URL =
  "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/rule";

const MODULE = "FO_OTHERS";
const NAME = "Fixed Op Others";
const RULE_ASSET = "GLACCOUNT";

const BLUEPRINT_SECTION = "Fixed Ops Other Accounts";

const TAX_MAPPING_VALUES = [
  "SALES_TAX_PARTS",
  "SALES_TAX_LABOR",
  "SALES_TAX_SUBLET",
  "SALES_TAX_DEDUCTIBLE",
  "STATE_TAX_LABOR",
  "STATE_TAX_PARTS",
  "STATE_TAX_SUBLET",
  "STATE_TAX_DEDUCTIBLE",
  "CITY_TAX_LABOR",
  "CITY_TAX_PARTS",
  "CITY_TAX_SUBLET",
  "CITY_TAX_DEDUCTIBLE",
  "TRANSACTION_CHARGES_BNPL",
  "DONATION",
  "TAX_DEFAULT",
] as const;

const DIRECT_BLUEPRINT_MAPPINGS = [
  {
    mappingValue: "OTHER_SUPPLIES",
    label: "Other Supplies",
    question: "Other Supplies - GL Account",
    note: "Uses taxable/general Other Supplies account. Non-taxable mapping will be added later.",
  },
  {
    mappingValue: "FREIGHT_CHARGE",
    label: "Freight Charge",
    question: "Freight - Taxable - GL Account",
    note: "Uses taxable Freight account. Non-taxable mapping will be added later.",
  },
  {
    mappingValue: "RESTOCKING_FEE",
    label: "Restocking Fee",
    question: "Restocking Fee - GL Account",
    note: "",
  },
] as const;

const NO_BLUEPRINT_MAPPING_VALUES = [
  {
    mappingValue: "SERVICE_CASH_HOLDING_ACCOUNT",
    label: "Service Cash Holding Account",
  },
  {
    mappingValue: "PARTS_CASH_HOLDING_ACCOUNT",
    label: "Parts Cash Holding Account",
  },
] as const;

type BootstrapAccount = {
  accountNumber: string;
  accountName: string;
  active: boolean;
};

type BlueprintFlatRow = {
  sectionName?: string | null;
  subsectionName?: string | null;
  title?: string | null;
  decodedValue?: unknown;
};

type TaxGlResolution = {
  laborValue: string | null;
  partsValue: string | null;
  selectedValue: string | null;
  status: "MATCHED" | "LABOR_ONLY" | "PARTS_ONLY" | "MISSING" | "MISMATCH";
  detail: string;
};

type MappingDefinition = {
  mappingValue: string;
  label: string;
  sourceQuestion: string;
  sourceValue: string | null;
  note?: string;
  blocking?: boolean;
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

  return `fo-others-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getDealerIdFromHeaders(): string {
  const headers = loadGlobalHeaders();

  for (const header of headers) {
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

  const normalized = normalizeLower(text);

  if (
    normalized === "n/a" ||
    normalized === "na" ||
    normalized === "none" ||
    normalized === "null" ||
    normalized === "not applicable"
  ) {
    return null;
  }

  const match = text.match(/\d{2,}/);
  return match?.[0] ?? null;
}

function getBootstrapRoot(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {};
  }

  return data as Record<string, unknown>;
}

function getBootstrapAccounts(record: BootstrapRecord | null): BootstrapAccount[] {
  if (!record) return [];

  const root = getBootstrapRoot(record.data);
  const rawAccounts = Array.isArray(root.glAccounts) ? root.glAccounts : [];

  return rawAccounts
    .filter(
      (entry): entry is Record<string, unknown> =>
        Boolean(entry && typeof entry === "object" && !Array.isArray(entry))
    )
    .map((entry) => ({
      accountNumber: normalize(entry.accountNumber),
      accountName: normalize(entry.accountName),
      active: entry.active !== false,
    }))
    .filter((account) => Boolean(account.accountNumber));
}

function findScopedBlueprintValue(
  rows: BlueprintFlatRow[],
  sectionName: string,
  questionTitle: string
): unknown {
  const expectedSection = normalizeComparable(sectionName);
  const expectedQuestion = normalizeComparable(questionTitle);

  const exact = rows.find((row) => {
    const rowSection = normalizeComparable(row.sectionName);
    const rowSubsection = normalizeComparable(row.subsectionName);
    const rowQuestion = normalizeComparable(row.title);

    return (
      rowQuestion === expectedQuestion &&
      (rowSection === expectedSection || rowSubsection === expectedSection)
    );
  });

  if (exact) {
    return exact.decodedValue;
  }

  const loose = rows.find((row) => {
    const rowSection = normalizeComparable(row.sectionName);
    const rowSubsection = normalizeComparable(row.subsectionName);
    const rowQuestion = normalizeComparable(row.title);

    return (
      rowQuestion === expectedQuestion &&
      (rowSection.includes(expectedSection) ||
        rowSubsection.includes(expectedSection) ||
        expectedSection.includes(rowSection) ||
        expectedSection.includes(rowSubsection))
    );
  });

  return loose?.decodedValue;
}

function resolveTaxGlAccount(
  laborRawValue: unknown,
  partsRawValue: unknown
): TaxGlResolution {
  const laborValue = extractGlAccountNumber(laborRawValue);
  const partsValue = extractGlAccountNumber(partsRawValue);

  if (laborValue && partsValue) {
    if (laborValue === partsValue) {
      return {
        laborValue,
        partsValue,
        selectedValue: laborValue,
        status: "MATCHED",
        detail: `Labor and Parts both resolve to GL ${laborValue}.`,
      };
    }

    return {
      laborValue,
      partsValue,
      selectedValue: null,
      status: "MISMATCH",
      detail:
        `Sales Tax GL mismatch: Labor is ${laborValue}, but Parts is ${partsValue}. ` +
        "Correct the Blueprint before sending Tax mappings to Tekion.",
    };
  }

  if (laborValue) {
    return {
      laborValue,
      partsValue,
      selectedValue: laborValue,
      status: "LABOR_ONLY",
      detail:
        `Sales Tax - Parts GL Account is empty or n/a. ` +
        `Using Labor GL ${laborValue} for all Tax mappings.`,
    };
  }

  if (partsValue) {
    return {
      laborValue,
      partsValue,
      selectedValue: partsValue,
      status: "PARTS_ONLY",
      detail:
        `Sales Tax - Labor GL Account is empty or n/a. ` +
        `Using Parts GL ${partsValue} for all Tax mappings.`,
    };
  }

  return {
    laborValue,
    partsValue,
    selectedValue: null,
    status: "MISSING",
    detail:
      "Both Sales Tax - Labor GL Account and Sales Tax - Parts GL Account are empty or n/a. Tax mappings will use fallback 9999.",
  };
}

function createMappingRow(
  dealerId: string,
  mappingValue: string,
  accountNumber: string | null
): GlamMappingRow {
  const resolvedAccount = accountNumber || "9999";

  return {
    rowId: generateRowId(),
    attributes: {
      FIXED_OPS_OTHERS: mappingValue,
    },
    mappedAssetId: `${dealerId}_${resolvedAccount}`,
    mappedDealerId: dealerId,
    targetFieldToValueMapping: {},
  };
}

function getBootstrapStatus(
  accountNumber: string | null,
  accounts: BootstrapAccount[]
): {
  valid: boolean;
  text: string;
} {
  if (!accountNumber) {
    return {
      valid: false,
      text: "Fallback → 9999",
    };
  }

  const matched = accounts.find(
    (account) => account.accountNumber === accountNumber
  );

  if (!matched) {
    return {
      valid: false,
      text: "Fallback → 9999",
    };
  }

  if (!matched.active) {
    return {
      valid: false,
      text: "Inactive → 9999",
    };
  }

  return {
    valid: true,
    text: "✓ Valid",
  };
}

const headerStyle: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  color: "#cbd5e1",
  fontSize: 12,
  fontWeight: 800,
};

const cellStyle: React.CSSProperties = {
  padding: "10px 12px",
  color: "#e2e8f0",
  fontSize: 12,
  verticalAlign: "top",
};

const FixedOpOthers: React.FC = () => {
  const accountingBlueprint = useAccountingBlueprint();

  const [dealerId, setDealerId] = useState("");
  const [bootstrap, setBootstrap] = useState<BootstrapRecord | null>(null);
  const [mappingList, setMappingList] = useState<GlamMappingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deployMessage, setDeployMessage] = useState<{
    ok: boolean;
    text: string;
  } | null>(null);

  const flatRows = useMemo<BlueprintFlatRow[]>(
    () =>
      (accountingBlueprint.blueprint?.populatedFlatRows ??
        accountingBlueprint.blueprint?.allFields ??
        []) as BlueprintFlatRow[],
    [accountingBlueprint.blueprint]
  );

  const accounts = useMemo(() => getBootstrapAccounts(bootstrap), [bootstrap]);

  const salesTaxResolution = useMemo(() => {
    const laborRawValue = findScopedBlueprintValue(
      flatRows,
      BLUEPRINT_SECTION,
      "Sales Tax - Labor GL Account"
    );

    const partsRawValue = findScopedBlueprintValue(
      flatRows,
      BLUEPRINT_SECTION,
      "Sales Tax - Parts GL Account"
    );

    return resolveTaxGlAccount(laborRawValue, partsRawValue);
  }, [flatRows]);

  const mappingDefinitions = useMemo<MappingDefinition[]>(() => {
    const taxDefinitions: MappingDefinition[] = TAX_MAPPING_VALUES.map(
      (mappingValue) => ({
        mappingValue,
        label: mappingValue.replace(/_/g, " "),
        sourceQuestion:
          "Sales Tax - Labor GL Account / Sales Tax - Parts GL Account",
        sourceValue: salesTaxResolution.selectedValue,
        note: salesTaxResolution.detail,
        blocking: salesTaxResolution.status === "MISMATCH",
      })
    );

    const directDefinitions: MappingDefinition[] = DIRECT_BLUEPRINT_MAPPINGS.map(
      (definition) => {
        const rawValue = findScopedBlueprintValue(
          flatRows,
          BLUEPRINT_SECTION,
          definition.question
        );

        return {
          mappingValue: definition.mappingValue,
          label: definition.label,
          sourceQuestion: definition.question,
          sourceValue: extractGlAccountNumber(rawValue),
          note: definition.note,
        };
      }
    );

    const noBlueprintDefinitions: MappingDefinition[] =
      NO_BLUEPRINT_MAPPING_VALUES.map((definition) => ({
        mappingValue: definition.mappingValue,
        label: definition.label,
        sourceQuestion: "No Blueprint source configured",
        sourceValue: null,
        note: "No Blueprint account question has been mapped for this value yet.",
      }));

    return [
      ...taxDefinitions,
      ...directDefinitions,
      ...noBlueprintDefinitions,
    ];
  }, [flatRows, salesTaxResolution]);

  const buildRows = useCallback(
    (activeDealerId: string): GlamMappingRow[] =>
      mappingDefinitions.map((definition) => {
        const accountNumber = definition.blocking
          ? null
          : definition.sourceValue;

        return createMappingRow(
          activeDealerId,
          definition.mappingValue,
          accountNumber
        );
      }),
    [mappingDefinitions]
  );

  const saveDraft = useCallback(
    async (activeDealerId: string, rows: GlamMappingRow[]) => {
      if (!activeDealerId) return;

      const payload: GlamMappingDraftPayload = {
        module: MODULE,
        name: NAME,
        criteriaList: [],
        mappingColumns: ["FIXED_OPS_OTHERS"],
        mappingList: rows,
        ruleAsset: RULE_ASSET,
      };

      await idbSaveGlamMappingDraft(activeDealerId, payload);
    },
    []
  );

  const reload = useCallback(async () => {
    const resolvedDealerId =
      normalize(accountingBlueprint.selectedDealerId) || getDealerIdFromHeaders();

    if (!resolvedDealerId) {
      setDealerId("");
      setBootstrap(null);
      setMappingList([]);
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
      const foundBootstrap = await idbFindBootstrapByDealerId(resolvedDealerId);
      const rows = buildRows(resolvedDealerId);

      setDealerId(resolvedDealerId);
      setBootstrap(foundBootstrap);
      setMappingList(rows);

      await saveDraft(resolvedDealerId, rows);

      if (!foundBootstrap) {
        setMessage(
          "No Bootstrap snapshot found for this dealer. Account validation is unavailable and unresolved mappings use 9999."
        );
      } else if (salesTaxResolution.status === "MISMATCH") {
        setMessage(salesTaxResolution.detail);
      } else {
        setMessage(
          "Fixed Op Others mappings were rebuilt from Accounting Blueprint and Bootstrap data."
        );
      }
    } catch (error: unknown) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load Fixed Op Others mapping data."
      );
    } finally {
      setLoading(false);
    }
  }, [
    accountingBlueprint.selectedDealerId,
    buildRows,
    salesTaxResolution.detail,
    salesTaxResolution.status,
    saveDraft,
  ]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const hasBlockingTaxMismatch = salesTaxResolution.status === "MISMATCH";

  const payloadPreview = useMemo<GlamMappingDraftPayload>(
    () => ({
      module: MODULE,
      name: NAME,
      criteriaList: [],
      mappingColumns: ["FIXED_OPS_OTHERS"],
      mappingList,
      ruleAsset: RULE_ASSET,
    }),
    [mappingList]
  );

  /**
   * Updates only UI state while the user types.
   * The value is persisted on input blur, on delete, and before deployment.
   */
  const updateMappedAssetId = (
    rowId: string | null | undefined,
    index: number,
    mappedAssetId: string
  ) => {
    setMappingList((currentRows) =>
      currentRows.map((row, rowIndex) => {
        const isTargetRow = rowId
          ? row.rowId === rowId
          : rowIndex === index;

        return isTargetRow
          ? {
              ...row,
              mappedAssetId,
            }
          : row;
      })
    );
  };

  /**
   * Persists the current manual mappedAssetId edit.
   * The exact value is retained in the outgoing Tekion payload.
   */
  const saveEditedMappedAssetId = async () => {
    await saveDraft(dealerId, mappingList);
  };

  /**
   * Removes a mapping row from the visible table, saved draft, and
   * subsequent outgoing Tekion payload.
   */
  const deleteRow = async (
    rowId: string | null | undefined,
    index: number
  ) => {
    const rowToDelete = mappingList[index];

    if (!rowToDelete) {
      return;
    }

    const shouldDelete = window.confirm(
      `Remove "${rowToDelete.attributes.FIXED_OPS_OTHERS || "this mapping"}" ` +
        "from the saved draft and outgoing Tekion payload?"
    );

    if (!shouldDelete) {
      return;
    }

    const nextRows = mappingList.filter((row, rowIndex) =>
      rowId ? row.rowId !== rowId : rowIndex !== index
    );

    setMappingList(nextRows);
    await saveDraft(dealerId, nextRows);

    setMessage(
      `"${rowToDelete.attributes.FIXED_OPS_OTHERS || "Mapping row"}" was removed from the active payload.`
    );
  };

  const deployToTekion = async () => {
    if (!dealerId) {
      setDeployMessage({
        ok: false,
        text: "Dealer ID is missing. Select a Dealer Profile in Settings first.",
      });
      return;
    }

    if (hasBlockingTaxMismatch) {
      setDeployMessage({
        ok: false,
        text: salesTaxResolution.detail,
      });
      return;
    }

    const rowsWithBlankMappedAssetId = mappingList.filter(
      (row) => !normalize(row.mappedAssetId)
    );

    if (rowsWithBlankMappedAssetId.length > 0) {
      setDeployMessage({
        ok: false,
        text:
          `${rowsWithBlankMappedAssetId.length} mapping row(s) have a blank mappedAssetId. ` +
          "Enter a GL mapping value or delete those rows before sending.",
      });
      return;
    }

    const enabledHeaders: Record<string, string> = {};

    for (const header of loadGlobalHeaders()) {
      if (!header.enabled) continue;

      const key = normalize(header.key);
      const value = normalize(header.value);

      if (key && value) {
        enabledHeaders[key] = value;
      }
    }

    if (Object.keys(enabledHeaders).length === 0) {
      setDeployMessage({
        ok: false,
        text: "No enabled Global Headers found. Select a Dealer Profile in Settings first.",
      });
      return;
    }

    const payload: GlamMappingDraftPayload = {
      module: MODULE,
      name: NAME,
      criteriaList: [],
      mappingColumns: ["FIXED_OPS_OTHERS"],
      mappingList,
      ruleAsset: RULE_ASSET,
    };

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
          body: payload,
          timeout: 60000,
        }),
      });

      if (!response.ok) {
        throw new Error(`Proxy request failed with HTTP ${response.status}`);
      }

      const json = (await response.json()) as {
        status?: number;
        statusText?: string;
      };

      if ((json.status ?? 200) >= 400) {
        throw new Error(
          `${json.status ?? ""} ${
            json.statusText ?? "Tekion request failed"
          }`.trim()
        );
      }

      setDeployMessage({
        ok: true,
        text: `Successfully sent ${mappingList.length} Fixed Op Others mapping row(s) to Tekion.`,
      });
    } catch (error: unknown) {
      setDeployMessage({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : "Failed to send Fixed Op Others mappings to Tekion.",
      });
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ color: "#f8fafc", fontSize: 22, fontWeight: 800 }}>
          Fixed Op Others
        </div>

        <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>
          Maps Fixed Operations Other account types from the Accounting Blueprint
          section <b>Fixed Ops Other Accounts</b>. Sales Tax Labor and Parts
          accounts must match when both are provided.
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          padding: 12,
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.025)",
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
              color: accountingBlueprint.hasBlueprint ? "#86efac" : "#fca5a5",
            }}
          >
            {accountingBlueprint.hasBlueprint ? "Connected" : "Not found"}
          </b>
        </span>

        <span style={{ color: "#94a3b8", fontSize: 12 }}>
          Bootstrap:{" "}
          <b style={{ color: bootstrap ? "#86efac" : "#fca5a5" }}>
            {bootstrap ? `${accounts.length} GL accounts` : "Not found"}
          </b>
        </span>

        <span style={{ color: "#94a3b8", fontSize: 12 }}>
          Tax Validation:{" "}
          <b
            style={{
              color:
                salesTaxResolution.status === "MATCHED"
                  ? "#86efac"
                  : salesTaxResolution.status === "MISMATCH"
                    ? "#fca5a5"
                    : "#fcd34d",
            }}
          >
            {salesTaxResolution.status}
          </b>
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
            className="btn-secondary btn-sm"
            type="button"
            onClick={() => void reload()}
            disabled={loading || deploying}
          >
            ⟳ Reload / Sync Blueprint
          </button>

          <button
            className="btn-postman"
            type="button"
            disabled={
              loading ||
              deploying ||
              !dealerId ||
              hasBlockingTaxMismatch ||
              mappingList.length === 0
            }
            onClick={() => void deployToTekion()}
            title={
              hasBlockingTaxMismatch
                ? "Sales Tax Labor and Parts GL accounts differ. Correct Blueprint values before sending."
                : "Uses Global Headers from the selected Dealer Profile in Settings"
            }
          >
            {deploying
              ? "Sending to Tekion..."
              : `⇢ Send ${mappingList.length} Row${
                  mappingList.length === 1 ? "" : "s"
                } to Tekion`}
          </button>
        </div>
      </div>

      <div
        style={{
          padding: "11px 12px",
          borderRadius: 10,
          border:
            salesTaxResolution.status === "MISMATCH"
              ? "1px solid rgba(239,68,68,0.30)"
              : salesTaxResolution.status === "MATCHED"
                ? "1px solid rgba(34,197,94,0.25)"
                : "1px solid rgba(245,158,11,0.25)",
          background:
            salesTaxResolution.status === "MISMATCH"
              ? "rgba(239,68,68,0.10)"
              : salesTaxResolution.status === "MATCHED"
                ? "rgba(34,197,94,0.10)"
                : "rgba(245,158,11,0.10)",
          color:
            salesTaxResolution.status === "MISMATCH"
              ? "#fecaca"
              : salesTaxResolution.status === "MATCHED"
                ? "#bbf7d0"
                : "#fde68a",
          fontSize: 13,
        }}
      >
        <b>Sales Tax Validation: </b>
        {salesTaxResolution.detail}
      </div>

      {message ? (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(59,130,246,0.22)",
            background: "rgba(59,130,246,0.08)",
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
            border: deployMessage.ok
              ? "1px solid rgba(34,197,94,0.25)"
              : "1px solid rgba(239,68,68,0.25)",
            background: deployMessage.ok
              ? "rgba(34,197,94,0.10)"
              : "rgba(239,68,68,0.10)",
            color: deployMessage.ok ? "#bbf7d0" : "#fecaca",
            fontSize: 13,
          }}
        >
          {deployMessage.text}
        </div>
      ) : null}

      <div
        style={{
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.08)",
          overflow: "auto",
        }}
      >
        <div
          style={{
            padding: "12px 14px",
            color: "#f8fafc",
            fontWeight: 800,
          }}
        >
          Blueprint / Bootstrap Validation
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1120 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.05)" }}>
              <th style={headerStyle}>Mapping Value</th>
              <th style={headerStyle}>Blueprint Section</th>
              <th style={headerStyle}>Blueprint Question / Rule</th>
              <th style={headerStyle}>Resolved GL Account</th>
              <th style={headerStyle}>Bootstrap GL Status</th>
              <th style={headerStyle}>Notes</th>
            </tr>
          </thead>

          <tbody>
            {mappingDefinitions.map((definition) => {
              const accountNumber = definition.blocking
                ? null
                : definition.sourceValue;

              const bootstrapStatus = getBootstrapStatus(
                accountNumber,
                accounts
              );

              return (
                <tr
                  key={definition.mappingValue}
                  style={{
                    borderTop: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <td
                    style={{
                      ...cellStyle,
                      color: "#e2e8f0",
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {definition.mappingValue}
                  </td>

                  <td style={cellStyle}>{BLUEPRINT_SECTION}</td>

                  <td style={cellStyle}>{definition.sourceQuestion}</td>

                  <td
                    style={{
                      ...cellStyle,
                      color: accountNumber ? "#e2e8f0" : "#fcd34d",
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {accountNumber ?? "9999"}
                  </td>

                  <td style={cellStyle}>
                    <span
                      style={{
                        color: getBootstrapStatus(accountNumber, accounts).valid
                          ? "#86efac"
                          : "#fca5a5",
                        fontWeight: 700,
                      }}
                    >
                      {definition.blocking
                        ? "Blocked by Tax GL mismatch"
                        : bootstrapStatus.text}
                    </span>
                  </td>

                  <td
                    style={{
                      ...cellStyle,
                      color: definition.blocking ? "#fecaca" : "#94a3b8",
                      maxWidth: 420,
                    }}
                  >
                    {definition.note || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        style={{
          borderRadius: 14,
          border: "1px solid rgba(255,255,255,0.08)",
          overflow: "auto",
        }}
      >
        <div
          style={{
            padding: "12px 14px",
            color: "#f8fafc",
            fontWeight: 800,
          }}
        >
          Active Payload Mapping Rows ({mappingList.length})
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.05)" }}>
              <th style={headerStyle}>#</th>
              <th style={headerStyle}>FIXED_OPS_OTHERS</th>
              <th style={headerStyle}>mappedAssetId</th>
              <th style={headerStyle}>mappedDealerId</th>
              <th
                style={{
                  ...headerStyle,
                  position: "sticky",
                  right: 0,
                  zIndex: 2,
                  background: "#172033",
                }}
              >
                Action
              </th>
            </tr>
          </thead>

          <tbody>
            {mappingList.map((row, index) => (
              <tr
                key={row.rowId ?? `${index}-${row.mappedAssetId}`}
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
                  {row.attributes.FIXED_OPS_OTHERS || "—"}
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
                    onBlur={() => void saveEditedMappedAssetId()}
                    title="Editable. Recommended format: dealerId_GLAccount, for example 8111_32400."
                    placeholder={`${dealerId || "dealerId"}_GLAccount`}
                    style={{
                      width: "100%",
                      minWidth: 180,
                      boxSizing: "border-box",
                      borderRadius: 6,
                      border: `1px solid ${
                        normalize(row.mappedAssetId)
                          ? "rgba(134,239,172,0.35)"
                          : "rgba(248,113,113,0.70)"
                      }`,
                      background: "rgba(15,23,42,0.80)",
                      color: "#86efac",
                      padding: "7px 8px",
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
                      lineHeight: 1.35,
                    }}
                  >
                    Editable manual override. Saved when you leave this field.
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

                <td
                  style={{
                    ...cellStyle,
                    position: "sticky",
                    right: 0,
                    zIndex: 1,
                    background: "#111827",
                  }}
                >
                  <button
                    type="button"
                    className="btn-danger btn-xs"
                    onClick={() => void deleteRow(row.rowId, index)}
                    title="Remove this row from the saved draft and outgoing Tekion payload"
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
                  No mapping rows available. Select a dealer profile and reload.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <details>
        <summary
          style={{
            cursor: "pointer",
            color: "#cbd5e1",
            fontWeight: 700,
          }}
        >
          Show synchronized payload preview
        </summary>

        <pre
          style={{
            marginTop: 10,
            padding: 12,
            borderRadius: 12,
            background: "#0f172a",
            color: "#e2e8f0",
            overflow: "auto",
            fontSize: 12,
          }}
        >
          {JSON.stringify(payloadPreview, null, 2)}
        </pre>
      </details>
    </div>
  );
};

export default FixedOpOthers;
