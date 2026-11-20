import { Router, Request, Response } from "express";
import axios from "axios";
import type { AxiosRequestHeaders, Method } from "axios";
import { URL } from "node:url";

const router = Router();

// ============================================================================
// 1. SSRF DEFENSE: ALLOWED DESTINATION DOMAINS & IP GUARDS
// ============================================================================

const DEFAULT_ALLOWED_HOST_PATTERNS = [
  // Tekion infrastructure
  /^([a-z0-9-]+\.)*tekioncloud\.com$/i,
  /^([a-z0-9-]+\.)*tekion\.com$/i,
  // Slack API & enterprise routing
  /^([a-z0-9-]+\.)*slack\.com$/i,
  // Microsoft Graph & Azure Auth
  /^graph\.microsoft\.com$/i,
  /^login\.microsoftonline\.com$/i,
  // AWS S3 Assets
  /^com-tekioncloud-[a-z0-9-]+\.s3\.us-west-1\.amazonaws\.com$/i,
];

// Load additional host patterns from environment (comma-separated domains)
const customAllowedHosts = (process.env.PROXY_ALLOWED_DOMAINS || "")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean)
  .map((d) => new RegExp(`^([a-z0-9-]+\\.)*${d.replace(/\./g, "\\.")}$`, "i"));

const ALL_ALLOWED_PATTERNS = [...DEFAULT_ALLOWED_HOST_PATTERNS, ...customAllowedHosts];

function isPrivateOrLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase();

  // Localhost & loopback strings
  if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") {
    return true;
  }

  // Cloud metadata link-local addresses (AWS / GCP / Azure)
  if (h === "169.254.169.254" || h.startsWith("169.254.")) {
    return true;
  }

  // RFC1918 Private IPv4 subnets
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) {
    return true;
  }

  return false;
}

function validateTargetUrl(rawUrl: string): { valid: boolean; error?: string; parsedUrl?: URL } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { valid: false, error: "Malformed target URL" };
  }

  // 1. Only allow HTTP and HTTPS
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { valid: false, error: `Disallowed protocol '${parsed.protocol}'. Only HTTPS/HTTP supported.` };
  }

  // 2. Reject internal & loopback addresses
  if (isPrivateOrLoopback(parsed.hostname)) {
    return { valid: false, error: "Access to private or local network addresses is prohibited." };
  }

  // 3. Reject non-standard ports (prevents port scanning internal services)
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    return { valid: false, error: `Disallowed port '${parsed.port}'. Only standard ports permitted.` };
  }

  // 4. Validate hostname against pattern allowlist
  const isMatch = ALL_ALLOWED_PATTERNS.some((pattern) => pattern.test(parsed.hostname));
  if (!isMatch) {
    return {
      valid: false,
      error: `Destination domain '${parsed.hostname}' is not authorized in proxy allowlist.`,
    };
  }

  return { valid: true, parsedUrl: parsed };
}

// ============================================================================
// 2. ROUTES
// ============================================================================

router.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "cors-proxy",
    time: new Date().toISOString(),
  });
});

/**
 * DIRECT MULTIPART STREAMING UPLOAD ROUTE
 * Handles multipart file uploads directly without body-parser buffering or stream locking.
 */
router.post("/upload", async (req: Request, res: Response) => {
  const targetUrl = typeof req.query.url === "string" ? req.query.url : "";

  if (!targetUrl) {
    return res.status(400).json({
      ok: false,
      error: { code: "INVALID_URL", message: "Missing target URL in query (?url=...)" },
    });
  }

  const validation = validateTargetUrl(targetUrl);
  if (!validation.valid) {
    console.warn(`[proxy] 🛡️ Blocked SSRF attempt on upload: ${validation.error} (URL: ${targetUrl})`);
    return res.status(403).json({
      ok: false,
      error: { code: "FORBIDDEN_DESTINATION", message: validation.error },
    });
  }

  try {
    // Collect forwarded headers, stripping host and hop-by-hop headers
    const forwardHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (
        lower !== "host" &&
        lower !== "connection" &&
        lower !== "content-length" &&
        typeof value === "string" &&
        value.trim()
      ) {
        forwardHeaders[key] = value;
      }
    }

    // Pipe the unconsumed raw incoming request stream directly to Tekion
    const upstreamResponse = await fetch(targetUrl, {
      method: "POST",
      headers: forwardHeaders,
      body: req as any,
      // @ts-ignore Node 18+ duplex requirement for streaming request bodies
      duplex: "half",
    });

    const responseText = await upstreamResponse.text();
    return res.status(upstreamResponse.status).send(responseText);
  } catch (err: any) {
    console.error("[proxy/upload] Upstream streaming error:", err?.message || err);
    return res.status(502).json({
      ok: false,
      error: {
        code: "UPSTREAM_UPLOAD_GATEWAY_ERROR",
        message: err?.message || "Failed to forward upload stream",
      },
    });
  }
});

/**
 * STANDARD JSON / PROXY ROUTE
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      url,
      method = "GET",
      headers = {},
      body,
      multipartBase64,
      timeout = 45000,
    }: {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: unknown;
      multipartBase64?: {
        fields?: Record<string, string>;
        file?: {
          fieldName?: string;
          name: string;
          type?: string;
          base64: string;
        };
      };
      timeout?: number;
    } = req.body ?? {};

    if (!url || typeof url !== "string") {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_URL", message: "Missing or invalid 'url' in payload" },
      });
    }

    // SSRF Validation
    const validation = validateTargetUrl(url);
    if (!validation.valid) {
      console.warn(`[proxy] 🛡️ Blocked SSRF attempt: ${validation.error} (URL: ${url})`);
      return res.status(403).json({
        ok: false,
        error: { code: "FORBIDDEN_DESTINATION", message: validation.error },
      });
    }

    const normalizedMethod = String(method || "GET").toUpperCase() as Method;

    // Filter and sanitize forwarded request headers
    const forwardedHeaders: AxiosRequestHeaders = Object.entries(headers || {}).reduce(
      (acc, [key, value]) => {
        const lowerKey = key.toLowerCase();
        // Drop dangerous hop-by-hop headers
        if (
          lowerKey !== "host" &&
          lowerKey !== "content-length" &&
          lowerKey !== "transfer-encoding" &&
          lowerKey !== "connection" &&
          typeof value === "string" &&
          value.trim()
        ) {
          acc[key] = value;
        }
        return acc;
      },
      {} as AxiosRequestHeaders
    );

    let outgoingData: any = normalizedMethod === "GET" ? undefined : body;

    // Convert multipartBase64 into native FormData binary stream if provided
    if (multipartBase64?.file?.base64) {
      const { file, fields } = multipartBase64;
      const buffer = Buffer.from(file.base64, "base64");

      const FormDataClass = (globalThis as any).FormData || FormData;
      const BlobClass = (globalThis as any).Blob || Blob;
      const formData = new FormDataClass();

      if (fields && typeof fields === "object") {
        for (const [key, val] of Object.entries(fields)) {
          formData.append(key, String(val));
        }
      }

      const fileBlob = new BlobClass([buffer], {
        type: file.type || "application/octet-stream",
      });
      formData.append(file.fieldName || "file", fileBlob, file.name);

      outgoingData = formData;

      // Allow FormData and Axios to calculate boundary
      delete forwardedHeaders["content-type"];
      delete forwardedHeaders["Content-Type"];
    }

    const MAX_RESPONSE_BYTES = 25 * 1024 * 1024; // 25 MB
    const safeTimeout = Math.min(Math.max(Number(timeout) || 45000, 1000), 90000); // 1s - 90s bound

    const response = await axios({
      url,
      method: normalizedMethod,
      headers: forwardedHeaders,
      data: outgoingData,
      timeout: safeTimeout,
      validateStatus: () => true, // Don't throw on 4xx/5xx; pass upstream status cleanly
      maxRedirects: 3,
      maxBodyLength: MAX_RESPONSE_BYTES,
      maxContentLength: MAX_RESPONSE_BYTES,
    });

    return res.status(200).json({
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      body: response.data,
    });
  } catch (error: any) {
    const errorMsg = error?.message ?? "Proxy request failed";
    console.error("[proxy] Upstream error:", errorMsg);

    return res.status(502).json({
      ok: false,
      error: {
        code: "UPSTREAM_GATEWAY_ERROR",
        message: errorMsg,
        details: error?.response?.data ?? null,
      },
    });
  }
});

export default router;