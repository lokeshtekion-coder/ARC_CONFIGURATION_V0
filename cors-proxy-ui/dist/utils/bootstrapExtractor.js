export const COST_CENTER_KEYS = new Set([
    "DEPARTMENT",
    "REPAIR_ORDER_WARRANTY",
    "REPAIR_ORDER_CP_IW_SPLIT",
    "PARTS_SALES_ORDER_INTERNAL",
    "REPAIR_ORDER_INTERNAL",
]);
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
}
function normalizeRootData(response) {
    const root = asRecord(response);
    if (!root) {
        throw new Error("Invalid response object");
    }
    const wrappedData = asRecord(root.data);
    if (wrappedData) {
        return wrappedData;
    }
    if ("allAccounts" in root ||
        "customField" in root ||
        "allJournals" in root) {
        return root;
    }
    throw new Error("Missing: data");
}
function getNestedRecord(root, key) {
    const value = root[key];
    const rec = asRecord(value);
    if (!rec) {
        throw new Error(`Missing: ${key}`);
    }
    return rec;
}
function getMasterAssetDocMap(container, path) {
    const direct = asRecord(container.masterAssetDocMap);
    if (direct)
        return direct;
    const dealerMap = asRecord(container.dealerAssetDocMap);
    if (dealerMap) {
        const merged = {};
        for (const value of Object.values(dealerMap)) {
            const nested = asRecord(value);
            if (nested) {
                Object.assign(merged, nested);
            }
        }
        if (Object.keys(merged).length > 0)
            return merged;
    }
    throw new Error(`Missing: ${path}`);
}
function detectDealerId(data) {
    const candidates = [
        "allAccounts",
        "customField",
        "allJournals",
        "accountingSettings",
        "apSetup",
        "arSetup",
        "userAccess",
        "monthCloseSetup",
        "activeMonth",
        "activeYear",
    ];
    for (const key of candidates) {
        const section = asRecord(data[key]);
        const dealerAssetDocMap = section ? asRecord(section.dealerAssetDocMap) : null;
        if (dealerAssetDocMap) {
            const dealerIds = Object.keys(dealerAssetDocMap).filter(Boolean);
            if (dealerIds.length > 0)
                return dealerIds[0];
        }
        const masterMap = section ? asRecord(section.masterAssetDocMap) : null;
        if (masterMap) {
            for (const value of Object.values(masterMap)) {
                const rec = asRecord(value);
                if (rec && typeof rec.dealerId === "string" && rec.dealerId.trim()) {
                    return rec.dealerId.trim();
                }
            }
        }
    }
    return "UNKNOWN";
}
function validateAndNormalizeRawData(response) {
    const data = normalizeRootData(response);
    const allAccounts = getNestedRecord(data, "allAccounts");
    const customField = getNestedRecord(data, "customField");
    const allJournals = getNestedRecord(data, "allJournals");
    return {
        dealerId: detectDealerId(data),
        allAccountsMap: getMasterAssetDocMap(allAccounts, "data.allAccounts.masterAssetDocMap"),
        customFieldMap: getMasterAssetDocMap(customField, "data.customField.masterAssetDocMap"),
        allJournalsMap: getMasterAssetDocMap(allJournals, "data.allJournals.masterAssetDocMap"),
    };
}
export function extractBootstrapData(response) {
    const { dealerId, allAccountsMap, customFieldMap, allJournalsMap } = validateAndNormalizeRawData(response);
    const glAccounts = Object.entries(allAccountsMap)
        .map(([mapKey, raw]) => {
        const account = (asRecord(raw) ?? {});
        return {
            key: mapKey,
            accountName: account.accountName ?? "",
            accountNumber: account.accountNumber ?? "",
            active: account.active ?? false,
            id: account.id ?? "",
            accountTypeId: account.accountTypeId ?? "",
        };
    })
        .filter((a) => a.active);
    const costCenterSetup = Object.entries(customFieldMap)
        .map(([mapKey, raw]) => {
        const cf = (asRecord(raw) ?? {});
        return {
            key: mapKey,
            customFieldKey: cf.key ?? "",
            options: Array.isArray(cf.options)
                ? cf.options.map((opt) => ({
                    id: opt?.id ?? "",
                    name: opt?.name ?? "",
                }))
                : [],
        };
    })
        .filter((cc) => COST_CENTER_KEYS.has(cc.customFieldKey));
    const journals = Object.entries(allJournalsMap)
        .map(([mapKey, raw]) => {
        const journal = (asRecord(raw) ?? {});
        return {
            key: mapKey,
            id: journal.id ?? "",
            journalName: journal.journalName ?? "",
            journalNumber: journal.journalNumber ?? "",
        };
    })
        .filter((j) => Boolean(j.id || j.journalName || j.journalNumber));
    return {
        dealerId,
        glAccounts,
        costCenterSetup,
        journals,
    };
}
export function computeStats(output) {
    const foundKeys = output.costCenterSetup.map((cc) => cc.customFieldKey);
    const missingKeys = [...COST_CENTER_KEYS].filter((key) => !foundKeys.includes(key));
    return {
        dealerId: output.dealerId,
        totalGLAccounts: output.glAccounts.length,
        totalJournals: output.journals.length,
        costCenterKeysExpected: COST_CENTER_KEYS.size,
        costCenterKeysFound: foundKeys.length,
        foundKeys,
        missingKeys,
    };
}
function escapeCsv(value) {
    const str = String(value);
    return str.includes(",") || str.includes('"') || str.includes("\n")
        ? `"${str.replace(/"/g, '""')}"`
        : str;
}
export function toCsvString(output) {
    const lines = [];
    lines.push(`dealerId,${escapeCsv(output.dealerId)}`);
    lines.push("");
    lines.push("=== GL ACCOUNTS ===");
    lines.push("key,accountName,accountNumber,active,id,accountTypeId");
    for (const a of output.glAccounts) {
        lines.push([
            escapeCsv(a.key),
            escapeCsv(a.accountName),
            escapeCsv(a.accountNumber),
            escapeCsv(a.active),
            escapeCsv(a.id),
            escapeCsv(a.accountTypeId),
        ].join(","));
    }
    lines.push("");
    lines.push("=== COST CENTER SETUP ===");
    lines.push("key,customFieldKey,optionId,optionName");
    for (const cc of output.costCenterSetup) {
        if (cc.options.length === 0) {
            lines.push([escapeCsv(cc.key), escapeCsv(cc.customFieldKey), "", ""].join(","));
        }
        else {
            for (const opt of cc.options) {
                lines.push([
                    escapeCsv(cc.key),
                    escapeCsv(cc.customFieldKey),
                    escapeCsv(opt.id),
                    escapeCsv(opt.name),
                ].join(","));
            }
        }
    }
    lines.push("");
    lines.push("=== JOURNALS ===");
    lines.push("key,id,journalName,journalNumber");
    for (const j of output.journals) {
        lines.push([
            escapeCsv(j.key),
            escapeCsv(j.id),
            escapeCsv(j.journalName),
            escapeCsv(j.journalNumber),
        ].join(","));
    }
    return lines.join("\n");
}
export function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
