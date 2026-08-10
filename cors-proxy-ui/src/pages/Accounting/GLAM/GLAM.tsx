import React, { useMemo, useState } from "react";
import {
  GLAM_GROUPS,
  glamLogger,
  type GlamGroupKey,
  type GlamItemKey,
} from "./config/glamConfig";
import {
  Arrow,
  contentCardStyle,
  itemButtonBaseStyle,
  leftPanelStyle,
} from "./components/glamShared";

import NewVehiclesView from "./Variable Operations/New Vehicles";
import UsedVehiclesView from "./Variable Operations/Used Vehicles";
import FIProductsView from "./Variable Operations/F&I Products";
import ReceivablesView from "./Variable Operations/Receivables";
import PayablesView from "./Variable Operations/Payables";

import ServicesView from "./Fixed Operations/Services";
import PartsAccessoriesView from "./Fixed Operations/Part & Accessories";
import OthersView from "./Fixed Operations/Others";

import PaymentVariableOperationsView from "./Payment Receipts/Variable Operations";
import PaymentFixedOperationsView from "./Payment Receipts/Fixed Operations";

function renderSection(activeItemKey: GlamItemKey): React.ReactNode {
  switch (activeItemKey) {
    case "new-vehicles":
      return <NewVehiclesView />;
    case "used-vehicles":
      return <UsedVehiclesView />;
    case "fi-products":
      return <FIProductsView />;
    case "receivables":
      return <ReceivablesView />;
    case "payables":
      return <PayablesView />;
    case "services":
      return <ServicesView />;
    case "parts-accessories":
      return <PartsAccessoriesView />;
    case "others":
      return <OthersView />;
    case "payment-variable-operations":
      return <PaymentVariableOperationsView />;
    case "payment-fixed-operations":
      return <PaymentFixedOperationsView />;
    default:
      return <NewVehiclesView />;
  }
}

export const GLAM: React.FC = () => {
  const [activeItemKey, setActiveItemKey] = useState<GlamItemKey>("new-vehicles");
  const [openGroups, setOpenGroups] = useState<Record<GlamGroupKey, boolean>>({
    "variable-operations": true,
    "fixed-operations": true,
    "payment-receipts": true,
  });

  const activeMeta = useMemo(() => {
    for (const group of GLAM_GROUPS) {
      const child = group.children.find((item) => item.key === activeItemKey);
      if (child) {
        return { group, item: child };
      }
    }

    return {
      group: GLAM_GROUPS[0],
      item: GLAM_GROUPS[0].children[0],
    };
  }, [activeItemKey]);

  glamLogger.info("render", {
    activeItemKey,
    activeGroup: activeMeta.group.key,
  });

  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <div>
        <div
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: "#f8fafc",
            marginBottom: 6,
          }}
        >
          GLAM
        </div>
        <div
          style={{
            color: "#94a3b8",
            fontSize: 14,
            lineHeight: 1.7,
          }}
        >
          General Ledger Account Mapping workspace with left navigation and
          section-based content area.
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px minmax(0, 1fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div style={leftPanelStyle}>
          <div
            style={{
              color: "#f8fafc",
              fontSize: 18,
              fontWeight: 800,
              padding: "4px 4px 8px",
            }}
          >
            GLAM Sections
          </div>

          {GLAM_GROUPS.map((group) => {
            const isOpen = openGroups[group.key];

            return (
              <div
                key={group.key}
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.018)",
                  overflow: "hidden",
                }}
              >
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroups((prev) => ({
                      ...prev,
                      [group.key]: !prev[group.key],
                    }))
                  }
                  style={{
                    width: "100%",
                    border: "none",
                    background: "rgba(255,255,255,0.02)",
                    color: "#f8fafc",
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    cursor: "pointer",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Arrow open={isOpen} />
                    <span style={{ fontSize: 14, fontWeight: 800 }}>{group.label}</span>
                  </span>
                  <span
                    style={{
                      color: "#94a3b8",
                      fontSize: 12,
                      border: "1px solid rgba(255,255,255,0.10)",
                      borderRadius: 999,
                      padding: "2px 8px",
                    }}
                  >
                    {group.children.length}
                  </span>
                </button>

                {isOpen ? (
                  <div
                    style={{
                      display: "grid",
                      gap: 8,
                      padding: 10,
                    }}
                  >
                    {group.children.map((item) => {
                      const isActive = item.key === activeItemKey;

                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => {
                            glamLogger.info("section click", {
                              group: group.key,
                              item: item.key,
                            });
                            setActiveItemKey(item.key);
                          }}
                          style={{
                            ...itemButtonBaseStyle,
                            background: isActive
                              ? "rgba(59,130,246,0.12)"
                              : "rgba(255,255,255,0.02)",
                            border: isActive
                              ? "1px solid rgba(59,130,246,0.35)"
                              : "1px solid rgba(255,255,255,0.08)",
                          }}
                        >
                          <div
                            style={{
                              color: isActive ? "#dbeafe" : "#f8fafc",
                              fontSize: 14,
                              fontWeight: 700,
                              marginBottom: 4,
                            }}
                          >
                            {item.label}
                          </div>
                          <div
                            style={{
                              color: isActive ? "#bfdbfe" : "#94a3b8",
                              fontSize: 12,
                              lineHeight: 1.5,
                            }}
                          >
                            {item.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div style={contentCardStyle}>{renderSection(activeItemKey)}</div>
      </div>
    </div>
  );
};

export default GLAM;
