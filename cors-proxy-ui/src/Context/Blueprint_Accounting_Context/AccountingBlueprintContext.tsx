import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from "react";
import { getStores, type StoreRecord } from "../../services/storesDb";
import {
  idbGetBlueprint,
  idbGetAllBlueprints,
  type BlueprintRecord,
} from "../../utils/blueprintDb";
import type {
  RunDecoderResult,
  FlattenedDecodedRow,
} from "../../utils/blueprintFormDecoder";

export interface MediaPayload {
  mediaId: string;
  filename?: string;
  url: string;
  mimeType?: string;
  mediaSize?: number;
  [key: string]: unknown;
}

export function buildTekionMediaUrl(media: MediaPayload): string {
  const BUCKET_PREFIX = "com-tekioncloud-tap-dealeronboarding/";
  const BASE_URL = "https://tap.tekioncloud.com/dealer-onboarding/forms/pdf?";

  const rawPath = media.url.startsWith(BUCKET_PREFIX)
    ? media.url.slice(BUCKET_PREFIX.length)
    : media.url;

  return `${BASE_URL}${encodeURI(rawPath)}`;
}

export function parseMedia(val: unknown): MediaPayload | null {
  if (typeof val === "object" && val !== null && "mediaId" in val && "url" in val) {
    return val as MediaPayload;
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith("{") && trimmed.includes('"mediaId"') && trimmed.includes('"url"')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && "mediaId" in parsed && "url" in parsed) {
          return parsed as MediaPayload;
        }
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface AccountingBlueprintContextType {
  selectedDealerId: string;
  tekionId: string | null;
  matchedStore: StoreRecord | null;
  rawRecord: BlueprintRecord | null;
  blueprint: RunDecoderResult | null;
  loading: boolean;
  hasBlueprint: boolean;
  error: string | null;
  /** Lookup decoded answer value by question title or fieldId */
  getAnswer: (query: string) => unknown;
  /** Returns the complete decoded row object */
  getFieldRow: (query: string) => FlattenedDecodedRow | undefined;
  /** Returns formatted Tekion PDF viewer link if field has uploaded media */
  getAttachmentUrl: (query: string) => string | null;
  /** Re-reads stores and IndexedDB on demand */
  refresh: () => Promise<void>;
}

const AccountingBlueprintContext = createContext<AccountingBlueprintContextType>({
  selectedDealerId: "",
  tekionId: null,
  matchedStore: null,
  rawRecord: null,
  blueprint: null,
  loading: false,
  hasBlueprint: false,
  error: null,
  getAnswer: () => undefined,
  getFieldRow: () => undefined,
  getAttachmentUrl: () => null,
  refresh: async () => {},
});

export const AccountingBlueprintProvider: React.FC<{
  dealerId: string;
  children: React.ReactNode;
}> = ({ dealerId, children }) => {
  const [loading, setLoading] = useState(false);
  const [tekionId, setTekionId] = useState<string | null>(null);
  const [matchedStore, setMatchedStore] = useState<StoreRecord | null>(null);
  const [rawRecord, setRawRecord] = useState<BlueprintRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const syncBlueprint = useCallback(async () => {
    const cleanDealerId = dealerId.trim();
    if (!cleanDealerId) {
      setTekionId(null);
      setMatchedStore(null);
      setRawRecord(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Resolve tekion_id using storesDb
      const stores = await getStores();
      const store = stores.find(
        (s) => s.dealer_id?.trim().toLowerCase() === cleanDealerId.toLowerCase()
      );

      if (!store || !store.tekion_id?.trim()) {
        setMatchedStore(null);
        setTekionId(null);
        setRawRecord(null);
        setError(`No store found in storesDb for Dealer ID "${cleanDealerId}".`);
        return;
      }

      const resolvedTekionId = store.tekion_id.trim();
      setMatchedStore(store);
      setTekionId(resolvedTekionId);

      // 2. Primary lookup: deterministic key
      const expectedKey = `${resolvedTekionId}-Blueprint_-_Conquest_-_Accounting`;
      let blueprint = await idbGetBlueprint(expectedKey);

      // 3. Fallback scan: case/title variations containing "accounting"
      if (!blueprint) {
        const all = await idbGetAllBlueprints();
        const matches = all.filter((rec) => {
          const isAccounting =
            (rec.formName ?? "").toLowerCase().includes("accounting") ||
            rec.key.toLowerCase().includes("accounting");

          if (!isAccounting) return false;

          const matchTekion =
            rec.tekionId?.trim() === resolvedTekionId ||
            rec.key.startsWith(resolvedTekionId);
          const matchDealer =
            rec.dealerId?.trim() === cleanDealerId ||
            rec.key.includes(cleanDealerId);

          return matchTekion || matchDealer;
        });

        if (matches.length > 0) {
          matches.sort(
            (a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
          );
          blueprint = matches[0];
        }
      }

      setRawRecord(blueprint ?? null);
    } catch (err: unknown) {
      console.error("[AccountingBlueprintContext] Resolution failed", err);
      setError(err instanceof Error ? err.message : String(err));
      setRawRecord(null);
    } finally {
      setLoading(false);
    }
  }, [dealerId]);

  useEffect(() => {
    void syncBlueprint();

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("blueprint_sync_channel");
      bc.onmessage = (ev) => {
        if (ev.data?.type === "BLUEPRINT_SAVED") {
          void syncBlueprint();
        }
      };
    } catch {
      // BroadcastChannel unavailable
    }

    return () => {
      bc?.close();
    };
  }, [syncBlueprint]);

  const blueprint = useMemo<RunDecoderResult | null>(() => {
    if (!rawRecord) return null;
    return (rawRecord.decodedResponse ?? rawRecord.data ?? null) as RunDecoderResult | null;
  }, [rawRecord]);

  const flatRows = useMemo(() => {
    return blueprint?.populatedFlatRows ?? blueprint?.allFields ?? [];
  }, [blueprint]);

  const getFieldRow = useCallback(
    (query: string): FlattenedDecodedRow | undefined => {
      const q = query.trim().toLowerCase();
      if (!q) return undefined;

      return flatRows.find((r) => {
        const idMatch = r.fieldId.toLowerCase() === q;
        const titleMatch = r.title?.toLowerCase() === q || r.title?.toLowerCase().includes(q);
        return idMatch || titleMatch;
      });
    },
    [flatRows]
  );

  const getAnswer = useCallback(
    (query: string): unknown => {
      const row = getFieldRow(query);
      return row?.decodedValue;
    },
    [getFieldRow]
  );

  const getAttachmentUrl = useCallback(
    (query: string): string | null => {
      const val = getAnswer(query);
      const media = parseMedia(val);
      return media ? buildTekionMediaUrl(media) : null;
    },
    [getAnswer]
  );

  return (
    <AccountingBlueprintContext.Provider
      value={{
        selectedDealerId: dealerId,
        tekionId,
        matchedStore,
        rawRecord,
        blueprint,
        loading,
        hasBlueprint: Boolean(blueprint),
        error,
        getAnswer,
        getFieldRow,
        getAttachmentUrl,
        refresh: syncBlueprint,
      }}
    >
      {children}
    </AccountingBlueprintContext.Provider>
  );
};

export const useAccountingBlueprint = () => useContext(AccountingBlueprintContext);