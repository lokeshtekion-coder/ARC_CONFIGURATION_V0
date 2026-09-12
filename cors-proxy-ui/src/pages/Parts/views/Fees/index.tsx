import React, { useEffect, useMemo, useState } from "react";
import { loadTekionApiSettingsBundle } from "../../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../../types/proxy.types";

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

  return (bundle.globalHeaders ?? [])
    .filter(
      (header: KeyValuePair) =>
        header.enabled && header.key.trim() && String(header.value).trim()
    )
    .reduce<Record<string, string>>((acc, header) => {
      acc[header.key] = String(header.value);
      return acc;
    }, {});
}

function getDealerIdFromHeaders(headers: Record<string, string>): string {
  const lowerMap = Object.entries(headers).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      acc[key.toLowerCase()] = value;
      return acc;
    },
    {}
  );

  return lowerMap["dealerid"] || lowerMap["dealer-id"] || "";
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

async function fetchFees(headers: Record<string, string>): Promise<FeeRecord[]> {
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

  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });

  const json = (await response.json()) as FeeSearchResponse;

  if (!response.ok) {
    throw new Error(json?.message || `HTTP ${response.status}`);
  }

  return extractFeesArray(json);
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

async function createFee(
  payload: Record<string, unknown>,
  headers: Record<string, string>
): Promise<{ id?: string | null }> {
  const response = await fetch(CREATE_URL, {
    method: "POST",
    headers: {
      ...headers,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = (await response.json()) as {
    data?: { id?: string | null };
    message?: string;
  };

  if (!response.ok) {
    throw new Error(json?.message || `HTTP ${response.status}`);
  }

  return { id: json?.data?.id ?? null };
}

export const FeesView: React.FC = () => {
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready to search or create fees");
  const [errorText, setErrorText] = useState("");
  const [showInfo, setShowInfo] = useState(false);

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
  const [showCreateForm, setShowCreateForm] = useState(true);

  useEffect(() => {
    if (!description.trim()) {
      setFeeCode("");
      setFeeType("Misc");
      return;
    }
    setFeeCode(generateFeeCode(description));
    setFeeType(detectFeeType(description));
  }, [description]);

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
    setStatusText("Fetching Parts fees...");
    setErrorText("");

    try {
      const headers = getEnabledGlobalHeaders();
      if (Object.keys(headers).length === 0) {
        setRunState("error");
        setStatusText("Global headers missing");
        setErrorText("Configure and save active Global Headers in Settings.");
        return;
      }

      const rows = await fetchFees(headers);
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

  const handleDefaultFeeSelect = (fee: string) => {
    setSelectedDefaultFee(fee);
    setDescription(fee);
    if (!amountInput) setAmountInput("0");
  };

  const handleCreateFee = async (): Promise<void> => {
    const trimmedDescription = description.trim();
    const finalFeeCode = feeCode.trim() || generateFeeCode(trimmedDescription);
    const amountNumber = Number(amountInput);

    if (!trimmedDescription || !finalFeeCode || !Number.isFinite(amountNumber)) {
      setRunState("error");
      setStatusText("Validation Error");
      setErrorText("Description, Fee Code, and a valid Amount are required.");
      return;
    }

    setIsCreatingFee(true);
    setRunState("loading");
    setStatusText("Creating fee...");
    setErrorText("");

    try {
      const headers = getEnabledGlobalHeaders();
      if (Object.keys(headers).length === 0) {
        setRunState("error");
        setStatusText("Global headers missing");
        setErrorText("Configure and save active Global Headers in Settings.");
        return;
      }

      const dealerId = getDealerIdFromHeaders(headers);
      if (!dealerId) {
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
      setStatusText(`✓ Fee "${finalFeeCode}" created successfully (ID: ${result.id || "N/A"})`);

      // Refresh list to show newly created fee
      void handleLoadFees();

      // Reset form fields
      setDescription("");
      setFeeCode("");
      setFeeType("Misc");
      setPricingType("FLAT_PRICE");
      setAmountInput("");
      setSelectedDefaultFee("");
    } catch (error: unknown) {
      logger.error("create fee failed", error);
      setRunState("error");
      setStatusText("Failed to create fee");
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCreatingFee(false);
    }
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
      {/* Executive Header */}
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
              className="btn-secondary btn-sm"
              type="button"
              onClick={() => setShowCreateForm((prev) => !prev)}
            >
              {showCreateForm ? "Hide Creator" : "+ Create Fee"}
            </button>

            <button
              className="btn-postman"
              type="button"
              onClick={() => void handleLoadFees()}
              disabled={isLoadingFees || isCreatingFee}
            >
              {isLoadingFees ? "Fetching..." : "GET"}
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
            Selecting standard templates automatically pre-fills the fee code, category, and GL mapping.
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

      {/* Smart Fee Creator Panel */}
      {showCreateForm && (
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: "#f8fafc" }}>
              Quick Template Selector
            </span>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>
              Clicking auto-detects code & category
            </span>
          </div>

          {/* Quick Select Template Chips */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {DEFAULT_FEES.map((fee) => {
              const isSelected = selectedDefaultFee === fee;
              return (
                <button
                  key={fee}
                  type="button"
                  onClick={() => handleDefaultFeeSelect(fee)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: isSelected
                      ? "1px solid rgba(59,130,246,0.5)"
                      : "1px solid rgba(255,255,255,0.08)",
                    background: isSelected
                      ? "rgba(59,130,246,0.18)"
                      : "rgba(255,255,255,0.02)",
                    color: isSelected ? "#93c5fd" : "#cbd5e1",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  {fee.replace(/\s*fee$/i, "")}
                </button>
              );
            })}
          </div>

          {/* Compact Input Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
              marginTop: 4,
            }}
          >
            <div>
              <div style={labelStyle}>Description</div>
              <input
                className="st-input"
                type="text"
                value={description}
                onChange={(e) => {
                  setSelectedDefaultFee("");
                  setDescription(e.target.value);
                }}
                placeholder="e.g., Tire Disposal fee"
                style={inputStyle}
              />
            </div>

            <div>
              <div style={labelStyle}>Fee Code</div>
              <input
                className="st-input"
                type="text"
                value={feeCode}
                onChange={(e) => setFeeCode(e.target.value.toUpperCase())}
                placeholder="Auto-generated"
                style={{ ...inputStyle, fontFamily: "monospace", color: "#93c5fd" }}
              />
            </div>

            <div>
              <div style={labelStyle}>Fee Type</div>
              <select
                className="st-input"
                value={feeType}
                onChange={(e) => setFeeType(e.target.value as FeeType)}
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
              <div
                style={{
                  height: 38,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "0 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.02)",
                }}
              >
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", color: "#e2e8f0" }}>
                  <input
                    type="radio"
                    name="pricingType"
                    checked={pricingType === "FLAT_PRICE"}
                    onChange={() => setPricingType("FLAT_PRICE")}
                  />
                  Flat ($)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", color: "#e2e8f0" }}>
                  <input
                    type="radio"
                    name="pricingType"
                    checked={pricingType === "PERCENTAGE_PART"}
                    onChange={() => setPricingType("PERCENTAGE_PART")}
                  />
                  % of Part
                </label>
              </div>
            </div>

            <div>
              <div style={labelStyle}>
                {pricingType === "FLAT_PRICE" ? "Amount ($)" : "Percentage (%)"}
              </div>
              <input
                className="st-input"
                type="number"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder={pricingType === "FLAT_PRICE" ? "0.00" : "0"}
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
            <button
              className="btn-postman"
              type="button"
              onClick={() => void handleCreateFee()}
              disabled={isCreatingFee || !description || !amountInput}
              style={{ minWidth: 140 }}
            >
              {isCreatingFee ? "Creating..." : "Create Fee"}
            </button>
          </div>
        </div>
      )}

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
            No fees loaded yet. Click GET.
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