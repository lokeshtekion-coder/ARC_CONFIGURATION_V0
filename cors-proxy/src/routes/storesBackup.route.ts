import { Router, Request, Response } from "express";
import fs from "fs";
import path from "path";

const router = Router();
const BACKUP_DIR = path.resolve(__dirname, "../../data/backup");
const BACKUP_FILE = path.join(BACKUP_DIR, "stores_backup.json");
const TMP_FILE = path.join(BACKUP_DIR, "stores_backup.tmp");

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// GET latest backup
router.get("/backup", async (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(BACKUP_FILE)) {
      return res.status(200).json({ stores: [], updatedAt: null });
    }
    const raw = await fs.promises.readFile(BACKUP_FILE, "utf-8");
    const data = JSON.parse(raw);
    return res.status(200).json(data);
  } catch (err: any) {
    console.error("[storesBackup] Read error:", err);
    return res.status(500).json({ error: "Failed to read backup from disk" });
  }
});

// POST overwrite latest backup atomically
router.post("/backup", async (req: Request, res: Response) => {
  try {
    const { stores } = req.body;
    if (!Array.isArray(stores)) {
      return res.status(400).json({ error: "Invalid payload: stores array required" });
    }

    const payload = JSON.stringify({
      stores,
      updatedAt: new Date().toISOString(),
      count: stores.length,
    });

    // Atomic write: write to temp file first, then rename over the old file
    await fs.promises.writeFile(TMP_FILE, payload, "utf-8");
    await fs.promises.rename(TMP_FILE, BACKUP_FILE);

    return res.status(200).json({ success: true, count: stores.length });
  } catch (err: any) {
    console.error("[storesBackup] Save error:", err);
    return res.status(500).json({ error: "Failed to persist backup to disk" });
  }
});

export default router;