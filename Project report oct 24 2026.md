# ARC Configuration V0: Code Review Report (Oct 24, 2026)

## Scope and coverage

This review covers the whole project: the Express backend (`cors-proxy/`), the React UI (`cors-proxy-ui/`), the Chrome extension (`cors-proxy-ui/extension/`), and root scripts (`scripts/auto-update.cjs`, `setup.js`, `PROJECT.jsx`).

The project has about 65,000 lines of hand-written source, most of it in the UI. I read the backend routes, middleware, and proxy logic in full. I read the extension's content script and key parts of its background worker. For the UI I ran targeted scans for security patterns (credentials, unsafe HTML, token storage, auth headers) and read the code those scans flagged. I did not read every UI view line by line, so UI logic bugs are likely under-reported. Data folders (`data/`, `src/data/`, `dist/`, `node_modules/`) were excluded.

No secret values are reproduced in this report.

## Summary

| # | Severity | Area | Issue |
|---|---|---|---|
| 1 | Critical | Config / secrets | Live partner credentials stored in plaintext in `cors-proxy/.env`, which is not git-ignored |
| 2 | Critical | Extension | Extension captures Tekion, Slack, and SharePoint tokens, mints a Graph token with `Files.ReadWrite.All`, and exposes the captured state to any script on the matched pages |
| 3 | High | Auth | API auth is disabled in the current dev config (`BYPASS_AUTH=true`), and the UI never sends the bearer token anyway |
| 4 | High | Hard-coded password | Bulk password reset uses the hard-coded default `Happyday1` for all active users |
| 5 | High | SSRF | Allowlist is checked only on the initial URL; axios follows up to 3 redirects, so an allowed host can redirect to an internal or disallowed address |
| 6 | High | SSRF | `/api/settings/tekion-token` takes an arbitrary `endpoint` with no allowlist check |
| 7 | High | Path traversal | `dealerId` is joined into filesystem paths without validation in snapshot save, list, and read routes |
| 8 | Medium | Validation | `/api/validation/run` is a stub that marks every extracted account as `matched: true` |
| 9 | Medium | Dead code | `routes/validation.ts` is never mounted; `middleware/cors.middleware.ts` is never used and has a different allowlist |
| 10 | Medium | Browser exposure | Any web page can send blind POSTs to `localhost:4000` when auth is bypassed (CORS blocks reads, not requests) |
| 11 | Medium | Tokens in browser | Tekion bearer tokens persisted in `localStorage`, readable by any script on the origin |
| 12 | Medium | Auto-update | `predev` runs `git pull` and `npm install` automatically on every dev start |
| 13 | Low | Performance | Backup history is hashed and re-listed on every save; history and snapshot folders grow without bound |
| 14 | Low | Maintainability | Very large components (up to ~2,600 lines), duplicated slaReport generators, unused dependencies, stale architecture diagram |

## Findings

### 1. Plaintext credentials in `cors-proxy/.env` (Critical)

The `.env` file holds login usernames and passwords, API keys, and the `API_SECRET_KEY` for the proxy. The root `.gitignore` does not list `.env`, and `cors-proxy/` has no `.gitignore` of its own. Anyone who runs `git add .` can commit these values, and `scripts/auto-update.cjs` pulls from a shared repository, so the risk extends to every clone.

Recommended fix: add `.env` and `*.env` to `.gitignore`, check git history for prior commits, rotate every credential in the file, and move secrets into a per-machine secret store. Keep a `.env.example` with placeholder values.

### 2. Chrome extension captures and exposes sensitive tokens (Critical)

The extension (`background.ts`) uses `webRequest` on `<all_urls>` host permissions to read `Authorization` headers, `tekion-api-token`, `tap-duo-api-token`, Slack request bodies, and cookies. It stores captured state in `chrome.storage.local`.

It also intercepts an SPFx `refresh_token` from `login.microsoftonline.com` request bodies and exchanges it for a Microsoft Graph token with `Files.ReadWrite.All` scope. That is a privilege escalation that the user has not clearly consented to.

The content script (`content.ts`) answers any page message of type `ARC_EXTENSION_BRIDGE_REQUEST_LATEST` by posting the full captured payload back to the page. The page-side check (`event.origin === window.location.origin`) only stops other origins. Any script running on `tap.tekioncloud.com` or `localhost` (including an injected third-party script or XSS) can read the tokens.

Recommended fix: limit capture to the specific hosts and headers that are needed, drop the refresh-token exchange unless it is essential, return only short-lived or redacted values to the page, and remove the Graph-token minting or document it and get sign-off. Also note that the content-script match `http://localhost/*` matches only port 80, so the dev UI on ports 3000 or 5173 likely never receives the bridge. Verify this before relying on it.

### 3. Backend auth is effectively off, and the UI cannot use it (High)

`authGuard` in `server.ts` returns early whenever `NODE_ENV` is not `production` and either `BYPASS_AUTH=true` or `API_SECRET_KEY` is unset. The current `.env` sets `BYPASS_AUTH=true`, so every `/api/*` route is open to any local caller.

Separately, all 41 call sites in the UI that reach `localhost:4000` send only `Content-Type`, with no `Authorization` header. Setting `API_SECRET_KEY` without bypass would therefore break the app, and leaving bypass on leaves the API open. The two need to be fixed together: have the UI attach the token (for example from a build-time or per-install secret), or move to a session-based check.

### 4. Hard-coded default password for bulk resets (High)

`pages/Parts/views/User Setup/index.tsx` defines `DEFAULT_PASSWORD = "Happyday1"` and uses it as the initial value for both the "reset all" and "reset by role" flows. These flows update every active employee user on a dealer. The UI does ask for `window.confirm`, which helps, but the default password is still a predictable shared value that will persist if someone clicks through.

Recommended fix: generate a random one-time password per run, show it to the operator once, and require a non-default value.

### 5. SSRF allowlist is bypassable through redirects (High)

In `router/proxy.routes.ts`, `validateTargetUrl` checks the hostname, protocol, port, and private-IP ranges once, before the request. The request then goes out through axios with `maxRedirects: 3`, and each redirect target is not checked. The `/upload` route uses `fetch`, which also follows redirects by default.

An allowed `*.tekion.com` host that redirects to `169.254.169.254` or an internal address would bypass the check. Also, `isPrivateOrLoopback` only handles dotted-quad literals. It does not cover IPv6 forms, decimal or hex IPs, or DNS names that resolve to private addresses.

Recommended fix: set `maxRedirects: 0`, or validate each hop; resolve DNS and check the resolved address; add a request-body and response-size guard on `/upload` (the 25 MB limit applies only to the JSON route).

### 6. Unrestricted endpoint in the token route (High)

`routes/settings.route.ts`, `POST /tekion-token`, accepts any `endpoint` from the request body and sends the username and password to it. It does not run `validateTargetUrl`. This is an SSRF path with credential exposure: a caller can send a user's password to any host.

Also, when the upstream response has no token, the route returns the whole upstream body (`raw`) to the caller, and `upstream.json()` throws a 500 on non-JSON responses. There is no rate limit on this route.

Recommended fix: restrict `endpoint` to an allowlist of known Tekion auth URLs, drop the `raw` echo, and apply a rate limit.

### 7. `dealerId` used directly in file paths (High)

`services/storage.service.ts`, `saveDealerSnapshot`, `getTimestamps`, and `getDealers` build paths with `path.join(SNAPSHOT_DIR, dealerId)` and no validation. `deleteDealerSnapshots` does check that the path stays under the root, but the save and read paths do not. A `dealerId` such as `../../something` would create directories and write `<timestamp>.json` files outside the snapshot folder. Blueprint and bootstrap saves are less exposed because the filename has a prefix, but `dealerId` can still contain path separators.

Recommended fix: validate `dealerId` against a strict pattern (for example `^[A-Za-z0-9_-]{1,64}$`) at the route boundary and resolve-and-check paths in one shared helper.

### 8. Validation run is a placeholder (Medium)

`routes/validation.ts` (the GL check) contains `matched: true, // ← replace with real matching logic`. The active router uses `services/validation.service.ts` instead, which I did not read in full. Please confirm that `runValidation` is real logic before relying on the `/api/validation/run` results. If it is also a stub, the UI's "matched / unmatched" counts are not trustworthy.

### 9. Dead and duplicate code (Medium)

- `cors-proxy/src/routes/validation.ts` is never imported. Its `/save` duplicates the active route and writes to a different folder (`validation-data/`). Delete it.
- `cors-proxy/src/middleware/cors.middleware.ts` is never used. `server.ts` builds its own CORS config, and the two allowlists differ (for example, the unused file allows `*.tekion.com` by regex, the server does not). Delete it or use one source of truth.
- `morgan` is listed in `cors-proxy/package.json` but never imported.
- `PROJECT.jsx` is a Mermaid diagram component that references files and routes that may not match the current layout. Regenerate or remove it.

### 10. Blind cross-site requests to localhost (Medium)

With auth bypassed, `localhost:4000` accepts requests from any origin. CORS only stops the browser from reading the response; it does not stop the request from being sent. Any website the user visits can submit a form or `fetch` with a simple `Content-Type` to `/api/proxy`, which forwards to allowlisted Tekion hosts. The attacker cannot read the results, but can trigger state-changing calls, provided they know the endpoint and the headers that Tekion expects.

Recommended fix: enforce the bearer token (see finding 3). As a fallback, reject requests whose `Origin` header is not on the allowlist, even when auth is bypassed.

### 11. Tokens persisted in `localStorage` (Medium)

`pages/TGPT/hooks.ts`, `pages/Parts/views/CouponsView.tsx`, `pages/Service/Coupons/index.tsx`, and `services/tekionApiSettings.ts` store Tekion bearer tokens, global headers (including `tekion-api-token`), and user IDs in `localStorage`. Any XSS in the app reads them. The `MessageBubble` markdown output is sanitized with DOMPurify, which is good; the remaining risk is in the storage model.

Recommended fix: keep short-lived tokens in memory and refetch them through the backend when needed, or use an HTTP-only cookie if the proxy can issue one.

### 12. Auto-update runs `git pull` and `npm install` on every dev start (Medium)

`scripts/auto-update.cjs` runs as `predev`. It fetches `origin/main`, runs `git pull --ff-only`, and then runs `npm install` in whichever folder changed. Whatever lands on `main` runs on every developer machine the next time they start the dev server, with no review step. The script is careful about dirty trees and diverged history, which is good. The remaining risk is trust in `main` and in `npm install` lifecycle scripts.

Recommended fix: make the update opt-in (`npm run update`), or require a signed tag. At minimum, use `npm ci` and `--ignore-scripts` where possible.

### 13. Performance and growth (Low)

- `rotateHistoryBackup` in `sqliteStores.service.ts` hashes the entire backup file and calls `readdirSync` and `statSync` on every history file on every save. With retention up to 60 days, that is thousands of stat calls per save as history grows. Keep a short index in memory or in SQLite.
- `saveDealerSnapshot` and the blueprint and bootstrap saves write a new JSON file for every run with no retention. The `data/backup/excel` folder already holds hundreds of files. Add retention or move these into the SQLite store.
- The stores sync writes the full dataset atomically on every save. That is safe, but the cost grows with store count. Measure before optimizing.

### 14. Maintainability (Low)

Several UI files are very large: `Stores.tsx` (~2,400 lines), `PriceCodeView.tsx` (~2,600), `BlueprintDecoder.tsx` (~1,950), `Settings.tsx` (~1,850), and `GLAM.tsx` (~1,340). The SLA report generator exists in three similar copies (`slaReportGenerator_na.ts`, `slaReportClientScript.ts`, and `slaReportHtmlTemplate.ts`). Consolidate them, and split the large views into a page shell plus hooks and sections.

Two Tekion-specific constants are duplicated across files: the auth endpoint and the `DEFAULT_PASSWORD`. Move them to a single config module.

The root `package.json` has `typescript` at `^7.0.2`, while `cors-proxy` uses `^5.4.5` and the UI uses `^5.9.3`. Align the versions.

## Recommended order of work

1. Rotate the credentials in `.env`, add it to `.gitignore`, and check git history (finding 1).
2. Turn on API auth end to end, and remove the default password (findings 3 and 4).
3. Fix the SSRF gaps and the `dealerId` path handling (findings 5, 6, and 7).
4. Narrow the extension's capture scope and remove the Graph-token minting unless it is approved (finding 2).
5. Remove dead code and verify the validation logic (findings 8 and 9).
6. Address storage and performance items as they become a problem (findings 11 to 13).

## Open questions

- Is the `refresh_token` exchange in the extension an approved, documented feature? If not, it should be removed.
- Should `validation.service.ts` be reviewed in full? I did not read it.
- Is `BYPASS_AUTH=true` intended for every developer machine, or only for local work?
