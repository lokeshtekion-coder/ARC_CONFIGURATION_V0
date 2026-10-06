import React, { useState, useMemo, useEffect } from "react";
import type { CustomPhaseStatus, StoreSetupData } from "../../services/storesDb";
import { resolveStoreProjectId, saveStores } from "../../services/storesDb";
import {
  buildStoreSlackDraftContext,
  getSlackSession,
  sendSlackMessage,
  type SlackRecipientCandidate,
  type SlackDirectoryUser,
} from "../../services/storeSlackHelper";
import { fetchSetupDataForStore } from "../../services/storeSetupDataService";
import {
  executePreprodMapPipeline,
  type PreprodValidationResult,
} from "../../services/preprodMapApiService";
import DealerTasksPanel from "../DealerTasksPanel";
import type { ExtendedStoreRecord } from "../Stores";

const SlackRecipientRow: React.FC<{
  candidate: SlackRecipientCandidate;
  checked: boolean;
  onToggle: () => void;
}> = ({ candidate, checked, onToggle }) => {
  const isAvailable = Boolean(candidate.matchedUser?.userId);
  return (
    <label className="slack-recipient-row">
      <input type="checkbox" checked={checked} disabled={!isAvailable} onChange={onToggle} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div>
          <span>{candidate.label}</span>{" "}
          <span style={{ color: "#94a3b8" }}>({candidate.matchedUser?.fullName || "Not found"})</span>
        </div>
        <div style={{ color: "#64748b", fontSize: 11 }}>
          {candidate.normalizedEmail || candidate.matchedUser?.userId || "No ID"}
        </div>
      </div>
    </label>
  );
};

export const DealerMetaModal: React.FC<{
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
  staticSlackMap: Map<string, SlackDirectoryUser>;
}> = ({
  row,
  onClose,
  onToast,
  onSetupFetched,
  onTaskOperationalStatusChange,
  onTasksSnapshot,
  staticSlackMap,
}) => {
  const [tab, setTab] = useState<"tasks" | "slack">("tasks");
  const draftContext = useMemo(() => (row ? buildStoreSlackDraftContext(row) : null), [row]);
  const slackSession = useMemo(() => getSlackSession(), [row]);

  const [selectedRecipientKeys, setSelectedRecipientKeys] = useState<string[]>([]);
  const [messageText, setMessageText] = useState("");
  const [sendingKey, setSendingKey] = useState("");
  const [isSendingAll, setIsSendingAll] = useState(false);
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [slackEmailMap, setSlackEmailMap] = useState<Map<string, SlackDirectoryUser>>(staticSlackMap);
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [loadingMapVerify, setLoadingMapVerify] = useState(false);
  const [localMapResult, setLocalMapResult] = useState<PreprodValidationResult | undefined>(
    row?.preprod_validation
  );

  useEffect(() => {
    setLocalMapResult(row?.preprod_validation);
  }, [row?.preprod_validation]);

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
      (r) => r.key.toLowerCase().includes("conversion") || r.label.toLowerCase().includes("conversion")
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
    (recipient) => selectedRecipientKeys.includes(recipient.key) && recipient.matchedUser?.userId
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
      onToast(`❌ ${error instanceof Error ? error.message : "Failed to send"}`);
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
      // 1. Attempt primary setup fetch
      const setupData = await fetchSetupDataForStore(row, { force: true });
      onSetupFetched(row.tekion_id, setupData);
      onToast("✅ Setup data fetched");
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : "Failed to fetch setup data";
      onToast(`⚠ Setup failed: ${errMsg}. Running 2nd automation (MAP)...`);

      // 2. Trigger fallback automation
      const candidate = row.tenant_code || (row as any).tenant_name || "";
      if (candidate) {
        try {
          const mapResult = await executePreprodMapPipeline(candidate, row.dealer_id);
          setLocalMapResult(mapResult);
          row.preprod_validation = mapResult;
          row.setup_data_error = errMsg;
          void saveStores([row]);
          onToast(
            mapResult.isValidTenant
              ? `✅ MAP 2nd Automation: ${mapResult.tenantName} (${mapResult.employeeCount} employees, ${mapResult.accountNumberCount} accts)`
              : `⚠️ MAP Validation failed: ${mapResult.validationError}`
          );
        } catch (mapErr) {
          onToast(`❌ 2nd Automation error: ${mapErr instanceof Error ? mapErr.message : "MAP failed"}`);
        }
      }
    } finally {
      setLoadingSetup(false);
    }
  };

  const handleRunPreprodMapValidation = async () => {
    if (!row) return;
    const candidate = row.tenant_code || (row as any).tenant_name || "";
    if (!candidate) {
      onToast("❌ Store has no tenant code configured");
      return;
    }
    setLoadingMapVerify(true);
    try {
      const result = await executePreprodMapPipeline(candidate, row.dealer_id);
      setLocalMapResult(result);
      row.preprod_validation = result;
      void saveStores([row]);
      if (result.isValidTenant) {
        onToast(`✅ Verified MAP: ${result.tenantName} (${result.employeeCount ?? "—"} employees, ${result.accountNumberCount ?? "—"} accounts)`);
      } else {
        onToast(`⚠️ Validation failed: ${result.validationError || "Tenant not found"}`);
      }
    } catch (err: unknown) {
      onToast(`❌ MAP Pipeline Error: ${err instanceof Error ? err.message : "Request failed"}`);
    } finally {
      setLoadingMapVerify(false);
    }
  };

  const hasSlackSession = Boolean(slackSession.slackToken && slackSession.slackDCookie);
  const resolvedProjectId = resolveStoreProjectId(row);
  const trackingId =
    row.project_implementation_tm_sync_status_tracking_id ||
    row.implementation_tm_sync_status_tracking_id ||
    row.base_entity_instance_id ||
    resolvedProjectId;
  const token = `${row.tenant_code || ""}_${row.tenant_id || ""}_${row.dealer_id || ""}`;
  const preprodSchedulingUrl = `https://preprod-conscheduling.tekioncloud.com/consumer-scheduling/sign-in/phone?accessToken=${encodeURIComponent(token)}`;
  const prodSchedulingUrl = `https://conscheduling.tekioncloud.com/consumer-scheduling/sign-in/phone?accessToken=${encodeURIComponent(token)}`;

  // Copy both URLs formatted across two distinct lines & open both in new browser tabs
  const handleOpenAndCopyConsumerLinks = () => {
    const textToCopy = `Preprod: ${preprodSchedulingUrl}\nProd: ${prodSchedulingUrl}`;
    void navigator.clipboard.writeText(textToCopy);
    window.open(preprodSchedulingUrl, "_blank", "noopener,noreferrer");
    window.open(prodSchedulingUrl, "_blank", "noopener,noreferrer");
    onToast("📋 Copied both links & opened tabs!");
  };

  const isTenantValidated = Boolean(localMapResult?.isValidTenant);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="update-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="update-modal-header">
          <div className="update-header-meta">
            <span className="update-header-title" style={{ fontSize: 18, fontWeight: 800 }}>
              {row.dba_name || "Dealership"}
            </span>
            <div className="update-header-badges">
              <span className="hud-badge accent">Dealer #{row.dealer_id}</span>
              <span className="hud-badge">Tekion ID: {row.tekion_id}</span>
            </div>
          </div>
          <button className="btn-secondary btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="update-store-hud">
          <div className="hud-telemetry-group">
            <div className="hud-telemetry-item">
              <span className="hud-label">Project:</span>
              <span className="hud-value" title={`Resolved project: ${resolvedProjectId || "None"}`}>
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
                  href={`https://tap.tekioncloud.com/workorders/details/${encodeURIComponent(trackingId)}?tab=tasks`}
                >
                  Tasks ↗
                </a>
              ) : (
                <span className="hud-value">—</span>
              )}
            </div>

            {/* Tenant HUD Item: Defaults to Slate Gray, Shifts to Green with Checkmark on MAP Verification */}
            <div className="hud-telemetry-item">
              <span className="hud-label">Tenant:</span>
              <span
                className="hud-value"
                style={{
                  color: isTenantValidated ? "#4ade80" : "#94a3b8",
                  fontWeight: isTenantValidated ? 800 : 600,
                  transition: "color 0.2s ease",
                }}
                title={isTenantValidated ? `Validated: ${localMapResult?.tenantName}` : "Not validated via MAP"}
              >
                {isTenantValidated && "✓ "}
                {row.tenant_code || "—"} ({row.tenant_id || "—"})
              </span>
            </div>

            {/* Consumer Links with 1-Click Copy Both and Simultaneous Open */}
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
              <button
                type="button"
                onClick={handleOpenAndCopyConsumerLinks}
                style={{
                  background: "rgba(56, 189, 248, 0.15)",
                  border: "1px solid rgba(56, 189, 248, 0.35)",
                  color: "#38bdf8",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: "1px 6px",
                  marginLeft: 4,
                  cursor: "pointer",
                }}
                title="Copies formatted Pre-Prod & Prod links to clipboard and opens both tabs"
              >
                📋 Copy & Open Both
              </button>
            </div>
          </div>

          <div
            className="hud-setup-strip"
            style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn-postman btn-sm"
                disabled={loadingSetup}
                onClick={() => void handleFetchSetup()}
                style={{ fontWeight: 700 }}
              >
                {loadingSetup ? "⏳ Loading..." : "🧩 Get Setup Data"}
              </button>
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={loadingMapVerify}
                onClick={() => void handleRunPreprodMapValidation()}
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  borderColor: "rgba(56, 189, 248, 0.4)",
                  color: "#38bdf8",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
                title="Run live Pre-Prod MAP verification for tenant, employees, and account numbers"
              >
                {loadingMapVerify ? "⏳ Verifying..." : "⚡ Verify MAP"}
              </button>

              {/* Supplemental MAP Counts inside HUD */}
              {localMapResult && (
                <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginLeft: 4 }}>
                  {localMapResult.employeeCount && localMapResult.employeeCount !== "—" && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#38bdf8" }}>
                      👥 {Number(localMapResult.employeeCount).toLocaleString()}
                    </span>
                  )}
                  {localMapResult.accountNumberCount !== undefined && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#c084fc" }}>
                      #️⃣ {localMapResult.accountNumberCount.toLocaleString()}
                    </span>
                  )}
                </div>
              )}
            </div>

            {row.setup_data ? (
              <span className="dealer-setup-summary">
                OEM: <strong>{row.setup_data.oemDealerCodes?.join(", ") || "—"}</strong> JRN:{" "}
                <strong>{row.setup_data.journalsAccessibleDealerCount ?? 0}</strong> SC:{" "}
                <strong>{row.setup_data.salesChainsAccessibleDealerCount ?? 0}</strong> COA:{" "}
                <strong>{row.setup_data.coaAccessibleDealerCount ?? 0}</strong>
              </span>
            ) : row.setup_data_error ? (
              <span style={{ fontSize: 11, color: "#f87171", fontWeight: 600 }}>⚠ {row.setup_data_error}</span>
            ) : (
              <span style={{ fontSize: 11, color: "#64748b" }}>Setup data not fetched yet</span>
            )}
          </div>
        </div>

        <div className="update-nav-segmented">
          <button
            type="button"
            className={`update-nav-tab ${tab === "tasks" ? "active" : ""}`}
            onClick={() => setTab("tasks")}
          >
            <span className="update-tab-dot" /> ✅ TAP Tasks
          </button>
          <button
            type="button"
            className={`update-nav-tab ${tab === "slack" ? "active" : ""}`}
            onClick={() => setTab("slack")}
          >
            <span className="update-tab-dot" /> 💬 Slack Update
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
            <div className="slack-workspace-layout" style={{ padding: "16px 20px 20px 20px" }}>
              <div className="slack-recipients-card">
                <div className="slack-card-header">
                  <span className="slack-card-title">Recipients ({selectedRecipients.length})</span>
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
                  <div className="slack-editor-preview">{messageText || "Empty draft."}</div>
                )}
                <div className="slack-submit-wrap">
                  <button
                    type="button"
                    className="btn-postman"
                    disabled={!hasSlackSession || selectedRecipients.length === 0 || isSendingAll}
                    onClick={() => void handleSendAll()}
                  >
                    {isSendingAll ? "⏳ Dispatched..." : `Send to Selected (${selectedRecipients.length})`}
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