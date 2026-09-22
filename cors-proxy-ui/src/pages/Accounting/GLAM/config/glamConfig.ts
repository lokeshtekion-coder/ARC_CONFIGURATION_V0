export type GlamGroupKey =
  | "variable-operations"
  | "fixed-operations"
  | "payment-receipts";

export type GlamItemKey =
  | "new-vehicles"
  | "used-vehicles"
  | "fi-products"
  | "receivables"
  | "payables"
  | "services"
  | "parts-accessories"
  | "others"
  | "payment-variable-operations"
  | "payment-fixed-operations";

export interface GlamNavItem {
  key: GlamItemKey;
  label: string;
  description: string;
}

export interface GlamNavGroup {
  key: GlamGroupKey;
  label: string;
  children: GlamNavItem[];
}

export const GLAM_GROUPS: GlamNavGroup[] = [
  {
    key: "variable-operations",
    label: "Variable Operations",
    children: [
      {
        key: "new-vehicles",
        label: "New Vehicles",
        description: "GLAM content for new vehicle accounting flows",
      },
      {
        key: "used-vehicles",
        label: "Used Vehicles",
        description: "GLAM content for used vehicle accounting flows",
      },
      {
        key: "fi-products",
        label: "F&I Products",
        description: "GLAM content for finance and insurance products",
      },
      {
        key: "receivables",
        label: "Receivables",
        description: "GLAM content for receivable mappings",
      },
      {
        key: "payables",
        label: "Payables",
        description: "GLAM content for payable mappings",
      },
    ],
  },
  {
    key: "fixed-operations",
    label: "Fixed Operations",
    children: [
      {
        key: "services",
        label: "Services",
        description: "GLAM content for services",
      },
      {
        key: "parts-accessories",
        label: "Part & Accessories",
        description: "GLAM content for parts and accessories",
      },
      {
        key: "others",
        label: "Others",
        description: "GLAM content for other fixed operations",
      },
    ],
  },
  {
    key: "payment-receipts",
    label: "Payment Receipts",
    children: [
      {
        key: "payment-variable-operations",
        label: "Variable Operations",
        description: "GLAM content for payment receipts under variable operations",
      },
      {
        key: "payment-fixed-operations",
        label: "Fixed Operations",
        description: "GLAM content for payment receipts under fixeds operations",
      },
    ],
  },
];

export const glamLogger = {
  info: (...args: unknown[]) => console.info("[Accounting][GLAM]", ...args),
};
