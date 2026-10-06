export type QueryOperator =
  | "eq"
  | "neq"
  | "contains"
  | "not_contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_empty"
  | "is_not_empty"
  | "in";

export interface QueryFilter {
  field: string;
  operator: QueryOperator;
  value?: unknown;
}

export interface StoreQuery {
  entity: "store";
  filters: QueryFilter[];
  output?: "count" | "rows" | "both" | "slack_csv";
  aggregate?: {
    type: "count" | "sum" | "avg" | "min" | "max";
    field?: string;
  };
  sort?: {
    field: string;
    direction: "asc" | "desc";
  };
  limit?: number;
}

export interface StoreFact {
  dealerId: string;
  tekionId: string;
  dbaName: string;
  launchDays: number;
  fixedOpsStatus: string;
  variableOpsStatus: string;
  testingStatus: string;
  partsBlueprint: string;
  serviceBlueprint: string;
  accountingBlueprint: string;
  analyticsBlueprint: string;
  attachments: number;
  assignee: string | null;
  variableAssignee: string | null;
  setupDataError: string | null;
  notWorked: string | null;
  isPodFixed: boolean;
  isPodVariable: boolean;
  isFullyExcluded: boolean;
  isFixedOpsUnblocked: boolean;
  isVariableOpsBlocked: boolean;
  isAnalyticsEscalated: boolean;
  isActionableByArc: boolean;
}
