export type SchedulingSubsectionKey =
  | "consumer-scheduling"
  | "transportation"
  | "service-advisors"
  | "shops"
  | "general";

export type OperationKey = "get" | "put" | "post" | "configure";

export type UiMessage = {
  ok: boolean;
  text: string;
};

export type ConsumerSchedulingResponse = {
  data?: {
    allowToRemoveVehicle?: boolean;
    allowCustomerToAddVin?: boolean;
  };
  [key: string]: unknown;
};

export type ShopHour = {
  day?: string;
  blocked?: boolean;
  startTime?: {
    timeInHours?: number;
    timeInMinutes?: number;
  } | null;
  endTime?: {
    timeInHours?: number;
    timeInMinutes?: number;
  } | null;
};

export type ShopRecord = {
  id?: string;
  name?: string;
  status?: string;
  defaultShop?: boolean;
  description?: string;
  orderId?: number;
  departmentId?: string | null;
  serviceAdvisors?: string[];
  associationIds?: string[];
  blocks?: unknown[];
  holidays?: unknown[];
  vehicles?: unknown[];
  hours?: ShopHour[];
  [key: string]: unknown;
};

export type TransportationSummaryRow = {
  id?: string;
  displayName?: string;
  transportationType?: string;
};

export type DayOption = {
  key: "sunday" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday";
  label: string;
  code: string;
  defaultBlocked: boolean;
};

export type DayKey = DayOption["key"];

export type DayState = Record<
  DayKey,
  {
    start: string;
    end: string;
    blocked: boolean;
  }
>;
