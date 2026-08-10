import React, { useEffect, useMemo, useRef, useState } from "react";

type RunState = "idle" | "loading" | "success" | "error" | "warning";

interface TGPTProps {
  onBack: () => void;
}

interface TGPTConversation {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
}

interface TGPTMessage {
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  timestamp: string;
  status?: string;
  messageId?: string;
}

interface GovernanceData {
  budget?: {
    daily_spent?: number;
    daily_remaining?: number;
    daily_limit?: number;
    daily_usage_pct?: number;
    status?: string;
    status_color?: string;
  };
  most_critical_rate_limit?: {
    current_messages?: number;
    max_messages?: number;
    model?: string;
  };
}

interface UploadedAttachment {
  id?: string;
  filename?: string;
  stored_filename?: string;
  content_type?: string;
  size?: number;
  url?: string;
  name?: string;
  type?: string;
}

const TGPT_TOKEN_KEY = "tgpt_access_token";
const TGPT_USER_ID_KEY = "tgpt_user_id";
const TGPT_MODEL_KEY = "tgpt_selected_model";
const TGPT_RAIL_OPEN_KEY = "tgpt_rail_open";

const TGPT_BASE = "https://tapapi.tekioncloud.com/tapapi/tgpt";

const logger = {
  debug: (...args: unknown[]) => console.debug("[TGPT]", ...args),
  info: (...args: unknown[]) => console.info("[TGPT]", ...args),
  warn: (...args: unknown[]) => console.warn("[TGPT]", ...args),
  error: (...args: unknown[]) => console.error("[TGPT]", ...args),
};

const AVAILABLE_MODELS = [
  { id: "gpt-5.4", name: "GPT-5.4", provider: "OpenAI" },
  { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", provider: "OpenAI" },
  { id: "gpt-5", name: "GPT-5", provider: "OpenAI" },
  { id: "gpt-4o-search-preview", name: "GPT-4o Search Preview", provider: "OpenAI" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "Anthropic" },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", provider: "Anthropic" },
  { id: "global.anthropic.claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Global)", provider: "Anthropic" },
  { id: "global.anthropic.claude-opus-4-6-v1", name: "Claude Opus 4.6", provider: "Anthropic" },
  { id: "us.anthropic.claude-sonnet-4-20250514-v1:0", name: "Claude Sonnet 4 (US)", provider: "Anthropic" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", provider: "Google" },
  { id: "gemini-3-pro-preview", name: "Gemini 3 Pro", provider: "Google" },
  { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", provider: "Google" },
  { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", provider: "Google" },
  { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "Google" },
] as const;

function formatDate(dateString?: string): string {
  if (!dateString) return "Unknown";
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatFileSize(bytes?: number): string {
  const size = bytes ?? 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType?: string): string {
  const type = String(mimeType ?? "").toLowerCase();
  if (type.includes("image")) return "🖼️";
  if (type.includes("pdf")) return "📄";
  if (type.includes("text")) return "📝";
  if (type.includes("json")) return "{ }";
  if (type.includes("csv")) return "📊";
  if (type.includes("word") || type.includes("document")) return "📝";
  return "📎";
}

function groupModels() {
  const grouped: Record<string, Array<(typeof AVAILABLE_MODELS)[number]>> = {};
  for (const model of AVAILABLE_MODELS) {
    if (!grouped[model.provider]) grouped[model.provider] = [];
    grouped[model.provider].push(model);
  }
  return grouped;
}

export const TGPT: React.FC<TGPTProps> = ({ onBack }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready");
  const [errorText, setErrorText] = useState("");

  const [accessToken, setAccessToken] = useState("");
  const [draftToken, setDraftToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [userId, setUserId] = useState("");

  const [selectedModel, setSelectedModel] = useState("gpt-5.4");
  const [railOpen, setRailOpen] = useState(true);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationHistory, setConversationHistory] = useState<TGPTMessage[]>([]);
  const [conversationsList, setConversationsList] = useState<TGPTConversation[]>([]);

  const [messageInput, setMessageInput] = useState("");
  const [currentAttachment, setCurrentAttachment] = useState<UploadedAttachment | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copiedCodeIndex, setCopiedCodeIndex] = useState<string | null>(null);

  const [governanceData, setGovernanceData] = useState<GovernanceData | null>(null);

  const [thinkingMode, setThinkingMode] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [codeExecution, setCodeExecution] = useState(false);
  const [artifacts, setArtifacts] = useState(false);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isDeletingMemories, setIsDeletingMemories] = useState(false);

  useEffect(() => {
    logger.info("component mounted");
    const savedToken = localStorage.getItem(TGPT_TOKEN_KEY) ?? "";
    const savedUserId = localStorage.getItem(TGPT_USER_ID_KEY) ?? "";
    const savedModel = localStorage.getItem(TGPT_MODEL_KEY) ?? "gpt-5.4";
    const savedRail = localStorage.getItem(TGPT_RAIL_OPEN_KEY);

    setAccessToken(savedToken);
    setDraftToken(savedToken);
    setUserId(savedUserId);
    setSelectedModel(savedModel);
    setRailOpen(savedRail !== "false");
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationHistory]);

  useEffect(() => {
    if (!accessToken) return;
    void fetchConversations();
    if (userId) {
      void fetchGovernanceData(userId);
    }
  }, [accessToken, userId]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [messageInput]);

  const groupedModels = useMemo(() => groupModels(), []);
  const canSend = Boolean(accessToken && conversationId && messageInput.trim()) && !isSending;

  const governanceSummary = useMemo(() => {
    if (!governanceData) return null;
    const budget = governanceData.budget ?? {};
    const critical = governanceData.most_critical_rate_limit ?? {};
    return {
      dailySpent: budget.daily_spent ?? 0,
      dailyRemaining: budget.daily_remaining ?? 0,
      dailyLimit: budget.daily_limit ?? 0,
      dailyUsagePct: budget.daily_usage_pct ?? 0,
      status: budget.status ?? "unknown",
      statusColor: budget.status_color ?? "gray",
      currentMessages: critical.current_messages ?? 0,
      maxMessages: critical.max_messages ?? 0,
      model: critical.model ?? "N/A",
    };
  }, [governanceData]);

  function extractUserIdFromToken(token: string): string {
    try {
      const parts = token.split(".");
      if (parts.length < 2) return "";
      const payload = JSON.parse(atob(parts[1]));
      return String(payload.sub || payload.user_id || payload.userId || payload.uid || payload.id || payload.account_id || "");
    } catch (error) {
      return "";
    }
  }

  async function saveToken(): Promise<void> {
    const token = draftToken.trim();
    if (!token) {
      setRunState("error"); setStatusText("Token is required"); setErrorText("Please enter a TGPT access token.");
      return;
    }
    const extractedUserId = extractUserIdFromToken(token);
    localStorage.setItem(TGPT_TOKEN_KEY, token);
    if (extractedUserId) localStorage.setItem(TGPT_USER_ID_KEY, extractedUserId);

    setAccessToken(token);
    setUserId(extractedUserId);
    setRunState("success"); setStatusText("TGPT token saved successfully"); setErrorText("");

    await fetchConversations();
    if (extractedUserId) await fetchGovernanceData(extractedUserId);
  }

  async function fetchGovernanceData(uid: string): Promise<void> {
    if (!accessToken || !uid) return;
    try {
      const response = await fetch(`${TGPT_BASE}/governance/status/${uid}`, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      setGovernanceData(await response.json());
    } catch (error) {
      logger.error(`Governance error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function fetchConversations(): Promise<void> {
    if (!accessToken) return;
    try {
      const response = await fetch(`${TGPT_BASE}/conversations?skip=0&limit=50`, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const data = await response.json();
      const rawConversations = data.conversations || data.data || data || [];
      const normalized: TGPTConversation[] = rawConversations.map((conv: any) => ({
        id: conv._id || conv.id,
        title: conv.title || conv.name || "Untitled Conversation",
        createdAt: conv.created_at || conv.createdAt,
        updatedAt: conv.updated_at || conv.updatedAt,
        messageCount: conv.message_count || conv.messageCount || 0,
      }));

      setConversationsList(normalized);

      if (!userId && rawConversations.length > 0 && rawConversations[0]?.user_id) {
        const extracted = String(rawConversations[0].user_id);
        setUserId(extracted);
        localStorage.setItem(TGPT_USER_ID_KEY, extracted);
        await fetchGovernanceData(extracted);
      }
    } catch (error) {
      setRunState("warning"); setStatusText("Failed to fetch conversations"); setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  async function createNewConversation(): Promise<void> {
    if (!accessToken) {
      setRunState("error"); setStatusText("Token required"); setErrorText("Please configure your TGPT token first.");
      return;
    }
    setIsCreatingConversation(true); setRunState("loading"); setStatusText("Creating new conversation...");
    try {
      const response = await fetch(`${TGPT_BASE}/conversations`, {
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          origin: "https://tap.tekioncloud.com",
        },
        body: JSON.stringify({
          model: selectedModel,
          title: `ARC Chat - ${new Date().toLocaleString()}`,
          is_temporary: false,
          thinking: false,
          mcp_servers: ["TOC MCP"],
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

      const data = await response.json();
      setConversationId(String(data.id));
      setConversationHistory([]);
      setRunState("success"); setStatusText("New conversation created"); setErrorText("");
      await fetchConversations();
    } catch (error) {
      setRunState("error"); setStatusText("Failed to create conversation"); setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCreatingConversation(false);
    }
  }

  async function loadConversation(conv: TGPTConversation): Promise<void> {
    if (!accessToken) return;
    try {
      setRunState("loading"); setStatusText(`Loading: ${conv.title}`); setConversationId(conv.id);
      const response = await fetch(`${TGPT_BASE}/conversations/${conv.id}/messages?skip=0&limit=100`, {
        method: "GET", headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

      const data = await response.json();
      const messages = data.messages || [];
      const mapped: TGPTMessage[] = messages
        .map((msg: any) => ({
          role: msg.role,
          content: msg.content || "",
          thinking: msg.thinking || "",
          messageId: msg._id,
          status: "complete",
          timestamp: msg.created_at || new Date().toLocaleTimeString(),
        }))
        .reverse();

      setConversationHistory(mapped);
      setRunState("success"); setStatusText(`Loaded conversation`);
    } catch (error) {
      setRunState("error"); setStatusText("Failed to load conversation"); setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleFileSelection(file: File): Promise<void> {
    if (!conversationId) return;
    if (file.size > 10 * 1024 * 1024) { setRunState("error"); setStatusText("File too large (Max 10MB)"); return; }

    try {
      setRunState("loading"); setStatusText(`Uploading ${file.name}...`);
      const formData = new FormData();
      formData.append("files", file);
      formData.append("model_provider", "openai");
      formData.append("conversation_id", conversationId);

      const response = await fetch(`${TGPT_BASE}/files/upload`, {
        method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: formData,
      });

      if (!response.ok) throw new Error(`Upload failed: HTTP ${response.status} - ${await response.text()}`);
      const uploadedFiles = await response.json();
      if (!uploadedFiles || uploadedFiles.length === 0) throw new Error("No uploaded file metadata returned");

      const uploadedFile = uploadedFiles[0];
      setCurrentAttachment({
        id: uploadedFile.id, filename: uploadedFile.filename, stored_filename: uploadedFile.stored_filename,
        content_type: uploadedFile.content_type, size: file.size, url: uploadedFile.url, name: file.name, type: file.type,
      });
      setRunState("success"); setStatusText(`Attached ${file.name}`);
    } catch (error) {
      setRunState("error"); setStatusText("Failed to upload attachment"); setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  async function sendMessage(): Promise<void> {
    if (!conversationId || !accessToken) return;
    const message = messageInput.trim();
    if (!message) return;

    const userMessage: TGPTMessage = { role: "user", content: message, timestamp: new Date().toLocaleTimeString() };
    const assistantIndex = conversationHistory.length + 1;

    setConversationHistory((prev) => [
      ...prev, userMessage,
      { role: "assistant", content: "", thinking: "", timestamp: new Date().toLocaleTimeString(), status: "analyzing" },
    ]);

    setMessageInput(""); setIsSending(true); setRunState("loading"); setStatusText("Sending message...");

    try {
      const payload = {
        content: message,
        attachments: currentAttachment ? [{ id: currentAttachment.id, filename: currentAttachment.filename, content_type: currentAttachment.content_type, size: currentAttachment.size, url: currentAttachment.url }] : [],
        thinking: thinkingMode, skill_id: null, selected_mcp_servers: ["TOC MCP"], web_search_enabled: webSearch, code_execution_enabled: codeExecution, artifacts_enabled: artifacts, is_temporary: false, mentions: [],
        v_previous_msg_id: conversationHistory.length > 0 ? conversationHistory[conversationHistory.length - 1]?.messageId ?? null : null,
        browser_datetime: new Date().toISOString(), browser_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };

      const response = await fetch(`${TGPT_BASE}/conversations/${conversationId}/messages/stream`, {
        method: "POST", headers: { accept: "*/*", authorization: `Bearer ${accessToken}`, "content-type": "application/json", origin: "https://tap.tekioncloud.com" },
        body: JSON.stringify(payload),
      });

      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", thinkingContent = "", assistantContent = "", currentStatus = "analyzing", assistantMessageId = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim() || !line.startsWith("data: ")) continue;
          try {
            const data = JSON.parse(line.substring(6));
            switch (data.type) {
              case "status": currentStatus = data.status || data.message || currentStatus; break;
              case "thinking_delta": thinkingContent += data.delta || ""; break;
              case "thinking_complete": currentStatus = "responding"; break;
              case "content_delta": assistantContent += data.delta || ""; break;
              case "assistant_message": assistantMessageId = data.message_id || assistantMessageId; break;
              case "done": currentStatus = "complete"; break;
            }

            setConversationHistory((prev) => {
              const next = [...prev];
              if (next[assistantIndex]) {
                next[assistantIndex] = { ...next[assistantIndex], content: assistantContent, thinking: thinkingContent, status: currentStatus, messageId: assistantMessageId || next[assistantIndex].messageId };
              }
              return next;
            });
          } catch (error) { logger.warn(`PARSE_ERROR: ${String(error)}`); }
        }
      }

      setRunState("success"); setStatusText("Message completed");
      if (currentAttachment) setCurrentAttachment(null);
      if (userId) await fetchGovernanceData(userId);
      await fetchConversations();
    } catch (error) {
      setRunState("error"); setStatusText("Failed to send message"); setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSending(false);
    }
  }

  async function deleteAllMemories(): Promise<void> {
    if (!accessToken) return;
    if (!window.confirm("⚠️ Are you sure you want to delete ALL TGPT memories? This cannot be undone.")) return;
    setIsDeletingMemories(true); setRunState("loading"); setStatusText("Deleting memories...");
    try {
      const response = await fetch(`${TGPT_BASE}/memories?active_only=false&include_global=true`, { method: "GET", headers: { accept: "application/json", authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error(`Failed to fetch memories: ${response.status}`);
      const memories = (await response.json()).memories || [];

      let deleted = 0, failed = 0;
      for (const memory of memories) {
        if (!memory.id && !memory._id) { failed++; continue; }
        try {
          const res = await fetch(`${TGPT_BASE}/memories/${memory.id || memory._id}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } });
          res.ok ? deleted++ : failed++;
        } catch { failed++; }
      }
      setRunState(failed === 0 ? "success" : "warning");
      setStatusText(failed === 0 ? `Deleted all ${deleted} memories` : `Deleted ${deleted}, ${failed} failed`);
    } catch (error) {
      setRunState("error"); setStatusText("Failed to delete memories"); setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDeletingMemories(false);
    }
  }

  const handleCopy = (content: string, messageId: string | number) => {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedMessageId(String(messageId));
      setTimeout(() => setCopiedMessageId(null), 2000);
    });
  };

  const handleCopyCode = (codeText: string, blockId: string) => {
    navigator.clipboard.writeText(codeText).then(() => {
      setCopiedCodeIndex(blockId);
      setTimeout(() => setCopiedCodeIndex(null), 2000);
    });
  };

  // Smart message parser to break paragraphs & format code blocks with individual copy buttons
  const renderMessageContent = (content: string, messageId: string | number) => {
    if (!content) return null;
    const parts = content.split(/(```[\s\S]*?```)/g);

    return parts.map((part: string, index: number) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        const codeContent = part.slice(3, -3);
        const firstNewline = codeContent.indexOf("\n");
        const lang = firstNewline > -1 ? codeContent.slice(0, firstNewline).trim() : "";
        const code = firstNewline > -1 ? codeContent.slice(firstNewline + 1) : codeContent;

        const blockId = `${messageId}-code-${index}`;
        const isCodeCopied = copiedCodeIndex === blockId;

        return (
          <div
            key={index}
            style={{
              margin: "16px 0",
              borderRadius: 8,
              overflow: "hidden",
              border: "1px solid rgba(255,255,255,0.1)",
              background: "#1e1e24"
            }}
          >
            {/* Code Block Header (Language Tag + Dedicated Copy Button) */}
            <div
              style={{
                background: "#2b2b36",
                padding: "8px 14px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                borderBottom: "1px solid rgba(255,255,255,0.05)"
              }}
            >
              <span style={{ fontSize: 11, color: "#a6accd", textTransform: "uppercase", fontWeight: 700, letterSpacing: 0.5 }}>
                {lang || "code"}
              </span>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyCode(code, blockId);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: isCodeCopied ? "#10b981" : "#94a3b8",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 12,
                  fontWeight: 600,
                  padding: 0
                }}
              >
                {isCodeCopied ? (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                    </svg>
                    Copy Code
                  </>
                )}
              </button>
            </div>

            {/* Code Snippet Body */}
            <pre style={{ margin: 0, padding: 14, overflowX: "auto", fontSize: 13, color: "#e2e8f0", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", lineHeight: 1.5 }}>
              {code}
            </pre>
          </div>
        );
      }

      const paragraphs = part.split(/\n\n+/g);
      return (
        <div key={index}>
          {paragraphs.map((p: string, i: number) => (
            <div key={i} style={{ marginBottom: i < paragraphs.length - 1 ? 16 : 0, whiteSpace: "pre-wrap", lineHeight: 1.6, wordBreak: "break-word" }}>
              {p}
            </div>
          ))}
        </div>
      );
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0f1115", color: "#f8fafc", fontFamily: "system-ui, -apple-system, sans-serif" }}>

      {/* Top Header */}
      <header style={{ height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px", borderBottom: "1px solid rgba(255,255,255,0.08)", background: "#16181d" }}>
        <button onClick={onBack} style={iconButtonStyle} title="Back to Home">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 15 }}>
          <span>🤖</span> TGPT Workspace
        </div>

        <button onClick={() => setRailOpen(r => { localStorage.setItem(TGPT_RAIL_OPEN_KEY, String(!r)); return !r; })} style={{...iconButtonStyle, background: railOpen ? "rgba(255,255,255,0.1)" : "transparent"}} title="Toggle Sidebar">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/></svg>
        </button>
      </header>

      {/* Main Content Layout */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

        {/* Center Chat Area */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative", minWidth: 0 }}>

          {!accessToken ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
              <div style={{ maxWidth: 400, width: "100%", background: "#16181d", padding: 32, borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)", textAlign: "center" }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>🔑</div>
                <h2 style={{ margin: "0 0 8px 0", fontSize: 20 }}>Welcome to TGPT</h2>
                <p style={{ color: "#94a3b8", fontSize: 14, marginBottom: 24, lineHeight: 1.5 }}>Please enter your access token to start chatting.</p>
                <input type={showToken ? "text" : "password"} value={draftToken} onChange={(e) => setDraftToken(e.target.value)} placeholder="TGPT Access Token" style={{...inputStyle, marginBottom: 12, textAlign: "center" }} />
                <button onClick={saveToken} style={{ ...primaryButtonStyle, width: "100%" }}>Save & Continue</button>
              </div>
            </div>
          ) : (
            <>
              {/* Chat Feed */}
              <div style={{ flex: 1, overflowY: "auto", padding: "24px 20px 100px", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ width: "100%", maxWidth: 800, display: "flex", flexDirection: "column", gap: 24 }}>

                  {conversationHistory.length === 0 ? (
                    <div style={{ textAlign: "center", color: "#94a3b8", padding: "60px 0" }}>
                      <div style={{ fontSize: 48, marginBottom: 16 }}>💬</div>
                      <h3 style={{ color: "#f8fafc", margin: "0 0 8px 0" }}>Start a new conversation</h3>
                      <p style={{ margin: 0, fontSize: 14 }}>Type a message below to begin.</p>
                    </div>
                  ) : (
                    conversationHistory.map((msg, index) => {
                      const isUser = msg.role === "user";
                      const msgId = msg.messageId || index;
                      const isCopied = copiedMessageId === String(msgId);

                      return (
                        <div key={msgId} style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", width: "100%" }}>
                          <div style={{
                            maxWidth: "85%",
                            padding: "20px 24px",
                            borderRadius: 16,
                            borderTopLeftRadius: !isUser ? 4 : 16,
                            borderTopRightRadius: isUser ? 4 : 16,
                            background: isUser ? "#2563eb" : "#1e2028",
                            border: isUser ? "none" : "1px solid rgba(255,255,255,0.05)",
                            color: isUser ? "#fff" : "#e2e8f0",
                            fontSize: 15,
                            position: "relative"
                          }}>

                            {/* Metadata / Thinking */}
                            {!isUser && msg.status && msg.status !== "complete" && (
                               <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                                 <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6", animation: "pulse 1.5s infinite" }} />
                                 {msg.status}...
                               </div>
                            )}

                            {!isUser && msg.thinking && (
                              <details style={{ marginBottom: 16, borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)", padding: "12px 16px", fontSize: 13, color: "#94a3b8" }}>
                                <summary style={{ cursor: "pointer", fontWeight: 600 }}>Thinking Process</summary>
                                <div style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{msg.thinking}</div>
                              </details>
                            )}

                            {/* Content */}
                            <div style={{ width: "100%" }}>
                              {renderMessageContent(msg.content, msgId)}
                            </div>

                            {/* Main message copy button */}
                            {!isUser && (
                              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                                <button
                                  onClick={() => handleCopy(msg.content, msgId)}
                                  style={{
                                    background: isCopied ? "rgba(16, 185, 129, 0.1)" : "rgba(255,255,255,0.05)",
                                    border: isCopied ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid rgba(255,255,255,0.1)",
                                    color: isCopied ? "#10b981" : "#94a3b8",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    fontSize: 12,
                                    padding: "6px 12px",
                                    borderRadius: 6,
                                    fontWeight: 600,
                                    transition: "0.2s all"
                                  }}
                                >
                                  {isCopied ? (
                                    <>
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <polyline points="20 6 9 17 4 12"/>
                                      </svg>
                                      Copied!
                                    </>
                                  ) : (
                                    <>
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>
                                        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>
                                      </svg>
                                      Copy
                                    </>
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} style={{ height: 1 }} />
                </div>
              </div>

              {/* Input Area */}
              <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(to top, #0f1115 70%, transparent)", padding: "0 20px 24px", display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ width: "100%", maxWidth: 800 }}>

                  {/* Collapsed feature chips just above input */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, padding: "0 4px" }}>
                    <ToggleChip label="🧠 Think" checked={thinkingMode} onChange={setThinkingMode} />
                    <ToggleChip label="🌐 Search" checked={webSearch} onChange={setWebSearch} />
                    <ToggleChip label="⚙️ Code" checked={codeExecution} onChange={setCodeExecution} />
                    <ToggleChip label="📄 Artifacts" checked={artifacts} onChange={setArtifacts} />
                  </div>

                  {/* Attachment Preview */}
                  {currentAttachment && (
                    <div style={{ marginBottom: 8, padding: "8px 12px", background: "#1e2028", borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}>
                        <span style={{ fontSize: 18 }}>{getFileIcon(currentAttachment.content_type)}</span>
                        <span>{currentAttachment.name || "Attachment"} <span style={{ color: "#64748b" }}>({formatFileSize(currentAttachment.size)})</span></span>
                      </div>
                      <button onClick={() => setCurrentAttachment(null)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 18 }}>×</button>
                    </div>
                  )}

                  {/* Sleek Text Input */}
                  <div style={{ display: "flex", alignItems: "flex-end", background: "#16181d", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 24, padding: "8px 8px 8px 16px", boxShadow: "0 10px 15px -3px rgba(0,0,0,0.3)" }}>
                    <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) void handleFileSelection(e.target.files[0]); }} />

                    <button type="button" disabled={!conversationId || isSending} onClick={() => fileInputRef.current?.click()} style={{ ...iconButtonStyle, marginBottom: 4, marginRight: 8 }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                    </button>

                    <textarea
                      ref={textareaRef}
                      value={messageInput}
                      onChange={(e) => setMessageInput(e.target.value)}
                      placeholder={conversationId ? "Message TGPT..." : "Select or create a conversation first"}
                      disabled={!conversationId || isSending}
                      rows={1}
                      style={{ flex: 1, background: "transparent", border: "none", color: "#fff", fontSize: 15, resize: "none", outline: "none", padding: "10px 0", maxHeight: 200, fontFamily: "inherit" }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          if (canSend) void sendMessage();
                        }
                      }}
                    />

                    <button
                      type="button"
                      disabled={!canSend}
                      onClick={() => void sendMessage()}
                      style={{
                        background: canSend ? "#f8fafc" : "rgba(255,255,255,0.1)",
                        color: canSend ? "#000" : "#64748b",
                        border: "none", borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: canSend ? "pointer" : "not-allowed", marginLeft: 8, marginBottom: 4, transition: "0.2s"
                      }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                    </button>
                  </div>
                  <div style={{ textAlign: "center", fontSize: 11, color: "#64748b", marginTop: 8 }}>
                    TGPT can make mistakes. Consider verifying important information.
                  </div>
                </div>
              </div>
            </>
          )}
        </main>

        {/* Right Sidebar */}
        {railOpen && (
          <aside style={{ width: 320, background: "#16181d", borderLeft: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 24 }}>

              {/* Actions */}
              <button className="btn-postman" onClick={createNewConversation} disabled={!accessToken || isCreatingConversation} style={primaryButtonStyle}>
                {isCreatingConversation ? "Creating..." : "+ New Chat"}
              </button>

              {/* Status / Errors */}
              {(runState === "error" || runState === "warning") && (
                <div style={{ padding: 12, borderRadius: 8, fontSize: 13, background: runState === "error" ? "rgba(239,68,68,0.1)" : "rgba(245,158,11,0.1)", color: runState === "error" ? "#fca5a5" : "#fde68a", border: `1px solid ${runState === "error" ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)"}` }}>
                  <strong>{statusText}</strong>
                  {errorText && <div style={{ marginTop: 4 }}>{errorText}</div>}
                </div>
              )}

              {/* Model Select */}
              <div>
                <div style={labelStyle}>Model</div>
                <select value={selectedModel} onChange={(e) => { setSelectedModel(e.target.value); localStorage.setItem(TGPT_MODEL_KEY, e.target.value); }} style={inputStyle}>
                  {Object.entries(groupedModels).map(([provider, models]) => (
                    <optgroup key={provider} label={provider}>
                      {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* History */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <div style={labelStyle}>Recent Chats</div>
                  <button onClick={fetchConversations} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 12 }}>Refresh</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto", paddingRight: 4 }}>
                  {conversationsList.length === 0 ? (
                    <div style={{ fontSize: 13, color: "#64748b" }}>No conversations found.</div>
                  ) : (
                    conversationsList.map((conv) => (
                      <button key={conv.id} onClick={() => loadConversation(conv)} style={{ ...historyItemStyle, background: conv.id === conversationId ? "rgba(59,130,246,0.15)" : "transparent", border: conv.id === conversationId ? "1px solid rgba(59,130,246,0.3)" : "1px solid transparent" }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: conv.id === conversationId ? "#fff" : "#cbd5e1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textAlign: "left" }}>
                          {conv.title}
                        </div>
                        <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, textAlign: "left" }}>
                          {formatDate(conv.updatedAt || conv.createdAt)}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>

              {/* Governance */}
              {governanceSummary && (
                <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 12, padding: 16, border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ ...labelStyle, marginBottom: 12 }}>Governance</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>Daily Spent</div>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{governanceSummary.dailySpent.toFixed(2)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: "#64748b" }}>Remaining</div>
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{governanceSummary.dailyRemaining.toFixed(2)}</div>
                    </div>
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginBottom: 6 }}>
                      <span>Usage ({governanceSummary.dailyUsagePct.toFixed(1)}%)</span>
                      <span>{governanceSummary.status}</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${governanceSummary.dailyUsagePct}%`, background: governanceSummary.statusColor === "green" ? "#10b981" : governanceSummary.statusColor === "yellow" ? "#f59e0b" : "#ef4444" }} />
                    </div>
                  </div>
                </div>
              )}

              {/* Advanced Utilities */}
              <div style={{ marginTop: "auto", paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                <button onClick={() => setSettingsOpen(true)} style={{ ...secondaryButtonStyle, width: "100%", marginBottom: 8 }}>Manage Token Settings</button>
                <button onClick={deleteAllMemories} disabled={!accessToken || isDeletingMemories} style={{ ...secondaryButtonStyle, width: "100%", color: "#ef4444" }}>
                  {isDeletingMemories ? "Deleting..." : "Delete AI Memories"}
                </button>
              </div>

            </div>
          </aside>
        )}
      </div>

      {/* Settings Modal Layer */}
      {settingsOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", justifyContent: "center", alignItems: "center", background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
          <div style={{ width: 400, background: "#16181d", borderRadius: 16, border: "1px solid rgba(255,255,255,0.1)", padding: 24, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ fontSize: 18, fontWeight: 600 }}>Settings</div>
              <button onClick={() => setSettingsOpen(false)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 20 }}>×</button>
            </div>

            <div style={labelStyle}>Update Token</div>
            <input type={showToken ? "text" : "password"} value={draftToken} onChange={(e) => setDraftToken(e.target.value)} style={{ ...inputStyle, marginBottom: 16 }} />
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setShowToken(!showToken)} style={{ ...secondaryButtonStyle, flex: 1 }}>{showToken ? "Hide" : "Show"}</button>
              <button onClick={() => { saveToken(); setSettingsOpen(false); }} style={{ ...primaryButtonStyle, flex: 2 }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Reusable Styles ---

const primaryButtonStyle: React.CSSProperties = {
  background: "#f8fafc", color: "#000", border: "none", padding: "10px 16px", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", transition: "0.2s"
};

const secondaryButtonStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)", color: "#e2e8f0", border: "1px solid rgba(255,255,255,0.1)", padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", transition: "0.2s"
};

const iconButtonStyle: React.CSSProperties = {
  background: "transparent", border: "none", color: "#94a3b8", width: 36, height: 36, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "0.2s"
};

const labelStyle: React.CSSProperties = {
  color: "#94a3b8", fontSize: 12, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.2)", color: "#fff", fontSize: 14, outline: "none", boxSizing: "border-box"
};

const historyItemStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 8, cursor: "pointer", transition: "0.2s"
};

const ToggleChip: React.FC<{ label: string; checked: boolean; onChange: (value: boolean) => void }> = ({ label, checked, onChange }) => (
  <button type="button" onClick={() => onChange(!checked)} style={{
    padding: "4px 10px", borderRadius: 16, fontSize: 12, fontWeight: 500, cursor: "pointer", border: checked ? "1px solid rgba(59,130,246,0.4)" : "1px solid rgba(255,255,255,0.1)", background: checked ? "rgba(59,130,246,0.1)" : "rgba(255,255,255,0.03)", color: checked ? "#60a5fa" : "#94a3b8", transition: "0.2s"
  }}>
    {label}
  </button>
);