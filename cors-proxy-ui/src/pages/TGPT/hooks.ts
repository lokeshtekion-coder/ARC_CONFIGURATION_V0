import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { TGPT_TOKEN_KEY, TGPT_USER_ID_KEY, TGPT_BASE } from "./constants";
import { extractUserIdFromToken, logger } from "./utils";
import { GovernanceData, RawConversation, RawMessage, RunState, TGPTConversation, TGPTMessage, UploadedAttachment } from "./types";

export function useTGPTAuth() {
  const [accessToken, setAccessToken] = useState("");
  const [userId, setUserId] = useState("");

  useEffect(() => {
    setAccessToken(localStorage.getItem(TGPT_TOKEN_KEY) ?? "");
    setUserId(localStorage.getItem(TGPT_USER_ID_KEY) ?? "");
  }, []);

  const saveToken = useCallback((token: string) => {
    const cleaned = token.trim();
    if (!cleaned) throw new Error("Token is required");
    const extractedUserId = extractUserIdFromToken(cleaned);
    localStorage.setItem(TGPT_TOKEN_KEY, cleaned);
    if (extractedUserId) localStorage.setItem(TGPT_USER_ID_KEY, extractedUserId);
    setAccessToken(cleaned);
    setUserId(extractedUserId);
    return extractedUserId;
  }, []);

  return { accessToken, userId, saveToken };
}

export function useGovernance(accessToken: string, userId: string) {
  const [governanceData, setGovernanceData] = useState<GovernanceData | null>(null);

  const fetchGovernanceData = useCallback(async (uid: string = userId) => {
    if (!accessToken || !uid) return;
    try {
      const response = await fetch(`${TGPT_BASE}/governance/status/${uid}`, {
        method: "GET", headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      });
      if (response.ok) setGovernanceData(await response.json() as GovernanceData);
    } catch {
      // Silently fail
    }
  }, [accessToken, userId]);

  useEffect(() => {
    if (accessToken && userId) void fetchGovernanceData();
  }, [accessToken, userId, fetchGovernanceData]);

  const governanceSummary = useMemo(() => {
    if (!governanceData) return null;
    const budget = governanceData.budget ?? {};
    return {
      dailySpent: budget.daily_spent ?? 0,
      dailyRemaining: budget.daily_remaining ?? 0,
      dailyUsagePct: budget.daily_usage_pct ?? 0,
      status: budget.status ?? "unknown",
      statusColor: budget.status_color ?? "gray",
    };
  }, [governanceData]);

  return { governanceSummary };
}

export function useTGPTChat(accessToken: string) {
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready");
  const [errorText, setErrorText] = useState("");

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationHistory, setConversationHistory] = useState<TGPTMessage[]>([]);
  const [conversationsList, setConversationsList] = useState<TGPTConversation[]>([]);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

  const fetchConversations = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await fetch(`${TGPT_BASE}/conversations?skip=0&limit=50`, {
        method: "GET", headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error();
      const data = await response.json() as { conversations?: RawConversation[], data?: RawConversation[] };
      const raw: RawConversation[] = data.conversations || data.data || [];

      setConversationsList(raw.map((conv) => ({
        id: conv._id || conv.id || "", title: conv.title || conv.name || "Untitled",
        createdAt: conv.created_at || conv.createdAt, updatedAt: conv.updated_at || conv.updatedAt,
      })));
    } catch {
      // Silently fail
    }
  }, [accessToken]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.BroadcastChannel) {
      const channel = new BroadcastChannel("tgpt_tab_sync");
      channel.onmessage = (event: MessageEvent<string>) => {
        if (event.data === "refresh_conversations") void fetchConversations();
      };
      broadcastChannelRef.current = channel;
      return () => channel.close();
    }
  }, [fetchConversations]);

  const notifyTabs = useCallback(() => broadcastChannelRef.current?.postMessage("refresh_conversations"), []);

  const createNewConversation = useCallback(async (modelId: string, initialMessage?: string) => {
    if (!accessToken) return null;
    abortControllerRef.current?.abort();

    setIsCreatingConversation(true);
    setRunState("loading"); setStatusText("Creating...");
    try {
      const response = await fetch(`${TGPT_BASE}/conversations`, {
        method: "POST",
        headers: { accept: "application/json", authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ model: modelId, title: initialMessage ? `Chat: ${initialMessage.substring(0, 30)}...` : `New Conversation`, is_temporary: false, thinking: false, mcp_servers: ["TOC MCP"] }),
      });
      if (!response.ok) throw new Error();
      const data = await response.json() as { id: string };

      setConversationId(String(data.id));
      setConversationHistory([]);
      setRunState("success"); setStatusText("Ready");
      void fetchConversations();
      notifyTabs();
      return String(data.id);
    } catch {
      setRunState("error"); setStatusText("Failed to create chat");
      return null;
    } finally {
      setIsCreatingConversation(false);
    }
  }, [accessToken, fetchConversations, notifyTabs]);

  const loadConversation = useCallback(async (convId: string, title: string) => {
    if (!accessToken) return;
    abortControllerRef.current?.abort();
    setConversationId(convId);
    setRunState("loading"); setStatusText(`Loading: ${title}`);
    try {
      const response = await fetch(`${TGPT_BASE}/conversations/${convId}/messages?skip=0&limit=100`, {
        method: "GET", headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error();
      const data = await response.json() as { messages?: RawMessage[] };
      const mapped: TGPTMessage[] = (data.messages || []).map((msg) => ({
        role: msg.role, content: msg.content || "", thinking: msg.thinking || "", messageId: msg._id,
        status: "complete", timestamp: msg.created_at || new Date().toLocaleTimeString(),
      })).reverse();

      setConversationHistory(mapped);
      setRunState("success"); setStatusText("Loaded");
    } catch {
      setRunState("error"); setStatusText("Failed to load conversation");
    }
  }, [accessToken]);

  const sendMessage = useCallback(async (
    message: string,
    attachment: UploadedAttachment | null,
    options: { thinking: boolean, webSearch: boolean, codeExecution: boolean, artifacts: boolean },
    targetConvId: string | null = conversationId
  ) => {
    if (!targetConvId || !accessToken) return;

    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();
    const { signal } = abortControllerRef.current;

    const userMessage: TGPTMessage = { role: "user", content: message, timestamp: new Date().toLocaleTimeString() };
    const assistantIndex = conversationHistory.length + 1;

    setConversationHistory(prev => [
      ...prev, userMessage,
      { role: "assistant", content: "", thinking: "", timestamp: new Date().toLocaleTimeString(), status: "analyzing" },
    ]);

    setIsSending(true);
    setRunState("loading"); setStatusText("Sending...");

    try {
      const payload = {
        content: message,
        attachments: attachment ? [attachment] : [],
        thinking: options.thinking,
        web_search_enabled: options.webSearch, code_execution_enabled: options.codeExecution, artifacts_enabled: options.artifacts,
        v_previous_msg_id: conversationHistory.length > 0 ? conversationHistory[conversationHistory.length - 1]?.messageId ?? null : null,
      };

      const response = await fetch(`${TGPT_BASE}/conversations/${targetConvId}/messages/stream`, {
        method: "POST",
        headers: { accept: "*/*", authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });

      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let buffer = "", thinkingContent = "", assistantContent = "", currentStatus = "analyzing", assistantMessageId = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (!part.trim()) continue;
          const lines = part.split('\n');
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const rawData = line.substring(6).trim();
            if (rawData === "[DONE]") { currentStatus = "complete"; continue; }

            try {
              const data = JSON.parse(rawData) as Record<string, string>;
              switch (data.type) {
                case "status": currentStatus = data.status || currentStatus; break;
                case "thinking_delta": thinkingContent += data.delta || ""; break;
                case "thinking_complete": currentStatus = "responding"; break;
                case "content_delta": assistantContent += data.delta || ""; break;
                case "assistant_message": assistantMessageId = data.message_id || assistantMessageId; break;
                case "done": currentStatus = "complete"; break;
              }
            } catch { /* ignore */ }
          }
        }

        setConversationHistory((prev) => {
          const next = [...prev];
          if (next[assistantIndex]) {
            next[assistantIndex] = { ...next[assistantIndex], content: assistantContent, thinking: thinkingContent, status: currentStatus, messageId: assistantMessageId };
          }
          return next;
        });
      }
      setRunState("success"); setStatusText("Completed");
      void fetchConversations();
      notifyTabs();
    } catch (error: unknown) {
      if (error instanceof Error && error.name !== "AbortError") {
        setRunState("error"); setStatusText("Stream failed"); setErrorText(error.message);
        logger.error("Stream failed", error);
      }
    } finally {
      setIsSending(false);
    }
  }, [accessToken, conversationId, conversationHistory, fetchConversations, notifyTabs]);

  return {
    runState, setRunState, statusText, setStatusText, errorText, setErrorText,
    conversationId, conversationHistory, conversationsList, isCreatingConversation, isSending,
    fetchConversations, createNewConversation, loadConversation, sendMessage
  };
}