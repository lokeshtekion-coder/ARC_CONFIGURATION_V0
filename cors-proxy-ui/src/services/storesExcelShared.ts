import type { StoreRecord } from "./storesDb";
import { getStatusTimeline } from "./storesDb";
import type { OnboardingStatus } from "./storeOnboardingStatusApi";
import { resolveStoreAssignee } from "./assigneeService";

export const STORE_EXPORT_HEADERS = [
  "Tekion ID",
  "Dealer ID",
  "Dealership",
  "Go Live",
  "T Label",
  "IMP Type",
  "Products",
  "Pre-Prod",
  "POD",
  "Blueprint Parts",
  "Blueprint Parts Last Released Time",
  "Blueprint Service",
  "Blueprint Service Last Released Time",
  "Blueprint Accounting",
  "Blueprint Accounting Last Released Time",
  "Blueprint CRM",
  "Blueprint CRM Last Released Time",
  "Blueprint Analytics",
  "Blueprint Analytics Last Released Time",
  "Setup Data",
  "OEM Dealer Codes",
  "Journals Accessible Count",
  "Sales Chains Accessible Count",
  "COA Accessible Count",
  "Fixed Ops",
  "Fixed Ops Tracking",
  "Variable Ops",
  "Variable Ops Tracking",
  "Testing",
  "Not Worked?",
  "Status Fetched At",
  "Setup Data Fetched At",
  "Fixed Ops Assignee",
  "Variable Ops Assignee",
  "Parts Task",
  "Parts Comment",
  "Service Task",
  "Service Comment",
  "Accounting Task",
  "Accounting Comment",
] as const;

export type StoreExportHeader = (typeof STORE_EXPORT_HEADERS)[number];
export type StoreExcelRow = Record<StoreExportHeader, string>;

function parseLaunchDate(value: string): Date | null {
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

/**
 * Formats launch date strictly as MM/DD/YYYY without weekday prefix
 */
function formatLaunchDate(value: string): string {
  const d = parseLaunchDate(value);
  if (!d) return value || "—";

  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  const year = d.getFullYear();

  return `${month}/${day}/${year}`;
}

function getTLabel(value: string): string {
  const d = parseLaunchDate(value);
  if (!d) return "Unknown";

  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const launchDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const diffMs = launchDay.getTime() - startToday.getTime();
  const diffDays = Math.round(diffMs / 86400000);

  if (diffDays > 0) return `T-${diffDays}`;
  if (diffDays === 0) return "T";
  return "Launched";
}

function toStatusText(status?: OnboardingStatus): string {
  return status ?? "UNKNOWN";
}

function toMonthSheetName(value: string): string {
  const d = parseLaunchDate(value);
  if (!d) return "Unknown Month";

  const label = d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  });

  return sanitizeSheetName(label);
}

function sanitizeSheetName(name: string): string {
  return name.replace(/[\\/*?:[\]]/g, "-").slice(0, 31) || "Sheet";
}

export function formatTimeOnlyPrecise(value?: string | number): string {
  if (!value) return "";

  let d: Date;
  const strValue = String(value).trim();

  if (/^\d+$/.test(strValue)) {
    d = new Date(Number(strValue));
  } else {
    d = new Date(strValue);
  }

  if (Number.isNaN(d.getTime())) return strValue;

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const seconds = String(d.getSeconds()).padStart(2, "0");

  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  hours = hours ? hours : 12;

  return `${hours}:${minutes}:${seconds} ${ampm}`;
}

export function formatDateTimePrecise(value?: string | number): string {
  if (!value) return "";

  let d: Date;
  const strValue = String(value).trim();

  if (/^\d+$/.test(strValue)) {
    d = new Date(Number(strValue));
  } else {
    d = new Date(strValue);
  }

  if (Number.isNaN(d.getTime())) return strValue;

  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);

  return `${mm}/${dd}/${yy} | ${formatTimeOnlyPrecise(d.getTime())}`;
}

export function sanitizeExcelTimestamp(rawVal?: string | number): string {
  if (!rawVal || rawVal === "—") return "—";

  const str = String(rawVal).trim();
  if (!str) return "—";

  if (str.startsWith("=")) return "—";

  if (/^\d{1,2}:\d{2}:\d{2}\s*(AM|PM)$/i.test(str)) {
    return str.toUpperCase();
  }

  const num = Number(str);
  if (!isNaN(num) && num > 0 && num < 1) {
    const totalSeconds = Math.min(86399, Math.round(num * 86400));
    const hours24 = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const ampm = hours24 >= 12 ? "PM" : "AM";
    const hours12 = hours24 % 12 || 12;

    const pad = (n: number) => String(n).padStart(2, "0");
    return `${hours12}:${pad(minutes)}:${pad(seconds)} ${ampm}`;
  }

  const parsed = formatTimeOnlyPrecise(str);
  return parsed || str;
}

export function buildLatestFieldTrackingText(
  tekionId: string,
  field: "fixed_ops_status" | "variable_ops_status" | "testing_status",
  includeLabel = true
): string {
  const timeline = getStatusTimeline()[tekionId];
  if (!timeline) return "—";

  const timing = timeline[field];
  if (!timing) return "—";

  if (timing.completedAt) {
    const timeStr = formatTimeOnlyPrecise(timing.completedAt);
    return includeLabel ? `Completed: ${timeStr}` : timeStr;
  }

  if (timing.wipAt) {
    const timeStr = formatTimeOnlyPrecise(timing.wipAt);
    return includeLabel ? `WIP: ${timeStr}` : timeStr;
  }

  return "—";
}

export function sortStoresByGoLive(records: StoreRecord[]): StoreRecord[] {
  return [...records].sort((a, b) => {
    const aDate = parseLaunchDate(a.launch_date);
    const bDate = parseLaunchDate(b.launch_date);

    const aTime = aDate ? aDate.getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = bDate ? bDate.getTime() : Number.MAX_SAFE_INTEGER;

    return aTime - bTime;
  });
}

export function computeSetupDataStatus(store: StoreRecord): string {
  if (store.setup_data_error) {
    return "Unable to fetch";
  }

  const coa = store.setup_data?.coaAccessibleDealerCount;
  if (coa == null) {
    return "Unable to fetch";
  }

  return coa > 50 ? "Yes" : "Issue with COA";
}

/**
 * Truncates text after 250 words and appends "..."
 */
function truncateAfter250Words(text?: string | null): string {
  if (!text) return "—";
  const cleaned = text.trim();
  if (!cleaned) return "—";

  const words = cleaned.split(/\s+/);
  if (words.length <= 250) {
    return cleaned;
  }

  return `${words.slice(0, 250).join(" ")}...`;
}

function formatTaskStatusDisplay(rawStatus?: string): string {
  const s = String(rawStatus || "").trim().toLowerCase();
  if (s === "inprogress") return "In Progress";
  if (s === "completed") return "Completed";
  if (s === "duplicate") return "Duplicate";
  if (s === "new") return "New";
  return rawStatus ? rawStatus.toUpperCase() : "TO DO";
}

/**
 * Generates an Excel HYPERLINK formula pointing to the TAP task list view
 */
function buildTaskHyperlink(task?: any): string {
  if (!task || !task.taskId) return "—";
  const label = formatTaskStatusDisplay(task.status);
  const url = `https://tap.tekioncloud.com/tm/mytasks/all/list/${task.taskId}`;
  return `=HYPERLINK("${url}","${label}")`;
}

export function mapStoreToExcelRow(store: StoreRecord): StoreExcelRow {
  const setupError = store.setup_data_error ? `Error: ${store.setup_data_error}` : "";
  const oemCodes = store.setup_data?.oemDealerCodes?.join(", ") || setupError;

  const blueprintTasks = store.fetched_blueprint_tasks || {};
  const partsTask = blueprintTasks.partsTasks?.[0];
  const serviceTask = blueprintTasks.serviceTasks?.[0];
  const accountingTask = blueprintTasks.accountingTasks?.[0];

  return {
    "Tekion ID": store.tekion_id || "",
    "Dealer ID": store.dealer_id || "",
    Dealership: store.dba_name || "",
    "Go Live": formatLaunchDate(store.launch_date),
    "T Label": getTLabel(store.launch_date),
    "IMP Type": store.implementation_type || "",
    Products: store.product_types || "—",
    "Pre-Prod": store.pre_production_environment_status || "",
    POD: store.superpod_id || "",
    "Blueprint Parts": toStatusText(store.blueprint_statuses?.parts),
    "Blueprint Parts Last Released Time": formatDateTimePrecise(store.blueprint_statuses?.parts_last_released_time),
    "Blueprint Service": toStatusText(store.blueprint_statuses?.service),
    "Blueprint Service Last Released Time": formatDateTimePrecise(store.blueprint_statuses?.service_last_released_time),
    "Blueprint Accounting": toStatusText(store.blueprint_statuses?.accounting),
    "Blueprint Accounting Last Released Time": formatDateTimePrecise(store.blueprint_statuses?.accounting_last_released_time),
    "Blueprint CRM": toStatusText(store.blueprint_statuses?.crm),
    "Blueprint CRM Last Released Time": formatDateTimePrecise(store.blueprint_statuses?.crm_last_released_time),
    "Blueprint Analytics": toStatusText(store.blueprint_statuses?.analytics),
    "Blueprint Analytics Last Released Time": formatDateTimePrecise(store.blueprint_statuses?.analytics_last_released_time),
    "Setup Data": computeSetupDataStatus(store),
    "OEM Dealer Codes": oemCodes,
    "Journals Accessible Count":
      store.setup_data?.journalsAccessibleDealerCount != null
        ? String(store.setup_data.journalsAccessibleDealerCount)
        : "",
    "Sales Chains Accessible Count":
      store.setup_data?.salesChainsAccessibleDealerCount != null
        ? String(store.setup_data.salesChainsAccessibleDealerCount)
        : "",
    "COA Accessible Count":
      store.setup_data?.coaAccessibleDealerCount != null
        ? String(store.setup_data.coaAccessibleDealerCount)
        : "",
    "Fixed Ops": store.fixed_ops_status || store.configuration_status || "TO DO",
    "Fixed Ops Tracking": buildLatestFieldTrackingText(store.tekion_id, "fixed_ops_status", false),
    "Variable Ops": store.variable_ops_status || "TO DO",
    "Variable Ops Tracking": buildLatestFieldTrackingText(store.tekion_id, "variable_ops_status", false),
    Testing: store.testing_status || "TO DO",
    "Not Worked?": store.not_worked || "",
    "Status Fetched At": formatDateTimePrecise(store.onboarding_status_fetched_at),
    "Setup Data Fetched At": formatDateTimePrecise(
      store.setup_data_fetched_at || store.setup_data?.fetchedAt
    ),
    "Fixed Ops Assignee": resolveStoreAssignee(store) || store.custom_assignee || "",
    "Variable Ops Assignee": store.custom_variable_assignee || "",

    // Hydrated TAP Task Details
    "Parts Task": buildTaskHyperlink(partsTask),
    "Parts Comment": truncateAfter250Words(partsTask?.latestComment?.content),
    "Service Task": buildTaskHyperlink(serviceTask),
    "Service Comment": truncateAfter250Words(serviceTask?.latestComment?.content),
    "Accounting Task": buildTaskHyperlink(accountingTask),
    "Accounting Comment": truncateAfter250Words(accountingTask?.latestComment?.content),
  };
}

export function groupStoresByMonth(records: StoreRecord[]): Array<{
  sheetName: string;
  rows: StoreExcelRow[];
}> {
  const groups = new Map<string, StoreRecord[]>();

  for (const record of sortStoresByGoLive(records)) {
    const sheetName = toMonthSheetName(record.launch_date);
    const bucket = groups.get(sheetName) ?? [];
    bucket.push(record);
    groups.set(sheetName, bucket);
  }

  return Array.from(groups.entries()).map(([sheetName, monthRecords]) => ({
    sheetName,
    rows: monthRecords.map(mapStoreToExcelRow),
  }));
}

export function rowsToMatrix(rows: StoreExcelRow[]): string[][] {
  return rows.map((row) => STORE_EXPORT_HEADERS.map((header) => row[header] ?? ""));
}