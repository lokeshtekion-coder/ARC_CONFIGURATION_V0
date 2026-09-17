// Small shared logger so every route reports failures the same way:
// [tag] message  { context }
// Point is to make "something is failing" visible in the terminal running
// the backend without having to guess which route/file it came from - not
// to log every request (that's already handled by logger.middleware.ts).
function format(tag: string, message: string): string {
  return `[${tag}] ${message}`;
}

export function logError(tag: string, message: string, err?: unknown, context?: Record<string, unknown>): void {
  const detail = err instanceof Error ? err.message : err !== undefined ? String(err) : undefined;
  if (detail && context) {
    console.error(format(tag, message), detail, context);
  } else if (detail) {
    console.error(format(tag, message), detail);
  } else if (context) {
    console.error(format(tag, message), context);
  } else {
    console.error(format(tag, message));
  }
}

export function logWarn(tag: string, message: string, context?: Record<string, unknown>): void {
  if (context) console.warn(format(tag, message), context);
  else console.warn(format(tag, message));
}

export function logInfo(tag: string, message: string, context?: Record<string, unknown>): void {
  if (context) console.log(format(tag, message), context);
  else console.log(format(tag, message));
}
