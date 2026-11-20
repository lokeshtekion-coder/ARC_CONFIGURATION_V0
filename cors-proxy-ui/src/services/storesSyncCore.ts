// Shared steps used by BOTH entry points:
//   - manual: the Stores page (pages/Stores.tsx), when the bot is OFF
//   - bot:    the background runner (services/storesBotRunner.ts), when the bot is ON
// Each function here used to be copy-pasted in both places. Behaviour is unchanged;
// callers still decide what to do with the result (React state vs. in-memory arrays).

import { bulkUpdateStatusVault, type StoreRecord } from "./storesDb";
import { loadAssigneeConfig, reconcileAssignments, runAutoAssign } from "./assigneeService";
import { patchSingleStoreAssigneeInGraph } from "./storesGraphSync";
import { sendNewAssignmentsNotice } from "./assigneeService";

/** Field mapping written to the status vault after any Excel pull or merge. */
export function toStatusVaultEntries(stores: StoreRecord[]) {
  return stores.map((s) => ({
    tekionId: s.tekion_id,
    fixed_ops_status: s.fixed_ops_status,
    variable_ops_status: s.variable_ops_status,
    testing_status: s.testing_status,
    custom_assignee: s.custom_assignee,
    custom_variable_assignee: s.custom_variable_assignee,
    not_worked: s.not_worked,
  }));
}

/** Persists the status fields of the given stores into the vault. */
export function persistStatusVault(stores: StoreRecord[]): void {
  bulkUpdateStatusVault(toStatusVaultEntries(stores));
}

/**
 * Reconciles assignee data, then runs auto-assign rules if they are enabled.
 * Returns null when auto-assign is switched off, otherwise the rule output.
 * Caller applies `updated` to its own state and pushes it to Excel.
 */
export function runAssigneeAutomation(records: StoreRecord[]): ReturnType<typeof runAutoAssign> | null {
  reconcileAssignments(records);
  const config = loadAssigneeConfig();
  if (!config.autoAssignEnabled) return null;
  const result = runAutoAssign(records, config);
  if (result.updated.length > 0) void sendNewAssignmentsNotice(result.updated);
  return result;
}

/** Pushes newly auto-assigned Fixed Ops owners to the Excel workbook (errors ignored per store). */
export async function patchAssigneesInGraph(
  updated: Array<{ tekion_id: string; custom_assignee?: string }>
): Promise<void> {
  for (const u of updated) {
    try {
      await patchSingleStoreAssigneeInGraph(u.tekion_id, String(u.custom_assignee));
    } catch {
      // ignored: same behaviour as before
    }
  }
}
