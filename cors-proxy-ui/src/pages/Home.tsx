import React from "react";

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
  icon: string;
  onClick: () => void;
};

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
  const primaryCards: HomeModuleCard[] = [
    { title: "Stores", icon: "🏬", onClick: onOpenStores },
    { title: "Parts", icon: "🧩", onClick: onOpenParts },
    { title: "Service", icon: "🛠️", onClick: onOpenService },
    { title: "Accounting", icon: "📒", onClick: onOpenAccounting },
    { title: "Analytics", icon: "📊", onClick: onOpenAnalytics },
    { title: "Adhoc", icon: "⚡", onClick: onOpenAdhoc },
    { title: "TGPT", icon: "🤖", onClick: onOpenTGPT },
  ];

  const utilityCards: HomeModuleCard[] = [
    { title: "Blueprint Decoder", icon: "🧬", onClick: onOpenBlueprint },
    { title: "Bootstrap Extractor", icon: "📦", onClick: onOpenBootstrap },
    { title: "GL Validation", icon: "✅", onClick: onOpenValidation },
    { title: "Settings", icon: "⚙️", onClick: onOpenSettings },
  ];

  return (
    <div className="arc-home-page">
      <div className="arc-home-wrap">
        <section className="arc-home-hero-panel">
          <div className="arc-home-hero-copy">
            <div className="arc-home-kicker">ARC Internal Workspace</div>
            <h1 className="arc-home-title">Hi</h1>
          </div>

          <div className="arc-home-hero-actions">
            <button className="btn-postman" type="button" onClick={onOpenStores}>
              Open Stores
            </button>
            <button className="btn-secondary" type="button" onClick={onOpenSettings}>
              Open Settings
            </button>
          </div>
        </section>

        <section className="arc-home-section">
          <div className="arc-home-section-header">
            <h2 className="arc-home-section-title">Core Workspaces</h2>
            <span className="arc-home-section-meta">{primaryCards.length} modules</span>
          </div>

          <div className="arc-home-grid arc-home-grid-small">
            {primaryCards.map((card) => (
              <button
                key={card.title}
                type="button"
                className="arc-home-card arc-home-card-small"
                onClick={card.onClick}
              >
                <div className="arc-home-card-top">
                  <span className="arc-home-card-icon">{card.icon}</span>
                  <span className="arc-home-card-arrow">→</span>
                </div>
                <div className="arc-home-card-title">{card.title}</div>
              </button>
            ))}
          </div>
        </section>

        <section className="arc-home-section">
          <div className="arc-home-section-header">
            <h2 className="arc-home-section-title">Utilities</h2>
            <span className="arc-home-section-meta">{utilityCards.length} tools</span>
          </div>

          <div className="arc-home-grid arc-home-grid-small">
            {utilityCards.map((card) => (
              <button
                key={card.title}
                type="button"
                className="arc-home-card arc-home-card-small arc-home-card-compact"
                onClick={card.onClick}
              >
                <div className="arc-home-card-top">
                  <span className="arc-home-card-icon">{card.icon}</span>
                  <span className="arc-home-card-arrow">→</span>
                </div>
                <div className="arc-home-card-title">{card.title}</div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

export type HistoryEntry = never;
