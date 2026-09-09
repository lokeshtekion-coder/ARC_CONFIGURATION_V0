// /Users/tlreddy/Desktop/ARC_CONFIGURATION_V0/setup.js
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { execSync } = require("child_process");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (query, defaultVal) =>
  new Promise((resolve) =>
    rl.question(`${query} [${defaultVal}]: `, (ans) => resolve(ans.trim() || defaultVal))
  );

async function init() {
  console.log("⚡ ARC Configuration Workspace Initializer\n");

  const backendPort = await ask("Backend proxy port", "4000");
  const frontendPort = await ask("Frontend UI port", "5174");
  const runInstall = await ask("Run npm install automatically? (y/N)", "N");

  rl.close();

  // Template dictionary with dynamic port injection
  const files = {
    // ── BACKEND ───────────────────────────────────────────────────────────────
    "cors-proxy/package.json": `{
  "name": "cors-proxy",
  "version": "1.0.0",
  "scripts": {
    "dev": "ts-node-dev --respawn src/server.ts",
    "build": "tsc",
    "start": "node dist/server.js"
  },
  "dependencies": {
    "axios": "^1.7.2",
    "cors": "^2.8.5",
    "express": "^4.19.2",
    "morgan": "^1.10.0"
  },
  "devDependencies": {
    "@types/cors": "^2.8.17",
    "@types/express": "^4.17.21",
    "@types/morgan": "^1.9.9",
    "@types/node": "^20.14.0",
    "ts-node-dev": "^2.0.0",
    "typescript": "^5.4.5"
  }
}`,

    "cors-proxy/tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "CommonJS",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}`,

    "cors-proxy/src/types/proxy.types.ts": `export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface ProxyRequestBody {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string>;
  timeout?: number;
}

export interface ProxyResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
  requestUrl: string;
  method: HttpMethod;
  durationMs: number;
}

export interface ProxyErrorResponse {
  error: string;
  code?: string | number;
  status?: number;
  requestUrl?: string;
}`,

    "cors-proxy/src/middleware/cors.middleware.ts": `import { RequestHandler } from "express";
import cors, { CorsOptions } from "cors";

const ALLOWED_ORIGINS: (string | RegExp)[] = [
  "http://localhost:3000",
  "http://localhost:${frontendPort}",
  "http://localhost:8080",
  /^https:\\/\\/.*\\.tekion\\.com$/,
];

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = ALLOWED_ORIGINS.some((pattern) =>
      pattern instanceof RegExp ? pattern.test(origin) : pattern === origin
    );
    if (allowed) {
      callback(null, true);
    } else {
      callback(new Error(\`CORS blocked: origin '\${origin}' not allowed\`));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "X-Proxy-Target",
  ],
  exposedHeaders: ["X-Proxy-Duration-Ms", "X-Proxy-Status"],
  credentials: true,
  optionsSuccessStatus: 204,
};

export const corsMiddleware: RequestHandler = cors(corsOptions);`,

    "cors-proxy/src/middleware/logger.middleware.ts": `import morgan, { StreamOptions } from "morgan";
import { RequestHandler } from "express";

const stream: StreamOptions = {
  write: (message) => process.stdout.write(message),
};

morgan.token("body", (req: any) => {
  const body = req.body;
  if (!body || Object.keys(body).length === 0) return "-";
  return JSON.stringify(body).slice(0, 200);
});

export const loggerMiddleware: RequestHandler = morgan(
  ":method :url :status :response-time ms — body: :body",
  { stream }
);`,

    "cors-proxy/src/router/proxy.routes.ts": `import { Router, Request, Response } from "express";
import axios, { AxiosRequestConfig, AxiosError } from "axios";
import {
  ProxyRequestBody,
  ProxyResponse,
  ProxyErrorResponse,
  HttpMethod,
} from "../types/proxy.types";

const router = Router();

const SUPPORTED_METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH"];

function sanitizeHeaders(headers: Record<string, string> = {}): Record<string, string> {
  const blocked = new Set(["host", "content-length", "connection", "origin"]);
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => !blocked.has(key.toLowerCase()))
  );
}

function resolveMethod(raw?: string): HttpMethod {
  const upper = (raw ?? "GET").toUpperCase() as HttpMethod;
  return SUPPORTED_METHODS.includes(upper) ? upper : "GET";
}

router.post("/proxy", async (req: Request, res: Response): Promise<void> => {
  const {
    url,
    method: rawMethod,
    headers = {},
    body,
    params,
    timeout = 30_000,
  }: ProxyRequestBody = req.body;

  if (!url) {
    res.status(400).json({ error: "Missing required field: url" } satisfies ProxyErrorResponse);
    return;
  }

  const method = resolveMethod(rawMethod);
  const startTime = Date.now();

  const config: AxiosRequestConfig = {
    url,
    method,
    headers: {
      "Content-Type": "application/json",
      ...sanitizeHeaders(headers),
    },
    params,
    timeout,
    validateStatus: () => true,
  };

  if (method !== "GET" && body !== undefined) {
    config.data = body;
  }

  try {
    const upstream = await axios(config);
    const durationMs = Date.now() - startTime;

    const responsePayload: ProxyResponse = {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: upstream.headers as Record<string, string>,
      data: upstream.data,
      requestUrl: url,
      method,
      durationMs,
    };

    res.setHeader("X-Proxy-Duration-Ms", durationMs);
    res.setHeader("X-Proxy-Status", upstream.status);
    res.status(200).json(responsePayload);
  } catch (err) {
    const axiosErr = err as AxiosError;
    const durationMs = Date.now() - startTime;

    const errorPayload: ProxyErrorResponse = {
      error: axiosErr.message ?? "Unknown proxy error",
      code: axiosErr.code,
      status: axiosErr.response?.status,
      requestUrl: url,
    };

    res.setHeader("X-Proxy-Duration-Ms", durationMs);
    res.status(502).json(errorPayload);
  }
});

router.get("/proxy/health", (_req: Request, res: Response): void => {
  res.status(200).json({
    status: "OK",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

export default router;`,

    "cors-proxy/src/server.ts": `import express, { Application, Request, Response, NextFunction } from "express";
import { corsMiddleware } from "./middleware/cors.middleware";
import { loggerMiddleware } from "./middleware/logger.middleware";
import proxyRouter from "./router/proxy.routes";

const app: Application = express();
const PORT = process.env.PORT ?? ${backendPort};

app.use(corsMiddleware);
app.options("*", corsMiddleware);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(loggerMiddleware);

app.use("/api", proxyRouter);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Route not found" });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Server Error]", err.message);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(\`✅  CORS Proxy running → http://localhost:\${PORT}\`);
  console.log(\`📡  Health check    → http://localhost:\${PORT}/api/proxy/health\`);
});`,

    // ── FRONTEND ──────────────────────────────────────────────────────────────
    "cors-proxy-ui/package.json": `{
  "name": "cors-proxy-ui",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.4.5",
    "vite": "^5.3.1"
  }
}`,

    "cors-proxy-ui/tsconfig.json": `{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "./dist"
  },
  "include": ["src"]
}`,

    "cors-proxy-ui/vite.config.ts": `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: ${frontendPort},
    proxy: {
      "/api": {
        target: "http://localhost:${backendPort}",
        changeOrigin: true,
      },
    },
  },
});`,

    "cors-proxy-ui/index.html": `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>CORS Proxy Dev Tool</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,

    "cors-proxy-ui/src/main.tsx": `import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`,

    "cors-proxy-ui/src/types/proxy.types.ts": `export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface KeyValuePair {
  key: string;
  value: string;
  enabled: boolean;
}

export interface RequestState {
  url: string;
  method: HttpMethod;
  headers: KeyValuePair[];
  params: KeyValuePair[];
  body: string;
}

export interface ProxyEnvelope {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: unknown;
  requestUrl: string;
  method: HttpMethod;
  durationMs: number;
}

export interface ProxyError {
  error: string;
  code?: string | number;
  status?: number;
  requestUrl?: string;
}

export interface HistoryEntry {
  id: string;
  method: HttpMethod;
  url: string;
  status: number;
  durationMs: number;
  timestamp: string;
  response: ProxyEnvelope;
}`,

    "cors-proxy-ui/src/utils/proxy.ts": `import type { HttpMethod, ProxyEnvelope, RequestState } from "../types/proxy.types";

const PROXY_BASE = "http://localhost:${backendPort}/api/proxy";

export async function sendProxyRequest(state: RequestState): Promise<ProxyEnvelope> {
  const enabledHeaders = state.headers
    .filter((h) => h.enabled && h.key.trim())
    .reduce<Record<string, string>>((acc, h) => {
      acc[h.key.trim()] = h.value;
      return acc;
    }, {});

  const enabledParams = state.params
    .filter((p) => p.enabled && p.key.trim())
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.key.trim()] = p.value;
      return acc;
    }, {});

  let parsedBody: unknown = undefined;
  if (state.method !== "GET" && state.body.trim()) {
    try {
      parsedBody = JSON.parse(state.body);
    } catch {
      throw new Error("Request body is not valid JSON");
    }
  }

  const payload: {
    url: string;
    method: HttpMethod;
    headers?: Record<string, string>;
    params?: Record<string, string>;
    body?: unknown;
  } = {
    url: state.url,
    method: state.method,
  };

  if (Object.keys(enabledHeaders).length > 0) payload.headers = enabledHeaders;
  if (Object.keys(enabledParams).length > 0) payload.params = enabledParams;
  if (parsedBody !== undefined) payload.body = parsedBody;

  const res = await fetch(PROXY_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Proxy request failed");
  return json as ProxyEnvelope;
}`,

    "cors-proxy-ui/src/components/HeadersEditor.tsx": `import React from "react";
import type { KeyValuePair } from "../types/proxy.types";

interface Props {
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  placeholder?: [string, string];
}

export const KeyValueEditor: React.FC<Props> = ({
  pairs,
  onChange,
  placeholder = ["Key", "Value"],
}) => {
  const update = (index: number, field: keyof KeyValuePair, value: string | boolean) => {
    const updated = pairs.map((p, i) => (i === index ? { ...p, [field]: value } : p));
    onChange(updated);
  };

  const addRow = () => onChange([...pairs, { key: "", value: "", enabled: true }]);
  const removeRow = (index: number) => onChange(pairs.filter((_, i) => i !== index));

  return (
    <div className="kv-editor">
      {pairs.map((pair, i) => (
        <div key={i} className="kv-row">
          <input
            type="checkbox"
            checked={pair.enabled}
            onChange={(e) => update(i, "enabled", e.target.checked)}
            className="kv-check"
          />
          <input
            type="text"
            value={pair.key}
            placeholder={placeholder[0]}
            onChange={(e) => update(i, "key", e.target.value)}
            className="kv-input"
          />
          <input
            type="text"
            value={pair.value}
            placeholder={placeholder[1]}
            onChange={(e) => update(i, "value", e.target.value)}
            className="kv-input"
          />
          <button onClick={() => removeRow(i)} className="kv-remove" title="Remove">✕</button>
        </div>
      ))}
      <button onClick={addRow} className="kv-add">+ Add Row</button>
    </div>
  );
};`,

    "cors-proxy-ui/src/components/BodyEditor.tsx": `import React from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}

export const BodyEditor: React.FC<Props> = ({ value, onChange, disabled }) => {
  const prettify = () => {
    try {
      onChange(JSON.stringify(JSON.parse(value), null, 2));
    } catch {}
  };

  return (
    <div className="body-editor">
      <div className="body-toolbar">
        <span className="body-label">JSON Body</span>
        {!disabled && (
          <button onClick={prettify} className="btn-secondary btn-sm">Prettify</button>
        )}
      </div>
      <textarea
        className="body-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder='{ "key": "value" }'
        disabled={disabled}
        spellCheck={false}
        rows={10}
      />
    </div>
  );
};`,

    "cors-proxy-ui/src/components/ResponseViewer.tsx": `import React, { useState } from "react";
import type { ProxyEnvelope } from "../types/proxy.types";

interface Props {
  response: ProxyEnvelope | null;
  error: string | null;
  loading: boolean;
}

type Tab = "body" | "headers" | "info";

export const ResponseViewer: React.FC<Props> = ({ response, error, loading }) => {
  const [tab, setTab] = useState<Tab>("body");

  const statusColor = (s: number) =>
    s < 300 ? "status-ok" : s < 400 ? "status-redirect" : "status-client-err";

  if (loading) return (
    <div className="response-panel response-loading">
      <div className="spinner" /><span>Sending request…</span>
    </div>
  );

  if (error) return (
    <div className="response-panel response-error">
      <div className="error-icon">✕</div>
      <pre className="error-text">{error}</pre>
    </div>
  );

  if (!response) return (
    <div className="response-panel response-empty">
      <div className="empty-icon">📡</div>
      <p>Hit <strong>Send</strong> to see the response here</p>
    </div>
  );

  const bodyString =
    typeof response.data === "string"
      ? response.data
      : JSON.stringify(response.data, null, 2);

  return (
    <div className="response-panel">
      <div className="response-statusbar">
        <span className={\`status-badge \${statusColor(response.status)}\`}>
          {response.status} {response.statusText}
        </span>
        <span className="response-meta">{response.durationMs}ms</span>
        <span className="response-meta">{response.method}</span>
      </div>

      <div className="tab-bar">
        {(["body", "headers", "info"] as Tab[]).map((t) => (
          <button
            key={t}
            className={\`tab-btn \${tab === t ? "tab-active" : ""}\`}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {tab === "body" && <pre className="response-body">{bodyString}</pre>}
        {tab === "headers" && (
          <table className="headers-table">
            <thead><tr><th>Key</th><th>Value</th></tr></thead>
            <tbody>
              {Object.entries(response.headers).map(([k, v]) => (
                <tr key={k}>
                  <td className="header-key">{k}</td>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === "info" && (
          <div className="info-grid">
            <div className="info-row"><span>URL</span><code>{response.requestUrl}</code></div>
            <div className="info-row"><span>Method</span><code>{response.method}</code></div>
            <div className="info-row"><span>Status</span><code>{response.status}</code></div>
            <div className="info-row"><span>Duration</span><code>{response.durationMs}ms</code></div>
          </div>
        )}
      </div>
    </div>
  );
};`,

    "cors-proxy-ui/src/components/RequestBuilder.tsx": `import React, { useState } from "react";
import type { HttpMethod, KeyValuePair, RequestState } from "../types/proxy.types";
import { KeyValueEditor } from "./HeadersEditor";
import { BodyEditor } from "./BodyEditor";

interface Props {
  onSend: (state: RequestState) => void;
  loading: boolean;
}

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH"];
const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: "#30d158", POST: "#0a84ff", PUT: "#ff9f0a", DELETE: "#ff453a", PATCH: "#bf5af2",
};

type RequestTab = "params" | "headers" | "body";
const defaultPair = (): KeyValuePair => ({ key: "", value: "", enabled: true });

export const RequestBuilder: React.FC<Props> = ({ onSend, loading }) => {
  const [url, setUrl]         = useState("https://jsonplaceholder.typicode.com/posts");
  const [method, setMethod]   = useState<HttpMethod>("GET");
  const [tab, setTab]         = useState<RequestTab>("params");
  const [params, setParams]   = useState<KeyValuePair[]>([defaultPair()]);
  const [headers, setHeaders] = useState<KeyValuePair[]>([
    { key: "Content-Type", value: "application/json", enabled: true },
  ]);
  const [body, setBody] = useState("{\n  \n}");

  const isBodyDisabled = method === "GET";

  return (
    <div className="request-builder">
      <div className="url-bar">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as HttpMethod)}
          className="method-select"
          style={{ color: METHOD_COLORS[method] }}
        >
          {METHODS.map((m) => (
            <option key={m} value={m} style={{ color: METHOD_COLORS[m] }}>{m}</option>
          ))}
        </select>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.example.com/endpoint"
          className="url-input"
          onKeyDown={(e) => e.key === "Enter" && !loading && onSend({ url, method, headers, params, body })}
        />
        <button
          onClick={() => onSend({ url, method, headers, params, body })}
          disabled={loading || !url.trim()}
          className="btn-send"
        >
          {loading ? "Sending…" : "Send"}
        </button>
      </div>

      <div className="tab-bar">
        {(["params", "headers", "body"] as RequestTab[]).map((t) => (
          <button
            key={t}
            className={\`tab-btn \${tab === t ? "tab-active" : ""} \${t === "body" && isBodyDisabled ? "tab-disabled" : ""}\`}
            onClick={() => setTab(t)}
            disabled={t === "body" && isBodyDisabled}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === "body" && isBodyDisabled && <span className="tab-badge">N/A for GET</span>}
          </button>
        ))}
      </div>

      <div className="tab-content">
        {tab === "params" && <KeyValueEditor pairs={params} onChange={setParams} placeholder={["Param Key", "Param Value"]} />}
        {tab === "headers" && <KeyValueEditor pairs={headers} onChange={setHeaders} placeholder={["Header Key", "Header Value"]} />}
        {tab === "body" && !isBodyDisabled && <BodyEditor value={body} onChange={setBody} />}
      </div>
    </div>
  );
};`,

    "cors-proxy-ui/src/App.tsx": `import React, { useState } from "react";
import { RequestBuilder } from "./components/RequestBuilder";
import { ResponseViewer } from "./components/ResponseViewer";
import { sendProxyRequest } from "./utils/proxy";
import type { HistoryEntry, ProxyEnvelope, RequestState } from "./types/proxy.types";
import "./app.css";

export const App: React.FC = () => {
  const [response, setResponse] = useState<ProxyEnvelope | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [history, setHistory]   = useState<HistoryEntry[]>([]);

  const handleSend = async (state: RequestState) => {
    setLoading(true);
    setError(null);
    setResponse(null);
    try {
      const result = await sendProxyRequest(state);
      setResponse(result);
      setHistory((prev) => [
        {
          id: crypto.randomUUID(),
          method: state.method,
          url: state.url,
          status: result.status,
          durationMs: result.durationMs,
          timestamp: new Date().toLocaleTimeString(),
          response: result,
        },
        ...prev.slice(0, 19),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const statusColor = (s: number) =>
    s < 300 ? "#30d158" : s < 400 ? "#ff9f0a" : "#ff453a";

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-logo">
          <span className="logo-icon">⚡</span>
          <span className="logo-text">CORS Proxy</span>
          <span className="logo-sub">Dev Tool</span>
        </div>
        <a href="http://localhost:${backendPort}/api/proxy/health" target="_blank" rel="noreferrer" className="health-link">
          ● Backend Health
        </a>
      </header>

      <div className="app-layout">
        <aside className="sidebar">
          <div className="sidebar-title">History</div>
          {history.length === 0 && <div className="sidebar-empty">No requests yet</div>}
          {history.map((entry) => (
            <button key={entry.id} className="history-item" onClick={() => setResponse(entry.response)}>
              <span className="history-method" style={{ color: "#0a84ff" }}>{entry.method}</span>
              <span className="history-url">{entry.url.replace(/^https?:\\/\\//, "")}</span>
              <div className="history-meta">
                <span style={{ color: statusColor(entry.status) }}>{entry.status}</span>
                <span>{entry.durationMs}ms</span>
                <span>{entry.timestamp}</span>
              </div>
            </button>
          ))}
        </aside>

        <main className="main-panel">
          <section className="section">
            <RequestBuilder onSend={handleSend} loading={loading} />
          </section>
          <section className="section">
            <ResponseViewer response={response} error={error} loading={loading} />
          </section>
        </main>
      </div>
    </div>
  );
};

export default App;`,

    "cors-proxy-ui/src/app.css": `*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg: #1c1c1e; --surface: #2c2c2e; --surface2: #3a3a3c;
  --border: #48484a; --text: #f5f5f7; --text-muted: #98989d;
  --accent: #0a84ff; --radius: 10px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; min-height: 100vh; }
.app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
.app-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; background: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0; }
.app-logo { display: flex; align-items: center; gap: 8px; }
.logo-icon { font-size: 20px; }
.logo-text { font-size: 16px; font-weight: 700; }
.logo-sub { font-size: 11px; color: var(--text-muted); background: var(--surface2); padding: 2px 8px; border-radius: 20px; }
.health-link { font-size: 12px; color: #30d158; text-decoration: none; }
.health-link:hover { text-decoration: underline; }
.app-layout { display: flex; flex: 1; overflow: hidden; }
.sidebar { width: 240px; flex-shrink: 0; background: var(--surface); border-right: 1px solid var(--border); display: flex; flex-direction: column; overflow-y: auto; }
.sidebar-title { padding: 12px 16px; font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); border-bottom: 1px solid var(--border); }
.sidebar-empty { padding: 20px 16px; color: var(--text-muted); font-size: 12px; }
.history-item { width: 100%; background: none; border: none; border-bottom: 1px solid var(--border); padding: 10px 14px; text-align: left; cursor: pointer; color: var(--text); transition: background .15s; }
.history-item:hover { background: var(--surface2); }
.history-method { font-size: 11px; font-weight: 700; margin-right: 6px; }
.history-url { font-size: 11px; color: var(--text-muted); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.history-meta { display: flex; gap: 8px; margin-top: 4px; font-size: 10px; color: var(--text-muted); }
.main-panel { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.section { flex: 1; overflow: auto; padding: 16px; border-bottom: 1px solid var(--border); }
.section:last-child { border-bottom: none; }
.request-builder { display: flex; flex-direction: column; gap: 12px; }
.url-bar { display: flex; gap: 8px; align-items: center; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 6px 8px; }
.method-select { background: var(--surface2); border: none; border-radius: 6px; padding: 6px 10px; font-size: 13px; font-weight: 700; cursor: pointer; outline: none; }
.url-input { flex: 1; background: none; border: none; color: var(--text); font-size: 14px; outline: none; min-width: 0; }
.btn-send { background: var(--accent); color: #fff; border: none; border-radius: 8px; padding: 8px 20px; font-size: 14px; font-weight: 600; cursor: pointer; transition: opacity .15s; }
.btn-send:disabled { opacity: .45; cursor: not-allowed; }
.btn-send:hover:not(:disabled) { opacity: .85; }
.tab-bar { display: flex; border-bottom: 1px solid var(--border); gap: 4px; }
.tab-btn { background: none; border: none; color: var(--text-muted); padding: 8px 14px; font-size: 13px; cursor: pointer; border-bottom: 2px solid transparent; transition: color .15s, border-color .15s; display: flex; align-items: center; gap: 6px; }
.tab-btn:hover { color: var(--text); }
.tab-active { color: var(--accent) !important; border-bottom-color: var(--accent); }
.tab-disabled { opacity: .4; cursor: not-allowed; }
.tab-badge { font-size: 10px; color: var(--text-muted); }
.tab-content { padding: 12px 0; }
.kv-editor { display: flex; flex-direction: column; gap: 6px; }
.kv-row { display: flex; align-items: center; gap: 8px; }
.kv-check { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }
.kv-input { flex: 1; background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); padding: 6px 10px; font-size: 13px; outline: none; transition: border-color .15s; }
.kv-input:focus { border-color: var(--accent); }
.kv-remove { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 12px; padding: 4px; }
.kv-remove:hover { color: #ff453a; }
.kv-add { background: none; border: 1px dashed var(--border); border-radius: 6px; color: var(--text-muted); padding: 6px 12px; cursor: pointer; font-size: 12px; text-align: left; transition: border-color .15s, color .15s; }
.kv-add:hover { border-color: var(--accent); color: var(--accent); }
.body-editor { display: flex; flex-direction: column; gap: 8px; }
.body-toolbar { display: flex; justify-content: space-between; align-items: center; }
.body-label { font-size: 12px; color: var(--text-muted); font-weight: 600; }
.body-textarea { width: 100%; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-family: "SF Mono", "Fira Code", monospace; font-size: 13px; padding: 12px; resize: vertical; outline: none; line-height: 1.6; }
.body-textarea:focus { border-color: var(--accent); }
.response-panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); min-height: 200px; display: flex; flex-direction: column; }
.response-empty, .response-loading { justify-content: center; align-items: center; gap: 12px; color: var(--text-muted); font-size: 14px; }
.empty-icon { font-size: 32px; }
.response-error { padding: 20px; flex-direction: row; align-items: flex-start; gap: 12px; color: #ff453a; }
.error-icon { font-size: 20px; }
.error-text { font-family: monospace; font-size: 13px; white-space: pre-wrap; }
.spinner { width: 24px; height: 24px; border: 2px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.response-statusbar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border); }
.status-badge { font-size: 13px; font-weight: 700; padding: 2px 10px; border-radius: 20px; background: var(--surface2); }
.status-ok { color: #30d158; } .status-redirect { color: #ff9f0a; } .status-client-err { color: #ff453a; }
.response-meta { font-size: 12px; color: var(--text-muted); }
.response-body { padding: 16px; font-family: "SF Mono", "Fira Code", monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; line-height: 1.7; overflow: auto; flex: 1; }
.headers-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.headers-table th { background: var(--surface2); padding: 8px 16px; text-align: left; color: var(--text-muted); font-weight: 600; }
.headers-table td { padding: 8px 16px; border-bottom: 1px solid var(--border); word-break: break-all; }
.header-key { color: var(--accent); font-family: monospace; }
.info-grid { display: flex; flex-direction: column; gap: 8px; padding: 16px; }
.info-row { display: flex; gap: 16px; align-items: flex-start; }
.info-row span { width: 80px; color: var(--text-muted); font-size: 12px; flex-shrink: 0; }
.info-row code { font-size: 12px; word-break: break-all; }
.btn-secondary { background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); cursor: pointer; padding: 5px 12px; font-size: 12px; }
.btn-secondary:hover { border-color: var(--accent); color: var(--accent); }
.btn-sm { padding: 3px 8px; font-size: 11px; }`,
  };

  let created = 0;
  let skipped = 0;

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.resolve(__dirname, filePath);

    // Non-destructive check
    if (fs.existsSync(fullPath)) {
      console.log(`[SKIP] Already exists: ${filePath}`);
      skipped++;
      continue;
    }

    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content.trimStart(), "utf8");
    console.log(`[CREATED] ${filePath}`);
    created++;
  }

  console.log(`\n🎉 Done! ${created} files created, ${skipped} skipped.`);

  if (runInstall.toLowerCase() === "y") {
    console.log("\n📦 Installing dependencies in cors-proxy...");
    execSync("npm install", { cwd: path.resolve(__dirname, "cors-proxy"), stdio: "inherit" });

    console.log("\n📦 Installing dependencies in cors-proxy-ui...");
    execSync("npm install", { cwd: path.resolve(__dirname, "cors-proxy-ui"), stdio: "inherit" });
    console.log("\n✅ Installations complete.");
  } else {
    console.log("\nNext steps:");
    console.log("  cd cors-proxy     && npm install && npm run dev");
    console.log("  cd cors-proxy-ui  && npm install && npm run dev\n");
  }

  // Final step: suggest deleting the script
  console.log("💡 Tip: If you have committed these files to Git, you can safely delete this setup.js file.");
}

init().catch(console.error);