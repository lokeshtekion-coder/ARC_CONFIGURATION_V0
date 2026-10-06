import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { Review } from "./pages/Review/Review";
import { SyncBotDashboard } from "./pages/SyncBotDashboard";
import { SyncHealthBanner } from "./components/SyncHealthBanner";
import { UpdateStatusBanner } from "./components/UpdateStatusBanner";
import "./app.css";
const NAV_ITEMS = [
    // Core Operational Workspaces
    { id: "stores", label: "Stores", icon: "🏬", category: "core" },
    { id: "parts", label: "Parts", icon: "🧩", category: "core" },
    { id: "service", label: "Service", icon: "🛠️", category: "core" },
    { id: "accounting", label: "Accounting", icon: "📒", category: "core" },
    { id: "analytics", label: "Analytics", icon: "📊", category: "core" },
    { id: "adhoc", label: "Adhoc", icon: "⚡", category: "core" },
    { id: "tgpt", label: "TGPT", icon: "🤖", category: "core" },
    { id: "review", label: "Review", icon: "📝", category: "core" },
    // Utility Tools
    { id: "blueprint", label: "Blueprint", icon: "🧬", category: "utility" },
    { id: "bootstrap", label: "Bootstrap", icon: "📦", category: "utility" },
    { id: "validation", label: "GL Validation", icon: "✅", category: "utility" },
    { id: "syncbot", label: "Sync Bot", icon: "🤖", category: "utility" },
];
export default function App() {
    const [page, setPage] = useState("home");
    const topNavItems = useMemo(() => NAV_ITEMS, []);
    const goHome = () => setPage("home");
    return (_jsxs("div", { className: "app-shell", children: [_jsx(GlobalTopNav, { items: topNavItems, activePage: page, onNavigate: setPage, onLogoClick: goHome }), _jsx(UpdateStatusBanner, {}), _jsx(SyncHealthBanner, { onOpenSettings: () => setPage("settings"), onOpenDashboard: () => setPage("syncbot") }), _jsx("main", { className: "app-shell-content", children: renderPage(page, setPage, goHome) })] }));
}
function GlobalTopNav({ items, activePage, onNavigate, onLogoClick, }) {
    const coreItems = useMemo(() => items.filter((i) => i.category === "core"), [items]);
    const utilityItems = useMemo(() => items.filter((i) => i.category === "utility"), [items]);
    return (_jsxs("header", { className: "gtn-bar", children: [_jsxs("button", { className: `gtn-logo ${activePage === "home" ? "gtn-logo-active" : ""}`, onClick: onLogoClick, "aria-label": "Go to Home", title: "Home Dashboard", children: [_jsx("span", { className: "gtn-logo-mark", children: "ARC" }), _jsx("div", { className: "gtn-logo-copy", children: _jsx("span", { className: "gtn-logo-text", children: "Console" }) })] }), _jsxs("nav", { className: "gtn-links", "aria-label": "Primary Navigation", children: [coreItems.map((item) => (_jsxs("button", { className: `gtn-link ${activePage === item.id ? "gtn-link-active" : ""}`, onClick: () => onNavigate(item.id), "aria-current": activePage === item.id ? "page" : undefined, type: "button", children: [_jsx("span", { className: "gtn-link-icon", children: item.icon }), _jsx("span", { children: item.label })] }, item.id))), _jsx("div", { className: "gtn-divider", "aria-hidden": "true" }), utilityItems.map((item) => (_jsxs("button", { className: `gtn-link ${activePage === item.id ? "gtn-link-active" : ""}`, onClick: () => onNavigate(item.id), "aria-current": activePage === item.id ? "page" : undefined, type: "button", children: [_jsx("span", { className: "gtn-link-icon", children: item.icon }), _jsx("span", { children: item.label })] }, item.id)))] }), _jsx("button", { className: `gtn-settings ${activePage === "settings" ? "gtn-settings-active" : ""}`, onClick: () => onNavigate("settings"), "aria-label": "Settings", title: "Settings & Authentication", type: "button", children: "\u2699\uFE0F" })] }));
}
function renderPage(page, setPage, onBack) {
    switch (page) {
        case "home":
            return (_jsx(Home, { onOpenBlueprint: () => setPage("blueprint"), onOpenBootstrap: () => setPage("bootstrap"), onOpenValidation: () => setPage("validation"), onOpenStores: () => setPage("stores"), onOpenParts: () => setPage("parts"), onOpenService: () => setPage("service"), onOpenAccounting: () => setPage("accounting"), onOpenAnalytics: () => setPage("analytics"), onOpenAdhoc: () => setPage("adhoc"), onOpenTGPT: () => setPage("tgpt"), onOpenSettings: () => setPage("settings") }));
        case "blueprint":
            return _jsx(BlueprintDecoder, { onBack: onBack });
        case "bootstrap":
            return _jsx(BootstrapExtractor, { onBack: onBack });
        case "validation":
            return _jsx(GLValidation, { onBack: onBack });
        case "settings":
            return _jsx(Settings, { onBack: onBack });
        case "stores":
            return _jsx(Stores, { onBack: onBack });
        case "parts":
            return _jsx(Parts, { onBack: onBack });
        case "service":
            return _jsx(Service, { onBack: onBack });
        case "accounting":
            return _jsx(Accounting, { onBack: onBack });
        case "analytics":
            return _jsx(Analytics, { onBack: onBack });
        case "adhoc":
            return _jsx(Adhoc, { onBack: onBack });
        case "tgpt":
            return _jsx(TGPT, { onBack: onBack });
        case "review":
            return _jsx(Review, { onBack: onBack });
        case "syncbot":
            return _jsx(SyncBotDashboard, { onBack: onBack });
        default:
            return null;
    }
}
