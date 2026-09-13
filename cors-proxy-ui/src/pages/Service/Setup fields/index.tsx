import React, { useCallback, useEffect, useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";

type ViewKey = "home" | "get" | "post";

type UiMessage = {
  ok: boolean;
  text: string;
};

type ExtrasMap = Record<string, unknown>;

type CustomFieldOption = {
  id?: string;
  name?: string;
  deleted?: boolean;
  formEditable?: boolean;
  systemDefined?: boolean;
  extras?: ExtrasMap;
  details?: unknown;
  languages?: unknown;
};

type CustomFieldRow = {
  id?: string;
  key?: string;
  name?: string;
  assetSubType?: string;
  options?: CustomFieldOption[];
  [key: string]: unknown;
};

type ConfigureResultRow = {
  field: string;
  key: string;
  status: "success" | "error" | "skipped";
  message: string;
};

const ACCOUNTING_BOOTSTRAP_URL =
  "https://preprodapp.tekioncloud.com/api/accounting/u/configurable/bootstrap";

const logger = {
  debug: (...args: unknown[]) => console.debug("[SetupFields]", ...args),
  info: (...args: unknown[]) => console.info("[SetupFields]", ...args),
  warn: (...args: unknown[]) => console.warn("[SetupFields]", ...args),
  error: (...args: unknown[]) => console.error("[SetupFields]", ...args),
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeLower(value: unknown): string {
  return normalize(value).toLowerCase();
}

function toEnabledHeaderMap(headers: KeyValuePair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of headers) {
    if (!row?.enabled) continue;
    const key = normalize(row.key);
    const value = normalize(row.value);
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function findHeaderValueCaseInsensitive(
  headers: Record<string, string>,
  candidates: string[]
): string {
  const entries = Object.entries(headers);
  for (const candidate of candidates) {
    const found = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
    if (found?.[1]) return normalize(found[1]);
  }
  return "";
}

function extractDealerIdFromHeaders(headers: Record<string, string>): string {
  return findHeaderValueCaseInsensitive(headers, [
    "dealerid",
    "dealerId",
    "dealer-id",
    "x-dealer-id",
  ]);
}

function getStatusTone(ok: boolean): React.CSSProperties {
  return {
    color: ok ? "#bbf7d0" : "#fecaca",
    background: ok ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
    border: ok
      ? "1px solid rgba(34,197,94,0.22)"
      : "1px solid rgba(239,68,68,0.22)",
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 13,
  };
}

function getResultPill(status: "success" | "error" | "skipped"): React.ReactNode {
  const map = {
    success: {
      text: "SUCCESS",
      color: "#86efac",
      background: "rgba(34,197,94,0.10)",
      border: "1px solid rgba(34,197,94,0.22)",
    },
    error: {
      text: "ERROR",
      color: "#fca5a5",
      background: "rgba(239,68,68,0.10)",
      border: "1px solid rgba(239,68,68,0.22)",
    },
    skipped: {
      text: "SKIPPED",
      color: "#fcd34d",
      background: "rgba(245,158,11,0.10)",
      border: "1px solid rgba(245,158,11,0.22)",
    },
  } as const;

  const tone = map[status];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 700,
        color: tone.color,
        background: tone.background,
        border: tone.border,
      }}
    >
      {tone.text}
    </span>
  );
}

const badgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "#cbd5e1",
  fontSize: 12,
  whiteSpace: "nowrap",
};

const cardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  padding: 16,
  minWidth: 0,
};

const monoStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  color: "#e2e8f0",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

function tableScrollWrapStyle(maxHeight: number): React.CSSProperties {
  return {
    maxHeight,
    overflowY: "auto",
    overflowX: "auto",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.06)",
  };
}

const tableElementStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 980,
  borderCollapse: "collapse",
};

const stickyThStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  background: "#111827",
  color: "#94a3b8",
  textAlign: "left",
  padding: "10px 12px",
  fontSize: 12,
  fontWeight: 800,
  zIndex: 1,
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  borderBottom: "1px solid rgba(255,255,255,0.05)",
  verticalAlign: "top",
};

function zebraRowStyle(index: number): React.CSSProperties {
  return {
    background: index % 2 === 1 ? "rgba(255,255,255,0.015)" : "transparent",
  };
}

function parseUserInput(inputText: string, fieldKey: string): CustomFieldOption[] | null {
  const optionNames = inputText
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  if (optionNames.length === 0) return null;

  if (fieldKey === "REPAIR_ORDER_INTERNAL") {
    logger.debug("Parsing REPAIR_ORDER_INTERNAL input", optionNames);

    const vehicleInventoryKeywords = [
      "new car inventory",
      "new truck inventory",
      "used car inventory",
      "used truck inventory",
      "vehicle inventory -invv",
    ];

    let hasVehicleInventory = false;
    const regularOptions: string[] = [];

    optionNames.forEach((name) => {
      const normalized = normalizeLower(name);
      if (vehicleInventoryKeywords.includes(normalized)) {
        hasVehicleInventory = true;
      } else {
        regularOptions.push(name);
      }
    });

    const finalOptions: CustomFieldOption[] = [];

    if (hasVehicleInventory) {
      finalOptions.push({
        name: "Vehicle Inventory -INVV",
        extras: {
          enableControl: [false],
          enableControl2: [false],
          inactive: ["false"],
        },
      });
    }

    regularOptions.forEach((name) => {
      finalOptions.push({
        name,
        extras: {
          enableControl: [false],
          enableControl2: [false],
          inactive: ["false"],
        },
      });
    });

    logger.debug("Parsed REPAIR_ORDER_INTERNAL final options", finalOptions);
    return finalOptions;
  }

  const parsed = optionNames.map((name) => ({
    name,
    extras: { inactive: ["false"] },
  }));

  logger.debug(`Parsed ${fieldKey} input`, parsed);
  return parsed;
}

function validateAndMergeOptions(
  existingOptions: CustomFieldOption[],
  newOptions: CustomFieldOption[],
  fieldKey: string
): {
  options: CustomFieldOption[];
  hasNewOptions: boolean;
  addedCount: number;
  existingCount: number;
} {
  logger.info(
    `Validating field ${fieldKey}`,
    {
      existingCount: existingOptions.length,
      newCount: newOptions.length,
      existingNames: existingOptions.map((x) => x.name),
      newNames: newOptions.map((x) => x.name),
    }
  );

  const existingNames = new Set(
    existingOptions.map((opt) => normalizeLower(opt.name))
  );

  const optionsToAdd = newOptions.filter((newOpt) => {
    const normalizedName = normalizeLower(newOpt.name);
    const exists = normalizedName && existingNames.has(normalizedName);

    if (exists) {
      logger.debug(`Skipping existing option for ${fieldKey}`, newOpt.name);
    } else {
      logger.debug(`Adding new option for ${fieldKey}`, newOpt.name);
    }

    return normalizedName && !exists;
  });

  const merged = [...existingOptions, ...optionsToAdd];

  logger.info(`Validation complete for ${fieldKey}`, {
    existingCount: existingOptions.length,
    addedCount: optionsToAdd.length,
    totalCount: merged.length,
  });

  return {
    options: merged,
    hasNewOptions: optionsToAdd.length > 0,
    addedCount: optionsToAdd.length,
    existingCount: existingOptions.length,
  };
}

function processPartsInternalOptions(existingOptions: CustomFieldOption[]) {
  logger.info("Processing PARTS_SALES_ORDER_INTERNAL", {
    existingCount: existingOptions.length,
  });

  const inactiveIds = ["NEW_TRUCK_INVENTORY", "USED_CAR_INVENTORY", "USED_TRUCK_INVENTORY"];
  let changesNeeded = false;
  let addedCount = 0;

  const processedOptions: CustomFieldOption[] = existingOptions.map((option) => {
    const shouldBeInactive = inactiveIds.includes(normalize(option.id));
    const currentlyInactive = (option.extras as any)?.inactive?.[0] === "true";
    const currentlyDeleted = option.deleted === true;

    if (shouldBeInactive && (!currentlyInactive || !currentlyDeleted)) {
      changesNeeded = true;
      logger.debug("Marking option inactive", {
        id: option.id,
        name: option.name,
      });
    }

    return {
      ...option,
      deleted: shouldBeInactive,
      extras: {
        ...(option.extras ?? {}),
        inactive: [shouldBeInactive ? "true" : "false"],
      },
    };
  });

  const existingNames = new Set(processedOptions.map((opt) => normalizeLower(opt.name)));
  const otherSuppliesExists = existingNames.has("other supplies");

  if (!otherSuppliesExists) {
    logger.debug('Adding "Other Supplies" option');
    processedOptions.push({
      id: "OTHER_SUPPLIES",
      name: "Other Supplies",
      formEditable: true,
      extras: {
        default: ["true"],
        code: ["OTHER_SUPPLIES"],
        inactive: ["false"],
      } as ExtrasMap,
      deleted: false,
      systemDefined: false,
      details: null,
      languages: null,
    } as CustomFieldOption);
    changesNeeded = true;
    addedCount += 1;
  }

  const inactiveChanges = inactiveIds.filter((id) => {
    const option = existingOptions.find((opt) => normalize(opt.id) === id);
    return option && (((option.extras as any)?.inactive?.[0] !== "true") || option.deleted !== true);
  }).length;

  addedCount += inactiveChanges;

  logger.info("Processed PARTS_SALES_ORDER_INTERNAL result", {
    changesNeeded,
    addedCount,
    existingCount: existingOptions.length,
    totalCount: processedOptions.length,
  });

  return {
    options: processedOptions,
    hasNewOptions: changesNeeded,
    addedCount,
    existingCount: existingOptions.length,
  };
}

function getOptionsForField(
  field: CustomFieldRow,
  inputInternal: string,
  inputCustomerPay: string
):
  | {
      options: CustomFieldOption[];
      hasNewOptions: boolean;
      addedCount: number;
      existingCount: number;
    }
  | null {
  const key = normalize(field.key);

  logger.debug("Resolving options for field", {
    fieldName: field.name,
    fieldKey: key,
    currentOptionCount: Array.isArray(field.options) ? field.options.length : 0,
  });

  const fixedDefaults: Record<string, CustomFieldOption[]> = {
    REPAIR_ORDER_CP_IW_SPLIT: [
      {
        name: "Service Contracts Receivables",
        extras: { inactive: ["false"] },
      },
    ],
    REPAIR_ORDER_WARRANTY: [
      {
        name: "Warranty Receivable",
        extras: { inactive: ["false"] },
      },
      {
        name: "PDI",
        extras: { inactive: ["false"] },
      },
    ],
  };

  if (key === "PARTS_SALES_ORDER_INTERNAL") {
    return processPartsInternalOptions(field.options || []);
  }

  if (fixedDefaults[key]) {
    return validateAndMergeOptions(field.options || [], fixedDefaults[key], key);
  }

  if (key === "REPAIR_ORDER_INTERNAL") {
    const inputText = normalize(inputInternal);
    if (!inputText) return null;
    const parsed = parseUserInput(inputText, key);
    if (!parsed) return null;
    return validateAndMergeOptions(field.options || [], parsed, key);
  }

  if (key === "REPAIR_ORDER_CUSTOMER_PAY") {
    const inputText = normalize(inputCustomerPay);
    if (!inputText) return null;
    const parsed = parseUserInput(inputText, key);
    if (!parsed) return null;
    return validateAndMergeOptions(field.options || [], parsed, key);
  }

  logger.debug("No automation rule found for field", key);
  return null;
}

const SetupFieldsView: React.FC = () => {
  const [headerMap, setHeaderMap] = useState<Record<string, string>>({});
  const [activeView, setActiveView] = useState<ViewKey>("home");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);

  const [costCenterFields, setCostCenterFields] = useState<CustomFieldRow[]>([]);
  const [configureResults, setConfigureResults] = useState<ConfigureResultRow[]>([]);
  const [rawBootstrapResponse, setRawBootstrapResponse] = useState<unknown>(null);
  const [showRawBootstrap, setShowRawBootstrap] = useState(false);

  const [inputInternal, setInputInternal] = useState("Vehicle Inventory -INVV");
  const [inputCustomerPay, setInputCustomerPay] = useState(
    "Parts Receivable, Service Receivable"
  );

  const dealerId = useMemo(() => extractDealerIdFromHeaders(headerMap), [headerMap]);
  const headerCount = useMemo(() => Object.keys(headerMap).length, [headerMap]);

  const refreshHeaders = useCallback(() => {
    try {
      const loaded = toEnabledHeaderMap(loadGlobalHeaders());
      logger.info("Global headers refreshed", {
        headerCount: Object.keys(loaded).length,
        dealerId: extractDealerIdFromHeaders(loaded),
        headerKeys: Object.keys(loaded),
      });
      setHeaderMap(loaded);
    } catch (e) {
      logger.error("Failed to refresh global headers", e);
      setHeaderMap({});
    }
  }, []);

  useEffect(() => {
    logger.info("Setup Fields view mounted");
    refreshHeaders();
  }, [refreshHeaders]);

  const proxyRequest = useCallback(
    async (payload: {
      url: string;
      method: "POST" | "PUT";
      body?: unknown;
    }) => {
      logger.info("Proxy request start", {
        method: payload.method,
        url: payload.url,
        dealerId,
        headerCount,
        bodyPreview: payload.body ? JSON.stringify(payload.body).slice(0, 500) : null,
      });

      const res = await fetch("http://localhost:4000/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: payload.url,
          method: payload.method,
          headers: {
            ...headerMap,
            ...(payload.body ? { "content-type": "application/json" } : {}),
          },
          body: payload.body,
          timeout: 60000,
        }),
      });

      if (!res.ok) {
        logger.error("Proxy HTTP failure", {
          status: res.status,
          url: payload.url,
        });
        throw new Error(`Proxy request failed with HTTP ${res.status}`);
      }

      const json = await res.json();

      logger.debug("Proxy response envelope", {
        status: json?.status,
        statusText: json?.statusText,
        hasBody: json?.body !== undefined,
        hasData: json?.data !== undefined,
        topLevelKeys: json && typeof json === "object" ? Object.keys(json) : [],
      });

      if ((json?.status ?? 200) >= 400) {
        logger.error("Proxy logical failure", {
          status: json?.status,
          statusText: json?.statusText,
          url: payload.url,
        });
        throw new Error(
          `${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim()
        );
      }

      return json?.body ?? json?.data ?? json;
    },
    [dealerId, headerCount, headerMap]
  );

  const fetchBootstrapCustomFields = useCallback(async () => {
    if (!dealerId) {
      logger.warn("Dealer ID missing in global headers");
      throw new Error("Dealer ID not found in Global Headers.");
    }

    const payload = {
      requestInfo: [
        {
          assetType: "customField",
          dealerMetaDataInfo: [{ dealerId }],
        },
      ],
    };

    logger.info("Fetching bootstrap customField data", {
      dealerId,
      payload,
    });

    const response = await proxyRequest({
      url: ACCOUNTING_BOOTSTRAP_URL,
      method: "POST",
      body: payload,
    });

    logger.debug("Bootstrap response root snapshot", response);

    const customField =
      (response as any)?.data?.customField ??
      (response as any)?.customField ??
      null;

    if (!customField) {
      logger.error("customField missing in bootstrap response", response);
      throw new Error("customField data not found in bootstrap response.");
    }

    logger.info("customField section found", {
      assetLevel: customField?.assetLevel,
      typeOfObject: customField?.typeOfObject,
      masterAssetDocMapKeys: Object.keys(customField?.masterAssetDocMap ?? {}).length,
      dealerAssetDocMapKeys: Object.keys(customField?.dealerAssetDocMap ?? {}).length,
    });

    const masterAssetDocMap = customField?.masterAssetDocMap ?? {};
    const allFields = Object.values(masterAssetDocMap) as CustomFieldRow[];

    logger.info("masterAssetDocMap extracted", {
      totalFields: allFields.length,
      sampleKeys: allFields.slice(0, 20).map((x) => ({
        id: x.id,
        key: x.key,
        name: x.name,
        assetSubType: x.assetSubType,
        optionCount: Array.isArray(x.options) ? x.options.length : 0,
      })),
    });

    const fields = allFields.filter(
      (field) => normalize(field?.assetSubType) === "cost_center"
    );

    logger.info("Filtered cost center fields", {
      count: fields.length,
      fields: fields.map((field) => ({
        id: field.id,
        key: field.key,
        name: field.name,
        optionCount: Array.isArray(field.options) ? field.options.length : 0,
      })),
    });

    setRawBootstrapResponse(response);
    setCostCenterFields(fields);

    return fields;
  }, [dealerId, proxyRequest]);

  const handleGet = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setConfigureResults([]);

    logger.info("GET flow started");

    try {
      const fields = await fetchBootstrapCustomFields();
      logger.info("GET flow success", { fieldCount: fields.length });

      setMessage({
        ok: true,
        text: `Fetched ${fields.length} cost center field(s) successfully.`,
      });
    } catch (e: unknown) {
      logger.error("GET flow failed", e);
      setCostCenterFields([]);
      setRawBootstrapResponse(null);
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Failed to fetch setup fields",
      });
    } finally {
      setLoading(false);
    }
  }, [fetchBootstrapCustomFields]);

  const handleConfigure = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setConfigureResults([]);

    logger.info("POST/configure flow started", {
      dealerId,
      inputInternal,
      inputCustomerPay,
    });

    try {
      const fields = await fetchBootstrapCustomFields();
      const results: ConfigureResultRow[] = [];

      logger.info("Beginning sequential configuration", {
        fieldCount: fields.length,
      });

      for (const field of fields) {
        try {
          logger.info("Processing field", {
            id: field.id,
            key: field.key,
            name: field.name,
            currentOptionCount: Array.isArray(field.options) ? field.options.length : 0,
          });

          const validationResult = getOptionsForField(field, inputInternal, inputCustomerPay);

          if (validationResult === null) {
            logger.info("Field skipped - no automation payload", {
              key: field.key,
              name: field.name,
            });

            results.push({
              field: normalize(field.name) || "Unknown Field",
              key: normalize(field.key),
              status: "skipped",
              message: "No input provided",
            });
            continue;
          }

          const { options, hasNewOptions, addedCount, existingCount } = validationResult;

          logger.info("Field validation result", {
            key: field.key,
            name: field.name,
            hasNewOptions,
            addedCount,
            existingCount,
            totalAfterMerge: options.length,
            mergedOptionNames: options.map((x) => x.name),
          });

          if (!hasNewOptions) {
            results.push({
              field: normalize(field.name) || "Unknown Field",
              key: normalize(field.key),
              status: "skipped",
              message: `All ${existingCount} option(s) already configured`,
            });
            continue;
          }

          const updatePayload = {
            ...field,
            options,
            tenantId: null,
            defaultValue: null,
            defaultValueEnabled: false,
          };

          logger.debug("PUT payload for custom field", {
            fieldId: field.id,
            fieldKey: field.key,
            fieldName: field.name,
            payload: updatePayload,
          });

          await proxyRequest({
            url: `https://preprodapp.tekioncloud.com/api/settings/u/customField/accounts/${field.id}`,
            method: "PUT",
            body: updatePayload,
          });

          logger.info("Field configured successfully", {
            key: field.key,
            name: field.name,
            addedCount,
            totalCount: options.length,
          });

          results.push({
            field: normalize(field.name) || "Unknown Field",
            key: normalize(field.key),
            status: "success",
            message: `Added ${addedCount} new option(s) (total: ${options.length})`,
          });
        } catch (e: unknown) {
          logger.error("Field configuration failed", {
            fieldId: field.id,
            fieldKey: field.key,
            fieldName: field.name,
            error: e,
          });

          results.push({
            field: normalize(field.name) || "Unknown Field",
            key: normalize(field.key),
            status: "error",
            message: e instanceof Error ? e.message : "Update failed",
          });
        }
      }

      logger.info("Sequential configuration finished", results);

      setConfigureResults(results);

      const successCount = results.filter((r) => r.status === "success").length;
      const errorCount = results.filter((r) => r.status === "error").length;
      const skippedCount = results.filter((r) => r.status === "skipped").length;

      logger.info("POST/configure summary", {
        successCount,
        errorCount,
        skippedCount,
      });

      setMessage({
        ok: errorCount === 0,
        text: `Configuration complete — ${successCount} configured, ${errorCount} errors, ${skippedCount} skipped.`,
      });
    } catch (e: unknown) {
      logger.error("POST/configure flow failed", e);
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Failed to configure setup fields",
      });
    } finally {
      setLoading(false);
    }
  }, [dealerId, fetchBootstrapCustomFields, inputCustomerPay, inputInternal, proxyRequest]);

  const resultStats = useMemo(() => {
    return {
      total: configureResults.length,
      success: configureResults.filter((r) => r.status === "success").length,
      error: configureResults.filter((r) => r.status === "error").length,
      skipped: configureResults.filter((r) => r.status === "skipped").length,
    };
  }, [configureResults]);

  return (
    <div
      style={{
        display: "grid",
        gap: 16,
        maxHeight: "100%",
        overflow: "auto",
      }}
      className="setup-fields-scroll"
    >
      <style>{`
        .setup-fields-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .setup-fields-scroll::-webkit-scrollbar-track { background: transparent; }
        .setup-fields-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 8px; }
        .setup-fields-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.24); }
      `}</style>

      <div>

      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={badgeStyle}>
          Dealer ID: <b style={{ color: dealerId ? "#86efac" : "#fca5a5" }}>{dealerId || "Not found"}</b>
        </span>
        <span style={badgeStyle}>
          Global Headers: <b style={{ color: "#f8fafc" }}>{headerCount}</b>
        </span>

      </div>

      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 12,
          }}
        >
          <div>
            <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800, marginBottom: 4 }}>
              Operations
                      </div>
          </div>

          <button className="btn-secondary btn-sm" onClick={refreshHeaders}>
            ⟳ Refresh Headers
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button
            className={activeView === "get" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => setActiveView("get")}
          >
            📥 GET
          </button>
          <button
            className={activeView === "post" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => setActiveView("post")}
          >
            ⚙️ POST
          </button>
        </div>

        {message ? <div style={getStatusTone(message.ok)}>{message.text}</div> : null}
      </div>

      {activeView === "home" ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }}>
              Quick Actions
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
              <button
                className="btn-primary"
                onClick={() => {
                  setActiveView("get");
                  void handleGet();
                }}
                disabled={loading || headerCount === 0}
                style={{ minHeight: 64 }}
              >
                {loading ? "Loading..." : "📥 View Setup Fields"}
              </button>

              <button
                className="btn-secondary btn-sm"
                onClick={() => setActiveView("post")}
                style={{ minHeight: 64 }}
              >
                ⚙️ Open Configuration
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeView === "get" ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={cardStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 4 }}>
                  View Setup Fields
                </div>
                <div style={{ color: "#94a3b8", fontSize: 13 }}>
                  Reads cost center custom fields from accounting bootstrap.
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn-primary"
                  onClick={() => void handleGet()}
                  disabled={loading || headerCount === 0}
                >
                  {loading ? "Fetching..." : "📥 Get Setup Fields"}
                </button>

                {rawBootstrapResponse ? (
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => setShowRawBootstrap((v) => !v)}
                  >
                    {showRawBootstrap ? "Hide Raw JSON" : "Show Raw JSON"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
              Cost Center Fields ({costCenterFields.length})
            </div>

            <div className="setup-fields-scroll" style={tableScrollWrapStyle(480)}>
              <table className="bx-table" style={tableElementStyle}>
                <thead>
                  <tr>
                    <th style={stickyThStyle}>Field Name</th>
                    <th style={stickyThStyle}>Key</th>
                    <th style={stickyThStyle}>Field ID</th>
                    <th style={stickyThStyle}>Options Count</th>
                  </tr>
                </thead>
                <tbody>
                  {costCenterFields.length > 0 ? (
                    costCenterFields.map((field, index) => (
                      <tr key={`${field.id || field.key || "field"}-${index}`} style={zebraRowStyle(index)}>
                        <td style={tdStyle}>
                          <div style={{ color: "#f8fafc", fontWeight: 700 }}>
                            {field.name || "—"}
                          </div>
                        </td>
                        <td style={tdStyle}>
                          <code style={monoStyle}>{field.key || "—"}</code>
                        </td>
                        <td style={tdStyle}>
                          <code style={monoStyle}>{field.id || "—"}</code>
                        </td>
                        <td style={tdStyle}>{Array.isArray(field.options) ? field.options.length : 0}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td style={tdStyle} colSpan={4}>
                        <div style={{ color: "#94a3b8" }}>No fields loaded yet.</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {showRawBootstrap && rawBootstrapResponse ? (
              <div style={{ marginTop: 14 }}>
                <pre
                  style={{
                    ...monoStyle,
                    margin: 0,
                    padding: 12,
                    borderRadius: 12,
                    background: "#0f172a",
                    maxHeight: 320,
                    overflow: "auto",
                  }}
                >
                  {JSON.stringify(rawBootstrapResponse, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeView === "post" ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 8 }}>
              Cost Center Fields Configuration
            </div>
            <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
              Automated configuration for supported cost center custom fields.
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <div
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderLeft: "4px solid #3b82f6",
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <div style={{ color: "#f8fafc", fontWeight: 700 }}>
                  Repair Order CP IW Split
                </div>
                <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
                  REPAIR_ORDER_CP_IW_SPLIT
                </div>
                <div style={{ color: "#cbd5e1", fontSize: 13, marginTop: 8 }}>
                  Default: Service Contracts Receivables
                </div>
              </div>

              <div
                style={{
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderLeft: "4px solid #3b82f6",
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                <div style={{ color: "#f8fafc", fontWeight: 700 }}>
                  Repair Order Warranty
                </div>
                <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
                  REPAIR_ORDER_WARRANTY
                </div>
                <div style={{ color: "#cbd5e1", fontSize: 13, marginTop: 8 }}>
                  Default: Warranty Receivable, PDI
                </div>
              </div>

              <div>
                <label style={{ display: "block", color: "#f8fafc", fontWeight: 700, marginBottom: 6 }}>
                  Repair Order Internal
                  <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 12, marginLeft: 6 }}>
                    (REPAIR_ORDER_INTERNAL)
                  </span>
                </label>
                <input
                  value={inputInternal}
                  onChange={(e) => setInputInternal(e.target.value)}
                  placeholder="Enter options separated by commas"
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.03)",
                    color: "#f8fafc",
                    outline: "none",
                  }}
                />
                <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 6 }}>
                  Enter multiple options separated by commas.
                </div>
              </div>

              <div>
                <label style={{ display: "block", color: "#f8fafc", fontWeight: 700, marginBottom: 6 }}>
                  Repair Order Customer Pay
                  <span style={{ color: "#94a3b8", fontWeight: 400, fontSize: 12, marginLeft: 6 }}>
                    (REPAIR_ORDER_CUSTOMER_PAY)
                  </span>
                </label>
                <input
                  value={inputCustomerPay}
                  onChange={(e) => setInputCustomerPay(e.target.value)}
                  placeholder="Enter options separated by commas"
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(255,255,255,0.03)",
                    color: "#f8fafc",
                    outline: "none",
                  }}
                />
                <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 6 }}>
                  Enter multiple options separated by commas.
                </div>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <button
                className="btn-primary"
                onClick={() => void handleConfigure()}
                disabled={loading || headerCount === 0}
              >
                {loading ? "Configuring..." : "⚙️ Configure Setup Fields"}
              </button>
            </div>
          </div>

          {configureResults.length > 0 ? (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={badgeStyle}>
                  Total: <b style={{ color: "#f8fafc" }}>{resultStats.total}</b>
                </span>
                <span style={badgeStyle}>
                  Configured: <b style={{ color: "#86efac" }}>{resultStats.success}</b>
                </span>
                <span style={badgeStyle}>
                  Errors: <b style={{ color: "#fca5a5" }}>{resultStats.error}</b>
                </span>
                <span style={badgeStyle}>
                  Skipped: <b style={{ color: "#fcd34d" }}>{resultStats.skipped}</b>
                </span>
              </div>

              <div style={cardStyle}>
                <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
                  Configuration Results
                </div>

                <div className="setup-fields-scroll" style={tableScrollWrapStyle(420)}>
                  <table className="bx-table" style={tableElementStyle}>
                    <thead>
                      <tr>
                        <th style={stickyThStyle}>Field</th>
                        <th style={stickyThStyle}>Key</th>
                        <th style={stickyThStyle}>Status</th>
                        <th style={stickyThStyle}>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {configureResults.map((result, index) => (
                        <tr key={`${result.key}-${index}`} style={zebraRowStyle(index)}>
                          <td style={tdStyle}>
                            <div style={{ color: "#f8fafc", fontWeight: 700 }}>
                              {result.field}
                            </div>
                          </td>
                          <td style={tdStyle}>
                            <code style={monoStyle}>{result.key}</code>
                          </td>
                          <td style={tdStyle}>{getResultPill(result.status)}</td>
                          <td style={tdStyle}>{result.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default SetupFieldsView;
