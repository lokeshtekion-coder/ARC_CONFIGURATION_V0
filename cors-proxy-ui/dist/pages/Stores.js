import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
// @ts-ignore - raw import for Vite/bundler
import slackCsvText from "./DATA/Slack.csv?raw";
import { storesBotRunner } from "../services/storesBotRunner";
import { fetchStores, getTDaysRange, ExpiredCaptureTokenError } from "../services/tekionStoresApi";
import { getStores, saveStores, getStoredStatusVault, saveStatusToVault, saveNotWorkedToVault, recordStatusTransition, bulkUpdateStatusVault, resolveStoreProjectId, NOT_WORKED_OPTIONS, } from "../services/storesDb";
import { fetchStoreOnboardingStatuses } from "../services/storeOnboardingStatusApi";
import { exportStoresToExcel } from "../services/storesExcelExport";
import { syncStoresToGraphWorkbook, pullStatusUpdatesFromGraph, patchSingleStoreStatusInGraph, patchSingleStoreAssigneeInGraph, patchSingleStoreVariableAssigneeInGraph, patchSingleStoreNotWorkedInGraph, syncProdDealersToGraph, } from "../services/storesGraphSync";
import { buildLatestFieldTrackingText } from "../services/storesExcelShared";
import { isSetupDataComplete, fetchSetupDataForStore } from "../services/storeSetupDataService";
import { isUserAdmin } from "../services/authHelper";
import { runSlackAlerts, maybeSendDailyDigest, dispatchAllThreeReports, isSlackSessionActive } from "../services/slackAlertsService";
import { ASSIGNEE_OPTIONS, resolveStoreAssignee, loadAssigneeConfig, reconcileAssignments, recordManualAssignment, runAutoAssign, } from "../services/assigneeService";
import { batchFetchRealTapStatuses } from "../services/tapTasksApi";
import { StoresAI } from "./StoresAI";
import { parseSlackCsv, cleanImpType, parseLaunchDate, formatLaunchDateUI, getMonthYearString, getMonthYearSortKey, getTLabel, toInputDate, startOfDayUnix, endOfDayUnix, buildTapWorkordersUrl, isSameLocalDay, getPodStyle, } from "./stores-components/storesHelpers";
import { StatusChipGroup, SetupDataCell, CustomStatusSelect } from "./stores-components/StoreTableCells";
import { DealerMetaModal } from "./stores-components/DealerMetaModal";
import { executePreprodMapPipeline, storeCapturedMapHeaders, } from "../services/preprodMapApiService";
import "./Stores.css";
const logger = {
    info: (...args) => console.info("[Stores]", ...args),
    debug: (...args) => console.debug("[Stores]", ...args),
    warn: (...args) => console.warn("[Stores]", ...args),
    error: (...args) => console.error("[Stores]", ...args),
};
const STATIC_SLACK_MAP = parseSlackCsv(typeof slackCsvText === "string" ? slackCsvText : "");
const BLUEPRINT_CHECKBOX_KEYS = [
    { key: "parts", label: "Parts BP Completed" },
    { key: "service", label: "Service BP Completed" },
    { key: "accounting", label: "Accounting BP Completed" },
    { key: "crm", label: "CRM BP Completed" },
    { key: "analytics", label: "Analytics BP Completed" },
];
const SIGN_OFF_FILTER_OPTIONS = [
    "COMPLETED",
    "IN_PROGRESS",
    "NOT_STARTED",
    "BLOCKED",
    "NOT_APPLICABLE",
];
function isBlueprintDone(status) {
    if (!status)
        return false;
    const s = status.trim().toUpperCase();
    return s === "COMPLETED" || s === "DONE" || s === "COMPLETE";
}
function mergeIncomingStore(existing, incoming) {
    if (!existing)
        return incoming;
    const merged = { ...existing };
    for (const [key, value] of Object.entries(incoming)) {
        const blank = value === undefined ||
            value === null ||
            (typeof value === "string" && value.trim() === "") ||
            (Array.isArray(value) && value.length === 0);
        if (!blank)
            merged[key] = value;
    }
    return merged;
}
function safelyMergeStatusFields(prevRecords, updatedStores) {
    const prevMap = new Map(prevRecords.map((s) => [s.tekion_id, s]));
    return updatedStores.map((uStore) => {
        const prev = prevMap.get(uStore.tekion_id);
        if (!prev)
            return uStore;
        return {
            ...prev,
            fixed_ops_status: uStore.fixed_ops_status,
            variable_ops_status: uStore.variable_ops_status,
            testing_status: uStore.testing_status,
            not_worked: uStore.not_worked ?? prev.not_worked,
            custom_assignee: uStore.custom_assignee ?? prev.custom_assignee,
            custom_variable_assignee: uStore.custom_variable_assignee ?? prev.custom_variable_assignee,
            fixed_ops_attachments: uStore.fixed_ops_attachments ?? prev.fixed_ops_attachments,
            variable_ops_attachments: uStore.variable_ops_attachments ?? prev.variable_ops_attachments,
            fetched_blueprint_tasks: uStore.fetched_blueprint_tasks ?? prev.fetched_blueprint_tasks,
            attachments_incomplete: uStore.attachments_incomplete ?? prev.attachments_incomplete,
            preprod_validation: uStore.preprod_validation ?? prev.preprod_validation,
        };
    });
}
function withOnboardingStatuses(stores, statusMap) {
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
const filterInputStyle = {
    width: "100%",
    boxSizing: "border-box",
    background: "#0f172a",
    color: "#f8fafc",
    border: "1px solid rgba(148, 163, 248, 0.25)",
    borderRadius: 4,
    padding: "3px 6px",
    fontSize: 11,
    outline: "none",
};
export const Stores = ({ onBack }) => {
    const [records, setRecords] = useState([]);
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
    const [copiedKey, setCopiedKey] = useState(null);
    const [trackingTick, setTrackingTick] = useState(0);
    const [isCopilotOpen, setIsCopilotOpen] = useState(false);
    // Global Sidebar Filter States
    const [range, setRange] = useState(90);
    const [search, setSearch] = useState("");
    const [superpodId, setSuperpodId] = useState("");
    const [implementationType, setImplementationType] = useState("");
    const [productType, setProductType] = useState("");
    const [selectedMonth, setSelectedMonth] = useState("");
    const [fixedAssigneeFilter, setFixedAssigneeFilter] = useState("");
    const [variableAssigneeFilter, setVariableAssigneeFilter] = useState("");
    const [notWorkedFilter, setNotWorkedFilter] = useState("");
    const [activeDealerPopup, setActiveDealerPopup] = useState(null);
    // Per-Column Filter States
    const [colFilterStore, setColFilterStore] = useState("");
    const [colFilterGoLive, setColFilterGoLive] = useState("");
    const [colFilterFixedAssignee, setColFilterFixedAssignee] = useState("");
    const [colFilterVarAssignee, setColFilterVarAssignee] = useState("");
    const [colFilterImpType, setColFilterImpType] = useState("");
    const [colFilterProduct, setColFilterProduct] = useState("");
    const [colFilterPreProd, setColFilterPreProd] = useState("");
    const [colFilterPod, setColFilterPod] = useState("");
    // Multi-checkbox Blueprint Filter State
    const [selectedBlueprintChecks, setSelectedBlueprintChecks] = useState([]);
    const [isBlueprintDropdownOpen, setIsBlueprintDropdownOpen] = useState(false);
    const blueprintDropdownRef = useRef(null);
    const [colFilterSetupData, setColFilterSetupData] = useState("");
    const [colFilterFixedStatus, setColFilterFixedStatus] = useState("");
    const [colFilterVarStatus, setColFilterVarStatus] = useState("");
    const [colFilterSignoff, setColFilterSignoff] = useState("");
    const [colFilterTestingStatus, setColFilterTestingStatus] = useState("");
    const [colFilterNotWorked, setColFilterNotWorked] = useState("");
    // Listen for captured extension tokens including Pre-Prod MAP API
    useEffect(() => {
        const handleBridgeMessage = (event) => {
            if (event.data?.type === "ARC_EXTENSION_SYNC_CAPTURE" && event.data?.payload?.preprodMapHeaders) {
                storeCapturedMapHeaders(event.data.payload.preprodMapHeaders);
            }
        };
        window.addEventListener("message", handleBridgeMessage);
        return () => window.removeEventListener("message", handleBridgeMessage);
    }, []);
    useEffect(() => {
        const handleOutsideClick = (e) => {
            if (blueprintDropdownRef.current && !blueprintDropdownRef.current.contains(e.target)) {
                setIsBlueprintDropdownOpen(false);
            }
        };
        if (isBlueprintDropdownOpen) {
            document.addEventListener("mousedown", handleOutsideClick);
        }
        return () => {
            document.removeEventListener("mousedown", handleOutsideClick);
        };
    }, [isBlueprintDropdownOpen]);
    const toggleBlueprintFilter = (key) => {
        setSelectedBlueprintChecks((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
    };
    const currentModalRecord = useMemo(() => {
        if (!activeDealerPopup)
            return null;
        const latest = records.find((r) => r.tekion_id === activeDealerPopup.tekion_id) || activeDealerPopup;
        const resolvedProjectId = resolveStoreProjectId(latest);
        return {
            ...latest,
            onboarding_project_id: resolvedProjectId || latest.onboarding_project_id,
        };
    }, [activeDealerPopup, records]);
    const presetRange = useMemo(() => getTDaysRange(range), [range]);
    const [fromDate, setFromDate] = useState(toInputDate(presetRange.fromDate));
    const [toDate, setToDate] = useState(toInputDate(presetRange.toDate));
    useEffect(() => {
        setFromDate(toInputDate(presetRange.fromDate));
        setToDate(toInputDate(presetRange.toDate));
    }, [range, presetRange.fromDate, presetRange.toDate]);
    const tapWorkordersUrl = useMemo(() => buildTapWorkordersUrl(fromDate, toDate), [fromDate, toDate]);
    const [botState, setBotState] = useState(() => storesBotRunner.getState());
    useEffect(() => {
        const unsubscribe = storesBotRunner.subscribe((state) => setBotState(state));
        return () => unsubscribe();
    }, []);
    const showToast = useCallback((msg) => {
        setToastMessage(msg);
        window.setTimeout(() => setToastMessage(""), 3500);
    }, []);
    const handleCopy = useCallback((text, keyIdentifier) => {
        void navigator.clipboard.writeText(text || "");
        setCopiedKey(keyIdentifier);
        window.setTimeout(() => setCopiedKey(null), 1200);
    }, []);
    const loadStatusesForStores = useCallback(async (stores) => {
        const tekionIds = stores.map((item) => item.tekion_id).filter(Boolean);
        if (tekionIds.length === 0)
            return;
        try {
            const statusMap = await fetchStoreOnboardingStatuses(tekionIds, { chunkSize: 25, concurrency: 3 });
            setRecords((prevRecords) => {
                const baseStores = prevRecords.length > 0 ? prevRecords : stores;
                const merged = withOnboardingStatuses(baseStores, statusMap);
                void saveStores(merged);
                return merged;
            });
        }
        catch (err) {
            logger.error("Failed to fetch onboarding statuses", err);
        }
    }, []);
    const handleFetch = useCallback(async (forceStatusRefresh = true) => {
        setLoadingStores(true);
        setError("");
        setTokenExpiredMessage("");
        try {
            const rawStores = await fetchStores(range);
            const existingDbStores = await getStores();
            const existingMap = new Map(existingDbStores.map((s) => [s.tekion_id, s]));
            const vault = getStoredStatusVault();
            const fetchedStores = Array.from(new Map(rawStores.map((store) => {
                const existing = existingMap.get(store.tekion_id);
                const override = vault[store.tekion_id];
                const base = mergeIncomingStore(existing, store);
                return [
                    store.tekion_id,
                    {
                        ...base,
                        onboarding_project_id: store.onboarding_project_id || existing?.onboarding_project_id,
                        ds_onboarding_project_id: store.ds_onboarding_project_id || existing?.ds_onboarding_project_id,
                        fixed_ops_status: override?.fixed_ops_status || existing?.fixed_ops_status || existing?.configuration_status || "TO DO",
                        variable_ops_status: override?.variable_ops_status || existing?.variable_ops_status || existing?.configuration_status || "TO DO",
                        testing_status: override?.testing_status || existing?.testing_status || existing?.configuration_status || "TO DO",
                        not_worked: override?.not_worked || existing?.not_worked || store.not_worked,
                        custom_assignee: override?.custom_assignee || existing?.custom_assignee || store.custom_assignee,
                        custom_variable_assignee: override?.custom_variable_assignee || existing?.custom_variable_assignee || store.custom_variable_assignee,
                    },
                ];
            })).values());
            const fetchedIds = new Set(fetchedStores.map((s) => s.tekion_id));
            const uniqueStores = [
                ...fetchedStores,
                ...existingDbStores.filter((s) => !fetchedIds.has(s.tekion_id)),
            ];
            setRecords(uniqueStores);
            await saveStores(uniqueStores);
            showToast(`✅ Refreshed ${fetchedStores.length} stores (${uniqueStores.length} total kept)`);
            void (async () => {
                try {
                    const { updatedStores, hasChanges } = await pullStatusUpdatesFromGraph(uniqueStores);
                    const storesForProd = hasChanges ? updatedStores : uniqueStores;
                    if (hasChanges) {
                        setRecords((prev) => {
                            const safelyMerged = safelyMergeStatusFields(prev, updatedStores);
                            void saveStores(safelyMerged);
                            bulkUpdateStatusVault(safelyMerged.map((s) => ({
                                tekionId: s.tekion_id,
                                fixed_ops_status: s.fixed_ops_status,
                                variable_ops_status: s.variable_ops_status,
                                testing_status: s.testing_status,
                                custom_assignee: s.custom_assignee,
                                custom_variable_assignee: s.custom_variable_assignee,
                                not_worked: s.not_worked,
                            })));
                            return safelyMerged;
                        });
                        setTrackingTick((prev) => prev + 1);
                    }
                    void syncProdDealersToGraph(storesForProd);
                }
                catch (e) {
                    logger.debug("Background Excel check skipped on fetch:", e);
                }
            })();
            if (forceStatusRefresh) {
                void loadStatusesForStores(uniqueStores);
            }
        }
        catch (err) {
            if (err instanceof ExpiredCaptureTokenError) {
                setTokenExpiredMessage(err.message);
                setError("");
            }
            else {
                setError(err instanceof Error ? err.message : "Failed to fetch stores");
            }
        }
        finally {
            setLoadingStores(false);
        }
    }, [range, loadStatusesForStores, showToast]);
    const handleLoadIndexedDb = useCallback(async () => {
        try {
            const rawData = await getStores();
            const vault = getStoredStatusVault();
            const uniqueData = Array.from(new Map(rawData.map((store) => {
                const override = vault[store.tekion_id];
                return [
                    store.tekion_id,
                    {
                        ...store,
                        fixed_ops_status: override?.fixed_ops_status || store.fixed_ops_status || store.configuration_status || "TO DO",
                        variable_ops_status: override?.variable_ops_status || store.variable_ops_status || store.configuration_status || "TO DO",
                        testing_status: override?.testing_status || store.testing_status || store.configuration_status || "TO DO",
                        not_worked: override?.not_worked || store.not_worked,
                        custom_assignee: override?.custom_assignee || store.custom_assignee,
                        custom_variable_assignee: override?.custom_variable_assignee || store.custom_variable_assignee,
                    },
                ];
            })).values());
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
                                bulkUpdateStatusVault(safelyMerged.map((s) => ({
                                    tekionId: s.tekion_id,
                                    fixed_ops_status: s.fixed_ops_status,
                                    variable_ops_status: s.variable_ops_status,
                                    testing_status: s.testing_status,
                                    custom_assignee: s.custom_assignee,
                                    custom_variable_assignee: s.custom_variable_assignee,
                                    not_worked: s.not_worked,
                                })));
                                return safelyMerged;
                            });
                            setTrackingTick((prev) => prev + 1);
                            showToast("⚡ Refreshed & updated cache from Excel");
                        }
                        void syncProdDealersToGraph(storesForProd);
                    }
                    catch (e) {
                        logger.debug("Initial Excel cache pull skipped:", e);
                    }
                })();
            }
            if (uniqueData.some((row) => !isSameLocalDay(row.onboarding_status_fetched_at)) && uniqueData.length > 0) {
                void loadStatusesForStores(uniqueData);
            }
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load IndexedDB data");
        }
    }, [loadStatusesForStores, showToast]);
    useEffect(() => {
        void handleLoadIndexedDb();
    }, [handleLoadIndexedDb]);
    const updateCustomStatus = async (tekion_id, field, value) => {
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
            }
            else {
                showToast(`⚠ Updated locally (Excel sync pending)`);
            }
        })();
    };
    const updateStoreNotWorked = useCallback(async (tekion_id, value) => {
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
            if (success)
                showToast(`✅ Synced 'Not Worked?' to Excel`);
        })();
    }, [showToast]);
    const updateStoreFixedAssignee = useCallback(async (tekion_id, newAssignee) => {
        const target = records.find((r) => r.tekion_id === tekion_id);
        if (target)
            recordManualAssignment(target, newAssignee);
        setRecords((prev) => {
            const updated = prev.map((r) => (r.tekion_id === tekion_id ? { ...r, custom_assignee: newAssignee } : r));
            void saveStores(updated).catch((err) => logger.error("Failed saving assignee", err));
            return updated;
        });
        bulkUpdateStatusVault([{ tekionId: tekion_id, custom_assignee: newAssignee }]);
        showToast(`✅ Updated Fixed Ops Assignee to ${newAssignee || "Unassigned"}`);
        void (async () => {
            const success = await patchSingleStoreAssigneeInGraph(tekion_id, newAssignee);
            if (success)
                showToast(`✅ Synced Fixed Ops Assignee to Excel`);
        })();
    }, [showToast, records]);
    const updateStoreVariableAssignee = useCallback(async (tekion_id, newAssignee) => {
        setRecords((prev) => {
            const updated = prev.map((r) => (r.tekion_id === tekion_id ? { ...r, custom_variable_assignee: newAssignee } : r));
            void saveStores(updated).catch((err) => logger.error("Failed saving variable assignee", err));
            return updated;
        });
        bulkUpdateStatusVault([{ tekionId: tekion_id, custom_variable_assignee: newAssignee }]);
        showToast(`✅ Updated Variable Ops Assignee to ${newAssignee || "Unassigned"}`);
        void (async () => {
            const success = await patchSingleStoreVariableAssigneeInGraph(tekion_id, newAssignee);
            if (success)
                showToast(`✅ Synced Variable Ops Assignee to Excel`);
        })();
    }, [showToast]);
    const handleTasksSnapshot = useCallback((tekionId, tasks, complete) => {
        const sum = (list) => (list || []).reduce((acc, t) => acc + Number(t.taskAttachmentCount ?? t.attachments?.length ?? 0), 0);
        const fixedNow = sum(tasks.parts) + sum(tasks.service);
        const varNow = sum(tasks.accounting);
        setRecords((prev) => {
            let changed = null;
            const next = prev.map((r) => {
                if (r.tekion_id !== tekionId)
                    return r;
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
            if (changed)
                void saveStores([changed]);
            return changed ? next : prev;
        });
    }, []);
    useEffect(() => {
        if (records.length === 0)
            return;
        void runSlackAlerts(records).then((n) => {
            if (n > 0)
                showToast(`🔔 Sent ${n} alert(s) to Slack`);
        });
        void maybeSendDailyDigest(records);
    }, [records, showToast]);
    useEffect(() => {
        if (records.length === 0)
            return;
        reconcileAssignments(records);
        const config = loadAssigneeConfig();
        if (!config.autoAssignEnabled)
            return;
        const { updated, events } = runAutoAssign(records, config);
        if (!updated.length)
            return;
        const byId = new Map(updated.map((u) => [u.tekion_id, u]));
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
                    await patchSingleStoreAssigneeInGraph(u.tekion_id, String(u.custom_assignee));
                }
                catch { }
            }
        })();
    }, [records, showToast]);
    useEffect(() => {
        let isCancelled = false;
        const checkForExcelUpdates = async () => {
            if (records.length === 0 || syncingExcel)
                return;
            const { updatedStores, hasChanges } = await pullStatusUpdatesFromGraph(records);
            const activeList = updatedStores.length > 0 ? updatedStores : records;
            if (!isCancelled && hasChanges) {
                setRecords((prev) => {
                    const merged = safelyMergeStatusFields(prev, updatedStores);
                    void saveStores(merged);
                    bulkUpdateStatusVault(merged.map((s) => ({
                        tekionId: s.tekion_id,
                        fixed_ops_status: s.fixed_ops_status,
                        variable_ops_status: s.variable_ops_status,
                        testing_status: s.testing_status,
                        custom_assignee: s.custom_assignee,
                        custom_variable_assignee: s.custom_variable_assignee,
                        not_worked: s.not_worked,
                    })));
                    return merged;
                });
                setTrackingTick((prev) => prev + 1);
                showToast("⚡ Auto-synced updates from Excel");
            }
            void syncProdDealersToGraph(activeList);
        };
        const interval = setInterval(() => void checkForExcelUpdates(), 12000);
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible")
                void checkForExcelUpdates();
        };
        document.addEventListener("visibilitychange", handleVisibilityChange);
        return () => {
            isCancelled = true;
            clearInterval(interval);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [records, syncingExcel, showToast]);
    const superpodOptions = useMemo(() => Array.from(new Set(records.map((r) => r.superpod_id).filter(Boolean))).sort(), [records]);
    const implementationTypeOptions = useMemo(() => Array.from(new Set(records.map((r) => cleanImpType(r.implementation_type)).filter(Boolean))).sort(), [records]);
    const productTypeOptions = useMemo(() => ["ARC", "CRM", "Analytics"], []);
    const phaseStatusOptions = useMemo(() => {
        const set = new Set();
        records.forEach((r) => {
            if (r.fixed_ops_status)
                set.add(r.fixed_ops_status);
            if (r.variable_ops_status)
                set.add(r.variable_ops_status);
            if (r.testing_status)
                set.add(r.testing_status);
        });
        if (set.size === 0) {
            set.add("TO DO");
            set.add("In Progress");
            set.add("Completed");
        }
        return Array.from(set).filter(Boolean).sort();
    }, [records]);
    const monthOptions = useMemo(() => {
        const map = new Map();
        records.forEach((r) => {
            const label = getMonthYearString(r.launch_date);
            if (label)
                map.set(label, getMonthYearSortKey(r.launch_date));
        });
        return Array.from(map.entries()).sort((a, b) => a[1] - b[1]).map((entry) => entry[0]);
    }, [records]);
    const clearColumnFilters = useCallback(() => {
        setColFilterStore("");
        setColFilterGoLive("");
        setColFilterFixedAssignee("");
        setColFilterVarAssignee("");
        setColFilterImpType("");
        setColFilterProduct("");
        setColFilterPreProd("");
        setColFilterPod("");
        setSelectedBlueprintChecks([]);
        setColFilterSetupData("");
        setColFilterFixedStatus("");
        setColFilterVarStatus("");
        setColFilterSignoff("");
        setColFilterTestingStatus("");
        setColFilterNotWorked("");
    }, []);
    const hasAnyColumnFilter = useMemo(() => {
        return Boolean(colFilterStore ||
            colFilterGoLive ||
            colFilterFixedAssignee ||
            colFilterVarAssignee ||
            colFilterImpType ||
            colFilterProduct ||
            colFilterPreProd ||
            colFilterPod ||
            selectedBlueprintChecks.length > 0 ||
            colFilterSetupData ||
            colFilterFixedStatus ||
            colFilterVarStatus ||
            colFilterSignoff ||
            colFilterTestingStatus ||
            colFilterNotWorked);
    }, [
        colFilterStore,
        colFilterGoLive,
        colFilterFixedAssignee,
        colFilterVarAssignee,
        colFilterImpType,
        colFilterProduct,
        colFilterPreProd,
        colFilterPod,
        selectedBlueprintChecks.length,
        colFilterSetupData,
        colFilterFixedStatus,
        colFilterVarStatus,
        colFilterSignoff,
        colFilterTestingStatus,
        colFilterNotWorked,
    ]);
    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        const fromUnix = startOfDayUnix(fromDate);
        const toUnix = endOfDayUnix(toDate);
        const cStore = colFilterStore.trim().toLowerCase();
        const cGoLive = colFilterGoLive.trim().toLowerCase();
        const cProduct = colFilterProduct.trim().toLowerCase();
        const cPreProd = colFilterPreProd.trim().toLowerCase();
        return records
            .filter((item) => {
            const fixedAssignee = resolveStoreAssignee(item);
            const variableAssignee = item.custom_variable_assignee || "";
            // Global Sidebar Filter Matches
            const matchesSearch = !q ||
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
            const matchesProductType = !productType || (item.product_types || "").toLowerCase().includes(productType.toLowerCase());
            const matchesMonth = !selectedMonth || getMonthYearString(item.launch_date) === selectedMonth;
            const matchesFixedAssignee = !fixedAssigneeFilter || fixedAssignee === fixedAssigneeFilter;
            const matchesVarAssignee = !variableAssigneeFilter || variableAssignee === variableAssigneeFilter;
            const matchesNotWorked = !notWorkedFilter
                ? true
                : notWorkedFilter === "HANDLED_BY_ARC"
                    ? !item.not_worked || item.not_worked.trim() === ""
                    : item.not_worked === notWorkedFilter;
            const launch = parseLaunchDate(item.launch_date);
            const launchUnix = launch ? Math.floor(launch.getTime() / 1000) : null;
            const matchesDate = launchUnix == null ? true : launchUnix >= fromUnix && launchUnix <= toUnix;
            if (!matchesSearch ||
                !matchesSuperpod ||
                !matchesImplementationType ||
                !matchesProductType ||
                !matchesMonth ||
                !matchesFixedAssignee ||
                !matchesVarAssignee ||
                !matchesNotWorked ||
                !matchesDate) {
                return false;
            }
            // Per-Column Table Filter Matches
            // 1. Store & IDs
            if (cStore &&
                !(item.tekion_id.toLowerCase().includes(cStore) ||
                    item.dealer_id.toLowerCase().includes(cStore) ||
                    (item.dba_name || "").toLowerCase().includes(cStore))) {
                return false;
            }
            // 2. Go Live
            if (cGoLive) {
                const uiDate = formatLaunchDateUI(item.launch_date);
                const tLabel = getTLabel(item.launch_date);
                const combinedLaunch = `${uiDate.weekday} ${uiDate.date} ${tLabel.label} ${item.launch_date || ""}`.toLowerCase();
                if (!combinedLaunch.includes(cGoLive))
                    return false;
            }
            // 3. Fixed Ops Assignee
            if (colFilterFixedAssignee) {
                if (colFilterFixedAssignee === "UNASSIGNED") {
                    if (fixedAssignee)
                        return false;
                }
                else if (fixedAssignee !== colFilterFixedAssignee) {
                    return false;
                }
            }
            // 4. Variable Ops Assignee
            if (colFilterVarAssignee) {
                if (colFilterVarAssignee === "UNASSIGNED") {
                    if (variableAssignee)
                        return false;
                }
                else if (variableAssignee !== colFilterVarAssignee) {
                    return false;
                }
            }
            // 5. IMP Type
            if (colFilterImpType && normalizedImp !== colFilterImpType) {
                return false;
            }
            // 6. Products
            if (cProduct && !(item.product_types || "").toLowerCase().includes(cProduct)) {
                return false;
            }
            // 7. Pre-Prod
            if (cPreProd && !(item.pre_production_environment_status || "").toLowerCase().includes(cPreProd)) {
                return false;
            }
            // 8. Superpod
            if (colFilterPod && item.superpod_id !== colFilterPod) {
                return false;
            }
            // 9. Blueprint Multi Checkbox Filters
            if (selectedBlueprintChecks.length > 0) {
                const bp = item.blueprint_statuses;
                for (const reqCheck of selectedBlueprintChecks) {
                    if (reqCheck === "parts" && !isBlueprintDone(bp?.parts))
                        return false;
                    if (reqCheck === "service" && !isBlueprintDone(bp?.service))
                        return false;
                    if (reqCheck === "accounting" && !isBlueprintDone(bp?.accounting))
                        return false;
                    if (reqCheck === "crm" && !isBlueprintDone(bp?.crm))
                        return false;
                    if (reqCheck === "analytics" && !isBlueprintDone(bp?.analytics))
                        return false;
                }
            }
            // 10. Setup Data
            if (colFilterSetupData) {
                const isComplete = isSetupDataComplete(item);
                if (colFilterSetupData === "COMPLETE" && !isComplete)
                    return false;
                if (colFilterSetupData === "INCOMPLETE" && (isComplete || Boolean(item.setup_data_error)))
                    return false;
                if (colFilterSetupData === "ERROR" && !item.setup_data_error)
                    return false;
            }
            // 11. Fixed Ops Status
            if (colFilterFixedStatus && item.fixed_ops_status !== colFilterFixedStatus) {
                return false;
            }
            // 12. Variable Ops Status
            if (colFilterVarStatus && item.variable_ops_status !== colFilterVarStatus) {
                return false;
            }
            // 13. Sign-Off
            if (colFilterSignoff) {
                const so = item.signoff_statuses;
                const statuses = [so?.parts, so?.service, so?.accounting].map((s) => (s || "").toUpperCase());
                if (!statuses.includes(colFilterSignoff.toUpperCase())) {
                    return false;
                }
            }
            // 14. Testing Status
            if (colFilterTestingStatus && item.testing_status !== colFilterTestingStatus) {
                return false;
            }
            // 15. Not Worked
            if (colFilterNotWorked) {
                if (colFilterNotWorked === "HANDLED_BY_ARC") {
                    if (item.not_worked && item.not_worked.trim() !== "")
                        return false;
                }
                else if (item.not_worked !== colFilterNotWorked) {
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
        productType,
        selectedMonth,
        fixedAssigneeFilter,
        variableAssigneeFilter,
        notWorkedFilter,
        fromDate,
        toDate,
        colFilterStore,
        colFilterGoLive,
        colFilterFixedAssignee,
        colFilterVarAssignee,
        colFilterImpType,
        colFilterProduct,
        colFilterPreProd,
        colFilterPod,
        selectedBlueprintChecks,
        colFilterSetupData,
        colFilterFixedStatus,
        colFilterVarStatus,
        colFilterSignoff,
        colFilterTestingStatus,
        colFilterNotWorked,
    ]);
    const persistSetupData = useCallback(async (tekionId, setupData) => {
        setRecords((prev) => {
            const updated = prev.map((row) => row.tekion_id === tekionId
                ? { ...row, setup_data: setupData, setup_data_fetched_at: setupData.fetchedAt, setup_data_error: "" }
                : row);
            void saveStores(updated);
            return updated;
        });
    }, []);
    const handleFetchSetupVisible = useCallback(async () => {
        setLoadingSetupAll(true);
        let fetched = 0;
        let skipped = 0;
        let failed = 0;
        try {
            const latestMap = new Map(records.map((r) => [r.tekion_id, r]));
            const queue = filtered.filter((row) => {
                const current = latestMap.get(row.tekion_id) ?? row;
                const complete = isSetupDataComplete(current);
                if (complete)
                    skipped++;
                return !complete;
            });
            for (let i = 0; i < queue.length; i++) {
                const current = latestMap.get(queue[i].tekion_id) ?? queue[i];
                setTapSyncProgress(`Setup ${i + 1}/${queue.length}`);
                try {
                    const setupData = await fetchSetupDataForStore(current, { force: true });
                    // Execute 4-step Pre-Prod MAP pipeline for tenant validation & account number count
                    let preprodValidation;
                    const tenantCandidate = current.tenant_code || current.tenant_name || "";
                    if (tenantCandidate) {
                        try {
                            preprodValidation = await executePreprodMapPipeline(tenantCandidate, current.dealer_id);
                        }
                        catch (err) {
                            logger.warn(`Failed Pre-Prod MAP verification for ${tenantCandidate}:`, err);
                        }
                    }
                    setRecords((prev) => {
                        const updated = prev.map((row) => row.tekion_id === current.tekion_id
                            ? {
                                ...row,
                                setup_data: setupData,
                                setup_data_fetched_at: setupData.fetchedAt,
                                setup_data_error: "",
                                preprod_validation: preprodValidation ?? row.preprod_validation,
                            }
                            : row);
                        void saveStores(updated);
                        return updated;
                    });
                    fetched++;
                }
                catch {
                    failed++;
                }
            }
            showToast(`✅ Setup data: ${fetched} fetched, ${skipped} complete (skipped)` + (failed ? `, ${failed} failed` : ""));
        }
        catch (error) {
            showToast(`❌ ${error instanceof Error ? error.message : "Failed setup fetch"}`);
        }
        finally {
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
            }
            else {
                showToast(`⚠ ${result.reason || "Failed to dispatch reports"}`);
            }
        }
        catch (err) {
            showToast(`❌ ${err instanceof Error ? err.message : "Failed to dispatch reports"}`);
        }
        finally {
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
            const { updatedStores, updatedCount } = await batchFetchRealTapStatuses(records, (processed, total, updated) => setTapSyncProgress(`${processed}/${total} (Updated: ${updated})`), (updatedStore) => {
                setRecords((prev) => safelyMergeStatusFields(prev, prev.map((r) => (r.tekion_id === updatedStore.tekion_id ? updatedStore : r))));
                void saveStores([updatedStore]);
            });
            if (updatedCount > 0) {
                setRecords((prev) => {
                    const merged = safelyMergeStatusFields(prev, updatedStores);
                    void saveStores(merged);
                    bulkUpdateStatusVault(merged.map((s) => ({
                        tekionId: s.tekion_id,
                        fixed_ops_status: s.fixed_ops_status,
                        variable_ops_status: s.variable_ops_status,
                        testing_status: s.testing_status,
                        custom_assignee: s.custom_assignee,
                        custom_variable_assignee: s.custom_variable_assignee,
                        not_worked: s.not_worked,
                    })));
                    return merged;
                });
                setTrackingTick((prev) => prev + 1);
                void syncStoresToGraphWorkbook(updatedStores);
                showToast(`✅ Synced real TAP statuses & attachments for ${updatedCount} store(s)!`);
            }
            else {
                showToast("ℹ Checked TAP tasks: No changes found.");
            }
        }
        catch (err) {
            showToast(`❌ ${err instanceof Error ? err.message : "TAP batch sync failed"}`);
        }
        finally {
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
        }
        catch (err) {
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
                    const merged = safelyMergeStatusFields(prev, result.updatedStores);
                    void saveStores(merged);
                    bulkUpdateStatusVault(merged.map((s) => ({
                        tekionId: s.tekion_id,
                        fixed_ops_status: s.fixed_ops_status,
                        variable_ops_status: s.variable_ops_status,
                        testing_status: s.testing_status,
                        custom_assignee: s.custom_assignee,
                        custom_variable_assignee: s.custom_variable_assignee,
                        not_worked: s.not_worked,
                    })));
                    return merged;
                });
                setTrackingTick((prev) => prev + 1);
            }
            showToast(`✅ Synced & merged ${result.rowCount} stores (${result.sheetCount} sheets)`);
        }
        catch (err) {
            showToast(`❌ ${err instanceof Error ? err.message : "Graph sync failed"}`);
        }
        finally {
            setSyncingExcel(false);
        }
    };
    const clearFilters = () => {
        setSearch("");
        setSuperpodId("");
        setImplementationType("");
        setProductType("");
        setSelectedMonth("");
        setFixedAssigneeFilter("");
        setVariableAssigneeFilter("");
        setNotWorkedFilter("");
        setFromDate(toInputDate(presetRange.fromDate));
        setToDate(toInputDate(presetRange.toDate));
        clearColumnFilters();
    };
    return (_jsxs("div", { className: "stores-shell", children: [_jsxs("div", { className: "stores-topbar", children: [_jsxs("div", { className: "stores-topbar-left", children: [_jsx("button", { className: "btn-secondary btn-sm", onClick: onBack, children: "\u2190 Back" }), _jsxs("div", { children: [_jsx("div", { className: "stores-page-title", children: "\uD83C\uDFEC Store Onboarding Tracker" }), _jsx("div", { className: "stores-page-subtitle", children: "Manage blueprints, operational sign-offs, and go-live readiness" })] })] }), _jsxs("div", { className: "stores-topbar-right", children: [_jsxs("div", { style: { display: "inline-flex", alignItems: "center", gap: 8, marginRight: 8 }, children: [_jsx("button", { type: "button", className: `btn-sm ${botState.enabled ? "btn-postman" : "btn-secondary"}`, onClick: () => storesBotRunner.setEnabled(!botState.enabled), style: { fontWeight: 700 }, title: botState.enabled ? "Click to Pause Autonomous Bot" : "Click to Enable Autonomous Bot", children: botState.enabled ? "🤖 Bot: ON" : "⏸ Bot: OFF" }), _jsx("span", { style: {
                                            fontSize: 11,
                                            fontWeight: 600,
                                            color: botState.error ? "#f87171" : botState.enabled ? "#4ade80" : "#94a3b8",
                                            maxWidth: 240,
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                        }, children: botState.statusText })] }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => void handleLoadIndexedDb(), children: "Cache" }), _jsxs("div", { className: "stores-export-group", children: [_jsx("button", { className: "btn-secondary btn-sm", onClick: handleExportExcel, children: "Export Excel" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: exportJson, children: "JSON" })] }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => void handleSyncExcel(), disabled: syncingExcel || Boolean(tokenExpiredMessage), children: syncingExcel ? "⏳ Syncing..." : "☁ Sync Excel" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => void handleFetchSetupVisible(), disabled: loadingSetupAll, children: loadingSetupAll ? "⏳ Setup..." : "🧩 Fetch Setup Data" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => void handleSendAllThreeReportsManual(), disabled: dispatching3Reports || records.length === 0, style: { borderColor: "rgba(168, 85, 247, 0.4)", color: "#c084fc", fontWeight: 700 }, title: "Manually dispatch Analytics, Fixed Ops & Variable Ops reports to Slack and reset 4-hour countdown", children: dispatching3Reports ? "⏳ Sending 3 Reports..." : "📢 Send 3 Reports (4h Window)" }), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => void handleSyncRealTapStatuses(), disabled: syncingTapStatuses || Boolean(tokenExpiredMessage) || records.length === 0, style: { borderColor: "rgba(56, 189, 248, 0.4)", color: "#38bdf8", fontWeight: 700 }, title: "Fetch real blueprint tasks and attachment counts from TAP and update stores", children: syncingTapStatuses ? `⏳ ${tapSyncProgress || "Syncing TAP..."}` : "⚡ Sync TAP Statuses" }), _jsx("button", { className: "btn-postman stores-refresh-btn", onClick: () => void handleFetch(true), disabled: loadingStores, children: loadingStores ? "⏳ Fetching..." : "🔄 Refresh" })] })] }), toastMessage && _jsx("div", { className: "stores-toast", children: toastMessage }), tokenExpiredMessage && (_jsxs("div", { className: "bx-error stores-token-expired-alert", children: [_jsxs("span", { children: ["\u26A0 ", tokenExpiredMessage] }), _jsx("a", { href: tapWorkordersUrl, target: "_blank", rel: "noreferrer", children: "Open TAP to recapture API \u2197" })] })), _jsxs("div", { className: `stores-layout ${filtersCollapsed ? "filters-collapsed" : ""}`, children: [!filtersCollapsed && (_jsx("aside", { className: "stores-sidebar", children: _jsxs("div", { className: "stores-panel", children: [_jsxs("div", { className: "stores-panel-header", children: [_jsx("span", { className: "stores-panel-title", children: "Filters" }), _jsx("button", { type: "button", onClick: clearFilters, children: "Reset all" })] }), _jsxs("div", { className: "stores-field", children: [_jsx("label", { className: "stores-label", children: "Search" }), _jsx("input", { className: "stores-input", value: search, onChange: (e) => setSearch(e.target.value), placeholder: "ID, Dealer, Name, or Assignee..." })] }), _jsxs("div", { className: "stores-field", children: [_jsx("label", { className: "stores-label", children: "T-Range Presets" }), _jsx("div", { className: "stores-preset-grid", children: [7, 30, 60, 90, 150].map((days) => (_jsxs("button", { type: "button", className: range === days ? "btn-postman" : "btn-secondary btn-sm", onClick: () => setRange(days), children: ["T-", days] }, days))) })] }), _jsxs("div", { className: "stores-field", children: [_jsx("label", { className: "stores-label", children: "Launch Window" }), _jsxs("div", { className: "stores-date-grid", children: [_jsx("input", { type: "date", className: "stores-input", value: fromDate, onChange: (e) => setFromDate(e.target.value) }), _jsx("input", { type: "date", className: "stores-input", value: toDate, onChange: (e) => setToDate(e.target.value) })] })] }), _jsxs("div", { className: "stores-field", children: [_jsx("label", { className: "stores-label", children: "Go-Live Month" }), _jsxs("select", { className: "stores-input", value: selectedMonth, onChange: (e) => setSelectedMonth(e.target.value), children: [_jsx("option", { value: "", children: "All Months" }), monthOptions.map((m) => (_jsx("option", { value: m, children: m }, m)))] })] }), _jsxs("div", { className: "stores-field", children: [_jsx("label", { className: "stores-label", children: "Ownership / Not Worked" }), _jsxs("select", { className: "stores-input", value: notWorkedFilter, onChange: (e) => setNotWorkedFilter(e.target.value), children: [_jsx("option", { value: "", children: "All Stores" }), _jsx("option", { value: "HANDLED_BY_ARC", children: "Handled by ARC Only" }), NOT_WORKED_OPTIONS.map((opt) => (_jsx("option", { value: opt, children: opt }, opt)))] })] }), _jsxs("div", { className: "stores-field", children: [_jsx("label", { className: "stores-label", children: "Fixed Ops Assignee" }), _jsxs("select", { className: "stores-input", value: fixedAssigneeFilter, onChange: (e) => setFixedAssigneeFilter(e.target.value), children: [_jsx("option", { value: "", children: "All Assignees" }), ASSIGNEE_OPTIONS.map((name) => (_jsx("option", { value: name, children: name }, name)))] })] }), _jsxs("div", { className: "stores-field", children: [_jsx("label", { className: "stores-label", children: "Variable Ops Assignee" }), _jsxs("select", { className: "stores-input", value: variableAssigneeFilter, onChange: (e) => setVariableAssigneeFilter(e.target.value), children: [_jsx("option", { value: "", children: "All Assignees" }), ASSIGNEE_OPTIONS.map((name) => (_jsx("option", { value: name, children: name }, name)))] })] }), _jsxs("div", { className: "stores-field", children: [_jsx("label", { className: "stores-label", children: "Pre-Prod POD" }), _jsxs("select", { className: "stores-input", value: superpodId, onChange: (e) => setSuperpodId(e.target.value), children: [_jsx("option", { value: "", children: "All PODs" }), superpodOptions.map((item) => (_jsx("option", { value: item, children: item }, item)))] })] }), _jsxs("div", { className: "stores-field", children: [_jsx("label", { className: "stores-label", children: "Implementation Type" }), _jsxs("select", { className: "stores-input", value: implementationType, onChange: (e) => setImplementationType(e.target.value), children: [_jsx("option", { value: "", children: "All Types" }), implementationTypeOptions.map((item) => (_jsx("option", { value: item, children: item }, item)))] })] }), _jsxs("div", { className: "stores-field", children: [_jsx("label", { className: "stores-label", children: "Product Type" }), _jsxs("select", { className: "stores-input", value: productType, onChange: (e) => setProductType(e.target.value), children: [_jsx("option", { value: "", children: "All Products" }), productTypeOptions.map((item) => (_jsx("option", { value: item, children: item }, item)))] })] }), hasAnyColumnFilter && (_jsx("div", { style: { marginTop: 12 }, children: _jsx("button", { type: "button", className: "btn-secondary btn-sm", onClick: clearColumnFilters, style: { width: "100%", color: "#f87171", borderColor: "rgba(248, 113, 113, 0.4)" }, children: "Clear Table Column Filters" }) })), error && _jsxs("div", { className: "bx-error", children: ["\u274C ", error] })] }) })), _jsx("section", { className: "stores-content", children: _jsxs("div", { className: "stores-table-card", children: [_jsxs("div", { className: "stores-table-header", children: [_jsxs("div", { className: "stores-table-header-left", children: [_jsx("span", { className: "stores-table-title", children: "Store Records" }), _jsxs("span", { className: "stores-table-count", children: ["Showing ", _jsx("strong", { children: filtered.length }), " of ", records.length, " stores"] }), _jsxs("div", { className: "stores-quick-links", children: [_jsx("a", { href: tapWorkordersUrl, target: "_blank", rel: "noreferrer", title: "Open TAP Workorders", className: "stores-quick-icon", children: _jsx("img", { src: "https://com-tekioncloud-tap-assets.s3.us-west-1.amazonaws.com/assets/common/toc-logo.svg", alt: "TAP Workorders" }) }), _jsx("a", { href: "https://app.slack.com/client/E08DG6QMMDG/C0C5QBWEM8X", target: "_blank", rel: "noreferrer", title: "Open Operations Slack Channel (C0C5QBWEM8X)", className: "stores-quick-icon", children: _jsx("img", { src: "https://cdn.brandfetch.io/idJ_HhtG0Z/theme/dark/symbol.svg?c=1dxbfHSJFAPEGdCLU4o5B", alt: "Slack" }) }), _jsx("a", { href: "https://app.tekioncloud.com/internal/approval-management/dashboard/requests", target: "_blank", rel: "noreferrer", title: "Open Production Approval Management", className: "stores-quick-btn stores-quick-btn-prod", children: "PROD" }), _jsx("a", { href: "http://outlook.office365.com/mail/inbox", target: "_blank", rel: "noreferrer", title: "Open Outlook Inbox", className: "stores-quick-icon", children: _jsx("img", { src: "https://cdn.brandfetch.io/idgdw68PEO/theme/dark/logo.svg?c=1dxbfHSJFAPEGdCLU4o5B", alt: "Outlook" }) }), _jsx("a", { href: "https://preprodapp.tekioncloud.com/accounting/chartOfAccounts/list", target: "_blank", rel: "noreferrer", title: "Open Pre-Prod Chart of Accounts", className: "stores-quick-btn stores-quick-btn-preprod", children: "PRE-PROD" }), _jsx("a", { href: "https://preprod-map.tekioncloud.com/map/blueprintValidation", target: "_blank", rel: "noreferrer", title: "Open PreProd MAP Blueprint Validation", className: "stores-quick-btn stores-quick-btn-map", children: "PreProd MAP" }), _jsx("a", { href: "https://tap.tekioncloud.com/timetracker/employee-view", target: "_blank", rel: "noreferrer", title: "Open TAP Time Tracker Employee View", className: "stores-quick-btn stores-quick-btn-timesheet", children: "Time Sheet" })] })] }), _jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [hasAnyColumnFilter && (_jsx("button", { className: "btn-secondary btn-sm", onClick: clearColumnFilters, title: "Reset all per-column table filter boxes", children: "Clear Col Filters" })), _jsx("button", { className: "btn-secondary btn-sm", onClick: () => setFiltersCollapsed((prev) => !prev), children: filtersCollapsed ? "☰ Show Filters" : "✕ Hide Filters" })] })] }), _jsxs("div", { className: "stores-table-wrap stores-table-wrap-tall", children: [_jsxs("table", { className: "stores-table", children: [_jsxs("thead", { children: [_jsxs("tr", { children: [_jsx("th", { children: "Store & IDs" }), _jsx("th", { children: "Go Live" }), _jsx("th", { children: "Fixed Ops Assignee" }), _jsx("th", { children: "Variable Ops Assignee" }), _jsx("th", { children: "IMP Type" }), _jsx("th", { children: "Products" }), _jsx("th", { children: "Pre-Prod" }), _jsx("th", { children: "POD" }), _jsx("th", { children: "Blueprint" }), _jsx("th", { children: "Setup Data" }), _jsx("th", { children: "Fixed Ops" }), _jsx("th", { children: "Variable Ops" }), _jsx("th", { children: "Sign_Off" }), _jsx("th", { children: "Testing" }), _jsx("th", { children: "Not Worked?" })] }), _jsxs("tr", { className: "stores-table-filter-row", style: { background: "#0b1329" }, children: [_jsx("th", { style: { padding: "4px 6px" }, children: _jsx("input", { type: "text", style: filterInputStyle, placeholder: "Filter ID/Name...", value: colFilterStore, onChange: (e) => setColFilterStore(e.target.value) }) }), _jsx("th", { style: { padding: "4px 6px" }, children: _jsx("input", { type: "text", style: filterInputStyle, placeholder: "Date/T-Day...", value: colFilterGoLive, onChange: (e) => setColFilterGoLive(e.target.value) }) }), _jsx("th", { style: { padding: "4px 6px" }, children: _jsxs("select", { style: filterInputStyle, value: colFilterFixedAssignee, onChange: (e) => setColFilterFixedAssignee(e.target.value), children: [_jsx("option", { value: "", children: "All" }), _jsx("option", { value: "UNASSIGNED", children: "Unassigned" }), ASSIGNEE_OPTIONS.map((name) => (_jsx("option", { value: name, children: name }, name)))] }) }), _jsx("th", { style: { padding: "4px 6px" }, children: _jsxs("select", { style: filterInputStyle, value: colFilterVarAssignee, onChange: (e) => setColFilterVarAssignee(e.target.value), children: [_jsx("option", { value: "", children: "All" }), _jsx("option", { value: "UNASSIGNED", children: "Unassigned" }), ASSIGNEE_OPTIONS.map((name) => (_jsx("option", { value: name, children: name }, name)))] }) }), _jsx("th", { style: { padding: "4px 6px" }, children: _jsxs("select", { style: filterInputStyle, value: colFilterImpType, onChange: (e) => setColFilterImpType(e.target.value), children: [_jsx("option", { value: "", children: "All" }), implementationTypeOptions.map((item) => (_jsx("option", { value: item, children: item }, item)))] }) }), _jsx("th", { style: { padding: "4px 6px" }, children: _jsx("input", { type: "text", style: filterInputStyle, placeholder: "Product...", value: colFilterProduct, onChange: (e) => setColFilterProduct(e.target.value) }) }), _jsx("th", { style: { padding: "4px 6px" }, children: _jsx("input", { type: "text", style: filterInputStyle, placeholder: "Pre-Prod...", value: colFilterPreProd, onChange: (e) => setColFilterPreProd(e.target.value) }) }), _jsx("th", { style: { padding: "4px 6px" }, children: _jsxs("select", { style: filterInputStyle, value: colFilterPod, onChange: (e) => setColFilterPod(e.target.value), children: [_jsx("option", { value: "", children: "All" }), superpodOptions.map((item) => (_jsx("option", { value: item, children: item }, item)))] }) }), _jsxs("th", { style: { padding: "4px 6px", position: "relative" }, ref: blueprintDropdownRef, children: [_jsxs("button", { type: "button", onClick: () => setIsBlueprintDropdownOpen((prev) => !prev), style: {
                                                                                ...filterInputStyle,
                                                                                display: "flex",
                                                                                alignItems: "center",
                                                                                justifyContent: "space-between",
                                                                                cursor: "pointer",
                                                                                color: selectedBlueprintChecks.length > 0 ? "#38bdf8" : "#94a3b8",
                                                                                borderColor: selectedBlueprintChecks.length > 0 ? "rgba(56, 189, 248, 0.6)" : "rgba(148, 163, 248, 0.25)",
                                                                                background: selectedBlueprintChecks.length > 0 ? "rgba(56, 189, 248, 0.1)" : "#0f172a",
                                                                                fontWeight: selectedBlueprintChecks.length > 0 ? 700 : 500,
                                                                                textAlign: "left",
                                                                            }, title: "Filter by Completed Blueprint Areas (Multi-select)", children: [_jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: selectedBlueprintChecks.length === 0
                                                                                        ? "All Blueprints"
                                                                                        : `${selectedBlueprintChecks.length} Completed selected` }), _jsx("span", { style: { fontSize: 9, marginLeft: 4 }, children: "\u25BC" })] }), isBlueprintDropdownOpen && (_jsxs("div", { style: {
                                                                                position: "absolute",
                                                                                top: "100%",
                                                                                left: 4,
                                                                                minWidth: 205,
                                                                                background: "#0f172a",
                                                                                border: "1px solid rgba(56, 189, 248, 0.4)",
                                                                                borderRadius: 6,
                                                                                boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.7), 0 8px 10px -6px rgba(0, 0, 0, 0.7)",
                                                                                zIndex: 99999,
                                                                                padding: 8,
                                                                                display: "flex",
                                                                                flexDirection: "column",
                                                                                gap: 6,
                                                                                marginTop: 4,
                                                                                textAlign: "left",
                                                                            }, children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(148,163,184,0.15)", paddingBottom: 4 }, children: [_jsx("span", { style: { fontSize: 10, fontWeight: 800, color: "#38bdf8", letterSpacing: "0.5px", textTransform: "uppercase" }, children: "Blueprint Completed:" }), selectedBlueprintChecks.length > 0 && (_jsx("button", { type: "button", onClick: () => setSelectedBlueprintChecks([]), style: {
                                                                                                background: "transparent",
                                                                                                border: "none",
                                                                                                color: "#f87171",
                                                                                                fontSize: 10,
                                                                                                cursor: "pointer",
                                                                                                fontWeight: 700,
                                                                                                padding: 0,
                                                                                            }, children: "Clear" }))] }), BLUEPRINT_CHECKBOX_KEYS.map(({ key, label }) => {
                                                                                    const checked = selectedBlueprintChecks.includes(key);
                                                                                    return (_jsxs("label", { style: {
                                                                                            display: "flex",
                                                                                            alignItems: "center",
                                                                                            gap: 7,
                                                                                            fontSize: 11,
                                                                                            color: checked ? "#f8fafc" : "#cbd5e1",
                                                                                            cursor: "pointer",
                                                                                            userSelect: "none",
                                                                                            padding: "2px 4px",
                                                                                            borderRadius: 4,
                                                                                            background: checked ? "rgba(56, 189, 248, 0.12)" : "transparent",
                                                                                        }, children: [_jsx("input", { type: "checkbox", checked: checked, onChange: () => toggleBlueprintFilter(key), style: { cursor: "pointer", accentColor: "#38bdf8" } }), _jsx("span", { children: label })] }, key));
                                                                                })] }))] }), _jsx("th", { style: { padding: "4px 6px" }, children: _jsxs("select", { style: filterInputStyle, value: colFilterSetupData, onChange: (e) => setColFilterSetupData(e.target.value), children: [_jsx("option", { value: "", children: "All" }), _jsx("option", { value: "COMPLETE", children: "Complete" }), _jsx("option", { value: "INCOMPLETE", children: "Pending / Incomplete" }), _jsx("option", { value: "ERROR", children: "Error" })] }) }), _jsx("th", { style: { padding: "4px 6px" }, children: _jsxs("select", { style: filterInputStyle, value: colFilterFixedStatus, onChange: (e) => setColFilterFixedStatus(e.target.value), children: [_jsx("option", { value: "", children: "All" }), phaseStatusOptions.map((status) => (_jsx("option", { value: status, children: status }, status)))] }) }), _jsx("th", { style: { padding: "4px 6px" }, children: _jsxs("select", { style: filterInputStyle, value: colFilterVarStatus, onChange: (e) => setColFilterVarStatus(e.target.value), children: [_jsx("option", { value: "", children: "All" }), phaseStatusOptions.map((status) => (_jsx("option", { value: status, children: status }, status)))] }) }), _jsx("th", { style: { padding: "4px 6px" }, children: _jsxs("select", { style: filterInputStyle, value: colFilterSignoff, onChange: (e) => setColFilterSignoff(e.target.value), children: [_jsx("option", { value: "", children: "All" }), SIGN_OFF_FILTER_OPTIONS.map((status) => (_jsx("option", { value: status, children: status }, status)))] }) }), _jsx("th", { style: { padding: "4px 6px" }, children: _jsxs("select", { style: filterInputStyle, value: colFilterTestingStatus, onChange: (e) => setColFilterTestingStatus(e.target.value), children: [_jsx("option", { value: "", children: "All" }), phaseStatusOptions.map((status) => (_jsx("option", { value: status, children: status }, status)))] }) }), _jsx("th", { style: { padding: "4px 6px" }, children: _jsxs("select", { style: filterInputStyle, value: colFilterNotWorked, onChange: (e) => setColFilterNotWorked(e.target.value), children: [_jsx("option", { value: "", children: "All" }), _jsx("option", { value: "HANDLED_BY_ARC", children: "Handled by ARC Only" }), NOT_WORKED_OPTIONS.map((opt) => (_jsx("option", { value: opt, children: opt }, opt)))] }) })] })] }), _jsx("tbody", { children: filtered.map((row) => {
                                                        const tLabel = getTLabel(row.launch_date);
                                                        const blueprint = row.blueprint_statuses;
                                                        const signoff = row.signoff_statuses;
                                                        const podStyle = getPodStyle(row.superpod_id);
                                                        const cleanedImp = cleanImpType(row.implementation_type);
                                                        const uiDate = formatLaunchDateUI(row.launch_date);
                                                        const fixedAssignee = resolveStoreAssignee(row);
                                                        const variableAssignee = row.custom_variable_assignee || "";
                                                        void trackingTick;
                                                        const fixedOpsTime = buildLatestFieldTrackingText(row.tekion_id, "fixed_ops_status", false);
                                                        const variableOpsTime = buildLatestFieldTrackingText(row.tekion_id, "variable_ops_status", false);
                                                        const fixedAttCount = row.fixed_ops_attachments ??
                                                            ((row.fetched_blueprint_tasks?.partsTasks || []).reduce((acc, t) => acc + (t.taskAttachmentCount || 0), 0) +
                                                                (row.fetched_blueprint_tasks?.serviceTasks || []).reduce((acc, t) => acc + (t.taskAttachmentCount || 0), 0));
                                                        const varAttCount = row.variable_ops_attachments ??
                                                            (row.fetched_blueprint_tasks?.accountingTasks || []).reduce((acc, t) => acc + (t.taskAttachmentCount || 0), 0);
                                                        const mapValidation = row.preprod_validation;
                                                        return (_jsxs("tr", { children: [_jsx("td", { style: { minWidth: 230, maxWidth: 340 }, children: _jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 4 }, children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "nowrap" }, children: [_jsx("button", { type: "button", className: "stores-copy-btn", title: "Copy Tekion ID", onClick: () => handleCopy(row.tekion_id, `tek-${row.tekion_id}`), style: { fontWeight: 800, color: "#f8fafc" }, children: copiedKey === `tek-${row.tekion_id}` ? "Copied!" : row.tekion_id }), _jsx("button", { type: "button", className: "stores-copy-btn", title: "Copy Dealer ID", onClick: () => handleCopy(row.dealer_id, `dlr-${row.tekion_id}`), style: { color: "#38bdf8", fontWeight: 700 }, children: copiedKey === `dlr-${row.tekion_id}` ? "Copied!" : row.dealer_id }), _jsx("button", { type: "button", className: "stores-slack-trigger-btn", onClick: () => setActiveDealerPopup(row), style: { marginLeft: "auto" }, children: "\uD83D\uDCAC Update" })] }), _jsx("button", { type: "button", className: "stores-copy-btn", title: "Click to copy dealership name", onClick: () => handleCopy(row.dba_name, `dba-${row.tekion_id}`), style: {
                                                                                    textAlign: "left",
                                                                                    color: "#94a3b8",
                                                                                    fontSize: 12,
                                                                                    lineHeight: 1.35,
                                                                                    whiteSpace: "normal",
                                                                                    wordBreak: "break-word",
                                                                                    padding: "2px 4px",
                                                                                    borderRadius: 4,
                                                                                    background: "transparent",
                                                                                    border: "none",
                                                                                    cursor: "pointer",
                                                                                }, children: copiedKey === `dba-${row.tekion_id}` ? _jsx("span", { style: { color: "#4ade80", fontWeight: 700 }, children: "Copied!" }) : row.dba_name || "—" }), mapValidation && (_jsx("div", { style: { marginTop: 2 }, children: mapValidation.isValidTenant ? (_jsx("span", { style: {
                                                                                        fontSize: 10,
                                                                                        fontWeight: 700,
                                                                                        color: "#4ade80",
                                                                                        background: "rgba(74, 222, 128, 0.1)",
                                                                                        border: "1px solid rgba(74, 222, 128, 0.25)",
                                                                                        padding: "1px 5px",
                                                                                        borderRadius: 4,
                                                                                    }, title: `Valid tenant: ${mapValidation.tenantName}`, children: "\u2713 Tenant Valid" })) : (_jsx("span", { style: {
                                                                                        fontSize: 10,
                                                                                        fontWeight: 700,
                                                                                        color: "#f87171",
                                                                                        background: "rgba(248, 113, 113, 0.12)",
                                                                                        border: "1px solid rgba(248, 113, 113, 0.3)",
                                                                                        padding: "1px 5px",
                                                                                        borderRadius: 4,
                                                                                    }, title: mapValidation.validationError || "Tenant validation failed", children: "\u26A0\uFE0F Tenant Invalid" })) }))] }) }), _jsx("td", { children: _jsxs("div", { className: "stores-launch-date-cell", children: [_jsxs("div", { style: { display: "flex", alignItems: "center", gap: 5 }, children: [uiDate.weekday && _jsx("span", { style: { fontSize: 11, fontWeight: 500, color: "#64748b", letterSpacing: "0.2px" }, children: uiDate.weekday }), _jsx("span", { style: { fontSize: 11, fontWeight: 800, color: "#38bdf8", background: "rgba(56, 189, 248, 0.12)", border: "1px solid rgba(56, 189, 248, 0.3)", padding: "2px 6px", borderRadius: 5, letterSpacing: "0.3px" }, children: uiDate.date })] }), _jsx("div", { style: { fontSize: 10, color: "#94a3b8", marginTop: 3 }, children: tLabel.label })] }) }), _jsx("td", { style: { minWidth: 130 }, children: _jsxs("select", { value: fixedAssignee, onChange: (e) => void updateStoreFixedAssignee(row.tekion_id, e.target.value), style: {
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
                                                                        }, children: [_jsx("option", { value: "", children: "\u2014 Unassigned \u2014" }), ASSIGNEE_OPTIONS.map((name) => (_jsx("option", { value: name, children: name }, name)))] }) }), _jsx("td", { style: { minWidth: 130 }, children: _jsxs("select", { value: variableAssignee, onChange: (e) => void updateStoreVariableAssignee(row.tekion_id, e.target.value), style: {
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
                                                                        }, children: [_jsx("option", { value: "", children: "\u2014 Unassigned \u2014" }), ASSIGNEE_OPTIONS.map((name) => (_jsx("option", { value: name, children: name }, name)))] }) }), _jsx("td", { children: cleanedImp || "—" }), _jsx("td", { children: row.product_types || "—" }), _jsx("td", { children: row.pre_production_environment_status || "—" }), _jsx("td", { children: _jsx("span", { className: "stores-pod-badge", style: { background: podStyle.bg, color: podStyle.color, border: `1px solid ${podStyle.border}` }, children: row.superpod_id || "—" }) }), _jsx("td", { children: _jsx(StatusChipGroup, { items: [
                                                                            { short: "P", fullName: "Blueprint - Parts", status: blueprint?.parts ?? "UNKNOWN" },
                                                                            { short: "S", fullName: "Blueprint - Service", status: blueprint?.service ?? "UNKNOWN" },
                                                                            { short: "A", fullName: "Blueprint - Accounting", status: blueprint?.accounting ?? "UNKNOWN" },
                                                                            { short: "C", fullName: "Blueprint - CRM", status: blueprint?.crm ?? "UNKNOWN" },
                                                                            { short: "AN", fullName: "Blueprint - Analytics", status: blueprint?.analytics ?? "UNKNOWN" },
                                                                        ] }) }), _jsxs("td", { children: [_jsx(SetupDataCell, { row: row }), mapValidation?.accountNumberCount !== undefined && (_jsx("div", { style: { marginTop: 4 }, children: _jsxs("span", { style: {
                                                                                    display: "inline-flex",
                                                                                    alignItems: "center",
                                                                                    gap: 4,
                                                                                    fontSize: 10,
                                                                                    fontWeight: 800,
                                                                                    color: "#38bdf8",
                                                                                    background: "rgba(56, 189, 248, 0.12)",
                                                                                    border: "1px solid rgba(56, 189, 248, 0.3)",
                                                                                    padding: "2px 6px",
                                                                                    borderRadius: 4,
                                                                                }, title: "acct_dms_account_number Count from Pre-Prod MAP", children: [_jsx("span", { children: "#\uFE0F\u20E3 Accounts:" }), _jsx("span", { children: mapValidation.accountNumberCount.toLocaleString() })] }) }))] }), _jsx("td", { children: _jsxs("div", { className: "stores-status-cell-wrap", children: [_jsx(CustomStatusSelect, { value: row.fixed_ops_status, onChange: (val) => void updateCustomStatus(row.tekion_id, "fixed_ops_status", val) }), _jsx("div", { style: { marginTop: 3 }, children: _jsxs("span", { style: {
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
                                                                                    }, title: "Total attachments across Parts and Service blueprint tasks", children: [_jsx("span", { children: "\uD83D\uDCCE" }), _jsxs("span", { children: [fixedAttCount, row.attachments_incomplete ? "+" : "", " Attachment", fixedAttCount === 1 ? "" : "s"] })] }) }), fixedOpsTime !== "—" && _jsx("span", { className: "stores-tracking-timestamp", children: fixedOpsTime })] }) }), _jsx("td", { children: _jsxs("div", { className: "stores-status-cell-wrap", children: [_jsx(CustomStatusSelect, { value: row.variable_ops_status, onChange: (val) => void updateCustomStatus(row.tekion_id, "variable_ops_status", val) }), _jsx("div", { style: { marginTop: 3 }, children: _jsxs("span", { style: {
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
                                                                                    }, title: "Total attachments across Accounting blueprint tasks", children: [_jsx("span", { children: "\uD83D\uDCCE" }), _jsxs("span", { children: [varAttCount, row.attachments_incomplete ? "+" : "", " Attachment", varAttCount === 1 ? "" : "s"] })] }) }), variableOpsTime !== "—" && _jsx("span", { className: "stores-tracking-timestamp", children: variableOpsTime })] }) }), _jsx("td", { children: _jsx(StatusChipGroup, { items: [
                                                                            { short: "P", fullName: "Parts Operational Sign-Off", status: signoff?.parts ?? "UNKNOWN" },
                                                                            { short: "S", fullName: "Service Operational Sign-Off", status: signoff?.service ?? "UNKNOWN" },
                                                                            { short: "A", fullName: "Accounting Operational Sign-Off", status: signoff?.accounting ?? "UNKNOWN" },
                                                                        ] }) }), _jsx("td", { children: _jsx(CustomStatusSelect, { value: row.testing_status, onChange: (val) => void updateCustomStatus(row.tekion_id, "testing_status", val) }) }), _jsx("td", { style: { minWidth: 200 }, children: _jsxs("select", { value: row.not_worked || "", onChange: (e) => void updateStoreNotWorked(row.tekion_id, e.target.value), style: {
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
                                                                        }, children: [_jsx("option", { value: "", children: "\u2014 Handled by ARC \u2014" }), NOT_WORKED_OPTIONS.map((opt) => (_jsx("option", { value: opt, children: opt }, opt)))] }) })] }, row.tekion_id));
                                                    }) })] }), !loadingStores && filtered.length === 0 && (_jsxs("div", { className: "stores-empty", style: { padding: 40, textAlign: "center" }, children: [_jsx("div", { style: { fontSize: 32 }, children: "\uD83C\uDFEC" }), _jsx("div", { style: { fontSize: 16, fontWeight: 700, marginTop: 8 }, children: "No records found" }), _jsx("div", { style: { color: "#94a3b8", fontSize: 13, marginTop: 4 }, children: "Try clearing filters or adjusting your date window" })] }))] })] }) })] }), _jsx(DealerMetaModal, { row: currentModalRecord, onClose: () => setActiveDealerPopup(null), onToast: showToast, onTasksSnapshot: handleTasksSnapshot, onSetupFetched: (tekionId, setupData) => {
                    setActiveDealerPopup((prev) => prev && prev.tekion_id === tekionId
                        ? { ...prev, setup_data: setupData, setup_data_fetched_at: setupData.fetchedAt, setup_data_error: "" }
                        : prev);
                    void persistSetupData(tekionId, setupData);
                }, onTaskOperationalStatusChange: (tekionId, field, value) => {
                    void updateCustomStatus(tekionId, field, value);
                }, staticSlackMap: STATIC_SLACK_MAP }), _jsxs("button", { type: "button", onClick: () => setIsCopilotOpen((prev) => !prev), style: {
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
                }, onMouseEnter: (e) => { e.currentTarget.style.transform = "scale(1.05)"; }, onMouseLeave: (e) => { e.currentTarget.style.transform = "scale(1)"; }, title: "Open Interactive Stores AI Copilot with Persistent Learning", children: [_jsx("span", { style: { fontSize: 16 }, children: "\uD83E\uDD16" }), _jsx("span", { children: isCopilotOpen ? "Close AI" : "Stores Copilot" })] }), _jsx(StoresAI, { isOpen: isCopilotOpen, onClose: () => setIsCopilotOpen(false), records: records, onToast: showToast })] }));
};
export default Stores;
