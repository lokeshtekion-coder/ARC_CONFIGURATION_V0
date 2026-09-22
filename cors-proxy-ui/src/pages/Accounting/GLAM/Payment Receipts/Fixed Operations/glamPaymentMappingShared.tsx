import React, { useCallback, useEffect, useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../../../../services/tekionApiSettings";
import { idbFindBootstrapByDealerId } from "../../../../../utils/bootstrapDb";
import type { BootstrapRecord } from "../../../../../utils/bootstrapDb";
import { useAccountingBlueprint } from "../../../../../Context/Blueprint_Accounting_Context/AccountingBlueprintContext";
import {
  idbGetGlamMappingDraft,
  idbSaveGlamMappingDraft,
  type GlamMappingDraftPayload,
  type GlamMappingRow,
} from "../../../../../utils/glamMappingDraftDb";

export type MappingRuleDefinition = {
  key: string;
  label: string;
  attributes: Record<string, string>;
  blueprintSection: string;
  blueprintQuestion: string;

  /**
   * Overrides Blueprint GL-account lookup.
   *
   * Used by required Vehicle Inventory - INVV default mappings.
   * Example: "INVV" becomes "<dealerId>_INVV".
   */
  mappedAssetSuffix?: string;

  /**
   * Uses this exact mappedAssetId without a dealer ID prefix.
   * Example: "INVV".
   */
  mappedAssetIdOverride?: string;

  /**
   * Required default rows are always added before deployment and cannot
   * be removed from the mapping UI.
   */
  alwaysInclude?: boolean;

  paymentMethodField?: {
    customFieldKey: string;
    optionName: string;
  };
};

export type PaymentMappingScreenConfig = {
  module: "PAYMENT_METHODS_FIXED_OPS";
  name: string;
  title: string;
  description: string;
  mappingColumns: string[];
  rules: MappingRuleDefinition[];
};

type BootstrapAccount = {
  accountNumber: string;
  id: string;
  key: string;
  accountName: string;
  active: boolean;
};

type CustomFieldOption = {
  id: string;
  name: string;
  deleted: boolean;
};

const GLAM_MAPPING_RULE_URL =
  "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/rule";

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

function generateRowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `glam-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  return data as Record<string, unknown>;
}

function getBootstrapAccounts(record: BootstrapRecord | null): BootstrapAccount[] {
  if (!record) return [];

  const root = getBootstrapRoot(record.data);
  const outputAccounts = Array.isArray(root.glAccounts) ? root.glAccounts : [];

  const accounts: BootstrapAccount[] = outputAccounts
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object"))
    .map((entry) => ({
      accountNumber: normalize(entry.accountNumber),
      id: normalize(entry.id),
      key: normalize(entry.key),
      accountName: normalize(entry.accountName),
      active: entry.active !== false,
    }))
    .filter((account) => Boolean(account.accountNumber));

  return accounts;
}

function getRawCustomFieldOptions(
  record: BootstrapRecord | null,
  dealerId: string,
  fieldKey: string
): CustomFieldOption[] {
  if (!record) return [];

  const root = getBootstrapRoot(record.data);
  const customField = getBootstrapRoot(root.customField);

  const dealerMapCandidate = customField.dealerAssetDocMap;
  const dealerMap =
    dealerMapCandidate &&
    typeof dealerMapCandidate === "object" &&
    !Array.isArray(dealerMapCandidate)
      ? (dealerMapCandidate as Record<string, unknown>)
      : {};

  const directDealerFields =
    dealerMap[dealerId] &&
    typeof dealerMap[dealerId] === "object" &&
    !Array.isArray(dealerMap[dealerId])
      ? (dealerMap[dealerId] as Record<string, unknown>)
      : dealerMap;

  const masterMap =
    customField.masterAssetDocMap &&
    typeof customField.masterAssetDocMap === "object" &&
    !Array.isArray(customField.masterAssetDocMap)
      ? (customField.masterAssetDocMap as Record<string, unknown>)
      : {};

  const mergedFields = {
    ...masterMap,
    ...directDealerFields,
  };

  const field = Object.values(mergedFields).find((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    return normalize((item as Record<string, unknown>).key) === fieldKey;
  });

  if (!field || typeof field !== "object" || Array.isArray(field)) return [];

  const options = (field as Record<string, unknown>).options;

  if (!Array.isArray(options)) return [];

  return options
    .filter((option): option is Record<string, unknown> => Boolean(option && typeof option === "object"))
    .map((option) => ({
      id: normalize(option.id),
      name: normalize(option.name),
      deleted: option.deleted === true,
    }));
}

function findGeneratedPaymentMethodId(
  record: BootstrapRecord | null,
  dealerId: string,
  fieldKey: string,
  optionName: string
): string {
  const options = getRawCustomFieldOptions(record, dealerId, fieldKey);

  const matched = options.find(
    (option) =>
      !option.deleted &&
      normalizeComparable(option.name) === normalizeComparable(optionName)
  );

  return matched?.id ?? "";
}

function isPaymentMethodColumn(column: string): boolean {
  return normalize(column).includes("PAYMENT_METHOD");
}

/**
 * UI-only resolver.
 *
 * The payload retains the generated Tekion custom-field option ID, while the
 * UI displays its actual human-readable payment-method name below the ID.
 */
function findPaymentMethodNameByGeneratedId(
  rules: MappingRuleDefinition[],
  row: GlamMappingRow,
  column: string,
  bootstrap: BootstrapRecord | null,
  dealerId: string
): string {
  if (!isPaymentMethodColumn(column)) return "";

  const generatedId = normalize(row.attributes[column]);

  if (
    !generatedId ||
    generatedId === "MISSING_GENERATED_PAYMENT_METHOD_ID"
  ) {
    return "";
  }

  for (const rule of rules) {
    const paymentField = rule.paymentMethodField;
    if (!paymentField) continue;

    const options = getRawCustomFieldOptions(
      bootstrap,
      dealerId,
      paymentField.customFieldKey
    );

    const option = options.find(
      (item) => !item.deleted && normalize(item.id) === generatedId
    );

    if (option?.name) {
      return option.name;
    }
  }

  return "";
}

/**
 * Config rules start with an empty PAYMENT_METHOD_* value. buildRow replaces
 * that value with a server-generated custom-field option ID. This function
 * safely matches that saved payload row back to its original config rule.
 */
function doesRowMatchRule(
  row: GlamMappingRow,
  rule: MappingRuleDefinition,
  bootstrap: BootstrapRecord | null,
  dealerId: string
): boolean {
  for (const [attributeKey, expectedValue] of Object.entries(rule.attributes)) {
    const actualValue = normalize(row.attributes[attributeKey]);

    if (isPaymentMethodColumn(attributeKey) && rule.paymentMethodField) {
      const generatedId = findGeneratedPaymentMethodId(
        bootstrap,
        dealerId,
        rule.paymentMethodField.customFieldKey,
        rule.paymentMethodField.optionName
      );

      if (generatedId) {
        if (actualValue !== generatedId) return false;
        continue;
      }

      // Fallback recognition for required defaults such as INVV if a
      // Bootstrap snapshot temporarily does not include the generated ID.
      if (
        rule.alwaysInclude &&
        normalize(rule.mappedAssetIdOverride) &&
        normalize(row.mappedAssetId) === normalize(rule.mappedAssetIdOverride)
      ) {
        continue;
      }

      return false;
    }

    if (actualValue !== normalize(expectedValue)) {
      return false;
    }
  }

  return true;
}

function findScopedBlueprintValue(
  rows: Array<{
    sectionName?: string | null;
    subsectionName?: string | null;
    title?: string | null;
    decodedValue?: unknown;
  }>,
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

  if (exact) return exact.decodedValue;

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

function buildRow(
  dealerId: string,
  rule: MappingRuleDefinition,
  decodedValue: unknown,
  accounts: BootstrapAccount[],
  bootstrap: BootstrapRecord | null
): GlamMappingRow {
  const decodedAccountNumber = extractGlAccountNumber(decodedValue);

  const matchedAccount = decodedAccountNumber
    ? accounts.find((account) => account.accountNumber === decodedAccountNumber)
    : undefined;

  // Vehicle Inventory - INVV is a system-enforced mapping, not a
  // Blueprint-entered GL account. It must always map to <dealerId>_INVV.
  const glSuffix =
    normalize(rule.mappedAssetSuffix) ||
    matchedAccount?.accountNumber ||
    "9999";

  const paymentMethodId = rule.paymentMethodField
    ? findGeneratedPaymentMethodId(
        bootstrap,
        dealerId,
        rule.paymentMethodField.customFieldKey,
        rule.paymentMethodField.optionName
      )
    : "";

  const attributes = { ...rule.attributes };

  if (rule.paymentMethodField) {
    const key = Object.keys(attributes).find((attributeKey) =>
      attributeKey.includes("PAYMENT_METHOD")
    );

    if (key) {
      attributes[key] = paymentMethodId || "MISSING_GENERATED_PAYMENT_METHOD_ID";
    }
  }

  return {
    rowId: generateRowId(),
    attributes,
    // Normal GL mappings use "<dealerId>_<GL account>".
    // INVV is a unique Tekion system account and must be exactly "INVV".
    mappedAssetId:
      normalize(rule.mappedAssetIdOverride) || `${dealerId}_${glSuffix}`,
    mappedDealerId: dealerId,
    targetFieldToValueMapping: {},
  };
}

function getStatusColor(value: boolean): string {
  return value ? "#86efac" : "#fca5a5";
}

function getAttributesKey(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join("|");
}

export const PaymentMappingView: React.FC<{
  config: PaymentMappingScreenConfig;
}> = ({ config }) => {
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

  const flatRows = useMemo(
    () => accountingBlueprint.blueprint?.populatedFlatRows ??
      accountingBlueprint.blueprint?.allFields ??
      [],
    [accountingBlueprint.blueprint]
  );

  const accounts = useMemo(() => getBootstrapAccounts(bootstrap), [bootstrap]);

  const buildDefaultRows = useCallback(
    (activeDealerId: string, activeBootstrap: BootstrapRecord | null): GlamMappingRow[] =>
      config.rules.map((rule) => {
        const decodedValue = findScopedBlueprintValue(
          flatRows,
          rule.blueprintSection,
          rule.blueprintQuestion
        );

        return buildRow(
          activeDealerId,
          rule,
          decodedValue,
          getBootstrapAccounts(activeBootstrap),
          activeBootstrap
        );
      }),
    [config.rules, flatRows]
  );

  const findMatchingRuleForRow = useCallback(
    (row: GlamMappingRow): MappingRuleDefinition | undefined =>
      config.rules.find((rule) =>
        doesRowMatchRule(row, rule, bootstrap, dealerId)
      ),
    [bootstrap, config.rules, dealerId]
  );

  const ensureRequiredDefaultRows = useCallback(
    (rows: GlamMappingRow[], activeDealerId: string, activeBootstrap: BootstrapRecord | null) => {
      const defaults = buildDefaultRows(activeDealerId, activeBootstrap);
      const existingKeys = new Set(rows.map((row) => getAttributesKey(row.attributes)));

      const requiredRows = defaults.filter((row) => {
        const matchingRule = config.rules.find((rule) =>
          doesRowMatchRule(row, rule, activeBootstrap, activeDealerId)
        );

        return Boolean(matchingRule?.alwaysInclude);
      });

      const missingRequiredRows = requiredRows.filter(
        (row) => !existingKeys.has(getAttributesKey(row.attributes))
      );

      return missingRequiredRows.length > 0
        ? [...rows, ...missingRequiredRows]
        : rows;
    },
    [buildDefaultRows, config.rules]
  );

  const saveDraft = useCallback(
    async (rows: GlamMappingRow[], activeDealerId: string) => {
      if (!activeDealerId) return;

      const payload: GlamMappingDraftPayload = {
        module: config.module,
        name: config.name,
        criteriaList: [],
        mappingColumns: config.mappingColumns,
        mappingList: rows,
        ruleAsset: "GLACCOUNT",
      };

      await idbSaveGlamMappingDraft(activeDealerId, payload);
    },
    [config.mappingColumns, config.module, config.name]
  );

  const reload = useCallback(async () => {
    const resolvedDealerId =
      normalize(accountingBlueprint.selectedDealerId) || getDealerIdFromHeaders();

    if (!resolvedDealerId) {
      setDealerId("");
      setBootstrap(null);
      setMappingList([]);
      setMessage("Dealer ID was not found. Select a dealer and apply Global Headers.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const foundBootstrap = await idbFindBootstrapByDealerId(resolvedDealerId);
      const existingDraft = await idbGetGlamMappingDraft(
        resolvedDealerId,
        config.module,
        config.name
      );

      setDealerId(resolvedDealerId);
      setBootstrap(foundBootstrap);

      if (existingDraft) {
        const hydratedRows = ensureRequiredDefaultRows(
          existingDraft.payload.mappingList,
          resolvedDealerId,
          foundBootstrap
        );

        setMappingList(hydratedRows);

        if (hydratedRows.length !== existingDraft.payload.mappingList.length) {
          await saveDraft(hydratedRows, resolvedDealerId);
          setMessage(
            "Loaded saved GLAM draft and restored required Vehicle Inventory - INVV default mapping."
          );
        } else {
          setMessage(
            `Loaded saved GLAM draft from ${new Date(existingDraft.savedAt).toLocaleString()}.`
          );
        }
      } else {
        const defaults = buildDefaultRows(resolvedDealerId, foundBootstrap);
        const hydratedRows = ensureRequiredDefaultRows(
          defaults,
          resolvedDealerId,
          foundBootstrap
        );

        setMappingList(hydratedRows);
        await saveDraft(hydratedRows, resolvedDealerId);
      }

      if (!foundBootstrap) {
        setMessage(
          "No Bootstrap snapshot found for this dealer. All unresolved GL accounts use the 9999 fallback."
        );
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load mapping data.");
    } finally {
      setLoading(false);
    }
  }, [
    accountingBlueprint.selectedDealerId,
    buildDefaultRows,
    config.module,
    config.name,
    saveDraft,
  ]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const sourceRows = useMemo(
    () =>
      config.rules.map((rule) => {
        const decodedValue = findScopedBlueprintValue(
          flatRows,
          rule.blueprintSection,
          rule.blueprintQuestion
        );

        const accountNumber =
          normalize(rule.mappedAssetSuffix) ||
          extractGlAccountNumber(decodedValue);

        const accountFound = Boolean(
          normalize(rule.mappedAssetSuffix) ||
            (accountNumber &&
              accounts.some((account) => account.accountNumber === accountNumber))
        );

        const generatedPaymentMethodId = rule.paymentMethodField
          ? findGeneratedPaymentMethodId(
              bootstrap,
              dealerId,
              rule.paymentMethodField.customFieldKey,
              rule.paymentMethodField.optionName
            )
          : "";

        return {
          rule,
          decodedValue:
            normalize(rule.mappedAssetSuffix)
              ? `System default: ${rule.mappedAssetSuffix}`
              : normalize(
                  Array.isArray(decodedValue) ? decodedValue.join(", ") : decodedValue
                ),
          accountNumber,
          accountFound,
          generatedPaymentMethodId,
        };
      }),
    [accounts, bootstrap, config.rules, dealerId, flatRows]
  );

  /**
   * Updates the editable mappedAssetId input while the user types.
   * It does not alter attributes, payment-method IDs, or any Blueprint data.
   */
  const updateMappedAssetIdDraft = (
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
   * Saves a manual mappedAssetId override into the local GLAM draft.
   * The exact edited value is retained in the outgoing Tekion payload.
   */
  const saveMappedAssetIdEdit = async (
    rowId: string | null | undefined,
    index: number,
    mappedAssetId: string
  ) => {
    const nextRows = mappingList.map((row, rowIndex) => {
      const isTargetRow = rowId
        ? row.rowId === rowId
        : rowIndex === index;

      return isTargetRow
        ? {
            ...row,
            mappedAssetId,
          }
        : row;
    });

    setMappingList(nextRows);
    await saveDraft(nextRows, dealerId);
  };

  const deleteRow = async (rowId: string | null, index: number) => {
    const rowToDelete = mappingList[index];

    const matchingRule = rowToDelete
      ? findMatchingRuleForRow(rowToDelete)
      : undefined;

    if (matchingRule?.alwaysInclude) {
      setMessage(
        `"${matchingRule.label}" is a required system default and cannot be deleted.`
      );
      return;
    }

    const nextRows = mappingList.filter((row, rowIndex) =>
      rowId ? row.rowId !== rowId : rowIndex !== index
    );

    setMappingList(nextRows);
    await saveDraft(nextRows, dealerId);
  };

  const resetFromBlueprint = async () => {
    const rows = buildDefaultRows(dealerId, bootstrap);
    setMappingList(rows);
    await saveDraft(rows, dealerId);
    setMessage("Mapping rows were rebuilt from Blueprint + Bootstrap data.");
  };

  const syncActiveRowsFromValidatedBlueprint = async () => {
    if (!dealerId) {
      setMessage("Dealer ID is missing. Select a Dealer Profile in Settings first.");
      return;
    }

    const rebuiltRows = buildDefaultRows(dealerId, bootstrap);

    const rebuiltByAttributes = new Map(
      rebuiltRows.map((row) => [getAttributesKey(row.attributes), row])
    );

    const synchronizedRows = mappingList.map((currentRow) => {
      const rebuiltRow = rebuiltByAttributes.get(
        getAttributesKey(currentRow.attributes)
      );

      if (!rebuiltRow) {
        return currentRow;
      }

      return {
        ...rebuiltRow,
        rowId: currentRow.rowId ?? rebuiltRow.rowId,
      };
    });

    setMappingList(synchronizedRows);
    await saveDraft(synchronizedRows, dealerId);

    setMessage(
      `Synced ${synchronizedRows.length} active row(s) from validated Blueprint and Bootstrap data. Deleted rows were preserved.`
    );
  };

  const deployMappingToTekion = async () => {
    if (!dealerId) {
      setDeployMessage({
        ok: false,
        text: "Dealer ID is missing. Select a Dealer Profile in Settings first.",
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

    const rowsForDeploy = ensureRequiredDefaultRows(
      mappingList,
      dealerId,
      bootstrap
    );

    if (rowsForDeploy.length !== mappingList.length) {
      setMappingList(rowsForDeploy);
    }

    const payload: GlamMappingDraftPayload = {
      module: config.module,
      name: config.name,
      criteriaList: [],
      mappingColumns: config.mappingColumns,
      mappingList: rowsForDeploy,
      ruleAsset: "GLACCOUNT",
    };

    setDeploying(true);
    setDeployMessage(null);

    try {
      await saveDraft(rowsForDeploy, dealerId);

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
          `${json.status ?? ""} ${json.statusText ?? "Tekion request failed"}`.trim()
        );
      }

      setDeployMessage({
        ok: true,
        text: `Successfully sent ${mappingList.length} mapping row(s) for "${config.name}" to Tekion.`,
      });
    } catch (error: unknown) {
      setDeployMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Failed to send mapping to Tekion.",
      });
    } finally {
      setDeploying(false);
    }
  };

  const payloadPreview = useMemo<GlamMappingDraftPayload>(
    () => ({
      module: config.module,
      name: config.name,
      criteriaList: [],
      mappingColumns: config.mappingColumns,
      mappingList,
      ruleAsset: "GLACCOUNT",
    }),
    [config.mappingColumns, config.module, config.name, mappingList]
  );

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ color: "#f8fafc", fontSize: 22, fontWeight: 800 }}>
          {config.title}
        </div>
        <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>
          {config.description}
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
          Dealer: <b style={{ color: "#f8fafc" }}>{dealerId || "Not found"}</b>
        </span>
        <span style={{ color: "#94a3b8", fontSize: 12 }}>
          Blueprint:{" "}
          <b style={{ color: accountingBlueprint.hasBlueprint ? "#86efac" : "#fca5a5" }}>
            {accountingBlueprint.hasBlueprint ? "Connected" : "Not found"}
          </b>
        </span>
        <span style={{ color: "#94a3b8", fontSize: 12 }}>
          Bootstrap:{" "}
          <b style={{ color: bootstrap ? "#86efac" : "#fca5a5" }}>
            {bootstrap ? `${accounts.length} GL accounts` : "Not found"}
          </b>
        </span>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn-secondary btn-sm" type="button" onClick={() => void reload()}>
            ⟳ Reload
          </button>
          <button className="btn-secondary btn-sm" type="button" onClick={() => void resetFromBlueprint()}>
            Reset From Blueprint
          </button>
          <button
            className="btn-secondary btn-sm"
            type="button"
            disabled={loading || !dealerId}
            onClick={() => void syncActiveRowsFromValidatedBlueprint()}
            title="Updates active payload rows from Blueprint and Bootstrap, while keeping deleted rows deleted"
          >
            ⇣ Sync Validated Rows
          </button>
          <button
            className="btn-postman"
            type="button"
            disabled={deploying || !dealerId}
            onClick={() => void deployMappingToTekion()}
            title="Uses Global Headers from the selected Dealer Profile in Settings"
          >
            {deploying
              ? "Sending to Tekion..."
              : `⇢ Send ${mappingList.length} Row${mappingList.length === 1 ? "" : "s"} to Tekion`}
          </button>
        </div>
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
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1080 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.05)" }}>
              <th style={headerStyle}>Blueprint Section</th>
              <th style={headerStyle}>Blueprint Question</th>
              <th style={headerStyle}>Decoded Value</th>
              <th style={headerStyle}>GL Account #</th>
              <th style={headerStyle}>Bootstrap GL Status</th>
              <th style={headerStyle}>Generated Payment Method ID</th>
            </tr>
          </thead>
          <tbody>
            {sourceRows.map((source) => (
              <tr key={source.rule.key} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <td style={cellStyle}>{source.rule.blueprintSection}</td>
                <td style={cellStyle}>{source.rule.blueprintQuestion}</td>
                <td style={{ ...cellStyle, fontFamily: "ui-monospace, monospace" }}>
                  {source.decodedValue || "—"}
                </td>
                <td style={{ ...cellStyle, fontFamily: "ui-monospace, monospace" }}>
                  {source.accountNumber ?? "9999"}
                </td>
                <td style={cellStyle}>
                  <span style={{ color: getStatusColor(source.accountFound), fontWeight: 700 }}>
                    {source.accountFound ? "✓ Valid" : "Fallback → 9999"}
                  </span>
                </td>
                <td style={{ ...cellStyle, fontFamily: "ui-monospace, monospace" }}>
                  {source.rule.paymentMethodField
                    ? source.generatedPaymentMethodId || "Missing generated ID"
                    : "Not required"}
                </td>
              </tr>
            ))}
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
        <div style={{ padding: "12px 14px", color: "#f8fafc", fontWeight: 800 }}>
          Active Payload Mapping Rows ({mappingList.length})
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          <thead>
            <tr style={{ background: "rgba(255,255,255,0.05)" }}>
              <th style={headerStyle}>#</th>
              {config.mappingColumns.map((column) => (
                <th key={column} style={headerStyle}>{column}</th>
              ))}
              <th style={headerStyle}>mappedAssetId</th>
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
              <tr key={row.rowId ?? `${index}-${row.mappedAssetId}`} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <td style={cellStyle}>{index + 1}</td>
                {config.mappingColumns.map((column) => {
                  const paymentMethodName = findPaymentMethodNameByGeneratedId(
                    config.rules,
                    row,
                    column,
                    bootstrap,
                    dealerId
                  );

                  return (
                    <td
                      key={column}
                      style={{
                        ...cellStyle,
                        fontFamily: "ui-monospace, monospace",
                      }}
                    >
                      <code style={{ color: "#e2e8f0", fontSize: 12 }}>
                        {row.attributes[column] || "—"}
                      </code>

                      {paymentMethodName ? (
                        <div
                          title={paymentMethodName}
                          style={{
                            marginTop: 5,
                            color: "#94a3b8",
                            fontFamily: "inherit",
                            fontSize: 11,
                            lineHeight: 1.35,
                            overflowWrap: "anywhere",
                          }}
                        >
                          {paymentMethodName}
                        </div>
                      ) : null}
                    </td>
                  );
                })}
                <td style={cellStyle}>
                  <input
                    type="text"
                    value={row.mappedAssetId || ""}
                    onChange={(event) =>
                      updateMappedAssetIdDraft(
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
                    title={
                      "Editable mappedAssetId. Normal GL mappings use dealerId_GLAccount, for example 8111_32400. " +
                      "The protected Vehicle Inventory default normally remains INVV."
                    }
                    style={{
                      width: "100%",
                      minWidth: 175,
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
                      lineHeight: 1.35,
                    }}
                  >
                    Manual override — saved when you leave this field.
                  </div>
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
                  {(() => {
                    const matchingRule = findMatchingRuleForRow(row);

                    const isRequiredDefault = Boolean(matchingRule?.alwaysInclude);

                    return (
                      <button
                        type="button"
                        className={isRequiredDefault ? "btn-secondary btn-xs" : "btn-danger btn-xs"}
                        disabled={isRequiredDefault}
                        onClick={() => void deleteRow(row.rowId, index)}
                        title={
                          isRequiredDefault
                            ? "Required Vehicle Inventory - INVV system default"
                            : "Remove this row from the saved draft and outgoing Tekion payload"
                        }
                      >
                        {isRequiredDefault ? "🔒 Required Default" : "🗑 Delete"}
                      </button>
                    );
                  })()}
                </td>
              </tr>
            ))}
            {!loading && mappingList.length === 0 ? (
              <tr>
                <td colSpan={config.mappingColumns.length + 3} style={{ ...cellStyle, color: "#94a3b8" }}>
                  No mapping rows remain. The synchronized payload will send an empty mappingList.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <details>
        <summary style={{ cursor: "pointer", color: "#cbd5e1", fontWeight: 700 }}>
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

const headerStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
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
