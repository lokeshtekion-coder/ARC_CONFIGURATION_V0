import { useEffect, useState } from "react";

// Reads the status written by scripts/auto-update.cjs at launch (npm run dev
// -> predev). That script already auto-pulled if it safely could, so this
// banner isn't a live "update available" poller - it just surfaces the one
// thing auto-pull can't do silently: tell you when it skipped (local
// changes / diverged) or when the extension needs a manual reload.
interface UpdateStatus {
  updated: boolean;
  upToDate?: boolean;
  commit?: string;
  fromCommit?: string;
  toCommit?: string;
  extensionChanged?: boolean;
  skippedReason: "local-changes" | "diverged" | "git-unavailable" | null;
}

const SKIP_MESSAGE: Record<string, string> = {
  "local-changes": "Auto-update skipped: you have uncommitted local changes. Commit or stash, then git pull manually.",
  diverged: "Auto-update skipped: your branch has diverged from origin/main. Resolve with git pull manually.",
  "git-unavailable": "Auto-update check skipped: not a git checkout or git isn't available here.",
};

export function UpdateStatusBanner() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    fetch("/api/version")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setStatus(json?.data ?? null))
      .catch(() => setStatus(null));
  }, []);

  if (dismissed || !status) return null;

  const skipMessage = status.skippedReason ? SKIP_MESSAGE[status.skippedReason] : null;
  if (!skipMessage && !status.extensionChanged) return null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 16px",
        fontSize: 12,
        background: "rgba(10, 132, 255, 0.08)",
        borderBottom: "1px solid rgba(10, 132, 255, 0.25)",
        color: "#cbd5e1",
      }}
    >
      <span>ℹ️</span>
      <span style={{ flex: 1 }}>
        {skipMessage}
        {status.extensionChanged && (skipMessage ? " Also: " : "") +
          "The Chrome extension changed - reload it at chrome://extensions."}
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer" }}
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
