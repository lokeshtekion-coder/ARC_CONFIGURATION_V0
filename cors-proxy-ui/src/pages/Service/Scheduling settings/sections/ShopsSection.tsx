import React from "react";
import { DAY_OPTIONS } from "../constants";
import type { DayState, OperationKey, ShopRecord, UiMessage } from "../types";
import { formatTime } from "../utils";

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
  if (operation !== "get" && operation !== "configure") return null;

  return (
    <>
      <div style={{ ...cardStyle, display: "grid", gap: 12 }}>
        <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
          Shops
        </div>

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

      {operation === "get" && shops.length > 0 ? (
        <div style={{ display: "grid", gap: 12 }}>
          {shops.map((shop, index) => (
            <div
              key={`${shop.id || shop.name || "shop"}-${index}`}
              style={{
                ...cardStyle,
                display: "grid",
                gap: 12,
              }}
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
                <div style={{ color: "#cbd5e1", fontWeight: 700, marginBottom: 8 }}>
                  Hours
                </div>
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

              <details>
                <summary
                  style={{
                    cursor: "pointer",
                    color: "#93c5fd",
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  Show Raw JSON
                </summary>
                <pre
                  style={{
                    marginTop: 10,
                    padding: 12,
                    borderRadius: 12,
                    background: "#0f172a",
                    color: "#e2e8f0",
                    overflow: "auto",
                    fontSize: 12,
                  }}
                >
                  {JSON.stringify(shop, null, 2)}
                </pre>
              </details>
            </div>
          ))}
        </div>
      ) : null}

      {operation === "configure" ? (
        <div style={{ ...cardStyle, display: "grid", gap: 14 }}>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
            Configure Main Shop
          </div>

          <div style={{ color: "#94a3b8", fontSize: 13 }}>
            Build Main Shop working hours and assign active Service Advisors automatically.
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
                        setShopSchedule((prev) => ({
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
                      setShopSchedule((prev) => ({
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
                      setShopSchedule((prev) => ({
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

export default ShopsSection;
