import {
  loadLatestExtensionCapture,
  hasExpiredCustomToken,
  type ArcCustomCapturedApi,
} from "./extensionBridge";
import { loadGlobalHeaders, loadTekionApiSettings } from "./tekionApiSettings";
import type { KeyValuePair } from "../types/proxy.types";
import type { StoreRecord } from "./storesDb";
export type { StoreRecord };

export type TRange = 7 | 30 | 60 | 90 | 150;

const STORES_API_URL =
  "https://us-west1-tapapi.tekioncloud.com/tapapi/tap-crm-implementations-backend/public/v1/entity-instance/1";

const log = {
  info: (...args: unknown[]) => console.info("[tekionStoresApi]", ...args),
  debug: (...args: unknown[]) => console.debug("[tekionStoresApi]", ...args),
  warn: (...args: unknown[]) => console.warn("[tekionStoresApi]", ...args),
  error: (...args: unknown[]) => console.error("[tekionStoresApi]", ...args),
};

export class ExpiredCaptureTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpiredCaptureTokenError";
  }
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getUnixStartOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

function getUnixEndOfDay(date: Date): number {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return Math.floor(d.getTime() / 1000);
}

export function getTDaysRange(days: TRange) {
  const fromDate = new Date();
  const toDate = new Date();
  toDate.setDate(fromDate.getDate() + days);

  const range = {
    fromDate,
    toDate,
    fromUnix: getUnixStartOfDay(fromDate),
    toUnix: getUnixEndOfDay(toDate),
  };

  log.info("Computed T-range window", {
    days,
    fromDateIso: range.fromDate.toISOString(),
    toDateIso: range.toDate.toISOString(),
    fromUnix: range.fromUnix,
    toUnix: range.toUnix,
  });

  return range;
}

function normalizeHeaderMap(input: unknown): Record<string, string> {
  if (!isRecord(input)) return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && key.trim() && value.trim()) {
      out[key.toLowerCase()] = value.trim();
    }
  }
  return out;
}

function keyValuePairsToHeaderMap(pairs: KeyValuePair[]): Record<string, string> {
  const out: Record<string, string> = {};

  for (const pair of pairs) {
    const key = normalize(pair.key).toLowerCase();
    const value = normalize(pair.value);
    if (!pair.enabled || !key || !value) continue;
    out[key] = value;
  }

  return out;
}

function maskHeadersForLog(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      const lower = key.toLowerCase();
      if (lower.includes("token") || lower === "authorization" || lower === "cookie") {
        return [key, `present(${value.length})`];
      }
      return [key, value];
    })
  );
}

function getPreferredStoresCapture(): ArcCustomCapturedApi | null {
  const settings = loadTekionApiSettings();
  const capture = loadLatestExtensionCapture();
  const customCaptures = Object.values(capture?.customCaptures ?? {});

  const exactStoresApiCapture =
    customCaptures.find((item) => item.id === settings.storesApiCaptureId) ?? null;

  const exactProfileCapture =
    customCaptures.find((item) => item.id === settings.storesCustomCaptureId) ?? null;

  const storesEndpointFallback =
    customCaptures.find((item) =>
      normalize(item.pattern).toLowerCase().includes("/entity-instance/1")
    ) ??
    customCaptures.find((item) =>
      normalize(item.matchedUrl).toLowerCase().includes("/entity-instance/1")
    ) ??
    null;

  const userProfileFallback =
    customCaptures.find((item) =>
      normalize(item.pattern).toLowerCase().includes("/tapapi/v2/usermanagement/getuserprofile")
    ) ??
    customCaptures.find((item) =>
      normalize(item.matchedUrl).toLowerCase().includes("/tapapi/v2/usermanagement/getuserprofile")
    ) ??
    null;

  const preferred =
    exactStoresApiCapture ||
    storesEndpointFallback ||
    exactProfileCapture ||
    userProfileFallback ||
    null;

  log.info("Resolved Stores capture source", {
    selectedStoresApiCaptureId: settings.storesApiCaptureId || "(none)",
    selectedStoresCustomCaptureId: settings.storesCustomCaptureId || "(none)",
    availableCustomCaptureCount: customCaptures.length,
    chosenCapture: preferred
      ? {
          id: preferred.id,
          label: preferred.label,
          pattern: preferred.pattern,
          matchedUrl: preferred.matchedUrl,
          headerKeys: Object.keys(preferred.headers ?? {}).sort(),
          expiresAt: preferred.decodedToken?.expiresAt ?? "(unknown)",
          isExpired: preferred.decodedToken?.isExpired ?? "(unknown)",
        }
      : null,
  });

  return preferred;
}

function buildTekionStoresHeaders(): Record<string, string> {
  const selectedCapture = getPreferredStoresCapture();

  if (!selectedCapture) {
    log.error("No Stores capture found");
    throw new Error(
      'Stores auth headers are missing. Capture either "/tapapi/v2/usermanagement/getuserprofile" or "/entity-instance/1" and then reload the website.'
    );
  }

  if (hasExpiredCustomToken(selectedCapture)) {
    log.warn("Selected Stores capture token is expired", {
      captureId: selectedCapture.id,
      label: selectedCapture.label,
      expiresAt: selectedCapture.decodedToken?.expiresAt,
    });

    throw new ExpiredCaptureTokenError(
      "Captured Stores token has expired. Please reload the website to capture a fresh token."
    );
  }

  const capturedHeaders = normalizeHeaderMap(selectedCapture.headers);
  const globalHeaders = keyValuePairsToHeaderMap(loadGlobalHeaders());

  const mergedHeaders: Record<string, string> = {
    ...capturedHeaders,
    ...globalHeaders,
  };

  if (!Object.keys(mergedHeaders).length) {
    log.error("Merged Stores headers are empty");
    throw new Error(
      "Stores auth headers are empty. Please reload the website and recapture Stores headers."
    );
  }

  mergedHeaders["content-type"] = "application/json";
  mergedHeaders.accept = mergedHeaders.accept || "application/json, text/plain, */*";

  log.info("Built Stores request headers", {
    captureLabel: selectedCapture.label,
    capturePattern: selectedCapture.pattern,
    captureMatchedUrl: selectedCapture.matchedUrl,
    finalHeaderKeys: Object.keys(mergedHeaders).sort(),
    finalHeadersPreview: maskHeadersForLog(mergedHeaders),
  });

  return mergedHeaders;
}

function mapStore(item: Record<string, unknown>): StoreRecord {
  const rawTypes = item.product_types ?? item.arc_product_types;

  let typesArray: string[] = [];
  if (Array.isArray(rawTypes)) {
    typesArray = rawTypes.map((t) => String(t).trim()).filter(Boolean);
  } else if (typeof rawTypes === "string") {
    typesArray = rawTypes
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  const allowedProducts = ["ARC", "CRM", "Analytics"];
  const finalTypes = typesArray.filter((t) => allowedProducts.includes(t));

  return {
    tekion_id: normalize(item.tekion_id),
    dealer_id: normalize(item.dealer_id),
    dba_name: normalize(item.work_order_name ?? item.dealership_name ?? item.dba_name),
    // Work order launch date first; when it is blank, use the dealer launch date (data[*].launch_date).
    // Blank strings must fall through too, so use || (not ??).
    launch_date:
      [item.arc_launch_date, item.launch_date, item.actual_launch_date]
        .map((v) => normalize(v))
        .find((v) => v !== "") ?? "",
    implementation_type: normalize(
      item.workorder_consolidated_implementation_types ?? item.arc_implementation_type
    ),
    pre_production_environment_status: normalize(item.pre_production_environment_status),
    superpod_id: normalize(
      item.workorder_consolidated_super_pod_id ?? item.arc_super_pod_id ?? item.superpod_id
    ),
    product_types: normalize(finalTypes.join(", ")),

    workorder_consolidated_pdl: normalize(item.workorder_consolidated_pdl),
    dealer_pdl: normalize(item.dealer_pdl),
    arc_pdl: normalize(item.arc_pdl),

    project_implementation_tm_sync_status_tracking_id: normalize(
      item.project_implementation_tm_sync_status_tracking_id
    ),
    implementation_tm_sync_status_tracking_id: normalize(
      item.implementation_tm_sync_status_tracking_id
    ),
    base_entity_instance_id: normalize(item.base_entity_instance_id),

    onboarding_project_id: normalize(
      item.onboarding_project_id ?? item.onboardingProjectId
    ),
    ds_onboarding_project_id: normalize(
      item.ds_onboarding_project_id ?? item.dsOnboardingProjectId
    ),

    project_engagement_manager_1781169293313734451: normalize(
      item.project_engagement_manager_1781169293313734451
    ),
    fixed_ops_track_lead_1773369946675032982: normalize(
      item.fixed_ops_track_lead_1773369946675032982
    ),
    conversion_track_lead_1773369950325147526: normalize(
      item.conversion_track_lead_1773369950325147526
    ),
    accounting_track_lead_1773369945455468395: normalize(
      item.accounting_track_lead_1773369945455468395
    ),

    tenant_code: normalize(item.tenant_code),
    tenant_id: normalize(item.tenant_id),
  };
}

function extractRows(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter((item): item is Record<string, unknown> => isRecord(item));
  }

  if (isRecord(body) && Array.isArray(body.data)) {
    return body.data.filter((item): item is Record<string, unknown> => isRecord(item));
  }

  return [];
}

export async function fetchStores(days: TRange): Promise<StoreRecord[]> {
  log.info(`📡 Fetching live store data from Tekion (T-${days} days window)...`);

  const headers = buildTekionStoresHeaders();
  const allStores: StoreRecord[] = [];
  let startOffset = 0;
  const batchSize = 1000;
  let totalServerRowsFetched = 0;
  const MAX_RECORDS_SAFETY_LIMIT = 50000;

  // Compute date range ONCE outside the pagination loop
  const { fromUnix, toUnix, fromDate, toDate } = getTDaysRange(days);

  log.info("Initialized Stores query parameters", {
    days,
    fromDateIso: fromDate.toISOString(),
    toDateIso: toDate.toISOString(),
    fromUnix,
    toUnix,
    batchSize,
  });

  while (true) {
    const payload = {
      selected_filters: [
        {
          type: "parent_implementation_tm_sync_status_tracking_id",
          operator: "IN",
          values: [0],
        },
        {
          type: "product_types",
          operator: "IN",
          values: ["ARC", "CRM", "Analytics"],
        },
        {
          type: "actual_launch_date",
          operator: "BTW",
          values: [fromUnix, toUnix],
        },
      ],
      search_field: "all",
      search_text: "",
      page_info: {
        start: startOffset,
        rows: batchSize,
      },
      sort: [
        {
          field: "actual_launch_date",
          order: "ASC",
        },
        {
          field: "tekion_id",
          order: "ASC",
        },
      ],
    };

    const requestBody = {
      url: STORES_API_URL,
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      timeout: 60000,
    };

    log.info(`Sending Stores proxy request (offset: ${startOffset})...`);

    const res = await fetch("/api/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const rawText = await res.text();

    let proxyData: Record<string, unknown> = {};
    try {
      proxyData = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
    } catch {
      throw new Error(`Proxy returned non-JSON wrapper response: ${rawText.substring(0, 300)}`);
    }

    const upstreamStatus =
      typeof proxyData.status === "number" ? proxyData.status : res.status;

    if (upstreamStatus >= 400) {
      const upstreamBodyText =
        typeof proxyData.body === "string"
          ? proxyData.body
          : JSON.stringify(proxyData.body ?? "");

      if (upstreamStatus === 401 && upstreamBodyText.toLowerCase().includes("invalid token")) {
        throw new ExpiredCaptureTokenError(
          "Captured Stores token is invalid or expired. Please reload the website to capture a fresh token."
        );
      }

      throw new Error(
        `Stores API failed with ${upstreamStatus} ${String(
          proxyData.statusText ?? ""
        ).trim()} ${upstreamBodyText}`.trim()
      );
    }

    let upstreamBodyParsedUnknown: unknown = proxyData.body ?? proxyData;
    if (typeof upstreamBodyParsedUnknown === "string") {
      try {
        upstreamBodyParsedUnknown = JSON.parse(upstreamBodyParsedUnknown);
      } catch {}
    }

    const rows = extractRows(upstreamBodyParsedUnknown);

    // CRITICAL EXIT 1: Stop immediately when the API returns 0 rows
    if (!rows || rows.length === 0) {
      log.info(`[tekionStoresApi] Reached end of data (0 rows returned at offset ${startOffset}).`);
      break;
    }

    totalServerRowsFetched += rows.length;

    const mappedRows = rows.map(mapStore);
    const validRows = mappedRows.filter((item) => item.tekion_id && item.dealer_id);
    allStores.push(...validRows);

    // CRITICAL EXIT 2: Stop if page returned fewer rows than requested limit
    if (rows.length < batchSize) {
      log.info(`[tekionStoresApi] Last page reached (${rows.length} rows returned, less than batchSize ${batchSize}).`);
      break;
    }

    // CRITICAL EXIT 3: Check if total reported by server is reached
    let totalServerCount: number | undefined;
    if (isRecord(upstreamBodyParsedUnknown)) {
      const rawCount = upstreamBodyParsedUnknown.Count ?? upstreamBodyParsedUnknown.total;
      if (rawCount != null) {
        totalServerCount = Number(rawCount);
      }
    }

    if (
      Number.isFinite(totalServerCount) &&
      totalServerCount! > 0 &&
      totalServerRowsFetched >= totalServerCount!
    ) {
      log.info(`[tekionStoresApi] Fetched all ${totalServerRowsFetched} of ${totalServerCount} reported records.`);
      break;
    }

    // CRITICAL EXIT 4: Hard circuit breaker against runaway loops
    if (startOffset >= MAX_RECORDS_SAFETY_LIMIT) {
      log.warn(`[tekionStoresApi] Hit runaway pagination safeguard (${MAX_RECORDS_SAFETY_LIMIT} offset). Aborting loop.`);
      break;
    }

    startOffset += batchSize;
  }

  log.info(`✅ Successfully loaded ${allStores.length} total stores from Tekion API.`);
  return allStores;
}