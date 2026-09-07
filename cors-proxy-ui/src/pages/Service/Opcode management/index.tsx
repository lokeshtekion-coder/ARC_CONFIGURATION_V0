import React, { useCallback, useEffect, useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";

type ViewKey =
  | "home"
  | "service-types"
  | "custom-service-type"
  | "mpvi"
  | "sublet"
  | "pdi"
  | "cust"
  | "get"
  | "post";

type UiMessage = {
  ok: boolean;
  text: string;
};

type LaborRateRow = {
  id?: string;
  code?: string;
  name?: string;
  description?: string;
};

type ServiceTypeRow = {
  id?: string;
  key?: string;
  name?: string;
  status?: string;
  laborRateConfigs?: unknown[];
};

type OpcodeRow = {
  id?: string;
  opcode?: string;
  code?: string;
  displayValue?: string;
  opcodeType?: string;
  inspectionType?: string | null;
  category?: string | null;
  description?: string;
  customerDescription?: string;
  serviceTypeIds?: string[];
  subletOpCode?: boolean;
  priceDetails?: unknown;
  skillId?: string | null;
  status?: string;
  defaultSubPayType?: string;
  defaultPayType?: string;
  includeInCustomerScheduling?: boolean;
  causes?: unknown[];
  storyLinesV2?: unknown[];
  eligibleForCPSpecialLaborPricing?: boolean;
  customerPartPricingEnabled?: boolean;
  partsPricingCapEnabled?: boolean;
  partsSalePricingType?: string | null;
  eligibleForPartPreparation?: boolean;
  forcedPartSelectionEnabled?: boolean;
  canOverrideWarrantyCostCenter?: boolean;
  warrantyCostCenters?: unknown;
  canOverrideInternalCostCenter?: boolean;
  internalCostCenters?: unknown;
  clockInMandatory?: boolean;
  laborTimeInSeconds?: number | string;
  customerLaborTimeInSeconds?: number | string;
  manufacturerLaborTimeInSeconds?: number | string;
  regDivGar?: unknown;
  accountingGroup?: unknown;
  linkedOpcodesV2?: unknown[];
  suggestedOpcodes?: unknown[];
  fees?: unknown[];
  parts?: unknown[];
  labels?: unknown[];
  oemOpcodes?: unknown[];
  maxPartsSaleAmount?: unknown;
  customerPayMaxPartsSaleAmount?: unknown;
  warrantyPayMaxPartsSaleAmount?: unknown;
  internalPayMaxPartsSaleAmount?: unknown;
  fixedPartsSaleAmount?: unknown;
  customerPayFixedPartsSaleAmount?: unknown;
  warrantyPayFixedPartsSaleAmount?: unknown;
  internalPayFixedPartsSaleAmount?: unknown;
  autoDispatch?: boolean;
  autoComplete?: boolean;
  subletMarkUpDetails?: unknown[];
  priority?: number;
  opcodeSource?: string;
  eligibility?: { criteria?: unknown[] };
  systemOpcode?: string;
  shortDescription?: string;
  serviceTypes?: unknown;
  [key: string]: unknown;
};

type ValidationResult = {
  success: boolean;
  action?: string;
  error?: string;
  validated?: boolean;
  serviceTypeName?: string;
  serviceTypeId?: string;
  opcodeId?: string;
};

type ServiceTypeSetupResult = {
  success: boolean;
  created?: string[];
  configured?: number;
  skipped?: number;
  error?: string;
  serviceTypeIds?: Record<string, string>;
};

const API_BASE_URL = "https://preprodapp.tekioncloud.com/api";

const cardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.02)",
  padding: 16,
  minWidth: 0,
};

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

const monoStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  color: "#e2e8f0",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

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

function tableScrollWrapStyle(maxHeight: number): React.CSSProperties {
  return {
    maxHeight,
    overflowY: "auto",
    overflowX: "auto",
    borderRadius: 10,
    border: "1px solid rgba(255,255,255,0.06)",
  };
}

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

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function unwrapOpcodeSearchRows(payload: unknown): OpcodeRow[] {
  const root = payload as { data?: unknown };
  const rawData = root?.data ?? payload;

  if (Array.isArray(rawData)) return rawData as OpcodeRow[];

  if (
    rawData &&
    typeof rawData === "object" &&
    Array.isArray((rawData as { hits?: unknown[] }).hits)
  ) {
    return (rawData as { hits: OpcodeRow[] }).hits;
  }

  if (
    rawData &&
    typeof rawData === "object" &&
    Array.isArray((rawData as { data?: unknown[] }).data)
  ) {
    return (rawData as { data: OpcodeRow[] }).data;
  }

  if (rawData && typeof rawData === "object") return [rawData as OpcodeRow];
  return [];
}

function unwrapFirstOpcodeHit(hit: unknown): OpcodeRow | null {
  let item = hit as
    | OpcodeRow
    | { hits?: unknown[]; data?: unknown | unknown[] }
    | null
    | undefined;

  if (!item) return null;

  if (
    Array.isArray((item as { hits?: unknown[] }).hits) &&
    (item as { hits?: unknown[] }).hits!.length > 0
  ) {
    item = (item as { hits: unknown[] }).hits[0] as OpcodeRow;
  } else if ((item as { data?: unknown }).data && !(item as OpcodeRow).opcode) {
    const nested = (item as { data?: unknown | unknown[] }).data;
    item = Array.isArray(nested) ? (nested[0] as OpcodeRow) : (nested as OpcodeRow);
  }

  return item && typeof item === "object" ? (item as OpcodeRow) : null;
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

function getSmallResultPill(ok: boolean, text: string): React.ReactNode {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 700,
        color: ok ? "#86efac" : "#fca5a5",
        background: ok ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
        border: ok
          ? "1px solid rgba(34,197,94,0.22)"
          : "1px solid rgba(239,68,68,0.22)",
      }}
    >
      {text}
    </span>
  );
}

function matchLaborRates(laborRates: LaborRateRow[]): Record<string, string> {
  const rateMap: Record<string, string> = {};

  laborRates.forEach((rate) => {
    const code = normalizeUpper(rate.code);
    const name = normalizeUpper(rate.name);
    const description = normalizeUpper(rate.description);
    const id = normalize(rate.id);
    if (!id) return;

    if (
      code === "CP" ||
      name === "CP" ||
      name.includes("CUSTOMER PAY") ||
      description.includes("CUSTOMER")
    ) {
      rateMap.CUSTOMER_PAY = id;
    } else if (
      code === "IP" ||
      name === "IP" ||
      name.includes("INTERNAL") ||
      description.includes("INTERNAL")
    ) {
      rateMap.INTERNAL = id;
    } else if (
      code === "WP" ||
      name === "WP" ||
      name.includes("WARRANTY") ||
      description.includes("WARRANTY")
    ) {
      rateMap.WARRANTY = id;
    }
  });

  return rateMap;
}

function buildMPVIPayload(
  currentData: OpcodeRow,
  serviceTypeResult?: ServiceTypeSetupResult | null
): Record<string, unknown> {
  const existingIds = Array.isArray(currentData.serviceTypeIds) ? [...currentData.serviceTypeIds] : [];
  const idsSet = new Set(existingIds);

  if (serviceTypeResult?.serviceTypeIds) {
    Object.values(serviceTypeResult.serviceTypeIds).forEach((id) => {
      if (id) idsSet.add(id);
    });
  }

  return {
    ...currentData,
    opcode: "MPVI",
    opcodeType: "INSPECTION",
    inspectionType: "MPVI",
    category: "MPVI",
    serviceTypeIds: Array.from(idsSet),
    description:
      currentData.description || "PERFORM CERTIFIED MULTI-POINT VEHICLE INSPECTION",
    customerDescription:
      currentData.customerDescription ||
      "PERFORM CERTIFIED MULTI-POINT VEHICLE INSPECTION",
    displayValue: currentData.displayValue || "MPVI",
    status: currentData.status || "ACTIVE",
  };
}

function buildSubletPayload(currentData: OpcodeRow, subletServiceType: ServiceTypeRow) {
  return {
    ...currentData,
    serviceTypeIds: subletServiceType.id ? [subletServiceType.id] : [],
    subletOpCode: true,
    priceDetails: null,
    serviceTypes: [
      {
        name: subletServiceType.name,
        key: subletServiceType.key,
        id: subletServiceType.id,
        priceDetails: [
          {
            payType: "CUSTOMER_PAY",
            subPayType: "CUSTOMER_PAY",
            priceCode: null,
            laborRateType: null,
            laborRateId: null,
            pricePerHour: null,
            flatPrice: null,
          },
          {
            payType: "INTERNAL",
            subPayType: "INTERNAL",
            priceCode: null,
            laborRateType: null,
            laborRateId: null,
            pricePerHour: null,
            flatPrice: null,
          },
          {
            payType: "WARRANTY",
            subPayType: "WARRANTY",
            priceCode: null,
            laborRateType: null,
            laborRateId: null,
            pricePerHour: null,
            flatPrice: null,
          },
        ],
      },
    ],
  };
}

function buildPDIPayload(currentData: OpcodeRow, pdiServiceType: ServiceTypeRow) {
  return {
    ...currentData,
    serviceTypeIds: pdiServiceType.id ? [pdiServiceType.id] : [],
    priceDetails: null,
    serviceTypes: [
      {
        name: pdiServiceType.name,
        key: pdiServiceType.key,
        id: pdiServiceType.id,
        priceDetails: [
          {
            payType: "CUSTOMER_PAY",
            subPayType: "CUSTOMER_PAY",
            priceCode: null,
            laborRateType: null,
            laborRateId: null,
            pricePerHour: null,
            flatPrice: null,
          },
          {
            payType: "INTERNAL",
            subPayType: "INTERNAL",
            priceCode: null,
            laborRateType: null,
            laborRateId: null,
            pricePerHour: null,
            flatPrice: null,
          },
          {
            payType: "WARRANTY",
            subPayType: "WARRANTY",
            priceCode: null,
            laborRateType: null,
            laborRateId: null,
            pricePerHour: null,
            flatPrice: null,
          },
        ],
      },
    ],
  };
}

const OpcodeManagementView: React.FC = () => {
  const [headerMap, setHeaderMap] = useState<Record<string, string>>({});
  const [activeView, setActiveView] = useState<ViewKey>("home");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);

  const [getRows, setGetRows] = useState<OpcodeRow[]>([]);
  const [rawGetResponse, setRawGetResponse] = useState<unknown>(null);
  const [showRawGet, setShowRawGet] = useState(false);

  const [serviceTypes, setServiceTypes] = useState<ServiceTypeRow[]>([]);
  const [serviceTypesPreviewVisible, setServiceTypesPreviewVisible] = useState(false);

  const [customServiceTypeName, setCustomServiceTypeName] = useState("");
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  const dealerId = useMemo(() => extractDealerIdFromHeaders(headerMap), [headerMap]);
  const headerCount = useMemo(() => Object.keys(headerMap).length, [headerMap]);

  const refreshHeaders = useCallback(() => {
    try {
      setHeaderMap(toEnabledHeaderMap(loadGlobalHeaders()));
    } catch {
      setHeaderMap({});
    }
  }, []);

  useEffect(() => {
    refreshHeaders();
  }, [refreshHeaders]);

  const resetTransientStateForView = useCallback((nextView: ViewKey) => {
    setMessage(null);
    setValidationResult(null);

    if (nextView !== "get") {
      setGetRows([]);
      setRawGetResponse(null);
      setShowRawGet(false);
    }

    if (nextView !== "service-types") {
      setServiceTypesPreviewVisible(false);
    }

    if (nextView !== "custom-service-type") {
      setCustomServiceTypeName("");
    }
  }, []);

  const proxyRequest = useCallback(
    async (payload: {
      url: string;
      method: "GET" | "POST" | "PUT";
      body?: unknown;
    }) => {
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
        throw new Error(`Proxy request failed with HTTP ${res.status}`);
      }

      const json = await res.json();

      if ((json?.status ?? 200) >= 400) {
        throw new Error(
          `${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim()
        );
      }

      return json?.body ?? json?.data ?? json;
    },
    [headerMap]
  );

  const fetchServiceTypes = useCallback(async (): Promise<ServiceTypeRow[]> => {
    const payload = await proxyRequest({
      url: `${API_BASE_URL}/service-module/u/opcode/serviceTypes`,
      method: "GET",
    });

    const rows = Array.isArray((payload as { data?: unknown[] })?.data)
      ? ((payload as { data: unknown[] }).data as ServiceTypeRow[])
      : Array.isArray(payload)
      ? (payload as ServiceTypeRow[])
      : [];

    setServiceTypes(rows);
    return rows;
  }, [proxyRequest]);

  const fetchLaborRates = useCallback(async (): Promise<LaborRateRow[]> => {
    const payload = await proxyRequest({
      url: `${API_BASE_URL}/service-module/u/labor-pricing/laborRate`,
      method: "GET",
    });

    const rows = Array.isArray((payload as { data?: unknown[] })?.data)
      ? ((payload as { data: unknown[] }).data as LaborRateRow[])
      : Array.isArray(payload)
      ? (payload as LaborRateRow[])
      : [];

    return rows;
  }, [proxyRequest]);

  const createServiceType = useCallback(
    async (typeName: string, rateMap: Record<string, string>) => {
      const createLaborRateConfig = (
        subPayType: string,
        laborRateId: string,
        order: number,
        serviceTypeId: string | null = null
      ) => ({
        id: generateUUID(),
        parentId: null,
        values: [
          {
            field: "LABOR_RATE",
            value: {
              type: "DYNAMIC",
              value: null,
              id: laborRateId,
            },
          },
        ],
        order,
        sourceModuleInfo: {
          sourceModule: "SERVICE_TYPE",
          sourceModuleAssetId: serviceTypeId,
          sourceAdditionalDetails: null,
        },
        parameters: [
          {
            parameter: "SUB_PAY_TYPE",
            values: [subPayType],
            allValues: false,
          },
          {
            parameter: "CUSTOMER_TYPE",
            values: [],
            allValues: true,
          },
        ],
      });

      const payload = {
        name: typeName,
        status: "ACTIVE",
        laborRateConfigInfo: {
          deleted: [],
          updated: [],
          added: [
            createLaborRateConfig("CUSTOMER_PAY", rateMap.CUSTOMER_PAY, 3),
            createLaborRateConfig("INTERNAL", rateMap.INTERNAL, 2),
            createLaborRateConfig("WARRANTY", rateMap.WARRANTY, 1),
          ],
        },
      };

      return await proxyRequest({
        url: `${API_BASE_URL}/service-module/u/opcode/serviceType/create`,
        method: "POST",
        body: payload,
      });
    },
    [proxyRequest]
  );

  const configureServiceType = useCallback(
    async (id: string, name: string, rateMap: Record<string, string>) => {
      const createLaborRateConfig = (
        subPayType: string,
        laborRateId: string,
        order: number
      ) => ({
        id: generateUUID(),
        parentId: null,
        values: [
          {
            field: "LABOR_RATE",
            value: {
              type: "DYNAMIC",
              value: null,
              id: laborRateId,
            },
          },
        ],
        order,
        sourceModuleInfo: {
          sourceModule: "SERVICE_TYPE",
          sourceModuleAssetId: id,
          sourceAdditionalDetails: null,
        },
        parameters: [
          {
            parameter: "SUB_PAY_TYPE",
            values: [subPayType],
            allValues: false,
          },
          {
            parameter: "CUSTOMER_TYPE",
            values: [],
            allValues: true,
          },
        ],
      });

      const payload = {
        name,
        status: "ACTIVE",
        laborRateConfigInfo: {
          deleted: [],
          updated: [],
          added: [
            createLaborRateConfig("CUSTOMER_PAY", rateMap.CUSTOMER_PAY, 3),
            createLaborRateConfig("INTERNAL", rateMap.INTERNAL, 2),
            createLaborRateConfig("WARRANTY", rateMap.WARRANTY, 1),
          ],
        },
      };

      return await proxyRequest({
        url: `${API_BASE_URL}/service-module/u/opcode/serviceType/${id}/update`,
        method: "PUT",
        body: payload,
      });
    },
    [proxyRequest]
  );

  const performServiceTypeSetup = useCallback(async (): Promise<ServiceTypeSetupResult> => {
    try {
      const laborRates = await fetchLaborRates();
      const rateMap = matchLaborRates(laborRates);

      const missing: string[] = [];
      if (!rateMap.CUSTOMER_PAY) missing.push("Customer Pay (CP)");
      if (!rateMap.INTERNAL) missing.push("Internal (IP)");
      if (!rateMap.WARRANTY) missing.push("Warranty (WP)");

      if (missing.length > 0) {
        return {
          success: false,
          error: `Missing required labor rates: ${missing.join(", ")}. Please configure Labor Pricing first.`,
        };
      }

      let currentServiceTypes = await fetchServiceTypes();
      const created: string[] = [];
      const serviceTypeIds: Record<string, string> = {};

      const existingPdi = currentServiceTypes.find(
        (st) => normalizeUpper(st.name) === "PDI" || normalizeUpper(st.key) === "PDI"
      );
      const existingSublet = currentServiceTypes.find(
        (st) => normalizeUpper(st.name) === "SUBLET" || normalizeUpper(st.key) === "SUBLET"
      );

      if (!existingPdi) {
        await createServiceType("PDI", rateMap);
        created.push("PDI");
      }

      if (!existingSublet) {
        await createServiceType("Sublet", rateMap);
        created.push("Sublet");
      }

      currentServiceTypes = await fetchServiceTypes();

      currentServiceTypes.forEach((st) => {
        if (st.id && st.name) serviceTypeIds[normalizeUpper(st.name)] = st.id;
        if (st.id && st.key) serviceTypeIds[normalizeUpper(st.key)] = st.id;
      });

      const needsConfig = currentServiceTypes.filter(
        (st) => !Array.isArray(st.laborRateConfigs) || st.laborRateConfigs.length === 0
      );

      let configured = 0;
      for (const st of needsConfig) {
        if (!st.id || !st.name) continue;
        await configureServiceType(st.id, st.name, rateMap);
        configured += 1;
      }

      return {
        success: true,
        created,
        configured,
        skipped: currentServiceTypes.length - needsConfig.length,
        serviceTypeIds,
      };
    } catch (e: unknown) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Service type setup failed",
      };
    }
  }, [configureServiceType, createServiceType, fetchLaborRates, fetchServiceTypes]);

  const performMPVIConfiguration = useCallback(
    async (setupResult?: ServiceTypeSetupResult | null): Promise<ValidationResult> => {
      try {
        const searchResponse = await proxyRequest({
          url: `${API_BASE_URL}/service-module/u/opcode/search`,
          method: "POST",
          body: { searchText: "MPVI" },
        });

        const rows = unwrapOpcodeSearchRows(searchResponse);
        if (rows.length === 0) {
          return { success: false, error: "MPVI opcode not found in search results." };
        }

        const mpviSearchHit = unwrapFirstOpcodeHit(rows[0]);
        const opcodeIdentifier =
          normalize(mpviSearchHit?.opcode) ||
          normalize(mpviSearchHit?.code) ||
          normalize(mpviSearchHit?.displayValue);

        if (!opcodeIdentifier) {
          return { success: false, error: "Cannot determine MPVI opcode identifier." };
        }

        const detailsResponse = await proxyRequest({
          url: `${API_BASE_URL}/service-module/u/opcode/${opcodeIdentifier}/v2`,
          method: "GET",
        });

        const opcode = ((detailsResponse as { data?: unknown }).data ?? detailsResponse) as OpcodeRow;

        if (!opcode?.id || !opcode?.opcode) {
          return {
            success: false,
            error: "MPVI payload from GET is missing required identifiers.",
          };
        }

        const needsUpdate =
          normalize(opcode.opcodeType) !== "INSPECTION" ||
          normalize(opcode.inspectionType) !== "MPVI";

        if (!needsUpdate) {
          return {
            success: true,
            action: "Already configured correctly",
            validated: true,
          };
        }

        const payload = setupResult
          ? buildMPVIPayload(opcode, setupResult)
          : {
              ...opcode,
              opcodeType: "INSPECTION",
              inspectionType: "MPVI",
            };

        await proxyRequest({
          url: `${API_BASE_URL}/service-module/u/opcode/v2/${opcode.id}`,
          method: "PUT",
          body: payload,
        });

        return {
          success: true,
          action: "Updated to INSPECTION / MPVI",
          validated: true,
        };
      } catch (e: unknown) {
        return {
          success: false,
          error: e instanceof Error ? e.message : "MPVI configuration failed",
        };
      }
    },
    [proxyRequest]
  );

  const performSubletConfiguration = useCallback(async (): Promise<ValidationResult> => {
    try {
      const rows = await fetchServiceTypes();
      const subletServiceType =
        rows.find(
          (st) =>
            normalizeUpper(st.key) === "SUBLET" || normalizeUpper(st.name) === "SUBLET"
        ) ?? null;

      if (!subletServiceType?.id) {
        return {
          success: false,
          error: "Sublet service type not found. Run Service Types setup first.",
        };
      }

      const detailsResponse = await proxyRequest({
        url: `${API_BASE_URL}/service-module/u/opcode/SUBLET/v2`,
        method: "GET",
      });

      const opcode = ((detailsResponse as { data?: unknown }).data ?? detailsResponse) as OpcodeRow;

      const checks = {
        hasServiceTypeIds: Array.isArray(opcode?.serviceTypeIds),
        includesCorrectServiceType: opcode?.serviceTypeIds?.includes(subletServiceType.id) ?? false,
        subletFlagEnabled: opcode?.subletOpCode === true,
        priceDetailsIsNull: opcode?.priceDetails === null,
      };

      const needsUpdate =
        !checks.hasServiceTypeIds ||
        !checks.includesCorrectServiceType ||
        !checks.subletFlagEnabled ||
        !checks.priceDetailsIsNull;

      if (!needsUpdate) {
        return {
          success: true,
          action: "Already configured correctly",
          validated: true,
          serviceTypeName: subletServiceType.name,
          serviceTypeId: subletServiceType.id,
        };
      }

      await proxyRequest({
        url: `${API_BASE_URL}/service-module/u/opcode/v2/${opcode.id}`,
        method: "PUT",
        body: buildSubletPayload(opcode, subletServiceType),
      });

      return {
        success: true,
        action: "Updated with correct service type and sublet flag",
        validated: true,
        serviceTypeName: subletServiceType.name,
        serviceTypeId: subletServiceType.id,
      };
    } catch (e: unknown) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Sublet configuration failed",
      };
    }
  }, [fetchServiceTypes, proxyRequest]);

  const performPDIConfiguration = useCallback(async (): Promise<ValidationResult> => {
    try {
      const rows = await fetchServiceTypes();
      const pdiServiceType =
        rows.find(
          (st) => normalizeUpper(st.key) === "PDI" || normalizeUpper(st.name) === "PDI"
        ) ?? null;

      if (!pdiServiceType?.id) {
        return {
          success: false,
          error: "PDI service type not found. Run Service Types setup first.",
        };
      }

      const detailsResponse = await proxyRequest({
        url: `${API_BASE_URL}/service-module/u/opcode/PDI/v2`,
        method: "GET",
      });

      const opcode = ((detailsResponse as { data?: unknown }).data ?? detailsResponse) as OpcodeRow;

      const checks = {
        hasServiceTypeIds: Array.isArray(opcode?.serviceTypeIds),
        includesCorrectServiceType: opcode?.serviceTypeIds?.includes(pdiServiceType.id) ?? false,
        priceDetailsIsNull: opcode?.priceDetails === null,
      };

      const needsUpdate =
        !checks.hasServiceTypeIds ||
        !checks.includesCorrectServiceType ||
        !checks.priceDetailsIsNull;

      if (!needsUpdate) {
        return {
          success: true,
          action: "Already configured correctly",
          validated: true,
          serviceTypeName: pdiServiceType.name,
          serviceTypeId: pdiServiceType.id,
        };
      }

      await proxyRequest({
        url: `${API_BASE_URL}/service-module/u/opcode/v2/${opcode.id}`,
        method: "PUT",
        body: buildPDIPayload(opcode, pdiServiceType),
      });

      return {
        success: true,
        action: "Updated with PDI service type and pricing structure",
        validated: true,
        serviceTypeName: pdiServiceType.name,
        serviceTypeId: pdiServiceType.id,
      };
    } catch (e: unknown) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "PDI configuration failed",
      };
    }
  }, [fetchServiceTypes, proxyRequest]);

  const createCustConcernOpcode = useCallback(async (): Promise<ValidationResult> => {
    try {
      try {
        await proxyRequest({
          url: `${API_BASE_URL}/service-module/u/opcode/CUST/v2`,
          method: "GET",
        });

        return {
          success: true,
          action: "Already exists",
          opcodeId: "CUST",
        };
      } catch {
        // continue create flow
      }

      const serviceTypeRows = await fetchServiceTypes();
      const mainService =
        serviceTypeRows.find(
          (st) =>
            normalizeUpper(st.key) === "MAIN_SERVICE" ||
            normalizeUpper(st.name) === "MAIN SERVICE" ||
            normalizeUpper(st.name).includes("MAIN")
        ) ?? null;

      const serviceTypeIds = mainService?.id
        ? [mainService.id]
        : serviceTypeRows[0]?.id
        ? [serviceTypeRows[0].id]
        : [];

      let skillId: string | null = null;

      try {
        const mpviResponse = await proxyRequest({
          url: `${API_BASE_URL}/service-module/u/opcode/MPVI/v2`,
          method: "GET",
        });
        skillId =
          normalize(
            (((mpviResponse as { data?: OpcodeRow }).data ?? mpviResponse) as OpcodeRow)?.skillId
          ) || null;
      } catch {
        // ignore
      }

      if (!skillId) {
        try {
          const pdiResponse = await proxyRequest({
            url: `${API_BASE_URL}/service-module/u/opcode/PDI/v2`,
            method: "GET",
          });
          skillId =
            normalize(
              (((pdiResponse as { data?: OpcodeRow }).data ?? pdiResponse) as OpcodeRow)?.skillId
            ) || null;
        } catch {
          // ignore
        }
      }

      if (!skillId) {
        return {
          success: false,
          error: "Failed to determine skillId for CUST opcode. Create MPVI or PDI first.",
        };
      }

      const payload = {
        inspectionType: null,
        category: "MISCELLANEOUS",
        serviceTypeIds,
        description: "CUST CONCERN",
        customerDescription: "CUST CONCERN",
        causes: [],
        storyLinesV2: [],
        defaultSubPayType: "CUSTOMER_PAY",
        defaultPayType: "CUSTOMER_PAY",
        eligibleForCPSpecialLaborPricing: true,
        customerPartPricingEnabled: true,
        partsPricingCapEnabled: false,
        partsSalePricingType: "MAX_PARTS_PRICE",
        eligibleForPartPreparation: true,
        forcedPartSelectionEnabled: false,
        canOverrideWarrantyCostCenter: true,
        canOverrideInternalCostCenter: true,
        clockInMandatory: false,
        laborTimeInSeconds: "",
        customerLaborTimeInSeconds: "",
        manufacturerLaborTimeInSeconds: "",
        accountingGroup: null,
        laborRateConfigInfo: {
          deleted: [],
          updated: [],
          added: [],
        },
        linkedOpcodesV2: [],
        suggestedOpcodes: [],
        fees: [],
        parts: [],
        labels: [],
        oemOpcodes: [],
        subletOpCode: false,
        autoDispatch: true,
        autoComplete: false,
        subletMarkUpDetails: [],
        skillId,
        priority: 100,
        opcodeSource: "DEALER_DEFINED",
        eligibility: {
          criteria: [
            {
              operator: "IN",
              field: "SERVICE_FLOW",
              values: [
                "QUOTE",
                "BDC_SCHEDULING",
                "WEB_CHECK_IN",
                "MOBILE_CHECK_IN",
                "RO_JOB",
                "RO_RECOMMENDATION",
                "MPVI_RECOMMENDATION",
                "QUICK_RO",
              ],
            },
          ],
        },
        systemOpcode: "",
        opcode: "CUST",
        opcodeType: "INDIVIDUAL_SERVICE",
        displayValue: "CONCERN",
        status: "ACTIVE",
      };

      const createResponse = await proxyRequest({
        url: `${API_BASE_URL}/service-module/u/opcode/v2/create`,
        method: "POST",
        body: payload,
      });

      const createdRoot = (createResponse as { data?: { id?: string }; id?: string }) ?? {};

      return {
        success: true,
        action: "Created successfully",
        opcodeId: normalize(createdRoot.data?.id || createdRoot.id) || "CUST",
      };
    } catch (e: unknown) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "Failed to create CUST CONCERN",
      };
    }
  }, [fetchServiceTypes, proxyRequest]);

  const performCustConfiguration = useCallback(async (): Promise<ValidationResult> => {
    try {
      const searchPayload = {
        pageInfo: { start: 0, rows: 50 },
        searchText: "cust",
        sort: [{ order: "DESC", field: "createdTime" }],
        filters: [],
        nextPageToken: null,
        searchFields: ["OPCODE", "DESCRIPTION", "CONSUMER_SCHEDULING_NAME"],
      };

      const searchResponse = await proxyRequest({
        url: `${API_BASE_URL}/service-module/u/opcode/search`,
        method: "POST",
        body: searchPayload,
      });

      const rows = unwrapOpcodeSearchRows(searchResponse)
        .map(unwrapFirstOpcodeHit)
        .filter(Boolean) as OpcodeRow[];

      const existing = rows.find((op) => {
        const opcode = normalizeUpper(op.opcode || op.code || op.displayValue);
        const desc = normalizeUpper(op.description || op.customerDescription);
        return opcode === "CUST" || desc.includes("CUST CONCERN");
      });

      if (existing) {
        return {
          success: true,
          action: "Already exists (found via search)",
          validated: true,
          opcodeId: normalize(existing.id || existing.opcode || "CUST"),
        };
      }

      return await createCustConcernOpcode();
    } catch (e: unknown) {
      return {
        success: false,
        error: e instanceof Error ? e.message : "CUST configuration failed",
      };
    }
  }, [createCustConcernOpcode, proxyRequest]);

  const runGetAllOpcodes = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      const searchPayload = {
        pageInfo: { start: 0, rows: 100 },
        searchText: "",
        sort: [{ order: "DESC", field: "createdTime" }],
        filters: [],
        nextPageToken: null,
        searchFields: ["OPCODE", "DESCRIPTION", "CONSUMER_SCHEDULING_NAME"],
      };

      const payload = await proxyRequest({
        url: `${API_BASE_URL}/service-module/u/opcode/search`,
        method: "POST",
        body: searchPayload,
      });

      const rows =
        (payload as { data?: { hits?: OpcodeRow[] } })?.data?.hits ?? unwrapOpcodeSearchRows(payload);

      setRawGetResponse(payload);
      setGetRows(Array.isArray(rows) ? rows : []);
      setMessage({
        ok: true,
        text: `Fetched ${Array.isArray(rows) ? rows.length : 0} opcode record(s) successfully.`,
      });
    } catch (e: unknown) {
      setGetRows([]);
      setRawGetResponse(null);
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Failed to fetch opcodes",
      });
    } finally {
      setLoading(false);
    }
  }, [proxyRequest]);

  const runServiceTypesSetup = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setValidationResult(null);

    try {
      const result = await performServiceTypeSetup();

      if (!result.success) {
        setMessage({
          ok: false,
          text: result.error || "Service type setup failed",
        });
        return;
      }

      await fetchServiceTypes();
      setServiceTypesPreviewVisible(true);
      setMessage({
        ok: true,
        text: `Service Types setup complete. Created: ${result.created?.length ?? 0}, Configured: ${result.configured ?? 0}, Skipped: ${result.skipped ?? 0}.`,
      });
    } finally {
      setLoading(false);
    }
  }, [fetchServiceTypes, performServiceTypeSetup]);

  const runQuickSetup = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setValidationResult(null);

    try {
      const stResult = await performServiceTypeSetup();

      if (!stResult.success) {
        setMessage({
          ok: false,
          text: stResult.error || "Service Type setup failed. MPVI configuration skipped.",
        });
        return;
      }

      const mpviResult = await performMPVIConfiguration(stResult);
      setValidationResult(mpviResult);

      await fetchServiceTypes();
      setServiceTypesPreviewVisible(true);

      if (!mpviResult.success) {
        setMessage({
          ok: false,
          text: `Service Types success, MPVI failed: ${mpviResult.error}`,
        });
        return;
      }

      setMessage({
        ok: true,
        text: `Quick Setup complete. Service Types configured and MPVI result: ${mpviResult.action}.`,
      });
    } finally {
      setLoading(false);
    }
  }, [fetchServiceTypes, performMPVIConfiguration, performServiceTypeSetup]);

  const runAutoConfigureIndividual = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setValidationResult(null);

    try {
      const sublet = await performSubletConfiguration();
      const pdi = await performPDIConfiguration();
      const cust = await createCustConcernOpcode();

      const okCount = [sublet, pdi, cust].filter((x) => x.success).length;

      setValidationResult({
        success: okCount === 3,
        action: `SUBLET: ${sublet.action || sublet.error || "-"} | PDI: ${pdi.action || pdi.error || "-"} | CUST: ${cust.action || cust.error || "-"}`,
      });

      setMessage({
        ok: okCount === 3,
        text: `Individual opcode configuration completed. Success: ${okCount}/3.`,
      });
    } finally {
      setLoading(false);
    }
  }, [createCustConcernOpcode, performPDIConfiguration, performSubletConfiguration]);

  const runSingleValidation = useCallback(
    async (key: "mpvi" | "sublet" | "pdi" | "cust") => {
      setLoading(true);
      setMessage(null);
      setValidationResult(null);

      try {
        let result: ValidationResult;

        if (key === "mpvi") {
          result = await performMPVIConfiguration(null);
        } else if (key === "sublet") {
          result = await performSubletConfiguration();
        } else if (key === "pdi") {
          result = await performPDIConfiguration();
        } else {
          result = await performCustConfiguration();
        }

        setValidationResult(result);
        setMessage({
          ok: result.success,
          text: result.success
            ? `${key.toUpperCase()} — ${result.action}`
            : `${key.toUpperCase()} — ${result.error}`,
        });
      } finally {
        setLoading(false);
      }
    },
    [
      performCustConfiguration,
      performMPVIConfiguration,
      performPDIConfiguration,
      performSubletConfiguration,
    ]
  );

  const runCreateCustomServiceType = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      const typeName = normalize(customServiceTypeName);
      if (!typeName) {
        setMessage({ ok: false, text: "Please enter a Service Type name." });
        return;
      }

      const existingRows = await fetchServiceTypes();
      const alreadyExists = existingRows.find(
        (st) => normalizeUpper(st.name) === normalizeUpper(typeName)
      );

      if (alreadyExists) {
        setMessage({
          ok: false,
          text: `Service type "${typeName}" already exists${alreadyExists.id ? ` (id: ${alreadyExists.id})` : ""}.`,
        });
        return;
      }

      const laborRates = await fetchLaborRates();
      const rateMap = matchLaborRates(laborRates);

      if (!rateMap.CUSTOMER_PAY || !rateMap.INTERNAL || !rateMap.WARRANTY) {
        setMessage({
          ok: false,
          text: "Missing CP/IP/WP labor rates. Please configure Labor Pricing first.",
        });
        return;
      }

      await createServiceType(typeName, rateMap);
      await fetchServiceTypes();
      setServiceTypesPreviewVisible(true);
      setMessage({
        ok: true,
        text: `Custom service type "${typeName}" created successfully.`,
      });
      setCustomServiceTypeName("");
    } finally {
      setLoading(false);
    }
  }, [createServiceType, customServiceTypeName, fetchLaborRates, fetchServiceTypes]);

  const serviceTypeStats = useMemo(() => {
    const total = serviceTypes.length;
    const linked = serviceTypes.filter(
      (x) => Array.isArray(x.laborRateConfigs) && x.laborRateConfigs.length > 0
    ).length;
    const unlinked = total - linked;
    return { total, linked, unlinked };
  }, [serviceTypes]);

  const switchView = (view: ViewKey) => {
    resetTransientStateForView(view);
    setActiveView(view);
  };

  return (
    <div
      style={{
        display: "grid",
        gap: 16,
        maxHeight: "100%",
        overflow: "auto",
      }}
      className="opcode-management-scroll"
    >
      <style>{`
        .opcode-management-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .opcode-management-scroll::-webkit-scrollbar-track { background: transparent; }
        .opcode-management-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 8px; }
        .opcode-management-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.24); }
      `}</style>

      <div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc", marginBottom: 6 }}>
          🧩 Opcode Management
        </div>
        <div style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.6 }}>
          Manage Service Types, MPVI, SUBLET, PDI, CUST CONCERN, and opcode validation flows using Global Headers.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span style={badgeStyle}>
          Dealer ID: <b style={{ color: dealerId ? "#86efac" : "#fca5a5" }}>{dealerId || "Not found"}</b>
        </span>
        <span style={badgeStyle}>
          Global Headers: <b style={{ color: "#f8fafc" }}>{headerCount}</b>
        </span>
        <span style={badgeStyle}>
          API Base: <b style={{ color: "#f8fafc" }}>/service-module/u/opcode</b>
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
              Actions
            </div>
            <div style={{ color: "#94a3b8", fontSize: 13 }}>
              Primary setup and validation entry points.
            </div>
          </div>

          <button className="btn-secondary btn-sm" onClick={refreshHeaders}>
            ⟳ Refresh Headers
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className={activeView === "home" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => switchView("home")}
          >
            Home
          </button>
          <button
            className={activeView === "get" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => switchView("get")}
          >
            📥 Get Opcodes
          </button>
          <button
            className={activeView === "post" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => switchView("post")}
          >
            ⚙ Post / Configure
          </button>
          <button
            className={activeView === "service-types" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => switchView("service-types")}
          >
            Service Types
          </button>
          <button
            className={activeView === "custom-service-type" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => switchView("custom-service-type")}
          >
            Custom Service Type
          </button>
          <button
            className={activeView === "mpvi" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => switchView("mpvi")}
          >
            MPVI
          </button>
          <button
            className={activeView === "sublet" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => switchView("sublet")}
          >
            SUBLET
          </button>
          <button
            className={activeView === "pdi" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => switchView("pdi")}
          >
            PDI
          </button>
          <button
            className={activeView === "cust" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => switchView("cust")}
          >
            CUST
          </button>
        </div>
      </div>

      {message ? <div style={getStatusTone(message.ok)}>{message.text}</div> : null}

      {validationResult ? (
        <div style={cardStyle}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 8,
            }}
          >
            <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800 }}>
              Latest Validation Result
            </div>
            {getSmallResultPill(validationResult.success, validationResult.success ? "SUCCESS" : "FAILED")}
          </div>
          <div style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.7 }}>
            {validationResult.action || validationResult.error || "—"}
          </div>
        </div>
      ) : null}

      {activeView === "home" ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
              Quick Actions
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
              <button
                className="btn-primary"
                onClick={() => void runQuickSetup()}
                disabled={loading || headerCount === 0}
                style={{ minHeight: 64 }}
              >
                {loading ? "Running..." : "🚀 Complete Setup: Service Types + MPVI"}
              </button>

              <button
                className="btn-secondary btn-sm"
                onClick={() => {
                  switchView("custom-service-type");
                  setServiceTypesPreviewVisible(true);
                }}
                style={{ minHeight: 64 }}
              >
                ➕ Create Custom Service Type
              </button>

              <button
                className="btn-secondary btn-sm"
                onClick={() => void runAutoConfigureIndividual()}
                disabled={loading || headerCount === 0}
                style={{ minHeight: 64 }}
              >
                ⚡ Auto Configure All (Sublet, PDI, Cust Concern)
              </button>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
              Manual Validation & Fix
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-secondary btn-sm" onClick={() => void runSingleValidation("mpvi")} disabled={loading}>
                Validate MPVI
              </button>
              <button className="btn-secondary btn-sm" onClick={() => void runSingleValidation("sublet")} disabled={loading}>
                Validate SUBLET
              </button>
              <button className="btn-secondary btn-sm" onClick={() => void runSingleValidation("pdi")} disabled={loading}>
                Validate PDI
              </button>
              <button className="btn-secondary btn-sm" onClick={() => void runSingleValidation("cust")} disabled={loading}>
                Validate CUST CONCERN
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
                  Fetch Opcodes
                </div>
                <div style={{ color: "#94a3b8", fontSize: 13 }}>
                  Retrieve service opcodes through the search endpoint.
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn-primary"
                  onClick={() => void runGetAllOpcodes()}
                  disabled={loading || headerCount === 0}
                >
                  {loading ? "Fetching..." : "🚀 Execute GET"}
                </button>

                {rawGetResponse ? (
                  <button
                    className="btn-secondary btn-sm"
                    onClick={() => setShowRawGet((v) => !v)}
                  >
                    {showRawGet ? "Hide Raw JSON" : "Show Raw JSON"}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
              Opcodes ({getRows.length})
            </div>

            <div className="opcode-management-scroll" style={tableScrollWrapStyle(520)}>
              <table className="bx-table" style={tableElementStyle}>
                <thead>
                  <tr>
                    <th style={stickyThStyle}>#</th>
                    <th style={stickyThStyle}>Opcode</th>
                    <th style={stickyThStyle}>Description</th>
                    <th style={stickyThStyle}>Opcode Type</th>
                    <th style={stickyThStyle}>Category</th>
                    <th style={stickyThStyle}>ID</th>
                  </tr>
                </thead>
                <tbody>
                  {getRows.length > 0 ? (
                    getRows.map((row, index) => (
                      <tr key={`${row.id || row.opcode || "opcode"}-${index}`} style={zebraRowStyle(index)}>
                        <td style={tdStyle}>{index + 1}</td>
                        <td style={tdStyle}>
                          <div style={{ color: "#f8fafc", fontWeight: 800 }}>
                            {row.opcode || row.code || row.displayValue || "—"}
                          </div>
                        </td>
                        <td style={tdStyle}>{row.description || row.customerDescription || "—"}</td>
                        <td style={tdStyle}>{row.opcodeType || "—"}</td>
                        <td style={tdStyle}>{row.category || "—"}</td>
                        <td style={tdStyle}>
                          <code style={monoStyle}>{row.id || "—"}</code>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td style={tdStyle} colSpan={6}>
                        <div style={{ color: "#94a3b8" }}>No opcode rows loaded yet.</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {showRawGet && rawGetResponse ? (
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
                  {JSON.stringify(rawGetResponse, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {activeView === "post" ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
              Opcode Configuration
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
              <button
                className="btn-primary"
                onClick={() => void runQuickSetup()}
                disabled={loading || headerCount === 0}
                style={{ minHeight: 72 }}
              >
                {loading ? "Running..." : "🚀 Complete Setup: Service Types + MPVI"}
              </button>

              <button
                className="btn-secondary btn-sm"
                onClick={() => switchView("custom-service-type")}
                style={{ minHeight: 72 }}
              >
                ➕ Create Custom Service Type
              </button>

              <button
                className="btn-secondary btn-sm"
                onClick={() => void runAutoConfigureIndividual()}
                disabled={loading || headerCount === 0}
                style={{ minHeight: 72 }}
              >
                ⚡ Auto Configure All (Sublet, PDI, Cust Concern)
              </button>
            </div>
          </div>

          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
              Manual Validation & Fix
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn-secondary btn-sm" onClick={() => void runSingleValidation("mpvi")} disabled={loading}>
                Validate MPVI
              </button>
              <button className="btn-secondary btn-sm" onClick={() => void runSingleValidation("sublet")} disabled={loading}>
                Validate SUBLET
              </button>
              <button className="btn-secondary btn-sm" onClick={() => void runSingleValidation("pdi")} disabled={loading}>
                Validate PDI
              </button>
              <button className="btn-secondary btn-sm" onClick={() => void runSingleValidation("cust")} disabled={loading}>
                Validate CUST CONCERN
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeView === "service-types" ? (
        <div style={{ display: "grid", gap: 16 }}>
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
              <div>
                <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
                  Service Types Setup
                </div>
                <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>
                  Creates missing PDI / Sublet service types and configures labor rates.
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn-primary"
                  onClick={() => void runServiceTypesSetup()}
                  disabled={loading || headerCount === 0}
                >
                  {loading ? "Running..." : "Run Service Type Setup"}
                </button>
                <button
                  className="btn-secondary btn-sm"
                  onClick={async () => {
                    setLoading(true);
                    try {
                      await fetchServiceTypes();
                      setServiceTypesPreviewVisible(true);
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  Refresh Preview
                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span style={badgeStyle}>Total: <b style={{ color: "#f8fafc" }}>{serviceTypeStats.total}</b></span>
              <span style={badgeStyle}>Linked: <b style={{ color: "#86efac" }}>{serviceTypeStats.linked}</b></span>
              <span style={badgeStyle}>Not linked: <b style={{ color: "#fcd34d" }}>{serviceTypeStats.unlinked}</b></span>
            </div>
          </div>

          {serviceTypesPreviewVisible ? (
            <div style={cardStyle}>
              <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
                Existing Service Types
              </div>

              <div className="opcode-management-scroll" style={tableScrollWrapStyle(420)}>
                <table className="bx-table" style={tableElementStyle}>
                  <thead>
                    <tr>
                      <th style={stickyThStyle}>Name</th>
                      <th style={stickyThStyle}>Key</th>
                      <th style={stickyThStyle}>Status</th>
                      <th style={stickyThStyle}>Labor Rates</th>
                      <th style={stickyThStyle}>ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serviceTypes.length > 0 ? (
                      serviceTypes.map((row, index) => (
                        <tr key={`${row.id || row.name || "st"}-${index}`} style={zebraRowStyle(index)}>
                          <td style={tdStyle}>
                            <div style={{ color: "#f8fafc", fontWeight: 700 }}>{row.name || "—"}</div>
                          </td>
                          <td style={tdStyle}>{row.key || "—"}</td>
                          <td style={tdStyle}>{row.status || "—"}</td>
                          <td style={tdStyle}>
                            {Array.isArray(row.laborRateConfigs) && row.laborRateConfigs.length > 0
                              ? getSmallResultPill(true, "Linked")
                              : getSmallResultPill(false, "Not linked")}
                          </td>
                          <td style={tdStyle}>
                            <code style={monoStyle}>{row.id || "—"}</code>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td style={tdStyle} colSpan={5}>
                          <div style={{ color: "#94a3b8" }}>No service types loaded.</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {activeView === "custom-service-type" ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={cardStyle}>
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
              Create Custom Service Type
            </div>

            <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
              Creates a custom Service Type and links CP / IP / WP labor rates dynamically.
            </div>

            <div style={{ display: "grid", gap: 12, maxWidth: 520 }}>
              <div>
                <label style={{ display: "block", color: "#cbd5e1", fontSize: 13, marginBottom: 6 }}>
                  Service Type Name
                </label>
                <input
                  value={customServiceTypeName}
                  onChange={(e) => setCustomServiceTypeName(e.target.value)}
                  placeholder="e.g. Maintenance Service"
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

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn-primary"
                  onClick={() => void runCreateCustomServiceType()}
                  disabled={loading || headerCount === 0}
                >
                  {loading ? "Creating..." : "Create Service Type"}
                </button>
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => setCustomServiceTypeName("")}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeView === "mpvi" ? (
        <div style={cardStyle}>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
            MPVI Validation
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-primary" onClick={() => void runSingleValidation("mpvi")} disabled={loading || headerCount === 0}>
              {loading ? "Validating..." : "Validate / Fix MPVI"}
            </button>
          </div>
        </div>
      ) : null}

      {activeView === "sublet" ? (
        <div style={cardStyle}>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
            SUBLET Validation
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-primary" onClick={() => void runSingleValidation("sublet")} disabled={loading || headerCount === 0}>
              {loading ? "Validating..." : "Validate / Fix SUBLET"}
            </button>
          </div>
        </div>
      ) : null}

      {activeView === "pdi" ? (
        <div style={cardStyle}>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
            PDI Validation
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-primary" onClick={() => void runSingleValidation("pdi")} disabled={loading || headerCount === 0}>
              {loading ? "Validating..." : "Validate / Fix PDI"}
            </button>
          </div>
        </div>
      ) : null}

      {activeView === "cust" ? (
        <div style={cardStyle}>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
            CUST CONCERN Validation
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-primary" onClick={() => void runSingleValidation("cust")} disabled={loading || headerCount === 0}>
              {loading ? "Validating..." : "Validate / Create CUST CONCERN"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default OpcodeManagementView;
