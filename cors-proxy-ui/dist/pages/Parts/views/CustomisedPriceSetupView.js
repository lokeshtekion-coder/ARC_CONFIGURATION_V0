import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect } from "react";
import { PartsPlaceholderView } from "../components/PartsPlaceholderView";
export const CustomisedPriceSetupView = () => {
    useEffect(() => {
        console.log("[Parts][CustomisedPriceSetupView] mounted");
        return () => console.log("[Parts][CustomisedPriceSetupView] unmounted");
    }, []);
    return (_jsx(PartsPlaceholderView, { title: "Customised price setup", description: "Blank UI for now. Later this section can contain Customised Price Setup related actions." }));
};
