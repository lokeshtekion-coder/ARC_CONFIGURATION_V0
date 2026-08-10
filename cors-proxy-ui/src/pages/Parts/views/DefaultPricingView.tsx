import React, { useEffect } from "react";
import { PartsPlaceholderView } from "../components/PartsPlaceholderView";

export const DefaultPricingView: React.FC = () => {
  useEffect(() => {
    console.log("[Parts][DefaultPricingView] mounted");
    return () => console.log("[Parts][DefaultPricingView] unmounted");
  }, []);

  return (
    <PartsPlaceholderView
      title="Default pricing"
      description="Blank UI for now. Later this section can contain Default Pricing related actions."
    />
  );
};
