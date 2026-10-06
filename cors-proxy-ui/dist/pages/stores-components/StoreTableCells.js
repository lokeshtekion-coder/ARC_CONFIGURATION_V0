import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { sanitizeSetupError } from "../../services/storeSetupDataService";
function getStatusVisual(status) {
    if (status === "COMPLETED") {
        return { symbol: "✓", background: "rgba(34, 197, 94, 0.16)", color: "#22c55e", border: "rgba(34, 197, 94, 0.30)", label: "Completed" };
    }
    if (status === "IN_PROGRESS") {
        return { symbol: "⏳", background: "rgba(245, 158, 11, 0.16)", color: "#f59e0b", border: "rgba(245, 158, 11, 0.30)", label: "In Progress" };
    }
    return { symbol: "○", background: "rgba(148, 163, 184, 0.14)", color: "#94a3b8", border: "rgba(148, 163, 184, 0.24)", label: status === "NOT_YET_STARTED" ? "Not Yet Started" : "Unknown" };
}
export const StatusChip = ({ short, fullName, status }) => {
    const visual = getStatusVisual(status);
    return (_jsxs("span", { title: `${fullName}: ${visual.label}`, style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 3,
            padding: "3px 6px",
            borderRadius: 6,
            background: visual.background,
            color: visual.color,
            border: `1px solid ${visual.border}`,
            fontSize: 10,
            fontWeight: 700,
            lineHeight: 1,
            whiteSpace: "nowrap",
        }, children: [_jsx("span", { children: short }), _jsx("span", { style: { fontSize: 9 }, children: visual.symbol })] }));
};
export const StatusChipGroup = ({ items }) => (_jsx("div", { style: { display: "inline-flex", gap: 4, flexWrap: "nowrap", alignItems: "center" }, children: items.map((item) => (_jsx(StatusChip, { short: item.short, fullName: item.fullName, status: item.status }, item.fullName))) }));
export const UnifiedMetricChip = ({ label, value, variant = "primary", title }) => {
    const styles = {
        primary: { bg: "rgba(56, 189, 248, 0.12)", text: "#38bdf8", border: "rgba(56, 189, 248, 0.28)" },
        secondary: { bg: "rgba(192, 132, 252, 0.12)", text: "#c084fc", border: "rgba(192, 132, 252, 0.28)" },
        success: { bg: "rgba(74, 222, 128, 0.12)", text: "#4ade80", border: "rgba(74, 222, 128, 0.28)" },
        warn: { bg: "rgba(248, 113, 113, 0.12)", text: "#f87171", border: "rgba(248, 113, 113, 0.28)" },
    }[variant];
    return (_jsxs("span", { title: title, style: {
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 6px",
            borderRadius: 4,
            background: styles.bg,
            color: styles.text,
            border: `1px solid ${styles.border}`,
            fontSize: 10,
            fontWeight: 700,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
        }, children: [_jsx("span", { style: { opacity: 0.8, fontSize: 9 }, children: label }), _jsx("span", { children: value })] }));
};
export const SetupDataCell = ({ row }) => {
    const mapData = row.preprod_validation;
    const rawError = row.setup_data_error;
    // 1. If Setup Data has an error
    if (rawError) {
        const cleanError = sanitizeSetupError(rawError);
        return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 5, minWidth: 170 }, children: [_jsxs("span", { title: rawError, style: {
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "rgba(239, 68, 68, 0.14)",
                        color: "#f87171",
                        border: "1px solid rgba(239, 68, 68, 0.30)",
                        fontSize: 10,
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                        width: "fit-content",
                        cursor: "help",
                    }, children: [_jsx("span", { children: "\u26A0" }), _jsx("span", { children: cleanError })] }), mapData && (_jsxs("div", { style: { display: "inline-flex", gap: 4, flexWrap: "wrap", alignItems: "center" }, children: [_jsx(UnifiedMetricChip, { label: "MAP", value: mapData.isValidTenant ? "✓ Active" : "Invalid", variant: mapData.isValidTenant ? "success" : "warn", title: `Tenant: ${mapData.tenantName || "—"}` }), mapData.employeeCount && mapData.employeeCount !== "—" && (_jsx(UnifiedMetricChip, { label: "EMP", value: Number(mapData.employeeCount).toLocaleString(), variant: "primary", title: `Employees: ${mapData.employeeCount}` })), mapData.accountNumberCount !== undefined && (_jsx(UnifiedMetricChip, { label: "ACCTS", value: mapData.accountNumberCount.toLocaleString(), variant: "secondary", title: `acct_dms_account_number records: ${mapData.accountNumberCount}` }))] }))] }));
    }
    // 2. Setup Data not yet fetched
    if (!row.setup_data) {
        return (_jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4, minWidth: 140 }, children: [_jsx("span", { style: {
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "2px 6px",
                        borderRadius: 4,
                        background: "rgba(148, 163, 184, 0.10)",
                        color: "#64748b",
                        border: "1px solid rgba(148, 163, 184, 0.20)",
                        fontSize: 10,
                        fontWeight: 600,
                        width: "fit-content",
                    }, children: "\u2014 Not Fetched" }), mapData && (_jsxs("div", { style: { display: "inline-flex", gap: 4, flexWrap: "wrap", alignItems: "center" }, children: [_jsx(UnifiedMetricChip, { label: "MAP", value: mapData.isValidTenant ? "✓ Active" : "Invalid", variant: mapData.isValidTenant ? "success" : "warn" }), mapData.accountNumberCount !== undefined && (_jsx(UnifiedMetricChip, { label: "ACCTS", value: mapData.accountNumberCount.toLocaleString(), variant: "secondary" }))] }))] }));
    }
    // 3. Normal successful setup data
    const oemCodes = row.setup_data.oemDealerCodes || [];
    const hasOem = oemCodes.length > 0;
    const firstCode = oemCodes[0] || "—";
    const oemDisplay = oemCodes.length > 1 ? `${firstCode} (+${oemCodes.length - 1})` : firstCode;
    const oemFull = hasOem ? oemCodes.join(", ") : "None";
    const journalsCount = row.setup_data.journalsAccessibleDealerCount ?? 0;
    const salesChainsCount = row.setup_data.salesChainsAccessibleDealerCount ?? 0;
    const coaCount = row.setup_data.coaAccessibleDealerCount ?? 0;
    return (_jsxs("div", { style: { display: "inline-flex", gap: 4, flexWrap: "nowrap", alignItems: "center" }, children: [_jsx(UnifiedMetricChip, { label: "OEM", value: oemDisplay, variant: hasOem ? "primary" : "secondary", title: `OEM: ${oemFull}` }), _jsx(UnifiedMetricChip, { label: "JRN", value: journalsCount, variant: journalsCount > 0 ? "primary" : "secondary", title: `Journals: ${journalsCount}` }), _jsx(UnifiedMetricChip, { label: "SC", value: salesChainsCount, variant: salesChainsCount > 0 ? "primary" : "secondary", title: `Sales Chains: ${salesChainsCount}` }), _jsx(UnifiedMetricChip, { label: "COA", value: coaCount, variant: coaCount > 0 ? "primary" : "secondary", title: `COA: ${coaCount}` })] }));
};
export const CustomStatusSelect = ({ value, onChange }) => {
    const currentVal = value || "TO DO";
    const colors = {
        "TO DO": { bg: "rgba(148, 163, 184, 0.14)", text: "#94a3b8", border: "rgba(148, 163, 184, 0.24)" },
        WIP: { bg: "rgba(245, 158, 11, 0.16)", text: "#f59e0b", border: "rgba(245, 158, 11, 0.30)" },
        Completed: { bg: "rgba(34, 197, 94, 0.16)", text: "#22c55e", border: "rgba(34, 197, 94, 0.30)" },
    };
    const style = colors[currentVal] || colors["TO DO"];
    return (_jsxs("div", { style: { position: "relative", display: "inline-block", width: 110, minWidth: 110 }, children: [_jsxs("select", { value: currentVal, onChange: (e) => onChange(e.target.value), style: {
                    width: "100%",
                    minWidth: 110,
                    background: style.bg,
                    color: style.text,
                    border: `1px solid ${style.border}`,
                    borderRadius: 8,
                    padding: "5px 22px 5px 8px",
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: "pointer",
                    appearance: "none",
                }, children: [_jsx("option", { value: "TO DO", children: "TO DO" }), _jsx("option", { value: "WIP", children: "WIP" }), _jsx("option", { value: "Completed", children: "Completed" })] }), _jsx("span", { style: {
                    position: "absolute",
                    right: 8,
                    top: "50%",
                    transform: "translateY(-50%)",
                    pointerEvents: "none",
                    fontSize: 8,
                    color: style.text,
                }, children: "\u25BC" })] }));
};
