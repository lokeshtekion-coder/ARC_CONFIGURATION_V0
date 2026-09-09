import React, { useEffect, useMemo, useState } from "react";
import { loadTekionApiSettingsBundle } from "../../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../../types/proxy.types";

const MODULE_NAME = "Fees";
const SEARCH_URL =
  "https://preprodapp.tekioncloud.com/api/service-module/u/fee/v3/search?withNoDealers=false&locale=en_US";
const CREATE_URL =
  "https://preprodapp.tekioncloud.com/api/service-module/u/fee/v3?locale=en_US";

const FEE_TYPES = [
  "Restock",
  "ShopSupplies",
  "PaintMaterials",
  "Misc",
  "AdminAllowance",
  "Towing",
  "PublicTransport",
  "Warranty Claim",
  "Rental",
  "Shuttle",
  "GOG",
  "Freight",
  "Core",
  "Other",
] as const;

const DEFAULT_FEES = [
  "Tire Tax fee",
  "Key Cut fee",
  "Tire Disposal fee",
  "Battery Disposal fee",
  "Wheel Weight fee",
  "Freight fee",
] as const;

type ViewMode = "home" | "get" | "post" | "put";
type RunState = "idle" | "loading" | "success" | "error" | "warning";
type PricingType = "FLAT_PRICE" | "PERCENTAGE_PART";
type FeeType = (typeof FEE_TYPES)[number];

const logger = {
  debug: (...args: unknown[]) => console.debug("[Parts][Fees]", ...args),
  info: (...args: unknown[]) => console.info("[Parts][Fees]", ...args),
  warn: (...args: unknown[]) => console.warn("[Parts][Fees]", ...args),
  error: (...args: unknown[]) => console.error("[Parts][Fees]", ...args),
};

interface FeeRecord {
  id?: string | null;
  feeCode?: string | null;
  description?: string | null;
  department?: string | null;
  active?: boolean | null;
  type?: string | null;
  dealerId?: string | null;
}

interface FeeSearchResponse {
  data?: unknown;
  status?: string;
  message?: string;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function getEnabledGlobalHeaders(): Record<string, string> {
  const bundle = loadTekionApiSettingsBundle();

  const headers = (bundle.globalHeaders ?? [])
    .filter(
      (header: KeyValuePair) =>
        header.enabled && header.key.trim() && String(header.value).trim()
    )
    .reduce<Record<string, string>>((acc, header) => {
      acc[header.key] = String(header.value);
      return acc;
    }, {});

  logger.info("loaded global headers from settings", {
    count: Object.keys(headers).length,
    keys: Object.keys(headers),
  });

  return headers;
}

function getDealerIdFromHeaders(headers: Record<string, string>): string {
  const lowerMap = Object.entries(headers).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      acc[key.toLowerCase()] = value;
      return acc;
    },
    {}
  );

  const dealerId = lowerMap["dealerid"] || lowerMap["dealer-id"] || "";

  logger.info("resolved dealer id from headers", {
    dealerId: dealerId || "NOT_FOUND",
  });

  return dealerId;
}

function detectFeeType(description: string): FeeType {
  const desc = description.toLowerCase();

  logger.debug("detecting fee type", { description, normalized: desc });

  if (desc.includes("shop") && desc.includes("suppl")) return "ShopSupplies";
  if (desc.includes("paint") && desc.includes("material")) return "PaintMaterials";
  if (desc.includes("public") && (desc.includes("transport") || desc.includes("transit"))) {
    return "PublicTransport";
  }
  if (desc.includes("warranty") && desc.includes("claim")) return "Warranty Claim";
  if (desc.includes("admin") && desc.includes("allowance")) return "AdminAllowance";

  const singleKeywords: Array<{ keyword: string; type: FeeType }> = [
    { keyword: "restock", type: "Restock" },
    { keyword: "paint", type: "PaintMaterials" },
    { keyword: "tow", type: "Towing" },
    { keyword: "warranty", type: "Warranty Claim" },
    { keyword: "rental", type: "Rental" },
    { keyword: "rent", type: "Rental" },
    { keyword: "shuttle", type: "Shuttle" },
    { keyword: "gog", type: "GOG" },
    { keyword: "freight", type: "Freight" },
    { keyword: "shipping", type: "Freight" },
    { keyword: "core", type: "Core" },
    { keyword: "misc", type: "Misc" },
    { keyword: "admin", type: "AdminAllowance" },
  ];

  for (const item of singleKeywords) {
    if (desc.includes(item.keyword)) {
      logger.debug("fee type keyword match found", item);
      return item.type;
    }
  }

  logger.debug("no fee type keyword match found, defaulting to Misc");
  return "Misc";
}

function generateFeeCode(description: string): string {
  const code = description
    .replace(/\bfee(s)?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  logger.debug("generated fee code", {
    description,
    generatedCode: code,
  });

  return code;
}

function getTomorrowMidnight(): number {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const timestamp = tomorrow.getTime();

  logger.debug("calculated tomorrow midnight", {
    currentIso: new Date().toISOString(),
    tomorrowMidnightIso: tomorrow.toISOString(),
    timestamp,
  });

  return timestamp;
}

function extractFeesArray(raw: unknown): FeeRecord[] {
  if (!raw || typeof raw !== "object") return [];

  const response = raw as FeeSearchResponse;
  const data = response.data;

  if (Array.isArray(data)) return data as FeeRecord[];

  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.hits)) return obj.hits as FeeRecord[];
    if (Array.isArray(obj.data)) return obj.data as FeeRecord[];
    if (Array.isArray(obj.fees)) return obj.fees as FeeRecord[];
  }

  return [];
}

async function fetchFees(headers: Record<string, string>): Promise<FeeRecord[]> {
  const requestBody = {
    pageInfo: {
      start: 0,
      rows: 1000,
    },
    sort: [{ order: "DESC", field: "modifiedTime" }],
    filters: [],
  };

  const requestHeaders = {
    ...headers,
    "content-type": "application/json",
  };

  logger.info("sending fee search request", {
    url: SEARCH_URL,
    body: requestBody,
    headerKeys: Object.keys(requestHeaders),
  });

  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(requestBody),
  });

  const json = (await response.json()) as FeeSearchResponse;

  logger.info("fee search response received", {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    rawStatus: json?.status,
  });

  logger.debug("fee search response json", json);

  if (!response.ok) {
    throw new Error(json?.message || `HTTP ${response.status}`);
  }

  const fees = extractFeesArray(json);

  logger.info("extracted fee records", { count: fees.length });
  return fees;
}

function buildCreatePayload(args: {
  dealerId: string;
  feeCode: string;
  description: string;
  feeType: string;
  pricingType: PricingType;
  amountInput: number;
}) {
  const { dealerId, feeCode, description, feeType, pricingType, amountInput } = args;
  const amount = pricingType === "FLAT_PRICE" ? Math.round(amountInput * 100) : amountInput;
  const effectiveTimeInMillis = getTomorrowMidnight();
  const glAccountIdOrNumber = `${dealerId}_9999`;

  const payload = {
    feeCode,
    dealerId,
    description,
    categories: ["Other"],
    department: "PARTS",
    active: true,
    upfront: true,
    type: feeType,
    optionCode: null,
    pricingSetup: {
      deletedPricingConfigIds: [],
      upcoming: [
        {
          SERVICES_FRANCHISE_PRICING_TABLE_FIELD: [
            {
              additionalPricing: [pricingType],
              flatFee: pricingType === "FLAT_PRICE" ? amountInput : null,
              calculatedFee: null,
              percentAmount: pricingType === "PERCENTAGE_PART" ? amount : null,
              maxValue: null,
              minValue: null,
              feeComponent: "Sale Amount",
              isLastRow: true,
            },
          ],
          applicablePayTypeForFee: ["CP", "I", "W"],
          feeGridConfig: {
            configType: "PART_WASTE_TYPE",
            gridConfig: {
              configType: "PART_WASTE_TYPE",
              gridConfig: {
                configType: "PART_WASTE_TYPE",
                salePricingConfig: [
                  {
                    noOfParts: null,
                    operator: "EQ",
                    flatPrice: null,
                    billHours: [
                      {
                        startHours: null,
                        endHours: null,
                        operator: "RANGE",
                        flatPrice: null,
                        isLastRow: true,
                      },
                    ],
                    isLastRow: true,
                  },
                ],
                costPricingConfig: [
                  {
                    noOfParts: null,
                    operator: "EQ",
                    flatPrice: null,
                    billHours: [
                      {
                        startHours: null,
                        endHours: null,
                        operator: "RANGE",
                        flatPrice: null,
                        isLastRow: true,
                      },
                    ],
                    isLastRow: true,
                  },
                ],
              },
              gridUpdated: false,
              salePricingConfig: [
                {
                  noOfParts: null,
                  operator: "EQ",
                  flatPrice: null,
                  billHours: [
                    {
                      startHours: null,
                      endHours: null,
                      operator: "RANGE",
                      flatPrice: null,
                      isLastRow: true,
                    },
                  ],
                  isLastRow: true,
                },
              ],
              costPricingConfig: [
                {
                  noOfParts: null,
                  operator: "EQ",
                  flatPrice: null,
                  billHours: [
                    {
                      startHours: null,
                      endHours: null,
                      operator: "RANGE",
                      flatPrice: null,
                      isLastRow: true,
                    },
                  ],
                  isLastRow: true,
                },
              ],
            },
          },
          vatId: null,
          vatPercent: null,
          vendorNumber: "",
          specifyCases: "inclusions",
          customerPayCostCenters: [],
          warrantyCostCenters: [],
          internalCostCenters: [],
          EXCLUDE_SERVICE_TYPES: [],
          EXCLUDE_OP_CODES: [],
          feeQuantity: {
            type: "NUMERIC",
            value: 1,
          },
          glAccountNo: "-",
          AUTO_ADD_FEE_BASED_ON_RO_TYPE: [],
          AUTO_ADD_FEE_BASED_ON_DEPARTMENT: [],
          AUTO_ADD_FEE_BASED_ON_SITE: [],
          taxConfigs: [
            {
              payType: "CUSTOMER_PAY",
              subPayTypes: ["ALL_CUSTOMER_PAY"],
              taxRegimeType: "SALES_TAX",
              taxable: true,
            },
          ],
          overrideFlags: [
            { flag: "ALLOW_SALE_OVERRIDE", enabled: true },
            { flag: "AUTO_ADD_TO_PART", enabled: false },
          ],
          glAccountIdOrNumber,
          feeConfigs: [
            {
              salePricingDetail: {
                pricingType,
                flatPrice: pricingType === "FLAT_PRICE" ? amount : null,
                basePrice: null,
                percentage: pricingType === "PERCENTAGE_PART" ? amount : null,
                minAmount: null,
                maxAmount: null,
              },
              costPricingDetail: {
                flatPrice: null,
                basePrice: null,
                minAmount: null,
                maxAmount: null,
              },
              minMaxLimits: false,
              eligibilityCriteria: {
                filters: [
                  { field: "partIds", operator: "IN", groupId: "DEFAULT" },
                  { field: "sourceIds", operator: "IN", groupId: "DEFAULT" },
                  { field: "partSaleTypes", operator: "IN", groupId: "DEFAULT" },
                ],
              },
              glAccountNo: "-",
            },
          ],
          effectiveTimeInMillis,
          excludeServiceTypeIds: [],
          excludeOpcodes: [],
          enabledCriteria: ["subPayTypes"],
          id: null,
        },
      ],
    },
    configs: [
      {
        salePricingDetail: {
          flatPrice: null,
          basePrice: null,
          percentage: null,
          minAmount: null,
          maxAmount: null,
        },
        costPricingDetail: {
          flatPrice: null,
          basePrice: null,
          minAmount: null,
          maxAmount: null,
        },
        minMaxLimits: false,
        payType: "ANY",
        overrideFlags: [],
        excludeServiceTypeIds: [],
        excludeOpcodes: [],
        warrantyCostCenters: [],
        internalCostCenters: [],
        criteria: null,
        taxConfigs: [],
      },
    ],
    sourceIds: [],
    partIds: [],
    languages: {
      documentDefault: "en_US",
    },
  };

  logger.info("built create fee payload", {
    feeCode,
    dealerId,
    feeType,
    pricingType,
    amountInput,
    convertedAmount: amount,
    payloadSize: JSON.stringify(payload).length,
  });

  logger.debug("full create fee payload", payload);
  return payload;
}

async function createFee(
  payload: Record<string, unknown>,
  headers: Record<string, string>
): Promise<{ id?: string | null }> {
  const requestHeaders = {
    ...headers,
    "content-type": "application/json",
  };

  logger.info("sending create fee request", {
    url: CREATE_URL,
    headerKeys: Object.keys(requestHeaders),
  });

  const response = await fetch(CREATE_URL, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(payload),
  });

  const json = (await response.json()) as {
    data?: { id?: string | null };
    message?: string;
  };

  logger.info("create fee response received", {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    feeId: json?.data?.id || null,
  });

  logger.debug("create fee response json", json);

  if (!response.ok) {
    throw new Error(json?.message || `HTTP ${response.status}`);
  }

  return { id: json?.data?.id ?? null };
}

export const FeesView: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>("home");
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready");
  const [errorText, setErrorText] = useState("");
  const [lastRunAt, setLastRunAt] = useState("");

  const [fees, setFees] = useState<FeeRecord[]>([]);
  const [searchText, setSearchText] = useState("");
  const [isLoadingFees, setIsLoadingFees] = useState(false);

  const [description, setDescription] = useState("");
  const [feeCode, setFeeCode] = useState("");
  const [feeType, setFeeType] = useState<FeeType>("Misc");
  const [pricingType, setPricingType] = useState<PricingType>("FLAT_PRICE");
  const [amountInput, setAmountInput] = useState("");
  const [selectedDefaultFee, setSelectedDefaultFee] = useState<string>("");

  const [isCreatingFee, setIsCreatingFee] = useState(false);
  const [createResponseText, setCreateResponseText] = useState("");

  useEffect(() => {
    logger.info("component mounted");
    logger.info("supported fee types loaded", FEE_TYPES);
    logger.info("default fee templates loaded", DEFAULT_FEES);
    return () => logger.info("component unmounted");
  }, []);

  useEffect(() => {
    logger.info("view mode changed", { viewMode });
  }, [viewMode]);

  useEffect(() => {
    if (!description.trim()) {
      setFeeCode("");
      setFeeType("Misc");
      logger.debug("description cleared, reset fee code and type");
      return;
    }

    const generated = generateFeeCode(description);
    const detected = detectFeeType(description);

    setFeeCode(generated);
    setFeeType(detected);

    logger.info("description auto-processed", {
      description,
      generatedFeeCode: generated,
      detectedFeeType: detected,
    });
  }, [description]);

  useEffect(() => {
    logger.info("pricing type changed", { pricingType });
  }, [pricingType]);

  const filteredFees = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return fees;

    const next = fees.filter((item) => {
      const feeCodeValue = normalizeText(item.feeCode).toLowerCase();
      const descValue = normalizeText(item.description).toLowerCase();
      const deptValue = normalizeText(item.department).toLowerCase();
      const typeValue = normalizeText(item.type).toLowerCase();

      return (
        feeCodeValue.includes(query) ||
        descValue.includes(query) ||
        deptValue.includes(query) ||
        typeValue.includes(query)
      );
    });

    logger.debug("filtered fees recalculated", {
      total: fees.length,
      filtered: next.length,
      searchText,
    });

    return next;
  }, [fees, searchText]);

  const handleLoadFees = async (): Promise<void> => {
    logger.info("GET fees button clicked");

    setIsLoadingFees(true);
    setRunState("loading");
    setStatusText("Loading fees...");
    setErrorText("");

    try {
      const headers = getEnabledGlobalHeaders();

      if (Object.keys(headers).length === 0) {
        logger.warn("global headers missing before GET fees");
        setRunState("error");
        setStatusText("Global headers are missing");
        setErrorText(
          "No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers."
        );
        return;
      }

      const rows = await fetchFees(headers);
      setFees(rows);
      setRunState("success");
      setStatusText(`Retrieved ${rows.length} fee record${rows.length === 1 ? "" : "s"}`);
      setLastRunAt(new Date().toLocaleString());

      logger.info("fees loaded successfully", { count: rows.length });
    } catch (error: unknown) {
      logger.error("GET fees failed", error);
      setRunState("error");
      setStatusText("Failed to fetch fees");
      setErrorText(error instanceof Error ? error.message : String(error));
      setLastRunAt(new Date().toLocaleString());
    } finally {
      setIsLoadingFees(false);
    }
  };

  const handleDefaultFeeSelect = (value: string) => {
    logger.info("default fee selected", { value });
    setSelectedDefaultFee(value);
    setDescription(value);
    setCreateResponseText("");
  };

  const handleCreateFee = async (): Promise<void> => {
    logger.info("create fee button clicked", {
      description,
      feeCode,
      feeType,
      pricingType,
      amountInput,
    });

    setCreateResponseText("");

    const trimmedDescription = description.trim();
    const finalFeeCode = feeCode.trim() || generateFeeCode(trimmedDescription);
    const amountNumber = Number(amountInput);

    if (!trimmedDescription || !finalFeeCode || !Number.isFinite(amountNumber)) {
      logger.warn("create fee validation failed", {
        trimmedDescription,
        finalFeeCode,
        amountInput,
      });
      setRunState("error");
      setStatusText("Please fill all required fields");
      setErrorText("Description, Fee Code, and Amount are required.");
      return;
    }

    setIsCreatingFee(true);
    setRunState("loading");
    setStatusText("Creating fee...");
    setErrorText("");

    try {
      const headers = getEnabledGlobalHeaders();

      if (Object.keys(headers).length === 0) {
        logger.warn("global headers missing before create fee");
        setRunState("error");
        setStatusText("Global headers are missing");
        setErrorText(
          "No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers."
        );
        return;
      }

      const dealerId = getDealerIdFromHeaders(headers);

      if (!dealerId) {
        logger.error("dealer id missing from headers");
        setRunState("error");
        setStatusText("Dealer ID not found");
        setErrorText("Dealer ID was not found in Global Headers.");
        return;
      }

      const payload = buildCreatePayload({
        dealerId,
        feeCode: finalFeeCode,
        description: trimmedDescription,
        feeType,
        pricingType,
        amountInput: amountNumber,
      });

      const result = await createFee(payload, headers);

      setRunState("success");
      setStatusText(`Fee "${finalFeeCode}" created successfully`);
      setCreateResponseText(`Created successfully. Fee ID: ${result.id || "N/A"}`);
      setLastRunAt(new Date().toLocaleString());

      logger.info("fee created successfully", {
        feeCode: finalFeeCode,
        feeId: result.id || null,
      });

      setTimeout(() => {
        logger.info("clearing create form after success");
        setDescription("");
        setFeeCode("");
        setFeeType("Misc");
        setPricingType("FLAT_PRICE");
        setAmountInput("");
        setSelectedDefaultFee("");
        setCreateResponseText("");
      }, 3000);
    } catch (error: unknown) {
      logger.error("create fee failed", error);
      setRunState("error");
      setStatusText("Failed to create fee");
      setErrorText(error instanceof Error ? error.message : String(error));
      setCreateResponseText(`Error: ${error instanceof Error ? error.message : String(error)}`);
      setLastRunAt(new Date().toLocaleString());
    } finally {
      setIsCreatingFee(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
      <div
        style={{
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: 20,
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: "#f8fafc",
                marginBottom: 6,
                wordBreak: "break-word",
              }}
            >
              Fees
            </div>

            <div
              style={{
                color: "#94a3b8",
                fontSize: 14,
                lineHeight: 1.7,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              Search existing fee configurations, create new fees, and keep room for future PUT
              support. Uses active Global Headers from Settings.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className={viewMode === "home" ? "btn-postman" : "btn-secondary btn-sm"}
              type="button"
              onClick={() => setViewMode("home")}
            >
              Home
            </button>

            <button
              className={viewMode === "get" ? "btn-postman" : "btn-secondary btn-sm"}
              type="button"
              onClick={() => setViewMode("get")}
            >
              GET
            </button>

            <button
              className={viewMode === "post" ? "btn-postman" : "btn-secondary btn-sm"}
              type="button"
              onClick={() => setViewMode("post")}
            >
              POST
            </button>

            <button
              className={viewMode === "put" ? "btn-postman" : "btn-secondary btn-sm"}
              type="button"
              onClick={() => setViewMode("put")}
            >
              PUT
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <Pill label="Module" value={MODULE_NAME} />
          <Pill label="Mode" value={viewMode.toUpperCase()} />
          <Pill label="Loaded Fees" value={String(fees.length)} />
          <Pill label="Filtered Fees" value={String(filteredFees.length)} />
          <Pill label="Create Type" value={pricingType} />
          {lastRunAt ? <Pill label="Last Run" value={lastRunAt} /> : null}
        </div>

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
                : "1px solid rgba(255,255,255,0.08)",
            background:
              runState === "error"
                ? "rgba(239,68,68,0.10)"
                : runState === "success"
                ? "rgba(34,197,94,0.10)"
                : runState === "warning"
                ? "rgba(245,158,11,0.10)"
                : "rgba(255,255,255,0.03)",
            color:
              runState === "error"
                ? "#fecaca"
                : runState === "success"
                ? "#bbf7d0"
                : runState === "warning"
                ? "#fde68a"
                : "#cbd5e1",
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: errorText ? 6 : 0 }}>{statusText}</div>
          {errorText ? <div>{errorText}</div> : null}
        </div>
      </div>

      {viewMode === "home" ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          <ActionCard
            icon="📥"
            title="GET - Fetch Fee Details"
            description="Load service fee records and view them in a scrollable searchable table."
            buttonLabel="Open GET"
            onClick={() => {
              logger.info("home action clicked", { action: "get" });
              setViewMode("get");
            }}
          />

          <ActionCard
            icon="➕"
            title="POST - Create Fee Configuration"
            description="Create a new fee with auto-detected fee type, auto-generated code, and pricing setup."
            buttonLabel="Open POST"
            onClick={() => {
              logger.info("home action clicked", { action: "post" });
              setViewMode("post");
            }}
          />

          <ActionCard
            icon="✏️"
            title="PUT - Update Fee Settings"
            description="Reserved for future update support. UI placeholder is included for now."
            buttonLabel="Open PUT"
            onClick={() => {
              logger.info("home action clicked", { action: "put" });
              setViewMode("put");
            }}
          />
        </div>
      ) : null}

      {viewMode === "get" ? (
        <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
          <SectionCard title="Fetch Fee Details">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn-postman"
                type="button"
                onClick={() => {
                  void handleLoadFees();
                }}
                disabled={isLoadingFees}
              >
                {isLoadingFees ? "Loading..." : "Load Fees"}
              </button>
            </div>
          </SectionCard>

          <SectionCard title="Fee Search / Results">
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <input
                className="st-input"
                type="text"
                value={searchText}
                onChange={(e) => {
                  logger.debug("fee search input changed", { value: e.target.value });
                  setSearchText(e.target.value);
                }}
                placeholder="Search fee code, description, department, type..."
                style={{ ...inputStyle, flex: 1, minWidth: 260 }}
              />

              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 999,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.02)",
                  color: "#cbd5e1",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {filteredFees.length} / {fees.length}
              </div>
            </div>

            {fees.length === 0 ? (
              <EmptyText text="No fees loaded yet. Click Load Fees." />
            ) : (
              <div
                style={{
                  overflowX: "auto",
                  maxHeight: 560,
                  overflowY: "auto",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: 900,
                  }}
                >
                  <thead
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 1,
                      background: "#1f2937",
                    }}
                  >
                    <tr>
                      <th style={thStyle}>#</th>
                      <th style={thStyle}>Fee Code</th>
                      <th style={thStyle}>Description</th>
                      <th style={thStyle}>Department</th>
                      <th style={thStyle}>Type</th>
                      <th style={thStyle}>Active</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredFees.map((item, index) => (
                      <tr
                        key={`${item.id ?? item.feeCode ?? index}-${index}`}
                        style={{
                          borderTop: "1px solid rgba(255,255,255,0.08)",
                          background: index % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                        }}
                      >
                        <td style={tdStyle}>{index + 1}</td>
                        <td style={tdMonoStyle}>{normalizeText(item.feeCode) || "-"}</td>
                        <td style={tdStyle}>{normalizeText(item.description) || "-"}</td>
                        <td style={tdStyle}>{normalizeText(item.department) || "-"}</td>
                        <td style={tdStyle}>{normalizeText(item.type) || "-"}</td>
                        <td style={tdStyle}>
                          <span
                            style={{
                              display: "inline-flex",
                              padding: "4px 10px",
                              borderRadius: 999,
                              border: item.active
                                ? "1px solid rgba(34,197,94,0.25)"
                                : "1px solid rgba(239,68,68,0.25)",
                              background: item.active
                                ? "rgba(34,197,94,0.10)"
                                : "rgba(239,68,68,0.10)",
                              color: item.active ? "#86efac" : "#fca5a5",
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            {item.active ? "Active" : "Inactive"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      ) : null}

      {viewMode === "post" ? (
        <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
          <SectionCard title="Create Fee Configuration">
            <div
              style={{
                padding: 16,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 14,
              }}
            >
              <div
                style={{
                  color: "#f8fafc",
                  fontSize: 14,
                  fontWeight: 700,
                  marginBottom: 10,
                }}
              >
                Quick Select Default Fees
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: 8,
                }}
              >
                {DEFAULT_FEES.map((fee) => {
                  const isSelected = selectedDefaultFee === fee;

                  return (
                    <button
                      key={fee}
                      type="button"
                      onClick={() => handleDefaultFeeSelect(fee)}
                      style={{
                        minHeight: 40,
                        padding: "8px 10px",
                        borderRadius: 10,
                        border: isSelected
                          ? "1px solid rgba(0,113,227,0.45)"
                          : "1px solid rgba(255,255,255,0.08)",
                        background: isSelected
                          ? "rgba(0,113,227,0.16)"
                          : "rgba(255,255,255,0.03)",
                        color: "#e5e7eb",
                        cursor: "pointer",
                        fontSize: 13,
                        fontWeight: isSelected ? 700 : 600,
                      }}
                    >
                      {fee.replace(/\s*fee$/i, "")}
                    </button>
                  );
                })}
              </div>

              <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 8 }}>
                Click to auto-fill description, fee code, and detected fee type.
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: 14,
              }}
            >
              <Field
                label="Fee Code"
                value={feeCode}
                placeholder="Auto-generated"
                onChange={(value) => {
                  logger.debug("fee code input changed", { value });
                  setFeeCode(value);
                }}
                readOnly={false}
                hint="Editable"
              />

              <Field
                label="Description"
                value={description}
                placeholder="e.g., Wheel Weight fee, Freight fee"
                onChange={(value) => {
                  logger.debug("description input changed", { value });
                  setDescription(value);
                }}
                hint="Auto-generates code and type"
              />

              <div>
                <div style={labelStyle}>Fee Type</div>
                <select
                  className="st-input"
                  value={feeType}
                  onChange={(e) => {
                    const nextValue = e.target.value as FeeType;
                    logger.info("fee type changed manually", { nextValue });
                    setFeeType(nextValue);
                  }}
                  style={inputStyle}
                >
                  {FEE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <div style={hintStyle}>Auto-detected from description when possible</div>
              </div>

              <div>
                <div style={labelStyle}>Pricing Type</div>
                <div
                  style={{
                    minHeight: 44,
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 16,
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.02)",
                  }}
                >
                  <label style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="pricing-type-post-react"
                      value="FLAT_PRICE"
                      checked={pricingType === "FLAT_PRICE"}
                      onChange={() => {
                        logger.info("pricing type radio changed", { value: "FLAT_PRICE" });
                        setPricingType("FLAT_PRICE");
                      }}
                    />
                    <span>Flat Price ($)</span>
                  </label>

                  <label style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="pricing-type-post-react"
                      value="PERCENTAGE_PART"
                      checked={pricingType === "PERCENTAGE_PART"}
                      onChange={() => {
                        logger.info("pricing type radio changed", {
                          value: "PERCENTAGE_PART",
                        });
                        setPricingType("PERCENTAGE_PART");
                      }}
                    />
                    <span>% of Part</span>
                  </label>
                </div>
              </div>

              <Field
                label={pricingType === "FLAT_PRICE" ? "Amount ($)" : "Percentage (%)"}
                value={amountInput}
                placeholder={pricingType === "FLAT_PRICE" ? "e.g., 46.00" : "e.g., 10"}
                onChange={(value) => {
                  logger.debug("amount input changed", { value });
                  setAmountInput(value);
                }}
                type="number"
                hint={pricingType === "FLAT_PRICE" ? "Enter dollar amount" : "Enter percentage"}
              />
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn-postman"
                type="button"
                onClick={() => {
                  void handleCreateFee();
                }}
                disabled={isCreatingFee}
              >
                {isCreatingFee ? "Creating..." : "Create Fee"}
              </button>
            </div>

            {createResponseText ? (
              <div
                style={{
                  borderRadius: 12,
                  border:
                    runState === "success"
                      ? "1px solid rgba(34,197,94,0.25)"
                      : "1px solid rgba(239,68,68,0.25)",
                  background:
                    runState === "success"
                      ? "rgba(34,197,94,0.10)"
                      : "rgba(239,68,68,0.10)",
                  color: runState === "success" ? "#bbf7d0" : "#fecaca",
                  padding: "12px 14px",
                  fontSize: 13,
                  lineHeight: 1.6,
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                {createResponseText}
              </div>
            ) : null}
          </SectionCard>

          <SectionCard title="Create Form Snapshot">
            <RowLine left="Description" right={description || "—"} />
            <RowLine left="Fee Code" right={feeCode || "—"} />
            <RowLine left="Fee Type" right={feeType} />
            <RowLine left="Pricing Type" right={pricingType} />
            <RowLine
              left={pricingType === "FLAT_PRICE" ? "Amount ($)" : "Percentage (%)"}
              right={amountInput || "—"}
            />
          </SectionCard>
        </div>
      ) : null}

      {viewMode === "put" ? (
        <SectionCard title="Update Fee Settings">
          <div
            style={{
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.02)",
              padding: 28,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 56, marginBottom: 16 }}>🚧</div>

            <div
              style={{
                color: "#f8fafc",
                fontSize: 22,
                fontWeight: 800,
                marginBottom: 10,
              }}
            >
              Update Fee - Coming Soon
            </div>

            <div
              style={{
                color: "#94a3b8",
                fontSize: 14,
                lineHeight: 1.7,
                maxWidth: 700,
                margin: "0 auto 18px",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              The PUT operation for updating fees is currently under development. This section is
              intentionally reserved for future update support.
            </div>

            <div
              style={{
                maxWidth: 520,
                margin: "0 auto",
                textAlign: "left",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
                padding: 18,
              }}
            >
              <div
                style={{
                  color: "#f8fafc",
                  fontSize: 15,
                  fontWeight: 700,
                  marginBottom: 10,
                }}
              >
                Planned Features
              </div>

              <ul
                style={{
                  margin: 0,
                  paddingLeft: 18,
                  color: "#cbd5e1",
                  fontSize: 13,
                  lineHeight: 1.9,
                }}
              >
                <li>Update existing fee configurations</li>
                <li>Modify pricing and departments</li>
                <li>Change fee status (active/inactive)</li>
                <li>Edit fee codes and descriptions</li>
              </ul>
            </div>
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
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

const hintStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 12,
  marginTop: 6,
};

const radioLabelStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  color: "#e5e7eb",
  fontSize: 13,
  cursor: "pointer",
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

const SectionCard: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => (
  <div
    style={{
      borderRadius: 18,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.03)",
      padding: 18,
      minWidth: 0,
    }}
  >
    <div
      style={{
        fontSize: 18,
        fontWeight: 800,
        color: "#f8fafc",
        marginBottom: 12,
      }}
    >
      {title}
    </div>

    <div style={{ display: "grid", gap: 12 }}>{children}</div>
  </div>
);

const EmptyText: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      borderRadius: 14,
      border: "1px dashed rgba(148,163,184,0.30)",
      padding: 24,
      color: "#94a3b8",
      textAlign: "center",
    }}
  >
    {text}
  </div>
);

const ActionCard: React.FC<{
  icon: string;
  title: string;
  description: string;
  buttonLabel: string;
  onClick: () => void;
}> = ({ icon, title, description, buttonLabel, onClick }) => (
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
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          display: "grid",
          placeItems: "center",
          background: "rgba(0,184,204,0.12)",
          fontSize: 20,
        }}
      >
        {icon}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 4 }}>
          {title}
        </div>
        <div style={{ color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }}>{description}</div>
      </div>
    </div>

    <button className="btn-postman" type="button" onClick={onClick}>
      {buttonLabel}
    </button>
  </div>
);

const Field: React.FC<{
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  readOnly?: boolean;
  type?: string;
  onChange: (value: string) => void;
}> = ({ label, value, placeholder, hint, readOnly = false, type = "text", onChange }) => (
  <div>
    <div style={labelStyle}>{label}</div>
    <input
      className="st-input"
      type={type}
      value={value}
      placeholder={placeholder}
      readOnly={readOnly}
      onChange={(e) => onChange(e.target.value)}
      style={{
        ...inputStyle,
        opacity: readOnly ? 0.85 : 1,
      }}
    />
    {hint ? <div style={hintStyle}>{hint}</div> : null}
  </div>
);

const RowLine: React.FC<{
  left: string;
  right: string;
  rightColor?: string;
}> = ({ left, right, rightColor = "#cbd5e1" }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      gap: 12,
      alignItems: "flex-start",
      padding: "10px 12px",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.02)",
      flexWrap: "wrap",
    }}
  >
    <div
      style={{
        color: "#e2e8f0",
        fontSize: 13,
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        maxWidth: "100%",
      }}
    >
      {left}
    </div>

    <div
      style={{
        color: rightColor,
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        textAlign: "right",
        maxWidth: "100%",
      }}
    >
      {right}
    </div>
  </div>
);

export default FeesView;
