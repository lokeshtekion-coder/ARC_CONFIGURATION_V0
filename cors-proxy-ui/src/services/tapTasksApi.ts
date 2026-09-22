import {
  hasExpiredCustomToken,
  loadLatestExtensionCapture,
  type ArcCustomCapturedApi,
} from "./extensionBridge";
import { loadGlobalHeaders, loadTekionApiSettings } from "./tekionApiSettings";
import type { KeyValuePair } from "../types/proxy.types";
import type { CustomPhaseStatus, StoreRecord } from "./storesDb";

const TAP_API_BASE = "https://tapapi.tekioncloud.com/tapapi/task_management/public/v1";
const ATTACHMENT_API_BASE =
  "https://tapapi.tekioncloud.com/tapapi/tap_document_mgmt/public/v1";

export type TapTaskStatus = "new" | "inprogress" | "completed" | "duplicate";
export type TapBlueprintModule = "parts" | "service" | "accounting";
export type TapTaskModule = TapBlueprintModule;

export interface TapTaskMembership {
  team?: {
    teamId?: number;
    teamName?: string;
  };
  project?: {
    projectId?: number;
    projectName?: string;
  };
}

export interface TapTask {
  taskId: number;
  taskName: string;
  descriptionPlain: string;
  status: TapTaskStatus | string;
  dueDate?: number | null;
  memberships?: TapTaskMembership[];
}

export interface TapTaskCommentMention {
  email: string;
  name: string;
}

export interface TapTasksByModule {
  parts: TapTask[];
  service: TapTask[];
  accounting: TapTask[];
}

export interface DealerContextHeaders {
  tenantId?: string;
  dealerId?: string;
  tenantCode?: string;
}

export type TapProjectTasks = TapTasksByModule;

export class TapTaskApiError extends Error {
  constructor(message = "TAP task functions is not working") {
    super(message);
    this.name = "TapTaskApiError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeHeaders(input: unknown): Record<string, string> {
  if (!isRecord(input)) return {};

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const headerName = key.trim().toLowerCase();
    const headerValue = normalize(value);
    if (headerName && headerValue) {
      result[headerName] = headerValue;
    }
  }
  return result;
}

function pairsToHeaders(pairs: KeyValuePair[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (const pair of pairs) {
    if (!pair.enabled) continue;

    const key = normalize(pair.key).toLowerCase();
    const value = normalize(pair.value);
    if (key && value) {
      result[key] = value;
    }
  }

  return result;
}

function selectTapCapture(): ArcCustomCapturedApi | null {
  const settings = loadTekionApiSettings();
  const captures = Object.values(loadLatestExtensionCapture()?.customCaptures ?? {});

  return (
    captures.find((capture) => capture.id === settings.storesApiCaptureId) ??
    captures.find((capture) => capture.id === settings.storesCustomCaptureId) ??
    captures.find((capture) => {
      const searchable = `${capture.pattern ?? ""} ${capture.matchedUrl ?? ""}`.toLowerCase();
      return (
        searchable.includes("/entity-instance/1") ||
        searchable.includes("task_management") ||
        searchable.includes("tapapi")
      );
    }) ??
    null
  );
}

function buildTapHeaders(context?: DealerContextHeaders): Record<string, string> {
  const capture = selectTapCapture();

  if (!capture) {
    throw new TapTaskApiError(
      "TAP task functions is not working. Capture a current Stores/TAP request and retry."
    );
  }

  if (hasExpiredCustomToken(capture)) {
    throw new TapTaskApiError(
      "TAP task functions is not working. The captured TAP token has expired; recapture it."
    );
  }

  const headers: Record<string, string> = {
    ...normalizeHeaders(capture.headers),
    ...pairsToHeaders(loadGlobalHeaders()),
    accept: "application/json, text/plain, */*",
    origin: "https://tap.tekioncloud.com",
    referer: "https://tap.tekioncloud.com/",
  };

  if (context?.tenantId) headers["tenant-id"] = context.tenantId;
  if (context?.dealerId) headers["dealer-id"] = context.dealerId;
  if (context?.tenantCode) headers["tenant-code"] = context.tenantCode;

  if (!headers.authorization && !headers["tap-duo-api-token"]) {
    throw new TapTaskApiError(
      "TAP task functions is not working. No TAP authorization header was captured."
    );
  }

  return headers;
}

function summarizeBody(body: unknown): Record<string, unknown> {
  if (Array.isArray(body)) {
    return { type: "array", length: body.length, sample: body.slice(0, 2) };
  }
  if (isRecord(body)) {
    return {
      type: "object",
      keys: Object.keys(body),
      count: body.count ?? body.total ?? body.length,
      samplePreview: Object.fromEntries(Object.entries(body).slice(0, 4)),
    };
  }
  return { type: typeof body, value: body };
}

async function proxyJson<T>(
  url: string,
  method: string,
  body?: unknown,
  context?: DealerContextHeaders,
  silent = false,
  retries = 2
): Promise<T> {
  const headers: Record<string, string> = {
    ...buildTapHeaders(context),
    "content-type": "application/json",
  };

  const startTime = performance.now();

  let response: Response;
  try {
    response = await fetch("/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        timeout: 60000,
      }),
    });
  } catch (error) {
    if (!silent) console.error("[tapTasksApi] ❌ Proxy network failure", error);
    throw new TapTaskApiError();
  }

  let wrapper: Record<string, unknown>;
  try {
    wrapper = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    if (!silent) console.error("[tapTasksApi] ❌ Invalid proxy response wrapper", error);
    throw new TapTaskApiError();
  }

  const upstreamStatus =
    typeof wrapper.status === "number" ? wrapper.status : response.status;
  const elapsedMs = Math.round(performance.now() - startTime);

  if (upstreamStatus === 429 && retries > 0) {
    const backoffMs = (3 - retries) * 1500;
    console.warn(`[tapTasksApi] ⏳ Upstream 429 rate limit. Backing off for ${backoffMs}ms... (${retries} retries left)`);
    await sleep(backoffMs);
    return proxyJson<T>(url, method, body, context, silent, retries - 1);
  }

  if (!response.ok || upstreamStatus >= 400) {
    if (!silent) {
      console.error(`[tapTasksApi] ❌ Upstream ${upstreamStatus} on ${method} ${url}`, {
        upstreamStatus,
        elapsedMs: `${elapsedMs}ms`,
        body: wrapper.body,
      });
    }
    throw new TapTaskApiError();
  }

  const upstreamBody = wrapper.body;
  let parsed: unknown = upstreamBody;
  if (typeof upstreamBody === "string") {
    try {
      parsed = JSON.parse(upstreamBody);
    } catch {
      parsed = upstreamBody;
    }
  }

  console.info(`[tapTasksApi] 🟢 Success (${upstreamStatus}) ${method} ${url} [${elapsedMs}ms]`, {
    status: upstreamStatus,
    endpoint: url.replace(TAP_API_BASE, ""),
    sentPayload: body,
    resolvedSummary: summarizeBody(parsed),
  });

  return parsed as T;
}

function toFiniteTaskId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function toMembership(value: unknown): TapTaskMembership | null {
  if (!isRecord(value)) return null;

  const team = isRecord(value.team)
    ? {
        teamId: toFiniteTaskId(value.team.teamId) ?? undefined,
        teamName: normalize(value.team.teamName) || undefined,
      }
    : undefined;
  const project = isRecord(value.project)
    ? {
        projectId: toFiniteTaskId(value.project.projectId) ?? undefined,
        projectName: normalize(value.project.projectName) || undefined,
      }
    : undefined;

  return { team, project };
}

function toTapTask(value: unknown): TapTask | null {
  if (!isRecord(value)) return null;

  const taskId = toFiniteTaskId(value.taskId ?? value.id);
  if (taskId == null) return null;

  const memberships = Array.isArray(value.memberships)
    ? value.memberships
        .map(toMembership)
        .filter((membership): membership is TapTaskMembership => membership !== null)
    : [];

  const dueDateRaw = value.dueDate ?? value.due_date;
  const dueDate = typeof dueDateRaw === "number" && Number.isFinite(dueDateRaw)
    ? dueDateRaw
    : null;

  return {
    taskId,
    taskName: normalize(value.taskName ?? value.name ?? value.title),
    descriptionPlain: normalize(value.descriptionPlain ?? value.description ?? value.desc),
    status: normalize(value.status).toLowerCase() || "new",
    dueDate,
    memberships,
  };
}

function belongsToDsOnboardingProject(task: TapTask, onboardingProjectId: number): boolean {
  if (!task.memberships || task.memberships.length === 0) return true;

  return task.memberships.some((membership) => {
    const isDs = !membership.team?.teamName || membership.team.teamName.includes("Onboarding");
    const isProj =
      !membership.project?.projectId ||
      Number(membership.project.projectId) === onboardingProjectId;
    return isDs && isProj;
  });
}

function moduleForTask(task: TapTask): TapBlueprintModule | null {
  const taskName = normalize(task.taskName).toLowerCase();
  const description = normalize(task.descriptionPlain).toLowerCase();

  const isExcluded =
    taskName.includes("sign-off") ||
    taskName.includes("signoff") ||
    taskName.includes("review") ||
    taskName.includes("validation") ||
    taskName.includes("checklist");

  if (isExcluded) return null;

  if (
    taskName === "blueprint configuration - accounting" ||
    (taskName.startsWith("blueprint configuration") && taskName.includes("accounting"))
  ) {
    return "accounting";
  }

  if (
    (taskName === "blueprint configuration" && description.includes("parts blueprint")) ||
    taskName === "blueprint configuration - parts"
  ) {
    return "parts";
  }

  if (
    (taskName === "blueprint configuration" && description.includes("service blueprint")) ||
    taskName === "blueprint configuration - service"
  ) {
    return "service";
  }

  return null;
}

async function fetchTasksInChunks(
  taskIds: number[],
  context?: DealerContextHeaders
): Promise<unknown[]> {
  const CHUNK_SIZE = 35;
  const collected: unknown[] = [];
  const totalChunks = Math.ceil(taskIds.length / CHUNK_SIZE);

  for (let i = 0; i < taskIds.length; i += CHUNK_SIZE) {
    const chunkIndex = Math.floor(i / CHUNK_SIZE) + 1;
    const chunk = taskIds.slice(i, i + CHUNK_SIZE);

    try {
      const batch = await proxyJson<unknown>(
        `${TAP_API_BASE}/tasks/get`,
        "POST",
        {
          tasks: chunk,
          isAppendTasks: true,
        },
        context,
        true
      );

      let batchCount = 0;
      if (Array.isArray(batch)) {
        collected.push(...batch);
        batchCount = batch.length;
      } else if (isRecord(batch)) {
        if (Array.isArray(batch.tasks)) {
          collected.push(...batch.tasks);
          batchCount = batch.tasks.length;
        } else if (Array.isArray(batch.data)) {
          collected.push(...batch.data);
          batchCount = batch.data.length;
        } else if (Array.isArray(batch.taskList)) {
          collected.push(...batch.taskList);
          batchCount = batch.taskList.length;
        }
      }

      console.info(
        `[tapTasksApi] 📥 Batch chunk ${chunkIndex}/${totalChunks} resolved`,
        {
          requestedIdsCount: chunk.length,
          receivedTasksCount: batchCount,
          totalCollectedSoFar: collected.length,
        }
      );
    } catch (err) {
      console.warn(
        `[tapTasksApi] ⚠️ Chunk ${chunkIndex}/${totalChunks} skipped due to upstream rejection`,
        err
      );
    }

    if (i + CHUNK_SIZE < taskIds.length) {
      await sleep(100);
    }
  }

  return collected;
}

export async function fetchTapBlueprintTasks(
  onboardingProjectId: string | number,
  context?: DealerContextHeaders
): Promise<TapTasksByModule> {
  const projectId = Number(onboardingProjectId);
  if (!Number.isFinite(projectId) || projectId <= 0) {
    throw new TapTaskApiError(
      "TAP task functions is not working. onboarding_project_id is missing."
    );
  }

  console.info(`[tapTasksApi] 🚀 Querying project groups for ID: ${projectId}`, {
    projectId,
    dealerContext: context,
  });

  const groupsResponse = await proxyJson<unknown>(
    `${TAP_API_BASE}/projects/${encodeURIComponent(String(projectId))}/groups/`,
    "POST",
    {
      filters: [
        {
          field: "status",
          operator: "in",
          value: ["new", "inprogress", "completed", "duplicate"],
        },
      ],
      sort: { field: "due_date", order: "asc" },
      groupBy: { field: "implementation_stage" },
      viewId: 4126,
      includeSubtasks: true,
    },
    context
  );

  const candidateIds: number[] = [];
  if (isRecord(groupsResponse) && Array.isArray(groupsResponse.groups)) {
    for (const g of groupsResponse.groups) {
      if (isRecord(g) && Array.isArray(g.taskIds)) {
        for (const id of g.taskIds) {
          const fid = toFiniteTaskId(id);
          if (fid) candidateIds.push(fid);
        }
      }
    }
  }

  console.info(`[tapTasksApi] 🔍 Discovered ${candidateIds.length} task IDs across groups`, {
    projectId,
    taskIdsSample: candidateIds.slice(0, 10),
  });

  const result: TapTasksByModule = { parts: [], service: [], accounting: [] };
  if (candidateIds.length === 0) return result;

  const rawTasks = await fetchTasksInChunks(candidateIds, context);

  for (const raw of rawTasks) {
    const task = toTapTask(raw);
    if (!task || !belongsToDsOnboardingProject(task, projectId)) continue;

    const mod = moduleForTask(task);
    if (mod) {
      result[mod].push(task);
    }
  }

  console.info(`[tapTasksApi] 🎯 Blueprint Tasks Successfully Mapped`, {
    projectId,
    totalRawTasksReceived: rawTasks.length,
    parts: result.parts.map((t) => ({ id: t.taskId, name: t.taskName, status: t.status })),
    service: result.service.map((t) => ({ id: t.taskId, name: t.taskName, status: t.status })),
    accounting: result.accounting.map((t) => ({ id: t.taskId, name: t.taskName, status: t.status })),
  });

  return result;
}

export const fetchTapProjectTasks = fetchTapBlueprintTasks;

export async function updateTapTaskStatus(
  taskId: number,
  status: "inprogress" | "completed" | "new",
  context?: DealerContextHeaders
): Promise<void> {
  console.info(`[tapTasksApi] 🔄 Updating task #${taskId} status to "${status}"...`);

  const response = await proxyJson<unknown>(
    `${TAP_API_BASE}/tasks/${encodeURIComponent(String(taskId))}`,
    "PUT",
    { status },
    context
  );

  console.info(`[tapTasksApi] ✅ Task #${taskId} status successfully set to "${status}"`, {
    taskId,
    status,
    response,
  });
}

function toRichTextComment(
  text: string,
  mentions: TapTaskCommentMention[]
): string {
  let cleanedText = text;
  const mentionNodes: Array<Record<string, unknown>> = [];

  for (const mention of mentions) {
    mentionNodes.push({
      type: "mention",
      attrs: {
        id: "",
        name: mention.name || mention.email,
        email: mention.email,
        value: "",
        trigger: "@",
      },
    });
    mentionNodes.push({ type: "text", text: " " });

    const escaped = mention.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reg = new RegExp(`@?${escaped}\\s*`, "i");
    cleanedText = cleanedText.replace(reg, "");
  }

  const lines = cleanedText.trim().split(/\r?\n/);
  const paragraphBlocks: Array<{ type: string; content: unknown[] }> = [];

  const firstLine = lines[0] ?? "";
  const firstParagraphContent = [...mentionNodes];
  if (firstLine.trim()) {
    firstParagraphContent.push({ type: "text", text: firstLine });
  }
  paragraphBlocks.push({ type: "paragraph", content: firstParagraphContent });

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim()) {
      paragraphBlocks.push({
        type: "paragraph",
        content: [{ type: "text", text: line }],
      });
    }
  }

  return JSON.stringify(paragraphBlocks);
}

function uniqueMentions(mentions: TapTaskCommentMention[]): TapTaskCommentMention[] {
  const seen = new Set<string>();

  return mentions.filter((mention) => {
    const email = normalize(mention.email).toLowerCase();
    if (!email || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

export async function postTapTaskComment(
  taskId: number,
  text: string,
  mentions: TapTaskCommentMention[] = [],
  context?: DealerContextHeaders
): Promise<void> {
  const trimmedText = text.trim();
  if (!trimmedText && mentions.length === 0) {
    throw new TapTaskApiError("TAP task functions is not working. Enter a comment first.");
  }

  const validMentions = uniqueMentions(mentions);

  console.info(`[tapTasksApi] 💬 Posting comment to task #${taskId}...`, {
    taskId,
    preview: trimmedText.slice(0, 100),
    mentions: validMentions,
  });

  const payload = {
    comments: [
      {
        type: "comment",
        content: toRichTextComment(trimmedText, validMentions),
        mentions: validMentions.map((mention) => mention.email.toLowerCase().trim()),
      },
    ],
  };

  const response = await proxyJson<unknown>(
    `${TAP_API_BASE}/tasks/${encodeURIComponent(String(taskId))}/comments`,
    "POST",
    payload,
    context
  );

  console.info(`[tapTasksApi] ✅ Comment posted successfully to task #${taskId}`, {
    taskId,
    response,
  });
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file"));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      resolve(dataUrl.split(",")[1] ?? "");
    };
    reader.readAsDataURL(file);
  });
}

export async function uploadTapTaskAttachment(
  taskId: number,
  file: File,
  context?: DealerContextHeaders
): Promise<void> {
  const headers = buildTapHeaders(context);
  delete headers["content-type"];

  console.info(`[tapTasksApi] 📎 Uploading attachment to task #${taskId}...`, {
    taskId,
    fileName: file.name,
    fileSizeKb: Math.round(file.size / 1024),
    dealerContext: context,
  });

  let base64: string;
  try {
    base64 = await readAsBase64(file);
  } catch (error) {
    console.error("[tapTasksApi] ❌ File read failure", error);
    throw new TapTaskApiError();
  }

  const candidateUploads = [
    {
      url: `${ATTACHMENT_API_BASE}/tasks/${encodeURIComponent(String(taskId))}/attachments?isDeletable=true`,
      fieldName: "file",
    },
    {
      url: `${ATTACHMENT_API_BASE}/tasks/${encodeURIComponent(String(taskId))}/attachments?isDeletable=true`,
      fieldName: "files",
    },
    {
      url: `${ATTACHMENT_API_BASE}/tasks/${encodeURIComponent(String(taskId))}/attachments`,
      fieldName: "file",
    },
    {
      url: `${TAP_API_BASE}/tasks/${encodeURIComponent(String(taskId))}/attachments?isDeletable=true`,
      fieldName: "file",
    },
  ];

  let lastError: unknown = null;
  let succeeded = false;

  for (const candidate of candidateUploads) {
    try {
      const response = await fetch("/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: candidate.url,
          method: "POST",
          headers,
          timeout: 60000,
          multipartBase64: {
            fields: { isDeletable: "true" },
            file: {
              fieldName: candidate.fieldName,
              name: file.name,
              type: file.type || "application/octet-stream",
              base64,
            },
          },
        }),
      });

      const wrapper = (await response.json()) as Record<string, unknown>;
      const upstreamStatus =
        typeof wrapper.status === "number" ? wrapper.status : response.status;

      if (response.ok && upstreamStatus < 400) {
        console.info(
          `[tapTasksApi] 🟢 Success (${upstreamStatus}) POST attachment to task #${taskId}`,
          {
            taskId,
            fileName: file.name,
            urlUsed: candidate.url,
            fieldNameUsed: candidate.fieldName,
            responseBody: wrapper.body,
          }
        );
        succeeded = true;
        break;
      } else {
        lastError = wrapper.body;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (!succeeded) {
    console.error("[tapTasksApi] ❌ Attachment upload failed on all candidate configurations", {
      taskId,
      lastError,
    });
    throw new TapTaskApiError();
  }
}

export function normalizeTaskStatus(status?: string): TapTaskStatus {
  const value = String(status ?? "new").trim().toLowerCase();
  if (value === "inprogress" || value === "completed" || value === "duplicate") {
    return value;
  }
  return "new";
}

export function calculatePhaseStatus(tasks: TapTask[]): CustomPhaseStatus {
  const statuses = tasks.map((task) => normalizeTaskStatus(task.status));
  if (statuses.length === 0 || statuses.every((status) => status === "new")) {
    return "TO DO";
  }
  if (statuses.every((status) => status === "completed")) {
    return "Completed";
  }
  return "WIP";
}

export function calculateFixedOpsStatus(tasks: TapTasksByModule): CustomPhaseStatus {
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

/**
 * Concurrently fetches real TAP task statuses with rate-limiting protection (sequential pacing + 350ms delay).
 * Skips stores where both Fixed Ops and Variable Ops are already Completed.
 */
export async function batchFetchRealTapStatuses(
  stores: StoreRecord[],
  onProgress?: (processed: number, total: number, updated: number) => void
): Promise<{ updatedStores: StoreRecord[]; updatedCount: number }> {
  const eligible = stores.filter(
    (s) =>
      Boolean(s.onboarding_project_id?.trim()) &&
      (s.fixed_ops_status !== "Completed" || s.variable_ops_status !== "Completed")
  );

  const total = eligible.length;
  let processed = 0;
  let updatedCount = 0;

  const storeMap = new Map<string, StoreRecord>(stores.map((s) => [s.tekion_id, { ...s }]));

  for (let i = 0; i < eligible.length; i++) {
    const store = eligible[i];

    try {
      const result = await fetchTapBlueprintTasks(store.onboarding_project_id!, {
        tenantId: store.tenant_id,
        dealerId: store.dealer_id,
        tenantCode: store.tenant_code,
      });

      const realFixedOps = calculateFixedOpsStatus(result);
      const realVariableOps = calculatePhaseStatus(result.accounting);

      const current = storeMap.get(store.tekion_id);
      if (current) {
        let changed = false;

        if (realFixedOps === "Completed" && current.fixed_ops_status !== "Completed") {
          current.fixed_ops_status = "Completed";
          changed = true;
        }

        if (realVariableOps === "Completed" && current.variable_ops_status !== "Completed") {
          current.variable_ops_status = "Completed";
          changed = true;
        }

        if (changed) {
          updatedCount++;
          storeMap.set(store.tekion_id, current);
        }
      }
    } catch (err) {
      console.warn(`[tapTasksApi] Could not sync TAP tasks for store #${store.dealer_id}`, err);
    } finally {
      processed++;
      onProgress?.(processed, total, updatedCount);
    }

    if (i + 1 < eligible.length) {
      await sleep(350);
    }
  }

  return {
    updatedStores: Array.from(storeMap.values()),
    updatedCount,
  };
}