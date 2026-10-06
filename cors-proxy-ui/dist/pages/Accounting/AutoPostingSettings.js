import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../services/tekionApiSettings";
const WORKFLOW_URL = "https://preprodapp.tekioncloud.com/api/accounting/u/autoPostingSettings/workflow/posting-options";
const logger = {
    info: (...args) => console.info("[Accounting][AutoPostingSettings]", ...args),
    warn: (...args) => console.warn("[Accounting][AutoPostingSettings]", ...args),
    error: (...args) => console.error("[Accounting][AutoPostingSettings]", ...args),
};
const cardStyle = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: 18,
};
const pillStyle = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    color: "#cbd5e1",
    fontSize: 12,
};
function normalize(value) {
    return String(value ?? "").trim();
}
function toEnabledHeaderMap(headers) {
    const out = {};
    for (const row of headers) {
        if (!row?.enabled)
            continue;
        const key = normalize(row.key);
        const value = normalize(row.value);
        if (!key || !value)
            continue;
        out[key] = value;
    }
    return out;
}
function extractDealerIdFromHeaders(headers) {
    const candidates = ["dealerid", "dealerId", "dealer-id", "x-dealer-id"];
    const entries = Object.entries(headers);
    for (const candidate of candidates) {
        const hit = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
        if (hit?.[1])
            return normalize(hit[1]);
    }
    return "";
}
function buildPostingStatus(workflow, subSection) {
    const current = workflow.postingStatus;
    if (current === "NONE")
        return "NONE";
    if (current === "AUTO_POST")
        return "AUTO_POST";
    if (current === "CREATE_DRAFT")
        return "CREATE_DRAFT";
    const options = Array.isArray(subSection.postingOptions) ? subSection.postingOptions : [];
    if (options.includes("CREATE_DRAFT"))
        return "CREATE_DRAFT";
    if (options.includes("AUTO_POST"))
        return "AUTO_POST";
    if (options.includes("NONE"))
        return "NONE";
    return current ?? null;
}
function buildSubWorkflowPostingStatus(subWorkflow) {
    if (subWorkflow.postingStatus === "NONE")
        return "NONE";
    if (subWorkflow.postingStatus === "AUTO_POST")
        return "AUTO_POST";
    if (subWorkflow.postingStatus === "CREATE_DRAFT")
        return "CREATE_DRAFT";
    return subWorkflow.postingStatus ?? null;
}
function buildPayloadFromResponse(input) {
    const sections = Array.isArray(input?.data?.sections) ? input.data.sections : [];
    return {
        sections: sections
            .filter((section) => normalize(section.label))
            .map((section) => ({
            label: normalize(section.label),
            subSections: (Array.isArray(section.subSections) ? section.subSections : [])
                .filter((subSection) => normalize(subSection.label))
                .map((subSection) => ({
                label: normalize(subSection.label),
                workflows: (Array.isArray(subSection.workflows) ? subSection.workflows : [])
                    .filter((workflow) => normalize(workflow.label))
                    .map((workflow) => ({
                    label: normalize(workflow.label),
                    postingStatus: buildPostingStatus(workflow, subSection),
                    subWorkflows: Array.isArray(workflow.subWorkflows)
                        ? workflow.subWorkflows
                            .filter((subWorkflow) => normalize(subWorkflow.label))
                            .map((subWorkflow) => ({
                            label: normalize(subWorkflow.label),
                            postingStatus: buildSubWorkflowPostingStatus(subWorkflow),
                        }))
                        : null,
                })),
            })),
        })),
    };
}
function getVisibleStats(input) {
    const sections = Array.isArray(input?.data?.sections) ? input.data.sections : [];
    let visibleSubSections = 0;
    let visibleWorkflows = 0;
    let hiddenSubSections = 0;
    let hiddenWorkflows = 0;
    for (const section of sections) {
        for (const subSection of section.subSections ?? []) {
            if (subSection.hidden)
                hiddenSubSections += 1;
            else
                visibleSubSections += 1;
            for (const workflow of subSection.workflows ?? []) {
                if (workflow.hidden)
                    hiddenWorkflows += 1;
                else
                    visibleWorkflows += 1;
            }
        }
    }
    return {
        sectionCount: sections.length,
        visibleSubSections,
        hiddenSubSections,
        visibleWorkflows,
        hiddenWorkflows,
    };
}
const AutoPostingSettings = () => {
    const [loading, setLoading] = useState(false);
    const [running, setRunning] = useState(false);
    const [message, setMessage] = useState(null);
    const [fetchedResponse, setFetchedResponse] = useState(null);
    const [builtPayload, setBuiltPayload] = useState(null);
    const [lastPostResponse, setLastPostResponse] = useState(null);
    const [showGetResponse, setShowGetResponse] = useState(false);
    const [showPayload, setShowPayload] = useState(false);
    const [showPostResponse, setShowPostResponse] = useState(false);
    const enabledHeaders = useMemo(() => toEnabledHeaderMap(loadGlobalHeaders()), []);
    const dealerId = useMemo(() => extractDealerIdFromHeaders(enabledHeaders), [enabledHeaders]);
    const headerCount = Object.keys(enabledHeaders).length;
    const stats = useMemo(() => (fetchedResponse ? getVisibleStats(fetchedResponse) : null), [fetchedResponse]);
    const proxyRequest = async (payload) => {
        const response = await fetch("http://localhost:4000/api/proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url: payload.url,
                method: payload.method,
                headers: {
                    ...enabledHeaders,
                    ...(payload.body ? { "content-type": "application/json" } : {}),
                },
                body: payload.body,
                timeout: 60000,
            }),
        });
        if (!response.ok) {
            throw new Error(`Proxy request failed with HTTP ${response.status}`);
        }
        const json = await response.json();
        if ((json?.status ?? 200) >= 400) {
            throw new Error(`${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim());
        }
        return json?.body ?? json?.data ?? json;
    };
    const runGet = async () => {
        setLoading(true);
        setMessage(null);
        try {
            if (!dealerId) {
                throw new Error("Dealer ID not found in Global Headers. Please select/apply dealer headers in Settings first.");
            }
            const body = (await proxyRequest({
                url: WORKFLOW_URL,
                method: "GET",
            }));
            const payload = buildPayloadFromResponse(body);
            setFetchedResponse(body);
            setBuiltPayload(payload);
            setLastPostResponse(null);
            logger.info("auto posting GET succeeded", {
                dealerId,
                body,
                payload,
            });
            setMessage({
                ok: true,
                text: "Fetched auto posting settings and built payload successfully.",
            });
        }
        catch (error) {
            logger.error("auto posting GET failed", error);
            setMessage({
                ok: false,
                text: error instanceof Error ? error.message : "Failed to fetch auto posting settings",
            });
        }
        finally {
            setLoading(false);
        }
    };
    const runPost = async () => {
        setRunning(true);
        setMessage(null);
        try {
            if (!dealerId) {
                throw new Error("Dealer ID not found in Global Headers. Please select/apply dealer headers in Settings first.");
            }
            let sourceResponse = fetchedResponse;
            let payload = builtPayload;
            if (!sourceResponse || !payload) {
                const body = (await proxyRequest({
                    url: WORKFLOW_URL,
                    method: "GET",
                }));
                sourceResponse = body;
                payload = buildPayloadFromResponse(body);
                setFetchedResponse(body);
                setBuiltPayload(payload);
            }
            logger.info("auto posting POST started", {
                dealerId,
                payload,
            });
            const postResponse = await proxyRequest({
                url: WORKFLOW_URL,
                method: "POST",
                body: payload,
            });
            setLastPostResponse(postResponse);
            logger.info("auto posting POST succeeded", {
                dealerId,
                postResponse,
            });
            setMessage({
                ok: true,
                text: "Auto Posting Settings saved successfully.",
            });
        }
        catch (error) {
            logger.error("auto posting POST failed", error);
            setMessage({
                ok: false,
                text: error instanceof Error ? error.message : "Failed to save auto posting settings",
            });
        }
        finally {
            setRunning(false);
        }
    };
    return (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsx("div", { style: cardStyle, children: _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }, children: [_jsxs("span", { style: pillStyle, children: ["Dealer ID", _jsx("b", { style: { color: dealerId ? "#f8fafc" : "#fca5a5" }, children: dealerId || "Not found" })] }), _jsxs("span", { style: pillStyle, children: ["Global Headers", _jsx("b", { style: { color: "#f8fafc" }, children: headerCount })] }), _jsxs("span", { style: pillStyle, children: ["API", _jsx("b", { style: { color: "#f8fafc" }, children: "workflow/posting-options" })] })] }) }), _jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 18, fontWeight: 800, marginBottom: 8 }, children: "Automation Rules" }), _jsxs("div", { style: { color: "#cbd5e1", fontSize: 13, lineHeight: 1.8 }, children: [_jsx("div", { children: "\u2022 Uses GET response as the single source of truth for each dealer" }), _jsx("div", { children: "\u2022 Builds POST payload dynamically from returned sections / subSections / workflows" }), _jsx("div", { children: "\u2022 Preserves labels and subWorkflow structure from the dealer response" }), _jsx("div", { children: "\u2022 Uses current postingStatus when available" }), _jsx("div", { children: "\u2022 Falls back safely based on postingOptions when postingStatus is null" }), _jsx("div", { children: "\u2022 Hidden items are not used for decision logic, but payload structure remains dealer-driven" })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }, children: [_jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => void runGet(), disabled: loading, children: loading ? "Loading..." : "▶ Fetch Current Settings" }), _jsx("button", { className: "btn-postman", type: "button", onClick: () => void runPost(), disabled: running, children: running ? "Running..." : "⚙ Save Auto Posting Settings" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => setShowGetResponse((prev) => !prev), disabled: !fetchedResponse, children: showGetResponse ? "Hide GET Response" : "Show GET Response" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => setShowPayload((prev) => !prev), disabled: !builtPayload, children: showPayload ? "Hide Payload" : "Show Payload" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => setShowPostResponse((prev) => !prev), disabled: !lastPostResponse, children: showPostResponse ? "Hide POST Response" : "Show POST Response" })] }), message ? (_jsx("div", { style: {
                            marginTop: 16,
                            borderRadius: 14,
                            padding: "10px 12px",
                            fontSize: 13,
                            border: message.ok
                                ? "1px solid rgba(34,197,94,0.22)"
                                : "1px solid rgba(239,68,68,0.22)",
                            background: message.ok
                                ? "rgba(34,197,94,0.10)"
                                : "rgba(239,68,68,0.10)",
                            color: message.ok ? "#bbf7d0" : "#fecaca",
                        }, children: message.text })) : null] }), stats ? (_jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }, children: "Current Dealer Structure Summary" }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsxs("span", { style: pillStyle, children: ["Sections ", _jsx("b", { style: { color: "#f8fafc" }, children: stats.sectionCount })] }), _jsxs("span", { style: pillStyle, children: ["Visible SubSections ", _jsx("b", { style: { color: "#86efac" }, children: stats.visibleSubSections })] }), _jsxs("span", { style: pillStyle, children: ["Hidden SubSections ", _jsx("b", { style: { color: "#fcd34d" }, children: stats.hiddenSubSections })] }), _jsxs("span", { style: pillStyle, children: ["Visible Workflows ", _jsx("b", { style: { color: "#86efac" }, children: stats.visibleWorkflows })] }), _jsxs("span", { style: pillStyle, children: ["Hidden Workflows ", _jsx("b", { style: { color: "#fcd34d" }, children: stats.hiddenWorkflows })] })] })] })) : null, showGetResponse && fetchedResponse ? (_jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }, children: "GET Response" }), _jsx("pre", { style: {
                            margin: 0,
                            padding: 12,
                            borderRadius: 12,
                            background: "#0f172a",
                            color: "#e2e8f0",
                            overflow: "auto",
                            fontSize: 12,
                        }, children: JSON.stringify(fetchedResponse, null, 2) })] })) : null, showPayload && builtPayload ? (_jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }, children: "Built POST Payload" }), _jsx("pre", { style: {
                            margin: 0,
                            padding: 12,
                            borderRadius: 12,
                            background: "#0f172a",
                            color: "#e2e8f0",
                            overflow: "auto",
                            fontSize: 12,
                        }, children: JSON.stringify(builtPayload, null, 2) })] })) : null, showPostResponse && lastPostResponse ? (_jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }, children: "POST Response" }), _jsx("pre", { style: {
                            margin: 0,
                            padding: 12,
                            borderRadius: 12,
                            background: "#0f172a",
                            color: "#e2e8f0",
                            overflow: "auto",
                            fontSize: 12,
                        }, children: JSON.stringify(lastPostResponse, null, 2) })] })) : null] }));
};
export default AutoPostingSettings;
