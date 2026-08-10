import React, { useEffect } from "react";
import { PartsPlaceholderView } from "../components/PartsPlaceholderView";

export const CoreManagementSetupView: React.FC = () => {
  useEffect(() => {
    console.log("[Parts][CoreManagementSetupView] mounted");
    return () => console.log("[Parts][CoreManagementSetupView] unmounted");
  }, []);

  return (
    <PartsPlaceholderView
      title="Core Management Setup"
      description="Blank UI for now. Later this section can contain Core Management Setup related actions."
    />
  );
};
