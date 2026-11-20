// Duplicate store rows (same tekion_id) can come back from the store list with different product
// sets, e.g. "Analytics, ARC, CRM" and "ARC". Rule (used by the Stores page, the manual fetch and the bot):
//   1. Keep the row that lists more products, so a narrower duplicate never replaces the complete one.
//   2. If the product count is a tie, keep the row that has more data filled in for the dealership.
//   3. If that is also a tie, keep the incoming row (deterministic, never left to chance).

export function productTypeList(store: { product_types?: string | null; products?: unknown }): string[] {
  const raw = String(store.product_types || (store as any).products || "");
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

/** Number of fields that carry a value (not blank, null, or an empty list). */
export function filledDataCount(store: Record<string, unknown>): number {
  let count = 0;
  for (const value of Object.values(store)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0) continue;
    count++;
  }
  return count;
}

/** True when `incoming` should replace `current` for the same tekion_id. */
export function incomingWins(
  incoming: { product_types?: string | null; products?: unknown },
  current: { product_types?: string | null; products?: unknown }
): boolean {
  const inProducts = productTypeList(incoming).length;
  const curProducts = productTypeList(current).length;
  if (inProducts !== curProducts) return inProducts > curProducts;
  const inData = filledDataCount(incoming as Record<string, unknown>);
  const curData = filledDataCount(current as Record<string, unknown>);
  if (inData !== curData) return inData > curData;
  return true;
}

/**
 * If the kept row has no launch date (e.g. the work order launch date is blank), borrow it from a
 * duplicate row of the same tekion_id. Same tekion_id = same dealership, so the date applies to both.
 */
function fillLaunchDate<T extends { launch_date?: string | null }>(winner: T, duplicates: T[]): T {
  if (String(winner.launch_date ?? "").trim()) return winner;
  const donor = duplicates.find((r) => String(r.launch_date ?? "").trim());
  return donor ? { ...winner, launch_date: donor.launch_date } : winner;
}

export function keepPreferredStores<
  T extends { tekion_id: string; product_types?: string | null; products?: unknown; launch_date?: string | null }
>(entries: Array<[string, T]>): T[] {
  const byId = new Map<string, T>();
  const groups = new Map<string, T[]>();
  for (const [id, record] of entries) {
    const group = groups.get(id) ?? [];
    group.push(record);
    groups.set(id, group);
    const current = byId.get(id);
    if (!current || incomingWins(record, current)) byId.set(id, record);
  }
  return Array.from(byId.entries()).map(([id, winner]) => fillLaunchDate(winner, groups.get(id) ?? []));
}

/** Dedupe a plain list of store rows by tekion_id using the same rule. */
export function dedupeStoreList<
  T extends { tekion_id: string; product_types?: string | null; products?: unknown; launch_date?: string | null }
>(
  list: T[]
): T[] {
  return keepPreferredStores<T>(list.map((record) => [record.tekion_id, record] as [string, T]));
}
