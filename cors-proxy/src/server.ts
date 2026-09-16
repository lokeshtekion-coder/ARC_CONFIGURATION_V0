import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import proxyRouter from "./router/proxy.routes";
import settingsRouter from "./routes/settings.route";
import validationRouter from "./routes/validation.route";
import bootstrapRouter from "./routes/bootstrap.route";
import storesSetupRouter from "./routes/storesSetup.route";
import botHealthRouter from "./routes/botHealth.route";

dotenv.config();

const app = express();
const PORT = 4000;

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

app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.listen(PORT, () => {
  console.log(`CORS proxy server running on http://localhost:${PORT}`);
});
