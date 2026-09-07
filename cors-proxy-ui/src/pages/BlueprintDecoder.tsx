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
import type { BlueprintModule, BlueprintFormListItem } from "../services/blueprintFormsApi";

interface Props {
  onBack: () => void;
}

const logger = {
  info: (...args: unknown[]) => console.info("[BlueprintDecoder]", ...args),
  debug: (...args: unknown[]) => console.debug("[BlueprintDecoder]", ...args),
  warn: (...args: unknown[]) => console.warn("[BlueprintDecoder]", ...args),
  error: (...args: unknown[]) => console.error("[BlueprintDecoder]", ...args),
};

const TYPE_COLORS: Record<string, string> = {
  DROPDOWN: "#0a84ff",
  SINGLE_CHOICE: "#0a84ff",
  MULTIPLE_CHOICE: "#bf5af2",
  RADIO: "#0a84ff",
  CHECKBOX: "#bf5af2",
  TEXT: "#30d158",
  SHORT_TEXT: "#30d158",
  LONG_TEXT: "#30d158",
  NUMBER: "#ff9f0a",
  CURRENCY: "#ff9f0a",
  SLIDER: "#ff9f0a",
  DATE: "#ff6c37",
  TIME: "#ff6c37",
  DATE_TIME: "#ff6c37",
  EMAIL: "#5ac8fa",
  PHONE: "#5ac8fa",
  URL: "#5ac8fa",
  FILE_UPLOAD: "#64d2ff",
  PARAGRAPH: "#98989d",
  LOGO: "#98989d",
  SIGNATURE: "#ffd60a",
  RATING: "#ffd60a",
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

const STICKY_HEADER_STYLE: React.CSSProperties = {
  position: "sticky",
  top: 0,
  backgroundColor: "#161618",
  zIndex: 10,
  boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
};

function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? "#98989d";
}

function renderValueUI(value: unknown): React.ReactNode {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.trim() || "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (
    Array.isArray(value) &&
    value.every((v) => typeof v === "string" || typeof v === "number")
  ) {
    return value.join(", ");
  }
  return (
    <pre
      style={{
        background: "rgba(255,255,255,0.06)",
        padding: "6px 8px",
        borderRadius: "6px",
        fontSize: "0.85em",
        margin: 0,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      <code>{JSON.stringify(value, null, 2)}</code>
    </pre>
  );
}

function fmtText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.trim() || "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.join(", ");
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

function getTLabel(value: string): {
  label: string;
  tone: "future" | "today" | "past" | "unknown";
  diffDays: number | null;
} {
  const d = parseLaunchDate(value);
  if (!d) return { label: "Unknown", tone: "unknown", diffDays: null };

  const today = new Date();
  const startToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const launchDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffMs = launchDay.getTime() - startToday.getTime();
  const diffDays = Math.round(diffMs / 86400000);

  if (diffDays > 0) return { label: `T-${diffDays}`, tone: "future", diffDays };
  if (diffDays === 0) return { label: "T", tone: "today", diffDays };
  return { label: "Launched", tone: "past", diffDays };
}

function isT90Store(store: StoreRecord): boolean {
  const t = getTLabel(store.launch_date);
  return t.diffDays !== null && t.diffDays >= 0 && t.diffDays <= 90;
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

const TypeBadge: React.FC<{ type: string }> = ({ type }) => (
  <span
    className="bd-type-badge"
    style={{ color: typeColor(type), borderColor: typeColor(type) + "33" }}
  >
    {type}
  </span>
);

const Spinner: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ animation: "bd-spin 1s linear infinite", marginRight: 6 }}
  >
    <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
    <path d="M12 2a10 10 0 0 1 10 10" />
  </svg>
);

const SectionsView: React.FC<{
  sections: DecodedSection[];
  populatedOnly: boolean;
}> = ({ sections, populatedOnly }) => (
  <div className="bd-sections">
    {sections.map((section) => {
      const fields = populatedOnly
        ? section.fields.filter(
            (f) =>
              f.hasUserValue && f.decodedValue != null && f.decodedValue !== ""
          )
        : section.fields;

      if (fields.length === 0) return null;

      return (
        <div key={section.sectionId} className="bd-section-block">
          <div className="bd-section-header">
            <span className="bd-section-name">
              {section.sectionName ?? "(No Name)"}
            </span>
            <span className="bd-section-meta">
              {fields.length} fields · order {section.sectionOrder}
            </span>
          </div>
          <table className="bd-table">
            <thead>
              <tr>
                <th style={STICKY_HEADER_STYLE}>Title</th>
                <th style={STICKY_HEADER_STYLE}>Decoded Value</th>
                <th style={STICKY_HEADER_STYLE}>Subsection</th>
                <th style={STICKY_HEADER_STYLE}>Type</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr
                  key={field.fieldId}
                  className={field.hasUserValue ? "" : "bd-row-empty"}
                >
                  <td className="bd-cell-title">
                    {field.title ?? field.fieldName ?? field.fieldId}
                  </td>
                  <td className="bd-cell-value">
                    {field.hasUserValue ? (
                      <span className="bd-value">
                        {renderValueUI(field.decodedValue)}
                      </span>
                    ) : (
                      <span className="bd-no-value">No answer</span>
                    )}
                  </td>
                  <td className="bd-cell-sub">{field.subsectionName ?? "—"}</td>
                  <td>
                    <TypeBadge type={field.type} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    })}
  </div>
);

const FlatView: React.FC<{ rows: FlattenedDecodedRow[] }> = ({ rows }) => (
  <div className="bd-sections">
    <table className="bd-table">
      <thead>
        <tr>
          <th style={STICKY_HEADER_STYLE}>Section</th>
          <th style={STICKY_HEADER_STYLE}>Title</th>
          <th style={STICKY_HEADER_STYLE}>Decoded Value</th>
          <th style={STICKY_HEADER_STYLE}>Subsection</th>
          <th style={STICKY_HEADER_STYLE}>Type</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${row.fieldId}-${i}`}>
            <td className="bd-cell-section">{row.sectionName ?? "—"}</td>
            <td className="bd-cell-title">{row.title ?? row.fieldId}</td>
            <td className="bd-cell-value">
              {row.hasUserValue ? (
                <span className="bd-value">{renderValueUI(row.decodedValue)}</span>
              ) : (
                <span className="bd-no-value">No answer</span>
              )}
            </td>
            <td className="bd-cell-sub">{row.subsectionName ?? "—"}</td>
            <td>
              <TypeBadge type={row.type} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const CsvView: React.FC<{ rows: CsvRow[]; onDownload: () => void }> = ({
  rows,
  onDownload,
}) => (
  <div className="bd-sections">
    <div className="bd-csv-toolbar">
      <span className="bd-csv-hint">{rows.length} rows ready for export</span>
      <button className="btn-postman" onClick={onDownload}>
        ⬇ Download CSV
      </button>
    </div>
    <table className="bd-table">
      <thead>
        <tr>
          <th style={STICKY_HEADER_STYLE}>Section</th>
          <th style={STICKY_HEADER_STYLE}>Field ID</th>
          <th style={STICKY_HEADER_STYLE}>Title</th>
          <th style={STICKY_HEADER_STYLE}>Decoded Value</th>
          <th style={STICKY_HEADER_STYLE}>Type</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={`${row.fieldId}-${i}`}>
            <td className="bd-cell-section">{row.sectionName}</td>
            <td>
              <code className="bd-field-id">{row.fieldId}</code>
            </td>
            <td className="bd-cell-title">{row.title}</td>
            <td className="bd-cell-value">
              <span className="bd-value">{row.decodedValue}</span>
            </td>
            <td>
              <TypeBadge type={row.type} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const HumanView: React.FC<{ text: string }> = ({ text }) => (
  <pre className="bd-human-pre">{text || "(Nothing populated)"}</pre>
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
    if (open) {
      setLocalSearch(search);
    }
  }, [open, search]);

  useEffect(() => {
    const timer = setTimeout(() => onSearchChange(localSearch), 300);
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
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(760px, 100%)",
          maxHeight: "82vh",
          overflow: "hidden",
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.10)",
          background: "#111216",
          boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "16px 18px 12px",
            borderBottom: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Select T-90 Store</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Search by Tekion ID, Dealer ID, or dealership name
            </div>
          </div>
          <button className="btn-secondary btn-sm" onClick={onClose}>
            ✕ Close
          </button>
        </div>
        <div style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <input
            type="text"
            className="stores-input"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search T-90 stores..."
            autoFocus
          />
        </div>
        <div style={{ padding: 16, overflow: "auto" }}>
          {stores.length === 0 ? (
            <div style={{ padding: 18, opacity: 0.7 }}>No T-90 stores found.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {stores.map((store) => {
                const active = selectedStore?.tekion_id === store.tekion_id;
                return (
                  <button
                    key={store.tekion_id}
                    type="button"
                    onClick={() => {
                      onSelect(store);
                      onClose();
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "14px 16px",
                      borderRadius: 14,
                      border: active
                        ? "1px solid rgba(10,132,255,0.7)"
                        : "1px solid rgba(255,255,255,0.08)",
                      background: active
                        ? "rgba(10,132,255,0.14)"
                        : "rgba(255,255,255,0.03)",
                      color: "inherit",
                      cursor: "pointer",
                      transition: "background 0.2s",
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {store.tekion_id}_{store.dealer_id}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.78, marginTop: 4 }}>
                      {store.dba_name || "—"}
                    </div>
                  </button>
                );
              })}
            </div>
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

function detectModuleFromFormName(formName: string): BlueprintModule | null {
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

function filterDecodedResultByExcludedTitles(
  decoded: RunDecoderResult,
  module: BlueprintModule | null
): RunDecoderResult {
  const excludedTitles = getExcludedTitleSet(module);

  if (excludedTitles.size === 0) {
    return decoded;
  }

  const filteredSections = decoded.decodedSections
    .map((section) => ({
      ...section,
      fields: section.fields.filter(
        (field) => !excludedTitles.has(field.title ?? "")
      ),
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
  const [autoDecodedResults, setAutoDecodedResults] = useState<
    AutoDecodedResult[]
  >([]);
  const [activeAutoModule, setActiveAutoModule] = useState<BlueprintModule | null>(
    null
  );
  const [saveAllStatus, setSaveAllStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  const activeAutoResult =
    activeAutoModule != null
      ? autoDecodedResults.find((item) => item.module === activeAutoModule) ??
        null
      : null;

  const loadStoreRecords = useCallback(async () => {
    setStoreLoading(true);
    try {
      const data = await getStores();
      logger.info("Loaded stores from IndexedDB", { count: data.length });
      setStoreRecords(data);
    } catch (e: unknown) {
      logger.error("Failed to load stores from IndexedDB", e);
      setError(
        e instanceof Error ? e.message : "Failed to load stores from IndexedDB"
      );
    } finally {
      setStoreLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStoreRecords();
  }, [loadStoreRecords]);

  const t90Stores = useMemo(
    () => storeRecords.filter(isT90Store),
    [storeRecords]
  );

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
      const filteredDecoded = filterDecodedResultByExcludedTitles(
        decoded,
        detectedModule
      );

      logger.info("Manual payload decoded successfully", {
        key,
        dealerName: dn,
        formName: fn,
        module: detectedModule,
        fieldsCount: filteredDecoded.allFields.length,
      });

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
    logger.info("Starting auto-fetch for store", {
      tekionId,
      dealerId: selectedStore.dealer_id,
      modules: autoModules,
    });

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
        logger.warn("No matching blueprint conquest forms found", {
          totalReturned: forms.length,
          modules: autoModules,
        });
        setAutoMessage(
          "No matching blueprint conquest forms found for selected modules."
        );
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

        logger.info(`Fetching detail for ${module} form`, {
          formId: form.formId,
          releaseId: form.releaseId,
          formName: form.formName,
        });

        const detail = (await fetchBlueprintFormDetail(
          form.formId,
          form.releaseId
        )) as InputPayload;

        const decoded = runDecoder(detail);
        const filteredDecoded = filterDecodedResultByExcludedTitles(
          decoded,
          module
        );

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

        const fn = String(
          rawDetail?.data?.formName ?? form.formName ?? ""
        ).trim();

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
        setAutoMessage(
          "Matching forms were found, but no valid module detail could be decoded."
        );
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
        `Fetched and decoded ${results.length} form(s): ${results
          .map((r) => moduleLabel(r.module))
          .join(", ")}`
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

      logger.info(`Switching active decoded view to: ${module}`, {
        saveKey: selected.saveKey,
      });

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
      prev.includes(module)
        ? prev.filter((m) => m !== module)
        : [...prev, module]
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

      const res = await fetch(
        "http://localhost:4000/api/validation/blueprint-save",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: saveKey, data: record }),
        }
      );

      if (!res.ok) throw new Error(`Server: HTTP ${res.status}`);

      logger.info("Saved blueprint to IDB and filesystem", { key: saveKey });
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
    logger.info("Saving all decoded results", {
      count: autoDecodedResults.length,
    });

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

          const res = await fetch(
            "http://localhost:4000/api/validation/blueprint-save",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: item.saveKey, data: record }),
            }
          );

          if (!res.ok) {
            throw new Error(`Server: HTTP ${res.status}`);
          }
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
      logger.error("Errors occurred during save all", errors);
      setSaveAllStatus("error");
      setSaveError(errors.join(" | "));
    } else {
      logger.info("Successfully saved all decoded results");
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

        if (!record.key) {
          throw new Error("Invalid blueprint file — missing key");
        }

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
            ? filterDecodedResultByExcludedTitles(
                record.decodedResponse,
                module
              )
            : record.decodedResponse,
        };

        await idbSaveBlueprint(restoredRecord);

        if (filteredRestoredDecoded) {
          setResult(filteredRestoredDecoded);
        }

        setDealerName(record.dealerName ?? "");
        setFormName(record.formName ?? "");
        setSaveKey(record.key);
        setSaveStatus("saved");
        setError(null);
        setJsonText("");
        setAutoDecodedResults([]);
        setActiveAutoModule(null);
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Failed to restore from file"
        );
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

  const flatRows = populatedOnly
    ? result?.populatedFlatRows ?? []
    : result?.allFields ?? [];

  const VIEW_TABS: [ViewMode, string][] = [
    ["sections", "By Section"],
    ["flat", "Flat Rows"],
    ["csv", "CSV Ready"],
    ["human", "Human"],
  ];

  return (
    <>
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
        <div className="bd-header">
          <div className="bd-header-left">
            <button className="btn-secondary btn-sm" onClick={onBack}>
              ← Back
            </button>
            <span className="bd-title">🔍 Blueprint Form Decoder</span>
          </div>

          {result && (
            <div className="bd-stats">
              <span className="bd-stat">
                <span className="bd-stat-n">{totalSections}</span> sections
              </span>
              <span className="bd-stat">
                <span className="bd-stat-n">{totalFields}</span> total fields
              </span>
              <span className="bd-stat bd-stat-pop">
                <span className="bd-stat-n">{answered}</span> answered
              </span>
            </div>
          )}
        </div>

        <div className="bd-body">
          <div className="bd-input-panel">
            <div className="bd-card">
              <div className="bd-card-title">Input Mode</div>
              <div className="bd-segmented">
                <button
                  className={`bd-segmented-btn ${
                    inputMode === "auto" ? "active" : ""
                  }`}
                  onClick={() => setInputMode("auto")}
                >
                  ⚡ Auto Fetch
                </button>
                <button
                  className={`bd-segmented-btn ${
                    inputMode === "manual" ? "active" : ""
                  }`}
                  onClick={() => setInputMode("manual")}
                >
                  ✍️ Manual JSON
                </button>
              </div>
            </div>

            {inputMode === "auto" && (
              <>
                <div className="bd-card">
                  <div className="bd-card-title">Dealership Selection</div>
                  <button
                    className="btn-secondary"
                    style={{ width: "100%", justifyContent: "space-between" }}
                    onClick={() => setStoreModalOpen(true)}
                  >
                    <span>
                      {selectedStore
                        ? `🏬 ${selectedStore.tekion_id}`
                        : "🏬 Select Store"}
                    </span>
                    <span style={{ opacity: 0.5 }}>▼</span>
                  </button>

                  {selectedStore && (
                    <div
                      style={{
                        fontSize: 13,
                        color: "rgba(255,255,255,0.7)",
                        padding: "4px 8px",
                      }}
                    >
                      <span style={{ fontWeight: 600, color: "#fff" }}>
                        {selectedStore.dealer_id}
                      </span>
                      <br />
                      {selectedStore.dba_name || "Unknown DBA"}
                    </div>
                  )}

                  <button
                    className="btn-secondary btn-sm"
                    style={{ width: "100%", opacity: 0.7, marginTop: 4 }}
                    onClick={() => void loadStoreRecords()}
                    disabled={storeLoading}
                  >
                    {storeLoading ? (
                      <>
                        <Spinner /> Refreshing...
                      </>
                    ) : (
                      "↻ Sync Stores DB"
                    )}
                  </button>
                </div>

                <div className="bd-card">
                  <div className="bd-card-title">Modules to Extract</div>
                  <div className="bd-pill-group">
                    {(
                      ["parts", "service", "accounting"] as BlueprintModule[]
                    ).map((mod) => {
                      const isActive = autoModules.includes(mod);
                      return (
                        <button
                          key={mod}
                          className={`bd-pill ${isActive ? "active" : ""}`}
                          onClick={() => toggleModule(mod)}
                        >
                          {isActive ? "✓" : "+"} {moduleLabel(mod)}
                        </button>
                      );
                    })}
                  </div>

                  <button
                    className="btn-postman"
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: 8,
                    }}
                    onClick={handleAutoFetch}
                    disabled={
                      autoLoading ||
                      autoModules.length === 0 ||
                      !selectedStore
                    }
                  >
                    {autoLoading ? (
                      <>
                        <Spinner /> Fetching APIs...
                      </>
                    ) : (
                      "🚀 Fetch & Decode"
                    )}
                  </button>

                  {autoMessage && (
                    <div
                      className="bd-anim-fade-in"
                      style={{
                        fontSize: 12,
                        color: "#a1a1aa",
                        textAlign: "center",
                      }}
                    >
                      {autoMessage}
                    </div>
                  )}
                </div>

                {autoDecodedResults.length > 0 && (
                  <div className="bd-card bd-anim-fade-in">
                    <div className="bd-card-title">View Decoded Results</div>
                    <div className="bd-pill-group" style={{ marginBottom: 8 }}>
                      {autoDecodedResults.map((item) => (
                        <button
                          key={item.module}
                          className={`bd-pill ${
                            activeAutoModule === item.module ? "active" : ""
                          }`}
                          onClick={() => void handleSelectAutoResult(item.module)}
                        >
                          {moduleLabel(item.module)}
                        </button>
                      ))}
                    </div>

                    <div
                      style={{
                        background: "rgba(0,0,0,0.2)",
                        borderRadius: 8,
                        padding: 8,
                      }}
                    >
                      {(
                        ["parts", "service", "accounting"] as BlueprintModule[]
                      ).map((module) => (
                        <div
                          key={module}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            fontSize: 12,
                            padding: "4px 6px",
                          }}
                        >
                          <span style={{ color: "rgba(255,255,255,0.6)" }}>
                            {moduleLabel(module)} Match
                          </span>
                          <span>
                            {matchedModuleMap[module] ? "✅ Found" : "❌ None"}
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
                <div className="bd-card-title">Raw JSON Payload</div>
                <div
                  className={`bd-dropzone ${isDragging ? "dragging" : ""}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <textarea
                    ref={textareaRef}
                    className="bd-json-textarea"
                    style={{
                      border: "none",
                      background: "transparent",
                      width: "100%",
                      height: "140px",
                      padding: 12,
                      resize: "vertical",
                    }}
                    value={jsonText}
                    onChange={(e) => setJsonText(e.target.value)}
                    placeholder="Paste API response JSON here...&#10;or drag & drop a .json file."
                    spellCheck={false}
                  />
                  {isDragging && (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "rgba(10,132,255,0.15)",
                        backdropFilter: "blur(2px)",
                        pointerEvents: "none",
                        color: "#0a84ff",
                        fontWeight: 600,
                        fontSize: 15,
                      }}
                    >
                      📁 Drop JSON File Here
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn-postman"
                    style={{ flex: 2 }}
                    onClick={handleDecode}
                  >
                    ▶ Decode
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ flex: 1 }}
                    onClick={handleClear}
                  >
                    Clear
                  </button>
                </div>
              </div>
            )}

            {error && (
              <div
                className="bd-error bd-anim-fade-in"
                style={{ borderRadius: 8 }}
              >
                ⚠ {error}
              </div>
            )}

            <div className="bd-card">
              <div className="bd-card-title">Display & Backup</div>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={populatedOnly}
                  onChange={(e) => setPopulatedOnly(e.target.checked)}
                  style={{ accentColor: "#0a84ff", width: 16, height: 16 }}
                />
                <span>Hide empty (unanswered) fields</span>
              </label>

              <hr
                style={{
                  border: 0,
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                  margin: "4px 0",
                }}
              />

              <button
                className="btn-secondary btn-sm"
                style={{
                  width: "100%",
                  justifyContent: "center",
                  display: "flex",
                  gap: 6,
                }}
                onClick={() => restoreRef.current?.click()}
              >
                <span>📂</span> Restore from Backup File
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
              <div
                className="bd-card bd-anim-fade-in"
                style={{
                  borderColor: "rgba(48, 209, 88, 0.3)",
                  background: "rgba(48, 209, 88, 0.02)",
                }}
              >
                <div className="bd-card-title" style={{ color: "#30d158" }}>
                  💾 Local Database
                </div>

                {!saveKey ? (
                  <div style={{ fontSize: 12, color: "#ff453a" }}>
                    ⚠️ Could not extract store key.
                  </div>
                ) : (
                  <>
                    <div
                      style={{
                        background: "rgba(0,0,0,0.3)",
                        padding: "6px 10px",
                        borderRadius: 6,
                        fontSize: 12,
                        fontFamily: "monospace",
                        color: "rgba(255,255,255,0.8)",
                      }}
                    >
                      {saveKey}
                    </div>

                    {saveStatus === "idle" && (
                      <button className="btn-primary" onClick={handleSave}>
                        Save{" "}
                        {activeAutoModule
                          ? moduleLabel(activeAutoModule)
                          : "View"}{" "}
                        to IDB
                      </button>
                    )}

                    {saveStatus === "exists" && (
                      <button
                        className="btn-secondary"
                        style={{ borderColor: "#ff9f0a", color: "#ff9f0a" }}
                        onClick={handleSave}
                      >
                        🔄 Overwrite Existing Save
                      </button>
                    )}

                    {saveStatus === "saving" && (
                      <div
                        style={{
                          fontSize: 13,
                          color: "#0a84ff",
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        <Spinner /> Saving...
                      </div>
                    )}
                    {saveStatus === "saved" && (
                      <div style={{ fontSize: 13, color: "#30d158" }}>
                        ✅ Successfully saved
                      </div>
                    )}
                    {saveStatus === "error" && (
                      <div style={{ fontSize: 13, color: "#ff453a" }}>
                        ❌ {saveError}
                      </div>
                    )}

                    {autoDecodedResults.length > 1 && (
                      <>
                        <hr
                          style={{
                            border: 0,
                            borderTop: "1px solid rgba(255,255,255,0.08)",
                            margin: "4px 0",
                          }}
                        />
                        <button
                          className="btn-secondary btn-sm"
                          onClick={() => void handleSaveAll()}
                          disabled={saveAllStatus === "saving"}
                          style={{
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                          }}
                        >
                          {saveAllStatus === "saving" ? (
                            <>
                              <Spinner /> Saving all...
                            </>
                          ) : (
                            "💾 Save All Extracted Forms"
                          )}
                        </button>
                        {saveAllStatus === "saved" && (
                          <div
                            style={{
                              fontSize: 12,
                              color: "#30d158",
                              textAlign: "center",
                            }}
                          >
                            ✅ All forms saved
                          </div>
                        )}
                        {saveAllStatus === "error" && (
                          <div
                            style={{
                              fontSize: 12,
                              color: "#ff453a",
                              textAlign: "center",
                            }}
                          >
                            ❌ {saveError}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="bd-output-panel">
            {!result && (
              <div className="bd-output-empty bd-anim-fade-in">
                <span
                  className="bd-empty-icon"
                  style={{ fontSize: "3rem", marginBottom: 12, display: "block" }}
                >
                  📋
                </span>
                <p>
                  {inputMode === "auto"
                    ? "Select store, choose modules, then Fetch & Decode"
                    : (
                      <>
                        Paste JSON or drop a file and click{" "}
                        <strong>Decode</strong>
                      </>
                    )}
                </p>
                <p className="bd-empty-hint-text" style={{ opacity: 0.6 }}>
                  Supports any blueprint form API response
                </p>
              </div>
            )}

            {result && (
              <>
                <div
                  className="bd-view-bar"
                  style={{
                    position: "sticky",
                    top: 16,
                    zIndex: 20,
                    background: "#111216",
                    paddingBottom: 12,
                  }}
                >
                  <div className="kv-mode-tabs">
                    {VIEW_TABS.map(([mode, label]) => (
                      <button
                        key={mode}
                        className={`kv-mode-btn ${
                          viewMode === mode ? "kv-mode-active" : ""
                        }`}
                        onClick={() => setViewMode(mode)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <span className="bd-view-count">
                    {viewMode === "sections" && `${totalSections} sections`}
                    {viewMode === "flat" && `${flatRows.length} rows`}
                    {viewMode === "csv" && `${result.csvReadyRows.length} rows`}
                    {viewMode === "human" && "populated fields"}
                  </span>
                </div>

                <div className="bd-output-content bd-anim-fade-in">
                  {viewMode === "sections" && (
                    <SectionsView
                      sections={result.decodedSections}
                      populatedOnly={populatedOnly}
                    />
                  )}
                  {viewMode === "flat" && <FlatView rows={flatRows} />}
                  {viewMode === "csv" && (
                    <CsvView
                      rows={result.csvReadyRows}
                      onDownload={() => downloadCsv(result.csvReadyRows)}
                    />
                  )}
                  {viewMode === "human" && (
                    <HumanView text={result.humanReadable} />
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default BlueprintDecoder;