// 1. MUST BE FIRST: Load environment variables before any application modules evaluate
import "dotenv/config";

import crypto from "node:crypto";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";

// Observability middleware
import loggerMiddleware from "./middleware/logger.middleware";

// Route modules
import proxyRouter from "./router/proxy.routes";
import settingsRouter from "./routes/settings.route";
import validationRouter from "./routes/validation.route";
import bootstrapRouter from "./routes/bootstrap.route";
import storesSetupRouter from "./routes/storesSetup.route";
import storesBackupRouter from "./routes/storesBackup.route";
import botHealthRouter from "./routes/botHealth.route";
import versionRouter from "./routes/version.route";
import { logError } from "./utils/logger";
import storesGlamRouter from "./routes/storesGlam.route";

// Database lifecycle
import { closeStoresDatabase, isDatabaseReady } from "./services/sqliteStores.service";

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

// ============================================================================
// CONFIGURATION & STARTUP VALIDATION
// ============================================================================
const PORT = Number(process.env.PORT) || 4000;
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PROD = NODE_ENV === "production";
const BIND_HOST = process.env.BIND_HOST || (IS_PROD ? "0.0.0.0" : "127.0.0.1");
const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== "false";

if (IS_PROD) {
  if (!process.env.API_SECRET_KEY) {
    throw new Error("FATAL: API_SECRET_KEY is required in production mode.");
  }
  if (!process.env.CORS_ORIGINS && !process.env.ALLOWED_ORIGINS) {
    console.warn("⚠️  [Security Warning] CORS_ORIGINS is not set. Cross-origin access will be blocked.");
  }
}

const app = express();

// ============================================================================
// 1. SECURITY BASELINE HEADERS
// ============================================================================
app.disable("x-powered-by");
app.use(helmet());

// ============================================================================
// 2. CONFIGURATION-DRIVEN CORS ALLOWLIST
// ============================================================================
const DEFAULT_DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:3000",
];

const envOrigins = (process.env.CORS_ORIGINS || process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const extensionOrigins = (process.env.CORS_EXTENSION_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const allowedOriginsSet = new Set([
  ...(IS_PROD ? [] : DEFAULT_DEV_ORIGINS),
  ...envOrigins,
  ...extensionOrigins,
]);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOriginsSet.has(origin)) {
        return callback(null, true);
      }
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-Request-Id",
      "x-target-url",
      "Cookie",
    ],
  })
);

// ============================================================================
// 3. SANITIZED REQUEST CORRELATION ID
// ============================================================================
function resolveRequestId(req: Request): string {
  const incoming = req.headers["x-request-id"];
  if (typeof incoming === "string" && /^[A-Za-z0-9._:-]{1,100}$/.test(incoming)) {
    return incoming;
  }
  return crypto.randomUUID();
}

app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = resolveRequestId(req);
  req.id = requestId;
  res.setHeader("X-Request-Id", requestId);
  next();
});

// ============================================================================
// 4. STRUCTURED HTTP LOGGER MIDDLEWARE (Mounted right after request ID)
// ============================================================================
app.use(loggerMiddleware);

// ============================================================================
// 5. BOUNDED IN-MEMORY RATE LIMITER
// ============================================================================
const ipHitMap = new Map<string, { count: number; resetAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipHitMap) {
    if (entry.resetAt <= now) {
      ipHitMap.delete(ip);
    }
  }
}, 60_000).unref();

const createRateLimiter = (maxRequests: number, windowMs: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!RATE_LIMIT_ENABLED) return next();

    const ip = req.ip || req.socket.remoteAddress || "unknown_ip";
    const now = Date.now();
    const entry = ipHitMap.get(ip) || { count: 0, resetAt: now + windowMs };

    if (now > entry.resetAt) {
      entry.count = 1;
      entry.resetAt = now + windowMs;
    } else {
      entry.count++;
    }

    ipHitMap.set(ip, entry);

    if (entry.count > maxRequests) {
      res.status(429).json({
        ok: false,
        error: {
          code: "TOO_MANY_REQUESTS",
          message: "Too many requests. Please slow down.",
          requestId: req.id,
        },
      });
      return;
    }
    next();
  };
};

// ============================================================================
// 6. ROUTE-SPECIFIC BODY CEILINGS
// ============================================================================
app.use(
  "/api/stores/backup",
  express.json({ limit: "50mb" }),
  express.urlencoded({ extended: true, limit: "50mb" })
);

app.use(
  "/api/proxy",
  express.json({ limit: "10mb" }),
  express.urlencoded({ extended: true, limit: "10mb" })
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// ============================================================================
// 7. HEALTH & READINESS PROBES
// ============================================================================
app.get(["/", "/health"], (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "cors-proxy",
    status: "alive",
    timestamp: new Date().toISOString(),
  });
});

app.get("/ready", (_req: Request, res: Response) => {
  const dbOk = typeof isDatabaseReady === "function" ? isDatabaseReady() : true;
  const isReady = dbOk;

  const mem = process.memoryUsage();
  res.status(isReady ? 200 : 503).json({
    ok: isReady,
    service: "cors-proxy",
    status: isReady ? "ready" : "degraded",
    checks: {
      database: dbOk ? "connected" : "unavailable",
    },
    uptimeSec: Math.floor(process.uptime()),
    memoryUsageMB: {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      rss: Math.round(mem.rss / 1024 / 1024),
    },
    timestamp: new Date().toISOString(),
  });
});

// ============================================================================
// 8. AUTHENTICATION BOUNDARY
// ============================================================================
const authGuard = (req: Request, res: Response, next: NextFunction): void => {
  if (req.method === "OPTIONS") return next();

  if (!IS_PROD && (process.env.BYPASS_AUTH === "true" || !process.env.API_SECRET_KEY)) {
    return next();
  }

  const expectedKey = process.env.API_SECRET_KEY;
  if (!expectedKey) {
    if (IS_PROD) {
      res.status(500).json({
        ok: false,
        error: { code: "AUTH_CONFIG_ERROR", message: "Server authentication misconfigured", requestId: req.id },
      });
      return;
    }
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      ok: false,
      error: { code: "UNAUTHORIZED", message: "Bearer token required", requestId: req.id },
    });
    return;
  }

  const token = authHeader.substring(7).trim();
  if (token !== expectedKey) {
    res.status(403).json({
      ok: false,
      error: { code: "FORBIDDEN", message: "Invalid access token", requestId: req.id },
    });
    return;
  }

  next();
};

app.use("/api", authGuard);

// ============================================================================
// 9. APPLICATION ROUTING
// ============================================================================
app.use("/api/stores/setup", storesSetupRouter);
app.use("/api/stores", storesBackupRouter);
app.use("/api/proxy", createRateLimiter(150, 10_000), proxyRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/validation", validationRouter);
app.use("/api/bootstrap", bootstrapRouter);
app.use("/api/bot", botHealthRouter);
app.use("/api", versionRouter);
app.use("/api/stores/glam", storesGlamRouter);

// ============================================================================
// 10. 404 & STANDARDIZED ERROR HANDLING
// ============================================================================
app.use((req: Request, res: Response) => {
  res.status(404).json({
    ok: false,
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `Cannot ${req.method} ${req.path}`,
      requestId: req.id,
    },
  });
});

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logError("server", `[${req.id}] Unhandled error on ${req.method} ${req.path}: ${err.message}`, err);

  res.status(500).json({
    ok: false,
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: IS_PROD ? "Internal server error" : err.message,
      requestId: req.id,
    },
  });
});

// ============================================================================
// 11. LIFECYCLE & IN-FLIGHT CONNECTION MANAGEMENT
// ============================================================================
const openSockets = new Set<Socket>();

const server: Server = app.listen(PORT, BIND_HOST, () => {
  console.log(`[cors-proxy] Server listening on http://${BIND_HOST}:${PORT} [${NODE_ENV}]`);
});

server.on("connection", (socket: Socket) => {
  openSockets.add(socket);
  socket.on("close", () => openSockets.delete(socket));
});

server.requestTimeout = 120_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 60_000;

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n[cors-proxy] Port ${PORT} is already in use.\n` +
      `Stop competing processes or run on a different port:\n` +
      `  PORT=${PORT + 1} npm run dev\n`
    );
  } else {
    console.error("[cors-proxy] Startup error:", err.message);
  }
  process.exit(1);
});

// ============================================================================
// 12. CLEAN RESOURCE TEARDOWN & REJECTION GUARDS
// ============================================================================
function gracefulShutdown(signal: string) {
  console.log(`\n[cors-proxy] Received ${signal}. Starting graceful teardown...`);

  server.close(() => {
    try {
      if (typeof closeStoresDatabase === "function") {
        closeStoresDatabase();
        console.log("[cors-proxy] SQLite database connection closed cleanly.");
      }
    } catch (dbErr) {
      console.error("[cors-proxy] Error closing SQLite database:", dbErr);
    }
    console.log("[cors-proxy] Network connections closed. Process terminating.");
    process.exit(0);
  });

  if ("closeIdleConnections" in server && typeof (server as any).closeIdleConnections === "function") {
    (server as any).closeIdleConnections();
  }

  setTimeout(() => {
    console.warn(`[cors-proxy] Forcing termination of ${openSockets.size} open socket(s)...`);
    for (const socket of openSockets) {
      socket.destroy();
    }
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("unhandledRejection", (reason: unknown) => {
  console.error("[cors-proxy] [FATAL] Unhandled Promise Rejection:", reason);
});

process.on("uncaughtException", (err: Error) => {
  console.error("[cors-proxy] [FATAL] Uncaught Exception:", err);
  gracefulShutdown("uncaughtException");
});
