import { hasExpiredCustomToken, loadLatestExtensionCapture, } from "./extensionBridge";
import { loadGlobalHeaders, loadTekionApiSettings } from "./tekionApiSettings";
import { resolveStoreProjectId } from "./storesDb";
const TAP_API_BASE = "https://tapapi.tekioncloud.com/tapapi/task_management/public/v1";
const ATTACHMENT_API_BASE = "https://tapapi.tekioncloud.com/tapapi/tap_document_mgmt/public/v1";
export class TapTaskApiError extends Error {
    constructor(message = "TAP task functions is not working") {
        super(message);
        this.name = "TapTaskApiError";
    }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function normalize(value) {
    return String(value ?? "").trim();
}
/**
 * Safely extracts and converts any ID type (string or number) to a trimmed string
 */
function getCleanId(val) {
    if (val === null || val === undefined)
        return "";
    return String(val).trim();
}
/**
 * Unified helper resolving the strongest available TAP project or tracking ID
 */
export function extractEffectiveProjectId(store) {
    if (!store)
        return "";
    return (resolveStoreProjectId(store) ||
        getCleanId(store.target_entity_instance_id || store.targetEntityInstanceId) ||
        getCleanId(store.project_implementation_tm_sync_status_tracking_id) ||
        getCleanId(store.implementation_tm_sync_status_tracking_id));
}
function normalizeHeaders(input) {
    if (!isRecord(input))
        return {};
    const result = {};
    for (const [key, value] of Object.entries(input)) {
        const headerName = key.trim().toLowerCase();
        const headerValue = normalize(value);
        if (headerName && headerValue) {
            result[headerName] = headerValue;
        }
    }
    return result;
}
function pairsToHeaders(pairs) {
    const result = {};
    for (const pair of pairs) {
        if (!pair.enabled)
            continue;
        const key = normalize(pair.key).toLowerCase();
        const value = normalize(pair.value);
        if (key && value) {
            result[key] = value;
        }
    }
    return result;
}
function selectTapCapture() {
    const settings = loadTekionApiSettings();
    const captures = Object.values(loadLatestExtensionCapture()?.customCaptures ?? {});
    return (captures.find((capture) => capture.id === settings.storesApiCaptureId) ??
        captures.find((capture) => capture.id === settings.storesCustomCaptureId) ??
        captures.find((capture) => {
            const searchable = `${capture.pattern ?? ""} ${capture.matchedUrl ?? ""}`.toLowerCase();
            return (searchable.includes("/entity-instance/1") ||
                searchable.includes("task_management") ||
                searchable.includes("tapapi"));
        }) ??
        null);
}
function buildTapHeaders(context) {
    const capture = selectTapCapture();
    if (!capture) {
        throw new TapTaskApiError("TAP task functions is not working. Capture a current Stores/TAP request and retry.");
    }
    if (hasExpiredCustomToken(capture)) {
        throw new TapTaskApiError("TAP task functions is not working. The captured TAP token has expired; recapture it.");
    }
    const headers = {
        ...normalizeHeaders(capture.headers),
        ...pairsToHeaders(loadGlobalHeaders()),
        accept: "application/json, text/plain, */*",
        origin: "https://tap.tekioncloud.com",
        referer: "https://tap.tekioncloud.com/",
        locale: "en_US",
    };
    if (!headers["email"]) {
        headers["email"] = "tlreddy@tekion.com";
    }
    const explicitDuoToken = localStorage.getItem("tap_duo_api_token") || localStorage.getItem("tap_token");
    if (explicitDuoToken && !headers["tap-duo-api-token"]) {
        headers["tap-duo-api-token"] = explicitDuoToken;
    }
    if (context?.tenantId)
        headers["tenant-id"] = context.tenantId;
    if (context?.dealerId)
        headers["dealer-id"] = context.dealerId;
    if (context?.tenantCode)
        headers["tenant-code"] = context.tenantCode;
    if (!headers.authorization && !headers["tap-duo-api-token"]) {
        throw new TapTaskApiError("TAP task functions is not working. No TAP authorization header was captured.");
    }
    return headers;
}
function summarizeBody(body) {
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
async function proxyJson(url, method, body, context, silent = false, retries = 2) {
    const headers = {
        ...buildTapHeaders(context),
    };
    if (method !== "GET" && method !== "HEAD") {
        headers["content-type"] = "application/json";
    }
    else {
        delete headers["content-type"];
    }
    const startTime = performance.now();
    let response;
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
    }
    catch (error) {
        if (!silent)
            console.error("[tapTasksApi] ❌ Proxy network failure", error);
        throw new TapTaskApiError();
    }
    let wrapper;
    try {
        wrapper = (await response.json());
    }
    catch (error) {
        if (!silent)
            console.error("[tapTasksApi] ❌ Invalid proxy response wrapper", error);
        throw new TapTaskApiError();
    }
    const upstreamStatus = typeof wrapper.status === "number" ? wrapper.status : response.status;
    const elapsedMs = Math.round(performance.now() - startTime);
    if (upstreamStatus === 429 && retries > 0) {
        const backoffMs = (3 - retries) * 1500;
        console.warn(`[tapTasksApi] ⏳ Upstream 429 rate limit. Backing off for ${backoffMs}ms... (${retries} retries left)`);
        await sleep(backoffMs);
        return proxyJson(url, method, body, context, silent, retries - 1);
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
    let parsed = upstreamBody;
    if (typeof upstreamBody === "string") {
        try {
            parsed = JSON.parse(upstreamBody);
        }
        catch {
            parsed = upstreamBody;
        }
    }
    console.info(`[tapTasksApi] 🟢 Success (${upstreamStatus}) ${method} ${url} [${elapsedMs}ms]`, {
        status: upstreamStatus,
        endpoint: url.replace(TAP_API_BASE, "").replace(ATTACHMENT_API_BASE, ""),
        sentPayload: body,
        resolvedSummary: summarizeBody(parsed),
    });
    return parsed;
}
export async function fetchTaskAttachments(taskId, context) {
    return (await fetchTaskAttachmentsOrNull(taskId, context)) ?? [];
}
export async function fetchTaskAttachmentsOrNull(taskId, context) {
    const idNum = toFiniteTaskId(taskId);
    if (!idNum) {
        console.warn(`[tapTasksApi] ⚠️ fetchTaskAttachments called with invalid taskId:`, taskId);
        return null;
    }
    const url = `${ATTACHMENT_API_BASE}/tasks/${idNum}?languageCode=en_US`;
    const rawHeaders = buildTapHeaders(context);
    const headers = {};
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
    const duoToken = localStorage.getItem("tap_duo_api_token") ||
        localStorage.getItem("tap_token") ||
        headers["tap-duo-api-token"];
    if (duoToken) {
        headers["tap-duo-api-token"] = duoToken;
    }
    console.info(`[tapTasksApi] 🚀 CALLING ATTACHMENTS API for task #${idNum} -> ${url}`);
    const MAX_ATTEMPTS = 4;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const res = await fetch("/api/proxy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url,
                    method: "GET",
                    headers,
                    timeout: 30000,
                }),
            });
            const wrapper = await res.json();
            const upstreamStatus = typeof wrapper.status === "number" ? wrapper.status : res.status;
            if (upstreamStatus === 429 || upstreamStatus >= 500) {
                if (attempt < MAX_ATTEMPTS) {
                    await sleep(attempt * 1500);
                    continue;
                }
                console.warn(`[tapTasksApi] ⚠️ Task #${idNum} attachments failed after retries (${upstreamStatus})`);
                return null;
            }
            if (upstreamStatus >= 400) {
                console.warn(`[tapTasksApi] ⚠️ Upstream error ${upstreamStatus} on task #${idNum}:`, wrapper.body);
                return null;
            }
            let parsed = wrapper.body;
            if (typeof parsed === "string") {
                try {
                    parsed = JSON.parse(parsed);
                }
                catch {
                    return null;
                }
            }
            const list = Array.isArray(parsed)
                ? parsed
                : Array.isArray(parsed?.data)
                    ? parsed.data
                    : Array.isArray(parsed?.attachments)
                        ? parsed.attachments
                        : [];
            console.info(`[tapTasksApi] ✅ Task #${idNum} resolved ${list.length} attachment(s)`);
            return list;
        }
        catch (error) {
            if (attempt < MAX_ATTEMPTS) {
                await sleep(attempt * 1500);
                continue;
            }
            console.error(`[tapTasksApi] ❌ Exception fetching attachments for task #${idNum}:`, error);
            return null;
        }
    }
    return null;
}
function toFiniteTaskId(value) {
    const id = Number(value);
    return Number.isFinite(id) && id > 0 ? id : null;
}
function toMembership(value) {
    if (!isRecord(value))
        return null;
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
function toTapTask(value) {
    if (!isRecord(value))
        return null;
    const taskId = toFiniteTaskId(value.taskId ?? value.id);
    if (taskId == null)
        return null;
    const memberships = Array.isArray(value.memberships)
        ? value.memberships
            .map(toMembership)
            .filter((membership) => membership !== null)
        : [];
    const dueDateRaw = value.dueDate ?? value.due_date;
    const dueDate = typeof dueDateRaw === "number" && Number.isFinite(dueDateRaw) ? dueDateRaw : null;
    const countRaw = value.taskAttachmentCount ?? value.attachmentCount;
    const taskAttachmentCount = typeof countRaw === "number" && Number.isFinite(countRaw) ? countRaw : undefined;
    return {
        taskId,
        taskName: normalize(value.taskName ?? value.name ?? value.title),
        descriptionPlain: normalize(value.descriptionPlain ?? value.description ?? value.desc),
        status: normalize(value.status).toLowerCase() || "new",
        dueDate,
        memberships,
        taskAttachmentCount,
    };
}
function belongsToDsOnboardingProject(task, targetProjectId, fallbackProjectId) {
    if (!task.memberships || task.memberships.length === 0)
        return true;
    return task.memberships.some((membership) => {
        const isDs = !membership.team?.teamName || membership.team.teamName.includes("Onboarding");
        const pId = Number(membership.project?.projectId);
        const isProj = !membership.project?.projectId ||
            pId === targetProjectId ||
            (fallbackProjectId ? pId === fallbackProjectId : false);
        return isDs && isProj;
    });
}
function moduleForTask(task) {
    const taskName = normalize(task.taskName).toLowerCase();
    const description = normalize(task.descriptionPlain).toLowerCase();
    const isExcluded = taskName.includes("sign-off") ||
        taskName.includes("signoff") ||
        taskName.includes("review") ||
        taskName.includes("validation") ||
        taskName.includes("checklist") ||
        taskName.includes("training") ||
        taskName.includes("hardware") ||
        taskName.includes("scanner");
    if (isExcluded)
        return null;
    if (taskName === "blueprint configuration - accounting" ||
        (taskName.startsWith("blueprint configuration") && taskName.includes("accounting")) ||
        (taskName === "blueprint configuration" && description.includes("accounting"))) {
        return "accounting";
    }
    if (taskName === "blueprint configuration - parts" ||
        (taskName.startsWith("blueprint configuration") && taskName.includes("parts")) ||
        (taskName === "blueprint configuration" && description.includes("parts"))) {
        return "parts";
    }
    if (taskName === "blueprint configuration - service" ||
        (taskName.startsWith("blueprint configuration") && taskName.includes("service")) ||
        (taskName === "blueprint configuration" && description.includes("service"))) {
        return "service";
    }
    return null;
}
async function fetchTasksInChunks(taskIds, context) {
    const CHUNK_SIZE = 35;
    const collected = [];
    const totalChunks = Math.ceil(taskIds.length / CHUNK_SIZE);
    for (let i = 0; i < taskIds.length; i += CHUNK_SIZE) {
        const chunkIndex = Math.floor(i / CHUNK_SIZE) + 1;
        const chunk = taskIds.slice(i, i + CHUNK_SIZE);
        try {
            const batch = await proxyJson(`${TAP_API_BASE}/tasks/get`, "POST", {
                tasks: chunk,
                isAppendTasks: true,
            }, context, true);
            let batchCount = 0;
            if (Array.isArray(batch)) {
                collected.push(...batch);
                batchCount = batch.length;
            }
            else if (isRecord(batch)) {
                if (Array.isArray(batch.tasks)) {
                    collected.push(...batch.tasks);
                    batchCount = batch.tasks.length;
                }
                else if (Array.isArray(batch.data)) {
                    collected.push(...batch.data);
                    batchCount = batch.data.length;
                }
                else if (Array.isArray(batch.taskList)) {
                    collected.push(...batch.taskList);
                    batchCount = batch.taskList.length;
                }
            }
            console.info(`[tapTasksApi] 📥 Batch chunk ${chunkIndex}/${totalChunks} resolved`, {
                requestedIdsCount: chunk.length,
                receivedTasksCount: batchCount,
                totalCollectedSoFar: collected.length,
            });
        }
        catch (err) {
            console.warn(`[tapTasksApi] ⚠️ Chunk ${chunkIndex}/${totalChunks} skipped due to upstream rejection`, err);
        }
        if (i + CHUNK_SIZE < taskIds.length) {
            await sleep(100);
        }
    }
    return collected;
}
export async function fetchTapBlueprintTasks(onboardingProjectId, context, alternateProjectId) {
    const primaryId = Number(onboardingProjectId);
    const altId = Number(alternateProjectId);
    const effectiveId = Number.isFinite(primaryId) && primaryId > 0 ? primaryId : altId;
    if (!Number.isFinite(effectiveId) || effectiveId <= 0) {
        throw new TapTaskApiError("TAP task functions is not working. Both onboarding_project_id and ds_onboarding_project_id are missing.");
    }
    console.info(`[tapTasksApi] 🚀 Querying project groups for ID: ${effectiveId} (Alt: ${altId || "none"})`, {
        effectiveId,
        dealerContext: context,
    });
    const groupsResponse = await proxyJson(`${TAP_API_BASE}/projects/${encodeURIComponent(String(effectiveId))}/groups/`, "POST", {
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
    }, context);
    const candidateIds = [];
    if (isRecord(groupsResponse) && Array.isArray(groupsResponse.groups)) {
        for (const g of groupsResponse.groups) {
            if (isRecord(g) && Array.isArray(g.taskIds)) {
                for (const id of g.taskIds) {
                    const fid = toFiniteTaskId(id);
                    if (fid)
                        candidateIds.push(fid);
                }
            }
        }
    }
    console.info(`[tapTasksApi] 🔍 Discovered ${candidateIds.length} task IDs across groups`, {
        effectiveId,
        taskIdsSample: candidateIds.slice(0, 10),
    });
    const result = { parts: [], service: [], accounting: [] };
    if (candidateIds.length === 0)
        return result;
    const rawTasks = await fetchTasksInChunks(candidateIds, context);
    for (const raw of rawTasks) {
        const task = toTapTask(raw);
        if (!task || !belongsToDsOnboardingProject(task, effectiveId, altId))
            continue;
        const mod = moduleForTask(task);
        if (mod) {
            result[mod].push(task);
        }
    }
    console.info(`[tapTasksApi] 🎯 Blueprint Tasks Successfully Mapped`, {
        effectiveId,
        totalRawTasksReceived: rawTasks.length,
        parts: result.parts.map((t) => ({ id: t.taskId, name: t.taskName, status: t.status })),
        service: result.service.map((t) => ({ id: t.taskId, name: t.taskName, status: t.status })),
        accounting: result.accounting.map((t) => ({ id: t.taskId, name: t.taskName, status: t.status })),
    });
    return result;
}
export const fetchTapProjectTasks = fetchTapBlueprintTasks;
export async function updateTapTaskStatus(taskId, status, context) {
    console.info(`[tapTasksApi] 🔄 Updating task #${taskId} status to "${status}"...`);
    const response = await proxyJson(`${TAP_API_BASE}/tasks/${encodeURIComponent(String(taskId))}`, "PUT", { status }, context);
    console.info(`[tapTasksApi] ✅ Task #${taskId} status successfully set to "${status}"`, {
        taskId,
        status,
        response,
    });
}
function toRichTextComment(text, mentions) {
    let cleanedText = text;
    const mentionNodes = [];
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
    const paragraphBlocks = [];
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
function uniqueMentions(mentions) {
    const seen = new Set();
    return mentions.filter((mention) => {
        const email = normalize(mention.email).toLowerCase();
        if (!email || seen.has(email))
            return false;
        seen.add(email);
        return true;
    });
}
export async function postTapTaskComment(taskId, text, mentions = [], context) {
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
    const response = await proxyJson(`${TAP_API_BASE}/tasks/${encodeURIComponent(String(taskId))}/comments`, "POST", payload, context);
    console.info(`[tapTasksApi] ✅ Comment posted successfully to task #${taskId}`, {
        taskId,
        response,
    });
}
function readAsBase64(file) {
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
export async function uploadTapTaskAttachment(taskId, file, context) {
    const headers = buildTapHeaders(context);
    delete headers["content-type"];
    console.info(`[tapTasksApi] 📎 Uploading attachment to task #${taskId}...`, {
        taskId,
        fileName: file.name,
        fileSizeKb: Math.round(file.size / 1024),
        dealerContext: context,
    });
    let base64;
    try {
        base64 = await readAsBase64(file);
    }
    catch (error) {
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
    let lastError = null;
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
            const wrapper = (await response.json());
            const upstreamStatus = typeof wrapper.status === "number" ? wrapper.status : response.status;
            if (response.ok && upstreamStatus < 400) {
                console.info(`[tapTasksApi] 🟢 Success (${upstreamStatus}) POST attachment to task #${taskId}`, {
                    taskId,
                    fileName: file.name,
                    urlUsed: candidate.url,
                    fieldNameUsed: candidate.fieldName,
                    responseBody: wrapper.body,
                });
                succeeded = true;
                break;
            }
            else {
                lastError = wrapper.body;
            }
        }
        catch (err) {
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
export function normalizeTaskStatus(status) {
    const value = String(status ?? "new").trim().toLowerCase();
    if (value === "inprogress" || value === "completed" || value === "duplicate") {
        return value;
    }
    return "new";
}
export function calculatePhaseStatus(tasks) {
    const statuses = tasks.map((task) => normalizeTaskStatus(task.status));
    if (statuses.length === 0 || statuses.every((status) => status === "new")) {
        return "TO DO";
    }
    if (statuses.every((status) => status === "completed")) {
        return "Completed";
    }
    return "WIP";
}
export function calculateFixedOpsStatus(tasks) {
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
 * Task-Level Granular Diffing Engine:
 * - Queries lightweight task metadata for each store.
 * - Indexes previous tasks in memory by taskId.
 * - If status is unchanged and attachments are already loaded, REUSES them immediately without network calls.
 * - Only queries attachments for newly discovered or updated tasks.
 */
export async function batchFetchRealTapStatuses(stores, onProgress, onStoreUpdated) {
    const eligible = stores.filter((s) => Boolean(extractEffectiveProjectId(s)));
    console.info(`[tapTasksApi] batchFetchRealTapStatuses starting for ${eligible.length} eligible stores`);
    const total = eligible.length;
    let processed = 0;
    let updatedCount = 0;
    let totalSkippedTasks = 0;
    const storeMap = new Map(stores.map((s) => [s.tekion_id, { ...s }]));
    for (let i = 0; i < eligible.length; i++) {
        const store = eligible[i];
        const projectId = extractEffectiveProjectId(store);
        if (!projectId) {
            processed++;
            onProgress?.(processed, total, updatedCount, totalSkippedTasks);
            continue;
        }
        try {
            console.info(`[tapTasksApi] Fetching blueprint tasks for store ${store.dba_name} (Resolved Project ID: ${projectId})`);
            const result = await fetchTapBlueprintTasks(store.onboarding_project_id || projectId, {
                tenantId: store.tenant_id,
                dealerId: store.dealer_id,
                tenantCode: store.tenant_code,
            }, store.ds_onboarding_project_id);
            console.info(`[tapTasksApi] Tasks found for ${store.dba_name}:`, {
                parts: result.parts.length,
                service: result.service.length,
                accounting: result.accounting.length,
            });
            const prevTasks = store.fetched_blueprint_tasks || {};
            const prevByTaskId = new Map([
                ...(prevTasks.partsTasks || []),
                ...(prevTasks.serviceTasks || []),
                ...(prevTasks.accountingTasks || []),
            ].map((pt) => [String(pt.taskId || pt.id), pt]));
            // TASK-LEVEL GRANULAR DIFFING HYDRATION
            const hydrateList = async (tasks) => {
                let count = 0;
                let failed = false;
                for (const t of tasks) {
                    const tIdStr = String(t.taskId);
                    const currentStatus = String(t.status || "new").toLowerCase();
                    const prev = prevByTaskId.get(tIdStr);
                    const isAttachmentResolved = prev?.attachments !== undefined && Array.isArray(prev.attachments);
                    const isStatusUnchanged = prev && String(prev.status || "").toLowerCase() === currentStatus;
                    // Reuse cache if attachments are loaded and status is unchanged
                    if (isAttachmentResolved && isStatusUnchanged) {
                        totalSkippedTasks++;
                        t.attachments = prev.attachments;
                        t.taskAttachmentCount =
                            prev.taskAttachmentCount ?? prev.attachments.length;
                        count += t.taskAttachmentCount ?? 0;
                        continue;
                    }
                    // Fetch only if new, status-changed, or attachments missing
                    const atts = await fetchTaskAttachmentsOrNull(t.taskId, {
                        tenantId: store.tenant_id,
                        dealerId: store.dealer_id,
                        tenantCode: store.tenant_code,
                    });
                    if (atts === null) {
                        failed = true;
                        if (prev) {
                            t.attachments = prev.attachments;
                            t.taskAttachmentCount = Number(prev.taskAttachmentCount ?? prev.attachments?.length ?? 0);
                        }
                        else {
                            t.taskAttachmentCount = 0;
                        }
                    }
                    else {
                        t.attachments = atts;
                        t.taskAttachmentCount = atts.length;
                    }
                    count += t.taskAttachmentCount ?? 0;
                    await sleep(150);
                }
                return { count, failed };
            };
            const parts = await hydrateList(result.parts);
            const service = await hydrateList(result.service);
            const accounting = await hydrateList(result.accounting);
            if (parts.failed || service.failed || accounting.failed) {
                console.warn(`[tapTasksApi] Some attachment lookups failed for ${store.dba_name}; kept previous counts where available`);
            }
            const fixedOpsAttachments = (parts.failed || service.failed) && typeof store.fixed_ops_attachments === "number"
                ? Math.max(store.fixed_ops_attachments, parts.count + service.count)
                : parts.count + service.count;
            const variableOpsAttachments = accounting.failed && typeof store.variable_ops_attachments === "number"
                ? Math.max(store.variable_ops_attachments, accounting.count)
                : accounting.count;
            const realFixedOps = calculateFixedOpsStatus(result);
            const realVariableOps = calculatePhaseStatus(result.accounting);
            const current = storeMap.get(store.tekion_id);
            if (current) {
                current.fixed_ops_status = realFixedOps;
                current.variable_ops_status = realVariableOps;
                const fixedUnknown = (parts.failed || service.failed) && typeof store.fixed_ops_attachments !== "number";
                const varUnknown = accounting.failed && typeof store.variable_ops_attachments !== "number";
                if (!fixedUnknown)
                    current.fixed_ops_attachments = fixedOpsAttachments;
                if (!varUnknown)
                    current.variable_ops_attachments = variableOpsAttachments;
                current.fetched_blueprint_tasks = {
                    partsTasks: result.parts,
                    serviceTasks: result.service,
                    accountingTasks: result.accounting,
                    fetchedAt: new Date().toISOString(),
                };
                current.attachments_incomplete =
                    parts.failed || service.failed || accounting.failed;
                updatedCount++;
                storeMap.set(store.tekion_id, current);
                try {
                    onStoreUpdated?.(current);
                }
                catch (cbErr) {
                    console.warn("[tapTasksApi] onStoreUpdated callback failed", cbErr);
                }
            }
        }
        catch (err) {
            console.warn(`[tapTasksApi] Could not sync TAP tasks for store #${store.dealer_id}`, err);
        }
        finally {
            processed++;
            onProgress?.(processed, total, updatedCount, totalSkippedTasks);
        }
        if (i + 1 < eligible.length) {
            await sleep(250);
        }
    }
    return {
        updatedStores: Array.from(storeMap.values()),
        updatedCount,
        totalSkippedTasks,
    };
}
