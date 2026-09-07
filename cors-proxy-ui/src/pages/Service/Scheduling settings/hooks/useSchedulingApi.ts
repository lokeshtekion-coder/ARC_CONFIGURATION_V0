import { useCallback } from "react";
import {
  ACCOUNTING_BOOTSTRAP_URL,
  ACCOUNTING_DEPARTMENTS_URL,
  CONSUMER_SCHEDULING_URL,
  GENERAL_SCHEDULING_URL,
  SCHEDULING_AGGREGATED_SETTINGS_URL,
  SERVICE_ADVISORS_URL,
  SERVICE_ADVISOR_SCHEDULE_URL,
  SERVICE_SHOP_LIST_URL,
  TRANSPORTATION_SETTINGS_URL,
  USERS_BY_PERSONA_URL,
} from "../constants";
import { buildScheduleFromDayState, normalize } from "../utils";
import type {
  ConsumerSchedulingResponse,
  DayState,
  ShopRecord,
  TransportationSummaryRow,
} from "../types";

type UseSchedulingApiArgs = {
  enabledHeaders: Record<string, string>;
  dealerId: string;
};

export function useSchedulingApi({ enabledHeaders, dealerId }: UseSchedulingApiArgs) {
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

  const fetchConsumerScheduling = useCallback(async (): Promise<ConsumerSchedulingResponse> => {
    return (await proxyRequest({
      url: CONSUMER_SCHEDULING_URL,
      method: "GET",
    })) as ConsumerSchedulingResponse;
  }, [proxyRequest]);

  const autoConfigureConsumerScheduling = useCallback(async () => {
    const current = await fetchConsumerScheduling();
    const allowToRemoveVehicle = Boolean(current?.data?.allowToRemoveVehicle);
    const allowCustomerToAddVin = Boolean(current?.data?.allowCustomerToAddVin);

    if (!allowToRemoveVehicle && !allowCustomerToAddVin) {
      await proxyRequest({
        url: CONSUMER_SCHEDULING_URL,
        method: "PUT",
        body: {
          allowToRemoveVehicle: true,
          allowCustomerToAddVin: true,
        },
      });

      const updated = await fetchConsumerScheduling();

      return {
        updated: true,
        current: updated,
        message:
          "Both settings were disabled. Updated Consumer Scheduling settings to enabled successfully.",
      };
    }

    return {
      updated: false,
      current,
      message: "No update needed — at least one setting is already enabled.",
    };
  }, [fetchConsumerScheduling, proxyRequest]);

  const fetchServiceAdvisors = useCallback(async () => {
    return await proxyRequest({
      url: SERVICE_ADVISORS_URL,
      method: "GET",
    });
  }, [proxyRequest]);

  const fetchServiceAdvisorIds = useCallback(async (): Promise<string[]> => {
    const response = await proxyRequest({
      url: USERS_BY_PERSONA_URL,
      method: "POST",
      body: {
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
      },
    });

    const rows = Array.isArray(response)
      ? response
      : Array.isArray((response as { data?: unknown[] }).data)
      ? (response as { data: unknown[] }).data
      : Array.isArray((response as { results?: unknown[] }).results)
      ? (response as { results: unknown[] }).results
      : [];

    return rows
      .map((x) => normalize((x as { id?: unknown })?.id))
      .filter(Boolean);
  }, [proxyRequest]);

  const autoConfigureServiceAdvisors = useCallback(
    async (advisorSchedule: DayState) => {
      const advisorIds = await fetchServiceAdvisorIds();

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

        await proxyRequest({
          url: SERVICE_ADVISOR_SCHEDULE_URL,
          method: "POST",
          body: {
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
                  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
                    ? crypto.randomUUID()
                    : `row-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                orderId: 1,
              },
            ],
          },
        });
      }

      return advisorIds.length;
    },
    [fetchServiceAdvisorIds, proxyRequest]
  );

  const fetchGeneralSettings = useCallback(async () => {
    return await proxyRequest({
      url: GENERAL_SCHEDULING_URL,
      method: "GET",
    });
  }, [proxyRequest]);

  const postGeneralSettings = useCallback(async () => {
    return {
      ok: true,
      message: "General POST placeholder only. API create logic can be added separately.",
    };
  }, []);

  const fetchShops = useCallback(async (): Promise<ShopRecord[]> => {
    const payload = await proxyRequest({
      url: SERVICE_SHOP_LIST_URL,
      method: "GET",
    });

    const rows = Array.isArray((payload as { data?: unknown[] })?.data)
      ? ((payload as { data: unknown[] }).data as ShopRecord[])
      : Array.isArray(payload)
      ? (payload as ShopRecord[])
      : [];

    const detailed: ShopRecord[] = [];

    for (const row of rows) {
      const shopId = normalize(row?.id);
      if (!shopId) continue;

      try {
        const detailPayload = await proxyRequest({
          url: `${SERVICE_SHOP_LIST_URL}/${shopId}`,
          method: "GET",
        });
        detailed.push(((detailPayload as { data?: unknown }).data ?? row) as ShopRecord);
      } catch {
        detailed.push(row);
      }
    }

    return detailed;
  }, [proxyRequest]);

  const fetchDepartmentId = useCallback(async (): Promise<string> => {
    try {
      const deptPayload = await proxyRequest({
        url: ACCOUNTING_DEPARTMENTS_URL,
        method: "GET",
      });

      const rows = Array.isArray((deptPayload as { data?: unknown[] })?.data)
        ? ((deptPayload as { data: unknown[] }).data as Array<Record<string, unknown>>)
        : Array.isArray((deptPayload as { results?: unknown[] })?.results)
        ? ((deptPayload as { results: unknown[] }).results as Array<Record<string, unknown>>)
        : [];

      const firstId =
        normalize(rows?.[0]?.id) || normalize(rows?.[0]?.departmentId);

      if (firstId) return firstId;
    } catch {
      // fallback below
    }

    const bootstrap = await proxyRequest({
      url: ACCOUNTING_BOOTSTRAP_URL,
      method: "POST",
      body: {
        requestInfo: [
          {
            assetType: "customField",
            dealerMetaDataInfo: [{ dealerId }],
          },
        ],
      },
    });

    const bootstrapData = bootstrap as {
      data?: { customField?: Record<string, unknown> };
      customField?: Record<string, unknown>;
    };

    const customField =
      bootstrapData?.data?.customField ?? bootstrapData?.customField ?? {};

    const accessibleAssetMap = (customField as { accessibleAssetMap?: Record<string, string[]> })
      ?.accessibleAssetMap ?? {};
    const masterAssetDocMap = (customField as {
      masterAssetDocMap?: Record<string, Record<string, unknown>>;
    })?.masterAssetDocMap ?? {};

    const customFieldKeys = accessibleAssetMap?.[dealerId] ?? [];

    for (const key of customFieldKeys) {
      const masterDoc = masterAssetDocMap?.[key];
      if (!masterDoc) continue;

      if (masterDoc?.key === "DEPARTMENT" || masterDoc?.name === "DEPARTMENT") {
        const options = Array.isArray(masterDoc?.options)
          ? (masterDoc.options as Array<Record<string, unknown>>)
          : [];

        for (const option of options) {
          const extras = (option?.extras as Record<string, unknown> | undefined) ?? {};
          if (extras?.department_type === "SERVICE" && normalize(option?.id)) {
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

  const configureMainShop = useCallback(
    async (shopSchedule: DayState) => {
      const listPayload = await proxyRequest({
        url: SERVICE_SHOP_LIST_URL,
        method: "GET",
      });

      const rows = Array.isArray((listPayload as { data?: unknown[] })?.data)
        ? ((listPayload as { data: unknown[] }).data as Array<Record<string, unknown>>)
        : Array.isArray(listPayload)
        ? (listPayload as Array<Record<string, unknown>>)
        : [];

      const mainShop =
        rows.find((x) => x?.name === "Main Shop" || x?.defaultShop === true) ?? null;

      if (!mainShop?.id) {
        throw new Error("Main Shop not found.");
      }

      const shopDetailsPayload = await proxyRequest({
        url: `${SERVICE_SHOP_LIST_URL}/${mainShop.id}`,
        method: "GET",
      });

      const currentShop = ((shopDetailsPayload as { data?: unknown }).data ??
        mainShop) as ShopRecord;

      const departmentId = await fetchDepartmentId();
      const serviceAdvisors = await fetchServiceAdvisorIds();
      const hours = buildScheduleFromDayState(shopSchedule);

      await proxyRequest({
        url: `${SERVICE_SHOP_LIST_URL}/${mainShop.id}`,
        method: "PUT",
        body: {
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
        },
      });

      const refreshed = await fetchShops();

      return {
        serviceAdvisorCount: serviceAdvisors.length,
        shops: refreshed,
      };
    },
    [fetchDepartmentId, fetchServiceAdvisorIds, fetchShops, proxyRequest]
  );

  const fetchTransportation = useCallback(async (): Promise<TransportationSummaryRow[]> => {
    const payload = await proxyRequest({
      url: SCHEDULING_AGGREGATED_SETTINGS_URL,
      method: "POST",
      body: {
        requestOptions: ["TRANSPORTATION_SETTINGS_SUMMARY"],
      },
    });

    const rows =
      (payload as {
        data?: Array<{
          settingDetails?: {
            transportationSummaryDTOList?: TransportationSummaryRow[];
          };
        }>;
      })?.data?.[0]?.settingDetails?.transportationSummaryDTOList ?? [];

    return Array.isArray(rows) ? rows : [];
  }, [proxyRequest]);

  const autoConfigureTransportation = useCallback(async () => {
    const rows = await fetchTransportation();
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
          url: `${TRANSPORTATION_SETTINGS_URL}/${transportId}?additionalParams=false`,
          method: "GET",
        });

        const currentData = (current as { data?: Record<string, unknown> }).data ??
          (current as Record<string, unknown>);

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
          url: `${TRANSPORTATION_SETTINGS_URL}/${transportId}`,
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

    return results;
  }, [fetchTransportation, proxyRequest]);

  return {
    proxyRequest,
    fetchConsumerScheduling,
    autoConfigureConsumerScheduling,
    fetchServiceAdvisors,
    autoConfigureServiceAdvisors,
    fetchGeneralSettings,
    postGeneralSettings,
    fetchShops,
    configureMainShop,
    fetchTransportation,
    autoConfigureTransportation,
  };
}
