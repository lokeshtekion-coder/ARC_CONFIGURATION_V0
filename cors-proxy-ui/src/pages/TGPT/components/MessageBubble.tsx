import React, { Component, ReactNode, useState, useEffect } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { Loader2, ChevronRight, ChevronDown, Check, Copy } from "lucide-react";
import { TGPTMessage } from "../types";

export class MessageErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">⚠️ Rendering error in this message.</div>;
    return this.props.children;
  }
}

const ThinkingBlock = ({ thinking, status }: { thinking: string, status: string }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const isComplete = status === "complete";

  useEffect(() => { if (isComplete) setIsExpanded(false); }, [isComplete]);

  return (
    <div className={`mb-4 rounded-xl bg-black/20 border border-white/5 overflow-hidden transition-all duration-300 ${!isComplete ? "thinking-active" : ""}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center gap-2.5 bg-transparent border-none text-zinc-400 cursor-pointer text-[13px] font-semibold text-left"
      >
        <span className={`flex items-center justify-center w-6 h-6 rounded-full ${!isComplete ? "bg-blue-500/20 text-blue-400" : "bg-white/5 text-zinc-400"}`}>
          {!isComplete ? <Loader2 size={14} className="animate-spin" /> : (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
        </span>
        {!isComplete ? `Thinking (${status})...` : "Thought Process"}
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 text-zinc-300 text-[13px] leading-relaxed whitespace-pre-wrap border-t border-white/5 mt-1 pt-3">
          {thinking || "Initializing thought sequence..."}
        </div>
      )}
    </div>
  );
};

interface MessageBubbleProps {
  msg: TGPTMessage;
  isUser: boolean;
  msgId: string | number;
  onCopy: (content: string, id: string | number) => void;
  isCopied: boolean;
  copiedCodeIndex: string | null;
  onCopyCode: (codeText: string, blockId: string) => void;
}

export const MessageBubble = React.memo(({ msg, isUser, msgId, onCopy, isCopied, copiedCodeIndex, onCopyCode }: MessageBubbleProps) => {
  const renderRichContent = (content: string) => {
    if (!content) return null;
    const parts = content.split(/(```[\s\S]*?```)/g);

    return parts.map((part: string, index: number) => {
      if (part.startsWith("```") && part.endsWith("```")) {
        const codeContent = part.slice(3, -3);
        const firstNewline = codeContent.indexOf("\n");
        const lang = firstNewline > -1 ? codeContent.slice(0, firstNewline).trim() : "";
        const code = firstNewline > -1 ? codeContent.slice(firstNewline + 1) : codeContent;

        const blockId = `${msgId}-code-${index}`;
        const isCodeCopied = copiedCodeIndex === blockId;

        return (
          <div key={index} className="my-4 rounded-xl overflow-hidden border border-white/10 bg-[#0d0f12]">
            <div className="bg-[#1e2028] px-3.5 py-2 flex justify-between items-center border-b border-white/5">
              <span className="text-[11px] text-[#a6accd] uppercase font-bold tracking-wide">{lang || "code"}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onCopyCode(code, blockId); }}
                className={`bg-transparent border-none flex items-center gap-1.5 text-xs font-semibold cursor-pointer transition-colors ${isCodeCopied ? "text-emerald-400" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                {isCodeCopied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy</>}
              </button>
            </div>
            <pre className="m-0 p-4 overflow-x-auto text-[13px] text-zinc-200 font-mono leading-relaxed">
              <code>{code}</code>
            </pre>
          </div>
        );
      }

      const rawHtml = marked.parse(part, { async: false }) as string;
      const cleanHtml = DOMPurify.sanitize(rawHtml);
      return <div key={index} className="markdown-body" dangerouslySetInnerHTML={{ __html: cleanHtml }} />;
    });
  };

  return (
    <div className="animate-in flex w-full opacity-0" style={{ justifyContent: isUser ? "flex-end" : "flex-start" }}>
      <div className={`max-w-[85%] px-5 py-4 shadow-md ${
        isUser
          ? "bg-[#2563eb] text-white rounded-2xl rounded-br-sm"
          : "bg-[#212126] border border-zinc-800 text-zinc-100 rounded-2xl rounded-bl-sm"
      }`}>
        {!isUser && msg.thinking && <ThinkingBlock thinking={msg.thinking} status={msg.status || "analyzing"} />}
        <div className="w-full">{renderRichContent(msg.content)}</div>
        {!isUser && msg.status === "complete" && (
          <div className="flex justify-end mt-4 pt-3 border-t border-zinc-700/50">
            <button
              onClick={() => onCopy(msg.content, msgId)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md font-semibold transition-all ${isCopied ? "bg-emerald-500/10 text-emerald-400" : "bg-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"}`}
            >
              {isCopied ? <><Check size={14}/> Copied!</> : <><Copy size={14}/> Copy Response</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});