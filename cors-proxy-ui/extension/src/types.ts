///Users/tlreddy/Desktop/ARC_CONFIGURATION_V0/cors-proxy-ui/extension/src/types.ts
export interface HeaderMap {
  [key: string]: string;
}

export interface DecodedTokenInfo {
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

export interface CustomWatchRule {
  id: string;
  label: string;
  pattern: string;
  matchMode: "includes" | "exact";
  expiryHours: number;
  createdAt: string;
}

export interface CustomCapturedApi {
  id: string;
  label: string;
  pattern: string;
  matchMode: "includes" | "exact";
  expiryHours: number;
  matchedUrl: string;
  capturedAt: string;
  lastSeenAt: string;
  token?: string;
  decodedToken?: DecodedTokenInfo;
  headers: HeaderMap;
}

export interface ArcCaptureState {
  graphApiToken?: string;
  tapDuoApiToken?: string;

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

  customCaptures?: Record<string, CustomCapturedApi>;
}

export interface ArcPushCaptureMessage {
  type: "ARC_PUSH_CAPTURE";
  payload: ArcCaptureState;
}

export interface ArcGetLatestCaptureMessage {
  type: "ARC_GET_LATEST_CAPTURE";
}

export interface ArcGetLatestCaptureResponse {
  payload: ArcCaptureState | null;
}

export type RuntimeMessage =
  | ArcPushCaptureMessage
  | ArcGetLatestCaptureMessage;

export {};
