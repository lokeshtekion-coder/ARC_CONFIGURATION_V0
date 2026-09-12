import React, { useMemo } from "react";
import { loadLatestExtensionCapture } from "../services/extensionBridge";

interface Props {
  onOpenBlueprint: () => void;
  onOpenBootstrap: () => void;
  onOpenValidation: () => void;
  onOpenStores: () => void;
  onOpenParts: () => void;
  onOpenService: () => void;
  onOpenAccounting: () => void;
  onOpenAnalytics: () => void;
  onOpenAdhoc: () => void;
  onOpenTGPT: () => void;
  onOpenSettings: () => void;
}

type HomeModuleCard = {
  title: string;
  description: string;
  icon: string;
  onClick: () => void;
};

function getCapturedUsername(): string {
  try {
    const rawCapture = loadLatestExtensionCapture();
    if (!rawCapture) return "";

    // Type-cast to allow safe property probing across optional extension fields
    const capture = rawCapture as Record<string, any>;

    // 1. Inspect custom API captures (specifically TOC API / getuserprofile)
    if (capture.customCaptures) {
      for (const c of Object.values(capture.customCaptures) as any[]) {
        if (c?.headers) {
          for (const [k, v] of Object.entries(c.headers)) {
            if (
              (k.toLowerCase() === "email" || k.toLowerCase().includes("user-email")) &&
              typeof v === "string" &&
              v.includes("@")
            ) {
              return v.split("@")[0].trim();
            }
          }
        }
      }
    }

    // 2. Inspect Tekion Profiles
    if (capture.tekionProfiles) {
      for (const p of capture.tekionProfiles as any[]) {
        if (typeof p?.email === "string" && p.email.includes("@")) {
          return p.email.split("@")[0].trim();
        }
        if (typeof p?.userEmail === "string" && p.userEmail.includes("@")) {
          return p.userEmail.split("@")[0].trim();
        }
        if (p?.bootstrapHeaders) {
          for (const [k, v] of Object.entries(p.bootstrapHeaders)) {
            if (
              (k.toLowerCase() === "email" || k.toLowerCase().includes("user-email")) &&
              typeof v === "string" &&
              v.includes("@")
            ) {
              return v.split("@")[0].trim();
            }
          }
        }
      }
    }

    // 3. Fallback: check decoded JWT payload if present
    if (capture.decodedToken && typeof capture.decodedToken.email === "string") {
      const em = capture.decodedToken.email;
      if (em.includes("@")) return em.split("@")[0].trim();
    }
  } catch {}
  return "";
}

export const Home: React.FC<Props> = ({
  onOpenBlueprint,
  onOpenBootstrap,
  onOpenValidation,
  onOpenStores,
  onOpenParts,
  onOpenService,
  onOpenAccounting,
  onOpenAnalytics,
  onOpenAdhoc,
  onOpenTGPT,
  onOpenSettings,
}) => {
  const userName = useMemo(() => getCapturedUsername(), []);

  const primaryCards: HomeModuleCard[] = [
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

  const utilityCards: HomeModuleCard[] = [
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

  return (
    <div className="arc-home-page">
      <style>{`
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
      `}</style>

      <div className="arc-home-wrap">
        {/* Hub Header */}
        <section className="arc-home-hero-panel">
          <div className="arc-home-hero-copy">
            <div className="arc-home-kicker">Tekion ARC Operations</div>
            <h1 className="arc-home-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              Hi <span className="wave-hand">👋</span> {userName || "there"}
            </h1>
            <p className="arc-home-subtitle">
              Unified control center for dealership configuration, validation suites, and operational sign-offs.
            </p>
          </div>
          <div className="arc-home-badge-status">
            <span className="arc-status-dot" />
            <span>Systems Active</span>
          </div>
        </section>

        {/* Core Operational Modules */}
        <section className="arc-home-section">
          <div className="arc-home-section-header">
            <h2 className="arc-home-section-title">Core Workspaces</h2>
            <span className="arc-home-section-meta">{primaryCards.length} modules</span>
          </div>

          <div className="arc-home-grid">
            {primaryCards.map((card) => (
              <button
                key={card.title}
                type="button"
                className="arc-home-card"
                onClick={card.onClick}
              >
                <div className="arc-home-card-top">
                  <span className="arc-home-card-icon">{card.icon}</span>
                  <span className="arc-home-card-arrow">→</span>
                </div>
                <div>
                  <div className="arc-home-card-title">{card.title}</div>
                  <div className="arc-home-card-desc">{card.description}</div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Tools and Diagnostics */}
        <section className="arc-home-section">
          <div className="arc-home-section-header">
            <h2 className="arc-home-section-title">Utilities & Diagnostic Tools</h2>
            <span className="arc-home-section-meta">{utilityCards.length} tools</span>
          </div>

          <div className="arc-home-grid arc-home-grid-compact">
            {utilityCards.map((card) => (
              <button
                key={card.title}
                type="button"
                className="arc-home-card arc-home-card-compact"
                onClick={card.onClick}
              >
                <div className="arc-home-card-top">
                  <span className="arc-home-card-icon">{card.icon}</span>
                  <span className="arc-home-card-arrow">→</span>
                </div>
                <div>
                  <div className="arc-home-card-title">{card.title}</div>
                  <div className="arc-home-card-desc">{card.description}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Home;