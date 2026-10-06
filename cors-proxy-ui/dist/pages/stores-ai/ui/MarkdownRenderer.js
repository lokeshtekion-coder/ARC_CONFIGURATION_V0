import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from "react";
const badgeSuccessStyle = {
    background: "rgba(34, 197, 94, 0.16)",
    color: "#4ade80",
    border: "1px solid rgba(34, 197, 94, 0.35)",
    padding: "1px 6px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
    display: "inline-block",
    margin: "0 2px",
};
const badgeWarningStyle = {
    background: "rgba(245, 158, 11, 0.16)",
    color: "#fbbf24",
    border: "1px solid rgba(245, 158, 11, 0.35)",
    padding: "1px 6px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
    display: "inline-block",
    margin: "0 2px",
};
const badgeInfoStyle = {
    background: "rgba(56, 189, 248, 0.16)",
    color: "#38bdf8",
    border: "1px solid rgba(56, 189, 248, 0.35)",
    padding: "1px 6px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
    display: "inline-block",
    margin: "0 2px",
};
const badgeDangerStyle = {
    background: "rgba(239, 68, 68, 0.16)",
    color: "#f87171",
    border: "1px solid rgba(239, 68, 68, 0.35)",
    padding: "1px 6px",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
    display: "inline-block",
    margin: "0 2px",
};
const inlineCodeStyle = {
    background: "rgba(0,0,0,0.4)",
    color: "#a5f3fc",
    padding: "1px 5px",
    borderRadius: 4,
    fontFamily: "ui-monospace, monospace",
    fontSize: 11.5,
    border: "1px solid rgba(255,255,255,0.1)",
};
const codeBoxContainerStyle = {
    background: "#090d16",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    overflow: "hidden",
    margin: "4px 0",
};
const codeBoxHeaderStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "rgba(255,255,255,0.03)",
    padding: "4px 10px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
};
const codeCopyBtnStyle = {
    background: "none",
    border: "none",
    color: "#38bdf8",
    fontSize: 10,
    fontWeight: 700,
    cursor: "pointer",
    padding: "2px 6px",
};
const codePreStyle = {
    margin: 0,
    padding: 10,
    fontSize: 11,
    fontFamily: "ui-monospace, monospace",
    color: "#cbd5e1",
    overflowX: "auto",
};
const tableWrapStyle = {
    overflowX: "auto",
    borderRadius: 8,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.3)",
    margin: "6px 0",
};
const tableStyle = {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 11,
};
const tableHeaderRowStyle = {
    background: "rgba(255,255,255,0.06)",
    borderBottom: "1px solid rgba(255,255,255,0.12)",
};
const thStyle = {
    padding: "6px 8px",
    textAlign: "left",
    fontWeight: 800,
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    whiteSpace: "nowrap",
};
const tableRowStyle = {
    borderBottom: "1px solid rgba(255,255,255,0.04)",
};
const tdStyle = {
    padding: "6px 8px",
    color: "#e2e8f0",
    whiteSpace: "nowrap",
};
const calloutBoxStyle = {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    background: "rgba(56, 189, 248, 0.08)",
    border: "1px solid rgba(56, 189, 248, 0.25)",
    color: "#e2e8f0",
    margin: "4px 0",
};
function renderFormattedInline(text) {
    const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
    return parts.map((part, idx) => {
        if (part.startsWith("**") && part.endsWith("**")) {
            const inner = part.slice(2, -2);
            const lower = inner.toLowerCase();
            if (lower === "completed" || lower === "done") {
                return _jsx("span", { style: badgeSuccessStyle, children: inner }, idx);
            }
            if (lower === "wip" || lower === "in progress") {
                return _jsx("span", { style: badgeWarningStyle, children: inner }, idx);
            }
            if (lower === "to do" || lower === "pending" || lower.startsWith("t-")) {
                return _jsx("span", { style: badgeInfoStyle, children: inner }, idx);
            }
            if (lower.includes("breached") ||
                lower.includes("blocked") ||
                lower.includes("error") ||
                lower.includes("no assignee")) {
                return _jsx("span", { style: badgeDangerStyle, children: inner }, idx);
            }
            return (_jsx("strong", { style: { color: "#f8fafc", fontWeight: 700 }, children: inner }, idx));
        }
        if (part.startsWith("`") && part.endsWith("`")) {
            return (_jsx("code", { style: inlineCodeStyle, children: part.slice(1, -1) }, idx));
        }
        return _jsx("span", { children: part }, idx);
    });
}
export const RichMarkdownMessage = ({ content, onToast }) => {
    const blocks = useMemo(() => {
        const rawBlocks = [];
        const lines = content.split(/\r?\n/);
        let currentTable = [];
        let inCode = false;
        let codeLang = "";
        let codeBuffer = [];
        let textBuffer = [];
        const flushText = () => {
            if (textBuffer.length > 0) {
                const full = textBuffer.join("\n").trim();
                if (full) {
                    if (/^(\u26A0\uFE0F|\uD83D\uDEA8|\uD83E\uDDE0|\u2705|\uD83D\uDCA1)/u.test(full)) {
                        const icon = full.slice(0, 2);
                        rawBlocks.push({ type: "callout", text: full.slice(2).trim(), icon });
                    }
                    else {
                        rawBlocks.push({ type: "text", text: full });
                    }
                }
                textBuffer = [];
            }
        };
        const flushTable = () => {
            if (currentTable.length > 0) {
                rawBlocks.push({ type: "table", lines: [...currentTable] });
                currentTable = [];
            }
        };
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim().startsWith("```")) {
                if (!inCode) {
                    flushText();
                    flushTable();
                    inCode = true;
                    codeLang = line.trim().replace("```", "") || "json";
                    codeBuffer = [];
                }
                else {
                    rawBlocks.push({ type: "code", lang: codeLang, code: codeBuffer.join("\n") });
                    inCode = false;
                    codeBuffer = [];
                }
                continue;
            }
            if (inCode) {
                codeBuffer.push(line);
                continue;
            }
            if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
                flushText();
                currentTable.push(line);
                continue;
            }
            else if (currentTable.length > 0) {
                flushTable();
            }
            textBuffer.push(line);
        }
        flushText();
        flushTable();
        return rawBlocks;
    }, [content]);
    const copyCode = async (code) => {
        try {
            await navigator.clipboard.writeText(code);
            onToast("📋 Copied to clipboard");
        }
        catch {
            onToast("❌ Failed to copy to clipboard");
        }
    };
    return (_jsx("div", { style: { display: "flex", flexDirection: "column", gap: 10 }, children: blocks.map((block, idx) => {
            if (block.type === "code") {
                return (_jsxs("div", { style: codeBoxContainerStyle, children: [_jsxs("div", { style: codeBoxHeaderStyle, children: [_jsx("span", { style: { fontSize: 10, fontWeight: 700, color: "#94a3b8" }, children: block.lang.toUpperCase() }), _jsx("button", { type: "button", onClick: () => void copyCode(block.code), style: codeCopyBtnStyle, children: "\uD83D\uDCCB Copy" })] }), _jsx("pre", { style: codePreStyle, children: block.code })] }, idx));
            }
            if (block.type === "table") {
                const headerLine = block.lines[0];
                const dataLines = block.lines.slice(2);
                const headers = headerLine
                    .split("|")
                    .map((s) => s.trim())
                    .filter(Boolean);
                return (_jsx("div", { style: tableWrapStyle, children: _jsxs("table", { style: tableStyle, children: [_jsx("thead", { children: _jsx("tr", { style: tableHeaderRowStyle, children: headers.map((h, hIdx) => (_jsx("th", { style: thStyle, children: h }, hIdx))) }) }), _jsx("tbody", { children: dataLines.map((rowStr, rIdx) => {
                                    const cells = rowStr
                                        .split("|")
                                        .map((s) => s.trim())
                                        .filter(Boolean);
                                    return (_jsx("tr", { style: tableRowStyle, children: cells.map((c, cIdx) => (_jsx("td", { style: tdStyle, children: renderFormattedInline(c) }, cIdx))) }, rIdx));
                                }) })] }) }, idx));
            }
            if (block.type === "callout") {
                return (_jsxs("div", { style: calloutBoxStyle, children: [_jsx("span", { style: { fontSize: 16 }, children: block.icon }), _jsx("div", { style: { flex: 1, fontSize: 12.5, lineHeight: 1.5 }, children: block.text.split("\n").map((line, lIdx) => (_jsx("div", { children: renderFormattedInline(line) }, lIdx))) })] }, idx));
            }
            return (_jsx("div", { style: { lineHeight: 1.55 }, children: block.text.split("\n").map((line, lIdx) => {
                    if (line.trim().startsWith("•") || line.trim().startsWith("-")) {
                        return (_jsxs("div", { style: { display: "flex", gap: 6, marginLeft: 4, marginTop: 3 }, children: [_jsx("span", { style: { color: "#38bdf8" }, children: "\u2022" }), _jsx("span", { style: { flex: 1 }, children: renderFormattedInline(line.replace(/^[•-]\s*/, "")) })] }, lIdx));
                    }
                    return (_jsx("div", { style: { minHeight: line.trim() ? "auto" : 6 }, children: renderFormattedInline(line) }, lIdx));
                }) }, idx));
        }) }));
};
