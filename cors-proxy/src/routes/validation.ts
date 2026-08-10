import express                from "express";
import fs                     from "fs";
import path                   from "path";

const router = express.Router();
const DATA_DIR = path.join(__dirname, "../../validation-data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── POST /api/validation/save ─────────────────────────────────────────────────
router.post("/save", (req, res) => {
  const { dealerId, bootstrap, timestamp } = req.body as {
    dealerId:  string;
    bootstrap: unknown;
    timestamp: string;
  };
  if (!dealerId || !bootstrap) {
    return res.status(400).json({ error: "dealerId + bootstrap required" });
  }

  const ts      = timestamp ?? new Date().toISOString().replace(/[:.]/g, "-");
  const dir     = path.join(DATA_DIR, dealerId);
  const file    = path.join(dir, `${ts}.json`);

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ dealerId, timestamp: ts, bootstrap }, null, 2));
  res.json({ ok: true, dealerId, timestamp: ts });
});

// ── GET /api/validation/dealers ───────────────────────────────────────────────
router.get("/dealers", (_req, res) => {
  if (!fs.existsSync(DATA_DIR)) return res.json([]);
  const dealers = fs.readdirSync(DATA_DIR)
    .filter((f) => fs.statSync(path.join(DATA_DIR, f)).isDirectory());
  res.json(dealers);
});

// ── GET /api/validation/timestamps?dealerId=XXX ───────────────────────────────
router.get("/timestamps", (req, res) => {
  const { dealerId } = req.query as { dealerId?: string };
  if (!dealerId) return res.status(400).json({ error: "dealerId required" });

  const dir = path.join(DATA_DIR, dealerId);
  if (!fs.existsSync(dir)) return res.json([]);

  const timestamps = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f)    => f.replace(".json", ""))
    .sort()
    .reverse();   // newest first
  res.json(timestamps);
});

// ── GET /api/validation/run?dealerId=XXX&timestamp=YYY ───────────────────────
router.get("/run", (req, res) => {
  const { dealerId, timestamp } = req.query as { dealerId?: string; timestamp?: string };
  if (!dealerId || !timestamp) {
    return res.status(400).json({ error: "dealerId + timestamp required" });
  }

  const file = path.join(DATA_DIR, dealerId, `${timestamp}.json`);
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: "Snapshot not found" });
  }

  const saved     = JSON.parse(fs.readFileSync(file, "utf-8")) as {
    bootstrap: Record<string, unknown>;
  };
  const bootstrap = saved.bootstrap;

  // ── Extract GL accounts from bootstrap and validate ─────────────────────────
  const results = validateBootstrap(bootstrap);
  res.json({ results });
});

// ── Validation logic ──────────────────────────────────────────────────────────
function validateBootstrap(bootstrap: Record<string, unknown>) {
  const glAccounts: string[] = extractGLAccounts(bootstrap);
  return glAccounts.map((token) => ({
    extractedToken:       token,
    accountNumber:        token,
    accountName:          "",
    matched:              true,    // ← replace with real matching logic
    accountName_Detected: [],
  }));
}

function extractGLAccounts(obj: unknown, found: string[] = []): string[] {
  if (typeof obj === "string" && /^\d{4,6}$/.test(obj)) found.push(obj);
  else if (Array.isArray(obj)) obj.forEach((v) => extractGLAccounts(v, found));
  else if (typeof obj === "object" && obj !== null) {
    Object.values(obj).forEach((v) => extractGLAccounts(v, found));
  }
  return [...new Set(found)];
}

export default router;
