import { Router } from "express";
import type { Request, Response } from "express";
import { getDealers, getTimestamps, deleteDealerSnapshots } from "../services/storage.service";
import { logError } from "../utils/logger";

const router = Router();

// A dealer snapshot older than this is flagged as stale - just a heuristic
// default, not a hard business rule.
const STALE_SNAPSHOT_HOURS = 24;

interface DealerSnapshotInfo {
  dealerId: string;
  latestTimestamp: string | null;
  ageHours: number | null;
  stale: boolean;
}

// Snapshot folder names look like "2026-09-13T22-11-13-361Z" (colons swapped
// for dashes so they're filesystem-safe) - convert back to a real ISO string.
function parseSnapshotTimestamp(raw: string): Date | null {
  const isoLike = raw.replace(
    /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    "$1:$2:$3.$4Z"
  );
  const date = new Date(isoLike);
  return Number.isNaN(date.getTime()) ? null : date;
}

function computeDealerSnapshotInfo(): DealerSnapshotInfo[] {
  return getDealers().map((dealerId) => {
    const timestamps = getTimestamps(dealerId); // newest first
    const latestTimestamp = timestamps[0] ?? null;
    const latestDate = latestTimestamp ? parseSnapshotTimestamp(latestTimestamp) : null;
    const ageHours = latestDate ? (Date.now() - latestDate.getTime()) / 3_600_000 : null;

    return {
      dealerId,
      latestTimestamp,
      ageHours: ageHours !== null ? Math.round(ageHours * 10) / 10 : null,
      stale: ageHours !== null ? ageHours > STALE_SNAPSHOT_HOURS : true,
    };
  });
}

// GET /api/bot/health
// Read-only freshness check over existing dealer bootstrap snapshots.
// Used by the frontend's Data Sync Bot banner - never triggers a sync itself.
router.get("/health", (_req: Request, res: Response) => {
  try {
    const dealerInfos = computeDealerSnapshotInfo();
    const staleDealers = dealerInfos.filter((d) => d.stale);
    const freshest = dealerInfos
      .filter((d) => d.ageHours !== null)
      .sort((a, b) => (a.ageHours ?? Infinity) - (b.ageHours ?? Infinity))[0];

    res.json({
      success: true,
      data: {
        totalDealers: dealerInfos.length,
        staleDealerCount: staleDealers.length,
        staleDealerIds: staleDealers.map((d) => d.dealerId),
        newestSnapshotAgeHours: freshest?.ageHours ?? null,
        staleThresholdHours: STALE_SNAPSHOT_HOURS,
        dealers: dealerInfos,
      },
    });
  } catch (err: unknown) {
    logError("botHealth", "GET /health failed", err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Health check failed",
    });
  }
});

// DELETE /api/bot/health/snapshots
// Manual, explicit cleanup only - never called automatically. Body:
// { dealerIds: string[] }. Re-verifies each requested dealer is CURRENTLY
// stale server-side before deleting, so a stale request list (or a bug on
// the client) can't wipe out snapshots that are actually still fresh.
router.delete("/health/snapshots", (req: Request, res: Response) => {
  try {
    const requested = req.body?.dealerIds;
    if (!Array.isArray(requested) || requested.some((id) => typeof id !== "string")) {
      return res.status(400).json({ success: false, error: "Body must be { dealerIds: string[] }" });
    }

    const dealerInfos = computeDealerSnapshotInfo();
    const staleIds = new Set(dealerInfos.filter((d) => d.stale).map((d) => d.dealerId));

    const deleted: { dealerId: string; fileCount: number }[] = [];
    const skipped: string[] = [];

    for (const dealerId of requested as string[]) {
      if (!staleIds.has(dealerId)) {
        skipped.push(dealerId);
        continue;
      }
      const fileCount = deleteDealerSnapshots(dealerId);
      deleted.push({ dealerId, fileCount });
    }

    res.json({
      success: true,
      data: {
        deleted,
        skipped,
        skippedReason: skipped.length > 0 ? "Not currently flagged as stale - left untouched." : undefined,
      },
    });
  } catch (err: unknown) {
    logError("botHealth", "DELETE /health/snapshots failed", err);
    res.status(500).json({
      success: false,
      error: err instanceof Error ? err.message : "Cleanup failed",
    });
  }
});

export default router;
