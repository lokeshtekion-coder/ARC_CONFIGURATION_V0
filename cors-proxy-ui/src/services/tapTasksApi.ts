import {
  hasExpiredCustomToken,
  loadLatestExtensionCapture,
  type ArcCustomCapturedApi,
} from "./extensionBridge";
import { loadGlobalHeaders, loadTekionApiSettings } from "./tekionApiSettings";
import type { KeyValuePair } from "../types/proxy.types";
import type { CustomPhaseStatus, StoreRecord, BlueprintTaskIndex } from "./storesDb";
import { resolveStoreProjectId } from "./storesDb";

const TAP_API_BASE = "https://tapapi.tekioncloud.com/tapapi/task_management/public/v1";
const ATTACHMENT_API_BASE =
  "https://tapapi.tekioncloud.com/tapapi/tap_document_mgmt/public/v1";

const SUCCESS_RAW_LOG_LIMIT = 2;
let successRawLogCount = 0;

export type TapTaskStatus = "new" | "inprogress" | "completed" | "duplicate";
export type TapBlueprintModule = "parts" | "service" | "accounting";
export type TapTaskModule = TapBlueprintModule;

export interface TapAttachmentItem {
  id: number | string;
  name: string;
  link: string;
  thumbnailLink?: string;
  version?: number;
  createdAt?: number;
  createdBy?: number;
  isDeletable?: boolean;
}

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

export interface TapTaskCommentItem {
  id?: string | number;
  commentId?: string | number;
  content: string;
  createdAt?: number;
  createdBy: string | { name?: string; email?: string };
  rawComment?: unknown;
}

export interface TapUserItem {
  userId: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  status?: string;
  userName?: string;
  displayName?: string;
  userType?: string;
}

export interface TapTask {
  taskId: number;
  taskName: string;
  descriptionPlain?: string;
  status: TapTaskStatus | string;
  dueDate?: number | null;
  assignee?: number | string | { userId?: number; userName?: string } | null;
  assigneeName?: string;
  memberships?: TapTaskMembership[];
  taskAttachmentCount?: number;
  attachments?: TapAttachmentItem[];
  latestComment?: TapTaskCommentItem | null;
}

export interface TapTaskCommentMention {
  email: string;
  name: string;
}

export interface DueDateCalculation {
  formattedDate: string;
  isOverdue: boolean;
  daysRemaining: number;
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

export type BatchFetchProgressCallback = (
  processed: number,
  total: number,
  updated: number,
  skippedTasks?: number
) => void;

export class TapTaskApiError extends Error {
  public upstreamStatus?: number;
  public rawResponse?: unknown;

  constructor(message = "TAP task functions is not working", upstreamStatus?: number, rawResponse?: unknown) {
    super(message);
    this.name = "TapTaskApiError";
    this.upstreamStatus = upstreamStatus;
    this.rawResponse = rawResponse;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function getCleanId(val: unknown): string {
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function toFiniteTaskId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// In-memory cache for TAP Users directory
let tapUsersCache: Map<number, string> | null = null;
let tapUsersCacheTime = 0;
const USER_CACHE_TTL_MS = 60 * 60 * 1000;

export async function fetchTapUsersMap(
  context?: DealerContextHeaders
): Promise<Map<number, string>> {
  const now = Date.now();
  if (tapUsersCache && now - tapUsersCacheTime < USER_CACHE_TTL_MS) {
    return tapUsersCache;
  }

  const url = `${TAP_API_BASE}/users`;
  const map = new Map<number, string>();

  try {
    const list = await proxyJson<TapUserItem[]>(url, "GET", undefined, context, true);
    if (Array.isArray(list)) {
      for (const u of list) {
        const id = Number(u.userId);
        if (Number.isFinite(id)) {
          const resolvedName =
            (u.userName && u.userName.trim()) ||
            (u.displayName && u.displayName.trim()) ||
            `${u.firstName || ""} ${u.lastName || ""}`.trim() ||
            u.email ||
            `User #${id}`;
          map.set(id, resolvedName);
        }
      }
    }
    tapUsersCache = map;
    tapUsersCacheTime = now;
  } catch {
    if (!tapUsersCache) tapUsersCache = new Map();
  }

  return tapUsersCache;
}

export function resolveTapAssigneeName(
  assignee: unknown,
  usersMap: Map<number, string>
): string {
  if (!assignee) return "Unassigned";

  if (typeof assignee === "object" && assignee !== null) {
    const obj = assignee as Record<string, any>;
    if (obj.userName && typeof obj.userName === "string") return obj.userName;
    if (obj.displayName && typeof obj.displayName === "string") return obj.displayName;
    if (obj.userId) {
      const id = Number(obj.userId);
      if (usersMap.has(id)) return usersMap.get(id)!;
      return `User #${id}`;
    }
  }

  const numId = Number(assignee);
  if (Number.isFinite(numId) && numId > 0) {
    if (usersMap.has(numId)) {
      return usersMap.get(numId)!;
    }
    return `User #${numId}`;
  }

  return String(assignee);
}

export function extractEffectiveProjectId(
  store?: (Partial<StoreRecord> & Record<string, any>) | null
): string {
  if (!store) return "";
  return (
    resolveStoreProjectId(store) ||
    getCleanId(store.target_entity_instance_id || store.targetEntityInstanceId) ||
    getCleanId(store.project_implementation_tm_sync_status_tracking_id) ||
    getCleanId(store.implementation_tm_sync_status_tracking_id)
  );
}

export function formatDueDateInfo(dueTimestamp?: number | null): DueDateCalculation | null {
  if (!dueTimestamp || !Number.isFinite(dueTimestamp)) return null;

  const ms = dueTimestamp < 10000000000 ? dueTimestamp * 1000 : dueTimestamp;
  const dueDate = new Date(ms);
  const now = new Date();

  const dueDay = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  const diffMs = dueDay - today;
  const daysRemaining = Math.round(diffMs / (1000 * 60 * 60 * 24));
  const isOverdue = daysRemaining < 0;

  const formattedDate = dueDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return { formattedDate, isOverdue, daysRemaining };
}

function parseProseMirrorNode(node: any): string {
  if (!node) return "";
  if (node.type === "text") return node.text || "";
  if (node.type === "mention") return `@${node.attrs?.name || node.attrs?.label || "user"} `;
  if (node.type === "hard_break") return "\n";

  const childrenText = Array.isArray(node.content)
    ? node.content.map(parseProseMirrorNode).join("")
    : "";

  if (node.type === "paragraph") return childrenText ? `${childrenText}\n` : "";
  if (node.type === "list_item") return `• ${childrenText.trim()}\n`;
  if (node.type === "bullet_list" || node.type === "ordered_list") return `${childrenText}\n`;

  return childrenText;
}

export function cleanCommentContent(rawContent: unknown): string {
  if (!rawContent) return "";
  if (typeof rawContent !== "string") {
    if (Array.isArray(rawContent) || typeof rawContent === "object") {
      return (Array.isArray(rawContent) ? rawContent : [rawContent])
        .map(parseProseMirrorNode)
        .join("")
        .trim();
    }
    return String(rawContent);
  }

  const trimmed = rawContent.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      const result = nodes.map(parseProseMirrorNode).join("").trim();
      if (result) return result;
    } catch {}
  }

  return trimmed;
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

/** Plain-text summary of which TAP captures exist locally, for logs when a run cannot start. */
export function describeTapCaptureState(): string {
  const settings = loadTekionApiSettings();
  const captures = Object.values(loadLatestExtensionCapture()?.customCaptures ?? {});
  const tapLike = captures.filter((c) =>
    /entity-instance\/1|task_management|tapapi/i.test(`${c.pattern ?? ""} ${c.matchedUrl ?? ""}`)
  );
  const details = tapLike
    .map((c) => `${c.label || c.id}${hasExpiredCustomToken(c) ? " (expired)" : ""}`)
    .join(", ");
  return `Captures stored: ${captures.length}; TAP-like: ${tapLike.length}${details ? ` [${details}]` : ""}; selected TAP capture id: ${settings.storesApiCaptureId || "none"}`;
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
    accept: "*/*",
    origin: "https://tap.tekioncloud.com",
    referer: "https://tap.tekioncloud.com/",
    locale: "en_US",
  };

  if (!headers["email"]) {
    headers["email"] = "tlreddy@tekion.com";
  }

  const explicitDuoToken =
    localStorage.getItem("tap_duo_api_token") || localStorage.getItem("tap_token");
  if (explicitDuoToken && !headers["tap-duo-api-token"]) {
    headers["tap-duo-api-token"] = explicitDuoToken;
  }

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

// Global Mutex Queue with 60-Second Auto-Expiring Circuit Breaker
let globalQueuePromise: Promise<void> = Promise.resolve();
let queueLockTimestamp = Date.now();
const MAX_QUEUE_HOLD_MS = 60 * 1000;
const REQUEST_GAP_MS = 120;

async function enqueueRequest<T>(fn: () => Promise<T>): Promise<T> {
  if (Date.now() - queueLockTimestamp > MAX_QUEUE_HOLD_MS) {
    console.warn("[tapTasksApi] ⚠️ Queue lock exceeded 60s! Force-resetting global queue.");
    globalQueuePromise = Promise.resolve();
  }

  const task = globalQueuePromise.then(async () => {
    queueLockTimestamp = Date.now();
    try {
      const res = await fn();
      await sleep(REQUEST_GAP_MS);
      return res;
    } finally {
      queueLockTimestamp = Date.now();
    }
  });

  globalQueuePromise = task.then(() => {}, () => {});
  return task;
}

async function proxyJson<T>(
  url: string,
  method: string,
  body?: unknown,
  context?: DealerContextHeaders,
  silent = false,
  maxRetries = 4
): Promise<T> {
  return enqueueRequest(async () => {
    let retries = maxRetries;

    while (true) {
      const headers: Record<string, string> = {
        ...buildTapHeaders(context),
      };

      if (method !== "GET" && method !== "HEAD") {
        headers["content-type"] = "application/json";
      } else {
        delete headers["content-type"];
      }

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
        console.error("[tapTasksApi] ❌ Proxy network failure", error);
        throw new TapTaskApiError("Proxy network failure", undefined, error);
      }

      let wrapper: Record<string, unknown>;
      try {
        wrapper = (await response.json()) as Record<string, unknown>;
      } catch (error) {
        console.error("[tapTasksApi] ❌ Invalid proxy response wrapper", error);
        throw new TapTaskApiError("Invalid proxy response wrapper", undefined, error);
      }

      const upstreamStatus =
        typeof wrapper.status === "number" ? wrapper.status : response.status;
      const elapsedMs = Math.round(performance.now() - startTime);

      const upstreamBody = wrapper.body;
      let parsed: unknown = upstreamBody;
      if (typeof upstreamBody === "string") {
        try {
          parsed = JSON.parse(upstreamBody);
        } catch {
          parsed = upstreamBody;
        }
      }

      if (upstreamStatus === 429 && retries > 0) {
        retries--;
        const respHeaders = isRecord(wrapper.headers) ? (wrapper.headers as Record<string, any>) : {};
        const retryAfterHeader = respHeaders["retry-after"] || respHeaders["Retry-After"];
        const serverRetrySec = Number(retryAfterHeader);

        let backoffMs: number;
        if (Number.isFinite(serverRetrySec) && serverRetrySec > 0) {
          backoffMs = (serverRetrySec + 1) * 1000;
        } else {
          const coolingTiers = [20000, 35000, 50000, 60000];
          const baseMs = coolingTiers[maxRetries - retries - 1] ?? 25000;
          const jitterMs = Math.floor(Math.random() * 2000);
          backoffMs = baseMs + jitterMs;
        }

        console.warn(
          `[tapTasksApi] ⏳ Upstream 429 rate limit on [${method} ${url.replace(TAP_API_BASE, "")}]. ` +
          `Cooling down for ${Math.round(backoffMs / 1000)}s... (${retries} retries left)`
        );

        await sleep(backoffMs);
        continue;
      }

      if (!response.ok || upstreamStatus >= 400) {
        console.error(`[tapTasksApi] ❌ Upstream ${upstreamStatus} on ${method} ${url} [RAW Error]:`, {
          upstreamStatus,
          elapsedMs: `${elapsedMs}ms`,
          sentPayload: body,
          headers,
          rawResponse: parsed,
        });
        throw new TapTaskApiError(`TAP upstream error ${upstreamStatus}`, upstreamStatus, parsed);
      }

      if (successRawLogCount < SUCCESS_RAW_LOG_LIMIT) {
        successRawLogCount++;
        console.info(`[tapTasksApi] 🟢 Success (${upstreamStatus}) ${method} ${url} [${elapsedMs}ms] [RAW Success ${successRawLogCount}/2]:`, {
          status: upstreamStatus,
          endpoint: url.replace(TAP_API_BASE, "").replace(ATTACHMENT_API_BASE, ""),
          sentPayload: body,
          rawResponse: parsed,
        });
      } else if (!silent) {
        console.info(`[tapTasksApi] 🟢 Success (${upstreamStatus}) ${method} ${url} [${elapsedMs}ms]`, {
          status: upstreamStatus,
          endpoint: url.replace(TAP_API_BASE, "").replace(ATTACHMENT_API_BASE, ""),
          summary: summarizeBody(parsed),
        });
      }

      return parsed as T;
    }
  });
}

export async function fetchTapTaskComments(
  taskId: number | string,
  context?: DealerContextHeaders
): Promise<TapTaskCommentItem[]> {
  const idNum = toFiniteTaskId(taskId);
  if (!idNum) return [];

  const url = `${TAP_API_BASE}/tasks/${idNum}/comments`;

  try {
    const response = await proxyJson<unknown>(url, "GET", undefined, context, true);

    let rawList: unknown[] = [];
    if (Array.isArray(response)) {
      rawList = response;
    } else if (isRecord(response)) {
      if (Array.isArray(response.comments)) rawList = response.comments;
      else if (Array.isArray(response.data)) rawList = response.data;
      else if (Array.isArray(response.list)) rawList = response.list;
    }

    return rawList.map((item: any) => {
      const rawText = item.content || item.comment || item.text || "";
      const cleaned = cleanCommentContent(rawText);

      const creator =
        item.createdBy?.name ||
        item.createdBy?.email ||
        item.createdByName ||
        item.userName ||
        item.email ||
        "Tekion User";

      return {
        id: item.id || item.commentId,
        content: cleaned || "—",
        createdAt: item.createdAt || item.created_at,
        createdBy: creator,
        rawComment: item,
      };
    });
  } catch {
    return [];
  }
}

export async function fetchTaskAttachments(
  taskId: number | string,
  context?: DealerContextHeaders
): Promise<TapAttachmentItem[]> {
  return (await fetchTaskAttachmentsOrNull(taskId, context)) ?? [];
}

export async function fetchTaskAttachmentsOrNull(
  taskId: number | string,
  context?: DealerContextHeaders
): Promise<TapAttachmentItem[] | null> {
  const idNum = toFiniteTaskId(taskId);
  if (!idNum) return null;

  const url = `${ATTACHMENT_API_BASE}/tasks/${idNum}?languageCode=en_US`;
  const rawHeaders = buildTapHeaders(context);

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    const lk = k.toLowerCase();
    if (lk !== "content-type" && lk !== "content-length") {
      headers[lk] = v;
    }
  }

  headers["locale"] = "en_US";
  headers["accept"] = "application/json, text/plain, */*";
  if (!headers["email"]) {
    headers["email"] = "tlreddy@tekion.com";
  }

  const duoToken =
    localStorage.getItem("tap_duo_api_token") ||
    localStorage.getItem("tap_token") ||
    headers["tap-duo-api-token"];

  if (duoToken) {
    headers["tap-duo-api-token"] = duoToken;
  }

  return enqueueRequest(async () => {
    try {
      const res = await fetch("/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          method: "GET",
          headers,
          timeout: 25000,
        }),
      });

      const wrapper = await res.json();
      const upstreamStatus = typeof wrapper.status === "number" ? wrapper.status : res.status;

      let parsed = wrapper.body;
      if (typeof parsed === "string") {
        try {
          parsed = JSON.parse(parsed);
        } catch {}
      }

      if (upstreamStatus >= 400) {
        return null;
      }

      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.data)
        ? parsed.data
        : Array.isArray(parsed?.attachments)
        ? parsed.attachments
        : [];

      return list as TapAttachmentItem[];
    } catch {
      return null;
    }
  });
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
        .filter((membership: TapTaskMembership | null): membership is TapTaskMembership => membership !== null)
    : [];

  const dueDateRaw = value.dueDate ?? value.due_date;
  const dueDate =
    typeof dueDateRaw === "number" && Number.isFinite(dueDateRaw) ? dueDateRaw : null;

  const countRaw = value.taskAttachmentCount ?? value.attachmentCount;
  const taskAttachmentCount =
    typeof countRaw === "number" && Number.isFinite(countRaw) ? countRaw : undefined;

  const rawAssignee = value.assignee ?? value.assigneeId ?? value.assignedTo ?? null;

  return {
    taskId,
    taskName: normalize(value.taskName ?? value.name ?? value.title),
    descriptionPlain: normalize(value.descriptionPlain ?? value.description ?? value.desc),
    status: normalize(value.status).toLowerCase() || "new",
    dueDate,
    assignee: rawAssignee,
    memberships,
    taskAttachmentCount,
  };
}

/**
 * EXACT DATA SPECIFICATION MATCHING
 *
 * 1. ACCOUNTING:
 *    - Task Name: "Blueprint Configuration - Accounting"
 *    - Task Name: "Blueprint Configuration: Accounting"
 *    - Description: "Complete initial Tekion ARC build according to the requirements outlined in the Accounting Blueprint"
 *      (or name is "Blueprint Configuration" + description includes "accounting blueprint")
 *
 * 2. SERVICE:
 *    - Task Name: "Blueprint Configuration: Service"
 *    - Task Name: "Blueprint Configuration" + description includes "service blueprint"
 *
 * 3. PARTS:
 *    - Task Name: "Blueprint Configuration: Parts"
 *    - Task Name: "Blueprint Configuration" + description includes "parts blueprint"
 */
function moduleForTask(task: TapTask): TapBlueprintModule | null {
  const name = normalize(task.taskName).toLowerCase();
  const desc = normalize(task.descriptionPlain).toLowerCase();

  // Exclude collateral tasks (sign-offs, reviews, trainings, hardware, scanners, etc.)
  const isExcluded =
    name.includes("sign-off") ||
    name.includes("signoff") ||
    name.includes("review") ||
    name.includes("validation") ||
    name.includes("checklist") ||
    name.includes("training") ||
    name.includes("hardware") ||
    name.includes("scanner") ||
    name.includes("pre-build") ||
    name.includes("post-build") ||
    desc.includes("sign-off") ||
    desc.includes("review");

  if (isExcluded) return null;

  // 1. ACCOUNTING
  if (
    name === "blueprint configuration - accounting" ||
    name === "blueprint configuration: accounting" ||
    (name === "blueprint configuration" && desc.includes("accounting blueprint"))
  ) {
    return "accounting";
  }

  // 2. SERVICE
  if (
    name === "blueprint configuration: service" ||
    (name === "blueprint configuration" && desc.includes("service blueprint"))
  ) {
    return "service";
  }

  // 3. PARTS
  if (
    name === "blueprint configuration: parts" ||
    (name === "blueprint configuration" && desc.includes("parts blueprint"))
  ) {
    return "parts";
  }

  return null;
}

/**
 * Enforces a maximum of 35 IDs per chunk call on /tasks/get.
 */
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
        `[tapTasksApi] 📥 Batch chunk ${chunkIndex}/${totalChunks} resolved (Items: ${batchCount}, Total: ${collected.length})`
      );
    } catch (err) {
      console.warn(
        `[tapTasksApi] ⚠️ Chunk ${chunkIndex}/${totalChunks} skipped due to rejection`,
        err
      );
    }
  }

  return collected;
}

/**
 * Discovers and indexes ONLY the 3 Blueprint task IDs for a store.
 * Strictly guarantees a maximum of 1 task per module (Parts: 1, Service: 1, Accounting: 1).
 */
export async function discoverAndIndexBlueprintTaskIds(
  store: StoreRecord
): Promise<BlueprintTaskIndex | null> {
  const primaryId = Number(store.onboarding_project_id);
  const altId = Number(store.ds_onboarding_project_id);
  const effectiveId = Number.isFinite(primaryId) && primaryId > 0 ? primaryId : altId;

  if (!Number.isFinite(effectiveId) || effectiveId <= 0) return null;

  try {
    const groupsResponse = await proxyJson<unknown>(
      `${TAP_API_BASE}/projects/${encodeURIComponent(String(effectiveId))}/groups/`,
      "POST",
      {
        filters: [{ field: "status", operator: "in", value: ["new", "inprogress", "completed", "duplicate"] }],
        sort: { field: "due_date", order: "asc" },
        groupBy: { field: "implementation_stage" },
        viewId: 4126,
        includeSubtasks: true,
      },
      { tenantId: store.tenant_id, dealerId: store.dealer_id, tenantCode: store.tenant_code },
      true
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

    if (candidateIds.length === 0) {
      console.warn(
        `%c⚠️ #${store.dealer_id} (${store.dba_name}): 0 task IDs found in groups (Project #${effectiveId}).`,
        "color: #facc15;"
      );
      return null;
    }

    console.info(
      `[tapTasksApi] 🔍 Discovered ${candidateIds.length} candidate tasks for Dealer #${store.dealer_id} (Project #${effectiveId})`
    );

    const rawTasks = await fetchTasksInChunks(candidateIds, {
      tenantId: store.tenant_id,
      dealerId: store.dealer_id,
      tenantCode: store.tenant_code,
    });

    const partsTaskIds: number[] = [];
    const serviceTaskIds: number[] = [];
    const accountingTaskIds: number[] = [];

    for (const raw of rawTasks) {
      const task = toTapTask(raw);
      if (!task) continue;

      const mod = moduleForTask(task);
      // Strictly enforce exactly 1 task per module
      if (mod === "parts" && partsTaskIds.length === 0) {
        partsTaskIds.push(task.taskId);
      } else if (mod === "service" && serviceTaskIds.length === 0) {
        serviceTaskIds.push(task.taskId);
      } else if (mod === "accounting" && accountingTaskIds.length === 0) {
        accountingTaskIds.push(task.taskId);
      }
    }

    const partsStr = partsTaskIds.length > 0 ? `Available (#${partsTaskIds.join(", #")})` : "Not Available";
    const serviceStr = serviceTaskIds.length > 0 ? `Available (#${serviceTaskIds.join(", #")})` : "Not Available";
    const acctStr = accountingTaskIds.length > 0 ? `Available (#${accountingTaskIds.join(", #")})` : "Not Available";

    if (partsTaskIds.length > 0 || serviceTaskIds.length > 0 || accountingTaskIds.length > 0) {
      console.log(
        `%c✅ #${store.dealer_id} (${store.dba_name}): Parts: ${partsStr} | Service: ${serviceStr} | Accounting: ${acctStr}`,
        "color: #4ade80; font-weight: bold;"
      );

      return {
        partsTaskIds,
        serviceTaskIds,
        accountingTaskIds,
        discoveredAt: new Date().toISOString(),
      };
    } else {
      console.warn(
        `%c⚠️ #${store.dealer_id} (${store.dba_name}): No Blueprint tasks found among ${candidateIds.length} candidates.`,
        "color: #facc15;"
      );
      return null;
    }
  } catch (err: any) {
    console.error(`%c❌ Discovery Failure on #${store.dealer_id} (${store.dba_name})`, "color: #f87171; font-weight: bold;", {
      dealerId: store.dealer_id,
      dealerName: store.dba_name,
      projectId: effectiveId,
      errorMessage: err?.message || String(err),
      status: err?.upstreamStatus ?? err?.status,
      rawResponse: err?.rawResponse ?? err?.response ?? err,
    });
    return null;
  }
}

/**
 * Fast-path fetch: If blueprint_task_index exists, queries ONLY those target task IDs in 1 request.
 * Strictly guarantees maximum 1 task per module in the returned result set.
 */
export async function fetchTapBlueprintTasks(
  onboardingProjectId: string | number,
  context?: DealerContextHeaders,
  alternateProjectId?: string | number,
  cachedIndex?: BlueprintTaskIndex | null
): Promise<{ tasks: TapTasksByModule; newlyDiscoveredIndex?: BlueprintTaskIndex }> {
  const primaryId = Number(onboardingProjectId);
  const altId = Number(alternateProjectId);
  const effectiveId = Number.isFinite(primaryId) && primaryId > 0 ? primaryId : altId;

  if (!Number.isFinite(effectiveId) || effectiveId <= 0) {
    throw new TapTaskApiError("TAP task functions is not working. Missing project ID.");
  }

  // FAST PATH: Direct query via cached task IDs
  if (
    cachedIndex &&
    (cachedIndex.partsTaskIds.length > 0 ||
      cachedIndex.serviceTaskIds.length > 0 ||
      cachedIndex.accountingTaskIds.length > 0)
  ) {
    const allTargetIds = Array.from(
      new Set([
        ...cachedIndex.partsTaskIds,
        ...cachedIndex.serviceTaskIds,
        ...cachedIndex.accountingTaskIds,
      ])
    );

    const rawTasks = await fetchTasksInChunks(allTargetIds, context);
    const result: TapTasksByModule = { parts: [], service: [], accounting: [] };

    const partsSet = new Set(cachedIndex.partsTaskIds);
    const serviceSet = new Set(cachedIndex.serviceTaskIds);
    const accountingSet = new Set(cachedIndex.accountingTaskIds);

    for (const raw of rawTasks) {
      const task = toTapTask(raw);
      if (!task) continue;
      // Strictly enforce max 1 per category
      if (partsSet.has(task.taskId) && result.parts.length === 0) result.parts.push(task);
      else if (serviceSet.has(task.taskId) && result.service.length === 0) result.service.push(task);
      else if (accountingSet.has(task.taskId) && result.accounting.length === 0) result.accounting.push(task);
    }

    return { tasks: result };
  }

  // SLOW FALLBACK PATH: One-time discovery
  const groupsResponse = await proxyJson<unknown>(
    `${TAP_API_BASE}/projects/${encodeURIComponent(String(effectiveId))}/groups/`,
    "POST",
    {
      filters: [{ field: "status", operator: "in", value: ["new", "inprogress", "completed", "duplicate"] }],
      sort: { field: "due_date", order: "asc" },
      groupBy: { field: "implementation_stage" },
      viewId: 4126,
      includeSubtasks: true,
    },
    context,
    true
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

  const result: TapTasksByModule = { parts: [], service: [], accounting: [] };
  if (candidateIds.length === 0) return { tasks: result };

  const rawTasks = await fetchTasksInChunks(candidateIds, context);
  const partsTaskIds: number[] = [];
  const serviceTaskIds: number[] = [];
  const accountingTaskIds: number[] = [];

  for (const raw of rawTasks) {
    const task = toTapTask(raw);
    if (!task) continue;

    const mod = moduleForTask(task);
    if (mod === "parts" && partsTaskIds.length === 0) {
      result.parts.push(task);
      partsTaskIds.push(task.taskId);
    } else if (mod === "service" && serviceTaskIds.length === 0) {
      result.service.push(task);
      serviceTaskIds.push(task.taskId);
    } else if (mod === "accounting" && accountingTaskIds.length === 0) {
      result.accounting.push(task);
      accountingTaskIds.push(task.taskId);
    }
  }

  const newlyDiscoveredIndex: BlueprintTaskIndex = {
    partsTaskIds,
    serviceTaskIds,
    accountingTaskIds,
    discoveredAt: new Date().toISOString(),
  };

  return { tasks: result, newlyDiscoveredIndex };
}

/**
 * Every task in the project's "Integrations" implementation-stage group, each with its latest
 * comment. Unlike the blueprint lookup, there is no one-task-per-module limit.
 */
export async function fetchIntegrationTasks(
  onboardingProjectId: string | number,
  context?: DealerContextHeaders,
  alternateProjectId?: string | number,
  onLog?: (message: string) => void
): Promise<TapTask[]> {
  const primaryId = Number(onboardingProjectId);
  const altId = Number(alternateProjectId);
  const effectiveId = Number.isFinite(primaryId) && primaryId > 0 ? primaryId : altId;
  onLog?.(`Project id used: ${Number.isFinite(effectiveId) ? effectiveId : "none"}${effectiveId === altId && effectiveId !== primaryId ? " (alternate)" : ""}`);
  if (!Number.isFinite(effectiveId) || effectiveId <= 0) {
    onLog?.("No valid project id, skipped.");
    return [];
  }

  const groupsResponse = await proxyJson<unknown>(
    `${TAP_API_BASE}/projects/${encodeURIComponent(String(effectiveId))}/groups/`,
    "POST",
    {
      filters: [
        { field: "implementation_stage", operator: "in", value: ["Integrations"] },
        { field: "status", operator: "in", value: ["new", "inprogress", "completed", "duplicate"] },
      ],
      sort: { field: "due_date", order: "asc" },
      groupBy: { field: "implementation_stage" },
      viewId: 4306,
      includeSubtasks: false,
    },
    context,
    true
  );

  if (isRecord(groupsResponse) && Array.isArray(groupsResponse.groups)) {
    const names = groupsResponse.groups.map((g) => (isRecord(g) ? String(g.name ?? g.id ?? "?") : "?"));
    onLog?.(`Groups returned: ${names.length} (${names.join(", ") || "none"})`);
    if (!names.some((n) => n.trim().toLowerCase() === "integrations")) {
      onLog?.(`⚠ No group named "Integrations" in this project's response.`);
    }
  } else {
    onLog?.(`⚠ Unexpected groups response: ${JSON.stringify(groupsResponse).slice(0, 200)}`);
  }

  const ids: number[] = [];
  if (isRecord(groupsResponse) && Array.isArray(groupsResponse.groups)) {
    for (const g of groupsResponse.groups) {
      if (!isRecord(g)) continue;
      const name = String(g.name ?? "").trim().toLowerCase();
      const id = String(g.id ?? "").trim().toLowerCase();
      if (name !== "integrations" && id !== "integrations") continue;
      if (Array.isArray(g.taskIds)) {
        for (const raw of g.taskIds) {
          const fid = toFiniteTaskId(raw);
          if (fid) ids.push(fid);
        }
      }
    }
  }
  const uniqueIds = Array.from(new Set(ids));
  onLog?.(`Integrations group task ids: ${uniqueIds.length}`);
  if (uniqueIds.length === 0) return [];

  const rawTasks = await fetchTasksInChunks(uniqueIds, context);
  onLog?.(`Task details received: ${rawTasks.length}`);
  const tasks: TapTask[] = [];
  let commentFailures = 0;
  for (const raw of rawTasks) {
    const task = toTapTask(raw);
    if (!task) continue;
    let comments: TapTaskCommentItem[] = [];
    try {
      comments = await fetchTapTaskComments(task.taskId, context);
    } catch {
      comments = [];
      commentFailures++;
    }
    task.latestComment = comments.length > 0 ? comments[comments.length - 1] : null;
    tasks.push(task);
  }
  onLog?.(`Integration tasks kept: ${tasks.length}${commentFailures ? ` (comment fetch failed for ${commentFailures})` : ""}`);
  return tasks;
}

export const fetchTapProjectTasks = fetchTapBlueprintTasks;

export async function updateTapTaskStatus(
  taskId: number,
  status: "inprogress" | "completed" | "new",
  context?: DealerContextHeaders
): Promise<void> {
  await proxyJson<unknown>(
    `${TAP_API_BASE}/tasks/${encodeURIComponent(String(taskId))}`,
    "PUT",
    { status },
    context
  );
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

  const payload = {
    comments: [
      {
        type: "comment",
        content: toRichTextComment(trimmedText, validMentions),
        mentions: validMentions.map((mention) => mention.email.toLowerCase().trim()),
      },
    ],
  };

  await proxyJson<unknown>(
    `${TAP_API_BASE}/tasks/${encodeURIComponent(String(taskId))}/comments`,
    "POST",
    payload,
    context
  );
}

export async function uploadTapTaskAttachment(
  taskId: number,
  file: File,
  context?: DealerContextHeaders
): Promise<void> {
  const rawHeaders = buildTapHeaders(context);

  const forwardHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawHeaders)) {
    const lk = k.toLowerCase();
    if (lk !== "content-type" && lk !== "content-length") {
      forwardHeaders[lk] = v;
    }
  }

  forwardHeaders["app-code"] = "wo";
  forwardHeaders["task"] = String(taskId);
  forwardHeaders["x-requested-with"] = "XMLHttpRequest";
  forwardHeaders["accept"] = "*/*";
  if (!forwardHeaders["email"]) {
    forwardHeaders["email"] = "tlreddy@tekion.com";
  }

  if (context?.dealerId) {
    forwardHeaders["dealer-id"] = String(context.dealerId);
    forwardHeaders["dealerid"] = String(context.dealerId);
  }
  if (context?.tenantId) {
    forwardHeaders["tenant-id"] = String(context.tenantId);
  }
  if (context?.tenantCode) {
    forwardHeaders["tenant-code"] = String(context.tenantCode);
  }

  const targetUrl = `${ATTACHMENT_API_BASE}/tasks/${encodeURIComponent(String(taskId))}/attachments`;

  const formData = new FormData();
  formData.append("isDeletable", "true");
  formData.append("file", file, file.name);

  let lastErrorDetail: unknown = null;

  try {
    const proxyStreamResponse = await fetch(
      `/api/proxy/upload?url=${encodeURIComponent(targetUrl)}`,
      {
        method: "POST",
        headers: forwardHeaders,
        body: formData,
      }
    );

    const rawText = await proxyStreamResponse.text();
    let proxyRespData: unknown = rawText;
    if (rawText && (rawText.startsWith("{") || rawText.startsWith("["))) {
      try {
        proxyRespData = JSON.parse(rawText);
      } catch {}
    }

    if (proxyStreamResponse.ok && proxyStreamResponse.status < 400) {
      console.info(`[tapTasksApi] ✅ Uploaded attachment "${file.name}" to Task #${taskId}`);
      return;
    } else {
      lastErrorDetail = {
        method: "proxy-upload-stream",
        status: proxyStreamResponse.status,
        response: proxyRespData,
      };
    }
  } catch (proxyErr) {
    lastErrorDetail = {
      method: "proxy-upload-stream-exception",
      error: String(proxyErr),
    };
  }

  throw new TapTaskApiError(
    `Attachment upload failed: ${JSON.stringify(lastErrorDetail)}`
  );
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
 * Main batch worker executed when clicking 'Sync TAP'.
 */
export async function batchFetchRealTapStatuses(
  stores: (StoreRecord & Record<string, any>)[],
  onProgress?: BatchFetchProgressCallback,
  onStoreUpdated?: (store: StoreRecord & Record<string, any>) => void,
  slaDaysWindow = 7
): Promise<{
  updatedStores: (StoreRecord & Record<string, any>)[];
  updatedCount: number;
  totalSkippedTasks: number;
}> {
  const eligible = stores.filter((s) => Boolean(extractEffectiveProjectId(s)));
  const total = eligible.length;
  let processed = 0;
  let updatedCount = 0;
  let totalSkippedTasks = 0;

  const storeMap = new Map<string, StoreRecord & Record<string, any>>(
    stores.map((s) => [s.tekion_id, { ...s }])
  );

  await fetchTapUsersMap();

  for (let i = 0; i < eligible.length; i++) {
    const store = eligible[i];
    const projectId = extractEffectiveProjectId(store);

    if (!projectId) {
      processed++;
      onProgress?.(processed, total, updatedCount, totalSkippedTasks);
      continue;
    }

    // 1. LOG STORE START
    console.info(
      `[tapTasksApi] 🔄 Syncing Dealer #${store.dealer_id} (${store.dba_name}) [Project #${projectId}] (${i + 1}/${total})...`
    );

    try {
      const { tasks: result, newlyDiscoveredIndex } = await fetchTapBlueprintTasks(
        store.onboarding_project_id || projectId,
        {
          tenantId: store.tenant_id,
          dealerId: store.dealer_id,
          tenantCode: store.tenant_code,
        },
        store.ds_onboarding_project_id,
        store.blueprint_task_index
      );

      // 2. LOG TASK AVAILABILITY PER MODULE
      const partsStr = result.parts.length > 0 ? `Available (#${result.parts.map((t) => t.taskId).join(", #")})` : "Not Available";
      const serviceStr = result.service.length > 0 ? `Available (#${result.service.map((t) => t.taskId).join(", #")})` : "Not Available";
      const acctStr = result.accounting.length > 0 ? `Available (#${result.accounting.map((t) => t.taskId).join(", #")})` : "Not Available";

      console.log(
        `%c[tapTasksApi] 📌 Dealer #${store.dealer_id} (${store.dba_name}) Tasks: Parts: ${partsStr} | Service: ${serviceStr} | Accounting: ${acctStr}`,
        "color: #38bdf8; font-weight: bold;"
      );

      const prevTasks = store.fetched_blueprint_tasks || {};
      const prevByTaskId = new Map<string, any>(
        [
          ...(prevTasks.partsTasks || []),
          ...(prevTasks.serviceTasks || []),
          ...(prevTasks.accountingTasks || []),
        ].map((pt: any) => [String(pt.taskId || pt.id), pt])
      );

      const hydrateList = async (tasks: TapTask[]) => {
        let count = 0;
        let failed = false;

        for (const t of tasks) {
          const tIdStr = String(t.taskId);
          const prev = prevByTaskId.get(tIdStr);

          // Attachment hydration
          if (typeof t.taskAttachmentCount === "number") {
            count += t.taskAttachmentCount;
          } else if (typeof prev?.taskAttachmentCount === "number" && prev.taskAttachmentCount > 0) {
            // Only reuse a known positive count. Earlier failed requests were saved as 0,
            // so zeros are re-checked instead of being reused forever.
            t.taskAttachmentCount = prev.taskAttachmentCount;
            count += (t.taskAttachmentCount ?? 0);
          } else {
            const atts = await fetchTaskAttachmentsOrNull(t.taskId, {
              tenantId: store.tenant_id,
              dealerId: store.dealer_id,
              tenantCode: store.tenant_code,
            });
            if (atts === null) {
              // Request failed: do NOT record 0 (that would be cached and never retried).
              // Keep the previous known count if any, and flag the store as incomplete.
              failed = true;
              t.attachments = prev?.attachments ?? [];
              if (prev?.taskAttachmentCount !== undefined) {
                t.taskAttachmentCount = prev.taskAttachmentCount;
                count += prev.taskAttachmentCount ?? 0;
              }
            } else {
              t.attachments = atts;
              t.taskAttachmentCount = atts.length;
              count += atts.length;
            }
          }

          // Unconditional Comment Hydration: always fetch latest comment
          try {
            const commentsList = await fetchTapTaskComments(t.taskId, {
              tenantId: store.tenant_id,
              dealerId: store.dealer_id,
              tenantCode: store.tenant_code,
            });
            t.latestComment = commentsList.length > 0 ? commentsList[commentsList.length - 1] : null;
          } catch {
            t.latestComment = prev?.latestComment ?? null;
          }
        }

        return { count, failed };
      };

      const parts = await hydrateList(result.parts);
      const service = await hydrateList(result.service);
      const accounting = await hydrateList(result.accounting);

      const fixedOpsAttachments = parts.count + service.count;
      const variableOpsAttachments = accounting.count;

      const realFixedOps = calculateFixedOpsStatus(result);
      const realVariableOps = calculatePhaseStatus(result.accounting);

      const current = storeMap.get(store.tekion_id);
      if (current) {
        current.fixed_ops_status = realFixedOps;
        current.variable_ops_status = realVariableOps;
        current.fixed_ops_attachments = fixedOpsAttachments;
        current.variable_ops_attachments = variableOpsAttachments;
        // Any failed attachment request means the counts may be low; the bot rescans these stores next cycle.
        current.attachments_incomplete = parts.failed || service.failed || accounting.failed;

        if (newlyDiscoveredIndex) {
          current.blueprint_task_index = newlyDiscoveredIndex;
        }

        current.fetched_blueprint_tasks = {
          partsTasks: result.parts,
          serviceTasks: result.service,
          accountingTasks: result.accounting,
          fetchedAt: new Date().toISOString(),
        };

        updatedCount++;
        storeMap.set(store.tekion_id, current);

        try {
          onStoreUpdated?.(current);
        } catch (cbErr) {
          console.warn("[tapTasksApi] onStoreUpdated callback failed", cbErr);
        }
      }
    } catch (err: any) {
      // 3. FULL RAW FAILURE LOG FOR SYNC BUTTON
      console.error(
        `%c[tapTasksApi] ❌ Sync Failure on Dealer #${store.dealer_id} (${store.dba_name})`,
        "color: #f87171; font-weight: bold;",
        {
          dealerId: store.dealer_id,
          dealerName: store.dba_name,
          projectId,
          errorMessage: err?.message || String(err),
          status: err?.upstreamStatus ?? err?.status,
          rawResponse: err?.rawResponse ?? err?.response ?? err,
        }
      );
    } finally {
      processed++;
      onProgress?.(processed, total, updatedCount, totalSkippedTasks);
    }
  }

  return {
    updatedStores: Array.from(storeMap.values()),
    updatedCount,
    totalSkippedTasks,
  };
}