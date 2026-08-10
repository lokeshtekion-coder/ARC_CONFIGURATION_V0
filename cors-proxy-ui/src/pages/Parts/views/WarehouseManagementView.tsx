import React, { useEffect } from "react";
import { PartsPlaceholderView } from "../components/PartsPlaceholderView";

export const WarehouseManagementView: React.FC = () => {
  useEffect(() => {
    console.log("[Parts][WarehouseManagementView] mounted");
    return () => console.log("[Parts][WarehouseManagementView] unmounted");
  }, []);

  return (
    <PartsPlaceholderView
      title="Warehouse management"
      description="Blank UI for now. Later this section can contain Warehouse Management related actions."
    />
  );
};
