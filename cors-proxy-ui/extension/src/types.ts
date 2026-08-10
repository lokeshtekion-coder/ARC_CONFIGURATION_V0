export interface HeaderMap {
  [key: string]: string;
}

export interface ArcCaptureState {
  graphApiToken?: string;
  tapDuoApiToken?: string;

  graphHeaders?: HeaderMap;
  tekionImplementationHeaders?: HeaderMap;
  tekionBootstrapHeaders?: HeaderMap;

  lastGraphSourceUrl?: string;
  lastTekionImplementationSourceUrl?: string;
  lastTekionBootstrapSourceUrl?: string;

  lastGraphCaptureAt?: string;
  lastTekionImplementationCaptureAt?: string;
  lastTekionBootstrapCaptureAt?: string;
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
