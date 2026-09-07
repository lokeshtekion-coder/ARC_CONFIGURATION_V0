import React, { useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";
import {
  GLAM_GROUPS,
  glamLogger,
  type GlamGroupKey,
  type GlamItemKey,
} from "./config/glamConfig";
import {
  Arrow,
  contentCardStyle,
  itemButtonBaseStyle,
  leftPanelStyle,
} from "./components/glamShared";

import NewVehiclesView from "./Variable Operations/New Vehicles";
import UsedVehiclesView from "./Variable Operations/Used Vehicles";
import FIProductsView from "./Variable Operations/F&I Products";
import ReceivablesView from "./Variable Operations/Receivables";
import PayablesView from "./Variable Operations/Payables";

import ServicesView from "./Fixed Operations/Services";
import PartsAccessoriesView from "./Fixed Operations/Part & Accessories";
import OthersView from "./Fixed Operations/Others";

import PaymentVariableOperationsView from "./Payment Receipts/Variable Operations";
import PaymentFixedOperationsView from "./Payment Receipts/Fixed Operations";

type GlamFoldersMessage = {
  ok: boolean;
  text: string;
};

type MappingRow = {
  attributes: Record<string, string>;
  mappedAssetId: string;
  mappedDealerId: string;
  rowId: string | null;
  targetFieldToValueMapping: Record<string, string>;
};

type GlamFolderPayload = {
  module: string;
  name: string;
  criteriaList: unknown[];
  mappingColumns: string[];
  mappingList: MappingRow[];
  ruleAsset: "GLACCOUNT";
};

type GlamFolderCreateResult = {
  total: number;
  successCount: number;
  failedCount: number;
  results: Array<{
    module: string;
    name: string;
    success: boolean;
    error?: string;
    payload: GlamFolderPayload;
  }>;
};

const GLAM_FOLDER_URL =
  "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/rule";

const DEFAULT_RULE_ASSET = "GLACCOUNT" as const;
const DEFAULT_GL_SUFFIX = "9999";

const GLAM_FOLDER_RULES: Array<{ module: string; names: string[] }> = [
  { module: "NEW_VEHICLE", names: ["New Vehicle Sales"] },
  { module: "USED_VEHICLE", names: ["Used Vehicles Sales"] },
  { module: "FNI_PRODUCT", names: ["FI Products"] },
  { module: "RECEIVABLES", names: ["Factory Receivables", "Finance Reserve"] },
  { module: "PAYABLES", names: ["Lien Payoff", "Vehicle Sale Commission", "Deal Taxes", "Deal Fees"] },
  {
    module: "SERVICE",
    names: ["Service - Customer Pay", "Service - Internal Pay", "Service - Warranty Pay"],
  },
  {
    module: "PARTS_N_ACCESSORIES",
    names: [
      "Source Specific RO Parts",
      "Parts Source Specific",
      "Parts Counter Sales",
      "Parts Repair Order Sales",
    ],
  },
  { module: "FO_OTHERS", names: ["Fixed Op Others"] },
  { module: "PAYMENT_METHODS_VAR_OPS", names: ["Vehicle Sales"] },
  {
    module: "PAYMENT_METHODS_FIXED_OPS",
    names: [
      "Payment Methods - Service - Customer Pay",
      "Payment Methods - Service - Warranty",
      "Payment Methods - Service - Internal",
      "Parts Payment Method",
      "Internal Parts Payment Method",
    ],
  },
];

function normalize(value: unknown): string {
  return String(value ?? "").trim();
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

function extractDealerIdFromHeaders(headers: Record<string, string>): string {
  const candidates = ["dealerid", "dealerId", "dealer-id", "x-dealer-id", "x-dealerid"];
  const entries = Object.entries(headers);
  for (const candidate of candidates) {
    const found = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
    if (found?.[1]) return normalize(found[1]);
  }
  return "";
}

function generateRowId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function buildMappedAssetId(dealerId: string, glValue?: string): string {
  const suffix = normalize(glValue) || DEFAULT_GL_SUFFIX;
  return `${dealerId}_${suffix}`;
}

function createMappingRow(
  dealerId: string,
  attributes: Record<string, string>,
  mappedAssetSuffix = DEFAULT_GL_SUFFIX,
  options?: { rowId?: string | null; generateIdWhenMissing?: boolean }
): MappingRow {
  const explicitRowId = options?.rowId;
  const rowId =
    explicitRowId === null
      ? null
      : explicitRowId
      ? explicitRowId
      : options?.generateIdWhenMissing === false
      ? null
      : generateRowId();

  return {
    attributes,
    mappedAssetId: buildMappedAssetId(dealerId, mappedAssetSuffix),
    mappedDealerId: dealerId,
    rowId,
    targetFieldToValueMapping: {},
  };
}

function buildCustomPayload(module: string, name: string, dealerId: string): GlamFolderPayload | null {
  if (module === "USED_VEHICLE" && name === "Used Vehicles Sales") {
    return {
      module,
      name,
      criteriaList: [],
      mappingColumns: ["DEAL_TYPE", "BODY_CLASS", "VEHICLE_STATUS"],
      mappingList: [
        createMappingRow(dealerId, { DEAL_TYPE: "WHOLESALE", BODY_CLASS: "Truck/Van", VEHICLE_STATUS: "ALL" }),
        createMappingRow(dealerId, { DEAL_TYPE: "WHOLESALE", BODY_CLASS: "SUV", VEHICLE_STATUS: "ALL" }),
        createMappingRow(dealerId, { DEAL_TYPE: "WHOLESALE", BODY_CLASS: "Car", VEHICLE_STATUS: "ALL" }),
        createMappingRow(dealerId, { DEAL_TYPE: "ALL", BODY_CLASS: "Car", VEHICLE_STATUS: "CERTIFIED" }),
        createMappingRow(dealerId, { DEAL_TYPE: "ALL", BODY_CLASS: "Truck/Van", VEHICLE_STATUS: "CERTIFIED" }),
        createMappingRow(dealerId, { DEAL_TYPE: "ALL", BODY_CLASS: "SUV", VEHICLE_STATUS: "CERTIFIED" }),
        createMappingRow(dealerId, { DEAL_TYPE: "ALL", BODY_CLASS: "Car", VEHICLE_STATUS: "NON_CERTIFIED" }),
        createMappingRow(dealerId, { DEAL_TYPE: "ALL", BODY_CLASS: "Truck/Van", VEHICLE_STATUS: "NON_CERTIFIED" }),
        createMappingRow(dealerId, { DEAL_TYPE: "ALL", BODY_CLASS: "SUV", VEHICLE_STATUS: "NON_CERTIFIED" }),
        createMappingRow(dealerId, { DEAL_TYPE: "ALL", BODY_CLASS: "Car", VEHICLE_STATUS: "ALL" }),
        createMappingRow(dealerId, { DEAL_TYPE: "ALL", BODY_CLASS: "Truck/Van", VEHICLE_STATUS: "ALL" }),
        createMappingRow(dealerId, { DEAL_TYPE: "ALL", BODY_CLASS: "SUV", VEHICLE_STATUS: "ALL" }),
      ],
      ruleAsset: DEFAULT_RULE_ASSET,
    };
  }

  if (module === "RECEIVABLES" && name === "Factory Receivables") {
    return {
      module,
      name,
      criteriaList: [],
      mappingColumns: ["FACTORY_RECEIVABLE_TYPE"],
      mappingList: [
        createMappingRow(dealerId, { FACTORY_RECEIVABLE_TYPE: "HOLDBACK" }),
        createMappingRow(dealerId, { FACTORY_RECEIVABLE_TYPE: "REBATES" }),
        createMappingRow(dealerId, { FACTORY_RECEIVABLE_TYPE: "INCENTIVES" }),
      ],
      ruleAsset: DEFAULT_RULE_ASSET,
    };
  }

  if (module === "RECEIVABLES" && name === "Finance Reserve") {
    return {
      module,
      name,
      criteriaList: [],
      mappingColumns: ["FINANCE_COMPANY", "VEHICLE_CONDITION"],
      mappingList: [
        createMappingRow(dealerId, {
          FINANCE_COMPANY: "FINANCE_RESERVE_OFFSET",
          VEHICLE_CONDITION: "NEW",
        }),
        createMappingRow(dealerId, {
          FINANCE_COMPANY: "FINANCE_RESERVE_OFFSET",
          VEHICLE_CONDITION: "USED",
        }),
      ],
      ruleAsset: DEFAULT_RULE_ASSET,
    };
  }

  if (module === "PAYABLES" && name === "Lien Payoff") {
    return {
      module,
      name,
      criteriaList: [],
      mappingColumns: ["PAYABLE_TYPE"],
      mappingList: [
        createMappingRow(dealerId, { PAYABLE_TYPE: "LIEN_PAYOFF" }),
        createMappingRow(dealerId, { PAYABLE_TYPE: "ACCESSORIES_DUE" }),
      ],
      ruleAsset: DEFAULT_RULE_ASSET,
    };
  }

  if (module === "PAYABLES" && name === "Vehicle Sale Commission") {
    return {
      module,
      name,
      criteriaList: [],
      mappingColumns: ["VEHICLE_CONDITION", "PAYROLL_TYPE"],
      mappingList: [
        createMappingRow(dealerId, { VEHICLE_CONDITION: "NEW", PAYROLL_TYPE: "SALARY_WAGES_COMMISSION" }),
        createMappingRow(dealerId, { VEHICLE_CONDITION: "USED", PAYROLL_TYPE: "SALARY_WAGES_COMMISSION" }),
        createMappingRow(dealerId, { VEHICLE_CONDITION: "NEW", PAYROLL_TYPE: "COMMISSION_OFFSET" }),
        createMappingRow(dealerId, { VEHICLE_CONDITION: "USED", PAYROLL_TYPE: "COMMISSION_OFFSET" }),
        createMappingRow(dealerId, { VEHICLE_CONDITION: "NEW", PAYROLL_TYPE: "PAID_SPIFF" }),
        createMappingRow(dealerId, { VEHICLE_CONDITION: "USED", PAYROLL_TYPE: "PAID_SPIFF" }),
        createMappingRow(dealerId, { VEHICLE_CONDITION: "NEW", PAYROLL_TYPE: "SPIFF_OFFSET" }),
        createMappingRow(dealerId, { VEHICLE_CONDITION: "USED", PAYROLL_TYPE: "SPIFF_OFFSET" }),
      ],
      ruleAsset: DEFAULT_RULE_ASSET,
    };
  }

  if (module === "PAYABLES" && name === "Deal Taxes") {
    return {
      module,
      name,
      criteriaList: [],
      mappingColumns: ["SALES_TAX_TYPE"],
      mappingList: [
        createMappingRow(dealerId, { SALES_TAX_TYPE: "SALES_TAX_VAR_OPS" }),
        createMappingRow(dealerId, { SALES_TAX_TYPE: "COUNTY_SALES_TAX" }),
        createMappingRow(dealerId, { SALES_TAX_TYPE: "CITY_TAX" }),
        createMappingRow(dealerId, { SALES_TAX_TYPE: "CAP_REDUCTION_TAX" }),
        createMappingRow(dealerId, { SALES_TAX_TYPE: "VIT_TAX" }),
        createMappingRow(dealerId, { SALES_TAX_TYPE: "BUSINESS_TAX" }),
        createMappingRow(dealerId, { SALES_TAX_TYPE: "BPOL_TAX" }),
        createMappingRow(dealerId, { SALES_TAX_TYPE: "LOCAL_TAX" }),
        createMappingRow(dealerId, { SALES_TAX_TYPE: "SINGLE_ARTICLE_TAX" }),
        createMappingRow(dealerId, { SALES_TAX_TYPE: "SERVICE_CONTRACTS_SALES_TAX" }),
        createMappingRow(dealerId, { SALES_TAX_TYPE: "CORPORATE_ACTIVITY_TAX" }),
        createMappingRow(dealerId, { SALES_TAX_TYPE: "LUXURY_TAX" }),
      ],
      ruleAsset: DEFAULT_RULE_ASSET,
    };
  }

  if (module === "PAYABLES" && name === "Deal Fees") {
    return {
      module,
      name,
      criteriaList: [],
      mappingColumns: ["FEE_TYPE"],
      mappingList: [
        createMappingRow(dealerId, { FEE_TYPE: "TITLE_FEE" }),
        createMappingRow(dealerId, { FEE_TYPE: "REGISTRATION_CHARGES" }),
        createMappingRow(dealerId, { FEE_TYPE: "EMISSION_TESTING_CHARGE" }),
        createMappingRow(dealerId, { FEE_TYPE: "DOCUMENTATION_FEE" }),
        createMappingRow(dealerId, { FEE_TYPE: "BANK_OR_ACQUISITION_FEE" }),
        createMappingRow(dealerId, { FEE_TYPE: "LEMON_LAW_FEE" }),
        createMappingRow(dealerId, { FEE_TYPE: "LIEN_FEE" }),
        createMappingRow(dealerId, { FEE_TYPE: "ENVIRONMENT_PROTECT_FEE" }),
        createMappingRow(dealerId, { FEE_TYPE: "STATE_FEE" }),
        createMappingRow(dealerId, { FEE_TYPE: "WASTE_TIRE_FEE" }),
        createMappingRow(dealerId, { FEE_TYPE: "TIRE_FEE" }),
      ],
      ruleAsset: DEFAULT_RULE_ASSET,
    };
  }

  if (module === "PAYMENT_METHODS_VAR_OPS" && name === "Vehicle Sales") {
    return {
      module,
      name,
      criteriaList: [],
      mappingColumns: ["PAYMENT_METHOD_VAR_OPS", "DEAL_TYPE", "PAYMENT_CATEGORY"],
      mappingList: [
        createMappingRow(dealerId, {
          PAYMENT_METHOD_VAR_OPS: "RECEIVABLE_CUSTOMER",
          DEAL_TYPE: "WHOLESALE",
          PAYMENT_CATEGORY: "ALL",
        }),
        createMappingRow(dealerId, {
          PAYMENT_METHOD_VAR_OPS: "RECEIVABLE_CUSTOMER",
          DEAL_TYPE: "DEALER_TRADE",
          PAYMENT_CATEGORY: "ALL",
        }),
        createMappingRow(dealerId, {
          PAYMENT_METHOD_VAR_OPS: "RECEIVABLE_CUSTOMER",
          DEAL_TYPE: "ALL",
          PAYMENT_CATEGORY: "DEPOSIT",
        }),
        createMappingRow(dealerId, {
          PAYMENT_METHOD_VAR_OPS: "RECEIVABLE_CUSTOMER",
          DEAL_TYPE: "ALL",
          PAYMENT_CATEGORY: "ALL",
        }),
        createMappingRow(dealerId, {
          PAYMENT_METHOD_VAR_OPS: "RECEIVABLE_CIT",
          DEAL_TYPE: "ALL",
          PAYMENT_CATEGORY: "ALL",
        }),
        createMappingRow(dealerId, {
          PAYMENT_METHOD_VAR_OPS: "CASH",
          DEAL_TYPE: "ALL",
          PAYMENT_CATEGORY: "ALL",
        }),
        createMappingRow(dealerId, {
          PAYMENT_METHOD_VAR_OPS: "CARD",
          DEAL_TYPE: "ALL",
          PAYMENT_CATEGORY: "ALL",
        }),
        createMappingRow(dealerId, {
          PAYMENT_METHOD_VAR_OPS: "CHECK",
          DEAL_TYPE: "ALL",
          PAYMENT_CATEGORY: "ALL",
        }),
      ],
      ruleAsset: DEFAULT_RULE_ASSET,
    };
  }

  if (module === "FO_OTHERS" && name === "Fixed Op Others") {
    return {
      module,
      name,
      criteriaList: [],
      mappingColumns: ["FIXED_OPS_OTHERS"],
      mappingList: [
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "SALES_TAX_PARTS" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "SALES_TAX_LABOR" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "SALES_TAX_SUBLET" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "SALES_TAX_DEDUCTIBLE" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "STATE_TAX_LABOR" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "STATE_TAX_PARTS" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "STATE_TAX_SUBLET" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "STATE_TAX_DEDUCTIBLE" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "CITY_TAX_LABOR" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "CITY_TAX_PARTS" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "CITY_TAX_SUBLET" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "CITY_TAX_DEDUCTIBLE" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "TRANSACTION_CHARGES_BNPL" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "DONATION" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "TAX_DEFAULT" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "OTHER_SUPPLIES" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "FREIGHT_CHARGE" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "RESTOCKING_FEE" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "SERVICE_CASH_HOLDING_ACCOUNT" }),
        createMappingRow(dealerId, { FIXED_OPS_OTHERS: "PARTS_CASH_HOLDING_ACCOUNT" }),
      ],
      ruleAsset: DEFAULT_RULE_ASSET,
    };
  }

  if (module === "PAYMENT_METHODS_FIXED_OPS" && name === "Internal Parts Payment Method") {
    return {
      module,
      name,
      criteriaList: [],
      mappingColumns: ["SALE_TYPE_FIXED_OPS", "PAYMENT_METHOD_PARTS"],
      mappingList: [
        createMappingRow(
          dealerId,
          { SALE_TYPE_FIXED_OPS: "INTERNAL", PAYMENT_METHOD_PARTS: "6a70d3d5e12fef3d70a131bb" },
          "INVV"
        ),
        createMappingRow(
          dealerId,
          { SALE_TYPE_FIXED_OPS: "INTERNAL", PAYMENT_METHOD_PARTS: "6a95bb31f78f90135f9de471" }
        ),
        createMappingRow(
          dealerId,
          { SALE_TYPE_FIXED_OPS: "INTERNAL", PAYMENT_METHOD_PARTS: "INTERNAL_POLICY_PARTS" }
        ),
        createMappingRow(
          dealerId,
          { SALE_TYPE_FIXED_OPS: "INTERNAL", PAYMENT_METHOD_PARTS: "INTERNAL_DUE_BILL" }
        ),
      ],
      ruleAsset: DEFAULT_RULE_ASSET,
    };
  }

  if (module === "PAYMENT_METHODS_FIXED_OPS" && name === "Parts Payment Method") {
    return {
      module,
      name,
      criteriaList: [],
      mappingColumns: ["SALE_TYPE_FIXED_OPS", "PAYMENT_METHOD_PARTS"],
      mappingList: [
        createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "RETAIL", PAYMENT_METHOD_PARTS: "CASH" }, DEFAULT_GL_SUFFIX, { generateIdWhenMissing: false }),
        createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "WHOLESALE", PAYMENT_METHOD_PARTS: "CASH" }, DEFAULT_GL_SUFFIX, { generateIdWhenMissing: false }),
        createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "RETAIL", PAYMENT_METHOD_PARTS: "CHECK" }, DEFAULT_GL_SUFFIX, { generateIdWhenMissing: false }),
        createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "WHOLESALE", PAYMENT_METHOD_PARTS: "CHECK" }, DEFAULT_GL_SUFFIX, { generateIdWhenMissing: false }),
        createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "RETAIL", PAYMENT_METHOD_PARTS: "CARD" }, DEFAULT_GL_SUFFIX, { generateIdWhenMissing: false }),
        createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "WHOLESALE", PAYMENT_METHOD_PARTS: "CARD" }, DEFAULT_GL_SUFFIX, { generateIdWhenMissing: false }),
        createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "RETAIL", PAYMENT_METHOD_PARTS: "CHARGE" }, DEFAULT_GL_SUFFIX, { generateIdWhenMissing: false }),
        createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "WHOLESALE", PAYMENT_METHOD_PARTS: "CHARGE" }, DEFAULT_GL_SUFFIX, { generateIdWhenMissing: false }),
        createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "RETAIL", PAYMENT_METHOD_PARTS: "OEM_REWARD" }),
        createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "WHOLESALE", PAYMENT_METHOD_PARTS: "OEM_REWARD" }, "99999"),
        createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "INTERNAL", PAYMENT_METHOD_PARTS: "OEM_REWARD" }, "99999"),
        createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "REPAIR_ORDER", PAYMENT_METHOD_PARTS: "OEM_REWARD" }),
      ],
      ruleAsset: DEFAULT_RULE_ASSET,
    };
  }

  if (module === "PAYMENT_METHODS_FIXED_OPS" && name === "Payment Methods - Service - Customer Pay") {
    return {
      module,
      name,
      criteriaList: [],
      mappingColumns: ["PAY_TYPE", "PAYMENT_METHOD_FIXED_OPS"],
      mappingList: [
        createMappingRow(
          dealerId,
          { PAY_TYPE: "CUSTOMER_PAY", PAYMENT_METHOD_FIXED_OPS: "CASH" },
          DEFAULT_GL_SUFFIX,
          { generateIdWhenMissing: false }
        ),
        createMappingRow(
          dealerId,
          { PAY_TYPE: "CUSTOMER_PAY", PAYMENT_METHOD_FIXED_OPS: "CHECK" },
          DEFAULT_GL_SUFFIX,
          { generateIdWhenMissing: false }
        ),
        createMappingRow(
          dealerId,
          { PAY_TYPE: "CUSTOMER_PAY", PAYMENT_METHOD_FIXED_OPS: "CARD" },
          DEFAULT_GL_SUFFIX,
          { generateIdWhenMissing: false }
        ),
        createMappingRow(
          dealerId,
          { PAY_TYPE: "CUSTOMER_PAY", PAYMENT_METHOD_FIXED_OPS: "CHARGE" },
          DEFAULT_GL_SUFFIX,
          { generateIdWhenMissing: false }
        ),
        createMappingRow(
          dealerId,
          { PAY_TYPE: "CUSTOMER_PAY", PAYMENT_METHOD_FIXED_OPS: "6a5f79c8d937be09423fa43d" },
          DEFAULT_GL_SUFFIX,
          { generateIdWhenMissing: false }
        ),
        createMappingRow(dealerId, {
          PAY_TYPE: "CUSTOMER_PAY",
          PAYMENT_METHOD_FIXED_OPS: "OEM_REWARD",
        }),
      ],
      ruleAsset: DEFAULT_RULE_ASSET,
    };
  }

  if (module === "SERVICE" && name === "Service - Warranty Pay") {
    return {
      module,
      name,
      criteriaList: [],
      mappingColumns: ["PAY_TYPE", "SERVICE_TYPE"],
      mappingList: [
        createMappingRow(dealerId, { PAY_TYPE: "WARRANTY", SERVICE_TYPE: "6a5f7742d5a439370fb409ce" }),
        createMappingRow(dealerId, { PAY_TYPE: "WARRANTY", SERVICE_TYPE: "6a8c53a7fc1a283b650ee6fd" }),
        createMappingRow(dealerId, { PAY_TYPE: "WARRANTY", SERVICE_TYPE: "ALL" }),
      ],
      ruleAsset: DEFAULT_RULE_ASSET,
    };
  }

  if (module === "SERVICE" && name === "Service - Internal Pay") {
    return {
      module,
      name,
      criteriaList: [],
      mappingColumns: ["PAY_TYPE", "SERVICE_TYPE"],
      mappingList: [
        createMappingRow(dealerId, { PAY_TYPE: "INTERNAL", SERVICE_TYPE: "6a5f7742d5a439370fb409ce" }),
        createMappingRow(dealerId, { PAY_TYPE: "INTERNAL", SERVICE_TYPE: "6a8c53a7fc1a283b650ee6fd" }),
        createMappingRow(dealerId, { PAY_TYPE: "INTERNAL", SERVICE_TYPE: "ALL" }),
      ],
      ruleAsset: DEFAULT_RULE_ASSET,
    };
  }

  if (module === "PARTS_N_ACCESSORIES" && name === "Parts Counter Sales") {
    return {
      module,
      name,
      criteriaList: [],
      mappingColumns: ["SALE_TYPE_FIXED_OPS"],
      mappingList: [
        createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "RETAIL" }),
        createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "INTERNAL" }),
        createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "WHOLESALE" }),
      ],
      ruleAsset: DEFAULT_RULE_ASSET,
    };
  }

  if (module === "PARTS_N_ACCESSORIES" && name === "Parts Repair Order Sales") {
    return {
      module,
      name,
      criteriaList: [],
      mappingColumns: ["SALE_TYPE_FIXED_OPS", "PAY_TYPE", "SERVICE_TYPE"],
      mappingList: [
        createMappingRow(dealerId, {
          SALE_TYPE_FIXED_OPS: "REPAIR_ORDER",
          PAY_TYPE: "CUSTOMER_PAY",
          SERVICE_TYPE: "ALL",
        }),
        createMappingRow(dealerId, {
          SALE_TYPE_FIXED_OPS: "REPAIR_ORDER",
          PAY_TYPE: "WARRANTY",
          SERVICE_TYPE: "ALL",
        }),
        createMappingRow(dealerId, {
          SALE_TYPE_FIXED_OPS: "REPAIR_ORDER",
          PAY_TYPE: "INTERNAL",
          SERVICE_TYPE: "ALL",
        }),
        createMappingRow(dealerId, {
          SALE_TYPE_FIXED_OPS: "REPAIR_ORDER",
          PAY_TYPE: "ALL",
          SERVICE_TYPE: "6a70dc877bb4ac45df894de8",
        }),
      ],
      ruleAsset: DEFAULT_RULE_ASSET,
    };
  }

  if (module === "PARTS_N_ACCESSORIES" && name === "Source Specific RO Parts") {
    return {
      module,
      name,
      criteriaList: [],
      mappingColumns: ["SALE_TYPE_FIXED_OPS", "PAY_TYPE", "SOURCE_CODE"],
      mappingList: [],
      ruleAsset: DEFAULT_RULE_ASSET,
    };
  }

  return null;
}

function buildDefaultPayload(module: string, name: string): GlamFolderPayload {
  return {
    module,
    name,
    criteriaList: [],
    mappingColumns: [],
    mappingList: [],
    ruleAsset: DEFAULT_RULE_ASSET,
  };
}

function buildFolderPayload(module: string, name: string, dealerId: string): GlamFolderPayload {
  return buildCustomPayload(module, name, dealerId) ?? buildDefaultPayload(module, name);
}

async function proxyPost(url: string, body: unknown, headers: Record<string, string>) {
  const response = await fetch("http://localhost:4000/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      method: "POST",
      headers: {
        ...headers,
        "content-type": "application/json",
      },
      body,
      timeout: 60000,
    }),
  });

  if (!response.ok) {
    throw new Error(`Proxy request failed with HTTP ${response.status}`);
  }

  const json = await response.json();

  if ((json?.status ?? 200) >= 400) {
    throw new Error(`${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim());
  }

  return json?.body ?? json?.data ?? json;
}

async function createGlamFoldersWithGlobalHeaders(
  onProgress?: (
    current: number,
    total: number,
    module: string,
    name: string,
    payload: GlamFolderPayload
  ) => void
): Promise<GlamFolderCreateResult> {
  const headers = toEnabledHeaderMap(loadGlobalHeaders());
  const dealerId = extractDealerIdFromHeaders(headers);

  if (!dealerId) {
    throw new Error(
      "Dealer ID not found in Global Headers. Please select/apply dealer headers in Settings first."
    );
  }

  if (Object.keys(headers).length === 0) {
    throw new Error("No active Global Headers found.");
  }

  const flattened = GLAM_FOLDER_RULES.flatMap((group) =>
    group.names.map((name) => ({
      module: group.module,
      name,
    }))
  );

  const total = flattened.length;
  const results: GlamFolderCreateResult["results"] = [];

  for (let index = 0; index < flattened.length; index += 1) {
    const item = flattened[index];
    const current = index + 1;
    const payload = buildFolderPayload(item.module, item.name, dealerId);

    onProgress?.(current, total, item.module, item.name, payload);

    try {
      await proxyPost(GLAM_FOLDER_URL, payload, headers);
      results.push({
        module: item.module,
        name: item.name,
        success: true,
        payload,
      });
    } catch (error: unknown) {
      results.push({
        module: item.module,
        name: item.name,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        payload,
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  const successCount = results.filter((x) => x.success).length;
  const failedCount = results.length - successCount;

  return {
    total,
    successCount,
    failedCount,
    results,
  };
}

function renderSection(activeItemKey: GlamItemKey): React.ReactNode {
  switch (activeItemKey) {
    case "new-vehicles":
      return <NewVehiclesView />;
    case "used-vehicles":
      return <UsedVehiclesView />;
    case "fi-products":
      return <FIProductsView />;
    case "receivables":
      return <ReceivablesView />;
    case "payables":
      return <PayablesView />;
    case "services":
      return <ServicesView />;
    case "parts-accessories":
      return <PartsAccessoriesView />;
    case "others":
      return <OthersView />;
    case "payment-variable-operations":
      return <PaymentVariableOperationsView />;
    case "payment-fixed-operations":
      return <PaymentFixedOperationsView />;
    default:
      return <NewVehiclesView />;
  }
}

export const GLAM: React.FC = () => {
  const [activeItemKey, setActiveItemKey] = useState<GlamItemKey>("new-vehicles");
  const [openGroups, setOpenGroups] = useState<Record<GlamGroupKey, boolean>>({
    "variable-operations": true,
    "fixed-operations": true,
    "payment-receipts": true,
  });

  const [isCreatingFolders, setIsCreatingFolders] = useState(false);
  const [foldersProgressText, setFoldersProgressText] = useState("");
  const [foldersMessage, setFoldersMessage] = useState<GlamFoldersMessage | null>(null);
  const [showFoldersSummary, setShowFoldersSummary] = useState(false);
  const [showPayloadPreview, setShowPayloadPreview] = useState(false);
  const [foldersSummary, setFoldersSummary] = useState<GlamFolderCreateResult | null>(null);
  const [activePayloadPreview, setActivePayloadPreview] = useState<GlamFolderPayload | null>(null);

  const activeMeta = useMemo(() => {
    for (const group of GLAM_GROUPS) {
      const child = group.children.find((item) => item.key === activeItemKey);
      if (child) {
        return { group, item: child };
      }
    }

    return {
      group: GLAM_GROUPS[0],
      item: GLAM_GROUPS[0].children[0],
    };
  }, [activeItemKey]);

  const globalHeaders = useMemo(() => toEnabledHeaderMap(loadGlobalHeaders()), []);
  const dealerId = useMemo(() => extractDealerIdFromHeaders(globalHeaders), [globalHeaders]);
  const globalHeaderCount = useMemo(() => Object.keys(globalHeaders).length, [globalHeaders]);

  const customizedFolderCount = useMemo(() => {
    return GLAM_FOLDER_RULES.flatMap((group) =>
      group.names.map((name) => ({ module: group.module, name }))
    ).filter((item) => buildCustomPayload(item.module, item.name, dealerId || "0000") !== null).length;
  }, [dealerId]);

  glamLogger.info("render", {
    activeItemKey,
    activeGroup: activeMeta.group.key,
  });

  const handleCreateGlamFolders = async () => {
    setIsCreatingFolders(true);
    setFoldersMessage(null);
    setFoldersSummary(null);
    setActivePayloadPreview(null);
    setFoldersProgressText("Initializing GLAM folder creation...");

    try {
      const result = await createGlamFoldersWithGlobalHeaders(
        (current, total, module, name, payload) => {
          setFoldersProgressText(`Creating ${current}/${total}: ${module} → ${name}`);
          setActivePayloadPreview(payload);
        }
      );

      setFoldersSummary(result);
      setShowFoldersSummary(true);

      if (!showPayloadPreview && result.results.length > 0) {
        setActivePayloadPreview(result.results[0].payload);
      }

      if (result.failedCount === 0) {
        setFoldersMessage({
          ok: true,
          text: `Successfully created all ${result.successCount}/${result.total} GLAM folders.`,
        });
      } else {
        setFoldersMessage({
          ok: false,
          text: `GLAM folder creation completed with partial success. Success: ${result.successCount}/${result.total}, Failed: ${result.failedCount}.`,
        });
      }

      setFoldersProgressText("");
    } catch (error: unknown) {
      setFoldersMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Failed to create GLAM folders.",
      });
      setFoldersProgressText("");
    } finally {
      setIsCreatingFolders(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <div>
        <div
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: "#f8fafc",
            marginBottom: 6,
          }}
        >
          GLAM
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              color: "#94a3b8",
              fontSize: 14,
              lineHeight: 1.7,
              maxWidth: 920,
            }}
          >
            General Ledger Account Mapping workspace with left navigation and
            section-based content area.
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn-postman"
              type="button"
              onClick={() => void handleCreateGlamFolders()}
              disabled={isCreatingFolders}
            >
              {isCreatingFolders ? "Creating GLAM Folders..." : "🗂 Create Glam Folders"}
            </button>

            <button
              className="btn-secondary btn-sm"
              type="button"
              onClick={() => setShowFoldersSummary((prev) => !prev)}
              disabled={!foldersSummary}
            >
              {showFoldersSummary ? "Hide Summary" : "Show Summary"}
            </button>

            <button
              className="btn-secondary btn-sm"
              type="button"
              onClick={() => setShowPayloadPreview((prev) => !prev)}
              disabled={!activePayloadPreview}
            >
              {showPayloadPreview ? "Hide Payload Preview" : "Show Payload Preview"}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              color: "#cbd5e1",
              fontSize: 12,
            }}
          >
            Dealer ID
            <span style={{ color: dealerId ? "#f8fafc" : "#fca5a5", fontWeight: 700 }}>
              {dealerId || "Not found"}
            </span>
          </span>

          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              color: "#cbd5e1",
              fontSize: 12,
            }}
          >
            Global Headers
            <span style={{ color: "#f8fafc", fontWeight: 700 }}>{globalHeaderCount}</span>
          </span>

          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              color: "#cbd5e1",
              fontSize: 12,
            }}
          >
            Folder Rules
            <span style={{ color: "#f8fafc", fontWeight: 700 }}>23</span>
          </span>

          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              color: "#cbd5e1",
              fontSize: 12,
            }}
          >
            Custom Payloads
            <span style={{ color: "#f8fafc", fontWeight: 700 }}>{customizedFolderCount}</span>
          </span>
        </div>

        {foldersProgressText ? (
          <div
            style={{
              marginTop: 12,
              borderRadius: 12,
              border: "1px solid rgba(59,130,246,0.20)",
              background: "rgba(59,130,246,0.10)",
              color: "#bfdbfe",
              padding: "10px 12px",
              fontSize: 13,
            }}
          >
            {foldersProgressText}
          </div>
        ) : null}

        {foldersMessage ? (
          <div
            style={{
              marginTop: 12,
              borderRadius: 12,
              border: foldersMessage.ok
                ? "1px solid rgba(34,197,94,0.22)"
                : "1px solid rgba(239,68,68,0.22)",
              background: foldersMessage.ok
                ? "rgba(34,197,94,0.10)"
                : "rgba(239,68,68,0.10)",
              color: foldersMessage.ok ? "#bbf7d0" : "#fecaca",
              padding: "10px 12px",
              fontSize: 13,
              whiteSpace: "pre-wrap",
            }}
          >
            {foldersMessage.text}
          </div>
        ) : null}

        {showPayloadPreview && activePayloadPreview ? (
          <div
            style={{
              marginTop: 12,
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.025)",
              padding: 14,
            }}
          >
            <div
              style={{
                color: "#f8fafc",
                fontSize: 16,
                fontWeight: 800,
                marginBottom: 10,
              }}
            >
              Payload Preview
            </div>
            <pre
              style={{
                margin: 0,
                padding: 12,
                borderRadius: 12,
                background: "#0f172a",
                color: "#e2e8f0",
                overflow: "auto",
                fontSize: 12,
                whiteSpace: "pre-wrap",
              }}
            >
              {JSON.stringify(activePayloadPreview, null, 2)}
            </pre>
          </div>
        ) : null}

        {showFoldersSummary && foldersSummary ? (
          <div
            style={{
              marginTop: 12,
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.025)",
              padding: 14,
              display: "grid",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.03)",
                  color: "#cbd5e1",
                  fontSize: 12,
                }}
              >
                Total
                <span style={{ color: "#f8fafc", fontWeight: 700 }}>{foldersSummary.total}</span>
              </span>

              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(34,197,94,0.18)",
                  background: "rgba(34,197,94,0.08)",
                  color: "#86efac",
                  fontSize: 12,
                }}
              >
                Success
                <span style={{ color: "#bbf7d0", fontWeight: 700 }}>
                  {foldersSummary.successCount}
                </span>
              </span>

              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(239,68,68,0.18)",
                  background: "rgba(239,68,68,0.08)",
                  color: "#fca5a5",
                  fontSize: 12,
                }}
              >
                Failed
                <span style={{ color: "#fecaca", fontWeight: 700 }}>
                  {foldersSummary.failedCount}
                </span>
              </span>
            </div>

            <div
              style={{
                maxHeight: 260,
                overflow: "auto",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                    <th style={{ textAlign: "left", padding: "10px 12px", color: "#cbd5e1", fontSize: 12, fontWeight: 800 }}>#</th>
                    <th style={{ textAlign: "left", padding: "10px 12px", color: "#cbd5e1", fontSize: 12, fontWeight: 800 }}>Module</th>
                    <th style={{ textAlign: "left", padding: "10px 12px", color: "#cbd5e1", fontSize: 12, fontWeight: 800 }}>Name</th>
                    <th style={{ textAlign: "left", padding: "10px 12px", color: "#cbd5e1", fontSize: 12, fontWeight: 800 }}>Status</th>
                    <th style={{ textAlign: "left", padding: "10px 12px", color: "#cbd5e1", fontSize: 12, fontWeight: 800 }}>Mapping Columns</th>
                    <th style={{ textAlign: "left", padding: "10px 12px", color: "#cbd5e1", fontSize: 12, fontWeight: 800 }}>Rows</th>
                    <th style={{ textAlign: "left", padding: "10px 12px", color: "#cbd5e1", fontSize: 12, fontWeight: 800 }}>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {foldersSummary.results.map((item, index) => (
                    <tr
                      key={`${item.module}-${item.name}-${index}`}
                      style={{
                        borderTop: "1px solid rgba(255,255,255,0.06)",
                        background: item.success
                          ? "rgba(34,197,94,0.03)"
                          : "rgba(239,68,68,0.03)",
                        cursor: "pointer",
                      }}
                      onClick={() => {
                        setActivePayloadPreview(item.payload);
                        setShowPayloadPreview(true);
                      }}
                    >
                      <td style={{ padding: "10px 12px", color: "#e2e8f0", fontSize: 13 }}>
                        {index + 1}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          color: "#93c5fd",
                          fontSize: 13,
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        }}
                      >
                        {item.module}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#e2e8f0", fontSize: 13 }}>
                        {item.name}
                      </td>
                      <td style={{ padding: "10px 12px", fontSize: 13 }}>
                        <span
                          style={{
                            display: "inline-flex",
                            padding: "4px 10px",
                            borderRadius: 999,
                            border: item.success
                              ? "1px solid rgba(34,197,94,0.22)"
                              : "1px solid rgba(239,68,68,0.22)",
                            background: item.success
                              ? "rgba(34,197,94,0.10)"
                              : "rgba(239,68,68,0.10)",
                            color: item.success ? "#86efac" : "#fca5a5",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {item.success ? "Success" : "Failed"}
                        </span>
                      </td>
                      <td style={{ padding: "10px 12px", color: "#cbd5e1", fontSize: 12, whiteSpace: "pre-wrap" }}>
                        {item.payload.mappingColumns.length > 0
                          ? item.payload.mappingColumns.join(", ")
                          : "—"}
                      </td>
                      <td style={{ padding: "10px 12px", color: "#e2e8f0", fontSize: 13 }}>
                        {item.payload.mappingList.length}
                      </td>
                      <td
                        style={{
                          padding: "10px 12px",
                          color: item.error ? "#fca5a5" : "#94a3b8",
                          fontSize: 12,
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {item.error || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px minmax(0, 1fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div style={leftPanelStyle}>
          <div
            style={{
              color: "#f8fafc",
              fontSize: 18,
              fontWeight: 800,
              padding: "4px 4px 8px",
            }}
          >
            GLAM Sections
          </div>

          {GLAM_GROUPS.map((group) => {
            const isOpen = openGroups[group.key];

            return (
              <div
                key={group.key}
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.018)",
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroups((prev) => ({
                      ...prev,
                      [group.key]: !prev[group.key],
                    }))
                  }
                  style={{
                    width: "100%",
                    border: "none",
                    background: "rgba(255,255,255,0.02)",
                    color: "#f8fafc",
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    cursor: "pointer",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Arrow open={isOpen} />
                    <span style={{ fontSize: 14, fontWeight: 800 }}>{group.label}</span>
                  </span>
                  <span
                    style={{
                      color: "#94a3b8",
                      fontSize: 12,
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 999,
                      padding: "2px 8px",
                    }}
                  >
                    {group.children.length}
                  </span>
                </button>

                {isOpen ? (
                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      padding: 10,
                    }}
                  >
                    {group.children.map((item) => {
                      const isActive = item.key === activeItemKey;

                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => {
                            glamLogger.info("section click", {
                              group: group.key,
                              item: item.key,
                            });
                            setActiveItemKey(item.key);
                          }}
                          style={{
                            ...itemButtonBaseStyle,
                            background: isActive
                              ? "rgba(59,130,246,0.12)"
                              : "rgba(255,255,255,0.02)",
                            border: isActive
                              ? "1px solid rgba(59,130,246,0.35)"
                              : "1px solid rgba(255,255,255,0.08)",
                          }}
                        >
                          <div
                            style={{
                              color: isActive ? "#dbeafe" : "#f8fafc",
                              fontSize: 14,
                              fontWeight: 700,
                              marginBottom: 4,
                            }}
                          >
                            {item.label}
                          </div>
                          <div
                            style={{
                              color: isActive ? "#bfdbfe" : "#94a3b8",
                              fontSize: 12,
                              lineHeight: 1.5,
                            }}
                          >
                            {item.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div style={contentCardStyle}>{renderSection(activeItemKey)}</div>
      </div>
    </div>
  );
};

export default GLAM;
