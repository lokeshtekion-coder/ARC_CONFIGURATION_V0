import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect } from "react";
import { PartsPlaceholderView } from "../components/PartsPlaceholderView";
export const WarehouseManagementView = () => {
    useEffect(() => {
        console.log("[Parts][WarehouseManagementView] mounted");
        return () => console.log("[Parts][WarehouseManagementView] unmounted");
    }, []);
    return (_jsx(PartsPlaceholderView, { title: "Warehouse management", description: "Blank UI for now. Later this section can contain Warehouse Management related actions." }));
};
