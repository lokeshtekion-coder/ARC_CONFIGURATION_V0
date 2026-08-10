export interface RawOption {
  id?: string;
  name?: string;
}

export interface RawAccount {
  accountName?: string;
  accountNumber?: string;
  active?: boolean;
  id?: string;
  accountTypeId?: string;
}

export interface RawCustomField {
  key?: string;
  options?: RawOption[];
}

export interface RawJournal {
  id?: string;
  journalName?: string;
  journalNumber?: string;
  active?: boolean;
}

export interface GLAccount {
  key: string;
  accountName: string;
  accountNumber: string;
  active: boolean;
  id: string;
  accountTypeId: string;
}

export interface CostCenterOption {
  id: string;
  name: string;
}

export interface CostCenterSetup {
  key: string;
  customFieldKey: string;
  options: CostCenterOption[];
}

export interface Journal {
  key: string;
  id: string;
  journalName: string;
  journalNumber: string;
}

export interface BootstrapOutput {
  dealerId: string;
  glAccounts: GLAccount[];
  costCenterSetup: CostCenterSetup[];
  journals: Journal[];
}

export interface BootstrapStats {
  dealerId: string;
  totalGLAccounts: number;
  totalJournals: number;
  costCenterKeysExpected: number;
  costCenterKeysFound: number;
  foundKeys: string[];
  missingKeys: string[];
}

export const COST_CENTER_KEYS = new Set<string>([
  "DEPARTMENT",
  "REPAIR_ORDER_WARRANTY",
  "REPAIR_ORDER_CP_IW_SPLIT",
  "PARTS_SALES_ORDER_INTERNAL",
  "REPAIR_ORDER_INTERNAL",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeRootData(response: unknown): Record<string, unknown> {
  const root = asRecord(response);
  if (!root) {
    throw new Error("Invalid response object");
  }

  const wrappedData = asRecord(root.data);
  if (wrappedData) {
    return wrappedData;
  }

  if (
    "allAccounts" in root ||
    "customField" in root ||
    "allJournals" in root
  ) {
    return root;
  }

  throw new Error("Missing: data");
}

function getNestedRecord(root: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = root[key];
  const rec = asRecord(value);
  if (!rec) {
    throw new Error(`Missing: ${key}`);
  }
  return rec;
}

function getMasterAssetDocMap(
  container: Record<string, unknown>,
  path: string
): Record<string, unknown> {
  const direct = asRecord(container.masterAssetDocMap);
  if (direct) return direct;

  const dealerMap = asRecord(container.dealerAssetDocMap);
  if (dealerMap) {
    const merged: Record<string, unknown> = {};
    for (const value of Object.values(dealerMap)) {
      const nested = asRecord(value);
      if (nested) {
        Object.assign(merged, nested);
      }
    }
    if (Object.keys(merged).length > 0) return merged;
  }

  throw new Error(`Missing: ${path}`);
}

function detectDealerId(data: Record<string, unknown>): string {
  const candidates = [
    "allAccounts",
    "customField",
    "allJournals",
    "accountingSettings",
    "apSetup",
    "arSetup",
    "userAccess",
    "monthCloseSetup",
    "activeMonth",
    "activeYear",
  ];

  for (const key of candidates) {
    const section = asRecord(data[key]);
    const dealerAssetDocMap = section ? asRecord(section.dealerAssetDocMap) : null;
    if (dealerAssetDocMap) {
      const dealerIds = Object.keys(dealerAssetDocMap).filter(Boolean);
      if (dealerIds.length > 0) return dealerIds[0];
    }

    const masterMap = section ? asRecord(section.masterAssetDocMap) : null;
    if (masterMap) {
      for (const value of Object.values(masterMap)) {
        const rec = asRecord(value);
        if (rec && typeof rec.dealerId === "string" && rec.dealerId.trim()) {
          return rec.dealerId.trim();
        }
      }
    }
  }

  return "UNKNOWN";
}

function validateAndNormalizeRawData(response: unknown): {
  dealerId: string;
  allAccountsMap: Record<string, unknown>;
  customFieldMap: Record<string, unknown>;
  allJournalsMap: Record<string, unknown>;
} {
  const data = normalizeRootData(response);

  const allAccounts = getNestedRecord(data, "allAccounts");
  const customField = getNestedRecord(data, "customField");
  const allJournals = getNestedRecord(data, "allJournals");

  return {
    dealerId: detectDealerId(data),
    allAccountsMap: getMasterAssetDocMap(allAccounts, "data.allAccounts.masterAssetDocMap"),
    customFieldMap: getMasterAssetDocMap(customField, "data.customField.masterAssetDocMap"),
    allJournalsMap: getMasterAssetDocMap(allJournals, "data.allJournals.masterAssetDocMap"),
  };
}

export function extractBootstrapData(response: unknown): BootstrapOutput {
  const { dealerId, allAccountsMap, customFieldMap, allJournalsMap } =
    validateAndNormalizeRawData(response);

  const glAccounts: GLAccount[] = Object.entries(allAccountsMap)
    .map(([mapKey, raw]) => {
      const account = (asRecord(raw) ?? {}) as RawAccount;
      return {
        key: mapKey,
        accountName: account.accountName ?? "",
        accountNumber: account.accountNumber ?? "",
        active: account.active ?? false,
        id: account.id ?? "",
        accountTypeId: account.accountTypeId ?? "",
      };
    })
    .filter((a) => a.active);

  const costCenterSetup: CostCenterSetup[] = Object.entries(customFieldMap)
    .map(([mapKey, raw]) => {
      const cf = (asRecord(raw) ?? {}) as RawCustomField;
      return {
        key: mapKey,
        customFieldKey: cf.key ?? "",
        options: Array.isArray(cf.options)
          ? cf.options.map((opt) => ({
              id: opt?.id ?? "",
              name: opt?.name ?? "",
            }))
          : [],
      };
    })
    .filter((cc) => COST_CENTER_KEYS.has(cc.customFieldKey));

  const journals: Journal[] = Object.entries(allJournalsMap)
    .map(([mapKey, raw]) => {
      const journal = (asRecord(raw) ?? {}) as RawJournal;
      return {
        key: mapKey,
        id: journal.id ?? "",
        journalName: journal.journalName ?? "",
        journalNumber: journal.journalNumber ?? "",
      };
    })
    .filter((j) => Boolean(j.id || j.journalName || j.journalNumber));

  return {
    dealerId,
    glAccounts,
    costCenterSetup,
    journals,
  };
}

export function computeStats(output: BootstrapOutput): BootstrapStats {
  const foundKeys = output.costCenterSetup.map((cc) => cc.customFieldKey);
  const missingKeys = [...COST_CENTER_KEYS].filter((key) => !foundKeys.includes(key));

  return {
    dealerId: output.dealerId,
    totalGLAccounts: output.glAccounts.length,
    totalJournals: output.journals.length,
    costCenterKeysExpected: COST_CENTER_KEYS.size,
    costCenterKeysFound: foundKeys.length,
    foundKeys,
    missingKeys,
  };
}

function escapeCsv(value: string | boolean | number): string {
  const str = String(value);
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

export function toCsvString(output: BootstrapOutput): string {
  const lines: string[] = [];

  lines.push(`dealerId,${escapeCsv(output.dealerId)}`);
  lines.push("");

  lines.push("=== GL ACCOUNTS ===");
  lines.push("key,accountName,accountNumber,active,id,accountTypeId");
  for (const a of output.glAccounts) {
    lines.push(
      [
        escapeCsv(a.key),
        escapeCsv(a.accountName),
        escapeCsv(a.accountNumber),
        escapeCsv(a.active),
        escapeCsv(a.id),
        escapeCsv(a.accountTypeId),
      ].join(",")
    );
  }

  lines.push("");
  lines.push("=== COST CENTER SETUP ===");
  lines.push("key,customFieldKey,optionId,optionName");
  for (const cc of output.costCenterSetup) {
    if (cc.options.length === 0) {
      lines.push([escapeCsv(cc.key), escapeCsv(cc.customFieldKey), "", ""].join(","));
    } else {
      for (const opt of cc.options) {
        lines.push(
          [
            escapeCsv(cc.key),
            escapeCsv(cc.customFieldKey),
            escapeCsv(opt.id),
            escapeCsv(opt.name),
          ].join(",")
        );
      }
    }
  }

  lines.push("");
  lines.push("=== JOURNALS ===");
  lines.push("key,id,journalName,journalNumber");
  for (const j of output.journals) {
    lines.push(
      [
        escapeCsv(j.key),
        escapeCsv(j.id),
        escapeCsv(j.journalName),
        escapeCsv(j.journalNumber),
      ].join(",")
    );
  }

  return lines.join("\n");
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
