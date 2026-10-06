import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { loadTekionCapturedProfiles } from "../../../../services/tekionCapturedProfiles";
import { loadTekionApiSettingsBundle } from "../../../../services/tekionApiSettings";
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
];
const DEFAULT_FEES = [
    "Tire Tax fee",
    "Key Cut fee",
    "Tire Disposal fee",
    "Battery Disposal fee",
    "Wheel Weight fee",
    "Freight fee",
];
const logger = {
    debug: (...args) => console.debug("[Parts][Fees]", ...args),
    info: (...args) => console.info("[Parts][Fees]", ...args),
    warn: (...args) => console.warn("[Parts][Fees]", ...args),
    error: (...args) => console.error("[Parts][Fees]", ...args),
};
function normalizeText(value) {
    return String(value ?? "").trim();
}
function resolveActiveHeaders() {
    const storedProfileId = localStorage.getItem(SELECTED_DEALER_PROFILE_KEY);
    const profiles = loadTekionCapturedProfiles();
    const matchedProfile = storedProfileId
        ? profiles.find((p) => p.id === storedProfileId ||
            p.profileKey === storedProfileId ||
            p.dealerId === storedProfileId)
        : profiles[0] ?? null;
    let headers = {};
    let baseHost = DEFAULT_HOST;
    let dealerId = matchedProfile?.dealerId || "";
    if (matchedProfile?.bootstrapHeaders && Object.keys(matchedProfile.bootstrapHeaders).length > 0) {
        headers = { ...matchedProfile.bootstrapHeaders };
        if (matchedProfile.sourceUrl) {
            try {
                baseHost = new URL(matchedProfile.sourceUrl).origin;
            }
            catch {
                baseHost = DEFAULT_HOST;
            }
        }
    }
    else {
        const bundle = loadTekionApiSettingsBundle();
        const rows = (bundle.globalHeaders ?? []).filter((h) => h.enabled && h.key?.trim() && String(h.value ?? "").trim());
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
async function executeViaProxy(options) {
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
        throw new Error(errorJson?.error?.message ||
            errorJson?.message ||
            `Proxy request failed with HTTP ${res.status}`);
    }
    const result = await res.json();
    if (result.status >= 400) {
        throw new Error(`Upstream Tekion error (${result.status}): ${typeof result.body === "string" ? result.body : JSON.stringify(result.body)}`);
    }
    return result.body;
}
function detectFeeType(description) {
    const desc = description.toLowerCase();
    if (desc.includes("shop") && desc.includes("suppl"))
        return "ShopSupplies";
    if (desc.includes("paint") && desc.includes("material"))
        return "PaintMaterials";
    if (desc.includes("public") && (desc.includes("transport") || desc.includes("transit"))) {
        return "PublicTransport";
    }
    if (desc.includes("warranty") && desc.includes("claim"))
        return "Warranty Claim";
    if (desc.includes("admin") && desc.includes("allowance"))
        return "AdminAllowance";
    const singleKeywords = [
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
function generateFeeCode(description) {
    return description
        .replace(/\bfee(s)?\b/gi, "")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
}
function getTomorrowMidnight() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.getTime();
}
function extractFeesArray(raw) {
    if (!raw || typeof raw !== "object")
        return [];
    const response = raw;
    const data = response.data;
    if (Array.isArray(data))
        return data;
    if (data && typeof data === "object") {
        const obj = data;
        if (Array.isArray(obj.hits))
            return obj.hits;
        if (Array.isArray(obj.data))
            return obj.data;
        if (Array.isArray(obj.fees))
            return obj.fees;
    }
    return [];
}
function buildCreatePayload(args) {
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
export const FeesView = () => {
    const [runState, setRunState] = useState("idle");
    const [statusText, setStatusText] = useState("Ready to search or create fees");
    const [errorText, setErrorText] = useState("");
    const [showInfo, setShowInfo] = useState(false);
    const [fees, setFees] = useState([]);
    const [searchText, setSearchText] = useState("");
    const [isLoadingFees, setIsLoadingFees] = useState(false);
    const [inFlightAction, setInFlightAction] = useState(null);
    // Per-row input state for standard fees
    const [defaultRowStates, setDefaultRowStates] = useState(() => {
        const init = {};
        for (const f of DEFAULT_FEES) {
            init[f] = { pricingType: "FLAT_PRICE", amount: "0.00" };
        }
        return init;
    });
    // Custom fee input state
    const [customDescription, setCustomDescription] = useState("");
    const [customFeeCode, setCustomFeeCode] = useState("");
    const [customFeeType, setCustomFeeType] = useState("Misc");
    const [customPricingType, setCustomPricingType] = useState("FLAT_PRICE");
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
        if (!query)
            return fees;
        return fees.filter((item) => {
            const code = normalizeText(item.feeCode).toLowerCase();
            const desc = normalizeText(item.description).toLowerCase();
            const dept = normalizeText(item.department).toLowerCase();
            const type = normalizeText(item.type).toLowerCase();
            return (code.includes(query) ||
                desc.includes(query) ||
                dept.includes(query) ||
                type.includes(query));
        });
    }, [fees, searchText]);
    const handleLoadFees = async () => {
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
            const res = await executeViaProxy({
                url: searchUrl,
                method: "POST",
                headers,
                body: requestBody,
            });
            const rows = extractFeesArray(res);
            setFees(rows);
            setRunState("success");
            setStatusText(`✓ Retrieved ${rows.length} Parts fee record${rows.length === 1 ? "" : "s"}`);
        }
        catch (error) {
            logger.error("GET fees failed", error);
            setRunState("error");
            setStatusText("Failed to fetch fees");
            setErrorText(error instanceof Error ? error.message : String(error));
        }
        finally {
            setIsLoadingFees(false);
        }
    };
    const executeFeeCreation = async (args) => {
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
            const result = await executeViaProxy({
                url: createUrl,
                method: "POST",
                headers,
                body: payload,
            });
            setRunState("success");
            setStatusText(`✓ Fee "${args.feeCode}" created successfully (ID: ${result?.data?.id || "N/A"})`);
            void handleLoadFees();
        }
        catch (error) {
            logger.error("Create fee failed", error);
            setRunState("error");
            setStatusText(`Failed to create "${args.feeCode}"`);
            setErrorText(error instanceof Error ? error.message : String(error));
        }
        finally {
            setInFlightAction(null);
        }
    };
    const handleCreateDefaultFeeRow = (feeName) => {
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
    return (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsxs("div", { style: {
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 18,
                    display: "grid",
                    gap: 14,
                }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [_jsx("div", { style: { fontSize: 20, fontWeight: 800, color: "#f8fafc" }, children: "Fees Configuration" }), _jsx("button", { type: "button", onClick: () => setShowInfo((p) => !p), style: {
                                            width: 20,
                                            height: 20,
                                            borderRadius: 999,
                                            background: "rgba(255,255,255,0.08)",
                                            border: "1px solid rgba(255,255,255,0.15)",
                                            color: "#94a3b8",
                                            fontSize: 11,
                                            cursor: "pointer",
                                            fontWeight: 700,
                                        }, title: "Toggle Description", children: "i" })] }), _jsx("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: _jsx("button", { className: "btn-postman", type: "button", onClick: () => void handleLoadFees(), disabled: isLoadingFees || Boolean(inFlightAction), children: isLoadingFees ? "Fetching..." : "GET All Parts Fees" }) })] }), showInfo && (_jsxs("div", { style: {
                            padding: 12,
                            borderRadius: 10,
                            background: "rgba(255,255,255,0.02)",
                            border: "1px solid rgba(255,255,255,0.06)",
                            color: "#94a3b8",
                            fontSize: 12,
                            lineHeight: 1.6,
                        }, children: ["Searches and creates fee configurations strictly mapped to the ", _jsx("code", { children: "PARTS" }), " department. Specify Pricing Mode and Amount per row to deploy standard dealer fees individually, or configure a custom fee below."] })), _jsxs("div", { style: {
                            borderRadius: 12,
                            padding: "10px 14px",
                            fontSize: 13,
                            border: `1px solid ${banner.border}`,
                            background: banner.bg,
                            color: banner.text,
                        }, children: [_jsx("div", { style: { fontWeight: 700 }, children: statusText }), errorText && _jsx("div", { style: { fontSize: 12, marginTop: 4 }, children: errorText })] })] }), _jsxs("div", { style: {
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 18,
                    display: "grid",
                    gap: 12,
                }, children: [_jsx("div", { style: { fontSize: 14, fontWeight: 800, color: "#f8fafc" }, children: "Standard Parts Fee Presets" }), _jsx("div", { style: { overflowX: "auto" }, children: _jsxs("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: 750 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "rgba(255,255,255,0.04)" }, children: [_jsx("th", { style: thStyle, children: "Fee Name" }), _jsx("th", { style: thStyle, children: "Auto Code" }), _jsx("th", { style: thStyle, children: "Detected Type" }), _jsx("th", { style: { ...thStyle, width: 140 }, children: "Pricing Mode" }), _jsx("th", { style: { ...thStyle, width: 120 }, children: "Amount" }), _jsx("th", { style: { ...thStyle, textAlign: "right" }, children: "Action" })] }) }), _jsx("tbody", { children: DEFAULT_FEES.map((feeName) => {
                                        const rowState = defaultRowStates[feeName] ?? { pricingType: "FLAT_PRICE", amount: "0.00" };
                                        const isSaving = inFlightAction === feeName;
                                        const detectedCode = generateFeeCode(feeName);
                                        const detectedType = detectFeeType(feeName);
                                        return (_jsxs("tr", { style: { borderTop: "1px solid rgba(255,255,255,0.06)" }, children: [_jsx("td", { style: { ...tdStyle, fontWeight: 700, color: "#f8fafc" }, children: feeName }), _jsx("td", { style: tdMonoStyle, children: detectedCode }), _jsx("td", { style: tdStyle, children: detectedType }), _jsx("td", { style: tdStyle, children: _jsxs("select", { className: "st-input", value: rowState.pricingType, onChange: (e) => setDefaultRowStates((prev) => ({
                                                            ...prev,
                                                            [feeName]: { ...prev[feeName], pricingType: e.target.value },
                                                        })), style: { height: 32, fontSize: 12, padding: "4px 8px" }, children: [_jsx("option", { value: "FLAT_PRICE", children: "Flat ($)" }), _jsx("option", { value: "PERCENTAGE_PART", children: "% of Part" })] }) }), _jsx("td", { style: tdStyle, children: _jsx("input", { type: "number", className: "st-input", value: rowState.amount, onChange: (e) => setDefaultRowStates((prev) => ({
                                                            ...prev,
                                                            [feeName]: { ...prev[feeName], amount: e.target.value },
                                                        })), placeholder: "0.00", style: { height: 32, fontSize: 12, padding: "4px 8px" } }) }), _jsx("td", { style: { ...tdStyle, textAlign: "right" }, children: _jsx("button", { type: "button", className: "btn-secondary btn-sm", onClick: () => handleCreateDefaultFeeRow(feeName), disabled: Boolean(inFlightAction), style: { minWidth: 100 }, children: isSaving ? "Creating..." : "Create Fee" }) })] }, feeName));
                                    }) })] }) })] }), _jsxs("div", { style: {
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 18,
                    display: "grid",
                    gap: 14,
                }, children: [_jsx("div", { style: { fontSize: 14, fontWeight: 800, color: "#f8fafc" }, children: "Custom Fee Creator" }), _jsxs("div", { style: {
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                            gap: 12,
                        }, children: [_jsxs("div", { children: [_jsx("div", { style: labelStyle, children: "Description" }), _jsx("input", { type: "text", className: "st-input", value: customDescription, onChange: (e) => setCustomDescription(e.target.value), placeholder: "e.g., Hazardous Waste Fee", style: inputStyle })] }), _jsxs("div", { children: [_jsx("div", { style: labelStyle, children: "Fee Code" }), _jsx("input", { type: "text", className: "st-input", value: customFeeCode, onChange: (e) => setCustomFeeCode(e.target.value.toUpperCase()), placeholder: "Auto-generated", style: { ...inputStyle, fontFamily: "monospace", color: "#93c5fd" } })] }), _jsxs("div", { children: [_jsx("div", { style: labelStyle, children: "Fee Type" }), _jsx("select", { className: "st-input", value: customFeeType, onChange: (e) => setCustomFeeType(e.target.value), style: inputStyle, children: FEE_TYPES.map((type) => (_jsx("option", { value: type, children: type }, type))) })] }), _jsxs("div", { children: [_jsx("div", { style: labelStyle, children: "Pricing Mode" }), _jsxs("select", { className: "st-input", value: customPricingType, onChange: (e) => setCustomPricingType(e.target.value), style: inputStyle, children: [_jsx("option", { value: "FLAT_PRICE", children: "Flat ($)" }), _jsx("option", { value: "PERCENTAGE_PART", children: "% of Part" })] })] }), _jsxs("div", { children: [_jsx("div", { style: labelStyle, children: customPricingType === "FLAT_PRICE" ? "Amount ($)" : "Percentage (%)" }), _jsx("input", { type: "number", className: "st-input", value: customAmount, onChange: (e) => setCustomAmount(e.target.value), placeholder: "0.00", style: inputStyle })] })] }), _jsx("div", { style: { display: "flex", justifyContent: "flex-end" }, children: _jsx("button", { type: "button", className: "btn-postman", onClick: handleCreateCustomFee, disabled: !customDescription.trim() || !customAmount || Boolean(inFlightAction), style: { minWidth: 150 }, children: inFlightAction === "CUSTOM_FEE" ? "Creating..." : "Create Custom Fee" }) })] }), _jsxs("div", { style: {
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 16,
                }, children: [_jsxs("div", { style: {
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: 12,
                            flexWrap: "wrap",
                            gap: 10,
                        }, children: [_jsxs("div", { style: { fontSize: 14, fontWeight: 800, color: "#f8fafc" }, children: ["Existing Parts Fees", " ", fees.length > 0 && (_jsxs("span", { style: { color: "#94a3b8", fontSize: 12 }, children: ["(", filteredFees.length, " of ", fees.length, ")"] }))] }), _jsx("input", { type: "text", className: "st-input", value: searchText, onChange: (e) => setSearchText(e.target.value), placeholder: "Search fee code, description, type...", style: { width: 240, height: 32, fontSize: 12 } })] }), fees.length === 0 ? (_jsx("div", { style: {
                            padding: 24,
                            color: "#94a3b8",
                            textAlign: "center",
                            fontSize: 13,
                            borderRadius: 12,
                            border: "1px dashed rgba(255,255,255,0.1)",
                        }, children: "No fees loaded yet. Click GET All Parts Fees." })) : (_jsx("div", { style: { overflowX: "auto" }, children: _jsxs("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: 700 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "rgba(255,255,255,0.04)" }, children: [_jsx("th", { style: thStyle, children: "#" }), _jsx("th", { style: thStyle, children: "Fee Code" }), _jsx("th", { style: thStyle, children: "Description" }), _jsx("th", { style: thStyle, children: "Department" }), _jsx("th", { style: thStyle, children: "Type" }), _jsx("th", { style: thStyle, children: "Status" })] }) }), _jsx("tbody", { children: filteredFees.map((item, index) => (_jsxs("tr", { style: { borderTop: "1px solid rgba(255,255,255,0.06)" }, children: [_jsx("td", { style: tdStyle, children: index + 1 }), _jsx("td", { style: tdMonoStyle, children: normalizeText(item.feeCode) || "—" }), _jsx("td", { style: tdStyle, children: normalizeText(item.description) || "—" }), _jsx("td", { style: tdStyle, children: normalizeText(item.department) || "PARTS" }), _jsx("td", { style: tdStyle, children: normalizeText(item.type) || "—" }), _jsx("td", { style: tdStyle, children: _jsx("span", { style: {
                                                        display: "inline-flex",
                                                        padding: "2px 8px",
                                                        borderRadius: 999,
                                                        fontSize: 10,
                                                        fontWeight: 800,
                                                        background: item.active
                                                            ? "rgba(34,197,94,0.12)"
                                                            : "rgba(239,68,68,0.12)",
                                                        color: item.active ? "#86efac" : "#fca5a5",
                                                        border: `1px solid ${item.active ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}`,
                                                    }, children: item.active ? "Active" : "Inactive" }) })] }, `${item.id ?? item.feeCode ?? index}-${index}`))) })] }) }))] })] }));
};
const labelStyle = {
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
};
const inputStyle = {
    width: "100%",
    height: 38,
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 13,
    boxSizing: "border-box",
};
const thStyle = {
    textAlign: "left",
    padding: "10px 8px",
    color: "#94a3b8",
    fontSize: 11,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    whiteSpace: "nowrap",
};
const tdStyle = {
    textAlign: "left",
    padding: "10px 8px",
    color: "#e2e8f0",
    fontSize: 12,
    verticalAlign: "middle",
};
const tdMonoStyle = {
    ...tdStyle,
    fontFamily: "ui-monospace, monospace",
};
export default FeesView;
