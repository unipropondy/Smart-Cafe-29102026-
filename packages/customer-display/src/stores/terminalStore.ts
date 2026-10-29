import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Platform } from 'react-native';
import { socket } from '../constants/socket';

/**
 * Platform-aware persistent storage — same pattern as other stores.
 */
const getStorage = () => {
  if (Platform.OS === 'web') {
    return {
      getItem: (key: string) => Promise.resolve(localStorage.getItem(key)),
      setItem: (key: string, value: string) =>
        Promise.resolve(localStorage.setItem(key, value)),
      removeItem: (key: string) =>
        Promise.resolve(localStorage.removeItem(key)),
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@react-native-async-storage/async-storage').default;
};

export interface Terminal {
  TerminalCode: string;
  TerminalName: string;
}

interface TerminalState {
  terminalCode: string | null;
  terminalName: string | null;
  isConfigured: boolean;
  setTerminal: (code: string, name: string) => void;
  clearTerminal: () => void;
  joinSocketRoom: () => void;
}

export const useTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
      terminalCode: null,
      terminalName: null,
      isConfigured: false,

      setTerminal: (code, name) => {
        set({ terminalCode: code, terminalName: name, isConfigured: true });
        socket.emit('join_terminal', { terminalCode: code });
        console.log(
          `🖥️ [TerminalStore] Terminal set to: ${code} (${name}) | Joined room: terminal_${code}`,
        );
      },

      clearTerminal: () => {
        set({ terminalCode: null, terminalName: null, isConfigured: false });
        console.log('🖥️ [TerminalStore] Terminal configuration cleared.');
      },

      joinSocketRoom: () => {
        const { terminalCode, isConfigured } = get();
        if (!isConfigured || !terminalCode) {
          console.log('🖥️ [TerminalStore] joinSocketRoom: No terminal configured, skipping.');
          return;
        }
        socket.emit('join_terminal', { terminalCode });
        console.log(`🖥️ [TerminalStore] Re-joined socket room: terminal_${terminalCode}`);
      },
    }),
    {
      name: 'terminal-config-storage',
      storage: createJSONStorage(getStorage),
    },
  ),
);
