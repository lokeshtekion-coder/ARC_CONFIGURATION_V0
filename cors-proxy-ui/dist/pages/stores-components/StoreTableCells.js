import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
export const SetupDataChip = ({ label, value, hasData, title }) => (_jsxs("span", { title: title, style: {
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        padding: "3px 6px",
        borderRadius: 6,
        background: hasData ? "rgba(56, 189, 248, 0.14)" : "rgba(148, 163, 184, 0.12)",
        color: hasData ? "#38bdf8" : "#94a3b8",
        border: `1px solid ${hasData ? "rgba(56, 189, 248, 0.28)" : "rgba(148, 163, 184, 0.22)"}`,
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: "nowrap",
    }, children: [_jsx("span", { style: { opacity: 0.85 }, children: label }), _jsx("span", { style: { fontSize: 9 }, children: value })] }));
export const SetupDataCell = ({ row }) => {
    if (row.setup_data_error) {
        return (_jsxs("span", { title: row.setup_data_error, style: {
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 7px",
                borderRadius: 6,
                background: "rgba(239, 68, 68, 0.14)",
                color: "#f87171",
                border: "1px solid rgba(239, 68, 68, 0.30)",
                fontSize: 10,
                fontWeight: 700,
                lineHeight: 1,
                whiteSpace: "nowrap",
            }, children: [_jsx("span", { children: "\u26A0" }), _jsx("span", { children: "Error" })] }));
    }
    if (!row.setup_data) {
        return (_jsx("span", { title: "Setup data has not been fetched yet", style: {
                display: "inline-flex",
                alignItems: "center",
                padding: "3px 8px",
                borderRadius: 6,
                background: "rgba(148, 163, 184, 0.10)",
                color: "#64748b",
                border: "1px solid rgba(148, 163, 184, 0.20)",
                fontSize: 10,
                fontWeight: 600,
                lineHeight: 1,
                whiteSpace: "nowrap",
            }, children: "\u2014 Not Fetched" }));
    }
    const oemCodes = row.setup_data.oemDealerCodes || [];
    const hasOem = oemCodes.length > 0;
    const firstCode = oemCodes[0] || "—";
    const oemDisplay = oemCodes.length > 1 ? `${firstCode} (+${oemCodes.length - 1})` : firstCode;
    const oemFull = hasOem ? oemCodes.join(", ") : "None";
    const journalsCount = row.setup_data.journalsAccessibleDealerCount ?? 0;
    const salesChainsCount = row.setup_data.salesChainsAccessibleDealerCount ?? 0;
    const coaCount = row.setup_data.coaAccessibleDealerCount ?? 0;
    return (_jsxs("div", { style: { display: "inline-flex", gap: 4, flexWrap: "nowrap", alignItems: "center" }, children: [_jsx(SetupDataChip, { label: "OEM", value: oemDisplay, hasData: hasOem, title: `OEM Codes: ${oemFull}` }), _jsx(SetupDataChip, { label: "JRN", value: journalsCount, hasData: journalsCount > 0, title: `Accessible Journals: ${journalsCount}` }), _jsx(SetupDataChip, { label: "SC", value: salesChainsCount, hasData: salesChainsCount > 0, title: `Sales Chains: ${salesChainsCount}` }), _jsx(SetupDataChip, { label: "COA", value: coaCount, hasData: coaCount > 0, title: `Chart of Accounts: ${coaCount}` })] }));
};
export const CustomStatusSelect = ({ value, onChange }) => {
    const currentVal = value || "TO DO";
    const colors = {
        "TO DO": { bg: "rgba(148, 163, 184, 0.14)", text: "#94a3b8", border: "rgba(148, 163, 184, 0.24)" },
        WIP: { bg: "rgba(245, 158, 11, 0.16)", text: "#f59e0b", border: "rgba(245, 158, 11, 0.30)" },
        Completed: { bg: "rgba(34, 197, 94, 0.16)", text: "#22c55e", border: "rgba(34, 197, 94, 0.30)" },
    };
    const style = colors[currentVal];
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
