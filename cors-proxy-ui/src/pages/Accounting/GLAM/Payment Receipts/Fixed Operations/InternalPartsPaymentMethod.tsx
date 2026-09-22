import React from "react";
import {
  PaymentMappingView,
  type PaymentMappingScreenConfig,
} from "./glamPaymentMappingShared";

const config: PaymentMappingScreenConfig = {
  module: "PAYMENT_METHODS_FIXED_OPS",
  name: "Internal Parts Payment Method",
  title: "Internal Parts Payment Method",
  description:
    "Maps Internal Parts payment methods from Blueprint account answers. Vehicle Inventory - INVV is always included as a protected system default mapped directly to INVV.",

  mappingColumns: ["SALE_TYPE_FIXED_OPS", "PAYMENT_METHOD_PARTS"],

  rules: [
    {
      key: "parts-vehicle-inventory-invv-default",
      label: "Vehicle Inventory - INVV",
      attributes: {
        SALE_TYPE_FIXED_OPS: "INTERNAL",
        PAYMENT_METHOD_PARTS: "",
      },
      blueprintSection: "System Default",
      blueprintQuestion: "Vehicle Inventory - INVV",

      // Exactly "INVV"; no dealer ID prefix.
      mappedAssetIdOverride: "INVV",
      alwaysInclude: true,

      paymentMethodField: {
        customFieldKey: "PARTS_SALES_ORDER_INTERNAL",
        optionName: "Vehicle Inventory - INVV",
      },
    },
    {
      key: "internal-parts-policy",
      label: "Internal Parts Policy",
      attributes: {
        SALE_TYPE_FIXED_OPS: "INTERNAL",
        PAYMENT_METHOD_PARTS: "INTERNAL_POLICY_PARTS",
      },
      blueprintSection: "Internal Parts Payment Method",
      blueprintQuestion: "Parts Policy GL Account",
    },
    {
      key: "internal-parts-due-bill",
      label: "Internal Parts Due Bill",
      attributes: {
        SALE_TYPE_FIXED_OPS: "INTERNAL",
        PAYMENT_METHOD_PARTS: "INTERNAL_DUE_BILL",
      },
      blueprintSection: "Internal Parts Payment Method",
      blueprintQuestion: "We Owe GL Account",
    },
  ],
};

const InternalPartsPaymentMethod: React.FC = () => (
  <PaymentMappingView config={config} />
);

export default InternalPartsPaymentMethod;
