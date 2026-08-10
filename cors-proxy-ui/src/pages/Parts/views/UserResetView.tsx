import React, { useEffect, useMemo, useState, useCallback } from "react";
import { loadTekionApiSettingsBundle } from "../../../services/tekionApiSettings";
import type { KeyValuePair } from "../../../types/proxy.types";

const MODULE_NAME = "User Reset";
const USERS_AND_ROLES_URL =
  "https://preprodapp.tekioncloud.com/api/userservice/u/v2/userandroles?locale=en_US";
const UPDATE_PASSWORD_URL =
  "https://preprodapp.tekioncloud.com/api/userservice/u/v2/updatePassword?locale=en_US";

type ViewMode = "home" | "reset-all" | "reset-by-role";
type RunState = "idle" | "loading" | "success" | "error" | "warning";

const DEFAULT_PASSWORD = "Happyday1";

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
        header.enabled &&
        header.key.trim() &&
        String(header.value).trim()
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
      { field: "active", operator: "IN", values: [true], key: "active" },
      { field: "type", operator: "IN", values: [2], key: "type" },
    ],
    searchText: "",
    groupBy: [],
    includeFields: [],
    searchableFields: [],
    excludeFields: [],
    pageInfo: { start: 0, rows: 200 },
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

  const [isExpanded, setIsExpanded] = useState(false);

  const [allUsers, setAllUsers] = useState<UserRecord[]>([]);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [isLoadingRoles, setIsLoadingRoles] = useState(false);
  const [selectedRoleNames, setSelectedRoleNames] = useState<string[]>([]);

  const [passwordForAll, setPasswordForAll] = useState(DEFAULT_PASSWORD);
  const [passwordByRole, setPasswordByRole] = useState(DEFAULT_PASSWORD);

  const [resetResults, setResetResults] = useState<PasswordResetResult | null>(null);
  const [progressText, setProgressText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  // Handle automatic role loading on view mode change
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

  const panelWidth = isExpanded ? "min(96vw, 1600px)" : "100%";

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
              Reset user passwords for all active employee users or for selected roles. Uses active Global Headers from Settings.
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
            <div style={{ width: 1, height: 24, background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />
            <button
              className="btn-secondary btn-sm ui-btn"
              type="button"
              onClick={() => {
                logger.info("expand/collapse toggle clicked", { isExpanded: !isExpanded });
                setIsExpanded((prev) => !prev);
              }}
              title={isExpanded ? "Collapse wide workspace" : "Expand wide workspace"}
            >
              {isExpanded ? "🗕 Collapse" : "🗖 Expand"}
            </button>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
          <Pill label="Module" value={MODULE_NAME} />
          <Pill label="Mode" value={viewMode === "reset-by-role" ? "By Role" : viewMode === "reset-all" ? "All Users" : "Home"} />
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
             {runState === 'loading' ? '⏳ ' : ''}{statusText}
          </div>
          {errorText ? <div style={{ opacity: 0.9 }}>{errorText}</div> : null}
          {progressText ? <div style={{ marginTop: 8, fontStyle: "italic", opacity: 0.8 }}>{progressText}</div> : null}
        </div>
      </div>

      <div
        style={{
          width: panelWidth,
          maxWidth: "100%",
          justifySelf: "center",
          display: "grid",
          gap: 20,
          minWidth: 0,
          transition: "width 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {viewMode === "home" ? (
          <>

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
          </>
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
                  This will reset passwords for ALL active employee users (Type 2).
                  Users will be required to change their password on next login.
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
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8
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
                        maxHeight: isExpanded ? 520 : 360,
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
                      textAlign: "center"
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
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8
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
                      This will reset passwords for all users with the selected roles.
                      Users will be required to change their password on next login.
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
                    maxHeight: isExpanded ? 520 : 360,
                    overflowY: "auto",
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "rgba(0,0,0,0.2)"
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
                        boxShadow: "0 1px 0 rgba(255,255,255,0.1)"
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
                            transition: "background 0.2s ease"
                          }}
                        >
                          <td style={tdStyle}>{index + 1}</td>
                          <td style={{...tdStyle, fontWeight: 500, color: "#f8fafc"}}>{getDisplayName(user)}</td>
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
                  marginTop: 8
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 16, fontSize: 16 }}>
                  ⚠️ Errors ({resetResults.errors.length})
                </div>
                <div style={{ display: "grid", gap: 10, fontSize: 14 }}>
                  {resetResults.errors.slice(0, 10).map((error) => (
                    <div key={`${error.userId}-${error.displayName}`} style={{ background: "rgba(0,0,0,0.2)", padding: "10px 14px", borderRadius: 8 }}>
                      <b style={{ color: "#fff" }}>{error.displayName}</b> <span style={{ opacity: 0.7 }}>({error.userId})</span> — {error.error}
                    </div>
                  ))}
                  {resetResults.errors.length > 10 ? (
                    <div style={{ fontStyle: "italic", opacity: 0.8, padding: "8px 0" }}>... and {resetResults.errors.length - 10} more</div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </SectionCard>
        ) : null}
      </div>

      <style>
        {`
          @media (max-width: 900px) {
            .user-reset-role-grid {
              grid-template-columns: 1fr !important;
            }
          }

          /* Custom Scrollbar for better UI in dark mode */
          .custom-scrollbar::-webkit-scrollbar {
            width: 8px;
            height: 8px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: rgba(255,255,255,0.02);
            border-radius: 4px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.15);
            border-radius: 4px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: rgba(255,255,255,0.25);
          }

          /* Interactive UI components */
          .ui-action-card:hover {
            transform: translateY(-3px);
            border-color: rgba(59,130,246,0.5) !important;
            box-shadow: 0 10px 25px rgba(0,0,0,0.2);
          }

          .ui-role-label:hover {
            background: rgba(255,255,255,0.06) !important;
          }

          .ui-table-row:hover {
            background: rgba(255,255,255,0.04) !important;
          }

          .ui-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 8px 16px;
            border-radius: 8px;
            font-weight: 600;
            transition: all 0.2s ease;
            cursor: pointer;
          }

          .ui-btn:active {
            transform: scale(0.97);
          }

          .ui-btn-primary {
            background: #3b82f6;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            font-weight: 600;
            transition: all 0.2s ease;
            box-shadow: 0 4px 12px rgba(59,130,246,0.3);
          }

          .ui-btn-primary:hover:not(:disabled) {
            background: #2563eb;
            box-shadow: 0 6px 16px rgba(59,130,246,0.4);
            transform: translateY(-1px);
          }

          .ui-btn-primary:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            box-shadow: none;
          }

          .ui-btn-active {
            background: rgba(59,130,246,0.15) !important;
            color: #93c5fd !important;
            border: 1px solid rgba(59,130,246,0.4) !important;
          }

          .st-input {
            background: rgba(0,0,0,0.2);
            border: 1px solid rgba(255,255,255,0.15);
            color: #f8fafc;
            transition: all 0.2s ease;
          }

          .st-input:focus {
            outline: none;
            border-color: #3b82f6;
            box-shadow: 0 0 0 3px rgba(59,130,246,0.2);
          }
        `}
      </style>
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
  letterSpacing: "0.05em"
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
  color: "#94a3b8"
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
      fontWeight: 500
    }}
  >
    {label}
    <b style={{ color: "#f8fafc", fontWeight: 700 }}>{value}</b>
  </span>
);

const SectionCard: React.FC<{
  title: string;
  children: React.ReactNode;
}> = ({ title, children }) => (
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
        letterSpacing: "-0.01em"
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
      background: "rgba(0,0,0,0.1)"
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
      cursor: "pointer"
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
          border: "1px solid rgba(0,184,204,0.2)"
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

    <button className="btn-postman ui-btn-primary" type="button" onClick={(e) => {
      e.stopPropagation(); // Prevent double trigger if card is also clickable
      onClick();
    }}>
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
    <div
      style={{
        color: "#94a3b8",
        fontSize: 14,
        fontWeight: 500,
        maxWidth: "100%",
      }}
    >
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
      boxShadow: "inset 0 2px 10px rgba(0,0,0,0.1)"
    }}
  >
    <div style={{ color: "#94a3b8", fontSize: 13, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    <div style={{ color, fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }}>{value}</div>
  </div>
);