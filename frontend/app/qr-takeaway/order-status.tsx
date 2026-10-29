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
  useWindowDimensions,
} from "react-native";
import { useRouter } from "expo-router";
import { Theme } from "../../constants/theme";
import { useCartStore, getContextId, setCurrentContext } from "../../stores/cartStore";
import { useOrderContextStore } from "../../stores/orderContextStore";
import { useCompanySettingsStore } from "../../stores/companySettingsStore";
import { useGeneralSettingsStore } from "../../stores/generalSettingsStore";
import { useMenuStore } from "../../stores/menuStore";
import { socket } from "../../constants/socket";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Path, Rect, Line, Circle as SvgCircle } from "react-native-svg";
import { API_URL } from "../../constants/Config";
import { parseDatabaseDate } from "../../utils/timezoneHelper";

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
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  // Responsive thresholds for mobile, tablet, and desktop
  const isTablet = screenWidth >= 600;
  const isWide = screenWidth >= 768;
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

  // Determine overall status suitable for takeaway
  const getOverallStatus = () => {
    if (activeItems.length === 0) return "No active orders";
    const hasSent = activeItems.some((i) => i.status === "SENT");
    const hasReady = activeItems.some((i) => i.status === "READY");
    const allCompleted = activeItems.every((i) => {
      const s = (i.status as string) || "";
      return s === "SERVED" || s === "COLLECTED" || s === "PICKED_UP";
    });

    if (allCompleted) return "Picked Up / Completed";
    if (hasReady) return "Ready for Pickup";
    if (hasSent) return "Preparing Order";
    return "Order Received";
  };

  const [isSettled, setIsSettled] = useState(false);
  const [showConfirmBillModal, setShowConfirmBillModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [isSessionClosed, setIsSessionClosed] = useState(false);
  const [upiId, setUpiId] = useState<string | null>(null);
  const [loadingUpi, setLoadingUpi] = useState(false);
  const [paymentSent, setPaymentSent] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"cashier" | "online" | null>(null);
  const [onlineStep, setOnlineStep] = useState<"summary" | "qr">("summary");
  const [isProcessingCashier, setIsProcessingCashier] = useState(false);

  const [currentOrderId, setCurrentOrderId] = useState<string>(() => {
    return (
      (orderContext as any)?.orderId ||
      (orderContext?.tableId && useCartStore.getState().tableOrderIds[orderContext.tableId]) ||
      (typeof localStorage !== "undefined" ? localStorage.getItem("last_tw_order_id") : "") ||
      ""
    );
  });
  const [isPaid, setIsPaid] = useState<boolean>(() => {
    if (orderContext?.tableId && useCartStore.getState().tablePaymentStatus?.[orderContext.tableId]?.isPaid) {
      return true;
    }
    return false;
  });
  const [paymentStatus, setPaymentStatus] = useState<"PAID" | "PENDING_CASHIER" | "UNPAID">(() => {
    if (orderContext?.tableId && useCartStore.getState().tablePaymentStatus?.[orderContext.tableId]) {
      return useCartStore.getState().tablePaymentStatus[orderContext.tableId].paymentStatus as any;
    }
    return "UNPAID";
  });

  const isFetchingStatusRef = useRef(false);

  const fetchOrderStatus = async () => {
    if (isFetchingStatusRef.current) return;
    const targetTableId = orderContext?.tableId || orderContext?.tableNo;
    const targetOrderId =
      currentOrderId ||
      (orderContext as any)?.orderId ||
      (targetTableId ? useCartStore.getState().tableOrderIds[targetTableId] : null) ||
      (typeof localStorage !== "undefined" ? localStorage.getItem("last_tw_order_id") : null);

    const queryKey = targetOrderId || targetTableId;
    if (!queryKey) return;

    isFetchingStatusRef.current = true;
    try {
      const res = await fetch(`${API_URL}/api/orders/order-status/${encodeURIComponent(queryKey)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          if (data.orderNumber) {
            setCurrentOrderId(data.orderNumber);
            if (typeof localStorage !== "undefined") {
              localStorage.setItem("last_tw_order_id", data.orderNumber);
            }
            if (targetTableId) {
              useCartStore.getState().setTableOrderId(targetTableId, data.orderNumber);
            }
          }
          if (data.isPaid !== undefined) {
            setIsPaid(Boolean(data.isPaid));
          }
          if (data.paymentStatus) {
            setPaymentStatus(data.paymentStatus);
          }
        }
      }
    } catch (err) {
      console.warn("fetchOrderStatus error:", err);
    } finally {
      isFetchingStatusRef.current = false;
    }
  };

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

  const [companySettingsData, setCompanySettingsData] = useState<any>(null);

  useEffect(() => {
    fetchMemberPromoDetails();
    useMenuStore.getState().fetchMenu().catch(() => {});
    useGeneralSettingsStore.getState().fetchSettings?.().catch(() => {});
    useCompanySettingsStore.getState().fetchSettings?.().catch(() => {});
    fetch(`${API_URL}/api/company-settings/1`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.success && data?.settings) {
          setCompanySettingsData(data.settings);
        }
      })
      .catch(() => {});
  }, []);

  // 🚀 Single consolidated polling & sync effect: avoids rapid duplicate invocations
  useEffect(() => {
    if (orderContext) {
      const ctxId = getContextId(orderContext);
      if (ctxId) {
        setCurrentContext(ctxId);
      }
      const targetTableId = orderContext.tableId || orderContext.tableNo;
      if (targetTableId) {
        fetchCartFromDB(targetTableId, true);
      }
      fetchOrderStatus();
    }
    const interval = setInterval(() => {
      fetchOrderStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [orderContext?.tableId, orderContext?.tableNo]);

  useEffect(() => {
    if (!orderContext?.tableId) return;
    const tableId = String(orderContext.tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
    socket.emit("join_table", { tableId });

    const handleOrderClosed = (payload: { tableId?: string }) => {
      const cleanTarget = String(payload.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
      const cleanCurrent = String(orderContext.tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
      if (cleanTarget === cleanCurrent) {
        setIsSettled(true);
        if (orderContext.tableId) {
          useCartStore.getState().clearTableSession(orderContext.tableId, orderContext.section, orderContext.tableNo);
        }
      }
    };

    const handleTableStatus = (payload: { tableId?: string; status?: number | string }) => {
      const cleanTarget = String(payload.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
      const cleanCurrent = String(orderContext.tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
      if (cleanTarget === cleanCurrent && (payload.status === 0 || payload.status === 'EMPTY')) {
        setIsSettled(true);
        if (orderContext.tableId) {
          useCartStore.getState().clearTableSession(orderContext.tableId, orderContext.section, orderContext.tableNo);
        }
      }
    };

    const handleCartUpdated = (data: { tableId: string; source?: string }) => {
      const cleanTarget = String(data.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
      const cleanCurrent = String(orderContext.tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
      if (cleanTarget === cleanCurrent && orderContext.tableId) {
        fetchCartFromDB(orderContext.tableId, true);
        fetchOrderStatus();
      }
    };

    const handlePaymentUpdated = () => {
      fetchOrderStatus();
      if (orderContext.tableId) {
        fetchCartFromDB(orderContext.tableId, true);
      }
    };

    socket.on("order_closed", handleOrderClosed);
    socket.on("table_status_updated", handleTableStatus);
    socket.on("cart_updated", handleCartUpdated);
    socket.on("settlement_updated", handlePaymentUpdated);
    socket.on("qr_payment_confirmed", handlePaymentUpdated);

    return () => {
      socket.off("order_closed", handleOrderClosed);
      socket.off("table_status_updated", handleTableStatus);
      socket.off("cart_updated", handleCartUpdated);
      socket.off("settlement_updated", handlePaymentUpdated);
      socket.off("qr_payment_confirmed", handlePaymentUpdated);
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
    const tableId = orderContext?.tableId || (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("qr_takeaway_tableId") : null) || (typeof localStorage !== "undefined" ? localStorage.getItem("qr_takeaway_tableId") : null);
    const tableNo = orderContext?.tableNo || (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("qr_takeaway_tableNo") : null) || (typeof localStorage !== "undefined" ? localStorage.getItem("qr_takeaway_tableNo") : null);
    const sessionId = (typeof sessionStorage !== "undefined" ? sessionStorage.getItem("tw_session_token") : null);

    // Call backend to release takeaway table if no active unclosed order exists
    if (tableId || tableNo || sessionId) {
      try {
        fetch(`${API_URL}/api/tables/release-takeaway`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableId, tableNo, sessionId }),
        }).catch((e) => console.warn("Failed to release takeaway table on logout:", e));
      } catch (err) {
        console.warn("release-takeaway error:", err);
      }
    }

    if (tableId) {
      useCartStore.getState().clearTableSession(tableId);
    }
    useOrderContextStore.getState().setOrderContext(null as any);

    if (typeof sessionStorage !== "undefined") {
      sessionStorage.removeItem("tw_session_token");
      sessionStorage.removeItem("qr_takeaway_tableId");
      sessionStorage.removeItem("qr_takeaway_tableNo");
    }
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("isLoggedIn");
      localStorage.removeItem("qr_pos_user");
      localStorage.removeItem("qr_takeaway_tableId");
      localStorage.removeItem("qr_takeaway_tableNo");
      localStorage.removeItem("qr_takeaway_section");
      localStorage.removeItem("last_tw_order_id");
      localStorage.removeItem("promoCode");
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
              const sec = orderContext?.section || "TAKEAWAY";
              if (tid) {
                useCartStore.getState().clearTableSession(tid, sec, tno);
              }
              router.replace("/qr-takeaway/menu" as any);
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

  const serviceChargePercentage = Number(settings?.serviceChargePercentage ?? settings?.ServiceChargePercentage ?? companySettingsData?.ServiceChargePercentage ?? 0);
  const gstPercentage = Number(settings?.gstPercentage ?? settings?.GSTPercentage ?? companySettingsData?.GSTPercentage ?? 0);
  const takeawayChargeRate = Number(
    settings?.takeawayCharges ?? 
    settings?.TakeawayCharges ?? 
    settings?.takeawayCharge ?? 
    settings?.TakeawayCharge ?? 
    companySettingsData?.TakeawayCharges ?? 
    companySettingsData?.takeawayCharges ?? 
    0
  );

  // In QR Takeaway flow: all items are takeaway, NO service charge is applied
  const takeawayChargeAmt = activeCartItems.reduce((sum, item) => {
    const dishSpecificTW = Number(item.takeawayCharge ?? (item as any).TakeawayCharge ?? 0);
    const effectiveTWRate = dishSpecificTW > 0 ? dishSpecificTW : takeawayChargeRate;
    return sum + (item.qty || 0) * effectiveTWRate;
  }, 0);

  const serviceChargeAmt = 0;
  const totalBeforeGst = orderNetSubtotal + takeawayChargeAmt;
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
            const verifiedAmt = parseFloat(event.data?.amount || grandTotal);
            await fetch(`${API_URL}/api/order/complete-online-payment`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderId: currentOrdId,
                tableNo: orderContext?.tableNo,
                tableId: orderContext?.tableId,
                totalAmount: verifiedAmt,
                paidAmount: verifiedAmt,
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
      case "COLLECTED":
      case "PICKED_UP":
        return "#10B981"; // Green
      case "READY":
        return "#3B82F6"; // Blue
      case "SENT":
        return "#F59E0B"; // Amber
      default:
        return "#64748B";
    }
  };

  const getItemStatusLabel = (status?: string) => {
    switch (status) {
      case "SERVED":
      case "COLLECTED":
      case "PICKED_UP":
        return "COLLECTED";
      case "READY":
        return "READY FOR PICKUP";
      case "SENT":
        return "PREPARING";
      default:
        return status || "RECEIVED";
    }
  };

  const handleLogout = () => {
    setShowLogoutModal(true);
  };


  const displayCurrency = currencySymbol || "$";
  
  // 🎯 Resolve official Order Number (NOT the table TW number)
  const displayOrderNo = (() => {
    // 1. From item's OrderNumber (attached to active order details in DB)
    const itemOrderNo = (activeItems[0] as any)?.OrderNumber || (activeItems[0] as any)?.orderNumber;
    if (itemOrderNo && String(itemOrderNo).trim() !== "" && !String(itemOrderNo).startsWith("TEMP-") && !String(itemOrderNo).toUpperCase().startsWith("TW-")) {
      return String(itemOrderNo).trim();
    }
    // 2. From state / fetched order ID
    if (currentOrderId && String(currentOrderId).trim() !== "" && !String(currentOrderId).startsWith("TEMP-") && !String(currentOrderId).toUpperCase().startsWith("TW-")) {
      return String(currentOrderId).trim();
    }
    // 3. From tableOrderIds in cartStore
    const storeOrderId = orderContext?.tableId ? useCartStore.getState().tableOrderIds[orderContext.tableId] : null;
    if (storeOrderId && String(storeOrderId).trim() !== "" && !String(storeOrderId).startsWith("TEMP-") && !String(storeOrderId).toUpperCase().startsWith("TW-")) {
      return String(storeOrderId).trim();
    }
    // 4. From localStorage
    const localOrderId = typeof localStorage !== "undefined" ? localStorage.getItem("last_tw_order_id") : null;
    if (localOrderId && String(localOrderId).trim() !== "" && !String(localOrderId).startsWith("TEMP-") && !String(localOrderId).toUpperCase().startsWith("TW-")) {
      return String(localOrderId).trim();
    }
    // 5. From orderContext.orderId
    const ctxOrderId = (orderContext as any)?.orderId;
    if (ctxOrderId && String(ctxOrderId).trim() !== "" && !String(ctxOrderId).startsWith("TEMP-") && !String(ctxOrderId).toUpperCase().startsWith("TW-")) {
      return String(ctxOrderId).trim();
    }
    return "";
  })();

  // Distinct label for Takeaway slot/counter (e.g. TW-7)
  const takeawayNoLabel = (() => {
    const raw = orderContext?.takeawayNo || orderContext?.tableNo || "";
    if (!raw) return "";
    const clean = String(raw).replace(/^TW-?/i, "").trim();
    return clean ? `TW-${clean}` : "TW-01";
  })();

  const orderNumberDigits = (() => {
    if (!displayOrderNo) return "0037";
    const str = String(displayOrderNo).trim();
    if (str.includes("-")) {
      return str.split("-").pop() || str;
    }
    return str.length > 4 ? str.slice(-4) : str;
  })();

  const status = getOverallStatus();
  const isPreparing = status === "Preparing Order";
  const isReady = status === "Ready for Pickup" || status === "Picked Up / Completed";
  const isReceivedOnly = status === "Order Received";

  let statusTitle = "Preparing your order";
  let statusSubtitle = "We're getting your delicious food ready.";
  if (isReady) {
    statusTitle = "Ready for Pickup";
    statusSubtitle = "Your food is ready! Please collect it at the counter.";
  } else if (isPreparing) {
    statusTitle = "Preparing your order";
    statusSubtitle = "We're getting your delicious food ready.";
  } else if (isReceivedOnly) {
    statusTitle = "Order Received";
    statusSubtitle = "We've received your order and sent it to the kitchen.";
  } else if (activeItems.length === 0) {
    statusTitle = "No active orders";
    statusSubtitle = "You haven't placed an order yet.";
  }

  const orderTimeStr = (() => {
    const firstItem = activeItems[0];
    const rawDate = firstItem?.DateCreated || firstItem?.sentDate;
    if (rawDate) {
      try {
        const d = parseDatabaseDate(rawDate);
        if (!isNaN(d.getTime())) {
          return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
        }
      } catch (e) {}
    }
    return new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  })();

  const getDishImageUri = (item: any) => {
    // 1. Direct item image if available
    const customImg = item.Image || item.image || item.DishImage || item.photo;
    if (customImg) {
      if (String(customImg).startsWith("http")) return customImg;
      return `${API_URL}/api/menu/image/${customImg}`;
    }

    // 2. Cross-reference with allDishes in menuStore using dish ID or Name
    const dishes = useMenuStore.getState().allDishes || [];
    const matchedDish = dishes.find(
      (d: any) =>
        (item.id && (String(d.DishId) === String(item.id) || String(d.id) === String(item.id))) ||
        (item.DishId && String(d.DishId) === String(item.DishId)) ||
        (item.name && d.Name && String(d.Name).trim().toLowerCase() === String(item.name).trim().toLowerCase())
    );

    if (matchedDish?.Image) {
      if (String(matchedDish.Image).startsWith("http")) return matchedDish.Image;
      return `${API_URL}/api/menu/image/${matchedDish.Image}`;
    }

    // 3. Fallback to placeholder if dish has no image uploaded
    const name = String(item.name || "").toLowerCase();
    if (name.includes("biryani") || name.includes("rice")) {
      return "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=200";
    }
    if (name.includes("tea") || name.includes("chai") || name.includes("coffee") || name.includes("drink")) {
      return "https://images.unsplash.com/photo-1576092768241-dec231879fc3?q=80&w=200";
    }
    if (name.includes("chicken") || name.includes("curry") || name.includes("meat")) {
      return "https://images.unsplash.com/photo-1589302168068-964664d93dc0?q=80&w=200";
    }
    if (name.includes("noodle") || name.includes("pasta") || name.includes("maggie") || name.includes("maggi")) {
      return "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?q=80&w=200";
    }
    return "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=200";
  };

  return (
    <View style={[styles.container, isTablet && styles.containerTablet]}>
      <View style={[styles.appWrapper, isTablet && styles.appWrapperTablet]}>
        {/* Navigation Bar */}
        <View style={[styles.header, isTablet && styles.headerTablet]}>
          <TouchableOpacity 
            style={styles.backButton} 
            onPress={() => router.replace("/qr-takeaway/menu")}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="chevron-back" size={24} color="#0F172A" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Order Status</Text>
          <TouchableOpacity
            style={styles.helpButton}
            onPress={() => setShowHelpModal(true)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="help-circle-outline" size={24} color="#0F172A" />
          </TouchableOpacity>
        </View>

        <ScrollView 
          contentContainerStyle={[styles.scrollContent, isTablet && styles.scrollContentTablet]}
          showsVerticalScrollIndicator={false}
        >
          {/* Card 1: Status Hero Banner */}
          <View style={[styles.heroCard, isReady && styles.heroCardReady]}>
            <View style={styles.heroTopRow}>
              {/* Elevated Takeaway Bag Container */}
              <View style={styles.bagIconContainer}>
                <View style={[styles.bagIconCircle, isReady && styles.bagIconCircleReady]}>
                  <Svg width="56" height="56" viewBox="0 0 64 64" fill="none">
                    {/* Decorative rays */}
                    <Line x1="8" y1="21" x2="15" y2="23" stroke={isReady ? "#10B981" : "#FF5722"} strokeWidth="2.8" strokeLinecap="round" />
                    <Line x1="8" y1="32" x2="15" y2="32" stroke={isReady ? "#10B981" : "#FF5722"} strokeWidth="2.8" strokeLinecap="round" />
                    <Line x1="56" y1="21" x2="49" y2="23" stroke={isReady ? "#10B981" : "#FF5722"} strokeWidth="2.8" strokeLinecap="round" />
                    <Line x1="56" y1="32" x2="49" y2="32" stroke={isReady ? "#10B981" : "#FF5722"} strokeWidth="2.8" strokeLinecap="round" />
                    
                    {/* Bag Handle */}
                    <Path
                      d="M26 17C26 12 28.5 8.5 32 8.5C35.5 8.5 38 12 38 17"
                      stroke={isReady ? "#059669" : "#FF5722"}
                      strokeWidth="3.2"
                      strokeLinecap="round"
                    />
                    {/* Bag Body */}
                    <Rect x="16" y="17" width="32" height="35" rx="8" fill={isReady ? "#10B981" : "#FF5722"} />
                    
                    {/* Fork */}
                    <Path
                      d="M27 25V36M25 25V28.5C25 29.6 25.9 30.5 27 30.5C28.1 30.5 29 29.6 29 28.5V25"
                      stroke="#FFFFFF"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {/* Spoon */}
                    <Path
                      d="M36 30V36M36 30C37.6 30 39 28.7 39 27C39 25.3 37.6 24 36 24C34.4 24 33 25.3 33 27C33 28.7 34.4 30 36 30Z"
                      stroke="#FFFFFF"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </Svg>
                </View>

                {/* Floating Corner Badge */}
                {isReady ? (
                  <View style={styles.badgeCornerReady}>
                    <Ionicons name="checkmark" size={12} color="#FFF" />
                  </View>
                ) : isPreparing ? (
                  <View style={styles.badgeCornerPrep}>
                    <Ionicons name="time" size={11} color="#FFF" />
                  </View>
                ) : null}
              </View>

              <View style={styles.heroTextContent}>
                {/* Top Row: ORDER label & #{orderNumberDigits} on Left (only when paid), UNPAID / PAID pill on Right */}
                <View style={[styles.heroHeaderRow, !isPaid && { justifyContent: "flex-end" }]}>
                  {isPaid ? (
                    <View style={styles.orderNumberBlock}>
                      <Text style={styles.orderLabelSmall}>ORDER</Text>
                      <Text style={[styles.orderHeroNumber, isReady && styles.orderHeroNumberReady]}>
                        #{orderNumberDigits}
                      </Text>
                    </View>
                  ) : null}

                  {/* Payment Status Pill */}
                  <View style={[styles.paymentPillNew, isPaid ? styles.paymentPillPaidNew : styles.paymentPillUnpaidNew]}>
                    <Ionicons 
                      name={isPaid ? "checkmark-circle" : "time-outline"} 
                      size={18} 
                      color={isPaid ? "#059669" : "#D97706"} 
                      style={{ marginRight: 6 }} 
                    />
                    <Text style={[styles.paymentPillTextNew, isPaid ? styles.paymentPillTextPaidNew : styles.paymentPillTextUnpaidNew]}>
                      {isPaid ? "PAID" : (paymentStatus === "PENDING_CASHIER" ? "PAY AT CASHIER" : "UNPAID")}
                    </Text>
                  </View>
                </View>

                {/* Main Headline */}
                <Text style={[styles.heroStatusHeading, isReady && styles.heroStatusHeadingReady]}>
                  {statusTitle}
                </Text>

                <Text style={styles.heroStatusSub}>{statusSubtitle}</Text>
              </View>
            </View>

            {/* Stepper Timeline */}
            <View style={styles.stepperContainer}>
              {/* Stepper Circles & Connectors Row */}
              <View style={styles.stepperBarRow}>
                {/* Node 1 */}
                <View style={styles.stepCircleWrapper}>
                  <View style={styles.stepCheckCircle}>
                    <Ionicons name="checkmark" size={15} color="#FFF" />
                  </View>
                </View>

                {/* Connector 1: Solid line from Node 1 */}
                <View 
                  style={[
                    styles.stepConnectorSolid, 
                    { backgroundColor: "#FF5722" }
                  ]} 
                />

                {/* Node 2 */}
                <View style={styles.stepCircleWrapper}>
                  {isReady ? (
                    <View style={styles.stepCheckCircle}>
                      <Ionicons name="checkmark" size={15} color="#FFF" />
                    </View>
                  ) : isPreparing ? (
                    <View style={styles.stepActiveRing}>
                      <View style={styles.stepActiveDot} />
                    </View>
                  ) : (
                    <View style={styles.stepInactiveCircle} />
                  )}
                </View>

                {/* Connector 2 */}
                <View 
                  style={[
                    styles.stepConnectorDashed,
                    isReady && { borderColor: "#FF5722", borderStyle: "solid" }
                  ]} 
                />

                {/* Node 3 */}
                <View style={styles.stepCircleWrapper}>
                  {isReady ? (
                    <View style={[styles.stepCheckCircle, { backgroundColor: "#10B981" }]}>
                      <Ionicons name="checkmark" size={15} color="#FFF" />
                    </View>
                  ) : (
                    <View style={styles.stepInactiveCircle} />
                  )}
                </View>
              </View>

              {/* Stepper Labels Row */}
              <View style={styles.stepperLabelsRow}>
                {/* Label 1 */}
                <View style={styles.stepLabelCol}>
                  <Text style={styles.stepLabelActive}>Received</Text>
                  <Text style={styles.stepSubLabel}>{orderTimeStr}</Text>
                </View>

                {/* Label 2 */}
                <View style={styles.stepLabelCol}>
                  <Text style={isPreparing || isReady ? styles.stepLabelActive : styles.stepLabelInactive}>
                    Preparing
                  </Text>
                  <Text style={styles.stepSubLabel}>
                    {isReady ? "Done" : isPreparing ? "In progress" : "Waiting"}
                  </Text>
                </View>

                {/* Label 3 */}
                <View style={styles.stepLabelCol}>
                  <Text style={isReady ? [styles.stepLabelActive, { color: "#10B981" }] : styles.stepLabelInactive}>
                    Ready for Pickup
                  </Text>
                  <Text style={styles.stepSubLabel}>
                    {isReady ? "Ready now" : "Waiting"}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Card 2: Order Details */}
          <View style={styles.detailsCard}>
            <View style={styles.detailsCardHeader}>
              <Text style={styles.detailsCardTitle}>Order Details</Text>
              <Text style={styles.detailsItemCount}>
                {activeItems.length} {activeItems.length === 1 ? "item" : "items"}
              </Text>
            </View>

            {activeItems.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="fast-food-outline" size={36} color="#CBD5E1" style={{ marginBottom: 8 }} />
                <Text style={styles.emptyText}>No items ordered yet.</Text>
              </View>
            ) : (
              activeItems.map((item, idx) => {
                const itemTotal = Number(item.price || 0) * Number(item.qty || 1);
                return (
                  <View key={item.lineItemId || idx} style={styles.orderItemRow}>
                    <Image
                      source={{ uri: getDishImageUri(item) }}
                      style={styles.dishThumbnail}
                    />
                    <View style={styles.dishInfoCol}>
                      <Text style={styles.dishNameText} numberOfLines={2}>{item.name}</Text>

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
                          {item.modifiers.map((m: any, mIdx: number) => {
                            const name = m.ModifierName || m.modifierName || m.name || "";
                            const price = Number(m.Price || m.price || 0);
                            return (
                              <View key={mIdx} style={styles.modifierTag}>
                                <Text style={styles.modifierBullet}>•</Text>
                                <Text style={styles.modifierName}>{name}</Text>
                                {price > 0 && (
                                  <Text style={styles.modifierPrice}> (+{displayCurrency}{price.toFixed(2)})</Text>
                                )}
                              </View>
                            );
                          })}
                        </View>
                      )}

                      <Text style={styles.dishQtyText}>x {item.qty}</Text>
                    </View>

                    <Text style={styles.dishPriceText}>
                      {displayCurrency}{itemTotal.toFixed(2)}
                    </Text>
                  </View>
                );
              })
            )}

            {/* Divider */}
            <View style={styles.detailsDivider} />

            {/* Breakdown summary if takeaway charges, discount or GST exist */}
            {(takeawayChargeAmt > 0 || orderDiscountAmt > 0 || gstAmt > 0) && (
              <View style={styles.breakdownContainer}>
                <View style={styles.breakdownRow}>
                  <Text style={styles.breakdownLabel}>Subtotal</Text>
                  <Text style={styles.breakdownValue}>{displayCurrency}{orderSubtotal.toFixed(2)}</Text>
                </View>
                {orderDiscountAmt > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={[styles.breakdownLabel, { color: "#FF5E1A" }]}>Discount ({appliedPromo?.code})</Text>
                    <Text style={[styles.breakdownValue, { color: "#FF5E1A" }]}>-{displayCurrency}{orderDiscountAmt.toFixed(2)}</Text>
                  </View>
                )}
                {takeawayChargeAmt > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>Takeaway Charge</Text>
                    <Text style={styles.breakdownValue}>+{displayCurrency}{takeawayChargeAmt.toFixed(2)}</Text>
                  </View>
                )}
                {gstAmt > 0 && (
                  <View style={styles.breakdownRow}>
                    <Text style={styles.breakdownLabel}>GST ({gstPercentage}%)</Text>
                    <Text style={styles.breakdownValue}>+{displayCurrency}{gstAmt.toFixed(2)}</Text>
                  </View>
                )}
                <View style={[styles.detailsDivider, { marginVertical: 8 }]} />
              </View>
            )}

            {/* Total Amount Row */}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total Amount</Text>
              <Text style={styles.totalAmountValue}>
                {displayCurrency}{grandTotal.toFixed(2)}
              </Text>
            </View>

            {/* Payment Status Row */}
            <View style={styles.paymentSummaryRow}>
              <View style={styles.paymentSummaryLeft}>
                <Ionicons name="card-outline" size={16} color="#64748B" style={{ marginRight: 6 }} />
                <Text style={styles.paymentSummaryLabel}>Payment Status</Text>
              </View>
              <View style={[styles.paymentSummaryBadge, isPaid ? styles.paymentSummaryBadgePaid : styles.paymentSummaryBadgeUnpaid]}>
                <Ionicons 
                  name={isPaid ? "checkmark-circle" : "time-outline"} 
                  size={14} 
                  color={isPaid ? "#059669" : "#D97706"} 
                  style={{ marginRight: 5 }} 
                />
                <Text style={[styles.paymentSummaryBadgeText, isPaid ? styles.paymentSummaryBadgeTextPaid : styles.paymentSummaryBadgeTextUnpaid]}>
                  {isPaid ? "Paid" : (paymentStatus === "PENDING_CASHIER" ? "Pay at Cashier (Pending)" : "Unpaid")}
                </Text>
              </View>
            </View>

            {!isPaid && enableOnlinePayment && (
              <TouchableOpacity
                style={styles.payNowOnlineBtn}
                onPress={handleTriggerYeahPay}
                activeOpacity={0.88}
              >
                <Ionicons name="card" size={17} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.payNowOnlineBtnText}>
                  Pay Online via YeahPay ({displayCurrency}{grandTotal.toFixed(2)})
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Card: Takeaway Counter Instruction */}
          <View style={styles.counterAlertCard}>
            <Ionicons name="storefront" size={22} color="#16A34A" style={{ marginRight: 12 }} />
            <Text style={styles.counterAlertText}>
              Please collect your order at the takeaway counter when it is ready.
            </Text>
          </View>

          {/* Bottom Action Buttons */}
          <View style={styles.actionsContainer}>
            <TouchableOpacity 
              style={styles.orderMorePrimaryBtn}
              onPress={() => router.replace("/qr-takeaway/menu" as any)}
              activeOpacity={0.88}
            >
              <Ionicons name="add-circle-outline" size={22} color="#FFF" style={{ marginRight: 8 }} />
              <Text style={styles.orderMorePrimaryText}>Order More</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>

      {/* Help Modal */}
      {showHelpModal && (
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { maxWidth: 380 }]}>
            <View style={[styles.iconContainer, { backgroundColor: "#FFF7ED" }]}>
              <Ionicons name="help-buoy" size={32} color="#FF5722" />
            </View>
            <Text style={styles.modalTitle}>Need Assistance?</Text>
            <Text style={styles.modalSubtitle}>
              Our takeaway staff is ready to help you with your order.
            </Text>

            {settings?.companyName && (
              <View style={{ width: "100%", backgroundColor: "#F8FAFC", padding: 14, borderRadius: 14, marginBottom: 16 }}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: "#0F172A", marginBottom: 4 }}>{settings.companyName}</Text>
                {settings.phone && (
                  <Text style={{ fontSize: 13, color: "#64748B", marginBottom: 2 }}>📞 Tel: {settings.phone}</Text>
                )}
                {settings.address && (
                  <Text style={{ fontSize: 12, color: "#64748B" }}>📍 {settings.address}</Text>
                )}
              </View>
            )}

            <TouchableOpacity
              style={[styles.modalButton, { backgroundColor: "#FF5722", marginBottom: 10, width: "100%" }]}
              onPress={() => {
                executeSendRequest("Assistance Needed");
                setShowHelpModal(false);
                Alert.alert("Help Requested", "Our takeaway counter staff has been notified!");
              }}
            >
              <Ionicons name="notifications-outline" size={18} color="#FFF" style={{ marginRight: 6 }} />
              <Text style={[styles.confirmBtnText, { color: "#FFF" }]}>Call Takeaway Staff</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalButton, styles.cancelBtn, { width: "100%", marginBottom: 8 }]}
              onPress={handleLogout}
            >
              <Ionicons name="log-out-outline" size={18} color="#EF4444" style={{ marginRight: 6 }} />
              <Text style={[styles.cancelBtnText, { color: "#EF4444" }]}>Close / Exit Session</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.modalButton, styles.cancelBtn, { width: "100%" }]}
              onPress={() => setShowHelpModal(false)}
            >
              <Text style={styles.cancelBtnText}>Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

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
    backgroundColor: "#FAFAFA",
    alignItems: "center",
  },
  containerTablet: {
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  appWrapper: {
    flex: 1,
    width: "100%",
    maxWidth: 480,
    backgroundColor: "#FAFAFA",
    alignSelf: "center",
    ...Platform.select({
      web: {
        minHeight: "100vh" as any,
      },
    }),
  },
  appWrapperTablet: {
    width: "100%",
    maxWidth: 580,
    minHeight: "100vh" as any,
    backgroundColor: "#FFFFFF",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "web" ? 16 : 44,
    paddingBottom: 14,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  headerTablet: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0F172A",
    textAlign: "center",
  },
  helpButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 120,
  },
  scrollContentTablet: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 100,
  },

  /* Card 1: Hero Banner */
  /* Card 1: Hero Banner (Matching Image 2) */
  heroCard: {
    backgroundColor: "#FFFDFB",
    borderRadius: 24,
    padding: 22,
    marginBottom: 20,
    borderWidth: 1.5,
    borderColor: "#FFEADB",
    shadowColor: "#FF5722",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 3,
  },
  heroCardReady: {
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
    shadowColor: "#10B981",
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  bagIconContainer: {
    position: "relative",
    marginRight: 18,
    marginTop: 2,
  },
  bagIconCircle: {
    width: 82,
    height: 82,
    borderRadius: 24,
    backgroundColor: "#FFEFE6",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#FFDCC7",
    shadowColor: "#FF5722",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 4,
  },
  bagIconCircleReady: {
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
    shadowColor: "#10B981",
  },
  badgeCornerReady: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#10B981",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFF",
  },
  badgeCornerPrep: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#FF5722",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFF",
  },
  heroTextContent: {
    flex: 1,
  },
  heroHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  orderNumberBlock: {
    flexDirection: "column",
  },
  orderLabelSmall: {
    fontSize: 15,
    fontWeight: "900",
    color: "#475569",
    letterSpacing: 1.4,
    marginBottom: -2,
  },
  orderHeroNumber: {
    fontSize: 48,
    fontWeight: "900",
    color: "#FF5722",
    letterSpacing: -1.2,
    lineHeight: 52,
  },
  orderHeroNumberReady: {
    color: "#15803D",
  },
  paymentPillNew: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 24,
    borderWidth: 1.5,
    alignSelf: "center",
  },
  paymentPillPaidNew: {
    backgroundColor: "#ECFDF5",
    borderColor: "#86EFAC",
  },
  paymentPillUnpaidNew: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FCD34D",
  },
  paymentPillTextNew: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  paymentPillTextPaidNew: {
    color: "#059669",
  },
  paymentPillTextUnpaidNew: {
    color: "#D97706",
  },
  heroStatusHeading: {
    fontSize: 23,
    fontWeight: "900",
    color: "#FF5722",
    letterSpacing: -0.4,
    lineHeight: 28,
    marginTop: 6,
    marginBottom: 3,
  },
  heroStatusHeadingReady: {
    color: "#15803D",
  },
  heroStatusSub: {
    fontSize: 14,
    color: "#475569",
    lineHeight: 20,
    fontWeight: "500",
  },

  /* Stepper Timeline */
  stepperContainer: {
    marginTop: 22,
    paddingTop: 18,
    borderTopWidth: 1.5,
    borderTopColor: "#FFEAD9",
    width: "100%",
  },
  stepperBarRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    paddingHorizontal: 16,
  },
  stepperLabelsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    marginTop: 10,
  },
  stepLabelCol: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 2,
  },
  stepCircleWrapper: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  stepCheckCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#FF5722",
    alignItems: "center",
    justifyContent: "center",
  },
  stepActiveRing: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2.5,
    borderColor: "#FF5722",
    backgroundColor: "#FFF8F3",
    alignItems: "center",
    justifyContent: "center",
  },
  stepActiveDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#FF5722",
  },
  stepInactiveCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#DDE3EA",
  },
  stepLabelActive: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FF5722",
    textAlign: "center",
  },
  stepLabelInactive: {
    fontSize: 13,
    fontWeight: "800",
    color: "#334155",
    textAlign: "center",
  },
  stepSubLabel: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 2,
    textAlign: "center",
    fontWeight: "500",
  },
  stepConnectorSolid: {
    flex: 1,
    height: 2.5,
    backgroundColor: "#FF5722",
    marginHorizontal: 4,
  },
  stepConnectorDashed: {
    flex: 1,
    height: 0,
    borderTopWidth: 2,
    borderColor: "#CBD5E1",
    borderStyle: "dashed",
    marginHorizontal: 4,
  },

  /* Card 2: Order Details */
  detailsCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#F1F5F9",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 2,
  },
  detailsCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  detailsCardTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#0F172A",
  },
  detailsItemCount: {
    fontSize: 13,
    fontWeight: "600",
    color: "#94A3B8",
  },
  orderItemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
  },
  dishThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
  },
  dishInfoCol: {
    flex: 1,
    marginLeft: 14,
    marginRight: 10,
  },
  dishNameText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
    lineHeight: 20,
  },
  dishQtyText: {
    fontSize: 13,
    color: "#64748B",
    marginTop: 4,
    fontWeight: "500",
  },
  dishPriceText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#0F172A",
  },
  detailsDivider: {
    height: 1,
    backgroundColor: "#F1F5F9",
    marginVertical: 14,
  },
  breakdownContainer: {
    marginBottom: 6,
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 3,
  },
  breakdownLabel: {
    fontSize: 13,
    color: "#64748B",
    fontWeight: "500",
  },
  breakdownValue: {
    fontSize: 13,
    color: "#0F172A",
    fontWeight: "600",
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
  },
  totalAmountValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#FF5722",
  },
  paymentSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  paymentSummaryLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  paymentSummaryLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#475569",
  },
  paymentSummaryBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4.5,
    borderRadius: 12,
    borderWidth: 1,
  },
  paymentSummaryBadgePaid: {
    backgroundColor: "#ECFDF5",
    borderColor: "#A7F3D0",
  },
  paymentSummaryBadgeUnpaid: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
  },
  paymentSummaryBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  paymentSummaryBadgeTextPaid: {
    color: "#059669",
  },
  paymentSummaryBadgeTextUnpaid: {
    color: "#D97706",
  },
  payNowOnlineBtn: {
    marginTop: 14,
    backgroundColor: "#8B5CF6",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    shadowColor: "#8B5CF6",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  payNowOnlineBtnText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.2,
  },

  /* Takeaway Counter Instruction */
  counterAlertCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F0FDF4",
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#DCFCE7",
  },
  counterAlertText: {
    flex: 1,
    fontSize: 13,
    color: "#15803D",
    fontWeight: "500",
    lineHeight: 18,
  },

  /* Bottom Actions */
  actionsContainer: {
    width: "100%",
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 24,
  },
  orderMorePrimaryBtn: {
    width: "100%",
    height: 52,
    borderRadius: 26,
    backgroundColor: "#FF5722",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#FF5722",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 4,
    marginBottom: 10,
  },
  orderMorePrimaryText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },

  /* Common Modifiers / Empty */
  emptyContainer: {
    backgroundColor: "#FAFAFA",
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
  },
  emptyText: {
    color: "#94A3B8",
    fontWeight: "600",
    fontSize: 14,
  },
  comboSelectionsContainer: {
    marginTop: 4,
  },
  comboSelectionText: {
    fontSize: 12,
    color: "#64748B",
    fontStyle: "italic",
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
    paddingVertical: 3,
    borderRadius: 6,
  },
  modifierBullet: {
    fontSize: 11,
    color: "#FF5722",
    marginRight: 4,
    fontWeight: "bold",
  },
  modifierName: {
    fontSize: 11,
    fontWeight: "600",
    color: "#334155",
  },
  modifierPrice: {
    fontSize: 10,
    fontWeight: "600",
    color: "#64748B",
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


