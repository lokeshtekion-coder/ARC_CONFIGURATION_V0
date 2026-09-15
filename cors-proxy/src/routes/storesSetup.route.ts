import { Router, Request, Response } from "express";
import axios from "axios";

const router = Router();

type HeaderMap = Record<string, string>;

interface SetupSummary {
  oemDealerCodes: string[];
  journalsAccessibleDealerCount: number;
  salesChainsAccessibleDealerCount: number;
  coaAccessibleDealerCount: number;
  sourceUsername: string;
  siteId: string;
  userId: string;
  fetchedAt: string;
}

interface DealerPropertiesRecord {
  SUPER_ADMIN_USERNAME?: string;
  SYSTEM_ADMIN_USERNAME?: string;
  tenant?: string;
  dealerid?: string;
  env?: string;
}

function log(step: string, message: string, meta?: unknown) {
  if (meta !== undefined) {
    console.log(`[storesSetup] [${step}] ${message}`, meta);
  } else {
    console.log(`[storesSetup] [${step}] ${message}`);
  }
}

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}${"*".repeat(Math.max(4, value.length - 8))}${value.slice(-4)}`;
}

function maskEmail(email: string): string {
  const trimmed = normalize(email);
  const at = trimmed.indexOf("@");
  if (at <= 1) return maskValue(trimmed);
  return `${trimmed.slice(0, 2)}***${trimmed.slice(at - 1)}`;
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

function maskHeaders(headers: HeaderMap): HeaderMap {
  const out: HeaderMap = {};
  for (const [k, v] of Object.entries(headers)) {
    const lower = k.toLowerCase();
    if (
      lower.includes("authorization") ||
      lower.includes("token") ||
      lower.includes("cookie") ||
      lower.includes("api-key") ||
      lower.includes("password")
    ) {
      out[k] = maskValue(v);
    } else {
      out[k] = v;
    }
  }
  return out;
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

function countUnknown(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>).length;
  if (value === null || value === undefined) return 0;
  return 1;
}

function countDealerScopedAssets(section: unknown, dealerId: string): number {
  const obj = getObject(section);

  const accessibleAssetMap = getObject(obj.accessibleAssetMap);
  const dealerAssetDocMap = getObject(obj.dealerAssetDocMap);
  const masterAssetDocMap = getObject(obj.masterAssetDocMap);

  if (dealerId in accessibleAssetMap) {
    return countUnknown(accessibleAssetMap[dealerId]);
  }

  if (dealerId in dealerAssetDocMap) {
    return countUnknown(dealerAssetDocMap[dealerId]);
  }

  if (dealerId in masterAssetDocMap) {
    return countUnknown(masterAssetDocMap[dealerId]);
  }

  if (Object.keys(masterAssetDocMap).length > 0) {
    return Object.keys(masterAssetDocMap).length;
  }

  return 0;
}

async function postJson<T = unknown>(
  step: string,
  url: string,
  body: unknown,
  headers: HeaderMap
): Promise<T> {
  log(step, "POST request starting", {
    url,
    maskedHeaders: maskHeaders(headers),
    bodyPreview: body,
  });

  const res = await axios.post(url, body, {
    headers,
    timeout: 60000,
    validateStatus: () => true,
  });

  log(step, "POST response received", {
    url,
    status: res.status,
    statusText: res.statusText,
    bodyKeys:
      res.data && typeof res.data === "object" && !Array.isArray(res.data)
        ? Object.keys(res.data)
        : [],
  });

  if (res.status >= 400) {
    throw new Error(`${step} failed with ${res.status}: ${JSON.stringify(res.data).slice(0, 700)}`);
  }

  return res.data as T;
}

async function getJson<T = unknown>(
  step: string,
  url: string,
  headers: HeaderMap
): Promise<T> {
  log(step, "GET request starting", {
    url,
    maskedHeaders: maskHeaders(headers),
  });

  const res = await axios.get(url, {
    headers,
    timeout: 60000,
    validateStatus: () => true,
  });

  log(step, "GET response received", {
    url,
    status: res.status,
    statusText: res.statusText,
    bodyKeys:
      res.data && typeof res.data === "object" && !Array.isArray(res.data)
        ? Object.keys(res.data)
        : [],
  });

  if (res.status >= 400) {
    throw new Error(`${step} failed with ${res.status}: ${JSON.stringify(res.data).slice(0, 700)}`);
  }

  return res.data as T;
}

router.post("/", async (req: Request, res: Response) => {
  try {
    const dealerId = normalize(req.body?.dealerId);
    const tenant = normalize(req.body?.tenant);
    const env = normalize(req.body?.env || "preprod");

    log("INPUT", "Incoming setup request", { dealerId, tenant, env });

    if (!dealerId) return res.status(400).json({ ok: false, error: "dealerId is required" });
    if (!tenant) return res.status(400).json({ ok: false, error: "tenant is required" });

    const loginUrl = readRequiredEnv("CQA_LOGIN_URL");
    const loginApiKey = readRequiredEnv("CQA_LOGIN_API_KEY");
    const loginUsername = readRequiredEnv("CQA_LOGIN_USERNAME");
    const loginPassword = readRequiredEnv("CQA_LOGIN_PASSWORD");
    const dealerPropertiesUrl = readRequiredEnv("CQA_DEALER_PROPERTIES_URL");
    const dealerPropertiesApiKey = readRequiredEnv("CQA_DEALER_PROPERTIES_API_KEY");
    const generateTokenUrlBase = readRequiredEnv("CQA_GENERATE_TOKEN_URL_BASE");
    const generateTokenApiKey = readRequiredEnv("CQA_GENERATE_TOKEN_API_KEY");

    log("ENV", "Loaded env config", {
      loginUrl,
      loginApiKey: maskValue(loginApiKey),
      loginUsername: maskEmail(loginUsername),
      loginPassword: maskValue(loginPassword),
      dealerPropertiesUrl,
      dealerPropertiesApiKey: maskValue(dealerPropertiesApiKey),
      generateTokenUrlBase,
      generateTokenApiKey: maskValue(generateTokenApiKey),
    });

    const loginResponse = await postJson<{ result?: { token?: string; username?: string } }>(
      "API1_LOGIN",
      loginUrl,
      {
        username: loginUsername,
        password: loginPassword,
      },
      {
        "x-api-key": loginApiKey,
        "Content-Type": "application/json",
      }
    );

    const cqaToken = normalize(loginResponse?.result?.token);
    if (!cqaToken) throw new Error("CQA login token missing from API 1 response");

    log("API1_LOGIN", "Success", {
      username: maskEmail(normalize(loginResponse?.result?.username || loginUsername)),
      tokenMasked: maskValue(cqaToken),
    });

    const dealerPropertiesResponse = await postJson<{ properties?: DealerPropertiesRecord[] }>(
      "API2_DEALER_PROPERTIES",
      dealerPropertiesUrl,
      {
        dealerid: dealerId,
        env,
        tenant,
      },
      {
        "x-api-key": dealerPropertiesApiKey,
        authorization: `Bearer ${cqaToken}`,
        "Content-Type": "application/json",
      }
    );

    const property = dealerPropertiesResponse?.properties?.[0];
    if (!property) throw new Error(`No dealer properties returned for dealer ${dealerId}`);

    const sourceUsername =
      normalize(property.SUPER_ADMIN_USERNAME) ||
      normalize(property.SYSTEM_ADMIN_USERNAME);

    if (!sourceUsername) {
      throw new Error(`SUPER_ADMIN_USERNAME / SYSTEM_ADMIN_USERNAME missing for dealer ${dealerId}`);
    }

    log("API2_DEALER_PROPERTIES", "Success", {
      propertyCount: dealerPropertiesResponse?.properties?.length ?? 0,
      sourceUsername: maskEmail(sourceUsername),
    });

    const generateTokenResponse = await getJson(
      "API3_GENERATE_TOKEN",
      `${generateTokenUrlBase}?emailId=${encodeURIComponent(sourceUsername)}`,
      {
        authorization: `Bearer ${cqaToken}`,
        "x-api-key": generateTokenApiKey,
        "content-type": "application/json",
      }
    );

    const api3Root = resolveApi3DataRoot(generateTokenResponse);
    const loginData = resolveApi3LoginData(generateTokenResponse);
    const tekionApiToken = resolveTekionAccessToken(generateTokenResponse);
    const userId = resolveApi3UserId(generateTokenResponse);

    log("API3_GENERATE_TOKEN", "Parsed response", {
      topLevelKeys: Object.keys(getObject(generateTokenResponse)),
      dataRootKeys: Object.keys(api3Root),
      loginDataKeys: Object.keys(loginData).slice(0, 20),
      hasAccessTokenAtDataRoot: Boolean(pickFirstNonEmpty(api3Root.access_token, api3Root.accessToken)),
      hasAccessTokenAtLoginData: Boolean(pickFirstNonEmpty(getObject(loginData).access_token, getObject(loginData).accessToken)),
      resolvedUserId: maskValue(userId),
    });

    if (!tekionApiToken) {
      throw new Error("Tekion access token missing from API 3 response");
    }

    const siteId = extractSiteId(loginData, dealerId);

    log("API3_GENERATE_TOKEN", "Success", {
      emailId: maskEmail(sourceUsername),
      tokenMasked: maskValue(tekionApiToken),
      userId: maskValue(userId),
      siteId,
    });

    const commonHeaders: HeaderMap = {
      clientid: "web",
      roleid: `${dealerId}_ISM_Admin`,
      dealerid: dealerId,
      "tekion-api-token": tekionApiToken,
      tenantname: tenant,
      "content-type": "application/json;charset=utf-8",
      program: "DEFAULT",
      "tek-siteid": siteId,
      userid: userId,
      accept: "application/json",
    };

    const dealerMasterResponse = await getJson<Record<string, unknown>>(
      "API4_DEALER_MASTER",
      "https://preprodapp.tekioncloud.com/api/api-core/u/dealer-master",
      commonHeaders
    );

    const dealerMasterData = getObject(dealerMasterResponse?.data);

    log("API4_DEALER_MASTER", "Success", {
      dealerName: dealerMasterData.dealerName,
      oemDealerCodesType: Array.isArray(dealerMasterData.oemDealerCodes)
        ? "array"
        : typeof dealerMasterData.oemDealerCodes,
    });

    const bootstrapBody = {
      requestInfo: [
        {
          assetType: "allAccounts",
          dealerMetaDataInfo: [{ dealerId }],
        },
        {
          assetType: "allJournals",
          dealerMetaDataInfo: [{ dealerId }],
        },
        {
          assetType: "salesChains",
          dealerMetaDataInfo: [{ dealerId }],
        },
      ],
    };

    const bootstrapResponse = await postJson<Record<string, unknown>>(
      "API4_1_BOOTSTRAP",
      "https://preprodapp.tekioncloud.com/api/accounting/u/configurable/bootstrap",
      bootstrapBody,
      {
        ...commonHeaders,
        "Content-Type": "application/json",
      }
    );

    const bootstrapData = getObject(bootstrapResponse?.data);
    const allJournals = getObject(bootstrapData.allJournals);
    const salesChains = getObject(bootstrapData.salesChains);
    const allAccounts = getObject(bootstrapData.allAccounts);

    const rawOemDealerCodes = dealerMasterData.oemDealerCodes;
    const oemDealerCodes = Array.isArray(rawOemDealerCodes)
      ? rawOemDealerCodes.map((x) => normalize(x)).filter(Boolean)
      : rawOemDealerCodes
        ? [normalize(rawOemDealerCodes)].filter(Boolean)
        : [];

    const summary: SetupSummary = {
      oemDealerCodes,
      journalsAccessibleDealerCount: countDealerScopedAssets(allJournals, dealerId),
      salesChainsAccessibleDealerCount: countDealerScopedAssets(salesChains, dealerId),
      coaAccessibleDealerCount: countDealerScopedAssets(allAccounts, dealerId),
      sourceUsername,
      siteId,
      userId,
      fetchedAt: new Date().toISOString(),
    };

    log("API4_1_BOOTSTRAP", "Success", {
      bootstrapKeys: Object.keys(bootstrapData),
      allJournalsKeys: Object.keys(allJournals),
      salesChainsKeys: Object.keys(salesChains),
      allAccountsKeys: Object.keys(allAccounts),
      journalsAccessibleDealerCount: summary.journalsAccessibleDealerCount,
      salesChainsAccessibleDealerCount: summary.salesChainsAccessibleDealerCount,
      coaAccessibleDealerCount: summary.coaAccessibleDealerCount,
    });

    return res.json({
      ok: true,
      dealerId,
      tenant,
      env,
      setupData: summary,
    });
  } catch (error: unknown) {
    log("ERROR", "Setup route failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Failed to fetch setup data",
    });
  }
});

export default router;
