import { decodeJwt } from "../utils/jwt";

interface JwtDebuggerProps {
  token: string;
  title: string;
}

export function JwtDebugger({ token, title }: JwtDebuggerProps) {
  if (!token.trim()) return null;

  const decoded = decodeJwt(token);

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">{title}</h4>
        {decoded.isExpired !== undefined ? (
          <span
            className={`text-xs px-2 py-1 rounded ${
              decoded.isExpired
                ? "bg-red-500/20 text-red-300"
                : "bg-green-500/20 text-green-300"
            }`}
          >
            {decoded.isExpired ? "Expired" : "Valid"}
          </span>
        ) : null}
      </div>

      {decoded.error ? (
        <div className="text-sm text-red-300">{decoded.error}</div>
      ) : (
        <>
          <div className="grid gap-2 text-xs text-slate-300">
            {decoded.issuedAt ? <div>Issued At: {decoded.issuedAt}</div> : null}
            {decoded.expiresAt ? <div>Expires At: {decoded.expiresAt}</div> : null}
          </div>

          <div>
            <div className="text-xs font-medium text-slate-300 mb-1">Header</div>
            <pre className="text-xs bg-slate-950 rounded p-3 overflow-auto text-slate-200 whitespace-pre-wrap break-all">
{JSON.stringify(decoded.header?.json ?? decoded.header?.raw ?? null, null, 2)}
            </pre>
          </div>

          <div>
            <div className="text-xs font-medium text-slate-300 mb-1">Payload</div>
            <pre className="text-xs bg-slate-950 rounded p-3 overflow-auto text-slate-200 whitespace-pre-wrap break-all">
{JSON.stringify(decoded.payload?.json ?? decoded.payload?.raw ?? null, null, 2)}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
