import { useExternalDisplay } from "react-native-external-display";
import { Platform } from "react-native";

/**
 * DisplayInfo — metadata about a connected secondary display.
 */
export interface DisplayInfo {
  /** The display ID string as reported by Android's DisplayManager. */
  id: string;
  width: number;
  height: number;
}

/**
 * useCustomerDisplay
 *
 * Wraps react-native-external-display to provide a clean, typed API for
 * detecting the Sunmi D3 secondary (customer-facing) display.
 *
 * Returns the list of connected SECONDARY displays (display ID != "0") and a
 * boolean convenience flag. On the Sunmi D3, the secondary screen has a
 * non-zero display ID and the FLAG_PRESENTATION flag set.
 *
 * Hot-reconnect is handled automatically: the underlying hook re-renders
 * whenever Android's DisplayManager fires a display-added or display-removed
 * event, so this hook updates in real time with no app restart required.
 *
 * Display selection notes:
 *  - Display ID "0" is always the primary (operator) screen — we exclude it.
 *  - On Sunmi D3, the built-in customer display typically has ID "1".
 *  - On some firmware builds it may have a higher ID — we select the first
 *    non-zero ID to stay firmware-agnostic.
 */
export function useCustomerDisplay(): {
  displays: DisplayInfo[];
  isConnected: boolean;
} {
  const screens = useExternalDisplay();

  // Map all screens, filtering out display ID "0" (primary operator screen)
  const displays: DisplayInfo[] = Object.entries(screens)
    .filter(([id]) => id !== "0")
    .map(([id, info]: [string, any]) => ({
      id,
      width: info?.width ?? 0,
      height: info?.height ?? 0,
    }));

  if (displays.length > 0) {
    console.log(
      `🖥️ [useCustomerDisplay] Secondary display(s) detected:`,
      displays.map((d) => `ID=${d.id} ${d.width}x${d.height}`).join(", ")
    );
  } else if (Platform.OS === "android") {
    const model = ((Platform.constants as any).Model || "").toUpperCase();
    if (model.includes("D3")) {
      console.warn(
        "🖥️ [useCustomerDisplay] Sunmi D3 detected but NO secondary display found. " +
          "Ensure the device has a second screen connected and DisplayManager is reporting it."
      );
    }
  }

  return {
    displays,
    isConnected: displays.length > 0,
  };
}
