import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export const Analytics = ({ onBack }) => {
    return (_jsx("div", { style: {
            minHeight: "100vh",
            padding: "24px 16px 36px",
            boxSizing: "border-box",
        }, children: _jsxs("div", { style: { maxWidth: 1200, margin: "0 auto", display: "grid", gap: 16 }, children: [_jsxs("div", { style: {
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        flexWrap: "wrap",
                    }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 28, fontWeight: 800, color: "#f8fafc", marginBottom: 4 }, children: "\uD83D\uDCCA Analytics" }), _jsx("div", { style: { color: "#94a3b8", fontSize: 14 }, children: "Analytics auto-configuration workspace" })] }), _jsx("button", { className: "btn-secondary btn-sm", onClick: onBack, children: "\u2190 Back" })] }), _jsxs("div", { style: {
                        borderRadius: 18,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(255,255,255,0.03)",
                        padding: 20,
                    }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 18, fontWeight: 700, marginBottom: 8 }, children: "Analytics Actions" }), _jsx("div", { style: { color: "#94a3b8", fontSize: 14, marginBottom: 16 }, children: "Blank UI for now. Later we can add multiple Analytics buttons and keep related logic inside this folder." }), _jsx("div", { style: {
                                minHeight: 260,
                                borderRadius: 14,
                                border: "1px dashed rgba(148,163,184,0.30)",
                                padding: 24,
                                color: "#94a3b8",
                                display: "grid",
                                placeItems: "center",
                                textAlign: "center",
                            }, children: "Analytics page placeholder" })] })] }) }));
};
