import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
const CARD_STYLE = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.025)",
    padding: 14,
};
function formatSavedAt(value) {
    if (!value)
        return "Not captured";
    const d = new Date(value);
    if (Number.isNaN(d.getTime()))
        return "Not captured";
    return d.toLocaleString("en-US", {
        month: "short",
        day: "2-digit",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
    });
}
function normalizeHeaders(headers) {
    return Object.entries(headers ?? {})
        .filter(([key, value]) => key.trim() && String(value).trim())
        .sort(([a], [b]) => a.localeCompare(b));
}
function buildSelectionMap(entries, initialSelectedKeys) {
    const next = {};
    const selectedSet = initialSelectedKeys && initialSelectedKeys.length > 0
        ? new Set(initialSelectedKeys)
        : null;
    for (const [key] of entries) {
        next[key] = selectedSet ? selectedSet.has(key) : true;
    }
    return next;
}
export const SelectableHeaderMap = ({ title, headers, capturedAt, sourceUrl, applyButtonLabel = "Use Selected as Global Headers", initialSelectedKeys, onApplySelected, }) => {
    const entries = useMemo(() => normalizeHeaders(headers), [headers]);
    const headerSignature = useMemo(() => JSON.stringify(entries), [entries]);
    const [selectedKeys, setSelectedKeys] = useState({});
    const lastSignatureRef = useRef("");
    useEffect(() => {
        if (lastSignatureRef.current === headerSignature)
            return;
        lastSignatureRef.current = headerSignature;
        setSelectedKeys(buildSelectionMap(entries, initialSelectedKeys));
    }, [headerSignature, entries, initialSelectedKeys]);
    const selectedCount = entries.filter(([key]) => Boolean(selectedKeys[key])).length;
    const toggleKey = (key) => {
        setSelectedKeys((prev) => ({
            ...prev,
            [key]: !prev[key],
        }));
    };
    const handleSelectAll = () => {
        setSelectedKeys(() => {
            const next = {};
            for (const [key] of entries)
                next[key] = true;
            return next;
        });
    };
    const handleClearAll = () => {
        setSelectedKeys(() => {
            const next = {};
            for (const [key] of entries)
                next[key] = false;
            return next;
        });
    };
    const handleApply = () => {
        const pairs = entries
            .filter(([key]) => Boolean(selectedKeys[key]))
            .map(([key, value]) => ({
            key,
            value,
            enabled: true,
        }));
        onApplySelected(pairs);
    };
    return (_jsxs("section", { style: CARD_STYLE, children: [_jsxs("div", { style: {
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 12,
                    flexWrap: "wrap",
                    marginBottom: 12,
                }, children: [_jsxs("div", { style: { minWidth: 0, flex: 1 }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 16, fontWeight: 700 }, children: title }), _jsxs("div", { style: { color: "#94a3b8", fontSize: 13, marginTop: 4 }, children: ["Captured: ", formatSavedAt(capturedAt), " \u00B7 ", entries.length, " headers \u00B7 ", selectedCount, " selected"] }), sourceUrl ? (_jsxs("div", { style: {
                                    color: "#94a3b8",
                                    fontSize: 12,
                                    marginTop: 6,
                                    wordBreak: "break-word",
                                    overflowWrap: "anywhere",
                                }, children: ["Source: ", sourceUrl] })) : null] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: handleSelectAll, children: "\u2611 Select All" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: handleClearAll, children: "\u2610 Clear All" }), _jsxs("button", { className: "btn-postman", type: "button", onClick: handleApply, disabled: selectedCount === 0, children: ["\u21E2 ", applyButtonLabel] })] })] }), entries.length === 0 ? (_jsx("div", { style: { color: "#94a3b8", fontSize: 14 }, children: "No headers captured." })) : (_jsx("div", { style: { display: "grid", gap: 10 }, children: entries.map(([key, value]) => (_jsxs("div", { style: {
                        display: "grid",
                        gridTemplateColumns: "20px minmax(180px, 260px) minmax(0, 1fr)",
                        gap: 12,
                        alignItems: "start",
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,0.08)",
                        background: "rgba(15,23,42,0.32)",
                    }, children: [_jsx("input", { type: "checkbox", checked: Boolean(selectedKeys[key]), onChange: () => toggleKey(key), style: { marginTop: 3 } }), _jsx("button", { type: "button", onClick: () => toggleKey(key), style: {
                                border: "none",
                                background: "transparent",
                                padding: 0,
                                margin: 0,
                                textAlign: "left",
                                color: "#93c5fd",
                                fontSize: 12,
                                fontWeight: 700,
                                cursor: "pointer",
                                wordBreak: "break-word",
                                overflowWrap: "anywhere",
                            }, children: key }), _jsx("button", { type: "button", onClick: () => toggleKey(key), style: {
                                border: "none",
                                background: "transparent",
                                padding: 0,
                                margin: 0,
                                textAlign: "left",
                                color: "#e2e8f0",
                                fontSize: 12,
                                lineHeight: 1.5,
                                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                cursor: "pointer",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                                overflowWrap: "anywhere",
                            }, children: value })] }, key))) }))] }));
};
