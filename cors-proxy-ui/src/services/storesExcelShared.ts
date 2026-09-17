import type { StoreRecord } from "./storesDb";
import { getStatusTimeline } from "./storesDb";
import type { OnboardingStatus } from "./storeOnboardingStatusApi";

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
  "OEM Dealer Codes",
  "Journals Accessible Count",
  "Sales Chains Accessible Count",
  "COA Accessible Count",
  "Fixed Ops",
  "Fixed Ops Tracking",
  "Variable Ops",
  "Variable Ops Tracking",
  "SignOff Parts",
  "SignOff Parts Last Released Time",
  "SignOff Service",
  "SignOff Service Last Released Time",
  "SignOff Accounting",
  "SignOff Accounting Last Released Time",
  "Testing",
  "Status Fetched At",
  "Setup Data Fetched At",
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

function formatLaunchDate(value: string): string {
  const d = parseLaunchDate(value);
  if (!d) return value || "—";

  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  const year = d.getFullYear();

  return `${weekday} ${month}/${day}/${year}`;
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

/**
 * Parses raw Excel formula outputs, date strings, or numeric fractional serials
 * into a uniform high-precision time: e.g. "1:01:10 PM"
 */
export function sanitizeExcelTimestamp(rawVal?: string | number): string {
  if (!rawVal || rawVal === "—") return "—";

  const str = String(rawVal).trim();
  if (!str) return "—";

  // If it's an unevaluated formula string from a newly injected cell, return placeholder
  if (str.startsWith("=")) return "—";

  // 1. Already formatted as 12-hour timestamp: e.g. "1:01:10 PM" or "01:01:10 PM"
  if (/^\d{1,2}:\d{2}:\d{2}\s*(AM|PM)$/i.test(str)) {
    return str.toUpperCase();
  }

  // 2. Excel numeric time serial (fraction of a 24-hour day, e.g. 0.54247685)
  const num = Number(str);
  if (!isNaN(num) && num > 0 && num < 1) {
    const totalSeconds = Math.round(num * 86400);
    const hours24 = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const ampm = hours24 >= 12 ? "PM" : "AM";
    const hours12 = hours24 % 12 || 12;

    const pad = (n: number) => String(n).padStart(2, "0");
    return `${hours12}:${pad(minutes)}:${pad(seconds)} ${ampm}`;
  }

  // 3. Fallback standard parse
  const parsed = formatTimeOnlyPrecise(str);
  return parsed || str;
}

/**
 * Returns the latest timestamp recorded locally or returns fallback
 */
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

export function mapStoreToExcelRow(store: StoreRecord): StoreExcelRow {
  const setupError = store.setup_data_error ? `Error: ${store.setup_data_error}` : "";
  const oemCodes = store.setup_data?.oemDealerCodes?.join(", ") || setupError;

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
    "SignOff Parts": toStatusText(store.signoff_statuses?.parts),
    "SignOff Parts Last Released Time": formatDateTimePrecise(store.signoff_statuses?.parts_last_released_time),
    "SignOff Service": toStatusText(store.signoff_statuses?.service),
    "SignOff Service Last Released Time": formatDateTimePrecise(store.signoff_statuses?.service_last_released_time),
    "SignOff Accounting": toStatusText(store.signoff_statuses?.accounting),
    "SignOff Accounting Last Released Time": formatDateTimePrecise(store.signoff_statuses?.accounting_last_released_time),
    Testing: store.testing_status || "TO DO",
    "Status Fetched At": formatDateTimePrecise(store.onboarding_status_fetched_at),
    "Setup Data Fetched At": formatDateTimePrecise(
      store.setup_data_fetched_at || store.setup_data?.fetchedAt
    ),
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