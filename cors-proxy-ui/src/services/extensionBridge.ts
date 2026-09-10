import { saveTekionApiSettings } from "./tekionApiSettings";

export const PAGE_SYNC_EVENT = "ARC_EXTENSION_SYNC_CAPTURE";
export const PAGE_SYNC_RULES_EVENT = "ARC_EXTENSION_SYNC_RULES";
export const PAGE_REQUEST_EVENT = "ARC_EXTENSION_BRIDGE_REQUEST_LATEST";
export const PAGE_GET_RULES_EVENT = "ARC_EXTENSION_BRIDGE_GET_RULES";
export const PAGE_SAVE_RULES_EVENT = "ARC_EXTENSION_BRIDGE_SAVE_RULES";

const DEFAULT_CUSTOM_EXPIRY_HOURS = 48;
const LOCAL_CAPTURE_STORAGE_KEY = "arc-extension-latest-capture";

export interface ArcDecodedTokenInfo {
  exp?: number;
  iat?: number;
  expiresAt?: string;
  issuedAt?: string;
  isExpired?: boolean;
  sub?: string;
  email?: string;
  aud?: string;
  iss?: string;
}

export interface ArcTekionProfile {
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
  decodedToken?: {
    email?: string;
    originalTenantId?: string;
    exp?: number;
    iat?: number;
    expiresAt?: string;
    issuedAt?: string;
    isExpired?: boolean;
  };
  bootstrapHeaders?: Record<string, string>;
}

export interface ArcCustomWatchRule {
  id: string;
  label: string;
  pattern: string;
  matchMode: "includes" | "exact";
  expiryHours: number;
  createdAt: string;
}

export interface ArcCustomCapturedApi {
  id: string;
  label: string;
  pattern: string;
  matchMode: "includes" | "exact";
  expiryHours: number;
  matchedUrl: string;
  capturedAt: string;
  lastSeenAt: string;
  token?: string;
  decodedToken?: ArcDecodedTokenInfo;
  headers: Record<string, string>;
}

export interface ArcLatestCaptureState {
  graphApiToken?: string;
  tapDuoApiToken?: string;
  graphHeaders?: Record<string, string>;
  tekionImplementationHeaders?: Record<string, string>;
  tekionBootstrapHeaders?: Record<string, string>;
  tekionProdTechMotorsHeaders?: Record<string, string>;
  lastGraphSourceUrl?: string;
  lastGraphCaptureAt?: string;
  lastTekionImplementationSourceUrl?: string;
  lastTekionImplementationCaptureAt?: string;
  lastTekionBootstrapSourceUrl?: string;
  lastTekionBootstrapCaptureAt?: string;
  lastTekionProdTechMotorsSourceUrl?: string;
  lastTekionProdTechMotorsCaptureAt?: string;
  tekionProfiles?: ArcTekionProfile[];
  customCaptures?: Record<string, ArcCustomCapturedApi>;
}

export interface ArcBridgeSyncResult {
  savedKeys: string[];
  capture: ArcLatestCaptureState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStringMap(input: unknown): Record<string, string> | undefined {
  if (!isRecord(input)) return undefined;

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.trim()) {
      out[key] = value.trim();
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function decodeJwt(token: string): ArcDecodedTokenInfo | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4 || 4)) % 4);
    const payload = JSON.parse(atob(padded)) as Record<string, unknown>;

    const exp = typeof payload.exp === "number" ? payload.exp : undefined;
    const iat = typeof payload.iat === "number" ? payload.iat : undefined;

    return {
      exp,
      iat,
      expiresAt: exp ? new Date(exp * 1000).toISOString() : undefined,
      issuedAt: iat ? new Date(iat * 1000).toISOString() : undefined,
      isExpired: typeof exp === "number" ? Date.now() >= exp * 1000 : undefined,
      sub: typeof payload.sub === "string" ? payload.sub : undefined,
      email: typeof payload.email === "string" ? payload.email : undefined,
      aud: typeof payload.aud === "string" ? payload.aud : undefined,
      iss: typeof payload.iss === "string" ? payload.iss : undefined,
    };
  } catch {
    return undefined;
  }
}

function extractTokenFromHeaders(headers?: Record<string, string>): string | undefined {
  if (!headers) return undefined;

  const auth = headers.authorization?.trim();
  if (auth && /^bearer\s+/i.test(auth)) {
    return auth.replace(/^bearer\s+/i, "").trim() || undefined;
  }

  const tapDuo = headers["tap-duo-api-token"]?.trim();
  if (tapDuo) return tapDuo;

  const tekionApiToken = headers["tekion-api-token"]?.trim();
  if (tekionApiToken) return tekionApiToken;

  return undefined;
}

function isExpiredByCapturedAt(capturedAt: string, expiryHours: number): boolean {
  const ts = new Date(capturedAt).getTime();
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > expiryHours * 60 * 60 * 1000;
}

function isCustomCaptureExpired(input: {
  capturedAt: string;
  expiryHours: number;
  token?: string;
  decodedToken?: ArcDecodedTokenInfo;
}): boolean {
  if (input.decodedToken?.isExpired === true) {
    return true;
  }

  if (
    typeof input.decodedToken?.exp === "number" &&
    Date.now() >= input.decodedToken.exp * 1000
  ) {
    return true;
  }

  return isExpiredByCapturedAt(input.capturedAt, input.expiryHours);
}

function normalizeTekionProfiles(input: unknown): ArcTekionProfile[] | undefined {
  if (!Array.isArray(input)) return undefined;

  const profiles = input
    .map((item) => {
      if (!isRecord(item)) return null;
      if (typeof item.id !== "string") return null;
      if (typeof item.profileKey !== "string") return null;
      if (typeof item.capturedAt !== "string") return null;

      return {
        id: item.id,
        profileKey: item.profileKey,
        capturedAt: item.capturedAt,
        sourceUrl: typeof item.sourceUrl === "string" ? item.sourceUrl : undefined,
        dealerId: typeof item.dealerId === "string" ? item.dealerId : undefined,
        tenantName: typeof item.tenantName === "string" ? item.tenantName : undefined,
        tekSiteId: typeof item.tekSiteId === "string" ? item.tekSiteId : undefined,
        roleId: typeof item.roleId === "string" ? item.roleId : undefined,
        applicationId: typeof item.applicationId === "string" ? item.applicationId : undefined,
        clientId: typeof item.clientId === "string" ? item.clientId : undefined,
        locale: typeof item.locale === "string" ? item.locale : undefined,
        token: typeof item.token === "string" ? item.token : undefined,
        decodedToken: isRecord(item.decodedToken)
          ? {
              email:
                typeof item.decodedToken.email === "string"
                  ? item.decodedToken.email
                  : undefined,
              originalTenantId:
                typeof item.decodedToken.originalTenantId === "string"
                  ? item.decodedToken.originalTenantId
                  : undefined,
              exp:
                typeof item.decodedToken.exp === "number"
                  ? item.decodedToken.exp
                  : undefined,
              iat:
                typeof item.decodedToken.iat === "number"
                  ? item.decodedToken.iat
                  : undefined,
              expiresAt:
                typeof item.decodedToken.expiresAt === "string"
                  ? item.decodedToken.expiresAt
                  : undefined,
              issuedAt:
                typeof item.decodedToken.issuedAt === "string"
                  ? item.decodedToken.issuedAt
                  : undefined,
              isExpired:
                typeof item.decodedToken.isExpired === "boolean"
                  ? item.decodedToken.isExpired
                  : undefined,
            }
          : undefined,
        bootstrapHeaders: normalizeStringMap(item.bootstrapHeaders),
      } as ArcTekionProfile;
    })
    .filter((item): item is ArcTekionProfile => Boolean(item));

  return profiles.length ? profiles : undefined;
}

function normalizeCustomCaptures(
  input: unknown
): Record<string, ArcCustomCapturedApi> | undefined {
  if (!isRecord(input)) return undefined;

  const out: Record<string, ArcCustomCapturedApi> = {};

  for (const [key, value] of Object.entries(input)) {
    if (!isRecord(value)) continue;

    const id = typeof value.id === "string" ? value.id : key;
    const label = typeof value.label === "string" ? value.label : id;
    const pattern = typeof value.pattern === "string" ? value.pattern : "";
    const matchMode = value.matchMode === "exact" ? "exact" : "includes";
    const expiryHoursRaw =
      typeof value.expiryHours === "number"
        ? value.expiryHours
        : Number.parseInt(String(value.expiryHours ?? ""), 10);
    const expiryHours =
      Number.isFinite(expiryHoursRaw) && expiryHoursRaw > 0
        ? expiryHoursRaw
        : DEFAULT_CUSTOM_EXPIRY_HOURS;

    const matchedUrl = typeof value.matchedUrl === "string" ? value.matchedUrl : "";
    const capturedAt = typeof value.capturedAt === "string" ? value.capturedAt : "";
    const lastSeenAt =
      typeof value.lastSeenAt === "string" ? value.lastSeenAt : capturedAt;
    const headers = normalizeStringMap(value.headers) ?? {};

    if (!id || !pattern || !capturedAt) continue;

    const tokenFromValue = typeof value.token === "string" ? value.token.trim() : "";
    const token = tokenFromValue || extractTokenFromHeaders(headers);
    const decodedToken =
      isRecord(value.decodedToken)
        ? {
            exp: typeof value.decodedToken.exp === "number" ? value.decodedToken.exp : undefined,
            iat: typeof value.decodedToken.iat === "number" ? value.decodedToken.iat : undefined,
            expiresAt:
              typeof value.decodedToken.expiresAt === "string"
                ? value.decodedToken.expiresAt
                : undefined,
            issuedAt:
              typeof value.decodedToken.issuedAt === "string"
                ? value.decodedToken.issuedAt
                : undefined,
            isExpired:
              typeof value.decodedToken.isExpired === "boolean"
                ? value.decodedToken.isExpired
                : undefined,
            sub: typeof value.decodedToken.sub === "string" ? value.decodedToken.sub : undefined,
            email:
              typeof value.decodedToken.email === "string"
                ? value.decodedToken.email
                : undefined,
            aud: typeof value.decodedToken.aud === "string" ? value.decodedToken.aud : undefined,
            iss: typeof value.decodedToken.iss === "string" ? value.decodedToken.iss : undefined,
          }
        : token
        ? decodeJwt(token)
        : undefined;

    if (
      isCustomCaptureExpired({
        capturedAt,
        expiryHours,
        token: token || undefined,
        decodedToken,
      })
    ) {
      continue;
    }

    out[key] = {
      id,
      label,
      pattern,
      matchMode,
      expiryHours,
      matchedUrl,
      capturedAt,
      lastSeenAt,
      token: token || undefined,
      decodedToken,
      headers,
    };
  }

  return Object.keys(out).length ? out : undefined;
}

function normalizeCapture(input: unknown): ArcLatestCaptureState | null {
  if (!isRecord(input)) return null;

  const out: ArcLatestCaptureState = {};

  if (typeof input.graphApiToken === "string" && input.graphApiToken.trim()) {
    out.graphApiToken = input.graphApiToken.trim();
  }

  if (typeof input.tapDuoApiToken === "string" && input.tapDuoApiToken.trim()) {
    out.tapDuoApiToken = input.tapDuoApiToken.trim();
  }

  out.graphHeaders = normalizeStringMap(input.graphHeaders);
  out.tekionImplementationHeaders = normalizeStringMap(input.tekionImplementationHeaders);
  out.tekionBootstrapHeaders = normalizeStringMap(input.tekionBootstrapHeaders);
  out.tekionProdTechMotorsHeaders = normalizeStringMap(input.tekionProdTechMotorsHeaders);

  if (typeof input.lastGraphSourceUrl === "string") out.lastGraphSourceUrl = input.lastGraphSourceUrl;
  if (typeof input.lastGraphCaptureAt === "string") out.lastGraphCaptureAt = input.lastGraphCaptureAt;
  if (typeof input.lastTekionImplementationSourceUrl === "string") {
    out.lastTekionImplementationSourceUrl = input.lastTekionImplementationSourceUrl;
  }
  if (typeof input.lastTekionImplementationCaptureAt === "string") {
    out.lastTekionImplementationCaptureAt = input.lastTekionImplementationCaptureAt;
  }
  if (typeof input.lastTekionBootstrapSourceUrl === "string") {
    out.lastTekionBootstrapSourceUrl = input.lastTekionBootstrapSourceUrl;
  }
  if (typeof input.lastTekionBootstrapCaptureAt === "string") {
    out.lastTekionBootstrapCaptureAt = input.lastTekionBootstrapCaptureAt;
  }
  if (typeof input.lastTekionProdTechMotorsSourceUrl === "string") {
    out.lastTekionProdTechMotorsSourceUrl = input.lastTekionProdTechMotorsSourceUrl;
  }
  if (typeof input.lastTekionProdTechMotorsCaptureAt === "string") {
    out.lastTekionProdTechMotorsCaptureAt = input.lastTekionProdTechMotorsCaptureAt;
  }

  out.tekionProfiles = normalizeTekionProfiles(input.tekionProfiles);
  out.customCaptures = normalizeCustomCaptures(input.customCaptures);

  return out;
}

export function loadLatestExtensionCapture(): ArcLatestCaptureState | null {
  try {
    const raw = localStorage.getItem(LOCAL_CAPTURE_STORAGE_KEY);
    if (!raw) return null;

    const normalized = normalizeCapture(JSON.parse(raw));
    if (normalized) {
      localStorage.setItem(LOCAL_CAPTURE_STORAGE_KEY, JSON.stringify(normalized));
    }
    return normalized;
  } catch {
    return null;
  }
}

export function saveLatestExtensionCapture(capture: ArcLatestCaptureState): void {
  localStorage.setItem(LOCAL_CAPTURE_STORAGE_KEY, JSON.stringify(capture));
}

export function syncExtensionCaptureToSettings(
  capture: ArcLatestCaptureState
): ArcBridgeSyncResult {
  const nextSettings: Record<string, string> = {};
  const savedKeys: string[] = [];

  const tapDuoToken =
    capture.tapDuoApiToken?.trim() ||
    capture.tekionImplementationHeaders?.["tap-duo-api-token"]?.trim() ||
    capture.tekionBootstrapHeaders?.["tap-duo-api-token"]?.trim() ||
    "";

  if (tapDuoToken) {
    nextSettings.tapDuoApiToken = tapDuoToken;
    savedKeys.push("tapDuoApiToken");
  }

  if (capture.graphApiToken?.trim()) {
    nextSettings.graphApiToken = capture.graphApiToken.trim();
    savedKeys.push("graphApiToken");
  }

  if (savedKeys.length > 0) {
    saveTekionApiSettings(nextSettings);
  }

  saveLatestExtensionCapture(capture);
  return { savedKeys, capture };
}

export function hasExpiredCustomToken(capture: ArcCustomCapturedApi | null | undefined): boolean {
  return capture?.decodedToken?.isExpired === true;
}

export function requestLatestCaptureFromExtension(): void {
  window.postMessage({ type: PAGE_REQUEST_EVENT }, window.location.origin);
}

export function subscribeToExtensionCapture(
  onSync: (result: ArcBridgeSyncResult) => void
): () => void {
  const handler = (event: MessageEvent) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    if (event.data?.type !== PAGE_SYNC_EVENT) return;

    const capture = normalizeCapture(event.data.payload);
    if (!capture) return;

    const result = syncExtensionCaptureToSettings(capture);
    onSync(result);
  };

  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}

export function requestCustomRulesFromExtension(): void {
  window.postMessage({ type: PAGE_GET_RULES_EVENT }, window.location.origin);
}

export function saveCustomRulesToExtension(rules: ArcCustomWatchRule[]): void {
  window.postMessage({ type: PAGE_SAVE_RULES_EVENT, payload: rules }, window.location.origin);
}

export function subscribeToExtensionRules(
  onSync: (rules: ArcCustomWatchRule[]) => void
): () => void {
  const handler = (event: MessageEvent) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    if (event.data?.type !== PAGE_SYNC_RULES_EVENT) return;

    const rules = Array.isArray(event.data.payload) ? event.data.payload : [];
    onSync(rules);
  };

  window.addEventListener("message", handler);
  return () => window.removeEventListener("message", handler);
}