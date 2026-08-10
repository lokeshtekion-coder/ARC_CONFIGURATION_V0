import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { registerExtensionTokenSync } from "./services/extensionTokenSync";

registerExtensionTokenSync();


ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);