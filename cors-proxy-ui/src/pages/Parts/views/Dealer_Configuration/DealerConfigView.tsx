import React, { useEffect, useMemo, useState } from "react";
import {
  loadTekionApiSettingsBundle,
  getSelectedDealerProfileId,
} from "../../../../services/tekionApiSettings";
import {
  loadLatestExtensionCapture,
  requestLatestCaptureFromExtension,
  subscribeToExtensionCapture,
  type ArcTekionProfile,
} from "../../../../services/extensionBridge";
import type { KeyValuePair } from "../../../../types/proxy.types";

const TENANTS_URL =
  "https://app.tekioncloud.com/api/tekapproval/u/dealer-tenant/tenants";
const DEALERS_URL =
  "https://app.tekioncloud.com/api/tekapproval/u/dealer-tenant/tenants/dealers";
const APPROVAL_URL =
  "https://app.tekioncloud.com/api/tekapproval/u/v1/approvalRequest/";
const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";

const CUSTOMER_NOTIFICATIONS_TEMPLATE_ID =
  "5a3eae0e-9be5-4c40-b618-1ca4b98bd853";

type RunState = "idle" | "loading" | "success" | "error" | "warning";
type ValidationState = "idle" | "loading" | "matched" | "not-found";
type ActionKey = "general" | "customer-notifications" | "dealer-details";

interface TenantInfo {
  tenantId?: string;
  createdTime?: number;
  active?: boolean;
  displayName?: string;
  lastModifiedByUser?: string;
}

interface TenantsResponse {
  data?: Array<{
    overrideRule?: {
      env?: string;
      pod?: string | null;
    };
    tenantInfos?: TenantInfo[];
  }>;
  status?: string;
  message?: string;
}

interface DealerInfo {
  tenantId?: string;
  dealerId?: string;
  dealerName?: string | null;
  createdTime?: number;
  active?: boolean;
  displayName?: string | null;
  lastModifiedByUser?: string;
}

interface DealersResponse {
  data?: {
    PREPROD?: DealerInfo[];
    [key: string]: DealerInfo[] | undefined;
  };
  status?: string;
  message?: string;
}

const logger = {
  info: (...args: unknown[]) =>
    console.info("[Parts][DealerConfigView]", ...args),
  warn: (...args: unknown[]) =>
    console.warn("[Parts][DealerConfigView]", ...args),
  error: (...args: unknown[]) =>
    console.error("[Parts][DealerConfigView]", ...args),
  debug: (...args: unknown[]) =>
    console.debug("[Parts][DealerConfigView]", ...args),
  group: (label: string, ...args: unknown[]) =>
    console.group(`[Parts][DealerConfigView] ${label}`, ...args),
  groupEnd: () => console.groupEnd(),
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function getEnabledGlobalHeaders(): Record<string, string> {
  const bundle = loadTekionApiSettingsBundle();
  return (bundle.globalHeaders ?? [])
    .filter(
      (header: KeyValuePair) =>
        header.enabled && normalize(header.key) && normalize(header.value)
    )
    .reduce<Record<string, string>>((acc, header) => {
      acc[String(header.key).toLowerCase()] = String(header.value);
      return acc;
    }, {});
}

function getProdTechMotorsHeaders(): Record<string, string> {
  const capture = loadLatestExtensionCapture();
  const raw = capture?.tekionProdTechMotorsHeaders ?? {};
  const normalizedHeaders: Record<string, string> = {};

  Object.entries(raw).forEach(([key, value]) => {
    normalizedHeaders[key.toLowerCase()] = value;
  });

  return normalizedHeaders;
}

function buildHeadersForProdTechMotors(): {
  headers: Record<string, string>;
  source: "captured-prodtechmotors" | "global";
} {
  const captured = getProdTechMotorsHeaders();

  if (Object.keys(captured).length > 0) {
    return {
      headers: {
        ...captured,
        "content-type": "application/json",
      },
      source: "captured-prodtechmotors",
    };
  }

  const global = getEnabledGlobalHeaders();

  return {
    headers: {
      ...global,
      "content-type": "application/json",
    },
    source: "global",
  };
}

function loadSelectedDealerProfileFromCapture(): ArcTekionProfile | null {
  const selectedProfileId =
    getSelectedDealerProfileId() ||
    localStorage.getItem(SELECTED_DEALER_PROFILE_KEY) ||
    "";

  if (!selectedProfileId) return null;

  const capture = loadLatestExtensionCapture();
  return (
    capture?.tekionProfiles?.find((item) => item.id === selectedProfileId) ?? null
  );
}

async function proxyPost(
  url: string,
  body: unknown,
  headers: Record<string, string>
): Promise<unknown> {
  logger.group("proxyPost");
  logger.debug("target url", url);
  logger.debug("request body", body);
  logger.debug("request header keys", Object.keys(headers).sort());

  const response = await fetch("http://localhost:4000/api/proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      method: "POST",
      headers,
      body,
      timeout: 60000,
    }),
  });

  if (!response.ok) {
    logger.groupEnd();
    throw new Error(`Proxy request failed with HTTP ${response.status}`);
  }

  const json = await response.json();
  logger.debug("proxy json response", json);

  if ((json?.status ?? 200) >= 400) {
    logger.groupEnd();
    throw new Error(
      `${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim()
    );
  }

  logger.groupEnd();
  return json?.body ?? json?.data ?? json;
}

function getValidationReason(
  preferredValue: string,
  state: ValidationState,
  kind: "tenant" | "dealer"
): string {
  if (!preferredValue) {
    return `No selected profile ${kind} found yet.`;
  }
  if (state === "loading") {
    return `Validating ${kind} from API response...`;
  }
  if (state === "matched") {
    return `${kind} validated successfully against API response.`;
  }
  if (state === "not-found") {
    return `${kind} value from selected profile was not found in API response.`;
  }
  return `${
    kind === "tenant"
      ? "Waiting to call tenants API."
      : "Waiting to call dealers API."
  }`;
}

function buildCustomerNotificationsBodyFormat(
  tenantId: string,
  dealerIds: string[]
): string {
  return `{
 "onlyForDealers": [
  {
   "tenantDealer": {
    "tenantId": "${tenantId}",
    "dealerId": "${dealerIds[0] ?? ""}"
   }
  }
 ],
 "batchSize": 10,
 "additionalParams": {
  "moduleName": "SERVICE",
  "types": [
   { "notificationType": "APPOINTMENT_CONFIRMATION", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "APPOINTMENT_RESCHEDULED", "communicationChannelType": "SERVICE_MAINTENANCE", "override": true },
   { "notificationType": "APPOINTMENT_REMINDER", "communicationChannelType": "SERVICE_MAINTENANCE", "override": true },
   { "notificationType": "APPOINTMENT_CANCELLATION", "communicationChannelType": "SERVICE_MAINTENANCE", "override": true },
   { "notificationType": "APPOINTMENT_CONSUMER_SCHEDULING_OTP", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "APPOINTMENT_CONCIERGE_PICKUP", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "APPOINTMENT_CONFIRMATION_CONCIERGE", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "APPOINTMENT_RESCHEDULE_CONCIERGE", "communicationChannelType": "SERVICE_MAINTENANCE", "override": true },
   { "notificationType": "APPOINTMENT_REMINDER_CONCIERGE", "communicationChannelType": "SERVICE_MAINTENANCE", "override": true },
   { "notificationType": "REPAIR_ORDER_CREATED", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_INVOICED", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_DRAFT_RO_PAID", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_REVISED_ESTIMATE", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_RECOMMENDATION_SEND_TO_CUSTOMER", "communicationChannelType": "SERVICE_MAINTENANCE", "override": true },
   { "notificationType": "REPAIR_ORDER_CUSTOMER_PAY_CLOSED", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_CONSUMER_PORTAL_OTP", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_MPVI_VIDEO_ATTACHED", "communicationChannelType": "SERVICE_MAINTENANCE", "override": true },
   { "notificationType": "REPAIR_ORDER_SEND_UPLOAD_LINK", "communicationChannelType": "SERVICE_MAINTENANCE", "override": true },
   { "notificationType": "REPAIR_ORDER_SA_RETURNED_KEYS", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_DRAFT_CREATED", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_DRAFT_INVOICED", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_PDF_INVOICE_CUSTOMER", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_PDF_DAMAGES_CUSTOMER", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_PDF_INSPECTIONS_AND_RECOMMENDATIONS_CUSTOMER", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_PDF_SERVICE_BOOKLET_OEM_SERVICE_BOOKLET", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_PDF_VIS_CUSTOMER", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_PDF_ESTIMATE_CUSTOMER", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_PDF_INVOICE_DAY_COLLECTION_REPORT", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_PDF_INVOICE_COLLECTION_SLIP", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "QUOTES_PDF_ESTIMATE", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_PDF_SERVICE_HISTORY_INVOICE_BULK", "communicationChannelType": "SERVICE_MAINTENANCE", "override": true },
   { "notificationType": "REPAIR_ORDER_PDF_SERVICE_HISTORY_RECAP", "communicationChannelType": "CUSTOMER_SATISFACTION", "override": true },
   { "notificationType": "REPAIR_ORDER_PAYMENT_LINK", "communicationChannelType": "SERVICE_MAINTENANCE", "override": true },
   { "notificationType": "REPAIR_ORDER_BULK_DOWNLOAD", "communicationChannelType": "SERVICE_MAINTENANCE", "override": true },
   { "notificationType": "REPAIR_ORDER_PDF_ESIGN", "communicationChannelType": "SERVICE_MAINTENANCE", "override": true },
   { "notificationType": "CONSUMER_PORTAL_RESEND_LINK", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "CONSUMER_KEYLOUNGE_OTP", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true },
   { "notificationType": "REPAIR_ORDER_INSPECTIONS_AND_RECOMMENDATIONS_CUSTOMER", "communicationChannelType": "DEALERSHIP_BUSINESS", "override": true }
  ]
 }
}`;
}

export const DealerConfigView: React.FC = () => {
  const [selectedAction, setSelectedAction] = useState<ActionKey>("customer-notifications");
  const [showMainInfo, setShowMainInfo] = useState(false);
  const [showStep1Info, setShowStep1Info] = useState(false);

  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready");
  const [errorText, setErrorText] = useState("");

  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [dealers, setDealers] = useState<DealerInfo[]>([]);

  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [selectedDealerId, setSelectedDealerId] = useState("");
  const [selectedAdditionalDealerIds, setSelectedAdditionalDealerIds] = useState<string[]>([]);

  const [isLoadingTenants, setIsLoadingTenants] = useState(false);
  const [isLoadingDealers, setIsLoadingDealers] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAutoResolving, setIsAutoResolving] = useState(false);

  const [tenantValidationState, setTenantValidationState] =
    useState<ValidationState>("idle");
  const [dealerValidationState, setDealerValidationState] =
    useState<ValidationState>("idle");

  const [lastApprovalPayload, setLastApprovalPayload] = useState<Record<string, unknown> | null>(
    null
  );
  const [showPayloadPreview, setShowPayloadPreview] = useState(false);
  const [captureVersion, setCaptureVersion] = useState(0);
  const [autoSelectionMessage, setAutoSelectionMessage] = useState("");

  useEffect(() => {
    logger.info("mounted");
    requestLatestCaptureFromExtension();

    const unsubscribe = subscribeToExtensionCapture((result) => {
      logger.info("extension capture updated", result.capture);
      setCaptureVersion((prev) => prev + 1);
    });

    const handleFocus = () => {
      setCaptureVersion((prev) => prev + 1);
      requestLatestCaptureFromExtension();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      logger.info("unmounted");
      unsubscribe();
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const headerInfo = useMemo(() => {
    const { headers, source } = buildHeadersForProdTechMotors();
    return {
      headers,
      source,
      headerCount: Object.keys(headers).length,
    };
  }, [captureVersion]);

  const selectedDealerProfile = useMemo(() => {
    return loadSelectedDealerProfileFromCapture();
  }, [captureVersion]);

  const preferredTenantId = useMemo(
    () => normalize(selectedDealerProfile?.tenantName),
    [selectedDealerProfile]
  );

  const preferredDealerId = useMemo(
    () => normalize(selectedDealerProfile?.dealerId),
    [selectedDealerProfile]
  );

  const tenantAutoMatch = useMemo(() => {
    if (!preferredTenantId || tenants.length === 0) return null;
    return (
      tenants.find((tenant) => normalize(tenant.tenantId) === preferredTenantId) ?? null
    );
  }, [preferredTenantId, tenants]);

  const dealerAutoMatch = useMemo(() => {
    if (!preferredDealerId || dealers.length === 0) return null;
    return (
      dealers.find((dealer) => normalize(dealer.dealerId) === preferredDealerId) ?? null
    );
  }, [preferredDealerId, dealers]);

  const resolvedTenantId = useMemo(() => {
    if (normalize(selectedTenantId)) return normalize(selectedTenantId);
    if (tenantAutoMatch?.tenantId) return normalize(tenantAutoMatch.tenantId);
    return "";
  }, [selectedTenantId, tenantAutoMatch]);

  const resolvedVerifiedDealerId = useMemo(() => {
    if (normalize(selectedDealerId)) return normalize(selectedDealerId);
    if (dealerAutoMatch?.dealerId) return normalize(dealerAutoMatch.dealerId);
    return "";
  }, [selectedDealerId, dealerAutoMatch]);

  const finalDealerIds = useMemo(() => {
    const merged = [
      resolvedVerifiedDealerId,
      ...selectedAdditionalDealerIds.map((item) => normalize(item)),
    ].filter(Boolean);

    return Array.from(new Set(merged));
  }, [resolvedVerifiedDealerId, selectedAdditionalDealerIds]);

  const canPreviewPayload = useMemo(() => {
    return Boolean(resolvedTenantId && resolvedVerifiedDealerId && finalDealerIds.length > 0);
  }, [resolvedTenantId, resolvedVerifiedDealerId, finalDealerIds]);

  const loadTenants = async (): Promise<TenantInfo[]> => {
    setIsLoadingTenants(true);
    setTenantValidationState(preferredTenantId ? "loading" : "idle");
    setRunState("loading");
    setStatusText("Loading tenants...");
    setErrorText("");
    setAutoSelectionMessage("");
    setDealers([]);
    setSelectedTenantId("");
    setSelectedDealerId("");
    setSelectedAdditionalDealerIds([]);
    setDealerValidationState("idle");

    try {
      if (headerInfo.headerCount === 0) {
        throw new Error(
          'No captured PRODTechMOTORS headers or Global Headers found. Open app.tekioncloud.com and trigger "/api/userservice/u/employee/profile" first.'
        );
      }

      const body = {
        envPod: [{ env: "PREPROD", pod: null }],
        platform: "ARC",
      };

      const response = (await proxyPost(
        TENANTS_URL,
        body,
        headerInfo.headers
      )) as TenantsResponse;

      const tenantInfos =
        response.data?.flatMap((item) => item.tenantInfos ?? []) ?? [];

      setTenants(tenantInfos);

      const matchedTenant = preferredTenantId
        ? tenantInfos.find((tenant) => normalize(tenant.tenantId) === preferredTenantId) ?? null
        : null;

      if (preferredTenantId) {
        if (matchedTenant) {
          const tenantId = normalize(matchedTenant.tenantId);
          setSelectedTenantId(tenantId);
          setTenantValidationState("matched");
          setAutoSelectionMessage(
            `✅ Tenant validated and auto-selected from selected dealer profile: ${tenantId}`
          );
          setRunState("success");
          setStatusText(
            `Loaded ${tenantInfos.length} tenant(s). Auto-selected tenant ${tenantId}.`
          );
        } else {
          setTenantValidationState("not-found");
          setAutoSelectionMessage(
            `Selected dealer profile tenant "${preferredTenantId}" was not found in tenant results.`
          );
          setRunState("warning");
          setStatusText(
            `Loaded ${tenantInfos.length} tenant(s), but selected profile tenant was not found.`
          );
        }
      } else {
        setTenantValidationState("idle");
        setRunState("success");
        setStatusText(`Loaded ${tenantInfos.length} tenant(s)`);
      }

      return tenantInfos;
    } catch (error: unknown) {
      setTenantValidationState(preferredTenantId ? "not-found" : "idle");
      setRunState("error");
      setStatusText("Failed to load tenants");
      setErrorText(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setIsLoadingTenants(false);
    }
  };

  const loadDealers = async (tenantIdOverride?: string): Promise<DealerInfo[]> => {
    setIsLoadingDealers(true);
    setDealerValidationState(preferredDealerId ? "loading" : "idle");
    setRunState("loading");
    setStatusText("Loading dealers...");
    setErrorText("");

    try {
      const tenantIdForRequest = normalize(tenantIdOverride) || resolvedTenantId;

      if (!tenantIdForRequest) {
        throw new Error("Please select or validate a tenant first.");
      }

      const body = {
        podId: null,
        tenantId: tenantIdForRequest,
        envs: ["PREPROD"],
        platform: "ARC",
        cluster: null,
      };

      const response = (await proxyPost(
        DEALERS_URL,
        body,
        headerInfo.headers
      )) as DealersResponse;

      const dealerRows = response.data?.PREPROD ?? [];
      setDealers(dealerRows);
      setSelectedDealerId("");
      setSelectedAdditionalDealerIds([]);

      const matchedDealer = preferredDealerId
        ? dealerRows.find((dealer) => normalize(dealer.dealerId) === preferredDealerId) ?? null
        : null;

      if (preferredDealerId) {
        if (matchedDealer) {
          const dealerId = normalize(matchedDealer.dealerId);
          setSelectedDealerId(dealerId);
          setDealerValidationState("matched");
          setAutoSelectionMessage(
            `✅ Dealer validated and auto-selected from selected dealer profile: ${dealerId}`
          );
          setRunState("success");
          setStatusText(
            `Loaded ${dealerRows.length} dealer(s) for tenant ${tenantIdForRequest}. Auto-selected verified dealer ${dealerId}.`
          );
        } else {
          setDealerValidationState("not-found");
          setAutoSelectionMessage(
            `Selected dealer profile dealer "${preferredDealerId}" was not found under tenant "${tenantIdForRequest}".`
          );
          setRunState("warning");
          setStatusText(
            `Loaded ${dealerRows.length} dealer(s), but selected profile dealer was not found.`
          );
        }
      } else {
        setDealerValidationState("idle");
        setRunState("success");
        setStatusText(
          `Loaded ${dealerRows.length} dealer(s) for tenant ${tenantIdForRequest}`
        );
      }

      return dealerRows;
    } catch (error: unknown) {
      setDealerValidationState(preferredDealerId ? "not-found" : "idle");
      setRunState("error");
      setStatusText("Failed to load dealers");
      setErrorText(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setIsLoadingDealers(false);
    }
  };

  const autoResolveTenantAndDealer = async (): Promise<void> => {
    setIsAutoResolving(true);
    setErrorText("");
    setShowPayloadPreview(false);

    try {
      if (!preferredTenantId) {
        throw new Error("No selected dealer profile tenant found.");
      }

      if (!preferredDealerId) {
        throw new Error("No selected dealer profile dealer found.");
      }

      const tenantRows = await loadTenants();
      const matchedTenant =
        tenantRows.find((tenant) => normalize(tenant.tenantId) === preferredTenantId) ?? null;

      if (!matchedTenant?.tenantId) {
        throw new Error(
          `Selected profile tenant "${preferredTenantId}" not found in tenants API response.`
        );
      }

      const validatedTenantId = normalize(matchedTenant.tenantId);
      const dealerRows = await loadDealers(validatedTenantId);

      const matchedDealer =
        dealerRows.find((dealer) => normalize(dealer.dealerId) === preferredDealerId) ?? null;

      if (!matchedDealer?.dealerId) {
        throw new Error(
          `Selected profile dealer "${preferredDealerId}" not found in dealers API response for tenant "${validatedTenantId}".`
        );
      }

      const validatedDealerId = normalize(matchedDealer.dealerId);

      setSelectedTenantId(validatedTenantId);
      setSelectedDealerId(validatedDealerId);
      setSelectedAdditionalDealerIds([]);
      setTenantValidationState("matched");
      setDealerValidationState("matched");
      setRunState("success");
      setStatusText(
        `Auto-validation completed. Tenant "${validatedTenantId}" and verified dealer "${validatedDealerId}" are ready.`
      );
      setAutoSelectionMessage(
        `✅ Auto-validated tenant ${validatedTenantId} and verified dealer ${validatedDealerId}. You can now optionally add more dealers from the same tenant and preview/submit.`
      );
    } catch (error: unknown) {
      setRunState("error");
      setStatusText("Auto-validation failed");
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAutoResolving(false);
    }
  };

  const buildCustomerNotificationsPayload = (): Record<string, unknown> => {
    const tenantIdForPayload = resolvedTenantId;
    const verifiedDealerId = resolvedVerifiedDealerId;
    const dealerIdsForPayload = finalDealerIds;

    if (!tenantIdForPayload) {
      throw new Error("Preview unavailable: tenant is not selected or validated yet.");
    }
    if (!verifiedDealerId) {
      throw new Error("Preview unavailable: verified dealer is not selected or validated yet.");
    }
    if (dealerIdsForPayload.length === 0) {
      throw new Error("Preview unavailable: no dealer IDs available for payload.");
    }

    return {
      moduleName: "CONTRACT_CENTER",
      actionType: "RESTRICTED_API",
      requestName: "Template update",
      tagId: null,
      releaseType: null,
      labels: {
        ENV: { value: ["PREPROD"] },
        TEMPLATE_ID: { value: CUSTOMER_NOTIFICATIONS_TEMPLATE_ID },
      },
      platform: "ARC",
      cluster: "ARC_DEFAULT",
      approvalEnvType: "MULTI_ENV",
      notes: { note: "Dealer Configuration :Customer Notifications" },
      metaDataByEnv: {
        PREPROD: {
          templateId: CUSTOMER_NOTIFICATIONS_TEMPLATE_ID,
          templateName: "Migrate Notifications Settings ",
          headers: {
            "Content-Type": { format: "application/json", params: [], required: true },
            "tek-sandbox-id": { format: "${tekSandboxId}", params: ["tekSandboxId"], required: false },
          },
          headerParams: { tekSandboxId: "" },
          bodyParams: {},
          preDefinedValuesParams: {},
          url: "/service-communication/r/migrate/notification/settings",
          urlParams: {},
          body: {
            format: buildCustomerNotificationsBodyFormat(tenantIdForPayload, dealerIdsForPayload),
            params: [],
          },
          tenantDealerKeys: [
            {
              tenantId: tenantIdForPayload,
              dealerIds: dealerIdsForPayload,
              runForAllDealers: false,
            },
          ],
          runForAllTenantsOfPod: false,
          runForAllDealersOfPod: false,
          podIds: null,
          runForAllDealersOfPrograms: false,
          product: "",
          programs: [],
          templateCategory: null,
        },
      },
    };
  };

  const handlePreviewPayload = () => {
    try {
      const payload = buildCustomerNotificationsPayload();
      setLastApprovalPayload(payload);
      setShowPayloadPreview(true);
      setRunState("success");
      setStatusText("Approval payload preview generated successfully.");
      setErrorText("");
    } catch (error: unknown) {
      setShowPayloadPreview(false);
      setLastApprovalPayload(null);
      setRunState("warning");
      setStatusText("Could not generate preview payload yet.");
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  };

  const submitApprovalRequest = async (): Promise<void> => {
    setIsSubmitting(true);
    setRunState("loading");
    setStatusText("Submitting approval request...");
    setErrorText("");

    try {
      const payload = buildCustomerNotificationsPayload();
      setLastApprovalPayload(payload);
      await proxyPost(APPROVAL_URL, payload, headerInfo.headers);
      setRunState("success");
      setStatusText("Approval request submitted successfully.");
      setErrorText("");
    } catch (error: unknown) {
      setRunState("error");
      setStatusText("Failed to submit approval request");
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Executive Header Card */}
      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: 18,
          display: "grid",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#f8fafc" }}>
              Dealer Configuration
            </div>
            <button
              type="button"
              onClick={() => setShowMainInfo((p) => !p)}
              style={infoButtonStyle}
              title="Toggle Information"
            >
              ℹ️
            </button>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                requestLatestCaptureFromExtension();
                setCaptureVersion((p) => p + 1);
              }}
            >
              ⟳ Refresh Headers
            </button>

            <button
              type="button"
              className="btn-postman"
              disabled={isAutoResolving || headerInfo.headerCount === 0 || !preferredTenantId || !preferredDealerId}
              onClick={() => void autoResolveTenantAndDealer()}
            >
              {isAutoResolving ? "Validating..." : "Auto-Validate Tenant + Dealer"}
            </button>
          </div>
        </div>

        {showMainInfo && (
          <div style={infoBoxStyle}>
            Uses PRODTechMOTORS API headers for authorization session tokens, while validating tenants and dealers against the currently selected profile.
          </div>
        )}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Pill label="Auth Source" value={headerInfo.source} />
          <Pill label="Headers" value={String(headerInfo.headerCount)} />
          <Pill label="Target Tenant" value={preferredTenantId || "None"} />
          <Pill label="Target Dealer" value={preferredDealerId || "None"} />
          <Pill label="Validated Tenant" value={resolvedTenantId || "Pending"} />
          <Pill label="Validated Dealer" value={resolvedVerifiedDealerId || "Pending"} />
          <Pill label="Dealers in Payload" value={String(finalDealerIds.length)} />
        </div>

        {autoSelectionMessage && (
          <div style={noticeBoxStyle}>
            {autoSelectionMessage}
          </div>
        )}

        <StatusBox runState={runState} statusText={statusText} errorText={errorText} />
      </div>

      {/* Action Toolbar / Config Buttons */}
      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: 14,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginRight: 6 }}>
          Module:
        </span>

        <button
          type="button"
          className={selectedAction === "general" ? "btn-postman" : "btn-secondary btn-sm"}
          onClick={() => setSelectedAction("general")}
        >
          General
        </button>

        <button
          type="button"
          className={selectedAction === "customer-notifications" ? "btn-postman" : "btn-secondary btn-sm"}
          onClick={() => setSelectedAction("customer-notifications")}
        >
          Customer Notifications
        </button>

        <button
          type="button"
          className={selectedAction === "dealer-details" ? "btn-postman" : "btn-secondary btn-sm"}
          onClick={() => setSelectedAction("dealer-details")}
        >
          Dealer Details
        </button>
      </div>

      {/* General Placeholder */}
      {selectedAction === "general" && (
        <SectionCard title="General Configuration">
          <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6, padding: "8px 0" }}>
            General configuration parameters for dealership setup will be configured here.
          </div>
        </SectionCard>
      )}

      {/* Dealer Details Placeholder */}
      {selectedAction === "dealer-details" && (
        <SectionCard title="Dealer Details Configuration">
          <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6, padding: "8px 0" }}>
            Dealer profile management and detailed branch settings will be configured here.
          </div>
        </SectionCard>
      )}

      {/* Customer Notifications Workflow */}
      {selectedAction === "customer-notifications" && (
        <div style={{ display: "grid", gap: 16 }}>
          {/* Step 1 */}
          <SectionCard
            title="Step 1: Auth & Headers Verification"
            infoButton={
              <button
                type="button"
                onClick={() => setShowStep1Info((p) => !p)}
                style={infoMiniButtonStyle}
                title="Header instruction"
              >
                ℹ️
              </button>
            }
          >
            {showStep1Info && (
              <div style={infoBoxStyle}>
                Trigger this endpoint in your browser to capture valid session tokens:
                <br />
                <code>https://app.tekioncloud.com/api/userservice/u/employee/profile</code>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "#cbd5e1" }}>
                Session Headers: <b>{headerInfo.headerCount} loaded</b> ({headerInfo.source})
              </span>
            </div>
          </SectionCard>

          {/* Step 2 */}
          <SectionCard title="Step 2: Tenant Validation">
            <ValidationRow
              label="Selected Profile Tenant"
              value={preferredTenantId || "Not selected"}
              state={tenantValidationState}
              reason={getValidationReason(preferredTenantId, tenantValidationState, "tenant")}
            />

            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button
                className="btn-postman"
                type="button"
                disabled={isLoadingTenants}
                onClick={() => void loadTenants()}
              >
                {isLoadingTenants ? "Loading..." : "Load Tenants"}
              </button>

              {tenants.length > 0 && (
                <div style={{ flex: 1, minWidth: 260 }}>
                  <select
                    className="st-input"
                    value={selectedTenantId}
                    onChange={(e) => {
                      setSelectedTenantId(e.target.value);
                      setSelectedDealerId("");
                      setSelectedAdditionalDealerIds([]);
                      setDealers([]);
                      setDealerValidationState("idle");
                    }}
                    style={inputStyle}
                  >
                    <option value="">Select Tenant ({tenants.length} available)</option>
                    {tenants.map((t, idx) => (
                      <option key={`${t.tenantId}-${idx}`} value={normalize(t.tenantId)}>
                        {normalize(t.tenantId)} {t.active ? "✓" : "✗"}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </SectionCard>

          {/* Step 3 */}
          <SectionCard title="Step 3: Dealer Validation & Multi-Store Selection">
            <ValidationRow
              label="Selected Profile Dealer"
              value={preferredDealerId || "Not selected"}
              state={dealerValidationState}
              reason={getValidationReason(preferredDealerId, dealerValidationState, "dealer")}
            />

            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn-postman"
                type="button"
                disabled={isLoadingDealers || !resolvedTenantId}
                onClick={() => void loadDealers()}
              >
                {isLoadingDealers ? "Loading..." : "Load Dealers for Tenant"}
              </button>
            </div>

            {dealers.length > 0 && (
              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <div style={labelStyle}>Primary Verified Dealer</div>
                  <select
                    className="st-input"
                    value={selectedDealerId}
                    onChange={(e) => {
                      setSelectedDealerId(e.target.value);
                      setSelectedAdditionalDealerIds((prev) =>
                        prev.filter((id) => id !== e.target.value)
                      );
                    }}
                    style={inputStyle}
                  >
                    <option value="">Select verified dealer</option>
                    {dealers.map((d, idx) => {
                      const id = normalize(d.dealerId);
                      const name = normalize(d.displayName || d.dealerName) || id;
                      return (
                        <option key={`${id}-${idx}`} value={id}>
                          {id} - {name} {d.active ? "✓" : "✗"}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <div style={labelStyle}>Additional Dealers Under Same Tenant</div>
                  <div
                    style={{
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(0,0,0,0.2)",
                      padding: 10,
                      display: "grid",
                      gap: 6,
                      maxHeight: 220,
                      overflowY: "auto",
                    }}
                  >
                    {dealers.map((d, idx) => {
                      const id = normalize(d.dealerId);
                      const name = normalize(d.displayName || d.dealerName) || id;
                      const disabled = !id || id === resolvedVerifiedDealerId;
                      const checked = selectedAdditionalDealerIds.includes(id);

                      return (
                        <label
                          key={`${id}-${idx}-chk`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            color: disabled ? "#64748b" : "#cbd5e1",
                            fontSize: 12,
                            cursor: disabled ? "default" : "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedAdditionalDealerIds((prev) =>
                                  Array.from(new Set([...prev, id]))
                                );
                              } else {
                                setSelectedAdditionalDealerIds((prev) =>
                                  prev.filter((item) => item !== id)
                                );
                              }
                            }}
                          />
                          <span>
                            {id} - {name} {d.active ? "✓" : "✗"}
                            {id === resolvedVerifiedDealerId ? " (Primary)" : ""}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div style={{ fontSize: 12, color: "#94a3b8" }}>
                  Selected Store IDs:{" "}
                  <b style={{ color: "#f8fafc" }}>
                    {finalDealerIds.length > 0 ? finalDealerIds.join(", ") : "None"}
                  </b>
                </div>
              </div>
            )}
          </SectionCard>

          {/* Step 4 */}
          <SectionCard title="Step 4: Execute Request">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn-postman"
                type="button"
                disabled={isSubmitting || !canPreviewPayload}
                onClick={() => void submitApprovalRequest()}
              >
                {isSubmitting ? "Submitting..." : "Raise Customer Notifications Request"}
              </button>

              <button
                className="btn-secondary btn-sm"
                type="button"
                onClick={handlePreviewPayload}
                disabled={!canPreviewPayload}
              >
                {showPayloadPreview ? "Refresh Preview" : "Preview Payload"}
              </button>
            </div>

            {!canPreviewPayload && (
              <div style={{ color: "#fca5a5", fontSize: 11 }}>
                * Tenant and verified dealer must be confirmed before submitting.
              </div>
            )}
          </SectionCard>

          {/* JSON Payload Inspection Drawer */}
          {showPayloadPreview && lastApprovalPayload && (
            <SectionCard title="Approval Payload Preview">
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 10,
                  background: "#0b0f19",
                  color: "#86efac",
                  overflow: "auto",
                  fontSize: 11,
                  fontFamily: "monospace",
                  maxHeight: 320,
                }}
              >
                {JSON.stringify(lastApprovalPayload, null, 2)}
              </pre>
            </SectionCard>
          )}

          {/* Results Table */}
          {dealers.length > 0 && (
            <SectionCard title={`Loaded Dealers (${dealers.length})`}>
              <div style={{ overflowX: "auto", maxHeight: 360 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 800 }}>
                  <thead style={{ position: "sticky", top: 0, background: "#18181b", zIndex: 1 }}>
                    <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                      <th style={thStyle}>#</th>
                      <th style={thStyle}>Tenant ID</th>
                      <th style={thStyle}>Dealer ID</th>
                      <th style={thStyle}>Display Name</th>
                      <th style={thStyle}>Active</th>
                      <th style={thStyle}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dealers.map((dealer, index) => {
                      const id = normalize(dealer.dealerId);
                      const isPrimary = id === resolvedVerifiedDealerId;
                      const isIncluded = finalDealerIds.includes(id);

                      return (
                        <tr
                          key={`${dealer.tenantId}-${id}-${index}`}
                          style={{
                            borderTop: "1px solid rgba(255,255,255,0.06)",
                            background: isPrimary
                              ? "rgba(34,197,94,0.05)"
                              : isIncluded
                              ? "rgba(59,130,246,0.05)"
                              : "transparent",
                          }}
                        >
                          <td style={tdStyle}>{index + 1}</td>
                          <td style={tdMonoStyle}>{normalize(dealer.tenantId) || "—"}</td>
                          <td style={{ ...tdMonoStyle, fontWeight: isPrimary ? 800 : 400, color: isPrimary ? "#86efac" : "#e2e8f0" }}>
                            {id || "—"}
                          </td>
                          <td style={tdStyle}>
                            {normalize(dealer.displayName || dealer.dealerName) || "—"}
                          </td>
                          <td style={tdStyle}>{dealer.active ? "Yes" : "No"}</td>
                          <td style={tdStyle}>
                            {isPrimary ? (
                              <span style={validatedBadgeStyle}>✓ Primary</span>
                            ) : isIncluded ? (
                              <span style={loadingBadgeStyle}>Included</span>
                            ) : (
                              <span style={neutralBadgeStyle}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </div>
      )}
    </div>
  );
};

const infoButtonStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 999,
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#94a3b8",
  fontSize: 12,
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
};

const infoMiniButtonStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 999,
  background: "transparent",
  border: "none",
  color: "#94a3b8",
  fontSize: 12,
  cursor: "pointer",
};

const infoBoxStyle: React.CSSProperties = {
  padding: 10,
  borderRadius: 8,
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.06)",
  color: "#94a3b8",
  fontSize: 12,
  lineHeight: 1.5,
};

const noticeBoxStyle: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid rgba(59,130,246,0.22)",
  background: "rgba(59,130,246,0.10)",
  color: "#bfdbfe",
  padding: "8px 12px",
  fontSize: 12,
  whiteSpace: "pre-wrap",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 38,
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 11,
  fontWeight: 700,
  marginBottom: 4,
  textTransform: "uppercase",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  color: "#94a3b8",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px",
  color: "#e2e8f0",
  fontSize: 12,
  verticalAlign: "middle",
};

const tdMonoStyle: React.CSSProperties = {
  ...tdStyle,
  fontFamily: "ui-monospace, monospace",
};

const validatedBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  padding: "2px 8px",
  borderRadius: 999,
  color: "#86efac",
  border: "1px solid rgba(34,197,94,0.3)",
  background: "rgba(34,197,94,0.12)",
  fontSize: 10,
  fontWeight: 800,
};

const neutralBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  padding: "2px 8px",
  borderRadius: 999,
  color: "#64748b",
  fontSize: 11,
};

const loadingBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  padding: "2px 8px",
  borderRadius: 999,
  color: "#93c5fd",
  border: "1px solid rgba(59,130,246,0.3)",
  background: "rgba(59,130,246,0.12)",
  fontSize: 10,
  fontWeight: 800,
};

const invalidBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  padding: "2px 8px",
  borderRadius: 999,
  color: "#fca5a5",
  border: "1px solid rgba(239,68,68,0.3)",
  background: "rgba(239,68,68,0.12)",
  fontSize: 10,
  fontWeight: 800,
};

const Pill: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "4px 8px",
      borderRadius: 999,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.03)",
      color: "#cbd5e1",
      fontSize: 11,
    }}
  >
    {label}: <b style={{ color: "#f8fafc" }}>{value}</b>
  </span>
);

const SectionCard: React.FC<{
  title: string;
  infoButton?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, infoButton, children }) => (
  <div
    style={{
      borderRadius: 16,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.03)",
      padding: 16,
      display: "grid",
      gap: 12,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: "#f8fafc" }}>{title}</div>
      {infoButton}
    </div>
    {children}
  </div>
);

const StatusBox: React.FC<{
  runState: RunState;
  statusText: string;
  errorText: string;
}> = ({ runState, statusText, errorText }) => {
  if (runState === "idle" && !errorText) return null;

  const style =
    runState === "error"
      ? { border: "rgba(239,68,68,0.25)", bg: "rgba(239,68,68,0.1)", text: "#fecaca" }
      : runState === "success"
      ? { border: "rgba(34,197,94,0.25)", bg: "rgba(34,197,94,0.1)", text: "#bbf7d0" }
      : runState === "warning"
      ? { border: "rgba(245,158,11,0.25)", bg: "rgba(245,158,11,0.1)", text: "#fde68a" }
      : { border: "rgba(59,130,246,0.25)", bg: "rgba(59,130,246,0.1)", text: "#bfdbfe" };

  return (
    <div
      style={{
        borderRadius: 10,
        padding: "10px 12px",
        fontSize: 12,
        border: `1px solid ${style.border}`,
        background: style.bg,
        color: style.text,
      }}
    >
      <div style={{ fontWeight: 700 }}>{statusText}</div>
      {errorText && <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{errorText}</div>}
    </div>
  );
};

const ValidationRow: React.FC<{
  label: string;
  value: string;
  state: ValidationState;
  reason: string;
}> = ({ label, value, state, reason }) => {
  const isMatched = state === "matched";
  const isNotFound = state === "not-found";
  const isLoading = state === "loading";

  return (
    <div
      style={{
        display: "grid",
        gap: 4,
        padding: "8px 10px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700 }}>{label}:</span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 800,
            color: isMatched
              ? "#86efac"
              : isNotFound
              ? "#fca5a5"
              : isLoading
              ? "#93c5fd"
              : "#f8fafc",
          }}
        >
          {value}
        </span>

        {isMatched ? (
          <span style={validatedBadgeStyle}>✓ Validated</span>
        ) : isNotFound ? (
          <span style={invalidBadgeStyle}>✕ Not found</span>
        ) : isLoading ? (
          <span style={loadingBadgeStyle}>Loading...</span>
        ) : (
          <span style={neutralBadgeStyle}>Waiting</span>
        )}
      </div>

      <div style={{ color: "#94a3b8", fontSize: 11 }}>{reason}</div>
    </div>
  );
};

export default DealerConfigView;