export interface HeaderMap {
  [key: string]: string;
}

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
  originalTenantId?: string;
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
  headers: HeaderMap;
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
  decodedToken?: ArcDecodedTokenInfo;
  bootstrapHeaders: HeaderMap;
}

export interface ArcLatestCaptureState {
  graphApiToken?: string;
  graphExpiresAt?: number;
  spfxRefreshToken?: string;
  spfxRefreshTokenExpiresAt?: number;
  sharepointWorkbookUrl?: string;

  tapDuoApiToken?: string;

  slackToken?: string;
  slackDCookie?: string;
  lastSlackSourceUrl?: string;
  lastSlackCaptureAt?: string;

  graphHeaders?: HeaderMap;
  tekionImplementationHeaders?: HeaderMap;
  tekionBootstrapHeaders?: HeaderMap;
  tekionProdTechMotorsHeaders?: HeaderMap;

  lastGraphSourceUrl?: string;
  lastTekionImplementationSourceUrl?: string;
  lastTekionBootstrapSourceUrl?: string;
  lastTekionProdTechMotorsSourceUrl?: string;

  lastGraphCaptureAt?: string;
  lastTekionImplementationCaptureAt?: string;
  lastTekionBootstrapCaptureAt?: string;
  lastTekionProdTechMotorsCaptureAt?: string;

  tekionProfiles?: ArcTekionProfile[];
  customCaptures?: Record<string, ArcCustomCapturedApi>;
}

export interface ArcPushCaptureMessage {
  type: "ARC_PUSH_CAPTURE";
  payload: ArcLatestCaptureState;
}

export interface ArcGetLatestCaptureMessage {
  type: "ARC_GET_LATEST_CAPTURE";
}

export interface ArcGetLatestCaptureResponse {
  payload: ArcLatestCaptureState | null;
}

export type RuntimeMessage =
  | ArcPushCaptureMessage
  | ArcGetLatestCaptureMessage;