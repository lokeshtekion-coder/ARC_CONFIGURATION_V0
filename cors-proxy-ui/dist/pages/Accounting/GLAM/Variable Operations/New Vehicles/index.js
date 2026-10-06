import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GlamSectionHeader } from "../../components/glamShared";
import { idbGetAllBootstraps } from "../../../../../utils/bootstrapDb";
import { loadGlobalHeaders } from "../../../../../services/tekionApiSettings";
import makeModelsRaw from "../../../../../terminology/MAKE_MODELS_DATA.json";
import terminologyMapRaw from "../../../../../terminology/terminology_mapping.json" with { type: "json" };
import "./index.css"; // Added import
const makeModelsData = makeModelsRaw ?? [];
const rawTerminology = terminologyMapRaw;
const terminologyRules = Array.isArray(rawTerminology)
    ? rawTerminology
    : rawTerminology?.terminology_mapping ?? [];
const GET_RULES_URL = "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/rule/asset/GLACCOUNT";
const CREATE_RULE_URL = "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/rule";
const GET_METADATA_URL = "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/metadata";
const GENERIC_MODEL_IGNORE = new Set([
    "CHEVY", "CHEVROLET", "CHEV", "GM", "GMC", "FORD", "TOYOTA", "HONDA", "KIA",
    "CAR", "CARS", "TRUCK", "TRUCKS", "VAN", "VANS", "WAGON", "AUTO",
    "NEW", "USED", "PREOWNED", "VEHICLE", "VEHICLES", "CLASSIC", "HD", "LD"
]);
function normalize(value) {
    return String(value ?? "").trim();
}
function normalizeUpper(value) {
    return normalize(value).toUpperCase();
}
function normalizeLoose(value) {
    return normalize(value)
        .toUpperCase()
        .replace(/&/g, " AND ")
        .replace(/[.,/_-]+/g, " ")
        .replace(/\bRET\b/g, " RETAIL ")
        .replace(/\bRETAI\b/g, " RETAIL ")
        .replace(/\bRTL\b/g, " RETAIL ")
        .replace(/\bSLS\b/g, " SALES ")
        .replace(/\bCOMP\b/g, " COMP ")
        .replace(/\bN\/C\b/g, " NEW CAR ")
        .replace(/\bN C\b/g, " NEW CAR ")
        .replace(/\bNC\b/g, " NEW CAR ")
        .replace(/\bN\/T\b/g, " NEW TRUCK ")
        .replace(/\bN T\b/g, " NEW TRUCK ")
        .replace(/\bNT\b/g, " NEW TRUCK ")
        .replace(/\bU\/C\b/g, " USED CAR ")
        .replace(/\bU C\b/g, " USED CAR ")
        .replace(/\bUC\b/g, " USED CAR ")
        .replace(/\bU\/T\b/g, " USED TRUCK ")
        .replace(/\bU T\b/g, " USED TRUCK ")
        .replace(/\bUT\b/g, " USED TRUCK ")
        .replace(/\bTRKS\b/g, " TRUCKS ")
        .replace(/\bTRK\b/g, " TRUCK ")
        .replace(/\bCHEVY\b/g, " CHEVROLET ")
        .replace(/\bCHEV\b/g, " CHEVROLET ")
        .replace(/\bGM\b/g, " GENERAL MOTORS ")
        .replace(/\s+/g, " ")
        .trim();
}
function normalizeModelAlias(value) {
    return normalizeLoose(value)
        .replace(/\bPLUG IN\b/g, " PLUG-IN ")
        .replace(/\b5 DOOR\b/g, " 5-DOOR ")
        .replace(/\s+/g, " ")
        .trim();
}
function asObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    return value;
}
function toEnabledHeaderMap(headers) {
    const out = {};
    for (const row of headers) {
        if (!row?.enabled)
            continue;
        const key = normalize(row.key);
        const value = normalize(row.value);
        if (!key || !value)
            continue;
        out[key] = value;
    }
    return out;
}
function findHeaderValueCaseInsensitive(headers, candidates) {
    const entries = Object.entries(headers);
    for (const candidate of candidates) {
        const found = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
        if (found && normalize(found[1])) {
            return normalize(found[1]);
        }
    }
    return null;
}
function extractDealerIdFromHeaders(headers) {
    return findHeaderValueCaseInsensitive(headers, [
        "dealerid",
        "dealerId",
        "dealer-id",
        "x-dealer-id",
    ]);
}
function getBootstrapDealerId(record) {
    const raw = record.data;
    const directDealerId = normalize(raw?.dealerId);
    if (directDealerId)
        return directDealerId;
    const nestedDealerId = normalize(raw?.data?.dealerId);
    if (nestedDealerId)
        return nestedDealerId;
    const allAccountsKey = Object.keys(raw?.allAccounts?.dealerAssetDocMap ?? {})[0];
    if (allAccountsKey)
        return normalize(allAccountsKey);
    const nestedAllAccountsKey = Object.keys(raw?.data?.allAccounts?.dealerAssetDocMap ?? {})[0];
    if (nestedAllAccountsKey)
        return normalize(nestedAllAccountsKey);
    return normalize(record.key);
}
function getBestBootstrapForDealer(records, dealerId) {
    const normalizedDealerId = normalize(dealerId);
    const matches = records.filter((record) => getBootstrapDealerId(record) === normalizedDealerId);
    if (matches.length === 0)
        return null;
    matches.sort((a, b) => normalize(b.savedAt).localeCompare(normalize(a.savedAt)));
    return matches[0] ?? null;
}
function getSalesChainsDecodedRows(record) {
    if (!record)
        return [];
    const raw = record.data;
    const candidates = [
        raw?.SalesChains_Decoded,
        raw?.data?.SalesChains_Decoded,
        raw?.body?.SalesChains_Decoded,
    ];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate;
        }
    }
    return [];
}
function containsLoose(haystack, needle) {
    const h = ` ${normalizeLoose(haystack)} `;
    const n = ` ${normalizeLoose(needle)} `;
    return Boolean(n.trim()) && h.includes(n);
}
function buildMatchedCostOffsetBuckets(rows) {
    const buckets = new Map();
    for (const row of rows) {
        const type = normalizeUpper(row.accountingChainType || "salesChain");
        const isSalesChain = type === "SALESCHAIN" || type === "SALES_CHAIN" || type === "";
        if (!isSalesChain)
            continue;
        const id = normalize(row.costOffsetAccountId);
        const rawName = normalize(row.costOffsetAccountId_Name);
        if (!id || !rawName)
            continue;
        const name = normalizeLoose(rawName);
        const isNew = containsLoose(name, "NEW");
        const isVehicleClass = containsLoose(name, "VEHICLE") ||
            containsLoose(name, "VEHICLES") ||
            containsLoose(name, "CAR") ||
            containsLoose(name, "CARS") ||
            containsLoose(name, "TRUCK") ||
            containsLoose(name, "TRUCKS") ||
            containsLoose(name, "VAN") ||
            containsLoose(name, "VANS") ||
            containsLoose(name, "SUV") ||
            containsLoose(name, "SUVS");
        if (!isNew || !isVehicleClass)
            continue;
        if (containsLoose(name, "USED") ||
            containsLoose(name, "PREOWNED") ||
            containsLoose(name, "PRE OWNED")) {
            continue;
        }
        const bucket = buckets.get(id) ?? {
            costOffsetAccountId: id,
            costOffsetAccountName: rawName,
            bucketRows: [],
        };
        bucket.bucketRows.push(row);
        buckets.set(id, bucket);
    }
    return Array.from(buckets.values());
}
function getMakeAliasEntries() {
    const rows = [];
    for (const entry of makeModelsData) {
        const canonicalMake = normalize(entry.Makes);
        if (!canonicalMake)
            continue;
        const aliases = Array.from(new Set([canonicalMake, ...(Array.isArray(entry.IncludeAny) ? entry.IncludeAny : [])]
            .map((v) => normalize(v))
            .filter(Boolean)));
        const models = (Array.isArray(entry.models) ? entry.models : [])
            .map((v) => normalize(v))
            .filter(Boolean);
        rows.push({
            canonicalMake,
            aliases,
            models,
        });
    }
    return rows;
}
function getAllModelsWithMakes() {
    const rows = [];
    for (const entry of makeModelsData) {
        const make = normalize(entry.Makes);
        const models = Array.isArray(entry.models) ? entry.models : [];
        for (const model of models) {
            const normalizedModel = normalize(model);
            if (!normalizedModel)
                continue;
            rows.push({ make, model: normalizedModel });
        }
    }
    const deduped = new Map();
    for (const row of rows) {
        const key = `${normalizeUpper(row.make)}__${normalizeUpper(row.model)}`;
        if (!deduped.has(key)) {
            deduped.set(key, row);
        }
    }
    return Array.from(deduped.values());
}
function buildMappedAssetId(dealerId, saleAccountId, saleAccountNumber) {
    if (normalize(saleAccountId))
        return normalize(saleAccountId);
    if (normalize(saleAccountNumber))
        return `${dealerId}_${normalize(saleAccountNumber)}`;
    return "";
}
function generateRowId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function looksLikeNewVehicleRuleName(name) {
    const lowered = normalize(name).toLowerCase();
    if (!lowered)
        return false;
    const hasNew = lowered.includes("new");
    const hasVehicle = lowered.includes("vehicle") || lowered.includes("vehicles");
    return hasNew || hasVehicle;
}
function extractRulesPayloadArray(payload) {
    const obj = asObject(payload);
    if (!obj)
        return [];
    const body = obj.body;
    const data = obj.data;
    if (Array.isArray(data))
        return data;
    if (Array.isArray(body))
        return body;
    const bodyObj = asObject(body);
    if (bodyObj && Array.isArray(bodyObj.data))
        return bodyObj.data;
    const dataObj = asObject(data);
    if (dataObj && Array.isArray(dataObj.data))
        return dataObj.data;
    return [];
}
function findExistingNewVehicleRule(payload) {
    const rows = extractRulesPayloadArray(payload);
    for (const item of rows) {
        const obj = asObject(item);
        if (!obj)
            continue;
        const moduleName = normalize(obj.module);
        const name = normalize(obj.name);
        const id = normalize(obj.id);
        if (moduleName !== "NEW_VEHICLE")
            continue;
        if (!looksLikeNewVehicleRuleName(name))
            continue;
        if (!id)
            continue;
        return {
            id,
            module: moduleName,
            name,
            raw: obj,
        };
    }
    return null;
}
function extractMetadataMakes(payload) {
    const obj = asObject(payload);
    const root = asObject(obj?.body) ?? asObject(obj?.data) ?? obj;
    const data = asObject(root?.data) ?? root;
    const makesCandidate = data?.makes;
    if (!Array.isArray(makesCandidate))
        return [];
    const values = makesCandidate
        .map((item) => {
        if (typeof item === "string")
            return normalize(item);
        const row = asObject(item);
        return (normalize(row?.value) ||
            normalize(row?.name) ||
            normalize(row?.label) ||
            normalize(row?.make) ||
            normalize(row?.code));
    })
        .filter(Boolean);
    return Array.from(new Set(values));
}
function findTerminologyRule(targetMapping) {
    return (terminologyRules.find((rule) => normalizeUpper(rule.targetMapping) === normalizeUpper(targetMapping)) ?? null);
}
function ruleMatchesText(rule, text) {
    if (!rule)
        return false;
    const haystack = normalizeLoose(text);
    const includeAny = Array.isArray(rule.includeAny) ? rule.includeAny : [];
    const exclude = Array.isArray(rule.exclude) ? rule.exclude : [];
    const included = includeAny.length > 0 &&
        includeAny.some((term) => containsLoose(haystack, normalizeLoose(term)));
    if (!included)
        return false;
    const hasExcluded = exclude.some((term) => containsLoose(haystack, normalizeLoose(term)));
    if (hasExcluded)
        return false;
    return true;
}
function detectBodyClassesFromSaleAccountName(name) {
    const classes = new Set();
    const carRule = findTerminologyRule("Car");
    const truckRule = findTerminologyRule("Truck/Van");
    if (ruleMatchesText(carRule, name)) {
        classes.add("Car");
    }
    if (ruleMatchesText(truckRule, name)) {
        classes.add("Truck/Van");
        classes.add("SUV");
    }
    return Array.from(classes);
}
function detectCanonicalMakeFromAccountName(name) {
    const aliasEntries = getMakeAliasEntries();
    const saleName = normalizeLoose(name);
    let bestMake = "";
    let bestReason = "";
    let bestLen = -1;
    for (const entry of aliasEntries) {
        const allAliases = Array.from(new Set([entry.canonicalMake, ...entry.aliases]));
        for (const alias of allAliases) {
            const aliasLoose = normalizeLoose(alias);
            if (!aliasLoose)
                continue;
            if (containsLoose(saleName, aliasLoose) && aliasLoose.length > bestLen) {
                bestLen = aliasLoose.length;
                bestMake = entry.canonicalMake;
                bestReason = `makeAlias:${alias}`;
            }
        }
    }
    return {
        canonicalMake: bestMake,
        reason: bestReason,
    };
}
function buildGenericModelAliases(model) {
    const base = normalize(model);
    const loose = normalizeModelAlias(base);
    const aliases = new Set();
    if (!loose)
        return [];
    aliases.add(loose);
    aliases.add(loose.replace(/-/g, " "));
    aliases.add(loose.replace(/\s+/g, " ").trim());
    const compact = loose
        .replace(/\bPLUG IN\b/g, "PLUGIN")
        .replace(/\bPLUG-IN\b/g, "PLUGIN")
        .replace(/\b5 DOOR\b/g, "5DOOR")
        .replace(/\b5-DOOR\b/g, "5DOOR")
        .replace(/\s+/g, " ")
        .trim();
    aliases.add(compact);
    const tokens = loose.split(" ").filter(Boolean);
    if (tokens.length > 1) {
        aliases.add(tokens.join(" "));
    }
    const withoutMarketingWords = tokens.filter((token) => token !== "HYBRID" &&
        token !== "PLUGIN" &&
        token !== "PLUG" &&
        token !== "IN" &&
        token !== "EV" &&
        token !== "PHEV");
    if (withoutMarketingWords.length > 0) {
        aliases.add(withoutMarketingWords.join(" "));
    }
    if (tokens.length > 0) {
        const firstToken = tokens[0];
        if (firstToken.length > 2 && !GENERIC_MODEL_IGNORE.has(normalizeUpper(firstToken))) {
            aliases.add(firstToken);
        }
    }
    if (withoutMarketingWords.length > 0) {
        const firstNoMarketing = withoutMarketingWords[0];
        if (firstNoMarketing.length > 2 && !GENERIC_MODEL_IGNORE.has(normalizeUpper(firstNoMarketing))) {
            aliases.add(firstNoMarketing);
        }
    }
    const numericNormalized = loose
        .replace(/\b(\d+)\s+HD\b/g, "$1HD")
        .replace(/\b(\d+)\s+DOOR\b/g, "$1DOOR")
        .trim();
    aliases.add(numericNormalized);
    const decompacted = loose
        .replace(/\b(\d+)HD\b/g, "$1 HD")
        .replace(/\b(\d+)DOOR\b/g, "$1 DOOR")
        .trim();
    aliases.add(decompacted);
    return Array.from(aliases)
        .map((v) => normalizeModelAlias(v))
        .filter((v) => {
        const upper = normalizeUpper(v);
        if (GENERIC_MODEL_IGNORE.has(upper))
            return false;
        if (upper.length < 3 && !/^\d+$/.test(upper))
            return false;
        return true;
    });
}
function getModelAliases(model) {
    return Array.from(new Set(buildGenericModelAliases(model)));
}
function extractModelHintsFromAccountName(name, canonicalMake) {
    const normalizedName = normalizeLoose(name);
    const makeModels = getAllModelsWithMakes().filter((row) => normalizeUpper(row.make) === normalizeUpper(canonicalMake));
    const hits = new Set();
    const aliasesToRows = [];
    for (const row of makeModels) {
        for (const alias of getModelAliases(row.model)) {
            aliasesToRows.push({ model: row.model, alias: normalizeModelAlias(alias) });
        }
    }
    aliasesToRows.sort((a, b) => b.alias.length - a.alias.length);
    for (const entry of aliasesToRows) {
        if (containsLoose(normalizedName, entry.alias)) {
            hits.add(entry.model);
        }
    }
    return Array.from(hits);
}
function uniqueCandidateSaleAccounts(bucketRows) {
    const map = new Map();
    for (const row of bucketRows) {
        const saleAccountId = normalize(row.saleAccountId);
        const saleAccountId_Number = normalize(row.saleAccountId_Number);
        const saleAccountId_Name = normalize(row.saleAccountId_Name);
        const costOffsetAccountId = normalize(row.costOffsetAccountId);
        const costOffsetAccountId_Name = normalize(row.costOffsetAccountId_Name);
        if (!saleAccountId && !saleAccountId_Number && !saleAccountId_Name)
            continue;
        const detectedMake = detectCanonicalMakeFromAccountName(saleAccountId_Name);
        const detectedModelHints = detectedMake.canonicalMake
            ? extractModelHintsFromAccountName(saleAccountId_Name, detectedMake.canonicalMake)
            : [];
        const key = `${saleAccountId}__${saleAccountId_Number}__${saleAccountId_Name}`;
        if (!map.has(key)) {
            map.set(key, {
                saleAccountId,
                saleAccountId_Number,
                saleAccountId_Name,
                costOffsetAccountId,
                costOffsetAccountId_Name,
                detectedBodyClasses: detectBodyClassesFromSaleAccountName(saleAccountId_Name),
                detectedMake: detectedMake.canonicalMake,
                detectedMakeReason: detectedMake.reason,
                detectedModelHints,
            });
        }
    }
    return Array.from(map.values());
}
function buildModelMatchesForMake(dealerId, candidates, modelRows) {
    const matchedRows = [];
    const claimedModels = new Set();
    const modelRowsSorted = [...modelRows].sort((a, b) => {
        const aLen = Math.max(...getModelAliases(a.model).map((x) => normalizeModelAlias(x).length), 0);
        const bLen = Math.max(...getModelAliases(b.model).map((x) => normalizeModelAlias(x).length), 0);
        return bLen - aLen;
    });
    for (const candidate of candidates) {
        let best = null;
        let bestMatchLen = -1;
        let bestModelLen = Infinity;
        let bestReason = "";
        const saleName = normalizeLoose(candidate.saleAccountId_Name);
        for (const { make, model } of modelRowsSorted) {
            const key = `${normalizeUpper(make)}__${normalizeUpper(model)}`;
            if (claimedModels.has(key))
                continue;
            for (const alias of getModelAliases(model)) {
                const normalizedAlias = normalizeModelAlias(alias);
                if (containsLoose(saleName, normalizedAlias)) {
                    const matchLen = normalizedAlias.length;
                    if (matchLen > bestMatchLen ||
                        (matchLen === bestMatchLen && model.length < bestModelLen)) {
                        best = { make, model };
                        bestMatchLen = matchLen;
                        bestModelLen = model.length;
                        bestReason = `account→model:${alias}`;
                    }
                }
            }
        }
        if (best) {
            claimedModels.add(`${normalizeUpper(best.make)}__${normalizeUpper(best.model)}`);
            const baseMappedAssetId = buildMappedAssetId(dealerId, candidate.saleAccountId, candidate.saleAccountId_Number);
            const bodyClasses = candidate.detectedBodyClasses;
            const shouldExpandByBodyClass = bodyClasses.length > 0;
            if (shouldExpandByBodyClass) {
                for (const bodyClass of bodyClasses) {
                    matchedRows.push({
                        make: best.make,
                        model: best.model,
                        mappedAssetId: baseMappedAssetId,
                        saleAccountId: candidate.saleAccountId,
                        saleAccountId_Number: candidate.saleAccountId_Number,
                        saleAccountId_Name: candidate.saleAccountId_Name,
                        costOffsetAccountId: candidate.costOffsetAccountId,
                        costOffsetAccountId_Name: candidate.costOffsetAccountId_Name,
                        matched: true,
                        matchReason: `${bestReason}, bodyClass:${bodyClass}`,
                        sortBucket: 0,
                        bodyClasses: [bodyClass],
                    });
                }
            }
            else {
                matchedRows.push({
                    make: best.make,
                    model: best.model,
                    mappedAssetId: baseMappedAssetId,
                    saleAccountId: candidate.saleAccountId,
                    saleAccountId_Number: candidate.saleAccountId_Number,
                    saleAccountId_Name: candidate.saleAccountId_Name,
                    costOffsetAccountId: candidate.costOffsetAccountId,
                    costOffsetAccountId_Name: candidate.costOffsetAccountId_Name,
                    matched: true,
                    matchReason: bestReason,
                    sortBucket: 0,
                    bodyClasses: [],
                });
            }
        }
    }
    const claimedIds = new Set(matchedRows.map((row) => row.saleAccountId));
    const fallbackAccount = candidates.find((c) => {
        const n = normalizeLoose(c.saleAccountId_Name);
        const isGenericNew = containsLoose(n, "NEW CAR") ||
            containsLoose(n, "NEW TRUCK") ||
            containsLoose(n, "NEW VEHICLE") ||
            containsLoose(n, "NEW VEHICLES") ||
            containsLoose(n, "SALES NEW");
        return isGenericNew && !claimedIds.has(c.saleAccountId);
    }) ??
        candidates.find((c) => !claimedIds.has(c.saleAccountId)) ??
        candidates[0];
    if (fallbackAccount) {
        const fallbackMappedAssetId = buildMappedAssetId(dealerId, fallbackAccount.saleAccountId, fallbackAccount.saleAccountId_Number);
        const fallbackBodyClasses = fallbackAccount.detectedBodyClasses.length > 0
            ? fallbackAccount.detectedBodyClasses
            : [];
        if (fallbackBodyClasses.length > 0) {
            for (const bodyClass of fallbackBodyClasses) {
                matchedRows.push({
                    make: "",
                    model: "All",
                    mappedAssetId: fallbackMappedAssetId,
                    saleAccountId: fallbackAccount.saleAccountId,
                    saleAccountId_Number: fallbackAccount.saleAccountId_Number,
                    saleAccountId_Name: fallbackAccount.saleAccountId_Name,
                    costOffsetAccountId: fallbackAccount.costOffsetAccountId,
                    costOffsetAccountId_Name: fallbackAccount.costOffsetAccountId_Name,
                    matched: false,
                    matchReason: `fallback:weak-or-no-model-match, bodyClass:${bodyClass}`,
                    sortBucket: 1,
                    bodyClasses: [bodyClass],
                });
            }
        }
        else {
            matchedRows.push({
                make: "",
                model: "All",
                mappedAssetId: fallbackMappedAssetId,
                saleAccountId: fallbackAccount.saleAccountId,
                saleAccountId_Number: fallbackAccount.saleAccountId_Number,
                saleAccountId_Name: fallbackAccount.saleAccountId_Name,
                costOffsetAccountId: fallbackAccount.costOffsetAccountId,
                costOffsetAccountId_Name: fallbackAccount.costOffsetAccountId_Name,
                matched: false,
                matchReason: "fallback:weak-or-no-model-match",
                sortBucket: 1,
                bodyClasses: [],
            });
        }
    }
    return matchedRows;
}
function buildPayload(dealerId, ruleName, modelMatches) {
    const hasBodyClass = modelMatches.some((row) => row.bodyClasses.length > 0);
    return {
        module: "NEW_VEHICLE",
        name: ruleName,
        criteriaList: [],
        mappingColumns: hasBodyClass ? ["MODEL", "BODY_CLASS"] : ["MODEL"],
        mappingList: modelMatches.map((row) => ({
            attributes: row.bodyClasses.length > 0
                ? {
                    MODEL: row.model,
                    BODY_CLASS: row.bodyClasses[0],
                }
                : {
                    MODEL: row.model,
                },
            targetFieldToValueMapping: {},
            mappedAssetId: row.mappedAssetId,
            mappedDealerId: dealerId,
            rowId: generateRowId(),
        })),
        ruleAsset: "GLACCOUNT",
    };
}
function findMakeModels(make) {
    return getAllModelsWithMakes().filter((row) => normalizeUpper(row.make) === normalizeUpper(make));
}
function findResolvedMakesFromMetadata(metadataMakes) {
    const aliasEntries = getMakeAliasEntries();
    const resolved = [];
    for (const rawMake of metadataMakes) {
        const normalizedRaw = normalizeUpper(rawMake);
        for (const entry of aliasEntries) {
            const aliases = [entry.canonicalMake, ...entry.aliases];
            if (aliases.some((alias) => normalizeUpper(alias) === normalizedRaw)) {
                resolved.push(entry.canonicalMake);
                break;
            }
        }
    }
    return Array.from(new Set(resolved));
}
// ----------------------------------------------------------------------
// View Components
// ----------------------------------------------------------------------
function ChevronIcon({ open }) {
    return (_jsx("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round", className: `nv-chevron-icon ${open ? "nv-chevron-open" : "nv-chevron-closed"}`, children: _jsx("polyline", { points: "6 9 12 15 18 9" }) }));
}
function InfoIcon({ open }) {
    return (_jsx("span", { "aria-hidden": "true", className: `nv-info-button ${open ? "nv-info-icon-open" : ""}`, children: "i" }));
}
function SectionHeader({ title, open, onToggle, badge, }) {
    return (_jsxs("button", { type: "button", className: "nv-collapsible-header", onClick: onToggle, "aria-expanded": open, children: [_jsxs("span", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 }, children: [_jsx(ChevronIcon, { open: open }), _jsx("span", { className: "nv-section-header-title", style: { color: "#f8fafc", fontSize: 15, fontWeight: 800 }, children: title })] }), badge] }));
}
const NewVehiclesView = () => {
    const [loading, setLoading] = useState(false);
    const [running, setRunning] = useState(false);
    const [buildResult, setBuildResult] = useState(null);
    const [fetchHeaders, setFetchHeaders] = useState({});
    const [message, setMessage] = useState(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [infoOpen, setInfoOpen] = useState(false);
    const [collapsedSections, setCollapsedSections] = useState({
        matchSummary: false,
        linkedSaleAccounts: false,
        warnings: false,
        modelMapping: false,
        payloads: false,
    });
    const toggleSection = useCallback((key) => {
        setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
    }, []);
    const expandAllSections = useCallback(() => {
        setCollapsedSections({
            matchSummary: false,
            linkedSaleAccounts: false,
            warnings: false,
            modelMapping: false,
            payloads: false,
        });
    }, []);
    const collapseAllSections = useCallback(() => {
        setCollapsedSections({
            matchSummary: true,
            linkedSaleAccounts: true,
            warnings: true,
            modelMapping: true,
            payloads: true,
        });
    }, []);
    const detectedDealerId = useMemo(() => extractDealerIdFromHeaders(fetchHeaders) ?? "", [fetchHeaders]);
    const refreshHeaders = useCallback(() => {
        try {
            const headers = loadGlobalHeaders();
            setFetchHeaders(toEnabledHeaderMap(headers));
        }
        catch {
            setFetchHeaders({});
        }
    }, []);
    useEffect(() => {
        refreshHeaders();
    }, [refreshHeaders]);
    const buildConfig = useCallback(async () => {
        const warnings = [];
        const enabledHeaders = toEnabledHeaderMap(loadGlobalHeaders());
        const dealerId = extractDealerIdFromHeaders(enabledHeaders);
        if (!dealerId) {
            throw new Error("Dealer ID not found in enabled Global Headers.");
        }
        const allBootstraps = (await idbGetAllBootstraps());
        const bootstrap = getBestBootstrapForDealer(allBootstraps, dealerId);
        if (!bootstrap) {
            throw new Error(`No bootstrap snapshot found in IndexedDB for dealer ${dealerId}.`);
        }
        const salesChainsDecoded = getSalesChainsDecodedRows(bootstrap);
        if (salesChainsDecoded.length === 0) {
            throw new Error(`No SalesChains_Decoded found in bootstrap record for dealer ${dealerId}. Please re-save bootstrap snapshot first.`);
        }
        const metadataRes = await fetch("http://localhost:4000/api/proxy", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                url: GET_METADATA_URL,
                method: "GET",
                headers: enabledHeaders,
                timeout: 60000,
            }),
        });
        if (!metadataRes.ok) {
            throw new Error(`Metadata request failed with HTTP ${metadataRes.status}`);
        }
        const metadataJson = (await metadataRes.json());
        if ((metadataJson.status ?? 200) >= 400) {
            throw new Error(`Metadata request failed: ${metadataJson.status ?? ""} ${metadataJson.statusText ?? ""}`.trim());
        }
        const metadataPayload = metadataJson.body ?? metadataJson.data ?? metadataJson;
        const metadataMakes = extractMetadataMakes(metadataPayload);
        if (metadataMakes.length === 0) {
            throw new Error("No makes found in mapping metadata response at data.makes.");
        }
        const resolvedMakes = findResolvedMakesFromMetadata(metadataMakes);
        if (resolvedMakes.length === 0) {
            throw new Error("None of the metadata makes matched MAKE_MODELS_DATA.json Makes/IncludeAny values.");
        }
        warnings.push(`Metadata makes detected: ${metadataMakes.join(", ")}`);
        warnings.push(`Resolved makes from MAKE_MODELS_DATA.json: ${resolvedMakes.join(", ")}`);
        const costOffsetBuckets = buildMatchedCostOffsetBuckets(salesChainsDecoded);
        if (costOffsetBuckets.length === 0) {
            throw new Error("No New Vehicles cost offset accounts detected in SalesChains_Decoded (looked for NEW + CARS/TRUCKS/VANS/SUV/VEHICLES in costOffsetAccountId_Name).");
        }
        warnings.push(`Detected ${costOffsetBuckets.length} cost offset bucket(s): ${costOffsetBuckets
            .map((bucket) => `${bucket.costOffsetAccountName} (${bucket.costOffsetAccountId})`)
            .join(" | ")}`);
        const bucketRows = costOffsetBuckets.flatMap((bucket) => bucket.bucketRows);
        const allCandidateSaleAccounts = uniqueCandidateSaleAccounts(bucketRows);
        if (allCandidateSaleAccounts.length === 0) {
            throw new Error("No sale accounts found linked to the detected cost offset accounts.");
        }
        const makePlans = [];
        const allModelMatches = [];
        const payloads = [];
        for (const make of resolvedMakes) {
            const makeModels = findMakeModels(make);
            if (makeModels.length === 0) {
                warnings.push(`No models found for make "${make}" in MAKE_MODELS_DATA.json.`);
                continue;
            }
            const makeCandidates = allCandidateSaleAccounts.filter((candidate) => {
                if (normalizeUpper(candidate.detectedMake) === normalizeUpper(make))
                    return true;
                if (containsLoose(candidate.saleAccountId_Name, make))
                    return true;
                return false;
            });
            const resolvedCandidates = makeCandidates.length > 0 ? makeCandidates : allCandidateSaleAccounts;
            if (makeCandidates.length === 0) {
                warnings.push(`No make-specific sale accounts found for "${make}". Falling back to all linked sale accounts.`);
            }
            const modelMatches = buildModelMatchesForMake(dealerId, resolvedCandidates, makeModels);
            const ruleName = `New Vehicles - ${make}`;
            const payload = buildPayload(dealerId, ruleName, modelMatches);
            makePlans.push({
                make,
                ruleName,
                candidateSaleAccounts: resolvedCandidates,
                modelMatches,
                payload,
            });
            allModelMatches.push(...modelMatches);
            payloads.push({ make, ruleName, payload });
            const fallbackRows = modelMatches.filter((row) => !row.matched);
            if (fallbackRows.length > 0) {
                warnings.push(`Fallback row added for make "${make}": MODEL="All" (${fallbackRows.length} row${fallbackRows.length === 1 ? "" : "s"})`);
            }
        }
        if (makePlans.length === 0) {
            throw new Error("No make-based payload plans could be created.");
        }
        const rulesRes = await fetch("http://localhost:4000/api/proxy", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                url: GET_RULES_URL,
                method: "GET",
                headers: enabledHeaders,
                timeout: 60000,
            }),
        });
        if (!rulesRes.ok) {
            throw new Error(`Rule lookup failed with HTTP ${rulesRes.status}`);
        }
        const rulesJson = (await rulesRes.json());
        if ((rulesJson.status ?? 200) >= 400) {
            throw new Error(`Rule lookup failed: ${rulesJson.status ?? ""} ${rulesJson.statusText ?? ""}`.trim());
        }
        const actualPayload = rulesJson.body ?? rulesJson.data ?? rulesJson;
        const existingRule = findExistingNewVehicleRule(actualPayload);
        if (existingRule) {
            warnings.push(`Existing NEW_VEHICLE rule found: ${existingRule.name} (${existingRule.id}). Create will be skipped.`);
        }
        return {
            dealerId,
            metadataMakes,
            resolvedMakes,
            ruleName: "New Vehicles",
            existingRule,
            costOffsetBuckets,
            bucketRows,
            makePlans,
            modelMatches: allModelMatches,
            payloads,
            warnings,
        };
    }, []);
    const handleAnalyze = useCallback(async () => {
        setLoading(true);
        setMessage(null);
        try {
            refreshHeaders();
            const result = await buildConfig();
            setBuildResult(result);
            const matchedCount = result.modelMatches.filter((row) => row.matched).length;
            const fallbackCount = result.modelMatches.filter((row) => !row.matched).length;
            setMessage({
                ok: true,
                text: result.existingRule
                    ? `✅ Existing NEW_VEHICLE rule found (${result.existingRule.id}). Preview ready. Makes: ${result.makePlans.length}, Matched: ${matchedCount}, Fallback(All): ${fallbackCount}.`
                    : `✅ New Vehicles configuration prepared. Makes: ${result.makePlans.length}, Matched: ${matchedCount}, Fallback(All): ${fallbackCount}.`,
            });
        }
        catch (e) {
            setBuildResult(null);
            setMessage({
                ok: false,
                text: e instanceof Error ? e.message : "Failed to analyze New Vehicles config",
            });
        }
        finally {
            setLoading(false);
        }
    }, [buildConfig, refreshHeaders]);
    const handleCreate = useCallback(async () => {
        setRunning(true);
        setMessage(null);
        try {
            refreshHeaders();
            const result = buildResult ?? (await buildConfig());
            setBuildResult(result);
            if (result.existingRule) {
                setMessage({
                    ok: false,
                    text: `Create skipped. Existing NEW_VEHICLE rule already exists with id ${result.existingRule.id}.`,
                });
                return;
            }
            const enabledHeaders = toEnabledHeaderMap(loadGlobalHeaders());
            for (const plan of result.makePlans) {
                const proxyRes = await fetch("http://localhost:4000/api/proxy", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        url: CREATE_RULE_URL,
                        method: "POST",
                        headers: enabledHeaders,
                        body: plan.payload,
                        timeout: 60000,
                    }),
                });
                if (!proxyRes.ok) {
                    throw new Error(`Create request failed for ${plan.make} with HTTP ${proxyRes.status}`);
                }
                const proxyJson = (await proxyRes.json());
                if ((proxyJson.status ?? 200) >= 400) {
                    throw new Error(`Create request failed for ${plan.make}: ${proxyJson.status ?? ""} ${proxyJson.statusText ?? ""}`.trim());
                }
            }
            setMessage({
                ok: true,
                text: `✅ New Vehicles mapping rule(s) created successfully for dealer ${result.dealerId}. Created payloads: ${result.makePlans.length}.`,
            });
            const refreshed = await buildConfig();
            setBuildResult(refreshed);
        }
        catch (e) {
            setMessage({
                ok: false,
                text: e instanceof Error ? e.message : "Failed to create New Vehicles rule(s)",
            });
        }
        finally {
            setRunning(false);
        }
    }, [buildConfig, buildResult, refreshHeaders]);
    const matchedCount = buildResult?.modelMatches.filter((row) => row.matched).length ?? 0;
    const fallbackCount = buildResult?.modelMatches.filter((row) => !row.matched).length ?? 0;
    const allCandidateSaleAccounts = useMemo(() => buildResult
        ? Array.from(new Map(buildResult.makePlans
            .flatMap((plan) => plan.candidateSaleAccounts)
            .map((row) => [`${row.saleAccountId}__${row.saleAccountId_Number}`, row])).values())
        : [], [buildResult]);
    const infoMetrics = useMemo(() => {
        const payloadCount = buildResult?.payloads.length ?? 0;
        const metadataMakesCount = buildResult?.metadataMakes.length ?? 0;
        const resolvedMakesCount = buildResult?.makePlans.length ?? 0;
        const costOffsetBucketsCount = buildResult?.costOffsetBuckets.length ?? 0;
        const linkedSaleAccountsCount = allCandidateSaleAccounts.length;
        const existingRuleLabel = buildResult?.existingRule
            ? `${buildResult.existingRule.name} (${buildResult.existingRule.id})`
            : "None found";
        return {
            dealerId: buildResult?.dealerId || detectedDealerId || "Not found",
            metadataMakesCount,
            resolvedMakesCount,
            costOffsetBucketsCount,
            linkedSaleAccountsCount,
            matchedCount,
            fallbackCount,
            payloadCount,
            existingRuleLabel,
        };
    }, [allCandidateSaleAccounts.length, buildResult, detectedDealerId, fallbackCount, matchedCount]);
    return (_jsxs("div", { className: "nv-page-scroll nv-page", children: [_jsx(GlamSectionHeader, { title: "New Vehicles", description: "GLAM content for new vehicle accounting flows", breadcrumb: "Accounting / Variable Operations / New Vehicles" }), _jsx("div", { className: "nv-card", children: _jsxs("div", { style: { display: "grid", gap: 14 }, children: [_jsxs("div", { style: {
                                display: "flex",
                                alignItems: "flex-start",
                                justifyContent: "space-between",
                                gap: 12,
                                flexWrap: "wrap",
                            }, children: [_jsxs("div", { style: { minWidth: 0, flex: "1 1 420px" }, children: [_jsx("div", { style: {
                                                color: "#f8fafc",
                                                fontSize: 18,
                                                fontWeight: 800,
                                                marginBottom: 6,
                                            } }), _jsx("div", { style: {
                                                color: "#94a3b8",
                                                fontSize: 13,
                                                lineHeight: 1.6,
                                            } })] }), _jsx("button", { type: "button", className: "nv-info-button", onClick: () => setInfoOpen((v) => !v), "aria-expanded": infoOpen, "aria-label": "Toggle new vehicles information", title: "Show information", children: _jsx(InfoIcon, { open: infoOpen }) })] }), infoOpen ? (_jsxs("div", { className: "nv-info-panel", children: [_jsx("div", { style: { color: "#dbeafe", fontSize: 14, fontWeight: 800 }, children: "New Vehicles Information" }), _jsxs("div", { className: "nv-info-grid", children: [_jsxs("div", { className: "nv-info-item", children: [_jsx("div", { style: { color: "#93c5fd", fontSize: 11, fontWeight: 700, marginBottom: 6 }, children: "FLOW" }), _jsxs("div", { style: { color: "#e2e8f0", fontSize: 13, lineHeight: 1.7 }, children: ["1. Keep existing functionality.", _jsx("br", {}), "2. Fetch makes from mapping metadata API.", _jsx("br", {}), "3. Match metadata makes with MAKE_MODELS_DATA.json.", _jsx("br", {}), "4. Create separate payloads like ", _jsx("code", { className: "nv-mono", children: "New Vehicles - Kia" }), " for each make.", _jsx("br", {}), "5. Detect abbreviated make names through JSON ", _jsx("code", { className: "nv-mono", children: "IncludeAny" }), " aliases.", _jsx("br", {}), "6. Detect model phrases dynamically from JSON models, using string-length tiebreakers to resolve generic vs specific variants."] })] }), _jsxs("div", { className: "nv-info-item", children: [_jsx("div", { style: { color: "#93c5fd", fontSize: 11, fontWeight: 700, marginBottom: 6 }, children: "CONFIG" }), _jsxs("div", { style: { color: "#e2e8f0", fontSize: 13, lineHeight: 1.7 }, children: [_jsxs("div", { children: [_jsx("b", { children: "Module:" }), " NEW_VEHICLE"] }), _jsxs("div", { children: [_jsx("b", { children: "Rule Asset:" }), " GLACCOUNT"] }), _jsxs("div", { children: [_jsx("b", { children: "Metadata API:" }), " mapping/metadata"] }), _jsxs("div", { children: [_jsx("b", { children: "Primary Mapping:" }), " MODEL"] }), _jsxs("div", { children: [_jsx("b", { children: "Optional Mapping:" }), " BODY_CLASS when account keywords imply body type"] })] })] }), _jsxs("div", { className: "nv-info-item", children: [_jsx("div", { style: { color: "#93c5fd", fontSize: 11, fontWeight: 700, marginBottom: 6 }, children: "CONTEXT" }), _jsxs("div", { style: { color: "#e2e8f0", fontSize: 13, lineHeight: 1.7 }, children: [_jsxs("div", { children: [_jsx("b", { children: "Dealer:" }), " ", infoMetrics.dealerId] }), _jsxs("div", { children: [_jsx("b", { children: "Metadata Makes:" }), " ", infoMetrics.metadataMakesCount, " \u2014 makes returned by metadata API."] }), _jsxs("div", { children: [_jsx("b", { children: "Resolved Makes:" }), " ", infoMetrics.resolvedMakesCount, " \u2014 makes matched by Makes/IncludeAny aliases."] }), _jsxs("div", { children: [_jsx("b", { children: "Cost Offset Buckets:" }), " ", infoMetrics.costOffsetBucketsCount, " \u2014 distinct new-vehicle offset groups detected from sales chains."] }), _jsxs("div", { children: [_jsx("b", { children: "Linked Sale Accounts:" }), " ", infoMetrics.linkedSaleAccountsCount, " \u2014 unique sale accounts tied to detected cost offsets."] })] })] }), _jsxs("div", { className: "nv-info-item", children: [_jsx("div", { style: { color: "#93c5fd", fontSize: 11, fontWeight: 700, marginBottom: 6 }, children: "OUTPUT" }), _jsxs("div", { style: { color: "#e2e8f0", fontSize: 13, lineHeight: 1.7 }, children: [_jsxs("div", { children: [_jsx("b", { children: "Matched Rows:" }), " ", infoMetrics.matchedCount, " \u2014 model-account rows matched by strict JSON-driven alias logic."] }), _jsxs("div", { children: [_jsx("b", { children: "Fallback Rows:" }), " ", infoMetrics.fallbackCount, " \u2014 fallback MODEL = All rows for unlinked or weak matches."] }), _jsxs("div", { children: [_jsx("b", { children: "Payloads:" }), " ", infoMetrics.payloadCount, " \u2014 separate create payloads generated by make."] }), _jsxs("div", { children: [_jsx("b", { children: "Existing Rule:" }), " ", infoMetrics.existingRuleLabel] })] })] })] })] })) : null, _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsxs("span", { className: "nv-badge", children: ["Dealer ID:", " ", _jsx("b", { style: { color: detectedDealerId ? "#86efac" : "#fca5a5" }, children: detectedDealerId || "Not found" })] }), _jsxs("span", { className: "nv-badge", children: ["Module: ", _jsx("b", { style: { color: "#f8fafc" }, children: "NEW_VEHICLE" })] }), _jsxs("span", { className: "nv-badge", children: ["Status:", " ", _jsx("b", { style: { color: buildResult?.existingRule ? "#fbbf24" : "#86efac" }, children: buildResult?.existingRule ? "Existing rule found" : "Ready to analyze" })] })] }), _jsxs("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-secondary btn-sm", onClick: refreshHeaders, disabled: loading || running, children: "\u27F3 Refresh Headers" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => void handleAnalyze(), disabled: loading || running || !detectedDealerId, children: loading ? "Analyzing..." : "🧪 Analyze Configuration" }), _jsx("button", { className: "btn-primary", onClick: () => void handleCreate(), disabled: loading || running || !detectedDealerId, children: running ? "Creating..." : "⚙ Auto Configure New Vehicles" }), buildResult?.payloads?.length ? (_jsx("button", { className: "btn-secondary btn-sm", onClick: () => setPreviewOpen((v) => !v), children: previewOpen ? "Hide Payloads" : "Show Payloads" })) : null] }), message ? (_jsx("div", { className: `nv-msg-panel ${message.ok ? "nv-msg-success" : "nv-msg-error"}`, children: message.text })) : null, buildResult ? (_jsxs("div", { style: { display: "grid", gap: 14, minWidth: 0 }, children: [_jsxs("div", { className: "nv-stat-grid", children: [_jsxs("div", { className: "nv-card", children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 12, marginBottom: 6 }, children: "Metadata Makes" }), _jsx("div", { style: { color: "#f8fafc", fontSize: 16, fontWeight: 800 }, children: buildResult.metadataMakes.length }), _jsx("div", { style: { color: "#64748b", fontSize: 11, marginTop: 6 }, children: "Returned by metadata API" })] }), _jsxs("div", { className: "nv-card", children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 12, marginBottom: 6 }, children: "Resolved Makes" }), _jsx("div", { style: { color: "#f8fafc", fontSize: 16, fontWeight: 800 }, children: buildResult.makePlans.length }), _jsx("div", { style: { color: "#64748b", fontSize: 11, marginTop: 6 }, children: "Matched in make-model reference" })] }), _jsxs("div", { className: "nv-card", children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 12, marginBottom: 6 }, children: "Cost Offset Buckets" }), _jsx("div", { style: { color: "#f8fafc", fontSize: 16, fontWeight: 800 }, children: buildResult.costOffsetBuckets.length }), _jsx("div", { style: { color: "#64748b", fontSize: 11, marginTop: 6 }, children: "Distinct new vehicle offset groups" })] }), _jsxs("div", { className: "nv-card", children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 12, marginBottom: 6 }, children: "Linked Sale Accounts" }), _jsx("div", { style: { color: "#f8fafc", fontSize: 16, fontWeight: 800 }, children: allCandidateSaleAccounts.length }), _jsx("div", { style: { color: "#64748b", fontSize: 11, marginTop: 6 }, children: "Unique sale accounts connected to offsets" })] }), _jsxs("div", { className: "nv-card", children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 12, marginBottom: 6 }, children: "Matched Rows" }), _jsx("div", { style: { color: "#30d158", fontSize: 16, fontWeight: 800 }, children: matchedCount }), _jsx("div", { style: { color: "#64748b", fontSize: 11, marginTop: 6 }, children: "Model-to-account matches" })] }), _jsxs("div", { className: "nv-card", children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 12, marginBottom: 6 }, children: "Fallback Rows" }), _jsx("div", { style: { color: "#ff9f0a", fontSize: 16, fontWeight: 800 }, children: fallbackCount }), _jsx("div", { style: { color: "#64748b", fontSize: 11, marginTop: 6 }, children: "MODEL = All fallback rows" })] }), _jsxs("div", { className: "nv-card", children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 12, marginBottom: 6 }, children: "Payloads" }), _jsx("div", { style: { color: "#f8fafc", fontSize: 16, fontWeight: 800 }, children: buildResult.payloads.length }), _jsx("div", { style: { color: "#64748b", fontSize: 11, marginTop: 6 }, children: "One payload per resolved make" })] })] }), _jsxs("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-secondary btn-sm", onClick: expandAllSections, type: "button", children: "Expand All" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: collapseAllSections, type: "button", children: "Collapse All" })] }), _jsxs("div", { className: "nv-card", children: [_jsx(SectionHeader, { title: "Match Summary", open: !collapsedSections.matchSummary, onToggle: () => toggleSection("matchSummary") }), !collapsedSections.matchSummary ? (_jsxs("div", { style: { display: "grid", gap: 8, fontSize: 13, color: "#cbd5e1" }, children: [_jsxs("div", { children: [_jsx("b", { style: { color: "#94a3b8" }, children: "Rule Name:" }), " ", buildResult.ruleName] }), _jsxs("div", { children: [_jsx("b", { style: { color: "#94a3b8" }, children: "Metadata Makes:" }), " ", buildResult.metadataMakes.join(", ") || "—"] }), _jsxs("div", { children: [_jsx("b", { style: { color: "#94a3b8" }, children: "Resolved Makes:" }), " ", buildResult.resolvedMakes.join(", ") || "—"] }), _jsxs("div", { children: [_jsx("b", { style: { color: "#94a3b8" }, children: "Detected Cost Offset Accounts:" }), _jsx("ul", { style: { margin: "4px 0 0", paddingLeft: 18 }, children: buildResult.costOffsetBuckets.map((bucket) => (_jsxs("li", { children: [bucket.costOffsetAccountName, " ", "(", _jsx("code", { className: "nv-mono", children: bucket.costOffsetAccountId }), ") \u00B7", " ", bucket.bucketRows.length, " chain row", bucket.bucketRows.length === 1 ? "" : "s"] }, bucket.costOffsetAccountId))) })] }), _jsxs("div", { children: [_jsx("b", { style: { color: "#94a3b8" }, children: "Make Payloads:" }), _jsx("ul", { style: { margin: "4px 0 0", paddingLeft: 18 }, children: buildResult.makePlans.map((plan) => (_jsxs("li", { children: [plan.ruleName, " \u00B7 ", plan.modelMatches.length, " mapping row", plan.modelMatches.length === 1 ? "" : "s"] }, plan.make))) })] }), buildResult.existingRule ? (_jsxs("div", { children: [_jsx("b", { style: { color: "#94a3b8" }, children: "Existing Rule:" }), " ", buildResult.existingRule.name, " (", buildResult.existingRule.id, ")"] })) : null] })) : null] }), _jsxs("div", { className: "nv-card", children: [_jsx(SectionHeader, { title: "Linked Sale Accounts For Detected Cost Offsets", open: !collapsedSections.linkedSaleAccounts, onToggle: () => toggleSection("linkedSaleAccounts"), badge: _jsxs("span", { className: "nv-row-count-badge", children: [allCandidateSaleAccounts.length, " row", allCandidateSaleAccounts.length === 1 ? "" : "s"] }) }), !collapsedSections.linkedSaleAccounts ? (_jsx("div", { className: "nv-scroll nv-table-scroll-wrap", style: { maxHeight: 320 }, children: _jsxs("table", { className: "bx-table nv-table-element", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: "nv-sticky-th", children: "Sale Account #" }), _jsx("th", { className: "nv-sticky-th", children: "Sale Account Name" }), _jsx("th", { className: "nv-sticky-th", children: "Mapped Asset ID" }), _jsx("th", { className: "nv-sticky-th", children: "Detected Make" }), _jsx("th", { className: "nv-sticky-th", children: "Make Reason" }), _jsx("th", { className: "nv-sticky-th", children: "Model Hints" }), _jsx("th", { className: "nv-sticky-th", children: "Cost Offset #" }), _jsx("th", { className: "nv-sticky-th", children: "Cost Offset Name" }), _jsx("th", { className: "nv-sticky-th", children: "Detected Body Classes" })] }) }), _jsx("tbody", { children: allCandidateSaleAccounts.map((row, index) => (_jsxs("tr", { className: "nv-zebra-row", children: [_jsx("td", { className: "nv-td", children: _jsx("code", { className: "nv-mono", children: row.saleAccountId_Number || "—" }) }), _jsx("td", { className: "nv-td", children: row.saleAccountId_Name || "—" }), _jsx("td", { className: "nv-td", children: _jsx("code", { className: "nv-mono", children: row.saleAccountId || "—" }) }), _jsx("td", { className: "nv-td", children: row.detectedMake || "—" }), _jsx("td", { className: "nv-td", children: row.detectedMakeReason || "—" }), _jsx("td", { className: "nv-td", children: row.detectedModelHints.length > 0
                                                                        ? row.detectedModelHints.join(", ")
                                                                        : "—" }), _jsx("td", { className: "nv-td", children: _jsx("code", { className: "nv-mono", children: row.costOffsetAccountId || "—" }) }), _jsx("td", { className: "nv-td", children: row.costOffsetAccountId_Name || "—" }), _jsx("td", { className: "nv-td", children: row.detectedBodyClasses.length > 0
                                                                        ? row.detectedBodyClasses.join(", ")
                                                                        : "—" })] }, `${row.saleAccountId}-${index}`))) })] }) })) : null] }), buildResult.warnings.length > 0 ? (_jsxs("div", { className: "nv-card", children: [_jsx(SectionHeader, { title: "Warnings", open: !collapsedSections.warnings, onToggle: () => toggleSection("warnings"), badge: _jsxs("span", { className: "nv-row-count-badge", children: [buildResult.warnings.length, " warning", buildResult.warnings.length === 1 ? "" : "s"] }) }), !collapsedSections.warnings ? (_jsx("div", { style: { maxHeight: 240, overflow: "auto", paddingRight: 4 }, children: _jsx("ul", { style: { margin: 0, paddingLeft: 18, color: "#fbbf24", fontSize: 13 }, children: buildResult.warnings.map((warning, index) => (_jsx("li", { style: { marginBottom: 8 }, children: warning }, index))) }) })) : null] })) : null, _jsxs("div", { className: "nv-card", children: [_jsx(SectionHeader, { title: "Model to Sale Account Mapping", open: !collapsedSections.modelMapping, onToggle: () => toggleSection("modelMapping"), badge: _jsxs("span", { className: "nv-row-count-badge", children: [buildResult.modelMatches.length, " row", buildResult.modelMatches.length === 1 ? "" : "s", " \u00B7 ", matchedCount, " matched \u00B7", " ", fallbackCount, " fallback"] }) }), !collapsedSections.modelMapping ? (_jsx("div", { className: "nv-scroll nv-table-scroll-wrap", style: { maxHeight: 520 }, children: _jsxs("table", { className: "bx-table nv-table-element", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: "nv-sticky-th", children: "Make" }), _jsx("th", { className: "nv-sticky-th", children: "Model" }), _jsx("th", { className: "nv-sticky-th", children: "Body Class" }), _jsx("th", { className: "nv-sticky-th", children: "Sale Account #" }), _jsx("th", { className: "nv-sticky-th", children: "Sale Account Name" }), _jsx("th", { className: "nv-sticky-th", children: "Mapped Asset ID" }), _jsx("th", { className: "nv-sticky-th", children: "Cost Offset Name" }), _jsx("th", { className: "nv-sticky-th", children: "Matched" }), _jsx("th", { className: "nv-sticky-th", children: "Reason" })] }) }), _jsx("tbody", { children: buildResult.makePlans.flatMap((plan) => plan.modelMatches.map((row, idx) => (_jsxs("tr", { className: "nv-zebra-row", children: [_jsx("td", { className: "nv-td", children: plan.make || row.make || "—" }), _jsx("td", { className: "nv-td", children: row.model || "—" }), _jsx("td", { className: "nv-td", children: row.bodyClasses.length > 0 ? row.bodyClasses[0] : "—" }), _jsx("td", { className: "nv-td", children: _jsx("code", { className: "nv-mono", children: row.saleAccountId_Number || "—" }) }), _jsx("td", { className: "nv-td", children: row.saleAccountId_Name || "—" }), _jsx("td", { className: "nv-td", children: _jsx("code", { className: "nv-mono", children: row.mappedAssetId || "—" }) }), _jsx("td", { className: "nv-td", children: row.costOffsetAccountId_Name || "—" }), _jsx("td", { className: "nv-td", children: _jsx("span", { className: "nv-badge", style: { color: row.matched ? "#30d158" : "#ff9f0a" }, children: row.matched ? "YES" : "ALL" }) }), _jsx("td", { className: "nv-td", children: row.matchReason || "—" })] }, `${plan.make}-${row.model}-${idx}`)))) })] }) })) : null] }), _jsxs("div", { className: "nv-card", children: [_jsx(SectionHeader, { title: "Payloads By Make", open: !collapsedSections.payloads, onToggle: () => toggleSection("payloads"), badge: _jsxs("span", { className: "nv-row-count-badge", children: [buildResult.payloads.length, " payload", buildResult.payloads.length === 1 ? "" : "s"] }) }), !collapsedSections.payloads ? (_jsx("div", { style: { display: "grid", gap: 12 }, children: buildResult.payloads.map((entry) => (_jsxs("div", { style: {
                                                    borderRadius: 12,
                                                    border: "1px solid rgba(255,255,255,0.06)",
                                                    background: "rgba(255,255,255,0.015)",
                                                    padding: 12,
                                                }, children: [_jsx("div", { className: "nv-card-title", children: _jsx("span", { children: entry.ruleName }) }), _jsx("div", { className: "nv-scroll nv-table-scroll-wrap", style: { maxHeight: 280 }, children: _jsx("pre", { className: "nv-mono", style: { margin: 0, padding: 10 }, children: JSON.stringify(entry.payload, null, 2) }) })] }, entry.make))) })) : null] }), previewOpen && buildResult.payloads.length > 0 ? (_jsxs("div", { className: "nv-card", children: [_jsx("div", { className: "nv-card-title", children: "Create Payload Preview" }), _jsx("div", { className: "nv-scroll nv-table-scroll-wrap", style: { maxHeight: 360 }, children: _jsx("pre", { className: "nv-mono", style: { margin: 0, padding: 10 }, children: JSON.stringify(buildResult.payloads, null, 2) }) })] })) : null] })) : null] }) })] }));
};
export default NewVehiclesView;
