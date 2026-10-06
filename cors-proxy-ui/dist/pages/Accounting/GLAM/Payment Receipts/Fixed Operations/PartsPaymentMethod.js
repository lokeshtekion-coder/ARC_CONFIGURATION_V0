import { jsx as _jsx } from "react/jsx-runtime";
import { PaymentMappingView, } from "./glamPaymentMappingShared";
const config = {
    module: "PAYMENT_METHODS_FIXED_OPS",
    name: "Parts Payment Method",
    title: "Parts Payment Method",
    description: "",
    mappingColumns: ["SALE_TYPE_FIXED_OPS", "PAYMENT_METHOD_PARTS"],
    rules: [
        {
            key: "retail-cash",
            label: "Retail Cash",
            attributes: { SALE_TYPE_FIXED_OPS: "RETAIL", PAYMENT_METHOD_PARTS: "CASH" },
            blueprintSection: "Parts - Cash Payment Method",
            blueprintQuestion: "Counter Sales/Retail GL Account",
        },
        {
            key: "wholesale-cash",
            label: "Wholesale Cash",
            attributes: { SALE_TYPE_FIXED_OPS: "WHOLESALE", PAYMENT_METHOD_PARTS: "CASH" },
            blueprintSection: "Parts - Cash Payment Method",
            blueprintQuestion: "Wholesale GL Account",
        },
        {
            key: "retail-check",
            label: "Retail Check",
            attributes: { SALE_TYPE_FIXED_OPS: "RETAIL", PAYMENT_METHOD_PARTS: "CHECK" },
            blueprintSection: "Parts - Check Payment Method",
            blueprintQuestion: "Counter Sales/Retail GL Account",
        },
        {
            key: "wholesale-check",
            label: "Wholesale Check",
            attributes: { SALE_TYPE_FIXED_OPS: "WHOLESALE", PAYMENT_METHOD_PARTS: "CHECK" },
            blueprintSection: "Parts - Check Payment Method",
            blueprintQuestion: "Wholesale GL Account",
        },
        {
            key: "retail-card",
            label: "Retail Card",
            attributes: { SALE_TYPE_FIXED_OPS: "RETAIL", PAYMENT_METHOD_PARTS: "CARD" },
            blueprintSection: "Parts - Credit/Debit Card Payment Method",
            blueprintQuestion: "Counter Sales/Retail GL Account",
        },
        {
            key: "wholesale-card",
            label: "Wholesale Card",
            attributes: { SALE_TYPE_FIXED_OPS: "WHOLESALE", PAYMENT_METHOD_PARTS: "CARD" },
            blueprintSection: "Parts - Credit/Debit Card Payment Method",
            blueprintQuestion: "Wholesale GL Account",
        },
        {
            key: "retail-charge",
            label: "Retail AR Charge",
            attributes: { SALE_TYPE_FIXED_OPS: "RETAIL", PAYMENT_METHOD_PARTS: "CHARGE" },
            blueprintSection: "Parts - AR Charge Payment Method",
            blueprintQuestion: "Counter Sales/Retail GL Account",
        },
        {
            key: "wholesale-charge",
            label: "Wholesale AR Charge",
            attributes: { SALE_TYPE_FIXED_OPS: "WHOLESALE", PAYMENT_METHOD_PARTS: "CHARGE" },
            blueprintSection: "Parts - AR Charge Payment Method",
            blueprintQuestion: "Wholesale GL Account",
        },
        {
            key: "retail-oem-reward",
            label: "Retail OEM Reward",
            attributes: { SALE_TYPE_FIXED_OPS: "RETAIL", PAYMENT_METHOD_PARTS: "OEM_REWARD" },
            blueprintSection: "OEM Reward",
            blueprintQuestion: "Counter Sales/Retail GL Account",
        },
        {
            key: "wholesale-oem-reward",
            label: "Wholesale OEM Reward",
            attributes: { SALE_TYPE_FIXED_OPS: "WHOLESALE", PAYMENT_METHOD_PARTS: "OEM_REWARD" },
            blueprintSection: "OEM Reward",
            blueprintQuestion: "Wholesale GL Account",
        },
        {
            key: "internal-oem-reward",
            label: "Internal OEM Reward",
            attributes: { SALE_TYPE_FIXED_OPS: "INTERNAL", PAYMENT_METHOD_PARTS: "OEM_REWARD" },
            blueprintSection: "OEM Reward",
            blueprintQuestion: "Internal GL Account",
        },
        {
            key: "repair-order-oem-reward",
            label: "Repair Order OEM Reward",
            attributes: { SALE_TYPE_FIXED_OPS: "REPAIR_ORDER", PAYMENT_METHOD_PARTS: "OEM_REWARD" },
            blueprintSection: "OEM Reward",
            blueprintQuestion: "Repair GL Account",
        },
    ],
};
const PartsPaymentMethod = () => _jsx(PaymentMappingView, { config: config });
export default PartsPaymentMethod;
