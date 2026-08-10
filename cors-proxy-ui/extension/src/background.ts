const STORAGE_KEY = "arcLatestCaptureState";

const LOCALHOST_APP_MATCHES = [
  "http://localhost:5174/*",
  "http://127.0.0.1:5174/*",
];

const REQUEST_FILTER: chrome.webRequest.RequestFilter = {
  urls: [
    "https://graph.microsoft.com/v1.0/*",
    "https://us-west1-tapapi.tekioncloud.com/*",
    "https://preprodapp.tekioncloud.com/*",
  ],
};

const GRAPH_ALLOWED_INITIATORS = new Set<string>([
  "https://webshell.suite.office.com",
]);

const DROP_TEKION_HEADERS = new Set<string>([
  "accept",
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

type HeaderMap = Record<string, string>;
type CaptureKind = "graph" | "tekionImplementation" | "tekionBootstrap";

type RequestHeaderDetails = {
  url: string;
  initiator?: string;
  requestHeaders?: chrome.webRequest.HttpHeader[];
};

interface ArcDecodedTokenInfo {
  email?: string;
  originalTenantId?: string;
  exp?: number;
  iat?: number;
  expiresAt?: string;
  issuedAt?: string;
  isExpired?: boolean;
}

interface ArcTekionProfile {
  id: string;
  profileKey: string;
  capturedAt: string;
  sourceUrl?: string;
  dealerId?: string;
  tenantName?: string;
  tekSiteId?: string;
  roleId?: string;
  applicationId?: string;
  clientId?: string;
  locale?: string;
  token?: string;
  decodedToken?: ArcDecodedTokenInfo;
  bootstrapHeaders: HeaderMap;
}

interface ArcLatestCaptureState {
  graphApiToken?: string;
  tapDuoApiToken?: string;
  graphHeaders?: HeaderMap;
  tekionImplementationHeaders?: HeaderMap;
  tekionBootstrapHeaders?: HeaderMap;
  lastGraphSourceUrl?: string;
  lastGraphCaptureAt?: string;
  lastTekionImplementationSourceUrl?: string;
  lastTekionImplementationCaptureAt?: string;
  lastTekionBootstrapSourceUrl?: string;
  lastTekionBootstrapCaptureAt?: string;
  tekionProfiles?: ArcTekionProfile[];
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
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

function getOrigin(value?: string): string | null {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isAllowedGraphInitiator(details: RequestHeaderDetails): boolean {
  const origin = getOrigin(details.initiator);
  return origin ? GRAPH_ALLOWED_INITIATORS.has(origin) : false;
}

function isGraphPhotoRequest(rawUrl: string): boolean {
  const url = parseUrl(rawUrl);
  if (!url) return false;

  return (
    url.origin === "https://graph.microsoft.com" &&
    url.pathname === "/v1.0/users/tlreddy@tekion.com/photo/$value"
  );
}

function isTekionImplementationRequest(rawUrl: string): boolean {
  const url = parseUrl(rawUrl);
  if (!url) return false;

  return (
    url.origin === "https://us-west1-tapapi.tekioncloud.com" &&
    url.pathname.startsWith(
      "/tapapi/tap-crm-implementations-backend/public/v1/implementation-dealer-st"
    )
  );
}

function isTekionBootstrapRequest(rawUrl: string): boolean {
  const url = parseUrl(rawUrl);
  if (!url) return false;

  return (
    url.origin === "https://preprodapp.tekioncloud.com" &&
    url.pathname === "/api/accounting/u/configurable/bootstrap"
  );
}

function detectCaptureKind(details: RequestHeaderDetails): CaptureKind | null {
  if (isGraphPhotoRequest(details.url)) {
    return isAllowedGraphInitiator(details) ? "graph" : null;
  }

  if (isTekionImplementationRequest(details.url)) {
    return "tekionImplementation";
  }

  if (isTekionBootstrapRequest(details.url)) {
    return "tekionBootstrap";
  }

  return null;
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

function sortHeaderMap(input?: HeaderMap): HeaderMap | undefined {
  if (!input) return undefined;

  const out: HeaderMap = {};
  for (const key of Object.keys(input).sort()) {
    out[key] = input[key];
  }

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

  return input
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const raw = item as Record<string, unknown>;

      const profile: ArcTekionProfile | null =
        typeof raw.id === "string" &&
        typeof raw.profileKey === "string" &&
        typeof raw.capturedAt === "string"
          ? {
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
            }
          : null;

      return profile;
    })
    .filter((item): item is ArcTekionProfile => Boolean(item));
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

  profiles.sort((a, b) => {
    const at = new Date(a.capturedAt).getTime();
    const bt = new Date(b.capturedAt).getTime();
    return bt - at;
  });

  return profiles;
}

function comparableSnapshot(state: ArcLatestCaptureState): string {
  return JSON.stringify({
    graphApiToken: state.graphApiToken ?? "",
    tapDuoApiToken: state.tapDuoApiToken ?? "",
    graphHeaders: sortHeaderMap(state.graphHeaders) ?? {},
    tekionImplementationHeaders: sortHeaderMap(state.tekionImplementationHeaders) ?? {},
    tekionBootstrapHeaders: sortHeaderMap(state.tekionBootstrapHeaders) ?? {},
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

function queryLocalhostTabs(): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: LOCALHOST_APP_MATCHES }, (tabs) => {
      resolve(tabs ?? []);
    });
  });
}

function sendMessageToTab(tabId: number, message: unknown): Promise<void> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, () => {
      resolve();
    });
  });
}

async function loadStoredState(): Promise<ArcLatestCaptureState> {
  return (await getStorageValue<ArcLatestCaptureState>(STORAGE_KEY)) ?? {};
}

async function persistState(state: ArcLatestCaptureState): Promise<void> {
  await setStorageValue(STORAGE_KEY, state);
}

async function pushStateToLocalhostTabs(
  state: ArcLatestCaptureState
): Promise<void> {
  const tabs = await queryLocalhostTabs();

  const message = {
    type: "ARC_PUSH_CAPTURE",
    payload: state,
  };

  await Promise.allSettled(
    tabs
      .filter((tab): tab is chrome.tabs.Tab & { id: number } => typeof tab.id === "number")
      .map((tab) => sendMessageToTab(tab.id, message))
  );
}

function mergeCapture(
  current: ArcLatestCaptureState,
  kind: CaptureKind,
  url: string,
  normalizedHeaders: HeaderMap
): ArcLatestCaptureState | null {
  const now = new Date().toISOString();
  const next: ArcLatestCaptureState = { ...current };

  if (kind === "graph") {
    const token = extractBearerToken(normalizedHeaders["authorization"]);
    console.log("[ARC BG] graph request detected", {
      url,
      hasAuthorization: Boolean(token),
    });

    if (!token) return null;

    next.graphApiToken = token;
    next.graphHeaders = {
      authorization: `Bearer ${token}`,
    };
    next.lastGraphSourceUrl = url;
    next.lastGraphCaptureAt = now;
    return next;
  }

  const filteredTekionHeaders = filterTekionHeaders(normalizedHeaders);
  const tapToken = (normalizedHeaders["tap-duo-api-token"] || "").trim();

  if (kind === "tekionImplementation") {
    console.log("[ARC BG] implementation request detected", {
      url,
      hasTapDuoApiToken: Boolean(tapToken),
      headerKeys: Object.keys(filteredTekionHeaders).sort(),
      tapHeaderValuePreview: tapToken ? `${tapToken.slice(0, 16)}...` : "",
    });

    if (!tapToken && Object.keys(filteredTekionHeaders).length === 0) {
      return null;
    }

    if (tapToken) {
      next.tapDuoApiToken = tapToken;
    }

    next.tekionImplementationHeaders = filteredTekionHeaders;
    next.lastTekionImplementationSourceUrl = url;
    next.lastTekionImplementationCaptureAt = now;
    return next;
  }

  console.log("[ARC BG] bootstrap request detected", {
    url,
    headerKeys: Object.keys(filteredTekionHeaders).sort(),
  });

  if (!tapToken && Object.keys(filteredTekionHeaders).length === 0) {
    return null;
  }

  if (tapToken) {
    next.tapDuoApiToken = tapToken;
  }

  next.tekionBootstrapHeaders = filteredTekionHeaders;
  next.lastTekionBootstrapSourceUrl = url;
  next.lastTekionBootstrapCaptureAt = now;
  next.tekionProfiles = upsertTekionProfile(next, filteredTekionHeaders, url, now);

  return next;
}

async function handleBeforeSendHeaders(details: RequestHeaderDetails): Promise<void> {
  const kind = detectCaptureKind(details);
  if (!kind) return;

  console.log("[ARC BG] matched request", {
    kind,
    url: details.url,
    initiator: details.initiator,
  });

  const current = await loadStoredState();
  const normalizedHeaders = normalizeHeaders(details.requestHeaders);
  const next = mergeCapture(current, kind, details.url, normalizedHeaders);

  if (!next) return;

  const before = comparableSnapshot(current);
  const after = comparableSnapshot(next);

  await persistState(next);

  if (before !== after) {
    console.log("[ARC BG] state changed, pushing to localhost tabs", { kind });
    await pushStateToLocalhostTabs(next);
  } else {
    console.log("[ARC BG] state unchanged", { kind });
  }
}

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    void handleBeforeSendHeaders(details as RequestHeaderDetails);
    return undefined;
  },
  REQUEST_FILTER,
  ["requestHeaders", "extraHeaders"]
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ARC_GET_LATEST_CAPTURE") {
    void loadStoredState().then((state) => {
      console.log("[ARC BG] latest capture requested");
      sendResponse({ payload: state });
    });
    return true;
  }

  return false;
});
