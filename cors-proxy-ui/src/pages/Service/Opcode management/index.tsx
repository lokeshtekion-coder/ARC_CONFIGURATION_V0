import React, { useCallback, useEffect, useMemo, useState } from "react";
import { loadTekionCapturedProfiles } from "../../../services/tekionCapturedProfiles";
import { loadTekionApiSettingsBundle } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";
import "./OpcodeManagementView.css";

const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";
const PROXY_ENDPOINT = "http://localhost:4000/api/proxy";
const DEFAULT_HOST = "https://preprodapp.tekioncloud.com";

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

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeUpper(value: unknown): string {
  return normalize(value).toUpperCase();
}

function resolveActiveHeaders(): { headers: Record<string, string>; baseHost: string; dealerId: string } {
  const storedProfileId = localStorage.getItem(SELECTED_DEALER_PROFILE_KEY);
  const profiles = loadTekionCapturedProfiles();

  const matchedProfile = storedProfileId
    ? profiles.find(
        (p) =>
          p.id === storedProfileId ||
          p.profileKey === storedProfileId ||
          p.dealerId === storedProfileId
      )
    : profiles[0] ?? null;

  let headers: Record<string, string> = {};
  let baseHost = DEFAULT_HOST;
  let dealerId = matchedProfile?.dealerId || "";

  if (matchedProfile?.bootstrapHeaders && Object.keys(matchedProfile.bootstrapHeaders).length > 0) {
    headers = { ...matchedProfile.bootstrapHeaders };
    if (matchedProfile.sourceUrl) {
      try {
        baseHost = new URL(matchedProfile.sourceUrl).origin;
      } catch {
        baseHost = DEFAULT_HOST;
      }
    }
  } else {
    const bundle = loadTekionApiSettingsBundle();
    const rows = (bundle.globalHeaders ?? []).filter(
      (h: KeyValuePair) => h.enabled && h.key?.trim() && String(h.value ?? "").trim()
    );
    for (const row of rows) {
      const lower = row.key.trim().toLowerCase();
      headers[lower] = String(row.value).trim();
      if (lower === "dealerid" && !dealerId) {
        dealerId = String(row.value).trim();
      }
    }
  }

  headers["content-type"] = "application/json";
  return { headers, baseHost, dealerId };
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

export const OpcodeManagementView: React.FC = () => {
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

  const { headers: activeHeaders, baseHost, dealerId } = useMemo(() => resolveActiveHeaders(), []);
  const headerCount = useMemo(() => Object.keys(activeHeaders).length, [activeHeaders]);

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
      const res = await fetch(PROXY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: payload.url,
          method: payload.method,
          headers: {
            ...activeHeaders,
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
    [activeHeaders]
  );

  const fetchServiceTypes = useCallback(async (): Promise<ServiceTypeRow[]> => {
    const payload = await proxyRequest({
      url: `${baseHost}/api/service-module/u/opcode/serviceTypes`,
      method: "GET",
    });

    const rows = Array.isArray((payload as { data?: unknown[] })?.data)
      ? ((payload as { data: unknown[] }).data as ServiceTypeRow[])
      : Array.isArray(payload)
      ? (payload as ServiceTypeRow[])
      : [];

    setServiceTypes(rows);
    return rows;
  }, [baseHost, proxyRequest]);

  const fetchLaborRates = useCallback(async (): Promise<LaborRateRow[]> => {
    const payload = await proxyRequest({
      url: `${baseHost}/api/service-module/u/labor-pricing/laborRate`,
      method: "GET",
    });

    const rows = Array.isArray((payload as { data?: unknown[] })?.data)
      ? ((payload as { data: unknown[] }).data as LaborRateRow[])
      : Array.isArray(payload)
      ? (payload as LaborRateRow[])
      : [];

    return rows;
  }, [baseHost, proxyRequest]);

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
        url: `${baseHost}/api/service-module/u/opcode/serviceType/create`,
        method: "POST",
        body: payload,
      });
    },
    [baseHost, proxyRequest]
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
        url: `${baseHost}/api/service-module/u/opcode/serviceType/${id}/update`,
        method: "PUT",
        body: payload,
      });
    },
    [baseHost, proxyRequest]
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
        skipped: Math.max(0, currentServiceTypes.length - needsConfig.length),
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
          url: `${baseHost}/api/service-module/u/opcode/search`,
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
          url: `${baseHost}/api/service-module/u/opcode/${opcodeIdentifier}/v2`,
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
          url: `${baseHost}/api/service-module/u/opcode/v2/${opcode.id}`,
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
    [baseHost, proxyRequest]
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
        url: `${baseHost}/api/service-module/u/opcode/SUBLET/v2`,
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
        url: `${baseHost}/api/service-module/u/opcode/v2/${opcode.id}`,
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
  }, [baseHost, fetchServiceTypes, proxyRequest]);

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
        url: `${baseHost}/api/service-module/u/opcode/PDI/v2`,
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
        url: `${baseHost}/api/service-module/u/opcode/v2/${opcode.id}`,
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
  }, [baseHost, fetchServiceTypes, proxyRequest]);

  const createCustConcernOpcode = useCallback(async (): Promise<ValidationResult> => {
    try {
      try {
        await proxyRequest({
          url: `${baseHost}/api/service-module/u/opcode/CUST/v2`,
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
          url: `${baseHost}/api/service-module/u/opcode/MPVI/v2`,
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
            url: `${baseHost}/api/service-module/u/opcode/PDI/v2`,
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
        url: `${baseHost}/api/service-module/u/opcode/v2/create`,
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
  }, [baseHost, fetchServiceTypes, proxyRequest]);

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
        url: `${baseHost}/api/service-module/u/opcode/search`,
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
  }, [baseHost, createCustConcernOpcode, proxyRequest]);

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
        url: `${baseHost}/api/service-module/u/opcode/search`,
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
  }, [baseHost, proxyRequest]);

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
    <div className="opcode-management-scroll">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span className="op-badge">
          Dealer ID: <b style={{ color: dealerId ? "#86efac" : "#fca5a5" }}>{dealerId || "Not found"}</b>
        </span>
        <span className="op-badge">
          Active Headers: <b style={{ color: "#f8fafc" }}>{headerCount}</b>
        </span>
        <span className="op-badge">
          API Base: <b style={{ color: "#f8fafc" }}>/service-module/u/opcode</b>
        </span>
      </div>

      <div className="op-card">
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
            <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800 }}>
              Opcode Management
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className={activeView === "post" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => switchView("post")}
          >
            ⚙ Post / Configure
          </button>
          <button
            className={activeView === "get" ? "btn-primary" : "btn-secondary btn-sm"}
            onClick={() => switchView("get")}
          >
            📥 Get Opcodes
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

      {message ? (
        <div className={`op-status-box ${message.ok ? "op-status-success" : "op-status-error"}`}>
          {message.text}
        </div>
      ) : null}

      {validationResult ? (
        <div className="op-card">
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
            <span className={validationResult.success ? "op-pill-success" : "op-pill-error"}>
              {validationResult.success ? "SUCCESS" : "FAILED"}
            </span>
          </div>
          <div style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.7 }}>
            {validationResult.action || validationResult.error || "—"}
          </div>
        </div>
      ) : null}

      {activeView === "home" ? (
        <div style={{ display: "grid", gap: 16 }}>
          <div className="op-card">
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

          <div className="op-card">
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
          <div className="op-card">
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

          <div className="op-card">
            <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
              Opcodes ({getRows.length})
            </div>

            <div className="op-table-wrap" style={{ maxHeight: 520 }}>
              <table className="op-table">
                <thead>
                  <tr>
                    <th className="op-sticky-th">#</th>
                    <th className="op-sticky-th">Opcode</th>
                    <th className="op-sticky-th">Description</th>
                    <th className="op-sticky-th">Opcode Type</th>
                    <th className="op-sticky-th">Category</th>
                    <th className="op-sticky-th">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {getRows.length > 0 ? (
                    getRows.map((row, index) => (
                      <tr key={`${row.id || row.opcode || "opcode"}-${index}`} className={index % 2 === 1 ? "op-row-zebra" : ""}>
                        <td className="op-td">{index + 1}</td>
                        <td className="op-td">
                          <div style={{ color: "#f8fafc", fontWeight: 800 }}>
                            {row.opcode || row.code || row.displayValue || "—"}
                          </div>
                        </td>
                        <td className="op-td">{row.description || row.customerDescription || "—"}</td>
                        <td className="op-td">{row.opcodeType || "—"}</td>
                        <td className="op-td">{row.category || "—"}</td>
                        <td className="op-td">
                          <code className="op-mono">{row.id || "—"}</code>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="op-td" colSpan={6}>
                        <div style={{ color: "#94a3b8" }}>No opcode rows loaded yet. Click Execute GET.</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {showRawGet && rawGetResponse ? (
              <div style={{ marginTop: 14 }}>
                <pre
                  className="op-mono"
                  style={{
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
          <div className="op-card">
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

          <div className="op-card">
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
          <div className="op-card">
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
              <span className="op-badge">Total: <b style={{ color: "#f8fafc" }}>{serviceTypeStats.total}</b></span>
              <span className="op-badge">Linked: <b style={{ color: "#86efac" }}>{serviceTypeStats.linked}</b></span>
              <span className="op-badge">Not linked: <b style={{ color: "#fcd34d" }}>{serviceTypeStats.unlinked}</b></span>
            </div>
          </div>

          {serviceTypesPreviewVisible ? (
            <div className="op-card">
              <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
                Existing Service Types
              </div>

              <div className="op-table-wrap" style={{ maxHeight: 420 }}>
                <table className="op-table">
                  <thead>
                    <tr>
                      <th className="op-sticky-th">Name</th>
                      <th className="op-sticky-th">Key</th>
                      <th className="op-sticky-th">Status</th>
                      <th className="op-sticky-th">Labor Rates</th>
                      <th className="op-sticky-th">ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serviceTypes.length > 0 ? (
                      serviceTypes.map((row, index) => (
                        <tr key={`${row.id || row.name || "st"}-${index}`} className={index % 2 === 1 ? "op-row-zebra" : ""}>
                          <td className="op-td">
                            <div style={{ color: "#f8fafc", fontWeight: 700 }}>{row.name || "—"}</div>
                          </td>
                          <td className="op-td">{row.key || "—"}</td>
                          <td className="op-td">{row.status || "—"}</td>
                          <td className="op-td">
                            {Array.isArray(row.laborRateConfigs) && row.laborRateConfigs.length > 0 ? (
                              <span className="op-pill-success">Linked</span>
                            ) : (
                              <span className="op-pill-error">Not linked</span>
                            )}
                          </td>
                          <td className="op-td">
                            <code className="op-mono">{row.id || "—"}</code>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="op-td" colSpan={5}>
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
          <div className="op-card">
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
        <div className="op-card">
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
        <div className="op-card">
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
        <div className="op-card">
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
        <div className="op-card">
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
