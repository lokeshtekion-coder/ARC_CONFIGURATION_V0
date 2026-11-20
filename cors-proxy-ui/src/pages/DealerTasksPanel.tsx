/**
 * DealerTasksPanel Component (Spacious, Clean Layout with ProseMirror Parser)
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  resolveStoreProjectId,
  type CustomPhaseStatus,
  type StoreRecord,
} from "../services/storesDb";
import {
  fetchTapBlueprintTasks,
  postTapTaskComment,
  updateTapTaskStatus,
  uploadTapTaskAttachment,
  fetchTaskAttachments,
  fetchTaskAttachmentsOrNull,
  fetchTapTaskComments,
  formatDueDateInfo,
  type TapAttachmentItem,
  type TapBlueprintModule,
  type TapTask,
  type TapTaskCommentMention,
  type TapTaskStatus,
  type TapTaskCommentItem,
} from "../services/tapTasksApi";
import {
  buildStoreSlackDraftContext,
  type SlackRecipientCandidate,
} from "../services/storeSlackHelper";

export interface TapTaskWithAttachment extends Partial<TapTask> {
  taskId: number;
  taskName: string;
  status: TapTaskStatus | string;
  dueDate?: number | null;
  taskAttachmentCount?: number;
  attachments?: TapAttachmentItem[];
  id?: string;
  name?: string;
}

export type TapTasksByModuleWithAttachment = Record<
  TapBlueprintModule,
  TapTaskWithAttachment[]
>;

export interface StoreBlueprintTasksCache {
  partsTasks?: TapTaskWithAttachment[];
  serviceTasks?: TapTaskWithAttachment[];
  accountingTasks?: TapTaskWithAttachment[];
  fetchedAt?: string;
}

// Aliases exported for backward compatibility across Stores.tsx and DealerMetaModal
export type StoreBlueprintTasks = StoreBlueprintTasksCache;
export type TapTaskDetail = TapTaskWithAttachment;

interface Props {
  row: StoreRecord & { fetched_blueprint_tasks?: StoreBlueprintTasksCache };
  onToast: (message: string) => void;
  onOperationalStatusChange: (
    tekionId: string,
    field: "fixed_ops_status" | "variable_ops_status",
    value: CustomPhaseStatus
  ) => Promise<void> | void;
  onTasksSnapshot?: (
    tekionId: string,
    tasks: TapTasksByModuleWithAttachment,
    complete: boolean
  ) => void;
}

type CommentTemplate = "issue" | "completed";

const EMPTY_TASKS: TapTasksByModuleWithAttachment = {
  parts: [],
  service: [],
  accounting: [],
};

const MODULES: TapBlueprintModule[] = ["parts", "service", "accounting"];

const moduleMeta: Record<
  TapBlueprintModule,
  { label: string; operationalName: "Fixed Ops" | "Variable Ops" }
> = {
  parts: { label: "Parts", operationalName: "Fixed Ops" },
  service: { label: "Service", operationalName: "Fixed Ops" },
  accounting: { label: "Accounting", operationalName: "Variable Ops" },
};

function normalizeStatus(status?: string): TapTaskStatus {
  const value = String(status ?? "new").trim().toLowerCase();
  if (value === "inprogress" || value === "completed" || value === "duplicate") {
    return value;
  }
  return "new";
}

function nextStatus(status: TapTaskStatus): "inprogress" | "completed" | null {
  if (status === "new") return "inprogress";
  if (status === "inprogress") return "completed";
  return null;
}

function calculatePhaseStatus(tasks: TapTaskWithAttachment[]): CustomPhaseStatus {
  const statuses = tasks.map((task) => normalizeStatus(task.status));
  if (statuses.length === 0 || statuses.every((status) => status === "new")) return "TO DO";
  if (statuses.every((status) => status === "completed")) return "Completed";
  return "WIP";
}

function calculateFixedOpsStatus(tasks: TapTasksByModuleWithAttachment): CustomPhaseStatus {
  const partsStatus = calculatePhaseStatus(tasks.parts);
  const serviceStatus = calculatePhaseStatus(tasks.service);
  if (partsStatus === "Completed" && serviceStatus === "Completed") return "Completed";
  if (partsStatus === "TO DO" && serviceStatus === "TO DO") return "TO DO";
  return "WIP";
}

function recipientsForModule(
  row: StoreRecord,
  module: TapBlueprintModule
): TapTaskCommentMention[] {
  const context = buildStoreSlackDraftContext(row);
  const seen = new Set<string>();
  const mentions: TapTaskCommentMention[] = [];

  const targetKeys =
    module === "accounting"
      ? ["variableopspod", "accounting"]
      : ["fixedopspod", "fixed", "parts", "service"];

  for (const recipient of context.recipients as SlackRecipientCandidate[]) {
    const keyLower = recipient.key.toLowerCase();
    const labelLower = recipient.label.toLowerCase();
    const matchesModule = targetKeys.some(
      (term) => keyLower.includes(term) || labelLower.includes(term)
    );

    if (!matchesModule) continue;

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

function defaultComment(
  module: TapBlueprintModule,
  template: CommentTemplate,
  mentions: TapTaskCommentMention[] = []
): string {
  const mentionPrefix =
    mentions.length > 0 ? mentions.map((m) => `@${m.name}`).join(" ") + " " : "";

  if (template === "issue") {
    return `${mentionPrefix}We have encountered below issues kindly look into these.\n\nNotes:`;
  }

  return `${mentionPrefix}We have completed the ${moduleMeta[module].operationalName} for this dealer.\n\nNotes:`;
}

export default function DealerTasksPanel({
  row,
  onToast,
  onOperationalStatusChange,
  onTasksSnapshot,
}: Props) {
  const [tasks, setTasks] = useState<TapTasksByModuleWithAttachment>(EMPTY_TASKS);
  const [activeModule, setActiveModule] = useState<TapBlueprintModule>("parts");
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);

  // Comments feed
  const [comments, setComments] = useState<TapTaskCommentItem[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);

  // Composer
  const [commentTemplate, setCommentTemplate] = useState<CommentTemplate>("issue");
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);

  // Uploads
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resolvedProjectId = resolveStoreProjectId(row);
  const moduleTasks = tasks[activeModule];
  const selectedTask =
    moduleTasks.find((task) => task.taskId === selectedTaskId) ?? moduleTasks[0] ?? null;

  const dealerContext = useMemo(
    () => ({
      tenantId: row.tenant_id,
      dealerId: row.dealer_id,
      tenantCode: row.tenant_code,
    }),
    [row.tenant_id, row.dealer_id, row.tenant_code]
  );

  const recipients = useMemo(
    () => recipientsForModule(row, activeModule),
    [row, activeModule]
  );

  const dueInfo = useMemo(
    () => formatDueDateInfo(selectedTask?.dueDate),
    [selectedTask?.dueDate]
  );

  const loadCommentsForCurrentTask = useCallback(
    async (taskId?: number) => {
      if (!taskId) {
        setComments([]);
        return;
      }
      setLoadingComments(true);
      try {
        const items = await fetchTapTaskComments(taskId, dealerContext);
        setComments(items);
      } catch (err) {
        console.warn("[DealerTasksPanel] Failed loading comments", err);
        setComments([]);
      } finally {
        setLoadingComments(false);
      }
    },
    [dealerContext]
  );

  useEffect(() => {
    if (selectedTask?.taskId) {
      void loadCommentsForCurrentTask(selectedTask.taskId);
    } else {
      setComments([]);
    }
  }, [selectedTask?.taskId, loadCommentsForCurrentTask]);

  // Scan and hydrate attachments in background
  useEffect(() => {
    const pending: Array<{ module: TapBlueprintModule; taskId: number }> = [];
    for (const m of MODULES) {
      for (const t of tasks[m]) {
        if (t.attachments === undefined && t.taskId) pending.push({ module: m, taskId: t.taskId });
      }
    }
    if (pending.length === 0) return;

    let isCancelled = false;
    setLoadingAttachments(true);

    void (async () => {
      for (const item of pending) {
        if (isCancelled) return;
        const items = await fetchTaskAttachmentsOrNull(item.taskId, dealerContext);
        if (isCancelled) return;
        if (items === null) continue;
        setTasks((prev) => ({
          ...prev,
          [item.module]: prev[item.module].map((t) =>
            t.taskId === item.taskId
              ? { ...t, attachments: items, taskAttachmentCount: items.length }
              : t
          ),
        }));
      }
      if (!isCancelled) setLoadingAttachments(false);
    })();

    return () => {
      isCancelled = true;
    };
  }, [tasks, dealerContext]);

  useEffect(() => {
    const all = [...tasks.parts, ...tasks.service, ...tasks.accounting];
    if (all.length === 0 || !onTasksSnapshot) return;
    const complete = all.every((t) => t.attachments !== undefined);
    const anyLoaded = all.some((t) => t.attachments !== undefined);
    if (anyLoaded) onTasksSnapshot(row.tekion_id, tasks, complete);
  }, [tasks, onTasksSnapshot, row.tekion_id]);

  const loadTasks = async (forceRemote = false) => {
    if (
      !forceRemote &&
      row.fetched_blueprint_tasks &&
      (row.fetched_blueprint_tasks.partsTasks?.length ||
        row.fetched_blueprint_tasks.serviceTasks?.length ||
        row.fetched_blueprint_tasks.accountingTasks?.length)
    ) {
      const cached = row.fetched_blueprint_tasks;
      const cachedFormatted: TapTasksByModuleWithAttachment = {
        parts: (cached.partsTasks || []).map((t) => ({
          ...t,
          taskId: Number(t.taskId ?? t.id ?? 0),
          taskName: t.taskName ?? t.name ?? "Task",
          status: t.status ?? "new",
          dueDate: t.dueDate ?? null,
          taskAttachmentCount: Number(t.taskAttachmentCount ?? t.attachments?.length ?? 0),
          attachments: t.attachments,
        })),
        service: (cached.serviceTasks || []).map((t) => ({
          ...t,
          taskId: Number(t.taskId ?? t.id ?? 0),
          taskName: t.taskName ?? t.name ?? "Task",
          status: t.status ?? "new",
          dueDate: t.dueDate ?? null,
          taskAttachmentCount: Number(t.taskAttachmentCount ?? t.attachments?.length ?? 0),
          attachments: t.attachments,
        })),
        accounting: (cached.accountingTasks || []).map((t) => ({
          ...t,
          taskId: Number(t.taskId ?? t.id ?? 0),
          taskName: t.taskName ?? t.name ?? "Task",
          status: t.status ?? "new",
          dueDate: t.dueDate ?? null,
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
      onToast("❌ This dealer does not have a TAP project ID.");
      return;
    }

    setLoading(true);
    try {
      // In popup refresh: always check if there is an indexed cache, otherwise discovers live
      const result = await fetchTapBlueprintTasks(
        resolvedProjectId,
        dealerContext,
        row.ds_onboarding_project_id,
        forceRemote ? null : row.blueprint_task_index
      );

      const tasksMap = result.tasks;

      const formattedResult: TapTasksByModuleWithAttachment = {
        parts: (tasksMap.parts || []).map((t: any) => ({
          ...t,
          taskId: Number(t.taskId ?? t.id ?? 0),
          taskName: t.taskName ?? t.name ?? "Task",
          dueDate: t.dueDate ?? null,
          taskAttachmentCount: Number(t.taskAttachmentCount ?? t.attachmentCount ?? 0),
        })),
        service: (tasksMap.service || []).map((t: any) => ({
          ...t,
          taskId: Number(t.taskId ?? t.id ?? 0),
          taskName: t.taskName ?? t.name ?? "Task",
          dueDate: t.dueDate ?? null,
          taskAttachmentCount: Number(t.taskAttachmentCount ?? t.attachmentCount ?? 0),
        })),
        accounting: (tasksMap.accounting || []).map((t: any) => ({
          ...t,
          taskId: Number(t.taskId ?? t.id ?? 0),
          taskName: t.taskName ?? t.name ?? "Task",
          dueDate: t.dueDate ?? null,
          taskAttachmentCount: Number(t.taskAttachmentCount ?? t.attachmentCount ?? 0),
        })),
      };

      setTasks(formattedResult);
      const firstModule = MODULES.find((module) => formattedResult[module].length > 0) ?? "parts";
      setActiveModule(firstModule);
      setSelectedTaskId(formattedResult[firstModule][0]?.taskId ?? null);
    } catch (error) {
      console.error("[DealerTasksPanel] TAP task load failed", error);
      onToast("❌ TAP task functions is not working");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setTasks(EMPTY_TASKS);
    setActiveModule("parts");
    setSelectedTaskId(null);
    setCommentTemplate("issue");
    void loadTasks(false);
  }, [row.tekion_id, resolvedProjectId]);

  useEffect(() => {
    const firstTask = tasks[activeModule][0];
    setSelectedTaskId(firstTask?.taskId ?? null);
    setCommentText(defaultComment(activeModule, commentTemplate, recipients));
  }, [activeModule, commentTemplate, recipients, tasks]);

  const applyDerivedOperationalStatuses = async (
    nextTasks: TapTasksByModuleWithAttachment
  ) => {
    await onOperationalStatusChange(
      row.tekion_id,
      "fixed_ops_status",
      calculateFixedOpsStatus(nextTasks)
    );
    await onOperationalStatusChange(
      row.tekion_id,
      "variable_ops_status",
      calculatePhaseStatus(nextTasks.accounting)
    );
  };

  const changeTaskStatus = async (task: TapTaskWithAttachment) => {
    const currentStatus = normalizeStatus(task.status);
    const updatedStatus = nextStatus(currentStatus);
    if (!updatedStatus) return;

    setBusyTaskId(task.taskId);
    try {
      await updateTapTaskStatus(task.taskId, updatedStatus, dealerContext);

      const nextTasks: TapTasksByModuleWithAttachment = {
        ...tasks,
        [activeModule]: tasks[activeModule].map((item) =>
          item.taskId === task.taskId ? { ...item, status: updatedStatus } : item
        ),
      };

      setTasks(nextTasks);
      await applyDerivedOperationalStatuses(nextTasks);
      onToast(`✅ Updated to ${updatedStatus === "inprogress" ? "In Progress" : "Completed"}`);
    } catch (error) {
      console.error("[DealerTasksPanel] Status update failed", error);
      onToast("❌ Status update failed");
    } finally {
      setBusyTaskId(null);
    }
  };

  const postComment = async () => {
    if (!selectedTask || !commentText.trim()) return;

    setPostingComment(true);
    const activeMentions = recipients.filter(
      (r) =>
        commentText.toLowerCase().includes(`@${r.name.toLowerCase()}`) ||
        commentText.toLowerCase().includes(r.name.toLowerCase())
    );

    try {
      await postTapTaskComment(
        selectedTask.taskId,
        commentText,
        activeMentions,
        dealerContext
      );
      onToast("✅ Comment posted to TAP");
      setCommentText(defaultComment(activeModule, commentTemplate, recipients));
      void loadCommentsForCurrentTask(selectedTask.taskId);
    } catch (error) {
      console.error("[DealerTasksPanel] Post comment failed", error);
      onToast("❌ Failed to post comment");
    } finally {
      setPostingComment(false);
    }
  };

  const uploadFile = async () => {
    if (!selectedFile || !selectedTask) return;

    setUploading(true);
    try {
      await uploadTapTaskAttachment(selectedTask.taskId, selectedFile, dealerContext);
      onToast(`✅ Uploaded ${selectedFile.name}`);

      const freshAttachments = await fetchTaskAttachments(
        selectedTask.taskId,
        dealerContext
      );

      setTasks((prev) => ({
        ...prev,
        [activeModule]: prev[activeModule].map((item) =>
          item.taskId === selectedTask.taskId
            ? {
                ...item,
                attachments: freshAttachments,
                taskAttachmentCount: freshAttachments.length,
              }
            : item
        ),
      }));

      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error) {
      console.error("[DealerTasksPanel] Upload failed", error);
      onToast("❌ Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const currentAttachmentCount =
    selectedTask?.attachments?.length ?? selectedTask?.taskAttachmentCount ?? 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 640,
        background: "#0a0f1d",
        color: "#f1f5f9",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* 1. TOP HEADER NAVIGATION */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 24px",
          borderBottom: "1px solid #1e293b",
          background: "#0d1424",
        }}
      >
        <div style={{ display: "flex", gap: 10 }}>
          {MODULES.map((module) => {
            const count = tasks[module].length;
            const isCompleted =
              count > 0 && tasks[module].every((t) => normalizeStatus(t.status) === "completed");
            const isActive = activeModule === module;

            return (
              <button
                key={module}
                type="button"
                onClick={() => setActiveModule(module)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 16px",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: isActive ? "1px solid #475569" : "1px solid transparent",
                  background: isActive ? "#1e293b" : "transparent",
                  color: isActive ? "#f8fafc" : "#94a3b8",
                  transition: "all 0.15s ease",
                }}
              >
                <span>{moduleMeta[module].label}</span>
                <span
                  style={{
                    padding: "2px 7px",
                    borderRadius: 12,
                    fontSize: 11,
                    fontWeight: 700,
                    background: isCompleted ? "rgba(34, 197, 94, 0.16)" : "#1e293b",
                    color: isCompleted ? "#4ade80" : "#94a3b8",
                  }}
                >
                  {isCompleted ? "✓" : count}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void loadTasks(true)}
          disabled={loading}
          style={{
            background: "#1e293b",
            border: "1px solid #334155",
            color: "#cbd5e1",
            borderRadius: 6,
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {loading ? "Refreshing..." : "↻ Reload"}
        </button>
      </div>

      {/* 2. SUB-TASK PILL BAR */}
      {moduleTasks.length > 1 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "10px 24px",
            background: "#080c17",
            borderBottom: "1px solid #1e293b",
            overflowX: "auto",
          }}
        >
          {moduleTasks.map((t) => {
            const isSelected = selectedTask?.taskId === t.taskId;
            const tDue = formatDueDateInfo(t.dueDate);
            const isDone = normalizeStatus(t.status) === "completed";

            return (
              <button
                key={t.taskId}
                type="button"
                onClick={() => setSelectedTaskId(t.taskId)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 12px",
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: isSelected ? 600 : 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  background: isSelected ? "#1e293b" : "#101726",
                  border: isSelected ? "1px solid #475569" : "1px solid #1e293b",
                  color: isSelected ? "#f8fafc" : "#94a3b8",
                }}
              >
                <span style={{ color: "#64748b" }}>#{t.taskId}</span>
                <span style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{t.taskName}</span>
                {tDue?.isOverdue && !isDone && (
                  <span style={{ color: "#f87171", fontSize: 10, fontWeight: 700 }}>OVERDUE</span>
                )}
                {isDone && <span style={{ color: "#4ade80", fontSize: 10 }}>✓</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* 3. DUAL-PANE BODY */}
      {loading ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 14 }}>
          Loading task data...
        </div>
      ) : !selectedTask ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b", fontSize: 14 }}>
          No active tasks found in {moduleMeta[activeModule].label}.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1.15fr 1fr", flex: 1, minHeight: 0 }}>
          {/* LEFT COLUMN: Metadata, Schedule, Attachments */}
          <div
            style={{
              padding: "24px 28px",
              borderRight: "1px solid #1e293b",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 20,
            }}
          >
            {/* Task Info */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", background: "#1e293b", padding: "2px 8px", borderRadius: 4 }}>
                  TASK #{selectedTask.taskId}
                </span>
                <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>
                  {moduleMeta[activeModule].operationalName}
                </span>
              </div>
              <h2 style={{ margin: "0 0 10px 0", fontSize: 19, fontWeight: 700, color: "#f8fafc", lineHeight: 1.3 }}>
                {selectedTask.taskName}
              </h2>
              {selectedTask.descriptionPlain && (
                <p style={{ margin: 0, fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>
                  {selectedTask.descriptionPlain}
                </p>
              )}
            </div>

            {/* Schedule & Action Card */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "16px 20px",
                borderRadius: 8,
                background: "#111827",
                border: "1px solid #1e293b",
                gap: 14,
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>
                  Due Date Schedule
                </span>
                {dueInfo ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
                    {dueInfo.isOverdue ? (
                      <span
                        style={{
                          background: "rgba(239, 68, 68, 0.15)",
                          color: "#f87171",
                          border: "1px solid rgba(239, 68, 68, 0.3)",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        ⚠️ Overdue by {Math.abs(dueInfo.daysRemaining)} days
                      </span>
                    ) : (
                      <span style={{ color: "#cbd5e1" }}>📅 {dueInfo.formattedDate}</span>
                    )}
                    <span style={{ color: "#64748b", fontSize: 12 }}>({dueInfo.formattedDate})</span>
                  </div>
                ) : (
                  <span style={{ fontSize: 13, color: "#64748b" }}>No due date specified</span>
                )}
              </div>

              {/* Status Transition Button */}
              <button
                type="button"
                disabled={!nextStatus(normalizeStatus(selectedTask.status)) || busyTaskId === selectedTask.taskId}
                onClick={() => void changeTaskStatus(selectedTask)}
                style={{
                  padding: "8px 18px",
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  border: "none",
                  background:
                    normalizeStatus(selectedTask.status) === "completed"
                      ? "rgba(34, 197, 94, 0.15)"
                      : "#2563eb",
                  color: normalizeStatus(selectedTask.status) === "completed" ? "#4ade80" : "#ffffff",
                }}
              >
                {busyTaskId === selectedTask.taskId
                  ? "Saving..."
                  : normalizeStatus(selectedTask.status) === "new"
                  ? "Start Task"
                  : normalizeStatus(selectedTask.status) === "inprogress"
                  ? "Mark Completed"
                  : "✓ Completed"}
              </button>
            </div>

            {/* Attachments Section */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#cbd5e1" }}>
                  Attachments ({currentAttachmentCount})
                </span>
                {loadingAttachments && <span style={{ fontSize: 12, color: "#64748b" }}>Checking files...</span>}
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  padding: "14px 16px",
                  borderRadius: 8,
                  background: "#111827",
                  border: "1px solid #1e293b",
                }}
              >
                {selectedTask.attachments && selectedTask.attachments.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {selectedTask.attachments.map((att) => (
                      <a
                        key={att.id}
                        href={att.link}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "6px 12px",
                          borderRadius: 6,
                          background: "#1e293b",
                          border: "1px solid #334155",
                          color: "#cbd5e1",
                          textDecoration: "none",
                          fontSize: 12,
                          fontWeight: 500,
                        }}
                      >
                        <span>📄</span>
                        <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {att.name}
                        </span>
                        <span style={{ fontSize: 10, color: "#64748b" }}>↗</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: "#64748b", padding: "4px 0" }}>
                    No attachments uploaded to this task.
                  </div>
                )}

                {/* Upload Action */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, paddingTop: 10, borderTop: "1px solid #1e293b" }}>
                  <input
                    ref={fileInputRef}
                    id={`file-picker-${row.tekion_id}`}
                    type="file"
                    hidden
                    disabled={uploading}
                    onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                  />
                  <label
                    htmlFor={`file-picker-${row.tekion_id}`}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      background: "#1e293b",
                      border: "1px solid #334155",
                      fontSize: 12,
                      cursor: "pointer",
                      fontWeight: 600,
                      color: "#cbd5e1",
                    }}
                  >
                    {selectedFile ? "Change File" : "+ Attach Document"}
                  </label>

                  {selectedFile && (
                    <>
                      <span style={{ fontSize: 12, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
                        {selectedFile.name}
                      </span>
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={() => void uploadFile()}
                        style={{
                          padding: "6px 14px",
                          borderRadius: 6,
                          background: "#2563eb",
                          color: "#fff",
                          border: "none",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {uploading ? "Uploading..." : "Upload"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Conversation Stream */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              background: "#080c17",
              height: "100%",
            }}
          >
            {/* Feed Header */}
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid #1e293b",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Task Comments ({comments.length})
              </span>
              {loadingComments && <span style={{ fontSize: 12, color: "#64748b" }}>Loading comments...</span>}
            </div>

            {/* Scrollable Conversation Thread */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              {!loadingComments && comments.length === 0 ? (
                <div style={{ textAlign: "center", color: "#64748b", fontSize: 13, margin: "auto 0" }}>
                  No comments posted on this task yet.
                </div>
              ) : (
                comments.map((item, idx) => {
                  const author =
                    typeof item.createdBy === "object"
                      ? item.createdBy.name || item.createdBy.email || "Tekion User"
                      : item.createdBy || "Tekion User";

                  const timeStr = item.createdAt
                    ? new Date(item.createdAt < 10000000000 ? item.createdAt * 1000 : item.createdAt).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "";

                  return (
                    <div
                      key={item.id || idx}
                      style={{
                        padding: "12px 14px",
                        borderRadius: 8,
                        background: "#111827",
                        border: "1px solid #1e293b",
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{author}</span>
                        {timeStr && <span style={{ fontSize: 11, color: "#64748b" }}>{timeStr}</span>}
                      </div>

                      <div
                        style={{
                          fontSize: 13,
                          color: "#cbd5e1",
                          lineHeight: 1.5,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {item.content}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Anchored Composer Area */}
            <div
              style={{
                padding: "16px 20px",
                borderTop: "1px solid #1e293b",
                background: "#0d1424",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              {/* Template Buttons */}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setCommentTemplate("issue");
                    setCommentText(defaultComment(activeModule, "issue", recipients));
                  }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    background: commentTemplate === "issue" ? "rgba(239, 68, 68, 0.15)" : "#1e293b",
                    color: commentTemplate === "issue" ? "#f87171" : "#94a3b8",
                    border: "1px solid #334155",
                  }}
                >
                  Flag Issue
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCommentTemplate("completed");
                    setCommentText(defaultComment(activeModule, "completed", recipients));
                  }}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: "pointer",
                    background: commentTemplate === "completed" ? "rgba(34, 197, 94, 0.15)" : "#1e293b",
                    color: commentTemplate === "completed" ? "#4ade80" : "#94a3b8",
                    border: "1px solid #334155",
                  }}
                >
                  Note Complete
                </button>
              </div>

              <textarea
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="Write a comment or tag team members..."
                rows={3}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: "#080c17",
                  color: "#f8fafc",
                  border: "1px solid #334155",
                  borderRadius: 6,
                  padding: "10px",
                  fontSize: 13,
                  outline: "none",
                  resize: "none",
                  lineHeight: 1.4,
                }}
              />

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  disabled={postingComment || !commentText.trim()}
                  onClick={() => void postComment()}
                  style={{
                    padding: "8px 18px",
                    borderRadius: 6,
                    background: "#2563eb",
                    color: "#ffffff",
                    border: "none",
                    fontWeight: 600,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {postingComment ? "Posting..." : "Post Comment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}