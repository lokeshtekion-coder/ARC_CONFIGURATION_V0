import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const sectionCardStyle = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.025)",
};
export const leftPanelStyle = {
    ...sectionCardStyle,
    padding: 14,
    display: "grid",
    gap: 10,
    minHeight: 620,
    alignContent: "start",
};
export const itemButtonBaseStyle = {
    width: "100%",
    textAlign: "left",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    color: "#e2e8f0",
    padding: "10px 12px",
    cursor: "pointer",
};
export const contentCardStyle = {
    ...sectionCardStyle,
    padding: 18,
    minHeight: 620,
    minWidth: 0,
};
export const Arrow = ({ open }) => (_jsx("span", { style: {
        display: "inline-block",
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 0.18s ease",
        color: "#cbd5e1",
        fontSize: 12,
    }, children: "\u25B6" }));
export const MetricCard = ({ label, value, }) => (_jsxs("div", { style: {
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.02)",
        padding: 14,
        minWidth: 0,
    }, children: [_jsx("div", { style: {
                color: "#94a3b8",
                fontSize: 12,
                marginBottom: 6,
            }, children: label }), _jsx("div", { style: {
                color: "#f8fafc",
                fontSize: 15,
                fontWeight: 800,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
            }, children: value })] }));
/**
 * Clean Header component without placeholder metrics or dashed content box
 */
export const GlamSectionHeader = ({ title, description, breadcrumb }) => {
    return (_jsxs("div", { style: { display: "grid", gap: 4, minWidth: 0, marginBottom: 8 }, children: [_jsx("div", { style: {
                    color: "#60a5fa",
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: 0.4,
                    textTransform: "uppercase",
                }, children: breadcrumb }), _jsx("div", { style: {
                    color: "#f8fafc",
                    fontSize: 24,
                    fontWeight: 800,
                }, children: title }), _jsx("div", { style: {
                    color: "#94a3b8",
                    fontSize: 14,
                    lineHeight: 1.7,
                    maxWidth: 900,
                }, children: description })] }));
};
export const GlamSectionPlaceholder = ({ title, description, breadcrumb }) => {
    return (_jsxs("div", { style: { display: "grid", gap: 16, minWidth: 0 }, children: [_jsx(GlamSectionHeader, { title: title, description: description, breadcrumb: breadcrumb }), _jsxs("div", { style: {
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 12,
                }, children: [_jsx(MetricCard, { label: "Section", value: title }), _jsx(MetricCard, { label: "Area", value: breadcrumb.split(" / ")[1] || "GLAM" }), _jsx(MetricCard, { label: "Status", value: "UI Ready" })] }), _jsx("div", { style: {
                    minHeight: 420,
                    borderRadius: 16,
                    border: "1px dashed rgba(148,163,184,0.30)",
                    background: "rgba(255,255,255,0.015)",
                    display: "grid",
                    placeItems: "center",
                    textAlign: "center",
                    padding: 24,
                    color: "#94a3b8",
                }, children: _jsxs("div", { style: { display: "grid", gap: 8 }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 18, fontWeight: 700 }, children: title }), _jsx("div", { style: { fontSize: 14 }, children: "This is the content area for the selected GLAM section." }), _jsx("div", { style: { fontSize: 13 }, children: "Next step: wire the actual GLAM data and mapping UI here." })] }) })] }));
};
