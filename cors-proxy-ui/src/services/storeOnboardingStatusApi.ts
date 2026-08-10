import { loadTekionApiSettings } from "./tekionApiSettings";

export type OnboardingStatus =
  | "COMPLETED"
  | "IN_PROGRESS"
  | "NOT_YET_STARTED"
  | "UNKNOWN";

export interface StoreBlueprintStatuses {
  parts: OnboardingStatus;
  service: OnboardingStatus;
  accounting: OnboardingStatus;
  crm: OnboardingStatus;
  analytics: OnboardingStatus;
}

export interface StoreSignoffStatuses {
  parts: OnboardingStatus;
  service: OnboardingStatus;
  accounting: OnboardingStatus;
}

export interface StoreOnboardingStatuses {
  blueprint_statuses: StoreBlueprintStatuses;
  signoff_statuses: StoreSignoffStatuses;
}

interface FormHit {
  tekionId?: string;
  formName?: string;
  status?: string;
}

const FORMS_API_URL =
  "https://us-west1-tapapi-01.tekioncloud.com/dealer-onboarding/u/forms/responses";

const DEFAULT_BLUEPRINT: StoreBlueprintStatuses = {
  parts: "UNKNOWN",
  service: "UNKNOWN",
  accounting: "UNKNOWN",
  crm: "UNKNOWN",
  analytics: "UNKNOWN",
};

const DEFAULT_SIGNOFF: StoreSignoffStatuses = {
  parts: "UNKNOWN",
  service: "UNKNOWN",
  accounting: "UNKNOWN",
};

const BLUEPRINT_FORM_MAP: Record<keyof StoreBlueprintStatuses, string> = {
  parts: "Blueprint - Conquest - Parts",
  service: "Blueprint - Conquest - Service",
  accounting: "Blueprint - Conquest - Accounting",
  crm: "Blueprint - Conquest - CRM",
  analytics: "Blueprint - Analytics",
};

const SIGNOFF_FORM_MAP: Record<keyof StoreSignoffStatuses, string> = {
  parts: "Parts Operational Sign-Off",
  service: "Service Operational Sign-Off",
  accounting: "Accounting Operational Sign-Off",
};

function normalizeStatus(value: unknown): OnboardingStatus {
  const s = String(value ?? "").trim().toUpperCase();
  if (s === "COMPLETED") return "COMPLETED";
  if (s === "IN_PROGRESS") return "IN_PROGRESS";
  if (s === "NOT_YET_STARTED") return "NOT_YET_STARTED";
  return "UNKNOWN";
}

function buildHeaders(): Record<string, string> {
  const settings = loadTekionApiSettings();

  if (!settings.tapDuoApiToken.trim()) {
    throw new Error("tap-duo-api-token is missing. Please save it in Settings.");
  }

  return {
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
}

function chunkArray<T>(items: T[], size: number): T[][]
{
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchBatch(tekionIds: string[]): Promise<FormHit[]> {
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
    includeFields: [],
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
    headers: buildHeaders(),
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

  const byFormName = new Map<string, OnboardingStatus>();

  for (const hit of hits) {
    const formName = String(hit.formName ?? "").trim();
    if (!formName) continue;
    byFormName.set(formName, normalizeStatus(hit.status));
  }

  (Object.keys(BLUEPRINT_FORM_MAP) as Array<keyof StoreBlueprintStatuses>).forEach((key) => {
    const formName = BLUEPRINT_FORM_MAP[key];
    blueprint[key] = byFormName.get(formName) ?? "UNKNOWN";
  });

  (Object.keys(SIGNOFF_FORM_MAP) as Array<keyof StoreSignoffStatuses>).forEach((key) => {
    const formName = SIGNOFF_FORM_MAP[key];
    signoff[key] = byFormName.get(formName) ?? "UNKNOWN";
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
  const uniqueTekionIds = Array.from(new Set(tekionIds.map((x) => String(x).trim()).filter(Boolean)));

  const result: Record<string, StoreOnboardingStatuses> = {};

  for (const tekionId of uniqueTekionIds) {
    result[tekionId] = {
      blueprint_statuses: { ...DEFAULT_BLUEPRINT },
      signoff_statuses: { ...DEFAULT_SIGNOFF },
    };
  }

  if (uniqueTekionIds.length === 0) {
    return result;
  }

  const chunkSize = options?.chunkSize ?? 25;
  const concurrency = options?.concurrency ?? 3;

  const chunks = chunkArray(uniqueTekionIds, chunkSize);

  const batchResults = await runWithConcurrency(
    chunks,
    async (chunk) => fetchBatch(chunk),
    concurrency
  );

  const allHits = batchResults.flat();

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
