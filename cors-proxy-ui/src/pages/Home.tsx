import React from "react";
import type { HttpMethod } from "../types/proxy.types";

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "#30d158",
  POST: "#0a84ff",
  PUT: "#ff9f0a",
  DELETE: "#ff453a",
  PATCH: "#bf5af2",
};

export interface HistoryEntry {
  method: HttpMethod;
  url: string;
  status: number;
  duration: number;
  timestamp: string;
}

interface Props {
  history: HistoryEntry[];
  onNewRequest: () => void;
  onOpenHistory: (entry: HistoryEntry) => void;
  onOpenBlueprint: () => void;
  onOpenBootstrap: () => void;
  onOpenValidation: () => void;
  onOpenSettings: () => void;
  onOpenStores: () => void;
  onOpenParts: () => void;
  onOpenService: () => void;
  onOpenAccounting: () => void;
  onOpenAnalytics: () => void;
  onOpenAdhoc: () => void;
  onOpenTGPT: () => void;
}

type QuickActionType =
  | "new"
  | "blueprint"
  | "bootstrap"
  | "validation"
  | "stores"
  | "parts"
  | "service"
  | "accounting"
  | "analytics"
  | "adhoc"
  | "tgpt"
  | "soon";

const QUICK_ACTIONS: {
  icon: string;
  title: string;
  desc: string;
  action: QuickActionType;
}[] = [
  {
    icon: "⚡",
    title: "New Request",
    desc: "Build and send API requests",
    action: "new",
  },
  {
    icon: "🔍",
    title: "Blueprint Decoder",
    desc: "Decode blueprint form API responses",
    action: "blueprint",
  },
  {
    icon: "🗃",
    title: "Bootstrap Extractor",
    desc: "Extract GL accounts, cost centers, journals",
    action: "bootstrap",
  },
  {
    icon: "✅",
    title: "GL Validation",
    desc: "Validate GL accounts against bootstrap data",
    action: "validation",
  },
  {
    icon: "🏬",
    title: "Stores",
    desc: "Fetch implementation dealer stores",
    action: "stores",
  },
  {
    icon: "🧩",
    title: "Parts",
    desc: "Parts auto-configuration workspace",
    action: "parts",
  },
  {
    icon: "🛠",
    title: "Service",
    desc: "Service auto-configuration workspace",
    action: "service",
  },
  {
    icon: "📒",
    title: "Accounting",
    desc: "Accounting auto-configuration workspace",
    action: "accounting",
  },
  {
    icon: "📊",
    title: "Analytics",
    desc: "Analytics auto-configuration workspace",
    action: "analytics",
  },
  {
    icon: "⚡",
    title: "Adhoc",
    desc: "Adhoc auto-configuration workspace",
    action: "adhoc",
  },
  {
    icon: "🤖",
    title: "TGPT",
    desc: "Tekion GPT assistant workspace",
    action: "tgpt",
  },
  {
    icon: "📁",
    title: "Collections",
    desc: "Group related requests together",
    action: "soon",
  },
];

export const Home: React.FC<Props> = ({
  history,
  onNewRequest,
  onOpenHistory,
  onOpenBlueprint,
  onOpenBootstrap,
  onOpenValidation,
  onOpenSettings,
  onOpenStores,
  onOpenParts,
  onOpenService,
  onOpenAccounting,
  onOpenAnalytics,
  onOpenAdhoc,
  onOpenTGPT,
}) => {
  function handleCard(action: QuickActionType) {
    if (action === "new") onNewRequest();
    if (action === "blueprint") onOpenBlueprint();
    if (action === "bootstrap") onOpenBootstrap();
    if (action === "validation") onOpenValidation();
    if (action === "stores") onOpenStores();
    if (action === "parts") onOpenParts();
    if (action === "service") onOpenService();
    if (action === "accounting") onOpenAccounting();
    if (action === "analytics") onOpenAnalytics();
    if (action === "adhoc") onOpenAdhoc();
    if (action === "tgpt") onOpenTGPT();
  }

  return (
    <div className="home-shell">
      <aside className="home-sidebar">
        <div className="home-brand">
          <span className="home-brand-icon">📮</span>
          <span className="home-brand-name">Postman</span>
        </div>

        <nav className="home-nav">
          <button className="hn-item hn-active">
            <span className="hn-icon">🏠</span> Home
          </button>
          <button className="hn-item" onClick={onNewRequest}>
            <span className="hn-icon">⚡</span> New Request
          </button>
          <button className="hn-item" onClick={onOpenBlueprint}>
            <span className="hn-icon">🔍</span> Blueprint Decoder
          </button>
          <button className="hn-item" onClick={onOpenBootstrap}>
            <span className="hn-icon">🗃</span> Bootstrap Extractor
          </button>
          <button className="hn-item" onClick={onOpenValidation}>
            <span className="hn-icon">✅</span> GL Validation
          </button>
          <button className="hn-item" onClick={onOpenStores}>
            <span className="hn-icon">🏬</span> Stores
          </button>
          <button className="hn-item" onClick={onOpenParts}>
            <span className="hn-icon">🧩</span> Parts
          </button>
          <button className="hn-item" onClick={onOpenService}>
            <span className="hn-icon">🛠</span> Service
          </button>
          <button className="hn-item" onClick={onOpenAccounting}>
            <span className="hn-icon">📒</span> Accounting
          </button>
          <button className="hn-item" onClick={onOpenAnalytics}>
            <span className="hn-icon">📊</span> Analytics
          </button>
          <button className="hn-item" onClick={onOpenAdhoc}>
            <span className="hn-icon">⚡</span> Adhoc
          </button>
          <button className="hn-item" onClick={onOpenTGPT}>
            <span className="hn-icon">🤖</span> TGPT
          </button>
          <button className="hn-item hn-disabled">
            <span className="hn-icon">📁</span> Collections <span className="hn-soon">Soon</span>
          </button>
          <button className="hn-item hn-disabled">
            <span className="hn-icon">📊</span> History <span className="hn-count">{history.length}</span>
          </button>
        </nav>

        <div className="home-nav-footer">
          <button className="hn-item" onClick={onOpenSettings}>
            <span className="hn-icon">⚙️</span> Settings
          </button>
          <div className="home-version-tag">v2.0.0</div>
        </div>
      </aside>

      <div className="home-main">
        <div className="home-topbar">
          <div className="home-search-wrap">
            <span className="home-search-icon">🔍</span>
            <input type="text" placeholder="Search requests..." className="home-search-input" />
            <kbd className="home-search-kbd">⌘K</kbd>
          </div>
          <button className="btn-postman" onClick={onNewRequest}>
            + New Request
          </button>
        </div>

        <div className="home-content">
          <div className="home-banner">
            <div className="home-banner-left">
              <div className="home-banner-icon">📮</div>
              <div>
                <h1 className="home-banner-title">Welcome to Postman</h1>
                <p className="home-banner-sub">
                  Build, test, decode, extract, configure, and chat with TGPT — all in one place
                </p>
              </div>
            </div>
            <button className="btn-postman" onClick={onNewRequest}>
              Get Started →
            </button>
          </div>

          <div className="home-section">
            <h2 className="home-section-title">Quick Start</h2>
            <div className="home-cards">
              {QUICK_ACTIONS.map((a) => (
                <button
                  key={a.title}
                  className={`home-card ${a.action === "soon" ? "home-card-soon" : ""}`}
                  onClick={() => handleCard(a.action)}
                  disabled={a.action === "soon"}
                >
                  <span className="home-card-icon">{a.icon}</span>
                  <span className="home-card-title">{a.title}</span>
                  <span className="home-card-desc">{a.desc}</span>
                  {a.action === "soon" && <span className="home-card-badge">Coming Soon</span>}
                </button>
              ))}
            </div>
          </div>

          <div className="home-section">
            <h2 className="home-section-title">Recent Requests</h2>
            {history.length === 0 ? (
              <div className="home-empty">
                <span className="home-empty-icon">📭</span>
                <p className="home-empty-text">No requests yet</p>
                <button className="btn-postman" onClick={onNewRequest}>
                  New Request
                </button>
              </div>
            ) : (
              <div className="home-history-list">
                {history.slice(0, 10).map((item, i) => (
                  <button key={i} className="home-history-row" onClick={() => onOpenHistory(item)}>
                    <span
                      className="home-history-method"
                      style={{ color: METHOD_COLORS[item.method] }}
                    >
                      {item.method}
                    </span>
                    <span className="home-history-url">{item.url}</span>
                    <span
                      className="home-history-status"
                      style={{
                        color:
                          item.status < 300
                            ? "#30d158"
                            : item.status < 400
                            ? "#ff9f0a"
                            : "#ff453a",
                      }}
                    >
                      {item.status}
                    </span>
                    <span className="home-history-dur">{item.duration}ms</span>
                    <span className="home-history-ts">{item.timestamp}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
