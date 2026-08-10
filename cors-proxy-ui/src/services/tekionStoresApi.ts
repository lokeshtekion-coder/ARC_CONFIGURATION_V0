import { loadTekionApiSettings } from "./tekionApiSettings";

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
  "https://us-west1-tapapi.tekioncloud.com/tapapi/tap-crm-implementations-backend/public/v1/implementation-dealer-st";

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

function buildTekionStoresHeaders(): Record<string, string> {
  const settings = loadTekionApiSettings();

  console.log("[tekionStoresApi] Loaded settings:", {
    hasToken: !!settings.tapDuoApiToken,
    tokenLength: settings.tapDuoApiToken?.length ?? 0,
  });

  if (!settings.tapDuoApiToken.trim()) {
    throw new Error("tap-duo-api-token is missing. Please save it in Settings.");
  }

  const headers = {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
    "cache-control": "no-cache",
    "content-type": "application/json",
    dnt: "1",
    origin: "https://tap.tekioncloud.com",
    pragma: "no-cache",
    priority: "u=1, i",
    referer: "https://tap.tekioncloud.com/",
    "sec-ch-ua": "\"Not;A=Brand\";v=\"8\", \"Chromium\";v=\"150\", \"Google Chrome\";v=\"150\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"macOS\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    "tap-duo-api-token": settings.tapDuoApiToken.trim(),
  };

  console.log("[tekionStoresApi] Built headers keys:", Object.keys(headers));
  return headers;
}

function mapStore(item: any): StoreRecord {
  return {
    tekion_id: String(item?.tekion_id ?? ""),
    dealer_id: String(item?.dealer_id ?? ""),
    dba_name: String(item?.dba_name ?? ""),
    launch_date: String(item?.actual_launch_date?.launch_date ?? ""),
    implementation_type: String(item?.implementation_type ?? ""),
    pre_production_environment_status: String(item?.pre_production_environment_status ?? ""),
    superpod_id: String(item?.implementation_tm_sync_status_tracking?.superpod_id ?? ""),
  };
}

function extractRows(body: any): any[] {
  console.log("[tekionStoresApi] Extracting rows from body shape:", {
    hasBody: !!body,
    bodyKeys: body && typeof body === "object" ? Object.keys(body) : [],
    hasData: !!body?.data,
    dataType: Array.isArray(body?.data) ? "array" : typeof body?.data,
  });

  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.data?.hits)) return body.data.hits;
  if (Array.isArray(body?.hits)) return body.hits;
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.data?.results)) return body.data.results;
  if (Array.isArray(body?.data?.data)) return body.data.data;

  return [];
}

export async function fetchStores(days: TRange): Promise<StoreRecord[]> {
  console.log("[tekionStoresApi] fetchStores called with range:", days);

  try {
    const { fromDate, toDate, fromUnix, toUnix } = getTDaysRange(days);

    const payload = {
      page_info: { start: 0, rows: 500 },
      search_text: "",
      selected_filters: [
        {
          type: "actual_launch_date_value",
          operator: "BTW",
          values: [fromUnix, toUnix],
        },
      ],
      product_type: "ARC",
    };

    console.log("[tekionStoresApi] Date window:", {
      fromDate: fromDate.toISOString(),
      toDate: toDate.toISOString(),
      fromUnix,
      toUnix,
    });

    console.log("[tekionStoresApi] Payload:", payload);

    const requestBody = {
      url: STORES_API_URL,
      method: "POST",
      headers: buildTekionStoresHeaders(),
      body: JSON.stringify(payload),
    };

    console.log("[tekionStoresApi] Sending proxy request:", {
      url: requestBody.url,
      method: requestBody.method,
      payload,
    });

    const res = await fetch("http://localhost:4000/api/proxy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    console.log("[tekionStoresApi] Proxy response status:", res.status, res.statusText);

    const rawText = await res.text();
    console.log("[tekionStoresApi] Proxy raw response text:", rawText);

    let proxyData: any;
    try {
      proxyData = rawText ? JSON.parse(rawText) : {};
    } catch (parseError) {
      console.error("[tekionStoresApi] Failed to parse proxy response JSON:", parseError);
      throw new Error(`Proxy returned non-JSON response: ${rawText.substring(0, 300)}`);
    }

    console.log("[tekionStoresApi] Proxy response data:", proxyData);

    if (!res.ok) {
      throw new Error(proxyData?.error ?? proxyData?.body ?? `HTTP ${res.status}`);
    }

    const body =
      typeof proxyData.body === "string"
        ? JSON.parse(proxyData.body)
        : proxyData.body;

    console.log("[tekionStoresApi] Parsed upstream body:", body);

    const rows = extractRows(body);
    console.log("[tekionStoresApi] Rows count:", rows.length);

    const mapped = rows.map(mapStore);
    console.log("[tekionStoresApi] Mapped stores count:", mapped.length);

    return mapped;
  } catch (error) {
    console.error("[tekionStoresApi] fetchStores failed:", error);
    throw error;
  }
}
