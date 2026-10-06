import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { GlamSectionHeader } from "../../components/glamShared";
import { idbGetAllBlueprints } from "../../../../../utils/blueprintDb";
import { idbGetAllBootstraps } from "../../../../../utils/bootstrapDb";
import { loadGlobalHeaders } from "../../../../../services/tekionApiSettings";
import terminologyMap from "../../../../../terminology/terminology_mapping.json" with { type: "json" };
const GET_RULES_URL = "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/rule/asset/GLACCOUNT";
const CREATE_RULE_URL = "https://preprodapp.tekioncloud.com/api/accounting/u/settings/mapping/rule";
const rawTerminology = terminologyMap;
const terminologyRules = Array.isArray(rawTerminology)
    ? rawTerminology
    : rawTerminology?.terminology_mapping ?? [];
function normalize(value) {
    return String(value ?? "").trim();
}
function normalizeLower(value) {
    return normalize(value).toLowerCase();
}
function normalizeUpper(value) {
    return normalize(value).toUpperCase();
}
function fmt(value) {
    if (value === null || value === undefined)
        return "";
    if (typeof value === "string")
        return value.trim();
    if (typeof value === "boolean")
        return value ? "true" : "false";
    if (typeof value === "number")
        return String(value);
    if (Array.isArray(value))
        return value.map((x) => fmt(x)).filter(Boolean).join(", ");
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
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
function isAccountingBlueprintForm(formName) {
    const name = normalizeLower(formName);
    return name.includes("blueprint") && name.includes("conquest") && name.includes("accounting");
}
function getBlueprintDealerId(record) {
    return normalize(record.dealerId);
}
function getBootstrapDealerId(record) {
    const raw = record.data;
    const directDealerId = normalize(raw?.dealerId);
    if (directDealerId)
        return directDealerId;
    const wrappedDealerId = normalize(raw?.bootstrap?.dealerId);
    if (wrappedDealerId)
        return wrappedDealerId;
    const nestedDealerId = normalize(raw?.data?.dealerId);
    if (nestedDealerId)
        return nestedDealerId;
    const nestedNestedDealerId = normalize(raw?.data?.data?.dealerId);
    if (nestedNestedDealerId)
        return nestedNestedDealerId;
    const glDealerId = normalize(raw?.glDealerId);
    if (glDealerId)
        return glDealerId;
    const nestedGlDealerId = normalize(raw?.data?.glDealerId);
    if (nestedGlDealerId)
        return nestedGlDealerId;
    const nestedKeys = Object.keys(raw?.data?.allAccounts?.dealerAssetDocMap ?? {});
    if (nestedKeys.length > 0)
        return normalize(nestedKeys[0]);
    const nestedNestedKeys = Object.keys(raw?.data?.data?.allAccounts?.dealerAssetDocMap ?? {});
    if (nestedNestedKeys.length > 0)
        return normalize(nestedNestedKeys[0]);
    const rootKeys = Object.keys(raw?.allAccounts?.dealerAssetDocMap ?? {});
    if (rootKeys.length > 0)
        return normalize(rootKeys[0]);
    return normalize(record.key);
}
function getBlueprintFlatRows(record) {
    const decoded = record.decodedResponse;
    if (Array.isArray(decoded?.populatedFlatRows))
        return decoded.populatedFlatRows;
    if (Array.isArray(decoded?.allFields))
        return decoded.allFields;
    const data = record.data;
    if (Array.isArray(data?.populatedFlatRows))
        return data.populatedFlatRows;
    if (Array.isArray(data?.allFields))
        return data.allFields;
    return [];
}
function extractBootstrapAccounts(record, dealerId) {
    if (!record)
        return [];
    const raw = record.data;
    const requestedDealerId = normalize(dealerId);
    const detectedDealerId = getBootstrapDealerId(record);
    const dealerIds = Array.from(new Set([requestedDealerId, detectedDealerId].filter(Boolean)));
    const results = [];
    function pushAccount(item) {
        if (!item || typeof item !== "object")
            return;
        const obj = item;
        const accountNumber = normalize(obj.accountNumber) ||
            normalize(obj["#"]) ||
            normalize(obj["account_number"]);
        const accountName = normalize(obj.accountName) ||
            normalize(obj["NAME"]) ||
            normalize(obj["account_name"]);
        const id = normalize(obj.id) || normalize(obj["ID"]);
        const key = normalize(obj.key) || normalize(obj["KEY"]);
        const accountType = normalize(obj.accountTypeId) ||
            normalize(obj["TYPE"]) ||
            normalize(obj["accountType"]);
        if (!accountNumber && !accountName && !id && !key)
            return;
        results.push({
            id,
            key,
            accountNumber,
            accountName,
            accountType,
        });
    }
    function pushArray(arr) {
        if (!Array.isArray(arr))
            return;
        for (const item of arr) {
            pushAccount(item);
        }
    }
    pushArray(raw?.glAccounts);
    pushArray(raw?.data?.glAccounts);
    pushArray(raw?.data?.data?.glAccounts);
    pushArray(raw?.bootstrap?.glAccounts);
    pushArray(raw?.body?.glAccounts);
    pushArray(raw?.body?.data?.glAccounts);
    pushArray(raw?.body?.data?.data?.glAccounts);
    for (const candidateDealerId of dealerIds) {
        pushArray(raw?.data?.allAccounts?.dealerAssetDocMap?.[candidateDealerId]);
        pushArray(raw?.data?.data?.allAccounts?.dealerAssetDocMap?.[candidateDealerId]);
        pushArray(raw?.allAccounts?.dealerAssetDocMap?.[candidateDealerId]);
        pushArray(raw?.body?.data?.allAccounts?.dealerAssetDocMap?.[candidateDealerId]);
        pushArray(raw?.body?.data?.data?.allAccounts?.dealerAssetDocMap?.[candidateDealerId]);
    }
    const deduped = new Map();
    for (const account of results) {
        const dedupeKey = `${account.id}__${account.key}__${account.accountNumber}__${account.accountName}`;
        if (!deduped.has(dedupeKey)) {
            deduped.set(dedupeKey, account);
        }
    }
    return Array.from(deduped.values());
}
function extractTokens(value) {
    const normalized = normalize(value);
    if (!normalized)
        return [];
    const matches = normalized.match(/\b[A-Za-z0-9_-]{2,}\b/g) ?? [];
    return Array.from(new Set(matches
        .map((token) => token.trim())
        .filter(Boolean)
        .filter((token) => /[0-9]/.test(token))));
}
function accountMatchesToken(account, token, dealerId) {
    const t = normalize(token);
    const accountNumber = normalize(account.accountNumber);
    if (accountNumber === t)
        return true;
    const accountId = normalize(account.id);
    const accountKey = normalize(account.key);
    return (accountId === t ||
        accountId === `${dealerId}_${t}` ||
        accountKey === t ||
        accountKey === `${dealerId}_${dealerId}_${t}` ||
        accountKey.endsWith(`_${t}`) ||
        accountId.endsWith(`_${t}`) ||
        accountKey.includes(`_${t}`) ||
        accountId.includes(`_${t}`));
}
function findBestAccountFromBlueprintValue(decodedValue, bootstrapAccounts, dealerId) {
    const tokens = extractTokens(decodedValue);
    for (const token of tokens) {
        const matched = bootstrapAccounts.find((account) => accountMatchesToken(account, token, dealerId)) ?? null;
        if (matched) {
            return { token: normalize(token), account: matched };
        }
    }
    return {
        token: normalize(tokens[0] ?? ""),
        account: null,
    };
}
function titleContains(text, needle) {
    return normalizeLower(text).includes(normalizeLower(needle));
}
function findAnswerValue(rows, predicate) {
    const row = rows.find(predicate);
    return row ? fmt(row.decodedValue) : "";
}
function buildBlueprintAnswers(blueprint, bootstrap, dealerId) {
    if (!blueprint || !bootstrap)
        return [];
    const rows = getBlueprintFlatRows(blueprint);
    const bootstrapAccounts = extractBootstrapAccounts(bootstrap, dealerId);
    const questionDefs = [
        {
            key: "WHOLESALE_CAR_ALL",
            label: "Used Vehicle Wholesale > Used Car Sale Account",
            find: (row) => {
                const title = normalize(row.title);
                const combined = `${normalize(row.sectionName)} ${normalize(row.subsectionName)} ${title}`;
                return (titleContains(combined, "used vehicle wholesale") &&
                    titleContains(title, "used car sale account") &&
                    !titleContains(title, "certified") &&
                    !titleContains(title, "non-certified") &&
                    !titleContains(title, "non certified"));
            },
        },
        {
            key: "WHOLESALE_TRUCK_ALL",
            label: "Used Vehicle Wholesale > Used Truck Sale Account",
            find: (row) => {
                const title = normalize(row.title);
                const combined = `${normalize(row.sectionName)} ${normalize(row.subsectionName)} ${title}`;
                return (titleContains(combined, "used vehicle wholesale") &&
                    titleContains(title, "used truck sale account") &&
                    !titleContains(title, "certified") &&
                    !titleContains(title, "non-certified") &&
                    !titleContains(title, "non certified"));
            },
        },
        {
            key: "WHOLESALE_CAR_CERTIFIED",
            label: "Used Vehicle Wholesale > Used Car Sale Account - Certified",
            find: (row) => {
                const title = normalize(row.title);
                const combined = `${normalize(row.sectionName)} ${normalize(row.subsectionName)} ${title}`;
                return (titleContains(combined, "used vehicle wholesale") &&
                    titleContains(title, "used car sale account") &&
                    titleContains(title, "certified") &&
                    !titleContains(title, "non-certified") &&
                    !titleContains(title, "non certified"));
            },
        },
        {
            key: "WHOLESALE_CAR_NON_CERTIFIED",
            label: "Used Vehicle Wholesale > Used Car Sale Account - Non-Certified",
            find: (row) => {
                const title = normalize(row.title);
                const combined = `${normalize(row.sectionName)} ${normalize(row.subsectionName)} ${title}`;
                return (titleContains(combined, "used vehicle wholesale") &&
                    titleContains(title, "used car sale account") &&
                    (titleContains(title, "non-certified") || titleContains(title, "non certified")));
            },
        },
        {
            key: "WHOLESALE_TRUCK_CERTIFIED",
            label: "Used Vehicle Wholesale > Used Truck Sale Account - Certified",
            find: (row) => {
                const title = normalize(row.title);
                const combined = `${normalize(row.sectionName)} ${normalize(row.subsectionName)} ${title}`;
                return (titleContains(combined, "used vehicle wholesale") &&
                    titleContains(title, "used truck sale account") &&
                    titleContains(title, "certified") &&
                    !titleContains(title, "non-certified") &&
                    !titleContains(title, "non certified"));
            },
        },
        {
            key: "WHOLESALE_TRUCK_NON_CERTIFIED",
            label: "Used Vehicle Wholesale > Used Truck Sale Account - Non-Certified",
            find: (row) => {
                const title = normalize(row.title);
                const combined = `${normalize(row.sectionName)} ${normalize(row.subsectionName)} ${title}`;
                return (titleContains(combined, "used vehicle wholesale") &&
                    titleContains(title, "used truck sale account") &&
                    (titleContains(title, "non-certified") || titleContains(title, "non certified")));
            },
        },
        {
            key: "ALL_CAR_ALL",
            label: "Used Vehicle Personal Purchase > Used Car Sale Account",
            find: (row) => {
                const title = normalize(row.title);
                const combined = `${normalize(row.sectionName)} ${normalize(row.subsectionName)} ${title}`;
                return (titleContains(combined, "used vehicle personal purchase") &&
                    titleContains(title, "used car sale account") &&
                    !titleContains(title, "certified") &&
                    !titleContains(title, "non-certified") &&
                    !titleContains(title, "non certified"));
            },
        },
        {
            key: "ALL_TRUCK_ALL",
            label: "Used Vehicle Personal Purchase > Used Truck Sale Account",
            find: (row) => {
                const title = normalize(row.title);
                const combined = `${normalize(row.sectionName)} ${normalize(row.subsectionName)} ${title}`;
                return (titleContains(combined, "used vehicle personal purchase") &&
                    titleContains(title, "used truck sale account") &&
                    !titleContains(title, "certified") &&
                    !titleContains(title, "non-certified") &&
                    !titleContains(title, "non certified"));
            },
        },
        {
            key: "ALL_CAR_CERTIFIED",
            label: "Used Vehicle Personal Purchase > Used Car Sale Account - Certified",
            find: (row) => {
                const title = normalize(row.title);
                const combined = `${normalize(row.sectionName)} ${normalize(row.subsectionName)} ${title}`;
                return (titleContains(combined, "used vehicle personal purchase") &&
                    titleContains(title, "used car sale account") &&
                    titleContains(title, "certified") &&
                    !titleContains(title, "non-certified") &&
                    !titleContains(title, "non certified"));
            },
        },
        {
            key: "ALL_CAR_NON_CERTIFIED",
            label: "Used Vehicle Personal Purchase > Used Car Sale Account - Non-Certified",
            find: (row) => {
                const title = normalize(row.title);
                const combined = `${normalize(row.sectionName)} ${normalize(row.subsectionName)} ${title}`;
                return (titleContains(combined, "used vehicle personal purchase") &&
                    titleContains(title, "used car sale account") &&
                    (titleContains(title, "non-certified") || titleContains(title, "non certified")));
            },
        },
        {
            key: "ALL_TRUCK_CERTIFIED",
            label: "Used Vehicle Personal Purchase > Used Truck Sale Account - Certified",
            find: (row) => {
                const title = normalize(row.title);
                const combined = `${normalize(row.sectionName)} ${normalize(row.subsectionName)} ${title}`;
                return (titleContains(combined, "used vehicle personal purchase") &&
                    titleContains(title, "used truck sale account") &&
                    titleContains(title, "certified") &&
                    !titleContains(title, "non-certified") &&
                    !titleContains(title, "non certified"));
            },
        },
        {
            key: "ALL_TRUCK_NON_CERTIFIED",
            label: "Used Vehicle Personal Purchase > Used Truck Sale Account - Non-Certified",
            find: (row) => {
                const title = normalize(row.title);
                const combined = `${normalize(row.sectionName)} ${normalize(row.subsectionName)} ${title}`;
                return (titleContains(combined, "used vehicle personal purchase") &&
                    titleContains(title, "used truck sale account") &&
                    (titleContains(title, "non-certified") || titleContains(title, "non certified")));
            },
        },
    ];
    return questionDefs.map((def) => {
        const decodedValue = findAnswerValue(rows, def.find);
        const matched = findBestAccountFromBlueprintValue(decodedValue, bootstrapAccounts, dealerId);
        return {
            key: def.key,
            label: def.label,
            decodedValue,
            token: matched.token,
            account: matched.account,
        };
    });
}
function buildMappedAssetId(dealerId, account) {
    if (!account)
        return "";
    if (normalize(account.id))
        return normalize(account.id);
    if (normalize(account.accountNumber))
        return `${dealerId}_${normalize(account.accountNumber)}`;
    return "";
}
function getMakesFromSalesChainDecoded(bootstrap) {
    if (!bootstrap)
        return [];
    const raw = bootstrap.data;
    const candidates = [
        raw?.SalesChains_Decoded,
        raw?.data?.SalesChains_Decoded,
        raw?.body?.SalesChains_Decoded,
    ];
    const rows = candidates.find((x) => Array.isArray(x));
    if (!Array.isArray(rows))
        return [];
    const makes = new Set();
    for (const row of rows) {
        const saleName = normalize(row?.saleAccountId_Name);
        if (!saleName)
            continue;
        const parts = saleName.split(/\s+/);
        const maybeMake = parts.find((part) => /^[A-Za-z]{2,}$/.test(part) && part.toUpperCase() === part);
        if (!maybeMake)
            continue;
        const cleaned = maybeMake.charAt(0).toUpperCase() + maybeMake.slice(1).toLowerCase();
        if ([
            "SLS",
            "RET",
            "RETAIL",
            "USED",
            "NEW",
            "TRUCK",
            "TRUCKS",
            "CARS",
            "CAR",
            "SALE",
            "SALES",
        ].includes(maybeMake.toUpperCase())) {
            continue;
        }
        makes.add(cleaned);
    }
    return Array.from(makes);
}
function pickUsedVehicleMake(answers, bootstrap) {
    const answerTexts = answers
        .map((a) => a.account?.accountName || a.decodedValue)
        .filter(Boolean)
        .join(" ");
    const makes = getMakesFromSalesChainDecoded(bootstrap);
    for (const make of makes) {
        if (normalizeLower(answerTexts).includes(normalizeLower(make))) {
            return make;
        }
    }
    return "All";
}
function rowRank(row) {
    let rank = 0;
    if (row.dealType === "ALL")
        rank += 100;
    if (row.vehicleStatus === "ALL")
        rank += 50;
    if (row.bodyClass === "ALL")
        rank += 25;
    if (normalizeUpper(row.make) === "ALL")
        rank += 10;
    return rank;
}
function answerMapKey(dealType, vehicleStatus, family) {
    return `${dealType}__${vehicleStatus}__${family}`;
}
function buildBaseRows(dealerId, answers, make) {
    const byKey = new Map();
    answers.forEach((a) => byKey.set(a.key, a));
    const rows = [];
    function pushRow(answerKey, dealType, bodyClass, vehicleStatus) {
        const answer = byKey.get(answerKey);
        const mappedAssetId = buildMappedAssetId(dealerId, answer?.account ?? null);
        rows.push({
            dealType,
            bodyClass,
            vehicleStatus,
            make,
            mappedAssetId,
            sourceAnswerKey: answerKey,
            sourceLabel: answer?.label ?? "",
            sourceDecodedValue: answer?.decodedValue ?? "",
            token: answer?.token ?? "",
            matched: Boolean(answer?.account && mappedAssetId),
            sortRank: rowRank({ dealType, bodyClass, vehicleStatus, make }),
        });
    }
    pushRow("WHOLESALE_CAR_CERTIFIED", "WHOLESALE", "Car", "CERTIFIED");
    pushRow("WHOLESALE_TRUCK_CERTIFIED", "WHOLESALE", "Truck/Van", "CERTIFIED");
    pushRow("WHOLESALE_TRUCK_CERTIFIED", "WHOLESALE", "SUV", "CERTIFIED");
    pushRow("WHOLESALE_CAR_NON_CERTIFIED", "WHOLESALE", "Car", "NON_CERTIFIED");
    pushRow("WHOLESALE_TRUCK_NON_CERTIFIED", "WHOLESALE", "Truck/Van", "NON_CERTIFIED");
    pushRow("WHOLESALE_TRUCK_NON_CERTIFIED", "WHOLESALE", "SUV", "NON_CERTIFIED");
    pushRow("WHOLESALE_CAR_ALL", "WHOLESALE", "Car", "ALL");
    pushRow("WHOLESALE_TRUCK_ALL", "WHOLESALE", "Truck/Van", "ALL");
    pushRow("WHOLESALE_TRUCK_ALL", "WHOLESALE", "SUV", "ALL");
    pushRow("WHOLESALE_CAR_ALL", "WHOLESALE", "ALL", "ALL");
    pushRow("ALL_CAR_CERTIFIED", "ALL", "Car", "CERTIFIED");
    pushRow("ALL_TRUCK_CERTIFIED", "ALL", "Truck/Van", "CERTIFIED");
    pushRow("ALL_TRUCK_CERTIFIED", "ALL", "SUV", "CERTIFIED");
    pushRow("ALL_CAR_NON_CERTIFIED", "ALL", "Car", "NON_CERTIFIED");
    pushRow("ALL_TRUCK_NON_CERTIFIED", "ALL", "Truck/Van", "NON_CERTIFIED");
    pushRow("ALL_TRUCK_NON_CERTIFIED", "ALL", "SUV", "NON_CERTIFIED");
    pushRow("ALL_CAR_ALL", "ALL", "Car", "ALL");
    pushRow("ALL_TRUCK_ALL", "ALL", "Truck/Van", "ALL");
    pushRow("ALL_TRUCK_ALL", "ALL", "SUV", "ALL");
    return rows;
}
function compressRows(rows) {
    const matchedRows = rows.filter((row) => row.matched && row.mappedAssetId);
    const unmatchedRows = rows.filter((row) => !row.matched || !row.mappedAssetId);
    const familyMap = new Map();
    for (const row of matchedRows) {
        const family = row.bodyClass === "Car"
            ? "CAR"
            : row.bodyClass === "Truck/Van" || row.bodyClass === "SUV"
                ? "TRUCK"
                : "OTHER";
        const key = answerMapKey(row.dealType, row.vehicleStatus, family);
        if (!familyMap.has(key))
            familyMap.set(key, []);
        familyMap.get(key).push(row);
    }
    const removeKeys = new Set();
    for (const dealType of ["WHOLESALE", "ALL"]) {
        for (const family of ["CAR", "TRUCK"]) {
            const allKey = answerMapKey(dealType, "ALL", family);
            const certKey = answerMapKey(dealType, "CERTIFIED", family);
            const nonCertKey = answerMapKey(dealType, "NON_CERTIFIED", family);
            const allRows = familyMap.get(allKey) ?? [];
            const certRows = familyMap.get(certKey) ?? [];
            const nonCertRows = familyMap.get(nonCertKey) ?? [];
            const allAssetIds = Array.from(new Set(allRows.map((r) => r.mappedAssetId).filter(Boolean)));
            const certAssetIds = Array.from(new Set(certRows.map((r) => r.mappedAssetId).filter(Boolean)));
            const nonCertAssetIds = Array.from(new Set(nonCertRows.map((r) => r.mappedAssetId).filter(Boolean)));
            const allSingle = allAssetIds.length === 1 ? allAssetIds[0] : "";
            const certSingle = certAssetIds.length === 1 ? certAssetIds[0] : "";
            const nonCertSingle = nonCertAssetIds.length === 1 ? nonCertAssetIds[0] : "";
            if (allSingle &&
                certSingle &&
                nonCertSingle &&
                allSingle === certSingle &&
                allSingle === nonCertSingle) {
                removeKeys.add(certKey);
                removeKeys.add(nonCertKey);
            }
        }
    }
    const compressedMatched = matchedRows.filter((row) => {
        const family = row.bodyClass === "Car"
            ? "CAR"
            : row.bodyClass === "Truck/Van" || row.bodyClass === "SUV"
                ? "TRUCK"
                : "OTHER";
        if (family === "OTHER")
            return true;
        const key = answerMapKey(row.dealType, row.vehicleStatus, family);
        return !removeKeys.has(key);
    });
    const deduped = new Map();
    for (const row of compressedMatched) {
        const key = [
            row.dealType,
            row.bodyClass,
            row.vehicleStatus,
            row.make,
            row.mappedAssetId,
        ].join("__");
        if (!deduped.has(key)) {
            deduped.set(key, row);
        }
    }
    return [...Array.from(deduped.values()), ...unmatchedRows].sort((a, b) => a.sortRank - b.sortRank);
}
function buildRows(dealerId, answers, make) {
    const baseRows = buildBaseRows(dealerId, answers, make);
    return compressRows(baseRows);
}
function buildPayload(dealerId, rows) {
    const finalRows = rows.filter((row) => row.matched && row.mappedAssetId);
    return {
        module: "USED_VEHICLE",
        name: "Used Vehicles Sales",
        criteriaList: [],
        mappingColumns: ["DEAL_TYPE", "BODY_CLASS", "VEHICLE_STATUS", "MAKE"],
        mappingList: finalRows.map((row) => ({
            attributes: {
                DEAL_TYPE: row.dealType,
                BODY_CLASS: row.bodyClass,
                VEHICLE_STATUS: row.vehicleStatus,
                MAKE: row.make || "All",
            },
            mappedAssetId: row.mappedAssetId,
            mappedDealerId: dealerId,
            rowId: typeof crypto !== "undefined" && crypto.randomUUID
                ? crypto.randomUUID()
                : `row-${Date.now()}-${Math.random().toString(16).slice(2)}`,
            targetFieldToValueMapping: {},
        })),
        ruleAsset: "GLACCOUNT",
    };
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
function looksLikeUsedVehicleRuleName(name) {
    const lowered = normalize(name).toLowerCase();
    return lowered.includes("used") && lowered.includes("vehicle");
}
function findExistingUsedVehicleRule(payload) {
    const rows = extractRulesPayloadArray(payload);
    for (const item of rows) {
        const obj = asObject(item);
        if (!obj)
            continue;
        const moduleName = normalize(obj.module);
        const name = normalize(obj.name);
        const id = normalize(obj.id);
        if (moduleName !== "USED_VEHICLE")
            continue;
        if (!looksLikeUsedVehicleRuleName(name))
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
const badgeStyle = {
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.03)",
    color: "#cbd5e1",
    fontSize: 12,
    whiteSpace: "nowrap",
};
const sectionStyle = {
    display: "grid",
    gap: 16,
    minWidth: 0,
    maxHeight: "100vh",
    overflowY: "auto",
    overflowX: "hidden",
    boxSizing: "border-box",
    paddingRight: 4,
};
const cardStyle = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.02)",
    padding: 16,
    minWidth: 0,
};
const monoStyle = {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: 12,
    color: "#e2e8f0",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
};
const statGridStyle = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
};
const cardTitleStyle = {
    color: "#f8fafc",
    fontSize: 15,
    fontWeight: 800,
    marginBottom: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
};
const rowCountBadgeStyle = {
    ...badgeStyle,
    fontSize: 11,
    color: "#94a3b8",
};
function tableScrollWrapStyle(maxHeight) {
    return {
        maxHeight,
        overflowY: "auto",
        overflowX: "auto",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.06)",
    };
}
const tableElementStyle = {
    width: "100%",
    borderCollapse: "collapse",
};
const stickyThStyle = {
    position: "sticky",
    top: 0,
    background: "#111827",
    color: "#94a3b8",
    textAlign: "left",
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 700,
    zIndex: 1,
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    whiteSpace: "nowrap",
};
const tdStyle = {
    padding: "8px 10px",
    fontSize: 13,
    borderBottom: "1px solid rgba(255,255,255,0.04)",
    verticalAlign: "middle",
};
function zebraRowStyle(index) {
    return {
        background: index % 2 === 1 ? "rgba(255,255,255,0.015)" : "transparent",
    };
}
const collapsibleHeaderStyle = {
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
    background: "transparent",
    border: "none",
    padding: "4px 6px",
    margin: "-4px -6px 6px -6px",
    borderRadius: 8,
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
};
function ChevronIcon({ open }) {
    return (_jsx("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.5, strokeLinecap: "round", strokeLinejoin: "round", style: {
            flexShrink: 0,
            color: "#94a3b8",
            transform: open ? "rotate(180deg)" : "rotate(-90deg)",
            transition: "transform 0.15s ease",
        }, children: _jsx("polyline", { points: "6 9 12 15 18 9" }) }));
}
function SectionHeader({ title, open, onToggle, badge, }) {
    return (_jsxs("button", { type: "button", className: "uv-section-header", onClick: onToggle, "aria-expanded": open, style: collapsibleHeaderStyle, children: [_jsxs("span", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 }, children: [_jsx(ChevronIcon, { open: open }), _jsx("span", { className: "uv-section-header-title", style: { color: "#f8fafc", fontSize: 15, fontWeight: 800 }, children: title })] }), badge] }));
}
const UsedVehiclesView = () => {
    const [loading, setLoading] = useState(false);
    const [running, setRunning] = useState(false);
    const [buildResult, setBuildResult] = useState(null);
    const [fetchHeaders, setFetchHeaders] = useState({});
    const [message, setMessage] = useState(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [collapsedSections, setCollapsedSections] = useState({
        answerResolution: false,
        warnings: false,
        finalRows: false,
        payloadPreview: false,
    });
    const toggleSection = useCallback((key) => {
        setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
    }, []);
    const expandAllSections = useCallback(() => {
        setCollapsedSections({
            answerResolution: false,
            warnings: false,
            finalRows: false,
            payloadPreview: false,
        });
    }, []);
    const collapseAllSections = useCallback(() => {
        setCollapsedSections({
            answerResolution: true,
            warnings: true,
            finalRows: true,
            payloadPreview: true,
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
        const [allBlueprints, allBootstraps] = await Promise.all([
            idbGetAllBlueprints(),
            idbGetAllBootstraps(),
        ]);
        const blueprintCandidates = allBlueprints
            .filter((bp) => isAccountingBlueprintForm(bp.formName))
            .filter((bp) => getBlueprintDealerId(bp) === dealerId)
            .sort((a, b) => normalize(b.savedAt).localeCompare(normalize(a.savedAt)));
        const blueprint = blueprintCandidates[0] ?? null;
        if (!blueprint) {
            throw new Error(`No accounting blueprint found in IndexedDB for dealer ${dealerId}.`);
        }
        const bootstrapCandidates = allBootstraps
            .filter((bs) => getBootstrapDealerId(bs) === dealerId)
            .sort((a, b) => normalize(b.savedAt).localeCompare(normalize(a.savedAt)));
        const bootstrap = bootstrapCandidates[0] ?? null;
        if (!bootstrap) {
            throw new Error(`No bootstrap snapshot found in IndexedDB for dealer ${dealerId}.`);
        }
        const accounts = extractBootstrapAccounts(bootstrap, dealerId);
        if (accounts.length === 0) {
            throw new Error(`No GL accounts could be extracted from bootstrap for dealer ${dealerId}.`);
        }
        const has201 = accounts.some((a) => normalize(a.accountNumber) === "201");
        if (has201) {
            warnings.push(`Bootstrap GL extraction check: account 201 is present.`);
        }
        const answers = buildBlueprintAnswers(blueprint, bootstrap, dealerId);
        const missing = answers.filter((a) => !a.decodedValue);
        if (missing.length > 0) {
            warnings.push(`Blueprint answers missing: ${missing.map((m) => m.label).join(" | ")}`);
        }
        const unmatched = answers.filter((a) => a.decodedValue && !a.account);
        if (unmatched.length > 0) {
            warnings.push(`Blueprint answers could not be matched to bootstrap GL account: ${unmatched
                .map((m) => `${m.label} => ${m.decodedValue}`)
                .join(" | ")}`);
        }
        const make = pickUsedVehicleMake(answers, bootstrap);
        if (make === "All") {
            warnings.push(`Could not derive make from used sale account names. Defaulting MAKE = All.`);
        }
        const rows = buildRows(dealerId, answers, make);
        const payload = buildPayload(dealerId, rows);
        if (!Array.isArray(payload.mappingList) || payload.mappingList.length === 0) {
            warnings.push("No matched mapping rows survived compression/filtering. Payload mappingList is empty.");
        }
        const proxyRes = await fetch("http://localhost:4000/api/proxy", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url: GET_RULES_URL,
                method: "GET",
                headers: enabledHeaders,
                timeout: 60000,
            }),
        });
        if (!proxyRes.ok) {
            throw new Error(`Rule lookup failed with HTTP ${proxyRes.status}`);
        }
        const proxyJson = (await proxyRes.json());
        if ((proxyJson.status ?? 200) >= 400) {
            throw new Error(`Rule lookup failed: ${proxyJson.status ?? ""} ${proxyJson.statusText ?? ""}`.trim());
        }
        const actualPayload = proxyJson.body ?? proxyJson.data ?? proxyJson;
        const existingRule = findExistingUsedVehicleRule(actualPayload);
        if (existingRule) {
            warnings.push(`Existing USED_VEHICLE rule found: ${existingRule.name} (${existingRule.id}). Create will be skipped.`);
        }
        return {
            dealerId,
            blueprint,
            bootstrap,
            answers,
            rows,
            payload,
            existingRule,
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
            const matchedCount = result.rows.filter((row) => row.matched).length;
            const unmatchedCount = result.rows.filter((row) => !row.matched).length;
            const payloadCount = Array.isArray(result.payload?.mappingList)
                ? result.payload.mappingList.length
                : 0;
            setMessage({
                ok: true,
                text: result.existingRule
                    ? `✅ Existing USED_VEHICLE rule found (${result.existingRule.id}). Preview ready. Matched rows: ${matchedCount}, Unmatched rows: ${unmatchedCount}, Payload rows: ${payloadCount}.`
                    : `✅ Used Vehicles configuration prepared. Matched rows: ${matchedCount}, Unmatched rows: ${unmatchedCount}, Payload rows: ${payloadCount}.`,
            });
        }
        catch (e) {
            setBuildResult(null);
            setMessage({
                ok: false,
                text: e instanceof Error ? e.message : "Failed to analyze Used Vehicles config",
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
                    text: `Create skipped. Existing USED_VEHICLE rule already exists with id ${result.existingRule.id}.`,
                });
                return;
            }
            const mappingList = Array.isArray(result.payload?.mappingList)
                ? result.payload.mappingList
                : [];
            if (mappingList.length === 0) {
                throw new Error("Payload mappingList is empty. Nothing to create.");
            }
            const enabledHeaders = toEnabledHeaderMap(loadGlobalHeaders());
            const proxyRes = await fetch("http://localhost:4000/api/proxy", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    url: CREATE_RULE_URL,
                    method: "POST",
                    headers: enabledHeaders,
                    body: result.payload,
                    timeout: 60000,
                }),
            });
            if (!proxyRes.ok) {
                throw new Error(`Create request failed with HTTP ${proxyRes.status}`);
            }
            const proxyJson = (await proxyRes.json());
            if ((proxyJson.status ?? 200) >= 400) {
                throw new Error(`Create request failed: ${proxyJson.status ?? ""} ${proxyJson.statusText ?? ""}`.trim());
            }
            setMessage({
                ok: true,
                text: `✅ Used Vehicles mapping rule created successfully for dealer ${result.dealerId}.`,
            });
            const refreshed = await buildConfig();
            setBuildResult(refreshed);
        }
        catch (e) {
            setMessage({
                ok: false,
                text: e instanceof Error ? e.message : "Failed to create Used Vehicles rule",
            });
        }
        finally {
            setRunning(false);
        }
    }, [buildConfig, buildResult, refreshHeaders]);
    const matchedCount = buildResult?.rows.filter((row) => row.matched).length ?? 0;
    const unmatchedCount = buildResult?.rows.filter((row) => !row.matched).length ?? 0;
    const payloadCount = Array.isArray(buildResult?.payload?.mappingList)
        ? (buildResult?.payload).mappingList.length
        : 0;
    return (_jsxs("div", { style: sectionStyle, className: "uv-scroll", children: [_jsx("style", { children: `
        .uv-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .uv-scroll::-webkit-scrollbar-track { background: transparent; }
        .uv-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.14); border-radius: 8px; }
        .uv-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.24); }

        .uv-section-header:hover { background: rgba(255,255,255,0.04); }
        .uv-section-header:hover .uv-section-header-title { color: #ffffff; }
        .uv-section-header:focus-visible {
          outline: 2px solid rgba(96,165,250,0.6);
          outline-offset: 2px;
        }
      ` }), _jsx(GlamSectionHeader, { title: "Used Vehicles", description: "Auto build Used Vehicle Sales mapping from Blueprint + Bootstrap", breadcrumb: "Accounting / Variable Operations / Used Vehicles" }), _jsx("div", { style: cardStyle, children: _jsxs("div", { style: { display: "grid", gap: 14 }, children: [_jsxs("div", { children: [_jsx("div", { style: {
                                        color: "#f8fafc",
                                        fontSize: 18,
                                        fontWeight: 800,
                                        marginBottom: 6,
                                    }, children: "Auto Configure" }), _jsx("div", { style: {
                                        color: "#94a3b8",
                                        fontSize: 13,
                                        lineHeight: 1.6,
                                    }, children: "Reads the saved Accounting Blueprint from IndexedDB, extracts the Used Vehicle blueprint answers, matches numeric tokens against saved Bootstrap GL accounts, compresses duplicate scenarios when the same GL account already covers ALL, and excludes scenarios where no GL account exists." })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsxs("span", { style: badgeStyle, children: ["Dealer ID:", " ", _jsx("b", { style: { color: detectedDealerId ? "#86efac" : "#fca5a5" }, children: detectedDealerId || "Not found" })] }), _jsxs("span", { style: badgeStyle, children: ["Module: ", _jsx("b", { style: { color: "#f8fafc" }, children: "USED_VEHICLE" })] }), _jsxs("span", { style: badgeStyle, children: ["Rule Asset: ", _jsx("b", { style: { color: "#f8fafc" }, children: "GLACCOUNT" })] }), _jsxs("span", { style: badgeStyle, children: ["Vehicle Status: ", _jsx("b", { style: { color: "#f8fafc" }, children: "ALL / CERTIFIED / NON_CERTIFIED" })] })] }), _jsxs("div", { style: { display: "flex", gap: 10, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-secondary btn-sm", onClick: refreshHeaders, disabled: loading || running, children: "\u27F3 Refresh Headers" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => void handleAnalyze(), disabled: loading || running || !detectedDealerId, children: loading ? "Analyzing..." : "🧪 Analyze Configuration" }), _jsx("button", { className: "btn-primary", onClick: () => void handleCreate(), disabled: loading || running || !detectedDealerId, children: running ? "Creating..." : "⚙ Auto Configure Used Vehicles" }), buildResult?.payload ? (_jsx("button", { className: "btn-secondary btn-sm", onClick: () => setPreviewOpen((v) => !v), children: previewOpen ? "Hide Payload" : "Show Payload" })) : null] }), message ? (_jsx("div", { style: {
                                borderRadius: 12,
                                padding: "10px 12px",
                                fontSize: 13,
                                color: message.ok ? "#bbf7d0" : "#fecaca",
                                background: message.ok
                                    ? "rgba(34,197,94,0.10)"
                                    : "rgba(239,68,68,0.10)",
                                border: message.ok
                                    ? "1px solid rgba(34,197,94,0.22)"
                                    : "1px solid rgba(239,68,68,0.22)",
                            }, children: message.text })) : null, buildResult ? (_jsxs("div", { style: { display: "grid", gap: 14, minWidth: 0 }, children: [_jsxs("div", { style: statGridStyle, children: [_jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 12, marginBottom: 6 }, children: "Dealer" }), _jsx("div", { style: { color: "#f8fafc", fontSize: 16, fontWeight: 800 }, children: buildResult.dealerId })] }), _jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 12, marginBottom: 6 }, children: "Blueprint Answers" }), _jsx("div", { style: { color: "#f8fafc", fontSize: 16, fontWeight: 800 }, children: buildResult.answers.length })] }), _jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 12, marginBottom: 6 }, children: "Matched Rows" }), _jsx("div", { style: { color: "#30d158", fontSize: 16, fontWeight: 800 }, children: matchedCount })] }), _jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 12, marginBottom: 6 }, children: "Unmatched Rows" }), _jsx("div", { style: { color: "#ff9f0a", fontSize: 16, fontWeight: 800 }, children: unmatchedCount })] }), _jsxs("div", { style: cardStyle, children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 12, marginBottom: 6 }, children: "Payload Rows" }), _jsx("div", { style: { color: "#f8fafc", fontSize: 16, fontWeight: 800 }, children: payloadCount })] })] }), _jsxs("div", { style: { display: "flex", justifyContent: "flex-end", gap: 8 }, children: [_jsx("button", { className: "btn-secondary btn-sm", onClick: expandAllSections, type: "button", children: "Expand All" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: collapseAllSections, type: "button", children: "Collapse All" })] }), _jsxs("div", { style: cardStyle, children: [_jsx(SectionHeader, { title: "Blueprint Answer Resolution", open: !collapsedSections.answerResolution, onToggle: () => toggleSection("answerResolution"), badge: _jsxs("span", { style: rowCountBadgeStyle, children: [buildResult.answers.length, " row", buildResult.answers.length === 1 ? "" : "s"] }) }), !collapsedSections.answerResolution ? (_jsx("div", { className: "uv-scroll", style: tableScrollWrapStyle(340), children: _jsxs("table", { className: "bx-table", style: tableElementStyle, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { style: stickyThStyle, children: "Question" }), _jsx("th", { style: stickyThStyle, children: "Decoded Value" }), _jsx("th", { style: stickyThStyle, children: "Token" }), _jsx("th", { style: stickyThStyle, children: "Account #" }), _jsx("th", { style: stickyThStyle, children: "Account Name" }), _jsx("th", { style: stickyThStyle, children: "ID" }), _jsx("th", { style: stickyThStyle, children: "Matched" })] }) }), _jsx("tbody", { children: buildResult.answers.map((row, index) => (_jsxs("tr", { style: zebraRowStyle(index), children: [_jsx("td", { style: tdStyle, children: row.label }), _jsx("td", { style: tdStyle, children: row.decodedValue || "—" }), _jsx("td", { style: tdStyle, children: _jsx("code", { style: monoStyle, children: row.token || "—" }) }), _jsx("td", { style: tdStyle, children: _jsx("code", { style: monoStyle, children: row.account?.accountNumber || "—" }) }), _jsx("td", { style: tdStyle, children: row.account?.accountName || "—" }), _jsx("td", { style: tdStyle, children: _jsx("code", { style: monoStyle, children: row.account?.id || "—" }) }), _jsx("td", { style: tdStyle, children: _jsx("span", { style: {
                                                                            ...badgeStyle,
                                                                            color: row.account ? "#30d158" : "#ff453a",
                                                                        }, children: row.account ? "YES" : "NO" }) })] }, row.key))) })] }) })) : null] }), buildResult.warnings.length > 0 ? (_jsxs("div", { style: cardStyle, children: [_jsx(SectionHeader, { title: "Warnings", open: !collapsedSections.warnings, onToggle: () => toggleSection("warnings"), badge: _jsxs("span", { style: rowCountBadgeStyle, children: [buildResult.warnings.length, " warning", buildResult.warnings.length === 1 ? "" : "s"] }) }), !collapsedSections.warnings ? (_jsx("div", { style: { maxHeight: 220, overflow: "auto", paddingRight: 4 }, children: _jsx("ul", { style: { margin: 0, paddingLeft: 18, color: "#fbbf24", fontSize: 13 }, children: buildResult.warnings.map((warning, index) => (_jsx("li", { style: { marginBottom: 8 }, children: warning }, index))) }) })) : null] })) : null, _jsxs("div", { style: cardStyle, children: [_jsx(SectionHeader, { title: "Final Row Order After Compression", open: !collapsedSections.finalRows, onToggle: () => toggleSection("finalRows"), badge: _jsxs("span", { style: rowCountBadgeStyle, children: [buildResult.rows.length, " row", buildResult.rows.length === 1 ? "" : "s"] }) }), !collapsedSections.finalRows ? (_jsx("div", { className: "uv-scroll", style: tableScrollWrapStyle(420), children: _jsxs("table", { className: "bx-table", style: tableElementStyle, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { style: stickyThStyle, children: "#" }), _jsx("th", { style: stickyThStyle, children: "Deal Type" }), _jsx("th", { style: stickyThStyle, children: "Body Class" }), _jsx("th", { style: stickyThStyle, children: "Vehicle Status" }), _jsx("th", { style: stickyThStyle, children: "Make" }), _jsx("th", { style: stickyThStyle, children: "Mapped Asset ID" }), _jsx("th", { style: stickyThStyle, children: "From Question" }), _jsx("th", { style: stickyThStyle, children: "Matched" })] }) }), _jsx("tbody", { children: buildResult.rows.map((row, index) => (_jsxs("tr", { style: zebraRowStyle(index), children: [_jsx("td", { style: tdStyle, children: index + 1 }), _jsx("td", { style: tdStyle, children: row.dealType }), _jsx("td", { style: tdStyle, children: row.bodyClass }), _jsx("td", { style: tdStyle, children: row.vehicleStatus }), _jsx("td", { style: tdStyle, children: row.make || "All" }), _jsx("td", { style: tdStyle, children: _jsx("code", { style: monoStyle, children: row.mappedAssetId || "—" }) }), _jsx("td", { style: tdStyle, children: row.sourceLabel || "—" }), _jsx("td", { style: tdStyle, children: _jsx("span", { style: {
                                                                            ...badgeStyle,
                                                                            color: row.matched ? "#30d158" : "#ff453a",
                                                                        }, children: row.matched ? "YES" : "NO" }) })] }, `${row.dealType}-${row.bodyClass}-${row.vehicleStatus}-${index}`))) })] }) })) : null] }), previewOpen ? (_jsxs("div", { style: cardStyle, children: [_jsx(SectionHeader, { title: "Payload Preview", open: !collapsedSections.payloadPreview, onToggle: () => toggleSection("payloadPreview"), badge: _jsxs("span", { style: rowCountBadgeStyle, children: [payloadCount, " payload row", payloadCount === 1 ? "" : "s"] }) }), !collapsedSections.payloadPreview ? (_jsx("div", { className: "uv-scroll", style: tableScrollWrapStyle(360), children: _jsx("pre", { style: { ...monoStyle, margin: 0, padding: 10 }, children: JSON.stringify(buildResult.payload, null, 2) }) })) : null] })) : null] })) : null] }) })] }));
};
export default UsedVehiclesView;
