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
    const {
      url,
      method = "GET",
      headers = {},
      body,
      multipartBase64,
      timeout = 60000,
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
      console.log("[proxy] Invalid URL received");
      return res.status(400).json({
        error: "Missing or invalid 'url'",
      });
    }

    const normalizedMethod = String(method || "GET").toUpperCase() as Method;

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

    let outgoingData: any = normalizedMethod === "GET" ? undefined : body;

    // Convert multipartBase64 into native FormData binary stream
    if (multipartBase64?.file?.base64) {
      const { file, fields } = multipartBase64;
      const buffer = Buffer.from(file.base64, "base64");

      const FormDataClass = (globalThis as any).FormData || FormData;
      const BlobClass = (globalThis as any).Blob || Blob;
      const formData = new FormDataClass();

      // Append extra text fields (such as isDeletable=true)
      if (fields && typeof fields === "object") {
        for (const [key, val] of Object.entries(fields)) {
          formData.append(key, String(val));
        }
      }

      // Append binary file blob with filename
      const fileBlob = new BlobClass([buffer], {
        type: file.type || "application/octet-stream",
      });
      formData.append(file.fieldName || "file", fileBlob, file.name);

      outgoingData = formData;

      // Remove manual content-type so Axios and FormData compute multipart boundary
      delete forwardedHeaders["content-type"];
      delete forwardedHeaders["Content-Type"];

      console.log("[proxy] 📎 Reconstructed multipart FormData:", {
        fileName: file.name,
        fileSizeBytes: buffer.length,
        fieldName: file.fieldName || "file",
      });
    }

    console.log("[proxy] Forwarding request:", {
      url,
      method: normalizedMethod,
      headerKeys: Object.keys(forwardedHeaders),
      isMultipart: Boolean(multipartBase64?.file),
    });

    const response = await axios({
      url,
      method: normalizedMethod,
      headers: forwardedHeaders,
      data: outgoingData,
      timeout: typeof timeout === "number" ? timeout : 60000,
      validateStatus: () => true,
      maxRedirects: 5,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
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