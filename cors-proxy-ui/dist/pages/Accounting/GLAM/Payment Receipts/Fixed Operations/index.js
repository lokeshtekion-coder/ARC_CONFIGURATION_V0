import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import PartsPaymentMethod from "./PartsPaymentMethod";
import InternalPartsPaymentMethod from "./InternalPartsPaymentMethod";
import PaymentMethodsServiceCustomerPay from "./PaymentMethods_Service_CustomerPay";
import PaymentMethodsServiceWarranty from "./Payment_Methods_Service_Warranty";
import PaymentMethodsServiceInternal from "./Payment Method_Service_Internal";
const screens = [
    { key: "parts", label: "Parts Payment Method" },
    { key: "internal-parts", label: "Internal Parts Payment Method" },
    { key: "service-customer", label: "Service - Customer Pay" },
    { key: "service-warranty", label: "Service - Warranty" },
    { key: "service-internal", label: "Service - Internal" },
];
const PaymentVariableOperationsView = () => {
    const [activeScreen, setActiveScreen] = useState("parts");
    const renderActiveScreen = () => {
        switch (activeScreen) {
            case "parts":
                return _jsx(PartsPaymentMethod, {});
            case "internal-parts":
                return _jsx(InternalPartsPaymentMethod, {});
            case "service-customer":
                return _jsx(PaymentMethodsServiceCustomerPay, {});
            case "service-warranty":
                return _jsx(PaymentMethodsServiceWarranty, {});
            case "service-internal":
                return _jsx(PaymentMethodsServiceInternal, {});
            default:
                return _jsx(PartsPaymentMethod, {});
        }
    };
    return (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsxs("div", { style: { display: "grid", gap: 6 }, children: [_jsx("div", { style: { color: "#60a5fa", fontSize: 12, fontWeight: 700 }, children: "ACCOUNTING / PAYMENT RECEIPTS / Fixed OPERATIONS" }), _jsx("div", { style: { color: "#f8fafc", fontSize: 24, fontWeight: 800 }, children: "Fixed Operations Mapping" }), _jsx("div", { style: { color: "#94a3b8", fontSize: 13 } })] }), _jsx("div", { style: {
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                    paddingBottom: 12,
                }, children: screens.map((screen) => {
                    const active = activeScreen === screen.key;
                    return (_jsx("button", { type: "button", onClick: () => setActiveScreen(screen.key), style: {
                            borderRadius: 8,
                            border: active
                                ? "1px solid rgba(59,130,246,0.45)"
                                : "1px solid rgba(255,255,255,0.10)",
                            background: active
                                ? "rgba(59,130,246,0.16)"
                                : "rgba(255,255,255,0.025)",
                            color: active ? "#dbeafe" : "#cbd5e1",
                            padding: "8px 11px",
                            cursor: "pointer",
                            fontSize: 12,
                            fontWeight: 700,
                        }, children: screen.label }, screen.key));
                }) }), renderActiveScreen()] }));
};
export default PaymentVariableOperationsView;
