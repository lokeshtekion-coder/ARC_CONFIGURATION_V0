import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useMemo, useEffect } from "react";
import { resolveStoreProjectId, saveStores } from "../../services/storesDb";
import { buildStoreSlackDraftContext, getSlackSession, sendSlackMessage, } from "../../services/storeSlackHelper";
import { fetchSetupDataForStore } from "../../services/storeSetupDataService";
import { executePreprodMapPipeline, } from "../../services/preprodMapApiService";
import DealerTasksPanel from "../DealerTasksPanel";
const SlackRecipientRow = ({ candidate, checked, onToggle }) => {
    const isAvailable = Boolean(candidate.matchedUser?.userId);
    return (_jsxs("label", { className: "slack-recipient-row", children: [_jsx("input", { type: "checkbox", checked: checked, disabled: !isAvailable, onChange: onToggle }), _jsxs("div", { style: { minWidth: 0, flex: 1 }, children: [_jsxs("div", { children: [_jsx("span", { children: candidate.label }), " ", _jsxs("span", { style: { color: "#94a3b8" }, children: ["(", candidate.matchedUser?.fullName || "Not found", ")"] })] }), _jsx("div", { style: { color: "#64748b", fontSize: 11 }, children: candidate.normalizedEmail || candidate.matchedUser?.userId || "No ID" })] })] }));
};
export const DealerMetaModal = ({ row, onClose, onToast, onSetupFetched, onTaskOperationalStatusChange, onTasksSnapshot, staticSlackMap, }) => {
    const [tab, setTab] = useState("tasks");
    const draftContext = useMemo(() => (row ? buildStoreSlackDraftContext(row) : null), [row]);
    const slackSession = useMemo(() => getSlackSession(), [row]);
    const [selectedRecipientKeys, setSelectedRecipientKeys] = useState([]);
    const [messageText, setMessageText] = useState("");
    const [sendingKey, setSendingKey] = useState("");
    const [isSendingAll, setIsSendingAll] = useState(false);
    const [editorMode, setEditorMode] = useState("edit");
    const [slackEmailMap, setSlackEmailMap] = useState(staticSlackMap);
    const [loadingSetup, setLoadingSetup] = useState(false);
    const [loadingMapVerify, setLoadingMapVerify] = useState(false);
    const [localMapResult, setLocalMapResult] = useState(row?.preprod_validation);
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
        if (!draftContext)
            return [];
        const recipients = [...draftContext.recipients];
        const hasConversion = recipients.some((r) => r.key.toLowerCase().includes("conversion") || r.label.toLowerCase().includes("conversion"));
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
    if (!row || !draftContext)
        return null;
    const selectedRecipients = allRecipients.filter((recipient) => selectedRecipientKeys.includes(recipient.key) && recipient.matchedUser?.userId);
    const handleToggleRecipient = (key) => {
        setSelectedRecipientKeys((prev) => prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]);
    };
    const handleSendSingle = async (recipient) => {
        if (!recipient.matchedUser?.userId)
            return;
        setSendingKey(recipient.key);
        try {
            await sendSlackMessage({
                userId: recipient.matchedUser.userId,
                email: recipient.matchedUser.email,
                fullName: recipient.matchedUser.fullName,
                text: messageText,
            });
            onToast(`✅ Sent to ${recipient.matchedUser.fullName}`);
        }
        catch (error) {
            onToast(`❌ ${error instanceof Error ? error.message : "Failed to send"}`);
        }
        finally {
            setSendingKey("");
        }
    };
    const handleSendAll = async () => {
        if (selectedRecipients.length === 0)
            return;
        setIsSendingAll(true);
        let successCount = 0;
        let failCount = 0;
        for (const recipient of selectedRecipients) {
            if (!recipient.matchedUser?.userId)
                continue;
            try {
                await sendSlackMessage({
                    userId: recipient.matchedUser.userId,
                    email: recipient.matchedUser.email,
                    fullName: recipient.matchedUser.fullName,
                    text: messageText,
                });
                successCount++;
            }
            catch {
                failCount++;
            }
        }
        setIsSendingAll(false);
        if (failCount === 0) {
            onToast(`✅ Successfully dispatched message to ${successCount} recipient(s)`);
        }
        else {
            onToast(`⚠ Sent ${successCount}, failed ${failCount}`);
        }
    };
    const handleFetchSetup = async () => {
        if (!row)
            return;
        setLoadingSetup(true);
        try {
            // 1. Attempt primary setup fetch
            const setupData = await fetchSetupDataForStore(row, { force: true });
            onSetupFetched(row.tekion_id, setupData);
            onToast("✅ Setup data fetched");
        }
        catch (error) {
            const errMsg = error instanceof Error ? error.message : "Failed to fetch setup data";
            onToast(`⚠ Setup failed: ${errMsg}. Running 2nd automation (MAP)...`);
            // 2. Trigger fallback automation
            const candidate = row.tenant_code || row.tenant_name || "";
            if (candidate) {
                try {
                    const mapResult = await executePreprodMapPipeline(candidate, row.dealer_id);
                    setLocalMapResult(mapResult);
                    row.preprod_validation = mapResult;
                    row.setup_data_error = errMsg;
                    void saveStores([row]);
                    onToast(mapResult.isValidTenant
                        ? `✅ MAP 2nd Automation: ${mapResult.tenantName} (${mapResult.employeeCount} employees, ${mapResult.accountNumberCount} accts)`
                        : `⚠️ MAP Validation failed: ${mapResult.validationError}`);
                }
                catch (mapErr) {
                    onToast(`❌ 2nd Automation error: ${mapErr instanceof Error ? mapErr.message : "MAP failed"}`);
                }
            }
        }
        finally {
            setLoadingSetup(false);
        }
    };
    const handleRunPreprodMapValidation = async () => {
        if (!row)
            return;
        const candidate = row.tenant_code || row.tenant_name || "";
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
            }
            else {
                onToast(`⚠️ Validation failed: ${result.validationError || "Tenant not found"}`);
            }
        }
        catch (err) {
            onToast(`❌ MAP Pipeline Error: ${err instanceof Error ? err.message : "Request failed"}`);
        }
        finally {
            setLoadingMapVerify(false);
        }
    };
    const hasSlackSession = Boolean(slackSession.slackToken && slackSession.slackDCookie);
    const resolvedProjectId = resolveStoreProjectId(row);
    const trackingId = row.project_implementation_tm_sync_status_tracking_id ||
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
    return (_jsx("div", { className: "modal-overlay", onClick: onClose, children: _jsxs("div", { className: "update-modal-dialog", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "update-modal-header", children: [_jsxs("div", { className: "update-header-meta", children: [_jsx("span", { className: "update-header-title", style: { fontSize: 18, fontWeight: 800 }, children: row.dba_name || "Dealership" }), _jsxs("div", { className: "update-header-badges", children: [_jsxs("span", { className: "hud-badge accent", children: ["Dealer #", row.dealer_id] }), _jsxs("span", { className: "hud-badge", children: ["Tekion ID: ", row.tekion_id] })] })] }), _jsx("button", { className: "btn-secondary btn-sm", onClick: onClose, children: "\u2715" })] }), _jsxs("div", { className: "update-store-hud", children: [_jsxs("div", { className: "hud-telemetry-group", children: [_jsxs("div", { className: "hud-telemetry-item", children: [_jsx("span", { className: "hud-label", children: "Project:" }), _jsx("span", { className: "hud-value", title: `Resolved project: ${resolvedProjectId || "None"}`, children: resolvedProjectId || "—" })] }), _jsxs("div", { className: "hud-telemetry-item", children: [_jsx("span", { className: "hud-label", children: "Tracking:" }), trackingId ? (_jsx("a", { className: "tracking-link-tag", target: "_blank", rel: "noreferrer", href: `https://tap.tekioncloud.com/workorders/details/${encodeURIComponent(trackingId)}?tab=tasks`, children: "Tasks \u2197" })) : (_jsx("span", { className: "hud-value", children: "\u2014" }))] }), _jsxs("div", { className: "hud-telemetry-item", children: [_jsx("span", { className: "hud-label", children: "Tenant:" }), _jsxs("span", { className: "hud-value", style: {
                                                color: isTenantValidated ? "#4ade80" : "#94a3b8",
                                                fontWeight: isTenantValidated ? 800 : 600,
                                                transition: "color 0.2s ease",
                                            }, title: isTenantValidated ? `Validated: ${localMapResult?.tenantName}` : "Not validated via MAP", children: [isTenantValidated && "✓ ", row.tenant_code || "—", " (", row.tenant_id || "—", ")"] })] }), _jsxs("div", { className: "hud-telemetry-item", children: [_jsx("span", { className: "hud-label", children: "Consumer:" }), _jsx("a", { href: preprodSchedulingUrl, target: "_blank", rel: "noreferrer", style: { color: "#38bdf8", textDecoration: "none", fontSize: 11 }, children: "Pre-Prod \u2197" }), _jsx("span", { style: { color: "#475569" }, children: "\u2022" }), _jsx("a", { href: prodSchedulingUrl, target: "_blank", rel: "noreferrer", style: { color: "#4ade80", textDecoration: "none", fontSize: 11 }, children: "Prod \u2197" }), _jsx("button", { type: "button", onClick: handleOpenAndCopyConsumerLinks, style: {
                                                background: "rgba(56, 189, 248, 0.15)",
                                                border: "1px solid rgba(56, 189, 248, 0.35)",
                                                color: "#38bdf8",
                                                borderRadius: 4,
                                                fontSize: 10,
                                                fontWeight: 700,
                                                padding: "1px 6px",
                                                marginLeft: 4,
                                                cursor: "pointer",
                                            }, title: "Copies formatted Pre-Prod & Prod links to clipboard and opens both tabs", children: "\uD83D\uDCCB Copy & Open Both" })] })] }), _jsxs("div", { className: "hud-setup-strip", style: { marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-postman btn-sm", disabled: loadingSetup, onClick: () => void handleFetchSetup(), style: { fontWeight: 700 }, children: loadingSetup ? "⏳ Loading..." : "🧩 Get Setup Data" }), _jsx("button", { type: "button", className: "btn-secondary btn-sm", disabled: loadingMapVerify, onClick: () => void handleRunPreprodMapValidation(), style: {
                                                fontSize: 11,
                                                padding: "3px 8px",
                                                borderColor: "rgba(56, 189, 248, 0.4)",
                                                color: "#38bdf8",
                                                fontWeight: 700,
                                                cursor: "pointer",
                                            }, title: "Run live Pre-Prod MAP verification for tenant, employees, and account numbers", children: loadingMapVerify ? "⏳ Verifying..." : "⚡ Verify MAP" }), localMapResult && (_jsxs("div", { style: { display: "inline-flex", alignItems: "center", gap: 10, marginLeft: 4 }, children: [localMapResult.employeeCount && localMapResult.employeeCount !== "—" && (_jsxs("span", { style: { fontSize: 11, fontWeight: 700, color: "#38bdf8" }, children: ["\uD83D\uDC65 ", Number(localMapResult.employeeCount).toLocaleString()] })), localMapResult.accountNumberCount !== undefined && (_jsxs("span", { style: { fontSize: 11, fontWeight: 700, color: "#c084fc" }, children: ["#\uFE0F\u20E3 ", localMapResult.accountNumberCount.toLocaleString()] }))] }))] }), row.setup_data ? (_jsxs("span", { className: "dealer-setup-summary", children: ["OEM: ", _jsx("strong", { children: row.setup_data.oemDealerCodes?.join(", ") || "—" }), " JRN:", " ", _jsx("strong", { children: row.setup_data.journalsAccessibleDealerCount ?? 0 }), " SC:", " ", _jsx("strong", { children: row.setup_data.salesChainsAccessibleDealerCount ?? 0 }), " COA:", " ", _jsx("strong", { children: row.setup_data.coaAccessibleDealerCount ?? 0 })] })) : row.setup_data_error ? (_jsxs("span", { style: { fontSize: 11, color: "#f87171", fontWeight: 600 }, children: ["\u26A0 ", row.setup_data_error] })) : (_jsx("span", { style: { fontSize: 11, color: "#64748b" }, children: "Setup data not fetched yet" }))] })] }), _jsxs("div", { className: "update-nav-segmented", children: [_jsxs("button", { type: "button", className: `update-nav-tab ${tab === "tasks" ? "active" : ""}`, onClick: () => setTab("tasks"), children: [_jsx("span", { className: "update-tab-dot" }), " \u2705 TAP Tasks"] }), _jsxs("button", { type: "button", className: `update-nav-tab ${tab === "slack" ? "active" : ""}`, onClick: () => setTab("slack"), children: [_jsx("span", { className: "update-tab-dot" }), " \uD83D\uDCAC Slack Update"] })] }), _jsxs("div", { style: { overflowY: "auto", flex: 1 }, children: [tab === "tasks" && (_jsx(DealerTasksPanel, { row: row, onToast: onToast, onOperationalStatusChange: onTaskOperationalStatusChange, onTasksSnapshot: onTasksSnapshot })), tab === "slack" && (_jsxs("div", { className: "slack-workspace-layout", style: { padding: "16px 20px 20px 20px" }, children: [_jsxs("div", { className: "slack-recipients-card", children: [_jsxs("div", { className: "slack-card-header", children: [_jsxs("span", { className: "slack-card-title", children: ["Recipients (", selectedRecipients.length, ")"] }), _jsx("span", { className: `slack-session-badge ${hasSlackSession ? "slack-session-active" : "slack-session-inactive"}`, children: hasSlackSession ? "Session Active" : "No Session" })] }), _jsx("div", { style: { display: "grid", gap: 6 }, children: allRecipients.map((recipient) => (_jsx(SlackRecipientRow, { candidate: recipient, checked: selectedRecipientKeys.includes(recipient.key), onToggle: () => handleToggleRecipient(recipient.key) }, recipient.key))) }), _jsxs("div", { className: "slack-dispatches-wrap", children: ["Individual Dispatches:", _jsx("div", { children: selectedRecipients.map((rec) => (_jsxs("div", { className: "slack-dispatch-item", children: [_jsx("span", { children: rec.matchedUser?.fullName }), _jsx("button", { type: "button", className: "btn-secondary btn-sm", disabled: !hasSlackSession || sendingKey === rec.key || isSendingAll, onClick: () => void handleSendSingle(rec), children: sendingKey === rec.key ? "..." : "Send" })] }, rec.key))) })] })] }), _jsxs("div", { className: "slack-draft-card", children: [_jsxs("div", { className: "slack-card-header", children: [_jsx("span", { className: "slack-card-title", children: "Slack Message Draft" }), _jsxs("div", { className: "slack-toggle-group", children: [_jsx("button", { type: "button", onClick: () => setEditorMode("edit"), children: "Edit" }), _jsx("button", { type: "button", onClick: () => setEditorMode("preview"), children: "Preview" })] })] }), editorMode === "edit" ? (_jsx("textarea", { className: "composer-textarea", style: { minHeight: 220 }, value: messageText, onChange: (e) => setMessageText(e.target.value) })) : (_jsx("div", { className: "slack-editor-preview", children: messageText || "Empty draft." })), _jsx("div", { className: "slack-submit-wrap", children: _jsx("button", { type: "button", className: "btn-postman", disabled: !hasSlackSession || selectedRecipients.length === 0 || isSendingAll, onClick: () => void handleSendAll(), children: isSendingAll ? "⏳ Dispatched..." : `Send to Selected (${selectedRecipients.length})` }) })] })] }))] })] }) }));
};
