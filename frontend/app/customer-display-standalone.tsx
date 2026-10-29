import { View, StyleSheet, Platform } from 'react-native';
import { CustomerDisplayContent } from '@unipro/customer-display';
import { Redirect } from 'expo-router';

import { useState, useEffect } from 'react';

/**
 * Bare-bones standalone Expo route for Electron's BrowserWindow.
 * Renders the CustomerDisplayContent fullscreen with no headers or nav.
 */
export default function CustomerDisplayStandalone() {
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (Platform.OS !== 'web') {
    return <Redirect href="/(tabs)/category" />;
  }

  if (!hasMounted) {
    // Return empty dark background during server-side pre-render/hydration
    return <View style={styles.root} />;
  }

  return (
    <View style={styles.root}>
      <CustomerDisplayContent />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0F172A' },
});
