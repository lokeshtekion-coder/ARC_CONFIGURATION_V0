import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useDropzone, DropzoneOptions } from "react-dropzone";
import { ChevronLeft, Settings, PanelLeftClose, Send, Paperclip, X, UploadCloud, Sparkles, Square, Plus, RefreshCw } from "lucide-react";
import { UploadedAttachment, TGPTProps } from "./types";
import { TGPT_MODEL_KEY, TGPT_RAIL_OPEN_KEY, TGPT_BASE, STARTER_PROMPTS, GlobalStyles } from "./constants";
import { formatDate, formatFileSize, getFileIcon, groupModels } from "./utils";
import { useTGPTAuth, useGovernance, useTGPTChat } from "./hooks";
import { MessageBubble, MessageErrorBoundary } from "./components/MessageBubble";

const ToggleChip = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void; }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`
      inline-flex items-center justify-center
      px-2.5 py-[5px] rounded-full
      min-w-0 max-w-[200px] shrink-0
      transition-all duration-200 border outline-none
      ${
        checked
          ? "border-[#da7756]/50 bg-[#da7756]/15 text-[#da7756]"
          : "border-zinc-700/80 bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
      }
    `}
  >
    <span className="truncate text-[13px] font-medium leading-none tracking-wide">
      {label}
    </span>
  </button>
);

export const TGPT: React.FC<TGPTProps> = ({ onBack }) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const { accessToken, userId, saveToken } = useTGPTAuth();
  const { governanceSummary } = useGovernance(accessToken, userId);
  const {
    runState, setRunState, statusText, setStatusText, errorText, setErrorText,
    conversationId, conversationHistory, conversationsList,
    isCreatingConversation, isSending,
    fetchConversations, createNewConversation, loadConversation, sendMessage,
  } = useTGPTChat(accessToken);

  const [draftToken, setDraftToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [selectedModel, setSelectedModel] = useState("gpt-5.4");
  const [railOpen, setRailOpen] = useState(true);
  const [messageInput, setMessageInput] = useState("");
  const [currentAttachment, setCurrentAttachment] = useState<UploadedAttachment | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isDeletingMemories, setIsDeletingMemories] = useState(false);

  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copiedCodeIndex, setCopiedCodeIndex] = useState<string | null>(null);

  const [thinkingMode, setThinkingMode] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [codeExecution, setCodeExecution] = useState(false);
  const [artifacts, setArtifacts] = useState(false);

  useEffect(() => {
    setSelectedModel(localStorage.getItem(TGPT_MODEL_KEY) ?? "gpt-5.4");
    setRailOpen(localStorage.getItem(TGPT_RAIL_OPEN_KEY) !== "false");
  }, []);

  useEffect(() => { if (accessToken) setDraftToken(accessToken); }, [accessToken]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [conversationHistory]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [messageInput]);

  const groupedModels = useMemo(() => groupModels(), []);
  const canSend = Boolean(accessToken && messageInput.trim()) && !isSending;

  const handleSaveToken = () => {
    try {
      saveToken(draftToken);
      setRunState("success"); setStatusText("Token saved"); setErrorText("");
      setSettingsOpen(false);
    } catch (err: unknown) {
      setRunState("error"); setStatusText("Token error");
      setErrorText(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSendMessage = async (customMessage?: string) => {
    const textToSend = customMessage || messageInput;
    if (!textToSend.trim()) return;

    let targetConvId = conversationId;
    if (!targetConvId) {
      const newId = await createNewConversation(selectedModel, textToSend);
      if (!newId) return;
      targetConvId = newId;
    }

    void sendMessage(textToSend, currentAttachment, { thinking: thinkingMode, webSearch, codeExecution, artifacts }, targetConvId);
    if (!customMessage) setMessageInput("");
    setCurrentAttachment(null);
  };

  const processFile = async (file: File) => {
    if (!conversationId) return;
    if (file.size > 10 * 1024 * 1024) {
      setRunState("error"); setStatusText("File too large (Max 10MB)"); return;
    }

    try {
      setRunState("loading"); setStatusText(`Uploading ${file.name}...`);
      const formData = new FormData();
      formData.append("files", file); formData.append("model_provider", "openai"); formData.append("conversation_id", conversationId);
      const response = await fetch(`${TGPT_BASE}/files/upload`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: formData });
      if (!response.ok) throw new Error(`Upload failed`);
      const uploadedFiles = (await response.json()) as UploadedAttachment[];
      setCurrentAttachment({ ...uploadedFiles[0], size: file.size, name: file.name, type: file.type });
      setRunState("success"); setStatusText(`Attached ${file.name}`);
    } catch (error: unknown) {
      setRunState("error"); setStatusText("Failed to upload attachment");
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  };

  const handleFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // FIX: Typecast to 'unknown' first to bypass the broken react-dropzone library typings
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (acceptedFiles: File[]) => {
      if (acceptedFiles.length > 0 && conversationId && !isSending) {
        void processFile(acceptedFiles[0]);
      }
    },
    noClick: true,
    noKeyboard: true,
    multiple: false,
    disabled: !conversationId || isSending,
  } as unknown as DropzoneOptions);

  async function deleteAllMemories(): Promise<void> {
    if (!accessToken) return;
    if (!window.confirm("⚠️ Are you sure you want to delete ALL TGPT memories?")) return;
    setIsDeletingMemories(true); setRunState("loading"); setStatusText("Deleting memories...");
    try {
      const response = await fetch(`${TGPT_BASE}/memories?active_only=false&include_global=true`, { method: "GET", headers: { accept: "application/json", authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error(`Fetch failed`);
      const resData = (await response.json()) as { memories?: Array<{ id?: string; _id?: string }> };
      let deleted = 0; let failed = 0;
      for (const memory of resData.memories || []) {
        if (!memory.id && !memory._id) { failed++; continue; }
        try {
          const res = await fetch(`${TGPT_BASE}/memories/${memory.id || memory._id}`, { method: "DELETE", headers: { authorization: `Bearer ${accessToken}` } });
          res.ok ? deleted++ : failed++;
        } catch { failed++; }
      }
      setRunState(failed === 0 ? "success" : "warning"); setStatusText(failed === 0 ? `Deleted ${deleted}` : `${failed} failed`);
    } catch (error: unknown) {
      setRunState("error"); setStatusText("Failed to delete"); setErrorText(String(error));
    } finally {
      setIsDeletingMemories(false);
    }
  }

  const handleCopy = useCallback((content: string, messageId: string | number) => {
    navigator.clipboard.writeText(content).then(() => { setCopiedMessageId(String(messageId)); setTimeout(() => setCopiedMessageId(null), 2000); });
  }, []);

  const handleCopyCode = useCallback((codeText: string, blockId: string) => {
    navigator.clipboard.writeText(codeText).then(() => { setCopiedCodeIndex(blockId); setTimeout(() => setCopiedCodeIndex(null), 2000); });
  }, []);

  return (
    <div className="flex flex-col h-screen bg-[#18181b] text-zinc-100 font-sans selection:bg-[#da7756]/30">
      <GlobalStyles />

      <header className="h-[56px] shrink-0 flex items-center justify-between px-5 bg-[#18181b] border-b border-zinc-800/80 relative z-10">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 transition-colors">
          <ChevronLeft size={20} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-md bg-[#da7756]/20 border border-[#da7756]/40 flex items-center justify-center">
            <Sparkles size={12} className="text-[#da7756]" />
          </div>
          <span className="font-semibold text-sm text-zinc-200 tracking-tight">TGPT Workspace</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setSettingsOpen(true)} className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${settingsOpen ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800"}`}>
            <Settings size={18} />
          </button>
          <button onClick={() => setRailOpen(r => { localStorage.setItem(TGPT_RAIL_OPEN_KEY, String(!r)); return !r; })} className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${railOpen ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800"}`}>
            <PanelLeftClose size={18} />
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden relative">
        <main
          {...(getRootProps() as React.HTMLAttributes<HTMLElement>)}
          className="flex-1 flex flex-col relative min-w-0 outline-none bg-[#18181b]"
        >
          {isDragActive && (
            <div className="absolute inset-4 z-50 flex items-center justify-center bg-[#18181b]/90 backdrop-blur-sm border-2 border-dashed border-[#da7756] rounded-2xl transition-all">
              <div className="flex flex-col items-center gap-3">
                <UploadCloud size={48} className="text-[#da7756] animate-bounce" />
                <h3 className="text-xl font-medium text-zinc-200">Drop files to attach</h3>
              </div>
            </div>
          )}

          <input {...(getInputProps() as React.InputHTMLAttributes<HTMLInputElement>)} />

          {!accessToken ? (
            <div className="flex-1 flex items-center justify-center p-5 animate-in">
              <div className="max-w-md w-full p-8 rounded-2xl text-center bg-[#212126] border border-zinc-800 shadow-xl">
                <div className="w-12 h-12 bg-[#da7756]/15 rounded-xl flex items-center justify-center mx-auto mb-5 border border-[#da7756]/30">
                  <Sparkles size={24} className="text-[#da7756]" />
                </div>
                <h2 className="m-0 mb-2 text-xl font-bold text-zinc-100">Authentication Required</h2>
                <p className="text-zinc-400 text-xs mb-6 leading-relaxed">Provide your TGPT access token to connect to your models.</p>
                <input type={showToken ? "text" : "password"} value={draftToken} onChange={(e) => setDraftToken(e.target.value)} placeholder="Access Token" className="w-full border border-zinc-700 bg-zinc-900/60 text-zinc-100 text-sm outline-none px-4 py-3 rounded-xl mb-4 text-center focus:border-[#da7756] transition-colors" />
                <button onClick={handleSaveToken} className="w-full bg-[#da7756] text-white font-medium rounded-xl px-4 py-3 hover:bg-[#ea9072] transition-colors shadow-sm">Connect Session</button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto px-6 pt-8 flex flex-col items-center scroll-smooth">
                <div className="w-full max-w-[760px] flex flex-col gap-8 pb-4">
                  {(runState === "error" || runState === "warning" || runState === "loading") && (
                    <div className={`p-3.5 rounded-xl text-xs border ${runState === "error" ? "bg-red-500/10 border-red-500/20 text-red-300" : runState === "warning" ? "bg-amber-500/10 border-amber-500/20 text-amber-200" : "bg-zinc-800 border-zinc-700 text-zinc-300"}`}>
                      <div className="font-semibold">{statusText}</div>
                      {errorText && <div className="mt-1 opacity-80">{errorText}</div>}
                    </div>
                  )}

                  {conversationHistory.length === 0 && !isSending && (
                    <div className="animate-in flex flex-col items-center justify-center min-h-[50vh]">
                      <div className="w-12 h-12 rounded-2xl bg-[#da7756]/15 border border-[#da7756]/30 flex items-center justify-center mb-5">
                        <Sparkles size={24} className="text-[#da7756]" />
                      </div>
                      <h2 className="text-2xl font-semibold m-0 mb-2 tracking-tight text-zinc-100">How can I help you today?</h2>
                      <p className="text-zinc-400 text-sm m-0 mb-8">Type a prompt below or pick a starting prompt.</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-[640px]">
                        {STARTER_PROMPTS.map((starter, i) => (
                          <button key={i} onClick={() => void handleSendMessage(starter.prompt)} className="bg-[#212126] border border-zinc-800 p-4 rounded-xl text-left cursor-pointer transition-all hover:border-zinc-700 hover:bg-[#27272a] flex flex-col gap-2 group">
                            <span className="text-lg">{starter.icon}</span>
                            <div>
                              <div className="text-zinc-200 font-medium text-xs mb-0.5">{starter.title}</div>
                              <div className="text-zinc-400 text-[12px] leading-relaxed line-clamp-2">{starter.prompt}</div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {conversationHistory.map((msg, index) => (
                    <MessageErrorBoundary key={msg.messageId || index}>
                      <MessageBubble msg={msg} isUser={msg.role === "user"} msgId={msg.messageId || index} isCopied={copiedMessageId === String(msg.messageId || index)} onCopy={handleCopy} copiedCodeIndex={copiedCodeIndex} onCopyCode={handleCopyCode} />
                    </MessageErrorBoundary>
                  ))}
                  <div ref={messagesEndRef} className="h-4 shrink-0 w-full" />
                </div>
              </div>

              <div className="shrink-0 w-full px-4 pb-6 pt-3 flex flex-col items-center bg-[#18181b] border-t border-zinc-800/50">
                <div className="w-full max-w-[760px]">
                  <div className="flex gap-2 flex-wrap mb-3 px-1">
                    <ToggleChip label="🧠 Think" checked={thinkingMode} onChange={setThinkingMode} />
                    <ToggleChip label="🌐 Web" checked={webSearch} onChange={setWebSearch} />
                    <ToggleChip label="⚙️ Code" checked={codeExecution} onChange={setCodeExecution} />
                    <ToggleChip label="📄 Artifacts" checked={artifacts} onChange={setArtifacts} />
                  </div>

                  {currentAttachment && (
                    <div className="bg-[#212126] border border-zinc-700/80 mb-2.5 px-3.5 py-2 rounded-xl flex items-center justify-between">
                      <div className="flex gap-2.5 items-center text-xs text-zinc-300">
                        <span>{getFileIcon(currentAttachment.content_type)}</span>
                        <span className="font-medium truncate max-w-[300px]">{currentAttachment.name || "Attachment"}</span>
                        <span className="text-zinc-500">({formatFileSize(currentAttachment.size)})</span>
                      </div>
                      <button onClick={() => setCurrentAttachment(null)} className="text-zinc-400 hover:text-red-400 p-1 rounded-md transition-colors"><X size={14} /></button>
                    </div>
                  )}

                  <div className="bg-[#27272a] border border-zinc-700/80 focus-within:border-[#da7756]/80 rounded-[24px] p-2 shadow-lg transition-colors flex flex-col gap-1">
                    <textarea ref={textareaRef} value={messageInput} onChange={(e) => setMessageInput(e.target.value)} placeholder="Reply to TGPT..." disabled={isSending} rows={1} className="w-full bg-transparent border-none text-zinc-100 text-[15px] resize-none outline-none px-3 pt-2 pb-1 max-h-[180px] overflow-y-auto leading-relaxed placeholder-zinc-500 font-sans" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (canSend) void handleSendMessage(); } }} />
                    <div className="flex items-center justify-between pt-1 px-1">
                      <div className="flex items-center gap-1">
                        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelection} />
                        <button type="button" disabled={!conversationId || isSending} onClick={() => fileInputRef.current?.click()} className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50 transition-colors disabled:opacity-40" title="Attach file"><Paperclip size={18} /></button>
                      </div>
                      {isSending ? (
                        <button type="button" onClick={() => { setRunState("idle"); setStatusText("Stopped"); }} className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors" title="Stop generating"><Square size={12} className="fill-current" /></button>
                      ) : (
                        <button type="button" disabled={!canSend} onClick={() => void handleSendMessage()} className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${canSend ? "bg-[#da7756] text-white hover:bg-[#ea9072]" : "bg-zinc-800 text-zinc-600 cursor-not-allowed"}`}><Send size={14} className={canSend ? "translate-x-[1px]" : ""} /></button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </main>

        <aside className={`transition-all duration-300 ease-in-out bg-[#141416] border-l border-zinc-800/80 flex flex-col overflow-y-auto overflow-x-hidden z-[5] ${railOpen ? "w-[280px] opacity-100" : "w-0 opacity-0"}`}>
          <div className="w-[280px] p-4 flex flex-col gap-5 min-h-full">
            <button onClick={() => void createNewConversation(selectedModel)} disabled={!accessToken || isCreatingConversation} className="w-full bg-[#212126] border border-zinc-800 text-zinc-200 hover:bg-zinc-800 font-medium rounded-xl p-2.5 flex items-center justify-center gap-2 text-xs transition-colors disabled:opacity-50">
              <Plus size={15} className="text-[#da7756]" /> {isCreatingConversation ? "Creating..." : "New Chat"}
            </button>

            <div>
              <div className="text-zinc-500 text-[11px] font-semibold mb-2 uppercase tracking-wider">Model</div>
              <select value={selectedModel} onChange={(e) => { setSelectedModel(e.target.value); localStorage.setItem(TGPT_MODEL_KEY, e.target.value); }} className="w-full border border-zinc-800 bg-[#18181b] text-zinc-200 text-xs outline-none p-2.5 rounded-lg focus:border-[#da7756] transition-colors cursor-pointer">
                {Object.entries(groupedModels).map(([provider, models]) => (
                  <optgroup key={provider} label={provider}>
                    {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="flex-1 flex flex-col min-h-0">
              <div className="flex justify-between items-center mb-2">
                <div className="text-zinc-500 text-[11px] font-semibold uppercase tracking-wider">Recents</div>
                <button onClick={() => void fetchConversations()} className="text-zinc-500 hover:text-zinc-300 text-xs bg-transparent border-none cursor-pointer flex items-center gap-1"><RefreshCw size={11} /></button>
              </div>
              <div className="flex flex-col gap-1 overflow-y-auto pr-1 flex-1">
                {conversationsList.length === 0 ? <div className="text-xs text-zinc-500 py-2">No recent chats.</div> : conversationsList.map((conv) => (
                  <button key={conv.id} onClick={() => void loadConversation(conv.id, conv.title)} className={`w-full p-2.5 rounded-lg cursor-pointer transition-colors text-left flex flex-col gap-0.5 border ${conv.id === conversationId ? "bg-[#212126] border-zinc-700/80 text-zinc-100" : "bg-transparent border-transparent text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"}`}>
                    <div className="text-xs font-medium truncate">{conv.title}</div>
                    <div className="text-[10px] text-zinc-500">{formatDate(conv.updatedAt || conv.createdAt)}</div>
                  </button>
                ))}
              </div>
            </div>

            {governanceSummary && (
              <div className="bg-[#18181b] border border-zinc-800/80 rounded-xl p-3.5">
                <div className="text-zinc-500 text-[11px] font-semibold mb-3 uppercase tracking-wider">Usage</div>
                <div className="grid grid-cols-2 gap-3 mb-3 text-xs">
                  <div><div className="text-[10px] text-zinc-500">Daily Spent</div><div className="font-semibold text-zinc-200">{governanceSummary.dailySpent.toFixed(2)}</div></div>
                  <div><div className="text-[10px] text-zinc-500">Remaining</div><div className="font-semibold text-zinc-200">{governanceSummary.dailyRemaining.toFixed(2)}</div></div>
                </div>
                <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-[#da7756] transition-all duration-500" style={{ width: `${Math.min(governanceSummary.dailyUsagePct, 100)}%` }} />
                </div>
              </div>
            )}

            <div className="mt-auto pt-3 border-t border-zinc-800/80 flex flex-col gap-1.5">
              <button onClick={() => setSettingsOpen(true)} className="w-full bg-[#212126] text-zinc-300 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-medium hover:bg-zinc-800 transition-colors">Settings</button>
              <button onClick={() => void deleteAllMemories()} disabled={!accessToken || isDeletingMemories} className="w-full bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg px-3 py-2 text-xs font-medium hover:bg-red-500/20 transition-colors disabled:opacity-40">{isDeletingMemories ? "Deleting..." : "Clear AI Memory"}</button>
            </div>
          </div>
        </aside>
      </div>

      {settingsOpen && (
        <div className="fixed inset-0 z-[1000] flex justify-center items-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[#212126] w-[400px] max-w-[calc(100vw-32px)] rounded-2xl p-6 shadow-2xl border border-zinc-800">
            <div className="flex justify-between items-center mb-5">
              <div className="text-base font-bold text-zinc-100">Settings</div>
              <button onClick={() => setSettingsOpen(false)} className="text-zinc-400 hover:text-zinc-100 bg-transparent border-none cursor-pointer"><X size={20} /></button>
            </div>
            <div className="text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-2">Access Token</div>
            <input type={showToken ? "text" : "password"} value={draftToken} onChange={(e) => setDraftToken(e.target.value)} className="w-full border border-zinc-700 bg-zinc-900/60 text-zinc-100 text-xs outline-none px-3.5 py-2.5 rounded-lg mb-5 focus:border-[#da7756] transition-colors" />
            <div className="flex gap-50">
              <button onClick={() => setShowToken(!showToken)} className="flex-1 bg-zinc-800 text-zinc-300 border border-zinc-700 rounded-lg px-3 py-2 text-xs font-medium hover:bg-zinc-700 transition-colors">{showToken ? "Hide" : "Show"}</button>
              <button onClick={handleSaveToken} className="flex-[2] bg-[#da7756] text-white rounded-lg px-3 py-2 text-xs font-semibold hover:bg-[#ea9072] transition-colors">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};