import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  loadTekionApiSettingsBundle,
  saveTekionApiSettings,
  saveGlobalHeaders,
  clearGlobalHeaders,
  clearTekionApiSettings,
  clearTekionApiSetting,
} from "../services/tekionApiSettings";
import {
  requestLatestCaptureFromExtension,
  subscribeToExtensionCapture,
  loadLatestExtensionCapture,
  ArcLatestCaptureState,
  ArcTekionProfile,
} from "../services/extensionBridge";
import { JwtDebugger } from "../components/JwtDebugger";
import { GlobalHeadersPanel } from "../components/GlobalHeadersPanel";
import { SelectableHeaderMap } from "../components/SelectableHeaderMap";
import type { KeyValuePair } from "../types/proxy.types";

// --- Logger Utility ---
const logger = {
  debug: (...args: any[]) => console.debug("[Settings]", ...args),
  info: (...args: any[]) => console.info("[Settings]", ...args),
  warn: (...args: any[]) => console.warn("[Settings]", ...args),
  error: (...args: any[]) => console.error("[Settings]", ...args),
};

const SELECTED_DEALER_PROFILE_KEY = "arc_selected_dealer_profile_id_v1";

interface Props {
  onBack: () => void;
}

type TokenAuthType = "header" | "bearer";
type MessageType = "success" | "warning" | "error";
type TokenFieldKey = "tapDuoApiToken" | "graphApiToken";

interface UiMessage {
  type: MessageType;
  text: string;
}

interface TokenFieldConfig {
  key: TokenFieldKey;
  icon: string;
  title: string;
  description: React.ReactNode;
  label: string;
  placeholder: string;
  rows?: number;
  authType: TokenAuthType;
  headerName?: string;
  extraPreviewLines?: string[];
  validate?: (value: string) => string | undefined;
}

interface CollapsibleSectionProps {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

const PAGE_STYLE: React.CSSProperties = {
  height: "100vh",
  overflowY: "auto",
  padding: "24px 16px 36px",
  boxSizing: "border-box",
};

const PAGE_INNER_STYLE: React.CSSProperties = {
  maxWidth: 1100,
  margin: "0 auto",
  display: "grid",
  gap: 16,
};

const PILL_STYLE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 10px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "#cbd5e1",
  fontSize: 12,
  lineHeight: 1.2,
};

const SECTION_CARD_STYLE: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.08)",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.02) 100%)",
  boxShadow: "0 10px 28px rgba(2, 6, 23, 0.18)",
  padding: 18,
};

const COMPACT_CARD_STYLE: React.CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.025)",
  padding: 14,
};

const STICKY_BAR_STYLE: React.CSSProperties = {
  position: "sticky",
  top: 10,
  zIndex: 30,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  padding: "12px 14px",
  borderRadius: 16,
  background: "rgba(15, 23, 42, 0.92)",
  border: "1px solid rgba(148, 163, 184, 0.18)",
  backdropFilter: "blur(10px)",
  boxShadow: "0 10px 26px rgba(0,0,0,0.16)",
};

const TOKEN_FIELDS: TokenFieldConfig[] = [
  {
    key: "tapDuoApiToken",
    icon: "🔑",
    title: "Tekion Stores API Token",
    label: "tap-duo-api-token",
    placeholder: "Paste tap-duo-api-token here",
    rows: 7,
    authType: "header",
    headerName: "tap-duo-api-token",
    description: (
      <>
        Paste the exact <code className="st-inline-code">tap-duo-api-token</code>. Used only for
        Tekion Stores API requests.
      </>
    ),
  },
  {
    key: "graphApiToken",
    icon: "☁️",
    title: "Microsoft Graph API Token",
    label: "GRAPH api token",
    placeholder: "Paste Microsoft Graph bearer token here",
    rows: 8,
    authType: "bearer",
    extraPreviewLines: [
      "Workbook: /T-90 Dealers GoLive - ARC.xlsx",
      "Sheets: month-wise like Jul 2026",
    ],
    validate: (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const parts = trimmed.split(".");
      const looksLikeJwt =
        parts.length === 3 && parts.every((part) => part.trim().length > 0);
      return looksLikeJwt
        ? undefined
        : "This token does not look like a JWT bearer token. Please verify the pasted value.";
    },
    description: (
      <>
        Paste a valid bearer token with <code className="st-inline-code">Files.ReadWrite</code>{" "}
        access.
      </>
    ),
  },
];

function buildEmptyTokens(): Record<TokenFieldKey, string> {
  return {
    tapDuoApiToken: "",
    graphApiToken: "",
  };
}

function buildHiddenMap(): Record<TokenFieldKey, boolean> {
  return {
    tapDuoApiToken: true,
    graphApiToken: true,
  };
}

function formatSavedAt(value?: string): string {
  if (!value) return "Not saved yet";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Not saved yet";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getHeaderPreviewValue(config: TokenFieldConfig): string {
  return config.authType === "bearer"
    ? "Authorization: Bearer {token}"
    : config.headerName || config.label;
}

function getMessageBoxStyle(type: MessageType): React.CSSProperties {
  if (type === "error") {
    return {
      color: "#fecaca",
      background: "rgba(239, 68, 68, 0.12)",
      border: "1px solid rgba(239, 68, 68, 0.22)",
      borderRadius: 14,
      padding: "10px 14px",
      fontSize: 13,
      fontWeight: 600,
    };
  }

  if (type === "warning") {
    return {
      color: "#fde68a",
      background: "rgba(245, 158, 11, 0.12)",
      border: "1px solid rgba(245, 158, 11, 0.22)",
      borderRadius: 14,
      padding: "10px 14px",
      fontSize: 13,
      fontWeight: 600,
    };
  }

  return {
    color: "#bbf7d0",
    background: "rgba(34, 197, 94, 0.12)",
    border: "1px solid rgba(34, 197, 94, 0.22)",
    borderRadius: 14,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 600,
  };
}

function toKeyValuePairs(headers: Record<string, string> | undefined): KeyValuePair[] {
  if (!headers) return [];
  return Object.entries(headers)
    .filter(([key, value]) => key.trim() && String(value).trim())
    .map(([key, value]) => ({
      key,
      value: String(value),
      enabled: true,
    }));
}

function arePairsEqual(a: KeyValuePair[], b: KeyValuePair[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function areTokenMapsEqual(
  a: Record<TokenFieldKey, string>,
  b: Record<TokenFieldKey, string>
): boolean {
  return (
    a.tapDuoApiToken === b.tapDuoApiToken &&
    a.graphApiToken === b.graphApiToken
  );
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  subtitle,
  defaultOpen = false,
  actions,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section style={SECTION_CARD_STYLE}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: open ? 14 : 0,
        }}
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          style={{
            border: "none",
            background: "transparent",
            color: "inherit",
            padding: 0,
            margin: 0,
            cursor: "pointer",
            textAlign: "left",
            flex: 1,
            minWidth: 220,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#f8fafc" }}>{title}</div>
            <div aria-hidden="true" style={{ color: "#94a3b8", fontSize: 14 }}>
              {open ? "▲" : "▼"}
            </div>
          </div>

          {subtitle ? (
            <div
              style={{
                color: "#94a3b8",
                fontSize: 13,
                lineHeight: 1.5,
                marginTop: 4,
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </button>

        {actions ? <div>{actions}</div> : null}
      </div>

      {open ? <div style={{ display: "grid", gap: 14 }}>{children}</div> : null}
    </section>
  );
};

interface SecretTextAreaProps {
  value: string;
  hidden: boolean;
  rows?: number;
  placeholder?: string;
  onChange: (value: string) => void;
}

const SecretTextArea: React.FC<SecretTextAreaProps> = ({
  value,
  hidden,
  rows = 7,
  placeholder,
  onChange,
}) => {
  return (
    <div style={{ position: "relative" }}>
      <textarea
        className="st-input"
        value={hidden ? "•".repeat(Math.max(value.length, 1)) : value}
        onChange={(e) => {
          if (!hidden) onChange(e.target.value);
        }}
        onFocus={(e) => {
          if (hidden) e.currentTarget.blur();
        }}
        placeholder={hidden ? "Hidden — click Show to reveal" : placeholder}
        rows={rows}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        data-lpignore="true"
        data-1p-ignore="true"
        style={{
          width: "100%",
          minHeight: Math.max(rows * 24, 150),
          resize: "vertical",
          padding: "14px 16px",
          borderRadius: 14,
          fontSize: 13,
          lineHeight: 1.5,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
        }}
        readOnly={hidden}
      />

      {hidden && value ? (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 14,
            background: "rgba(15, 23, 42, 0.18)",
            pointerEvents: "none",
          }}
        />
      ) : null}
    </div>
  );
};

interface TokenCardProps {
  config: TokenFieldConfig;
  value: string;
  warning?: string;
  savedAt?: string;
  hidden: boolean;
  onChange: (value: string) => void;
  onCopy: () => void;
  onClear: () => void;
  onToggleHidden: () => void;
}

const TokenCard: React.FC<TokenCardProps> = ({
  config,
  value,
  warning,
  savedAt,
  hidden,
  onChange,
  onCopy,
  onClear,
  onToggleHidden,
}) => {
  const [showJwt, setShowJwt] = useState(false);

  useEffect(() => {
    if (hidden && showJwt) {
      setShowJwt(false);
    }
  }, [hidden, showJwt]);

  return (
    <section style={SECTION_CARD_STYLE}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                display: "grid",
                placeItems: "center",
                background: "rgba(59, 130, 246, 0.14)",
                border: "1px solid rgba(59, 130, 246, 0.20)",
                fontSize: 16,
              }}
            >
              {config.icon}
            </div>

            <div>
              <div
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  color: "#f8fafc",
                  lineHeight: 1.2,
                }}
              >
                {config.title}
              </div>
              <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>
                {config.description}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn-secondary btn-sm" type="button" onClick={onToggleHidden}>
            {hidden ? "👁 Show" : "🙈 Hide"}
          </button>

          <button
            className="btn-secondary btn-sm"
            type="button"
            onClick={() => setShowJwt((prev) => !prev)}
            disabled={!value.trim() || hidden}
            title={hidden ? "Show token first to inspect JWT" : undefined}
          >
            {showJwt ? "🧾 Hide JWT" : "🧾 Show JWT"}
          </button>

          <button className="btn-secondary btn-sm" type="button" onClick={onCopy} disabled={!value.trim()}>
            📋 Copy
          </button>

          <button className="btn-cancel-bulk" type="button" onClick={onClear} disabled={!value.trim()}>
            🗑 Clear
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={PILL_STYLE}>
          <span style={{ color: "#94a3b8" }}>Field</span>
          <code className="st-req-url">{config.label}</code>
        </span>

        <span style={PILL_STYLE}>
          <span style={{ color: "#94a3b8" }}>Last saved</span>
          <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{formatSavedAt(savedAt)}</span>
        </span>
      </div>

      <SecretTextArea
        value={value}
        hidden={hidden}
        rows={config.rows ?? 7}
        placeholder={config.placeholder}
        onChange={onChange}
      />

      {warning ? (
        <div
          style={{
            marginTop: 10,
            color: "#fde68a",
            background: "rgba(245, 158, 11, 0.10)",
            border: "1px solid rgba(245, 158, 11, 0.22)",
            borderRadius: 12,
            padding: "10px 12px",
            fontSize: 13,
          }}
        >
          ⚠ {warning}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <span style={PILL_STYLE}>
          <span style={{ color: "#94a3b8" }}>Header</span>
          <code className="st-req-url">{getHeaderPreviewValue(config)}</code>
        </span>

        {(config.extraPreviewLines ?? []).map((line) => (
          <span key={line} style={PILL_STYLE}>
            {line}
          </span>
        ))}
      </div>

      {showJwt && !hidden ? (
        <div style={{ marginTop: 14 }}>
          <JwtDebugger title={`${config.title} JWT Debugger`} token={value} />
        </div>
      ) : null}
    </section>
  );
};

interface DealerProfileCardProps {
  profile: ArcTekionProfile;
  isSelected: boolean;
  onSelect: (profile: ArcTekionProfile) => void;
}

const DealerProfileCard: React.FC<DealerProfileCardProps> = ({
  profile,
  isSelected,
  onSelect,
}) => {
  const [showJwt, setShowJwt] = useState(false);
  const [tokenHidden, setTokenHidden] = useState(true);

  useEffect(() => {
    if (tokenHidden && showJwt) {
      setShowJwt(false);
    }
  }, [tokenHidden, showJwt]);

  const borderColor = isSelected
    ? "rgba(34, 197, 94, 0.55)"
    : "rgba(255,255,255,0.08)";
  const background = isSelected
    ? "linear-gradient(180deg, rgba(34, 197, 94, 0.12) 0%, rgba(255,255,255,0.03) 100%)"
    : "rgba(255,255,255,0.025)";

  return (
    <div
      style={{
        ...COMPACT_CARD_STYLE,
        border: `1px solid ${borderColor}`,
        background,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: "#f8fafc", fontSize: 15, fontWeight: 800 }}>
            🏬 {profile.dealerId || "Unknown Dealer"}
          </div>
          <div
            style={{
              color: "#94a3b8",
              fontSize: 12,
              marginTop: 4,
              wordBreak: "break-word",
              overflowWrap: "anywhere",
            }}
          >
            {profile.tenantName || "Unknown Tenant"}
          </div>
        </div>

        <button
          className={isSelected ? "btn-postman" : "btn-secondary btn-sm"}
          type="button"
          onClick={() => onSelect(profile)}
        >
          {isSelected ? "✅ Selected" : "Select"}
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 10,
        }}
      >
        <div>
          <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>Tek Site ID</div>
          <div
            style={{
              color: "#e2e8f0",
              fontSize: 13,
              fontWeight: 700,
              wordBreak: "break-word",
            }}
          >
            {profile.tekSiteId || "—"}
          </div>
        </div>

        <div>
          <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>Role ID</div>
          <div
            style={{
              color: "#e2e8f0",
              fontSize: 13,
              fontWeight: 700,
              wordBreak: "break-word",
            }}
          >
            {profile.roleId || "—"}
          </div>
        </div>

        <div>
          <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>JWT Email</div>
          <div
            style={{
              color: "#e2e8f0",
              fontSize: 13,
              fontWeight: 700,
              wordBreak: "break-word",
            }}
          >
            {profile.decodedToken?.email || "—"}
          </div>
        </div>

        <div>
          <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>Token Status</div>
          <div
            style={{
              color:
                profile.decodedToken?.isExpired === true
                  ? "#fca5a5"
                  : profile.decodedToken?.isExpired === false
                  ? "#86efac"
                  : "#cbd5e1",
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            {profile.decodedToken?.isExpired === true
              ? "Expired"
              : profile.decodedToken?.isExpired === false
              ? "Valid"
              : "Unknown"}
          </div>
        </div>

        <div>
          <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>Captured</div>
          <div
            style={{
              color: "#e2e8f0",
              fontSize: 13,
              fontWeight: 700,
              wordBreak: "break-word",
            }}
          >
            {formatSavedAt(profile.capturedAt)}
          </div>
        </div>

        <div>
          <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>Header Count</div>
          <div style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 700 }}>
            {Object.keys(profile.bootstrapHeaders ?? {}).length}
          </div>
        </div>
      </div>

      {profile.sourceUrl ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>Source URL</div>
          <div
            style={{
              color: "#94a3b8",
              fontSize: 12,
              wordBreak: "break-word",
              overflowWrap: "anywhere",
            }}
          >
            {profile.sourceUrl}
          </div>
        </div>
      ) : null}

      {profile.token ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <button
              className="btn-secondary btn-sm"
              type="button"
              onClick={() => setTokenHidden((prev) => !prev)}
            >
              {tokenHidden ? "👁 Show JWT" : "🙈 Hide JWT"}
            </button>

            <button
              className="btn-secondary btn-sm"
              type="button"
              onClick={() => setShowJwt((prev) => !prev)}
              disabled={tokenHidden}
            >
              {showJwt ? "🧾 Hide JWT Debugger" : "🧾 Show JWT Debugger"}
            </button>
          </div>

          <SecretTextArea
            value={profile.token}
            hidden={tokenHidden}
            rows={4}
            placeholder="Captured profile JWT"
            onChange={() => {}}
          />
        </div>
      ) : null}

      {showJwt && profile.token && !tokenHidden ? (
        <div style={{ marginTop: 12 }}>
          <JwtDebugger
            title={`Dealer ${profile.dealerId || profile.tenantName || profile.id} JWT`}
            token={profile.token}
          />
        </div>
      ) : null}
    </div>
  );
};

export const Settings: React.FC<Props> = ({ onBack }) => {
  const [tokens, setTokens] = useState<Record<TokenFieldKey, string>>(buildEmptyTokens());
  const [savedAtByKey, setSavedAtByKey] = useState<Record<string, string>>({});
  const [hiddenByKey, setHiddenByKey] = useState<Record<TokenFieldKey, boolean>>(buildHiddenMap());
  const [message, setMessage] = useState<UiMessage | null>(null);
  const [latestCapture, setLatestCapture] = useState<ArcLatestCaptureState | null>(null);
  const [globalHeaders, setGlobalHeaders] = useState<KeyValuePair[]>([]);
  const [savedTokensSnapshot, setSavedTokensSnapshot] =
    useState<Record<TokenFieldKey, string>>(buildEmptyTokens());
  const [savedGlobalHeadersSnapshot, setSavedGlobalHeadersSnapshot] = useState<KeyValuePair[]>([]);

  // Initialize from localStorage for persistence
  const [selectedDealerProfileId, setSelectedDealerProfileId] = useState<string | null>(() => {
    return localStorage.getItem(SELECTED_DEALER_PROFILE_KEY);
  });

  const messageTimerRef = useRef<number | null>(null);
  const latestStateRef = useRef({
    tokens,
    globalHeaders,
    savedTokensSnapshot,
    savedGlobalHeadersSnapshot,
  });

  const profiles = latestCapture?.tekionProfiles ?? [];

  const showMessage = (type: MessageType, text: string) => {
    setMessage({ type, text });
    if (messageTimerRef.current) {
      window.clearTimeout(messageTimerRef.current);
    }
    messageTimerRef.current = window.setTimeout(() => setMessage(null), 2400);
  };

  const refreshFromStorage = (options?: { preserveEdits?: boolean }) => {
    logger.debug(`Refreshing state from storage. preserveEdits: ${options?.preserveEdits ?? false}`);
    try {
      const bundle = loadTekionApiSettingsBundle();
      const nextTokens = {
        ...buildEmptyTokens(),
        ...(bundle.values as Partial<Record<TokenFieldKey, string>>),
      };
      const nextGlobalHeaders = bundle.globalHeaders;
      const nextCapture = loadLatestExtensionCapture();

      setSavedAtByKey(bundle.savedAtByKey);
      setLatestCapture(nextCapture);
      setSavedTokensSnapshot(nextTokens);
      setSavedGlobalHeadersSnapshot(nextGlobalHeaders);

      if (!options?.preserveEdits) {
        setTokens(nextTokens);
        setGlobalHeaders(nextGlobalHeaders);
      }

      logger.info(`Hydrated from storage. Headers: ${nextGlobalHeaders.length}, Capture Present: ${!!nextCapture}`);
    } catch (error) {
      logger.error("Failed to load settings from storage", error);
      showMessage("error", "Failed to load settings from storage");
    }
  };

  useEffect(() => {
    latestStateRef.current = {
      tokens,
      globalHeaders,
      savedTokensSnapshot,
      savedGlobalHeadersSnapshot,
    };
  }, [tokens, globalHeaders, savedTokensSnapshot, savedGlobalHeadersSnapshot]);

  useEffect(() => {
    logger.info("Settings component mounted. Initializing data & subscription...");
    refreshFromStorage();

    const unsubscribe = subscribeToExtensionCapture(() => {
      logger.info("Extension capture sync event received");
      const current = latestStateRef.current;
      const currentDirty =
        !areTokenMapsEqual(current.tokens, current.savedTokensSnapshot) ||
        !arePairsEqual(current.globalHeaders, current.savedGlobalHeadersSnapshot);

      refreshFromStorage({ preserveEdits: currentDirty });

      if (currentDirty) {
        logger.warn("Sync completed. Preserving user's unsaved edits.");
        showMessage("warning", "Extension synced new capture. Unsaved edits were preserved.");
      } else {
        showMessage("success", "Tokens synced from extension");
      }
    });

    requestLatestCaptureFromExtension();

    return () => {
      logger.info("Settings component unmounting. Cleaning up subscriptions.");
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (messageTimerRef.current) {
        window.clearTimeout(messageTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const hasUnsavedChanges =
      !areTokenMapsEqual(tokens, savedTokensSnapshot) ||
      !arePairsEqual(globalHeaders, savedGlobalHeadersSnapshot);

    const handler = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [tokens, globalHeaders, savedTokensSnapshot, savedGlobalHeadersSnapshot]);

  // Clears the selected profile only if it vanishes from the extension sync state,
  // making sure not to fire prematurely before `latestCapture` has loaded.
  useEffect(() => {
    if (!selectedDealerProfileId || !latestCapture) return;

    const stillExists = profiles.some((profile) => profile.id === selectedDealerProfileId);
    if (!stillExists) {
      logger.debug(`Selected dealer profile ${selectedDealerProfileId} no longer exists in sync. Clearing selection.`);
      setSelectedDealerProfileId(null);
      localStorage.removeItem(SELECTED_DEALER_PROFILE_KEY);
    }
  }, [profiles, selectedDealerProfileId, latestCapture]);

  const updateToken = (key: TokenFieldKey, value: string) => {
    setTokens((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const toggleHidden = (key: TokenFieldKey) => {
    setHiddenByKey((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const warnings = useMemo(() => {
    return TOKEN_FIELDS.reduce<Partial<Record<TokenFieldKey, string>>>((acc, field) => {
      const warning = field.validate?.(tokens[field.key] ?? "");
      if (warning) acc[field.key] = warning;
      return acc;
    }, {});
  }, [tokens]);

  const warningCount = Object.keys(warnings).length;

  const hasAnyValue =
    TOKEN_FIELDS.some((field) => (tokens[field.key] ?? "").trim().length > 0) ||
    globalHeaders.length > 0 ||
    profiles.length > 0;

  const hasUnsavedChanges =
    !areTokenMapsEqual(tokens, savedTokensSnapshot) ||
    !arePairsEqual(globalHeaders, savedGlobalHeadersSnapshot);

  const applySelectedHeadersToGlobal = (pairs: KeyValuePair[], sourceLabel: string) => {
    if (pairs.length === 0) {
      logger.warn(`Attempted to apply headers from ${sourceLabel}, but selection was empty.`);
      showMessage("warning", `No headers selected from ${sourceLabel}`);
      return;
    }

    logger.info(`Applying ${pairs.length} headers to global scope from: ${sourceLabel}`);
    setGlobalHeaders(pairs);
    saveGlobalHeaders(pairs);
    showMessage("success", `Applied ${pairs.length} selected headers from ${sourceLabel}`);
  };

  const handleSelectDealerProfile = (profile: ArcTekionProfile) => {
    const pairs = toKeyValuePairs(profile.bootstrapHeaders);

    if (pairs.length === 0) {
      logger.warn(`Selected dealer ${profile.id} has no valid bootstrap headers.`);
      showMessage("warning", "Selected dealer has no bootstrap headers to apply");
      return;
    }

    logger.info(`Selected dealer profile: ${profile.dealerId || profile.id}. Extracted ${pairs.length} headers.`);

    setSelectedDealerProfileId(profile.id);
    localStorage.setItem(SELECTED_DEALER_PROFILE_KEY, profile.id);

    setGlobalHeaders(pairs);
    saveGlobalHeaders(pairs);

    showMessage(
      "success",
      `Selected dealer ${profile.dealerId || profile.tenantName || profile.id} and applied ${pairs.length} headers to Global Headers`
    );
  };

  const handleSaveAll = () => {
    logger.info("Executing handleSaveAll...");
    try {
      const trimmed = TOKEN_FIELDS.reduce<Record<TokenFieldKey, string>>((acc, field) => {
        acc[field.key] = (tokens[field.key] ?? "").trim();
        return acc;
      }, buildEmptyTokens());

      saveTekionApiSettings(trimmed);
      saveGlobalHeaders(globalHeaders);
      refreshFromStorage();

      if (warningCount > 0) {
        logger.warn(`Settings saved, but ${warningCount} validation warnings exist.`);
        showMessage("warning", "Settings saved with validation warnings");
        return;
      }

      logger.info("Settings saved successfully.");
      showMessage("success", "Settings saved");
    } catch (error) {
      logger.error("Failed to save settings bundle", error);
      showMessage("error", "Failed to save settings");
    }
  };

  const handleBack = () => {
    if (hasUnsavedChanges) {
      logger.debug("Prompting user regarding unsaved changes before navigating back");
      const confirmed = window.confirm(
        "You have unsaved changes. Are you sure you want to go back?"
      );
      if (!confirmed) {
        logger.debug("User canceled back navigation");
        return;
      }
    }
    logger.info("Navigating back...");
    onBack();
  };

  const handleClearAll = () => {
    logger.debug("Prompting user to clear all settings");
    const confirmed = window.confirm(
      "Clear all saved token settings and global headers? Captured extension profiles will remain in extension storage."
    );
    if (!confirmed) return;

    logger.info("Executing handleClearAll...");
    try {
      clearTekionApiSettings();
      clearGlobalHeaders();
      setTokens(buildEmptyTokens());
      setSavedAtByKey({});
      setHiddenByKey(buildHiddenMap());
      setGlobalHeaders([]);

      setSelectedDealerProfileId(null);
      localStorage.removeItem(SELECTED_DEALER_PROFILE_KEY);

      refreshFromStorage();
      showMessage("success", "Settings cleared");
      logger.info("All settings cleared successfully.");
    } catch (error) {
      logger.error("Failed to clear settings", error);
      showMessage("error", "Failed to clear settings");
    }
  };

  const handleClearField = (key: TokenFieldKey, title: string) => {
    logger.debug(`Prompting to clear specific field: ${key}`);
    const confirmed = window.confirm(`Clear ${title}?`);
    if (!confirmed) return;

    try {
      clearTekionApiSetting(key);
      refreshFromStorage();
      showMessage("success", `${title} cleared`);
      logger.info(`Cleared field: ${key}`);
    } catch (error) {
      logger.error(`Failed to clear field ${key}`, error);
      showMessage("error", `Failed to clear ${title}`);
    }
  };

  const handleCopy = async (key: TokenFieldKey, title: string) => {
    try {
      const value = (tokens[key] ?? "").trim();
      if (!value) return;
      await navigator.clipboard.writeText(value);
      showMessage("success", `${title} copied`);
      logger.info(`Copied value for ${key} to clipboard.`);
    } catch (error) {
      logger.error(`Failed to copy to clipboard for ${key}`, error);
      showMessage("error", `Failed to copy ${title}`);
    }
  };

  const handleGlobalHeadersChange = (pairs: KeyValuePair[]) => {
    setGlobalHeaders(pairs);
  };

  const handleClearGlobalHeaders = () => {
    logger.debug("Prompting to clear global headers");
    const confirmed = window.confirm("Clear all global headers?");
    if (!confirmed) return;

    try {
      clearGlobalHeaders();
      setGlobalHeaders([]);

      setSelectedDealerProfileId(null);
      localStorage.removeItem(SELECTED_DEALER_PROFILE_KEY);

      showMessage("success", "Global headers cleared");
      logger.info("Global headers cleared successfully.");
    } catch (error) {
      logger.error("Failed to clear global headers", error);
      showMessage("error", "Failed to clear global headers");
    }
  };

  return (
    <div style={PAGE_STYLE}>
      <div style={PAGE_INNER_STYLE}>
        <div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 800,
              color: "#f8fafc",
              marginBottom: 4,
            }}
          >
            ⚙️ Settings
          </div>
          <div
            style={{
              color: "#94a3b8",
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            Manage tokens, captured dealer profiles, reusable global headers, and extension
            capture diagnostics in one place.
          </div>
        </div>

        <div style={STICKY_BAR_STYLE}>
          <div>
            <div
              style={{
                color: "#f8fafc",
                fontWeight: 700,
                fontSize: 15,
                marginBottom: 2,
              }}
            >
              Settings Actions
            </div>
            <div style={{ color: "#94a3b8", fontSize: 12 }}>
              {TOKEN_FIELDS.length} token fields · {globalHeaders.length} global headers ·{" "}
              {profiles.length} dealer profiles · {warningCount} warning{" "}
              {warningCount === 1 ? "" : "s"} · {hasUnsavedChanges ? "Unsaved changes" : "Saved"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-secondary btn-sm" onClick={handleBack}>
              ← Back
            </button>
            <button className="btn-postman" onClick={handleSaveAll} disabled={!hasAnyValue}>
              💾 Save All
            </button>
            <button className="btn-cancel-bulk" onClick={handleClearAll} disabled={!hasAnyValue}>
              🗑 Clear All
            </button>
          </div>
        </div>

        {message ? <div style={getMessageBoxStyle(message.type)}>{message.text}</div> : null}

        <CollapsibleSection
          title="🔄 Extension Sync Status"
          subtitle="Latest extension capture timestamps and source URLs."
          defaultOpen
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span style={PILL_STYLE}>
              <span style={{ color: "#94a3b8" }}>Graph Captured</span>
              <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
                {formatSavedAt(latestCapture?.lastGraphCaptureAt)}
              </span>
            </span>

            <span style={PILL_STYLE}>
              <span style={{ color: "#94a3b8" }}>Implementation Captured</span>
              <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
                {formatSavedAt(latestCapture?.lastTekionImplementationCaptureAt)}
              </span>
            </span>

            <span style={PILL_STYLE}>
              <span style={{ color: "#94a3b8" }}>Bootstrap Captured</span>
              <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
                {formatSavedAt(latestCapture?.lastTekionBootstrapCaptureAt)}
              </span>
            </span>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="🔐 API Tokens"
          subtitle="Store integration tokens in one place. JWT details stay hidden until explicitly revealed."
          defaultOpen
        >
          <div style={{ display: "grid", gap: 14 }}>
            {TOKEN_FIELDS.map((field) => (
              <TokenCard
                key={field.key}
                config={field}
                value={tokens[field.key] ?? ""}
                warning={warnings[field.key]}
                savedAt={savedAtByKey[field.key]}
                hidden={hiddenByKey[field.key]}
                onChange={(value) => updateToken(field.key, value)}
                onCopy={() => void handleCopy(field.key, field.title)}
                onClear={() => handleClearField(field.key, field.title)}
                onToggleHidden={() => toggleHidden(field.key)}
              />
            ))}
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="🏬 Captured Dealer Profiles"
          subtitle="Compact dealer cards only. Select one dealer, and that dealer's bootstrap headers automatically become Global Headers."
          defaultOpen
        >
          {profiles.length === 0 ? (
            <div style={COMPACT_CARD_STYLE}>
              <div style={{ color: "#94a3b8", fontSize: 14 }}>
                No dealer profiles captured yet. Log into Tekion dealers and let the extension
                capture bootstrap requests.
              </div>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                gap: 14,
              }}
            >
              {profiles.map((profile) => (
                <DealerProfileCard
                  key={profile.id}
                  profile={profile}
                  isSelected={selectedDealerProfileId === profile.id}
                  onSelect={handleSelectDealerProfile}
                />
              ))}
            </div>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="📮 Global Headers"
          subtitle="Reusable headers applied by Postman / CORS Proxy requests."
          defaultOpen
          actions={
            <button
              className="btn-cancel-bulk"
              type="button"
              onClick={handleClearGlobalHeaders}
              disabled={globalHeaders.length === 0}
            >
              🗑 Clear Global Headers
            </button>
          }
        >
          <GlobalHeadersPanel
            pairs={globalHeaders}
            onChange={handleGlobalHeadersChange}
            defaultOpen
            title="Unified Global Headers"
          />
        </CollapsibleSection>

        <CollapsibleSection
          title="🧾 Latest Captured Headers"
          subtitle="Graph, Tekion implementation, and Tekion bootstrap headers are shown separately. Select only what you want to apply to Global Headers."
          defaultOpen={false}
        >
          <SelectableHeaderMap
            title="Graph Headers"
            headers={latestCapture?.graphHeaders}
            capturedAt={latestCapture?.lastGraphCaptureAt}
            sourceUrl={latestCapture?.lastGraphSourceUrl}
            applyButtonLabel="Use Selected Graph Headers"
            onApplySelected={(pairs) => applySelectedHeadersToGlobal(pairs, "Graph capture")}
          />

          <SelectableHeaderMap
            title="Tekion Implementation Headers"
            headers={latestCapture?.tekionImplementationHeaders}
            capturedAt={latestCapture?.lastTekionImplementationCaptureAt}
            sourceUrl={latestCapture?.lastTekionImplementationSourceUrl}
            applyButtonLabel="Use Selected Implementation Headers"
            onApplySelected={(pairs) =>
              applySelectedHeadersToGlobal(pairs, "Tekion implementation capture")
            }
          />

          <SelectableHeaderMap
            title="Tekion Bootstrap Headers"
            headers={latestCapture?.tekionBootstrapHeaders}
            capturedAt={latestCapture?.lastTekionBootstrapCaptureAt}
            sourceUrl={latestCapture?.lastTekionBootstrapSourceUrl}
            applyButtonLabel="Use Selected Bootstrap Headers"
            onApplySelected={(pairs) =>
              applySelectedHeadersToGlobal(pairs, "Tekion bootstrap capture")
            }
          />
        </CollapsibleSection>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            flexWrap: "wrap",
            paddingBottom: 12,
          }}
        >
          <button className="btn-secondary btn-sm" onClick={handleBack}>
            ← Back to Home
          </button>
          <button className="btn-postman" onClick={handleSaveAll} disabled={!hasAnyValue}>
            💾 Save All
          </button>
        </div>
      </div>
    </div>
  );
};