/* =========================================================
 * Blueprint Form Decoder — v2
 * =========================================================
 *
 * Changes from v1:
 *  1.  FileEntry / DecodedFile — removes all `any` types
 *  2.  CsvRow / RunDecoderResult — named interfaces
 *  3.  CHOICE_FIELD_TYPES / PASSTHROUGH_FIELD_TYPES sets
 *      → new field types just get added to the set, no switch edits
 *  4.  getOptionLabel — always returns string (was string | unknown)
 *  5.  decodeChoiceValue — cleaner resolveOne() helper
 *  6.  isMeaningfullyPopulated — explicit number (NaN-safe) + boolean
 *  7.  resolveConfiguredSubsectionName — `!== undefined` guard
 *      (falsy empty-string was treated as "not found")
 *  8.  decodeBlueprintForm — for…of + entries() → enables `continue`
 *  9.  formatPopulatedHumanReadable — returns string, no side-effects
 * 10.  printPopulatedHumanReadable — @deprecated wrapper kept for BC
 * 11.  runDecoder — no console.log; humanReadable added to result
 * ========================================================= */
/* ─── Known Field-Type Buckets ────────────────────────────────── */
const CHOICE_FIELD_TYPES = new Set([
    "DROPDOWN",
    "SINGLE_CHOICE",
    "MULTIPLE_CHOICE",
    "RADIO",
    "CHECKBOX",
]);
const PASSTHROUGH_FIELD_TYPES = new Set([
    "PARAGRAPH",
    "LOGO",
    "SIGNATURE",
    "TEXT",
    "SHORT_TEXT",
    "LONG_TEXT",
    "NUMBER",
    "EMAIL",
    "PHONE",
    "DATE",
    "TIME",
    "DATE_TIME",
    "URL",
    "CURRENCY",
    "ADDRESS",
    "RATING",
    "SLIDER",
]);
/* =========================================================
 * Helpers
 * ========================================================= */
function buildUserValueMap(userEnteredValues = []) {
    const sectionMap = new Map();
    for (const sectionEntry of userEnteredValues) {
        const fieldMap = new Map();
        for (const field of sectionEntry.fields ?? []) {
            fieldMap.set(field.id, field.value);
        }
        sectionMap.set(sectionEntry.id, fieldMap);
    }
    return sectionMap;
}
/* Always returns string — callers don't need to narrow */
function getOptionLabel(options, value) {
    if (!options)
        return value;
    return options.find((opt) => opt.value === value)?.label ?? value;
}
function decodeChoiceValue(field, raw, others) {
    const options = field.additionalInfo?.options;
    if (raw == null)
        return raw;
    const resolveOne = (item) => {
        if (item === "OTHERS_OPTION")
            return others ? `Others: ${others}` : "Others";
        return typeof item === "string" ? getOptionLabel(options, item) : String(item);
    };
    return Array.isArray(raw) ? raw.map(resolveOne) : resolveOne(raw);
}
function decodeFileUpload(raw) {
    if (!Array.isArray(raw))
        return raw;
    return raw.map((file) => ({
        mediaId: file?.mediaId ?? null,
        uploadStatus: file?.uploadStatus ?? null,
        filename: file?.normal?.filename ?? null,
        mimeType: file?.normal?.mimeType ?? null,
        mediaCategory: file?.normal?.mediaCategory ?? null,
        url: file?.normal?.url ?? null,
        mediaSize: file?.normal?.mediaSize ?? null,
        createdTime: file?.normal?.createdTime ?? null,
    }));
}
function decodeFieldValue(field, submittedValueObj) {
    if (submittedValueObj === undefined) {
        return { rawValue: undefined, decodedValue: undefined, hasUserValue: false };
    }
    const rawValue = submittedValueObj.value;
    const others = submittedValueObj.others;
    if (CHOICE_FIELD_TYPES.has(field.type)) {
        return {
            rawValue,
            decodedValue: decodeChoiceValue(field, rawValue, others),
            hasUserValue: true,
        };
    }
    if (field.type === "FILE_UPLOAD") {
        return { rawValue, decodedValue: decodeFileUpload(rawValue), hasUserValue: true };
    }
    if (PASSTHROUGH_FIELD_TYPES.has(field.type)) {
        return { rawValue, decodedValue: rawValue, hasUserValue: true };
    }
    // Unknown / future field types
    return {
        rawValue,
        decodedValue: others !== undefined ? { value: rawValue, others } : rawValue,
        hasUserValue: true,
    };
}
/**
 * FIX: original returned true for NaN (a number, but not meaningful).
 * FIX: explicit boolean branch — false is a valid answered value.
 */
function isMeaningfullyPopulated(value, hasUserValue) {
    if (!hasUserValue)
        return false;
    if (value === null || value === undefined)
        return false;
    if (typeof value === "boolean")
        return true;
    if (typeof value === "number")
        return !isNaN(value);
    if (typeof value === "string")
        return value.trim().length > 0;
    if (Array.isArray(value))
        return value.length > 0;
    if (typeof value === "object")
        return Object.keys(value).length > 0;
    return true;
}
/* =========================================================
 * Main Decoder
 * ========================================================= */
function decodeBlueprintForm(payload) {
    const sections = payload?.data?.formData?.sections ?? [];
    const userEnteredValues = payload?.data?.formData?.userEnteredValues ?? [];
    const userMap = buildUserValueMap(userEnteredValues);
    const decodedSections = [];
    for (const section of sections) {
        const sectionFieldMap = userMap.get(section.id) ?? new Map();
        const decodedFields = [];
        const rows = section.contents?.rows ?? [];
        const subsectionFilter = getSectionSubsectionFilter(section.sectionName);
        let activeSubsectionName = null;
        for (const [rowIndex, row] of rows.entries()) {
            for (const [columnIndex, column] of (row.columns ?? []).entries()) {
                for (const [fieldIndex, field] of (column.fields ?? []).entries()) {
                    const matchedSubsection = resolveConfiguredSubsectionName(subsectionFilter, field);
                    if (matchedSubsection)
                        activeSubsectionName = matchedSubsection;
                    if (subsectionFilter && activeSubsectionName) {
                        if (isExcludedSubsection(subsectionFilter, activeSubsectionName) ||
                            !isIncludedSubsection(subsectionFilter, activeSubsectionName))
                            continue;
                    }
                    const submitted = sectionFieldMap.get(field.fieldId);
                    const { rawValue, decodedValue, hasUserValue } = decodeFieldValue(field, submitted);
                    decodedFields.push({
                        sectionId: section.id,
                        sectionName: section.sectionName,
                        sectionOrder: section.order,
                        sectionType: section.type,
                        rowIndex,
                        columnIndex,
                        fieldIndex,
                        fieldId: field.fieldId,
                        fieldName: field.fieldName,
                        title: field.title,
                        type: field.type,
                        required: field.required,
                        logic: field.logic,
                        fieldOrder: field.order,
                        rawValue,
                        decodedValue,
                        hasUserValue,
                        subsectionName: activeSubsectionName,
                    });
                }
            }
        }
        decodedSections.push({
            sectionId: section.id,
            sectionName: section.sectionName,
            sectionOrder: section.order,
            sectionType: section.type,
            logic: section.logic,
            fields: decodedFields,
        });
    }
    return decodedSections;
}
const SECTION_SUBSECTION_FILTERS = {
    "Used Vehicle GL Sale Account Mapping": {
        include: [
            "Used Vehicle Personal Purchase",
            "Used Vehicle Business / Commercial",
            "Used Vehicle Wholesale",
        ],
        exclude: ["Used Vehicle F&I Only - After Sale"],
    },
};
function normalizeComparableText(value) {
    return (value ?? "")
        .replace(/[–—]/g, "-")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}
function buildNormalizedNameMap(values = []) {
    const map = new Map();
    for (const value of values) {
        const normalized = normalizeComparableText(value);
        if (normalized)
            map.set(normalized, value.trim());
    }
    return map;
}
const NORMALIZED_SECTION_SUBSECTION_FILTERS = new Map(Object.entries(SECTION_SUBSECTION_FILTERS).map(([name, config]) => [
    normalizeComparableText(name),
    {
        includedByNormalizedName: buildNormalizedNameMap(config.include),
        excludedByNormalizedName: buildNormalizedNameMap(config.exclude),
    },
]));
function getSectionSubsectionFilter(sectionName) {
    return NORMALIZED_SECTION_SUBSECTION_FILTERS.get(normalizeComparableText(sectionName)) ?? null;
}
function getFieldTextCandidates(field) {
    return [
        field.title,
        field.fieldName,
        typeof field.additionalInfo?.supportText === "string"
            ? field.additionalInfo.supportText
            : undefined,
    ].filter((c) => typeof c === "string" && c.trim().length > 0);
}
function resolveConfiguredSubsectionName(filter, field) {
    if (!filter)
        return null;
    for (const candidate of getFieldTextCandidates(field)) {
        const normalized = normalizeComparableText(candidate);
        /* FIX: use !== undefined so empty-string keys are not skipped */
        const includedMatch = filter.includedByNormalizedName.get(normalized);
        if (includedMatch !== undefined)
            return includedMatch;
        const excludedMatch = filter.excludedByNormalizedName.get(normalized);
        if (excludedMatch !== undefined)
            return excludedMatch;
    }
    return null;
}
function isIncludedSubsection(filter, subsectionName) {
    if (!filter || !subsectionName)
        return true;
    if (filter.includedByNormalizedName.size === 0)
        return true;
    return filter.includedByNormalizedName.has(normalizeComparableText(subsectionName));
}
function isExcludedSubsection(filter, subsectionName) {
    if (!filter || !subsectionName)
        return false;
    return filter.excludedByNormalizedName.has(normalizeComparableText(subsectionName));
}
/* =========================================================
 * Utility Views
 * ========================================================= */
function flattenDecodedSections(decodedSections) {
    return decodedSections.flatMap((section) => section.fields.map((field) => ({
        sectionName: field.sectionName,
        subsectionName: field.subsectionName ?? null,
        sectionId: field.sectionId,
        fieldId: field.fieldId,
        title: field.title,
        type: field.type,
        required: field.required,
        rawValue: field.rawValue,
        decodedValue: field.decodedValue,
        hasUserValue: field.hasUserValue,
    })));
}
function getPopulatedDecodedSections(decodedSections) {
    return decodedSections
        .map((section) => ({
        ...section,
        fields: section.fields.filter((f) => isMeaningfullyPopulated(f.decodedValue, f.hasUserValue)),
    }))
        .filter((section) => section.fields.length > 0);
}
function getPopulatedFlatRows(decodedSections) {
    return flattenDecodedSections(decodedSections).filter((row) => isMeaningfullyPopulated(row.decodedValue, row.hasUserValue));
}
function toCsvReadyRows(decodedSections) {
    return getPopulatedFlatRows(decodedSections).map((row) => ({
        sectionName: row.sectionName ?? "",
        sectionId: row.sectionId,
        fieldId: row.fieldId,
        title: row.title ?? "",
        type: row.type,
        required: row.required ? "true" : "false",
        decodedValue: typeof row.decodedValue === "string"
            ? row.decodedValue
            : JSON.stringify(row.decodedValue),
    }));
}
/** Returns human-readable string — no console side-effects */
function formatPopulatedHumanReadable(decodedSections) {
    const lines = [];
    for (const section of getPopulatedDecodedSections(decodedSections)) {
        lines.push(`\n${"=".repeat(50)}`);
        lines.push(`Section: ${section.sectionName ?? "(No Section Name)"}`);
        lines.push("=".repeat(50));
        for (const field of section.fields) {
            if (field.subsectionName)
                lines.push(`  Subsection : ${field.subsectionName}`);
            lines.push(`  Title      : ${field.title ?? "(No Title)"}`);
            lines.push(`  Type       : ${field.type}`);
            lines.push(`  Raw Value  : ${JSON.stringify(field.rawValue, null, 2)}`);
            lines.push(`  Decoded    : ${JSON.stringify(field.decodedValue, null, 2)}`);
            lines.push("");
        }
    }
    return lines.join("\n");
}
/** @deprecated — use formatPopulatedHumanReadable (returns string, no side effects) */
function printPopulatedHumanReadable(decodedSections) {
    console.log(formatPopulatedHumanReadable(decodedSections));
}
function runDecoder(payload) {
    const decodedSections = decodeBlueprintForm(payload);
    const allFields = flattenDecodedSections(decodedSections);
    const populatedSections = getPopulatedDecodedSections(decodedSections);
    const populatedFlatRows = getPopulatedFlatRows(decodedSections);
    const csvReadyRows = toCsvReadyRows(decodedSections);
    const humanReadable = formatPopulatedHumanReadable(decodedSections);
    return {
        decodedSections,
        allFields,
        populatedSections,
        populatedFlatRows,
        csvReadyRows,
        humanReadable,
    };
}
export { decodeBlueprintForm, flattenDecodedSections, getPopulatedDecodedSections, getPopulatedFlatRows, toCsvReadyRows, formatPopulatedHumanReadable, printPopulatedHumanReadable, runDecoder, };
