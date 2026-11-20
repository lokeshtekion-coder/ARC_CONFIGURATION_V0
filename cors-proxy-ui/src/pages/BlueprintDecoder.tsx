import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import "./BlueprintDecoder.css";
import { runDecoder } from "../utils/blueprintFormDecoder";
import { idbSaveBlueprint, idbGetBlueprint } from "../utils/blueprintDb";
import {
  fetchBlueprintFormResponses,
  filterBlueprintTargetForms,
  fetchBlueprintFormDetail,
} from "../services/blueprintFormsApi";
import { getStores } from "../services/storesDb";
import type { StoreRecord } from "../services/storesDb";
import type {
  InputPayload,
  RunDecoderResult,
  DecodedSection,
  FlattenedDecodedRow,
  CsvRow,
} from "../utils/blueprintFormDecoder";
import type {
  BlueprintModule,
  BlueprintFormListItem,
} from "../services/blueprintFormsApi";

interface Props {
  onBack: () => void;
}

interface MediaPayload {
  mediaId: string;
  filename?: string;
  url: string;
  uploadStatus?: string;
  mimeType?: string;
  mediaCategory?: string;
  mediaSize?: number;
  createdTime?: number;
  [key: string]: unknown;
}

const logger = {
  info: (...args: unknown[]) => console.info("[BlueprintDecoder]", ...args),
  debug: (...args: unknown[]) => console.debug("[BlueprintDecoder]", ...args),
  warn: (...args: unknown[]) => console.warn("[BlueprintDecoder]", ...args),
  error: (...args: unknown[]) => console.error("[BlueprintDecoder]", ...args),
};

const TYPE_COLORS: Record<string, string> = {
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

const PARTS_EXCLUDED_TITLES = new Set<string>([
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

const SERVICE_EXCLUDED_TITLES = new Set<string>([
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

const ACCOUNTING_EXCLUDED_TITLES = new Set<string>([
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

function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? "#94a3b8";
}

function isMediaObject(val: unknown): val is MediaPayload {
  return (
    typeof val === "object" &&
    val !== null &&
    "mediaId" in val &&
    "url" in val &&
    typeof (val as { url: unknown }).url === "string"
  );
}

function buildTekionMediaUrl(media: MediaPayload): string {
  const BUCKET_PREFIX = "com-tekioncloud-tap-dealeronboarding/";
  const BASE_URL = "https://tap.tekioncloud.com/dealer-onboarding/forms/pdf?";

  const rawPath = media.url.startsWith(BUCKET_PREFIX)
    ? media.url.slice(BUCKET_PREFIX.length)
    : media.url;

  return `${BASE_URL}${encodeURI(rawPath)}`;
}

function tryParseMedia(val: unknown): MediaPayload | null {
  if (isMediaObject(val)) return val;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith("{") && trimmed.includes('"mediaId"') && trimmed.includes('"url"')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (isMediaObject(parsed)) return parsed;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function tryParseMediaArray(val: unknown): MediaPayload[] | null {
  if (Array.isArray(val)) {
    const list: MediaPayload[] = [];
    for (const item of val) {
      const parsed = tryParseMedia(item);
      if (parsed) list.push(parsed);
      else return null;
    }
    return list.length > 0 ? list : null;
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith("[") && trimmed.includes('"mediaId"') && trimmed.includes('"url"')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed)) return tryParseMediaArray(parsed);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function renderValueUI(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="bd-no-value">No answer provided</span>;
  }

  const singleMedia = tryParseMedia(value);
  if (singleMedia) {
    const fileUrl = buildTekionMediaUrl(singleMedia);
    const displayName = singleMedia.filename || "View Attached Document";
    return (
      <a
        href={fileUrl}
        target="_blank"
        rel="noreferrer"
        className="bd-link-pill"
        title={displayName}
      >
        <span>📄</span>
        {displayName}
      </a>
    );
  }

  const mediaList = tryParseMediaArray(value);
  if (mediaList) {
    return (
      <div className="bd-array-wrap">
        {mediaList.map((m, idx) => {
          const fileUrl = buildTekionMediaUrl(m);
          const displayName = m.filename || `Document ${idx + 1}`;
          return (
            <a
              key={m.mediaId || idx}
              href={fileUrl}
              target="_blank"
              rel="noreferrer"
              className="bd-link-pill"
              title={displayName}
            >
              <span>📄</span>
              {displayName}
            </a>
          );
        })}
      </div>
    );
  }

  if (typeof value === "boolean") {
    return (
      <span className={`bd-bool-pill ${value ? "is-yes" : "is-no"}`}>
        {value ? "✓ Yes" : "✕ No"}
      </span>
    );
  }

  if (typeof value === "number") {
    return <span className="bd-num-pill">{value.toLocaleString()}</span>;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return <span className="bd-no-value">No answer provided</span>;

    if (/^https?:\/\//i.test(trimmed)) {
      return (
        <a
          href={trimmed}
          target="_blank"
          rel="noreferrer"
          className="bd-link-pill"
          title={trimmed}
        >
          <span>🔗</span>
          {trimmed}
        </a>
      );
    }

    return <div className="bd-str-value">{trimmed}</div>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="bd-no-value">Empty selection</span>;
    return (
      <div className="bd-array-wrap">
        {value.map((v, i) => {
          const itemMedia = tryParseMedia(v);
          if (itemMedia) {
            const fileUrl = buildTekionMediaUrl(itemMedia);
            const displayName = itemMedia.filename || "View Attached Document";
            return (
              <a
                key={itemMedia.mediaId || i}
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="bd-link-pill"
                title={displayName}
              >
                <span>📄</span>
                {displayName}
              </a>
            );
          }
          return (
            <span key={i} className="bd-array-item">
              {typeof v === "object" ? JSON.stringify(v) : String(v)}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <pre className="bd-json-blob">
      <code>{JSON.stringify(value, null, 2)}</code>
    </pre>
  );
}

function fmtText(value: unknown): string {
  if (value === null || value === undefined) return "—";

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

  if (typeof value === "string") return value.trim() || "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((v) => fmtText(v)).join(", ");
  return JSON.stringify(value, null, 2);
}

function downloadCsv(rows: CsvRow[], filename = "blueprint-decoded.csv"): void {
  const keys: (keyof CsvRow)[] = [
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
    ...rows.map((r) =>
      keys.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n");

  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), {
    href: url,
    download: filename,
  });
  a.click();
  URL.revokeObjectURL(url);
}

function parseLaunchDate(value: string): Date | null {
  if (!value) return null;

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

function getTLabel(
  value: string
): { label: string; tone: "future" | "today" | "past" | "unknown"; diffDays: number | null } {
  const d = parseLaunchDate(value);
  if (!d) return { label: "Unknown", tone: "unknown", diffDays: null };

  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const launchDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffMs = launchDay.getTime() - startToday.getTime();
  const diffDays = Math.round(diffMs / 86400000);

  if (diffDays > 0) return { label: `T-${diffDays}`, tone: "future", diffDays };
  if (diffDays === 0) return { label: "T-Day", tone: "today", diffDays };
  return { label: "Launched", tone: "past", diffDays };
}

function isT90Store(store: StoreRecord): boolean {
  const t = getTLabel(store.launch_date);
  return t.diffDays !== null && t.diffDays >= 0;
}

type ViewMode = "sections" | "flat" | "csv" | "human";
type SaveStatus = "idle" | "exists" | "saving" | "saved" | "error";
type InputMode = "auto" | "manual";

interface AutoDecodedResult {
  module: BlueprintModule;
  form: BlueprintFormListItem;
  detail: InputPayload;
  decoded: RunDecoderResult;
  dealerName: string;
  formName: string;
  saveKey: string;
}

const TypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const color = typeColor(type);

  return (
    <span
      className="bd-type-badge"
      style={{
        color,
        background: `${color}14`,
        borderColor: `${color}30`,
      }}
    >
      <span className="bd-type-dot" style={{ background: color }} />
      {type}
    </span>
  );
};

const Spinner: React.FC<{ size?: number }> = ({ size = 15 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="bd-spin"
  >
    <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
    <path d="M12 2a10 10 0 0 1 10 10" />
  </svg>
);

const SectionsView: React.FC<{
  sections: DecodedSection[];
  populatedOnly: boolean;
}> = ({ sections, populatedOnly }) => (
  <div className="bd-sections-stack">
    {sections.map((section) => {
      const fields = populatedOnly
        ? section.fields.filter(
            (f) => f.hasUserValue && f.decodedValue != null && f.decodedValue !== ""
          )
        : section.fields;

      if (fields.length === 0) return null;

      return (
        <div key={section.sectionId} className="bd-section-card">
          <div className="bd-section-head">
            <div className="bd-section-title-wrap">
              <span className="bd-section-icon">📋</span>
              <span className="bd-section-name">
                {section.sectionName ?? "(Untitled Section)"}
              </span>
            </div>
            <span className="bd-section-pill">
              {fields.length} {fields.length === 1 ? "field" : "fields"}
            </span>
          </div>

          <div className="bd-table-wrap">
            <table
              className="bd-table"
              style={{
                width: "100%",
                tableLayout: "fixed",
                borderCollapse: "collapse",
                display: "table",
              }}
            >
              <thead style={{ display: "table-header-group" }}>
                <tr style={{ display: "table-row" }}>
                  <th
                    className="bd-th-question"
                    style={{
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
                    }}
                  >
                    Question / Context
                  </th>
                  <th
                    className="bd-th-answer"
                    style={{
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
                    }}
                  >
                    Decoded Answer
                  </th>
                  <th
                    className="bd-th-type"
                    style={{
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
                    }}
                  >
                    Field Type
                  </th>
                </tr>
              </thead>
              <tbody style={{ display: "table-row-group" }}>
                {fields.map((field) => (
                  <tr
                    key={field.fieldId}
                    className={field.hasUserValue ? "" : "bd-row-muted"}
                    style={{ display: "table-row" }}
                  >
                    <td
                      className="bd-cell-title"
                      style={{
                        display: "table-cell",
                        overflowWrap: "break-word",
                        verticalAlign: "top",
                        padding: "12px 16px",
                      }}
                    >
                      {field.subsectionName && (
                        <div className="bd-sub-badge">{field.subsectionName}</div>
                      )}
                      <div
                        className={`bd-title-text ${
                          field.hasUserValue ? "" : field.required ? "bd-title-missing" : "bd-title-missing-optional"
                        }`}
                      >
                        {field.title ?? field.fieldName ?? field.fieldId}
                      </div>
                      <code className="bd-field-subid">{field.fieldId}</code>
                    </td>
                    <td
                      className="bd-cell-value"
                      style={{
                        display: "table-cell",
                        overflowWrap: "break-word",
                        verticalAlign: "top",
                        padding: "12px 16px",
                      }}
                    >
                      {renderValueUI(field.decodedValue)}
                    </td>
                    <td
                      className="bd-cell-type"
                      style={{
                        display: "table-cell",
                        overflowWrap: "break-word",
                        verticalAlign: "top",
                        padding: "12px 16px",
                      }}
                    >
                      <TypeBadge type={field.type} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    })}
  </div>
);

const FlatView: React.FC<{ rows: FlattenedDecodedRow[] }> = ({ rows }) => (
  <div className="bd-section-card">
    <div className="bd-table-wrap">
      <table
        className="bd-table"
        style={{
          width: "100%",
          tableLayout: "fixed",
          borderCollapse: "collapse",
          display: "table",
        }}
      >
        <thead style={{ display: "table-header-group" }}>
          <tr style={{ display: "table-row" }}>
            <th style={{ width: "20%", display: "table-cell", padding: "10px 16px" }}>Section</th>
            <th style={{ width: "35%", display: "table-cell", padding: "10px 16px" }}>Question / Title</th>
            <th style={{ width: "35%", display: "table-cell", padding: "10px 16px" }}>Decoded Answer</th>
            <th style={{ width: "10%", display: "table-cell", padding: "10px 16px" }}>Type</th>
          </tr>
        </thead>
        <tbody style={{ display: "table-row-group" }}>
          {rows.map((row, i) => (
            <tr key={`${row.fieldId}-${i}`} style={{ display: "table-row" }}>
              <td className="bd-cell-section" style={{ display: "table-cell", padding: "12px 16px" }}>
                <span className="bd-section-tag">{row.sectionName ?? "—"}</span>
              </td>
              <td className="bd-cell-title" style={{ display: "table-cell", padding: "12px 16px" }}>
                {row.subsectionName && <div className="bd-sub-badge">{row.subsectionName}</div>}
                <div
                  className={`bd-title-text ${
                    row.hasUserValue ? "" : row.required ? "bd-title-missing" : "bd-title-missing-optional"
                  }`}
                >
                  {row.title ?? row.fieldId}
                </div>
                <code className="bd-field-subid">{row.fieldId}</code>
              </td>
              <td className="bd-cell-value" style={{ display: "table-cell", padding: "12px 16px" }}>
                {row.hasUserValue ? (
                  renderValueUI(row.decodedValue)
                ) : (
                  <span className="bd-no-value">No answer provided</span>
                )}
              </td>
              <td style={{ display: "table-cell", padding: "12px 16px" }}>
                <TypeBadge type={row.type} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const CsvView: React.FC<{ rows: CsvRow[]; onDownload: () => void }> = ({
  rows,
  onDownload,
}) => (
  <div className="bd-section-card">
    <div className="bd-csv-toolbar">
      <div>
        <span className="bd-csv-badge">{rows.length} records</span>
        <span className="bd-csv-hint">Structured for export or reporting</span>
      </div>
      <button className="bd-btn bd-btn-primary" onClick={onDownload}>
        ⬇ Export CSV
      </button>
    </div>

    <div className="bd-table-wrap">
      <table className="bd-table" style={{ width: "100%", tableLayout: "fixed" }}>
        <thead>
          <tr>
            <th style={{ width: "18%" }}>Section</th>
            <th style={{ width: "16%" }}>Field ID</th>
            <th style={{ width: "32%" }}>Title</th>
            <th style={{ width: "24%" }}>Decoded Value</th>
            <th style={{ width: "10%" }}>Type</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.fieldId}-${i}`}>
              <td className="bd-cell-section">{row.sectionName}</td>
              <td>
                <code className="bd-field-subid">{row.fieldId}</code>
              </td>
              <td className="bd-cell-title">{row.title}</td>
              <td className="bd-cell-value">
                <span className="bd-str-value">{row.decodedValue}</span>
              </td>
              <td>
                <TypeBadge type={row.type} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const HumanView: React.FC<{ text: string }> = ({ text }) => (
  <div className="bd-section-card">
    <pre className="bd-human-pre">{text || "(No populated responses available)"}</pre>
  </div>
);

interface StorePickerModalProps {
  open: boolean;
  stores: StoreRecord[];
  search: string;
  onSearchChange: (value: string) => void;
  selectedStore: StoreRecord | null;
  onSelect: (store: StoreRecord) => void;
  onClose: () => void;
}

const StorePickerModal: React.FC<StorePickerModalProps> = ({
  open,
  stores,
  search,
  onSearchChange,
  selectedStore,
  onSelect,
  onClose,
}) => {
  const [localSearch, setLocalSearch] = useState(search);

  useEffect(() => {
    if (open) setLocalSearch(search);
  }, [open, search]);

  useEffect(() => {
    const timer = setTimeout(() => onSearchChange(localSearch), 250);
    return () => clearTimeout(timer);
  }, [localSearch, onSearchChange]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    if (open) window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="bd-modal-backdrop" onClick={onClose}>
      <div className="bd-modal-box" onClick={(e) => e.stopPropagation()}>
        <div className="bd-modal-head">
          <div>
            <div className="bd-modal-title">Select T-90 Target Store</div>
            <div className="bd-modal-sub">Filtered stores launching within 90 days</div>
          </div>
          <button className="bd-icon-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        <div className="bd-modal-search">
          <span className="bd-search-icon">🔍</span>
          <input
            type="text"
            className="bd-input"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search Tekion ID, Dealer ID, or Dealership Name..."
            autoFocus
          />
        </div>

        <div className="bd-modal-list">
          {stores.length === 0 ? (
            <div className="bd-empty-hint">No T-90 stores match your query.</div>
          ) : (
            stores.map((store) => {
              const active = selectedStore?.tekion_id === store.tekion_id;
              const tStatus = getTLabel(store.launch_date);

              return (
                <button
                  key={store.tekion_id}
                  type="button"
                  className={`bd-store-item ${active ? "is-active" : ""}`}
                  onClick={() => {
                    onSelect(store);
                    onClose();
                  }}
                >
                  <div className="bd-store-item-info">
                    <div className="bd-store-item-title">
                      <span>{store.tekion_id}_{store.dealer_id}</span>
                      <span className={`bd-t-badge tone-${tStatus.tone}`}>{tStatus.label}</span>
                    </div>
                    <div className="bd-store-item-desc">{store.dba_name || "—"}</div>
                  </div>
                  <span className="bd-store-item-arrow">→</span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

function moduleLabel(module: BlueprintModule): string {
  if (module === "parts") return "Parts";
  if (module === "service") return "Service";
  return "Accounting";
}

export function detectModuleFromFormName(formName: string): BlueprintModule | null {
  const name = formName.toLowerCase();
  if (name.includes("parts")) return "parts";
  if (name.includes("service")) return "service";
  if (name.includes("accounting")) return "accounting";
  return null;
}

function getExcludedTitleSet(module: BlueprintModule | null): Set<string> {
  if (module === "parts") return PARTS_EXCLUDED_TITLES;
  if (module === "service") return SERVICE_EXCLUDED_TITLES;
  if (module === "accounting") return ACCOUNTING_EXCLUDED_TITLES;
  return new Set<string>();
}

export function filterDecodedResultByExcludedTitles(
  decoded: RunDecoderResult,
  module: BlueprintModule | null
): RunDecoderResult {
  const excludedTitles = getExcludedTitleSet(module);
  if (excludedTitles.size === 0) return decoded;

  const filteredSections = decoded.decodedSections
    .map((section) => ({
      ...section,
      fields: section.fields.filter((field) => !excludedTitles.has(field.title ?? "")),
    }))
    .filter((section) => section.fields.length > 0);

  const filteredAllFields = decoded.allFields.filter(
    (field) => !excludedTitles.has(field.title ?? "")
  );

  const filteredPopulatedFlatRows = decoded.populatedFlatRows.filter(
    (row) => !excludedTitles.has(row.title ?? "")
  );

  const filteredCsvReadyRows = decoded.csvReadyRows.filter(
    (row) => !excludedTitles.has(row.title ?? "")
  );

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

export const BlueprintDecoder: React.FC<Props> = ({ onBack }) => {
  const [inputMode, setInputMode] = useState<InputMode>("auto");
  const [jsonText, setJsonText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("sections");
  const [populatedOnly, setPopulatedOnly] = useState(true);
  const [result, setResult] = useState<RunDecoderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveKey, setSaveKey] = useState("");
  const [dealerName, setDealerName] = useState("");
  const [formName, setFormName] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [storeRecords, setStoreRecords] = useState<StoreRecord[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeSearch, setStoreSearch] = useState("");
  const [selectedStore, setSelectedStore] = useState<StoreRecord | null>(null);
  const [storeModalOpen, setStoreModalOpen] = useState(false);
  const [autoModules, setAutoModules] = useState<BlueprintModule[]>([
    "parts",
    "service",
    "accounting",
  ]);
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoForms, setAutoForms] = useState<BlueprintFormListItem[]>([]);
  const [autoMessage, setAutoMessage] = useState<string | null>(null);
  const [autoDecodedResults, setAutoDecodedResults] = useState<AutoDecodedResult[]>([]);
  const [activeAutoModule, setActiveAutoModule] = useState<BlueprintModule | null>(null);
  const [saveAllStatus, setSaveAllStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  const activeAutoResult =
    activeAutoModule != null
      ? autoDecodedResults.find((item) => item.module === activeAutoModule) ?? null
      : null;

  const loadStoreRecords = useCallback(async () => {
    setStoreLoading(true);
    try {
      const data = await getStores();
      logger.info("Loaded stores from IndexedDB", { count: data.length });
      setStoreRecords(data);
    } catch (e: unknown) {
      logger.error("Failed to load stores from IndexedDB", e);
      setError(e instanceof Error ? e.message : "Failed to load stores from IndexedDB");
    } finally {
      setStoreLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStoreRecords();
  }, [loadStoreRecords]);

  const t90Stores = useMemo(() => storeRecords.filter(isT90Store), [storeRecords]);

  const filteredStoreList = useMemo(() => {
    const q = storeSearch.trim().toLowerCase();
    if (!q) return t90Stores;

    return t90Stores.filter((row) => {
      return (
        row.tekion_id.toLowerCase().includes(q) ||
        row.dealer_id.toLowerCase().includes(q) ||
        row.dba_name.toLowerCase().includes(q)
      );
    });
  }, [t90Stores, storeSearch]);

  const matchedModuleMap = useMemo(() => {
    const map: Record<BlueprintModule, boolean> = {
      parts: false,
      service: false,
      accounting: false,
    };

    for (const form of autoForms) {
      const module = detectModuleFromFormName(form.formName);
      if (module) map[module] = true;
    }

    return map;
  }, [autoForms]);

  const handleDecode = useCallback(async () => {
    if (!jsonText.trim()) {
      setError("Paste a JSON payload first.");
      return;
    }

    try {
      const payload = JSON.parse(jsonText) as InputPayload;
      const raw = payload as unknown as {
        data?: {
          formName?: string;
          formData?: { releasedDealerName?: string };
        };
      };

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
      } else {
        setSaveStatus("idle");
      }
    } catch (e: unknown) {
      logger.error("Failed to decode JSON payload", e);
      setError(e instanceof Error ? `JSON Error: ${e.message}` : "Invalid JSON");
      setResult(null);
      setSaveStatus("idle");
    }
  }, [jsonText]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file && (file.type === "application/json" || file.name.endsWith(".json"))) {
      try {
        const text = await file.text();
        setJsonText(text);
        setError(null);
      } catch {
        setError("Failed to read dropped file");
      }
    } else {
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

      const pickedByModule = new Map<BlueprintModule, BlueprintFormListItem>();
      for (const form of filtered) {
        const module = detectModuleFromFormName(form.formName);
        if (!module) continue;
        if (!autoModules.includes(module)) continue;
        if (!pickedByModule.has(module)) {
          pickedByModule.set(module, form);
        }
      }

      const results: AutoDecodedResult[] = [];

      for (const module of autoModules) {
        const form = pickedByModule.get(module);
        if (!form) continue;

        const detail = (await fetchBlueprintFormDetail(form.formId, form.releaseId)) as InputPayload;
        const decoded = runDecoder(detail);
        const filteredDecoded = filterDecodedResultByExcludedTitles(decoded, module);

        const rawDetail = detail as unknown as {
          data?: {
            formName?: string;
            formData?: { releasedDealerName?: string };
          };
        };

        const dn = String(
          rawDetail?.data?.formData?.releasedDealerName ||
            form.dealerName ||
            selectedStore.dba_name ||
            ""
        ).trim();

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
      } else {
        setSaveStatus("idle");
      }

      setAutoMessage(
        `Decoded ${results.length} form(s): ${results.map((r) => moduleLabel(r.module)).join(", ")}`
      );
    } catch (e: unknown) {
      logger.error("Auto fetch workflow failed", e);
      setError(e instanceof Error ? e.message : "Auto fetch failed");
      setResult(null);
    } finally {
      setAutoLoading(false);
    }
  }, [selectedStore, autoModules]);

  const handleSelectAutoResult = useCallback(
    async (module: BlueprintModule) => {
      const selected = autoDecodedResults.find((item) => item.module === module);
      if (!selected) return;

      setActiveAutoModule(module);
      setResult(selected.decoded);
      setDealerName(selected.dealerName);
      setFormName(selected.formName);
      setSaveKey(selected.saveKey);
      setError(null);

      if (selected.saveKey) {
        const existing = await idbGetBlueprint(selected.saveKey);
        setSaveStatus(existing ? "exists" : "idle");
      } else {
        setSaveStatus("idle");
      }
    },
    [autoDecodedResults]
  );

  const toggleModule = useCallback((module: BlueprintModule) => {
    setAutoModules((prev) =>
      prev.includes(module) ? prev.filter((m) => m !== module) : [...prev, module]
    );
  }, []);

  const handleSave = async () => {
    if (!saveKey || !result) return;

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

      if (!res.ok) throw new Error(`Server: HTTP ${res.status}`);
      setSaveStatus("saved");
    } catch (err: unknown) {
      logger.error("Failed to save blueprint", err);
      setSaveStatus("error");
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const handleSaveAll = useCallback(async () => {
    if (autoDecodedResults.length === 0) return;

    setSaveAllStatus("saving");
    setSaveError(null);
    const errors: string[] = [];

    await Promise.allSettled(
      autoDecodedResults.map(async (item) => {
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

          if (!res.ok) throw new Error(`Server: HTTP ${res.status}`);
        } catch (err: unknown) {
          errors.push(
            `Failed saving ${item.formName}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      })
    );

    if (errors.length > 0) {
      setSaveAllStatus("error");
      setSaveError(errors.join(" | "));
    } else {
      setSaveAllStatus("saved");
    }
  }, [autoDecodedResults, selectedStore]);

  const handleRestoreFromFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const record = JSON.parse(text) as {
          key: string;
          dealerName?: string;
          formName?: string;
          data?: RunDecoderResult;
          decodedResponse?: RunDecoderResult;
          savedAt: string;
        };

        if (!record.key) throw new Error("Invalid blueprint file — missing key");

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

        if (filteredRestoredDecoded) setResult(filteredRestoredDecoded);
        setDealerName(record.dealerName ?? "");
        setFormName(record.formName ?? "");
        setSaveKey(record.key);
        setSaveStatus("saved");
        setError(null);
        setJsonText("");
        setAutoDecodedResults([]);
        setActiveAutoModule(null);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to restore from file");
      }

      e.target.value = "";
    },
    []
  );

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

  const VIEW_TABS: [ViewMode, string][] = [
    ["sections", "By Section"],
    ["flat", "Flat Rows"],
    ["csv", "CSV Ready"],
    ["human", "Document Summary"],
  ];

  return (
    <>
      {/* Global layout & header visibility reset */}
      <style>{`
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
      `}</style>

      <StorePickerModal
        open={storeModalOpen}
        stores={filteredStoreList}
        search={storeSearch}
        onSearchChange={setStoreSearch}
        selectedStore={selectedStore}
        onSelect={setSelectedStore}
        onClose={() => setStoreModalOpen(false)}
      />

      <div className="bd-shell">
        <header className="bd-header">
          <div className="bd-header-left">
            <button className="bd-btn bd-btn-secondary bd-btn-sm" onClick={onBack}>
              ← Back
            </button>
            <button
              className="bd-btn bd-btn-secondary bd-btn-sm"
              onClick={() => setIsSidebarOpen((prev) => !prev)}
              title={isSidebarOpen ? "Hide left panel" : "Show left panel"}
            >
              {isSidebarOpen ? "◀ Hide Panel" : "▶ Show Panel"}
            </button>
            <div className="bd-header-title-group">
              <h1 className="bd-title">Blueprint Decoder</h1>
              <span className="bd-version-tag">Tekion Arc</span>
            </div>
          </div>

          {result && (
            <div className="bd-stats-bar">
              <div className="bd-stat-chip">
                <span className="bd-stat-val">{totalSections}</span>
                <span className="bd-stat-lbl">Sections</span>
              </div>
              <div className="bd-stat-chip">
                <span className="bd-stat-val">{totalFields}</span>
                <span className="bd-stat-lbl">Fields</span>
              </div>
              <div className="bd-stat-chip highlight">
                <span className="bd-stat-val">{answered}</span>
                <span className="bd-stat-lbl">Answered ({answeredPct}%)</span>
              </div>
            </div>
          )}
        </header>

        <main
          className={`bd-body ${!isSidebarOpen ? "sidebar-collapsed" : ""}`}
          style={
            !isSidebarOpen
              ? {
                  display: "grid",
                  gridTemplateColumns: "1fr",
                  width: "100%",
                }
              : undefined
          }
        >
          {isSidebarOpen && (
            <aside className="bd-input-panel">
              <div className="bd-card">
                <div className="bd-card-header">
                  <span className="bd-card-label">Extraction Mode</span>
                </div>
                <div className="bd-segmented">
                  <button
                    className={`bd-segmented-btn ${inputMode === "auto" ? "active" : ""}`}
                    onClick={() => setInputMode("auto")}
                  >
                    ⚡ Auto Fetch
                  </button>
                  <button
                    className={`bd-segmented-btn ${inputMode === "manual" ? "active" : ""}`}
                    onClick={() => setInputMode("manual")}
                  >
                    ✍️ Manual JSON
                  </button>
                </div>
              </div>

              {inputMode === "auto" && (
                <>
                  <div className="bd-card">
                    <div className="bd-card-header">
                      <span className="bd-card-label">Target Dealership</span>
                      <button
                        className="bd-link-btn"
                        onClick={() => void loadStoreRecords()}
                        disabled={storeLoading}
                      >
                        {storeLoading ? <Spinner size={12} /> : "↻ Sync DB"}
                      </button>
                    </div>

                    <button className="bd-store-select-btn" onClick={() => setStoreModalOpen(true)}>
                      <div className="bd-store-select-main">
                        <span className="bd-store-icon">🏬</span>
                        <div className="bd-store-text">
                          <div className="bd-store-main-id">
                            {selectedStore
                              ? `${selectedStore.tekion_id}_${selectedStore.dealer_id}`
                              : "Choose Dealership"}
                          </div>
                          <div className="bd-store-sub-name">
                            {selectedStore?.dba_name || "Click to browse T-90 stores"}
                          </div>
                        </div>
                      </div>
                      <span className="bd-select-arrow">▾</span>
                    </button>
                  </div>

                  <div className="bd-card">
                    <div className="bd-card-header">
                      <span className="bd-card-label">Target Modules</span>
                    </div>

                    <div className="bd-pill-group">
                      {(["parts", "service", "accounting"] as BlueprintModule[]).map((mod) => {
                        const isActive = autoModules.includes(mod);
                        return (
                          <button
                            key={mod}
                            type="button"
                            className={`bd-pill ${isActive ? "active" : ""}`}
                            onClick={() => toggleModule(mod)}
                          >
                            <span className="bd-pill-indicator">{isActive ? "✓" : "+"}</span>
                            {moduleLabel(mod)}
                          </button>
                        );
                      })}
                    </div>

                    <button
                      className="bd-btn bd-btn-primary bd-btn-block"
                      onClick={handleAutoFetch}
                      disabled={autoLoading || autoModules.length === 0 || !selectedStore}
                    >
                      {autoLoading ? (
                        <>
                          <Spinner />
                          Querying Conquest APIs...
                        </>
                      ) : (
                        "🚀 Extract & Decode Forms"
                      )}
                    </button>

                    {autoMessage && <div className="bd-status-callout">{autoMessage}</div>}
                  </div>

                  {autoDecodedResults.length > 0 && (
                    <div className="bd-card bd-card-glow">
                      <div className="bd-card-header">
                        <span className="bd-card-label">Decoded Modules</span>
                        <span className="bd-badge-mini">{autoDecodedResults.length} ready</span>
                      </div>

                      <div className="bd-segmented bd-segmented-wrap" style={{ marginBottom: 12 }}>
                        {autoDecodedResults.map((item) => (
                          <button
                            key={item.module}
                            className={`bd-segmented-btn ${
                              activeAutoModule === item.module ? "active" : ""
                            }`}
                            onClick={() => void handleSelectAutoResult(item.module)}
                          >
                            {moduleLabel(item.module)}
                          </button>
                        ))}
                      </div>

                      <div className="bd-match-list">
                        {(["parts", "service", "accounting"] as BlueprintModule[]).map((mod) => (
                          <div key={mod} className="bd-match-row">
                            <span className="bd-match-name">{moduleLabel(mod)} Form</span>
                            <span
                              className={`bd-match-pill ${
                                matchedModuleMap[mod] ? "is-found" : "is-none"
                              }`}
                            >
                              {matchedModuleMap[mod] ? "Available" : "Not Found"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {inputMode === "manual" && (
                <div className="bd-card">
                  <div className="bd-card-header">
                    <span className="bd-card-label">Direct JSON Input</span>
                  </div>

                  <div
                    className={`bd-dropzone ${isDragging ? "dragging" : ""}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <textarea
                      ref={textareaRef}
                      className="bd-json-textarea"
                      value={jsonText}
                      onChange={(e) => setJsonText(e.target.value)}
                      placeholder="Paste form detail payload or drag .json file here..."
                      spellCheck={false}
                    />
                    {isDragging && (
                      <div className="bd-dropzone-overlay">📂 Drop JSON File to Load</div>
                    )}
                  </div>

                  <div className="bd-action-row">
                    <button className="bd-btn bd-btn-primary" style={{ flex: 2 }} onClick={handleDecode}>
                      ▶ Run Decoder
                    </button>
                    <button className="bd-btn bd-btn-secondary" style={{ flex: 1 }} onClick={handleClear}>
                      Clear
                    </button>
                  </div>
                </div>
              )}

              {error && <div className="bd-banner-error">⚠ {error}</div>}

              <div className="bd-card">
                <div className="bd-card-header">
                  <span className="bd-card-label">Display & Cache</span>
                </div>

                <label className="bd-checkbox-label">
                  <input
                    type="checkbox"
                    checked={populatedOnly}
                    onChange={(e) => setPopulatedOnly(e.target.checked)}
                  />
                  <span>Hide unanswered questions</span>
                </label>

                <button
                  className="bd-btn bd-btn-secondary bd-btn-sm"
                  onClick={() => restoreRef.current?.click()}
                >
                  📂 Restore from Backup File
                </button>

                <input
                  ref={restoreRef}
                  type="file"
                  accept=".json"
                  style={{ display: "none" }}
                  onChange={handleRestoreFromFile}
                />
              </div>

              {result && (
                <div className="bd-card bd-card-success">
                  <div className="bd-card-header">
                    <span className="bd-card-label" style={{ color: "#4ade80" }}>
                      Persistence Storage
                    </span>
                    <span className="bd-badge-pill green">IndexedDB</span>
                  </div>

                  {!saveKey ? (
                    <div className="bd-subtext-error">⚠️ Missing metadata key for local save.</div>
                  ) : (
                    <div className="bd-save-flow">
                      <code className="bd-key-chip">{saveKey}</code>

                      {saveStatus === "idle" && (
                        <button className="bd-btn bd-btn-primary" onClick={handleSave}>
                          💾 Save {activeAutoModule ? moduleLabel(activeAutoModule) : "View"} to IDB
                        </button>
                      )}

                      {saveStatus === "exists" && (
                        <button className="bd-btn bd-btn-warning" onClick={handleSave}>
                          🔄 Overwrite Existing Record
                        </button>
                      )}

                      {saveStatus === "saving" && (
                        <div className="bd-inline-loader">
                          <Spinner />
                          Saving record...
                        </div>
                      )}

                      {saveStatus === "saved" && (
                        <div className="bd-inline-success">✓ Saved to Local DB & Disk</div>
                      )}

                      {saveStatus === "error" && (
                        <div className="bd-subtext-error">✕ {saveError}</div>
                      )}

                      {autoDecodedResults.length > 1 && (
                        <div className="bd-save-all-wrap">
                          <button
                            className="bd-btn bd-btn-secondary bd-btn-sm"
                            onClick={() => void handleSaveAll()}
                            disabled={saveAllStatus === "saving"}
                          >
                            {saveAllStatus === "saving" ? (
                              <>
                                <Spinner />
                                Saving all...
                              </>
                            ) : (
                              "💾 Save All Extracted Forms"
                            )}
                          </button>

                          {saveAllStatus === "saved" && (
                            <span className="bd-inline-success-sm">✓ All forms synced</span>
                          )}

                          {saveAllStatus === "error" && (
                            <span className="bd-subtext-error">✕ {saveError}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </aside>
          )}

          <section
            className="bd-output-panel"
            style={{
              flex: 1,
              minWidth: 0,
              width: "100%",
              ...(!isSidebarOpen ? { gridColumn: "1 / -1" } : {}),
            }}
          >
            {!result ? (
              <div className="bd-empty-state">
                <div className="bd-empty-icon-ring">📋</div>
                <h3 className="bd-empty-title">No Decoded Data</h3>
                <p className="bd-empty-desc">
                  {inputMode === "auto"
                    ? "Select a dealership store on the left and click 'Extract & Decode Forms'."
                    : "Paste an API response JSON or drop a file to inspect structured answers."}
                </p>
                <div className="bd-empty-tags">
                  <span>Parts Conquest</span>
                  <span>•</span>
                  <span>Service Conquest</span>
                  <span>•</span>
                  <span>Accounting Conquest</span>
                </div>
              </div>
            ) : (
              <>
                <div className="bd-view-bar">
                  <div className="bd-segmented compact bd-segmented-wrap">
                    {VIEW_TABS.map(([mode, label]) => (
                      <button
                        key={mode}
                        className={`bd-segmented-btn ${viewMode === mode ? "active" : ""}`}
                        onClick={() => setViewMode(mode)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="bd-view-counter">
                    {viewMode === "sections" && `${totalSections} sections`}
                    {viewMode === "flat" && `${flatRows.length} displayed rows`}
                    {viewMode === "csv" && `${result.csvReadyRows.length} exportable rows`}
                    {viewMode === "human" && "Clean text outline"}
                  </div>
                </div>

                <div className="bd-view-content">
                  {viewMode === "sections" && (
                    <SectionsView sections={result.decodedSections} populatedOnly={populatedOnly} />
                  )}
                  {viewMode === "flat" && <FlatView rows={flatRows} />}
                  {viewMode === "csv" && (
                    <CsvView
                      rows={result.csvReadyRows}
                      onDownload={() => downloadCsv(result.csvReadyRows)}
                    />
                  )}
                  {viewMode === "human" && <HumanView text={result.humanReadable} />}
                </div>
              </>
            )}
          </section>
        </main>
      </div>
    </>
  );
};

export default BlueprintDecoder;