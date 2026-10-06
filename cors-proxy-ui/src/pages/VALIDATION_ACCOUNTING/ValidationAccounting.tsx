import React, { useEffect, useMemo, useRef, useState } from "react";
import ValidationShell, { type ValidationModule } from "../Review/ValidationShell";
import { getStores, type StoreRecord } from "../../services/storesDb";

const DB_NAME = "arc_glam_vault_db";
const STORE_NAME = "glam_records";
const DB_VERSION = 1;

function openGlamDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "dealerId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetAllRecords(): Promise<StoreGlamRecord[]> {
  try {
    const db = await openGlamDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("[ValidationAccounting] Failed to read from IndexedDB", err);
    return [];
  }
}

async function idbPutRecord(record: StoreGlamRecord): Promise<void> {
  try {
    const db = await openGlamDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("[ValidationAccounting] Failed to write to IndexedDB", err);
  }
}

async function idbClearRecords(): Promise<void> {
  try {
    const db = await openGlamDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error("[ValidationAccounting] Failed to clear IndexedDB", err);
  }
}

interface MappingRowItem {
  id: string;
  module: string;
  moduleName: string;
  tableName: string;
  ruleAsset: string;
  attributes: Record<string, unknown>;
  mappedAssetId: string;
  mappedGlAccount: string;
  accountName: string;
  accountTypeId: string;
  mappedDealerId: string;
  rowId: string;
}

interface CoaAccountDetail {
  accountNumber: string;
  accountName: string;
  accountTypeId: string;
}

interface RawGlamModuleTable {
  id: string;
  module: string;
  name: string;
  ruleAsset?: string;
  mappingColumns?: string[];
  mappingList?: Array<{
    attributes?: Record<string, unknown>;
    mappedAssetId?: string;
    mappedDealerId?: string;
    rowId?: string;
    targetFieldToValueMapping?: unknown;
  }>;
  deleted?: boolean;
}

interface StoreGlamRecord {
  tekionId: string;
  dealerId: string;
  dealerName: string;
  tenant: string;
  status: "SUCCESS" | "FAILED";
  rawResponse: any;
  bootstrapRawResponse?: any;
  modulesCount: number;
  totalRulesCount: number;
  totalCoaCount: number;
  flatRules: MappingRowItem[];
  error?: string;
  fetchedAt: string;
}

function parseBootstrapCoaMap(bootstrapJson: any): Map<string, CoaAccountDetail> {
  const coaMap = new Map<string, CoaAccountDetail>();
  const rootData = bootstrapJson?.data || bootstrapJson?.bootstrapData?.data || bootstrapJson || {};
  const allAccountsSection = rootData.allAccounts || {};
  const masterMap = allAccountsSection.masterAssetDocMap || {};

  for (const [mapKey, rawAcc] of Object.entries(masterMap)) {
    const acc = rawAcc as any;
    if (acc && typeof acc === "object") {
      const accountNumber = String(acc.accountNumber || "").trim();
      const accountName = String(acc.accountName || "—").trim();
      const accountTypeId = String(acc.accountTypeId || acc.accountType || "—").trim();
      const accountId = String(acc.id || "").trim();

      const detail: CoaAccountDetail = { accountNumber, accountName, accountTypeId };

      if (accountNumber) coaMap.set(accountNumber, detail);
      if (accountId) coaMap.set(accountId, detail);
      coaMap.set(mapKey, detail);
    }
  }

  return coaMap;
}

function parseGlamResponse(
  rawJson: any,
  coaMap: Map<string, CoaAccountDetail>
): {
  modulesCount: number;
  totalRulesCount: number;
  flatRules: MappingRowItem[];
} {
  const tableList: RawGlamModuleTable[] = Array.isArray(rawJson?.data?.data)
    ? rawJson.data.data
    : Array.isArray(rawJson?.data)
    ? rawJson.data
    : Array.isArray(rawJson)
    ? rawJson
    : [];

  const flatRules: MappingRowItem[] = [];

  for (const table of tableList) {
    if (table.deleted) continue;
    const mappingList = table.mappingList || [];

    for (const row of mappingList) {
      const attrs = row.attributes || {};
      const mappedAssetId = String(row.mappedAssetId || "");
      const mappedGlAccount = mappedAssetId.includes("_") ? mappedAssetId.split("_")[1] : mappedAssetId;
      const coaMatch = coaMap.get(mappedGlAccount) || coaMap.get(mappedAssetId);

      flatRules.push({
        id: row.rowId || `${table.id}_${flatRules.length}`,
        module: table.module || "GENERAL",
        moduleName: table.name || table.module || "Mapping",
        tableName: table.name || table.module || "",
        ruleAsset: table.ruleAsset || "GLACCOUNT",
        attributes: attrs,
        mappedAssetId,
        mappedGlAccount,
        accountName: coaMatch?.accountName || "—",
        accountTypeId: coaMatch?.accountTypeId || "—",
        mappedDealerId: row.mappedDealerId || "",
        rowId: row.rowId || "",
      });
    }
  }

  return {
    modulesCount: tableList.length,
    totalRulesCount: flatRules.length,
    flatRules,
  };
}

export default function ValidationAccounting() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [progressText, setProgressText] = useState<string>("");

  const [vault, setVault] = useState<Record<string, StoreGlamRecord>>({});
  const [selectedDealerId, setSelectedDealerId] = useState<string>("");
  const [selectedModuleFilter, setSelectedModuleFilter] = useState<string>("");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [viewMode, setViewMode] = useState<"grid" | "shell">("grid");

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      const records = await idbGetAllRecords();
      if (records.length > 0) {
        const map: Record<string, StoreGlamRecord> = {};
        for (const r of records) map[r.dealerId] = r;
        setVault(map);
        setSelectedDealerId((prev) => prev || records[0].dealerId);
      }
    })();
  }, []);

  const fetchGlamViaBackend = async (store: StoreRecord): Promise<any> => {
    const dealerId = store.dealer_id || store.tekion_id;
    const tenant = store.tenant_code || store.tenant_id || "";

    const res = await fetch("http://localhost:4000/api/stores/glam", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dealerId,
        tenant,
        env: "preprod",
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) {
      throw new Error(json.error || `HTTP ${res.status}: Failed to fetch data`);
    }

    return json;
  };

  const handleFetchAllStores = async () => {
    setLoading(true);
    setError(null);
    setProgressText("Reading stores from store database...");

    try {
      const storesList: StoreRecord[] = await getStores();
      if (!storesList || storesList.length === 0) {
        throw new Error("No stores found in database. Please load stores on the Stores tab first.");
      }

      const validStores = storesList.filter((s) => Boolean(s.dealer_id || s.tekion_id));
      let savedCount = 0;
      let skippedCount = 0;

      for (let i = 0; i < validStores.length; i++) {
        const store = validStores[i];
        const dId = store.dealer_id || store.tekion_id;
        const dName = store.dba_name || `Dealer ${dId}`;
        const tenant = store.tenant_code || store.tenant_id || "";

        setProgressText(`[${i + 1}/${validStores.length}] Pulling GLAM + Bootstrap for Dealer ${dId}...`);

        try {
          const res = await fetchGlamViaBackend(store);
          const coaMap = parseBootstrapCoaMap(res.bootstrapData);
          const parsed = parseGlamResponse(res.data, coaMap);

          if (parsed.totalRulesCount === 0) {
            skippedCount++;
            continue;
          }

          const storeRecord: StoreGlamRecord = {
            tekionId: store.tekion_id,
            dealerId: dId,
            dealerName: dName,
            tenant,
            status: "SUCCESS",
            rawResponse: res.data,
            bootstrapRawResponse: res.bootstrapData,
            modulesCount: parsed.modulesCount,
            totalRulesCount: parsed.totalRulesCount,
            totalCoaCount: coaMap.size,
            flatRules: parsed.flatRules,
            fetchedAt: new Date().toLocaleTimeString(),
          };

          await idbPutRecord(storeRecord);
          setVault((prev) => ({ ...prev, [dId]: storeRecord }));
          if (!selectedDealerId) setSelectedDealerId(dId);
          savedCount++;
        } catch (fetchErr: any) {
          skippedCount++;
        }
      }

      setStatusMessage(`✓ Done! Saved ${savedCount} stores with rules (skipped ${skippedCount} stores with 0 rules).`);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
      setProgressText("");
    }
  };

  const handleClear = async () => {
    await idbClearRecords();
    setVault({});
    setSelectedDealerId("");
    setStatusMessage("Stored responses cleared from IndexedDB.");
  };

  const handleExportJson = () => {
    const records = Object.values(vault);
    if (records.length === 0) {
      setError("No records to export.");
      return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(records, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `glam_vault_backup_${new Date().toISOString().slice(0, 10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    setStatusMessage(`✓ Exported ${records.length} dealer records to JSON backup.`);
  };

  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedData = JSON.parse(event.target?.result as string);
        if (!Array.isArray(importedData)) {
          throw new Error("Invalid backup format. Expected an array of dealer records.");
        }

        const map: Record<string, StoreGlamRecord> = { ...vault };
        for (const rec of importedData) {
          if (rec.dealerId) {
            await idbPutRecord(rec);
            map[rec.dealerId] = rec;
          }
        }

        setVault(map);
        if (!selectedDealerId && importedData.length > 0) {
          setSelectedDealerId(importedData[0].dealerId);
        }
        setStatusMessage(`✓ Successfully imported ${importedData.length} dealer records into IndexedDB.`);
        setError(null);
      } catch (parseErr: any) {
        setError(`Failed to import JSON: ${parseErr.message}`);
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    };
    reader.readAsText(file);
  };

  const currentRecord = vault[selectedDealerId] ?? null;

  const availableModules = useMemo(() => {
    if (!currentRecord?.flatRules) return [];
    return Array.from(new Set(currentRecord.flatRules.map((r) => r.moduleName))).sort((a, b) => a.localeCompare(b));
  }, [currentRecord]);

  const filteredRules = useMemo(() => {
    if (!currentRecord?.flatRules) return [];
    const q = searchTerm.trim().toLowerCase();

    return currentRecord.flatRules.filter((r) => {
      const matchesModule = !selectedModuleFilter || r.moduleName === selectedModuleFilter;
      const attrString = Object.entries(r.attributes)
        .map(([k, v]) => `${k}:${v}`)
        .join(" ")
        .toLowerCase();

      const matchesSearch =
        !q ||
        r.mappedGlAccount.toLowerCase().includes(q) ||
        r.accountName.toLowerCase().includes(q) ||
        r.accountTypeId.toLowerCase().includes(q) ||
        r.moduleName.toLowerCase().includes(q) ||
        attrString.includes(q) ||
        r.mappedAssetId.toLowerCase().includes(q);

      return matchesModule && matchesSearch;
    });
  }, [currentRecord, searchTerm, selectedModuleFilter]);

  const moduleTableConfigs = useMemo(() => {
    const map: Record<string, { rules: MappingRowItem[]; criteriaKeys: string[] }> = {};

    for (const rule of filteredRules) {
      const mod = rule.moduleName || "General";
      if (!map[mod]) {
        map[mod] = { rules: [], criteriaKeys: [] };
      }
      map[mod].rules.push(rule);

      for (const key of Object.keys(rule.attributes)) {
        if (!map[mod].criteriaKeys.includes(key)) {
          map[mod].criteriaKeys.push(key);
        }
      }
    }

    const sortedKeys = Object.keys(map).sort((a, b) => a.localeCompare(b));
    const sortedMap: Record<string, { rules: MappingRowItem[]; criteriaKeys: string[] }> = {};
    for (const key of sortedKeys) {
      sortedMap[key] = map[key];
    }
    return sortedMap;
  }, [filteredRules]);

  // Copy table with explicit column headers as the first row
  const handleCopyTableColumns = async (moduleName: string, rules: MappingRowItem[], keys: string[]) => {
    try {
      // Header row
      const headerRow = ["Account Name", ...keys, "Account Type ID"].join(", ");
      
      // Data rows
      const dataRows = rules.map((r) => {
        const cleanName = String(r.accountName || "").replace(/,/g, " ");
        const cleanType = String(r.accountTypeId || "").replace(/,/g, " ");
        const attrValues = keys.map((k) => String(r.attributes[k] ?? "—").replace(/,/g, " "));
        return [cleanName, ...attrValues, cleanType].join(", ");
      });

      const textToCopy = [headerRow, ...dataRows].join("\n");
      await navigator.clipboard.writeText(textToCopy);
      setStatusMessage(`✓ Copied headers & columns for "${moduleName}" (${rules.length} rows) to clipboard!`);
    } catch (err) {
      setError("Failed to copy table columns to clipboard.");
    }
  };

  const exportCurrentRulesCsv = () => {
    if (!filteredRules.length) return;
    const headers = ["Index", "Module", "GL Account", "Account Name", "Account Type ID", "Dealer", "Attributes"];
    const rows = filteredRules.map((r, i) => [
      i + 1,
      `"${r.moduleName}"`,
      `"${r.mappedGlAccount}"`,
      `"${r.accountName.replace(/"/g, '""')}"`,
      `"${r.accountTypeId}"`,
      `"${r.mappedDealerId}"`,
      `"${JSON.stringify(r.attributes).replace(/"/g, '""')}"`,
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `glam_tables_${selectedDealerId}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const modules: ValidationModule[] = useMemo(() => {
    return [
      {
        key: "glam_rules",
        label: `📑 Unified Mapped Rules (${filteredRules.length})`,
        assets: ["rulesList"],
        data: {
          rulesList: filteredRules.map((r, idx) => ({
            index: idx + 1,
            module: r.moduleName,
            glAccount: r.mappedGlAccount,
            accountName: r.accountName,
            accountTypeId: r.accountTypeId,
            attributes: r.attributes,
            fullAssetId: r.mappedAssetId,
            dealer: r.mappedDealerId,
          })),
        },
      },
      {
        key: "module_breakdown",
        label: `📊 Module Breakdown (${currentRecord?.modulesCount || 0})`,
        assets: ["breakdown"],
        data: {
          breakdown: availableModules.map((modName, idx) => {
            const count = (currentRecord?.flatRules || []).filter((r) => r.moduleName === modName).length;
            return {
              index: idx + 1,
              moduleName: modName,
              mappedRowsCount: count,
            };
          }),
        },
      },
      {
        key: "raw_json",
        label: "🔍 Raw Tekion Responses",
        assets: ["glamResponse", "bootstrapAccountsResponse"],
        data: {
          glamResponse: currentRecord?.rawResponse ?? { message: "No GLAM data" },
          bootstrapAccountsResponse: currentRecord?.bootstrapRawResponse ?? { message: "No Bootstrap data" },
        },
      },
      {
        key: "all_stores_matrix",
        label: `🌐 All Stores Matrix (${Object.keys(vault).length})`,
        assets: ["stores"],
        data: {
          stores: Object.values(vault).map((s, idx) => ({
            index: idx + 1,
            dealerId: s.dealerId,
            dealerName: s.dealerName,
            tenant: s.tenant || "—",
            status: s.status,
            rulesCount: s.totalRulesCount || 0,
            coaCount: s.totalCoaCount || 0,
            modulesCount: s.modulesCount || 0,
            error: s.error || "—",
            fetchedAt: s.fetchedAt,
          })),
        },
      },
    ];
  }, [availableModules, currentRecord, filteredRules, vault]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          padding: "12px 16px",
          borderRadius: 12,
          background: "rgba(255, 255, 255, 0.03)",
          border: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span
            style={{
              padding: "4px 10px",
              borderRadius: 999,
              background: "rgba(59, 130, 246, 0.15)",
              color: "#93c5fd",
              border: "1px solid rgba(59, 130, 246, 0.3)",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Dynamic Criteria Columns
          </span>

          {Object.keys(vault).length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#94a3b8", fontSize: 12 }}>Dealer:</span>
              <select
                value={selectedDealerId}
                onChange={(e) => {
                  setSelectedDealerId(e.target.value);
                  setSelectedModuleFilter("");
                }}
                style={{
                  height: 30,
                  padding: "0 8px",
                  borderRadius: 6,
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  background: "#1e293b",
                  color: "#f8fafc",
                  fontSize: 12,
                  outline: "none",
                }}
              >
                {Object.values(vault).map((s) => (
                  <option key={s.dealerId} value={s.dealerId}>
                    {s.dealerId} - {s.dealerName} ({s.totalRulesCount} rules)
                  </option>
                ))}
              </select>
            </div>
          )}

          {availableModules.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#94a3b8", fontSize: 12 }}>Module Filter:</span>
              <select
                value={selectedModuleFilter}
                onChange={(e) => setSelectedModuleFilter(e.target.value)}
                style={{
                  height: 30,
                  padding: "0 8px",
                  borderRadius: 6,
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  background: "#1e293b",
                  color: "#f8fafc",
                  fontSize: 12,
                  outline: "none",
                }}
              >
                <option value="">All Tables ({availableModules.length})</option>
                {availableModules.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportJson}
            accept=".json"
            style={{ display: "none" }}
          />

          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={handleExportJson}
            disabled={Object.keys(vault).length === 0}
            title="Download JSON Backup"
          >
            💾 Backup JSON
          </button>

          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => fileInputRef.current?.click()}
            title="Restore saved JSON backup"
          >
            📂 Restore JSON
          </button>

          <div
            style={{
              display: "flex",
              borderRadius: 8,
              border: "1px solid rgba(255, 255, 255, 0.15)",
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              style={{
                padding: "5px 12px",
                fontSize: 12,
                fontWeight: 600,
                background: viewMode === "grid" ? "#3b82f6" : "rgba(0,0,0,0.3)",
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
            >
              ⊞ Module Tables
            </button>
            <button
              type="button"
              onClick={() => setViewMode("shell")}
              style={{
                padding: "5px 12px",
                fontSize: 12,
                fontWeight: 600,
                background: viewMode === "shell" ? "#3b82f6" : "rgba(0,0,0,0.3)",
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
            >
              📋 Shell View
            </button>
          </div>

          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search GL, Name, Criteria..."
            style={{
              height: 32,
              padding: "0 10px",
              borderRadius: 8,
              border: "1px solid rgba(255, 255, 255, 0.12)",
              background: "rgba(0, 0, 0, 0.3)",
              color: "#f8fafc",
              fontSize: 12,
              outline: "none",
              width: 150,
            }}
          />

          {viewMode === "grid" && filteredRules.length > 0 && (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={exportCurrentRulesCsv}
              title="Export visible tables to CSV"
            >
              ⬇ CSV
            </button>
          )}

          <button
            type="button"
            className="btn-primary"
            onClick={handleFetchAllStores}
            disabled={loading}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 700,
              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
              border: "none",
            }}
          >
            {loading ? "⏳ Fetching..." : "⚡ Fetch All Stores"}
          </button>

          {Object.keys(vault).length > 0 && (
            <button type="button" className="btn-secondary btn-sm" onClick={handleClear} title="Clear vault">
              Clear
            </button>
          )}
        </div>
      </div>

      {progressText && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "rgba(16, 185, 129, 0.1)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            color: "#a7f3d0",
            fontSize: 12,
            fontFamily: "monospace",
          }}
        >
          {progressText}
        </div>
      )}

      {statusMessage && !progressText && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "rgba(59, 130, 246, 0.1)",
            border: "1px solid rgba(59, 130, 246, 0.3)",
            color: "#93c5fd",
            fontSize: 12,
          }}
        >
          {statusMessage}
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#fca5a5",
            fontSize: 13,
          }}
        >
          ❌ Error: {error}
        </div>
      )}

      {viewMode === "grid" ? (
        <div style={{ display: "grid", gap: 20 }}>
          <div
            style={{
              padding: "12px 18px",
              borderRadius: 10,
              background: "rgba(255, 255, 255, 0.02)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc" }}>
                {currentRecord?.dealerName || "Select a Dealer"}
              </span>
              <span
                style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 6,
                  background: "rgba(255,255,255,0.08)",
                  color: "#cbd5e1",
                }}
              >
                Dealer ID: {selectedDealerId || "—"}
              </span>
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8" }}>
              Sorted Tables (A-Z): <strong style={{ color: "#e2e8f0" }}>{Object.keys(moduleTableConfigs).length}</strong> | Total Rules: <strong style={{ color: "#e2e8f0" }}>{filteredRules.length}</strong>
            </div>
          </div>

          {filteredRules.length === 0 ? (
            <div
              style={{
                padding: "50px 20px",
                textAlign: "center",
                color: "#64748b",
                borderRadius: 12,
                background: "rgba(15, 23, 42, 0.65)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
              }}
            >
              {loading
                ? "Loading data..."
                : currentRecord
                ? "No mapping rules match your current filter."
                : "No dealer selected or stored stores had 0 rules."}
            </div>
          ) : (
            Object.entries(moduleTableConfigs).map(([moduleName, { rules, criteriaKeys }]) => (
              <div
                key={moduleName}
                style={{
                  borderRadius: 12,
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  background: "rgba(15, 23, 42, 0.65)",
                  backdropFilter: "blur(12px)",
                  overflow: "hidden",
                  boxShadow: "0 10px 30px -10px rgba(0, 0, 0, 0.5)",
                }}
              >
                <div
                  style={{
                    padding: "12px 18px",
                    background: "rgba(59, 130, 246, 0.08)",
                    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#93c5fd" }}>
                      📁 {moduleName}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 6,
                        background: "rgba(59, 130, 246, 0.2)",
                        color: "#bfdbfe",
                        fontWeight: 600,
                      }}
                    >
                      {rules.length} {rules.length === 1 ? "Rule" : "Rules"}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopyTableColumns(moduleName, rules, criteriaKeys)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      background: "rgba(34, 197, 94, 0.15)",
                      color: "#86efac",
                      border: "1px solid rgba(34, 197, 94, 0.3)",
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                    title="Copy with column headers as the first row"
                  >
                    📋 Copy Table with Headers
                  </button>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      textAlign: "left",
                      fontSize: 12,
                      color: "#e2e8f0",
                      fontFamily: "inherit",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          background: "rgba(0, 0, 0, 0.2)",
                          borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
                        }}
                      >
                        <th style={{ padding: "10px 14px", width: "50px", color: "#94a3b8", fontWeight: 700 }}>#</th>
                        <th style={{ padding: "10px 14px", minWidth: "120px", color: "#94a3b8", fontWeight: 700 }}>
                          GL ACCOUNT
                        </th>
                        <th style={{ padding: "10px 14px", minWidth: "220px", color: "#94a3b8", fontWeight: 700 }}>
                          ACCOUNT NAME
                        </th>
                        {criteriaKeys.map((cKey) => (
                          <th key={cKey} style={{ padding: "10px 14px", minWidth: "150px", color: "#38bdf8", fontWeight: 700 }}>
                            {cKey}
                          </th>
                        ))}
                        <th style={{ padding: "10px 14px", minWidth: "160px", color: "#94a3b8", fontWeight: 700 }}>
                          ACCOUNT TYPE ID
                        </th>
                        <th style={{ padding: "10px 14px", minWidth: "70px", color: "#94a3b8", fontWeight: 700 }}>
                          DEALER
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map((rule, idx) => {
                        const isEven = idx % 2 === 0;
                        return (
                          <tr
                            key={rule.id}
                            style={{
                              background: isEven ? "rgba(255, 255, 255, 0.015)" : "transparent",
                              borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                              transition: "background 0.15s ease",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "rgba(59, 130, 246, 0.08)";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = isEven ? "rgba(255, 255, 255, 0.015)" : "transparent";
                            }}
                          >
                            <td style={{ padding: "9px 14px", color: "#64748b", fontWeight: 600 }}>{idx + 1}</td>

                            <td style={{ padding: "9px 14px" }}>
                              <span
                                style={{
                                  display: "inline-block",
                                  padding: "3px 8px",
                                  borderRadius: 6,
                                  background: "rgba(59, 130, 246, 0.15)",
                                  color: "#60a5fa",
                                  border: "1px solid rgba(59, 130, 246, 0.3)",
                                  fontWeight: 700,
                                  fontFamily: "monospace",
                                  fontSize: 12,
                                }}
                              >
                                {rule.mappedGlAccount}
                              </span>
                            </td>

                            <td style={{ padding: "9px 14px", fontWeight: 600, color: "#e2e8f0" }}>
                              {rule.accountName}
                            </td>

                            {criteriaKeys.map((cKey) => {
                              const val = rule.attributes[cKey];
                              const hasVal = val !== null && val !== undefined && String(val).trim() !== "";
                              return (
                                <td key={cKey} style={{ padding: "9px 14px" }}>
                                  {hasVal ? (
                                    <span style={{ color: "#facc15", fontWeight: 600 }}>{String(val)}</span>
                                  ) : (
                                    <span style={{ color: "#475569" }}>—</span>
                                  )}
                                </td>
                              );
                            })}

                            <td style={{ padding: "9px 14px" }}>
                              {rule.accountTypeId !== "—" ? (
                                <span
                                  style={{
                                    fontSize: 11,
                                    padding: "2px 7px",
                                    borderRadius: 5,
                                    background: "rgba(168, 85, 247, 0.15)",
                                    color: "#c084fc",
                                    border: "1px solid rgba(168, 85, 247, 0.3)",
                                    fontWeight: 600,
                                  }}
                                >
                                  {rule.accountTypeId}
                                </span>
                              ) : (
                                <span style={{ color: "#64748b" }}>—</span>
                              )}
                            </td>

                            <td style={{ padding: "9px 14px", color: "#cbd5e1", fontSize: 11 }}>
                              {rule.mappedDealerId || selectedDealerId}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <ValidationShell
          title="GL Account Mapping & COA Validation"
          subtitle="Live mapping patterns & Chart of Accounts matched automatically per dealer"
          modules={modules}
        />
      )}
    </div>
  );
}
