// ============================================================================
// TYPES & CONSTANTS
// ============================================================================

export type DayOfWeek = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";
export const DAY_ORDER: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
export const ALL_DAYS = new Set(DAY_ORDER);

export interface ParsedTimeResult {
  originalInput: string;
  parsedValue: [string, string] | []; // [Open, Close] in 24h format, or [] for Closed
  confidence: number; // 0.0 to 1.0 (Automation safe threshold usually >= 0.85)
  isClosed: boolean;
  needsReview: boolean; // True if boundary logic failed or input was vague
}

export type WeeklySchedule = Record<DayOfWeek, ParsedTimeResult>;

// ============================================================================
// CORE ENGINE: THE 5-LAYER PIPELINE
// Extracts strict 24-hour time ranges from messy, conversational text
// ============================================================================

export function parseOperatingHours(rawInput: string): ParsedTimeResult {
  if (!rawInput || rawInput.trim() === "") return createClosed(rawInput);

  let processed = rawInput.toLowerCase().trim();

  // ---------------------------------------------------------
  // LAYER 1 & 2.5: Sanitization & Text-to-Digit Preprocessor
  // ---------------------------------------------------------

  // Strip conversational noise and translate semantic meanings
  const noiseMap: Record<string, string> = {
    "ish": "",
    "in the morning": "am",
    "in the evening": "pm",
    "at night": "pm",
    "afternoon": "pm",
    "noon": "12pm",
    "midnight": "12am",
    "half past ": "30 ",
    "half day": "till 12pm", // Converts "saturday half day" into a math-ready format
    "o'clock": ":00",
    "oclock": ":00"
  };
  for (const [word, rep] of Object.entries(noiseMap)) {
    processed = processed.replace(new RegExp(word, 'gi'), rep);
  }

  // Convert spelled-out numbers to digits
  const numberMap: Record<string, string> = {
    "twenty": "20", "thirty": "30", "forty": "40", "fifty": "50",
    "eleven": "11", "twelve": "12", "ten": "10", "fifteen": "15",
    "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9"
  };
  for (const [word, digit] of Object.entries(numberMap)) {
    processed = processed.replace(new RegExp(`\\b${word}\\b`, 'gi'), digit);
  }

  // Bridge separated hours and minutes (e.g. "7 30" -> "7:30")
  processed = processed.replace(/(\b\d{1,2})\s+(\d{2}\b)/g, "$1:$2");

  // ---------------------------------------------------------
  // LAYER 3: Synonym Dictionary
  // ---------------------------------------------------------
  if (/(closed|off|none|n\/a|na)/.test(processed)) return createClosed(rawInput);
  if (/(24\/7|24 hours|24 hrs)/.test(processed)) {
    return { originalInput: rawInput, parsedValue: ["00:00", "23:59"], confidence: 1.0, isClosed: false, needsReview: false };
  }

  // ---------------------------------------------------------
  // LAYER 4: Regex Extractors & Dealership Heuristics
  // ---------------------------------------------------------
  const timeRegex = /(?:^|[^0-9:])(\d{1,2}:\d{2}|\d{3,4}|\d{1,2})\s*([ap]m?|[ap]\b)?/gi;
  const extractedMinutes: number[] = [];
  let match;

  while ((match = timeRegex.exec(processed)) !== null) {
    const rawTime = match[1];
    const modifier = match[2];
    let hr = 0, min = 0;

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

    // Apply AM/PM logic or standard dealership opening/closing bounds
    if (modifier) {
      if (modifier.startsWith("p") && hr < 12) hr += 12;
      if (modifier.startsWith("a") && hr === 12) hr = 0;
    } else {
      if (extractedMinutes.length === 0 && hr < 5) hr += 12; // Opening hour heuristic
      if (extractedMinutes.length > 0 && hr >= 1 && hr <= 11) hr += 12; // Closing hour heuristic
    }

    extractedMinutes.push(hr * 60 + min);
  }

  // ---------------------------------------------------------
  // LAYER 5: Fallbacks, Splitting, and Relative Time Handling
  // ---------------------------------------------------------
  if (extractedMinutes.length === 0) {
    return createReviewFlagged(rawInput, 0); // No numbers found
  }

  // Single time extracted (Handles "till 5", "after 9", or vague "whenever")
  if (extractedMinutes.length === 1) {
    const timeStr = formatTime(extractedMinutes[0]);

    if (/(whenever|flexible|depends)/.test(processed)) {
      return createReviewFlagged(rawInput, 0.2); // Too vague for automation
    }
    if (/(till|until|to|by)\s*\d/.test(processed)) {
      return { originalInput: rawInput, parsedValue: ["08:00", timeStr], confidence: 0.8, isClosed: false, needsReview: false };
    }
    if (/(after|from|onwards)\s*\d/.test(processed)) {
      return { originalInput: rawInput, parsedValue: [timeStr, "17:00"], confidence: 0.8, isClosed: false, needsReview: false };
    }

    return createReviewFlagged(rawInput, 0.3); // Lone number without context
  }

  // Handle multiple times (Min/Max swallows lunch breaks and staggered shifts perfectly)
  const openMin = Math.min(...extractedMinutes);
  const closeMin = Math.max(...extractedMinutes);

  // Safety net: Dealerships don't do overnight shifts normally. If closing is before opening, flag it.
  if (closeMin < openMin) {
    return { originalInput: rawInput, parsedValue: [formatTime(openMin), formatTime(closeMin)], confidence: 0.4, isClosed: false, needsReview: true };
  }

  // Reduce confidence slightly if we had to guess AM/PM based on vague words
  const baseConf = processed.includes("maybe") || processed.includes("approx") ? 0.75 : 0.95;
  const finalConf = processed.includes("a") || processed.includes("p") ? 1.0 : baseConf;

  return {
    originalInput: rawInput,
    parsedValue: [formatTime(openMin), formatTime(closeMin)],
    confidence: finalConf,
    isClosed: false,
    needsReview: false
  };
}

// ============================================================================
// SINGLE-BOX ROUTER: Parses an entire week from one massive text block
// ============================================================================

export function parseAdvancedWeekSchedule(rawInput: string): WeeklySchedule {
  const schedule: WeeklySchedule = {
    MON: createClosed(), TUE: createClosed(), WED: createClosed(),
    THU: createClosed(), FRI: createClosed(), SAT: createClosed(), SUN: createClosed()
  };
  if (!rawInput) return schedule;

  // Split on commas, semicolons, line breaks, AND words like "and", "then"
  const chunks = rawInput.toLowerCase().split(/[,;\n|]|\b(?:and|then)\b/gi);

  let lastParsedTime: ParsedTimeResult | null = null; // Enables "same as above" cross-chunk tracking

  for (let chunk of chunks) {
    chunk = chunk.trim();
    if (!chunk) continue;

    let targetDays = new Set<DayOfWeek>();

    // Evaluate Compound Exceptions ("Mon-Fri except Wed")
    if (chunk.includes("except") || chunk.includes("but")) {
      const parts = chunk.split(/except|but/);
      targetDays = extractDays(parts[0]);
      const excludedDays = extractDays(parts[1]);
      for (const ex of excludedDays) targetDays.delete(ex);
    } else {
      targetDays = extractDays(chunk);
    }

    let timeResult: ParsedTimeResult;

    // Check for "same" carrying over from a previous chunk
    if (/(same|as above|ditto|rest)/.test(chunk) && lastParsedTime) {
      timeResult = { ...lastParsedTime, originalInput: chunk };
    } else {
      timeResult = parseOperatingHours(chunk);
    }

    // Save successful parses for future chunks
    if (timeResult.parsedValue.length === 2) lastParsedTime = timeResult;

    // Assign time block to the targets
    for (const day of targetDays) schedule[day] = timeResult;
  }

  return schedule;
}

// ============================================================================
// 7-BOX ORCHESTRATOR: Parses 7 distinct text fields, sharing context
// ============================================================================

export function parseAwareWeeklySchedule(
  rawInputs: Record<DayOfWeek, string>
): WeeklySchedule {

  const schedule: Partial<Record<DayOfWeek, ParsedTimeResult>> = {};
  let spannedWeekdayResult: ParsedTimeResult | null = null;

  // PASS 1: Sequential parsing with contextual carry-forward
  for (let i = 0; i < DAY_ORDER.length; i++) {
    const currentDay = DAY_ORDER[i];
    const rawVal = (rawInputs[currentDay] || "").toLowerCase().trim();

    // Context A: "Same as above"
    if (/(same|as above|ditto|^"$|^”$)/.test(rawVal)) {
      const previousDay = i > 0 ? DAY_ORDER[i - 1] : null;
      if (previousDay && schedule[previousDay]) {
        schedule[currentDay] = { ...schedule[previousDay]!, originalInput: rawVal };
        continue;
      }
    }

    // Context B: Inherit "M-F" span into blank boxes
    if (rawVal === "" && spannedWeekdayResult && ["TUE", "WED", "THU", "FRI"].includes(currentDay)) {
      schedule[currentDay] = { ...spannedWeekdayResult, originalInput: "(Inherited)" };
      continue;
    }

    const parsedResult = parseOperatingHours(rawVal);
    schedule[currentDay] = parsedResult;

    // Register an M-F span if declared explicitly in Monday
    if (currentDay === "MON" && /(m-f|monday.*friday|mon.*fri|weekdays)/.test(rawVal)) {
      spannedWeekdayResult = parsedResult;
    }
  }

  // PASS 2: Two-way lookahead for missing base times
  // Solves: Monday says "Mon-Fri except Friday", leaving Mon-Thu flagged as missing a time.
  for (let i = 0; i < DAY_ORDER.length; i++) {
    const currentDay = DAY_ORDER[i];
    const result = schedule[currentDay]!;

    if (result.needsReview && result.parsedValue.length === 0) {
      // Look at Next Day
      const nextDay = i < 6 ? schedule[DAY_ORDER[i + 1]] : null;
      if (nextDay && nextDay.parsedValue.length === 2 && !nextDay.needsReview) {
         schedule[currentDay] = { ...nextDay, originalInput: `(Recovered from ${DAY_ORDER[i + 1]})` };
         continue;
      }
      // Look at Previous Day
      const prevDay = i > 0 ? schedule[DAY_ORDER[i - 1]] : null;
      if (prevDay && prevDay.parsedValue.length === 2 && !prevDay.needsReview) {
         schedule[currentDay] = { ...prevDay, originalInput: `(Recovered from ${DAY_ORDER[i - 1]})` };
      }
    }
  }

  // Final Cleanup: Mark remaining absolute blanks as Closed
  for (const day of DAY_ORDER) {
    if (!schedule[day] || schedule[day]?.originalInput === "") {
      schedule[day] = createClosed(schedule[day]?.originalInput || "");
    }
  }

  return schedule as WeeklySchedule;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function extractDays(text: string): Set<DayOfWeek> {
  const days = new Set<DayOfWeek>();
  const t = text.toLowerCase();

  if (/(everyday|daily|7 days|all week|every day)/.test(t)) return new Set(ALL_DAYS);
  if (/(weekdays|m-f|monday.*friday|mon.*fri)/.test(t)) return new Set(["MON", "TUE", "WED", "THU", "FRI"]);
  if (/(weekend)/.test(t)) return new Set(["SAT", "SUN"]);

  if (/mon/.test(t)) days.add("MON");
  if (/tue/.test(t)) days.add("TUE");
  if (/wed/.test(t)) days.add("WED");
  if (/thu/.test(t)) days.add("THU");
  if (/fri/.test(t)) days.add("FRI");
  if (/sat/.test(t)) days.add("SAT");
  if (/sun/.test(t)) days.add("SUN");

  return days;
}

function formatTime(totalMins: number): string {
  const h = Math.floor(totalMins / 60).toString().padStart(2, "0");
  const m = (totalMins % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function createClosed(input: string = ""): ParsedTimeResult {
  return { originalInput: input, parsedValue: [], confidence: 1.0, isClosed: true, needsReview: false };
}

function createReviewFlagged(input: string, conf: number): ParsedTimeResult {
  return { originalInput: input, parsedValue: [], confidence: conf, isClosed: false, needsReview: true };
}