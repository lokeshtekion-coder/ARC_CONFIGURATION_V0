import { Router } from "express";
import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { logError } from "../utils/logger";

const router = Router();

// Written by scripts/auto-update.cjs at launch (npm run dev), one level up
// from cors-proxy/. Read-only here - this route never triggers a git action.
const STATUS_FILE = path.resolve(__dirname, "../../../.arc-update-status.json");

router.get("/version", (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(STATUS_FILE)) {
      res.json({ success: true, data: null });
      return;
    }
    const status = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
    res.json({ success: true, data: status });
  } catch (err: unknown) {
    logError("version", "GET /version failed", err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Failed to read update status",
    });
  }
});

export default router;
