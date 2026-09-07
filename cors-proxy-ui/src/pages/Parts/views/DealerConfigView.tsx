import React, { useEffect, useState } from "react";
import { PartsPlaceholderView } from "../components/PartsPlaceholderView";
import { idbGetAllBlueprints } from "../../../utils/blueprintDb";
import { getStores } from "../../../services/storesDb";
import { loadLatestExtensionCapture } from "../../../services/extensionBridge";
import OEM_MAKE_DATA from "../../../terminology/OEM_MAKE_DATA.json";

// ============================================================================
// CORE ENGINE: THE 5-LAYER PIPELINE FOR BLUEPRINT DATA
// Extracts strict OEM Makes and Dealer Codes from messy, conversational text
// ============================================================================

interface ParsedMakesResult {
  originalInput: string;
  extractedMakes: string[];
  groupedOems: Record<string, string[]>;
  unknownMakes: string[];
}

function parseMessyMakes(rawInput: string, oemMapping: Record<string, string[]>): ParsedMakesResult {
  if (!rawInput || rawInput.trim() === "") {
    return { originalInput: rawInput, extractedMakes: [], groupedOems: {}, unknownMakes: [] };
  }

  // LAYER 1: Sanitization
  let processed = rawInput.toLowerCase().trim();
  const noiseWords = [
    "we sell", "franchises", "brands:", "makes:", "only",
    "all models", "factory master", "dealership", "vehicles"
  ];
  noiseWords.forEach(word => {
    processed = processed.replace(new RegExp(`\\b${word}\\b`, 'gi'), "");
  });

  // LAYER 2: Text-to-Array Preprocessor
  const aliasMap: Record<string, string> = {
    "vw": "volkswagen",
    "chevy": "chevrolet",
    "alfa romeo": "alfaromeo",
    "alfa": "alfaromeo",
    "aston martin": "astonmartin",
    "land rover": "landrover",
    "mercedes benz": "mercedesbenz",
    "mercedes": "mercedesbenz",
    "rolls royce": "rollsroyce"
  };
  for (const [alias, standard] of Object.entries(aliasMap)) {
    processed = processed.replace(new RegExp(`\\b${alias}\\b`, 'gi'), standard);
  }

  // Standardize delimiters: Convert /, ;, |, &, \n, and "and" into commas
  processed = processed.replace(/[/;|&\n]/g, ",");
  processed = processed.replace(/\b(and|or)\b/gi, ",");

  // LAYER 3: Cleaning & Extraction
  const rawTokens = processed
    .split(",")
    .map(token => token.replace(/\s+/g, ""))
    .filter(token => token.length > 0);
  const uniqueMakes = Array.from(new Set(rawTokens));

  // LAYER 4: Validation against Global Engine (API Dictionary)
  const groupedOems: Record<string, string[]> = {};
  const validMakes: string[] = [];
  const unknownMakes: string[] = [];

  uniqueMakes.forEach(make => {
    let foundOem = "others";
    let isValid = false;

    for (const [oemKey, oemValues] of Object.entries(oemMapping)) {
      if (oemValues.map(v => v.toLowerCase()).includes(make)) {
        foundOem = oemKey;
        isValid = true;
        break;
      }
    }

    if (!groupedOems[foundOem]) groupedOems[foundOem] = [];
    groupedOems[foundOem].push(make);

    if (isValid) validMakes.push(make);
    else unknownMakes.push(make);
  });

  // LAYER 5: Structuring & Fallbacks
  return {
    originalInput: rawInput,
    extractedMakes: uniqueMakes,
    groupedOems,
    unknownMakes
  };
}

function parseMessyDealerCode(rawInput: string): string {
  if (!rawInput) return "";
  let processed = rawInput.toLowerCase().trim();
  processed = processed.replace(/\b(code|id|number|dealer|my|is)\b/gi, "");
  processed = processed.replace(/[^a-z0-9\-]/gi, ""); // Remove special characters except hyphens
  return processed.trim();
}

// ============================================================================
// HELPER: Fuzzy Blueprint Search
// ============================================================================
const findAnswerInBlueprint = (data: any, questionTextToMatch: string): string | null => {
  let answer: string | null = null;
  const normalizedMatchText = questionTextToMatch.toLowerCase().replace(/\s+/g, " ").trim();

  const search = (obj: any) => {
    if (!obj || typeof obj !== "object") return;
    const hasMatchingQuestion = Object.values(obj).some(val => {
      if (typeof val === "string") {
        return val.toLowerCase().replace(/\s+/g, " ").trim().includes(normalizedMatchText);
      }
      return false;
    });

    if (hasMatchingQuestion) {
      const extracted = obj.answer || obj.value || obj.Answer || obj.Value || obj.response;
      if (typeof extracted === "string" && extracted.trim() !== "") {
        answer = extracted;
        return;
      }
      if (Array.isArray(extracted) && extracted.length > 0) {
        answer = extracted.join(",");
        return;
      }
    }

    for (const key of Object.keys(obj)) {
      if (answer) break;
      search(obj[key]);
    }
  };
  search(data);
  return answer;
};

// Helper for exact array validation
const arraysHaveSameElements = (arr1: string[], arr2: string[]) => {
  if (!Array.isArray(arr1) || !Array.isArray(arr2)) return false;
  if (arr1.length !== arr2.length) return false;
  const sorted1 = [...arr1].sort();
  const sorted2 = [...arr2].sort();
  return sorted1.every((val, index) => val === sorted2[index]);
};

// ============================================================================
// COMPONENT
// ============================================================================
export const DealerConfigView: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [statusColor, setStatusColor] = useState("#000");

  useEffect(() => {
    console.log("[Parts][DealerConfigView] mounted");
    return () => console.log("[Parts][DealerConfigView] unmounted");
  }, []);

  const updateStatus = (msg: string, color: string = "#000") => {
    setStatusMessage(msg);
    setStatusColor(color);
  };

  const handleOemDetailsClick = async () => {
    setIsLoading(true);
    updateStatus("Resolving active profile...", "blue");

    // TODO: Centralize auth tokens and headers as needed
    const globalHeaders = { "Content-Type": "application/json" };

    try {
      // 1. Get the Selected Profile ID from Settings (localStorage)
      const SELECTED_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";
      const profileId = localStorage.getItem(SELECTED_PROFILE_KEY);

      if (!profileId) {
        throw new Error("No active profile selected. Please select a Dealer Profile in Settings first.");
      }

      // 2. Cross-reference with the extension bridge to get the actual Dealer ID
      const latestCapture = loadLatestExtensionCapture();
      const activeProfile = latestCapture?.tekionProfiles?.find((p: any) => p.id === profileId);

      if (!activeProfile || !activeProfile.dealerId) {
        throw new Error("Could not resolve Dealer ID from the selected profile. The profile may have expired.");
      }

      const headerDealerId = activeProfile.dealerId;
      console.log(`[Parts] Selected Profile Resolved -> Dealer ID: ${headerDealerId}`);

      // 3. Query storesDb to fetch the correct tekion_id (Tenant)
      const stores = await getStores();
      if (!stores || stores.length === 0) throw new Error("No store data found in indexedDB.");

      const activeStore = stores.find(s => s.dealer_id === headerDealerId) || stores[0];
      if (!activeStore) throw new Error(`No store record found matching dealer ID: ${headerDealerId}`);

      // We extract the Tenant (tekion_id) to use ONLY for the API URL later
      const tenantName = activeStore.tekion_id;
      const dealerId = activeStore.dealer_id;

      console.log(`[Parts] Mapping: Dealer ${dealerId} belongs to Tenant ${tenantName}`);
      updateStatus("Fetching OEM mappings...", "blue");

      // 4. Fetch OEM mappings
      let oemMapping: Record<string, string[]> = OEM_MAKE_DATA;
      try {
        const mapRes = await fetch("https://preprodapp.tekioncloud.com/api/global-settings/u/v1/entity/oem-makes-mapping", { headers: globalHeaders });
        if (mapRes.ok) {
          const mapData = await mapRes.json();
          if (mapData?.data) oemMapping = mapData.data;
        }
      } catch (e) {
        console.warn("Could not fetch live OEM mappings, using local JSON fallback");
      }

      updateStatus("Finding Blueprint data...", "blue");

      // 5. Find the Blueprint using the Dealer ID in the key
      const blueprints = await idbGetAllBlueprints();
      const targetKey = `${dealerId}-Blueprint_-_Conquest_-_Parts`; // e.g. "90005191-Blueprint_-_Conquest_-_Parts"

      let partsBlueprint =
        blueprints.find(bp => bp.key === targetKey) ||
        blueprints.find(bp => bp.key.includes(dealerId) && bp.key.toLowerCase().includes("parts")) ||
        blueprints.find(bp => bp.dealerId === dealerId && bp.key.toLowerCase().includes("parts")) ||
        blueprints.find(bp => bp.key.toLowerCase().includes("parts")); // Ultimate fallback

      if (!partsBlueprint) {
        console.error("Available blueprints in IDB:", blueprints.map(b => ({
          key: b.key,
          dealerId: b.dealerId,
          tekionId: b.tekionId
        })));
        throw new Error(`No parts blueprint found in the database for Dealer ID: ${dealerId}`);
      }

      console.log("[Parts][DealerConfigView] Successfully targeted blueprint:", partsBlueprint.key);

      const dataToSearch = partsBlueprint.decodedResponse || partsBlueprint.data || partsBlueprint.rawResponse;

      // 6. Extract raw answers
      const rawMakes = findAnswerInBlueprint(dataToSearch, "list all makes for which you run a factory master");
      const rawDealerCode = findAnswerInBlueprint(dataToSearch, "Dealer code(s) (OEM ID#)");

      if (!rawMakes || !rawDealerCode) throw new Error("Could not locate the required questions in the blueprint.");

      // 7. Parse messy blueprint data through the 5-Layer Pipeline
      const parsedMakesData = parseMessyMakes(rawMakes, oemMapping);
      const cleanDealerCode = parseMessyDealerCode(rawDealerCode);

      if (parsedMakesData.unknownMakes.length > 0) {
        console.warn("Unrecognized makes detected by Layer 4:", parsedMakesData.unknownMakes);
      }

      // 8. Build New Payload Models
      const newOemDetails = Object.entries(parsedMakesData.groupedOems).map(([oem, makes]) => ({
        oem: oem,
        makeId: makes,
        makeDetails: makes.map(make => ({
          make: make,
          makeId: make,
          displayName: make,
          dealerCode: "",
          makeLogoUrl: null,
          makeLogoUrlMediaId: null
        })),
        make: makes
      }));

      const newDealerCodeWithMake = parsedMakesData.extractedMakes.map(make => ({
        make: make,
        dealerCode: cleanDealerCode
      }));

      updateStatus("Checking existing Dealer Master configuration...", "blue");

      // 9. GET current Dealer Master & Validate Idempotency
      // Note: We strictly use tenantName and dealerId for the API URL here!
      const dealerMasterUrl = `https://preprodapp.tekioncloud.com/api/api-core/u/tenant/${tenantName}/dealer-master/${dealerId}`;
      const masterRes = await fetch(dealerMasterUrl, { method: "GET", headers: globalHeaders });

      let existingDealerMaster: any = {};
      if (masterRes.ok) {
        const masterJson = await masterRes.json();
        existingDealerMaster = masterJson.data || masterJson || {};
      }

      const existingOems = existingDealerMaster.oemDetails || [];
      const existingCodes = existingDealerMaster.dealerCodeWithMake || [];

      // Validate exactly
      const isDealerCodeMatching = newDealerCodeWithMake.length > 0 &&
        newDealerCodeWithMake.length === existingCodes.length &&
        newDealerCodeWithMake.every(newCode =>
          existingCodes.some((extCode: any) => extCode.make === newCode.make && extCode.dealerCode === newCode.dealerCode)
        );

      const isOemsMatching = newOemDetails.length > 0 &&
        newOemDetails.length === existingOems.length &&
        newOemDetails.every(newOem =>
          existingOems.some((extOem: any) =>
            extOem.oem === newOem.oem && arraysHaveSameElements(newOem.makeId, extOem.makeId)
          )
        );

      if (isDealerCodeMatching && isOemsMatching) {
        updateStatus("Data is already up-to-date and validated successfully! No update required.", "green");
        setIsLoading(false);
        return;
      }

      // 10. PUT merged data back to the server
      updateStatus("Updating Dealer Master configuration...", "blue");
      const finalPayload = {
        ...existingDealerMaster,
        oemDetails: newOemDetails,
        dealerCodeWithMake: newDealerCodeWithMake
      };

      const putResponse = await fetch(dealerMasterUrl, {
        method: "PUT", headers: globalHeaders, body: JSON.stringify(finalPayload)
      });

      if (!putResponse.ok) throw new Error(`API request failed with status: ${putResponse.status}`);
      updateStatus("Successfully updated Dealer Master OEM details!", "green");

    } catch (error: any) {
      console.error("[Parts][DealerConfigView] Error:", error);
      updateStatus(`Error: ${error.message}`, "red");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      <PartsPlaceholderView
        title="Dealer config"
        description="Blank UI for now. Later this section can contain Dealer Config related actions."
      />

      <div style={{ padding: "0 24px" }}>
        <button
          onClick={handleOemDetailsClick}
          disabled={isLoading}
          style={{
            padding: "8px 16px",
            backgroundColor: isLoading ? "#ccc" : "#007bff",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: isLoading ? "not-allowed" : "pointer",
            fontWeight: "bold"
          }}
        >
          {isLoading ? "Processing..." : "Sync OEM Details"}
        </button>

        {statusMessage && (
          <div style={{
            marginTop: "16px",
            padding: "12px 16px",
            backgroundColor: statusColor === "red" ? "#fee2e2" : statusColor === "green" ? "#dcfce7" : "#eff6ff",
            border: `1px solid ${statusColor === "red" ? "#fca5a5" : statusColor === "green" ? "#86efac" : "#bfdbfe"}`,
            color: statusColor === "red" ? "#991b1b" : statusColor === "green" ? "#166534" : "#1e40af",
            borderRadius: "6px",
            fontWeight: "500",
            fontSize: "14px"
          }}>
            {statusMessage}
          </div>
        )}
      </div>
    </div>
  );
};