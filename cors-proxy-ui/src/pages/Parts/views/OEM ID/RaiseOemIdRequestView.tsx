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
const TEMPLATE_ID = "9392abe9-2ded-42cc-88b5-f84343078ff8";

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
  displayName?: string;
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
    console.info("[Parts][RaiseOemIdRequestView]", ...args),
  warn: (...args: unknown[]) =>
    console.warn("[Parts][RaiseOemIdRequestView]", ...args),
  error: (...args: unknown[]) =>
    console.error("[Parts][RaiseOemIdRequestView]", ...args),
  debug: (...args: unknown[]) =>
    console.debug("[Parts][RaiseOemIdRequestView]", ...args),
  group: (label: string, ...args: unknown[]) =>
    console.group(`[Parts][RaiseOemIdRequestView] ${label}`, ...args),
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
      headers: { ...captured, "content-type": "application/json" },
      source: "captured-prodtechmotors",
    };
  }

  const global = getEnabledGlobalHeaders();

  return {
    headers: { ...global, "content-type": "application/json" },
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
  return capture?.tekionProfiles?.find((item) => item.id === selectedProfileId) ?? null;
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
    headers: { "Content-Type": "application/json" },
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

function buildApprovalBodyFormat(oemCodes: string[]): string {
  return `{\n "oemDealerCodes": [\n${oemCodes
    .map((code) => ` "${code}"`)
    .join(",\n")}\n ]\n}`;
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
  return kind === "tenant"
    ? "Waiting to call tenants API."
    : "Waiting to call dealers API.";
}

const InfoIcon: React.FC<{ text: React.ReactNode }> = ({ text }) => {
  const [visible, setVisible] = useState(false);

  return (
    <div
      style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      <button
        type="button"
        aria-label="More info"
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.04)",
          color: "#94a3b8",
          fontSize: 11,
          fontWeight: 800,
          cursor: "help",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
        }}
      >
        i
      </button>

      {visible ? (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            zIndex: 20,
            width: 300,
            maxWidth: "min(300px, 80vw)",
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "#0f172a",
            color: "#cbd5e1",
            fontSize: 12,
            lineHeight: 1.6,
            boxShadow: "0 18px 40px rgba(0,0,0,0.32)",
            whiteSpace: "normal",
          }}
        >
          {text}
        </div>
      ) : null}
    </div>
  );
};

const CompactStepCard: React.FC<{
  step: string;
  title: string;
  info?: React.ReactNode;
  children: React.ReactNode;
}> = ({ step, title, info, children }) => (
  <div
    style={{
      borderRadius: 16,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.03)",
      padding: 16,
      display: "grid",
      gap: 12,
      minWidth: 0,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "#93c5fd",
          background: "rgba(59,130,246,0.12)",
          border: "1px solid rgba(59,130,246,0.20)",
          borderRadius: 999,
          padding: "4px 8px",
        }}
      >
        {step}
      </span>
      <span style={{ fontSize: 15, fontWeight: 800, color: "#f8fafc" }}>{title}</span>
      {info ? <InfoIcon text={info} /> : null}
    </div>
    {children}
  </div>
);

export const RaiseOemIdRequestView: React.FC = () => {
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready");
  const [errorText, setErrorText] = useState("");

  const [tenants, setTenants] = useState<TenantInfo[]>([]);
  const [dealers, setDealers] = useState<DealerInfo[]>([]);

  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [selectedDealerId, setSelectedDealerId] = useState("");
  const [oemDealerCodesInput, setOemDealerCodesInput] = useState("");

  const [isLoadingTenants, setIsLoadingTenants] = useState(false);
  const [isLoadingDealers, setIsLoadingDealers] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAutoResolving, setIsAutoResolving] = useState(false);

  const [tenantValidationState, setTenantValidationState] =
    useState<ValidationState>("idle");
  const [dealerValidationState, setDealerValidationState] =
    useState<ValidationState>("idle");

  const [lastApprovalPayload, setLastApprovalPayload] =
    useState<Record<string, unknown> | null>(null);
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

  const parsedOemDealerCodes = useMemo(() => {
    const parsed = oemDealerCodesInput
      .split(/[\n,]/)
      .map((item) => normalize(item))
      .filter(Boolean);

    logger.debug("parsed OEM dealer codes", parsed);
    return parsed;
  }, [oemDealerCodesInput]);

  const tenantAutoMatch = useMemo(() => {
    if (!preferredTenantId || tenants.length === 0) return null;
    return tenants.find((tenant) => normalize(tenant.tenantId) === preferredTenantId) ?? null;
  }, [preferredTenantId, tenants]);

  const dealerAutoMatch = useMemo(() => {
    if (!preferredDealerId || dealers.length === 0) return null;
    return dealers.find((dealer) => normalize(dealer.dealerId) === preferredDealerId) ?? null;
  }, [preferredDealerId, dealers]);

  const resolvedTenantId = useMemo(() => {
    if (normalize(selectedTenantId)) return normalize(selectedTenantId);
    if (tenantAutoMatch?.tenantId) return normalize(tenantAutoMatch.tenantId);
    return "";
  }, [selectedTenantId, tenantAutoMatch]);

  const resolvedDealerId = useMemo(() => {
    if (normalize(selectedDealerId)) return normalize(selectedDealerId);
    if (dealerAutoMatch?.dealerId) return normalize(dealerAutoMatch.dealerId);
    return "";
  }, [selectedDealerId, dealerAutoMatch]);

  const canPreviewPayload = useMemo(() => {
    return Boolean(
      resolvedTenantId &&
        resolvedDealerId &&
        parsedOemDealerCodes.length > 0
    );
  }, [resolvedTenantId, resolvedDealerId, parsedOemDealerCodes.length]);

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

      const tenantInfos = response.data?.flatMap((item) => item.tenantInfos ?? []) ?? [];
      setTenants(tenantInfos);

      const matchedTenant =
        preferredTenantId
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
            `Selected dealer profile tenant "${preferredTenantId}" was not found in tenants results.`
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

      const matchedDealer =
        preferredDealerId
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
            `Loaded ${dealerRows.length} dealer(s) for tenant ${tenantIdForRequest}. Auto-selected dealer ${dealerId}.`
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
      setTenantValidationState("matched");
      setDealerValidationState("matched");
      setRunState("success");
      setStatusText(
        `Auto-validation completed. Tenant "${validatedTenantId}" and dealer "${validatedDealerId}" are ready.`
      );
      setAutoSelectionMessage(
        `✅ Auto-validated tenant ${validatedTenantId} and dealer ${validatedDealerId}. You can now enter OEM dealer codes and preview/submit.`
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

  const buildApprovalPayload = (): Record<string, unknown> => {
    const tenantIdForPayload = resolvedTenantId;
    const dealerIdForPayload = resolvedDealerId;

    if (!tenantIdForPayload) {
      throw new Error("Preview unavailable: tenant is not selected or validated yet.");
    }

    if (!dealerIdForPayload) {
      throw new Error("Preview unavailable: dealer is not selected or validated yet.");
    }

    if (parsedOemDealerCodes.length === 0) {
      throw new Error("Preview unavailable: please enter at least one OEM dealer code.");
    }

    return {
      moduleName: "CONTRACT_CENTER",
      actionType: "RESTRICTED_API",
      requestName: `Dealer codes: ${parsedOemDealerCodes.join(", ")}`,
      tagId: null,
      releaseType: null,
      labels: {
        ENV: {
          value: ["PREPROD"],
        },
        TEMPLATE_ID: {
          value: TEMPLATE_ID,
        },
      },
      platform: "ARC",
      cluster: "ARC_DEFAULT",
      approvalEnvType: "MULTI_ENV",
      notes: {
        note: `Dealer codes: ${parsedOemDealerCodes.join(", ")}`,
      },
      metaDataByEnv: {
        PREPROD: {
          templateId: TEMPLATE_ID,
          templateName: "update dealer-master internal ",
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
          url: "/dealer-settings/restricted/dealer-master/internal/update",
          urlParams: {},
          body: {
            format: buildApprovalBodyFormat(parsedOemDealerCodes),
            params: [],
          },
          tenantDealerKeys: [
            {
              tenantId: tenantIdForPayload,
              dealerIds: [dealerIdForPayload],
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
      const payload = buildApprovalPayload();
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
      const payload = buildApprovalPayload();
      setLastApprovalPayload(payload);
      await proxyPost(APPROVAL_URL, payload, headerInfo.headers);
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
    }
  };

  return (
    <div style={{ display: "grid", gap: 14 }}>
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
        <div style={{ color: "#f8fafc", fontSize: 22, fontWeight: 800 }}>
          Raise OEM ID Request
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Pill label="Header Source" value={headerInfo.source} />
          <Pill label="Header Count" value={String(headerInfo.headerCount)} />
          <Pill label="Profile Tenant" value={preferredTenantId || "Not selected"} />
          <Pill label="Profile Dealer" value={preferredDealerId || "Not selected"} />
          <Pill label="Resolved Tenant" value={resolvedTenantId || "Pending"} />
          <Pill label="Resolved Dealer" value={resolvedDealerId || "Pending"} />
          <Pill label="OEM Codes" value={String(parsedOemDealerCodes.length)} />
        </div>

        {autoSelectionMessage ? (
          <div
            style={{
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 14,
          alignItems: "start",
        }}
      >
        <CompactStepCard
          step="Step 1"
          title="Capture Headers"
          info={
            <>
              Trigger this API in browser:
              <br />
              <code>https://app.tekioncloud.com/api/userservice/u/employee/profile</code>
              <br />
              <br />
              These headers are used for authentication/session.
              Selected profile tenant/dealer values are used for validation.
            </>
          }
        >
          <MiniInfoRow label="Source" value={headerInfo.source} />
          <MiniInfoRow label="Headers" value={String(headerInfo.headerCount)} />
          <MiniInfoRow label="Profile Tenant" value={preferredTenantId || "Not selected"} />
          <MiniInfoRow label="Profile Dealer" value={preferredDealerId || "Not selected"} />

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
            <button
              className="btn-secondary btn-sm"
              type="button"
              onClick={() => {
                requestLatestCaptureFromExtension();
                setCaptureVersion((prev) => prev + 1);
              }}
            >
              Refresh Headers
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
              {isAutoResolving ? "Validating..." : "Auto Validate"}
            </button>
          </div>
        </CompactStepCard>

        <CompactStepCard
          step="Step 2"
          title="Load Tenants"
          info="Validate the selected profile tenant against the tenants API response. If matched, it is auto-selected."
        >
          <ValidationRow
            label="Target Tenant"
            value={preferredTenantId || "Not selected"}
            state={tenantValidationState}
            reason={getValidationReason(preferredTenantId, tenantValidationState, "tenant")}
            compact
          />

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

          {tenants.length > 0 ? (
            <div>
              <div style={labelStyle}>Tenant</div>
              <select
                className="st-input"
                value={selectedTenantId}
                onChange={(e) => {
                  setSelectedTenantId(e.target.value);
                  setSelectedDealerId("");
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
        </CompactStepCard>

        <CompactStepCard
          step="Step 3"
          title="Load Dealers"
          info="Validate the selected profile dealer against the dealer list returned for the resolved tenant."
        >
          <ValidationRow
            label="Target Dealer"
            value={preferredDealerId || "Not selected"}
            state={dealerValidationState}
            reason={getValidationReason(preferredDealerId, dealerValidationState, "dealer")}
            compact
          />

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

          {dealers.length > 0 ? (
            <div>
              <div style={labelStyle}>Dealer</div>
              <select
                className="st-input"
                value={selectedDealerId}
                onChange={(e) => {
                  setSelectedDealerId(e.target.value);
                }}
                style={inputStyle}
              >
                <option value="">Select dealer</option>
                {dealers.map((dealer, index) => {
                  const dealerId = normalize(dealer.dealerId);
                  const displayName = normalize(dealer.displayName || dealer.dealerName) || dealerId;
                  return (
                    <option key={`${dealerId}-${index}`} value={dealerId}>
                      {dealerId} - {displayName} {dealer.active ? "✅" : "❌"}
                    </option>
                  );
                })}
              </select>
            </div>
          ) : null}
        </CompactStepCard>
      </div>

      <SectionCard
        title="Step 4 · Enter OEM Dealer Codes"
      >
        <textarea
          className="st-input"
          value={oemDealerCodesInput}
          onChange={(e) => {
            setOemDealerCodesInput(e.target.value);
          }}
          placeholder={"Multiple ID's will be comma separated"}
          rows={8}
          style={{
            ...inputStyle,
            minHeight: 160,
            resize: "vertical",
          }}
        />
      </SectionCard>

      <SectionCard
        title="Step 5 · Preview / Raise Request"
        info="Preview becomes available after tenant and dealer are resolved and at least one OEM code is entered."
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn-postman"
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              void submitApprovalRequest();
            }}
          >
            {isSubmitting ? "Submitting..." : "Raise OEM ID Request"}
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
          {canPreviewPayload
            ? "Ready for preview/submission ✅"
            : "Waiting for validated tenant, validated dealer, and OEM codes"}
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
                  <th style={thStyle}>Matched</th>
                </tr>
              </thead>
              <tbody>
                {dealers.map((dealer, index) => {
                  const dealerId = normalize(dealer.dealerId);
                  const isMatched = Boolean(preferredDealerId && dealerId === preferredDealerId);

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
                        {isMatched ? (
                          <span style={validatedBadgeStyle}>✓ Matched</span>
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

const MiniInfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      gap: 12,
      fontSize: 12,
      lineHeight: 1.5,
    }}
  >
    <span style={{ color: "#94a3b8" }}>{label}</span>
    <span style={{ color: "#f8fafc", fontWeight: 700, textAlign: "right" }}>{value}</span>
  </div>
);

const SectionCard: React.FC<{
  title: string;
  info?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, info, children }) => (
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
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: "#f8fafc" }}>{title}</div>
      {info ? <InfoIcon text={info} /> : null}
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
    <div style={{ fontWeight: 700, marginBottom: errorText ? 6 : 0 }}>
      {statusText}
    </div>
    {errorText ? <div>{errorText}</div> : null}
  </div>
);

const ValidationRow: React.FC<{
  label: string;
  value: string;
  state: ValidationState;
  reason: string;
  compact?: boolean;
}> = ({ label, value, state, reason, compact = false }) => {
  const isMatched = state === "matched";
  const isNotFound = state === "not-found";
  const isLoading = state === "loading";

  return (
    <div
      style={{
        display: "grid",
        gap: compact ? 6 : 8,
        padding: compact ? "8px 10px" : "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <div style={{ color: "#94a3b8", fontSize: 12, fontWeight: 700 }}>{label}:</div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 800,
            color: isMatched ? "#86efac" : isNotFound ? "#fca5a5" : isLoading ? "#93c5fd" : "#f8fafc",
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

export default RaiseOemIdRequestView;
