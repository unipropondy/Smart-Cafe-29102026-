import Constants from "expo-constants";
import { Platform } from "react-native";

const getLocalBackendIP = (): string => {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.hostname;
  }

  const hostUri =
    Constants.expoConfig?.hostUri ?? Constants.manifest?.debuggerHost;

  if (hostUri) {
    return hostUri.split(":")[0];
  }

  return "localhost";
};

const localIP = getLocalBackendIP();

export const API_URL = __DEV__
  ? `http://${localIP}:3000`
  : (process.env.EXPO_PUBLIC_API_URL ??
    (Platform.OS === "web" && typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.hostname}${window.location.port ? `:${window.location.port}` : ""}`
      : "https://pos-v-20-production.up.railway.app"));

if (__DEV__) {
  console.log(`🌐 [Config] API_URL: ${API_URL} | Platform: ${Platform.OS}`);
}
