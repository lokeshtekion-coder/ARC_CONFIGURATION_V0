import React from "react";
import {
  PaymentMappingView,
  type PaymentMappingScreenConfig,
} from "./glamPaymentMappingShared";

const internalRules = [
  ["New Car Policy", "New Car Policy GL Account Number"],
  ["Used Car Policy", "Used Car Policy GL Account Number"],
  ["Service Dept Policy", "Service Dept Policy GL Account Number"],
  ["Parts Dept Policy", "Parts Dept Policy GL Account Number"],
  ["Advertising - New Car", "Advertising - New Car GL Account Number"],
  ["Advertising - Used Car", "Advertising - Used Car GL Account Number"],
  ["Vehicle Expense", "Vehicle Expense GL Account Number"],
  ["We Owe / Due Bill", "We Owe GL Account Number"],
] as const;

const config: PaymentMappingScreenConfig = {
  module: "PAYMENT_METHODS_FIXED_OPS",
  name: "Payment Methods - Service - Internal",
  title: "Payment Methods - Service - Internal",
  description:
    "Maps Service Internal payment methods from Blueprint answers. Vehicle Inventory - INVV is always included as a protected system default mapped directly to INVV.",

  mappingColumns: ["PAY_TYPE", "PAYMENT_METHOD_FIXED_OPS"],

  rules: [
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

const PaymentMethodsServiceInternal: React.FC = () => (
  <PaymentMappingView config={config} />
);

export default PaymentMethodsServiceInternal;
