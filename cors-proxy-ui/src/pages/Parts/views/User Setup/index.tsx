import React, { useEffect, useMemo, useState, useCallback } from "react";
import { loadTekionApiSettingsBundle } from "../../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../../types/proxy.types";
import "./UserResetView.css";
import { loadLatestExtensionCapture } from "../../../../services/extensionBridge";
import {
  ENTERPRISE_FALLBACK_PASSWORD,
  ENTERPRISE_PRIMARY_PASSWORD,
  enterpriseRecordsToCsv,
  enterpriseUserName,
  resolveEnterpriseHeaders,
  fetchAllEnterpriseUsers,
  resetEnterpriseUser,
  type EnterpriseResetRecord,
  type EnterpriseUser,
} from "./enterpriseReset";


const MODULE_NAME = "User Reset";
const USERS_AND_ROLES_URL =
  "https://preprodapp.tekioncloud.com/api/userservice/u/v2/userandroles?locale=en_US";
const UPDATE_PASSWORD_URL =
  "https://preprodapp.tekioncloud.com/api/userservice/u/v2/updatePassword?locale=en_US";

type ViewMode = "home" | "reset-all" | "reset-by-role" | "enterprise";
type RunState = "idle" | "loading" | "success" | "error" | "warning";

// Must meet the preprod password policy (needs a special character). "Happyday1" is rejected; "Happyday1@" succeeded.
const DEFAULT_PASSWORD = "Happyday1@";

const logger = {
  debug: (...args: unknown[]) => console.debug("[Parts][UserReset]", ...args),
  info: (...args: unknown[]) => console.info("[Parts][UserReset]", ...args),
  warn: (...args: unknown[]) => console.warn("[Parts][UserReset]", ...args),
  error: (...args: unknown[]) => console.error("[Parts][UserReset]", ...args),
};

interface UserRoleDetail {
  roleName?: string | null;
}

interface UserRecord {
  id: string;
  displayName?: string | null;
  fname?: string | null;
  lname?: string | null;
  email?: string | null;
  active?: boolean | null;
  type?: number | null;
  userRoleDetails?: UserRoleDetail[] | null;
}

interface UsersAndRolesResponse {
  data?: {
    userAndRoleResponses?: UserRecord[];
  };
}

interface RoleOption {
  roleName: string;
  users: UserRecord[];
}

interface PasswordResetError {
  userId: string;
  displayName: string;
  error: string;
}

interface PasswordResetResult {
  total: number;
  success: number;
  failed: number;
  errors: PasswordResetError[];
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

function getEnabledGlobalHeaders(): Record<string, string> {
  const bundle = loadTekionApiSettingsBundle();

  const headers = (bundle.globalHeaders ?? [])
    .filter(
      (header: KeyValuePair) =>
        header.enabled && header.key.trim() && String(header.value).trim()
    )
    .reduce<Record<string, string>>((acc, header) => {
      acc[header.key] = String(header.value);
      return acc;
    }, {});

  logger.info("loaded global headers from settings", {
    count: Object.keys(headers).length,
    keys: Object.keys(headers),
  });

  return headers;
}

function buildUsersFetchPayload() {
  const payload = {
    sort: [],
    filters: [
      {
        field: "active",
        operator: "IN",
        values: [true],
        key: "active",
      },
      {
        field: "type",
        operator: "IN",
        values: [2],
        key: "type",
      },
    ],
    searchText: "",
    groupBy: [],
    includeFields: [],
    searchableFields: [],
    excludeFields: [],
    pageInfo: {
      start: 0,
      rows: 200,
    },
  };

  logger.debug("built users fetch payload", payload);
  return payload;
}

function getDisplayName(user: UserRecord): string {
  return (
    normalizeText(user.displayName) ||
    `${normalizeText(user.fname)} ${normalizeText(user.lname)}`.trim() ||
    normalizeText(user.email) ||
    user.id
  );
}

async function fetchUsersAndRoles(headers: Record<string, string>): Promise<UserRecord[]> {
  const requestHeaders = {
    ...headers,
    "content-type": "application/json",
  };

  const payload = buildUsersFetchPayload();

  logger.info("fetching active employee users and roles", {
    url: USERS_AND_ROLES_URL,
    headerKeys: Object.keys(requestHeaders),
  });

  const response = await fetch(USERS_AND_ROLES_URL, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(payload),
  });

  logger.info("users and roles response received", {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("failed to fetch users and roles", {
      status: response.status,
      errorText,
    });
    throw new Error(`Failed to fetch users: ${response.status} - ${errorText.substring(0, 160)}`);
  }

  const json = (await response.json()) as UsersAndRolesResponse;
  logger.debug("users and roles response json", json);

  const users = json.data?.userAndRoleResponses ?? [];

  logger.info("fetched active employee users", {
    count: users.length,
  });

  return users;
}

function buildRoleOptions(users: UserRecord[]): RoleOption[] {
  const roleMap = new Map<string, UserRecord[]>();

  users.forEach((user) => {
    (user.userRoleDetails ?? []).forEach((roleDetail) => {
      const roleName = normalizeText(roleDetail.roleName);
      if (!roleName) return;

      if (!roleMap.has(roleName)) {
        roleMap.set(roleName, []);
      }

      roleMap.get(roleName)?.push(user);
    });
  });

  const result = Array.from(roleMap.entries())
    .map(([roleName, roleUsers]) => ({
      roleName,
      users: roleUsers,
    }))
    .sort((a, b) => a.roleName.localeCompare(b.roleName));

  logger.info("built role options", {
    roleCount: result.length,
    roles: result.map((role) => ({
      roleName: role.roleName,
      userCount: role.users.length,
    })),
  });

  return result;
}

async function updatePasswordForUser(
  userId: string,
  password: string,
  headers: Record<string, string>
): Promise<void> {
  const requestHeaders = {
    ...headers,
    "content-type": "application/json",
  };

  const payload = { userId, password };

  logger.debug("sending update password request", {
    userId,
    url: UPDATE_PASSWORD_URL,
  });

  const response = await fetch(UPDATE_PASSWORD_URL, {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error("update password failed", {
      userId,
      status: response.status,
      errorText,
    });
    throw new Error(errorText.substring(0, 160) || `HTTP ${response.status}`);
  }

  logger.debug("update password succeeded", { userId });
}

export const UserResetView: React.FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>("home");
  const [runState, setRunState] = useState<RunState>("idle");
  const [statusText, setStatusText] = useState("Ready");
  const [errorText, setErrorText] = useState("");
  const [lastRunAt, setLastRunAt] = useState("");

  const [allUsers, setAllUsers] = useState<UserRecord[]>([]);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);
  const [selectedRoleNames, setSelectedRoleNames] = useState<string[]>([]);

  const [passwordForAll, setPasswordForAll] = useState(DEFAULT_PASSWORD);
  const [passwordByRole, setPasswordByRole] = useState(DEFAULT_PASSWORD);

  const [resetResults, setResetResults] = useState<PasswordResetResult | null>(null);
  const [progressText, setProgressText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Option 3 (Enterprise)
  const [enterpriseUsers, setEnterpriseUsers] = useState<EnterpriseUser[]>([]);
  const [enterpriseTotal, setEnterpriseTotal] = useState(0);
  const [enterpriseRecords, setEnterpriseRecords] = useState<EnterpriseResetRecord[]>([]);
  const [enterpriseBusy, setEnterpriseBusy] = useState(false);
  const [enterpriseProgress, setEnterpriseProgress] = useState("");
  const [enterpriseError, setEnterpriseError] = useState("");

  const resolveEnterprise = () =>
    resolveEnterpriseHeaders(loadLatestExtensionCapture()?.customCaptures, getEnabledGlobalHeaders());

  const handleLoadEnterpriseUsers = async (): Promise<void> => {
    const headers = resolveEnterprise().headers;
    if (Object.keys(headers).length === 0) {
      setEnterpriseError("No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers.");
      return;
    }
    setEnterpriseBusy(true);
    setEnterpriseError("");
    try {
      const users = await fetchAllEnterpriseUsers(headers, (loaded, total) =>
        setEnterpriseProgress(`Loading enterprise users... ${loaded}/${total}`)
      );
      setEnterpriseUsers(users);
      setEnterpriseTotal(users.length);
      setEnterpriseProgress("");
      logger.info("enterprise users loaded", { count: users.length });
    } catch (error: unknown) {
      setEnterpriseError(error instanceof Error ? error.message : String(error));
    } finally {
      setEnterpriseBusy(false);
    }
  };

  // Users grouped by home dealer, for the dealer picker.
  const enterpriseDealerGroups = useMemo(() => {
    const map = new Map<string, { dealerId: string; dealerName: string; users: EnterpriseUser[] }>();
    enterpriseUsers.forEach((u) => {
      const dealerId = String(u.homeDealerId ?? "").trim() || "(no home dealer)";
      if (!map.has(dealerId)) {
        map.set(dealerId, { dealerId, dealerName: "", users: [] });
      }
      const group = map.get(dealerId)!;
      if (!group.dealerName) group.dealerName = u.dealer?.[0]?.label ?? "";
      group.users.push(u);
    });
    return Array.from(map.values()).sort((a, b) => b.users.length - a.users.length);
  }, [enterpriseUsers]);

  const [enterpriseDialogOpen, setEnterpriseDialogOpen] = useState(false);
  const [enterpriseSelectedDealers, setEnterpriseSelectedDealers] = useState<string[]>([]);
  const [enterpriseDealerSearch, setEnterpriseDealerSearch] = useState("");
  const [enterpriseTestResults, setEnterpriseTestResults] = useState<Record<string, string>>({});

  const selectedEnterpriseUserCount = enterpriseDealerGroups
    .filter((g) => enterpriseSelectedDealers.includes(g.dealerId))
    .reduce((acc, g) => acc + g.users.length, 0);

  const handleTestOneDealer = async (dealerId: string): Promise<void> => {
    const base = resolveEnterprise().headers;
    const group = enterpriseDealerGroups.find((g) => g.dealerId === dealerId);
    const user = group?.users[0];
    if (!user) return;
    if (!window.confirm(`Test reset on ONE user from dealer ${dealerId}: ${enterpriseUserName(user)}?\n\nThis changes that user's password.`)) return;

    setEnterpriseTestResults((prev) => ({ ...prev, [dealerId]: "Testing..." }));
    const record = await resetEnterpriseUser(user, base);
    setEnterpriseRecords((prev) => [...prev, record]);
    setEnterpriseTestResults((prev) => ({
      ...prev,
      [dealerId]: record.status === "success"
        ? `✅ ${enterpriseUserName(user)} reset (${record.passwordUsed})`
        : `❌ ${record.finalError}`,
    }));
    logger.info("enterprise dealer test", { dealerId, userId: user.id, status: record.status });
  };

  const handleRunSelectedEnterpriseDealers = async (): Promise<void> => {
    const base = resolveEnterprise().headers;
    const users = enterpriseDealerGroups
      .filter((g) => enterpriseSelectedDealers.includes(g.dealerId))
      .flatMap((g) => g.users);
    if (users.length === 0) return;
    if (!window.confirm(`Reset passwords for ${users.length} users across ${enterpriseSelectedDealers.length} dealer(s)?\n\nDefault "${ENTERPRISE_PRIMARY_PASSWORD}", special-character retry "${ENTERPRISE_FALLBACK_PASSWORD}".`)) return;

    setEnterpriseDialogOpen(false);
    setEnterpriseBusy(true);
    setEnterpriseError("");
    setEnterpriseRecords([]);
    const records: EnterpriseResetRecord[] = [];
    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const dealerId = String(user.homeDealerId ?? "");
      setEnterpriseProgress(`Resetting ${i + 1}/${users.length} (dealer ${dealerId}): ${enterpriseUserName(user)}`);
      const record = await resetEnterpriseUser(user, base);
      records.push(record);
      setEnterpriseRecords([...records]);
      // Log only ids, names and results. Passwords are not written to the console.
      logger.info("enterprise reset", { userId: user.id, dealerId, status: record.status });
    }
    setEnterpriseProgress("");
    setEnterpriseBusy(false);
    setLastRunAt(new Date().toLocaleString());
  };

  const downloadEnterpriseCsv = (): void => {
    const blob = new Blob(["﻿" + enterpriseRecordsToCsv(enterpriseRecords)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `enterprise-password-reset-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const enterpriseSuccess = enterpriseRecords.filter((r) => r.status === "success").length;
  const enterpriseFailed = enterpriseRecords.filter((r) => r.status === "failed").length;

  useEffect(() => {
    logger.info("component mounted");
    return () => logger.info("component unmounted");
  }, []);

  const handleLoadRoles = useCallback(async (): Promise<void> => {
    logger.info("load roles requested");
    setIsLoadingRoles(true);
    setRunState("loading");
    setStatusText("Loading active employee users and roles...");
    setErrorText("");
    setProgressText("");
    setResetResults(null);

    try {
      const headers = getEnabledGlobalHeaders();

      if (Object.keys(headers).length === 0) {
        logger.warn("global headers missing before role load");
        setRunState("error");
        setStatusText("Global headers are missing");
        setErrorText(
          "No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers."
        );
        return;
      }

      const users = await fetchUsersAndRoles(headers);
      const roles = buildRoleOptions(users);

      setAllUsers(users);
      setRoleOptions(roles);
      setSelectedRoleNames([]);

      if (users.length === 0) {
        setRunState("warning");
        setStatusText("No active employee users found");
        logger.warn("no active employee users found");
      } else {
        setRunState("success");
        setStatusText(`Loaded ${users.length} active employee users across ${roles.length} roles`);
        logger.info("roles loaded successfully", {
          userCount: users.length,
          roleCount: roles.length,
        });
      }

      setLastRunAt(new Date().toLocaleString());
    } catch (error: unknown) {
      logger.error("load roles failed", error);
      setRunState("error");
      setStatusText("Failed to load roles");
      setErrorText(error instanceof Error ? error.message : String(error));
      setLastRunAt(new Date().toLocaleString());
    } finally {
      setIsLoadingRoles(false);
    }
  }, []);

  useEffect(() => {
    logger.info("view mode changed", { viewMode });
    setResetResults(null);
    setProgressText("");
    setErrorText("");
    setStatusText("Ready");

    if (viewMode === "reset-by-role" && roleOptions.length === 0 && !isLoadingRoles) {
      void handleLoadRoles();
    }
  }, [viewMode, roleOptions.length, isLoadingRoles, handleLoadRoles]);

  const selectedUsersByRole = useMemo(() => {
    const userIdMap = new Map<string, UserRecord>();

    selectedRoleNames.forEach((roleName) => {
      const role = roleOptions.find((item) => item.roleName === roleName);
      if (!role) return;

      role.users.forEach((user) => {
        userIdMap.set(user.id, user);
      });
    });

    const users = Array.from(userIdMap.values());

    logger.debug("selected users by role recalculated", {
      selectedRoleNames,
      uniqueUsersCount: users.length,
    });

    return users;
  }, [selectedRoleNames, roleOptions]);

  const selectedRoleCount = selectedRoleNames.length;
  const selectedUsersCount = selectedUsersByRole.length;

  const runPasswordReset = async (
    usersToUpdate: UserRecord[],
    newPassword: string,
    mode: "reset-all" | "reset-by-role"
  ): Promise<void> => {
    logger.info("password reset requested", {
      mode,
      userCount: usersToUpdate.length,
      passwordLength: newPassword.length,
    });

    setIsSubmitting(true);
    setRunState("loading");
    setStatusText(
      mode === "reset-all"
        ? "Resetting passwords for all active employee users..."
        : "Resetting passwords for selected roles..."
    );
    setErrorText("");
    setProgressText("");
    setResetResults(null);

    try {
      const headers = getEnabledGlobalHeaders();

      if (Object.keys(headers).length === 0) {
        logger.warn("global headers missing before password reset");
        setRunState("error");
        setStatusText("Global headers are missing");
        setErrorText(
          "No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers."
        );
        return;
      }

      const results: PasswordResetResult = {
        total: usersToUpdate.length,
        success: 0,
        failed: 0,
        errors: [],
      };

      for (let index = 0; index < usersToUpdate.length; index += 1) {
        const user = usersToUpdate[index];
        const displayName = getDisplayName(user);
        const current = index + 1;

        setProgressText(`Resetting passwords... (${current}/${usersToUpdate.length})`);

        logger.info("processing password reset for user", {
          current,
          total: usersToUpdate.length,
          userId: user.id,
          displayName,
        });

        try {
          await updatePasswordForUser(user.id, newPassword, headers);
          results.success += 1;
          logger.info("password reset succeeded for user", {
            userId: user.id,
            displayName,
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          results.failed += 1;
          results.errors.push({
            userId: user.id,
            displayName,
            error: message,
          });
          logger.error("password reset failed for user", {
            userId: user.id,
            displayName,
            error: message,
          });
        }
      }

      logger.info("password reset completed", results);
      setResetResults(results);
      setLastRunAt(new Date().toLocaleString());

      if (results.failed === 0) {
        setRunState("success");
        setStatusText(
          mode === "reset-all"
            ? `Password reset completed for all ${results.success} users`
            : `Password reset completed for ${results.success} selected users`
        );
      } else {
        setRunState("warning");
        setStatusText(
          `Password reset completed with partial failures. Success: ${results.success}, Failed: ${results.failed}`
        );
      }
    } catch (error: unknown) {
      logger.error("password reset flow failed", error);
      setRunState("error");
      setStatusText("Password reset failed");
      setErrorText(error instanceof Error ? error.message : String(error));
      setLastRunAt(new Date().toLocaleString());
    } finally {
      setIsSubmitting(false);
      setProgressText("");
    }
  };

  const handleResetAll = async (): Promise<void> => {
    logger.info("reset all button clicked", {
      passwordLength: passwordForAll.trim().length,
    });

    if (!passwordForAll.trim()) {
      logger.warn("reset all blocked because password is empty");
      setRunState("error");
      setStatusText("Password is required");
      setErrorText("Please enter a password.");
      return;
    }

    const confirmed = window.confirm(
      `⚠️ WARNING: This will reset passwords for ALL active employee users!\n\nNew Password: ${passwordForAll}\n\nUsers will be required to change their password on next login.\n\nDo you want to continue?`
    );

    if (!confirmed) {
      logger.info("reset all cancelled by user");
      return;
    }

    let users = allUsers;

    if (users.length === 0) {
      logger.info("all users cache empty, fetching before reset all");

      try {
        const headers = getEnabledGlobalHeaders();

        if (Object.keys(headers).length === 0) {
          setRunState("error");
          setStatusText("Global headers are missing");
          setErrorText(
            "No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers."
          );
          return;
        }

        users = await fetchUsersAndRoles(headers);
        setAllUsers(users);
        setRoleOptions(buildRoleOptions(users));
      } catch (error: unknown) {
        logger.error("failed to preload users before reset all", error);
        setRunState("error");
        setStatusText("Failed to fetch users before reset");
        setErrorText(error instanceof Error ? error.message : String(error));
        return;
      }
    }

    if (users.length === 0) {
      logger.warn("reset all aborted because no active employee users were found");
      setRunState("warning");
      setStatusText("No active employee users found");
      return;
    }

    await runPasswordReset(users, passwordForAll.trim(), "reset-all");
  };

  const handleResetByRole = async (): Promise<void> => {
    logger.info("reset by role button clicked", {
      selectedRoleCount,
      selectedUsersCount,
      passwordLength: passwordByRole.trim().length,
    });

    if (!passwordByRole.trim()) {
      logger.warn("reset by role blocked because password is empty");
      setRunState("error");
      setStatusText("Password is required");
      setErrorText("Please enter a password.");
      return;
    }

    if (selectedRoleNames.length === 0) {
      logger.warn("reset by role blocked because no roles selected");
      setRunState("error");
      setStatusText("No roles selected");
      setErrorText("Please select at least one role.");
      return;
    }

    if (selectedUsersByRole.length === 0) {
      logger.warn("reset by role blocked because no users resolved from selected roles");
      setRunState("warning");
      setStatusText("No users found for selected roles");
      return;
    }

    const confirmed = window.confirm(
      `⚠️ WARNING: This will reset passwords for users with the selected roles!\n\nSelected Roles: ${selectedRoleNames.join(", ")}\nTotal Users: ${selectedUsersByRole.length}\nNew Password: ${passwordByRole}\n\nUsers will be required to change their password on next login.\n\nDo you want to continue?`
    );

    if (!confirmed) {
      logger.info("reset by role cancelled by user");
      return;
    }

    await runPasswordReset(selectedUsersByRole, passwordByRole.trim(), "reset-by-role");
  };

  return (
    <div style={{ display: "grid", gap: 20, minWidth: 0, fontFamily: "system-ui, sans-serif" }}>
      <div
        className="ui-glass-panel"
        style={{
          borderRadius: 20,
          border: "1px solid rgba(255,255,255,0.1)",
          background: "linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
          padding: 24,
          minWidth: 0,
          boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 16,
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 28,
                fontWeight: 800,
                color: "#f8fafc",
                marginBottom: 8,
                wordBreak: "break-word",
                letterSpacing: "-0.02em",
              }}
            >
              User Reset
            </div>

            <div
              style={{
                color: "#94a3b8",
                fontSize: 15,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              Reset user passwords for all active employee users or for selected roles. Uses active
              Global Headers from Settings.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button
              className={viewMode === "home" ? "btn-postman ui-btn-active" : "btn-secondary btn-sm ui-btn"}
              type="button"
              onClick={() => setViewMode("home")}
            >
              Home
            </button>

            <button
              className={viewMode === "reset-all" ? "btn-postman ui-btn-active" : "btn-secondary btn-sm ui-btn"}
              type="button"
              onClick={() => setViewMode("reset-all")}
            >
              Option 1
            </button>

            <button
              className={viewMode === "reset-by-role" ? "btn-postman ui-btn-active" : "btn-secondary btn-sm ui-btn"}
              type="button"
              onClick={() => setViewMode("reset-by-role")}
            >
              Option 2
            </button>

            <button
              className={viewMode === "enterprise" ? "btn-postman ui-btn-active" : "btn-secondary btn-sm ui-btn"}
              type="button"
              onClick={() => setViewMode("enterprise")}
            >
              Option 3 (Enterprise)
            </button>

            <div
              style={{
                width: 1,
                height: 24,
                background: "rgba(255,255,255,0.1)",
                margin: "0 4px",
              }}
            />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
          <Pill label="Module" value={MODULE_NAME} />
          <Pill
            label="Mode"
            value={
              viewMode === "reset-by-role"
                ? "By Role"
                : viewMode === "reset-all"
                ? "All Users"
                : viewMode === "enterprise"
                ? "Enterprise"
                : "Home"
            }
          />
          <Pill label="Users Loaded" value={String(allUsers.length)} />
          <Pill label="Roles Loaded" value={String(roleOptions.length)} />
          <Pill label="Selected Roles" value={String(selectedRoleCount)} />
          <Pill label="Selected Users" value={String(selectedUsersCount)} />
          {lastRunAt ? <Pill label="Last Run" value={lastRunAt} /> : null}
        </div>

        <div
          className="ui-status-bar"
          style={{
            borderRadius: 12,
            padding: "14px 18px",
            fontSize: 14,
            lineHeight: 1.6,
            transition: "all 0.3s ease",
            border:
              runState === "error"
                ? "1px solid rgba(239,68,68,0.3)"
                : runState === "success"
                ? "1px solid rgba(34,197,94,0.3)"
                : runState === "warning"
                ? "1px solid rgba(245,158,11,0.3)"
                : "1px solid rgba(255,255,255,0.1)",
            background:
              runState === "error"
                ? "rgba(239,68,68,0.15)"
                : runState === "success"
                ? "rgba(34,197,94,0.15)"
                : runState === "warning"
                ? "rgba(245,158,11,0.15)"
                : "rgba(255,255,255,0.03)",
            color:
              runState === "error"
                ? "#fecaca"
                : runState === "success"
                ? "#bbf7d0"
                : runState === "warning"
                ? "#fde68a"
                : "#cbd5e1",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: errorText ? 4 : 0 }}>
            {runState === "loading" ? "⏳ " : ""}
            {statusText}
          </div>

          {errorText ? <div style={{ opacity: 0.9 }}>{errorText}</div> : null}
          {progressText ? (
            <div style={{ marginTop: 8, fontStyle: "italic", opacity: 0.8 }}>{progressText}</div>
          ) : null}
        </div>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: "100%",
          justifySelf: "center",
          display: "grid",
          gap: 20,
          minWidth: 0,
          transition: "width 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {viewMode === "home" ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 20,
            }}
          >
            <ActionCard
              icon="🔐"
              title="Option 1: Reset ALL Users"
              description="Reset passwords for all active employee users (Type 2) in the system in a single batch operation."
              buttonLabel="Open Option 1"
              onClick={() => {
                logger.info("home action clicked", { action: "reset-all" });
                setViewMode("reset-all");
              }}
            />

            <ActionCard
              icon="👥"
              title="Option 2: Reset by Role"
              description="Selectively target one or more roles and reset passwords exclusively for users associated with those specific roles."
              buttonLabel="Open Option 2"
              onClick={() => {
                logger.info("home action clicked", { action: "reset-by-role" });
                setViewMode("reset-by-role");
              }}
            />
          </div>
        ) : null}

        {viewMode === "reset-all" ? (
          <>
            <SectionCard title="Option 1: Reset ALL User Passwords">
              <div style={infoBlockStyle}>
                Reset passwords for all active employee users (Type 2) in the system.
              </div>

              <Field
                label="New Password"
                value={passwordForAll}
                placeholder="Enter new password"
                onChange={(value) => {
                  logger.debug("reset all password input changed", { length: value.length });
                  setPasswordForAll(value);
                }}
                hint="This password will be set for all active employee users"
              />

              <div style={warningBlockStyle}>
                <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 15 }}>⚠️ Warning</div>
                <div style={{ lineHeight: 1.7 }}>
                  This will reset passwords for ALL active employee users (Type 2). Users will be
                  required to change their password on next login.
                </div>
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
                <button
                  className="btn-secondary ui-btn"
                  type="button"
                  onClick={() => {
                    void handleLoadRoles();
                  }}
                  disabled={isLoadingRoles || isSubmitting}
                >
                  {isLoadingRoles ? "Loading Users..." : "↻ Refresh Active Users"}
                </button>

                <button
                  className="btn-postman ui-btn-primary"
                  type="button"
                  onClick={() => {
                    void handleResetAll();
                  }}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Resetting..." : "🔐 Reset All User Passwords"}
                </button>
              </div>
            </SectionCard>

            <SectionCard title="Reset All Snapshot">
              <RowLine left="Loaded Active Users" right={String(allUsers.length)} />
              <RowLine left="New Password Length" right={String(passwordForAll.length)} />
              <RowLine
                left="Submitting Status"
                right={isSubmitting ? "In Progress" : "Idle"}
                rightColor={isSubmitting ? "#fde68a" : "#86efac"}
              />
            </SectionCard>
          </>
        ) : null}

        {viewMode === "reset-by-role" ? (
          <>
            <SectionCard title="Option 2: Reset Passwords by Role">
              <div style={infoBlockStyle}>
                Select one or more roles and reset passwords only for users with those roles.
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <button
                  className="btn-secondary ui-btn"
                  type="button"
                  onClick={() => {
                    void handleLoadRoles();
                  }}
                  disabled={isLoadingRoles || isSubmitting}
                >
                  {isLoadingRoles ? "Loading Roles..." : "↻ Refresh Roles"}
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(280px, 1fr) minmax(280px, 1fr)",
                  gap: 20,
                }}
                className="user-reset-role-grid"
              >
                <div
                  style={{
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 20,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      color: "#f8fafc",
                      fontSize: 16,
                      fontWeight: 700,
                      marginBottom: 16,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span>👥</span> Role Selection
                  </div>

                  {isLoadingRoles && roleOptions.length === 0 ? (
                    <EmptyText text="⏳ Loading roles..." />
                  ) : roleOptions.length === 0 ? (
                    <EmptyText text="No roles loaded yet. Click Refresh Roles." />
                  ) : (
                    <div
                      className="custom-scrollbar"
                      style={{
                        maxHeight: 420,
                        overflowY: "auto",
                        display: "grid",
                        gap: 10,
                        paddingRight: 8,
                      }}
                    >
                      {roleOptions.map((role) => {
                        const checked = selectedRoleNames.includes(role.roleName);

                        return (
                          <label
                            key={role.roleName}
                            className="ui-role-label"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 14,
                              padding: "12px 16px",
                              borderRadius: 12,
                              border: checked
                                ? "1px solid rgba(59,130,246,0.5)"
                                : "1px solid rgba(255,255,255,0.1)",
                              background: checked
                                ? "rgba(59,130,246,0.15)"
                                : "rgba(255,255,255,0.02)",
                              cursor: "pointer",
                              transition: "all 0.2s ease",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              style={{ transform: "scale(1.2)", accentColor: "#3b82f6" }}
                              onChange={(e) => {
                                logger.info("role checkbox changed", {
                                  roleName: role.roleName,
                                  checked: e.target.checked,
                                });

                                setSelectedRoleNames((prev) => {
                                  if (e.target.checked) {
                                    return [...prev, role.roleName];
                                  }
                                  return prev.filter((item) => item !== role.roleName);
                                });
                              }}
                            />

                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  color: "#f8fafc",
                                  fontSize: 14,
                                  fontWeight: 600,
                                  whiteSpace: "pre-wrap",
                                  overflowWrap: "anywhere",
                                }}
                              >
                                {role.roleName}
                              </div>

                              <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 2 }}>
                                {role.users.length} user{role.users.length === 1 ? "" : "s"}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <div
                    style={{
                      marginTop: 16,
                      color: "#94a3b8",
                      fontSize: 13,
                      fontWeight: 500,
                      background: "rgba(255,255,255,0.05)",
                      padding: "10px 14px",
                      borderRadius: 8,
                      textAlign: "center",
                    }}
                  >
                    {selectedUsersCount} users selected from {selectedRoleCount} roles
                  </div>
                </div>

                <div
                  style={{
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(255,255,255,0.03)",
                    padding: 20,
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      color: "#f8fafc",
                      fontSize: 16,
                      fontWeight: 700,
                      marginBottom: 16,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span>🔐</span> Password Configuration
                  </div>

                  <Field
                    label="New Password"
                    value={passwordByRole}
                    placeholder="Enter new password"
                    onChange={(value) => {
                      logger.debug("reset by role password input changed", { length: value.length });
                      setPasswordByRole(value);
                    }}
                    hint="This password will be set for users from the selected roles"
                  />

                  <div style={{ ...warningBlockStyle, marginTop: 24, marginBottom: 24 }}>
                    <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 15 }}>⚠️ Warning</div>
                    <div style={{ lineHeight: 1.7 }}>
                      This will reset passwords for all users with the selected roles. Users will be
                      required to change their password on next login.
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <button
                      className="btn-postman ui-btn-primary"
                      type="button"
                      style={{ width: "100%", justifyContent: "center" }}
                      onClick={() => {
                        void handleResetByRole();
                      }}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? "Resetting..." : "🔐 Reset Passwords for Selected Roles"}
                    </button>
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Selected Users Preview">
              {selectedUsersByRole.length === 0 ? (
                <EmptyText text="No users selected yet." />
              ) : (
                <div
                  className="custom-scrollbar"
                  style={{
                    overflowX: "auto",
                    maxHeight: 420,
                    overflowY: "auto",
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(0,0,0,0.2)",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      minWidth: 900,
                    }}
                  >
                    <thead
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 1,
                        background: "#1e293b",
                        boxShadow: "0 1px 0 rgba(255,255,255,0.1)",
                      }}
                    >
                      <tr>
                        <th style={thStyle}>#</th>
                        <th style={thStyle}>Display Name</th>
                        <th style={thStyle}>User ID</th>
                        <th style={thStyle}>Email</th>
                        <th style={thStyle}>Roles</th>
                      </tr>
                    </thead>

                    <tbody>
                      {selectedUsersByRole.map((user, index) => (
                        <tr
                          key={`${user.id}-${index}`}
                          className="ui-table-row"
                          style={{
                            borderTop: "1px solid rgba(255,255,255,0.05)",
                            transition: "background 0.2s ease",
                          }}
                        >
                          <td style={tdStyle}>{index + 1}</td>
                          <td style={{ ...tdStyle, fontWeight: 500, color: "#f8fafc" }}>
                            {getDisplayName(user)}
                          </td>
                          <td style={tdMonoStyle}>{user.id}</td>
                          <td style={tdStyle}>{normalizeText(user.email) || "—"}</td>
                          <td style={tdStyle}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              {(user.userRoleDetails ?? []).map((role, roleIndex) => {
                                const roleName = normalizeText(role.roleName);

                                return (
                                  <span
                                    key={`${user.id}-${roleName}-${roleIndex}`}
                                    style={{
                                      display: "inline-flex",
                                      padding: "4px 10px",
                                      borderRadius: 6,
                                      border: "1px solid rgba(59,130,246,0.3)",
                                      background: "rgba(59,130,246,0.15)",
                                      color: "#93c5fd",
                                      fontSize: 12,
                                      fontWeight: 600,
                                    }}
                                  >
                                    {roleName || "Unknown"}
                                  </span>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </>
        ) : null}

        {viewMode === "enterprise" ? (
          <>
            <SectionCard title="Option 3: Enterprise Password Reset">
              <div style={infoBlockStyle}>
                Resets active enterprise users (all types except type 1). Every user first gets
                <b> {ENTERPRISE_PRIMARY_PASSWORD}</b>. If the policy asks for a special character, that user is
                retried once with <b>{ENTERPRISE_FALLBACK_PASSWORD}</b>. Each user's result is recorded below and
                can be downloaded as CSV.
              </div>

              <div style={{ marginTop: 8, fontSize: 13, color: "#cbd5e1" }}>
                Headers used: <b>{resolveEnterprise().source}</b>. The same headers are sent for every dealer.
              </div>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
                <button
                  className="btn-secondary ui-btn"
                  type="button"
                  onClick={() => void handleLoadEnterpriseUsers()}
                  disabled={enterpriseBusy}
                >
                  {enterpriseBusy && enterpriseProgress ? enterpriseProgress : "↻ Load Enterprise Users"}
                </button>

                <button
                  className="btn-postman ui-btn-primary"
                  type="button"
                  onClick={() => setEnterpriseDialogOpen(true)}
                  disabled={enterpriseBusy || enterpriseUsers.length === 0}
                >
                  {enterpriseBusy ? "Resetting..." : `🔐 Choose Dealers to Reset (${enterpriseUsers.length} users)`}
                </button>

                <button
                  className="btn-secondary ui-btn"
                  type="button"
                  onClick={downloadEnterpriseCsv}
                  disabled={enterpriseRecords.length === 0}
                >
                  ⬇ Download CSV
                </button>
              </div>

              {enterpriseError ? (
                <div style={{ marginTop: 12, color: "#fca5a5" }}>{enterpriseError}</div>
              ) : null}
            </SectionCard>

            {enterpriseDialogOpen ? (
              <div
                role="dialog"
                aria-modal="true"
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(2,6,23,0.7)",
                  zIndex: 9999,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 16,
                }}
                onClick={() => setEnterpriseDialogOpen(false)}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: "min(900px, 100%)",
                    maxHeight: "88vh",
                    display: "flex",
                    flexDirection: "column",
                    background: "#0f172a",
                    border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 16,
                    padding: 20,
                    color: "#e2e8f0",
                  }}
                >
                  <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Choose home dealers</div>
                  <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 12 }}>
                    Each dealer's users are reset with that dealer's headers. Test one dealer first if you want to check it.
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                    <input
                      value={enterpriseDealerSearch}
                      onChange={(e) => setEnterpriseDealerSearch(e.target.value)}
                      placeholder="Search dealer id or name"
                      style={{ flex: "1 1 240px", padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)", background: "#020617", color: "#e2e8f0" }}
                    />
                    <button
                      type="button"
                      className="btn-secondary btn-sm ui-btn"
                      onClick={() =>
                        setEnterpriseSelectedDealers(
                          enterpriseDealerGroups
                            .filter((g) => g.dealerId.includes(enterpriseDealerSearch.trim()) || g.dealerName.toLowerCase().includes(enterpriseDealerSearch.trim().toLowerCase()))
                            .map((g) => g.dealerId)
                        )
                      }
                    >
                      Select shown
                    </button>
                    <button type="button" className="btn-secondary btn-sm ui-btn" onClick={() => setEnterpriseSelectedDealers([])}>
                      Clear
                    </button>
                  </div>

                  <div style={{ overflowY: "auto", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10 }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th style={thStyle}></th>
                          <th style={thStyle}>Home Dealer</th>
                          <th style={thStyle}>Dealer Name</th>
                          <th style={thStyle}>Users</th>
                          <th style={thStyle}>Test</th>
                        </tr>
                      </thead>
                      <tbody>
                        {enterpriseDealerGroups
                          .filter((g) => {
                            const q = enterpriseDealerSearch.trim().toLowerCase();
                            return !q || g.dealerId.toLowerCase().includes(q) || g.dealerName.toLowerCase().includes(q);
                          })
                          .map((g) => (
                            <tr key={g.dealerId}>
                              <td style={{ ...tdStyle, width: 36 }}>
                                <input
                                  type="checkbox"
                                  checked={enterpriseSelectedDealers.includes(g.dealerId)}
                                  onChange={(e) =>
                                    setEnterpriseSelectedDealers((prev) =>
                                      e.target.checked ? [...prev, g.dealerId] : prev.filter((id) => id !== g.dealerId)
                                    )
                                  }
                                />
                              </td>
                              <td style={{ ...tdStyle, fontFamily: "monospace" }}>{g.dealerId}</td>
                              <td style={tdStyle}>{g.dealerName || "—"}</td>
                              <td style={tdStyle}>{g.users.length}</td>
                              <td style={tdStyle}>
                                <button
                                  type="button"
                                  className="btn-secondary btn-sm ui-btn"
                                  disabled={enterpriseBusy}
                                  onClick={() => void handleTestOneDealer(g.dealerId)}
                                >
                                  Test one user
                                </button>
                                {enterpriseTestResults[g.dealerId] ? (
                                  <div style={{ fontSize: 11, marginTop: 4, color: "#cbd5e1" }}>{enterpriseTestResults[g.dealerId]}</div>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 700 }}>
                      {enterpriseSelectedDealers.length} dealer(s) · {selectedEnterpriseUserCount} user(s) will be reset
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button type="button" className="btn-secondary ui-btn" onClick={() => setEnterpriseDialogOpen(false)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn-postman ui-btn-primary"
                        disabled={selectedEnterpriseUserCount === 0 || enterpriseBusy}
                        onClick={() => void handleRunSelectedEnterpriseDealers()}
                      >
                        🔐 Reset {selectedEnterpriseUserCount} users
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            <SectionCard title="Enterprise Snapshot">
              <RowLine left="Enterprise users loaded" right={String(enterpriseTotal)} />
              <RowLine left="Processed" right={String(enterpriseRecords.length)} />
              <RowLine left="Succeeded" right={String(enterpriseSuccess)} rightColor="#86efac" />
              <RowLine left="Failed" right={String(enterpriseFailed)} rightColor={enterpriseFailed ? "#fca5a5" : "#86efac"} />
            </SectionCard>

            {enterpriseRecords.length > 0 ? (
              <SectionCard title="Per-user Audit">
                <div className="custom-scrollbar" style={{ maxHeight: 420, overflowY: "auto", overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={thStyle}>User ID</th>
                        <th style={thStyle}>Name</th>
                        <th style={thStyle}>Dealer</th>
                        <th style={thStyle}>Password Used</th>
                        <th style={thStyle}>Result</th>
                        <th style={thStyle}>Error / Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {enterpriseRecords.map((r) => (
                        <tr key={r.userId}>
                          <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12 }}>{r.userId}</td>
                          <td style={tdStyle}>{r.name}</td>
                          <td style={tdStyle}>{r.homeDealerId}</td>
                          <td style={{ ...tdStyle, fontFamily: "monospace" }}>{r.passwordUsed}</td>
                          <td style={{ ...tdStyle, color: r.status === "success" ? "#86efac" : "#fca5a5", fontWeight: 700 }}>
                            {r.status === "success" ? "Success" : "Failed"}
                          </td>
                          <td style={{ ...tdStyle, color: "#fca5a5" }}>
                            {r.status === "failed" ? r.finalError : r.attempts.length > 1 ? "Needed special-character password" : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            ) : null}
          </>
        ) : null}

        {resetResults ? (
          <SectionCard title="Password Reset Results">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: 16,
              }}
            >
              <MetricCard label="Total Users" value={String(resetResults.total)} color="#f8fafc" />
              <MetricCard label="Successful" value={String(resetResults.success)} color="#4ade80" />
              <MetricCard label="Failed" value={String(resetResults.failed)} color="#f87171" />
            </div>

            {resetResults.errors.length > 0 ? (
              <div
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(245,158,11,0.3)",
                  background: "rgba(245,158,11,0.1)",
                  padding: 20,
                  color: "#fde68a",
                  marginTop: 8,
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 16, fontSize: 16 }}>
                  ⚠️ Errors ({resetResults.errors.length})
                </div>

                <div style={{ display: "grid", gap: 10, fontSize: 14 }}>
                  {resetResults.errors.slice(0, 10).map((error) => (
                    <div
                      key={`${error.userId}-${error.displayName}`}
                      style={{
                        background: "rgba(0,0,0,0.2)",
                        padding: "10px 14px",
                        borderRadius: 8,
                      }}
                    >
                      <b style={{ color: "#fff" }}>{error.displayName}</b>
                      <span style={{ opacity: 0.7 }}>({error.userId})</span> — {error.error}
                    </div>
                  ))}

                  {resetResults.errors.length > 10 ? (
                    <div style={{ fontStyle: "italic", opacity: 0.8, padding: "8px 0" }}>
                      ... and {resetResults.errors.length - 10} more
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </SectionCard>
        ) : null}
      </div>
    </div>
  );
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "16px 14px",
  color: "#94a3b8",
  fontSize: 13,
  fontWeight: 700,
  whiteSpace: "nowrap",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const tdStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "14px",
  color: "#cbd5e1",
  fontSize: 14,
  verticalAlign: "middle",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const tdMonoStyle: React.CSSProperties = {
  ...tdStyle,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 13,
  color: "#94a3b8",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 46,
  borderRadius: 10,
  padding: "10px 16px",
  fontSize: 14,
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  color: "#cbd5e1",
  fontSize: 14,
  fontWeight: 600,
  marginBottom: 8,
};

const hintStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 13,
  marginTop: 8,
};

const infoBlockStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(59,130,246,0.05) 100%)",
  border: "1px solid rgba(59,130,246,0.25)",
  borderLeft: "4px solid #3b82f6",
  borderRadius: 14,
  padding: 18,
  color: "#bfdbfe",
  fontSize: 14,
  lineHeight: 1.7,
};

const warningBlockStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(245, 158, 11, 0.05) 100%)",
  border: "1px solid rgba(245, 158, 11, 0.3)",
  borderLeft: "4px solid #f59e0b",
  borderRadius: 14,
  padding: 18,
  color: "#fde68a",
};

const Pill: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      padding: "6px 12px",
      borderRadius: 8,
      border: "1px solid rgba(255,255,255,0.1)",
      background: "rgba(255,255,255,0.05)",
      color: "#94a3b8",
      fontSize: 13,
      fontWeight: 500,
    }}
  >
    {label} <b style={{ color: "#f8fafc", fontWeight: 700 }}>{value}</b>
  </span>
);

const SectionCard: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div
    style={{
      borderRadius: 20,
      border: "1px solid rgba(255,255,255,0.1)",
      background: "rgba(255,255,255,0.03)",
      padding: 24,
      minWidth: 0,
      boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
    }}
  >
    <div
      style={{
        fontSize: 20,
        fontWeight: 800,
        color: "#f8fafc",
        marginBottom: 20,
        letterSpacing: "-0.01em",
      }}
    >
      {title}
    </div>

    <div style={{ display: "grid", gap: 16 }}>{children}</div>
  </div>
);

const EmptyText: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      borderRadius: 16,
      border: "2px dashed rgba(148,163,184,0.2)",
      padding: 32,
      color: "#94a3b8",
      textAlign: "center",
      fontSize: 14,
      fontWeight: 500,
      background: "rgba(0,0,0,0.1)",
    }}
  >
    {text}
  </div>
);

const ActionCard: React.FC<{
  icon: string;
  title: string;
  description: string;
  buttonLabel: string;
  onClick: () => void;
}> = ({ icon, title, description, buttonLabel, onClick }) => (
  <div
    className="ui-action-card"
    style={{
      borderRadius: 20,
      border: "1px solid rgba(255,255,255,0.1)",
      background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%)",
      padding: 24,
      display: "flex",
      flexDirection: "column",
      gap: 20,
      transition: "all 0.3s ease",
      cursor: "pointer",
    }}
    onClick={onClick}
  >
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flex: 1 }}>
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 14,
          display: "grid",
          placeItems: "center",
          background: "linear-gradient(135deg, rgba(0,184,204,0.2) 0%, rgba(0,184,204,0.05) 100%)",
          fontSize: 24,
          border: "1px solid rgba(0,184,204,0.2)",
        }}
      >
        {icon}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ color: "#f8fafc", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          {title}
        </div>
        <div style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.6 }}>{description}</div>
      </div>
    </div>

    <button
      className="btn-postman ui-btn-primary"
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {buttonLabel}
    </button>
  </div>
);

const Field: React.FC<{
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  onChange: (value: string) => void;
}> = ({ label, value, placeholder, hint, onChange }) => (
  <div>
    <div style={labelStyle}>{label}</div>
    <input
      className="st-input"
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={inputStyle}
    />
    {hint ? <div style={hintStyle}>{hint}</div> : null}
  </div>
);

const RowLine: React.FC<{
  left: string;
  right: string;
  rightColor?: string;
}> = ({ left, right, rightColor = "#f8fafc" }) => (
  <div
    style={{
      display: "flex",
      justifyContent: "space-between",
      gap: 16,
      alignItems: "center",
      padding: "14px 18px",
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.05)",
      background: "rgba(0,0,0,0.15)",
      flexWrap: "wrap",
    }}
  >
    <div style={{ color: "#94a3b8", fontSize: 14, fontWeight: 500, maxWidth: "100%" }}>
      {left}
    </div>

    <div
      style={{
        color: rightColor,
        fontSize: 14,
        fontWeight: 700,
        textAlign: "right",
        maxWidth: "100%",
      }}
    >
      {right}
    </div>
  </div>
);

const MetricCard: React.FC<{
  label: string;
  value: string;
  color: string;
}> = ({ label, value, color }) => (
  <div
    style={{
      borderRadius: 16,
      border: "1px solid rgba(255,255,255,0.1)",
      background: "rgba(255,255,255,0.03)",
      padding: 24,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "inset 0 2px 10px rgba(0,0,0,0.1)",
    }}
  >
    <div
      style={{
        color: "#94a3b8",
        fontSize: 13,
        fontWeight: 600,
        marginBottom: 8,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}
    >
      {label}
    </div>

    <div style={{ color, fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>
      {value}
    </div>
  </div>
);

export default UserResetView;
