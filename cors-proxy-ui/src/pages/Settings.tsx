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
  removeStaleDealerProfiles,
  ArcLatestCaptureState,
  ArcTekionProfile,
  ArcCustomCapturedApi,
} from "../services/extensionBridge";
import { useArcRules } from "../hooks/useArcRules";
import { JwtDebugger } from "../components/JwtDebugger";
import { AssigneeSettingsPanel } from "../components/AssigneeSettingsPanel";
import { GlobalHeadersPanel } from "../components/GlobalHeadersPanel";
import { SelectableHeaderMap } from "../components/SelectableHeaderMap";
import type { KeyValuePair } from "../types/proxy.types";
import { getStores } from "../services/storesDb";
import {
  decodeBlueprintsForDealer,
  persistBlueprintDecodeResult,
  ALL_BLUEPRINT_MODULES,
} from "../services/blueprintDecodeBot";
import { syncAccountingBootstrapForDealer } from "../services/bootstrapSyncBot";

// Remembers which capture of the selected Dealer Profile was last applied to Global Headers.
const SELECTED_PROFILE_APPLIED_AT_KEY = "arc_selected_dealer_profile_applied_at";

// Freshness of a Dealer Profile card. Profiles are treated as usable for 48 hours after capture,
// which is how long the server keeps them working in practice (the token's own 30-day expiry is not the limit).
const PROFILE_FRESH_HOURS = 48;

function profileTokenStatus(profile: ArcTekionProfile): { label: string; color: string } {
  const capturedMs = Date.parse(profile.capturedAt || "");
  if (Number.isNaN(capturedMs)) {
    return { label: "Capture time unknown", color: "#cbd5e1" };
  }
  const freshUntilMs = capturedMs + PROFILE_FRESH_HOURS * 60 * 60 * 1000;
  const until = formatSavedAt(new Date(freshUntilMs).toISOString());
  if (Date.now() >= freshUntilMs) {
    return { label: `Expired (captured ${formatSavedAt(profile.capturedAt)}, 48h limit). Reload a Tekion page to capture a fresh one.`, color: "#fca5a5" };
  }
  if (freshUntilMs - Date.now() < 12 * 60 * 60 * 1000) {
    return { label: `Fresh until ${until} (expiring soon)`, color: "#fde68a" };
  }
  return { label: `Fresh until ${until}`, color: "#86efac" };
}
const TOC_API_ENDPOINT = "https://us-west1-tapapi.tekioncloud.com/tapapi/v2/usermanagement/getuserprofile";

const logger = {
  info: (...args: unknown[]) => console.info("[Settings]", ...args),
  debug: (...args: unknown[]) => console.debug("[Settings]", ...args),
  warn: (...args: unknown[]) => console.warn("[Settings]", ...args),
  error: (...args: unknown[]) => console.error("[Settings]", ...args),
};

interface Props {
  onBack: () => void;
}

type TabKey = "toc" | "tokens" | "profiles" | "headers" | "extension" | "slack" | "assignees";
type TokenAuthType = "header" | "bearer";
type MessageType = "success" | "warning" | "error";
type TokenFieldKey = "tapDuoApiToken" | "graphApiToken";

interface ExtendedArcCaptureState extends ArcLatestCaptureState {
  slackToken?: string;
  slackDCookie?: string;
  lastSlackSourceUrl?: string;
  lastSlackCaptureAt?: string;
}

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
      "Legacy field preserved for older flows. Stores dashboard now uses TOC API captured request headers automatically.",
  },
  {
      key: "graphApiToken",
      icon: "☁️",
      title: "Microsoft Graph API Token",
      label: "GRAPH API Token",
      placeholder: "Auto-captured via SPFx or paste Microsoft Graph bearer token here",
      rows: 8,
      authType: "bearer",
      extraPreviewLines: [
        "Target: T-90 Arc Dealerss.xlsx",
        "Site: tekion.sharepoint.com/sites/configteam",
        "Auto-Sniffed: Via SPFx single sign-on",
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
      infoText:
        "Captured automatically by the ARC extension when visiting the SharePoint T-90 Arc Dealerss workbook, or paste manually.",
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
    const tokenStatus = profileTokenStatus(profile);
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
            <div style={{ color: "#f8fafc", fontSize: 15, fontWeight: 800, wordBreak: "break-word" }}>
              🏬 {profile.dealerId || "Unknown Dealer"}
            </div>
            <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 4, wordBreak: "break-word" }}>
              {profile.tenantName || "Unknown Tenant"}
            </div>
            <div style={{ color: tokenStatus.color, fontSize: 12, marginTop: 4 }}>{tokenStatus.label}</div>
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
  isTocApi?: boolean;
  onApply: (pairs: KeyValuePair[], sourceLabel: string) => void;
  onSelectForStoresProfile: (captureId: string) => void;
  onSelectForStoresApi: (captureId: string) => void;
}> = ({
  capture,
  isSelectedForStoresProfile,
  isSelectedForStoresApi,
  isTocApi,
  onApply,
  onSelectForStoresProfile,
  onSelectForStoresApi,
}) => {
  const tokenExpired = capture.decodedToken?.isExpired === true;

  return (
    <div
      className="compact-card"
      style={{
        display: "grid",
        gap: 10,
        border: isTocApi ? "1px solid rgba(56, 189, 248, 0.4)" : undefined,
        background: isTocApi ? "rgba(56, 189, 248, 0.03)" : undefined,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "#f8fafc", fontSize: 15, fontWeight: 800 }}>
              {capture.label}
            </span>
            {isTocApi && (
              <span
                style={{
                  background: "rgba(56, 189, 248, 0.15)",
                  color: "#38bdf8",
                  border: "1px solid rgba(56, 189, 248, 0.3)",
                  fontSize: 10,
                  fontWeight: 800,
                  padding: "2px 8px",
                  borderRadius: 999,
                }}
              >
                🎯 TOC API (Default)
              </span>
            )}
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

// Shows whether a watch rule has a live capture. The capture is used by any feature that reads it
// (for example User Reset Option 3) until the rule is removed.
const WatchRuleCaptureStatus: React.FC<{ ruleId: string }> = ({ ruleId }) => {
  const capture = loadLatestExtensionCapture()?.customCaptures?.[ruleId];
  if (!capture) {
    return (
      <div style={{ color: "#fde68a", fontSize: 11, marginTop: 4 }}>
        ◐ Waiting for a matching request. Open the page that calls this API.
      </div>
    );
  }
  return (
    <div style={{ color: "#86efac", fontSize: 11, marginTop: 4 }}>
      ● Captured {formatSavedAt(capture.capturedAt)} · last seen {formatSavedAt(capture.lastSeenAt)} · used as default until removed
    </div>
  );
};

const WatchRulesManager: React.FC = () => {
  const { rules, isExtensionConnected, addRule, removeRule } = useArcRules();
  const [pattern, setPattern] = useState("");
  const [label, setLabel] = useState("");
  const [matchMode, setMatchMode] = useState<"includes" | "exact">("includes");
  // 0 = keep until removed (default). Any positive number = auto-expire after that many hours.
  const [expiryHours, setExpiryHours] = useState(0);

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
    setExpiryHours(0);
  };

  return (
    <div className="section-card" style={{ padding: 18 }}>
      <div style={{ marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <h3 style={{ margin: "0 0 6px 0", fontSize: 18 }}>Target API Watch Rules</h3>
          <p style={{ margin: 0, color: "#94a3b8", fontSize: 13 }}>
            Add patterns for the ARC extension to watch and automatically capture auth headers.
          </p>
        </div>
        <span
          className="ui-pill"
          style={{
            background: isExtensionConnected ? "rgba(34, 197, 94, 0.15)" : "rgba(245, 158, 11, 0.15)",
            border: `1px solid ${isExtensionConnected ? "rgba(34, 197, 94, 0.3)" : "rgba(245, 158, 11, 0.3)"}`,
            color: isExtensionConnected ? "#86efac" : "#fde68a",
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {isExtensionConnected ? "● Extension Connected" : "◐ Waiting For Extension"}
        </span>
      </div>

      <form onSubmit={handleAdd} style={{ display: "grid", gap: 12, marginBottom: 20 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <input
            className="st-input"
            placeholder="URL pattern or path (e.g. /public/v1/dealers)"
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
            min={0}
            value={expiryHours}
            onChange={(e) => setExpiryHours(Math.max(0, Number(e.target.value) || 0))}
            placeholder="Expiry hours (0 = until removed)"
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
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}
            >
              <div style={{ minWidth: 0, flex: 1, wordBreak: "break-word" }}>
                <div style={{ color: "#f8fafc", fontWeight: 700, fontSize: 14 }}>{rule.label}</div>
                <div style={{ color: "#94a3b8", fontSize: 12, fontFamily: "monospace" }}>{rule.pattern}</div>
                <div style={{ color: "#64748b", fontSize: 11, marginTop: 4 }}>
                  Mode: {rule.matchMode} • {rule.expiryHours > 0 ? `Expires after ${rule.expiryHours}h` : "Kept until you remove it"}
                </div>
                <WatchRuleCaptureStatus ruleId={rule.id} />
              </div>
              <button
                type="button"
                className="btn-cancel-bulk"
                onClick={() => removeRule(rule.id)}
                style={{ padding: "6px 12px", fontSize: 12, flexShrink: 0 }}
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
  const [activeTab, setActiveTab] = useState<TabKey>("toc");
  const [tokens, setTokens] = useState<Record<TokenFieldKey, string>>(buildEmptyTokens());
  const [savedAtByKey, setSavedAtByKey] = useState<Record<string, string>>({});
  const [hiddenByKey, setHiddenByKey] = useState<Record<TokenFieldKey, boolean>>(buildHiddenMap());
  const [message, setMessage] = useState<UiMessage | null>(null);
  const [latestCapture, setLatestCapture] = useState<ExtendedArcCaptureState | null>(null);
  const [globalHeaders, setGlobalHeaders] = useState<KeyValuePair[]>([]);
  const [storesCustomCaptureId, setStoresCustomCaptureId] = useState("");
  const [storesApiCaptureId, setStoresApiCaptureId] = useState("");

  const [hideSlackToken, setHideSlackToken] = useState(true);
  const [hideSlackCookie, setHideSlackCookie] = useState(true);
  const [showTocDetails, setShowTocDetails] = useState(false);

  const [savedTokensSnapshot, setSavedTokensSnapshot] = useState<Record<TokenFieldKey, string>>(buildEmptyTokens());
  const [savedGlobalHeadersSnapshot, setSavedGlobalHeadersSnapshot] = useState<KeyValuePair[]>([]);

  const [dealerSearchQuery, setDealerSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(dealerSearchQuery);

  const [selectedDealerProfileId, setSelectedDealerProfileId] = useState<string | null>(() =>
    getSelectedDealerProfileId()
  );

  const messageTimerRef = useRef<number | null>(null);
  const lastFailedDecodeProfileRef = useRef<ArcTekionProfile | null>(null);

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
    // Every captured profile is listed, newest first. Expired tokens are shown with a status
    // instead of disappearing, so a selected profile never vanishes after two days.
    const rawProfiles = latestCapture?.tekionProfiles ?? [];
    return [...rawProfiles].sort(
      (a, b) => (Date.parse(b.capturedAt || "") || 0) - (Date.parse(a.capturedAt || "") || 0)
    );
  }, [latestCapture]);

  const customCaptures = useMemo(() => {
    return Object.values(latestCapture?.customCaptures ?? {}).sort((a, b) => {
      return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
    });
  }, [latestCapture]);

  // Find TOC API (/getuserprofile) capture
  const tocCapture = useMemo(() => {
    return (
      customCaptures.find((c) => {
        const pattern = (c.pattern || "").toLowerCase();
        const url = (c.matchedUrl || "").toLowerCase();
        return (
          pattern.includes("getuserprofile") ||
          pattern.includes("usermanagement") ||
          url.includes("getuserprofile")
        );
      }) || null
    );
  }, [customCaptures]);

  // Auto-make TOC API the default Stores API & Profile source
  useEffect(() => {
    if (tocCapture) {
      if (storesCustomCaptureId !== tocCapture.id || storesApiCaptureId !== tocCapture.id) {
        setStoresCustomCaptureId(tocCapture.id);
        setStoresApiCaptureId(tocCapture.id);
        saveTekionApiSettings({
          storesCustomCaptureId: tocCapture.id,
          storesApiCaptureId: tocCapture.id,
        });
        logger.info("Automatically set TOC API as default Stores capture source", {
          id: tocCapture.id,
          matchedUrl: tocCapture.matchedUrl,
        });
      }
    }
  }, [tocCapture, storesCustomCaptureId, storesApiCaptureId]);

  const staleProfileCount = useMemo(() => {
    const now = Date.now();
    return activeProfiles.filter(
      (p) => p.id !== selectedDealerProfileId && now - (Date.parse(p.capturedAt) || 0) >= 48 * 60 * 60 * 1000
    ).length;
  }, [activeProfiles, selectedDealerProfileId]);

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

  // Keeps the selected Dealer Profile's headers current. When the extension captures a newer
  // version of the selected profile (for example after the token was renewed), the new headers
  // are applied automatically. Nothing is re-applied when the capture has not changed, so manual
  // header edits survive a page reload.
  useEffect(() => {
    if (!selectedDealerProfileId) return;
    const profile = (latestCapture?.tekionProfiles ?? []).find((p) => p.id === selectedDealerProfileId);
    if (!profile) return;
    let appliedAt = "";
    try {
      appliedAt = localStorage.getItem(SELECTED_PROFILE_APPLIED_AT_KEY) ?? "";
    } catch {
      appliedAt = "";
    }
    if (appliedAt === profile.capturedAt) return;
    const pairs = toKeyValuePairs(profile.bootstrapHeaders);
    if (pairs.length === 0) return;
    setGlobalHeaders(pairs);
    saveGlobalHeaders(pairs);
    setSavedGlobalHeadersSnapshot(pairs);
    try {
      localStorage.setItem(SELECTED_PROFILE_APPLIED_AT_KEY, profile.capturedAt);
    } catch {
      /* ignore */
    }
    showMessage("success", `Headers refreshed from the latest capture of Dealer ${profile.dealerId || profile.id}`);
  }, [latestCapture, selectedDealerProfileId, showMessage]);

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
        const nextCapture = loadLatestExtensionCapture() as ExtendedArcCaptureState;

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

  // Blueprint Decode Bot: auto-fetch + decode Parts/Service/Accounting
  // blueprints for whichever dealer was just selected. Bridges the two
  // separate "selected dealer" identities in this app - the profile here
  // only has dealerId/tenantName, while the blueprint APIs need the
  // matching StoreRecord's tekion_id - by looking up the Stores IndexedDB
  // for a record whose dealer_id matches. Fire-and-forget: never blocks or
  // fails the header-apply action above, and stays silent if no matching
  // store is found (not every profile will have one).
  const autoDecodeBlueprintsForProfile = useCallback(async (profile: ArcTekionProfile) => {
    const dealerId = profile.dealerId?.trim();
    if (!dealerId) return;

    try {
      const stores = await getStores();
      const store = stores.find((s) => s.dealer_id === dealerId);
      if (!store?.tekion_id) return;

      const results = await decodeBlueprintsForDealer(
        store.tekion_id,
        ALL_BLUEPRINT_MODULES,
        store.dba_name
      );

      if (results.length === 0) {
        showMessage("warning", `No blueprint forms found for Dealer ${dealerId} (Parts/Service/Accounting).`);
        return;
      }

      await Promise.all(
        results.map((item) => persistBlueprintDecodeResult(store.tekion_id, dealerId, item))
      );

      const totalMissingRequired = results.reduce((sum, r) => sum + r.missingRequiredCount, 0);
      const moduleSummary = results
        .map((r) => `${r.module} (${r.missingRequiredCount} required missing)`)
        .join(", ");
      // Lead with actual question titles, not just a count, so you don't have
      // to separately open Blueprint Decoder to find what's missing.
      const titleHint = results
        .flatMap((r) => r.missingRequiredTitles)
        .slice(0, 5)
        .join("; ");

      showMessage(
        totalMissingRequired > 0 ? "warning" : "success",
        `Blueprint Decode Bot: decoded ${results.length} form(s) for Dealer ${dealerId} - ${moduleSummary}.` +
          (titleHint ? ` Missing: ${titleHint}${totalMissingRequired > 5 ? "…" : ""}` : "")
      );
      lastFailedDecodeProfileRef.current = null;
    } catch (err: unknown) {
      logger.warn("Blueprint Decode Bot auto-fetch failed", err);
      showMessage(
        "warning",
        `Blueprint Decode Bot could not auto-fetch for Dealer ${dealerId}: ${
          err instanceof Error ? err.message : "unknown error"
        }`
      );
      // Remembered so a fresh extension capture (e.g. the token this failed
      // on getting re-captured) can retry automatically - see the effect
      // below - instead of requiring the dealer profile to be re-selected
      // by hand.
      lastFailedDecodeProfileRef.current = profile;
    }
  }, [showMessage]);

  // Retries the auto-decode above once new capture data comes in, but only
  // for the profile that actually failed - avoids re-decoding on every
  // unrelated token refresh.
  useEffect(() => {
    const unsubscribe = subscribeToExtensionCapture(() => {
      const pending = lastFailedDecodeProfileRef.current;
      if (!pending) return;
      lastFailedDecodeProfileRef.current = null;
      void autoDecodeBlueprintsForProfile(pending);
    });
    return () => unsubscribe();
  }, [autoDecodeBlueprintsForProfile]);

  /**
   * Mirrors Blueprint Decode Bot behavior for Accounting Bootstrap.
   *
   * The selected Dealer Profile is the source of truth:
   * - profile.dealerId identifies the Bootstrap tenant/dealer.
   * - profile.bootstrapHeaders authenticate the request.
   *
   * The result is saved into Bootstrap IndexedDB and then posted to
   * the existing backend validation snapshot endpoint.
   */
  const autoSyncAccountingBootstrapForProfile = useCallback(
    async (profile: ArcTekionProfile) => {
      const dealerId = profile.dealerId?.trim();

      if (!dealerId) {
        return;
      }

      const profileHeaderPairs = toKeyValuePairs(profile.bootstrapHeaders);

      const headers = profileHeaderPairs.reduce<Record<string, string>>(
        (result, pair) => {
          const key = pair.key.trim();
          const value = pair.value.trim();

          if (pair.enabled && key && value) {
            result[key] = value;
          }

          return result;
        },
        {}
      );

      if (Object.keys(headers).length === 0) {
        logger.warn(
          "Bootstrap auto-sync skipped because selected profile has no headers",
          {
            dealerId,
            profileId: profile.id,
          }
        );
        return;
      }

      try {
        const result = await syncAccountingBootstrapForDealer({
          dealerId,
          dealerName: profile.tenantName || dealerId,
          headers,
        });

        const summary =
          `Bootstrap synced for Dealer ${dealerId}: ` +
          `${result.bootstrap.glAccounts.length} GL account(s), ` +
          `${result.bootstrap.costCenterSetup.length} cost-center field(s), ` +
          `${result.bootstrap.journals.length} journal(s).`;

        if (result.serverWarning) {
          logger.warn("Bootstrap server snapshot warning", {
            dealerId,
            warning: result.serverWarning,
          });

          showMessage(
            "warning",
            `${summary} Local IndexedDB save succeeded. Server warning: ${result.serverWarning}`
          );
          return;
        }

        showMessage("success", summary);
      } catch (error: unknown) {
        logger.warn("Bootstrap auto-sync failed", {
          dealerId,
          error,
        });

        showMessage(
          "warning",
          `Bootstrap auto-sync failed for Dealer ${dealerId}: ${
            error instanceof Error ? error.message : "unknown error"
          }`
        );
      }
    },
    [showMessage]
  );

  const handleSelectDealerProfile = useCallback(
    (profile: ArcTekionProfile) => {
      const pairs = toKeyValuePairs(profile.bootstrapHeaders);
      setSelectedDealerProfileId(profile.id);
      saveSelectedDealerProfileId(profile.id);
      try {
        localStorage.setItem(SELECTED_PROFILE_APPLIED_AT_KEY, profile.capturedAt);
      } catch {
        /* storage unavailable: the sync below simply re-applies on next load */
      }
      setGlobalHeaders(pairs);
      saveGlobalHeaders(pairs);
      showMessage("success", `Applied ${pairs.length} headers from Dealer ${profile.dealerId}`);

      // Run both automations using the currently selected dealer profile.
      // Neither blocks the UI or prevents the other workflow from finishing.
      void autoDecodeBlueprintsForProfile(profile);
      void autoSyncAccountingBootstrapForProfile(profile);
    },
    [
      showMessage,
      autoDecodeBlueprintsForProfile,
      autoSyncAccountingBootstrapForProfile,
    ]
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

  const slackToken = latestCapture?.slackToken ?? "";
  const slackDCookie = latestCapture?.slackDCookie ?? "";
  const lastSlackCaptureAt = latestCapture?.lastSlackCaptureAt;
  const lastSlackSourceUrl = latestCapture?.lastSlackSourceUrl;
  const hasSlackToken = Boolean(slackToken);
  const hasSlackCookie = Boolean(slackDCookie);
  const isSlackActive = hasSlackToken && hasSlackCookie;
  const isSlackPartial = !isSlackActive && (hasSlackToken || hasSlackCookie);

  const copySlackCurlTemplate = useCallback(
    (endpoint: "conversations.open" | "chat.postMessage") => {
      const curlSnippet =
        endpoint === "conversations.open"
          ? `curl --url 'https://tekion.enterprise.slack.com/api/conversations.open' \\
  -H 'accept: */*' \\
  -b 'd=${encodeURIComponent(slackDCookie)}' \\
  -F 'token=${slackToken}' \\
  -F 'users=U0694AQFMGQ' \\
  -F '_x_sonic=true' \\
  -F '_x_app_name=client'`
          : `curl --url 'https://tekion.enterprise.slack.com/api/chat.postMessage' \\
  -H 'accept: */*' \\
  -b 'd=${encodeURIComponent(slackDCookie)}' \\
  -F 'token=${slackToken}' \\
  -F 'channel=D0694BGT61W' \\
  -F 'text=Hello from ARC integration' \\
  -F '_x_sonic=true' \\
  -F '_x_app_name=client'`;

      handleCopy(curlSnippet, `curl (${endpoint})`);
    },
    [slackDCookie, slackToken, handleCopy]
  );

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

        {renderSidebarButton("toc", "🎯 TOC API (Default)")}
        {renderSidebarButton("tokens", "🔐 API Tokens", tokensAreDirty)}
        {renderSidebarButton("slack", "💬 Slack Session")}
        {renderSidebarButton("assignees", "👥 Assignees")}
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

            {/* TAB: TOC API */}
            {activeTab === "toc" && (
              <section className="section-card">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 14,
                    flexWrap: "wrap",
                    marginBottom: 18,
                  }}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <h2 style={{ fontSize: 22, margin: 0 }}>TOC API (Default Profile)</h2>
                      <span
                        className="ui-pill"
                        style={{
                          background: tocCapture
                            ? "rgba(34, 197, 94, 0.15)"
                            : "rgba(245, 158, 11, 0.15)",
                          border: `1px solid ${
                            tocCapture
                              ? "rgba(34, 197, 94, 0.3)"
                              : "rgba(245, 158, 11, 0.3)"
                          }`,
                          color: tocCapture ? "#86efac" : "#fde68a",
                          fontWeight: 700,
                        }}
                      >
                        {tocCapture ? "● Auto-Selected Default" : "○ Not Captured Yet"}
                      </span>
                    </div>
                    <p style={{ color: "#94a3b8", margin: "6px 0 0", fontSize: 13 }}>
                      Primary user profile endpoint: <code>{TOC_API_ENDPOINT}</code>
                    </p>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      className="btn-secondary btn-sm"
                      type="button"
                      onClick={() => requestLatestCaptureFromExtension()}
                    >
                      🔄 Re-Sync From Extension
                    </button>
                    {tocCapture && (
                      <button
                        className="btn-postman btn-sm"
                        type="button"
                        onClick={() => setShowTocDetails((prev) => !prev)}
                      >
                        {showTocDetails ? "Hide TOC API Data" : "Inspect TOC API Data"}
                      </button>
                    )}
                  </div>
                </div>

                {tocCapture ? (
                  <div style={{ display: "grid", gap: 14 }}>
                    <div
                      className="compact-card"
                      style={{
                        background: "rgba(56, 189, 248, 0.04)",
                        border: "1px solid rgba(56, 189, 248, 0.25)",
                        display: "grid",
                        gap: 10,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ color: "#f8fafc", fontSize: 15, fontWeight: 800 }}>
                            {tocCapture.label || "TOC User Profile API"}
                          </div>
                          <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 2 }}>
                            {tocCapture.matchedUrl || tocCapture.pattern}
                          </div>
                        </div>

                        <button
                          className="btn-secondary btn-sm"
                          type="button"
                          onClick={() => applySelectedHeadersToGlobal(toKeyValuePairs(tocCapture.headers), "TOC API")}
                        >
                          Copy All Headers to Global
                        </button>
                      </div>

                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                        <span className="ui-pill">
                          <span style={{ color: "#94a3b8" }}>Captured At</span>
                          <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{formatSavedAt(tocCapture.capturedAt)}</span>
                        </span>
                        <span className="ui-pill">
                          <span style={{ color: "#94a3b8" }}>Last Seen</span>
                          <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{formatSavedAt(tocCapture.lastSeenAt)}</span>
                        </span>
                        <span className="ui-pill">
                          <span style={{ color: "#94a3b8" }}>Token Expires</span>
                          <span
                            style={{
                              color: tocCapture.decodedToken?.isExpired ? "#fca5a5" : "#86efac",
                              fontWeight: 600,
                            }}
                          >
                            {tocCapture.decodedToken?.expiresAt
                              ? formatSavedAt(tocCapture.decodedToken.expiresAt)
                              : "Unknown"}
                          </span>
                        </span>
                      </div>
                    </div>

                    {showTocDetails && (
                      <div style={{ marginTop: 8 }}>
                        <SelectableHeaderMap
                          title="TOC API Captured Request Headers"
                          headers={tocCapture.headers}
                          capturedAt={tocCapture.capturedAt}
                          sourceUrl={tocCapture.matchedUrl}
                          applyButtonLabel="Apply Selected Headers"
                          onApplySelected={(pairs) => applySelectedHeadersToGlobal(pairs, "TOC API")}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    className="compact-card"
                    style={{
                      background: "rgba(245, 158, 11, 0.06)",
                      border: "1px solid rgba(245, 158, 11, 0.25)",
                      padding: 20,
                      display: "grid",
                      gap: 12,
                    }}
                  >
                    <div style={{ color: "#fde68a", fontSize: 14, fontWeight: 700 }}>
                      ⚠ TOC API has not been intercepted yet
                    </div>
                    <p style={{ color: "#94a3b8", fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                      To automatically capture this API without manual configuration, simply open or reload
                      TAP Workorders in another browser tab:
                    </p>
                    <div>
                      <a
                        href="https://tap.tekioncloud.com/workorders/list"
                        target="_blank"
                        rel="noreferrer"
                        className="btn-postman"
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
                      >
                        Open TAP Workorders ↗
                      </a>
                    </div>
                    <div style={{ color: "#64748b", fontSize: 12 }}>
                      Once opened, the ARC extension automatically captures <code>/tapapi/v2/usermanagement/getuserprofile</code> and
                      applies it as the default Stores profile.
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* TAB: TOKENS */}
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

            {/* TAB: SLACK SESSION */}
            {activeTab === "slack" && (
              <section className="section-card">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14, flexWrap: "wrap", marginBottom: 18 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <h2 style={{ fontSize: 22, margin: 0 }}>Tekion Slack Workspace Session</h2>
                      <span
                        className="ui-pill"
                        style={{
                          background: isSlackActive
                            ? "rgba(34, 197, 94, 0.15)"
                            : isSlackPartial
                            ? "rgba(245, 158, 11, 0.15)"
                            : "rgba(239, 68, 68, 0.15)",
                          border: `1px solid ${
                            isSlackActive
                              ? "rgba(34, 197, 94, 0.3)"
                              : isSlackPartial
                              ? "rgba(245, 158, 11, 0.3)"
                              : "rgba(239, 68, 68, 0.3)"
                          }`,
                          color: isSlackActive ? "#86efac" : isSlackPartial ? "#fde68a" : "#fca5a5",
                          fontWeight: 700,
                        }}
                      >
                        {isSlackActive ? "● Active & Synced" : isSlackPartial ? "◐ Partially Detected" : "○ Not Detected"}
                      </span>
                    </div>
                    <p style={{ color: "#94a3b8", margin: "6px 0 0", fontSize: 13 }}>
                      Credentials are automatically intercepted by the ARC Helper background script whenever Slack reloads or calls an API.
                    </p>
                  </div>

                  <button
                    className="btn-secondary btn-sm"
                    type="button"
                    onClick={() => requestLatestCaptureFromExtension()}
                  >
                    🔄 Re-Sync From Extension
                  </button>
                </div>

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
                  <span className="ui-pill">
                    <span style={{ color: "#94a3b8" }}>Last Captured</span>
                    <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{formatSavedAt(lastSlackCaptureAt)}</span>
                  </span>
                  {lastSlackSourceUrl && (
                    <span className="ui-pill">
                      <span style={{ color: "#94a3b8" }}>Source</span>
                      <code className="st-req-url">{lastSlackSourceUrl}</code>
                    </span>
                  )}
                </div>

                <div style={{ display: "grid", gap: 18 }}>
                  {/* Slack Token (xoxc) */}
                  <div className="compact-card" style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontWeight: 700, color: "#f8fafc", fontSize: 14 }}>
                        Slack Client Token (<code>token</code> / <code>xoxc-...</code>)
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="btn-secondary btn-sm"
                          type="button"
                          onClick={() => setHideSlackToken((prev) => !prev)}
                        >
                          {hideSlackToken ? "👁 Show" : "🙈 Hide"}
                        </button>
                        <button
                          className="btn-secondary btn-sm"
                          type="button"
                          onClick={() => handleCopy(slackToken, "Slack Token")}
                          disabled={!slackToken}
                        >
                          📋 Copy Token
                        </button>
                      </div>
                    </div>
                    <SecretTextArea
                      value={slackToken}
                      hidden={hideSlackToken}
                      rows={3}
                      placeholder="No Slack xoxc token detected yet. Open or reload your Slack tab."
                      onChange={() => {}}
                    />
                  </div>

                  {/* Slack d Cookie */}
                  <div className="compact-card" style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div style={{ fontWeight: 700, color: "#f8fafc", fontSize: 14 }}>
                        Slack Session Cookie (<code>Cookie: d=...</code> / <code>xoxd-...</code>)
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          className="btn-secondary btn-sm"
                          type="button"
                          onClick={() => setHideSlackCookie((prev) => !prev)}
                        >
                          {hideSlackCookie ? "👁 Show" : "🙈 Hide"}
                        </button>
                        <button
                          className="btn-secondary btn-sm"
                          type="button"
                          onClick={() => handleCopy(slackDCookie, "Slack 'd' Cookie Value")}
                          disabled={!slackDCookie}
                        >
                          📋 Copy Value
                        </button>
                        <button
                          className="btn-secondary btn-sm"
                          type="button"
                          onClick={() => handleCopy(`Cookie: d=${encodeURIComponent(slackDCookie)}`, "Full Cookie Header")}
                          disabled={!slackDCookie}
                        >
                          📋 Copy Header
                        </button>
                      </div>
                    </div>
                    <SecretTextArea
                      value={slackDCookie}
                      hidden={hideSlackCookie}
                      rows={3}
                      placeholder="No Slack 'd' cookie detected yet. Open or reload your Slack tab."
                      onChange={() => {}}
                    />
                  </div>

                  {/* Quick Code & curl Templates */}
                  <div className="compact-card" style={{ display: "grid", gap: 10 }}>
                    <div style={{ fontWeight: 700, color: "#f8fafc", fontSize: 14 }}>
                      Quick Automation Templates (1-Click Copy)
                    </div>
                    <p style={{ margin: 0, color: "#94a3b8", fontSize: 12 }}>
                      Templates pre-populate with the captured session credentials for instant terminal testing:
                    </p>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                      <button
                        className="btn-secondary btn-sm"
                        type="button"
                        onClick={() => copySlackCurlTemplate("conversations.open")}
                        disabled={!isSlackActive}
                      >
                        📋 Copy curl: conversations.open (Get DM Channel)
                      </button>
                      <button
                        className="btn-secondary btn-sm"
                        type="button"
                        onClick={() => copySlackCurlTemplate("chat.postMessage")}
                        disabled={!isSlackActive}
                      >
                        📋 Copy curl: chat.postMessage (Send DM)
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* TAB: ASSIGNEES */}
            {activeTab === "assignees" && <AssigneeSettingsPanel />}

            {/* TAB: DEALER PROFILES */}
            {activeTab === "profiles" && (
              <section className="section-card">
                <div style={{ marginBottom: 16 }}>
                  <input
                    className="st-input"
                    type="text"
                    placeholder="Search dealer ID, tenant name, or site ID..."
                    value={dealerSearchQuery}
                    onChange={(e) => setDealerSearchQuery(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                  <div style={{ color: "#94a3b8", fontSize: 12 }}>
                    {staleProfileCount} profile(s) older than 48h. The selected profile is never removed.
                  </div>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={staleProfileCount === 0}
                    style={{
                      padding: "8px 14px",
                      fontWeight: 700,
                      color: staleProfileCount === 0 ? "#64748b" : "#fca5a5",
                      border: `1px solid ${staleProfileCount === 0 ? "rgba(148,163,184,0.2)" : "rgba(248,113,113,0.5)"}`,
                      background: staleProfileCount === 0 ? "transparent" : "rgba(248,113,113,0.12)",
                      borderRadius: 8,
                      cursor: staleProfileCount === 0 ? "not-allowed" : "pointer",
                    }}
                    onClick={async () => {
                      if (!window.confirm(`Remove ${staleProfileCount} expired dealer profile(s)? The selected profile is kept.`)) return;
                      const removed = await removeStaleDealerProfiles(selectedDealerProfileId ?? undefined);
                      showMessage("success", `Removed ${removed} expired dealer profile(s).`);
                    }}
                  >
                    Remove expired profiles
                  </button>
                </div>
                <div style={{ display: "grid", gap: 16 }}>
                  {filteredProfiles.map((profile) => (
                    <DealerProfileCard
                      key={profile.id}
                      profile={profile}
                      isSelected={selectedDealerProfileId === profile.id}
                      onSelect={handleSelectDealerProfile}
                    />
                  ))}
                  {filteredProfiles.length === 0 && (
                    <div style={{ color: "#94a3b8", textAlign: "center", padding: 20 }}>
                      No dealer profiles match your search.
                    </div>
                  )}
                </div>
              </section>
            )}

            {/* TAB: GLOBAL HEADERS */}
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

            {/* TAB: EXTENSION DATA */}
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
                          isTocApi={
                            capture.pattern.toLowerCase().includes("getuserprofile") ||
                            capture.matchedUrl.toLowerCase().includes("getuserprofile")
                          }
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