import React from "react";
import {
  PaymentMappingView,
  type PaymentMappingScreenConfig,
} from "./glamPaymentMappingShared";

const config: PaymentMappingScreenConfig = {
  module: "PAYMENT_METHODS_FIXED_OPS",
  name: "Payment Methods - Service - Customer Pay",
  title: "Payment Methods - Service - Customer Pay",
  description:
    "Maps Service Customer Pay payment methods using decoded Blueprint GL accounts.",
  mappingColumns: ["PAY_TYPE", "PAYMENT_METHOD_FIXED_OPS"],
  rules: [
    {
      key: "service-customer-cash",
      label: "Cash",
      attributes: { PAY_TYPE: "CUSTOMER_PAY", PAYMENT_METHOD_FIXED_OPS: "CASH" },
      blueprintSection: "Service - Payment Methods - Customer Pay",
      blueprintQuestion: "Cash GL Account",
    },
    {
      key: "service-customer-check",
      label: "Check",
      attributes: { PAY_TYPE: "CUSTOMER_PAY", PAYMENT_METHOD_FIXED_OPS: "CHECK" },
      blueprintSection: "Service - Payment Methods - Customer Pay",
      blueprintQuestion: "Check GL Account",
    },
    {
      key: "service-customer-card",
      label: "Credit/Debit Card",
      attributes: { PAY_TYPE: "CUSTOMER_PAY", PAYMENT_METHOD_FIXED_OPS: "CARD" },
      blueprintSection: "Service - Payment Methods - Customer Pay",
      blueprintQuestion: "Credit/Debit Card GL Account",
    },
    {
      key: "service-customer-charge",
      label: "AR Charge",
      attributes: { PAY_TYPE: "CUSTOMER_PAY", PAYMENT_METHOD_FIXED_OPS: "CHARGE" },
      blueprintSection: "Service - Payment Methods - Customer Pay",
      blueprintQuestion: "AR Charge GL Account",
    },
    {
      key: "service-customer-contract",
      label: "Service Contract",
      attributes: {
        PAY_TYPE: "CUSTOMER_PAY",
        PAYMENT_METHOD_FIXED_OPS: "SERVICE_CONTRACTS",
      },
      blueprintSection: "Service - Payment Methods - Customer Pay",
      blueprintQuestion: "Service Contract GL Account",
    },
    {
      key: "service-customer-oem-reward",
      label: "GM OEM Reward",
      attributes: {
        PAY_TYPE: "CUSTOMER_PAY",
        PAYMENT_METHOD_FIXED_OPS: "OEM_REWARD",
      },
      blueprintSection: "Service - Payment Methods - Customer Pay",
      blueprintQuestion: "GM - OEM Reward GL Account",
    },
  ],
};

const PaymentMethodsServiceCustomerPay: React.FC = () => (
  <PaymentMappingView config={config} />
);

export default PaymentMethodsServiceCustomerPay;
