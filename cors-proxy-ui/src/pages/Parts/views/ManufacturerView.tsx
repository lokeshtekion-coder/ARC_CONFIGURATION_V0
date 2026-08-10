import React, { useEffect } from "react";
import { PartsPlaceholderView } from "../components/PartsPlaceholderView";

export const ManufacturerView: React.FC = () => {
  useEffect(() => {
    console.log("[Parts][ManufacturerView] mounted");
    return () => console.log("[Parts][ManufacturerView] unmounted");
  }, []);

  return (
    <PartsPlaceholderView
      title="Manufacturer"
      description="Blank UI for now. Later this section can contain Manufacturer related actions."
    />
  );
};
