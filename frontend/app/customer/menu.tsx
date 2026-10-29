import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Image,
  ActivityIndicator,
  Dimensions,
  Animated,
  Alert,
  Platform,
  Modal,
  ScrollView,
  RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { Theme } from "../../constants/theme";
import { useMenuStore } from "../../stores/menuStore";
import { useCartStore } from "../../stores/cartStore";
import { useOrderContextStore } from "../../stores/orderContextStore";
import { API_URL } from "../../constants/Config";
import { Ionicons } from "@expo/vector-icons";
import { formatToSingaporeDate, formatToSingaporeTime } from "../../utils/timezoneHelper";
import { useGeneralSettingsStore } from "../../stores/generalSettingsStore";
import { isDishAvailableNow } from "../../utils/timeAvailabilityHelper";

const { width } = Dimensions.get("window");

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

export default function CustomerMenuScreen() {
  const router = useRouter();
  const { kitchens, allDishes, fetchMenu, fetchGroups, modifierCache, isLoading, forceRefreshMenu } = useMenuStore();
  const { carts, currentContextId, addToCartGlobal } = useCartStore();
  const orderContext = useOrderContextStore((state) => state.currentOrder);

  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedKitchenId, setSelectedKitchenId] = useState<string | null>(null);
  const [dishGroups, setDishGroups] = useState<any[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await forceRefreshMenu();
    setRefreshing(false);
  };
  const [isSessionClosed, setIsSessionClosed] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [userInfo, setUserInfo] = useState<{ UserName: string; FullName: string; Phone: string; Email?: string; PromoCode?: string; PromoAmount?: number } | null>(null);

  const [profileTab, setProfileTab] = useState<"details" | "history" | "loyalty">("details");
  const [customerOrders, setCustomerOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [loyaltyStatus, setLoyaltyStatus] = useState<any>(null);
  const [dishProgress, setDishProgress] = useState<any[]>([]);
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [promoApplying, setPromoApplying] = useState(false);
  const [promoMsg, setPromoMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [showOrderHistorySection, setShowOrderHistorySection] = useState(false);
  const [showLoyaltySection, setShowLoyaltySection] = useState(false);
  const { settings: generalSettings, fetchSettings: fetchGeneralSettings } = useGeneralSettingsStore();


  useEffect(() => {
    fetchGeneralSettings();
  }, []);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("qr_pos_user");
      if (stored) {
        try { setUserInfo(JSON.parse(stored)); } catch (e) {}
      }
    }
    if (showProfileModal) {
      fetchCustomerHistoryAndLoyalty();
    }
  }, [showProfileModal]);

  const fetchCustomerHistoryAndLoyalty = async () => {
    const phone = userInfo?.Phone || (typeof localStorage !== "undefined" ? JSON.parse(localStorage.getItem("qr_pos_user") || "{}").Phone : "") || "";
    if (!phone || phone.toLowerCase() === "guest") {
      setCustomerOrders([]);
      return;
    }
    const currentTable = orderContext?.tableNo || "";

    setOrdersLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/loyalty/customer/${encodeURIComponent(phone)}/orders?tableNo=${encodeURIComponent(currentTable)}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        const seenBills = new Set<string>();
        const uniqueOrders = data.filter((ord: any) => {
          const bNo = ord.BillNo || ord.billNo || ord.SettlementID || ord.SettlementId;
          if (!bNo || seenBills.has(bNo)) return false;
          seenBills.add(bNo);
          return true;
        });
        setCustomerOrders(uniqueOrders);
      }
    } catch (e) {
      console.log("Error fetching customer orders:", e);
    } finally {
      setOrdersLoading(false);
    }

    if (!phone || phone === "guest") return;

    setLoyaltyLoading(true);
    try {
      const [statusRes, progressRes] = await Promise.all([
        fetch(`${API_URL}/api/loyalty/status/${encodeURIComponent(phone)}`),
        fetch(`${API_URL}/api/loyalty/customer/${encodeURIComponent(phone)}/dish-progress`),
      ]);
      const statusData = await statusRes.json();
      const progressData = await progressRes.json();

      if (statusRes.ok && statusData.customer) {
        setLoyaltyStatus(statusData.customer);
      }
      if (progressRes.ok && Array.isArray(progressData)) {
        setDishProgress(progressData);
      }
    } catch (e) {
      console.log("Error fetching loyalty status:", e);
    } finally {
      setLoyaltyLoading(false);
    }
  };

  const handleApplyPromoInProfile = async () => {
    if (!promoInput.trim()) return;
    setPromoApplying(true);
    setPromoMsg(null);
    try {
      const codeToVerify = promoInput.trim();
      const res = await fetch(`${API_URL}/api/members/promocode/${encodeURIComponent(codeToVerify)}`);
      const data = await res.json();
      if (data.success && data.promoCode) {
        const amount = Number(data.promoCode.amount || 0);
        const updatedUser = {
          ...userInfo,
          PromoCode: data.promoCode.code,
          PromoAmount: amount,
        };
        setUserInfo(updatedUser as any);
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("qr_pos_user", JSON.stringify(updatedUser));
          localStorage.setItem("promoCode", data.promoCode.code);
        }
        setPromoMsg({ text: `Promo '${data.promoCode.code}' Linked! Balance: $${amount.toFixed(2)}`, type: "success" });
        setPromoInput("");
      } else {
        setPromoMsg({ text: data.message || "Invalid or expired promo code.", type: "error" });
      }
    } catch {
      setPromoMsg({ text: "Error connecting to server.", type: "error" });
    } finally {
      setPromoApplying(false);
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

  // Slide animation for floating cart
  const cartSlideAnim = useRef(new Animated.Value(100)).current;

  useEffect(() => {
    fetchMenu();
    // Inject hover styles for Web/customer menu
    if (Platform.OS === 'web') {
      const styleId = "customer-hover-styles";
      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent = `
          .hover-button:hover {
            opacity: 0.9 !important;
            transform: scale(1.04) !important;
            transition: all 0.15s ease-in-out !important;
          }
          .hover-card:hover {
            transform: translateY(-2px) !important;
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.08), 0 4px 6px -2px rgba(0, 0, 0, 0.04) !important;
            transition: all 0.2s ease-in-out !important;
          }
        `;
        document.head.appendChild(style);
      }
    }
  }, [orderContext?.tableId]);

  const getDishQtyInCart = (dishId: string) => {
    if (!currentContextId) return 0;
    const cart = carts[currentContextId] || [];
    return cart
      .filter((item: any) => (item.id === dishId || item.DishId === dishId) && item.status !== "VOIDED")
      .reduce((sum: number, item: any) => sum + (item.qty || 0), 0);
  };

  // 🔄 REAL-TIME SYNC: Listen for cart updates from backend (when another session places order)
  useEffect(() => {
    if (!orderContext?.tableId) return;
    const tableId = String(orderContext.tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();

    const { socket: sharedSocket } = require("../../constants/socket");
    sharedSocket.emit("join_table", { tableId });

    const handleCartUpdated = (data: { tableId: string; source?: string }) => {
      const incomingId = String(data.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
      if (incomingId === tableId) {
        useCartStore.getState().fetchCartFromDB(orderContext.tableId!, true);
      }
    };

    sharedSocket.on("cart_updated", handleCartUpdated);

    return () => {
      sharedSocket.off("cart_updated", handleCartUpdated);
    };
  }, [orderContext?.tableId]);

  const currentCart = (currentContextId ? carts[currentContextId] || [] : []).filter(item => item.status === "NEW" || !item.status);
  const totalItems = currentCart.reduce((sum, item) => sum + (item.qty || 0), 0);
  const subtotal = currentCart.reduce((sum, item) => sum + (item.price || 0) * (item.qty || 0), 0);

  // Trigger floating cart entrance
  useEffect(() => {
    if (totalItems > 0) {
      Animated.spring(cartSlideAnim, {
        toValue: 0,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(cartSlideAnim, {
        toValue: 100,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [totalItems]);

  // Helper for Customer QR Menu IsPublished filtering:
  // IsPublished = 0 (or false/null) -> SHOW (Published)
  // IsPublished = 1 (or true/'1') -> EXCLUDE (Unpublished)
  const isPublishedForQR = (val: any) => {
    if (val === 1 || val === true || String(val) === '1') {
      return false; // Exclude from QR menu
    }
    return true; // Show in QR menu
  };

  // Load first published kitchen by default
  useEffect(() => {
    const published = kitchens.filter(k => isPublishedForQR(k.IsPublished));
    if (published.length > 0 && !selectedKitchenId) {
      setSelectedKitchenId(published[0].CategoryId);
    }
  }, [kitchens]);

  // Load groups for the selected Category
  useEffect(() => {
    if (selectedKitchenId) {
      fetchGroups(selectedKitchenId).then((groups) => {
        const publishedGroups = groups.filter(g => isPublishedForQR(g.IsPublished));
        setDishGroups(publishedGroups);
        if (publishedGroups && publishedGroups.length > 0) {
          setSelectedGroupId(publishedGroups[0].DishGroupId);
        } else {
          setSelectedGroupId(null);
        }
      });
    }
  }, [selectedKitchenId]);

  // 🔌 Real-time Socket Listener for Menu Updates (e.g. IsPublished toggle = 1 or 0)
  useEffect(() => {
    const { socket: sharedSocket } = require("../../constants/socket");

    const handleMenuUpdated = (data: any) => {
      console.log("⚡ [QR Menu] Socket event received: menu_updated", data);
      forceRefreshMenu().then(() => {
        if (selectedKitchenId) {
          fetchGroups(selectedKitchenId).then((groups) => {
            const publishedGroups = groups.filter(g => isPublishedForQR(g.IsPublished));
            setDishGroups(publishedGroups);
            if (publishedGroups && publishedGroups.length > 0 && (!selectedGroupId || !publishedGroups.some(g => g.DishGroupId === selectedGroupId))) {
              setSelectedGroupId(publishedGroups[0].DishGroupId);
            }
          });
        }
      });
    };

    sharedSocket.on("menu_updated", handleMenuUpdated);

    return () => {
      sharedSocket.off("menu_updated", handleMenuUpdated);
    };
  }, [selectedKitchenId, selectedGroupId]);

  if (isSessionClosed) {
    // Check if it's a mobile browser (can't close tabs programmatically)
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

  // Live time ticker for auto dish disappearance/appearance based on AvailableTimeFrom/AvailableTimeTo
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 15000); // Check every 15s for live auto update
    return () => clearInterval(timer);
  }, []);

  const filteredDishes = allDishes.filter((dish: any) => {
    const isPub = dish.IsPublished !== undefined ? dish.IsPublished : dish.isPublished;
    const catPub = dish.CategoryPublished !== undefined ? dish.CategoryPublished : dish.categoryPublished;
    const grpPub = dish.GroupPublished !== undefined ? dish.GroupPublished : dish.groupPublished;

    // Exclude if IsPublished = 1 on Dish, Category, or Group level
    if (!isPublishedForQR(isPub) || !isPublishedForQR(catPub) || !isPublishedForQR(grpPub)) {
      return false;
    }

    // Hide if outside AvailableTimeFrom and AvailableTimeTo range
    const timeFrom = dish.AvailableTimeFrom || dish.availableTimeFrom;
    const timeTo = dish.AvailableTimeTo || dish.availableTimeTo;
    if (!isDishAvailableNow(timeFrom, timeTo, currentTime)) {
      return false;
    }

    const query = search.trim().toLowerCase();
    if (query.length > 0) {
      const nameMatch = dish.Name?.toLowerCase().includes(query);
      const descMatch = dish.Description?.toLowerCase().includes(query);
      return nameMatch || descMatch;
    }
    
    // Check if dish matches group (either primary DishGroupId or via DishGroupMapping)
    const matchesDishGroupId = (groupId: string) => {
      if (!groupId) return false;
      if (dish.DishGroupId === groupId) return true;
      if (dish.MappedGroupIds) {
        const mappedArr = String(dish.MappedGroupIds).split(',').map(s => s.trim()).filter(Boolean);
        return mappedArr.includes(groupId);
      }
      return false;
    };

    // Check if the dish belongs to any group in the currently selected category
    const belongsToCategory = dishGroups.some(g => matchesDishGroupId(g.DishGroupId));
    
    // If a group is selected, match it; otherwise ensure it belongs to the selected category
    const matchesGroup = selectedGroupId
      ? matchesDishGroupId(selectedGroupId)
      : belongsToCategory;
      
    return matchesGroup;
  });

  const handleAddSimple = (dish: any) => {
    const isSoldOut = dish.IsSoldOut === true || String(dish.IsSoldOut) === "1" || dish.IsSoldOut === 1 || dish.isSoldOut === true || String(dish.isSoldOut) === "1" || dish.isSoldOut === 1;
    if (isSoldOut) {
      Alert.alert("Sold Out", `${dish.Name} is currently unavailable.`);
      return;
    }
    const isCombo = dish.isCombo === true || String(dish.isCombo) === "1" || dish.isCombo === 1 || dish.IsCombo === true || String(dish.IsCombo) === "1" || dish.IsCombo === 1;
    const modifiers = modifierCache[dish.DishId || dish.id] || [];
    const hasModifiers = modifiers.length > 0 || Number(dish.HasModifiers) > 0;

    if (isCombo || hasModifiers) {
      router.push({
        pathname: "/customer/item-details" as any,
        params: { dishId: dish.DishId },
      });
    } else {
      addToCartGlobal({
        id: dish.DishId || dish.id,
        name: dish.Name,
        price: Number(dish.Price || 0),
        basePrice: Number(dish.Price || 0),
        isCombo: false,
        comboSelections: [],
        modifiers: [],
        status: "NEW",
        isServiceCharge: dish.isServiceCharge !== undefined ? dish.isServiceCharge : (dish.IsServiceCharge !== undefined ? dish.IsServiceCharge : 1),
      });
      Alert.alert("Added to Cart", `${dish.Name} has been added to your cart.`);
    }
  };

  const handleLogout = () => {
    setShowLogoutModal(true);
  };

  return (
    <View style={styles.container}>
      {/* Header bar */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.replace("/customer" as any)}>
          <Ionicons name="chevron-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Menu</Text>
          {orderContext?.tableNo && (
            <Text style={styles.tableBadge}>Table {orderContext.tableNo}</Text>
          )}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <TouchableOpacity style={styles.requestButton} onPress={() => setShowProfileModal(true)}>
            <Ionicons name="person-circle-outline" size={24} color={Theme.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.requestButton} onPress={() => router.push("/customer/order-status" as any)}>
            <Ionicons name="receipt-outline" size={22} color={Theme.primary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={20} color="#64748B" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search delicious food..."
          value={search}
          onChangeText={setSearch}
          placeholderTextColor="#94A3B8"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch("")} style={{ padding: 4 }}>
            <Ionicons name="close-circle" size={18} color="#94A3B8" />
          </TouchableOpacity>
        )}
      </View>

      {/* Horizontal Category Pill Bar */}
      <View style={styles.categoriesContainer}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={kitchens.filter(k => isPublishedForQR(k.IsPublished))}
          keyExtractor={(item) => item.CategoryId}
          renderItem={({ item }) => {
            const isSelected = selectedKitchenId === item.CategoryId;
            return (
              <TouchableOpacity
                style={[styles.categoryPill, isSelected && styles.categoryPillSelected]}
                onPress={() => setSelectedKitchenId(item.CategoryId)}
              >
                <Text style={[styles.categoryText, isSelected && styles.categoryTextSelected]}>
                  {item.KitchenTypeName}
                </Text>
              </TouchableOpacity>
            );
          }}
          contentContainerStyle={styles.categoriesContent}
        />
      </View>

      {/* Horizontal Dish Group Pill Bar */}
      {dishGroups.length > 0 && (
        <View style={styles.groupsContainer}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={dishGroups}
            keyExtractor={(item) => item.DishGroupId}
            renderItem={({ item }) => {
              const isSelected = selectedGroupId === item.DishGroupId;
              return (
                <TouchableOpacity
                  style={[styles.groupPill, isSelected && styles.groupPillSelected]}
                  onPress={() => setSelectedGroupId(item.DishGroupId)}
                >
                  <Text style={[styles.groupText, isSelected && styles.groupTextSelected]}>
                    {item.DishGroupName}
                  </Text>
                </TouchableOpacity>
              );
            }}
            contentContainerStyle={styles.groupsContent}
          />
        </View>
      )}

      {/* Main Dishes Catalog */}
      {isLoading ? (
        <ActivityIndicator size="large" color={Theme.primary} style={styles.loader} />
      ) : (
        <FlatList
          data={filteredDishes}
          keyExtractor={(item) => item.DishId || item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Theme.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="restaurant-outline" size={48} color="#94A3B8" />
              <Text style={styles.emptyText}>No items found in this category.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const isCombo = item.isCombo === true || String(item.isCombo) === "1" || item.isCombo === 1 || item.IsCombo === true || String(item.IsCombo) === "1" || item.IsCombo === 1;
            const modifiers = modifierCache[item.DishId || item.id] || [];
            const hasModifiers = modifiers.length > 0 || Number(item.HasModifiers) > 0;
            const needsCustomization = isCombo || hasModifiers;
            const isSoldOut = item.IsSoldOut === true || String(item.IsSoldOut) === "1" || item.IsSoldOut === 1 || item.isSoldOut === true || String(item.isSoldOut) === "1" || item.isSoldOut === 1;
            const qtyInCart = getDishQtyInCart(item.DishId || item.id);

            return (
              <View 
                style={[styles.dishCard, isSoldOut && { opacity: 0.7 }]}
                className="hover-card"
              >
                <View style={{ position: "relative" }}>
                  <Image
                    source={{
                      uri: item.Image
                        ? `${API_URL}/api/menu/image/${item.Image}`
                        : "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?q=80&w=150",
                    }}
                    style={styles.dishImage}
                  />
                  {qtyInCart > 0 && (
                    <View style={styles.dishQtyBadge}>
                      <Text style={styles.dishQtyBadgeText}>{qtyInCart}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.dishInfo}>
                  <Text style={styles.dishName}>{item.Name}</Text>
                  <Text style={styles.dishDescription} numberOfLines={2}>
                    {item.Description || "Delicious traditional recipe crafted with fresh ingredients."}
                  </Text>
                  <View style={styles.cardFooter}>
                    <Text style={styles.dishPrice}>${Number(item.Price || 0).toFixed(2)}</Text>
                    <TouchableOpacity 
                      style={[styles.addButton, isSoldOut && { backgroundColor: "#94A3B8" }]} 
                      onPress={() => handleAddSimple(item)}
                      disabled={isSoldOut}
                      className={!isSoldOut ? "hover-button" : ""}
                    >
                      <Text style={styles.addButtonText}>{isSoldOut ? "Sold Out" : (needsCustomization ? "Customize" : "Add")}</Text>
                      {!isSoldOut && <Ionicons name="add" size={16} color="#fff" />}
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Floating Uber-style Cart Bar */}
      <Animated.View style={[styles.floatingCart, { transform: [{ translateY: cartSlideAnim }] }]}>
        <View style={styles.cartContent}>
          <View>
            <Text style={styles.cartItemsCount}>
              {totalItems} {totalItems === 1 ? "Item" : "Items"}
            </Text>
            <Text style={styles.cartTotal}>${subtotal.toFixed(2)}</Text>
          </View>
          <TouchableOpacity style={styles.viewCartBtn} onPress={() => router.push("/customer/cart" as any)}>
            <Text style={styles.viewCartText}>View Cart</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" style={{ marginLeft: 4 }} />
          </TouchableOpacity>
        </View>
      </Animated.View>


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

      {/* Profile Details, History & Loyalty Modal */}
      <Modal
        visible={showProfileModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowProfileModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowProfileModal(false)}
        >
          <TouchableOpacity 
            activeOpacity={1}
            style={{ backgroundColor: "#fff", borderRadius: 24, padding: 22, width: "92%", maxWidth: 420, maxHeight: "88%", shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 10 }}
          >
            {/* Header */}
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <Text style={{ fontSize: 20, fontWeight: "800", color: "#0F172A" }}>My Profile</Text>
              <TouchableOpacity onPress={() => setShowProfileModal(false)} style={{ padding: 4 }}>
                <Ionicons name="close" size={24} color="#64748B" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
              {/* Profile Avatar Header */}
              <View style={{ alignItems: "center", marginBottom: 20 }}>
                <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: "#FFF2EC", justifyContent: "center", alignItems: "center", marginBottom: 10 }}>
                  <Ionicons name="person" size={30} color="#FF5E1A" />
                </View>
                <Text style={{ fontSize: 18, fontWeight: "800", color: "#0F172A" }}>
                  {userInfo?.FullName || userInfo?.UserName || "Guest Customer"}
                </Text>
                <Text style={{ fontSize: 13, color: "#64748B", fontWeight: "600", marginTop: 2 }}>
                  {userInfo?.Phone ? "Registered Customer" : "Guest Diner"}
                </Text>
              </View>

              {/* Account Details List */}
              <View style={{ gap: 14, marginBottom: 20, backgroundColor: "#F8FAFC", padding: 14, borderRadius: 18, borderWidth: 1, borderColor: "#E2E8F0" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Ionicons name="call" size={18} color="#FF5E1A" style={{ width: 20 }} />
                  <View>
                    <Text style={{ fontSize: 11, color: "#94A3B8", fontWeight: "700", textTransform: "uppercase" }}>Phone Number</Text>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: "#334155" }}>
                      {userInfo?.Phone || "Not provided"}
                    </Text>
                  </View>
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Ionicons name="mail" size={18} color="#FF5E1A" style={{ width: 20 }} />
                  <View>
                    <Text style={{ fontSize: 11, color: "#94A3B8", fontWeight: "700", textTransform: "uppercase" }}>Email Address</Text>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: "#334155" }}>
                      {userInfo?.Email || "Not provided"}
                    </Text>
                  </View>
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Ionicons name="gift" size={18} color="#FF5E1A" style={{ width: 20 }} />
                  <View>
                    <Text style={{ fontSize: 11, color: "#94A3B8", fontWeight: "700", textTransform: "uppercase" }}>Promo Balance</Text>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: "#10B981" }}>
                      {userInfo?.PromoCode ? `${userInfo.PromoCode} ($${Number(userInfo.PromoAmount).toFixed(2)})` : "No promo active"}
                    </Text>
                  </View>
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Ionicons name="time" size={18} color="#FF5E1A" style={{ width: 20 }} />
                  <View>
                    <Text style={{ fontSize: 11, color: "#94A3B8", fontWeight: "700", textTransform: "uppercase" }}>Session Started</Text>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: "#334155" }}>
                      Today, {formatToSingaporeTime(new Date())}
                    </Text>
                  </View>
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Ionicons name="location" size={18} color="#FF5E1A" style={{ width: 20 }} />
                  <View>
                    <Text style={{ fontSize: 11, color: "#94A3B8", fontWeight: "700", textTransform: "uppercase" }}>Dining Location</Text>
                    <Text style={{ fontSize: 14, fontWeight: "700", color: "#334155" }}>
                      Table {orderContext?.tableNo || "Default Table"} ({orderContext?.section || "SECTION_1"})
                    </Text>
                  </View>
                </View>
              </View>

              {/* Order History Accordion Button */}
              <View style={{ marginBottom: 12 }}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setShowOrderHistorySection(!showOrderHistorySection)}
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    backgroundColor: showOrderHistorySection ? "#FFF5ED" : "#F8FAFC",
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    borderRadius: 14,
                    borderWidth: 1.5,
                    borderColor: showOrderHistorySection ? "#FF5E1A" : "#E2E8F0",
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Ionicons name="time" size={18} color="#FF5E1A" />
                    <Text style={{ fontSize: 13, fontWeight: "800", color: "#0F172A", textTransform: "uppercase" }}>
                      Order History
                    </Text>
                  </View>
                  <Ionicons name={showOrderHistorySection ? "chevron-up" : "chevron-down"} size={20} color="#FF5E1A" />
                </TouchableOpacity>

                {showOrderHistorySection && (
                  <View style={{ marginTop: 10, gap: 10 }}>
                    {!userInfo?.Phone ? (
                      <Text style={{ fontSize: 12, color: "#64748B", fontStyle: "italic", textAlign: "center", marginVertical: 8 }}>
                        Please register or log in with your phone number to view order history.
                      </Text>
                    ) : ordersLoading ? (
                      <ActivityIndicator size="small" color="#FF5E1A" style={{ marginVertical: 10 }} />
                    ) : customerOrders.length > 0 ? (
                      customerOrders.map((order, idx) => {
                        const dateText = order.OrderDateTime 
                          ? formatToSingaporeDate(order.OrderDateTime)
                          : "N/A";
                        const timeText = order.OrderDateTime
                          ? formatToSingaporeTime(order.OrderDateTime)
                          : "";
                        return (
                          <View
                            key={order.SettlementID || idx}
                            style={{
                              backgroundColor: "#F8FAFC",
                              padding: 12,
                              borderRadius: 14,
                              borderWidth: 1,
                              borderColor: "#E2E8F0",
                              flexDirection: "row",
                              justifyContent: "space-between",
                              alignItems: "center"
                            }}
                          >
                            <View>
                              <Text style={{ fontSize: 13, fontWeight: "800", color: "#1E293B" }}>
                                Bill #{order.BillNo || "N/A"}
                              </Text>
                              <Text style={{ fontSize: 11, color: "#64748B", fontWeight: "600", marginTop: 2 }}>
                                {dateText} {timeText ? `• ${timeText}` : ""}
                              </Text>
                              <Text style={{ fontSize: 11, color: "#FF5E1A", fontWeight: "700", marginTop: 2 }}>
                                {order.PayMode || "Paid"}
                              </Text>
                            </View>
                            <Text style={{ fontSize: 14, fontWeight: "800", color: "#1E293B" }}>
                              ${Number(order.TotalAmount || 0).toFixed(2)}
                            </Text>
                          </View>
                        );
                      })
                    ) : (
                      <Text style={{ fontSize: 12, color: "#64748B", fontStyle: "italic", textAlign: "center", marginVertical: 8 }}>
                        No past orders found.
                      </Text>
                    )}
                  </View>
                )}
              </View>

              {/* Loyalty & Rewards Accordion Button (Hidden if ShowLoyalty setting is OFF or if guest) */}
              {!!userInfo?.Phone && generalSettings?.showLoyalty !== false && (
                <View style={{ marginBottom: 12 }}>
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => setShowLoyaltySection(!showLoyaltySection)}
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      backgroundColor: showLoyaltySection ? "#FFF5ED" : "#F8FAFC",
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      borderRadius: 14,
                      borderWidth: 1.5,
                      borderColor: showLoyaltySection ? "#FF5E1A" : "#E2E8F0",
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Ionicons name="ribbon" size={18} color="#FF5E1A" />
                      <Text style={{ fontSize: 13, fontWeight: "800", color: "#0F172A", textTransform: "uppercase" }}>
                        Loyalty & Rewards
                      </Text>
                    </View>
                    <Ionicons name={showLoyaltySection ? "chevron-up" : "chevron-down"} size={20} color="#FF5E1A" />
                  </TouchableOpacity>

                  {showLoyaltySection && (
                    <View style={{ marginTop: 10, gap: 12 }}>
                      {/* Loyalty Visit Stats Card */}
                      <View style={{ backgroundColor: "#FF5E1A", borderRadius: 16, padding: 14, shadowColor: "#FF5E1A", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 6 }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Ionicons name="sparkles" size={18} color="#FFFFFF" />
                            <Text style={{ fontSize: 15, fontWeight: "800", color: "#FFFFFF" }}>Loyalty Visits</Text>
                          </View>
                          <View style={{ backgroundColor: "rgba(255,255,255,0.25)", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 }}>
                            <Text style={{ fontSize: 12, fontWeight: "800", color: "#FFFFFF" }}>
                              {loyaltyStatus?.TotalVisits || loyaltyStatus?.VisitCount || 0} Total Visits
                            </Text>
                          </View>
                        </View>

                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                          <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.9)", fontWeight: "600" }}>
                            Current Cycle: {loyaltyStatus?.VisitCount || 0} visits
                          </Text>
                          {(loyaltyStatus?.RewardPending === 1 || loyaltyStatus?.RewardPending === true) && (
                            <View style={{ backgroundColor: "#10B981", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                              <Text style={{ fontSize: 11, fontWeight: "800", color: "#FFFFFF" }}>🎁 Reward Unlocked</Text>
                            </View>
                          )}
                        </View>
                      </View>

                      {/* Active Dish Loyalty Campaigns */}
                      {dishProgress.length > 0 && (
                        <View style={{ gap: 10 }}>
                          <Text style={{ fontSize: 12, fontWeight: "800", color: "#0F172A", textTransform: "uppercase" }}>
                            🍽️ Active Loyalty Campaigns
                          </Text>
                          {dishProgress.map((prog) => {
                            const progressPercent = Math.min(
                              100,
                              Math.round(((prog.CurrentCount || 0) / (prog.RequiredBills || 1)) * 100)
                            );
                            return (
                              <View key={prog.RuleId || prog.CampaignName} style={{ backgroundColor: "#F8FAFC", borderRadius: 14, padding: 12, borderWidth: 1, borderColor: "#E2E8F0" }}>
                                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                                  <Text style={{ fontSize: 14, fontWeight: "800", color: "#0F172A", flex: 1 }}>
                                    {prog.CampaignName}
                                  </Text>
                                  {prog.RewardsAvailable > 0 && (
                                    <View style={{ backgroundColor: "#10B981", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                                      <Text style={{ fontSize: 11, fontWeight: "800", color: "#FFFFFF" }}>🎁 {prog.RewardsAvailable} Free</Text>
                                    </View>
                                  )}
                                </View>

                                {/* Eligible Dish to Buy */}
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8 }}>
                                  <Ionicons name="cart-outline" size={14} color="#334155" />
                                  <Text style={{ fontSize: 12, fontWeight: "700", color: "#334155" }}>
                                    Buy: <Text style={{ color: "#FF5E1A", fontWeight: "800" }}>{prog.PurchaseDishName || "Eligible Dish"}</Text>
                                  </Text>
                                </View>

                                {/* Progress bar */}
                                <View style={{ height: 8, backgroundColor: "#E2E8F0", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
                                  <View style={{ height: "100%", backgroundColor: "#FF5E1A", width: `${progressPercent}%`, borderRadius: 4 }} />
                                </View>

                                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                                  <Text style={{ fontSize: 11, fontWeight: "700", color: "#64748B" }}>
                                    {prog.CurrentCount || 0} / {prog.RequiredBills} purchased
                                  </Text>
                                  <Text style={{ fontSize: 11, fontWeight: "800", color: "#10B981" }}>
                                    Reward: Free {prog.RewardDishName}
                                  </Text>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )}
            </ScrollView>

            {/* Modal Action Button */}
            <TouchableOpacity 
              style={{ width: "100%", paddingVertical: 13, backgroundColor: "#FF5E1A", borderRadius: 14, alignItems: "center", marginTop: 14 }}
              onPress={() => setShowProfileModal(false)}
            >
              <Text style={{ fontSize: 15, fontWeight: "800", color: "#fff" }}>Close</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
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
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: "#ffffff",
    borderBottomWidth: 0,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 3,
  },
  backButton: {
    padding: 8,
  },
  headerTitleContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#0F172A",
  },
  tableBadge: {
    marginLeft: 8,
    backgroundColor: "#FFF5ED", 
    color: Theme.primary,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  requestButton: {
    padding: 8,
  },
  logoutButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: "#FEF2F2",
    alignItems: "center",
    justifyContent: "center",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    marginHorizontal: 16,
    marginVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 20, 
    height: 52,
    borderWidth: 1.5,
    borderColor: "#F1F5F9",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.03,
    shadowRadius: 10,
    elevation: 2,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: "#0F172A",
    fontSize: 15,
  },
  categoriesContainer: {
    backgroundColor: "#F8FAFC",
    paddingBottom: 4,
  },
  categoriesContent: {
    paddingHorizontal: 16,
  },
  groupsContainer: {
    backgroundColor: "#F8FAFC",
    paddingBottom: 10,
    paddingTop: 4,
  },
  groupsContent: {
    paddingHorizontal: 16,
  },
  groupPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#fff",
    borderWidth: 1.5,
    borderColor: "#F1F5F9",
    marginRight: 8,
    cursor: "pointer",
  },
  groupPillSelected: {
    backgroundColor: Theme.primary,
    borderColor: Theme.primary,
    borderWidth: 1.5,
  },
  groupText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
  },
  groupTextSelected: {
    color: "#fff",
    fontWeight: "700",
  },
  categoryPill: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: "#F1F5F9",
    marginRight: 10,
    borderWidth: 1.5,
    borderColor: "transparent",
    cursor: "pointer",
  },
  categoryPillSelected: {
    backgroundColor: "#FFF7ED", 
    borderColor: Theme.primary,
  },
  categoryText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#64748B",
  },
  categoryTextSelected: {
    color: Theme.primary,
  },
  loader: {
    flex: 1,
    justifyContent: "center",
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 80,
  },
  emptyText: {
    color: "#64748B",
    marginTop: 12,
    fontSize: 15,
  },
  dishCard: {
    flexDirection: "row",
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 16,
    marginBottom: 18,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 16,
    elevation: 3,
    borderWidth: 1,
    borderColor: "#F8FAFC",
    cursor: "pointer",
  },
  dishImage: {
    width: 100,
    height: 100,
    borderRadius: 18,
  },
  dishQtyBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: Theme.primary,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 5,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
    zIndex: 10,
  },
  dishQtyBadgeText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "bold",
  },
  dishInfo: {
    flex: 1,
    marginLeft: 14,
    justifyContent: "space-between",
  },
  dishName: {
    fontSize: 17,
    fontWeight: "800",
    color: "#0F172A",
    letterSpacing: -0.3,
  },
  dishDescription: {
    fontSize: 13,
    color: "#64748B",
    lineHeight: 18,
    marginTop: 4,
  },
  cardFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  dishPrice: {
    fontSize: 18,
    fontWeight: "900",
    color: "#0F172A",
  },
  addButton: {
    backgroundColor: Theme.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: Theme.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 2,
    cursor: "pointer",
  },
  addButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    marginRight: 4,
  },
  floatingCart: {
    position: "absolute",
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: "#1E293B",
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  cartContent: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  cartItemsCount: {
    color: "#94A3B8",
    fontSize: 12,
  },
  cartTotal: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
  },
  viewCartBtn: {
    backgroundColor: Theme.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  viewCartText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
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


