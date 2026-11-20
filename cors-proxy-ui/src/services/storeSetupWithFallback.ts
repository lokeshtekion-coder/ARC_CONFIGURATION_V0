import type { StoreRecord, StoreSetupData } from "./storesDb";
import { fetchSetupDataForStore } from "./storeSetupDataService";
import { executePreprodMapPipeline, type PreprodValidationResult } from "./preprodMapApiService";
import { acctsCount, acctsReady, coaCount, READY_MIN_COUNT } from "./storeAssessment";

/**
 * Single source of truth for the Variable Ops data refetch, used by the manual dealer button,
 * the batch 🧩 Setup Data button, and the background bot.
 *
 * Rule: ACCTS (MAP) above 50 = done. Otherwise fetch setup again and run MAP again.
 * COA is fetched too, but a COA failure never stops MAP, and COA never decides "done".
 */

export interface SetupWithFallbackResult {
  setupData?: StoreSetupData;
  /** Error from the setup call itself ("" when it succeeded). */
  setupError: string;
  /** True when ACCTS is above 50 after this run. */
  complete: boolean;
  /** ACCTS after this run. */
  accts: number;
  /** COA after this run (0 when the setup call failed). */
  coa: number;
  /** Text to store in setup_data_error: the setup error, a missing-data note, or "". */
  errorNote: string;
  preprodValidation?: PreprodValidationResult;
  /** Why MAP did not run or failed ("" when it ran fine or was not needed). */
  mapError: string;
  /** True when MAP was attempted in this run. */
  mapAttempted: boolean;
}

export async function fetchSetupWithMapFallback(store: StoreRecord): Promise<SetupWithFallbackResult> {
  // 1. Setup (COA). Failure is recorded but does not block MAP.
  let setupData: StoreSetupData | undefined;
  let setupError = "";
  try {
    setupData = await fetchSetupDataForStore(store, { force: true });
  } catch (err) {
    setupError = err instanceof Error ? err.message : "Setup Data Fetch Failed";
  }

  // 2. MAP (ACCTS) when the stored ACCTS is not above 50.
  let preprodValidation: PreprodValidationResult | undefined;
  let mapError = "";
  let mapAttempted = false;
  const current = { ...store, setup_data: setupData ?? store.setup_data };
  if (!acctsReady(current)) {
    const tenant = store.tenant_code || (store as any).tenant_name || "";
    if (tenant) {
      mapAttempted = true;
      try {
        preprodValidation = await executePreprodMapPipeline(tenant, store.dealer_id);
      } catch (err) {
        mapError = err instanceof Error ? err.message : "MAP failed";
      }
    } else {
      mapError = "No tenant code on this store";
    }
  }

  // 3. Result after this run.
  const afterMap = { ...current, preprod_validation: preprodValidation ?? store.preprod_validation };
  const accts = acctsCount(afterMap);
  const coa = coaCount(afterMap);
  const complete = accts > READY_MIN_COUNT;

  const notes: string[] = [];
  if (setupError) notes.push(`Setup failed: ${setupError}`);
  if (!complete) notes.push(`ACCTS ${accts} (needs >${READY_MIN_COUNT})`);
  if (mapError) notes.push(`MAP not run: ${mapError}`);

  return {
    setupData,
    setupError,
    complete,
    accts,
    coa,
    errorNote: notes.join(" · "),
    preprodValidation,
    mapError,
    mapAttempted,
  };
}
