import { AVAILABLE_MODELS } from "./constants";

export const logger = {
  debug: (...args: unknown[]) => console.debug("[TGPT]", ...args),
  info: (...args: unknown[]) => console.info("[TGPT]", ...args),
  warn: (...args: unknown[]) => console.warn("[TGPT]", ...args),
  error: (...args: unknown[]) => console.error("[TGPT]", ...args),
};

export function formatDate(dateString?: string): string {
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

export function formatFileSize(bytes?: number): string {
  const size = bytes ?? 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileIcon(mimeType?: string): string {
  const type = String(mimeType ?? "").toLowerCase();
  if (type.includes("image")) return "🖼️";
  if (type.includes("pdf")) return "📄";
  if (type.includes("text")) return "📝";
  if (type.includes("json")) return "{ }";
  if (type.includes("csv")) return "📊";
  return "📎";
}

export function groupModels() {
  const grouped: Record<string, Array<(typeof AVAILABLE_MODELS)[number]>> = {};
  for (const model of AVAILABLE_MODELS) {
    if (!grouped[model.provider]) grouped[model.provider] = [];
    grouped[model.provider].push(model);
  }
  return grouped;
}

export function extractUserIdFromToken(token: string): string {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return "";
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64)) as Record<string, unknown>;
    return String(payload.sub || payload.user_id || payload.userId || payload.uid || payload.id || payload.account_id || "");
  } catch (error) {
    logger.error("Failed to decode token", error);
    return "";
  }
}