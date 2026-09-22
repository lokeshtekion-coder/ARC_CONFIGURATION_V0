import { Router, Request, Response } from "express";
import { saveStoresDualSync, getStoresSnapshot } from "../services/sqliteStores.service";

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

export default router;