import slackCsvRaw from "../pages/DATA/Slack.csv?raw";
import { loadLatestExtensionCapture } from "./extensionBridge";
import type { StoreRecord } from "./storesDb";
import type { OnboardingStatus } from "./storeOnboardingStatusApi";

export interface SlackDirectoryUser {
  userId: string;
  fullName: string;
  email: string;
  jobTitle: string;
}

export interface SlackRecipientCandidate {
  key: string;
  label: string;
  rawValue: string;
  normalizedEmail: string;
  matchedUser?: SlackDirectoryUser;
}

export interface SlackDraftContext {
  recipients: SlackRecipientCandidate[];
  defaultSelectedRecipientKeys: string[];
  draftMessage: string;
}

interface SlackApiResponse {
  ok?: boolean;
  error?: string;
  channel?: string | { id?: string };
  ts?: string;
  no_op?: boolean;
  already_open?: boolean;
  upload_url?: string;
  file_id?: string;
  file?: { id?: string; permalink?: string; url_private_download?: string; name?: string };
  files?: Array<{ id?: string; title?: string; permalink?: string; url_private_download?: string }>;
}

const DM_CHANNEL_CACHE_KEY = "arc-slack-dm-channel-cache-v1";
const SLACK_API_BASE = "https://tekion.enterprise.slack.com/api";
const SLACK_CLIENT_ORIGIN = "https://app.slack.com";
export const TEKION_SLACK_TEAM_ID = "T065DVAH2ER";
export const TEKION_SLACK_ENTERPRISE_ID = "E08DG6QMMDG";

const logger = {
  info: (...args: unknown[]) => console.info("[storeSlackHelper]", ...args),
  debug: (...args: unknown[]) => console.debug("[storeSlackHelper]", ...args),
  warn: (...args: unknown[]) => console.warn("[storeSlackHelper]", ...args),
  error: (...args: unknown[]) => console.error("[storeSlackHelper]", ...args),
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeEmail(value: string): string {
  return normalize(value).toLowerCase();
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ""));
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim().replace(/^"|"$/g, ""));
  return result;
}

function loadSlackDirectory(): SlackDirectoryUser[] {
  const lines = slackCsvRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) return [];

  const rows = lines.slice(1);
  const users: SlackDirectoryUser[] = [];

  for (const row of rows) {
    const cols = parseCsvLine(row);
    const userId = normalize(cols[0]);
    const fullName = normalize(cols[1]);
    const email = normalize(cols[2]);
    const jobTitle = normalize(cols[3]);

    if (!userId || !email) continue;

    users.push({
      userId,
      fullName,
      email,
      jobTitle,
    });
  }

  logger.info("Slack directory loaded", {
    rowCount: users.length,
    sample: users.slice(0, 3),
  });

  return users;
}

const SLACK_DIRECTORY = loadSlackDirectory();

function extractEmails(value: string): string[] {
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return Array.from(new Set(matches.map((item) => normalizeEmail(item))));
}

function uniqueNonEmpty(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalize(value)).filter(Boolean)));
}

function parseFlexibleDate(value: string): Date | null {
  const trimmed = normalize(value);
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    const ms = trimmed.length <= 10 ? num * 1000 : num;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const cleaned = trimmed.replace(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+/i, "");
  const date = new Date(cleaned);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatGoLiveDateDDMMYYYY(launchDate: string): string {
  const date = parseFlexibleDate(launchDate);
  if (!date) return normalize(launchDate) || "—";

  const day = `${date.getDate()}`.padStart(2, "0");
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const year = date.getFullYear();

  return `${day}/${month}/${year}`;
}

function getTLabel(launchDate: string): string {
  const date = parseFlexibleDate(launchDate);
  if (!date) return "Unknown";

  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const launchDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffMs = launchDay.getTime() - startToday.getTime();
  const diffDays = Math.round(diffMs / 86400000);

  if (diffDays > 0) return `T-${diffDays}`;
  if (diffDays === 0) return "T";
  return "Launched";
}

function getBlueprintStatusLabel(status: OnboardingStatus): string {
  return status === "COMPLETED" ? "Completed" : "Not Completed";
}

function buildBlueprintStatusLines(
  blueprintStatuses: StoreRecord["blueprint_statuses"]
): string[] {
  const parts = blueprintStatuses?.parts ?? "UNKNOWN";
  const service = blueprintStatuses?.service ?? "UNKNOWN";
  const accounting = blueprintStatuses?.accounting ?? "UNKNOWN";

  return [
    `Parts Blueprint: ${getBlueprintStatusLabel(parts)}`,
    `Service Blueprint: ${getBlueprintStatusLabel(service)}`,
    `Accounting Blueprint: ${getBlueprintStatusLabel(accounting)}`,
  ];
}

function buildDefaultSlackMessage(row: StoreRecord): string {
  const dealership = normalize(row.dba_name) || "—";
  const goLive = formatGoLiveDateDDMMYYYY(row.launch_date);
  const tLabel = getTLabel(row.launch_date);
  const blueprintLines = buildBlueprintStatusLines(row.blueprint_statuses);

  return [
    ":information_source: Blueprint Status Update",
    "",
    `Dealership: ${dealership}`,
    `Go-Live Date: ${goLive}`,
    `${tLabel} Days`,
    "",
    "Status:",
    ...blueprintLines,
    "",
    "Please look into this. Thank you.",
  ].join("\n");
}

function buildRecipientCandidates(row: StoreRecord): SlackRecipientCandidate[] {
  const rawSources: Array<{ key: string; label: string; value: string }> = [
    {
      key: "podLead",
      label: "Pod Lead",
      value: uniqueNonEmpty([
        normalize(row.workorder_consolidated_pdl),
        normalize(row.dealer_pdl),
        normalize(row.arc_pdl),
      ]).join(" "),
    },
    {
      key: "pem",
      label: "PEM",
      value: normalize(row.project_engagement_manager_1781169293313734451),
    },
    {
      key: "fixedOpsPod",
      label: "Fixed Ops POD",
      value: normalize(row.fixed_ops_track_lead_1773369946675032982),
    },
    {
      key: "variableOpsPod",
      label: "Variable Ops POD",
      value: normalize(row.accounting_track_lead_1773369945455468395),
    },
    {
      key: "conversionTrackLead",
      label: "Conversion",
      value: normalize(row.conversion_track_lead_1773369950325147526),
    },
  ];

  const candidates: SlackRecipientCandidate[] = [];

  for (const source of rawSources) {
    const emails = extractEmails(source.value);

    if (emails.length === 0) {
      candidates.push({
        key: source.key,
        label: source.label,
        rawValue: source.value,
        normalizedEmail: "",
      });
      continue;
    }

    emails.forEach((email, index) => {
      const matchedUser = SLACK_DIRECTORY.find(
        (user) => normalizeEmail(user.email) === email
      );

      candidates.push({
        key: emails.length > 1 ? `${source.key}_${index}` : source.key,
        label: source.label,
        rawValue: source.value,
        normalizedEmail: email,
        matchedUser,
      });
    });
  }

  return candidates;
}

export function buildStoreSlackDraftContext(row: StoreRecord): SlackDraftContext {
  const recipients = buildRecipientCandidates(row);
  const draftMessage = buildDefaultSlackMessage(row);

  return {
    recipients,
    defaultSelectedRecipientKeys: recipients
      .filter((recipient) => Boolean(recipient.matchedUser?.userId))
      .map((recipient) => recipient.key),
    draftMessage,
  };
}

export function getSlackSession(): {
  slackToken: string;
  slackDCookie: string;
  lastSlackSourceUrl?: string;
  lastSlackCaptureAt?: string;
} {
  const capture = loadLatestExtensionCapture();

  return {
    slackToken: normalize(capture?.slackToken),
    slackDCookie: normalize(capture?.slackDCookie),
    lastSlackSourceUrl: normalize(capture?.lastSlackSourceUrl) || undefined,
    lastSlackCaptureAt: normalize(capture?.lastSlackCaptureAt) || undefined,
  };
}

type SlackDmChannelCache = Record<
  string,
  {
    channelId: string;
    updatedAt: string;
    userId?: string;
    email?: string;
    fullName?: string;
  }
>;

function loadDmChannelCache(): SlackDmChannelCache {
  try {
    const raw = localStorage.getItem(DM_CHANNEL_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as SlackDmChannelCache;
  } catch (error) {
    logger.warn("Failed to load Slack DM cache", error);
    return {};
  }
}

function saveDmChannelCache(cache: SlackDmChannelCache): void {
  try {
    localStorage.setItem(DM_CHANNEL_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    logger.warn("Failed to save Slack DM cache", error);
  }
}

function buildDmCacheKeys(input: {
  userId?: string;
  email?: string;
}): string[] {
  return [
    normalize(input.userId),
    normalizeEmail(input.email || ""),
  ].filter(Boolean);
}

function getCachedDmChannelId(input: {
  userId?: string;
  email?: string;
}): string {
  const cache = loadDmChannelCache();

  for (const key of buildDmCacheKeys(input)) {
    const hit = cache[key];
    if (hit?.channelId) {
      logger.info("Using cached Slack DM channel", {
        lookupKey: key,
        channelId: hit.channelId,
        cachedAt: hit.updatedAt,
      });
      return hit.channelId;
    }
  }

  return "";
}

function cacheDmChannel(input: {
  userId: string;
  email?: string;
  fullName?: string;
  channelId: string;
}): void {
  const cache = loadDmChannelCache();
  const updatedAt = new Date().toISOString();

  for (const key of buildDmCacheKeys({
    userId: input.userId,
    email: input.email,
  })) {
    cache[key] = {
      channelId: input.channelId,
      updatedAt,
      userId: input.userId,
      email: input.email,
      fullName: input.fullName,
    };
  }

  saveDmChannelCache(cache);
}

function sanitizeSlackCookie(rawCookie: string): string {
  const trimmed = rawCookie.trim();
  if (!trimmed) return "";

  if (trimmed.includes("=")) {
    return trimmed;
  }

  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {}

  return `d=${encodeURIComponent(decoded)}`;
}

async function proxySlackRequest(input: {
  url: string;
  body: Record<string, unknown>;
  teamId?: string;
}): Promise<SlackApiResponse> {
  const { slackToken, slackDCookie, lastSlackCaptureAt } = getSlackSession();

  if (!slackToken) {
    throw new Error("Slack token is not available. Open Slack in your browser to sync credentials.");
  }

  if (!slackDCookie) {
    throw new Error("Slack 'd' cookie is not available. Verify you are logged into Slack.");
  }

  let targetUrl = input.url;
  if (!targetUrl.startsWith("http")) {
    targetUrl = `${SLACK_API_BASE}/${targetUrl.replace(/^\/+/, "")}`;
  }

  const targetTeam = input.teamId || TEKION_SLACK_TEAM_ID;

  const parsedUrl = new URL(targetUrl);
  parsedUrl.searchParams.set("slack_route", `${TEKION_SLACK_ENTERPRISE_ID}:${targetTeam}`);
  targetUrl = parsedUrl.toString();

  const formPayload = new URLSearchParams();
  formPayload.set("token", slackToken);
  formPayload.set("_x_sonic", "true");
  formPayload.set("_x_app_name", "client");
  formPayload.set("client_context_team_id", targetTeam);
  formPayload.set("team_id", targetTeam);

  for (const [key, value] of Object.entries(input.body)) {
    if (value !== undefined && value !== null) {
      formPayload.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
    }
  }

  const cookieHeader = sanitizeSlackCookie(slackDCookie);

  const proxyRequest = {
    url: targetUrl,
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
      "Accept": "*/*",
      "Cookie": cookieHeader,
      "Referer": `${SLACK_CLIENT_ORIGIN}/`,
      "Origin": SLACK_CLIENT_ORIGIN,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
    },
    body: formPayload.toString(),
    timeout: 60000,
  };

  logger.info("Sending Slack request via proxy", {
    targetUrl,
    endpoint: targetUrl.split("/api/")[1] || targetUrl,
    tokenPrefix: `${slackToken.slice(0, 9)}...`,
    tokenLength: slackToken.length,
    hasDCookie: Boolean(slackDCookie),
    capturedAt: lastSlackCaptureAt || "unknown",
  });

  const response = await fetch("/api/proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(proxyRequest),
  });

  const rawText = await response.text();

  let proxyJson: Record<string, unknown> = {};
  try {
    proxyJson = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Slack proxy returned non-JSON response: ${rawText.slice(0, 300)}`);
  }

  const upstreamStatus =
    typeof proxyJson.status === "number" ? proxyJson.status : response.status;

  const upstreamBody =
    typeof proxyJson.body === "string"
      ? (() => {
          try {
            return JSON.parse(proxyJson.body) as SlackApiResponse;
          } catch {
            return { ok: false, error: String(proxyJson.body) } as SlackApiResponse;
          }
        })()
      : ((proxyJson.body as SlackApiResponse | undefined) ??
          (proxyJson as SlackApiResponse));

  if (upstreamStatus >= 400 || upstreamBody?.ok !== true) {
    const errorMsg = upstreamBody?.error || `HTTP ${upstreamStatus}`;
    logger.error("Slack upstream request failed", {
      targetUrl,
      upstreamStatus,
      errorMsg,
    });

    if (errorMsg === "invalid_auth") {
      throw new Error(
        "Slack session token has expired or is invalid. Open Slack (https://app.slack.com) and press Refresh (F5) to re-sync credentials."
      );
    }

    throw new Error(`Slack API Error: ${errorMsg}`);
  }

  return upstreamBody;
}

export async function openSlackConversation(input: {
  userId: string;
  email?: string;
  fullName?: string;
}): Promise<string> {
  const cachedChannelId = getCachedDmChannelId({
    userId: input.userId,
    email: input.email,
  });

  if (cachedChannelId) {
    return cachedChannelId;
  }

  logger.info("Opening Slack DM conversation", {
    userId: input.userId,
    fullName: input.fullName,
  });

  const response = await proxySlackRequest({
    url: `${SLACK_API_BASE}/conversations.open`,
    body: {
      users: input.userId,
    },
  });

  const channelId =
    typeof response.channel === "string"
      ? response.channel
      : normalize(response.channel?.id);

  if (!channelId) {
    throw new Error("Slack conversations.open did not return a valid channel ID.");
  }

  cacheDmChannel({
    userId: input.userId,
    email: input.email,
    fullName: input.fullName,
    channelId,
  });

  return channelId;
}

export interface SendSlackMessageInput {
  userId?: string;
  channelId?: string;
  email?: string;
  fullName?: string;
  text: string;
}

/**
 * Sends a message either to a DM (using userId) or directly to a target channel (using channelId).
 */
export async function sendSlackMessage(
  input: SendSlackMessageInput
): Promise<{ channelId: string; ts?: string }> {
  let targetChannelId = input.channelId;

  if (!targetChannelId) {
    if (!input.userId) {
      throw new Error("Either channelId or userId must be provided to send a Slack message.");
    }
    targetChannelId = await openSlackConversation({
      userId: input.userId,
      email: input.email,
      fullName: input.fullName,
    });
  }

  logger.info("Sending Slack chat.postMessage", {
    channelId: targetChannelId,
    userId: input.userId,
  });

  const response = await proxySlackRequest({
    url: `${SLACK_API_BASE}/chat.postMessage`,
    body: {
      channel: targetChannelId,
      text: input.text,
      client_context_team_id: TEKION_SLACK_TEAM_ID,
      team_id: TEKION_SLACK_TEAM_ID,
    },
  });

  return {
    channelId: targetChannelId,
    ts: response.ts,
  };
}

/** Posts a message directly to a Slack channel using chat.postMessage */
export async function sendSlackChannelMessage(input: {
  channelId: string;
  text: string;
}): Promise<{ ts?: string }> {
  const response = await proxySlackRequest({
    url: `${SLACK_API_BASE}/chat.postMessage`,
    body: {
      channel: input.channelId,
      text: input.text,
      client_context_team_id: TEKION_SLACK_TEAM_ID,
      team_id: TEKION_SLACK_TEAM_ID,
    },
  });
  return { ts: response.ts };
}

export async function sendSlackDocument(input: {
  channelId: string;
  fileName: string;
  fileContent: string;
  initialComment?: string;
  title?: string;
  teamId?: string;
  isBase64?: boolean;
}): Promise<SlackApiResponse> {
  const targetTeamId = input.teamId || TEKION_SLACK_TEAM_ID;

  logger.info("Starting document upload to Slack", {
    channelId: input.channelId,
    fileName: input.fileName,
    teamId: targetTeamId,
  });

  const isXlsx = input.fileName.endsWith(".xlsx") || Boolean(input.isBase64);

  let byteLength: number;
  let base64Content: string;

  if (isXlsx) {
    base64Content = input.fileContent;
    byteLength = Math.round((base64Content.length * 3) / 4);
  } else {
    byteLength = new TextEncoder().encode(input.fileContent).byteLength;
    base64Content = btoa(
      encodeURIComponent(input.fileContent).replace(/%([0-9A-F]{2})/g, (_, p1) =>
        String.fromCharCode(parseInt(p1, 16))
      )
    );
  }

  const getUrlRes = await proxySlackRequest({
    url: `${SLACK_API_BASE}/files.getUploadURLExternal`,
    teamId: targetTeamId,
    body: {
      filename: input.fileName,
      length: byteLength,
      team_id: targetTeamId,
    },
  });

  const uploadUrl = normalize(getUrlRes.upload_url);
  const fileId = normalize(getUrlRes.file_id);

  if (!uploadUrl || !fileId) {
    throw new Error(
      `Slack files.getUploadURLExternal failed: ${getUrlRes.error || "missing upload_url or file_id"}`
    );
  }

  logger.info("Received Slack upload ticket, streaming file payload...", {
    fileId,
    byteLength,
  });

  const mimeType = isXlsx
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "text/html; charset=utf-8";

  const uploadProxyRes = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: uploadUrl,
      method: "POST",
      headers: {},
      timeout: 60000,
      multipartBase64: {
        file: {
          fieldName: "file",
          name: input.fileName,
          type: mimeType,
          base64: base64Content,
        },
      },
    }),
  });

  const uploadWrapper = (await uploadProxyRes.json()) as Record<string, unknown>;
  const uploadStatus =
    typeof uploadWrapper.status === "number"
      ? uploadWrapper.status
      : uploadProxyRes.status;

  if (!uploadProxyRes.ok || uploadStatus >= 400) {
    logger.error("Failed to upload binary payload to Slack storage", {
      uploadStatus,
      body: uploadWrapper.body,
    });
    throw new Error(`Failed to upload file to Slack storage: HTTP ${uploadStatus}`);
  }

  logger.info("Payload uploaded to storage. Completing and publishing to channel...", {
    fileId,
    channelId: input.channelId,
    teamId: targetTeamId,
  });

  const completeRes = await proxySlackRequest({
    url: `${SLACK_API_BASE}/files.completeUploadExternal`,
    teamId: targetTeamId,
    body: {
      files: JSON.stringify([
        {
          id: fileId,
          title: input.title || input.fileName,
        },
      ]),
      channel_id: input.channelId,
      initial_comment: input.initialComment || "",
      team_id: targetTeamId,
      client_context_team_id: targetTeamId,
    },
  });

  logger.info("✅ File successfully published to channel as native attachment card", {
    fileId,
    channelId: input.channelId,
  });

  return completeRes;
}