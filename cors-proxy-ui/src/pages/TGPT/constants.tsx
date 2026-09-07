import React from "react";

export const TGPT_TOKEN_KEY = "tgpt_access_token";
export const TGPT_USER_ID_KEY = "tgpt_user_id";
export const TGPT_MODEL_KEY = "tgpt_selected_model";
export const TGPT_RAIL_OPEN_KEY = "tgpt_rail_open";

export const TGPT_BASE = "https://tapapi.tekioncloud.com/tapapi/tgpt";

export const AVAILABLE_MODELS = [
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

export const STARTER_PROMPTS = [
  { icon: "⚡️", title: "Explain a concept", prompt: "Explain quantum computing as if I am 5 years old." },
  { icon: "💻", title: "Draft code", prompt: "Write a secure Node.js Express endpoint for user authentication." },
  { icon: "📊", title: "Analyze data", prompt: "What are the key metrics to track for a SaaS application's growth?" },
  { icon: "📝", title: "Review writing", prompt: "Review this text for clarity and tone, and suggest improvements." },
];

export const GlobalStyles = () => (
  <style>{`
    @keyframes slideUpFade {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .animate-in {
      animation: slideUpFade 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    @keyframes pulseGlow {
      0% { box-shadow: 0 0 0 0 rgba(218, 119, 86, 0.3); }
      70% { box-shadow: 0 0 0 6px rgba(218, 119, 86, 0); }
      100% { box-shadow: 0 0 0 0 rgba(218, 119, 86, 0); }
    }
    .markdown-body {
      min-width: 0; max-width: 100%; word-wrap: break-word; overflow-wrap: break-word; word-break: break-word;
      font-size: 15px; line-height: 1.6; color: #e4e4e7;
    }
    .markdown-body p { margin: 0 0 1em 0; white-space: pre-wrap; }
    .markdown-body p:last-child { margin-bottom: 0; }
    .markdown-body h1, .markdown-body h2, .markdown-body h3 { color: #fafafa; font-weight: 600; margin-top: 1.5em; margin-bottom: 0.5em; line-height: 1.3; }
    .markdown-body h1 { font-size: 1.4em; }
    .markdown-body h2 { font-size: 1.25em; }
    .markdown-body h3 { font-size: 1.1em; }
    .markdown-body a { color: #da7756; text-decoration: underline; text-underline-offset: 3px; transition: color 0.2s ease; }
    .markdown-body a:hover { color: #ea9072; }
    .markdown-body ul, .markdown-body ol { padding-left: 1.5em; margin: 0 0 1em 0; }
    .markdown-body ul:last-child, .markdown-body ol:last-child { margin-bottom: 0; }
    .markdown-body li { margin-bottom: 0.35em; }
    .markdown-body table { width: 100%; border-collapse: collapse; margin-bottom: 1em; font-size: 14px; }
    .markdown-body th, .markdown-body td { border: 1px solid #3f3f46; padding: 10px 14px; text-align: left; }
    .markdown-body th { background: #27272a; font-weight: 600; color: #f4f4f5; }
    .markdown-body pre { overflow-x: auto; max-width: 100%; margin: 0; padding: 16px; background: transparent; }
    .markdown-body code { font-family: ui-monospace, SFMono-Regular, monospace; background: rgba(0,0,0,0.3); color: #f4f4f5; padding: 0.2em 0.4em; border-radius: 5px; font-size: 0.88em; }
    pre code { background: transparent; padding: 0; color: inherit; }
    .thinking-active { border: 1px solid rgba(218, 119, 86, 0.4); animation: pulseGlow 2s infinite; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #52525b; }
  `}</style>
);