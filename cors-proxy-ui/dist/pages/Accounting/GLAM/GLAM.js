import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../../services/tekionApiSettings";
import { idbGetGlamMappingDraft } from "../../../utils/glamMappingDraftDb";
import { GLAM_GROUPS, glamLogger, } from "./config/glamConfig";
import { Arrow, contentCardStyle, itemButtonBaseStyle, } from "./components/glamShared";
import NewVehiclesView from "./Variable Operations/New Vehicles";
import UsedVehiclesView from "./Variable Operations/Used Vehicles";
import FIProductsView from "./Variable Operations/F&I Products";
import ReceivablesView from "./Variable Operations/Receivables";
import PayablesView from "./Variable Operations/Payables";
import ServicesView from "./Fixed Operations/Services";
import PartsAccessoriesView from "./Fixed Operations/Part & Accessories";
import OthersView from "./Fixed Operations/Others";
import PaymentVariableOperationsView from "./Payment Receipts/Fixed Operations";
import PaymentFixedOperationsView from "./Payment Receipts/Variable Operations";
const GLAM_FOLDER_URL = "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/rule";
const DEFAULT_RULE_ASSET = "GLACCOUNT";
const DEFAULT_GL_SUFFIX = "9999";
const GLAM_FOLDER_RULES = [
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
function normalize(value) {
    return String(value ?? "").trim();
}
function toEnabledHeaderMap(headers) {
    const out = {};
    for (const row of headers) {
        if (!row?.enabled)
            continue;
        const key = normalize(row.key);
        const value = normalize(row.value);
        if (!key || !value)
            continue;
        out[key] = value;
    }
    return out;
}
function extractDealerIdFromHeaders(headers) {
    const candidates = ["dealerid", "dealerId", "dealer-id", "x-dealer-id", "x-dealerid"];
    const entries = Object.entries(headers);
    for (const candidate of candidates) {
        const found = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
        if (found?.[1])
            return normalize(found[1]);
    }
    return "";
}
function generateRowId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
        const random = Math.floor(Math.random() * 16);
        const value = char === "x" ? random : (random & 0x3) | 0x8;
        return value.toString(16);
    });
}
function buildMappedAssetId(dealerId, glValue) {
    const suffix = normalize(glValue) || DEFAULT_GL_SUFFIX;
    return `${dealerId}_${suffix}`;
}
function createMappingRow(dealerId, attributes, mappedAssetSuffix = DEFAULT_GL_SUFFIX, options) {
    const explicitRowId = options?.rowId;
    const rowId = explicitRowId === null
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
function buildCustomPayload(module, name, dealerId) {
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
                createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "INTERNAL", PAYMENT_METHOD_PARTS: "6a70d3d5e12fef3d70a131bb" }, "INVV"),
                createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "INTERNAL", PAYMENT_METHOD_PARTS: "6a95bb31f78f90135f9de471" }),
                createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "INTERNAL", PAYMENT_METHOD_PARTS: "INTERNAL_POLICY_PARTS" }),
                createMappingRow(dealerId, { SALE_TYPE_FIXED_OPS: "INTERNAL", PAYMENT_METHOD_PARTS: "INTERNAL_DUE_BILL" }),
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
                createMappingRow(dealerId, { PAY_TYPE: "CUSTOMER_PAY", PAYMENT_METHOD_FIXED_OPS: "CASH" }, DEFAULT_GL_SUFFIX, { generateIdWhenMissing: false }),
                createMappingRow(dealerId, { PAY_TYPE: "CUSTOMER_PAY", PAYMENT_METHOD_FIXED_OPS: "CHECK" }, DEFAULT_GL_SUFFIX, { generateIdWhenMissing: false }),
                createMappingRow(dealerId, { PAY_TYPE: "CUSTOMER_PAY", PAYMENT_METHOD_FIXED_OPS: "CARD" }, DEFAULT_GL_SUFFIX, { generateIdWhenMissing: false }),
                createMappingRow(dealerId, { PAY_TYPE: "CUSTOMER_PAY", PAYMENT_METHOD_FIXED_OPS: "CHARGE" }, DEFAULT_GL_SUFFIX, { generateIdWhenMissing: false }),
                createMappingRow(dealerId, { PAY_TYPE: "CUSTOMER_PAY", PAYMENT_METHOD_FIXED_OPS: "SERVICE_CONTRACTS" }, DEFAULT_GL_SUFFIX, { generateIdWhenMissing: false }),
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
function buildDefaultPayload(module, name) {
    return {
        module,
        name,
        criteriaList: [],
        mappingColumns: [],
        mappingList: [],
        ruleAsset: DEFAULT_RULE_ASSET,
    };
}
function buildFolderPayload(module, name, dealerId) {
    return buildCustomPayload(module, name, dealerId) ?? buildDefaultPayload(module, name);
}
async function proxyPost(url, body, headers) {
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
async function createGlamFoldersWithGlobalHeaders(onProgress) {
    const headers = toEnabledHeaderMap(loadGlobalHeaders());
    const dealerId = extractDealerIdFromHeaders(headers);
    if (!dealerId) {
        throw new Error("Dealer ID not found in Global Headers. Please select/apply dealer headers in Settings first.");
    }
    if (Object.keys(headers).length === 0) {
        throw new Error("No active Global Headers found.");
    }
    const flattened = GLAM_FOLDER_RULES.flatMap((group) => group.names.map((name) => ({
        module: group.module,
        name,
    })));
    const total = flattened.length;
    const results = [];
    for (let index = 0; index < flattened.length; index += 1) {
        const item = flattened[index];
        const current = index + 1;
        const savedDraft = await idbGetGlamMappingDraft(dealerId, item.module, item.name);
        const payload = savedDraft?.payload ??
            buildFolderPayload(item.module, item.name, dealerId);
        onProgress?.(current, total, item.module, item.name, payload);
        try {
            await proxyPost(GLAM_FOLDER_URL, payload, headers);
            results.push({
                module: item.module,
                name: item.name,
                success: true,
                payload,
            });
        }
        catch (error) {
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
function renderSection(activeItemKey) {
    switch (activeItemKey) {
        case "new-vehicles":
            return _jsx(NewVehiclesView, {});
        case "used-vehicles":
            return _jsx(UsedVehiclesView, {});
        case "fi-products":
            return _jsx(FIProductsView, {});
        case "receivables":
            return _jsx(ReceivablesView, {});
        case "payables":
            return _jsx(PayablesView, {});
        case "services":
            return _jsx(ServicesView, {});
        case "parts-accessories":
            return _jsx(PartsAccessoriesView, {});
        case "others":
            return _jsx(OthersView, {});
        case "payment-variable-operations":
            return _jsx(PaymentVariableOperationsView, {});
        case "payment-fixed-operations":
            return _jsx(PaymentFixedOperationsView, {});
        default:
            return _jsx(NewVehiclesView, {});
    }
}
export const GLAM = () => {
    const [activeItemKey, setActiveItemKey] = useState("new-vehicles");
    const [openGroups, setOpenGroups] = useState({
        "variable-operations": true,
        "fixed-operations": true,
        "payment-receipts": true,
    });
    // Strict compact proximity state
    const [isSidebarHovered, setIsSidebarHovered] = useState(false);
    const [isSidebarPinned, setIsSidebarPinned] = useState(false);
    const isExpanded = isSidebarPinned || isSidebarHovered;
    const [isCreatingFolders, setIsCreatingFolders] = useState(false);
    const [foldersProgressText, setFoldersProgressText] = useState("");
    const [foldersMessage, setFoldersMessage] = useState(null);
    const [showFoldersSummary, setShowFoldersSummary] = useState(false);
    const [showPayloadPreview, setShowPayloadPreview] = useState(false);
    const [foldersSummary, setFoldersSummary] = useState(null);
    const [activePayloadPreview, setActivePayloadPreview] = useState(null);
    const globalHeaders = useMemo(() => toEnabledHeaderMap(loadGlobalHeaders()), []);
    const dealerId = useMemo(() => extractDealerIdFromHeaders(globalHeaders), [globalHeaders]);
    const globalHeaderCount = useMemo(() => Object.keys(globalHeaders).length, [globalHeaders]);
    const customizedFolderCount = useMemo(() => {
        return GLAM_FOLDER_RULES.flatMap((group) => group.names.map((name) => ({ module: group.module, name }))).filter((item) => buildCustomPayload(item.module, item.name, dealerId || "0000") !== null).length;
    }, [dealerId]);
    glamLogger.info("render", {
        activeItemKey,
    });
    const handleCreateGlamFolders = async () => {
        setIsCreatingFolders(true);
        setFoldersMessage(null);
        setFoldersSummary(null);
        setActivePayloadPreview(null);
        setFoldersProgressText("Initializing GLAM folder creation...");
        try {
            const result = await createGlamFoldersWithGlobalHeaders((current, total, module, name, payload) => {
                setFoldersProgressText(`Creating ${current}/${total}: ${module} → ${name}`);
                setActivePayloadPreview(payload);
            });
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
            }
            else {
                setFoldersMessage({
                    ok: false,
                    text: `GLAM folder creation completed with partial success. Success: ${result.successCount}/${result.total}, Failed: ${result.failedCount}.`,
                });
            }
            setFoldersProgressText("");
        }
        catch (error) {
            setFoldersMessage({
                ok: false,
                text: error instanceof Error ? error.message : "Failed to create GLAM folders.",
            });
            setFoldersProgressText("");
        }
        finally {
            setIsCreatingFolders(false);
        }
    };
    return (_jsxs("div", { style: { display: "grid", gap: 10, minWidth: 0 }, children: [_jsxs("div", { style: {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                    paddingBottom: 8,
                    borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
                }, children: [_jsxs("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }, children: [_jsxs("span", { style: {
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    padding: "3px 8px",
                                    borderRadius: 6,
                                    border: "1px solid rgba(255, 255, 255, 0.08)",
                                    background: "rgba(15, 23, 42, 0.5)",
                                    color: "#94a3b8",
                                    fontSize: 11,
                                }, children: ["Dealer:", " ", _jsx("strong", { style: { color: dealerId ? "#38bdf8" : "#fca5a5" }, children: dealerId || "Not found" })] }), _jsxs("span", { style: {
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    padding: "3px 8px",
                                    borderRadius: 6,
                                    border: "1px solid rgba(255, 255, 255, 0.08)",
                                    background: "rgba(15, 23, 42, 0.5)",
                                    color: "#94a3b8",
                                    fontSize: 11,
                                }, children: ["Headers: ", _jsx("strong", { style: { color: "#f8fafc" }, children: globalHeaderCount })] }), _jsxs("span", { style: {
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 4,
                                    padding: "3px 8px",
                                    borderRadius: 6,
                                    border: "1px solid rgba(255, 255, 255, 0.08)",
                                    background: "rgba(15, 23, 42, 0.5)",
                                    color: "#94a3b8",
                                    fontSize: 11,
                                }, children: ["Rules: ", _jsx("strong", { style: { color: "#f8fafc" }, children: "23" }), " ", _jsxs("span", { style: { color: "#64748b" }, children: ["(", customizedFolderCount, ")"] })] })] }), _jsxs("div", { style: { display: "flex", gap: 6, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-postman btn-sm", type: "button", onClick: () => void handleCreateGlamFolders(), disabled: isCreatingFolders, style: { fontWeight: 700, padding: "4px 10px", fontSize: 11 }, children: isCreatingFolders ? "Creating Folders..." : "🗂 Create GLAM Folders" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => setShowFoldersSummary((prev) => !prev), disabled: !foldersSummary, style: { padding: "4px 8px", fontSize: 11 }, children: showFoldersSummary ? "Hide Summary" : "Show Summary" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => setShowPayloadPreview((prev) => !prev), disabled: !activePayloadPreview, style: { padding: "4px 8px", fontSize: 11 }, children: showPayloadPreview ? "Hide Preview" : "Preview Payload" })] })] }), foldersProgressText ? (_jsxs("div", { style: {
                    borderRadius: 8,
                    border: "1px solid rgba(56, 189, 248, 0.25)",
                    background: "rgba(56, 189, 248, 0.1)",
                    color: "#38bdf8",
                    padding: "6px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                }, children: ["\u23F3 ", foldersProgressText] })) : null, foldersMessage ? (_jsxs("div", { style: {
                    borderRadius: 8,
                    border: foldersMessage.ok
                        ? "1px solid rgba(34, 197, 94, 0.25)"
                        : "1px solid rgba(239, 68, 68, 0.25)",
                    background: foldersMessage.ok
                        ? "rgba(34, 197, 94, 0.1)"
                        : "rgba(239, 68, 68, 0.1)",
                    color: foldersMessage.ok ? "#4ade80" : "#f87171",
                    padding: "6px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    whiteSpace: "pre-wrap",
                }, children: [foldersMessage.ok ? "✓ " : "⚠ ", " ", foldersMessage.text] })) : null, showPayloadPreview && activePayloadPreview ? (_jsxs("div", { style: {
                    borderRadius: 10,
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    background: "#0b1120",
                    padding: 10,
                }, children: [_jsxs("div", { style: {
                            color: "#94a3b8",
                            fontSize: 11,
                            fontWeight: 800,
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                            marginBottom: 6,
                        }, children: ["Payload: ", activePayloadPreview.module, " > ", activePayloadPreview.name] }), _jsx("pre", { style: {
                            margin: 0,
                            padding: 10,
                            borderRadius: 6,
                            background: "#070c18",
                            color: "#e2e8f0",
                            overflow: "auto",
                            fontSize: 11,
                            whiteSpace: "pre-wrap",
                            maxHeight: 200,
                        }, children: JSON.stringify(activePayloadPreview, null, 2) })] })) : null, showFoldersSummary && foldersSummary ? (_jsxs("div", { style: {
                    borderRadius: 10,
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    background: "#0b1120",
                    padding: 10,
                    display: "grid",
                    gap: 8,
                }, children: [_jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }, children: [_jsxs("span", { style: { fontSize: 11, color: "#94a3b8" }, children: ["Total: ", _jsx("strong", { style: { color: "#f8fafc" }, children: foldersSummary.total })] }), _jsxs("span", { style: { fontSize: 11, color: "#4ade80" }, children: ["Success: ", _jsx("strong", { children: foldersSummary.successCount })] }), _jsxs("span", { style: { fontSize: 11, color: "#f87171" }, children: ["Failed: ", _jsx("strong", { children: foldersSummary.failedCount })] })] }), _jsx("div", { style: {
                            maxHeight: 200,
                            overflow: "auto",
                            borderRadius: 6,
                            border: "1px solid rgba(255, 255, 255, 0.06)",
                        }, children: _jsxs("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: 700, fontSize: 11 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "rgba(255, 255, 255, 0.03)" }, children: [_jsx("th", { style: { textAlign: "left", padding: "6px 8px", color: "#94a3b8" }, children: "#" }), _jsx("th", { style: { textAlign: "left", padding: "6px 8px", color: "#94a3b8" }, children: "Module" }), _jsx("th", { style: { textAlign: "left", padding: "6px 8px", color: "#94a3b8" }, children: "Name" }), _jsx("th", { style: { textAlign: "left", padding: "6px 8px", color: "#94a3b8" }, children: "Status" }), _jsx("th", { style: { textAlign: "left", padding: "6px 8px", color: "#94a3b8" }, children: "Columns" }), _jsx("th", { style: { textAlign: "left", padding: "6px 8px", color: "#94a3b8" }, children: "Rows" }), _jsx("th", { style: { textAlign: "left", padding: "6px 8px", color: "#94a3b8" }, children: "Error" })] }) }), _jsx("tbody", { children: foldersSummary.results.map((item, index) => (_jsxs("tr", { style: {
                                            borderTop: "1px solid rgba(255, 255, 255, 0.04)",
                                            cursor: "pointer",
                                        }, onClick: () => {
                                            setActivePayloadPreview(item.payload);
                                            setShowPayloadPreview(true);
                                        }, children: [_jsx("td", { style: { padding: "6px 8px", color: "#64748b" }, children: index + 1 }), _jsx("td", { style: { padding: "6px 8px", color: "#38bdf8", fontFamily: "monospace" }, children: item.module }), _jsx("td", { style: { padding: "6px 8px", color: "#e2e8f0" }, children: item.name }), _jsx("td", { style: { padding: "6px 8px" }, children: _jsx("span", { style: {
                                                        color: item.success ? "#4ade80" : "#f87171",
                                                        fontWeight: 700,
                                                    }, children: item.success ? "Success" : "Failed" }) }), _jsx("td", { style: { padding: "6px 8px", color: "#94a3b8" }, children: item.payload.mappingColumns.join(", ") || "—" }), _jsx("td", { style: { padding: "6px 8px", color: "#e2e8f0" }, children: item.payload.mappingList.length }), _jsx("td", { style: { padding: "6px 8px", color: "#f87171" }, children: item.error || "—" })] }, `${item.module}-${item.name}-${index}`))) })] }) })] })) : null, _jsxs("div", { style: {
                    display: "grid",
                    gridTemplateColumns: `${isExpanded ? "240px" : "46px"} minmax(0, 1fr)`,
                    gap: 12,
                    alignItems: "start",
                    transition: "grid-template-columns 0.18s cubic-bezier(0.4, 0, 0.2, 1)",
                    position: "relative",
                }, children: [_jsx("div", { onMouseEnter: () => setIsSidebarHovered(true), onMouseLeave: () => setIsSidebarHovered(false), style: {
                            position: "relative",
                            width: "100%",
                            paddingRight: isExpanded ? "0px" : "24px",
                            marginRight: isExpanded ? "0px" : "-24px",
                        }, children: _jsxs("div", { style: {
                                background: "#0f172a",
                                border: "1px solid rgba(255, 255, 255, 0.08)",
                                borderRadius: 10,
                                padding: isExpanded ? "6px 4px" : "4px 3px",
                                display: "flex",
                                flexDirection: "column",
                                gap: 3,
                                overflow: "hidden",
                                boxSizing: "border-box",
                                transition: "all 0.18s cubic-bezier(0.4, 0, 0.2, 1)",
                                boxShadow: isSidebarHovered && !isSidebarPinned
                                    ? "0 8px 20px -4px rgba(0, 0, 0, 0.5), 0 0 10px rgba(56, 189, 248, 0.15)"
                                    : "none",
                            }, children: [_jsxs("div", { style: {
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: isExpanded ? "space-between" : "center",
                                        padding: "2px 4px 4px",
                                        borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
                                        gap: 4,
                                    }, children: [_jsx("span", { style: {
                                                fontSize: 10,
                                                fontWeight: 800,
                                                color: "#64748b",
                                                textTransform: "uppercase",
                                                letterSpacing: "0.5px",
                                                whiteSpace: "nowrap",
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                                maxWidth: isExpanded ? "170px" : "26px",
                                            }, title: "GLAM Sections", children: isExpanded ? "GLAM Sections" : "G.." }), isExpanded && (_jsx("button", { type: "button", onClick: () => setIsSidebarPinned((prev) => !prev), title: isSidebarPinned ? "Unpin sidebar" : "Pin sidebar open", style: {
                                                background: isSidebarPinned
                                                    ? "rgba(56, 189, 248, 0.16)"
                                                    : "rgba(255, 255, 255, 0.04)",
                                                border: isSidebarPinned
                                                    ? "1px solid rgba(56, 189, 248, 0.35)"
                                                    : "1px solid rgba(255, 255, 255, 0.08)",
                                                borderRadius: 4,
                                                color: isSidebarPinned ? "#38bdf8" : "#94a3b8",
                                                fontSize: 9,
                                                cursor: "pointer",
                                                padding: "1px 4px",
                                                lineHeight: 1,
                                            }, children: isSidebarPinned ? "📌" : "⚡" }))] }), GLAM_GROUPS.map((group) => {
                                    const isOpen = openGroups[group.key];
                                    return (_jsxs("div", { style: {
                                            borderRadius: 6,
                                            border: "1px solid rgba(255, 255, 255, 0.05)",
                                            background: "rgba(255, 255, 255, 0.01)",
                                            overflow: "hidden",
                                        }, children: [_jsxs("button", { type: "button", onClick: () => setOpenGroups((prev) => ({
                                                    ...prev,
                                                    [group.key]: !prev[group.key],
                                                })), title: !isExpanded ? group.label : undefined, style: {
                                                    width: "100%",
                                                    border: "none",
                                                    background: "rgba(255, 255, 255, 0.02)",
                                                    color: "#f8fafc",
                                                    padding: isExpanded ? "4px 6px" : "4px 2px",
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: isExpanded ? "space-between" : "center",
                                                    gap: 4,
                                                    cursor: "pointer",
                                                }, children: [_jsxs("span", { style: {
                                                            display: "flex",
                                                            alignItems: "center",
                                                            gap: 4,
                                                            minWidth: 0,
                                                            overflow: "hidden",
                                                        }, children: [_jsx(Arrow, { open: isOpen }), _jsx("span", { style: {
                                                                    fontSize: 11.5,
                                                                    fontWeight: 700,
                                                                    whiteSpace: "nowrap",
                                                                    overflow: "hidden",
                                                                    textOverflow: "ellipsis",
                                                                    maxWidth: isExpanded ? "150px" : "18px",
                                                                }, children: isExpanded ? group.label : group.label.slice(0, 1) })] }), isExpanded && (_jsx("span", { style: {
                                                            color: "#64748b",
                                                            fontSize: 10,
                                                            fontWeight: 700,
                                                        }, children: group.children.length }))] }), isOpen ? (_jsx("div", { style: {
                                                    display: "grid",
                                                    gap: 1,
                                                    padding: isExpanded ? "2px 3px 3px" : "2px 1px",
                                                }, children: group.children.map((item) => {
                                                    const isActive = item.key === activeItemKey;
                                                    return (_jsxs("button", { type: "button", onClick: () => {
                                                            glamLogger.info("section click", {
                                                                group: group.key,
                                                                item: item.key,
                                                            });
                                                            setActiveItemKey(item.key);
                                                        }, title: !isExpanded ? item.label : undefined, style: {
                                                            ...itemButtonBaseStyle,
                                                            padding: isExpanded ? "3px 6px" : "3px 2px",
                                                            borderRadius: 4,
                                                            background: isActive
                                                                ? "rgba(56, 189, 248, 0.12)"
                                                                : "transparent",
                                                            border: isActive
                                                                ? "1px solid rgba(56, 189, 248, 0.3)"
                                                                : "1px solid transparent",
                                                            display: "flex",
                                                            alignItems: "center",
                                                            justifyContent: isExpanded ? "space-between" : "center",
                                                            minWidth: 0,
                                                        }, children: [_jsx("span", { style: {
                                                                    color: isActive ? "#38bdf8" : "#cbd5e1",
                                                                    fontSize: 11,
                                                                    fontWeight: isActive ? 700 : 500,
                                                                    whiteSpace: "nowrap",
                                                                    overflow: "hidden",
                                                                    textOverflow: "ellipsis",
                                                                    maxWidth: isExpanded ? "170px" : "16px",
                                                                }, children: isExpanded ? item.label : item.label.slice(0, 1) }), isActive && isExpanded && (_jsx("span", { style: {
                                                                    width: 4,
                                                                    height: 4,
                                                                    borderRadius: "50%",
                                                                    background: "#38bdf8",
                                                                    boxShadow: "0 0 4px #38bdf8",
                                                                    flexShrink: 0,
                                                                    marginLeft: 2,
                                                                } }))] }, item.key));
                                                }) })) : null] }, group.key));
                                })] }) }), _jsx("div", { style: { ...contentCardStyle, padding: 10 }, children: renderSection(activeItemKey) })] })] }));
};
export default GLAM;
