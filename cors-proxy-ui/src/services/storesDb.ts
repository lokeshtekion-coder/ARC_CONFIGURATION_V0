import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type {
  StoreBlueprintStatuses,
  StoreSignoffStatuses,
} from "./storeOnboardingStatusApi";

export type CustomPhaseStatus = "TO DO" | "WIP" | "Completed";

export interface StoreSetupData {
  oemDealerCodes: string[];
  journalsAccessibleDealerCount: number;
  salesChainsAccessibleDealerCount: number;
  coaAccessibleDealerCount: number;
  sourceUsername: string;
  siteId: string;
  userId: string;
  fetchedAt: string;
}

export interface StoreRecord {
  tekion_id: string;
  dealer_id: string;
  dba_name: string;
  launch_date: string;
  implementation_type: string;
  pre_production_environment_status: string;
  superpod_id: string;
  product_types?: string;

  workorder_consolidated_pdl?: string;
  dealer_pdl?: string;
  arc_pdl?: string;

  project_implementation_tm_sync_status_tracking_id?: string;
  implementation_tm_sync_status_tracking_id?: string;
  base_entity_instance_id?: string;

  project_engagement_manager_1781169293313734451?: string;
  fixed_ops_track_lead_1773369946675032982?: string;
  conversion_track_lead_1773369950325147526?: string;
  accounting_track_lead_1773369945455468395?: string;

  tenant_code?: string;
  tenant_id?: string;

  configuration_status?: CustomPhaseStatus;
  fixed_ops_status?: CustomPhaseStatus;
  variable_ops_status?: CustomPhaseStatus;
  testing_status?: CustomPhaseStatus;

  blueprint_statuses?: StoreBlueprintStatuses;
  signoff_statuses?: StoreSignoffStatuses;
  onboarding_status_fetched_at?: string;

  setup_data?: StoreSetupData;
  setup_data_fetched_at?: string;
  setup_data_error?: string;
}

interface StoresDbSchema extends DBSchema {
  stores: {
    key: string;
    value: StoreRecord;
  };
}

const DB_NAME = "arc-stores-db";
const STORE_NAME = "stores";
const DB_VERSION = 2;
const STATUS_VAULT_KEY = "arc_store_status_vault_v1";

let dbPromise: Promise<IDBPDatabase<StoresDbSchema>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<StoresDbSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "tekion_id" });
        }
      },
    });
  }
  return dbPromise;
}

export async function saveStores(records: StoreRecord[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE_NAME, "readwrite");
  await tx.store.clear();

  for (const record of records) {
    await tx.store.put(record);
  }

  await tx.done;
}

export async function getStores(): Promise<StoreRecord[]> {
  const db = await getDb();
  return db.getAll(STORE_NAME);
}

type StoredStatusVault = Record<
  string,
  Partial<
    Pick<
      StoreRecord,
      "fixed_ops_status" | "variable_ops_status" | "testing_status"
    >
  >
>;

export function getStoredStatusVault(): StoredStatusVault {
  try {
    const raw = localStorage.getItem(STATUS_VAULT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredStatusVault;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveStatusToVault(
  tekionId: string,
  field: "fixed_ops_status" | "variable_ops_status" | "testing_status",
  value: CustomPhaseStatus
): void {
  const current = getStoredStatusVault();
  current[tekionId] = {
    ...(current[tekionId] ?? {}),
    [field]: value,
  };

  localStorage.setItem(STATUS_VAULT_KEY, JSON.stringify(current));
}
