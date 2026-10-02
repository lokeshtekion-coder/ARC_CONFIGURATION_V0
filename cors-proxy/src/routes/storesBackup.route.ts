import { Router, Request, Response } from "express";
import { saveStoresDualSync, getStoresSnapshot, saveExcelSnapshot, getChangeLog, getAppState, setAppState } from "../services/sqliteStores.service";

const router = Router();

router.get("/backup", (_req: Request, res: Response) => {
  try {
    const snapshot = getStoresSnapshot();
    return res.status(200).json(snapshot);
  } catch (err: any) {
    console.error("[storesBackup] Read error:", err);
    return res.status(500).json({ error: "Failed to read stores snapshot" });
  }
});

router.post("/backup", (req: Request, res: Response) => {
  try {
    const { stores, vault, timeline } = req.body;
    if (!Array.isArray(stores)) {
      return res.status(400).json({ error: "stores array required in payload" });
    }

    saveStoresDualSync({ stores, vault, timeline });
    return res.status(200).json({ success: true, count: stores.length });
  } catch (err: any) {
    console.error("[storesBackup] Save error:", err);
    return res.status(500).json({ error: "Failed to persist stores snapshot" });
  }
});

// Pre-sync copy of an Excel sheet so a sync can never destroy data.
router.post("/excel-snapshot", (req: Request, res: Response) => {
  try {
    const { sheetName, rows } = req.body ?? {};
    if (typeof sheetName !== "string" || !Array.isArray(rows)) {
      return res.status(400).json({ error: "sheetName and rows[] required" });
    }
    const file = saveExcelSnapshot(sheetName, rows);
    return res.status(200).json({ success: true, file });
  } catch (err) {
    console.error("[storesBackup] Excel snapshot error:", err);
    return res.status(500).json({ error: "Failed to save Excel snapshot" });
  }
});

router.get("/changelog", (req: Request, res: Response) => {
  try {
    const id = typeof req.query.tekionId === "string" ? req.query.tekionId : undefined;
    return res.status(200).json({ changes: getChangeLog(id) });
  } catch (err) {
    return res.status(500).json({ error: "Failed to read change log" });
  }
});

router.get("/app-state/:key", (req: Request, res: Response) => {
  try {
    return res.status(200).json({ value: getAppState(req.params.key) });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message ?? "Bad request" });
  }
});

router.put("/app-state/:key", (req: Request, res: Response) => {
  try {
    setAppState(req.params.key, req.body?.value ?? null);
    return res.status(200).json({ success: true });
  } catch (err: any) {
    return res.status(400).json({ error: err?.message ?? "Bad request" });
  }
});

export default router;