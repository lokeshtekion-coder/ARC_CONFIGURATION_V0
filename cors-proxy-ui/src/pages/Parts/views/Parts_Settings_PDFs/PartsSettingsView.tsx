import React, { useEffect, useMemo, useState } from "react";
import { loadTekionApiSettingsBundle } from "../../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../../types/proxy.types";

const MODULE_NAME = "Parts Settings";
const PDF_CONFIGURATION_URL =
  "https://preprodapp.tekioncloud.com/api/partTrade/u/settings/part/general/pdfConfiguration";

const PDF_TYPES = [
  "SALES_ORDER_RETAIL_GENERAL_CUSTOMER",
  "SALES_ORDER_RETAIL_INVOICE_CUSTOMER",
  "SALES_ORDER_RETAIL_RETURN_CUSTOMER",
  "SALES_ORDER_INTERNAL_GENERAL_CUSTOMER",
  "SALES_ORDER_INTERNAL_INVOICE_CUSTOMER",
  "SALES_ORDER_INTERNAL_RETURN_CUSTOMER",
  "SALES_ORDER_WHOLESALE_GENERAL_CUSTOMER",
  "SALES_ORDER_WHOLESALE_INVOICE_CUSTOMER",
  "SALES_ORDER_WHOLESALE_RETURN_CUSTOMER",
] as const;

const logger = {
  debug: (...args: unknown[]) => console.debug("[Parts][PartsSettings]", ...args),
  info: (...args: unknown[]) => console.info("[Parts][PartsSettings]", ...args),
  warn: (...args: unknown[]) => console.warn("[Parts][PartsSettings]", ...args),
  error: (...args: unknown[]) => console.error("[Parts][PartsSettings]", ...args),
};

type RunState = "idle" | "loading" | "success" | "error" | "warning";

interface PdfRichTextBlock {
  key: string;
  text: string;
  type: "unstyled";
  depth: number;
  inlineStyleRanges: Array<{
    offset: number;
    length: number;
    style: "CUSTOM_FONT_SIZE_1rem";
  }>;
  entityRanges: unknown[];
  data: {
    blockStyle_lineHeight: number;
  };
}

interface PdfRichTextValue {
  blocks: PdfRichTextBlock[];
  entityMap: Record<string, unknown>;
}

interface PdfRichTextAreaItem {
  fieldName: "disclaimer" | "returnTerms";
  value: PdfRichTextValue;
  visible: true;
}

interface PdfConfigurationPayload {
  pdfRichTextAreas: PdfRichTextAreaItem[];
  pdfType: (typeof PDF_TYPES)[number];
  useGeneralSettings: false;
}

interface RequestResult {
  pdfType: string;
  success: boolean;
  error?: string;
  response?: unknown;
}

function normalizeText(value: unknown): string {
  return String(value ?? "");
}

function processEscapeSequences(text: string): string {
  return text.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");
}

function getEnabledGlobalHeaders(): Record<string, string> {
  const bundle = loadTekionApiSettingsBundle();

  const headers = (bundle.globalHeaders ?? [])
    .filter(
      (header: KeyValuePair) =>
        header.enabled && header.key.trim() && String(header.value).trim()
    )
    .reduce<Record<string, string>>((acc, header) => {
      acc[header.key] = String(header.value);
      return acc;
    }, {});

  logger.info("loaded global headers from settings", {
    count: Object.keys(headers).length,
    keys: Object.keys(headers),
  });

  return headers;
}

function buildRichTextValue(fieldKey: string, text: string): PdfRichTextValue {
  return {
    blocks: [
      {
        key: fieldKey,
        text,
        type: "unstyled",
        depth: 0,
        inlineStyleRanges:
          text.length > 0
            ? [
                {
                  offset: 0,
                  length: text.length,
                  style: "CUSTOM_FONT_SIZE_1rem",
                },
              ]
            : [],
        entityRanges: [],
        data: {
          blockStyle_lineHeight: 90,
        },
      },
    ],
    entityMap: {},
  };
}

function buildPayload(
  pdfType: (typeof PDF_TYPES)[number],
  warrantyText: string,
  returnTermsText: string
): PdfConfigurationPayload {
  const payload: PdfConfigurationPayload = {
    pdfRichTextAreas: [
      {
        fieldName: "disclaimer",
        value: buildRichTextValue("disclaimer", warrantyText),
        visible: true,
      },
      {
        fieldName: "returnTerms",
        value: buildRichTextValue("returnTerms", returnTermsText),
        visible: true,
      },
    ],
    pdfType,
    useGeneralSettings: false,
  };

  logger.debug("built payload", {
    pdfType,
    warrantyLength: warrantyText.length,
    returnTermsLength: returnTermsText.length,
    payloadPreview: payload,
  });

  return payload;
}

async function submitPdfConfiguration(
  payload: PdfConfigurationPayload,
  headers: Record<string, string>
): Promise<unknown> {
  const requestHeaders: Record<string, string> = { ...headers };

  delete requestHeaders["Content-Type"];
  delete requestHeaders["content-type"];
  delete requestHeaders["CONTENT-TYPE"];
  requestHeaders["content-type"] = "application/json";

  logger.info("POST pdf configuration started", {
    url: PDF_CONFIGURATION_URL,
    pdfType: payload.pdfType,
    headerKeys: Object.keys(requestHeaders),
    payloadSize: JSON.stringify(payload).length,
  });

  const response = await fetch(PDF_CONFIGURATION_URL, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(payload),
  });

  logger.info("POST pdf configuration response", {
    pdfType: payload.pdfType,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  });

  if (!response.ok) {
    const text = await response.text();

    logger.error("POST pdf configuration failed", {
      pdfType: payload.pdfType,
      status: response.status,
      body: text,
    });

    throw new Error(`HTTP ${response.status}: ${text.substring(0, 300)}`);
  }

  const json = await response.json();

  logger.debug("POST pdf configuration success response", {
    pdfType: payload.pdfType,
    response: json,
  });

  return json;
}

export const PartsSettingsView: React.FC = () => {
  const [warrantyText, setWarrantyText] = useState("");
  const [returnTermsText, setReturnTermsText] = useState("");
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState(
    "Ready to submit PDF configuration to all 9 PDF types"
  );
  const [errorText, setErrorText] = useState("");
  const [lastRunAt, setLastRunAt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [results, setResults] = useState<RequestResult[]>([]);
  const [showInfo, setShowInfo] = useState(false);

  useEffect(() => {
    logger.info("component mounted");
    logger.info("pdf types loaded", PDF_TYPES);
    return () => logger.info("component unmounted");
  }, []);

  const processedWarrantyText = useMemo(
    () => processEscapeSequences(warrantyText.trim()),
    [warrantyText]
  );

  const processedReturnTermsText = useMemo(
    () => processEscapeSequences(returnTermsText.trim()),
    [returnTermsText]
  );

  const warrantyCharCount = warrantyText.length;
  const returnTermsCharCount = returnTermsText.length;
  const totalLength = warrantyCharCount + returnTermsCharCount;
  const canSubmit = totalLength > 0 && !isSubmitting;
  const progressPercent = Math.round((progressCurrent / PDF_TYPES.length) * 100);

  const handleSubmit = async (): Promise<void> => {
    logger.info("submit button clicked");
    logger.info("submission input summary", {
      rawWarrantyLength: warrantyText.length,
      rawReturnTermsLength: returnTermsText.length,
      processedWarrantyLength: processedWarrantyText.length,
      processedReturnTermsLength: processedReturnTermsText.length,
      warrantyPreview: processedWarrantyText.substring(0, 100).replace(/\n/g, "\\n"),
      returnTermsPreview: processedReturnTermsText
        .substring(0, 100)
        .replace(/\n/g, "\\n"),
    });

    if (!processedWarrantyText && !processedReturnTermsText) {
      logger.warn("submission blocked because both inputs are empty");
      setRunState("warning");
      setStatusText("Enter Warranty or Return Terms before submitting");
      setErrorText("");
      return;
    }

    setIsSubmitting(true);
    setRunState("loading");
    setStatusText("Submitting PDF configuration to all PDF types...");
    setErrorText("");
    setResults([]);
    setProgressCurrent(0);

    try {
      const headers = getEnabledGlobalHeaders();

      if (Object.keys(headers).length === 0) {
        logger.warn("global headers missing before submit");
        setRunState("error");
        setStatusText("Global headers are missing");
        setErrorText(
          "No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers."
        );
        return;
      }

      const nextResults: RequestResult[] = [];

      for (let index = 0; index < PDF_TYPES.length; index += 1) {
        const pdfType = PDF_TYPES[index];
        const currentStep = index + 1;

        setProgressCurrent(currentStep);
        setStatusText(`Processing ${currentStep} / ${PDF_TYPES.length}: ${pdfType}`);

        const payload = buildPayload(
          pdfType,
          processedWarrantyText,
          processedReturnTermsText
        );

        if (index === 0) {
          logger.info("first payload sample", payload);
        }

        try {
          const response = await submitPdfConfiguration(payload, headers);
          nextResults.push({
            pdfType,
            success: true,
            response,
          });
          logger.info("pdf type submission succeeded", { pdfType, currentStep });
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          nextResults.push({
            pdfType,
            success: false,
            error: errorMessage,
          });
          logger.error("pdf type submission failed", {
            pdfType,
            currentStep,
            error: errorMessage,
          });
        }

        setResults([...nextResults]);
      }

      const successCount = nextResults.filter((item) => item.success).length;
      const failedResults = nextResults.filter((item) => !item.success);
      const failedCount = failedResults.length;

      logger.info("final submission summary", {
        successCount,
        failedCount,
        results: nextResults,
      });

      setLastRunAt(new Date().toLocaleString());

      if (failedCount === 0) {
        setRunState("success");
        setStatusText(
          `PDF configuration saved successfully for all ${successCount} PDF types`
        );
        setErrorText("");
        logger.info("all submissions succeeded, clearing form");
        setWarrantyText("");
        setReturnTermsText("");
      } else {
        setRunState("warning");
        setStatusText(
          `Completed with partial success. ${successCount} succeeded and ${failedCount} failed.`
        );
        setErrorText(
          failedResults
            .map((item) => `${item.pdfType}: ${item.error ?? "Unknown error"}`)
            .join("\n")
        );
      }
    } catch (error: unknown) {
      logger.error("submit flow failed unexpectedly", error);
      setRunState("error");
      setStatusText("Failed to save PDF configuration");
      setErrorText(error instanceof Error ? error.message : String(error));
      setLastRunAt(new Date().toLocaleString());
    } finally {
      setIsSubmitting(false);
    }
  };

  const successCount = results.filter((item) => item.success).length;
  const failedCount = results.filter((item) => !item.success).length;

  return (
    <div style={pageStyle}>
      <div style={mainCardStyle}>
        <div style={topBarStyle}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={titleStyle}>Parts settings</div>
            <div style={subtitleStyle}>
              Configure Warranty and Return Terms PDF settings for all 9 sales
              order PDF types using active Global Headers from Settings.
            </div>
          </div>

          <div style={topActionsStyle}>
            <button
              type="button"
              className="btn-secondary"
              aria-label={showInfo ? "Hide info" : "Show info"}
              title={showInfo ? "Hide info" : "Show info"}
              onClick={() => setShowInfo((prev) => !prev)}
              style={infoButtonStyle}
            >
              ℹ️
            </button>

            <button
              className="btn-postman"
              type="button"
              onClick={() => {
                void handleSubmit();
              }}
              disabled={!canSubmit}
              style={submitButtonStyle}
            >
              {isSubmitting ? "Processing..." : "Submit to All PDF Types"}
            </button>
          </div>
        </div>

        <div style={primaryStackStyle}>
          <div style={editorCardStyle}>
            <div style={editorHeaderStyle}>
              <div style={{ minWidth: 0 }}>
                <div style={editorTitleStyle}>Warranty</div>
                <div style={editorSubStyle}>
                  Primary input area for disclaimer/warranty content.
                </div>
              </div>
              <div style={counterBadgeStyle}>{warrantyCharCount} / 2000</div>
            </div>

            <textarea
              className="st-input"
              rows={14}
              maxLength={2000}
              value={warrantyText}
              onChange={(e) => {
                logger.debug("warranty input changed", { length: e.target.value.length });
                setWarrantyText(e.target.value);
              }}
              placeholder="Enter warranty text..."
              style={textareaStyle}
            />

            <div style={editorFooterStyle}>
              <span style={helperTextStyle}>Supports \n \t \r escape processing</span>
              <span style={processedCountStyle}>
                {processedWarrantyText.length} processed chars
              </span>
            </div>
          </div>

          <div style={editorCardStyle}>
            <div style={editorHeaderStyle}>
              <div style={{ minWidth: 0 }}>
                <div style={editorTitleStyle}>Return Terms</div>
                <div style={editorSubStyle}>
                  Primary input area for return terms content.
                </div>
              </div>
              <div style={counterBadgeStyle}>{returnTermsCharCount} / 2000</div>
            </div>

            <textarea
              className="st-input"
              rows={14}
              maxLength={2000}
              value={returnTermsText}
              onChange={(e) => {
                logger.debug("return terms input changed", {
                  length: e.target.value.length,
                });
                setReturnTermsText(e.target.value);
              }}
              placeholder="Enter return terms..."
              style={textareaStyle}
            />

            <div style={editorFooterStyle}>
              <span style={helperTextStyle}>Supports \n \t \r escape processing</span>
              <span style={processedCountStyle}>
                {processedReturnTermsText.length} processed chars
              </span>
            </div>
          </div>
        </div>

        {(isSubmitting || progressCurrent > 0) && (
          <div style={progressCardStyle}>
            <div style={progressHeaderStyle}>
              <span style={progressTitleStyle}>
                Processing {progressCurrent} / {PDF_TYPES.length}
              </span>
              <span style={progressPercentStyle}>{progressPercent}%</span>
            </div>

            <div style={progressTrackStyle}>
              <div
                style={{
                  ...progressFillStyle,
                  width: `${progressPercent}%`,
                }}
              />
            </div>

            <div style={progressMetaStyle}>{statusText}</div>
          </div>
        )}

        <div
          style={{
            ...statusCardStyle,
            ...(runState === "error"
              ? statusErrorStyle
              : runState === "success"
              ? statusSuccessStyle
              : runState === "warning"
              ? statusWarningStyle
              : statusIdleStyle),
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: errorText ? 6 : 0 }}>
            {statusText}
          </div>
          {errorText ? <div>{errorText}</div> : null}
        </div>
      </div>

      {showInfo ? (
        <div style={infoPanelStyle}>
          <div style={infoPanelHeaderStyle}>
            <div>
              <div style={infoPanelTitleStyle}>Information</div>
              <div style={infoPanelSubStyle}>
                Secondary details, previews, API info, and submission results.
              </div>
            </div>
          </div>

          <div style={pillWrapStyle}>
            <Pill label="Module" value={MODULE_NAME} />
            <Pill label="PDF Types" value={String(PDF_TYPES.length)} />
            <Pill label="Warranty Length" value={String(processedWarrantyText.length)} />
            <Pill
              label="Return Terms Length"
              value={String(processedReturnTermsText.length)}
            />
            {lastRunAt ? <Pill label="Last Run" value={lastRunAt} /> : null}
          </div>

          <div style={infoGridStyle}>
            <SectionCard title="PDF Types To Be Updated">
              {PDF_TYPES.map((pdfType, index) => {
                const matched = results.find((item) => item.pdfType === pdfType);

                return (
                  <RowLine
                    key={pdfType}
                    left={`${index + 1}. ${pdfType}`}
                    right={
                      matched?.success
                        ? "Success"
                        : matched?.success === false
                        ? "Failed"
                        : "Pending"
                    }
                    rightColor={
                      matched?.success
                        ? "#86efac"
                        : matched?.success === false
                        ? "#fca5a5"
                        : "#cbd5e1"
                    }
                  />
                );
              })}
            </SectionCard>

            <SectionCard title="Processed Input Preview">
              <RowLine
                left="Warranty Characters"
                right={String(processedWarrantyText.length)}
              />
              <RowLine
                left="Return Terms Characters"
                right={String(processedReturnTermsText.length)}
              />
              <RowLine
                left="Warranty Preview"
                right={
                  processedWarrantyText
                    ? processedWarrantyText.slice(0, 60).replace(/\n/g, "\\n")
                    : "—"
                }
              />
              <RowLine
                left="Return Terms Preview"
                right={
                  processedReturnTermsText
                    ? processedReturnTermsText.slice(0, 60).replace(/\n/g, "\\n")
                    : "—"
                }
              />
            </SectionCard>

            <SectionCard title="Write API Info">
              <RowLine left="Method" right="POST" rightColor="#86efac" />
              <RowLine left="Endpoint" right={PDF_CONFIGURATION_URL} />
              <RowLine left="Mode" right="Submit to all 9 PDF types sequentially" />
              <RowLine left="PUT Available in reference?" right="No" rightColor="#fca5a5" />
            </SectionCard>
          </div>

          <div style={resultsCardStyle}>
            <div style={resultsHeaderStyle}>
              <div>
                <div style={resultsTitleStyle}>Submission Results</div>
                <div style={resultsSubStyle}>
                  Detailed result info shown only when info is opened.
                </div>
              </div>

              {results.length > 0 ? (
                <div style={resultsSummaryStyle}>
                  <span style={resultsSummarySuccessStyle}>Success {successCount}</span>
                  <span style={resultsSummaryFailStyle}>Failed {failedCount}</span>
                </div>
              ) : null}
            </div>

            {results.length === 0 ? (
              <div style={emptyResultsStyle}>
                No submissions yet. Fill Warranty and/or Return Terms, then click
                Submit.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: 900,
                  }}
                >
                  <thead>
                    <tr style={{ background: "rgba(255,255,255,0.04)" }}>
                      <th style={thStyle}>#</th>
                      <th style={thStyle}>PDF Type</th>
                      <th style={thStyle}>Status</th>
                      <th style={thStyle}>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((result, index) => (
                      <tr
                        key={`${result.pdfType}-${index}`}
                        style={{
                          borderTop: "1px solid rgba(255,255,255,0.08)",
                          background: result.success
                            ? "rgba(34,197,94,0.04)"
                            : "rgba(239,68,68,0.04)",
                        }}
                      >
                        <td style={tdStyle}>{index + 1}</td>
                        <td style={tdMonoStyle}>{result.pdfType}</td>
                        <td style={tdStyle}>
                          <span
                            style={{
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
                            }}
                          >
                            {result.success ? "Success" : "Failed"}
                          </span>
                        </td>
                        <td style={tdStyle}>{normalizeText(result.error) || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const pageStyle: React.CSSProperties = {
  display: "grid",
  gap: 16,
  width: "100%",
};

const mainCardStyle: React.CSSProperties = {
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,0.08)",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.025) 100%)",
  padding: 20,
};

const topBarStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  flexWrap: "wrap",
  marginBottom: 18,
};

const titleStyle: React.CSSProperties = {
  fontSize: 26,
  fontWeight: 800,
  color: "#f8fafc",
  marginBottom: 6,
  wordBreak: "break-word",
};

const subtitleStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 14,
  lineHeight: 1.7,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  maxWidth: 900,
};

const topActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const infoButtonStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  minWidth: 42,
  borderRadius: 999,
  padding: 0,
  fontSize: 18,
  fontWeight: 700,
};

const submitButtonStyle: React.CSSProperties = {
  minWidth: 220,
};

const primaryStackStyle: React.CSSProperties = {
  display: "grid",
  gap: 16,
  marginBottom: 16,
};

const editorCardStyle: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(15,23,42,0.45)",
  padding: 16,
  minWidth: 0,
  boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
};

const editorHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 12,
};

const editorTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  color: "#f8fafc",
  marginBottom: 4,
};

const editorSubStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#94a3b8",
  lineHeight: 1.6,
};

const counterBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.04)",
  color: "#cbd5e1",
  fontSize: 12,
  fontWeight: 700,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 280,
  borderRadius: 14,
  padding: "14px 16px",
  fontSize: 14,
  boxSizing: "border-box",
  resize: "vertical",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  lineHeight: 1.7,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.10)",
  color: "#f8fafc",
};

const editorFooterStyle: React.CSSProperties = {
  marginTop: 10,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const helperTextStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 12,
};

const processedCountStyle: React.CSSProperties = {
  color: "#cbd5e1",
  fontSize: 12,
  fontWeight: 700,
};

const progressCardStyle: React.CSSProperties = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  padding: 14,
  marginBottom: 14,
};

const progressHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginBottom: 8,
  flexWrap: "wrap",
};

const progressTitleStyle: React.CSSProperties = {
  color: "#e2e8f0",
  fontSize: 13,
  fontWeight: 700,
};

const progressPercentStyle: React.CSSProperties = {
  color: "#93c5fd",
  fontSize: 12,
  fontWeight: 700,
};

const progressTrackStyle: React.CSSProperties = {
  height: 10,
  width: "100%",
  borderRadius: 999,
  background: "rgba(255,255,255,0.08)",
  overflow: "hidden",
};

const progressFillStyle: React.CSSProperties = {
  height: "100%",
  background: "linear-gradient(90deg, #0a84ff 0%, #30d158 100%)",
  transition: "width 200ms ease",
};

const progressMetaStyle: React.CSSProperties = {
  marginTop: 8,
  color: "#94a3b8",
  fontSize: 12,
};

const statusCardStyle: React.CSSProperties = {
  borderRadius: 14,
  padding: "12px 14px",
  fontSize: 13,
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const statusIdleStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  color: "#cbd5e1",
};

const statusSuccessStyle: React.CSSProperties = {
  border: "1px solid rgba(34,197,94,0.25)",
  background: "rgba(34,197,94,0.10)",
  color: "#bbf7d0",
};

const statusWarningStyle: React.CSSProperties = {
  border: "1px solid rgba(245,158,11,0.25)",
  background: "rgba(245,158,11,0.10)",
  color: "#fde68a",
};

const statusErrorStyle: React.CSSProperties = {
  border: "1px solid rgba(239,68,68,0.25)",
  background: "rgba(239,68,68,0.10)",
  color: "#fecaca",
};

const infoPanelStyle: React.CSSProperties = {
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  padding: 18,
  display: "grid",
  gap: 16,
};

const infoPanelHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexWrap: "wrap",
};

const infoPanelTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  color: "#f8fafc",
  marginBottom: 4,
};

const infoPanelSubStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#94a3b8",
};

const pillWrapStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const infoGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: 16,
};

const resultsCardStyle: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  padding: 18,
};

const resultsHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 12,
};

const resultsTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  color: "#f8fafc",
  marginBottom: 4,
};

const resultsSubStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#94a3b8",
};

const resultsSummaryStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const resultsSummarySuccessStyle: React.CSSProperties = {
  display: "inline-flex",
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(34,197,94,0.25)",
  background: "rgba(34,197,94,0.10)",
  color: "#86efac",
  fontSize: 12,
  fontWeight: 700,
};

const resultsSummaryFailStyle: React.CSSProperties = {
  display: "inline-flex",
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(239,68,68,0.25)",
  background: "rgba(239,68,68,0.10)",
  color: "#fca5a5",
  fontSize: 12,
  fontWeight: 700,
};

const emptyResultsStyle: React.CSSProperties = {
  borderRadius: 14,
  border: "1px dashed rgba(148,163,184,0.30)",
  padding: 24,
  color: "#94a3b8",
  textAlign: "center",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 10px",
  color: "#cbd5e1",
  fontSize: 12,
  fontWeight: 800,
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "12px 10px",
  color: "#e2e8f0",
  fontSize: 13,
  verticalAlign: "top",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const tdMonoStyle: React.CSSProperties = {
  ...tdStyle,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

const Pill: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        color: "#cbd5e1",
        fontSize: 12,
        maxWidth: "100%",
        flexWrap: "wrap",
      }}
    >
      {label} <b style={{ color: "#f8fafc", wordBreak: "break-word" }}>{value}</b>
    </span>
  );
};

const SectionCard: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => {
  return (
    <div
      style={{
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        padding: 16,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 16,
          fontWeight: 800,
          color: "#f8fafc",
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      <div style={{ display: "grid", gap: 8 }}>{children}</div>
    </div>
  );
};

const RowLine: React.FC<{
  left: string;
  right: string;
  rightColor?: string;
}> = ({ left, right, rightColor = "#cbd5e1" }) => {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        alignItems: "flex-start",
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.02)",
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          color: "#e2e8f0",
          fontSize: 13,
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          maxWidth: "100%",
        }}
      >
        {left}
      </div>
      <div
        style={{
          color: rightColor,
          fontSize: 12,
          fontWeight: 700,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          textAlign: "right",
          maxWidth: "100%",
        }}
      >
        {right}
      </div>
    </div>
  );
};

export default PartsSettingsView;
