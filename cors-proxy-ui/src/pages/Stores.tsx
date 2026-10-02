import React, { useEffect, useMemo, useState, useCallback } from "react";
// @ts-ignore - raw import for Vite/bundler
import slackCsvText from "./DATA/Slack.csv?raw";
import { storesBotRunner, type BotState } from "../services/storesBotRunner";
import {
  fetchStores,
  getTDaysRange,
  ExpiredCaptureTokenError,
} from "../services/tekionStoresApi";
import type { TRange } from "../services/tekionStoresApi";
import {
  getStores,
  saveStores,
  getStoredStatusVault,
  saveStatusToVault,
  saveNotWorkedToVault,
  recordStatusTransition,
  bulkUpdateStatusVault,
  resolveStoreProjectId,
  NOT_WORKED_OPTIONS,
  type StoreRecord,
  type CustomPhaseStatus,
  type StoreSetupData,
} from "../services/storesDb";
import type {
  OnboardingStatus,
  StoreBlueprintStatuses,
  StoreSignoffStatuses,
} from "../services/storeOnboardingStatusApi";
import { fetchStoreOnboardingStatuses } from "../services/storeOnboardingStatusApi";
import { exportStoresToExcel } from "../services/storesExcelExport";
import {
  syncStoresToGraphWorkbook,
  pullStatusUpdatesFromGraph,
  patchSingleStoreStatusInGraph,
  patchSingleStoreAssigneeInGraph,
  patchSingleStoreVariableAssigneeInGraph,
  patchSingleStoreNotWorkedInGraph,
  syncProdDealersToGraph,
} from "../services/storesGraphSync";
import { buildLatestFieldTrackingText } from "../services/storesExcelShared";
import {
  buildStoreSlackDraftContext,
  getSlackSession,
  sendSlackMessage,
  type SlackRecipientCandidate,
  type SlackDirectoryUser,
} from "../services/storeSlackHelper";
import { fetchSetupDataForStore, isSetupDataComplete } from "../services/storeSetupDataService";
import { isUserAdmin } from "../services/authHelper";
import {
  runSlackAlerts,
  maybeSendDailyDigest,
  dispatchAllThreeReports,
  isSlackSessionActive,
} from "../services/slackAlertsService";
import {
  ASSIGNEE_OPTIONS,
  resolveStoreAssignee,
  loadAssigneeConfig,
  reconcileAssignments,
  recordManualAssignment,
  runAutoAssign,
} from "../services/assigneeService";
import { batchFetchRealTapStatuses } from "../services/tapTasksApi";
import DealerTasksPanel, {
  type StoreBlueprintTasks,
} from "./DealerTasksPanel";
import "./Stores.css";

interface Props {
  onBack: () => void;
}

export type AssigneeName = typeof ASSIGNEE_OPTIONS[number];

export type ExtendedStoreRecord = StoreRecord & {
  fetched_blueprint_tasks?: StoreBlueprintTasks;
  custom_assignee?: AssigneeName | string;
  custom_variable_assignee?: AssigneeName | string;
  fixed_ops_attachments?: number;
  variable_ops_attachments?: number;
  attachments_incomplete?: boolean;
};

const logger = {
  info: (...args: unknown[]) => console.info("[Stores]", ...args),
  debug: (...args: unknown[]) => console.debug("[Stores]", ...args),
  warn: (...args: unknown[]) => console.warn("[Stores]", ...args),
  error: (...args: unknown[]) => console.error("[Stores]", ...args),
};

function parseCsvLine(line: string): string[] {
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

function parseSlackCsv(csvContent?: string): Map<string, SlackDirectoryUser> {
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

const STATIC_SLACK_MAP = parseSlackCsv(
  typeof slackCsvText === "string" ? slackCsvText : ""
);

function cleanImpType(value?: string): string {
  if (!value) return "";
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}

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

function formatLaunchDateUI(value: string): { weekday: string; date: string } {
  const d = parseLaunchDate(value);
  if (!d) return { weekday: "", date: value || "—" };

  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  const year = d.getFullYear();

  return { weekday, date: `${month}/${day}/${year}` };
}

function getMonthYearString(value: string): string | null {
  const d = parseLaunchDate(value);
  if (!d) return null;
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function getMonthYearSortKey(value: string): number {
  const d = parseLaunchDate(value);
  if (!d) return 0;
  return d.getFullYear() * 100 + d.getMonth();
}

function getTLabel(
  value: string
): { label: string; tone: "future" | "today" | "past" | "unknown" } {
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

function getStoreFixedAssignee(row: ExtendedStoreRecord): string {
  return resolveStoreAssignee(row);
}

function getStoreVariableAssignee(row: ExtendedStoreRecord): string {
  return row.custom_variable_assignee || "";
}

function toInputDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = `${d.getMonth() + 1}`.padStart(2, "0");
  const dd = `${d.getDate()}`.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function startOfDayUnix(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`);
  return Math.floor(d.getTime() / 1000);
}

function endOfDayUnix(dateStr: string): number {
  const d = new Date(`${dateStr}T23:59:59`);
  return Math.floor(d.getTime() / 1000);
}

function startOfDayMs(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.getTime();
}

function endOfDayMs(dateStr: string): number {
  const d = new Date(`${dateStr}T23:59:59.999`);
  return d.getTime();
}

function buildTapWorkordersUrl(fromDate: string, toDate: string): string {
  const filters = [
    {
      type: "actual_launch_date",
      operator: "BTW",
      values: [startOfDayMs(fromDate), endOfDayMs(toDate)],
    },
    {
      type: "product_types",
      operator: "IN",
      values: ["Analytics", "ARC", "CRM"],
    },
  ];

  const sort = {
    actual_launch_date: "ASC",
  };

  const params = new URLSearchParams({
    filters: JSON.stringify(filters),
    searchField: "All",
    sort: JSON.stringify(sort),
  });

  return `https://tap.tekioncloud.com/workorders/list?${params.toString()}`;
}

function isSameLocalDay(isoString?: string): boolean {
  if (!isoString) return false;
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return false;

  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function shouldAutoFetchStatuses(records: ExtendedStoreRecord[]): boolean {
  if (records.length === 0) return true;
  return records.some((row) => !isSameLocalDay(row.onboarding_status_fetched_at));
}

function getStatusVisual(status: OnboardingStatus) {
  if (status === "COMPLETED") {
    return {
      symbol: "✓",
      background: "rgba(34, 197, 94, 0.16)",
      color: "#22c55e",
      border: "rgba(34, 197, 94, 0.30)",
      label: "Completed",
    };
  }

  if (status === "IN_PROGRESS") {
    return {
      symbol: "⏳",
      background: "rgba(245, 158, 11, 0.16)",
      color: "#f59e0b",
      border: "rgba(245, 158, 11, 0.30)",
      label: "In Progress",
    };
  }

  return {
    symbol: "○",
    background: "rgba(148, 163, 184, 0.14)",
    color: "#94a3b8",
    border: "rgba(148, 163, 184, 0.24)",
    label: status === "NOT_YET_STARTED" ? "Not Yet Started" : "Unknown",
  };
}

function getPodStyle(superpodId?: string) {
  const norm = (superpodId || "").trim().toLowerCase();
  if (norm === "2" || norm === "pod 2" || norm === "pod-2") {
    return {
      bg: "rgba(59, 130, 246, 0.16)",
      color: "#60a5fa",
      border: "rgba(59, 130, 246, 0.30)",
    };
  }
  if (norm === "1" || norm === "pod 1" || norm === "pod-1") {
    return {
      bg: "rgba(168, 85, 247, 0.16)",
      color: "#c084fc",
      border: "rgba(168, 85, 247, 0.30)",
    };
  }
  if (norm === "3" || norm === "pod 3" || norm === "pod-3") {
    return {
      bg: "rgba(236, 72, 153, 0.16)",
      color: "#f472b6",
      border: "rgba(236, 72, 153, 0.30)",
    };
  }
  if (norm === "4" || norm === "pod 4" || norm === "pod-4") {
    return {
      bg: "rgba(168, 85, 247, 0.16)",
      color: "#34d399",
      border: "rgba(168, 85, 247, 0.30)",
    };
  }
  return {
    bg: "rgba(148, 163, 184, 0.12)",
    color: "#cbd5e1",
    border: "rgba(148, 163, 184, 0.22)",
  };
}

function mergeIncomingStore(
  existing: ExtendedStoreRecord | undefined,
  incoming: StoreRecord
): ExtendedStoreRecord {
  if (!existing) return incoming as ExtendedStoreRecord;
  const merged: Record<string, any> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    const blank =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    if (!blank) merged[key] = value;
  }
  return merged as ExtendedStoreRecord;
}

function safelyMergeStatusFields(
  prevRecords: ExtendedStoreRecord[],
  updatedStores: StoreRecord[]
): ExtendedStoreRecord[] {
  const prevMap = new Map(prevRecords.map((s) => [s.tekion_id, s]));
  return updatedStores.map((uStore) => {
    const prev = prevMap.get(uStore.tekion_id);
    if (!prev) return uStore as ExtendedStoreRecord;
    return {
      ...prev,
      fixed_ops_status: uStore.fixed_ops_status,
      variable_ops_status: uStore.variable_ops_status,
      testing_status: uStore.testing_status,
      not_worked: uStore.not_worked ?? prev.not_worked,
      custom_assignee: (uStore as any).custom_assignee ?? prev.custom_assignee,
      custom_variable_assignee:
        (uStore as any).custom_variable_assignee ?? prev.custom_variable_assignee,
      fixed_ops_attachments: (uStore as any).fixed_ops_attachments ?? prev.fixed_ops_attachments,
      variable_ops_attachments: (uStore as any).variable_ops_attachments ?? prev.variable_ops_attachments,
      fetched_blueprint_tasks: (uStore as any).fetched_blueprint_tasks ?? prev.fetched_blueprint_tasks,
      attachments_incomplete: (uStore as any).attachments_incomplete ?? prev.attachments_incomplete,
    };
  });
}

const StatusChip: React.FC<{
  short: string;
  fullName: string;
  status: OnboardingStatus;
}> = ({ short, fullName, status }) => {
  const visual = getStatusVisual(status);

  return (
    <span
      title={`${fullName}: ${visual.label}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        padding: "3px 6px",
        borderRadius: 6,
        background: visual.background,
        color: visual.color,
        border: `1px solid ${visual.border}`,
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <span>{short}</span>
      <span style={{ fontSize: 9 }}>{visual.symbol}</span>
    </span>
  );
};

const StatusChipGroup: React.FC<{
  items: Array<{
    short: string;
    fullName: string;
    status: OnboardingStatus;
  }>;
}> = ({ items }) => (
  <div style={{ display: "inline-flex", gap: 4, flexWrap: "nowrap", alignItems: "center" }}>
    {items.map((item) => (
      <StatusChip
        key={item.fullName}
        short={item.short}
        fullName={item.fullName}
        status={item.status}
      />
    ))}
  </div>
);

const SetupDataChip: React.FC<{
  label: string;
  value: string | number;
  hasData: boolean;
  title: string;
}> = ({ label, value, hasData, title }) => (
  <span
    title={title}
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
      padding: "3px 6px",
      borderRadius: 6,
      background: hasData ? "rgba(56, 189, 248, 0.14)" : "rgba(148, 163, 184, 0.12)",
      color: hasData ? "#38bdf8" : "#94a3b8",
      border: `1px solid ${hasData ? "rgba(56, 189, 248, 0.28)" : "rgba(148, 163, 184, 0.22)"}`,
      fontSize: 10,
      fontWeight: 700,
      lineHeight: 1,
      whiteSpace: "nowrap",
    }}
  >
    <span style={{ opacity: 0.85 }}>{label}</span>
    <span style={{ fontSize: 9 }}>{value}</span>
  </span>
);

const SetupDataCell: React.FC<{ row: ExtendedStoreRecord }> = ({ row }) => {
  if (row.setup_data_error) {
    return (
      <span
        title={row.setup_data_error}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "3px 7px",
          borderRadius: 6,
          background: "rgba(239, 68, 68, 0.14)",
          color: "#f87171",
          border: "1px solid rgba(239, 68, 68, 0.30)",
          fontSize: 10,
          fontWeight: 700,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        <span>⚠</span>
        <span>Error</span>
      </span>
    );
  }

  if (!row.setup_data) {
    return (
      <span
        title="Setup data has not been fetched yet"
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "3px 8px",
          borderRadius: 6,
          background: "rgba(148, 163, 184, 0.10)",
          color: "#64748b",
          border: "1px solid rgba(148, 163, 184, 0.20)",
          fontSize: 10,
          fontWeight: 600,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        — Not Fetched
      </span>
    );
  }

  const oemCodes = row.setup_data.oemDealerCodes || [];
  const hasOem = oemCodes.length > 0;
  const firstCode = oemCodes[0] || "—";
  const oemDisplay =
    oemCodes.length > 1 ? `${firstCode} (+${oemCodes.length - 1})` : firstCode;
  const oemFull = hasOem ? oemCodes.join(", ") : "None";

  const journalsCount = row.setup_data.journalsAccessibleDealerCount ?? 0;
  const salesChainsCount = row.setup_data.salesChainsAccessibleDealerCount ?? 0;
  const coaCount = row.setup_data.coaAccessibleDealerCount ?? 0;

  return (
    <div style={{ display: "inline-flex", gap: 4, flexWrap: "nowrap", alignItems: "center" }}>
      <SetupDataChip
        label="OEM"
        value={oemDisplay}
        hasData={hasOem}
        title={`OEM Codes: ${oemFull}`}
      />
      <SetupDataChip
        label="JRN"
        value={journalsCount}
        hasData={journalsCount > 0}
        title={`Accessible Journals: ${journalsCount}`}
      />
      <SetupDataChip
        label="SC"
        value={salesChainsCount}
        hasData={salesChainsCount > 0}
        title={`Sales Chains: ${salesChainsCount}`}
      />
      <SetupDataChip
        label="COA"
        value={coaCount}
        hasData={coaCount > 0}
        title={`Chart of Accounts: ${coaCount}`}
      />
    </div>
  );
};

const CustomStatusSelect: React.FC<{
  value?: CustomPhaseStatus;
  onChange: (newVal: CustomPhaseStatus) => void;
}> = ({ value, onChange }) => {
  const currentVal = value || "TO DO";
  const colors = {
    "TO DO": {
      bg: "rgba(148, 163, 184, 0.14)",
      text: "#94a3b8",
      border: "rgba(148, 163, 184, 0.24)",
    },
    WIP: {
      bg: "rgba(245, 158, 11, 0.16)",
      text: "#f59e0b",
      border: "rgba(245, 158, 11, 0.30)",
    },
    Completed: {
      bg: "rgba(34, 197, 94, 0.16)",
      text: "#22c55e",
      border: "rgba(34, 197, 94, 0.30)",
    },
  } as const;

  const style = colors[currentVal];

  return (
    <div style={{ position: "relative", display: "inline-block", width: 110, minWidth: 110 }}>
      <select
        value={currentVal}
        onChange={(e) => onChange(e.target.value as CustomPhaseStatus)}
        style={{
          width: "100%",
          minWidth: 110,
          background: style.bg,
          color: style.text,
          border: `1px solid ${style.border}`,
          borderRadius: 8,
          padding: "5px 22px 5px 8px",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          appearance: "none",
        }}
      >
        <option value="TO DO">TO DO</option>
        <option value="WIP">WIP</option>
        <option value="Completed">Completed</option>
      </select>
      <span
        style={{
          position: "absolute",
          right: 8,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
          fontSize: 8,
          color: style.text,
        }}
      >
        ▼
      </span>
    </div>
  );
};

function withOnboardingStatuses(
  stores: ExtendedStoreRecord[],
  statusMap: Record<
    string,
    {
      blueprint_statuses: StoreBlueprintStatuses;
      signoff_statuses: StoreSignoffStatuses;
    }
  >
): ExtendedStoreRecord[] {
  const fetchedAt = new Date().toISOString();

  return stores.map((store) => {
    const statuses = statusMap[store.tekion_id];
    return {
      ...store,
      blueprint_statuses: statuses?.blueprint_statuses,
      signoff_statuses: statuses?.signoff_statuses,
      onboarding_status_fetched_at: fetchedAt,
    };
  });
}

const SlackRecipientRow: React.FC<{
  candidate: SlackRecipientCandidate;
  checked: boolean;
  onToggle: () => void;
}> = ({ candidate, checked, onToggle }) => {
  const isAvailable = Boolean(candidate.matchedUser?.userId);

  return (
    <label className="slack-recipient-row">
      <input
        type="checkbox"
        checked={checked}
        disabled={!isAvailable}
        onChange={onToggle}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div>
          <span>{candidate.label}</span>{" "}
          <span style={{ color: "#94a3b8" }}>
            ({candidate.matchedUser?.fullName || "Not found"})
          </span>
        </div>
        <div style={{ color: "#64748b", fontSize: 11 }}>
          {candidate.normalizedEmail || candidate.matchedUser?.userId || "No ID"}
        </div>
      </div>
    </label>
  );
};

const DealerMetaModal: React.FC<{
  row: ExtendedStoreRecord | null;
  onClose: () => void;
  onToast: (message: string) => void;
  onSetupFetched: (tekionId: string, setupData: StoreSetupData) => void;
  onTasksSnapshot?: (tekionId: string, tasks: any, complete: boolean) => void;
  onTaskOperationalStatusChange: (
    tekionId: string,
    field: "fixed_ops_status" | "variable_ops_status",
    value: CustomPhaseStatus
  ) => Promise<void> | void;
}> = ({ row, onClose, onToast, onSetupFetched, onTaskOperationalStatusChange, onTasksSnapshot }) => {
  const [tab, setTab] = useState<"tasks" | "slack">("tasks");
  const draftContext = useMemo(() => {
    return row ? buildStoreSlackDraftContext(row) : null;
  }, [row]);

  const slackSession = useMemo(() => getSlackSession(), [row]);
  const [selectedRecipientKeys, setSelectedRecipientKeys] = useState<string[]>([]);
  const [messageText, setMessageText] = useState("");
  const [sendingKey, setSendingKey] = useState("");
  const [isSendingAll, setIsSendingAll] = useState(false);
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [slackEmailMap, setSlackEmailMap] = useState<Map<string, SlackDirectoryUser>>(STATIC_SLACK_MAP);
  const [loadingSetup, setLoadingSetup] = useState(false);

  useEffect(() => {
    const merged = new Map(slackEmailMap);

    if (draftContext?.recipients) {
      for (const r of draftContext.recipients) {
        if (r.normalizedEmail && r.matchedUser) {
          merged.set(r.normalizedEmail.toLowerCase(), {
            userId: r.matchedUser.userId,
            fullName: r.matchedUser.fullName,
            email: r.matchedUser.email || r.normalizedEmail,
            jobTitle: r.matchedUser.jobTitle || "",
          });
        }
      }
    }

    setSlackEmailMap(merged);
  }, [draftContext]);

  const allRecipients = useMemo(() => {
    if (!draftContext) return [];
    const recipients = [...draftContext.recipients];

    const hasConversion = recipients.some(
      (r) =>
        r.key.toLowerCase().includes("conversion") ||
        r.label.toLowerCase().includes("conversion")
    );

    if (!hasConversion && row?.conversion_track_lead_1773369950325147526) {
      const raw = row.conversion_track_lead_1773369950325147526.trim();
      const email = raw.toLowerCase().replace(/^[<"]+|[>"]+$/g, "");
      const matched = slackEmailMap.get(email);

      recipients.push({
        key: "conversion_track_lead",
        label: "Conversion",
        rawValue: raw,
        normalizedEmail: email,
        matchedUser: matched
          ? {
              userId: matched.userId,
              fullName: matched.fullName,
              email: matched.email,
              jobTitle: matched.jobTitle || "",
            }
          : undefined,
      });
    }

    return recipients;
  }, [draftContext, row, slackEmailMap]);

  useEffect(() => {
    if (!draftContext) {
      setSelectedRecipientKeys([]);
      setMessageText("");
      return;
    }

    setSelectedRecipientKeys(draftContext.defaultSelectedRecipientKeys);
    setMessageText(draftContext.draftMessage);
    setSendingKey("");
    setEditorMode("edit");
  }, [draftContext]);

  if (!row || !draftContext) return null;

  const selectedRecipients = allRecipients.filter(
    (recipient) =>
      selectedRecipientKeys.includes(recipient.key) && recipient.matchedUser?.userId
  );

  const handleToggleRecipient = (key: string) => {
    setSelectedRecipientKeys((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  };

  const handleSendSingle = async (recipient: SlackRecipientCandidate) => {
    if (!recipient.matchedUser?.userId) return;

    setSendingKey(recipient.key);

    try {
      await sendSlackMessage({
        userId: recipient.matchedUser.userId,
        email: recipient.matchedUser.email,
        fullName: recipient.matchedUser.fullName,
        text: messageText,
      });

      onToast(`✅ Sent to ${recipient.matchedUser.fullName}`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to send";
      onToast(`❌ ${message}`);
    } finally {
      setSendingKey("");
    }
  };

  const handleSendAll = async () => {
    if (selectedRecipients.length === 0) return;

    setIsSendingAll(true);
    let successCount = 0;
    let failCount = 0;

    for (const recipient of selectedRecipients) {
      if (!recipient.matchedUser?.userId) continue;

      try {
        await sendSlackMessage({
          userId: recipient.matchedUser.userId,
          email: recipient.matchedUser.email,
          fullName: recipient.matchedUser.fullName,
          text: messageText,
        });
        successCount++;
      } catch {
        failCount++;
      }
    }

    setIsSendingAll(false);
    if (failCount === 0) {
      onToast(`✅ Successfully dispatched message to ${successCount} recipient(s)`);
    } else {
      onToast(`⚠ Sent ${successCount}, failed ${failCount}`);
    }
  };

  const handleFetchSetup = async () => {
    if (!row) return;

    setLoadingSetup(true);
    try {
      const setupData = await fetchSetupDataForStore(row, { force: true });
      onSetupFetched(row.tekion_id, setupData);
      onToast("✅ Setup data fetched");
    } catch (error: unknown) {
      onToast(`❌ ${error instanceof Error ? error.message : "Failed to fetch setup data"}`);
    } finally {
      setLoadingSetup(false);
    }
  };

  const hasSlackSession = Boolean(slackSession.slackToken && slackSession.slackDCookie);

  // Guarantee resolved project ID using fallback logic
  const resolvedProjectId = resolveStoreProjectId(row);

  const trackingId =
    row.project_implementation_tm_sync_status_tracking_id ||
    row.implementation_tm_sync_status_tracking_id ||
    row.base_entity_instance_id ||
    resolvedProjectId;

  const token = `${row.tenant_code || ""}_${row.tenant_id || ""}_${row.dealer_id || ""}`;
  const preprodSchedulingUrl = `https://preprod-conscheduling.tekioncloud.com/consumer-scheduling/sign-in/phone?accessToken=${encodeURIComponent(token)}`;
  const prodSchedulingUrl = `https://conscheduling.tekioncloud.com/consumer-scheduling/sign-in/phone?accessToken=${encodeURIComponent(token)}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="update-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="update-modal-header">
          <div className="update-header-meta">
            <span className="update-header-title">{row.dba_name || "Dealership"}</span>
            <div className="update-header-badges">
              <span className="hud-badge accent">Dealer #{row.dealer_id}</span>
              <span className="hud-badge">Tekion ID: {row.tekion_id}</span>
            </div>
          </div>
          <button className="btn-secondary btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="update-store-hud">
          <div className="hud-telemetry-group">
            <div className="hud-telemetry-item">
              <span className="hud-label">Project:</span>
              <span
                className="hud-value"
                title={`Resolved project: ${resolvedProjectId || "None"}`}
              >
                {resolvedProjectId || "—"}
              </span>
            </div>
            <div className="hud-telemetry-item">
              <span className="hud-label">Tracking:</span>
              {trackingId ? (
                <a
                  className="tracking-link-tag"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://tap.tekioncloud.com/workorders/details/${encodeURIComponent(
                    trackingId
                  )}?tab=tasks`}
                >
                  Tasks ↗
                </a>
              ) : (
                <span className="hud-value">—</span>
              )}
            </div>
            <div className="hud-telemetry-item">
              <span className="hud-label">Tenant:</span>
              <span className="hud-value">
                {row.tenant_code || "—"} ({row.tenant_id || "—"})
              </span>
            </div>
            <div className="hud-telemetry-item">
              <span className="hud-label">Consumer:</span>
              <a
                href={preprodSchedulingUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#38bdf8", textDecoration: "none", fontSize: 11 }}
              >
                Pre-Prod ↗
              </a>
              <span style={{ color: "#475569" }}>•</span>
              <a
                href={prodSchedulingUrl}
                target="_blank"
                rel="noreferrer"
                style={{ color: "#4ade80", textDecoration: "none", fontSize: 11 }}
              >
                Prod ↗
              </a>
            </div>
          </div>

          <div className="hud-setup-strip">
            <button
              className="btn-postman btn-sm"
              disabled={loadingSetup}
              onClick={() => void handleFetchSetup()}
              style={{ fontWeight: 700 }}
            >
              {loadingSetup ? "⏳ Loading..." : "🧩 Get Setup Data"}
            </button>

            {row.setup_data ? (
              <span className="dealer-setup-summary">
                OEM: <strong>{row.setup_data.oemDealerCodes?.join(", ") || "—"}</strong> JRN:{" "}
                <strong>{row.setup_data.journalsAccessibleDealerCount ?? 0}</strong> SC:{" "}
                <strong>{row.setup_data.salesChainsAccessibleDealerCount ?? 0}</strong> COA:{" "}
                <strong>{row.setup_data.coaAccessibleDealerCount ?? 0}</strong>
              </span>
            ) : row.setup_data_error ? (
              <span style={{ fontSize: 11, color: "#f87171", fontWeight: 600 }}>
                ⚠ {row.setup_data_error}
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "#64748b" }}>
                Setup data not fetched yet
              </span>
            )}
          </div>
        </div>

        <div className="update-nav-segmented">
          <button
            type="button"
            className={`update-nav-tab ${tab === "tasks" ? "active" : ""}`}
            onClick={() => setTab("tasks")}
          >
            <span className="update-tab-dot" />
            ✅ TAP Tasks
          </button>
          <button
            type="button"
            className={`update-nav-tab ${tab === "slack" ? "active" : ""}`}
            onClick={() => setTab("slack")}
          >
            <span className="update-tab-dot" />
            💬 Slack Update
          </button>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {tab === "tasks" && (
            <DealerTasksPanel
              row={row}
              onToast={onToast}
              onOperationalStatusChange={onTaskOperationalStatusChange}
              onTasksSnapshot={onTasksSnapshot}
            />
          )}

          {tab === "slack" && (
            <div
              className="slack-workspace-layout"
              style={{ padding: "16px 20px 20px 20px" }}
            >
              <div className="slack-recipients-card">
                <div className="slack-card-header">
                  <span className="slack-card-title">
                    Recipients ({selectedRecipients.length})
                  </span>
                  <span
                    className={`slack-session-badge ${
                      hasSlackSession ? "slack-session-active" : "slack-session-inactive"
                    }`}
                  >
                    {hasSlackSession ? "Session Active" : "No Session"}
                  </span>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  {allRecipients.map((recipient) => (
                    <SlackRecipientRow
                      key={recipient.key}
                      candidate={recipient}
                      checked={selectedRecipientKeys.includes(recipient.key)}
                      onToggle={() => handleToggleRecipient(recipient.key)}
                    />
                  ))}
                </div>

                <div className="slack-dispatches-wrap">
                  Individual Dispatches:
                  <div>
                    {selectedRecipients.map((rec) => (
                      <div key={rec.key} className="slack-dispatch-item">
                        <span>{rec.matchedUser?.fullName}</span>
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          disabled={!hasSlackSession || sendingKey === rec.key || isSendingAll}
                          onClick={() => void handleSendSingle(rec)}
                        >
                          {sendingKey === rec.key ? "..." : "Send"}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="slack-draft-card">
                <div className="slack-card-header">
                  <span className="slack-card-title">Slack Message Draft</span>

                  <div className="slack-toggle-group">
                    <button type="button" onClick={() => setEditorMode("edit")}>
                      Edit
                    </button>
                    <button type="button" onClick={() => setEditorMode("preview")}>
                      Preview
                    </button>
                  </div>
                </div>

                {editorMode === "edit" ? (
                  <textarea
                    className="composer-textarea"
                    style={{ minHeight: 220 }}
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                  />
                ) : (
                  <div className="slack-editor-preview">
                    {messageText || "Empty draft."}
                  </div>
                )}

                <div className="slack-submit-wrap">
                  <button
                    type="button"
                    className="btn-postman"
                    disabled={!hasSlackSession || selectedRecipients.length === 0 || isSendingAll}
                    onClick={() => void handleSendAll()}
                  >
                    {isSendingAll
                      ? "⏳ Dispatched..."
                      : `Send to Selected (${selectedRecipients.length})`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const Stores: React.FC<Props> = ({ onBack }) => {
  const [records, setRecords] = useState<ExtendedStoreRecord[]>([]);
  const [loadingStores, setLoadingStores] = useState(false);
  const [syncingExcel, setSyncingExcel] = useState(false);
  const [loadingSetupAll, setLoadingSetupAll] = useState(false);
  const [dispatching3Reports, setDispatching3Reports] = useState(false);
  const [syncingTapStatuses, setSyncingTapStatuses] = useState(false);
  const [tapSyncProgress, setTapSyncProgress] = useState("");

  const [error, setError] = useState("");
  const [tokenExpiredMessage, setTokenExpiredMessage] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [trackingTick, setTrackingTick] = useState(0);

  const [range, setRange] = useState<TRange>(90);
  const [search, setSearch] = useState("");
  const [superpodId, setSuperpodId] = useState("");
  const [implementationType, setImplementationType] = useState("");
  const [productType, setProductType] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [fixedAssigneeFilter, setFixedAssigneeFilter] = useState<AssigneeName | "">("");
  const [variableAssigneeFilter, setVariableAssigneeFilter] = useState<AssigneeName | "">("");
  const [notWorkedFilter, setNotWorkedFilter] = useState<string>("");
  const [activeDealerPopup, setActiveDealerPopup] = useState<ExtendedStoreRecord | null>(null);

  // Synchronize modal store with latest data and guarantee resolved onboarding_project_id
  const currentModalRecord = useMemo(() => {
    if (!activeDealerPopup) return null;
    const latest = records.find((r) => r.tekion_id === activeDealerPopup.tekion_id) || activeDealerPopup;
    const resolvedProjectId = resolveStoreProjectId(latest);
    return {
      ...latest,
      onboarding_project_id: resolvedProjectId || latest.onboarding_project_id,
    };
  }, [activeDealerPopup, records]);

  const presetRange = useMemo(() => getTDaysRange(range), [range]);
  const [fromDate, setFromDate] = useState(toInputDate(presetRange.fromDate));
  const [toDate, setToDate] = useState(toInputDate(presetRange.toDate));

  useEffect(() => {
    setFromDate(toInputDate(presetRange.fromDate));
    setToDate(toInputDate(presetRange.toDate));
  }, [range, presetRange.fromDate, presetRange.toDate]);

  const tapWorkordersUrl = useMemo(
    () => buildTapWorkordersUrl(fromDate, toDate),
    [fromDate, toDate]
  );

  const [botState, setBotState] = useState<BotState>(() => storesBotRunner.getState());

  useEffect(() => {
    const unsubscribe = storesBotRunner.subscribe((state) => {
      setBotState(state);
    });
    return () => unsubscribe();
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => setToastMessage(""), 3500);
  }, []);

  const handleCopy = useCallback((text: string, keyIdentifier: string) => {
    void navigator.clipboard.writeText(text || "");
    setCopiedKey(keyIdentifier);
    window.setTimeout(() => setCopiedKey(null), 1200);
  }, []);

  const loadStatusesForStores = useCallback(async (stores: ExtendedStoreRecord[]) => {
    const tekionIds = stores.map((item) => item.tekion_id).filter(Boolean);

    if (tekionIds.length === 0) {
      return;
    }

    try {
      const statusMap = await fetchStoreOnboardingStatuses(tekionIds, {
        chunkSize: 25,
        concurrency: 3,
      });

      setRecords((prevRecords) => {
        const baseStores = prevRecords.length > 0 ? prevRecords : stores;
        const merged = withOnboardingStatuses(baseStores, statusMap);
        void saveStores(merged);
        return merged;
      });
    } catch (err: unknown) {
      logger.error("Failed to fetch onboarding statuses", err);
    }
  }, []);

  const handleFetch = useCallback(
    async (forceStatusRefresh = true) => {
      setLoadingStores(true);
      setError("");
      setTokenExpiredMessage("");

      try {
        const rawStores = await fetchStores(range);

        const existingDbStores = await getStores();
        const existingMap = new Map(existingDbStores.map((s) => [s.tekion_id, s]));
        const vault = getStoredStatusVault();

        const fetchedStores: ExtendedStoreRecord[] = Array.from(
          new Map<string, ExtendedStoreRecord>(
            rawStores.map((store) => {
              const existing = existingMap.get(store.tekion_id) as ExtendedStoreRecord | undefined;
              const override = vault[store.tekion_id];
              const base = mergeIncomingStore(existing, store);

              return [
                store.tekion_id,
                {
                  ...base,
                  onboarding_project_id: store.onboarding_project_id || existing?.onboarding_project_id,
                  ds_onboarding_project_id: store.ds_onboarding_project_id || existing?.ds_onboarding_project_id,
                  fixed_ops_status:
                    override?.fixed_ops_status ||
                    existing?.fixed_ops_status ||
                    existing?.configuration_status ||
                    "TO DO",
                  variable_ops_status:
                    override?.variable_ops_status ||
                    existing?.variable_ops_status ||
                    existing?.configuration_status ||
                    "TO DO",
                  testing_status:
                    override?.testing_status ||
                    existing?.testing_status ||
                    existing?.configuration_status ||
                    "TO DO",
                  not_worked:
                    override?.not_worked ||
                    existing?.not_worked ||
                    store.not_worked,
                  custom_assignee:
                    override?.custom_assignee ||
                    existing?.custom_assignee ||
                    (store as any).custom_assignee,
                  custom_variable_assignee:
                    override?.custom_variable_assignee ||
                    existing?.custom_variable_assignee ||
                    (store as any).custom_variable_assignee,
                },
              ];
            })
          ).values()
        );

        const fetchedIds = new Set(fetchedStores.map((s) => s.tekion_id));
        const uniqueStores: ExtendedStoreRecord[] = [
          ...fetchedStores,
          ...(existingDbStores as ExtendedStoreRecord[]).filter((s) => !fetchedIds.has(s.tekion_id)),
        ];

        setRecords(uniqueStores);
        await saveStores(uniqueStores);
        showToast(`✅ Refreshed ${fetchedStores.length} stores (${uniqueStores.length} total kept)`);

        void (async () => {
          try {
            const { updatedStores, hasChanges } = await pullStatusUpdatesFromGraph(uniqueStores);
            const storesForProd = hasChanges ? updatedStores : uniqueStores;

            if (hasChanges) {
              setRecords((prev) => {
                const safelyMerged = safelyMergeStatusFields(prev, updatedStores);

                void saveStores(safelyMerged);
                bulkUpdateStatusVault(
                  safelyMerged.map((s) => ({
                    tekionId: s.tekion_id,
                    fixed_ops_status: s.fixed_ops_status,
                    variable_ops_status: s.variable_ops_status,
                    testing_status: s.testing_status,
                    custom_assignee: s.custom_assignee,
                    custom_variable_assignee: s.custom_variable_assignee,
                    not_worked: s.not_worked,
                  }))
                );
                return safelyMerged;
              });
              setTrackingTick((prev) => prev + 1);
            }

            void syncProdDealersToGraph(storesForProd);
          } catch (e) {
            logger.debug("Background Excel check skipped on fetch:", e);
          }
        })();

        if (forceStatusRefresh) {
          void loadStatusesForStores(uniqueStores);
        }
      } catch (err: unknown) {
        logger.error("handleFetch failed", err);

        if (err instanceof ExpiredCaptureTokenError) {
          setTokenExpiredMessage(err.message);
          setError("");
        } else {
          setError(err instanceof Error ? err.message : "Failed to fetch stores");
        }
      } finally {
        setLoadingStores(false);
      }
    },
    [range, loadStatusesForStores, showToast]
  );

  const handleLoadIndexedDb = useCallback(async () => {
    try {
      const rawData = await getStores();
      const vault = getStoredStatusVault();

      const uniqueData: ExtendedStoreRecord[] = Array.from(
        new Map<string, ExtendedStoreRecord>(
          rawData.map((store) => {
            const override = vault[store.tekion_id];
            return [
              store.tekion_id,
              {
                ...store,
                fixed_ops_status:
                  override?.fixed_ops_status ||
                  store.fixed_ops_status ||
                  store.configuration_status ||
                  "TO DO",
                variable_ops_status:
                  override?.variable_ops_status ||
                  store.variable_ops_status ||
                  store.configuration_status ||
                  "TO DO",
                testing_status:
                  override?.testing_status ||
                  store.testing_status ||
                  store.configuration_status ||
                  "TO DO",
                not_worked:
                  override?.not_worked ||
                  store.not_worked,
                custom_assignee:
                  override?.custom_assignee ||
                  store.custom_assignee,
                custom_variable_assignee:
                  override?.custom_variable_assignee ||
                  store.custom_variable_assignee,
              },
            ];
          })
        ).values()
      );

      setRecords(uniqueData);

      if (uniqueData.length > 0) {
        void (async () => {
          try {
            const { updatedStores, hasChanges } = await pullStatusUpdatesFromGraph(uniqueData);
            const storesForProd = hasChanges ? updatedStores : uniqueData;

            if (hasChanges) {
              setRecords((prev) => {
                const safelyMerged = safelyMergeStatusFields(prev, updatedStores);

                void saveStores(safelyMerged);
                bulkUpdateStatusVault(
                  safelyMerged.map((s) => ({
                    tekionId: s.tekion_id,
                    fixed_ops_status: s.fixed_ops_status,
                    variable_ops_status: s.variable_ops_status,
                    testing_status: s.testing_status,
                    custom_assignee: s.custom_assignee,
                    custom_variable_assignee: s.custom_variable_assignee,
                    not_worked: s.not_worked,
                  }))
                );
                return safelyMerged;
              });

              setTrackingTick((prev) => prev + 1);
              showToast("⚡ Refreshed & updated cache from Excel");
            }

            void syncProdDealersToGraph(storesForProd);
          } catch (e) {
            logger.debug("Initial Excel cache pull skipped:", e);
          }
        })();
      }

      if (shouldAutoFetchStatuses(uniqueData) && uniqueData.length > 0) {
        void loadStatusesForStores(uniqueData);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load IndexedDB data");
    }
  }, [loadStatusesForStores, showToast]);

  useEffect(() => {
    void handleLoadIndexedDb();
  }, [handleLoadIndexedDb]);

  const updateCustomStatus = async (
    tekion_id: string,
    field: "fixed_ops_status" | "variable_ops_status" | "testing_status",
    value: CustomPhaseStatus
  ) => {
    const currentRecord = records.find((r) => r.tekion_id === tekion_id);
    const currentStatus = currentRecord ? currentRecord[field] : "TO DO";

    if (!isUserAdmin() && currentStatus === "Completed" && value !== "Completed") {
      showToast("🔒 Only tlreddy@tekion.com has permission to revert Completed tasks.");
      return;
    }

    setRecords((prev) => {
      const updatedRecords = prev.map((r) =>
        r.tekion_id === tekion_id ? { ...r, [field]: value } : r
      );
      void saveStores(updatedRecords).catch((err) => logger.error("Failed to save DB", err));
      return updatedRecords;
    });

    saveStatusToVault(tekion_id, field, value);
    recordStatusTransition(tekion_id, field, value);
    setTrackingTick((prev) => prev + 1);

    void (async () => {
      const success = await patchSingleStoreStatusInGraph(tekion_id, field, value);
      if (success) {
        showToast(`✅ Synced ${value} to Excel`);
      } else {
        showToast(`⚠ Updated locally (Excel sync pending)`);
      }
    })();
  };

  const updateStoreNotWorked = useCallback(
    async (tekion_id: string, value: string) => {
      setRecords((prev) => {
        const updated = prev.map((r) =>
          r.tekion_id === tekion_id ? { ...r, not_worked: value } : r
        );
        void saveStores(updated).catch((err) => logger.error("Failed saving not_worked", err));
        return updated;
      });

      saveNotWorkedToVault(tekion_id, value);
      bulkUpdateStatusVault([{ tekionId: tekion_id, not_worked: value }]);
      showToast(`✅ Updated 'Not Worked?' to ${value || "Handled by ARC"}`);

      void (async () => {
        const success = await patchSingleStoreNotWorkedInGraph(tekion_id, value);
        if (success) {
          showToast(`✅ Synced 'Not Worked?' to Excel`);
        }
      })();
    },
    [showToast]
  );

  const updateStoreFixedAssignee = useCallback(
    async (tekion_id: string, newAssignee: AssigneeName | "") => {
      const target = records.find((r) => r.tekion_id === tekion_id);
      if (target) recordManualAssignment(target, newAssignee);
      setRecords((prev) => {
        const updated = prev.map((r) =>
          r.tekion_id === tekion_id ? { ...r, custom_assignee: newAssignee } : r
        );
        void saveStores(updated).catch((err) => logger.error("Failed saving assignee", err));
        return updated;
      });

      bulkUpdateStatusVault([{ tekionId: tekion_id, custom_assignee: newAssignee }]);
      showToast(`✅ Updated Fixed Ops Assignee to ${newAssignee || "Unassigned"}`);

      void (async () => {
        const success = await patchSingleStoreAssigneeInGraph(tekion_id, newAssignee);
        if (success) {
          showToast(`✅ Synced Fixed Ops Assignee to Excel`);
        }
      })();
    },
    [showToast, records]
  );

  const updateStoreVariableAssignee = useCallback(
    async (tekion_id: string, newAssignee: AssigneeName | "") => {
      setRecords((prev) => {
        const updated = prev.map((r) =>
          r.tekion_id === tekion_id ? { ...r, custom_variable_assignee: newAssignee } : r
        );
        void saveStores(updated).catch((err) => logger.error("Failed saving variable assignee", err));
        return updated;
      });

      bulkUpdateStatusVault([{ tekionId: tekion_id, custom_variable_assignee: newAssignee }]);
      showToast(`✅ Updated Variable Ops Assignee to ${newAssignee || "Unassigned"}`);

      void (async () => {
        const success = await patchSingleStoreVariableAssigneeInGraph(tekion_id, newAssignee);
        if (success) {
          showToast(`✅ Synced Variable Ops Assignee to Excel`);
        }
      })();
    },
    [showToast]
  );

  const handleTasksSnapshot = useCallback(
    (tekionId: string, tasks: any, complete: boolean) => {
      const sum = (list: any[]) =>
        (list || []).reduce((acc, t) => acc + Number(t.taskAttachmentCount ?? t.attachments?.length ?? 0), 0);
      const fixedNow = sum(tasks.parts) + sum(tasks.service);
      const varNow = sum(tasks.accounting);

      setRecords((prev) => {
        let changed: ExtendedStoreRecord | null = null;
        const next = prev.map((r) => {
          if (r.tekion_id !== tekionId) return r;
          const fixed = complete ? fixedNow : Math.max(r.fixed_ops_attachments ?? 0, fixedNow);
          const variable = complete ? varNow : Math.max(r.variable_ops_attachments ?? 0, varNow);
          if (
            fixed === r.fixed_ops_attachments &&
            variable === r.variable_ops_attachments &&
            r.attachments_incomplete === !complete
          ) {
            return r;
          }
          changed = {
            ...r,
            fixed_ops_attachments: fixed,
            variable_ops_attachments: variable,
            attachments_incomplete: !complete,
            fetched_blueprint_tasks: {
              partsTasks: tasks.parts,
              serviceTasks: tasks.service,
              accountingTasks: tasks.accounting,
              fetchedAt: new Date().toISOString(),
            },
          };
          return changed;
        });
        if (changed) void saveStores([changed]);
        return changed ? next : prev;
      });
    },
    []
  );

  useEffect(() => {
    if (records.length === 0) return;
    void runSlackAlerts(records).then((n) => {
      if (n > 0) showToast(`🔔 Sent ${n} alert(s) to Slack`);
    });
    void maybeSendDailyDigest(records);
  }, [records, showToast]);

  useEffect(() => {
    if (records.length === 0) return;
    reconcileAssignments(records);

    const config = loadAssigneeConfig();
    if (!config.autoAssignEnabled) return;

    const { updated, events } = runAutoAssign(records, config);
    if (!updated.length) return;

    const byId = new Map(updated.map((u) => [u.tekion_id, u as ExtendedStoreRecord]));
    setRecords((prev) => {
      const next = prev.map((r) => {
        const u = byId.get(r.tekion_id);
        return u && !r.custom_assignee ? { ...r, custom_assignee: u.custom_assignee } : r;
      });
      void saveStores(next);
      return next;
    });
    showToast(`🤖 Auto-assigned ${events.length} store(s)`);

    void (async () => {
      for (const u of updated) {
        try {
          await patchSingleStoreAssigneeInGraph(u.tekion_id, String((u as ExtendedStoreRecord).custom_assignee));
        } catch {
          /* Excel catches up on next sync */
        }
      }
    })();
  }, [records, showToast]);

  useEffect(() => {
    let isCancelled = false;

    const checkForExcelUpdates = async () => {
      const currentRecords = records;
      if (currentRecords.length === 0 || syncingExcel) return;

      const { updatedStores, hasChanges } = await pullStatusUpdatesFromGraph(currentRecords);
      const activeList = updatedStores.length > 0 ? updatedStores : currentRecords;

      if (!isCancelled && hasChanges) {
        setRecords((prev) => {
          const merged = safelyMergeStatusFields(prev, updatedStores);
          void saveStores(merged);

          bulkUpdateStatusVault(
            merged.map((s) => ({
              tekionId: s.tekion_id,
              fixed_ops_status: s.fixed_ops_status,
              variable_ops_status: s.variable_ops_status,
              testing_status: s.testing_status,
              custom_assignee: s.custom_assignee,
              custom_variable_assignee: s.custom_variable_assignee,
              not_worked: s.not_worked,
            }))
          );
          return merged;
        });

        setTrackingTick((prev) => prev + 1);
        showToast("⚡ Auto-synced updates from Excel");
      }

      void syncProdDealersToGraph(activeList);
    };

    const interval = setInterval(() => {
      void checkForExcelUpdates();
    }, 12000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkForExcelUpdates();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isCancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [records, syncingExcel, showToast]);

  const superpodOptions = useMemo(
    () => Array.from(new Set(records.map((r) => r.superpod_id).filter(Boolean))).sort(),
    [records]
  );

  const implementationTypeOptions = useMemo(
    () =>
      Array.from(
        new Set(records.map((r) => cleanImpType(r.implementation_type)).filter(Boolean))
      ).sort(),
    [records]
  );

  const productTypeOptions = useMemo(() => ["ARC", "CRM", "Analytics"], []);

  const monthOptions = useMemo(() => {
    const map = new Map<string, number>();

    records.forEach((r) => {
      const label = getMonthYearString(r.launch_date);
      if (label) {
        map.set(label, getMonthYearSortKey(r.launch_date));
      }
    });

    return Array.from(map.entries())
      .sort((a, b) => a[1] - b[1])
      .map((entry) => entry[0]);
  }, [records]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromUnix = startOfDayUnix(fromDate);
    const toUnix = endOfDayUnix(toDate);

    return records
      .filter((item) => {
        const fixedAssignee = getStoreFixedAssignee(item);
        const variableAssignee = getStoreVariableAssignee(item);

        const matchesSearch =
          !q ||
          item.tekion_id.toLowerCase().includes(q) ||
          item.dealer_id.toLowerCase().includes(q) ||
          item.dba_name.toLowerCase().includes(q) ||
          fixedAssignee.toLowerCase().includes(q) ||
          variableAssignee.toLowerCase().includes(q) ||
          (item.not_worked && item.not_worked.toLowerCase().includes(q)) ||
          (item.tenant_code && item.tenant_code.toLowerCase().includes(q)) ||
          (item.tenant_id && item.tenant_id.toLowerCase().includes(q));

        const matchesSuperpod = !superpodId || item.superpod_id === superpodId;
        const normalizedImp = cleanImpType(item.implementation_type);
        const matchesImplementationType =
          !implementationType || normalizedImp === implementationType;
        const matchesProductType =
          !productType ||
          (item.product_types || "").toLowerCase().includes(productType.toLowerCase());
        const matchesMonth =
          !selectedMonth || getMonthYearString(item.launch_date) === selectedMonth;

        const matchesFixedAssignee = !fixedAssigneeFilter || fixedAssignee === fixedAssigneeFilter;
        const matchesVarAssignee = !variableAssigneeFilter || variableAssignee === variableAssigneeFilter;

        const matchesNotWorked =
          !notWorkedFilter
            ? true
            : notWorkedFilter === "HANDLED_BY_ARC"
            ? !item.not_worked || item.not_worked.trim() === ""
            : item.not_worked === notWorkedFilter;

        const launch = parseLaunchDate(item.launch_date);
        const launchUnix = launch ? Math.floor(launch.getTime() / 1000) : null;
        const matchesDate =
          launchUnix == null ? true : launchUnix >= fromUnix && launchUnix <= toUnix;

        return (
          matchesSearch &&
          matchesSuperpod &&
          matchesImplementationType &&
          matchesProductType &&
          matchesMonth &&
          matchesFixedAssignee &&
          matchesVarAssignee &&
          matchesNotWorked &&
          matchesDate
        );
      })
      .sort((a, b) => {
        const aDate = parseLaunchDate(a.launch_date);
        const bDate = parseLaunchDate(b.launch_date);

        const aTime = aDate ? aDate.getTime() : Number.MAX_SAFE_INTEGER;
        const bTime = bDate ? bDate.getTime() : Number.MAX_SAFE_INTEGER;

        return aTime - bTime;
      });
  }, [
    records,
    search,
    superpodId,
    implementationType,
    productType,
    selectedMonth,
    fixedAssigneeFilter,
    variableAssigneeFilter,
    notWorkedFilter,
    fromDate,
    toDate,
  ]);

  const persistSetupData = useCallback(async (tekionId: string, setupData: StoreSetupData) => {
    setRecords((prev) => {
      const updated = prev.map((row) =>
        row.tekion_id === tekionId
          ? {
              ...row,
              setup_data: setupData,
              setup_data_fetched_at: setupData.fetchedAt,
              setup_data_error: "",
            }
          : row
      );
      void saveStores(updated);
      return updated;
    });
  }, []);

  const handleFetchSetupVisible = useCallback(async () => {
    setLoadingSetupAll(true);
    let fetched = 0;
    let skipped = 0;
    let failed = 0;
    try {
      const latestMap = new Map(records.map((r) => [r.tekion_id, r]));

      const queue = filtered.filter((row) => {
        const current = latestMap.get(row.tekion_id) ?? row;
        const complete = isSetupDataComplete(current);
        if (complete) skipped++;
        return !complete;
      });

      for (let i = 0; i < queue.length; i++) {
        const current = latestMap.get(queue[i].tekion_id) ?? queue[i];
        setTapSyncProgress(`Setup ${i + 1}/${queue.length}`);
        try {
          const setupData = await fetchSetupDataForStore(current, { force: true });
          await persistSetupData(current.tekion_id, setupData);
          fetched++;
        } catch (error: unknown) {
          failed++;
          logger.error("Failed setup data fetch for row", {
            dealerId: current.dealer_id,
            tekionId: current.tekion_id,
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      showToast(
        `✅ Setup data: ${fetched} fetched, ${skipped} already complete (skipped)` +
          (failed ? `, ${failed} failed` : "")
      );
    } catch (error: unknown) {
      showToast(`❌ ${error instanceof Error ? error.message : "Failed setup fetch"}`);
    } finally {
      setTapSyncProgress("");
      setLoadingSetupAll(false);
    }
  }, [filtered, records, persistSetupData, showToast]);

  const handleSendAllThreeReportsManual = async () => {
    if (records.length === 0) {
      showToast("❌ No store records available to evaluate.");
      return;
    }

    if (!isSlackSessionActive()) {
      showToast("❌ Slack session inactive. Please connect Slack first.");
      return;
    }

    setDispatching3Reports(true);
    try {
      const result = await dispatchAllThreeReports(records, { force: true });
      if (result.sent) {
        showToast("✅ Sent Analytics, Fixed Ops & Variable Ops reports to Slack! (4-hr timer reset)");
      } else {
        showToast(`⚠ ${result.reason || "Failed to dispatch reports"}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to dispatch reports";
      logger.error("Failed to send 3 reports", err);
      showToast(`❌ ${msg}`);
    } finally {
      setDispatching3Reports(false);
    }
  };

  const handleSyncRealTapStatuses = async () => {
    if (records.length === 0) {
      showToast("❌ No store records available to evaluate.");
      return;
    }

    setSyncingTapStatuses(true);
    setTapSyncProgress("Starting TAP scan...");

    try {
      const { updatedStores, updatedCount } = await batchFetchRealTapStatuses(
        records,
        (processed, total, updated) => {
          setTapSyncProgress(`${processed}/${total} (Updated: ${updated})`);
        },
        (updatedStore) => {
          setRecords((prev) => {
            const merged = safelyMergeStatusFields(
              prev,
              prev.map((r) => (r.tekion_id === updatedStore.tekion_id ? updatedStore : r))
            );
            return merged;
          });
          void saveStores([updatedStore]);
        }
      );

      if (updatedCount > 0) {
        setRecords((prev) => {
          const merged = safelyMergeStatusFields(prev, updatedStores);
          void saveStores(merged);

          bulkUpdateStatusVault(
            merged.map((s) => ({
              tekionId: s.tekion_id,
              fixed_ops_status: s.fixed_ops_status,
              variable_ops_status: s.variable_ops_status,
              testing_status: s.testing_status,
              custom_assignee: s.custom_assignee,
              custom_variable_assignee: s.custom_variable_assignee,
              not_worked: s.not_worked,
            }))
          );
          return merged;
        });
        setTrackingTick((prev) => prev + 1);

        syncStoresToGraphWorkbook(updatedStores)
          .then(() => {
            logger.info("Successfully synced updated TAP statuses to Excel");
          })
          .catch((err) => {
            logger.warn("Excel sync skipped or Graph token expired:", err);
          });

        showToast(`✅ Synced real TAP statuses & attachments for ${updatedCount} store(s)!`);
      } else {
        showToast("ℹ Checked TAP tasks: No changes found.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "TAP batch sync failed";
      showToast(`❌ ${msg}`);
    } finally {
      setSyncingTapStatuses(false);
      setTapSyncProgress("");
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stores-t${range}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported JSON (${filtered.length} stores)`);
  };

  const handleExportExcel = () => {
    try {
      exportStoresToExcel(filtered, `stores-t${range}`);
      showToast(`✅ Excel exported (${filtered.length} rows)`);
    } catch (err: unknown) {
      showToast(`❌ ${err instanceof Error ? err.message : "Excel export failed"}`);
    }
  };

  const handleSyncExcel = async () => {
    if (records.length === 0) {
      showToast("❌ No records available to sync");
      return;
    }

    setSyncingExcel(true);

    try {
      const result = await syncStoresToGraphWorkbook(records);

      if (result.updatedStores && result.updatedStores.length > 0) {
        setRecords((prev) => {
          const merged = safelyMergeStatusFields(prev, result.updatedStores!);
          void saveStores(merged);

          bulkUpdateStatusVault(
            merged.map((s) => ({
              tekionId: s.tekion_id,
              fixed_ops_status: s.fixed_ops_status,
              variable_ops_status: s.variable_ops_status,
              testing_status: s.testing_status,
              custom_assignee: s.custom_assignee,
              custom_variable_assignee: s.custom_variable_assignee,
              not_worked: s.not_worked,
            }))
          );
          return merged;
        });

        setTrackingTick((prev) => prev + 1);
      }

      showToast(
        `✅ Synced & merged ${result.rowCount} stores (${result.sheetCount} sheets)`
      );
    } catch (err: unknown) {
      showToast(`❌ ${err instanceof Error ? err.message : "Graph sync failed"}`);
    } finally {
      setSyncingExcel(false);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setSuperpodId("");
    setImplementationType("");
    setProductType("");
    setSelectedMonth("");
    setFixedAssigneeFilter("");
    setVariableAssigneeFilter("");
    setNotWorkedFilter("");
    setFromDate(toInputDate(presetRange.fromDate));
    setToDate(toInputDate(presetRange.toDate));
  };

  return (
    <div className="stores-shell">
      <div className="stores-topbar">
        <div className="stores-topbar-left">
          <button className="btn-secondary btn-sm" onClick={onBack}>
            ← Back
          </button>
          <div>
            <div className="stores-page-title">🏬 Store Onboarding Tracker</div>
            <div className="stores-page-subtitle">
              Manage blueprints, operational sign-offs, and go-live readiness
            </div>
          </div>
        </div>

        <div className="stores-topbar-right">
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginRight: 8 }}>
            <button
              type="button"
              className={`btn-sm ${botState.enabled ? "btn-postman" : "btn-secondary"}`}
              onClick={() => storesBotRunner.setEnabled(!botState.enabled)}
              style={{ fontWeight: 700 }}
              title={botState.enabled ? "Click to Pause Autonomous Bot" : "Click to Enable Autonomous Bot"}
            >
              {botState.enabled ? "🤖 Bot: ON" : "⏸ Bot: OFF"}
            </button>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: botState.error ? "#f87171" : botState.enabled ? "#4ade80" : "#94a3b8",
                maxWidth: 240,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {botState.statusText}
            </span>
          </div>

          <button className="btn-secondary btn-sm" onClick={() => void handleLoadIndexedDb()}>
            Cache
          </button>

          <div className="stores-export-group">
            <button className="btn-secondary btn-sm" onClick={handleExportExcel}>
              Export Excel
            </button>
            <button className="btn-secondary btn-sm" onClick={exportJson}>
              JSON
            </button>
          </div>

          <button
            className="btn-secondary btn-sm"
            onClick={() => void handleSyncExcel()}
            disabled={syncingExcel || Boolean(tokenExpiredMessage)}
          >
            {syncingExcel ? "⏳ Syncing..." : "☁ Sync Excel"}
          </button>

          <button
            className="btn-secondary btn-sm"
            onClick={() => void handleFetchSetupVisible()}
            disabled={loadingSetupAll}
          >
            {loadingSetupAll ? "⏳ Setup..." : "🧩 Fetch Setup Data"}
          </button>

          <button
            className="btn-secondary btn-sm"
            onClick={() => void handleSendAllThreeReportsManual()}
            disabled={dispatching3Reports || records.length === 0}
            style={{
              borderColor: "rgba(168, 85, 247, 0.4)",
              color: "#c084fc",
              fontWeight: 700,
            }}
            title="Manually dispatch Analytics, Fixed Ops & Variable Ops reports to Slack and reset 4-hour countdown"
          >
            {dispatching3Reports ? "⏳ Sending 3 Reports..." : "📢 Send 3 Reports (4h Window)"}
          </button>

          <button
            className="btn-secondary btn-sm"
            onClick={() => void handleSyncRealTapStatuses()}
            disabled={syncingTapStatuses || Boolean(tokenExpiredMessage) || records.length === 0}
            style={{
              borderColor: "rgba(56, 189, 248, 0.4)",
              color: "#38bdf8",
              fontWeight: 700,
            }}
            title="Fetch real blueprint tasks and attachment counts from TAP and update stores"
          >
            {syncingTapStatuses ? `⏳ ${tapSyncProgress || "Syncing TAP..."}` : "⚡ Sync TAP Statuses"}
          </button>

          <button
            className="btn-postman stores-refresh-btn"
            onClick={() => void handleFetch(true)}
            disabled={loadingStores}
          >
            {loadingStores ? "⏳ Fetching..." : "🔄 Refresh"}
          </button>
        </div>
      </div>

      {toastMessage && <div className="stores-toast">{toastMessage}</div>}

      {tokenExpiredMessage && (
        <div className="bx-error stores-token-expired-alert">
          <span>⚠ {tokenExpiredMessage}</span>
          <a href={tapWorkordersUrl} target="_blank" rel="noreferrer">
            Open TAP to recapture API ↗
          </a>
        </div>
      )}

      <div className={`stores-layout ${filtersCollapsed ? "filters-collapsed" : ""}`}>
        {!filtersCollapsed && (
          <aside className="stores-sidebar">
            <div className="stores-panel">
              <div className="stores-panel-header">
                <span className="stores-panel-title">Filters</span>
                <button type="button" onClick={clearFilters}>
                  Reset all
                </button>
              </div>

              <div className="stores-field">
                <label className="stores-label">Search</label>
                <input
                  className="stores-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ID, Dealer, Name, or Assignee..."
                />
              </div>

              <div className="stores-field">
                <label className="stores-label">T-Range Presets</label>
                <div className="stores-preset-grid">
                  {[7, 30, 60, 90, 150].map((days) => (
                    <button
                      key={days}
                      type="button"
                      className={range === days ? "btn-postman" : "btn-secondary btn-sm"}
                      onClick={() => setRange(days as TRange)}
                    >
                      T-{days}
                    </button>
                  ))}
                </div>
              </div>

              <div className="stores-field">
                <label className="stores-label">Launch Window</label>
                <div className="stores-date-grid">
                  <input
                    type="date"
                    className="stores-input"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                  />
                  <input
                    type="date"
                    className="stores-input"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="stores-field">
                <label className="stores-label">Go-Live Month</label>
                <select
                  className="stores-input"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                >
                  <option value="">All Months</option>
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stores-field">
                <label className="stores-label">Ownership / Not Worked</label>
                <select
                  className="stores-input"
                  value={notWorkedFilter}
                  onChange={(e) => setNotWorkedFilter(e.target.value)}
                >
                  <option value="">All Stores</option>
                  <option value="HANDLED_BY_ARC">Handled by ARC Only</option>
                  {NOT_WORKED_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stores-field">
                <label className="stores-label">Fixed Ops Assignee</label>
                <select
                  className="stores-input"
                  value={fixedAssigneeFilter}
                  onChange={(e) => setFixedAssigneeFilter(e.target.value as AssigneeName | "")}
                >
                  <option value="">All Assignees</option>
                  {ASSIGNEE_OPTIONS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stores-field">
                <label className="stores-label">Variable Ops Assignee</label>
                <select
                  className="stores-input"
                  value={variableAssigneeFilter}
                  onChange={(e) => setVariableAssigneeFilter(e.target.value as AssigneeName | "")}
                >
                  <option value="">All Assignees</option>
                  {ASSIGNEE_OPTIONS.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stores-field">
                <label className="stores-label">Pre-Prod POD</label>
                <select
                  className="stores-input"
                  value={superpodId}
                  onChange={(e) => setSuperpodId(e.target.value)}
                >
                  <option value="">All PODs</option>
                  {superpodOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stores-field">
                <label className="stores-label">Implementation Type</label>
                <select
                  className="stores-input"
                  value={implementationType}
                  onChange={(e) => setImplementationType(e.target.value)}
                >
                  <option value="">All Types</option>
                  {implementationTypeOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div className="stores-field">
                <label className="stores-label">Product Type</label>
                <select
                  className="stores-input"
                  value={productType}
                  onChange={(e) => setProductType(e.target.value)}
                >
                  <option value="">All Products</option>
                  {productTypeOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              {error && <div className="bx-error">❌ {error}</div>}
            </div>
          </aside>
        )}

        <section className="stores-content">
          <div className="stores-table-card">
            <div className="stores-table-header">
              <div className="stores-table-header-left">
                <span className="stores-table-title">Store Records</span>
                <span className="stores-table-count">
                  Showing <strong>{filtered.length}</strong> of {records.length} stores
                </span>

                <div className="stores-quick-links">
                  <a
                    href={tapWorkordersUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open TAP Workorders"
                    className="stores-quick-icon"
                  >
                    <img
                      src="https://com-tekioncloud-tap-assets.s3.us-west-1.amazonaws.com/assets/common/toc-logo.svg"
                      alt="TAP Workorders"
                    />
                  </a>

                  <a
                    href="https://app.slack.com/client/E08DG6QMMDG/C0C5QBWEM8X"
                    target="_blank"
                    rel="noreferrer"
                    title="Open Operations Slack Channel (C0C5QBWEM8X)"
                    className="stores-quick-icon"
                  >
                    <img
                      src="https://cdn.brandfetch.io/idJ_HhtG0Z/theme/dark/symbol.svg?c=1dxbfHSJFAPEGdCLU4o5B"
                      alt="Slack"
                    />
                  </a>

                  <a
                    href="https://app.tekioncloud.com/internal/approval-management/dashboard/requests"
                    target="_blank"
                    rel="noreferrer"
                    title="Open Production Approval Management"
                    className="stores-quick-btn stores-quick-btn-prod"
                  >
                    PROD
                  </a>

                  <a
                    href="http://outlook.office365.com/mail/inbox"
                    target="_blank"
                    rel="noreferrer"
                    title="Open Outlook Inbox"
                    className="stores-quick-icon"
                  >
                    <img
                      src="https://cdn.brandfetch.io/idgdw68PEO/theme/dark/logo.svg?c=1dxbfHSJFAPEGdCLU4o5B"
                      alt="Outlook"
                    />
                  </a>

                  <a
                    href="https://preprodapp.tekioncloud.com/accounting/chartOfAccounts/list"
                    target="_blank"
                    rel="noreferrer"
                    title="Open Pre-Prod Chart of Accounts"
                    className="stores-quick-btn stores-quick-btn-preprod"
                  >
                    PRE-PROD
                  </a>

                  <a
                    href="https://preprod-map.tekioncloud.com/map/blueprintValidation"
                    target="_blank"
                    rel="noreferrer"
                    title="Open PreProd MAP Blueprint Validation"
                    className="stores-quick-btn stores-quick-btn-map"
                  >
                    PreProd MAP
                  </a>

                  <a
                    href="https://tap.tekioncloud.com/timetracker/employee-view"
                    target="_blank"
                    rel="noreferrer"
                    title="Open TAP Time Tracker Employee View"
                    className="stores-quick-btn stores-quick-btn-timesheet"
                  >
                    Time Sheet
                  </a>
                </div>
              </div>

              <button
                className="btn-secondary btn-sm"
                onClick={() => setFiltersCollapsed((prev) => !prev)}
              >
                {filtersCollapsed ? "☰ Show Filters" : "✕ Hide Filters"}
              </button>
            </div>

            <div className="stores-table-wrap stores-table-wrap-tall">
              <table className="stores-table">
                <thead>
                  <tr>
                    <th>Store & IDs</th>
                    <th>Go Live</th>
                    <th>Fixed Ops Assignee</th>
                    <th>Variable Ops Assignee</th>
                    <th>IMP Type</th>
                    <th>Products</th>
                    <th>Pre-Prod</th>
                    <th>POD</th>
                    <th>Blueprint</th>
                    <th>Setup Data</th>
                    <th>Fixed Ops</th>
                    <th>Variable Ops</th>
                    <th>Sign_Off</th>
                    <th>Testing</th>
                    <th>Not Worked?</th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((row) => {
                    const tLabel = getTLabel(row.launch_date);
                    const blueprint = row.blueprint_statuses;
                    const signoff = row.signoff_statuses;
                    const podStyle = getPodStyle(row.superpod_id);
                    const cleanedImp = cleanImpType(row.implementation_type);
                    const uiDate = formatLaunchDateUI(row.launch_date);
                    const fixedAssignee = getStoreFixedAssignee(row);
                    const variableAssignee = getStoreVariableAssignee(row);

                    void trackingTick;
                    const fixedOpsTime = buildLatestFieldTrackingText(
                      row.tekion_id,
                      "fixed_ops_status",
                      false
                    );
                    const variableOpsTime = buildLatestFieldTrackingText(
                      row.tekion_id,
                      "variable_ops_status",
                      false
                    );

                    const fixedAttCount =
                      row.fixed_ops_attachments ??
                      ((row.fetched_blueprint_tasks?.partsTasks || []).reduce(
                        (acc: number, t: any) => acc + (t.taskAttachmentCount || 0),
                        0
                      ) +
                        (row.fetched_blueprint_tasks?.serviceTasks || []).reduce(
                          (acc: number, t: any) => acc + (t.taskAttachmentCount || 0),
                          0
                        ));

                    const varAttCount =
                      row.variable_ops_attachments ??
                      (row.fetched_blueprint_tasks?.accountingTasks || []).reduce(
                        (acc: number, t: any) => acc + (t.taskAttachmentCount || 0),
                        0
                      );

                    return (
                      <tr key={row.tekion_id}>
                        <td style={{ minWidth: 230, maxWidth: 340 }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                flexWrap: "nowrap",
                              }}
                            >
                              <button
                                type="button"
                                className="stores-copy-btn"
                                title="Copy Tekion ID"
                                onClick={() =>
                                  handleCopy(row.tekion_id, `tek-${row.tekion_id}`)
                                }
                                style={{ fontWeight: 800, color: "#f8fafc" }}
                              >
                                {copiedKey === `tek-${row.tekion_id}`
                                  ? "Copied!"
                                  : row.tekion_id}
                              </button>

                              <button
                                type="button"
                                className="stores-copy-btn"
                                title="Copy Dealer ID"
                                onClick={() =>
                                  handleCopy(row.dealer_id, `dlr-${row.tekion_id}`)
                                }
                                style={{ color: "#38bdf8", fontWeight: 700 }}
                              >
                                {copiedKey === `dlr-${row.tekion_id}`
                                  ? "Copied!"
                                  : row.dealer_id}
                              </button>

                              <button
                                type="button"
                                className="stores-slack-trigger-btn"
                                onClick={() => setActiveDealerPopup(row)}
                                style={{ marginLeft: "auto" }}
                              >
                                💬 Update
                              </button>
                            </div>

                            <button
                              type="button"
                              className="stores-copy-btn"
                              title="Click to copy dealership name"
                              onClick={() =>
                                handleCopy(row.dba_name, `dba-${row.tekion_id}`)
                              }
                              style={{
                                textAlign: "left",
                                color: "#94a3b8",
                                fontSize: 12,
                                lineHeight: 1.35,
                                whiteSpace: "normal",
                                wordBreak: "break-word",
                                padding: "2px 4px",
                                borderRadius: 4,
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                              }}
                            >
                              {copiedKey === `dba-${row.tekion_id}` ? (
                                <span style={{ color: "#4ade80", fontWeight: 700 }}>
                                  Copied!
                                </span>
                              ) : (
                                row.dba_name || "—"
                              )}
                            </button>
                          </div>
                        </td>

                        <td>
                          <div className="stores-launch-date-cell">
                            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              {uiDate.weekday && (
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 500,
                                    color: "#64748b",
                                    letterSpacing: "0.2px",
                                  }}
                                >
                                  {uiDate.weekday}
                                </span>
                              )}
                              <span
                                style={{
                                  fontSize: 11,
                                  fontWeight: 800,
                                  color: "#38bdf8",
                                  background: "rgba(56, 189, 248, 0.12)",
                                  border: "1px solid rgba(56, 189, 248, 0.3)",
                                  padding: "2px 6px",
                                  borderRadius: 5,
                                  letterSpacing: "0.3px",
                                }}
                              >
                                {uiDate.date}
                              </span>
                            </div>
                            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 3 }}>
                              {tLabel.label}
                            </div>
                          </div>
                        </td>

                        {/* Fixed Ops Assignee */}
                        <td style={{ minWidth: 130 }}>
                          <select
                            value={fixedAssignee}
                            onChange={(e) =>
                              void updateStoreFixedAssignee(
                                row.tekion_id,
                                e.target.value as AssigneeName | ""
                              )
                            }
                            style={{
                              width: "100%",
                              background: fixedAssignee
                                ? "rgba(168, 85, 247, 0.15)"
                                : "rgba(148, 163, 184, 0.1)",
                              color: fixedAssignee ? "#c084fc" : "#64748b",
                              border: `1px solid ${
                                fixedAssignee
                                  ? "rgba(168, 85, 247, 0.35)"
                                  : "rgba(148, 163, 184, 0.2)"
                              }`,
                              borderRadius: 6,
                              padding: "4px 6px",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                              outline: "none",
                            }}
                          >
                            <option value="">— Unassigned —</option>
                            {ASSIGNEE_OPTIONS.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </td>

                        {/* Variable Ops Assignee */}
                        <td style={{ minWidth: 130 }}>
                          <select
                            value={variableAssignee}
                            onChange={(e) =>
                              void updateStoreVariableAssignee(
                                row.tekion_id,
                                e.target.value as AssigneeName | ""
                              )
                            }
                            style={{
                              width: "100%",
                              background: variableAssignee
                                ? "rgba(56, 189, 248, 0.15)"
                                : "rgba(148, 163, 184, 0.1)",
                              color: variableAssignee ? "#38bdf8" : "#64748b",
                              border: `1px solid ${
                                variableAssignee
                                  ? "rgba(56, 189, 248, 0.35)"
                                  : "rgba(148, 163, 184, 0.2)"
                              }`,
                              borderRadius: 6,
                              padding: "4px 6px",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                              outline: "none",
                            }}
                          >
                            <option value="">— Unassigned —</option>
                            {ASSIGNEE_OPTIONS.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td>{cleanedImp || "—"}</td>
                        <td>{row.product_types || "—"}</td>
                        <td>{row.pre_production_environment_status || "—"}</td>

                        <td>
                          <span
                            className="stores-pod-badge"
                            style={{
                              background: podStyle.bg,
                              color: podStyle.color,
                              border: `1px solid ${podStyle.border}`,
                            }}
                          >
                            {row.superpod_id || "—"}
                          </span>
                        </td>

                        <td>
                          <StatusChipGroup
                            items={[
                              {
                                short: "P",
                                fullName: "Blueprint - Parts",
                                status: blueprint?.parts ?? "UNKNOWN",
                              },
                              {
                                short: "S",
                                fullName: "Blueprint - Service",
                                status: blueprint?.service ?? "UNKNOWN",
                              },
                              {
                                short: "A",
                                fullName: "Blueprint - Accounting",
                                status: blueprint?.accounting ?? "UNKNOWN",
                              },
                              {
                                short: "C",
                                fullName: "Blueprint - CRM",
                                status: blueprint?.crm ?? "UNKNOWN",
                              },
                              {
                                short: "AN",
                                fullName: "Blueprint - Analytics",
                                status: blueprint?.analytics ?? "UNKNOWN",
                              },
                            ]}
                          />
                        </td>

                        <td>
                          <SetupDataCell row={row} />
                        </td>

                        <td>
                          <div className="stores-status-cell-wrap">
                            <CustomStatusSelect
                              value={row.fixed_ops_status}
                              onChange={(val) =>
                                void updateCustomStatus(row.tekion_id, "fixed_ops_status", val)
                              }
                            />

                            <div style={{ marginTop: 3 }}>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 3,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background:
                                    fixedAttCount > 0
                                      ? "rgba(56, 189, 248, 0.16)"
                                      : "rgba(148, 163, 184, 0.08)",
                                  color: fixedAttCount > 0 ? "#38bdf8" : "#64748b",
                                  border: `1px solid ${
                                    fixedAttCount > 0
                                      ? "rgba(56, 189, 248, 0.3)"
                                      : "rgba(148, 163, 184, 0.16)"
                                  }`,
                                }}
                                title="Total attachments across Parts and Service blueprint tasks"
                              >
                                <span>📎</span>
                                <span>
                                  {fixedAttCount}{row.attachments_incomplete ? "+" : ""} Attachment{fixedAttCount === 1 ? "" : "s"}
                                </span>
                              </span>
                            </div>

                            {fixedOpsTime !== "—" && (
                              <span className="stores-tracking-timestamp">
                                {fixedOpsTime}
                              </span>
                            )}
                          </div>
                        </td>

                        <td>
                          <div className="stores-status-cell-wrap">
                            <CustomStatusSelect
                              value={row.variable_ops_status}
                              onChange={(val) =>
                                void updateCustomStatus(row.tekion_id, "variable_ops_status", val)
                              }
                            />

                            <div style={{ marginTop: 3 }}>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 3,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background:
                                    varAttCount > 0
                                      ? "rgba(56, 189, 248, 0.16)"
                                      : "rgba(148, 163, 184, 0.08)",
                                  color: varAttCount > 0 ? "#38bdf8" : "#64748b",
                                  border: `1px solid ${
                                    varAttCount > 0
                                      ? "rgba(56, 189, 248, 0.3)"
                                      : "rgba(148, 163, 184, 0.16)"
                                  }`,
                                }}
                                title="Total attachments across Accounting blueprint tasks"
                              >
                                <span>📎</span>
                                <span>
                                  {varAttCount}{row.attachments_incomplete ? "+" : ""} Attachment{varAttCount === 1 ? "" : "s"}
                                </span>
                              </span>
                            </div>

                            {variableOpsTime !== "—" && (
                              <span className="stores-tracking-timestamp">
                                {variableOpsTime}
                              </span>
                            )}
                          </div>
                        </td>

                        <td>
                          <StatusChipGroup
                            items={[
                              {
                                short: "P",
                                fullName: "Parts Operational Sign-Off",
                                status: signoff?.parts ?? "UNKNOWN",
                              },
                              {
                                short: "S",
                                fullName: "Service Operational Sign-Off",
                                status: signoff?.service ?? "UNKNOWN",
                              },
                              {
                                short: "A",
                                fullName: "Accounting Operational Sign-Off",
                                status: signoff?.accounting ?? "UNKNOWN",
                              },
                            ]}
                          />
                        </td>

                        <td>
                          <CustomStatusSelect
                            value={row.testing_status}
                            onChange={(val) =>
                              void updateCustomStatus(row.tekion_id, "testing_status", val)
                            }
                          />
                        </td>

                        {/* Not Worked? Column */}
                        <td style={{ minWidth: 200 }}>
                          <select
                            value={row.not_worked || ""}
                            onChange={(e) =>
                              void updateStoreNotWorked(row.tekion_id, e.target.value)
                            }
                            style={{
                              width: "100%",
                              background: row.not_worked
                                ? "rgba(244, 63, 94, 0.15)"
                                : "rgba(148, 163, 184, 0.1)",
                              color: row.not_worked ? "#fb7185" : "#64748b",
                              border: `1px solid ${
                                row.not_worked
                                  ? "rgba(244, 63, 94, 0.35)"
                                  : "rgba(148, 163, 184, 0.2)"
                              }`,
                              borderRadius: 6,
                              padding: "4px 6px",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                              outline: "none",
                            }}
                          >
                            <option value="">— Handled by ARC —</option>
                            {NOT_WORKED_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {opt}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {!loadingStores && filtered.length === 0 && (
                <div className="stores-empty" style={{ padding: 40, textAlign: "center" }}>
                  <div style={{ fontSize: 32 }}>🏬</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>
                    No records found
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>
                    Try clearing filters or adjusting your date window
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <DealerMetaModal
        row={currentModalRecord}
        onClose={() => setActiveDealerPopup(null)}
        onToast={showToast}
        onTasksSnapshot={handleTasksSnapshot}
        onSetupFetched={(tekionId, setupData) => {
          setActiveDealerPopup((prev) =>
            prev && prev.tekion_id === tekionId
              ? {
                  ...prev,
                  setup_data: setupData,
                  setup_data_fetched_at: setupData.fetchedAt,
                  setup_data_error: "",
                }
              : prev
          );
          void persistSetupData(tekionId, setupData);
        }}
        onTaskOperationalStatusChange={(tekionId, field, value) => {
          void updateCustomStatus(tekionId, field, value);
        }}
      />
    </div>
  );
};

export default Stores;