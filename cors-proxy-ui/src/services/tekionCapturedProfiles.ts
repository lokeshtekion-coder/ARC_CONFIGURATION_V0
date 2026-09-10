///Users/tlreddy/Desktop/ARC_CONFIGURATION_V0/cors-proxy-ui/src/services/tekionCapturedProfiles.ts
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

  bootstrapHeaders: HeaderMap;
}

const STORAGE_KEY = "arc-tekion-captured-profiles";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeHeaderMap(input: unknown): HeaderMap {
  if (!isRecord(input)) return {};
  const out: HeaderMap = {};

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && key.trim()) {
      out[key] = value;
    }
  }

  return out;
}

function safeDecodeJwt(token: string): DecodedProfileTokenInfo | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;

    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
    ) as Record<string, unknown>;

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
      expiresAt: exp ? new Date(exp * 1000).toLocaleString() : undefined,
      issuedAt: iat ? new Date(iat * 1000).toLocaleString() : undefined,
      isExpired: exp ? Date.now() >= exp * 1000 : undefined,
    };
  } catch {
    return undefined;
  }
}

function buildProfileKey(headers: HeaderMap, decoded?: DecodedProfileTokenInfo): string {
  return [
    headers["tenantname"] || decoded?.originalTenantId || "",
    headers["dealerid"] || "",
    headers["tek-siteid"] || "",
    headers["roleid"] || "",
  ].join("::");
}

function normalizeProfile(input: unknown): TekionCapturedProfile | null {
  if (!isRecord(input)) return null;

  const bootstrapHeaders = normalizeHeaderMap(input.bootstrapHeaders);
  const id = normalizeString(input.id);
  const profileKey = normalizeString(input.profileKey);
  const capturedAt = normalizeString(input.capturedAt);

  if (!id || !profileKey || !capturedAt) return null;

  return {
    id,
    profileKey,
    capturedAt,
    sourceUrl: normalizeString(input.sourceUrl),
    dealerId: normalizeString(input.dealerId),
    tenantName: normalizeString(input.tenantName),
    tekSiteId: normalizeString(input.tekSiteId),
    roleId: normalizeString(input.roleId),
    applicationId: normalizeString(input.applicationId),
    clientId: normalizeString(input.clientId),
    locale: normalizeString(input.locale),
    token: normalizeString(input.token),
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
          expiresAt: normalizeString(input.decodedToken.expiresAt),
          issuedAt: normalizeString(input.decodedToken.issuedAt),
          isExpired:
            typeof input.decodedToken.isExpired === "boolean"
              ? input.decodedToken.isExpired
              : undefined,
        }
      : undefined,
    bootstrapHeaders,
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  return profiles;
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

  const capturedAt = input.capturedAt || new Date().toISOString();
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
    profiles[existingIndex] = {
      ...profiles[existingIndex],
      ...profile,
      bootstrapHeaders: {
        ...profiles[existingIndex].bootstrapHeaders,
        ...profile.bootstrapHeaders,
      },
    };
  } else {
    profiles.unshift(profile);
  }

  const sorted = [...profiles].sort((a, b) => {
    const at = new Date(a.capturedAt).getTime();
    const bt = new Date(b.capturedAt).getTime();
    return bt - at;
  });

  return saveTekionCapturedProfiles(sorted);
}
