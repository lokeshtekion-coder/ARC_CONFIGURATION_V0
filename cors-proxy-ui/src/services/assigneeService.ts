import type { StoreRecord } from "./storesDb";
import { getSlackSession, sendSlackChannelMessage } from "./storeSlackHelper";

export const ASSIGNEE_OPTIONS = [
  "Amaresh M",
  "Lokesh Reddy",
  "Karan",
  "Sujatha",
  "Arun",
  "Nanjunda",
] as const;

export type AssigneeName = typeof ASSIGNEE_OPTIONS[number];

export interface AssigneeConfig {
  /** Names the bot may assign to (subset of ASSIGNEE_OPTIONS). */
  selected: string[];
  /** When true, the Stores page auto-assigns eligible stores. */
  autoAssignEnabled: boolean;
}

export type AssignmentSource = "bot" | "manual" | "excel";

export interface AssignmentEvent {
  id: string;
  tekionId: string;
  dealerName: string;
  dealerId: string;
  assignee: string;
  previousAssignee: string;
  source: AssignmentSource;
  at: string;
}

type AssignmentState = Record<string, { assignee: string; source: AssignmentSource }>;

const API = "http://localhost:4000/api/stores/app-state";
const CONFIG_KEY = "assignee_config";
const LOG_KEY = "assignment_log";
const STATE_KEY = "assignment_state";
const MAX_LOG = 5000;
const OPERATIONS_CHANNEL_ID = "C0C5QBWEM8X";

const DEFAULT_CONFIG: AssigneeConfig = {
  selected: ["Amaresh M", "Lokesh Reddy", "Karan", "Sujatha"],
  autoAssignEnabled: true,
};

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`arc-${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(`arc-${key}`, JSON.stringify(value));
  } catch {}
  void fetch(`${API}/${key}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  }).catch(() => undefined);
}

export async function hydrateAssigneeStateFromBackend(): Promise<void> {
  for (const key of [CONFIG_KEY, LOG_KEY, STATE_KEY]) {
    if (localStorage.getItem(`arc-${key}`)) continue;
    try {
      const res = await fetch(`${API}/${key}`);
      if (!res.ok) continue;
      const json = (await res.json()) as { value?: unknown };
      if (json.value) localStorage.setItem(`arc-${key}`, JSON.stringify(json.value));
    } catch {}
  }
}

export function loadAssigneeConfig(): AssigneeConfig {
  const c = readLocal<Partial<AssigneeConfig>>(CONFIG_KEY, {});
  return {
    selected: Array.isArray(c.selected) ? c.selected : DEFAULT_CONFIG.selected,
    autoAssignEnabled: c.autoAssignEnabled ?? DEFAULT_CONFIG.autoAssignEnabled,
  };
}

export function saveAssigneeConfig(config: AssigneeConfig): void {
  writeLocal(CONFIG_KEY, config);
}

export function loadAssignmentLog(): AssignmentEvent[] {
  return readLocal<AssignmentEvent[]>(LOG_KEY, []);
}

function appendLog(events: AssignmentEvent[]): void {
  if (!events.length) return;
  const next = [...loadAssignmentLog(), ...events].slice(-MAX_LOG);
  writeLocal(LOG_KEY, next);
}

function loadState(): AssignmentState {
  return readLocal<AssignmentState>(STATE_KEY, {});
}

function makeEvent(
  store: StoreRecord,
  assignee: string,
  previousAssignee: string,
  source: AssignmentSource
): AssignmentEvent {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tekionId: store.tekion_id,
    dealerName: store.dba_name,
    dealerId: store.dealer_id,
    assignee,
    previousAssignee,
    source,
    at: new Date().toISOString(),
  };
}

export function resolveStoreAssignee(row: StoreRecord): string {
  const custom = String((row as any).custom_assignee ?? "").trim();
  if (custom && (ASSIGNEE_OPTIONS as readonly string[]).includes(custom)) return custom;

  const anyRow = row as Record<string, any>;
  const textBlob = `${anyRow.lead_assignee || ""} ${anyRow.primary_lead_name || ""} ${
    anyRow.implementation_consultant || ""
  } ${anyRow.fixed_ops_lead_name || ""} ${anyRow.variable_ops_lead_name || ""} ${
    anyRow.conversion_track_lead_1773369950325147526 || ""
  }`.toLowerCase();

  for (const opt of ASSIGNEE_OPTIONS) {
    if (textBlob.includes(opt.split(" ")[0].toLowerCase())) return opt;
  }
  return "";
}

export function recordManualAssignment(store: StoreRecord, newAssignee: string): void {
  const state = loadState();
  const previous = state[store.tekion_id]?.assignee ?? (store as any).custom_assignee ?? "";
  if (previous === newAssignee) return;
  state[store.tekion_id] = { assignee: newAssignee, source: "manual" };
  writeLocal(STATE_KEY, state);
  appendLog([makeEvent(store, newAssignee, previous, "manual")]);
}

export function reconcileAssignments(records: StoreRecord[]): void {
  const state = loadState();
  const events: AssignmentEvent[] = [];
  let dirty = false;
  for (const r of records) {
    const current = String((r as any).custom_assignee ?? "").trim();
    const known = state[r.tekion_id];
    if (!known) {
      if (current) {
        state[r.tekion_id] = { assignee: current, source: "manual" };
        dirty = true;
      }
      continue;
    }
    if (known.assignee !== current) {
      events.push(makeEvent(r, current, known.assignee, "excel"));
      state[r.tekion_id] = { assignee: current, source: "excel" };
      dirty = true;
    }
  }
  if (dirty) writeLocal(STATE_KEY, state);
  appendLog(events);
}

function isBlueprintDone(status?: string): boolean {
  if (!status) return false;
  const s = status.trim().toUpperCase();
  return s === "COMPLETED" || s === "COMPLETE" || s === "DONE";
}

function isFixedOpsComplete(status?: string): boolean {
  if (!status) return false;
  const s = status.trim().toUpperCase();
  return s === "COMPLETED" || s === "COMPLETE";
}

/**
 * Strict Auto-Assignment Eligibility:
 * 1. POD must be strictly 1, 2, or 3.
 * 2. Both Parts and Service blueprints must be COMPLETED.
 * 3. Fixed Ops must NOT be completed.
 * 4. Must not be flagged under Not Worked (e.g. Handled by Store, Enterprise, Cancelled).
 */
export function isEligibleForAutoAssign(store: StoreRecord): boolean {
  // 1. Strict POD gate: Only POD 1, 2, or 3
  const pod = String(store.superpod_id || "").trim();
  if (pod !== "1" && pod !== "2" && pod !== "3") {
    return false;
  }

  // 2. Ownership Gate (Must be worked by ARC)
  if (store.not_worked && store.not_worked.trim() !== "") {
    return false;
  }

  // 3. Fixed Ops Status Gate: Must NOT be completed
  if (isFixedOpsComplete(store.fixed_ops_status)) {
    return false;
  }

  // 4. Blueprint Gate: Both Parts AND Service must be COMPLETED
  const b = (store as any).blueprint_statuses;
  const partsDone = isBlueprintDone(b?.parts);
  const serviceDone = isBlueprintDone(b?.service);

  return partsDone && serviceDone;
}

/**
 * Sends an alert directly to Slack channel C0C5QBWEM8X for an auto-assigned dealership
 */
async function notifySlackAssignment(store: StoreRecord, assignedTo: string): Promise<void> {
  const session = getSlackSession();
  if (!session.slackToken || !session.slackDCookie) {
    console.warn("[assigneeService] Slack session inactive. Cannot dispatch assignment alert.");
    return;
  }

  const dealerName = store.dba_name || "Unknown Dealer";
  const dealerId = store.dealer_id || "—";
  const tekionId = store.tekion_id || "—";
  const pod = store.superpod_id || "—";
  const fixedOpsStatus = store.fixed_ops_status || "TO DO";
  const goLive = store.launch_date || "—";

  const messageText =
`🎯 *Store Auto-Assigned (Fixed Ops Track)*
• *Dealership:* ${dealerName}
• *Dealer ID:* \`${dealerId}\` | *Tekion ID:* \`${tekionId}\`
• *POD:* *POD ${pod}*
• *Assigned To:* *${assignedTo}*
• *Blueprint Status:* Parts: \`COMPLETED\` | Service: \`COMPLETED\`
• *Fixed Ops Status:* \`${fixedOpsStatus}\` (Pending Configuration)
• *Go-Live:* ${goLive}`;

  try {
    await sendSlackChannelMessage({
      channelId: OPERATIONS_CHANNEL_ID,
      text: messageText,
    });
  } catch (err) {
    console.error("[assigneeService] Failed to send assignment Slack alert:", err);
  }
}

/**
 * Assigns eligible unassigned stores in POD 1, 2, and 3 where Parts & Service are Completed
 * and Fixed Ops is pending, balancing workload among selected team members.
 */
export function runAutoAssign(
  records: StoreRecord[],
  config: AssigneeConfig
): { updated: StoreRecord[]; events: AssignmentEvent[] } {
  const pool = config.selected.filter((n) => (ASSIGNEE_OPTIONS as readonly string[]).includes(n));
  if (!pool.length || !config.autoAssignEnabled) return { updated: [], events: [] };

  const load = new Map<string, number>(pool.map((n) => [n, 0]));
  for (const r of records) {
    const a = String((r as any).custom_assignee ?? "").trim();
    if (load.has(a) && !isFixedOpsComplete(r.fixed_ops_status)) {
      load.set(a, (load.get(a) ?? 0) + 1);
    }
  }

  const candidates = records
    .filter((r) => isEligibleForAutoAssign(r) && !String((r as any).custom_assignee ?? "").trim())
    .sort((a, b) => String(a.launch_date || "").localeCompare(String(b.launch_date || "")));

  const state = loadState();
  const updated: StoreRecord[] = [];
  const events: AssignmentEvent[] = [];

  for (const store of candidates) {
    let pick = pool[0];
    for (const n of pool) {
      if ((load.get(n) ?? 0) < (load.get(pick) ?? 0)) {
        pick = n;
      }
    }

    load.set(pick, (load.get(pick) ?? 0) + 1);
    const updatedStore = { ...store, custom_assignee: pick } as StoreRecord;
    updated.push(updatedStore);
    state[store.tekion_id] = { assignee: pick, source: "bot" };
    events.push(makeEvent(store, pick, "", "bot"));

    // Immediate notification per store (no digest)
    void notifySlackAssignment(updatedStore, pick);
  }

  if (events.length) {
    writeLocal(STATE_KEY, state);
    appendLog(events);
  }

  return { updated, events };
}

export function summarizeAssignments(records: StoreRecord[], log: AssignmentEvent[]) {
  return ASSIGNEE_OPTIONS.map((name) => {
    const current = records.filter((r) => (r as any).custom_assignee === name).length;
    const byBot = log.filter((e) => e.source === "bot" && e.assignee === name).length;
    const movedAwayManually = log.filter(
      (e) => e.source !== "bot" && e.previousAssignee === name
    ).length;
    const receivedManually = log.filter((e) => e.source !== "bot" && e.assignee === name).length;
    return { name, current, byBot, receivedManually, movedAwayManually };
  });
}