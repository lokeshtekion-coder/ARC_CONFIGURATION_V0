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
import "./app.css";

type PageId =
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
  | "tgpt";

interface NavItem {
  id: Exclude<PageId, "home">;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: "stores", label: "Stores", icon: "🏬" },
  { id: "parts", label: "Parts", icon: "🧩" },
  { id: "service", label: "Service", icon: "🛠️" },
  { id: "accounting", label: "Accounting", icon: "📒" },
  { id: "analytics", label: "Analytics", icon: "📊" },
  { id: "adhoc", label: "Adhoc", icon: "⚡" },
  { id: "tgpt", label: "TGPT", icon: "🤖" },
  { id: "blueprint", label: "Blueprint", icon: "🧬" },
  { id: "bootstrap", label: "Bootstrap", icon: "📦" },
  { id: "validation", label: "GL Validation", icon: "✅" },
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
  return (
    <header className="gtn-bar">
      <button className="gtn-logo" onClick={onLogoClick} aria-label="Go home">
        <span className="gtn-logo-mark">ARC</span>
        <div className="gtn-logo-copy">
          <span className="gtn-logo-text">Console</span>
        </div>
      </button>

      <nav className="gtn-links" aria-label="Primary">
        {items.map((item) => (
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

      <button
        className={`gtn-settings ${activePage === "settings" ? "gtn-link-active" : ""}`}
        onClick={() => onNavigate("settings")}
        aria-label="Settings"
        title="Settings"
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
    default:
      return null;
  }
}
