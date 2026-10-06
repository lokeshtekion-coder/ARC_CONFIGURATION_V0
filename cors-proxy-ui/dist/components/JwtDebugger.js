import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { decodeJwt } from "../utils/jwt";
export function JwtDebugger({ token, title }) {
    if (!token.trim())
        return null;
    const decoded = decodeJwt(token);
    return (_jsxs("div", { className: "rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-3", children: [_jsxs("div", { className: "flex items-center justify-between", children: [_jsx("h4", { className: "text-sm font-semibold text-white", children: title }), decoded.isExpired !== undefined ? (_jsx("span", { className: `text-xs px-2 py-1 rounded ${decoded.isExpired
                            ? "bg-red-500/20 text-red-300"
                            : "bg-green-500/20 text-green-300"}`, children: decoded.isExpired ? "Expired" : "Valid" })) : null] }), decoded.error ? (_jsx("div", { className: "text-sm text-red-300", children: decoded.error })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "grid gap-2 text-xs text-slate-300", children: [decoded.issuedAt ? _jsxs("div", { children: ["Issued At: ", decoded.issuedAt] }) : null, decoded.expiresAt ? _jsxs("div", { children: ["Expires At: ", decoded.expiresAt] }) : null] }), _jsxs("div", { children: [_jsx("div", { className: "text-xs font-medium text-slate-300 mb-1", children: "Header" }), _jsx("pre", { className: "text-xs bg-slate-950 rounded p-3 overflow-auto text-slate-200 whitespace-pre-wrap break-all", children: JSON.stringify(decoded.header?.json ?? decoded.header?.raw ?? null, null, 2) })] }), _jsxs("div", { children: [_jsx("div", { className: "text-xs font-medium text-slate-300 mb-1", children: "Payload" }), _jsx("pre", { className: "text-xs bg-slate-950 rounded p-3 overflow-auto text-slate-200 whitespace-pre-wrap break-all", children: JSON.stringify(decoded.payload?.json ?? decoded.payload?.raw ?? null, null, 2) })] })] }))] }));
}
