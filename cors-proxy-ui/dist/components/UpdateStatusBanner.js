import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from "react";
const SKIP_MESSAGE = {
    "local-changes": "Auto-update skipped: you have uncommitted local changes. Commit or stash, then git pull manually.",
    diverged: "Auto-update skipped: your branch has diverged from origin/main. Resolve with git pull manually.",
    "git-unavailable": "Auto-update check skipped: not a git checkout or git isn't available here.",
};
export function UpdateStatusBanner() {
    const [status, setStatus] = useState(null);
    const [dismissed, setDismissed] = useState(false);
    useEffect(() => {
        fetch("/api/version")
            .then((res) => (res.ok ? res.json() : null))
            .then((json) => setStatus(json?.data ?? null))
            .catch(() => setStatus(null));
    }, []);
    if (dismissed || !status)
        return null;
    const skipMessage = status.skippedReason ? SKIP_MESSAGE[status.skippedReason] : null;
    if (!skipMessage && !status.extensionChanged)
        return null;
    return (_jsxs("div", { style: {
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 16px",
            fontSize: 12,
            background: "rgba(10, 132, 255, 0.08)",
            borderBottom: "1px solid rgba(10, 132, 255, 0.25)",
            color: "#cbd5e1",
        }, children: [_jsx("span", { children: "\u2139\uFE0F" }), _jsxs("span", { style: { flex: 1 }, children: [skipMessage, status.extensionChanged && (skipMessage ? " Also: " : "") +
                        "The Chrome extension changed - reload it at chrome://extensions."] }), _jsx("button", { type: "button", onClick: () => setDismissed(true), style: { background: "none", border: "none", color: "#94a3b8", cursor: "pointer" }, "aria-label": "Dismiss", children: "\u2715" })] }));
}
