import { create } from "zustand";

interface ServiceChargeOverrideState {
  overrides: Record<string, boolean>; // key (orderId or tableId) -> reduced (boolean)
  setOverride: (id: string, reduced: boolean) => void;
  clearOverride: (id: string) => void;
}

export const useServiceChargeOverrideStore = create<ServiceChargeOverrideState>((set) => ({
  overrides: {},
  setOverride: (id, reduced) =>
    set((state) => ({
      overrides: { ...state.overrides, [id.toLowerCase()]: reduced },
    })),
  clearOverride: (id) =>
    set((state) => {
      const copy = { ...state.overrides };
      delete copy[id.toLowerCase()];
      return { overrides: copy };
    }),
}));
