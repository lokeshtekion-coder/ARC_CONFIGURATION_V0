import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

/* ─── Types ───────────────────────────────────────────────── */

interface RawOption      { id: string; name: string; }
interface RawAccount     { accountName: string; accountNumber: string; active: boolean; id: string; accountTypeId: string; }
interface RawCustomField { key: string; options?: RawOption[]; }
interface RawJournal     { id: string; journalName: string; journalNumber: string; }

interface RawData {
  allAccounts: { masterAssetDocMap: Record<string, RawAccount>      };
  customField:  { masterAssetDocMap: Record<string, RawCustomField> };
  allJournals:  { masterAssetDocMap: Record<string, RawJournal>     };
}

/* ─── Constants ───────────────────────────────────────────── */

const COST_CENTER_KEYS = new Set<string>([
  "DEPARTMENT",
  "REPAIR_ORDER_WARRANTY",
  "REPAIR_ORDER_CP_IW_SPLIT",
  "PARTS_SALES_ORDER_INTERNAL",
  "REPAIR_ORDER_INTERNAL",
]);

/* ─── Validation ──────────────────────────────────────────── */

function validateData(data: unknown): RawData {
  const d = data as Record<string, unknown>;
  if (!d) throw new Error("Missing 'data'");

  const checks: Array<[string, unknown]> = [
    ["allAccounts",                    d.allAccounts],
    ["allAccounts.masterAssetDocMap",  (d.allAccounts as Record<string, unknown>)?.masterAssetDocMap],
    ["customField",                    d.customField],
    ["customField.masterAssetDocMap",  (d.customField  as Record<string, unknown>)?.masterAssetDocMap],
    ["allJournals",                    d.allJournals],
    ["allJournals.masterAssetDocMap",  (d.allJournals  as Record<string, unknown>)?.masterAssetDocMap],
  ];

  for (const [key, value] of checks) {
    if (!value || typeof value !== "object")
      throw new Error(`Missing: data.${key}`);
  }

  return d as unknown as RawData;
}

/* ─── Extraction ──────────────────────────────────────────── */

function extract(data: RawData) {
  const glAccounts = Object.entries(data.allAccounts.masterAssetDocMap)
    .filter(([, a]) => a.active === true)
    .map(([key, a]) => ({
      key,
      accountName:   a.accountName   ?? "",
      accountNumber: a.accountNumber ?? "",
      active:        a.active        ?? false,
      id:            a.id            ?? "",
      accountTypeId: a.accountTypeId ?? "",
    }));

  const costCenterSetup = Object.entries(data.customField.masterAssetDocMap)
    .filter(([, cf]) => COST_CENTER_KEYS.has(cf.key))
    .map(([key, cf]) => ({
      key,
      customFieldKey: cf.key ?? "",
      options: (cf.options ?? []).map((opt) => ({ id: opt.id ?? "", name: opt.name ?? "" })),
    }));

  const journals = Object.entries(data.allJournals.masterAssetDocMap)
    .map(([key, j]) => ({
      key,
      id:            j.id            ?? "",
      journalName:   j.journalName   ?? "",
      journalNumber: j.journalNumber ?? "",
    }));

  const foundKeys   = costCenterSetup.map((cc) => cc.customFieldKey);
  const missingKeys = [...COST_CENTER_KEYS].filter((k) => !foundKeys.includes(k));

  return {
    glAccounts,
    costCenterSetup,
    journals,
    meta: {
      totalGLAccounts:        glAccounts.length,
      costCenterKeysFound:    foundKeys.length,
      costCenterKeysExpected: COST_CENTER_KEYS.size,
      totalJournals:          journals.length,
      foundKeys,
      missingKeys,
    },
  };
}

/* ─── Routes ──────────────────────────────────────────────── */

// POST /api/bootstrap/extract
router.post("/extract", (req: Request, res: Response) => {
  try {
    const data = validateData(req.body?.data ?? req.body);
    const result = extract(data);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    res.status(400).json({
      success: false,
      error: err instanceof Error ? err.message : "Extraction failed",
    });
  }
});

// GET /api/bootstrap/keys
router.get("/keys", (_req: Request, res: Response) => {
  res.json({ costCenterKeys: [...COST_CENTER_KEYS] });
});

export default router;
