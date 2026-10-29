import { socket } from "../constants/socket";
import { useGeneralSettingsStore } from "../stores/generalSettingsStore";
import { useAuthStore } from "../stores/authStore";
import { useTerminalStore } from "../stores/terminalStore";
import { useCompanySettingsStore } from "../stores/companySettingsStore";
import { usePaymentSettingsStore } from "../stores/paymentSettingsStore";
import { NativeModules, Platform } from "react-native";
import { API_URL } from "@/constants/Config";

const { SunmiCustomerDisplay } = NativeModules;

const PRINT_BRIDGE_URL = "http://localhost:3050";

function pushToLocalBridge(payload: any): void {
  if (Platform.OS !== "web") return;
  fetch(`${PRINT_BRIDGE_URL}/customer-display/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {}); // silent catch if offline
}


export interface SyncCartParams {
  orderContext: {
    tableId?: string;
    tableNo?: string;
    takeawayNo?: string;
    orderType: "DINE_IN" | "TAKEAWAY" | "MANUAL";
    section?: string;
    serverId?: number;
    serverName?: string;
  };
  cart: any[];
  discountInfo: {
    applied: boolean;
    type: "percentage" | "fixed";
    value: number;
    label?: string;
  } | null;
  gstPercentage: number;
  roundOff: number;
  active: boolean;
  orderId?: string;
  paymentMethod?: string;
  memberName?: string;
  isSplit?: boolean;
  splitPayments?: any[];
  takeawayCharge?: number;
  isQuickServe?: boolean;
  quickServeGroups?: any[];
  quickServeDishes?: any[];
  quickServeCategoryTitle?: string;
  quickServePaymodes?: any[];
}

export interface PaymentSuccessParams {
  orderId: string;
  total: number;
  paid: number;
  change: number;
  method: string;
}

/* ─────────────────────────────────────────────────────────────────────────
   ROLE GUARD
   ADMIN and CASHIER users are allowed to trigger Customer Display updates.
   Waiter, KDS, and all other roles are silently blocked.
   ───────────────────────────────────────────────────────────────────────── */
const isAllowedRole = (): boolean => {
  const user = useAuthStore.getState().user;
  if (!user) return false;
  return user.role === "ADMIN" || user.role === "CASHIER";
};

/* ─────────────────────────────────────────────────────────────────────────
   TERMINAL CODE
   Read current terminal from terminalStore. Appended to every payload so
   the server can route to the correct Socket.io room.
   ───────────────────────────────────────────────────────────────────────── */
const getTerminalCode = (): string | null => {
  return useTerminalStore.getState().terminalCode;
};

export const CustomerDisplaySync = {
  isPaymentActive: false,
  isSuccessActive: false,
  idleTimeout: null as any,

  cancelPendingIdle: () => {
    if (CustomerDisplaySync.idleTimeout) {
      clearTimeout(CustomerDisplaySync.idleTimeout);
      CustomerDisplaySync.idleTimeout = null;
    }
  },

  syncCart: (params: SyncCartParams) => {
    CustomerDisplaySync.isSuccessActive = false;
    CustomerDisplaySync.cancelPendingIdle();
    try {
      // 🛡️ ROLE GUARD: Only ADMIN users trigger Customer Display updates
      if (!isAllowedRole()) {
        console.log("🖥️ [CustomerDisplaySync] syncCart blocked — user role is not ADMIN.");
        return;
      }

      const isDisplayOn = useGeneralSettingsStore.getState().settings.customerSideDisplay;
      if (!isDisplayOn) return;

      const { orderContext, cart, discountInfo, gstPercentage, roundOff, active, orderId, paymentMethod, memberName, isSplit, splitPayments, takeawayCharge, isQuickServe, quickServeGroups, quickServeDishes, quickServeCategoryTitle, quickServePaymodes } = params;
      const companySettings = useCompanySettingsStore.getState().settings;
      const paymentSettings = usePaymentSettingsStore.getState().settings;

      const scPercentage = companySettings.serviceChargePercentage || 0;
      const twScPercentage = companySettings.twServiceChargePercentage || 0;
      const isTakeawayOrder = orderContext?.orderType === "TAKEAWAY";
      const scRate = isTakeawayOrder ? 0 : scPercentage / 100;
      const twScRate = twScPercentage / 100;
      const gstRate = (gstPercentage || 0) / 100;
      const takeawayChargeVal = takeawayCharge || 0;

      // 1. Calculate totals matching cashier formulas
      const { grossTotal, totalItemDiscount, scEligibleSubtotal, twScEligibleSubtotal } = cart.reduce(
        (acc, item) => {
          const isVoided = item.status === "VOIDED" || item.StatusCode === 0 || item.statusCode === 0;
          if (isVoided) return acc;
          
          const isCombo = item.isCombo === true || String(item.isCombo) === "1" || item.isCombo === 1;
          const discountBasis = isCombo ? (item.basePrice ?? item.price ?? 0) : (item.price ?? 0);
          const baseTotal = (item.price || 0) * item.qty;
          let itemDiscount = 0;
          const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
          const discType = item.discountType || 'percentage';
          
          if (discAmt > 0) {
            if (discType === 'percentage') {
              itemDiscount = (discountBasis * (discAmt / 100)) * item.qty;
            } else {
              itemDiscount = Math.min(discAmt, discountBasis) * item.qty;
            }
          }

          const itemSubtotal = baseTotal - itemDiscount;
          const isTakeawayItem = isTakeawayOrder || Boolean(item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway);
          const isSC = !isTakeawayItem && (Number(item.isServiceCharge) === 1 || item.isServiceCharge === true);

          return {
            grossTotal: acc.grossTotal + baseTotal,
            totalItemDiscount: acc.totalItemDiscount + itemDiscount,
            scEligibleSubtotal: acc.scEligibleSubtotal + (isSC ? itemSubtotal : 0),
            twScEligibleSubtotal: acc.twScEligibleSubtotal + (isTakeawayItem ? itemSubtotal : 0),
          };
        },
        { grossTotal: 0, totalItemDiscount: 0, scEligibleSubtotal: 0, twScEligibleSubtotal: 0 }
      );

      const subTotal = grossTotal - totalItemDiscount;

      const orderDiscountAmount = (() => {
        if (!discountInfo?.applied) return 0;
        if (discountInfo.type === "percentage") {
          return (subTotal * discountInfo.value) / 100;
        }
        return discountInfo.value;
      })();

      const netAfterDiscount = subTotal - orderDiscountAmount;

      // Pro-rate discount to sc-eligible items
      const scEligibleNet = (() => {
        if (subTotal <= 0) return 0;
        const proportion = scEligibleSubtotal / subTotal;
        return Math.max(0, scEligibleSubtotal - proportion * orderDiscountAmount);
      })();

      const twScEligibleNet = (() => {
        if (subTotal <= 0) return 0;
        const proportion = twScEligibleSubtotal / subTotal;
        return Math.max(0, twScEligibleSubtotal - proportion * orderDiscountAmount);
      })();

      const serviceChargeAmount = (scEligibleNet * scRate) + (twScEligibleNet * twScRate);
      const taxableAmount = netAfterDiscount + serviceChargeAmount + takeawayChargeVal;

      const gstAmountRaw = taxableAmount * gstRate;
      const gstAmount = Math.round(gstAmountRaw * 100) / 100;
      const baseTotalVal = taxableAmount + gstAmountRaw;
      const netTotal = Math.round(Math.max(0, baseTotalVal + roundOff) * 100) / 100;

      // 2. Prepare clean items list for display
      const displayItems = cart.map(item => {
        const isCombo = item.isCombo === true || String(item.isCombo) === "1" || item.isCombo === 1;
        const discountBasis = isCombo ? (item.basePrice ?? item.price ?? 0) : (item.price ?? 0);
        const baseTotal = (item.price || 0) * item.qty;
        let itemDiscount = 0;
        const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
        const discType = item.discountType || 'percentage';
        
        if (discAmt > 0) {
          if (discType === 'percentage') {
            itemDiscount = (discountBasis * (discAmt / 100)) * item.qty;
          } else {
            itemDiscount = Math.min(discAmt, discountBasis) * item.qty;
          }
        }
        const isVoided = item.status === "VOIDED" || item.StatusCode === 0 || item.statusCode === 0;

        return {
          lineItemId: item.lineItemId || item.id,
          name: item.name,
          qty: item.qty,
          price: item.price,
          originalPrice: item.price * item.qty,
          finalPrice: baseTotal - itemDiscount,
          discountAmount: itemDiscount,
          discountPercent: discType === 'percentage' ? discAmt : 0,
          isVoided,
          note: item.note || item.notes || "",
          modifiers: item.modifiers || [],
          isCombo: !!item.isCombo,
          comboSelections: item.comboSelections || [],
          isServiceCharge: !(item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway) && (Number(item.isServiceCharge) === 1 || item.isServiceCharge === true),
        };
      });

      // 3. Emit via Socket.io and update native presentation display
      const payload = {
        active,
        paymentSuccess: false,
        orderId,
        tableNo: orderContext.orderType === "DINE_IN" ? orderContext.tableNo : `TW-${orderContext.takeawayNo}`,
        orderType: orderContext.orderType,
        section: orderContext.section || "",
        items: displayItems,
        grossTotal,
        itemDiscounts: totalItemDiscount,
        subTotal,
        orderDiscountAmount,
        serviceChargeAmount,
        serviceChargePercentage: scPercentage,
        takeawayCharge: takeawayChargeVal,
        gstAmount,
        roundOff,
        netTotal,
        waiterName: orderContext.serverName || "",
        paymentMethod,
        memberName: memberName || "",
        isSplit: isSplit || false,
        splitPayments: splitPayments || [],
        terminalCode: getTerminalCode(), // 🖥️ Room routing key
        companyName: companySettings?.name || paymentSettings?.shopName || "Restaurant",
        companyLogo: companySettings?.companyLogo ? (companySettings.companyLogo.startsWith("data:") || companySettings.companyLogo.startsWith("http") ? companySettings.companyLogo : `${API_URL}${companySettings.companyLogo.startsWith("/") ? "" : "/"}${companySettings.companyLogo}`) : "",
        upiId: paymentSettings?.upiId || "",
        payNowQrUrl: paymentSettings?.payNowQrUrl ? (paymentSettings.payNowQrUrl.startsWith("data:") || paymentSettings.payNowQrUrl.startsWith("http") ? paymentSettings.payNowQrUrl : `${API_URL}${paymentSettings.payNowQrUrl.startsWith("/") ? "" : "/"}${paymentSettings.payNowQrUrl}`) : "",
        currencySymbol: companySettings?.currencySymbol || "₹",
        isQuickServe: isQuickServe || false,
        quickServeGroups: quickServeGroups || [],
        quickServeDishes: quickServeDishes || [],
        quickServeCategoryTitle: quickServeCategoryTitle || "",
        quickServePaymodes: quickServePaymodes || [],
      };

      console.log("🖥️ [CustomerDisplaySync] Emitting cart update for Table/Takeaway:", payload.tableNo, "| Terminal:", payload.terminalCode);
      socket.emit("customer_display_sync", payload);
      pushToLocalBridge(payload);

      if (Platform.OS === "android" && SunmiCustomerDisplay) {
        SunmiCustomerDisplay.updateCustomerDisplay(JSON.stringify(payload));
      }
    } catch (err: any) {
      console.error("🖥️ [CustomerDisplaySync] Failed to sync cart:", err.message);
    }
  },

  syncIdle: () => {
    CustomerDisplaySync.cancelPendingIdle();

    CustomerDisplaySync.idleTimeout = setTimeout(() => {
      CustomerDisplaySync.idleTimeout = null;
      try {
        // 🛡️ ROLE GUARD: Only ADMIN users trigger Customer Display updates
        if (!isAllowedRole()) {
          console.log("🖥️ [CustomerDisplaySync] syncIdle blocked — user role is not ADMIN.");
          return;
        }

        const isDisplayOn = useGeneralSettingsStore.getState().settings.customerSideDisplay;
        if (!isDisplayOn) return;

        if (CustomerDisplaySync.isPaymentActive) {
          console.log("🖥️ [CustomerDisplaySync] syncIdle blocked because payment is active");
          return;
        }

        if (CustomerDisplaySync.isSuccessActive) {
          console.log("🖥️ [CustomerDisplaySync] syncIdle blocked because success screen is active");
          return;
        }

        const companySettings = useCompanySettingsStore.getState().settings;
        const paymentSettings = usePaymentSettingsStore.getState().settings;

        const payload = {
          active: false,
          paymentSuccess: false,
          terminalCode: getTerminalCode(), // 🖥️ Room routing key
          companyName: companySettings?.name || paymentSettings?.shopName || "Restaurant",
          companyLogo: companySettings?.companyLogo ? (companySettings.companyLogo.startsWith("data:") || companySettings.companyLogo.startsWith("http") ? companySettings.companyLogo : `${API_URL}${companySettings.companyLogo.startsWith("/") ? "" : "/"}${companySettings.companyLogo}`) : "",
        };

        console.log("🖥️ [CustomerDisplaySync] Emitting idle attract loop | Terminal:", getTerminalCode());
        socket.emit("customer_display_sync", payload);
        pushToLocalBridge(payload);

        if (Platform.OS === "android" && SunmiCustomerDisplay) {
          SunmiCustomerDisplay.updateCustomerDisplay(JSON.stringify(payload));
        }
      } catch (err: any) {
        console.error("🖥️ [CustomerDisplaySync] Failed to sync idle state:", err.message);
      }
    }, 500);
  },

  syncPaymentSuccess: (params: PaymentSuccessParams) => {
    CustomerDisplaySync.isSuccessActive = true;
    CustomerDisplaySync.cancelPendingIdle();
    try {
      // 🛡️ ROLE GUARD: Only ADMIN users trigger Customer Display updates
      if (!isAllowedRole()) {
        console.log("🖥️ [CustomerDisplaySync] syncPaymentSuccess blocked — user role is not ADMIN.");
        return;
      }

      const isDisplayOn = useGeneralSettingsStore.getState().settings.customerSideDisplay;
      if (!isDisplayOn) return;

      const companySettings = useCompanySettingsStore.getState().settings;
      const paymentSettings = usePaymentSettingsStore.getState().settings;

      const payload = {
        active: true,
        paymentSuccess: true,
        orderId: params.orderId,
        netTotal: params.total,
        paid: params.paid,
        change: params.change,
        paymentMethod: params.method,
        terminalCode: getTerminalCode(), // 🖥️ Room routing key
        companyName: companySettings?.name || paymentSettings?.shopName || "Restaurant",
        currencySymbol: companySettings?.currencySymbol || "₹",
      };

      console.log("🖥️ [CustomerDisplaySync] Emitting payment success:", params.orderId, "| Terminal:", getTerminalCode());
      socket.emit("customer_display_sync", payload);
      pushToLocalBridge(payload);

      if (Platform.OS === "android" && SunmiCustomerDisplay) {
        SunmiCustomerDisplay.updateCustomerDisplay(JSON.stringify(payload));
      }
    } catch (err: any) {
      console.error("🖥️ [CustomerDisplaySync] Failed to sync payment success:", err.message);
    }
  }
};
