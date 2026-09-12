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
}

const DM_CHANNEL_CACHE_KEY = "arc-slack-dm-channel-cache-v1";

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
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  result.push(current.trim());
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
    `• Parts Blueprint: ${getBlueprintStatusLabel(parts)}`,
    `• Service Blueprint: ${getBlueprintStatusLabel(service)}`,
    `• Accounting Blueprint: ${getBlueprintStatusLabel(accounting)}`,
  ];
}

function buildDefaultSlackMessage(row: StoreRecord): string {
  const dealership = normalize(row.dba_name) || "—";
  const goLive = formatGoLiveDateDDMMYYYY(row.launch_date);
  const tLabel = getTLabel(row.launch_date);
  const blueprintLines = buildBlueprintStatusLines(row.blueprint_statuses);

  const message = [
    ":information_source: Blueprint Status Update",
    "",
    `• Dealership: ${dealership}`,
    `• Go-Live Date: ${goLive}`,
    `• ${tLabel} Days`,
    "",
    "Status:",
    ...blueprintLines,
    "",
    "Please look into this. Thank you.",
  ].join("\n");

  logger.debug("Built default Slack message", {
    dealerId: row.dealer_id,
    dealership,
    rawLaunchDate: row.launch_date,
    formattedGoLive: goLive,
    tLabel,
    blueprintStatuses: row.blueprint_statuses,
    blueprintLines,
    message,
  });

  return message;
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

  logger.debug("Built Slack recipient candidates", {
    dealerId: row.dealer_id,
    recipients: candidates.map((candidate) => ({
      key: candidate.key,
      label: candidate.label,
      email: candidate.normalizedEmail,
      matchedUserId: candidate.matchedUser?.userId,
      matchedFullName: candidate.matchedUser?.fullName,
    })),
  });

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

  const session = {
    slackToken: normalize(capture?.slackToken),
    slackDCookie: normalize(capture?.slackDCookie),
    lastSlackSourceUrl: normalize(capture?.lastSlackSourceUrl) || undefined,
    lastSlackCaptureAt: normalize(capture?.lastSlackCaptureAt) || undefined,
  };

  logger.debug("Resolved Slack session", {
    hasSlackToken: Boolean(session.slackToken),
    hasSlackDCookie: Boolean(session.slackDCookie),
    lastSlackSourceUrl: session.lastSlackSourceUrl,
    lastSlackCaptureAt: session.lastSlackCaptureAt,
  });

  return session;
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
  const keys = [
    normalize(input.userId),
    normalizeEmail(input.email || ""),
  ].filter(Boolean);

  return Array.from(new Set(keys));
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

  logger.info("Cached Slack DM channel", {
    userId: input.userId,
    email: input.email,
    channelId: input.channelId,
    updatedAt,
  });
}

async function proxySlackRequest(input: {
  url: string;
  body: Record<string, unknown>;
}): Promise<SlackApiResponse> {
  const { slackToken, slackDCookie, lastSlackSourceUrl } = getSlackSession();

  if (!slackToken) {
    throw new Error("Slack token is not available in Settings.");
  }

  if (!slackDCookie) {
    throw new Error("Slack d cookie is not available in Settings.");
  }

  const proxyRequest = {
    url: input.url,
    method: "POST",
    headers: {
      Authorization: `Bearer ${slackToken}`,
      "Content-Type": "application/json; charset=utf-8",
      Cookie: `d=${slackDCookie}`,
      Referer: "https://app.slack.com/",
      Origin: "https://app.slack.com",
    },
    body: JSON.stringify(input.body),
    timeout: 60000,
  };

  logger.info("Sending Slack proxy request", {
    url: input.url,
    body: input.body,
    lastSlackSourceUrl,
    proxyRequestHeaderKeys: Object.keys(proxyRequest.headers).sort(),
  });

  const response = await fetch("/api/proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(proxyRequest),
  });

  const rawText = await response.text();

  logger.debug("Slack proxy raw response received", {
    url: input.url,
    httpStatus: response.status,
    httpStatusText: response.statusText,
    rawTextPreview: rawText.slice(0, 500),
  });

  let proxyJson: Record<string, unknown> = {};
  try {
    proxyJson = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
  } catch (error) {
    logger.error("Failed to parse Slack proxy response JSON", {
      url: input.url,
      rawText,
      error,
    });
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

  logger.info("Slack proxy parsed response", {
    url: input.url,
    upstreamStatus,
    upstreamStatusText: proxyJson.statusText,
    slackOk: upstreamBody?.ok,
    slackError: upstreamBody?.error,
    slackChannel: upstreamBody?.channel,
    slackTs: upstreamBody?.ts,
    alreadyOpen: upstreamBody?.already_open,
    noOp: upstreamBody?.no_op,
  });

  if (upstreamStatus >= 400) {
    logger.error("Slack upstream failed", {
      url: input.url,
      upstreamStatus,
      upstreamStatusText: proxyJson.statusText,
      upstreamBody,
    });
    throw new Error(
      upstreamBody?.error || `Slack API failed with upstream HTTP ${upstreamStatus}`
    );
  }

  if (upstreamBody?.ok !== true) {
    logger.error("Slack API returned ok=false", {
      url: input.url,
      upstreamBody,
    });
    throw new Error(upstreamBody?.error || "Slack API returned ok=false");
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
    email: input.email,
    fullName: input.fullName,
  });

  const response = await proxySlackRequest({
    url: "https://slack.com/api/conversations.open",
    body: {
      users: input.userId,
    },
  });

  const channelId =
    typeof response.channel === "string"
      ? response.channel
      : normalize(response.channel?.id);

  if (!channelId) {
    logger.error("Slack conversations.open missing channel id", {
      response,
    });
    throw new Error("Slack conversations.open did not return a valid channel id.");
  }

  cacheDmChannel({
    userId: input.userId,
    email: input.email,
    fullName: input.fullName,
    channelId,
  });

  return channelId;
}

export async function sendSlackMessage(input: {
  userId: string;
  email?: string;
  fullName?: string;
  text: string;
}): Promise<{ channelId: string; ts?: string }> {
  const channelId = await openSlackConversation({
    userId: input.userId,
    email: input.email,
    fullName: input.fullName,
  });

  logger.info("Sending Slack chat.postMessage", {
    userId: input.userId,
    email: input.email,
    fullName: input.fullName,
    channelId,
    textLength: input.text.length,
    textPreview: input.text.slice(0, 300),
  });

  const response = await proxySlackRequest({
    url: "https://slack.com/api/chat.postMessage",
    body: {
      channel: channelId,
      text: input.text,
    },
  });

  return {
    channelId,
    ts: response.ts,
  };
}
