import React, { useMemo, useState } from "react";
import { loadGlobalHeaders } from "../../services/tekionApiSettings";
import type { KeyValuePair } from "../../types/proxy.types";

const WORKFLOW_URL =
  "https://preprodapp.tekioncloud.com/api/accounting/u/autoPostingSettings/workflow/posting-options";

type UiMessage = {
  ok: boolean;
  text: string;
};

type PostingStatus = "AUTO_POST" | "CREATE_DRAFT" | "NONE" | string;

type AutoPostingSubWorkflow = {
  label?: string;
  postingStatus?: PostingStatus | null;
  hidden?: boolean;
  [key: string]: unknown;
};

type AutoPostingWorkflow = {
  label?: string;
  order?: number;
  displayName?: string;
  postingStatus?: PostingStatus | null;
  subWorkflows?: AutoPostingSubWorkflow[] | null;
  hidden?: boolean;
  [key: string]: unknown;
};

type AutoPostingSubSection = {
  label?: string;
  order?: number;
  displayName?: string;
  postingOptions?: PostingStatus[];
  workflows?: AutoPostingWorkflow[];
  hidden?: boolean;
  [key: string]: unknown;
};

type AutoPostingSection = {
  label?: string;
  order?: number;
  displayName?: string;
  subSections?: AutoPostingSubSection[];
  [key: string]: unknown;
};

type AutoPostingResponse = {
  data?: {
    sections?: AutoPostingSection[];
    dealerId?: string;
    tenantId?: string;
    [key: string]: unknown;
  };
  status?: string;
  message?: string;
  [key: string]: unknown;
};

type AutoPostingPayload = {
  sections: Array<{
    label: string;
    subSections: Array<{
      label: string;
      workflows: Array<{
        label: string;
        postingStatus: PostingStatus | null;
        subWorkflows: Array<{
          label: string;
          postingStatus: PostingStatus | null;
        }> | null;
      }>;
    }>;
  }>;
};

const logger = {
  info: (...args: unknown[]) => console.info("[Accounting][AutoPostingSettings]", ...args),
  warn: (...args: unknown[]) => console.warn("[Accounting][AutoPostingSettings]", ...args),
  error: (...args: unknown[]) => console.error("[Accounting][AutoPostingSettings]", ...args),
};

const cardStyle: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  padding: 18,
};

const pillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
  color: "#cbd5e1",
  fontSize: 12,
};

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function toEnabledHeaderMap(headers: KeyValuePair[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of headers) {
    if (!row?.enabled) continue;
    const key = normalize(row.key);
    const value = normalize(row.value);
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function extractDealerIdFromHeaders(headers: Record<string, string>): string {
  const candidates = ["dealerid", "dealerId", "dealer-id", "x-dealer-id"];
  const entries = Object.entries(headers);
  for (const candidate of candidates) {
    const hit = entries.find(([key]) => key.toLowerCase() === candidate.toLowerCase());
    if (hit?.[1]) return normalize(hit[1]);
  }
  return "";
}

function buildPostingStatus(
  workflow: AutoPostingWorkflow,
  subSection: AutoPostingSubSection
): PostingStatus | null {
  const current = workflow.postingStatus;

  if (current === "NONE") return "NONE";
  if (current === "AUTO_POST") return "AUTO_POST";
  if (current === "CREATE_DRAFT") return "CREATE_DRAFT";

  const options = Array.isArray(subSection.postingOptions) ? subSection.postingOptions : [];

  if (options.includes("CREATE_DRAFT")) return "CREATE_DRAFT";
  if (options.includes("AUTO_POST")) return "AUTO_POST";
  if (options.includes("NONE")) return "NONE";

  return current ?? null;
}

function buildSubWorkflowPostingStatus(subWorkflow: AutoPostingSubWorkflow): PostingStatus | null {
  if (subWorkflow.postingStatus === "NONE") return "NONE";
  if (subWorkflow.postingStatus === "AUTO_POST") return "AUTO_POST";
  if (subWorkflow.postingStatus === "CREATE_DRAFT") return "CREATE_DRAFT";
  return subWorkflow.postingStatus ?? null;
}

function buildPayloadFromResponse(input: AutoPostingResponse): AutoPostingPayload {
  const sections = Array.isArray(input?.data?.sections) ? input.data.sections : [];

  return {
    sections: sections
      .filter((section) => normalize(section.label))
      .map((section) => ({
        label: normalize(section.label),
        subSections: (Array.isArray(section.subSections) ? section.subSections : [])
          .filter((subSection) => normalize(subSection.label))
          .map((subSection) => ({
            label: normalize(subSection.label),
            workflows: (Array.isArray(subSection.workflows) ? subSection.workflows : [])
              .filter((workflow) => normalize(workflow.label))
              .map((workflow) => ({
                label: normalize(workflow.label),
                postingStatus: buildPostingStatus(workflow, subSection),
                subWorkflows: Array.isArray(workflow.subWorkflows)
                  ? workflow.subWorkflows
                      .filter((subWorkflow) => normalize(subWorkflow.label))
                      .map((subWorkflow) => ({
                        label: normalize(subWorkflow.label),
                        postingStatus: buildSubWorkflowPostingStatus(subWorkflow),
                      }))
                  : null,
              })),
          })),
      })),
  };
}

function getVisibleStats(input: AutoPostingResponse) {
  const sections = Array.isArray(input?.data?.sections) ? input.data.sections : [];

  let visibleSubSections = 0;
  let visibleWorkflows = 0;
  let hiddenSubSections = 0;
  let hiddenWorkflows = 0;

  for (const section of sections) {
    for (const subSection of section.subSections ?? []) {
      if (subSection.hidden) hiddenSubSections += 1;
      else visibleSubSections += 1;

      for (const workflow of subSection.workflows ?? []) {
        if (workflow.hidden) hiddenWorkflows += 1;
        else visibleWorkflows += 1;
      }
    }
  }

  return {
    sectionCount: sections.length,
    visibleSubSections,
    hiddenSubSections,
    visibleWorkflows,
    hiddenWorkflows,
  };
}

const AutoPostingSettings: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<UiMessage | null>(null);

  const [fetchedResponse, setFetchedResponse] = useState<AutoPostingResponse | null>(null);
  const [builtPayload, setBuiltPayload] = useState<AutoPostingPayload | null>(null);
  const [lastPostResponse, setLastPostResponse] = useState<unknown>(null);

  const [showGetResponse, setShowGetResponse] = useState(false);
  const [showPayload, setShowPayload] = useState(false);
  const [showPostResponse, setShowPostResponse] = useState(false);

  const enabledHeaders = useMemo(() => toEnabledHeaderMap(loadGlobalHeaders()), []);
  const dealerId = useMemo(() => extractDealerIdFromHeaders(enabledHeaders), [enabledHeaders]);
  const headerCount = Object.keys(enabledHeaders).length;

  const stats = useMemo(
    () => (fetchedResponse ? getVisibleStats(fetchedResponse) : null),
    [fetchedResponse]
  );

  const proxyRequest = async (payload: {
    url: string;
    method: "GET" | "POST";
    body?: unknown;
  }) => {
    const response = await fetch("http://localhost:4000/api/proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: payload.url,
        method: payload.method,
        headers: {
          ...enabledHeaders,
          ...(payload.body ? { "content-type": "application/json" } : {}),
        },
        body: payload.body,
        timeout: 60000,
      }),
    });

    if (!response.ok) {
      throw new Error(`Proxy request failed with HTTP ${response.status}`);
    }

    const json = await response.json();

    if ((json?.status ?? 200) >= 400) {
      throw new Error(
        `${json?.status ?? ""} ${json?.statusText ?? "Request failed"}`.trim()
      );
    }

    return json?.body ?? json?.data ?? json;
  };

  const runGet = async () => {
    setLoading(true);
    setMessage(null);

    try {
      if (!dealerId) {
        throw new Error(
          "Dealer ID not found in Global Headers. Please select/apply dealer headers in Settings first."
        );
      }

      const body = (await proxyRequest({
        url: WORKFLOW_URL,
        method: "GET",
      })) as AutoPostingResponse;

      const payload = buildPayloadFromResponse(body);

      setFetchedResponse(body);
      setBuiltPayload(payload);
      setLastPostResponse(null);

      logger.info("auto posting GET succeeded", {
        dealerId,
        body,
        payload,
      });

      setMessage({
        ok: true,
        text: "Fetched auto posting settings and built payload successfully.",
      });
    } catch (error: unknown) {
      logger.error("auto posting GET failed", error);
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Failed to fetch auto posting settings",
      });
    } finally {
      setLoading(false);
    }
  };

  const runPost = async () => {
    setRunning(true);
    setMessage(null);

    try {
      if (!dealerId) {
        throw new Error(
          "Dealer ID not found in Global Headers. Please select/apply dealer headers in Settings first."
        );
      }

      let sourceResponse = fetchedResponse;
      let payload = builtPayload;

      if (!sourceResponse || !payload) {
        const body = (await proxyRequest({
          url: WORKFLOW_URL,
          method: "GET",
        })) as AutoPostingResponse;

        sourceResponse = body;
        payload = buildPayloadFromResponse(body);
        setFetchedResponse(body);
        setBuiltPayload(payload);
      }

      logger.info("auto posting POST started", {
        dealerId,
        payload,
      });

      const postResponse = await proxyRequest({
        url: WORKFLOW_URL,
        method: "POST",
        body: payload,
      });

      setLastPostResponse(postResponse);

      logger.info("auto posting POST succeeded", {
        dealerId,
        postResponse,
      });

      setMessage({
        ok: true,
        text: "Auto Posting Settings saved successfully.",
      });
    } catch (error: unknown) {
      logger.error("auto posting POST failed", error);
      setMessage({
        ok: false,
        text: error instanceof Error ? error.message : "Failed to save auto posting settings",
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={cardStyle}>
        <div style={{ color: "#f8fafc", fontSize: 22, fontWeight: 800, marginBottom: 6 }}>
          Auto Posting Settings
        </div>
        <div style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.7 }}>
          Fetch current accounting auto posting workflow settings, build a safe payload dynamically
          from dealer data, and save updates using Global Headers.
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <span style={pillStyle}>
            Dealer ID
            <b style={{ color: dealerId ? "#f8fafc" : "#fca5a5" }}>
              {dealerId || "Not found"}
            </b>
          </span>
          <span style={pillStyle}>
            Global Headers
            <b style={{ color: "#f8fafc" }}>{headerCount}</b>
          </span>
          <span style={pillStyle}>
            API
            <b style={{ color: "#f8fafc" }}>workflow/posting-options</b>
          </span>
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
          Automation Rules
        </div>
        <div style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.8 }}>
          <div>• Uses GET response as the single source of truth for each dealer</div>
          <div>• Builds POST payload dynamically from returned sections / subSections / workflows</div>
          <div>• Preserves labels and subWorkflow structure from the dealer response</div>
          <div>• Uses current postingStatus when available</div>
          <div>• Falls back safely based on postingOptions when postingStatus is null</div>
          <div>• Hidden items are not used for decision logic, but payload structure remains dealer-driven</div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
          <button
            className="btn-secondary btn-sm"
            type="button"
            onClick={() => void runGet()}
            disabled={loading}
          >
            {loading ? "Loading..." : "▶ Fetch Current Settings"}
          </button>

          <button
            className="btn-postman"
            type="button"
            onClick={() => void runPost()}
            disabled={running}
          >
            {running ? "Running..." : "⚙ Save Auto Posting Settings"}
          </button>

          <button
            className="btn-secondary btn-sm"
            type="button"
            onClick={() => setShowGetResponse((prev) => !prev)}
            disabled={!fetchedResponse}
          >
            {showGetResponse ? "Hide GET Response" : "Show GET Response"}
          </button>

          <button
            className="btn-secondary btn-sm"
            type="button"
            onClick={() => setShowPayload((prev) => !prev)}
            disabled={!builtPayload}
          >
            {showPayload ? "Hide Payload" : "Show Payload"}
          </button>

          <button
            className="btn-secondary btn-sm"
            type="button"
            onClick={() => setShowPostResponse((prev) => !prev)}
            disabled={!lastPostResponse}
          >
            {showPostResponse ? "Hide POST Response" : "Show POST Response"}
          </button>
        </div>

        {message ? (
          <div
            style={{
              marginTop: 16,
              borderRadius: 14,
              padding: "10px 12px",
              fontSize: 13,
              border: message.ok
                ? "1px solid rgba(34,197,94,0.22)"
                : "1px solid rgba(239,68,68,0.22)",
              background: message.ok
                ? "rgba(34,197,94,0.10)"
                : "rgba(239,68,68,0.10)",
              color: message.ok ? "#bbf7d0" : "#fecaca",
            }}
          >
            {message.text}
          </div>
        ) : null}
      </div>

      {stats ? (
        <div style={cardStyle}>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }}>
            Current Dealer Structure Summary
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={pillStyle}>
              Sections <b style={{ color: "#f8fafc" }}>{stats.sectionCount}</b>
            </span>
            <span style={pillStyle}>
              Visible SubSections <b style={{ color: "#86efac" }}>{stats.visibleSubSections}</b>
            </span>
            <span style={pillStyle}>
              Hidden SubSections <b style={{ color: "#fcd34d" }}>{stats.hiddenSubSections}</b>
            </span>
            <span style={pillStyle}>
              Visible Workflows <b style={{ color: "#86efac" }}>{stats.visibleWorkflows}</b>
            </span>
            <span style={pillStyle}>
              Hidden Workflows <b style={{ color: "#fcd34d" }}>{stats.hiddenWorkflows}</b>
            </span>
          </div>
        </div>
      ) : null}

      {showGetResponse && fetchedResponse ? (
        <div style={cardStyle}>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }}>
            GET Response
          </div>
          <pre
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 12,
              background: "#0f172a",
              color: "#e2e8f0",
              overflow: "auto",
              fontSize: 12,
            }}
          >
            {JSON.stringify(fetchedResponse, null, 2)}
          </pre>
        </div>
      ) : null}

      {showPayload && builtPayload ? (
        <div style={cardStyle}>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }}>
            Built POST Payload
          </div>
          <pre
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 12,
              background: "#0f172a",
              color: "#e2e8f0",
              overflow: "auto",
              fontSize: 12,
            }}
          >
            {JSON.stringify(builtPayload, null, 2)}
          </pre>
        </div>
      ) : null}

      {showPostResponse && lastPostResponse ? (
        <div style={cardStyle}>
          <div style={{ color: "#f8fafc", fontSize: 17, fontWeight: 800, marginBottom: 10 }}>
            POST Response
          </div>
          <pre
            style={{
              margin: 0,
              padding: 12,
              borderRadius: 12,
              background: "#0f172a",
              color: "#e2e8f0",
              overflow: "auto",
              fontSize: 12,
            }}
          >
            {JSON.stringify(lastPostResponse, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
};

export default AutoPostingSettings;
