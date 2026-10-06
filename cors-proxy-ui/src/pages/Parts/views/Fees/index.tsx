import React, { useEffect, useMemo, useState } from "react";
import { loadTekionCapturedProfiles } from "../../../../services/tekionCapturedProfiles";
import { loadTekionApiSettingsBundle } from "../../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../../types/proxy.types";

const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";
const PROXY_ENDPOINT = "http://127.0.0.1:4000/api/proxy";
const DEFAULT_HOST = "https://preprodapp.tekioncloud.com";

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

interface DefaultFeeRowState {
  pricingType: PricingType;
  amount: string;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
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

async function executeViaProxy<T>(options: {
  url: string;
  method: "GET" | "POST" | "PUT";
  headers: Record<string, string>;
  body?: unknown;
}): Promise<T> {
  const proxyPayload = {
    url: options.url,
    method: options.method,
    headers: options.headers,
    body: options.body,
    timeout: 30000,
  };

  const res = await fetch(PROXY_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(proxyPayload),
  });

  if (!res.ok) {
    const errorJson = await res.json().catch(() => ({}));
    throw new Error(
      errorJson?.error?.message ||
        errorJson?.message ||
        `Proxy request failed with HTTP ${res.status}`
    );
  }

  const result = await res.json();

  if (result.status >= 400) {
    throw new Error(
      `Upstream Tekion error (${result.status}): ${
        typeof result.body === "string" ? result.body : JSON.stringify(result.body)
      }`
    );
  }

  return result.body as T;
}

function detectFeeType(description: string): FeeType {
  const desc = description.toLowerCase();

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
      return item.type;
    }
  }

  return "Misc";
}

function generateFeeCode(description: string): string {
  return description
    .replace(/\bfee(s)?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function getTomorrowMidnight(): number {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow.getTime();
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

  return {
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
}

export const FeesView: React.FC = () => {
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready to search or create fees");
  const [errorText, setErrorText] = useState("");
  const [showInfo, setShowInfo] = useState(false);

  const [fees, setFees] = useState<FeeRecord[]>([]);
  const [searchText, setSearchText] = useState("");
  const [isLoadingFees, setIsLoadingFees] = useState(false);
  const [inFlightAction, setInFlightAction] = useState<string | null>(null);

  // Per-row input state for standard fees
  const [defaultRowStates, setDefaultRowStates] = useState<Record<string, DefaultFeeRowState>>(() => {
    const init: Record<string, DefaultFeeRowState> = {};
    for (const f of DEFAULT_FEES) {
      init[f] = { pricingType: "FLAT_PRICE", amount: "0.00" };
    }
    return init;
  });

  // Custom fee input state
  const [customDescription, setCustomDescription] = useState("");
  const [customFeeCode, setCustomFeeCode] = useState("");
  const [customFeeType, setCustomFeeType] = useState<FeeType>("Misc");
  const [customPricingType, setCustomPricingType] = useState<PricingType>("FLAT_PRICE");
  const [customAmount, setCustomAmount] = useState("");

  useEffect(() => {
    if (!customDescription.trim()) {
      setCustomFeeCode("");
      setCustomFeeType("Misc");
      return;
    }
    setCustomFeeCode(generateFeeCode(customDescription));
    setCustomFeeType(detectFeeType(customDescription));
  }, [customDescription]);

  const filteredFees = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return fees;

    return fees.filter((item) => {
      const code = normalizeText(item.feeCode).toLowerCase();
      const desc = normalizeText(item.description).toLowerCase();
      const dept = normalizeText(item.department).toLowerCase();
      const type = normalizeText(item.type).toLowerCase();

      return (
        code.includes(query) ||
        desc.includes(query) ||
        dept.includes(query) ||
        type.includes(query)
      );
    });
  }, [fees, searchText]);

  const handleLoadFees = async (): Promise<void> => {
    setIsLoadingFees(true);
    setRunState("loading");
    setStatusText("Fetching Parts fees via proxy...");
    setErrorText("");

    try {
      const { headers, baseHost } = resolveActiveHeaders();
      const searchUrl = `${baseHost}/api/service-module/u/fee/v3/search?withNoDealers=false&locale=en_US`;

      const requestBody = {
        sort: [{ field: "modifiedTime", order: "DESC" }],
        filters: [
          {
            field: "department",
            operator: "IN",
            values: ["PARTS"],
            additional: {
              value: ["PARTS"],
              option: { label: "Parts", value: "PARTS" },
              eventDetails: { action: "select-option" },
            },
          },
        ],
        searchText: null,
        groupBy: [],
        includeFields: [],
        searchableFields: [],
        excludeFields: [],
        pageInfo: { start: 0, rows: 100 },
      };

      const res = await executeViaProxy<FeeSearchResponse>({
        url: searchUrl,
        method: "POST",
        headers,
        body: requestBody,
      });

      const rows = extractFeesArray(res);
      setFees(rows);
      setRunState("success");
      setStatusText(`✓ Retrieved ${rows.length} Parts fee record${rows.length === 1 ? "" : "s"}`);
    } catch (error: unknown) {
      logger.error("GET fees failed", error);
      setRunState("error");
      setStatusText("Failed to fetch fees");
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoadingFees(false);
    }
  };

  const executeFeeCreation = async (args: {
    description: string;
    feeCode: string;
    feeType: string;
    pricingType: PricingType;
    amountInput: number;
    actionKey: string;
  }): Promise<void> => {
    setInFlightAction(args.actionKey);
    setRunState("loading");
    setStatusText(`Creating fee "${args.feeCode}"...`);
    setErrorText("");

    try {
      const { headers, baseHost, dealerId } = resolveActiveHeaders();
      const createUrl = `${baseHost}/api/service-module/u/fee/v3?locale=en_US`;

      if (!dealerId) {
        throw new Error("Dealer ID could not be identified from active profile or global headers.");
      }

      const payload = buildCreatePayload({
        dealerId,
        feeCode: args.feeCode,
        description: args.description,
        feeType: args.feeType,
        pricingType: args.pricingType,
        amountInput: args.amountInput,
      });

      const result = await executeViaProxy<{ data?: { id?: string | null }; message?: string }>({
        url: createUrl,
        method: "POST",
        headers,
        body: payload,
      });

      setRunState("success");
      setStatusText(`✓ Fee "${args.feeCode}" created successfully (ID: ${result?.data?.id || "N/A"})`);
      void handleLoadFees();
    } catch (error: unknown) {
      logger.error("Create fee failed", error);
      setRunState("error");
      setStatusText(`Failed to create "${args.feeCode}"`);
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setInFlightAction(null);
    }
  };

  const handleCreateDefaultFeeRow = (feeName: string) => {
    const rowState = defaultRowStates[feeName];
    const amountNum = Number(rowState?.amount);

    if (!Number.isFinite(amountNum) || amountNum < 0) {
      setRunState("error");
      setStatusText("Invalid Amount");
      setErrorText(`Please enter a valid non-negative amount for ${feeName}.`);
      return;
    }

    const code = generateFeeCode(feeName);
    const type = detectFeeType(feeName);

    void executeFeeCreation({
      description: feeName,
      feeCode: code,
      feeType: type,
      pricingType: rowState?.pricingType ?? "FLAT_PRICE",
      amountInput: amountNum,
      actionKey: feeName,
    });
  };

  const handleCreateCustomFee = () => {
    const desc = customDescription.trim();
    const code = customFeeCode.trim() || generateFeeCode(desc);
    const amountNum = Number(customAmount);

    if (!desc || !code || !Number.isFinite(amountNum)) {
      setRunState("error");
      setStatusText("Validation Error");
      setErrorText("Description, Fee Code, and a valid Amount are required for custom fees.");
      return;
    }

    void executeFeeCreation({
      description: desc,
      feeCode: code,
      feeType: customFeeType,
      pricingType: customPricingType,
      amountInput: amountNum,
      actionKey: "CUSTOM_FEE",
    }).then(() => {
      setCustomDescription("");
      setCustomFeeCode("");
      setCustomAmount("");
      setCustomFeeType("Misc");
      setCustomPricingType("FLAT_PRICE");
    });
  };

  const banner = useMemo(() => {
    switch (runState) {
      case "error":
        return { bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.25)", text: "#fecaca" };
      case "success":
        return { bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.25)", text: "#bbf7d0" };
      case "warning":
        return { bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.25)", text: "#fde68a" };
      default:
        return { bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.08)", text: "#cbd5e1" };
    }
  }, [runState]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Header Panel */}
      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: 18,
          display: "grid",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#f8fafc" }}>
              Fees Configuration
            </div>
            <button
              type="button"
              onClick={() => setShowInfo((p) => !p)}
              style={{
                width: 20,
                height: 20,
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "#94a3b8",
                fontSize: 11,
                cursor: "pointer",
                fontWeight: 700,
              }}
              title="Toggle Description"
            >
              i
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              className="btn-postman"
              type="button"
              onClick={() => void handleLoadFees()}
              disabled={isLoadingFees || Boolean(inFlightAction)}
            >
              {isLoadingFees ? "Fetching..." : "GET All Parts Fees"}
            </button>
          </div>
        </div>

        {showInfo && (
          <div
            style={{
              padding: 12,
              borderRadius: 10,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid rgba(255,255,255,0.06)",
              color: "#94a3b8",
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            Searches and creates fee configurations strictly mapped to the <code>PARTS</code> department.
            Specify Pricing Mode and Amount per row to deploy standard dealer fees individually, or configure a custom fee below.
          </div>
        )}

        <div
          style={{
            borderRadius: 12,
            padding: "10px 14px",
            fontSize: 13,
            border: `1px solid ${banner.border}`,
            background: banner.bg,
            color: banner.text,
          }}
        >
          <div style={{ fontWeight: 700 }}>{statusText}</div>
          {errorText && <div style={{ fontSize: 12, marginTop: 4 }}>{errorText}</div>}
        </div>
      </div>

      {/* Standard Fee Templates as Rows */}
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
        <div style={{ fontSize: 14, fontWeight: 800, color: "#f8fafc" }}>
          Standard Parts Fee Presets
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 750 }}>
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                <th style={thStyle}>Fee Name</th>
                <th style={thStyle}>Auto Code</th>
                <th style={thStyle}>Detected Type</th>
                <th style={{ ...thStyle, width: 140 }}>Pricing Mode</th>
                <th style={{ ...thStyle, width: 120 }}>Amount</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {DEFAULT_FEES.map((feeName) => {
                const rowState = defaultRowStates[feeName] ?? { pricingType: "FLAT_PRICE", amount: "0.00" };
                const isSaving = inFlightAction === feeName;
                const detectedCode = generateFeeCode(feeName);
                const detectedType = detectFeeType(feeName);

                return (
                  <tr key={feeName} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                    <td style={{ ...tdStyle, fontWeight: 700, color: "#f8fafc" }}>{feeName}</td>
                    <td style={tdMonoStyle}>{detectedCode}</td>
                    <td style={tdStyle}>{detectedType}</td>
                    <td style={tdStyle}>
                      <select
                        className="st-input"
                        value={rowState.pricingType}
                        onChange={(e) =>
                          setDefaultRowStates((prev) => ({
                            ...prev,
                            [feeName]: { ...prev[feeName], pricingType: e.target.value as PricingType },
                          }))
                        }
                        style={{ height: 32, fontSize: 12, padding: "4px 8px" }}
                      >
                        <option value="FLAT_PRICE">Flat ($)</option>
                        <option value="PERCENTAGE_PART">% of Part</option>
                      </select>
                    </td>
                    <td style={tdStyle}>
                      <input
                        type="number"
                        className="st-input"
                        value={rowState.amount}
                        onChange={(e) =>
                          setDefaultRowStates((prev) => ({
                            ...prev,
                            [feeName]: { ...prev[feeName], amount: e.target.value },
                          }))
                        }
                        placeholder="0.00"
                        style={{ height: 32, fontSize: 12, padding: "4px 8px" }}
                      />
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => handleCreateDefaultFeeRow(feeName)}
                        disabled={Boolean(inFlightAction)}
                        style={{ minWidth: 100 }}
                      >
                        {isSaving ? "Creating..." : "Create Fee"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Custom Fee Creator Placeholder */}
      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: 18,
          display: "grid",
          gap: 14,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 800, color: "#f8fafc" }}>
          Custom Fee Creator
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          <div>
            <div style={labelStyle}>Description</div>
            <input
              type="text"
              className="st-input"
              value={customDescription}
              onChange={(e) => setCustomDescription(e.target.value)}
              placeholder="e.g., Hazardous Waste Fee"
              style={inputStyle}
            />
          </div>

          <div>
            <div style={labelStyle}>Fee Code</div>
            <input
              type="text"
              className="st-input"
              value={customFeeCode}
              onChange={(e) => setCustomFeeCode(e.target.value.toUpperCase())}
              placeholder="Auto-generated"
              style={{ ...inputStyle, fontFamily: "monospace", color: "#93c5fd" }}
            />
          </div>

          <div>
            <div style={labelStyle}>Fee Type</div>
            <select
              className="st-input"
              value={customFeeType}
              onChange={(e) => setCustomFeeType(e.target.value as FeeType)}
              style={inputStyle}
            >
              {FEE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={labelStyle}>Pricing Mode</div>
            <select
              className="st-input"
              value={customPricingType}
              onChange={(e) => setCustomPricingType(e.target.value as PricingType)}
              style={inputStyle}
            >
              <option value="FLAT_PRICE">Flat ($)</option>
              <option value="PERCENTAGE_PART">% of Part</option>
            </select>
          </div>

          <div>
            <div style={labelStyle}>
              {customPricingType === "FLAT_PRICE" ? "Amount ($)" : "Percentage (%)"}
            </div>
            <input
              type="number"
              className="st-input"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder="0.00"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn-postman"
            onClick={handleCreateCustomFee}
            disabled={!customDescription.trim() || !customAmount || Boolean(inFlightAction)}
            style={{ minWidth: 150 }}
          >
            {inFlightAction === "CUSTOM_FEE" ? "Creating..." : "Create Custom Fee"}
          </button>
        </div>
      </div>

      {/* Live Server Records Table */}
      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: 16,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 800, color: "#f8fafc" }}>
            Existing Parts Fees{" "}
            {fees.length > 0 && (
              <span style={{ color: "#94a3b8", fontSize: 12 }}>
                ({filteredFees.length} of {fees.length})
              </span>
            )}
          </div>

          <input
            type="text"
            className="st-input"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search fee code, description, type..."
            style={{ width: 240, height: 32, fontSize: 12 }}
          />
        </div>

        {fees.length === 0 ? (
          <div
            style={{
              padding: 24,
              color: "#94a3b8",
              textAlign: "center",
              fontSize: 13,
              borderRadius: 12,
              border: "1px dashed rgba(255,255,255,0.1)",
            }}
          >
            No fees loaded yet. Click GET All Parts Fees.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 700 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>Fee Code</th>
                  <th style={thStyle}>Description</th>
                  <th style={thStyle}>Department</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredFees.map((item, index) => (
                  <tr
                    key={`${item.id ?? item.feeCode ?? index}-${index}`}
                    style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    <td style={tdStyle}>{index + 1}</td>
                    <td style={tdMonoStyle}>{normalizeText(item.feeCode) || "—"}</td>
                    <td style={tdStyle}>{normalizeText(item.description) || "—"}</td>
                    <td style={tdStyle}>{normalizeText(item.department) || "PARTS"}</td>
                    <td style={tdStyle}>{normalizeText(item.type) || "—"}</td>
                    <td style={tdStyle}>
                      <span
                        style={{
                          display: "inline-flex",
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontSize: 10,
                          fontWeight: 800,
                          background: item.active
                            ? "rgba(34,197,94,0.12)"
                            : "rgba(239,68,68,0.12)",
                          color: item.active ? "#86efac" : "#fca5a5",
                          border: `1px solid ${
                            item.active ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"
                          }`,
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
      </div>
    </div>
  );
};

const labelStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 11,
  fontWeight: 700,
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 38,
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 13,
  boxSizing: "border-box",
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
  padding: "10px 8px",
  color: "#e2e8f0",
  fontSize: 12,
  verticalAlign: "middle",
};

const tdMonoStyle: React.CSSProperties = {
  ...tdStyle,
  fontFamily: "ui-monospace, monospace",
};

export default FeesView;