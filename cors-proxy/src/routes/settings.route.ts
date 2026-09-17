import { Router, Request, Response } from "express";
import { logError } from "../utils/logger";

const router = Router();

// ── POST /API/settings/tekion-token ──────────────────────────────────────────
// Proxies to Tekion auth API — bypasses CORS
router.post("/tekion-token", async (req: Request, res: Response) => {
  const { username, password, endpoint } = req.body as {
    username?: string;
    password?: string;
    endpoint?: string;
  };

  if (!username || !password) {
    return res.status(400).json({ error: "username and password required" });
  }

  const url = (endpoint ?? "").trim() ||
    "https://us-west1-tapapi-01.tekioncloud.com/tapDuo/api/v1/auth/token";

  try {
    const upstream = await fetch(url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ username, password }),
    });

    const raw = await upstream.json() as Record<string, unknown>;

    // Handle common Tekion response shapes
    const nested = raw.data as Record<string, unknown> | undefined;

    const token =
      (raw.token          as string | undefined) ??
      (raw.access_token   as string | undefined) ??
      (raw.accessToken    as string | undefined) ??
      (nested?.token      as string | undefined) ??
      (nested?.accessToken as string | undefined);

    if (!token) {
      return res.status(401).json({
        error: "No token found in response — check credentials or endpoint",
        raw,
      });
    }

    // Parse expiry — handle seconds (3600) or ISO string
    const rawExpiry = raw.expiresAt ?? raw.expires_at ?? raw.expiry ?? raw.expires_in;
    let expiresAt: string;
    if (typeof rawExpiry === "number") {
      // Treat as seconds from now if < 1_000_000, else epoch ms
      expiresAt = new Date(
        rawExpiry < 1_000_000
          ? Date.now() + rawExpiry * 1000
          : rawExpiry
      ).toISOString();
    } else if (typeof rawExpiry === "string") {
      expiresAt = new Date(rawExpiry).toISOString();
    } else {
      expiresAt = new Date(Date.now() + 3_600_000).toISOString(); // default 1 hour
    }

    return res.json({ token, expiresAt });

  } catch (err: unknown) {
    logError("settings", "POST /tekion-token failed", err, { endpoint: url });
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Token fetch failed",
    });
  }
});

// ── GET /API/settings/ms-photo?email=... ─────────────────────────────────────
// Proxies to Microsoft Graph — bypasses CORS
// Requires:  Authorization: Bearer <token>  header from client
router.get("/ms-photo", async (req: Request, res: Response) => {
  const { email }   = req.query as { email?: string };
  const authHeader  = req.headers.authorization;

  if (!email) {
    return res.status(400).json({ error: "email query param required" });
  }
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authorization: Bearer <token> header required" });
  }

  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}/photo/$value`;

  try {
    const upstream = await fetch(url, {
      headers: {
        Authorization: authHeader,
        Accept:        "image/jpeg, image/png, image/*",
      },
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      return res.status(upstream.status).json({
        error:  `MS Graph ${upstream.status} ${upstream.statusText}`,
        detail: errText,
      });
    }

    const contentType  = upstream.headers.get("content-type") ?? "image/jpeg";
    const arrayBuffer  = await upstream.arrayBuffer();
    const buffer       = Buffer.from(arrayBuffer);

    res.setHeader("Content-Type",   contentType);
    res.setHeader("Cache-Control",  "private, max-age=3600");
    return res.send(buffer);

  } catch (err: unknown) {
    logError("settings", "GET /ms-photo failed", err, { email });
    return res.status(500).json({
      error: err instanceof Error ? err.message : "Photo fetch failed",
    });
  }
});

export default router;
