import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  useDeferredValue,
} from "react";
import "./Settings.css";
import {
  loadTekionApiSettingsBundle,
  saveTekionApiSettings,
  saveGlobalHeaders,
  clearGlobalHeaders,
  clearTekionApiSettings,
  clearTekionApiSetting,
  getSelectedDealerProfileId,
  saveSelectedDealerProfileId,
  clearSelectedDealerProfileId,
} from "../services/tekionApiSettings";
import {
  requestLatestCaptureFromExtension,
  subscribeToExtensionCapture,
  loadLatestExtensionCapture,
  ArcLatestCaptureState,
  ArcTekionProfile,
  ArcCustomCapturedApi,
} from "../services/extensionBridge";
import { useArcRules } from "../hooks/useArcRules";
import { JwtDebugger } from "../components/JwtDebugger";
import { GlobalHeadersPanel } from "../components/GlobalHeadersPanel";
import { SelectableHeaderMap } from "../components/SelectableHeaderMap";
import type { KeyValuePair } from "../types/proxy.types";

const logger = {
  debug: (...args: unknown[]) => console.debug("[Settings]", ...args),
  info: (...args: unknown[]) => console.info("[Settings]", ...args),
  warn: (...args: unknown[]) => console.warn("[Settings]", ...args),
  error: (...args: unknown[]) => console.error("[Settings]", ...args),
};

const MAX_PROFILE_AGE_MS = 48 * 60 * 60 * 1000;

interface Props {
  onBack: () => void;
}

type TabKey = "tokens" | "profiles" | "headers" | "extension";
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
  infoText: string;
  label: string;
  placeholder: string;
  rows?: number;
  authType: TokenAuthType;
  headerName?: string;
  extraPreviewLines?: string[];
  validate?: (value: string) => string | undefined;
}

interface SecretTextAreaProps {
  value: string;
  hidden: boolean;
  rows?: number;
  placeholder?: string;
  onChange: (value: string) => void;
}

interface TokenCardProps {
  config: TokenFieldConfig;
  value: string;
  warning?: string;
  savedAt?: string;
  hidden: boolean;
  onUpdateToken: (key: TokenFieldKey, value: string) => void;
  onCopy: (value: string, title: string) => void;
  onClear: (key: TokenFieldKey, title: string) => void;
  onToggleHidden: (key: TokenFieldKey) => void;
}

interface DealerProfileCardProps {
  profile: ArcTekionProfile;
  isSelected: boolean;
  onSelect: (profile: ArcTekionProfile) => void;
}

interface ConfirmButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  onConfirm: () => void;
  confirmText?: string;
  baseText: string;
  requireConfirm?: boolean;
}

const TOKEN_FIELDS: TokenFieldConfig[] = [
  {
    key: "tapDuoApiToken",
    icon: "🔑",
    title: "Tekion Stores API Token",
    label: "tap-duo-api-token",
    placeholder: "Legacy tap-duo-api-token field",
    rows: 7,
    authType: "header",
    headerName: "tap-duo-api-token",
    infoText:
      "Legacy field preserved for older flows. Stores dashboard now uses custom captured request headers instead.",
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
    infoText: "Paste a valid bearer token with Files.ReadWrite access.",
  },
];

function buildEmptyTokens(): Record<TokenFieldKey, string> {
  return { tapDuoApiToken: "", graphApiToken: "" };
}

function buildHiddenMap(): Record<TokenFieldKey, boolean> {
  return { tapDuoApiToken: true, graphApiToken: true };
}

function formatSavedAt(value?: string | number | Date): string {
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

function toKeyValuePairs(
  headers: Record<string, string> | undefined
): KeyValuePair[] {
  if (!headers) return [];
  return Object.entries(headers)
    .filter(([key, value]) => key.trim() && String(value).trim())
    .map(([key, value]) => ({ key, value: String(value), enabled: true }));
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

const InfoTooltip: React.FC<{ text: React.ReactNode }> = React.memo(
  ({ text }) => {
    const [isVisible, setIsVisible] = useState(false);
    return (
      <div
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
        onFocus={() => setIsVisible(true)}
        onBlur={() => setIsVisible(false)}
        style={{
          position: "relative",
          display: "inline-flex",
          cursor: "help",
          marginLeft: 8,
        }}
      >
        <span
          tabIndex={0}
          aria-label="More info"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            borderRadius: 9,
            background: "rgba(255,255,255,0.15)",
            color: "#cbd5e1",
            fontSize: 11,
            fontWeight: "bold",
          }}
        >
          i
        </span>
        {isVisible && (
          <div
            role="tooltip"
            style={{
              position: "absolute",
              bottom: "100%",
              left: "50%",
              transform: "translateX(-50%)",
              marginBottom: 8,
              padding: "8px 12px",
              background: "#1e293b",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              color: "#e2e8f0",
              fontSize: 12,
              width: 250,
              zIndex: 100,
              boxShadow: "0 10px 25px rgba(0,0,0,0.4)",
              pointerEvents: "none",
              fontWeight: "normal",
              lineHeight: 1.4,
            }}
          >
            {text}
          </div>
        )}
      </div>
    );
  }
);

const ConfirmButton: React.FC<ConfirmButtonProps> = React.memo(
  ({
    onConfirm,
    confirmText = "⚠️ Sure?",
    baseText,
    requireConfirm = true,
    className,
    style,
    disabled,
  }) => {
    const [confirming, setConfirming] = useState(false);

    useEffect(() => {
      let t: ReturnType<typeof setTimeout>;
      if (confirming) t = setTimeout(() => setConfirming(false), 3000);
      return () => clearTimeout(t);
    }, [confirming]);

    return (
      <button
        type="button"
        className={`${className || ""} ${confirming ? "btn-confirming" : ""}`.trim()}
        disabled={disabled}
        style={style}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
          e.preventDefault();
          e.stopPropagation();
          if (disabled) return;
          if (!requireConfirm) {
            onConfirm();
            return;
          }
          if (confirming) {
            setConfirming(false);
            onConfirm();
          } else {
            setConfirming(true);
          }
        }}
      >
        {confirming ? confirmText : baseText}
      </button>
    );
  }
);

const SecretTextArea: React.FC<SecretTextAreaProps> = React.memo(
  ({ value, hidden, rows = 7, placeholder, onChange }) => {
    return (
      <div style={{ position: "relative" }}>
        <textarea
          className={`st-input secret-textarea ${hidden ? "hidden-mode" : ""}`}
          value={hidden ? (value ? "••••••••••••••••••••••••••••••••" : "") : value}
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
          aria-label={hidden ? "Token value hidden" : "Token value input"}
          style={{ minHeight: Math.max(rows * 24, 150) }}
          readOnly={hidden}
        />
        {hidden && value && (
          <div aria-hidden="true" className="secret-textarea-overlay" />
        )}
      </div>
    );
  }
);

const TokenCard: React.FC<TokenCardProps> = React.memo(
  ({
    config,
    value,
    warning,
    savedAt,
    hidden,
    onUpdateToken,
    onCopy,
    onClear,
    onToggleHidden,
  }) => {
    const [showJwt, setShowJwt] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);

    return (
      <section className="section-card">
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 14,
            flexWrap: "wrap",
            marginBottom: isExpanded ? 20 : 0,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
            <div style={{ display: "flex", alignItems: "center" }}>
              <h4
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: "#f8fafc",
                  margin: 0,
                }}
              >
                {config.title}
              </h4>
              {config.infoText && <InfoTooltip text={config.infoText} />}
            </div>
          </div>

          <button
            className="btn-secondary btn-sm"
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
          >
            {isExpanded ? "Hide Details" : "Manage Token"}
          </button>
        </div>

        {isExpanded && (
          <div style={{ paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <span className="ui-pill">
                <span style={{ color: "#94a3b8" }}>Field</span>
                <code className="st-req-url">{config.label}</code>
              </span>
              <span className="ui-pill">
                <span style={{ color: "#94a3b8" }}>Last saved</span>
                <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
                  {formatSavedAt(savedAt)}
                </span>
              </span>
            </div>

            <SecretTextArea
              value={value}
              hidden={hidden}
              rows={config.rows ?? 7}
              placeholder={config.placeholder}
              onChange={(val) => onUpdateToken(config.key, val)}
            />

            {warning && (
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
            )}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
              <button className="btn-secondary btn-sm" type="button" onClick={() => onToggleHidden(config.key)}>
                {hidden ? "👁 Show Text" : "🙈 Hide Text"}
              </button>
              <button
                className="btn-secondary btn-sm"
                type="button"
                onClick={() => setShowJwt((prev) => !prev)}
                disabled={!value.trim()}
              >
                {showJwt ? "🧾 Hide JWT Debugger" : "🧾 Show JWT Debugger"}
              </button>
              <button
                className="btn-secondary btn-sm"
                type="button"
                onClick={() => onCopy(value, config.title)}
                disabled={!value.trim()}
              >
                📋 Copy
              </button>
              <ConfirmButton
                className="btn-cancel-bulk"
                baseText="🗑 Clear"
                confirmText="⚠️ Confirm"
                onConfirm={() => onClear(config.key, config.title)}
                disabled={!value.trim()}
              />
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
              <span className="ui-pill">
                <span style={{ color: "#94a3b8" }}>Header</span>
                <code className="st-req-url">{getHeaderPreviewValue(config)}</code>
              </span>
              {(config.extraPreviewLines ?? []).map((line) => (
                <span key={line} className="ui-pill">
                  {line}
                </span>
              ))}
            </div>

            {showJwt && (
              <div style={{ marginTop: 14 }}>
                <JwtDebugger title={`${config.title} JWT Debugger`} token={value} />
              </div>
            )}
          </div>
        )}
      </section>
    );
  }
);

const DealerProfileCard: React.FC<DealerProfileCardProps> = React.memo(
  ({ profile, isSelected, onSelect }) => {
    return (
      <div className={`compact-card dealer-profile-card ${isSelected ? "selected" : ""}`}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ color: "#f8fafc", fontSize: 15, fontWeight: 800 }}>
              🏬 {profile.dealerId || "Unknown Dealer"}
            </div>
            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
              {profile.tenantName || "Unknown Tenant"}
            </div>
          </div>

          <button
            className={isSelected ? "btn-postman" : "btn-secondary btn-sm"}
            type="button"
            onClick={() => onSelect(profile)}
          >
            {isSelected ? "✅ Selected" : "Select Profile"}
          </button>
        </div>
      </div>
    );
  }
);

const CustomCaptureCard: React.FC<{
  capture: ArcCustomCapturedApi;
  isSelectedForStoresProfile: boolean;
  isSelectedForStoresApi: boolean;
  onApply: (pairs: KeyValuePair[], sourceLabel: string) => void;
  onSelectForStoresProfile: (captureId: string) => void;
  onSelectForStoresApi: (captureId: string) => void;
}> = ({
  capture,
  isSelectedForStoresProfile,
  isSelectedForStoresApi,
  onApply,
  onSelectForStoresProfile,
  onSelectForStoresApi,
}) => {
  const tokenExpired = capture.decodedToken?.isExpired === true;

  return (
    <div className="compact-card" style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "#f8fafc", fontSize: 15, fontWeight: 800 }}>
            {capture.label}
          </div>
          <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4 }}>
            {capture.pattern}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className={isSelectedForStoresProfile ? "btn-postman" : "btn-secondary btn-sm"}
            type="button"
            onClick={() => onSelectForStoresProfile(capture.id)}
          >
            {isSelectedForStoresProfile ? "✅ Stores Profile Source" : "Use As Stores Profile Source"}
          </button>

          <button
            className={isSelectedForStoresApi ? "btn-postman" : "btn-secondary btn-sm"}
            type="button"
            onClick={() => onSelectForStoresApi(capture.id)}
          >
            {isSelectedForStoresApi ? "✅ Stores API Source" : "Use As Stores API Source"}
          </button>

          <button
            className="btn-secondary btn-sm"
            type="button"
            onClick={() => onApply(toKeyValuePairs(capture.headers), capture.label)}
          >
            Use Captured Headers
          </button>
        </div>
      </div>

      {tokenExpired && (
        <div
          style={{
            color: "#fecaca",
            background: "rgba(239, 68, 68, 0.14)",
            border: "1px solid rgba(239, 68, 68, 0.28)",
            borderRadius: 12,
            padding: "10px 12px",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Captured token expired. Please reload the website to capture a fresh token.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span className="ui-pill">
          <span style={{ color: "#94a3b8" }}>Captured</span>
          <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
            {formatSavedAt(capture.capturedAt)}
          </span>
        </span>
        <span className="ui-pill">
          <span style={{ color: "#94a3b8" }}>Last Seen</span>
          <span style={{ color: "#e2e8f0", fontWeight: 600 }}>
            {formatSavedAt(capture.lastSeenAt)}
          </span>
        </span>
        <span className="ui-pill">
          <span style={{ color: "#94a3b8" }}>Token Expires</span>
          <span style={{ color: tokenExpired ? "#fca5a5" : "#86efac", fontWeight: 600 }}>
            {capture.decodedToken?.expiresAt
              ? formatSavedAt(capture.decodedToken.expiresAt)
              : "Unknown"}
          </span>
        </span>
      </div>

      <SelectableHeaderMap
        title={`${capture.label} Headers`}
        headers={capture.headers}
        capturedAt={capture.capturedAt}
        sourceUrl={capture.matchedUrl}
        applyButtonLabel="Use Selected Headers"
        onApplySelected={(pairs) => onApply(pairs, capture.label)}
      />
    </div>
  );
};

const WatchRulesManager: React.FC = () => {
  const { rules, addRule, removeRule } = useArcRules();
  const [pattern, setPattern] = useState("");
  const [label, setLabel] = useState("");
  const [matchMode, setMatchMode] = useState<"includes" | "exact">("includes");
  const [expiryHours, setExpiryHours] = useState(48);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pattern.trim()) return;

    addRule({
      pattern: pattern.trim(),
      label: label.trim() || pattern.trim(),
      matchMode,
      expiryHours,
    });

    setPattern("");
    setLabel("");
    setExpiryHours(48);
  };

  return (
    <div className="section-card" style={{ padding: 18 }}>
      <div style={{ marginBottom: 14 }}>
        <h3 style={{ margin: "0 0 6px 0", fontSize: 18 }}>Target API Watch Rules</h3>
        <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>
          Add patterns for the ARC extension to watch and automatically capture auth headers.
        </p>
      </div>

      <form onSubmit={handleAdd} style={{ display: "grid", gap: 12, marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <input
            className="st-input"
            placeholder="URL Pattern or path (e.g. /public/v1/dealers)"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
          />
          <input
            className="st-input"
            placeholder="Label (e.g. Stores Dealer Profile)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <select
            className="st-input"
            value={matchMode}
            onChange={(e) => setMatchMode(e.target.value as "includes" | "exact")}
            style={{ width: 160 }}
          >
            <option value="includes">Match: Contains</option>
            <option value="exact">Match: Exact URL</option>
          </select>

          <input
            className="st-input"
            type="number"
            min={1}
            value={expiryHours}
            onChange={(e) => setExpiryHours(Number(e.target.value))}
            placeholder="Expiry (hours)"
            style={{ width: 140 }}
          />

          <button type="submit" className="btn-postman" style={{ flex: 1 }}>
            + Add Watch Rule
          </button>
        </div>
      </form>

      <div style={{ display: "grid", gap: 8 }}>
        {rules.length === 0 ? (
          <div style={{ color: "#64748b", fontSize: 13, fontStyle: "italic" }}>
            No custom rules active. Added rules will immediately sync to the Chrome extension.
          </div>
        ) : (
          rules.map((rule) => (
            <div
              key={rule.id}
              className="compact-card"
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <div>
                <div style={{ color: "#f8fafc", fontWeight: 700, fontSize: 14 }}>{rule.label}</div>
                <div style={{ color: "#94a3b8", fontSize: 12, fontFamily: "monospace" }}>{rule.pattern}</div>
                <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>
                  Mode: {rule.matchMode} • Expiry: {rule.expiryHours}h
                </div>
              </div>
              <button
                type="button"
                className="btn-cancel-bulk"
                onClick={() => removeRule(rule.id)}
                style={{ padding: "6px 12px", fontSize: 12 }}
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export const Settings: React.FC<Props> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<TabKey>("tokens");
  const [tokens, setTokens] = useState<Record<TokenFieldKey, string>>(buildEmptyTokens());
  const [savedAtByKey, setSavedAtByKey] = useState<Record<string, string>>({});
  const [hiddenByKey, setHiddenByKey] = useState<Record<TokenFieldKey, boolean>>(buildHiddenMap());
  const [message, setMessage] = useState<UiMessage | null>(null);
  const [latestCapture, setLatestCapture] = useState<ArcLatestCaptureState | null>(null);
  const [globalHeaders, setGlobalHeaders] = useState<KeyValuePair[]>([]);
  const [storesCustomCaptureId, setStoresCustomCaptureId] = useState("");
  const [storesApiCaptureId, setStoresApiCaptureId] = useState("");

  const [savedTokensSnapshot, setSavedTokensSnapshot] = useState<Record<TokenFieldKey, string>>(buildEmptyTokens());
  const [savedGlobalHeadersSnapshot, setSavedGlobalHeadersSnapshot] = useState<KeyValuePair[]>([]);

  const [dealerSearchQuery, setDealerSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(dealerSearchQuery);

  const [selectedDealerProfileId, setSelectedDealerProfileId] = useState<string | null>(() =>
    getSelectedDealerProfileId()
  );

  const messageTimerRef = useRef<number | null>(null);

  const latestStateRef = useRef({
    tokens,
    globalHeaders,
    savedTokensSnapshot,
    savedGlobalHeadersSnapshot,
  });

  useEffect(() => {
    latestStateRef.current = {
      tokens,
      globalHeaders,
      savedTokensSnapshot,
      savedGlobalHeadersSnapshot,
    };
  }, [tokens, globalHeaders, savedTokensSnapshot, savedGlobalHeadersSnapshot]);

  const tokensAreDirty = !areTokenMapsEqual(tokens, savedTokensSnapshot);
  const headersAreDirty = !arePairsEqual(globalHeaders, savedGlobalHeadersSnapshot);
  const hasUnsavedChanges = tokensAreDirty || headersAreDirty;

  const activeProfiles = useMemo(() => {
    const rawProfiles = latestCapture?.tekionProfiles ?? [];
    const now = Date.now();
    return rawProfiles.filter((p) => {
      if (!p.capturedAt) return false;
      return now - new Date(p.capturedAt).getTime() <= MAX_PROFILE_AGE_MS;
    });
  }, [latestCapture]);

  const customCaptures = useMemo(() => {
    return Object.values(latestCapture?.customCaptures ?? {}).sort((a, b) => {
      return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
    });
  }, [latestCapture]);

  const filteredProfiles = useMemo(() => {
    if (!deferredSearchQuery.trim()) return activeProfiles;
    const q = deferredSearchQuery.toLowerCase();
    return activeProfiles.filter(
      (p) =>
        p.dealerId?.toLowerCase().includes(q) ||
        p.tenantName?.toLowerCase().includes(q) ||
        p.tekSiteId?.toLowerCase().includes(q)
    );
  }, [activeProfiles, deferredSearchQuery]);

  const showMessage = useCallback((type: MessageType, text: string) => {
    setMessage({ type, text });
    if (messageTimerRef.current) window.clearTimeout(messageTimerRef.current);
    messageTimerRef.current = window.setTimeout(() => setMessage(null), 3000);
  }, []);

  const refreshFromStorage = useCallback(
    (options?: { preserveEdits?: boolean }) => {
      try {
        const bundle = loadTekionApiSettingsBundle();
        const nextTokens = {
          ...buildEmptyTokens(),
          tapDuoApiToken: bundle.values.tapDuoApiToken ?? "",
          graphApiToken: bundle.values.graphApiToken ?? "",
        };
        const nextGlobalHeaders = bundle.globalHeaders;
        const nextCapture = loadLatestExtensionCapture();

        setSavedAtByKey(bundle.savedAtByKey);
        setLatestCapture(nextCapture);
        setStoresCustomCaptureId(bundle.values.storesCustomCaptureId ?? "");
        setStoresApiCaptureId(bundle.values.storesApiCaptureId ?? "");
        setSavedTokensSnapshot(nextTokens);
        setSavedGlobalHeadersSnapshot(nextGlobalHeaders);

        if (!options?.preserveEdits) {
          setTokens(nextTokens);
          setGlobalHeaders(nextGlobalHeaders);
        }
      } catch {
        showMessage("error", "Failed to load settings from storage");
      }
    },
    [showMessage]
  );

  useEffect(() => {
    refreshFromStorage();
    const unsubscribe = subscribeToExtensionCapture(() => {
      const current = latestStateRef.current;
      const currentDirty =
        !areTokenMapsEqual(current.tokens, current.savedTokensSnapshot) ||
        !arePairsEqual(current.globalHeaders, current.savedGlobalHeadersSnapshot);

      refreshFromStorage({ preserveEdits: currentDirty });

      if (currentDirty) {
        showMessage("warning", "Extension synced new capture. Unsaved edits were preserved.");
      } else {
        showMessage("success", "Tokens synced from extension");
      }
    });

    requestLatestCaptureFromExtension();
    return () => unsubscribe();
  }, [refreshFromStorage, showMessage]);

  const updateToken = useCallback(
    (key: TokenFieldKey, value: string) => setTokens((prev) => ({ ...prev, [key]: value })),
    []
  );

  const toggleHidden = useCallback(
    (key: TokenFieldKey) => setHiddenByKey((prev) => ({ ...prev, [key]: !prev[key] })),
    []
  );

  const warnings = useMemo(() => {
    return TOKEN_FIELDS.reduce<Partial<Record<TokenFieldKey, string>>>((acc, field) => {
      const warning = field.validate?.(tokens[field.key] ?? "");
      if (warning) acc[field.key] = warning;
      return acc;
    }, {});
  }, [tokens]);

  const warningCount = Object.keys(warnings).length;

  const handleSelectDealerProfile = useCallback(
    (profile: ArcTekionProfile) => {
      const pairs = toKeyValuePairs(profile.bootstrapHeaders);
      setSelectedDealerProfileId(profile.id);
      saveSelectedDealerProfileId(profile.id);
      setGlobalHeaders(pairs);
      saveGlobalHeaders(pairs);
      showMessage("success", `Applied ${pairs.length} headers from Dealer ${profile.dealerId}`);
    },
    [showMessage]
  );

  const handleSelectStoresProfileCapture = useCallback(
    (captureId: string) => {
      setStoresCustomCaptureId(captureId);
      saveTekionApiSettings({ storesCustomCaptureId: captureId });
      showMessage("success", "Selected custom profile capture for Stores");
    },
    [showMessage]
  );

  const handleSelectStoresApiCapture = useCallback(
    (captureId: string) => {
      setStoresApiCaptureId(captureId);
      saveTekionApiSettings({ storesApiCaptureId: captureId });
      showMessage("success", "Selected direct Stores API capture");
    },
    [showMessage]
  );

  const handleSaveAll = useCallback(() => {
    try {
      const trimmed = TOKEN_FIELDS.reduce<Record<TokenFieldKey, string>>((acc, field) => {
        acc[field.key] = (tokens[field.key] ?? "").trim();
        return acc;
      }, buildEmptyTokens());

      saveTekionApiSettings({
        ...trimmed,
        storesCustomCaptureId,
        storesApiCaptureId,
      });
      saveGlobalHeaders(globalHeaders);
      refreshFromStorage();

      if (warningCount > 0) showMessage("warning", "Settings saved with validation warnings");
      else showMessage("success", "Settings saved");
    } catch {
      showMessage("error", "Failed to save settings");
    }
  }, [tokens, globalHeaders, storesCustomCaptureId, storesApiCaptureId, warningCount, refreshFromStorage, showMessage]);

  const handleClearAll = useCallback(() => {
    try {
      clearTekionApiSettings();
      clearGlobalHeaders();
      setTokens(buildEmptyTokens());
      setSavedAtByKey({});
      setHiddenByKey(buildHiddenMap());
      setGlobalHeaders([]);
      setStoresCustomCaptureId("");
      setStoresApiCaptureId("");
      setSelectedDealerProfileId(null);
      clearSelectedDealerProfileId();
      refreshFromStorage();
      showMessage("success", "Settings cleared");
    } catch {
      showMessage("error", "Failed to clear settings");
    }
  }, [refreshFromStorage, showMessage]);

  const handleClearField = useCallback(
    (key: TokenFieldKey, title: string) => {
      clearTekionApiSetting(key);
      refreshFromStorage();
      showMessage("success", `${title} cleared`);
    },
    [refreshFromStorage, showMessage]
  );

  const handleCopy = useCallback(
    async (value: string, title: string) => {
      const val = value.trim();
      if (!val) return;
      await navigator.clipboard.writeText(val);
      showMessage("success", `${title} copied`);
    },
    [showMessage]
  );

  const handleGlobalHeadersChange = useCallback((pairs: KeyValuePair[]) => {
    setGlobalHeaders(pairs);
  }, []);

  const handleClearGlobalHeaders = useCallback(() => {
    clearGlobalHeaders();
    setGlobalHeaders([]);
    setSelectedDealerProfileId(null);
    clearSelectedDealerProfileId();
    showMessage("success", "Global headers cleared");
  }, [showMessage]);

  const applySelectedHeadersToGlobal = useCallback(
    (pairs: KeyValuePair[], sourceLabel: string) => {
      setGlobalHeaders(pairs);
      saveGlobalHeaders(pairs);
      showMessage("success", `Applied ${pairs.length} selected headers from ${sourceLabel}`);
    },
    [showMessage]
  );

  const expiredSelectedStoresCapture = useMemo(() => {
    const all = customCaptures;
    const selected =
      all.find((item) => item.id === storesApiCaptureId) ||
      all.find((item) => item.id === storesCustomCaptureId) ||
      null;

    return selected?.decodedToken?.isExpired === true ? selected : null;
  }, [customCaptures, storesApiCaptureId, storesCustomCaptureId]);

  const renderSidebarButton = (id: TabKey, label: string, isDirty = false) => {
    const isActive = activeTab === id;
    return (
      <button onClick={() => setActiveTab(id)} className={`sidebar-btn ${isActive ? "active" : ""}`}>
        {label}
        {isDirty && <span className="dirty-dot" title="Unsaved changes" />}
      </button>
    );
  };

  return (
    <div className="settings-layout">
      <div className="settings-sidebar">
        <div
          style={{
            padding: "8px 16px 24px",
            color: "#f8fafc",
            fontWeight: 700,
            fontSize: 16,
            display: "flex",
            alignItems: "center",
          }}
        >
          <span
            style={{ marginRight: 12, cursor: "pointer", display: "flex", alignItems: "center" }}
            onClick={onBack}
            title="Go Back"
          >
            <span style={{ fontSize: 20 }}>←</span>
          </span>
          ⚙️ Settings
        </div>

        <div
          style={{
            color: "#64748b",
            fontSize: 11,
            fontWeight: 700,
            padding: "0 16px 8px",
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          Configuration
        </div>

        {renderSidebarButton("tokens", "🔐 API Tokens", tokensAreDirty)}
        {renderSidebarButton("profiles", "🏬 Dealer Profiles")}
        {renderSidebarButton("headers", "📮 Global Headers", headersAreDirty)}
        {renderSidebarButton("extension", "🔄 Extension Data")}
      </div>

      <div className="settings-main-content">
        <div className="settings-header-bar">
          <div style={{ color: "#94a3b8", fontSize: 13 }}>
            {hasUnsavedChanges ? "You have unsaved changes" : "✓ All changes saved"}
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <ConfirmButton
              className="btn-cancel-bulk"
              baseText="🗑 Clear All Data"
              confirmText="⚠️ Sure?"
              onConfirm={handleClearAll}
            />
            <button className="btn-postman" onClick={handleSaveAll}>
              💾 Save Settings
            </button>
          </div>
        </div>

        <div className="settings-content-scroll-area">
          <div className="settings-content-inner">
            {message && <div className={`message-box ${message.type}`}>{message.text}</div>}

            {expiredSelectedStoresCapture && (
              <div
                style={{
                  marginBottom: 16,
                  color: "#fecaca",
                  background: "rgba(239, 68, 68, 0.14)",
                  border: "1px solid rgba(239, 68, 68, 0.28)",
                  borderRadius: 12,
                  padding: "12px 14px",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                Selected Stores token expired at {formatSavedAt(expiredSelectedStoresCapture.decodedToken?.expiresAt)}.
                Please reload the website to capture a fresh token.
              </div>
            )}

            {activeTab === "tokens" && (
              <section>
                <div style={{ marginBottom: 20 }}>
                  <h2 style={{ fontSize: 24, margin: "0 0 8px 0" }}>API Tokens</h2>
                  <p style={{ color: "#94a3b8", margin: 0 }}>
                    Manage credentials for your external API integrations.
                  </p>
                </div>
                <div style={{ display: "grid", gap: 16 }}>
                  {TOKEN_FIELDS.map((field) => (
                    <TokenCard
                      key={field.key}
                      config={field}
                      value={tokens[field.key] ?? ""}
                      warning={warnings[field.key]}
                      savedAt={savedAtByKey[field.key]}
                      hidden={hiddenByKey[field.key]}
                      onUpdateToken={updateToken}
                      onCopy={handleCopy}
                      onClear={handleClearField}
                      onToggleHidden={toggleHidden}
                    />
                  ))}
                </div>
              </section>
            )}

            {activeTab === "profiles" && (
              <section className="section-card">
                <div style={{ display: "grid", gap: 16 }}>
                  {filteredProfiles.map((profile) => (
                    <DealerProfileCard
                      key={profile.id}
                      profile={profile}
                      isSelected={selectedDealerProfileId === profile.id}
                      onSelect={handleSelectDealerProfile}
                    />
                  ))}
                </div>
              </section>
            )}

            {activeTab === "headers" && (
              <section className="section-card">
                <GlobalHeadersPanel
                  pairs={globalHeaders}
                  onChange={handleGlobalHeadersChange}
                  defaultOpen
                  title="Unified Global Headers"
                />
              </section>
            )}

            {activeTab === "extension" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

                <WatchRulesManager />

                <div className="section-card" style={{ padding: 18 }}>
                  <div style={{ marginBottom: 14 }}>
                    <h3 style={{ margin: "0 0 6px 0", fontSize: 18 }}>Custom API Captures</h3>
                    <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>
                      Expired token-based captures are automatically ignored. Reload the website to capture a fresh token.
                    </p>
                  </div>

                  {customCaptures.length === 0 ? (
                    <div className="compact-card" style={{ color: "#94a3b8", textAlign: "center", padding: 24 }}>
                      No active custom API captures found.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 16 }}>
                      {customCaptures.map((capture) => (
                        <CustomCaptureCard
                          key={capture.id}
                          capture={capture}
                          isSelectedForStoresProfile={storesCustomCaptureId === capture.id}
                          isSelectedForStoresApi={storesApiCaptureId === capture.id}
                          onApply={applySelectedHeadersToGlobal}
                          onSelectForStoresProfile={handleSelectStoresProfileCapture}
                          onSelectForStoresApi={handleSelectStoresApiCapture}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;