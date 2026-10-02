import React, { useEffect, useMemo, useRef, useState } from "react";
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
  type TapAttachmentItem,
  type TapBlueprintModule,
  type TapTask,
  type TapTaskCommentMention,
  type TapTaskStatus,
  type TapTasksByModule,
} from "../services/tapTasksApi";
import {
  buildStoreSlackDraftContext,
  type SlackRecipientCandidate,
} from "../services/storeSlackHelper";

export interface TapTaskWithAttachment extends Partial<TapTask> {
  taskId: number;
  taskName: string;
  status: TapTaskStatus | string;
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

export type TapTaskDetail = TapTaskWithAttachment;
export type StoreBlueprintTasks = StoreBlueprintTasksCache;

interface Props {
  row: StoreRecord & { fetched_blueprint_tasks?: StoreBlueprintTasksCache };
  onToast: (message: string) => void;
  onOperationalStatusChange: (
    tekionId: string,
    field: "fixed_ops_status" | "variable_ops_status",
    value: CustomPhaseStatus
  ) => Promise<void> | void;
  /** Reports resolved tasks + attachment counts so the Stores table can show them. */
  onTasksSnapshot?: (tekionId: string, tasks: TapTasksByModuleWithAttachment, complete: boolean) => void;
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
  { label: string; operationalName: "Fixed Ops" | "Variable Ops"; icon: string }
> = {
  parts: { label: "Parts", operationalName: "Fixed Ops", icon: "📦" },
  service: { label: "Service", operationalName: "Fixed Ops", icon: "🔧" },
  accounting: { label: "Accounting", operationalName: "Variable Ops", icon: "📊" },
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

function lifecycleButtonLabel(status: TapTaskStatus): string {
  if (status === "new") return "▶ Start Task";
  if (status === "inprogress") return "✓ Mark Completed";
  if (status === "completed") return "✓ Completed";
  return "Duplicate";
}

function calculatePhaseStatus(tasks: TapTaskWithAttachment[]): CustomPhaseStatus {
  const statuses = tasks.map((task) => normalizeStatus(task.status));
  if (statuses.length === 0 || statuses.every((status) => status === "new")) {
    return "TO DO";
  }
  if (statuses.every((status) => status === "completed")) {
    return "Completed";
  }
  return "WIP";
}

function calculateFixedOpsStatus(tasks: TapTasksByModuleWithAttachment): CustomPhaseStatus {
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
  const [commentTemplate, setCommentTemplate] = useState<CommentTemplate>("issue");
  const [commentText, setCommentText] = useState("");
  const [postingComment, setPostingComment] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Resolves primary onboarding_project_id, then falls back to ds_onboarding_project_id
  const resolvedProjectId = resolveStoreProjectId(row);

  const moduleTasks = tasks[activeModule];
  const selectedTask =
    moduleTasks.find((task: TapTaskWithAttachment) => task.taskId === selectedTaskId) ??
    moduleTasks[0] ??
    null;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks]);

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
      const firstModule =
        MODULES.find((m) => cachedFormatted[m].length > 0) ?? "parts";
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

      const formattedResult: TapTasksByModuleWithAttachment = {
        parts: (result.parts || []).map((t: any) => ({
          ...t,
          taskId: Number(t.taskId ?? t.id ?? 0),
          taskName: t.taskName ?? t.name ?? "Task",
          taskAttachmentCount: Number(t.taskAttachmentCount ?? t.attachmentCount ?? 0),
        })),
        service: (result.service || []).map((t: any) => ({
          ...t,
          taskId: Number(t.taskId ?? t.id ?? 0),
          taskName: t.taskName ?? t.name ?? "Task",
          taskAttachmentCount: Number(t.taskAttachmentCount ?? t.attachmentCount ?? 0),
        })),
        accounting: (result.accounting || []).map((t: any) => ({
          ...t,
          taskId: Number(t.taskId ?? t.id ?? 0),
          taskName: t.taskName ?? t.name ?? "Task",
          taskAttachmentCount: Number(t.taskAttachmentCount ?? t.attachmentCount ?? 0),
        })),
      };

      setTasks(formattedResult);

      const firstModule =
        MODULES.find((module) => formattedResult[module].length > 0) ?? "parts";
      setActiveModule(firstModule);
      setSelectedTaskId(formattedResult[firstModule][0]?.taskId ?? null);

      if (
        !formattedResult.parts.length &&
        !formattedResult.service.length &&
        !formattedResult.accounting.length
      ) {
        onToast("⚠ No matching DS - Onboarding blueprint tasks were found.");
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        [activeModule]: tasks[activeModule].map((item: TapTaskWithAttachment) =>
          item.taskId === task.taskId ? { ...item, status: updatedStatus } : item
        ),
      };

      setTasks(nextTasks);
      await applyDerivedOperationalStatuses(nextTasks);

      onToast(
        `✅ ${moduleMeta[activeModule].label} task updated to ${
          updatedStatus === "inprogress" ? "In Progress" : "Completed"
        }`
      );
    } catch (error) {
      console.error("[DealerTasksPanel] TAP task status update failed", error);
      onToast("❌ TAP task functions is not working");
    } finally {
      setBusyTaskId(null);
    }
  };

  const applyTemplate = (template: CommentTemplate) => {
    setCommentTemplate(template);
    setCommentText(defaultComment(activeModule, template, recipients));
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
      onToast("✅ TAP comment posted");
    } catch (error) {
      console.error("[DealerTasksPanel] TAP comment post failed", error);
      onToast("❌ TAP task functions is not working");
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
      console.error("[DealerTasksPanel] TAP attachment upload failed", error);
      onToast("❌ TAP task functions is not working");
    } finally {
      setUploading(false);
    }
  };

  const currentAttachmentCount =
    selectedTask?.attachments?.length ?? selectedTask?.taskAttachmentCount ?? 0;

  return (
    <div className="tasks-shell-grid">
      <aside className="tasks-module-nav">
        {MODULES.map((module) => {
          const count = tasks[module].length;
          const isCompleted =
            count > 0 &&
            tasks[module].every((t) => normalizeStatus(t.status) === "completed");

          return (
            <button
              key={module}
              type="button"
              className={`module-nav-btn ${activeModule === module ? "active" : ""}`}
              onClick={() => setActiveModule(module)}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span>{moduleMeta[module].icon}</span>
                <span>{moduleMeta[module].label}</span>
              </span>
              <span className="module-badge-count">
                {isCompleted ? "✓" : count}
              </span>
            </button>
          );
        })}

        <div style={{ marginTop: "auto", paddingTop: 10 }}>
          <button
            type="button"
            className="btn-secondary btn-sm"
            style={{ width: "100%", justifyContent: "center" }}
            disabled={loading}
            onClick={() => void loadTasks(true)}
          >
            {loading ? "Loading…" : "↻ Reload"}
          </button>
        </div>
      </aside>

      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {loading ? (
          <div style={{ color: "#94a3b8", padding: 30, textAlign: "center" }}>
            Loading blueprint tasks…
          </div>
        ) : !moduleTasks.length ? (
          <div
            style={{
              color: "#94a3b8",
              padding: 40,
              border: "1px dashed rgba(255, 255, 255, 0.12)",
              borderRadius: 12,
              textAlign: "center",
            }}
          >
            No active {moduleMeta[activeModule].label} blueprint configuration tasks found.
          </div>
        ) : (
          <>
            {moduleTasks.length > 1 && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  overflowX: "auto",
                  paddingBottom: 6,
                }}
              >
                {moduleTasks.map((t) => {
                  const isSelected = selectedTask?.taskId === t.taskId;
                  const attCount =
                    t.attachments?.length ?? t.taskAttachmentCount ?? 0;
                  return (
                    <button
                      key={t.taskId}
                      type="button"
                      onClick={() => setSelectedTaskId(t.taskId)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        background: isSelected
                          ? "rgba(56, 189, 248, 0.16)"
                          : "rgba(30, 41, 59, 0.5)",
                        border: `1px solid ${
                          isSelected
                            ? "rgba(56, 189, 248, 0.4)"
                            : "rgba(148, 163, 184, 0.15)"
                        }`,
                        color: isSelected ? "#38bdf8" : "#94a3b8",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        whiteSpace: "nowrap",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      <span>#{t.taskId}</span>
                      <span
                        style={{
                          maxWidth: 140,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {t.taskName}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          padding: "1px 5px",
                          borderRadius: 4,
                          background:
                            attCount > 0
                              ? "rgba(56, 189, 248, 0.25)"
                              : "rgba(148, 163, 184, 0.15)",
                          color: attCount > 0 ? "#38bdf8" : "#94a3b8",
                        }}
                      >
                        📎 {attCount}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {selectedTask && (
              <div className="task-hero-card">
                <div className="task-hero-top">
                  <div>
                    <div className="task-hero-title">
                      <span className="task-id-tag">#{selectedTask.taskId}</span>
                      {selectedTask.taskName}
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        marginTop: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ fontSize: 11, color: "#64748b" }}>
                        Notify Lead:{" "}
                        <strong style={{ color: "#38bdf8" }}>
                          {recipients.map((r) => r.name).join(", ") || "None assigned"}
                        </strong>
                      </div>

                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "3px 8px",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          lineHeight: 1,
                          background:
                            currentAttachmentCount > 0
                              ? "rgba(56, 189, 248, 0.18)"
                              : "rgba(148, 163, 184, 0.12)",
                          color: currentAttachmentCount > 0 ? "#38bdf8" : "#94a3b8",
                          border: `1px solid ${
                            currentAttachmentCount > 0
                              ? "rgba(56, 189, 248, 0.35)"
                              : "rgba(148, 163, 184, 0.2)"
                          }`,
                        }}
                      >
                        <span>📎</span>
                        <span>
                          {loadingAttachments
                            ? "Checking..."
                            : `${currentAttachmentCount} ${
                                currentAttachmentCount === 1
                                  ? "Attachment"
                                  : "Attachments"
                              }`}
                        </span>
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn-postman task-lifecycle-btn"
                    disabled={
                      !nextStatus(normalizeStatus(selectedTask.status)) ||
                      busyTaskId === selectedTask.taskId
                    }
                    onClick={() => void changeTaskStatus(selectedTask)}
                  >
                    {busyTaskId === selectedTask.taskId
                      ? "Updating…"
                      : lifecycleButtonLabel(normalizeStatus(selectedTask.status))}
                  </button>
                </div>

                {selectedTask.attachments && selectedTask.attachments.length > 0 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      marginTop: 10,
                      padding: "8px 10px",
                      borderRadius: 6,
                      background: "rgba(15, 23, 42, 0.5)",
                      border: "1px solid rgba(56, 189, 248, 0.2)",
                    }}
                  >
                    {selectedTask.attachments.map((att) => (
                      <a
                        key={att.id}
                        href={att.link}
                        target="_blank"
                        rel="noreferrer"
                        title="Click to view/download file"
                        style={{
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
                        }}
                      >
                        <span>📄</span>
                        <span>{att.name}</span>
                        <span style={{ fontSize: 9, opacity: 0.7 }}>↗</span>
                      </a>
                    ))}
                  </div>
                )}

                {selectedTask.descriptionPlain && (
                  <div
                    style={{
                      color: "#94a3b8",
                      fontSize: 12,
                      lineHeight: 1.4,
                      marginTop: 8,
                    }}
                  >
                    {selectedTask.descriptionPlain}
                  </div>
                )}
              </div>
            )}

            <div className="task-composer-card">
              <div className="composer-toolbar">
                <div className="composer-template-pills">
                  <button
                    type="button"
                    className={`template-pill-btn ${
                      commentTemplate === "issue" ? "active" : ""
                    }`}
                    onClick={() => applyTemplate("issue")}
                  >
                    ⚠ Flag Issue
                  </button>
                  <button
                    type="button"
                    className={`template-pill-btn ${
                      commentTemplate === "completed" ? "active" : ""
                    }`}
                    onClick={() => applyTemplate("completed")}
                  >
                    ✓ Completion Note
                  </button>
                </div>
                <span style={{ fontSize: 11, color: "#64748b" }}>
                  Backspace <strong>@Name</strong> to post without notifying
                </span>
              </div>

              <textarea
                className="composer-textarea"
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
              />

              <div className="composer-footer">
                <div className="attach-action-wrap">
                  <input
                    ref={fileInputRef}
                    id={`file-picker-${row.tekion_id}`}
                    type="file"
                    hidden
                    disabled={!selectedTask || uploading}
                    onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                  />
                  <label
                    htmlFor={`file-picker-${row.tekion_id}`}
                    className="btn-secondary btn-sm"
                    style={{ cursor: "pointer" }}
                  >
                    📎 {selectedFile ? "Change File" : "Attach File"}
                  </label>

                  {selectedFile && (
                    <>
                      <span className="attached-filename-chip" title={selectedFile.name}>
                        {selectedFile.name}
                      </span>
                      <button
                        type="button"
                        className="btn-postman btn-sm"
                        disabled={uploading}
                        onClick={() => void uploadFile()}
                      >
                        {uploading ? "Uploading…" : "Upload"}
                      </button>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  className="btn-postman"
                  disabled={!selectedTask || postingComment || !commentText.trim()}
                  onClick={() => void postComment()}
                >
                  {postingComment ? "Posting…" : "Post Comment"}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}