// Option 3: Enterprise password reset.
// Enterprise users are listed through the enterprise endpoint (paged, 200 rows per call).
// Each user gets the default password first. If the server says a special character is
// required, the same user is retried once with the special-character variant.
// Every attempt is recorded (user id, name, password used, result) so the run can be audited.

import type { ArcCustomCapturedApi } from "../../../../services/extensionBridge";

export const ENTERPRISE_USERS_URL =
  "https://preprodapp.tekioncloud.com/api/userservice/u/enterprise/userandroles";
export const UPDATE_PASSWORD_URL =
  "https://preprodapp.tekioncloud.com/api/userservice/u/v2/updatePassword?locale=en_US";

export const ENTERPRISE_PRIMARY_PASSWORD = "Happyday1";
export const ENTERPRISE_FALLBACK_PASSWORD = "Happyday1@";
const PAGE_ROWS = 200;

export interface EnterpriseUser {
  id: string;
  fname?: string | null;
  lname?: string | null;
  displayName?: string | null;
  email?: string | null;
  homeDealerId?: string | null;
  dealer?: Array<{ value?: string; label?: string }> | null;
  type?: number | null;
  active?: boolean | null;
}

export interface EnterpriseResetRecord {
  userId: string;
  name: string;
  email: string;
  homeDealerId: string;
  passwordUsed: string;
  status: "success" | "failed";
  /** Each password tried and what the server said, in order. */
  attempts: Array<{ password: string; ok: boolean; message: string }>;
  finalError: string;
  at: string;
}

export interface ResolvedEnterpriseHeaders {
  headers: Record<string, string>;
  source: string;
}

/**
 * Picks the headers for the enterprise calls. Preference:
 * 1. A Target API Watch Rule capture of the enterprise user-service calls (the browser's own
 *    enterprise session, exactly as it was sent), used unchanged.
 * 2. The saved Settings Global Headers, used unchanged.
 * Dealer fields are NOT swapped: the enterprise session already carries the access needed.
 */
export function resolveEnterpriseHeaders(
  captures: Record<string, ArcCustomCapturedApi> | undefined,
  settingsHeaders: Record<string, string>
): ResolvedEnterpriseHeaders {
  const list = Object.values(captures ?? {});
  const enterprise =
    list.find((c) => (c.matchedUrl || c.pattern || "").includes("/api/userservice/u/enterprise/")) ??
    list.find((c) => (c.matchedUrl || c.pattern || "").includes("/api/userservice/u/")) ??
    null;

  if (enterprise && Object.keys(enterprise.headers ?? {}).length > 0) {
    return {
      headers: { ...enterprise.headers },
      source: `Watch capture "${enterprise.label}" (captured ${enterprise.capturedAt})`,
    };
  }
  return { headers: { ...settingsHeaders }, source: "Settings Global Headers" };
}

export function enterpriseUserName(user: EnterpriseUser): string {
  const full = `${user.fname ?? ""} ${user.lname ?? ""}`.trim();
  return (user.displayName || full || user.email || user.id || "").trim();
}

/** Only the password-policy failure triggers the special-character retry. */
export function needsSpecialCharacter(message: string): boolean {
  return /special character/i.test(message);
}

function enterprisePayload(start: number) {
  return {
    sort: [],
    filters: [
      { field: "active", operator: "IN", values: [true] },
      { field: "type", operator: "NIN", values: [1] },
    ],
    searchText: "",
    groupBy: [],
    includeFields: [],
    searchableFields: [],
    excludeFields: [],
    pageInfo: { start, rows: PAGE_ROWS },
  };
}

/**
 * Loads every enterprise user. The first page returns `data.count`; further pages are
 * requested with start = 200, 400, ... until all rows are collected.
 */
export async function fetchAllEnterpriseUsers(
  headers: Record<string, string>,
  onPage?: (loaded: number, total: number) => void
): Promise<EnterpriseUser[]> {
  const requestHeaders = { ...headers, "content-type": "application/json" };
  const byId = new Map<string, EnterpriseUser>();
  let total = Infinity;

  for (let start = 0; start < total; start += PAGE_ROWS) {
    const response = await fetch(ENTERPRISE_USERS_URL, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(enterprisePayload(start)),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Enterprise user list failed (start ${start}): ${response.status} ${text.substring(0, 160)}`);
    }
    const json = (await response.json()) as {
      data?: { count?: number; userAndRoleResponses?: EnterpriseUser[] };
    };
    if (typeof json.data?.count === "number") total = json.data.count;
    const rows = json.data?.userAndRoleResponses ?? [];
    rows.forEach((u) => {
      if (u?.id) byId.set(u.id, u);
    });
    onPage?.(byId.size, total === Infinity ? byId.size : total);
    if (rows.length === 0) break; // safety stop if the server returns an empty page
  }

  return Array.from(byId.values());
}

async function tryPassword(
  userId: string,
  password: string,
  headers: Record<string, string>
): Promise<{ ok: boolean; message: string }> {
  const response = await fetch(UPDATE_PASSWORD_URL, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ userId, password }),
  });
  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* plain text error */
  }
  if (response.ok && parsed?.status !== "failed") {
    return { ok: true, message: "success" };
  }
  const message =
    parsed?.errorDetails?.displayMessage ||
    parsed?.errorDetails?.key ||
    parsed?.message ||
    text.substring(0, 160) ||
    `HTTP ${response.status}`;
  return { ok: false, message: String(message) };
}

/**
 * Resets one user. Default password first; if the policy needs a special character,
 * retry once with the special-character password. Never retries for other errors.
 */
export async function resetEnterpriseUser(
  user: EnterpriseUser,
  headers: Record<string, string>
): Promise<EnterpriseResetRecord> {
  const attempts: EnterpriseResetRecord["attempts"] = [];
  const base = {
    userId: user.id,
    name: enterpriseUserName(user),
    email: user.email ?? "",
    homeDealerId: user.homeDealerId ?? "",
  };

  const first = await tryPassword(user.id, ENTERPRISE_PRIMARY_PASSWORD, headers);
  attempts.push({ password: ENTERPRISE_PRIMARY_PASSWORD, ok: first.ok, message: first.message });

  if (first.ok) {
    return { ...base, passwordUsed: ENTERPRISE_PRIMARY_PASSWORD, status: "success", attempts, finalError: "", at: new Date().toISOString() };
  }

  if (needsSpecialCharacter(first.message)) {
    const second = await tryPassword(user.id, ENTERPRISE_FALLBACK_PASSWORD, headers);
    attempts.push({ password: ENTERPRISE_FALLBACK_PASSWORD, ok: second.ok, message: second.message });
    return {
      ...base,
      passwordUsed: ENTERPRISE_FALLBACK_PASSWORD,
      status: second.ok ? "success" : "failed",
      attempts,
      finalError: second.ok ? "" : second.message,
      at: new Date().toISOString(),
    };
  }

  return {
    ...base,
    passwordUsed: ENTERPRISE_PRIMARY_PASSWORD,
    status: "failed",
    attempts,
    finalError: first.message,
    at: new Date().toISOString(),
  };
}

/** CSV audit trail: one row per user, with the password used and the outcome. */
export function enterpriseRecordsToCsv(records: EnterpriseResetRecord[]): string {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = ["User ID", "Name", "Email", "Home Dealer", "Password Used", "Result", "Error", "Attempts", "Time"];
  const rows = records.map((r) =>
    [
      r.userId,
      r.name,
      r.email,
      r.homeDealerId,
      r.passwordUsed,
      r.status,
      r.finalError,
      r.attempts.map((a) => `${a.password}=${a.ok ? "ok" : "fail"}`).join(" | "),
      r.at,
    ].map(q).join(",")
  );
  return [header.map(q).join(","), ...rows].join("\r\n");
}
