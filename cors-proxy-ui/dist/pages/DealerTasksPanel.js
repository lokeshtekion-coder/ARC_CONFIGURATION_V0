import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * DealerTasksPanel Component
 *
 * Purpose:
 * Renders an operational management workspace for a dealership's TAP (Tekion Automation Platform)
 * blueprint tasks across three functional departments: Parts, Service, and Accounting.
 *
 * Core Capabilities:
 * 1. Task Lifecycle & Status Sync:
 *    - Fetches and caches module-level blueprint tasks via TAP APIs.
 *    - Allows users to transition task statuses (e.g., 'new' -> 'inprogress' -> 'completed').
 *    - Automatically derives and rolls up operational statuses for Fixed Ops (Parts + Service)
 *      and Variable Ops (Accounting), propagating changes back to the parent Stores tracker.
 *
 * 2. Attachment Management:
 *    - Scans and loads task file attachments asynchronously.
 *    - Emits snapshot updates (`onTasksSnapshot`) with attachment counts to surface metrics
 *      and incomplete quality-audit flags in the main Stores table.
 *    - Supports uploading local attachments directly to individual TAP tasks.
 *
 * 3. Smart Mention Comments:
 *    - Auto-populates pre-formatted templates ("Flag Issue" / "Completion Note").
 *    - Automatically detects relevant department leads from Slack candidate lists to tag
 *      the appropriate POD/lead email in comments.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { resolveStoreProjectId, } from "../services/storesDb";
import { fetchTapBlueprintTasks, postTapTaskComment, updateTapTaskStatus, uploadTapTaskAttachment, fetchTaskAttachments, fetchTaskAttachmentsOrNull, } from "../services/tapTasksApi";
import { buildStoreSlackDraftContext, } from "../services/storeSlackHelper";
const EMPTY_TASKS = {
    parts: [],
    service: [],
    accounting: [],
};
const MODULES = ["parts", "service", "accounting"];
const moduleMeta = {
    parts: { label: "Parts", operationalName: "Fixed Ops", icon: "📦" },
    service: { label: "Service", operationalName: "Fixed Ops", icon: "🔧" },
    accounting: { label: "Accounting", operationalName: "Variable Ops", icon: "📊" },
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
        return "▶ Start Task";
    if (status === "inprogress")
        return "✓ Mark Completed";
    if (status === "completed")
        return "✓ Completed";
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
    const seen = new Set();
    const mentions = [];
    const targetKeys = module === "accounting"
        ? ["variableopspod", "accounting"]
        : ["fixedopspod", "fixed", "parts", "service"];
    for (const recipient of context.recipients) {
        const keyLower = recipient.key.toLowerCase();
        const labelLower = recipient.label.toLowerCase();
        const matchesModule = targetKeys.some((term) => keyLower.includes(term) || labelLower.includes(term));
        if (!matchesModule)
            continue;
        const email = (recipient.matchedUser?.email || recipient.normalizedEmail || "")
            .trim()
            .toLowerCase();
        const name = (recipient.matchedUser?.fullName || recipient.label || "").trim();
        if (email && !seen.has(email)) {
            seen.add(email);
            mentions.push({ email, name: name || email });
        }
    }
    return mentions;
}
function defaultComment(module, template, mentions = []) {
    const mentionPrefix = mentions.length > 0 ? mentions.map((m) => `@${m.name}`).join(" ") + " " : "";
    if (template === "issue") {
        return `${mentionPrefix}We have encountered below issues kindly look into these.\n\nNotes:`;
    }
    return `${mentionPrefix}We have completed the ${moduleMeta[module].operationalName} for this dealer.\n\nNotes:`;
}
export default function DealerTasksPanel({ row, onToast, onOperationalStatusChange, onTasksSnapshot, }) {
    const [tasks, setTasks] = useState(EMPTY_TASKS);
    const [activeModule, setActiveModule] = useState("parts");
    const [selectedTaskId, setSelectedTaskId] = useState(null);
    const [loading, setLoading] = useState(false);
    const [busyTaskId, setBusyTaskId] = useState(null);
    const [commentTemplate, setCommentTemplate] = useState("issue");
    const [commentText, setCommentText] = useState("");
    const [postingComment, setPostingComment] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [loadingAttachments, setLoadingAttachments] = useState(false);
    const fileInputRef = useRef(null);
    // Resolves primary onboarding_project_id, then falls back to ds_onboarding_project_id
    const resolvedProjectId = resolveStoreProjectId(row);
    const moduleTasks = tasks[activeModule];
    const selectedTask = moduleTasks.find((task) => task.taskId === selectedTaskId) ??
        moduleTasks[0] ??
        null;
    const dealerContext = useMemo(() => ({
        tenantId: row.tenant_id,
        dealerId: row.dealer_id,
        tenantCode: row.tenant_code,
    }), [row.tenant_id, row.dealer_id, row.tenant_code]);
    const recipients = useMemo(() => recipientsForModule(row, activeModule), [row, activeModule]);
    useEffect(() => {
        const pending = [];
        for (const m of MODULES) {
            for (const t of tasks[m]) {
                if (t.attachments === undefined && t.taskId)
                    pending.push({ module: m, taskId: t.taskId });
            }
        }
        if (pending.length === 0)
            return;
        let isCancelled = false;
        setLoadingAttachments(true);
        void (async () => {
            for (const item of pending) {
                if (isCancelled)
                    return;
                const items = await fetchTaskAttachmentsOrNull(item.taskId, dealerContext);
                if (isCancelled)
                    return;
                if (items === null)
                    continue;
                setTasks((prev) => ({
                    ...prev,
                    [item.module]: prev[item.module].map((t) => t.taskId === item.taskId
                        ? { ...t, attachments: items, taskAttachmentCount: items.length }
                        : t),
                }));
            }
            if (!isCancelled)
                setLoadingAttachments(false);
        })();
        return () => {
            isCancelled = true;
        };
    }, [tasks, dealerContext]);
    useEffect(() => {
        const all = [...tasks.parts, ...tasks.service, ...tasks.accounting];
        if (all.length === 0 || !onTasksSnapshot)
            return;
        const complete = all.every((t) => t.attachments !== undefined);
        const anyLoaded = all.some((t) => t.attachments !== undefined);
        if (anyLoaded)
            onTasksSnapshot(row.tekion_id, tasks, complete);
        // eslint-disable-next-line react-hooks/exhaustive-dependencies
    }, [tasks]);
    const loadTasks = async (forceRemote = false) => {
        if (!forceRemote &&
            row.fetched_blueprint_tasks &&
            (row.fetched_blueprint_tasks.partsTasks?.length ||
                row.fetched_blueprint_tasks.serviceTasks?.length ||
                row.fetched_blueprint_tasks.accountingTasks?.length)) {
            const cached = row.fetched_blueprint_tasks;
            const cachedFormatted = {
                parts: (cached.partsTasks || []).map((t) => ({
                    ...t,
                    taskId: Number(t.taskId ?? t.id ?? 0),
                    taskName: t.taskName ?? t.name ?? "Task",
                    status: t.status ?? "new",
                    taskAttachmentCount: Number(t.taskAttachmentCount ?? t.attachments?.length ?? 0),
                    attachments: t.attachments,
                })),
                service: (cached.serviceTasks || []).map((t) => ({
                    ...t,
                    taskId: Number(t.taskId ?? t.id ?? 0),
                    taskName: t.taskName ?? t.name ?? "Task",
                    status: t.status ?? "new",
                    taskAttachmentCount: Number(t.taskAttachmentCount ?? t.attachments?.length ?? 0),
                    attachments: t.attachments,
                })),
                accounting: (cached.accountingTasks || []).map((t) => ({
                    ...t,
                    taskId: Number(t.taskId ?? t.id ?? 0),
                    taskName: t.taskName ?? t.name ?? "Task",
                    status: t.status ?? "new",
                    taskAttachmentCount: Number(t.taskAttachmentCount ?? t.attachments?.length ?? 0),
                    attachments: t.attachments,
                })),
            };
            setTasks(cachedFormatted);
            const firstModule = MODULES.find((m) => cachedFormatted[m].length > 0) ?? "parts";
            setActiveModule(firstModule);
            setSelectedTaskId(cachedFormatted[firstModule][0]?.taskId ?? null);
            return;
        }
        if (!resolvedProjectId) {
            onToast("❌ This dealer does not have a TAP project ID (missing onboarding_project_id & ds_onboarding_project_id).");
            return;
        }
        setLoading(true);
        try {
            const result = await fetchTapBlueprintTasks(resolvedProjectId, dealerContext);
            const formattedResult = {
                parts: (result.parts || []).map((t) => ({
                    ...t,
                    taskId: Number(t.taskId ?? t.id ?? 0),
                    taskName: t.taskName ?? t.name ?? "Task",
                    taskAttachmentCount: Number(t.taskAttachmentCount ?? t.attachmentCount ?? 0),
                })),
                service: (result.service || []).map((t) => ({
                    ...t,
                    taskId: Number(t.taskId ?? t.id ?? 0),
                    taskName: t.taskName ?? t.name ?? "Task",
                    taskAttachmentCount: Number(t.taskAttachmentCount ?? t.attachmentCount ?? 0),
                })),
                accounting: (result.accounting || []).map((t) => ({
                    ...t,
                    taskId: Number(t.taskId ?? t.id ?? 0),
                    taskName: t.taskName ?? t.name ?? "Task",
                    taskAttachmentCount: Number(t.taskAttachmentCount ?? t.attachmentCount ?? 0),
                })),
            };
            setTasks(formattedResult);
            const firstModule = MODULES.find((module) => formattedResult[module].length > 0) ?? "parts";
            setActiveModule(firstModule);
            setSelectedTaskId(formattedResult[firstModule][0]?.taskId ?? null);
            if (!formattedResult.parts.length &&
                !formattedResult.service.length &&
                !formattedResult.accounting.length) {
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
        void loadTasks(false);
        // eslint-disable-next-line react-hooks/exhaustive-dependencies
    }, [row.tekion_id, resolvedProjectId]);
    useEffect(() => {
        const firstTask = tasks[activeModule][0];
        setSelectedTaskId(firstTask?.taskId ?? null);
        setCommentText(defaultComment(activeModule, commentTemplate, recipients));
    }, [activeModule, commentTemplate, recipients, tasks]);
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
            await updateTapTaskStatus(task.taskId, updatedStatus, dealerContext);
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
        setCommentText(defaultComment(activeModule, template, recipients));
    };
    const postComment = async () => {
        if (!selectedTask || !commentText.trim())
            return;
        setPostingComment(true);
        const activeMentions = recipients.filter((r) => commentText.toLowerCase().includes(`@${r.name.toLowerCase()}`) ||
            commentText.toLowerCase().includes(r.name.toLowerCase()));
        try {
            await postTapTaskComment(selectedTask.taskId, commentText, activeMentions, dealerContext);
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
    const uploadFile = async () => {
        if (!selectedFile || !selectedTask)
            return;
        setUploading(true);
        try {
            await uploadTapTaskAttachment(selectedTask.taskId, selectedFile, dealerContext);
            onToast(`✅ Uploaded ${selectedFile.name}`);
            const freshAttachments = await fetchTaskAttachments(selectedTask.taskId, dealerContext);
            setTasks((prev) => ({
                ...prev,
                [activeModule]: prev[activeModule].map((item) => item.taskId === selectedTask.taskId
                    ? {
                        ...item,
                        attachments: freshAttachments,
                        taskAttachmentCount: freshAttachments.length,
                    }
                    : item),
            }));
            setSelectedFile(null);
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
    const currentAttachmentCount = selectedTask?.attachments?.length ?? selectedTask?.taskAttachmentCount ?? 0;
    return (_jsxs("div", { className: "tasks-shell-grid", children: [_jsxs("aside", { className: "tasks-module-nav", children: [MODULES.map((module) => {
                        const count = tasks[module].length;
                        const isCompleted = count > 0 &&
                            tasks[module].every((t) => normalizeStatus(t.status) === "completed");
                        return (_jsxs("button", { type: "button", className: `module-nav-btn ${activeModule === module ? "active" : ""}`, onClick: () => setActiveModule(module), children: [_jsxs("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 }, children: [_jsx("span", { children: moduleMeta[module].icon }), _jsx("span", { children: moduleMeta[module].label })] }), _jsx("span", { className: "module-badge-count", children: isCompleted ? "✓" : count })] }, module));
                    }), _jsx("div", { style: { marginTop: "auto", paddingTop: 10 }, children: _jsx("button", { type: "button", className: "btn-secondary btn-sm", style: { width: "100%", justifyContent: "center" }, disabled: loading, onClick: () => void loadTasks(true), children: loading ? "Loading…" : "↻ Reload" }) })] }), _jsx("section", { style: { display: "flex", flexDirection: "column", gap: 14 }, children: loading ? (_jsx("div", { style: { color: "#94a3b8", padding: 30, textAlign: "center" }, children: "Loading blueprint tasks\u2026" })) : !moduleTasks.length ? (_jsxs("div", { style: {
                        color: "#94a3b8",
                        padding: 40,
                        border: "1px dashed rgba(255, 255, 255, 0.12)",
                        borderRadius: 12,
                        textAlign: "center",
                    }, children: ["No active ", moduleMeta[activeModule].label, " blueprint configuration tasks found."] })) : (_jsxs(_Fragment, { children: [moduleTasks.length > 1 && (_jsx("div", { style: {
                                display: "flex",
                                gap: 8,
                                overflowX: "auto",
                                paddingBottom: 6,
                            }, children: moduleTasks.map((t) => {
                                const isSelected = selectedTask?.taskId === t.taskId;
                                const attCount = t.attachments?.length ?? t.taskAttachmentCount ?? 0;
                                return (_jsxs("button", { type: "button", onClick: () => setSelectedTaskId(t.taskId), style: {
                                        padding: "6px 12px",
                                        borderRadius: 8,
                                        background: isSelected
                                            ? "rgba(56, 189, 248, 0.16)"
                                            : "rgba(30, 41, 59, 0.5)",
                                        border: `1px solid ${isSelected
                                            ? "rgba(56, 189, 248, 0.4)"
                                            : "rgba(148, 163, 184, 0.15)"}`,
                                        color: isSelected ? "#38bdf8" : "#94a3b8",
                                        cursor: "pointer",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        whiteSpace: "nowrap",
                                        fontSize: 11,
                                        fontWeight: 600,
                                    }, children: [_jsxs("span", { children: ["#", t.taskId] }), _jsx("span", { style: {
                                                maxWidth: 140,
                                                overflow: "hidden",
                                                textOverflow: "ellipsis",
                                            }, children: t.taskName }), _jsxs("span", { style: {
                                                fontSize: 10,
                                                padding: "1px 5px",
                                                borderRadius: 4,
                                                background: attCount > 0
                                                    ? "rgba(56, 189, 248, 0.25)"
                                                    : "rgba(148, 163, 184, 0.15)",
                                                color: attCount > 0 ? "#38bdf8" : "#94a3b8",
                                            }, children: ["\uD83D\uDCCE ", attCount] })] }, t.taskId));
                            }) })), selectedTask && (_jsxs("div", { className: "task-hero-card", children: [_jsxs("div", { className: "task-hero-top", children: [_jsxs("div", { children: [_jsxs("div", { className: "task-hero-title", children: [_jsxs("span", { className: "task-id-tag", children: ["#", selectedTask.taskId] }), selectedTask.taskName] }), _jsxs("div", { style: {
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 12,
                                                        marginTop: 6,
                                                        flexWrap: "wrap",
                                                    }, children: [_jsxs("div", { style: { fontSize: 11, color: "#64748b" }, children: ["Notify Lead:", " ", _jsx("strong", { style: { color: "#38bdf8" }, children: recipients.map((r) => r.name).join(", ") || "None assigned" })] }), _jsxs("span", { style: {
                                                                display: "inline-flex",
                                                                alignItems: "center",
                                                                gap: 4,
                                                                padding: "3px 8px",
                                                                borderRadius: 6,
                                                                fontSize: 11,
                                                                fontWeight: 700,
                                                                lineHeight: 1,
                                                                background: currentAttachmentCount > 0
                                                                    ? "rgba(56, 189, 248, 0.18)"
                                                                    : "rgba(148, 163, 184, 0.12)",
                                                                color: currentAttachmentCount > 0 ? "#38bdf8" : "#94a3b8",
                                                                border: `1px solid ${currentAttachmentCount > 0
                                                                    ? "rgba(56, 189, 248, 0.35)"
                                                                    : "rgba(148, 163, 184, 0.2)"}`,
                                                            }, children: [_jsx("span", { children: "\uD83D\uDCCE" }), _jsx("span", { children: loadingAttachments
                                                                        ? "Checking..."
                                                                        : `${currentAttachmentCount} ${currentAttachmentCount === 1
                                                                            ? "Attachment"
                                                                            : "Attachments"}` })] })] })] }), _jsx("button", { type: "button", className: "btn-postman task-lifecycle-btn", disabled: !nextStatus(normalizeStatus(selectedTask.status)) ||
                                                busyTaskId === selectedTask.taskId, onClick: () => void changeTaskStatus(selectedTask), children: busyTaskId === selectedTask.taskId
                                                ? "Updating…"
                                                : lifecycleButtonLabel(normalizeStatus(selectedTask.status)) })] }), selectedTask.attachments && selectedTask.attachments.length > 0 && (_jsx("div", { style: {
                                        display: "flex",
                                        flexWrap: "wrap",
                                        gap: 6,
                                        marginTop: 10,
                                        padding: "8px 10px",
                                        borderRadius: 6,
                                        background: "rgba(15, 23, 42, 0.5)",
                                        border: "1px solid rgba(56, 189, 248, 0.2)",
                                    }, children: selectedTask.attachments.map((att) => (_jsxs("a", { href: att.link, target: "_blank", rel: "noreferrer", title: "Click to view/download file", style: {
                                            display: "inline-flex",
                                            alignItems: "center",
                                            gap: 5,
                                            fontSize: 11,
                                            color: "#38bdf8",
                                            background: "rgba(56, 189, 248, 0.12)",
                                            padding: "3px 8px",
                                            borderRadius: 4,
                                            textDecoration: "none",
                                            border: "1px solid rgba(56, 189, 248, 0.25)",
                                        }, children: [_jsx("span", { children: "\uD83D\uDCC4" }), _jsx("span", { children: att.name }), _jsx("span", { style: { fontSize: 9, opacity: 0.7 }, children: "\u2197" })] }, att.id))) })), selectedTask.descriptionPlain && (_jsx("div", { style: {
                                        color: "#94a3b8",
                                        fontSize: 12,
                                        lineHeight: 1.4,
                                        marginTop: 8,
                                    }, children: selectedTask.descriptionPlain }))] })), _jsxs("div", { className: "task-composer-card", children: [_jsxs("div", { className: "composer-toolbar", children: [_jsxs("div", { className: "composer-template-pills", children: [_jsx("button", { type: "button", className: `template-pill-btn ${commentTemplate === "issue" ? "active" : ""}`, onClick: () => applyTemplate("issue"), children: "\u26A0 Flag Issue" }), _jsx("button", { type: "button", className: `template-pill-btn ${commentTemplate === "completed" ? "active" : ""}`, onClick: () => applyTemplate("completed"), children: "\u2713 Completion Note" })] }), _jsxs("span", { style: { fontSize: 11, color: "#64748b" }, children: ["Backspace ", _jsx("strong", { children: "@Name" }), " to post without notifying"] })] }), _jsx("textarea", { className: "composer-textarea", value: commentText, onChange: (e) => setCommentText(e.target.value) }), _jsxs("div", { className: "composer-footer", children: [_jsxs("div", { className: "attach-action-wrap", children: [_jsx("input", { ref: fileInputRef, id: `file-picker-${row.tekion_id}`, type: "file", hidden: true, disabled: !selectedTask || uploading, onChange: (e) => setSelectedFile(e.target.files?.[0] ?? null) }), _jsxs("label", { htmlFor: `file-picker-${row.tekion_id}`, className: "btn-secondary btn-sm", style: { cursor: "pointer" }, children: ["\uD83D\uDCCE ", selectedFile ? "Change File" : "Attach File"] }), selectedFile && (_jsxs(_Fragment, { children: [_jsx("span", { className: "attached-filename-chip", title: selectedFile.name, children: selectedFile.name }), _jsx("button", { type: "button", className: "btn-postman btn-sm", disabled: uploading, onClick: () => void uploadFile(), children: uploading ? "Uploading…" : "Upload" })] }))] }), _jsx("button", { type: "button", className: "btn-postman", disabled: !selectedTask || postingComment || !commentText.trim(), onClick: () => void postComment(), children: postingComment ? "Posting…" : "Post Comment" })] })] })] })) })] }));
}
