import React from "react";
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

      {operation === "post" ? (
        <div style={{ ...cardStyle, display: "grid", gap: 14 }}>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
            Auto Configure Service Advisors
          </div>
          <div style={{ color: "#94a3b8", fontSize: 13 }}>
            Configure a default weekly schedule for all active Service Advisors.
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
                        setAdvisorSchedule((prev) => ({
                          ...prev,
                          [day.key]: {
                            ...prev[day.key],
                            blocked: e.target.checked,
                            start: e.target.checked ? "" : prev[day.key].start || "09:00",
                            end: e.target.checked ? "" : prev[day.key].end || "17:00",
                          },
                        }))
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
                      setAdvisorSchedule((prev) => ({
                        ...prev,
                        [day.key]: { ...prev[day.key], start: e.target.value },
                      }))
                    }
                  />

                  <input
                    type="time"
                    value={row.end}
                    disabled={row.blocked}
                    style={inputStyle}
                    onChange={(e) =>
                      setAdvisorSchedule((prev) => ({
                        ...prev,
                        [day.key]: { ...prev[day.key], end: e.target.value },
                      }))
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
};

export default ServiceAdvisorsSection;
