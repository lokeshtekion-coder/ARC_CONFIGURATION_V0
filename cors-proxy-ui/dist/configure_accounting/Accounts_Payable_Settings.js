import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { idbFindBootstrapByDealerId, idbMergeBootstrapData, } from "../utils/bootstrapDb";
import terminologyMap from "../terminology/terminology_mapping.json" with { type: "json" };
const rawTerminology = terminologyMap;
const terminologyRules = Array.isArray(rawTerminology)
    ? rawTerminology
    : (rawTerminology.terminology_mapping ?? []);
function normalize(value) {
    return String(value ?? "").trim();
}
function normalizeLower(value) {
    return normalize(value).toLowerCase();
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
function getBlueprintFlatRows(record) {
    if (!record)
        return [];
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
function normalizeWords(input) {
    return normalize(input)
        .replace(/[\u00A0\u2000-\u200F\u2028-\u202F\u205F\u2060]/g, " ")
        .replace(/[\-_/&]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}
function matchesTerminology(text, rule) {
    const lowered = normalizeWords(text);
    if (!lowered)
        return false;
    const included = rule.includeAny.some((syn) => {
        const escaped = String(syn).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`\\b${escaped}\\b`, "i");
        return re.test(lowered);
    });
    if (!included)
        return false;
    const excluded = rule.exclude.some((ex) => {
        const escaped = String(ex).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`\\b${escaped}\\b`, "i");
        return re.test(lowered);
    });
    return !excluded;
}
function findTerminologyRule(targetMapping) {
    return (terminologyRules.find((rule) => normalizeLower(rule.targetMapping) === normalizeLower(targetMapping)) ?? null);
}
function extractBootstrapAccounts(record, dealerId) {
    if (!record)
        return [];
    const raw = record.data;
    const normalizedDealerId = normalize(dealerId);
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
        for (const item of arr)
            pushAccount(item);
    }
    pushArray(raw?.glAccounts);
    pushArray(raw?.data?.glAccounts);
    pushArray(raw?.bootstrap?.glAccounts);
    pushArray(raw?.data?.allAccounts?.dealerAssetDocMap?.[normalizedDealerId]);
    pushArray(raw?.allAccounts?.dealerAssetDocMap?.[normalizedDealerId]);
    pushArray(raw?.body?.data?.allAccounts?.dealerAssetDocMap?.[normalizedDealerId]);
    const deduped = new Map();
    for (const account of results) {
        const dedupeKey = `${account.id}__${account.key}__${account.accountNumber}__${account.accountName}`;
        if (!deduped.has(dedupeKey))
            deduped.set(dedupeKey, account);
    }
    return Array.from(deduped.values());
}
function extractBootstrapJournals(record, dealerId) {
    if (!record)
        return [];
    const raw = record.data;
    const normalizedDealerId = normalize(dealerId);
    const results = [];
    function pushJournal(item) {
        if (!item || typeof item !== "object")
            return;
        const obj = item;
        const id = normalize(obj.id);
        const key = normalize(obj.key);
        const journalNumber = normalize(obj.journalNumber);
        const journalName = normalize(obj.journalName);
        const active = Boolean(obj.active);
        if (!id && !journalNumber && !journalName && !key)
            return;
        results.push({
            id,
            key,
            journalNumber,
            journalName,
            active,
        });
    }
    function pushArray(arr) {
        if (!Array.isArray(arr))
            return;
        for (const item of arr)
            pushJournal(item);
    }
    pushArray(raw?.journals);
    pushArray(raw?.data?.journals);
    const allJournals = raw?.allJournals ??
        raw?.data?.allJournals ??
        null;
    const master = allJournals?.masterAssetDocMap ?? {};
    const accessibleIds = allJournals?.accessibleAssetMap?.[normalizedDealerId] ?? [];
    if (Array.isArray(accessibleIds) && accessibleIds.length > 0) {
        for (const key of accessibleIds) {
            pushJournal(master?.[key]);
        }
    }
    else {
        for (const item of Object.values(master)) {
            pushJournal(item);
        }
    }
    const deduped = new Map();
    for (const journal of results) {
        const dedupeKey = `${journal.id}__${journal.key}__${journal.journalNumber}__${journal.journalName}`;
        if (!deduped.has(dedupeKey))
            deduped.set(dedupeKey, journal);
    }
    return Array.from(deduped.values());
}
function getRawApSetup(record, dealerId) {
    if (!record)
        return null;
    const raw = record.data;
    return (raw?.apSetup?.dealerAssetDocMap?.[dealerId] ??
        raw?.data?.apSetup?.dealerAssetDocMap?.[dealerId] ??
        null);
}
function getAllBlueprintAnswers(record) {
    const rows = getBlueprintFlatRows(record);
    return rows
        .map((row) => ({
        title: normalize(row.title),
        decodedValue: fmt(row.decodedValue),
        sectionName: normalize(row.sectionName),
        subsectionName: normalize(row.subsectionName),
    }))
        .filter((row) => row.title || row.decodedValue);
}
function isAccountsPayableRow(answer) {
    const blob = `${answer.sectionName} ${answer.subsectionName} ${answer.title}`.toLowerCase();
    return blob.includes("accounts payable");
}
function findAnswerByTitleIncludes(answers, includesAny, apOnly = true) {
    const normalizedNeedles = includesAny.map((x) => normalizeLower(x));
    for (const answer of answers) {
        if (apOnly && !isAccountsPayableRow(answer))
            continue;
        const hay = `${answer.title} ${answer.sectionName} ${answer.subsectionName}`.toLowerCase();
        if (normalizedNeedles.some((needle) => hay.includes(needle))) {
            return answer;
        }
    }
    return null;
}
function extractNumericValue(value) {
    const match = normalize(value).match(/-?\d+/);
    if (!match)
        return null;
    const n = Number(match[0]);
    return Number.isFinite(n) ? n : null;
}
function extractTokens(value) {
    const normalized = normalize(value);
    if (!normalized)
        return [];
    const matches = normalized.match(/\b[A-Za-z0-9_-]{1,}\b/g) ?? [];
    return Array.from(new Set(matches.map((token) => token.trim()).filter(Boolean)));
}
function accountMatchesToken(account, token, dealerId) {
    const t = normalize(token);
    const accountNumber = normalize(account.accountNumber);
    const accountId = normalize(account.id);
    const accountKey = normalize(account.key);
    return (accountNumber === t ||
        accountId === t ||
        accountId === `${dealerId}_${t}` ||
        accountKey === t ||
        accountKey === `${dealerId}_${dealerId}_${t}` ||
        accountKey.endsWith(`_${t}`));
}
function resolveAccountFromValue(input, accounts, dealerId) {
    const tokens = extractTokens(input);
    console.log("[AP] resolveAccountFromValue input", input);
    console.log("[AP] resolveAccountFromValue tokens", tokens);
    for (const token of tokens) {
        const exact = accounts.find((account) => accountMatchesToken(account, token, dealerId)) ?? null;
        console.log("[AP] token", token, "matched exact account", exact);
        if (exact)
            return exact;
    }
    return null;
}
function resolveAccountIdFromValue(input, accounts, dealerId) {
    return resolveAccountFromValue(input, accounts, dealerId)?.id ?? null;
}
function resolveAccountIdsFromValue(input, accounts, dealerId) {
    const tokens = extractTokens(input);
    const found = new Map();
    for (const token of tokens) {
        const exact = accounts.find((account) => accountMatchesToken(account, token, dealerId)) ?? null;
        if (exact?.id)
            found.set(exact.id, exact);
    }
    return Array.from(found.values()).map((a) => a.id);
}
function findJournalByTargetMapping(journals, targetMapping) {
    const rule = findTerminologyRule(targetMapping);
    console.log("[AP] findJournalByTargetMapping target", targetMapping, "rule", rule);
    if (!rule)
        return null;
    for (const journal of journals) {
        const hay = `${journal.journalName} ${journal.journalNumber}`;
        const matched = matchesTerminology(hay, rule);
        console.log("[AP] journal candidate", journal, "hay", hay, "matched", matched);
        if (matched)
            return journal;
    }
    return null;
}
function buildBatchObject(paymentDay, cutOffMonth, cutOffDay) {
    return [
        {
            category: "GENERAL",
            groupName: "Batch Payment",
            vendorIds: ["ALL"],
            paymentBatches: [
                {
                    paymentDay,
                    cutOffMonth,
                    cutOffDay,
                },
            ],
            dateType: "INVOICE_DATE",
        },
    ];
}
function buildDateSetupObject(paymentDay, cutOffDay) {
    return [
        {
            groupName: "Invoice Date",
            vendorIds: ["ALL"],
            hasInvoiceDateSetting: true,
            invoiceDateSettings: [
                {
                    conditionOperator: "ON_OR_BEFORE",
                    conditionDay: paymentDay,
                    resultMonthType: "DATE_IN_CURRENT_MONTH",
                    resultDay: cutOffDay,
                },
            ],
            hasInvoiceDueDateSetting: false,
            invoiceDueDateSettings: [{}],
        },
    ];
}
function buildDefault1099InfoFromDealerMaster(dealerMaster, existingApSetup) {
    const existing = existingApSetup?.setup1099Info ??
        existingApSetup?.setup1099 ??
        null;
    if (existing && Object.keys(existing).length > 0) {
        return existing;
    }
    const dm = dealerMaster?.data ?? dealerMaster ?? {};
    const firstAddress = Array.isArray(dm?.dealerAddress) ? dm.dealerAddress[0] ?? {} : {};
    const countryRaw = normalize(firstAddress?.country);
    const country = countryRaw === "US"
        ? "United States"
        : countryRaw === "CA"
            ? "CANADA"
            : countryRaw || "";
    return {
        payerName: normalize(dm?.dealerName),
        payerAddressDto: {
            addressLine1: normalize(firstAddress?.streetAddress1),
            city: normalize(firstAddress?.city),
            state: normalize(firstAddress?.state),
            zipCode: normalize(firstAddress?.zipCode),
            country,
        },
        payerTelephone: "0000000000",
        payerTin: "0",
        contactName: "Test name",
        contactEmailAddress: "Test@nodomain.com",
        contactFaxNumber: "0",
        electronicFiling1099: {
            transmitterInformation: {},
            companyInformation: {},
            contactInformation: {},
            combinedFillingSettings: {},
        },
        printYYFor1099INTForm: false,
        printYYFor1099MISCForm: false,
        printYYFor1099NECForm: false,
    };
}
function bestBankMatchFromApi(bankNameFromBlueprint, bankApiData) {
    const banks = Array.isArray(bankApiData?.data)
        ? bankApiData.data
        : Array.isArray(bankApiData)
            ? bankApiData
            : [];
    const blueprintName = normalizeWords(bankNameFromBlueprint);
    if (!blueprintName)
        return null;
    let best = null;
    let bestScore = -1;
    for (const bank of banks) {
        const bankName = normalize(bank?.bankName);
        const bankNameCountrySpecific = normalize(bank?.bankUniqueKeyCountrySpecific);
        const branches = Array.isArray(bank?.branchDetails) ? bank.branchDetails : [];
        let score = 0;
        const bankNameNorm = normalizeWords(bankName);
        if (!bankNameNorm)
            continue;
        if (bankNameNorm === blueprintName)
            score += 100;
        if (bankNameNorm.includes(blueprintName))
            score += 40;
        if (blueprintName.includes(bankNameNorm))
            score += 25;
        const bankWords = new Set(bankNameNorm.split(" ").filter(Boolean));
        const blueprintWords = new Set(blueprintName.split(" ").filter(Boolean));
        for (const word of blueprintWords) {
            if (bankWords.has(word))
                score += 5;
        }
        if (score > bestScore) {
            best = {
                bankName,
                bankUniqueKey: bankNameCountrySpecific,
                branchUniqueKey: normalize(branches[0]?.branchUniqueKeyCountrySpecific) ||
                    normalize(branches[0]?.branchUniqueKey) ||
                    "",
                raw: bank,
            };
            bestScore = score;
        }
    }
    return bestScore > 0 ? best : null;
}
function buildCashInBankAccounts(existingCashInBankAccounts, bankGlAccountId, firstCheckNumber, bankMatch) {
    if (!bankGlAccountId)
        return [];
    const firstExisting = Array.isArray(existingCashInBankAccounts) && existingCashInBankAccounts.length > 0
        ? existingCashInBankAccounts[0]
        : {};
    return [
        {
            ...firstExisting,
            checkWritingDisabled: false,
            enableInterFranchiseCIBGlAccount: false,
            glAccountId: bankGlAccountId,
            bankAccountNumber: normalize(firstExisting?.bankAccountNumber) || "1",
            checkStartNumber: firstCheckNumber,
            eftStartNumber: typeof firstExisting?.eftStartNumber === "number" ? firstExisting.eftStartNumber : 1,
            authorizedCheckSignerIds: Array.isArray(firstExisting?.authorizedCheckSignerIds)
                ? firstExisting.authorizedCheckSignerIds
                : [],
            primary: true,
            checkSignatureLines: typeof firstExisting?.checkSignatureLines === "number"
                ? firstExisting.checkSignatureLines
                : 2,
            displayBankAddress: true,
            bankUniqueKey: bankMatch?.bankUniqueKey ?? normalize(firstExisting?.bankUniqueKey),
            branchUniqueKey: bankMatch?.branchUniqueKey ?? normalize(firstExisting?.branchUniqueKey),
            bankAddress: firstExisting?.bankAddress && typeof firstExisting.bankAddress === "object"
                ? firstExisting.bankAddress
                : {},
            dealerCheckConfig: firstExisting?.dealerCheckConfig && typeof firstExisting.dealerCheckConfig === "object"
                ? firstExisting.dealerCheckConfig
                : {},
            checkDateFormatType: normalize(firstExisting?.checkDateFormatType) || "MMDDYYYY",
            fileFormatType: normalize(firstExisting?.fileFormatType) || "XLS",
            customMICRLayoutForAccountNumber: Boolean(firstExisting?.customMICRLayoutForAccountNumber),
            accountNumberDisplacement: typeof firstExisting?.accountNumberDisplacement === "number"
                ? firstExisting.accountNumberDisplacement
                : 0,
            customiseCheck: Boolean(firstExisting?.customiseCheck),
            checkCustomisationDetails: firstExisting?.checkCustomisationDetails &&
                typeof firstExisting.checkCustomisationDetails === "object"
                ? firstExisting.checkCustomisationDetails
                : {},
            enableCheckLogoCustomisation: Boolean(firstExisting?.enableCheckLogoCustomisation),
        },
    ];
}
async function proxyRequest(payload) {
    const res = await fetch("http://localhost:4000/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Proxy HTTP ${res.status}: ${text}`);
    }
    return (await res.json());
}
export const AccountsPayableSettings = ({ onClose, dealerId, blueprintRecord, tekionBootstrapHeaders, }) => {
    const [loading, setLoading] = useState(true);
    const [bootstrapRecord, setBootstrapRecord] = useState(null);
    const [error, setError] = useState(null);
    const [viewMode, setViewMode] = useState("beautiful");
    const [phase2Loading, setPhase2Loading] = useState(false);
    const [phase2Message, setPhase2Message] = useState(null);
    const [bankApiData, setBankApiData] = useState(null);
    const [dealerMasterData, setDealerMasterData] = useState(null);
    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            setError(null);
            try {
                const selected = await idbFindBootstrapByDealerId(dealerId);
                if (cancelled)
                    return;
                setBootstrapRecord(selected);
                console.log("[AP] dealerId", dealerId);
                console.log("[AP] blueprintRecord", blueprintRecord);
                console.log("[AP] selected bootstrap record", selected);
                console.log("[AP] bootstrap data keys", Object.keys((selected?.data ?? {})));
            }
            catch (e) {
                if (cancelled)
                    return;
                setError(e instanceof Error ? e.message : "Failed to load bootstrap data");
            }
            finally {
                if (!cancelled)
                    setLoading(false);
            }
        }
        void load();
        return () => {
            cancelled = true;
        };
    }, [dealerId, blueprintRecord]);
    const blueprintAnswers = useMemo(() => getAllBlueprintAnswers(blueprintRecord), [blueprintRecord]);
    const accounts = useMemo(() => extractBootstrapAccounts(bootstrapRecord, dealerId), [bootstrapRecord, dealerId]);
    const journals = useMemo(() => extractBootstrapJournals(bootstrapRecord, dealerId), [bootstrapRecord, dealerId]);
    const existingApSetup = useMemo(() => getRawApSetup(bootstrapRecord, dealerId), [bootstrapRecord, dealerId]);
    const sourceAnswers = useMemo(() => {
        const apBatchDate = findAnswerByTitleIncludes(blueprintAnswers, [
            "On what date do you typically run your AP batch",
            "run your ap batch",
        ]);
        const apCutoffMonth = findAnswerByTitleIncludes(blueprintAnswers, [
            "In which month is your invoice cutoff date",
            "invoice cutoff date",
        ]);
        const apCutoffDay = findAnswerByTitleIncludes(blueprintAnswers, [
            "What is your Invoice cutoff date",
            "invoice cutoff date",
        ]);
        const apOpenItem = findAnswerByTitleIncludes(blueprintAnswers, [
            "Which AP GL accounts do you use in the AP open-item feature",
            "open-item feature",
            "ap open-item",
        ]);
        const apDiscount = findAnswerByTitleIncludes(blueprintAnswers, [
            "AP Discount Account Number",
            "discount account number",
        ]);
        const apBankGl = findAnswerByTitleIncludes(blueprintAnswers, [
            "AP Bank Account GL Account Number",
            "bank account gl account number",
        ]);
        const apFirstCheck = findAnswerByTitleIncludes(blueprintAnswers, [
            "What would you like your first check # in Tekion to be",
            "first check #",
            "first check number",
        ], false);
        const apBankName = findAnswerByTitleIncludes(blueprintAnswers, [
            "AP Bank Name",
            "bank name",
        ]);
        return {
            apBatchDate,
            apCutoffMonth,
            apCutoffDay,
            apOpenItem,
            apDiscount,
            apBankGl,
            apFirstCheck,
            apBankName,
        };
    }, [blueprintAnswers]);
    const bankMatch = useMemo(() => {
        const name = sourceAnswers.apBankName?.decodedValue ?? "";
        const match = bestBankMatchFromApi(name, bankApiData);
        console.log("[AP] bank blueprint name", name);
        console.log("[AP] bank api data", bankApiData);
        console.log("[AP] bank match", match);
        return match;
    }, [sourceAnswers.apBankName, bankApiData]);
    const derived = useMemo(() => {
        const paymentDay = extractNumericValue(sourceAnswers.apBatchDate?.decodedValue ?? "");
        const cutoffDay = extractNumericValue(sourceAnswers.apCutoffDay?.decodedValue ?? "");
        const monthRaw = normalizeLower(sourceAnswers.apCutoffMonth?.decodedValue ?? "");
        const cutoffMonth = monthRaw.includes("previous") || monthRaw.includes("before")
            ? "PREVIOUS_MONTH"
            : "CURRENT_MONTH";
        const apGlAccountIds = resolveAccountIdsFromValue(sourceAnswers.apOpenItem?.decodedValue ?? "", accounts, dealerId);
        const discountGlAccountId = resolveAccountIdFromValue(sourceAnswers.apDiscount?.decodedValue ?? "", accounts, dealerId) ??
            `${dealerId}_9999`;
        const cashPaymentJournal = findJournalByTargetMapping(journals, "Accounts Payable Settings cashPaymentJournalIds");
        const purchaseJournal = findJournalByTargetMapping(journals, "Accounts Payable Settings purchaseJournalId");
        const bankGlAccountId = resolveAccountIdFromValue(sourceAnswers.apBankGl?.decodedValue ?? "", accounts, dealerId);
        const firstCheckNumber = extractNumericValue(sourceAnswers.apFirstCheck?.decodedValue ?? "") ?? 1000000;
        console.log("[AP] sourceAnswers", sourceAnswers);
        console.log("[AP] derived paymentDay", paymentDay);
        console.log("[AP] derived cutoffDay", cutoffDay);
        console.log("[AP] derived cutoffMonth", cutoffMonth);
        console.log("[AP] derived apGlAccountIds", apGlAccountIds);
        console.log("[AP] derived discountGlAccountId", discountGlAccountId);
        console.log("[AP] derived cashPaymentJournal", cashPaymentJournal);
        console.log("[AP] derived purchaseJournal", purchaseJournal);
        console.log("[AP] derived bankGlAccountId", bankGlAccountId);
        console.log("[AP] derived firstCheckNumber", firstCheckNumber);
        return {
            batchPaymentDay: paymentDay,
            cutoffMonth,
            cutoffDay,
            apGlAccountIds,
            discountGlAccountId,
            cashPaymentJournalIds: cashPaymentJournal?.id ? [cashPaymentJournal.id] : [],
            purchaseJournalId: purchaseJournal?.id ?? null,
            bankGlAccountId,
            firstCheckNumber,
        };
    }, [accounts, dealerId, journals, sourceAnswers]);
    const finalPayload = useMemo(() => {
        const base = { ...(existingApSetup ?? {}) };
        const payload = {
            ...base,
            dealerId,
            batchSetups: buildBatchObject(derived.batchPaymentDay, derived.cutoffMonth, derived.cutoffDay),
            apGlAccountIds: derived.apGlAccountIds,
            discountGlAccountId: derived.discountGlAccountId,
            cashPaymentJournalIds: derived.cashPaymentJournalIds,
            purchaseJournalId: derived.purchaseJournalId,
            cashInBankAccounts: buildCashInBankAccounts(base?.cashInBankAccounts, derived.bankGlAccountId, derived.firstCheckNumber, bankMatch
                ? {
                    bankUniqueKey: normalize(bankMatch.bankUniqueKey),
                    branchUniqueKey: normalize(bankMatch.branchUniqueKey),
                }
                : null),
            invoicePreferenceSortOrder: "INVOICE_DATE_ASC",
            dateSetup: buildDateSetupObject(derived.batchPaymentDay, derived.cutoffDay),
            setup1099Info: buildDefault1099InfoFromDealerMaster(dealerMasterData, existingApSetup),
        };
        console.log("[AP] existingApSetup", existingApSetup);
        console.log("[AP] finalPayload", payload);
        return payload;
    }, [bankMatch, dealerId, dealerMasterData, derived, existingApSetup]);
    const matchedApAccounts = useMemo(() => {
        const ids = new Set(derived.apGlAccountIds);
        return accounts.filter((a) => ids.has(a.id));
    }, [accounts, derived.apGlAccountIds]);
    const matchedDiscountAccount = useMemo(() => {
        return accounts.find((a) => a.id === derived.discountGlAccountId) ?? null;
    }, [accounts, derived.discountGlAccountId]);
    const matchedBankAccount = useMemo(() => {
        return accounts.find((a) => a.id === derived.bankGlAccountId) ?? null;
    }, [accounts, derived.bankGlAccountId]);
    const matchedCashJournal = useMemo(() => {
        return journals.find((j) => j.id === derived.cashPaymentJournalIds[0]) ?? null;
    }, [journals, derived.cashPaymentJournalIds]);
    const matchedPurchaseJournal = useMemo(() => {
        return journals.find((j) => j.id === derived.purchaseJournalId) ?? null;
    }, [journals, derived.purchaseJournalId]);
    const handlePhase2Fetch = async () => {
        try {
            setPhase2Loading(true);
            setPhase2Message(null);
            if (!tekionBootstrapHeaders || Object.keys(tekionBootstrapHeaders).length === 0) {
                throw new Error("Missing tekionBootstrapHeaders. Select/apply headers in Settings first.");
            }
            console.log("[AP] Phase2 headers", tekionBootstrapHeaders);
            const bankResp = await proxyRequest({
                url: "https://preprodapp.tekioncloud.com/api/accounting-bank-details/u/bankDetails/bankAndBranchDetails/US",
                method: "GET",
                headers: tekionBootstrapHeaders,
            });
            console.log("[AP] bankResp", bankResp);
            const dealerMasterResp = await proxyRequest({
                url: "https://preprodapp.tekioncloud.com/api//api-core/u/dealer-master",
                method: "GET",
                headers: tekionBootstrapHeaders,
            });
            console.log("[AP] dealerMasterResp", dealerMasterResp);
            const current = await idbFindBootstrapByDealerId(dealerId);
            const mergeKey = current?.key ?? dealerId;
            const merged = await idbMergeBootstrapData(mergeKey, {
                bankDetailsUS: bankResp.data,
                dealerMaster: dealerMasterResp.data,
            }, {
                dealerName: current?.dealerName ?? dealerId,
                envName: current?.envName ?? dealerId,
            });
            console.log("[AP] merged bootstrap record after phase2 fetch", merged);
            setBankApiData(bankResp.data);
            setDealerMasterData(dealerMasterResp.data);
            setBootstrapRecord(merged);
            setPhase2Message("Fetched bank details + dealer master and saved into IndexedDB.");
        }
        catch (e) {
            console.error("[AP] Phase2 fetch failed", e);
            setPhase2Message(e instanceof Error ? e.message : "Phase 2 fetch failed");
        }
        finally {
            setPhase2Loading(false);
        }
    };
    useEffect(() => {
        const data = bootstrapRecord?.data ?? {};
        const bankData = data?.bankDetailsUS ?? null;
        const dm = data?.dealerMaster ?? null;
        console.log("[AP] existing bankDetailsUS from IDB", bankData);
        console.log("[AP] existing dealerMaster from IDB", dm);
        setBankApiData(bankData);
        setDealerMasterData(dm);
    }, [bootstrapRecord]);
    useEffect(() => {
        console.log("[AP] accounts length", accounts.length);
        console.log("[AP] accounts sample", accounts.slice(0, 10));
        console.log("[AP] account exact 201", accounts.filter((a) => a.accountNumber === "201" ||
            a.id === "201" ||
            a.id === `${dealerId}_201` ||
            a.key === `${dealerId}_${dealerId}_201`));
        console.log("[AP] journals length", journals.length);
        console.log("[AP] journals sample", journals.slice(0, 10));
        console.log("[AP] blueprintAnswers sample", blueprintAnswers.slice(0, 20));
    }, [accounts, blueprintAnswers, dealerId, journals]);
    const sourceRows = [
        { label: "AP Batch Date", answer: sourceAnswers.apBatchDate },
        { label: "AP Cutoff Month", answer: sourceAnswers.apCutoffMonth },
        { label: "AP Cutoff Day", answer: sourceAnswers.apCutoffDay },
        { label: "AP Open Item GL", answer: sourceAnswers.apOpenItem },
        { label: "AP Discount GL", answer: sourceAnswers.apDiscount },
        { label: "AP Bank GL", answer: sourceAnswers.apBankGl },
        { label: "First Check #", answer: sourceAnswers.apFirstCheck },
        { label: "AP Bank Name", answer: sourceAnswers.apBankName },
    ];
    return (_jsx("div", { className: "bx-modal-overlay", style: {
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.72)",
            zIndex: 1200,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: 20,
        }, children: _jsxs("div", { className: "bx-shell", style: {
                width: "min(1500px, 96vw)",
                maxHeight: "92vh",
                overflow: "auto",
                background: "#16181d",
                borderRadius: 18,
                border: "1px solid rgba(255,255,255,0.08)",
            }, children: [_jsxs("div", { className: "bx-header", style: {
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        position: "sticky",
                        top: 0,
                        zIndex: 2,
                        background: "#16181d",
                    }, children: [_jsxs("div", { children: [_jsx("div", { className: "bx-title", children: "\u2699\uFE0F Configure - Accounts Payable Settings" }), _jsxs("div", { style: { fontSize: 12, opacity: 0.75, marginTop: 4 }, children: ["Dealer: ", _jsx("b", { children: dealerId || "—" }), " · ", "GLs: ", _jsx("b", { children: accounts.length }), " · ", "Journals: ", _jsx("b", { children: journals.length }), " · ", "Bank API: ", _jsx("b", { children: bankApiData ? "Loaded" : "Not Loaded" }), " · ", "Dealer Master: ", _jsx("b", { children: dealerMasterData ? "Loaded" : "Not Loaded" })] })] }), _jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-secondary btn-sm", onClick: () => setViewMode("beautiful"), style: viewMode === "beautiful" ? { borderColor: "#0a84ff", color: "#0a84ff" } : undefined, children: "\u2728 Beautiful View" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => setViewMode("json"), style: viewMode === "json" ? { borderColor: "#0a84ff", color: "#0a84ff" } : undefined, children: "\uD83E\uDDFE JSON View" }), _jsx("button", { className: "btn-postman", onClick: () => void handlePhase2Fetch(), disabled: phase2Loading, children: phase2Loading ? "⏳ Fetching..." : "🌐 Fetch Phase 2 APIs" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: onClose, children: "\u2715 Close" })] })] }), _jsx("div", { className: "bx-body", style: { padding: 18 }, children: loading ? (_jsxs("div", { className: "bx-empty-state", children: [_jsx("span", { className: "bx-empty-icon", children: "\u23F3" }), _jsx("span", { children: "Loading AP dependencies from IndexedDB\u2026" })] })) : error ? (_jsxs("div", { className: "bx-error", children: ["\u26A0 ", error] })) : !bootstrapRecord ? (_jsxs("div", { className: "bx-empty-state", children: [_jsx("span", { className: "bx-empty-icon", children: "\uD83D\uDCED" }), _jsxs("span", { children: ["No bootstrap record found for dealer ", dealerId] })] })) : (_jsxs(_Fragment, { children: [phase2Message && (_jsx("div", { style: {
                                    marginBottom: 14,
                                    padding: "10px 12px",
                                    borderRadius: 12,
                                    border: "1px solid rgba(10,132,255,.25)",
                                    background: "rgba(10,132,255,.08)",
                                    color: "#9ecbff",
                                    fontSize: 13,
                                }, children: phase2Message })), viewMode === "json" ? (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsxs("div", { style: panelStyle, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 10 }, children: "Final AP Payload" }), _jsx("pre", { style: preStyle, children: JSON.stringify(finalPayload, null, 2) })] }), _jsxs("div", { style: panelStyle, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 10 }, children: "Debug Sources Snapshot" }), _jsx("pre", { style: preStyle, children: JSON.stringify({
                                                    dealerId,
                                                    sourceAnswers,
                                                    derived,
                                                    bankMatch,
                                                    existingApSetup,
                                                    bankApiLoaded: !!bankApiData,
                                                    dealerMasterLoaded: !!dealerMasterData,
                                                    bootstrapKey: bootstrapRecord.key,
                                                    bootstrapDataKeys: Object.keys((bootstrapRecord.data ?? {})),
                                                }, null, 2) })] })] })) : (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsxs("div", { style: {
                                            display: "grid",
                                            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                                            gap: 12,
                                        }, children: [_jsxs("div", { style: cardStyle, children: [_jsx("div", { style: labelStyle, children: "Bootstrap Key" }), _jsx("div", { style: valueStyle, children: bootstrapRecord.key })] }), _jsxs("div", { style: cardStyle, children: [_jsx("div", { style: labelStyle, children: "Bootstrap Data Keys" }), _jsx("div", { style: valueStyle, children: Object.keys((bootstrapRecord.data ?? {})).join(", ") || "—" })] }), _jsxs("div", { style: cardStyle, children: [_jsx("div", { style: labelStyle, children: "GL Accounts" }), _jsx("div", { style: valueStyle, children: accounts.length })] }), _jsxs("div", { style: cardStyle, children: [_jsx("div", { style: labelStyle, children: "Journals" }), _jsx("div", { style: valueStyle, children: journals.length })] }), _jsxs("div", { style: cardStyle, children: [_jsx("div", { style: labelStyle, children: "Bank API" }), _jsx("div", { style: valueStyle, children: bankApiData ? "Loaded" : "Pending" })] }), _jsxs("div", { style: cardStyle, children: [_jsx("div", { style: labelStyle, children: "Dealer Master" }), _jsx("div", { style: valueStyle, children: dealerMasterData ? "Loaded" : "Pending" })] })] }), _jsxs("div", { style: {
                                            display: "grid",
                                            gridTemplateColumns: "1fr 1fr",
                                            gap: 16,
                                        }, children: [_jsxs("div", { style: panelStyle, children: [_jsx("div", { style: panelTitle, children: "Blueprint Source Values" }), _jsx("div", { style: { display: "grid", gap: 10 }, children: sourceRows.map((item) => (_jsxs("div", { style: subCardStyle, children: [_jsx("div", { style: labelStyle, children: item.label }), _jsx("div", { style: { marginTop: 6, fontWeight: 700 }, children: item.answer?.title || "—" }), _jsx("div", { style: { marginTop: 4, color: "#d4d4d8", fontSize: 13 }, children: item.answer?.decodedValue || "—" })] }, item.label))) })] }), _jsxs("div", { style: panelStyle, children: [_jsx("div", { style: panelTitle, children: "Resolved Mappings" }), _jsxs("div", { style: { display: "grid", gap: 10 }, children: [_jsxs("div", { style: subCardStyle, children: [_jsx("div", { style: labelStyle, children: "Batch Setup" }), _jsxs("div", { style: { marginTop: 6 }, children: ["Payment Day: ", _jsx("b", { children: derived.batchPaymentDay ?? "—" })] }), _jsxs("div", { children: ["Cutoff Month: ", _jsx("b", { children: derived.cutoffMonth })] }), _jsxs("div", { children: ["Cutoff Day: ", _jsx("b", { children: derived.cutoffDay ?? "—" })] })] }), _jsxs("div", { style: subCardStyle, children: [_jsx("div", { style: labelStyle, children: "AP GL Accounts" }), _jsx("div", { style: { marginTop: 6 }, children: matchedApAccounts.length > 0 ? (matchedApAccounts.map((a) => (_jsxs("div", { style: { marginBottom: 6 }, children: [_jsx("b", { children: a.id }), " \u2014 ", a.accountNumber, " \u2014 ", a.accountName] }, a.id)))) : ("—") })] }), _jsxs("div", { style: subCardStyle, children: [_jsx("div", { style: labelStyle, children: "Discount GL" }), _jsxs("div", { style: { marginTop: 6 }, children: [_jsx("b", { children: derived.discountGlAccountId }), matchedDiscountAccount ? (_jsxs("span", { children: [" \u2014 ", matchedDiscountAccount.accountNumber, " \u2014 ", matchedDiscountAccount.accountName] })) : null] })] }), _jsxs("div", { style: subCardStyle, children: [_jsx("div", { style: labelStyle, children: "Cash Payment Journal" }), _jsx("div", { style: { marginTop: 6 }, children: matchedCashJournal ? (_jsxs(_Fragment, { children: [_jsx("b", { children: matchedCashJournal.id }), " \u2014 ", matchedCashJournal.journalNumber, " \u2014 ", matchedCashJournal.journalName] })) : ("—") })] }), _jsxs("div", { style: subCardStyle, children: [_jsx("div", { style: labelStyle, children: "Purchase Journal" }), _jsx("div", { style: { marginTop: 6 }, children: matchedPurchaseJournal ? (_jsxs(_Fragment, { children: [_jsx("b", { children: matchedPurchaseJournal.id }), " \u2014 ", matchedPurchaseJournal.journalNumber, " \u2014 ", matchedPurchaseJournal.journalName] })) : ("—") })] }), _jsxs("div", { style: subCardStyle, children: [_jsx("div", { style: labelStyle, children: "Bank Mapping" }), _jsxs("div", { style: { marginTop: 6 }, children: ["Bank GL: ", _jsx("b", { children: derived.bankGlAccountId || "—" }), matchedBankAccount ? (_jsxs("span", { children: [" \u2014 ", matchedBankAccount.accountNumber, " \u2014 ", matchedBankAccount.accountName] })) : null] }), _jsxs("div", { style: { marginTop: 4 }, children: ["First Check #: ", _jsx("b", { children: derived.firstCheckNumber })] }), _jsxs("div", { style: { marginTop: 4 }, children: ["Bank Unique Key: ", _jsx("b", { children: normalize(bankMatch?.bankUniqueKey) || "—" })] }), _jsxs("div", { style: { marginTop: 4 }, children: ["Branch Unique Key: ", _jsx("b", { children: normalize(bankMatch?.branchUniqueKey) || "—" })] })] }), _jsxs("div", { style: subCardStyle, children: [_jsx("div", { style: labelStyle, children: "1099 Setup Source" }), _jsx("div", { style: { marginTop: 6 }, children: dealerMasterData ? "Dealer Master Loaded" : "Fallback / Existing AP Setup" })] })] })] })] }), _jsxs("div", { style: panelStyle, children: [_jsx("div", { style: panelTitle, children: "Final Payload Preview" }), _jsx("pre", { style: preStyle, children: JSON.stringify(finalPayload, null, 2) })] })] }))] })) })] }) }));
};
const cardStyle = {
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    background: "rgba(255,255,255,0.03)",
    padding: 14,
};
const panelStyle = {
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 16,
    background: "rgba(255,255,255,0.03)",
    padding: 16,
};
const subCardStyle = {
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 12,
    padding: "10px 12px",
    background: "rgba(255,255,255,0.02)",
};
const panelTitle = {
    fontWeight: 800,
    marginBottom: 12,
};
const labelStyle = {
    fontSize: 11,
    opacity: 0.68,
};
const valueStyle = {
    fontWeight: 700,
    marginTop: 6,
    wordBreak: "break-word",
};
const preStyle = {
    margin: 0,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: 12,
    lineHeight: 1.5,
    color: "#d4d4d8",
};
