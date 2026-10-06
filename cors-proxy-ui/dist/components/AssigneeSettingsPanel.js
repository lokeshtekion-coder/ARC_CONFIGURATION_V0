import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ASSIGNEE_OPTIONS, hydrateAssigneeStateFromBackend, loadAssigneeConfig, loadAssignmentLog, runAutoAssign, saveAssigneeConfig, summarizeAssignments, isEligibleForAutoAssign, } from "../services/assigneeService";
import { getStores, saveStores } from "../services/storesDb";
import { patchSingleStoreAssigneeInGraph } from "../services/storesGraphSync";
const SOURCE_LABEL = {
    bot: "🤖 Bot",
    manual: "✋ Manual",
    excel: "📗 Excel edit",
};
export const AssigneeSettingsPanel = () => {
    const [config, setConfig] = useState(() => loadAssigneeConfig());
    const [log, setLog] = useState(() => loadAssignmentLog());
    const [stores, setStores] = useState([]);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState("");
    const refresh = useCallback(async () => {
        await hydrateAssigneeStateFromBackend();
        setConfig(loadAssigneeConfig());
        setLog(loadAssignmentLog());
        setStores(await getStores());
    }, []);
    useEffect(() => {
        void refresh();
    }, [refresh]);
    const update = (next) => {
        setConfig(next);
        saveAssigneeConfig(next);
    };
    const toggle = (name) => {
        const has = config.selected.includes(name);
        update({
            ...config,
            selected: has ? config.selected.filter((n) => n !== name) : [...config.selected, name],
        });
    };
    const allSelected = config.selected.length === ASSIGNEE_OPTIONS.length;
    const eligibleUnassigned = useMemo(() => stores.filter((s) => isEligibleForAutoAssign(s) && !String(s.custom_assignee ?? "").trim()).length, [stores]);
    const summary = useMemo(() => summarizeAssignments(stores, log), [stores, log]);
    const recent = useMemo(() => [...log].reverse().slice(0, 40), [log]);
    const assignNow = async () => {
        setBusy(true);
        setNote("");
        try {
            const current = await getStores();
            const { updated, events } = runAutoAssign(current, { ...config, autoAssignEnabled: true });
            if (!updated.length) {
                setNote("No unassigned stores met criteria (POD 1, 2, or 3 with completed Parts & Service and pending Fixed Ops).");
                return;
            }
            const byId = new Map(updated.map((u) => [u.tekion_id, u]));
            const nextStores = current.map((s) => byId.get(s.tekion_id) ?? s);
            await saveStores(nextStores);
            for (const u of updated) {
                try {
                    await patchSingleStoreAssigneeInGraph(u.tekion_id, String(u.custom_assignee));
                }
                catch { }
            }
            setNote(`✅ Assigned ${events.length} store(s) and notified #operations channel!`);
            await refresh();
        }
        catch (err) {
            setNote(`❌ Error: ${err instanceof Error ? err.message : "Assignment failed"}`);
        }
        finally {
            setBusy(false);
        }
    };
    return (_jsxs("div", { className: "section-card", style: { padding: 18, display: "grid", gap: 16 }, children: [_jsxs("div", { children: [_jsx("h3", { style: { margin: "0 0 6px 0", fontSize: 18 }, children: "Assignees & Auto-Assignment" }), _jsxs("p", { style: { margin: 0, color: "#94a3b8", fontSize: 13 }, children: ["Auto-assigns stores in ", _jsx("strong", { children: "POD 1, 2, and 3" }), " where Parts & Service blueprints are ", _jsx("strong", { children: "Completed" }), " and Fixed Ops is pending. Immediately notifies channel", " ", _jsx("strong", { children: "#C0C5QBWEM8X" }), " for each assigned dealership."] })] }), _jsxs("div", { className: "compact-card", style: { display: "grid", gap: 10 }, children: [_jsxs("div", { style: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }, children: [_jsxs("strong", { style: { color: "#f8fafc" }, children: ["Assignees (", config.selected.length, " selected)"] }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => update({ ...config, selected: allSelected ? [] : [...ASSIGNEE_OPTIONS] }), children: allSelected ? "Clear all" : "Select all" })] }), _jsx("div", { style: { display: "flex", gap: 14, flexWrap: "wrap" }, children: ASSIGNEE_OPTIONS.map((name) => (_jsxs("label", { style: { display: "flex", gap: 6, alignItems: "center", color: "#e2e8f0", cursor: "pointer" }, children: [_jsx("input", { type: "checkbox", checked: config.selected.includes(name), onChange: () => toggle(name), style: { accentColor: "#38bdf8" } }), name] }, name))) }), _jsxs("label", { style: { display: "flex", gap: 8, alignItems: "center", color: "#e2e8f0", cursor: "pointer" }, children: [_jsx("input", { type: "checkbox", checked: config.autoAssignEnabled, onChange: (e) => update({ ...config, autoAssignEnabled: e.target.checked }), style: { accentColor: "#38bdf8" } }), "Auto-assign automatically while the Stores dashboard is open"] }), _jsxs("div", { style: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 4 }, children: [_jsx("button", { className: "btn-postman btn-sm", type: "button", disabled: busy || config.selected.length === 0 || eligibleUnassigned === 0, onClick: () => void assignNow(), style: { fontWeight: 800 }, children: busy ? "Assigning..." : `⚡ Assign ${eligibleUnassigned} eligible store(s) now` }), note && _jsx("span", { style: { color: "#38bdf8", fontSize: 12, fontWeight: 600 }, children: note })] })] }), _jsxs("div", { style: {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 14px",
                    background: "rgba(56, 189, 248, 0.05)",
                    border: "1px solid rgba(56, 189, 248, 0.2)",
                    borderRadius: 8,
                }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("span", { style: { fontSize: 14 }, children: "\uD83D\uDCE2" }), _jsxs("span", { style: { fontSize: 12, color: "#94a3b8" }, children: ["Alerts Channel: ", _jsx("strong", { style: { color: "#38bdf8" }, children: "#C0C5QBWEM8X" }), " (Dispatched per assigned store)"] })] }), _jsx("span", { style: { fontSize: 11, color: "#64748b" }, children: "Live Individual Alerts" })] }), _jsxs("div", { className: "compact-card", style: { display: "grid", gap: 8 }, children: [_jsx("strong", { style: { color: "#f8fafc" }, children: "Assignment tracking" }), _jsxs("table", { style: { width: "100%", fontSize: 12, color: "#e2e8f0", borderCollapse: "collapse" }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: "left", color: "#94a3b8" }, children: [_jsx("th", { children: "Assignee" }), _jsx("th", { children: "Stores now" }), _jsx("th", { children: "Given by bot" }), _jsx("th", { children: "Received manually" }), _jsx("th", { children: "Moved away manually" })] }) }), _jsx("tbody", { children: summary.map((r) => (_jsxs("tr", { children: [_jsx("td", { children: r.name }), _jsx("td", { children: r.current }), _jsx("td", { children: r.byBot }), _jsx("td", { children: r.receivedManually }), _jsx("td", { children: r.movedAwayManually })] }, r.name))) })] })] }), _jsxs("div", { className: "compact-card", style: { display: "grid", gap: 8 }, children: [_jsx("strong", { style: { color: "#f8fafc" }, children: "Recent changes" }), recent.length === 0 ? (_jsx("span", { style: { color: "#94a3b8", fontSize: 12 }, children: "No assignment changes recorded yet." })) : (_jsx("div", { style: { maxHeight: 280, overflow: "auto", display: "grid", gap: 4 }, children: recent.map((e) => (_jsxs("div", { style: { fontSize: 12, color: "#e2e8f0" }, children: [_jsx("span", { style: { color: "#94a3b8" }, children: new Date(e.at).toLocaleString() }), " ", SOURCE_LABEL[e.source] ?? e.source, " \u00B7 ", e.dealerName, " (", e.dealerId, "):", " ", e.previousAssignee || "Unassigned", " \u2192 ", _jsx("strong", { children: e.assignee || "Unassigned" })] }, e.id))) }))] })] }));
};
export default AssigneeSettingsPanel;
