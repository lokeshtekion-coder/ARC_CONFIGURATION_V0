import type { StoreRecord } from "./storesDb";
import { resolveStoreAssignee } from "./assigneeService";
import {
  getEffectiveGraphToken,
  isTokenExpired,
} from "./storesGraphSync";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SHAREPOINT_DRIVE_ID =
  "b!CtlfXMp9l0y0QRmkSWK2oZqgrpwIJwZEtu62RScE-gY47Sr8CDY7S7HPla3fSuMb";
const SHAREPOINT_ITEM_ID = "01B46CXZ2B7OEFQZBGXZB2IIVHTZ6S475W";

export const WEEKLY_TRACK_SHEET_NAME = "Weekly Track";

export const WEEKLY_TRACK_HEADERS = [
  "Go Live Week",
  "Go Live",
  "T Label",
  "Tekion ID",
  "Dealer ID",
  "Dealership",
  "POD",
  "Queue Flag",
  "Fixed Ops Status",
  "Fixed Ops Assignee",
  "Variable Ops Status",
  "Variable Ops Assignee",
  "Setup Data",
  "Not Worked?",
] as const;

export type WeeklyTrackHeader = (typeof WEEKLY_TRACK_HEADERS)[number];

/* =======================================================================
   HELPERS & DATE MATH
======================================================================= */

function workbookBaseUrl(): string {
  return `${GRAPH_BASE}/drives/${SHAREPOINT_DRIVE_ID}/items/${SHAREPOINT_ITEM_ID}/workbook`;
}

function parseDate(value: string): Date | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const num = Number(value);
    const ms = value.length <= 10 ? num * 1000 : num;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatLaunchDate(value: string): string {
  const d = parseDate(value);
  if (!d) return value || "—";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

function getTDays(value: string): number {
  const d = parseDate(value);
  if (!d) return 9999;
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const launchDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((launchDay.getTime() - startToday.getTime()) / 86400000);
}

function getTLabel(value: string): string {
  const diffDays = getTDays(value);
  if (diffDays > 0) return `T-${diffDays}`;
  if (diffDays === 0) return "T";
  return "Launched";
}

/**
 * Returns clean label like "Oct Wk 3 (10/12 - 10/18)" based on Monday–Sunday window
 */
function getGoLiveWeekLabel(value: string): string {
  const d = parseDate(value);
  if (!d) return "Unknown Week";

  const monthShort = d.toLocaleDateString("en-US", { month: "short" });
  const dayOfMonth = d.getDate();
  const weekNum = Math.ceil(dayOfMonth / 7);

  // Compute Monday of the week
  const dayOfWeek = d.getDay(); // 0 is Sun, 1 is Mon
  const diffToMonday = d.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diffToMonday));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const mStr = `${monday.getMonth() + 1}/${monday.getDate()}`;
  const sStr = `${sunday.getMonth() + 1}/${sunday.getDate()}`;

  return `${monthShort} Wk ${weekNum} (${mStr} - ${sStr})`;
}

function toExcelColumnName(index: number): string {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function isBlueprintDone(status: unknown): boolean {
  if (!status) return false;
  if (typeof status === "string") {
    const s = status.trim().toUpperCase();
    return s === "COMPLETED" || s === "DONE" || s === "COMPLETE";
  }
  return status === true;
}

/* =======================================================================
   GRAPH API UTILS
======================================================================= */

async function graphRequest<T = unknown>(
  path: string,
  token: string,
  init: RequestInit,
  sessionId?: string | null
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (sessionId) {
    headers.set("workbook-session-id", sessionId);
  }

  const res = await fetch(`${workbookBaseUrl()}${path}`, { ...init, headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Graph request failed [${res.status}]: ${txt}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

async function createSession(token: string): Promise<string> {
  const data = await graphRequest<{ id: string }>(
    "/createSession",
    token,
    { method: "POST", body: JSON.stringify({ persistChanges: true }) }
  );
  return data.id;
}

async function closeSession(token: string, sessionId?: string | null): Promise<void> {
  if (!sessionId) return;
  try {
    await graphRequest("/closeSession", token, { method: "POST" }, sessionId);
  } catch {}
}

async function ensureWorksheet(
  token: string,
  sheetName: string,
  sessionId?: string | null
): Promise<void> {
  try {
    await graphRequest(
      "/worksheets/add",
      token,
      { method: "POST", body: JSON.stringify({ name: sheetName }) },
      sessionId
    );
  } catch (err: any) {
    if (err?.message?.includes("ItemAlreadyExists") || err?.message?.includes("already exists")) {
      return;
    }
    try {
      await graphRequest(
        "/worksheets",
        token,
        { method: "POST", body: JSON.stringify({ name: sheetName }) },
        sessionId
      );
    } catch {}
  }
}

async function getUsedRangeDimensions(
  token: string,
  sheetName: string,
  sessionId?: string | null
): Promise<{ rowCount: number; columnCount: number }> {
  try {
    const data = await graphRequest<{ rowCount?: number; columnCount?: number }>(
      `/worksheets/${encodeURIComponent(sheetName)}/usedRange`,
      token,
      { method: "GET" },
      sessionId
    );
    return {
      rowCount: typeof data?.rowCount === "number" ? data.rowCount : 0,
      columnCount: typeof data?.columnCount === "number" ? data.columnCount : 0,
    };
  } catch {
    return { rowCount: 0, columnCount: 0 };
  }
}

async function clearWorksheetRect(
  token: string,
  sheetName: string,
  rowCount: number,
  columnCount: number,
  sessionId?: string | null
): Promise<void> {
  if (rowCount <= 0 || columnCount <= 0) return;
  const CHUNK = 500;
  let currentRow = 1;
  let remaining = rowCount;

  while (remaining > 0) {
    const take = Math.min(CHUNK, remaining);
    const blanks = Array.from({ length: take }, () =>
      Array.from({ length: columnCount }, () => "")
    );
    const endCol = toExcelColumnName(columnCount - 1);
    const address = `A${currentRow}:${endCol}${currentRow + take - 1}`;

    await graphRequest(
      `/worksheets/${encodeURIComponent(sheetName)}/range(address='${address}')`,
      token,
      { method: "PATCH", body: JSON.stringify({ values: blanks }) },
      sessionId
    );
    currentRow += take;
    remaining -= take;
  }
}

/* =======================================================================
   FILTER & MAPPING LOGIC
======================================================================= */

interface WeeklyTrackCandidate {
  store: StoreRecord;
  isFixedOpsReady: boolean;
  isVariableOpsReady: boolean;
  queueFlag: "Both Ready" | "Fixed Only" | "Variable Only";
}

function evaluateWeeklyTrackCandidate(store: StoreRecord): WeeklyTrackCandidate | null {
  // 1. Pod Filter: Must be POD 1, 2, or 3
  const pod = String(store.superpod_id || "").toLowerCase().trim();
  const isEligiblePod =
    pod === "1" ||
    pod === "2" ||
    pod === "3" ||
    pod === "pod 1" ||
    pod === "pod 2" ||
    pod === "pod 3" ||
    pod.includes("pod 1") ||
    pod.includes("pod 2") ||
    pod.includes("pod 3");

  if (!isEligiblePod) return null;

  // 2. Launch window: T <= 90 days and has not passed already
  const tDays = getTDays(store.launch_date);
  if (tDays > 90 || tDays < 0) return null;

  // 3. Evaluate "Not Worked" / Out of Scope (OFS) flags
  const notWorked = String(store.not_worked || "").trim().toLowerCase();

  // Entire store excluded
  if (notWorked === "enterprise") return null;

  // Check track-specific exclusions
  const isFixedExcluded =
    notWorked.includes("fixed + variable") ||
    notWorked.includes("fixed ops ofs") ||
    notWorked.includes("fixed ops handled by pod");

  const isVariableExcluded =
    notWorked.includes("fixed + variable") ||
    notWorked.includes("variable ops ofs") ||
    notWorked.includes("variable ops handled by pod");

  // 4. Condition A: Fixed Ops Trigger
  const partsDone = isBlueprintDone(store.blueprint_statuses?.parts);
  const serviceDone = isBlueprintDone(store.blueprint_statuses?.service);
  const fixedOpsDone = (store.fixed_ops_status || "").trim().toUpperCase() === "COMPLETED";

  const isFixedOpsReady = !isFixedExcluded && partsDone && serviceDone && !fixedOpsDone;

  // 5. Condition B: Variable Ops (Accounting) Trigger
  const accountingDone = isBlueprintDone(store.blueprint_statuses?.accounting);
  const coaCount = store.setup_data?.coaAccessibleDealerCount ?? 0;
  const isSetupYes = !store.setup_data_error && coaCount > 50;
  const variableOpsDone = (store.variable_ops_status || "").trim().toUpperCase() === "COMPLETED";

  const isVariableOpsReady = !isVariableExcluded && accountingDone && isSetupYes && !variableOpsDone;

  // If neither track needs actionable work, skip
  if (!isFixedOpsReady && !isVariableOpsReady) return null;

  let queueFlag: "Both Ready" | "Fixed Only" | "Variable Only" = "Both Ready";
  if (isFixedOpsReady && isVariableOpsReady) {
    queueFlag = "Both Ready";
  } else if (isFixedOpsReady) {
    queueFlag = "Fixed Only";
  } else {
    queueFlag = "Variable Only";
  }

  return {
    store,
    isFixedOpsReady,
    isVariableOpsReady,
    queueFlag,
  };
}

function mapCandidateToRow(candidate: WeeklyTrackCandidate): string[] {
  const { store, isFixedOpsReady, isVariableOpsReady, queueFlag } = candidate;

  const coa = store.setup_data?.coaAccessibleDealerCount;
  const setupStatus = store.setup_data_error
    ? "Unable to fetch"
    : coa == null
    ? "Unable to fetch"
    : coa > 50
    ? "Yes"
    : "Issue with COA";

  const fixedAssignee = resolveStoreAssignee(store) || store.custom_assignee || "Unassigned";
  const variableAssignee = store.custom_variable_assignee || "Unassigned";

  const notWorked = String(store.not_worked || "").trim().toLowerCase();
  const isFixedOFS =
    notWorked.includes("fixed + variable") ||
    notWorked.includes("fixed ops ofs") ||
    notWorked.includes("fixed ops handled by pod");
  const isVariableOFS =
    notWorked.includes("fixed + variable") ||
    notWorked.includes("variable ops ofs") ||
    notWorked.includes("variable ops handled by pod");

  // Fixed Ops column display
  let fixedOpsDisplay: string = store.fixed_ops_status || "TO DO";
  if (isFixedOFS) {
    fixedOpsDisplay = "— (OFS)";
  } else if ((store.fixed_ops_status || "").toUpperCase() === "COMPLETED") {
    fixedOpsDisplay = "Completed";
  } else if (!isFixedOpsReady) {
    fixedOpsDisplay = "— (BP Incomplete)";
  }

  // Variable Ops column display
  let varOpsDisplay: string = store.variable_ops_status || "TO DO";
  if (isVariableOFS) {
    varOpsDisplay = "— (OFS)";
  } else if ((store.variable_ops_status || "").toUpperCase() === "COMPLETED") {
    varOpsDisplay = "Completed";
  } else if (!isVariableOpsReady) {
    if (!isBlueprintDone(store.blueprint_statuses?.accounting)) {
      varOpsDisplay = "— (Accounting BP Pending)";
    } else if (setupStatus !== "Yes") {
      varOpsDisplay = `— (Blocked: ${setupStatus})`;
    }
  }

  return [
    getGoLiveWeekLabel(store.launch_date),
    formatLaunchDate(store.launch_date),
    getTLabel(store.launch_date),
    store.tekion_id || "",
    store.dealer_id || "",
    store.dba_name || "",
    store.superpod_id || "",
    queueFlag,
    fixedOpsDisplay,
    fixedAssignee,
    varOpsDisplay,
    variableAssignee,
    setupStatus,
    store.not_worked || "",
  ];
}

/* =======================================================================
   STYLING & FORMATTING
======================================================================= */

async function applyWeeklyTrackStyling(
  token: string,
  sheetName: string,
  rowsData: string[][],
  sessionId?: string | null
): Promise<void> {
  const endCol = toExcelColumnName(WEEKLY_TRACK_HEADERS.length - 1);

  // 1. Header Styling (Slate 800 background, bold white text)
  await graphRequest(
    `/worksheets/${encodeURIComponent(sheetName)}/range(address='A1:${endCol}1')/format/fill`,
    token,
    { method: "PATCH", body: JSON.stringify({ color: "#1E293B" }) },
    sessionId
  );
  await graphRequest(
    `/worksheets/${encodeURIComponent(sheetName)}/range(address='A1:${endCol}1')/format/font`,
    token,
    { method: "PATCH", body: JSON.stringify({ color: "#FFFFFF", bold: true }) },
    sessionId
  );

  // 2. Queue Flag & Assignee Styling
  const flagColIdx = WEEKLY_TRACK_HEADERS.indexOf("Queue Flag");
  const flagColLetter = toExcelColumnName(flagColIdx);

  const fixedAssigneeIdx = WEEKLY_TRACK_HEADERS.indexOf("Fixed Ops Assignee");
  const fixedAssigneeLetter = toExcelColumnName(fixedAssigneeIdx);

  const varAssigneeIdx = WEEKLY_TRACK_HEADERS.indexOf("Variable Ops Assignee");
  const varAssigneeLetter = toExcelColumnName(varAssigneeIdx);

  for (let i = 0; i < rowsData.length; i++) {
    const rowNum = i + 2;
    const flagVal = rowsData[i][flagColIdx];
    const fixedAssVal = rowsData[i][fixedAssigneeIdx];
    const varAssVal = rowsData[i][varAssigneeIdx];

    // Badge styling for Queue Flag
    let flagFill = "#F1F5F9";
    let flagFont = "#334155";
    if (flagVal === "Both Ready") {
      flagFill = "#F3E8FF"; // Purple 100
      flagFont = "#6B21A8"; // Purple 800
    } else if (flagVal === "Fixed Only") {
      flagFill = "#E0F2FE"; // Sky 100
      flagFont = "#0369A1"; // Sky 700
    } else if (flagVal === "Variable Only") {
      flagFill = "#FEF3C7"; // Amber 100
      flagFont = "#B45309"; // Amber 700
    }

    await graphRequest(
      `/worksheets/${encodeURIComponent(sheetName)}/range(address='${flagColLetter}${rowNum}')/format/fill`,
      token,
      { method: "PATCH", body: JSON.stringify({ color: flagFill }) },
      sessionId
    );
    await graphRequest(
      `/worksheets/${encodeURIComponent(sheetName)}/range(address='${flagColLetter}${rowNum}')/format/font`,
      token,
      { method: "PATCH", body: JSON.stringify({ color: flagFont, bold: true }) },
      sessionId
    );

    // Highlight unassigned slots in soft peach
    if (fixedAssVal === "Unassigned") {
      await graphRequest(
        `/worksheets/${encodeURIComponent(sheetName)}/range(address='${fixedAssigneeLetter}${rowNum}')/format/fill`,
        token,
        { method: "PATCH", body: JSON.stringify({ color: "#FFE4E6" }) },
        sessionId
      );
      await graphRequest(
        `/worksheets/${encodeURIComponent(sheetName)}/range(address='${fixedAssigneeLetter}${rowNum}')/format/font`,
        token,
        { method: "PATCH", body: JSON.stringify({ color: "#9F1239", bold: true }) },
        sessionId
      );
    }

    if (varAssVal === "Unassigned") {
      await graphRequest(
        `/worksheets/${encodeURIComponent(sheetName)}/range(address='${varAssigneeLetter}${rowNum}')/format/fill`,
        token,
        { method: "PATCH", body: JSON.stringify({ color: "#FFE4E6" }) },
        sessionId
      );
      await graphRequest(
        `/worksheets/${encodeURIComponent(sheetName)}/range(address='${varAssigneeLetter}${rowNum}')/format/font`,
        token,
        { method: "PATCH", body: JSON.stringify({ color: "#9F1239", bold: true }) },
        sessionId
      );
    }
  }
}

/* =======================================================================
   MAIN EXPORT FUNCTION
======================================================================= */

export async function syncWeeklyTrackToGraphWorkbook(
  records: StoreRecord[]
): Promise<{ rowCount: number }> {
  if (!records.length) return { rowCount: 0 };

  const token = getEffectiveGraphToken();
  if (!token || isTokenExpired(token)) {
    throw new Error("Microsoft Graph API token is missing or expired.");
  }

  // 1. Filter candidates according to business criteria & OFS rules
  const candidates: WeeklyTrackCandidate[] = [];
  for (const store of records) {
    const candidate = evaluateWeeklyTrackCandidate(store);
    if (candidate) candidates.push(candidate);
  }

  // 2. Sort chronologically by launch date (upcoming launches on top)
  candidates.sort((a, b) => {
    const aTime = parseDate(a.store.launch_date)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bTime = parseDate(b.store.launch_date)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });

  const matrix = candidates.map(mapCandidateToRow);

  // 3. Connect to Graph & populate the sheet
  const sessionId = await createSession(token);
  try {
    await ensureWorksheet(token, WEEKLY_TRACK_SHEET_NAME, sessionId);

    const { rowCount: existingRowCount, columnCount: existingColCount } =
      await getUsedRangeDimensions(token, WEEKLY_TRACK_SHEET_NAME, sessionId);

    const clearRows = Math.max(existingRowCount, matrix.length + 1, 1);
    const clearCols = Math.max(existingColCount, WEEKLY_TRACK_HEADERS.length);

    // Clear stale cells completely
    await clearWorksheetRect(token, WEEKLY_TRACK_SHEET_NAME, clearRows, clearCols, sessionId);

    // Write Header Row
    await graphRequest(
      `/worksheets/${encodeURIComponent(WEEKLY_TRACK_SHEET_NAME)}/range(address='A1:${toExcelColumnName(
        WEEKLY_TRACK_HEADERS.length - 1
      )}1')`,
      token,
      { method: "PATCH", body: JSON.stringify({ values: [Array.from(WEEKLY_TRACK_HEADERS)] }) },
      sessionId
    );

    // Write Data Rows if any candidates exist
    if (matrix.length > 0) {
      const endCol = toExcelColumnName(WEEKLY_TRACK_HEADERS.length - 1);
      const endRow = matrix.length + 1;
      await graphRequest(
        `/worksheets/${encodeURIComponent(WEEKLY_TRACK_SHEET_NAME)}/range(address='A2:${endCol}${endRow}')`,
        token,
        { method: "PATCH", body: JSON.stringify({ values: matrix }) },
        sessionId
      );

      // Apply formatting and colors
      await applyWeeklyTrackStyling(token, WEEKLY_TRACK_SHEET_NAME, matrix, sessionId);
    }

    return { rowCount: matrix.length };
  } finally {
    await closeSession(token, sessionId);
  }
}