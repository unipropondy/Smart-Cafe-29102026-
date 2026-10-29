import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import ExternalDisplay from "react-native-external-display";
import CustomerDisplayContent from "./CustomerDisplayContent";
import { useCustomerDisplay } from "../hooks/useCustomerDisplay";

interface CustomerDisplayManagerProps {
  /** Must be true before the customer screen is shown. Passed from RootLayout. */
  isPOSReady: boolean;
}

/**
 * CustomerDisplayManager
 *
 * Mounted once at the root layout level and lives for the entire app lifetime.
 * Responsible for the full lifecycle of the Sunmi D3 customer-facing secondary
 * display:
 *
 *  • Detects secondary display connect / disconnect via useCustomerDisplay().
 *    useCustomerDisplay() already filters out the primary display (ID=0).
 *  • Gates rendering until isPOSReady is true (fonts loaded, settings fetched,
 *    socket ready) so the customer screen never shows blank/stale data.
 *  • Renders CustomerDisplayContent on the secondary display using the
 *    react-native-external-display Presentation API.
 *  • Hot-reconnect: if the display is unplugged and replugged, useCustomerDisplay
 *    re-triggers automatically — no app restart needed.
 *  • fallbackInMainScreen={false}: if no secondary display is connected this
 *    component renders nothing, leaving the main operator screen untouched.
 */
export function CustomerDisplayManager({ isPOSReady }: CustomerDisplayManagerProps) {
  const { displays, isConnected } = useCustomerDisplay();

  // Log all detected secondary displays for debugging
  React.useEffect(() => {
    if (Platform.OS !== "android") return;
    const model = ((Platform.constants as any).Model || "").toUpperCase();
    console.log(
      `🖥️ [CustomerDisplayManager] isPOSReady=${isPOSReady}, isConnected=${isConnected}, ` +
        `displays=${displays.length}, model=${model || "unknown"}`
    );
    if (displays.length > 0) {
      displays.forEach((d) => {
        console.log(
          `🖥️ [CustomerDisplayManager] Available secondary display: id=${d.id} ${d.width}x${d.height}`
        );
      });
    }
  }, [isPOSReady, isConnected, displays.length]);

  // Do not render until POS is initialised and a secondary display is present
  if (!isPOSReady || !isConnected || displays.length === 0) {
    return null;
  }

  // Select the first secondary display (non-primary)
  // useCustomerDisplay() already filters out display ID "0"
  const targetDisplay = displays[0];

  console.log(
    `🖥️ [CustomerDisplayManager] Rendering CustomerDisplay on display: ${targetDisplay.id} ` +
      `(${targetDisplay.width}x${targetDisplay.height})`
  );

  return (
    <ExternalDisplay
      screen={targetDisplay.id}
      fallbackInMainScreen={false}
      style={StyleSheet.absoluteFill}
    >
      {/* Full screen wrapper so CustomerDisplayContent fills the Presentation window */}
      <View style={styles.presentationRoot}>
        <CustomerDisplayContent />
      </View>
    </ExternalDisplay>
  );
}

const styles = StyleSheet.create({
  presentationRoot: {
    flex: 1,
  },
});
