import React, { useEffect, useMemo, useState } from "react";
import { DAY_OPTIONS } from "../constants";
import type { DayState, OperationKey, ShopRecord, UiMessage } from "../types";
import { formatTime } from "../utils";
import { useServiceBlueprint } from "../../../../Context/Blueprint_Service_Context";
import {
  TGPT_TOKEN_KEY,
  SCHEDULE_SYNC_EVENT,
  extractAllBlueprintScheduleNotes,
  streamScheduleExtraction,
  parseScheduleLocally,
  getCachedUnifiedSchedule,
  matchDaySchedule,
  UnifiedScheduleResponse,
} from "../services/tgptScheduleService";

type Props = {
  operation: OperationKey | "";
  loading: boolean;
  running: boolean;
  message: UiMessage | null;
  shops: ShopRecord[];
  shopSchedule: DayState;
  setShopSchedule: React.Dispatch<React.SetStateAction<DayState>>;
  onLoad: () => void;
  onExecute: () => void;
};

type InputMode = "ai" | "manual";

type ParsedSchedulePreviewItem = {
  source: string;
  blocked: boolean;
  start: string;
  end: string;
  rawValue: string;
  notes: string;
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

function buildEmptyPreview(schedule: DayState): Record<string, ParsedSchedulePreviewItem> {
  const out: Record<string, ParsedSchedulePreviewItem> = {};
  for (const day of DAY_OPTIONS) {
    const row = schedule[day.key];
    out[day.key] = {
      source: "Manual",
      blocked: Boolean(row?.blocked),
      start: row?.start || "",
      end: row?.end || "",
      rawValue: "",
      notes: "",
    };
  }
  return out;
}

const ShopsSection: React.FC<Props> = ({
  operation,
  loading,
  running,
  message,
  shops,
  shopSchedule,
  setShopSchedule,
  onLoad,
  onExecute,
}) => {
  const { getAnswer, hasBlueprint } = useServiceBlueprint();

  const [inputMode, setInputMode] = useState<InputMode>("ai");
  const [autoSelectEnabled, setAutoSelectEnabled] = useState(false);
  const [rawScheduleInput, setRawScheduleInput] = useState("");
  const [parsedPreview, setParsedPreview] = useState<Record<string, ParsedSchedulePreviewItem>>(
    buildEmptyPreview(shopSchedule)
  );
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);

  const [token, setToken] = useState<string>("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [localMessage, setLocalMessage] = useState<UiMessage | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(TGPT_TOKEN_KEY);
    if (saved) setToken(saved);
  }, []);

  const applyOperatingHours = (data: UnifiedScheduleResponse) => {
    const newPreview = buildEmptyPreview(shopSchedule);
    for (const day of DAY_OPTIONS) {
      const item = matchDaySchedule(data.operatingHours, day.key, day.label);
      if (item) {
        newPreview[day.key] = {
          source: item.source || "Operating Hours",
          blocked: Boolean(item.blocked),
          start: item.start || "",
          end: item.end || "",
          rawValue: item.raw || "",
          notes: item.notes || "",
        };
      }
    }
    setParsedPreview(newPreview);
    setValidationWarnings(data.validationWarnings || []);
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
    patch: { blocked?: boolean; start?: string; end?: string }
  ) => {
    setShopSchedule((prev) => {
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

  const handleAIParse = async () => {
    if (!rawScheduleInput.trim() || !token) {
      if (!token) {
        setLocalMessage({
          ok: false,
          text: "TGPT token missing. Please paste token in Coupons View or localStorage.",
        });
      }
      return;
    }

    setIsAiLoading(true);
    setLoadingText("Initializing TGPT...");
    setLocalMessage(null);

    try {
      const data = await streamScheduleExtraction(token, rawScheduleInput, (status) =>
        setLoadingText(status)
      );
      applyOperatingHours(data);
      setLocalMessage({
        ok: true,
        text: "Operating hours extracted and cross-validated with appointment hours.",
      });
    } catch (err: any) {
      setLocalMessage({
        ok: false,
        text: `AI Error: ${err.message}`,
      });
    } finally {
      setIsAiLoading(false);
      setLoadingText("");
    }
  };

  const handleManualLocalParse = () => {
    if (!rawScheduleInput.trim()) return;
    setLocalMessage(null);

    try {
      const data = parseScheduleLocally(rawScheduleInput);
      applyOperatingHours(data);
      setLocalMessage({
        ok: true,
        text: "Parsed locally via 5-layer rule engine (Offline).",
      });
    } catch (err: any) {
      setLocalMessage({
        ok: false,
        text: `Local Parse Error: ${err.message}`,
      });
    }
  };

  const handleApplyPreviewToSchedule = () => {
    setShopSchedule((prev) => {
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

  if (operation !== "get" && operation !== "configure") return null;

  return (
    <>
      <div style={{ ...cardStyle, display: "grid", gap: 12 }}>
        <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>Shops</div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn-secondary btn-sm" onClick={onLoad} disabled={loading}>
            {loading ? "Loading..." : "▶ Load"}
          </button>

          {operation === "configure" ? (
            <button className="btn-primary" onClick={onExecute} disabled={running}>
              {running ? "Running..." : "⚙ Configure Main Shop"}
            </button>
          ) : null}
        </div>

        {(message || localMessage) && (
          <div
            style={{
              borderRadius: 12,
              padding: "10px 12px",
              fontSize: 13,
              color: (localMessage || message)!.ok ? "#bbf7d0" : "#fecaca",
              background: (localMessage || message)!.ok
                ? "rgba(34,197,94,0.10)"
                : "rgba(239,68,68,0.10)",
              border: (localMessage || message)!.ok
                ? "1px solid rgba(34,197,94,0.22)"
                : "1px solid rgba(239,68,68,0.22)",
            }}
          >
            {(localMessage || message)!.text}
          </div>
        )}
      </div>

      {operation === "get" && shops.length > 0 ? (
        <div style={{ display: "grid", gap: 12 }}>
          {shops.map((shop, index) => (
            <div
              key={`${shop.id || shop.name || "shop"}-${index}`}
              style={{ ...cardStyle, display: "grid", gap: 12 }}
            >
              <div>
                <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800 }}>
                  {shop.name || "Unnamed Shop"}
                </div>
                <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>
                  ID: {shop.id || "—"} · Status: {shop.status || "—"} · Default:{" "}
                  {shop.defaultShop ? "Yes" : "No"}
                </div>
              </div>

              <div>
                <div style={{ color: "#cbd5e1", fontWeight: 700, marginBottom: 8 }}>Hours</div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 8,
                  }}
                >
                  {(shop.hours ?? []).length > 0 ? (
                    (shop.hours ?? []).map((hour, idx) => (
                      <div
                        key={`${shop.id}-hour-${idx}`}
                        style={{
                          borderRadius: 10,
                          padding: "10px 12px",
                          background: "rgba(255,255,255,0.02)",
                          border: "1px solid rgba(255,255,255,0.05)",
                        }}
                      >
                        <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>
                          {hour.day || "—"}
                        </div>
                        <div style={{ color: "#f8fafc", fontSize: 13 }}>
                          {hour.blocked
                            ? "Closed"
                            : `${formatTime(hour.startTime)} - ${formatTime(hour.endTime)}`}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "#94a3b8", fontSize: 13 }}>No hours configured</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {operation === "configure" ? (
        <>
          <div style={{ ...cardStyle, display: "grid", gap: 14 }}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
              Configure Main Shop
            </div>

            <div style={{ color: "#94a3b8", fontSize: 13 }}>
              Build Main Shop working hours. Operating Hours are the source of truth for the shop.
            </div>

            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
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
                Option 1: AI (TGPT)
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
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <div style={{ color: "#f8fafc", fontSize: 14, fontWeight: 700 }}>
                    AI Raw Shop Hours Input
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

                <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }}>
                  This box contains the full schedule block. If Operating Hours says <code>same</code>,
                  TGPT backfills from Appointment Hours. Lunch intervals (e.g. <code>12-1 lunch</code>)
                  are collapsed to the continuous shift window.
                </div>

                <textarea
                  value={rawScheduleInput}
                  onChange={(e) => setRawScheduleInput(e.target.value)}
                  placeholder="Paste raw shop operating hours notes here or load from blueprint..."
                  rows={14}
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
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 12,
                    lineHeight: 1.5,
                    opacity: isAiLoading ? 0.6 : 1,
                  }}
                />

                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={handleAIParse}
                    disabled={isAiLoading || !rawScheduleInput.trim()}
                    style={{
                      padding: "10px 24px",
                      background: isAiLoading ? "#60a5fa" : "#3b82f6",
                      border: "none",
                      borderRadius: "6px",
                      color: "#fff",
                      fontWeight: 600,
                      cursor: isAiLoading || !rawScheduleInput.trim() ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontSize: "13px",
                    }}
                  >
                    {isAiLoading ? `⏳ ${loadingText}` : "✨ Parse with AI (Auto)"}
                  </button>

                  <button
                    type="button"
                    onClick={handleManualLocalParse}
                    disabled={isAiLoading || !rawScheduleInput.trim()}
                    style={{
                      padding: "10px 24px",
                      background: "transparent",
                      border: "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "6px",
                      color: "#cbd5e1",
                      fontWeight: 600,
                      cursor: isAiLoading || !rawScheduleInput.trim() ? "not-allowed" : "pointer",
                      fontSize: "13px",
                    }}
                  >
                    ⚡ Parse Local (Offline)
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
                Manual mode selected. Directly adjust shop hours below.
              </div>
            )}

            {validationWarnings.length > 0 && (
              <div
                style={{
                  borderRadius: 10,
                  background: "rgba(234, 179, 8, 0.1)",
                  border: "1px solid rgba(234, 179, 8, 0.3)",
                  padding: "10px 14px",
                  color: "#fef08a",
                  fontSize: 13,
                  display: "grid",
                  gap: 4,
                }}
              >
                <div style={{ fontWeight: 700 }}>⚠️ Cross-Validation Alerts:</div>
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {validationWarnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
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
                Auto Select (Apply changes across all days)
              </label>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              {DAY_OPTIONS.map((day) => {
                const row = shopSchedule[day.key];
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

          <div style={{ ...cardStyle, display: "grid", gap: 12 }}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
              Parsed Shop Schedule Preview
            </div>

            <div style={{ color: "#94a3b8", fontSize: 13 }}>
              Main Shop operating hours parsed with awareness of lunch breaks and appointment windows.
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                    <th style={{ textAlign: "left", padding: "10px 8px", color: "#94a3b8" }}>Day</th>
                    <th style={{ textAlign: "left", padding: "10px 8px", color: "#94a3b8" }}>Source</th>
                    <th style={{ textAlign: "left", padding: "10px 8px", color: "#94a3b8" }}>Blocked</th>
                    <th style={{ textAlign: "left", padding: "10px 8px", color: "#94a3b8" }}>Start</th>
                    <th style={{ textAlign: "left", padding: "10px 8px", color: "#94a3b8" }}>End</th>
                    <th style={{ textAlign: "left", padding: "10px 8px", color: "#94a3b8" }}>Raw Input</th>
                    <th style={{ textAlign: "left", padding: "10px 8px", color: "#94a3b8" }}>Notes</th>
                  </tr>
                </thead>

                <tbody>
                  {previewRows.map(({ key, label, preview }) => (
                    <tr key={key} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "10px 8px", color: "#f8fafc", fontWeight: 700 }}>
                        {label}
                      </td>
                      <td style={{ padding: "10px 8px", color: "#cbd5e1" }}>
                        {preview?.source || "—"}
                      </td>
                      <td style={{ padding: "10px 8px", color: "#cbd5e1" }}>
                        {preview?.blocked ? "Yes" : "No"}
                      </td>
                      <td style={{ padding: "10px 8px", color: "#86efac", fontWeight: 600 }}>
                        {preview?.start || "—"}
                      </td>
                      <td style={{ padding: "10px 8px", color: "#86efac", fontWeight: 600 }}>
                        {preview?.end || "—"}
                      </td>
                      <td
                        style={{
                          padding: "10px 8px",
                          color: "#94a3b8",
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                        }}
                      >
                        {preview?.rawValue || "—"}
                      </td>
                      <td style={{ padding: "10px 8px", color: "#fde047" }}>
                        {preview?.notes || "—"}
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

export default ShopsSection;