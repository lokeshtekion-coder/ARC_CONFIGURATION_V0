import type { StoreRecord } from "./storesDb";
import { loadTekionApiSettings } from "./tekionApiSettings";
import {
  STORE_EXPORT_HEADERS,
  groupStoresByMonth,
  rowsToMatrix,
  type StoreExcelRow,
} from "./storesExcelShared";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const WORKBOOK_PATH = "T-90 Dealers GoLive - ARC.xlsx";
const CHUNK_SIZE = 500;
const FORMAT_CONCURRENCY = 8;

const STATUS_HEADERS = [
  "Blueprint Parts",
  "Blueprint Service",
  "Blueprint Accounting",
  "Blueprint CRM",
  "Blueprint Analytics",
  "SignOff Parts",
  "SignOff Service",
  "SignOff Accounting",
] as const;

const STATUS_START_COLUMN_INDEX = STORE_EXPORT_HEADERS.indexOf("Blueprint Parts");
const STATUS_END_COLUMN_INDEX = STORE_EXPORT_HEADERS.indexOf("SignOff Accounting");

interface GraphSessionInfo {
  id: string;
  persistChanges: boolean;
}

interface StatusPalette {
  key: "completed" | "in_progress" | "not_started";
  fillColor: string;
  fontColor: string;
}

interface RangeFormatOp {
  address: string;
  fillColor: string;
  fontColor: string;
}

interface FormatStats {
  rangeCount: number;
  cellCount: number;
}

export interface GraphSyncResult {
  workbookPath: string;
  rowCount: number;
  sheetCount: number;
  sheets: string[];
  formattedRangeCount: number;
  formattedCellCount: number;
}

function workbookBaseUrl(): string {
  const encodedPath = encodeURIComponent(WORKBOOK_PATH).replace(/%2F/g, "/");
  return `${GRAPH_BASE}/me/drive/root:/${encodedPath}:/workbook`;
}

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    const code = data?.error?.code;
    const message = data?.error?.message;
    if (code && message) return `${code}: ${message}`;
    if (message) return message;
  } catch {
    // ignore
  }

  try {
    const text = await res.text();
    if (text) return text;
  } catch {
    // ignore
  }

  return `${res.status} ${res.statusText}`;
}

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

  const res = await fetch(`${workbookBaseUrl()}${path}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  if (!text) {
    return undefined as T;
  }

  return JSON.parse(text) as T;
}

async function createSession(token: string): Promise<string | null> {
  try {
    const data = await graphRequest<GraphSessionInfo>(
      "/createSession",
      token,
      {
        method: "POST",
        body: JSON.stringify({ persistChanges: true }),
      }
    );

    return data?.id ?? null;
  } catch {
    return null;
  }
}

async function closeSession(token: string, sessionId?: string | null): Promise<void> {
  if (!sessionId) return;

  try {
    await graphRequest(
      "/closeSession",
      token,
      {
        method: "POST",
      },
      sessionId
    );
  } catch {
    // ignore close failures
  }
}

async function listWorksheetNames(
  token: string,
  sessionId?: string | null
): Promise<string[]> {
  const data = await graphRequest<{ value?: Array<{ name?: string }> }>(
    "/worksheets",
    token,
    { method: "GET" },
    sessionId
  );

  return (data.value ?? [])
    .map((item) => item.name)
    .filter((name): name is string => Boolean(name));
}

async function addWorksheet(
  token: string,
  sheetName: string,
  sessionId?: string | null
): Promise<void> {
  const payload = JSON.stringify({ name: sheetName });
  const candidatePaths = ["/worksheets/add", "/worksheets"];

  let lastError: unknown = null;

  for (const path of candidatePaths) {
    try {
      await graphRequest(
        path,
        token,
        {
          method: "POST",
          body: payload,
        },
        sessionId
      );
      return;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown worksheet error";

      if (
        message.includes("ItemAlreadyExists") ||
        message.toLowerCase().includes("already exists")
      ) {
        return;
      }

      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Failed to create worksheet");
}

async function ensureWorksheet(
  token: string,
  sheetName: string,
  knownSheets: Set<string>,
  sessionId?: string | null
): Promise<void> {
  if (knownSheets.has(sheetName)) return;

  await addWorksheet(token, sheetName, sessionId);
  knownSheets.add(sheetName);
}

async function getUsedRangeRowCount(
  token: string,
  sheetName: string,
  sessionId?: string | null
): Promise<number> {
  try {
    const data = await graphRequest<{ rowCount?: number }>(
      `/worksheets/${encodeURIComponent(sheetName)}/usedRange`,
      token,
      { method: "GET" },
      sessionId
    );

    return typeof data?.rowCount === "number" ? data.rowCount : 0;
  } catch {
    return 0;
  }
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

function buildRangeAddress(startRow: number, rowCount: number, columnCount: number): string {
  const endRow = startRow + rowCount - 1;
  const endCol = toExcelColumnName(columnCount - 1);
  return `A${startRow}:${endCol}${endRow}`;
}

function buildSingleColumnAddress(
  columnIndex: number,
  startRow: number,
  endRow: number
): string {
  const col = toExcelColumnName(columnIndex);
  return startRow === endRow ? `${col}${startRow}` : `${col}${startRow}:${col}${endRow}`;
}

function buildRectAddress(
  startColumnIndex: number,
  endColumnIndex: number,
  startRow: number,
  endRow: number
): string {
  const startCol = toExcelColumnName(startColumnIndex);
  const endCol = toExcelColumnName(endColumnIndex);
  return `${startCol}${startRow}:${endCol}${endRow}`;
}

async function patchRangeValues(
  token: string,
  sheetName: string,
  startRow: number,
  values: string[][],
  sessionId?: string | null
): Promise<void> {
  if (values.length === 0) return;

  const columnCount = values[0]?.length ?? 0;
  if (columnCount === 0) return;

  const address = buildRangeAddress(startRow, values.length, columnCount);

  await graphRequest(
    `/worksheets/${encodeURIComponent(sheetName)}/range(address='${address}')`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({ values }),
    },
    sessionId
  );
}

async function clearWorksheetRect(
  token: string,
  sheetName: string,
  rowCount: number,
  columnCount: number,
  sessionId?: string | null
): Promise<void> {
  if (rowCount <= 0 || columnCount <= 0) return;

  let currentRow = 1;
  let remaining = rowCount;

  while (remaining > 0) {
    const take = Math.min(CHUNK_SIZE, remaining);
    const blankRows = Array.from({ length: take }, () =>
      Array.from({ length: columnCount }, () => "")
    );

    await patchRangeValues(token, sheetName, currentRow, blankRows, sessionId);

    currentRow += take;
    remaining -= take;
  }
}

async function patchRangeFillAndFont(
  token: string,
  sheetName: string,
  address: string,
  fillColor: string,
  fontColor: string,
  bold: boolean,
  sessionId?: string | null
): Promise<void> {
  const base = `/worksheets/${encodeURIComponent(sheetName)}/range(address='${address}')/format`;

  await Promise.allSettled([
    graphRequest(
      `${base}/fill`,
      token,
      {
        method: "PATCH",
        body: JSON.stringify({ color: fillColor }),
      },
      sessionId
    ),
    graphRequest(
      `${base}/font`,
      token,
      {
        method: "PATCH",
        body: JSON.stringify({ color: fontColor, bold }),
      },
      sessionId
    ),
  ]);
}

async function applyHeaderFormatting(
  token: string,
  sheetName: string,
  columnCount: number,
  sessionId?: string | null
): Promise<void> {
  const endCol = toExcelColumnName(columnCount - 1);
  const address = `A1:${endCol}1`;

  await patchRangeFillAndFont(
    token,
    sheetName,
    address,
    "#1F2937",
    "#FFFFFF",
    true,
    sessionId
  );
}

function getStatusPalette(rawValue?: string): StatusPalette {
  const value = (rawValue || "").trim().toUpperCase();

  if (value === "COMPLETED") {
    return {
      key: "completed",
      fillColor: "#DCFCE7",
      fontColor: "#166534",
    };
  }

  if (value === "IN_PROGRESS") {
    return {
      key: "in_progress",
      fillColor: "#FEF3C7",
      fontColor: "#92400E",
    };
  }

  return {
    key: "not_started",
    fillColor: "#E5E7EB",
    fontColor: "#475569",
  };
}

async function resetStatusFormattingArea(
  token: string,
  sheetName: string,
  totalRowCount: number,
  sessionId?: string | null
): Promise<void> {
  if (
    STATUS_START_COLUMN_INDEX < 0 ||
    STATUS_END_COLUMN_INDEX < 0 ||
    totalRowCount < 2
  ) {
    return;
  }

  const address = buildRectAddress(
    STATUS_START_COLUMN_INDEX,
    STATUS_END_COLUMN_INDEX,
    2,
    totalRowCount
  );

  await patchRangeFillAndFont(
    token,
    sheetName,
    address,
    "#FFFFFF",
    "#111827",
    false,
    sessionId
  );
}

function buildStatusFormatOps(rows: StoreExcelRow[]): RangeFormatOp[] {
  if (rows.length === 0) return [];

  const ops: RangeFormatOp[] = [];

  for (const header of STATUS_HEADERS) {
    const columnIndex = STORE_EXPORT_HEADERS.indexOf(header);
    if (columnIndex < 0) continue;

    let runStart = 0;
    let currentPalette = getStatusPalette(rows[0][header]);

    for (let i = 1; i <= rows.length; i++) {
      const nextPalette = i < rows.length ? getStatusPalette(rows[i][header]) : null;

      if (!nextPalette || nextPalette.key !== currentPalette.key) {
        const startRow = runStart + 2;
        const endRow = i + 1;

        ops.push({
          address: buildSingleColumnAddress(columnIndex, startRow, endRow),
          fillColor: currentPalette.fillColor,
          fontColor: currentPalette.fontColor,
        });

        if (nextPalette) {
          runStart = i;
          currentPalette = nextPalette;
        }
      }
    }
  }

  return ops;
}

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const concurrency = Math.max(1, Math.min(limit, queue.length || 1));

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) return;
        await worker(item);
      }
    })
  );
}

async function applyStatusFormatting(
  token: string,
  sheetName: string,
  rows: StoreExcelRow[],
  totalRowsCleared: number,
  sessionId?: string | null
): Promise<FormatStats> {
  if (rows.length === 0) {
    return {
      rangeCount: 0,
      cellCount: 0,
    };
  }

  await resetStatusFormattingArea(token, sheetName, totalRowsCleared, sessionId);

  const ops = buildStatusFormatOps(rows);

  await runWithConcurrency(ops, FORMAT_CONCURRENCY, async (op) => {
    await patchRangeFillAndFont(
      token,
      sheetName,
      op.address,
      op.fillColor,
      op.fontColor,
      false,
      sessionId
    );
  });

  return {
    rangeCount: ops.length,
    cellCount: rows.length * STATUS_HEADERS.length,
  };
}

export async function syncStoresToGraphWorkbook(
  records: StoreRecord[]
): Promise<GraphSyncResult> {
  if (!records.length) {
    throw new Error("No store records available to sync");
  }

  const settings = loadTekionApiSettings();
  const token = settings.graphApiToken.trim();

  if (!token) {
    throw new Error("GRAPH api token missing. Save it in Settings first.");
  }

  const groups = groupStoresByMonth(records);

  if (groups.length === 0) {
    throw new Error("No monthly groups available to sync");
  }

  const sessionId = await createSession(token);

  try {
    const existingSheets = new Set(await listWorksheetNames(token, sessionId));
    let formattedRangeCount = 0;
    let formattedCellCount = 0;

    for (const group of groups) {
      await ensureWorksheet(token, group.sheetName, existingSheets, sessionId);

      const dataRows = rowsToMatrix(group.rows);
      const newTotalRows = dataRows.length + 1;
      const existingRowCount = await getUsedRangeRowCount(token, group.sheetName, sessionId);
      const clearRows = Math.max(existingRowCount, newTotalRows, 1);

      await clearWorksheetRect(
        token,
        group.sheetName,
        clearRows,
        STORE_EXPORT_HEADERS.length,
        sessionId
      );

      await patchRangeValues(
        token,
        group.sheetName,
        1,
        [Array.from(STORE_EXPORT_HEADERS)],
        sessionId
      );

      let currentRow = 2;
      let remaining = dataRows.slice();

      while (remaining.length > 0) {
        const chunk = remaining.slice(0, CHUNK_SIZE);
        await patchRangeValues(token, group.sheetName, currentRow, chunk, sessionId);
        currentRow += chunk.length;
        remaining = remaining.slice(CHUNK_SIZE);
      }

      await applyHeaderFormatting(
        token,
        group.sheetName,
        STORE_EXPORT_HEADERS.length,
        sessionId
      );

      const formatting = await applyStatusFormatting(
        token,
        group.sheetName,
        group.rows,
        clearRows,
        sessionId
      );

      formattedRangeCount += formatting.rangeCount;
      formattedCellCount += formatting.cellCount;
    }

    return {
      workbookPath: WORKBOOK_PATH,
      rowCount: records.length,
      sheetCount: groups.length,
      sheets: groups.map((g) => g.sheetName),
      formattedRangeCount,
      formattedCellCount,
    };
  } finally {
    await closeSession(token, sessionId);
  }
}
