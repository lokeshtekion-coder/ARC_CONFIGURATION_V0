import React, { useMemo } from "react";

const badgeSuccessStyle: React.CSSProperties = {
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

const badgeWarningStyle: React.CSSProperties = {
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

const badgeInfoStyle: React.CSSProperties = {
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

const badgeDangerStyle: React.CSSProperties = {
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

const inlineCodeStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.4)",
  color: "#a5f3fc",
  padding: "1px 5px",
  borderRadius: 4,
  fontFamily: "ui-monospace, monospace",
  fontSize: 11.5,
  border: "1px solid rgba(255,255,255,0.1)",
};

const codeBoxContainerStyle: React.CSSProperties = {
  background: "#090d16",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  overflow: "hidden",
  margin: "4px 0",
};

const codeBoxHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "rgba(255,255,255,0.03)",
  padding: "4px 10px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};

const codeCopyBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#38bdf8",
  fontSize: 10,
  fontWeight: 700,
  cursor: "pointer",
  padding: "2px 6px",
};

const codePreStyle: React.CSSProperties = {
  margin: 0,
  padding: 10,
  fontSize: 11,
  fontFamily: "ui-monospace, monospace",
  color: "#cbd5e1",
  overflowX: "auto",
};

const tableWrapStyle: React.CSSProperties = {
  overflowX: "auto",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.3)",
  margin: "6px 0",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 11,
};

const tableHeaderRowStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  borderBottom: "1px solid rgba(255,255,255,0.12)",
};

const thStyle: React.CSSProperties = {
  padding: "6px 8px",
  textAlign: "left",
  fontWeight: 800,
  color: "#94a3b8",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  whiteSpace: "nowrap",
};

const tableRowStyle: React.CSSProperties = {
  borderBottom: "1px solid rgba(255,255,255,0.04)",
};

const tdStyle: React.CSSProperties = {
  padding: "6px 8px",
  color: "#e2e8f0",
  whiteSpace: "nowrap",
};

const calloutBoxStyle: React.CSSProperties = {
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

function renderFormattedInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);

  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      const inner = part.slice(2, -2);
      const lower = inner.toLowerCase();
      if (lower === "completed" || lower === "done") {
        return <span key={idx} style={badgeSuccessStyle}>{inner}</span>;
      }
      if (lower === "wip" || lower === "in progress") {
        return <span key={idx} style={badgeWarningStyle}>{inner}</span>;
      }
      if (lower === "to do" || lower === "pending" || lower.startsWith("t-")) {
        return <span key={idx} style={badgeInfoStyle}>{inner}</span>;
      }
      if (
        lower.includes("breached") ||
        lower.includes("blocked") ||
        lower.includes("error") ||
        lower.includes("no assignee")
      ) {
        return <span key={idx} style={badgeDangerStyle}>{inner}</span>;
      }

      return (
        <strong key={idx} style={{ color: "#f8fafc", fontWeight: 700 }}>
          {inner}
        </strong>
      );
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={idx} style={inlineCodeStyle}>
          {part.slice(1, -1)}
        </code>
      );
    }

    return <span key={idx}>{part}</span>;
  });
}

export const RichMarkdownMessage: React.FC<{
  content: string;
  onToast: (m: string) => void;
}> = ({ content, onToast }) => {
  const blocks = useMemo(() => {
    const rawBlocks: Array<
      | { type: "table"; lines: string[] }
      | { type: "code"; lang: string; code: string }
      | { type: "callout"; text: string; icon: string }
      | { type: "text"; text: string }
    > = [];

    const lines = content.split(/\r?\n/);
    let currentTable: string[] = [];
    let inCode = false;
    let codeLang = "";
    let codeBuffer: string[] = [];
    let textBuffer: string[] = [];

    const flushText = () => {
      if (textBuffer.length > 0) {
        const full = textBuffer.join("\n").trim();
        if (full) {
          if (/^(\u26A0\uFE0F|\uD83D\uDEA8|\uD83E\uDDE0|\u2705|\uD83D\uDCA1)/u.test(full)) {
            const icon = full.slice(0, 2);
            rawBlocks.push({ type: "callout", text: full.slice(2).trim(), icon });
          } else {
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
        } else {
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
      } else if (currentTable.length > 0) {
        flushTable();
      }

      textBuffer.push(line);
    }

    flushText();
    flushTable();

    return rawBlocks;
  }, [content]);

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      onToast("📋 Copied to clipboard");
    } catch {
      onToast("❌ Failed to copy to clipboard");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {blocks.map((block, idx) => {
        if (block.type === "code") {
          return (
            <div key={idx} style={codeBoxContainerStyle}>
              <div style={codeBoxHeaderStyle}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8" }}>
                  {block.lang.toUpperCase()}
                </span>
                <button
                  type="button"
                  onClick={() => void copyCode(block.code)}
                  style={codeCopyBtnStyle}
                >
                  📋 Copy
                </button>
              </div>
              <pre style={codePreStyle}>{block.code}</pre>
            </div>
          );
        }

        if (block.type === "table") {
          const headerLine = block.lines[0];
          const dataLines = block.lines.slice(2);
          const headers = headerLine
            .split("|")
            .map((s) => s.trim())
            .filter(Boolean);

          return (
            <div key={idx} style={tableWrapStyle}>
              <table style={tableStyle}>
                <thead>
                  <tr style={tableHeaderRowStyle}>
                    {headers.map((h, hIdx) => (
                      <th key={hIdx} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dataLines.map((rowStr, rIdx) => {
                    const cells = rowStr
                      .split("|")
                      .map((s) => s.trim())
                      .filter(Boolean);
                    return (
                      <tr key={rIdx} style={tableRowStyle}>
                        {cells.map((c, cIdx) => (
                          <td key={cIdx} style={tdStyle}>{renderFormattedInline(c)}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.type === "callout") {
          return (
            <div key={idx} style={calloutBoxStyle}>
              <span style={{ fontSize: 16 }}>{block.icon}</span>
              <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.5 }}>
                {block.text.split("\n").map((line, lIdx) => (
                  <div key={lIdx}>{renderFormattedInline(line)}</div>
                ))}
              </div>
            </div>
          );
        }

        return (
          <div key={idx} style={{ lineHeight: 1.55 }}>
            {block.text.split("\n").map((line, lIdx) => {
              if (line.trim().startsWith("•") || line.trim().startsWith("-")) {
                return (
                  <div key={lIdx} style={{ display: "flex", gap: 6, marginLeft: 4, marginTop: 3 }}>
                    <span style={{ color: "#38bdf8" }}>•</span>
                    <span style={{ flex: 1 }}>{renderFormattedInline(line.replace(/^[•-]\s*/, ""))}</span>
                  </div>
                );
              }

              return (
                <div key={lIdx} style={{ minHeight: line.trim() ? "auto" : 6 }}>
                  {renderFormattedInline(line)}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
};
