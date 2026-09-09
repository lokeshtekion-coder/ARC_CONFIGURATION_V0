import React, { useEffect, useMemo, useState } from "react";
import { DAY_OPTIONS } from "../constants";
import type { DayState, OperationKey, UiMessage } from "../types";

type Props = {
  operation: OperationKey | "";
  loading: boolean;
  running: boolean;
  message: UiMessage | null;
  serviceAdvisorsRaw: unknown;
  advisorSchedule: DayState;
  setAdvisorSchedule: React.Dispatch<React.SetStateAction<DayState>>;
  onLoad: () => void;
  onExecute: () => void;
};

type InputMode = "ai" | "manual";
type PreviewSource = "appointment_hours" | "operating_hours" | "manual" | "unknown";

type ParsedSchedulePreviewItem = {
  source: PreviewSource;
  blocked: boolean;
  start: string;
  end: string;
  rawValue: string;
  rawSegments: string[];
  notes: string[];
};

const cardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  padding: 16,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  color: "#f8fafc",
  outline: "none",
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isBlockedText(value: string): boolean {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return true;

  const compact = normalized.replace(/\s+/g, " ");
  return [
    "na",
    "n/a",
    "closed",
    "close",
    "blocked",
    "not available",
    "not applicable",
    "off",
    "holiday",
    "none",
    "-",
    "--",
  ].includes(compact);
}

function formatTwoDigits(n: number): string {
  return String(n).padStart(2, "0");
}

function to24HourFromHourMinute(hour: number, minute: number, meridiem?: "am" | "pm"): string {
  let h = hour;

  if (meridiem === "am") {
    if (h === 12) h = 0;
  } else if (meridiem === "pm") {
    if (h < 12) h += 12;
  }

  if (h < 0 || h > 23 || minute < 0 || minute > 59) {
    return "";
  }

  return `${formatTwoDigits(h)}:${formatTwoDigits(minute)}`;
}

function parseTimeToken(raw: string): string {
  const original = normalizeText(raw).toLowerCase();
  if (!original) return "";

  const cleaned = original
    .replace(/\./g, "")
    .replace(/\s+/g, "")
    .replace("a.m", "am")
    .replace("p.m", "pm");

  const meridiemMatch = cleaned.match(/(am|pm)$/);
  const meridiem = meridiemMatch?.[1] as "am" | "pm" | undefined;
  const core = cleaned.replace(/(am|pm)$/, "");

  if (!core) return "";

  if (core.includes(":")) {
    const [hStr, mStr = "0"] = core.split(":");
    const hour = Number(hStr);
    const minute = Number(mStr);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return "";
    return to24HourFromHourMinute(hour, minute, meridiem);
  }

  const digits = core.replace(/\D/g, "");
  if (!digits) return "";

  if (digits.length <= 2) {
    const hour = Number(digits);
    if (Number.isNaN(hour)) return "";
    return to24HourFromHourMinute(hour, 0, meridiem);
  }

  if (digits.length === 3) {
    const hour = Number(digits.slice(0, 1));
    const minute = Number(digits.slice(1, 3));
    if (Number.isNaN(hour) || Number.isNaN(minute)) return "";
    return to24HourFromHourMinute(hour, minute, meridiem);
  }

  if (digits.length === 4) {
    const hour = Number(digits.slice(0, 2));
    const minute = Number(digits.slice(2, 4));
    if (Number.isNaN(hour) || Number.isNaN(minute)) return "";
    return to24HourFromHourMinute(hour, minute, meridiem);
  }

  return "";
}

function extractTimeRanges(raw: string): Array<{ start: string; end: string; raw: string }> {
  const text = normalizeText(raw);
  if (!text || isBlockedText(text)) return [];

  const normalized = text
    .replace(/[–—]/g, "-")
    .replace(/\bto\b/gi, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s*\/\s*/g, "/")
    .trim();

  const segments = normalized
    .split(/[;,/]+/)
    .map((segment) => normalizeText(segment))
    .filter(Boolean);

  const out: Array<{ start: string; end: string; raw: string }> = [];

  for (const segment of segments) {
    const pair = segment.split("-");
    if (pair.length !== 2) continue;

    const leftRaw = normalizeText(pair[0]);
    const rightRaw = normalizeText(pair[1]);

    const start = parseTimeToken(leftRaw);
    const end = parseTimeToken(rightRaw);

    if (start && end) {
      out.push({
        start,
        end,
        raw: segment,
      });
    }
  }

  return out;
}

function parseRawHoursValue(raw: string): {
  blocked: boolean;
  start: string;
  end: string;
  rawSegments: string[];
  notes: string[];
} {
  const notes: string[] = [];
  const text = normalizeText(raw);

  if (!text || isBlockedText(text)) {
    return {
      blocked: true,
      start: "",
      end: "",
      rawSegments: text ? [text] : [],
      notes: text ? ['Detected closed/blocked value'] : ["No usable value found"],
    };
  }

  const ranges = extractTimeRanges(text);

  if (ranges.length === 0) {
    return {
      blocked: false,
      start: "",
      end: "",
      rawSegments: text ? [text] : [],
      notes: ["Could not safely parse time range"],
    };
  }

  if (ranges.length > 1) {
    notes.push(
      "Multiple time windows detected; using earliest start and latest end for advisor schedule preview"
    );
  }

  const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
  const start = sorted[0].start;
  const end = [...sorted].sort((a, b) => b.end.localeCompare(a.end))[0].end;

  return {
    blocked: false,
    start,
    end,
    rawSegments: ranges.map((item) => item.raw),
    notes,
  };
}

function buildEmptyPreviewFromSchedule(
  schedule: DayState
): Record<string, ParsedSchedulePreviewItem> {
  const out: Record<string, ParsedSchedulePreviewItem> = {};

  for (const day of DAY_OPTIONS) {
    const row = schedule[day.key];
    out[day.key] = {
      source: "unknown",
      blocked: Boolean(row?.blocked),
      start: row?.start || "",
      end: row?.end || "",
      rawValue: "",
      rawSegments: [],
      notes: [],
    };
  }

  return out;
}

function extractSectionValue(
  text: string,
  dayLabel: string,
  labelText: string
): string {
  const escapedDay = escapeRegex(dayLabel);
  const escapedLabel = escapeRegex(labelText);

  const regex = new RegExp(
    `${escapedDay}\\s*\\(${escapedLabel}\\)\\s*:\\s*([\\s\\S]*?)(?=\\n(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\\s*\\((?:Operating Hours|Appointment Hours - can be same as operating hours)\\)\\s*:|$)`,
    "i"
  );

  return normalizeText(text.match(regex)?.[1]);
}

function parseRawScheduleText(
  rawInput: string,
  schedule: DayState
): Record<string, ParsedSchedulePreviewItem> {
  const text = rawInput.replace(/\r/g, "");
  const preview = buildEmptyPreviewFromSchedule(schedule);

  for (const day of DAY_OPTIONS) {
    const appointmentRaw = extractSectionValue(
      text,
      day.label,
      "Appointment Hours - can be same as operating hours"
    );

    const operatingRaw = extractSectionValue(text, day.label, "Operating Hours");

    if (appointmentRaw) {
      const parsed = parseRawHoursValue(appointmentRaw);
      preview[day.key] = {
        source: "appointment_hours",
        blocked: parsed.blocked,
        start: parsed.start,
        end: parsed.end,
        rawValue: appointmentRaw,
        rawSegments: parsed.rawSegments,
        notes: parsed.notes,
      };
      continue;
    }

    if (operatingRaw) {
      const parsed = parseRawHoursValue(operatingRaw);
      preview[day.key] = {
        source: "operating_hours",
        blocked: parsed.blocked,
        start: parsed.start,
        end: parsed.end,
        rawValue: operatingRaw,
        rawSegments: parsed.rawSegments,
        notes: parsed.notes,
      };
      continue;
    }

    preview[day.key] = {
      ...preview[day.key],
      source: "unknown",
      notes: ["No Appointment Hours or Operating Hours found"],
    };
  }

  return preview;
}

function getPreviewSourceLabel(source: PreviewSource): string {
  switch (source) {
    case "appointment_hours":
      return "Appointment Hours";
    case "operating_hours":
      return "Operating Hours";
    case "manual":
      return "Manual";
    default:
      return "—";
  }
}

const ServiceAdvisorsSection: React.FC<Props> = ({
  operation,
  loading,
  running,
  message,
  serviceAdvisorsRaw,
  advisorSchedule,
  setAdvisorSchedule,
  onLoad,
  onExecute,
}) => {
  const [inputMode, setInputMode] = useState<InputMode>("ai");
  const [autoSelectEnabled, setAutoSelectEnabled] = useState(false);
  const [rawScheduleInput, setRawScheduleInput] = useState("");
  const [parsedPreview, setParsedPreview] = useState<Record<string, ParsedSchedulePreviewItem>>(
    buildEmptyPreviewFromSchedule(advisorSchedule)
  );

  useEffect(() => {
    setParsedPreview((prev) => {
      const next = { ...prev };
      for (const day of DAY_OPTIONS) {
        if (!next[day.key]) {
          next[day.key] = {
            source: "unknown",
            blocked: Boolean(advisorSchedule[day.key]?.blocked),
            start: advisorSchedule[day.key]?.start || "",
            end: advisorSchedule[day.key]?.end || "",
            rawValue: "",
            rawSegments: [],
            notes: [],
          };
        }
      }
      return next;
    });
  }, [advisorSchedule]);

  const canShowConfigurator = operation === "post";

  const previewRows = useMemo(
    () =>
      DAY_OPTIONS.map((day) => ({
        key: day.key,
        label: day.label,
        preview: parsedPreview[day.key],
      })),
    [parsedPreview]
  );

  const updateScheduleRow = (
    dayKey: keyof DayState,
    patch: {
      blocked?: boolean;
      start?: string;
      end?: string;
    }
  ) => {
    setAdvisorSchedule((prev) => {
      const nextCurrentDay = {
        ...prev[dayKey],
        ...patch,
      };

      if (!autoSelectEnabled) {
        return {
          ...prev,
          [dayKey]: nextCurrentDay,
        };
      }

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

  const handlePreviewFromAiInput = () => {
    const nextPreview = parseRawScheduleText(rawScheduleInput, advisorSchedule);
    setParsedPreview(nextPreview);
  };

  const handleApplyPreviewToSchedule = () => {
    setAdvisorSchedule((prev) => {
      const next = { ...prev };

      for (const day of DAY_OPTIONS) {
        const preview = parsedPreview[day.key];
        if (!preview) continue;

        next[day.key] = {
          ...next[day.key],
          blocked: preview.blocked,
          start: preview.blocked ? "" : preview.start,
          end: preview.blocked ? "" : preview.end,
        };
      }

      return next;
    });
  };

  if (operation !== "get" && operation !== "post") return null;

  return (
    <>
      <div style={{ ...cardStyle, display: "grid", gap: 12 }}>
        <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
          Service Advisors
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn-secondary btn-sm" onClick={onLoad} disabled={loading}>
            {loading ? "Loading..." : "▶ Load"}
          </button>

          {operation === "post" ? (
            <button className="btn-primary" onClick={onExecute} disabled={running}>
              {running ? "Running..." : "⚙ Configure Schedules"}
            </button>
          ) : null}
        </div>

        {message ? (
          <div
            style={{
              borderRadius: 12,
              padding: "10px 12px",
              fontSize: 13,
              color: message.ok ? "#bbf7d0" : "#fecaca",
              background: message.ok
                ? "rgba(34,197,94,0.10)"
                : "rgba(239,68,68,0.10)",
              border: message.ok
                ? "1px solid rgba(34,197,94,0.22)"
                : "1px solid rgba(239,68,68,0.22)",
            }}
          >
            {message.text}
          </div>
        ) : null}
      </div>

      {operation === "get" && serviceAdvisorsRaw ? (
        <div style={cardStyle}>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }}>
            Service Advisors Response
          </div>
          <pre
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 12,
              background: "#0f172a",
              color: "#e2e8f0",
              overflow: "auto",
              fontSize: 12,
            }}
          >
            {JSON.stringify(serviceAdvisorsRaw, null, 2)}
          </pre>
        </div>
      ) : null}

      {canShowConfigurator ? (
        <>
          <div style={{ ...cardStyle, display: "grid", gap: 14 }}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
              Auto Configure Service Advisors
            </div>

            <div style={{ color: "#94a3b8", fontSize: 13 }}>
              Configure a default weekly schedule for all active Service Advisors.
            </div>

            <div
              style={{
                display: "flex",
                gap: 16,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  color: "#e2e8f0",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                <input
                  type="radio"
                  checked={inputMode === "ai"}
                  onChange={() => setInputMode("ai")}
                />
                Option 1: AI
              </label>

              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  color: "#e2e8f0",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
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
                <div style={{ color: "#f8fafc", fontSize: 14, fontWeight: 700 }}>
                  AI Raw Schedule Input
                </div>

                <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>
                  Paste dealership raw schedule notes. We prefer{" "}
                  <span style={{ color: "#e2e8f0", fontWeight: 700 }}>
                    Appointment Hours - can be same as operating hours
                  </span>{" "}
                  first, then fallback to{" "}
                  <span style={{ color: "#e2e8f0", fontWeight: 700 }}>
                    Operating Hours
                  </span>
                  . Multiple windows like <code>730-1000, 1300-1530</code> are supported and will
                  be merged into a full-day preview window like <code>07:30 - 15:30</code>.
                </div>

                <textarea
                  value={rawScheduleInput}
                  onChange={(e) => setRawScheduleInput(e.target.value)}
                  placeholder={`Paste raw scheduling notes here...

Example:
Monday (Operating Hours):
730-1730
Monday (Appointment Hours - can be same as operating hours):
730-1000, 1300-1530
Tuesday (Operating Hours):
7:30 AM - 5:30 PM
Tuesday (Appointment Hours - can be same as operating hours):
7:30-10:00, 13:00-15:30
Wednesday (Operating Hours):
730-1730
Wednesday (Appointment Hours - can be same as operating hours):
NA
Thursday (Operating Hours):
Closed
Friday (Operating Hours):
7-5
Saturday (Operating Hours):
N/A
Sunday (Operating Hours):
N/A`}
                  rows={14}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.03)",
                    color: "#f8fafc",
                    outline: "none",
                    resize: "vertical",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 12,
                    lineHeight: 1.5,
                  }}
                />

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={handlePreviewFromAiInput}
                    disabled={!rawScheduleInput.trim()}
                  >
                    Preview Parsed Schedule
                  </button>

                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={handleApplyPreviewToSchedule}
                  >
                    Apply Preview to Weekly Schedule
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.02)",
                  padding: 12,
                  color: "#94a3b8",
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                Manual option selected. You can directly fill the weekly schedule below. Later we
                can wire a richer manual bulk-input mode if needed.
              </div>
            )}

            <div
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.02)",
                padding: 12,
                display: "grid",
                gap: 8,
              }}
            >
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  color: "#e2e8f0",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                <input
                  type="checkbox"
                  checked={autoSelectEnabled}
                  onChange={(e) => setAutoSelectEnabled(e.target.checked)}
                />
                Auto Select
              </label>

              <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.5 }}>
                When checked, changing one day’s blocked/start/end values will automatically copy
                the same values to all days. If unchecked later, the copied values remain preserved.
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              {DAY_OPTIONS.map((day) => {
                const row = advisorSchedule[day.key];
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
                    <div style={{ color: "#f8fafc", fontWeight: 700 }}>{day.label}</div>

                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: "#cbd5e1",
                        fontSize: 13,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={row.blocked}
                        onChange={(e) =>
                          updateScheduleRow(day.key, {
                            blocked: e.target.checked,
                            start: e.target.checked ? "" : row.start || "09:00",
                            end: e.target.checked ? "" : row.end || "17:00",
                          })
                        }
                      />
                      Blocked
                    </label>

                    <input
                      type="time"
                      value={row.start}
                      disabled={row.blocked}
                      style={inputStyle}
                      onChange={(e) =>
                        updateScheduleRow(day.key, {
                          start: e.target.value,
                        })
                      }
                    />

                    <input
                      type="time"
                      value={row.end}
                      disabled={row.blocked}
                      style={inputStyle}
                      onChange={(e) =>
                        updateScheduleRow(day.key, {
                          end: e.target.value,
                        })
                      }
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ ...cardStyle, display: "grid", gap: 12 }}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
              Parsed Schedule Preview
            </div>

            <div style={{ color: "#94a3b8", fontSize: 13 }}>
              Appointment hours are preferred first. If multiple ranges are found, preview uses the
              earliest start and latest end.
            </div>

            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <th style={{ textAlign: "left", padding: "10px 8px", color: "#94a3b8" }}>
                      Day
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 8px", color: "#94a3b8" }}>
                      Source
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 8px", color: "#94a3b8" }}>
                      Blocked
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 8px", color: "#94a3b8" }}>
                      Start
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 8px", color: "#94a3b8" }}>
                      End
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 8px", color: "#94a3b8" }}>
                      Parsed Segments
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 8px", color: "#94a3b8" }}>
                      Notes
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {previewRows.map(({ key, label, preview }) => (
                    <tr key={key} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "10px 8px", color: "#f8fafc", fontWeight: 700 }}>
                        {label}
                      </td>
                      <td style={{ padding: "10px 8px", color: "#cbd5e1" }}>
                        {getPreviewSourceLabel(preview?.source ?? "unknown")}
                      </td>
                      <td style={{ padding: "10px 8px", color: "#cbd5e1" }}>
                        {preview?.blocked ? "Yes" : "No"}
                      </td>
                      <td style={{ padding: "10px 8px", color: "#cbd5e1" }}>
                        {preview?.start || "—"}
                      </td>
                      <td style={{ padding: "10px 8px", color: "#cbd5e1" }}>
                        {preview?.end || "—"}
                      </td>
                      <td
                        style={{
                          padding: "10px 8px",
                          color: "#94a3b8",
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {preview?.rawSegments?.length
                          ? preview.rawSegments.join(" | ")
                          : preview?.rawValue || "—"}
                      </td>
                      <td
                        style={{
                          padding: "10px 8px",
                          color: "#94a3b8",
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {preview?.notes?.length ? preview.notes.join(" • ") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
};

export default ServiceAdvisorsSection;
