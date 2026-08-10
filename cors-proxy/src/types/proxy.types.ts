export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface ProxyRequestBody {
  url: string;
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: unknown;
  params?: Record<string, string>;
  timeout?: number;
}

export interface ProxyResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
  requestUrl: string;
  method: HttpMethod;
  durationMs: number;
}

export interface ProxyErrorResponse {
  error: string;
  code?: string | number;
  status?: number;
  requestUrl?: string;
}