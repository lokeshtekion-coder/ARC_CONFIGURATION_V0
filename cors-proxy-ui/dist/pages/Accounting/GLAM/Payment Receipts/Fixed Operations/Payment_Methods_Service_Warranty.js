import { jsx as _jsx } from "react/jsx-runtime";
import { PaymentMappingView, } from "./glamPaymentMappingShared";
const config = {
    module: "PAYMENT_METHODS_FIXED_OPS",
    name: "Payment Methods - Service - Warranty",
    title: "Payment Methods - Service - Warranty",
    description: "Uses Warranty Claim GL Account from Blueprint and the generated Warranty Receivable ID from REPAIR_ORDER_WARRANTY.",
    mappingColumns: ["PAY_TYPE", "PAYMENT_METHOD_FIXED_OPS"],
    rules: [
        {
            key: "service-warranty-receivable",
            label: "Warranty Receivable",
            attributes: {
                PAY_TYPE: "WARRANTY",
                PAYMENT_METHOD_FIXED_OPS: "",
            },
            blueprintSection: "Service - Payment Methods - Warranty",
            blueprintQuestion: "Warranty Claim GL Account",
            paymentMethodField: {
                customFieldKey: "REPAIR_ORDER_WARRANTY",
                optionName: "Warranty Receivable",
            },
        },
    ],
};
const PaymentMethodsServiceWarranty = () => (_jsx(PaymentMappingView, { config: config }));
export default PaymentMethodsServiceWarranty;
