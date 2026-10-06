import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { KeyValueEditor } from "./HeadersEditor";
import { BodyEditor } from "./BodyEditor";
const METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
const METHOD_COLORS = {
    GET: "#30d158",
    POST: "#0a84ff",
    PUT: "#ff9f0a",
    DELETE: "#ff453a",
    PATCH: "#bf5af2",
};
const defaultPair = () => ({ key: "", value: "", enabled: true });
export const RequestBuilder = ({ onSend, loading }) => {
    const [url, setUrl] = useState("https://jsonplaceholder.typicode.com/posts");
    const [method, setMethod] = useState("GET");
    const [tab, setTab] = useState("params");
    const [params, setParams] = useState([defaultPair()]);
    const [headers, setHeaders] = useState([
        { key: "Content-Type", value: "application/json", enabled: true },
    ]);
    const [body, setBody] = useState("{}");
    const isBodyDisabled = method === "GET";
    const handleSend = () => {
        onSend({ url, method, headers, params, body });
    };
    return (_jsxs("div", { className: "request-builder", children: [_jsxs("div", { className: "url-bar", children: [_jsx("select", { value: method, onChange: (e) => setMethod(e.target.value), className: "method-select", style: { color: METHOD_COLORS[method] }, children: METHODS.map((m) => (_jsx("option", { value: m, style: { color: METHOD_COLORS[m] }, children: m }, m))) }), _jsx("input", { type: "text", value: url, onChange: (e) => setUrl(e.target.value), placeholder: "https://api.example.com/endpoint", className: "url-input", onKeyDown: (e) => e.key === "Enter" && !loading && handleSend() }), _jsx("button", { onClick: handleSend, disabled: loading || !url.trim(), className: "btn-send", children: loading ? "Sending…" : "Send" })] }), _jsx("div", { className: "tab-bar", children: ["params", "headers", "body"].map((t) => (_jsxs("button", { className: `tab-btn ${tab === t ? "tab-active" : ""} ${t === "body" && isBodyDisabled ? "tab-disabled" : ""}`, onClick: () => setTab(t), disabled: t === "body" && isBodyDisabled, children: [t.charAt(0).toUpperCase() + t.slice(1), t === "body" && isBodyDisabled && (_jsx("span", { className: "tab-badge", children: "N/A for GET" }))] }, t))) }), _jsxs("div", { className: "tab-content", children: [tab === "params" && (_jsx(KeyValueEditor, { pairs: params, onChange: setParams, placeholder: ["Param Key", "Param Value"] })), tab === "headers" && (_jsx(KeyValueEditor, { pairs: headers, onChange: setHeaders, placeholder: ["Header Key", "Header Value"] })), tab === "body" && !isBodyDisabled && (_jsx(BodyEditor, { value: body, onChange: setBody }))] })] }));
};
