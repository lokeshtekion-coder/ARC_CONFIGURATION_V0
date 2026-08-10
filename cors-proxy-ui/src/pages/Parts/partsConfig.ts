export type PartsSectionKey =
  | "void-parts-reasons"
  | "code-setup"
  | "return-reasons"
  | "core-management-setup"
  | "adjustment-reasons"
  | "coupons"
  | "fees"
  | "price-code"
  | "price-break-formulas"
  | "customised-price-setup"
  | "default-pricing"
  | "warehouse-management"
  | "manufacturer"
  | "dealer-config"
  | "parts-settings"
  | "user-reset"
  | "raise-oem-id-request";

export interface PartsNavItem {
  key: PartsSectionKey;
  label: string;
  description: string;
}

export const PARTS_NAV_ITEMS: PartsNavItem[] = [
  {
    key: "void-parts-reasons",
    label: "Void parts reasons",
    description: "Manage reasons used for voiding parts transactions",
  },
  {
    key: "code-setup",
    label: "Code setup",
    description: "Placeholder for code setup actions",
  },
  {
    key: "return-reasons",
    label: "Return reasons",
    description: "Placeholder for return reason actions",
  },
  {
    key: "core-management-setup",
    label: "Core Management Setup",
    description: "Placeholder for core management setup actions",
  },
  {
    key: "adjustment-reasons",
    label: "Adjustment reasons",
    description: "Placeholder for adjustment reason actions",
  },
  {
    key: "coupons",
    label: "Coupons",
    description: "Placeholder for coupon-related actions",
  },
  {
    key: "fees",
    label: "Fees",
    description: "Placeholder for fee-related actions",
  },
  {
    key: "price-code",
    label: "Price code",
    description: "Placeholder for price code actions",
  },
  {
    key: "price-break-formulas",
    label: "Price break Formulas",
    description: "Placeholder for price break formula actions",
  },
  {
    key: "customised-price-setup",
    label: "Customised price setup",
    description: "Placeholder for customised price setup actions",
  },
  {
    key: "default-pricing",
    label: "Default pricing",
    description: "Placeholder for default pricing actions",
  },
  {
    key: "warehouse-management",
    label: "Warehouse management",
    description: "Placeholder for warehouse management actions",
  },
  {
    key: "manufacturer",
    label: "Manufacturer",
    description: "Placeholder for manufacturer actions",
  },
  {
    key: "dealer-config",
    label: "Dealer config",
    description: "Placeholder for dealer config actions",
  },
  {
    key: "parts-settings",
    label: "Parts settings",
    description: "Placeholder for parts settings actions",
  },
  {
    key: "user-reset",
    label: "User reset",
    description: "Placeholder for user reset actions",
  },
  {
    key: "raise-oem-id-request",
    label: "Raise OEM ID Request",
    description: "Placeholder for OEM ID request actions",
  },
];
