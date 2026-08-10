interface HeaderMapViewerProps {
  title: string;
  headers?: Record<string, string>;
  capturedAt?: string;
  sourceUrl?: string;
}

export function HeaderMapViewer({
  title,
  headers,
  capturedAt,
  sourceUrl,
}: HeaderMapViewerProps) {
  const entries = Object.entries(headers ?? {}).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-white">{title}</h4>
        <span className="text-xs text-slate-400">{entries.length} headers</span>
      </div>

      {capturedAt ? (
        <div className="text-xs text-slate-400">Captured At: {capturedAt}</div>
      ) : null}

      {sourceUrl ? (
        <div className="text-xs text-slate-400 break-all">Source URL: {sourceUrl}</div>
      ) : null}

      {entries.length === 0 ? (
        <div className="text-sm text-slate-400">No headers saved</div>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, value]) => (
            <div
              key={key}
              className="grid grid-cols-12 gap-2 rounded bg-slate-950/60 p-2 text-xs"
            >
              <div className="col-span-4 text-sky-300 break-all">{key}</div>
              <div className="col-span-8 text-slate-200 break-all">{value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
