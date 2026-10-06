export interface PreprodTenant {
  tenant_name: string;
  last_update_date: string;
  display_name: string;
  id: string;
}

export interface PreprodDealerRecord {
  _id: string;
  tenant_id: number;
  dealer_id: string;
  dealership_code: string;
  product_type: string;
  tenant_name: string;
  employee_count?: string;
  dealer_display_name?: string;
  [key: string]: unknown;
}

export interface SiteRecord {
  name: string;
  id: string;
}

export interface PreprodValidationResult {
  isValidTenant: boolean;
  validationError?: string;
  tenantId?: string;
  tenantName?: string;
  employeeCount?: number | string;
  accountNumberCount?: number;
  fetchedAt: string;
}

const STORAGE_KEY_MAP_HEADERS = "preprodMapCapturedHeaders";

export function storeCapturedMapHeaders(headers: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY_MAP_HEADERS, JSON.stringify(headers));
  } catch {}
}

export function getCapturedMapHeaders(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_MAP_HEADERS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Build standardized headers using the captured headers from the extension
function buildRequestHeaders(): HeadersInit {
  const captured = getCapturedMapHeaders();
  return {
    "accept": "*/*",
    "content-type": "application/json",
    ...(captured["authorization"] ? { "authorization": captured["authorization"] } : {}),
    ...(captured["x-tekion-user"] ? { "x-tekion-user": captured["x-tekion-user"] } : {}),
    ...(captured["origin"] ? { "origin": captured["origin"] } : { "origin": "https://preprod-map.tekioncloud.com" }),
  };
}

/**
 * Executes the complete 4-step pipeline:
 * 1. Validate tenant_name against /dealer_list/tenants/fetch
 * 2. POST /dealer_list/fetch/tenantname/{tenant_name} with { id }
 * 3. POST /tkmodels/v1/api/dealersettings/sites/fetch
 * 4. POST /modeldataconfig/.../acct_dms_account_number/arc_records/count/fetch
 */
export async function executePreprodMapPipeline(
  storeTenantCandidate: string,
  preferredDealerId?: string
): Promise<PreprodValidationResult> {
  const headers = buildRequestHeaders();
  const cleanedTarget = (storeTenantCandidate || "").trim().toLowerCase();

  if (!cleanedTarget) {
    return {
      isValidTenant: false,
      validationError: "Store has no tenant code/name configured.",
      fetchedAt: new Date().toISOString(),
    };
  }

  // --- STEP 1: Fetch and Validate Tenants ---
  const step1Url = "https://preprod-apps-api.tekioncloud.xyz/tenantadmin/v1/api/dealer_list/tenants/fetch";
  const step1Res = await fetch(step1Url, {
    method: "GET",
    headers,
  });

  if (!step1Res.ok) {
    throw new Error(`Step 1 (Tenant List) failed with HTTP ${step1Res.status}`);
  }

  const tenantsList: PreprodTenant[] = await step1Res.json();
  const matchedTenant = tenantsList.find(
    (t) =>
      t.tenant_name?.toLowerCase() === cleanedTarget ||
      t.display_name?.toLowerCase() === cleanedTarget ||
      t.id?.toLowerCase().startsWith(cleanedTarget)
  );

  if (!matchedTenant) {
    return {
      isValidTenant: false,
      validationError: `Validation failed: Tenant "${storeTenantCandidate}" not found in Pre-Prod tenant directory.`,
      fetchedAt: new Date().toISOString(),
    };
  }

  const tenantName = matchedTenant.tenant_name;
  const tenantIdValue = matchedTenant.id;

  // --- STEP 2: Fetch Dealer List by tenant name ---
  const step2Url = `https://preprod-apps-api.tekioncloud.xyz/tenantadmin/v1/api/dealer_list/fetch/tenantname/${encodeURIComponent(tenantName)}`;
  const step2Res = await fetch(step2Url, {
    method: "POST",
    headers,
    body: JSON.stringify({ id: tenantIdValue }),
  });

  if (!step2Res.ok) {
    throw new Error(`Step 2 (Dealer Records) failed with HTTP ${step2Res.status}`);
  }

  const dealerRecords: PreprodDealerRecord[] = await step2Res.json();
  if (!Array.isArray(dealerRecords) || dealerRecords.length === 0) {
    return {
      isValidTenant: true,
      tenantId: tenantIdValue,
      tenantName,
      validationError: "Tenant valid, but no dealer records returned.",
      fetchedAt: new Date().toISOString(),
    };
  }

  // Select ARC record or preferred dealer record
  const arcRecord =
    dealerRecords.find((d) => (preferredDealerId ? d.dealer_id === preferredDealerId : true) && d.product_type === "ARC") ||
    dealerRecords.find((d) => d.product_type === "ARC") ||
    dealerRecords[0];

  const employeeCount = arcRecord.employee_count ?? "—";
  const dealerId = arcRecord.dealer_id;
  const dealershipCode = arcRecord.dealership_code;

  // --- STEP 3: Fetch Sites ---
  const step3Url = "https://preprod-apps-api.tekioncloud.xyz/tkmodels/v1/api/dealersettings/sites/fetch";
  const step3Res = await fetch(step3Url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      tenant_name: tenantName,
      dealer_id: dealerId,
      dealership_code: dealershipCode,
      product_type: "ARC",
    }),
  });

  if (!step3Res.ok) {
    return {
      isValidTenant: true,
      tenantId: tenantIdValue,
      tenantName,
      employeeCount,
      validationError: `Step 3 (Sites fetch) returned HTTP ${step3Res.status}`,
      fetchedAt: new Date().toISOString(),
    };
  }

  const sites: SiteRecord[] = await step3Res.json();
  const siteId = Array.isArray(sites) && sites.length > 0 ? sites[0].id : "-1";

  // --- STEP 4: Fetch acct_dms_account_number count ---
  const step4Url = "https://preprod-apps-api.tekioncloud.xyz/modeldataconfig/v1/api/module_mapper/acct_dms_account_number/arc_records/count/fetch";
  const step4Res = await fetch(step4Url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      tenant_name: tenantName,
      dealer_id: dealerId,
      site_id: siteId,
    }),
  });

  let accountNumberCount: number | undefined;
  if (step4Res.ok) {
    const step4Data = await step4Res.json();
    if (step4Data?.message?.Count !== undefined) {
      accountNumberCount = Number(step4Data.message.Count);
    }
  }

  return {
    isValidTenant: true,
    tenantId: tenantIdValue,
    tenantName,
    employeeCount,
    accountNumberCount,
    fetchedAt: new Date().toISOString(),
  };
}