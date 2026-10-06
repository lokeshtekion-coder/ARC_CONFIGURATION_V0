import { Request, Response, NextFunction } from "express";

const loggerMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const startedAt = Date.now();
  const requestId = req.id ?? "unknown";

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const logLine = `[HTTP] [${requestId}] ${req.method} ${req.path} -> ${res.statusCode} (${durationMs}ms)`;

    if (res.statusCode >= 500) {
      console.error(logLine);
    } else if (res.statusCode >= 400) {
      console.warn(logLine);
    } else {
      console.log(logLine);
    }
  });

  res.on("close", () => {
    if (!res.writableFinished) {
      const durationMs = Date.now() - startedAt;
      console.warn(
        `[HTTP] [${requestId}] ${req.method} ${req.path} -> connection closed before response finished (${durationMs}ms)`
      );
    }
  });

  next();
};

export default loggerMiddleware;
