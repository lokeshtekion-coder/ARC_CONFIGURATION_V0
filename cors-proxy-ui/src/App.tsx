import { useState, useCallback, useEffect } from "react";
import { RequestBuilder } from "./components/RequestBuilder";
import { ResponseViewer } from "./components/ResponseViewer";
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
import type { HistoryEntry } from "./pages/Home";
import type { RequestState, ResponseData, KeyValuePair } from "./types/proxy.types";
import { sendRequest } from "./utils/proxy";
import { loadTekionApiSettingsBundle } from "./services/tekionApiSettings";
import "./app.css";

type Page =
  | "home"
  | "proxy"
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

const METHOD_COLORS: Record<string, string> = {
  GET: "#30d158",
  POST: "#0a84ff",
  PUT: "#ff9f0a",
  DELETE: "#ff453a",
  PATCH: "#bf5af2",
};

export default function App() {
  const [page, setPage] = useState<Page>("home");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ResponseData | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [globalHeaders, setGlobalHeaders] = useState<KeyValuePair[]>(
    () => loadTekionApiSettingsBundle().globalHeaders
  );

  useEffect(() => {
    if (page !== "proxy") return;
    setGlobalHeaders(loadTekionApiSettingsBundle().globalHeaders);
  }, [page]);

  const handleSend = useCallback(async (state: RequestState) => {
    setLoading(true);
    setResponse(null);
    const start = Date.now();

    const latestGlobalHeaders = loadTekionApiSettingsBundle().globalHeaders;
    const merged = new Map<string, KeyValuePair>(
      latestGlobalHeaders
        .filter((header) => header.enabled && header.key.trim())
        .map((header) => [header.key.toLowerCase(), header])
    );

    state.headers
      .filter((header) => header.enabled && header.key.trim())
      .forEach((header) => {
        merged.set(header.key.toLowerCase(), header);
      });

    try {
      const res = await sendRequest({
        ...state,
        headers: Array.from(merged.values()),
      });

      const duration = Date.now() - start;
      setGlobalHeaders(latestGlobalHeaders);
      setResponse(res);
      setHistory((prev) =>
        [
          {
            method: state.method,
            url: state.url,
            status: res.status,
            duration,
            timestamp: new Date().toLocaleTimeString(),
          },
          ...prev,
        ].slice(0, 50)
      );
    } catch (err: unknown) {
      setResponse({
        status: 0,
        statusText: "Error",
        headers: {},
        body: err instanceof Error ? err.message : "Unknown error",
        duration: Date.now() - start,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  if (page === "home") {
    return (
      <Home
        history={history}
        onNewRequest={() => setPage("proxy")}
        onOpenHistory={() => setPage("proxy")}
        onOpenBlueprint={() => setPage("blueprint")}
        onOpenBootstrap={() => setPage("bootstrap")}
        onOpenValidation={() => setPage("validation")}
        onOpenSettings={() => setPage("settings")}
        onOpenStores={() => setPage("stores")}
        onOpenParts={() => setPage("parts")}
        onOpenService={() => setPage("service")}
        onOpenAccounting={() => setPage("accounting")}
        onOpenAnalytics={() => setPage("analytics")}
        onOpenAdhoc={() => setPage("adhoc")}
        onOpenTGPT={() => setPage("tgpt")}
      />
    );
  }

  if (page === "blueprint") {
    return <BlueprintDecoder onBack={() => setPage("home")} />;
  }

  if (page === "bootstrap") {
    return <BootstrapExtractor onBack={() => setPage("home")} />;
  }

  if (page === "validation") {
    return <GLValidation onBack={() => setPage("home")} />;
  }

  if (page === "settings") {
    return <Settings onBack={() => setPage("home")} />;
  }

  if (page === "stores") {
    return <Stores onBack={() => setPage("home")} />;
  }

  if (page === "parts") {
    return <Parts onBack={() => setPage("home")} />;
  }

  if (page === "service") {
    return <Service onBack={() => setPage("home")} />;
  }

  if (page === "accounting") {
    return <Accounting onBack={() => setPage("home")} />;
  }

  if (page === "analytics") {
    return <Analytics onBack={() => setPage("home")} />;
  }

  if (page === "adhoc") {
    return <Adhoc onBack={() => setPage("home")} />;
  }

  if (page === "tgpt") {
    return <TGPT onBack={() => setPage("home")} />;
  }

  const activeGlobalHeadersCount = globalHeaders.filter(
    (header) => header.enabled && header.key.trim()
  ).length;

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-logo">
          <span className="logo-icon">📮</span>
          <span className="logo-text">Postman</span>
          <span className="logo-sub">CORS Proxy</span>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn-secondary btn-sm" onClick={() => setPage("settings")}>
            ⚙️ Settings
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setPage("stores")}>
            🏬 Stores
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setPage("parts")}>
            🧩 Parts
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setPage("service")}>
            🛠 Service
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setPage("accounting")}>
            📒 Accounting
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setPage("analytics")}>
            📊 Analytics
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setPage("adhoc")}>
            ⚡ Adhoc
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setPage("tgpt")}>
            🤖 TGPT
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setPage("validation")}>
            🔍 Validation
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setPage("bootstrap")}>
            🗃 Bootstrap
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setPage("blueprint")}>
            🔎 Blueprint
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setPage("home")}>
            ← Home
          </button>
          <a
            href="http://localhost:4000/api/proxy/health"
            target="_blank"
            rel="noreferrer"
            className="health-link"
          >
            ● Health
          </a>
        </div>
      </header>

      <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar-title">History</div>
          {history.length === 0 ? (
            <div className="sidebar-empty">No requests yet</div>
          ) : (
            history.map((h, i) => (
              <button key={i} className="history-item">
                <span
                  className="history-method"
                  style={{ color: METHOD_COLORS[h.method] ?? "#98989d" }}
                >
                  {h.method}
                </span>
                <span className="history-url">{h.url}</span>
                <div className="history-meta">
                  <span style={{ color: h.status < 300 ? "#30d158" : "#ff453a" }}>
                    {h.status}
                  </span>
                  <span>{h.duration}ms</span>
                  <span>{h.timestamp}</span>
                </div>
              </button>
            ))
          )}
        </aside>

        <main className="main-panel">
          <div
            className="gh-section"
            style={{
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              borderRadius: 16,
              padding: "14px 16px",
              marginBottom: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div
                  style={{
                    color: "#f8fafc",
                    fontWeight: 700,
                    fontSize: 15,
                    marginBottom: 4,
                  }}
                >
                  📮 Global Headers
                </div>
                <div
                  style={{
                    color: "#94a3b8",
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  {activeGlobalHeadersCount} active header
                  {activeGlobalHeadersCount === 1 ? "" : "s"} applied from Settings.
                </div>
              </div>

              <button
                className="btn-secondary btn-sm"
                onClick={() => {
                  setGlobalHeaders(loadTekionApiSettingsBundle().globalHeaders);
                  setPage("settings");
                }}
              >
                Manage in Settings
              </button>
            </div>
          </div>

          <section className="section">
            <RequestBuilder onSend={handleSend} loading={loading} />
          </section>

          <section className="section">
            <ResponseViewer response={response} loading={loading} />
          </section>
        </main>
      </div>
    </div>
  );
}
