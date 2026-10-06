import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from "react";
export const PartsPlaceholderView = ({ title, description }) => {
    useEffect(() => {
        console.log("[PartsPlaceholderView] mounted", { title, description });
        return () => {
            console.log("[PartsPlaceholderView] unmounted", { title });
        };
    }, [title, description]);
    return (_jsx("div", { style: {
            display: "grid",
            gap: 16,
        }, children: _jsxs("div", { style: {
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
                padding: 20,
            }, children: [_jsx("div", { style: {
                        fontSize: 24,
                        fontWeight: 800,
                        color: "#f8fafc",
                        marginBottom: 8,
                        wordBreak: "break-word",
                    }, children: title }), _jsx("div", { style: {
                        color: "#94a3b8",
                        fontSize: 14,
                        lineHeight: 1.7,
                        marginBottom: 16,
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                    }, children: description }), _jsxs("div", { style: {
                        minHeight: 280,
                        borderRadius: 14,
                        border: "1px dashed rgba(148,163,184,0.30)",
                        padding: 24,
                        color: "#94a3b8",
                        display: "grid",
                        placeItems: "center",
                        textAlign: "center",
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                    }, children: [title, " page placeholder"] })] }) }));
};
