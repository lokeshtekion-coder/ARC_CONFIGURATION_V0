import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { loadTekionApiSettingsBundle } from "../../../services/tekionApiSettings";
const MODULE_NAME = "Parts Price Code";
const SEARCH_URL = "https://preprodapp.tekioncloud.com/api/parts/proxy/u/settings/price-code";
const CREATE_URL = "https://preprodapp.tekioncloud.com/api/parts/proxy/u/settings/price-code";
const SOURCE_CODE_URL = "https://preprodapp.tekioncloud.com/api/parts/proxy/u/settings/source-code";
const LOOKUP_SEARCH_URL = "https://preprodapp.tekioncloud.com/api/lookup/search";
const VARIABLE_TYPES = ["cost", "list", "trade", "warranty", "matrix"];
const OPERATORS = ["add", "subtract"];
const logger = {
    debug: (...args) => console.debug("[Parts][PriceCode]", ...args),
    info: (...args) => console.info("[Parts][PriceCode]", ...args),
    warn: (...args) => console.warn("[Parts][PriceCode]", ...args),
    error: (...args) => console.error("[Parts][PriceCode]", ...args),
};
function normalizeText(value) {
    return String(value ?? "").trim();
}
function normalizeUpper(value) {
    return normalizeText(value).toUpperCase();
}
function getEnabledGlobalHeaders() {
    const bundle = loadTekionApiSettingsBundle();
    const headers = (bundle.globalHeaders ?? [])
        .filter((header) => header.enabled &&
        header.key.trim() &&
        String(header.value).trim())
        .reduce((acc, header) => {
        acc[header.key] = String(header.value);
        return acc;
    }, {});
    logger.info("loaded global headers from settings", {
        count: Object.keys(headers).length,
        keys: Object.keys(headers),
    });
    return headers;
}
function findHeaderValueCaseInsensitive(headers, candidates) {
    const entries = Object.entries(headers);
    for (const candidate of candidates) {
        const found = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
        if (found?.[1])
            return normalizeText(found[1]);
    }
    return "";
}
function extractDealerIdFromHeaders(headers) {
    return findHeaderValueCaseInsensitive(headers, [
        "dealerid",
        "dealerId",
        "dealer-id",
        "x-dealer-id",
    ]);
}
function isVariableType(value) {
    return VARIABLE_TYPES.includes(value);
}
function isOperatorType(value) {
    return OPERATORS.includes(value);
}
function enhancedParseDescription(description) {
    const cleaned = description.trim().toUpperCase();
    const warnings = [];
    let type = "list";
    let confidence = "low";
    const typeMatch = cleaned.match(/^(LIST|COST|PRICE|TRADE|WARRANTY|MATRIX)/i);
    if (typeMatch) {
        type = typeMatch[1].toLowerCase();
        if (type === "price")
            type = "cost";
        confidence = "high";
    }
    else if (cleaned.includes("PRICE")) {
        type = "cost";
        confidence = "high";
    }
    else {
        warnings.push('Type not detected, defaulted to "list"');
    }
    let operator = "add";
    let value = 0;
    let operatorParsed = false;
    const percentMatch = cleaned.match(/([+\-*/×÷])?\s*(\d+\.?\d*)\s*%/);
    if (percentMatch) {
        const sign = percentMatch[1];
        value = parseFloat(percentMatch[2]);
        if (Number.isNaN(value)) {
            warnings.push("Could not parse numeric value");
            value = 0;
            confidence = "low";
        }
        else {
            operatorParsed = true;
            if (confidence !== "low")
                confidence = "high";
        }
        if (sign === "-")
            operator = "subtract";
        else if (sign === "*" || sign === "×") {
            operator = "add";
            warnings.push('Multiply operator not supported by backend, converting to "add"');
        }
        else if (sign === "/" || sign === "÷") {
            operator = "add";
            warnings.push('Divide operator not supported by backend, converting to "add"');
        }
        else
            operator = "add";
    }
    else if (cleaned.includes("$")) {
        const dollarMatch = cleaned.match(/([+-])\s*\$?\s*(\d+\.?\d*)/);
        if (dollarMatch) {
            operator = dollarMatch[1] === "-" ? "subtract" : "add";
            value = parseFloat(dollarMatch[2]);
            if (Number.isNaN(value)) {
                warnings.push("Could not parse numeric value");
                value = 0;
                confidence = "low";
            }
            else {
                operatorParsed = true;
                if (confidence !== "low")
                    confidence = "high";
            }
        }
    }
    else if (cleaned.includes("MULTIPLY") || cleaned.includes("TIMES")) {
        const multiplyMatch = cleaned.match(/(\d+\.?\d*)/);
        if (multiplyMatch) {
            value = parseFloat(multiplyMatch[1]);
            if (Number.isNaN(value)) {
                warnings.push("Could not parse numeric value");
                value = 0;
                confidence = "low";
            }
            else {
                operatorParsed = true;
                operator = "add";
                warnings.push('Multiply operator not supported by backend, converting to "add"');
                if (confidence !== "low")
                    confidence = "medium";
            }
        }
    }
    else if (cleaned.includes("DIVIDE")) {
        const divideMatch = cleaned.match(/(\d+\.?\d*)/);
        if (divideMatch) {
            value = parseFloat(divideMatch[1]);
            if (Number.isNaN(value)) {
                warnings.push("Could not parse numeric value");
                value = 0;
                confidence = "low";
            }
            else {
                operatorParsed = true;
                operator = "add";
                warnings.push('Divide operator not supported by backend, converting to "add"');
                if (confidence !== "low")
                    confidence = "medium";
            }
        }
    }
    else {
        const standardMatch = cleaned.match(/([+-])\s*(\d+\.?\d*)/);
        if (standardMatch) {
            operator = standardMatch[1] === "-" ? "subtract" : "add";
            value = parseFloat(standardMatch[2]);
            if (Number.isNaN(value)) {
                warnings.push("Could not parse numeric value");
                value = 0;
                confidence = "low";
            }
            else {
                operatorParsed = true;
                if (confidence !== "low")
                    confidence = "high";
            }
        }
    }
    if (!operatorParsed) {
        warnings.push('No operator/value detected, defaulted to "add 0"');
        confidence = "low";
    }
    const success = warnings.length === 0 && value > 0;
    return {
        type,
        operator,
        value,
        success,
        confidence,
        warnings,
    };
}
function parseCSVRow(row) {
    const columns = [];
    let currentCol = "";
    let inQuotes = false;
    for (let i = 0; i < row.length; i += 1) {
        const char = row[i];
        const nextChar = row[i + 1];
        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                currentCol += '"';
                i += 1;
            }
            else {
                inQuotes = !inQuotes;
            }
        }
        else if (char === "," && !inQuotes) {
            columns.push(currentCol.trim());
            currentCol = "";
        }
        else {
            currentCol += char;
        }
    }
    columns.push(currentCol.trim());
    return columns;
}
function processImportedRows(dataRows, reportProgress) {
    const parsed = [];
    const errors = [];
    const total = dataRows.length;
    for (let index = 0; index < total; index += 1) {
        if (reportProgress && index % 100 === 0) {
            reportProgress(Math.round(((index + 1) / total) * 100), `Parsing row ${index + 1}/${total}...`);
        }
        const cols = dataRows[index];
        if (!cols)
            continue;
        const rowStr = cols.map((c) => String(c ?? "")).join(",");
        if (cols.length === 0 || (cols.length === 1 && !String(cols[0] ?? "").trim()))
            continue;
        if (index === 0) {
            const col0 = normalizeText(cols[0]).toLowerCase();
            const col1 = normalizeText(cols[1]).toLowerCase();
            if (col0 === "code" || col0 === "source code" || col1 === "code") {
                continue;
            }
        }
        let sourceCode = "Default";
        let code = "";
        let description = "";
        let rawValue = "";
        let variableType = "";
        let operator = "";
        if (cols.length >= 3) {
            const maybeFirst = normalizeText(cols[0]);
            const maybeSecond = normalizeText(cols[1]);
            const maybeThird = normalizeText(cols[2]);
            const thirdLooksLikeDescription = Boolean(maybeThird) &&
                !/^-?\d+(\.\d+)?$/.test(maybeThird) &&
                !VARIABLE_TYPES.includes(maybeThird.toLowerCase()) &&
                !OPERATORS.includes(maybeThird.toLowerCase());
            if (thirdLooksLikeDescription) {
                sourceCode = maybeFirst || "Default";
                code = maybeSecond;
                description = maybeThird;
                rawValue = cols.length > 3 ? normalizeText(cols[3]) : "";
                variableType = cols.length > 4 ? normalizeText(cols[4]).toLowerCase() : "";
                operator = cols.length > 5 ? normalizeText(cols[5]).toLowerCase() : "";
            }
            else {
                sourceCode = "Default";
                code = maybeFirst;
                description = maybeSecond;
                rawValue = cols.length > 2 ? normalizeText(cols[2]) : "";
                variableType = cols.length > 3 ? normalizeText(cols[3]).toLowerCase() : "";
                operator = cols.length > 4 ? normalizeText(cols[4]).toLowerCase() : "";
            }
        }
        if (!code) {
            errors.push({
                line: index + 1,
                error: "Code is empty",
                data: rowStr.substring(0, 160),
            });
            continue;
        }
        if (!description) {
            errors.push({
                line: index + 1,
                error: "Description is empty",
                data: rowStr.substring(0, 160),
            });
            continue;
        }
        let value = rawValue ? Number(rawValue) : 0;
        const needsSmartParse = !rawValue || !variableType || !operator || Number.isNaN(value) || value === 0;
        let parseWarnings;
        let parseConfidence;
        if (needsSmartParse) {
            const autoParsed = enhancedParseDescription(description);
            if (!rawValue || Number.isNaN(value) || value === 0)
                value = autoParsed.value;
            if (!variableType)
                variableType = autoParsed.type || "list";
            if (!operator)
                operator = autoParsed.operator || "add";
            parseWarnings = autoParsed.warnings;
            parseConfidence = autoParsed.confidence;
        }
        if (!Number.isFinite(value) || Number.isNaN(value)) {
            errors.push({
                line: index + 1,
                error: `Invalid numeric value resolved: "${rawValue || value}"`,
                data: rowStr.substring(0, 160),
            });
            continue;
        }
        parsed.push({
            sourceCode: sourceCode || "Default",
            code,
            description,
            value,
            variableType,
            operator,
            parseWarnings,
            parseConfidence,
        });
    }
    return { parsed, errors };
}
function buildPayloadForRow(row, priceCodeId) {
    return {
        code: row.code,
        description: row.description,
        minimumROSalesGrossProfit: null,
        minimumSalesOrderGrossProfit: null,
        defaultRounding: 0,
        ...(priceCodeId ? { priceCodeId } : {}),
        formulas: [
            {
                sourceCodeId: row.sourceCodeResolution.resolvedSourceCodeId,
                expression: {
                    operator: row.operator,
                    valueType: "percentage",
                    value: row.value,
                    variableType: row.variableType,
                    variable: "",
                },
                rounding: null,
                type: "source",
            },
        ],
    };
}
async function fetchPriceCodes(headers) {
    logger.info("GET price codes started", {
        url: SEARCH_URL,
        headerKeys: Object.keys(headers),
    });
    const response = await fetch(SEARCH_URL, {
        method: "GET",
        headers,
    });
    logger.info("GET price codes response", {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
    });
    const json = (await response.json());
    logger.debug("GET price codes raw json", json);
    if (!response.ok || (json.status && json.status !== "success")) {
        const message = json?.message || `GET failed with status ${response.status}`;
        logger.error("GET price codes failed", { message, json });
        throw new Error(message);
    }
    return json.data ?? [];
}
async function fetchSourceCodes(headers) {
    logger.info("GET source codes started", { url: SOURCE_CODE_URL });
    const response = await fetch(SOURCE_CODE_URL, {
        method: "GET",
        headers,
    });
    const text = await response.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    }
    catch (error) {
        logger.error("failed to parse source code response", error);
    }
    logger.info("GET source codes response", {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        count: json?.data?.length ?? 0,
    });
    if (!response.ok) {
        throw new Error(`Source code fetch failed with status ${response.status}`);
    }
    return json?.data ?? [];
}
function buildLookupSearchPayload(dealerId, searchText) {
    return {
        PARTPRICECODE: {
            filters: [
                {
                    field: "siteId",
                    operator: "IN",
                    values: [`-1_${dealerId}`],
                },
            ],
            searchText,
            pageInfo: {
                start: 0,
                rows: 2000,
            },
            sort: [
                {
                    key: "code",
                    order: "ASC",
                    field: "code",
                },
            ],
        },
    };
}
function unwrapLookupSearchRows(payload) {
    const root = payload;
    const directArray = Array.isArray(root) ? root : null;
    const dataArray = root && !Array.isArray(root) && Array.isArray(root.data)
        ? (root.data ?? [])
        : null;
    const ppcArray = root && !Array.isArray(root) && Array.isArray(root.PARTPRICECODE)
        ? (root.PARTPRICECODE ?? [])
        : null;
    const items = directArray ?? dataArray ?? ppcArray ?? [];
    return items
        .map((item) => item?.data ?? null)
        .filter(Boolean);
}
async function lookupExistingPriceCodes(headers, dealerId, searchText) {
    const requestHeaders = { ...headers };
    delete requestHeaders["Content-Type"];
    delete requestHeaders["content-type"];
    delete requestHeaders["CONTENT-TYPE"];
    requestHeaders["content-type"] = "application/json";
    const payload = buildLookupSearchPayload(dealerId, searchText);
    logger.info("lookup search started", {
        url: LOOKUP_SEARCH_URL,
        searchText,
        payload,
    });
    const response = await fetch(LOOKUP_SEARCH_URL, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(payload),
    });
    const text = await response.text();
    let json = null;
    try {
        json = text ? JSON.parse(text) : null;
    }
    catch (error) {
        logger.warn("lookup search returned non-json", { searchText, error });
    }
    logger.info("lookup search response", {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
    });
    if (!response.ok) {
        throw new Error(`Lookup search failed with HTTP ${response.status}: ${text.substring(0, 300)}`);
    }
    return unwrapLookupSearchRows(json);
}
async function createOnePriceCode(payload, headers) {
    const requestHeaders = { ...headers };
    delete requestHeaders["Content-Type"];
    delete requestHeaders["content-type"];
    delete requestHeaders["CONTENT-TYPE"];
    requestHeaders["content-type"] = "application/json";
    logger.info("POST create price code started", {
        url: CREATE_URL,
        code: payload.code,
        description: payload.description,
        payload,
    });
    const response = await fetch(CREATE_URL, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(payload),
    });
    logger.info("POST create price code response", {
        code: payload.code,
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
    });
    const text = await response.text();
    logger.debug("POST create price code raw response text", {
        code: payload.code,
        text,
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.substring(0, 300)}`);
    }
}
async function updateOnePriceCode(id, payload, headers) {
    const requestHeaders = { ...headers };
    delete requestHeaders["Content-Type"];
    delete requestHeaders["content-type"];
    delete requestHeaders["CONTENT-TYPE"];
    requestHeaders["content-type"] = "application/json";
    const url = `${CREATE_URL}/${id}`;
    logger.info("PUT update price code started", {
        url,
        id,
        code: payload.code,
        payload,
    });
    const response = await fetch(url, {
        method: "PUT",
        headers: requestHeaders,
        body: JSON.stringify(payload),
    });
    const text = await response.text();
    logger.info("PUT update price code response", {
        id,
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
    });
    logger.debug("PUT update price code raw response text", {
        id,
        text,
    });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${text.substring(0, 300)}`);
    }
}
function resolveSourceCodeForRow(sourceCodeInput, sourceCodeMap) {
    const requested = normalizeText(sourceCodeInput) || "Default";
    const requestedUpper = normalizeUpper(requested);
    if (!requested || requestedUpper === "DEFAULT") {
        return {
            requestedCode: requested || "Default",
            resolvedSourceCodeId: "Default",
            usedDefaultFallback: false,
            matched: true,
            matchedDisplayCode: "Default",
            message: 'Using default source code ("Default")',
        };
    }
    const hit = sourceCodeMap.get(requestedUpper);
    if (hit?.id) {
        return {
            requestedCode: requested,
            resolvedSourceCodeId: hit.id,
            usedDefaultFallback: false,
            matched: true,
            matchedDisplayCode: normalizeText(hit.code) || requested,
            message: `Matched source code "${normalizeText(hit.code) || requested}"`,
        };
    }
    return {
        requestedCode: requested,
        resolvedSourceCodeId: "Default",
        usedDefaultFallback: true,
        matched: false,
        matchedDisplayCode: "Default",
        message: `Source code "${requested}" not found. Falling back to "Default".`,
    };
}
export const PriceCodeView = () => {
    const fileInputRef = useRef(null);
    const [viewMode, setViewMode] = useState("home");
    const [inputMethod, setInputMethod] = useState("file");
    const [searchResults, setSearchResults] = useState([]);
    const [parsedPriceCodes, setParsedPriceCodes] = useState([]);
    const [parseErrors, setParseErrors] = useState([]);
    const [selectedFileName, setSelectedFileName] = useState("");
    const [selectedFileSize, setSelectedFileSize] = useState("");
    const [parseProgress, setParseProgress] = useState(0);
    const [parseProgressText, setParseProgressText] = useState("");
    const [manualSourceCodes, setManualSourceCodes] = useState("");
    const [manualCodes, setManualCodes] = useState("");
    const [manualDescriptions, setManualDescriptions] = useState("");
    const [manualValues, setManualValues] = useState("");
    const [manualVariableTypes, setManualVariableTypes] = useState("");
    const [manualOperators, setManualOperators] = useState("");
    const [uploadResults, setUploadResults] = useState([]);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadProgressText, setUploadProgressText] = useState("");
    const [runState, setRunState] = useState("idle");
    const [statusText, setStatusText] = useState("Ready");
    const [errorText, setErrorText] = useState("");
    const [lastRunAt, setLastRunAt] = useState("");
    const [isSearching, setIsSearching] = useState(false);
    const [isParsing, setIsParsing] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isResolvingSourceCodes, setIsResolvingSourceCodes] = useState(false);
    const [sourceCodes, setSourceCodes] = useState([]);
    const [sourceCodesLoaded, setSourceCodesLoaded] = useState(false);
    const [sourceCodeLoadError, setSourceCodeLoadError] = useState("");
    const enabledHeaders = useMemo(() => getEnabledGlobalHeaders(), []);
    const dealerId = useMemo(() => extractDealerIdFromHeaders(enabledHeaders), [enabledHeaders]);
    useEffect(() => {
        logger.info("component mounted");
        logger.info("supported variable types", VARIABLE_TYPES);
        logger.info("supported operators", OPERATORS);
        return () => logger.info("component unmounted");
    }, []);
    useEffect(() => {
        logger.info("view mode changed", { viewMode });
    }, [viewMode]);
    useEffect(() => {
        logger.info("input method changed", { inputMethod });
    }, [inputMethod]);
    const sourceCodeMap = useMemo(() => {
        const map = new Map();
        sourceCodes.forEach((item) => {
            const code = normalizeUpper(item.code);
            if (code)
                map.set(code, item);
        });
        return map;
    }, [sourceCodes]);
    const resolvedParsedRows = useMemo(() => {
        return parsedPriceCodes.map((row) => ({
            ...row,
            sourceCodeResolution: resolveSourceCodeForRow(row.sourceCode, sourceCodeMap),
        }));
    }, [parsedPriceCodes, sourceCodeMap]);
    const manualPreviewData = useMemo(() => {
        const codes = manualCodes.split(",").map((s) => s.trim());
        const descriptions = manualDescriptions.split(",").map((s) => s.trim());
        const sourceCodesInput = manualSourceCodes.split(",").map((s) => s.trim());
        const valuesInput = manualValues.trim();
        const typesInput = manualVariableTypes.trim();
        const operatorsInput = manualOperators.trim();
        const autoParse = !valuesInput && !typesInput && !operatorsInput;
        let values = [];
        let variableTypes = [];
        let operators = [];
        if (autoParse && descriptions.length > 0) {
            descriptions.forEach((desc) => {
                const parsed = enhancedParseDescription(desc);
                values.push(String(parsed.value));
                variableTypes.push(parsed.type || "list");
                operators.push(parsed.operator || "add");
            });
        }
        else {
            values = manualValues.split(",").map((s) => s.trim());
            variableTypes = manualVariableTypes.split(",").map((s) => s.trim().toLowerCase());
            operators = manualOperators.split(",").map((s) => s.trim().toLowerCase());
        }
        const maxLength = Math.max(sourceCodesInput.length, codes.length, descriptions.length, values.length, variableTypes.length, operators.length);
        const preview = Array.from({ length: maxLength }).map((_, index) => {
            const sourceCode = sourceCodesInput[index] || "Default";
            const code = codes[index] || "";
            const description = descriptions[index] || "";
            const value = values[index] || "";
            const variableType = variableTypes[index] || "";
            const operator = operators[index] || "";
            const resolution = resolveSourceCodeForRow(sourceCode, sourceCodeMap);
            return {
                sourceCode,
                code,
                description,
                value: Number(value),
                variableType,
                operator,
                hasError: !code || !description || !value || !variableType || !operator,
                autoParsed: autoParse,
                sourceCodeResolution: resolution,
            };
        });
        logger.debug("manual preview recalculated", {
            count: preview.length,
            autoParse,
            preview,
        });
        return preview.filter((row) => row.sourceCode ||
            row.code ||
            row.description ||
            String(row.value || "") ||
            row.variableType ||
            row.operator);
    }, [
        manualSourceCodes,
        manualCodes,
        manualDescriptions,
        manualValues,
        manualVariableTypes,
        manualOperators,
        sourceCodeMap,
    ]);
    const failedUploadCount = useMemo(() => uploadResults.filter((item) => !item.success).length, [uploadResults]);
    const successUploadCount = useMemo(() => uploadResults.filter((item) => item.success).length, [uploadResults]);
    const loadSourceCodesIfNeeded = async () => {
        if (sourceCodesLoaded || isResolvingSourceCodes)
            return;
        logger.info("loading source codes on demand");
        setIsResolvingSourceCodes(true);
        setSourceCodeLoadError("");
        try {
            const headers = getEnabledGlobalHeaders();
            if (Object.keys(headers).length === 0) {
                throw new Error("No active global headers found.");
            }
            const rows = await fetchSourceCodes(headers);
            setSourceCodes(rows);
            setSourceCodesLoaded(true);
            logger.info("source codes loaded", { count: rows.length });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error("source code load failed", error);
            setSourceCodeLoadError(message);
        }
        finally {
            setIsResolvingSourceCodes(false);
        }
    };
    useEffect(() => {
        const hasManualNonDefaultSource = manualSourceCodes
            .split(",")
            .map((s) => normalizeUpper(s))
            .some((s) => s && s !== "DEFAULT");
        const hasParsedNonDefaultSource = parsedPriceCodes.some((row) => normalizeUpper(row.sourceCode) !== "" && normalizeUpper(row.sourceCode) !== "DEFAULT");
        if ((hasManualNonDefaultSource || hasParsedNonDefaultSource) && !sourceCodesLoaded) {
            void loadSourceCodesIfNeeded();
        }
    }, [manualSourceCodes, parsedPriceCodes, sourceCodesLoaded]);
    const handleSearch = async () => {
        logger.info("search button clicked");
        setIsSearching(true);
        setRunState("loading");
        setStatusText("Searching price codes...");
        setErrorText("");
        try {
            const headers = getEnabledGlobalHeaders();
            if (Object.keys(headers).length === 0) {
                logger.warn("global headers missing before search");
                setRunState("error");
                setStatusText("Global headers are missing");
                setErrorText("No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers.");
                return;
            }
            const rows = await fetchPriceCodes(headers);
            setSearchResults(rows);
            setRunState("success");
            setStatusText(`Found ${rows.length} price code${rows.length === 1 ? "" : "s"}`);
            setLastRunAt(new Date().toLocaleString());
            logger.info("search completed successfully", { count: rows.length });
        }
        catch (error) {
            logger.error("search failed", error);
            setRunState("error");
            setStatusText("Search failed");
            setErrorText(error instanceof Error ? error.message : String(error));
            setLastRunAt(new Date().toLocaleString());
        }
        finally {
            setIsSearching(false);
        }
    };
    const handleFileSelection = (file) => {
        logger.info("file selected", {
            name: file.name,
            size: file.size,
            type: file.type,
        });
        const validExtensions = [".csv", ".xlsx", ".xls"];
        const isValid = validExtensions.some((ext) => file.name.toLowerCase().endsWith(ext));
        if (!isValid) {
            logger.warn("invalid file type selected", { fileName: file.name });
            setRunState("error");
            setStatusText("Invalid file type");
            setErrorText(`Please upload ${validExtensions.join(", ")} files only.`);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
            return;
        }
        setSelectedFileName(file.name);
        setSelectedFileSize(`${(file.size / 1024).toFixed(2)} KB`);
        setParsedPriceCodes([]);
        setParseErrors([]);
        setRunState("idle");
        setStatusText("File selected. Ready to parse.");
        setErrorText("");
    };
    const parseCSVFile = async (file) => {
        logger.info("starting CSV parse", {
            fileName: file.name,
            size: file.size,
        });
        setIsParsing(true);
        setParseProgress(0);
        setParseProgressText("Reading file...");
        setRunState("loading");
        setStatusText("Parsing CSV file...");
        setErrorText("");
        setParsedPriceCodes([]);
        setParseErrors([]);
        try {
            const text = await file.text();
            let normalizedText = text;
            if (normalizedText.charCodeAt(0) === 0xfeff) {
                normalizedText = normalizedText.slice(1);
            }
            const rowStrings = normalizedText
                .split(/\r?\n/)
                .filter((row) => row.trim() !== "");
            logger.info("csv rows loaded", { rowCount: rowStrings.length });
            const mappedRows = rowStrings.map((row) => parseCSVRow(row));
            const { parsed, errors } = processImportedRows(mappedRows, (prog, textValue) => {
                setParseProgress(prog);
                setParseProgressText(textValue);
            });
            logger.info("csv parse finished", {
                parsedCount: parsed.length,
                errorCount: errors.length,
            });
            setParsedPriceCodes(parsed);
            setParseErrors(errors);
            setParseProgress(100);
            setParseProgressText("Complete!");
            setRunState(errors.length > 0 ? "warning" : "success");
            setStatusText(`Parsed ${parsed.length} row${parsed.length === 1 ? "" : "s"} with ${errors.length} error${errors.length === 1 ? "" : "s"}`);
            setLastRunAt(new Date().toLocaleString());
        }
        catch (error) {
            logger.error("csv parse failed", error);
            setRunState("error");
            setStatusText("Failed to parse CSV file");
            setErrorText(error instanceof Error ? error.message : String(error));
        }
        finally {
            setIsParsing(false);
        }
    };
    const parseExcelFile = async (file) => {
        logger.info("starting Excel parse", {
            fileName: file.name,
            size: file.size,
        });
        setIsParsing(true);
        setParseProgress(0);
        setParseProgressText("Reading file...");
        setRunState("loading");
        setStatusText("Parsing Excel file...");
        setErrorText("");
        setParsedPriceCodes([]);
        setParseErrors([]);
        try {
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: "array" });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
            logger.info("excel rows loaded", { rowCount: rows.length });
            const { parsed, errors } = processImportedRows(rows, (prog, textValue) => {
                setParseProgress(prog);
                setParseProgressText(textValue);
            });
            logger.info("excel parse finished", {
                parsedCount: parsed.length,
                errorCount: errors.length,
            });
            setParsedPriceCodes(parsed);
            setParseErrors(errors);
            setParseProgress(100);
            setParseProgressText("Complete!");
            setRunState(errors.length > 0 ? "warning" : "success");
            setStatusText(`Parsed ${parsed.length} row${parsed.length === 1 ? "" : "s"} with ${errors.length} error${errors.length === 1 ? "" : "s"}`);
            setLastRunAt(new Date().toLocaleString());
        }
        catch (error) {
            logger.error("excel parse failed", error);
            setRunState("error");
            setStatusText("Failed to parse Excel file");
            setErrorText(error instanceof Error ? error.message : String(error));
        }
        finally {
            setIsParsing(false);
        }
    };
    const handleParseFile = async () => {
        logger.info("parse file button clicked");
        const file = fileInputRef.current?.files?.[0];
        if (!file) {
            logger.warn("parse file blocked because no file selected");
            setRunState("error");
            setStatusText("No file selected");
            setErrorText("Please select a file first.");
            return;
        }
        const fileName = file.name.toLowerCase();
        if (fileName.endsWith(".csv")) {
            await parseCSVFile(file);
            return;
        }
        if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
            await parseExcelFile(file);
            return;
        }
        setRunState("error");
        setStatusText("Unsupported file format");
        setErrorText("Please upload .csv or .xlsx / .xls file.");
    };
    const clearManualFields = () => {
        logger.info("clear manual fields clicked");
        setManualSourceCodes("");
        setManualCodes("");
        setManualDescriptions("");
        setManualValues("");
        setManualVariableTypes("");
        setManualOperators("");
        setRunState("idle");
        setStatusText("Manual inputs cleared");
        setErrorText("");
    };
    const parseManualInput = () => {
        logger.info("parsing manual input");
        const sourceCodesInput = manualSourceCodes.split(",").map((s) => s.trim());
        const codes = manualCodes.split(",").map((s) => s.trim());
        const descriptions = manualDescriptions.split(",").map((s) => s.trim());
        const valuesInput = manualValues.trim();
        const typesInput = manualVariableTypes.trim();
        const operatorsInput = manualOperators.trim();
        const autoParse = !valuesInput && !typesInput && !operatorsInput;
        let values = [];
        let variableTypes = [];
        let operators = [];
        if (autoParse) {
            logger.info("manual input auto-parse mode enabled from descriptions");
            descriptions.forEach((desc) => {
                const parsed = enhancedParseDescription(desc);
                values.push(parsed.value);
                variableTypes.push(parsed.type || "list");
                operators.push(parsed.operator || "add");
            });
        }
        else {
            values = manualValues.split(",").map((s) => Number(s.trim()));
            variableTypes = manualVariableTypes
                .split(",")
                .map((s) => s.trim().toLowerCase());
            operators = manualOperators
                .split(",")
                .map((s) => s.trim().toLowerCase());
        }
        const nonEmptyCodes = codes.filter(Boolean).length;
        const length = Math.max(nonEmptyCodes, descriptions.filter(Boolean).length, values.length, variableTypes.length, operators.length, sourceCodesInput.filter(Boolean).length);
        if (codes.length !== length || descriptions.length !== length) {
            logger.warn("manual input validation failed due to uneven mandatory field counts", {
                sourceCodes: sourceCodesInput.length,
                codes: codes.length,
                descriptions: descriptions.length,
                values: values.length,
                variableTypes: variableTypes.length,
                operators: operators.length,
            });
            setRunState("error");
            setStatusText("Input count mismatch");
            setErrorText("Source Code, Code, Description, Value, Variable Type and Operator columns must align by position.");
            return null;
        }
        if (values.length !== length ||
            variableTypes.length !== length ||
            operators.length !== length) {
            logger.warn("manual input validation failed due to uneven computed field counts", {
                sourceCodes: sourceCodesInput.length,
                codes: codes.length,
                descriptions: descriptions.length,
                values: values.length,
                variableTypes: variableTypes.length,
                operators: operators.length,
            });
            setRunState("error");
            setStatusText("Input count mismatch");
            setErrorText("All fields must have the same number of comma-separated values.");
            return null;
        }
        const data = [];
        for (let i = 0; i < length; i += 1) {
            data.push({
                sourceCode: sourceCodesInput[i] || "Default",
                code: codes[i],
                description: descriptions[i],
                value: values[i],
                variableType: variableTypes[i],
                operator: operators[i],
            });
        }
        logger.info("manual input parsed", { count: data.length, data });
        return data;
    };
    const validateParsedData = (data) => {
        logger.info("validating parsed data", { count: data.length });
        for (let index = 0; index < data.length; index += 1) {
            const item = data[index];
            if (!item.code) {
                setRunState("error");
                setStatusText(`Validation failed at row ${index + 1}`);
                setErrorText(`Code #${index + 1} is empty`);
                return false;
            }
            if (!item.description) {
                setRunState("error");
                setStatusText(`Validation failed at row ${index + 1}`);
                setErrorText(`Description #${index + 1} is empty`);
                return false;
            }
            if (Number.isNaN(item.value)) {
                setRunState("error");
                setStatusText(`Validation failed at row ${index + 1}`);
                setErrorText(`Value #${index + 1} is not a number`);
                return false;
            }
            if (!isVariableType(item.variableType)) {
                setRunState("error");
                setStatusText(`Validation failed at row ${index + 1}`);
                setErrorText(`Variable Type #${index + 1} must be one of: ${VARIABLE_TYPES.join(", ")}`);
                return false;
            }
            if (!isOperatorType(item.operator)) {
                setRunState("error");
                setStatusText(`Validation failed at row ${index + 1}`);
                setErrorText(`Operator #${index + 1} must be one of: ${OPERATORS.join(", ")}`);
                return false;
            }
        }
        logger.info("parsed data validation passed");
        return true;
    };
    const createPriceCodes = async (retryData) => {
        logger.info("create price codes clicked", {
            retryMode: Boolean(retryData),
            inputMethod,
        });
        let baseData = null;
        if (!retryData) {
            if (inputMethod === "file") {
                baseData = parsedPriceCodes;
                if (!baseData || baseData.length === 0) {
                    logger.warn("create blocked because no parsed file data exists");
                    setRunState("error");
                    setStatusText("No parsed file data");
                    setErrorText("Please upload and parse a file first.");
                    return;
                }
            }
            else {
                baseData = parseManualInput();
                if (!baseData)
                    return;
            }
            if (!validateParsedData(baseData)) {
                logger.warn("create blocked because parsed data validation failed");
                return;
            }
        }
        setIsSubmitting(true);
        setRunState("loading");
        setStatusText("Creating price codes...");
        setErrorText("");
        setUploadResults([]);
        setUploadProgress(0);
        setUploadProgressText("");
        try {
            const headers = getEnabledGlobalHeaders();
            if (Object.keys(headers).length === 0) {
                logger.warn("global headers missing before create");
                setRunState("error");
                setStatusText("Global headers are missing");
                setErrorText("No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers.");
                return;
            }
            const currentDealerId = extractDealerIdFromHeaders(headers);
            if (!currentDealerId) {
                setRunState("error");
                setStatusText("Dealer ID not found");
                setErrorText("Dealer ID not found in Global Headers.");
                return;
            }
            if (!sourceCodesLoaded) {
                try {
                    const scRows = await fetchSourceCodes(headers);
                    setSourceCodes(scRows);
                    setSourceCodesLoaded(true);
                }
                catch (error) {
                    logger.warn("source code prefetch failed before create, default fallback will continue", error);
                }
            }
            const sourceMapNow = new Map();
            (sourceCodesLoaded ? sourceCodes : await (async () => {
                try {
                    return await fetchSourceCodes(headers);
                }
                catch {
                    return [];
                }
            })()).forEach((item) => {
                const code = normalizeUpper(item.code);
                if (code)
                    sourceMapNow.set(code, item);
            });
            const rowsToUse = retryData ??
                (baseData ?? []).map((row) => ({
                    ...row,
                    sourceCodeResolution: resolveSourceCodeForRow(row.sourceCode, sourceMapNow),
                }));
            logger.info("resolved rows ready for submit", { count: rowsToUse.length, rowsToUse });
            const allLookupRows = await lookupExistingPriceCodes(headers, currentDealerId, "");
            const existingCodeMap = new Map();
            allLookupRows.forEach((row) => {
                const code = normalizeUpper(row.code);
                if (code && !existingCodeMap.has(code)) {
                    existingCodeMap.set(code, row);
                }
            });
            const results = [];
            for (let index = 0; index < rowsToUse.length; index += 1) {
                const row = rowsToUse[index];
                const current = index + 1;
                const progress = Math.round((current / rowsToUse.length) * 100);
                setUploadProgress(progress);
                setUploadProgressText(`Processing ${current} of ${rowsToUse.length}`);
                setStatusText(`Processing ${row.code} (${current}/${rowsToUse.length})...`);
                try {
                    let existing = existingCodeMap.get(normalizeUpper(row.code));
                    if (!existing) {
                        const targetedSearch = await lookupExistingPriceCodes(headers, currentDealerId, row.code);
                        existing =
                            targetedSearch.find((item) => normalizeUpper(item.code) === normalizeUpper(row.code)) ?? undefined;
                        if (existing?.code) {
                            existingCodeMap.set(normalizeUpper(existing.code), existing);
                        }
                    }
                    const payload = buildPayloadForRow(row, normalizeText(existing?.id) || undefined);
                    if (existing?.id && normalizeUpper(existing.code) === normalizeUpper(row.code)) {
                        await updateOnePriceCode(existing.id, payload, headers);
                        results.push({
                            success: true,
                            code: row.code,
                            description: row.description,
                            sourceCode: row.sourceCode,
                            mode: "PUT",
                            sourceCodeIdUsed: row.sourceCodeResolution.resolvedSourceCodeId,
                        });
                        logger.info("update succeeded for row", {
                            index,
                            code: row.code,
                            existingId: existing.id,
                        });
                    }
                    else {
                        await createOnePriceCode(payload, headers);
                        results.push({
                            success: true,
                            code: row.code,
                            description: row.description,
                            sourceCode: row.sourceCode,
                            mode: "POST",
                            sourceCodeIdUsed: row.sourceCodeResolution.resolvedSourceCodeId,
                        });
                        logger.info("create succeeded for row", {
                            index,
                            code: row.code,
                        });
                    }
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    results.push({
                        success: false,
                        code: row.code,
                        description: row.description,
                        sourceCode: row.sourceCode,
                        sourceCodeIdUsed: row.sourceCodeResolution.resolvedSourceCodeId,
                        error: message,
                    });
                    logger.error("create/update failed for row", {
                        index,
                        code: row.code,
                        error: message,
                    });
                }
                setUploadResults([...results]);
            }
            const successCount = results.filter((item) => item.success).length;
            const failCount = results.filter((item) => !item.success).length;
            logger.info("bulk upsert finished", {
                successCount,
                failCount,
                results,
            });
            setLastRunAt(new Date().toLocaleString());
            if (failCount === 0) {
                setRunState("success");
                setStatusText(`Processed all ${successCount} price code(s) successfully`);
                setErrorText("");
                if (!retryData) {
                    if (inputMethod === "file") {
                        setParsedPriceCodes([]);
                        setParseErrors([]);
                        setSelectedFileName("");
                        setSelectedFileSize("");
                        if (fileInputRef.current)
                            fileInputRef.current.value = "";
                    }
                    else {
                        clearManualFields();
                    }
                }
            }
            else {
                setRunState("warning");
                setStatusText(`Completed with partial success. ${successCount} succeeded and ${failCount} failed.`);
                setErrorText(results
                    .filter((item) => !item.success)
                    .map((item) => `${item.code}: ${item.error ?? "Unknown error"}`)
                    .join("\n"));
            }
        }
        catch (error) {
            logger.error("bulk upsert failed unexpectedly", error);
            setRunState("error");
            setStatusText("Failed to process price codes");
            setErrorText(error instanceof Error ? error.message : String(error));
            setLastRunAt(new Date().toLocaleString());
        }
        finally {
            setIsSubmitting(false);
        }
    };
    const retryFailedItems = async () => {
        const failedKeys = new Set(uploadResults
            .filter((item) => !item.success)
            .map((item) => `${normalizeUpper(item.sourceCode)}__${normalizeUpper(item.code)}`));
        const sourceData = inputMethod === "file"
            ? resolvedParsedRows
            : manualPreviewData;
        const failedItems = sourceData.filter((item) => failedKeys.has(`${normalizeUpper(item.sourceCode)}__${normalizeUpper(item.code)}`));
        logger.info("retry failed items clicked", {
            failedCount: failedItems.length,
            failedItems,
        });
        if (failedItems.length === 0) {
            logger.warn("retry skipped because no failed items found");
            return;
        }
        await createPriceCodes(failedItems);
    };
    return (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsxs("div", { style: {
                    borderRadius: 18,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 20,
                }, children: [_jsxs("div", { style: {
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: 12,
                            flexWrap: "wrap",
                            marginBottom: 14,
                        }, children: [_jsxs("div", { style: { minWidth: 0 }, children: [_jsx("div", { style: {
                                            fontSize: 24,
                                            fontWeight: 800,
                                            color: "#f8fafc",
                                            marginBottom: 6,
                                            wordBreak: "break-word",
                                        }, children: "Price code" }), _jsx("div", { style: {
                                            color: "#94a3b8",
                                            fontSize: 14,
                                            lineHeight: 1.7,
                                            whiteSpace: "pre-wrap",
                                            overflowWrap: "anywhere",
                                        }, children: "Search existing price codes or bulk create/update price codes from CSV/Excel/manual input using active Global Headers from Settings. Supports optional Source Code column with automatic validation and fallback to Default." })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { className: viewMode === "home" ? "btn-postman" : "btn-secondary btn-sm", type: "button", onClick: () => setViewMode("home"), children: "Home" }), _jsx("button", { className: viewMode === "search" ? "btn-postman" : "btn-secondary btn-sm", type: "button", onClick: () => setViewMode("search"), children: "Search" }), _jsx("button", { className: viewMode === "bulk-upload" ? "btn-postman" : "btn-secondary btn-sm", type: "button", onClick: () => setViewMode("bulk-upload"), children: "Bulk Upload" })] })] }), _jsxs("div", { style: {
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                            marginBottom: 14,
                        }, children: [_jsx(Pill, { label: "Module", value: MODULE_NAME }), _jsx(Pill, { label: "Mode", value: viewMode }), _jsx(Pill, { label: "Dealer ID", value: dealerId || "Not found" }), _jsx(Pill, { label: "Parsed Rows", value: String(parsedPriceCodes.length) }), _jsx(Pill, { label: "Search Rows", value: String(searchResults.length) }), _jsx(Pill, { label: "Source Codes", value: sourceCodesLoaded ? String(sourceCodes.length) : "Not loaded" }), _jsx(Pill, { label: "Upload Success", value: String(successUploadCount) }), _jsx(Pill, { label: "Upload Failed", value: String(failedUploadCount) }), lastRunAt ? _jsx(Pill, { label: "Last Run", value: lastRunAt }) : null] }), _jsxs("div", { style: {
                            borderRadius: 14,
                            padding: "12px 14px",
                            fontSize: 13,
                            lineHeight: 1.6,
                            border: runState === "error"
                                ? "1px solid rgba(239,68,68,0.25)"
                                : runState === "success"
                                    ? "1px solid rgba(34,197,94,0.25)"
                                    : runState === "warning"
                                        ? "1px solid rgba(245,158,11,0.25)"
                                        : "1px solid rgba(255,255,255,0.08)",
                            background: runState === "error"
                                ? "rgba(239,68,68,0.10)"
                                : runState === "success"
                                    ? "rgba(34,197,94,0.10)"
                                    : runState === "warning"
                                        ? "rgba(245,158,11,0.10)"
                                        : "rgba(255,255,255,0.03)",
                            color: runState === "error"
                                ? "#fecaca"
                                : runState === "success"
                                    ? "#bbf7d0"
                                    : runState === "warning"
                                        ? "#fde68a"
                                        : "#cbd5e1",
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                        }, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: errorText ? 6 : 0 }, children: statusText }), errorText ? _jsx("div", { children: errorText }) : null, sourceCodeLoadError ? (_jsxs("div", { style: { marginTop: 8, color: "#fde68a" }, children: ["Source code validation warning: ", sourceCodeLoadError] })) : null] })] }), viewMode === "home" ? (_jsxs("div", { style: {
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                    gap: 16,
                }, children: [_jsx(ActionCard, { icon: "\uD83D\uDD0D", title: "Search price codes", description: "Fetch and view all existing price code configurations.", buttonLabel: "Open Search", onClick: () => {
                            logger.info("home action clicked", { action: "search" });
                            setViewMode("search");
                        } }), _jsx(ActionCard, { icon: "\uD83D\uDCE4", title: "Bulk upload price codes", description: "Create or update multiple price codes from CSV/Excel or manual comma-separated values, including optional source-code-based formulas.", buttonLabel: "Open Bulk Upload", onClick: () => {
                            logger.info("home action clicked", { action: "bulk-upload" });
                            setViewMode("bulk-upload");
                        } })] })) : null, viewMode === "search" ? (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsx(SectionCard, { title: "Search Existing Price Codes", children: _jsx("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: _jsx("button", { className: "btn-postman", type: "button", onClick: () => {
                                    void handleSearch();
                                }, disabled: isSearching, children: isSearching ? "Searching..." : "Search Price Codes" }) }) }), _jsx(SectionCard, { title: `Search Results (${searchResults.length})`, children: isSearching ? (_jsx(LoadingBox, { text: "Loading price codes..." })) : searchResults.length === 0 ? (_jsx(EmptyText, { text: "No search results yet. Click Search Price Codes." })) : (_jsx("div", { style: { overflowX: "auto", overflowY: "auto", maxHeight: "550px" }, children: _jsxs("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: 860 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "rgba(255,255,255,0.04)" }, children: [_jsx("th", { style: thStyle, children: "#" }), _jsx("th", { style: thStyle, children: "Code" }), _jsx("th", { style: thStyle, children: "Description" }), _jsx("th", { style: thStyle, children: "ID" })] }) }), _jsx("tbody", { children: searchResults.map((pc, index) => (_jsxs("tr", { style: { borderTop: "1px solid rgba(255,255,255,0.08)" }, children: [_jsx("td", { style: tdStyle, children: index + 1 }), _jsx("td", { style: tdMonoStyle, children: normalizeText(pc.code) || "N/A" }), _jsx("td", { style: tdStyle, children: normalizeText(pc.description) || "N/A" }), _jsx("td", { style: tdMonoStyle, children: normalizeText(pc.id) || "N/A" })] }, `${pc.id ?? pc.code ?? index}-${index}`))) })] }) })) })] })) : null, viewMode === "bulk-upload" ? (_jsxs("div", { style: { display: "grid", gap: 16 }, children: [_jsx(SectionCard, { title: "Input Method", children: _jsxs("div", { style: { display: "flex", gap: 12, flexWrap: "wrap" }, children: [_jsx("button", { className: inputMethod === "file" ? "btn-postman" : "btn-secondary btn-sm", type: "button", onClick: () => {
                                        logger.info("input method button clicked", { method: "file" });
                                        setInputMethod("file");
                                    }, children: "\uD83D\uDCC1 File Upload" }), _jsx("button", { className: inputMethod === "manual" ? "btn-postman" : "btn-secondary btn-sm", type: "button", onClick: () => {
                                        logger.info("input method button clicked", { method: "manual" });
                                        setInputMethod("manual");
                                    }, children: "\u270D\uFE0F Manual Input" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: () => {
                                        void loadSourceCodesIfNeeded();
                                    }, disabled: isResolvingSourceCodes, children: isResolvingSourceCodes
                                        ? "Loading Source Codes..."
                                        : sourceCodesLoaded
                                            ? "Refresh Source Codes"
                                            : "Load Source Codes" })] }) }), inputMethod === "file" ? (_jsxs(SectionCard, { title: "File Upload", children: [_jsxs("div", { style: {
                                    padding: 24,
                                    borderRadius: 14,
                                    border: "2px dashed rgba(148,163,184,0.25)",
                                    background: "rgba(0,184,204,0.03)",
                                    textAlign: "center",
                                }, children: [_jsx("div", { style: { fontSize: 40, marginBottom: 10 }, children: "\uD83D\uDCC1" }), _jsx("div", { style: { color: "#f8fafc", fontWeight: 700, marginBottom: 6 }, children: "Select CSV / Excel file" }), _jsx("div", { style: { color: "#94a3b8", fontSize: 13, marginBottom: 12 }, children: "Supports .csv, .xlsx, .xls" }), _jsxs("div", { style: { color: "#94a3b8", fontSize: 12, marginBottom: 12 }, children: ["Supported column layouts:", _jsx("br", {}), _jsx("code", { children: "Code, Description, Value, VariableType, Operator" }), _jsx("br", {}), "or", _jsx("br", {}), _jsx("code", { children: "SourceCode, Code, Description, Value, VariableType, Operator" })] }), _jsx("input", { ref: fileInputRef, type: "file", accept: ".csv,.xlsx,.xls", onChange: (e) => {
                                            const file = e.target.files?.[0];
                                            if (file)
                                                handleFileSelection(file);
                                        }, style: { marginBottom: 12 } }), selectedFileName ? (_jsxs("div", { style: {
                                            marginTop: 10,
                                            padding: 12,
                                            borderRadius: 12,
                                            border: "1px solid rgba(0,184,204,0.20)",
                                            background: "rgba(0,184,204,0.08)",
                                            display: "grid",
                                            gap: 4,
                                            textAlign: "left",
                                        }, children: [_jsx("div", { style: { color: "#f8fafc", fontWeight: 700 }, children: selectedFileName }), _jsx("div", { style: { color: "#94a3b8", fontSize: 12 }, children: selectedFileSize })] })) : null, _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }, children: [_jsx("button", { className: "btn-postman", type: "button", disabled: !selectedFileName || isParsing, onClick: () => {
                                                    void handleParseFile();
                                                }, children: isParsing ? "Parsing..." : "Upload & Parse File" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", disabled: !selectedFileName, onClick: () => {
                                                    logger.info("remove file clicked");
                                                    setSelectedFileName("");
                                                    setSelectedFileSize("");
                                                    setParsedPriceCodes([]);
                                                    setParseErrors([]);
                                                    setParseProgress(0);
                                                    setParseProgressText("");
                                                    if (fileInputRef.current)
                                                        fileInputRef.current.value = "";
                                                }, children: "Remove" })] })] }), (isParsing || parseProgress > 0) && parseProgressText ? (_jsx(ProgressBox, { title: parseProgressText, progress: parseProgress, subtitle: `${parseProgress}% complete` })) : null] })) : null, inputMethod === "manual" ? (_jsxs(SectionCard, { title: "Manual Input", children: [_jsxs("div", { style: {
                                    display: "flex",
                                    justifyContent: "space-between",
                                    gap: 12,
                                    flexWrap: "wrap",
                                    marginBottom: 12,
                                }, children: [_jsxs("div", { style: {
                                            padding: "12px 14px",
                                            background: "rgba(0,184,204,0.08)",
                                            border: "1px solid rgba(0,184,204,0.2)",
                                            borderLeft: "3px solid #00B8CC",
                                            borderRadius: 10,
                                            color: "#d0d6e0",
                                            fontSize: 13,
                                            flex: 1,
                                            minWidth: 240,
                                        }, children: ["Enter comma-separated values for each field below.", _jsx("br", {}), "Source Code is optional. Use ", _jsx("b", { children: "Default" }), " or leave blank for default behavior.", _jsx("br", {}), "Leave Value / Type / Operator blank to auto-parse from Description."] }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", onClick: clearManualFields, children: "\uD83D\uDDD1 Clear All" })] }), _jsxs("div", { style: { display: "grid", gap: 12 }, children: [_jsx(Field, { label: "Source Codes (comma-separated, optional)", value: manualSourceCodes, placeholder: "Default,999D,999F", hint: 'Use "Default" or leave blank for standard default source code.', onChange: setManualSourceCodes }), _jsx(Field, { label: "Price Code Names (comma-separated)", value: manualCodes, placeholder: "1,4,4", onChange: setManualCodes }), _jsx(Field, { label: "Descriptions (comma-separated)", value: manualDescriptions, placeholder: "LIST,LIST,LIST", onChange: setManualDescriptions }), _jsx(Field, { label: "Values (comma-separated)", value: manualValues, placeholder: "0,10,10", onChange: setManualValues }), _jsx(Field, { label: "Variable Types (comma-separated)", value: manualVariableTypes, placeholder: "list,list,list", hint: "Options: cost, list, trade, warranty, matrix", onChange: setManualVariableTypes }), _jsx(Field, { label: "Operators (comma-separated)", value: manualOperators, placeholder: "add,add,add", hint: "Options: add, subtract", onChange: setManualOperators })] })] })) : null, inputMethod === "file" ? (_jsxs(SectionCard, { title: `Parsed File Preview (${resolvedParsedRows.length})`, children: [resolvedParsedRows.length === 0 ? (_jsx(EmptyText, { text: "No parsed file data yet." })) : (_jsx("div", { style: { overflowX: "auto", overflowY: "auto", maxHeight: "550px" }, children: _jsxs("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: 1240 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "rgba(255,255,255,0.04)" }, children: [_jsx("th", { style: thStyle, children: "#" }), _jsx("th", { style: thStyle, children: "Source Code" }), _jsx("th", { style: thStyle, children: "Source Validation" }), _jsx("th", { style: thStyle, children: "Code" }), _jsx("th", { style: thStyle, children: "Description" }), _jsx("th", { style: thStyle, children: "Type" }), _jsx("th", { style: thStyle, children: "Operator" }), _jsx("th", { style: thStyle, children: "Value" }), _jsx("th", { style: thStyle, children: "Source Code ID Used" })] }) }), _jsx("tbody", { children: resolvedParsedRows.map((item, index) => (_jsxs("tr", { style: { borderTop: "1px solid rgba(255,255,255,0.08)" }, children: [_jsx("td", { style: tdStyle, children: index + 1 }), _jsx("td", { style: tdMonoStyle, children: item.sourceCode || "Default" }), _jsx("td", { style: tdStyle, children: _jsx(SourceCodeStatus, { resolution: item.sourceCodeResolution }) }), _jsx("td", { style: tdMonoStyle, children: item.code }), _jsx("td", { style: tdStyle, children: item.description }), _jsx("td", { style: tdStyle, children: item.variableType }), _jsx("td", { style: tdStyle, children: item.operator }), _jsx("td", { style: tdStyle, children: item.value }), _jsx("td", { style: tdMonoStyle, children: item.sourceCodeResolution.resolvedSourceCodeId })] }, `${item.sourceCode}-${item.code}-${index}`))) })] }) })), parseErrors.length > 0 ? (_jsxs("div", { style: {
                                    marginTop: 14,
                                    borderRadius: 12,
                                    border: "1px solid rgba(239,68,68,0.25)",
                                    background: "rgba(239,68,68,0.10)",
                                    padding: 12,
                                    color: "#fecaca",
                                    fontSize: 13,
                                    lineHeight: 1.6,
                                }, children: [_jsxs("div", { style: { fontWeight: 700, marginBottom: 8 }, children: ["Parsing Errors (", parseErrors.length, ")"] }), _jsxs("div", { style: { display: "grid", gap: 8 }, children: [parseErrors.slice(0, 10).map((err) => (_jsxs("div", { children: [_jsxs("b", { children: ["Line ", err.line, ":"] }), " ", err.error, _jsx("div", { style: { color: "#fca5a5", fontSize: 12 }, children: err.data })] }, `${err.line}-${err.error}`))), parseErrors.length > 10 ? (_jsxs("div", { style: { color: "#fca5a5", fontSize: 12 }, children: ["... and ", parseErrors.length - 10, " more"] })) : null] })] })) : null] })) : null, inputMethod === "manual" ? (_jsx(SectionCard, { title: `Manual Preview (${manualPreviewData.length})`, children: manualPreviewData.length === 0 ? (_jsx(EmptyText, { text: "Start typing manual input to preview rows." })) : (_jsx("div", { style: { overflowX: "auto", overflowY: "auto", maxHeight: "550px" }, children: _jsxs("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: 1360 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "rgba(255,255,255,0.04)" }, children: [_jsx("th", { style: thStyle, children: "#" }), _jsx("th", { style: thStyle, children: "Source Code" }), _jsx("th", { style: thStyle, children: "Source Validation" }), _jsx("th", { style: thStyle, children: "Code" }), _jsx("th", { style: thStyle, children: "Description" }), _jsx("th", { style: thStyle, children: "Type" }), _jsx("th", { style: thStyle, children: "Operator" }), _jsx("th", { style: thStyle, children: "Value" }), _jsx("th", { style: thStyle, children: "Source Code ID Used" }), _jsx("th", { style: thStyle, children: "Status" })] }) }), _jsx("tbody", { children: manualPreviewData.map((item, index) => {
                                            const hasError = !item.code ||
                                                !item.description ||
                                                Number.isNaN(item.value) ||
                                                !item.variableType ||
                                                !item.operator;
                                            return (_jsxs("tr", { style: {
                                                    borderTop: "1px solid rgba(255,255,255,0.08)",
                                                    background: hasError
                                                        ? "rgba(239,68,68,0.05)"
                                                        : "rgba(34,197,94,0.04)",
                                                }, children: [_jsx("td", { style: tdStyle, children: index + 1 }), _jsx("td", { style: tdMonoStyle, children: item.sourceCode || "Default" }), _jsx("td", { style: tdStyle, children: _jsx(SourceCodeStatus, { resolution: item.sourceCodeResolution }) }), _jsx("td", { style: tdMonoStyle, children: item.code || "Missing" }), _jsx("td", { style: tdStyle, children: item.description || "Missing" }), _jsx("td", { style: tdStyle, children: item.variableType || "Missing" }), _jsx("td", { style: tdStyle, children: item.operator || "Missing" }), _jsx("td", { style: tdStyle, children: Number.isNaN(item.value) ? "Missing" : item.value }), _jsx("td", { style: tdMonoStyle, children: item.sourceCodeResolution.resolvedSourceCodeId }), _jsx("td", { style: tdStyle, children: _jsx("span", { style: {
                                                                display: "inline-flex",
                                                                padding: "4px 10px",
                                                                borderRadius: 999,
                                                                border: hasError
                                                                    ? "1px solid rgba(239,68,68,0.25)"
                                                                    : "1px solid rgba(34,197,94,0.25)",
                                                                background: hasError
                                                                    ? "rgba(239,68,68,0.10)"
                                                                    : "rgba(34,197,94,0.10)",
                                                                color: hasError ? "#fca5a5" : "#86efac",
                                                                fontSize: 12,
                                                                fontWeight: 700,
                                                            }, children: hasError ? "Incomplete" : "Valid" }) })] }, `${item.sourceCode}-${item.code}-${index}`));
                                        }) })] }) })) })) : null, _jsxs(SectionCard, { title: "Create / Update Price Codes", children: [_jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { className: "btn-postman", type: "button", disabled: isSubmitting, onClick: () => {
                                            void createPriceCodes();
                                        }, children: isSubmitting ? "Processing..." : "Create / Update Price Codes" }), _jsx("button", { className: "btn-secondary btn-sm", type: "button", disabled: failedUploadCount === 0 || isSubmitting, onClick: () => {
                                            void retryFailedItems();
                                        }, children: "Retry Failed" })] }), (isSubmitting || uploadProgress > 0) && uploadProgressText ? (_jsx(ProgressBox, { title: uploadProgressText, progress: uploadProgress, subtitle: `${uploadProgress}% complete` })) : null] }), _jsx(SectionCard, { title: `Upload Results (${uploadResults.length})`, children: uploadResults.length === 0 ? (_jsx(EmptyText, { text: "No upload results yet." })) : (_jsx("div", { style: { overflowX: "auto", overflowY: "auto", maxHeight: "550px" }, children: _jsxs("table", { style: { width: "100%", borderCollapse: "collapse", minWidth: 1160 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { background: "rgba(255,255,255,0.04)" }, children: [_jsx("th", { style: thStyle, children: "#" }), _jsx("th", { style: thStyle, children: "Status" }), _jsx("th", { style: thStyle, children: "Mode" }), _jsx("th", { style: thStyle, children: "Source Code" }), _jsx("th", { style: thStyle, children: "Source Code ID Used" }), _jsx("th", { style: thStyle, children: "Code" }), _jsx("th", { style: thStyle, children: "Description" }), _jsx("th", { style: thStyle, children: "Error" })] }) }), _jsx("tbody", { children: uploadResults.map((result, index) => (_jsxs("tr", { style: {
                                                borderTop: "1px solid rgba(255,255,255,0.08)",
                                                background: result.success
                                                    ? "rgba(34,197,94,0.04)"
                                                    : "rgba(239,68,68,0.04)",
                                            }, children: [_jsx("td", { style: tdStyle, children: index + 1 }), _jsx("td", { style: tdStyle, children: _jsx("span", { style: {
                                                            display: "inline-flex",
                                                            padding: "4px 10px",
                                                            borderRadius: 999,
                                                            border: result.success
                                                                ? "1px solid rgba(34,197,94,0.25)"
                                                                : "1px solid rgba(239,68,68,0.25)",
                                                            background: result.success
                                                                ? "rgba(34,197,94,0.10)"
                                                                : "rgba(239,68,68,0.10)",
                                                            color: result.success ? "#86efac" : "#fca5a5",
                                                            fontSize: 12,
                                                            fontWeight: 700,
                                                        }, children: result.success ? "Success" : "Failed" }) }), _jsx("td", { style: tdStyle, children: result.mode || "—" }), _jsx("td", { style: tdMonoStyle, children: result.sourceCode || "Default" }), _jsx("td", { style: tdMonoStyle, children: result.sourceCodeIdUsed || "Default" }), _jsx("td", { style: tdMonoStyle, children: result.code }), _jsx("td", { style: tdStyle, children: result.description }), _jsx("td", { style: tdStyle, children: normalizeText(result.error) || "—" })] }, `${result.sourceCode}-${result.code}-${index}`))) })] }) })) })] })) : null] }));
};
const thStyle = {
    textAlign: "left",
    padding: "12px 10px",
    color: "#cbd5e1",
    fontSize: 12,
    fontWeight: 800,
    whiteSpace: "nowrap",
};
const tdStyle = {
    textAlign: "left",
    padding: "12px 10px",
    color: "#e2e8f0",
    fontSize: 13,
    verticalAlign: "top",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
};
const tdMonoStyle = {
    ...tdStyle,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};
const inputStyle = {
    width: "100%",
    minHeight: 42,
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 13,
    boxSizing: "border-box",
};
const labelStyle = {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 6,
};
const Pill = ({ label, value }) => (_jsxs("span", { style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        color: "#cbd5e1",
        fontSize: 12,
    }, children: [label, _jsx("b", { style: { color: "#f8fafc" }, children: value })] }));
const SectionCard = ({ title, children }) => {
    const [isExpanded, setIsExpanded] = useState(true);
    return (_jsxs("div", { style: {
            borderRadius: 18,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
            padding: 18,
            minWidth: 0,
        }, children: [_jsxs("div", { onClick: () => setIsExpanded(!isExpanded), style: {
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                    marginBottom: isExpanded ? 12 : 0,
                }, children: [_jsx("div", { style: {
                            fontSize: 18,
                            fontWeight: 800,
                            color: "#f8fafc",
                        }, children: title }), _jsx("button", { type: "button", style: {
                            border: "none",
                            background: "transparent",
                            color: "#94a3b8",
                            cursor: "pointer",
                            fontSize: 14,
                            padding: "4px",
                        }, title: isExpanded ? "Collapse section" : "Expand section", children: isExpanded ? "▲" : "▼" })] }), isExpanded && (_jsx("div", { style: {
                    display: "grid",
                    gap: 12,
                    maxHeight: "650px",
                    overflowY: "auto",
                    paddingRight: 4,
                }, children: children }))] }));
};
const EmptyText = ({ text }) => (_jsx("div", { style: {
        borderRadius: 14,
        border: "1px dashed rgba(148,163,184,0.30)",
        padding: 24,
        color: "#94a3b8",
        textAlign: "center",
    }, children: text }));
const LoadingBox = ({ text }) => (_jsx("div", { style: {
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.02)",
        padding: 24,
        color: "#cbd5e1",
        textAlign: "center",
    }, children: text }));
const ProgressBox = ({ title, progress, subtitle }) => (_jsxs("div", { style: {
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        padding: 14,
        marginTop: 8,
    }, children: [_jsx("div", { style: {
                color: "#e2e8f0",
                fontSize: 13,
                fontWeight: 700,
                marginBottom: 8,
            }, children: title }), _jsx("div", { style: {
                height: 10,
                width: "100%",
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
                overflow: "hidden",
            }, children: _jsx("div", { style: {
                    width: `${progress}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, #00B8CC 0%, #00D4E8 100%)",
                    transition: "width 200ms ease",
                } }) }), subtitle ? (_jsx("div", { style: { marginTop: 8, color: "#94a3b8", fontSize: 12 }, children: subtitle })) : null] }));
const ActionCard = ({ icon, title, description, buttonLabel, onClick }) => (_jsxs("div", { style: {
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        padding: 18,
        display: "grid",
        gap: 12,
    }, children: [_jsxs("div", { style: { display: "flex", gap: 12, alignItems: "flex-start" }, children: [_jsx("div", { style: {
                        width: 40,
                        height: 40,
                        borderRadius: 12,
                        display: "grid",
                        placeItems: "center",
                        background: "rgba(0,184,204,0.12)",
                        fontSize: 20,
                    }, children: icon }), _jsxs("div", { style: { minWidth: 0 }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 4 }, children: title }), _jsx("div", { style: { color: "#94a3b8", fontSize: 13, lineHeight: 1.6 }, children: description })] })] }), _jsx("button", { className: "btn-postman", type: "button", onClick: onClick, children: buttonLabel })] }));
const Field = ({ label, value, placeholder, hint, onChange }) => (_jsxs("div", { children: [_jsx("div", { style: labelStyle, children: label }), _jsx("input", { className: "st-input", type: "text", value: value, placeholder: placeholder, onChange: (e) => onChange(e.target.value), style: inputStyle }), hint ? (_jsx("div", { style: { color: "#94a3b8", fontSize: 12, marginTop: 6 }, children: hint })) : null] }));
const SourceCodeStatus = ({ resolution }) => {
    const good = resolution.matched && !resolution.usedDefaultFallback;
    const defaultMode = resolution.matched && resolution.matchedDisplayCode === "Default";
    const fallback = resolution.usedDefaultFallback;
    let color = "#86efac";
    let background = "rgba(34,197,94,0.10)";
    let border = "1px solid rgba(34,197,94,0.25)";
    let text = "✓ Matched";
    if (defaultMode) {
        color = "#93c5fd";
        background = "rgba(59,130,246,0.10)";
        border = "1px solid rgba(59,130,246,0.25)";
        text = "Default";
    }
    else if (fallback) {
        color = "#fde68a";
        background = "rgba(245,158,11,0.10)";
        border = "1px solid rgba(245,158,11,0.25)";
        text = "Fallback to Default";
    }
    else if (!good) {
        color = "#fca5a5";
        background = "rgba(239,68,68,0.10)";
        border = "1px solid rgba(239,68,68,0.25)";
        text = "Not matched";
    }
    return (_jsxs("div", { style: { display: "grid", gap: 4 }, children: [_jsx("span", { style: {
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    borderRadius: 999,
                    border,
                    background,
                    color,
                    fontSize: 12,
                    fontWeight: 700,
                    width: "fit-content",
                }, children: text }), _jsx("div", { style: { color: "#94a3b8", fontSize: 12 }, children: resolution.message })] }));
};
