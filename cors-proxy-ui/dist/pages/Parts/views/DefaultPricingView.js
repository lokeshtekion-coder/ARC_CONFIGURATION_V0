import { jsx as _jsx } from "react/jsx-runtime";
// /Users/tlreddy/Desktop/ARC_CONFIGURATION_V0/cors-proxy-ui/src/pages/Parts/views/Default_Parts_Pricing/DefaultPricingView.tsx
import { useEffect } from "react";
import { PartsPlaceholderView } from "../components/PartsPlaceholderView";
export const DefaultPricingView = () => {
    useEffect(() => {
        console.log("[Parts][DefaultPricingView] mounted");
        return () => console.log("[Parts][DefaultPricingView] unmounted");
    }, []);
    return (_jsx(PartsPlaceholderView, { title: "Default pricing", description: "Blank UI for now. Later this section can contain Default Pricing related actions." }));
};
export default DefaultPricingView;
