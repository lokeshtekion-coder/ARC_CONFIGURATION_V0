import React, { useEffect, useMemo, useState } from "react";
import { loadTekionCapturedProfiles } from "../../../services/tekionCapturedProfiles";
import { loadTekionApiSettingsBundle } from "../../../services/tekionApiSettings";
import { useServiceBlueprint } from "../../../Context/Blueprint_Service_Context";
import type { KeyValuePair } from "../../../types/proxy.types";

const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";
const PROXY_ENDPOINT = "http://127.0.0.1:4000/api/proxy";
const DEFAULT_HOST = "https://preprodapp.tekioncloud.com";

export const TGPT_TOKEN_KEY = "tgpt_access_token";
export const TGPT_BASE = "https://tapapi.tekioncloud.com/tapapi/tgpt";
export const SCHEDULE_SYNC_EVENT = "tekion:schedule-sync";
export const SCHEDULE_CACHE_KEY = "tekion_parsed_schedule_cache";

export const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type ParsedDayEntry = {
  blocked: boolean;
  start: string;
  end: string;
  source: string;
  raw: string;
  notes: string;
};

export type UnifiedScheduleResponse = {
  operatingHours: Record<string, ParsedDayEntry>;
  appointmentHours: Record<string, ParsedDayEntry>;
  validationWarnings: string[];
};

export interface ParsedTimeResult {
  originalInput: string;
  parsedValue: [string, string] | [];
  confidence: number;
  isClosed: boolean;
  needsReview: boolean;
}

// ============================================================================
// Schedule Extraction & Parsing Engine (Embedded)
// ============================================================================

function formatTwoDigits(n: number): string {
  return String(n).padStart(2, "0");
}

function formatMinutesToTime(totalMins: number): string {
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${formatTwoDigits(h)}:${formatTwoDigits(m)}`;
}

export function preflightSanitize(rawInput: string): string {
  if (!rawInput) return "";
  let text = rawInput.toLowerCase().trim();

  const noiseMap: Record<string, string> = {
    "\\bish\\b": "",
    "\\bin the morning\\b": "am",
    "\\bin the evening\\b": "pm",
    "\\bat night\\b": "pm",
    "\\bafternoon\\b": "pm",
    "\\bnoon\\b": "12:00pm",
    "\\bmidnight\\b": "12:00am",
    "\\bhalf past\\s+(\\d+)": "$1:30",
    "\\bhalf day\\b": "till 12:00pm",
    "\\bo'clock\\b": ":00",
    "\\boclock\\b": ":00",
  };

  for (const [pattern, rep] of Object.entries(noiseMap)) {
    text = text.replace(new RegExp(pattern, "gi"), rep);
  }

  const numberMap: Record<string, string> = {
    twenty: "20", thirty: "30", forty: "40", fifty: "50",
    eleven: "11", twelve: "12", ten: "10", fifteen: "15",
    one: "1", two: "2", three: "3", four: "4", five: "5",
    six: "6", seven: "7", eight: "8", nine: "9",
  };

  for (const [word, digit] of Object.entries(numberMap)) {
    text = text.replace(new RegExp(`\\b${word}\\b`, "gi"), digit);
  }

  return text.replace(/(\b\d{1,2})\s+(\d{2}\b)/g, "$1:$2");
}

export function parseOperatingHoursCore(rawInput: string): ParsedTimeResult {
  if (!rawInput || rawInput.trim() === "") {
    return { originalInput: rawInput, parsedValue: [], confidence: 1.0, isClosed: true, needsReview: false };
  }

  const processed = preflightSanitize(rawInput);
  if (/(closed|off|none|n\/a|na)/i.test(processed)) {
    return { originalInput: rawInput, parsedValue: [], confidence: 1.0, isClosed: true, needsReview: false };
  }

  if (/(24\/7|24 hours|24 hrs)/i.test(processed)) {
    return { originalInput: rawInput, parsedValue: ["00:00", "23:59"], confidence: 1.0, isClosed: false, needsReview: false };
  }

  const timeRegex = /(?:^|[^0-9:])(\d{1,2}:\d{2}|\d{3,4}|\d{1,2})\s*([ap]m?|[ap]\b)?/gi;
  const extractedMinutes: number[] = [];
  let match;

  while ((match = timeRegex.exec(processed)) !== null) {
    const rawTime = match[1];
    const modifier = match[2];
    let hr = 0;
    let min = 0;

    if (rawTime.includes(":")) {
      const parts = rawTime.split(":");
      hr = parseInt(parts[0], 10);
      min = parseInt(parts[1], 10);
    } else if (rawTime.length === 3 || rawTime.length === 4) {
      hr = parseInt(rawTime.slice(0, -2), 10);
      min = parseInt(rawTime.slice(-2), 10);
    } else {
      hr = parseInt(rawTime, 10);
    }

    if (modifier) {
      if (modifier.startsWith("p") && hr < 12) hr += 12;
      if (modifier.startsWith("a") && hr === 12) hr = 0;
    } else {
      if (extractedMinutes.length === 0 && hr < 5) hr += 12;
      if (extractedMinutes.length > 0 && hr >= 1 && hr <= 11) hr += 12;
    }

    extractedMinutes.push(hr * 60 + min);
  }

  if (extractedMinutes.length === 0) {
    return { originalInput: rawInput, parsedValue: [], confidence: 0, isClosed: false, needsReview: true };
  }

  if (extractedMinutes.length === 1) {
    const timeStr = formatMinutesToTime(extractedMinutes[0]);
    if (/(till|until|to|by)\s*\d/i.test(processed)) {
      return { originalInput: rawInput, parsedValue: ["08:00", timeStr], confidence: 0.8, isClosed: false, needsReview: false };
    }
    if (/(after|from|onwards)\s*\d/i.test(processed)) {
      return { originalInput: rawInput, parsedValue: [timeStr, "17:00"], confidence: 0.8, isClosed: false, needsReview: false };
    }
    return { originalInput: rawInput, parsedValue: [], confidence: 0.3, isClosed: false, needsReview: true };
  }

  const openMin = Math.min(...extractedMinutes);
  const closeMin = Math.max(...extractedMinutes);

  return {
    originalInput: rawInput,
    parsedValue: [formatMinutesToTime(openMin), formatMinutesToTime(closeMin)],
    confidence: 0.95,
    isClosed: false,
    needsReview: false,
  };
}

export function parseScheduleLocally(rawText: string): UnifiedScheduleResponse {
  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
  const operatingHours: Record<string, ParsedDayEntry> = {};
  const appointmentHours: Record<string, ParsedDayEntry> = {};

  let lastOpParsed: ParsedTimeResult | null = null;

  for (let i = 0; i < DAY_NAMES.length; i++) {
    const day = DAY_NAMES[i];
    const dLower = day.toLowerCase();

    const opLine = lines.find((l) => l.toLowerCase().includes(`${dLower} (operating`));
    const apptLine = lines.find((l) => l.toLowerCase().includes(`${dLower} (appointment`));

    const opRaw = opLine ? opLine.split(/::|:/).slice(1).join(":").trim() : "";
    const apptRaw = apptLine ? apptLine.split(/::|:/).slice(1).join(":").trim() : "";

    let opParsed: ParsedTimeResult;
    if (/(same|as above|ditto|^"$|^”$)/i.test(opRaw) && lastOpParsed) {
      opParsed = { ...lastOpParsed, originalInput: opRaw };
    } else {
      opParsed = parseOperatingHoursCore(opRaw);
      if (!opParsed.isClosed && opParsed.parsedValue.length === 2) {
        lastOpParsed = opParsed;
      }
    }

    const isApptSame = /(same|as above|ditto)/i.test(apptRaw) || (apptRaw === "" && !opParsed.isClosed);
    const apptParsed = isApptSame ? { ...opParsed } : parseOperatingHoursCore(apptRaw);

    operatingHours[dLower] = {
      blocked: opParsed.isClosed,
      start: opParsed.parsedValue[0] || "",
      end: opParsed.parsedValue[1] || "",
      source: "Operating Hours",
      raw: opRaw,
      notes: opParsed.needsReview ? "Flagged for review" : opParsed.isClosed ? "Closed" : "Parsed locally",
    };

    appointmentHours[dLower] = {
      blocked: apptParsed.isClosed,
      start: apptParsed.parsedValue[0] || "",
      end: apptParsed.parsedValue[1] || "",
      source: isApptSame ? "Operating Hours (Inherited)" : "Appointment Hours",
      raw: apptRaw,
      notes: isApptSame ? "Inherited from Operating Hours" : apptParsed.isClosed ? "Closed" : "Parsed locally",
    };
  }

  const result: UnifiedScheduleResponse = {
    operatingHours,
    appointmentHours,
    validationWarnings: [],
  };

  cacheUnifiedSchedule(result);
  return result;
}

export async function streamScheduleExtraction(
  token: string,
  rawText: string,
  onStatus?: (msg: string) => void
): Promise<UnifiedScheduleResponse> {
  const cleanedInput = preflightSanitize(rawText);

  onStatus?.("Initializing TGPT...");

  const createRes = await fetch(`${TGPT_BASE}/conversations`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-5.4",
      title: "Schedule Parser Workflow",
      is_temporary: true,
      thinking: false,
    }),
  });

  if (!createRes.ok) {
    throw new Error("Failed to create TGPT conversation. Token might be invalid.");
  }

  const { id: convId } = await createRes.json();
  onStatus?.("Extracting & Cross-Validating Hours...");

  const streamRes = await fetch(`${TGPT_BASE}/conversations/${convId}/messages/stream`, {
    method: "POST",
    headers: {
      accept: "*/*",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      content: `Extract schedule to 24h JSON:\n${cleanedInput}`,
      attachments: [],
      thinking: false,
      web_search_enabled: false,
      code_execution_enabled: false,
      artifacts_enabled: false,
    }),
  });

  if (!streamRes.ok || !streamRes.body) {
    throw new Error("Stream communication failed");
  }

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assistantContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      if (!part.trim()) continue;
      const lines = part.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const rawData = line.substring(6).trim();
        if (rawData === "[DONE]") continue;

        try {
          const data = JSON.parse(rawData);
          if (data.type === "content_delta") {
            assistantContent += data.delta || "";
          }
        } catch {}
      }
    }
  }

  const jsonMatch = assistantContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI did not return a valid JSON object.");
  }

  const rawParsed = JSON.parse(jsonMatch[0]) as UnifiedScheduleResponse;
  cacheUnifiedSchedule(rawParsed);
  return rawParsed;
}

export function extractAllBlueprintScheduleNotes(getAnswer: (query: string) => unknown): string {
  const lines: string[] = [];

  const notes = getAnswer("Department Hour Notes");
  if (notes !== undefined && notes !== null && String(notes).trim()) {
    lines.push(`[Department Hours > —] Department Hour Notes (if needed):: ${String(notes).trim()}`);
  }

  for (const day of DAY_NAMES) {
    const op = getAnswer(`${day} (Operating Hours)`);
    const appt = getAnswer(`${day} (Appointment Hours`);

    if (op !== undefined && op !== null && String(op).trim()) {
      lines.push(`[Department Hours > —] ${day} (Operating Hours):: ${String(op).trim()}`);
    }
    if (appt !== undefined && appt !== null && String(appt).trim()) {
      lines.push(`[Department Hours > —] ${day} (Appointment Hours - can be same as operating hours):: ${String(appt).trim()}`);
    }
  }

  return lines.join("\n");
}

export function cacheUnifiedSchedule(data: UnifiedScheduleResponse) {
  try {
    sessionStorage.setItem(SCHEDULE_CACHE_KEY, JSON.stringify(data));
    window.dispatchEvent(new CustomEvent(SCHEDULE_SYNC_EVENT, { detail: data }));
  } catch {}
}

export function getCachedUnifiedSchedule(): UnifiedScheduleResponse | null {
  try {
    const raw = sessionStorage.getItem(SCHEDULE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function matchDaySchedule(
  daysMap: Record<string, ParsedDayEntry>,
  dayKey: string,
  dayLabel: string
): ParsedDayEntry | null {
  if (!daysMap) return null;
  const k = dayKey.toLowerCase();
  const l = dayLabel.toLowerCase();
  const prefix = k.slice(0, 3);

  for (const [key, val] of Object.entries(daysMap)) {
    const cand = key.toLowerCase();
    if (cand === k || cand === l || cand.startsWith(prefix) || l.startsWith(cand)) {
      return val;
    }
  }
  return null;
}

// ============================================================================
// UI Component Definition
// ============================================================================

const DAY_OPTIONS = [
  { key: "monday", label: "Monday", apiDay: "MONDAY" },
  { key: "tuesday", label: "Tuesday", apiDay: "TUESDAY" },
  { key: "wednesday", label: "Wednesday", apiDay: "WEDNESDAY" },
  { key: "thursday", label: "Thursday", apiDay: "THURSDAY" },
  { key: "friday", label: "Friday", apiDay: "FRIDAY" },
  { key: "saturday", label: "Saturday", apiDay: "SATURDAY" },
  { key: "sunday", label: "Sunday", apiDay: "SUNDAY" },
] as const;

type DayKey = (typeof DAY_OPTIONS)[number]["key"];

type DayRowState = {
  blocked: boolean;
  start: string;
  end: string;
};

type DayStateMap = Record<DayKey, DayRowState>;

type ActiveTab = "appointment-reminder" | "operating-hours";
type RunState = "idle" | "loading" | "success" | "error" | "warning";

const cardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  padding: 18,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  color: "#f8fafc",
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  color: "#94a3b8",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const tdStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  color: "#e2e8f0",
  fontSize: 12,
  verticalAlign: "middle",
};

function buildInitialDaySchedule(): DayStateMap {
  return {
    monday: { blocked: false, start: "08:00", end: "17:00" },
    tuesday: { blocked: false, start: "08:00", end: "17:00" },
    wednesday: { blocked: false, start: "08:00", end: "17:00" },
    thursday: { blocked: false, start: "08:00", end: "17:00" },
    friday: { blocked: false, start: "08:00", end: "17:00" },
    saturday: { blocked: false, start: "09:00", end: "14:00" },
    sunday: { blocked: true, start: "", end: "" },
  };
}

function buildEmptyPreview(schedule: DayStateMap): Record<string, ParsedDayEntry> {
  const out: Record<string, ParsedDayEntry> = {};
  for (const day of DAY_OPTIONS) {
    const row = schedule[day.key];
    out[day.key] = {
      source: "Manual",
      blocked: Boolean(row?.blocked),
      start: row?.start || "",
      end: row?.end || "",
      raw: "",
      notes: "",
    };
  }
  return out;
}

function resolveActiveHeaders(): { headers: Record<string, string>; baseHost: string; dealerId: string } {
  const storedProfileId = localStorage.getItem(SELECTED_DEALER_PROFILE_KEY);
  const profiles = loadTekionCapturedProfiles();

  const matchedProfile = storedProfileId
    ? profiles.find(
        (p: { id: string; profileKey?: string; dealerId?: string }) =>
          p.id === storedProfileId ||
          p.profileKey === storedProfileId ||
          p.dealerId === storedProfileId
      )
    : profiles[0] ?? null;

  let headers: Record<string, string> = {};
  let baseHost = DEFAULT_HOST;
  let dealerId = matchedProfile?.dealerId || "";

  if (matchedProfile?.bootstrapHeaders && Object.keys(matchedProfile.bootstrapHeaders).length > 0) {
    headers = { ...matchedProfile.bootstrapHeaders };

    if (matchedProfile.sourceUrl) {
      try {
        baseHost = new URL(matchedProfile.sourceUrl).origin;
      } catch {
        baseHost = DEFAULT_HOST;
      }
    }
  } else {
    const bundle = loadTekionApiSettingsBundle();
    const rows = (bundle.globalHeaders ?? []).filter(
      (h: KeyValuePair) => h.enabled && h.key?.trim() && String(h.value ?? "").trim()
    );
    for (const row of rows) {
      const lower = row.key.trim().toLowerCase();
      headers[lower] = String(row.value).trim();
      if (lower === "dealerid" && !dealerId) {
        dealerId = String(row.value).trim();
      }
    }
  }

  headers["content-type"] = "application/json";
  return { headers, baseHost, dealerId };
}

async function executeViaProxy<T>(options: {
  url: string;
  method: "GET" | "POST" | "PUT";
  headers: Record<string, string>;
  body?: unknown;
}): Promise<T> {
  const res = await fetch(PROXY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: options.url,
      method: options.method,
      headers: options.headers,
      body: options.body,
      timeout: 30000,
    }),
  });

  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new Error(
      errorJson?.error?.message ||
        errorJson?.message ||
        `Proxy request failed with HTTP ${res.status}`
    );
  }

  const result = await res.json();
  if (result.status >= 400) {
    throw new Error(
      `Upstream Tekion error (${result.status}): ${
        typeof result.body === "string" ? result.body : JSON.stringify(result.body)
      }`
    );
  }

  return result.body as T;
}

export const DealerConfigView: React.FC = () => {
  const { getAnswer, hasBlueprint } = useServiceBlueprint();

  const [activeTab, setActiveTab] = useState<ActiveTab>("appointment-reminder");
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready to configure");
  const [errorText, setErrorText] = useState("");
  const [showInfo, setShowInfo] = useState(false);

  // Appointment Reminder Configuration States
  const [remindBefore, setRemindBefore] = useState<number>(1);
  const [remindBeforeUnit, setRemindBeforeUnit] = useState<string>("DAYS");
  const [timeInHours, setTimeInHours] = useState<number>(10);
  const [timeInMinutes, setTimeInMinutes] = useState<number>(0);
  const [textEnabled, setTextEnabled] = useState<boolean>(true);
  const [emailEnabled, setEmailEnabled] = useState<boolean>(true);
  const [isSavingReminder, setIsSavingReminder] = useState<boolean>(false);

  // Operating Hours Schedule Editor State
  const [dealerMasterData, setDealerMasterData] = useState<any>(null);
  const [isLoadingGet, setIsLoadingGet] = useState(false);
  const [isUpdatingPut, setIsUpdatingPut] = useState(false);

  const [daySchedule, setDaySchedule] = useState<DayStateMap>(buildInitialDaySchedule);
  const [inputMode, setInputMode] = useState<"ai" | "manual">("ai");
  const [rawScheduleInput, setRawScheduleInput] = useState("");
  const [parsedPreview, setParsedPreview] = useState<Record<string, ParsedDayEntry>>(() =>
    buildEmptyPreview(buildInitialDaySchedule())
  );
  const [autoSelectEnabled, setAutoSelectEnabled] = useState(false);

  // TGPT Token & Streaming
  const [token, setToken] = useState<string>("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");

  useEffect(() => {
    const saved = localStorage.getItem(TGPT_TOKEN_KEY);
    if (saved) setToken(saved);
  }, []);

  const appointmentReminderPayload = useMemo(() => {
    return {
      updatedReminderSettings: [],
      addedReminderSettings: [
        {
          reminderName: "Appointment Reminder",
          remindBefore,
          remindBeforeUnit,
          time: {
            timeInHours,
            timeInMinutes,
          },
          textEnabled,
          emailEnabled,
        },
      ],
      deletedReminderSettings: [],
    };
  }, [remindBefore, remindBeforeUnit, timeInHours, timeInMinutes, textEnabled, emailEnabled]);

  const handleSaveAppointmentReminder = async () => {
    setIsSavingReminder(true);
    setRunState("loading");
    setStatusText("Saving Appointment Reminder notification settings...");
    setErrorText("");

    try {
      const { headers, baseHost } = resolveActiveHeaders();
      const notificationUrl = `${baseHost}/api/scheduling/u/settings/notification`;

      await executeViaProxy({
        url: notificationUrl,
        method: "PUT",
        headers,
        body: appointmentReminderPayload,
      });

      setRunState("success");
      setStatusText("✓ Successfully configured Appointment Reminder!");
    } catch (err: any) {
      setRunState("error");
      setStatusText("Failed to save Appointment Reminder");
      setErrorText(err.message || String(err));
    } finally {
      setIsSavingReminder(false);
    }
  };

  const applyOperatingHours = (data: UnifiedScheduleResponse) => {
    const newPreview = buildEmptyPreview(daySchedule);
    for (const day of DAY_OPTIONS) {
      const item = matchDaySchedule(data.operatingHours, day.key, day.label);
      if (item) {
        newPreview[day.key] = {
          source: item.source || "Operating Hours",
          blocked: Boolean(item.blocked),
          start: item.start || "",
          end: item.end || "",
          raw: item.raw || "",
          notes: item.notes || "",
        };
      }
    }
    setParsedPreview(newPreview);
  };

  useEffect(() => {
    const cached = getCachedUnifiedSchedule();
    if (cached) applyOperatingHours(cached);

    const handleSync = (e: Event) => {
      const customEvent = e as CustomEvent<UnifiedScheduleResponse>;
      if (customEvent.detail) applyOperatingHours(customEvent.detail);
    };

    window.addEventListener(SCHEDULE_SYNC_EVENT, handleSync);
    return () => window.removeEventListener(SCHEDULE_SYNC_EVENT, handleSync);
  }, []);

  useEffect(() => {
    if (hasBlueprint && getAnswer && !rawScheduleInput) {
      const rawText = extractAllBlueprintScheduleNotes(getAnswer);
      if (rawText.trim()) setRawScheduleInput(rawText);
    }
  }, [hasBlueprint, getAnswer, rawScheduleInput]);

  const handleFetchDealerMaster = async (): Promise<any> => {
    setIsLoadingGet(true);
    setRunState("loading");
    setStatusText("Fetching Dealer Master via proxy...");
    setErrorText("");

    try {
      const { headers, baseHost } = resolveActiveHeaders();
      const getUrl = `${baseHost}/api/api-core/u/dealer-master`;

      const response = await executeViaProxy<{ status: string; data: any }>({
        url: getUrl,
        method: "GET",
        headers,
      });

      if (!response?.data) {
        throw new Error("No data received in dealer master response");
      }

      setDealerMasterData(response.data);
      setRunState("success");
      setStatusText(`✓ Dealer Master loaded for "${response.data.dealerName || response.data.id}"`);
      return response.data;
    } catch (err: any) {
      setRunState("error");
      setStatusText("Failed to fetch Dealer Master");
      setErrorText(err.message || String(err));
      return null;
    } finally {
      setIsLoadingGet(false);
    }
  };

  const handleUpdateDealerMaster = async () => {
    setIsUpdatingPut(true);
    setRunState("loading");
    setStatusText("Preparing Dealer Master update payload...");
    setErrorText("");

    try {
      const { headers, baseHost, dealerId: fallbackDealerId } = resolveActiveHeaders();

      const currentMaster = dealerMasterData ?? (await handleFetchDealerMaster());
      if (!currentMaster) {
        throw new Error("Cannot update without fetching the existing dealer master data first.");
      }

      const activeDealerId = currentMaster.id || fallbackDealerId;
      const activeTenantId = currentMaster.tenantId;

      if (!activeDealerId || !activeTenantId) {
        throw new Error("Could not identify dealer ID or tenantId from response or headers.");
      }

      const updatedSchedules = (currentMaster.dealerOperationSchedule ?? []).map((schedule: any) => {
        const updatedBusinessHours = (schedule.businessHours ?? []).map((bh: any) => {
          const matchDay = DAY_OPTIONS.find((d) => d.apiDay === String(bh.dayOfWeek).toUpperCase());
          if (!matchDay) return bh;

          const scheduleRow = daySchedule[matchDay.key];
          const isClosed = Boolean(scheduleRow.blocked);

          return {
            ...bh,
            openingTime: isClosed ? "" : scheduleRow.start || "08:00",
            closingTime: isClosed ? "" : scheduleRow.end || "17:00",
            closed: isClosed,
          };
        });

        return {
          ...schedule,
          businessHours: updatedBusinessHours,
        };
      });

      const putPayload = {
        ...currentMaster,
        dealerOperationSchedule: updatedSchedules,
      };

      const putUrl = `${baseHost}/api/api-core/u/tenant/${activeTenantId}/dealer-master/${activeDealerId}`;

      setStatusText(`Sending PUT update to /dealer-master/${activeDealerId}...`);
      await executeViaProxy({
        url: putUrl,
        method: "PUT",
        headers,
        body: putPayload,
      });

      setDealerMasterData(putPayload);
      setRunState("success");
      setStatusText(`✓ Successfully updated Operation Schedule for Dealer ${activeDealerId}`);
    } catch (err: any) {
      setRunState("error");
      setStatusText("Failed to update Dealer Master");
      setErrorText(err.message || String(err));
    } finally {
      setIsUpdatingPut(false);
    }
  };

  const handleAIParse = async () => {
    if (!rawScheduleInput.trim() || !token) {
      if (!token) {
        setRunState("error");
        setStatusText("TGPT Token Missing");
        setErrorText("Please connect your TGPT token in Coupons View or localStorage.");
      }
      return;
    }

    setIsAiLoading(true);
    setLoadingText("Initializing TGPT...");
    setErrorText("");

    try {
      const data = await streamScheduleExtraction(token, rawScheduleInput, (status: string) =>
        setLoadingText(status)
      );
      applyOperatingHours(data);
      setRunState("success");
      setStatusText("✓ Operating hours parsed & synchronized from Blueprint notes.");
    } catch (err: any) {
      setRunState("error");
      setStatusText("AI Parsing Failed");
      setErrorText(err.message || String(err));
    } finally {
      setIsAiLoading(false);
      setLoadingText("");
    }
  };

  const handleManualLocalParse = () => {
    if (!rawScheduleInput.trim()) return;
    setErrorText("");

    try {
      const data = parseScheduleLocally(rawScheduleInput);
      applyOperatingHours(data);
      setRunState("success");
      setStatusText("✓ Operating hours parsed locally via offline rule engine.");
    } catch (err: any) {
      setRunState("error");
      setStatusText("Local Parsing Failed");
      setErrorText(err.message || String(err));
    }
  };

  const handleApplyPreviewToSchedule = () => {
    setDaySchedule((prev) => {
      const next = { ...prev };
      for (const day of DAY_OPTIONS) {
        const preview = parsedPreview[day.key];
        if (!preview) continue;
        next[day.key] = {
          blocked: preview.blocked,
          start: preview.blocked ? "" : preview.start,
          end: preview.blocked ? "" : preview.end,
        };
      }
      return next;
    });
    setStatusText("✓ Applied preview to Operating Hours schedule rows.");
  };

  const updateScheduleRow = (
    dayKey: DayKey,
    patch: { blocked?: boolean; start?: string; end?: string }
  ) => {
    setDaySchedule((prev) => {
      const nextCurrentDay = { ...prev[dayKey], ...patch };
      if (!autoSelectEnabled) return { ...prev, [dayKey]: nextCurrentDay };

      const next = { ...prev };
      for (const day of DAY_OPTIONS) {
        next[day.key] = {
          ...next[day.key],
          blocked: nextCurrentDay.blocked,
          start: nextCurrentDay.start,
          end: nextCurrentDay.end,
        };
      }
      return next;
    });
  };

  const banner = useMemo(() => {
    switch (runState) {
      case "error":
        return { bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.25)", text: "#fecaca" };
      case "success":
        return { bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.25)", text: "#bbf7d0" };
      case "warning":
        return { bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.25)", text: "#fde68a" };
      default:
        return { bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.08)", text: "#cbd5e1" };
    }
  }, [runState]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Top Header Card */}
      <div style={{ ...cardStyle, display: "grid", gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#f8fafc" }}>
              Dealer Configuration
            </div>
            <button
              type="button"
              onClick={() => setShowInfo((p: boolean) => !p)}
              style={{
                width: 20,
                height: 20,
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "#94a3b8",
                fontSize: 11,
                cursor: "pointer",
                fontWeight: 700,
              }}
              title="Toggle Description"
            >
              i
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {activeTab === "appointment-reminder" ? (
              <button
                className="btn-primary"
                type="button"
                onClick={() => void handleSaveAppointmentReminder()}
                disabled={isSavingReminder}
                style={{ padding: "8px 16px" }}
              >
                {isSavingReminder ? "Saving..." : "Save Appointment Reminder"}
              </button>
            ) : (
              <>
                <button
                  className="btn-postman"
                  type="button"
                  onClick={() => void handleFetchDealerMaster()}
                  disabled={isLoadingGet || isUpdatingPut}
                >
                  {isLoadingGet ? "Loading..." : "GET Dealer Master"}
                </button>

                <button
                  className="btn-primary"
                  type="button"
                  onClick={() => void handleUpdateDealerMaster()}
                  disabled={isUpdatingPut || isLoadingGet}
                  style={{ padding: "8px 16px" }}
                >
                  {isUpdatingPut ? "Updating..." : "⚙ Update Operation Schedule"}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: "flex", gap: 8, borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 10 }}>
          <button
            type="button"
            onClick={() => setActiveTab("appointment-reminder")}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: activeTab === "appointment-reminder" ? "1px solid rgba(59,130,246,0.5)" : "1px solid rgba(255,255,255,0.08)",
              background: activeTab === "appointment-reminder" ? "rgba(59,130,246,0.15)" : "transparent",
              color: activeTab === "appointment-reminder" ? "#93c5fd" : "#94a3b8",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            1. Appointment Reminder
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("operating-hours")}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              border: activeTab === "operating-hours" ? "1px solid rgba(59,130,246,0.5)" : "1px solid rgba(255,255,255,0.08)",
              background: activeTab === "operating-hours" ? "rgba(59,130,246,0.15)" : "transparent",
              color: activeTab === "operating-hours" ? "#93c5fd" : "#94a3b8",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            2. Operating Hour Details
          </button>
        </div>

        {showInfo && (
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
              color: "#94a3b8",
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            Configures appointment reminders via <code>PUT /api/scheduling/u/settings/notification</code> and aligns department working schedules via <code>PUT /api/api-core/u/tenant/{`{tenantId}`}/dealer-master/{`{dealerId}`}</code> without dropping existing configuration keys.
          </div>
        )}

        <div
          style={{
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: 13,
            border: `1px solid ${banner.border}`,
            background: banner.bg,
            color: banner.text,
          }}
        >
          <div style={{ fontWeight: 700 }}>{statusText}</div>
          {errorText && <div style={{ fontSize: 12, marginTop: 4 }}>{errorText}</div>}
        </div>
      </div>

      {/* TAB 1: APPOINTMENT REMINDER */}
      {activeTab === "appointment-reminder" && (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={cardStyle}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#f8fafc", marginBottom: 6 }}>
              Appointment Reminder Notification Settings
            </div>
            <div style={{ color: "#94a3b8", fontSize: 13, marginBottom: 16 }}>
              Default settings sent to <code>PUT /api/scheduling/u/settings/notification</code>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 14,
              }}
            >
              <div>
                <span style={labelStyle}>Reminder Name</span>
                <input
                  type="text"
                  value="Appointment Reminder"
                  disabled
                  style={{ ...inputStyle, background: "rgba(255,255,255,0.01)", color: "#94a3b8" }}
                />
              </div>

              <div>
                <span style={labelStyle}>Remind Before</span>
                <input
                  type="number"
                  value={remindBefore}
                  onChange={(e) => setRemindBefore(Number(e.target.value))}
                  style={inputStyle}
                  min={1}
                />
              </div>

              <div>
                <span style={labelStyle}>Remind Before Unit</span>
                <select
                  value={remindBeforeUnit}
                  onChange={(e) => setRemindBeforeUnit(e.target.value)}
                  style={inputStyle}
                >
                  <option value="DAYS">DAYS</option>
                  <option value="HOURS">HOURS</option>
                  <option value="MINUTES">MINUTES</option>
                </select>
              </div>

              <div>
                <span style={labelStyle}>Time (Hours & Minutes)</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="number"
                    value={timeInHours}
                    onChange={(e) => setTimeInHours(Number(e.target.value))}
                    style={inputStyle}
                    min={0}
                    max={23}
                    placeholder="HH"
                  />
                  <input
                    type="number"
                    value={timeInMinutes}
                    onChange={(e) => setTimeInMinutes(Number(e.target.value))}
                    style={inputStyle}
                    min={0}
                    max={59}
                    placeholder="MM"
                  />
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 8 }}>
                <span style={labelStyle}>Channels</span>
                <div style={{ display: "flex", gap: 16 }}>
                  <label style={radioLabelStyle}>
                    <input
                      type="checkbox"
                      checked={textEnabled}
                      onChange={(e) => setTextEnabled(e.target.checked)}
                    />
                    Text (SMS)
                  </label>

                  <label style={radioLabelStyle}>
                    <input
                      type="checkbox"
                      checked={emailEnabled}
                      onChange={(e) => setEmailEnabled(e.target.checked)}
                    />
                    Email
                  </label>
                </div>
              </div>
            </div>

            {/* Live Payload Preview */}
            <div style={{ marginTop: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#cbd5e1", marginBottom: 6 }}>
                Payload Preview:
              </div>
              <pre
                style={{
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  padding: 14,
                  color: "#86efac",
                  fontSize: 12,
                  fontFamily: "ui-monospace, monospace",
                  overflowX: "auto",
                  margin: 0,
                }}
              >
                {JSON.stringify(appointmentReminderPayload, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: OPERATING HOUR DETAILS */}
      {activeTab === "operating-hours" && (
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ ...cardStyle, display: "grid", gap: 14 }}>
            <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800 }}>
              Operating Hours Blueprint Input
            </div>

            <div style={{ color: "#94a3b8", fontSize: 13 }}>
              Extracts the continuous shop working schedule. Operating hours populate Management, Sales, Service, and Parts schedules.
            </div>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
              <label style={radioLabelStyle}>
                <input
                  type="radio"
                  checked={inputMode === "ai"}
                  onChange={() => setInputMode("ai")}
                />
                Option 1: AI (TGPT)
              </label>

              <label style={radioLabelStyle}>
                <input
                  type="radio"
                  checked={inputMode === "manual"}
                  onChange={() => setInputMode("manual")}
                />
                Option 2: Manual
              </label>
            </div>

            {inputMode === "ai" ? (
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ color: "#f8fafc", fontSize: 13, fontWeight: 700 }}>
                    Raw Blueprint Operating Notes
                  </div>
                  {getAnswer && (
                    <button
                      type="button"
                      onClick={() => {
                        const rawText = extractAllBlueprintScheduleNotes(getAnswer);
                        if (rawText.trim()) setRawScheduleInput(rawText);
                      }}
                      style={{
                        background: "rgba(34,197,94,0.12)",
                        border: "1px solid rgba(34,197,94,0.3)",
                        color: "#86efac",
                        fontSize: "12px",
                        padding: "3px 10px",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      ↻ Reload from Blueprint
                    </button>
                  )}
                </div>

                <textarea
                  value={rawScheduleInput}
                  onChange={(e) => setRawScheduleInput(e.target.value)}
                  placeholder="Paste operating hours notes or reload from blueprint..."
                  rows={8}
                  disabled={isAiLoading}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.03)",
                    color: "#a7f3d0",
                    outline: "none",
                    resize: "vertical",
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                />

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={handleAIParse}
                    disabled={isAiLoading || !rawScheduleInput.trim()}
                    className="btn-postman"
                  >
                    {isAiLoading ? `⏳ ${loadingText}` : "✨ Parse with AI (Auto)"}
                  </button>

                  <button
                    type="button"
                    onClick={handleManualLocalParse}
                    disabled={isAiLoading || !rawScheduleInput.trim()}
                    className="btn-secondary btn-sm"
                  >
                    ⚡ Parse Local (Offline)
                  </button>

                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={handleApplyPreviewToSchedule}
                  >
                    Apply Preview to Operating Schedule
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ color: "#94a3b8", fontSize: 13 }}>
                Manual mode selected. Directly adjust weekly operating hours below.
              </div>
            )}

            <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10 }}>
              <label style={radioLabelStyle}>
                <input
                  type="checkbox"
                  checked={autoSelectEnabled}
                  onChange={(e) => setAutoSelectEnabled(e.target.checked)}
                />
                Auto Select (Apply changes across all 7 days)
              </label>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 12,
              }}
            >
              {DAY_OPTIONS.map((day) => {
                const row = daySchedule[day.key];
                return (
                  <div
                    key={day.key}
                    style={{
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.06)",
                      background: "rgba(255,255,255,0.02)",
                      padding: 12,
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <div style={{ color: "#f8fafc", fontWeight: 700, fontSize: 13 }}>
                      {day.label}
                    </div>

                    <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#cbd5e1", fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={row.blocked}
                        onChange={(e) =>
                          updateScheduleRow(day.key, {
                            blocked: e.target.checked,
                            start: e.target.checked ? "" : row.start || "08:00",
                            end: e.target.checked ? "" : row.end || "17:00",
                          })
                        }
                      />
                      Closed / Blocked
                    </label>

                    <input
                      type="time"
                      value={row.start}
                      disabled={row.blocked}
                      style={inputStyle}
                      onChange={(e) => updateScheduleRow(day.key, { start: e.target.value })}
                    />

                    <input
                      type="time"
                      value={row.end}
                      disabled={row.blocked}
                      style={inputStyle}
                      onChange={(e) => updateScheduleRow(day.key, { end: e.target.value })}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
              Parsed Operating Schedule Preview
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <th style={thStyle}>Day</th>
                    <th style={thStyle}>Source</th>
                    <th style={thStyle}>Closed</th>
                    <th style={thStyle}>Opening</th>
                    <th style={thStyle}>Closing</th>
                    <th style={thStyle}>Raw Input</th>
                    <th style={thStyle}>Notes</th>
                  </tr>
                </thead>

                <tbody>
                  {DAY_OPTIONS.map(({ key, label }) => {
                    const preview = parsedPreview[key];
                    return (
                      <tr key={key} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                        <td style={{ ...tdStyle, color: "#f8fafc", fontWeight: 700 }}>{label}</td>
                        <td style={tdStyle}>{preview?.source || "—"}</td>
                        <td style={tdStyle}>{preview?.blocked ? "Yes" : "No"}</td>
                        <td style={{ ...tdStyle, color: "#86efac", fontWeight: 700 }}>{preview?.start || "—"}</td>
                        <td style={{ ...tdStyle, color: "#86efac", fontWeight: 700 }}>{preview?.end || "—"}</td>
                        <td style={{ ...tdStyle, color: "#94a3b8", fontFamily: "monospace" }}>{preview?.raw || "—"}</td>
                        <td style={{ ...tdStyle, color: "#fde047" }}>{preview?.notes || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 11,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  display: "block",
  marginBottom: 4,
};

const radioLabelStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  color: "#e2e8f0",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};

export default DealerConfigView;