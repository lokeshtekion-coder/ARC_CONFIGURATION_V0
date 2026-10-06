import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import "./BlueprintDecoder.css";
import { runDecoder } from "../utils/blueprintFormDecoder";
import { idbSaveBlueprint, idbGetBlueprint } from "../utils/blueprintDb";
import { fetchBlueprintFormResponses, filterBlueprintTargetForms, fetchBlueprintFormDetail, } from "../services/blueprintFormsApi";
import { getStores } from "../services/storesDb";
const logger = {
    info: (...args) => console.info("[BlueprintDecoder]", ...args),
    debug: (...args) => console.debug("[BlueprintDecoder]", ...args),
    warn: (...args) => console.warn("[BlueprintDecoder]", ...args),
    error: (...args) => console.error("[BlueprintDecoder]", ...args),
};
const TYPE_COLORS = {
    DROPDOWN: "#38bdf8",
    SINGLE_CHOICE: "#38bdf8",
    MULTIPLE_CHOICE: "#c084fc",
    RADIO: "#38bdf8",
    CHECKBOX: "#c084fc",
    TEXT: "#4ade80",
    SHORT_TEXT: "#4ade80",
    LONG_TEXT: "#4ade80",
    NUMBER: "#fb923c",
    CURRENCY: "#fbbf24",
    SLIDER: "#fb923c",
    DATE: "#f43f5e",
    TIME: "#f43f5e",
    DATE_TIME: "#f43f5e",
    EMAIL: "#2dd4bf",
    PHONE: "#2dd4bf",
    URL: "#2dd4bf",
    FILE_UPLOAD: "#818cf8",
    PARAGRAPH: "#94a3b8",
    LOGO: "#94a3b8",
    SIGNATURE: "#facc15",
    RATING: "#facc15",
};
const PARTS_EXCLUDED_TITLES = new Set([
    "By signing below, the Parts Champion confirms completion and accuracy of information for Setup configuration.",
    "Do you sell parts online?",
    "Please upload 10 Parts ticket examples with audit copies (Customer & Internal)",
    "Do you use ABC Sourcing / parts movement by sales?",
    "Do you currently receive by OEM shipment number?",
    "Please describe where online you sell parts:",
    "Can parts drivers accept payments?",
    "Name of Submitter",
    "Are there any workflows that your department utilizes that is not considered standard automotive practices?",
    "Do you place stock orders?",
    "Please provide training room details and logistical information:",
    "Parts Main Contact",
    "Email",
    "How do you order OEM, special order parts?",
    "Parts catalog",
    "Is your parts catalog specific to your OEM?",
    "Vertical parts storage",
    "Non-OEM parts ordering",
    "What is the number of wholesale parts invoices written per day?",
    "What is the number of front counter parts invoices written per day?",
    "What is the size of your WIP in service? ($$ parts value on repair orders)",
    "What is your average parts sales per month?",
    "Do you currently use a parts barcode scanner for receiving parts?",
    "Do you use ABC sourcing / parts movement?",
    "Do you use parts kits?",
    "When is your next parts physical inventory?",
    "How do you generate parts material returns?",
    "How do you track your warranty parts returns?",
    "How is your parts factory master loaded into your DMS?",
    "Please upload a purchase order",
    "Please upload a bin label (photo or scan)",
    "Please upload a special order part label (photo or scan)",
    "Are there any state/province, federal or OEM specific reporting which is used daily, weekly, monthly, quarterly or yearly?",
    "Do you want to change your existing parts sources?",
    "Do you want to change your existing parts price level codes?",
]);
const SERVICE_EXCLUDED_TITLES = new Set([
    "Allow Techs to Log on to Multiple Jobs?",
    "For which job types can the techs log on to multiple jobs?",
    "What criteria do you use to pay technicians?",
    "How are RO's dispatched to technicians?",
    "What is your Service Department Direct Phone Number For Customers to Call?",
    "Do you Have a Service Department Email Address?",
    "Do you use a service pricing guide in your current DMS?",
    "If yes, do you present custom service packages or OEM packages only?",
    "Do you present a service menu with set pricing to your customers?",
    "What type of vehicles do you service?",
    "If scheduling in Tekion, please upload your current scheduling settings below",
    "Where will you schedule service appointments when switching to Tekion?",
    "Please upload 10 RO examples with audit copies including Customer Copy, Internal Copy, Warranty Copy.",
    "Please upload your Technican/Advisor Copy of RO",
    "Please upload a copy of any Multi-point Inspection (MPI), PDI/UVI forms if applicable",
    "Please upload 10 Service Invoice examples with Customer copy & audit copies.",
    "Please provide Parts & Service training room details and logistical information:",
    "By signing below, the Service Champion confirms completion and accuracy of information for Setup configuration.",
    "Name of Submitter",
    "Please upload the updated Op codes list here",
    "Please upload your top 50 opcodes by downloading a copy of the template shared below and then upload when ready",
    "Customer Estimate",
    "Technician Estimate",
    "Customer Invoice",
    "Warranty Invoice",
    "Accounting Invoice",
    "Internal Invoice",
    "Customer Damages",
    "Customer MPVI",
    "OEM Service Booklet",
    "What reports do you run monthly?",
    "What reports do you run weekly?",
    "What reports do you run multiple times weekly?",
    "What reports do you run daily?",
    "What reports do you run multiple times daily?",
    "Are there any state/province, federal or OEM specific reporting which is used daily, weekly, monthly, quarterly or yearly?",
    "Please upload a copy of your Multi-point Inspection Form(s)",
    "Please upload 10 RO examples with audit copies",
    "Please upload your Technican/Advisor Copy RO",
    "Please upload 10 Service Invoice examples with audit copies",
    "Please upload an Internal Copy Service Invoice",
    "Please upload an example of your Labor Grid",
    "PDF Invoice Copies",
    "Display BAR and EPA in PDF Footer",
    "Display Tire Pressure Checks in Invoice Legal Terms",
    "Check all that apply",
    "Display Technician(s) on Customer PDF Invoice",
    "Display Cause on Customer PDF Invoice",
    "Please select all of the documents that are generated and / or print when the RO or Service Invoice is created",
    "Submitter Email",
    "Please list all 3rd party vendor applications:",
    "Do you offer/utilize a service department financing option for your customers?",
    "Do you offer/utilize a Ride Share program for your customers?",
    "What rental car software do you utilize?",
    "Do you use any external applications for texting?",
    "Do you use any external applications for mobile write-up?",
    "Do you use any external applications for analytics or reporting?",
    "Where are service campaigns generated from?",
    "Where are mobile payments taken?",
    "Where are appointments taken?",
    "What is the size of your service WIP? ($$ amount)",
    "What is the size of your service WIP? (# of RO's)",
    "Are there any 3rd party contractors or remote employees that access the DMS?",
    "Which tool(s) are used to write repair orders?",
    "What is your Tech to PC ratio?",
    "Are your current payment terminals integrated with your existing DMS?",
    "Who is your credit card processing company?",
    "When is the cash drawer reconciled to the DMS?",
    "Who reconciles the cash drawer to the DMS?",
    "Who accepts customer payment?",
    "Please describe your customer loyalty program",
    "Do you have a customer loyalty program?",
    "How do you submit warranty claims?",
    "How do you access labor time guides for warranty labor operations?",
    "If yes, please upload your matrix here",
]);
const ACCOUNTING_EXCLUDED_TITLES = new Set([
    "How many years of DMS data do you need converted?",
    "How many years of PDF document data do you need converted?",
    "Please describe the employee # range that needs to be reserved",
    "Do you have a dedicated employee # range that needs to be reserved?",
    "For vendors generated from ARC, from which # would you like the sequence to begin?",
    "Do you have a preference regarding the starting number sequence for VENDOR #s generated from ARC?",
    "For customers generated from ARC, from which # would you like the sequence to begin?",
    "Do you have a preference regarding the starting number sequence for CUSTOMER #s generated from ARC?",
    "Please specify who closes the internal RO's",
    "Who final closes internal Repair Orders?",
    "What time does your job stack or overnight batch process run?",
    "Do your parts/service accounting entries post overnight or real time?",
    "How frequently do you reconcile your bank?",
    "Do you use an accounting upload function in your current DMS?",
    "Do you currently have Positive Pay integration that you use?",
    "How do you receive your warranty credit statement?",
    "How do you post your warranty credits to accounting?",
    "Do these documents need to be converted into ARC?",
    "If you utilize a document management / archiving system, please select all that apply:",
    "Do you utilize a document management / archiving system?",
    "How do you generate 8300 forms?",
    "How do you generate 1099's?",
    "Do you process intercompany transactions between stores in your current DMS?",
    "Do you utilize any G/L or Journal restrictions?",
    "Do you schedule your WIP?",
    "How are payroll checks currently being printed?",
    "How do you post payroll to accounting?",
    "How many retained earnings accounts do you have?",
    "Do you transfer Income Statement balances to Retained Earnings on December 31?",
    "Does your fiscal year end December 31?",
    "Do you operate using a fiscal or calendar year?",
    "What date do you typically formally close the month in your DMS?",
    "What date do you typically submit your financial statement?",
    "Do all users currently have an e-mail address with the dealership domain?",
    "By signing below, the Accounting Champion confirms completion and accuracy of information for Setup configuration",
    "Please upload a list of your expense allocations/split accounts",
    "Please upload last month's financial statement",
    "Please upload your prior year financial statement",
    "Please upload last month's Trial Balance",
    "Please upload your prior year Trial Balance",
    "Please upload your Financial Statement mapping in Excel",
    "Please upload a voided check",
    "Please upload an A/R statement",
    "Please upload a list of your journals",
]);
function typeColor(type) {
    return TYPE_COLORS[type] ?? "#94a3b8";
}
function isMediaObject(val) {
    return (typeof val === "object" &&
        val !== null &&
        "mediaId" in val &&
        "url" in val &&
        typeof val.url === "string");
}
function buildTekionMediaUrl(media) {
    const BUCKET_PREFIX = "com-tekioncloud-tap-dealeronboarding/";
    const BASE_URL = "https://tap.tekioncloud.com/dealer-onboarding/forms/pdf?";
    const rawPath = media.url.startsWith(BUCKET_PREFIX)
        ? media.url.slice(BUCKET_PREFIX.length)
        : media.url;
    return `${BASE_URL}${encodeURI(rawPath)}`;
}
function tryParseMedia(val) {
    if (isMediaObject(val))
        return val;
    if (typeof val === "string") {
        const trimmed = val.trim();
        if (trimmed.startsWith("{") && trimmed.includes('"mediaId"') && trimmed.includes('"url"')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (isMediaObject(parsed))
                    return parsed;
            }
            catch {
                return null;
            }
        }
    }
    return null;
}
function tryParseMediaArray(val) {
    if (Array.isArray(val)) {
        const list = [];
        for (const item of val) {
            const parsed = tryParseMedia(item);
            if (parsed)
                list.push(parsed);
            else
                return null;
        }
        return list.length > 0 ? list : null;
    }
    if (typeof val === "string") {
        const trimmed = val.trim();
        if (trimmed.startsWith("[") && trimmed.includes('"mediaId"') && trimmed.includes('"url"')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed))
                    return tryParseMediaArray(parsed);
            }
            catch {
                return null;
            }
        }
    }
    return null;
}
function renderValueUI(value) {
    if (value === null || value === undefined) {
        return _jsx("span", { className: "bd-no-value", children: "No answer provided" });
    }
    const singleMedia = tryParseMedia(value);
    if (singleMedia) {
        const fileUrl = buildTekionMediaUrl(singleMedia);
        const displayName = singleMedia.filename || "View Attached Document";
        return (_jsxs("a", { href: fileUrl, target: "_blank", rel: "noreferrer", className: "bd-link-pill", title: displayName, children: [_jsx("span", { children: "\uD83D\uDCC4" }), displayName] }));
    }
    const mediaList = tryParseMediaArray(value);
    if (mediaList) {
        return (_jsx("div", { className: "bd-array-wrap", children: mediaList.map((m, idx) => {
                const fileUrl = buildTekionMediaUrl(m);
                const displayName = m.filename || `Document ${idx + 1}`;
                return (_jsxs("a", { href: fileUrl, target: "_blank", rel: "noreferrer", className: "bd-link-pill", title: displayName, children: [_jsx("span", { children: "\uD83D\uDCC4" }), displayName] }, m.mediaId || idx));
            }) }));
    }
    if (typeof value === "boolean") {
        return (_jsx("span", { className: `bd-bool-pill ${value ? "is-yes" : "is-no"}`, children: value ? "✓ Yes" : "✕ No" }));
    }
    if (typeof value === "number") {
        return _jsx("span", { className: "bd-num-pill", children: value.toLocaleString() });
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed)
            return _jsx("span", { className: "bd-no-value", children: "No answer provided" });
        if (/^https?:\/\//i.test(trimmed)) {
            return (_jsxs("a", { href: trimmed, target: "_blank", rel: "noreferrer", className: "bd-link-pill", title: trimmed, children: [_jsx("span", { children: "\uD83D\uDD17" }), trimmed] }));
        }
        return _jsx("div", { className: "bd-str-value", children: trimmed });
    }
    if (Array.isArray(value)) {
        if (value.length === 0)
            return _jsx("span", { className: "bd-no-value", children: "Empty selection" });
        return (_jsx("div", { className: "bd-array-wrap", children: value.map((v, i) => {
                const itemMedia = tryParseMedia(v);
                if (itemMedia) {
                    const fileUrl = buildTekionMediaUrl(itemMedia);
                    const displayName = itemMedia.filename || "View Attached Document";
                    return (_jsxs("a", { href: fileUrl, target: "_blank", rel: "noreferrer", className: "bd-link-pill", title: displayName, children: [_jsx("span", { children: "\uD83D\uDCC4" }), displayName] }, itemMedia.mediaId || i));
                }
                return (_jsx("span", { className: "bd-array-item", children: typeof v === "object" ? JSON.stringify(v) : String(v) }, i));
            }) }));
    }
    return (_jsx("pre", { className: "bd-json-blob", children: _jsx("code", { children: JSON.stringify(value, null, 2) }) }));
}
function fmtText(value) {
    if (value === null || value === undefined)
        return "—";
    const singleMedia = tryParseMedia(value);
    if (singleMedia) {
        return `${singleMedia.filename || "Document"} (${buildTekionMediaUrl(singleMedia)})`;
    }
    const mediaList = tryParseMediaArray(value);
    if (mediaList) {
        return mediaList
            .map((m) => `${m.filename || "Document"} (${buildTekionMediaUrl(m)})`)
            .join(", ");
    }
    if (typeof value === "string")
        return value.trim() || "—";
    if (typeof value === "boolean")
        return value ? "Yes" : "No";
    if (typeof value === "number")
        return String(value);
    if (Array.isArray(value))
        return value.map((v) => fmtText(v)).join(", ");
    return JSON.stringify(value, null, 2);
}
function downloadCsv(rows, filename = "blueprint-decoded.csv") {
    const keys = [
        "sectionName",
        "sectionId",
        "fieldId",
        "title",
        "type",
        "required",
        "decodedValue",
    ];
    const csv = [
        keys.join(","),
        ...rows.map((r) => keys.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), {
        href: url,
        download: filename,
    });
    a.click();
    URL.revokeObjectURL(url);
}
function parseLaunchDate(value) {
    if (!value)
        return null;
    if (/^\d+$/.test(value)) {
        if (value.length === 8) {
            const year = parseInt(value.slice(0, 4), 10);
            const month = parseInt(value.slice(4, 6), 10) - 1;
            const day = parseInt(value.slice(6, 8), 10);
            const d = new Date(year, month, day);
            return Number.isNaN(d.getTime()) ? null : d;
        }
        const num = Number(value);
        const ms = value.length <= 10 ? num * 1000 : num;
        const d = new Date(ms);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}
function getTLabel(value) {
    const d = parseLaunchDate(value);
    if (!d)
        return { label: "Unknown", tone: "unknown", diffDays: null };
    const today = new Date();
    const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const launchDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diffMs = launchDay.getTime() - startToday.getTime();
    const diffDays = Math.round(diffMs / 86400000);
    if (diffDays > 0)
        return { label: `T-${diffDays}`, tone: "future", diffDays };
    if (diffDays === 0)
        return { label: "T-Day", tone: "today", diffDays };
    return { label: "Launched", tone: "past", diffDays };
}
function isT90Store(store) {
    const t = getTLabel(store.launch_date);
    return t.diffDays !== null && t.diffDays >= 0 && t.diffDays <= 90;
}
const TypeBadge = ({ type }) => {
    const color = typeColor(type);
    return (_jsxs("span", { className: "bd-type-badge", style: {
            color,
            background: `${color}14`,
            borderColor: `${color}30`,
        }, children: [_jsx("span", { className: "bd-type-dot", style: { background: color } }), type] }));
};
const Spinner = ({ size = 15 }) => (_jsxs("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round", className: "bd-spin", children: [_jsx("circle", { cx: "12", cy: "12", r: "10", strokeOpacity: "0.2" }), _jsx("path", { d: "M12 2a10 10 0 0 1 10 10" })] }));
const SectionsView = ({ sections, populatedOnly }) => (_jsx("div", { className: "bd-sections-stack", children: sections.map((section) => {
        const fields = populatedOnly
            ? section.fields.filter((f) => f.hasUserValue && f.decodedValue != null && f.decodedValue !== "")
            : section.fields;
        if (fields.length === 0)
            return null;
        return (_jsxs("div", { className: "bd-section-card", children: [_jsxs("div", { className: "bd-section-head", children: [_jsxs("div", { className: "bd-section-title-wrap", children: [_jsx("span", { className: "bd-section-icon", children: "\uD83D\uDCCB" }), _jsx("span", { className: "bd-section-name", children: section.sectionName ?? "(Untitled Section)" })] }), _jsxs("span", { className: "bd-section-pill", children: [fields.length, " ", fields.length === 1 ? "field" : "fields"] })] }), _jsx("div", { className: "bd-table-wrap", children: _jsxs("table", { className: "bd-table", style: {
                            width: "100%",
                            tableLayout: "fixed",
                            borderCollapse: "collapse",
                            display: "table",
                        }, children: [_jsx("thead", { style: { display: "table-header-group" }, children: _jsxs("tr", { style: { display: "table-row" }, children: [_jsx("th", { className: "bd-th-question", style: {
                                                width: "42%",
                                                display: "table-cell",
                                                textAlign: "left",
                                                padding: "10px 16px",
                                                color: "#94a3b8",
                                                fontSize: "11px",
                                                fontWeight: 700,
                                                letterSpacing: "0.05em",
                                                textTransform: "uppercase",
                                                visibility: "visible",
                                            }, children: "Question / Context" }), _jsx("th", { className: "bd-th-answer", style: {
                                                width: "43%",
                                                display: "table-cell",
                                                textAlign: "left",
                                                padding: "10px 16px",
                                                color: "#94a3b8",
                                                fontSize: "11px",
                                                fontWeight: 700,
                                                letterSpacing: "0.05em",
                                                textTransform: "uppercase",
                                                visibility: "visible",
                                            }, children: "Decoded Answer" }), _jsx("th", { className: "bd-th-type", style: {
                                                width: "15%",
                                                display: "table-cell",
                                                textAlign: "left",
                                                padding: "10px 16px",
                                                color: "#94a3b8",
                                                fontSize: "11px",
                                                fontWeight: 700,
                                                letterSpacing: "0.05em",
                                                textTransform: "uppercase",
                                                visibility: "visible",
                                            }, children: "Field Type" })] }) }), _jsx("tbody", { style: { display: "table-row-group" }, children: fields.map((field) => (_jsxs("tr", { className: field.hasUserValue ? "" : "bd-row-muted", style: { display: "table-row" }, children: [_jsxs("td", { className: "bd-cell-title", style: {
                                                display: "table-cell",
                                                overflowWrap: "break-word",
                                                verticalAlign: "top",
                                                padding: "12px 16px",
                                            }, children: [field.subsectionName && (_jsx("div", { className: "bd-sub-badge", children: field.subsectionName })), _jsx("div", { className: `bd-title-text ${field.hasUserValue ? "" : field.required ? "bd-title-missing" : "bd-title-missing-optional"}`, children: field.title ?? field.fieldName ?? field.fieldId }), _jsx("code", { className: "bd-field-subid", children: field.fieldId })] }), _jsx("td", { className: "bd-cell-value", style: {
                                                display: "table-cell",
                                                overflowWrap: "break-word",
                                                verticalAlign: "top",
                                                padding: "12px 16px",
                                            }, children: renderValueUI(field.decodedValue) }), _jsx("td", { className: "bd-cell-type", style: {
                                                display: "table-cell",
                                                overflowWrap: "break-word",
                                                verticalAlign: "top",
                                                padding: "12px 16px",
                                            }, children: _jsx(TypeBadge, { type: field.type }) })] }, field.fieldId))) })] }) })] }, section.sectionId));
    }) }));
const FlatView = ({ rows }) => (_jsx("div", { className: "bd-section-card", children: _jsx("div", { className: "bd-table-wrap", children: _jsxs("table", { className: "bd-table", style: {
                width: "100%",
                tableLayout: "fixed",
                borderCollapse: "collapse",
                display: "table",
            }, children: [_jsx("thead", { style: { display: "table-header-group" }, children: _jsxs("tr", { style: { display: "table-row" }, children: [_jsx("th", { style: { width: "20%", display: "table-cell", padding: "10px 16px" }, children: "Section" }), _jsx("th", { style: { width: "35%", display: "table-cell", padding: "10px 16px" }, children: "Question / Title" }), _jsx("th", { style: { width: "35%", display: "table-cell", padding: "10px 16px" }, children: "Decoded Answer" }), _jsx("th", { style: { width: "10%", display: "table-cell", padding: "10px 16px" }, children: "Type" })] }) }), _jsx("tbody", { style: { display: "table-row-group" }, children: rows.map((row, i) => (_jsxs("tr", { style: { display: "table-row" }, children: [_jsx("td", { className: "bd-cell-section", style: { display: "table-cell", padding: "12px 16px" }, children: _jsx("span", { className: "bd-section-tag", children: row.sectionName ?? "—" }) }), _jsxs("td", { className: "bd-cell-title", style: { display: "table-cell", padding: "12px 16px" }, children: [row.subsectionName && _jsx("div", { className: "bd-sub-badge", children: row.subsectionName }), _jsx("div", { className: `bd-title-text ${row.hasUserValue ? "" : row.required ? "bd-title-missing" : "bd-title-missing-optional"}`, children: row.title ?? row.fieldId }), _jsx("code", { className: "bd-field-subid", children: row.fieldId })] }), _jsx("td", { className: "bd-cell-value", style: { display: "table-cell", padding: "12px 16px" }, children: row.hasUserValue ? (renderValueUI(row.decodedValue)) : (_jsx("span", { className: "bd-no-value", children: "No answer provided" })) }), _jsx("td", { style: { display: "table-cell", padding: "12px 16px" }, children: _jsx(TypeBadge, { type: row.type }) })] }, `${row.fieldId}-${i}`))) })] }) }) }));
const CsvView = ({ rows, onDownload, }) => (_jsxs("div", { className: "bd-section-card", children: [_jsxs("div", { className: "bd-csv-toolbar", children: [_jsxs("div", { children: [_jsxs("span", { className: "bd-csv-badge", children: [rows.length, " records"] }), _jsx("span", { className: "bd-csv-hint", children: "Structured for export or reporting" })] }), _jsx("button", { className: "bd-btn bd-btn-primary", onClick: onDownload, children: "\u2B07 Export CSV" })] }), _jsx("div", { className: "bd-table-wrap", children: _jsxs("table", { className: "bd-table", style: { width: "100%", tableLayout: "fixed" }, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { style: { width: "18%" }, children: "Section" }), _jsx("th", { style: { width: "16%" }, children: "Field ID" }), _jsx("th", { style: { width: "32%" }, children: "Title" }), _jsx("th", { style: { width: "24%" }, children: "Decoded Value" }), _jsx("th", { style: { width: "10%" }, children: "Type" })] }) }), _jsx("tbody", { children: rows.map((row, i) => (_jsxs("tr", { children: [_jsx("td", { className: "bd-cell-section", children: row.sectionName }), _jsx("td", { children: _jsx("code", { className: "bd-field-subid", children: row.fieldId }) }), _jsx("td", { className: "bd-cell-title", children: row.title }), _jsx("td", { className: "bd-cell-value", children: _jsx("span", { className: "bd-str-value", children: row.decodedValue }) }), _jsx("td", { children: _jsx(TypeBadge, { type: row.type }) })] }, `${row.fieldId}-${i}`))) })] }) })] }));
const HumanView = ({ text }) => (_jsx("div", { className: "bd-section-card", children: _jsx("pre", { className: "bd-human-pre", children: text || "(No populated responses available)" }) }));
const StorePickerModal = ({ open, stores, search, onSearchChange, selectedStore, onSelect, onClose, }) => {
    const [localSearch, setLocalSearch] = useState(search);
    useEffect(() => {
        if (open)
            setLocalSearch(search);
    }, [open, search]);
    useEffect(() => {
        const timer = setTimeout(() => onSearchChange(localSearch), 250);
        return () => clearTimeout(timer);
    }, [localSearch, onSearchChange]);
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === "Escape")
                onClose();
        };
        if (open)
            window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [open, onClose]);
    if (!open)
        return null;
    return (_jsx("div", { className: "bd-modal-backdrop", onClick: onClose, children: _jsxs("div", { className: "bd-modal-box", onClick: (e) => e.stopPropagation(), children: [_jsxs("div", { className: "bd-modal-head", children: [_jsxs("div", { children: [_jsx("div", { className: "bd-modal-title", children: "Select T-90 Target Store" }), _jsx("div", { className: "bd-modal-sub", children: "Filtered stores launching within 90 days" })] }), _jsx("button", { className: "bd-icon-btn", onClick: onClose, title: "Close", children: "\u2715" })] }), _jsxs("div", { className: "bd-modal-search", children: [_jsx("span", { className: "bd-search-icon", children: "\uD83D\uDD0D" }), _jsx("input", { type: "text", className: "bd-input", value: localSearch, onChange: (e) => setLocalSearch(e.target.value), placeholder: "Search Tekion ID, Dealer ID, or Dealership Name...", autoFocus: true })] }), _jsx("div", { className: "bd-modal-list", children: stores.length === 0 ? (_jsx("div", { className: "bd-empty-hint", children: "No T-90 stores match your query." })) : (stores.map((store) => {
                        const active = selectedStore?.tekion_id === store.tekion_id;
                        const tStatus = getTLabel(store.launch_date);
                        return (_jsxs("button", { type: "button", className: `bd-store-item ${active ? "is-active" : ""}`, onClick: () => {
                                onSelect(store);
                                onClose();
                            }, children: [_jsxs("div", { className: "bd-store-item-info", children: [_jsxs("div", { className: "bd-store-item-title", children: [_jsxs("span", { children: [store.tekion_id, "_", store.dealer_id] }), _jsx("span", { className: `bd-t-badge tone-${tStatus.tone}`, children: tStatus.label })] }), _jsx("div", { className: "bd-store-item-desc", children: store.dba_name || "—" })] }), _jsx("span", { className: "bd-store-item-arrow", children: "\u2192" })] }, store.tekion_id));
                    })) })] }) }));
};
function moduleLabel(module) {
    if (module === "parts")
        return "Parts";
    if (module === "service")
        return "Service";
    return "Accounting";
}
export function detectModuleFromFormName(formName) {
    const name = formName.toLowerCase();
    if (name.includes("parts"))
        return "parts";
    if (name.includes("service"))
        return "service";
    if (name.includes("accounting"))
        return "accounting";
    return null;
}
function getExcludedTitleSet(module) {
    if (module === "parts")
        return PARTS_EXCLUDED_TITLES;
    if (module === "service")
        return SERVICE_EXCLUDED_TITLES;
    if (module === "accounting")
        return ACCOUNTING_EXCLUDED_TITLES;
    return new Set();
}
export function filterDecodedResultByExcludedTitles(decoded, module) {
    const excludedTitles = getExcludedTitleSet(module);
    if (excludedTitles.size === 0)
        return decoded;
    const filteredSections = decoded.decodedSections
        .map((section) => ({
        ...section,
        fields: section.fields.filter((field) => !excludedTitles.has(field.title ?? "")),
    }))
        .filter((section) => section.fields.length > 0);
    const filteredAllFields = decoded.allFields.filter((field) => !excludedTitles.has(field.title ?? ""));
    const filteredPopulatedFlatRows = decoded.populatedFlatRows.filter((row) => !excludedTitles.has(row.title ?? ""));
    const filteredCsvReadyRows = decoded.csvReadyRows.filter((row) => !excludedTitles.has(row.title ?? ""));
    const filteredHumanReadable = filteredPopulatedFlatRows
        .map((row) => {
        const section = row.sectionName ?? "—";
        const subsection = row.subsectionName ?? "—";
        const title = row.title ?? row.fieldId;
        const value = fmtText(row.decodedValue);
        return `[${section} > ${subsection}] ${title}: ${value}`;
    })
        .join("\n");
    return {
        ...decoded,
        decodedSections: filteredSections,
        allFields: filteredAllFields,
        populatedFlatRows: filteredPopulatedFlatRows,
        csvReadyRows: filteredCsvReadyRows,
        humanReadable: filteredHumanReadable,
    };
}
export const BlueprintDecoder = ({ onBack }) => {
    const [inputMode, setInputMode] = useState("auto");
    const [jsonText, setJsonText] = useState("");
    const [isDragging, setIsDragging] = useState(false);
    const [viewMode, setViewMode] = useState("sections");
    const [populatedOnly, setPopulatedOnly] = useState(true);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [saveKey, setSaveKey] = useState("");
    const [dealerName, setDealerName] = useState("");
    const [formName, setFormName] = useState("");
    const [saveStatus, setSaveStatus] = useState("idle");
    const [saveError, setSaveError] = useState(null);
    const [storeRecords, setStoreRecords] = useState([]);
    const [storeLoading, setStoreLoading] = useState(false);
    const [storeSearch, setStoreSearch] = useState("");
    const [selectedStore, setSelectedStore] = useState(null);
    const [storeModalOpen, setStoreModalOpen] = useState(false);
    const [autoModules, setAutoModules] = useState([
        "parts",
        "service",
        "accounting",
    ]);
    const [autoLoading, setAutoLoading] = useState(false);
    const [autoForms, setAutoForms] = useState([]);
    const [autoMessage, setAutoMessage] = useState(null);
    const [autoDecodedResults, setAutoDecodedResults] = useState([]);
    const [activeAutoModule, setActiveAutoModule] = useState(null);
    const [saveAllStatus, setSaveAllStatus] = useState("idle");
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);
    const textareaRef = useRef(null);
    const restoreRef = useRef(null);
    const activeAutoResult = activeAutoModule != null
        ? autoDecodedResults.find((item) => item.module === activeAutoModule) ?? null
        : null;
    const loadStoreRecords = useCallback(async () => {
        setStoreLoading(true);
        try {
            const data = await getStores();
            logger.info("Loaded stores from IndexedDB", { count: data.length });
            setStoreRecords(data);
        }
        catch (e) {
            logger.error("Failed to load stores from IndexedDB", e);
            setError(e instanceof Error ? e.message : "Failed to load stores from IndexedDB");
        }
        finally {
            setStoreLoading(false);
        }
    }, []);
    useEffect(() => {
        void loadStoreRecords();
    }, [loadStoreRecords]);
    const t90Stores = useMemo(() => storeRecords.filter(isT90Store), [storeRecords]);
    const filteredStoreList = useMemo(() => {
        const q = storeSearch.trim().toLowerCase();
        if (!q)
            return t90Stores;
        return t90Stores.filter((row) => {
            return (row.tekion_id.toLowerCase().includes(q) ||
                row.dealer_id.toLowerCase().includes(q) ||
                row.dba_name.toLowerCase().includes(q));
        });
    }, [t90Stores, storeSearch]);
    const matchedModuleMap = useMemo(() => {
        const map = {
            parts: false,
            service: false,
            accounting: false,
        };
        for (const form of autoForms) {
            const module = detectModuleFromFormName(form.formName);
            if (module)
                map[module] = true;
        }
        return map;
    }, [autoForms]);
    const handleDecode = useCallback(async () => {
        if (!jsonText.trim()) {
            setError("Paste a JSON payload first.");
            return;
        }
        try {
            const payload = JSON.parse(jsonText);
            const raw = payload;
            const dn = (raw?.data?.formData?.releasedDealerName ?? "").trim();
            const fn = (raw?.data?.formName ?? "").trim();
            const key = `${dn || "manual"}-${fn}`
                .replace(/\s+/g, "_")
                .replace(/[^a-zA-Z0-9_\-]/g, "");
            const detectedModule = detectModuleFromFormName(fn);
            const decoded = runDecoder(payload);
            const filteredDecoded = filterDecodedResultByExcludedTitles(decoded, detectedModule);
            setDealerName(dn);
            setFormName(fn);
            setSaveKey(key);
            setSaveError(null);
            setResult(filteredDecoded);
            setError(null);
            setAutoDecodedResults([]);
            setActiveAutoModule(null);
            if (key) {
                const existing = await idbGetBlueprint(key);
                setSaveStatus(existing ? "exists" : "idle");
            }
            else {
                setSaveStatus("idle");
            }
        }
        catch (e) {
            logger.error("Failed to decode JSON payload", e);
            setError(e instanceof Error ? `JSON Error: ${e.message}` : "Invalid JSON");
            setResult(null);
            setSaveStatus("idle");
        }
    }, [jsonText]);
    const handleDragOver = useCallback((e) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);
    const handleDragLeave = useCallback((e) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);
    const handleDrop = useCallback(async (e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && (file.type === "application/json" || file.name.endsWith(".json"))) {
            try {
                const text = await file.text();
                setJsonText(text);
                setError(null);
            }
            catch {
                setError("Failed to read dropped file");
            }
        }
        else {
            setError("Please drop a valid .json file");
        }
    }, []);
    const handleAutoFetch = useCallback(async () => {
        if (!selectedStore?.tekion_id?.trim()) {
            setError("Select a store first.");
            return;
        }
        if (autoModules.length === 0) {
            setError("Select at least one module.");
            return;
        }
        const tekionId = selectedStore.tekion_id.trim();
        setAutoLoading(true);
        setError(null);
        setAutoMessage(null);
        setAutoForms([]);
        setAutoDecodedResults([]);
        setActiveAutoModule(null);
        setResult(null);
        setSaveKey("");
        setDealerName("");
        setFormName("");
        setSaveStatus("idle");
        setSaveError(null);
        setSaveAllStatus("idle");
        try {
            const forms = await fetchBlueprintFormResponses(tekionId);
            const filtered = filterBlueprintTargetForms(forms, autoModules);
            setAutoForms(filtered);
            if (filtered.length === 0) {
                setAutoMessage("No matching blueprint conquest forms found for selected modules.");
                return;
            }
            const pickedByModule = new Map();
            for (const form of filtered) {
                const module = detectModuleFromFormName(form.formName);
                if (!module)
                    continue;
                if (!autoModules.includes(module))
                    continue;
                if (!pickedByModule.has(module)) {
                    pickedByModule.set(module, form);
                }
            }
            const results = [];
            for (const module of autoModules) {
                const form = pickedByModule.get(module);
                if (!form)
                    continue;
                const detail = (await fetchBlueprintFormDetail(form.formId, form.releaseId));
                const decoded = runDecoder(detail);
                const filteredDecoded = filterDecodedResultByExcludedTitles(decoded, module);
                const rawDetail = detail;
                const dn = String(rawDetail?.data?.formData?.releasedDealerName ||
                    form.dealerName ||
                    selectedStore.dba_name ||
                    "").trim();
                const fn = String(rawDetail?.data?.formName ?? form.formName ?? "").trim();
                const key = `${tekionId}-${fn}`
                    .replace(/\s+/g, "_")
                    .replace(/[^a-zA-Z0-9_\-]/g, "");
                results.push({
                    module,
                    form,
                    detail,
                    decoded: filteredDecoded,
                    dealerName: dn,
                    formName: fn,
                    saveKey: key,
                });
            }
            setAutoDecodedResults(results);
            if (results.length === 0) {
                setAutoMessage("Matching forms were found, but no valid module detail could be decoded.");
                return;
            }
            const firstResult = results[0];
            setActiveAutoModule(firstResult.module);
            setResult(firstResult.decoded);
            setDealerName(firstResult.dealerName);
            setFormName(firstResult.formName);
            setSaveKey(firstResult.saveKey);
            if (firstResult.saveKey) {
                const existing = await idbGetBlueprint(firstResult.saveKey);
                setSaveStatus(existing ? "exists" : "idle");
            }
            else {
                setSaveStatus("idle");
            }
            setAutoMessage(`Decoded ${results.length} form(s): ${results.map((r) => moduleLabel(r.module)).join(", ")}`);
        }
        catch (e) {
            logger.error("Auto fetch workflow failed", e);
            setError(e instanceof Error ? e.message : "Auto fetch failed");
            setResult(null);
        }
        finally {
            setAutoLoading(false);
        }
    }, [selectedStore, autoModules]);
    const handleSelectAutoResult = useCallback(async (module) => {
        const selected = autoDecodedResults.find((item) => item.module === module);
        if (!selected)
            return;
        setActiveAutoModule(module);
        setResult(selected.decoded);
        setDealerName(selected.dealerName);
        setFormName(selected.formName);
        setSaveKey(selected.saveKey);
        setError(null);
        if (selected.saveKey) {
            const existing = await idbGetBlueprint(selected.saveKey);
            setSaveStatus(existing ? "exists" : "idle");
        }
        else {
            setSaveStatus("idle");
        }
    }, [autoDecodedResults]);
    const toggleModule = useCallback((module) => {
        setAutoModules((prev) => prev.includes(module) ? prev.filter((m) => m !== module) : [...prev, module]);
    }, []);
    const handleSave = async () => {
        if (!saveKey || !result)
            return;
        setSaveStatus("saving");
        setSaveError(null);
        try {
            const active = activeAutoResult;
            const record = active
                ? {
                    key: saveKey,
                    tekionId: active.form.tekionId,
                    dealerId: selectedStore?.dealer_id ?? "",
                    dealerName,
                    formName,
                    formId: active.form.formId,
                    releaseId: active.form.releaseId,
                    status: active.form.status,
                    rawResponse: active.detail,
                    decodedResponse: active.decoded,
                    savedAt: new Date().toISOString(),
                }
                : {
                    key: saveKey,
                    dealerName,
                    formName,
                    data: result,
                    savedAt: new Date().toISOString(),
                };
            await idbSaveBlueprint(record);
            const res = await fetch("http://localhost:4000/api/validation/blueprint-save", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: saveKey, data: record }),
            });
            if (!res.ok)
                throw new Error(`Server: HTTP ${res.status}`);
            setSaveStatus("saved");
        }
        catch (err) {
            logger.error("Failed to save blueprint", err);
            setSaveStatus("error");
            setSaveError(err instanceof Error ? err.message : "Save failed");
        }
    };
    const handleSaveAll = useCallback(async () => {
        if (autoDecodedResults.length === 0)
            return;
        setSaveAllStatus("saving");
        setSaveError(null);
        const errors = [];
        await Promise.allSettled(autoDecodedResults.map(async (item) => {
            try {
                const record = {
                    key: item.saveKey,
                    tekionId: item.form.tekionId,
                    dealerId: selectedStore?.dealer_id ?? "",
                    dealerName: item.dealerName,
                    formName: item.formName,
                    formId: item.form.formId,
                    releaseId: item.form.releaseId,
                    status: item.form.status,
                    rawResponse: item.detail,
                    decodedResponse: item.decoded,
                    savedAt: new Date().toISOString(),
                };
                await idbSaveBlueprint(record);
                const res = await fetch("http://localhost:4000/api/validation/blueprint-save", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ key: item.saveKey, data: record }),
                });
                if (!res.ok)
                    throw new Error(`Server: HTTP ${res.status}`);
            }
            catch (err) {
                errors.push(`Failed saving ${item.formName}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }));
        if (errors.length > 0) {
            setSaveAllStatus("error");
            setSaveError(errors.join(" | "));
        }
        else {
            setSaveAllStatus("saved");
        }
    }, [autoDecodedResults, selectedStore]);
    const handleRestoreFromFile = useCallback(async (e) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        try {
            const text = await file.text();
            const record = JSON.parse(text);
            if (!record.key)
                throw new Error("Invalid blueprint file — missing key");
            const module = detectModuleFromFormName(record.formName ?? "");
            const restoredDecoded = record.decodedResponse ?? record.data;
            const filteredRestoredDecoded = restoredDecoded
                ? filterDecodedResultByExcludedTitles(restoredDecoded, module)
                : undefined;
            const restoredRecord = {
                ...record,
                data: record.data
                    ? filterDecodedResultByExcludedTitles(record.data, module)
                    : record.data,
                decodedResponse: record.decodedResponse
                    ? filterDecodedResultByExcludedTitles(record.decodedResponse, module)
                    : record.decodedResponse,
            };
            await idbSaveBlueprint(restoredRecord);
            if (filteredRestoredDecoded)
                setResult(filteredRestoredDecoded);
            setDealerName(record.dealerName ?? "");
            setFormName(record.formName ?? "");
            setSaveKey(record.key);
            setSaveStatus("saved");
            setError(null);
            setJsonText("");
            setAutoDecodedResults([]);
            setActiveAutoModule(null);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "Failed to restore from file");
        }
        e.target.value = "";
    }, []);
    const handleClear = useCallback(() => {
        setJsonText("");
        setResult(null);
        setError(null);
        setSaveKey("");
        setDealerName("");
        setFormName("");
        setSaveStatus("idle");
        setSaveError(null);
        setAutoMessage(null);
        setAutoForms([]);
        setAutoDecodedResults([]);
        setActiveAutoModule(null);
        setSaveAllStatus("idle");
        textareaRef.current?.focus();
    }, []);
    const totalSections = result?.decodedSections.length ?? 0;
    const totalFields = result?.allFields.length ?? 0;
    const answered = result?.populatedFlatRows.length ?? 0;
    const answeredPct = totalFields > 0 ? Math.round((answered / totalFields) * 100) : 0;
    const flatRows = populatedOnly ? result?.populatedFlatRows ?? [] : result?.allFields ?? [];
    const VIEW_TABS = [
        ["sections", "By Section"],
        ["flat", "Flat Rows"],
        ["csv", "CSV Ready"],
        ["human", "Document Summary"],
    ];
    return (_jsxs(_Fragment, { children: [_jsx("style", { children: `
        .bd-table {
          width: 100% !important;
          table-layout: fixed !important;
          border-collapse: collapse !important;
          display: table !important;
        }
        .bd-table thead {
          display: table-header-group !important;
          visibility: visible !important;
          opacity: 1 !important;
          background: #0f172a !important;
        }
        .bd-table thead tr {
          display: table-row !important;
          visibility: visible !important;
        }
        .bd-table thead th {
          display: table-cell !important;
          visibility: visible !important;
          opacity: 1 !important;
          color: #94a3b8 !important;
          font-size: 11px !important;
          font-weight: 700 !important;
          text-transform: uppercase !important;
          letter-spacing: 0.05em !important;
          padding: 12px 16px !important;
          border-bottom: 1px solid #334155 !important;
        }
        .bd-table tbody {
          display: table-row-group !important;
        }
        .bd-table tbody tr {
          display: table-row !important;
        }
        .bd-table tbody td {
          display: table-cell !important;
          vertical-align: top !important;
          padding: 14px 16px !important;
        }

        .bd-table td::before,
        .bd-table td::after,
        .bd-cell-title::before,
        .bd-cell-title::after,
        .bd-cell-value::before,
        .bd-cell-value::after,
        .bd-cell-type::before,
        .bd-cell-type::after {
          content: none !important;
          display: none !important;
        }
      ` }), _jsx(StorePickerModal, { open: storeModalOpen, stores: filteredStoreList, search: storeSearch, onSearchChange: setStoreSearch, selectedStore: selectedStore, onSelect: setSelectedStore, onClose: () => setStoreModalOpen(false) }), _jsxs("div", { className: "bd-shell", children: [_jsxs("header", { className: "bd-header", children: [_jsxs("div", { className: "bd-header-left", children: [_jsx("button", { className: "bd-btn bd-btn-secondary bd-btn-sm", onClick: onBack, children: "\u2190 Back" }), _jsx("button", { className: "bd-btn bd-btn-secondary bd-btn-sm", onClick: () => setIsSidebarOpen((prev) => !prev), title: isSidebarOpen ? "Hide left panel" : "Show left panel", children: isSidebarOpen ? "◀ Hide Panel" : "▶ Show Panel" }), _jsxs("div", { className: "bd-header-title-group", children: [_jsx("h1", { className: "bd-title", children: "Blueprint Decoder" }), _jsx("span", { className: "bd-version-tag", children: "Tekion Arc" })] })] }), result && (_jsxs("div", { className: "bd-stats-bar", children: [_jsxs("div", { className: "bd-stat-chip", children: [_jsx("span", { className: "bd-stat-val", children: totalSections }), _jsx("span", { className: "bd-stat-lbl", children: "Sections" })] }), _jsxs("div", { className: "bd-stat-chip", children: [_jsx("span", { className: "bd-stat-val", children: totalFields }), _jsx("span", { className: "bd-stat-lbl", children: "Fields" })] }), _jsxs("div", { className: "bd-stat-chip highlight", children: [_jsx("span", { className: "bd-stat-val", children: answered }), _jsxs("span", { className: "bd-stat-lbl", children: ["Answered (", answeredPct, "%)"] })] })] }))] }), _jsxs("main", { className: `bd-body ${!isSidebarOpen ? "sidebar-collapsed" : ""}`, style: !isSidebarOpen
                            ? {
                                display: "grid",
                                gridTemplateColumns: "1fr",
                                width: "100%",
                            }
                            : undefined, children: [isSidebarOpen && (_jsxs("aside", { className: "bd-input-panel", children: [_jsxs("div", { className: "bd-card", children: [_jsx("div", { className: "bd-card-header", children: _jsx("span", { className: "bd-card-label", children: "Extraction Mode" }) }), _jsxs("div", { className: "bd-segmented", children: [_jsx("button", { className: `bd-segmented-btn ${inputMode === "auto" ? "active" : ""}`, onClick: () => setInputMode("auto"), children: "\u26A1 Auto Fetch" }), _jsx("button", { className: `bd-segmented-btn ${inputMode === "manual" ? "active" : ""}`, onClick: () => setInputMode("manual"), children: "\u270D\uFE0F Manual JSON" })] })] }), inputMode === "auto" && (_jsxs(_Fragment, { children: [_jsxs("div", { className: "bd-card", children: [_jsxs("div", { className: "bd-card-header", children: [_jsx("span", { className: "bd-card-label", children: "Target Dealership" }), _jsx("button", { className: "bd-link-btn", onClick: () => void loadStoreRecords(), disabled: storeLoading, children: storeLoading ? _jsx(Spinner, { size: 12 }) : "↻ Sync DB" })] }), _jsxs("button", { className: "bd-store-select-btn", onClick: () => setStoreModalOpen(true), children: [_jsxs("div", { className: "bd-store-select-main", children: [_jsx("span", { className: "bd-store-icon", children: "\uD83C\uDFEC" }), _jsxs("div", { className: "bd-store-text", children: [_jsx("div", { className: "bd-store-main-id", children: selectedStore
                                                                                    ? `${selectedStore.tekion_id}_${selectedStore.dealer_id}`
                                                                                    : "Choose Dealership" }), _jsx("div", { className: "bd-store-sub-name", children: selectedStore?.dba_name || "Click to browse T-90 stores" })] })] }), _jsx("span", { className: "bd-select-arrow", children: "\u25BE" })] })] }), _jsxs("div", { className: "bd-card", children: [_jsx("div", { className: "bd-card-header", children: _jsx("span", { className: "bd-card-label", children: "Target Modules" }) }), _jsx("div", { className: "bd-pill-group", children: ["parts", "service", "accounting"].map((mod) => {
                                                            const isActive = autoModules.includes(mod);
                                                            return (_jsxs("button", { type: "button", className: `bd-pill ${isActive ? "active" : ""}`, onClick: () => toggleModule(mod), children: [_jsx("span", { className: "bd-pill-indicator", children: isActive ? "✓" : "+" }), moduleLabel(mod)] }, mod));
                                                        }) }), _jsx("button", { className: "bd-btn bd-btn-primary bd-btn-block", onClick: handleAutoFetch, disabled: autoLoading || autoModules.length === 0 || !selectedStore, children: autoLoading ? (_jsxs(_Fragment, { children: [_jsx(Spinner, {}), "Querying Conquest APIs..."] })) : ("🚀 Extract & Decode Forms") }), autoMessage && _jsx("div", { className: "bd-status-callout", children: autoMessage })] }), autoDecodedResults.length > 0 && (_jsxs("div", { className: "bd-card bd-card-glow", children: [_jsxs("div", { className: "bd-card-header", children: [_jsx("span", { className: "bd-card-label", children: "Decoded Modules" }), _jsxs("span", { className: "bd-badge-mini", children: [autoDecodedResults.length, " ready"] })] }), _jsx("div", { className: "bd-segmented bd-segmented-wrap", style: { marginBottom: 12 }, children: autoDecodedResults.map((item) => (_jsx("button", { className: `bd-segmented-btn ${activeAutoModule === item.module ? "active" : ""}`, onClick: () => void handleSelectAutoResult(item.module), children: moduleLabel(item.module) }, item.module))) }), _jsx("div", { className: "bd-match-list", children: ["parts", "service", "accounting"].map((mod) => (_jsxs("div", { className: "bd-match-row", children: [_jsxs("span", { className: "bd-match-name", children: [moduleLabel(mod), " Form"] }), _jsx("span", { className: `bd-match-pill ${matchedModuleMap[mod] ? "is-found" : "is-none"}`, children: matchedModuleMap[mod] ? "Available" : "Not Found" })] }, mod))) })] }))] })), inputMode === "manual" && (_jsxs("div", { className: "bd-card", children: [_jsx("div", { className: "bd-card-header", children: _jsx("span", { className: "bd-card-label", children: "Direct JSON Input" }) }), _jsxs("div", { className: `bd-dropzone ${isDragging ? "dragging" : ""}`, onDragOver: handleDragOver, onDragLeave: handleDragLeave, onDrop: handleDrop, children: [_jsx("textarea", { ref: textareaRef, className: "bd-json-textarea", value: jsonText, onChange: (e) => setJsonText(e.target.value), placeholder: "Paste form detail payload or drag .json file here...", spellCheck: false }), isDragging && (_jsx("div", { className: "bd-dropzone-overlay", children: "\uD83D\uDCC2 Drop JSON File to Load" }))] }), _jsxs("div", { className: "bd-action-row", children: [_jsx("button", { className: "bd-btn bd-btn-primary", style: { flex: 2 }, onClick: handleDecode, children: "\u25B6 Run Decoder" }), _jsx("button", { className: "bd-btn bd-btn-secondary", style: { flex: 1 }, onClick: handleClear, children: "Clear" })] })] })), error && _jsxs("div", { className: "bd-banner-error", children: ["\u26A0 ", error] }), _jsxs("div", { className: "bd-card", children: [_jsx("div", { className: "bd-card-header", children: _jsx("span", { className: "bd-card-label", children: "Display & Cache" }) }), _jsxs("label", { className: "bd-checkbox-label", children: [_jsx("input", { type: "checkbox", checked: populatedOnly, onChange: (e) => setPopulatedOnly(e.target.checked) }), _jsx("span", { children: "Hide unanswered questions" })] }), _jsx("button", { className: "bd-btn bd-btn-secondary bd-btn-sm", onClick: () => restoreRef.current?.click(), children: "\uD83D\uDCC2 Restore from Backup File" }), _jsx("input", { ref: restoreRef, type: "file", accept: ".json", style: { display: "none" }, onChange: handleRestoreFromFile })] }), result && (_jsxs("div", { className: "bd-card bd-card-success", children: [_jsxs("div", { className: "bd-card-header", children: [_jsx("span", { className: "bd-card-label", style: { color: "#4ade80" }, children: "Persistence Storage" }), _jsx("span", { className: "bd-badge-pill green", children: "IndexedDB" })] }), !saveKey ? (_jsx("div", { className: "bd-subtext-error", children: "\u26A0\uFE0F Missing metadata key for local save." })) : (_jsxs("div", { className: "bd-save-flow", children: [_jsx("code", { className: "bd-key-chip", children: saveKey }), saveStatus === "idle" && (_jsxs("button", { className: "bd-btn bd-btn-primary", onClick: handleSave, children: ["\uD83D\uDCBE Save ", activeAutoModule ? moduleLabel(activeAutoModule) : "View", " to IDB"] })), saveStatus === "exists" && (_jsx("button", { className: "bd-btn bd-btn-warning", onClick: handleSave, children: "\uD83D\uDD04 Overwrite Existing Record" })), saveStatus === "saving" && (_jsxs("div", { className: "bd-inline-loader", children: [_jsx(Spinner, {}), "Saving record..."] })), saveStatus === "saved" && (_jsx("div", { className: "bd-inline-success", children: "\u2713 Saved to Local DB & Disk" })), saveStatus === "error" && (_jsxs("div", { className: "bd-subtext-error", children: ["\u2715 ", saveError] })), autoDecodedResults.length > 1 && (_jsxs("div", { className: "bd-save-all-wrap", children: [_jsx("button", { className: "bd-btn bd-btn-secondary bd-btn-sm", onClick: () => void handleSaveAll(), disabled: saveAllStatus === "saving", children: saveAllStatus === "saving" ? (_jsxs(_Fragment, { children: [_jsx(Spinner, {}), "Saving all..."] })) : ("💾 Save All Extracted Forms") }), saveAllStatus === "saved" && (_jsx("span", { className: "bd-inline-success-sm", children: "\u2713 All forms synced" })), saveAllStatus === "error" && (_jsxs("span", { className: "bd-subtext-error", children: ["\u2715 ", saveError] }))] }))] }))] }))] })), _jsx("section", { className: "bd-output-panel", style: {
                                    flex: 1,
                                    minWidth: 0,
                                    width: "100%",
                                    ...(!isSidebarOpen ? { gridColumn: "1 / -1" } : {}),
                                }, children: !result ? (_jsxs("div", { className: "bd-empty-state", children: [_jsx("div", { className: "bd-empty-icon-ring", children: "\uD83D\uDCCB" }), _jsx("h3", { className: "bd-empty-title", children: "No Decoded Data" }), _jsx("p", { className: "bd-empty-desc", children: inputMode === "auto"
                                                ? "Select a dealership store on the left and click 'Extract & Decode Forms'."
                                                : "Paste an API response JSON or drop a file to inspect structured answers." }), _jsxs("div", { className: "bd-empty-tags", children: [_jsx("span", { children: "Parts Conquest" }), _jsx("span", { children: "\u2022" }), _jsx("span", { children: "Service Conquest" }), _jsx("span", { children: "\u2022" }), _jsx("span", { children: "Accounting Conquest" })] })] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "bd-view-bar", children: [_jsx("div", { className: "bd-segmented compact bd-segmented-wrap", children: VIEW_TABS.map(([mode, label]) => (_jsx("button", { className: `bd-segmented-btn ${viewMode === mode ? "active" : ""}`, onClick: () => setViewMode(mode), children: label }, mode))) }), _jsxs("div", { className: "bd-view-counter", children: [viewMode === "sections" && `${totalSections} sections`, viewMode === "flat" && `${flatRows.length} displayed rows`, viewMode === "csv" && `${result.csvReadyRows.length} exportable rows`, viewMode === "human" && "Clean text outline"] })] }), _jsxs("div", { className: "bd-view-content", children: [viewMode === "sections" && (_jsx(SectionsView, { sections: result.decodedSections, populatedOnly: populatedOnly })), viewMode === "flat" && _jsx(FlatView, { rows: flatRows }), viewMode === "csv" && (_jsx(CsvView, { rows: result.csvReadyRows, onDownload: () => downloadCsv(result.csvReadyRows) })), viewMode === "human" && _jsx(HumanView, { text: result.humanReadable })] })] })) })] })] })] }));
};
export default BlueprintDecoder;
