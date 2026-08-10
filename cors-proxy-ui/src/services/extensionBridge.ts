import { saveTekionApiSettings } from "./tekionApiSettings";

const PAGE_SYNC_EVENT = "ARC_EXTENSION_SYNC_CAPTURE";
const PAGE_REQUEST_EVENT = "ARC_EXTENSION_BRIDGE_REQUEST_LATEST";

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

export interface ArcLatestCaptureState {
  graphApiToken?: string;
  tapDuoApiToken?: string;
  graphHeaders?: Record<string, string>;
  tekionImplementationHeaders?: Record<string, string>;
  tekionBootstrapHeaders?: Record<string, string>;
  lastGraphSourceUrl?: string;
  lastGraphCaptureAt?: string;
  lastTekionImplementationSourceUrl?: string;
  lastTekionImplementationCaptureAt?: string;
  lastTekionBootstrapSourceUrl?: string;
  lastTekionBootstrapCaptureAt?: string;
  tekionProfiles?: ArcTekionProfile[];
}

export interface ArcBridgeSyncResult {
  savedKeys: string[];
  capture: ArcLatestCaptureState;
}

const LOCAL_CAPTURE_STORAGE_KEY = "arc-extension-latest-capture";

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

  if (typeof input.lastGraphSourceUrl === "string") {
    out.lastGraphSourceUrl = input.lastGraphSourceUrl;
  }

  if (typeof input.lastGraphCaptureAt === "string") {
    out.lastGraphCaptureAt = input.lastGraphCaptureAt;
  }

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

  out.tekionProfiles = normalizeTekionProfiles(input.tekionProfiles);

  return out;
}

export function loadLatestExtensionCapture(): ArcLatestCaptureState | null {
  try {
    const raw = localStorage.getItem(LOCAL_CAPTURE_STORAGE_KEY);
    if (!raw) return null;
    return normalizeCapture(JSON.parse(raw));
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

  return {
    savedKeys,
    capture,
  };
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
