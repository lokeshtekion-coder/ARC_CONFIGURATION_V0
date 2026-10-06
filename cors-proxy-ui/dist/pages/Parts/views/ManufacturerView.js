import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect } from "react";
import { PartsPlaceholderView } from "../components/PartsPlaceholderView";
export const ManufacturerView = () => {
    useEffect(() => {
        console.log("[Parts][ManufacturerView] mounted");
        return () => console.log("[Parts][ManufacturerView] unmounted");
    }, []);
    return (_jsx(PartsPlaceholderView, { title: "Manufacturer", description: "Blank UI for now. Later this section can contain Manufacturer related actions." }));
};
