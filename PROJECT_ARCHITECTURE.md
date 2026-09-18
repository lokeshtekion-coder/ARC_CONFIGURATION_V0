# Project File Documentation (`PROJECT_ARCHITECTURE.md`)

This document details the core files across the backend proxy, browser extension, and frontend UI in the project.

---

### Backend Server (`cors-proxy/`)

**`cors-proxy/src/server.ts`**
* **Purpose**: Serves as the primary entry point for the Node.js / Express proxy server application.
* **Core Function**: Configures the HTTP server, registers middleware, and establishes base port listening.
* **Imports & Dependencies**: Imports `express`, CORS configuration middleware, logger middleware, and route bundles.
* **Routing**: Binds proxy routes, validation routes, settings routes, and health monitoring endpoints.
* **CORS Handling**: Strips origin headers and dynamically injects CORS response headers to permit UI access.
* **Error Handling**: Implements top-level error catch-alls to ensure the proxy process does not crash unexpectedly.
* **Linked Files**: Connected directly to `middleware/cors.middleware.ts` and `router/proxy.routes.ts`.
* **Environment Context**: Reads port configurations, target host URLs, and timeout settings from `.env`.
* **Logging Integration**: Mounts request-level logging to track incoming calls forwarded to Tekion APIs.
* **Downstream Consumers**: Consumed directly by frontend fetch services (`cors-proxy-ui`) directing API calls to `localhost`.

**`cors-proxy/src/router/proxy.routes.ts`**
* **Purpose**: Manages API forwarding and route multiplexing for target Tekion microservices.
* **Core Function**: Catches incoming UI requests, rewrites URLs, proxies requests, and pipes response streams back.
* **Imports & Dependencies**: Imports Express `Router`, proxy request types, and request logging utilities.
* **Header Forwarding**: Preserves authorization headers, captured Bearer tokens, tenant IDs, and cookies.
* **Target Mapping**: Directs traffic dynamically between Pre-Prod and Production Tekion Cloud endpoints.
* **Response Buffering**: Handles JSON parsing, payload decompression, and raw binary buffer forwarding.
* **Linked Files**: Mounted inside `server.ts` and consumes utilities from `utils/logger.ts`.
* **Security Checks**: Prevents unintended forwarding loops and validates allowed target hostname domains.
* **Diagnostics**: Returns standardized error envelopes when external Tekion services time out or fail.
* **Usage**: Called every time the frontend triggers an API lookup through the local proxy server.

**`cors-proxy/src/services/storage.service.ts`**
* **Purpose**: Manages file-system persistence and retrieval for local blueprint snapshots and cache files.
* **Core Function**: Handles writing, reading, and managing JSON snapshot files stored under `src/data/snapshots/`.
* **Imports & Dependencies**: Imports Node's native `fs/promises`, `path`, and custom file logging utilities.
* **Snapshot Versioning**: Names and indexes snapshots with timestamped strings (e.g., `2026-09-16T12-28-23-891Z.json`).
* **Safe Serialization**: Validates that raw payload structures are valid JSON before persisting to the local disk.
* **Cache Cleanup**: Provides helper methods to prune outdated or invalid snapshot directories.
* **Linked Files**: Imported by `routes/bootstrap.route.ts` and consumed by offline validation routines.
* **Directory Resolution**: Automatically resolves project relative paths across varying developer working directories.
* **Read Fallbacks**: Returns structured fallback data when requested snapshot files are missing or unreadable.
* **Downstream Value**: Powers local blueprint analysis without requiring continuous live network requests.

**`cors-proxy/src/services/validation.service.ts`**
* **Purpose**: Executes verification and schema checks on incoming dealership configuration parameters.
* **Core Function**: Validates accounting configurations, GL mappings, parts catalog codes, and service opcodes.
* **Imports & Dependencies**: Imports validation rule models, storage service helpers, and custom logger utilities.
* **Rule Comparison**: Compares live store rule states against reference blueprint definitions.
* **Error Detection**: Identifies missing GL accounts, invalid departmental IDs, and malformed opcode maps.
* **Report Generation**: Aggregates rule diffs into structured JSON summaries containing warning and error tallies.
* **Linked Files**: Consumed by `routes/validation.route.ts` and surfaces results to UI validation components.
* **Asynchronous Processing**: Supports chunked analysis across large datasets without blocking Express event loops.
* **Data Sanitization**: Trims string inputs, formats numbers, and normalizes disparate naming schemas.
* **UI Output**: Serves as the validation backend for the frontend `GLValidation.tsx` screen.

---

### Browser Extension (`cors-proxy-ui/extension/`)

**`cors-proxy-ui/extension/manifest.json`**
* **Purpose**: Manifest V3 declaration file defining the extension's metadata, permissions, and script registrations.
* **Core Function**: Grants web request listening capabilities and hooks content/inject scripts into web pages.
* **Permissions**: Declares `webRequest`, `storage`, `cookies`, `activeTab`, and `declarativeNetRequest`.
* **Host Permissions**: Specifies domain match patterns for `tekioncloud.com`, `sharepoint.com`, and `localhost`.
* **Background Worker**: Binds `dist/background.js` as the persistent/service worker process.
* **Content Scripts**: Matches URL routes on Tekion portals to inject `dist/content.js` and `dist/inject.js`.
* **Popup UI**: Links `popup.html` as the browser toolbar dropdown view.
* **Web Accessible Resources**: Exposes injection assets so web pages can access the bridge script.
* **Security Policy**: Sets CSP directives compatible with modern Chromium Manifest V3 requirements.
* **Build Relationship**: Compiled from TypeScript source files located in `extension/src/`.

**`cors-proxy-ui/extension/src/background.ts`**
* **Purpose**: Extension background service worker responsible for network request interception and token extraction.
* **Core Function**: Captures active Bearer auth tokens, cookies, and Graph API credentials directly from headers.
* **Imports & Dependencies**: Imports extension message interfaces, token helper types, and storage definitions.
* **Header Interception**: Listens to outgoing HTTP requests via `chrome.webRequest.onBeforeSendHeaders`.
* **SPFx Token Handling**: Detects and extracts Microsoft Graph access tokens exchanged inside SharePoint pages.
* **Session Storage**: Stores intercepted tokens in `chrome.storage.local` indexed by tenant and dealer identifiers.
* **Message Relaying**: Dispatches runtime messages to content scripts to broadcast captured data to the UI.
* **Linked Files**: Compiles to `extension/dist/background.js` and communicates with `extension/src/content.ts`.
* **Scope Validation**: Filters captured tokens to ensure they contain necessary file and site authorization scopes.
* **Downstream Impact**: Provides fresh credentials so the UI never requires manual token copying.

**`cors-proxy-ui/extension/src/content.ts`**
* **Purpose**: Content script running in the DOM context of targeted web portals and the local dashboard.
* **Core Function**: Bridges the communication gap between the extension service worker and the UI page window.
* **Imports & Dependencies**: Imports message payload interfaces and bridge event names.
* **DOM Messaging**: Listens for `window.postMessage` events emitted by web pages and proxies them to the extension.
* **Token Broadcasting**: Receives newly captured credentials from `background.ts` and posts them to `localhost`.
* **Injection Handling**: Safely appends `inject.js` into active Tekion application pages.
* **Linked Files**: Interfaces with `extension/src/background.ts` and frontend `services/extensionBridge.ts`.
* **Origin Verification**: Restricts dispatched token events strictly to authorized origin URLs.
* **Lifecycle Hooks**: Triggers on initial document load to immediately announce extension presence to the UI.
* **Debugging**: Logs capture status events to the developer browser console for inspection.

---

### Frontend Services & Data Layer (`cors-proxy-ui/src/services/`)

**`cors-proxy-ui/src/services/storesDb.ts`**
* **Purpose**: Client-side storage layer combining an IndexedDB database with a `localStorage` status vault.
* **Core Function**: Persists store records, custom operational phases, and status transition timestamps.
* **Imports & Dependencies**: Imports `openDB`, `DBSchema`, and `IDBPDatabase` from the `idb` library.
* **IndexedDB Architecture**: Initializes and maintains an object store named `stores` keyed by `tekion_id`.
* **Status Vault**: Reads and writes fast status overrides (`fixed_ops_status`, `variable_ops_status`, `testing_status`).
* **Timeline Logging**: `recordStatusTransition()` tracks transitions (`WIP`, `Completed`) with custom or live timestamps.
* **Bulk Updates**: Provides `bulkUpdateStatusVault()` to synchronize batch Excel status changes into local storage.
* **Linked Files**: Consumed directly by `Stores.tsx`, `storesGraphSync.ts`, and `storesExcelShared.ts`.
* **Resilience**: Contains fallback wrappers to prevent UI freezes if indexed storage fails or is cleared.
* **Central Role**: Guarantees fast local dashboard boot times before remote SharePoint reconciliation occurs.

**`cors-proxy-ui/src/services/storesGraphSync.ts`**
* **Purpose**: Orchestrates two-way integration with Microsoft SharePoint workbooks via the Graph API.
* **Core Function**: Pulls, merges, writes, styles, and patches dealership onboarding data across monthly Excel sheets.
* **Imports & Dependencies**: Imports store models from `storesDb`, token loaders, headers, and formula formatters.
* **Workbook Sessions**: Creates and closes persistent Graph workbook sessions to prevent file locking conflicts.
* **Formula Injection**: Inserts self-referencing circular Excel formulas into tracking columns to lock modification times.
* **Single Cell Patching**: `patchSingleStoreStatusInGraph()` updates individual status and timestamp cells in seconds.
* **Background Polling**: `pullStatusUpdatesFromGraph()` performs non-blocking reads to discover manual Excel changes.
* **Admin Verification**: Integrates `isUserAdmin()` to ensure only authorized admins can revert `Completed` statuses.
* **Linked Files**: Imported by `Stores.tsx` and works hand-in-hand with `storesExcelShared.ts`.
* **Automated Styling**: Evaluates status values and dynamically applies green, amber, and grey fills to Excel cells.

**`cors-proxy-ui/src/services/storesExcelShared.ts`**
* **Purpose**: Shared data mapping, header configuration, and timestamp formatting library for store Excel sync.
* **Core Function**: Converts raw `StoreRecord` objects into formatted Excel matrix rows and evaluates formulas.
* **Imports & Dependencies**: Imports `StoreRecord` models, `getStatusTimeline` from `storesDb`, and onboarding status types.
* **Header Definition**: Exports `STORE_EXPORT_HEADERS` containing 36 columns including discrete tracking headers.
* **Time Sanitization**: `sanitizeExcelTimestamp()` parses raw Excel strings, standard dates, and numeric time serials.
* **High-Precision Formatting**: `formatTimeOnlyPrecise()` outputs uniform timestamps formatted as `HH:MM:SS AM/PM`.
* **Grouping Logic**: `groupStoresByMonth()` organizes stores into separate monthly sheet buckets based on launch dates.
* **Tracking Retrieval**: `buildLatestFieldTrackingText()` inspects the local timeline to pull the newest transition time.
* **Linked Files**: Consumed by `storesGraphSync.ts`, `storesExcelExport.ts`, and the main `Stores.tsx` screen.
* **Data Consistency**: Ensures both the web UI and Excel export files present identical text structures.

**`cors-proxy-ui/src/services/extensionBridge.ts`**
* **Purpose**: Client-side receiver that receives captured tokens and headers sent by the Chrome extension.
* **Core Function**: Subscribes to window message events and writes captured session states into reactive storage.
* **Imports & Dependencies**: Imports capture storage utilities and typing definitions from `extensionCaptureStore.ts`.
* **Message Filtering**: Validates incoming event structures to ignore noisy postMessage traffic from third-party scripts.
* **Profile Extraction**: Extracts Bearer tokens, dealer codes, user emails, and tenant details from extension payloads.
* **Graph Token Relay**: Extracts Microsoft Graph tokens and updates `tekionApiSettings` automatically.
* **Linked Files**: Directly fed by `extension/src/content.ts` and read by UI components and API callers.
* **Event Dispatching**: Emits local storage update events so React components can re-render immediately upon token capture.
* **Error Detection**: Flags expired tokens and informs the top bar warning banners across the app.
* **Workflow Acceleration**: Eliminates manual token entry by keeping development sessions continuously authenticated.

**`cors-proxy-ui/src/services/authHelper.ts`**
* **Purpose**: Evaluates authentication identities, decodes JWT payloads, and determines admin privileges.
* **Core Function**: Decodes user claims from JWTs to verify whether the active user has administrative rights.
* **Imports & Dependencies**: Imports setting loaders from `tekionApiSettings.ts` and capture loaders from `extensionBridge.ts`.
* **Admin Whitelist**: Enforces administrative authority against designated admin email addresses (`tlreddy@tekion.com`).
* **Base64 Decoding**: Safely parses the payload segment of JWT tokens without relying on external cryptographic dependencies.
* **Claim Inspection**: Scans candidate claim fields (`email`, `upn`, `unique_name`, `preferred_username`) to resolve identity.
* **Storage Fallbacks**: Checks `localStorage` user keys if token claims cannot be fully decoded.
* **Role Check**: Exports `isUserAdmin(): boolean` used to guard status reversions on the dashboard.
* **Linked Files**: Imported inside `Stores.tsx` and `storesGraphSync.ts` before allowing task status reversions.
* **Security Audit**: Prevents non-admin team members from accidentally reverting completed tasks in the tracking sheet.

---

### Frontend Pages & Views (`cors-proxy-ui/src/pages/`)

**`cors-proxy-ui/src/pages/Stores.tsx`**
* **Purpose**: Main operational command dashboard for tracking dealership go-lives, blueprints, and task sign-offs.
* **Core Function**: Renders store tables, filters, inline status pickers, timestamps, Slack modal dispatchers, and sync buttons.
* **Imports & Dependencies**: Imports React hooks, API services, database helpers, Slack tools, and auth guards.
* **Immediate Local Render**: Boots using local IndexedDB and Status Vault data so the UI loads without blocking network calls.
* **Inline Tracking Display**: Renders high-precision timestamps directly underneath Fixed Ops and Variable Ops dropdowns.
* **Live Status Patching**: Changing dropdown values invokes `updateCustomStatus()`, instantly pushing changes to SharePoint Excel.
* **Background Polling**: Employs an interval timer and window focus listener to reconcile remote Excel changes.
* **Filtering Engine**: Filter stores dynamically by T-minus range presets, launch dates, Superpods, and product types.
* **Linked Files**: Links to `DealerMetaModal`, `storesGraphSync.ts`, `storesDb.ts`, and internal Tekion deep-links.
* **Slack Integration**: Opens drawer modals populated with candidate recipients and pre-drafted status messages.

**`cors-proxy-ui/src/pages/Home.tsx`**
* **Purpose**: Landing page and navigational portal for the entire configuration toolkit.
* **Core Function**: Displays module overview cards and routes users into Accounting, Parts, Service, or Store trackers.
* **Imports & Dependencies**: Imports React, layout components, and router/state navigation triggers.
* **Module Routing**: Allows seamless navigation between GLAM, opcode management, decoder bots, and settings.
* **Session Telemetry**: Highlights whether background proxies and extension capture workers are actively connected.
* **Responsive Layout**: Uses Tailwind CSS grid and flex patterns to render cards cleanly on varying screen widths.
* **Quick Actions**: Surfaces shortcuts to launch recent store workorders or view captured token properties.
* **Linked Files**: Mounted directly inside `App.tsx` as the default screen.
* **Help Documentation**: Embeds helpful tooltips and links directing engineers to internal Tekion portal dashboards.
* **User Onboarding**: Provides first-time setup instructions when no captured sessions or database records are detected.

**`cors-proxy-ui/src/pages/Accounting/GLAM/GLAM.tsx`**
* **Purpose**: General Ledger Account Mapping (GLAM) management screen for dealership financial configurations.
* **Core Function**: Displays and organizes account mapping categories across Fixed and Variable Operations.
* **Imports & Dependencies**: Imports GLAM configuration models, sub-view tab components, and rule evaluation hooks.
* **Category Segmentation**: Breaks financial rules down into Parts, Service, New Vehicles, Used Vehicles, and F&I Products.
* **Search & Lookup**: Allows accountants and engineers to filter accounts by account numbers, descriptions, or transaction types.
* **Validation Rules**: Visualizes missing mapping warnings against Chart of Accounts reference schemas.
* **Sub-module Integration**: Mounts child views located under `pages/Accounting/GLAM/` subdirectories.
* **Linked Files**: Integrated into `Accounting.tsx` and reads terminology maps from `terminology/GLAM.json`.
* **State Management**: Keeps track of edited mappings before triggering batch proxy updates back to Tekion services.
* **Export Utilities**: Enables downloading mapping configurations as JSON or formatted tabular audit sheets.

**`cors-proxy-ui/src/pages/BlueprintDecoder.tsx`**
* **Purpose**: Diagnostic decoding utility for inspecting and validating complex blueprint form definitions.
* **Core Function**: Ingests raw Tekion blueprint JSON payloads, resolves internal form IDs, and displays structured schemas.
* **Imports & Dependencies**: Imports blueprint decoders from `utils/blueprintFormDecoder.ts` and custom decoder CSS.
* **JSON Analysis**: Parses nested question trees, conditional logic blocks, and department-specific sign-off criteria.
* **Visual Representation**: Displays human-readable field labels instead of raw database GUIDs or instance IDs.
* **Diffing Tool**: Enables side-by-side comparison between reference blueprint templates and live dealership blueprints.
* **Searchable Hierarchy**: Allows filtering questions and answers by business department (Parts, Accounting, Service).
* **Linked Files**: Uses `services/blueprintDecodeBot.ts` and accesses blueprint files in `cors-proxy/src/data/blueprint/`.
* **Offline Testing**: Can load and decode static blueprint snapshots stored locally when network access is absent.
* **Export Options**: Lets users export decoded question-and-answer checklists for review with dealership stakeholders.

**`cors-proxy-ui/src/pages/Settings.tsx`**
* **Purpose**: System settings and configuration hub for managing tokens, credentials, and cache lifecycles.
* **Core Function**: Provides inputs to view, enter, or refresh Microsoft Graph tokens, Slack session cookies, and API endpoints.
* **Imports & Dependencies**: Imports settings persistence services, auth helpers, and token status badges.
* **Token Diagnostics**: Inspects active tokens, displays remaining lifespan, and highlights missing permissions.
* **Cache Management**: Contains buttons to wipe local IndexedDB tables, reset the Status Vault, or clear temporary cache.
* **SharePoint Config**: Allows verifying Drive IDs, Item IDs, and workbook URLs pointing to SharePoint tracker sheets.
* **Slack Credentials**: Manages Slack user tokens and session cookies (`d-cookie`) required for direct message drafting.
* **Linked Files**: Updates `tekionApiSettings.ts`, resets `storesDb.ts`, and updates extension capture parameters.
* **User Identity Display**: Shows the currently identified user email and clarifies whether admin rights are active.
* **Environment Switcher**: Allows toggling target proxy forwarding between Pre-Prod and Production environments.