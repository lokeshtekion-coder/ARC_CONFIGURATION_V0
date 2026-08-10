import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
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

function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? "#98989d";
}

function fmt(value: unknown): string {
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
    ...rows.map((r) => keys.map((k) => `"${r[k].replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
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

const ReqBadge: React.FC<{ required: boolean }> = ({ required }) =>
  required ? <span className="bd-req-yes">Required</span> : <span className="bd-req-no">Optional</span>;

const SectionsView: React.FC<{
  sections: DecodedSection[];
  populatedOnly: boolean;
}> = ({ sections, populatedOnly }) => (
  <div className="bd-sections">
    {sections.map((section) => {
      const fields = populatedOnly
        ? section.fields.filter((f) => f.hasUserValue && f.decodedValue != null && f.decodedValue !== "")
        : section.fields;

      if (fields.length === 0) return null;

      return (
        <div key={section.sectionId} className="bd-section-block">
          <div className="bd-section-header">
            <span className="bd-section-name">{section.sectionName ?? "(No Name)"}</span>
            <span className="bd-section-meta">
              {fields.length} fields · order {section.sectionOrder}
            </span>
          </div>

          <table className="bd-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Subsection</th>
                <th>Decoded Value</th>
                <th>Req</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => (
                <tr key={field.fieldId} className={field.hasUserValue ? "" : "bd-row-empty"}>
                  <td className="bd-cell-title">{field.title ?? field.fieldName ?? field.fieldId}</td>
                  <td><TypeBadge type={field.type} /></td>
                  <td className="bd-cell-sub">{field.subsectionName ?? "—"}</td>
                  <td className="bd-cell-value">
                    {field.hasUserValue ? (
                      <span className="bd-value">{fmt(field.decodedValue)}</span>
                    ) : (
                      <span className="bd-no-value">No answer</span>
                    )}
                  </td>
                  <td><ReqBadge required={field.required} /></td>
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
          <th>Section</th>
          <th>Subsection</th>
          <th>Title</th>
          <th>Type</th>
          <th>Decoded Value</th>
          <th>Req</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td className="bd-cell-section">{row.sectionName ?? "—"}</td>
            <td className="bd-cell-sub">{row.subsectionName ?? "—"}</td>
            <td className="bd-cell-title">{row.title ?? row.fieldId}</td>
            <td><TypeBadge type={row.type} /></td>
            <td className="bd-cell-value">
              {row.hasUserValue ? (
                <span className="bd-value">{fmt(row.decodedValue)}</span>
              ) : (
                <span className="bd-no-value">No answer</span>
              )}
            </td>
            <td><ReqBadge required={row.required} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const CsvView: React.FC<{ rows: CsvRow[]; onDownload: () => void }> = ({ rows, onDownload }) => (
  <div className="bd-sections">
    <div className="bd-csv-toolbar">
      <span className="bd-csv-hint">{rows.length} rows ready for export</span>
      <button className="btn-postman" onClick={onDownload}>⬇ Download CSV</button>
    </div>

    <table className="bd-table">
      <thead>
        <tr>
          <th>Section</th>
          <th>Field ID</th>
          <th>Title</th>
          <th>Type</th>
          <th>Req</th>
          <th>Decoded Value</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td className="bd-cell-section">{row.sectionName}</td>
            <td><code className="bd-field-id">{row.fieldId}</code></td>
            <td className="bd-cell-title">{row.title}</td>
            <td><TypeBadge type={row.type} /></td>
            <td><ReqBadge required={row.required === "true"} /></td>
            <td className="bd-cell-value">
              <span className="bd-value">{row.decodedValue}</span>
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
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search T-90 stores"
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

interface Props {
  onBack: () => void;
}

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

export const BlueprintDecoder: React.FC<Props> = ({ onBack }) => {
  const [inputMode, setInputMode] = useState<InputMode>("auto");

  const [jsonText, setJsonText] = useState("");
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

  const [autoModules, setAutoModules] = useState<BlueprintModule[]>(["parts", "service", "accounting"]);
  const [autoLoading, setAutoLoading] = useState(false);
  const [autoForms, setAutoForms] = useState<BlueprintFormListItem[]>([]);
  const [autoMessage, setAutoMessage] = useState<string | null>(null);
  const [autoDecodedResults, setAutoDecodedResults] = useState<AutoDecodedResult[]>([]);
  const [activeAutoModule, setActiveAutoModule] = useState<BlueprintModule | null>(null);
  const [saveAllStatus, setSaveAllStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

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
      setStoreRecords(data);
    } catch (e: unknown) {
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
      const key = `${dn || "manual"}-${fn}`.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-]/g, "");

      setDealerName(dn);
      setFormName(fn);
      setSaveKey(key);
      setSaveError(null);
      setResult(runDecoder(payload));
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
      setError(e instanceof Error ? `JSON Error: ${e.message}` : "Invalid JSON");
      setResult(null);
      setSaveStatus("idle");
    }
  }, [jsonText]);

  const handleAutoFetch = useCallback(async () => {
    if (!selectedStore?.tekion_id?.trim()) {
      setError("Select a store first.");
      return;
    }

    if (autoModules.length === 0) {
      setError("Select at least one module.");
      return;
    }

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
      const tekionId = selectedStore.tekion_id.trim();
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

        const rawDetail = detail as unknown as {
          data?: {
            formName?: string;
            formData?: { releasedDealerName?: string };
          };
        };

        const dn = String(rawDetail?.data?.formData?.releasedDealerName ?? "").trim();
        const fn = String(rawDetail?.data?.formName ?? form.formName ?? "").trim();
        const key = `${tekionId}-${fn}`.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-]/g, "");

        results.push({
          module,
          form,
          detail,
          decoded,
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
      setJsonText(JSON.stringify(firstResult.detail, null, 2));
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
        `Fetched and decoded ${results.length} form(s): ${results.map((r) => moduleLabel(r.module)).join(", ")}`
      );
    } catch (e: unknown) {
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
      setJsonText(JSON.stringify(selected.detail, null, 2));
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
      setSaveStatus("error");
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  };

  const handleSaveAll = useCallback(async () => {
    if (autoDecodedResults.length === 0) return;

    setSaveAllStatus("saving");
    setSaveError(null);

    try {
      for (const item of autoDecodedResults) {
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

        if (!res.ok) {
          throw new Error(`Server: HTTP ${res.status} while saving ${item.formName}`);
        }
      }

      setSaveAllStatus("saved");
    } catch (err: unknown) {
      setSaveAllStatus("error");
      setSaveError(err instanceof Error ? err.message : "Save all failed");
    }
  }, [autoDecodedResults, selectedStore]);

  const handleRestoreFromFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
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

      await idbSaveBlueprint(record);

      const restoredDecoded = record.decodedResponse ?? record.data;
      if (restoredDecoded) {
        setResult(restoredDecoded);
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

  const flatRows = populatedOnly ? result?.populatedFlatRows ?? [] : result?.allFields ?? [];

  const VIEW_TABS: [ViewMode, string][] = [
    ["sections", "By Section"],
    ["flat", "Flat Rows"],
    ["csv", "CSV Ready"],
    ["human", "Human"],
  ];

  const renderSaveBlock = () => {
    if (!result) return null;

    const keyMissing = !saveKey;

    return (
      <div className="glv-save-block">
        <div className="glv-step-label">
          <span className="glv-step-num">💾</span>
          Save Blueprint
        </div>

        {keyMissing ? (
          <div className="bx-error">⚠️ Could not extract key from response.</div>
        ) : (
          <>
            <div className="bd-save-key-row">
              <span className="bd-save-key-label">📌 Key</span>
              <code className="bd-save-key-value">{saveKey}</code>
            </div>

            <div className="bd-save-meta-row">
              <span>👤 <b>{dealerName || "—"}</b></span>
              <span>📄 <b>{formName || "—"}</b></span>
            </div>

            {saveStatus === "idle" && (
              <button className="btn-primary" style={{ width: "100%" }} onClick={handleSave}>
                💾 Save Current View
              </button>
            )}

            {saveStatus === "exists" && (
              <>
                <div className="bd-save-warn">⚠️ Already saved in IndexedDB</div>
                <button className="btn-secondary btn-sm" style={{ width: "100%" }} onClick={handleSave}>
                  🔄 Overwrite Current View
                </button>
              </>
            )}

            {saveStatus === "saving" && (
              <div className="glv-save-ok" style={{ opacity: 0.7 }}>
                ⏳ Saving current blueprint…
              </div>
            )}

            {saveStatus === "saved" && <div className="glv-save-ok">✅ Saved current blueprint</div>}
            {saveStatus === "error" && <div className="bx-error">❌ {saveError}</div>}

            {autoDecodedResults.length > 1 && (
              <div style={{ marginTop: 10 }}>
                <button
                  className="btn-secondary btn-sm"
                  style={{ width: "100%" }}
                  onClick={() => void handleSaveAll()}
                  disabled={saveAllStatus === "saving"}
                >
                  {saveAllStatus === "saving" ? "⏳ Saving all..." : "💾 Save All Fetched Forms"}
                </button>

                {saveAllStatus === "saved" && (
                  <div className="glv-save-ok" style={{ marginTop: 8 }}>
                    ✅ Saved all fetched forms
                  </div>
                )}

                {saveAllStatus === "error" && (
                  <div className="bx-error" style={{ marginTop: 8 }}>
                    ❌ {saveError}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

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
            <div className="bd-panel-label">Mode</div>
            <div className="kv-mode-tabs" style={{ marginBottom: 12 }}>
              <button
                className={`kv-mode-btn ${inputMode === "auto" ? "kv-mode-active" : ""}`}
                onClick={() => setInputMode("auto")}
              >
                Auto
              </button>
              <button
                className={`kv-mode-btn ${inputMode === "manual" ? "kv-mode-active" : ""}`}
                onClick={() => setInputMode("manual")}
              >
                Manual
              </button>
            </div>

            {inputMode === "auto" && (
              <>
                <div className="bd-panel-label">Store</div>

                <button
                  className="btn-secondary btn-sm"
                  style={{ width: "100%" }}
                  onClick={() => setStoreModalOpen(true)}
                >
                  {selectedStore
                    ? `🏬 ${selectedStore.tekion_id}_${selectedStore.dealer_id}`
                    : "🏬 Select Store"}
                </button>

                <div style={{ marginTop: 10 }}>
                  <button
                    className="btn-secondary btn-sm"
                    style={{ width: "100%" }}
                    onClick={() => void loadStoreRecords()}
                    disabled={storeLoading}
                  >
                    {storeLoading ? "⏳ Loading..." : "Reload IndexedDB Stores"}
                  </button>
                </div>

                {selectedStore && (
                  <div
                    style={{
                      padding: "10px 12px",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 10,
                      background: "rgba(255,255,255,0.03)",
                      marginTop: 10,
                      marginBottom: 12,
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13 }}>
                      {selectedStore.tekion_id}_{selectedStore.dealer_id}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.72 }}>
                      {selectedStore.dba_name || "—"}
                    </div>
                  </div>
                )}

                <div className="bd-panel-label">Modules</div>
                <div style={{ display: "grid", gap: 6, marginTop: 8, marginBottom: 10 }}>
                  <label className="bd-toggle">
                    <input
                      type="checkbox"
                      checked={autoModules.includes("parts")}
                      onChange={() => toggleModule("parts")}
                    />
                    <span>Parts</span>
                  </label>

                  <label className="bd-toggle">
                    <input
                      type="checkbox"
                      checked={autoModules.includes("service")}
                      onChange={() => toggleModule("service")}
                    />
                    <span>Service</span>
                  </label>

                  <label className="bd-toggle">
                    <input
                      type="checkbox"
                      checked={autoModules.includes("accounting")}
                      onChange={() => toggleModule("accounting")}
                    />
                    <span>Accounting</span>
                  </label>
                </div>

                <button
                  className="btn-postman"
                  style={{ width: "100%" }}
                  onClick={handleAutoFetch}
                  disabled={autoLoading}
                >
                  {autoLoading ? "⏳ Fetching..." : "🚀 Fetch & Decode"}
                </button>

                <div style={{ marginTop: 14 }}>
                  <div className="bd-panel-label">Matched Forms</div>
                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      marginTop: 8,
                      padding: "10px 12px",
                      border: "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 12,
                      background: "rgba(255,255,255,0.03)",
                    }}
                  >
                    {(["parts", "service", "accounting"] as BlueprintModule[]).map((module) => (
                      <div
                        key={module}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          fontSize: 13,
                        }}
                      >
                        <span>{moduleLabel(module)}</span>
                        <span style={{ fontWeight: 700 }}>
                          {matchedModuleMap[module] ? "✅" : "❌"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {autoDecodedResults.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div className="bd-panel-label">Views</div>
                    <div className="kv-mode-tabs" style={{ flexWrap: "wrap" }}>
                      {autoDecodedResults.map((item) => (
                        <button
                          key={item.module}
                          className={`kv-mode-btn ${activeAutoModule === item.module ? "kv-mode-active" : ""}`}
                          onClick={() => void handleSelectAutoResult(item.module)}
                        >
                          {moduleLabel(item.module)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {autoMessage && (
                  <div style={{ marginTop: 10, fontSize: 12, color: "#a1a1aa" }}>
                    {autoMessage}
                  </div>
                )}
              </>
            )}

            {inputMode === "manual" && (
              <>
                <div className="bd-panel-label">Paste JSON Payload</div>

                <textarea
                  ref={textareaRef}
                  className="bd-json-textarea"
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  placeholder={
                    `Paste the full API response JSON here...\n\n` +
                    `{\n  "data": {\n    "formName": "...",\n` +
                    `    "formData": {\n      "releasedDealerName": "...",\n      ...\n    }\n  }\n}`
                  }
                  spellCheck={false}
                />

                <div className="bd-input-actions">
                  <button className="btn-postman" onClick={handleDecode}>
                    ▶ Decode
                  </button>
                  <button className="btn-cancel-bulk" onClick={handleClear}>
                    ✕ Clear
                  </button>
                </div>
              </>
            )}

            {error && <div className="bd-error">⚠ {error}</div>}

            <div style={{ marginTop: 12 }}>
              <label className="bd-toggle">
                <input
                  type="checkbox"
                  checked={populatedOnly}
                  onChange={(e) => setPopulatedOnly(e.target.checked)}
                />
                <span>Populated only</span>
              </label>
            </div>

            <div className="bd-restore-block">
              <div className="bd-restore-label">📂 Restore from file</div>
              <button
                className="btn-secondary btn-sm"
                style={{ width: "100%" }}
                onClick={() => restoreRef.current?.click()}
              >
                📂 Load Blueprint File
              </button>
              <input
                ref={restoreRef}
                type="file"
                accept=".json"
                style={{ display: "none" }}
                onChange={handleRestoreFromFile}
              />
            </div>

            {renderSaveBlock()}
          </div>

          <div className="bd-output-panel">
            {!result && (
              <div className="bd-output-empty">
                <span className="bd-empty-icon">📋</span>
                <p>
                  {inputMode === "auto"
                    ? "Select store, choose modules, then Fetch & Decode"
                    : <>Paste JSON and click <strong>Decode</strong></>}
                </p>
                <p className="bd-empty-hint-text">
                  Supports any blueprint form API response
                </p>
              </div>
            )}

            {result && (
              <>
                <div className="bd-view-bar">
                  <div className="kv-mode-tabs">
                    {VIEW_TABS.map(([mode, label]) => (
                      <button
                        key={mode}
                        className={`kv-mode-btn ${viewMode === mode ? "kv-mode-active" : ""}`}
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

                <div className="bd-output-content">
                  {viewMode === "sections" && (
                    <SectionsView sections={result.decodedSections} populatedOnly={populatedOnly} />
                  )}
                  {viewMode === "flat" && <FlatView rows={flatRows} />}
                  {viewMode === "csv" && (
                    <CsvView rows={result.csvReadyRows} onDownload={() => downloadCsv(result.csvReadyRows)} />
                  )}
                  {viewMode === "human" && <HumanView text={result.humanReadable} />}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
};
