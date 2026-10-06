import { jsx as _jsx } from "react/jsx-runtime";
import ValidationShell from "../Review/ValidationShell";
const MODULES = [
    {
        key: "bootstrap",
        label: "⚙️ Configurable Bootstrap",
        assets: ["serviceSettings", "opcodes", "laborPricing", "serviceAdvisors", "scheduling", "coupons", "checkInFields"],
        data: {
            serviceSettings: { dealerId: "8136", defaultLaborRate: 165, taxOnLabor: true },
            opcodes: [{ opcode: "LOF", description: "Lube Oil Filter", laborType: "CP" }, { opcode: "TIRE", description: "Tire rotation", laborType: "CP" }],
            laborPricing: [{ level: "Standard", rate: 165 }, { level: "Warranty", rate: 150 }],
            serviceAdvisors: [{ id: "SA-1", name: "Sample Advisor", active: true }],
            scheduling: { slotMinutes: 30, consumerSchedulingEnabled: true },
            coupons: [],
            checkInFields: [{ field: "Mileage In", mandatory: true }],
        },
    },
    {
        key: "rules",
        label: "📋 Service Mapping Rules",
        assets: ["glMapping", "paymentMethods"],
        data: {
            glMapping: [{ ruleId: "S-100", assetType: "LABOR_SALES", glAccount: "4200", status: "Mapped" }],
            paymentMethods: [{ method: "Customer Pay", glAccount: "1200" }, { method: "Warranty", glAccount: "1220" }],
        },
    },
];
export default function ValidationService() {
    return (_jsx(ValidationShell, { title: "Validation Service Dashboard", subtitle: "Dummy data | replace with Service bootstrap & rule endpoints", modules: MODULES }));
}
