import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { loadGlobalHeaders, } from "../../../services/tekionApiSettings";
import { TGPT_TOKEN_KEY, TGPT_BASE, MASTER_PROMPT } from "./constants";
import { useServiceBlueprint } from "../../../Context/Blueprint_Service_Context";
const COUPON_CREATE_URL = "https://preprodapp.tekioncloud.com/api/service-module/u/coupon?locale=en_US";
const BLUEPRINT_QUESTION_KEY = 'Please list all discounts (put "None" if you don\'t use discounts)';
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
function findHeaderValueCaseInsensitive(headers, candidates) {
    const entries = Object.entries(headers);
    for (const candidate of candidates) {
        const found = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
        if (found?.[1])
            return normalize(found[1]);
    }
    return "";
}
function extractDealerIdFromHeaders(headers) {
    return findHeaderValueCaseInsensitive(headers, [
        "dealerid",
        "dealerId",
        "dealer-id",
        "x-dealer-id",
    ]);
}
const CouponsView = () => {
    const { getAnswer, hasBlueprint, loading: blueprintLoading } = useServiceBlueprint();
    const [token, setToken] = useState("");
    const [draftToken, setDraftToken] = useState("");
    const [inputText, setInputText] = useState("");
    const [parsedData, setParsedData] = useState([]);
    const [unclassifiedData, setUnclassifiedData] = useState([]);
    const [copySuccess, setCopySuccess] = useState(false);
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [loadingText, setLoadingText] = useState("");
    const [isPushing, setIsPushing] = useState(false);
    const [message, setMessage] = useState(null);
    // Extract raw discount text from Service Blueprint
    const rawBlueprintValue = useMemo(() => {
        if (!hasBlueprint)
            return "";
        const ans = getAnswer(BLUEPRINT_QUESTION_KEY);
        if (ans === undefined || ans === null)
            return "";
        if (typeof ans === "string")
            return ans.trim();
        if (Array.isArray(ans))
            return ans.join("\n");
        if (typeof ans === "object")
            return JSON.stringify(ans, null, 2);
        return String(ans).trim();
    }, [hasBlueprint, getAnswer]);
    // Pre-fill input once blueprint answer is resolved
    useEffect(() => {
        if (rawBlueprintValue && !inputText) {
            setInputText(rawBlueprintValue);
        }
    }, [rawBlueprintValue, inputText]);
    useEffect(() => {
        const saved = localStorage.getItem(TGPT_TOKEN_KEY);
        if (saved)
            setToken(saved);
    }, []);
    const enabledHeaders = useMemo(() => toEnabledHeaderMap(loadGlobalHeaders()), []);
    const dealerId = useMemo(() => extractDealerIdFromHeaders(enabledHeaders), [enabledHeaders]);
    const globalHeaderCount = useMemo(() => Object.keys(enabledHeaders).length, [enabledHeaders]);
    const handleSaveToken = () => {
        if (!draftToken.trim())
            return;
        localStorage.setItem(TGPT_TOKEN_KEY, draftToken.trim());
        setToken(draftToken.trim());
    };
    const handleAIParse = async () => {
        if (!inputText.trim() || !token)
            return;
        setIsAiLoading(true);
        setLoadingText("Initializing TGPT...");
        setUnclassifiedData([]);
        setMessage(null);
        try {
            const createRes = await fetch(`${TGPT_BASE}/conversations`, {
                method: "POST",
                headers: {
                    accept: "application/json",
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    model: "gpt-5.4",
                    title: "Coupon Parsing Workflow",
                    is_temporary: true,
                    thinking: false,
                }),
            });
            if (!createRes.ok) {
                throw new Error("Failed to create TGPT conversation. Token might be invalid.");
            }
            const { id: convId } = await createRes.json();
            setLoadingText("Extracting Data...");
            const payload = {
                content: MASTER_PROMPT + inputText,
                attachments: [],
                thinking: false,
                web_search_enabled: false,
                code_execution_enabled: false,
                artifacts_enabled: false,
            };
            const streamRes = await fetch(`${TGPT_BASE}/conversations/${convId}/messages/stream`, {
                method: "POST",
                headers: {
                    accept: "*/*",
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify(payload),
            });
            if (!streamRes.ok || !streamRes.body) {
                throw new Error("Stream failed");
            }
            const reader = streamRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let assistantContent = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                const parts = buffer.split("\n\n");
                buffer = parts.pop() || "";
                for (const part of parts) {
                    if (!part.trim())
                        continue;
                    const lines = part.split("\n");
                    for (const line of lines) {
                        if (!line.startsWith("data: "))
                            continue;
                        const rawData = line.substring(6).trim();
                        if (rawData === "[DONE]")
                            continue;
                        try {
                            const data = JSON.parse(rawData);
                            if (data.type === "content_delta") {
                                assistantContent += data.delta || "";
                            }
                        }
                        catch {
                            // ignore malformed chunk
                        }
                    }
                }
            }
            const jsonMatch = assistantContent.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error("AI did not return a valid JSON object.");
            }
            const jsonData = JSON.parse(jsonMatch[0]);
            const formatted = (jsonData.records || []).map((item, idx) => ({
                id: `coupon-${idx}-${Date.now()}`,
                code: item.couponCode || "",
                name: item.description || "",
                appliedOn: item.appliedOn || "Labor & Parts",
                glAcct: item.glAccounts || ["9999", "9999"],
                discountType: item.discount?.type === "percentage"
                    ? "Percentage"
                    : item.discount?.type === "flat_amount"
                        ? "Flat"
                        : "None",
                discountAmount: item.discount?.value ?? null,
                capAmount: item.discount?.capAmount ?? null,
                priceType: item.price?.type === "target_price"
                    ? "Target Price"
                    : item.price?.type === "fixed_price"
                        ? "Fixed Price"
                        : "None",
                priceAmount: item.price?.amount ?? null,
                confidence: item.confidence ?? 1,
            }));
            setParsedData(formatted);
            setUnclassifiedData(jsonData.unclassifiedSegments || []);
            setMessage({
                ok: true,
                text: `Parsed ${formatted.length} coupon(s) successfully.`,
            });
        }
        catch (error) {
            setMessage({
                ok: false,
                text: `AI Error: ${error.message}`,
            });
        }
        finally {
            setIsAiLoading(false);
            setLoadingText("");
        }
    };
    const handleManualParse = () => {
        const trimmed = inputText.trim();
        setMessage(null);
        try {
            if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
                const jsonData = JSON.parse(trimmed);
                const formatted = (jsonData.records || []).map((item, idx) => ({
                    id: `coupon-${idx}-${Date.now()}`,
                    code: item.couponCode || "",
                    name: item.description || "",
                    appliedOn: item.appliedOn || "Labor & Parts",
                    glAcct: item.glAccounts || ["9999", "9999"],
                    discountType: item.discount?.type === "percentage"
                        ? "Percentage"
                        : item.discount?.type === "flat_amount"
                            ? "Flat"
                            : "None",
                    discountAmount: item.discount?.value ?? null,
                    capAmount: item.discount?.capAmount ?? null,
                    priceType: item.price?.type === "target_price"
                        ? "Target Price"
                        : item.price?.type === "fixed_price"
                            ? "Fixed Price"
                            : "None",
                    priceAmount: item.price?.amount ?? null,
                    confidence: item.confidence ?? 1,
                }));
                setParsedData(formatted);
                setUnclassifiedData(jsonData.unclassifiedSegments || []);
                setMessage({
                    ok: true,
                    text: `Loaded ${formatted.length} coupon(s) from JSON.`,
                });
            }
            else {
                setMessage({
                    ok: false,
                    text: "For manual parsing, paste a valid JSON object or use AI Parse for raw text.",
                });
            }
        }
        catch {
            setMessage({
                ok: false,
                text: "Invalid format for Manual Parse.",
            });
        }
    };
    const buildTekionPayload = () => {
        const dealerPrefix = dealerId || "9999";
        const startTimeVal = String(Date.now() + 120000);
        return parsedData.map((coupon) => {
            const isFixedPrice = coupon.priceAmount !== null &&
                coupon.priceAmount > 0 &&
                (coupon.discountAmount === null || coupon.discountType === "None");
            const isPercentage = !isFixedPrice && coupon.discountType === "Percentage";
            const discountTypeVal = isFixedPrice ? "FIXED" : "FLAT";
            const pricingMethod = isFixedPrice ? "FLAT" : isPercentage ? "PERCENTAGE" : "FLAT";
            let appliedOnTekion = "LABOR_PLUS_PARTS";
            if (coupon.appliedOn === "Labor")
                appliedOnTekion = "LABOR";
            else if (coupon.appliedOn === "Parts")
                appliedOnTekion = "PARTS";
            const splitByType = appliedOnTekion === "LABOR_PLUS_PARTS" ? "GROSS" : "FLAT";
            const formatGl = (acct) => {
                if (!acct)
                    return `${dealerPrefix}_9999`;
                return acct.includes("_") ? acct : `${dealerPrefix}_${acct}`;
            };
            let departments = [];
            if (appliedOnTekion === "LABOR_PLUS_PARTS") {
                const serviceGl = coupon.glAcct[0] || "9999";
                const partsGl = coupon.glAcct[1] || coupon.glAcct[0] || "9999";
                departments = [
                    {
                        value: 0,
                        department: "SERVICE",
                        glAccountDetailList: [{ glAccount: formatGl(serviceGl), value: 100 }],
                    },
                    {
                        value: 0,
                        department: "PARTS",
                        glAccountDetailList: [{ glAccount: formatGl(partsGl), value: 100 }],
                    },
                ];
            }
            else if (appliedOnTekion === "LABOR") {
                const laborGl = coupon.glAcct[0] || "9999";
                departments = [
                    {
                        value: 100,
                        department: "SERVICE",
                        glAccountDetailList: [{ glAccount: formatGl(laborGl), value: 100 }],
                    },
                ];
            }
            else {
                const partsGl = coupon.glAcct[0] || "9999";
                departments = [
                    {
                        value: 100,
                        department: "PARTS",
                        glAccountDetailList: [{ glAccount: formatGl(partsGl), value: 100 }],
                    },
                ];
            }
            const numericVal = isFixedPrice
                ? coupon.priceAmount
                : coupon.discountAmount !== null
                    ? coupon.discountAmount
                    : 1;
            return {
                couponCode: coupon.code,
                description: coupon.name,
                department: "SERVICE",
                opcodes: [],
                serviceTypeIds: [],
                sourceCodeIds: [],
                partIds: [],
                startTime: startTimeVal,
                expiryTime: null,
                discountType: discountTypeVal,
                appliedOn: appliedOnTekion,
                pricingDetail: {
                    pricingMethod,
                    flatAmount: isFixedPrice ? numericVal : isPercentage ? null : String(numericVal),
                    percentage: isPercentage ? String(numericVal) : null,
                    capAmount: coupon.capAmount !== null ? String(coupon.capAmount) : null,
                    ...(isFixedPrice ? { flatSellingPrice: numericVal } : {}),
                },
                pricingMethod,
                splitByType,
                departments,
                considerForGrossCalculation: false,
                taxable: false,
                roLevelOnly: false,
                subPayTypes: ["ALL_CUSTOMER_PAY"],
                payTypes: [],
                allowedMultipleTimesInSameRo: true,
                languages: { documentDefault: "en_US", locale: null },
                eligibleCustomerTypes: [],
                accountingGroupId: null,
                skillIds: [],
                autoAddConfig: {
                    autoAddToJobsEnabled: false,
                    enabledConfigs: [],
                    criteria: { filters: [] },
                },
            };
        });
    };
    const handleCopyPayload = () => {
        const payload = buildTekionPayload();
        navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).then(() => {
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        });
    };
    const handlePushToTekion = async () => {
        if (parsedData.length === 0) {
            setMessage({
                ok: false,
                text: "No parsed coupon data available to push.",
            });
            return;
        }
        if (!dealerId || globalHeaderCount === 0) {
            setMessage({
                ok: false,
                text: "Global Headers or Dealer ID missing. Please apply dealer headers in Settings first.",
            });
            return;
        }
        setIsPushing(true);
        setMessage(null);
        try {
            const payloadArray = buildTekionPayload();
            let successCount = 0;
            const failures = [];
            for (const item of payloadArray) {
                const res = await fetch("http://localhost:4000/api/proxy", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        url: COUPON_CREATE_URL,
                        method: "POST",
                        headers: {
                            ...enabledHeaders,
                            accept: "application/json, text/plain, */*",
                            "content-type": "application/json",
                        },
                        body: item,
                        timeout: 60000,
                    }),
                });
                if (!res.ok) {
                    failures.push(`${item.couponCode}: proxy HTTP ${res.status}`);
                    continue;
                }
                const json = await res.json();
                if ((json?.status ?? 200) >= 400) {
                    failures.push(`${item.couponCode}: ${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim());
                    continue;
                }
                successCount += 1;
            }
            if (failures.length === 0) {
                setMessage({
                    ok: true,
                    text: `Successfully pushed ${successCount} of ${payloadArray.length} coupons to Tekion Preprod.`,
                });
            }
            else {
                setMessage({
                    ok: false,
                    text: `Pushed ${successCount} of ${payloadArray.length} coupons.\n\nFailed:\n` +
                        failures.join("\n"),
                });
            }
        }
        catch (err) {
            setMessage({
                ok: false,
                text: `Push Error: ${err.message}`,
            });
        }
        finally {
            setIsPushing(false);
        }
    };
    const handleCodeEdit = (index, newCode) => {
        const updated = [...parsedData];
        updated[index].code = newCode.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
        setParsedData(updated);
    };
    const handleNameEdit = (index, newName) => {
        const updated = [...parsedData];
        updated[index].name = newName;
        setParsedData(updated);
    };
    const handleValueEdit = (index, valStr) => {
        const updated = [...parsedData];
        const clean = valStr.trim();
        if (clean.endsWith("%")) {
            updated[index].discountType = "Percentage";
            updated[index].discountAmount = parseFloat(clean) || 0;
            updated[index].priceAmount = null;
        }
        else {
            const num = parseFloat(clean.replace(/[^0-9.]/g, ""));
            if (!isNaN(num)) {
                if (updated[index].priceAmount !== null) {
                    updated[index].priceAmount = num;
                }
                else {
                    updated[index].discountType = "Flat";
                    updated[index].discountAmount = num;
                }
            }
            else {
                if (updated[index].priceAmount !== null) {
                    updated[index].priceAmount = null;
                }
                else {
                    updated[index].discountAmount = null;
                }
            }
        }
        setParsedData(updated);
    };
    const handleCapEdit = (index, capStr) => {
        const updated = [...parsedData];
        const num = parseFloat(capStr);
        updated[index].capAmount = isNaN(num) ? null : num;
        setParsedData(updated);
    };
    const handleAppliedOnEdit = (index, newAppliedOn) => {
        const updated = [...parsedData];
        updated[index].appliedOn = newAppliedOn;
        if (newAppliedOn === "Labor & Parts") {
            if (updated[index].glAcct.length < 2) {
                updated[index].glAcct = [updated[index].glAcct[0] || "9999", "9999"];
            }
        }
        else {
            updated[index].glAcct = [updated[index].glAcct[0] || "9999"];
        }
        setParsedData(updated);
    };
    const handleGlAcctEdit = (index, glStr) => {
        const updated = [...parsedData];
        const cleaned = glStr.replace(/[\[\]]/g, "");
        const parts = cleaned
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        updated[index].glAcct = parts.length > 0 ? parts : ["9999"];
        setParsedData(updated);
    };
    const handleDeleteRow = (id) => {
        setParsedData(parsedData.filter((row) => row.id !== id));
    };
    const getEditableValueInput = (row) => {
        if (row.discountType === "Percentage" && row.discountAmount !== null) {
            return `${row.discountAmount}%`;
        }
        const val = row.priceAmount !== null ? row.priceAmount : row.discountAmount;
        return val !== null ? `${val}` : "";
    };
    if (!token) {
        return (_jsxs("div", { className: "flex flex-col items-center justify-center min-h-[320px] bg-[#18181b] rounded-2xl border border-zinc-800 p-8 text-zinc-200", children: [_jsx("h2", { className: "text-xl font-bold mb-2", children: "Authentication Required" }), _jsx("p", { className: "text-zinc-400 text-sm mb-6 text-center max-w-sm", children: "Please provide your TGPT access token." }), _jsxs("div", { className: "flex gap-2 w-full max-w-sm", children: [_jsx("input", { type: "password", value: draftToken, onChange: (e) => setDraftToken(e.target.value), placeholder: "Paste Token Here...", className: "flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2 outline-none focus:border-[#3b82f6]" }), _jsx("button", { onClick: handleSaveToken, className: "bg-[#3b82f6] text-white font-semibold rounded-lg px-4 py-2 hover:bg-blue-600 transition-colors", children: "Connect" })] })] }));
    }
    return (_jsxs("div", { style: {
            minHeight: 220,
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
            padding: 20,
            color: "#cbd5e1",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
            fontFamily: "system-ui, sans-serif",
        }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [_jsx("h2", { style: { margin: 0, fontSize: "1.25rem", color: "#fff" }, children: "Coupons & Discounts" }), _jsx("button", { onClick: () => {
                            localStorage.removeItem(TGPT_TOKEN_KEY);
                            setToken("");
                        }, style: {
                            background: "transparent",
                            border: "1px solid rgba(255,255,255,0.2)",
                            padding: "4px 10px",
                            borderRadius: "6px",
                            color: "#9ca3af",
                            fontSize: "12px",
                            cursor: "pointer",
                        }, children: "Logout TGPT" })] }), _jsxs("div", { style: {
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                }, children: [_jsxs("span", { style: {
                            padding: "6px 10px",
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            fontSize: 12,
                        }, children: ["Dealer ID: ", _jsx("b", { style: { color: dealerId ? "#86efac" : "#fca5a5" }, children: dealerId || "Not found" })] }), _jsxs("span", { style: {
                            padding: "6px 10px",
                            borderRadius: 999,
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            fontSize: 12,
                        }, children: ["Global Headers: ", _jsx("b", { style: { color: "#f8fafc" }, children: globalHeaderCount })] }), _jsxs("span", { style: {
                            padding: "6px 10px",
                            borderRadius: 999,
                            background: rawBlueprintValue
                                ? "rgba(34,197,94,0.08)"
                                : "rgba(255,255,255,0.04)",
                            border: rawBlueprintValue
                                ? "1px solid rgba(34,197,94,0.25)"
                                : "1px solid rgba(255,255,255,0.08)",
                            color: rawBlueprintValue ? "#86efac" : "#94a3b8",
                            fontSize: 12,
                        }, children: ["Blueprint Field:", " ", _jsx("b", { style: { color: rawBlueprintValue ? "#86efac" : "#f8fafc" }, children: blueprintLoading
                                    ? "Loading..."
                                    : rawBlueprintValue
                                        ? "Answer Found"
                                        : "No Answer" })] })] }), message ? (_jsx("div", { style: {
                    borderRadius: 10,
                    padding: "10px 12px",
                    whiteSpace: "pre-wrap",
                    background: message.ok ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
                    border: message.ok
                        ? "1px solid rgba(34,197,94,0.22)"
                        : "1px solid rgba(239,68,68,0.22)",
                    color: message.ok ? "#bbf7d0" : "#fecaca",
                    fontSize: 13,
                }, children: message.text })) : null, _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: "10px" }, children: [_jsxs("div", { style: {
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: 8,
                        }, children: [_jsx("label", { htmlFor: "coupon-input", style: { fontSize: "0.9rem" }, children: "Dealer Blueprint Discount Notes:" }), rawBlueprintValue && (_jsx("button", { type: "button", onClick: () => setInputText(rawBlueprintValue), style: {
                                    background: "rgba(34,197,94,0.12)",
                                    border: "1px solid rgba(34,197,94,0.3)",
                                    color: "#86efac",
                                    fontSize: "12px",
                                    padding: "3px 10px",
                                    borderRadius: "6px",
                                    cursor: "pointer",
                                    fontWeight: 600,
                                }, children: "\u21BB Reload from Blueprint" }))] }), _jsx("textarea", { id: "coupon-input", value: inputText, onChange: (e) => setInputText(e.target.value), placeholder: "Paste notes here or load from blueprint...", disabled: isAiLoading, style: {
                            width: "100%",
                            height: "150px",
                            background: "rgba(0,0,0,0.2)",
                            border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: "8px",
                            padding: "12px",
                            color: "#a7f3d0",
                            fontFamily: "monospace",
                            resize: "vertical",
                            opacity: isAiLoading ? 0.5 : 1,
                        } }), _jsxs("div", { style: { display: "flex", gap: "12px", flexWrap: "wrap" }, children: [_jsx("button", { onClick: handleAIParse, disabled: isAiLoading || !inputText.trim(), style: {
                                    padding: "10px 24px",
                                    background: isAiLoading ? "#60a5fa" : "#3b82f6",
                                    border: "none",
                                    borderRadius: "6px",
                                    color: "#fff",
                                    fontWeight: 600,
                                    cursor: isAiLoading || !inputText.trim() ? "not-allowed" : "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "8px",
                                }, children: isAiLoading ? `⏳ ${loadingText}` : "✨ Parse with AI (Auto)" }), _jsx("button", { onClick: handleManualParse, disabled: isAiLoading || !inputText.trim(), style: {
                                    padding: "10px 24px",
                                    background: "transparent",
                                    border: "1px solid rgba(255,255,255,0.2)",
                                    borderRadius: "6px",
                                    color: "#cbd5e1",
                                    fontWeight: 600,
                                    cursor: isAiLoading || !inputText.trim() ? "not-allowed" : "pointer",
                                }, children: "Parse Local JSON (Manual)" })] })] }), unclassifiedData.length > 0 && (_jsxs("div", { style: {
                    background: "rgba(234, 179, 8, 0.1)",
                    border: "1px solid rgba(234, 179, 8, 0.3)",
                    borderRadius: "8px",
                    padding: "12px 16px",
                    color: "#fef08a",
                    fontSize: "0.9rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                }, children: [_jsxs("div", { style: { fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }, children: [_jsx("span", { children: "\u26A0\uFE0F" }), "AI Note: The following text was ignored because it did not look like a valid coupon:"] }), _jsx("ul", { style: { margin: 0, paddingLeft: "24px", color: "#fde047" }, children: unclassifiedData.map((text, i) => (_jsx("li", { style: { marginBottom: "4px" }, children: text }, i))) })] })), parsedData.length > 0 && (_jsxs("div", { style: { marginTop: "20px" }, children: [_jsx("div", { style: { overflowX: "auto" }, children: _jsxs("table", { style: {
                                width: "100%",
                                borderCollapse: "collapse",
                                textAlign: "left",
                                fontSize: "0.9rem",
                            }, children: [_jsx("thead", { children: _jsxs("tr", { style: { borderBottom: "1px solid rgba(255,255,255,0.1)" }, children: [_jsx("th", { style: { padding: "12px 8px", width: "140px" }, children: "Coupon Code" }), _jsx("th", { style: { padding: "12px 8px" }, children: "Name / Description" }), _jsx("th", { style: { padding: "12px 8px", width: "95px" }, children: "Value ($ / %)" }), _jsx("th", { style: { padding: "12px 8px", width: "85px" }, children: "Cap ($)" }), _jsx("th", { style: { padding: "12px 8px", width: "140px" }, children: "Applied On" }), _jsx("th", { style: { padding: "12px 8px", width: "160px" }, children: "G/L Acct Array" }), _jsx("th", { style: { padding: "12px 8px", width: "70px", textAlign: "center" }, children: "Conf." }), _jsx("th", { style: { padding: "12px 8px", width: "50px", textAlign: "center" }, children: "Action" })] }) }), _jsx("tbody", { children: parsedData.map((row, idx) => (_jsxs("tr", { style: { borderBottom: "1px solid rgba(255,255,255,0.05)" }, children: [_jsx("td", { style: { padding: "8px" }, children: _jsx("input", { type: "text", value: row.code, onChange: (e) => handleCodeEdit(idx, e.target.value), style: {
                                                        width: "100%",
                                                        padding: "6px",
                                                        background: "rgba(0,0,0,0.2)",
                                                        border: "1px solid rgba(255,255,255,0.2)",
                                                        borderRadius: "4px",
                                                        color: "#93c5fd",
                                                        fontWeight: "bold",
                                                        outline: "none",
                                                    } }) }), _jsx("td", { style: { padding: "8px" }, children: _jsx("input", { type: "text", value: row.name, onChange: (e) => handleNameEdit(idx, e.target.value), style: {
                                                        width: "100%",
                                                        padding: "6px",
                                                        background: "rgba(0,0,0,0.2)",
                                                        border: "1px solid rgba(255,255,255,0.2)",
                                                        borderRadius: "4px",
                                                        color: "#cbd5e1",
                                                        outline: "none",
                                                    } }) }), _jsx("td", { style: { padding: "8px" }, children: _jsx("input", { type: "text", value: getEditableValueInput(row), onChange: (e) => handleValueEdit(idx, e.target.value), placeholder: "e.g. 10 or 15%", style: {
                                                        width: "100%",
                                                        padding: "6px",
                                                        background: "rgba(0,0,0,0.2)",
                                                        border: "1px solid rgba(255,255,255,0.2)",
                                                        borderRadius: "4px",
                                                        color: "#a7f3d0",
                                                        fontWeight: "600",
                                                        outline: "none",
                                                    } }) }), _jsx("td", { style: { padding: "8px" }, children: _jsx("input", { type: "number", value: row.capAmount !== null ? row.capAmount : "", onChange: (e) => handleCapEdit(idx, e.target.value), placeholder: "-", style: {
                                                        width: "100%",
                                                        padding: "6px",
                                                        background: "rgba(0,0,0,0.2)",
                                                        border: "1px solid rgba(255,255,255,0.2)",
                                                        borderRadius: "4px",
                                                        color: "#fde047",
                                                        outline: "none",
                                                    } }) }), _jsx("td", { style: { padding: "8px" }, children: _jsxs("select", { value: row.appliedOn || "Labor & Parts", onChange: (e) => handleAppliedOnEdit(idx, e.target.value), style: {
                                                        width: "100%",
                                                        padding: "6px",
                                                        background: "rgba(0,0,0,0.3)",
                                                        border: "1px solid rgba(255,255,255,0.2)",
                                                        borderRadius: "4px",
                                                        color: "#a7f3d0",
                                                        fontWeight: "500",
                                                        outline: "none",
                                                        cursor: "pointer",
                                                    }, children: [_jsx("option", { value: "Labor & Parts", style: { background: "#18181b", color: "#cbd5e1" }, children: "Labor & Parts" }), _jsx("option", { value: "Labor", style: { background: "#18181b", color: "#cbd5e1" }, children: "Labor" }), _jsx("option", { value: "Parts", style: { background: "#18181b", color: "#cbd5e1" }, children: "Parts" })] }) }), _jsx("td", { style: { padding: "8px" }, children: _jsx("input", { type: "text", value: row.glAcct.join(", "), onChange: (e) => handleGlAcctEdit(idx, e.target.value), style: {
                                                        width: "100%",
                                                        padding: "6px",
                                                        background: "rgba(0,0,0,0.2)",
                                                        border: "1px solid rgba(255,255,255,0.2)",
                                                        borderRadius: "4px",
                                                        color: "#fca5a5",
                                                        fontFamily: "monospace",
                                                        outline: "none",
                                                    } }) }), _jsx("td", { style: { padding: "12px 8px", textAlign: "center" }, children: _jsxs("span", { style: {
                                                        padding: "2px 6px",
                                                        borderRadius: "4px",
                                                        fontSize: "0.8rem",
                                                        background: row.confidence >= 0.8
                                                            ? "rgba(16, 185, 129, 0.2)"
                                                            : "rgba(245, 158, 11, 0.2)",
                                                        color: row.confidence >= 0.8 ? "#34d399" : "#fbbf24",
                                                    }, children: [Math.round(row.confidence * 100), "%"] }) }), _jsx("td", { style: { padding: "12px 8px", textAlign: "center" }, children: _jsx("button", { onClick: () => handleDeleteRow(row.id), title: "Remove row", style: {
                                                        background: "transparent",
                                                        border: "none",
                                                        color: "#ef4444",
                                                        cursor: "pointer",
                                                        fontSize: "1.1rem",
                                                    }, children: "\uD83D\uDDD1\uFE0F" }) })] }, row.id))) })] }) }), _jsxs("div", { style: { marginTop: "20px", display: "flex", justifyContent: "flex-end", gap: "12px" }, children: [_jsx("button", { onClick: handleCopyPayload, style: {
                                    padding: "10px 24px",
                                    background: copySuccess ? "#10b981" : "#059669",
                                    border: "none",
                                    borderRadius: "6px",
                                    color: "#fff",
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    transition: "background 0.2s",
                                }, children: copySuccess ? "✅ Copied Payload!" : "📋 Copy Tekion Payload JSON" }), _jsx("button", { onClick: handlePushToTekion, disabled: isPushing, style: {
                                    padding: "10px 24px",
                                    background: isPushing ? "#60a5fa" : "#2563eb",
                                    border: "none",
                                    borderRadius: "6px",
                                    color: "#fff",
                                    fontWeight: 600,
                                    cursor: isPushing ? "not-allowed" : "pointer",
                                    transition: "background 0.2s",
                                }, children: isPushing ? "🚀 Pushing to Tekion..." : "🚀 Push to Tekion Preprod" })] })] }))] }));
};
export default CouponsView;
