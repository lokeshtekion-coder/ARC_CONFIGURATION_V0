import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
// @ts-ignore - raw import for Vite/bundler
import slackCsvText from "./DATA/Slack.csv?raw";
import { storesBotRunner, type BotState } from "../services/storesBotRunner";
import { fetchStores, getTDaysRange, ExpiredCaptureTokenError, type TRange } from "../services/tekionStoresApi";
import {
  getStores,
  saveStores,
  getStoredStatusVault,
  saveStatusToVault,
  saveNotWorkedToVault,
  recordStatusTransition,
  bulkUpdateStatusVault,
  resolveStoreProjectId,
  NOT_WORKED_OPTIONS,
  type StoreRecord,
  type CustomPhaseStatus,
  type StoreSetupData,
} from "../services/storesDb";
import { fetchStoreOnboardingStatuses, type StoreBlueprintStatuses, type StoreSignoffStatuses } from "../services/storeOnboardingStatusApi";
import { exportStoresToExcel } from "../services/storesExcelExport";
import {
  syncStoresToGraphWorkbook,
  pullStatusUpdatesFromGraph,
  patchSingleStoreStatusInGraph,
  patchSingleStoreAssigneeInGraph,
  patchSingleStoreVariableAssigneeInGraph,
  patchSingleStoreNotWorkedInGraph,
  syncProdDealersToGraph,
} from "../services/storesGraphSync";
import { buildLatestFieldTrackingText } from "../services/storesExcelShared";
import { isSetupDataComplete, fetchSetupDataForStore } from "../services/storeSetupDataService";
import { isUserAdmin } from "../services/authHelper";
import { runSlackAlerts, maybeSendDailyDigest, dispatchAllThreeReports, isSlackSessionActive } from "../services/slackAlertsService";
import {
  ASSIGNEE_OPTIONS,
  resolveStoreAssignee,
  loadAssigneeConfig,
  reconcileAssignments,
  recordManualAssignment,
  runAutoAssign,
} from "../services/assigneeService";
import { batchFetchRealTapStatuses } from "../services/tapTasksApi";
import type { StoreBlueprintTasks } from "./DealerTasksPanel";
import { StoresAI } from "./StoresAI";
import {
  parseSlackCsv,
  cleanImpType,
  parseLaunchDate,
  formatLaunchDateUI,
  getMonthYearString,
  getMonthYearSortKey,
  getTLabel,
  toInputDate,
  startOfDayUnix,
  endOfDayUnix,
  buildTapWorkordersUrl,
  isSameLocalDay,
  getPodStyle,
} from "./stores-components/storesHelpers";
import { StatusChipGroup, SetupDataCell, CustomStatusSelect } from "./stores-components/StoreTableCells";
import { DealerMetaModal } from "./stores-components/DealerMetaModal";
import {
  executePreprodMapPipeline,
  storeCapturedMapHeaders,
  type PreprodValidationResult,
} from "../services/preprodMapApiService";
import "./Stores.css";

interface Props {
  onBack: () => void;
}

export type AssigneeName = typeof ASSIGNEE_OPTIONS[number];
export type ExtendedTRange = TRange | "ALL";

export type ExtendedStoreRecord = StoreRecord & {
  fetched_blueprint_tasks?: StoreBlueprintTasks;
  custom_assignee?: AssigneeName | string;
  custom_variable_assignee?: AssigneeName | string;
  fixed_ops_attachments?: number;
  variable_ops_attachments?: number;
  attachments_incomplete?: boolean;
  preprod_validation?: PreprodValidationResult;
};

const logger = {
  info: (...args: unknown[]) => console.info("[Stores]", ...args),
  debug: (...args: unknown[]) => console.debug("[Stores]", ...args),
  warn: (...args: unknown[]) => console.warn("[Stores]", ...args),
  error: (...args: unknown[]) => console.error("[Stores]", ...args),
};

const STATIC_SLACK_MAP = parseSlackCsv(typeof slackCsvText === "string" ? slackCsvText : "");

const BLUEPRINT_CHECKBOX_KEYS = [
  { key: "parts", label: "Parts BP Completed" },
  { key: "service", label: "Service BP Completed" },
  { key: "accounting", label: "Accounting BP Completed" },
  { key: "crm", label: "CRM BP Completed" },
  { key: "analytics", label: "Analytics BP Completed" },
] as const;

type BlueprintCheckboxKey = typeof BLUEPRINT_CHECKBOX_KEYS[number]["key"];

const ENTERPRISE_TENANTS = new Set([
  "kengarffautomotive",
  "asburyautomotivemanagementllc",
]);

function resolveDefaultNotWorked(store: StoreRecord, existingValue?: string): string {
  if (existingValue && existingValue.trim()) return existingValue;
  const tenantCandidate = (store.tenant_code || (store as any).tenant_name || "").toLowerCase().trim();
  if (ENTERPRISE_TENANTS.has(tenantCandidate)) {
    return "Enterprise";
  }
  return store.not_worked || "";
}

function isBlueprintDone(status: unknown): boolean {
  if (!status) return false;
  if (typeof status === "string") {
    const s = status.trim().toUpperCase();
    return s === "COMPLETED" || s === "DONE" || s === "COMPLETE" || s === "TRUE";
  }
  if (typeof status === "boolean") return status;
  return false;
}

function getDealerTextColor(fixedOpsStatus?: string): string {
  const norm = (fixedOpsStatus || "").trim().toUpperCase();
  if (norm === "COMPLETED" || norm === "DONE" || norm === "COMPLETE") {
    return "#4ade80"; // Green
  }
  if (
    norm === "WIP" ||
    norm === "IN PROGRESS" ||
    norm === "TO DO" ||
    norm === "TO" ||
    norm.includes("PROGRESS") ||
    norm.includes("WIP")
  ) {
    return "#facc15"; // Yellow
  }
  return "#f1f5f9"; // Default clean light gray
}

function mergeIncomingStore(existing: ExtendedStoreRecord | undefined, incoming: StoreRecord): ExtendedStoreRecord {
  if (!existing) return incoming as ExtendedStoreRecord;
  const merged: Record<string, any> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    const blank =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0);
    if (!blank) merged[key] = value;
  }
  return merged as ExtendedStoreRecord;
}

function safelyMergeStatusFields(prevRecords: ExtendedStoreRecord[], updatedStores: StoreRecord[]): ExtendedStoreRecord[] {
  const prevMap = new Map(prevRecords.map((s) => [s.tekion_id, s]));
  return updatedStores.map((uStore) => {
    const prev = prevMap.get(uStore.tekion_id);
    if (!prev) return uStore as ExtendedStoreRecord;
    return {
      ...prev,
      fixed_ops_status: uStore.fixed_ops_status,
      variable_ops_status: uStore.variable_ops_status,
      testing_status: uStore.testing_status,
      not_worked: uStore.not_worked ?? prev.not_worked,
      custom_assignee: (uStore as any).custom_assignee ?? prev.custom_assignee,
      custom_variable_assignee: (uStore as any).custom_variable_assignee ?? prev.custom_variable_assignee,
      fixed_ops_attachments: (uStore as any).fixed_ops_attachments ?? prev.fixed_ops_attachments,
      variable_ops_attachments: (uStore as any).variable_ops_attachments ?? prev.variable_ops_attachments,
      fetched_blueprint_tasks: (uStore as any).fetched_blueprint_tasks ?? prev.fetched_blueprint_tasks,
      attachments_incomplete: (uStore as any).attachments_incomplete ?? prev.attachments_incomplete,
      preprod_validation: (uStore as any).preprod_validation ?? prev.preprod_validation,
    };
  });
}

function withOnboardingStatuses(
  stores: ExtendedStoreRecord[],
  statusMap: Record<string, { blueprint_statuses: StoreBlueprintStatuses; signoff_statuses: StoreSignoffStatuses }>
): ExtendedStoreRecord[] {
  const fetchedAt = new Date().toISOString();
  return stores.map((store) => {
    const statuses = statusMap[store.tekion_id];
    return {
      ...store,
      blueprint_statuses: statuses?.blueprint_statuses,
      signoff_statuses: statuses?.signoff_statuses,
      onboarding_status_fetched_at: fetchedAt,
    };
  });
}

const filterInputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "#0f172a",
  color: "#f8fafc",
  border: "1px solid rgba(148, 163, 248, 0.25)",
  borderRadius: 4,
  padding: "3px 6px",
  fontSize: 11,
  outline: "none",
  height: 26,
  verticalAlign: "middle",
};

export const Stores: React.FC<Props> = ({ onBack }) => {
  const [records, setRecords] = useState<ExtendedStoreRecord[]>([]);
  const [loadingStores, setLoadingStores] = useState(false);
  const [syncingExcel, setSyncingExcel] = useState(false);
  const [loadingSetupAll, setLoadingSetupAll] = useState(false);
  const [dispatching3Reports, setDispatching3Reports] = useState(false);
  const [syncingTapStatuses, setSyncingTapStatuses] = useState(false);
  const [tapSyncProgress, setTapSyncProgress] = useState("");

  const [error, setError] = useState("");
  const [tokenExpiredMessage, setTokenExpiredMessage] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [trackingTick, setTrackingTick] = useState(0);

  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // Global Sidebar Filter States
  const [range, setRange] = useState<ExtendedTRange>(90);
  const [search, setSearch] = useState("");
  const [superpodId, setSuperpodId] = useState("");
  const [implementationType, setImplementationType] = useState("");
  const [activeDealerPopup, setActiveDealerPopup] = useState<ExtendedStoreRecord | null>(null);

  // Per-Column Filter States
  const [colFilterStore, setColFilterStore] = useState("");
  const [colFilterMonth, setColFilterMonth] = useState("");
  const [colFilterImpType, setColFilterImpType] = useState<string>("");
  const [colFilterProduct, setColFilterProduct] = useState<string>("");
  const [colFilterPreProd, setColFilterPreProd] = useState<string>("");
  const [colFilterPod, setColFilterPod] = useState<string>("");

  // Multi-checkbox Blueprint Filter State with Portal Tracking
  const [selectedBlueprintChecks, setSelectedBlueprintChecks] = useState<BlueprintCheckboxKey[]>([]);
  const [isBlueprintDropdownOpen, setIsBlueprintDropdownOpen] = useState(false);
  const [blueprintDropdownPos, setBlueprintDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const blueprintButtonRef = useRef<HTMLButtonElement>(null);
  const blueprintPopupRef = useRef<HTMLDivElement>(null);

  const [colFilterSetupData, setColFilterSetupData] = useState<string>("");
  const [colFilterFixedAssignee, setColFilterFixedAssignee] = useState<string>("");
  const [colFilterVarAssignee, setColFilterVarAssignee] = useState<string>("");
  const [colFilterFixedStatus, setColFilterFixedStatus] = useState<string>("");
  const [colFilterVarStatus, setColFilterVarStatus] = useState<string>("");
  const [colFilterTestingStatus, setColFilterTestingStatus] = useState<string>("");
  const [colFilterNotWorked, setColFilterNotWorked] = useState<string>("");

  useEffect(() => {
    const handleBridgeMessage = (event: MessageEvent) => {
      if (event.data?.type === "ARC_EXTENSION_SYNC_CAPTURE" && event.data?.payload?.preprodMapHeaders) {
        storeCapturedMapHeaders(event.data.payload.preprodMapHeaders);
      }
    };
    window.addEventListener("message", handleBridgeMessage);
    return () => window.removeEventListener("message", handleBridgeMessage);
  }, []);

  // Multi-menu Outside Click Handler
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        blueprintButtonRef.current &&
        !blueprintButtonRef.current.contains(target) &&
        blueprintPopupRef.current &&
        !blueprintPopupRef.current.contains(target)
      ) {
        setIsBlueprintDropdownOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(target)) {
        setIsMoreMenuOpen(false);
      }
    };

    const handleScrollOrResize = () => {
      if (isBlueprintDropdownOpen && blueprintButtonRef.current) {
        const rect = blueprintButtonRef.current.getBoundingClientRect();
        setBlueprintDropdownPos({ top: rect.bottom + 4, left: rect.left });
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [isBlueprintDropdownOpen]);

  const toggleBlueprintFilter = (key: BlueprintCheckboxKey) => {
    setSelectedBlueprintChecks((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const currentModalRecord = useMemo(() => {
    if (!activeDealerPopup) return null;
    const latest = records.find((r) => r.tekion_id === activeDealerPopup.tekion_id) || activeDealerPopup;
    const resolvedProjectId = resolveStoreProjectId(latest);
    return {
      ...latest,
      onboarding_project_id: resolvedProjectId || latest.onboarding_project_id,
    };
  }, [activeDealerPopup, records]);

  const presetRange = useMemo(() => (range === "ALL" ? null : getTDaysRange(range)), [range]);
  const [fromDate, setFromDate] = useState(() => (presetRange ? toInputDate(presetRange.fromDate) : ""));
  const [toDate, setToDate] = useState(() => (presetRange ? toInputDate(presetRange.toDate) : ""));

  useEffect(() => {
    if (range === "ALL") {
      setFromDate("");
      setToDate("");
    } else if (presetRange) {
      setFromDate(toInputDate(presetRange.fromDate));
      setToDate(toInputDate(presetRange.toDate));
    }
  }, [range, presetRange]);

  const tapWorkordersUrl = useMemo(() => buildTapWorkordersUrl(fromDate, toDate), [fromDate, toDate]);
  const [botState, setBotState] = useState<BotState>(() => storesBotRunner.getState());

  useEffect(() => {
    const unsubscribe = storesBotRunner.subscribe((state) => setBotState(state));
    return () => unsubscribe();
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => setToastMessage(""), 3500);
  }, []);

  const handleCopy = useCallback((text: string, keyIdentifier: string) => {
    void navigator.clipboard.writeText(text || "");
    setCopiedKey(keyIdentifier);
    window.setTimeout(() => setCopiedKey(null), 1200);
  }, []);

  const loadStatusesForStores = useCallback(async (stores: ExtendedStoreRecord[]) => {
    const tekionIds = stores.map((item) => item.tekion_id).filter(Boolean);
    if (tekionIds.length === 0) return;
    try {
      const statusMap = await fetchStoreOnboardingStatuses(tekionIds, { chunkSize: 25, concurrency: 3 });
      setRecords((prevRecords) => {
        const baseStores = prevRecords.length > 0 ? prevRecords : stores;
        const merged = withOnboardingStatuses(baseStores, statusMap);
        void saveStores(merged);
        return merged;
      });
    } catch (err: unknown) {
      logger.error("Failed to fetch onboarding statuses", err);
    }
  }, []);

  const handleFetch = useCallback(async (forceStatusRefresh = true) => {
    setLoadingStores(true);
    setError("");
    setTokenExpiredMessage("");
    try {
      const fetchRange: TRange = range === "ALL" ? 150 : range;
      const rawStores = await fetchStores(fetchRange);
      const existingDbStores = await getStores();
      const existingMap = new Map(existingDbStores.map((s) => [s.tekion_id, s]));
      const vault = getStoredStatusVault();

      const fetchedStores: ExtendedStoreRecord[] = Array.from(
        new Map<string, ExtendedStoreRecord>(
          rawStores.map((store) => {
            const existing = existingMap.get(store.tekion_id) as ExtendedStoreRecord | undefined;
            const override = vault[store.tekion_id];
            const base = mergeIncomingStore(existing, store);
            const resolvedNotWorked = resolveDefaultNotWorked(store, override?.not_worked || existing?.not_worked);

            return [
              store.tekion_id,
              {
                ...base,
                onboarding_project_id: store.onboarding_project_id || existing?.onboarding_project_id,
                ds_onboarding_project_id: store.ds_onboarding_project_id || existing?.ds_onboarding_project_id,
                fixed_ops_status: override?.fixed_ops_status || existing?.fixed_ops_status || existing?.configuration_status || "TO DO",
                variable_ops_status: override?.variable_ops_status || existing?.variable_ops_status || existing?.configuration_status || "TO DO",
                testing_status: override?.testing_status || existing?.testing_status || existing?.configuration_status || "TO DO",
                not_worked: resolvedNotWorked,
                custom_assignee: override?.custom_assignee || existing?.custom_assignee || (store as any).custom_assignee,
                custom_variable_assignee: override?.custom_variable_assignee || existing?.custom_variable_assignee || (store as any).custom_variable_assignee,
              },
            ];
          })
        ).values()
      );

      const fetchedIds = new Set(fetchedStores.map((s) => s.tekion_id));
      const uniqueStores: ExtendedStoreRecord[] = [
        ...fetchedStores,
        ...(existingDbStores as ExtendedStoreRecord[]).filter((s) => !fetchedIds.has(s.tekion_id)),
      ];

      setRecords(uniqueStores);
      await saveStores(uniqueStores);
      showToast(`✅ Refreshed ${fetchedStores.length} stores`);

      void (async () => {
        try {
          const { updatedStores, hasChanges } = await pullStatusUpdatesFromGraph(uniqueStores);
          const storesForProd = hasChanges ? updatedStores : uniqueStores;
          if (hasChanges) {
            setRecords((prev) => {
              const safelyMerged = safelyMergeStatusFields(prev, updatedStores);
              void saveStores(safelyMerged);
              bulkUpdateStatusVault(
                safelyMerged.map((s) => ({
                  tekionId: s.tekion_id,
                  fixed_ops_status: s.fixed_ops_status,
                  variable_ops_status: s.variable_ops_status,
                  testing_status: s.testing_status,
                  custom_assignee: s.custom_assignee,
                  custom_variable_assignee: s.custom_variable_assignee,
                  not_worked: s.not_worked,
                }))
              );
              return safelyMerged;
            });
            setTrackingTick((prev) => prev + 1);
          }
          void syncProdDealersToGraph(storesForProd);
        } catch (e) {
          logger.debug("Background Excel check skipped on fetch:", e);
        }
      })();

      if (forceStatusRefresh) {
        void loadStatusesForStores(uniqueStores);
      }
    } catch (err: unknown) {
      if (err instanceof ExpiredCaptureTokenError) {
        setTokenExpiredMessage(err.message);
        setError("");
      } else {
        setError(err instanceof Error ? err.message : "Failed to fetch stores");
      }
    } finally {
      setLoadingStores(false);
    }
  }, [range, loadStatusesForStores, showToast]);

  const handleLoadIndexedDb = useCallback(async () => {
    try {
      const rawData = await getStores();
      const vault = getStoredStatusVault();
      const uniqueData: ExtendedStoreRecord[] = Array.from(
        new Map<string, ExtendedStoreRecord>(
          rawData.map((store) => {
            const override = vault[store.tekion_id];
            const resolvedNotWorked = resolveDefaultNotWorked(store, override?.not_worked || store.not_worked);

            return [
              store.tekion_id,
              {
                ...store,
                fixed_ops_status: override?.fixed_ops_status || store.fixed_ops_status || store.configuration_status || "TO DO",
                variable_ops_status: override?.variable_ops_status || store.variable_ops_status || store.configuration_status || "TO DO",
                testing_status: override?.testing_status || store.testing_status || store.configuration_status || "TO DO",
                not_worked: resolvedNotWorked,
                custom_assignee: override?.custom_assignee || store.custom_assignee,
                custom_variable_assignee: override?.custom_variable_assignee || store.custom_variable_assignee,
              },
            ];
          })
        ).values()
      );

      setRecords(uniqueData);

      if (uniqueData.length > 0) {
        void (async () => {
          try {
            const { updatedStores, hasChanges } = await pullStatusUpdatesFromGraph(uniqueData);
            const storesForProd = hasChanges ? updatedStores : uniqueData;
            if (hasChanges) {
              setRecords((prev) => {
                const safelyMerged = safelyMergeStatusFields(prev, updatedStores);
                void saveStores(safelyMerged);
                bulkUpdateStatusVault(
                  safelyMerged.map((s) => ({
                    tekionId: s.tekion_id,
                    fixed_ops_status: s.fixed_ops_status,
                    variable_ops_status: s.variable_ops_status,
                    testing_status: s.testing_status,
                    custom_assignee: s.custom_assignee,
                    custom_variable_assignee: s.custom_variable_assignee,
                    not_worked: s.not_worked,
                  }))
                );
                return safelyMerged;
              });
              setTrackingTick((prev) => prev + 1);
              showToast("⚡ Cache updated from Excel");
            }
            void syncProdDealersToGraph(storesForProd);
          } catch (e) {
            logger.debug("Initial Excel cache pull skipped:", e);
          }
        })();
      }

      if (uniqueData.some((row) => !isSameLocalDay(row.onboarding_status_fetched_at)) && uniqueData.length > 0) {
        void loadStatusesForStores(uniqueData);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load IndexedDB data");
    }
  }, [loadStatusesForStores, showToast]);

  useEffect(() => {
    void handleLoadIndexedDb();
  }, [handleLoadIndexedDb]);

  const updateCustomStatus = async (
    tekion_id: string,
    field: "fixed_ops_status" | "variable_ops_status" | "testing_status",
    value: CustomPhaseStatus
  ) => {
    const currentRecord = records.find((r) => r.tekion_id === tekion_id);
    const currentStatus = currentRecord ? currentRecord[field] : "TO DO";

    if (!isUserAdmin() && currentStatus === "Completed" && value !== "Completed") {
      showToast("🔒 Only tlreddy@tekion.com has permission to revert Completed tasks.");
      return;
    }

    setRecords((prev) => {
      const updatedRecords = prev.map((r) => (r.tekion_id === tekion_id ? { ...r, [field]: value } : r));
      void saveStores(updatedRecords).catch((err) => logger.error("Failed to save DB", err));
      return updatedRecords;
    });

    saveStatusToVault(tekion_id, field, value);
    recordStatusTransition(tekion_id, field, value);
    setTrackingTick((prev) => prev + 1);

    void (async () => {
      const success = await patchSingleStoreStatusInGraph(tekion_id, field, value);
      if (success) {
        showToast(`✅ Synced ${value} to Excel`);
      } else {
        showToast(`⚠ Updated locally (Excel sync pending)`);
      }
    })();
  };

  const updateStoreNotWorked = useCallback(async (tekion_id: string, value: string) => {
    setRecords((prev) => {
      const updated = prev.map((r) => (r.tekion_id === tekion_id ? { ...r, not_worked: value } : r));
      void saveStores(updated).catch((err) => logger.error("Failed saving not_worked", err));
      return updated;
    });
    saveNotWorkedToVault(tekion_id, value);
    bulkUpdateStatusVault([{ tekionId: tekion_id, not_worked: value }]);
    showToast(`✅ Updated 'Not Worked?' to ${value || "Handled by ARC"}`);
    void (async () => {
      const success = await patchSingleStoreNotWorkedInGraph(tekion_id, value);
      if (success) showToast(`✅ Synced 'Not Worked?' to Excel`);
    })();
  }, [showToast]);

  const updateStoreFixedAssignee = useCallback(async (tekion_id: string, newAssignee: AssigneeName | "") => {
    const target = records.find((r) => r.tekion_id === tekion_id);
    if (target) recordManualAssignment(target, newAssignee);
    setRecords((prev) => {
      const updated = prev.map((r) => (r.tekion_id === tekion_id ? { ...r, custom_assignee: newAssignee } : r));
      void saveStores(updated).catch((err) => logger.error("Failed saving assignee", err));
      return updated;
    });
    bulkUpdateStatusVault([{ tekionId: tekion_id, custom_assignee: newAssignee }]);
    showToast(`✅ Assigned Fixed Ops to ${newAssignee || "Unassigned"}`);
    void (async () => {
      const success = await patchSingleStoreAssigneeInGraph(tekion_id, newAssignee);
      if (success) showToast(`✅ Synced Fixed Ops Assignee to Excel`);
    })();
  }, [showToast, records]);

  const updateStoreVariableAssignee = useCallback(async (tekion_id: string, newAssignee: AssigneeName | "") => {
    setRecords((prev) => {
      const updated = prev.map((r) => (r.tekion_id === tekion_id ? { ...r, custom_variable_assignee: newAssignee } : r));
      void saveStores(updated).catch((err) => logger.error("Failed saving variable assignee", err));
      return updated;
    });
    bulkUpdateStatusVault([{ tekionId: tekion_id, custom_variable_assignee: newAssignee }]);
    showToast(`✅ Assigned Variable Ops to ${newAssignee || "Unassigned"}`);
    void (async () => {
      const success = await patchSingleStoreVariableAssigneeInGraph(tekion_id, newAssignee);
      if (success) showToast(`✅ Synced Variable Ops Assignee to Excel`);
    })();
  }, [showToast]);

  const handleTasksSnapshot = useCallback((tekionId: string, tasks: any, complete: boolean) => {
    const sum = (list: any[]) =>
      (list || []).reduce((acc, t) => acc + Number(t.taskAttachmentCount ?? t.attachments?.length ?? 0), 0);
    const fixedNow = sum(tasks.parts) + sum(tasks.service);
    const varNow = sum(tasks.accounting);

    setRecords((prev) => {
      let changed: ExtendedStoreRecord | null = null;
      const next = prev.map((r) => {
        if (r.tekion_id !== tekionId) return r;
        const fixed = complete ? fixedNow : Math.max(r.fixed_ops_attachments ?? 0, fixedNow);
        const variable = complete ? varNow : Math.max(r.variable_ops_attachments ?? 0, varNow);
        if (fixed === r.fixed_ops_attachments && variable === r.variable_ops_attachments && r.attachments_incomplete === !complete) {
          return r;
        }
        changed = {
          ...r,
          fixed_ops_attachments: fixed,
          variable_ops_attachments: variable,
          attachments_incomplete: !complete,
          fetched_blueprint_tasks: {
            partsTasks: tasks.parts,
            serviceTasks: tasks.service,
            accountingTasks: tasks.accounting,
            fetchedAt: new Date().toISOString(),
          },
        };
        return changed;
      });
      if (changed) void saveStores([changed]);
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    if (records.length === 0) return;
    void runSlackAlerts(records).then((n) => {
      if (n > 0) showToast(`🔔 Sent ${n} alert(s) to Slack`);
    });
    void maybeSendDailyDigest(records);
  }, [records, showToast]);

  useEffect(() => {
    if (records.length === 0) return;
    reconcileAssignments(records);
    const config = loadAssigneeConfig();
    if (!config.autoAssignEnabled) return;

    const { updated, events } = runAutoAssign(records, config);
    if (!updated.length) return;

    const byId = new Map(updated.map((u) => [u.tekion_id, u as ExtendedStoreRecord]));
    setRecords((prev) => {
      const next = prev.map((r) => {
        const u = byId.get(r.tekion_id);
        return u && !r.custom_assignee ? { ...r, custom_assignee: u.custom_assignee } : r;
      });
      void saveStores(next);
      return next;
    });
    showToast(`🤖 Auto-assigned ${events.length} store(s)`);

    void (async () => {
      for (const u of updated) {
        try {
          await patchSingleStoreAssigneeInGraph(u.tekion_id, String((u as ExtendedStoreRecord).custom_assignee));
        } catch {}
      }
    })();
  }, [records, showToast]);

  useEffect(() => {
    let isCancelled = false;
    const checkForExcelUpdates = async () => {
      if (records.length === 0 || syncingExcel) return;
      const { updatedStores, hasChanges } = await pullStatusUpdatesFromGraph(records);
      const activeList = updatedStores.length > 0 ? updatedStores : records;

      if (!isCancelled && hasChanges) {
        setRecords((prev) => {
          const merged = safelyMergeStatusFields(prev, updatedStores);
          void saveStores(merged);
          bulkUpdateStatusVault(
            merged.map((s) => ({
              tekionId: s.tekion_id,
              fixed_ops_status: s.fixed_ops_status,
              variable_ops_status: s.variable_ops_status,
              testing_status: s.testing_status,
              custom_assignee: s.custom_assignee,
              custom_variable_assignee: s.custom_variable_assignee,
              not_worked: s.not_worked,
            }))
          );
          return merged;
        });
        setTrackingTick((prev) => prev + 1);
        showToast("⚡ Auto-synced updates from Excel");
      }
      void syncProdDealersToGraph(activeList);
    };

    const interval = setInterval(() => void checkForExcelUpdates(), 12000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForExcelUpdates();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isCancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [records, syncingExcel, showToast]);

  const superpodOptions = useMemo(
    () => Array.from(new Set(records.map((r) => r.superpod_id).filter(Boolean))).sort(),
    [records]
  );
  const implementationTypeOptions = useMemo(
    () => Array.from(new Set(records.map((r) => cleanImpType(r.implementation_type)).filter(Boolean))).sort(),
    [records]
  );
  const productTypeOptions = useMemo(() => ["ARC", "CRM", "Analytics"], []);

  const phaseStatusOptions = useMemo(() => {
    const set = new Set<string>();
    records.forEach((r) => {
      if (r.fixed_ops_status) set.add(r.fixed_ops_status);
      if (r.variable_ops_status) set.add(r.variable_ops_status);
      if (r.testing_status) set.add(r.testing_status);
    });
    if (set.size === 0) {
      set.add("TO DO");
      set.add("In Progress");
      set.add("Completed");
    }
    return Array.from(set).filter(Boolean).sort();
  }, [records]);

  const monthOptions = useMemo(() => {
    const map = new Map<string, number>();
    records.forEach((r) => {
      const label = getMonthYearString(r.launch_date);
      if (label) map.set(label, getMonthYearSortKey(r.launch_date));
    });
    return Array.from(map.entries()).sort((a, b) => a[1] - b[1]).map((entry) => entry[0]);
  }, [records]);

  const clearColumnFilters = useCallback(() => {
    setColFilterStore("");
    setColFilterMonth("");
    setColFilterImpType("");
    setColFilterProduct("");
    setColFilterPreProd("");
    setColFilterPod("");
    setSelectedBlueprintChecks([]);
    setColFilterSetupData("");
    setColFilterFixedAssignee("");
    setColFilterVarAssignee("");
    setColFilterFixedStatus("");
    setColFilterVarStatus("");
    setColFilterTestingStatus("");
    setColFilterNotWorked("");
  }, []);

  const hasAnyColumnFilter = useMemo(() => {
    return Boolean(
      colFilterStore ||
      colFilterMonth ||
      colFilterImpType ||
      colFilterProduct ||
      colFilterPreProd ||
      colFilterPod ||
      selectedBlueprintChecks.length > 0 ||
      colFilterSetupData ||
      colFilterFixedAssignee ||
      colFilterVarAssignee ||
      colFilterFixedStatus ||
      colFilterVarStatus ||
      colFilterTestingStatus ||
      colFilterNotWorked
    );
  }, [
    colFilterStore,
    colFilterMonth,
    colFilterImpType,
    colFilterProduct,
    colFilterPreProd,
    colFilterPod,
    selectedBlueprintChecks.length,
    colFilterSetupData,
    colFilterFixedAssignee,
    colFilterVarAssignee,
    colFilterFixedStatus,
    colFilterVarStatus,
    colFilterTestingStatus,
    colFilterNotWorked,
  ]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromUnix = fromDate ? startOfDayUnix(fromDate) : null;
    const toUnix = toDate ? endOfDayUnix(toDate) : null;

    const cStore = colFilterStore.trim().toLowerCase();
    const cPreProd = colFilterPreProd.trim().toLowerCase();

    return records
      .filter((item) => {
        const fixedAssignee = resolveStoreAssignee(item);
        const variableAssignee = item.custom_variable_assignee || "";

        const matchesSearch =
          !q ||
          item.tekion_id.toLowerCase().includes(q) ||
          item.dealer_id.toLowerCase().includes(q) ||
          item.dba_name.toLowerCase().includes(q) ||
          fixedAssignee.toLowerCase().includes(q) ||
          variableAssignee.toLowerCase().includes(q) ||
          (item.not_worked && item.not_worked.toLowerCase().includes(q)) ||
          (item.tenant_code && item.tenant_code.toLowerCase().includes(q)) ||
          (item.tenant_id && item.tenant_id.toLowerCase().includes(q));

        const matchesSuperpod = !superpodId || item.superpod_id === superpodId;
        const normalizedImp = cleanImpType(item.implementation_type);
        const matchesImplementationType = !implementationType || normalizedImp === implementationType;

        const launch = parseLaunchDate(item.launch_date);
        const launchUnix = launch ? Math.floor(launch.getTime() / 1000) : null;
        const matchesDate =
          (!fromUnix || (launchUnix !== null && launchUnix >= fromUnix)) &&
          (!toUnix || (launchUnix !== null && launchUnix <= toUnix));

        if (
          !matchesSearch ||
          !matchesSuperpod ||
          !matchesImplementationType ||
          !matchesDate
        ) {
          return false;
        }

        if (
          cStore &&
          !(
            item.tekion_id.toLowerCase().includes(cStore) ||
            item.dealer_id.toLowerCase().includes(cStore) ||
            (item.dba_name || "").toLowerCase().includes(cStore)
          )
        ) {
          return false;
        }

        if (colFilterMonth && getMonthYearString(item.launch_date) !== colFilterMonth) {
          return false;
        }

        if (colFilterImpType && normalizedImp !== colFilterImpType) {
          return false;
        }

        if (colFilterProduct && !(item.product_types || "").toLowerCase().includes(colFilterProduct.toLowerCase())) {
          return false;
        }

        if (cPreProd && !(item.pre_production_environment_status || "").toLowerCase().includes(cPreProd)) {
          return false;
        }

        if (colFilterPod && item.superpod_id !== colFilterPod) {
          return false;
        }

        if (selectedBlueprintChecks.length > 0) {
          const bp = item.blueprint_statuses;
          if (!bp) return false;

          for (const reqCheck of selectedBlueprintChecks) {
            if (reqCheck === "parts" && !isBlueprintDone(bp.parts)) return false;
            if (reqCheck === "service" && !isBlueprintDone(bp.service)) return false;
            if (reqCheck === "accounting" && !isBlueprintDone(bp.accounting)) return false;
            if (reqCheck === "crm" && !isBlueprintDone(bp.crm)) return false;
            if (reqCheck === "analytics" && !isBlueprintDone(bp.analytics)) return false;
          }
        }

        if (colFilterSetupData) {
          const isComplete = isSetupDataComplete(item);
          if (colFilterSetupData === "COMPLETE" && !isComplete) return false;
          if (colFilterSetupData === "INCOMPLETE" && (isComplete || Boolean(item.setup_data_error))) return false;
          if (colFilterSetupData === "ERROR" && !item.setup_data_error) return false;
        }

        if (colFilterFixedAssignee) {
          if (colFilterFixedAssignee === "UNASSIGNED") {
            if (fixedAssignee) return false;
          } else if (fixedAssignee !== colFilterFixedAssignee) {
            return false;
          }
        }

        if (colFilterVarAssignee) {
          if (colFilterVarAssignee === "UNASSIGNED") {
            if (variableAssignee) return false;
          } else if (variableAssignee !== colFilterVarAssignee) {
            return false;
          }
        }

        if (colFilterFixedStatus && item.fixed_ops_status !== colFilterFixedStatus) {
          return false;
        }

        if (colFilterVarStatus && item.variable_ops_status !== colFilterVarStatus) {
          return false;
        }

        if (colFilterTestingStatus && item.testing_status !== colFilterTestingStatus) {
          return false;
        }

        if (colFilterNotWorked) {
          if (colFilterNotWorked === "HANDLED_BY_ARC") {
            if (item.not_worked && item.not_worked.trim() !== "") return false;
          } else if (item.not_worked !== colFilterNotWorked) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        const aDate = parseLaunchDate(a.launch_date);
        const bDate = parseLaunchDate(b.launch_date);
        return (aDate ? aDate.getTime() : Number.MAX_SAFE_INTEGER) - (bDate ? bDate.getTime() : Number.MAX_SAFE_INTEGER);
      });
  }, [
    records,
    search,
    superpodId,
    implementationType,
    fromDate,
    toDate,
    colFilterStore,
    colFilterMonth,
    colFilterImpType,
    colFilterProduct,
    colFilterPreProd,
    colFilterPod,
    selectedBlueprintChecks,
    colFilterSetupData,
    colFilterFixedAssignee,
    colFilterVarAssignee,
    colFilterFixedStatus,
    colFilterVarStatus,
    colFilterTestingStatus,
    colFilterNotWorked,
  ]);

  const persistSetupData = useCallback(async (tekionId: string, setupData: StoreSetupData) => {
    setRecords((prev) => {
      const updated = prev.map((row) =>
        row.tekion_id === tekionId
          ? { ...row, setup_data: setupData, setup_data_fetched_at: setupData.fetchedAt, setup_data_error: "" }
          : row
      );
      void saveStores(updated);
      return updated;
    });
  }, []);

  const handleFetchSetupVisible = useCallback(async () => {
    setLoadingSetupAll(true);
    let fetched = 0;
    let skipped = 0;
    let failed = 0;
    let mapFallbacks = 0;

    try {
      const latestMap = new Map(records.map((r) => [r.tekion_id, r]));
      const queue = filtered.filter((row) => {
        const current = latestMap.get(row.tekion_id) ?? row;
        const complete = isSetupDataComplete(current);
        if (complete) skipped++;
        return !complete;
      });

      for (let i = 0; i < queue.length; i++) {
        const current = latestMap.get(queue[i].tekion_id) ?? queue[i];
        setTapSyncProgress(`Setup ${i + 1}/${queue.length}`);

        let setupData: StoreSetupData | undefined;
        let setupError = "";

        try {
          setupData = await fetchSetupDataForStore(current, { force: true });
        } catch (err: unknown) {
          setupError = err instanceof Error ? err.message : "Setup Data Fetch Failed";
        }

        const isNowComplete = setupData ? isSetupDataComplete({ ...current, setup_data: setupData }) : false;

        let preprodValidation: PreprodValidationResult | undefined;
        if (!isNowComplete) {
          const tenantCandidate = current.tenant_code || (current as any).tenant_name || "";
          if (tenantCandidate) {
            setTapSyncProgress(`MAP Fallback ${i + 1}/${queue.length}`);
            try {
              preprodValidation = await executePreprodMapPipeline(tenantCandidate, current.dealer_id);
              mapFallbacks++;
            } catch (mapErr) {
              logger.warn(`MAP fallback failed for ${tenantCandidate}:`, mapErr);
            }
          }
        }

        setRecords((prev) => {
          const updated = prev.map((row) =>
            row.tekion_id === current.tekion_id
              ? {
                  ...row,
                  ...(setupData
                    ? { setup_data: setupData, setup_data_fetched_at: setupData.fetchedAt }
                    : {}),
                  setup_data_error: setupError,
                  preprod_validation: preprodValidation ?? row.preprod_validation,
                }
              : row
          );
          void saveStores(updated);
          return updated;
        });

        if (setupData && isNowComplete) {
          fetched++;
        } else {
          failed++;
        }
      }

      showToast(
        `✅ Processed ${queue.length} stores (${fetched} setup complete, ${skipped} already complete, ${mapFallbacks} fallback MAP verified)`
      );
    } catch (error: unknown) {
      showToast(`❌ ${error instanceof Error ? error.message : "Failed batch fetch"}`);
    } finally {
      setTapSyncProgress("");
      setLoadingSetupAll(false);
    }
  }, [filtered, records, showToast]);

  const handleSendAllThreeReportsManual = async () => {
    if (records.length === 0) {
      showToast("❌ No store records available to evaluate.");
      return;
    }
    if (!isSlackSessionActive()) {
      showToast("❌ Slack session inactive. Please connect Slack first.");
      return;
    }
    setDispatching3Reports(true);
    try {
      const result = await dispatchAllThreeReports(records, { force: true });
      if (result.sent) {
        showToast("✅ Sent Analytics, Fixed Ops & Variable Ops reports to Slack! (4-hr timer reset)");
      } else {
        showToast(`⚠ ${result.reason || "Failed to dispatch reports"}`);
      }
    } catch (err: unknown) {
      showToast(`❌ ${err instanceof Error ? err.message : "Failed to dispatch reports"}`);
    } finally {
      setDispatching3Reports(false);
    }
  };

  const handleSyncRealTapStatuses = async () => {
    if (records.length === 0) {
      showToast("❌ No store records available to evaluate.");
      return;
    }
    setSyncingTapStatuses(true);
    setTapSyncProgress("Starting TAP scan...");
    try {
      const { updatedStores, updatedCount } = await batchFetchRealTapStatuses(
        records,
        (processed, total, updated) => setTapSyncProgress(`${processed}/${total} (Updated: ${updated})`),
        (updatedStore) => {
          setRecords((prev) => safelyMergeStatusFields(prev, prev.map((r) => (r.tekion_id === updatedStore.tekion_id ? updatedStore : r))));
          void saveStores([updatedStore]);
        }
      );

      if (updatedCount > 0) {
        setRecords((prev) => {
          const merged = safelyMergeStatusFields(prev, updatedStores);
          void saveStores(merged);
          bulkUpdateStatusVault(
            merged.map((s) => ({
              tekionId: s.tekion_id,
              fixed_ops_status: s.fixed_ops_status,
              variable_ops_status: s.variable_ops_status,
              testing_status: s.testing_status,
              custom_assignee: s.custom_assignee,
              custom_variable_assignee: s.custom_variable_assignee,
              not_worked: s.not_worked,
            }))
          );
          return merged;
        });
        setTrackingTick((prev) => prev + 1);
        void syncStoresToGraphWorkbook(updatedStores);
        showToast(`✅ Synced real TAP statuses & attachments for ${updatedCount} store(s)!`);
      } else {
        showToast("ℹ Checked TAP tasks: No changes found.");
      }
    } catch (err: unknown) {
      showToast(`❌ ${err instanceof Error ? err.message : "TAP batch sync failed"}`);
    } finally {
      setSyncingTapStatuses(false);
      setTapSyncProgress("");
    }
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stores-t${range}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported JSON (${filtered.length} stores)`);
  };

  const handleExportExcel = () => {
    try {
      exportStoresToExcel(filtered, `stores-t${range}`);
      showToast(`✅ Excel exported (${filtered.length} rows)`);
    } catch (err: unknown) {
      showToast(`❌ ${err instanceof Error ? err.message : "Excel export failed"}`);
    }
  };

  const handleSyncExcel = async () => {
    if (records.length === 0) {
      showToast("❌ No records available to sync");
      return;
    }
    setSyncingExcel(true);
    try {
      const result = await syncStoresToGraphWorkbook(records);
      if (result.updatedStores && result.updatedStores.length > 0) {
        setRecords((prev) => {
          const merged = safelyMergeStatusFields(prev, result.updatedStores!);
          void saveStores(merged);
          bulkUpdateStatusVault(
            merged.map((s) => ({
              tekionId: s.tekion_id,
              fixed_ops_status: s.fixed_ops_status,
              variable_ops_status: s.variable_ops_status,
              testing_status: s.testing_status,
              custom_assignee: s.custom_assignee,
              custom_variable_assignee: s.custom_variable_assignee,
              not_worked: s.not_worked,
            }))
          );
          return merged;
        });
        setTrackingTick((prev) => prev + 1);
      }
      showToast(`✅ Synced & merged ${result.rowCount} stores (${result.sheetCount} sheets)`);
    } catch (err: unknown) {
      showToast(`❌ ${err instanceof Error ? err.message : "Graph sync failed"}`);
    } finally {
      setSyncingExcel(false);
    }
  };

  const clearFilters = () => {
    setSearch("");
    setSuperpodId("");
    setImplementationType("");
    setRange("ALL");
    setFromDate("");
    setToDate("");
    clearColumnFilters();
  };

  return (
    <div className="stores-shell">
      {/* Sleek, Non-Intrusive Top Bar */}
      <div className="stores-topbar">
        <div className="stores-topbar-left">
          <button className="btn-secondary btn-sm" onClick={onBack}>← Back</button>
          <div>
            <div className="stores-page-title">🏬 Store Onboarding Tracker</div>
            <div className="stores-page-subtitle">Blueprints, operational sign-offs, and go-live readiness</div>
          </div>
        </div>

        <div className="stores-topbar-right">
          {/* Live Bot Capsule */}
          <div
            className="stores-bot-capsule"
            onClick={() => storesBotRunner.setEnabled(!botState.enabled)}
            title={botState.enabled ? "Click to Pause Bot" : "Click to Enable Bot"}
          >
            <span className={`stores-bot-dot ${botState.enabled ? "on" : "off"}`} />
            <span style={{ fontWeight: 700, color: botState.enabled ? "#4ade80" : "#94a3b8" }}>
              {botState.enabled ? "Bot Active" : "Bot Paused"}
            </span>
            <span style={{ color: "#64748b", fontSize: 10 }}>
              {botState.statusText ? `• ${botState.statusText}` : ""}
            </span>
          </div>

          {/* Primary Operations Strip */}
          <div className="stores-toolbar-group">
            <button
              className="btn-secondary btn-sm"
              onClick={() => void handleFetchSetupVisible()}
              disabled={loadingSetupAll}
              title="Batch fetch setup data (and run MAP 2nd automation on errors)"
            >
              {loadingSetupAll ? "⏳ Setup..." : "🧩 Setup Data"}
            </button>
            <button
              className="btn-secondary btn-sm"
              onClick={() => void handleSyncRealTapStatuses()}
              disabled={syncingTapStatuses || Boolean(tokenExpiredMessage) || records.length === 0}
              style={{ color: "#38bdf8" }}
              title="Fetch real blueprint tasks and attachment counts from TAP"
            >
              {syncingTapStatuses ? `⏳ ${tapSyncProgress || "Syncing..."}` : "⚡ Sync TAP"}
            </button>
            <button
              className="btn-secondary btn-sm"
              onClick={() => void handleSyncExcel()}
              disabled={syncingExcel || Boolean(tokenExpiredMessage)}
              title="Two-way sync with SharePoint Excel"
            >
              {syncingExcel ? "⏳..." : "☁ Sync Excel"}
            </button>
          </div>

          {/* Secondary Utilities Dropdown Menu */}
          <div style={{ position: "relative" }} ref={moreMenuRef}>
            <button
              className="btn-secondary btn-sm"
              onClick={() => setIsMoreMenuOpen((prev) => !prev)}
              title="Exports and background tasks"
            >
              ⚙ Tools ▾
            </button>
            {isMoreMenuOpen && (
              <div
                style={{
                  position: "absolute",
                  right: 0,
                  top: "100%",
                  marginTop: 6,
                  background: "#0f172a",
                  border: "1px solid rgba(148, 163, 184, 0.2)",
                  borderRadius: 6,
                  boxShadow: "0 10px 25px -5px rgba(0,0,0,0.7)",
                  zIndex: 99999,
                  minWidth: 190,
                  padding: "4px 0",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                <button
                  type="button"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#cbd5e1",
                    textAlign: "left",
                    padding: "7px 12px",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    handleExportExcel();
                    setIsMoreMenuOpen(false);
                  }}
                >
                  📊 Export to Excel
                </button>
                <button
                  type="button"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#cbd5e1",
                    textAlign: "left",
                    padding: "7px 12px",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    exportJson();
                    setIsMoreMenuOpen(false);
                  }}
                >
                  📋 Export JSON
                </button>
                <button
                  type="button"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#cbd5e1",
                    textAlign: "left",
                    padding: "7px 12px",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    void handleLoadIndexedDb();
                    setIsMoreMenuOpen(false);
                  }}
                >
                  ⚡ Reload IndexedDB Cache
                </button>
                <div style={{ height: 1, background: "rgba(148,163,184,0.1)", margin: "4px 0" }} />
                <button
                  type="button"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#c084fc",
                    fontWeight: 700,
                    textAlign: "left",
                    padding: "7px 12px",
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                  onClick={() => {
                    void handleSendAllThreeReportsManual();
                    setIsMoreMenuOpen(false);
                  }}
                >
                  📢 Dispatch 3 Slack Reports
                </button>
              </div>
            )}
          </div>

          {/* Primary Refresh Button */}
          <button
            className="btn-postman btn-sm"
            style={{ fontWeight: 800 }}
            onClick={() => void handleFetch(true)}
            disabled={loadingStores}
          >
            {loadingStores ? "⏳ Refreshing..." : "🔄 Refresh"}
          </button>
        </div>
      </div>

      {toastMessage && <div className="stores-toast">{toastMessage}</div>}

      {tokenExpiredMessage && (
        <div className="bx-error stores-token-expired-alert">
          <span>⚠ {tokenExpiredMessage}</span>
          <a href={tapWorkordersUrl} target="_blank" rel="noreferrer">Open TAP to recapture API ↗</a>
        </div>
      )}

      <div className={`stores-layout ${filtersCollapsed ? "filters-collapsed" : ""}`}>
        {!filtersCollapsed && (
          <aside className="stores-sidebar">
            <div className="stores-panel">
              <div className="stores-panel-header">
                <span className="stores-panel-title">Filters</span>
                <button type="button" onClick={clearFilters}>Reset all</button>
              </div>

              <div className="stores-field">
                <label className="stores-label">Search</label>
                <input
                  className="stores-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ID, Dealer, Name, or Assignee..."
                />
              </div>

              <div className="stores-field">
                <label className="stores-label">T-Range Presets</label>
                <div className="stores-preset-grid">
                  {([7, 30, 60, 90, 150] as const).map((days) => (
                    <button
                      key={days}
                      type="button"
                      className={range === days ? "btn-postman" : "btn-secondary btn-sm"}
                      onClick={() => setRange(days)}
                    >
                      T-{days}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={range === "ALL" ? "btn-postman" : "btn-secondary btn-sm"}
                    onClick={() => setRange("ALL")}
                    style={{ fontWeight: 800 }}
                    title="View all stores without date cutoffs"
                  >
                    All Stores
                  </button>
                </div>
              </div>

              <div className="stores-field">
                <label className="stores-label">Launch Window</label>
                <div className="stores-date-grid">
                  <input
                    type="date"
                    className="stores-input"
                    value={fromDate}
                    onChange={(e) => {
                      setFromDate(e.target.value);
                      if (range !== "ALL") setRange(90);
                    }}
                  />
                  <input
                    type="date"
                    className="stores-input"
                    value={toDate}
                    onChange={(e) => {
                      setToDate(e.target.value);
                      if (range !== "ALL") setRange(90);
                    }}
                  />
                </div>
              </div>

              <div className="stores-field">
                <label className="stores-label">Pre-Prod POD</label>
                <select className="stores-input" value={superpodId} onChange={(e) => setSuperpodId(e.target.value)}>
                  <option value="">All PODs</option>
                  {superpodOptions.map((item) => (<option key={item} value={item}>{item}</option>))}
                </select>
              </div>

              <div className="stores-field">
                <label className="stores-label">Implementation Type</label>
                <select className="stores-input" value={implementationType} onChange={(e) => setImplementationType(e.target.value)}>
                  <option value="">All Types</option>
                  {implementationTypeOptions.map((item) => (<option key={item} value={item}>{item}</option>))}
                </select>
              </div>

              {hasAnyColumnFilter && (
                <div style={{ marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={clearColumnFilters}
                    style={{ width: "100%", color: "#f87171", borderColor: "rgba(248, 113, 113, 0.4)" }}
                  >
                    Clear Column Filters
                  </button>
                </div>
              )}

              {error && <div className="bx-error">❌ {error}</div>}
            </div>
          </aside>
        )}

        <section className="stores-content">
          <div className="stores-table-card">
            <div className="stores-table-header">
              <div className="stores-table-header-left">
                <span className="stores-table-title" style={{ fontSize: 13, fontWeight: 700 }}>
                  Dealership Stores
                </span>
                <span className="stores-table-count" style={{ fontSize: 11, color: "#64748b" }}>
                  Showing <strong>{filtered.length}</strong> of {records.length}
                </span>

                <div className="stores-quick-links" style={{ marginLeft: 12 }}>
                  <a href={tapWorkordersUrl} target="_blank" rel="noreferrer" title="Open TAP Workorders" className="stores-quick-icon">
                    <img src="https://com-tekioncloud-tap-assets.s3.us-west-1.amazonaws.com/assets/common/toc-logo.svg" alt="TAP" />
                  </a>
                  <a href="https://app.slack.com/client/E08DG6QMMDG/C0C5QBWEM8X" target="_blank" rel="noreferrer" title="Open Operations Slack Channel" className="stores-quick-icon">
                    <img src="https://cdn.brandfetch.io/idJ_HhtG0Z/theme/dark/symbol.svg?c=1dxbfHSJFAPEGdCLU4o5B" alt="Slack" />
                  </a>
                  <a href="https://app.tekioncloud.com/internal/approval-management/dashboard/requests" target="_blank" rel="noreferrer" title="Open Production Approvals" className="stores-quick-btn stores-quick-btn-prod">PROD</a>
                  <a href="http://outlook.office365.com/mail/inbox" target="_blank" rel="noreferrer" title="Open Outlook Inbox" className="stores-quick-icon">
                    <img src="https://cdn.brandfetch.io/idgdw68PEO/theme/dark/logo.svg?c=1dxbfHSJFAPEGdCLU4o5B" alt="Outlook" />
                  </a>
                  <a href="https://preprodapp.tekioncloud.com/accounting/chartOfAccounts/list" target="_blank" rel="noreferrer" title="Open Pre-Prod COA" className="stores-quick-btn stores-quick-btn-preprod">PRE-PROD</a>
                  <a href="https://preprod-map.tekioncloud.com/map/blueprintValidation" target="_blank" rel="noreferrer" title="Open PreProd MAP Blueprint Validation" className="stores-quick-btn stores-quick-btn-map">PreProd MAP</a>
                  <a href="https://tap.tekioncloud.com/timetracker/employee-view" target="_blank" rel="noreferrer" title="Open TAP Time Tracker" className="stores-quick-btn stores-quick-btn-timesheet">Time Sheet</a>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {hasAnyColumnFilter && (
                  <button className="btn-secondary btn-sm" onClick={clearColumnFilters} title="Reset all per-column table filter boxes">
                    Clear Filters
                  </button>
                )}
                <button className="btn-secondary btn-sm" onClick={() => setFiltersCollapsed((prev) => !prev)}>
                  {filtersCollapsed ? "☰ Show Filters" : "✕ Hide Filters"}
                </button>
              </div>
            </div>

            <div className="stores-table-wrap stores-table-wrap-tall">
              <table className="stores-table">
                <thead>
                  {/* FROZEN ROW 1: Column Headers */}
                  <tr>
                    <th>Store & IDs</th>
                    <th>Go Live</th>
                    <th>IMP Type</th>
                    <th>Products</th>
                    <th>Pre-Prod</th>
                    <th>POD</th>
                    <th>Blueprint</th>
                    <th>Setup Data</th>
                    <th>Fixed Ops Assignee</th>
                    <th>Variable Ops Assignee</th>
                    <th>Fixed Ops</th>
                    <th>Variable Ops</th>
                    <th>Testing</th>
                    <th>Not Worked?</th>
                  </tr>

                  {/* FROZEN ROW 2: Per-Column Filter Controls */}
                  <tr className="stores-table-filter-row">
                    <th>
                      <input
                        type="text"
                        style={filterInputStyle}
                        placeholder="Filter ID/Name..."
                        value={colFilterStore}
                        onChange={(e) => setColFilterStore(e.target.value)}
                      />
                    </th>
                    <th>
                      <select
                        style={filterInputStyle}
                        value={colFilterMonth}
                        onChange={(e) => setColFilterMonth(e.target.value)}
                      >
                        <option value="">All Months</option>
                        {monthOptions.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </th>
                    <th>
                      <select
                        style={filterInputStyle}
                        value={colFilterImpType}
                        onChange={(e) => setColFilterImpType(e.target.value)}
                      >
                        <option value="">All</option>
                        {implementationTypeOptions.map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    </th>
                    <th>
                      <select
                        style={filterInputStyle}
                        value={colFilterProduct}
                        onChange={(e) => setColFilterProduct(e.target.value)}
                      >
                        <option value="">All Products</option>
                        {productTypeOptions.map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    </th>
                    <th>
                      <input
                        type="text"
                        style={filterInputStyle}
                        placeholder="Pre-Prod..."
                        value={colFilterPreProd}
                        onChange={(e) => setColFilterPreProd(e.target.value)}
                      />
                    </th>
                    <th>
                      <select
                        style={filterInputStyle}
                        value={colFilterPod}
                        onChange={(e) => setColFilterPod(e.target.value)}
                      >
                        <option value="">All</option>
                        {superpodOptions.map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </select>
                    </th>

                    {/* BLUEPRINT MULTI-CHECKBOX PORTAL TRIGGER */}
                    <th style={{ verticalAlign: "middle" }}>
                      <button
                        ref={blueprintButtonRef}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isBlueprintDropdownOpen && blueprintButtonRef.current) {
                            const rect = blueprintButtonRef.current.getBoundingClientRect();
                            setBlueprintDropdownPos({ top: rect.bottom + 4, left: rect.left });
                          }
                          setIsBlueprintDropdownOpen((prev) => !prev);
                        }}
                        style={{
                          ...filterInputStyle,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          cursor: "pointer",
                          color: selectedBlueprintChecks.length > 0 ? "#38bdf8" : "#94a3b8",
                          borderColor: selectedBlueprintChecks.length > 0 ? "rgba(56, 189, 248, 0.6)" : "rgba(148, 163, 248, 0.25)",
                          background: selectedBlueprintChecks.length > 0 ? "rgba(56, 189, 248, 0.12)" : "#0f172a",
                          fontWeight: selectedBlueprintChecks.length > 0 ? 700 : 500,
                          textAlign: "left",
                          userSelect: "none",
                          height: 26,
                          margin: 0,
                        }}
                        title="Filter by Completed Blueprint Areas (Multi-select)"
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {selectedBlueprintChecks.length === 0
                            ? "All Blueprints"
                            : `${selectedBlueprintChecks.length} Selected`}
                        </span>
                        <span style={{ fontSize: 9, marginLeft: 4 }}>
                          {isBlueprintDropdownOpen ? "▲" : "▼"}
                        </span>
                      </button>

                      {isBlueprintDropdownOpen &&
                        createPortal(
                          <div
                            ref={blueprintPopupRef}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: "fixed",
                              top: blueprintDropdownPos.top,
                              left: blueprintDropdownPos.left,
                              minWidth: 210,
                              background: "#0b1329",
                              border: "1px solid rgba(56, 189, 248, 0.4)",
                              borderRadius: 6,
                              boxShadow: "0 14px 30px rgba(0, 0, 0, 0.85), 0 4px 10px rgba(0, 0, 0, 0.5)",
                              zIndex: 999999,
                              padding: "8px 10px",
                              display: "flex",
                              flexDirection: "column",
                              gap: 6,
                              textAlign: "left",
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
                                paddingBottom: 5,
                              }}
                            >
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 800,
                                  color: "#38bdf8",
                                  letterSpacing: "0.5px",
                                  textTransform: "uppercase",
                                }}
                              >
                                Completed Blueprint:
                              </span>
                              {selectedBlueprintChecks.length > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedBlueprintChecks([]);
                                  }}
                                  style={{
                                    background: "transparent",
                                    border: "none",
                                    color: "#f87171",
                                    fontSize: 10,
                                    cursor: "pointer",
                                    fontWeight: 700,
                                    padding: 0,
                                  }}
                                >
                                  Clear
                                </button>
                              )}
                            </div>

                            {BLUEPRINT_CHECKBOX_KEYS.map(({ key, label }) => {
                              const checked = selectedBlueprintChecks.includes(key);
                              return (
                                <label
                                  key={key}
                                  onClick={(e) => e.stopPropagation()}
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    fontSize: 11,
                                    color: checked ? "#f8fafc" : "#94a3b8",
                                    cursor: "pointer",
                                    userSelect: "none",
                                    padding: "3px 6px",
                                    borderRadius: 4,
                                    background: checked ? "rgba(56, 189, 248, 0.15)" : "transparent",
                                    transition: "background 0.12s ease",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleBlueprintFilter(key)}
                                    style={{ cursor: "pointer", accentColor: "#38bdf8" }}
                                  />
                                  <span>{label}</span>
                                </label>
                              );
                            })}
                          </div>,
                          document.body
                        )}
                    </th>

                    <th>
                      <select
                        style={filterInputStyle}
                        value={colFilterSetupData}
                        onChange={(e) => setColFilterSetupData(e.target.value)}
                      >
                        <option value="">All</option>
                        <option value="COMPLETE">Complete</option>
                        <option value="INCOMPLETE">Pending / Incomplete</option>
                        <option value="ERROR">Error</option>
                      </select>
                    </th>

                    <th>
                      <select
                        style={filterInputStyle}
                        value={colFilterFixedAssignee}
                        onChange={(e) => setColFilterFixedAssignee(e.target.value)}
                      >
                        <option value="">All</option>
                        <option value="UNASSIGNED">Unassigned</option>
                        {ASSIGNEE_OPTIONS.map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </th>

                    <th>
                      <select
                        style={filterInputStyle}
                        value={colFilterVarAssignee}
                        onChange={(e) => setColFilterVarAssignee(e.target.value)}
                      >
                        <option value="">All</option>
                        <option value="UNASSIGNED">Unassigned</option>
                        {ASSIGNEE_OPTIONS.map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </th>

                    <th>
                      <select
                        style={filterInputStyle}
                        value={colFilterFixedStatus}
                        onChange={(e) => setColFilterFixedStatus(e.target.value)}
                      >
                        <option value="">All</option>
                        {phaseStatusOptions.map((status) => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                    </th>
                    <th>
                      <select
                        style={filterInputStyle}
                        value={colFilterVarStatus}
                        onChange={(e) => setColFilterVarStatus(e.target.value)}
                      >
                        <option value="">All</option>
                        {phaseStatusOptions.map((status) => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                    </th>
                    <th>
                      <select
                        style={filterInputStyle}
                        value={colFilterTestingStatus}
                        onChange={(e) => setColFilterTestingStatus(e.target.value)}
                      >
                        <option value="">All</option>
                        {phaseStatusOptions.map((status) => (
                          <option key={status} value={status}>{status}</option>
                        ))}
                      </select>
                    </th>
                    <th>
                      <select
                        style={filterInputStyle}
                        value={colFilterNotWorked}
                        onChange={(e) => setColFilterNotWorked(e.target.value)}
                      >
                        <option value="">All</option>
                        <option value="HANDLED_BY_ARC">Handled by ARC Only</option>
                        {NOT_WORKED_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {filtered.map((row) => {
                    const tLabel = getTLabel(row.launch_date);
                    const blueprint = row.blueprint_statuses;

                    const podStyle = getPodStyle(row.superpod_id);
                    const cleanedImp = cleanImpType(row.implementation_type);
                    const uiDate = formatLaunchDateUI(row.launch_date);
                    const fixedAssignee = resolveStoreAssignee(row);
                    const variableAssignee = row.custom_variable_assignee || "";

                    void trackingTick;
                    const fixedOpsTime = buildLatestFieldTrackingText(row.tekion_id, "fixed_ops_status", false);
                    const variableOpsTime = buildLatestFieldTrackingText(row.tekion_id, "variable_ops_status", false);

                    const fixedAttCount =
                      row.fixed_ops_attachments ??
                      ((row.fetched_blueprint_tasks?.partsTasks || []).reduce((acc: number, t: any) => acc + (t.taskAttachmentCount || 0), 0) +
                        (row.fetched_blueprint_tasks?.serviceTasks || []).reduce((acc: number, t: any) => acc + (t.taskAttachmentCount || 0), 0));

                    const varAttCount =
                      row.variable_ops_attachments ??
                      (row.fetched_blueprint_tasks?.accountingTasks || []).reduce((acc: number, t: any) => acc + (t.taskAttachmentCount || 0), 0);

                    const isDecommissioned = /decommissioned/i.test(row.pre_production_environment_status || "");
                    const dealerNameColor = getDealerTextColor(row.fixed_ops_status);

                    return (
                      <tr key={row.tekion_id}>
                        <td style={{ minWidth: 230, maxWidth: 340 }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap" }}>
                              <button
                                type="button"
                                className="stores-copy-btn"
                                title="Copy Tekion ID"
                                onClick={() => handleCopy(row.tekion_id, `tek-${row.tekion_id}`)}
                                style={{ fontWeight: 800, color: "#f8fafc" }}
                              >
                                {copiedKey === `tek-${row.tekion_id}` ? "Copied!" : row.tekion_id}
                              </button>
                              <button
                                type="button"
                                className="stores-copy-btn"
                                title="Copy Dealer ID"
                                onClick={() => handleCopy(row.dealer_id, `dlr-${row.tekion_id}`)}
                                style={{ color: "#38bdf8", fontWeight: 700 }}
                              >
                                {copiedKey === `dlr-${row.tekion_id}` ? "Copied!" : row.dealer_id}
                              </button>
                              <button
                                type="button"
                                className="stores-slack-trigger-btn"
                                onClick={() => setActiveDealerPopup(row)}
                                style={{ marginLeft: "auto" }}
                              >
                                💬 Update
                              </button>
                            </div>

                            {/* Dealership Name Button Styled with colored text only */}
                            <button
                              type="button"
                              className="stores-copy-btn"
                              title="Click to copy dealership name"
                              onClick={() => handleCopy(row.dba_name, `dba-${row.tekion_id}`)}
                              style={{
                                textAlign: "left",
                                color: dealerNameColor,
                                background: "transparent",
                                border: "none",
                                padding: "2px 0",
                                fontSize: 15,
                                fontWeight: 800,
                                lineHeight: 1.3,
                                whiteSpace: "normal",
                                wordBreak: "break-word",
                                cursor: "pointer",
                                transition: "color 0.15s ease",
                              }}
                            >
                              {copiedKey === `dba-${row.tekion_id}` ? (
                                <span style={{ color: "#4ade80", fontWeight: 700 }}>Copied!</span>
                              ) : (
                                row.dba_name || "—"
                              )}
                            </button>
                          </div>
                        </td>

                        <td>
                          <div className="stores-launch-date-cell" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: "#f8fafc", letterSpacing: "0.2px" }}>
                              {uiDate.date || "—"}
                            </span>
                            <div style={{ fontSize: 11, color: "#94a3b8", display: "flex", alignItems: "center", gap: 4 }}>
                              {uiDate.weekday && <span>{uiDate.weekday}</span>}
                              {uiDate.weekday && <span>•</span>}
                              <span style={{ fontWeight: 600, color: "#cbd5e1" }}>{tLabel.label}</span>
                            </div>
                          </div>
                        </td>

                        <td>{cleanedImp || "—"}</td>
                        <td>{row.product_types || "—"}</td>

                        <td>
                          {row.pre_production_environment_status ? (
                            isDecommissioned ? (
                              <span
                                style={{
                                  color: "#f87171",
                                  background: "rgba(248, 113, 113, 0.12)",
                                  border: "1px solid rgba(248, 113, 113, 0.28)",
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  display: "inline-block",
                                }}
                              >
                                {row.pre_production_environment_status}
                              </span>
                            ) : (
                              <span>{row.pre_production_environment_status}</span>
                            )
                          ) : (
                            "—"
                          )}
                        </td>

                        <td>
                          <span className="stores-pod-badge" style={{ background: podStyle.bg, color: podStyle.color, border: `1px solid ${podStyle.border}` }}>
                            {row.superpod_id || "—"}
                          </span>
                        </td>

                        <td>
                          <StatusChipGroup
                            items={[
                              { short: "P", fullName: "Blueprint - Parts", status: blueprint?.parts ?? "UNKNOWN" },
                              { short: "S", fullName: "Blueprint - Service", status: blueprint?.service ?? "UNKNOWN" },
                              { short: "A", fullName: "Blueprint - Accounting", status: blueprint?.accounting ?? "UNKNOWN" },
                              { short: "C", fullName: "Blueprint - CRM", status: blueprint?.crm ?? "UNKNOWN" },
                              { short: "AN", fullName: "Blueprint - Analytics", status: blueprint?.analytics ?? "UNKNOWN" },
                            ]}
                          />
                        </td>

                        <td>
                          <SetupDataCell row={row} />
                        </td>

                        <td style={{ minWidth: 130 }}>
                          <select
                            value={fixedAssignee}
                            onChange={(e) => void updateStoreFixedAssignee(row.tekion_id, e.target.value as AssigneeName | "")}
                            style={{
                              width: "100%",
                              background: fixedAssignee ? "rgba(168, 85, 247, 0.15)" : "rgba(148, 163, 184, 0.1)",
                              color: fixedAssignee ? "#c084fc" : "#64748b",
                              border: `1px solid ${fixedAssignee ? "rgba(168, 85, 247, 0.35)" : "rgba(148, 163, 184, 0.2)"}`,
                              borderRadius: 6,
                              padding: "4px 6px",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                              outline: "none",
                            }}
                          >
                            <option value="">— Unassigned —</option>
                            {ASSIGNEE_OPTIONS.map((name) => (<option key={name} value={name}>{name}</option>))}
                          </select>
                        </td>

                        <td style={{ minWidth: 130 }}>
                          <select
                            value={variableAssignee}
                            onChange={(e) => void updateStoreVariableAssignee(row.tekion_id, e.target.value as AssigneeName | "")}
                            style={{
                              width: "100%",
                              background: variableAssignee ? "rgba(56, 189, 248, 0.15)" : "rgba(148, 163, 184, 0.1)",
                              color: variableAssignee ? "#38bdf8" : "#64748b",
                              border: `1px solid ${variableAssignee ? "rgba(56, 189, 248, 0.35)" : "rgba(148, 163, 184, 0.2)"}`,
                              borderRadius: 6,
                              padding: "4px 6px",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                              outline: "none",
                            }}
                          >
                            <option value="">— Unassigned —</option>
                            {ASSIGNEE_OPTIONS.map((name) => (<option key={name} value={name}>{name}</option>))}
                          </select>
                        </td>

                        <td>
                          <div className="stores-status-cell-wrap">
                            <CustomStatusSelect
                              value={row.fixed_ops_status}
                              onChange={(val) => void updateCustomStatus(row.tekion_id, "fixed_ops_status", val)}
                            />
                            <div style={{ marginTop: 3 }}>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 3,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background: fixedAttCount > 0 ? "rgba(56, 189, 248, 0.16)" : "rgba(148, 163, 184, 0.08)",
                                  color: fixedAttCount > 0 ? "#38bdf8" : "#64748b",
                                  border: `1px solid ${fixedAttCount > 0 ? "rgba(56, 189, 248, 0.3)" : "rgba(148, 163, 184, 0.16)"}`,
                                }}
                                title="Total attachments across Parts and Service blueprint tasks"
                              >
                                <span>📎</span>
                                <span>{fixedAttCount}{row.attachments_incomplete ? "+" : ""} Attachment{fixedAttCount === 1 ? "" : "s"}</span>
                              </span>
                            </div>
                            {fixedOpsTime !== "—" && <span className="stores-tracking-timestamp">{fixedOpsTime}</span>}
                          </div>
                        </td>

                        <td>
                          <div className="stores-status-cell-wrap">
                            <CustomStatusSelect value={row.variable_ops_status} onChange={(val) => void updateCustomStatus(row.tekion_id, "variable_ops_status", val)} />
                            <div style={{ marginTop: 3 }}>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 3,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  background: varAttCount > 0 ? "rgba(56, 189, 248, 0.16)" : "rgba(148, 163, 184, 0.08)",
                                  color: varAttCount > 0 ? "#38bdf8" : "#64748b",
                                  border: `1px solid ${varAttCount > 0 ? "rgba(56, 189, 248, 0.3)" : "rgba(148, 163, 184, 0.16)"}`,
                                }}
                                title="Total attachments across Accounting blueprint tasks"
                              >
                                <span>📎</span>
                                <span>{varAttCount}{row.attachments_incomplete ? "+" : ""} Attachment{varAttCount === 1 ? "" : "s"}</span>
                              </span>
                            </div>
                            {variableOpsTime !== "—" && <span className="stores-tracking-timestamp">{variableOpsTime}</span>}
                          </div>
                        </td>

                        <td>
                          <CustomStatusSelect value={row.testing_status} onChange={(val) => void updateCustomStatus(row.tekion_id, "testing_status", val)} />
                        </td>

                        <td style={{ minWidth: 200 }}>
                          <select
                            value={row.not_worked || ""}
                            onChange={(e) => void updateStoreNotWorked(row.tekion_id, e.target.value)}
                            style={{
                              width: "100%",
                              background: row.not_worked ? "rgba(244, 63, 94, 0.15)" : "rgba(148, 163, 184, 0.1)",
                              color: row.not_worked ? "#fb7185" : "#64748b",
                              border: `1px solid ${row.not_worked ? "rgba(244, 63, 94, 0.35)" : "rgba(148, 163, 184, 0.2)"}`,
                              borderRadius: 6,
                              padding: "4px 6px",
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: "pointer",
                              outline: "none",
                            }}
                          >
                            <option value="">— Handled by ARC —</option>
                            {NOT_WORKED_OPTIONS.map((opt) => (<option key={opt} value={opt}>{opt}</option>))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {!loadingStores && filtered.length === 0 && (
                <div className="stores-empty" style={{ padding: 40, textAlign: "center" }}>
                  <div style={{ fontSize: 32 }}>🏬</div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginTop: 8 }}>No records found</div>
                  <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4 }}>Try clearing filters or adjusting your date window</div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <DealerMetaModal
        row={currentModalRecord}
        onClose={() => setActiveDealerPopup(null)}
        onToast={showToast}
        onTasksSnapshot={handleTasksSnapshot}
        onSetupFetched={(tekionId, setupData) => {
          setActiveDealerPopup((prev) =>
            prev && prev.tekion_id === tekionId
              ? { ...prev, setup_data: setupData, setup_data_fetched_at: setupData.fetchedAt, setup_data_error: "" }
              : prev
          );
          void persistSetupData(tekionId, setupData);
        }}
        onTaskOperationalStatusChange={(tekionId, field, value) => {
          void updateCustomStatus(tekionId, field, value);
        }}
        staticSlackMap={STATIC_SLACK_MAP}
      />

      <button
        type="button"
        onClick={() => setIsCopilotOpen((prev) => !prev)}
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          height: 48,
          borderRadius: 24,
          padding: "0 18px",
          background: "linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)",
          border: "1px solid rgba(255,255,255,0.25)",
          boxShadow: "0 8px 24px rgba(2, 132, 199, 0.45), 0 2px 6px rgba(0,0,0,0.4)",
          color: "#ffffff",
          fontWeight: 800,
          fontSize: 13,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          zIndex: 99998,
          transition: "transform 0.15s ease, box-shadow 0.15s ease",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.05)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
        title="Open Interactive Stores AI Copilot with Persistent Learning"
      >
        <span style={{ fontSize: 16 }}>🤖</span>
        <span>{isCopilotOpen ? "Close AI" : "Stores Copilot"}</span>
      </button>

      <StoresAI
        isOpen={isCopilotOpen}
        onClose={() => setIsCopilotOpen(false)}
        records={records}
        onToast={showToast}
      />
    </div>
  );
};

export default Stores;