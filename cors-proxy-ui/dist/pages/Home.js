import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo } from "react";
import { loadLatestExtensionCapture } from "../services/extensionBridge";
function getCapturedUsername() {
    try {
        const rawCapture = loadLatestExtensionCapture();
        if (!rawCapture)
            return "";
        // Type-cast to allow safe property probing across optional extension fields
        const capture = rawCapture;
        // 1. Inspect custom API captures (specifically TOC API / getuserprofile)
        if (capture.customCaptures) {
            for (const c of Object.values(capture.customCaptures)) {
                if (c?.headers) {
                    for (const [k, v] of Object.entries(c.headers)) {
                        if ((k.toLowerCase() === "email" || k.toLowerCase().includes("user-email")) &&
                            typeof v === "string" &&
                            v.includes("@")) {
                            return v.split("@")[0].trim();
                        }
                    }
                }
            }
        }
        // 2. Inspect Tekion Profiles
        if (capture.tekionProfiles) {
            for (const p of capture.tekionProfiles) {
                if (typeof p?.email === "string" && p.email.includes("@")) {
                    return p.email.split("@")[0].trim();
                }
                if (typeof p?.userEmail === "string" && p.userEmail.includes("@")) {
                    return p.userEmail.split("@")[0].trim();
                }
                if (p?.bootstrapHeaders) {
                    for (const [k, v] of Object.entries(p.bootstrapHeaders)) {
                        if ((k.toLowerCase() === "email" || k.toLowerCase().includes("user-email")) &&
                            typeof v === "string" &&
                            v.includes("@")) {
                            return v.split("@")[0].trim();
                        }
                    }
                }
            }
        }
        // 3. Fallback: check decoded JWT payload if present
        if (capture.decodedToken && typeof capture.decodedToken.email === "string") {
            const em = capture.decodedToken.email;
            if (em.includes("@"))
                return em.split("@")[0].trim();
        }
    }
    catch { }
    return "";
}
export const Home = ({ onOpenBlueprint, onOpenBootstrap, onOpenValidation, onOpenStores, onOpenParts, onOpenService, onOpenAccounting, onOpenAnalytics, onOpenAdhoc, onOpenTGPT, onOpenSettings, }) => {
    const userName = useMemo(() => getCapturedUsername(), []);
    const primaryCards = [
        {
            title: "Stores",
            description: "Onboarding tracking, blueprints & launch readiness",
            icon: "🏬",
            onClick: onOpenStores,
        },
        {
            title: "Parts",
            description: "Inventory classifications, pricing & parts matrix",
            icon: "🧩",
            onClick: onOpenParts,
        },
        {
            title: "Service",
            description: "Labor opcodes, work orders & service lanes",
            icon: "🛠️",
            onClick: onOpenService,
        },
        {
            title: "Accounting",
            description: "GL mappings, journals & chart of accounts",
            icon: "📒",
            onClick: onOpenAccounting,
        },
        {
            title: "Analytics",
            description: "Performance metrics & operational reporting",
            icon: "📊",
            onClick: onOpenAnalytics,
        },
        {
            title: "Adhoc",
            description: "Quick execution utilities & payload testing",
            icon: "⚡",
            onClick: onOpenAdhoc,
        },
        {
            title: "TGPT",
            description: "Tekion AI assistant & knowledge queries",
            icon: "🤖",
            onClick: onOpenTGPT,
        },
    ];
    const utilityCards = [
        {
            title: "Blueprint Decoder",
            description: "Inspect, format and validate JSON payloads",
            icon: "🧬",
            onClick: onOpenBlueprint,
        },
        {
            title: "Bootstrap Extractor",
            description: "Extract configuration keys and schemas",
            icon: "📦",
            onClick: onOpenBootstrap,
        },
        {
            title: "GL Validation",
            description: "Verify accounting rules and mapping integrity",
            icon: "✅",
            onClick: onOpenValidation,
        },
        {
            title: "Settings",
            description: "API tokens, environment session and headers",
            icon: "⚙️",
            onClick: onOpenSettings,
        },
    ];
    return (_jsxs("div", { className: "arc-home-page", children: [_jsx("style", { children: `
        @keyframes wave-once {
          0% { transform: rotate(0deg); }
          15% { transform: rotate(14deg); }
          30% { transform: rotate(-10deg); }
          45% { transform: rotate(14deg); }
          60% { transform: rotate(-6deg); }
          75% { transform: rotate(10deg); }
          100% { transform: rotate(0deg); }
        }
        .wave-hand {
          display: inline-block;
          transform-origin: 70% 70%;
          animation: wave-once 1.2s ease-in-out 1;
        }
      ` }), _jsxs("div", { className: "arc-home-wrap", children: [_jsxs("section", { className: "arc-home-hero-panel", children: [_jsxs("div", { className: "arc-home-hero-copy", children: [_jsx("div", { className: "arc-home-kicker", children: "Tekion ARC Operations" }), _jsxs("h1", { className: "arc-home-title", style: { display: "flex", alignItems: "center", gap: 10 }, children: ["Hi ", _jsx("span", { className: "wave-hand", children: "\uD83D\uDC4B" }), " ", userName || "there"] }), _jsx("p", { className: "arc-home-subtitle", children: "Unified control center for dealership configuration, validation suites, and operational sign-offs." })] }), _jsxs("div", { className: "arc-home-badge-status", children: [_jsx("span", { className: "arc-status-dot" }), _jsx("span", { children: "Systems Active" })] })] }), _jsxs("section", { className: "arc-home-section", children: [_jsxs("div", { className: "arc-home-section-header", children: [_jsx("h2", { className: "arc-home-section-title", children: "Core Workspaces" }), _jsxs("span", { className: "arc-home-section-meta", children: [primaryCards.length, " modules"] })] }), _jsx("div", { className: "arc-home-grid", children: primaryCards.map((card) => (_jsxs("button", { type: "button", className: "arc-home-card", onClick: card.onClick, children: [_jsxs("div", { className: "arc-home-card-top", children: [_jsx("span", { className: "arc-home-card-icon", children: card.icon }), _jsx("span", { className: "arc-home-card-arrow", children: "\u2192" })] }), _jsxs("div", { children: [_jsx("div", { className: "arc-home-card-title", children: card.title }), _jsx("div", { className: "arc-home-card-desc", children: card.description })] })] }, card.title))) })] }), _jsxs("section", { className: "arc-home-section", children: [_jsxs("div", { className: "arc-home-section-header", children: [_jsx("h2", { className: "arc-home-section-title", children: "Utilities & Diagnostic Tools" }), _jsxs("span", { className: "arc-home-section-meta", children: [utilityCards.length, " tools"] })] }), _jsx("div", { className: "arc-home-grid arc-home-grid-compact", children: utilityCards.map((card) => (_jsxs("button", { type: "button", className: "arc-home-card arc-home-card-compact", onClick: card.onClick, children: [_jsxs("div", { className: "arc-home-card-top", children: [_jsx("span", { className: "arc-home-card-icon", children: card.icon }), _jsx("span", { className: "arc-home-card-arrow", children: "\u2192" })] }), _jsxs("div", { children: [_jsx("div", { className: "arc-home-card-title", children: card.title }), _jsx("div", { className: "arc-home-card-desc", children: card.description })] })] }, card.title))) })] })] })] }));
};
export default Home;
