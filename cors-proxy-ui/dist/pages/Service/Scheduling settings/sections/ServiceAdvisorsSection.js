import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { DAY_OPTIONS } from "../constants";
import { useServiceBlueprint } from "../../../../Context/Blueprint_Service_Context";
import { TGPT_TOKEN_KEY, SCHEDULE_SYNC_EVENT, extractAllBlueprintScheduleNotes, streamScheduleExtraction, parseScheduleLocally, getCachedUnifiedSchedule, matchDaySchedule, } from "../services/tgptScheduleService";
const cardStyle = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    padding: 16,
};
const inputStyle = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.03)",
    color: "#f8fafc",
    outline: "none",
};
function buildEmptyPreview(schedule) {
    const out = {};
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
const ServiceAdvisorsSection = ({ operation, loading, running, message, serviceAdvisorsRaw, advisorSchedule, setAdvisorSchedule, onLoad, onExecute, }) => {
    const { getAnswer, hasBlueprint } = useServiceBlueprint();
    const [inputMode, setInputMode] = useState("ai");
    const [autoSelectEnabled, setAutoSelectEnabled] = useState(false);
    const [rawScheduleInput, setRawScheduleInput] = useState("");
    const [parsedPreview, setParsedPreview] = useState(buildEmptyPreview(advisorSchedule));
    const [validationWarnings, setValidationWarnings] = useState([]);
    const [token, setToken] = useState("");
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [loadingText, setLoadingText] = useState("");
    const [localMessage, setLocalMessage] = useState(null);
    useEffect(() => {
        const saved = localStorage.getItem(TGPT_TOKEN_KEY);
        if (saved)
            setToken(saved);
    }, []);
    const applyAppointmentHours = (data) => {
        const newPreview = buildEmptyPreview(advisorSchedule);
        for (const day of DAY_OPTIONS) {
            const item = matchDaySchedule(data.appointmentHours, day.key, day.label);
            if (item) {
                newPreview[day.key] = {
                    source: item.source || "Appointment Hours",
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
        if (cached)
            applyAppointmentHours(cached);
        const handleSync = (e) => {
            const customEvent = e;
            if (customEvent.detail)
                applyAppointmentHours(customEvent.detail);
        };
        window.addEventListener(SCHEDULE_SYNC_EVENT, handleSync);
        return () => window.removeEventListener(SCHEDULE_SYNC_EVENT, handleSync);
    }, []);
    useEffect(() => {
        if (hasBlueprint && getAnswer && !rawScheduleInput) {
            const rawText = extractAllBlueprintScheduleNotes(getAnswer);
            if (rawText.trim())
                setRawScheduleInput(rawText);
        }
    }, [hasBlueprint, getAnswer, rawScheduleInput]);
    const canShowConfigurator = operation === "post";
    const previewRows = useMemo(() => DAY_OPTIONS.map((day) => ({
        key: day.key,
        label: day.label,
        preview: parsedPreview[day.key],
    })), [parsedPreview]);
    const updateScheduleRow = (dayKey, patch) => {
        setAdvisorSchedule((prev) => {
            const nextCurrentDay = { ...prev[dayKey], ...patch };
            if (!autoSelectEnabled)
                return { ...prev, [dayKey]: nextCurrentDay };
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
            const data = await streamScheduleExtraction(token, rawScheduleInput, (status) => setLoadingText(status));
            applyAppointmentHours(data);
            setLocalMessage({
                ok: true,
                text: "Appointment hours extracted and cross-validated with Operating Hours.",
            });
        }
        catch (err) {
            setLocalMessage({
                ok: false,
                text: `AI Error: ${err.message}`,
            });
        }
        finally {
            setIsAiLoading(false);
            setLoadingText("");
        }
    };
    const handleManualLocalParse = () => {
        if (!rawScheduleInput.trim())
            return;
        setLocalMessage(null);
        try {
            const data = parseScheduleLocally(rawScheduleInput);
            applyAppointmentHours(data);
            setLocalMessage({
                ok: true,
                text: "Parsed locally via 5-layer rule engine (Offline).",
            });
        }
        catch (err) {
            setLocalMessage({
                ok: false,
                text: `Local Parse Error: ${err.message}`,
            });
        }
    };
    const handleApplyPreviewToSchedule = () => {
        setAdvisorSchedule((prev) => {
            const next = { ...prev };
            for (const day of DAY_OPTIONS) {
                const preview = parsedPreview[day.key];
                if (!preview)
                    continue;
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
    if (operation !== "get" && operation !== "post")
        return null;
    return (_jsxs(_Fragment, { children: [_jsxs("div", { style: { ...cardStyle, display: "grid", gap: 12 }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800 }, children: "Service Advisors" }), _jsxs("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-secondary btn-sm", onClick: onLoad, disabled: loading, children: loading ? "Loading..." : "▶ Load" }), operation === "post" ? (_jsx("button", { className: "btn-primary", onClick: onExecute, disabled: running, children: running ? "Running..." : "⚙ Configure Schedules" })) : null] }), (message || localMessage) && (_jsx("div", { style: {
                            borderRadius: 12,
                            padding: "10px 12px",
                            fontSize: 13,
                            color: (localMessage || message).ok ? "#bbf7d0" : "#fecaca",
                            background: (localMessage || message).ok
                                ? "rgba(34,197,94,0.10)"
                                : "rgba(239,68,68,0.10)",
                            border: (localMessage || message).ok
                                ? "1px solid rgba(34,197,94,0.22)"
                                : "1px solid rgba(239,68,68,0.22)",
                        }, children: (localMessage || message).text }))] }), operation === "get" && serviceAdvisorsRaw ? (_jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }, children: "Service Advisors Response" }), _jsx("pre", { style: {
                            margin: 0,
                            padding: 12,
                            borderRadius: 12,
                            background: "#0f172a",
                            color: "#e2e8f0",
                            overflow: "auto",
                            fontSize: 12,
                        }, children: JSON.stringify(serviceAdvisorsRaw, null, 2) })] })) : null, canShowConfigurator ? (_jsxs(_Fragment, { children: [_jsxs("div", { style: { ...cardStyle, display: "grid", gap: 14 }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800 }, children: "Auto Configure Service Advisors" }), _jsx("div", { style: { color: "#94a3b8", fontSize: 13 }, children: "Configure a default weekly appointment schedule for all active Service Advisors." }), _jsxs("div", { style: { display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }, children: [_jsxs("label", { style: {
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 8,
                                            color: "#e2e8f0",
                                            fontSize: 13,
                                            fontWeight: 700,
                                        }, children: [_jsx("input", { type: "radio", checked: inputMode === "ai", onChange: () => setInputMode("ai") }), "Option 1: AI (TGPT)"] }), _jsxs("label", { style: {
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 8,
                                            color: "#e2e8f0",
                                            fontSize: 13,
                                            fontWeight: 700,
                                        }, children: [_jsx("input", { type: "radio", checked: inputMode === "manual", onChange: () => setInputMode("manual") }), "Option 2: Manual"] })] }), inputMode === "ai" ? (_jsxs("div", { style: { display: "grid", gap: 10 }, children: [_jsxs("div", { style: {
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            flexWrap: "wrap",
                                            gap: 8,
                                        }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 14, fontWeight: 700 }, children: "AI Raw Schedule Input" }), getAnswer && (_jsx("button", { type: "button", onClick: () => {
                                                    const rawText = extractAllBlueprintScheduleNotes(getAnswer);
                                                    if (rawText.trim())
                                                        setRawScheduleInput(rawText);
                                                }, style: {
                                                    background: "rgba(34,197,94,0.12)",
                                                    border: "1px solid rgba(34,197,94,0.3)",
                                                    color: "#86efac",
                                                    fontSize: "12px",
                                                    padding: "3px 10px",
                                                    borderRadius: "6px",
                                                    cursor: "pointer",
                                                    fontWeight: 600,
                                                }, children: "\u21BB Reload from Blueprint" }))] }), _jsxs("div", { style: { color: "#94a3b8", fontSize: 13, lineHeight: 1.5 }, children: ["This box contains both Operating and Appointment hours. If appointment notes say", " ", _jsx("code", { children: "same" }), " or ", _jsx("code", { children: "same as operating hours" }), ", TGPT automatically resolves them against the operating hours."] }), _jsx("textarea", { value: rawScheduleInput, onChange: (e) => setRawScheduleInput(e.target.value), placeholder: "Paste raw scheduling notes here or load from blueprint...", rows: 14, disabled: isAiLoading, style: {
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
                                        } }), _jsxs("div", { style: { display: "flex", gap: 12, flexWrap: "wrap" }, children: [_jsx("button", { type: "button", onClick: handleAIParse, disabled: isAiLoading || !rawScheduleInput.trim(), style: {
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
                                                }, children: isAiLoading ? `⏳ ${loadingText}` : "✨ Parse with AI (Auto)" }), _jsx("button", { type: "button", onClick: handleManualLocalParse, disabled: isAiLoading || !rawScheduleInput.trim(), style: {
                                                    padding: "10px 24px",
                                                    background: "transparent",
                                                    border: "1px solid rgba(255,255,255,0.2)",
                                                    borderRadius: "6px",
                                                    color: "#cbd5e1",
                                                    fontWeight: 600,
                                                    cursor: isAiLoading || !rawScheduleInput.trim() ? "not-allowed" : "pointer",
                                                    fontSize: "13px",
                                                }, children: "\u26A1 Parse Local (Offline)" }), _jsx("button", { type: "button", className: "btn-secondary btn-sm", onClick: handleApplyPreviewToSchedule, children: "Apply Preview to Weekly Schedule" })] })] })) : (_jsx("div", { style: {
                                    borderRadius: 12,
                                    border: "1px solid rgba(255,255,255,0.08)",
                                    background: "rgba(255,255,255,0.02)",
                                    padding: 12,
                                    color: "#94a3b8",
                                    fontSize: 13,
                                    lineHeight: 1.5,
                                }, children: "Manual option selected. Directly adjust weekly schedule below." })), validationWarnings.length > 0 && (_jsxs("div", { style: {
                                    borderRadius: 10,
                                    background: "rgba(234, 179, 8, 0.1)",
                                    border: "1px solid rgba(234, 179, 8, 0.3)",
                                    padding: "10px 14px",
                                    color: "#fef08a",
                                    fontSize: 13,
                                    display: "grid",
                                    gap: 4,
                                }, children: [_jsx("div", { style: { fontWeight: 700 }, children: "\u26A0\uFE0F Cross-Validation Alerts:" }), _jsx("ul", { style: { margin: 0, paddingLeft: 20 }, children: validationWarnings.map((w, idx) => (_jsx("li", { children: w }, idx))) })] })), _jsx("div", { style: {
                                    borderRadius: 12,
                                    border: "1px solid rgba(255,255,255,0.08)",
                                    background: "rgba(255,255,255,0.02)",
                                    padding: 12,
                                    display: "grid",
                                    gap: 8,
                                }, children: _jsxs("label", { style: {
                                        display: "inline-flex",
                                        alignItems: "center",
                                        gap: 8,
                                        color: "#e2e8f0",
                                        fontSize: 13,
                                        fontWeight: 700,
                                    }, children: [_jsx("input", { type: "checkbox", checked: autoSelectEnabled, onChange: (e) => setAutoSelectEnabled(e.target.checked) }), "Auto Select (Apply changes across all days)"] }) }), _jsx("div", { style: {
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                                    gap: 12,
                                }, children: DAY_OPTIONS.map((day) => {
                                    const row = advisorSchedule[day.key];
                                    return (_jsxs("div", { style: {
                                            borderRadius: 12,
                                            border: "1px solid rgba(255,255,255,0.06)",
                                            background: "rgba(255,255,255,0.02)",
                                            padding: 12,
                                            display: "grid",
                                            gap: 8,
                                        }, children: [_jsx("div", { style: { color: "#f8fafc", fontWeight: 700 }, children: day.label }), _jsxs("label", { style: {
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 8,
                                                    color: "#cbd5e1",
                                                    fontSize: 13,
                                                }, children: [_jsx("input", { type: "checkbox", checked: row.blocked, onChange: (e) => updateScheduleRow(day.key, {
                                                            blocked: e.target.checked,
                                                            start: e.target.checked ? "" : row.start || "09:00",
                                                            end: e.target.checked ? "" : row.end || "17:00",
                                                        }) }), "Blocked"] }), _jsx("input", { type: "time", value: row.start, disabled: row.blocked, style: inputStyle, onChange: (e) => updateScheduleRow(day.key, { start: e.target.value }) }), _jsx("input", { type: "time", value: row.end, disabled: row.blocked, style: inputStyle, onChange: (e) => updateScheduleRow(day.key, { end: e.target.value }) })] }, day.key));
                                }) })] }), _jsxs("div", { style: { ...cardStyle, display: "grid", gap: 12 }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800 }, children: "Parsed Schedule Preview" }), _jsx("div", { style: { color: "#94a3b8", fontSize: 13 }, children: "Advisor appointment hours resolved with full operating hours awareness." }), _jsx("div", { style: { overflowX: "auto" }, children: _jsxs("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 13 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { borderBottom: "1px solid rgba(255,255,255,0.08)" }, children: [_jsx("th", { style: { textAlign: "left", padding: "10px 8px", color: "#94a3b8" }, children: "Day" }), _jsx("th", { style: { textAlign: "left", padding: "10px 8px", color: "#94a3b8" }, children: "Source" }), _jsx("th", { style: { textAlign: "left", padding: "10px 8px", color: "#94a3b8" }, children: "Blocked" }), _jsx("th", { style: { textAlign: "left", padding: "10px 8px", color: "#94a3b8" }, children: "Start" }), _jsx("th", { style: { textAlign: "left", padding: "10px 8px", color: "#94a3b8" }, children: "End" }), _jsx("th", { style: { textAlign: "left", padding: "10px 8px", color: "#94a3b8" }, children: "Raw Input" }), _jsx("th", { style: { textAlign: "left", padding: "10px 8px", color: "#94a3b8" }, children: "Notes" })] }) }), _jsx("tbody", { children: previewRows.map(({ key, label, preview }) => (_jsxs("tr", { style: { borderBottom: "1px solid rgba(255,255,255,0.05)" }, children: [_jsx("td", { style: { padding: "10px 8px", color: "#f8fafc", fontWeight: 700 }, children: label }), _jsx("td", { style: { padding: "10px 8px", color: "#cbd5e1" }, children: preview?.source || "—" }), _jsx("td", { style: { padding: "10px 8px", color: "#cbd5e1" }, children: preview?.blocked ? "Yes" : "No" }), _jsx("td", { style: { padding: "10px 8px", color: "#86efac", fontWeight: 600 }, children: preview?.start || "—" }), _jsx("td", { style: { padding: "10px 8px", color: "#86efac", fontWeight: 600 }, children: preview?.end || "—" }), _jsx("td", { style: {
                                                            padding: "10px 8px",
                                                            color: "#94a3b8",
                                                            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                                                        }, children: preview?.rawValue || "—" }), _jsx("td", { style: { padding: "10px 8px", color: "#fde047" }, children: preview?.notes || "—" })] }, key))) })] }) })] })] })) : null] }));
};
export default ServiceAdvisorsSection;
