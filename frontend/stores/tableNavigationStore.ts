import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

type TableNavState = {
  // maps tableId -> lastScreen (e.g. 'summary' or 'payment')
  tableScreens: Record<string, string>;
  setTableLastScreen: (tableId: string, screen: string) => void;
  clearTableLastScreen: (tableId: string) => void;

  // maps tableId -> last selected payment method (e.g. 'PAYNOW', 'CAS')
  selectedMethodMap: Record<string, string>;
  setSelectedMethod: (tableId: string, payMode: string) => void;
  getSelectedMethod: (tableId: string) => string | undefined;
  clearSelectedMethod: (tableId: string) => void;
};

export const useTableNavigationStore = create<TableNavState>()(
  persist(
    (set, get) => ({
      tableScreens: {},
      setTableLastScreen: (tableId, screen) =>
        set((state) => ({
          tableScreens: {
            ...state.tableScreens,
            [tableId]: screen,
          },
        })),
      clearTableLastScreen: (tableId) =>
        set((state) => {
          const next = { ...state.tableScreens };
          delete next[tableId];
          return { tableScreens: next };
        }),

      selectedMethodMap: {},
      setSelectedMethod: (tableId, payMode) =>
        set((state) => ({
          selectedMethodMap: {
            ...state.selectedMethodMap,
            [tableId]: payMode,
          },
        })),
      getSelectedMethod: (tableId) => get().selectedMethodMap[tableId],
      clearSelectedMethod: (tableId) =>
        set((state) => {
          const next = { ...state.selectedMethodMap };
          delete next[tableId];
          return { selectedMethodMap: next };
        }),
    }),
    {
      name: "table-navigation-storage",
      storage: createJSONStorage(() =>
        Platform.OS === "web" ? window.localStorage : AsyncStorage
      ),
    }
  )
);
