import type { KeyValuePair } from "../types/proxy.types";

export interface TekionApiSettings extends Record<string, string> {
  tapDuoApiToken: string;
  graphApiToken: string;
}

export interface TekionApiSettingsBundle {
  values: TekionApiSettings;
  savedAtByKey: Record<string, string>;
  updatedAt: string | null;
  globalHeaders: KeyValuePair[];
}

const STORAGE_KEY = "tekion-api-settings";

const DEFAULT_SETTINGS: TekionApiSettings = {
  tapDuoApiToken: "",
  graphApiToken: "",
};

function normalizeStringMap(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};

  const out: Record<string, string> = {};

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") {
      out[key] = value;
    }
  }

  return out;
}

function normalizeGlobalHeaders(input: unknown): KeyValuePair[] {
  if (!Array.isArray(input)) return [];

  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const row = item as Record<string, unknown>;
      const key = typeof row.key === "string" ? row.key : "";
      const value = typeof row.value === "string" ? row.value : "";
      const enabled =
        typeof row.enabled === "boolean" ? row.enabled : true;

      if (!key.trim()) return null;

      return {
        key,
        value,
        enabled,
      } as KeyValuePair;
    })
    .filter((item): item is KeyValuePair => Boolean(item));
}

function withDefaults(values: Record<string, string>): TekionApiSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...values,
  };
}

function persistBundle(bundle: TekionApiSettingsBundle): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 3,
      values: bundle.values,
      savedAtByKey: bundle.savedAtByKey,
      updatedAt: bundle.updatedAt,
      globalHeaders: bundle.globalHeaders,
    })
  );
}

export function loadTekionApiSettingsBundle(): TekionApiSettingsBundle {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {
        values: withDefaults({}),
        savedAtByKey: {},
        updatedAt: null,
        globalHeaders: [],
      };
    }

    const parsed = JSON.parse(raw) as
      | {
          version?: number;
          values?: unknown;
          savedAtByKey?: unknown;
          updatedAt?: unknown;
          globalHeaders?: unknown;
        }
      | Record<string, unknown>;

    if (
      parsed &&
      typeof parsed === "object" &&
      "values" in parsed &&
      parsed.values &&
      typeof parsed.values === "object"
    ) {
      return {
        values: withDefaults(normalizeStringMap(parsed.values)),
        savedAtByKey: normalizeStringMap(parsed.savedAtByKey),
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
        globalHeaders: normalizeGlobalHeaders(parsed.globalHeaders),
      };
    }

    return {
      values: withDefaults(normalizeStringMap(parsed)),
      savedAtByKey: {},
      updatedAt: null,
      globalHeaders: [],
    };
  } catch {
    return {
      values: withDefaults({}),
      savedAtByKey: {},
      updatedAt: null,
      globalHeaders: [],
    };
  }
}

export function loadTekionApiSettings(): TekionApiSettings {
  return loadTekionApiSettingsBundle().values;
}

export function loadGlobalHeaders(): KeyValuePair[] {
  return loadTekionApiSettingsBundle().globalHeaders;
}

export function saveTekionApiSettings(
  next: Partial<TekionApiSettings>
): TekionApiSettings {
  const current = loadTekionApiSettingsBundle();
  const incoming = normalizeStringMap(next);
  const now = new Date().toISOString();

  const mergedValues: Record<string, string> = {
    ...current.values,
  };

  const nextSavedAtByKey: Record<string, string> = {
    ...current.savedAtByKey,
  };

  for (const [key, value] of Object.entries(incoming)) {
    mergedValues[key] = value;

    if (value.trim()) {
      nextSavedAtByKey[key] = now;
    } else {
      delete nextSavedAtByKey[key];
    }
  }

  const bundle: TekionApiSettingsBundle = {
    values: withDefaults(mergedValues),
    savedAtByKey: nextSavedAtByKey,
    updatedAt: now,
    globalHeaders: current.globalHeaders,
  };

  persistBundle(bundle);
  return bundle.values;
}

export function saveGlobalHeaders(globalHeaders: KeyValuePair[]): KeyValuePair[] {
  const current = loadTekionApiSettingsBundle();
  const now = new Date().toISOString();

  const bundle: TekionApiSettingsBundle = {
    values: current.values,
    savedAtByKey: current.savedAtByKey,
    updatedAt: now,
    globalHeaders: normalizeGlobalHeaders(globalHeaders),
  };

  persistBundle(bundle);
  return bundle.globalHeaders;
}

export function clearGlobalHeaders(): void {
  const current = loadTekionApiSettingsBundle();
  const now = new Date().toISOString();

  const bundle: TekionApiSettingsBundle = {
    values: current.values,
    savedAtByKey: current.savedAtByKey,
    updatedAt: now,
    globalHeaders: [],
  };

  persistBundle(bundle);
}

export function clearTekionApiSetting(key: string): TekionApiSettings {
  const current = loadTekionApiSettingsBundle();
  const now = new Date().toISOString();

  const nextValues: Record<string, string> = {
    ...current.values,
    [key]: "",
  };

  const nextSavedAtByKey: Record<string, string> = {
    ...current.savedAtByKey,
  };

  delete nextSavedAtByKey[key];

  const bundle: TekionApiSettingsBundle = {
    values: withDefaults(nextValues),
    savedAtByKey: nextSavedAtByKey,
    updatedAt: now,
    globalHeaders: current.globalHeaders,
  };

  persistBundle(bundle);
  return bundle.values;
}

export function clearTekionApiSettings(): void {
  localStorage.removeItem(STORAGE_KEY);
}
