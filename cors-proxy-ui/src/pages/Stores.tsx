import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  fetchStores,
  getTDaysRange,
  ExpiredCaptureTokenError,
} from "../services/tekionStoresApi";
import type { TRange } from "../services/tekionStoresApi";
import { getStores, saveStores } from "../services/storesDb";
import type { StoreRecord, CustomPhaseStatus } from "../services/storesDb";
import type {
  OnboardingStatus,
  StoreBlueprintStatuses,
  StoreSignoffStatuses,
} from "../services/storeOnboardingStatusApi";
import { fetchStoreOnboardingStatuses } from "../services/storeOnboardingStatusApi";
import { exportStoresToExcel } from "../services/storesExcelExport";
import { syncStoresToGraphWorkbook } from "../services/storesGraphSync";
import {
  buildStoreSlackDraftContext,
  getSlackSession,
  sendSlackMessage,
  type SlackRecipientCandidate,
} from "../services/storeSlackHelper";

interface Props {
  onBack: () => void;
}

const logger = {
  info: (...args: unknown[]) => console.info("[Stores]", ...args),
  debug: (...args: unknown[]) => console.debug("[Stores]", ...args),
  warn: (...args: unknown[]) => console.warn("[Stores]", ...args),
  error: (...args: unknown[]) => console.error("[Stores]", ...args),
};

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

function formatLaunchDate(value: string): string {
  const d = parseLaunchDate(value);
  if (!d) return value || "—";

  const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  const year = d.getFullYear();

  return `${weekday} ${month}/${day}/${year}`;
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

function shouldAutoFetchStatuses(records: StoreRecord[]): boolean {
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
      border: "rgba(16, 185, 129, 0.30)",
    };
  }
  return {
    bg: "rgba(148, 163, 184, 0.12)",
    color: "#cbd5e1",
    border: "rgba(148, 163, 184, 0.22)",
  };
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return Array.from(
    new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))
  );
}

function buildDealerPopupRows(row: StoreRecord): Array<{ label: string; value: string }> {
  const podLeadValues = uniqueNonEmpty([
    row.workorder_consolidated_pdl,
    row.dealer_pdl,
    row.arc_pdl,
  ]);

  const trackingIdValues = uniqueNonEmpty([
    row.project_implementation_tm_sync_status_tracking_id,
    row.implementation_tm_sync_status_tracking_id,
    row.base_entity_instance_id,
  ]);

  return [
    { label: "Dealer ID", value: row.dealer_id || "—" },
    { label: "Tenant Code", value: row.tenant_code || "—" },
    { label: "Tenant ID", value: row.tenant_id || "—" },
    { label: "Pod Lead", value: podLeadValues.length ? podLeadValues.join(" / ") : "—" },
    { label: "Tracking ID", value: trackingIdValues.length ? trackingIdValues.join(" / ") : "—" },
    {
      label: "PEM",
      value: row.project_engagement_manager_1781169293313734451 || "—",
    },
    {
      label: "Fixed Ops POD",
      value: row.fixed_ops_track_lead_1773369946675032982 || "—",
    },
    {
      label: "Conversion",
      value: row.conversion_track_lead_1773369950325147526 || "—",
    },
    {
      label: "Variable Ops POD",
      value: row.accounting_track_lead_1773369945455468395 || "—",
    },
  ];
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
        userSelect: "none",
        cursor: "default",
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
    <div style={{ position: "relative", display: "inline-block", width: 115, minWidth: 115 }}>
      <select
        value={currentVal}
        onChange={(e) => onChange(e.target.value as CustomPhaseStatus)}
        style={{
          width: "100%",
          minWidth: 115,
          background: style.bg,
          color: style.text,
          border: `1px solid ${style.border}`,
          borderRadius: 8,
          padding: "5px 24px 5px 10px",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          outline: "none",
          appearance: "none",
          textAlign: "left",
          whiteSpace: "nowrap",
        }}
      >
        <option value="TO DO" style={{ background: "#1c1c1e", color: "#fff" }}>
          TO DO
        </option>
        <option value="WIP" style={{ background: "#1c1c1e", color: "#fff" }}>
          WIP
        </option>
        <option value="Completed" style={{ background: "#1c1c1e", color: "#fff" }}>
          Completed
        </option>
      </select>
      <span
        style={{
          position: "absolute",
          right: 9,
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
  stores: StoreRecord[],
  statusMap: Record<
    string,
    {
      blueprint_statuses: StoreBlueprintStatuses;
      signoff_statuses: StoreSignoffStatuses;
    }
  >
): StoreRecord[] {
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
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 8,
        border: `1px solid ${checked ? "rgba(59,130,246,0.3)" : "rgba(255,255,255,0.06)"}`,
        background: checked ? "rgba(59,130,246,0.08)" : "rgba(255,255,255,0.02)",
        cursor: isAvailable ? "pointer" : "not-allowed",
        opacity: isAvailable ? 1 : 0.5,
        transition: "all 0.15s ease",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={!isAvailable}
        onChange={onToggle}
        style={{ cursor: isAvailable ? "pointer" : "default" }}
      />

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#f8fafc", fontSize: 12, fontWeight: 700 }}>
            {candidate.label}
          </span>
          <span style={{ color: "#94a3b8", fontSize: 11 }}>
            ({candidate.matchedUser?.fullName || "Not found"})
          </span>
        </div>
        <div style={{ color: "#64748b", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {candidate.normalizedEmail || candidate.matchedUser?.userId || "No ID"}
        </div>
      </div>
    </label>
  );
};

const DealerMetaModal: React.FC<{
  row: StoreRecord | null;
  onClose: () => void;
  onToast: (message: string) => void;
}> = ({ row, onClose, onToast }) => {
  const draftContext = useMemo(() => {
    return row ? buildStoreSlackDraftContext(row) : null;
  }, [row]);

  const slackSession = useMemo(() => getSlackSession(), [row]);

  const [selectedRecipientKeys, setSelectedRecipientKeys] = useState<string[]>([]);
  const [messageText, setMessageText] = useState("");
  const [sendingKey, setSendingKey] = useState("");
  const [isSendingAll, setIsSendingAll] = useState(false);
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");

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

  const popupRows = buildDealerPopupRows(row);

  const selectedRecipients = draftContext.recipients.filter(
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
      } catch (err: unknown) {
        failCount++;
        logger.error("Failed batch Slack send", err);
      }
    }

    setIsSendingAll(false);
    if (failCount === 0) {
      onToast(`✅ Successfully dispatched message to ${successCount} recipient(s)`);
    } else {
      onToast(`⚠ Sent ${successCount}, failed ${failCount}`);
    }
  };

  const hasSlackSession = Boolean(slackSession.slackToken && slackSession.slackDCookie);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        zIndex: 9999,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 1040,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          background: "#151922",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 16,
          boxShadow: "0 25px 50px -12px rgba(0,0,0,0.5)",
          overflow: "hidden",
        }}
      >
        {/* Modal Top Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            background: "#11151d",
          }}
        >
          <div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#fff" }}>
              {row.dba_name || "Store Details"}
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
              Dealer ID: <span style={{ color: "#f8fafc", fontWeight: 700 }}>{row.dealer_id}</span> • Tekion ID: {row.tekion_id}
            </div>
          </div>

          <button
            className="btn-secondary btn-sm"
            onClick={onClose}
            style={{ padding: "4px 10px", fontSize: 12 }}
          >
            ✕ Close
          </button>
        </div>

        {/* Modal Content Scroll Area */}
        <div style={{ overflowY: "auto", padding: 20, display: "grid", gap: 16 }}>
          {/* Metadata Compact Card */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 10,
              padding: 12,
              borderRadius: 12,
              background: "#0d1117",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {popupRows.map((item) => (
              <div key={item.label}>
                <div style={{ color: "#64748b", fontSize: 11, fontWeight: 700 }}>
                  {item.label}
                </div>
                <div
                  style={{
                    color: "#f1f5f9",
                    fontSize: 12,
                    fontWeight: 600,
                    marginTop: 2,
                    wordBreak: "break-word",
                  }}
                >
                  {item.value || "—"}
                </div>
              </div>
            ))}
          </div>

          {/* Two-Column Editor & Recipient Layout */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(280px, 340px) minmax(0, 1fr)",
              gap: 16,
              alignItems: "start",
            }}
          >
            {/* Left Column: Recipients */}
            <div
              style={{
                display: "grid",
                gap: 10,
                padding: 14,
                borderRadius: 12,
                background: "#11151d",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#f8fafc", fontSize: 13, fontWeight: 800 }}>
                  Recipients ({selectedRecipients.length})
                </span>
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 999,
                    background: hasSlackSession ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                    color: hasSlackSession ? "#4ade80" : "#f87171",
                    fontWeight: 700,
                  }}
                >
                  {hasSlackSession ? "Session Active" : "No Session"}
                </span>
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                {draftContext.recipients.map((recipient) => (
                  <SlackRecipientRow
                    key={recipient.key}
                    candidate={recipient}
                    checked={selectedRecipientKeys.includes(recipient.key)}
                    onToggle={() => handleToggleRecipient(recipient.key)}
                  />
                ))}
              </div>

              <div style={{ paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 11, color: "#64748b" }}>
                Individual Dispatches:
                <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                  {selectedRecipients.map((rec) => (
                    <div
                      key={rec.key}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: 11,
                        color: "#94a3b8",
                      }}
                    >
                      <span style={{ textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap", maxWidth: 160 }}>
                        {rec.matchedUser?.fullName}
                      </span>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        disabled={!hasSlackSession || sendingKey === rec.key || isSendingAll}
                        onClick={() => void handleSendSingle(rec)}
                        style={{ padding: "2px 8px", fontSize: 10 }}
                      >
                        {sendingKey === rec.key ? "..." : "Send"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Message Composer */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                padding: 14,
                borderRadius: 12,
                background: "#11151d",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#f8fafc", fontSize: 13, fontWeight: 800 }}>
                  Slack Message Draft
                </span>

                {/* Segmented Write/Preview Control */}
                <div
                  style={{
                    display: "inline-flex",
                    background: "#0b0f15",
                    padding: 2,
                    borderRadius: 6,
                    border: "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setEditorMode("edit")}
                    style={{
                      background: editorMode === "edit" ? "#1e293b" : "transparent",
                      color: editorMode === "edit" ? "#f8fafc" : "#94a3b8",
                      border: "none",
                      borderRadius: 4,
                      padding: "3px 10px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditorMode("preview")}
                    style={{
                      background: editorMode === "preview" ? "#1e293b" : "transparent",
                      color: editorMode === "preview" ? "#f8fafc" : "#94a3b8",
                      border: "none",
                      borderRadius: 4,
                      padding: "3px 10px",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Preview
                  </button>
                </div>
              </div>

              {editorMode === "edit" ? (
                <textarea
                  className="stores-input"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  style={{
                    width: "100%",
                    minHeight: 220,
                    resize: "vertical",
                    borderRadius: 8,
                    padding: 12,
                    background: "#0b0f15",
                    color: "#f8fafc",
                    border: "1px solid rgba(255,255,255,0.10)",
                    boxSizing: "border-box",
                    lineHeight: 1.5,
                    fontSize: 12,
                    fontFamily: "monospace",
                  }}
                />
              ) : (
                <div
                  style={{
                    minHeight: 220,
                    borderRadius: 8,
                    padding: 12,
                    background: "#0b0f15",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#e2e8f0",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.5,
                    fontSize: 12,
                  }}
                >
                  {messageText || "Empty draft."}
                </div>
              )}

              {/* Primary Batch Send Action */}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn-postman"
                  disabled={!hasSlackSession || selectedRecipients.length === 0 || isSendingAll}
                  onClick={() => void handleSendAll()}
                  style={{
                    padding: "8px 18px",
                    fontWeight: 800,
                    fontSize: 12,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {isSendingAll ? "⏳ Dispatched..." : `Send to Selected (${selectedRecipients.length})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const Stores: React.FC<Props> = ({ onBack }) => {
  const [records, setRecords] = useState<StoreRecord[]>([]);
  const [loadingStores, setLoadingStores] = useState(false);
  const [syncingExcel, setSyncingExcel] = useState(false);
  const [error, setError] = useState("");
  const [tokenExpiredMessage, setTokenExpiredMessage] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [range, setRange] = useState<TRange>(90);
  const [search, setSearch] = useState("");
  const [superpodId, setSuperpodId] = useState("");
  const [implementationType, setImplementationType] = useState("");
  const [productType, setProductType] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [activeDealerPopup, setActiveDealerPopup] = useState<StoreRecord | null>(null);

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

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => setToastMessage(""), 3500);
  }, []);

  const handleCopy = useCallback((text: string, keyIdentifier: string) => {
    void navigator.clipboard.writeText(text || "");
    setCopiedKey(keyIdentifier);
    window.setTimeout(() => setCopiedKey(null), 1200);
  }, []);

  const loadStatusesForStores = useCallback(async (stores: StoreRecord[]) => {
    const tekionIds = stores.map((item) => item.tekion_id).filter(Boolean);

    if (tekionIds.length === 0) {
      return;
    }

    try {
      const statusMap = await fetchStoreOnboardingStatuses(tekionIds, {
        chunkSize: 25,
        concurrency: 3,
      });

      const merged = withOnboardingStatuses(stores, statusMap);
      setRecords(merged);
      await saveStores(merged);
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

        const uniqueStores = Array.from(
          new Map<string, StoreRecord>(
            rawStores.map((store) => {
              const existing = existingMap.get(store.tekion_id);
              return [
                store.tekion_id,
                {
                  ...store,
                  configuration_status: existing?.configuration_status || "TO DO",
                  testing_status: existing?.testing_status || "TO DO",
                  blueprint_statuses: existing?.blueprint_statuses,
                  signoff_statuses: existing?.signoff_statuses,
                  onboarding_status_fetched_at: existing?.onboarding_status_fetched_at,
                },
              ];
            })
          ).values()
        );

        setRecords(uniqueStores);
        await saveStores(uniqueStores);
        showToast(`✅ Refreshed ${uniqueStores.length} stores`);

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

      const uniqueData = Array.from(
        new Map<string, StoreRecord>(rawData.map((store) => [store.tekion_id, store])).values()
      );

      setRecords(uniqueData);
      showToast(`Loaded ${uniqueData.length} stores from local cache`);

      if (shouldAutoFetchStatuses(uniqueData)) {
        if (uniqueData.length > 0) {
          void loadStatusesForStores(uniqueData);
        }
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
    field: "configuration_status" | "testing_status",
    value: CustomPhaseStatus
  ) => {
    const updatedRecords = records.map((r) =>
      r.tekion_id === tekion_id ? { ...r, [field]: value } : r
    );

    setRecords(updatedRecords);

    try {
      await saveStores(updatedRecords);
    } catch (err: unknown) {
      logger.error("Failed to save custom status to IndexedDB", err);
    }
  };

  const superpodOptions = useMemo(
    () => Array.from(new Set(records.map((r) => r.superpod_id).filter(Boolean))).sort(),
    [records]
  );

  const implementationTypeOptions = useMemo(
    () =>
      Array.from(new Set(records.map((r) => cleanImpType(r.implementation_type)).filter(Boolean))).sort(),
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
        const matchesSearch =
          !q ||
          item.tekion_id.toLowerCase().includes(q) ||
          item.dealer_id.toLowerCase().includes(q) ||
          item.dba_name.toLowerCase().includes(q);

        const matchesSuperpod = !superpodId || item.superpod_id === superpodId;
        const normalizedImp = cleanImpType(item.implementation_type);
        const matchesImplementationType =
          !implementationType || normalizedImp === implementationType;
        const matchesProductType =
          !productType || (item.product_types || "").toLowerCase().includes(productType.toLowerCase());
        const matchesMonth =
          !selectedMonth || getMonthYearString(item.launch_date) === selectedMonth;

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
  }, [records, search, superpodId, implementationType, productType, selectedMonth, fromDate, toDate]);

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
      showToast(
        `✅ Synced ${result.rowCount} stores (${result.sheetCount} sheets)`
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
    setFromDate(toInputDate(presetRange.fromDate));
    setToDate(toInputDate(presetRange.toDate));
  };

  return (
    <div className="stores-shell">
      {/* Top Bar Navigation */}
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

        <div className="stores-topbar-right" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn-secondary btn-sm" onClick={() => void handleLoadIndexedDb()} title="Reload from IndexedDB">
            Cache
          </button>

          <div style={{ display: "inline-flex", borderRadius: 6, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)" }}>
            <button
              className="btn-secondary btn-sm"
              onClick={handleExportExcel}
              style={{ borderRadius: 0, border: "none", borderRight: "1px solid rgba(255,255,255,0.12)" }}
            >
              Export Excel
            </button>
            <button
              className="btn-secondary btn-sm"
              onClick={exportJson}
              style={{ borderRadius: 0, border: "none" }}
            >
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
            className="btn-postman"
            onClick={() => void handleFetch(true)}
            disabled={loadingStores}
            style={{ fontWeight: 800 }}
          >
            {loadingStores ? "⏳ Fetching..." : "🔄 Refresh"}
          </button>
        </div>
      </div>

      {/* Floating Toast Notification (Zero CLS) */}
      {toastMessage && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 10000,
            background: "#1e293b",
            color: "#f8fafc",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 8,
            padding: "10px 18px",
            boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
            fontSize: 13,
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* Token Expiration Banner */}
      {tokenExpiredMessage && (
        <div className="bx-error" style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>⚠ {tokenExpiredMessage}</span>
          <a
            href={tapWorkordersUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              color: "#93c5fd",
              textDecoration: "underline",
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            Open TAP to recapture API ↗
          </a>
        </div>
      )}

      {/* Main Grid Layout */}
      <div
        className="stores-layout"
        style={{
          display: "grid",
          gridTemplateColumns: filtersCollapsed ? "1fr" : "300px minmax(0, 1fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* Sidebar Filters */}
        {!filtersCollapsed && (
          <aside className="stores-sidebar" style={{ minWidth: 0 }}>
            <div className="stores-panel" style={{ display: "grid", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span className="stores-panel-title" style={{ margin: 0 }}>Filters</span>
                <button
                  type="button"
                  onClick={clearFilters}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#94a3b8",
                    fontSize: 11,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Reset all
                </button>
              </div>

              <div className="stores-field">
                <label className="stores-label">Search</label>
                <input
                  className="stores-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ID, Dealer, or Store Name..."
                />
              </div>

              <div className="stores-field">
                <label className="stores-label">T-Range Presets</label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
                  {[7, 30, 60, 90].map((days) => (
                    <button
                      key={days}
                      type="button"
                      className={range === days ? "btn-postman" : "btn-secondary btn-sm"}
                      onClick={() => setRange(days as TRange)}
                      style={{ padding: "4px 0", fontSize: 11, textAlign: "center" }}
                    >
                      T-{days}
                    </button>
                  ))}
                </div>
              </div>

              <div className="stores-field">
                <label className="stores-label">Launch Window</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <input
                    type="date"
                    className="stores-input"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    style={{ fontSize: 11, padding: "4px 6px" }}
                  />
                  <input
                    type="date"
                    className="stores-input"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    style={{ fontSize: 11, padding: "4px 6px" }}
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

        {/* Content Table Card */}
        <section className="stores-content" style={{ minWidth: 0 }}>
          <div className="stores-table-card">
            {/* Table Header Controls */}
            <div
              className="stores-table-header"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 14, fontWeight: 800, color: "#f8fafc" }}>
                  Store Records
                </span>
                <span style={{ fontSize: 12, color: "#94a3b8" }}>
                  Showing <strong style={{ color: "#f8fafc" }}>{filtered.length}</strong> of {records.length} stores
                </span>

                {/* Quick Access Badges (TAP, Slack, Neon PROD, Outlook, Neon PRE-PROD) */}
                <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
                  {/* TAP Workorders Official Asset */}
                  <a
                    href={tapWorkordersUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open TAP Workorders"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <img
                      src="https://com-tekioncloud-tap-assets.s3.us-west-1.amazonaws.com/assets/common/toc-logo.svg"
                      alt="TAP Workorders"
                      style={{ width: 17, height: 17, objectFit: "contain", display: "block" }}
                    />
                  </a>

                  {/* Slack Brandfetch Dark Theme SVG */}
                  <a
                    href="https://app.slack.com/client/E08DG6QMMDG"
                    target="_blank"
                    rel="noreferrer"
                    title="Open Slack Workspace"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <img
                      src="https://cdn.brandfetch.io/idJ_HhtG0Z/theme/dark/symbol.svg?c=1dxbfHSJFAPEGdCLU4o5B"
                      alt="Slack"
                      style={{ width: 17, height: 17, objectFit: "contain", display: "block" }}
                    />
                  </a>

                  {/* PROD Neon Link */}
                  {/* PROD Link (Muted) */}
                  <a
                    href="https://app.tekioncloud.com/internal/approval-management/dashboard/requests"
                    target="_blank"
                    rel="noreferrer"
                    title="Open Production Approval Management"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: 28,
                      padding: "0 9px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.5px",
                      textDecoration: "none",
                      color: "#4ade80",
                      background: "rgba(74, 222, 128, 0.08)",
                      border: "1px solid rgba(74, 222, 128, 0.25)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    PROD
                  </a>

                  {/* Outlook Brandfetch Dark Theme SVG */}
                  <a
                    href="http://outlook.office365.com/mail/inbox"
                    target="_blank"
                    rel="noreferrer"
                    title="Open Outlook Inbox"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 28,
                      height: 28,
                      borderRadius: 6,
                      background: "rgba(255, 255, 255, 0.05)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    <img
                      src="https://cdn.brandfetch.io/idgdw68PEO/theme/dark/logo.svg?c=1dxbfHSJFAPEGdCLU4o5B"
                      alt="Outlook"
                      style={{ width: 17, height: 17, objectFit: "contain", display: "block" }}
                    />
                  </a>

                  {/* PRE-PROD Link (Muted) */}
                  <a
                    href="https://preprodapp.tekioncloud.com/accounting/chartOfAccounts/list"
                    target="_blank"
                    rel="noreferrer"
                    title="Open Pre-Prod Chart of Accounts"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: 28,
                      padding: "0 9px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.5px",
                      textDecoration: "none",
                      color: "#38bdf8",
                      background: "rgba(56, 189, 248, 0.08)",
                      border: "1px solid rgba(56, 189, 248, 0.25)",
                      transition: "all 0.15s ease",
                    }}
                  >
                    PRE-PROD
                  </a>
                </div>
              </div>

              <button
                className="btn-secondary btn-sm"
                onClick={() => setFiltersCollapsed((prev) => !prev)}
                style={{ fontSize: 11 }}
              >
                {filtersCollapsed ? "☰ Show Filters" : "✕ Hide Filters"}
              </button>
            </div>

            {/* Scroll Container with Sticky Header */}
            <div className="stores-table-wrap stores-table-wrap-tall" style={{ maxHeight: "calc(100vh - 180px)", overflow: "auto" }}>
              <table className="stores-table" style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                <thead>
                  <tr style={{ position: "sticky", top: 0, zIndex: 10, background: "#11151d", boxShadow: "0 1px 0 rgba(255,255,255,0.1)" }}>
                    <th style={{ padding: "10px 8px", width: 95 }}>Tekion ID</th>
                    <th style={{ padding: "10px 8px", width: 140 }}>Dealer ID</th>

                    {/* Dealership absorbs all extra horizontal space */}
                    <th style={{ padding: "10px 10px", width: "100%", minWidth: 260, textAlign: "left" }}>
                      Dealership
                    </th>

                    {/* Go Live locked width */}
                    <th style={{ padding: "10px 4px 10px 6px", width: 110, maxWidth: 110, whiteSpace: "nowrap" }}>
                      Go Live
                    </th>

                    {/* IMP Type locked width */}
                    <th style={{ padding: "10px 6px 10px 4px", width: 80, maxWidth: 80, whiteSpace: "nowrap" }}>
                      IMP Type
                    </th>

                    <th style={{ padding: "10px 8px", width: 95 }}>Products</th>
                    <th style={{ padding: "10px 8px", width: 85 }}>Pre-Prod</th>
                    <th style={{ padding: "10px 8px", width: 65, textAlign: "center" }}>POD</th>
                    <th style={{ padding: "10px 8px" }}>Blueprint</th>

                    {/* Configuration fixed comfortable width */}
                    <th style={{ padding: "10px 12px", width: 130, minWidth: 130, whiteSpace: "nowrap", textAlign: "center" }}>
                      Configuration
                    </th>

                    <th style={{ padding: "10px 8px" }}>Sign_Off</th>

                    {/* Testing fixed comfortable width */}
                    <th style={{ padding: "10px 12px", width: 130, minWidth: 130, whiteSpace: "nowrap", textAlign: "center" }}>
                      Testing
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((row) => {
                    const tLabel = getTLabel(row.launch_date);
                    const blueprint = row.blueprint_statuses;
                    const signoff = row.signoff_statuses;
                    const podStyle = getPodStyle(row.superpod_id);
                    const cleanedImp = cleanImpType(row.implementation_type);

                    return (
                      <tr key={row.tekion_id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        {/* Tekion ID */}
                        <td style={{ width: 95, whiteSpace: "nowrap", padding: "8px" }}>
                          <button
                            type="button"
                            className="stores-copy-btn"
                            onClick={() => handleCopy(row.tekion_id, `tek-${row.tekion_id}`)}
                            title="Click to copy Tekion ID"
                            style={{ fontSize: 12 }}
                          >
                            {copiedKey === `tek-${row.tekion_id}` ? "Copied!" : row.tekion_id}
                          </button>
                        </td>

                        {/* Dealer ID with Slack Trigger */}
                        <td style={{ width: 140, whiteSpace: "nowrap", padding: "8px" }}>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <button
                              type="button"
                              className="stores-copy-btn"
                              onClick={() => handleCopy(row.dealer_id, `dlr-${row.tekion_id}`)}
                              title="Click to copy Dealer ID"
                              style={{ fontWeight: 700, fontSize: 12 }}
                            >
                              {copiedKey === `dlr-${row.tekion_id}` ? "Copied!" : row.dealer_id}
                            </button>

                            <button
                              type="button"
                              onClick={() => setActiveDealerPopup(row)}
                              title="Open details and draft Slack message"
                              style={{
                                background: "rgba(59,130,246,0.12)",
                                color: "#60a5fa",
                                border: "1px solid rgba(59,130,246,0.25)",
                                borderRadius: 6,
                                padding: "2px 6px",
                                fontSize: 10,
                                fontWeight: 700,
                                cursor: "pointer",
                              }}
                            >
                              💬 Slack
                            </button>
                          </div>
                        </td>

                        {/* Dealership */}
                        <td style={{ width: "100%", minWidth: 260, padding: "8px 10px" }}>
                          <button
                            type="button"
                            className="stores-copy-btn"
                            onClick={() => handleCopy(row.dba_name, `dba-${row.tekion_id}`)}
                            title={`Click to copy: ${row.dba_name}`}
                            style={{
                              textAlign: "left",
                              fontSize: 12,
                              fontWeight: 600,
                              lineHeight: 1.35,
                              whiteSpace: "normal",
                              wordBreak: "break-word",
                              display: "inline-block",
                              maxWidth: "100%",
                            }}
                          >
                            {copiedKey === `dba-${row.tekion_id}` ? (
                              <span style={{ color: "#4ade80", fontWeight: 700 }}>Copied!</span>
                            ) : (
                              row.dba_name || "—"
                            )}
                          </button>
                        </td>

                        {/* Go Live */}
                        <td style={{ width: 110, maxWidth: 110, whiteSpace: "nowrap", padding: "8px 4px 8px 6px" }}>
                          <div className="stores-date-cell" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <div className="stores-date-main" style={{ fontSize: 11, fontWeight: 700 }}>
                              {formatLaunchDate(row.launch_date)}
                            </div>
                            <div className={`stores-date-sub stores-date-${tLabel.tone}`} style={{ fontSize: 10, alignSelf: "flex-start" }}>
                              {tLabel.label}
                            </div>
                          </div>
                        </td>

                        {/* IMP Type */}
                        <td style={{ width: 80, maxWidth: 80, whiteSpace: "nowrap", fontSize: 11, color: "#cbd5e1", padding: "8px 6px 8px 4px" }}>
                          {cleanedImp || "—"}
                        </td>

                        {/* Products */}
                        <td style={{ width: 95, fontSize: 11, whiteSpace: "normal", padding: "8px" }}>
                          {row.product_types || "—"}
                        </td>

                        {/* Pre-production */}
                        <td style={{ width: 85, fontSize: 11, whiteSpace: "nowrap", padding: "8px" }}>
                          {row.pre_production_environment_status || "—"}
                        </td>

                        {/* Superpod */}
                        <td style={{ width: 65, textAlign: "center", padding: "8px" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "2px 8px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 700,
                              background: podStyle.bg,
                              color: podStyle.color,
                              border: `1px solid ${podStyle.border}`,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {row.superpod_id || "—"}
                          </span>
                        </td>

                        {/* Blueprint Status Chips */}
                        <td style={{ padding: "8px" }}>
                          <StatusChipGroup
                            items={[
                              { short: "P", fullName: "Blueprint - Parts", status: blueprint?.parts ?? "UNKNOWN" },
                              { short: "S", fullName: "Blueprint - Service", status: blueprint?.service ?? "UNKNOWN" },
                              { short: "A", fullName: "Blueprint - Accounting", status: blueprint?.accounting ?? "UNKNOWN" },
                              { short: "C", fullName: "Blueprint - CRM", status: blueprint?.crm ?? "UNKNOWN" },
                              { short: "AN", fullName: "Blueprint - Analytics", status: blueprint?.analytics ?? "UNKNOWN" },
                            ]}
                          />
                        </td>

                        {/* Configuration Dropdown */}
                        <td style={{ width: 130, minWidth: 130, whiteSpace: "nowrap", textAlign: "center", padding: "8px 12px" }}>
                          <CustomStatusSelect
                            value={row.configuration_status}
                            onChange={(val) => void updateCustomStatus(row.tekion_id, "configuration_status", val)}
                          />
                        </td>

                        {/* Operational Sign-Off Status Chips */}
                        <td style={{ padding: "8px" }}>
                          <StatusChipGroup
                            items={[
                              { short: "P", fullName: "Parts Operational Sign-Off", status: signoff?.parts ?? "UNKNOWN" },
                              { short: "S", fullName: "Service Operational Sign-Off", status: signoff?.service ?? "UNKNOWN" },
                              { short: "A", fullName: "Accounting Operational Sign-Off", status: signoff?.accounting ?? "UNKNOWN" },
                            ]}
                          />
                        </td>

                        {/* Testing Dropdown */}
                        <td style={{ width: 130, minWidth: 130, whiteSpace: "nowrap", textAlign: "center", padding: "8px 12px" }}>
                          <CustomStatusSelect
                            value={row.testing_status}
                            onChange={(val) => void updateCustomStatus(row.tekion_id, "testing_status", val)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {!loadingStores && filtered.length === 0 && (
                <div className="stores-empty" style={{ padding: 40, textAlign: "center" }}>
                  <div className="stores-empty-icon" style={{ fontSize: 32 }}>🏬</div>
                  <div className="stores-empty-title" style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>
                    No records found
                  </div>
                  <div className="stores-empty-sub" style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>
                    Try clearing filters or adjusting your date window
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Slack & Dealer Info Modal */}
      <DealerMetaModal
        row={activeDealerPopup}
        onClose={() => setActiveDealerPopup(null)}
        onToast={showToast}
      />
    </div>
  );
};

export default Stores;