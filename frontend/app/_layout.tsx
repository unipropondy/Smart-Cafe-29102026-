import "../shims/displayMock";
import "react-native-get-random-values";
import "react-native-reanimated";

// Theme components are integrated directly into Expo Router 

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
  Inter_900Black,
  useFonts,
} from "@expo-google-fonts/inter";
import { Ionicons, MaterialCommunityIcons, FontAwesome5, Feather } from "@expo/vector-icons";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as React from "react";
import { useEffect } from "react";
import { useWindowDimensions, Alert } from "react-native";
import * as ScreenOrientation from "expo-screen-orientation";
import { ToastProvider, useToast } from "../components/Toast";
import { CustomerDisplayManager } from "../components/CustomerDisplayManager";
import { InstallAppModal } from "../components/InstallAppModal";
import { usePOSReadyGate } from "../hooks/usePOSReadyGate";
import { socket } from "../constants/socket";

function SocketToastListener() {
  const toast = useToast();

  useEffect(() => {
    const handleNewOrder = (payload: any) => {
      const user = useAuthStore.getState().user;
      if (!user) return;

      const isQrOrder =
        payload?.context?.entryStatus === "q" ||
        payload?.entryStatus === "q" ||
        payload?.context?.orderSource === "QR";

      if (isQrOrder) {
        const tableLabel = payload.context?.orderType === "TAKEAWAY"
          ? `Takeaway ${payload.context.takeawayNo || ""}`
          : `${payload.context?.section || ""} • Table ${payload.context?.tableNo || ""}`;

        toast.showToast({
          message: `📦 New QR Order Placed!`,
          subtitle: `Order #${payload.orderId} for ${tableLabel}`,
          type: "success",
          duration: 5000,
        });
      }
    };

    const handleCustomerRequest = (payload: { tableNo: string; type: string; tableId?: string }) => {
      const user = useAuthStore.getState().user;
      if (user) {
        const { useNotificationStore } = require("../stores/notificationStore");
        useNotificationStore.getState().addNotification({
          title: `Table ${payload.tableNo} Request`,
          message: payload.type,
          type: "GENERAL",
          tableNo: payload.tableNo,
          section: "SECTION_1", // Default dining section fallback
        });

        // 🔔 Show slide-down toast notification banner
        toast.showToast({
          message: `🛎️ Table ${payload.tableNo} Request`,
          subtitle: payload.type,
          type: "warning",
          duration: 5000,
        });

        // 🖨️ Auto-print checkout bill/invoice if customer requested bill (Pay at Cashier)
        if (payload.type === "Request Bill" && payload.tableId) {
          (async () => {
            try {
              const { useGeneralSettingsStore } = require("../stores/generalSettingsStore");
              const autoPrintEnabled = useGeneralSettingsStore.getState().settings.enableQROrderAutoPrint;
              if (autoPrintEnabled === false) {
                console.log("ℹ️ Auto-print for QR checkout is disabled in general settings.");
                return;
              }

              const token = useAuthStore.getState().token;
              const res = await fetch(`${API_URL}/api/orders/cart/${payload.tableId}`, {
                headers: token ? { "Authorization": `Bearer ${token}` } : {}
              });
              if (!res.ok) return;
              const data = await res.json();
              const rawItems = Array.isArray(data) ? data : (data.items || []);
              
              // Filter out voided items
              const activeItems = rawItems.filter((item: any) => {
                const status = (item.status || item.Status || "").toUpperCase();
                return status !== "VOIDED" && Number(item.StatusCode || item.statusCode) !== 0;
              });

              if (activeItems.length === 0) return;

              const { useCompanySettingsStore } = require("../stores/companySettingsStore");
              const settings = useCompanySettingsStore.getState().settings;

              const serviceChargePercentage = Number(settings?.serviceChargePercentage ?? settings?.ServiceChargePercentage ?? 0);
              const gstPercentage = Number(settings?.gstPercentage ?? settings?.GSTPercentage ?? 0);
              const takeawayChargeRate = Number(settings?.takeawayCharges ?? settings?.TakeawayCharges ?? settings?.takeawayCharge ?? settings?.TakeawayCharge ?? 0);

              let subtotal = 0;
              let scEligibleSubtotal = 0;
              let takeawayItemsQty = 0;

              const cartItems = activeItems.map((item: any) => {
                const qty = Number(item.qty ?? item.Quantity ?? item.quantity ?? 1);
                const price = Number(item.price ?? item.Cost ?? item.Price ?? 0);
                const isTakeaway = !!(item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway);
                const isServiceCharge = !isTakeaway && (Number(item.isServiceCharge) === 1 || item.isServiceCharge === true || Number(item.IsServiceCharge) === 1 || item.IsServiceCharge === true);
                
                subtotal += price * qty;
                if (isServiceCharge) {
                  scEligibleSubtotal += price * qty;
                }
                if (isTakeaway) {
                  takeawayItemsQty += qty;
                }

                let comboSelections = item.comboSelections || item.ComboSelections;
                if (typeof item.ComboDetailsJSON === 'string' && item.ComboDetailsJSON) {
                  try {
                    const parsed = JSON.parse(item.ComboDetailsJSON);
                    comboSelections = Array.isArray(parsed) ? parsed : parsed.groups;
                  } catch (e) {}
                } else if (Array.isArray(item.ComboDetailsJSON)) {
                  comboSelections = item.ComboDetailsJSON;
                }

                let modifiers = item.modifiers || item.Modifiers || [];
                if (typeof modifiers === 'string') {
                  try { modifiers = JSON.parse(modifiers); } catch (e) { modifiers = []; }
                }

                return {
                  lineItemId: item.lineItemId || item.LineItemId,
                  id: item.id || item.DishId,
                  name: item.name || item.DishName || "",
                  price: price,
                  qty: qty,
                  isTakeaway: isTakeaway,
                  isServiceCharge: isServiceCharge,
                  modifiers: modifiers.map((m: any) => ({
                    ModifierId: m.ModifierId || m.ModifierID || m.id,
                    ModifierName: m.ModifierName || m.modifierName || m.name || "",
                    Price: Number(m.Price || m.price || 0),
                  })),
                  comboSelections: comboSelections,
                };
              });

              const orderDiscountAmt = Number(data.orderDiscount?.amount || 0);
              const orderNetSubtotal = Math.max(0, subtotal - orderDiscountAmt);

              const takeawayChargeAmt = takeawayItemsQty * takeawayChargeRate;
              const serviceChargeAmt = Math.max(0, scEligibleSubtotal - orderDiscountAmt) * (serviceChargePercentage / 100);
              const totalBeforeGst = orderNetSubtotal + serviceChargeAmt + takeawayChargeAmt;
              const gstAmt = totalBeforeGst * (gstPercentage / 100);
              const grandTotal = totalBeforeGst + gstAmt;

              const saleData = {
                items: cartItems,
                total: grandTotal,
                subtotal: subtotal,
                discount: {
                  applied: orderDiscountAmt > 0,
                  type: "fixed" as const,
                  value: orderDiscountAmt,
                  amount: orderDiscountAmt,
                },
                orderId: data.currentOrderId || data.orderId || payload.tableNo,
                tableNo: payload.tableNo,
                waiterName: "QR Customer",
                date: new Date(),
                isCheckout: true,
                serviceCharge: serviceChargeAmt,
                takeawayCharge: takeawayChargeAmt,
              };

              const UniversalPrinter = require("../components/UniversalPrinter").default;
              await UniversalPrinter.printCheckoutBill(
                saleData,
                user?.userId || "SYSTEM",
              );
            } catch (err) {
              console.warn("Auto-print on cashier request failed:", err);
            }
          })();
        }
      }
    };

    socket.on("new_order", handleNewOrder);
    socket.on("customer_request", handleCustomerRequest);
    return () => {
      socket.off("new_order", handleNewOrder);
      socket.off("customer_request", handleCustomerRequest);
    };
  }, [toast]);

  return null;
}

import { useColorScheme } from "@/hooks/use-color-scheme";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useAuthStore } from "@/stores/authStore";
import { useRouter, useSegments, Slot } from "expo-router";
import * as SystemUI from "expo-system-ui";
import { Theme } from "@/constants/theme";
import { LogBox } from "react-native";

LogBox.ignoreLogs([
  "setLayoutAnimationEnabledExperimental is currently a no-op",
]);

// Set root background immediately to match theme
SystemUI.setBackgroundColorAsync(Theme.bgMain);

// Keep the splash screen visible while fonts load
SplashScreen.preventAutoHideAsync();

import { useGlobalSocketSync } from "@/hooks/useGlobalSocketSync";
import { API_URL } from "@/constants/Config";
import { setApiUrl } from "@/stores/paymentSettingsStore";

// Propagate API URL to local package stores
setApiUrl(API_URL);

// 🌐 GLOBAL FETCH RETRY & IDEMPOTENCY ENGINE
const originalFetch = global.fetch;

const getUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

interface NetworkPolicy {
  timeout: number;
  maxRetries: number;
  initialDelay: number;
  budget: number;
}

const CRITICAL_POLICY: NetworkPolicy = {
  timeout: 15000,
  maxRetries: 3,
  initialDelay: 300,
  budget: 35000,
};

const NORMAL_POLICY: NetworkPolicy = {
  timeout: 15000,
  maxRetries: 2,
  initialDelay: 300,
  budget: 35000,
};

const HEALTH_POLICY: NetworkPolicy = {
  timeout: 3000,
  maxRetries: 0,
  initialDelay: 300,
  budget: 5000,
};

const TERMINAL_POLICY: NetworkPolicy = {
  timeout: 165000, // 165 seconds to match/exceed YeahPay backend timeout (160s)
  maxRetries: 0,   // Do not retry payments to avoid idempotency conflicts
  initialDelay: 300,
  budget: 170000,
};

const classifyRequest = (url: string): NetworkPolicy => {
  if (!url) return NORMAL_POLICY;
  if (url.includes("/health")) return HEALTH_POLICY;
  if (url.includes("/yeahpay") || url.includes("yeahpay")) return TERMINAL_POLICY;

  const criticalKeywords = [
    "checkout",
    "save-cart",
    "send",
    "hold",
    "complete",
    "/save",
    "print",
    "update-item-status",
    "log-visit",
    "settings"
  ];

  const isCritical = criticalKeywords.some((keyword) => url.includes(keyword));
  return isCritical ? CRITICAL_POLICY : NORMAL_POLICY;
};

const getJitteredDelay = (baseDelay: number): number => {
  const min = baseDelay * 0.8;
  const max = baseDelay * 1.2;
  return min + Math.random() * (max - min);
};

global.fetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : (input as any).url);

  if (url && url.includes(API_URL)) {
    const policy = classifyRequest(url);
    const options: RequestInit = init ? { ...init } : {};
    const headers: Record<string, string> = {};

    if (options.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(options.headers)) {
        options.headers.forEach(([key, value]) => {
          headers[key] = value;
        });
      } else {
        Object.assign(headers, options.headers);
      }
    }

    const token = useAuthStore.getState().token;
    if (token && !headers['Authorization'] && !headers['authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const requestId = headers['x-request-id'] || headers['X-Request-ID'] || getUUID();
    headers['x-request-id'] = requestId;
    options.headers = headers;

    let delay = policy.initialDelay;
    let lastError: any = null;
    const startTime = Date.now();

    if (__DEV__) {
      console.log(`🌐 [Fetch Start] ${options.method || 'GET'} -> ${url} | id: ${requestId}`);
    }

    for (let attempt = 0; attempt <= policy.maxRetries; attempt++) {
      const elapsed = Date.now() - startTime;
      if (attempt > 0 && elapsed + delay > policy.budget) {
        if (__DEV__) {
          console.warn(`🛑 [Fetch Budget Exceeded] Elapsed: ${elapsed}ms, next delay: ${delay}ms, Budget: ${policy.budget}ms. Aborting retries for ${url}`);
        }
        break;
      }

      const controller = new AbortController();
      options.signal = controller.signal;

      const timeoutId = setTimeout(() => {
        controller.abort();
      }, policy.timeout);

      try {
        const response = await originalFetch(input, options);
        clearTimeout(timeoutId);

        if (response.status === 502 || response.status === 503 || response.status === 504) {
          lastError = new Error(`Server returned transient status ${response.status}`);
          if (__DEV__) {
            console.warn(`⚠️ [Fetch Transient Status] ${response.status} on ${url} (Attempt ${attempt}/${policy.maxRetries})`);
          }
        } else {
          if (__DEV__ && attempt > 0) {
            console.log(`✅ [Fetch Success After Retry] ${url} succeeded on attempt ${attempt}`);
          }
          return response;
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err;

        const isTimeout = err.name === 'AbortError';
        const isNetwork = err instanceof TypeError || err.message?.includes('Network request failed');

        if (!isTimeout && !isNetwork) {
          if (__DEV__) {
            console.error(`🛑 [Fetch Non-Retryable Error] ${err.message || err} on ${url}`);
          }
          throw err;
        }

        if (__DEV__) {
          console.warn(`⚠️ [Fetch Transient Error] Attempt ${attempt}/${policy.maxRetries} failed: ${err.message || err} (Timeout: ${isTimeout}, Network: ${isNetwork})`);
        }
      }

      if (attempt < policy.maxRetries) {
        const jitteredDelay = getJitteredDelay(delay);
        if (__DEV__) {
          console.log(`💤 [Fetch Retry Delay] Waiting ${Math.round(jitteredDelay)}ms before attempt ${attempt + 1}`);
        }
        await new Promise((resolve) => setTimeout(resolve, jitteredDelay));
        delay *= 2.0;
      }
    }

    if (__DEV__) {
      console.error(`🛑 [Fetch Failed Exhausted] ${options.method || 'GET'} -> ${url} | Failed after ${policy.maxRetries} retries. Error: ${lastError?.message || lastError}`);
    }
    throw lastError;
  }

  return originalFetch(input, init);
};

export default function RootLayout() {
  const [authHydrated, setAuthHydrated] = React.useState(useAuthStore.persist.hasHydrated());

  React.useEffect(() => {
    if (authHydrated) return;

    // Subscribe to completion of hydration in Zustand
    const unsubFinish = useAuthStore.persist.onFinishHydration(() => {
      setAuthHydrated(true);
    });

    return unsubFinish;
  }, [authHydrated]);

  useGlobalSocketSync();
  const colorScheme = useColorScheme();
  const router = useRouter();
  const segments = useSegments();
  const user = useAuthStore((s) => s.user);


  // 🌐 SILENT API WAKE-UP & CONNECTION PRE-WARM
  useEffect(() => {
    const warmupAPI = async () => {
      if (__DEV__) {
        console.log(`🌐 [App Startup] Warming up connection to ${API_URL}...`);
      }
      try {
        const start = Date.now();
        // Trigger DNS lookup, TCP/SSL handshake, and backend container spin-up
        const res = await fetch(`${API_URL}/health`);
        const duration = Date.now() - start;
        if (__DEV__) {
          console.log(`🌐 [App Startup] API warmed up successfully in ${duration}ms. Status: ${res.status}`);
        }

        // 🚀 PARALLEL PREFETCH: Load static payment config immediately after connection
        // is confirmed. This ensures the Payment screen reads from cache instead of
        // making sequential network requests on every open.
        const token = useAuthStore.getState().token;
        if (token) {
          import("@/stores/paymentSettingsStore").then((m) => {
            Promise.all([
              m.usePaymentSettingsStore.getState().fetchSettings(),
              m.usePaymentSettingsStore.getState().fetchPaymentMethods(),
            ]).catch(() => {/* Non-fatal — payment screen still works on miss */});
          });
        }
      } catch (err: any) {
        if (__DEV__) {
          console.warn(`🌐 [App Startup] API warmup ping failed (expected if backend container is booting up):`, err.message || err);
        }
      }
    };
    warmupAPI();
  }, []);

  const [fontsLoaded, fontError] = useFonts({
    "Ionicons": require("../assets/fonts/Ionicons.ttf"),
    "ionicons": require("../assets/fonts/Ionicons.ttf"),
    "Material Community Icons": require("../assets/fonts/MaterialCommunityIcons.ttf"),
    "material-community": require("../assets/fonts/MaterialCommunityIcons.ttf"),
    "FontAwesome5Free-Solid": require("../assets/fonts/FontAwesome5_Solid.ttf"),
    "FontAwesome5Free-Regular": require("../assets/fonts/FontAwesome5_Regular.ttf"),
    "FontAwesome5Brands-Regular": require("../assets/fonts/FontAwesome5_Brands.ttf"),
    "Feather": require("../assets/fonts/Feather.ttf"),
    "feather": require("../assets/fonts/Feather.ttf"),
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
  });



  // 🖥️ CUSTOMER DISPLAY: Gate resolves once fonts + settings + socket are ready
  const isPOSReady = usePOSReadyGate(fontsLoaded || !!fontError);

  // ✅ AUTH GUARD: Redirect based on auth state and role
  useEffect(() => {
    if (!fontsLoaded || !authHydrated) return;

    const rootSegment = segments[0];
    if (rootSegment && (rootSegment.startsWith("customer-display") || rootSegment === "customer" || rootSegment === "qr-takeaway")) return;

    const isInsideApp = !!rootSegment && rootSegment !== "login";
    
    if (!user && isInsideApp) {
      // 1. Not logged in -> Go to Login
      router.replace("/login");
    } else if (user) {
      if (user.userGroupId === "DFCF23EE-F6F4-4885-8D26-0056C657595F") {
        const allowedOwnerSegments = ["sales-report", "receivables"];
        if (!allowedOwnerSegments.includes(rootSegment)) {
          router.replace("/sales-report");
        }
      } else if (!rootSegment || rootSegment === "login") {
        // 2. Already logged in -> Go to Role-Specific Dashboard
        const role = user.role;
        const userName = (user.userName || "").trim().toUpperCase();

        if (userName === "KDS") {
          router.replace("/kds" as any);
        } else {
          router.replace("/(tabs)/category" as any);
        }
      }
    }
  }, [user, segments, fontsLoaded, authHydrated]);

  useEffect(() => {
    if ((fontsLoaded || fontError) && authHydrated) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, authHydrated]);

  if ((!fontsLoaded && !fontError) || !authHydrated) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <ToastProvider>
        {/* 🔔 Staff Toaster alerts for Table Service requests */}
        <SocketToastListener />
        {/* 📱 Web PWA Installation / Android APK Download Prompt */}
        <InstallAppModal />
        {/* 🖥️ Customer Display: auto-projects onto Sunmi D3 secondary screen */}
        <CustomerDisplayManager isPOSReady={isPOSReady} />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="login" options={{ gestureEnabled: false }} />
          <Stack.Screen name="table-selection" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="menu" />
          <Stack.Screen name="sales-report" />
          <Stack.Screen name="ai-chat" />
          <Stack.Screen name="day-end" />
          <Stack.Screen name="company-settings" />
          <Stack.Screen name="waiters" />
          <Stack.Screen name="members" />
          <Stack.Screen name="receivables" />
          <Stack.Screen name="waiter-history" />
          <Stack.Screen name="locked-tables" />
          <Stack.Screen name="kitchen-status" />
          <Stack.Screen name="heldOrders" />
          <Stack.Screen name="summary" />
          <Stack.Screen name="payment" />
          <Stack.Screen name="payment_success" />
          <Stack.Screen name="cart" />
          <Stack.Screen name="cash-drawer" />
          <Stack.Screen name="cash-drawer-report" />
          <Stack.Screen name="StaffAttendance" />
          <Stack.Screen name="loyalty" />
          <Stack.Screen name="loyaltyConfig" />
          <Stack.Screen name="terminal-settings" />
          <Stack.Screen name="customer-display" />
          <Stack.Screen name="table-master" />
          <Stack.Screen name="takeaway-qr" />
          <Stack.Screen name="qr-takeaway" />
        </Stack>
        <StatusBar style="light" />
      </ToastProvider>
    </SafeAreaProvider>
  );
}