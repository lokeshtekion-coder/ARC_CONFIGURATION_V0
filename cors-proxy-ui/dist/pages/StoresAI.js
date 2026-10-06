import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState, useRef } from "react";
import { loadLearnedRules, saveLearnedRules } from "./stores-ai/memoryStore";
import { calculateDiffDays } from "./stores-ai/engine/timeline";
import { normalizeStoreList } from "./stores-ai/engine/normalizeStores";
import { executeStoreQuery } from "./stores-ai/engine/queryEngine";
import { interpretNaturalLanguageQuery } from "./stores-ai/engine/queryInterpreter";
import { RichMarkdownMessage } from "./stores-ai/ui/MarkdownRenderer";
import { sendSlackDocument, getSlackSession, } from "../services/storeSlackHelper";
const TGPT_TOKEN_KEY = "tgpt_access_token";
const TGPT_BASE = "https://tapapi.tekioncloud.com/tapapi/tgpt";
const ALERT_CHANNEL_ID = "C0C5QBWEM8X";
// ---------------------------------------------------------------------------
// STRICT 5-COLUMN CSV EXPORTER (dd/mm/yyyy)
// ---------------------------------------------------------------------------
function formatToDdMmYyyy(launchDateRaw) {
    if (!launchDateRaw)
        return "—";
    let d = null;
    const trimmed = String(launchDateRaw).trim();
    if (/^\d+$/.test(trimmed)) {
        const num = Number(trimmed);
        const ms = trimmed.length <= 10 ? num * 1000 : num;
        d = new Date(ms);
    }
    else {
        d = new Date(trimmed);
    }
    if (!d || Number.isNaN(d.getTime()))
        return "—";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}
function exportStoresToCsv(stores) {
    const headers = [
        "Dealer ID",
        "Tekion ID",
        "Dealership Name",
        "Go-Live Date",
        "Timeline",
    ];
    const escapeCell = (val) => {
        if (val === null || val === undefined)
            return '""';
        const s = String(val).replace(/"/g, '""');
        return `"${s}"`;
    };
    // Sort by earliest go-live date first (launchDays ascending: T-36 before T-58),
    // then tie-break by Dealer ID ascending
    const sortedStores = [...stores].sort((a, b) => {
        const diffA = calculateDiffDays(a.launch_date);
        const diffB = calculateDiffDays(b.launch_date);
        if (diffA !== diffB) {
            return diffA - diffB;
        }
        return Number(a.dealer_id || 0) - Number(b.dealer_id || 0);
    });
    const rows = sortedStores.map((s) => {
        const diff = calculateDiffDays(s.launch_date);
        const tLabel = diff < 0 ? `Launched (+${Math.abs(diff)}d)` : `T-${diff}`;
        const formattedDate = formatToDdMmYyyy(s.launch_date);
        return [
            escapeCell(s.dealer_id),
            escapeCell(s.tekion_id),
            escapeCell(s.dba_name || ""),
            escapeCell(formattedDate),
            escapeCell(tLabel),
        ].join(",");
    });
    return [headers.join(","), ...rows].join("\r\n");
}
async function dispatchStoresCsvToSlack(stores, description) {
    const session = getSlackSession();
    if (!session.slackToken || !session.slackDCookie) {
        return { sent: false, reason: "Slack credentials (xoxc token or d-cookie) missing" };
    }
    if (stores.length === 0) {
        return { sent: false, reason: "No stores to dispatch" };
    }
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    const fileName = `Stores_List_${dateStr}_${Date.now()}.csv`;
    const csvContent = exportStoresToCsv(stores);
    try {
        await sendSlackDocument({
            channelId: ALERT_CHANNEL_ID,
            fileName,
            fileContent: csvContent,
            title: `Stores List (${stores.length} Stores) - ${dateStr} ${timeStr}`,
            initialComment: `📑 *Stores List Export (Strict 5 Columns)*\n` +
                `• *Criteria:* ${description}\n` +
                `• *Total Stores:* *${stores.length}*\n` +
                `• *Columns:* Dealer ID | Tekion ID | Dealership Name | Go-Live Date (dd/mm/yyyy) | Timeline\n` +
                `• *Exported by:* ARC Stores Copilot at ${timeStr} (${dateStr})\n` +
                `Uploaded directly to <#${ALERT_CHANNEL_ID}>.`,
        });
        return { sent: true, fileName };
    }
    catch (err) {
        return {
            sent: false,
            reason: err instanceof Error ? err.message : "Slack upload API failure",
        };
    }
}
// ---------------------------------------------------------------------------
// INTENT & RULE EXTRACTION
// ---------------------------------------------------------------------------
function detectLearningInstruction(text) {
    const trimmed = text.trim();
    const patterns = [
        /^(?:remember|note|learn|rule|correction)(?:\s+that|\s*:|\s+-|\s+)(.+)/i,
        /^(?:always|never|do not|please remember)(?:\s+that|\s*:|\s+-|\s+)(.+)/i,
    ];
    for (const pat of patterns) {
        const match = trimmed.match(pat);
        if (match && match[1]?.trim()) {
            const rule = match[1].trim();
            const lower = rule.toLowerCase();
            let category = "general_instruction";
            if (lower.includes("dealer") || /\b\d{4,5}\b/.test(lower)) {
                category = "dealer_override";
            }
            else if (lower.includes("assign") || lower.includes("owner") || lower.includes("pod")) {
                category = "assignee_rule";
            }
            return { rule, category };
        }
    }
    return null;
}
// ---------------------------------------------------------------------------
// EDITABLE MEMORY CARD COMPONENT (100ms DEBOUNCED AUTO-SAVE)
// ---------------------------------------------------------------------------
const EditableMemoryItem = ({ rule, onUpdate, onDelete }) => {
    const [text, setText] = useState(rule.rule);
    const [category, setCategory] = useState(rule.category);
    const [saveStatus, setSaveStatus] = useState("idle");
    const timeoutRef = useRef(null);
    const triggerAutoSave = (newText, newCat) => {
        if (timeoutRef.current)
            clearTimeout(timeoutRef.current);
        setSaveStatus("saving");
        timeoutRef.current = window.setTimeout(() => {
            onUpdate(rule.id, newText, newCat);
            setSaveStatus("saved");
            setTimeout(() => setSaveStatus("idle"), 1200);
        }, 100);
    };
    const handleTextChange = (e) => {
        const val = e.target.value;
        setText(val);
        triggerAutoSave(val, category);
    };
    const handleCategoryChange = (e) => {
        const val = e.target.value;
        setCategory(val);
        triggerAutoSave(text, val);
    };
    useEffect(() => {
        return () => {
            if (timeoutRef.current)
                clearTimeout(timeoutRef.current);
        };
    }, []);
    return (_jsxs("div", { style: {
            background: "rgba(30, 41, 59, 0.65)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
        }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsxs("select", { value: category, onChange: handleCategoryChange, style: {
                                    background: "#090d16",
                                    border: "1px solid rgba(56, 189, 248, 0.3)",
                                    color: "#38bdf8",
                                    fontSize: 10,
                                    fontWeight: 700,
                                    borderRadius: 4,
                                    padding: "2px 6px",
                                    cursor: "pointer",
                                    outline: "none",
                                }, children: [_jsx("option", { value: "dealer_override", children: "DEALER OVERRIDE" }), _jsx("option", { value: "assignee_rule", children: "ASSIGNEE RULE" }), _jsx("option", { value: "general_instruction", children: "GENERAL INSTRUCTION" })] }), _jsx("span", { style: { fontSize: 10, color: "#64748b" }, children: new Date(rule.addedAt).toLocaleDateString() })] }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [saveStatus === "saving" && (_jsx("span", { style: { fontSize: 10, color: "#fbbf24", fontWeight: 600 }, children: "\uD83D\uDCBE Saving..." })), saveStatus === "saved" && (_jsx("span", { style: { fontSize: 10, color: "#4ade80", fontWeight: 600 }, children: "\u2713 Saved" })), _jsx("button", { type: "button", onClick: () => onDelete(rule.id), style: {
                                    background: "none",
                                    border: "none",
                                    color: "#f87171",
                                    fontSize: 14,
                                    cursor: "pointer",
                                    padding: "0 4px",
                                }, title: "Delete this rule", children: "\u2715" })] })] }), _jsx("textarea", { value: text, onChange: handleTextChange, placeholder: "Type rule here (auto-saves in 100ms)...", style: {
                    width: "100%",
                    minHeight: 52,
                    background: "#090d16",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 6,
                    padding: "6px 8px",
                    color: "#f1f5f9",
                    fontSize: 12,
                    lineHeight: 1.4,
                    resize: "vertical",
                    outline: "none",
                } })] }));
};
// ---------------------------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------------------------
export const StoresAI = ({ isOpen, onClose, records, onToast, }) => {
    const [activeTab, setActiveTab] = useState("chat");
    const [learnedRules, setLearnedRules] = useState(loadLearnedRules);
    const [messages, setMessages] = useState([
        {
            id: "init",
            sender: "bot",
            text: "👋 Hi! I'm your **Stores AI Copilot**.\n\nI run an in-memory Query DSL, teachable rule memory, and Slack table dispatching. Ask me to count, filter, audit, or send CSV lists directly to Slack.",
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
    ]);
    const [input, setInput] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const [lastQueryResult, setLastQueryResult] = useState(null);
    const messagesEndRef = useRef(null);
    const abortControllerRef = useRef(null);
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };
    useEffect(() => {
        if (isOpen && activeTab === "chat") {
            scrollToBottom();
        }
    }, [isOpen, messages, activeTab]);
    useEffect(() => {
        return () => {
            if (abortControllerRef.current)
                abortControllerRef.current.abort();
        };
    }, []);
    const t90Stores = useMemo(() => {
        return records
            .filter((r) => {
            const diff = calculateDiffDays(r.launch_date);
            return diff >= 0 && diff <= 90;
        })
            .sort((a, b) => calculateDiffDays(a.launch_date) - calculateDiffDays(b.launch_date));
    }, [records]);
    const normalizedFacts = useMemo(() => {
        return normalizeStoreList(t90Stores);
    }, [t90Stores]);
    const handleUpdateRule = (id, updatedRule, updatedCategory) => {
        setLearnedRules((prev) => {
            const next = prev.map((r) => r.id === id ? { ...r, rule: updatedRule, category: updatedCategory } : r);
            saveLearnedRules(next);
            return next;
        });
    };
    const handleAddRuleDirect = (ruleText, category = "general_instruction") => {
        const newRule = {
            id: `rule-${Date.now()}`,
            rule: ruleText,
            category,
            addedAt: new Date().toISOString(),
        };
        setLearnedRules((prev) => {
            const next = [newRule, ...prev];
            saveLearnedRules(next);
            return next;
        });
        return newRule;
    };
    const handleDeleteRule = (id) => {
        setLearnedRules((prev) => {
            const next = prev.filter((r) => r.id !== id);
            saveLearnedRules(next);
            return next;
        });
        onToast("🗑️️ Rule removed from memory");
    };
    const handleExportMemoryJson = () => {
        const blob = new Blob([JSON.stringify(learnedRules, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `stores-copilot-memory-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        onToast("📥 Exported rules to JSON");
    };
    const handleSendMessage = async (textToSend) => {
        const q = (textToSend || input).trim();
        if (!q || isStreaming)
            return;
        if (abortControllerRef.current)
            abortControllerRef.current.abort();
        const currentAbortController = new AbortController();
        abortControllerRef.current = currentAbortController;
        const userMsg = {
            id: `user-${Date.now()}`,
            sender: "user",
            text: q,
            timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        };
        setMessages((prev) => [...prev, userMsg]);
        setInput("");
        const extractedInstruction = detectLearningInstruction(q);
        let ruleJustLearned = null;
        if (extractedInstruction) {
            ruleJustLearned = handleAddRuleDirect(extractedInstruction.rule, extractedInstruction.category);
            onToast("🧠 Saved rule to editable memory!");
        }
        setIsStreaming(true);
        const botMsgId = `bot-${Date.now()}`;
        setMessages((prev) => [
            ...prev,
            {
                id: botMsgId,
                sender: "bot",
                text: ruleJustLearned
                    ? `🧠 **Learned & Saved to Memory!**\n> *"​${ruleJustLearned.rule}"*\n\nAuto-saved to permanent memory. You can view or live-edit it anytime in the **🧠 Memory** tab.`
                    : "⚡ Processing query...",
                timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
        ]);
        if (ruleJustLearned && q.length < 60) {
            setIsStreaming(false);
            return;
        }
        const token = localStorage.getItem(TGPT_TOKEN_KEY) || "";
        try {
            const qLower = q.toLowerCase();
            // ---------------------------------------------------------------------
            // ROUTE A: SLACK CSV TABLE DISPATCH INTENT
            // ---------------------------------------------------------------------
            const isSlackCsvRequest = qLower.includes("slack") &&
                (qLower.includes("csv") || qLower.includes("table") || qLower.includes("send") || qLower.includes("list") || qLower.includes("export"));
            if (isSlackCsvRequest) {
                setMessages((prev) => prev.map((m) => (m.id === botMsgId ? { ...m, text: "📤 Compiling 5-column CSV and dispatching to Slack..." } : m)));
                let targetStores = [];
                let exportDescription = "Full T-90 Workspace Stores";
                const isFollowUp = lastQueryResult && (qLower.includes("those") || qLower.includes("them") || qLower.includes("filtered"));
                if (isFollowUp && lastQueryResult) {
                    const idsSet = new Set(lastQueryResult.storeIds);
                    targetStores = records.filter((r) => idsSet.has(r.dealer_id));
                    exportDescription = `Filtered Query (${lastQueryResult.description})`;
                }
                else {
                    const compiled = await interpretNaturalLanguageQuery(q, token);
                    const matchedFacts = executeStoreQuery(compiled, normalizedFacts);
                    if (matchedFacts.length > 0 && matchedFacts.length < normalizedFacts.length) {
                        const idsSet = new Set(matchedFacts.map((f) => f.dealerId));
                        targetStores = records.filter((r) => idsSet.has(r.dealer_id));
                        exportDescription = `Matched ${targetStores.length} stores based on filters`;
                    }
                    else {
                        targetStores = t90Stores;
                    }
                }
                const dispatchResult = await dispatchStoresCsvToSlack(targetStores, exportDescription);
                if (dispatchResult.sent) {
                    const confirmation = `✅ **Dispatched Table to Slack Successfully!**\n\n` +
                        `• **Exported Count:** ${targetStores.length} store(s)\n` +
                        `• **Columns (5):** Dealer ID, Tekion ID, Dealership Name, Go-Live Date (dd/mm/yyyy), Timeline\n` +
                        `• **File Name:** \`${dispatchResult.fileName}\`\n` +
                        `• **Destination:** <#${ALERT_CHANNEL_ID}>\n\n` +
                        `_Uploaded as a clean 5-column CSV document ready for operations review._`;
                    setMessages((prev) => prev.map((m) => (m.id === botMsgId ? { ...m, text: confirmation } : m)));
                    onToast("📢 CSV table sent to Slack");
                }
                else {
                    setMessages((prev) => prev.map((m) => m.id === botMsgId
                        ? { ...m, text: `⚠️ **Slack Dispatch Failed**: ${dispatchResult.reason || "Check Slack session."}` }
                        : m));
                }
                setIsStreaming(false);
                return;
            }
            // ---------------------------------------------------------------------
            // ROUTE B: DETERMINISTIC QUERY DSL EXECUTION
            // ---------------------------------------------------------------------
            const compiledQuery = await interpretNaturalLanguageQuery(q, token, lastQueryResult?.storeIds);
            const matches = executeStoreQuery(compiledQuery, normalizedFacts);
            const matchIds = matches.map((m) => m.dealerId);
            setLastQueryResult({
                query: compiledQuery,
                storeIds: matchIds,
                count: matches.length,
                description: q,
            });
            // 1. Pure counts return instantly
            if (compiledQuery.output === "count") {
                let answer = `Found **${matches.length} store${matches.length === 1 ? "" : "s"}** matching your request.`;
                const isAttachmentAudit = compiledQuery.filters.some((f) => f.field === "attachments" && f.value === 0) &&
                    compiledQuery.filters.some((f) => f.field === "fixed_ops_status" && f.value === "Completed");
                if (isAttachmentAudit) {
                    answer = `Exactly **${matches.length} store${matches.length === 1 ? "" : "s"}** are marked Completed with zero attachments.`;
                }
                setMessages((prev) => prev.map((m) => (m.id === botMsgId ? { ...m, text: answer } : m)));
                setIsStreaming(false);
                return;
            }
            // 2. Direct local rendering for concise tables (under 20 rows)
            const needsLlmExplanation = qLower.includes("why") ||
                qLower.includes("explain") ||
                qLower.includes("recommend") ||
                qLower.includes("analyze");
            if (!needsLlmExplanation && matches.length > 0 && matches.length <= 20) {
                const header = "| Dealer | Store Name | Timeline | Fixed Ops | Var Ops | Assignee |\n|---|---|---|---|---|---|\n";
                const rows = matches
                    .map((s) => `| **#${s.dealerId}** | ${s.dbaName} | T-${s.launchDays} | ${s.fixedOpsStatus} | ${s.variableOpsStatus} | ${s.assignee || "Unassigned"} |`)
                    .join("\n");
                const summary = `Showing **${matches.length} matching store${matches.length === 1 ? "" : "s"}**:\n\n${header}${rows}\n\n_Tip: Type "Send those to Slack in CSV" to dispatch this list directly to <#${ALERT_CHANNEL_ID}>._`;
                setMessages((prev) => prev.map((m) => (m.id === botMsgId ? { ...m, text: summary } : m)));
                setIsStreaming(false);
                return;
            }
            // 3. Deep Analysis via LLM with ONLY matched records
            const payloadSlice = matches.slice(0, 50).map((s) => ({
                dealerId: s.dealerId,
                dbaName: s.dbaName,
                launchDays: s.launchDays,
                fixedOpsStatus: s.fixedOpsStatus,
                variableOpsStatus: s.variableOpsStatus,
                assignee: s.assignee,
                attachments: s.attachments,
                setupError: s.setupDataError,
                isBlocked: s.isVariableOpsBlocked,
                notWorked: s.notWorked,
            }));
            const activeRules = loadLearnedRules();
            const rulesBlock = activeRules.length > 0
                ? activeRules.map((r, i) => `${i + 1}. [${r.category.toUpperCase()}] ${r.rule}`).join("\n")
                : "None.";
            const promptPayload = `You are the ARC Operations Copilot.
The user asked: "${q}".
Our deterministic query engine executed the search and found ${matches.length} matching store(s).

MATCHED STORE SUBSET (${payloadSlice.length} of ${matches.length} shown):
${JSON.stringify(payloadSlice, null, 2)}

PERSISTENT USER RULES (FROM MEMORY):
${rulesBlock}

STRICT EXCLUSION RULE:
Never recommend or prioritize a store if 'notWorked' contains 'OFS', 'POD', or 'Fixed + Variable'. These stores are out of ARC scope.
Only recommend stores that are unblocked, pending, and handled by ARC.

INSTRUCTIONS:
1. Confirm the exact count (${matches.length} stores) definitively.
2. Present the records cleanly in a Markdown Table.
3. If the user asked "why" or for blockers, explain strictly using the supplied data. Do not hallucinate.`;
            const createRes = await fetch(`${TGPT_BASE}/conversations`, {
                method: "POST",
                headers: {
                    accept: "application/json",
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    model: "gpt-5.6-luna",
                    title: "Stores Copilot Analysis",
                    is_temporary: false,
                    thinking: false,
                }),
                signal: currentAbortController.signal,
            });
            if (!createRes.ok)
                throw new Error(`HTTP ${createRes.status} on conversation init`);
            const { id: convId } = await createRes.json();
            const streamRes = await fetch(`${TGPT_BASE}/conversations/${convId}/messages/stream`, {
                method: "POST",
                headers: {
                    accept: "*/*",
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    content: promptPayload,
                    thinking: false,
                }),
                signal: currentAbortController.signal,
            });
            if (!streamRes.ok || !streamRes.body)
                throw new Error("Stream connection failed");
            const reader = streamRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let accumulated = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split("\n\n");
                buffer = parts.pop() || "";
                for (const part of parts) {
                    if (!part.trim())
                        continue;
                    const lines = part.split("\n");
                    for (const line of lines) {
                        if (!line.startsWith("data: "))
                            continue;
                        const rawData = line.substring(6).trim();
                        if (rawData === "[DONE]")
                            continue;
                        try {
                            const data = JSON.parse(rawData);
                            if (data.type === "content_delta") {
                                accumulated += data.delta || "";
                                setMessages((prev) => prev.map((m) => (m.id === botMsgId ? { ...m, text: accumulated } : m)));
                            }
                        }
                        catch { }
                    }
                }
            }
        }
        catch (err) {
            if (err?.name === "AbortError")
                return;
            const msg = err instanceof Error ? err.message : "Query Error";
            setMessages((prev) => prev.map((m) => (m.id === botMsgId ? { ...m, text: `⚠️ ${msg}` } : m)));
        }
        finally {
            setIsStreaming(false);
        }
    };
    if (!isOpen)
        return null;
    return (_jsxs("div", { style: {
            position: "fixed",
            bottom: 24,
            right: 24,
            width: 530,
            height: 660,
            maxHeight: "88vh",
            background: "#0f172a",
            border: "1px solid rgba(56, 189, 248, 0.35)",
            borderRadius: 16,
            boxShadow: "0 20px 40px rgba(0,0,0,0.7), 0 0 20px rgba(56, 189, 248, 0.2)",
            display: "flex",
            flexDirection: "column",
            zIndex: 99999,
            overflow: "hidden",
        }, children: [_jsxs("div", { style: {
                    padding: "12px 16px",
                    background: "rgba(30, 41, 59, 0.8)",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [_jsx("div", { style: { width: 10, height: 10, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 8px #4ade80" } }), _jsx("span", { style: { fontSize: 14, fontWeight: 800, color: "#f8fafc" }, children: "\u26A1 Stores AI (DSL Engine)" }), _jsxs("div", { style: { display: "inline-flex", background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: 2 }, children: [_jsx("button", { type: "button", onClick: () => setActiveTab("chat"), style: {
                                            border: "none",
                                            background: activeTab === "chat" ? "#0284c7" : "transparent",
                                            color: activeTab === "chat" ? "#fff" : "#94a3b8",
                                            fontSize: 11,
                                            fontWeight: 700,
                                            borderRadius: 4,
                                            padding: "3px 8px",
                                            cursor: "pointer",
                                        }, children: "Chat" }), _jsxs("button", { type: "button", onClick: () => setActiveTab("memory"), style: {
                                            border: "none",
                                            background: activeTab === "memory" ? "#0284c7" : "transparent",
                                            color: activeTab === "memory" ? "#fff" : "#94a3b8",
                                            fontSize: 11,
                                            fontWeight: 700,
                                            borderRadius: 4,
                                            padding: "3px 8px",
                                            cursor: "pointer",
                                        }, children: ["\uD83E\uDDE0 Memory (", learnedRules.length, ")"] })] })] }), _jsx("button", { type: "button", onClick: onClose, style: { background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 16, fontWeight: 700 }, children: "\u2715" })] }), activeTab === "chat" && (_jsxs(_Fragment, { children: [_jsx("div", { style: {
                            display: "flex",
                            gap: 6,
                            padding: "8px 12px",
                            overflowX: "auto",
                            background: "rgba(15, 23, 42, 0.6)",
                            borderBottom: "1px solid rgba(255,255,255,0.05)",
                            whiteSpace: "nowrap",
                        }, children: [
                            "🎯 Give me 5 stores for today for me to work on",
                            "❓ How many completed stores have zero attachments?",
                            "📢 Send stores list to Slack in CSV format",
                            "⛔ Blocked Variable Ops list",
                            "⚠️ Unassigned unblocked stores",
                        ].map((chip) => (_jsx("button", { type: "button", disabled: isStreaming, onClick: () => void handleSendMessage(chip.replace(/^[^\w\s]+\s*/, "")), style: {
                                background: chip.includes("Slack")
                                    ? "rgba(168, 85, 247, 0.15)"
                                    : chip.includes("work on")
                                        ? "rgba(34, 197, 94, 0.15)"
                                        : chip.includes("zero") || chip.includes("Blocked")
                                            ? "rgba(244, 63, 94, 0.15)"
                                            : "rgba(56, 189, 248, 0.1)",
                                border: `1px solid ${chip.includes("Slack")
                                    ? "rgba(168, 85, 247, 0.35)"
                                    : chip.includes("work on")
                                        ? "rgba(34, 197, 94, 0.35)"
                                        : chip.includes("zero") || chip.includes("Blocked")
                                            ? "rgba(244, 63, 94, 0.35)"
                                            : "rgba(56, 189, 248, 0.25)"}`,
                                color: chip.includes("Slack")
                                    ? "#c084fc"
                                    : chip.includes("work on")
                                        ? "#4ade80"
                                        : chip.includes("zero") || chip.includes("Blocked")
                                            ? "#fb7185"
                                            : "#38bdf8",
                                padding: "3px 8px",
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 600,
                                cursor: "pointer",
                            }, children: chip }, chip))) }), _jsxs("div", { style: {
                            flex: 1,
                            overflowY: "auto",
                            padding: 14,
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                        }, children: [messages.map((m) => (_jsxs("div", { style: {
                                    alignSelf: m.sender === "user" ? "flex-end" : "flex-start",
                                    maxWidth: "92%",
                                    background: m.sender === "user" ? "#0284c7" : "rgba(30, 41, 59, 0.95)",
                                    color: m.sender === "user" ? "#ffffff" : "#f1f5f9",
                                    border: m.sender === "user" ? "none" : "1px solid rgba(255,255,255,0.08)",
                                    padding: "12px 14px",
                                    borderRadius: 12,
                                    fontSize: 12.5,
                                    lineHeight: 1.45,
                                }, children: [m.sender === "user" ? (_jsx("div", { style: { whiteSpace: "pre-wrap" }, children: m.text })) : (_jsx(RichMarkdownMessage, { content: m.text, onToast: onToast })), _jsx("div", { style: { fontSize: 9, opacity: 0.6, marginTop: 6, textAlign: m.sender === "user" ? "right" : "left" }, children: m.timestamp })] }, m.id))), _jsx("div", { ref: messagesEndRef })] }), _jsxs("div", { style: {
                            padding: 12,
                            background: "rgba(30, 41, 59, 0.8)",
                            borderTop: "1px solid rgba(255,255,255,0.08)",
                            display: "flex",
                            gap: 8,
                        }, children: [_jsx("input", { type: "text", value: input, disabled: isStreaming, onChange: (e) => setInput(e.target.value), onKeyDown: (e) => {
                                    if (e.key === "Enter")
                                        void handleSendMessage();
                                }, placeholder: "Ask, teach ('Remember: Dealer 8197 cancelled'), or dispatch to Slack...", style: {
                                    flex: 1,
                                    background: "#090d16",
                                    border: "1px solid rgba(255,255,255,0.15)",
                                    borderRadius: 8,
                                    padding: "8px 12px",
                                    color: "#fff",
                                    fontSize: 12,
                                    outline: "none",
                                } }), _jsx("button", { type: "button", disabled: isStreaming || !input.trim(), onClick: () => void handleSendMessage(), style: {
                                    padding: "8px 14px",
                                    background: "#0284c7",
                                    border: "none",
                                    borderRadius: 8,
                                    color: "#fff",
                                    fontWeight: 700,
                                    fontSize: 12,
                                    cursor: "pointer",
                                }, children: isStreaming ? "..." : "Send" })] })] })), activeTab === "memory" && (_jsxs("div", { style: { flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsxs("div", { children: [_jsx("div", { style: { fontSize: 13, fontWeight: 800, color: "#f8fafc" }, children: "Persistent Knowledge Store" }), _jsx("div", { style: { fontSize: 11, color: "#94a3b8" }, children: "Edits automatically save to local storage after 100ms." })] }), _jsxs("div", { style: { display: "flex", gap: 6 }, children: [_jsx("button", { type: "button", onClick: () => handleAddRuleDirect("New rule description here..."), style: {
                                            background: "rgba(74, 222, 128, 0.15)",
                                            border: "1px solid rgba(74, 222, 128, 0.3)",
                                            color: "#4ade80",
                                            fontSize: 11,
                                            fontWeight: 700,
                                            padding: "4px 8px",
                                            borderRadius: 6,
                                            cursor: "pointer",
                                        }, children: "+ Add Rule" }), _jsx("button", { type: "button", onClick: handleExportMemoryJson, style: {
                                            background: "rgba(56, 189, 248, 0.15)",
                                            border: "1px solid rgba(56, 189, 248, 0.3)",
                                            color: "#38bdf8",
                                            fontSize: 11,
                                            fontWeight: 700,
                                            padding: "4px 8px",
                                            borderRadius: 6,
                                            cursor: "pointer",
                                        }, children: "\uD83D\uDCE5 Export" })] })] }), learnedRules.length === 0 ? (_jsxs("div", { style: { padding: 30, textAlign: "center", color: "#64748b", fontSize: 12 }, children: ["No rules learned yet. Type in chat:", _jsx("br", {}), _jsx("code", { style: { color: "#38bdf8" }, children: "Remember: Dealer 8197 is cancelled" })] })) : (learnedRules.map((r) => (_jsx(EditableMemoryItem, { rule: r, onUpdate: handleUpdateRule, onDelete: handleDeleteRule }, r.id))))] }))] }));
};
export default StoresAI;
