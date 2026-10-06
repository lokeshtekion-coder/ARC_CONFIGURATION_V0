import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
/** Shared layout used by the Parts / Service validation views (same look as ValidationAccounting). */
export default function ValidationShell({ title, subtitle, modules, onRefresh, loading, error }) {
    const [moduleKey, setModuleKey] = useState(modules[0]?.key ?? "");
    const [viewMode, setViewMode] = useState("parsed");
    const active = modules.find((m) => m.key === moduleKey) ?? modules[0];
    const [asset, setAsset] = useState(active?.assets[0] ?? "");
    const assetName = active?.assets.includes(asset) ? asset : active?.assets[0] ?? "";
    const switchModule = (key) => {
        setModuleKey(key);
        setAsset(modules.find((m) => m.key === key)?.assets[0] ?? "");
    };
    return (_jsxs("div", { style: styles.container, children: [_jsxs("header", { style: styles.header, children: [_jsxs("div", { children: [_jsx("h2", { style: { margin: 0, fontSize: 20, color: "#333" }, children: title }), _jsx("span", { style: { fontSize: 13, color: "#6c757d" }, children: subtitle })] }), _jsx("div", { style: styles.moduleTabGroup, children: modules.map((m) => (_jsx("button", { style: { ...styles.moduleTabButton, ...(m.key === active?.key ? styles.activeModuleTab : {}) }, onClick: () => switchModule(m.key), children: m.label }, m.key))) })] }), _jsxs("div", { style: styles.subHeaderBar, children: [_jsxs("div", { style: styles.tabGroup, children: [_jsx("button", { style: { ...styles.tabButton, ...(viewMode === "parsed" ? styles.activeTab : {}) }, onClick: () => setViewMode("parsed"), children: "\uD83D\uDCCA Parsed UI View" }), _jsx("button", { style: { ...styles.tabButton, ...(viewMode === "json" ? styles.activeTab : {}) }, onClick: () => setViewMode("json"), children: "\uD83D\uDCBB Raw JSON View" })] }), onRefresh && (_jsx("button", { onClick: onRefresh, style: styles.refreshButton, children: "\uD83D\uDD04 Refresh" }))] }), loading ? (_jsx("div", { style: styles.center, children: "Loading\u2026" })) : error ? (_jsxs("div", { style: { ...styles.center, color: "#d9534f" }, children: ["\u26A0\uFE0F ", error] })) : viewMode === "json" ? (_jsx("div", { style: styles.jsonCard, children: _jsx("pre", { style: styles.pre, children: JSON.stringify(active?.data ?? {}, null, 2) }) })) : (_jsxs("div", { style: styles.layout, children: [_jsxs("aside", { style: styles.sidebar, children: [_jsx("h4", { style: styles.sidebarTitle, children: "Asset Types" }), _jsx("ul", { style: styles.sidebarList, children: active?.assets.map((a) => (_jsx("li", { style: { ...styles.sidebarItem, ...(a === assetName ? styles.sidebarItemActive : {}) }, onClick: () => setAsset(a), children: a.replace(/([A-Z])/g, " $1").toUpperCase() }, a))) })] }), _jsxs("section", { style: styles.contentPanel, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 16 }, children: [_jsx("h3", { style: { margin: 0, textTransform: "uppercase", fontSize: 16, color: "#007bff" }, children: assetName }), _jsx("span", { style: styles.badge, children: "Dummy data" })] }), _jsx("div", { style: styles.jsonCard, children: _jsx("pre", { style: styles.pre, children: assetName && active?.data[assetName] !== undefined
                                        ? JSON.stringify(active.data[assetName], null, 2)
                                        : "No data found." }) })] })] }))] }));
}
const styles = {
    container: { padding: 24, fontFamily: '-apple-system, "Segoe UI", Roboto, sans-serif', background: "#f8f9fa", minHeight: "100%", boxSizing: "border-box" },
    header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, background: "#fff", padding: "16px 24px", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", flexWrap: "wrap", gap: 12 },
    moduleTabGroup: { display: "flex", gap: 8, background: "#e9ecef", padding: 4, borderRadius: 6 },
    moduleTabButton: { padding: "8px 14px", background: "transparent", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 600, fontSize: 13, color: "#495057" },
    activeModuleTab: { background: "#fff", color: "#007bff", boxShadow: "0 1px 2px rgba(0,0,0,0.1)" },
    subHeaderBar: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
    tabGroup: { display: "flex", border: "1px solid #ced4da", borderRadius: 6, overflow: "hidden" },
    tabButton: { padding: "8px 16px", background: "#fff", border: "none", cursor: "pointer", fontWeight: 500, fontSize: 13, color: "#495057" },
    activeTab: { background: "#007bff", color: "#fff" },
    refreshButton: { padding: "8px 16px", background: "#28a745", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 500, fontSize: 13 },
    layout: { display: "grid", gridTemplateColumns: "260px 1fr", gap: 24 },
    sidebar: { background: "#fff", borderRadius: 8, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", height: "fit-content" },
    sidebarTitle: { margin: "0 0 12px 0", fontSize: 12, color: "#6c757d", textTransform: "uppercase", letterSpacing: 0.5 },
    sidebarList: { listStyle: "none", padding: 0, margin: 0 },
    sidebarItem: { padding: "10px 12px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 500, color: "#495057", marginBottom: 4 },
    sidebarItemActive: { background: "#007bff", color: "#fff" },
    contentPanel: { background: "#fff", borderRadius: 8, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.1)" },
    jsonCard: { background: "#1e1e1e", borderRadius: 6, overflow: "hidden" },
    pre: { color: "#dcdcdc", padding: 16, margin: 0, fontFamily: "SFMono-Regular, Consolas, Menlo, monospace", fontSize: 13, maxHeight: 650, overflowY: "auto" },
    badge: { background: "#fff3cd", color: "#856404", padding: "4px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600 },
    center: { display: "flex", alignItems: "center", justifyContent: "center", height: "40vh" },
};
