import React, { useCallback, useEffect, useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";

interface Props {}

type ViewKey = "home" | "configure";
type LogLevel = "debug" | "info" | "warn" | "error" | "success";

type UiMessage = {
  ok: boolean;
  text: string;
};

type FlagRow = {
  id?: string;
  order?: number;
  colorCode?: string;
  description?: string;
  defaultFlag?: boolean;
  languages?: unknown;
};

type WarrantyCostCenterRow = {
  costCenter?: string;
  value?: number;
};

type JobClockPunchTimeSetting = {
  customerConcernEditable?: boolean;
  [key: string]: unknown;
};

type RoSetting = {
  warrantyCostCenters?: WarrantyCostCenterRow[];
  warrantyLaborRateInCents?: number;
  internalLaborRateInCents?: number;
  customerPayLaborRateInCents?: number;
  warrantyTaxable?: boolean;
  roFlagsList?: FlagRow[];
  updateFlagHoursOn?: string;
  jobClockPunchTimeSetting?: JobClockPunchTimeSetting;
  [key: string]: unknown;
};

type QuoteExpirationTime = {
  unit?: string;
  timePeriod?: number;
};

type QuoteSetting = {
  quoteFlagsList?: FlagRow[];
  quoteExpirationTime?: QuoteExpirationTime;
  [key: string]: unknown;
};

type ServiceSettingsData = {
  roSetting?: RoSetting;
  quoteSetting?: QuoteSetting;
  [key: string]: unknown;
};

type WarrantyFieldOption = {
  id?: string;
  name?: string;
  [key: string]: unknown;
};

type WarrantyFieldRow = {
  id?: string;
  key?: string;
  name?: string;
  label?: string;
  options?: WarrantyFieldOption[];
  [key: string]: unknown;
};

type WarrantyBootstrapInfo = {
  warrantyFieldId: string;
  warrantyFieldKey: string;
  warrantyFieldName: string;
  warrantyOptionId: string;
  warrantyOptionName: string;
  totalCustomFields: number;
};

type ValidationSnapshot = {
  hasCorrectWarrantyCostCenter: boolean;
  hasNoFlag: boolean;
  hasQuotesFlag: boolean;
  currentWarrantyLaborRateInCents: number | null;
  currentInternalLaborRateInCents: number | null;
  currentCustomerPayLaborRateInCents: number | null;
  currentCustomerConcernEditable: boolean | null;
  currentUpdateFlagHoursOn: string;
  needsUpdate: boolean;
};

type ExecutionLog = {
  id: string;
  time: string;
  level: LogLevel;
  message: string;
  meta?: unknown;
};

const ACCOUNTING_BOOTSTRAP_URL =
  "https://preprodapp.tekioncloud.com/api/accounting/u/configurable/bootstrap";

const SERVICE_SETTINGS_URL =
  "https://preprodapp.tekioncloud.com/api/service-module/u/settings/service-settings";

const logger = {
  debug: (...args: unknown[]) => console.debug("[ServiceSettings]", ...args),
  info: (...args: unknown[]) => console.info("[ServiceSettings]", ...args),
  warn: (...args: unknown[]) => console.warn("[ServiceSettings]", ...args),
  error: (...args: unknown[]) => console.error("[ServiceSettings]", ...args),
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeUpper(value: unknown): string {
  return normalize(value).toUpperCase();
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

function generateFlagId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${timestamp}${random}`;
}

function centsFromDollarsInput(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function formatCurrencyFromCents(value: unknown): string {
  const cents = Number(value);
  if (!Number.isFinite(cents)) return "—";
  return `$${(cents / 100).toFixed(2)}`;
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

function extractWarrantyBootstrapInfo(payload: unknown): WarrantyBootstrapInfo {
  const response = payload as any;
  const customField =
    response?.data?.customField ??
    response?.customField ??
    null;

  if (!customField) {
    throw new Error("customField block not found in bootstrap response.");
  }

  const masterAssetDocMap = customField?.masterAssetDocMap ?? {};
  const allFields = Object.values(masterAssetDocMap) as WarrantyFieldRow[];

  const warrantyField =
    allFields.find((field) => {
      const name = normalizeUpper(field.name);
      const label = normalizeUpper(field.label);
      const key = normalizeUpper(field.key);
      return (
        key === "REPAIR_ORDER_WARRANTY" ||
        name.includes("WARRANTY") ||
        label.includes("WARRANTY") ||
        name.includes("REPAIR ORDER WARRANTY")
      );
    }) ?? null;

  if (!warrantyField) {
    throw new Error("Warranty field not found in bootstrap customField metadata.");
  }

  const warrantyOption =
    (warrantyField.options ?? []).find((opt) =>
      normalizeUpper(opt.name).includes("WARRANTY RECEIVABLE")
    ) ?? null;

  if (!warrantyOption?.id) {
    throw new Error('Option "Warranty Receivable" not found in warranty field options.');
  }

  return {
    warrantyFieldId: normalize(warrantyField.id),
    warrantyFieldKey: normalize(warrantyField.key),
    warrantyFieldName: normalize(warrantyField.name || warrantyField.label),
    warrantyOptionId: normalize(warrantyOption.id),
    warrantyOptionName: normalize(warrantyOption.name),
    totalCustomFields: allFields.length,
  };
}

function evaluateValidationSnapshot(params: {
  currentSettingsData: ServiceSettingsData;
  warrantyCostCenterId: string;
  targetWarrantyLaborRateInCents: number;
  targetInternalLaborRateInCents: number;
  targetCustomerPayLaborRateInCents: number;
  enableNoFlag: boolean;
  enableQuotesFlag: boolean;
  customerConcernEditable: boolean;
  updateFlagHoursOn: string;
}): ValidationSnapshot {
  const {
    currentSettingsData,
    warrantyCostCenterId,
    targetWarrantyLaborRateInCents,
    targetInternalLaborRateInCents,
    targetCustomerPayLaborRateInCents,
    enableNoFlag,
    enableQuotesFlag,
    customerConcernEditable,
    updateFlagHoursOn,
  } = params;

  const roSetting = currentSettingsData?.roSetting ?? {};
  const quoteSetting = currentSettingsData?.quoteSetting ?? {};

  const warrantyCostCenters = Array.isArray(roSetting.warrantyCostCenters)
    ? roSetting.warrantyCostCenters
    : [];

  const roFlagsList = Array.isArray(roSetting.roFlagsList) ? roSetting.roFlagsList : [];
  const quoteFlagsList = Array.isArray(quoteSetting.quoteFlagsList)
    ? quoteSetting.quoteFlagsList
    : [];

  const hasCorrectWarrantyCostCenter = warrantyCostCenters.some(
    (cc) =>
      normalize(cc.costCenter) === warrantyCostCenterId &&
      Number(cc.value) === 100
  );

  const hasNoFlag = roFlagsList.some(
    (flag) => normalizeUpper(flag.description) === "NO FLAG"
  );

  const hasQuotesFlag = quoteFlagsList.some(
    (flag) => normalizeUpper(flag.description) === "QUOTES"
  );

  const currentWarrantyLaborRateInCents =
    typeof roSetting.warrantyLaborRateInCents === "number"
      ? roSetting.warrantyLaborRateInCents
      : null;

  const currentInternalLaborRateInCents =
    typeof roSetting.internalLaborRateInCents === "number"
      ? roSetting.internalLaborRateInCents
      : null;

  const currentCustomerPayLaborRateInCents =
    typeof roSetting.customerPayLaborRateInCents === "number"
      ? roSetting.customerPayLaborRateInCents
      : null;

  const currentCustomerConcernEditable =
    typeof roSetting.jobClockPunchTimeSetting?.customerConcernEditable === "boolean"
      ? roSetting.jobClockPunchTimeSetting.customerConcernEditable
      : null;

  const currentUpdateFlagHoursOn = normalize(roSetting.updateFlagHoursOn);

  const needsUpdate =
    !hasCorrectWarrantyCostCenter ||
    currentWarrantyLaborRateInCents !== targetWarrantyLaborRateInCents ||
    currentInternalLaborRateInCents !== targetInternalLaborRateInCents ||
    currentCustomerPayLaborRateInCents !== targetCustomerPayLaborRateInCents ||
    (enableNoFlag && !hasNoFlag) ||
    (enableQuotesFlag && !hasQuotesFlag) ||
    currentCustomerConcernEditable !== customerConcernEditable ||
    currentUpdateFlagHoursOn !== updateFlagHoursOn;

  return {
    hasCorrectWarrantyCostCenter,
    hasNoFlag,
    hasQuotesFlag,
    currentWarrantyLaborRateInCents,
    currentInternalLaborRateInCents,
    currentCustomerPayLaborRateInCents,
    currentCustomerConcernEditable,
    currentUpdateFlagHoursOn,
    needsUpdate,
  };
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

function scrollWrapStyle(maxHeight: number): React.CSSProperties {
  return {
    maxHeight,
    overflowY: "auto",
    overflowX: "auto",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.06)",
  };
}

const ServiceSettingsView: React.FC<Props> = () => {
  const [headerMap, setHeaderMap] = useState<Record<string, string>>({});
  const [activeView, setActiveView] = useState<ViewKey>("home");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);

  const [warrantyLaborRate, setWarrantyLaborRate] = useState("186.40");
  const [internalLaborRate, setInternalLaborRate] = useState("190.00");
  const [customerPayLaborRate, setCustomerPayLaborRate] = useState("190.00");
  const [enableNoFlag, setEnableNoFlag] = useState(true);
  const [enableQuotesFlag, setEnableQuotesFlag] = useState(true);
  const [customerConcernEditable, setCustomerConcernEditable] = useState(true);
  const [updateFlagHoursOn, setUpdateFlagHoursOn] = useState("JOB_COMPLETE");

  const [currentSettingsRaw, setCurrentSettingsRaw] = useState<unknown>(null);
  const [currentSettingsData, setCurrentSettingsData] = useState<ServiceSettingsData | null>(null);
  const [bootstrapRaw, setBootstrapRaw] = useState<unknown>(null);
  const [warrantyBootstrapInfo, setWarrantyBootstrapInfo] = useState<WarrantyBootstrapInfo | null>(null);
  const [showRawCurrent, setShowRawCurrent] = useState(false);
  const [showRawBootstrap, setShowRawBootstrap] = useState(false);
  const [executionLogs, setExecutionLogs] = useState<ExecutionLog[]>([]);

  const dealerId = useMemo(() => extractDealerIdFromHeaders(headerMap), [headerMap]);
  const headerCount = useMemo(() => Object.keys(headerMap).length, [headerMap]);

  const targetWarrantyLaborRateInCents = useMemo(
    () => centsFromDollarsInput(warrantyLaborRate),
    [warrantyLaborRate]
  );
  const targetInternalLaborRateInCents = useMemo(
    () => centsFromDollarsInput(internalLaborRate),
    [internalLaborRate]
  );
  const targetCustomerPayLaborRateInCents = useMemo(
    () => centsFromDollarsInput(customerPayLaborRate),
    [customerPayLaborRate]
  );

  const appendLog = useCallback((level: LogLevel, text: string, meta?: unknown) => {
    const time = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const entry: ExecutionLog = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time,
      level,
      message: text,
      meta,
    };

    setExecutionLogs((prev) => [entry, ...prev].slice(0, 200));

    if (level === "error") logger.error(text, meta);
    else if (level === "warn") logger.warn(text, meta);
    else if (level === "debug") logger.debug(text, meta);
    else if (level === "success") logger.info(`SUCCESS: ${text}`, meta);
    else logger.info(text, meta);
  }, []);

  const clearLogs = useCallback(() => {
    setExecutionLogs([]);
  }, []);

  const refreshHeaders = useCallback(() => {
    try {
      const loaded = toEnabledHeaderMap(loadGlobalHeaders());
      setHeaderMap(loaded);
      appendLog("info", "Global headers refreshed", {
        headerCount: Object.keys(loaded).length,
        dealerId: extractDealerIdFromHeaders(loaded),
        headerKeys: Object.keys(loaded),
      });
    } catch (e) {
      appendLog("error", "Failed to refresh global headers", e);
      setHeaderMap({});
    }
  }, [appendLog]);

  useEffect(() => {
    appendLog("info", "Service Settings view mounted");
    refreshHeaders();
  }, [appendLog, refreshHeaders]);

  const validationSnapshot = useMemo(() => {
    if (!currentSettingsData || !warrantyBootstrapInfo?.warrantyOptionId) return null;

    return evaluateValidationSnapshot({
      currentSettingsData,
      warrantyCostCenterId: warrantyBootstrapInfo.warrantyOptionId,
      targetWarrantyLaborRateInCents,
      targetInternalLaborRateInCents,
      targetCustomerPayLaborRateInCents,
      enableNoFlag,
      enableQuotesFlag,
      customerConcernEditable,
      updateFlagHoursOn,
    });
  }, [
    currentSettingsData,
    warrantyBootstrapInfo,
    targetWarrantyLaborRateInCents,
    targetInternalLaborRateInCents,
    targetCustomerPayLaborRateInCents,
    enableNoFlag,
    enableQuotesFlag,
    customerConcernEditable,
    updateFlagHoursOn,
  ]);

  const proxyRequest = useCallback(
    async (payload: {
      url: string;
      method: "GET" | "POST";
      body?: unknown;
    }) => {
      appendLog("info", "Proxy request started", {
        method: payload.method,
        url: payload.url,
        dealerId,
        headerCount,
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
        appendLog("error", "Proxy HTTP failure", {
          status: res.status,
          url: payload.url,
        });
        throw new Error(`Proxy request failed with HTTP ${res.status}`);
      }

      const json = await res.json();

      appendLog("info", "Proxy response received", {
        url: payload.url,
        status: json?.status,
        statusText: json?.statusText,
      });

      if ((json?.status ?? 200) >= 400) {
        appendLog("error", "Proxy logical failure", {
          url: payload.url,
          status: json?.status,
          statusText: json?.statusText,
        });
        throw new Error(
          `${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim()
        );
      }

      return json?.body ?? json?.data ?? json;
    },
    [appendLog, dealerId, headerCount, headerMap]
  );

  const loadCurrentData = useCallback(async () => {
    if (!dealerId) {
      throw new Error("Dealer ID not found in Global Headers.");
    }

    appendLog("info", "Step 1: Fetching bootstrap customField data for warranty cost center");

    const bootstrapPayload = {
      requestInfo: [
        {
          assetType: "customField",
          dealerMetaDataInfo: [{ dealerId }],
        },
      ],
    };

    const bootstrapResponse = await proxyRequest({
      url: ACCOUNTING_BOOTSTRAP_URL,
      method: "POST",
      body: bootstrapPayload,
    });

    setBootstrapRaw(bootstrapResponse);

    const bootstrapInfo = extractWarrantyBootstrapInfo(bootstrapResponse);
    setWarrantyBootstrapInfo(bootstrapInfo);

    appendLog("success", "Warranty field resolved from bootstrap", bootstrapInfo);

    appendLog("info", "Step 2: Fetching current service settings");

    const settingsResponse = await proxyRequest({
      url: SERVICE_SETTINGS_URL,
      method: "GET",
    });

    const settingsData = ((settingsResponse as any)?.data ?? settingsResponse) as ServiceSettingsData;

    setCurrentSettingsRaw(settingsResponse);
    setCurrentSettingsData(settingsData);

    appendLog("success", "Current service settings retrieved", {
      hasRoSetting: Boolean(settingsData?.roSetting),
      hasQuoteSetting: Boolean(settingsData?.quoteSetting),
    });

    return {
      bootstrapInfo,
      settingsData,
      bootstrapResponse,
      settingsResponse,
    };
  }, [appendLog, dealerId, proxyRequest]);

  const handleLoadCurrentSettings = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    clearLogs();

    try {
      appendLog("info", "Load Current Settings started");
      await loadCurrentData();
      setMessage({
        ok: true,
        text: "Current Service Settings loaded successfully.",
      });
    } catch (e: unknown) {
      appendLog("error", "Load Current Settings failed", e);
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Failed to load current service settings",
      });
    } finally {
      setLoading(false);
    }
  }, [appendLog, clearLogs, loadCurrentData]);

  const handleResetDefaults = useCallback(() => {
    setWarrantyLaborRate("186.40");
    setInternalLaborRate("190.00");
    setCustomerPayLaborRate("190.00");
    setEnableNoFlag(true);
    setEnableQuotesFlag(true);
    setCustomerConcernEditable(true);
    setUpdateFlagHoursOn("JOB_COMPLETE");
    appendLog("info", "Form reset to recommended defaults");
  }, [appendLog]);

  const handleConfigure = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    clearLogs();

    try {
      appendLog("info", "Configure All Service Settings started", {
        dealerId,
        warrantyLaborRate,
        internalLaborRate,
        customerPayLaborRate,
        enableNoFlag,
        enableQuotesFlag,
        customerConcernEditable,
        updateFlagHoursOn,
      });

      if (!dealerId) {
        throw new Error("Dealer ID not found in Global Headers.");
      }

      if (targetWarrantyLaborRateInCents <= 0) {
        throw new Error("Warranty Labor Rate must be greater than 0.");
      }

      if (targetInternalLaborRateInCents <= 0) {
        throw new Error("Internal Labor Rate must be greater than 0.");
      }

      if (targetCustomerPayLaborRateInCents <= 0) {
        throw new Error("Customer Pay Labor Rate must be greater than 0.");
      }

      const { bootstrapInfo, settingsData } = await loadCurrentData();

      const snapshot = evaluateValidationSnapshot({
        currentSettingsData: settingsData,
        warrantyCostCenterId: bootstrapInfo.warrantyOptionId,
        targetWarrantyLaborRateInCents,
        targetInternalLaborRateInCents,
        targetCustomerPayLaborRateInCents,
        enableNoFlag,
        enableQuotesFlag,
        customerConcernEditable,
        updateFlagHoursOn,
      });

      appendLog("info", "Validation snapshot computed", snapshot);

      if (!snapshot.needsUpdate) {
        appendLog("warn", "Service settings already configured correctly. No update required.");
        setMessage({
          ok: true,
          text: "Service settings are already configured correctly. No update required.",
        });
        return;
      }

      appendLog("info", "Step 3: Building update payload");

      const currentRoSetting = settingsData?.roSetting ?? {};
      const currentQuoteSetting = settingsData?.quoteSetting ?? {};

      let roFlagsList = Array.isArray(currentRoSetting.roFlagsList)
        ? [...currentRoSetting.roFlagsList]
        : [];

      if (enableNoFlag && !snapshot.hasNoFlag) {
        appendLog("info", 'Adding "No Flag" to RO flags');
        roFlagsList = [
          {
            id: generateFlagId(),
            order: 0,
            colorCode: "#ffffff",
            description: "No Flag",
            defaultFlag: false,
            languages: null,
          },
          ...roFlagsList,
        ];
      }

      let quoteFlagsList = Array.isArray(currentQuoteSetting.quoteFlagsList)
        ? [...currentQuoteSetting.quoteFlagsList]
        : [];

      if (enableQuotesFlag && !snapshot.hasQuotesFlag) {
        appendLog("info", 'Adding "Quotes" flag to quote settings');
        quoteFlagsList = [
          {
            id: generateFlagId(),
            order: 0,
            colorCode: "#18bcdc",
            description: "Quotes",
            defaultFlag: false,
            languages: null,
          },
          ...quoteFlagsList,
        ];
      }

      const updatePayload: ServiceSettingsData = {
        ...settingsData,
        roSetting: {
          ...currentRoSetting,
          warrantyCostCenters: [
            {
              costCenter: bootstrapInfo.warrantyOptionId,
              value: 100,
            },
          ],
          warrantyLaborRateInCents: targetWarrantyLaborRateInCents,
          internalLaborRateInCents: targetInternalLaborRateInCents,
          customerPayLaborRateInCents: targetCustomerPayLaborRateInCents,
          warrantyTaxable: false,
          roFlagsList,
          updateFlagHoursOn,
          jobClockPunchTimeSetting: {
            ...(currentRoSetting.jobClockPunchTimeSetting ?? {}),
            customerConcernEditable,
          },
        },
        quoteSetting: {
          ...currentQuoteSetting,
          quoteFlagsList,
          quoteExpirationTime: currentQuoteSetting.quoteExpirationTime || {
            unit: "YEARS",
            timePeriod: 1,
          },
        },
      };

      appendLog("debug", "Update payload ready", updatePayload);

      appendLog("info", "Step 4: Posting updated service settings");

      await proxyRequest({
        url: SERVICE_SETTINGS_URL,
        method: "POST",
        body: updatePayload,
      });

      appendLog("success", "Service settings updated successfully");

      appendLog("info", "Step 5: Reloading current settings after update");
      await loadCurrentData();

      setMessage({
        ok: true,
        text: "Service settings configured successfully.",
      });
    } catch (e: unknown) {
      appendLog("error", "Configure All Service Settings failed", e);
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Failed to configure service settings",
      });
    } finally {
      setLoading(false);
    }
  }, [
    appendLog,
    clearLogs,
    customerConcernEditable,
    dealerId,
    enableNoFlag,
    enableQuotesFlag,
    internalLaborRate,
    loadCurrentData,
    proxyRequest,
    targetCustomerPayLaborRateInCents,
    targetInternalLaborRateInCents,
    targetWarrantyLaborRateInCents,
    updateFlagHoursOn,
    warrantyLaborRate,
    customerPayLaborRate,
  ]);

  return (
    <div
      style={{
        display: "grid",
        gap: 16,
        maxHeight: "100%",
        overflow: "auto",
      }}
      className="service-settings-scroll"
    >
      <style>{`
        .service-settings-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .service-settings-scroll::-webkit-scrollbar-track { background: transparent; }
        .service-settings-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 8px; }
        .service-settings-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.24); }
      `}</style>

      <div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc", marginBottom: 6 }}>
          ⚙️ Service Settings
        </div>
        <div style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.6 }}>
          Configure warranty cost center, labor rates, RO flags, quote flags, and job settings using Global Headers.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={badgeStyle}>
          Dealer ID:{" "}
          <b style={{ color: dealerId ? "#86efac" : "#fca5a5" }}>
            {dealerId || "Not found"}
          </b>
        </span>
        <span style={badgeStyle}>
          Global Headers: <b style={{ color: "#f8fafc" }}>{headerCount}</b>
        </span>
        <span style={badgeStyle}>
          Module: <b style={{ color: "#f8fafc" }}>service-settings</b>
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
              Navigation
            </div>
            <div style={{ color: "#94a3b8", fontSize: 13 }}>
              Open the configure workspace or review the module overview.
            </div>
          </div>

          <button className="btn-secondary btn-sm" onClick={refreshHeaders}>
            ⟳ Refresh Headers
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className={activeView === "home" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => setActiveView("home")}
          >
            Home
          </button>
          <button
            className={activeView === "configure" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => setActiveView("configure")}
          >
            Configure
          </button>
        </div>

        {message ? <div style={{ ...getStatusTone(message.ok), marginTop: 12 }}>{message.text}</div> : null}
      </div>

      {activeView === "home" ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
              What this automation configures
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 12,
              }}
            >
              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.02)",
                  padding: 14,
                }}
              >
                <div style={{ color: "#f8fafc", fontWeight: 800, marginBottom: 6 }}>
                  💰 Labor Rates
                </div>
                <div style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.6 }}>
                  Warranty, Internal, and Customer Pay labor rates are set in cents.
                </div>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.02)",
                  padding: 14,
                }}
              >
                <div style={{ color: "#f8fafc", fontWeight: 800, marginBottom: 6 }}>
                  🧾 Warranty Cost Center
                </div>
                <div style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.6 }}>
                  Reads Warranty Receivable from bootstrap custom fields and applies it as the warranty cost center.
                </div>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.02)",
                  padding: 14,
                }}
              >
                <div style={{ color: "#f8fafc", fontWeight: 800, marginBottom: 6 }}>
                  🚩 Flags
                </div>
                <div style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.6 }}>
                  Can add "No Flag" for ROs and "Quotes" for quote settings if missing.
                </div>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.02)",
                  padding: 14,
                }}
              >
                <div style={{ color: "#f8fafc", fontWeight: 800, marginBottom: 6 }}>
                  🛠 Job Settings
                </div>
                <div style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.6 }}>
                  Controls customer concern editability and update flag timing.
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
              <button
                className="btn-primary"
                onClick={() => setActiveView("configure")}
              >
                Open Configure Panel
              </button>
              <button
                className="btn-secondary btn-sm"
                onClick={() => void handleLoadCurrentSettings()}
                disabled={loading || headerCount === 0}
              >
                {loading ? "Loading..." : "Load Current Settings"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeView === "configure" ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={cardStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 14,
              }}
            >
              <div>
                <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800, marginBottom: 4 }}>
                  Service Settings Configuration
                </div>
                <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>
                  Configure labor rates, warranty setup, RO flags, quote flags, and job behavior.
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => void handleLoadCurrentSettings()}
                  disabled={loading || headerCount === 0}
                >
                  {loading ? "Loading..." : "Load Current Settings"}
                </button>
                <button
                  className="btn-secondary btn-sm"
                  onClick={handleResetDefaults}
                  disabled={loading}
                >
                  Reset Defaults
                </button>
                <button
                  className="btn-primary"
                  onClick={() => void handleConfigure()}
                  disabled={loading || headerCount === 0}
                >
                  {loading ? "Configuring..." : "⚙️ Configure All Service Settings"}
                </button>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: 14,
              }}
            >
              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.018)",
                  padding: 14,
                }}
              >
                <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 12 }}>
                  💰 Labor Rates Configuration
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                  <div>
                    <label style={{ display: "block", color: "#cbd5e1", fontSize: 13, marginBottom: 6 }}>
                      Warranty Labor Rate ($ / hour)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={warrantyLaborRate}
                      onChange={(e) => setWarrantyLaborRate(e.target.value)}
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
                  </div>

                  <div>
                    <label style={{ display: "block", color: "#cbd5e1", fontSize: 13, marginBottom: 6 }}>
                      Internal Labor Rate ($ / hour)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={internalLaborRate}
                      onChange={(e) => setInternalLaborRate(e.target.value)}
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
                  </div>

                  <div>
                    <label style={{ display: "block", color: "#cbd5e1", fontSize: 13, marginBottom: 6 }}>
                      Customer Pay Labor Rate ($ / hour)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={customerPayLaborRate}
                      onChange={(e) => setCustomerPayLaborRate(e.target.value)}
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
                  </div>
                </div>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.018)",
                  padding: 14,
                }}
              >
                <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 12 }}>
                  🚩 RO Flags & Quote Settings
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, color: "#e2e8f0", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={enableNoFlag}
                      onChange={(e) => setEnableNoFlag(e.target.checked)}
                    />
                    <span>
                      <b>Enable "No Flag"</b>
                      <div style={{ color: "#94a3b8", marginTop: 4 }}>
                        White flag for ROs without a specific flag.
                      </div>
                    </span>
                  </label>

                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, color: "#e2e8f0", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={enableQuotesFlag}
                      onChange={(e) => setEnableQuotesFlag(e.target.checked)}
                    />
                    <span>
                      <b>Enable "Quotes" Flag</b>
                      <div style={{ color: "#94a3b8", marginTop: 4 }}>
                        Blue flag for quote documents.
                      </div>
                    </span>
                  </label>
                </div>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.06)",
                  background: "rgba(255,255,255,0.018)",
                  padding: 14,
                }}
              >
                <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 12 }}>
                  🛠 Job Settings
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 10, color: "#e2e8f0", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={customerConcernEditable}
                      onChange={(e) => setCustomerConcernEditable(e.target.checked)}
                    />
                    <span>
                      <b>Customer Concern Editable</b>
                      <div style={{ color: "#94a3b8", marginTop: 4 }}>
                        Allow technicians to edit customer concerns during clock in / out.
                      </div>
                    </span>
                  </label>

                  <div>
                    <label style={{ display: "block", color: "#cbd5e1", fontSize: 13, marginBottom: 6 }}>
                      Update Flag Hours On
                    </label>
                    <select
                      value={updateFlagHoursOn}
                      onChange={(e) => setUpdateFlagHoursOn(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "12px 14px",
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,0.10)",
                        background: "rgba(255,255,255,0.03)",
                        color: "#f8fafc",
                        outline: "none",
                      }}
                    >
                      <option value="JOB_COMPLETE">Job Complete</option>
                      <option value="RO_INVOICED">RO Invoiced</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {warrantyBootstrapInfo ? (
            <div style={cardStyle}>
              <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
                Bootstrap Warranty Resolution
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                <span style={badgeStyle}>
                  Field: <b style={{ color: "#f8fafc" }}>{warrantyBootstrapInfo.warrantyFieldName}</b>
                </span>
                <span style={badgeStyle}>
                  Field Key: <b style={{ color: "#f8fafc" }}>{warrantyBootstrapInfo.warrantyFieldKey}</b>
                </span>
                <span style={badgeStyle}>
                  Warranty Option: <b style={{ color: "#86efac" }}>{warrantyBootstrapInfo.warrantyOptionName}</b>
                </span>
                <span style={badgeStyle}>
                  Cost Center ID: <b style={{ color: "#86efac" }}>{warrantyBootstrapInfo.warrantyOptionId}</b>
                </span>
              </div>

              {bootstrapRaw ? (
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => setShowRawBootstrap((v) => !v)}
                >
                  {showRawBootstrap ? "Hide Bootstrap JSON" : "Show Bootstrap JSON"}
                </button>
              ) : null}

              {showRawBootstrap && bootstrapRaw ? (
                <div style={{ marginTop: 12 }}>
                  <div className="service-settings-scroll" style={scrollWrapStyle(320)}>
                    <pre style={{ ...monoStyle, margin: 0, padding: 12 }}>
                      {JSON.stringify(bootstrapRaw, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {currentSettingsData ? (
            <div style={cardStyle}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 12,
                }}
              >
                <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
                  Current Settings Snapshot
                </div>

                {validationSnapshot ? (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      borderRadius: 999,
                      padding: "4px 10px",
                      fontSize: 12,
                      fontWeight: 700,
                      color: validationSnapshot.needsUpdate ? "#fcd34d" : "#86efac",
                      background: validationSnapshot.needsUpdate
                        ? "rgba(245,158,11,0.10)"
                        : "rgba(34,197,94,0.10)",
                      border: validationSnapshot.needsUpdate
                        ? "1px solid rgba(245,158,11,0.22)"
                        : "1px solid rgba(34,197,94,0.22)",
                    }}
                  >
                    {validationSnapshot.needsUpdate ? "Update Needed" : "Already Configured"}
                  </span>
                ) : null}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 12,
                }}
              >
                <div
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.06)",
                    background: "rgba(255,255,255,0.02)",
                    padding: 12,
                  }}
                >
                  <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 6 }}>
                    Current Warranty Labor Rate
                  </div>
                  <div style={{ color: "#f8fafc", fontWeight: 800 }}>
                    {formatCurrencyFromCents(validationSnapshot?.currentWarrantyLaborRateInCents)}
                  </div>
                </div>

                <div
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.06)",
                    background: "rgba(255,255,255,0.02)",
                    padding: 12,
                  }}
                >
                  <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 6 }}>
                    Current Internal Labor Rate
                  </div>
                  <div style={{ color: "#f8fafc", fontWeight: 800 }}>
                    {formatCurrencyFromCents(validationSnapshot?.currentInternalLaborRateInCents)}
                  </div>
                </div>

                <div
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.06)",
                    background: "rgba(255,255,255,0.02)",
                    padding: 12,
                  }}
                >
                  <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 6 }}>
                    Current Customer Pay Labor Rate
                  </div>
                  <div style={{ color: "#f8fafc", fontWeight: 800 }}>
                    {formatCurrencyFromCents(validationSnapshot?.currentCustomerPayLaborRateInCents)}
                  </div>
                </div>

                <div
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.06)",
                    background: "rgba(255,255,255,0.02)",
                    padding: 12,
                  }}
                >
                  <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 6 }}>
                    Update Flag Hours On
                  </div>
                  <div style={{ color: "#f8fafc", fontWeight: 800 }}>
                    {validationSnapshot?.currentUpdateFlagHoursOn || "—"}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                <span style={badgeStyle}>
                  Warranty Cost Center Match:{" "}
                  <b style={{ color: validationSnapshot?.hasCorrectWarrantyCostCenter ? "#86efac" : "#fcd34d" }}>
                    {validationSnapshot?.hasCorrectWarrantyCostCenter ? "YES" : "NO"}
                  </b>
                </span>
                <span style={badgeStyle}>
                  "No Flag":{" "}
                  <b style={{ color: validationSnapshot?.hasNoFlag ? "#86efac" : "#fcd34d" }}>
                    {validationSnapshot?.hasNoFlag ? "Present" : "Missing"}
                  </b>
                </span>
                <span style={badgeStyle}>
                  "Quotes" Flag:{" "}
                  <b style={{ color: validationSnapshot?.hasQuotesFlag ? "#86efac" : "#fcd34d" }}>
                    {validationSnapshot?.hasQuotesFlag ? "Present" : "Missing"}
                  </b>
                </span>
                <span style={badgeStyle}>
                  Customer Concern Editable:{" "}
                  <b style={{ color: "#f8fafc" }}>
                    {validationSnapshot?.currentCustomerConcernEditable === null
                      ? "Unknown"
                      : validationSnapshot?.currentCustomerConcernEditable
                      ? "Yes"
                      : "No"}
                  </b>
                </span>
              </div>

              {currentSettingsRaw ? (
                <div style={{ marginTop: 12 }}>
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => setShowRawCurrent((v) => !v)}
                  >
                    {showRawCurrent ? "Hide Current Settings JSON" : "Show Current Settings JSON"}
                  </button>
                </div>
              ) : null}

              {showRawCurrent && currentSettingsRaw ? (
                <div style={{ marginTop: 12 }}>
                  <div className="service-settings-scroll" style={scrollWrapStyle(320)}>
                    <pre style={{ ...monoStyle, margin: 0, padding: 12 }}>
                      {JSON.stringify(currentSettingsRaw, null, 2)}
                    </pre>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div style={cardStyle}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
                Execution Logs
              </div>
              <button className="btn-secondary btn-sm" onClick={clearLogs}>
                Clear Logs
              </button>
            </div>

            <div className="service-settings-scroll" style={scrollWrapStyle(320)}>
              <div style={{ display: "grid", gap: 8, padding: 12 }}>
                {executionLogs.length > 0 ? (
                  executionLogs.map((log) => (
                    <div
                      key={log.id}
                      style={{
                        borderRadius: 12,
                        border:
                          log.level === "error"
                            ? "1px solid rgba(239,68,68,0.18)"
                            : log.level === "warn"
                            ? "1px solid rgba(245,158,11,0.18)"
                            : log.level === "success"
                            ? "1px solid rgba(34,197,94,0.18)"
                            : "1px solid rgba(255,255,255,0.06)",
                        background:
                          log.level === "error"
                            ? "rgba(239,68,68,0.06)"
                            : log.level === "warn"
                            ? "rgba(245,158,11,0.06)"
                            : log.level === "success"
                            ? "rgba(34,197,94,0.06)"
                            : "rgba(255,255,255,0.02)",
                        padding: 10,
                      }}
                    >
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                        <span style={{ color: "#94a3b8", fontSize: 11 }}>{log.time}</span>
                        <span
                          style={{
                            color:
                              log.level === "error"
                                ? "#fca5a5"
                                : log.level === "warn"
                                ? "#fcd34d"
                                : log.level === "success"
                                ? "#86efac"
                                : "#93c5fd",
                            fontSize: 11,
                            fontWeight: 800,
                            textTransform: "uppercase",
                          }}
                        >
                          {log.level}
                        </span>
                      </div>
                      <div style={{ color: "#e2e8f0", fontSize: 13 }}>{log.message}</div>
                      {log.meta !== undefined ? (
                        <details style={{ marginTop: 8 }}>
                          <summary style={{ cursor: "pointer", color: "#93c5fd", fontSize: 12 }}>
                            View meta
                          </summary>
                          <pre
                            style={{
                              ...monoStyle,
                              margin: "8px 0 0",
                              padding: 10,
                              borderRadius: 10,
                              background: "#0f172a",
                              overflow: "auto",
                            }}
                          >
                            {JSON.stringify(log.meta, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <div style={{ color: "#94a3b8", fontSize: 13 }}>
                    No logs yet. Run "Load Current Settings" or "Configure All Service Settings".
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ServiceSettingsView;
