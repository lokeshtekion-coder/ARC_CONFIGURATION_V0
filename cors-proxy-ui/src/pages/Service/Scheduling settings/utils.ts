import type { KeyValuePair } from "../../../types/proxy.types";
import { DAY_OPTIONS } from "./constants";
import type { DayState } from "./types";

export function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

export function toEnabledHeaderMap(headers: KeyValuePair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of headers) {
    if (!row?.enabled) continue;
    const key = normalize(row.key);
    const value = normalize(row.value);
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

export function extractDealerIdFromHeaders(headers: Record<string, string>): string {
  const candidates = ["dealerid", "dealerId", "dealer-id", "x-dealer-id"];
  const entries = Object.entries(headers);

  for (const candidate of candidates) {
    const hit = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
    if (hit?.[1]) return normalize(hit[1]);
  }

  return "";
}

export function buildDefaultDayState(): DayState {
  return DAY_OPTIONS.reduce((acc, day) => {
    acc[day.key] = {
      start: "09:00",
      end: "17:00",
      blocked: day.defaultBlocked,
    };
    return acc;
  }, {} as DayState);
}

export function buildScheduleFromDayState(days: DayState): Array<{
  day: string;
  startTime: { timeInHours: number; timeInMinutes: number } | null;
  endTime: { timeInHours: number; timeInMinutes: number } | null;
  blocked: boolean;
}> {
  return DAY_OPTIONS.map((day) => {
    const row = days[day.key];

    if (row.blocked || !row.start || !row.end) {
      return {
        day: day.code,
        startTime: null,
        endTime: null,
        blocked: true,
      };
    }

    const [startHour, startMinute] = row.start.split(":").map(Number);
    const [endHour, endMinute] = row.end.split(":").map(Number);

    return {
      day: day.code,
      startTime: {
        timeInHours: startHour,
        timeInMinutes: startMinute,
      },
      endTime: {
        timeInHours: endHour,
        timeInMinutes: endMinute,
      },
      blocked: false,
    };
  });
}

export function formatTime(
  timeObj?: { timeInHours?: number; timeInMinutes?: number } | null
): string {
  if (!timeObj || timeObj.timeInHours === undefined) return "N/A";

  const hours = timeObj.timeInHours;
  const minutes = timeObj.timeInMinutes ?? 0;
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;

  return `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;
}

export function renderBoolToneStyles(ok: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: 999,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 700,
    border: ok
      ? "1px solid rgba(34,197,94,0.28)"
      : "1px solid rgba(239,68,68,0.28)",
    background: ok
      ? "rgba(34,197,94,0.10)"
      : "rgba(239,68,68,0.10)",
    color: ok ? "#86efac" : "#fca5a5",
  };
}
