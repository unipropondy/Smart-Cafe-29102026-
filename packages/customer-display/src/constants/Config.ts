import { Platform } from 'react-native';

/**
 * Platform-aware API_URL resolution.
 *
 * - On Android (React Native): resolves the Expo dev server host from expo-constants,
 *   or falls back to the production Railway URL in release builds.
 * - On Web (Electron BrowserWindow): uses window.location.hostname — the
 *   Expo web build will already have EXPO_PUBLIC_API_URL baked in at build time.
 */
const getLocalBackendIP = (): string => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.hostname;
  }
  // React Native / Expo context — lazy require so it does not crash in non-Expo environments
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Constants = require('expo-constants').default;
    const hostUri = Constants.expoConfig?.hostUri ?? Constants.manifest?.debuggerHost;
    if (hostUri) return hostUri.split(':')[0];
  } catch {}
  return 'localhost';
};

// __DEV__ is injected by Metro bundler. Provide a safe default for any non-Metro context.
const isDev: boolean = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

export let API_URL: string =
  (globalThis as any).process?.env?.EXPO_PUBLIC_API_URL ??
  (isDev
    ? `http://${getLocalBackendIP()}:3000`
    : 'https://pos-v-20-production.up.railway.app');

export const setApiUrl = (url: string) => {
  API_URL = url;
};
