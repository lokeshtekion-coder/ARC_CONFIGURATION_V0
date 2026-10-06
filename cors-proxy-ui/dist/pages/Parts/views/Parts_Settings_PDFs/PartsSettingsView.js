import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { loadTekionApiSettingsBundle } from "../../../../services/tekionApiSettings";
const MODULE_NAME = "Parts Settings";
const PDF_CONFIGURATION_URL = "https://preprodapp.tekioncloud.com/api/partTrade/u/settings/part/general/pdfConfiguration";
const PDF_TYPES = [
    "SALES_ORDER_RETAIL_GENERAL_CUSTOMER",
    "SALES_ORDER_RETAIL_INVOICE_CUSTOMER",
    "SALES_ORDER_RETAIL_RETURN_CUSTOMER",
    "SALES_ORDER_INTERNAL_GENERAL_CUSTOMER",
    "SALES_ORDER_INTERNAL_INVOICE_CUSTOMER",
    "SALES_ORDER_INTERNAL_RETURN_CUSTOMER",
    "SALES_ORDER_WHOLESALE_GENERAL_CUSTOMER",
    "SALES_ORDER_WHOLESALE_INVOICE_CUSTOMER",
    "SALES_ORDER_WHOLESALE_RETURN_CUSTOMER",
];
const logger = {
    debug: (...args) => console.debug("[Parts][PartsSettings]", ...args),
    info: (...args) => console.info("[Parts][PartsSettings]", ...args),
    warn: (...args) => console.warn("[Parts][PartsSettings]", ...args),
    error: (...args) => console.error("[Parts][PartsSettings]", ...args),
};
function normalizeText(value) {
    return String(value ?? "");
}
function processEscapeSequences(text) {
    return text.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");
}
function getEnabledGlobalHeaders() {
    const bundle = loadTekionApiSettingsBundle();
    const headers = (bundle.globalHeaders ?? [])
        .filter((header) => header.enabled && header.key.trim() && String(header.value).trim())
        .reduce((acc, header) => {
        acc[header.key] = String(header.value);
        return acc;
    }, {});
    logger.info("loaded global headers from settings", {
        count: Object.keys(headers).length,
        keys: Object.keys(headers),
    });
    return headers;
}
function buildRichTextValue(fieldKey, text) {
    return {
        blocks: [
            {
                key: fieldKey,
                text,
                type: "unstyled",
                depth: 0,
                inlineStyleRanges: text.length > 0
                    ? [
                        {
                            offset: 0,
                            length: text.length,
                            style: "CUSTOM_FONT_SIZE_1rem",
                        },
                    ]
                    : [],
                entityRanges: [],
                data: {
                    blockStyle_lineHeight: 90,
                },
            },
        ],
        entityMap: {},
    };
}
function buildPayload(pdfType, warrantyText, returnTermsText) {
    const payload = {
        pdfRichTextAreas: [
            {
                fieldName: "disclaimer",
                value: buildRichTextValue("disclaimer", warrantyText),
                visible: true,
            },
            {
                fieldName: "returnTerms",
                value: buildRichTextValue("returnTerms", returnTermsText),
                visible: true,
            },
        ],
        pdfType,
        useGeneralSettings: false,
    };
    logger.debug("built payload", {
        pdfType,
        warrantyLength: warrantyText.length,
        returnTermsLength: returnTermsText.length,
        payloadPreview: payload,
    });
    return payload;
}
async function submitPdfConfiguration(payload, headers) {
    const requestHeaders = { ...headers };
    delete requestHeaders["Content-Type"];
    delete requestHeaders["content-type"];
    delete requestHeaders["CONTENT-TYPE"];
    requestHeaders["content-type"] = "application/json";
    logger.info("POST pdf configuration started", {
        url: PDF_CONFIGURATION_URL,
        pdfType: payload.pdfType,
        headerKeys: Object.keys(requestHeaders),
        payloadSize: JSON.stringify(payload).length,
    });
    const response = await fetch(PDF_CONFIGURATION_URL, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(payload),
    });
    logger.info("POST pdf configuration response", {
        pdfType: payload.pdfType,
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
    });
    if (!response.ok) {
        const text = await response.text();
        logger.error("POST pdf configuration failed", {
            pdfType: payload.pdfType,
            status: response.status,
            body: text,
        });
        throw new Error(`HTTP ${response.status}: ${text.substring(0, 300)}`);
    }
    const json = await response.json();
    logger.debug("POST pdf configuration success response", {
        pdfType: payload.pdfType,
        response: json,
    });
    return json;
}
export const PartsSettingsView = () => {
    const [warrantyText, setWarrantyText] = useState("");
    const [returnTermsText, setReturnTermsText] = useState("");
    const [runState, setRunState] = useState("idle");
    const [statusText, setStatusText] = useState("Ready to submit PDF configuration to all 9 PDF types");
    const [errorText, setErrorText] = useState("");
    const [lastRunAt, setLastRunAt] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [progressCurrent, setProgressCurrent] = useState(0);
    const [results, setResults] = useState([]);
    const [showInfo, setShowInfo] = useState(false);
    useEffect(() => {
        logger.info("component mounted");
        logger.info("pdf types loaded", PDF_TYPES);
        return () => logger.info("component unmounted");
    }, []);
    const processedWarrantyText = useMemo(() => processEscapeSequences(warrantyText.trim()), [warrantyText]);
    const processedReturnTermsText = useMemo(() => processEscapeSequences(returnTermsText.trim()), [returnTermsText]);
    const warrantyCharCount = warrantyText.length;
    const returnTermsCharCount = returnTermsText.length;
    const totalLength = warrantyCharCount + returnTermsCharCount;
    const canSubmit = totalLength > 0 && !isSubmitting;
    const progressPercent = Math.round((progressCurrent / PDF_TYPES.length) * 100);
    const handleSubmit = async () => {
        logger.info("submit button clicked");
        logger.info("submission input summary", {
            rawWarrantyLength: warrantyText.length,
            rawReturnTermsLength: returnTermsText.length,
            processedWarrantyLength: processedWarrantyText.length,
            processedReturnTermsLength: processedReturnTermsText.length,
            warrantyPreview: processedWarrantyText.substring(0, 100).replace(/\n/g, "\\n"),
            returnTermsPreview: processedReturnTermsText
                .substring(0, 100)
                .replace(/\n/g, "\\n"),
        });
        if (!processedWarrantyText && !processedReturnTermsText) {
            logger.warn("submission blocked because both inputs are empty");
            setRunState("warning");
            setStatusText("Enter Warranty or Return Terms before submitting");
            setErrorText("");
            return;
        }
        setIsSubmitting(true);
        setRunState("loading");
        setStatusText("Submitting PDF configuration to all PDF types...");
        setErrorText("");
        setResults([]);
        setProgressCurrent(0);
        try {
            const headers = getEnabledGlobalHeaders();
            if (Object.keys(headers).length === 0) {
                logger.warn("global headers missing before submit");
                setRunState("error");
                setStatusText("Global headers are missing");
                setErrorText("No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers.");
                return;
            }
            const nextResults = [];
            for (let index = 0; index < PDF_TYPES.length; index += 1) {
                const pdfType = PDF_TYPES[index];
                const currentStep = index + 1;
                setProgressCurrent(currentStep);
                setStatusText(`Processing ${currentStep} / ${PDF_TYPES.length}: ${pdfType}`);
                const payload = buildPayload(pdfType, processedWarrantyText, processedReturnTermsText);
                if (index === 0) {
                    logger.info("first payload sample", payload);
                }
                try {
                    const response = await submitPdfConfiguration(payload, headers);
                    nextResults.push({
                        pdfType,
                        success: true,
                        response,
                    });
                    logger.info("pdf type submission succeeded", { pdfType, currentStep });
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    nextResults.push({
                        pdfType,
                        success: false,
                        error: errorMessage,
                    });
                    logger.error("pdf type submission failed", {
                        pdfType,
                        currentStep,
                        error: errorMessage,
                    });
                }
                setResults([...nextResults]);
            }
            const successCount = nextResults.filter((item) => item.success).length;
            const failedResults = nextResults.filter((item) => !item.success);
            const failedCount = failedResults.length;
            logger.info("final submission summary", {
                successCount,
                failedCount,
                results: nextResults,
            });
            setLastRunAt(new Date().toLocaleString());
            if (failedCount === 0) {
                setRunState("success");
                setStatusText(`PDF configuration saved successfully for all ${successCount} PDF types`);
                setErrorText("");
                logger.info("all submissions succeeded, clearing form");
                setWarrantyText("");
                setReturnTermsText("");
            }
            else {
                setRunState("warning");
                setStatusText(`Completed with partial success. ${successCount} succeeded and ${failedCount} failed.`);
                setErrorText(failedResults
                    .map((item) => `${item.pdfType}: ${item.error ?? "Unknown error"}`)
                    .join("\n"));
            }
        }
        catch (error) {
            logger.error("submit flow failed unexpectedly", error);
            setRunState("error");
            setStatusText("Failed to save PDF configuration");
            setErrorText(error instanceof Error ? error.message : String(error));
            setLastRunAt(new Date().toLocaleString());
        }
        finally {
            setIsSubmitting(false);
        }
    };
    const successCount = results.filter((item) => item.success).length;
    const failedCount = results.filter((item) => !item.success).length;
    return (_jsxs("div", { style: pageStyle, children: [_jsxs("div", { style: mainCardStyle, children: [_jsxs("div", { style: topBarStyle, children: [_jsxs("div", { style: { minWidth: 0, flex: 1 }, children: [_jsx("div", { style: titleStyle, children: "Parts settings" }), _jsx("div", { style: subtitleStyle, children: "Configure Warranty and Return Terms PDF settings for all 9 sales order PDF types using active Global Headers from Settings." })] }), _jsxs("div", { style: topActionsStyle, children: [_jsx("button", { type: "button", className: "btn-secondary", "aria-label": showInfo ? "Hide info" : "Show info", title: showInfo ? "Hide info" : "Show info", onClick: () => setShowInfo((prev) => !prev), style: infoButtonStyle, children: "\u2139\uFE0F" }), _jsx("button", { className: "btn-postman", type: "button", onClick: () => {
                                            void handleSubmit();
                                        }, disabled: !canSubmit, style: submitButtonStyle, children: isSubmitting ? "Processing..." : "Submit to All PDF Types" })] })] }), _jsxs("div", { style: primaryStackStyle, children: [_jsxs("div", { style: editorCardStyle, children: [_jsxs("div", { style: editorHeaderStyle, children: [_jsxs("div", { style: { minWidth: 0 }, children: [_jsx("div", { style: editorTitleStyle, children: "Warranty" }), _jsx("div", { style: editorSubStyle, children: "Primary input area for disclaimer/warranty content." })] }), _jsxs("div", { style: counterBadgeStyle, children: [warrantyCharCount, " / 2000"] })] }), _jsx("textarea", { className: "st-input", rows: 14, maxLength: 2000, value: warrantyText, onChange: (e) => {
                                            logger.debug("warranty input changed", { length: e.target.value.length });
                                            setWarrantyText(e.target.value);
                                        }, placeholder: "Enter warranty text...", style: textareaStyle }), _jsxs("div", { style: editorFooterStyle, children: [_jsx("span", { style: helperTextStyle, children: "Supports \\n \\t \\r escape processing" }), _jsxs("span", { style: processedCountStyle, children: [processedWarrantyText.length, " processed chars"] })] })] }), _jsxs("div", { style: editorCardStyle, children: [_jsxs("div", { style: editorHeaderStyle, children: [_jsxs("div", { style: { minWidth: 0 }, children: [_jsx("div", { style: editorTitleStyle, children: "Return Terms" }), _jsx("div", { style: editorSubStyle, children: "Primary input area for return terms content." })] }), _jsxs("div", { style: counterBadgeStyle, children: [returnTermsCharCount, " / 2000"] })] }), _jsx("textarea", { className: "st-input", rows: 14, maxLength: 2000, value: returnTermsText, onChange: (e) => {
                                            logger.debug("return terms input changed", {
                                                length: e.target.value.length,
                                            });
                                            setReturnTermsText(e.target.value);
                                        }, placeholder: "Enter return terms...", style: textareaStyle }), _jsxs("div", { style: editorFooterStyle, children: [_jsx("span", { style: helperTextStyle, children: "Supports \\n \\t \\r escape processing" }), _jsxs("span", { style: processedCountStyle, children: [processedReturnTermsText.length, " processed chars"] })] })] })] }), (isSubmitting || progressCurrent > 0) && (_jsxs("div", { style: progressCardStyle, children: [_jsxs("div", { style: progressHeaderStyle, children: [_jsxs("span", { style: progressTitleStyle, children: ["Processing ", progressCurrent, " / ", PDF_TYPES.length] }), _jsxs("span", { style: progressPercentStyle, children: [progressPercent, "%"] })] }), _jsx("div", { style: progressTrackStyle, children: _jsx("div", { style: {
                                        ...progressFillStyle,
                                        width: `${progressPercent}%`,
                                    } }) }), _jsx("div", { style: progressMetaStyle, children: statusText })] })), _jsxs("div", { style: {
                            ...statusCardStyle,
                            ...(runState === "error"
                                ? statusErrorStyle
                                : runState === "success"
                                    ? statusSuccessStyle
                                    : runState === "warning"
                                        ? statusWarningStyle
                                        : statusIdleStyle),
                        }, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: errorText ? 6 : 0 }, children: statusText }), errorText ? _jsx("div", { children: errorText }) : null] })] }), showInfo ? (_jsxs("div", { style: infoPanelStyle, children: [_jsx("div", { style: infoPanelHeaderStyle, children: _jsxs("div", { children: [_jsx("div", { style: infoPanelTitleStyle, children: "Information" }), _jsx("div", { style: infoPanelSubStyle, children: "Secondary details, previews, API info, and submission results." })] }) }), _jsxs("div", { style: pillWrapStyle, children: [_jsx(Pill, { label: "Module", value: MODULE_NAME }), _jsx(Pill, { label: "PDF Types", value: String(PDF_TYPES.length) }), _jsx(Pill, { label: "Warranty Length", value: String(processedWarrantyText.length) }), _jsx(Pill, { label: "Return Terms Length", value: String(processedReturnTermsText.length) }), lastRunAt ? _jsx(Pill, { label: "Last Run", value: lastRunAt }) : null] }), _jsxs("div", { style: infoGridStyle, children: [_jsx(SectionCard, { title: "PDF Types To Be Updated", children: PDF_TYPES.map((pdfType, index) => {
                                    const matched = results.find((item) => item.pdfType === pdfType);
                                    return (_jsx(RowLine, { left: `${index + 1}. ${pdfType}`, right: matched?.success
                                            ? "Success"
                                            : matched?.success === false
                                                ? "Failed"
                                                : "Pending", rightColor: matched?.success
                                            ? "#86efac"
                                            : matched?.success === false
                                                ? "#fca5a5"
                                                : "#cbd5e1" }, pdfType));
                                }) }), _jsxs(SectionCard, { title: "Processed Input Preview", children: [_jsx(RowLine, { left: "Warranty Characters", right: String(processedWarrantyText.length) }), _jsx(RowLine, { left: "Return Terms Characters", right: String(processedReturnTermsText.length) }), _jsx(RowLine, { left: "Warranty Preview", right: processedWarrantyText
                                            ? processedWarrantyText.slice(0, 60).replace(/\n/g, "\\n")
                                            : "—" }), _jsx(RowLine, { left: "Return Terms Preview", right: processedReturnTermsText
                                            ? processedReturnTermsText.slice(0, 60).replace(/\n/g, "\\n")
                                            : "—" })] }), _jsxs(SectionCard, { title: "Write API Info", children: [_jsx(RowLine, { left: "Method", right: "POST", rightColor: "#86efac" }), _jsx(RowLine, { left: "Endpoint", right: PDF_CONFIGURATION_URL }), _jsx(RowLine, { left: "Mode", right: "Submit to all 9 PDF types sequentially" }), _jsx(RowLine, { left: "PUT Available in reference?", right: "No", rightColor: "#fca5a5" })] })] }), _jsxs("div", { style: resultsCardStyle, children: [_jsxs("div", { style: resultsHeaderStyle, children: [_jsxs("div", { children: [_jsx("div", { style: resultsTitleStyle, children: "Submission Results" }), _jsx("div", { style: resultsSubStyle, children: "Detailed result info shown only when info is opened." })] }), results.length > 0 ? (_jsxs("div", { style: resultsSummaryStyle, children: [_jsxs("span", { style: resultsSummarySuccessStyle, children: ["Success ", successCount] }), _jsxs("span", { style: resultsSummaryFailStyle, children: ["Failed ", failedCount] })] })) : null] }), results.length === 0 ? (_jsx("div", { style: emptyResultsStyle, children: "No submissions yet. Fill Warranty and/or Return Terms, then click Submit." })) : (_jsx("div", { style: { overflowX: "auto" }, children: _jsxs("table", { style: {
                                        width: "100%",
                                        borderCollapse: "collapse",
                                        minWidth: 900,
                                    }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "rgba(255,255,255,0.04)" }, children: [_jsx("th", { style: thStyle, children: "#" }), _jsx("th", { style: thStyle, children: "PDF Type" }), _jsx("th", { style: thStyle, children: "Status" }), _jsx("th", { style: thStyle, children: "Error" })] }) }), _jsx("tbody", { children: results.map((result, index) => (_jsxs("tr", { style: {
                                                    borderTop: "1px solid rgba(255,255,255,0.08)",
                                                    background: result.success
                                                        ? "rgba(34,197,94,0.04)"
                                                        : "rgba(239,68,68,0.04)",
                                                }, children: [_jsx("td", { style: tdStyle, children: index + 1 }), _jsx("td", { style: tdMonoStyle, children: result.pdfType }), _jsx("td", { style: tdStyle, children: _jsx("span", { style: {
                                                                display: "inline-flex",
                                                                padding: "4px 10px",
                                                                borderRadius: 999,
                                                                border: result.success
                                                                    ? "1px solid rgba(34,197,94,0.25)"
                                                                    : "1px solid rgba(239,68,68,0.25)",
                                                                background: result.success
                                                                    ? "rgba(34,197,94,0.10)"
                                                                    : "rgba(239,68,68,0.10)",
                                                                color: result.success ? "#86efac" : "#fca5a5",
                                                                fontSize: 12,
                                                                fontWeight: 700,
                                                            }, children: result.success ? "Success" : "Failed" }) }), _jsx("td", { style: tdStyle, children: normalizeText(result.error) || "—" })] }, `${result.pdfType}-${index}`))) })] }) }))] })] })) : null] }));
};
const pageStyle = {
    display: "grid",
    gap: 16,
    width: "100%",
};
const mainCardStyle = {
    borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.025) 100%)",
    padding: 20,
};
const topBarStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 18,
};
const titleStyle = {
    fontSize: 26,
    fontWeight: 800,
    color: "#f8fafc",
    marginBottom: 6,
    wordBreak: "break-word",
};
const subtitleStyle = {
    color: "#94a3b8",
    fontSize: 14,
    lineHeight: 1.7,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    maxWidth: 900,
};
const topActionsStyle = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
};
const infoButtonStyle = {
    width: 42,
    height: 42,
    minWidth: 42,
    borderRadius: 999,
    padding: 0,
    fontSize: 18,
    fontWeight: 700,
};
const submitButtonStyle = {
    minWidth: 220,
};
const primaryStackStyle = {
    display: "grid",
    gap: 16,
    marginBottom: 16,
};
const editorCardStyle = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(15,23,42,0.45)",
    padding: 16,
    minWidth: 0,
    boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
};
const editorHeaderStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 12,
};
const editorTitleStyle = {
    fontSize: 18,
    fontWeight: 800,
    color: "#f8fafc",
    marginBottom: 4,
};
const editorSubStyle = {
    fontSize: 12,
    color: "#94a3b8",
    lineHeight: 1.6,
};
const counterBadgeStyle = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(255,255,255,0.04)",
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: 700,
};
const textareaStyle = {
    width: "100%",
    minHeight: 280,
    borderRadius: 14,
    padding: "14px 16px",
    fontSize: 14,
    boxSizing: "border-box",
    resize: "vertical",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    lineHeight: 1.7,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.10)",
    color: "#f8fafc",
};
const editorFooterStyle = {
    marginTop: 10,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
};
const helperTextStyle = {
    color: "#94a3b8",
    fontSize: 12,
};
const processedCountStyle = {
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: 700,
};
const progressCardStyle = {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: 14,
    marginBottom: 14,
};
const progressHeaderStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
    flexWrap: "wrap",
};
const progressTitleStyle = {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: 700,
};
const progressPercentStyle = {
    color: "#93c5fd",
    fontSize: 12,
    fontWeight: 700,
};
const progressTrackStyle = {
    height: 10,
    width: "100%",
    borderRadius: 999,
    background: "rgba(255,255,255,0.08)",
    overflow: "hidden",
};
const progressFillStyle = {
    height: "100%",
    background: "linear-gradient(90deg, #0a84ff 0%, #30d158 100%)",
    transition: "width 200ms ease",
};
const progressMetaStyle = {
    marginTop: 8,
    color: "#94a3b8",
    fontSize: 12,
};
const statusCardStyle = {
    borderRadius: 14,
    padding: "12px 14px",
    fontSize: 13,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
};
const statusIdleStyle = {
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    color: "#cbd5e1",
};
const statusSuccessStyle = {
    border: "1px solid rgba(34,197,94,0.25)",
    background: "rgba(34,197,94,0.10)",
    color: "#bbf7d0",
};
const statusWarningStyle = {
    border: "1px solid rgba(245,158,11,0.25)",
    background: "rgba(245,158,11,0.10)",
    color: "#fde68a",
};
const statusErrorStyle = {
    border: "1px solid rgba(239,68,68,0.25)",
    background: "rgba(239,68,68,0.10)",
    color: "#fecaca",
};
const infoPanelStyle = {
    borderRadius: 20,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: 18,
    display: "grid",
    gap: 16,
};
const infoPanelHeaderStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
};
const infoPanelTitleStyle = {
    fontSize: 18,
    fontWeight: 800,
    color: "#f8fafc",
    marginBottom: 4,
};
const infoPanelSubStyle = {
    fontSize: 12,
    color: "#94a3b8",
};
const pillWrapStyle = {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
};
const infoGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: 16,
};
const resultsCardStyle = {
    borderRadius: 18,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: 18,
};
const resultsHeaderStyle = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 12,
};
const resultsTitleStyle = {
    fontSize: 18,
    fontWeight: 800,
    color: "#f8fafc",
    marginBottom: 4,
};
const resultsSubStyle = {
    fontSize: 12,
    color: "#94a3b8",
};
const resultsSummaryStyle = {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
};
const resultsSummarySuccessStyle = {
    display: "inline-flex",
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(34,197,94,0.25)",
    background: "rgba(34,197,94,0.10)",
    color: "#86efac",
    fontSize: 12,
    fontWeight: 700,
};
const resultsSummaryFailStyle = {
    display: "inline-flex",
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(239,68,68,0.25)",
    background: "rgba(239,68,68,0.10)",
    color: "#fca5a5",
    fontSize: 12,
    fontWeight: 700,
};
const emptyResultsStyle = {
    borderRadius: 14,
    border: "1px dashed rgba(148,163,184,0.30)",
    padding: 24,
    color: "#94a3b8",
    textAlign: "center",
};
const thStyle = {
    textAlign: "left",
    padding: "12px 10px",
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: "nowrap",
};
const tdStyle = {
    textAlign: "left",
    padding: "12px 10px",
    color: "#e2e8f0",
    fontSize: 13,
    verticalAlign: "top",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
};
const tdMonoStyle = {
    ...tdStyle,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};
const Pill = ({ label, value }) => {
    return (_jsxs("span", { style: {
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
            color: "#cbd5e1",
            fontSize: 12,
            maxWidth: "100%",
            flexWrap: "wrap",
        }, children: [label, " ", _jsx("b", { style: { color: "#f8fafc", wordBreak: "break-word" }, children: value })] }));
};
const SectionCard = ({ title, children }) => {
    return (_jsxs("div", { style: {
            borderRadius: 18,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
            padding: 16,
            minWidth: 0,
        }, children: [_jsx("div", { style: {
                    fontSize: 16,
                    fontWeight: 800,
                    color: "#f8fafc",
                    marginBottom: 12,
                }, children: title }), _jsx("div", { style: { display: "grid", gap: 8 }, children: children })] }));
};
const RowLine = ({ left, right, rightColor = "#cbd5e1" }) => {
    return (_jsxs("div", { style: {
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
            flexWrap: "wrap",
        }, children: [_jsx("div", { style: {
                    color: "#e2e8f0",
                    fontSize: 13,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    maxWidth: "100%",
                }, children: left }), _jsx("div", { style: {
                    color: rightColor,
                    fontSize: 12,
                    fontWeight: 700,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    textAlign: "right",
                    maxWidth: "100%",
                }, children: right })] }));
};
export default PartsSettingsView;
