import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  StatusBar,
  Platform,
  Alert,
  Modal,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Theme } from "../constants/theme";
import { Fonts } from "../constants/Fonts";
import BillPrompt from "../components/BillPrompt";
import UniversalPrinter from "../components/UniversalPrinter";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCompanySettingsStore } from "../stores/companySettingsStore";
import { useGeneralSettingsStore } from "../stores/generalSettingsStore";
import { CustomerDisplaySync } from "../utils/CustomerDisplaySync";
import CashDrawerService from "../services/CashDrawerService";

const formatSection = (sec: string) => {
  if (!sec) return "";
  if (sec === "TAKEAWAY") return "Takeaway";
  return sec.replace("_", "-").replace("SECTION", "Section");
};

export default function PaymentSuccess() {
  const router = useRouter();
  const isDrawerOpening = React.useRef(false);
  const params = useLocalSearchParams();
  const settings = useCompanySettingsStore((state: any) => state.settings);
  const currencySymbol = settings.currencySymbol || "$";

  const total = String(params.total ?? "0");
  const paid = String(params.paidNum ?? "0");
  const change = String(params.change ?? "0");

  const orderId = String(params.orderId ?? "");
  const tableNo = String(params.tableNo ?? "");
  const section = String(params.section ?? "");
  const orderType = String(params.orderType ?? "");
  const method = String(params.method ?? "");
  const discountInfoRaw = String(params.discountInfo ?? "{}");
  const itemsRaw = String(params.items ?? "[]");
  const roundOff = String(params.roundOff ?? "0");
  const waiterName = String(params.waiterName ?? "");
  const paymentsRaw = String(params.payments ?? "[]");
  const serviceCharge = String(params.serviceCharge ?? "0");
  const takeawayCharge = String(params.takeawayCharge ?? "0");
  const payments = React.useMemo(() => {
    try {
      return JSON.parse(paymentsRaw);
    } catch (e) {
      return [];
    }
  }, [paymentsRaw]);

  const [promptVisible, setPromptVisible] = React.useState(false);
  const [showSplitConfirmModal, setShowSplitConfirmModal] = React.useState(false);
  const [floatingFoods, setFloatingFoods] = React.useState<any[]>([]);
  const spinValue = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    // Spin animation for background dish
    Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 35000,
        useNativeDriver: true,
      })
    ).start();

    // Floating food icons
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
      const x = Math.random() * 80 + 10;
      const y = Math.random() * 70 + 15;

      const scale = new Animated.Value(0);
      const translateY = new Animated.Value(0);
      const opacity = new Animated.Value(1);

      const newItem = { id, icon, x, y, scale, translateY, opacity };
      setFloatingFoods((prev) => [...prev, newItem].slice(-15));

      Animated.parallel([
        Animated.spring(scale, {
          toValue: 1.2,
          tension: 30,
          friction: 4,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: -85 - Math.random() * 60,
          duration: 3800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          delay: 2400,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setFloatingFoods((prev) => prev.filter((item) => item.id !== id));
      });
    }, 850);

    return () => clearInterval(interval);
  }, []);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  React.useEffect(() => {
    CustomerDisplaySync.syncPaymentSuccess({
      orderId,
      total: parseFloat(total) || 0,
      paid: parseFloat(paid) || 0,
      change: parseFloat(change) || 0,
      method,
    });
  }, [orderId, total, paid, change, method]);

  React.useEffect(() => {
    CustomerDisplaySync.isPaymentActive = false;
    // Clear cart and context on success screen mount (skip if split payment with remaining balance)
    if (params.isSplit === "true") {
      console.log("[payment_success] Split payment: skipping cart/context cleanup.");
      return;
    }
    const cleanup = async () => {
      try {
        const { clearCart } = await import("../stores/cartStore");
        const { getOrderContext, clearOrderContext } = await import("../stores/orderContextStore");
        const { useTableNavigationStore } = await import("../stores/tableNavigationStore");
        const { useTerminalPaymentStore } = await import("../stores/terminalPaymentStore");
        const context = getOrderContext();
        const targetTableId = (params.tableId as string) || (context?.tableId ? String(context.tableId) : undefined);
        if (targetTableId) {
          useTableNavigationStore.getState().clearTableLastScreen(targetTableId);
          useTableNavigationStore.getState().clearSelectedMethod(targetTableId);
          useTerminalPaymentStore.getState().clearSession(targetTableId);
        }
        clearCart();
        clearOrderContext();
      } catch (err) {
        console.error("Cleanup error in PaymentSuccess:", err);
      }
    };
    cleanup();
  }, [params.isSplit, params.tableId]);

  const handleDone = () => {
    CustomerDisplaySync.isSuccessActive = false;
    CustomerDisplaySync.syncIdle();
    if (params.isLedgerCollection === "true") {
      if (params.isMember === "true") {
        router.replace("/members");
      } else {
        router.replace("/receivables");
      }
    } else if (params.isSplit === "true") {
      setShowSplitConfirmModal(true);
    } else {
      // Use section param if set; fall back to orderType to decide TAKEAWAY vs Dining section
      const isTakeaway = orderType === "TAKEAWAY" || section === "TAKEAWAY";
      const effectiveSection = (section && section.trim() !== "")
        ? section
        : (isTakeaway ? "TAKEAWAY" : "SECTION_1");
      const targetMode = isTakeaway ? "TAKEAWAY" : "DINE_IN";
      const { useOrderContextStore } = require("../stores/orderContextStore");
      useOrderContextStore.getState().setServiceMode(targetMode);
      useOrderContextStore.getState().setActiveSection(effectiveSection);
      router.replace({
        pathname: "/(tabs)/category",
        params: { section: effectiveSection },
      });
    }
  };

  const openDrawerForCash = async () => {
    // 1. In-memory double-tap lock
    if (isDrawerOpening.current) {
      console.log("[payment_success] Cash drawer trigger already in progress. Bypassing duplicate call.");
      return;
    }
    isDrawerOpening.current = true;

    try {
      const isCash = /^(CAS|CASH)$/i.test(method.trim()) || 
                     (payments && payments.some((p: any) => /^(CAS|CASH)$/i.test((p.payMode || p.payModeName || '').trim())));
      if (!isCash) {
        isDrawerOpening.current = false;
        return;
      }

      // 2. AsyncStorage duplicate check (persistent across screen remounts)
      if (orderId) {
        const key = `drawer_opened_${orderId}`;
        const hasOpened = await AsyncStorage.getItem(key);
        if (hasOpened === 'true') {
          console.log(`[payment_success] Cash drawer already opened for order ${orderId}. Bypassing duplicate trigger.`);
          isDrawerOpening.current = false;
          return;
        }
        await AsyncStorage.setItem(key, 'true');
      }

      const userIdVal = await AsyncStorage.getItem("userId") || "1";
      const terminalCodeVal = await AsyncStorage.getItem("terminalCode") || "T1";
      
      await CashDrawerService.openAndLog({
        outletId: 1,
        terminalCode: terminalCodeVal,
        actionType: 'SALE',
        amount: parseFloat(total) || 0,
        tenderedAmount: parseFloat(paid) || 0,
        changeAmount: parseFloat(change) || 0,
        orderId: orderId || null,
        reason: 'Cash Sale Checkout',
        openedByUserId: userIdVal,
        openSource: 'SALE',
      });
    } catch (err) {
      console.warn("Auto open cash drawer failed:", err);
    } finally {
      isDrawerOpening.current = false;
    }
  };

  const handlePrint = async () => {
    setPromptVisible(false);
    try {
      const isLedger = params.isLedgerCollection === "true";
      const discountInfo = isLedger ? {} : JSON.parse(discountInfoRaw || "{}");
      const items = isLedger ? [{ name: "Member Outstanding Payment", qty: 1, price: parseFloat(total) || 0 }] : JSON.parse(itemsRaw || "[]");
      const userId = await AsyncStorage.getItem("userId") || "1";

      const isFocPayment = method?.trim().toUpperCase() === 'FOC' ||
        (payments && payments.some((p: any) => String(p.payMode || p.payModeName || '').trim().toUpperCase() === 'FOC'));
      const parsedTotal = parseFloat(total) || 0;
      // ✅ FOC Fix: For full-FOC orders, total param is 0 (effectiveTotalAmount = total - focAmount).
      // We still need to print a receipt. Use discountInfo.subtotal as the display total.
      const isSplitPayment = params.isSplit === "true";
      const displayTotal = parsedTotal > 0 ? parsedTotal
        : (discountInfo?.subtotal || discountInfo?.amount || parsedTotal);

      // ✅ Split Fix: For split receipts, add a unique suffix to prevent duplicate cache blocking
      const invoiceNum = isSplitPayment
        ? `${orderId}-S${Date.now().toString(36).toUpperCase()}`
        : orderId;

      // Compute subTotal from items so Sunmi printer can show Sub Total → Discount → Grand Total
      const computedSubTotal = isLedger ? (parseFloat(total) || 0) : (discountInfo?.subtotal 
        ?? items.filter((i: any) => i.status !== 'VOIDED')
               .reduce((s: number, i: any) => s + (i.price || 0) * (i.qty || i.quantity || 1), 0));
      
      const saleData = {
        invoiceNumber: invoiceNum,
        tableNo: isLedger ? "LEDGER" : tableNo,
        total: displayTotal,
        paymentMethod: isFocPayment ? "FOC" : method,
        cashPaid: parseFloat(paid) || 0,
        change: parseFloat(change) || 0,
        items: items,
        payments: payments,
        roundOff: parseFloat(roundOff) || 0,
        waiterName: waiterName || (isLedger ? "Cashier" : ""),
        date: new Date(),
        // ✅ Discount fields for Sunmi receipt (discountInfo handles LAN/PDF)
        discountAmount: discountInfo?.amount ?? 0,
        discountType: discountInfo?.type ?? null,
        discountValue: discountInfo?.value ?? 0,
        subTotal: computedSubTotal,
        serviceCharge: parseFloat(serviceCharge) || 0,
        takeawayCharge: parseFloat(takeawayCharge) || 0,
        mobileNo: params.mobileNo || "",
        rewardPointsEarned: params.rewardPointsEarned || "0",
        memberRewardBalance: params.memberRewardBalance || "0",
      };

      await UniversalPrinter.smartPrint(saleData, userId, {}, discountInfo);
      await openDrawerForCash();
    } catch (error) {
      console.error("Print error:", error);
    }
  };

  React.useEffect(() => {
    const generalSettings = useGeneralSettingsStore.getState().settings;
    const runAutoPrintFlow = async () => {
      const enableReceiptPrint = generalSettings.enableReceiptPrint !== undefined ? generalSettings.enableReceiptPrint : true;
      
      if (enableReceiptPrint) {
        await handlePrint();
      } else {
        await openDrawerForCash();
      }
    };
    runAutoPrintFlow();

    // Play custom voice audio asset
    const playSuccessAudio = async () => {
      try {
        if (Platform.OS === "web") {
          const audioAsset = require("../assets/Voice/Thank you, have a nice day.mp3");
          const uri = typeof audioAsset === "object" && audioAsset.default ? audioAsset.default : audioAsset;
          const audio = new window.Audio(uri);
          audio.volume = 1.0;
          await audio.play();
        } else {
          const { Audio } = require("expo-av");
          try {
            await Audio.setAudioModeAsync({
              playsInSilentModeIOS: true,
              staysActiveInBackground: true,
              shouldDuckAndroid: false,
              allowsRecordingIOS: false,
            });
          } catch (_) {}
          
          const thankYouSound = require("../assets/Voice/Thank you, have a nice day.mp3");
          const { sound } = await Audio.Sound.createAsync(
            thankYouSound,
            { shouldPlay: true, volume: 1.0 }
          );
          if (sound) {
            sound.setOnPlaybackStatusUpdate((status: any) => {
              if (status.didJustFinish) {
                sound.unloadAsync().catch(() => {});
              }
            });
          }
        }
      } catch (err) {
        console.warn("Failed to play custom success voice audio:", err);
      }
    };
    if (generalSettings.enableVoiceSuccess !== false) {
      playSuccessAudio();
    }

    // Auto-redirect to main screen after 1.2 seconds
    const timer = setTimeout(() => {
      handleDone();
    }, 1200);

    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Theme.bgMain} />
      
      <View style={styles.container}>
        {/* Infinite Spinning Background Dishes/Plates */}
        <Animated.View style={[styles.bgDishContainer, { transform: [{ rotate: spin }] }]}>
          <Ionicons name="restaurant" size={320} color="rgba(255, 107, 0, 0.04)" />
        </Animated.View>
        <Animated.View style={[styles.bgDishContainer2, { transform: [{ rotate: spin }] }]}>
          <Ionicons name="pizza" size={240} color="rgba(22, 163, 74, 0.03)" />
        </Animated.View>

        {/* Floating food particles */}
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
            <Ionicons name={item.icon} size={42} color={Theme.primary + "20"} />
          </Animated.View>
        ))}

        <View style={styles.card}>
          <View style={styles.iconContainer}>
            <Ionicons name="checkmark-circle" size={80} color={Theme.success} />
          </View>

          <Text style={styles.title}>
            {params.isLedgerCollection === "true" 
              ? (params.isMember === "true" ? "Member Payment Collected" : "Credit Payment Collected") 
              : "Payment Successful"}
          </Text>
          <Text style={styles.orderText}>{params.isLedgerCollection === "true" ? `Settlement ID: ${orderId}` : `Order #${orderId}`}</Text>

          <Text style={styles.sub}>
            {params.isLedgerCollection === "true"
              ? (params.isMember === "true" ? "Member Account Settlement" : "Credit Customer Account Settlement")
              : (orderType === "DINE_IN"
                ? `Table ${tableNo} • ${formatSection(section)}`
                : `Takeaway • ${formatSection(section)}`)}
          </Text>

          <View style={styles.divider} />

          <View style={styles.detailsContainer}>
            {payments && payments.length > 0 ? (
              payments.map((p: any, idx: number) => (
                <View key={idx} style={styles.row}>
                  <Text style={styles.label}>{p.payMode ? p.payMode.toUpperCase() : "PAYMENT"}</Text>
                  <Text style={styles.value}>{currencySymbol}{parseFloat(p.amount).toFixed(2)}</Text>
                </View>
              ))
            ) : (
              <View style={styles.row}>
                <Text style={styles.label}>Payment Method</Text>
                <Text style={styles.value}>{method}</Text>
              </View>
            )}

            <View style={styles.row}>
              <View>
                <Text style={styles.label}>Total Amount</Text>
                {params.mobileNo ? (
                  <Text style={{ fontSize: 11, fontFamily: Fonts.bold, color: Theme.textMuted, marginTop: 2 }}>
                    Member Phone: {params.mobileNo}
                  </Text>
                ) : null}
              </View>
              <Text style={styles.value}>{currencySymbol}{total}</Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>Amount Paid</Text>
              <Text style={styles.value}>{currencySymbol}{paid}</Text>
            </View>

            {parseFloat(String(params.rewardPointsEarned || "0")) > 0 ? (
              <View style={[styles.row, { paddingVertical: 4, paddingHorizontal: 8, backgroundColor: "#FFF7ED", borderRadius: 8 }]}>
                <Text style={[styles.label, { color: "#F97316", fontFamily: Fonts.bold }]}>Points Earned</Text>
                <Text style={[styles.value, { color: "#F97316" }]}>+${parseFloat(String(params.rewardPointsEarned)).toFixed(2)}</Text>
              </View>
            ) : null}

            {parseFloat(String(params.memberRewardBalance || "0")) > 0 ? (
              <View style={styles.row}>
                <Text style={styles.label}>Available Member Credit</Text>
                <Text style={[styles.value, { color: Theme.success }]}>${parseFloat(String(params.memberRewardBalance)).toFixed(2)}</Text>
              </View>
            ) : null}

            <View style={[styles.row, styles.changeRow]}>
              <Text style={styles.label}>Change Due</Text>
              <Text style={[styles.value, { color: Theme.primary }]}>{currencySymbol}{change}</Text>
            </View>
          </View>
        </View>
      </View>

      <BillPrompt
        visible={promptVisible}
        onClose={async () => {
          setPromptVisible(false);
          await openDrawerForCash();
        }}
        onSkip={async () => {
          setPromptVisible(false);
          await openDrawerForCash();
        }}
        onPrintBill={handlePrint}
        theme={Theme}
        t={{
          printBillReceipt: "Print Receipt?",
          totalAmount: "Total",
          printBillMessage: "Would you like to print a receipt for this order?",
          skipBill: "Skip",
          printBill: "Print",
        }}
        total={total}
      />
      <Modal
        visible={showSplitConfirmModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowSplitConfirmModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Balance Remaining</Text>
            <Text style={styles.modalMessage}>
              Split payment successful! Would you like to pay the remaining balance now?
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalButton, styles.cancelButton]}
                onPress={() => {
                  setShowSplitConfirmModal(false);
                  router.replace("/summary");
                }}
              >
                <Text style={styles.cancelButtonText}>Go to Summary</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalButton, styles.confirmButton]}
                onPress={() => {
                  setShowSplitConfirmModal(false);
                  router.replace({
                    pathname: "/summary",
                    params: { autoPay: "true" },
                  });
                }}
              >
                <Text style={styles.confirmButtonText}>Pay Remaining</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Theme.bgMain,
  },
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    position: "relative",
    overflow: "hidden",
  },
  floatingFood: {
    position: "absolute",
    zIndex: 1,
  },
  bgDishContainer: {
    position: "absolute",
    zIndex: 0,
    top: "-5%",
    left: "-15%",
    opacity: 0.8,
  },
  bgDishContainer2: {
    position: "absolute",
    zIndex: 0,
    bottom: "-5%",
    right: "-10%",
    opacity: 0.8,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: Theme.bgCard,
    borderRadius: 30,
    padding: 30,
    alignItems: "center",
    ...Theme.shadowLg,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  iconContainer: {
    marginBottom: 15,
  },
  title: {
    color: Theme.textPrimary,
    fontSize: 26,
    fontFamily: Fonts.black,
    textAlign: "center",
  },
  orderText: {
    color: Theme.success,
    fontSize: 18,
    fontFamily: Fonts.bold,
    marginTop: 5,
  },
  sub: {
    color: Theme.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 14,
    marginTop: 5,
    marginBottom: 10,
  },
  divider: {
    height: 1,
    backgroundColor: Theme.border,
    width: "100%",
    marginVertical: 20,
    borderStyle: "dashed",
    borderWidth: 1,
    borderRadius: 1,
  },
  detailsContainer: {
    width: "100%",
    gap: 12,
    marginBottom: 20,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  changeRow: {
    marginTop: 5,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Theme.border,
  },
  label: {
    color: Theme.textSecondary,
    fontFamily: Fonts.black,
    fontSize: 15,
  },
  value: {
    color: Theme.textPrimary,
    fontFamily: Fonts.black,
    fontSize: 16,
  },
  doneBtn: {
    marginTop: 10,
    backgroundColor: Theme.primary,
    paddingVertical: 16,
    paddingHorizontal: 60,
    borderRadius: 16,
    ...Theme.shadowMd,
    width: "100%",
    alignItems: "center",
  },
  doneText: {
    color: "#fff",
    fontFamily: Fonts.black,
    fontSize: 18,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: Theme.bgCard,
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    ...Theme.shadowLg,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    marginBottom: 12,
  },
  modalMessage: {
    fontSize: 16,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  modalButtons: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  modalButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: Theme.border,
  },
  confirmButton: {
    backgroundColor: Theme.primary,
  },
  cancelButtonText: {
    color: Theme.textSecondary,
    fontFamily: Fonts.bold,
    fontSize: 15,
  },
  confirmButtonText: {
    color: "#fff",
    fontFamily: Fonts.bold,
    fontSize: 15,
  },
});
