import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { socket } from "../constants/socket";

interface QuickCashState {
  amounts: number[];
  setAmounts: (amounts: number[], broadcast?: boolean) => void;
  /** Call once on app start to subscribe to live updates from other terminals. */
  subscribeToSocket: () => () => void;
}

const DEFAULT_AMOUNTS = [20, 50, 100, 200, 500, 1000];

/**
 * Isolated store for quick-cash shortcut amounts shown on the payment screen.
 *
 * ✦ Persisted locally via AsyncStorage (survives refresh).
 * ✦ Synced in real-time across all POS terminals via Socket.io so a
 *   change on one terminal is instantly reflected on every other terminal.
 */
export const useQuickCashStore = create<QuickCashState>()(
  persist(
    (set) => ({
      amounts: DEFAULT_AMOUNTS,

      setAmounts: (amounts, broadcast = true) => {
        set({ amounts });
        if (broadcast) {
          // Tell every other terminal about the change
          socket.emit("quick_cash_updated", { amounts });
        }
      },

      subscribeToSocket: () => {
        const handler = (data: { amounts: number[] }) => {
          if (Array.isArray(data?.amounts)) {
            // Update store without re-broadcasting (broadcast = false)
            useQuickCashStore.getState().setAmounts(data.amounts, false);
          }
        };
        socket.on("quick_cash_updated", handler);
        // Return cleanup function
        return () => {
          socket.off("quick_cash_updated", handler);
        };
      },
    }),
    {
      name: "quick-cash-amounts-storage",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
