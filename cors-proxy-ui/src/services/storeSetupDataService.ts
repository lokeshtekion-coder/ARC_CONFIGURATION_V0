import type { StoreRecord, StoreSetupData } from "./storesDb";

const log = {
  info: (...args: unknown[]) => console.info("[storeSetupDataService]", ...args),
  warn: (...args: unknown[]) => console.warn("[storeSetupDataService]", ...args),
  error: (...args: unknown[]) => console.error("[storeSetupDataService]", ...args),
};

export interface FetchSetupDataOptions {
  force?: boolean;
}

export function hasSetupData(record: StoreRecord): boolean {
  return Boolean(record.setup_data && record.setup_data.fetchedAt);
}

/**
 * Setup data is "complete" only when EVERY part was fetched with a value:
 * OEM dealer codes, Journals, Sales Chains and COA. If even one is blank/zero,
 * the dealer must be included in the next fetch.
 */
export function isSetupDataComplete(record: StoreRecord): boolean {
  const d = record.setup_data;
  if (!d || !d.fetchedAt) return false;
  return (
    (d.oemDealerCodes?.length ?? 0) > 0 &&
    (d.journalsAccessibleDealerCount ?? 0) > 0 &&
    (d.salesChainsAccessibleDealerCount ?? 0) > 0 &&
    (d.coaAccessibleDealerCount ?? 0) > 0
  );
}

/** Never let a blank/zero new value erase a previously fetched good value. */
export function mergeSetupData(prev: StoreSetupData | undefined, next: StoreSetupData): StoreSetupData {
  if (!prev) return next;
  const pick = (n: number | undefined, p: number | undefined) => ((n ?? 0) > 0 ? n! : p ?? n ?? 0);
  return {
    ...prev,
    ...next,
    oemDealerCodes: next.oemDealerCodes?.length ? next.oemDealerCodes : prev.oemDealerCodes ?? [],
    journalsAccessibleDealerCount: pick(next.journalsAccessibleDealerCount, prev.journalsAccessibleDealerCount),
    salesChainsAccessibleDealerCount: pick(next.salesChainsAccessibleDealerCount, prev.salesChainsAccessibleDealerCount),
    coaAccessibleDealerCount: pick(next.coaAccessibleDealerCount, prev.coaAccessibleDealerCount),
  };
}

export async function fetchSetupDataForStore(
  store: StoreRecord,
  options: FetchSetupDataOptions = {}
): Promise<StoreSetupData> {
  if (!options.force && isSetupDataComplete(store) && store.setup_data) {
    log.info("Setup data already complete - skipping", {
      dealerId: store.dealer_id,
      tekionId: store.tekion_id,
      fetchedAt: store.setup_data.fetchedAt,
    });
    return store.setup_data;
  }

  log.info("Calling setup route", {
    dealerId: store.dealer_id,
    tekionId: store.tekion_id,
    tenant: store.tenant_code,
    env: "preprod",
    force: Boolean(options.force),
  });

  const res = await fetch("http://localhost:4000/api/stores/setup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      dealerId: store.dealer_id,
      tenant: store.tenant_code,
      env: "preprod",
    }),
  });

  log.info("Setup route HTTP response", {
    status: res.status,
    statusText: res.statusText,
    dealerId: store.dealer_id,
    tekionId: store.tekion_id,
  });

  const json = (await res.json()) as {
    ok?: boolean;
    error?: string;
    setupData?: StoreSetupData;
  };

  if (!res.ok || !json.ok || !json.setupData) {
    log.error("Setup route failed", {
      dealerId: store.dealer_id,
      tekionId: store.tekion_id,
      error: json.error || "Unknown error",
    });
    throw new Error(json.error || "Failed to fetch setup data");
  }

  log.info("Setup route success", {
    dealerId: store.dealer_id,
    tekionId: store.tekion_id,
    oemDealerCodesCount: json.setupData.oemDealerCodes?.length ?? 0,
    journals: json.setupData.journalsAccessibleDealerCount,
    salesChains: json.setupData.salesChainsAccessibleDealerCount,
    coa: json.setupData.coaAccessibleDealerCount,
  });

  return mergeSetupData(store.setup_data, json.setupData);
}
