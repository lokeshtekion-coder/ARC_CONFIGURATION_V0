import React, { useCallback, useEffect, useMemo, useState } from "react";
import { loadTekionApiSettingsBundle } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";

type BucketKey =
  | "trueIncrease"
  | "trueDecrease"
  | "falseIncrease"
  | "falseDecrease";

type RunState = "idle" | "loading" | "success" | "warning" | "error";

type AdjustmentType = "INCREASE" | "DECREASE" | string;
type AdjustmentStatus = "ACTIVE" | "INACTIVE" | string;

interface AdjustmentReasonRecord {
  id?: string;
  reason?: string;
  type?: AdjustmentType;
  glAccountPosting?: boolean | null;
  status?: AdjustmentStatus;
  physicalInventoryReasonType?: string | null;
  [key: string]: unknown;
}

interface AdjustmentReasonsApiResponse {
  status?: string;
  data?: AdjustmentReasonRecord[];
  message?: string;
  [key: string]: unknown;
}

interface BucketSpec {
  key: BucketKey;
  label: string;
  expectedReason: string;
  glPosting: boolean;
  type: "INCREASE" | "DECREASE";
}

interface BucketCustomization {
  aliases: string[];
  excluded: string[];
}

interface ValidationBucketResult {
  spec: BucketSpec;
  matchedItems: AdjustmentReasonRecord[];
  eligibleItems: AdjustmentReasonRecord[];
  excludedItems: AdjustmentReasonRecord[];
  hasMatch: boolean;
  preferredItem: AdjustmentReasonRecord | null;
}

interface ValidationResult {
  isValid: boolean;
  totalItems: number;
  activeItems: number;
  buckets: Record<BucketKey, ValidationBucketResult>;
  uncategorizedActiveItems: AdjustmentReasonRecord[];
  duplicateSummary: Array<{
    bucket: BucketKey;
    count: number;
    reasons: string[];
  }>;
}

const STORAGE_KEY = "parts_adjustment_reasons_config_v1";
const API_URL =
  "https://preprodapp.tekioncloud.com/api/parts/proxy/u/settings/adjustments/reasons";

const DEFAULT_BUCKET_SPECS: BucketSpec[] = [
  {
    key: "trueIncrease",
    label: "TRUE + Increase",
    expectedReason: "Bin Check Increase",
    glPosting: true,
    type: "INCREASE",
  },
  {
    key: "trueDecrease",
    label: "TRUE + Decrease",
    expectedReason: "Bin Check Decrease",
    glPosting: true,
    type: "DECREASE",
  },
  {
    key: "falseIncrease",
    label: "FALSE + Increase",
    expectedReason: "Bin Check (+)",
    glPosting: false,
    type: "INCREASE",
  },
  {
    key: "falseDecrease",
    label: "FALSE + Decrease",
    expectedReason: "Bin Check (–)",
    glPosting: false,
    type: "DECREASE",
  },
];

const DEFAULT_CUSTOMIZATION: Record<BucketKey, BucketCustomization> = {
  trueIncrease: {
    aliases: ["Physical Inventory (+)", "Core Increase"],
    excluded: [],
  },
  trueDecrease: {
    aliases: ["Physical Inventory (–)", "Physical Inventory (-)", "Core Decrease"],
    excluded: [],
  },
  falseIncrease: {
    aliases: ["Core +"],
    excluded: [],
  },
  falseDecrease: {
    aliases: ["Bin Check (-)", "Core -"],
    excluded: [],
  },
};

const logger = {
  debug: (...args: unknown[]) => console.debug("[Parts][AdjustmentReasons]", ...args),
  info: (...args: unknown[]) => console.info("[Parts][AdjustmentReasons]", ...args),
  warn: (...args: unknown[]) => console.warn("[Parts][AdjustmentReasons]", ...args),
  error: (...args: unknown[]) => console.error("[Parts][AdjustmentReasons]", ...args),
};

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeReason(value: unknown): string {
  return String(value ?? "").trim();
}

function loadHeadersFromSettings(): Record<string, string> {
  const bundle = loadTekionApiSettingsBundle();

  const headers = (bundle.globalHeaders ?? [])
    .filter((header: KeyValuePair) => header.enabled && header.key.trim())
    .reduce<Record<string, string>>((acc, header) => {
      acc[header.key] = String(header.value ?? "");
      return acc;
    }, {});

  headers.accept = headers.accept || "application/json, text/plain, */*";
  headers["content-type"] = headers["content-type"] || "application/json";

  logger.info("loaded global headers", {
    count: Object.keys(headers).length,
    keys: Object.keys(headers),
  });

  return headers;
}

function loadSavedCustomization(): Record<BucketKey, BucketCustomization> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CUSTOMIZATION;

    const parsed = JSON.parse(raw) as Partial<Record<BucketKey, BucketCustomization>>;
    return {
      trueIncrease: {
        aliases: parsed.trueIncrease?.aliases ?? DEFAULT_CUSTOMIZATION.trueIncrease.aliases,
        excluded: parsed.trueIncrease?.excluded ?? DEFAULT_CUSTOMIZATION.trueIncrease.excluded,
      },
      trueDecrease: {
        aliases: parsed.trueDecrease?.aliases ?? DEFAULT_CUSTOMIZATION.trueDecrease.aliases,
        excluded: parsed.trueDecrease?.excluded ?? DEFAULT_CUSTOMIZATION.trueDecrease.excluded,
      },
      falseIncrease: {
        aliases: parsed.falseIncrease?.aliases ?? DEFAULT_CUSTOMIZATION.falseIncrease.aliases,
        excluded: parsed.falseIncrease?.excluded ?? DEFAULT_CUSTOMIZATION.falseIncrease.excluded,
      },
      falseDecrease: {
        aliases: parsed.falseDecrease?.aliases ?? DEFAULT_CUSTOMIZATION.falseDecrease.aliases,
        excluded: parsed.falseDecrease?.excluded ?? DEFAULT_CUSTOMIZATION.falseDecrease.excluded,
      },
    };
  } catch (error) {
    logger.warn("failed to load saved customization, using defaults", error);
    return DEFAULT_CUSTOMIZATION;
  }
}

function saveCustomization(config: Record<BucketKey, BucketCustomization>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    logger.info("saved customization to localStorage");
  } catch (error) {
    logger.warn("failed to save customization", error);
  }
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  logger.debug("raw response text", text);

  try {
    return text ? (JSON.parse(text) as T) : ({} as T);
  } catch (error) {
    logger.error("failed to parse response json", error);
    throw new Error(`Non-JSON response received: ${text.slice(0, 300)}`);
  }
}

async function fetchAdjustmentReasons(): Promise<AdjustmentReasonRecord[]> {
  const headers = loadHeadersFromSettings();

  if (Object.keys(headers).length === 0) {
    throw new Error("No active global headers found. Please configure headers in Settings.");
  }

  logger.info("fetching adjustment reasons", { url: API_URL });

  const response = await fetch(API_URL, {
    method: "GET",
    headers,
  });

  logger.info("adjustment reasons response received", {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
  });

  const json = await parseJsonResponse<AdjustmentReasonsApiResponse>(response);
  logger.debug("parsed adjustment reasons response", json);

  if (!response.ok) {
    throw new Error(json?.message || `HTTP ${response.status}`);
  }

  const rows = Array.isArray(json.data) ? json.data : [];
  logger.info("adjustment reasons rows fetched", { count: rows.length });

  return rows;
}

function buildValidationResult(
  records: AdjustmentReasonRecord[],
  customization: Record<BucketKey, BucketCustomization>
): ValidationResult {
  const activeItems = records.filter((item) => normalize(item.status || "ACTIVE") !== "inactive");

  const buckets = DEFAULT_BUCKET_SPECS.reduce<Record<BucketKey, ValidationBucketResult>>(
    (acc, spec) => {
      const custom = customization[spec.key];
      const acceptedNames = [spec.expectedReason, ...(custom?.aliases ?? [])]
        .map(normalizeReason)
        .filter(Boolean);

      const excludedNames = new Set((custom?.excluded ?? []).map(normalize));

      const eligibleItems = activeItems.filter(
        (item) =>
          item.type === spec.type &&
          Boolean(item.glAccountPosting) === spec.glPosting
      );

      const excludedItems = eligibleItems.filter((item) =>
        excludedNames.has(normalize(item.reason))
      );

      const matchedItems = eligibleItems.filter((item) => {
        const itemReason = normalizeReason(item.reason);
        const isAccepted = acceptedNames.some(
          (candidate) => normalize(candidate) === normalize(itemReason)
        );
        const isExcluded = excludedNames.has(normalize(itemReason));
        return isAccepted && !isExcluded;
      });

      const preferredItem =
        matchedItems.find(
          (item) => normalize(item.reason) === normalize(spec.expectedReason)
        ) ||
        matchedItems[0] ||
        (eligibleItems.length === 1 && excludedItems.length === 0 ? eligibleItems[0] : null);

      acc[spec.key] = {
        spec,
        matchedItems,
        eligibleItems,
        excludedItems,
        hasMatch: Boolean(preferredItem),
        preferredItem,
      };

      return acc;
    },
    {} as Record<BucketKey, ValidationBucketResult>
  );

  const bucketEligibleIds = new Set(
    Object.values(buckets)
      .flatMap((bucket) => bucket.eligibleItems)
      .map((item) => item.id || `${item.reason}-${item.type}-${String(item.glAccountPosting)}`)
  );

  const uncategorizedActiveItems = activeItems.filter((item) => {
    const key = item.id || `${item.reason}-${item.type}-${String(item.glAccountPosting)}`;
    return !bucketEligibleIds.has(key);
  });

  const duplicateSummary = Object.values(buckets)
    .filter((bucket) => bucket.eligibleItems.length > 1)
    .map((bucket) => ({
      bucket: bucket.spec.key,
      count: bucket.eligibleItems.length,
      reasons: bucket.eligibleItems.map((item) => normalizeReason(item.reason) || "Unnamed"),
    }));

  const hasAllFour = Object.values(buckets).every((bucket) => bucket.hasMatch);
  const isValid = hasAllFour && activeItems.length === 4;

  logger.info("validation summary", {
    isValid,
    hasAllFour,
    activeItems: activeItems.length,
    duplicateBuckets: duplicateSummary.length,
    uncategorizedActiveItems: uncategorizedActiveItems.length,
  });

  return {
    isValid,
    totalItems: records.length,
    activeItems: activeItems.length,
    buckets,
    uncategorizedActiveItems,
    duplicateSummary,
  };
}

function formatBool(value: boolean | null | undefined): string {
  if (value === true) return "TRUE";
  if (value === false) return "FALSE";
  return "—";
}

function getStatusColors(runState: RunState): React.CSSProperties {
  if (runState === "error") {
    return {
      border: "1px solid rgba(239,68,68,0.25)",
      background: "rgba(239,68,68,0.10)",
      color: "#fecaca",
    };
  }
  if (runState === "success") {
    return {
      border: "1px solid rgba(34,197,94,0.25)",
      background: "rgba(34,197,94,0.10)",
      color: "#bbf7d0",
    };
  }
  if (runState === "warning") {
    return {
      border: "1px solid rgba(245,158,11,0.25)",
      background: "rgba(245,158,11,0.10)",
      color: "#fde68a",
    };
  }
  return {
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    color: "#cbd5e1",
  };
}

function isRecordAcceptedForBucket(
  item: AdjustmentReasonRecord,
  spec: BucketSpec,
  custom: BucketCustomization
): boolean {
  if (item.type !== spec.type) return false;
  if (Boolean(item.glAccountPosting) !== spec.glPosting) return false;

  const reason = normalize(item.reason);
  if (!reason) return false;

  const excluded = new Set(custom.excluded.map(normalize));
  if (excluded.has(reason)) return false;

  const acceptedNames = [spec.expectedReason, ...custom.aliases].map(normalize);
  return acceptedNames.includes(reason);
}

async function updateAdjustmentReasonStatus(
  id: string,
  adjustmentStatus: "INACTIVE",
  headers: Record<string, string>
): Promise<void> {
  const url = `${API_URL}/${id}`;

  logger.info("sending status update", {
    url,
    adjustmentStatus,
    id,
  });

  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify({ adjustmentStatus }),
  });

  logger.info("status update response", {
    id,
    status: response.status,
    ok: response.ok,
  });

  const json = await parseJsonResponse<AdjustmentReasonsApiResponse>(response);

  if (!response.ok) {
    throw new Error(json?.message || `Failed to update record ${id}: HTTP ${response.status}`);
  }
}

async function createAdjustmentReason(
  payload: {
    reason: string;
    type: "INCREASE" | "DECREASE";
    glAccountPosting: boolean;
    physicalInventoryReasonType: null;
  },
  headers: Record<string, string>
): Promise<void> {
  logger.info("creating missing adjustment reason", payload);

  const response = await fetch(API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  logger.info("create response", {
    status: response.status,
    ok: response.ok,
    payload,
  });

  const json = await parseJsonResponse<AdjustmentReasonsApiResponse>(response);

  if (!response.ok) {
    throw new Error(json?.message || `Failed to create "${payload.reason}": HTTP ${response.status}`);
  }
}

export const AdjustmentReasonsView: React.FC = () => {
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready");
  const [errorText, setErrorText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isFixing, setIsFixing] = useState(false);

  const [records, setRecords] = useState<AdjustmentReasonRecord[]>([]);
  const [customization, setCustomization] = useState<Record<BucketKey, BucketCustomization>>(
    () => loadSavedCustomization()
  );

  const [aliasInput, setAliasInput] = useState<Record<BucketKey, string>>({
    trueIncrease: "",
    trueDecrease: "",
    falseIncrease: "",
    falseDecrease: "",
  });

  const [excludedInput, setExcludedInput] = useState<Record<BucketKey, string>>({
    trueIncrease: "",
    trueDecrease: "",
    falseIncrease: "",
    falseDecrease: "",
  });

  useEffect(() => {
    logger.info("AdjustmentReasonsView mounted");
    return () => logger.info("AdjustmentReasonsView unmounted");
  }, []);

  useEffect(() => {
    saveCustomization(customization);
  }, [customization]);

  const validation = useMemo(
    () => buildValidationResult(records, customization),
    [records, customization]
  );

  const handleFetch = useCallback(async () => {
    logger.info("fetch requested");

    setIsLoading(true);
    setRunState("loading");
    setStatusText("Fetching adjustment reasons...");
    setErrorText("");

    try {
      const rows = await fetchAdjustmentReasons();
      setRecords(rows);

      const nextValidation = buildValidationResult(rows, customization);

      if (nextValidation.isValid) {
        setRunState("success");
        setStatusText(`Loaded ${rows.length} rows. Adjustment reasons are valid.`);
      } else {
        setRunState("warning");
        setStatusText(`Loaded ${rows.length} rows. Validation issues detected.`);
      }
    } catch (error: unknown) {
      logger.error("fetch failed", error);
      setRunState("error");
      setStatusText("Failed to fetch adjustment reasons");
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [customization]);

  const handleAutoFix = useCallback(async () => {
    logger.info("auto-fix requested");

    setIsFixing(true);
    setRunState("loading");
    setStatusText("Auto-fix in progress...");
    setErrorText("");

    try {
      const headers = loadHeadersFromSettings();
      const latestRows = await fetchAdjustmentReasons();

      const activeRows = latestRows.filter(
        (item) => normalize(item.status || "ACTIVE") !== "inactive"
      );

      const idsToInactivate = new Set<string>();
      const specsByKey = Object.fromEntries(
        DEFAULT_BUCKET_SPECS.map((spec) => [spec.key, spec])
      ) as Record<BucketKey, BucketSpec>;

      for (const bucketKey of Object.keys(specsByKey) as BucketKey[]) {
        const spec = specsByKey[bucketKey];
        const custom = customization[bucketKey];

        const eligible = activeRows.filter(
          (item) =>
            item.type === spec.type &&
            Boolean(item.glAccountPosting) === spec.glPosting
        );

        const excluded = eligible.filter((item) =>
          custom.excluded.map(normalize).includes(normalize(item.reason))
        );

        excluded.forEach((item) => {
          if (item.id) idsToInactivate.add(item.id);
        });

        const accepted = eligible.filter((item) =>
          isRecordAcceptedForBucket(item, spec, custom)
        );

        const preferred =
          accepted.find((item) => normalize(item.reason) === normalize(spec.expectedReason)) ||
          accepted[0] ||
          null;

        for (const item of eligible) {
          if (!item.id) continue;
          if (excluded.some((x) => x.id === item.id)) continue;
          if (preferred && item.id === preferred.id) continue;

          const isAccepted = accepted.some((x) => x.id === item.id);
          if (isAccepted || !isAccepted) {
            idsToInactivate.add(item.id);
          }
        }
      }

      logger.info("records to inactivate", { count: idsToInactivate.size, ids: [...idsToInactivate] });

      for (const id of idsToInactivate) {
        await updateAdjustmentReasonStatus(id, "INACTIVE", headers);
      }

      const rowsAfterInactivate = await fetchAdjustmentReasons();
      const activeAfterInactivate = rowsAfterInactivate.filter(
        (item) => normalize(item.status || "ACTIVE") !== "inactive"
      );

      for (const spec of DEFAULT_BUCKET_SPECS) {
        const custom = customization[spec.key];
        const hasAcceptedActive = activeAfterInactivate.some((item) =>
          isRecordAcceptedForBucket(item, spec, custom)
        );

        if (!hasAcceptedActive) {
          await createAdjustmentReason(
            {
              reason: spec.expectedReason,
              type: spec.type,
              glAccountPosting: spec.glPosting,
              physicalInventoryReasonType: null,
            },
            headers
          );
        }
      }

      const refreshed = await fetchAdjustmentReasons();
      setRecords(refreshed);

      const nextValidation = buildValidationResult(refreshed, customization);

      if (nextValidation.isValid) {
        setRunState("success");
        setStatusText("Auto-fix completed successfully. All required adjustment reasons are valid.");
      } else {
        setRunState("warning");
        setStatusText("Auto-fix completed, but validation still shows issues. Please review remaining records.");
      }
    } catch (error: unknown) {
      logger.error("auto-fix failed", error);
      setRunState("error");
      setStatusText("Auto-fix failed");
      setErrorText(error instanceof Error ? error.message : String(error));
    } finally {
      setIsFixing(false);
    }
  }, [customization]);

  const updateCustomization = useCallback(
    (bucket: BucketKey, next: BucketCustomization) => {
      setCustomization((prev) => ({
        ...prev,
        [bucket]: {
          aliases: [...new Set(next.aliases.map((x) => x.trim()).filter(Boolean))],
          excluded: [...new Set(next.excluded.map((x) => x.trim()).filter(Boolean))],
        },
      }));
    },
    []
  );

  const addAlias = useCallback(
    (bucket: BucketKey) => {
      const value = aliasInput[bucket].trim();
      if (!value) return;

      const current = customization[bucket];
      updateCustomization(bucket, {
        ...current,
        aliases: [...current.aliases, value],
      });

      setAliasInput((prev) => ({ ...prev, [bucket]: "" }));
    },
    [aliasInput, customization, updateCustomization]
  );

  const addExcluded = useCallback(
    (bucket: BucketKey) => {
      const value = excludedInput[bucket].trim();
      if (!value) return;

      const current = customization[bucket];
      updateCustomization(bucket, {
        ...current,
        excluded: [...current.excluded, value],
      });

      setExcludedInput((prev) => ({ ...prev, [bucket]: "" }));
    },
    [excludedInput, customization, updateCustomization]
  );

  const removeAlias = useCallback(
    (bucket: BucketKey, value: string) => {
      const current = customization[bucket];
      updateCustomization(bucket, {
        ...current,
        aliases: current.aliases.filter((item) => item !== value),
      });
    },
    [customization, updateCustomization]
  );

  const removeExcluded = useCallback(
    (bucket: BucketKey, value: string) => {
      const current = customization[bucket];
      updateCustomization(bucket, {
        ...current,
        excluded: current.excluded.filter((item) => item !== value),
      });
    },
    [customization, updateCustomization]
  );

  const resetCustomization = useCallback(() => {
    setCustomization(DEFAULT_CUSTOMIZATION);
    setAliasInput({
      trueIncrease: "",
      trueDecrease: "",
      falseIncrease: "",
      falseDecrease: "",
    });
    setExcludedInput({
      trueIncrease: "",
      trueDecrease: "",
      falseIncrease: "",
      falseDecrease: "",
    });
  }, []);

  const statusStyle = getStatusColors(runState);

  return (
    <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
      <div
        style={{
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.03)",
          padding: 20,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexWrap: "wrap",
            marginBottom: 12,
          }}
        >
          <div>
            <div style={{ color: "#f8fafc", fontSize: 24, fontWeight: 800, marginBottom: 6 }}>
              Adjustment Reasons
            </div>
            <div style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.7 }}>
              Fetch, validate, exclude, and auto-fix parts adjustment reasons.
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-secondary btn-sm" type="button" onClick={resetCustomization}>
              Reset Custom Rules
            </button>
            <button
              className="btn-secondary btn-sm"
              type="button"
              onClick={() => void handleAutoFix()}
              disabled={isLoading || isFixing}
            >
              {isFixing ? "Fixing..." : "Auto Fix"}
            </button>
            <button
              className="btn-postman"
              type="button"
              onClick={() => void handleFetch()}
              disabled={isLoading || isFixing}
            >
              {isLoading ? "Fetching..." : "Send"}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <Pill label="Total Rows" value={String(records.length)} />
          <Pill label="Active Rows" value={String(validation.activeItems)} />
          <Pill label="Expected Buckets" value="4" />
          <Pill label="Result" value={validation.isValid ? "VALID" : "NEEDS FIX"} />
        </div>

        <div
          style={{
            borderRadius: 14,
            padding: "12px 14px",
            fontSize: 13,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            ...statusStyle,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: errorText ? 6 : 0 }}>
            {statusText}
          </div>
          {errorText ? <div>{errorText}</div> : null}
        </div>
      </div>

      <SectionCard title="Default Validation Rules + Dynamic Customization">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {DEFAULT_BUCKET_SPECS.map((spec) => {
            const bucketCustom = customization[spec.key];

            return (
              <div
                key={spec.key}
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.02)",
                  padding: 16,
                  display: "grid",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ color: "#f8fafc", fontSize: 16, fontWeight: 800, marginBottom: 6 }}>
                    {spec.label}
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: 12 }}>Default priority reason</div>
                  <div style={{ color: "#e2e8f0", fontSize: 14, fontWeight: 700, marginTop: 4 }}>
                    {spec.expectedReason}
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 6 }}>
                    Type: {spec.type} · GL Posting: {spec.glPosting ? "TRUE" : "FALSE"}
                  </div>
                </div>

                <div>
                  <div style={labelStyle}>Aliases</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      className="st-input"
                      type="text"
                      value={aliasInput[spec.key]}
                      placeholder="Add alias"
                      onChange={(e) =>
                        setAliasInput((prev) => ({ ...prev, [spec.key]: e.target.value }))
                      }
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button className="btn-secondary btn-sm" type="button" onClick={() => addAlias(spec.key)}>
                      Add
                    </button>
                  </div>

                  <TagList
                    items={bucketCustom.aliases}
                    emptyText="No aliases configured"
                    tone="blue"
                    onRemove={(value) => removeAlias(spec.key, value)}
                  />
                </div>

                <div>
                  <div style={labelStyle}>Excluded Reasons</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      className="st-input"
                      type="text"
                      value={excludedInput[spec.key]}
                      placeholder="Add excluded reason"
                      onChange={(e) =>
                        setExcludedInput((prev) => ({ ...prev, [spec.key]: e.target.value }))
                      }
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button className="btn-secondary btn-sm" type="button" onClick={() => addExcluded(spec.key)}>
                      Add
                    </button>
                  </div>

                  <TagList
                    items={bucketCustom.excluded}
                    emptyText="No excluded reasons configured"
                    tone="red"
                    onRemove={(value) => removeExcluded(spec.key, value)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Validation Summary">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 12,
          }}
        >
          {DEFAULT_BUCKET_SPECS.map((spec) => {
            const result = validation.buckets[spec.key];
            return (
              <div
                key={spec.key}
                style={{
                  borderRadius: 14,
                  border: result.hasMatch
                    ? "1px solid rgba(34,197,94,0.25)"
                    : "1px solid rgba(245,158,11,0.25)",
                  background: result.hasMatch
                    ? "rgba(34,197,94,0.08)"
                    : "rgba(245,158,11,0.08)",
                  padding: 14,
                }}
              >
                <div style={{ color: "#f8fafc", fontSize: 14, fontWeight: 800, marginBottom: 8 }}>
                  {spec.label}
                </div>
                <RowLine left="Default" right={spec.expectedReason} rightColor="#cbd5e1" />
                <RowLine left="Eligible Items" right={String(result.eligibleItems.length)} rightColor="#cbd5e1" />
                <RowLine left="Matched" right={result.hasMatch ? "YES" : "NO"} rightColor={result.hasMatch ? "#86efac" : "#fde68a"} />
                <RowLine left="Preferred Reason" right={result.preferredItem?.reason || "—"} rightColor="#f8fafc" />
              </div>
            );
          })}
        </div>

        {validation.duplicateSummary.length > 0 ? (
          <div style={warningBlockStyle}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>⚠️ Duplicate / Excess Active Items</div>
            <div style={{ display: "grid", gap: 6 }}>
              {validation.duplicateSummary.map((item) => (
                <div key={item.bucket}>
                  <b>{item.bucket}</b>: {item.count} eligible items — {item.reasons.join(", ")}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {validation.uncategorizedActiveItems.length > 0 ? (
          <div style={warningBlockStyle}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>⚠️ Uncategorized Active Items</div>
            <div style={{ display: "grid", gap: 6 }}>
              {validation.uncategorizedActiveItems.map((item, index) => (
                <div key={`${item.id || item.reason}-${index}`}>
                  {item.reason || "Unnamed"} · Type: {item.type || "—"} · GL Posting: {formatBool(item.glAccountPosting)}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </SectionCard>

      <SectionCard title="Fetched Records">
        {records.length === 0 ? (
          <EmptyText text="No records loaded yet. Click Send to fetch adjustment reasons." />
        ) : (
          <div
            style={{
              overflowX: "auto",
              borderRadius: 14,
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead style={{ background: "#1f2937" }}>
                <tr>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>Reason</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>GL Posting</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Bucket</th>
                  <th style={thStyle}>Preferred</th>
                  <th style={thStyle}>Excluded</th>
                  <th style={thStyle}>ID</th>
                </tr>
              </thead>
              <tbody>
                {records.map((item, index) => {
                  const bucketEntry = Object.values(validation.buckets).find((bucket) =>
                    bucket.eligibleItems.some((candidate) => candidate.id === item.id)
                  );

                  const isPreferred = Object.values(validation.buckets).some(
                    (bucket) => bucket.preferredItem?.id === item.id
                  );

                  const isExcluded = Object.values(validation.buckets).some((bucket) =>
                    bucket.excludedItems.some((candidate) => candidate.id === item.id)
                  );

                  return (
                    <tr
                      key={`${item.id || item.reason || "row"}-${index}`}
                      style={{
                        borderTop: "1px solid rgba(255,255,255,0.08)",
                        background: index % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                      }}
                    >
                      <td style={tdStyle}>{index + 1}</td>
                      <td style={tdStyle}>{item.reason || "—"}</td>
                      <td style={tdStyle}>{item.type || "—"}</td>
                      <td style={tdStyle}>{formatBool(item.glAccountPosting)}</td>
                      <td style={tdStyle}>{item.status || "—"}</td>
                      <td style={tdStyle}>{bucketEntry?.spec.label || "Uncategorized"}</td>
                      <td style={tdStyle}>
                        {isPreferred ? <Badge text="YES" tone="green" /> : <Badge text="NO" tone="gray" />}
                      </td>
                      <td style={tdStyle}>
                        {isExcluded ? <Badge text="YES" tone="red" /> : <Badge text="NO" tone="gray" />}
                      </td>
                      <td style={tdMonoStyle}>{String(item.id ?? "—")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 40,
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 13,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 6,
};

const warningBlockStyle: React.CSSProperties = {
  background: "rgba(245, 158, 11, 0.10)",
  border: "1px solid rgba(245, 158, 11, 0.22)",
  borderLeft: "4px solid #f59e0b",
  borderRadius: 12,
  padding: 14,
  color: "#fde68a",
};

const Pill: React.FC<{ label: string; value: string }> = ({ label, value }) => (
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
    }}
  >
    {label} <b style={{ color: "#f8fafc" }}>{value}</b>
  </span>
);

const SectionCard: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  return (
    <div
      style={{
        borderRadius: 18,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.03)",
        padding: 18,
        minWidth: 0,
      }}
    >
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
          marginBottom: isExpanded ? 12 : 0,
        }}
      >
        <div
          style={{
            fontSize: 18,
            fontWeight: 800,
            color: "#f8fafc",
          }}
        >
          {title}
        </div>
        <button
          type="button"
          style={{
            border: "none",
            background: "transparent",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: 14,
            padding: "4px",
          }}
          title={isExpanded ? "Collapse section" : "Expand section"}
        >
          {isExpanded ? "▲" : "▼"}
        </button>
      </div>
      {isExpanded && (
        <div
          style={{
            display: "grid",
            gap: 12,
            maxHeight: "500px",
            overflowY: "auto",
            paddingRight: 4,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
};

const EmptyText: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      borderRadius: 14,
      border: "1px dashed rgba(148,163,184,0.30)",
      padding: 24,
      color: "#94a3b8",
      textAlign: "center",
    }}
  >
    {text}
  </div>
);

const RowLine: React.FC<{ left: string; right: string; rightColor?: string }> = ({
  left,
  right,
  rightColor = "#cbd5e1",
}) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      gap: 12,
      alignItems: "flex-start",
      padding: "8px 10px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,0.08)",
      background: "rgba(255,255,255,0.02)",
      flexWrap: "wrap",
    }}
  >
    <div style={{ color: "#e2e8f0", fontSize: 12 }}>{left}</div>
    <div
      style={{
        color: rightColor,
        fontSize: 12,
        fontWeight: 700,
        textAlign: "right",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
      }}
    >
      {right}
    </div>
  </div>
);

const Badge: React.FC<{ text: string; tone: "green" | "red" | "gray" }> = ({
  text,
  tone,
}) => {
  const palette =
    tone === "green"
      ? {
          color: "#86efac",
          border: "1px solid rgba(34,197,94,0.25)",
          background: "rgba(34,197,94,0.10)",
        }
      : tone === "red"
      ? {
          color: "#fca5a5",
          border: "1px solid rgba(239,68,68,0.25)",
          background: "rgba(239,68,68,0.10)",
        }
      : {
          color: "#cbd5e1",
          border: "1px solid rgba(148,163,184,0.20)",
          background: "rgba(148,163,184,0.08)",
        };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        ...palette,
      }}
    >
      {text}
    </span>
  );
};

const TagList: React.FC<{
  items: string[];
  emptyText: string;
  tone: "blue" | "red";
  onRemove: (value: string) => void;
}> = ({ items, emptyText, tone, onRemove }) => {
  const palette =
    tone === "blue"
      ? {
          color: "#93c5fd",
          border: "1px solid rgba(59,130,246,0.25)",
          background: "rgba(59,130,246,0.10)",
        }
      : {
          color: "#fca5a5",
          border: "1px solid rgba(239,68,68,0.25)",
          background: "rgba(239,68,68,0.10)",
        };

  if (items.length === 0) {
    return <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 8 }}>{emptyText}</div>;
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      {items.map((item) => (
        <span
          key={item}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            ...palette,
          }}
        >
          {item}
          <button
            type="button"
            onClick={() => onRemove(item)}
            style={{
              border: "none",
              background: "transparent",
              color: "inherit",
              cursor: "pointer",
              fontWeight: 900,
              padding: 0,
              lineHeight: 1,
            }}
            title={`Remove ${item}`}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
};

export default AdjustmentReasonsView;