import type { StoreQuery } from "../types/queryDsl";
import { validateStoreQuery } from "./queryEngine";
import { STORE_QUERY_FIELDS } from "./queryFields";

const TGPT_BASE = "https://tapapi.tekioncloud.com/tapapi/tgpt";

export function tryFastPathQuery(text: string, lastStoreIds?: string[]): StoreQuery | null {
  const q = text.trim().toLowerCase();

  // 1. Actionable recommendations for "stores for today to work on"
  if (
    (q.includes("work on") || q.includes("today") || q.includes("priority stores") || q.includes("my stores") || q.includes("suggest stores")) &&
    !q.includes("slack")
  ) {
    return {
      entity: "store",
      filters: [
        { field: "is_actionable_by_arc", operator: "eq", value: true },
      ],
      sort: { field: "launch_days", direction: "asc" },
      limit: 5,
      output: "rows",
    };
  }

  // 2. Follow-up pronoun reference: "show me those", "list them"
  if (
    lastStoreIds &&
    lastStoreIds.length > 0 &&
    (q.includes("those") || q.includes("them") || q.startsWith("show") || q.startsWith("list")) &&
    !q.includes("slack")
  ) {
    return {
      entity: "store",
      filters: [{ field: "dealer_id", operator: "in", value: lastStoreIds }],
      output: "rows",
    };
  }

  // 3. Exact 4-5 digit dealer number lookup
  const dealerMatch = text.match(/\b\d{4,5}\b/);
  if (dealerMatch && !q.includes("t-") && !q.includes("days") && !q.includes("slack")) {
    return {
      entity: "store",
      filters: [{ field: "dealer_id", operator: "eq", value: dealerMatch[0] }],
      output: "rows",
    };
  }

  // 4. Completed but 0 attachments
  if (
    (q.includes("attachment") || q.includes("att")) &&
    (q.includes("0") || q.includes("zero") || q.includes("no") || q.includes("without")) &&
    (q.includes("complet") || q.includes("done"))
  ) {
    const isCountOnly = q.includes("how many") || q.startsWith("count");
    return {
      entity: "store",
      filters: [
        { field: "fixed_ops_status", operator: "eq", value: "Completed" },
        { field: "attachments", operator: "eq", value: 0 },
      ],
      output: isCountOnly ? "count" : "both",
    };
  }

  // 5. Pre-prod Setup Data fetch errors
  if (q.includes("setup") && (q.includes("error") || q.includes("fail") || q.includes("issue"))) {
    return {
      entity: "store",
      filters: [{ field: "setup_data_error", operator: "is_not_empty" }],
      output: "rows",
    };
  }

  // 6. Blocked Variable Ops
  if (q.includes("block") && q.includes("variable")) {
    return {
      entity: "store",
      filters: [{ field: "is_variable_blocked", operator: "eq", value: true }],
      output: "rows",
    };
  }

  // 7. Unassigned unblocked stores
  if (q.includes("unassigned") && (q.includes("ready") || q.includes("unblock"))) {
    return {
      entity: "store",
      filters: [
        { field: "is_fixed_unblocked", operator: "eq", value: true },
        { field: "custom_assignee", operator: "is_empty" },
      ],
      output: "rows",
    };
  }

  return null;
}

export async function interpretNaturalLanguageQuery(
  userQuery: string,
  token: string,
  lastStoreIds?: string[]
): Promise<StoreQuery> {
  const fast = tryFastPathQuery(userQuery, lastStoreIds);
  if (fast) return fast;

  const allowedFields = Object.keys(STORE_QUERY_FIELDS).join(", ");

  const systemInstructions = `You are a strict Natural Language to Structured Query translator for an automotive onboarding database.
Output ONLY valid JSON matching the StoreQuery schema. No markdown formatting, no commentary.

SCHEMA:
{
  "entity": "store",
  "filters": [
    {
      "field": "${allowedFields}",
      "operator": "eq" | "neq" | "contains" | "not_contains" | "gt" | "gte" | "lt" | "lte" | "is_empty" | "is_not_empty" | "in",
      "value": string | number | boolean | array
    }
  ],
  "output": "count" | "rows" | "both",
  "aggregate": { "type": "count" },
  "sort": { "field": string, "direction": "asc" | "desc" },
  "limit": number
}

RULES:
1. "attachments are zero" -> { "field": "attachments", "operator": "eq", "value": 0 }
2. "tasks completed" -> { "field": "fixed_ops_status", "operator": "eq", "value": "Completed" }
3. "breaching in 85 days" -> { "field": "launch_days", "operator": "lte", "value": 85 }
4. "unassigned" -> { "field": "custom_assignee", "operator": "is_empty" }
5. "stores to work on" -> { "field": "is_actionable_by_arc", "operator": "eq", "value": true }
6. Never query fields outside the allowed fields list.`;

  try {
    const createRes = await fetch(`${TGPT_BASE}/conversations`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-luna",
        title: "DSL Compiler",
        is_temporary: true,
        thinking: false,
      }),
    });

    if (!createRes.ok) throw new Error("Compiler session init failed");
    const { id } = await createRes.json();

    const streamRes = await fetch(`${TGPT_BASE}/conversations/${id}/messages/stream`, {
      method: "POST",
      headers: {
        accept: "*/*",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        content: `${systemInstructions}\n\nUSER QUERY: "${userQuery}"`,
        thinking: false,
      }),
    });

    if (!streamRes.ok || !streamRes.body) throw new Error("Compiler stream failed");

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]") continue;
        try {
          const delta = JSON.parse(raw);
          if (delta.type === "content_delta") accumulated += delta.delta || "";
        } catch {}
      }
    }

    const cleanJson = accumulated.replace(/```json/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleanJson);

    if (validateStoreQuery(parsed)) {
      return parsed;
    }
  } catch (err) {
    console.warn("[DSL Compiler] Fallback to open search", err);
  }

  // Graceful fallback
  return {
    entity: "store",
    filters: [{ field: "dba_name", operator: "contains", value: userQuery }],
    output: "rows",
  };
}
