export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface KeyValuePair {
  key:     string;
  value:   string;
  enabled: boolean;
}

export interface RequestState {
  url:     string;
  method:  HttpMethod;
  headers: KeyValuePair[];
  params:  KeyValuePair[];
  body:    string;
}

export interface ResponseData {
  status:     number;
  statusText: string;
  headers:    Record<string, string>;
  body:       string;
  duration:   number;
}
