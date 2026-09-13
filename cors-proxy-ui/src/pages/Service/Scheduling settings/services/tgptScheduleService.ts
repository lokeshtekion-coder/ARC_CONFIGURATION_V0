export const TGPT_TOKEN_KEY = "tgpt_access_token";
export const TGPT_BASE = "https://tapapi.tekioncloud.com/tapapi/tgpt";
export const SCHEDULE_SYNC_EVENT = "tekion:schedule-sync";
export const SCHEDULE_CACHE_KEY = "tekion_parsed_schedule_cache";

export type DayOfWeek = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
export const DAY_ORDER: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
export const ALL_DAYS = new Set(DAY_ORDER);

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
  start: string; // "HH:mm"
  end: string;   // "HH:mm"
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
// 1. FULL 5-LAYER PARSING ENGINE (PRESERVED)
// ============================================================================

function formatTwoDigits(n: number): string {
  return String(n).padStart(2, "0");
}

function formatMinutesToTime(totalMins: number): string {
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${formatTwoDigits(h)}:${formatTwoDigits(m)}`;
}

function createClosedResult(input: string = ""): ParsedTimeResult {
  return { originalInput: input, parsedValue: [], confidence: 1.0, isClosed: true, needsReview: false };
}

function createReviewResult(input: string, conf: number): ParsedTimeResult {
  return { originalInput: input, parsedValue: [], confidence: conf, isClosed: false, needsReview: true };
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

  text = text.replace(/(\b\d{1,2})\s+(\d{2}\b)/g, "$1:$2");
  return text;
}

export function parseOperatingHoursCore(rawInput: string): ParsedTimeResult {
  if (!rawInput || rawInput.trim() === "") return createClosedResult(rawInput);

  const processed = preflightSanitize(rawInput);

  if (/(closed|off|none|n\/a|na)/i.test(processed)) return createClosedResult(rawInput);
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
    return createReviewResult(rawInput, 0);
  }

  if (extractedMinutes.length === 1) {
    const timeStr = formatMinutesToTime(extractedMinutes[0]);
    if (/(whenever|flexible|depends)/i.test(processed)) {
      return createReviewResult(rawInput, 0.2);
    }
    if (/(till|until|to|by)\s*\d/i.test(processed)) {
      return { originalInput: rawInput, parsedValue: ["08:00", timeStr], confidence: 0.8, isClosed: false, needsReview: false };
    }
    if (/(after|from|onwards)\s*\d/i.test(processed)) {
      return { originalInput: rawInput, parsedValue: [timeStr, "17:00"], confidence: 0.8, isClosed: false, needsReview: false };
    }
    return createReviewResult(rawInput, 0.3);
  }

  const openMin = Math.min(...extractedMinutes);
  const closeMin = Math.max(...extractedMinutes);

  if (closeMin < openMin) {
    return { originalInput: rawInput, parsedValue: [formatMinutesToTime(openMin), formatMinutesToTime(closeMin)], confidence: 0.4, isClosed: false, needsReview: true };
  }

  const baseConf = processed.includes("maybe") || processed.includes("approx") ? 0.75 : 0.95;
  const finalConf = processed.includes("a") || processed.includes("p") ? 1.0 : baseConf;

  return {
    originalInput: rawInput,
    parsedValue: [formatMinutesToTime(openMin), formatMinutesToTime(closeMin)],
    confidence: finalConf,
    isClosed: false,
    needsReview: false,
  };
}

// ============================================================================
// 2. MASTER PROMPT
// ============================================================================

export const MASTER_SCHEDULE_PROMPT = `You are a lossless Automotive DMS Data Extraction and Cross-Validation Engine.
The input contains raw dealership scheduling notes: Operating Hours, Appointment Hours, Department notes, and edge cases.
Extract and normalize these hours into strict 24-hour JSON format.

DEALERSHIP REAL-WORLD PARSING RULES:

1. ZERO-MERIDIEM & NAKED NUMBERS:
   - "7-6" -> start: "07:00", end: "18:00".
   - "7-4:30" -> start: "07:00", end: "16:30".
   - "8-4" -> start: "08:00", end: "16:00".
   - Opening digits (5 to 10) are AM. Closing digits lower than 12 following a morning start are PM.

2. ONE-SIDED MERIDIEM:
   - "8:00AM-5:45" -> start: "08:00", end: "17:45". Compare values: since 5:45 < 8:00, infer PM for closing time. Never round minutes.

3. RELATIVE & TRUNCATED KEYWORDS:
   - "till 5" or "until 5" -> start: "08:00", end: "17:00".
   - "from 9" or "after 9" -> start: "09:00", end: "17:00" (or counterpart's close time).
   - "7:30 AM" with no end time -> start: "07:30", inherit end time directly from that day's counterpart hours.
   - "half day" -> closes at "12:00" (inherit counterpart start time).
   - "24/7" or "24 hours" -> start: "00:00", end: "23:59".

4. TYPOGRAPHICAL & OCR ERRORS:
   - "700 an 400 pm" -> Treat "an" as "am" -> start: "07:00", end: "16:00".
   - "700 am 700 pm" or "8:00 am 5:00 PM" without hyphens -> Parse as valid start/end pairs.

5. SPLIT SHIFTS & LUNCH BREAKS:
   - Tekion DMS schedules accept a single continuous window [start, end].
   - "7:30am-11:00am and 1:00pm-4:00pm" -> start: "07:30", end: "16:00". Note: "Split shift: 11:00-13:00 excluded".
   - "8am-5pm 12-1 lunch" -> start: "08:00", end: "17:00". Note: "Lunch 12:00-13:00 excluded".

6. BIDIRECTIONAL "SAME" RESOLUTION:
   - If Appointment Hours says "same", "same as operating hours", "as above", "ditto", or is blank -> Inherit the parsed Operating Hours for that day.
   - If Operating Hours says "same", "same as appointment", or is blank -> Inherit the outer bounds of Appointment Hours.

7. MUTUAL CLOSURE & OMITTED DAYS:
   - If marked "closed", "n/a", "na", "none", "off" -> blocked = true, start = "", end = "".
   - If a day is missing from Appointment Hours but marked "closed" in Operating Hours, mark both blocked = true.

8. NOISE FILTERING:
   - Silently ignore "Non-customer Operating Hours" or general shop comments that do not define customer hours.

OUTPUT FORMAT:
Return valid JSON only. Do not wrap in markdown or code blocks.
{
  "operatingHours": {
    "monday": { "blocked": false, "start": "07:00", "end": "18:00", "source": "Operating Hours", "raw": "STRING", "notes": "STRING" },
    "tuesday": { "blocked": false, "start": "07:00", "end": "18:00", "source": "Operating Hours", "raw": "STRING", "notes": "STRING" },
    "wednesday": { "blocked": false, "start": "07:00", "end": "18:00", "source": "Operating Hours", "raw": "STRING", "notes": "STRING" },
    "thursday": { "blocked": false, "start": "07:00", "end": "18:00", "source": "Operating Hours", "raw": "STRING", "notes": "STRING" },
    "friday": { "blocked": false, "start": "07:00", "end": "18:00", "source": "Operating Hours", "raw": "STRING", "notes": "STRING" },
    "saturday": { "blocked": false, "start": "07:00", "end": "17:00", "source": "Operating Hours", "raw": "STRING", "notes": "STRING" },
    "sunday": { "blocked": true, "start": "", "end": "", "source": "Operating Hours", "raw": "closed", "notes": "Closed" }
  },
  "appointmentHours": {
    "monday": { "blocked": false, "start": "07:00", "end": "16:30", "source": "Appointment Hours", "raw": "STRING", "notes": "STRING" },
    "tuesday": { "blocked": false, "start": "07:00", "end": "16:30", "source": "Appointment Hours", "raw": "STRING", "notes": "STRING" },
    "wednesday": { "blocked": false, "start": "07:00", "end": "16:30", "source": "Appointment Hours", "raw": "STRING", "notes": "STRING" },
    "thursday": { "blocked": false, "start": "07:00", "end": "16:30", "source": "Appointment Hours", "raw": "STRING", "notes": "STRING" },
    "friday": { "blocked": false, "start": "07:00", "end": "16:30", "source": "Appointment Hours", "raw": "STRING", "notes": "STRING" },
    "saturday": { "blocked": false, "start": "07:00", "end": "15:30", "source": "Appointment Hours", "raw": "STRING", "notes": "STRING" },
    "sunday": { "blocked": true, "start": "", "end": "", "source": "Appointment Hours", "raw": "closed", "notes": "Closed" }
  },
  "validationWarnings": ["STRING"]
}

RAW DATA:
`;

// ============================================================================
// 3. POST-FLIGHT VALIDATION & REPAIR
// ============================================================================

function postFlightValidateAndRepair(
  result: UnifiedScheduleResponse
): UnifiedScheduleResponse {
  const warnings = [...(result.validationWarnings || [])];

  const sanitizeEntry = (entry: ParsedDayEntry, day: string, type: string) => {
    if (entry.blocked) {
      entry.start = "";
      entry.end = "";
      return;
    }

    if (entry.start && /^\d:\d{2}$/.test(entry.start)) {
      entry.start = `0${entry.start}`;
    }
    if (entry.end && /^\d:\d{2}$/.test(entry.end)) {
      entry.end = `0${entry.end}`;
    }

    if (entry.start && entry.end) {
      const [sh, sm] = entry.start.split(":").map(Number);
      const [eh, em] = entry.end.split(":").map(Number);
      const startMins = sh * 60 + sm;
      const endMins = eh * 60 + em;

      if (endMins < startMins) {
        if (eh < 12) {
          const repairedH = String(eh + 12).padStart(2, "0");
          entry.end = `${repairedH}:${String(em).padStart(2, "0")}`;
          warnings.push(
            `Auto-corrected ${day} ${type}: end time shifted to PM (${entry.end}).`
          );
        } else {
          warnings.push(
            `Flagged ${day} ${type}: closing time (${entry.end}) occurs before opening (${entry.start}).`
          );
        }
      }
    }
  };

  for (const day of DAY_NAMES) {
    const k = day.toLowerCase();
    if (result.operatingHours?.[k]) {
      sanitizeEntry(result.operatingHours[k], day, "Operating Hours");
    }
    if (result.appointmentHours?.[k]) {
      sanitizeEntry(result.appointmentHours[k], day, "Appointment Hours");
    }
  }

  result.validationWarnings = Array.from(new Set(warnings));
  return result;
}

// ============================================================================
// 4. LOCAL PARSER FALLBACK (FULL 5-LAYER INTEGRATION)
// ============================================================================

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

    // Operating hours parse with "same as above" context carry-forward
    let opParsed: ParsedTimeResult;
    if (/(same|as above|ditto|^"$|^”$)/i.test(opRaw) && lastOpParsed) {
      opParsed = { ...lastOpParsed, originalInput: opRaw };
    } else {
      opParsed = parseOperatingHoursCore(opRaw);
      if (!opParsed.isClosed && opParsed.parsedValue.length === 2) {
        lastOpParsed = opParsed;
      }
    }

    // Appointment hours parse with bidirectional inheritance
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
      notes: isApptSame
        ? "Inherited from Operating Hours"
        : apptParsed.needsReview
        ? "Flagged for review"
        : apptParsed.isClosed
        ? "Closed"
        : "Parsed locally",
    };
  }

  // Pass 2: Two-way lookahead recovery across blank days
  for (let i = 0; i < DAY_NAMES.length; i++) {
    const dLower = DAY_NAMES[i].toLowerCase();
    const row = operatingHours[dLower];

    if (!row.blocked && !row.start && !row.end) {
      const nextDay = i < 6 ? operatingHours[DAY_NAMES[i + 1].toLowerCase()] : null;
      if (nextDay && !nextDay.blocked && nextDay.start) {
        row.start = nextDay.start;
        row.end = nextDay.end;
        row.notes = `Recovered from ${DAY_NAMES[i + 1]}`;
      } else {
        const prevDay = i > 0 ? operatingHours[DAY_NAMES[i - 1].toLowerCase()] : null;
        if (prevDay && !prevDay.blocked && prevDay.start) {
          row.start = prevDay.start;
          row.end = prevDay.end;
          row.notes = `Recovered from ${DAY_NAMES[i - 1]}`;
        }
      }
    }
  }

  const result = postFlightValidateAndRepair({
    operatingHours,
    appointmentHours,
    validationWarnings: [],
  });

  cacheUnifiedSchedule(result);
  return result;
}

// ============================================================================
// 5. STREAM EXTRACTION (TGPT)
// ============================================================================

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
      content: MASTER_SCHEDULE_PROMPT + cleanedInput,
      attachments: [],
      thinking: false,
      web_search_enabled: false,
      code_execution_enabled: false,
      artifacts_enabled: false,
    }),
  });

  if (!streamRes.ok || !streamRes.body) {
    throw new Error("Stream failed");
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
        } catch {
          // ignore split chunks
        }
      }
    }
  }

  const jsonMatch = assistantContent.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI did not return a valid JSON object.");
  }

  const rawParsed = JSON.parse(jsonMatch[0]) as UnifiedScheduleResponse;
  const hardenedResult = postFlightValidateAndRepair(rawParsed);

  cacheUnifiedSchedule(hardenedResult);
  return hardenedResult;
}

// ============================================================================
// 6. BLUEPRINT EXTRACTION & UTILITIES
// ============================================================================

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
  } catch {
    // Ignore storage limits
  }
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