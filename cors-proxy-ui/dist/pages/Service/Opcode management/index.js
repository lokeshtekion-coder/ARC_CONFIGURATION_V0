import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useMemo, useState } from "react";
import { loadTekionCapturedProfiles } from "../../../services/tekionCapturedProfiles";
import { loadTekionApiSettingsBundle } from "../../../services/tekionApiSettings";
import "./OpcodeManagementView.css";
const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";
const PROXY_ENDPOINT = "http://localhost:4000/api/proxy";
const DEFAULT_HOST = "https://preprodapp.tekioncloud.com";
function normalize(value) {
    return String(value ?? "").trim();
}
function normalizeUpper(value) {
    return normalize(value).toUpperCase();
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
function generateUUID() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}
function unwrapOpcodeSearchRows(payload) {
    const root = payload;
    const rawData = root?.data ?? payload;
    if (Array.isArray(rawData))
        return rawData;
    if (rawData &&
        typeof rawData === "object" &&
        Array.isArray(rawData.hits)) {
        return rawData.hits;
    }
    if (rawData &&
        typeof rawData === "object" &&
        Array.isArray(rawData.data)) {
        return rawData.data;
    }
    if (rawData && typeof rawData === "object")
        return [rawData];
    return [];
}
function unwrapFirstOpcodeHit(hit) {
    let item = hit;
    if (!item)
        return null;
    if (Array.isArray(item.hits) &&
        item.hits.length > 0) {
        item = item.hits[0];
    }
    else if (item.data && !item.opcode) {
        const nested = item.data;
        item = Array.isArray(nested) ? nested[0] : nested;
    }
    return item && typeof item === "object" ? item : null;
}
function matchLaborRates(laborRates) {
    const rateMap = {};
    laborRates.forEach((rate) => {
        const code = normalizeUpper(rate.code);
        const name = normalizeUpper(rate.name);
        const description = normalizeUpper(rate.description);
        const id = normalize(rate.id);
        if (!id)
            return;
        if (code === "CP" ||
            name === "CP" ||
            name.includes("CUSTOMER PAY") ||
            description.includes("CUSTOMER")) {
            rateMap.CUSTOMER_PAY = id;
        }
        else if (code === "IP" ||
            name === "IP" ||
            name.includes("INTERNAL") ||
            description.includes("INTERNAL")) {
            rateMap.INTERNAL = id;
        }
        else if (code === "WP" ||
            name === "WP" ||
            name.includes("WARRANTY") ||
            description.includes("WARRANTY")) {
            rateMap.WARRANTY = id;
        }
    });
    return rateMap;
}
function buildMPVIPayload(currentData, serviceTypeResult) {
    const existingIds = Array.isArray(currentData.serviceTypeIds) ? [...currentData.serviceTypeIds] : [];
    const idsSet = new Set(existingIds);
    if (serviceTypeResult?.serviceTypeIds) {
        Object.values(serviceTypeResult.serviceTypeIds).forEach((id) => {
            if (id)
                idsSet.add(id);
        });
    }
    return {
        ...currentData,
        opcode: "MPVI",
        opcodeType: "INSPECTION",
        inspectionType: "MPVI",
        category: "MPVI",
        serviceTypeIds: Array.from(idsSet),
        description: currentData.description || "PERFORM CERTIFIED MULTI-POINT VEHICLE INSPECTION",
        customerDescription: currentData.customerDescription ||
            "PERFORM CERTIFIED MULTI-POINT VEHICLE INSPECTION",
        displayValue: currentData.displayValue || "MPVI",
        status: currentData.status || "ACTIVE",
    };
}
function buildSubletPayload(currentData, subletServiceType) {
    return {
        ...currentData,
        serviceTypeIds: subletServiceType.id ? [subletServiceType.id] : [],
        subletOpCode: true,
        priceDetails: null,
        serviceTypes: [
            {
                name: subletServiceType.name,
                key: subletServiceType.key,
                id: subletServiceType.id,
                priceDetails: [
                    {
                        payType: "CUSTOMER_PAY",
                        subPayType: "CUSTOMER_PAY",
                        priceCode: null,
                        laborRateType: null,
                        laborRateId: null,
                        pricePerHour: null,
                        flatPrice: null,
                    },
                    {
                        payType: "INTERNAL",
                        subPayType: "INTERNAL",
                        priceCode: null,
                        laborRateType: null,
                        laborRateId: null,
                        pricePerHour: null,
                        flatPrice: null,
                    },
                    {
                        payType: "WARRANTY",
                        subPayType: "WARRANTY",
                        priceCode: null,
                        laborRateType: null,
                        laborRateId: null,
                        pricePerHour: null,
                        flatPrice: null,
                    },
                ],
            },
        ],
    };
}
function buildPDIPayload(currentData, pdiServiceType) {
    return {
        ...currentData,
        serviceTypeIds: pdiServiceType.id ? [pdiServiceType.id] : [],
        priceDetails: null,
        serviceTypes: [
            {
                name: pdiServiceType.name,
                key: pdiServiceType.key,
                id: pdiServiceType.id,
                priceDetails: [
                    {
                        payType: "CUSTOMER_PAY",
                        subPayType: "CUSTOMER_PAY",
                        priceCode: null,
                        laborRateType: null,
                        laborRateId: null,
                        pricePerHour: null,
                        flatPrice: null,
                    },
                    {
                        payType: "INTERNAL",
                        subPayType: "INTERNAL",
                        priceCode: null,
                        laborRateType: null,
                        laborRateId: null,
                        pricePerHour: null,
                        flatPrice: null,
                    },
                    {
                        payType: "WARRANTY",
                        subPayType: "WARRANTY",
                        priceCode: null,
                        laborRateType: null,
                        laborRateId: null,
                        pricePerHour: null,
                        flatPrice: null,
                    },
                ],
            },
        ],
    };
}
export const OpcodeManagementView = () => {
    const [activeView, setActiveView] = useState("home");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);
    const [getRows, setGetRows] = useState([]);
    const [rawGetResponse, setRawGetResponse] = useState(null);
    const [showRawGet, setShowRawGet] = useState(false);
    const [serviceTypes, setServiceTypes] = useState([]);
    const [serviceTypesPreviewVisible, setServiceTypesPreviewVisible] = useState(false);
    const [customServiceTypeName, setCustomServiceTypeName] = useState("");
    const [validationResult, setValidationResult] = useState(null);
    const { headers: activeHeaders, baseHost, dealerId } = useMemo(() => resolveActiveHeaders(), []);
    const headerCount = useMemo(() => Object.keys(activeHeaders).length, [activeHeaders]);
    const resetTransientStateForView = useCallback((nextView) => {
        setMessage(null);
        setValidationResult(null);
        if (nextView !== "get") {
            setGetRows([]);
            setRawGetResponse(null);
            setShowRawGet(false);
        }
        if (nextView !== "service-types") {
            setServiceTypesPreviewVisible(false);
        }
        if (nextView !== "custom-service-type") {
            setCustomServiceTypeName("");
        }
    }, []);
    const proxyRequest = useCallback(async (payload) => {
        const res = await fetch(PROXY_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url: payload.url,
                method: payload.method,
                headers: {
                    ...activeHeaders,
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
            throw new Error(`${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim());
        }
        return json?.body ?? json?.data ?? json;
    }, [activeHeaders]);
    const fetchServiceTypes = useCallback(async () => {
        const payload = await proxyRequest({
            url: `${baseHost}/api/service-module/u/opcode/serviceTypes`,
            method: "GET",
        });
        const rows = Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload)
                ? payload
                : [];
        setServiceTypes(rows);
        return rows;
    }, [baseHost, proxyRequest]);
    const fetchLaborRates = useCallback(async () => {
        const payload = await proxyRequest({
            url: `${baseHost}/api/service-module/u/labor-pricing/laborRate`,
            method: "GET",
        });
        const rows = Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload)
                ? payload
                : [];
        return rows;
    }, [baseHost, proxyRequest]);
    const createServiceType = useCallback(async (typeName, rateMap) => {
        const createLaborRateConfig = (subPayType, laborRateId, order, serviceTypeId = null) => ({
            id: generateUUID(),
            parentId: null,
            values: [
                {
                    field: "LABOR_RATE",
                    value: {
                        type: "DYNAMIC",
                        value: null,
                        id: laborRateId,
                    },
                },
            ],
            order,
            sourceModuleInfo: {
                sourceModule: "SERVICE_TYPE",
                sourceModuleAssetId: serviceTypeId,
                sourceAdditionalDetails: null,
            },
            parameters: [
                {
                    parameter: "SUB_PAY_TYPE",
                    values: [subPayType],
                    allValues: false,
                },
                {
                    parameter: "CUSTOMER_TYPE",
                    values: [],
                    allValues: true,
                },
            ],
        });
        const payload = {
            name: typeName,
            status: "ACTIVE",
            laborRateConfigInfo: {
                deleted: [],
                updated: [],
                added: [
                    createLaborRateConfig("CUSTOMER_PAY", rateMap.CUSTOMER_PAY, 3),
                    createLaborRateConfig("INTERNAL", rateMap.INTERNAL, 2),
                    createLaborRateConfig("WARRANTY", rateMap.WARRANTY, 1),
                ],
            },
        };
        return await proxyRequest({
            url: `${baseHost}/api/service-module/u/opcode/serviceType/create`,
            method: "POST",
            body: payload,
        });
    }, [baseHost, proxyRequest]);
    const configureServiceType = useCallback(async (id, name, rateMap) => {
        const createLaborRateConfig = (subPayType, laborRateId, order) => ({
            id: generateUUID(),
            parentId: null,
            values: [
                {
                    field: "LABOR_RATE",
                    value: {
                        type: "DYNAMIC",
                        value: null,
                        id: laborRateId,
                    },
                },
            ],
            order,
            sourceModuleInfo: {
                sourceModule: "SERVICE_TYPE",
                sourceModuleAssetId: id,
                sourceAdditionalDetails: null,
            },
            parameters: [
                {
                    parameter: "SUB_PAY_TYPE",
                    values: [subPayType],
                    allValues: false,
                },
                {
                    parameter: "CUSTOMER_TYPE",
                    values: [],
                    allValues: true,
                },
            ],
        });
        const payload = {
            name,
            status: "ACTIVE",
            laborRateConfigInfo: {
                deleted: [],
                updated: [],
                added: [
                    createLaborRateConfig("CUSTOMER_PAY", rateMap.CUSTOMER_PAY, 3),
                    createLaborRateConfig("INTERNAL", rateMap.INTERNAL, 2),
                    createLaborRateConfig("WARRANTY", rateMap.WARRANTY, 1),
                ],
            },
        };
        return await proxyRequest({
            url: `${baseHost}/api/service-module/u/opcode/serviceType/${id}/update`,
            method: "PUT",
            body: payload,
        });
    }, [baseHost, proxyRequest]);
    const performServiceTypeSetup = useCallback(async () => {
        try {
            const laborRates = await fetchLaborRates();
            const rateMap = matchLaborRates(laborRates);
            const missing = [];
            if (!rateMap.CUSTOMER_PAY)
                missing.push("Customer Pay (CP)");
            if (!rateMap.INTERNAL)
                missing.push("Internal (IP)");
            if (!rateMap.WARRANTY)
                missing.push("Warranty (WP)");
            if (missing.length > 0) {
                return {
                    success: false,
                    error: `Missing required labor rates: ${missing.join(", ")}. Please configure Labor Pricing first.`,
                };
            }
            let currentServiceTypes = await fetchServiceTypes();
            const created = [];
            const serviceTypeIds = {};
            const existingPdi = currentServiceTypes.find((st) => normalizeUpper(st.name) === "PDI" || normalizeUpper(st.key) === "PDI");
            const existingSublet = currentServiceTypes.find((st) => normalizeUpper(st.name) === "SUBLET" || normalizeUpper(st.key) === "SUBLET");
            if (!existingPdi) {
                await createServiceType("PDI", rateMap);
                created.push("PDI");
            }
            if (!existingSublet) {
                await createServiceType("Sublet", rateMap);
                created.push("Sublet");
            }
            currentServiceTypes = await fetchServiceTypes();
            currentServiceTypes.forEach((st) => {
                if (st.id && st.name)
                    serviceTypeIds[normalizeUpper(st.name)] = st.id;
                if (st.id && st.key)
                    serviceTypeIds[normalizeUpper(st.key)] = st.id;
            });
            const needsConfig = currentServiceTypes.filter((st) => !Array.isArray(st.laborRateConfigs) || st.laborRateConfigs.length === 0);
            let configured = 0;
            for (const st of needsConfig) {
                if (!st.id || !st.name)
                    continue;
                await configureServiceType(st.id, st.name, rateMap);
                configured += 1;
            }
            return {
                success: true,
                created,
                configured,
                skipped: Math.max(0, currentServiceTypes.length - needsConfig.length),
                serviceTypeIds,
            };
        }
        catch (e) {
            return {
                success: false,
                error: e instanceof Error ? e.message : "Service type setup failed",
            };
        }
    }, [configureServiceType, createServiceType, fetchLaborRates, fetchServiceTypes]);
    const performMPVIConfiguration = useCallback(async (setupResult) => {
        try {
            const searchResponse = await proxyRequest({
                url: `${baseHost}/api/service-module/u/opcode/search`,
                method: "POST",
                body: { searchText: "MPVI" },
            });
            const rows = unwrapOpcodeSearchRows(searchResponse);
            if (rows.length === 0) {
                return { success: false, error: "MPVI opcode not found in search results." };
            }
            const mpviSearchHit = unwrapFirstOpcodeHit(rows[0]);
            const opcodeIdentifier = normalize(mpviSearchHit?.opcode) ||
                normalize(mpviSearchHit?.code) ||
                normalize(mpviSearchHit?.displayValue);
            if (!opcodeIdentifier) {
                return { success: false, error: "Cannot determine MPVI opcode identifier." };
            }
            const detailsResponse = await proxyRequest({
                url: `${baseHost}/api/service-module/u/opcode/${opcodeIdentifier}/v2`,
                method: "GET",
            });
            const opcode = (detailsResponse.data ?? detailsResponse);
            if (!opcode?.id || !opcode?.opcode) {
                return {
                    success: false,
                    error: "MPVI payload from GET is missing required identifiers.",
                };
            }
            const needsUpdate = normalize(opcode.opcodeType) !== "INSPECTION" ||
                normalize(opcode.inspectionType) !== "MPVI";
            if (!needsUpdate) {
                return {
                    success: true,
                    action: "Already configured correctly",
                    validated: true,
                };
            }
            const payload = setupResult
                ? buildMPVIPayload(opcode, setupResult)
                : {
                    ...opcode,
                    opcodeType: "INSPECTION",
                    inspectionType: "MPVI",
                };
            await proxyRequest({
                url: `${baseHost}/api/service-module/u/opcode/v2/${opcode.id}`,
                method: "PUT",
                body: payload,
            });
            return {
                success: true,
                action: "Updated to INSPECTION / MPVI",
                validated: true,
            };
        }
        catch (e) {
            return {
                success: false,
                error: e instanceof Error ? e.message : "MPVI configuration failed",
            };
        }
    }, [baseHost, proxyRequest]);
    const performSubletConfiguration = useCallback(async () => {
        try {
            const rows = await fetchServiceTypes();
            const subletServiceType = rows.find((st) => normalizeUpper(st.key) === "SUBLET" || normalizeUpper(st.name) === "SUBLET") ?? null;
            if (!subletServiceType?.id) {
                return {
                    success: false,
                    error: "Sublet service type not found. Run Service Types setup first.",
                };
            }
            const detailsResponse = await proxyRequest({
                url: `${baseHost}/api/service-module/u/opcode/SUBLET/v2`,
                method: "GET",
            });
            const opcode = (detailsResponse.data ?? detailsResponse);
            const checks = {
                hasServiceTypeIds: Array.isArray(opcode?.serviceTypeIds),
                includesCorrectServiceType: opcode?.serviceTypeIds?.includes(subletServiceType.id) ?? false,
                subletFlagEnabled: opcode?.subletOpCode === true,
                priceDetailsIsNull: opcode?.priceDetails === null,
            };
            const needsUpdate = !checks.hasServiceTypeIds ||
                !checks.includesCorrectServiceType ||
                !checks.subletFlagEnabled ||
                !checks.priceDetailsIsNull;
            if (!needsUpdate) {
                return {
                    success: true,
                    action: "Already configured correctly",
                    validated: true,
                    serviceTypeName: subletServiceType.name,
                    serviceTypeId: subletServiceType.id,
                };
            }
            await proxyRequest({
                url: `${baseHost}/api/service-module/u/opcode/v2/${opcode.id}`,
                method: "PUT",
                body: buildSubletPayload(opcode, subletServiceType),
            });
            return {
                success: true,
                action: "Updated with correct service type and sublet flag",
                validated: true,
                serviceTypeName: subletServiceType.name,
                serviceTypeId: subletServiceType.id,
            };
        }
        catch (e) {
            return {
                success: false,
                error: e instanceof Error ? e.message : "Sublet configuration failed",
            };
        }
    }, [baseHost, fetchServiceTypes, proxyRequest]);
    const performPDIConfiguration = useCallback(async () => {
        try {
            const rows = await fetchServiceTypes();
            const pdiServiceType = rows.find((st) => normalizeUpper(st.key) === "PDI" || normalizeUpper(st.name) === "PDI") ?? null;
            if (!pdiServiceType?.id) {
                return {
                    success: false,
                    error: "PDI service type not found. Run Service Types setup first.",
                };
            }
            const detailsResponse = await proxyRequest({
                url: `${baseHost}/api/service-module/u/opcode/PDI/v2`,
                method: "GET",
            });
            const opcode = (detailsResponse.data ?? detailsResponse);
            const checks = {
                hasServiceTypeIds: Array.isArray(opcode?.serviceTypeIds),
                includesCorrectServiceType: opcode?.serviceTypeIds?.includes(pdiServiceType.id) ?? false,
                priceDetailsIsNull: opcode?.priceDetails === null,
            };
            const needsUpdate = !checks.hasServiceTypeIds ||
                !checks.includesCorrectServiceType ||
                !checks.priceDetailsIsNull;
            if (!needsUpdate) {
                return {
                    success: true,
                    action: "Already configured correctly",
                    validated: true,
                    serviceTypeName: pdiServiceType.name,
                    serviceTypeId: pdiServiceType.id,
                };
            }
            await proxyRequest({
                url: `${baseHost}/api/service-module/u/opcode/v2/${opcode.id}`,
                method: "PUT",
                body: buildPDIPayload(opcode, pdiServiceType),
            });
            return {
                success: true,
                action: "Updated with PDI service type and pricing structure",
                validated: true,
                serviceTypeName: pdiServiceType.name,
                serviceTypeId: pdiServiceType.id,
            };
        }
        catch (e) {
            return {
                success: false,
                error: e instanceof Error ? e.message : "PDI configuration failed",
            };
        }
    }, [baseHost, fetchServiceTypes, proxyRequest]);
    const createCustConcernOpcode = useCallback(async () => {
        try {
            try {
                await proxyRequest({
                    url: `${baseHost}/api/service-module/u/opcode/CUST/v2`,
                    method: "GET",
                });
                return {
                    success: true,
                    action: "Already exists",
                    opcodeId: "CUST",
                };
            }
            catch {
                // continue create flow
            }
            const serviceTypeRows = await fetchServiceTypes();
            const mainService = serviceTypeRows.find((st) => normalizeUpper(st.key) === "MAIN_SERVICE" ||
                normalizeUpper(st.name) === "MAIN SERVICE" ||
                normalizeUpper(st.name).includes("MAIN")) ?? null;
            const serviceTypeIds = mainService?.id
                ? [mainService.id]
                : serviceTypeRows[0]?.id
                    ? [serviceTypeRows[0].id]
                    : [];
            let skillId = null;
            try {
                const mpviResponse = await proxyRequest({
                    url: `${baseHost}/api/service-module/u/opcode/MPVI/v2`,
                    method: "GET",
                });
                skillId =
                    normalize((mpviResponse.data ?? mpviResponse)?.skillId) || null;
            }
            catch {
                // ignore
            }
            if (!skillId) {
                try {
                    const pdiResponse = await proxyRequest({
                        url: `${baseHost}/api/service-module/u/opcode/PDI/v2`,
                        method: "GET",
                    });
                    skillId =
                        normalize((pdiResponse.data ?? pdiResponse)?.skillId) || null;
                }
                catch {
                    // ignore
                }
            }
            if (!skillId) {
                return {
                    success: false,
                    error: "Failed to determine skillId for CUST opcode. Create MPVI or PDI first.",
                };
            }
            const payload = {
                inspectionType: null,
                category: "MISCELLANEOUS",
                serviceTypeIds,
                description: "CUST CONCERN",
                customerDescription: "CUST CONCERN",
                causes: [],
                storyLinesV2: [],
                defaultSubPayType: "CUSTOMER_PAY",
                defaultPayType: "CUSTOMER_PAY",
                eligibleForCPSpecialLaborPricing: true,
                customerPartPricingEnabled: true,
                partsPricingCapEnabled: false,
                partsSalePricingType: "MAX_PARTS_PRICE",
                eligibleForPartPreparation: true,
                forcedPartSelectionEnabled: false,
                canOverrideWarrantyCostCenter: true,
                canOverrideInternalCostCenter: true,
                clockInMandatory: false,
                laborTimeInSeconds: "",
                customerLaborTimeInSeconds: "",
                manufacturerLaborTimeInSeconds: "",
                accountingGroup: null,
                laborRateConfigInfo: {
                    deleted: [],
                    updated: [],
                    added: [],
                },
                linkedOpcodesV2: [],
                suggestedOpcodes: [],
                fees: [],
                parts: [],
                labels: [],
                oemOpcodes: [],
                subletOpCode: false,
                autoDispatch: true,
                autoComplete: false,
                subletMarkUpDetails: [],
                skillId,
                priority: 100,
                opcodeSource: "DEALER_DEFINED",
                eligibility: {
                    criteria: [
                        {
                            operator: "IN",
                            field: "SERVICE_FLOW",
                            values: [
                                "QUOTE",
                                "BDC_SCHEDULING",
                                "WEB_CHECK_IN",
                                "MOBILE_CHECK_IN",
                                "RO_JOB",
                                "RO_RECOMMENDATION",
                                "MPVI_RECOMMENDATION",
                                "QUICK_RO",
                            ],
                        },
                    ],
                },
                systemOpcode: "",
                opcode: "CUST",
                opcodeType: "INDIVIDUAL_SERVICE",
                displayValue: "CONCERN",
                status: "ACTIVE",
            };
            const createResponse = await proxyRequest({
                url: `${baseHost}/api/service-module/u/opcode/v2/create`,
                method: "POST",
                body: payload,
            });
            const createdRoot = createResponse ?? {};
            return {
                success: true,
                action: "Created successfully",
                opcodeId: normalize(createdRoot.data?.id || createdRoot.id) || "CUST",
            };
        }
        catch (e) {
            return {
                success: false,
                error: e instanceof Error ? e.message : "Failed to create CUST CONCERN",
            };
        }
    }, [baseHost, fetchServiceTypes, proxyRequest]);
    const performCustConfiguration = useCallback(async () => {
        try {
            const searchPayload = {
                pageInfo: { start: 0, rows: 50 },
                searchText: "cust",
                sort: [{ order: "DESC", field: "createdTime" }],
                filters: [],
                nextPageToken: null,
                searchFields: ["OPCODE", "DESCRIPTION", "CONSUMER_SCHEDULING_NAME"],
            };
            const searchResponse = await proxyRequest({
                url: `${baseHost}/api/service-module/u/opcode/search`,
                method: "POST",
                body: searchPayload,
            });
            const rows = unwrapOpcodeSearchRows(searchResponse)
                .map(unwrapFirstOpcodeHit)
                .filter(Boolean);
            const existing = rows.find((op) => {
                const opcode = normalizeUpper(op.opcode || op.code || op.displayValue);
                const desc = normalizeUpper(op.description || op.customerDescription);
                return opcode === "CUST" || desc.includes("CUST CONCERN");
            });
            if (existing) {
                return {
                    success: true,
                    action: "Already exists (found via search)",
                    validated: true,
                    opcodeId: normalize(existing.id || existing.opcode || "CUST"),
                };
            }
            return await createCustConcernOpcode();
        }
        catch (e) {
            return {
                success: false,
                error: e instanceof Error ? e.message : "CUST configuration failed",
            };
        }
    }, [baseHost, createCustConcernOpcode, proxyRequest]);
    const runGetAllOpcodes = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        try {
            const searchPayload = {
                pageInfo: { start: 0, rows: 100 },
                searchText: "",
                sort: [{ order: "DESC", field: "createdTime" }],
                filters: [],
                nextPageToken: null,
                searchFields: ["OPCODE", "DESCRIPTION", "CONSUMER_SCHEDULING_NAME"],
            };
            const payload = await proxyRequest({
                url: `${baseHost}/api/service-module/u/opcode/search`,
                method: "POST",
                body: searchPayload,
            });
            const rows = payload?.data?.hits ?? unwrapOpcodeSearchRows(payload);
            setRawGetResponse(payload);
            setGetRows(Array.isArray(rows) ? rows : []);
            setMessage({
                ok: true,
                text: `Fetched ${Array.isArray(rows) ? rows.length : 0} opcode record(s) successfully.`,
            });
        }
        catch (e) {
            setGetRows([]);
            setRawGetResponse(null);
            setMessage({
                ok: false,
                text: e instanceof Error ? e.message : "Failed to fetch opcodes",
            });
        }
        finally {
            setLoading(false);
        }
    }, [baseHost, proxyRequest]);
    const runServiceTypesSetup = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        setValidationResult(null);
        try {
            const result = await performServiceTypeSetup();
            if (!result.success) {
                setMessage({
                    ok: false,
                    text: result.error || "Service type setup failed",
                });
                return;
            }
            await fetchServiceTypes();
            setServiceTypesPreviewVisible(true);
            setMessage({
                ok: true,
                text: `Service Types setup complete. Created: ${result.created?.length ?? 0}, Configured: ${result.configured ?? 0}, Skipped: ${result.skipped ?? 0}.`,
            });
        }
        finally {
            setLoading(false);
        }
    }, [fetchServiceTypes, performServiceTypeSetup]);
    const runQuickSetup = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        setValidationResult(null);
        try {
            const stResult = await performServiceTypeSetup();
            if (!stResult.success) {
                setMessage({
                    ok: false,
                    text: stResult.error || "Service Type setup failed. MPVI configuration skipped.",
                });
                return;
            }
            const mpviResult = await performMPVIConfiguration(stResult);
            setValidationResult(mpviResult);
            await fetchServiceTypes();
            setServiceTypesPreviewVisible(true);
            if (!mpviResult.success) {
                setMessage({
                    ok: false,
                    text: `Service Types success, MPVI failed: ${mpviResult.error}`,
                });
                return;
            }
            setMessage({
                ok: true,
                text: `Quick Setup complete. Service Types configured and MPVI result: ${mpviResult.action}.`,
            });
        }
        finally {
            setLoading(false);
        }
    }, [fetchServiceTypes, performMPVIConfiguration, performServiceTypeSetup]);
    const runAutoConfigureIndividual = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        setValidationResult(null);
        try {
            const sublet = await performSubletConfiguration();
            const pdi = await performPDIConfiguration();
            const cust = await createCustConcernOpcode();
            const okCount = [sublet, pdi, cust].filter((x) => x.success).length;
            setValidationResult({
                success: okCount === 3,
                action: `SUBLET: ${sublet.action || sublet.error || "-"} | PDI: ${pdi.action || pdi.error || "-"} | CUST: ${cust.action || cust.error || "-"}`,
            });
            setMessage({
                ok: okCount === 3,
                text: `Individual opcode configuration completed. Success: ${okCount}/3.`,
            });
        }
        finally {
            setLoading(false);
        }
    }, [createCustConcernOpcode, performPDIConfiguration, performSubletConfiguration]);
    const runSingleValidation = useCallback(async (key) => {
        setLoading(true);
        setMessage(null);
        setValidationResult(null);
        try {
            let result;
            if (key === "mpvi") {
                result = await performMPVIConfiguration(null);
            }
            else if (key === "sublet") {
                result = await performSubletConfiguration();
            }
            else if (key === "pdi") {
                result = await performPDIConfiguration();
            }
            else {
                result = await performCustConfiguration();
            }
            setValidationResult(result);
            setMessage({
                ok: result.success,
                text: result.success
                    ? `${key.toUpperCase()} — ${result.action}`
                    : `${key.toUpperCase()} — ${result.error}`,
            });
        }
        finally {
            setLoading(false);
        }
    }, [
        performCustConfiguration,
        performMPVIConfiguration,
        performPDIConfiguration,
        performSubletConfiguration,
    ]);
    const runCreateCustomServiceType = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        try {
            const typeName = normalize(customServiceTypeName);
            if (!typeName) {
                setMessage({ ok: false, text: "Please enter a Service Type name." });
                return;
            }
            const existingRows = await fetchServiceTypes();
            const alreadyExists = existingRows.find((st) => normalizeUpper(st.name) === normalizeUpper(typeName));
            if (alreadyExists) {
                setMessage({
                    ok: false,
                    text: `Service type "${typeName}" already exists${alreadyExists.id ? ` (id: ${alreadyExists.id})` : ""}.`,
                });
                return;
            }
            const laborRates = await fetchLaborRates();
            const rateMap = matchLaborRates(laborRates);
            if (!rateMap.CUSTOMER_PAY || !rateMap.INTERNAL || !rateMap.WARRANTY) {
                setMessage({
                    ok: false,
                    text: "Missing CP/IP/WP labor rates. Please configure Labor Pricing first.",
                });
                return;
            }
            await createServiceType(typeName, rateMap);
            await fetchServiceTypes();
            setServiceTypesPreviewVisible(true);
            setMessage({
                ok: true,
                text: `Custom service type "${typeName}" created successfully.`,
            });
            setCustomServiceTypeName("");
        }
        finally {
            setLoading(false);
        }
    }, [createServiceType, customServiceTypeName, fetchLaborRates, fetchServiceTypes]);
    const serviceTypeStats = useMemo(() => {
        const total = serviceTypes.length;
        const linked = serviceTypes.filter((x) => Array.isArray(x.laborRateConfigs) && x.laborRateConfigs.length > 0).length;
        const unlinked = total - linked;
        return { total, linked, unlinked };
    }, [serviceTypes]);
    const switchView = (view) => {
        resetTransientStateForView(view);
        setActiveView(view);
    };
    return (_jsxs("div", { className: "opcode-management-scroll", children: [_jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsxs("span", { className: "op-badge", children: ["Dealer ID: ", _jsx("b", { style: { color: dealerId ? "#86efac" : "#fca5a5" }, children: dealerId || "Not found" })] }), _jsxs("span", { className: "op-badge", children: ["Active Headers: ", _jsx("b", { style: { color: "#f8fafc" }, children: headerCount })] }), _jsxs("span", { className: "op-badge", children: ["API Base: ", _jsx("b", { style: { color: "#f8fafc" }, children: "/service-module/u/opcode" })] })] }), _jsxs("div", { className: "op-card", children: [_jsx("div", { style: {
                            display: "flex",
                            alignItems: "flex-start",
                            justifyContent: "space-between",
                            gap: 12,
                            flexWrap: "wrap",
                            marginBottom: 12,
                        }, children: _jsx("div", { children: _jsx("div", { style: { color: "#f8fafc", fontSize: 18, fontWeight: 800 }, children: "Opcode Management" }) }) }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { className: activeView === "post" ? "btn-primary" : "btn-secondary btn-sm", onClick: () => switchView("post"), children: "\u2699 Post / Configure" }), _jsx("button", { className: activeView === "get" ? "btn-primary" : "btn-secondary btn-sm", onClick: () => switchView("get"), children: "\uD83D\uDCE5 Get Opcodes" }), _jsx("button", { className: activeView === "service-types" ? "btn-primary" : "btn-secondary btn-sm", onClick: () => switchView("service-types"), children: "Service Types" }), _jsx("button", { className: activeView === "custom-service-type" ? "btn-primary" : "btn-secondary btn-sm", onClick: () => switchView("custom-service-type"), children: "Custom Service Type" }), _jsx("button", { className: activeView === "mpvi" ? "btn-primary" : "btn-secondary btn-sm", onClick: () => switchView("mpvi"), children: "MPVI" }), _jsx("button", { className: activeView === "sublet" ? "btn-primary" : "btn-secondary btn-sm", onClick: () => switchView("sublet"), children: "SUBLET" }), _jsx("button", { className: activeView === "pdi" ? "btn-primary" : "btn-secondary btn-sm", onClick: () => switchView("pdi"), children: "PDI" }), _jsx("button", { className: activeView === "cust" ? "btn-primary" : "btn-secondary btn-sm", onClick: () => switchView("cust"), children: "CUST" })] })] }), message ? (_jsx("div", { className: `op-status-box ${message.ok ? "op-status-success" : "op-status-error"}`, children: message.text })) : null, validationResult ? (_jsxs("div", { className: "op-card", children: [_jsxs("div", { style: {
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: 12,
                            flexWrap: "wrap",
                            marginBottom: 8,
                        }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 16, fontWeight: 800 }, children: "Latest Validation Result" }), _jsx("span", { className: validationResult.success ? "op-pill-success" : "op-pill-error", children: validationResult.success ? "SUCCESS" : "FAILED" })] }), _jsx("div", { style: { color: "#cbd5e1", fontSize: 13, lineHeight: 1.7 }, children: validationResult.action || validationResult.error || "—" })] })) : null, activeView === "home" ? (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsxs("div", { className: "op-card", children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }, children: "Quick Actions" }), _jsxs("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }, children: [_jsx("button", { className: "btn-primary", onClick: () => void runQuickSetup(), disabled: loading || headerCount === 0, style: { minHeight: 64 }, children: loading ? "Running..." : "🚀 Complete Setup: Service Types + MPVI" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => {
                                            switchView("custom-service-type");
                                            setServiceTypesPreviewVisible(true);
                                        }, style: { minHeight: 64 }, children: "\u2795 Create Custom Service Type" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => void runAutoConfigureIndividual(), disabled: loading || headerCount === 0, style: { minHeight: 64 }, children: "\u26A1 Auto Configure All (Sublet, PDI, Cust Concern)" })] })] }), _jsxs("div", { className: "op-card", children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }, children: "Manual Validation & Fix" }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-secondary btn-sm", onClick: () => void runSingleValidation("mpvi"), disabled: loading, children: "Validate MPVI" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => void runSingleValidation("sublet"), disabled: loading, children: "Validate SUBLET" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => void runSingleValidation("pdi"), disabled: loading, children: "Validate PDI" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => void runSingleValidation("cust"), disabled: loading, children: "Validate CUST CONCERN" })] })] })] })) : null, activeView === "get" ? (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsx("div", { className: "op-card", children: _jsxs("div", { style: {
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 12,
                                flexWrap: "wrap",
                            }, children: [_jsxs("div", { children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 4 }, children: "Fetch Opcodes" }), _jsx("div", { style: { color: "#94a3b8", fontSize: 13 }, children: "Retrieve service opcodes through the search endpoint." })] }), _jsxs("div", { style: { display: "flex", gap: 8 }, children: [_jsx("button", { className: "btn-primary", onClick: () => void runGetAllOpcodes(), disabled: loading || headerCount === 0, children: loading ? "Fetching..." : "🚀 Execute GET" }), rawGetResponse ? (_jsx("button", { className: "btn-secondary btn-sm", onClick: () => setShowRawGet((v) => !v), children: showRawGet ? "Hide Raw JSON" : "Show Raw JSON" })) : null] })] }) }), _jsxs("div", { className: "op-card", children: [_jsxs("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }, children: ["Opcodes (", getRows.length, ")"] }), _jsx("div", { className: "op-table-wrap", style: { maxHeight: 520 }, children: _jsxs("table", { className: "op-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: "op-sticky-th", children: "#" }), _jsx("th", { className: "op-sticky-th", children: "Opcode" }), _jsx("th", { className: "op-sticky-th", children: "Description" }), _jsx("th", { className: "op-sticky-th", children: "Opcode Type" }), _jsx("th", { className: "op-sticky-th", children: "Category" }), _jsx("th", { className: "op-sticky-th", children: "ID" })] }) }), _jsx("tbody", { children: getRows.length > 0 ? (getRows.map((row, index) => (_jsxs("tr", { className: index % 2 === 1 ? "op-row-zebra" : "", children: [_jsx("td", { className: "op-td", children: index + 1 }), _jsx("td", { className: "op-td", children: _jsx("div", { style: { color: "#f8fafc", fontWeight: 800 }, children: row.opcode || row.code || row.displayValue || "—" }) }), _jsx("td", { className: "op-td", children: row.description || row.customerDescription || "—" }), _jsx("td", { className: "op-td", children: row.opcodeType || "—" }), _jsx("td", { className: "op-td", children: row.category || "—" }), _jsx("td", { className: "op-td", children: _jsx("code", { className: "op-mono", children: row.id || "—" }) })] }, `${row.id || row.opcode || "opcode"}-${index}`)))) : (_jsx("tr", { children: _jsx("td", { className: "op-td", colSpan: 6, children: _jsx("div", { style: { color: "#94a3b8" }, children: "No opcode rows loaded yet. Click Execute GET." }) }) })) })] }) }), showRawGet && rawGetResponse ? (_jsx("div", { style: { marginTop: 14 }, children: _jsx("pre", { className: "op-mono", style: {
                                        margin: 0,
                                        padding: 12,
                                        borderRadius: 12,
                                        background: "#0f172a",
                                        maxHeight: 320,
                                        overflow: "auto",
                                    }, children: JSON.stringify(rawGetResponse, null, 2) }) })) : null] })] })) : null, activeView === "post" ? (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsxs("div", { className: "op-card", children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }, children: "Opcode Configuration" }), _jsxs("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }, children: [_jsx("button", { className: "btn-primary", onClick: () => void runQuickSetup(), disabled: loading || headerCount === 0, style: { minHeight: 72 }, children: loading ? "Running..." : "🚀 Complete Setup: Service Types + MPVI" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => switchView("custom-service-type"), style: { minHeight: 72 }, children: "\u2795 Create Custom Service Type" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => void runAutoConfigureIndividual(), disabled: loading || headerCount === 0, style: { minHeight: 72 }, children: "\u26A1 Auto Configure All (Sublet, PDI, Cust Concern)" })] })] }), _jsxs("div", { className: "op-card", children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }, children: "Manual Validation & Fix" }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-secondary btn-sm", onClick: () => void runSingleValidation("mpvi"), disabled: loading, children: "Validate MPVI" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => void runSingleValidation("sublet"), disabled: loading, children: "Validate SUBLET" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => void runSingleValidation("pdi"), disabled: loading, children: "Validate PDI" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => void runSingleValidation("cust"), disabled: loading, children: "Validate CUST CONCERN" })] })] })] })) : null, activeView === "service-types" ? (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsxs("div", { className: "op-card", children: [_jsxs("div", { style: {
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    flexWrap: "wrap",
                                    marginBottom: 12,
                                }, children: [_jsxs("div", { children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800 }, children: "Service Types Setup" }), _jsx("div", { style: { color: "#94a3b8", fontSize: 13, marginTop: 4 }, children: "Creates missing PDI / Sublet service types and configures labor rates." })] }), _jsxs("div", { style: { display: "flex", gap: 8 }, children: [_jsx("button", { className: "btn-primary", onClick: () => void runServiceTypesSetup(), disabled: loading || headerCount === 0, children: loading ? "Running..." : "Run Service Type Setup" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: async () => {
                                                    setLoading(true);
                                                    try {
                                                        await fetchServiceTypes();
                                                        setServiceTypesPreviewVisible(true);
                                                    }
                                                    finally {
                                                        setLoading(false);
                                                    }
                                                }, children: "Refresh Preview" })] })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsxs("span", { className: "op-badge", children: ["Total: ", _jsx("b", { style: { color: "#f8fafc" }, children: serviceTypeStats.total })] }), _jsxs("span", { className: "op-badge", children: ["Linked: ", _jsx("b", { style: { color: "#86efac" }, children: serviceTypeStats.linked })] }), _jsxs("span", { className: "op-badge", children: ["Not linked: ", _jsx("b", { style: { color: "#fcd34d" }, children: serviceTypeStats.unlinked })] })] })] }), serviceTypesPreviewVisible ? (_jsxs("div", { className: "op-card", children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }, children: "Existing Service Types" }), _jsx("div", { className: "op-table-wrap", style: { maxHeight: 420 }, children: _jsxs("table", { className: "op-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: "op-sticky-th", children: "Name" }), _jsx("th", { className: "op-sticky-th", children: "Key" }), _jsx("th", { className: "op-sticky-th", children: "Status" }), _jsx("th", { className: "op-sticky-th", children: "Labor Rates" }), _jsx("th", { className: "op-sticky-th", children: "ID" })] }) }), _jsx("tbody", { children: serviceTypes.length > 0 ? (serviceTypes.map((row, index) => (_jsxs("tr", { className: index % 2 === 1 ? "op-row-zebra" : "", children: [_jsx("td", { className: "op-td", children: _jsx("div", { style: { color: "#f8fafc", fontWeight: 700 }, children: row.name || "—" }) }), _jsx("td", { className: "op-td", children: row.key || "—" }), _jsx("td", { className: "op-td", children: row.status || "—" }), _jsx("td", { className: "op-td", children: Array.isArray(row.laborRateConfigs) && row.laborRateConfigs.length > 0 ? (_jsx("span", { className: "op-pill-success", children: "Linked" })) : (_jsx("span", { className: "op-pill-error", children: "Not linked" })) }), _jsx("td", { className: "op-td", children: _jsx("code", { className: "op-mono", children: row.id || "—" }) })] }, `${row.id || row.name || "st"}-${index}`)))) : (_jsx("tr", { children: _jsx("td", { className: "op-td", colSpan: 5, children: _jsx("div", { style: { color: "#94a3b8" }, children: "No service types loaded." }) }) })) })] }) })] })) : null] })) : null, activeView === "custom-service-type" ? (_jsx("div", { style: { display: "grid", gap: 16 }, children: _jsxs("div", { className: "op-card", children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }, children: "Create Custom Service Type" }), _jsx("div", { style: { color: "#94a3b8", fontSize: 13, lineHeight: 1.6, marginBottom: 14 }, children: "Creates a custom Service Type and links CP / IP / WP labor rates dynamically." }), _jsxs("div", { style: { display: "grid", gap: 12, maxWidth: 520 }, children: [_jsxs("div", { children: [_jsx("label", { style: { display: "block", color: "#cbd5e1", fontSize: 13, marginBottom: 6 }, children: "Service Type Name" }), _jsx("input", { value: customServiceTypeName, onChange: (e) => setCustomServiceTypeName(e.target.value), placeholder: "e.g. Maintenance Service", style: {
                                                width: "100%",
                                                padding: "12px 14px",
                                                borderRadius: 12,
                                                border: "1px solid rgba(255,255,255,0.10)",
                                                background: "rgba(255,255,255,0.03)",
                                                color: "#f8fafc",
                                                outline: "none",
                                            } })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-primary", onClick: () => void runCreateCustomServiceType(), disabled: loading || headerCount === 0, children: loading ? "Creating..." : "Create Service Type" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => setCustomServiceTypeName(""), children: "Reset" })] })] })] }) })) : null, activeView === "mpvi" ? (_jsxs("div", { className: "op-card", children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }, children: "MPVI Validation" }), _jsx("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: _jsx("button", { className: "btn-primary", onClick: () => void runSingleValidation("mpvi"), disabled: loading || headerCount === 0, children: loading ? "Validating..." : "Validate / Fix MPVI" }) })] })) : null, activeView === "sublet" ? (_jsxs("div", { className: "op-card", children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }, children: "SUBLET Validation" }), _jsx("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: _jsx("button", { className: "btn-primary", onClick: () => void runSingleValidation("sublet"), disabled: loading || headerCount === 0, children: loading ? "Validating..." : "Validate / Fix SUBLET" }) })] })) : null, activeView === "pdi" ? (_jsxs("div", { className: "op-card", children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }, children: "PDI Validation" }), _jsx("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: _jsx("button", { className: "btn-primary", onClick: () => void runSingleValidation("pdi"), disabled: loading || headerCount === 0, children: loading ? "Validating..." : "Validate / Fix PDI" }) })] })) : null, activeView === "cust" ? (_jsxs("div", { className: "op-card", children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 12 }, children: "CUST CONCERN Validation" }), _jsx("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: _jsx("button", { className: "btn-primary", onClick: () => void runSingleValidation("cust"), disabled: loading || headerCount === 0, children: loading ? "Validating..." : "Validate / Create CUST CONCERN" }) })] })) : null] }));
};
export default OpcodeManagementView;
