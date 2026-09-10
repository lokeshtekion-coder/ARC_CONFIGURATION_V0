import { useEffect, useState, useCallback } from "react";
import {
  type ArcCustomWatchRule,
  requestCustomRulesFromExtension,
  saveCustomRulesToExtension,
  subscribeToExtensionRules,
} from "../services/extensionBridge";

export function useArcRules() {
  const [rules, setRules] = useState<ArcCustomWatchRule[]>([]);
  const [isExtensionConnected, setIsExtensionConnected] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToExtensionRules((incomingRules) => {
      setRules(incomingRules);
      setIsExtensionConnected(true);
    });

    requestCustomRulesFromExtension();
    return unsubscribe;
  }, []);

  const saveRules = useCallback((newRules: ArcCustomWatchRule[]) => {
    setRules(newRules);
    saveCustomRulesToExtension(newRules);
  }, []);

  const addRule = useCallback(
    (rule: Omit<ArcCustomWatchRule, "createdAt" | "id">) => {
      const id = `${rule.label || rule.pattern}__${rule.matchMode}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-");

      const newRule: ArcCustomWatchRule = {
        ...rule,
        id,
        createdAt: new Date().toISOString(),
      };

      const filtered = rules.filter((r) => r.id !== id);
      saveRules([newRule, ...filtered]);
    },
    [rules, saveRules]
  );

  const removeRule = useCallback(
    (id: string) => {
      saveRules(rules.filter((rule) => rule.id !== id));
    },
    [rules, saveRules]
  );

  return { rules, isExtensionConnected, addRule, removeRule, saveRules };
}