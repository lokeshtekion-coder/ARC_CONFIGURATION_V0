export interface HeaderMap {
  [key: string]: string;
}

export interface ArcBrowserCaptureState {
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

const STORAGE_KEY = "arc-extension-browser-capture";

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeHeaderMap(input: unknown): HeaderMap | undefined {
  if (!input || typeof input !== "object") return undefined;

  const out: HeaderMap = {};

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") {
      out[key] = value;
    }
  }

  return out;
}

function normalizeCaptureState(input: unknown): ArcBrowserCaptureState {
  if (!input || typeof input !== "object") {
    return {};
  }

  const raw = input as Record<string, unknown>;

  return {
    graphApiToken: normalizeString(raw.graphApiToken),
    tapDuoApiToken: normalizeString(raw.tapDuoApiToken),

    graphHeaders: normalizeHeaderMap(raw.graphHeaders),
    tekionImplementationHeaders: normalizeHeaderMap(raw.tekionImplementationHeaders),
    tekionBootstrapHeaders: normalizeHeaderMap(raw.tekionBootstrapHeaders),

    lastGraphSourceUrl: normalizeString(raw.lastGraphSourceUrl),
    lastTekionImplementationSourceUrl: normalizeString(raw.lastTekionImplementationSourceUrl),
    lastTekionBootstrapSourceUrl: normalizeString(raw.lastTekionBootstrapSourceUrl),

    lastGraphCaptureAt: normalizeString(raw.lastGraphCaptureAt),
    lastTekionImplementationCaptureAt: normalizeString(raw.lastTekionImplementationCaptureAt),
    lastTekionBootstrapCaptureAt: normalizeString(raw.lastTekionBootstrapCaptureAt),
  };
}

export function loadArcBrowserCapture(): ArcBrowserCaptureState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};

    return normalizeCaptureState(JSON.parse(raw));
  } catch {
    return {};
  }
}

export function saveArcBrowserCapture(
  next: Partial<ArcBrowserCaptureState>
): ArcBrowserCaptureState {
  const current = loadArcBrowserCapture();
  const normalizedNext = normalizeCaptureState(next);

  const merged: ArcBrowserCaptureState = {
    ...current,
    ...normalizedNext,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}
