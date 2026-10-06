import { recordStatusTransition } from "./storesDb";
import { loadTekionApiSettings } from "./tekionApiSettings";
import { loadLatestExtensionCapture } from "./extensionBridge";
import { STORE_EXPORT_HEADERS, groupStoresByMonth, rowsToMatrix, buildLatestFieldTrackingText, sanitizeExcelTimestamp, } from "./storesExcelShared";
import { isUserAdmin } from "./authHelper";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
export const SHAREPOINT_DRIVE_ID = "b!CtlfXMp9l0y0QRmkSWK2oZqgrpwIJwZEtu62RScE-gY47Sr8CDY7S7HPla3fSuMb";
export const SHAREPOINT_ITEM_ID = "01B46CXZ2B7OEFQZBGXZB2IIVHTZ6S475W";
export const SHAREPOINT_WORKBOOK_PATH = "T-90 Arc Dealerss.xlsx";
export const SHAREPOINT_DOC_URL = "https://tekion.sharepoint.com/:x:/r/sites/configteam/_layouts/15/Doc.aspx?sourcedoc=%7B5888FB41-2664-43BE-A422-A79E7D2E7FB6%7D&file=T-90%20Arc%20Dealerss.xlsx&action=default&mobileredirect=true";
export const PROD_DEALER_SHEET_NAME = "Prod Dealer";
const CHUNK_SIZE = 500;
const FORMAT_CONCURRENCY = 3;
const STATUS_HEADERS = [
    "Blueprint Parts",
    "Blueprint Service",
    "Blueprint Accounting",
    "Blueprint CRM",
    "Blueprint Analytics",
];
const STATUS_START_COLUMN_INDEX = STORE_EXPORT_HEADERS.indexOf("Blueprint Parts");
const STATUS_END_COLUMN_INDEX = STORE_EXPORT_HEADERS.indexOf("Blueprint Analytics");
let isSyncingProdDealers = false;
function workbookBaseUrl() {
    return `${GRAPH_BASE}/drives/${SHAREPOINT_DRIVE_ID}/items/${SHAREPOINT_ITEM_ID}/workbook`;
}
export function isTokenExpired(token) {
    if (!token)
        return true;
    const parts = token.split(".");
    if (parts.length !== 3)
        return false;
    try {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padLen = (4 - (base64.length % 4)) % 4;
        const padded = base64 + "=".repeat(padLen);
        const payload = JSON.parse(atob(padded));
        if (typeof payload.exp === "number") {
            return Date.now() >= (payload.exp - 60) * 1000;
        }
    }
    catch {
        return false;
    }
    return false;
}
export function getEffectiveGraphToken() {
    const settings = loadTekionApiSettings();
    const directToken = settings.graphApiToken?.trim();
    if (directToken && !isTokenExpired(directToken)) {
        return directToken;
    }
    try {
        const capture = loadLatestExtensionCapture();
        const capturedToken = capture?.graphApiToken?.trim();
        if (capturedToken && !isTokenExpired(capturedToken)) {
            return capturedToken;
        }
    }
    catch { }
    try {
        const localToken = localStorage.getItem("graph_access_token")?.trim() ||
            localStorage.getItem("sharepoint_token")?.trim();
        if (localToken && !isTokenExpired(localToken)) {
            return localToken;
        }
    }
    catch { }
    return directToken || "";
}
function validateGraphTokenScope(token) {
    const parts = token.split(".");
    if (parts.length !== 3)
        return;
    let payload;
    try {
        const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const padLen = (4 - (base64.length % 4)) % 4;
        const padded = base64 + "=".repeat(padLen);
        payload = JSON.parse(atob(padded));
    }
    catch {
        return;
    }
    if (typeof payload.exp === "number" && Date.now() >= payload.exp * 1000) {
        throw new Error("Current Microsoft Graph Token has expired. Please refresh your SharePoint T-90 browser tab to capture a fresh token.");
    }
    if (payload.appid === "89bee1f7-5e6e-4d8a-9f3d-ecd601259da7") {
        throw new Error("Current Graph Token belongs to 'Office365 Shell' and only has personal OneDrive/profile access. Please open the SharePoint T-90 page in your browser so the extension can auto-capture the SPFx-exchanged token with file permissions.");
    }
    const scp = payload.scp || "";
    if (!scp.includes("Files.ReadWrite.All") && !scp.includes("Sites.ReadWrite.All")) {
        throw new Error(`Token lacks required SharePoint permissions (has: "${scp || "none"}"). Requires Files.ReadWrite.All or Sites.ReadWrite.All - re-open the SharePoint T-90 page to refresh the captured token.`);
    }
}
async function readErrorMessage(res) {
    try {
        const data = (await res.json());
        const code = data?.error?.code;
        const message = data?.error?.message;
        if (code && message)
            return `${code}: ${message}`;
        if (message)
            return message;
    }
    catch { }
    try {
        const text = await res.text();
        if (text)
            return text;
    }
    catch { }
    return `${res.status} ${res.statusText}`;
}
async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function graphRequest(path, token, init, sessionId, retryCount = 0) {
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
    if ((res.status === 429 || res.status === 503) && retryCount < 3) {
        const retryAfter = Number(res.headers.get("Retry-After")) || Math.pow(2, retryCount + 1);
        await sleep(retryAfter * 1000);
        return graphRequest(path, token, init, sessionId, retryCount + 1);
    }
    if (!res.ok) {
        throw new Error(await readErrorMessage(res));
    }
    if (res.status === 204) {
        return undefined;
    }
    const text = await res.text();
    if (!text) {
        return undefined;
    }
    return JSON.parse(text);
}
async function createSession(token) {
    try {
        const data = await graphRequest("/createSession", token, {
            method: "POST",
            body: JSON.stringify({ persistChanges: true }),
        });
        if (!data?.id) {
            throw new Error("Microsoft Graph did not return a session identifier.");
        }
        return data.id;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to establish workbook session";
        throw new Error(`Workbook Session Error (${msg})`);
    }
}
async function closeSession(token, sessionId) {
    if (!sessionId)
        return;
    try {
        await graphRequest("/closeSession", token, { method: "POST" }, sessionId);
    }
    catch { }
}
async function listWorksheetNames(token, sessionId) {
    const data = await graphRequest("/worksheets", token, { method: "GET" }, sessionId);
    return (data.value ?? [])
        .map((item) => item.name)
        .filter((name) => Boolean(name));
}
async function addWorksheet(token, sheetName, sessionId) {
    const payload = JSON.stringify({ name: sheetName });
    const candidatePaths = ["/worksheets/add", "/worksheets"];
    let lastError = null;
    for (const path of candidatePaths) {
        try {
            await graphRequest(path, token, { method: "POST", body: payload }, sessionId);
            return;
        }
        catch (err) {
            const message = err instanceof Error ? err.message : "Unknown worksheet error";
            if (message.includes("ItemAlreadyExists") ||
                message.toLowerCase().includes("already exists")) {
                return;
            }
            lastError = err;
        }
    }
    throw lastError instanceof Error ? lastError : new Error("Failed to create worksheet");
}
async function ensureWorksheet(token, sheetName, knownSheets, sessionId) {
    if (knownSheets.has(sheetName))
        return;
    await addWorksheet(token, sheetName, sessionId);
    knownSheets.add(sheetName);
}
async function getUsedRangeRowCount(token, sheetName, sessionId) {
    try {
        const data = await graphRequest(`/worksheets/${encodeURIComponent(sheetName)}/usedRange`, token, { method: "GET" }, sessionId);
        return typeof data?.rowCount === "number" ? data.rowCount : 0;
    }
    catch {
        return 0;
    }
}
export function toExcelColumnName(index) {
    let n = index + 1;
    let label = "";
    while (n > 0) {
        const rem = (n - 1) % 26;
        label = String.fromCharCode(65 + rem) + label;
        n = Math.floor((n - 1) / 26);
    }
    return label;
}
function buildRangeAddress(startRow, rowCount, columnCount) {
    const endRow = startRow + rowCount - 1;
    const endCol = toExcelColumnName(columnCount - 1);
    return `A${startRow}:${endCol}${endRow}`;
}
function buildSingleColumnAddress(columnIndex, startRow, endRow) {
    const col = toExcelColumnName(columnIndex);
    return startRow === endRow ? `${col}${startRow}` : `${col}${startRow}:${col}${endRow}`;
}
function buildRectAddress(startColumnIndex, endColumnIndex, startRow, endRow) {
    const startCol = toExcelColumnName(startColumnIndex);
    const endCol = toExcelColumnName(endColumnIndex);
    return `${startCol}${startRow}:${endCol}${endRow}`;
}
async function patchRangeValues(token, sheetName, startRow, values, sessionId) {
    if (values.length === 0)
        return;
    const columnCount = values[0]?.length ?? 0;
    if (columnCount === 0)
        return;
    const address = buildRangeAddress(startRow, values.length, columnCount);
    await graphRequest(`/worksheets/${encodeURIComponent(sheetName)}/range(address='${address}')`, token, { method: "PATCH", body: JSON.stringify({ values }) }, sessionId);
}
async function clearWorksheetRect(token, sheetName, rowCount, columnCount, sessionId) {
    if (rowCount <= 0 || columnCount <= 0)
        return;
    let currentRow = 1;
    let remaining = rowCount;
    while (remaining > 0) {
        const take = Math.min(CHUNK_SIZE, remaining);
        const blankRows = Array.from({ length: take }, () => Array.from({ length: columnCount }, () => ""));
        await patchRangeValues(token, sheetName, currentRow, blankRows, sessionId);
        currentRow += take;
        remaining -= take;
    }
}
async function patchRangeFillAndFont(token, sheetName, address, fillColor, fontColor, bold, sessionId) {
    const base = `/worksheets/${encodeURIComponent(sheetName)}/range(address='${address}')/format`;
    await Promise.allSettled([
        graphRequest(`${base}/fill`, token, { method: "PATCH", body: JSON.stringify({ color: fillColor }) }, sessionId),
        graphRequest(`${base}/font`, token, { method: "PATCH", body: JSON.stringify({ color: fontColor, bold }) }, sessionId),
    ]);
}
async function applyHeaderFormatting(token, sheetName, columnCount, sessionId) {
    const endCol = toExcelColumnName(columnCount - 1);
    const address = `A1:${endCol}1`;
    await patchRangeFillAndFont(token, sheetName, address, "#1F2937", "#FFFFFF", true, sessionId);
}
function getStatusPalette(rawValue) {
    const value = (rawValue || "").trim().toUpperCase();
    if (value === "COMPLETED") {
        return {
            key: "completed",
            fillColor: "#DCFCE7",
            fontColor: "#166534",
        };
    }
    if (value === "IN_PROGRESS" || value === "WIP") {
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
async function resetStatusFormattingArea(token, sheetName, totalRowCount, sessionId) {
    if (STATUS_START_COLUMN_INDEX < 0 || STATUS_END_COLUMN_INDEX < 0 || totalRowCount < 2) {
        return;
    }
    const address = buildRectAddress(STATUS_START_COLUMN_INDEX, STATUS_END_COLUMN_INDEX, 2, totalRowCount);
    await patchRangeFillAndFont(token, sheetName, address, "#FFFFFF", "#111827", false, sessionId);
}
function buildStatusFormatOps(rows) {
    if (rows.length === 0)
        return [];
    const ops = [];
    for (const header of STATUS_HEADERS) {
        const columnIndex = STORE_EXPORT_HEADERS.indexOf(header);
        if (columnIndex < 0)
            continue;
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
async function runWithConcurrency(items, limit, worker) {
    const queue = [...items];
    const concurrency = Math.max(1, Math.min(limit, queue.length || 1));
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (queue.length > 0) {
            const item = queue.shift();
            if (!item)
                return;
            await worker(item);
        }
    }));
}
async function applyStatusFormatting(token, sheetName, rows, totalRowsCleared, sessionId) {
    if (rows.length === 0) {
        return { rangeCount: 0, cellCount: 0 };
    }
    await resetStatusFormattingArea(token, sheetName, totalRowsCleared, sessionId);
    const ops = buildStatusFormatOps(rows);
    await runWithConcurrency(ops, FORMAT_CONCURRENCY, async (op) => {
        await patchRangeFillAndFont(token, sheetName, op.address, op.fillColor, op.fontColor, false, sessionId);
    });
    return {
        rangeCount: ops.length,
        cellCount: rows.length * STATUS_HEADERS.length,
    };
}
function normalizeExcelStatus(val) {
    if (!val)
        return null;
    const s = val.trim().toUpperCase();
    if (s === "COMPLETED")
        return "Completed";
    if (s === "WIP" || s === "IN_PROGRESS" || s === "IN PROGRESS")
        return "WIP";
    if (s === "TO DO" || s === "TODO" || s === "NOT STARTED" || s === "NOT_STARTED")
        return "TO DO";
    return null;
}
function resolveStatusPriority(localStatus, remoteStatus, _isAdmin = false) {
    const r = normalizeExcelStatus(remoteStatus);
    const l = normalizeExcelStatus(localStatus) || "TO DO";
    if (l === "Completed") {
        return "Completed";
    }
    if (r === "Completed") {
        return "Completed";
    }
    if (r) {
        const priorityScore = { Completed: 3, WIP: 2, "TO DO": 1 };
        return (priorityScore[r] ?? 1) >= (priorityScore[l] ?? 1) ? r : l;
    }
    return l;
}
function buildTrackingFormula(statusColLetter, trackingColLetter, rowNum) {
    return `=IF(${statusColLetter}${rowNum}="","",IF(${trackingColLetter}${rowNum}<>"",${trackingColLetter}${rowNum},TEXT(NOW(),"hh:mm:ss AM/PM")))`;
}
async function fetchExistingWorkbookData(token, sheetNames, sessionId) {
    const remoteMap = new Map();
    for (const sheetName of sheetNames) {
        try {
            const data = await graphRequest(`/worksheets/${encodeURIComponent(sheetName)}/usedRange`, token, { method: "GET" }, sessionId);
            const rows = data?.values;
            if (!rows || rows.length < 2)
                continue;
            const headerRow = rows[0].map((h) => String(h || "").trim().toLowerCase());
            const tekionIdIdx = headerRow.findIndex((h) => h === "tekion id");
            const fixedAssigneeIdx = headerRow.findIndex((h) => h === "fixed ops assignee" || h === "assignee" || h === "lead assignee");
            const varAssigneeIdx = headerRow.findIndex((h) => h === "variable ops assignee" || h === "var ops assignee");
            const notWorkedIdx = headerRow.findIndex((h) => /not\s*worked/i.test(h));
            const fixedOpsIdx = headerRow.findIndex((h) => h === "fixed ops");
            const fixedOpsTrackingIdx = headerRow.findIndex((h) => h === "fixed ops tracking");
            const variableOpsIdx = headerRow.findIndex((h) => h === "variable ops");
            const variableOpsTrackingIdx = headerRow.findIndex((h) => h === "variable ops tracking");
            const testingIdx = headerRow.findIndex((h) => h === "testing");
            if (tekionIdIdx === -1)
                continue;
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                const tekionId = String(row[tekionIdIdx] || "").trim();
                if (!tekionId)
                    continue;
                remoteMap.set(tekionId, {
                    tekionId,
                    fixedAssignee: fixedAssigneeIdx !== -1 ? String(row[fixedAssigneeIdx] || "").trim() : undefined,
                    variableAssignee: varAssigneeIdx !== -1 ? String(row[varAssigneeIdx] || "").trim() : undefined,
                    notWorked: notWorkedIdx !== -1 ? String(row[notWorkedIdx] || "").trim() : undefined,
                    fixedOpsStatus: fixedOpsIdx !== -1 ? String(row[fixedOpsIdx] || "").trim() : undefined,
                    fixedOpsTracking: fixedOpsTrackingIdx !== -1 ? String(row[fixedOpsTrackingIdx] || "").trim() : undefined,
                    variableOpsStatus: variableOpsIdx !== -1 ? String(row[variableOpsIdx] || "").trim() : undefined,
                    variableOpsTracking: variableOpsTrackingIdx !== -1 ? String(row[variableOpsTrackingIdx] || "").trim() : undefined,
                    testingStatus: testingIdx !== -1 ? String(row[testingIdx] || "").trim() : undefined,
                });
            }
        }
        catch {
            continue;
        }
    }
    return remoteMap;
}
function mergeLocalAndRemoteStores(localStores, remoteMap) {
    const isAdmin = isUserAdmin();
    return localStores.map((local) => {
        const remote = remoteMap.get(local.tekion_id);
        if (!remote)
            return local;
        const fixed_ops_status = resolveStatusPriority(local.fixed_ops_status, remote.fixedOpsStatus, isAdmin);
        const variable_ops_status = resolveStatusPriority(local.variable_ops_status, remote.variableOpsStatus, isAdmin);
        const testing_status = resolveStatusPriority(local.testing_status, remote.testingStatus, isAdmin);
        const custom_assignee = remote.fixedAssignee?.trim() || local.custom_assignee;
        const custom_variable_assignee = remote.variableAssignee?.trim() || local.custom_variable_assignee;
        const not_worked = remote.notWorked?.trim() || local.not_worked;
        return {
            ...local,
            fixed_ops_status,
            variable_ops_status,
            testing_status,
            custom_assignee,
            custom_variable_assignee,
            not_worked,
        };
    });
}
/**
 * Patches a specific column by possible header candidates
 */
async function patchColumnValueInSheet(tekionId, candidateHeaders, value) {
    const token = getEffectiveGraphToken();
    if (!token || isTokenExpired(token))
        return false;
    try {
        const sheetNames = await listWorksheetNames(token);
        for (const sheetName of sheetNames) {
            const data = await graphRequest(`/worksheets/${encodeURIComponent(sheetName)}/usedRange`, token, { method: "GET" });
            const rows = data?.values;
            if (!rows || rows.length < 2)
                continue;
            const headerRow = rows[0].map((h) => String(h || "").trim().toLowerCase());
            const tekionIdIdx = headerRow.findIndex((h) => h === "tekion id");
            const targetColIdx = headerRow.findIndex((h) => candidateHeaders.map((c) => c.toLowerCase()).includes(h));
            if (tekionIdIdx === -1 || targetColIdx === -1)
                continue;
            for (let i = 1; i < rows.length; i++) {
                if (String(rows[i][tekionIdIdx] || "").trim() === tekionId) {
                    const colLetter = toExcelColumnName(targetColIdx);
                    const cellRow = i + 1;
                    const cellAddress = `${colLetter}${cellRow}`;
                    await graphRequest(`/worksheets/${encodeURIComponent(sheetName)}/range(address='${cellAddress}')`, token, {
                        method: "PATCH",
                        body: JSON.stringify({ values: [[value]] }),
                    });
                    return true;
                }
            }
        }
        return false;
    }
    catch (err) {
        console.debug(`[storesGraphSync] Patch for [${candidateHeaders.join(", ")}] skipped:`, err);
        return false;
    }
}
/**
 * Patches Fixed Ops Assignee in Graph
 */
export async function patchSingleStoreAssigneeInGraph(tekionId, assignee) {
    return patchColumnValueInSheet(tekionId, ["Fixed Ops Assignee", "Assignee", "Lead Assignee"], assignee);
}
/**
 * Patches Variable Ops Assignee in Graph
 */
export async function patchSingleStoreVariableAssigneeInGraph(tekionId, assignee) {
    return patchColumnValueInSheet(tekionId, ["Variable Ops Assignee", "Var Ops Assignee"], assignee);
}
/**
 * Patches "Not Worked?" in Graph
 */
export async function patchSingleStoreNotWorkedInGraph(tekionId, notWorkedValue) {
    return patchColumnValueInSheet(tekionId, ["Not Worked?", "Not Worked", "Not Worked Status"], notWorkedValue);
}
/**
 * Instantly patches a single status cell and its corresponding tracking formula/time
 */
export async function patchSingleStoreStatusInGraph(tekionId, field, value) {
    const token = getEffectiveGraphToken();
    if (!token || isTokenExpired(token))
        return false;
    const headerTitleMap = {
        fixed_ops_status: { status: "Fixed Ops", tracking: "Fixed Ops Tracking" },
        variable_ops_status: { status: "Variable Ops", tracking: "Variable Ops Tracking" },
        testing_status: { status: "Testing", tracking: "" },
    };
    const targetConfig = headerTitleMap[field];
    const targetHeader = targetConfig.status;
    const trackingHeader = targetConfig.tracking;
    try {
        const sheetNames = await listWorksheetNames(token);
        for (const sheetName of sheetNames) {
            const data = await graphRequest(`/worksheets/${encodeURIComponent(sheetName)}/usedRange`, token, { method: "GET" });
            const rows = data?.values;
            if (!rows || rows.length < 2)
                continue;
            const headerRow = rows[0].map((h) => String(h || "").trim().toLowerCase());
            const tekionIdIdx = headerRow.findIndex((h) => h === "tekion id");
            const targetColIdx = headerRow.findIndex((h) => h === targetHeader.toLowerCase());
            const trackingColIdx = trackingHeader
                ? headerRow.findIndex((h) => h === trackingHeader.toLowerCase())
                : -1;
            if (tekionIdIdx === -1 || targetColIdx === -1)
                continue;
            for (let i = 1; i < rows.length; i++) {
                if (String(rows[i][tekionIdIdx] || "").trim() === tekionId) {
                    const colLetter = toExcelColumnName(targetColIdx);
                    const cellRow = i + 1;
                    const cellAddress = `${colLetter}${cellRow}`;
                    await graphRequest(`/worksheets/${encodeURIComponent(sheetName)}/range(address='${cellAddress}')`, token, {
                        method: "PATCH",
                        body: JSON.stringify({ values: [[value]] }),
                    });
                    const palette = getStatusPalette(value);
                    await patchRangeFillAndFont(token, sheetName, cellAddress, palette.fillColor, palette.fontColor, false);
                    if (trackingColIdx !== -1) {
                        const trackingColLetter = toExcelColumnName(trackingColIdx);
                        const trackingCellAddress = `${trackingColLetter}${cellRow}`;
                        const trackingText = buildLatestFieldTrackingText(tekionId, field, false);
                        const trackingPayload = trackingText && trackingText !== "—"
                            ? { values: [[trackingText]] }
                            : { formulas: [[buildTrackingFormula(colLetter, trackingColLetter, cellRow)]] };
                        await graphRequest(`/worksheets/${encodeURIComponent(sheetName)}/range(address='${trackingCellAddress}')`, token, {
                            method: "PATCH",
                            body: JSON.stringify(trackingPayload),
                        });
                    }
                    return true;
                }
            }
        }
        return false;
    }
    catch (err) {
        console.debug("[storesGraphSync] Single status patch skipped or token expired:", err);
        return false;
    }
}
/**
 * Lightweight Background Reader:
 * Pulls current Excel state, evaluates formulas, syncs timestamps, assignees, and Not Worked flags
 */
export async function pullStatusUpdatesFromGraph(currentRecords) {
    if (!currentRecords.length) {
        return { updatedStores: currentRecords, hasChanges: false };
    }
    const token = getEffectiveGraphToken();
    if (!token || isTokenExpired(token)) {
        return { updatedStores: currentRecords, hasChanges: false };
    }
    try {
        const sheetNames = await listWorksheetNames(token);
        const remoteDataMap = await fetchExistingWorkbookData(token, sheetNames);
        const isAdmin = isUserAdmin();
        let hasChanges = false;
        const updatedStores = currentRecords.map((local) => {
            const remote = remoteDataMap.get(local.tekion_id);
            if (!remote)
                return local;
            const nextFixed = resolveStatusPriority(local.fixed_ops_status, remote.fixedOpsStatus, isAdmin);
            const nextVar = resolveStatusPriority(local.variable_ops_status, remote.variableOpsStatus, isAdmin);
            const nextTesting = resolveStatusPriority(local.testing_status, remote.testingStatus, isAdmin);
            const fixedChanged = nextFixed !== local.fixed_ops_status;
            const varChanged = nextVar !== local.variable_ops_status;
            const testingChanged = nextTesting !== local.testing_status;
            const remoteFixedAssignee = remote.fixedAssignee?.trim() || "";
            const currentFixedAssignee = local.custom_assignee || "";
            const fixedAssigneeChanged = remoteFixedAssignee !== "" && remoteFixedAssignee !== currentFixedAssignee;
            const remoteVarAssignee = remote.variableAssignee?.trim() || "";
            const currentVarAssignee = local.custom_variable_assignee || "";
            const varAssigneeChanged = remoteVarAssignee !== "" && remoteVarAssignee !== currentVarAssignee;
            const remoteNotWorked = remote.notWorked?.trim() || "";
            const currentNotWorked = String(local.not_worked || "").trim();
            const notWorkedChanged = remoteNotWorked !== "" && remoteNotWorked !== currentNotWorked;
            if (fixedChanged || varChanged || testingChanged || fixedAssigneeChanged || varAssigneeChanged || notWorkedChanged) {
                hasChanges = true;
                if (fixedChanged && nextFixed) {
                    const excelTime = sanitizeExcelTimestamp(remote.fixedOpsTracking);
                    const timeToUse = excelTime !== "—" ? excelTime : undefined;
                    recordStatusTransition(local.tekion_id, "fixed_ops_status", nextFixed, timeToUse);
                }
                if (varChanged && nextVar) {
                    const excelTime = sanitizeExcelTimestamp(remote.variableOpsTracking);
                    const timeToUse = excelTime !== "—" ? excelTime : undefined;
                    recordStatusTransition(local.tekion_id, "variable_ops_status", nextVar, timeToUse);
                }
                if (testingChanged && nextTesting) {
                    recordStatusTransition(local.tekion_id, "testing_status", nextTesting);
                }
                return {
                    ...local,
                    fixed_ops_status: nextFixed,
                    variable_ops_status: nextVar,
                    testing_status: nextTesting,
                    custom_assignee: fixedAssigneeChanged ? remoteFixedAssignee : currentFixedAssignee,
                    custom_variable_assignee: varAssigneeChanged ? remoteVarAssignee : currentVarAssignee,
                    not_worked: notWorkedChanged ? remoteNotWorked : currentNotWorked,
                };
            }
            return local;
        });
        return { updatedStores, hasChanges };
    }
    catch (err) {
        console.debug("[storesGraphSync] Silent poll skipped or token expired:", err);
        return { updatedStores: currentRecords, hasChanges: false };
    }
}
/**
 * Authoritative Two-Way Sync with Formula & Assignee Injection
 */
const EXCEL_SNAPSHOT_URL = "http://localhost:4000/api/stores/excel-snapshot";
async function readSheetGrid(token, sheetName, sessionId) {
    try {
        const data = await graphRequest(`/worksheets/${encodeURIComponent(sheetName)}/usedRange?$select=formulas`, token, { method: "GET" }, sessionId);
        return (data?.formulas ?? []).map((r) => r.map((c) => String(c ?? "")));
    }
    catch {
        return [];
    }
}
async function snapshotSheetBeforeSync(sheetName, grid) {
    if (grid.length < 2)
        return;
    const res = await fetch(EXCEL_SNAPSHOT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetName, rows: grid }),
    });
    if (!res.ok) {
        throw new Error(`Aborted Excel sync for "${sheetName}": could not save a safety backup of the existing sheet (HTTP ${res.status}).`);
    }
}
function isEmptyCell(v) {
    const t = String(v ?? "").trim();
    return t === "" || t === "—";
}
export async function syncStoresToGraphWorkbook(records) {
    if (!records.length) {
        throw new Error("No store records available to sync");
    }
    const token = getEffectiveGraphToken();
    if (!token) {
        throw new Error("Microsoft Graph API token missing. Open SharePoint in your browser to auto-capture, or paste a token in Settings.");
    }
    validateGraphTokenScope(token);
    const sessionId = await createSession(token);
    try {
        const existingSheets = await listWorksheetNames(token, sessionId);
        const remoteDataMap = await fetchExistingWorkbookData(token, existingSheets, sessionId);
        const mergedRecords = mergeLocalAndRemoteStores(records, remoteDataMap);
        const groups = groupStoresByMonth(mergedRecords);
        if (groups.length === 0) {
            throw new Error("No monthly groups available to sync");
        }
        const existingSheetSet = new Set(existingSheets);
        let formattedRangeCount = 0;
        let formattedCellCount = 0;
        const fixedOpsIdx = STORE_EXPORT_HEADERS.indexOf("Fixed Ops");
        const fixedOpsTrackIdx = STORE_EXPORT_HEADERS.indexOf("Fixed Ops Tracking");
        const varOpsIdx = STORE_EXPORT_HEADERS.indexOf("Variable Ops");
        const varOpsTrackIdx = STORE_EXPORT_HEADERS.indexOf("Variable Ops Tracking");
        const fixedAssigneeColIdx = STORE_EXPORT_HEADERS.findIndex((h) => {
            const s = h.toLowerCase();
            return s === "fixed ops assignee" || s === "assignee" || s === "lead assignee";
        });
        const varAssigneeColIdx = STORE_EXPORT_HEADERS.findIndex((h) => {
            const s = h.toLowerCase();
            return s === "variable ops assignee" || s === "var ops assignee";
        });
        const notWorkedColIdx = STORE_EXPORT_HEADERS.findIndex((h) => /not\s*worked/i.test(h));
        const fixedColLetter = toExcelColumnName(fixedOpsIdx);
        const fixedTrackColLetter = toExcelColumnName(fixedOpsTrackIdx);
        const varColLetter = toExcelColumnName(varOpsIdx);
        const varTrackColLetter = toExcelColumnName(varOpsTrackIdx);
        for (const group of groups) {
            await ensureWorksheet(token, group.sheetName, existingSheetSet, sessionId);
            const rawRows = rowsToMatrix(group.rows);
            const existingGrid = await readSheetGrid(token, group.sheetName, sessionId);
            await snapshotSheetBeforeSync(group.sheetName, existingGrid);
            const oldHeader = (existingGrid[0] ?? []).map((h) => h.trim().toLowerCase());
            const newHeader = STORE_EXPORT_HEADERS.map((h) => h.toLowerCase());
            const oldIdCol = oldHeader.indexOf("tekion id");
            const oldRowsById = new Map();
            if (oldIdCol !== -1) {
                for (const r of existingGrid.slice(1)) {
                    const id = String(r[oldIdCol] ?? "").trim();
                    if (id)
                        oldRowsById.set(id, r);
                }
            }
            const colMap = newHeader.map((h) => {
                let i = oldHeader.indexOf(h);
                if (i === -1 && (h === "fixed ops assignee" || h === "assignee")) {
                    i = oldHeader.indexOf("lead assignee");
                }
                if (i === -1 && /not\s*worked/i.test(h)) {
                    i = oldHeader.findIndex((oh) => /not\s*worked/i.test(oh));
                }
                return i;
            });
            const allLocalIds = new Set(mergedRecords.map((r) => r.tekion_id));
            const groupIds = new Set(group.rows.map((r) => String(r["Tekion ID"] ?? "").trim()));
            const trackingCols = new Set([fixedOpsTrackIdx, varOpsTrackIdx]);
            for (const row of rawRows) {
                const old = oldRowsById.get(String(row[0] ?? "").trim());
                if (!old)
                    continue;
                for (let j = 0; j < row.length; j++) {
                    if (trackingCols.has(j) || colMap[j] === -1)
                        continue;
                    if (isEmptyCell(row[j]) && !isEmptyCell(old[colMap[j]])) {
                        row[j] = old[colMap[j]];
                    }
                }
            }
            for (const [id, old] of oldRowsById) {
                if (groupIds.has(id) || allLocalIds.has(id))
                    continue;
                const kept = newHeader.map((_, j) => colMap[j] === -1 || trackingCols.has(j) ? "" : old[colMap[j]] ?? "");
                rawRows.push(kept);
            }
            const newTotalRows = rawRows.length + 1;
            const existingRowCount = await getUsedRangeRowCount(token, group.sheetName, sessionId);
            const clearRows = Math.max(existingRowCount, newTotalRows, 1);
            await clearWorksheetRect(token, group.sheetName, clearRows, STORE_EXPORT_HEADERS.length, sessionId);
            await patchRangeValues(token, group.sheetName, 1, [Array.from(STORE_EXPORT_HEADERS)], sessionId);
            const dataRowsWithFormulas = rawRows.map((row, index) => {
                const rowNum = index + 2;
                const rowCopy = [...row];
                const storeItem = group.rows[index];
                const tekionIdVal = storeItem?.["Tekion ID"] ?? storeItem?.tekionId;
                const localMatch = mergedRecords.find((s) => s.tekion_id === tekionIdVal);
                if (fixedAssigneeColIdx !== -1 && localMatch && localMatch.custom_assignee) {
                    rowCopy[fixedAssigneeColIdx] = localMatch.custom_assignee;
                }
                if (varAssigneeColIdx !== -1 && localMatch && localMatch.custom_variable_assignee) {
                    rowCopy[varAssigneeColIdx] = localMatch.custom_variable_assignee;
                }
                if (notWorkedColIdx !== -1 && localMatch && localMatch.not_worked) {
                    rowCopy[notWorkedColIdx] = localMatch.not_worked;
                }
                if (!rowCopy[fixedOpsTrackIdx] || rowCopy[fixedOpsTrackIdx] === "—") {
                    rowCopy[fixedOpsTrackIdx] = buildTrackingFormula(fixedColLetter, fixedTrackColLetter, rowNum);
                }
                if (!rowCopy[varOpsTrackIdx] || rowCopy[varOpsTrackIdx] === "—") {
                    rowCopy[varOpsTrackIdx] = buildTrackingFormula(varColLetter, varTrackColLetter, rowNum);
                }
                return rowCopy;
            });
            let currentRow = 2;
            let remaining = dataRowsWithFormulas.slice();
            while (remaining.length > 0) {
                const chunk = remaining.slice(0, CHUNK_SIZE);
                const address = buildRangeAddress(currentRow, chunk.length, STORE_EXPORT_HEADERS.length);
                await graphRequest(`/worksheets/${encodeURIComponent(group.sheetName)}/range(address='${address}')`, token, { method: "PATCH", body: JSON.stringify({ formulas: chunk }) }, sessionId);
                currentRow += chunk.length;
                remaining = remaining.slice(CHUNK_SIZE);
            }
            await applyHeaderFormatting(token, group.sheetName, STORE_EXPORT_HEADERS.length, sessionId);
            const formatting = await applyStatusFormatting(token, group.sheetName, group.rows, clearRows, sessionId);
            formattedRangeCount += formatting.rangeCount;
            formattedCellCount += formatting.cellCount;
        }
        return {
            workbookPath: SHAREPOINT_WORKBOOK_PATH,
            rowCount: mergedRecords.length,
            sheetCount: groups.length,
            sheets: groups.map((g) => g.sheetName),
            formattedRangeCount,
            formattedCellCount,
            updatedStores: mergedRecords,
        };
    }
    finally {
        await closeSession(token, sessionId);
    }
}
function parseLaunchDateForT(value) {
    if (!value)
        return null;
    if (/^\d+$/.test(value)) {
        const num = Number(value);
        const ms = value.length <= 10 ? num * 1000 : num;
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}
function isStoreLiveOrToday(launchDateStr) {
    const d = parseLaunchDateForT(launchDateStr);
    if (!d)
        return false;
    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const launchDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.round((launchDay.getTime() - startToday.getTime()) / 86400000);
    return diffDays <= 0;
}
export async function syncProdDealersToGraph(records) {
    if (isSyncingProdDealers || records.length === 0)
        return;
    const prodStores = records.filter((r) => isStoreLiveOrToday(r.launch_date));
    if (prodStores.length === 0)
        return;
    const token = getEffectiveGraphToken();
    if (!token || isTokenExpired(token))
        return;
    isSyncingProdDealers = true;
    try {
        const sessionId = await createSession(token);
        try {
            const existingSheets = await listWorksheetNames(token, sessionId);
            const existingSheetSet = new Set(existingSheets);
            await ensureWorksheet(token, PROD_DEALER_SHEET_NAME, existingSheetSet, sessionId);
            const remoteDataMap = await fetchExistingWorkbookData(token, [PROD_DEALER_SHEET_NAME], sessionId);
            const mergedProdStores = mergeLocalAndRemoteStores(prodStores, remoteDataMap);
            const groups = groupStoresByMonth(mergedProdStores);
            const prodRows = groups.flatMap((g) => g.rows);
            if (prodRows.length === 0)
                return;
            const rawRows = rowsToMatrix(prodRows);
            const existingRowCount = await getUsedRangeRowCount(token, PROD_DEALER_SHEET_NAME, sessionId);
            const clearRows = Math.max(existingRowCount, rawRows.length + 1, 1);
            await clearWorksheetRect(token, PROD_DEALER_SHEET_NAME, clearRows, STORE_EXPORT_HEADERS.length, sessionId);
            await patchRangeValues(token, PROD_DEALER_SHEET_NAME, 1, [Array.from(STORE_EXPORT_HEADERS)], sessionId);
            const fixedOpsIdx = STORE_EXPORT_HEADERS.indexOf("Fixed Ops");
            const fixedOpsTrackIdx = STORE_EXPORT_HEADERS.indexOf("Fixed Ops Tracking");
            const varOpsIdx = STORE_EXPORT_HEADERS.indexOf("Variable Ops");
            const varOpsTrackIdx = STORE_EXPORT_HEADERS.indexOf("Variable Ops Tracking");
            const fixedAssigneeColIdx = STORE_EXPORT_HEADERS.findIndex((h) => {
                const s = h.toLowerCase();
                return s === "fixed ops assignee" || s === "assignee" || s === "lead assignee";
            });
            const varAssigneeColIdx = STORE_EXPORT_HEADERS.findIndex((h) => {
                const s = h.toLowerCase();
                return s === "variable ops assignee" || s === "var ops assignee";
            });
            const notWorkedColIdx = STORE_EXPORT_HEADERS.findIndex((h) => /not\s*worked/i.test(h));
            const fixedColLetter = toExcelColumnName(fixedOpsIdx);
            const fixedTrackColLetter = toExcelColumnName(fixedOpsTrackIdx);
            const varColLetter = toExcelColumnName(varOpsIdx);
            const varTrackColLetter = toExcelColumnName(varOpsTrackIdx);
            const dataRowsWithFormulas = rawRows.map((row, index) => {
                const rowNum = index + 2;
                const rowCopy = [...row];
                const storeItem = prodRows[index];
                const tekionIdVal = storeItem?.["Tekion ID"] ?? storeItem?.tekionId;
                const localMatch = mergedProdStores.find((s) => s.tekion_id === tekionIdVal);
                if (fixedAssigneeColIdx !== -1 && localMatch && localMatch.custom_assignee) {
                    rowCopy[fixedAssigneeColIdx] = localMatch.custom_assignee;
                }
                if (varAssigneeColIdx !== -1 && localMatch && localMatch.custom_variable_assignee) {
                    rowCopy[varAssigneeColIdx] = localMatch.custom_variable_assignee;
                }
                if (notWorkedColIdx !== -1 && localMatch && localMatch.not_worked) {
                    rowCopy[notWorkedColIdx] = localMatch.not_worked;
                }
                if (!rowCopy[fixedOpsTrackIdx] || rowCopy[fixedOpsTrackIdx] === "—") {
                    rowCopy[fixedOpsTrackIdx] = buildTrackingFormula(fixedColLetter, fixedTrackColLetter, rowNum);
                }
                if (!rowCopy[varOpsTrackIdx] || rowCopy[varOpsTrackIdx] === "—") {
                    rowCopy[varOpsTrackIdx] = buildTrackingFormula(varColLetter, varTrackColLetter, rowNum);
                }
                return rowCopy;
            });
            let currentRow = 2;
            let remaining = dataRowsWithFormulas.slice();
            while (remaining.length > 0) {
                const chunk = remaining.slice(0, CHUNK_SIZE);
                const address = buildRangeAddress(currentRow, chunk.length, STORE_EXPORT_HEADERS.length);
                await graphRequest(`/worksheets/${encodeURIComponent(PROD_DEALER_SHEET_NAME)}/range(address='${address}')`, token, { method: "PATCH", body: JSON.stringify({ formulas: chunk }) }, sessionId);
                currentRow += chunk.length;
                remaining = remaining.slice(CHUNK_SIZE);
            }
            await applyHeaderFormatting(token, PROD_DEALER_SHEET_NAME, STORE_EXPORT_HEADERS.length, sessionId);
            await applyStatusFormatting(token, PROD_DEALER_SHEET_NAME, prodRows, clearRows, sessionId);
        }
        finally {
            await closeSession(token, sessionId);
        }
    }
    catch (err) {
        console.debug("[storesGraphSync] Auto-sync to 'Prod Dealer' sheet skipped:", err);
    }
    finally {
        isSyncingProdDealers = false;
    }
}
