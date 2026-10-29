import React from "react";

interface CustomerDisplayManagerProps {
  isPOSReady: boolean;
}

/**
 * CustomerDisplayManager (Web No-op Stub)
 *
 * Prevents native-only library "react-native-external-display" imports from
 * breaking the Metro web bundle during local testing/dev.
 */
export function CustomerDisplayManager({ isPOSReady }: CustomerDisplayManagerProps) {
  // External display is not supported on web. Return null.
  return null;
}
