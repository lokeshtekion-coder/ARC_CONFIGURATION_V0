import { jsx as _jsx } from "react/jsx-runtime";
import { PaymentMappingView, } from "./glamPaymentMappingShared";
/**
 * Mapping pairs for Service - Payment Method - Internal.
 * Format: [Option Name in REPAIR_ORDER_INTERNAL, Blueprint Question Name]
 *
 * NOTE: "New Car Inventory", "New Truck Inventory", "Used Car Inventory",
 * and "Used Truck Inventory" are intentionally omitted here because all
 * inventory operations collapse into the single "Vehicle Inventory - INVV"
 * default rule mapped to asset "INVV".
 */
const internalRules = [
    // Policy Methods
    ["New Car Policy", "New Car Policy GL Account Number"],
    ["Used Car Policy", "Used Car Policy GL Account Number"],
    ["Service Dept Policy", "Service Dept Policy GL Account Number"],
    ["Parts Dept Policy", "Parts Dept Policy GL Account Number"],
    // PDI & Vehicle Operations
    ["PDI", "PDI GL Account Number"],
    ["Company Vehicle Service Dept", "Company Vehicle Service Dept GL Account Number"],
    ["Vehicle Expense", "Vehicle Expense GL Account Number"],
    ["We Owe / Due Bill", "We Owe GL Account Number"],
    // Goodwill Methods
    ["Service - Goodwill", "Service - Goodwill GL Account Number"],
    ["New Car - Goodwill", "New Car - Goodwill GL Account Number"],
    ["Used Car - Goodwill", "Used Car - Goodwill GL Account Number"],
    // Lot Damage Methods
    ["New Car - Lot Damage", "New Car - Lot Damage GL Account Number"],
    ["Used Car - Lot Damage", "Used Car - Lot Damage GL Account Number"],
    ["Service Dept - Lot Damage", "Service Dept - Lot Damage GL Account Number"],
    // Advertising Methods
    ["Advertising - New Car", "Advertising - New Car GL Account Number"],
    ["Advertising - Used Car", "Advertising - Used Car GL Account Number"],
];
const config = {
    module: "PAYMENT_METHODS_FIXED_OPS",
    name: "Payment Methods - Service - Internal",
    title: "Payment Methods - Service - Internal",
    description: "Maps Service Internal payment methods from Blueprint answers. Vehicle Inventory - INVV is always included as a protected system default mapped directly to INVV for all vehicle inventory categories.",
    mappingColumns: ["PAY_TYPE", "PAYMENT_METHOD_FIXED_OPS"],
    rules: [
        // Consolidated inventory rule for all inventory accounts
        {
            key: "vehicle-inventory-invv-default",
            label: "Vehicle Inventory - INVV",
            attributes: {
                PAY_TYPE: "INTERNAL",
                PAYMENT_METHOD_FIXED_OPS: "",
            },
            blueprintSection: "System Default",
            blueprintQuestion: "Vehicle Inventory - INVV",
            // Exactly "INVV"; no dealer ID prefix.
            mappedAssetIdOverride: "INVV",
            alwaysInclude: true,
            paymentMethodField: {
                customFieldKey: "REPAIR_ORDER_INTERNAL",
                optionName: "Vehicle Inventory - INVV",
            },
        },
        // Non-inventory dynamic internal rules
        ...internalRules.map(([methodName, questionName]) => ({
            key: methodName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
            label: methodName,
            attributes: {
                PAY_TYPE: "INTERNAL",
                PAYMENT_METHOD_FIXED_OPS: "",
            },
            blueprintSection: "Service - Payment Method - Internal",
            blueprintQuestion: questionName,
            paymentMethodField: {
                customFieldKey: "REPAIR_ORDER_INTERNAL",
                optionName: methodName,
            },
        })),
    ],
};
const PaymentMethodsServiceInternal = () => (_jsx(PaymentMappingView, { config: config }));
export default PaymentMethodsServiceInternal;
