// Blueprint Decode Bot - reuses the exact same fetch/decode/filter pipeline
// as the manual "Auto Fetch" flow in BlueprintDecoder.tsx (same underlying
// utils, same excluded-title filtering), just without the page's React
// state. Callable from anywhere - currently used to auto-decode Parts /
// Service / Accounting blueprints the moment a dealer profile is selected
// in Settings, so you don't have to separately open the Blueprint Decoder
// and re-pick the same dealer.
import { runDecoder } from "../utils/blueprintFormDecoder";
import { idbSaveBlueprint } from "../utils/blueprintDb";
import { fetchBlueprintFormResponses, filterBlueprintTargetForms, fetchBlueprintFormDetail, } from "./blueprintFormsApi";
import { detectModuleFromFormName, filterDecodedResultByExcludedTitles, } from "../pages/BlueprintDecoder";
export const ALL_BLUEPRINT_MODULES = ["parts", "service", "accounting"];
const MAX_MISSING_TITLES = 5;
// Fetches + decodes blueprint forms for one dealer across the given
// modules. Does not persist anything - see persistBlueprintDecodeResult for
// that, kept separate so callers can inspect results before deciding to save.
export async function decodeBlueprintsForDealer(tekionId, modules = ALL_BLUEPRINT_MODULES, fallbackDealerName = "") {
    const trimmedId = tekionId.trim();
    if (!trimmedId)
        return [];
    const forms = await fetchBlueprintFormResponses(trimmedId);
    const filtered = filterBlueprintTargetForms(forms, modules);
    if (filtered.length === 0)
        return [];
    const pickedByModule = new Map();
    for (const form of filtered) {
        const module = detectModuleFromFormName(form.formName);
        if (!module || !modules.includes(module))
            continue;
        if (!pickedByModule.has(module))
            pickedByModule.set(module, form);
    }
    const results = [];
    for (const module of modules) {
        const form = pickedByModule.get(module);
        if (!form)
            continue;
        const detail = (await fetchBlueprintFormDetail(form.formId, form.releaseId));
        const decoded = filterDecodedResultByExcludedTitles(runDecoder(detail), module);
        const rawDetail = detail;
        const dealerName = String(rawDetail?.data?.formData?.releasedDealerName || form.dealerName || fallbackDealerName || "").trim();
        const formName = String(rawDetail?.data?.formName ?? form.formName ?? "").trim();
        const saveKey = `${trimmedId}-${formName}`.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_\-]/g, "");
        const totalCount = decoded.allFields.length;
        const missingFields = decoded.allFields.filter((f) => !f.hasUserValue);
        const missingRequiredFields = missingFields.filter((f) => f.required);
        const missingRequiredTitles = missingRequiredFields
            .slice(0, MAX_MISSING_TITLES)
            .map((f) => f.title || f.fieldId);
        results.push({
            module,
            form,
            decoded,
            dealerName,
            formName,
            saveKey,
            totalCount,
            missingCount: missingFields.length,
            missingRequiredCount: missingRequiredFields.length,
            missingRequiredTitles,
        });
    }
    return results;
}
// Mirrors exactly what BlueprintDecoder.tsx's "Save All" button does:
// IndexedDB cache + POST to the existing /api/validation/blueprint-save
// endpoint, keyed the same way, so the Blueprint Decoder page picks these
// up as "already saved" if you open it afterwards for the same dealer.
export async function persistBlueprintDecodeResult(tekionId, dealerId, item) {
    const record = {
        key: item.saveKey,
        tekionId,
        dealerId,
        dealerName: item.dealerName,
        formName: item.formName,
        formId: item.form.formId,
        releaseId: item.form.releaseId,
        status: item.form.status,
        rawResponse: undefined,
        decodedResponse: item.decoded,
        savedAt: new Date().toISOString(),
    };
    await idbSaveBlueprint(record);
    const res = await fetch("http://localhost:4000/api/validation/blueprint-save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: item.saveKey, data: record }),
    });
    if (!res.ok)
        throw new Error(`Server: HTTP ${res.status}`);
}
