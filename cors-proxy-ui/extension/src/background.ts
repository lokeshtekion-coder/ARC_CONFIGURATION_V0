import type {
  HeaderMap,
  ArcLatestCaptureState,
  ArcTekionProfile,
  ArcCustomWatchRule,
  ArcCustomCapturedApi,
  ArcDecodedTokenInfo,
} from "./types";

const STORAGE_KEY = "arcLatestCaptureState";
const CUSTOM_RULES_STORAGE_KEY = "arcCustomWatchedApis";
// 0 = keep the capture until the user removes the watch rule (no time-based expiry).
const DEFAULT_CUSTOM_EXPIRY_HOURS = 0;

const TENANT_ID = "861aedbb-44b4-4bcf-a125-49fa7baf1e26";
const SPF_CLIENT_ID = "08e18876-6177-487e-b8b5-cf950c1e598c";
const SHAREPOINT_TARGET_DOC_URL =
  "https://tekion.sharepoint.com/:x:/r/sites/configteam/_layouts/15/Doc.aspx?sourcedoc=%7B5888FB41-2664-43BE-A422-A79E7D2E7FB6%7D&file=T-90%20Arc%20Dealerss.xlsx&action=default&mobileredirect=true";

// Matches any port on localhost
const LOCALHOST_APP_MATCHES = [
  "http://localhost/*",
  "http://127.0.0.1/*",
];

const REQUEST_FILTER: chrome.webRequest.RequestFilter = {
  urls: ["<all_urls>"],
  types: ["xmlhttprequest"],
};

const DROP_TEKION_HEADERS = new Set<string>([
  "accept-encoding",
  "accept-language",
  "cache-control",
  "connection",
  "content-length",
  "cookie",
  "host",
  "origin",
  "pragma",
  "priority",
  "referer",
  "user-agent",
]);

const DROP_CUSTOM_CAPTURE_HEADERS = new Set<string>([
  "accept-encoding",
  "connection",
  "content-length",
  "cookie",
  "host",
]);

type CaptureKind =
  | "tekionImplementation"
  | "tekionBootstrap"
  | "tekionProdTechMotors"
  | "slackPermissionsInfo"
  | "preprodMapApi";

type RequestHeaderDetails = {
  requestId: string;
  url: string;
  initiator?: string;
  requestHeaders?: chrome.webRequest.HttpHeader[];
};

type RequestBodyChunk = {
  bytes?: ArrayBuffer;
};

type RequestBodyShape = {
  raw?: RequestBodyChunk[];
  formData?: Record<string, string[]>;
};

type RequestBodyCaptureDetails = {
  requestId: string;
  url: string;
  method: string;
  type: string;
  requestBody?: RequestBodyShape;
};

interface PendingSlackRequest {
  url: string;
  bodyText: string;
  createdAt: number;
}

let cachedCustomRules: ArcCustomWatchRule[] = [];
const pendingSlackRequests = new Map<string, PendingSlackRequest>();

function log(...args: unknown[]) {
  console.log("[ARC BG]", ...args);
  void queryLocalhostTabs().then((tabs) => {
    tabs.forEach((tab) => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, {
          type: "ARC_LOG_RELAY",
          payload: args,
        }).catch(() => {});
      }
    });
  });
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function stripQuery(raw: string): string {
  const url = parseUrl(raw);
  return url ? `${url.origin}${url.pathname}` : raw;
}

function normalizeHeaders(
  headers: chrome.webRequest.HttpHeader[] | undefined
): HeaderMap {
  const out: HeaderMap = {};
  for (const header of headers ?? []) {
    const name = (header.name || "").trim().toLowerCase();
    const value = typeof header.value === "string" ? header.value.trim() : "";
    if (!name || !value) continue;
    out[name] = value;
  }
  return out;
}

function extractBearerToken(authHeader?: string): string {
  if (!authHeader) return "";
  const value = authHeader.trim();
  if (!/^bearer\s+/i.test(value)) return "";
  return value.replace(/^bearer\s+/i, "").trim();
}

function filterTekionHeaders(headers: HeaderMap): HeaderMap {
  const out: HeaderMap = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (!value.trim()) continue;
    if (DROP_TEKION_HEADERS.has(lower)) continue;
    if (lower.startsWith("sec-")) continue;
    out[lower] = value;
  }
  return out;
}

function filterCustomCaptureHeaders(headers: HeaderMap): HeaderMap {
  const out: HeaderMap = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (!value.trim()) continue;
    if (DROP_CUSTOM_CAPTURE_HEADERS.has(lower)) continue;
    if (lower.startsWith("sec-")) continue;
    out[lower] = value;
  }
  return out;
}

function sortHeaderMap(input?: HeaderMap): HeaderMap | undefined {
  if (!input) return undefined;
  const out: HeaderMap = {};
  for (const key of Object.keys(input).sort()) out[key] = input[key];
  return out;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function decodeJwt(token?: string): ArcDecodedTokenInfo | undefined {
  if (!token) return undefined;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;

    const exp = typeof payload.exp === "number" ? payload.exp : undefined;
    const iat = typeof payload.iat === "number" ? payload.iat : undefined;

    return {
      email: typeof payload.email === "string" ? payload.email : undefined,
      originalTenantId:
        typeof payload.originalTenantId === "string"
          ? payload.originalTenantId
          : undefined,
      exp,
      iat,
      expiresAt: exp ? new Date(exp * 1000).toISOString() : undefined,
      issuedAt: iat ? new Date(iat * 1000).toISOString() : undefined,
      isExpired: typeof exp === "number" ? Date.now() >= exp * 1000 : undefined,
    };
  } catch {
    return undefined;
  }
}

function isTekionImplementationRequest(rawUrl: string): boolean {
  const url = parseUrl(rawUrl);
  return Boolean(
    url &&
      url.origin === "https://us-west1-tapapi.tekioncloud.com" &&
      url.pathname.startsWith(
        "/tapapi/tap-crm-implementations-backend/public/v1/implementation-dealer-st"
      )
  );
}

function isTekionBootstrapRequest(rawUrl: string): boolean {
  const url = parseUrl(rawUrl);
  return Boolean(
    url &&
      url.origin === "https://preprodapp.tekioncloud.com" &&
      url.pathname === "/api/accounting/u/configurable/bootstrap"
  );
}

function isTekionProdTechMotorsProfileRequest(rawUrl: string): boolean {
  const url = parseUrl(rawUrl);
  return Boolean(
    url &&
      url.hostname === "app.tekioncloud.com" &&
      /employee\/profile/i.test(url.pathname)
  );
}

function isSlackPermissionsInfoRequest(rawUrl: string): boolean {
  const url = parseUrl(rawUrl);
  if (!url) return false;
  const isSlackHost =
    url.hostname === "edgeapi.slack.com" || url.hostname.endsWith(".slack.com");
  return Boolean(isSlackHost && /\/api\//i.test(url.pathname));
}

function isPreprodMapRequest(rawUrl: string): boolean {
  const url = parseUrl(rawUrl);
  return Boolean(
    url &&
      url.hostname === "preprod-apps-api.tekioncloud.xyz" &&
      (url.pathname.includes("/apps/v2/api/login") ||
       url.pathname.includes("/tenantadmin/v1/api") ||
       url.pathname.includes("/tkmodels/v1/api") ||
       url.pathname.includes("/modeldataconfig/v1/api"))
  );
}

function detectCaptureKind(details: RequestHeaderDetails): CaptureKind | null {
  if (isPreprodMapRequest(details.url)) return "preprodMapApi";
  if (isTekionImplementationRequest(details.url)) return "tekionImplementation";
  if (isTekionBootstrapRequest(details.url)) return "tekionBootstrap";
  if (isTekionProdTechMotorsProfileRequest(details.url)) return "tekionProdTechMotors";
  if (isSlackPermissionsInfoRequest(details.url)) return "slackPermissionsInfo";
  return null;
}

function buildProfileKey(
  headers: HeaderMap,
  decodedToken?: ArcDecodedTokenInfo
): string {
  return [
    headers["tenantname"] || decodedToken?.originalTenantId || "",
    headers["dealerid"] || "",
    headers["tek-siteid"] || "",
    headers["roleid"] || "",
  ].join("::");
}

function normalizeProfiles(input: unknown): ArcTekionProfile[] {
  if (!Array.isArray(input)) return [];
  const out: ArcTekionProfile[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;

    if (
      typeof raw.id !== "string" ||
      typeof raw.profileKey !== "string" ||
      typeof raw.capturedAt !== "string"
    ) {
      continue;
    }

    out.push({
      id: raw.id,
      profileKey: raw.profileKey,
      capturedAt: raw.capturedAt,
      sourceUrl: normalizeString(raw.sourceUrl),
      dealerId: normalizeString(raw.dealerId),
      tenantName: normalizeString(raw.tenantName),
      tekSiteId: normalizeString(raw.tekSiteId),
      roleId: normalizeString(raw.roleId),
      applicationId: normalizeString(raw.applicationId),
      clientId: normalizeString(raw.clientId),
      locale: normalizeString(raw.locale),
      token: normalizeString(raw.token),
      decodedToken:
        raw.decodedToken && typeof raw.decodedToken === "object"
          ? (raw.decodedToken as ArcDecodedTokenInfo)
          : undefined,
      bootstrapHeaders:
        raw.bootstrapHeaders && typeof raw.bootstrapHeaders === "object"
          ? { ...(raw.bootstrapHeaders as HeaderMap) }
          : {},
    });
  }

  return out;
}

function upsertTekionProfile(
  current: ArcLatestCaptureState,
  headers: HeaderMap,
  sourceUrl: string,
  capturedAt: string
): ArcTekionProfile[] {
  const token = normalizeString(headers["tekion-api-token"]);
  const decodedToken = decodeJwt(token);
  const profileKey = buildProfileKey(headers, decodedToken);

  if (!profileKey.replace(/:/g, "").trim()) {
    return normalizeProfiles(current.tekionProfiles);
  }

  const nextProfile: ArcTekionProfile = {
    id: profileKey,
    profileKey,
    capturedAt,
    sourceUrl,
    dealerId: normalizeString(headers["dealerid"]),
    tenantName: normalizeString(headers["tenantname"]),
    tekSiteId: normalizeString(headers["tek-siteid"]),
    roleId: normalizeString(headers["roleid"]),
    applicationId: normalizeString(headers["applicationid"]),
    clientId: normalizeString(headers["clientid"]),
    locale: normalizeString(headers["locale"]),
    token,
    decodedToken,
    bootstrapHeaders: { ...headers },
  };

  const profiles = normalizeProfiles(current.tekionProfiles);
  const existingIndex = profiles.findIndex(
    (profile) => profile.profileKey === profileKey
  );

  if (existingIndex >= 0) {
    profiles[existingIndex] = {
      ...profiles[existingIndex],
      ...nextProfile,
      bootstrapHeaders: {
        ...profiles[existingIndex].bootstrapHeaders,
        ...nextProfile.bootstrapHeaders,
      },
    };
  } else {
    profiles.unshift(nextProfile);
  }

  profiles.sort(
    (a, b) =>
      new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime()
  );

  return profiles;
}

function isExpired(capturedAt: string, expiryHours: number): boolean {
  if (!(expiryHours > 0)) return false; // 0 = never expires
  const ts = new Date(capturedAt).getTime();
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > expiryHours * 60 * 60 * 1000;
}

function pruneExpiredCustomCaptures(
  captures: Record<string, ArcCustomCapturedApi> | undefined
): Record<string, ArcCustomCapturedApi> | undefined {
  if (!captures) return undefined;

  const next: Record<string, ArcCustomCapturedApi> = {};
  for (const [key, value] of Object.entries(captures)) {
    const expiryHours =
      typeof value.expiryHours === "number" && value.expiryHours >= 0
        ? value.expiryHours
        : DEFAULT_CUSTOM_EXPIRY_HOURS;

    if (!isExpired(value.capturedAt, expiryHours)) {
      next[key] = value;
    }
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function comparableSnapshot(state: ArcLatestCaptureState): string {
  const customCaptures = pruneExpiredCustomCaptures(state.customCaptures);

  return JSON.stringify({
    graphApiToken: state.graphApiToken ?? "",
    graphExpiresAt: state.graphExpiresAt ?? 0,
    spfxRefreshToken: state.spfxRefreshToken ?? "",
    spfxRefreshTokenExpiresAt: state.spfxRefreshTokenExpiresAt ?? 0,
    tapDuoApiToken: state.tapDuoApiToken ?? "",
    slackToken: state.slackToken ?? "",
    slackDCookie: state.slackDCookie ?? "",
    preprodMapToken: state.preprodMapToken ?? "",
    lastSlackSourceUrl: state.lastSlackSourceUrl ?? "",
    lastSlackCaptureAt: state.lastSlackCaptureAt ?? "",
    graphHeaders: sortHeaderMap(state.graphHeaders) ?? {},
    tekionImplementationHeaders: sortHeaderMap(state.tekionImplementationHeaders) ?? {},
    tekionBootstrapHeaders: sortHeaderMap(state.tekionBootstrapHeaders) ?? {},
    tekionProdTechMotorsHeaders: sortHeaderMap(state.tekionProdTechMotorsHeaders) ?? {},
    preprodMapHeaders: sortHeaderMap(state.preprodMapHeaders) ?? {},
    customCaptures: customCaptures
      ? Object.fromEntries(
          Object.entries(customCaptures).map(([key, value]) => [
            key,
            { ...value, headers: sortHeaderMap(value.headers) ?? {} },
          ])
        )
      : {},
    tekionProfiles: normalizeProfiles(state.tekionProfiles).map((profile) => ({
      id: profile.id,
      profileKey: profile.profileKey,
      capturedAt: profile.capturedAt,
      sourceUrl: profile.sourceUrl ?? "",
      dealerId: profile.dealerId ?? "",
      tenantName: profile.tenantName ?? "",
      tekSiteId: profile.tekSiteId ?? "",
      roleId: profile.roleId ?? "",
      applicationId: profile.applicationId ?? "",
      clientId: profile.clientId ?? "",
      locale: profile.locale ?? "",
      token: profile.token ?? "",
      bootstrapHeaders: sortHeaderMap(profile.bootstrapHeaders) ?? {},
    })),
  });
}

function getStorageValue<T = unknown>(key: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key] as T | undefined);
    });
  });
}

function setStorageValue(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve();
    });
  });
}

async function loadStoredState(): Promise<ArcLatestCaptureState> {
  const state = (await getStorageValue<ArcLatestCaptureState>(STORAGE_KEY)) ?? {};
  return {
    ...state,
    customCaptures: pruneExpiredCustomCaptures(state.customCaptures),
  };
}

const BADGE_EXPIRY_WARN_WINDOW_MS = 5 * 60 * 1000;

function updateActionBadge(state: ArcLatestCaptureState): void {
  let criticalCount = 0;
  let warnCount = 0;

  if (!state.graphApiToken) {
    criticalCount += 1;
  } else if (typeof state.graphExpiresAt === "number") {
    const remainingMs = state.graphExpiresAt - Date.now();
    if (remainingMs <= 0) criticalCount += 1;
    else if (remainingMs <= BADGE_EXPIRY_WARN_WINDOW_MS) warnCount += 1;
  }

  if (!state.slackToken || !state.slackDCookie) {
    warnCount += 1;
  }

  if (!state.preprodMapToken) {
    warnCount += 1;
  }

  if (criticalCount > 0) {
    void chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    void chrome.action.setBadgeText({ text: String(criticalCount + warnCount) });
  } else if (warnCount > 0) {
    void chrome.action.setBadgeBackgroundColor({ color: "#f59e0b" });
    void chrome.action.setBadgeText({ text: String(warnCount) });
  } else {
    void chrome.action.setBadgeText({ text: "" });
  }
}

async function persistState(state: ArcLatestCaptureState): Promise<void> {
  const next: ArcLatestCaptureState = {
    ...state,
    customCaptures: pruneExpiredCustomCaptures(state.customCaptures),
  };
  await setStorageValue(STORAGE_KEY, next);
  updateActionBadge(next);
}

function queryLocalhostTabs(): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: LOCALHOST_APP_MATCHES }, (tabs) => {
      resolve(tabs ?? []);
    });
  });
}

function sendMessageToTab(tabId: number, message: unknown): Promise<void> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, () => resolve());
  });
}

async function pushStateToLocalhostTabs(state: ArcLatestCaptureState): Promise<void> {
  const tabs = await queryLocalhostTabs();
  const message = { type: "ARC_PUSH_CAPTURE", payload: state };

  await Promise.allSettled(
    tabs
      .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === "number")
      .map((tab) => sendMessageToTab(tab.id, message))
  );
}

function extractCookieValue(cookieHeader: string | undefined, key: string): string {
  if (!cookieHeader) return "";
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [rawKey, ...rest] = part.split("=");
    if (rawKey?.trim() === key) {
      return rest.join("=").trim();
    }
  }
  return "";
}

function parseSlackBodyToken(bodyText: string): string {
  if (!bodyText.trim()) return "";

  try {
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    if (typeof parsed.token === "string" && parsed.token.trim()) {
      return parsed.token.trim();
    }
    if (
      typeof parsed.enterprise_token === "string" &&
      parsed.enterprise_token.trim()
    ) {
      return parsed.enterprise_token.trim();
    }
  } catch {}

  try {
    const params = new URLSearchParams(bodyText);
    const token = params.get("token")?.trim();
    if (token) return token;
    const enterpriseToken = params.get("enterprise_token")?.trim();
    if (enterpriseToken) return enterpriseToken;
  } catch {}

  return "";
}

function decodeRequestBodyToText(requestBody?: RequestBodyShape): string {
  if (!requestBody) return "";

  if (requestBody.raw && requestBody.raw.length > 0) {
    const decoder = new TextDecoder("utf-8");
    return requestBody.raw
      .map((chunk: RequestBodyChunk) =>
        chunk.bytes ? decoder.decode(new Uint8Array(chunk.bytes)) : ""
      )
      .join("");
  }

  if (requestBody.formData) {
    const params = new URLSearchParams();
    for (const key of Object.keys(requestBody.formData)) {
      const values = requestBody.formData[key] ?? [];
      values.forEach((value: string) => params.append(key, value));
    }
    return params.toString();
  }

  return "";
}

async function exchangeSpfxRefreshToken(refreshToken: string): Promise<string | null> {
  try {
    const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://tekion.sharepoint.com",
      },
      body: new URLSearchParams({
        client_id: SPF_CLIENT_ID,
        grant_type: "refresh_token",
        scope: "https://graph.microsoft.com/.default",
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) {
      log("Exchange token failed:", await res.text());
      return null;
    }

    const data = await res.json();
    if (data.access_token) {
      log("✅ Successfully minted Graph token with Files.ReadWrite.All!");
      return data.access_token;
    }
  } catch (err) {
    console.error("[ARC BG] Network exchange error:", err);
  }
  return null;
}

function mergeCapture(
  current: ArcLatestCaptureState,
  kind: CaptureKind,
  url: string,
  normalizedHeaders: HeaderMap,
  slackBodyText?: string
): ArcLatestCaptureState | null {
  const now = new Date().toISOString();
  const next: ArcLatestCaptureState = { ...current };

  // Intercept and merge Pre-Prod MAP credentials
  if (kind === "preprodMapApi") {
    const authHeader = normalizedHeaders["authorization"];
    const token = extractBearerToken(authHeader) || authHeader;
    if (!token && !normalizedHeaders["x-tekion-user"]) return null;

    next.preprodMapToken = token;
    next.preprodMapHeaders = {
      ...(normalizedHeaders["authorization"] ? { authorization: normalizedHeaders["authorization"] } : {}),
      ...(normalizedHeaders["x-tekion-user"] ? { "x-tekion-user": normalizedHeaders["x-tekion-user"] } : {}),
      ...(normalizedHeaders["origin"] ? { origin: normalizedHeaders["origin"] } : {}),
      ...(normalizedHeaders["referer"] ? { referer: normalizedHeaders["referer"] } : {}),
      ...normalizedHeaders,
    };
    next.lastPreprodMapSourceUrl = url;
    next.lastPreprodMapCaptureAt = now;
    log("✅ Synced Pre-Prod MAP API Credentials!");
    return next;
  }

  if (kind === "slackPermissionsInfo") {
    const token = parseSlackBodyToken(slackBodyText ?? "");
    const dCookie = extractCookieValue(normalizedHeaders["cookie"], "d");

    if (!token && !dCookie) return null;

    if (token) next.slackToken = token;
    if (dCookie) next.slackDCookie = dCookie;
    next.lastSlackSourceUrl = url;
    next.lastSlackCaptureAt = now;
    log("✅ Synced Slack Session Credentials!");
    return next;
  }

  const filteredTekionHeaders = filterTekionHeaders(normalizedHeaders);
  const tapToken = (normalizedHeaders["tap-duo-api-token"] || "").trim();

  if (kind === "tekionImplementation") {
    if (!tapToken && Object.keys(filteredTekionHeaders).length === 0) return null;
    if (tapToken) next.tapDuoApiToken = tapToken;
    next.tekionImplementationHeaders = filteredTekionHeaders;
    next.lastTekionImplementationSourceUrl = url;
    next.lastTekionImplementationCaptureAt = now;
    return next;
  }

  if (kind === "tekionBootstrap") {
    if (!tapToken && Object.keys(filteredTekionHeaders).length === 0) return null;
    if (tapToken) next.tapDuoApiToken = tapToken;
    next.tekionBootstrapHeaders = filteredTekionHeaders;
    next.lastTekionBootstrapSourceUrl = url;
    next.lastTekionBootstrapCaptureAt = now;
    next.tekionProfiles = upsertTekionProfile(next, filteredTekionHeaders, url, now);
    return next;
  }

  if (kind === "tekionProdTechMotors") {
    if (Object.keys(filteredTekionHeaders).length === 0) return null;
    next.tekionProdTechMotorsHeaders = filteredTekionHeaders;
    next.lastTekionProdTechMotorsSourceUrl = url;
    next.lastTekionProdTechMotorsCaptureAt = now;
    return next;
  }

  return null;
}

function mergeCustomCapture(
  current: ArcLatestCaptureState,
  rule: ArcCustomWatchRule,
  url: string,
  normalizedHeaders: HeaderMap
): ArcLatestCaptureState | null {
  const filteredHeaders = filterCustomCaptureHeaders(normalizedHeaders);
  const authToken =
    extractBearerToken(normalizedHeaders["authorization"]) ||
    normalizeString(normalizedHeaders["tekion-api-token"]) ||
    normalizeString(normalizedHeaders["tap-duo-api-token"]) ||
    undefined;

  if (Object.keys(filteredHeaders).length === 0 && !authToken) return null;

  const now = new Date().toISOString();

  return {
    ...current,
    customCaptures: {
      ...(current.customCaptures ?? {}),
      [rule.id]: {
        id: rule.id,
        label: rule.label,
        pattern: rule.pattern,
        matchMode: rule.matchMode,
        expiryHours: rule.expiryHours,
        matchedUrl: url,
        capturedAt: current.customCaptures?.[rule.id]?.capturedAt || now,
        lastSeenAt: now,
        token: authToken,
        headers: filteredHeaders,
      },
    },
  };
}

function normalizeRuleList(input: unknown): ArcCustomWatchRule[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const raw = item as Record<string, unknown>;
      const id = normalizeString(raw.id);
      const pattern = normalizeString(raw.pattern);
      const matchMode = raw.matchMode === "exact" ? "exact" : "includes";
      const label = normalizeString(raw.label) || pattern || "";
      const expiryHoursRaw =
        typeof raw.expiryHours === "number"
          ? raw.expiryHours
          : Number.parseInt(String(raw.expiryHours ?? ""), 10);
      const expiryHours =
        Number.isFinite(expiryHoursRaw) && expiryHoursRaw >= 0
          ? expiryHoursRaw
          : DEFAULT_CUSTOM_EXPIRY_HOURS;
      const createdAt = normalizeString(raw.createdAt) || new Date().toISOString();

      if (!id || !pattern) return null;

      return {
        id,
        label,
        pattern,
        matchMode,
        expiryHours,
        createdAt,
      } satisfies ArcCustomWatchRule;
    })
    .filter((item): item is ArcCustomWatchRule => Boolean(item));
}

function matchCustomRule(url: string): ArcCustomWatchRule | null {
  const normalizedUrl = url.trim().toLowerCase();
  for (const rule of cachedCustomRules) {
    const pattern = rule.pattern.trim().toLowerCase();
    if (!pattern) continue;
    if (rule.matchMode === "exact") {
      if (normalizedUrl === pattern) return rule;
    } else {
      if (normalizedUrl.includes(pattern)) return rule;
    }
  }
  return null;
}

async function cleanupExpiredCustomCapturesAndSync(): Promise<void> {
  const current = await loadStoredState();
  const next: ArcLatestCaptureState = {
    ...current,
    customCaptures: pruneExpiredCustomCaptures(current.customCaptures),
  };
  if (comparableSnapshot(current) !== comparableSnapshot(next)) {
    await persistState(next);
    await pushStateToLocalhostTabs(next);
  }
}

// Dealer profiles older than 48 hours are stale. The selected profile is never removed.
const PROFILE_FRESH_MS = 48 * 60 * 60 * 1000;

async function removeStaleProfiles(keepId: string): Promise<number> {
  const current = await loadStoredState();
  const profiles = normalizeProfiles(current.tekionProfiles);
  const now = Date.now();
  const kept = profiles.filter(
    (profile) =>
      profile.id === keepId || now - (Date.parse(profile.capturedAt) || 0) < PROFILE_FRESH_MS
  );
  const removed = profiles.length - kept.length;
  if (removed === 0) return 0;
  const next: ArcLatestCaptureState = { ...current, tekionProfiles: kept };
  await persistState(next);
  await pushStateToLocalhostTabs(next);
  return removed;
}

async function removeCapturesForDeletedRules(rules: ArcCustomWatchRule[]): Promise<void> {
  const current = await loadStoredState();
  const keepIds = new Set(rules.map((rule) => rule.id));
  const kept = Object.fromEntries(
    Object.entries(current.customCaptures ?? {}).filter(([id]) => keepIds.has(id))
  );
  const next: ArcLatestCaptureState = {
    ...current,
    customCaptures: Object.keys(kept).length > 0 ? kept : undefined,
  };
  if (comparableSnapshot(current) !== comparableSnapshot(next)) {
    await persistState(next);
    await pushStateToLocalhostTabs(next);
  }
}

chrome.storage.local.get([CUSTOM_RULES_STORAGE_KEY], (result) => {
  cachedCustomRules = normalizeRuleList(result[CUSTOM_RULES_STORAGE_KEY]);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes[CUSTOM_RULES_STORAGE_KEY]) {
    cachedCustomRules = normalizeRuleList(changes[CUSTOM_RULES_STORAGE_KEY].newValue);
  }
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const typed = details as unknown as RequestBodyCaptureDetails;

    // 1. Intercept SPFx Refresh Token POST
    if (
      typed.url.includes("/oauth2/v2.0/token") &&
      (typed.url.includes("08e18876-6177-487e-b8b5-cf950c1e598c") ||
       typed.url.includes("spfxsinglesignon.aspx"))
    ) {
      const bodyText = decodeRequestBodyToText(typed.requestBody);
      if (bodyText.includes("refresh_token=")) {
        const params = new URLSearchParams(bodyText);
        const refreshToken = params.get("refresh_token");

        if (refreshToken) {
          log("Intercepted SPFx refresh_token in request body. Exchanging for Graph token...");
          void (async () => {
            const graphAccessToken = await exchangeSpfxRefreshToken(refreshToken);
            const current = await loadStoredState();
            const now = Date.now();

            const next: ArcLatestCaptureState = {
              ...current,
              spfxRefreshToken: refreshToken,
              spfxRefreshTokenExpiresAt: now + 44875 * 1000,
              sharepointWorkbookUrl: SHAREPOINT_TARGET_DOC_URL,
            };

            if (graphAccessToken) {
              next.graphApiToken = graphAccessToken;
              next.graphExpiresAt = now + 3599 * 1000;
              next.graphHeaders = { authorization: `Bearer ${graphAccessToken}` };
              next.lastGraphSourceUrl = typed.url;
              next.lastGraphCaptureAt = new Date().toISOString();
            }

            await persistState(next);
            await pushStateToLocalhostTabs(next);
          })();
        }
      }
      return undefined;
    }

    // 2. Intercept Slack Permissions Request Body
    if (isSlackPermissionsInfoRequest(typed.url)) {
      const bodyText = decodeRequestBodyToText(typed.requestBody);
      pendingSlackRequests.set(typed.requestId, {
        url: typed.url,
        bodyText,
        createdAt: Date.now(),
      });

      log("Captured Slack permissions body from network", {
        url: stripQuery(typed.url),
        bodyLength: bodyText.length,
      });

      return undefined;
    }

    return undefined;
  },
  {
    urls: [
      "https://edgeapi.slack.com/*",
      "https://*.slack.com/*",
      "https://login.microsoftonline.com/*",
    ],
    types: ["xmlhttprequest"],
  },
  ["requestBody"]
);

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    void (async () => {
      const current = await loadStoredState();
      const kind = detectCaptureKind(details as RequestHeaderDetails);
      const normalizedHeaders = normalizeHeaders(details.requestHeaders);

      let next: ArcLatestCaptureState | null = null;

      if (kind === "slackPermissionsInfo") {
        const pendingSlack = pendingSlackRequests.get(details.requestId);
        if (pendingSlack) {
          pendingSlackRequests.delete(details.requestId);
        }

        next = mergeCapture(
          current,
          kind,
          details.url,
          normalizedHeaders,
          pendingSlack?.bodyText
        );
      } else if (kind) {
        log("Matched known request", { kind, url: stripQuery(details.url) });
        next = mergeCapture(current, kind, details.url, normalizedHeaders);
      } else {
        const customRule = matchCustomRule(details.url);
        if (customRule) {
          next = mergeCustomCapture(
            current,
            customRule,
            details.url,
            normalizedHeaders
          );
        }
      }

      if (!next) return;

      const before = comparableSnapshot(current);
      const after = comparableSnapshot(next);

      await persistState(next);

      if (before !== after) {
        await pushStateToLocalhostTabs(next);
      }
    })();
    return undefined;
  },
  REQUEST_FILTER,
  ["requestHeaders", "extraHeaders"]
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  if (message?.type === "ARC_GET_LATEST_CAPTURE") {
    void (async () => {
      await cleanupExpiredCustomCapturesAndSync();
      const state = await loadStoredState();
      sendResponse({ payload: state });
    })();
    return true;
  }

  if (message?.type === "ARC_GET_CUSTOM_RULES") {
    chrome.storage.local.get([CUSTOM_RULES_STORAGE_KEY], (result) => {
      const rules = normalizeRuleList(result[CUSTOM_RULES_STORAGE_KEY]);
      sendResponse({ payload: rules });
    });
    return true;
  }

  if (message?.type === "ARC_REMOVE_STALE_PROFILES") {
    const keepId = typeof message.payload?.keepId === "string" ? message.payload.keepId : "";
    void removeStaleProfiles(keepId).then((removed) => sendResponse({ success: true, removed }));
    return true;
  }

  if (message?.type === "ARC_SAVE_CUSTOM_RULES") {
    if (!Array.isArray(message.payload)) {
      sendResponse({ success: false, error: "Payload must be an array" });
      return true;
    }
    const rules = normalizeRuleList(message.payload);
    chrome.storage.local.set({ [CUSTOM_RULES_STORAGE_KEY]: rules }, () => {
      // A capture stays only while its watch rule exists. Removing the rule removes its capture.
      void removeCapturesForDeletedRules(rules).then(() => sendResponse({ success: true }));
    });
    return true;
  }

  return false;
});

chrome.alarms.create("arc-custom-capture-cleanup", { periodInMinutes: 60 });
chrome.alarms.create("arc-badge-refresh", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "arc-custom-capture-cleanup") {
    void cleanupExpiredCustomCapturesAndSync();
  }
  if (alarm.name === "arc-badge-refresh") {
    void loadStoredState().then(updateActionBadge);
  }
});

void loadStoredState().then(updateActionBadge);

setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [requestId, pending] of pendingSlackRequests.entries()) {
    if (pending.createdAt < cutoff) {
      pendingSlackRequests.delete(requestId);
    }
  }
}, 60_000);

export {};