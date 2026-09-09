import React, { useEffect, useMemo, useState } from "react";
import {
  loadTekionApiSettingsBundle,
  getSelectedDealerProfileId,
} from "../../../services/tekionApiSettings";
import {
  loadLatestExtensionCapture,
  requestLatestCaptureFromExtension,
  subscribeToExtensionCapture,
  type ArcTekionProfile,
} from "../../../services/extensionBridge";
import type { KeyValuePair } from "../../../types/proxy.types";

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

type ActionKey = "customer-notifications";

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

  logger.debug("proxy http status", response.status);

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
  const dealerIdLines = dealerIds.map((dealerId) => ` "${dealerId}"`).join(",\n");

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
   {
    "notificationType": "APPOINTMENT_CONFIRMATION",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "APPOINTMENT_RESCHEDULED",
    "communicationChannelType": "SERVICE_MAINTENANCE",
    "override": true
   },
   {
    "notificationType": "APPOINTMENT_REMINDER",
    "communicationChannelType": "SERVICE_MAINTENANCE",
    "override": true
   },
   {
    "notificationType": "APPOINTMENT_CANCELLATION",
    "communicationChannelType": "SERVICE_MAINTENANCE",
    "override": true
   },
   {
    "notificationType": "APPOINTMENT_CONSUMER_SCHEDULING_OTP",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "APPOINTMENT_CONCIERGE_PICKUP",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "APPOINTMENT_CONFIRMATION_CONCIERGE",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "APPOINTMENT_RESCHEDULE_CONCIERGE",
    "communicationChannelType": "SERVICE_MAINTENANCE",
    "override": true
   },
   {
    "notificationType": "APPOINTMENT_REMINDER_CONCIERGE",
    "communicationChannelType": "SERVICE_MAINTENANCE",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_CREATED",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_INVOICED",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_DRAFT_RO_PAID",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_REVISED_ESTIMATE",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_RECOMMENDATION_SEND_TO_CUSTOMER",
    "communicationChannelType": "SERVICE_MAINTENANCE",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_CUSTOMER_PAY_CLOSED",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_CONSUMER_PORTAL_OTP",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_MPVI_VIDEO_ATTACHED",
    "communicationChannelType": "SERVICE_MAINTENANCE",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_SEND_UPLOAD_LINK",
    "communicationChannelType": "SERVICE_MAINTENANCE",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_SA_RETURNED_KEYS",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_DRAFT_CREATED",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_DRAFT_INVOICED",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_PDF_INVOICE_CUSTOMER",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_PDF_DAMAGES_CUSTOMER",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_PDF_INSPECTIONS_AND_RECOMMENDATIONS_CUSTOMER",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_PDF_SERVICE_BOOKLET_OEM_SERVICE_BOOKLET",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_PDF_VIS_CUSTOMER",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_PDF_ESTIMATE_CUSTOMER",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_PDF_INVOICE_DAY_COLLECTION_REPORT",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_PDF_INVOICE_COLLECTION_SLIP",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "QUOTES_PDF_ESTIMATE",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_PDF_SERVICE_HISTORY_INVOICE_BULK",
    "communicationChannelType": "SERVICE_MAINTENANCE",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_PDF_SERVICE_HISTORY_RECAP",
    "communicationChannelType": "CUSTOMER_SATISFACTION",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_PAYMENT_LINK",
    "communicationChannelType": "SERVICE_MAINTENANCE",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_BULK_DOWNLOAD",
    "communicationChannelType": "SERVICE_MAINTENANCE",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_PDF_ESIGN",
    "communicationChannelType": "SERVICE_MAINTENANCE",
    "override": true
   },
   {
    "notificationType": "CONSUMER_PORTAL_RESEND_LINK",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "CONSUMER_KEYLOUNGE_OTP",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   },
   {
    "notificationType": "REPAIR_ORDER_INSPECTIONS_AND_RECOMMENDATIONS_CUSTOMER",
    "communicationChannelType": "DEALERSHIP_BUSINESS",
    "override": true
   }
  ]
 }
}`;
}

export const DealerConfigView: React.FC = () => {
  const [selectedAction, setSelectedAction] =
    useState<ActionKey>("customer-notifications");

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
      logger.info("window focus -> refreshing extension capture snapshot");
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

    logger.group("headerInfo recomputed");
    logger.debug("source", source);
    logger.debug("header count", Object.keys(headers).length);
    logger.debug("header keys", Object.keys(headers).sort());
    logger.groupEnd();

    return {
      headers,
      source,
      headerCount: Object.keys(headers).length,
    };
  }, [captureVersion]);

  const selectedDealerProfile = useMemo(() => {
    const profile = loadSelectedDealerProfileFromCapture();

    logger.group("selectedDealerProfile recomputed");
    logger.debug("selected profile id", getSelectedDealerProfileId());
    logger.debug("profile", profile);
    logger.groupEnd();

    return profile;
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

  useEffect(() => {
    logger.group("validation snapshot");
    logger.debug("preferredTenantId", preferredTenantId);
    logger.debug("preferredDealerId", preferredDealerId);
    logger.debug("selectedTenantId", selectedTenantId);
    logger.debug("selectedDealerId", selectedDealerId);
    logger.debug("selectedAdditionalDealerIds", selectedAdditionalDealerIds);
    logger.debug("resolvedTenantId", resolvedTenantId);
    logger.debug("resolvedVerifiedDealerId", resolvedVerifiedDealerId);
    logger.debug("finalDealerIds", finalDealerIds);
    logger.debug("tenants loaded", tenants.length);
    logger.debug("dealers loaded", dealers.length);
    logger.debug("tenantValidationState", tenantValidationState);
    logger.debug("dealerValidationState", dealerValidationState);
    logger.debug("canPreviewPayload", canPreviewPayload);
    logger.groupEnd();
  }, [
    preferredTenantId,
    preferredDealerId,
    selectedTenantId,
    selectedDealerId,
    selectedAdditionalDealerIds,
    resolvedTenantId,
    resolvedVerifiedDealerId,
    finalDealerIds,
    tenants.length,
    dealers.length,
    tenantValidationState,
    dealerValidationState,
    canPreviewPayload,
  ]);

  const loadTenants = async (): Promise<TenantInfo[]> => {
    logger.group("loadTenants start");

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

      logger.debug("using auth header source", headerInfo.source);
      logger.debug("selected profile tenant target", preferredTenantId);
      logger.debug("selected profile dealer target", preferredDealerId);

      const body = {
        envPod: [{ env: "PREPROD", pod: null }],
        platform: "ARC",
      };

      const response = (await proxyPost(
        TENANTS_URL,
        body,
        headerInfo.headers
      )) as TenantsResponse;

      logger.debug("tenants response", response);

      const tenantInfos =
        response.data?.flatMap((item) => item.tenantInfos ?? []) ?? [];

      setTenants(tenantInfos);

      const matchedTenant = preferredTenantId
        ? tenantInfos.find((tenant) => normalize(tenant.tenantId) === preferredTenantId) ?? null
        : null;

      logger.debug("matchedTenant", matchedTenant);

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
      logger.error("load tenants failed", error);
      setTenantValidationState(preferredTenantId ? "not-found" : "idle");
      setRunState("error");
      setStatusText("Failed to load tenants");
      setErrorText(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setIsLoadingTenants(false);
      logger.groupEnd();
    }
  };

  const loadDealers = async (tenantIdOverride?: string): Promise<DealerInfo[]> => {
    logger.group("loadDealers start");

    setIsLoadingDealers(true);
    setDealerValidationState(preferredDealerId ? "loading" : "idle");
    setRunState("loading");
    setStatusText("Loading dealers...");
    setErrorText("");

    try {
      const tenantIdForRequest = normalize(tenantIdOverride) || resolvedTenantId;

      logger.debug("tenantIdForRequest", tenantIdForRequest);
      logger.debug("selected profile dealer target", preferredDealerId);

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

      logger.debug("dealers response", response);

      const dealerRows = response.data?.PREPROD ?? [];
      setDealers(dealerRows);
      setSelectedDealerId("");
      setSelectedAdditionalDealerIds([]);

      const matchedDealer = preferredDealerId
        ? dealerRows.find((dealer) => normalize(dealer.dealerId) === preferredDealerId) ?? null
        : null;

      logger.debug("matchedDealer", matchedDealer);

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
      logger.error("load dealers failed", error);
      setDealerValidationState(preferredDealerId ? "not-found" : "idle");
      setRunState("error");
      setStatusText("Failed to load dealers");
      setErrorText(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setIsLoadingDealers(false);
      logger.groupEnd();
    }
  };

  const autoResolveTenantAndDealer = async (): Promise<void> => {
    logger.group("autoResolveTenantAndDealer");

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
      logger.info("validated tenant from Step 2", validatedTenantId);

      const dealerRows = await loadDealers(validatedTenantId);

      const matchedDealer =
        dealerRows.find((dealer) => normalize(dealer.dealerId) === preferredDealerId) ?? null;

      if (!matchedDealer?.dealerId) {
        throw new Error(
          `Selected profile dealer "${preferredDealerId}" not found in dealers API response for tenant "${validatedTenantId}".`
        );
      }

      const validatedDealerId = normalize(matchedDealer.dealerId);
      logger.info("validated dealer from Step 3", validatedDealerId);

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
      logger.error("autoResolveTenantAndDealer failed", error);
      setRunState("error");
      setStatusText("Auto-validation failed");
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setIsAutoResolving(false);
      logger.groupEnd();
    }
  };

  const buildCustomerNotificationsPayload = (): Record<string, unknown> => {
    const tenantIdForPayload = resolvedTenantId;
    const verifiedDealerId = resolvedVerifiedDealerId;
    const dealerIdsForPayload = finalDealerIds;

    logger.group("buildCustomerNotificationsPayload");
    logger.debug("tenantIdForPayload", tenantIdForPayload);
    logger.debug("verifiedDealerId", verifiedDealerId);
    logger.debug("dealerIdsForPayload", dealerIdsForPayload);

    if (!tenantIdForPayload) {
      logger.groupEnd();
      throw new Error("Preview unavailable: tenant is not selected or validated yet.");
    }

    if (!verifiedDealerId) {
      logger.groupEnd();
      throw new Error("Preview unavailable: verified dealer is not selected or validated yet.");
    }

    if (dealerIdsForPayload.length === 0) {
      logger.groupEnd();
      throw new Error("Preview unavailable: no dealer IDs available for payload.");
    }

    const payload = {
      moduleName: "CONTRACT_CENTER",
      actionType: "RESTRICTED_API",
      requestName: "Template update",
      tagId: null,
      releaseType: null,
      labels: {
        ENV: {
          value: ["PREPROD"],
        },
        TEMPLATE_ID: {
          value: CUSTOMER_NOTIFICATIONS_TEMPLATE_ID,
        },
      },
      platform: "ARC",
      cluster: "ARC_DEFAULT",
      approvalEnvType: "MULTI_ENV",
      notes: {
        note: "Dealer Configuration :Customer Notifications",
      },
      metaDataByEnv: {
        PREPROD: {
          templateId: CUSTOMER_NOTIFICATIONS_TEMPLATE_ID,
          templateName: "Migrate Notifications Settings ",
          headers: {
            "Content-Type": {
              format: "application/json",
              params: [],
              required: true,
            },
            "tek-sandbox-id": {
              format: "${tekSandboxId}",
              params: ["tekSandboxId"],
              required: false,
            },
          },
          headerParams: {
            tekSandboxId: "",
          },
          bodyParams: {},
          preDefinedValuesParams: {},
          url: "/service-communication/r/migrate/notification/settings",
          urlParams: {},
          body: {
            format: buildCustomerNotificationsBodyFormat(
              tenantIdForPayload,
              dealerIdsForPayload
            ),
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

    logger.debug("payload built successfully", payload);
    logger.groupEnd();
    return payload;
  };

  const handlePreviewPayload = () => {
    logger.group("handlePreviewPayload");

    try {
      const payload = buildCustomerNotificationsPayload();
      setLastApprovalPayload(payload);
      setShowPayloadPreview(true);
      setRunState("success");
      setStatusText("Approval payload preview generated successfully.");
      setErrorText("");
      logger.info("preview payload generated");
    } catch (error: unknown) {
      setShowPayloadPreview(false);
      setLastApprovalPayload(null);
      setRunState("warning");
      setStatusText("Could not generate preview payload yet.");
      setErrorText(error instanceof Error ? error.message : String(error));
      logger.warn("preview payload failed", error);
    } finally {
      logger.groupEnd();
    }
  };

  const submitApprovalRequest = async (): Promise<void> => {
    logger.group("submitApprovalRequest");

    setIsSubmitting(true);
    setRunState("loading");
    setStatusText("Submitting approval request...");
    setErrorText("");

    try {
      const payload = buildCustomerNotificationsPayload();
      setLastApprovalPayload(payload);

      const response = await proxyPost(APPROVAL_URL, payload, headerInfo.headers);
      logger.debug("approval response", response);

      setRunState("success");
      setStatusText("Approval request submitted successfully.");
      setErrorText("");
    } catch (error: unknown) {
      logger.error("submit approval request failed", error);
      setRunState("error");
      setStatusText("Failed to submit approval request");
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
      logger.groupEnd();
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div
        style={{
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: 18,
        }}
      >
        <div
          style={{
            color: "#f8fafc",
            fontSize: 22,
            fontWeight: 800,
            marginBottom: 6,
          }}
        >
          Dealer Config
        </div>

        <div style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.7 }}>
          Uses PRODTechMOTORS API headers for authentication and selected dealer profile
          values for tenant/dealer validation.
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <Pill label="Header Source" value={headerInfo.source} />
          <Pill label="Header Count" value={String(headerInfo.headerCount)} />
          <Pill label="Selected Profile Tenant" value={preferredTenantId || "Not selected"} />
          <Pill label="Selected Profile Dealer" value={preferredDealerId || "Not selected"} />
          <Pill label="Resolved Tenant" value={resolvedTenantId || "Pending"} />
          <Pill
            label="Verified Dealer"
            value={resolvedVerifiedDealerId || "Pending"}
          />
          <Pill label="Final Dealer IDs" value={String(finalDealerIds.length)} />
        </div>

        {autoSelectionMessage ? (
          <div
            style={{
              marginTop: 12,
              borderRadius: 12,
              border: "1px solid rgba(59,130,246,0.22)",
              background: "rgba(59,130,246,0.10)",
              color: "#bfdbfe",
              padding: "10px 12px",
              fontSize: 13,
              whiteSpace: "pre-wrap",
            }}
          >
            {autoSelectionMessage}
          </div>
        ) : null}
      </div>

      <StatusBox runState={runState} statusText={statusText} errorText={errorText} />

      <SectionCard title="Button 1 - Customer Notifications">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className={selectedAction === "customer-notifications" ? "btn-postman" : "btn-secondary btn-sm"}
            onClick={() => setSelectedAction("customer-notifications")}
          >
            Customer Notifications
          </button>
        </div>

        <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.7 }}>
          Migrates customer notification settings for the validated tenant and selected
          dealer IDs within that tenant.
        </div>
      </SectionCard>

      {selectedAction === "customer-notifications" ? (
        <>
          <SectionCard title="Step 1 - Capture / Refresh Headers">
            <div style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.7 }}>
              Trigger this API in browser:
              <br />
              <code>https://app.tekioncloud.com/api/userservice/u/employee/profile</code>
              <br />
              These headers are used for authentication/session while selected profile
              tenant/dealer are used for validation.
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn-secondary btn-sm"
                type="button"
                onClick={() => {
                  logger.info("manual refresh captured headers clicked");
                  requestLatestCaptureFromExtension();
                  setCaptureVersion((prev) => prev + 1);
                }}
              >
                Refresh Captured Headers
              </button>

              <button
                className="btn-postman"
                type="button"
                disabled={
                  isAutoResolving ||
                  headerInfo.headerCount === 0 ||
                  !preferredTenantId ||
                  !preferredDealerId
                }
                onClick={() => {
                  void autoResolveTenantAndDealer();
                }}
              >
                {isAutoResolving ? "Auto Validating..." : "Auto Validate Tenant + Dealer"}
              </button>
            </div>
          </SectionCard>

          <SectionCard title="Step 2 - Load Tenants">
            <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.6 }}>
              Validating tenant is mandatory. Selected profile tenant must exist in tenant
              results.
            </div>

            <ValidationRow
              label="Selected profile tenant target"
              value={preferredTenantId || "Not selected"}
              state={tenantValidationState}
              reason={getValidationReason(preferredTenantId, tenantValidationState, "tenant")}
            />

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn-postman"
                type="button"
                disabled={isLoadingTenants}
                onClick={() => {
                  void loadTenants();
                }}
              >
                {isLoadingTenants ? "Loading..." : "Load Tenants"}
              </button>
            </div>

            {tenants.length > 0 ? (
              <div>
                <div style={labelStyle}>Tenant</div>
                <select
                  className="st-input"
                  value={selectedTenantId}
                  onChange={(e) => {
                    logger.info("manual tenant selection changed", e.target.value);
                    setSelectedTenantId(e.target.value);
                    setSelectedDealerId("");
                    setSelectedAdditionalDealerIds([]);
                    setDealers([]);
                    setDealerValidationState("idle");
                  }}
                  style={inputStyle}
                >
                  <option value="">Select tenant</option>
                  {tenants.map((tenant, index) => {
                    const tenantId = normalize(tenant.tenantId);
                    return (
                      <option key={`${tenantId}-${index}`} value={tenantId}>
                        {tenantId} {tenant.active ? "✅" : "❌"}
                      </option>
                    );
                  })}
                </select>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title="Step 3 - Load Dealers for Selected Tenant">
            <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.6 }}>
              Validating dealer is mandatory. First validate the selected profile dealer.
              After that, you may optionally add more dealer IDs from the same tenant.
            </div>

            <ValidationRow
              label="Selected profile dealer target"
              value={preferredDealerId || "Not selected"}
              state={dealerValidationState}
              reason={getValidationReason(preferredDealerId, dealerValidationState, "dealer")}
            />

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn-postman"
                type="button"
                disabled={isLoadingDealers || !resolvedTenantId}
                onClick={() => {
                  void loadDealers();
                }}
              >
                {isLoadingDealers ? "Loading..." : "Load Dealers"}
              </button>
            </div>

            {dealers.length > 0 ? (
              <div style={{ display: "grid", gap: 14 }}>
                <div>
                  <div style={labelStyle}>Verified Dealer</div>
                  <select
                    className="st-input"
                    value={selectedDealerId}
                    onChange={(e) => {
                      logger.info("manual verified dealer selection changed", e.target.value);
                      setSelectedDealerId(e.target.value);
                      setSelectedAdditionalDealerIds((prev) =>
                        prev.filter((id) => id !== e.target.value)
                      );
                    }}
                    style={inputStyle}
                  >
                    <option value="">Select verified dealer</option>
                    {dealers.map((dealer, index) => {
                      const dealerId = normalize(dealer.dealerId);
                      const displayName =
                        normalize(dealer.displayName || dealer.dealerName) || dealerId;
                      return (
                        <option key={`${dealerId}-${index}`} value={dealerId}>
                          {dealerId} - {displayName} {dealer.active ? "✅" : "❌"}
                        </option>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <div style={labelStyle}>Additional Dealers Under Same Tenant</div>
                  <div
                    style={{
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.08)",
                      background: "rgba(255,255,255,0.02)",
                      padding: 12,
                      display: "grid",
                      gap: 8,
                      maxHeight: 260,
                      overflowY: "auto",
                    }}
                  >
                    {dealers.map((dealer, index) => {
                      const dealerId = normalize(dealer.dealerId);
                      const displayName =
                        normalize(dealer.displayName || dealer.dealerName) || dealerId;
                      const disabled = !dealerId || dealerId === resolvedVerifiedDealerId;
                      const checked = selectedAdditionalDealerIds.includes(dealerId);

                      return (
                        <label
                          key={`${dealerId}-${index}-extra`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 10,
                            color: disabled ? "#64748b" : "#e2e8f0",
                            fontSize: 13,
                          }}
                        >
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={checked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedAdditionalDealerIds((prev) =>
                                  Array.from(new Set([...prev, dealerId]))
                                );
                              } else {
                                setSelectedAdditionalDealerIds((prev) =>
                                  prev.filter((id) => id !== dealerId)
                                );
                              }
                            }}
                          />
                          <span>
                            {dealerId} - {displayName} {dealer.active ? "✅" : "❌"}
                            {dealerId === resolvedVerifiedDealerId ? " (verified dealer)" : ""}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div style={{ color: "#94a3b8", fontSize: 12, lineHeight: 1.6 }}>
                  Final payload dealer IDs:{" "}
                  <span style={{ color: "#f8fafc", fontWeight: 800 }}>
                    {finalDealerIds.length > 0 ? finalDealerIds.join(", ") : "—"}
                  </span>
                </div>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title="Step 4 - Raise Request">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn-postman"
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  void submitApprovalRequest();
                }}
              >
                {isSubmitting ? "Submitting..." : "Raise Customer Notifications Request"}
              </button>

              <button
                className="btn-secondary btn-sm"
                type="button"
                onClick={handlePreviewPayload}
                disabled={!canPreviewPayload}
              >
                {showPayloadPreview ? "Refresh Preview Payload" : "Preview Payload"}
              </button>
            </div>

            <div style={{ color: canPreviewPayload ? "#86efac" : "#94a3b8", fontSize: 12 }}>
              Preview readiness:{" "}
              {canPreviewPayload
                ? "Ready ✅"
                : "Waiting for validated tenant, validated dealer, and final dealer list"}
            </div>
          </SectionCard>

          {showPayloadPreview && lastApprovalPayload ? (
            <SectionCard title="Approval Payload Preview">
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  borderRadius: 12,
                  background: "#0f172a",
                  color: "#e2e8f0",
                  overflow: "auto",
                  fontSize: 12,
                  whiteSpace: "pre-wrap",
                }}
              >
                {JSON.stringify(lastApprovalPayload, null, 2)}
              </pre>
            </SectionCard>
          ) : null}

          {dealers.length > 0 ? (
            <SectionCard title={`Dealer Results (${dealers.length})`}>
              <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: "420px" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 920 }}>
                  <thead>
                    <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                      <th style={thStyle}>#</th>
                      <th style={thStyle}>Tenant ID</th>
                      <th style={thStyle}>Dealer ID</th>
                      <th style={thStyle}>Display Name</th>
                      <th style={thStyle}>Active</th>
                      <th style={thStyle}>Verified Match</th>
                      <th style={thStyle}>Included In Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dealers.map((dealer, index) => {
                      const dealerId = normalize(dealer.dealerId);
                      const isVerifiedMatch =
                        Boolean(preferredDealerId) && dealerId === preferredDealerId;
                      const isIncluded = finalDealerIds.includes(dealerId);

                      return (
                        <tr
                          key={`${dealer.tenantId}-${dealer.dealerId}-${index}`}
                          style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
                        >
                          <td style={tdStyle}>{index + 1}</td>
                          <td style={tdMonoStyle}>{normalize(dealer.tenantId) || "—"}</td>
                          <td style={tdMonoStyle}>{dealerId || "—"}</td>
                          <td style={tdStyle}>
                            {normalize(dealer.displayName || dealer.dealerName) || "—"}
                          </td>
                          <td style={tdStyle}>{dealer.active ? "Yes" : "No"}</td>
                          <td style={tdStyle}>
                            {isVerifiedMatch ? (
                              <span style={validatedBadgeStyle}>✓ Verified</span>
                            ) : (
                              <span style={neutralBadgeStyle}>—</span>
                            )}
                          </td>
                          <td style={tdStyle}>
                            {isIncluded ? (
                              <span style={validatedBadgeStyle}>✓ Included</span>
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
          ) : null}
        </>
      ) : null}
    </div>
  );
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 42,
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 13,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 6,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 10px",
  color: "#cbd5e1",
  fontSize: 12,
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 10px",
  color: "#e2e8f0",
  fontSize: 13,
  verticalAlign: "top",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const tdMonoStyle: React.CSSProperties = {
  ...tdStyle,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

const validatedBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 10px",
  borderRadius: 999,
  color: "#86efac",
  border: "1px solid rgba(34,197,94,0.35)",
  background: "rgba(34,197,94,0.12)",
  boxShadow: "0 0 12px rgba(34,197,94,0.22)",
  fontSize: 12,
  fontWeight: 800,
};

const neutralBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  borderRadius: 999,
  color: "#94a3b8",
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  fontSize: 12,
  fontWeight: 700,
};

const loadingBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  borderRadius: 999,
  color: "#93c5fd",
  border: "1px solid rgba(59,130,246,0.30)",
  background: "rgba(59,130,246,0.10)",
  fontSize: 12,
  fontWeight: 800,
};

const invalidBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "4px 10px",
  borderRadius: 999,
  color: "#fca5a5",
  border: "1px solid rgba(239,68,68,0.30)",
  background: "rgba(239,68,68,0.10)",
  fontSize: 12,
  fontWeight: 800,
};

const Pill: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 10px",
      borderRadius: 999,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.03)",
      color: "#cbd5e1",
      fontSize: 12,
    }}
  >
    {label} <b style={{ color: "#f8fafc" }}>{value}</b>
  </span>
);

const SectionCard: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div
    style={{
      borderRadius: 18,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.03)",
      padding: 18,
      display: "grid",
      gap: 12,
    }}
  >
    <div
      style={{
        fontSize: 18,
        fontWeight: 800,
        color: "#f8fafc",
      }}
    >
      {title}
    </div>
    {children}
  </div>
);

const StatusBox: React.FC<{
  runState: RunState;
  statusText: string;
  errorText: string;
}> = ({ runState, statusText, errorText }) => (
  <div
    style={{
      borderRadius: 14,
      padding: "12px 14px",
      fontSize: 13,
      lineHeight: 1.6,
      border:
        runState === "error"
          ? "1px solid rgba(239,68,68,0.25)"
          : runState === "success"
          ? "1px solid rgba(34,197,94,0.25)"
          : runState === "warning"
          ? "1px solid rgba(245,158,11,0.25)"
          : runState === "loading"
          ? "1px solid rgba(59,130,246,0.25)"
          : "1px solid rgba(255,255,255,0.08)",
      background:
        runState === "error"
          ? "rgba(239,68,68,0.10)"
          : runState === "success"
          ? "rgba(34,197,94,0.10)"
          : runState === "warning"
          ? "rgba(245,158,11,0.10)"
          : runState === "loading"
          ? "rgba(59,130,246,0.10)"
          : "rgba(255,255,255,0.03)",
      color:
        runState === "error"
          ? "#fecaca"
          : runState === "success"
          ? "#bbf7d0"
          : runState === "warning"
          ? "#fde68a"
          : runState === "loading"
          ? "#bfdbfe"
          : "#cbd5e1",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
    }}
  >
    <div style={{ fontWeight: 700, marginBottom: errorText ? 6 : 0 }}>{statusText}</div>
    {errorText ? <div>{errorText}</div> : null}
  </div>
);

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
        gap: 8,
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <div style={{ color: "#94a3b8", fontSize: 12, fontWeight: 700 }}>{label}:</div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 800,
            color: isMatched
              ? "#86efac"
              : isNotFound
              ? "#fca5a5"
              : isLoading
              ? "#93c5fd"
              : "#f8fafc",
            textShadow: isMatched ? "0 0 10px rgba(34,197,94,0.28)" : "none",
          }}
        >
          {value}
        </div>

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

      <div style={{ color: "#94a3b8", fontSize: 12 }}>{reason}</div>
    </div>
  );
};

export default DealerConfigView;
