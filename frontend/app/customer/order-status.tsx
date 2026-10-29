import React, { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Alert,
  ScrollView,
  Platform,
  Image,
  ActivityIndicator,
  Modal,
  TextInput,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { Theme } from "../../constants/theme";
import { useCartStore, getContextId, setCurrentContext } from "../../stores/cartStore";
import { useOrderContextStore } from "../../stores/orderContextStore";
import { useCompanySettingsStore } from "../../stores/companySettingsStore";
import { useGeneralSettingsStore } from "../../stores/generalSettingsStore";
import { socket } from "../../constants/socket";
import { Ionicons } from "@expo/vector-icons";
import { API_URL } from "../../constants/Config";

const LogoutButtonWeb = ({ onConfirm }: { onConfirm: () => void }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const styleId = "animated-logout-style";
    if (document.getElementById(styleId)) return;

    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .logoutButton {
        --figure-duration: 100ms;
        --transform-figure: none;
        --walking-duration: 100ms;
        --transform-arm1: none;
        --transform-wrist1: none;
        --transform-arm2: none;
        --transform-wrist2: none;
        --transform-leg1: none;
        --transform-calf1: none;
        --transform-leg2: none;
        --transform-calf2: none;
        background: none;
        border: 0;
        color: #f4f7ff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        font-family: "Quicksand", sans-serif;
        font-size: 14px;
        font-weight: 700;
        height: 44px;
        outline: none;
        padding: 0 48px 0 24px;
        perspective: 100px;
        position: relative;
        text-align: left;
        width: 100%;
        flex: 1;
        box-sizing: border-box;
        -webkit-tap-highlight-color: transparent;
      }
      .logoutButton::before {
        background-color: #EF4444;
        border-radius: 12px;
        content: "";
        display: block;
        height: 100%;
        left: 0;
        position: absolute;
        top: 0;
        transform: none;
        transition: transform 50ms ease;
        width: 100%;
        z-index: 2;
      }
      .logoutButton:hover .door {
        transform: rotateY(20deg);
      }
      .logoutButton:active::before {
        transform: scale(0.96);
      }
      .logoutButton:active .door {
        transform: rotateY(28deg);
      }
      .logoutButton.clicked::before {
        transform: none;
      }
      .logoutButton.clicked .door {
        transform: rotateY(35deg);
      }
      .logoutButton.door-slammed .door {
        transform: none;
        transition: transform 100ms ease-in 250ms;
      }
      .logoutButton.falling {
        animation: shake 200ms linear;
      }
      .logoutButton.falling .bang {
        animation: flash 300ms linear;
      }
      .logoutButton.falling .figure {
        animation: spin 1000ms infinite linear;
        top: 1000px;
        opacity: 0;
        right: 1px;
        transition: transform calc(var(--figure-duration) * 1ms) linear, top calc(var(--figure-duration) * 1ms) cubic-bezier(0.7, 0.1, 1, 1) 100ms, opacity calc(var(--figure-duration) * 0.25ms) linear calc(var(--figure-duration) * 0.75ms);
        z-index: 1;
      }
      .button-text {
        color: #f4f7ff;
        font-weight: 700;
        position: relative;
        z-index: 10;
        white-space: nowrap;
      }
      .logoutButton svg {
        display: block;
        position: absolute;
      }
      .figure {
        top: 7px;
        fill: #ffffff;
        right: 18px;
        transform: var(--transform-figure);
        transition: transform calc(var(--figure-duration) * 1ms) cubic-bezier(0.2, 0.1, 0.8, 0.9);
        width: 30px;
        height: 30px;
        z-index: 4;
      }
      .door,
      .doorway {
        top: 6px;
        right: 12px;
        width: 32px;
        height: 32px;
      }
      .doorway {
        fill: #1e1e1e;
        z-index: 3;
      }
      .door {
        fill: #ffffff;
        transform: rotateY(20deg);
        transform-origin: 100% 50%;
        transform-style: preserve-3d;
        transition: transform 200ms ease;
        z-index: 5;
      }
      .door path {
        fill: #ffffff;
        stroke: #EF4444;
        stroke-width: 4;
      }
      .door circle {
        fill: #EF4444;
      }
      .bang {
        opacity: 0;
        fill: #ffffff;
      }
      .arm1, .wrist1, .arm2, .wrist2, .leg1, .calf1, .leg2, .calf2 {
        transition: transform calc(var(--walking-duration) * 1ms) ease-in-out;
      }
      .arm1 {
        transform: var(--transform-arm1);
        transform-origin: 52% 45%;
      }
      .wrist1 {
        transform: var(--transform-wrist1);
        transform-origin: 59% 55%;
      }
      .arm2 {
        transform: var(--transform-arm2);
        transform-origin: 47% 43%;
      }
      .wrist2 {
        transform: var(--transform-wrist2);
        transform-origin: 35% 47%;
      }
      .leg1 {
        transform: var(--transform-leg1);
        transform-origin: 47% 64.5%;
      }
      .calf1 {
        transform: var(--transform-calf1);
        transform-origin: 55.5% 71.5%;
      }
      .leg2 {
        transform: var(--transform-leg2);
        transform-origin: 43% 63%;
      }
      .calf2 {
        transform: var(--transform-calf2);
        transform-origin: 41.5% 73%;
      }
      @keyframes spin {
        from { transform: rotate(0deg) scale(0.94); }
        to { transform: rotate(359deg) scale(0.94); }
      }
      @keyframes shake {
        0% { transform: rotate(-1deg); }
        50% { transform: rotate(2deg); }
        100% { transform: rotate(-1deg); }
      }
      @keyframes flash {
        0% { opacity: 0.4; }
        100% { opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }, []);

  const handleClick = () => {
    const button = containerRef.current?.querySelector(".logoutButton") as HTMLElement;
    if (!button || button.classList.contains("clicked")) return;

    const logoutButtonStates: Record<string, Record<string, string>> = {
      default: {
        "--figure-duration": "100",
        "--transform-figure": "none",
        "--walking-duration": "100",
        "--transform-arm1": "none",
        "--transform-wrist1": "none",
        "--transform-arm2": "none",
        "--transform-wrist2": "none",
        "--transform-leg1": "none",
        "--transform-calf1": "none",
        "--transform-leg2": "none",
        "--transform-calf2": "none",
      },
      hover: {
        "--figure-duration": "100",
        "--transform-figure": "translateX(1.5px)",
        "--walking-duration": "100",
        "--transform-arm1": "rotate(-5deg)",
        "--transform-wrist1": "rotate(-15deg)",
        "--transform-arm2": "rotate(5deg)",
        "--transform-wrist2": "rotate(6deg)",
        "--transform-leg1": "rotate(-10deg)",
        "--transform-calf1": "rotate(5deg)",
        "--transform-leg2": "rotate(20deg)",
        "--transform-calf2": "rotate(-20deg)",
      },
      walking1: {
        "--figure-duration": "300",
        "--transform-figure": "translateX(11px)",
        "--walking-duration": "300",
        "--transform-arm1": "translateX(-4px) translateY(-2px) rotate(120deg)",
        "--transform-wrist1": "rotate(-5deg)",
        "--transform-arm2": "translateX(4px) rotate(-110deg)",
        "--transform-wrist2": "rotate(-5deg)",
        "--transform-leg1": "translateX(-3px) rotate(80deg)",
        "--transform-calf1": "rotate(-30deg)",
        "--transform-leg2": "translateX(4px) rotate(-60deg)",
        "--transform-calf2": "rotate(20deg)",
      },
      walking2: {
        "--figure-duration": "400",
        "--transform-figure": "translateX(17px)",
        "--walking-duration": "300",
        "--transform-arm1": "rotate(60deg)",
        "--transform-wrist1": "rotate(-15deg)",
        "--transform-arm2": "rotate(-45deg)",
        "--transform-wrist2": "rotate(6deg)",
        "--transform-leg1": "rotate(-5deg)",
        "--transform-calf1": "rotate(10deg)",
        "--transform-leg2": "rotate(10deg)",
        "--transform-calf2": "rotate(-20deg)",
      },
      falling1: {
        "--figure-duration": "1600",
        "--walking-duration": "400",
        "--transform-arm1": "rotate(-60deg)",
        "--transform-wrist1": "none",
        "--transform-arm2": "rotate(30deg)",
        "--transform-wrist2": "rotate(120deg)",
        "--transform-leg1": "rotate(-30deg)",
        "--transform-calf1": "rotate(-20deg)",
        "--transform-leg2": "rotate(20deg)",
      },
      falling2: {
        "--walking-duration": "300",
        "--transform-arm1": "rotate(-100deg)",
        "--transform-arm2": "rotate(-60deg)",
        "--transform-wrist2": "rotate(60deg)",
        "--transform-leg1": "rotate(80deg)",
        "--transform-calf1": "rotate(20deg)",
        "--transform-leg2": "rotate(-60deg)",
      },
      falling3: {
        "--walking-duration": "500",
        "--transform-arm1": "rotate(-30deg)",
        "--transform-wrist1": "rotate(40deg)",
        "--transform-arm2": "rotate(50deg)",
        "--transform-wrist2": "none",
        "--transform-leg1": "rotate(-30deg)",
        "--transform-leg2": "rotate(20deg)",
        "--transform-calf2": "none",
      },
    };

    const updateButtonState = (state: string) => {
      if (logoutButtonStates[state]) {
        for (let key in logoutButtonStates[state]) {
          button.style.setProperty(key, logoutButtonStates[state][key]);
        }
      }
    };

    button.classList.add("clicked");
    updateButtonState("walking1");

    setTimeout(() => {
      button.classList.add("door-slammed");
      updateButtonState("walking2");
      setTimeout(() => {
        button.classList.add("falling");
        updateButtonState("falling1");
        setTimeout(() => {
          updateButtonState("falling2");
          setTimeout(() => {
            updateButtonState("falling3");
            setTimeout(() => {
              onConfirm();
              button.classList.remove("clicked", "door-slammed", "falling");
              updateButtonState("default");
            }, 1000);
          }, 300);
        }, 400);
      }, 400);
    }, 300);
  };

  return (
    <div
      ref={containerRef}
      style={{ display: "inline-block", flex: 1 }}
      dangerouslySetInnerHTML={{
        __html: `
          <button class="logoutButton">
            <svg class="doorway" viewBox="0 0 100 100">
              <path d="M93.4 86.3H58.6c-1.9 0-3.4-1.5-3.4-3.4V17.1c0-1.9 1.5-3.4 3.4-3.4h34.8c1.9 0 3.4 1.5 3.4 3.4v65.8c0 1.9-1.5 3.4-3.4 3.4z" />
              <path class="bang" d="M40.5 43.7L26.6 31.4l-2.5 6.7zM41.9 50.4l-19.5-4-1.4 6.3zM40 57.4l-17.7 3.9 3.9 5.7z" />
            </svg>
            <svg class="figure" viewBox="0 0 100 100">
              <circle cx="52.1" cy="32.4" r="6.4" />
              <path d="M50.7 62.8c-1.2 2.5-3.6 5-7.2 4-3.2-.9-4.9-3.5-4-7.8.7-3.4 3.1-13.8 4.1-15.8 1.7-3.4 1.6-4.6 7-3.7 4.3.7 4.6 2.5 4.3 5.4-.4 3.7-2.8 15.1-4.2 17.9z" />
              <g class="arm1">
                <path d="M55.5 56.5l-6-9.5c-1-1.5-.6-3.5.9-4.4 1.5-1 3.7-1.1 4.6.4l6.1 10c1 1.5.3 3.5-1.1 4.4-1.5.9-3.5.5-4.5-.9z" />
                <path class="wrist1" d="M69.4 59.9L58.1 58c-1.7-.3-2.9-1.9-2.6-3.7.3-1.7 1.9-2.9 3.7-2.6l11.4 1.9c1.7.3 2.9 1.9 2.6 3.7-.4 1.7-2 2.9-3.8 2.6z" />
              </g>
              <g class="arm2">
                <path d="M34.2 43.6L45 40.3c1.7-.6 3.5.3 4 2 .6 1.7-.3 4-2 4.5l-10.8 2.8c-1.7.6-3.5-.3-4-2-.6-1.6.3-3.4 2-4z" />
                <path class="wrist2" d="M27.1 56.2L32 45.7c.7-1.6 2.6-2.3 4.2-1.6 1.6.7 2.3 2.6 1.6 4.2L33 58.8c-.7 1.6-2.6 2.3-4.2 1.6-1.7-.7-2.4-2.6-1.7-4.2z" />
              </g>
              <g class="leg1">
                <path d="M52.1 73.2s-7-5.7-7.9-6.5c-.9-.9-1.2-3.5-.1-4.9 1.1-1.4 3.8-1.9 5.2-.9l7.9 7c1.4 1.1 1.7 3.5.7 4.9-1.1 1.4-4.4 1.5-5.8.4z" />
                <path class="calf1" d="M52.6 84.4l-1-12.8c-.1-1.9 1.5-3.6 3.5-3.7 2-.1 3.7 1.4 3.8 3.4l1 12.8c.1 1.9-1.5 3.6-3.5 3.7-2 0-3.7-1.5-3.8-3.4z" />
              </g>
              <g class="leg2">
                <path d="M37.8 72.7s1.3-10.2 1.6-11.4 2.4-2.8 4.1-2.6c1.7.2 3.6 2.3 3.4 4l-1.8 11.1c-.2 1.7-1.7 3.3-3.4 3.1-1.8-.2-4.1-2.4-3.9-4.2z" />
                <path class="calf2" d="M29.5 82.3l9.6-10.9c1.3-1.4 3.6-1.5 5.1-.1 1.5 1.4.4 4.9-.9 6.3l-8.5 9.6c-1.3 1.4-3.6 1.5-5.1.1-1.4-1.3-1.5-3.5-.2-5z" />
              </g>
            </svg>
            <svg class="door" viewBox="0 0 100 100">
              <path d="M93.4 86.3H58.6c-1.9 0-3.4-1.5-3.4-3.4V17.1c0-1.9 1.5-3.4 3.4-3.4h34.8c1.9 0 3.4 1.5 3.4 3.4v65.8c0 1.9-1.5 3.4-3.4 3.4z" />
              <circle cx="66" cy="50" r="3.7" />
            </svg>
            <span class="button-text">Yes, Log Out</span>
          </button>
        `,
      }}
      onClick={handleClick}
    />
  );
};

export default function CustomerOrderStatusScreen() {
  const router = useRouter();
  const { carts, currentContextId, fetchCartFromDB, checkoutOrder } = useCartStore();
  const orderContext = useOrderContextStore((state) => state.currentOrder);
  const settings = useCompanySettingsStore((state: any) => state.settings);
  const generalSettings = useGeneralSettingsStore((state: any) => state.settings);
  const currencySymbol = settings?.currencySymbol ?? settings?.CurrencySymbol ?? "$";
  const enableOnlinePayment = generalSettings?.enableOnlinePayment !== false && generalSettings?.EnableOnlinePayment !== false;
  const enableRequestService = generalSettings?.enableRequestService !== false;

  const currentCart = currentContextId ? carts[currentContextId] || [] : [];
  const activeItems = currentCart.filter((item) => item.status && item.status !== "VOIDED");
  const allServed = activeItems.length > 0 && activeItems.every((item) => item.status === "SERVED");

  // Determine overall status
  const getOverallStatus = () => {
    if (activeItems.length === 0) return "No active orders";
    const hasSent = activeItems.some((i) => i.status === "SENT");
    const hasReady = activeItems.some((i) => i.status === "READY");
    const allServed = activeItems.every((i) => i.status === "SERVED");

    if (allServed) return "All Served";
    if (hasReady) return "Ready to Serve";
    if (hasSent) return "Preparing in Kitchen";
    return "Received";
  };

  const [isSettled, setIsSettled] = useState(false);
  const [showConfirmBillModal, setShowConfirmBillModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [isSessionClosed, setIsSessionClosed] = useState(false);
  const [upiId, setUpiId] = useState<string | null>(null);
  const [loadingUpi, setLoadingUpi] = useState(false);
  const [paymentSent, setPaymentSent] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"cashier" | "online" | null>(null);
  const [onlineStep, setOnlineStep] = useState<"summary" | "qr">("summary");
  const [isProcessingCashier, setIsProcessingCashier] = useState(false);

  const [promoInput, setPromoInput] = useState("");
  const [promoError, setPromoError] = useState("");
  const [validatingPromo, setValidatingPromo] = useState(false);
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; amount: number; discountType?: string } | null>(null);
  const [memberPromo, setMemberPromo] = useState<{ code: string; amount: number; discountType?: string } | null>(null);
  const [userInfo, setUserInfo] = useState<any | null>(null);
  const [promoModal, setPromoModal] = useState<{ visible: boolean; title: string; message: string; type: "success" | "error" }>({
    visible: false,
    title: "",
    message: "",
    type: "error",
  });

  const fetchMemberPromoDetails = () => {
    if (typeof localStorage === "undefined") return;
    const stored = localStorage.getItem("qr_pos_user");
    if (!stored) return;
    try {
      const userObj = JSON.parse(stored);
      setUserInfo(userObj);
      const code = (userObj?.PromoCode || userObj?.Promocode || userObj?.promoCode || "").trim();
      if (code) {
        fetch(`${API_URL}/api/members/promocode/${encodeURIComponent(code)}`)
          .then((res) => res.json())
          .then((data) => {
            if (data && data.Promocode && Number(data.Promoamount || 0) > 0) {
              setMemberPromo({
                code: data.Promocode,
                amount: Number(data.Promoamount || 0),
                discountType: (data.DiscountType || "AMOUNT").toUpperCase(),
              });
            }
          })
          .catch(() => {});
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchMemberPromoDetails();
    useGeneralSettingsStore.getState().fetchSettings?.().catch(() => {});
  }, []);

  useEffect(() => {
    if (orderContext) {
      const ctxId = getContextId(orderContext);
      if (ctxId) {
        setCurrentContext(ctxId);
      }
      const targetTableId = orderContext.tableId || orderContext.tableNo;
      if (targetTableId) {
        // 🚀 FORCE FETCH: Bypasses Latency Shield since we navigate here immediately after placing an order
        fetchCartFromDB(targetTableId, true);
      }
    }
  }, [orderContext]);

  useEffect(() => {
    if (!orderContext?.tableId) return;
    const tableId = String(orderContext.tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
    socket.emit("join_table", { tableId });

    const handleOrderClosed = (payload: { tableId?: string }) => {
      const cleanTarget = String(payload.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
      const cleanCurrent = String(orderContext.tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
      if (cleanTarget === cleanCurrent) {
        setIsSettled(true);
      }
    };

    const handleTableStatus = (payload: { tableId?: string; status?: number | string }) => {
      const cleanTarget = String(payload.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
      const cleanCurrent = String(orderContext.tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
      if (cleanTarget === cleanCurrent && (payload.status === 0 || payload.status === 'EMPTY')) {
        setIsSettled(true);
      }
    };

    const handleCartUpdated = (data: { tableId: string; source?: string }) => {
      const cleanTarget = String(data.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
      const cleanCurrent = String(orderContext.tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
      if (cleanTarget === cleanCurrent && orderContext.tableId) {
        fetchCartFromDB(orderContext.tableId, true);
      }
    };

    socket.on("order_closed", handleOrderClosed);
    socket.on("table_status_updated", handleTableStatus);
    socket.on("cart_updated", handleCartUpdated);

    return () => {
      socket.off("order_closed", handleOrderClosed);
      socket.off("table_status_updated", handleTableStatus);
      socket.off("cart_updated", handleCartUpdated);
    };
  }, [orderContext]);

  const showPromoAlert = (title: string, msg: string, type: "success" | "error" = "error") => {
    setPromoModal({ visible: true, title, message: msg, type });
  };

  const handleApplyPromoCode = async (codeOverride?: string) => {
    setPromoError("");
    const targetCode = typeof codeOverride === "string" ? codeOverride : promoInput;
    const codeToVerify = targetCode.trim().toUpperCase();
    if (!codeToVerify) {
      const errMsg = "Please enter a promo code.";
      setPromoError(errMsg);
      showPromoAlert("Invalid Promo Code", errMsg, "error");
      return;
    }
    setValidatingPromo(true);
    try {
      const res = await fetch(`${API_URL}/api/members/promocode/${encodeURIComponent(codeToVerify)}`);
      const data = await res.json();
      if (res.ok && data.Promocode) {
        const amt = Number(data.Promoamount || data.DiscountValue || 0);
        if (amt <= 0) {
          const errMsg = "This promo code has no remaining balance.";
          setPromoError(errMsg);
          showPromoAlert("Invalid Promo Code", errMsg, "error");
          return;
        }
        const discType = (data.DiscountType || "AMOUNT").toUpperCase();
        setAppliedPromo({ code: data.Promocode, amount: amt, discountType: discType });
        setPromoInput("");
        setPromoError("");
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("promoCode", data.Promocode);
        }

        // 🚀 Deduct promo amount in backend MemberMaster & update used counter
        fetch(`${API_URL}/api/members/deduct-promo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            promoCode: data.Promocode,
            amount: amt,
          }),
        }).catch((e) => console.error("Error deducting promo balance:", e));

        // Update local state if member promo was used
        setMemberPromo((prev) => {
          if (!prev || prev.code !== data.Promocode) return prev;
          const rem = prev.amount - amt;
          return rem > 0 ? { ...prev, amount: rem } : null;
        });

        showPromoAlert("Promo Applied!", `Promo code ${data.Promocode} applied successfully.`, "success");
      } else {
        const errMsg = data.error || "Invalid or inactive promo code.";
        setPromoError(errMsg);
        showPromoAlert("Invalid Promo Code", errMsg, "error");
      }
    } catch (err) {
      console.error("Promo verification error:", err);
      const errMsg = "Could not verify promo code. Please try again.";
      setPromoError(errMsg);
      showPromoAlert("Error", errMsg, "error");
    } finally {
      setValidatingPromo(false);
    }
  };

  const handleRemovePromo = () => {
    setAppliedPromo(null);
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("promoCode");
    }
  };

  const confirmLogout = () => {
    if (orderContext?.tableId) {
      useCartStore.getState().clearTableSession(orderContext.tableId);
    }
    useOrderContextStore.getState().setOrderContext(null as any);
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("isLoggedIn");
      localStorage.removeItem("qr_pos_user");
    }
    setShowLogoutModal(false);
    setIsSessionClosed(true);
  };

  if (isSessionClosed) {
    const isMobileBrowser =
      typeof navigator !== "undefined" &&
      /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

    return (
      <View style={styles.sessionClosedContainer}>
        <View style={styles.sessionClosedCard}>
          <View style={styles.sessionClosedIconWrap}>
            <Ionicons name="checkmark-circle-outline" size={64} color="#10B981" />
          </View>
          <Text style={styles.sessionClosedTitle}>Session Closed</Text>
          <Text style={styles.sessionClosedSubtitle}>
            Thank you for dining with us!{"\n"}Your session has been closed.
          </Text>
          {!isMobileBrowser && (
            <TouchableOpacity
              style={styles.closeWindowBtn}
              onPress={() => {
                try { window.close(); } catch (e) {}
              }}
            >
              <Ionicons name="power-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.closeWindowBtnText}>Close Tab</Text>
            </TouchableOpacity>
          )}
          {isMobileBrowser && (
            <Text style={styles.mobileCloseHint}>You may now close this tab manually.</Text>
          )}
        </View>
      </View>
    );
  }
  if (isSettled) {
    return (
      <View style={styles.settledContainer}>
        <View style={styles.settledCard}>
          <View style={styles.checkWrap}>
            <Ionicons name="sparkles" size={48} color={Theme.primary} />
          </View>
          <Text style={styles.settledTitle}>Thank You!</Text>
          <Text style={styles.settledSubtitle}>Your order has been fully settled and paid. We hope you enjoyed your meal!</Text>
          
          <TouchableOpacity 
            style={styles.doneBtn} 
            onPress={() => {
              const tid = orderContext?.tableId;
              const tno = orderContext?.tableNo;
              const sec = orderContext?.section || "SECTION_1";
              if (tid) {
                useCartStore.getState().clearTableSession(tid);
              }
              if (tid && tno) {
                router.replace({
                  pathname: "/customer/menu" as any,
                  params: { tableId: tid, tableNo: tno, section: sec },
                });
              } else {
                router.replace("/customer/menu" as any);
              }
            }}
          >
            <Text style={styles.doneBtnText}>Back to Menu</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const executeSendRequest = async (type: string) => {
    if (!orderContext?.tableId || !orderContext?.tableNo) return;
    // Emit real-time customer request via socket
    socket.emit("customer_request", {
      tableNo: orderContext.tableNo,
      tableId: orderContext.tableId,
      type: type,
      timestamp: Date.now(),
    });
  };

  const fetchUpiId = async () => {
    setLoadingUpi(true);
    try {
      const res = await fetch(`${API_URL}/api/settings`);
      const data = await res.json();
      // AppSettings stores UPI as UPI_ID
      setUpiId(data?.UPI_ID || data?.upiId || null);
    } catch (e) {
      setUpiId(null);
    } finally {
      setLoadingUpi(false);
    }
  };

  const handleConfirmBill = async () => {
    setShowConfirmBillModal(false);
    // Fetch UPI settings in background while showing payment modal
    fetchUpiId();
    setShowPaymentModal(true);
  };

  const handlePayAtCashier = async () => {
    if (!orderContext?.tableId || !orderContext?.tableNo) return;
    setIsProcessingCashier(true);
    
    try {
      await checkoutOrder(orderContext.tableId);
    } catch (err) {
      console.error("Checkout error:", err);
    }
    
    executeSendRequest("Request Bill");
    
    setTimeout(() => {
      setIsProcessingCashier(false);
      setPaymentMethod("cashier");
      setPaymentSent(true);
    }, 1800);
  };

  // Active items and totals for Online Payment summary
  const activeCartItems = currentCart.filter((item) => item.status && item.status !== "VOIDED" && (item as any).statusCode !== 0);
  const orderSubtotal = activeCartItems.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.qty || 1)), 0);

  const activePromoCode = appliedPromo?.code || "";
  const activePromoAmount = appliedPromo?.amount || 0;
  const activeDiscountType = (appliedPromo?.discountType || "AMOUNT").toUpperCase();
  const isPercentageDiscount = activeDiscountType === "PERCENTAGE" || activeDiscountType === "PERCENT";

  let rawDiscount = 0;
  if (appliedPromo && activePromoCode && activePromoAmount > 0) {
    if (isPercentageDiscount) {
      rawDiscount = orderSubtotal * (activePromoAmount / 100);
    } else {
      rawDiscount = Math.min(orderSubtotal, activePromoAmount);
    }
  }
  const orderDiscountAmt = Math.max(0, Math.min(orderSubtotal, rawDiscount));
  const orderNetSubtotal = Math.max(0, orderSubtotal - orderDiscountAmt);

  const serviceChargePercentage = Number(settings?.serviceChargePercentage ?? settings?.ServiceChargePercentage ?? 0);
  const gstPercentage = Number(settings?.gstPercentage ?? settings?.GSTPercentage ?? 0);
  const takeawayChargeRate = Number(settings?.takeawayCharges ?? settings?.TakeawayCharges ?? settings?.takeawayCharge ?? settings?.TakeawayCharge ?? 0);

  const scEligibleSubtotal = activeCartItems.reduce((sum, item) => {
    const isTakeaway = item.isTakeaway === true || String(item.isTakeaway) === "1" || String(item.isTakeaway).toLowerCase() === "true" || (item as any).IsTakeaway === true || String((item as any).IsTakeaway) === "1" || String((item as any).IsTakeaway).toLowerCase() === "true";
    const isSC = !isTakeaway && (Number(item.isServiceCharge) === 1 || item.isServiceCharge === true || Number((item as any).IsServiceCharge) === 1 || (item as any).IsServiceCharge === true);
    if (isSC) {
      return sum + (item.price || 0) * (item.qty || 0);
    }
    return sum;
  }, 0);

  const takeawayItemsQty = activeCartItems.reduce((sum, item) => {
    const isTakeaway = item.isTakeaway === true || String(item.isTakeaway) === "1" || String(item.isTakeaway).toLowerCase() === "true" || (item as any).IsTakeaway === true || String((item as any).IsTakeaway) === "1" || String((item as any).IsTakeaway).toLowerCase() === "true";
    if (isTakeaway) {
      return sum + (item.qty || 0);
    }
    return sum;
  }, 0);
  const takeawayChargeAmt = takeawayItemsQty * takeawayChargeRate;

  const serviceChargeAmt = Math.max(0, scEligibleSubtotal - orderDiscountAmt) * (serviceChargePercentage / 100);
  const totalBeforeGst = orderNetSubtotal + serviceChargeAmt + takeawayChargeAmt;
  const gstAmt = totalBeforeGst * (gstPercentage / 100);
  const grandTotal = totalBeforeGst + gstAmt;

  const handleOnlinePayment = () => {
    setPaymentMethod("online");
    setPaymentSent(true);
    setOnlineStep("summary");
  };

  const handleTriggerYeahPay = () => {
    const amountToPay = grandTotal.toFixed(2);
    const currentOrdId = (orderContext as any)?.orderId || orderContext?.tableNo || "ORDER1";
    const demoUrl = `https://yeahpay-demo-production.up.railway.app?amount=${amountToPay}&orderId=${encodeURIComponent(currentOrdId)}&posOrderId=${encodeURIComponent(currentOrdId)}&from=pos`;
    
    if (typeof window !== "undefined") {
      const paymentWindow = window.open(demoUrl, '_blank', 'width=500,height=700');
      if (!paymentWindow) {
        Alert.alert("Popup Blocked", "Please allow popups for this site to open YeahPay payment.");
        return;
      }

      const handleMessage = async (event: MessageEvent) => {
        if (event.data && event.data.type === 'YEAHPAY_PAYMENT_SUCCESS') {
          window.removeEventListener('message', handleMessage);
          if (paymentWindow && !paymentWindow.closed) {
            paymentWindow.close();
          }

          // Complete online payment in backend & close table
          try {
            await fetch(`${API_URL}/api/order/complete-online-payment`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderId: currentOrdId,
                tableNo: orderContext?.tableNo,
                tableId: orderContext?.tableId,
                totalAmount: grandTotal,
                paymentMethod: "Yeahpay Paynow"
              })
            });
          } catch (e) {
            console.error("Online payment completion error:", e);
          }

          setShowPaymentModal(false);
          setPaymentSent(false);
          setPaymentMethod(null);
          executeSendRequest("Paid Online via YeahPay");
          Alert.alert("Payment Successful!", `Thank you! Your payment of ${currencySymbol}${amountToPay} via YeahPay was received.`);
        }
      };

      window.addEventListener('message', handleMessage);
    }
  };

  const handleSendRequest = async (type: string) => {
    if (!orderContext?.tableNo || !orderContext?.tableId) {
      Alert.alert("Error", "No active table session found.");
      return;
    }
    if (type === "Request Bill") {
      setShowConfirmBillModal(true);
    } else {
      executeSendRequest(type);
      Alert.alert("Request Sent", `A waiter has been notified for: ${type}`);
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case "SERVED":
        return "#10B981"; // Green
      case "READY":
        return "#3B82F6"; // Blue
      case "SENT":
        return "#F59E0B"; // Amber
      default:
        return "#64748B";
    }
  };

  const handleLogout = () => {
    setShowLogoutModal(true);
  };


  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.replace("/customer/menu")}>
          <Ionicons name="chevron-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Order Status</Text>
        <TouchableOpacity
          style={{
            padding: 6,
            borderRadius: 8,
            backgroundColor: "#FEF2F2",
            alignItems: "center",
            justifyContent: "center",
          }}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={20} color="#EF4444" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Status Card */}
        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>Current Table Status</Text>
          <Text style={styles.statusValue}>{getOverallStatus()}</Text>
          
          {/* Tracking timeline */}
          <View style={styles.timeline}>
            <View style={styles.timelineStep}>
              <View style={[styles.stepDot, { backgroundColor: Theme.primary }]} />
              <Text style={styles.stepText}>Received</Text>
            </View>
            <View style={styles.timelineLine} />
            <View style={styles.timelineStep}>
              <View
                style={[
                  styles.stepDot,
                  {
                    backgroundColor:
                      getOverallStatus() !== "Received" && getOverallStatus() !== "No active orders"
                        ? Theme.primary
                        : "#E2E8F0",
                  },
                ]}
              />
              <Text style={styles.stepText}>Preparing</Text>
            </View>
            <View style={styles.timelineLine} />
            <View style={styles.timelineStep}>
              <View
                style={[
                  styles.stepDot,
                  {
                    backgroundColor:
                      getOverallStatus() === "All Served"
                        ? Theme.primary
                        : "#E2E8F0",
                  },
                ]}
              />
              <Text style={styles.stepText}>Served</Text>
            </View>
          </View>
        </View>

        {/* Quick Customer Requests */}
        {enableRequestService && (
          <>
            <Text style={styles.sectionTitle}>Request Service</Text>
            <View style={styles.requestsGrid}>
              <Pressable
                style={({ pressed, hovered }: any) => [
                  styles.requestBtn,
                  hovered && { backgroundColor: "#FFF8F2", borderColor: Theme.primary, elevation: 3 },
                  pressed && { backgroundColor: "#FFEFE0", transform: [{ scale: 0.96 }] }
                ]}
                onPress={() => handleSendRequest("Call Waiter")}
              >
                <Ionicons name="notifications-outline" size={24} color={Theme.primary} />
                <Text style={styles.requestBtnText}>Call Waiter</Text>
              </Pressable>
              <Pressable
                style={({ pressed, hovered }: any) => [
                  styles.requestBtn,
                  hovered && { backgroundColor: "#FFF8F2", borderColor: Theme.primary, elevation: 3 },
                  pressed && { backgroundColor: "#FFEFE0", transform: [{ scale: 0.96 }] }
                ]}
                onPress={() => handleSendRequest("Request Water")}
              >
                <Ionicons name="water-outline" size={24} color={Theme.primary} />
                <Text style={styles.requestBtnText}>Water</Text>
              </Pressable>
              <Pressable
                style={({ pressed, hovered }: any) => [
                  styles.requestBtn,
                  hovered && { backgroundColor: "#FFF8F2", borderColor: Theme.primary, elevation: 3 },
                  pressed && { backgroundColor: "#FFEFE0", transform: [{ scale: 0.96 }] }
                ]}
                onPress={() => handleSendRequest("Request Spoon/Fork")}
              >
                <Ionicons name="restaurant-outline" size={24} color={Theme.primary} />
                <Text style={styles.requestBtnText}>Cutlery</Text>
              </Pressable>
              <Pressable
                style={({ pressed, hovered }: any) => [
                  styles.requestBtn,
                  hovered && { backgroundColor: "#FFF8F2", borderColor: Theme.primary, elevation: 3 },
                  pressed && { backgroundColor: "#FFEFE0", transform: [{ scale: 0.96 }] }
                ]}
                onPress={() => handleSendRequest("Request Tissue")}
              >
                <Ionicons name="document-text-outline" size={24} color={Theme.primary} />
                <Text style={styles.requestBtnText}>Tissue</Text>
              </Pressable>
              {allServed && (
                <Pressable
                  style={({ pressed, hovered }: any) => [
                    styles.requestBtn,
                    hovered && { backgroundColor: "#FFF8F2", borderColor: Theme.primary, elevation: 3 },
                    pressed && { backgroundColor: "#FFEFE0", transform: [{ scale: 0.96 }] }
                  ]}
                  onPress={() => handleSendRequest("Request Bill")}
                >
                  <Ionicons name="wallet-outline" size={24} color={Theme.primary} />
                  <Text style={styles.requestBtnText}>Request Bill</Text>
                </Pressable>
              )}
            </View>
          </>
        )}

        {/* Ordered items details */}
        <Text style={styles.sectionTitle}>Order Details</Text>
        {activeItems.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No items ordered yet.</Text>
          </View>
        ) : (
          activeItems.map((item) => (
            <View key={item.lineItemId} style={styles.itemRow}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={styles.itemName}>{item.name}</Text>

                {/* Combo Selections */}
                {item.isCombo && item.comboSelections && item.comboSelections.length > 0 && (
                  <View style={styles.comboSelectionsContainer}>
                    {item.comboSelections.map((group: any, gIdx: number) => {
                      const groupItemsText = group.items?.map((opt: any) => opt.name).join(", ");
                      return (
                        <Text key={gIdx} style={styles.comboSelectionText}>
                          {group.groupName}: {groupItemsText}
                        </Text>
                      );
                    })}
                  </View>
                )}

                {/* Regular Modifiers */}
                {item.modifiers && item.modifiers.length > 0 && (
                  <View style={styles.modifierContainer}>
                    {item.modifiers.map((m: any, idx: number) => {
                      const name = m.ModifierName || m.modifierName || m.name || "";
                      const price = Number(m.Price || m.price || 0);
                      return (
                        <View key={idx} style={styles.modifierTag}>
                          <Text style={styles.modifierBullet}>•</Text>
                          <Text style={styles.modifierName}>{name}</Text>
                          {price > 0 && (
                            <Text style={styles.modifierPrice}> (+{currencySymbol}{price.toFixed(2)})</Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}

                <Text style={styles.itemQty}>Qty: {item.qty}</Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) + "20" }]}>
                <Text style={[styles.statusBadgeText, { color: getStatusColor(item.status) }]}>
                  {item.status || "SENT"}
                </Text>
              </View>
            </View>
          ))
        )}

        {/* Add Dish Button */}
        <TouchableOpacity 
          style={styles.addDishButton} 
          onPress={() => router.replace("/customer/menu" as any)}
        >
          <Ionicons name="add-circle-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.addDishButtonText}>Add Dish (Order More)</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Step 1: Confirm Bill Modal */}
      {showConfirmBillModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.iconContainer}>
              <Ionicons name="wallet-outline" size={32} color={Theme.primary} />
            </View>
            <Text style={styles.modalTitle}>Request Bill</Text>
            <Text style={styles.modalSubtitle}>Are you sure you want to request your bill? This will notify our staff to prepare your invoice.</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={[styles.modalButton, styles.cancelBtn]} 
                onPress={() => setShowConfirmBillModal(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.modalButton, styles.confirmBtn]} 
                onPress={handleConfirmBill}
              >
                <Text style={styles.confirmBtnText}>Confirm</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

      {/* Step 2: Payment Method Modal */}
      {showPaymentModal && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 380 }]}>
            {isProcessingCashier ? (
              <View style={{ alignItems: "center", paddingVertical: 32, width: "100%" }}>
                <ActivityIndicator size="large" color={Theme.primary} style={{ marginBottom: 20 }} />
                <Text style={{ fontSize: 18, fontWeight: "800", color: "#0F172A", marginBottom: 8, textAlign: "center" }}>Notifying Cashier...</Text>
                <Text style={{ fontSize: 13, color: "#64748B", textAlign: "center", lineHeight: 18, paddingHorizontal: 16 }}>Sending request to the service team. Please wait a moment...</Text>
              </View>
            ) : !paymentSent ? (
              <>
                <View style={styles.iconContainer}>
                  <Ionicons name="card-outline" size={32} color={Theme.primary} />
                </View>
                <Text style={styles.modalTitle}>Choose Payment</Text>
                <Text style={styles.modalSubtitle}>How would you like to pay?</Text>

                {/* Pay at Cashier */}
                <Pressable
                  style={({ pressed, hovered }: any) => [
                    styles.payOptionBtn,
                    (hovered || pressed) && { backgroundColor: "#FFF8F2", borderColor: Theme.primary, elevation: 3 }
                  ]}
                  onPress={handlePayAtCashier}
                >
                  <View style={styles.payOptionIcon}>
                    <Ionicons name="storefront-outline" size={28} color={Theme.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.payOptionTitle}>Pay at Cashier</Text>
                    <Text style={styles.payOptionDesc}>Staff will be notified to come to your table</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
                </Pressable>

                {/* Online Payment (Only rendered when enableOnlinePayment setting is ON) */}
                {enableOnlinePayment && (
                  <Pressable
                    style={({ pressed, hovered }: any) => [
                      styles.payOptionBtn,
                      (hovered || pressed) && { backgroundColor: "#FFF8F2", borderColor: Theme.primary, elevation: 3 }
                    ]}
                    onPress={handleOnlinePayment}
                  >
                    <View style={styles.payOptionIcon}>
                      <Ionicons name="qr-code-outline" size={28} color="#8B5CF6" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.payOptionTitle}>Online Payment</Text>
                      <Text style={styles.payOptionDesc}>Pay via PayNow / QR code</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
                  </Pressable>
                )}

                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelBtn, { marginTop: 8, width: "100%" }]}
                  onPress={() => { setShowPaymentModal(false); setPaymentSent(false); setPaymentMethod(null); }}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : paymentMethod === "cashier" ? (
              /* Cashier confirmation */
              <>
                <View style={[styles.iconContainer, { backgroundColor: "#D1FAE5" }]}>
                  <Ionicons name="checkmark-circle" size={40} color="#10B981" />
                </View>
                <Text style={styles.modalTitle}>Staff Notified!</Text>
                <Text style={styles.modalSubtitle}>Our staff is on the way. Please wait at your table and pay at the cashier.</Text>
                <TouchableOpacity
                  style={[styles.modalButton, styles.confirmBtn, { width: "100%", marginTop: 8 }]}
                  onPress={() => { setShowPaymentModal(false); setPaymentSent(false); setPaymentMethod(null); }}
                >
                  <Text style={styles.confirmBtnText}>Done</Text>
                </TouchableOpacity>
              </>
            ) : onlineStep === "summary" ? (
              /* Online Payment Step 1: Bill & Promo Code Summary */
              <View style={{ width: "100%", alignItems: "center" }}>
                <View style={[styles.iconContainer, { backgroundColor: "#EDE9FE" }]}>
                  <Ionicons name="receipt-outline" size={32} color="#8B5CF6" />
                </View>
                <Text style={styles.modalTitle}>Bill Summary</Text>
                <Text style={styles.modalSubtitle}>Review your order bill and apply promo code before payment.</Text>

                {/* Promo Code Section */}
                <View style={{ width: "100%", marginVertical: 12 }}>
                  <Text style={{ fontSize: 13, fontWeight: "700", color: "#1E293B", marginBottom: 6 }}>Promo Code</Text>
                  {appliedPromo ? (
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#FFF2EC", padding: 10, borderRadius: 10, borderWidth: 1, borderColor: "#FFD2BD" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, fontWeight: "700", color: "#1E293B" }}>Promo Applied: {appliedPromo.code}</Text>
                        <Text style={{ fontSize: 11, color: "#64748B", marginTop: 2 }}>Discount: -{currencySymbol}{orderDiscountAmt.toFixed(2)}</Text>
                      </View>
                      <TouchableOpacity style={{ backgroundColor: "#FFE4E6", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 }} onPress={handleRemovePromo}>
                        <Text style={{ fontSize: 11, fontWeight: "700", color: "#E11D48" }}>Remove</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                        <TextInput
                          style={{ flex: 1, backgroundColor: "#FFF", borderWidth: 1, borderColor: promoError ? "#EF4444" : "#CBD5E1", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: "#0F172A" }}
                          placeholder="Enter Promo Code (e.g. PROMO10)"
                          placeholderTextColor="#94A3B8"
                          value={promoInput}
                          onChangeText={(t) => { setPromoInput(t); setPromoError(""); }}
                          autoCapitalize="characters"
                        />
                        <TouchableOpacity
                          style={{ backgroundColor: promoInput.trim() ? Theme.primary : "#CBD5E1", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, justifyContent: "center", alignItems: "center" }}
                          disabled={!promoInput.trim() || validatingPromo}
                          onPress={() => handleApplyPromoCode()}
                        >
                          {validatingPromo ? (
                            <ActivityIndicator size="small" color="#FFF" />
                          ) : (
                            <Text style={{ color: "#FFF", fontWeight: "700", fontSize: 13 }}>Apply</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                      {!!promoError && (
                        <Text style={{ color: "#EF4444", fontSize: 12, fontWeight: "600", marginTop: 6 }}>
                          ⚠️ {promoError}
                        </Text>
                      )}

                      {memberPromo && !appliedPromo && (
                        <TouchableOpacity
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            backgroundColor: "#F0FDF4",
                            borderWidth: 1,
                            borderColor: "#86EFAC",
                            borderRadius: 10,
                            paddingHorizontal: 12,
                            paddingVertical: 10,
                            marginTop: 10,
                          }}
                          disabled={validatingPromo}
                          onPress={() => handleApplyPromoCode(memberPromo.code)}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                            <Ionicons name="pricetag-outline" size={18} color="#16A34A" />
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 13, fontWeight: "700", color: "#166534" }}>
                                Member Promo: {memberPromo.code}
                              </Text>
                              <Text style={{ fontSize: 11, color: "#15803D", marginTop: 1 }}>
                                Available Balance: ${memberPromo.amount.toFixed(2)}
                              </Text>
                            </View>
                          </View>
                          <View style={{ backgroundColor: "#16A34A", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}>
                            <Text style={{ color: "#FFF", fontSize: 12, fontWeight: "700" }}>Use Promo</Text>
                          </View>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                </View>

                {/* Bill Details Breakdown */}
                <View style={{ width: "100%", backgroundColor: "#F8FAFC", padding: 12, borderRadius: 12, marginBottom: 16 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                    <Text style={{ color: "#64748B", fontSize: 13 }}>Gross Subtotal</Text>
                    <Text style={{ color: "#0F172A", fontSize: 13, fontWeight: "600" }}>{currencySymbol}{orderSubtotal.toFixed(2)}</Text>
                  </View>
                  {orderDiscountAmt > 0 && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                      <Text style={{ color: "#FF5E1A", fontSize: 13, fontWeight: "700" }}>Promo Discount ({appliedPromo?.code})</Text>
                      <Text style={{ color: "#FF5E1A", fontSize: 13, fontWeight: "700" }}>-{currencySymbol}{orderDiscountAmt.toFixed(2)}</Text>
                    </View>
                  )}
                  {serviceChargeAmt > 0 && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                      <Text style={{ color: "#64748B", fontSize: 13 }}>Item Service Charge ({serviceChargePercentage}%)</Text>
                      <Text style={{ color: "#0F172A", fontSize: 13, fontWeight: "600" }}>{currencySymbol}{serviceChargeAmt.toFixed(2)}</Text>
                    </View>
                  )}
                  {takeawayChargeAmt > 0 && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                      <Text style={{ color: "#64748B", fontSize: 13 }}>Takeaway Charge</Text>
                      <Text style={{ color: "#0F172A", fontSize: 13, fontWeight: "600" }}>{currencySymbol}{takeawayChargeAmt.toFixed(2)}</Text>
                    </View>
                  )}
                  {gstAmt > 0 && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 }}>
                      <Text style={{ color: "#64748B", fontSize: 13 }}>GST ({gstPercentage}%)</Text>
                      <Text style={{ color: "#0F172A", fontSize: 13, fontWeight: "600" }}>{currencySymbol}{gstAmt.toFixed(2)}</Text>
                    </View>
                  )}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderColor: "#E2E8F0", marginTop: 6, paddingTop: 8 }}>
                    <Text style={{ color: "#0F172A", fontSize: 15, fontWeight: "bold" }}>Payable Amount</Text>
                    <Text style={{ color: Theme.primary, fontSize: 16, fontWeight: "bold" }}>{currencySymbol}{grandTotal.toFixed(2)}</Text>
                  </View>
                </View>

                {/* Action Buttons */}
                <TouchableOpacity
                  style={[styles.modalButton, styles.confirmBtn, { width: "100%" }]}
                  onPress={() => setOnlineStep("qr")}
                >
                  <Text style={styles.confirmBtnText}>Proceed to Pay • {currencySymbol}{grandTotal.toFixed(2)}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelBtn, { marginTop: 8, width: "100%" }]}
                  onPress={() => { setShowPaymentModal(false); setPaymentSent(false); setPaymentMethod(null); }}
                >
                  <Text style={styles.cancelBtnText}>Back</Text>
                </TouchableOpacity>
              </View>
            ) : (
              /* Online Payment Step 2: Scan & Pay */
              <View style={{ width: "100%", alignItems: "center" }}>
                <View style={[styles.iconContainer, { backgroundColor: "#EDE9FE" }]}>
                  <Ionicons name="qr-code" size={36} color="#8B5CF6" />
                </View>
                <Text style={styles.modalTitle}>Scan to Pay</Text>

                {loadingUpi ? (
                  <ActivityIndicator color={Theme.primary} style={{ marginVertical: 24 }} />
                ) : upiId ? (
                  <>
                    <Text style={[styles.modalSubtitle, { marginBottom: 8 }]}>
                      Scan QR code to pay {currencySymbol}{grandTotal.toFixed(2)}
                    </Text>
                    <Image
                      source={{ uri: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=paynow://pay?pa=${encodeURIComponent(upiId)}&am=${grandTotal.toFixed(2)}` }}
                      style={styles.upiQr}
                    />
                    <Text style={styles.upiIdText}>{upiId}</Text>
                  </>
                ) : null}

                {/* YeahPay PayNow Trigger Button */}
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: "#8B5CF6", width: "100%", marginTop: 12, flexDirection: "row", justifyContent: "center", alignItems: "center" }]}
                  onPress={handleTriggerYeahPay}
                >
                  <Ionicons name="card-outline" size={20} color="#FFF" style={{ marginRight: 8 }} />
                  <Text style={[styles.confirmBtnText, { color: "#FFF" }]}>Pay with YeahPay (PayNow)</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelBtn, { width: "100%", marginTop: 8 }]}
                  onPress={() => setOnlineStep("summary")}
                >
                  <Text style={styles.cancelBtnText}>Back to Bill Summary</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Custom Logout Confirmation Modal */}

      <Modal
        visible={showLogoutModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLogoutModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.logoutModalCard}>
            <View style={styles.logoutIconCircle}>
              <Ionicons name="log-out-outline" size={32} color="#EF4444" />
            </View>
            <Text style={styles.logoutModalTitle}>Log Out & Exit</Text>
            <Text style={styles.logoutModalSubtitle}>
              Are you sure you want to log out? Your table ordering session will be closed.
            </Text>
            <View style={styles.logoutModalActions}>
              <TouchableOpacity
                style={styles.cancelLogoutBtn}
                onPress={() => setShowLogoutModal(false)}
              >
                <Text style={styles.cancelLogoutText}>Cancel</Text>
              </TouchableOpacity>
              {Platform.OS === "web" ? (
                <LogoutButtonWeb onConfirm={confirmLogout} />
              ) : (
                <TouchableOpacity
                  style={styles.confirmLogoutBtn}
                  onPress={confirmLogout}
                >
                  <Text style={styles.confirmLogoutText}>Yes, Log Out</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </Modal>

      {/* Custom Promo Code Alert Modal */}
      <Modal
        visible={promoModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setPromoModal((prev) => ({ ...prev, visible: false }))}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.logoutModalCard}>
            <View
              style={[
                styles.logoutIconCircle,
                { backgroundColor: promoModal.type === "success" ? "#D1FAE5" : "#FEE2E2" },
              ]}
            >
              <Ionicons
                name={promoModal.type === "success" ? "checkmark-circle" : "close-circle-outline"}
                size={36}
                color={promoModal.type === "success" ? "#10B981" : "#DC2626"}
              />
            </View>
            <Text style={styles.logoutModalTitle}>{promoModal.title}</Text>
            <Text style={styles.logoutModalSubtitle}>{promoModal.message}</Text>
            <TouchableOpacity
              style={[
                styles.modalButton,
                {
                  backgroundColor: promoModal.type === "success" ? "#10B981" : Theme.primary,
                  width: "100%",
                  marginTop: 16,
                },
              ]}
              onPress={() => setPromoModal((prev) => ({ ...prev, visible: false }))}
            >
              <Text style={[styles.confirmBtnText, { color: "#FFF" }]}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );

}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderColor: "#E2E8F0",
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#0F172A",
  },
  scrollContent: {
    padding: 16,
  },
  statusCard: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 24,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.04,
    shadowRadius: 20,
    elevation: 3,
    alignItems: "center",
    marginBottom: 28,
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  statusLabel: {
    fontSize: 11,
    color: "#94A3B8",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  statusValue: {
    fontSize: 24,
    fontWeight: "800",
    color: "#0F172A",
    marginVertical: 10,
    letterSpacing: -0.5,
  },
  timeline: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 20,
    width: "88%",
    justifyContent: "space-between",
  },
  timelineStep: {
    alignItems: "center",
    zIndex: 2,
  },
  stepDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#E2E8F0",
    borderWidth: 3,
    borderColor: "#FFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  stepText: {
    fontSize: 12,
    color: "#475569",
    marginTop: 8,
    fontWeight: "600",
  },
  timelineLine: {
    flex: 1,
    height: 3,
    backgroundColor: "#F1F5F9",
    marginHorizontal: -4,
    marginTop: -22,
    zIndex: 1,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 16,
    letterSpacing: -0.3,
  },
  requestsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 28,
  },
  requestBtn: {
    width: "48%",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 20,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.02,
    shadowRadius: 6,
    elevation: 2,
  },
  requestBtnText: {
    fontSize: 13,
    color: "#1E293B",
    fontWeight: "600",
    marginTop: 8,
    textAlign: "center",
  },
  emptyContainer: {
    backgroundColor: "#fff",
    borderRadius: 20,
    padding: 40,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  emptyText: {
    color: "#94A3B8",
    fontWeight: "500",
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 20,
    marginBottom: 12,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.02,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  itemName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
    letterSpacing: -0.2,
  },
  modifierContainer: {
    marginTop: 6,
    marginBottom: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  modifierTag: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: Theme.primary,
  },
  modifierBullet: {
    fontSize: 12,
    color: Theme.primary,
    marginRight: 4,
    fontWeight: "bold",
  },
  modifierName: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F172A",
  },
  modifierPrice: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
  },
  itemQty: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 6,
    fontWeight: "500",
  },
  statusBadge: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  addDishButton: {
    backgroundColor: Theme.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    borderRadius: 20,
    marginTop: 24,
    marginBottom: 48,
    shadowColor: Theme.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
    elevation: 5,
  },
  addDishButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "800",
  },
  settledContainer: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  settledCard: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    width: "100%",
    maxWidth: 400,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 4,
  },
  checkWrap: {
    backgroundColor: "#FFF7ED",
    padding: 24,
    borderRadius: 50,
    marginBottom: 24,
  },
  settledTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#0F172A",
    marginBottom: 12,
    textAlign: "center",
  },
  settledSubtitle: {
    fontSize: 15,
    color: "#64748B",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 32,
  },
  doneBtn: {
    backgroundColor: Theme.primary,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 16,
    width: "100%",
    alignItems: "center",
    shadowColor: Theme.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  doneBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  comboSelectionsContainer: {
    marginTop: 4,
    marginBottom: 4,
  },
  comboSelectionText: {
    fontSize: 12,
    color: "#64748B",
    lineHeight: 16,
  },
  itemMods: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 4,
    marginBottom: 4,
  },
  modalOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
  modalContent: {
    backgroundColor: "#fff",
    padding: 24,
    borderRadius: 24,
    width: "85%",
    maxWidth: 340,
    alignItems: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Theme.primary + "15",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#0F172A",
    marginBottom: 8,
    textAlign: "center",
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#64748B",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelBtn: {
    backgroundColor: "#F1F5F9",
  },
  cancelBtnText: {
    color: "#64748B",
    fontWeight: "600",
    fontSize: 15,
  },
  confirmBtn: {
    backgroundColor: Theme.primary,
  },
  confirmBtnText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 15,
  },
  payOptionBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    width: "100%",
    gap: 12,
  },
  payOptionIcon: {
    width: 50,
    height: 50,
    borderRadius: 14,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  payOptionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 2,
  },
  payOptionDesc: {
    fontSize: 12,
    color: "#64748B",
    lineHeight: 16,
  },
  upiQr: {
    width: 200,
    height: 200,
    borderRadius: 12,
    marginVertical: 12,
    alignSelf: "center",
  },
  upiIdText: {
    fontSize: 13,
    color: "#475569",
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  logoutModalCard: {

    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 24,
    width: "100%",
    maxWidth: 380,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  logoutIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#FEF2F2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  logoutModalTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#0F172A",
    marginBottom: 8,
  },
  logoutModalSubtitle: {
    fontSize: 14,
    color: "#64748B",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  logoutModalActions: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  cancelLogoutBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
  },
  cancelLogoutText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#64748B",
  },
  confirmLogoutBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "#EF4444",
    alignItems: "center",
  },
  confirmLogoutText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  sessionClosedContainer: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  sessionClosedCard: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    maxWidth: 420,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  sessionClosedIconWrap: {
    marginBottom: 16,
  },
  sessionClosedTitle: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#0F172A",
    marginBottom: 8,
  },
  sessionClosedSubtitle: {
    fontSize: 14,
    color: "#64748B",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  closeWindowBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.primary,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 14,
  },
  closeWindowBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "bold",
  },
  mobileCloseHint: {
    fontSize: 13,
    color: "#94A3B8",
    textAlign: "center",
    marginTop: 8,
    fontStyle: "italic",
  },
});


