import { useEffect, useRef } from "react";
import mermaid from "mermaid";

mermaid.initialize({ startOnLoad: true });

const chartCode = `
flowchart TD
subgraph group_ui["React UI"]
  node_vite["Vite build<br/>build config<br/>[vite.config.ts]"]
  node_ui_entry["UI entry<br/>React entry<br/>[main.tsx]"]
  node_app["App shell<br/>SPA navigation<br/>[App.tsx]"]
  node_store_services["Store management<br/>service layer<br/>[storesDb.ts]"]
  node_tekion_adapters["Tekion adapters<br/>integration services<br/>[tekionStoresApi.ts]"]
  node_blueprint_client["Blueprint workflow<br/>client ingestion"]
  node_domain_screens["Department configuration<br/>domain screens<br/>[Accounting.tsx]"]
  node_validation_ui["Validation tools<br/>diagnostic UI<br/>[GLValidation.tsx]"]
  node_extension_bridge["Extension bridge<br/>capture services<br/>[extensionBridge.ts]"]
end

subgraph group_proxy["Proxy API"]
  node_server["Proxy server<br/>Node server<br/>[server.ts]"]
  node_cors_middleware["CORS middleware<br/>[cors.middleware.ts]"]
  node_proxy_routes["Outbound proxy routes<br/>routing layer<br/>[proxy.routes.ts]"]
  node_bootstrap_routes["Bootstrap routes<br/>ingestion API<br/>[bootstrap.route.ts]"]
  node_validation_api["Validation API<br/>evaluation API"]
  node_storage[("Artifact storage<br/>storage service<br/>[storage.service.ts]")]
  node_saved_artifacts["Saved blueprints and snapshots<br/>versioned artifacts"]
end

subgraph group_extension["Browser Extension"]
  node_manifest["Extension manifest<br/>extension entry<br/>[manifest.json]"]
  node_extension_runtime["Extension runtime<br/>background/content/popup<br/>[background.ts]"]
end

node_vite -->|"builds"| node_ui_entry
node_ui_entry -->|"mounts"| node_app
node_app -->|"uses"| node_store_services
node_store_services -->|"retrieves store data via"| node_tekion_adapters
node_app -->|"hosts"| node_domain_screens
node_app -->|"runs"| node_blueprint_client
node_app -->|"hosts"| node_validation_ui
node_app -->|"uses captured context"| node_extension_bridge
node_extension_bridge -->|"communicates with"| node_extension_runtime
node_manifest -->|"declares"| node_extension_runtime
node_tekion_adapters -->|"sends browser-limited calls to"| node_proxy_routes
node_blueprint_client -->|"submits extraction to"| node_bootstrap_routes
node_validation_ui -->|"evaluates through"| node_validation_api
node_server -->|"applies"| node_cors_middleware
node_cors_middleware -->|"permits requests to"| node_proxy_routes
node_server -->|"serves"| node_bootstrap_routes
node_server -->|"serves"| node_validation_api
node_bootstrap_routes -->|"persists via"| node_storage
node_validation_api -->|"stores results via"| node_storage
node_storage -->|"retains"| node_saved_artifacts

click node_vite "https://github.com/lokeshtekion-coder/arc_configuration_v0/blob/main/cors-proxy-ui/vite.config.ts"
click node_ui_entry "https://github.com/lokeshtekion-coder/arc_configuration_v0/blob/main/cors-proxy-ui/src/main.tsx"
click node_app "https://github.com/lokeshtekion-coder/arc_configuration_v0/blob/main/cors-proxy-ui/src/App.tsx"
click node_store_services "https://github.com/lokeshtekion-coder/arc_configuration_v0/blob/main/cors-proxy-ui/src/services/storesDb.ts"
click node_tekion_adapters "https://github.com/lokeshtekion-coder/arc_configuration_v0/blob/main/cors-proxy-ui/src/services/tekionStoresApi.ts"
click node_blueprint_client "https://github.com/lokeshtekion-coder/arc_configuration_v0/blob/main/cors-proxy-ui/src/utils/bootstrapExtractor.ts"
click node_domain_screens "https://github.com/lokeshtekion-coder/arc_configuration_v0/blob/main/cors-proxy-ui/src/pages/Accounting/Accounting.tsx"
click node_validation_ui "https://github.com/lokeshtekion-coder/arc_configuration_v0/blob/main/cors-proxy-ui/src/pages/GLValidation.tsx"
click node_extension_bridge "https://github.com/lokeshtekion-coder/arc_configuration_v0/blob/main/cors-proxy-ui/src/services/extensionBridge.ts"
click node_server "https://github.com/lokeshtekion-coder/arc_configuration_v0/blob/main/cors-proxy/src/server.ts"
click node_cors_middleware "https://github.com/lokeshtekion-coder/arc_configuration_v0/blob/main/cors-proxy/src/middleware/cors.middleware.ts"
click node_proxy_routes "https://github.com/lokeshtekion-coder/arc_configuration_v0/blob/main/cors-proxy/src/router/proxy.routes.ts"
click node_bootstrap_routes "https://github.com/lokeshtekion-coder/arc_configuration_v0/blob/main/cors-proxy/src/routes/bootstrap.route.ts"
click node_validation_api "https://github.com/lokeshtekion-coder/arc_configuration_v0/blob/main/cors-proxy/src/routes/validation.route.ts"
click node_storage "https://github.com/lokeshtekion-coder/arc_configuration_v0/blob/main/cors-proxy/src/services/storage.service.ts"
click node_saved_artifacts "https://github.com/lokeshtekion-coder/arc_configuration_v0/tree/main/cors-proxy/src/data/blueprint"
click node_manifest "https://github.com/lokeshtekion-coder/arc_configuration_v0/blob/main/cors-proxy-ui/extension/manifest.json"
click node_extension_runtime "https://github.com/lokeshtekion-coder/arc_configuration_v0/blob/main/cors-proxy-ui/extension/src/background.ts"

classDef toneNeutral fill:#f8fafc,stroke:#334155,stroke-width:1.5px,color:#0f172a
classDef toneBlue fill:#dbeafe,stroke:#2563eb,stroke-width:1.5px,color:#172554
classDef toneAmber fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
classDef toneMint fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px,color:#14532d
classDef toneRose fill:#ffe4e6,stroke:#e11d48,stroke-width:1.5px,color:#881337
classDef toneIndigo fill:#e0e7ff,stroke:#4f46e5,stroke-width:1.5px,color:#312e81
classDef toneTeal fill:#ccfbf1,stroke:#0f766e,stroke-width:1.5px,color:#134e4a
class node_vite,node_ui_entry,node_app,node_store_services,node_tekion_adapters,node_blueprint_client,node_domain_screens,node_validation_ui,node_extension_bridge toneBlue
class node_server,node_cors_middleware,node_proxy_routes,node_bootstrap_routes,node_validation_api,node_storage,node_saved_artifacts toneAmber
class node_manifest,node_extension_runtime toneMint
`;

export const ArchitectureDiagram = () => {
    const ref = useRef(null);

    useEffect(() => {
        if (ref.current) {
            mermaid.contentLoaded();
        }
    }, []);

    return (
        <div className="mermaid" ref={ref}>
            {chartCode}
        </div>
    );
};