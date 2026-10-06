import { Router, Request, Response } from "express";
import axios from "axios";

const router = Router();

type HeaderMap = Record<string, string>;

function log(step: string, message: string, meta?: unknown) {
  if (meta !== undefined) {
    console.log(`[storesGlam] [${step}] ${message}`, meta);
  } else {
    console.log(`[storesGlam] [${step}] ${message}`);
  }
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function getObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pickFirstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    const normalized = normalize(value);
    if (normalized) return normalized;
  }
  return "";
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env variable: ${name}`);
  return value;
}

function extractSiteId(loginData: unknown, targetDealerId: string): string {
  const root = getObject(loginData);
  const dealerOemSites = Array.isArray(root.dealerOemSites)
    ? (root.dealerOemSites as Array<Record<string, unknown>>)
    : [];

  for (const dealerEntry of dealerOemSites) {
    if (normalize(dealerEntry?.dealerId) !== targetDealerId) continue;

    const oemSites = Array.isArray(dealerEntry?.oemSites)
      ? (dealerEntry.oemSites as Array<Record<string, unknown>>)
      : [];

    const defaultSite =
      oemSites.find((site) => site?.defaultSite === true) ?? oemSites[0];

    const siteId = normalize(defaultSite?.siteId);
    if (siteId) return siteId;
  }

  return `-1_${targetDealerId}`;
}

function resolveApi3DataRoot(payload: unknown): Record<string, unknown> {
  const root = getObject(payload);
  const directData = getObject(root.data);
  if (Object.keys(directData).length > 0) return directData;
  const nestedData = getObject(getObject(root.result).data);
  if (Object.keys(nestedData).length > 0) return nestedData;
  return root;
}

function resolveApi3LoginData(api3Payload: unknown): Record<string, unknown> {
  const dataRoot = resolveApi3DataRoot(api3Payload);
  return getObject(dataRoot.loginData);
}

function resolveTekionAccessToken(api3Payload: unknown): string {
  const dataRoot = resolveApi3DataRoot(api3Payload);
  const loginData = getObject(dataRoot.loginData);
  return pickFirstNonEmpty(
    dataRoot.access_token,
    dataRoot.accessToken,
    loginData.access_token,
    loginData.accessToken,
    getObject(dataRoot.data).access_token,
    getObject(dataRoot.data).accessToken
  );
}

function resolveApi3UserId(api3Payload: unknown): string {
  const dataRoot = resolveApi3DataRoot(api3Payload);
  const loginData = getObject(dataRoot.loginData);
  return pickFirstNonEmpty(
    dataRoot.originalUserId,
    dataRoot.userId,
    dataRoot.id,
    loginData.originalUserId,
    loginData.userId,
    loginData.id,
    "f43b994d-a069-4286-979f-4ad3cfae7670"
  );
}

router.post("/", async (req: Request, res: Response) => {
  try {
    const dealerId = normalize(req.body?.dealerId);
    const tenant = normalize(req.body?.tenant);
    const env = normalize(req.body?.env || "preprod");

    log("INPUT", "Incoming GLAM + Bootstrap request", { dealerId, tenant, env });

    if (!dealerId) return res.status(400).json({ ok: false, error: "dealerId is required" });
    if (!tenant) return res.status(400).json({ ok: false, error: "tenant is required" });

    // Step 1: Login to CQA
    const loginUrl = readRequiredEnv("CQA_LOGIN_URL");
    const loginApiKey = readRequiredEnv("CQA_LOGIN_API_KEY");
    const loginUsername = readRequiredEnv("CQA_LOGIN_USERNAME");
    const loginPassword = readRequiredEnv("CQA_LOGIN_PASSWORD");
    const dealerPropertiesUrl = readRequiredEnv("CQA_DEALER_PROPERTIES_URL");
    const dealerPropertiesApiKey = readRequiredEnv("CQA_DEALER_PROPERTIES_API_KEY");
    const generateTokenUrlBase = readRequiredEnv("CQA_GENERATE_TOKEN_URL_BASE");
    const generateTokenApiKey = readRequiredEnv("CQA_GENERATE_TOKEN_API_KEY");

    const loginRes = await axios.post<{ result?: { token?: string } }>(
      loginUrl,
      { username: loginUsername, password: loginPassword },
      { headers: { "x-api-key": loginApiKey, "Content-Type": "application/json" } }
    );
    const cqaToken = normalize(loginRes.data?.result?.token);
    if (!cqaToken) throw new Error("CQA login token missing from API 1");

    // Step 2: Get Dealer Properties & Super Admin Username
    const propsRes = await axios.post<{ properties?: Array<{ SUPER_ADMIN_USERNAME?: string; SYSTEM_ADMIN_USERNAME?: string }> }>(
      dealerPropertiesUrl,
      { dealerid: dealerId, env, tenant },
      {
        headers: {
          "x-api-key": dealerPropertiesApiKey,
          authorization: `Bearer ${cqaToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    const prop = propsRes.data?.properties?.[0];
    if (!prop) throw new Error(`No properties returned for dealer ${dealerId}`);

    const sourceUsername = normalize(prop.SUPER_ADMIN_USERNAME) || normalize(prop.SYSTEM_ADMIN_USERNAME);
    if (!sourceUsername) throw new Error(`Admin username missing for dealer ${dealerId}`);

    // Step 3: Generate Live Tekion Access Token
    const tokenRes = await axios.get(
      `${generateTokenUrlBase}?emailId=${encodeURIComponent(sourceUsername)}`,
      {
        headers: {
          authorization: `Bearer ${cqaToken}`,
          "x-api-key": generateTokenApiKey,
          "content-type": "application/json",
        },
      }
    );

    const loginData = resolveApi3LoginData(tokenRes.data);
    const tekionApiToken = resolveTekionAccessToken(tokenRes.data);
    const userId = resolveApi3UserId(tokenRes.data);
    const siteId = extractSiteId(loginData, dealerId);

    if (!tekionApiToken) throw new Error("Tekion access token generation failed in API 3");

    const host = env === "prod" ? "https://app.tekioncloud.com" : "https://preprodapp.tekioncloud.com";

    const commonHeaders: HeaderMap = {
      clientid: "web",
      roleid: `${dealerId}_ISM_Admin`,
      dealerid: dealerId,
      "tekion-api-token": tekionApiToken,
      tenantname: tenant,
      "tek-siteid": siteId,
      userid: userId,
      program: "DEFAULT",
      locale: "en_US",
      applicationid: "ARC_NA",
      productids: "ARC",
      subapplicationid: "US",
      accept: "application/json, text/plain, */*",
      flattenedaecprogramsmap: "",
      "content-type": "application/json;charset=utf-8",
    };

    // Step 4a: Call GLAM Endpoint (GET)
    const glamUrl = `${host}/api/accounting/u/settings/mapping/rule/asset/GLACCOUNT`;
    log("GLAM_FETCH", `Calling ${glamUrl} for ${dealerId}`);
    const glamRes = await axios.get(glamUrl, {
      headers: commonHeaders,
      timeout: 30000,
      validateStatus: () => true,
    });

    if (glamRes.status >= 400) {
      throw new Error(`GLAM endpoint failed with HTTP ${glamRes.status}: ${JSON.stringify(glamRes.data).slice(0, 300)}`);
    }

    // Step 4b: Call Configurable Bootstrap Endpoint for "allAccounts" (POST)
    const bootstrapUrl = `${host}/api/accounting/u/configurable/bootstrap`;
    const bootstrapBody = {
      requestInfo: [
        {
          assetType: "allAccounts",
          dealerMetaDataInfo: [
            {
              dealerId,
            },
          ],
        },
      ],
    };

    log("BOOTSTRAP_FETCH", `Calling ${bootstrapUrl} for ${dealerId}`);
    const bootstrapRes = await axios.post(bootstrapUrl, bootstrapBody, {
      headers: commonHeaders,
      timeout: 30000,
      validateStatus: () => true,
    });

    if (bootstrapRes.status >= 400) {
      log("BOOTSTRAP_WARN", `Bootstrap endpoint returned HTTP ${bootstrapRes.status}`);
    }

    log("SUCCESS", `Fetched GLAM & Bootstrap for dealer ${dealerId}`);

    return res.json({
      ok: true,
      dealerId,
      tenant,
      data: glamRes.data,
      bootstrapData: bootstrapRes.data,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "GLAM fetch failed";
    log("ERROR", msg);
    return res.status(500).json({ ok: false, error: msg });
  }
});

export default router;
