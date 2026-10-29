const reactNative = require("react-native");

const mockDisplayModule = {
  init: () => {},
  getInitialScreens: () => ({ SCREEN_INFO: {} }),
  SCREEN_INFO: {},
  requestScene: () => false,
  closeScene: () => false,
  isMainSceneActive: () => true,
  resumeMainScene: () => true,
  addListener: () => {},
  removeListeners: () => {},
};

if (reactNative && reactNative.NativeModules) {
  try {
    const originalNativeModules = reactNative.NativeModules;
    
    // Create a mock for ThermalPrinter native module
    const mockThermalPrinter = {
      printTcp: async () => {},
      printBluetooth: async () => {},
      printUsb: async () => {},
    };

    // Create a proxy to intercept RNExternalDisplayEvent dynamically without writing to the read-only NativeModules proxy directly
    const nativeModulesProxy = new Proxy(originalNativeModules, {
      get(target, prop, receiver) {
        if (prop === "RNExternalDisplayEvent") {
          return mockDisplayModule;
        }
        if (prop === "ThermalPrinter") {
          return mockThermalPrinter;
        }
        return Reflect.get(target, prop, receiver);
      }
    });

    const descriptor = Object.getOwnPropertyDescriptor(reactNative, "NativeModules");
    if (!descriptor || descriptor.configurable) {
      Object.defineProperty(reactNative, "NativeModules", {
        value: nativeModulesProxy,
        configurable: true,
        writable: true,
      });
    } else {
      // If non-configurable, we can directly mutate the properties of the proxy target (originalNativeModules)
      // or assign properties if writable
      try {
        originalNativeModules.RNExternalDisplayEvent = mockDisplayModule;
        originalNativeModules.ThermalPrinter = mockThermalPrinter;
      } catch (mutateErr) {
        // Fallback silently if sealed
      }
    }
  } catch (e) {
    console.warn("⚠️ [DisplayMock] Failed to proxy NativeModules:", e.message);
  }
}

if (reactNative && reactNative.TurboModuleRegistry && typeof reactNative.TurboModuleRegistry.get === "function") {
  try {
    const originalGet = reactNative.TurboModuleRegistry.get;
    reactNative.TurboModuleRegistry.get = (name) => {
      if (name === "RNExternalDisplayEvent") {
        return mockDisplayModule;
      }
      if (name === "ThermalPrinter") {
        return {
          printTcp: async () => {},
          printBluetooth: async () => {},
          printUsb: async () => {},
        };
      }
      return originalGet(name);
    };
  } catch (e) {
    console.warn("⚠️ [DisplayMock] Failed to patch TurboModuleRegistry:", e.message);
  }
}
