import type { StoreRecord } from "./storesDb";
import type { OnboardingStatus } from "./storeOnboardingStatusApi";

export const STORE_EXPORT_HEADERS = [
  "Tekion ID",
  "Dealer ID",
  "Dealership",
  "Go Live",
  "T Label",
  "IMP Type",
  "Pre-Prod",
  "POD",
  "Blueprint Parts",
  "Blueprint Service",
  "Blueprint Accounting",
  "Blueprint CRM",
  "Blueprint Analytics",
  "SignOff Parts",
  "SignOff Service",
  "SignOff Accounting",
  "Status Fetched At",
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
  return {
    "Tekion ID": store.tekion_id || "",
    "Dealer ID": store.dealer_id || "",
    Dealership: store.dba_name || "",
    "Go Live": formatLaunchDate(store.launch_date),
    "T Label": getTLabel(store.launch_date),
    "IMP Type": store.implementation_type || "",
    "Pre-Prod": store.pre_production_environment_status || "",
    POD: store.superpod_id || "",
    "Blueprint Parts": toStatusText(store.blueprint_statuses?.parts),
    "Blueprint Service": toStatusText(store.blueprint_statuses?.service),
    "Blueprint Accounting": toStatusText(store.blueprint_statuses?.accounting),
    "Blueprint CRM": toStatusText(store.blueprint_statuses?.crm),
    "Blueprint Analytics": toStatusText(store.blueprint_statuses?.analytics),
    "SignOff Parts": toStatusText(store.signoff_statuses?.parts),
    "SignOff Service": toStatusText(store.signoff_statuses?.service),
    "SignOff Accounting": toStatusText(store.signoff_statuses?.accounting),
    "Status Fetched At": store.onboarding_status_fetched_at || "",
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
