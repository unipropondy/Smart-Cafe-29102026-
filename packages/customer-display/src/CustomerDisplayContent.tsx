/**
 * CustomerDisplayContent — Shared UI Package
 *
 * This is the single source of truth for the customer display UI.
 * It renders identically on:
 *   - Android (Sunmi D3) via the native React Native renderer
 *   - Windows (Electron BrowserWindow) via React Native Web
 *
 * All future UI changes (layout, colors, animations, branding, new fields)
 * should be made here ONLY — they will automatically apply to both platforms.
 *
 * Platform-specific isolation:
 *   - expo-router (Back button): guarded with Platform.OS !== 'web' check
 *   - State updates from Electron: received via window.postMessage (web only)
 *   - State updates from POS: received via socket.on('customer_display_sync') (all platforms)
 *   - Zustand persistence: AsyncStorage on Android, localStorage on web/Electron
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { API_URL, setApiUrl } from "./constants/Config";
import { Fonts } from "./constants/Fonts";
import { socket } from "./constants/socket";
import { Theme } from "./constants/theme";
import { useCompanySettingsStore } from "./stores/companySettingsStore";
import { usePaymentSettingsStore } from "./stores/paymentSettingsStore";
import { useTerminalStore, Terminal } from "./stores/terminalStore";
import { DisplayState, DEFAULT_STATE } from "./types/DisplayState";


const getLogoUri = (logo: string) => {
  if (!logo) return "";
  if (logo.startsWith("data:image")) return logo;
  if (logo.startsWith("http")) return logo;
  return `${API_URL}${logo.startsWith("/") ? "" : "/"}${logo}`;
};

export default function CustomerDisplayContent() {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isLandscape = windowWidth > windowHeight;

  const companySettings = useCompanySettingsStore((s: any) => s.settings);
  const paymentSettings = usePaymentSettingsStore((s: any) => s.settings);

  // Change 4 (part a): Back button uses expo-router which is not available in
  // Electron. We lazy-require it so the package does not crash on web.
  // On web the button returns null (not needed on the secondary monitor display).
  const renderBackButton = () => {
    if (Platform.OS === 'web') {
      return (
        <TouchableOpacity
          style={styles.floatingBackBtn}
          onPress={() => {
            if (typeof window !== 'undefined' && window.history) {
              window.history.back();
            }
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={18} color="#ef4444" />
          <Text style={{ color: '#ef4444', fontFamily: Fonts.bold, fontSize: 13 }}>
            Back
          </Text>
        </TouchableOpacity>
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useRouter } = require('expo-router');
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const router = useRouter();
    return (
      <TouchableOpacity
        style={styles.floatingBackBtn}
        onPress={() => {
          if (router.canGoBack()) {
            router.back();
          } else {
            router.replace('/(tabs)/category');
          }
        }}
        activeOpacity={0.7}
      >
        <Ionicons name="arrow-back" size={18} color="#ef4444" />
        <Text style={{ color: '#ef4444', fontFamily: Fonts.bold, fontSize: 13 }}>
          Back
        </Text>
      </TouchableOpacity>
    );
  };

  const [displayState, setDisplayState] = useState<DisplayState>(DEFAULT_STATE);
  const [floatingFoods, setFloatingFoods] = useState<any[]>([]);

  // â”€â”€â”€ TERMINAL PAIRING STATE â”€â”€â”€
  const terminalCode = useTerminalStore((s: any) => s.terminalCode);
  const terminalName = useTerminalStore((s: any) => s.terminalName);
  const isTerminalConfigured = useTerminalStore((s: any) => s.isConfigured);
  const [showTerminalModal, setShowTerminalModal] = useState(!isTerminalConfigured);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [terminalsLoading, setTerminalsLoading] = useState(false);
  const [selectedTerminalCode, setSelectedTerminalCode] = useState<string | null>(null);

  // Animation value for success screen fade/scale
  const successScale = useRef(new Animated.Value(0)).current;
  const successOpacity = useRef(new Animated.Value(0)).current;

  // 1. Initialize settings, socket listener & terminal room join
  useEffect(() => {
    // Inject custom fonts and vector icon font-faces on Web/Electron
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const styleId = 'customer-display-fonts-and-icons';
      if (!document.getElementById(styleId)) {
        const style = document.createElement('style');
        style.id = styleId;
        style.type = 'text/css';
        style.appendChild(document.createTextNode(`
          @font-face {
            font-family: 'Ionicons';
            src: url('https://unpkg.com/react-native-vector-icons@10.0.0/Fonts/Ionicons.ttf') format('truetype');
          }

          @font-face {
            font-family: 'Inter_400Regular';
            src: url('https://unpkg.com/@fontsource/inter@5.0.1/files/inter-latin-400-normal.woff2') format('woff2');
          }
          @font-face {
            font-family: 'Inter_500Medium';
            src: url('https://unpkg.com/@fontsource/inter@5.0.1/files/inter-latin-500-normal.woff2') format('woff2');
          }
          @font-face {
            font-family: 'Inter_600SemiBold';
            src: url('https://unpkg.com/@fontsource/inter@5.0.1/files/inter-latin-600-normal.woff2') format('woff2');
          }
          @font-face {
            font-family: 'Inter_700Bold';
            src: url('https://unpkg.com/@fontsource/inter@5.0.1/files/inter-latin-700-normal.woff2') format('woff2');
          }
          @font-face {
            font-family: 'Inter_800ExtraBold';
            src: url('https://unpkg.com/@fontsource/inter@5.0.1/files/inter-latin-800-normal.woff2') format('woff2');
          }
          @font-face {
            font-family: 'Inter_900Black';
            src: url('https://unpkg.com/@fontsource/inter@5.0.1/files/inter-latin-900-normal.woff2') format('woff2');
          }
        `));
        document.head.appendChild(style);
      }
    }

    const initSettings = () => {
      usePaymentSettingsStore.getState().fetchSettings();
      useCompanySettingsStore.getState().fetchSettings("1");
    };

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      fetch('/api/config')
        .then((r) => r.json())
        .then((data) => {
          const activeBackend = data?.backends?.find((b: any) => b.enabled);
          if (activeBackend && activeBackend.url) {
            console.log(`🖥️ [CustomerDisplay] Dynamically setting API_URL from print bridge config: ${activeBackend.url}`);
            setApiUrl(activeBackend.url);
          }
          initSettings();
        })
        .catch((err) => {
          console.warn('🖥️ [CustomerDisplay] Failed to fetch print bridge config, using default API_URL', err);
          initSettings();
        });
    } else {
      initSettings();
    }

    const handleSync = (data: any) => {
      console.log(
        "🖥️ [CustomerDisplay] Received sync event:",
        data.paymentSuccess ? "SUCCESS" : data.active ? "CART" : "IDLE",
      );
      setDisplayState(data);
    };

    socket.on("customer_display_sync", handleSync);

    // Auto-rejoin terminal room on every socket connect/reconnect
    const handleConnect = () => {
      useTerminalStore.getState().joinSocketRoom();
    };
    socket.on("connect", handleConnect);
    // Also join immediately if already connected
    if (socket.connected) {
      useTerminalStore.getState().joinSocketRoom();
    }

    return () => {
      socket.off("customer_display_sync", handleSync);
      socket.off("connect", handleConnect);
    };
  }, []);

  // Change 4 (part b): Electron IPC channel — web only.
  // The Print Bridge pushes state via Electron's executeJavaScript → window.postMessage.
  // This is a LOCAL fast-path that bypasses the Railway Socket.io round-trip.
  // On Android this effect is a no-op (Platform.OS !== 'web').
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handler = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.__source !== 'electron-print-bridge') return;

      console.log(
        '🖥️ [CustomerDisplay] Received Electron IPC state:',
        event.data.payload?.paymentSuccess ? 'SUCCESS'
          : event.data.payload?.active ? 'CART' : 'IDLE',
      );
      
      setDisplayState(event.data.payload);

      // Auto-detect and configure terminal code if pushed locally by the POS
      const payload = event.data.payload;
      if (payload && payload.terminalCode) {
        const currentCode = useTerminalStore.getState().terminalCode;
        if (currentCode !== payload.terminalCode) {
          console.log(`🖥️ [CustomerDisplay] Auto-detecting and setting terminal from Electron payload: ${payload.terminalCode}`);
          useTerminalStore.getState().setTerminal(payload.terminalCode, payload.terminalCode);
          setShowTerminalModal(false);
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Fetch terminals when the modal opens
  useEffect(() => {
    if (!showTerminalModal) return;
    setTerminalsLoading(true);
    fetch(`${API_URL}/api/terminal`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setTerminals(data);
        } else if (Array.isArray(data?.data)) {
          setTerminals(data.data);
        } else {
          setTerminals([]);
        }
      })
      .catch(() => setTerminals([]))
      .finally(() => setTerminalsLoading(false));
  }, [showTerminalModal]);


  // 2. Success screen trigger
  useEffect(() => {
    if (displayState.paymentSuccess) {
      // Animate success screen entrance
      Animated.parallel([
        Animated.spring(successScale, {
          toValue: 1,
          tension: 40,
          friction: 6,
          useNativeDriver: true,
        }),
        Animated.timing(successOpacity, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      successScale.setValue(0);
      successOpacity.setValue(0);
    }
  }, [displayState.paymentSuccess]);

  // 3. Spawning popping food animations for Attract Loop
  useEffect(() => {
    if (displayState.active) {
      setFloatingFoods([]);
      return;
    }

    const icons = [
      "pizza-outline",
      "cafe-outline",
      "ice-cream-outline",
      "restaurant-outline",
      "beer-outline",
      "fast-food-outline",
    ];

    const interval = setInterval(() => {
      const id = Math.random().toString();
      const icon = icons[Math.floor(Math.random() * icons.length)];
      // Spawn coordinates (percentage of screen viewport)
      const x = Math.random() * 80 + 10;
      const y = Math.random() * 70 + 15;

      const scale = new Animated.Value(0);
      const translateY = new Animated.Value(0);
      const opacity = new Animated.Value(1);

      const newItem = { id, icon, x, y, scale, translateY, opacity };
      setFloatingFoods((prev) => [...prev, newItem].slice(-15)); // Keep max 15 on screen

      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1.3,
          tension: 30,
          friction: 4,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -80 - Math.random() * 50,
          duration: 3500,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          delay: 2200,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Clean up from state once finished
        setFloatingFoods((prev) => prev.filter((item) => item.id !== id));
      });
    }, 900);

    return () => clearInterval(interval);
  }, [displayState.active]);

  // 4. Generate UPI QR URL
  const upiUrl = (() => {
    if (!paymentSettings.upiId) return "";
    const cleanUpiId = paymentSettings.upiId.trim();
    const cleanShopName = paymentSettings.shopName.replace(/[&?=]/g, "").trim();
    return `upi://pay?pa=${cleanUpiId}&pn=${encodeURIComponent(cleanShopName)}&am=${(displayState.netTotal || 0).toFixed(2)}&cu=INR`;
  })();

  // â”€â”€â”€ RENDERS â”€â”€â”€

  // â”€â”€ Terminal Setup Modal helper â”€â”€
  const renderTerminalModal = () => (
    <Modal
      visible={showTerminalModal}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (isTerminalConfigured) setShowTerminalModal(false);
      }}
    >
      <View style={styles.terminalModalOverlay}>
        <View style={styles.terminalModalCard}>
          {/* Header */}
          <View style={styles.terminalModalHeader}>
            <Ionicons name="tv-outline" size={32} color={Theme.primary} />
            <Text style={styles.terminalModalTitle}>Customer Display Setup</Text>
            <Text style={styles.terminalModalSubtitle}>
              Select the counter this screen is paired with.{"\n"}
              The POS at that counter will sync to this display.
            </Text>
          </View>

          {/* Terminal List */}
          {terminalsLoading ? (
            <ActivityIndicator
              color={Theme.primary}
              size="large"
              style={{ marginVertical: 32 }}
            />
          ) : terminals.length === 0 ? (
            <View style={{ alignItems: "center", paddingVertical: 24 }}>
              <Ionicons name="alert-circle-outline" size={40} color={Theme.textMuted} />
              <Text style={styles.terminalModalEmpty}>
                No terminals found.{"\n"}Please configure terminals in the backoffice.
              </Text>
            </View>
          ) : (
            <FlatList
              data={terminals}
              keyExtractor={(item) => item.TerminalCode}
              style={styles.terminalList}
              renderItem={({ item }) => {
                const isSelected = selectedTerminalCode === item.TerminalCode;
                return (
                  <TouchableOpacity
                    style={[
                      styles.terminalItem,
                      isSelected && styles.terminalItemSelected,
                    ]}
                    activeOpacity={0.75}
                    onPress={() => setSelectedTerminalCode(item.TerminalCode)}
                  >
                    <Ionicons
                      name={isSelected ? "radio-button-on" : "radio-button-off"}
                      size={22}
                      color={isSelected ? Theme.primary : Theme.textMuted}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.terminalItemCode, isSelected && { color: Theme.primary }]}>
                        {item.TerminalCode}
                      </Text>
                      {item.TerminalName ? (
                        <Text style={styles.terminalItemName}>{item.TerminalName}</Text>
                      ) : null}
                    </View>
                    {isSelected && (
                      <Ionicons name="checkmark-circle" size={20} color={Theme.primary} />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          )}

          {/* Action Buttons */}
          <View style={styles.terminalModalActions}>
            {isTerminalConfigured && (
              <TouchableOpacity
                style={styles.terminalModalBtnCancel}
                onPress={() => setShowTerminalModal(false)}
              >
                <Text style={styles.terminalModalBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[
                styles.terminalModalBtnConfirm,
                !selectedTerminalCode && { opacity: 0.4 },
              ]}
              disabled={!selectedTerminalCode}
              onPress={() => {
                if (!selectedTerminalCode) return;
                const found = terminals.find((t) => t.TerminalCode === selectedTerminalCode);
                useTerminalStore
                  .getState()
                  .setTerminal(selectedTerminalCode, found?.TerminalName || selectedTerminalCode);
                setShowTerminalModal(false);
              }}
            >
              <Ionicons name="link-outline" size={18} color="#fff" />
              <Text style={styles.terminalModalBtnConfirmText}>Pair Display</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );

  // Success view
  if (displayState.paymentSuccess && paymentSettings.customerSideDisplay) {
    return (
      <View style={styles.successContainer}>
        {renderTerminalModal()}
        {renderBackButton()}

        <View style={styles.successMainContent}>
          <Animated.View
            style={[
              styles.successCard,
              {
                transform: [{ scale: successScale }],
                opacity: successOpacity,
              },
            ]}
          >
            <View style={styles.successIconWrapper}>
              {companySettings?.companyLogo ? (
                <Image
                  source={{ uri: getLogoUri(companySettings.companyLogo) }}
                  style={{ width: 100, height: 100, borderRadius: 50 }}
                  resizeMode="contain"
                />
              ) : (
                <Ionicons
                  name="checkmark-circle"
                  size={100}
                  color={Theme.success}
                />
              )}
            </View>
            <Text style={styles.successTitle}>Payment Successful</Text>
            <Text style={styles.successOrderText}>
              Order #{displayState.orderId}
            </Text>

            <View style={styles.dashedDivider} />

            <View style={styles.successDetails}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Settlement Mode</Text>
                <Text style={styles.detailValue}>
                  {displayState.paymentMethod || "CARD/UPI"}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Amount Paid</Text>
                <Text style={[styles.detailValue, { color: Theme.primary }]}>
                  {companySettings.currencySymbol || "$"}
                  {displayState.paid?.toFixed(2) ||
                    (displayState.netTotal || 0).toFixed(2)}
                </Text>
              </View>
              {displayState.change && displayState.change > 0 ? (
                <View style={styles.detailRow}>
                  <Text style={styles.detailLabel}>Change Given</Text>
                  <Text style={styles.detailValue}>
                    {companySettings.currencySymbol || "$"}
                    {(displayState.change || 0).toFixed(2)}
                  </Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.successFooter}>Thank you! Visit us again.</Text>
          </Animated.View>
        </View>

        {/* Unipro Footer on Success Screen */}
        <View style={[styles.idleUniproFooter, { marginTop: 24, transform: [{ scale: 0.85 }] }]}>
          <Image
            source={require("./assets/images/unipro_logo.png")}
            style={styles.uniproLogoImage}
            resizeMode="contain"
          />
        </View>
      </View>
    );
  }

  // Active checkout view
  if (displayState.active) {
    // ═════════════════════════════════════════════════════════════════════════
    // QUICK SERVE DEDICATED SCREEN MIRROR VIEW
    // Mirrors the exact Quick Serve layout (Cart, Groups, Dishes & Paymode)
    // ═════════════════════════════════════════════════════════════════════════
    if (displayState.isQuickServe) {
      const qsItems = displayState.items || [];
      const qsGroups = displayState.quickServeGroups || [];
      const qsDishes = displayState.quickServeDishes || [];
      const qsPaymodes = displayState.quickServePaymodes || [];
      const currentMethod = (displayState.paymentMethod || "CASH").toUpperCase().trim();
      const currSymbol = companySettings?.currencySymbol || "$";
      const isPayNowMode = currentMethod === "PAYNOW" || currentMethod === "PAY-NOW";
      const payNowQr = paymentSettings?.payNowQrUrl ? getLogoUri(paymentSettings.payNowQrUrl) : "";
      const isUpiMode = currentMethod === "UPI" || (/UPI|GPAY|PHONE|PAYTM/i.test(currentMethod) && !!paymentSettings?.upiId);

      return (
        <View style={styles.qsMirrorContainer}>
          {renderTerminalModal()}
          {renderBackButton()}

          {/* Change Terminal Pill */}
          {terminalCode ? (
            <TouchableOpacity
              style={styles.terminalPill}
              onPress={() => {
                setSelectedTerminalCode(terminalCode);
                setShowTerminalModal(true);
              }}
            >
              <Ionicons name="tv-outline" size={12} color={Theme.primary} />
              <Text style={styles.terminalPillText}>{terminalName || terminalCode}</Text>
            </TouchableOpacity>
          ) : null}

          {/* TOP QUICK SERVE HEADER BAR */}
          <View style={styles.qsMirrorTopNavbar}>
            <View style={styles.qsMirrorNavLeft}>
              <View style={styles.qsMirrorLogoWrap}>
                <Ionicons name="flash" size={20} color="#FF5A16" style={{ marginRight: 6 }} />
                <Text style={styles.qsMirrorLogoTitle}>
                  Quick Serve <Text style={{ color: "#FF5A16" }}>POS</Text>
                </Text>
              </View>
              <View style={styles.qsMirrorCustomerBadge}>
                <Ionicons name="eye-outline" size={13} color="#FF5A16" style={{ marginRight: 4 }} />
                <Text style={styles.qsMirrorCustomerBadgeText}>Customer Display</Text>
              </View>
            </View>

            <View style={styles.qsMirrorNavRight}>
              <View style={styles.qsMirrorOrderTypePill}>
                <Ionicons
                  name={displayState.orderType === "TAKEAWAY" ? "bag-handle-outline" : "cart-outline"}
                  size={15}
                  color="#FF5A16"
                  style={{ marginRight: 5 }}
                />
                <Text style={styles.qsMirrorOrderTypePillText}>
                  {displayState.orderType === "TAKEAWAY" ? "Takeaway" : "Dine In"}
                </Text>
              </View>

              {displayState.tableNo ? (
                <View style={styles.qsMirrorTablePill}>
                  <View style={styles.qsMirrorTableCircle}>
                    <Text style={styles.qsMirrorTableCircleText}>
                      {String(displayState.tableNo).replace(/[^0-9]/g, "") || "1"}
                    </Text>
                  </View>
                  <Text style={styles.qsMirrorTableNameText}>
                    {displayState.tableNo}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* MAIN 3-COLUMN QUICK SERVE SCREEN MIRROR BODY */}
          <View style={[styles.qsMirrorBody, windowWidth < 768 && styles.qsMirrorBodyMobile, windowWidth >= 768 && windowWidth < 1100 && styles.qsMirrorBodyTablet]}>
            {/* ════════ COLUMN 1: CURRENT ORDER & TOTALS & PAYMODE ════════ */}
            <View style={[styles.qsMirrorColCart, windowWidth < 768 && styles.qsMirrorColCartMobile, windowWidth >= 768 && windowWidth < 1100 && styles.qsMirrorColCartTablet]}>
              <View style={styles.qsMirrorCartHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="cart" size={17} color="#FFFFFF" />
                  <Text style={styles.qsMirrorCartHeaderTitle}>Current Order</Text>
                  <View style={styles.qsMirrorCartCountBadge}>
                    <Text style={styles.qsMirrorCartCountText}>
                      {qsItems.reduce((acc: number, it: any) => acc + (it.qty || 1), 0)}
                    </Text>
                  </View>
                </View>
              </View>

              {/* CART ITEMS SCROLL */}
              <ScrollView style={styles.qsMirrorCartScroll} showsVerticalScrollIndicator={false}>
                {qsItems.length === 0 ? (
                  <View style={styles.qsMirrorEmptyCart}>
                    <Ionicons name="basket-outline" size={38} color="#CBD5E1" />
                    <Text style={styles.qsMirrorEmptyCartTitle}>Order cart is empty</Text>
                    <Text style={styles.qsMirrorEmptyCartSub}>Dishes added will appear here</Text>
                  </View>
                ) : (
                  qsItems.map((item: any, idx: number) => {
                    const lineTotal = Number(item.finalPrice !== undefined ? item.finalPrice : (item.price || 0) * (item.qty || 1));
                    return (
                      <View key={item.lineItemId || idx} style={styles.qsMirrorCartItem}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={styles.qsMirrorCartItemName} numberOfLines={2}>
                            {item.name}
                          </Text>
                          {item.modifiers && item.modifiers.length > 0 ? (
                            <View style={{ marginTop: 2 }}>
                              {item.modifiers.map((m: any, mIdx: number) => (
                                <Text key={mIdx} style={styles.qsMirrorCartItemSub}>
                                  + {m.ModifierName || m.name || m}
                                </Text>
                              ))}
                            </View>
                          ) : null}
                        </View>
                        <View style={styles.qsMirrorCartQtyPill}>
                          <Text style={styles.qsMirrorCartQtyText}>× {item.qty}</Text>
                        </View>
                        <Text style={styles.qsMirrorCartItemPrice}>
                          {currSymbol}{lineTotal.toFixed(2)}
                        </Text>
                      </View>
                    );
                  })
                )}
              </ScrollView>

              {/* CART TOTALS AREA */}
              <View style={styles.qsMirrorCartFooter}>
                <View style={styles.qsMirrorSummaryRow}>
                  <Text style={styles.qsMirrorSummaryLabel}>Subtotal</Text>
                  <Text style={styles.qsMirrorSummaryVal}>{currSymbol}{(displayState.subTotal || 0).toFixed(2)}</Text>
                </View>

                {displayState.orderDiscountAmount > 0 || displayState.itemDiscounts > 0 ? (
                  <View style={styles.qsMirrorSummaryRow}>
                    <Text style={[styles.qsMirrorSummaryLabel, { color: "#FF5A16" }]}>Discount</Text>
                    <Text style={[styles.qsMirrorSummaryVal, { color: "#FF5A16" }]}>
                      -{currSymbol}{((displayState.orderDiscountAmount || 0) + (displayState.itemDiscounts || 0)).toFixed(2)}
                    </Text>
                  </View>
                ) : null}

                {(displayState.serviceChargeAmount || 0) > 0 ? (
                  <View style={styles.qsMirrorSummaryRow}>
                    <Text style={styles.qsMirrorSummaryLabel}>
                      Service Charge ({displayState.serviceChargePercentage || 0}%)
                    </Text>
                    <Text style={styles.qsMirrorSummaryVal}>{currSymbol}{(displayState.serviceChargeAmount || 0).toFixed(2)}</Text>
                  </View>
                ) : null}

                {(displayState.gstAmount || 0) > 0 ? (
                  <View style={styles.qsMirrorSummaryRow}>
                    <Text style={styles.qsMirrorSummaryLabel}>GST</Text>
                    <Text style={styles.qsMirrorSummaryVal}>{currSymbol}{(displayState.gstAmount || 0).toFixed(2)}</Text>
                  </View>
                ) : null}

                <View style={styles.qsMirrorFinalTotalCard}>
                  <Text style={styles.qsMirrorFinalTotalLabel}>Total Payable</Text>
                  <Text style={styles.qsMirrorFinalTotalVal}>
                    {currSymbol}{(displayState.netTotal || 0).toFixed(2)}
                  </Text>
                </View>

                {/* PAYMODE BADGES / ACTIVE PAYMENT BAR */}
                <View style={styles.qsMirrorPaymodeSection}>
                  <View style={styles.qsMirrorPaymodeHeader}>
                    <Text style={styles.qsMirrorPaymodeTitle}>Payment Mode</Text>
                    <View style={styles.qsMirrorActiveModeBadge}>
                      <Ionicons name="checkmark-circle" size={13} color="#FF5A16" style={{ marginRight: 4 }} />
                      <Text style={styles.qsMirrorActiveModeText}>{currentMethod}</Text>
                    </View>
                  </View>

                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.qsMirrorPaymodesRow}>
                    {(qsPaymodes.length > 0 ? qsPaymodes : [
                      { key: "CASH", label: "Cash" },
                      { key: "CARD", label: "Card" },
                      { key: "NETS", label: "NETS" },
                      { key: "PAYNOW", label: "PayNow" },
                      { key: "UPI", label: "UPI" },
                    ]).map((pm: any) => {
                      const isSel = pm.isSelected || pm.key === currentMethod;
                      return (
                        <View
                          key={pm.key}
                          style={[
                            styles.qsMirrorPaymodePill,
                            isSel && styles.qsMirrorPaymodePillActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.qsMirrorPaymodePillText,
                              isSel && styles.qsMirrorPaymodePillTextActive,
                            ]}
                          >
                            {pm.label}
                          </Text>
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>

                {/* QR CODE DISPLAY IF PAYNOW OR UPI SELECTED */}
                {(isPayNowMode && (payNowQr || paymentSettings?.payNowQrUrl)) || (isUpiMode && paymentSettings?.upiId) ? (
                  <View style={styles.qsMirrorQrCard}>
                    <Text style={styles.qsMirrorQrTitle}>
                      {isPayNowMode ? "Scan with PayNow" : "Scan to Pay UPI"}
                    </Text>
                    <View style={styles.qsMirrorQrBox}>
                      {isPayNowMode && payNowQr ? (
                        <Image
                          source={{ uri: payNowQr }}
                          style={{ width: 100, height: 100 }}
                          resizeMode="contain"
                        />
                      ) : (
                        <QRCode
                          value={paymentSettings?.upiId ? `upi://pay?pa=${paymentSettings.upiId}&pn=${encodeURIComponent(companySettings?.name || "Restaurant")}&am=${(displayState.netTotal || 0).toFixed(2)}&cu=INR` : "https://paynow.sg"}
                          size={100}
                        />
                      )}
                    </View>
                    <Text style={styles.qsMirrorQrSubtitle}>
                      {currSymbol}{(displayState.netTotal || 0).toFixed(2)}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            {/* ════════ COLUMN 2: CENTER GROUPS / CATEGORIES ════════ */}
            <View style={styles.qsMirrorColGroups}>
              <View style={styles.qsMirrorPanelHeader}>
                <Ionicons name="restaurant-outline" size={16} color="#FF5A16" />
                <Text style={styles.qsMirrorPanelHeaderTitle}>Dish Groups</Text>
              </View>

              <ScrollView style={styles.qsMirrorGroupsScroll} showsVerticalScrollIndicator={false}>
                {qsGroups.length === 0 ? (
                  <View style={styles.qsMirrorEmptyGroups}>
                    <Ionicons name="grid-outline" size={32} color="#CBD5E1" />
                    <Text style={styles.qsMirrorEmptyGroupsText}>Menu Groups</Text>
                  </View>
                ) : (
                  qsGroups.map((g: any) => {
                    const isGroupActive = !!g.isActive;
                    return (
                      <View
                        key={g.id}
                        style={[
                          styles.qsMirrorGroupCard,
                          isGroupActive && styles.qsMirrorGroupCardActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.qsMirrorGroupName,
                            isGroupActive && styles.qsMirrorGroupNameActive,
                          ]}
                          numberOfLines={1}
                        >
                          {g.name}
                        </Text>
                        {g.count !== undefined ? (
                          <View
                            style={[
                              styles.qsMirrorGroupBadge,
                              isGroupActive && styles.qsMirrorGroupBadgeActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.qsMirrorGroupBadgeText,
                                isGroupActive && styles.qsMirrorGroupBadgeTextActive,
                              ]}
                            >
                              {g.count}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    );
                  })
                )}
              </ScrollView>
            </View>

            {/* ════════ COLUMN 3: RIGHT DISHES GRID ════════ */}
            <View style={styles.qsMirrorColDishes}>
              <View style={styles.qsMirrorPanelHeader}>
                <Ionicons name="fast-food-outline" size={17} color="#FF5A16" />
                <Text style={styles.qsMirrorPanelHeaderTitle}>
                  {displayState.quickServeCategoryTitle || "Featured Menu"}
                </Text>
              </View>

              <ScrollView
                style={styles.qsMirrorDishesScroll}
                contentContainerStyle={styles.qsMirrorDishesGrid}
                showsVerticalScrollIndicator={false}
              >
                {qsDishes.length === 0 ? (
                  <View style={styles.qsMirrorEmptyDishes}>
                    <Ionicons name="restaurant-outline" size={44} color="#CBD5E1" />
                    <Text style={styles.qsMirrorEmptyDishesText}>Browse live items on POS</Text>
                  </View>
                ) : (
                  qsDishes.map((dish: any) => {
                    const inCart = (dish.qtyInCart || 0) > 0;
                    return (
                      <View key={dish.id} style={styles.qsMirrorDishCard}>
                        <View style={styles.qsMirrorDishImgWrap}>
                          {dish.image ? (
                            <Image
                              source={{ uri: dish.image }}
                              style={styles.qsMirrorDishImg}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={styles.qsMirrorDishImgPlaceholder}>
                              <Ionicons name="restaurant" size={24} color="#CBD5E1" />
                            </View>
                          )}
                          {inCart ? (
                            <View style={styles.qsMirrorInCartBadge}>
                              <Text style={styles.qsMirrorInCartBadgeText}>{dish.qtyInCart}</Text>
                            </View>
                          ) : null}
                          {dish.isSoldOut ? (
                            <View style={styles.qsMirrorSoldOutBadge}>
                              <Text style={styles.qsMirrorSoldOutText}>Sold Out</Text>
                            </View>
                          ) : null}
                        </View>
                        <View style={styles.qsMirrorDishBody}>
                          <Text style={styles.qsMirrorDishName} numberOfLines={1}>
                            {dish.name}
                          </Text>
                          <Text style={styles.qsMirrorDishPrice}>
                            {currSymbol}{(dish.price || 0).toFixed(2)}
                          </Text>
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </View>
        </View>
      );
    }

    const pm = (displayState.paymentMethod || '').toUpperCase().trim();
    const isYeahPayPayNow = pm === 'YEAHPAY_PAYNOW';
    const isUPI =
      /UPI|GPAY|PHONE|PAYTM/i.test(pm) ||
      (displayState.paymentMethod === undefined && paymentSettings.upiId);
    // Regular PayNow (not YeahPay) with a static QR configured
    const isRegularPayNow =
      !isYeahPayPayNow &&
      (/^(PAYNOW|PAY-NOW|QR)$/i.test(pm) ||
        (displayState.paymentMethod === undefined && paymentSettings.payNowQrUrl));

    const activeItems = displayState.items || [];
    const allItemsHaveSC = activeItems.length > 0 && activeItems.every((item: any) => Number(item.isServiceCharge) === 1 || item.isServiceCharge === true);

    return (
      <View style={styles.checkoutContainer}>
        {renderTerminalModal()}
        {renderBackButton()}
        {/* Change Terminal pill */}
        {terminalCode ? (
          <TouchableOpacity
            style={styles.terminalPill}
            onPress={() => {
              setSelectedTerminalCode(terminalCode);
              setShowTerminalModal(true);
            }}
          >
            <Ionicons name="tv-outline" size={12} color={Theme.primary} />
            <Text style={styles.terminalPillText}>{terminalName || terminalCode}</Text>
          </TouchableOpacity>
        ) : null}
        {/* Top Header Banner */}
        <View style={styles.topHeaderBanner}>
          <Text style={styles.topHeaderText} numberOfLines={1}>
            {companySettings.name || paymentSettings.shopName || ""}
          </Text>
          {displayState.section || displayState.tableNo ? (
            <View style={styles.headerInfoContainer}>
              {displayState.section ? (
                <Text style={styles.headerSectionText}>
                  {displayState.section}
                </Text>
              ) : null}
              {displayState.tableNo ? (
                <View style={styles.headerTableBadge}>
                  <Text style={styles.headerTableText}>
                    {displayState.tableNo}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        <View
          style={[
            styles.checkoutLayout,
            isLandscape && styles.checkoutLayoutLandscape,
          ]}
        >
          {/* Left Pane: Payment QR / Restaurant Logo & Branding Footer */}
          <View style={styles.leftPane}>
            <View style={styles.leftMainContent}>
              {displayState.isSplit ? (
                <View style={styles.splitCard}>
                  <View style={styles.splitHeader}>
                    <Ionicons name="git-compare-outline" size={24} color={Theme.primary} />
                    <Text style={styles.splitTitle}>Split Payments</Text>
                  </View>
                  <ScrollView style={styles.splitScroll} showsVerticalScrollIndicator={false}>
                    {displayState.splitPayments && displayState.splitPayments.map((p, idx) => {
                      const isPaid = p.status === "Paid";
                      const isCancelled = p.status === "Cancelled";
                      return (
                        <View key={idx} style={styles.splitRow}>
                          <View style={styles.splitRowLeft}>
                            <View style={[styles.splitIndicator, { backgroundColor: isPaid ? Theme.success : isCancelled ? Theme.danger : Theme.warning }]} />
                            <Text style={styles.splitPaymodeText}>{p.payMode.toUpperCase()}</Text>
                          </View>
                          <Text style={styles.splitAmountText}>
                            {companySettings.currencySymbol || "$"}
                            {p.amount.toFixed(2)}
                          </Text>
                          <View style={[
                            styles.splitStatusBadge,
                            { backgroundColor: isPaid ? Theme.success + "15" : isCancelled ? Theme.danger + "15" : Theme.warning + "15" }
                          ]}>
                            <Text style={[
                              styles.splitStatusText,
                              { color: isPaid ? Theme.success : isCancelled ? Theme.danger : Theme.warning }
                            ]}>
                              {p.status.toUpperCase()}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </ScrollView>
                  <View style={styles.splitFooter}>
                    <Text style={styles.splitFooterLabel}>Total Due</Text>
                    <Text style={styles.splitFooterValue}>
                      {companySettings.currencySymbol || "$"}
                      {(displayState.netTotal || 0).toFixed(2)}
                    </Text>
                  </View>
                </View>
              ) : displayState.paymentMethod && isUPI && paymentSettings.upiId ? (
                <View style={styles.qrCard}>
                  <Text style={styles.qrTitle}>Scan to Pay via UPI</Text>
                  <View style={styles.qrImageContainer}>
                    {Platform.OS === "web" ? (
                      <Image
                        source={{
                          uri: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiUrl)}`,
                        }}
                        style={styles.webQrImage}
                        resizeMode="contain"
                      />
                    ) : (
                      <QRCode
                        value={upiUrl}
                        size={200}
                        color="#000"
                        backgroundColor="#fff"
                      />
                    )}
                  </View>
                  <Text style={styles.qrSubtitle}>
                    GPay, PhonePe, Paytm, BHIM
                  </Text>
                </View>
              ) : displayState.paymentMethod &&
                isRegularPayNow &&
                paymentSettings.payNowQrUrl ? (
                <View style={styles.qrCard}>
                  <Text style={styles.qrTitle}>Scan to Pay via PayNow</Text>
                  <View style={styles.qrImageContainer}>
                    <Image
                      source={{
                        uri: paymentSettings.payNowQrUrl.startsWith("data:")
                          ? paymentSettings.payNowQrUrl
                          : `${API_URL}${paymentSettings.payNowQrUrl}`,
                      }}
                      style={styles.payNowQrImage}
                      resizeMode="contain"
                    />
                  </View>
                  <Text style={styles.qrSubtitle}>
                    Scan QR code with your mobile banking app
                  </Text>
                </View>
              ) : displayState.paymentMethod ? (
                (() => {
                  const m = pm;
                  const isMemberPayMode = /^(MEMBER|CREDIT)$/i.test(m);
                  const isYeahPayPayNowMode = m === 'YEAHPAY_PAYNOW';

                  let info: { label: string; icon: string; color: string; subLabel?: string } = {
                    label: m,
                    icon: "wallet-outline",
                    color: Theme.primary,
                  };
                  if (/^(CAS|CASH)$/i.test(m)) {
                    info = { label: "CASH", icon: "cash-outline", color: "#10B981" };
                  } else if (m === 'YEAHPAY_CARD') {
                    info = { label: "YEAHPAY (CARD)", icon: "card-outline", color: "#0284C7" };
                  } else if (/CARD/i.test(m)) {
                    info = { label: "CARD PAYMENT", icon: "card-outline", color: "#3B82F6" };
                  } else if (/^(UPI|GPAY|PHONEPE|PAYTM|BHIM)$/i.test(m)) {
                    info = { label: "UPI", icon: "qr-code-outline", color: "#8B5CF6" };
                  } else if (isYeahPayPayNowMode) {
                    info = { label: "YEAHPAY (PAYNOW)", icon: "phone-portrait-outline", color: "#06B6D4" };
                  } else if (/^(PAYNOW|PAY-NOW)$/i.test(m)) {
                    info = { label: "PAYNOW", icon: "qr-code-outline", color: "#EC4899" };
                  } else if (/^(NET|NETS)$/i.test(m)) {
                    info = { label: "NETS", icon: "wallet-outline", color: "#F59E0B" };
                  } else if (isMemberPayMode) {
                    info = {
                      label: m === 'CREDIT' ? 'CREDIT PAYMENT' : 'MEMBER CREDIT',
                      icon: "person-circle-outline",
                      color: "#7C3AED",
                      subLabel: displayState.memberName || '',
                    };
                  }

                  return (
                    <View style={styles.paymodeSelectedCard}>
                      <View style={[styles.paymodeIconContainer, { backgroundColor: info.color + "12" }]}>
                        <Ionicons name={info.icon as any} size={50} color={info.color} />
                      </View>
                      <Text style={styles.paymodeTitle}>Selected Payment Mode</Text>
                      <Text style={[styles.paymodeLabel, { color: info.color }]}>{info.label}</Text>

                      {/* Member name displayed prominently below mode label */}
                      {info.subLabel ? (
                        <View style={styles.memberNameBadge}>
                          <Ionicons name="person" size={14} color={info.color} />
                          <Text style={[styles.memberNameText, { color: info.color }]}>
                            {info.subLabel}
                          </Text>
                        </View>
                      ) : null}

                      <View style={styles.paymodeAmountBox}>
                        <Text style={styles.paymodeAmountLabel}>Amount Due</Text>
                        <Text style={styles.paymodeAmountValue}>
                          {companySettings.currencySymbol || "$"}
                          {(displayState.netTotal || 0).toFixed(2)}
                        </Text>
                      </View>
                    </View>
                  );
                })()
              ) : (
                <View style={styles.logoCard}>
                  {companySettings.companyLogo ? (
                    <View style={styles.logoCircle}>
                      <Image
                        source={{
                          uri: getLogoUri(companySettings.companyLogo),
                        }}
                        style={styles.largeRestaurantLogo}
                        resizeMode="contain"
                      />
                    </View>
                  ) : (
                    <View style={styles.logoCircleFallback}>
                      <Ionicons name="restaurant" size={80} color="#fff" />
                    </View>
                  )}
                  <Text style={styles.logoShopName}>
                    {companySettings.name || paymentSettings.shopName || ""}
                  </Text>
                </View>

              )}
            </View>

            {/* Mandatory Unipro Branding Footer (Always present on left column) */}
            <View style={styles.uniproFooterContainer}>
              <Image
                source={require('./assets/images/unipro_logo.png')}
                style={styles.uniproLogoImage}
                resizeMode="contain"
              />
            </View>
          </View>

          {/* Right Pane: Cart & Totals Summary */}
          <View style={styles.rightPane}>
            {/* Table Header */}
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.tableHeaderCell, styles.cellDesc]}>
                Description
              </Text>
              <Text style={[styles.tableHeaderCell, styles.cellQty]}>Qty</Text>
              <Text
                style={[styles.tableHeaderCell, styles.tableHeaderCellTotal]}
              >
                Total
              </Text>
            </View>

            {/* Itemized List */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              style={styles.receiptItemsScroll}
            >
              {displayState.items.map((item, idx) => {
                const allItemsHaveSC = displayState.items.every(i => (Number(i.isServiceCharge) === 1 || i.isServiceCharge === true));
                return (
                  <View
                    key={`${item.lineItemId}-${idx}`}
                    style={[
                      styles.receiptItemRow,
                      item.isVoided && styles.voidedRow,
                    ]}
                  >
                    <View style={styles.cellDesc}>
                      <Text
                        style={[
                          styles.receiptItemName,
                          item.isVoided && styles.voidedText,
                        ]}
                      >
                        {item.name}
                        {(Number(item.isServiceCharge) === 1 || item.isServiceCharge === true) && " *"}
                        {item.isVoided && " (VOIDED)"}
                      </Text>
                      {(Number(item.isServiceCharge) === 1 || item.isServiceCharge === true) && !item.isVoided ? (
                        <Text style={[styles.receiptItemModifier, { color: Theme.danger, fontSize: 11 }]}>
                          * Subject to Service Charge
                        </Text>
                      ) : null}
                      {item.discountAmount > 0 && !item.isVoided ? (
                        <Text style={styles.receiptItemDiscount}>
                          ðŸ ·ï¸  Discount: -{companySettings.currencySymbol || "$"}
                          {item.discountAmount.toFixed(2)}
                          {item.discountPercent > 0
                            ? ` (${item.discountPercent}%)`
                            : ""}
                        </Text>
                      ) : null}
                      {item.note ? (
                        <Text style={styles.receiptItemNote}>ðŸ“  {item.note}</Text>
                      ) : null}
                      {item.modifiers &&
                        item.modifiers.map((m: any, mIdx: number) => {
                          const price = Number(m.Price || m.price || m.Amount || m.amount || 0);
                          const symbol = companySettings.currencySymbol || "$";
                          return (
                            <Text key={mIdx} style={styles.receiptItemModifier}>
                              + {m.ModifierName}
                              {price > 0 ? ` (+${symbol}${price.toFixed(2)})` : ""}
                            </Text>
                          );
                        })}
                    </View>
                    <Text
                      style={[
                        styles.receiptItemQty,
                        styles.cellQty,
                        item.isVoided && styles.voidedText,
                      ]}
                    >
                      {(item.qty || 0).toFixed(2)}
                    </Text>
                    <View style={styles.cellTotal}>
                      {item.discountAmount > 0 && !item.isVoided ? (
                        <Text style={styles.receiptItemOriginalPrice}>
                          {companySettings.currencySymbol || "$"}
                          {(item.originalPrice || 0).toFixed(2)}
                        </Text>
                      ) : null}
                      <Text
                        style={[
                          styles.receiptItemTotal,
                          item.isVoided && styles.voidedText,
                        ]}
                      >
                        {companySettings.currencySymbol || "$"}
                        {(item.finalPrice || 0).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            {/* Summary details */}
            <View style={styles.receiptSummaryContainer}>
              <View style={styles.breakdownRow}>
                <View style={styles.breakdownItem}>
                  <Text style={styles.breakdownLabel}>Sub Total</Text>
                  <Text style={styles.breakdownValue}>
                    {companySettings.currencySymbol || "$"}
                    {(displayState.subTotal || 0).toFixed(2)}
                  </Text>
                </View>

                {(displayState.itemDiscounts || 0) +
                  (displayState.orderDiscountAmount || 0) >
                0 ? (
                  <View style={styles.breakdownItem}>
                    <Text
                      style={[styles.breakdownLabel, { color: Theme.danger }]}
                    >
                      Discount
                    </Text>
                    <Text
                      style={[styles.breakdownValue, { color: Theme.danger }]}
                    >
                      {companySettings.currencySymbol || "$"}
                      {(
                        (displayState.itemDiscounts || 0) +
                        (displayState.orderDiscountAmount || 0)
                      ).toFixed(2)}
                    </Text>
                  </View>
                ) : null}

                {displayState.gstAmount > 0 ? (
                  <View style={styles.breakdownItem}>
                    <Text style={styles.breakdownLabel}>GST</Text>
                    <Text style={styles.breakdownValue}>
                      {companySettings.currencySymbol || "$"}
                      {(displayState.gstAmount || 0).toFixed(2)}
                    </Text>
                  </View>
                ) : null}

                {displayState.serviceChargeAmount && displayState.serviceChargeAmount > 0 ? (
                  <View style={styles.breakdownItem}>
                    <Text style={styles.breakdownLabel}>
                      {displayState.items.every(i => (Number(i.isServiceCharge) === 1 || i.isServiceCharge === true)) ? "Service Charge" : "Item Service Charge"} ({displayState.serviceChargePercentage || 0}%)
                    </Text>
                    <Text style={styles.breakdownValue}>
                      {companySettings.currencySymbol || "$"}
                      {displayState.serviceChargeAmount.toFixed(2)}
                    </Text>
                  </View>
                ) : null}

                {displayState.roundOff !== 0 ? (
                  <View style={styles.breakdownItem}>
                    <Text style={styles.breakdownLabel}>RoundOff</Text>
                    <Text style={styles.breakdownValue}>
                      {displayState.roundOff > 0 ? "+" : ""}
                      {companySettings.currencySymbol || "$"}
                      {(displayState.roundOff || 0).toFixed(2)}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* Net Total High-Contrast Box */}
              <View style={styles.netTotalHighlightBox}>
                <Text style={styles.netTotalLabel}>Net Total</Text>
                <Text style={styles.netTotalValue}>
                  {companySettings.currencySymbol || "$"}
                  {(displayState.netTotal || 0).toFixed(2)}
                </Text>
              </View>
            </View>

            {displayState.waiterName ? (
              <View style={styles.waiterFooter}>
                <Ionicons
                  name="person-circle-outline"
                  size={16}
                  color={Theme.textSecondary}
                />
                <Text style={styles.waiterText}>
                  Served by: {displayState.waiterName}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  // Idle attract loop view
  return (
    <View style={styles.idleContainer}>
      {renderTerminalModal()}
      {renderBackButton()}
      {/* Change Terminal pill */}
      {terminalCode ? (
        <TouchableOpacity
          style={styles.terminalPill}
          onPress={() => {
            setSelectedTerminalCode(terminalCode);
            setShowTerminalModal(true);
          }}
        >
          <Ionicons name="tv-outline" size={12} color={Theme.primary} />
          <Text style={styles.terminalPillText}>{terminalName || terminalCode}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.terminalPill, { borderColor: "#ef444440" }]}
          onPress={() => setShowTerminalModal(true)}
        >
          <Ionicons name="tv-outline" size={12} color="#ef4444" />
          <Text style={[styles.terminalPillText, { color: "#ef4444" }]}>Set Terminal</Text>
        </TouchableOpacity>
      )}
      {/* Floating popping food animations */}
      {floatingFoods.map((item) => (
        <Animated.View
          key={item.id}
          style={[
            styles.floatingFood,
            {
              left: `${item.x}%`,
              top: `${item.y}%`,
              transform: [
                { scale: item.scale },
                { translateY: item.translateY },
              ],
              opacity: item.opacity,
            },
          ]}
        >
          <Ionicons name={item.icon} size={48} color={Theme.primary + "30"} />
        </Animated.View>
      ))}

      <View style={styles.idleMainContent}>
        {/* Main Branding Card */}
        <View style={styles.brandingCard}>
          {companySettings.companyLogo ? (
            <Image
              source={{ uri: getLogoUri(companySettings.companyLogo) }}
              style={styles.logoImage}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.fallbackLogoContainer}>
              <Ionicons name="restaurant" size={60} color="#fff" />
            </View>
          )}

          <Text style={styles.welcomeTitle}>
            {companySettings.name || "Welcome to our Restaurant!"}
          </Text>
          <Text style={styles.welcomeSubtitle}>
            Order details will appear here during checkout.
          </Text>

          <View style={styles.halalContainer}>
            {companySettings.showHalalLogo && companySettings.halalLogo ? (
              <Image
                source={{ uri: getLogoUri(companySettings.halalLogo) }}
                style={styles.halalImage}
                resizeMode="contain"
              />
            ) : null}
          </View>
        </View>
      </View>

      {/* Unipro Footer on Idle Screen */}
      <View style={styles.idleUniproFooter}>
        <Image
          source={require("./assets/images/unipro_logo.png")}
          style={styles.uniproLogoImage}
          resizeMode="contain"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  idleContainer: {
    flex: 1,
    backgroundColor: Theme.bgMain,
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 32,
    position: "relative",
    overflow: "hidden",
  },
  idleMainContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
  floatingFood: {
    position: "absolute",
    zIndex: 1,
  },
  brandingCard: {
    backgroundColor: "#fff",
    padding: 40,
    borderRadius: 30,
    alignItems: "center",
    maxWidth: 550,
    width: "90%",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    zIndex: 2,
    borderWidth: 1.5,
    borderColor: Theme.border,
  },
  logoImage: {
    width: 150,
    height: 150,
    marginBottom: 20,
  },
  fallbackLogoContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: Theme.primary,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 20,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  welcomeTitle: {
    fontSize: 28,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    textAlign: "center",
    marginBottom: 10,
  },
  welcomeSubtitle: {
    fontSize: 15,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    textAlign: "center",
    lineHeight: 22,
  },
  halalContainer: {
    marginTop: 20,
    height: 50,
  },
  halalImage: {
    width: 80,
    height: 50,
  },

  // Checkout layout
  checkoutContainer: {
    flex: 1,
    backgroundColor: Theme.bgMain,
  },
  topHeaderBanner: {
    backgroundColor: "#FEF9E7",
    paddingVertical: 10,
    paddingLeft: 110,
    paddingRight: 24,
    borderBottomWidth: 1.5,
    borderBottomColor: "#F5CBA7",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  topHeaderText: {
    fontSize: 24,
    fontFamily: Fonts.black,
    color: "#4A2711",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  headerInfoContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerSectionText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: "#7E5109",
    textTransform: "uppercase",
    backgroundColor: "#FFF9E6",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#F5CBA7",
  },
  headerTableBadge: {
    backgroundColor: "#16A34A",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  headerTableText: {
    fontSize: 14,
    fontFamily: Fonts.black,
    color: "#fff",
    textTransform: "uppercase",
  },
  checkoutLayout: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  checkoutLayoutLandscape: {
    flexDirection: "row",
  },

  // Left column
  leftPane: {
    flex: 0.85,
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1.5,
    borderColor: Theme.border,
    justifyContent: "space-between",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  leftMainContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  logoCard: {
    alignItems: "center",
    justifyContent: "center",
  },
  logoCircle: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#E5E7EB",
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  logoCircleFallback: {
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: Theme.primary,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
  },
  largeRestaurantLogo: {
    width: 180,
    height: 180,
    borderRadius: 90,
  },
  logoShopName: {
    fontSize: 20,
    fontFamily: Fonts.black,
    color: "#374151",
    marginTop: 20,
    textAlign: "center",
  },

  // QR Code views
  qrCard: {
    alignItems: "center",
    justifyContent: "center",
  },
  qrTitle: {
    fontSize: 20,
    fontFamily: Fonts.black,
    color: "#1F2937",
    marginBottom: 16,
  },
  qrImageContainer: {
    padding: 16,
    backgroundColor: "#fff",
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  webQrImage: {
    width: 220,
    height: 220,
  },
  payNowQrImage: {
    width: 220,
    height: 220,
  },
  qrSubtitle: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: "#4B5563",
    marginTop: 16,
    textAlign: "center",
  },

  // Unipro Footers
  uniproFooterContainer: {
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    marginTop: 16,
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 3,
  },
  uniproLogoImage: {
    width: 280,
    height: 80,
  },
  idleUniproFooter: {
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },

  // Right column
  rightPane: {
    flex: 1.4,
    backgroundColor: "#fff",
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: Theme.border,
    overflow: "hidden",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  tableHeaderRow: {
    flexDirection: "row",
    backgroundColor: "#F3F4F6",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1.5,
    borderBottomColor: "#E5E7EB",
  },
  tableHeaderCell: {
    fontSize: 14,
    fontFamily: Fonts.extraBold,
    color: "#4B5563",
  },
  cellDesc: {
    flex: 1.6,
  },
  cellQty: {
    width: 70,
    textAlign: "center",
  },
  cellTotal: {
    width: 100,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  tableHeaderCellTotal: {
    width: 100,
    textAlign: "right",
  },
  receiptItemOriginalPrice: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: "#9CA3AF",
    textDecorationLine: "line-through",
    marginBottom: 2,
  },
  receiptItemDiscount: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.danger || "#EF4444",
    marginTop: 2,
  },

  receiptItemsScroll: {
    flex: 1,
  },
  receiptItemRow: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    alignItems: "center",
  },
  voidedRow: {
    backgroundColor: "#FEF2F2",
    opacity: 0.6,
  },
  receiptItemName: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: "#1F2937",
  },
  voidedText: {
    textDecorationLine: "line-through",
    color: Theme.textMuted,
  },
  receiptItemNote: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginTop: 2,
  },
  receiptItemModifier: {
    fontSize: 12,
    fontFamily: Fonts.regular,
    color: Theme.textSecondary,
    marginTop: 2,
    paddingLeft: 6,
  },
  receiptItemQty: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: "#374151",
  },
  receiptItemTotal: {
    fontSize: 15,
    fontFamily: Fonts.extraBold,
    color: "#1F2937",
  },

  receiptSummaryContainer: {
    borderTopWidth: 1.5,
    borderTopColor: "#E5E7EB",
    backgroundColor: "#FAFAFA",
    padding: 16,
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 12,
    flexWrap: "wrap",
    gap: 12,
  },
  breakdownItem: {
    alignItems: "center",
    flex: 1,
    minWidth: 70,
  },
  breakdownLabel: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: "#6B7280",
    marginBottom: 2,
  },
  breakdownValue: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: "#374151",
  },

  netTotalHighlightBox: {
    backgroundColor: "#16A34A",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 24,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    elevation: 2,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  netTotalLabel: {
    fontSize: 22,
    fontFamily: Fonts.black,
    color: "#fff",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  netTotalValue: {
    fontSize: 32,
    fontFamily: Fonts.black,
    color: "#fff",
  },

  waiterFooter: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: "#F9FAFB",
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    gap: 6,
  },
  waiterText: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
  },

  // Success Container
  successContainer: {
    flex: 1,
    backgroundColor: Theme.bgMain,
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 20,
    position: "relative",
  },
  successMainContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
  successCard: {
    backgroundColor: "#fff",
    borderRadius: 32,
    padding: 24,
    width: "90%",
    maxWidth: 450,
    alignItems: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    borderWidth: 1.5,
    borderColor: Theme.border,
  },
  successIconWrapper: {
    marginBottom: 20,
  },
  successTitle: {
    fontSize: 26,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    textAlign: "center",
  },
  successOrderText: {
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: Theme.success,
    marginTop: 5,
  },
  dashedDivider: {
    height: 1,
    borderWidth: 1,
    borderColor: Theme.border,
    borderStyle: "dashed",
    width: "100%",
    marginVertical: 20,
  },
  successDetails: {
    width: "100%",
    gap: 12,
    marginBottom: 20,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  detailLabel: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
  },
  detailValue: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  successFooter: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    marginTop: 10,
    textAlign: "center",
  },
  floatingBackBtn: {
    position: "absolute",
    top: 10,
    left: 20,
    zIndex: 9999,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  terminalPill: {
    position: "absolute",
    bottom: 16,
    left: 16,
    zIndex: 9999,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: Theme.primary + "30",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  terminalPillText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.primary,
  },
  // â”€â”€â”€ Terminal setup modal â”€â”€â”€
  terminalModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    alignItems: "center",
  },
  terminalModalCard: {
    backgroundColor: "#fff",
    borderRadius: 24,
    width: 380,
    maxWidth: "90%",
    maxHeight: "80%",
    padding: 28,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 20,
  },
  terminalModalHeader: {
    alignItems: "center",
    marginBottom: 24,
    gap: 8,
  },
  terminalModalTitle: {
    fontSize: 22,
    fontFamily: Fonts.extraBold,
    color: Theme.textPrimary,
    marginTop: 8,
  },
  terminalModalSubtitle: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    textAlign: "center",
    lineHeight: 20,
  },
  terminalList: {
    maxHeight: 280,
  },
  terminalItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Theme.border,
    marginBottom: 10,
    backgroundColor: "#fafafa",
  },
  terminalItemSelected: {
    borderColor: Theme.primary,
    backgroundColor: Theme.primary + "08",
  },
  terminalItemCode: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  terminalItemName: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginTop: 2,
  },
  terminalModalEmpty: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Theme.textMuted,
    textAlign: "center",
    marginTop: 12,
    lineHeight: 20,
  },
  terminalModalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: Theme.border,
  },
  terminalModalBtnCancel: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  terminalModalBtnCancelText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  terminalModalBtnConfirm: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Theme.primary,
  },
  terminalModalBtnConfirmText: {
    fontSize: 14,
    fontFamily: Fonts.black,
    color: "#fff",
  },
  paymodeSelectedCard: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 20,
    width: "95%",
    maxWidth: 440,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
  },
  paymodeIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  paymodeTitle: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.textMuted,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 6,
  },
  paymodeLabel: {
    fontSize: 24,
    fontFamily: Fonts.black,
    textAlign: "center",
    marginBottom: 16,
  },
  paymodeAmountBox: {
    width: "100%",
    backgroundColor: "#F9FAFB",
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#F3F4F6",
  },
  paymodeAmountLabel: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.textMuted,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  paymodeAmountValue: {
    fontSize: 32,
    fontFamily: Fonts.black,
    color: "#111827",
  },
  memberNameBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F3F4F6",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  memberNameText: {
    fontSize: 14,
    fontFamily: Fonts.black,
  },
  splitCard: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 24,
    width: "95%",
    maxWidth: 440,
    maxHeight: 460,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
  },
  splitHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    paddingBottom: 12,
  },
  splitTitle: {
    fontSize: 16,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  splitScroll: {
    flexGrow: 0,
    maxHeight: 250,
  },
  splitRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F9FAFB",
  },
  splitRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  splitIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  splitPaymodeText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  splitAmountText: {
    fontSize: 15,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    marginRight: 12,
  },
  splitStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    minWidth: 80,
    alignItems: "center",
  },
  splitStatusText: {
    fontSize: 11,
    fontFamily: Fonts.black,
  },
  splitFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: "#F3F4F6",
    paddingTop: 16,
  },
  splitFooterLabel: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.textMuted,
  },
  splitFooterValue: {
    fontSize: 22,
    fontFamily: Fonts.black,
    color: Theme.primary,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // QUICK SERVE SCREEN MIRROR STYLES
  // ═══════════════════════════════════════════════════════════════════════════
  qsMirrorContainer: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  qsMirrorTopNavbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  qsMirrorNavLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  qsMirrorLogoWrap: {
    flexDirection: "row",
    alignItems: "center",
  },
  qsMirrorLogoTitle: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: "#0F172A",
  },
  qsMirrorCustomerBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FFEDD5",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  qsMirrorCustomerBadgeText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#FF5A16",
  },
  qsMirrorNavRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  qsMirrorOrderTypePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FFEDD5",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  qsMirrorOrderTypePillText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#FF5A16",
  },
  qsMirrorTablePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FFEDD5",
    paddingRight: 12,
    paddingLeft: 4,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 6,
  },
  qsMirrorTableCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#FF5A16",
    alignItems: "center",
    justifyContent: "center",
  },
  qsMirrorTableCircleText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontFamily: Fonts.black,
  },
  qsMirrorTableNameText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  qsMirrorBody: {
    flex: 1,
    flexDirection: "row",
    padding: 14,
    gap: 14,
  },
  qsMirrorBodyMobile: {
    flexDirection: "column",
    padding: 8,
    gap: 8,
  },
  qsMirrorBodyTablet: {
    padding: 10,
    gap: 10,
  },
  // COLUMN 1: CART & TOTALS
  qsMirrorColCart: {
    width: 380,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 3,
  },
  qsMirrorColCartMobile: {
    width: "100%",
  },
  qsMirrorColCartTablet: {
    width: 310,
  },
  qsMirrorCartHeader: {
    backgroundColor: "#FF5A16",
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  qsMirrorCartHeaderTitle: {
    color: "#FFFFFF",
    fontSize: 15,
    fontFamily: Fonts.bold,
  },
  qsMirrorCartCountBadge: {
    backgroundColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  qsMirrorCartCountText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontFamily: Fonts.bold,
  },
  qsMirrorCartScroll: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  qsMirrorEmptyCart: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  qsMirrorEmptyCartTitle: {
    marginTop: 10,
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: "#64748B",
  },
  qsMirrorEmptyCartSub: {
    marginTop: 4,
    fontSize: 12,
    color: "#94A3B8",
    fontFamily: Fonts.regular,
  },
  qsMirrorCartItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  qsMirrorCartItemName: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: "#1E293B",
  },
  qsMirrorCartItemSub: {
    fontSize: 11,
    color: "#64748B",
    fontFamily: Fonts.regular,
  },
  qsMirrorCartQtyPill: {
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    marginRight: 10,
  },
  qsMirrorCartQtyText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#334155",
  },
  qsMirrorCartItemPrice: {
    fontSize: 14,
    fontFamily: Fonts.black,
    color: "#0F172A",
    minWidth: 65,
    textAlign: "right",
  },
  qsMirrorCartFooter: {
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
    padding: 14,
    backgroundColor: "#FAFBFD",
  },
  qsMirrorSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  qsMirrorSummaryLabel: {
    fontSize: 13,
    color: "#64748B",
    fontFamily: Fonts.medium,
  },
  qsMirrorSummaryVal: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#1E293B",
  },
  qsMirrorFinalTotalCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FFEDD5",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 8,
    marginBottom: 10,
  },
  qsMirrorFinalTotalLabel: {
    fontSize: 15,
    fontFamily: Fonts.black,
    color: "#9A3412",
  },
  qsMirrorFinalTotalVal: {
    fontSize: 22,
    fontFamily: Fonts.black,
    color: "#EA580C",
  },
  qsMirrorPaymodeSection: {
    marginTop: 4,
  },
  qsMirrorPaymodeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  qsMirrorPaymodeTitle: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#64748B",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  qsMirrorActiveModeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF7ED",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  qsMirrorActiveModeText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: "#EA580C",
  },
  qsMirrorPaymodesRow: {
    flexDirection: "row",
    gap: 6,
  },
  qsMirrorPaymodePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  qsMirrorPaymodePillActive: {
    backgroundColor: "#FF5A16",
    borderColor: "#FF5A16",
  },
  qsMirrorPaymodePillText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#475569",
  },
  qsMirrorPaymodePillTextActive: {
    color: "#FFFFFF",
  },
  qsMirrorQrCard: {
    marginTop: 10,
    padding: 10,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
  },
  qsMirrorQrTitle: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#0F172A",
    marginBottom: 6,
  },
  qsMirrorQrBox: {
    padding: 6,
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  qsMirrorQrSubtitle: {
    marginTop: 4,
    fontSize: 13,
    fontFamily: Fonts.black,
    color: "#FF5A16",
  },

  // COLUMN 2: GROUPS
  qsMirrorColGroups: {
    width: 220,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 3,
  },
  qsMirrorPanelHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FAFAFA",
  },
  qsMirrorPanelHeaderTitle: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: "#0F172A",
  },
  qsMirrorGroupsScroll: {
    flex: 1,
    padding: 10,
  },
  qsMirrorEmptyGroups: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  qsMirrorEmptyGroupsText: {
    marginTop: 8,
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: "#94A3B8",
  },
  qsMirrorGroupCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 8,
  },
  qsMirrorGroupCardActive: {
    backgroundColor: "#FFF7ED",
    borderColor: "#FF5A16",
  },
  qsMirrorGroupName: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#334155",
    flex: 1,
  },
  qsMirrorGroupNameActive: {
    color: "#EA580C",
  },
  qsMirrorGroupBadge: {
    backgroundColor: "#E2E8F0",
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 6,
  },
  qsMirrorGroupBadgeActive: {
    backgroundColor: "#FF5A16",
  },
  qsMirrorGroupBadgeText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: "#475569",
  },
  qsMirrorGroupBadgeTextActive: {
    color: "#FFFFFF",
  },

  // COLUMN 3: DISHES
  qsMirrorColDishes: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 3,
  },
  qsMirrorDishesScroll: {
    flex: 1,
    padding: 12,
  },
  qsMirrorDishesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  qsMirrorEmptyDishes: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  qsMirrorEmptyDishesText: {
    marginTop: 10,
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: "#94A3B8",
  },
  qsMirrorDishCard: {
    width: 170,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 2,
  },
  qsMirrorDishImgWrap: {
    width: "100%",
    height: 100,
    backgroundColor: "#F1F5F9",
    position: "relative",
  },
  qsMirrorDishImg: {
    width: "100%",
    height: "100%",
  },
  qsMirrorDishImgPlaceholder: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8FAFC",
  },
  qsMirrorInCartBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    backgroundColor: "#FF5A16",
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  qsMirrorInCartBadgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontFamily: Fonts.black,
  },
  qsMirrorSoldOutBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "#EF4444",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  qsMirrorSoldOutText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontFamily: Fonts.bold,
  },
  qsMirrorDishBody: {
    padding: 10,
  },
  qsMirrorDishName: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#1E293B",
    marginBottom: 4,
  },
  qsMirrorDishPrice: {
    fontSize: 14,
    fontFamily: Fonts.black,
    color: "#FF5A16",
  },
});

