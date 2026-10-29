import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { socket } from "../constants/socket";

export type TerminalSessionStatus =
  | "idle"
  | "processing"
  | "success"
  | "cancelled"
  | "failed";

export interface TerminalSession {
  tableId: string;
  status: TerminalSessionStatus;
  message: string;
  method: string;
  total: number;
  /** Row ID for split payment sessions */
  splitRowId?: string;
  isSplit?: boolean;
  /** Callback fired when the background promise resolves */
  onUpdate?: (
    status: TerminalSessionStatus,
    message: string,
    result: any,
    error: any
  ) => void;
}

interface TerminalPaymentState {
  sessions: Record<string, TerminalSession>;
  splitRows: Record<string, any[]>;
  activeSplitTables: Record<string, boolean>;
  setSession: (tableId: string, session: TerminalSession, emitSocket?: boolean) => void;
  updateSession: (tableId: string, patch: Partial<TerminalSession>, emitSocket?: boolean) => void;
  clearSession: (tableId: string, emitSocket?: boolean) => void;
  getSession: (tableId: string) => TerminalSession | undefined;
  setSplitRows: (tableId: string, rows: any[], emitSocket?: boolean) => void;
  clearSplitRows: (tableId: string, emitSocket?: boolean) => void;
  setSplitTableActive: (tableId: string, isActive: boolean) => void;
}

export const useTerminalPaymentStore = create<TerminalPaymentState>()(
  persist(
    (set, get) => ({
      sessions: {},
      splitRows: {},
      activeSplitTables: {},

      setSession: (tableId, session, emitSocket = true) => {
        set((state) => ({
          sessions: { ...state.sessions, [tableId]: session },
        }));
        if (emitSocket) {
          socket.emit("terminal_payment_sync", { tableId, session });
        }
      },

      updateSession: (tableId, patch, emitSocket = true) => {
        set((state) => {
          const existing = state.sessions[tableId];
          if (!existing) return state;
          const updated = { ...existing, ...patch };
          return {
            sessions: {
              ...state.sessions,
              [tableId]: updated,
            },
          };
        });
        if (emitSocket) {
          const current = get().sessions[tableId];
          if (current) {
            socket.emit("terminal_payment_sync", { tableId, session: current });
          }
        }
      },

      clearSession: (tableId, emitSocket = true) => {
        set((state) => {
          const next = { ...state.sessions };
          delete next[tableId];
          const nextSplit = { ...state.splitRows };
          delete nextSplit[tableId];
          const nextActiveSplit = { ...state.activeSplitTables };
          delete nextActiveSplit[tableId];
          return { sessions: next, splitRows: nextSplit, activeSplitTables: nextActiveSplit };
        });
        if (emitSocket) {
          socket.emit("terminal_payment_sync", { tableId, session: null });
          socket.emit("terminal_split_rows_sync", { tableId, rows: null });
        }
      },

      getSession: (tableId) => get().sessions[tableId],

      setSplitRows: (tableId, rows, emitSocket = true) => {
        set((state) => ({
          splitRows: { ...state.splitRows, [tableId]: rows },
        }));
        if (emitSocket) {
          socket.emit("terminal_split_rows_sync", { tableId, rows });
        }
      },

      clearSplitRows: (tableId, emitSocket = true) => {
        set((state) => {
          const next = { ...state.splitRows };
          delete next[tableId];
          return { splitRows: next };
        });
        if (emitSocket) {
          socket.emit("terminal_split_rows_sync", { tableId, rows: null });
        }
      },

      setSplitTableActive: (tableId, isActive) => {
        set((state) => ({
          activeSplitTables: { ...state.activeSplitTables, [tableId]: isActive },
        }));
      },
    }),
    {
      name: "terminal-payment-storage",
      storage: createJSONStorage(() =>
        Platform.OS === "web" ? window.localStorage : AsyncStorage
      ),
    }
  )
);
