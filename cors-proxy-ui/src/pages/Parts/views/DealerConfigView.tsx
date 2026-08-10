import React, { useEffect } from "react";
import { PartsPlaceholderView } from "../components/PartsPlaceholderView";

export const DealerConfigView: React.FC = () => {
  useEffect(() => {
    console.log("[Parts][DealerConfigView] mounted");
    return () => console.log("[Parts][DealerConfigView] unmounted");
  }, []);

  return (
    <PartsPlaceholderView
      title="Dealer config"
      description="Blank UI for now. Later this section can contain Dealer Config related actions."
    />
  );
};
