import type { SlackDirectoryUser } from "../../services/storeSlackHelper";

export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim().replace(/^"|"$/g, ""));
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^"|"$/g, ""));
  return result;
}

export function parseSlackCsv(csvContent?: string): Map<string, SlackDirectoryUser> {
  const map = new Map<string, SlackDirectoryUser>();
  if (!csvContent || typeof csvContent !== "string") return map;

  const lines = csvContent.split(/\r?\n/);
  if (lines.length < 2) return map;

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  let userIdIdx = headers.findIndex((h) => h === "user id" || h === "id");
  let nameIdx = headers.findIndex((h) => h === "full name" || h === "name");
  let emailIdx = headers.findIndex((h) => h === "email");
  let jobTitleIdx = headers.findIndex((h) => h === "job title" || h === "title");

  if (userIdIdx === -1) userIdIdx = 0;
  if (nameIdx === -1) nameIdx = 1;
  if (emailIdx === -1) emailIdx = 2;
  if (jobTitleIdx === -1) jobTitleIdx = 3;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = parseCsvLine(line);
    if (cols.length > Math.max(userIdIdx, nameIdx, emailIdx)) {
      const userId = cols[userIdIdx] || "";
      const fullName = cols[nameIdx] || "";
      const email = (cols[emailIdx] || "").toLowerCase();
      const jobTitle = cols[jobTitleIdx] || "";
      if (email) {
        map.set(email, { userId, fullName, email, jobTitle });
      }
    }
  }
  return map;
}

export function cleanImpType(value?: string): string {
  if (!value) return "";
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}

export function parseLaunchDate(value: string): Date | null {
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

export function formatLaunchDateUI(value: string): { weekday: string; date: string } {
  const d = parseLaunchDate(value);
  if (!d) return { weekday: "", date: value || "—" };
  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  const year = d.getFullYear();
  return { weekday, date: `${month}/${day}/${year}` };
}

export function getMonthYearString(value: string): string | null {
  const d = parseLaunchDate(value);
  if (!d) return null;
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export function getMonthYearSortKey(value: string): number {
  const d = parseLaunchDate(value);
  if (!d) return 0;
  return d.getFullYear() * 100 + d.getMonth();
}

export function getTLabel(value: string): { label: string; tone: "future" | "today" | "past" | "unknown" } {
  const d = parseLaunchDate(value);
  if (!d) return { label: "Unknown", tone: "unknown" };
  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const launchDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffMs = launchDay.getTime() - startToday.getTime();
  const diffDays = Math.round(diffMs / 86400000);

  if (diffDays > 0) return { label: `T-${diffDays}`, tone: "future" };
  if (diffDays === 0) return { label: "T", tone: "today" };
  return { label: "Launched", tone: "past" };
}

export function toInputDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function startOfDayUnix(dateStr: string): number {
  return Math.floor(new Date(`${dateStr}T00:00:00`).getTime() / 1000);
}

export function endOfDayUnix(dateStr: string): number {
  return Math.floor(new Date(`${dateStr}T23:59:59`).getTime() / 1000);
}

export function startOfDayMs(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00`).getTime();
}

export function endOfDayMs(dateStr: string): number {
  return new Date(`${dateStr}T23:59:59.999`).getTime();
}

export function buildTapWorkordersUrl(fromDate: string, toDate: string): string {
  const filters = [
    { type: "actual_launch_date", operator: "BTW", values: [startOfDayMs(fromDate), endOfDayMs(toDate)] },
    { type: "product_types", operator: "IN", values: ["Analytics", "ARC", "CRM"] },
  ];
  const params = new URLSearchParams({
    filters: JSON.stringify(filters),
    searchField: "All",
    sort: JSON.stringify({ actual_launch_date: "ASC" }),
  });
  return `https://tap.tekioncloud.com/workorders/list?${params.toString()}`;
}

export function isSameLocalDay(isoString?: string): boolean {
  if (!isoString) return false;
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function getPodStyle(superpodId?: string) {
  const norm = (superpodId || "").trim().toLowerCase();
  if (norm === "2" || norm === "pod 2" || norm === "pod-2") {
    return { bg: "rgba(59, 130, 246, 0.16)", color: "#60a5fa", border: "rgba(59, 130, 246, 0.30)" };
  }
  if (norm === "1" || norm === "pod 1" || norm === "pod-1") {
    return { bg: "rgba(168, 85, 247, 0.16)", color: "#c084fc", border: "rgba(168, 85, 247, 0.30)" };
  }
  if (norm === "3" || norm === "pod 3" || norm === "pod-3") {
    return { bg: "rgba(236, 72, 153, 0.16)", color: "#f472b6", border: "rgba(236, 72, 153, 0.30)" };
  }
  if (norm === "4" || norm === "pod 4" || norm === "pod-4") {
    return { bg: "rgba(168, 85, 247, 0.16)", color: "#34d399", border: "rgba(168, 85, 247, 0.30)" };
  }
  return { bg: "rgba(148, 163, 184, 0.12)", color: "#cbd5e1", border: "rgba(148, 163, 184, 0.22)" };
}
