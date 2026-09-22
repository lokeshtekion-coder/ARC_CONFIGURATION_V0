import React, { useEffect, useMemo, useRef, useState } from "react";
import type { CustomPhaseStatus, StoreRecord } from "./storesDb";
import {
  fetchTapBlueprintTasks,
  postTapTaskComment,
  updateTapTaskStatus,
  uploadTapTaskAttachment,
  type TapBlueprintModule,
  type TapTask,
  type TapTaskCommentMention,
  type TapTaskStatus,
  type TapTasksByModule,
} from "./tapTasksApi";
import {
  buildStoreSlackDraftContext,
  type SlackRecipientCandidate,
} from "./storeSlackHelper";

interface Props {
  row: StoreRecord;
  onToast: (message: string) => void;
  onOperationalStatusChange: (
    tekionId: string,
    field: "fixed_ops_status" | "variable_ops_status",
    value: CustomPhaseStatus
  ) => Promise<void> | void;
}

type CommentTemplate = "issue" | "completed";

const EMPTY_TASKS: TapTasksByModule = {
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

function lifecycleButtonLabel(status: TapTaskStatus): string {
  if (status === "new") return "Start Task";
  if (status === "inprogress") return "Mark Completed";
  if (status === "completed") return "Completed ✓";
  return "Duplicate";
}

function calculatePhaseStatus(tasks: TapTask[]): CustomPhaseStatus {
  const statuses = tasks.map((task) => normalizeStatus(task.status));

  if (statuses.length === 0 || statuses.every((status) => status === "new")) {
    return "TO DO";
  }
  if (statuses.every((status) => status === "completed")) {
    return "Completed";
  }
  return "WIP";
}

function calculateFixedOpsStatus(tasks: TapTasksByModule): CustomPhaseStatus {
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
  const searchTerms = module === "accounting" ? ["accounting"] : ["fixed", "parts", "service"];
  const seen = new Set<string>();
  const mentions: TapTaskCommentMention[] = [];

  for (const recipient of context.recipients as SlackRecipientCandidate[]) {
    const lookupText = `${recipient.key} ${recipient.label}`.toLowerCase();
    if (!searchTerms.some((term) => lookupText.includes(term))) continue;

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

function defaultComment(module: TapBlueprintModule, template: CommentTemplate): string {
  if (template === "issue") {
    return "We have encountered below issues kindly look into these.\n\nNotes:";
  }

  return `We have completed the ${moduleMeta[module].operationalName} for this dealer.\n\nNotes:`;
}

function statusStyle(status: TapTaskStatus): React.CSSProperties {
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

export default function DealerTasksPanel({
  row,
  onToast,
  onOperationalStatusChange,
}: Props) {
  const [tasks, setTasks] = useState<TapTasksByModule>(EMPTY_TASKS);
  const [activeModule, setActiveModule] = useState<TapBlueprintModule>("parts");
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<number | null>(null);
  const [commentTemplate, setCommentTemplate] = useState<CommentTemplate>("issue");
  const [commentText, setCommentText] = useState(defaultComment("parts", "issue"));
  const [postingComment, setPostingComment] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onboardingProjectId = row.onboarding_project_id?.trim() || "";
  const moduleTasks = tasks[activeModule];
  const selectedTask =
    moduleTasks.find((task: TapTask) => task.taskId === selectedTaskId) ??
    moduleTasks[0] ??
    null;

  const recipients = useMemo(
    () => recipientsForModule(row, activeModule),
    [row, activeModule]
  );

  const loadTasks = async () => {
    if (!onboardingProjectId) {
      onToast("❌ This dealer does not have an onboarding_project_id.");
      return;
    }

    setLoading(true);
    try {
      const result = await fetchTapBlueprintTasks(onboardingProjectId);
      setTasks(result);

      const firstModule =
        MODULES.find((module) => result[module].length > 0) ?? "parts";
      setActiveModule(firstModule);
      setSelectedTaskId(result[firstModule][0]?.taskId ?? null);

      if (!result.parts.length && !result.service.length && !result.accounting.length) {
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

  const applyDerivedOperationalStatuses = async (nextTasks: TapTasksByModule) => {
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

  const changeTaskStatus = async (task: TapTask) => {
    const currentStatus = normalizeStatus(task.status);
    const updatedStatus = nextStatus(currentStatus);
    if (!updatedStatus) return;

    setBusyTaskId(task.taskId);
    try {
      await updateTapTaskStatus(task.taskId, updatedStatus);

      const nextTasks: TapTasksByModule = {
        ...tasks,
        [activeModule]: tasks[activeModule].map((item: TapTask) =>
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
    setCommentText(defaultComment(activeModule, template));
  };

  const postComment = async () => {
    if (!selectedTask || !commentText.trim()) return;

    setPostingComment(true);
    try {
      await postTapTaskComment(selectedTask.taskId, commentText, recipients);
      onToast("✅ TAP comment posted");
    } catch (error) {
      console.error("[DealerTasksPanel] TAP comment post failed", error);
      onToast("❌ TAP task functions is not working");
    } finally {
      setPostingComment(false);
    }
  };

  const uploadFile = async (file?: File) => {
    if (!file || !selectedTask) return;

    setUploading(true);
    try {
      await uploadTapTaskAttachment(selectedTask.taskId, file);
      onToast(`✅ Uploaded ${file.name}`);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error) {
      console.error("[DealerTasksPanel] TAP attachment upload failed", error);
      onToast("❌ TAP task functions is not working");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "160px minmax(0, 1fr)",
        gap: 16,
        minHeight: 390,
      }}
    >
      <aside
        style={{
          display: "grid",
          alignContent: "start",
          gap: 8,
          padding: 10,
          borderRadius: 10,
          background: "#0d1117",
        }}
      >
        {MODULES.map((module) => (
          <button
            key={module}
            type="button"
            onClick={() => setActiveModule(module)}
            style={{
              textAlign: "left",
              padding: "9px 10px",
              borderRadius: 8,
              cursor: "pointer",
              color: activeModule === module ? "#fff" : "#94a3b8",
              background:
                activeModule === module ? "rgba(59, 130, 246, 0.22)" : "transparent",
              border: `1px solid ${
                activeModule === module
                  ? "rgba(96, 165, 250, 0.42)"
                  : "rgba(255, 255, 255, 0.08)"
              }`,
            }}
          >
            {moduleMeta[module].label}
            <span style={{ float: "right", opacity: 0.75 }}>{tasks[module].length}</span>
          </button>
        ))}

        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={loading}
          onClick={() => void loadTasks()}
          style={{ marginTop: 6 }}
        >
          {loading ? "Loading…" : "↻ Reload Tasks"}
        </button>
      </aside>

      <section style={{ display: "grid", gap: 12, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <strong style={{ color: "#f8fafc" }}>
              {moduleMeta[activeModule].label} Blueprint Tasks
            </strong>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 3 }}>
              Project: {onboardingProjectId || "Missing onboarding_project_id"}
            </div>
          </div>

          <span style={{ color: "#94a3b8", fontSize: 11 }}>
            Notify: {recipients.map((recipient) => recipient.name).join(", ") || "No matching lead found"}
          </span>
        </div>

        {loading ? (
          <div style={{ color: "#94a3b8", padding: 20 }}>Loading TAP tasks…</div>
        ) : !moduleTasks.length ? (
          <div
            style={{
              color: "#94a3b8",
              padding: 20,
              border: "1px dashed rgba(255, 255, 255, 0.15)",
              borderRadius: 10,
            }}
          >
            No matching {moduleMeta[activeModule].label} blueprint tasks.
          </div>
        ) : (
          <>
            <select
              className="stores-input"
              value={selectedTask?.taskId ?? ""}
              onChange={(event) => setSelectedTaskId(Number(event.target.value))}
            >
              {moduleTasks.map((task: TapTask) => (
                <option key={task.taskId} value={task.taskId}>
                  #{task.taskId} — {task.taskName}
                </option>
              ))}
            </select>

            {selectedTask && (
              <div
                style={{
                  padding: 12,
                  borderRadius: 10,
                  background: "#11151d",
                  display: "grid",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <strong>{selectedTask.taskName}</strong>
                  <span
                    style={{
                      borderRadius: 999,
                      padding: "3px 8px",
                      fontSize: 11,
                      fontWeight: 700,
                      ...statusStyle(normalizeStatus(selectedTask.status)),
                    }}
                  >
                    {normalizeStatus(selectedTask.status)}
                  </span>
                </div>

                <div style={{ color: "#94a3b8", fontSize: 12 }}>
                  {selectedTask.descriptionPlain || "No task description available."}
                </div>

                <button
                  type="button"
                  className="btn-postman"
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
            )}

            <div
              style={{
                padding: 12,
                borderRadius: 10,
                background: "#11151d",
                display: "grid",
                gap: 9,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <strong>Comment for task #{selectedTask?.taskId ?? "—"}</strong>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => applyTemplate("issue")}
                  >
                    Issue
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => applyTemplate("completed")}
                  >
                    Completed
                  </button>
                </div>
              </div>

              <textarea
                className="stores-input"
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                style={{ width: "100%", minHeight: 125, resize: "vertical" }}
              />

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <input
                    ref={fileInputRef}
                    id={`task-file-${row.tekion_id}`}
                    type="file"
                    hidden
                    disabled={!selectedTask || uploading}
                    onChange={(event) => void uploadFile(event.target.files?.[0])}
                  />
                  <label
                    htmlFor={`task-file-${row.tekion_id}`}
                    className="btn-secondary btn-sm"
                    style={{
                      cursor: selectedTask && !uploading ? "pointer" : "not-allowed",
                      opacity: selectedTask && !uploading ? 1 : 0.55,
                    }}
                  >
                    {uploading ? "Uploading…" : "📎 Upload File"}
                  </label>
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