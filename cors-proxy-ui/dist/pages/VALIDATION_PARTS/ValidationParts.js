import { jsx as _jsx } from "react/jsx-runtime";
import ValidationShell from "../Review/ValidationShell";
const MODULES = [
    {
        key: "bootstrap",
        label: "⚙️ Configurable Bootstrap",
        assets: ["partsSettings", "priceCodes", "priceBreakFormulas", "adjustmentReasons", "returnReasons", "fees", "coupons"],
        data: {
            partsSettings: { dealerId: "8136", defaultMarkup: 1.35, allowNegativeOnHand: false },
            priceCodes: [{ code: "R", description: "Retail", status: "Active" }, { code: "W", description: "Wholesale", status: "Active" }],
            priceBreakFormulas: [{ id: "PB-1", from: 0, to: 50, markupPct: 40 }, { id: "PB-2", from: 50.01, to: 500, markupPct: 30 }],
            adjustmentReasons: [{ code: "CYC", reason: "Cycle count" }, { code: "DMG", reason: "Damaged" }],
            returnReasons: [{ code: "WRG", reason: "Wrong part ordered" }],
            fees: [{ name: "Shop supplies", type: "percent", value: 5 }],
            coupons: [],
        },
    },
    {
        key: "rules",
        label: "📋 Parts Mapping Rules",
        assets: ["glMapping", "paymentMethods"],
        data: {
            glMapping: [{ ruleId: "P-100", assetType: "PARTS_SALES", glAccount: "4100", status: "Mapped" }],
            paymentMethods: [{ method: "Customer Pay", glAccount: "1200" }, { method: "Internal", glAccount: "1210" }],
        },
    },
];
export default function ValidationParts() {
    return (_jsx(ValidationShell, { title: "Validation Parts Dashboard", subtitle: "Dummy data | replace with Parts bootstrap & rule endpoints", modules: MODULES }));
}
