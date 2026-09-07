import {
  loadLatestExtensionCapture,
  hasExpiredCustomToken,
  type ArcCustomCapturedApi,
} from "./extensionBridge";
import { loadGlobalHeaders, loadTekionApiSettings } from "./tekionApiSettings";
import type { KeyValuePair } from "../types/proxy.types";

export type TRange = 7 | 30 | 60 | 90;

export interface StoreRecord {
  tekion_id: string;
  dealer_id: string;
  dba_name: string;
  launch_date: string;
  implementation_type: string;
  pre_production_environment_status: string;
  superpod_id: string;
}

const STORES_API_URL =
  "https://us-west1-tapapi.tekioncloud.com/tapapi/tap-crm-implementations-backend/public/v1/entity-instance/1";

export class ExpiredCaptureTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpiredCaptureTokenError";
  }
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
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

  return {
    fromDate,
    toDate,
    fromUnix: getUnixStartOfDay(fromDate),
    toUnix: getUnixEndOfDay(toDate),
  };
}

function normalizeHeaderMap(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
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

  console.log("[tekionStoresApi] preferred stores custom capture resolution", {
    selectedStoresApiCaptureId: settings.storesApiCaptureId,
    selectedStoresCustomCaptureId: settings.storesCustomCaptureId,
    chosen: preferred
      ? {
          id: preferred.id,
          label: preferred.label,
          pattern: preferred.pattern,
          matchedUrl: preferred.matchedUrl,
          headerKeys: Object.keys(preferred.headers ?? {}).sort(),
          expiresAt: preferred.decodedToken?.expiresAt,
          isExpired: preferred.decodedToken?.isExpired,
        }
      : null,
  });

  return preferred;
}

function buildTekionStoresHeaders(): Record<string, string> {
  const selectedCapture = getPreferredStoresCapture();

  if (!selectedCapture) {
    throw new Error(
      'Stores auth headers are missing. Capture either "/tapapi/v2/usermanagement/getuserprofile" or "/entity-instance/1" and then reload the website.'
    );
  }

  if (hasExpiredCustomToken(selectedCapture)) {
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
    throw new Error(
      "Stores auth headers are empty. Please reload the website and recapture Stores headers."
    );
  }

  mergedHeaders["content-type"] = "application/json";
  mergedHeaders["accept"] =
    mergedHeaders["accept"] || "application/json, text/plain, */*";

  console.log("[tekionStoresApi] Built NEW stores headers", {
    selectedCaptureLabel: selectedCapture.label,
    selectedCapturePattern: selectedCapture.pattern,
    selectedCaptureMatchedUrl: selectedCapture.matchedUrl,
    expiresAt: selectedCapture.decodedToken?.expiresAt,
    isExpired: selectedCapture.decodedToken?.isExpired,
    finalHeaderKeys: Object.keys(mergedHeaders).sort(),
  });

  return mergedHeaders;
}

function mapStore(item: Record<string, unknown>): StoreRecord {
  return {
    tekion_id: normalize(item.tekion_id),
    dealer_id: normalize(item.dealer_id),
    dba_name: normalize(item.dealership_name || item.dba_name),
    launch_date: normalize(item.arc_launch_date ?? item.actual_launch_date ?? item.launch_date),
    implementation_type: normalize(
      item.workorder_consolidated_implementation_types ?? item.arc_implementation_type
    ),
    pre_production_environment_status: normalize(item.pre_production_environment_status),
    superpod_id: normalize(
      item.workorder_consolidated_super_pod_id ?? item.arc_super_pod_id ?? item.superpod_id
    ),
  };
}

function extractRows(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    return body.filter(
      (item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
    );
  }

  if (body && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.data)) {
      return record.data.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item)
      );
    }
  }

  return [];
}

function buildStoresPayload(days: TRange): Record<string, unknown> {
  const { fromUnix, toUnix } = getTDaysRange(days);

  return {
    selected_filters: [
      {
        type: "parent_implementation_tm_sync_status_tracking_id",
        operator: "IN",
        values: [0],
      },
      {
        type: "product_types",
        operator: "IN",
        values: ["ARC"],
      },
      {
        type: "actual_launch_date",
        operator: "BTW",
        values: [fromUnix, toUnix],
      },
      {
        type: "launch_date",
        operator: "BTW",
        values: [fromUnix, toUnix],
      },
      {
        type: "implementation_region_name",
        operator: "IN",
        values: [
          "Canada",
          "Enterprise",
          "Mid Market",
          "Mid Market 2",
          "United Kingdom",
          "USA East",
          "USA West and Central",
        ],
      },
    ],
    search_field: "all",
    search_text: "",
    page_info: {
      start: 0,
      rows: 200,
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
}

export async function fetchStores(days: TRange): Promise<StoreRecord[]> {
  console.log("[tekionStoresApi] fetchStores called with NEW API range:", days);

  const payload = buildStoresPayload(days);
  const headers = buildTekionStoresHeaders();

  const requestBody = {
    url: STORES_API_URL,
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    timeout: 60000,
  };

  const res = await fetch("http://localhost:4000/api/proxy", {
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

    if (
      upstreamStatus === 401 &&
      upstreamBodyText.toLowerCase().includes("invalid token")
    ) {
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

  let upstreamBody: unknown = proxyData.body ?? proxyData;

  if (typeof upstreamBody === "string") {
    try {
      upstreamBody = JSON.parse(upstreamBody);
    } catch {
      // leave as-is
    }
  }

  const rows = extractRows(upstreamBody);
  return rows
    .map(mapStore)
    .filter((item) => item.tekion_id && item.dealer_id);
}
