import { loadTekionApiSettingsBundle } from "./tekionApiSettings";
import {
  loadLatestExtensionCapture,
  ArcCustomCapturedApi,
} from "./extensionBridge";

export type OnboardingStatus =
  | "COMPLETED"
  | "IN_PROGRESS"
  | "NOT_YET_STARTED"
  | "UNKNOWN";

export interface StoreBlueprintStatuses {
  parts: OnboardingStatus;
  parts_last_released_time: string;
  service: OnboardingStatus;
  service_last_released_time: string;
  accounting: OnboardingStatus;
  accounting_last_released_time: string;
  crm: OnboardingStatus;
  crm_last_released_time: string;
  analytics: OnboardingStatus;
  analytics_last_released_time: string;
}

export interface StoreSignoffStatuses {
  parts: OnboardingStatus;
  parts_last_released_time: string;
  service: OnboardingStatus;
  service_last_released_time: string;
  accounting: OnboardingStatus;
  accounting_last_released_time: string;
}

export interface StoreOnboardingStatuses {
  blueprint_statuses: StoreBlueprintStatuses;
  signoff_statuses: StoreSignoffStatuses;
}

interface FormHit {
  tekionId?: string;
  formName?: string;
  status?: string;
  permission?: string;
  lastReleasedTime?: string | number;
}

interface FormEvaluationItem {
  status: OnboardingStatus;
  time: string;
  permission?: string;
}

const FORMS_API_URL =
  "https://us-west1-tapapi-01.tekioncloud.com/dealer-onboarding/u/forms/responses";

const DEFAULT_BLUEPRINT: StoreBlueprintStatuses = {
  parts: "UNKNOWN",
  parts_last_released_time: "",
  service: "UNKNOWN",
  service_last_released_time: "",
  accounting: "UNKNOWN",
  accounting_last_released_time: "",
  crm: "UNKNOWN",
  crm_last_released_time: "",
  analytics: "UNKNOWN",
  analytics_last_released_time: "",
};

const DEFAULT_SIGNOFF: StoreSignoffStatuses = {
  parts: "UNKNOWN",
  parts_last_released_time: "",
  service: "UNKNOWN",
  service_last_released_time: "",
  accounting: "UNKNOWN",
  accounting_last_released_time: "",
};

type BlueprintKey = "parts" | "service" | "accounting" | "crm" | "analytics";
type SignoffKey = "parts" | "service" | "accounting";

function cleanString(val: string): string {
  return val.toLowerCase().replace(/[\s\-_–—]+/g, " ").trim();
}

function normalizeStatus(value: unknown): OnboardingStatus {
  const s = String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_");

  if (!s) return "UNKNOWN";

  if (
    [
      "COMPLETED",
      "COMPLETE",
      "DONE",
      "APPROVED",
      "RELEASED",
      "SIGNED_OFF",
      "SUCCESS",
    ].includes(s)
  ) {
    return "COMPLETED";
  }

  if (
    [
      "IN_PROGRESS",
      "PROGRESS",
      "PENDING",
      "DRAFT",
      "STARTED",
      "SUBMITTED",
      "UNDER_REVIEW",
    ].includes(s)
  ) {
    return "IN_PROGRESS";
  }

  if (["NOT_YET_STARTED", "NOT_STARTED", "NEW", "UNTOUCHED"].includes(s)) {
    return "NOT_YET_STARTED";
  }

  return "UNKNOWN";
}

function detectBlueprintKey(cleanedName: string): BlueprintKey | null {
  if (!cleanedName.includes("blueprint")) return null;
  if (cleanedName.includes("parts")) return "parts";
  if (cleanedName.includes("service")) return "service";
  if (cleanedName.includes("accounting")) return "accounting";
  if (cleanedName.includes("crm")) return "crm";
  if (cleanedName.includes("analytics")) return "analytics";
  return null;
}

function detectSignoffKey(cleanedName: string): SignoffKey | null {
  const isSignoff =
    cleanedName.includes("sign off") ||
    cleanedName.includes("signoff") ||
    cleanedName.includes("operational");

  if (!isSignoff) return null;
  if (cleanedName.includes("parts")) return "parts";
  if (cleanedName.includes("service")) return "service";
  if (cleanedName.includes("accounting")) return "accounting";
  return null;
}

function getLatestTimestamp(timestamps: string[]): string {
  const valid = timestamps
    .map((t) => String(t ?? "").trim())
    .filter(Boolean);

  if (valid.length === 0) return "";

  valid.sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  return valid[0];
}

/**
 * Resolves final status and timestamp when multiple forms exist:
 * 1. COMPLETED always wins (picks latest timestamp among completed forms)
 * 2. If no completed, IN_PROGRESS wins over NOT_YET_STARTED
 * 3. Otherwise NOT_YET_STARTED
 */
function resolveModuleStatus(items: FormEvaluationItem[]): {
  status: OnboardingStatus;
  time: string;
} {
  if (items.length === 0) return { status: "UNKNOWN", time: "" };

  const completedItems = items.filter((i) => i.status === "COMPLETED");
  if (completedItems.length > 0) {
    return {
      status: "COMPLETED",
      time: getLatestTimestamp(completedItems.map((i) => i.time)),
    };
  }

  const inProgressItems = items.filter((i) => i.status === "IN_PROGRESS");
  if (inProgressItems.length > 0) {
    return {
      status: "IN_PROGRESS",
      time: getLatestTimestamp(inProgressItems.map((i) => i.time)),
    };
  }

  if (items.every((i) => i.status === "NOT_YET_STARTED")) {
    return { status: "NOT_YET_STARTED", time: "" };
  }

  return { status: "UNKNOWN", time: "" };
}

function resolveDynamicHeaders(): Record<string, string> {
  const bundle = loadTekionApiSettingsBundle();
  const latestCapture = loadLatestExtensionCapture();
  const customCaptures = latestCapture?.customCaptures ?? {};

  let selectedCapture: ArcCustomCapturedApi | undefined;

  if (bundle.values?.storesApiCaptureId && customCaptures[bundle.values.storesApiCaptureId]) {
    selectedCapture = customCaptures[bundle.values.storesApiCaptureId];
    console.info(
      `[StoreOnboarding] Using Direct Stores API Capture: "${selectedCapture.label}"`
    );
  }

  if (!selectedCapture && bundle.values?.storesCustomCaptureId && customCaptures[bundle.values.storesCustomCaptureId]) {
    selectedCapture = customCaptures[bundle.values.storesCustomCaptureId];
    console.info(
      `[StoreOnboarding] Using Stores Profile Capture: "${selectedCapture.label}"`
    );
  }

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
      console.info(
        `[StoreOnboarding] Auto-resolved fallback Custom Capture: "${selectedCapture.label}"`
      );
    }
  }

  const baseHeaders: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin: "https://tap.tekioncloud.com",
    referer: "https://tap.tekioncloud.com/",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  };

  if (selectedCapture?.headers && Object.keys(selectedCapture.headers).length > 0) {
    for (const [key, value] of Object.entries(selectedCapture.headers)) {
      const lower = key.toLowerCase().trim();
      const val = String(value ?? "").trim();
      if (!val || ["host", "connection", "content-length"].includes(lower)) {
        continue;
      }
      baseHeaders[lower] = val;
    }
  } else if (latestCapture?.tekionImplementationHeaders) {
    for (const [key, value] of Object.entries(latestCapture.tekionImplementationHeaders)) {
      const lower = key.toLowerCase().trim();
      const val = String(value ?? "").trim();
      if (!val || ["host", "connection", "content-length"].includes(lower)) {
        continue;
      }
      baseHeaders[lower] = val;
    }
  }

  if (Array.isArray(bundle.globalHeaders)) {
    for (const pair of bundle.globalHeaders) {
      if (pair.enabled && pair.key && pair.value) {
        baseHeaders[pair.key.toLowerCase().trim()] = pair.value.trim();
      }
    }
  }

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
      "No valid tap-duo-api-token or authorization header found in Stores Dashboard captures or settings. Please select an active Stores capture in Settings."
    );
  }

  return baseHeaders;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchBatch(
  tekionIds: string[],
  headers: Record<string, string>
): Promise<FormHit[]> {
  const payload = {
    sort: [{ field: "dealerName.keyword", order: "ASC" }],
    filters: [
      {
        field: "tekionId.keyword",
        operator: "IN",
        values: tekionIds,
        key: "tekionId.keyword",
      },
    ],
    groupBy: [],
    includeFields: [
      "tekionId",
      "formName",
      "status",
      "permission",
      "lastReleasedTime",
    ],
    searchableFields: [],
    excludeFields: [],
    pageInfo: {
      start: 0,
      rows: 9999,
    },
  };

  const requestBody = {
    url: FORMS_API_URL,
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  };

  const res = await fetch("http://localhost:4000/api/proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const proxyData = await res.json();

  if (!res.ok) {
    throw new Error(proxyData?.error ?? `HTTP ${res.status}`);
  }

  const body =
    typeof proxyData.body === "string"
      ? JSON.parse(proxyData.body)
      : proxyData.body;

  if (body?.status && body.status !== 200 && !body?.data) {
    console.warn("[StoreOnboarding] Upstream API non-200 response:", body);
  }

  const hits = Array.isArray(body?.data?.hits) ? body.data.hits : [];
  return hits as FormHit[];
}

async function runWithConcurrency<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function runner() {
    while (true) {
      const index = currentIndex;
      currentIndex += 1;

      if (index >= items.length) return;

      results[index] = await worker(items[index]);
    }
  }

  const runners = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    () => runner()
  );

  await Promise.all(runners);
  return results;
}

function deriveStatusesFromHits(hits: FormHit[]): StoreOnboardingStatuses {
  const blueprint: StoreBlueprintStatuses = { ...DEFAULT_BLUEPRINT };
  const signoff: StoreSignoffStatuses = { ...DEFAULT_SIGNOFF };

  const bpGroups: Record<BlueprintKey, FormEvaluationItem[]> = {
    parts: [],
    service: [],
    accounting: [],
    crm: [],
    analytics: [],
  };

  const soGroups: Record<SignoffKey, FormEvaluationItem[]> = {
    parts: [],
    service: [],
    accounting: [],
  };

  for (const hit of hits) {
    const rawFormName = String(hit.formName ?? "").trim();
    if (!rawFormName) continue;

    const cleaned = cleanString(rawFormName);
    const normalized = normalizeStatus(hit.status);
    const releaseTime = hit.lastReleasedTime ? String(hit.lastReleasedTime) : "";

    const item: FormEvaluationItem = {
      status: normalized,
      time: releaseTime,
      permission: hit.permission,
    };

    const bpKey = detectBlueprintKey(cleaned);
    if (bpKey) {
      bpGroups[bpKey].push(item);
      continue;
    }

    const soKey = detectSignoffKey(cleaned);
    if (soKey) {
      soGroups[soKey].push(item);
    }
  }

  // Resolve Blueprint statuses: COMPLETED takes precedence
  (Object.keys(bpGroups) as BlueprintKey[]).forEach((key) => {
    const group = bpGroups[key];
    if (group.length > 0) {
      const resolved = resolveModuleStatus(group);
      blueprint[key] = resolved.status;
      if (key !== "analytics") {
        blueprint[`${key}_last_released_time` as keyof StoreBlueprintStatuses] =
          resolved.time as any;
      }
    }
  });

  // Resolve Sign-off statuses: COMPLETED takes precedence
  (Object.keys(soGroups) as SignoffKey[]).forEach((key) => {
    const group = soGroups[key];
    if (group.length > 0) {
      const resolved = resolveModuleStatus(group);
      signoff[key] = resolved.status;
      signoff[`${key}_last_released_time` as keyof StoreSignoffStatuses] =
        resolved.time as any;
    }
  });

  return {
    blueprint_statuses: blueprint,
    signoff_statuses: signoff,
  };
}

export async function fetchStoreOnboardingStatuses(
  tekionIds: string[],
  options?: {
    chunkSize?: number;
    concurrency?: number;
  }
): Promise<Record<string, StoreOnboardingStatuses>> {
  const uniqueTekionIds = Array.from(
    new Set(tekionIds.map((x) => String(x).trim()).filter(Boolean))
  );

  const result: Record<string, StoreOnboardingStatuses> = {};

  if (uniqueTekionIds.length === 0) {
    return result;
  }

  for (const tekionId of uniqueTekionIds) {
    result[tekionId] = {
      blueprint_statuses: { ...DEFAULT_BLUEPRINT },
      signoff_statuses: { ...DEFAULT_SIGNOFF },
    };
  }

  const headers = resolveDynamicHeaders();
  const chunkSize = options?.chunkSize ?? 25;
  const concurrency = options?.concurrency ?? 3;
  const chunks = chunkArray(uniqueTekionIds, chunkSize);

  const batchResults = await runWithConcurrency(
    chunks,
    async (chunk) => fetchBatch(chunk, headers),
    concurrency
  );

  const allHits = batchResults.flat();

  console.info(
    `[StoreOnboarding] Fetched ${allHits.length} total hits across ${chunks.length} batches.`
  );

  if (allHits.length > 0) {
    console.info("[StoreOnboarding] Sample hit preview:", allHits[0]);
  } else {
    console.warn(
      "[StoreOnboarding] 0 hits returned. Verify that the selected Stores Header Source in Settings has an unexpired token."
    );
  }

  const hitsByTekionId = new Map<string, FormHit[]>();

  for (const hit of allHits) {
    const tekionId = String(hit.tekionId ?? "").trim();
    if (!tekionId) continue;

    if (!hitsByTekionId.has(tekionId)) {
      hitsByTekionId.set(tekionId, []);
    }

    hitsByTekionId.get(tekionId)!.push(hit);
  }

  for (const tekionId of uniqueTekionIds) {
    const hits = hitsByTekionId.get(tekionId) ?? [];
    result[tekionId] = deriveStatusesFromHits(hits);
  }

  return result;
}