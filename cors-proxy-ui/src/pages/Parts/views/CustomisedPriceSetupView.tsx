import React, { useEffect } from "react";
import { PartsPlaceholderView } from "../components/PartsPlaceholderView";

export const CustomisedPriceSetupView: React.FC = () => {
  useEffect(() => {
    console.log("[Parts][CustomisedPriceSetupView] mounted");
    return () => console.log("[Parts][CustomisedPriceSetupView] unmounted");
  }, []);

  return (
    <PartsPlaceholderView
      title="Customised price setup"
      description="Blank UI for now. Later this section can contain Customised Price Setup related actions."
    />
  );
};
