import { useMemo, useState } from "react";
import { Home } from "./pages/Home";
import { BlueprintDecoder } from "./pages/BlueprintDecoder";
import { BootstrapExtractor } from "./pages/BootstrapExtractor";
import { GLValidation } from "./pages/GLValidation";
import { Settings } from "./pages/Settings";
import { Stores } from "./pages/Stores";
import { Parts } from "./pages/Parts/Parts";
import { Service } from "./pages/Service/Service";
import { Accounting } from "./pages/Accounting/Accounting";
import { Analytics } from "./pages/Analytics/Analytics";
import { Adhoc } from "./pages/Adhoc/Adhoc";
import { TGPT } from "./pages/TGPT/TGPT";
import { SyncBotDashboard } from "./pages/SyncBotDashboard";
import { SyncHealthBanner } from "./components/SyncHealthBanner";
import "./app.css";

export type PageId =
  | "home"
  | "blueprint"
  | "bootstrap"
  | "validation"
  | "settings"
  | "stores"
  | "parts"
  | "service"
  | "accounting"
  | "analytics"
  | "adhoc"
  | "tgpt"
  | "syncbot";

export interface NavItem {
  id: Exclude<PageId, "home" | "settings">;
  label: string;
  icon: string;
  category: "core" | "utility";
}

const NAV_ITEMS: NavItem[] = [
  // Core Operational Workspaces
  { id: "stores", label: "Stores", icon: "🏬", category: "core" },
  { id: "parts", label: "Parts", icon: "🧩", category: "core" },
  { id: "service", label: "Service", icon: "🛠️", category: "core" },
  { id: "accounting", label: "Accounting", icon: "📒", category: "core" },
  { id: "analytics", label: "Analytics", icon: "📊", category: "core" },
  { id: "adhoc", label: "Adhoc", icon: "⚡", category: "core" },
  { id: "tgpt", label: "TGPT", icon: "🤖", category: "core" },

  // Utility Tools
  { id: "blueprint", label: "Blueprint", icon: "🧬", category: "utility" },
  { id: "bootstrap", label: "Bootstrap", icon: "📦", category: "utility" },
  { id: "validation", label: "GL Validation", icon: "✅", category: "utility" },
  { id: "syncbot", label: "Sync Bot", icon: "🤖", category: "utility" },
];

export default function App() {
  const [page, setPage] = useState<PageId>("home");
  const topNavItems = useMemo(() => NAV_ITEMS, []);

  const goHome = () => setPage("home");

  return (
    <div className="app-shell">
      <GlobalTopNav
        items={topNavItems}
        activePage={page}
        onNavigate={setPage}
        onLogoClick={goHome}
      />

      <SyncHealthBanner
        onOpenSettings={() => setPage("settings")}
        onOpenDashboard={() => setPage("syncbot")}
      />

      <main className="app-shell-content">
        {renderPage(page, setPage, goHome)}
      </main>
    </div>
  );
}

function GlobalTopNav({
  items,
  activePage,
  onNavigate,
  onLogoClick,
}: {
  items: NavItem[];
  activePage: PageId;
  onNavigate: (page: PageId) => void;
  onLogoClick: () => void;
}) {
  const coreItems = useMemo(() => items.filter((i) => i.category === "core"), [items]);
  const utilityItems = useMemo(() => items.filter((i) => i.category === "utility"), [items]);

  return (
    <header className="gtn-bar">
      {/* Brand & Home Anchor */}
      <button
        className={`gtn-logo ${activePage === "home" ? "gtn-logo-active" : ""}`}
        onClick={onLogoClick}
        aria-label="Go to Home"
        title="Home Dashboard"
      >
        <span className="gtn-logo-mark">ARC</span>
        <div className="gtn-logo-copy">
          <span className="gtn-logo-text">Console</span>
        </div>
      </button>

      {/* Structured Navigation with Category Separator */}
      <nav className="gtn-links" aria-label="Primary Navigation">
        {coreItems.map((item) => (
          <button
            key={item.id}
            className={`gtn-link ${activePage === item.id ? "gtn-link-active" : ""}`}
            onClick={() => onNavigate(item.id)}
            aria-current={activePage === item.id ? "page" : undefined}
            type="button"
          >
            <span className="gtn-link-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}

        <div className="gtn-divider" aria-hidden="true" />

        {utilityItems.map((item) => (
          <button
            key={item.id}
            className={`gtn-link ${activePage === item.id ? "gtn-link-active" : ""}`}
            onClick={() => onNavigate(item.id)}
            aria-current={activePage === item.id ? "page" : undefined}
            type="button"
          >
            <span className="gtn-link-icon">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Settings Action */}
      <button
        className={`gtn-settings ${activePage === "settings" ? "gtn-settings-active" : ""}`}
        onClick={() => onNavigate("settings")}
        aria-label="Settings"
        title="Settings & Authentication"
        type="button"
      >
        ⚙️
      </button>
    </header>
  );
}

function renderPage(
  page: PageId,
  setPage: (page: PageId) => void,
  onBack: () => void
) {
  switch (page) {
    case "home":
      return (
        <Home
          onOpenBlueprint={() => setPage("blueprint")}
          onOpenBootstrap={() => setPage("bootstrap")}
          onOpenValidation={() => setPage("validation")}
          onOpenStores={() => setPage("stores")}
          onOpenParts={() => setPage("parts")}
          onOpenService={() => setPage("service")}
          onOpenAccounting={() => setPage("accounting")}
          onOpenAnalytics={() => setPage("analytics")}
          onOpenAdhoc={() => setPage("adhoc")}
          onOpenTGPT={() => setPage("tgpt")}
          onOpenSettings={() => setPage("settings")}
        />
      );
    case "blueprint":
      return <BlueprintDecoder onBack={onBack} />;
    case "bootstrap":
      return <BootstrapExtractor onBack={onBack} />;
    case "validation":
      return <GLValidation onBack={onBack} />;
    case "settings":
      return <Settings onBack={onBack} />;
    case "stores":
      return <Stores onBack={onBack} />;
    case "parts":
      return <Parts onBack={onBack} />;
    case "service":
      return <Service onBack={onBack} />;
    case "accounting":
      return <Accounting onBack={onBack} />;
    case "analytics":
      return <Analytics onBack={onBack} />;
    case "adhoc":
      return <Adhoc onBack={onBack} />;
    case "tgpt":
      return <TGPT onBack={onBack} />;
    case "syncbot":
      return <SyncBotDashboard onBack={onBack} />;
    default:
      return null;
  }
}