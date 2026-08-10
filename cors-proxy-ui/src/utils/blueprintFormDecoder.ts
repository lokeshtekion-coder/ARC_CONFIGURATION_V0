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

/* ─── Schema ──────────────────────────────────────────────────── */

interface Rule {
  fieldId:  string;
  operator: string;
  value:    string;
}

interface Logic {
  displayActionType?:  string;
  ruleMatchCondition?: string;
  rules?:              Rule[];
}

interface OptionItem {
  label: string;
  value: string;
}

interface FileEntry {
  mediaId?:      string | null;
  uploadStatus?: string | null;
  normal?: {
    filename?:      string | null;
    mimeType?:      string | null;
    mediaCategory?: string | null;
    url?:           string | null;
    mediaSize?:     number | null;
    createdTime?:   string | number | null;
  };
}

interface AdditionalInfo {
  options?:          OptionItem[];
  paragraphContent?: unknown[];
  supportText?:      string;
  placeholder?:      string;
  minimumValue?:     number;
  maximumValue?:     number;
  fileTypes?:        string[];
  [key: string]:     unknown;
}

interface FieldSchema {
  fieldId:        string;
  fieldName:      string | null;
  order:          number;
  required:       boolean;
  type:           string;
  logic:          Logic | null;
  title:          string | null;
  additionalInfo: AdditionalInfo;
  libraryId:      string | null;
}

interface ColumnSchema  { fields:  FieldSchema[]; }
interface RowSchema     { columns: ColumnSchema[]; }

interface SectionSchema {
  id:          string;
  order:       number;
  sectionName: string | null;
  type:        string;
  logic:       Logic | null;
  contents: { rows: RowSchema[] };
}

interface UserEnteredFieldValue {
  id:     string;
  value?: { value?: unknown; others?: string };
}

interface UserEnteredSection {
  id:     string;
  fields: UserEnteredFieldValue[];
}

interface FormData {
  sections:           SectionSchema[];
  userEnteredValues?: UserEnteredSection[];
}

interface InputPayload {
  data?:   { formData?: FormData };
  status?: string;
}

/* ─── Decoded File ────────────────────────────────────────────── */

interface DecodedFile {
  mediaId:       string | null;
  uploadStatus:  string | null;
  filename:      string | null;
  mimeType:      string | null;
  mediaCategory: string | null;
  url:           string | null;
  mediaSize:     number | null;
  createdTime:   string | number | null;
}

/* ─── Decoded Output ──────────────────────────────────────────── */

interface DecodedField {
  sectionId:       string;
  sectionName:     string | null;
  sectionOrder:    number;
  sectionType:     string;
  rowIndex:        number;
  columnIndex:     number;
  fieldIndex:      number;
  fieldId:         string;
  fieldName:       string | null;
  title:           string | null;
  type:            string;
  required:        boolean;
  logic:           Logic | null;
  fieldOrder:      number;
  rawValue:        unknown;
  decodedValue:    unknown;
  hasUserValue:    boolean;
  subsectionName?: string | null;
}

interface DecodedSection {
  sectionId:    string;
  sectionName:  string | null;
  sectionOrder: number;
  sectionType:  string;
  logic:        Logic | null;
  fields:       DecodedField[];
}

interface FlattenedDecodedRow {
  sectionName?:    string | null;
  subsectionName?: string | null;
  sectionId:       string;
  fieldId:         string;
  title:           string | null;
  type:            string;
  required:        boolean;
  rawValue:        unknown;
  decodedValue:    unknown;
  hasUserValue:    boolean;
}

interface CsvRow {
  sectionName:  string;
  sectionId:    string;
  fieldId:      string;
  title:        string;
  type:         string;
  required:     string;
  decodedValue: string;
}

interface RunDecoderResult {
  decodedSections:   DecodedSection[];
  allFields:         FlattenedDecodedRow[];
  populatedSections: DecodedSection[];
  populatedFlatRows: FlattenedDecodedRow[];
  csvReadyRows:      CsvRow[];
  humanReadable:     string;
}

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

function buildUserValueMap(
  userEnteredValues: UserEnteredSection[] = [],
): Map<string, Map<string, UserEnteredFieldValue["value"]>> {
  const sectionMap = new Map<string, Map<string, UserEnteredFieldValue["value"]>>();

  for (const sectionEntry of userEnteredValues) {
    const fieldMap = new Map<string, UserEnteredFieldValue["value"]>();
    for (const field of sectionEntry.fields ?? []) {
      fieldMap.set(field.id, field.value);
    }
    sectionMap.set(sectionEntry.id, fieldMap);
  }

  return sectionMap;
}

/* Always returns string — callers don't need to narrow */
function getOptionLabel(options: OptionItem[] | undefined, value: string): string {
  if (!options) return value;
  return options.find((opt) => opt.value === value)?.label ?? value;
}

function decodeChoiceValue(
  field: FieldSchema,
  raw: unknown,
  others?: string,
): string | string[] | unknown {
  const options = field.additionalInfo?.options;

  if (raw == null) return raw;

  const resolveOne = (item: unknown): string => {
    if (item === "OTHERS_OPTION") return others ? `Others: ${others}` : "Others";
    return typeof item === "string" ? getOptionLabel(options, item) : String(item);
  };

  return Array.isArray(raw) ? raw.map(resolveOne) : resolveOne(raw);
}

function decodeFileUpload(raw: unknown): DecodedFile[] | unknown {
  if (!Array.isArray(raw)) return raw;

  return raw.map((file: FileEntry): DecodedFile => ({
    mediaId:       file?.mediaId              ?? null,
    uploadStatus:  file?.uploadStatus         ?? null,
    filename:      file?.normal?.filename     ?? null,
    mimeType:      file?.normal?.mimeType     ?? null,
    mediaCategory: file?.normal?.mediaCategory ?? null,
    url:           file?.normal?.url           ?? null,
    mediaSize:     file?.normal?.mediaSize     ?? null,
    createdTime:   file?.normal?.createdTime   ?? null,
  }));
}

function decodeFieldValue(
  field: FieldSchema,
  submittedValueObj?: UserEnteredFieldValue["value"],
): { rawValue: unknown; decodedValue: unknown; hasUserValue: boolean } {
  if (submittedValueObj === undefined) {
    return { rawValue: undefined, decodedValue: undefined, hasUserValue: false };
  }

  const rawValue = submittedValueObj.value;
  const others   = submittedValueObj.others;

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
function isMeaningfullyPopulated(value: unknown, hasUserValue: boolean): boolean {
  if (!hasUserValue)                        return false;
  if (value === null || value === undefined) return false;
  if (typeof value === "boolean")            return true;
  if (typeof value === "number")             return !isNaN(value);
  if (typeof value === "string")             return value.trim().length > 0;
  if (Array.isArray(value))                  return value.length > 0;
  if (typeof value === "object")
    return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

/* =========================================================
 * Main Decoder
 * ========================================================= */

function decodeBlueprintForm(payload: InputPayload): DecodedSection[] {
  const sections          = payload?.data?.formData?.sections          ?? [];
  const userEnteredValues = payload?.data?.formData?.userEnteredValues ?? [];
  const userMap           = buildUserValueMap(userEnteredValues);
  const decodedSections: DecodedSection[] = [];

  for (const section of sections) {
    const sectionFieldMap =
      userMap.get(section.id) ?? new Map<string, UserEnteredFieldValue["value"]>();

    const decodedFields: DecodedField[]           = [];
    const rows                                     = section.contents?.rows ?? [];
    const subsectionFilter                         = getSectionSubsectionFilter(section.sectionName);
    let   activeSubsectionName: string | null      = null;

    for (const [rowIndex, row] of rows.entries()) {
      for (const [columnIndex, column] of (row.columns ?? []).entries()) {
        for (const [fieldIndex, field] of (column.fields ?? []).entries()) {

          const matchedSubsection = resolveConfiguredSubsectionName(subsectionFilter, field);
          if (matchedSubsection) activeSubsectionName = matchedSubsection;

          if (subsectionFilter && activeSubsectionName) {
            if (
              isExcludedSubsection(subsectionFilter, activeSubsectionName) ||
              !isIncludedSubsection(subsectionFilter, activeSubsectionName)
            ) continue;
          }

          const submitted = sectionFieldMap.get(field.fieldId);
          const { rawValue, decodedValue, hasUserValue } = decodeFieldValue(field, submitted);

          decodedFields.push({
            sectionId:      section.id,
            sectionName:    section.sectionName,
            sectionOrder:   section.order,
            sectionType:    section.type,
            rowIndex,
            columnIndex,
            fieldIndex,
            fieldId:        field.fieldId,
            fieldName:      field.fieldName,
            title:          field.title,
            type:           field.type,
            required:       field.required,
            logic:          field.logic,
            fieldOrder:     field.order,
            rawValue,
            decodedValue,
            hasUserValue,
            subsectionName: activeSubsectionName,
          });
        }
      }
    }

    decodedSections.push({
      sectionId:    section.id,
      sectionName:  section.sectionName,
      sectionOrder: section.order,
      sectionType:  section.type,
      logic:        section.logic,
      fields:       decodedFields,
    });
  }

  return decodedSections;
}

/* =========================================================
 * Section / Subsection Filters
 * ========================================================= */

interface SectionSubsectionFilterConfig {
  include?: string[];
  exclude?: string[];
}

interface NormalizedSectionSubsectionFilter {
  includedByNormalizedName: Map<string, string>;
  excludedByNormalizedName: Map<string, string>;
}

const SECTION_SUBSECTION_FILTERS: Record<string, SectionSubsectionFilterConfig> = {
  "Used Vehicle GL Sale Account Mapping": {
    include: [
      "Used Vehicle Personal Purchase",
      "Used Vehicle Business / Commercial",
      "Used Vehicle Wholesale",
    ],
    exclude: ["Used Vehicle F&I Only - After Sale"],
  },
};

function normalizeComparableText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[–—]/g, "-")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function buildNormalizedNameMap(values: string[] = []): Map<string, string> {
  const map = new Map<string, string>();
  for (const value of values) {
    const normalized = normalizeComparableText(value);
    if (normalized) map.set(normalized, value.trim());
  }
  return map;
}

const NORMALIZED_SECTION_SUBSECTION_FILTERS = new Map<
  string,
  NormalizedSectionSubsectionFilter
>(
  Object.entries(SECTION_SUBSECTION_FILTERS).map(([name, config]) => [
    normalizeComparableText(name),
    {
      includedByNormalizedName: buildNormalizedNameMap(config.include),
      excludedByNormalizedName: buildNormalizedNameMap(config.exclude),
    },
  ]),
);

function getSectionSubsectionFilter(
  sectionName: string | null,
): NormalizedSectionSubsectionFilter | null {
  return NORMALIZED_SECTION_SUBSECTION_FILTERS.get(
    normalizeComparableText(sectionName),
  ) ?? null;
}

function getFieldTextCandidates(field: FieldSchema): string[] {
  return [
    field.title,
    field.fieldName,
    typeof field.additionalInfo?.supportText === "string"
      ? field.additionalInfo.supportText
      : undefined,
  ].filter((c): c is string => typeof c === "string" && c.trim().length > 0);
}

function resolveConfiguredSubsectionName(
  filter: NormalizedSectionSubsectionFilter | null,
  field: FieldSchema,
): string | null {
  if (!filter) return null;

  for (const candidate of getFieldTextCandidates(field)) {
    const normalized = normalizeComparableText(candidate);

    /* FIX: use !== undefined so empty-string keys are not skipped */
    const includedMatch = filter.includedByNormalizedName.get(normalized);
    if (includedMatch !== undefined) return includedMatch;

    const excludedMatch = filter.excludedByNormalizedName.get(normalized);
    if (excludedMatch !== undefined) return excludedMatch;
  }

  return null;
}

function isIncludedSubsection(
  filter: NormalizedSectionSubsectionFilter | null,
  subsectionName: string | null,
): boolean {
  if (!filter || !subsectionName) return true;
  if (filter.includedByNormalizedName.size === 0) return true;
  return filter.includedByNormalizedName.has(normalizeComparableText(subsectionName));
}

function isExcludedSubsection(
  filter: NormalizedSectionSubsectionFilter | null,
  subsectionName: string | null,
): boolean {
  if (!filter || !subsectionName) return false;
  return filter.excludedByNormalizedName.has(normalizeComparableText(subsectionName));
}

/* =========================================================
 * Utility Views
 * ========================================================= */

function flattenDecodedSections(
  decodedSections: DecodedSection[],
): FlattenedDecodedRow[] {
  return decodedSections.flatMap((section) =>
    section.fields.map((field) => ({
      sectionName:    field.sectionName,
      subsectionName: field.subsectionName ?? null,
      sectionId:      field.sectionId,
      fieldId:        field.fieldId,
      title:          field.title,
      type:           field.type,
      required:       field.required,
      rawValue:       field.rawValue,
      decodedValue:   field.decodedValue,
      hasUserValue:   field.hasUserValue,
    })),
  );
}

function getPopulatedDecodedSections(
  decodedSections: DecodedSection[],
): DecodedSection[] {
  return decodedSections
    .map((section) => ({
      ...section,
      fields: section.fields.filter((f) =>
        isMeaningfullyPopulated(f.decodedValue, f.hasUserValue),
      ),
    }))
    .filter((section) => section.fields.length > 0);
}

function getPopulatedFlatRows(
  decodedSections: DecodedSection[],
): FlattenedDecodedRow[] {
  return flattenDecodedSections(decodedSections).filter((row) =>
    isMeaningfullyPopulated(row.decodedValue, row.hasUserValue),
  );
}

function toCsvReadyRows(decodedSections: DecodedSection[]): CsvRow[] {
  return getPopulatedFlatRows(decodedSections).map((row) => ({
    sectionName:  row.sectionName  ?? "",
    sectionId:    row.sectionId,
    fieldId:      row.fieldId,
    title:        row.title        ?? "",
    type:         row.type,
    required:     row.required ? "true" : "false",
    decodedValue:
      typeof row.decodedValue === "string"
        ? row.decodedValue
        : JSON.stringify(row.decodedValue),
  }));
}

/** Returns human-readable string — no console side-effects */
function formatPopulatedHumanReadable(decodedSections: DecodedSection[]): string {
  const lines: string[] = [];

  for (const section of getPopulatedDecodedSections(decodedSections)) {
    lines.push(`\n${"=".repeat(50)}`);
    lines.push(`Section: ${section.sectionName ?? "(No Section Name)"}`);
    lines.push("=".repeat(50));

    for (const field of section.fields) {
      if (field.subsectionName) lines.push(`  Subsection : ${field.subsectionName}`);
      lines.push(`  Title      : ${field.title ?? "(No Title)"}`);
      lines.push(`  Type       : ${field.type}`);
      lines.push(`  Raw Value  : ${JSON.stringify(field.rawValue,    null, 2)}`);
      lines.push(`  Decoded    : ${JSON.stringify(field.decodedValue, null, 2)}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

/** @deprecated — use formatPopulatedHumanReadable (returns string, no side effects) */
function printPopulatedHumanReadable(decodedSections: DecodedSection[]): void {
  console.log(formatPopulatedHumanReadable(decodedSections));
}

function runDecoder(payload: InputPayload): RunDecoderResult {
  const decodedSections   = decodeBlueprintForm(payload);
  const allFields         = flattenDecodedSections(decodedSections);
  const populatedSections = getPopulatedDecodedSections(decodedSections);
  const populatedFlatRows = getPopulatedFlatRows(decodedSections);
  const csvReadyRows      = toCsvReadyRows(decodedSections);
  const humanReadable     = formatPopulatedHumanReadable(decodedSections);

  return {
    decodedSections,
    allFields,
    populatedSections,
    populatedFlatRows,
    csvReadyRows,
    humanReadable,
  };
}

export {
  decodeBlueprintForm,
  flattenDecodedSections,
  getPopulatedDecodedSections,
  getPopulatedFlatRows,
  toCsvReadyRows,
  formatPopulatedHumanReadable,
  printPopulatedHumanReadable,
  runDecoder,
};

export type {
  InputPayload,
  DecodedField,
  DecodedSection,
  FlattenedDecodedRow,
  CsvRow,
  RunDecoderResult,
};
