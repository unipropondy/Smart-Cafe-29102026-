import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export type ServiceMode = "DINE_IN" | "TAKEAWAY";

export type OrderContext = {
  orderType: "DINE_IN" | "TAKEAWAY" | "MANUAL";
  section?: string;
  tableId?: string;
  tableNo?: string;
  tableName?: string;
  takeawayNo?: string;
  orderId?: string;
  serverId?: number;
  serverName?: string;
  status?: string | number;
};

type OrderContextState = {
  currentOrder: OrderContext | null;
  serviceMode: ServiceMode | null;
  activeSection: string;
  setOrderContext: (data: OrderContext) => void;
  clearOrderContext: (preserveMode?: boolean) => void;
  setServiceMode: (mode: ServiceMode | null) => void;
  setActiveSection: (section: string) => void;
};

export const useOrderContextStore = create<OrderContextState>()(
  persist(
    (set) => ({
      currentOrder: null,
      serviceMode: null,
      activeSection: "SECTION_1",
      setOrderContext: (data) =>
        set((state) => {
          const mode: ServiceMode = data.orderType === "TAKEAWAY" ? "TAKEAWAY" : "DINE_IN";
          const sec = data.section || (mode === "TAKEAWAY" ? "TAKEAWAY" : state.activeSection || "SECTION_1");
          return {
            currentOrder: data,
            serviceMode: mode,
            activeSection: sec,
          };
        }),
      clearOrderContext: (preserveMode = true) =>
        set((state) => {
          if (preserveMode && state.serviceMode) {
            return {
              currentOrder: {
                orderType: state.serviceMode,
                section: state.activeSection || (state.serviceMode === "TAKEAWAY" ? "TAKEAWAY" : "SECTION_1"),
              },
              serviceMode: state.serviceMode,
              activeSection: state.activeSection || (state.serviceMode === "TAKEAWAY" ? "TAKEAWAY" : "SECTION_1"),
            };
          }
          return {
            currentOrder: null,
          };
        }),
      setServiceMode: (mode) =>
        set((state) => {
          const sec = mode === "TAKEAWAY" ? "TAKEAWAY" : (state.activeSection === "TAKEAWAY" ? "SECTION_1" : state.activeSection || "SECTION_1");
          return {
            serviceMode: mode,
            activeSection: sec,
            currentOrder: state.currentOrder ? {
              ...state.currentOrder,
              orderType: mode || "DINE_IN",
              section: sec,
            } : (mode ? { orderType: mode, section: sec } : null),
          };
        }),
      setActiveSection: (section) =>
        set((state) => {
          const isTW = section === "TAKEAWAY";
          const newMode: ServiceMode = isTW ? "TAKEAWAY" : (state.serviceMode === "TAKEAWAY" ? "DINE_IN" : (state.serviceMode || "DINE_IN"));
          return {
            activeSection: section,
            serviceMode: newMode,
            currentOrder: state.currentOrder ? {
              ...state.currentOrder,
              section,
              orderType: newMode,
            } : {
              orderType: newMode,
              section,
            },
          };
        }),
    }),
    {
      name: "order-context-storage",
      storage: createJSONStorage(() => 
        Platform.OS === 'web' ? window.localStorage : AsyncStorage
      ),
    }
  )
);

// Backwards compatibility for existing code that hasn't been migrated yet
export const getOrderContext = () => useOrderContextStore.getState().currentOrder;
export const setOrderContext = (data: OrderContext) => useOrderContextStore.getState().setOrderContext(data);
export const clearOrderContext = (preserveMode = true) => useOrderContextStore.getState().clearOrderContext(preserveMode);
export const setServiceMode = (mode: ServiceMode | null) => useOrderContextStore.getState().setServiceMode(mode);
export const setActiveSection = (section: string) => useOrderContextStore.getState().setActiveSection(section);
