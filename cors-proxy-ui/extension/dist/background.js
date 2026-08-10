"use strict";

const STORAGE_KEY = "arcLatestCaptureState";

const LOCALHOST_APP_MATCHES = [
  "http://localhost:5174/*",
  "http://127.0.0.1:5174/*",
];

const REQUEST_FILTER = {
  urls: [
    "https://graph.microsoft.com/v1.0/*",
    "https://us-west1-tapapi.tekioncloud.com/*",
    "https://preprodapp.tekioncloud.com/*",
  ],
};

const GRAPH_ALLOWED_INITIATORS = new Set([
  "https://webshell.suite.office.com",
]);

const DROP_TEKION_HEADERS = new Set([
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

function arcLog(label, payload) {
  try {
    console.log(`[ARC] ${label}`, payload ?? "");
  } catch (_) {}
}

function parseUrl(raw) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function normalizeHeaders(headers) {
  const out = {};
  for (const header of headers ?? []) {
    const name = (header.name || "").trim().toLowerCase();
    const value = typeof header.value === "string" ? header.value.trim() : "";
    if (!name || !value) continue;
    out[name] = value;
  }
  return out;
}

function extractBearerToken(authHeader) {
  if (!authHeader) return "";
  const value = authHeader.trim();
  if (!/^bearer\s+/i.test(value)) return "";
  return value.replace(/^bearer\s+/i, "").trim();
}

function getOrigin(value) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isAllowedGraphInitiator(details) {
  const origin = getOrigin(details.initiator);
  return origin ? GRAPH_ALLOWED_INITIATORS.has(origin) : false;
}

function isGraphPhotoRequest(rawUrl) {
  const url = parseUrl(rawUrl);
  if (!url) return false;

  return (
    url.origin === "https://graph.microsoft.com" &&
    url.pathname === "/v1.0/users/tlreddy@tekion.com/photo/$value"
  );
}

function isTekionRequest(rawUrl) {
  const url = parseUrl(rawUrl);
  if (!url) return false;
  return url.origin === "https://us-west1-tapapi.tekioncloud.com";
}

function isTekionImplementationRequest(rawUrl) {
  const url = parseUrl(rawUrl);
  if (!url) return false;

  return (
    url.origin === "https://us-west1-tapapi.tekioncloud.com" &&
    url.pathname.startsWith("/tapapi/tap-crm-implementations-backend/public/v1/")
  );
}

function isTekionBootstrapRequest(rawUrl) {
  const url = parseUrl(rawUrl);
  if (!url) return false;

  return (
    url.origin === "https://preprodapp.tekioncloud.com" &&
    url.pathname === "/api/accounting/u/configurable/bootstrap"
  );
}

function detectCaptureKind(details) {
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

function filterTekionHeaders(headers) {
  const out = {};

  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (typeof value !== "string" || !value.trim()) continue;
    if (DROP_TEKION_HEADERS.has(lower)) continue;
    if (lower.startsWith("sec-")) continue;
    out[lower] = value;
  }

  return out;
}

function sortHeaderMap(input) {
  if (!input) return undefined;
  const out = {};
  for (const key of Object.keys(input).sort()) {
    out[key] = input[key];
  }
  return out;
}

function normalizeString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function decodeJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
    const payload = JSON.parse(atob(padded));

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

function buildProfileKey(headers, decodedToken) {
  return [
    headers["tenantname"] || decodedToken?.originalTenantId || "",
    headers["dealerid"] || "",
    headers["tek-siteid"] || "",
    headers["roleid"] || "",
  ].join("::");
}

function normalizeProfiles(input) {
  if (!Array.isArray(input)) return [];

  return input
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: normalizeString(item.id),
      profileKey: normalizeString(item.profileKey),
      capturedAt: normalizeString(item.capturedAt),
      sourceUrl: normalizeString(item.sourceUrl),
      dealerId: normalizeString(item.dealerId),
      tenantName: normalizeString(item.tenantName),
      tekSiteId: normalizeString(item.tekSiteId),
      roleId: normalizeString(item.roleId),
      applicationId: normalizeString(item.applicationId),
      clientId: normalizeString(item.clientId),
      locale: normalizeString(item.locale),
      token: normalizeString(item.token),
      decodedToken:
        item.decodedToken && typeof item.decodedToken === "object"
          ? item.decodedToken
          : undefined,
      bootstrapHeaders:
        item.bootstrapHeaders && typeof item.bootstrapHeaders === "object"
          ? item.bootstrapHeaders
          : {},
    }))
    .filter((item) => item.id && item.profileKey && item.capturedAt);
}

function upsertTekionProfile(current, headers, sourceUrl, capturedAt) {
  const token = normalizeString(headers["tekion-api-token"]);
  const decodedToken = token ? decodeJwt(token) : undefined;
  const profileKey = buildProfileKey(headers, decodedToken);

  if (!profileKey.replace(/:/g, "").trim()) {
    return current.tekionProfiles ?? [];
  }

  const nextProfile = {
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
  const index = profiles.findIndex((profile) => profile.profileKey === profileKey);

  if (index >= 0) {
    profiles[index] = {
      ...profiles[index],
      ...nextProfile,
      bootstrapHeaders: {
        ...(profiles[index].bootstrapHeaders || {}),
        ...nextProfile.bootstrapHeaders,
      },
    };
  } else {
    profiles.unshift(nextProfile);
  }

  profiles.sort((a, b) => {
    const at = new Date(a.capturedAt || 0).getTime();
    const bt = new Date(b.capturedAt || 0).getTime();
    return bt - at;
  });

  return profiles;
}

function comparableSnapshot(state) {
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

function getStorageValue(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(result[key]);
    });
  });
}

function setStorageValue(key, value) {
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

function queryLocalhostTabs() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: LOCALHOST_APP_MATCHES }, (tabs) => {
      resolve(tabs ?? []);
    });
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, () => {
      resolve();
    });
  });
}

async function loadStoredState() {
  return (await getStorageValue(STORAGE_KEY)) ?? {};
}

async function persistState(state) {
  await setStorageValue(STORAGE_KEY, state);
}

async function pushStateToLocalhostTabs(state) {
  const tabs = await queryLocalhostTabs();

  const message = {
    type: "ARC_PUSH_CAPTURE",
    payload: state,
  };

  await Promise.allSettled(
    tabs
      .filter((tab) => typeof tab.id === "number")
      .map((tab) => sendMessageToTab(tab.id, message))
  );
}

function mergeCapture(current, kind, url, normalizedHeaders) {
  const now = new Date().toISOString();
  const next = { ...current };

  if (kind === "graph") {
    const token = extractBearerToken(normalizedHeaders["authorization"]);
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
    arcLog("tekion implementation request matched", {
      url,
      normalizedHeaderKeys: Object.keys(normalizedHeaders),
      tapTokenPresent: Boolean(tapToken),
      tapTokenPreview: tapToken ? `${tapToken.slice(0, 12)}...` : "",
    });

    if (!tapToken && Object.keys(filteredTekionHeaders).length === 0) {
      return null;
    }

    if (tapToken) {
      next.tapDuoApiToken = tapToken;
    }

    next.tekionImplementationHeaders = {
      ...filteredTekionHeaders,
      ...(tapToken ? { "tap-duo-api-token": tapToken } : {}),
    };
    next.lastTekionImplementationSourceUrl = url;
    next.lastTekionImplementationCaptureAt = now;
    return next;
  }

  if (!tapToken && Object.keys(filteredTekionHeaders).length === 0) {
    return null;
  }

  if (tapToken) {
    next.tapDuoApiToken = tapToken;
  }

  next.tekionBootstrapHeaders = {
    ...filteredTekionHeaders,
    ...(tapToken ? { "tap-duo-api-token": tapToken } : {}),
  };
  next.lastTekionBootstrapSourceUrl = url;
  next.lastTekionBootstrapCaptureAt = now;
  next.tekionProfiles = upsertTekionProfile(next, next.tekionBootstrapHeaders, url, now);

  return next;
}

async function handleBeforeSendHeaders(details) {
  if (isTekionRequest(details.url)) {
    arcLog("saw tekion request", {
      url: details.url,
      method: details.method,
      initiator: details.initiator,
      type: details.type,
      requestHeadersCount: Array.isArray(details.requestHeaders) ? details.requestHeaders.length : 0,
    });
  }

  const kind = detectCaptureKind(details);
  if (!kind) return;

  const current = await loadStoredState();
  const normalizedHeaders = normalizeHeaders(details.requestHeaders);
  const next = mergeCapture(current, kind, details.url, normalizedHeaders);

  if (!next) return;

  const before = comparableSnapshot(current);
  const after = comparableSnapshot(next);

  await persistState(next);

  arcLog("persisted capture", {
    kind,
    url: details.url,
    hasTapDuoApiToken: Boolean(next.tapDuoApiToken),
    hasImplementationHeaders: Boolean(
      next.tekionImplementationHeaders &&
      Object.keys(next.tekionImplementationHeaders).length
    ),
  });

  if (before !== after) {
    await pushStateToLocalhostTabs(next);
  }
}

arcLog("background loaded", { REQUEST_FILTER, LOCALHOST_APP_MATCHES });

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    void handleBeforeSendHeaders(details);
    return undefined;
  },
  REQUEST_FILTER,
  ["requestHeaders", "extraHeaders"]
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ARC_GET_LATEST_CAPTURE") {
    void loadStoredState().then((state) => {
      console.log("[ARC] sending latest capture", state);
      sendResponse({ payload: state });
    });
    return true;
  }

  return false;
});
