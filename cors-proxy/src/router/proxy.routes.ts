import { Router, Request, Response } from "express";
import axios from "axios";
import type { AxiosRequestHeaders, Method } from "axios";

const router = Router();

router.get("/health", (_req: Request, res: Response) => {
  console.log("[proxy] GET /health");
  res.json({
    ok: true,
    service: "cors-proxy",
    time: new Date().toISOString(),
  });
});

router.post("/", async (req: Request, res: Response) => {
  try {
    console.log("[proxy] POST /api/proxy called");
    console.log("[proxy] Incoming body:", JSON.stringify(req.body, null, 2));

    const {
      url,
      method = "GET",
      headers = {},
      body,
    }: {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
    } = req.body ?? {};

    if (!url || typeof url !== "string") {
      console.log("[proxy] Invalid URL received");
      return res.status(400).json({
        error: "Missing or invalid 'url'",
      });
    }

    const normalizedMethod = String(method || "GET").toUpperCase() as Method;
    console.log("[proxy] Forwarding request:", {
      url,
      method: normalizedMethod,
      headerKeys: Object.keys(headers || {}),
    });

    const forwardedHeaders: AxiosRequestHeaders = Object.entries(headers || {}).reduce(
      (acc, [key, value]) => {
        if (typeof value === "string" && value.trim()) {
          acc[key] = value;
        }
        return acc;
      },
      {} as AxiosRequestHeaders
    );

    delete forwardedHeaders["host"];
    delete forwardedHeaders["content-length"];

    const response = await axios({
      url,
      method: normalizedMethod,
      headers: forwardedHeaders,
      data: normalizedMethod === "GET" ? undefined : body,
      validateStatus: () => true,
      maxRedirects: 5,
    });

    console.log("[proxy] Upstream response:", {
      status: response.status,
      statusText: response.statusText,
      dataType: typeof response.data,
      hasData: response.data !== undefined && response.data !== null,
    });

    return res.status(200).json({
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: response.data,
    });
  } catch (error: any) {
    console.error("[proxy] Proxy request failed");
    console.error("[proxy] Error message:", error?.message);
    console.error("[proxy] Error response data:", error?.response?.data);

    return res.status(500).json({
      error: error?.message ?? "Proxy request failed",
      details: error?.response?.data ?? null,
    });
  }
});

export default router;
