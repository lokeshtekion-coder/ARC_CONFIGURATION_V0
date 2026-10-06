import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState, useCallback } from "react";
import { loadTekionApiSettingsBundle } from "../../../../services/tekionApiSettings";
import "./UserResetView.css";
const MODULE_NAME = "User Reset";
const USERS_AND_ROLES_URL = "https://preprodapp.tekioncloud.com/api/userservice/u/v2/userandroles?locale=en_US";
const UPDATE_PASSWORD_URL = "https://preprodapp.tekioncloud.com/api/userservice/u/v2/updatePassword?locale=en_US";
const DEFAULT_PASSWORD = "Happyday1";
const logger = {
    debug: (...args) => console.debug("[Parts][UserReset]", ...args),
    info: (...args) => console.info("[Parts][UserReset]", ...args),
    warn: (...args) => console.warn("[Parts][UserReset]", ...args),
    error: (...args) => console.error("[Parts][UserReset]", ...args),
};
function normalizeText(value) {
    return String(value ?? "").trim();
}
function getEnabledGlobalHeaders() {
    const bundle = loadTekionApiSettingsBundle();
    const headers = (bundle.globalHeaders ?? [])
        .filter((header) => header.enabled && header.key.trim() && String(header.value).trim())
        .reduce((acc, header) => {
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
function getDisplayName(user) {
    return (normalizeText(user.displayName) ||
        `${normalizeText(user.fname)} ${normalizeText(user.lname)}`.trim() ||
        normalizeText(user.email) ||
        user.id);
}
async function fetchUsersAndRoles(headers) {
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
    const json = (await response.json());
    logger.debug("users and roles response json", json);
    const users = json.data?.userAndRoleResponses ?? [];
    logger.info("fetched active employee users", {
        count: users.length,
    });
    return users;
}
function buildRoleOptions(users) {
    const roleMap = new Map();
    users.forEach((user) => {
        (user.userRoleDetails ?? []).forEach((roleDetail) => {
            const roleName = normalizeText(roleDetail.roleName);
            if (!roleName)
                return;
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
async function updatePasswordForUser(userId, password, headers) {
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
export const UserResetView = () => {
    const [viewMode, setViewMode] = useState("home");
    const [runState, setRunState] = useState("idle");
    const [statusText, setStatusText] = useState("Ready");
    const [errorText, setErrorText] = useState("");
    const [lastRunAt, setLastRunAt] = useState("");
    const [isExpanded, setIsExpanded] = useState(false);
    const [allUsers, setAllUsers] = useState([]);
    const [roleOptions, setRoleOptions] = useState([]);
    const [isLoadingRoles, setIsLoadingRoles] = useState(false);
    const [selectedRoleNames, setSelectedRoleNames] = useState([]);
    const [passwordForAll, setPasswordForAll] = useState(DEFAULT_PASSWORD);
    const [passwordByRole, setPasswordByRole] = useState(DEFAULT_PASSWORD);
    const [resetResults, setResetResults] = useState(null);
    const [progressText, setProgressText] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    useEffect(() => {
        logger.info("component mounted");
        return () => logger.info("component unmounted");
    }, []);
    const handleLoadRoles = useCallback(async () => {
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
                setErrorText("No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers.");
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
            }
            else {
                setRunState("success");
                setStatusText(`Loaded ${users.length} active employee users across ${roles.length} roles`);
                logger.info("roles loaded successfully", {
                    userCount: users.length,
                    roleCount: roles.length,
                });
            }
            setLastRunAt(new Date().toLocaleString());
        }
        catch (error) {
            logger.error("load roles failed", error);
            setRunState("error");
            setStatusText("Failed to load roles");
            setErrorText(error instanceof Error ? error.message : String(error));
            setLastRunAt(new Date().toLocaleString());
        }
        finally {
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
        const userIdMap = new Map();
        selectedRoleNames.forEach((roleName) => {
            const role = roleOptions.find((item) => item.roleName === roleName);
            if (!role)
                return;
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
    const runPasswordReset = async (usersToUpdate, newPassword, mode) => {
        logger.info("password reset requested", {
            mode,
            userCount: usersToUpdate.length,
            passwordLength: newPassword.length,
        });
        setIsSubmitting(true);
        setRunState("loading");
        setStatusText(mode === "reset-all"
            ? "Resetting passwords for all active employee users..."
            : "Resetting passwords for selected roles...");
        setErrorText("");
        setProgressText("");
        setResetResults(null);
        try {
            const headers = getEnabledGlobalHeaders();
            if (Object.keys(headers).length === 0) {
                logger.warn("global headers missing before password reset");
                setRunState("error");
                setStatusText("Global headers are missing");
                setErrorText("No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers.");
                return;
            }
            const results = {
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
                }
                catch (error) {
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
                setStatusText(mode === "reset-all"
                    ? `Password reset completed for all ${results.success} users`
                    : `Password reset completed for ${results.success} selected users`);
            }
            else {
                setRunState("warning");
                setStatusText(`Password reset completed with partial failures. Success: ${results.success}, Failed: ${results.failed}`);
            }
        }
        catch (error) {
            logger.error("password reset flow failed", error);
            setRunState("error");
            setStatusText("Password reset failed");
            setErrorText(error instanceof Error ? error.message : String(error));
            setLastRunAt(new Date().toLocaleString());
        }
        finally {
            setIsSubmitting(false);
            setProgressText("");
        }
    };
    const handleResetAll = async () => {
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
        const confirmed = window.confirm(`⚠️ WARNING: This will reset passwords for ALL active employee users!\n\nNew Password: ${passwordForAll}\n\nUsers will be required to change their password on next login.\n\nDo you want to continue?`);
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
                    setErrorText("No active global headers found. Go to Settings, select a dealer profile, and save/apply Global Headers.");
                    return;
                }
                users = await fetchUsersAndRoles(headers);
                setAllUsers(users);
                setRoleOptions(buildRoleOptions(users));
            }
            catch (error) {
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
    const handleResetByRole = async () => {
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
        const confirmed = window.confirm(`⚠️ WARNING: This will reset passwords for users with the selected roles!\n\nSelected Roles: ${selectedRoleNames.join(", ")}\nTotal Users: ${selectedUsersByRole.length}\nNew Password: ${passwordByRole}\n\nUsers will be required to change their password on next login.\n\nDo you want to continue?`);
        if (!confirmed) {
            logger.info("reset by role cancelled by user");
            return;
        }
        await runPasswordReset(selectedUsersByRole, passwordByRole.trim(), "reset-by-role");
    };
    const panelWidth = isExpanded ? "min(96vw, 1600px)" : "100%";
    return (_jsxs("div", { style: { display: "grid", gap: 20, minWidth: 0, fontFamily: "system-ui, sans-serif" }, children: [_jsxs("div", { className: "ui-glass-panel", style: {
                    borderRadius: 20,
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)",
                    padding: 24,
                    minWidth: 0,
                    boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
                }, children: [_jsxs("div", { style: {
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            gap: 16,
                            flexWrap: "wrap",
                            marginBottom: 20,
                        }, children: [_jsxs("div", { style: { minWidth: 0 }, children: [_jsx("div", { style: {
                                            fontSize: 28,
                                            fontWeight: 800,
                                            color: "#f8fafc",
                                            marginBottom: 8,
                                            wordBreak: "break-word",
                                            letterSpacing: "-0.02em",
                                        }, children: "User Reset" }), _jsx("div", { style: {
                                            color: "#94a3b8",
                                            fontSize: 15,
                                            lineHeight: 1.6,
                                            whiteSpace: "pre-wrap",
                                            overflowWrap: "anywhere",
                                        }, children: "Reset user passwords for all active employee users or for selected roles. Uses active Global Headers from Settings." })] }), _jsxs("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }, children: [_jsx("button", { className: viewMode === "home" ? "btn-postman ui-btn-active" : "btn-secondary btn-sm ui-btn", type: "button", onClick: () => setViewMode("home"), children: "Home" }), _jsx("button", { className: viewMode === "reset-all" ? "btn-postman ui-btn-active" : "btn-secondary btn-sm ui-btn", type: "button", onClick: () => setViewMode("reset-all"), children: "Option 1" }), _jsx("button", { className: viewMode === "reset-by-role" ? "btn-postman ui-btn-active" : "btn-secondary btn-sm ui-btn", type: "button", onClick: () => setViewMode("reset-by-role"), children: "Option 2" }), _jsx("div", { style: {
                                            width: 1,
                                            height: 24,
                                            background: "rgba(255,255,255,0.1)",
                                            margin: "0 4px",
                                        } }), _jsx("button", { className: "btn-secondary btn-sm ui-btn", type: "button", onClick: () => {
                                            logger.info("expand/collapse toggle clicked", { isExpanded: !isExpanded });
                                            setIsExpanded((prev) => !prev);
                                        }, title: isExpanded ? "Collapse wide workspace" : "Expand wide workspace", children: isExpanded ? "🗕 Collapse" : "🗖 Expand" })] })] }), _jsxs("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }, children: [_jsx(Pill, { label: "Module", value: MODULE_NAME }), _jsx(Pill, { label: "Mode", value: viewMode === "reset-by-role"
                                    ? "By Role"
                                    : viewMode === "reset-all"
                                        ? "All Users"
                                        : "Home" }), _jsx(Pill, { label: "Users Loaded", value: String(allUsers.length) }), _jsx(Pill, { label: "Roles Loaded", value: String(roleOptions.length) }), _jsx(Pill, { label: "Selected Roles", value: String(selectedRoleCount) }), _jsx(Pill, { label: "Selected Users", value: String(selectedUsersCount) }), lastRunAt ? _jsx(Pill, { label: "Last Run", value: lastRunAt }) : null] }), _jsxs("div", { className: "ui-status-bar", style: {
                            borderRadius: 12,
                            padding: "14px 18px",
                            fontSize: 14,
                            lineHeight: 1.6,
                            transition: "all 0.3s ease",
                            border: runState === "error"
                                ? "1px solid rgba(239,68,68,0.3)"
                                : runState === "success"
                                    ? "1px solid rgba(34,197,94,0.3)"
                                    : runState === "warning"
                                        ? "1px solid rgba(245,158,11,0.3)"
                                        : "1px solid rgba(255,255,255,0.1)",
                            background: runState === "error"
                                ? "rgba(239,68,68,0.15)"
                                : runState === "success"
                                    ? "rgba(34,197,94,0.15)"
                                    : runState === "warning"
                                        ? "rgba(245,158,11,0.15)"
                                        : "rgba(255,255,255,0.03)",
                            color: runState === "error"
                                ? "#fecaca"
                                : runState === "success"
                                    ? "#bbf7d0"
                                    : runState === "warning"
                                        ? "#fde68a"
                                        : "#cbd5e1",
                        }, children: [_jsxs("div", { style: { fontWeight: 600, marginBottom: errorText ? 4 : 0 }, children: [runState === "loading" ? "⏳ " : "", statusText] }), errorText ? _jsx("div", { style: { opacity: 0.9 }, children: errorText }) : null, progressText ? (_jsx("div", { style: { marginTop: 8, fontStyle: "italic", opacity: 0.8 }, children: progressText })) : null] })] }), _jsxs("div", { style: {
                    width: panelWidth,
                    maxWidth: "100%",
                    justifySelf: "center",
                    display: "grid",
                    gap: 20,
                    minWidth: 0,
                    transition: "width 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
                }, children: [viewMode === "home" ? (_jsxs("div", { style: {
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                            gap: 20,
                        }, children: [_jsx(ActionCard, { icon: "\uD83D\uDD10", title: "Option 1: Reset ALL Users", description: "Reset passwords for all active employee users (Type 2) in the system in a single batch operation.", buttonLabel: "Open Option 1", onClick: () => {
                                    logger.info("home action clicked", { action: "reset-all" });
                                    setViewMode("reset-all");
                                } }), _jsx(ActionCard, { icon: "\uD83D\uDC65", title: "Option 2: Reset by Role", description: "Selectively target one or more roles and reset passwords exclusively for users associated with those specific roles.", buttonLabel: "Open Option 2", onClick: () => {
                                    logger.info("home action clicked", { action: "reset-by-role" });
                                    setViewMode("reset-by-role");
                                } })] })) : null, viewMode === "reset-all" ? (_jsxs(_Fragment, { children: [_jsxs(SectionCard, { title: "Option 1: Reset ALL User Passwords", children: [_jsx("div", { style: infoBlockStyle, children: "Reset passwords for all active employee users (Type 2) in the system." }), _jsx(Field, { label: "New Password", value: passwordForAll, placeholder: "Enter new password", onChange: (value) => {
                                            logger.debug("reset all password input changed", { length: value.length });
                                            setPasswordForAll(value);
                                        }, hint: "This password will be set for all active employee users" }), _jsxs("div", { style: warningBlockStyle, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 8, fontSize: 15 }, children: "\u26A0\uFE0F Warning" }), _jsx("div", { style: { lineHeight: 1.7 }, children: "This will reset passwords for ALL active employee users (Type 2). Users will be required to change their password on next login." })] }), _jsxs("div", { style: { display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }, children: [_jsx("button", { className: "btn-secondary ui-btn", type: "button", onClick: () => {
                                                    void handleLoadRoles();
                                                }, disabled: isLoadingRoles || isSubmitting, children: isLoadingRoles ? "Loading Users..." : "↻ Refresh Active Users" }), _jsx("button", { className: "btn-postman ui-btn-primary", type: "button", onClick: () => {
                                                    void handleResetAll();
                                                }, disabled: isSubmitting, children: isSubmitting ? "Resetting..." : "🔐 Reset All User Passwords" })] })] }), _jsxs(SectionCard, { title: "Reset All Snapshot", children: [_jsx(RowLine, { left: "Loaded Active Users", right: String(allUsers.length) }), _jsx(RowLine, { left: "New Password Length", right: String(passwordForAll.length) }), _jsx(RowLine, { left: "Submitting Status", right: isSubmitting ? "In Progress" : "Idle", rightColor: isSubmitting ? "#fde68a" : "#86efac" })] })] })) : null, viewMode === "reset-by-role" ? (_jsxs(_Fragment, { children: [_jsxs(SectionCard, { title: "Option 2: Reset Passwords by Role", children: [_jsx("div", { style: infoBlockStyle, children: "Select one or more roles and reset passwords only for users with those roles." }), _jsx("div", { style: { display: "flex", gap: 12, flexWrap: "wrap" }, children: _jsx("button", { className: "btn-secondary ui-btn", type: "button", onClick: () => {
                                                void handleLoadRoles();
                                            }, disabled: isLoadingRoles || isSubmitting, children: isLoadingRoles ? "Loading Roles..." : "↻ Refresh Roles" }) }), _jsxs("div", { style: {
                                            display: "grid",
                                            gridTemplateColumns: "minmax(280px, 1fr) minmax(280px, 1fr)",
                                            gap: 20,
                                        }, className: "user-reset-role-grid", children: [_jsxs("div", { style: {
                                                    borderRadius: 16,
                                                    border: "1px solid rgba(255,255,255,0.1)",
                                                    background: "rgba(255,255,255,0.03)",
                                                    padding: 20,
                                                    minWidth: 0,
                                                }, children: [_jsxs("div", { style: {
                                                            color: "#f8fafc",
                                                            fontSize: 16,
                                                            fontWeight: 700,
                                                            marginBottom: 16,
                                                            display: "flex",
                                                            alignItems: "center",
                                                            gap: 8,
                                                        }, children: [_jsx("span", { children: "\uD83D\uDC65" }), " Role Selection"] }), isLoadingRoles && roleOptions.length === 0 ? (_jsx(EmptyText, { text: "\u23F3 Loading roles..." })) : roleOptions.length === 0 ? (_jsx(EmptyText, { text: "No roles loaded yet. Click Refresh Roles." })) : (_jsx("div", { className: "custom-scrollbar", style: {
                                                            maxHeight: isExpanded ? 520 : 360,
                                                            overflowY: "auto",
                                                            display: "grid",
                                                            gap: 10,
                                                            paddingRight: 8,
                                                        }, children: roleOptions.map((role) => {
                                                            const checked = selectedRoleNames.includes(role.roleName);
                                                            return (_jsxs("label", { className: "ui-role-label", style: {
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
                                                                }, children: [_jsx("input", { type: "checkbox", checked: checked, style: { transform: "scale(1.2)", accentColor: "#3b82f6" }, onChange: (e) => {
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
                                                                        } }), _jsxs("div", { style: { minWidth: 0 }, children: [_jsx("div", { style: {
                                                                                    color: "#f8fafc",
                                                                                    fontSize: 14,
                                                                                    fontWeight: 600,
                                                                                    whiteSpace: "pre-wrap",
                                                                                    overflowWrap: "anywhere",
                                                                                }, children: role.roleName }), _jsxs("div", { style: { color: "#94a3b8", fontSize: 13, marginTop: 2 }, children: [role.users.length, " user", role.users.length === 1 ? "" : "s"] })] })] }, role.roleName));
                                                        }) })), _jsxs("div", { style: {
                                                            marginTop: 16,
                                                            color: "#94a3b8",
                                                            fontSize: 13,
                                                            fontWeight: 500,
                                                            background: "rgba(255,255,255,0.05)",
                                                            padding: "10px 14px",
                                                            borderRadius: 8,
                                                            textAlign: "center",
                                                        }, children: [selectedUsersCount, " users selected from ", selectedRoleCount, " roles"] })] }), _jsxs("div", { style: {
                                                    borderRadius: 16,
                                                    border: "1px solid rgba(255,255,255,0.1)",
                                                    background: "rgba(255,255,255,0.03)",
                                                    padding: 20,
                                                    minWidth: 0,
                                                }, children: [_jsxs("div", { style: {
                                                            color: "#f8fafc",
                                                            fontSize: 16,
                                                            fontWeight: 700,
                                                            marginBottom: 16,
                                                            display: "flex",
                                                            alignItems: "center",
                                                            gap: 8,
                                                        }, children: [_jsx("span", { children: "\uD83D\uDD10" }), " Password Configuration"] }), _jsx(Field, { label: "New Password", value: passwordByRole, placeholder: "Enter new password", onChange: (value) => {
                                                            logger.debug("reset by role password input changed", { length: value.length });
                                                            setPasswordByRole(value);
                                                        }, hint: "This password will be set for users from the selected roles" }), _jsxs("div", { style: { ...warningBlockStyle, marginTop: 24, marginBottom: 24 }, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 8, fontSize: 15 }, children: "\u26A0\uFE0F Warning" }), _jsx("div", { style: { lineHeight: 1.7 }, children: "This will reset passwords for all users with the selected roles. Users will be required to change their password on next login." })] }), _jsx("div", { style: { display: "flex", gap: 12, flexWrap: "wrap" }, children: _jsx("button", { className: "btn-postman ui-btn-primary", type: "button", style: { width: "100%", justifyContent: "center" }, onClick: () => {
                                                                void handleResetByRole();
                                                            }, disabled: isSubmitting, children: isSubmitting ? "Resetting..." : "🔐 Reset Passwords for Selected Roles" }) })] })] })] }), _jsx(SectionCard, { title: "Selected Users Preview", children: selectedUsersByRole.length === 0 ? (_jsx(EmptyText, { text: "No users selected yet." })) : (_jsx("div", { className: "custom-scrollbar", style: {
                                        overflowX: "auto",
                                        maxHeight: isExpanded ? 520 : 360,
                                        overflowY: "auto",
                                        borderRadius: 16,
                                        border: "1px solid rgba(255,255,255,0.1)",
                                        background: "rgba(0,0,0,0.2)",
                                    }, children: _jsxs("table", { style: {
                                            width: "100%",
                                            borderCollapse: "collapse",
                                            minWidth: 900,
                                        }, children: [_jsx("thead", { style: {
                                                    position: "sticky",
                                                    top: 0,
                                                    zIndex: 1,
                                                    background: "#1e293b",
                                                    boxShadow: "0 1px 0 rgba(255,255,255,0.1)",
                                                }, children: _jsxs("tr", { children: [_jsx("th", { style: thStyle, children: "#" }), _jsx("th", { style: thStyle, children: "Display Name" }), _jsx("th", { style: thStyle, children: "User ID" }), _jsx("th", { style: thStyle, children: "Email" }), _jsx("th", { style: thStyle, children: "Roles" })] }) }), _jsx("tbody", { children: selectedUsersByRole.map((user, index) => (_jsxs("tr", { className: "ui-table-row", style: {
                                                        borderTop: "1px solid rgba(255,255,255,0.05)",
                                                        transition: "background 0.2s ease",
                                                    }, children: [_jsx("td", { style: tdStyle, children: index + 1 }), _jsx("td", { style: { ...tdStyle, fontWeight: 500, color: "#f8fafc" }, children: getDisplayName(user) }), _jsx("td", { style: tdMonoStyle, children: user.id }), _jsx("td", { style: tdStyle, children: normalizeText(user.email) || "—" }), _jsx("td", { style: tdStyle, children: _jsx("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: (user.userRoleDetails ?? []).map((role, roleIndex) => {
                                                                    const roleName = normalizeText(role.roleName);
                                                                    return (_jsx("span", { style: {
                                                                            display: "inline-flex",
                                                                            padding: "4px 10px",
                                                                            borderRadius: 6,
                                                                            border: "1px solid rgba(59,130,246,0.3)",
                                                                            background: "rgba(59,130,246,0.15)",
                                                                            color: "#93c5fd",
                                                                            fontSize: 12,
                                                                            fontWeight: 600,
                                                                        }, children: roleName || "Unknown" }, `${user.id}-${roleName}-${roleIndex}`));
                                                                }) }) })] }, `${user.id}-${index}`))) })] }) })) })] })) : null, resetResults ? (_jsxs(SectionCard, { title: "Password Reset Results", children: [_jsxs("div", { style: {
                                    display: "grid",
                                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                                    gap: 16,
                                }, children: [_jsx(MetricCard, { label: "Total Users", value: String(resetResults.total), color: "#f8fafc" }), _jsx(MetricCard, { label: "Successful", value: String(resetResults.success), color: "#4ade80" }), _jsx(MetricCard, { label: "Failed", value: String(resetResults.failed), color: "#f87171" })] }), resetResults.errors.length > 0 ? (_jsxs("div", { style: {
                                    borderRadius: 16,
                                    border: "1px solid rgba(245,158,11,0.3)",
                                    background: "rgba(245,158,11,0.1)",
                                    padding: 20,
                                    color: "#fde68a",
                                    marginTop: 8,
                                }, children: [_jsxs("div", { style: { fontWeight: 700, marginBottom: 16, fontSize: 16 }, children: ["\u26A0\uFE0F Errors (", resetResults.errors.length, ")"] }), _jsxs("div", { style: { display: "grid", gap: 10, fontSize: 14 }, children: [resetResults.errors.slice(0, 10).map((error) => (_jsxs("div", { style: {
                                                    background: "rgba(0,0,0,0.2)",
                                                    padding: "10px 14px",
                                                    borderRadius: 8,
                                                }, children: [_jsx("b", { style: { color: "#fff" }, children: error.displayName }), _jsxs("span", { style: { opacity: 0.7 }, children: ["(", error.userId, ")"] }), " \u2014 ", error.error] }, `${error.userId}-${error.displayName}`))), resetResults.errors.length > 10 ? (_jsxs("div", { style: { fontStyle: "italic", opacity: 0.8, padding: "8px 0" }, children: ["... and ", resetResults.errors.length - 10, " more"] })) : null] })] })) : null] })) : null] })] }));
};
const thStyle = {
    textAlign: "left",
    padding: "16px 14px",
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: 700,
    whiteSpace: "nowrap",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
};
const tdStyle = {
    textAlign: "left",
    padding: "14px",
    color: "#cbd5e1",
    fontSize: 14,
    verticalAlign: "middle",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
};
const tdMonoStyle = {
    ...tdStyle,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 13,
    color: "#94a3b8",
};
const inputStyle = {
    width: "100%",
    minHeight: 46,
    borderRadius: 10,
    padding: "10px 16px",
    fontSize: 14,
    boxSizing: "border-box",
};
const labelStyle = {
    color: "#cbd5e1",
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 8,
};
const hintStyle = {
    color: "#94a3b8",
    fontSize: 13,
    marginTop: 8,
};
const infoBlockStyle = {
    background: "linear-gradient(135deg, rgba(59,130,246,0.15) 0%, rgba(59,130,246,0.05) 100%)",
    border: "1px solid rgba(59,130,246,0.25)",
    borderLeft: "4px solid #3b82f6",
    borderRadius: 14,
    padding: 18,
    color: "#bfdbfe",
    fontSize: 14,
    lineHeight: 1.7,
};
const warningBlockStyle = {
    background: "linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(245, 158, 11, 0.05) 100%)",
    border: "1px solid rgba(245, 158, 11, 0.3)",
    borderLeft: "4px solid #f59e0b",
    borderRadius: 14,
    padding: 18,
    color: "#fde68a",
};
const Pill = ({ label, value }) => (_jsxs("span", { style: {
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
    }, children: [label, " ", _jsx("b", { style: { color: "#f8fafc", fontWeight: 700 }, children: value })] }));
const SectionCard = ({ title, children, }) => (_jsxs("div", { style: {
        borderRadius: 20,
        border: "1px solid rgba(255,255,255,0.1)",
        background: "rgba(255,255,255,0.03)",
        padding: 24,
        minWidth: 0,
        boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
    }, children: [_jsx("div", { style: {
                fontSize: 20,
                fontWeight: 800,
                color: "#f8fafc",
                marginBottom: 20,
                letterSpacing: "-0.01em",
            }, children: title }), _jsx("div", { style: { display: "grid", gap: 16 }, children: children })] }));
const EmptyText = ({ text }) => (_jsx("div", { style: {
        borderRadius: 16,
        border: "2px dashed rgba(148,163,184,0.2)",
        padding: 32,
        color: "#94a3b8",
        textAlign: "center",
        fontSize: 14,
        fontWeight: 500,
        background: "rgba(0,0,0,0.1)",
    }, children: text }));
const ActionCard = ({ icon, title, description, buttonLabel, onClick }) => (_jsxs("div", { className: "ui-action-card", style: {
        borderRadius: 20,
        border: "1px solid rgba(255,255,255,0.1)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%)",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        gap: 20,
        transition: "all 0.3s ease",
        cursor: "pointer",
    }, onClick: onClick, children: [_jsxs("div", { style: { display: "flex", gap: 16, alignItems: "flex-start", flex: 1 }, children: [_jsx("div", { style: {
                        width: 48,
                        height: 48,
                        borderRadius: 14,
                        display: "grid",
                        placeItems: "center",
                        background: "linear-gradient(135deg, rgba(0,184,204,0.2) 0%, rgba(0,184,204,0.05) 100%)",
                        fontSize: 24,
                        border: "1px solid rgba(0,184,204,0.2)",
                    }, children: icon }), _jsxs("div", { style: { minWidth: 0 }, children: [_jsx("div", { style: { color: "#f8fafc", fontSize: 18, fontWeight: 700, marginBottom: 8 }, children: title }), _jsx("div", { style: { color: "#94a3b8", fontSize: 14, lineHeight: 1.6 }, children: description })] })] }), _jsx("button", { className: "btn-postman ui-btn-primary", type: "button", onClick: (e) => {
                e.stopPropagation();
                onClick();
            }, children: buttonLabel })] }));
const Field = ({ label, value, placeholder, hint, onChange }) => (_jsxs("div", { children: [_jsx("div", { style: labelStyle, children: label }), _jsx("input", { className: "st-input", type: "text", value: value, placeholder: placeholder, onChange: (e) => onChange(e.target.value), style: inputStyle }), hint ? _jsx("div", { style: hintStyle, children: hint }) : null] }));
const RowLine = ({ left, right, rightColor = "#f8fafc" }) => (_jsxs("div", { style: {
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        alignItems: "center",
        padding: "14px 18px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(0,0,0,0.15)",
        flexWrap: "wrap",
    }, children: [_jsx("div", { style: { color: "#94a3b8", fontSize: 14, fontWeight: 500, maxWidth: "100%" }, children: left }), _jsx("div", { style: {
                color: rightColor,
                fontSize: 14,
                fontWeight: 700,
                textAlign: "right",
                maxWidth: "100%",
            }, children: right })] }));
const MetricCard = ({ label, value, color }) => (_jsxs("div", { style: {
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.1)",
        background: "rgba(255,255,255,0.03)",
        padding: 24,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "inset 0 2px 10px rgba(0,0,0,0.1)",
    }, children: [_jsx("div", { style: {
                color: "#94a3b8",
                fontSize: 13,
                fontWeight: 600,
                marginBottom: 8,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
            }, children: label }), _jsx("div", { style: { color, fontSize: 36, fontWeight: 800, letterSpacing: "-0.02em" }, children: value })] }));
export default UserResetView;
