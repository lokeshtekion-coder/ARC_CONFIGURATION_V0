import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import proxyRouter from "./router/proxy.routes";
import settingsRouter from "./routes/settings.route";
import validationRouter from "./routes/validation.route";
import bootstrapRouter from "./routes/bootstrap.route";
import storesSetupRouter from "./routes/storesSetup.route";
import storesBackupRouter from "./routes/storesBackup.route";
import botHealthRouter from "./routes/botHealth.route";
import versionRouter from "./routes/version.route";
import { logError } from "./utils/logger";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors());

// Increase JSON body parser to 50MB so large store snapshots never get dropped
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "cors-proxy",
    port: PORT,
  });
});

// Mount specific subroutes first, then base route
app.use("/api/stores/setup", storesSetupRouter);
app.use("/api/stores", storesBackupRouter);

app.use("/api/proxy", proxyRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/validation", validationRouter);
app.use("/api/bootstrap", bootstrapRouter);
app.use("/api/bot", botHealthRouter);
app.use("/api", versionRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logError("server", `Unhandled error on ${req.method} ${req.path}`, err);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(PORT, () => {
  console.log(`CORS proxy server running on http://localhost:${PORT}`);
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `\n[cors-proxy] Port ${PORT} is already in use on this machine.\n` +
        `Either stop whatever else is using it, or start this server on a different port:\n` +
        `  PORT=4001 npm run dev\n`
    );
  } else {
    console.error("[cors-proxy] Failed to start server:", err.message);
  }
  process.exit(1);
});