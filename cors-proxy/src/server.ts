import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import proxyRouter from "./router/proxy.routes";
import settingsRouter from "./routes/settings.route";
import validationRouter from "./routes/validation.route";
import bootstrapRouter from "./routes/bootstrap.route";
import storesSetupRouter from "./routes/storesSetup.route";
import botHealthRouter from "./routes/botHealth.route";
import versionRouter from "./routes/version.route";
import { logError } from "./utils/logger";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 4000;

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "cors-proxy",
    port: PORT,
  });
});

app.use("/api/proxy", proxyRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/validation", validationRouter);
app.use("/api/bootstrap", bootstrapRouter);
app.use("/api/stores/setup", storesSetupRouter);
app.use("/api/bot", botHealthRouter);
app.use("/api", versionRouter);

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Catches anything a route handler throws synchronously (or forwards via
// next(err)) that wasn't already caught locally - without this, Express's
// default handler swallows the real error and the terminal shows nothing
// useful about why a request 500'd.
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
