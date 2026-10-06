import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchTapBlueprintTasks, postTapTaskComment, updateTapTaskStatus, uploadTapTaskAttachment, } from "./tapTasksApi";
import { buildStoreSlackDraftContext, } from "./storeSlackHelper";
const EMPTY_TASKS = {
    parts: [],
    service: [],
    accounting: [],
};
const MODULES = ["parts", "service", "accounting"];
const moduleMeta = {
    parts: { label: "Parts", operationalName: "Fixed Ops" },
    service: { label: "Service", operationalName: "Fixed Ops" },
    accounting: { label: "Accounting", operationalName: "Variable Ops" },
};
function normalizeStatus(status) {
    const value = String(status ?? "new").trim().toLowerCase();
    if (value === "inprogress" || value === "completed" || value === "duplicate") {
        return value;
    }
    return "new";
}
function nextStatus(status) {
    if (status === "new")
        return "inprogress";
    if (status === "inprogress")
        return "completed";
    return null;
}
function lifecycleButtonLabel(status) {
    if (status === "new")
        return "Start Task";
    if (status === "inprogress")
        return "Mark Completed";
    if (status === "completed")
        return "Completed ✓";
    return "Duplicate";
}
function calculatePhaseStatus(tasks) {
    const statuses = tasks.map((task) => normalizeStatus(task.status));
    if (statuses.length === 0 || statuses.every((status) => status === "new")) {
        return "TO DO";
    }
    if (statuses.every((status) => status === "completed")) {
        return "Completed";
    }
    return "WIP";
}
function calculateFixedOpsStatus(tasks) {
    const partsStatus = calculatePhaseStatus(tasks.parts);
    const serviceStatus = calculatePhaseStatus(tasks.service);
    if (partsStatus === "Completed" && serviceStatus === "Completed") {
        return "Completed";
    }
    if (partsStatus === "TO DO" && serviceStatus === "TO DO") {
        return "TO DO";
    }
    return "WIP";
}
function recipientsForModule(row, module) {
    const context = buildStoreSlackDraftContext(row);
    const searchTerms = module === "accounting" ? ["accounting"] : ["fixed", "parts", "service"];
    const seen = new Set();
    const mentions = [];
    for (const recipient of context.recipients) {
        const lookupText = `${recipient.key} ${recipient.label}`.toLowerCase();
        if (!searchTerms.some((term) => lookupText.includes(term)))
            continue;
        const email = (recipient.matchedUser?.email || recipient.normalizedEmail || "")
            .trim()
            .toLowerCase();
        const name = (recipient.matchedUser?.fullName || "").trim();
        if (email && name && !seen.has(email)) {
            seen.add(email);
            mentions.push({ email, name });
        }
    }
    return mentions;
}
function defaultComment(module, template) {
    if (template === "issue") {
        return "We have encountered below issues kindly look into these.\n\nNotes:";
    }
    return `We have completed the ${moduleMeta[module].operationalName} for this dealer.\n\nNotes:`;
}
function statusStyle(status) {
    if (status === "completed") {
        return {
            color: "#4ade80",
            background: "rgba(74, 222, 128, 0.12)",
            border: "1px solid rgba(74, 222, 128, 0.28)",
        };
    }
    if (status === "inprogress") {
        return {
            color: "#fbbf24",
            background: "rgba(251, 191, 36, 0.12)",
            border: "1px solid rgba(251, 191, 36, 0.28)",
        };
    }
    return {
        color: "#94a3b8",
        background: "rgba(148, 163, 184, 0.12)",
        border: "1px solid rgba(148, 163, 184, 0.24)",
    };
}
export default function DealerTasksPanel({ row, onToast, onOperationalStatusChange, }) {
    const [tasks, setTasks] = useState(EMPTY_TASKS);
    const [activeModule, setActiveModule] = useState("parts");
    const [selectedTaskId, setSelectedTaskId] = useState(null);
    const [loading, setLoading] = useState(false);
    const [busyTaskId, setBusyTaskId] = useState(null);
    const [commentTemplate, setCommentTemplate] = useState("issue");
    const [commentText, setCommentText] = useState(defaultComment("parts", "issue"));
    const [postingComment, setPostingComment] = useState(false);
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef(null);
    const onboardingProjectId = row.onboarding_project_id?.trim() || "";
    const moduleTasks = tasks[activeModule];
    const selectedTask = moduleTasks.find((task) => task.taskId === selectedTaskId) ??
        moduleTasks[0] ??
        null;
    const recipients = useMemo(() => recipientsForModule(row, activeModule), [row, activeModule]);
    const loadTasks = async () => {
        if (!onboardingProjectId) {
            onToast("❌ This dealer does not have an onboarding_project_id.");
            return;
        }
        setLoading(true);
        try {
            const result = await fetchTapBlueprintTasks(onboardingProjectId);
            setTasks(result);
            const firstModule = MODULES.find((module) => result[module].length > 0) ?? "parts";
            setActiveModule(firstModule);
            setSelectedTaskId(result[firstModule][0]?.taskId ?? null);
            if (!result.parts.length && !result.service.length && !result.accounting.length) {
                onToast("⚠ No matching DS - Onboarding blueprint tasks were found.");
            }
        }
        catch (error) {
            console.error("[DealerTasksPanel] TAP task load failed", error);
            onToast("❌ TAP task functions is not working");
        }
        finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        setTasks(EMPTY_TASKS);
        setActiveModule("parts");
        setSelectedTaskId(null);
        setCommentTemplate("issue");
        setCommentText(defaultComment("parts", "issue"));
        void loadTasks();
        // Re-load only when a different dealer/project opens the Tasks panel.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [row.tekion_id, onboardingProjectId]);
    useEffect(() => {
        const firstTask = tasks[activeModule][0];
        setSelectedTaskId(firstTask?.taskId ?? null);
        setCommentText(defaultComment(activeModule, commentTemplate));
    }, [activeModule, commentTemplate, tasks]);
    const applyDerivedOperationalStatuses = async (nextTasks) => {
        await onOperationalStatusChange(row.tekion_id, "fixed_ops_status", calculateFixedOpsStatus(nextTasks));
        await onOperationalStatusChange(row.tekion_id, "variable_ops_status", calculatePhaseStatus(nextTasks.accounting));
    };
    const changeTaskStatus = async (task) => {
        const currentStatus = normalizeStatus(task.status);
        const updatedStatus = nextStatus(currentStatus);
        if (!updatedStatus)
            return;
        setBusyTaskId(task.taskId);
        try {
            await updateTapTaskStatus(task.taskId, updatedStatus);
            const nextTasks = {
                ...tasks,
                [activeModule]: tasks[activeModule].map((item) => item.taskId === task.taskId ? { ...item, status: updatedStatus } : item),
            };
            setTasks(nextTasks);
            await applyDerivedOperationalStatuses(nextTasks);
            onToast(`✅ ${moduleMeta[activeModule].label} task updated to ${updatedStatus === "inprogress" ? "In Progress" : "Completed"}`);
        }
        catch (error) {
            console.error("[DealerTasksPanel] TAP task status update failed", error);
            onToast("❌ TAP task functions is not working");
        }
        finally {
            setBusyTaskId(null);
        }
    };
    const applyTemplate = (template) => {
        setCommentTemplate(template);
        setCommentText(defaultComment(activeModule, template));
    };
    const postComment = async () => {
        if (!selectedTask || !commentText.trim())
            return;
        setPostingComment(true);
        try {
            await postTapTaskComment(selectedTask.taskId, commentText, recipients);
            onToast("✅ TAP comment posted");
        }
        catch (error) {
            console.error("[DealerTasksPanel] TAP comment post failed", error);
            onToast("❌ TAP task functions is not working");
        }
        finally {
            setPostingComment(false);
        }
    };
    const uploadFile = async (file) => {
        if (!file || !selectedTask)
            return;
        setUploading(true);
        try {
            await uploadTapTaskAttachment(selectedTask.taskId, file);
            onToast(`✅ Uploaded ${file.name}`);
            if (fileInputRef.current)
                fileInputRef.current.value = "";
        }
        catch (error) {
            console.error("[DealerTasksPanel] TAP attachment upload failed", error);
            onToast("❌ TAP task functions is not working");
        }
        finally {
            setUploading(false);
        }
    };
    return (_jsxs("div", { style: {
            display: "grid",
            gridTemplateColumns: "160px minmax(0, 1fr)",
            gap: 16,
            minHeight: 390,
        }, children: [_jsxs("aside", { style: {
                    display: "grid",
                    alignContent: "start",
                    gap: 8,
                    padding: 10,
                    borderRadius: 10,
                    background: "#0d1117",
                }, children: [MODULES.map((module) => (_jsxs("button", { type: "button", onClick: () => setActiveModule(module), style: {
                            textAlign: "left",
                            padding: "9px 10px",
                            borderRadius: 8,
                            cursor: "pointer",
                            color: activeModule === module ? "#fff" : "#94a3b8",
                            background: activeModule === module ? "rgba(59, 130, 246, 0.22)" : "transparent",
                            border: `1px solid ${activeModule === module
                                ? "rgba(96, 165, 250, 0.42)"
                                : "rgba(255, 255, 255, 0.08)"}`,
                        }, children: [moduleMeta[module].label, _jsx("span", { style: { float: "right", opacity: 0.75 }, children: tasks[module].length })] }, module))), _jsx("button", { type: "button", className: "btn-secondary btn-sm", disabled: loading, onClick: () => void loadTasks(), style: { marginTop: 6 }, children: loading ? "Loading…" : "↻ Reload Tasks" })] }), _jsxs("section", { style: { display: "grid", gap: 12, minWidth: 0 }, children: [_jsxs("div", { style: {
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            flexWrap: "wrap",
                        }, children: [_jsxs("div", { children: [_jsxs("strong", { style: { color: "#f8fafc" }, children: [moduleMeta[activeModule].label, " Blueprint Tasks"] }), _jsxs("div", { style: { fontSize: 11, color: "#64748b", marginTop: 3 }, children: ["Project: ", onboardingProjectId || "Missing onboarding_project_id"] })] }), _jsxs("span", { style: { color: "#94a3b8", fontSize: 11 }, children: ["Notify: ", recipients.map((recipient) => recipient.name).join(", ") || "No matching lead found"] })] }), loading ? (_jsx("div", { style: { color: "#94a3b8", padding: 20 }, children: "Loading TAP tasks\u2026" })) : !moduleTasks.length ? (_jsxs("div", { style: {
                            color: "#94a3b8",
                            padding: 20,
                            border: "1px dashed rgba(255, 255, 255, 0.15)",
                            borderRadius: 10,
                        }, children: ["No matching ", moduleMeta[activeModule].label, " blueprint tasks."] })) : (_jsxs(_Fragment, { children: [_jsx("select", { className: "stores-input", value: selectedTask?.taskId ?? "", onChange: (event) => setSelectedTaskId(Number(event.target.value)), children: moduleTasks.map((task) => (_jsxs("option", { value: task.taskId, children: ["#", task.taskId, " \u2014 ", task.taskName] }, task.taskId))) }), selectedTask && (_jsxs("div", { style: {
                                    padding: 12,
                                    borderRadius: 10,
                                    background: "#11151d",
                                    display: "grid",
                                    gap: 10,
                                }, children: [_jsxs("div", { style: {
                                            display: "flex",
                                            justifyContent: "space-between",
                                            gap: 8,
                                            flexWrap: "wrap",
                                        }, children: [_jsx("strong", { children: selectedTask.taskName }), _jsx("span", { style: {
                                                    borderRadius: 999,
                                                    padding: "3px 8px",
                                                    fontSize: 11,
                                                    fontWeight: 700,
                                                    ...statusStyle(normalizeStatus(selectedTask.status)),
                                                }, children: normalizeStatus(selectedTask.status) })] }), _jsx("div", { style: { color: "#94a3b8", fontSize: 12 }, children: selectedTask.descriptionPlain || "No task description available." }), _jsx("button", { type: "button", className: "btn-postman", disabled: !nextStatus(normalizeStatus(selectedTask.status)) ||
                                            busyTaskId === selectedTask.taskId, onClick: () => void changeTaskStatus(selectedTask), children: busyTaskId === selectedTask.taskId
                                            ? "Updating…"
                                            : lifecycleButtonLabel(normalizeStatus(selectedTask.status)) })] })), _jsxs("div", { style: {
                                    padding: 12,
                                    borderRadius: 10,
                                    background: "#11151d",
                                    display: "grid",
                                    gap: 9,
                                }, children: [_jsxs("div", { style: {
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            flexWrap: "wrap",
                                            gap: 8,
                                        }, children: [_jsxs("strong", { children: ["Comment for task #", selectedTask?.taskId ?? "—"] }), _jsxs("div", { style: { display: "flex", gap: 6 }, children: [_jsx("button", { type: "button", className: "btn-secondary btn-sm", onClick: () => applyTemplate("issue"), children: "Issue" }), _jsx("button", { type: "button", className: "btn-secondary btn-sm", onClick: () => applyTemplate("completed"), children: "Completed" })] })] }), _jsx("textarea", { className: "stores-input", value: commentText, onChange: (event) => setCommentText(event.target.value), style: { width: "100%", minHeight: 125, resize: "vertical" } }), _jsxs("div", { style: {
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            gap: 8,
                                            flexWrap: "wrap",
                                        }, children: [_jsxs("div", { children: [_jsx("input", { ref: fileInputRef, id: `task-file-${row.tekion_id}`, type: "file", hidden: true, disabled: !selectedTask || uploading, onChange: (event) => void uploadFile(event.target.files?.[0]) }), _jsx("label", { htmlFor: `task-file-${row.tekion_id}`, className: "btn-secondary btn-sm", style: {
                                                            cursor: selectedTask && !uploading ? "pointer" : "not-allowed",
                                                            opacity: selectedTask && !uploading ? 1 : 0.55,
                                                        }, children: uploading ? "Uploading…" : "📎 Upload File" })] }), _jsx("button", { type: "button", className: "btn-postman", disabled: !selectedTask || postingComment || !commentText.trim(), onClick: () => void postComment(), children: postingComment ? "Posting…" : "Post Comment" })] })] })] }))] })] }));
}
