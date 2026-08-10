import { loadTekionApiSettings } from "./tekionApiSettings";

const BLUEPRINT_FORMS_LIST_URL =
  "https://us-west1-tapapi-01.tekioncloud.com/dealer-onboarding/u/forms/responses";

const BLUEPRINT_FORM_DETAIL_BASE_URL =
  "https://us-west1-tapapi-01.tekioncloud.com/dealer-onboarding/u/forms";

export type BlueprintModule = "parts" | "service" | "accounting";

export interface BlueprintFormListItem {
  tekionId: string;
  formId: string;
  formName: string;
  status: string;
  releaseId: string;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;

    const base64 = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getUserIdFromToken(token: string): string {
  const payload = decodeJwtPayload(token);
  const sub = typeof payload?.sub === "string" ? payload.sub.trim() : "";

  if (!sub) {
    throw new Error("Unable to derive userid from tap-duo-api-token payload.sub");
  }

  return sub;
}

function buildBlueprintHeaders(): Record<string, string> {
  const settings = loadTekionApiSettings();
  const token = settings.tapDuoApiToken.trim();

  console.log("[blueprintFormsApi] Loaded settings:", {
    hasToken: !!token,
    tokenLength: token.length,
  });

  if (!token) {
    throw new Error("tap-duo-api-token is missing. Please save it in Settings.");
  }

  const userId = getUserIdFromToken(token);

  const headers: Record<string, string> = {
    accept: "application/json, text/plain, */*",
    "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
    "cache-control": "no-cache",
    clientid: "web",
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
    "tap-duo-api-token": token,
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    userid: userId,
  };

  console.log("[blueprintFormsApi] Built headers keys:", Object.keys(headers));
  console.log("[blueprintFormsApi] Derived userid from token:", userId);

  return headers;
}

function mapFormHit(item: any): BlueprintFormListItem {
  return {
    tekionId: String(item?.tekionId ?? ""),
    formId: String(item?.formId ?? ""),
    formName: String(item?.formName ?? ""),
    status: String(item?.status ?? ""),
    releaseId: String(item?.id ?? ""),
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function matchesModule(formName: string, module: BlueprintModule): boolean {
  const name = normalize(formName);

  return (
    name.includes("blueprint") &&
    name.includes("conquest") &&
    name.includes(module)
  );
}

export function filterBlueprintTargetForms(
  items: BlueprintFormListItem[],
  modules: BlueprintModule[] = ["parts", "service", "accounting"]
): BlueprintFormListItem[] {
  const moduleSet = new Set(modules);

  return items.filter((item) => {
    if (!item.formName || !item.formId || !item.releaseId) return false;

    return (
      (moduleSet.has("parts") && matchesModule(item.formName, "parts")) ||
      (moduleSet.has("service") && matchesModule(item.formName, "service")) ||
      (moduleSet.has("accounting") && matchesModule(item.formName, "accounting"))
    );
  });
}

export async function fetchBlueprintFormResponses(
  tekionId: string
): Promise<BlueprintFormListItem[]> {
  const cleanTekionId = tekionId.trim();

  if (!cleanTekionId) {
    throw new Error("tekionId is required");
  }

  const payload = {
    sort: [{ field: "dealerName.keyword", order: "ASC" }],
    filters: [
      {
        field: "category",
        operator: "IN",
        values: [
          "7cb37536-a49c-48ae-9d55-ecc1dae5a174",
          "c217ab65-0980-4dec-a597-1cdbfcc4c273",
        ],
        key: "category",
      },
      {
        field: "tekionId.keyword",
        operator: "IN",
        values: [cleanTekionId],
        key: "tekionId.keyword",
      },
    ],
    searchText: cleanTekionId,
    groupBy: [],
    includeFields: [],
    searchableFields: [],
    excludeFields: [],
    pageInfo: { start: 0, rows: 9999 },
  };

  console.log("[blueprintFormsApi] fetchBlueprintFormResponses payload:", payload);

  const requestBody = {
    url: BLUEPRINT_FORMS_LIST_URL,
    method: "POST",
    headers: buildBlueprintHeaders(),
    body: JSON.stringify(payload),
  };

  const res = await fetch("http://localhost:4000/api/proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  console.log("[blueprintFormsApi] forms list proxy status:", res.status);

  const proxyData = await res.json();
  console.log("[blueprintFormsApi] forms list proxy data:", proxyData);

  if (!res.ok) {
    throw new Error(proxyData?.error ?? `HTTP ${res.status}`);
  }

  const body =
    typeof proxyData.body === "string"
      ? JSON.parse(proxyData.body)
      : proxyData.body;

  console.log("[blueprintFormsApi] forms list parsed body:", body);

  const hits = Array.isArray(body?.data?.hits) ? body.data.hits : [];
  console.log("[blueprintFormsApi] forms list hits count:", hits.length);

  return hits.map(mapFormHit);
}

export async function fetchBlueprintFormDetail(
  formId: string,
  releaseId: string
): Promise<any> {
  const cleanFormId = formId.trim();
  const cleanReleaseId = releaseId.trim();

  if (!cleanFormId) throw new Error("formId is required");
  if (!cleanReleaseId) throw new Error("releaseId is required");

  const url = `${BLUEPRINT_FORM_DETAIL_BASE_URL}/${encodeURIComponent(cleanFormId)}/formRelease/${encodeURIComponent(cleanReleaseId)}`;

  console.log("[blueprintFormsApi] fetchBlueprintFormDetail url:", url);

  const requestBody = {
    url,
    method: "GET",
    headers: buildBlueprintHeaders(),
  };

  const res = await fetch("http://localhost:4000/api/proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  console.log("[blueprintFormsApi] form detail proxy status:", res.status);

  const proxyData = await res.json();
  console.log("[blueprintFormsApi] form detail proxy data:", proxyData);

  if (!res.ok) {
    throw new Error(proxyData?.error ?? `HTTP ${res.status}`);
  }

  const body =
    typeof proxyData.body === "string"
      ? JSON.parse(proxyData.body)
      : proxyData.body;

  console.log("[blueprintFormsApi] form detail parsed body:", body);

  return body;
}
