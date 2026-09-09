import React, { useEffect, useMemo, useState } from "react";
import { loadTekionApiSettingsBundle, getSelectedDealerProfileId } from "../../../services/tekionApiSettings";
import {
  loadLatestExtensionCapture,
  requestLatestCaptureFromExtension,
  subscribeToExtensionCapture,
  type ArcTekionProfile,
} from "../../../services/extensionBridge";
import type { KeyValuePair } from "../../../types/proxy.types";

const CHECKIN_GET_URL =
  "https://preprodapp.tekioncloud.com/api/service-module/u/settings/check-in-setting/v2/setup";
const CHECKIN_PUT_URL =
  "https://preprodapp.tekioncloud.com/api/service-module/u/settings/check-in-setting/v2/setup";
const CREATE_CUSTOMER_URL =
  "https://preprodapp.tekioncloud.com/api/cms/u/prevent-duplicates/customers";
const CUSTOMER_SEARCH_URL =
  "https://preprodapp.tekioncloud.com/api/cms/u/v2/customers/advancedsearch?locale=en_US";

const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";

type RunState = "idle" | "loading" | "success" | "error" | "warning";

type CheckinSection = Record<string, unknown>;
type CheckinField = Record<string, unknown>;
type CheckinValueRow = Record<string, unknown>;
type CustomerHit = Record<string, unknown>;

const logger = {
  info: (...args: unknown[]) => console.info("[Service][CheckInSetup]", ...args),
  warn: (...args: unknown[]) => console.warn("[Service][CheckInSetup]", ...args),
  error: (...args: unknown[]) => console.error("[Service][CheckInSetup]", ...args),
  debug: (...args: unknown[]) => console.debug("[Service][CheckInSetup]", ...args),
  group: (label: string, ...args: unknown[]) =>
    console.group(`[Service][CheckInSetup] ${label}`, ...args),
  groupEnd: () => console.groupEnd(),
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

function getBootstrapHeaders(): Record<string, string> {
  const capture = loadLatestExtensionCapture();
  const raw = capture?.tekionBootstrapHeaders ?? {};
  const out: Record<string, string> = {};

  Object.entries(raw).forEach(([key, value]) => {
    if (typeof value === "string" && key.trim() && value.trim()) {
      out[key.toLowerCase()] = value.trim();
    }
  });

  return out;
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

function buildHeadersForRequests(): {
  headers: Record<string, string>;
  source: "captured-bootstrap" | "global";
} {
  const captured = getBootstrapHeaders();

  if (Object.keys(captured).length > 0) {
    return {
      headers: {
        ...captured,
        "content-type": "application/json",
        accept: captured.accept || "application/json, text/plain, */*",
      },
      source: "captured-bootstrap",
    };
  }

  const global = getEnabledGlobalHeaders();

  return {
    headers: {
      ...global,
      "content-type": "application/json",
      accept: global.accept || "application/json, text/plain, */*",
    },
    source: "global",
  };
}

async function proxyRequest(
  url: string,
  method: "GET" | "POST" | "PUT",
  headers: Record<string, string>,
  body?: unknown
): Promise<unknown> {
  logger.group(`proxyRequest ${method} ${url}`);
  logger.debug("header keys", Object.keys(headers).sort());
  logger.debug("body", body);

  const response = await fetch("http://localhost:4000/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      method,
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
  logger.debug("proxy response json", json);

  if ((json?.status ?? 200) >= 400) {
    logger.groupEnd();
    throw new Error(
      `${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim()
    );
  }

  logger.groupEnd();
  return json?.body ?? json?.data ?? json;
}

function ensureDealerScopedHeaders(
  baseHeaders: Record<string, string>,
  profile: ArcTekionProfile | null
): Record<string, string> {
  const next = { ...baseHeaders };

  const dealerId = normalize(profile?.dealerId);
  const tenantName = normalize(profile?.tenantName);
  const userId = normalize((profile as Record<string, unknown> | null)?.userId);
  const roleId = normalize((profile as Record<string, unknown> | null)?.roleId);
  const siteId =
    normalize((profile as Record<string, unknown> | null)?.["tek-siteId"]) ||
    normalize((profile as Record<string, unknown> | null)?.siteId);
  const originalUserId = normalize(
    (profile as Record<string, unknown> | null)?.originalUserId
  );
  const originalTenantId = normalize(
    (profile as Record<string, unknown> | null)?.originalTenantId
  );

  if (dealerId) next["dealerid"] = dealerId;
  if (tenantName) next["tenantname"] = tenantName;
  if (userId) next["userid"] = userId;
  if (roleId) next["roleid"] = roleId;
  if (siteId) next["tek-siteid"] = siteId;
  if (originalUserId) next["original-userid"] = originalUserId;
  if (originalTenantId) next["original-tenantid"] = originalTenantId;

  next["locale"] = next["locale"] || "en_US";
  next["applicationid"] = next["applicationid"] || "ARC_NA";
  next["clientid"] = next["clientid"] || "web";
  next["program"] = next["program"] || "DEFAULT";
  next["subapplicationid"] = next["subapplicationid"] || "US";

  return next;
}

function extractSetupArray(response: unknown): CheckinSection[] {
  if (Array.isArray(response)) return response.filter(isRecord);

  if (isRecord(response)) {
    if (Array.isArray(response.data)) {
      return response.data.filter(isRecord);
    }
    if (Array.isArray(response.body)) {
      return response.body.filter(isRecord);
    }
  }

  return [];
}

function findSection(
  sections: CheckinSection[],
  sectionName: string
): CheckinSection | null {
  return sections.find((item) => normalize(item.section) === sectionName) ?? null;
}

function getFieldMetaData(section: CheckinSection): CheckinField[] {
  return asArray<CheckinField>(section.fieldMetaData).filter(isRecord);
}

function findField(section: CheckinSection, fieldName: string): CheckinField | null {
  return (
    getFieldMetaData(section).find(
      (field) => normalize(field.fieldName) === fieldName
    ) ?? null
  );
}

function getValues(field: CheckinField): CheckinValueRow[] {
  return asArray<CheckinValueRow>(field.values).filter(isRecord);
}

function ensureFieldValues(field: CheckinField): CheckinValueRow[] {
  const existing = getValues(field);
  if (existing.length > 0) return existing;
  field.values = [];
  return field.values as CheckinValueRow[];
}

function setScalarFieldValueForAllRows(
  field: CheckinField,
  newValue: unknown,
  fallbackApplyToList: string[]
): void {
  const values = ensureFieldValues(field);

  if (values.length === 0) {
    field.values = fallbackApplyToList.map((applyTo) => ({
      value: newValue,
      applyTo,
      updateAllowed: true,
      updateOnApplyToAll: true,
    }));
    return;
  }

  values.forEach((row) => {
    row.value = newValue;
  });
}

function ensureTableFieldValue(
  field: CheckinField,
  newValue: unknown,
  applyTo: string = "ALL"
): void {
  const values = ensureFieldValues(field);

  if (values.length === 0) {
    field.values = [
      {
        value: newValue,
        applyTo,
        updateAllowed: true,
        updateOnApplyToAll: true,
      },
    ];
    return;
  }

  values[0].value = newValue;
}

function buildCreateCustomerPayload(): Record<string, unknown> {
  return {
    customerType: 0,
    vip: false,
    firstName: "Test",
    alternateName: "Test",
    lastName: "PDI / UVI Customer",
    communicationPreferences: {
      email: { serviceUpdates: true, marketing: true },
      text: { serviceUpdates: true, marketing: true },
      call: { serviceUpdates: true, marketing: true },
      postalMail: { serviceUpdates: true, marketing: true },
    },
    socialSecurityNumber: "",
    phones: [
      {
        number: "0000000000",
        phoneType: 0,
        isPrimary: true,
        extension: "+1",
        capencyVerified: null,
      },
    ],
    addresses: [
      {
        line1: "test",
        postalCode: "10001",
        county: "Los Angeles County",
        city: "West Hollywood",
        addressSubType: null,
        startDate: null,
        endDate: null,
        addressType: 2,
        residentType: null,
        default: false,
        state: "CA",
        country: "US",
        routeNumber: null,
      },
    ],
    preferredLanguage: "en_US",
    isMigratedCustomer: false,
    payTypeConfig: {
      subPayType: "",
      inheritPayTypeFromClientCategory: false,
    },
    additionalEmails: {},
    additionalPhones: {},
    fax: null,
    contact: [
      {
        number: "0000000000",
        isPrimary: true,
        extension: "+1",
        capencyVerified: null,
        type: 0,
      },
    ],
    preferredContactType: 0,
    primaryPhone: "0000000000",
    loyaltyInfoByOEMs: [],
    companyDetails: {},
    status: "ACTIVE",
    newCMS: true,
    source: "CMS",
  };
}

function extractCustomerHits(response: unknown): CustomerHit[] {
  if (!isRecord(response)) return [];

  const data = response.data;
  if (!isRecord(data)) return [];

  const hits = data.hits;
  return asArray<CustomerHit>(hits).filter(isRecord);
}

function pickBestCustomerId(hits: CustomerHit[]): string {
  if (hits.length === 0) return "";

  const sorted = [...hits].sort((a, b) => {
    const aTime = Number(a.modifiedTime ?? a.createdTime ?? 0);
    const bTime = Number(b.modifiedTime ?? b.createdTime ?? 0);
    return bTime - aTime;
  });

  return normalize(sorted[0]?.id);
}

function buildCustomerSearchPayload(): Record<string, unknown> {
  return {
    searchQuery: "PDI / UVI",
    filterValue: "ALL",
    selectedFilters: [],
    sort: [],
    groupBy: [],
    includeFields: [
      "id",
      "status",
      "email",
      "phones",
      "displayId",
      "companyName",
      "customerType",
      "firstName",
      "lastName",
      "salutation",
      "suffix",
      "middleName",
      "name",
      "vehicleInfo",
      "modifiedTime",
      "tags",
      "addresses",
      "accountingInfo.chargeCustomer",
      "taxInformation.salesTaxInfo",
      "taxInformation.serviceTaxInfo",
      "taxInformation.partsTaxInfo",
    ],
    searchableFields: [],
    excludeFields: [],
    pageInfo: {
      start: 0,
      rows: 50,
    },
    advancedSearchDTO: {},
    searchText: "PDI / UVI",
    filters: [
      {
        field: "merged",
        values: [true],
        operator: "NIN",
      },
    ],
  };
}

function ensureDisclaimerOfWarranties(
  sections: CheckinSection[]
): void {
  const section = findSection(sections, "termsAndCondition");
  if (!section) return;

  const field = findField(section, "policies");
  if (!field) return;

  const values = ensureFieldValues(field);

  if (values.length === 0) {
    field.values = [
      {
        value: [
          {
            title: "Disclaimer of Warranties",
            pdfConfigKey: "LAST_PAGE_LEGAL_TERMS",
            sectionName: "BODY",
            source: "PDF_CONFIGURATOR",
            mandatory: true,
            disabled: true,
            allowDeleteWhenDisabled: false,
            order: 1,
            languages: {
              documentDefault: null,
              locale: {
                en_US: { title: "Disclaimer of Warranties" },
              },
              keyValueMapList: null,
            },
            sectionKey: "BODY",
            subSectionKey: "LAST_PAGE_LEGAL_TERMS",
            isLastRow: false,
          },
        ],
        applyTo: "ALL",
        updateAllowed: true,
        updateOnApplyToAll: true,
      },
    ];
    return;
  }

  values.forEach((row) => {
    const policies = asArray<Record<string, unknown>>(row.value).filter(isRecord);

    const nextPolicies = policies.map((policy) => {
      if (normalize(policy.title) !== "Disclaimer of Warranties") {
        return policy;
      }

      return {
        ...policy,
        title: "Disclaimer of Warranties",
        pdfConfigKey: "LAST_PAGE_LEGAL_TERMS",
        sectionName: "BODY",
        sectionKey: "BODY",
        subSectionKey: "LAST_PAGE_LEGAL_TERMS",
        isLastRow: false,
      };
    });

    const hasDisclaimer = nextPolicies.some(
      (policy) => normalize(policy.title) === "Disclaimer of Warranties"
    );

    if (!hasDisclaimer) {
      nextPolicies.unshift({
        title: "Disclaimer of Warranties",
        pdfConfigKey: "LAST_PAGE_LEGAL_TERMS",
        sectionName: "BODY",
        source: "PDF_CONFIGURATOR",
        mandatory: true,
        disabled: true,
        allowDeleteWhenDisabled: false,
        order: 1,
        languages: {
          documentDefault: null,
          locale: {
            en_US: { title: "Disclaimer of Warranties" },
          },
          keyValueMapList: null,
        },
        sectionKey: "BODY",
        subSectionKey: "LAST_PAGE_LEGAL_TERMS",
        isLastRow: false,
      });
    }

    row.value = nextPolicies;
  });
}

function ensureNewVehicleDefaultOpcodes(sections: CheckinSection[]): void {
  const section = findSection(sections, "inventoryROSettings");
  if (!section) return;

  const field = findField(section, "newVehicleDefaultOpcodes");
  if (!field) return;

  const desired = [
    { opCode: "MISC", autoSelect: false, disabled: true },
    { opCode: "PDI", autoSelect: true, disabled: false },
  ];

  ensureTableFieldValue(field, desired, "ALL");
}

function ensureUsedVehicleDefaultOpcodes(sections: CheckinSection[]): void {
  const section = findSection(sections, "inventoryROSettings");
  if (!section) return;

  const field = findField(section, "usedVehicleDefaultOpcodes");
  if (!field) return;

  const values = ensureFieldValues(field);

  if (values.length === 0) {
    field.values = [
      {
        value: [{ opCode: "UVI", autoSelect: true, disabled: true }],
        applyTo: "ALL",
        updateAllowed: false,
        updateOnApplyToAll: true,
      },
    ];
    return;
  }

  const current = asArray<Record<string, unknown>>(values[0].value).filter(isRecord);
  const hasUvi = current.some((item) => normalize(item.opCode) === "UVI");

  let next = current.map((item) => {
    if (normalize(item.opCode) !== "UVI") return item;
    return {
      ...item,
      opCode: "UVI",
      autoSelect: true,
      disabled: true,
    };
  });

  if (!hasUvi) {
    next = [...next, { opCode: "UVI", autoSelect: true, disabled: true }];
  }

  values[0].value = next;
}

function buildUpdatedSetupPayload(
  originalSections: CheckinSection[],
  customerId: string
): CheckinSection[] {
  const sections = deepClone(originalSections);

  const generalSetups = findSection(sections, "generalSetups");
  if (generalSetups) {
    const tagLengthField = findField(generalSetups, "tagLength");
    if (tagLengthField) {
      setScalarFieldValueForAllRows(
        tagLengthField,
        8,
        ["QUICK_RO", "WEB_CHECK_IN", "MOBILE_CHECK_IN", "SALES_RO"]
      );
    }
  }

  const inventorySection = findSection(sections, "inventoryROSettings");
  if (inventorySection) {
    const pdiField = findField(inventorySection, "pdiCustomerIdV2");
    if (pdiField) {
      setScalarFieldValueForAllRows(
        pdiField,
        customerId,
        ["SALES_RO", "QUICK_RO", "WEB_CHECK_IN", "MOBILE_CHECK_IN"]
      );
    }

    const uviField = findField(inventorySection, "uviCustomerId");
    if (uviField) {
      setScalarFieldValueForAllRows(
        uviField,
        customerId,
        ["SALES_RO", "QUICK_RO", "WEB_CHECK_IN", "MOBILE_CHECK_IN"]
      );
    }
  }

  ensureDisclaimerOfWarranties(sections);
  ensureNewVehicleDefaultOpcodes(sections);
  ensureUsedVehicleDefaultOpcodes(sections);

  return sections;
}

const CheckInSetupView: React.FC = () => {
  const [captureVersion, setCaptureVersion] = useState(0);
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready");
  const [errorText, setErrorText] = useState("");
  const [lastFetchedSetup, setLastFetchedSetup] = useState<CheckinSection[]>([]);
  const [lastUpdatedPayload, setLastUpdatedPayload] = useState<CheckinSection[]>([]);
  const [createdCustomerId, setCreatedCustomerId] = useState("");
  const [showFetchedSetup, setShowFetchedSetup] = useState(false);
  const [showUpdatedPayload, setShowUpdatedPayload] = useState(true);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    requestLatestCaptureFromExtension();

    const unsubscribe = subscribeToExtensionCapture(() => {
      setCaptureVersion((prev) => prev + 1);
    });

    const handleFocus = () => {
      setCaptureVersion((prev) => prev + 1);
      requestLatestCaptureFromExtension();
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      unsubscribe();
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const headerInfo = useMemo(() => {
    const { headers, source } = buildHeadersForRequests();
    return {
      headers,
      source,
      headerCount: Object.keys(headers).length,
    };
  }, [captureVersion]);

  const selectedDealerProfile = useMemo(() => {
    return loadSelectedDealerProfileFromCapture();
  }, [captureVersion]);

  const requestHeaders = useMemo(() => {
    return ensureDealerScopedHeaders(headerInfo.headers, selectedDealerProfile);
  }, [headerInfo.headers, selectedDealerProfile]);

  const profileSummary = useMemo(() => {
    return {
      dealerId: normalize(selectedDealerProfile?.dealerId),
      tenantName: normalize(selectedDealerProfile?.tenantName),
      profileId: normalize(selectedDealerProfile?.id),
    };
  }, [selectedDealerProfile]);

  const runSetup = async () => {
    logger.group("runSetup");
    setRunning(true);
    setRunState("loading");
    setStatusText("Starting Check-in Setup workflow...");
    setErrorText("");
    setCreatedCustomerId("");

    try {
      if (headerInfo.headerCount === 0) {
        throw new Error(
          'No captured bootstrap headers or Global Headers found. Please capture preprod app headers first and reload.'
        );
      }

      if (!profileSummary.dealerId) {
        throw new Error("No selected dealer profile dealerId found.");
      }

      setStatusText("Step 1/4 - Fetching current Check-in setup...");
      const getResponse = await proxyRequest(
        CHECKIN_GET_URL,
        "GET",
        requestHeaders
      );

      const fetchedSections = extractSetupArray(getResponse);
      if (fetchedSections.length === 0) {
        throw new Error("Check-in setup GET returned no usable sections.");
      }

      setLastFetchedSetup(fetchedSections);
      logger.info("Fetched setup sections", {
        sectionCount: fetchedSections.length,
        sections: fetchedSections.map((item) => normalize(item.section)),
      });

      setStatusText("Step 2/4 - Creating PDI / UVI customer...");
      await proxyRequest(
        CREATE_CUSTOMER_URL,
        "POST",
        requestHeaders,
        buildCreateCustomerPayload()
      );

      setStatusText("Step 3/4 - Searching created customer id...");
      const searchResponse = await proxyRequest(
        CUSTOMER_SEARCH_URL,
        "POST",
        requestHeaders,
        buildCustomerSearchPayload()
      );

      const hits = extractCustomerHits(searchResponse);
      const customerId = pickBestCustomerId(hits);

      logger.info("Customer search results", {
        hitCount: hits.length,
        selectedCustomerId: customerId,
        sample: hits.slice(0, 3),
      });

      if (!customerId) {
        throw new Error("Could not resolve created PDI / UVI customer id from customer search.");
      }

      setCreatedCustomerId(customerId);

      setStatusText("Step 4/4 - Building updated payload and saving Check-in setup...");
      const updatedPayload = buildUpdatedSetupPayload(fetchedSections, customerId);
      setLastUpdatedPayload(updatedPayload);

      await proxyRequest(
        CHECKIN_PUT_URL,
        "PUT",
        requestHeaders,
        updatedPayload
      );

      setRunState("success");
      setStatusText(
        `Check-in setup updated successfully. PDI/UVI customer id: ${customerId}`
      );
    } catch (error: unknown) {
      logger.error("runSetup failed", error);
      setRunState("error");
      setStatusText("Check-in setup workflow failed.");
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
      logger.groupEnd();
    }
  };

  return (
    <div
      style={{
        minHeight: 320,
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.02)",
        padding: 20,
        color: "#cbd5e1",
        display: "grid",
        gap: 16,
      }}
    >
      <div>
        <div style={{ color: "#f8fafc", fontSize: 22, fontWeight: 800, marginBottom: 6 }}>
          Check in setup
        </div>
        <div style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.7 }}>
          Fetch current setup, create/search PDI-UVI customer, inject required values, and save via PUT.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Pill label="Header Source" value={headerInfo.source} />
        <Pill label="Header Count" value={String(headerInfo.headerCount)} />
        <Pill label="Profile ID" value={profileSummary.profileId || "Not selected"} />
        <Pill label="Dealer ID" value={profileSummary.dealerId || "Not selected"} />
        <Pill label="Tenant" value={profileSummary.tenantName || "Not selected"} />
        <Pill label="Resolved Customer ID" value={createdCustomerId || "Pending"} />
      </div>

      <StatusBox runState={runState} statusText={statusText} errorText={errorText} />

      <div style={cardStyle}>
        <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800, marginBottom: 12 }}>
          Actions
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            className="btn-secondary btn-sm"
            type="button"
            onClick={() => {
              requestLatestCaptureFromExtension();
              setCaptureVersion((prev) => prev + 1);
            }}
          >
            Refresh Captured Headers
          </button>

          <button
            className="btn-postman"
            type="button"
            disabled={running}
            onClick={() => {
              void runSetup();
            }}
          >
            {running ? "Running..." : "Run Check-in Setup"}
          </button>
        </div>

        <div style={{ marginTop: 12, color: "#94a3b8", fontSize: 12, lineHeight: 1.7 }}>
          Uses selected dealer profile scoped headers through proxy for GET, POST, search POST, and PUT.
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800, marginBottom: 12 }}>
          What gets updated
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, color: "#cbd5e1", lineHeight: 1.8 }}>
          <li>tagLength = 8</li>
          <li>Disclaimer of Warranties policy normalized/injected</li>
          <li>pdiCustomerIdV2 = created customer id</li>
          <li>uviCustomerId = created customer id</li>
          <li>newVehicleDefaultOpcodes = MISC false, PDI true</li>
          <li>usedVehicleDefaultOpcodes = ensure UVI selected</li>
        </ul>
      </div>

      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800 }}>
            Current GET Setup Snapshot
          </div>
          <button
            className="btn-secondary btn-sm"
            type="button"
            onClick={() => setShowFetchedSetup((prev) => !prev)}
          >
            {showFetchedSetup ? "Hide" : "Show"}
          </button>
        </div>

        {showFetchedSetup ? (
          <pre
            style={preStyle}
          >
            {JSON.stringify(lastFetchedSetup, null, 2)}
          </pre>
        ) : (
          <div style={{ color: "#94a3b8", fontSize: 13 }}>
            Hidden
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800 }}>
            Final PUT Payload Preview
          </div>
          <button
            className="btn-secondary btn-sm"
            type="button"
            onClick={() => setShowUpdatedPayload((prev) => !prev)}
          >
            {showUpdatedPayload ? "Hide" : "Show"}
          </button>
        </div>

        {showUpdatedPayload ? (
          <pre style={preStyle}>
            {JSON.stringify(lastUpdatedPayload, null, 2)}
          </pre>
        ) : (
          <div style={{ color: "#94a3b8", fontSize: 13 }}>
            Hidden
          </div>
        )}
      </div>
    </div>
  );
};

const cardStyle: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  padding: 16,
};

const preStyle: React.CSSProperties = {
  margin: 0,
  padding: 12,
  borderRadius: 12,
  background: "#0f172a",
  color: "#e2e8f0",
  overflow: "auto",
  fontSize: 12,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
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

export default CheckInSetupView;
