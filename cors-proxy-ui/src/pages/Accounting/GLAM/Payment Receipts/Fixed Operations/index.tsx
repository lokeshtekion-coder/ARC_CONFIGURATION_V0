import React, { useState } from "react";
import PartsPaymentMethod from "./PartsPaymentMethod";
import InternalPartsPaymentMethod from "./InternalPartsPaymentMethod";
import PaymentMethodsServiceCustomerPay from "./PaymentMethods_Service_CustomerPay";
import PaymentMethodsServiceWarranty from "./Payment_Methods_Service_Warranty";
import PaymentMethodsServiceInternal from "./Payment Method_Service_Internal";

type ScreenKey =
  | "parts"
  | "internal-parts"
  | "service-customer"
  | "service-warranty"
  | "service-internal";

const screens: Array<{ key: ScreenKey; label: string }> = [
  { key: "parts", label: "Parts Payment Method" },
  { key: "internal-parts", label: "Internal Parts Payment Method" },
  { key: "service-customer", label: "Service - Customer Pay" },
  { key: "service-warranty", label: "Service - Warranty" },
  { key: "service-internal", label: "Service - Internal" },
];

const PaymentVariableOperationsView: React.FC = () => {
  const [activeScreen, setActiveScreen] = useState<ScreenKey>("parts");

  const renderActiveScreen = () => {
    switch (activeScreen) {
      case "parts":
        return <PartsPaymentMethod />;
      case "internal-parts":
        return <InternalPartsPaymentMethod />;
      case "service-customer":
        return <PaymentMethodsServiceCustomerPay />;
      case "service-warranty":
        return <PaymentMethodsServiceWarranty />;
      case "service-internal":
        return <PaymentMethodsServiceInternal />;
      default:
        return <PartsPaymentMethod />;
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ color: "#60a5fa", fontSize: 12, fontWeight: 700 }}>
          ACCOUNTING / PAYMENT RECEIPTS / Fixed OPERATIONS
        </div>
        <div style={{ color: "#f8fafc", fontSize: 24, fontWeight: 800 }}>
          Fixed Operations Mapping
        </div>
        <div style={{ color: "#94a3b8", fontSize: 13 }}>

        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          paddingBottom: 12,
        }}
      >
        {screens.map((screen) => {
          const active = activeScreen === screen.key;

          return (
            <button
              key={screen.key}
              type="button"
              onClick={() => setActiveScreen(screen.key)}
              style={{
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
              }}
            >
              {screen.label}
            </button>
          );
        })}
      </div>

      {renderActiveScreen()}
    </div>
  );
};

export default PaymentVariableOperationsView;
