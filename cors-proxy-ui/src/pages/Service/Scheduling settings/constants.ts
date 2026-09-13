import type { DayOption, SchedulingSubsectionKey, OperationKey } from "./types";

export const CONSUMER_SCHEDULING_URL =
  "https://preprodapp.tekioncloud.com/api/scheduling/u/cs/settings";

export const SERVICE_ADVISORS_URL =
  "https://preprodapp.tekioncloud.com/api/service/u/settings/scheduling/service-advisors";

export const GENERAL_SCHEDULING_URL =
  "https://preprodapp.tekioncloud.com/api/service/u/settings/scheduling/general";

export const SERVICE_SHOP_LIST_URL =
  "https://preprodapp.tekioncloud.com/api/scheduling/u/settings/serviceShop";

export const USERS_BY_PERSONA_URL =
  "https://preprodapp.tekioncloud.com/api/userservice/u/v2/user/by-persona";

export const SCHEDULING_AGGREGATED_SETTINGS_URL =
  "https://preprodapp.tekioncloud.com/api/service-module/u/scheduling/aggregated-settings/fetch";

export const ACCOUNTING_DEPARTMENTS_URL =
  "https://preprodapp.tekioncloud.com/api/accounting/u/departments";

export const ACCOUNTING_BOOTSTRAP_URL =
  "https://preprodapp.tekioncloud.com/api/accounting/u/configurable/bootstrap";

export const SERVICE_ADVISOR_SCHEDULE_URL =
  "https://preprodapp.tekioncloud.com/api/scheduling/u/settings/serviceAdvisor";

export const TRANSPORTATION_SETTINGS_URL =
  "https://preprodapp.tekioncloud.com/api/scheduling/u/settings/transportation";

export const DAY_OPTIONS: DayOption[] = [
  { key: "sunday", label: "Sunday", code: "SUN", defaultBlocked: true },
  { key: "monday", label: "Monday", code: "MON", defaultBlocked: false },
  { key: "tuesday", label: "Tuesday", code: "TUE", defaultBlocked: false },
  { key: "wednesday", label: "Wednesday", code: "WED", defaultBlocked: false },
  { key: "thursday", label: "Thursday", code: "THU", defaultBlocked: false },
  { key: "friday", label: "Friday", code: "FRI", defaultBlocked: false },
  { key: "saturday", label: "Saturday", code: "SAT", defaultBlocked: false },
];

export const SUBSECTION_ITEMS: Array<{
  key: SchedulingSubsectionKey;
  label: string;
}> = [
  { key: "consumer-scheduling", label: "1. Consumer Scheduling" },
  { key: "transportation", label: "2. Transportation" },
  { key: "service-advisors", label: "3. Service Advisors" },
  { key: "shops", label: "4. Shops" },
  { key: "general", label: "5. General" },
];

export const SUBSECTION_META: Record<
  SchedulingSubsectionKey,
  { title: string; description: string; ops: OperationKey[] }
> = {
  "consumer-scheduling": {
    title: "Consumer Scheduling",
    description: "",
    ops: ["get", "put"],
  },
  transportation: {
    title: "Transportation",
    description: "Fetch transportation types and auto-configure them.",
    ops: ["get", "configure"],
  },
  "service-advisors": {
    title: "Service Advisors",
    description: "Fetch service advisors settings and configure advisor schedules.",
    ops: ["get", "post"],
  },
  shops: {
    title: "Shops",
    description: "View shops and configure Main Shop schedule.",
    ops: ["get", "configure"],
  },
  general: {
    title: "General",
    description: "Fetch and create general scheduling settings.",
    ops: ["get", "post"],
  },
};
