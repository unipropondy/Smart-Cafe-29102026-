import { API_URL } from "@/constants/Config";
import { FontAwesome5, Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
  Animated,
  Easing,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useToast } from "../components/Toast";
import { Fonts } from "../constants/Fonts";
import { Theme } from "../constants/theme";
import WindowControls from "../components/WindowControls";

import PayNowPaymentModal from "../components/payment/PayNowPaymentModal";
import SplitPaymentComponent from "../components/payment/SplitPaymentComponent";
import UPIPaymentModal from "../components/payment/UPIPaymentModal";
import {
  findActiveOrder,
  useActiveOrdersStore,
} from "../stores/activeOrdersStore";
import { useAuthStore } from "../stores/authStore";
import { useCartStore } from "../stores/cartStore";
import type { CompanySettings } from "../stores/companySettingsStore";
import { useCompanySettingsStore } from "../stores/companySettingsStore";
import { useGeneralSettingsStore } from "../stores/generalSettingsStore";
import { useOrderContextStore } from "../stores/orderContextStore";
import type { CachedPaymentMethod } from "../stores/paymentSettingsStore";
import { usePaymentSettingsStore } from "../stores/paymentSettingsStore";
import { useQuickCashStore } from "../stores/quickCashStore";
import { useServiceChargeOverrideStore } from "../stores/serviceChargeOverrideStore";
import { useTableStatusStore } from "../stores/tableStatusStore";
import { useTerminalPaymentStore } from "../stores/terminalPaymentStore";
import { useTableNavigationStore } from "../stores/tableNavigationStore";
import { CustomerDisplaySync } from "../utils/CustomerDisplaySync";
import CashDrawerService from "../services/CashDrawerService";

// --- ROTATING SYNC ICON COMPONENT ---
const RotatingSyncIcon = ({ size = 16, color = "#3b82f6" }: { size?: number; color?: string }) => {
  const spinValue = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <Ionicons name="sync" size={size} color={color} />
    </Animated.View>
  );
};

const EMPTY_ARRAY: any[] = [];

const formatQty = (qty: number): string => {
  const q = Number(qty) || 0;
  if (q % 1 === 0) return q.toString();
  return Number((Math.round(q * 1000) / 1000).toFixed(3)).toString();
};

const formatSection = (sec: string) => {
  if (!sec) return "";
  if (sec === "TAKEAWAY") return "Takeaway";
  return sec.replace("_", "-").replace("SECTION", "Section");
};

type PaymentMethod = {
  payMode: string;
  description: string;
  icon: string;
  commission: number;
  serviceCharge: number;
  isEntertainment: boolean;
  isVoucher: boolean;
  position: number;
  active?: any;
  yeahPayEnabled?: boolean;
  deviceSn?: string | null;
  deviceSalt?: string | null;
};

const PAYMODE_ICON_MAP: Record<string, string> = {
  CAS: "money-bill-wave",
  CASH: "money-bill-wave",
  NETS: "exchange-alt",
  AMEX: "cc-amex",
  MASTER: "cc-mastercard",
  VISA: "cc-visa",
  PAYNOW: "qrcode",
  GRAB: "mobile-alt",
  FOODPANDA: "mobile-alt",
  DINERS: "credit-card",
  CHQ: "university",
  LEDGER: "book",
  VOUCHER: "ticket-alt",
  DEAL: "ticket-alt",
  UPI: "mobile-alt",
  GPAY: "google-pay",
  MEMBER: "user-tag",
  CREDIT: "user-tag",
};

function getPaymodeIcon(payMode: string): string {
  const key = payMode.toUpperCase().replace(/[^A-Z]/g, "");
  if (PAYMODE_ICON_MAP[key]) return PAYMODE_ICON_MAP[key];
  for (const [k, v] of Object.entries(PAYMODE_ICON_MAP)) {
    if (key.startsWith(k) || k.startsWith(key)) return v;
  }
  return "credit-card";
}

const isCashMethod = (payMode: string) => /^(CAS|CASH)$/i.test(payMode.trim());

const formatMoney = (symbol: string, amount: number) => {
  try {
    return `${symbol}${(amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } catch (e) {
    return `${symbol}${(amount || 0).toFixed(2)}`;
  }
};

// Define global ongoing payments map outside of the component to survive unmounting
const ongoingPayments: Record<string, {
  status: "idle" | "processing" | "success" | "cancelled" | "failed";
  message: string;
  method: string;
  total: number;
  promise: Promise<any>;
  onUpdate?: (status: "idle" | "processing" | "success" | "cancelled" | "failed", message: string, result: any, error: any) => void;
}> = {};

export default function PaymentScreen() {
  const pathname = usePathname();
  const params = useLocalSearchParams();
  const memberId = params.memberId as string | undefined;
  const loyaltyPhone = params.mobileNo as string | undefined;
  const loyaltyName = params.customerName as string | undefined;
  const rewardMemberId = params.rewardMemberId as string | undefined;
  const collectAmountRaw = params.collectAmount
    ? parseFloat(params.collectAmount as string)
    : undefined;
  const collectAmount =
    collectAmountRaw !== undefined ? Math.max(0, collectAmountRaw) : undefined;
  const memberName = params.memberName as string | undefined;
  const memberPhone = params.memberPhone as string | undefined;
  const isMember = params.isMember === "true";
  const isLedgerCollection = !!memberId;
  const [paymentStatus, setPaymentStatus] = useState<"idle" | "processing" | "success" | "cancelled" | "failed">("idle");
  const [paymentMessage, setPaymentMessage] = useState("");
  const allocationsParam = useMemo(() => {
    if (!params.allocations) return null;
    try {
      return JSON.parse(params.allocations as string);
    } catch (e) {
      console.error("Failed to parse allocations parameter:", e);
      return null;
    }
  }, [params.allocations]);

  const remarksParam =
    (params.remarks as string) || "Credit payment collection via POS checkout";

  const isFocused = pathname === "/payment" && pathname.includes("/payment");
  const pathnameRef = React.useRef(pathname);
  pathnameRef.current = pathname;
  const closeActiveOrder = useActiveOrdersStore((s) => s.closeActiveOrder);
  const clearTable = useTableStatusStore((s) => s.clearTable);
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const router = useRouter();
  const { showToast } = useToast();
  const { width, height } = useWindowDimensions();

  const [selectedMember, setSelectedMember] = useState<any | null>(null);

  useEffect(() => {
    if (memberId) {
      setSelectedMember({
        MemberId: memberId,
        Name: memberName || (isMember ? "Member" : "Credit Customer"),
        Phone: memberPhone || "",
        CurrentBalance: collectAmount || 0,
        CreditLimit: 999999,
      });
      const fetchMemberDetails = async () => {
        try {
          const endpoint = isMember
            ? `${API_URL}/api/members/search?query=${encodeURIComponent(memberPhone || memberId)}`
            : `${API_URL}/api/credit-customers/search?query=${encodeURIComponent(memberPhone || memberId)}`;
          const res = await fetch(endpoint, {
            headers: useAuthStore.getState().token ? { Authorization: `Bearer ${useAuthStore.getState().token}` } : {},
          });
          const data = await res.json();
          if (Array.isArray(data) && data.length > 0) {
            const match = data.find((m: any) => m.MemberId === memberId);
            if (match) {
              setSelectedMember(match);
            }
          }
        } catch (err) {
          console.error("Failed to load details for collection customer:", err);
        }
      };
      fetchMemberDetails();
    }
  }, [memberId, isMember]);

  const isLandscape = width > height;
  const isTablet = Math.min(width, height) >= 500;
  const isMobile = !isTablet;
  const showOrderPanel =
    (isTablet && (isLandscape || width >= 1024)) || (isMobile && isLandscape);

  const context = useOrderContextStore((s) => s.currentOrder);
  const hasHydrated = useActiveOrdersStore((s) => s._hasHydrated);
  const activeOrder = context ? findActiveOrder(context) : undefined;

  const currentContextId = useCartStore((s: any) => s.currentContextId);
  const cart = useCartStore(
    (s: any) =>
      (currentContextId ? s.carts[currentContextId] : undefined) || EMPTY_ARRAY,
  );

  const currentTableOrderId = useCartStore((s: any) =>
    context?.tableId ? s.tableOrderIds[context.tableId] : undefined,
  );
  const displayOrderId = currentTableOrderId || activeOrder?.orderId;

  const discount = useCartStore((s: any) =>
    s.currentContextId ? s.discounts[s.currentContextId] : null,
  );

  const [method, setMethod] = useState("CAS");
  const [cashInput, setCashInput] = useState("");
  const [collectionAmount, setCollectionAmount] = useState("");
  const [processing, setProcessing] = useState(false);
  const [checkoutSessionId, setCheckoutSessionId] = useState("");
  const cacheKey = (context?.tableId || displayOrderId || "").toString();

  // --- YEAPAY TERMINAL ZUSTAND STORE SUBSCRIPTION & RECOVERY ---
  const terminalSession = useTerminalPaymentStore(
    (s) => context?.tableId ? s.sessions[String(context.tableId)] : undefined
  );
  const finalizationLockRef = React.useRef<Record<string, boolean>>({});
  const executeFinalPaymentRef = React.useRef<any>(null);

  // Reset local payment status banner when context changes or screen gains focus (unless actively processing)
  useEffect(() => {
    if (isFocused) {
      const activeTblId = context?.tableId ? String(context.tableId) : undefined;
      const activeSession = activeTblId ? useTerminalPaymentStore.getState().sessions[activeTblId] : undefined;
      if (!activeSession || activeSession.status !== "processing") {
        setPaymentStatus("idle");
        setPaymentMessage("");
        setProcessing(false);
      }
    }
  }, [isFocused, context?.tableId]);

  useEffect(() => {
    // Reconstruct ongoingPayments cache if we refreshed/reloaded so the request flows correctly
    if (terminalSession && terminalSession.status === "processing" && cacheKey && !ongoingPayments[cacheKey]) {
      ongoingPayments[cacheKey] = {
        status: "processing",
        message: terminalSession.message,
        method: terminalSession.method,
        total: terminalSession.total,
        promise: Promise.resolve(null),
      };
    }

    if (terminalSession) {
      if (terminalSession.isSplit) {
        return;
      }

      setPaymentStatus(terminalSession.status);
      setPaymentMessage(terminalSession.message);
      setProcessing(terminalSession.status === "processing");
      if (terminalSession.method) {
        setMethod(terminalSession.method);
      }

      if (terminalSession.status === "success") {
        const lockKey = (context?.tableId || displayOrderId || "MAIN_PAYMENT_LOCK").toString();
        if (!finalizationLockRef.current[lockKey]) {
          handleTerminalPaymentSuccess(
            terminalSession.method || method,
            terminalSession.total || total,
            terminalSession.message
          );
        }
      } else if (terminalSession.status === "cancelled") {
        Alert.alert(
          '❌ Transaction Cancelled',
          'Payment was cancelled on the terminal. Please try again.',
          [{ text: 'OK' }]
        );
        delete ongoingPayments[cacheKey];
        if (context?.tableId) {
          const tblIdStr = String(context.tableId);
          useTerminalPaymentStore.getState().clearSession(tblIdStr);
        }
        setProcessing(false);
        setPaymentStatus("cancelled");
        setPaymentMessage(terminalSession.message || '❌ Transaction cancelled on terminal');
      } else if (terminalSession.status === "failed") {
        Alert.alert(
          '❌ Payment Failed',
          terminalSession.message || 'Failed to connect to terminal',
          [{ text: 'OK' }]
        );
        delete ongoingPayments[cacheKey];
        if (context?.tableId) {
          const tblIdStr = String(context.tableId);
          useTerminalPaymentStore.getState().clearSession(tblIdStr);
        }
        setProcessing(false);
        setPaymentStatus("failed");
        setPaymentMessage(terminalSession.message || '❌ Payment failed');
      }
    } else {
      if (paymentStatus !== "idle") {
        setPaymentStatus("idle");
        setPaymentMessage("");
        setProcessing(false);
      }
    }
  }, [terminalSession, cacheKey]);

  const settingsStore = useCompanySettingsStore((state: { settings: CompanySettings }) => state.settings);
  const currencySymbol = settingsStore.currencySymbol || "$";
  const gstRate = (settingsStore.gstPercentage || 0) / 100;
  const isTakeawayOrder = context?.orderType === "TAKEAWAY";
  const dineInScRate = isTakeawayOrder ? 0 : (settingsStore.serviceChargePercentage || 0) / 100;
  const twScRate = (settingsStore.twServiceChargePercentage || 0) / 100;

  const handleTerminalPaymentSuccess = React.useCallback((methodName: string, totalAmt: number, msg?: string) => {
    const lockKey = (context?.tableId || displayOrderId || "MAIN_PAYMENT_LOCK").toString();
    if (finalizationLockRef.current[lockKey]) {
      console.log(`[YeahPay] Already finalizing payment for ${lockKey}, skipping duplicate call.`);
      return;
    }
    finalizationLockRef.current[lockKey] = true;

    showToast({
      type: 'success',
      message: '✅ Payment Successful',
      subtitle: `${currencySymbol}${totalAmt.toFixed(2)} paid via ${methodName}`
    });

    if (context?.tableId) {
      const tblIdStr = String(context.tableId);
      useTerminalPaymentStore.getState().clearSession(tblIdStr);
      useTableNavigationStore.getState().clearTableLastScreen(tblIdStr);
      useTableNavigationStore.getState().clearSelectedMethod(tblIdStr);
    }
    if (cacheKey) {
      delete ongoingPayments[cacheKey];
    }

    const execFn = executeFinalPaymentRef.current || executeFinalPayment;
    execFn(undefined, undefined, undefined, true).catch((err: any) => {
      console.error("❌ executeFinalPayment error:", err);
      delete finalizationLockRef.current[lockKey];
    });
  }, [cacheKey, context?.tableId, displayOrderId, currencySymbol]);

  useEffect(() => {
    executeFinalPaymentRef.current = executeFinalPayment;
  });


  useEffect(() => {
    if (isFocused) {
      setCheckoutSessionId(
        "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        }),
      );
    }
  }, [isFocused]);

  useEffect(() => {
    if (isLedgerCollection && collectAmount !== undefined) {
      setCollectionAmount(collectAmount.toFixed(2));
    }
  }, [collectAmount, isLedgerCollection]);

  const handleAmountChange = (text: string) => {
    const cleaned = text.replace(/[^0-9.]/g, "");
    const parts = cleaned.split(".");
    const formatted =
      parts.length > 2 ? `${parts[0]}.${parts.slice(1).join("")}` : cleaned;

    const val = parseFloat(formatted) || 0;
    if (collectAmount !== undefined && val > collectAmount) {
      showToast({
        type: "warning",
        message: "Overpayment Prevention",
        subtitle: `Cannot exceed outstanding balance of ${currencySymbol}${collectAmount.toFixed(2)}`,
      });
      setCollectionAmount(collectAmount.toFixed(2));
      if (isCashMethod(method)) {
        setCashInput(collectAmount.toFixed(2));
      }
      return;
    }
    setCollectionAmount(formatted);
    if (isCashMethod(method)) {
      setCashInput(formatted);
    }
  };
  const [time, setTime] = useState(new Date());
  const [isSplitActive, setIsSplitActive] = useState(params.isSplit === "true");

  useEffect(() => {
    if (params.isSplit === "true") {
      setIsSplitActive(true);
    }
  }, [params.isSplit]);

  useEffect(() => {
    if (context?.tableId) {
      // Only restore split mode from the explicit toggle flag — NOT session.isSplit,
      // which persists in the store after the terminal resolves.
      const isSplitPersisted = useTerminalPaymentStore.getState().activeSplitTables[context.tableId] === true;
      if (isSplitPersisted) {
        setIsSplitActive(true);
      }
    }
  }, [context?.tableId]);

  // Member flow state
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [members, setMembers] = useState<any[]>([]);
  const [searchingMembers, setSearchingMembers] = useState(false);

  // Quick Add State variables
  const [isQuickAddMode, setIsQuickAddMode] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newCreditLimit, setNewCreditLimit] = useState("1000");
  const [newEmail, setNewEmail] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newIsActive, setNewIsActive] = useState(true);
  const [selectedCountryCode, setSelectedCountryCode] = useState("+65");
  const [showCountryCodeModal, setShowCountryCodeModal] = useState(false);
  const [addingMember, setAddingMember] = useState(false);

  const handleQuickAddMember = async () => {
    if (!newName.trim() || !newPhone.trim()) {
      showToast({
        type: "warning",
        message: "Required Fields",
        subtitle: "Please enter Name and Phone",
      });
      return;
    }
    setAddingMember(true);
    const isCredit = method.trim().toUpperCase() === "CREDIT";
    const endpoint = isCredit
      ? `${API_URL}/api/credit-customers/add`
      : `${API_URL}/api/members/add`;
    try {
      const fullPhone = selectedCountryCode + newPhone.trim();
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.trim(),
          phone: fullPhone,
          email: newEmail.trim() || null,
          address: newAddress.trim() || null,
          creditLimit: parseFloat(newCreditLimit) || 1000,
          currentBalance: 0,
          balance: 0,
          isActive: newIsActive ? 1 : 0,
          userId: user?.userId,
        }),
      });
      const data = await res.json();
      if (data.success && data.member) {
        setSelectedMember(data.member);
        setIsQuickAddMode(false);
        setNewName("");
        setNewPhone("");
        setNewEmail("");
        setNewAddress("");
        setNewIsActive(true);
        setSelectedCountryCode("+65");
        setNewCreditLimit("1000");
        setMemberQuery(data.member.Name);
        showToast({
          type: "success",
          message: "Success",
          subtitle: isCredit
            ? "New credit customer added and selected!"
            : "New member added and selected!",
        });
      } else {
        showToast({
          type: "error",
          message: "Failed",
          subtitle: data.error || "Could not add customer",
        });
      }
    } catch (err) {
      console.error("Quick add error:", err);
      showToast({
        type: "error",
        message: "Error",
        subtitle: "Could not connect to server",
      });
    } finally {
      setAddingMember(false);
    }
  };

  const searchMembers = async (q: string) => {
    setSearchingMembers(true);
    const isCredit = method.trim().toUpperCase() === "CREDIT";
    const endpoint = isCredit
      ? `${API_URL}/api/credit-customers/search?query=${encodeURIComponent(q)}`
      : `${API_URL}/api/members/search?query=${encodeURIComponent(q)}`;
    try {
      const res = await fetch(endpoint, {
        headers: useAuthStore.getState().token ? { Authorization: `Bearer ${useAuthStore.getState().token}` } : {},
      });
      const data = await res.json();
      setMembers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Search members error:", err);
      showToast({
        type: "error",
        message: "Search Failed",
        subtitle: "Could not search accounts",
      });
    } finally {
      setSearchingMembers(false);
    }
  };

  useEffect(() => {
    if (showMemberModal) {
      const timer = setTimeout(() => {
        searchMembers(memberQuery);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [memberQuery, showMemberModal]);

  useEffect(() => {
    if (!showMemberModal) {
      setIsQuickAddMode(false);
      setNewName("");
      setNewPhone("");
      setNewEmail("");
      setNewAddress("");
      setNewIsActive(true);
      setSelectedCountryCode("+65");
      setNewCreditLimit("1000");
    }
  }, [showMemberModal]);

  const splitItems = useCartStore((s: any) => s.activeSplitItems);

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loadingMethods, setLoadingMethods] = useState(true);
  const [selectedDetail, setSelectedDetail] = useState<PaymentMethod | null>(
    null,
  );
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [isUPIVisible, setIsUPIVisible] = useState(false);
  const [isPayNowVisible, setIsPayNowVisible] = useState(false);
  const [roundOff, setRoundOff] = useState(0);
  const [roundType, setRoundType] = useState<
    "whole" | "five" | "ten" | "custom" | null
  >(null);
  const [isAdjustmentModalVisible, setIsAdjustmentModalVisible] =
    useState(false);
  const [customValue, setCustomValue] = useState("");
  const [isTestModalVisible, setIsTestModalVisible] = useState(false);
  const [scReduced, setScReduced] = useState(false);
  const scReducedLocal = useServiceChargeOverrideStore((s) =>
    displayOrderId ? s.overrides[displayOrderId.toLowerCase()] : false
  );
  const [takeawayChargeApplied, setTakeawayChargeApplied] = useState(true);
  const [takeawayChargeAmt, setTakeawayChargeAmt] = useState(0);

  useEffect(() => {
    if (!displayOrderId || !isFocused) return;

    const token = useAuthStore.getState().token;

    if (__DEV__) {
      console.log("🔍 [Payment] SC & Takeaway override fetch triggered. displayOrderId:", displayOrderId);
    }

    // PERFORMANCE: Run both override fetches in parallel — previously sequential
    Promise.all([
      fetch(`${API_URL}/api/orders/${displayOrderId}/sc-override`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).then((r) => r.json()),
      fetch(`${API_URL}/api/orders/${displayOrderId}/takeaway-charge`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).then((r) => r.json()),
    ])
      .then(([scData, twData]) => {
        if (__DEV__) {
          console.log("✅ [Payment] SC override response:", scData);
          console.log("✅ [Payment] Takeaway charge response:", twData);
        }

        // SC override
        if (scData?.serviceChargeReduced) {
          setScReduced(true);
          useServiceChargeOverrideStore.getState().setOverride(displayOrderId, true);
        } else {
          setScReduced(false);
          useServiceChargeOverrideStore.getState().setOverride(displayOrderId, false);
        }

        // Takeaway charge override
        if (twData?.takeawayChargeOverride === 1) {
          setTakeawayChargeApplied(false);
        } else {
          setTakeawayChargeApplied(true);
        }
        setTakeawayChargeAmt(twData?.takeawayCharge || 0);
      })
      .catch((e) => {
        if (__DEV__) {
          console.warn("❌ [Payment] Failed to fetch SC/takeaway override status:", e);
        }
      });
  }, [displayOrderId, isFocused]);

  const [pendingPayments, setPendingPayments] = useState<any[] | null>(null);
  const [payNowQrAmount, setPayNowQrAmount] = useState(0);
  const [upiQrAmount, setUpiQrAmount] = useState(0);

  // ── Payment-mode normalizer (payment.tsx) ──────────────────────────────────
  // All routing decisions use EXACT normalized comparisons — never .includes().
  // This prevents "Yeahpay Paynow", "GPay", "QR" etc. from bleeding into the
  // wrong flow.
  const pmNormalize = (m: string) => (m ?? "").trim().toUpperCase();

  const calculatePayNowAmount = (paymentsList: any[]) => {
    return paymentsList.reduce((sum, p) => {
      const pm = paymentMethods.find((x) => x.position === p.payModeId);
      if (pm) {
        // Only the exact payment mode "PAYNOW" (case-insensitive) counts
        // as static-PayNow for display purposes.
        if (pmNormalize(pm.payMode) === "PAYNOW") {
          return sum + p.amount;
        }
      }
      return sum;
    }, 0);
  };

  const calculateUpiAmount = (paymentsList: any[]) => {
    return paymentsList.reduce((sum, p) => {
      const pm = paymentMethods.find((x) => x.position === p.payModeId);
      if (pm) {
        const code = pmNormalize(pm.payMode);
        if (
          code === "UPI" ||
          code === "GPAY" ||
          code.startsWith("PHONE") ||
          code === "PAYTM"
        ) {
          return sum + p.amount;
        }
      }
      return sum;
    }, 0);
  };

  const finalItemsRaw = useMemo(() => {
    const baseItems = splitItems || cart;
    return baseItems.filter((i: any) => i.status !== "VOIDED" && i.isVoided !== true && i.StatusCode !== 0 && i.statusCode !== 0);
  }, [splitItems, cart]);

  const [loyaltyDiscountItems, setLoyaltyDiscountItems] = useState<any[]>([]);
  const [loyaltyDiscountAmount, setLoyaltyDiscountAmount] = useState(0);

  // ── Loyalty dish rewards: debounced to avoid hammering the API on rapid
  // cart socket updates. The 400 ms window lets back-to-back changes settle
  // before issuing a new request. Business logic is unchanged.
  useEffect(() => {
    const phone = loyaltyPhone ? loyaltyPhone.trim() : "";
    if (!phone || finalItemsRaw.length === 0 || isLedgerCollection) {
      setLoyaltyDiscountItems([]);
      setLoyaltyDiscountAmount(0);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const token = useAuthStore.getState().token;
        const mappedItems = finalItemsRaw.map((i: any) => ({
          DishId: i.DishId || i.dishId || i.id,
          Qty: i.qty,
          Price: i.price,
          isDishReward: false
        }));

        const res = await fetch(`${API_URL}/api/loyalty/calculate-bill-rewards`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {})
          },
          body: JSON.stringify({ phone, items: mappedItems })
        });
        const data = await res.json();
        if (data.success) {
          const processed = (data.items || []).map((i: any) => {
            const originalCartItem = finalItemsRaw.find((raw: any) => String(raw.id || raw.DishId || raw.dishId).toLowerCase() === String(i.DishId || i.id).toLowerCase()) || {};
            return {
              ...originalCartItem,
              ...i,
              qty: i.Qty !== undefined ? i.Qty : i.qty,
              price: i.Price !== undefined ? i.Price : i.price,
              name: i.name || originalCartItem.name || "Dish"
            };
          });
          setLoyaltyDiscountItems(processed);
          setLoyaltyDiscountAmount(data.totalDiscount || 0);
        } else {
          setLoyaltyDiscountItems([]);
          setLoyaltyDiscountAmount(0);
        }
      } catch (err) {
        console.error("Calculate dish loyalty rewards error in payment:", err);
        setLoyaltyDiscountItems([]);
        setLoyaltyDiscountAmount(0);
      }
    }, 400); // debounce: wait 400 ms for cart changes to settle

    return () => clearTimeout(timer);
  }, [loyaltyPhone, finalItemsRaw, isLedgerCollection]);

  const finalItems = useMemo(() => {
    return loyaltyDiscountItems.length > 0 ? loyaltyDiscountItems : finalItemsRaw;
  }, [loyaltyDiscountItems, finalItemsRaw]);

  useEffect(() => {
    const init = async () => {
      const store = usePaymentSettingsStore.getState();
      const settingsPromise = store.hasLoadedMethods
        ? Promise.resolve()
        : Promise.all([
            store.fetchSettings(),
            store.fetchPaymentMethods()
          ]).catch((err) => {
            if (__DEV__) console.error("Failed to fetch settings/methods on payment screen mount:", err);
          });

      // PERFORMANCE: Run table/order ID fetch in parallel with payment settings fetch
      const tablePromise = context?.tableId
        ? (async () => {
            try {
              const res = await fetch(`${API_URL}/api/tables/${context.tableId}`);
              const data = await res.json();
              const oid = data.table?.currentOrderId || data.table?.CurrentOrderId;
              if (data.success && oid) {
                useCartStore.getState().setTableOrderId(context.tableId!, oid);
              }
              // Fetch the cart items from the database to ensure they are loaded on direct routing
              if (cart.length === 0) {
                await useCartStore.getState().fetchCartFromDB(context.tableId!);
              }
            } catch (err) {
              console.error("Failed to sync official Order ID and Cart:", err);
            }
          })()
        : Promise.resolve();

      // Wait for both to finish before applying payment methods from cache
      await Promise.all([settingsPromise, tablePromise]);
      applyPaymentMethodsFromCache();
    };
    init();
  }, []);

  // 🔄 AUTO-SYNC: Update the local paymentMethods list as soon as the cache finishes loading
  const hasLoadedMethods = usePaymentSettingsStore((s: any) => s.hasLoadedMethods);
  const cachedMethods = usePaymentSettingsStore((s: any) => s.paymentMethods);

  useEffect(() => {
    if (hasLoadedMethods && cachedMethods.length > 0) {
      applyPaymentMethodsFromCache();
    }
  }, [hasLoadedMethods, cachedMethods]);

  // 💵 QUICK CASH REAL-TIME SYNC — updates instantly when any terminal changes amounts
  useEffect(() => {
    const unsubscribe = useQuickCashStore.getState().subscribeToSocket();
    return unsubscribe;
  }, []);

  useEffect(() => {
    CustomerDisplaySync.isPaymentActive = true;
    return () => {
      CustomerDisplaySync.isPaymentActive = false;
      CustomerDisplaySync.syncIdle();
    };
  }, []);

  const takeawayCharges = settingsStore.takeawayCharges || 0;

  const {
    subtotal,
    grossTotal: payGrossTotal,
    totalItemDiscount: payItemDiscount,
    totalFocAmount,
    scEligibleSubtotal,
    twScEligibleSubtotal,
    calcTakeawayChargeAmt,
    takeawayQty,
    hasMixedTWCharges,
    singleTWRate,
  } = useMemo(() => {
    if (isLedgerCollection) {
      return {
        grossTotal: collectAmount || 0,
        totalItemDiscount: 0,
        totalFocAmount: 0,
        subtotal: collectAmount || 0,
        scEligibleSubtotal: 0,
        twScEligibleSubtotal: 0,
        calcTakeawayChargeAmt: 0,
        takeawayQty: 0,
        hasMixedTWCharges: false,
        singleTWRate: takeawayCharges,
      };
    }

    let firstRate: number | null = null;
    let mixed = false;

    const reduced = finalItems.reduce(
      (acc: any, item: any) => {
        const isVoided = (item as any).status === "VOIDED";
        if (isVoided) return acc;
        const baseTotal = (item.price || 0) * (item.qty || 0);
        let itemDiscount = 0;
        const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
        const discType = item.discountType || "percentage";
        if (discAmt > 0) {
          const isCombo = item.isCombo === true || String(item.isCombo) === "1" || item.isCombo === 1;
          const discountBasis = isCombo ? (item.basePrice ?? item.price ?? 0) : (item.price ?? 0);
          const isFixed = discType === "fixed" || (discType === "percentage" && !item.discount && item.discountAmount > 0);
          if (isFixed) {
            itemDiscount = Math.min(discAmt, discountBasis) * (item.qty || 0);
          } else {
            itemDiscount = baseTotal * (discAmt / 100);
          }
        }
        const itemSubtotal = baseTotal - itemDiscount;
        const itemFocAmount = item.isFoc ? itemSubtotal : 0;
        const isTakeawayItem = isTakeawayOrder || Boolean(item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway || String(item.isTakeaway) === "1" || String(item.IsTakeaway) === "1" || String(item.isTakeAway) === "1" || String(item.IsTakeAway) === "1");
        const isSC =
          !isTakeawayItem && (Number(item.isServiceCharge) === 1 || item.isServiceCharge === true);
        
        let itemTWCharge = 0;
        if (isTakeawayItem) {
          const dishSpecificTW = Number(item.takeawayCharge ?? item.TakeawayCharge ?? 0);
          const effectiveTWRate = dishSpecificTW > 0 ? dishSpecificTW : takeawayCharges;
          itemTWCharge = (item.qty || 1) * effectiveTWRate;

          if (firstRate === null) {
            firstRate = effectiveTWRate;
          } else if (firstRate !== effectiveTWRate) {
            mixed = true;
          }
        }

        return {
          grossTotal: acc.grossTotal + baseTotal,
          totalItemDiscount: acc.totalItemDiscount + itemDiscount,
          totalFocAmount: acc.totalFocAmount + itemFocAmount,
          subtotal: acc.subtotal + itemSubtotal,
          scEligibleSubtotal:
            acc.scEligibleSubtotal + (isSC && !item.isFoc ? itemSubtotal : 0),
          twScEligibleSubtotal:
            acc.twScEligibleSubtotal + (isTakeawayItem && !item.isFoc ? itemSubtotal : 0),
          calcTakeawayChargeAmt: acc.calcTakeawayChargeAmt + (isTakeawayItem && !item.isFoc ? itemTWCharge : 0),
          takeawayQty: acc.takeawayQty + (isTakeawayItem && !item.isFoc ? (item.qty || 1) : 0),
        };
      },
      {
        grossTotal: 0,
        totalItemDiscount: 0,
        totalFocAmount: 0,
        subtotal: 0,
        scEligibleSubtotal: 0,
        twScEligibleSubtotal: 0,
        calcTakeawayChargeAmt: 0,
        takeawayQty: 0,
      },
    );

    return {
      ...reduced,
      hasMixedTWCharges: mixed,
      singleTWRate: firstRate !== null ? firstRate : takeawayCharges,
    };
  }, [finalItems, isLedgerCollection, collectAmount, takeawayCharges, isTakeawayOrder]);

  const allItemsHaveSC = useMemo(() => {
    const activeItems = finalItems.filter(
      (i: any) => i.status !== "VOIDED" && i.statusCode !== 0,
    );
    return (
      activeItems.length > 0 &&
      activeItems.every(
        (item: any) => {
          const isTakeawayItem = isTakeawayOrder || Boolean(item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway);
          return !isTakeawayItem && (Number(item.isServiceCharge) === 1 || item.isServiceCharge === true);
        },
      )
    );
  }, [finalItems, isTakeawayOrder]);

  const discountAmount = useMemo(() => {
    if (isLedgerCollection) return 0;
    if (!discount?.applied) return 0;
    if (discount.type === "percentage")
      return Math.min((subtotal * discount.value) / 100, subtotal);
    return splitItems ? 0 : Math.min(discount.value, subtotal);
  }, [discount, subtotal, splitItems, isLedgerCollection]);

  // Service Charge & GST: SC on net, GST on (net + SC)
  const netAfterDiscount = isLedgerCollection
    ? collectAmount || 0
    : Math.max(0, subtotal - discountAmount - totalFocAmount);

  // Pro-rate the bill-level discount to service-charge-eligible items
  const scEligibleNet = useMemo(() => {
    if (isLedgerCollection || subtotal <= 0) return 0;
    const payableSubtotal = Math.max(0, subtotal - totalFocAmount);
    if (payableSubtotal <= 0) return 0;
    const proportion = scEligibleSubtotal / payableSubtotal;
    return Math.max(0, scEligibleSubtotal - proportion * discountAmount);
  }, [scEligibleSubtotal, subtotal, totalFocAmount, discountAmount, isLedgerCollection]);

  const twScEligibleNet = useMemo(() => {
    if (isLedgerCollection || subtotal <= 0) return 0;
    const payableSubtotal = Math.max(0, subtotal - totalFocAmount);
    if (payableSubtotal <= 0) return 0;
    const proportion = twScEligibleSubtotal / payableSubtotal;
    return Math.max(0, twScEligibleSubtotal - proportion * discountAmount);
  }, [twScEligibleSubtotal, subtotal, totalFocAmount, discountAmount, isLedgerCollection]);

  const billDiscountProportion = useMemo(() => {
    if (isLedgerCollection) return 0;
    if (!discount?.applied) return 0;
    if (discount.type === "percentage") {
      return discount.value / 100;
    }
    const payableSubtotal = Math.max(0, subtotal - totalFocAmount);
    return payableSubtotal > 0 ? (discountAmount / payableSubtotal) : 0;
  }, [discount, subtotal, totalFocAmount, discountAmount, isLedgerCollection]);

  const currentTakeawayCharge = useMemo(() => {
    if (isLedgerCollection) return 0;
    if (!takeawayChargeApplied) return 0;
    return calcTakeawayChargeAmt * (1 - billDiscountProportion);
  }, [takeawayChargeApplied, calcTakeawayChargeAmt, billDiscountProportion, isLedgerCollection]);

  const dineInServiceChargeAmt = isLedgerCollection || scReduced || scReducedLocal ? 0 : scEligibleNet * dineInScRate;
  const twServiceChargeAmt = isLedgerCollection || scReduced || scReducedLocal ? 0 : twScEligibleNet * twScRate;
  const serviceChargeAmt = dineInServiceChargeAmt + twServiceChargeAmt;
  const taxableAmount = netAfterDiscount + serviceChargeAmt + currentTakeawayCharge;
  const tax = isLedgerCollection ? 0 : taxableAmount * gstRate;
  const baseTotal = taxableAmount + tax;

  useEffect(() => {
    if (isLedgerCollection) {
      setRoundOff(0);
      setRoundType(null);
      return;
    }
    if (!isCashMethod(method)) {
      setRoundOff(0);
      setRoundType(null);
      return;
    }
    if (roundType === "whole") setRoundOff(Math.round(baseTotal) - baseTotal);
    else if (roundType === "five")
      setRoundOff(Math.round(baseTotal * 20) / 20 - baseTotal);
    else if (roundType === "ten")
      setRoundOff(Math.round(baseTotal * 10) / 10 - baseTotal);
  }, [baseTotal, roundType, method, isLedgerCollection]);

  const total = isLedgerCollection
    ? parseFloat(collectionAmount) || 0
    : Math.max(0, Math.round((baseTotal + roundOff) * 100) / 100);
  const displayedTax = isLedgerCollection ? 0 : Math.round((tax + Number.EPSILON) * 100) / 100;
  const displayedServiceCharge = isLedgerCollection
    ? 0
    : Math.round((serviceChargeAmt + Number.EPSILON) * 100) / 100;
  const netAmountForDisplay = netAfterDiscount;
  const displayedRoundOff =
    roundOff !== 0
      ? parseFloat(
        (
          total -
          (netAmountForDisplay + displayedServiceCharge + displayedTax + currentTakeawayCharge)
        ).toFixed(2),
      )
      : 0;
  const paidNum = isCashMethod(method) ? parseFloat(cashInput) || 0 : total;
  const change = Math.max(0, paidNum - total);

  useEffect(() => {
    if (!isFocused) {
      if (pathname !== "/payment_success") {
        CustomerDisplaySync.isPaymentActive = false;
        CustomerDisplaySync.syncIdle();
      }
      return;
    }

    CustomerDisplaySync.isPaymentActive = true;

    if (context && finalItems.length > 0) {
      // Use exact normalized mode names — regex broad checks would confuse
      // "Yeahpay Paynow" with plain "Paynow" and "Yeahpay Card" with plain "Card".
      const _nm = pmNormalize(method);
      const _isYeahPayPayNow = _nm === "YEAHPAY PAYNOW";
      const _isYeahPayCard   = _nm === "YEAHPAY CARD";

      let displayPaymentMethod = method;
      if (_isYeahPayPayNow) {
        displayPaymentMethod = 'YEAHPAY_PAYNOW';
      } else if (_isYeahPayCard) {
        displayPaymentMethod = 'YEAHPAY_CARD';
      }

      // Include member name when MEMBER or CREDIT mode is selected
      const isMemberMode = /^(MEMBER|CREDIT)$/i.test((method || '').trim());
      const displayMemberName = isMemberMode ? (selectedMember?.Name || '') : '';

      CustomerDisplaySync.syncCart({
        orderContext: context,
        cart: finalItems,
        discountInfo: discount,
        gstPercentage: settingsStore.gstPercentage || 0,
        roundOff: roundOff,
        active: true,
        orderId: displayOrderId,
        paymentMethod: displayPaymentMethod,
        memberName: displayMemberName,
        takeawayCharge: currentTakeawayCharge,
      });
    } else {
      CustomerDisplaySync.syncIdle();
    }
  }, [
    isFocused,
    pathname,
    context,
    finalItems,
    discount,
    settingsStore.gstPercentage,
    roundOff,
    displayOrderId,
    method,
    paymentMethods,
    selectedMember,
    currentTakeawayCharge,
  ]);

  // ── Quick Cash ─────────────────────────────────────────────────────────────
  const { settings: generalSettings } = useGeneralSettingsStore();
  const { amounts: quickCash, setAmounts: setQuickCashAmounts } =
    useQuickCashStore();

  const [isEditingQuickCash, setIsEditingQuickCash] = useState(false);
  const [quickCashDraft, setQuickCashDraft] = useState<string[]>([]);

  const openQuickCashEditor = () => {
    setQuickCashDraft(quickCash.map((v) => v.toString()));
    setIsEditingQuickCash(true);
  };

  const saveQuickCash = () => {
    const parsed = quickCashDraft.map((s) => {
      const n = parseFloat(s);
      return isNaN(n) || n <= 0 ? 0 : Math.round(n * 100) / 100;
    });
    setQuickCashAmounts(parsed);
    setIsEditingQuickCash(false);
  };
  // ───────────────────────────────────────────────────────────────────────────

  const applyPaymentMethodsFromCache = () => {
    setLoadingMethods(true);
    try {
      const cached = usePaymentSettingsStore.getState().paymentMethods;

      const mapped: PaymentMethod[] = cached.map((d: CachedPaymentMethod) => ({
        payMode: (d.payMode || "").trim(),
        description: (d.description || d.payMode || "").trim(),
        icon: getPaymodeIcon((d.payMode || "").trim()),
        commission: d.commission,
        serviceCharge: d.serviceCharge,
        isEntertainment: d.isEntertainment,
        isVoucher: d.isVoucher,
        position: d.position || 0,
        active: d.active,
        yeahPayEnabled: d.yeahPayEnabled,
        deviceSn: d.deviceSn || null,
        deviceSalt: d.deviceSalt || null,
      }));

      // Sort active paymodes first so deduplication prioritizes active entries
      const sortedByActive = [...mapped].sort((a, b) => {
        const aActive = a.active === 1 || a.active === true || a.active === "1" || a.active === null || a.active === undefined;
        const bActive = b.active === 1 || b.active === true || b.active === "1" || b.active === null || b.active === undefined;
        return (bActive ? 1 : 0) - (aActive ? 1 : 0);
      });

      const seen = new Set<string>();
      const deduped = sortedByActive.filter((m) => {
        const key = isCashMethod(m.payMode)
          ? "__CASH__"
          : m.payMode.toUpperCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const { settings } = usePaymentSettingsStore.getState();
      const hasUPI = settings.upiId && settings.upiId.trim().length > 0;
      const hasPayNow =
        settings.payNowQrUrl && settings.payNowQrUrl.trim().length > 0;

      const filtered = deduped.filter((m) => {
        if (m.active === 0 || m.active === false || m.active === "0")
          return false;
        const mUpper = pmNormalize(m.payMode);
        if (
          isLedgerCollection &&
          (mUpper === "MEMBER" || mUpper === "CREDIT" || mUpper === "LEDGER")
        )
          return false;
        // UPI-family: exact matches only
        const isUPI =
          mUpper === "UPI" ||
          mUpper === "GPAY" ||
          mUpper.startsWith("PHONE") ||
          mUpper === "PAYTM";
        // Static-PayNow QR: ONLY the exact mode "PAYNOW" requires the QR URL.
        // "Yeahpay Paynow" is terminal-based and must NEVER be hidden by !hasPayNow.
        // "QR" is an independent payment mode and must NOT be hidden either.
        const isStaticPayNow = mUpper === "PAYNOW";
        if (isUPI && !hasUPI) return false;
        if (isStaticPayNow && !hasPayNow) return false;
        return true;
      });

      setPaymentMethods(filtered);
      if (filtered.length > 0) {
        // 🚀 Restore the previously saved method for this table (if any)
        const tableId = useOrderContextStore.getState().currentOrder?.tableId;
        const savedMethod = tableId
          ? useTableNavigationStore.getState().getSelectedMethod(tableId.toString())
          : undefined;
        const restoredMethod = savedMethod
          ? filtered.find((m) => m.payMode === savedMethod)
          : undefined;
        const activeMethod = restoredMethod || filtered[0];

        setMethod(activeMethod.payMode);
        setSelectedDetail(activeMethod);
        if (isCashMethod(activeMethod.payMode)) {
          setCashInput(total.toFixed(2));
        }
      }
    } catch (err) {
      if (__DEV__) {
        console.error("Error applying payment methods from cache:", err);
      }
      setPaymentMethods([
        {
          payMode: "CAS",
          description: "CASH",
          icon: "money-bill-wave",
          commission: 0,
          serviceCharge: 0,
          isEntertainment: false,
          isVoucher: false,
          position: 1,
        },
      ]);
    } finally {
      setLoadingMethods(false);
    }
  };

  const handleSelectMethod = (m: PaymentMethod) => {
    // 🚫 Block switching payment method while a terminal payment is in flight
    if (paymentStatus === "processing") {
      Alert.alert(
        "Payment In Progress",
        "A payment is currently being processed on the terminal. Please wait for it to complete.",
        [{ text: "OK" }]
      );
      return;
    }

    // 🧹 If a previous YeahPay result (success/failed/cancelled) is still showing,
    // clear it so the new method starts with a clean slate.
    if (paymentStatus !== "idle") {
      setPaymentStatus("idle");
      setPaymentMessage("");
      setProcessing(false);
      const tableId = useOrderContextStore.getState().currentOrder?.tableId;
      if (tableId) {
        useTerminalPaymentStore.getState().clearSession(tableId);
      }
    }

    setMethod(m.payMode);

    if (!isCashMethod(m.payMode)) {
      setRoundOff(0);
      setRoundType(null);
    } else {
      setCashInput(total.toFixed(2));
    }
    setSelectedDetail(m);

    // 💾 Persist selected method so it survives Home → back navigation
    const tableId = useOrderContextStore.getState().currentOrder?.tableId;
    if (tableId) {
      useTableNavigationStore.getState().setSelectedMethod(tableId.toString(), m.payMode);
    }
  };

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const confirmPayment = async () => {
    if (processing) return;

    const selectedMethod = paymentMethods.find(m => 
      m.payMode.trim().toUpperCase() === method.trim().toUpperCase() ||
      pmNormalize(m.payMode) === pmNormalize(method)
    );
    // Use exact normalized mode names — ONLY "Yeahpay Paynow" and "Yeahpay Card"
    // should trigger the YeahPay terminal and require Device SN.
    const _methodNorm      = pmNormalize(method);
    const isYeahPayPayNow  = _methodNorm === "YEAHPAY PAYNOW";
    const isYeahPayCardMode = _methodNorm === "YEAHPAY CARD";
    const isYeahPay        = isYeahPayPayNow || isYeahPayCardMode;

    // ✅ YEAHPAY - Direct terminal call (ONLY for "Yeahpay Paynow" / "Yeahpay Card")
    if (isYeahPay && total > 0 && cacheKey) {
      setPaymentStatus("processing");
      setPaymentMessage("Processing payment...");
      setProcessing(true);

      const deviceSn = (selectedMethod?.deviceSn || (selectedMethod as any)?.DeviceSN || '').trim();
      const salt = (selectedMethod?.deviceSalt || (selectedMethod as any)?.DeviceSalt || '').trim();

      console.log('🔄 [MainPayment] Calling YeahPay terminal for:', method);
      console.log('   Amount:', total);
      console.log('   DeviceSN:', deviceSn);

      if (!deviceSn) {
        setPaymentStatus("failed");
        setPaymentMessage("DeviceSN not configured");
        Alert.alert('Configuration Error', 'DeviceSN not configured.');
        setProcessing(false);
        return;
      }

      const endpoint = isYeahPayCardMode ? '/api/yeahpay/card-payment' : '/api/yeahpay/paynow-payment';
      
      const fetchPromise = (async () => {
        try {
          const response = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(useAuthStore.getState().token ? { 'Authorization': `Bearer ${useAuthStore.getState().token}` } : {}),
            },
            body: JSON.stringify({
              amount: total,
              deviceSn: deviceSn,
              salt: salt || '',
              tableId: context?.tableId || ''
            })
          });

          const result = await response.json();
          console.log('✅ [MainPayment] Terminal response:', result);
          const responseCode = result.code;
          let status: "success" | "cancelled" | "failed" = "failed";
          let message = "";

          if (result.success || responseCode === 0) {
            status = "success";
            message = `✅ ${currencySymbol}${total.toFixed(2)} paid successfully via ${method}`;
          } else if (responseCode === -1027) {
            status = "cancelled";
            message = `❌ Transaction cancelled on terminal`;
          } else if (responseCode === -1028 || responseCode === -1008) {
            status = "failed";
            message = `⏰ Transaction timeout`;
          } else {
            status = "failed";
            message = `❌ ${result.msg || result.error || 'Payment declined'}`;
          }

          if (ongoingPayments[cacheKey]) {
            ongoingPayments[cacheKey].status = status;
            ongoingPayments[cacheKey].message = message;
          }

          if (context?.tableId) {
            useTerminalPaymentStore.getState().updateSession(context.tableId, { status, message });
          }

          if (status === "success") {
            handleTerminalPaymentSuccess(method, total, message);
          } else if (status === "cancelled") {
            setPaymentMessage(message);
            Alert.alert('❌ Transaction Cancelled', 'Payment was cancelled on the terminal. Please try again.');
            if (context?.tableId) {
              useTerminalPaymentStore.getState().clearSession(String(context.tableId));
            }
            delete ongoingPayments[cacheKey];
          } else {
            setProcessing(false);
            setPaymentStatus("failed");
            setPaymentMessage(message);
            Alert.alert('❌ Payment Failed', message || 'Failed to connect to terminal');
            if (context?.tableId) {
              useTerminalPaymentStore.getState().clearSession(String(context.tableId));
            }
            delete ongoingPayments[cacheKey];
          }
          return result;
        } catch (error: any) {
          console.error('❌ [MainPayment] Terminal error:', error);
          const status = "failed";
          const message = `❌ ${error.message}`;

          if (ongoingPayments[cacheKey]) {
            ongoingPayments[cacheKey].status = status;
            ongoingPayments[cacheKey].message = message;
          }

          if (context?.tableId) {
            useTerminalPaymentStore.getState().updateSession(context.tableId, { status: "failed", message });
          }
          setProcessing(false);
          setPaymentStatus("failed");
          setPaymentMessage(message);
          Alert.alert('❌ Payment Failed', message);
          delete ongoingPayments[cacheKey];
          return { success: false, code: -1, msg: error.message };
        }
      })();

      ongoingPayments[cacheKey] = {
        status: "processing",
        message: "Processing payment...",
        method: method,
        total: total,
        promise: fetchPromise
      };

      // 🚀 Sync to Zustand store so table grid can show live terminal badge
      if (context?.tableId) {
        useTerminalPaymentStore.getState().setSession(context.tableId, {
          tableId: context.tableId,
          status: "processing",
          message: "Processing payment...",
          method: method,
          total: total,
        });
      }

      return;
    }

    // ✅ NETS ECR II - Terminal Payment (NETS / NETS CARD / NETS QR)
    const isNetsCard = _methodNorm === "NETS" || _methodNorm === "NETS CARD";
    const isNetsQr = _methodNorm === "NETS QR";
    const isNets = isNetsCard || isNetsQr;

    if (isNets && total > 0 && cacheKey) {
      setPaymentStatus("processing");
      setPaymentMessage("Please follow prompt on NETS terminal...");
      setProcessing(true);

      console.log('🔄 [MainPayment] Calling NETS terminal for:', method, 'Amount:', total);

      const fetchPromise = (async () => {
        try {
          const response = await fetch(`${API_URL}/api/nets/purchase`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(useAuthStore.getState().token ? { 'Authorization': `Bearer ${useAuthStore.getState().token}` } : {}),
            },
            body: JSON.stringify({
              amount: total,
              isQrOnTerminal: isNetsQr,
              ecrRef: displayOrderId || context?.tableId || `ECR${Date.now()}`,
              tableId: context?.tableId || ''
            })
          });

          const result = await response.json();
          console.log('✅ [MainPayment] NETS Terminal response:', result);

          let status: "success" | "cancelled" | "failed" = "failed";
          let message = "";

          if (result.success || result.isApproved) {
            status = "success";
            message = `✅ ${currencySymbol}${total.toFixed(2)} paid via ${method}`;
          } else if (result.responseCode === 'UT' || result.responseCode === 'MA') {
            status = "cancelled";
            message = `❌ Transaction cancelled on terminal`;
          } else if (result.responseCode === 'TO') {
            status = "failed";
            message = `⏰ Transaction timeout`;
          } else {
            status = "failed";
            message = `❌ ${result.message || result.responseDesc || 'NETS Payment declined'}`;
          }

          if (ongoingPayments[cacheKey]) {
            ongoingPayments[cacheKey].status = status;
            ongoingPayments[cacheKey].message = message;
          }

          if (context?.tableId) {
            useTerminalPaymentStore.getState().updateSession(context.tableId, { status, message });
          }

          if (status === "success") {
            handleTerminalPaymentSuccess(method, total, message);
          } else if (status === "cancelled") {
            setPaymentMessage(message);
            Alert.alert('❌ Transaction Cancelled', 'Payment was cancelled on the terminal.');
            if (context?.tableId) {
              useTerminalPaymentStore.getState().clearSession(String(context.tableId));
            }
            delete ongoingPayments[cacheKey];
          } else {
            setProcessing(false);
            setPaymentStatus("failed");
            setPaymentMessage(message);
            Alert.alert('❌ Payment Failed', message || 'Failed to complete NETS transaction');
            if (context?.tableId) {
              useTerminalPaymentStore.getState().clearSession(String(context.tableId));
            }
            delete ongoingPayments[cacheKey];
          }
          return result;
        } catch (error: any) {
          console.error('❌ [MainPayment] NETS Terminal error:', error);
          const status = "failed";
          const message = `❌ ${error.message}`;

          if (ongoingPayments[cacheKey]) {
            ongoingPayments[cacheKey].status = status;
            ongoingPayments[cacheKey].message = message;
          }

          if (context?.tableId) {
            useTerminalPaymentStore.getState().updateSession(context.tableId, { status: "failed", message });
          }
          setProcessing(false);
          setPaymentStatus("failed");
          setPaymentMessage(message);
          Alert.alert('❌ Payment Failed', message);
          delete ongoingPayments[cacheKey];
          return { success: false, message: error.message };
        }
      })();

      ongoingPayments[cacheKey] = {
        status: "processing",
        message: "Please follow prompt on NETS terminal...",
        method: method,
        total: total,
        promise: fetchPromise
      };

      if (context?.tableId) {
        useTerminalPaymentStore.getState().setSession(context.tableId, {
          tableId: context.tableId,
          status: "processing",
          message: "Processing on NETS terminal...",
          method: method,
          total: total,
        });
      }

      return;
    }
    // ============================================================
    // REST OF EXISTING CODE
    // ============================================================

    if (isLedgerCollection) {
      const parsedAmt = parseFloat(collectionAmount) || 0;
      if (parsedAmt <= 0) {
        showToast({
          type: "warning",
          message: "Invalid Amount",
          subtitle: "Please enter a positive collection amount.",
        });
        return;
      }
      if (collectAmount !== undefined && parsedAmt > collectAmount + 0.01) {
        showToast({
          type: "warning",
          message: "Overpayment Prevention",
          subtitle: `Cannot exceed outstanding balance of ${currencySymbol}${collectAmount.toFixed(2)}`,
        });
        return;
      }
    }
    if (isLedgerCollection && total <= 0) {
      Alert.alert(
        "No Payment Required",
        `Outstanding balance is ${currencySymbol}${total.toFixed(2)}. No collection payment is required.`,
      );
      return;
    }
    if (
      total > 0 &&
      isCashMethod(method) &&
      paidNum < total &&
      Math.abs(paidNum - total) > 0.01
    ) {
      showToast({
        type: "warning",
        message: "Insufficient Payment",
        subtitle: `Please enter at least ${currencySymbol}${total.toFixed(2)}`,
      });
      return;
    }
    const { settings } = usePaymentSettingsStore.getState();
    const mUpper = method.trim().toUpperCase();
    if (
      mUpper === "MEMBER" ||
      mUpper === "CREDIT" ||
      mUpper === "5" ||
      mUpper === "6"
    ) {
      if (!selectedMember) {
        setShowMemberModal(true);
        return;
      }
      const availableBalance =
        selectedMember.AvailableCredit !== undefined
          ? selectedMember.AvailableCredit
          : (selectedMember.CreditLimit || 0) - (selectedMember.CurrentBalance || 0);
      const isLimitExceeded = total > availableBalance;
      if (isLimitExceeded) {
        const isAdminOrManager =
          user?.role === "ADMIN" || user?.role === "MANAGER";
         if (isAdminOrManager) {
          Alert.alert(
            "Prepaid Amount Exceeded",
            `Transaction total of ${currencySymbol}${total.toFixed(2)} exceeds available balance of ${currencySymbol}${availableBalance.toFixed(2)}. Authorize this sale?`,
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Authorize & Complete",
                onPress: () => executeFinalPayment(),
              },
            ],
          );
        } else {
          showToast({
            type: "error",
            message: "Prepaid Amount Exceeded",
            subtitle: "Manager approval required to override",
          });
        }
      } else {
        executeFinalPayment();
      }
      return;
    }

    // Show static PayNow QR ONLY when the mode is exactly "PAYNOW" (case-insensitive).
    // "Yeahpay Paynow" is already handled above by the isYeahPay block and must
    // NEVER reach this point, but we use an exact match here as a belt-and-suspenders guard.
    if (mUpper === "PAYNOW" && settings.payNowQrUrl) {
      setIsPayNowVisible(true);
      return;
    }

    // Show UPI modal only for the exact UPI-family modes
    if ((mUpper === "UPI") && settings.upiId) {
      setIsUPIVisible(true);
      return;
    }

    executeFinalPayment();
  };
  const executeFinalPayment = async (
    payments?: Array<{
      payModeId: number;
      amount: number;
      referenceNo?: string;
    }>,
    memberOverride?: any,
    focAmount?: number,
    bypassProcessingCheck?: boolean,
  ) => {
    executeFinalPaymentRef.current = executeFinalPayment;
    if (processing && !bypassProcessingCheck) return;
    setProcessing(true);
    if (isLedgerCollection) {
      const selectedMode = paymentMethods.find((m) => m.payMode === method);
      const payModeId = selectedMode ? selectedMode.position || 1 : 1;
      const finalPayments = payments
        ? payments.map((p) => ({
          payModeId: p.payModeId,
          payMode:
            (p as any).payMode ||
            paymentMethods.find((x) => x.position === p.payModeId)?.payMode ||
            "CASH",
          amount: p.amount,
          referenceNo: p.referenceNo || "",
        }))
        : [
          {
            payModeId,
            payMode: method,
            amount: total,
            referenceNo: "",
          },
        ];

      const payEndpoint = isMember
        ? `${API_URL}/api/members/pay`
        : `${API_URL}/api/credit-customers/pay`;

      try {
        const response = await fetch(payEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: useAuthStore.getState().token ? `Bearer ${useAuthStore.getState().token}` : "",
          },
          body: JSON.stringify({
            memberId: memberId,
            amount: total,
            payments: finalPayments,
            allocations: allocationsParam,
            remarks: remarksParam,
            userId: user?.userId,
            paymentSessionId: checkoutSessionId,
          }),
        });

        const result = await response.json();
        if (result.success) {
          router.push({
            pathname: "/payment_success" as any,
            params: {
              total: total.toFixed(2),
              paidNum: (payments && payments.length > 0
                ? total
                : paidNum
              ).toFixed(2),
              change: (payments && payments.length > 0 ? 0 : change).toFixed(
                2,
              ),
              method:
                payments && payments.length > 0 ? "SPLIT" : method.trim(),
              payments: payments ? JSON.stringify(payments) : "[]",
              orderId:
                result.settlementId ||
                result.transactionId ||
                "COLL-" + Date.now(),
              tableNo: "LEDGER",
              section: "",
              orderType: "LEDGER",
              discountInfo: "{}",
              items: "[]",
              roundOff: "0.00",
              serviceCharge: "0.00",
              isSplit: payments && payments.length > 0 ? "true" : "false",
              waiterName: user?.userName || "Cashier",
              isLedgerCollection: "true",
              isMember: isMember ? "true" : "false",
            },
          });
        } else {
          showToast({
            type: "error",
            message: "Failed",
            subtitle: result.error || "Failed to record collection",
          });
        }
      } catch (e: any) {
        console.error("❌ [Ledger Payment Network Failure Details]:", {
          endpoint: payEndpoint,
          message: e?.message || e,
          stack: e?.stack,
          errorObject: e,
          timestamp: new Date().toISOString(),
        });
        showToast({ type: "error", message: "Error", subtitle: e.message });
      } finally {
        setProcessing(false);
      }
      return;
    }
    const tableState = context?.tableId
      ? useTableStatusStore.getState().tableMap[context.tableId.toLowerCase()]
      : null;
      // FOC discount: disabled, FOC is a normal paymode
      const effectiveFocAmount = 0;
      const effectiveDiscountAmount = discountAmount + payItemDiscount;

      const selectedMode = paymentMethods.find(x => x.payMode.toUpperCase().trim() === method.toUpperCase().trim());
      const payModeId = selectedMode ? selectedMode.position || 1 : 1;

      const focMode = paymentMethods.find(x => x.payMode.toUpperCase().trim() === "FOC");
      const focModeId = focMode ? focMode.position || 1 : 1;

      let finalPayments = null;
      let finalTotalAmount = total;

      if (payments && payments.length > 0) {
        finalPayments = payments.map(p => ({
          payModeId: p.payModeId,
          payMode: (p as any).payMode || paymentMethods.find(x => x.position === p.payModeId)?.payMode || "CASH",
          amount: p.amount,
          referenceNo: p.referenceNo || ""
        }));
        finalTotalAmount = payments.reduce((sum, p) => sum + p.amount, 0);
      } else {
        if (method.trim().toUpperCase() === "FOC") {
          const originalTaxableAmount = subtotal + serviceChargeAmt + currentTakeawayCharge;
          const originalTax = originalTaxableAmount * gstRate;
          const originalBillTotal = originalTaxableAmount + originalTax;
          
          let roundedTotal = originalBillTotal;
          if (roundType === "whole") roundedTotal = Math.round(originalBillTotal);
          else if (roundType === "five") roundedTotal = Math.round(originalBillTotal * 20) / 20;

          finalPayments = [{
            payModeId: focModeId,
            payMode: "FOC",
            amount: roundedTotal,
            referenceNo: ""
          }];
          finalTotalAmount = roundedTotal;
        } else {
          finalPayments = [];
          if (totalFocAmount > 0) {
            finalPayments.push({
              payModeId: focModeId,
              payMode: "FOC",
              amount: totalFocAmount,
              referenceNo: ""
            });
          }
          // YeahPay: terminal was already called directly, mark as pre-processed
          const _mNorm = method.trim().toUpperCase();
          const _isYeahPayFinal = _mNorm === "YEAHPAY PAYNOW" || _mNorm === "YEAHPAY CARD";
          finalPayments.push({
            payModeId,
            payMode: method,
            amount: total,
            referenceNo: "",
            isTerminalAlreadyProcessed: _isYeahPayFinal,
          });
          finalTotalAmount = total + totalFocAmount;
        }
      }

      const saleData = {
        settlementId: checkoutSessionId,
        orderId: displayOrderId || activeOrder?.orderId,
        orderType:
          context?.orderType === "DINE_IN"
            ? "DINE-IN"
            : context?.orderType || "DINE-IN",
        tableNo:
          context?.orderType === "TAKEAWAY"
            ? context?.takeawayNo
            : context?.tableNo,
        section: context?.section,
        items: finalItems.map((item: any) => {
          const isItemFoc = item.isFoc || item.IsFoc || false;
          return {
            lineItemId: item.lineItemId,
            dishId: item.dishId || item.DishId || item.id,
            name: item.name,
            songName: item.songName || item.SongName || "",
            qty: item.qty,
            price: item.price,
            status: item.status,
            discountAmount: isItemFoc ? item.price : (item.discountAmount ?? item.discount ?? null),
            discountType: isItemFoc ? "FOC" : (item.discountType ?? null),
            isDishReward: item.isDishReward || false,
            rewardRuleId: item.rewardRuleId || null,
            rewardDishId: item.rewardDishId || null,
            modifiers: item.modifiers || null,
            comboSelections: item.comboSelections || null,
          };
        }),
        subTotal: subtotal,
        taxAmount: displayedTax,
        serviceCharge: displayedServiceCharge,
        takeawayCharge: currentTakeawayCharge,
        discountAmount: effectiveDiscountAmount,
        discountType: effectiveFocAmount > 0 ? "fixed" : (discount?.type || "fixed"),
        totalAmount: finalTotalAmount,
        paymentMethod: finalPayments && finalPayments.length > 1 ? "SPLIT" : (finalPayments && finalPayments[0]?.payMode || method).trim(),
        payments: finalPayments,
        memberId: memberOverride?.MemberId || selectedMember?.MemberId || null,
        roundOff: displayedRoundOff,
        cashierId: user?.userId || user?.userName || user?.userCode || "owner",
        tableId: context?.tableId,
        serverId: context?.serverId,
        serverName: context?.serverName,
        isSplit: !!splitItems,
        splitItems: splitItems,
        discountId: effectiveFocAmount > 0 ? null : (discount?.discountId || null),
        discountPercentage: effectiveFocAmount > 0 ? null : (discount?.type === "percentage" ? discount.value : null),
        discountRemarks: effectiveFocAmount > 0 ? "FOC" : (discount?.label || null),
        orderDiscountAmount: effectiveFocAmount > 0 ? effectiveFocAmount : discountAmount,
        itemDiscountAmount: payItemDiscount,
        customerName: loyaltyName || tableState?.customerName || null,
        mobileNo: loyaltyPhone || null,
        pax: tableState?.pax || null,
        rewardMemberId: rewardMemberId || null,
      };

    try {
      const response = await fetch(`${API_URL}/api/sales/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(useAuthStore.getState().token ? { "Authorization": `Bearer ${useAuthStore.getState().token}` } : {})
        },
        body: JSON.stringify(saleData),
      });
      const result = await response.json();
      if (result.success || response.status === 409) {
        // Navigate first — let the success screen mount fully before mutating store state
        router.push({
          pathname: "/payment_success" as any,
          params: {
            total: finalTotalAmount.toFixed(2),
            paidNum: (payments && payments.length > 0
              ? finalTotalAmount
              : paidNum
            ).toFixed(2),
            change: (payments && payments.length > 0 ? 0 : change).toFixed(2),
            method: payments && payments.length > 0 ? "SPLIT" : method.trim(),
            payments: payments ? JSON.stringify(payments) : "[]",
            orderId: result.billNo || result.orderId || displayOrderId || "",
            tableNo: context?.tableNo ?? "",
            section: context?.section || (context?.orderType === "TAKEAWAY" ? "TAKEAWAY" : ""),
            orderType: context?.orderType ?? "",
            discountInfo: JSON.stringify(
              effectiveFocAmount > 0
                ? { applied: true, type: "fixed", value: effectiveFocAmount + discountAmount, amount: effectiveFocAmount + discountAmount, label: "FOC", subtotal }
                : (discount?.applied && discountAmount > 0
                  ? { ...discount, amount: discountAmount, subtotal }
                  : {})
            ),
            items: JSON.stringify(finalItems || []),
            roundOff: displayedRoundOff.toFixed(2),
            serviceCharge: displayedServiceCharge.toFixed(2),
            takeawayCharge: currentTakeawayCharge.toFixed(2),
            isSplit: splitItems ? "true" : "false",
            waiterName: context?.serverName ?? "",
            rewardPointsEarned: String(result.rewardPointsEarned || 0),
            memberRewardBalance: String(result.memberRewardBalance || 0),
            mobileNo: loyaltyPhone || "",
            tableId: context?.tableId ? String(context.tableId) : "",
          },
        });
        const ctxSnapshot = context;
        const splitSnapshot = splitItems;
        const orderIdSnapshot = displayOrderId;
        const isOrderClosedFromResponse = !!result.isOrderClosed;
        
        setTimeout(() => {
          if (ctxSnapshot) {
            if (splitSnapshot) {
              const { splitPartsCount, setSplitPartsCount, setActiveSplitItems } =
                useCartStore.getState();

              if (isOrderClosedFromResponse || splitPartsCount === 1) {
                // All items paid/closed, do full table cleanup
                setSplitPartsCount(null);
                setActiveSplitItems(null);

                if (ctxSnapshot.orderType === "DINE_IN") {
                  clearTable(ctxSnapshot.section!, ctxSnapshot.tableNo!);
                }

                if (ctxSnapshot.tableId) {
                  const tblIdStr = String(ctxSnapshot.tableId);
                  useCartStore.getState().clearTableSession(tblIdStr);
                  useTableNavigationStore.getState().clearTableLastScreen(tblIdStr);
                  useTableNavigationStore.getState().clearSelectedMethod(tblIdStr);
                  useTerminalPaymentStore.getState().clearSession(tblIdStr);
                  delete ongoingPayments[tblIdStr];
                  closeActiveOrder(orderIdSnapshot || "");
                }

                useOrderContextStore.getState().clearOrderContext();
              } else {
                // Still has items or parts left: decrement parts count if split by parts
                if (splitPartsCount && splitPartsCount > 1) {
                  setSplitPartsCount(splitPartsCount - 1);
                }
                setActiveSplitItems(null);
              }
            } else {
              // Normal payment cleanup
              if (ctxSnapshot.orderType === "DINE_IN") {
                clearTable(ctxSnapshot.section!, ctxSnapshot.tableNo!);
              }

              if (ctxSnapshot.tableId) {
                const tblIdStr = String(ctxSnapshot.tableId);
                useCartStore.getState().clearTableSession(tblIdStr);
                useTableNavigationStore.getState().clearTableLastScreen(tblIdStr);
                useTableNavigationStore.getState().clearSelectedMethod(tblIdStr);
                useTerminalPaymentStore.getState().clearSession(tblIdStr);
                delete ongoingPayments[tblIdStr];
                closeActiveOrder(orderIdSnapshot || "");
              }

              useOrderContextStore.getState().clearOrderContext();
            }
          }
          setPaymentStatus("idle");
          setPaymentMessage("");
          setProcessing(false);
        }, 50);
      } else {
        const lockKey = (context?.tableId || displayOrderId || "MAIN_PAYMENT_LOCK").toString();
        delete finalizationLockRef.current[lockKey];
        showToast({ type: "error", message: "Failed", subtitle: result.error });
      }
    } catch (e: any) {
      const lockKey = (context?.tableId || displayOrderId || "MAIN_PAYMENT_LOCK").toString();
      delete finalizationLockRef.current[lockKey];
      console.error("❌ [Sales Checkout Network Failure Details]:", {
        endpoint: `${API_URL}/api/sales/save`,
        message: e?.message || e,
        stack: e?.stack,
        errorObject: e,
        timestamp: new Date().toISOString(),
      });
      showToast({ type: "error", message: "Error", subtitle: e.message });
    } finally {
      setProcessing(false);
    }
  };

  const getDisplayUrl = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      return window.location.origin + "/customer-display";
    }
    if (API_URL && API_URL.startsWith("http")) {
      const match = API_URL.match(/^https?:\/\/([^:/]+)/);
      if (match && match[1]) {
        const host = match[1];
        if (host.includes("railway") || host.includes("production")) {
          return "https://pos-v-20-production.up.railway.app/customer-display";

        }
        return `http://${host}:8081/customer-display`;
      }
    }
    return "http://localhost:8081/customer-display";
  };

  const openCustomerDisplay = () => {
    const url = getDisplayUrl();
    if (Platform.OS === "web") {
      window.open(url, "_blank");
    } else {
      const { Linking } = require("react-native");
      Linking.openURL(url).catch((err: any) => {
        Alert.alert("Error", "Could not open browser: " + err.message);
      });
    }
  };

  const triggerTestSync = (
    type: "current" | "large_mock" | "success" | "idle",
  ) => {
    if (type === "current") {
      if (context && finalItems.length > 0) {
        CustomerDisplaySync.syncCart({
          orderContext: context,
          cart: finalItems,
          discountInfo: discount,
          gstPercentage: settingsStore.gstPercentage || 0,
          roundOff: roundOff,
          active: true,
          orderId: displayOrderId,
          paymentMethod: method,
        });
        showToast({
          type: "info",
          message: "Synced Current Cart",
          subtitle: "Sent checkout state to customer display",
        });
      } else {
        showToast({
          type: "warning",
          message: "Cart is Empty",
          subtitle: "Cannot sync empty cart to checkout",
        });
      }
    } else if (type === "large_mock") {
      const mockItems = [
        {
          id: "m1",
          name: "Premium Wagyu Beef Burger",
          qty: 2,
          price: 18.9,
          status: "SERVED",
          discountAmount: 10,
          discountType: "percentage",
        },
        {
          id: "m2",
          name: "Truffle Parmesan Fries",
          qty: 1,
          price: 8.5,
          status: "SERVED",
        },
        {
          id: "m3",
          name: "Classic Caesar Salad",
          qty: 1,
          price: 12.0,
          status: "SERVED",
          discountAmount: 2,
          discountType: "fixed",
        },
        {
          id: "m4",
          name: "Craft IPA Beer Pint",
          qty: 3,
          price: 14.5,
          status: "SERVED",
        },
        {
          id: "m5",
          name: "Salted Caramel Milkshake",
          qty: 1,
          price: 7.9,
          status: "SERVED",
        },
        {
          id: "m6",
          name: "New York Cheesecake",
          qty: 2,
          price: 9.0,
          status: "SERVED",
        },
        {
          id: "m7",
          name: "Espresso Macchiato",
          qty: 1,
          price: 4.5,
          status: "SERVED",
        },
        {
          id: "m8",
          name: "Sparkling Mineral Water",
          qty: 2,
          price: 3.5,
          status: "SERVED",
        },
      ];
      CustomerDisplaySync.syncCart({
        orderContext: {
          tableNo: "T12",
          orderType: "DINE_IN",
          section: "Main Dining",
          serverName: "Alex",
        },
        cart: mockItems,
        discountInfo: {
          applied: true,
          type: "percentage",
          value: 10,
          label: "10% Grand Opening",
        },
        gstPercentage: settingsStore.gstPercentage || 9,
        roundOff: 0.05,
        active: true,
        orderId: "MOCK-889",
      });
      showToast({
        type: "info",
        message: "Synced Mock Large Cart",
        subtitle: "Sent mock checkout state to customer display",
      });
    } else if (type === "success") {
      CustomerDisplaySync.syncPaymentSuccess({
        orderId: "BILL-2026-987",
        total: 125.8,
        paid: 150.0,
        change: 24.2,
        method: "CASH",
      });
      showToast({
        type: "info",
        message: "Synced Payment Success",
        subtitle: "Sent payment success state to customer display",
      });
    } else if (type === "idle") {
      CustomerDisplaySync.syncIdle();
      showToast({
        type: "info",
        message: "Synced Idle State",
        subtitle: "Customer display set to idle attract loop",
      });
    }
    setIsTestModalVisible(false);
  };

  const renderQuickCashEditorModal = () => (
    <Modal
      visible={isEditingQuickCash}
      transparent
      animationType="fade"
      onRequestClose={() => setIsEditingQuickCash(false)}
    >
      <TouchableWithoutFeedback onPress={() => setIsEditingQuickCash(false)}>
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback>
            <View style={[styles.adjustModalContent, { maxWidth: 340 }]}>
              <View style={styles.adjustModalHeader}>
                <Text style={styles.adjustModalTitle}>Edit Quick Cash Buttons</Text>
                <TouchableOpacity onPress={() => setIsEditingQuickCash(false)}>
                  <Ionicons name="close" size={22} color={Theme.textMuted} />
                </TouchableOpacity>
              </View>

              <Text
                style={{
                  color: Theme.textMuted,
                  fontSize: 12,
                  marginBottom: 14,
                  lineHeight: 18,
                }}
              >
                Set your 6 quick-cash shortcut amounts. Tap Save to apply.
              </Text>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                {quickCashDraft.map((val, idx) => (
                  <View key={idx} style={{ width: "30%" }}>
                    <Text
                      style={{
                        color: Theme.textMuted,
                        fontSize: 11,
                        marginBottom: 4,
                      }}
                    >
                      Button {idx + 1}
                    </Text>
                    <View
                      style={[
                        styles.cashInputBox,
                        { paddingVertical: 6, paddingHorizontal: 8 },
                      ]}
                    >
                      <Text style={styles.currencyPrefix}>{currencySymbol}</Text>
                      <TextInput
                        style={[
                          styles.cashInput,
                          { fontSize: 14, flex: 1, minWidth: 0 },
                        ]}
                        value={val}
                        onChangeText={(t) => {
                          const next = [...quickCashDraft];
                          next[idx] = t;
                          setQuickCashDraft(next);
                        }}
                        keyboardType="numeric"
                        placeholder="0"
                        {...Platform.select({
                          web: { outlineStyle: "none" } as any,
                        })}
                      />
                    </View>
                  </View>
                ))}
              </View>

              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "flex-end",
                  gap: 10,
                  marginTop: 20,
                }}
              >
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => setIsEditingQuickCash(false)}
                >
                  <Text style={{ color: Theme.textMuted, fontFamily: Fonts.medium }}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmBtn, { paddingHorizontal: 20 }]}
                  onPress={saveQuickCash}
                >
                  <Text
                    style={{ color: "#fff", fontFamily: Fonts.semiBold, fontSize: 14 }}
                  >
                    Save
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );

  const renderTestDisplayModal = () => (
    <Modal
      visible={isTestModalVisible}

      transparent
      animationType="fade"
      onRequestClose={() => setIsTestModalVisible(false)}
    >
      <TouchableWithoutFeedback onPress={() => setIsTestModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback>
            <View style={[styles.adjustModalContent, { maxHeight: "90%" }]}>
              <View style={styles.adjustModalHeader}>
                <Text style={styles.adjustModalTitle}>
                  Customer Display Tester
                </Text>
                <TouchableOpacity onPress={() => setIsTestModalVisible(false)}>
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 10 }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    color: Theme.textSecondary,
                    fontFamily: Fonts.medium,
                    marginBottom: 16,
                  }}
                >
                  Simulate different screens on the customer display to test
                  responsiveness, scrolling, and layouts.
                </Text>
                <View style={styles.adjustPresets}>
                  <TouchableOpacity
                    style={styles.presetItem}
                    onPress={() => triggerTestSync("current")}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <Ionicons
                        name="cart-outline"
                        size={20}
                        color={Theme.primary}
                      />
                      <View>
                        <Text style={styles.presetLabel}>
                          Sync Current Cart
                        </Text>
                        <Text style={{ fontSize: 11, color: Theme.textMuted }}>
                          Send active bill detail
                        </Text>
                      </View>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={Theme.textMuted}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.presetItem}
                    onPress={() => triggerTestSync("large_mock")}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <Ionicons
                        name="list-outline"
                        size={20}
                        color={Theme.primary}
                      />
                      <View>
                        <Text style={styles.presetLabel}>
                          Sync Mock Large Cart
                        </Text>
                        <Text style={{ fontSize: 11, color: Theme.textMuted }}>
                          Test list scrolling & totals
                        </Text>
                      </View>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={Theme.textMuted}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.presetItem}
                    onPress={() => triggerTestSync("success")}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <Ionicons
                        name="checkmark-done-circle-outline"
                        size={20}
                        color={Theme.success || "#10B981"}
                      />
                      <View>
                        <Text style={styles.presetLabel}>
                          Sync Payment Success
                        </Text>
                        <Text style={{ fontSize: 11, color: Theme.textMuted }}>
                          Test thank you & QR code
                        </Text>
                      </View>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={Theme.textMuted}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.presetItem}
                    onPress={() => triggerTestSync("idle")}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <Ionicons
                        name="images-outline"
                        size={20}
                        color={Theme.warning || "#F59E0B"}
                      />
                      <View>
                        <Text style={styles.presetLabel}>
                          Reset to Idle State
                        </Text>
                        <Text style={{ fontSize: 11, color: Theme.textMuted }}>
                          Test attract animation loop
                        </Text>
                      </View>
                    </View>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={Theme.textMuted}
                    />
                  </TouchableOpacity>
                </View>

                <View style={styles.separator} />

                <View style={styles.linkSection}>
                  <Text style={styles.linkTitle}>Test on Another Device</Text>
                  <Text style={styles.linkSub}>
                    Scan this QR code with your phone/tablet on the same Wi-Fi,
                    or click the button below to view the customer screen.
                  </Text>

                  <View style={styles.qrContainer}>
                    <QRCode
                      value={getDisplayUrl()}
                      size={120}
                      color={Theme.textPrimary}
                      backgroundColor="#fff"
                    />
                  </View>

                  <Text style={styles.urlText} selectable>
                    {getDisplayUrl()}
                  </Text>

                  <TouchableOpacity
                    style={styles.openBtn}
                    onPress={openCustomerDisplay}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="open-outline" size={16} color="#fff" />
                    <Text style={styles.openBtnText}>
                      Open Customer Display
                    </Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );

  const renderAdjustmentModal = () => (
    <Modal
      visible={isAdjustmentModalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setIsAdjustmentModalVisible(false)}
    >
      <TouchableWithoutFeedback
        onPress={() => setIsAdjustmentModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback>
            <View style={styles.adjustModalContent}>
              <View style={styles.adjustModalHeader}>
                <Text style={styles.adjustModalTitle}>Bill Adjustment</Text>
                <TouchableOpacity
                  onPress={() => setIsAdjustmentModalVisible(false)}
                >
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>
              <View style={styles.adjustPresets}>
                {[
                  {
                    label: "Singapore Standard",
                    value: "Nearest .05",
                    mode: "five" as const,
                    target: Math.round(baseTotal * 20) / 20,
                  },
                  {
                    label: "Quick Round",
                    value: "Nearest .10",
                    mode: "ten" as const,
                    target: Math.round(baseTotal * 10) / 10,
                  },
                  {
                    label: "Premium Nett",
                    value: "Whole Dollar",
                    mode: "whole" as const,
                    target: Math.round(baseTotal),
                  },
                ].map((p) => (
                  <TouchableOpacity
                    key={p.mode}
                    style={styles.presetItem}
                    onPress={() => {
                      setRoundOff(p.target - baseTotal);
                      setRoundType(p.mode);
                      if (method === "CAS") setCashInput(p.target.toFixed(2));
                      setIsAdjustmentModalVisible(false);
                    }}
                  >
                    <Text style={styles.presetLabel}>{p.label}</Text>
                    <Text style={styles.presetValue}>{p.value}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.customInputSection}>
                <Text style={styles.inputLabel}>Custom Adjustment Amount</Text>
                <View style={styles.customInputRow}>
                  <TextInput
                    style={styles.adjustTextInput}
                    placeholder="0.00"
                    keyboardType="numeric"
                    value={customValue}
                    onChangeText={setCustomValue}
                  />
                  <TouchableOpacity
                    style={styles.applyBtn}
                    onPress={() => {
                      const n = parseFloat(customValue);
                      if (!isNaN(n)) {
                        setRoundOff(n);
                        setRoundType("custom");
                        if (method === "CAS")
                          setCashInput((baseTotal + n).toFixed(2));
                        setIsAdjustmentModalVisible(false);
                      }
                    }}
                  >
                    <Text style={styles.applyBtnText}>Apply</Text>
                  </TouchableOpacity>
                </View>
              </View>
              <TouchableOpacity
                style={styles.resetBtnFull}
                onPress={() => {
                  setRoundOff(0);
                  setRoundType(null);
                  if (method === "CAS") setCashInput(baseTotal.toFixed(2));
                  setIsAdjustmentModalVisible(false);
                }}
              >
                <Text style={styles.resetBtnText}>Reset to Original Bill</Text>
              </TouchableOpacity>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );

  const renderItem = ({ item }: { item: any }) => {
    const isVoided = item.status === "VOIDED" || item.isVoided;
    const baseTotal = (item.price || 0) * item.qty;
    const discountVal = Number(item.discountAmount ?? item.discount ?? 0);
    const discountType = item.discountType || "percentage";
    const isCombo = item.isCombo === true || String(item.isCombo) === "1" || item.isCombo === 1;
    const discountBasis = isCombo ? (item.basePrice ?? item.price ?? 0) : (item.price ?? 0);
    const isFixed = discountType === "fixed" || (discountType === "percentage" && !item.discount && item.discountAmount > 0);

    const itemDiscount = isFixed
      ? Math.min(discountVal, discountBasis) * item.qty
      : baseTotal * (discountVal / 100);

    const finalPrice = baseTotal - itemDiscount;

    const isTakeawayItem = item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway;
    const isSC =
      !isTakeawayItem && (Number(item.isServiceCharge) === 1 || item.isServiceCharge === true) && useGeneralSettingsStore.getState().settings.SVCIdentification !== false;

    return (
      <View
        style={[
          styles.itemRow,
          isSC && {
            borderWidth: 1.5,
            borderColor: Theme.dangerBorder,
            backgroundColor: Theme.dangerBg,
            borderRadius: 8,
            marginVertical: 4,
            paddingHorizontal: 8,
          },
        ]}
      >
        <Text style={[styles.itemQty, isVoided && styles.itemVoidedText]}>
          {formatQty(item.qty)}x
        </Text>
        <View style={{ flex: 1, paddingRight: 8 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <Text
              style={[
                styles.itemName,
                { flex: undefined },
                isVoided && styles.itemVoidedText,
              ]}
              numberOfLines={2}
            >
              {item.name}
              {isVoided && " (VOIDED)"}
            </Text>
            {item.isTakeaway && (
              <View style={styles.itemTwBadge}>
                <Text style={styles.itemTwBadgeText}>TW</Text>
              </View>
            )}
          </View>

          {(item.spicy && item.spicy !== "Medium") ||
            (item.oil && item.oil !== "Normal") ||
            (item.salt && item.salt !== "Normal") ||
            (item.sugar && item.sugar !== "Normal") ||
            item.note ? (
            <Text style={styles.itemSubText} numberOfLines={2}>
              {[
                item.spicy && item.spicy !== "Medium" ? `🌶 ${item.spicy}` : "",
                item.oil && item.oil !== "Normal" ? `Oil: ${item.oil}` : "",
                item.salt && item.salt !== "Normal" ? `Salt: ${item.salt}` : "",
                item.sugar && item.sugar !== "Normal"
                  ? `Sugar: ${item.sugar}`
                  : "",
                item.note ? `📝 ${item.note}` : "",
              ]
                .filter(Boolean)
                .join("  ·  ")}
            </Text>
          ) : null}

          {item.modifiers &&
            Array.isArray(item.modifiers) &&
            item.modifiers.length > 0 && (
              <Text style={styles.itemSubText} numberOfLines={2}>
                {item.modifiers
                  .map((m: any) => `+ ${m.ModifierName}`)
                  .join("  ·  ")}
              </Text>
            )}
          {isSC && settingsStore.serviceChargePercentage > 0 && !isVoided && !scReduced && (
            <Text
              style={[
                styles.itemSubText,
                { color: Theme.primary, fontFamily: Fonts.bold, marginTop: 4 },
              ]}
            >
              Item Service Charge ({settingsStore.serviceChargePercentage}%):{" "}
              {currencySymbol}
              {(
                (baseTotal - itemDiscount) *
                (settingsStore.serviceChargePercentage / 100)
              ).toFixed(2)}
            </Text>
          )}
        </View>

        <View style={{ alignItems: "flex-end", justifyContent: "center" }}>
          {discountVal > 0 && !isVoided && (
            <View style={styles.itemDiscountRow}>
              <Text style={styles.itemOriginalPrice}>
                {currencySymbol}
                {baseTotal.toFixed(2)}
              </Text>
              <View style={styles.itemDiscountBadge}>
                <Text style={styles.itemDiscountBadgeText}>
                  {isFixed
                    ? `-${currencySymbol}${Math.min(discountVal, discountBasis).toFixed(2)}`
                    : `-${discountVal}%`}
                </Text>
              </View>
            </View>
          )}
          <Text style={[styles.itemPrice, isVoided && styles.itemVoidedText]}>
            {currencySymbol}
            {finalPrice.toFixed(2)}
          </Text>
        </View>
      </View>
    );
  };

  if (!context && !isLedgerCollection) return null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => {
              if (generalSettings?.enableSkipSummaryScreen) {
                router.replace("/menu/thai_kitchen");
              } else {
                router.replace("/summary");
              }
            }}
          >
            <Ionicons name="arrow-back" size={24} color={Theme.textSecondary} />
          </TouchableOpacity>
          <View style={styles.orderInfo}>
            <Text style={styles.orderTitle}>
              {isLedgerCollection ? "Ledger Collection" : "Checkout"}
            </Text>
            <View style={styles.orderBadgeRow}>
              <View
                style={[
                  styles.typeBadge,
                  {
                    backgroundColor: isLedgerCollection
                      ? Theme.success + "20"
                      : context?.orderType === "DINE_IN"
                        ? Theme.primaryLight
                        : Theme.warningBg,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.typeBadgeText,
                    {
                      color: isLedgerCollection
                        ? Theme.success
                        : context?.orderType === "DINE_IN"
                          ? Theme.primary
                          : Theme.warning,
                    },
                  ]}
                >
                  {isLedgerCollection
                    ? "LEDGER COLLECTION"
                    : context?.orderType === "DINE_IN"
                      ? "DINE-IN"
                      : "TAKEAWAY"}
                </Text>
              </View>
              {isLedgerCollection ? (
                <View style={styles.tableBadge}>
                  <Text style={styles.tableBadgeText}>{memberName}</Text>
                </View>
              ) : (
                context?.orderType === "DINE_IN" && (
                  <View style={styles.tableBadge}>
                    <Text style={styles.tableBadgeText}>
                      {formatSection(context?.section || "")} • T
                      {context?.tableNo}
                    </Text>
                  </View>
                )
              )}
              <Text style={styles.orderSub}>
                #
                {isLedgerCollection
                  ? memberPhone || "LEDGER"
                  : displayOrderId || "NEW"}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <WindowControls buttonStyle={styles.backBtn} />
            <TouchableOpacity
              style={[
                styles.backBtn,
                { borderColor: Theme.primaryBorder },
                isSplitActive && {
                  backgroundColor: Theme.primary,
                  borderColor: Theme.primary,
                },
                !isMobile && {
                  width: 160,
                  paddingHorizontal: 12,
                  flexDirection: "row",
                  gap: 6,
                },
              ]}
              onPress={() => {
                const nextActive = !isSplitActive;
                setIsSplitActive(nextActive);
                if (context?.tableId) {
                  useTerminalPaymentStore.getState().setSplitTableActive(context.tableId, nextActive);
                }
              }}
              activeOpacity={0.7}
            >
              <Ionicons
                name="git-compare-outline"
                size={20}
                color={isSplitActive ? "#fff" : Theme.primary}
              />
              {!isMobile && (
                <Text
                  style={{
                    color: isSplitActive ? "#fff" : Theme.primary,
                    fontFamily: Fonts.bold,
                    fontSize: 14,
                  }}
                  numberOfLines={1}
                >
                  Split Paymode
                </Text>
              )}
            </TouchableOpacity>

          </View>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ flexGrow: 1 }}
          >
            <View
              style={[
                styles.mainLayout,
                isLandscape && { flexDirection: "row" },
              ]}
            >
              <View
                style={[
                  styles.leftPane,
                  isLandscape && { flex: 1.2, paddingRight: 20 },
                ]}
              >
                {!showOrderPanel && (
                  <View style={styles.mobileSummaryCard}>
                    <View style={styles.mobileSummaryRow}>
                      <View>
                        <Text style={styles.mobileSummaryLabel}>
                          AMOUNT DUE
                        </Text>
                        <Text style={styles.mobileSummaryTotal}>
                          {currencySymbol}
                          {total.toFixed(2)}
                        </Text>
                      </View>
                      {isCashMethod(method) && (
                        <TouchableOpacity
                          style={styles.mobileAdjustBtn}
                          onPress={() => setIsAdjustmentModalVisible(true)}
                        >
                          <Ionicons
                            name="options-outline"
                            size={20}
                            color={Theme.primary}
                          />
                          <Text style={styles.mobileAdjustText}>Adjust</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                    {(discount?.applied || discountAmount > 0) && (
                      <View
                        style={[
                          styles.mobileSummaryRow,
                          {
                            marginTop: 10,
                            paddingTop: 10,
                            borderTopWidth: 1,
                            borderTopColor: Theme.border + "40",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.mobileSummaryLabel,
                            { color: Theme.danger },
                          ]}
                        >
                          DISCOUNT
                        </Text>
                        <Text
                          style={[
                            styles.mobileSummaryTotal,
                            { fontSize: 18, color: Theme.danger },
                          ]}
                        >
                          -{currencySymbol}
                          {discountAmount.toFixed(2)}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
                {isSplitActive ? (
                  <SplitPaymentComponent
                    targetTotal={total}
                    paymentMethods={paymentMethods.map((pm) => ({
                      payMode: pm.payMode,
                      description: pm.description,
                      position: pm.position,
                      deviceSn: pm.deviceSn || '',
                      deviceSalt: pm.deviceSalt || '',
                      yeahPayEnabled: pm.yeahPayEnabled,
                    }))}
                    selectedMember={selectedMember}
                    onSelectMember={(mode) => {
                      if (mode) {
                        setMethod(mode);
                        // 💾 Persist member-selected mode
                        const tableId = useOrderContextStore.getState().currentOrder?.tableId;
                        if (tableId) {
                          useTableNavigationStore.getState().setSelectedMethod(tableId.toString(), mode);
                        }
                      }
                      setShowMemberModal(true);
                    }}
                    onComplete={(finalPayments) => {
                      executeFinalPayment(finalPayments, undefined, undefined);
                    }}
                    onCancel={() => setIsSplitActive(false)}
                    processing={processing}
                    currencySymbol={currencySymbol}
                  />
                ) : (
                  <>
                    <View style={styles.sectionHeader}>
                      <Text style={styles.sectionTitle}>
                        Select Payment Method
                      </Text>
                    </View>
                    {loadingMethods ? (
                      <View
                        style={{
                          height: 100,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <ActivityIndicator size="large" color={Theme.primary} />
                        <Text
                          style={{
                            marginTop: 8,
                            fontSize: 13,
                            fontFamily: Fonts.medium,
                            color: Theme.textSecondary,
                          }}
                        >
                          Loading methods...
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.methodsGrid}>
                        {paymentMethods.map((m) => {
                          const isYeahPay = m.yeahPayEnabled === true;
                          const isSelected = method === m.payMode;

                          return (
                            <TouchableOpacity
                              key={m.payMode}
                              style={[
                                styles.methodCard,
                                isSelected && styles.activeMethodCard,
                                !isSelected && isYeahPay && styles.yeahpayMethodCard,
                                isMobile && { width: "30%", height: 80 },
                              ]}
                              onPress={() => handleSelectMethod(m)}
                            >
                              <View
                                style={[
                                  styles.methodIconBox,
                                  isSelected && styles.activeIconBox,
                                  isMobile && { width: 30, height: 30 },
                                ]}
                              >
                                <FontAwesome5
                                  name={m.icon}
                                  size={isMobile ? 16 : 20}
                                  color={
                                    isSelected ? "#fff" :
                                      Theme.primary
                                  }
                                />
                              </View>
                              <Text
                                style={[
                                  styles.methodLabel,
                                  isSelected && styles.activeMethodLabel,
                                  !isSelected && isYeahPay && styles.yeahpayLabel,
                                  isMobile && { fontSize: 10 },
                                ]}
                              >
                                {m.description}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                    {paymentStatus !== "idle" && (
                      <View style={[
                        styles.statusContainer,
                        paymentStatus === "success" && styles.statusSuccess,
                        paymentStatus === "cancelled" && styles.statusCancelled,
                        paymentStatus === "failed" && styles.statusFailed,
                        paymentStatus === "processing" && styles.statusProcessing,
                        { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }
                      ]}>
                        <View style={{ flexDirection: "row", alignItems: "center", flex: 1, gap: 8 }}>
                          {paymentStatus === "processing" ? (
                            <RotatingSyncIcon size={24} color="#3b82f6" />
                          ) : (
                            <Ionicons
                              name={
                                paymentStatus === "success" ? "checkmark-circle" :
                                  paymentStatus === "cancelled" ? "close-circle" :
                                    "alert-circle"
                              }
                              size={24}
                              color={
                                paymentStatus === "success" ? "#22c55e" :
                                  paymentStatus === "cancelled" ? "#f59e0b" :
                                    "#ef4444"
                              }
                            />
                          )}
                          <Text style={[
                            styles.statusMessage,
                            paymentStatus === "success" && styles.statusMessageSuccess,
                            paymentStatus === "cancelled" && styles.statusMessageCancelled,
                            paymentStatus === "failed" && styles.statusMessageFailed,
                            paymentStatus === "processing" && styles.statusMessageProcessing,
                            { flex: 1, marginRight: 8 }
                          ]}>
                            {paymentMessage}
                          </Text>
                        </View>
                        {paymentStatus !== "processing" && (
                          <TouchableOpacity
                            onPress={() => {
                              if (context?.tableId) {
                                useTerminalPaymentStore.getState().clearSession(context.tableId);
                              }
                            }}
                            style={{ padding: 4 }}
                          >
                            <Ionicons name="close" size={20} color="#64748b" />
                          </TouchableOpacity>
                        )}
                      </View>
                    )}

                    {(method.trim().toUpperCase() === "MEMBER" ||
                      method.trim().toUpperCase() === "CREDIT") && (
                        <View style={styles.creditMemberSection}>
                          <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>
                              {method.trim().toUpperCase() === "CREDIT"
                                ? "Credit Customer Account"
                                : "Member Account"}
                            </Text>
                          </View>

                          {selectedMember ? (
                            <View style={styles.selectedCreditCard}>
                              <View
                                style={{
                                  flexDirection: "row",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                }}
                              >
                                <View
                                  style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 10,
                                  }}
                                >
                                  <View style={styles.creditIconBadge}>
                                    <FontAwesome5
                                      name="user-tag"
                                      size={14}
                                      color="#fff"
                                    />
                                  </View>
                                  <View>
                                    <Text style={styles.creditCardName}>
                                      {selectedMember.Name}
                                    </Text>
                                    <Text style={styles.creditCardPhone}>
                                      {selectedMember.Phone}
                                    </Text>
                                  </View>
                                </View>
                                <TouchableOpacity
                                  style={styles.changeCreditBtn}
                                  onPress={() => setShowMemberModal(true)}
                                >
                                  <Text style={styles.changeCreditBtnText}>
                                    Change
                                  </Text>
                                </TouchableOpacity>
                              </View>

                              {(() => {
                                const selectedAvailCredit =
                                  selectedMember.AvailableCredit !== undefined
                                    ? selectedMember.AvailableCredit
                                    : (selectedMember.CreditLimit || 0) -
                                      (selectedMember.CurrentBalance || 0);
                                const isSelectedLimitExceeded = total > selectedAvailCredit;
                                return (
                                <View style={styles.creditCardStatsRow}>
                                  <View style={styles.creditStatCol}>
                                    <Text style={styles.creditStatLabel}>
                                      Available Balance
                                    </Text>
                                    <Text
                                      style={[
                                        styles.creditStatValue,
                                        {
                                          color: isSelectedLimitExceeded
                                            ? Theme.danger
                                            : Theme.success,
                                        },
                                      ]}
                                    >
                                      {formatMoney(
                                        currencySymbol,
                                        selectedAvailCredit,
                                      )}
                                    </Text>
                                  </View>
                                  <View style={styles.creditStatCol}>
                                    <Text style={styles.creditStatLabel}>
                                      Prepaid Amount
                                    </Text>
                                    <Text style={styles.creditStatValue}>
                                      {formatMoney(
                                        currencySymbol,
                                        selectedMember.CreditLimit || 0,
                                      )}
                                    </Text>
                                  </View>
                                  <View style={styles.creditStatCol}>
                                    <Text style={styles.creditStatLabel}>
                                      Consumed
                                    </Text>
                                    <Text style={styles.creditStatValue}>
                                      {formatMoney(
                                        currencySymbol,
                                        selectedMember.CurrentBalance || 0,
                                      )}
                                    </Text>
                                  </View>
                                </View>
                              );
                            })()}

                            {(() => {
                              const selectedAvailCredit =
                                selectedMember.AvailableCredit !== undefined
                                  ? selectedMember.AvailableCredit
                                  : (selectedMember.CreditLimit || 0) -
                                    (selectedMember.CurrentBalance || 0);
                              const isSelectedLimitExceeded = total > selectedAvailCredit;
                              return isSelectedLimitExceeded ? (
                                <View style={styles.limitExceededBanner}>
                                  <Ionicons
                                    name="alert-circle"
                                    size={16}
                                    color={Theme.danger}
                                  />
                                  <Text style={styles.limitExceededText}>
                                    Transaction exceeds Prepaid Amount by{" "}
                                    {formatMoney(
                                      currencySymbol,
                                      total - selectedAvailCredit,
                                    )}
                                  </Text>
                                </View>
                              ) : null;
                            })()}
                          </View>
                          ) : (
                            <TouchableOpacity
                              style={styles.selectCreditPrompt}
                              onPress={() => setShowMemberModal(true)}
                              activeOpacity={0.7}
                            >
                              <View style={styles.selectCreditPromptInner}>
                                <Ionicons
                                  name="search-outline"
                                  size={24}
                                  color={Theme.primary}
                                />
                                <Text style={styles.selectCreditPromptTitle}>
                                  No Customer Selected
                                </Text>
                                <Text style={styles.selectCreditPromptSub}>
                                  Tap here to search existing or quick-add a new
                                  credit customer
                                </Text>
                              </View>
                            </TouchableOpacity>
                          )}
                        </View>
                      )}

                    {isCashMethod(method) && (
                      <View style={styles.cashSection}>
                        <View style={styles.sectionHeader}>
                          <Text style={styles.sectionTitle}>Cash Received</Text>
                          {generalSettings.enableCashDrawer && (
                            <TouchableOpacity
                              onPress={openQuickCashEditor}
                              style={{ padding: 4, marginLeft: 6 }}
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            >
                              <Ionicons
                                name="pencil"
                                size={14}
                                color={Theme.primary}
                              />
                            </TouchableOpacity>
                          )}
                        </View>
                        <View style={styles.cashInputBox}>
                          <Text style={styles.currencyPrefix}>
                            {currencySymbol}
                          </Text>
                          <TextInput
                            style={styles.cashInput}
                            value={cashInput}
                            onChangeText={setCashInput}
                            keyboardType="numeric"
                            placeholder="0.00"
                            {...Platform.select({
                              web: { outlineStyle: "none" } as any,
                            })}
                          />
                        </View>
                        <View style={styles.quickCashContainer}>
                          {quickCash.map((v) => {
                            const isSelected = parseFloat(cashInput) === v;
                            return (
                              <TouchableOpacity
                                key={v}
                                style={[
                                  styles.quickCashBtn,
                                  isSelected && styles.activeQuickCashBtn,
                                ]}
                                onPress={() => setCashInput(v.toString())}
                              >
                                <Text
                                  style={[
                                    styles.quickCashText,
                                    isSelected && styles.activeQuickCashText,
                                  ]}
                                >
                                  {currencySymbol}
                                  {v}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                          {(() => {
                            const isExact =
                              Math.abs(parseFloat(cashInput) - total) < 0.01;
                            return (
                              <TouchableOpacity
                                style={[
                                  styles.quickCashBtn,
                                  isExact && styles.activeQuickCashBtn,
                                ]}
                                onPress={() => setCashInput(total.toFixed(2))}
                              >
                                <Text
                                  style={[
                                    styles.quickCashText,
                                    isExact && styles.activeQuickCashText,
                                  ]}
                                >
                                  Exact
                                </Text>
                              </TouchableOpacity>
                            );
                          })()}
                        </View>
                        {paidNum > 0 && (
                          <View style={styles.changeBox}>
                            <Text style={styles.changeLabel}>
                              Change to Return
                            </Text>
                            <Text style={styles.changeValue}>
                              {currencySymbol}
                              {change.toFixed(2)}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}

                    {!showOrderPanel && isLedgerCollection && (
                      <View style={styles.creditMemberSection}>
                        <View style={styles.sectionHeader}>
                          <Text style={styles.sectionTitle}>
                            Ledger Collection Details
                          </Text>
                        </View>
                        <View style={styles.selectedCreditCard}>
                          <View
                            style={{
                              flexDirection: "row",
                              justifyContent: "space-between",
                              marginBottom: 8,
                            }}
                          >
                            <Text
                              style={{
                                fontFamily: Fonts.bold,
                                color: Theme.textSecondary,
                                fontSize: 13,
                              }}
                            >
                              Customer Name
                            </Text>
                            <Text
                              style={{
                                fontFamily: Fonts.black,
                                color: Theme.textPrimary,
                                fontSize: 13,
                              }}
                            >
                              {memberName}
                            </Text>
                          </View>
                          <View
                            style={{
                              flexDirection: "row",
                              justifyContent: "space-between",
                              marginBottom: 8,
                            }}
                          >
                            <Text
                              style={{
                                fontFamily: Fonts.bold,
                                color: Theme.textSecondary,
                                fontSize: 13,
                              }}
                            >
                              Phone Number
                            </Text>
                            <Text
                              style={{
                                fontFamily: Fonts.black,
                                color: Theme.textPrimary,
                                fontSize: 13,
                              }}
                            >
                              {memberPhone}
                            </Text>
                          </View>
                          <View
                            style={{
                              height: 1,
                              backgroundColor: Theme.border,
                              marginVertical: 8,
                            }}
                          />
                          <View
                            style={{
                              flexDirection: "row",
                              justifyContent: "space-between",
                              alignItems: "center",
                            }}
                          >
                            <Text
                              style={{
                                fontFamily: Fonts.bold,
                                color: Theme.textSecondary,
                                fontSize: 13,
                              }}
                            >
                              Amount to Collect
                            </Text>
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                backgroundColor: Theme.bgCard,
                                borderWidth: 1,
                                borderColor: Theme.border,
                                borderRadius: 8,
                                paddingHorizontal: 10,
                                height: 40,
                                width: 140,
                              }}
                            >
                              <Text
                                style={{
                                  fontFamily: Fonts.black,
                                  color: Theme.textPrimary,
                                  marginRight: 2,
                                }}
                              >
                                {currencySymbol}
                              </Text>
                              <TextInput
                                style={{
                                  flex: 1,
                                  fontFamily: Fonts.black,
                                  color: Theme.primary,
                                  fontSize: 16,
                                  padding: 0,
                                  ...Platform.select({
                                    web: { outlineStyle: "none" } as any,
                                  }),
                                }}
                                value={collectionAmount}
                                onChangeText={handleAmountChange}
                                keyboardType="numeric"
                                placeholder="0.00"
                              />
                            </View>
                          </View>
                        </View>
                      </View>
                    )}

                    <View style={{ marginTop: 15 }}>
                      <TouchableOpacity
                        style={[
                          styles.completeBtn,
                          processing && { opacity: 0.7 },
                        ]}
                        onPress={confirmPayment}
                        disabled={processing}
                      >
                        {processing ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <>
                            <Ionicons
                              name="checkmark-circle"
                              size={24}
                              color="#fff"
                            />
                            <Text style={styles.completeBtnText}>
                              {(method.trim().toUpperCase() === "MEMBER" ||
                                method.trim().toUpperCase() === "CREDIT" ||
                                method.trim().toUpperCase() === "5" ||
                                method.trim().toUpperCase() === "6") &&
                                selectedMember
                                ? "Complement Settlement"
                                : "Complete Settlement"}
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>

              {showOrderPanel && (
                <View style={styles.rightPane}>
                  <View style={styles.summaryCard}>
                    <View style={styles.summaryHeader}>
                      <Text style={styles.summaryTitle}>Amount Due</Text>
                      <Text style={styles.summaryTotal}>
                        {currencySymbol}
                        {total.toFixed(2)}
                      </Text>
                    </View>
                    <View style={styles.breakdown}>
                      <View style={styles.breakRow}>
                        <Text style={styles.breakLabel}>Subtotal</Text>
                        <Text style={styles.breakValue}>
                          {currencySymbol}
                          {(payItemDiscount > 0
                            ? payGrossTotal
                            : subtotal
                          ).toFixed(2)}
                        </Text>
                      </View>

                      {discountAmount + payItemDiscount > 0 && (
                        <>
                          <View style={styles.breakRow}>
                            <Text
                              style={[
                                styles.breakLabel,
                                { color: Theme.danger },
                              ]}
                            >
                              Discount
                            </Text>
                            <Text
                              style={[
                                styles.breakValue,
                                { color: Theme.danger },
                              ]}
                            >
                              -{currencySymbol}
                              {(discountAmount + payItemDiscount).toFixed(2)}
                            </Text>
                          </View>
                          <View style={styles.receiptDivider} />
                          <View style={styles.breakRow}>
                            <Text style={styles.breakLabel}>Net Amount</Text>
                            <Text style={styles.breakValue}>
                              {currencySymbol}
                              {netAfterDiscount.toFixed(2)}
                            </Text>
                          </View>
                        </>
                      )}

                      {dineInServiceChargeAmt > 0 && (
                        <View style={styles.breakRow}>
                          <Text style={styles.breakLabel}>
                            {allItemsHaveSC ? "Service Charge" : "Item Service Charge"} ({settingsStore.serviceChargePercentage || 0}%)
                          </Text>
                          <Text style={styles.breakValue}>
                            {currencySymbol}
                            {dineInServiceChargeAmt.toFixed(2)}
                          </Text>
                        </View>
                      )}
                      {twServiceChargeAmt > 0 && (
                        <View style={styles.breakRow}>
                          <Text style={styles.breakLabel}>
                            TW Service Charge ({settingsStore.twServiceChargePercentage || 0}%)
                          </Text>
                          <Text style={styles.breakValue}>
                            {currencySymbol}
                            {twServiceChargeAmt.toFixed(2)}
                          </Text>
                        </View>
                      )}
                      {currentTakeawayCharge > 0 && (
                        <View style={styles.breakRow}>
                          <Text style={styles.breakLabel}>
                            Takeaway Charges
                          </Text>
                          <Text style={styles.breakValue}>
                            {currencySymbol}
                            {currentTakeawayCharge.toFixed(2)}
                          </Text>
                        </View>
                      )}
                      {displayedTax > 0 && (
                        <View style={styles.breakRow}>
                          <Text style={styles.breakLabel}>
                            GST ({settingsStore.gstPercentage || 0}%)
                          </Text>
                          <Text style={styles.breakValue}>
                            {currencySymbol}
                            {displayedTax.toFixed(2)}
                          </Text>
                        </View>
                      )}

                      {displayedRoundOff !== 0 && (
                        <View style={styles.breakRow}>
                          <Text
                            style={[
                              styles.breakLabel,
                              { color: Theme.primary },
                            ]}
                          >
                            Rounding
                          </Text>
                          <Text
                            style={[
                              styles.breakValue,
                              { color: Theme.primary },
                            ]}
                          >
                            {displayedRoundOff > 0 ? "+" : ""}
                            {currencySymbol}
                            {displayedRoundOff.toFixed(2)}
                          </Text>
                        </View>
                      )}

                      <View style={styles.receiptDivider} />
                      <View style={styles.breakRow}>
                        <Text
                          style={[
                            styles.breakLabel,
                            {
                              fontFamily: Fonts.bold,
                              color: Theme.textPrimary,
                            },
                          ]}
                        >
                          Payable
                        </Text>
                        <Text
                          style={[
                            styles.breakValue,
                            {
                              fontFamily: Fonts.bold,
                              color: Theme.textPrimary,
                            },
                          ]}
                        >
                          {currencySymbol}
                          {total.toFixed(2)}
                        </Text>
                      </View>
                      {isCashMethod(method) && (
                        <>
                          <View style={styles.receiptDivider} />
                          <View style={styles.roundingContainer}>
                            <View style={styles.roundingHeader}>
                              <Text style={styles.roundingLabel}>Rounding</Text>
                              {roundType && (
                                <TouchableOpacity
                                  onPress={() => {
                                    setRoundOff(0);
                                    setRoundType(null);
                                    if (method === "CAS")
                                      setCashInput(baseTotal.toFixed(2));
                                  }}
                                >
                                  <Text style={styles.resetTextLink}>
                                    Reset
                                  </Text>
                                </TouchableOpacity>
                              )}
                            </View>

                            <View style={{ flexDirection: "row", gap: 8 }}>
                              <TouchableOpacity
                                style={[
                                  styles.roundingToggleBtn,
                                  roundType === "ten" &&
                                  styles.activeRoundingBtn,
                                ]}
                                onPress={() => {
                                  if (roundType === "ten") {
                                    setRoundOff(0);
                                    setRoundType(null);
                                    if (method === "CAS")
                                      setCashInput(baseTotal.toFixed(2));
                                  } else {
                                    const target =
                                      Math.round(baseTotal * 10) / 10;
                                    setRoundOff(target - baseTotal);
                                    setRoundType("ten");
                                    if (method === "CAS")
                                      setCashInput(target.toFixed(2));
                                  }
                                }}
                              >
                                <Ionicons
                                  name={
                                    roundType === "ten"
                                      ? "checkmark-circle"
                                      : "radio-button-off"
                                  }
                                  size={18}
                                  color={
                                    roundType === "ten" ? "#fff" : Theme.primary
                                  }
                                />
                                <Text
                                  style={[
                                    styles.roundingToggleText,
                                    roundType === "ten" &&
                                    styles.activeRoundingText,
                                  ]}
                                >
                                  {roundType === "ten"
                                    ? "Rounded to .10"
                                    : "Round to .10"}
                                </Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={styles.moreAdjustBtn}
                                onPress={() =>
                                  setIsAdjustmentModalVisible(true)
                                }
                              >
                                <Ionicons
                                  name="options"
                                  size={18}
                                  color={Theme.primary}
                                />
                              </TouchableOpacity>
                            </View>
                          </View>
                        </>
                      )}
                    </View>
                  </View>
                  {isLedgerCollection ? (
                    <View style={styles.orderItemsCard}>
                      <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>
                          Ledger Collection Details
                        </Text>
                      </View>
                      <View
                        style={{
                          padding: 16,
                          backgroundColor: Theme.bgInput,
                          borderRadius: 8,
                          gap: 10,
                        }}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <Text
                            style={{
                              fontFamily: Fonts.bold,
                              color: Theme.textSecondary,
                              marginRight: 10,
                            }}
                          >
                            Customer Name
                          </Text>
                          <Text
                            numberOfLines={1}
                            ellipsizeMode="tail"
                            style={{
                              fontFamily: Fonts.black,
                              color: Theme.textPrimary,
                              flexShrink: 1,
                              textAlign: "right",
                            }}
                          >
                            {memberName}
                          </Text>
                        </View>
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <Text
                            style={{
                              fontFamily: Fonts.bold,
                              color: Theme.textSecondary,
                              marginRight: 10,
                            }}
                          >
                            Phone Number
                          </Text>
                          <Text
                            numberOfLines={1}
                            ellipsizeMode="tail"
                            style={{
                              fontFamily: Fonts.black,
                              color: Theme.textPrimary,
                              flexShrink: 1,
                              textAlign: "right",
                            }}
                          >
                            {memberPhone}
                          </Text>
                        </View>
                        <View
                          style={{
                            height: 1,
                            backgroundColor: Theme.border,
                            marginVertical: 4,
                          }}
                        />
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <Text
                            style={{
                              fontFamily: Fonts.bold,
                              color: Theme.textSecondary,
                            }}
                          >
                            Amount to Collect
                          </Text>
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              backgroundColor: Theme.bgCard,
                              borderWidth: 1,
                              borderColor: Theme.border,
                              borderRadius: 8,
                              paddingHorizontal: 10,
                              height: 40,
                              width: 140,
                            }}
                          >
                            <Text
                              style={{
                                fontFamily: Fonts.black,
                                color: Theme.textPrimary,
                                marginRight: 2,
                              }}
                            >
                              {currencySymbol}
                            </Text>
                            <TextInput
                              style={{
                                flex: 1,
                                fontFamily: Fonts.black,
                                color: Theme.primary,
                                fontSize: 16,
                                padding: 0,
                                ...Platform.select({
                                  web: { outlineStyle: "none" } as any,
                                }),
                              }}
                              value={collectionAmount}
                              onChangeText={handleAmountChange}
                              keyboardType="numeric"
                              placeholder="0.00"
                            />
                          </View>
                        </View>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.orderItemsCard}>
                      <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>Order Items</Text>
                      </View>
                      <View>
                        {finalItems.map((item: any, index: number) => (
                          <React.Fragment key={item.id || index.toString()}>
                            {renderItem({ item })}
                          </React.Fragment>
                        ))}
                      </View>
                    </View>
                  )}
                </View>
              )}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>

      {renderAdjustmentModal()}
      {renderTestDisplayModal()}
      {renderQuickCashEditorModal()}
      <UPIPaymentModal
        visible={isUPIVisible}
        onClose={() => {
          setIsUPIVisible(false);
          setPendingPayments(null);
        }}
        amount={isSplitActive ? upiQrAmount : total}
        onSuccess={() =>
          executeFinalPayment(isSplitActive ? pendingPayments || [] : undefined)
        }
      />
      <PayNowPaymentModal
        visible={isPayNowVisible}
        onClose={() => {
          setIsPayNowVisible(false);
          setPendingPayments(null);
        }}
        amount={isSplitActive ? payNowQrAmount : total}
        onSuccess={() => {
          if (isSplitActive && upiQrAmount > 0) {
            setIsUPIVisible(true);
          } else {
            executeFinalPayment(
              isSplitActive ? pendingPayments || [] : undefined,
            );
          }
        }}
      />

      <Modal
        visible={showMemberModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMemberModal(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowMemberModal(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={styles.memberModalContent}>
                <View style={styles.adjustModalHeader}>
                  <Text style={styles.adjustModalTitle}>
                    {isQuickAddMode
                      ? method.trim().toUpperCase() === "CREDIT"
                        ? "Quick Add Credit Account"
                        : "Quick Add Member"
                      : method.trim().toUpperCase() === "CREDIT"
                        ? "Select Credit Customer"
                        : "Select Member"}
                  </Text>
                  <TouchableOpacity onPress={() => setShowMemberModal(false)}>
                    <Ionicons
                      name="close"
                      size={24}
                      color={Theme.textPrimary}
                    />
                  </TouchableOpacity>
                </View>
                <ScrollView
                  style={{ flexShrink: 1 }}
                  contentContainerStyle={{ paddingBottom: 10 }}
                  showsVerticalScrollIndicator={false}
                >
                  {isQuickAddMode ? (
                    <View style={styles.quickAddForm}>
                      <View style={styles.formField}>
                        <Text style={styles.formLabel}>Customer Name *</Text>
                        <TextInput
                          style={styles.formInput}
                          placeholder="Enter full name"
                          placeholderTextColor={Theme.textMuted || "#999"}
                          value={newName}
                          onChangeText={setNewName}
                          {...Platform.select({
                            web: { outlineStyle: "none" } as any,
                          })}
                        />
                      </View>
                      <View style={styles.formField}>
                        <Text style={styles.formLabel}>Phone Number *</Text>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <TouchableOpacity
                            style={[
                              styles.formInput,
                              {
                                width: 85,
                                justifyContent: "center",
                                alignItems: "center",
                                flexDirection: "row",
                                gap: 4,
                              },
                            ]}
                            onPress={() => setShowCountryCodeModal(true)}
                          >
                            <Text
                              style={{
                                fontSize: 14,
                                fontFamily: Fonts.bold,
                                color: Theme.textPrimary,
                              }}
                            >
                              {selectedCountryCode}
                            </Text>
                            <Ionicons
                              name="chevron-down"
                              size={12}
                              color={Theme.textSecondary}
                            />
                          </TouchableOpacity>
                          <TextInput
                            style={[styles.formInput, { flex: 1 }]}
                            placeholder="Enter phone number"
                            placeholderTextColor={Theme.textMuted || "#999"}
                            value={newPhone}
                            onChangeText={setNewPhone}
                            keyboardType="phone-pad"
                            {...Platform.select({
                              web: { outlineStyle: "none" } as any,
                            })}
                          />
                        </View>
                      </View>
                      <View style={styles.formField}>
                        <Text style={styles.formLabel}>Email Address</Text>
                        <TextInput
                          style={styles.formInput}
                          placeholder="Enter email address"
                          placeholderTextColor={Theme.textMuted || "#999"}
                          value={newEmail}
                          onChangeText={setNewEmail}
                          keyboardType="email-address"
                          autoCapitalize="none"
                          {...Platform.select({
                            web: { outlineStyle: "none" } as any,
                          })}
                        />
                      </View>
                      <View style={styles.formField}>
                        <Text style={styles.formLabel}>Address</Text>
                        <TextInput
                          style={styles.formInput}
                          placeholder="Enter address"
                          placeholderTextColor={Theme.textMuted || "#999"}
                          value={newAddress}
                          onChangeText={setNewAddress}
                          {...Platform.select({
                            web: { outlineStyle: "none" } as any,
                          })}
                        />
                      </View>
                      <View style={styles.formField}>
                        <Text style={styles.formLabel}>
                          Default Credit Limit ({currencySymbol})
                        </Text>
                        <TextInput
                          style={styles.formInput}
                          placeholder="e.g. 1000"
                          placeholderTextColor={Theme.textMuted || "#999"}
                          value={newCreditLimit}
                          onChangeText={setNewCreditLimit}
                          keyboardType="numeric"
                          {...Platform.select({
                            web: { outlineStyle: "none" } as any,
                          })}
                        />
                      </View>
                      <View
                        style={[
                          styles.formField,
                          {
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginTop: 4,
                          },
                        ]}
                      >
                        <Text style={styles.formLabel}>
                          Account Status (Active)
                        </Text>
                        <TouchableOpacity
                          style={{
                            width: 48,
                            height: 28,
                            borderRadius: 14,
                            backgroundColor: newIsActive
                              ? Theme.primary
                              : Theme.border,
                            justifyContent: "center",
                            paddingHorizontal: 2,
                          }}
                          onPress={() => setNewIsActive(!newIsActive)}
                        >
                          <View
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: 12,
                              backgroundColor: "#fff",
                              alignSelf: newIsActive
                                ? "flex-end"
                                : "flex-start",
                              ...Theme.shadowSm,
                            }}
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <>
                      {method.trim().toUpperCase() !== "MEMBER" && (
                        <TouchableOpacity
                          style={styles.quickAddToggleBtn}
                          onPress={() => {
                            setIsQuickAddMode(true);
                            if (memberQuery && isNaN(Number(memberQuery))) {
                              setNewName(memberQuery);
                            } else if (memberQuery) {
                              setNewPhone(memberQuery);
                            }
                          }}
                        >
                          <Ionicons
                            name="person-add"
                            size={16}
                            color={Theme.primary}
                          />
                          <Text style={styles.quickAddToggleText}>
                            + Quick Add New Customer
                          </Text>
                        </TouchableOpacity>
                      )}

                      <View style={styles.searchBarBox}>
                        <Ionicons
                          name="search"
                          size={20}
                          color={Theme.textSecondary}
                          style={{ marginRight: 8 }}
                        />
                        <TextInput
                          style={{
                            flex: 1,
                            fontSize: 16,
                            fontFamily: Fonts.medium,
                            color: Theme.textPrimary,
                            height: "100%",
                            borderWidth: 0,
                            marginLeft: 8,
                            ...Platform.select({
                              web: { outlineStyle: "none" } as any,
                            }),
                          }}
                          placeholder="Search by Name or Phone..."
                          placeholderTextColor={Theme.textMuted || "#999"}
                          value={memberQuery}
                          onChangeText={setMemberQuery}
                          autoFocus
                        />
                        {searchingMembers && (
                          <ActivityIndicator
                            size="small"
                            color={Theme.primary}
                          />
                        )}
                      </View>

                      <View style={{ marginVertical: 8 }}>
                        {members.length === 0 ? (
                          <View
                            style={{
                              alignItems: "center",
                              justifyContent: "center",
                              paddingVertical: 40,
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 14,
                                fontFamily: Fonts.medium,
                                color: Theme.textSecondary,
                              }}
                            >
                              No members found
                            </Text>
                          </View>
                        ) : (
                          members.map((item) => {
                            const isSelected =
                              selectedMember?.MemberId === item.MemberId;
                            const remainingCredit =
                              item.AvailableCredit !== undefined
                                ? item.AvailableCredit
                                : (item.CreditLimit || 0) -
                                  (item.CurrentBalance || 0);
                            const isLimitExceeded = total > remainingCredit;
                            return (
                              <TouchableOpacity
                                key={item.MemberId}
                                style={[
                                  styles.memberListItem,
                                  isSelected && styles.selectedMemberItem,
                                  !item.IsActive && { opacity: 0.5 },
                                ]}
                                disabled={!item.IsActive}
                                onPress={() => {
                                  if (!item.IsActive) {
                                    showToast({
                                      type: "warning",
                                      message: "Inactive Member",
                                      subtitle: "Cannot select inactive member",
                                    });
                                    return;
                                  }
                                  setSelectedMember(item);
                                }}
                              >
                                <View style={{ flex: 1 }}>
                                  <View
                                    style={{
                                      flexDirection: "row",
                                      alignItems: "center",
                                      gap: 6,
                                    }}
                                  >
                                    <Text
                                      style={[
                                        styles.memberNameText,
                                        isSelected && { color: Theme.primary },
                                      ]}
                                    >
                                      {item.Name}
                                    </Text>
                                    {!item.IsActive && (
                                      <View style={styles.inactiveBadge}>
                                        <Text style={styles.inactiveBadgeText}>
                                          INACTIVE
                                        </Text>
                                      </View>
                                    )}
                                  </View>
                                  <Text style={styles.memberPhoneText}>
                                    {item.Phone}
                                  </Text>
                                  <Text
                                    style={{
                                      fontSize: 11,
                                      fontFamily: Fonts.medium,
                                      color: Theme.textMuted,
                                      marginTop: 4,
                                    }}
                                  >
                                    Prepaid:{" "}
                                    {formatMoney(
                                      currencySymbol,
                                      item.CreditLimit || 0,
                                    )}{" "}
                                     | Consumed:{" "}
                                    {formatMoney(
                                      currencySymbol,
                                      item.CurrentBalance || 0,
                                    )}
                                  </Text>
                                </View>
                                <View style={{ alignItems: "flex-end" }}>
                                  <Text
                                    style={{
                                      fontSize: 12,
                                      fontFamily: Fonts.bold,
                                      color: isLimitExceeded
                                        ? Theme.danger
                                        : Theme.success,
                                    }}
                                  >
                                    Avail:{" "}
                                    {formatMoney(
                                      currencySymbol,
                                      remainingCredit,
                                    )}
                                  </Text>
                                  {isLimitExceeded && (
                                    <Text
                                      style={{
                                        fontSize: 10,
                                        fontFamily: Fonts.medium,
                                        color: Theme.danger,
                                        marginTop: 2,
                                      }}
                                    >
                                      Limit Exceeded
                                    </Text>
                                  )}
                                </View>
                              </TouchableOpacity>
                            );
                          })
                        )}
                      </View>

                      {selectedMember && (
                        <View style={styles.selectedMemberDetailCard}>
                          <Text
                            style={{
                              fontSize: 13,
                              fontFamily: Fonts.black,
                              color: Theme.textPrimary,
                            }}
                          >
                            SELECTED ACCOUNT
                          </Text>
                          <View style={{ marginTop: 6, gap: 4 }}>
                            <Text
                              style={{
                                fontSize: 14,
                                fontFamily: Fonts.bold,
                                color: Theme.primary,
                              }}
                            >
                              {selectedMember.Name} ({selectedMember.Phone})
                            </Text>
                            <View
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                marginTop: 4,
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 12,
                                  fontFamily: Fonts.medium,
                                  color: Theme.textSecondary,
                                }}
                              >
                                Bill Amount:
                              </Text>
                              <Text
                                style={{
                                  fontSize: 12,
                                  fontFamily: Fonts.bold,
                                  color: Theme.textPrimary,
                                }}
                              >
                                {formatMoney(currencySymbol, total)}
                              </Text>
                            </View>
                            <View
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                              }}
                            >
                              <Text
                                style={{
                                  fontSize: 12,
                                  fontFamily: Fonts.medium,
                                  color: Theme.textSecondary,
                                }}
                              >
                                Remaining Credit:
                              </Text>
                              <Text
                                style={{
                                  fontSize: 12,
                                  fontFamily: Fonts.bold,
                                  color: Theme.textPrimary,
                                }}
                              >
                                {formatMoney(
                                  currencySymbol,
                                  selectedMember.CreditLimit -
                                  selectedMember.CurrentBalance,
                                )}
                              </Text>
                            </View>
                          </View>
                        </View>
                      )}
                    </>
                  )}
                </ScrollView>

                {isQuickAddMode ? (
                  <View style={styles.adjustModalActions}>
                    <TouchableOpacity
                      style={styles.cancelBtn}
                      onPress={() => setIsQuickAddMode(false)}
                    >
                      <Text
                        style={{
                          color: Theme.textSecondary,
                          fontFamily: Fonts.bold,
                        }}
                      >
                        Back to Search
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.confirmBtn,
                        addingMember && { opacity: 0.7 },
                      ]}
                      disabled={addingMember}
                      onPress={handleQuickAddMember}
                    >
                      {addingMember ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={{ color: "#fff", fontFamily: Fonts.bold }}>
                          Save & Select
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.adjustModalActions}>
                    <TouchableOpacity
                      style={styles.cancelBtn}
                      onPress={() => setShowMemberModal(false)}
                    >
                      <Text
                        style={{
                          color: Theme.textSecondary,
                          fontFamily: Fonts.bold,
                        }}
                      >
                        Cancel
                      </Text>
                    </TouchableOpacity>
                    {selectedMember && (
                      <TouchableOpacity
                        style={styles.confirmBtn}
                        onPress={() => {
                          setShowMemberModal(false);
                        }}
                      >
                        <Text style={{ color: "#fff", fontFamily: Fonts.bold }}>
                          Confirm
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {showCountryCodeModal && (
        <Modal
          visible={showCountryCodeModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowCountryCodeModal(false)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setShowCountryCodeModal(false)}
          >
            <View
              style={[
                styles.adjustModalContent,
                { maxHeight: "60%", width: "80%" },
              ]}
            >
              <View style={styles.adjustModalHeader}>
                <Text style={styles.adjustModalTitle}>Select Country Code</Text>
                <TouchableOpacity
                  onPress={() => setShowCountryCodeModal(false)}
                >
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>
              <ScrollView>
                {[
                  { code: "+65", label: "Singapore (+65)", flag: "🇸🇬" },
                  { code: "+60", label: "Malaysia (+60)", flag: "🇲🇾" },
                  { code: "+971", label: "UAE (+971)", flag: "🇦🇪" },
                  { code: "+91", label: "India (+91)", flag: "🇮🇳" },
                  { code: "+1", label: "US/Canada (+1)", flag: "🇺🇸" },
                  { code: "+44", label: "UK (+44)", flag: "🇬🇧" },
                  { code: "+61", label: "Australia (+61)", flag: "🇦🇺" },
                  { code: "+62", label: "Indonesia (+62)", flag: "🇮🇩" },
                  { code: "+66", label: "Thailand (+66)", flag: "🇹🇭" },
                ].map((c) => (
                  <TouchableOpacity
                    key={c.code}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "space-between",
                      paddingVertical: 12,
                      borderBottomWidth: 0.5,
                      borderBottomColor: Theme.border,
                    }}
                    onPress={() => {
                      setSelectedCountryCode(c.code);
                      setShowCountryCodeModal(false);
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        fontFamily: Fonts.bold,
                        color: Theme.textPrimary,
                      }}
                    >
                      {c.flag} {c.label}
                    </Text>
                    {selectedCountryCode === c.code && (
                      <Ionicons
                        name="checkmark"
                        size={20}
                        color={Theme.primary}
                      />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Theme.bgMain },
  container: { flex: 1, padding: 12 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.bgMuted,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  orderInfo: { alignItems: "center", flex: 1 },
  orderTitle: {
    color: Theme.textPrimary,
    fontFamily: Fonts.black,
    fontSize: 16,
  },
  orderBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 6,
    marginTop: 2,
  },
  typeBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 },
  typeBadgeText: { fontSize: 9, fontFamily: Fonts.black },
  tableBadge: {
    backgroundColor: Theme.bgMuted,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  tableBadgeText: {
    fontSize: 9,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  orderSub: {
    color: Theme.textSecondary,
    fontSize: 10,
    fontFamily: Fonts.bold,
  },
  mainLayout: { gap: 15 },
  leftPane: {
    padding: 15,
    borderRadius: 20,
    backgroundColor: Theme.bgCard,
    ...Theme.shadowMd,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  // In the styles object, add these:

  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    marginVertical: 10,
    gap: 10,
    borderWidth: 1,
  },
  statusSuccess: {
    backgroundColor: '#dcfce7',
    borderColor: '#22c55e',
  },
  statusCancelled: {
    backgroundColor: '#fef3c7',
    borderColor: '#f59e0b',
  },
  statusFailed: {
    backgroundColor: '#fee2e2',
    borderColor: '#ef4444',
  },
  statusProcessing: {
    backgroundColor: '#dbeafe',
    borderColor: '#3b82f6',
  },
  statusMessage: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    flex: 1,
  },
  statusMessageSuccess: {
    color: '#16a34a',
  },
  statusMessageCancelled: {
    color: '#d97706',
  },
  statusMessageFailed: {
    color: '#dc2626',
  },
  statusMessageProcessing: {
    color: '#2563eb',
  },
  methodsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 15,
  },
  methodCard: {
    width: "31.8%",
    height: 80,
    backgroundColor: Theme.bgMuted,
    borderRadius: 14,
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
    paddingHorizontal: 4,
    paddingVertical: 8,
    gap: 4,
  },
  activeMethodCard: {
    backgroundColor: Theme.primary,
    borderColor: Theme.primary,
    ...Theme.shadowMd,
  },
  methodIconBox: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  activeIconBox: { backgroundColor: "rgba(255,255,255,0.2)" },
  methodLabel: {
    fontSize: 10,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    textAlign: "center",
    alignSelf: "center",
    width: "100%",
    flexShrink: 1,
  },
  activeMethodLabel: { color: "#fff" },
  yeahpayMethodCard: {
    borderColor: '#059669',
    borderWidth: 2,
    backgroundColor: '#ECFDF5',
  },
  yeahpayIconBox: {
    backgroundColor: '#D1FAE5',
  },
  yeahpayLabel: {
    color: '#065F46',
    fontFamily: Fonts.black,
  },
  yeahpayBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#D1FAE5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    gap: 3,
    marginTop: 2,
  },
  yeahpayBadgeText: {
    fontSize: 8,
    fontFamily: Fonts.black,
    color: '#059669',
  },
  cashSection: { marginTop: 5 },
  sectionHeader: {
    marginBottom: 8,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  openDrawerBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#ffedd5",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 5,
  },
  openDrawerBtnText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: "#ea580c",
  },
  cashInputBox: {
    flexDirection: "row",
    alignItems: "center",
    height: 56,
    backgroundColor: Theme.bgMuted,
    borderRadius: 12,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: Theme.border,
    marginBottom: 12,
  },
  currencyPrefix: {
    fontSize: 20,
    fontFamily: Fonts.black,
    color: Theme.primary,
    marginRight: 8,
  },
  cashInput: {
    flex: 1,
    fontSize: 24,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  quickCashContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 15,
  },
  quickCashBtn: {
    minWidth: 54,
    height: 38,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.border,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 10,
  },
  activeQuickCashBtn: {
    backgroundColor: Theme.primaryLight,
    borderColor: Theme.primaryBorder,
  },
  quickCashText: {
    fontSize: 13,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  activeQuickCashText: { color: Theme.primary },
  changeBox: {
    padding: 12,
    backgroundColor: Theme.primaryLight,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Theme.primaryBorder,
    marginBottom: 15,
  },
  changeLabel: {
    fontSize: 9,
    fontFamily: Fonts.black,
    color: Theme.primary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  changeValue: { fontSize: 26, fontFamily: Fonts.black, color: Theme.primary },
  completeBtn: {
    height: 50,
    backgroundColor: Theme.primary,
    borderRadius: 14,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    ...Theme.shadowLg,
  },
  completeBtnText: { fontSize: 16, fontFamily: Fonts.black, color: "#fff" },
  splitToggleBtn: {
    height: 50,
    backgroundColor: "transparent",
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Theme.primary,
    borderStyle: "dashed",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
  },
  splitToggleBtnText: {
    fontSize: 16,
    fontFamily: Fonts.black,
    color: Theme.primary,
  },
  rightPane: { flex: 0.7, gap: 15 },
  summaryCard: {
    padding: 18,
    backgroundColor: Theme.bgCard,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowSm,
  },
  summaryHeader: {
    marginBottom: 15,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  summaryTitle: {
    fontSize: 10,
    fontFamily: Fonts.black,
    color: Theme.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  summaryTotal: {
    fontSize: 30,
    fontFamily: Fonts.black,
    color: Theme.primary,
    lineHeight: 34,
  },
  breakdown: { gap: 8 },
  breakRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  breakLabel: {
    fontSize: 13,
    fontFamily: Fonts.semiBold,
    color: Theme.textSecondary,
  },
  breakValue: {
    fontSize: 14,
    fontFamily: Fonts.extraBold,
    color: Theme.textPrimary,
  },
  receiptDivider: {
    height: 1,
    backgroundColor: Theme.border,
    marginVertical: 12,
  },
  roundingContainer: { marginTop: 8 },
  roundingHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  roundingLabel: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    textTransform: "uppercase",
  },
  resetTextLink: { fontSize: 11, fontFamily: Fonts.bold, color: Theme.danger },
  roundingToggleBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: Theme.primaryBorder,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    gap: 10,
  },
  activeRoundingBtn: {
    backgroundColor: Theme.primary,
    borderColor: Theme.primary,
  },
  roundingToggleText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.primary,
  },
  activeRoundingText: { color: "#fff" },
  moreAdjustBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: Theme.bgMuted,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
  },
  orderItemsCard: {
    flex: 1,
    padding: 20,
    backgroundColor: Theme.bgCard,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  itemRow: {
    flexDirection: "row",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
  },
  itemQty: {
    width: 30,
    fontSize: 13,
    fontFamily: Fonts.black,
    color: Theme.primary,
  },
  itemName: {
    flex: 1,
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
  },
  itemPrice: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary },
  itemVoidedText: {
    textDecorationLine: "line-through",
    color: Theme.textMuted,
  },
  itemSubText: {
    fontSize: 11,
    color: Theme.textSecondary,
    marginTop: 2,
    fontFamily: Fonts.medium,
  },
  itemDiscountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  itemOriginalPrice: {
    fontSize: 11,
    textDecorationLine: "line-through",
    color: Theme.textMuted,
  },
  itemDiscountBadge: {
    backgroundColor: "#22C55E15",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: "#22C55E30",
  },
  itemDiscountBadgeText: {
    color: "#15803D",
    fontSize: 9,
    fontFamily: Fonts.black,
  },
  itemTwBadge: {
    backgroundColor: Theme.danger + "15",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: Theme.danger + "30",
    marginLeft: 6,
  },
  itemTwBadgeText: {
    fontSize: 9,
    fontFamily: Fonts.black,
    color: Theme.danger,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  adjustModalContent: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 24,
    ...Theme.shadowLg,
  },
  adjustModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  adjustModalTitle: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  adjustPresets: { gap: 10, marginBottom: 20 },
  presetItem: {
    backgroundColor: Theme.bgMuted,
    padding: 14,
    borderRadius: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
  },
  presetLabel: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  presetValue: { fontSize: 13, fontFamily: Fonts.black, color: Theme.primary },
  customInputSection: { marginBottom: 20 },
  inputLabel: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  customInputRow: { flexDirection: "row", gap: 8 },
  adjustTextInput: {
    flex: 1,
    height: 46,
    backgroundColor: Theme.bgMuted,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: Fonts.bold,
  },
  applyBtn: {
    backgroundColor: Theme.primary,
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: "center",
  },
  applyBtnText: { color: "#fff", fontFamily: Fonts.bold, fontSize: 13 },
  resetBtnFull: { height: 44, justifyContent: "center", alignItems: "center" },
  resetBtnText: { color: Theme.danger, fontFamily: Fonts.bold, fontSize: 13 },
  mobileSummaryCard: {
    backgroundColor: Theme.primary + "10",
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Theme.primary + "20",
  },
  mobileSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  mobileSummaryLabel: {
    fontSize: 10,
    fontFamily: Fonts.black,
    color: Theme.textSecondary,
    letterSpacing: 0.5,
  },
  mobileSummaryTotal: {
    fontSize: 28,
    fontFamily: Fonts.black,
    color: Theme.primary,
  },
  mobileAdjustBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  mobileAdjustText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  mobileDiscountText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.danger,
    marginTop: 4,
  },
  separator: {
    height: 1,
    backgroundColor: Theme.border,
    marginVertical: 16,
  },
  linkSection: {
    alignItems: "center",
    marginTop: 5,
  },
  linkTitle: {
    fontSize: 14,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    marginBottom: 4,
    alignSelf: "flex-start",
  },
  linkSub: {
    fontSize: 11,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginBottom: 12,
    alignSelf: "flex-start",
    lineHeight: 15,
  },
  qrContainer: {
    padding: 10,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  urlText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.primary,
    marginBottom: 12,
    textAlign: "center",
    paddingHorizontal: 10,
  },
  openBtn: {
    backgroundColor: Theme.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 10,
    width: "100%",
  },
  openBtnText: {
    color: "#fff",
    fontFamily: Fonts.bold,
    fontSize: 13,
  },
  memberModalContent: {
    width: "90%",
    maxWidth: 550,
    maxHeight: "85%",
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 20,
    ...Theme.shadowLg,
  },
  searchBarBox: {
    flexDirection: "row",
    alignItems: "center",
    height: 56,
    backgroundColor: Theme.bgInput || "#f8f9fa",
    borderRadius: 16,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Theme.border,
    marginTop: 10,
    ...Theme.shadowSm,
  },
  memberListItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    borderRadius: 8,
  },
  selectedMemberItem: {
    backgroundColor: Theme.primaryLight,
    borderColor: Theme.primaryBorder,
    borderWidth: 1,
  },
  memberNameText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  memberPhoneText: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginTop: 2,
  },
  inactiveBadge: {
    backgroundColor: Theme.danger + "22",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 0.5,
    borderColor: Theme.danger + "40",
  },
  inactiveBadgeText: {
    fontSize: 8,
    fontFamily: Fonts.bold,
    color: Theme.danger,
  },
  selectedMemberDetailCard: {
    padding: 12,
    backgroundColor: Theme.bgMuted,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    marginTop: 10,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.border,
    justifyContent: "center",
    alignItems: "center",
  },
  confirmBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Theme.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  adjustModalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 16,
  },
  creditMemberSection: {
    marginTop: 5,
    marginBottom: 10,
  },
  selectedCreditCard: {
    backgroundColor: Theme.bgMuted,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowSm,
  },
  creditIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Theme.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  creditCardName: {
    fontSize: 15,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  creditCardPhone: {
    fontSize: 11,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginTop: 1,
  },
  changeCreditBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.primaryBorder,
    backgroundColor: Theme.primaryLight,
  },
  changeCreditBtnText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.primary,
  },
  creditCardStatsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Theme.border + "30",
  },
  creditStatCol: {
    flex: 1,
    alignItems: "center",
  },
  creditStatLabel: {
    fontSize: 9,
    fontFamily: Fonts.black,
    color: Theme.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  creditStatValue: {
    fontSize: 13,
    fontFamily: Fonts.extraBold,
    color: Theme.textPrimary,
  },
  limitExceededBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Theme.danger + "10",
    padding: 10,
    borderRadius: 8,
    marginTop: 12,
    borderWidth: 0.5,
    borderColor: Theme.danger + "20",
  },
  limitExceededText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.danger,
    flex: 1,
  },
  selectCreditPrompt: {
    backgroundColor: Theme.bgCard,
    borderWidth: 1.5,
    borderColor: Theme.primaryBorder,
    borderStyle: "dashed",
    borderRadius: 16,
    padding: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  selectCreditPromptInner: {
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  selectCreditPromptTitle: {
    fontSize: 14,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  selectCreditPromptSub: {
    fontSize: 11,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    textAlign: "center",
  },
  quickAddToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    backgroundColor: Theme.primaryLight,
    borderWidth: 1,
    borderColor: Theme.primaryBorder,
    borderRadius: 12,
    marginVertical: 8,
  },
  quickAddToggleText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.primary,
  },
  quickAddForm: {
    gap: 12,
    marginVertical: 10,
  },
  formField: {
    gap: 4,
  },
  formLabel: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  formInput: {
    height: 46,
    backgroundColor: Theme.bgInput || "#f8f9fa",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.border,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
  },
});