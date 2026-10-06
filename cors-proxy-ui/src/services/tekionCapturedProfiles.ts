export interface HeaderMap {
  [key: string]: string;
}

export interface DecodedProfileTokenInfo {
  email?: string;
  originalTenantId?: string;
  exp?: number;
  iat?: number;
  expiresAt?: string;
  issuedAt?: string;
  isExpired?: boolean;
}

export interface TekionCapturedProfile {
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
  decodedToken?: DecodedProfileTokenInfo;

  bootstrapHeaders?: HeaderMap;
}

// Canonical alias so both interface names work seamlessly across the app
export type CapturedTekionProfile = TekionCapturedProfile;

const STORAGE_KEY = "arc-tekion-captured-profiles";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const time = new Date(value.trim()).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

/**
 * Normalizes all header keys to lowercase while preserving exact header values
 */
export function normalizeHeaderMap(input: unknown): HeaderMap {
  if (!isRecord(input)) return {};
  const out: HeaderMap = {};

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      const lowerKey = key.trim().toLowerCase();
      if (lowerKey) {
        out[lowerKey] = value;
      }
    }
  }

  return out;
}

export function safeDecodeJwt(token: string): DecodedProfileTokenInfo | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;

    const exp = typeof payload.exp === "number" ? payload.exp : undefined;
    const iat = typeof payload.iat === "number" ? payload.iat : undefined;

    return {
      email: typeof payload.email === "string" ? payload.email.trim() : undefined,
      originalTenantId:
        typeof payload.originalTenantId === "string"
          ? payload.originalTenantId.trim()
          : undefined,
      exp,
      iat,
      expiresAt: exp ? new Date(exp * 1000).toISOString() : undefined,
      issuedAt: iat ? new Date(iat * 1000).toISOString() : undefined,
      isExpired: exp ? Date.now() >= exp * 1000 : undefined,
    };
  } catch {
    return undefined;
  }
}

export function buildProfileKey(headers: HeaderMap, decoded?: DecodedProfileTokenInfo): string {
  const tenant = headers["tenantname"] || decoded?.originalTenantId || "";
  const dealer = headers["dealerid"] || "";
  const site = headers["tek-siteid"] || "";
  const role = headers["roleid"] || "";

  return [tenant, dealer, site, role].join("::");
}

function normalizeProfile(input: unknown): TekionCapturedProfile | null {
  if (!isRecord(input)) return null;

  const id = normalizeString(input.id);
  const capturedAt = normalizeIsoTimestamp(input.capturedAt);
  if (!id || !capturedAt) return null;

  const bootstrapHeaders = normalizeHeaderMap(input.bootstrapHeaders);
  const profileKey = normalizeString(input.profileKey) || id;

  return {
    id,
    profileKey,
    capturedAt,
    sourceUrl: normalizeString(input.sourceUrl),
    dealerId: normalizeString(input.dealerId) || bootstrapHeaders["dealerid"],
    tenantName: normalizeString(input.tenantName) || bootstrapHeaders["tenantname"],
    tekSiteId: normalizeString(input.tekSiteId) || bootstrapHeaders["tek-siteid"],
    roleId: normalizeString(input.roleId) || bootstrapHeaders["roleid"],
    applicationId: normalizeString(input.applicationId) || bootstrapHeaders["applicationid"],
    clientId: normalizeString(input.clientId) || bootstrapHeaders["clientid"],
    locale: normalizeString(input.locale) || bootstrapHeaders["locale"],
    token: normalizeString(input.token) || bootstrapHeaders["tekion-api-token"],
    decodedToken: isRecord(input.decodedToken)
      ? {
          email: normalizeString(input.decodedToken.email),
          originalTenantId: normalizeString(input.decodedToken.originalTenantId),
          exp:
            typeof input.decodedToken.exp === "number"
              ? input.decodedToken.exp
              : undefined,
          iat:
            typeof input.decodedToken.iat === "number"
              ? input.decodedToken.iat
              : undefined,
          expiresAt: normalizeIsoTimestamp(input.decodedToken.expiresAt),
          issuedAt: normalizeIsoTimestamp(input.decodedToken.issuedAt),
          isExpired:
            typeof input.decodedToken.isExpired === "boolean"
              ? input.decodedToken.isExpired
              : undefined,
        }
      : undefined,
    bootstrapHeaders: Object.keys(bootstrapHeaders).length ? bootstrapHeaders : undefined,
  };
}

export function loadTekionCapturedProfiles(): TekionCapturedProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(normalizeProfile)
      .filter((item): item is TekionCapturedProfile => Boolean(item))
      .sort((a, b) => {
        const at = new Date(a.capturedAt).getTime();
        const bt = new Date(b.capturedAt).getTime();
        return bt - at;
      });
  } catch {
    return [];
  }
}

export function saveTekionCapturedProfiles(
  profiles: TekionCapturedProfile[]
): TekionCapturedProfile[] {
  // Normalize and sort by newest capture first before saving
  const sanitized = profiles
    .map(normalizeProfile)
    .filter((item): item is TekionCapturedProfile => Boolean(item))
    .sort((a, b) => {
      const at = new Date(a.capturedAt).getTime();
      const bt = new Date(b.capturedAt).getTime();
      return bt - at;
    });

  localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  return sanitized;
}

export function clearTekionCapturedProfiles(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function deleteTekionCapturedProfile(id: string): TekionCapturedProfile[] {
  const next = loadTekionCapturedProfiles().filter((profile) => profile.id !== id);
  return saveTekionCapturedProfiles(next);
}

export function upsertTekionCapturedProfileFromBootstrapCapture(input: {
  headers?: HeaderMap;
  capturedAt?: string;
  sourceUrl?: string;
}): TekionCapturedProfile[] {
  const headers = normalizeHeaderMap(input.headers);
  if (!Object.keys(headers).length) {
    return loadTekionCapturedProfiles();
  }

  const token = headers["tekion-api-token"];
  const decodedToken = token ? safeDecodeJwt(token) : undefined;
  const profileKey = buildProfileKey(headers, decodedToken);

  if (!profileKey.replace(/:/g, "").trim()) {
    return loadTekionCapturedProfiles();
  }

  const capturedAt = normalizeIsoTimestamp(input.capturedAt) || new Date().toISOString();
  const profiles = loadTekionCapturedProfiles();

  const profile: TekionCapturedProfile = {
    id: profileKey,
    profileKey,
    capturedAt,
    sourceUrl: input.sourceUrl,
    dealerId: headers["dealerid"],
    tenantName: headers["tenantname"],
    tekSiteId: headers["tek-siteid"],
    roleId: headers["roleid"],
    applicationId: headers["applicationid"],
    clientId: headers["clientid"],
    locale: headers["locale"],
    token,
    decodedToken,
    bootstrapHeaders: headers,
  };

  const existingIndex = profiles.findIndex((item) => item.profileKey === profileKey);

  if (existingIndex >= 0) {
    const prev = profiles[existingIndex];
    profiles[existingIndex] = {
      ...prev,
      ...profile,
      bootstrapHeaders: {
        ...(prev.bootstrapHeaders || {}),
        ...headers,
      },
    };
  } else {
    profiles.unshift(profile);
  }

  return saveTekionCapturedProfiles(profiles);
}
