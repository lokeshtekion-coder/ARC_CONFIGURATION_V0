import { loadTekionApiSettingsBundle } from "./tekionApiSettings";
import {
  loadLatestExtensionCapture,
  ArcCustomCapturedApi,
} from "./extensionBridge";

export type BlueprintModule = "parts" | "service" | "accounting";

export interface BlueprintFormListItem {
  formId: string;
  releaseId: string; // Stores hit.id for the /formRelease/{id} endpoint
  responseId: string;
  formName: string;
  tekionId?: string;
  dealerName?: string;
  status?: string;
  permission?: string;
  lastReleasedTime?: string | number;
  [key: string]: unknown;
}

const FORMS_API_URL =
  "https://us-west1-tapapi-01.tekioncloud.com/dealer-onboarding/u/forms/responses";
const FORM_DETAIL_BASE_URL =
  "https://us-west1-tapapi-01.tekioncloud.com/dealer-onboarding/u/forms";

const PROXY_URL = "http://localhost:4000/api/proxy";

const logger = {
  info: (...args: unknown[]) => console.info("[blueprintFormsApi]", ...args),
  warn: (...args: unknown[]) => console.warn("[blueprintFormsApi]", ...args),
  error: (...args: unknown[]) => console.error("[blueprintFormsApi]", ...args),
};

function extractSubFromJwt(token?: string): string | undefined {
  if (!token) return undefined;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;
    return typeof payload.sub === "string" ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

function resolveBlueprintHeaders(): Record<string, string> {
  const bundle = loadTekionApiSettingsBundle();
  const latestCapture = loadLatestExtensionCapture();
  const customCaptures = latestCapture?.customCaptures ?? {};

  let selectedCapture: ArcCustomCapturedApi | undefined;

  // 1. Direct Stores API Capture
  if (
    bundle.values?.storesApiCaptureId &&
    customCaptures[bundle.values.storesApiCaptureId]
  ) {
    selectedCapture = customCaptures[bundle.values.storesApiCaptureId];
    logger.info(
      `Using Direct Stores API Capture for Blueprint: "${selectedCapture.label}"`
    );
  }

  // 2. Stores Profile Capture
  if (
    !selectedCapture &&
    bundle.values?.storesCustomCaptureId &&
    customCaptures[bundle.values.storesCustomCaptureId]
  ) {
    selectedCapture = customCaptures[bundle.values.storesCustomCaptureId];
    logger.info(
      `Using Stores Profile Capture for Blueprint: "${selectedCapture.label}"`
    );
  }

  // 3. Fallback to any custom capture with tapapi
  if (!selectedCapture) {
    const list = Object.values(customCaptures);
    selectedCapture = list.find((c) => {
      const p = (c.pattern || "").toLowerCase();
      const m = (c.matchedUrl || "").toLowerCase();
      const l = (c.label || "").toLowerCase();
      return (
        p.includes("tapapi") ||
        m.includes("tapapi") ||
        l.includes("stores") ||
        l.includes("tap")
      );
    });

    if (selectedCapture) {
      logger.info(
        `Auto-resolved fallback Custom Capture for Blueprint: "${selectedCapture.label}"`
      );
    }
  }

  const baseHeaders: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    clientid: "web",
    origin: "https://tap.tekioncloud.com",
    referer: "https://tap.tekioncloud.com/",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
  };

  const sourceHeaders =
    selectedCapture?.headers || latestCapture?.tekionImplementationHeaders || {};

  for (const [rawKey, rawValue] of Object.entries(sourceHeaders)) {
    const lower = rawKey.toLowerCase().trim();
    const val = String(rawValue ?? "").trim();

    if (
      !val ||
      ["host", "connection", "content-length", "cookie"].includes(lower)
    ) {
      continue;
    }

    baseHeaders[lower] = val;
  }

  if (Array.isArray(bundle.globalHeaders)) {
    for (const pair of bundle.globalHeaders) {
      if (pair.enabled && pair.key && pair.value) {
        const lower = pair.key.toLowerCase().trim();
        baseHeaders[lower] = pair.value.trim();
      }
    }
  }

  // Resolve authentication token
  const tapToken =
    baseHeaders["tap-duo-api-token"] ||
    selectedCapture?.headers?.["tap-duo-api-token"] ||
    selectedCapture?.token ||
    bundle.values?.tapDuoApiToken?.trim() ||
    latestCapture?.tapDuoApiToken?.trim();

  if (tapToken) {
    baseHeaders["tap-duo-api-token"] = tapToken;
  }

  if (!baseHeaders["tap-duo-api-token"] && !baseHeaders["authorization"]) {
    throw new Error(
      "No valid tap-duo-api-token or authorization header found in Stores Dashboard captures. Check Settings."
    );
  }

  // Ensure userId matches token subject (e.g., tlreddy@tekion.com)
  const tokenSub = extractSubFromJwt(baseHeaders["tap-duo-api-token"]);
  const resolvedUserId = baseHeaders["userid"] || baseHeaders["userId"] || tokenSub;

  if (resolvedUserId) {
    baseHeaders["userid"] = resolvedUserId;
    baseHeaders["userId"] = resolvedUserId;
  }

  logger.info("Headers built successfully", {
    headerCount: Object.keys(baseHeaders).length,
    hasTapToken: Boolean(baseHeaders["tap-duo-api-token"]),
    userId: resolvedUserId,
    keys: Object.keys(baseHeaders).sort(),
  });

  return baseHeaders;
}

export async function fetchBlueprintFormResponses(
  tekionId: string
): Promise<BlueprintFormListItem[]> {
  const headers = resolveBlueprintHeaders();

  const payload = {
    sort: [{ field: "dealerName.keyword", order: "ASC" }],
    filters: [
      {
        field: "tekionId.keyword",
        operator: "IN",
        values: [tekionId],
        key: "tekionId.keyword",
      },
    ],
    groupBy: [],
    includeFields: [],
    searchableFields: [],
    excludeFields: [],
    pageInfo: {
      start: 0,
      rows: 9999,
    },
  };

  logger.info("Fetching form responses for store", { tekionId, payload });

  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: FORMS_API_URL,
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    }),
  });

  const proxyData = await res.json();
  if (!res.ok) {
    throw new Error(proxyData?.error ?? `HTTP ${res.status}`);
  }

  const body =
    typeof proxyData.body === "string"
      ? JSON.parse(proxyData.body)
      : proxyData.body;

  if (body?.status === "failed" || body?.errorCode) {
    const msg =
      body?.errorDetails?.displayMessage ||
      body?.displayMessage ||
      `API Error ${body?.errorCode ?? ""}`;
    logger.error("Upstream API error returned", body);
    throw new Error(`Tekion API: ${msg}`);
  }

  const rawHits = Array.isArray(body?.data?.hits) ? body.data.hits : [];
  logger.info(`Received ${rawHits.length} form hits for store ${tekionId}`, {
    sampleHit: rawHits[0] ?? null,
  });

  return rawHits.map((hit: Record<string, unknown>) => {
    const rawId = String(hit.id || "");
    const rawFormId = String(hit.formId || "");
    // hit.id is the UUID required by the /formRelease/{id} endpoint
    const resolvedReleaseId = String(hit.id || hit.releaseId || "");

    return {
      formId: rawFormId,
      releaseId: resolvedReleaseId,
      responseId: rawId,
      formName: String(hit.formName || ""),
      tekionId: String(hit.tekionId || tekionId),
      dealerName: String(hit.dealerName || ""),
      status: String(hit.status || ""),
      permission: String(hit.permission || ""),
      lastReleasedTime: hit.lastReleasedTime as string | number | undefined,
      ...hit,
    };
  });
}

export function filterBlueprintTargetForms(
  forms: BlueprintFormListItem[],
  modules: BlueprintModule[]
): BlueprintFormListItem[] {
  const allowedKeys = new Set(modules);

  const matched = forms.filter((item) => {
    const name = item.formName.toLowerCase();
    if (!name.includes("blueprint")) return false;

    if (allowedKeys.has("parts") && name.includes("parts")) return true;
    if (allowedKeys.has("service") && name.includes("service")) return true;
    if (allowedKeys.has("accounting") && name.includes("accounting")) return true;

    return false;
  });

  matched.sort((a, b) => {
    const aCompleted = String(a.status).toUpperCase() === "COMPLETED" ? 1 : 0;
    const bCompleted = String(b.status).toUpperCase() === "COMPLETED" ? 1 : 0;
    return bCompleted - aCompleted;
  });

  logger.info(
    `Filtered ${matched.length} target blueprint forms matching modules:`,
    modules
  );
  return matched;
}

export async function fetchBlueprintFormDetail(
  formId: string,
  releaseId: string
): Promise<unknown> {
  const headers = resolveBlueprintHeaders();
  const cleanFormId = formId.trim();
  const cleanReleaseId = releaseId.trim();

  if (!cleanFormId || !cleanReleaseId) {
    throw new Error(
      `Cannot fetch form detail: missing formId ("${formId}") or releaseId ("${releaseId}")`
    );
  }

  const url = `${FORM_DETAIL_BASE_URL}/${encodeURIComponent(
    cleanFormId
  )}/formRelease/${encodeURIComponent(cleanReleaseId)}`;

  logger.info("Fetching form detail via formRelease", {
    formId: cleanFormId,
    releaseId: cleanReleaseId,
    url,
  });

  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      method: "GET",
      headers,
    }),
  });

  const proxyData = await res.json();
  if (!res.ok) {
    throw new Error(proxyData?.error ?? `HTTP ${res.status}`);
  }

  const body =
    typeof proxyData.body === "string"
      ? JSON.parse(proxyData.body)
      : proxyData.body;

  if (body?.status === "failed" || body?.errorCode) {
    throw new Error(
      `Form detail failed: ${
        body?.errorDetails?.displayMessage ??
        body?.displayMessage ??
        body?.errorCode ??
        "Unknown error"
      }`
    );
  }

  return body;
}