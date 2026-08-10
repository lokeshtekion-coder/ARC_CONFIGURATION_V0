import React, { useCallback, useEffect, useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";

type SchedulingSubsectionKey =
  | "consumer-scheduling"
  | "transportation"
  | "service-advisors"
  | "shops"
  | "general";

type OperationKey = "get" | "put" | "post" | "configure";

type UiMessage = {
  ok: boolean;
  text: string;
};

type ConsumerSchedulingResponse = {
  data?: {
    allowToRemoveVehicle?: boolean;
    allowCustomerToAddVin?: boolean;
  };
  [key: string]: unknown;
};

type ShopHour = {
  day?: string;
  blocked?: boolean;
  startTime?: {
    timeInHours?: number;
    timeInMinutes?: number;
  } | null;
  endTime?: {
    timeInHours?: number;
    timeInMinutes?: number;
  } | null;
};

type ShopRecord = {
  id?: string;
  name?: string;
  status?: string;
  defaultShop?: boolean;
  description?: string;
  orderId?: number;
  departmentId?: string | null;
  serviceAdvisors?: string[];
  associationIds?: string[];
  blocks?: unknown[];
  holidays?: unknown[];
  vehicles?: unknown[];
  hours?: ShopHour[];
  [key: string]: unknown;
};

const CONSUMER_SCHEDULING_URL =
  "https://preprodapp.tekioncloud.com/api/scheduling/u/cs/settings";

const SERVICE_ADVISORS_URL =
  "https://preprodapp.tekioncloud.com/api/service/u/settings/scheduling/service-advisors";

const GENERAL_SCHEDULING_URL =
  "https://preprodapp.tekioncloud.com/api/service/u/settings/scheduling/general";

const SERVICE_SHOP_LIST_URL =
  "https://preprodapp.tekioncloud.com/api/scheduling/u/settings/serviceShop";

const USERS_BY_PERSONA_URL =
  "https://preprodapp.tekioncloud.com/api/userservice/u/v2/user/by-persona";

const SCHEDULING_AGGREGATED_SETTINGS_URL =
  "https://preprodapp.tekioncloud.com/api/service-module/u/scheduling/aggregated-settings/fetch";

const ACCOUNTING_DEPARTMENTS_URL =
  "https://preprodapp.tekioncloud.com/api/accounting/u/departments";

const ACCOUNTING_BOOTSTRAP_URL =
  "https://preprodapp.tekioncloud.com/api/accounting/u/configurable/bootstrap";

const DAY_OPTIONS = [
  { key: "sunday", label: "Sunday", code: "SUN", defaultBlocked: true },
  { key: "monday", label: "Monday", code: "MON", defaultBlocked: false },
  { key: "tuesday", label: "Tuesday", code: "TUE", defaultBlocked: false },
  { key: "wednesday", label: "Wednesday", code: "WED", defaultBlocked: false },
  { key: "thursday", label: "Thursday", code: "THU", defaultBlocked: false },
  { key: "friday", label: "Friday", code: "FRI", defaultBlocked: false },
  { key: "saturday", label: "Saturday", code: "SAT", defaultBlocked: false },
] as const;

type DayKey = (typeof DAY_OPTIONS)[number]["key"];

type DayState = Record<
  DayKey,
  {
    start: string;
    end: string;
    blocked: boolean;
  }
>;

type TransportationSummaryRow = {
  id?: string;
  displayName?: string;
  transportationType?: string;
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
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

function extractDealerIdFromHeaders(headers: Record<string, string>): string {
  const candidates = ["dealerid", "dealerId", "dealer-id", "x-dealer-id"];
  const entries = Object.entries(headers);

  for (const candidate of candidates) {
    const hit = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
    if (hit?.[1]) return normalize(hit[1]);
  }

  return "";
}

function buildDefaultDayState(): DayState {
  return DAY_OPTIONS.reduce((acc, day) => {
    acc[day.key] = {
      start: "09:00",
      end: "17:00",
      blocked: day.defaultBlocked,
    };
    return acc;
  }, {} as DayState);
}

function buildScheduleFromDayState(days: DayState): Array<{
  day: string;
  startTime: { timeInHours: number; timeInMinutes: number } | null;
  endTime: { timeInHours: number; timeInMinutes: number } | null;
  blocked: boolean;
}> {
  return DAY_OPTIONS.map((day) => {
    const row = days[day.key];

    if (row.blocked || !row.start || !row.end) {
      return {
        day: day.code,
        startTime: null,
        endTime: null,
        blocked: true,
      };
    }

    const [startHour, startMinute] = row.start.split(":").map(Number);
    const [endHour, endMinute] = row.end.split(":").map(Number);

    return {
      day: day.code,
      startTime: {
        timeInHours: startHour,
        timeInMinutes: startMinute,
      },
      endTime: {
        timeInHours: endHour,
        timeInMinutes: endMinute,
      },
      blocked: false,
    };
  });
}

function formatTime(
  timeObj?: { timeInHours?: number; timeInMinutes?: number } | null
): string {
  if (!timeObj || timeObj.timeInHours === undefined) return "N/A";
  const hours = timeObj.timeInHours;
  const minutes = timeObj.timeInMinutes ?? 0;
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;
}

function renderStatusBadge(ok: boolean, text: string): React.ReactNode {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 700,
        border: ok
          ? "1px solid rgba(34,197,94,0.28)"
          : "1px solid rgba(239,68,68,0.28)",
        background: ok
          ? "rgba(34,197,94,0.10)"
          : "rgba(239,68,68,0.10)",
        color: ok ? "#86efac" : "#fca5a5",
      }}
    >
      {text}
    </span>
  );
}

const SchedulingSettingsView: React.FC = () => {
  const [subsection, setSubsection] =
    useState<SchedulingSubsectionKey>("consumer-scheduling");
  const [operation, setOperation] = useState<OperationKey | "">("");

  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);

  const [consumerSettings, setConsumerSettings] =
    useState<ConsumerSchedulingResponse | null>(null);
  const [consumerPutForm, setConsumerPutForm] = useState({
    allowToRemoveVehicle: true,
    allowCustomerToAddVin: true,
  });

  const [serviceAdvisorsRaw, setServiceAdvisorsRaw] = useState<unknown>(null);
  const [generalRaw, setGeneralRaw] = useState<unknown>(null);
  const [shops, setShops] = useState<ShopRecord[]>([]);
  const [transportationRows, setTransportationRows] = useState<TransportationSummaryRow[]>([]);
  const [transportationResult, setTransportationResult] = useState<unknown>(null);

  const [advisorSchedule, setAdvisorSchedule] = useState<DayState>(buildDefaultDayState());
  const [shopSchedule, setShopSchedule] = useState<DayState>(buildDefaultDayState());

  const enabledHeaders = useMemo(
    () => toEnabledHeaderMap(loadGlobalHeaders()),
    []
  );

  const dealerId = useMemo(
    () => extractDealerIdFromHeaders(enabledHeaders),
    [enabledHeaders]
  );

  const subsectionMeta = useMemo(() => {
    const map: Record<
      SchedulingSubsectionKey,
      { title: string; description: string; ops: OperationKey[] }
    > = {
      "consumer-scheduling": {
        title: "Consumer Scheduling",
        description: "Fetch and update consumer scheduling permissions.",
        ops: ["get", "put"],
      },
      transportation: {
        title: "Transportation",
        description: "Fetch transportation types and auto-configure them.",
        ops: ["get", "configure"],
      },
      "service-advisors": {
        title: "Service Advisors",
        description: "Fetch service advisors settings and configure advisor schedules.",
        ops: ["get", "post"],
      },
      shops: {
        title: "Shops",
        description: "View shops and configure Main Shop schedule.",
        ops: ["get", "configure"],
      },
      general: {
        title: "General",
        description: "Fetch and create general scheduling settings.",
        ops: ["get", "post"],
      },
    };

    return map[subsection];
  }, [subsection]);

  useEffect(() => {
    setOperation("");
    setMessage(null);
  }, [subsection]);

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
            ...enabledHeaders,
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
    [enabledHeaders]
  );

  const fetchConsumerScheduling = useCallback(async () => {
    const payload = (await proxyRequest({
      url: CONSUMER_SCHEDULING_URL,
      method: "GET",
    })) as ConsumerSchedulingResponse;

    setConsumerSettings(payload);
    setConsumerPutForm({
      allowToRemoveVehicle: Boolean(payload?.data?.allowToRemoveVehicle),
      allowCustomerToAddVin: Boolean(payload?.data?.allowCustomerToAddVin),
    });
  }, [proxyRequest]);

  const putConsumerScheduling = useCallback(async () => {
    const payload = {
      allowToRemoveVehicle: consumerPutForm.allowToRemoveVehicle,
      allowCustomerToAddVin: consumerPutForm.allowCustomerToAddVin,
    };

    await proxyRequest({
      url: CONSUMER_SCHEDULING_URL,
      method: "PUT",
      body: payload,
    });

    await fetchConsumerScheduling();
    setMessage({
      ok: true,
      text: "Consumer Scheduling settings updated successfully.",
    });
  }, [consumerPutForm, fetchConsumerScheduling, proxyRequest]);

  const fetchServiceAdvisors = useCallback(async () => {
    const payload = await proxyRequest({
      url: SERVICE_ADVISORS_URL,
      method: "GET",
    });
    setServiceAdvisorsRaw(payload);
  }, [proxyRequest]);

  const autoConfigureServiceAdvisors = useCallback(async () => {
    const userFetchPayload = {
      tekSearchAndAggregationRequest: {
        pageInfo: { start: 0, rows: 100 },
        searchText: "",
        sort: [
          { field: "displayName", order: "ASC" },
          { field: "fname", order: "ASC" },
          { field: "lname", order: "ASC" },
        ],
        filters: [
          { field: "isActive", operator: "IN", values: [true], key: "isActive" },
          { field: "type", operator: "IN", values: [2], key: "type" },
          { field: "id", operator: "NIN", values: ["241"], key: "id" },
        ],
      },
      personas: ["ServiceAdvisor"],
    };

    const response = await proxyRequest({
      url: USERS_BY_PERSONA_URL,
      method: "POST",
      body: userFetchPayload,
    });

    const advisors = Array.isArray(response)
      ? response
      : Array.isArray((response as any)?.data)
      ? (response as any).data
      : Array.isArray((response as any)?.results)
      ? (response as any).results
      : [];

    const advisorIds = advisors.map((x: any) => normalize(x?.id)).filter(Boolean);

    if (advisorIds.length === 0) {
      throw new Error("No active Service Advisors found.");
    }

    const schedule = buildScheduleFromDayState(advisorSchedule);

    for (const advisorId of advisorIds) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const endDate = new Date();
      endDate.setFullYear(endDate.getFullYear() + 2);
      endDate.setHours(23, 59, 59, 999);

      const payload = {
        advisorUserId: advisorId,
        blocks: [],
        addedScheduleHours: [
          {
            scheduleName: "Default Schedule",
            hours: schedule,
            recurrenceValueInWeeks: 1,
            startDate: tomorrow.getTime(),
            endDate: endDate.getTime(),
            id:
              typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : `row-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            orderId: 1,
          },
        ],
      };

      await proxyRequest({
        url: "https://preprodapp.tekioncloud.com/api/scheduling/u/settings/serviceAdvisor",
        method: "POST",
        body: payload,
      });
    }

    setMessage({
      ok: true,
      text: `Configured ${advisorIds.length} service advisor(s) successfully.`,
    });
  }, [advisorSchedule, proxyRequest]);

  const fetchGeneralSettings = useCallback(async () => {
    const payload = await proxyRequest({
      url: GENERAL_SCHEDULING_URL,
      method: "GET",
    });
    setGeneralRaw(payload);
  }, [proxyRequest]);

  const postGeneralSettings = useCallback(async () => {
    setMessage({
      ok: true,
      text: "General POST placeholder only. API create logic can be added separately.",
    });
  }, []);

  const fetchShops = useCallback(async () => {
    const payload = await proxyRequest({
      url: SERVICE_SHOP_LIST_URL,
      method: "GET",
    });

    const rows = Array.isArray((payload as any)?.data)
      ? (payload as any).data
      : Array.isArray(payload)
      ? payload
      : [];

    const detailed: ShopRecord[] = [];

    for (const row of rows) {
      const shopId = normalize((row as any)?.id);
      if (!shopId) continue;

      try {
        const detailPayload = await proxyRequest({
          url: `${SERVICE_SHOP_LIST_URL}/${shopId}`,
          method: "GET",
        });

        detailed.push(((detailPayload as any)?.data ?? row) as ShopRecord);
      } catch {
        detailed.push(row as ShopRecord);
      }
    }

    setShops(detailed);
  }, [proxyRequest]);

  const fetchDepartmentId = useCallback(async (): Promise<string> => {
    try {
      const deptPayload = await proxyRequest({
        url: ACCOUNTING_DEPARTMENTS_URL,
        method: "GET",
      });

      const rows = Array.isArray((deptPayload as any)?.data)
        ? (deptPayload as any).data
        : Array.isArray((deptPayload as any)?.results)
        ? (deptPayload as any).results
        : [];

      const firstId =
        normalize(rows?.[0]?.id) || normalize(rows?.[0]?.departmentId);

      if (firstId) return firstId;
    } catch {
      // fallback below
    }

    const bootstrapPayload = {
      requestInfo: [
        {
          assetType: "customField",
          dealerMetaDataInfo: [{ dealerId }],
        },
      ],
    };

    const bootstrap = await proxyRequest({
      url: ACCOUNTING_BOOTSTRAP_URL,
      method: "POST",
      body: bootstrapPayload,
    });

    const customField = (bootstrap as any)?.data?.customField ?? (bootstrap as any)?.customField;
    const accessibleAssetMap = customField?.accessibleAssetMap ?? {};
    const masterAssetDocMap = customField?.masterAssetDocMap ?? {};
    const customFieldKeys = accessibleAssetMap?.[dealerId] ?? [];

    for (const key of customFieldKeys) {
      const masterDoc = masterAssetDocMap?.[key];
      if (!masterDoc) continue;

      if (masterDoc?.key === "DEPARTMENT" || masterDoc?.name === "DEPARTMENT") {
        const options = Array.isArray(masterDoc?.options) ? masterDoc.options : [];

        for (const option of options) {
          if (option?.extras?.department_type === "SERVICE" && normalize(option?.id)) {
            return normalize(option.id);
          }
        }

        for (const option of options) {
          if (normalize(option?.name).toLowerCase().includes("service") && normalize(option?.id)) {
            return normalize(option.id);
          }
        }

        if (normalize(options?.[0]?.id)) {
          return normalize(options[0].id);
        }
      }
    }

    throw new Error("Could not find department ID. Please create a Service department first.");
  }, [dealerId, proxyRequest]);

  const fetchServiceAdvisorIds = useCallback(async (): Promise<string[]> => {
    const userFetchPayload = {
      tekSearchAndAggregationRequest: {
        pageInfo: { start: 0, rows: 100 },
        searchText: "",
        sort: [
          { field: "displayName", order: "ASC" },
          { field: "fname", order: "ASC" },
          { field: "lname", order: "ASC" },
        ],
        filters: [
          { field: "isActive", operator: "IN", values: [true], key: "isActive" },
          { field: "type", operator: "IN", values: [2], key: "type" },
          { field: "id", operator: "NIN", values: ["241"], key: "id" },
        ],
      },
      personas: ["ServiceAdvisor"],
    };

    const response = await proxyRequest({
      url: USERS_BY_PERSONA_URL,
      method: "POST",
      body: userFetchPayload,
    });

    const rows = Array.isArray(response)
      ? response
      : Array.isArray((response as any)?.data)
      ? (response as any).data
      : Array.isArray((response as any)?.results)
      ? (response as any).results
      : [];

    return rows.map((x: any) => normalize(x?.id)).filter(Boolean);
  }, [proxyRequest]);

  const configureMainShop = useCallback(async () => {
    await fetchShops();

    const listPayload = await proxyRequest({
      url: SERVICE_SHOP_LIST_URL,
      method: "GET",
    });

    const rows = Array.isArray((listPayload as any)?.data)
      ? (listPayload as any).data
      : Array.isArray(listPayload)
      ? listPayload
      : [];

    const mainShop =
      rows.find((x: any) => x?.name === "Main Shop" || x?.defaultShop === true) ?? null;

    if (!mainShop?.id) {
      throw new Error("Main Shop not found.");
    }

    const shopDetailsPayload = await proxyRequest({
      url: `${SERVICE_SHOP_LIST_URL}/${mainShop.id}`,
      method: "GET",
    });

    const currentShop = ((shopDetailsPayload as any)?.data ?? mainShop) as ShopRecord;
    const departmentId = await fetchDepartmentId();
    const serviceAdvisors = await fetchServiceAdvisorIds();
    const hours = buildScheduleFromDayState(shopSchedule);

    const payload = {
      id: currentShop.id,
      defaultShop: currentShop.defaultShop,
      orderId: currentShop.orderId,
      description: currentShop.description,
      name: currentShop.name,
      status: currentShop.status,
      departmentId,
      hours,
      blocks: currentShop.blocks ?? [],
      holidays: currentShop.holidays ?? [],
      vehicles: currentShop.vehicles ?? [],
      operator: "INCLUDE",
      serviceAdvisorAssociationType: "SERVICE_ADVISOR",
      bookingFrom: 0,
      bookingFromUnit: "HOURS",
      bookingUpto: 10,
      bookingUptoUnit: "MONTHS",
      associationIds: serviceAdvisors,
      addedOpcodes: [],
      updatedOpcodes: [],
      deletedOpcodes: [],
    };

    await proxyRequest({
      url: `${SERVICE_SHOP_LIST_URL}/${mainShop.id}`,
      method: "PUT",
      body: payload,
    });

    await fetchShops();

    setMessage({
      ok: true,
      text: `Main Shop configured successfully with ${serviceAdvisors.length} service advisor(s).`,
    });
  }, [
    fetchDepartmentId,
    fetchServiceAdvisorIds,
    fetchShops,
    proxyRequest,
    shopSchedule,
  ]);

  const fetchTransportation = useCallback(async () => {
    const payload = await proxyRequest({
      url: SCHEDULING_AGGREGATED_SETTINGS_URL,
      method: "POST",
      body: {
        requestOptions: ["TRANSPORTATION_SETTINGS_SUMMARY"],
      },
    });

    const rows =
      (payload as any)?.data?.[0]?.settingDetails?.transportationSummaryDTOList ?? [];

    setTransportationRows(Array.isArray(rows) ? rows : []);
  }, [proxyRequest]);

  const autoConfigureTransportation = useCallback(async () => {
    const payload = await proxyRequest({
      url: SCHEDULING_AGGREGATED_SETTINGS_URL,
      method: "POST",
      body: {
        requestOptions: ["TRANSPORTATION_SETTINGS_SUMMARY"],
      },
    });

    const rows: TransportationSummaryRow[] =
      (payload as any)?.data?.[0]?.settingDetails?.transportationSummaryDTOList ?? [];

    const results: Array<{ name: string; ok: boolean; text: string }> = [];

    for (const transport of rows) {
      const transportId = normalize(transport?.id);
      const transportType = normalize(transport?.transportationType);
      const displayName = normalize(transport?.displayName || transportType || transportId);

      if (!transportId) continue;

      if (transportType === "SELF") {
        results.push({
          name: displayName,
          ok: true,
          text: "Skipped default SELF type",
        });
        continue;
      }

      try {
        const current = await proxyRequest({
          url: `https://preprodapp.tekioncloud.com/api/scheduling/u/settings/transportation/${transportId}?additionalParams=false`,
          method: "GET",
        });

        const currentData = (current as any)?.data ?? current;
        const isExtendedType =
          currentData?.bookingFrom !== undefined ||
          currentData?.vehicles !== undefined ||
          currentData?.rideProviderSettings !== undefined;

        const updatePayload = {
          ...currentData,
          schedulingTypes: ["BDC_SCHEDULING", "CONSUMER_SCHEDULING"],
          ...(isExtendedType
            ? {
                bookingFrom: 0,
                bookingFromUnit: "HOURS",
                bookingUpto: 10,
                bookingUptoUnit: "MONTHS",
              }
            : {}),
        };

        await proxyRequest({
          url: `https://preprodapp.tekioncloud.com/api/scheduling/u/settings/transportation/${transportId}`,
          method: "PUT",
          body: updatePayload,
        });

        results.push({
          name: displayName,
          ok: true,
          text: "Configured successfully",
        });
      } catch (e: unknown) {
        results.push({
          name: displayName,
          ok: false,
          text: e instanceof Error ? e.message : "Configuration failed",
        });
      }
    }

    setTransportationResult(results);
    setMessage({
      ok: true,
      text: `Transportation auto-config completed for ${results.length} item(s).`,
    });
  }, [proxyRequest]);

  const runOperation = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      if (!dealerId) {
        throw new Error("Dealer ID not found in Global Headers. Please set Global Headers first.");
      }

      if (subsection === "consumer-scheduling" && operation === "get") {
        await fetchConsumerScheduling();
      } else if (subsection === "consumer-scheduling" && operation === "put") {
        await fetchConsumerScheduling();
      } else if (subsection === "service-advisors" && operation === "get") {
        await fetchServiceAdvisors();
      } else if (subsection === "general" && operation === "get") {
        await fetchGeneralSettings();
      } else if (subsection === "shops" && operation === "get") {
        await fetchShops();
      } else if (subsection === "transportation" && operation === "get") {
        await fetchTransportation();
      } else {
        setMessage({
          ok: true,
          text: "Operation view ready.",
        });
      }
    } catch (e: unknown) {
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Operation failed",
      });
    } finally {
      setLoading(false);
    }
  }, [
    dealerId,
    fetchConsumerScheduling,
    fetchGeneralSettings,
    fetchServiceAdvisors,
    fetchShops,
    fetchTransportation,
    operation,
    subsection,
  ]);

  const executeAction = useCallback(async () => {
    setRunning(true);
    setMessage(null);

    try {
      if (subsection === "consumer-scheduling" && operation === "put") {
        await putConsumerScheduling();
      } else if (subsection === "service-advisors" && operation === "post") {
        await autoConfigureServiceAdvisors();
      } else if (subsection === "general" && operation === "post") {
        await postGeneralSettings();
      } else if (subsection === "shops" && operation === "configure") {
        await configureMainShop();
      } else if (subsection === "transportation" && operation === "configure") {
        await autoConfigureTransportation();
      } else {
        setMessage({
          ok: true,
          text: "No execution needed for this operation.",
        });
      }
    } catch (e: unknown) {
      setMessage({
        ok: false,
        text: e instanceof Error ? e.message : "Execution failed",
      });
    } finally {
      setRunning(false);
    }
  }, [
    autoConfigureServiceAdvisors,
    autoConfigureTransportation,
    configureMainShop,
    operation,
    postGeneralSettings,
    putConsumerScheduling,
    subsection,
  ]);

  return (
    <div
      style={{
        display: "grid",
        gap: 16,
        maxHeight: "100%",
        overflow: "auto",
      }}
      className="service-scheduling-scroll"
    >
      <style>{`
        .service-scheduling-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .service-scheduling-scroll::-webkit-scrollbar-track { background: transparent; }
        .service-scheduling-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 8px; }
        .service-scheduling-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.24); }
      `}</style>

      <div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#f8fafc", marginBottom: 6 }}>
          📅 Scheduling Settings
        </div>
        <div style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.6 }}>
          Configure scheduling-related service settings using Global Headers from Settings.
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "#cbd5e1",
            fontSize: 12,
          }}
        >
          Dealer ID: <b style={{ color: dealerId ? "#86efac" : "#fca5a5" }}>{dealerId || "Not found"}</b>
        </span>

        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "#cbd5e1",
            fontSize: 12,
          }}
        >
          Global Headers: <b style={{ color: "#f8fafc" }}>{Object.keys(enabledHeaders).length}</b>
        </span>
      </div>

      <div
        style={{
          display: "grid",
          gap: 14,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.02)",
          padding: 16,
        }}
      >
        <div>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 8 }}>
            Subsections
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { key: "consumer-scheduling", label: "1. Consumer Scheduling" },
              { key: "transportation", label: "2. Transportation" },
              { key: "service-advisors", label: "3. Service Advisors" },
              { key: "shops", label: "4. Shops" },
              { key: "general", label: "5. General" },
            ].map((item) => {
              const isActive = subsection === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  className={isActive ? "btn-primary" : "btn-secondary btn-sm"}
                  onClick={() => setSubsection(item.key as SchedulingSubsectionKey)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div
          style={{
            borderRadius: 14,
            border: "1px solid rgba(255,255,255,0.06)",
            background: "rgba(255,255,255,0.018)",
            padding: 14,
            display: "grid",
            gap: 12,
          }}
        >
          <div>
            <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 4 }}>
              {subsectionMeta.title}
            </div>
            <div style={{ color: "#94a3b8", fontSize: 13 }}>
              {subsectionMeta.description}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {subsectionMeta.ops.map((op) => {
              const active = operation === op;
              return (
                <button
                  key={op}
                  type="button"
                  className={active ? "btn-primary" : "btn-secondary btn-sm"}
                  onClick={() => setOperation(op)}
                >
                  {op.toUpperCase()}
                </button>
              );
            })}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className="btn-secondary btn-sm"
              onClick={() => void runOperation()}
              disabled={!operation || loading}
            >
              {loading ? "Loading..." : "▶ Load"}
            </button>

            <button
              className="btn-primary"
              onClick={() => void executeAction()}
              disabled={!operation || running}
            >
              {running ? "Running..." : "⚙ Execute"}
            </button>
          </div>

          {message ? (
            <div
              style={{
                borderRadius: 12,
                padding: "10px 12px",
                fontSize: 13,
                color: message.ok ? "#bbf7d0" : "#fecaca",
                background: message.ok
                  ? "rgba(34,197,94,0.10)"
                  : "rgba(239,68,68,0.10)",
                border: message.ok
                  ? "1px solid rgba(34,197,94,0.22)"
                  : "1px solid rgba(239,68,68,0.22)",
              }}
            >
              {message.text}
            </div>
          ) : null}
        </div>
      </div>

      {subsection === "consumer-scheduling" && operation === "get" && consumerSettings ? (
        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
            padding: 16,
            display: "grid",
            gap: 12,
          }}
        >
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
            Consumer Scheduling Settings
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                borderRadius: 12,
                padding: "12px 14px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <span style={{ color: "#e2e8f0" }}>Allow to Remove Vehicle</span>
              {renderStatusBadge(Boolean(consumerSettings?.data?.allowToRemoveVehicle), consumerSettings?.data?.allowToRemoveVehicle ? "Enabled" : "Disabled")}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                borderRadius: 12,
                padding: "12px 14px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <span style={{ color: "#e2e8f0" }}>Allow Customer to Add VIN</span>
              {renderStatusBadge(Boolean(consumerSettings?.data?.allowCustomerToAddVin), consumerSettings?.data?.allowCustomerToAddVin ? "Enabled" : "Disabled")}
            </div>
          </div>
        </div>
      ) : null}

      {subsection === "consumer-scheduling" && operation === "put" ? (
        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
            padding: 16,
            display: "grid",
            gap: 14,
          }}
        >
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
            Update Consumer Scheduling
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 10, color: "#e2e8f0" }}>
            <input
              type="checkbox"
              checked={consumerPutForm.allowToRemoveVehicle}
              onChange={(e) =>
                setConsumerPutForm((prev) => ({
                  ...prev,
                  allowToRemoveVehicle: e.target.checked,
                }))
              }
            />
            Allow to Remove Vehicle
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 10, color: "#e2e8f0" }}>
            <input
              type="checkbox"
              checked={consumerPutForm.allowCustomerToAddVin}
              onChange={(e) =>
                setConsumerPutForm((prev) => ({
                  ...prev,
                  allowCustomerToAddVin: e.target.checked,
                }))
              }
            />
            Allow Customer to Add VIN
          </label>
        </div>
      ) : null}

      {subsection === "service-advisors" && operation === "get" && serviceAdvisorsRaw ? (
        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
            padding: 16,
          }}
        >
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }}>
            Service Advisors Response
          </div>
          <pre
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 12,
              background: "#0f172a",
              color: "#e2e8f0",
              overflow: "auto",
              fontSize: 12,
            }}
          >
            {JSON.stringify(serviceAdvisorsRaw, null, 2)}
          </pre>
        </div>
      ) : null}

      {subsection === "service-advisors" && operation === "post" ? (
        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
            padding: 16,
            display: "grid",
            gap: 14,
          }}
        >
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
            Auto Configure Service Advisors
          </div>

          <div style={{ color: "#94a3b8", fontSize: 13 }}>
            Configure a default weekly schedule for all active Service Advisors.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {DAY_OPTIONS.map((day) => {
              const row = advisorSchedule[day.key];
              return (
                <div
                  key={day.key}
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.06)",
                    background: "rgba(255,255,255,0.02)",
                    padding: 12,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <div style={{ color: "#f8fafc", fontWeight: 700 }}>{day.label}</div>

                  <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#cbd5e1", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={row.blocked}
                      onChange={(e) =>
                        setAdvisorSchedule((prev) => ({
                          ...prev,
                          [day.key]: {
                            ...prev[day.key],
                            blocked: e.target.checked,
                            start: e.target.checked ? "" : prev[day.key].start || "09:00",
                            end: e.target.checked ? "" : prev[day.key].end || "17:00",
                          },
                        }))
                      }
                    />
                    Blocked
                  </label>

                  <input
                    type="time"
                    value={row.start}
                    disabled={row.blocked}
                    onChange={(e) =>
                      setAdvisorSchedule((prev) => ({
                        ...prev,
                        [day.key]: { ...prev[day.key], start: e.target.value },
                      }))
                    }
                  />

                  <input
                    type="time"
                    value={row.end}
                    disabled={row.blocked}
                    onChange={(e) =>
                      setAdvisorSchedule((prev) => ({
                        ...prev,
                        [day.key]: { ...prev[day.key], end: e.target.value },
                      }))
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {subsection === "general" && operation === "get" && generalRaw ? (
        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
            padding: 16,
          }}
        >
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }}>
            General Scheduling Response
          </div>
          <pre
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 12,
              background: "#0f172a",
              color: "#e2e8f0",
              overflow: "auto",
              fontSize: 12,
            }}
          >
            {JSON.stringify(generalRaw, null, 2)}
          </pre>
        </div>
      ) : null}

      {subsection === "shops" && operation === "get" && shops.length > 0 ? (
        <div style={{ display: "grid", gap: 12 }}>
          {shops.map((shop, index) => (
            <div
              key={`${shop.id || shop.name || "shop"}-${index}`}
              style={{
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.02)",
                padding: 16,
                display: "grid",
                gap: 12,
              }}
            >
              <div>
                <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800 }}>
                  {shop.name || "Unnamed Shop"}
                </div>
                <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>
                  ID: {shop.id || "—"} · Status: {shop.status || "—"} · Default: {shop.defaultShop ? "Yes" : "No"}
                </div>
              </div>

              <div>
                <div style={{ color: "#cbd5e1", fontWeight: 700, marginBottom: 8 }}>
                  Hours
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
                  {(shop.hours ?? []).length > 0 ? (
                    (shop.hours ?? []).map((hour, idx) => (
                      <div
                        key={`${shop.id}-hour-${idx}`}
                        style={{
                          borderRadius: 10,
                          padding: "10px 12px",
                          background: "rgba(255,255,255,0.02)",
                          border: "1px solid rgba(255,255,255,0.05)",
                        }}
                      >
                        <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>
                          {hour.day || "—"}
                        </div>
                        <div style={{ color: "#f8fafc", fontSize: 13 }}>
                          {hour.blocked
                            ? "Closed"
                            : `${formatTime(hour.startTime)} - ${formatTime(hour.endTime)}`}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ color: "#94a3b8", fontSize: 13 }}>No hours configured</div>
                  )}
                </div>
              </div>

              <details>
                <summary style={{ cursor: "pointer", color: "#93c5fd", fontSize: 13, fontWeight: 700 }}>
                  Show Raw JSON
                </summary>
                <pre
                  style={{
                    marginTop: 10,
                    padding: 12,
                    borderRadius: 12,
                    background: "#0f172a",
                    color: "#e2e8f0",
                    overflow: "auto",
                    fontSize: 12,
                  }}
                >
                  {JSON.stringify(shop, null, 2)}
                </pre>
              </details>
            </div>
          ))}
        </div>
      ) : null}

      {subsection === "shops" && operation === "configure" ? (
        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
            padding: 16,
            display: "grid",
            gap: 14,
          }}
        >
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
            Configure Main Shop
          </div>

          <div style={{ color: "#94a3b8", fontSize: 13 }}>
            Build Main Shop working hours and assign active Service Advisors automatically.
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {DAY_OPTIONS.map((day) => {
              const row = shopSchedule[day.key];
              return (
                <div
                  key={day.key}
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.06)",
                    background: "rgba(255,255,255,0.02)",
                    padding: 12,
                    display: "grid",
                    gap: 8,
                  }}
                >
                  <div style={{ color: "#f8fafc", fontWeight: 700 }}>{day.label}</div>

                  <label style={{ display: "flex", alignItems: "center", gap: 8, color: "#cbd5e1", fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={row.blocked}
                      onChange={(e) =>
                        setShopSchedule((prev) => ({
                          ...prev,
                          [day.key]: {
                            ...prev[day.key],
                            blocked: e.target.checked,
                            start: e.target.checked ? "" : prev[day.key].start || "09:00",
                            end: e.target.checked ? "" : prev[day.key].end || "17:00",
                          },
                        }))
                      }
                    />
                    Blocked
                  </label>

                  <input
                    type="time"
                    value={row.start}
                    disabled={row.blocked}
                    onChange={(e) =>
                      setShopSchedule((prev) => ({
                        ...prev,
                        [day.key]: { ...prev[day.key], start: e.target.value },
                      }))
                    }
                  />

                  <input
                    type="time"
                    value={row.end}
                    disabled={row.blocked}
                    onChange={(e) =>
                      setShopSchedule((prev) => ({
                        ...prev,
                        [day.key]: { ...prev[day.key], end: e.target.value },
                      }))
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {subsection === "transportation" && operation === "get" && transportationRows.length > 0 ? (
        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
            padding: 16,
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800 }}>
            Transportation Types
          </div>

          {transportationRows.map((row, index) => (
            <div
              key={`${row.id || row.transportationType || "transport"}-${index}`}
              style={{
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.02)",
                padding: "12px 14px",
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ color: "#f8fafc", fontWeight: 700 }}>
                  {row.displayName || row.transportationType || "Unknown"}
                </div>
                <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
                  Type: {row.transportationType || "—"} · ID: {row.id || "—"}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {subsection === "transportation" && operation === "configure" && transportationResult ? (
        <div
          style={{
            borderRadius: 16,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.02)",
            padding: 16,
          }}
        >
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }}>
            Transportation Configuration Results
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {(transportationResult as Array<{ name: string; ok: boolean; text: string }>).map(
              (row, idx) => (
                <div
                  key={`${row.name}-${idx}`}
                  style={{
                    borderRadius: 12,
                    border: row.ok
                      ? "1px solid rgba(34,197,94,0.18)"
                      : "1px solid rgba(239,68,68,0.18)",
                    background: row.ok
                      ? "rgba(34,197,94,0.06)"
                      : "rgba(239,68,68,0.06)",
                    padding: "10px 12px",
                    color: row.ok ? "#bbf7d0" : "#fecaca",
                    fontSize: 13,
                  }}
                >
                  <b>{row.name}</b> — {row.text}
                </div>
              )
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default SchedulingSettingsView;
