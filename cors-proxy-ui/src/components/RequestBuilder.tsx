import React, { useState } from "react";
import type { HttpMethod, KeyValuePair, RequestState } from "../types/proxy.types";
import { KeyValueEditor } from "./HeadersEditor";
import { BodyEditor } from "./BodyEditor";

interface Props {
  onSend: (state: RequestState) => void;
  loading: boolean;
}

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH"];

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET:    "#30d158",
  POST:   "#0a84ff",
  PUT:    "#ff9f0a",
  DELETE: "#ff453a",
  PATCH:  "#bf5af2",
};

type RequestTab = "params" | "headers" | "body";

const defaultPair = (): KeyValuePair => ({ key: "", value: "", enabled: true });

export const RequestBuilder: React.FC<Props> = ({ onSend, loading }) => {
  const [url, setUrl]         = useState("https://jsonplaceholder.typicode.com/posts");
  const [method, setMethod]   = useState<HttpMethod>("GET");
  const [tab, setTab]         = useState<RequestTab>("params");
  const [params, setParams]   = useState<KeyValuePair[]>([defaultPair()]);
  const [headers, setHeaders] = useState<KeyValuePair[]>([
    { key: "Content-Type", value: "application/json", enabled: true },
  ]);
  const [body, setBody] = useState("{}");

  const isBodyDisabled = method === "GET";

  const handleSend = () => {
    onSend({ url, method, headers, params, body });
  };

  return (
    <div className="request-builder">

      {/* URL Bar */}
      <div className="url-bar">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as HttpMethod)}
          className="method-select"
          style={{ color: METHOD_COLORS[method] }}
        >
          {METHODS.map((m) => (
            <option key={m} value={m} style={{ color: METHOD_COLORS[m] }}>
              {m}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.example.com/endpoint"
          className="url-input"
          onKeyDown={(e) => e.key === "Enter" && !loading && handleSend()}
        />

        <button
          onClick={handleSend}
          disabled={loading || !url.trim()}
          className="btn-send"
        >
          {loading ? "Sending…" : "Send"}
        </button>
      </div>

      {/* Tabs */}
      <div className="tab-bar">
        {(["params", "headers", "body"] as RequestTab[]).map((t) => (
          <button
            key={t}
            className={`tab-btn ${tab === t ? "tab-active" : ""} ${
              t === "body" && isBodyDisabled ? "tab-disabled" : ""
            }`}
            onClick={() => setTab(t)}
            disabled={t === "body" && isBodyDisabled}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === "body" && isBodyDisabled && (
              <span className="tab-badge">N/A for GET</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {tab === "params" && (
          <KeyValueEditor
            pairs={params}
            onChange={setParams}
            placeholder={["Param Key", "Param Value"]}
          />
        )}
        {tab === "headers" && (
          <KeyValueEditor
            pairs={headers}
            onChange={setHeaders}
            placeholder={["Header Key", "Header Value"]}
          />
        )}
        {tab === "body" && !isBodyDisabled && (
          <BodyEditor value={body} onChange={setBody} />
        )}
      </div>

    </div>
  );
};
