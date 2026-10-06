import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../services/tekionApiSettings";
const SAVE_URL = "https://preprodapp.tekioncloud.com/api/retail/sales/u/sales/settings/v1.0.0/sales/mandatoryFieldRules/save?locale=en_US";
const logger = {
    info: (...args) => console.info("[Accounting][FieldRulesSetup]", ...args),
    warn: (...args) => console.warn("[Accounting][FieldRulesSetup]", ...args),
    error: (...args) => console.error("[Accounting][FieldRulesSetup]", ...args),
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
const FieldRulesSetup = () => {
    const [running, setRunning] = useState(false);
    const [message, setMessage] = useState(null);
    const [lastPayload, setLastPayload] = useState(null);
    const [lastResponse, setLastResponse] = useState(null);
    const [showPayload, setShowPayload] = useState(false);
    const [showResponse, setShowResponse] = useState(false);
    const enabledHeaders = useMemo(() => toEnabledHeaderMap(loadGlobalHeaders()), []);
    const dealerId = useMemo(() => extractDealerIdFromHeaders(enabledHeaders), [enabledHeaders]);
    const headerCount = Object.keys(enabledHeaders).length;
    const buildPayload = () => {
        return {
            mandatoryFieldActions: [
                {
                    id: "MRT64WJ75RNJJ",
                    fields: [
                        { displayName: "Salesperson", key: "SALES_PERSON" },
                        { displayName: "Sales Manager", key: "SALES_MANAGER" },
                        { displayName: "F&I Manager", key: "F_N_I_MANAGER" },
                    ],
                    action: "MARK_AS_MANDATORY",
                },
            ],
            mandatoryFieldConditions: [
                {
                    id: "MRT64WJ7IF6Q8",
                    key: "DEAL_TYPE",
                    operator: "PRESENT",
                    value: ["PERSONAL", "BUSINESS"],
                },
            ],
            mandatoryFieldSituations: [
                {
                    id: "MRT64WJ7FVNNJ",
                    situation: "STATUS_CHANGE",
                    value: "FINANCE_AND_INSURANCE",
                },
            ],
            status: "ACTIVE",
            displayName: "Assignee",
        };
    };
    const runAutomation = async () => {
        setRunning(true);
        setMessage(null);
        setLastResponse(null);
        try {
            if (!dealerId) {
                throw new Error("Dealer ID not found in Global Headers. Please select/apply dealer headers in Settings first.");
            }
            if (headerCount === 0) {
                throw new Error("No active Global Headers found.");
            }
            const payload = buildPayload();
            setLastPayload(payload);
            logger.info("field rules save started", {
                dealerId,
                url: SAVE_URL,
                headerKeys: Object.keys(enabledHeaders),
                payload,
            });
            const requestHeaders = {
                ...enabledHeaders,
                "content-type": "application/json",
            };
            const response = await fetch("http://localhost:4000/api/proxy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: SAVE_URL,
                    method: "POST",
                    headers: requestHeaders,
                    body: payload,
                    timeout: 60000,
                }),
            });
            if (!response.ok) {
                throw new Error(`Proxy request failed with HTTP ${response.status}`);
            }
            const json = await response.json();
            logger.info("field rules save raw response", json);
            if ((json?.status ?? 200) >= 400) {
                throw new Error(`${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim());
            }
            const body = json?.body ?? json?.data ?? json;
            setLastResponse(body);
            setMessage({
                ok: true,
                text: "Field Rules Setup saved successfully.",
            });
        }
        catch (error) {
            logger.error("field rules save failed", error);
            setMessage({
                ok: false,
                text: error instanceof Error ? error.message : "Field Rules Setup failed",
            });
        }
        finally {
            setRunning(false);
        }
    };
    return (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 22, fontWeight: 800, marginBottom: 6 }, children: "Field Rules Setup" }), _jsx("div", { style: { color: "#94a3b8", fontSize: 14, lineHeight: 1.7 }, children: "Configure mandatory sales field rules using Global Headers from Settings." }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }, children: [_jsxs("span", { style: pillStyle, children: ["Dealer ID", _jsx("b", { style: { color: dealerId ? "#f8fafc" : "#fca5a5" }, children: dealerId || "Not found" })] }), _jsxs("span", { style: pillStyle, children: ["Global Headers", _jsx("b", { style: { color: "#f8fafc" }, children: headerCount })] }), _jsxs("span", { style: pillStyle, children: ["Display Name", _jsx("b", { style: { color: "#f8fafc" }, children: "Assignee" })] })] })] }), _jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 18, fontWeight: 800, marginBottom: 8 }, children: "Automation Summary" }), _jsxs("div", { style: { color: "#cbd5e1", fontSize: 13, lineHeight: 1.8 }, children: [_jsx("div", { children: "\u2022 Marks fields as mandatory: Salesperson, Sales Manager, F&I Manager" }), _jsx("div", { children: "\u2022 Applies when Deal Type is: PERSONAL or BUSINESS" }), _jsx("div", { children: "\u2022 Applies on situation: STATUS_CHANGE \u2192 FINANCE_AND_INSURANCE" }), _jsx("div", { children: "\u2022 Saves with status: ACTIVE" })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }, children: [_jsx("button", { className: "btn-postman", type: "button", onClick: () => void runAutomation(), disabled: running, children: running ? "Running..." : "⚙ Run Field Rules Automation" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => setShowPayload((prev) => !prev), children: showPayload ? "Hide Payload" : "Show Payload" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => setShowResponse((prev) => !prev), disabled: !lastResponse, children: showResponse ? "Hide Response" : "Show Response" })] }), message ? (_jsx("div", { style: {
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
                        }, children: message.text })) : null] }), showPayload ? (_jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }, children: "Request Payload" }), _jsx("pre", { style: {
                            margin: 0,
                            padding: 12,
                            borderRadius: 12,
                            background: "#0f172a",
                            color: "#e2e8f0",
                            overflow: "auto",
                            fontSize: 12,
                        }, children: JSON.stringify(lastPayload ?? buildPayload(), null, 2) })] })) : null, showResponse && lastResponse ? (_jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }, children: "Response" }), _jsx("pre", { style: {
                            margin: 0,
                            padding: 12,
                            borderRadius: 12,
                            background: "#0f172a",
                            color: "#e2e8f0",
                            overflow: "auto",
                            fontSize: 12,
                        }, children: JSON.stringify(lastResponse, null, 2) })] })) : null] }));
};
export default FieldRulesSetup;
