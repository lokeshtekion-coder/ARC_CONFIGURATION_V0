import { STORE_QUERY_FIELDS } from "./queryFields";
export function getFieldValue(store, field) {
    switch (field) {
        case "dealer_id":
            return store.dealerId;
        case "dba_name":
            return store.dbaName;
        case "launch_days":
            return store.launchDays;
        case "fixed_ops_status":
            return store.fixedOpsStatus;
        case "variable_ops_status":
            return store.variableOpsStatus;
        case "testing_status":
            return store.testingStatus;
        case "parts_blueprint":
            return store.partsBlueprint;
        case "service_blueprint":
            return store.serviceBlueprint;
        case "accounting_blueprint":
            return store.accountingBlueprint;
        case "analytics_blueprint":
            return store.analyticsBlueprint;
        case "attachments":
            return store.attachments;
        case "custom_assignee":
            return store.assignee;
        case "custom_variable_assignee":
            return store.variableAssignee;
        case "setup_data_error":
            return store.setupDataError;
        case "not_worked":
            return store.notWorked;
        case "is_fixed_unblocked":
            return store.isFixedOpsUnblocked;
        case "is_variable_blocked":
            return store.isVariableOpsBlocked;
        case "is_analytics_escalated":
            return store.isAnalyticsEscalated;
        case "is_actionable_by_arc":
            return store.isActionableByArc;
        default:
            return undefined;
    }
}
export function evaluateFilter(store, filter) {
    const actual = getFieldValue(store, filter.field);
    switch (filter.operator) {
        case "eq":
            return String(actual ?? "").toLowerCase() === String(filter.value ?? "").toLowerCase();
        case "neq":
            return String(actual ?? "").toLowerCase() !== String(filter.value ?? "").toLowerCase();
        case "contains":
            return String(actual ?? "")
                .toLowerCase()
                .includes(String(filter.value ?? "").toLowerCase());
        case "not_contains":
            return !String(actual ?? "")
                .toLowerCase()
                .includes(String(filter.value ?? "").toLowerCase());
        case "gt":
            return Number(actual) > Number(filter.value);
        case "gte":
            return Number(actual) >= Number(filter.value);
        case "lt":
            return Number(actual) < Number(filter.value);
        case "lte":
            return Number(actual) <= Number(filter.value);
        case "is_empty":
            return actual === null || actual === undefined || actual === "";
        case "is_not_empty":
            return actual !== null && actual !== undefined && actual !== "";
        case "in":
            if (!Array.isArray(filter.value))
                return false;
            return filter.value.map((v) => String(v).toLowerCase()).includes(String(actual ?? "").toLowerCase());
        default:
            return false;
    }
}
export function validateStoreQuery(query) {
    if (!query || typeof query !== "object")
        return false;
    const q = query;
    if (q.entity !== "store" || !Array.isArray(q.filters))
        return false;
    for (const filter of q.filters) {
        if (!filter.field || !(filter.field in STORE_QUERY_FIELDS)) {
            return false;
        }
    }
    return true;
}
export function executeStoreQuery(query, stores) {
    let result = [...stores];
    for (const filter of query.filters) {
        result = result.filter((store) => evaluateFilter(store, filter));
    }
    if (query.sort && query.sort.field in STORE_QUERY_FIELDS) {
        result.sort((a, b) => {
            const av = getFieldValue(a, query.sort.field);
            const bv = getFieldValue(b, query.sort.field);
            if (av === bv)
                return 0;
            if (av === null || av === undefined)
                return 1;
            if (bv === null || bv === undefined)
                return -1;
            if (av < bv)
                return query.sort.direction === "asc" ? -1 : 1;
            if (av > bv)
                return query.sort.direction === "asc" ? 1 : -1;
            return 0;
        });
    }
    if (query.limit && query.limit > 0) {
        result = result.slice(0, query.limit);
    }
    return result;
}
