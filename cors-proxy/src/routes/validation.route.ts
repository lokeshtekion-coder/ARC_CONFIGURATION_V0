import { Router, Request, Response } from "express";
import {
  saveBlueprint,
  saveBootstrap,
  readValidation,
  getAllIndex,
  getLatestForDealer,
  saveDealerSnapshot,
  getDealers,
  getTimestamps,
  saveBlueprintByKey,    // ← ADD
} from "../services/storage.service";


import { runValidation } from "../services/validation.service";

const router = Router();

// ── POST /api/validation/blueprint ───────────────────────────────────────────
// Save Blueprint Decoder output
router.post("/blueprint", (req: Request, res: Response) => {
  const { dealerId, data } = req.body;
  if (!dealerId || !data) {
    return res.status(400).json({ error: "dealerId and data are required" });
  }
  const filePath = saveBlueprint(dealerId, data);
  return res.json({ success: true, filePath });
});

// ── POST /api/validation/blueprint-save ──────────────────────────────────────
// Save blueprint by unique key — no versioning, called from Blueprint Decoder UI
router.post("/blueprint-save", (req: Request, res: Response) => {
  const { key, data } = req.body as { key?: string; data?: unknown };
  if (!key || !data) {
    return res.status(400).json({ error: "key and data are required" });
  }
  const filePath = saveBlueprintByKey(key, data);
  return res.json({ success: true, key, filePath });
});


// ── POST /api/validation/bootstrap ───────────────────────────────────────────
// Save Bootstrap Extractor output
router.post("/bootstrap", (req: Request, res: Response) => {
  const { dealerId, data } = req.body;
  if (!dealerId || !data) {
    return res.status(400).json({ error: "dealerId and data are required" });
  }
  const filePath = saveBootstrap(dealerId, data);
  return res.json({ success: true, filePath });
});

// ── POST /api/validation/run ──────────────────────────────────────────────────
// ── POST /api/validation/save ─────────────────────────────────────────────────
// Save a full snapshot (bootstrap JSON) for a dealer — called from Bootstrap Extractor UI
router.post("/save", (req: Request, res: Response) => {
  const { dealerId, bootstrap } = req.body;
  if (!dealerId || !bootstrap) {
    return res.status(400).json({ error: "dealerId and bootstrap are required" });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  saveDealerSnapshot(dealerId, timestamp, bootstrap);
  return res.json({ success: true, dealerId, timestamp });
});

// ── GET /api/validation/dealers ───────────────────────────────────────────────
// List all dealers that have saved snapshots
router.get("/dealers", (_req: Request, res: Response) => {
  const dealers = getDealers();
  return res.json(dealers);
});

// ── GET /api/validation/timestamps ───────────────────────────────────────────
// List all timestamps for a dealer  ?dealerId=XXX
router.get("/timestamps", (req: Request, res: Response) => {
  const { dealerId } = req.query as { dealerId?: string };
  if (!dealerId) {
    return res.status(400).json({ error: "dealerId is required" });
  }
  const timestamps = getTimestamps(dealerId);
  return res.json(timestamps);
});

// Run validation for a dealer + timestamp
router.post("/run", async (req: Request, res: Response) => {
  const { dealerId, timestamp } = req.body;
  if (!dealerId || !timestamp) {
    return res.status(400).json({ error: "dealerId and timestamp are required" });
  }
  const results = await runValidation(dealerId, timestamp);
  const matched   = results.filter((r) => r.matched).length;
  const unmatched = results.filter((r) => !r.matched).length;
  return res.json({ success: true, total: results.length, matched, unmatched, results });
});

// ── GET /api/validation/result/:dealerId/:timestamp ───────────────────────────
// Read saved validation result
router.get("/result/:dealerId/:timestamp", (req: Request, res: Response) => {
  const { dealerId, timestamp } = req.params;
  const data = readValidation(dealerId, timestamp);
  return res.json({ success: true, data });
});

// ── GET /api/validation/index ─────────────────────────────────────────────────
// Get all saved files index
router.get("/index", (_req: Request, res: Response) => {
  const index = getAllIndex();
  return res.json({ success: true, index });
});

// ── GET /api/validation/latest/:dealerId ─────────────────────────────────────
// Get latest entry for a dealer
router.get("/latest/:dealerId", (req: Request, res: Response) => {
  const entry = getLatestForDealer(req.params.dealerId);
  if (!entry) {
    return res.status(404).json({ error: "No data found for dealer" });
  }
  return res.json({ success: true, entry });
});

export default router;

