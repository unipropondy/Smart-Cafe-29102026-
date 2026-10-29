import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { usePathname } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View,
} from "react-native";

import { API_URL } from "@/constants/Config";
import { SafeAreaView } from "react-native-safe-area-context";
import { useToast } from "../components/Toast";
import { Fonts } from "../constants/Fonts";
import { Theme } from "../constants/theme";
import WindowControls from "../components/WindowControls";

import { useAuthStore } from "@/stores/authStore";
import CancelOrderModal from "../components/CancelOrderModal";
import VoidItemModal from "../components/VoidItemModal";
import DiscountModal from "../components/DiscountModal";
import ItemDiscountModal from "../components/ItemDiscountModal";
import ServerSelectionModal from "../components/ServerSelectionModal";
import UniversalPrinter from "../components/UniversalPrinter";
import {
  findActiveOrder,
  useActiveOrdersStore,
  voidOrderItem,
} from "../stores/activeOrdersStore";
import { useCartStore } from "../stores/cartStore";
import { CustomerDisplaySync } from "../utils/CustomerDisplaySync";
import { useCompanySettingsStore } from "../stores/companySettingsStore";
import { useGeneralSettingsStore } from "../stores/generalSettingsStore";
import {
  getOrderContext,
  setOrderContext,
  useOrderContextStore,
} from "../stores/orderContextStore";
import { useTableStatusStore } from "../stores/tableStatusStore";
import { useServiceChargeOverrideStore } from "../stores/serviceChargeOverrideStore";

const EMPTY_ARRAY: any[] = [];

const COUNTRIES = [
  { code: "+65", flag: "🇸🇬", name: "Singapore" },
  { code: "+91", flag: "🇮🇳", name: "India" },
  { code: "+60", flag: "🇲🇾", name: "Malaysia" },
];

const parsePhone = (fullPhone: string) => {
  const clean = String(fullPhone || "").trim();
  for (const c of COUNTRIES) {
    if (clean.startsWith(c.code)) {
      const rest = clean.substring(c.code.length).trim();
      return { country: c, rest };
    }
  }
  return { country: COUNTRIES[0], rest: clean };
};

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

const getInitials = (name?: string) => {
  if (!name) return "G";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

export default function SummaryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { showToast } = useToast();
  const pathname = usePathname();
  const isFocused = pathname === "/summary";

  const context = useOrderContextStore((state) => state.currentOrder);
  const activeOrder = context ? findActiveOrder(context) : undefined;

  const [showDiscount, setShowDiscount] = useState(false);
  const [showDiscountTypeModal, setShowDiscountTypeModal] = useState(false);
  const [showGstModal, setShowGstModal] = useState(false);
  const [showItemDiscount, setShowItemDiscount] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReasons, setCancelReasons] = useState<
    Array<{ CRCode: string; CRName: string }>
  >([]);
  const [selectedCancelReason, setSelectedCancelReason] = useState<
    string | null
  >(null);
  const [customCancelReason, setCustomCancelReason] = useState("");
  const [isCancellingOrder, setIsCancellingOrder] = useState(false);
  const [loadingReasons, setLoadingReasons] = useState(false);
  const [cancelPassword, setCancelPassword] = useState("");
  const [itemToVoid, setItemToVoid] = useState<any | null>(null);
  const [showVoidModal, setShowVoidModal] = useState(false);
  const [voidPassword, setVoidPassword] = useState("");

  const [showServerModal, setShowServerModal] = useState(false);
  const [servers, setServers] = useState<
    Array<{ SER_ID: number; SER_NAME: string }>
  >([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [showBillOptions, setShowBillOptions] = useState(false);
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [selectedMergeOrderIds, setSelectedMergeOrderIds] = useState<string[]>([]);
  const [confirmMergeVisible, setConfirmMergeVisible] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [scReduced, setScReduced] = useState(false);
  const [isReducingSC, setIsReducingSC] = useState(false);
  const [takeawayChargeApplied, setTakeawayChargeApplied] = useState(true);
  const [takeawayChargeAmt, setTakeawayChargeAmt] = useState(0);
  const [isApplyingTakeaway, setIsApplyingTakeaway] = useState(false);
  const [splitQuantities, setSplitQuantities] = useState<
    Record<string, number>
  >({});
  const [allDishes, setAllDishes] = useState<any[]>([]);
  const [searchDishText, setSearchDishText] = useState("");
  const [extraSplitItems, setExtraSplitItems] = useState<any[]>([]);
  const [hasAttemptedInitialFetch, setHasAttemptedInitialFetch] = useState(false);
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [splitType, setSplitType] = useState<"items" | "parts">("items");
  const [partCount, setPartCount] = useState<number>(2);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [promoCodeInput, setPromoCodeInput] = useState("");
  const [isApplyingPromo, setIsApplyingPromo] = useState(false);
  const [availablePromos, setAvailablePromos] = useState<any[]>([]);
  const [loadingPromos, setLoadingPromos] = useState(false);

  const [loyaltyPhone, setLoyaltyPhone] = useState("");
  const [loyaltyName, setLoyaltyName] = useState("");
  const [loyaltyCustomer, setLoyaltyCustomer] = useState<any | null>(null);
  const [isSearchingLoyalty, setIsSearchingLoyalty] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState(COUNTRIES[0]);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showLoyaltyModal, setShowLoyaltyModal] = useState(false);
  const [defaultLoyaltyMembers, setDefaultLoyaltyMembers] = useState<any[]>([]);
  const [loyaltySearchText, setLoyaltySearchText] = useState("");
  const [activeLoyaltyTab, setActiveLoyaltyTab] = useState<"search" | "register">("search");
  const [isRegisteringLoyalty, setIsRegisteringLoyalty] = useState(false);
  
  // 🏆 REWARD POINTS STATES
  const [rewardMember, setRewardMember] = useState<any | null>(null);
  const [showRewardModal, setShowRewardModal] = useState(false);
  const [rewardSearchText, setRewardSearchText] = useState("");
  const [rewardSearchResults, setRewardSearchResults] = useState<any[]>([]);
  const [isSearchingRewards, setIsSearchingRewards] = useState(false);

  const tableState = useTableStatusStore((s: any) => {
    if (!context?.tableId) return null;
    const cleanId = String(context.tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
    return s.tableMap[cleanId] || (s.tables || []).find((t: any) => String(t.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase() === cleanId) || null;
  });

  const handleLoyaltyLookup = useCallback(async (phoneToSearch?: string, silent: boolean = false) => {
    let targetPhone = phoneToSearch || loyaltyPhone;
    if (!targetPhone || targetPhone.trim() === "") {
      if (!silent) {
        showToast({ type: "warning", message: "Enter Phone", subtitle: "Please input a valid phone number" });
      }
      return;
    }
    if (!phoneToSearch) {
      targetPhone = `${selectedCountry.code} ${targetPhone.trim()}`;
    }
    setIsSearchingLoyalty(true);
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(`${API_URL}/api/loyalty/status/${encodeURIComponent(targetPhone.trim())}`, {
        headers: {
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        }
      });
      const data = await res.json();
      if (data.success) {
        setLoyaltyCustomer(data.customer);
        if (data.customer.Name) {
          setLoyaltyName(data.customer.Name);
        }
        if (!silent) {
          showToast({
            type: "success",
            message: data.exists ? "Customer Found" : "New Customer Enrolled",
            subtitle: data.exists ? `Visits: ${data.customer.VisitCount} (Lifetime: ${data.customer.TotalVisits || 0})` : "First visit recorded upon checkout"
          });

          if (data.customer.RewardPending === 1 || data.customer.VisitCount === 9) {
            Alert.alert(
              "Loyalty Reward",
              "🎉 Customer is eligible for a free food reward.",
              [{ text: "OK" }]
            );
          }
        }
      } else if (!silent) {
        showToast({ type: "error", message: "Lookup Failed", subtitle: data.error || "Failed to search customer" });
      }
    } catch (err: any) {
      console.error("Loyalty lookup error:", err);
      if (!silent) {
        showToast({ type: "error", message: "Error connecting to server" });
      }
    } finally {
      setIsSearchingLoyalty(false);
    }
  }, [loyaltyPhone, selectedCountry, showToast]);

  const handleSearchPhone = async (text: string) => {
    setLoyaltyPhone(text);
    if (loyaltyCustomer) {
      setLoyaltyCustomer(null);
      setLoyaltyName("");
    }
    const cleanText = text.trim();
    if (cleanText.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const token = useAuthStore.getState().token;
      const query = cleanText;
      const res = await fetch(`${API_URL}/api/loyalty/search?q=${encodeURIComponent(query)}`, {
        headers: {
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        }
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setSearchResults(data);
      }
    } catch (err) {
      console.error("Loyalty search error:", err);
    }
  };

  // 🏆 REWARD POINTS MEMBER LOOKUP
  const handleRewardSearch = async (text: string) => {
    setRewardSearchText(text);
    const clean = text.trim();
    setIsSearchingRewards(true);
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(`${API_URL}/api/rewards/members/search?q=${encodeURIComponent(clean)}`, {
        headers: token ? { "Authorization": `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setRewardSearchResults(data);
      }
    } catch (err) {
      console.error("Reward member search error:", err);
    } finally {
      setIsSearchingRewards(false);
    }
  };

  useEffect(() => {
    if (showRewardModal) {
      handleRewardSearch("");
    }
  }, [showRewardModal]);

  const handleSearchTextChange = async (text: string) => {
    setLoyaltySearchText(text);
    const cleanText = text.trim();
    if (cleanText.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(`${API_URL}/api/loyalty/search?q=${encodeURIComponent(cleanText)}`, {
        headers: {
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        }
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setSearchResults(data);
      }
    } catch (err) {
      console.error("Loyalty search error:", err);
    }
  };

  const handleSelectCustomer = (cust: any) => {
    const parsed = parsePhone(cust.Phone);
    setSelectedCountry(parsed.country);
    setLoyaltyPhone(parsed.rest);
    setLoyaltyCustomer(cust);
    if (cust.Name) {
      setLoyaltyName(cust.Name);
    }
    setSearchResults([]);
    if (cust.RewardPending === 1 || cust.VisitCount === 9) {
      Alert.alert(
        "Loyalty Reward",
        "🎉 Customer is eligible for a free food reward.",
        [{ text: "OK" }]
      );
    }
  };

  const handleLoyaltyRegister = async () => {
    if (!loyaltyPhone || loyaltyPhone.trim() === "") {
      showToast({ type: "warning", message: "Phone Required", subtitle: "Please enter a phone number first" });
      return;
    }
    setIsRegisteringLoyalty(true);
    try {
      const token = useAuthStore.getState().token;
      const fullPhone = `${selectedCountry.code} ${loyaltyPhone.trim()}`;
      const res = await fetch(`${API_URL}/api/loyalty/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ phone: fullPhone, name: loyaltyName.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setLoyaltyCustomer(data.customer);
        if (data.customer.Name) setLoyaltyName(data.customer.Name);
        // Refresh default members list
        const token2 = useAuthStore.getState().token;
        const r2 = await fetch(`${API_URL}/api/loyalty/search?q=`, {
          headers: { ...(token2 ? { Authorization: `Bearer ${token2}` } : {}) },
        });
        const d2 = await r2.json();
        if (Array.isArray(d2)) setDefaultLoyaltyMembers(d2);
        showToast({
          type: "success",
          message: data.exists ? "Already Registered" : "Customer Added!",
          subtitle: data.exists ? "Customer already exists in the loyalty program" : `${data.customer.Name || fullPhone} enrolled successfully`,
        });
      } else {
        showToast({ type: "error", message: "Registration Failed", subtitle: data.error || "Could not register customer" });
      }
    } catch (err: any) {
      console.error("Loyalty register error:", err);
      showToast({ type: "error", message: "Connection Error", subtitle: "Could not reach server" });
    } finally {
      setIsRegisteringLoyalty(false);
    }
  };

  useEffect(() => {
    if (showLoyaltyModal) {
      const fetchDefaults = async () => {
        try {
          const token = useAuthStore.getState().token;
          const res = await fetch(`${API_URL}/api/loyalty/search?q=`, {
            headers: {
              ...(token ? { "Authorization": `Bearer ${token}` } : {})
            }
          });
          const data = await res.json();
          if (Array.isArray(data)) {
            setDefaultLoyaltyMembers(data);
          }
        } catch (err) {
          console.error("Fetch default loyalty members error:", err);
        }
      };
      fetchDefaults();
    }
  }, [showLoyaltyModal]);

  const settings = useCompanySettingsStore((state: any) => state.settings);
  const currencySymbol = settings.currencySymbol || "$";
  const gstRate = (settings.gstPercentage || 0) / 100;
  const isTakeawayOrder = context?.orderType === "TAKEAWAY";
  const scRate = isTakeawayOrder ? 0 : (settings.serviceChargePercentage || 0) / 100;
  const twScRate = (settings.twServiceChargePercentage || 0) / 100;

  const enableKOT = useGeneralSettingsStore((s: any) => s.settings.enableKOT);
  const enableCheckoutBill = useGeneralSettingsStore((s: any) => s.settings.enableCheckoutBill);
  const showLoyalty = useGeneralSettingsStore((s: any) => s.settings.showLoyalty !== false);
  const showRewardPoints = useGeneralSettingsStore((s: any) => s.settings.showRewardPoints !== false);
  const showPromoCode = useGeneralSettingsStore((s: any) => s.settings.showPromoCode !== false);

  // Re-fetch General Settings whenever screen is focused to ensure toggle state is fresh
  useEffect(() => {
    if (isFocused) {
      useGeneralSettingsStore.getState().fetchSettings().catch(() => {});
    }
  }, [isFocused]);

  // 🎯 UNIFIED CUSTOMER AUTO-SELECTION FOR QR & REGISTERED ORDERS
  const lastAutoSelectedRef = useRef<string>("");

  const autoSelectCustomer = useCallback(
    async (cust: {
      customerId?: string;
      mobileNo?: string;
      customerName?: string;
    }) => {
      // 1. Read General Settings toggle: When Loyalty Feature is OFF, auto-selection must not run
      const genSettings = useGeneralSettingsStore.getState().settings;
      const isLoyaltyEnabled = genSettings.showLoyalty !== false;
      const isRewardEnabled = genSettings.showRewardPoints !== false;

      if (!isLoyaltyEnabled) {
        console.log("🎯 [Summary] Auto-selection skipped: Loyalty Feature is turned OFF in General Settings");
        return;
      }

      const id = (cust.customerId || "").trim();
      const phone = (cust.mobileNo || "").trim();
      const name = (cust.customerName || "").trim();

      // If both ID and phone are empty, or explicitly anonymous guest with no ID/phone, preserve guest/manual flow
      if (!id && !phone) return;
      if (!id && !phone && (!name || name.toLowerCase() === "guest")) return;

      const key = `${id}__${phone}`;
      if (lastAutoSelectedRef.current === key) return;
      lastAutoSelectedRef.current = key;

      console.log("🎯 [Summary] Auto-selecting customer (Loyalty Feature is ON):", { id, phone, name });

      try {
        const token = useAuthStore.getState().token;
        let effectivePhone = phone;
        let effectiveName = name && name.toLowerCase() !== "guest" ? name : "";

        // Fetch Member for Reward Points & Member Info (only if Reward Points Feature is enabled)
        if (isRewardEnabled) {
          const lookupUrl = `${API_URL}/api/rewards/members/by-id-or-phone?id=${encodeURIComponent(id)}&phone=${encodeURIComponent(phone)}`;
          const res = await fetch(lookupUrl, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const data = await res.json();

          if (data.success && data.member) {
            setRewardMember(data.member);
            if (data.member.Phone) effectivePhone = data.member.Phone;
            if (data.member.Name) effectiveName = data.member.Name;
          }
        }

        // Select Loyalty and load visits & reward eligibility silently
        if (effectivePhone) {
          const parsed = parsePhone(effectivePhone);
          setSelectedCountry(parsed.country);
          setLoyaltyPhone(parsed.rest);
          handleLoyaltyLookup(effectivePhone, true);
        }

        if (effectiveName) {
          setLoyaltyName(effectiveName);
        }
      } catch (err) {
        console.error("🎯 [Summary] autoSelectCustomer error:", err);
      }
    },
    [handleLoyaltyLookup],
  );

  // If Loyalty Feature toggle is turned OFF, clear auto-selected customer to preserve manual/empty flow
  useEffect(() => {
    if (!showLoyalty) {
      lastAutoSelectedRef.current = "";
      setLoyaltyCustomer(null);
      setRewardMember(null);
      setLoyaltyPhone("");
      setLoyaltyName("");
    }
  }, [showLoyalty]);

  // If Reward Points toggle is turned OFF, unlink rewardMember
  useEffect(() => {
    if (!showRewardPoints && rewardMember) {
      setRewardMember(null);
    }
  }, [showRewardPoints]);

  const currentContextId = useCartStore((s: any) => s.currentContextId);
  const cart = useCartStore((s: any) => (currentContextId ? s.carts[currentContextId] : undefined) || EMPTY_ARRAY);
  const orderCustomer = useCartStore((s: any) => (currentContextId ? s.orderCustomers?.[currentContextId] : undefined));

  // Trigger customer auto-selection whenever activeOrder, tableState, or orderCustomer is available (if toggle is ON)
  useEffect(() => {
    if (!showLoyalty) return; // Skip auto-selection when toggle is OFF
    const custId =
      (activeOrder as any)?.customerId ||
      (activeOrder as any)?.CustomerId ||
      orderCustomer?.customerId ||
      "";
    const phone =
      (activeOrder as any)?.mobileNo ||
      (activeOrder as any)?.MobileNo ||
      orderCustomer?.mobileNo ||
      (tableState as any)?.mobileNo ||
      (tableState as any)?.MobileNo ||
      "";
    const name =
      (activeOrder as any)?.customerName ||
      (activeOrder as any)?.CustomerName ||
      orderCustomer?.customerName ||
      (tableState as any)?.customerName ||
      (tableState as any)?.CustomerName ||
      "";

    if (custId || (phone && phone.trim() !== "")) {
      autoSelectCustomer({ customerId: custId, mobileNo: phone, customerName: name });
    } else if (name && name.trim() !== "" && name.toLowerCase() !== "guest") {
      setLoyaltyName(name);
    }
  }, [activeOrder, tableState, orderCustomer, showLoyalty, autoSelectCustomer]);

  // Unified customer name for summary header and bill summary
  const effectiveCustomerName =
    loyaltyCustomer?.Name ||
    loyaltyName ||
    rewardMember?.Name ||
    (activeOrder as any)?.customerName ||
    (activeOrder as any)?.CustomerName ||
    orderCustomer?.customerName ||
    (tableState as any)?.customerName ||
    (tableState as any)?.CustomerName ||
    "";

  // QR Session Matcher for same-device web testing (if toggle is ON)
  useEffect(() => {
    if (!showLoyalty) return; // Skip auto-selection when toggle is OFF
    if (Platform.OS === "web" && typeof window !== "undefined" && window.localStorage && !rewardMember) {
      try {
        const savedUserStr = localStorage.getItem("qr_pos_user");
        if (savedUserStr) {
          const savedUser = JSON.parse(savedUserStr);
          const savedTableId = localStorage.getItem("qr_pos_table_id");
          const savedTableNo = localStorage.getItem("qr_pos_table_no");
          const currentTableId = context?.tableId;
          const currentTableNo = context?.tableNo;

          const matchesTable =
            (currentTableId && savedTableId && currentTableId.toLowerCase() === savedTableId.toLowerCase()) ||
            (currentTableNo && savedTableNo && String(currentTableNo).toLowerCase() === String(savedTableNo).toLowerCase());

          if (matchesTable && (savedUser.MemberId || savedUser.CustomerId || savedUser.phone)) {
            autoSelectCustomer({
              customerId: savedUser.CustomerId || savedUser.MemberId || savedUser.UserId,
              mobileNo: savedUser.phone || savedUser.Phone || savedUser.mobileNo,
              customerName: savedUser.name || savedUser.Name || savedUser.customerName,
            });
          }
        }
      } catch (e) {
        // ignore
      }
    }
  }, [context?.tableId, context?.tableNo, rewardMember, showLoyalty, autoSelectCustomer]);

  useEffect(() => {
    if (params.autoPay === "true" && context) {
      router.setParams({ autoPay: undefined });
      router.push({
        pathname: "/payment",
        params: {
          mobileNo: loyaltyPhone ? `${selectedCountry.code} ${loyaltyPhone.trim()}` : "",
          customerName: loyaltyName || "",
          rewardMemberId: rewardMember?.MemberId || "",
        },
      });
    }
  }, [params.autoPay, context, loyaltyPhone, selectedCountry, loyaltyName, rewardMember]);
  
  const currentTableOrderId = useCartStore((s: any) => context?.tableId ? s.tableOrderIds[context.tableId] : undefined);
  const displayOrderId = currentTableOrderId || activeOrder?.orderId;

  const hasHydrated = useActiveOrdersStore((s: any) => s._hasHydrated);

  const [orderLoadTimeout, setOrderLoadTimeout] = useState(true);

  useEffect(() => {
    // Only show loading briefly — don't block forever
    const t = setTimeout(() => setOrderLoadTimeout(false), 2000);
    const { splitPartsCount } = useCartStore.getState();
    if (!splitPartsCount) {
      useCartStore.getState().setActiveSplitItems(null);
    }
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    // 1. Sync official Order ID and customer from DB
    if (context?.tableId) {
      fetch(`${API_URL}/api/tables/${context.tableId}`)
        .then((res) => res.json())
        .then((data) => {
          const oid = data.table?.currentOrderId || data.table?.CurrentOrderId;
          if (data.success && oid) {
            useCartStore
              .getState()
              .setTableOrderId(context.tableId!, oid);
          }
          if (data.success && data.table) {
            const custId = data.table.customerId || data.table.CustomerId;
            const phone = data.table.mobileNo || data.table.MobileNo;
            const name = data.table.customerName || data.table.CustomerName;
            if (showLoyalty && (custId || (phone && String(phone).trim() !== ""))) {
              autoSelectCustomer({ customerId: custId, mobileNo: phone, customerName: name });
            }
          }
        })
        .catch((err) => console.error("Summary ID sync error:", err));
    }
  }, [activeOrder, context?.tableId, showLoyalty, autoSelectCustomer]);

  // Load saved SC override and takeaway charge for this order whenever focused
  useEffect(() => {
    if (displayOrderId && isFocused) {
      const token = useAuthStore.getState().token;

      if (context?.tableId) {
        useCartStore.getState().fetchCartFromDB(context.tableId, true).catch(() => {});
      }

      fetch(`${API_URL}/api/orders/${displayOrderId}/sc-override`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then((r) => r.json())
        .then((d) => {
          if (d?.serviceChargeReduced) {
            setScReduced(true);
            useServiceChargeOverrideStore.getState().setOverride(displayOrderId, true);
          } else {
            setScReduced(false);
            useServiceChargeOverrideStore.getState().setOverride(displayOrderId, false);
          }
        })
        .catch(() => {});

      fetch(`${API_URL}/api/orders/${displayOrderId}/takeaway-charge`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
        .then((r) => r.json())
        .then((d) => {
          if (d?.takeawayChargeOverride === 1) {
            setTakeawayChargeApplied(false);
          } else {
            setTakeawayChargeApplied(true);
          }
          setTakeawayChargeAmt(d?.takeawayCharge || 0);
        })
        .catch(() => {});
    }
  }, [displayOrderId, isFocused, context]);

  // Synchronize activeSplitItems dynamically based on current cart and splitPartsCount
  useEffect(() => {
    if (isFocused && context && cart && cart.length > 0) {
      const { splitPartsCount, setActiveSplitItems } = useCartStore.getState();
      if (splitPartsCount && splitPartsCount > 1) {
        const nextSplit = cart.map((item: any) => ({
          ...item,
          qty: Math.round((item.qty / splitPartsCount) * 1000) / 1000,
        }));
        setActiveSplitItems(nextSplit);
      } else {
        setActiveSplitItems(null);
      }
    }
  }, [cart, isFocused, context]);

  useEffect(() => {

    // 2. If activeOrder is missing, try fetching from kitchen ONCE
    if (!activeOrder && !hasAttemptedInitialFetch) {
      console.log(
        "🔍 [Summary] Active order missing, fetching from kitchen (initial attempt)...",
      );
      setHasAttemptedInitialFetch(true);
      useActiveOrdersStore.getState().fetchActiveKitchenOrders();
    }

    // 3. Fetch servers
    fetchServers();

    // 4. Fetch all dishes for split search
    fetch(`${API_URL}/api/menu/dishes/all`)
      .then((res) => res.json())
      .then((data) => setAllDishes(Array.isArray(data) ? data : []))
      .catch((err) => console.error("Error fetching all dishes:", err));
  }, [activeOrder]);

   const user = useAuthStore((s: any) => s.user);
   const permissions = useAuthStore((s: any) => s.permissions);
   const isWaiter = useAuthStore((s: any) => s.isWaiter);

  const fetchServers = async () => {
    try {
      setLoadingServers(true);
      const res = await fetch(`${API_URL}/api/servers`);
      const data = await res.json();
      setServers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error fetching servers:", err);
    } finally {
      setLoadingServers(false);
    }
  };

  const discountInfo = useCartStore((s: any) => {
    const id = s.currentContextId;
    return id ? s.discounts[id] : null;
  });



  const applyDiscount = useCartStore((s: any) => s.applyDiscount);
  const clearCart = useCartStore((s: any) => s.clearCart);
  const updateOrderDiscount = useActiveOrdersStore(
    (s: any) => s.updateOrderDiscount,
  );
  const closeActiveOrder = useActiveOrdersStore((s: any) => s.closeActiveOrder);
  const activeOrders = useActiveOrdersStore((s: any) => s.activeOrders);
  
  const [activeSessions, setActiveSessions] = useState<any[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  const fetchActiveSessions = async () => {
    try {
      setIsLoadingSessions(true);
      const token = useAuthStore.getState().token;
      const res = await fetch(`${API_URL}/api/orders/active-sessions`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const result = await res.json();
        const sessions = result.orders || (Array.isArray(result) ? result : []);
        setActiveSessions(sessions);
      }
    } catch (err) {
      console.error("Failed to fetch active sessions:", err);
    } finally {
      setIsLoadingSessions(false);
    }
  };

  const selectedTablesText = useMemo(() => {
    return selectedMergeOrderIds
      .map((id) => {
        const order = activeSessions.find((o: any) => o.orderId === id);
        return order ? `Table ${order.context?.tableNo}` : "";
      })
      .filter(Boolean)
      .join(", ");
  }, [selectedMergeOrderIds, activeSessions]);

  const toggleMergeSelection = (orderId: string) => {
    setSelectedMergeOrderIds((prev) =>
      prev.includes(orderId)
        ? prev.filter((id) => id !== orderId)
        : [...prev, orderId]
    );
  };

  const performMerge = async () => {
    if (isMerging || selectedMergeOrderIds.length === 0) return; // Guard against double-click
    setIsMerging(true);
    try {
      if (!context?.tableId) {
        showToast({ type: "error", message: "Merge is only available for active Dine-In tables" });
        return;
      }

      // Retrieve source table details for all selected order IDs
      const sourceOrders = selectedMergeOrderIds
        .map((id) => {
          const order = activeSessions.find((o: any) => o.orderId === id);
          if (!order || !order.context?.tableId) return null;
          return {
            tableId: order.context.tableId,
            orderNumber: id, // id is the OrderNumber string from active-kitchen
            tableNo: order.context.tableNo,
            section: order.context.section,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      if (sourceOrders.length === 0) {
        showToast({ type: "error", message: "No valid source tables selected" });
        return;
      }

      const sourceTables = sourceOrders.map((s) => ({ tableId: s.tableId, tableNo: s.tableNo, section: s.section }));
      const sourceTableIds = sourceOrders.map((s) => s.tableId);

      const res = await fetch(`${API_URL}/api/orders/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetTableId: context.tableId,
          sourceTableIds: sourceTableIds,
          sourceOrders: sourceOrders, // Pass order numbers for reliable GUID lookup
          userId: user?.id,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Merge failed");
      }

      // 🚀 INSTANT SYNC AND CLEAR FOR ALL SOURCE TABLES
      for (const table of sourceTables) {
        useCartStore.getState().clearTableSession(table.tableId, table.section, table.tableNo);
        useTableStatusStore.getState().updateTableStatus(
          table.tableId,
          table.section,
          table.tableNo,
          "EMPTY",
          "EMPTY",
          0,
          undefined,
          0
        );

        // Also close in activeOrdersStore
        const matchingOrder = activeSessions.find(
          (o: any) =>
            o.context?.orderType === "DINE_IN" &&
            String(o.context.section || "").trim().toLowerCase() === String(table.section || "").trim().toLowerCase() &&
            String(o.context.tableNo || "").trim().toLowerCase() === String(table.tableNo || "").trim().toLowerCase()
        );
        if (matchingOrder?.orderId) {
          useActiveOrdersStore.getState().closeActiveOrder(matchingOrder.orderId);
        }
      }

      await useCartStore.getState().fetchCartFromDB(context.tableId);
      await useActiveOrdersStore.getState().fetchActiveKitchenOrders();

      showToast({ type: "success", message: "Orders Merged Successfully" });
      setSelectedMergeOrderIds([]);
      setConfirmMergeVisible(false);
      setShowMergeModal(false);
    } catch (err: any) {
      console.error("Merge failed:", err);
      showToast({ type: "error", message: err.message || "Merge Failed" });
    } finally {
      setIsMerging(false);
    }
  };

  const updateTableStatus = useTableStatusStore(
    (s: any) => s.updateTableStatus,
  );

  const handleFOC = () => {
    const discountData = {
      applied: true,
      type: "percentage" as const,
      value: 100,
    };
    applyDiscount(discountData);

    const currentContext = getOrderContext();
    if (currentContext) {
      updateOrderDiscount(currentContext, discountData);
    }
  };

  const handlePromoCode = async (code: string) => {
    if (!code || code.trim() === "") {
      showToast({ type: "warning", message: "Enter Promo Code" });
      return;
    }
    try {
      setIsApplyingPromo(true);
      const token = useAuthStore.getState().token;
      const res = await fetch(`${API_URL}/api/members/promocode/${encodeURIComponent(code.trim())}`, {
        headers: {
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        }
      });
      if (!res.ok) {
        let errMsg = "Invalid Promo Code";
        try {
          const errorData = await res.json();
          errMsg = errorData.error || errMsg;
        } catch (_) {}
        showToast({ type: "error", message: errMsg });
        return;
      }
      const data = await res.json();
      const promoAmount = parseFloat(data.Promoamount) || 0;
      if (promoAmount <= 0) {
        showToast({ type: "warning", message: "No value", subtitle: "Promo code has 0 amount" });
        return;
      }

      const discountData = {
        applied: true,
        type: "fixed" as const,
        value: promoAmount,
        label: `Promo: ${code.trim()}`,
      };
      applyDiscount(discountData);

      const currentContext = getOrderContext();
      if (currentContext) {
        updateOrderDiscount(currentContext, discountData);
      }
      showToast({ type: "success", message: "Promo Code Applied", subtitle: `Discount of ${currencySymbol}${promoAmount.toFixed(2)} applied` });
      setShowPromoModal(false);
      setPromoCodeInput("");
    } catch (err: any) {
      console.error("Error applying promo code:", err);
      showToast({ type: "error", message: "Failed to apply promo code" });
    } finally {
      setIsApplyingPromo(false);
    }
  };

  const fetchAvailablePromos = async () => {
    try {
      setLoadingPromos(true);
      const token = useAuthStore.getState().token;
      const res = await fetch(`${API_URL}/api/members/promocodes/all`, {
        headers: {
          ...(token ? { "Authorization": `Bearer ${token}` } : {})
        }
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setAvailablePromos(data);
      }
    } catch (err) {
      console.error("Error fetching available promos:", err);
    } finally {
      setLoadingPromos(false);
    }
  };

  useEffect(() => {
    if (showPromoModal) {
      fetchAvailablePromos();
    }
  }, [showPromoModal]);

  const filteredPromos = useMemo(() => {
    const query = promoCodeInput.trim().toLowerCase();
    if (!query) return availablePromos;
    return availablePromos.filter(p => 
      (p.Promocode || "").toLowerCase().includes(query) ||
      (p.Name || "").toLowerCase().includes(query)
    );
  }, [availablePromos, promoCodeInput]);

  const { width: SCREEN_W, height: SCREEN_H } = useWindowDimensions();
  const isLandscape = SCREEN_W > SCREEN_H;
  const isTablet = Math.min(SCREEN_W, SCREEN_H) >= 500;
  const isPhone = !isTablet;

  const fetchCancelReasons = async () => {
    try {
      setLoadingReasons(true);
      const res = await fetch(`${API_URL}/api/admin/cancel-reasons`);
      const data = await res.json();
      setCancelReasons(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error fetching cancel reasons:", err);
      showToast({
        type: "error",
        message: "Failed to load cancellation reasons",
      });
    } finally {
      setLoadingReasons(false);
    }
  };

  const handleCancelOrder = async (reason: string, password: string) => {
    // Securely verify password with backend - checks for Void or Admin password
    const verifyRes = await fetch(`${API_URL}/api/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password: password,
        role: "Void,ADMIN",
      }),
    });
    const verifyData = await verifyRes.json();

    if (!verifyData.success) {
      showToast({
        type: "error",
        message: "Incorrect Password",
        subtitle: "Void or Admin password required to cancel order",
      });
      return;
    }

    setIsCancellingOrder(true);
    console.log("🌐 [Summary] API URL:", API_URL);
    const cancelEndpoint = `${API_URL}/api/orders/cancel`;
    console.log("🚀 [Summary] Cancel endpoint:", cancelEndpoint);

    try {
      // 🚀 Call Backend to Cancel Order properly in DB
      const cancelRes = await fetch(cancelEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: displayOrderId,
          tableId: context?.tableId,
          reason: reason,
          userId: user?.userId || "SYSTEM",
          userName: user?.userName || "User",
        }),
      });

      // 🛑 Step 8: Robust Error Handling (Check if response is actually JSON)
      const contentType = cancelRes.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const errorText = await cancelRes.text();
        console.error("❌ [Summary] Server returned non-JSON response:", errorText.substring(0, 200));
        throw new Error(`Server Error: Received ${cancelRes.status} ${cancelRes.statusText}`);
      }

      const cancelData = await cancelRes.json();
      if (!cancelData.success) {
        throw new Error(cancelData.error || "Failed to cancel order in backend");
      }

      showToast({
        type: "success",
        message: "Order Cancelled Successfully",
        subtitle: `Reason: ${reason}`,
      });

      setShowCancelModal(false);
      setSelectedCancelReason(null);
      setCustomCancelReason("");
      setCancelPassword("");

      // 🐛 FIX: Capture section BEFORE clearing context so we can navigate back to correct tab
      const cancelTargetSection = context?.section || (context?.orderType === "TAKEAWAY" ? "TAKEAWAY" : "SECTION_1");
      setTimeout(() => {
        // Local State cleanup
        if (context && activeOrder) {
          closeActiveOrder(activeOrder.orderId);
          // Clear both unsent and sent items locally for this context
          if (context.tableId) {
            useCartStore.getState().setCartItems(context.tableId, [], true);
          }
          clearCart(); // This clears unsent items for the current context
          useOrderContextStore.getState().clearOrderContext(); // Clear context
          
          if (
            context.orderType === "DINE_IN" &&
            context.section &&
            context.tableNo
          ) {
            updateTableStatus(
              context.tableId || "",
              context.section,
              context.tableNo,
              "",
              "EMPTY",
            );
          }
        }
        router.replace({ pathname: "/(tabs)/category", params: { section: cancelTargetSection } });
      }, 500);
    } catch (error: any) {
      console.error("Cancel error:", error);
      showToast({ 
        type: "error", 
        message: "Error cancelling order",
        subtitle: error.message
      });
    } finally {
      setIsCancellingOrder(false);
    }
  };

  const handleVoidItem = (item: any) => {
    setItemToVoid(item);
    setShowVoidModal(true);
  };

  const handleItemClick = (item: any) => {
    if (item.status === "VOIDED" || item.isVoided) return;
    if (Platform.OS === 'web') {
      const confirmFoc = window.confirm(item.isFoc ? `Remove FOC (Free of Cost) status for ${item.name}?` : `Mark ${item.name} as FOC (Free of Cost)?`);
      if (confirmFoc) {
        const nextFoc = !item.isFoc;
        useCartStore.getState().updateCartItemFull(item.lineItemId, { isFoc: nextFoc });
        showToast({
          type: "success",
          message: nextFoc ? "Item Marked FOC" : "FOC Removed",
          subtitle: nextFoc ? `${item.name} is now FOC` : `${item.name} is no longer FOC`
        });
      }
      return;
    }
    Alert.alert(
      item.name,
      item.isFoc ? "Remove FOC (Free of Cost) status?" : "Mark this item as FOC (Free of Cost)?",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: item.isFoc ? "Remove FOC" : "Mark FOC", 
          onPress: () => {
            const nextFoc = !item.isFoc;
            useCartStore.getState().updateCartItemFull(item.lineItemId, { isFoc: nextFoc });
            showToast({
              type: "success",
              message: nextFoc ? "Item Marked FOC" : "FOC Removed",
              subtitle: nextFoc ? `${item.name} is now FOC` : `${item.name} is no longer FOC`
            });
          } 
        }
      ]
    );
  };

  const handleSplitBill = () => {
    // Reset split quantities to 0 for all items in cart
    const initialSplit: Record<string, number> = {};
    cart.forEach((item: any) => {
      initialSplit[item.lineItemId] = 0;
    });
    setSplitQuantities(initialSplit);
    setExtraSplitItems([]);
    setSearchDishText("");
    setSplitType("items");
    setPartCount(2);
    setShowSplitModal(true);
    setShowBillOptions(false);
  };

  const handleMergeBill = () => {
    fetchActiveSessions();
    setSelectedMergeOrderIds([]);
    setShowMergeModal(true);
    setShowBillOptions(false);
  };


  const handleReprintKOT = async () => {
    if (!cart.length) return;

    try {
      const activeItems = cart.filter((i: any) => i.status !== "VOIDED");
      const orderContext = {
        orderType: context?.orderType,
        tableNo: context?.tableNo,
        takeawayNo: context?.takeawayNo,
        section: context?.section,
      };

      await UniversalPrinter.routeAndPrintOrderKOT(
        displayOrderId,
        orderContext,
        activeItems,
        false,
        context?.serverName || "Staff",
        true,
        true
      );

      showToast({
        type: "success",
        message: "KOT Reprinted",
        subtitle: "Tickets sent to kitchen",
      });
      setShowBillOptions(false);
    } catch (err) {
      console.error("Reprint KOT error:", err);
      showToast({ type: "error", message: "Reprint Failed" });
    }
  };

  const handlePrintCheckoutBill = async () => {
    if (!cart.length) return;
    
    try {
      const fullDiscountInfo = discountInfo?.applied ? {
        ...discountInfo,
        amount: discountInfo.amount || discountAmount,
      } : undefined;

      const saleData = {
        items: cart,
        total: grandTotal,
        subtotal: subtotal,
        discount: fullDiscountInfo,
        discountAmount: discountAmount,
        discountType: discountInfo?.type,
        discountValue: discountInfo?.value,
        orderId: displayOrderId,
        tableNo: context?.tableNo,
        waiterName: context?.serverName,
        date: new Date(),
        isCheckout: true,
        serviceCharge: serviceChargeAmount,
        takeawayCharge: currentTakeawayCharge,
        mobileNo: rewardMember?.Phone || "",
        memberRewardBalance: String(rewardMember?.RewardCredit || 0),
      };

      await UniversalPrinter.printCheckoutBill(
        saleData,
        user?.userId || "SYSTEM",
        fullDiscountInfo,
      );

      showToast({
        type: "success",
        message: "Bill Printing",
        subtitle: "Receipt sent to printer",
      });
      setShowBillOptions(false);
    } catch (err) {
      console.error("Print Bill error:", err);
      showToast({ type: "error", message: "Printing Failed" });
    }
  };

  const handlePrintSplitPartsBills = async () => {
    if (!cart.length) return;
    try {
      const partAmount = Math.round((grandTotal / partCount) * 100) / 100;
      const partSubtotal = Math.round((subtotal / partCount) * 100) / 100;
      const partServiceCharge = Math.round((serviceChargeAmount / partCount) * 100) / 100;
      const partTakeawayCharge = Math.round((currentTakeawayCharge / partCount) * 100) / 100;
      const partDiscountAmount = discountAmount ? Math.round((discountAmount / partCount) * 100) / 100 : 0;

      for (let i = 1; i <= partCount; i++) {
        const saleData = {
          items: cart.map((item: any) => {
            const rawPrice = item.price || item.Price || 0;
            const splitPrice = Math.round((rawPrice / partCount) * 100) / 100;
            return {
              ...item,
              qty: item.qty || item.quantity || 1,
              price: splitPrice,
              Price: splitPrice,
              basePrice: item.basePrice ? Math.round((item.basePrice / partCount) * 100) / 100 : undefined,
            };
          }),
          total: partAmount,
          subtotal: partSubtotal,
          discount: discountInfo ? {
            ...discountInfo,
            amount: partDiscountAmount,
          } : undefined,
          orderId: `${displayOrderId}-Part ${i}/${partCount}`,
          tableNo: context?.tableNo,
          waiterName: context?.serverName,
          date: new Date(),
          isCheckout: true,
          serviceCharge: partServiceCharge,
          takeawayCharge: partTakeawayCharge,
          mobileNo: rewardMember?.Phone || "",
          memberRewardBalance: String(rewardMember?.RewardCredit || 0),
        };

        UniversalPrinter.printCheckoutBill(
          saleData,
          user?.userId || "SYSTEM",
          discountInfo ? {
            ...discountInfo,
            amount: partDiscountAmount,
          } : undefined,
        ).catch((e) => console.error(`Split part ${i} print error:`, e));
      }

      showToast({
        type: "success",
        message: "Split Bills Printing",
        subtitle: `Sent ${partCount} bills to printer`,
      });
      setShowSplitModal(false);
    } catch (err) {
      console.error("Print Split Bills error:", err);
      showToast({ type: "error", message: "Printing Failed" });
    }
  };

  // ── Reduce/Restore Service Charge Handler ──────────────────────────────────
  const handleReduceServiceCharge = async () => {
    if (!displayOrderId) {
      showToast({ type: "error", message: "Order ID not found" });
      return;
    }
    const shouldReduce = !scReduced;
    try {
      setIsReducingSC(true);
      const token = useAuthStore.getState().token;
      const res = await fetch(`${API_URL}/api/orders/reduce-service-charge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ orderId: displayOrderId, reduce: shouldReduce }),
      });
      const data = await res.json();
      if (data.success) {
        setScReduced(shouldReduce);
        useServiceChargeOverrideStore.getState().setOverride(displayOrderId, shouldReduce);
        setShowBillOptions(false);
        showToast({
          type: "success",
          message: shouldReduce ? "Service Charge Removed" : "Service Charge Restored",
          subtitle: shouldReduce 
            ? "Bill updated — service charge set to 0.00" 
            : "Bill updated — service charge restored to normal",
        });
      } else {
        showToast({ type: "error", message: data.error || "Failed to update service charge" });
      }
    } catch (err) {
      console.error("SC toggle error:", err);
      showToast({ type: "error", message: "Network error" });
    } finally {
      setIsReducingSC(false);
    }
  };
  // ── Apply/Remove Takeaway Charge Handler ──────────────────────────────────
  const handleToggleTakeawayCharge = async () => {
    if (!displayOrderId) {
      showToast({ type: "error", message: "Order ID not found" });
      return;
    }
    const shouldApply = !takeawayChargeApplied;
    try {
      setIsApplyingTakeaway(true);
      const token = useAuthStore.getState().token;
      const res = await fetch(`${API_URL}/api/orders/apply-takeaway-charge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ orderId: displayOrderId, apply: shouldApply }),
      });
      const data = await res.json();
      if (data.success) {
        setTakeawayChargeApplied(shouldApply);
        setTakeawayChargeAmt(data.takeawayCharge);
        setShowBillOptions(false);
        showToast({
          type: "success",
          message: shouldApply ? "Takeaway Charge Added" : "Takeaway Charge Removed",
          subtitle: shouldApply 
            ? `Bill updated — added takeaway charge of ${currencySymbol}${data.takeawayCharge.toFixed(2)}`
            : "Bill updated — takeaway charge removed",
        });
      } else {
        showToast({ type: "error", message: data.error || "Failed to update takeaway charge" });
      }
    } catch (err) {
      console.error("Takeaway toggle error:", err);
      showToast({ type: "error", message: "Network error" });
    } finally {
      setIsApplyingTakeaway(false);
    }
  };

  const [loyaltyDiscountItems, setLoyaltyDiscountItems] = useState<any[]>([]);
  const [loyaltyDiscountAmount, setLoyaltyDiscountAmount] = useState(0);
  const [appliedDishRewards, setAppliedDishRewards] = useState<any[]>([]);

  useEffect(() => {
    const fetchDishLoyaltyRewards = async () => {
      const phone = loyaltyPhone ? `${selectedCountry.code} ${loyaltyPhone.trim()}` : "";
      const activeCart = cart.filter((i: any) => i.status !== "VOIDED" && i.isVoided !== true && i.StatusCode !== 0 && i.statusCode !== 0);
      if (!phone || activeCart.length === 0) {
        setLoyaltyDiscountItems([]);
        setLoyaltyDiscountAmount(0);
        setAppliedDishRewards([]);
        return;
      }
      try {
        const token = useAuthStore.getState().token;
        const mappedItems = activeCart.map((i: any) => ({
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
            const originalCartItem = activeCart.find((raw: any) => String(raw.id || raw.DishId || raw.dishId).toLowerCase() === String(i.DishId || i.id).toLowerCase()) || {};
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
          setAppliedDishRewards(data.appliedRewards || []);
        } else {
          setLoyaltyDiscountItems([]);
          setLoyaltyDiscountAmount(0);
          setAppliedDishRewards([]);
        }
      } catch (err) {
        console.error("Calculate dish loyalty rewards error in summary:", err);
        setLoyaltyDiscountItems([]);
        setLoyaltyDiscountAmount(0);
        setAppliedDishRewards([]);
      }
    };

    fetchDishLoyaltyRewards();
  }, [loyaltyPhone, selectedCountry, cart]);

  const finalItems = useMemo(() => {
    const rawItems = loyaltyDiscountItems.length > 0 ? loyaltyDiscountItems : cart;
    return rawItems.filter((i: any) => i.status !== "VOIDED" && i.isVoided !== true && i.StatusCode !== 0 && i.statusCode !== 0);
  }, [loyaltyDiscountItems, cart]);





  const totalItems = useMemo(
    () =>
      finalItems.reduce((sum: number, item: any) => {
        const isVoided = "status" in item && (item as any).status === "VOIDED";
        if (isVoided) return sum;
        return sum + item.qty;
      }, 0),
    [finalItems],
  );

  const takeawayCharges = settings.takeawayCharges || 0;

  const { grossTotal, totalItemDiscount, totalFocAmount, scEligibleSubtotal, twScEligibleSubtotal, calcTakeawayChargeAmt, takeawayQty, hasMixedTWCharges, singleTWRate } = useMemo(() => {
    let firstRate: number | null = null;
    let mixed = false;

    const reduced = finalItems.reduce((acc: any, item: any) => {
      const isVoided = (item as any).status === "VOIDED";
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
      const itemFocAmount = item.isFoc ? itemSubtotal : 0;
      const isTakeawayItem = isTakeawayOrder || Boolean(item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway || (item as any).isTakeaway === true || (item as any).IsTakeaway === true || String((item as any).isTakeaway) === "1" || String((item as any).IsTakeaway) === "1" || String((item as any).isTakeAway) === "1" || String((item as any).IsTakeAway) === "1");
      const isSC = !isTakeawayItem && (Number(item.isServiceCharge) === 1 || item.isServiceCharge === true || Number(item.IsServiceCharge) === 1 || item.IsServiceCharge === true);
      
      let itemTWCharge = 0;
      if (isTakeawayItem) {
        const dishSpecificTW = Number(item.takeawayCharge ?? item.TakeawayCharge ?? 0);
        const effectiveTWRate = dishSpecificTW > 0 ? dishSpecificTW : takeawayCharges;
        itemTWCharge = item.qty * effectiveTWRate;

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
        scEligibleSubtotal: acc.scEligibleSubtotal + (isSC && !item.isFoc ? itemSubtotal : 0),
        twScEligibleSubtotal: acc.twScEligibleSubtotal + (isTakeawayItem && !item.isFoc ? itemSubtotal : 0),
        calcTakeawayChargeAmt: acc.calcTakeawayChargeAmt + (isTakeawayItem && !item.isFoc ? itemTWCharge : 0),
        takeawayQty: acc.takeawayQty + (isTakeawayItem && !item.isFoc ? item.qty : 0),
      };
    }, { grossTotal: 0, totalItemDiscount: 0, totalFocAmount: 0, scEligibleSubtotal: 0, twScEligibleSubtotal: 0, calcTakeawayChargeAmt: 0, takeawayQty: 0 });

    return {
      ...reduced,
      hasMixedTWCharges: mixed,
      singleTWRate: firstRate !== null ? firstRate : takeawayCharges
    };
  }, [finalItems, takeawayCharges]);

  const subtotal = useMemo(() => grossTotal - totalItemDiscount, [grossTotal, totalItemDiscount]);
  const allItemsHaveSC = useMemo(() => {
    const activeItems = finalItems.filter((i: any) => i.status !== "VOIDED" && i.statusCode !== 0);
    return activeItems.length > 0 && activeItems.every((item: any) => {
      const isTakeawayItem = item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway || (item as any).isTakeaway === true || (item as any).IsTakeaway === true || String((item as any).isTakeaway) === "1" || String((item as any).IsTakeaway) === "1";
      return !isTakeawayItem;
    });
  }, [finalItems]);

  const discountAmount = useMemo(() => {
    if (!discountInfo?.applied) return 0;
    if (discountInfo.type === "percentage")
      return Math.min((subtotal * discountInfo.value) / 100, subtotal);
    return Math.min(discountInfo.value, subtotal);
  }, [discountInfo, subtotal]);

  const netAfterDiscount = useMemo(() => Math.max(0, subtotal - discountAmount - totalFocAmount), [subtotal, discountAmount, totalFocAmount]);

  // Pro-rate the bill-level discount to service-charge-eligible items
  const scEligibleNet = useMemo(() => {
    const payableSubtotal = Math.max(0, subtotal - totalFocAmount);
    if (payableSubtotal <= 0) return 0;
    const proportion = scEligibleSubtotal / payableSubtotal;
    return Math.max(0, scEligibleSubtotal - proportion * discountAmount);
  }, [scEligibleSubtotal, subtotal, totalFocAmount, discountAmount]);

  const twScEligibleNet = useMemo(() => {
    const payableSubtotal = Math.max(0, subtotal - totalFocAmount);
    if (payableSubtotal <= 0) return 0;
    const proportion = twScEligibleSubtotal / payableSubtotal;
    return Math.max(0, twScEligibleSubtotal - proportion * discountAmount);
  }, [twScEligibleSubtotal, subtotal, totalFocAmount, discountAmount]);

  const billDiscountProportion = useMemo(() => {
    if (!discountInfo?.applied) return 0;
    if (discountInfo.type === "percentage") {
      return discountInfo.value / 100;
    }
    const payableSubtotal = Math.max(0, subtotal - totalFocAmount);
    return payableSubtotal > 0 ? (discountAmount / payableSubtotal) : 0;
  }, [discountInfo, subtotal, totalFocAmount, discountAmount]);

  const currentTakeawayCharge = useMemo(() => {
    if (!takeawayChargeApplied) return 0;
    return calcTakeawayChargeAmt * (1 - billDiscountProportion);
  }, [takeawayChargeApplied, calcTakeawayChargeAmt, billDiscountProportion]);

  const dineInServiceChargeAmt = useMemo(
    () => (scReduced ? 0 : scEligibleNet * scRate),
    [scReduced, scEligibleNet, scRate],
  );
  const twServiceChargeAmt = useMemo(
    () => (scReduced ? 0 : twScEligibleNet * twScRate),
    [scReduced, twScEligibleNet, twScRate],
  );
  const serviceChargeAmount = useMemo(
    () => dineInServiceChargeAmt + twServiceChargeAmt,
    [dineInServiceChargeAmt, twServiceChargeAmt],
  );
  const taxableAmount = useMemo(() => netAfterDiscount + serviceChargeAmount + currentTakeawayCharge, [netAfterDiscount, serviceChargeAmount, currentTakeawayCharge]);
  const gstAmountRaw = useMemo(() => taxableAmount * gstRate, [taxableAmount, gstRate]);

  // 🖥️ CUSTOMER DISPLAY REAL-TIME SYNC
  useEffect(() => {
    if (context && finalItems && finalItems.length > 0) {
      console.log("🖥️ [Summary] Syncing finalItems to Customer Display:", finalItems.length);
      CustomerDisplaySync.syncCart({
        orderContext: context,
        cart: finalItems,
        discountInfo: discountInfo,
        gstPercentage: settings.gstPercentage || 0,
        roundOff: 0,
        active: true,
        takeawayCharge: currentTakeawayCharge,
      });
    } else {
      console.log("🖥️ [Summary] finalItems empty or null, syncing idle");
      CustomerDisplaySync.syncIdle();
    }
  }, [context, finalItems, discountInfo, settings, currentTakeawayCharge]);

  // 🖥️ CUSTOMER DISPLAY LIFE CYCLE MANAGER
  useEffect(() => {
    CustomerDisplaySync.isPaymentActive = true;
    return () => {
      CustomerDisplaySync.isPaymentActive = false;
      console.log("🖥️ [Summary] Unmounting screen, resetting Customer Display to idle");
      CustomerDisplaySync.syncIdle();
    };
  }, []);
  // ✅ FIX: Round GST for display so breakdown matches the rounded grand total
  const gstAmount = useMemo(() => Math.round(gstAmountRaw * 100) / 100, [gstAmountRaw]);
  const grandTotal = useMemo(() => Math.round((taxableAmount + gstAmountRaw) * 100) / 100, [taxableAmount, gstAmountRaw]);
  const displaySubtotal = subtotal;

  if (!context) return null;

  if (!activeOrder && orderLoadTimeout) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: Theme.bgMain,
        }}
      >
        <ActivityIndicator color={Theme.primary} />
        <Text style={{ color: Theme.textSecondary, marginTop: 10 }}>
          Loading order...
        </Text>
      </View>
    );
  }

  const headerActions = (
    <>
      {showLoyalty && (
        <TouchableOpacity
          style={[
            styles.actionBtn,
            {
              backgroundColor: Theme.successBg || "#dcfce7",
              borderColor: Theme.successBorder || "#bbf7d0",
              borderWidth: 1,
            },
            !isTablet &&
              isLandscape && { height: 32, paddingHorizontal: 8 },
          ]}
          onPress={() => setShowLoyaltyModal(true)}
        >
          <Ionicons
            name="ribbon-outline"
            size={!isTablet && isLandscape ? 16 : 18}
            color={Theme.success || "#16a34a"}
          />
          {isLandscape && (
            <Text
              style={[
                styles.actionBtnText,
                { color: Theme.success || "#16a34a" },
                !isTablet && isLandscape && { fontSize: 10 },
              ]}
            >
              Loyalty
            </Text>
          )}
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[
          styles.actionBtn,
          {
            backgroundColor: Theme.primaryLight,
            borderColor: Theme.primaryBorder,
            borderWidth: 1,
          },
          !isTablet &&
            isLandscape && { height: 32, paddingHorizontal: 8 },
        ]}
        onPress={() => setShowDiscountTypeModal(true)}
      >
        <Ionicons
          name="pricetag-outline"
          size={!isTablet && isLandscape ? 16 : 18}
          color={Theme.primary}
        />
        {isLandscape && (
          <Text
            style={[
              styles.actionBtnText,
              { color: Theme.primary },
              !isTablet && isLandscape && { fontSize: 10 },
            ]}
          >
            Discount
          </Text>
        )}
      </TouchableOpacity>

      {showRewardPoints && (
        <TouchableOpacity
          style={[
            styles.actionBtn,
            {
              backgroundColor: "#FFFBEB",
              borderColor: "#FEF3C7",
              borderWidth: 1,
            },
            !isTablet &&
              isLandscape && { height: 32, paddingHorizontal: 8 },
          ]}
          onPress={() => setShowRewardModal(true)}
        >
          <Ionicons
            name="star-outline"
            size={!isTablet && isLandscape ? 16 : 18}
            color="#D97706"
          />
          {isLandscape && (
            <Text
              style={[
                styles.actionBtnText,
                { color: "#D97706" },
                !isTablet && isLandscape && { fontSize: 10 },
              ]}
            >
              Reward Points
            </Text>
          )}
        </TouchableOpacity>
      )}

      {showPromoCode && (
        <TouchableOpacity
          style={[
            styles.actionBtn,
            {
              backgroundColor: "#F5F3FF",
              borderColor: "#DDD6FE",
              borderWidth: 1,
            },
            !isTablet &&
              isLandscape && { height: 32, paddingHorizontal: 8 },
          ]}
          onPress={() => setShowPromoModal(true)}
        >
          <Ionicons
            name="barcode-outline"
            size={!isTablet && isLandscape ? 16 : 18}
            color="#7C3AED"
          />
          {isLandscape && (
            <Text
              style={[
                styles.actionBtnText,
                { color: "#7C3AED" },
                !isTablet && isLandscape && { fontSize: 10 },
              ]}
            >
              Promo Code
            </Text>
          )}
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[
          styles.actionBtn,
          {
            backgroundColor: Theme.dangerBg,
            borderColor: Theme.dangerBorder,
            borderWidth: 1,
          },
          !isTablet &&
            isLandscape && { height: 32, paddingHorizontal: 8 },
        ]}
        onPress={() => {
          fetchCancelReasons();
          setShowCancelModal(true);
        }}
      >
        <Ionicons
          name="close-circle-outline"
          size={!isTablet && isLandscape ? 16 : 18}
          color={Theme.danger}
        />
        {isLandscape && (
          <Text
            style={[
              styles.actionBtnText,
              { color: Theme.danger },
              !isTablet && isLandscape && { fontSize: 10 },
            ]}
          >
            Cancel
          </Text>
        )}
      </TouchableOpacity>
    </>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Theme.bgNav} />
      <View style={styles.container}>
        {/* HEADER */}
        <View
          style={[
            styles.headerBar,
            isPhone && isLandscape && { height: 50, marginBottom: 5 },
            isPhone && !isLandscape && {
              flexDirection: "column",
              alignItems: "stretch",
              minHeight: undefined,
              gap: 2,
              paddingBottom: 4,
            },
          ]}
        >
          {isPhone && !isLandscape ? (
            // MOBILE PORTRAIT LAYOUT
            <>
              {/* Row 1: Back Button + Title + Home/Minimize */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Pressable
                    style={styles.iconBtn}
                    onPress={() => router.replace("/menu/thai_kitchen")}
                  >
                    <Ionicons name="arrow-back" size={24} color={Theme.textPrimary} />
                  </Pressable>
                  <Text style={styles.title}>Summary</Text>
                </View>

                {/* Actions Row */}
                <View style={{ marginRight: 6 }}>
                  <WindowControls buttonStyle={{ height: 38, width: 38, borderRadius: 8 }} iconSize={20} />
                </View>
              </View>

              {/* Row 2: Badges (Fixed Left) + Action Buttons (Scrollable Right) */}
              <View style={{ flexDirection: "row", alignItems: "center", paddingLeft: 0, paddingRight: 12, marginTop: 2, width: "100%" }}>
                {/* Fixed badges */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <View
                    style={[
                      styles.typeBadge,
                      {
                        backgroundColor:
                          context.orderType === "DINE_IN"
                            ? Theme.primaryLight
                            : Theme.warningBg,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.typeBadgeText,
                        {
                          color:
                            context.orderType === "DINE_IN"
                              ? Theme.primary
                              : Theme.warning,
                        },
                      ]}
                    >
                      {context.orderType === "DINE_IN" ? "DINE-IN" : "TAKEAWAY"}
                    </Text>
                  </View>
                  {context.orderType === "DINE_IN" && (
                    <View style={styles.tableBadge}>
                      <Text style={styles.tableBadgeText}>
                        {formatSection(context.section || "")} • T
                        {context.tableNo}
                      </Text>
                    </View>
                  )}
                  {effectiveCustomerName && effectiveCustomerName.toLowerCase() !== "guest" && (
                    <View style={[styles.tableBadge, { backgroundColor: "#FFF7ED", borderColor: "#F97316", borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 4 }]}>
                      <Ionicons name="person" size={12} color="#EA580C" />
                      <Text style={[styles.tableBadgeText, { color: "#EA580C", fontFamily: Fonts.bold }]}>
                        {effectiveCustomerName}
                      </Text>
                    </View>
                  )}
                </View>

                {/* Scrollable Action Buttons */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, alignItems: "center", paddingLeft: 8 }}
                  style={{ flex: 1 }}
                >
                  {headerActions}
                </ScrollView>
              </View>

              {/* Row 3: Order ID */}
              <View style={{ paddingLeft: 0, marginTop: 0 }}>
                <Text style={[styles.orderSub, { marginLeft: 0 }]}>
                  #{displayOrderId || "NEW"}
                </Text>
              </View>
            </>
          ) : (
            // TABLET / LANDSCAPE LAYOUT
            <>
              <View style={styles.headerLeft}>
                <Pressable
                  style={styles.iconBtn}
                  onPress={() => router.replace("/menu/thai_kitchen")}
                >
                  <Ionicons name="arrow-back" size={24} color={Theme.textPrimary} />
                </Pressable>

                <View style={styles.headerTitleContainer}>
                  <Text style={styles.title}>Summary</Text>
                  
                  {/* Badges line */}
                  <View style={[styles.orderBadgeRow, { flexWrap: "wrap", marginTop: 4 }]}>
                    <View
                      style={[
                        styles.typeBadge,
                        {
                          backgroundColor:
                            context.orderType === "DINE_IN"
                              ? Theme.primaryLight
                              : Theme.warningBg,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.typeBadgeText,
                          {
                            color:
                              context.orderType === "DINE_IN"
                                ? Theme.primary
                                : Theme.warning,
                          },
                        ]}
                      >
                        {context.orderType === "DINE_IN" ? "DINE-IN" : "TAKEAWAY"}
                      </Text>
                    </View>
                    {context.orderType === "DINE_IN" && (
                      <View style={styles.tableBadge}>
                        <Text style={styles.tableBadgeText}>
                          {formatSection(context.section || "")} • T
                          {context.tableNo}
                        </Text>
                      </View>
                    )}
                    {effectiveCustomerName && effectiveCustomerName.toLowerCase() !== "guest" && (
                      <View style={[styles.tableBadge, { backgroundColor: "#FFF7ED", borderColor: "#F97316", borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 4 }]}>
                        <Ionicons name="person" size={12} color="#EA580C" />
                        <Text style={[styles.tableBadgeText, { color: "#EA580C", fontFamily: Fonts.bold }]}>
                          {effectiveCustomerName}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Order ID line */}
                  <Text style={[styles.orderSub, { marginTop: 4, marginLeft: 8 }]}>
                    #{displayOrderId || "NEW"}
                  </Text>
                </View>
              </View>

              <View style={[styles.headerRight, { gap: 8 }]}>
                {headerActions}
                <WindowControls buttonStyle={{ height: 46, width: 46, borderRadius: 10, backgroundColor: Theme.bgCard, borderWidth: 1, borderColor: Theme.border, justifyContent: "center", alignItems: "center" }} iconSize={24} />
              </View>
            </>
          )}
        </View>

        {/* MAIN CONTENT AREA */}
        <View
          style={[
            styles.mainContent,
            isLandscape && styles.mainContentLandscape,
          ]}
        >
          {/* LIST */}
          <View
            style={[
              styles.listContainer,
              isLandscape && styles.listContainerLandscape,
            ]}
          >
            <FlatList
              data={finalItems}
              showsVerticalScrollIndicator={false}
              keyExtractor={(item, index) => `item-${index}-${item.lineItemId || item.id}`}
              contentContainerStyle={{ paddingBottom: 20 }}
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={5}
              removeClippedSubviews={true}
              renderItem={({ item }: { item: any }) => {
                const isTakeawayItem = item.isTakeaway || item.IsTakeaway || item.isTakeAway || item.IsTakeAway || (item as any).isTakeaway === true || (item as any).IsTakeaway === true || String((item as any).isTakeaway) === "1" || String((item as any).IsTakeaway) === "1";
                const isSC = !isTakeawayItem && (Number(item.isServiceCharge) === 1 || item.isServiceCharge === true) && useGeneralSettingsStore.getState().settings.SVCIdentification !== false;
                return (
                  <View
                    style={[
                      styles.row,
                      isSC && {
                        borderWidth: 1.5,
                        borderColor: Theme.dangerBorder,
                        borderLeftColor: Theme.danger,
                        backgroundColor: Theme.dangerBg,
                      }
                    ]}
                  >
                  <View style={styles.qtyBadge}>
                    <Text style={styles.qtyBadgeText}>{formatQty(item.qty)}</Text>
                  </View>
 
                  <View style={styles.rowContent}>
                    <Text
                      style={[
                        styles.name,
                        (item as any).status === "VOIDED" && styles.textVoided,
                      ]}
                      numberOfLines={2}
                    >
                      {item.name}
                      {isTakeawayItem && " (Takeaway 🛍️)"}
                      {item.isDishReward && " (Loyalty Reward 🎁)"}
                      {item.isFoc && " (FOC 🎁)"}
                      {(item as any).status === "VOIDED" && " (VOIDED)"}
                    </Text>
                    {(item.spicy && item.spicy !== "Medium") ||
                    (item.oil && item.oil !== "Normal") ||
                    (item.salt && item.salt !== "Normal") ||
                    (item.sugar && item.sugar !== "Normal") ||
                    item.note ? (
                      <Text style={styles.sub} numberOfLines={1}>
                        {[
                          item.spicy && item.spicy !== "Medium"
                            ? `🌶 ${item.spicy}`
                            : "",
                          item.oil && item.oil !== "Normal"
                            ? `Oil: ${item.oil}`
                            : "",
                          item.salt && item.salt !== "Normal"
                            ? `Salt: ${item.salt}`
                            : "",
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
                        <Text style={styles.sub} numberOfLines={1}>
                          {item.modifiers
                            .map((m: any) => `+ ${m.ModifierName}`)
                            .join("  ·  ")}
                        </Text>
                      )}
                     {item.isCombo && item.comboSelections && Array.isArray(item.comboSelections) &&
                      item.comboSelections
                        .filter((group: any) => group.items && group.items.length > 0)
                        .map((group: any, gIdx: number) => (
                          <View key={`g-${gIdx}`} style={{ marginTop: 2, paddingLeft: 2 }}>
                            <Text style={[styles.sub, { fontFamily: Fonts.bold, color: Theme.primary }]}>
                              {group.groupName}:
                            </Text>
                            {(group.items || []).map((opt: any, oIdx: number) => {
                              const effectiveAdd = (parseFloat(opt.surcharge || 0) + parseFloat(opt.dishPrice || 0));
                              return (
                                <Text key={`o-${oIdx}`} style={[styles.sub, { paddingLeft: 6 }]}>
                                  ↳ {opt.name}{effectiveAdd > 0 ? ` (+$${effectiveAdd.toFixed(2)})` : ""}
                                </Text>
                              );
                            })}
                          </View>
                        ))}
                    {isSC && settings.serviceChargePercentage > 0 && item.status !== "VOIDED" && (
                      <Text style={[styles.sub, { color: Theme.primary, fontFamily: Fonts.bold, marginTop: 4 }]}>
                        Item Service Charge ({settings.serviceChargePercentage}%): {currencySymbol}{(() => {
                          const isCombo = item.isCombo === true || String(item.isCombo) === "1" || item.isCombo === 1;
                          const discountBasis = isCombo ? (item.basePrice ?? item.price ?? 0) : (item.price ?? 0);
                          const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
                          const isFixed = item.discountType === 'fixed' || (item.discountType == null && item.discountAmount > 0 && !item.discount);
                          const itemDiscount = discAmt > 0
                            ? (isFixed ? (Math.min(discAmt, discountBasis) * item.qty) : ((discountBasis * (discAmt / 100)) * item.qty))
                            : 0;
                          return ((item.price || 0) * item.qty - itemDiscount) * (settings.serviceChargePercentage / 100);
                        })().toFixed(2)}
                      </Text>
                    )}
                    {!item.isFoc && item.status !== "VOIDED" && (() => {
                      const isCombo = item.isCombo === true || String(item.isCombo) === "1" || item.isCombo === 1;
                      const discountBasis = isCombo ? (item.basePrice ?? item.price ?? 0) : (item.price ?? 0);
                      const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
                      if (discAmt <= 0) return null;
                      const isFixed = item.discountType === 'fixed' || (item.discountType == null && item.discountAmount > 0 && !item.discount);
                      const savedAmt = isFixed
                        ? Math.min(discAmt, discountBasis) * item.qty
                        : (discountBasis * (discAmt / 100)) * item.qty;
                      return (
                        <Text style={[styles.sub, { color: Theme.danger, fontFamily: Fonts.bold, marginTop: 2 }]}>
                          Item Discount ({isFixed ? `${currencySymbol}${discAmt.toFixed(2)}` : `${discAmt}%`}): -{currencySymbol}{savedAmt.toFixed(2)}
                        </Text>
                      );
                    })()}
                  </View>

                  <View style={[styles.priceBlock, { alignItems: 'flex-end', justifyContent: 'center' }]}>
                    {(item.isFoc || (Number(item.discountAmount ?? item.discount ?? 0)) > 0) && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Text style={[styles.price, { fontSize: 13, textDecorationLine: "line-through", color: Theme.textMuted }]}>
                          {currencySymbol}{((item.price || 0) * item.qty).toFixed(2)}
                        </Text>
                        <View style={{ backgroundColor: item.isFoc ? '#dbeafe' : ((Theme as any).successBg || '#dcfce7'), paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 }}>
                          <Text style={{ color: item.isFoc ? '#2563eb' : (Theme.success || '#16a34a'), fontSize: 11, fontFamily: Fonts.bold }}>
                            {item.isFoc ? "FOC" : (() => {
                              const isCombo = item.isCombo === true || String(item.isCombo) === "1" || item.isCombo === 1;
                              const discountBasis = isCombo ? (item.basePrice ?? item.price ?? 0) : (item.price ?? 0);
                              const rawDiscAmt = Number(item.discountAmount ?? item.discount ?? 0);
                              const isFixed = item.discountType === 'fixed' || (item.discountType == null && item.discountAmount > 0 && !item.discount);
                              if (isFixed) {
                                const effectiveDisc = Math.min(rawDiscAmt, discountBasis);
                                return `-${currencySymbol}${effectiveDisc.toFixed(2)}`;
                              } else {
                                return `-${rawDiscAmt}%`;
                              }
                            })()}
                          </Text>
                        </View>
                      </View>
                    )}
                    <Text
                      style={[
                        styles.price,
                        (item as any).status === "VOIDED" && styles.textVoided,
                      ]}
                    >
                      {currencySymbol}
                      {item.isFoc ? "0.00" : (() => {
                        const isCombo = item.isCombo === true || String(item.isCombo) === "1" || item.isCombo === 1;
                        const discountBasis = isCombo ? (item.basePrice ?? item.price ?? 0) : (item.price ?? 0);
                        const discAmt = Number(item.discountAmount ?? item.discount ?? 0);
                        const isFixed = item.discountType === 'fixed' || (item.discountType == null && item.discountAmount > 0 && !item.discount);
                        const itemDiscount = discAmt > 0
                          ? (isFixed ? (Math.min(discAmt, discountBasis) * item.qty) : ((discountBasis * (discAmt / 100)) * item.qty))
                          : 0;
                        return ((item.price || 0) * item.qty - itemDiscount);
                      })().toFixed(2)}
                    </Text>
                  </View>

                  {item.status !== "VOIDED" && (
                    <TouchableOpacity
                      style={styles.itemTrashBtn}
                      onPress={() => handleVoidItem(item)}
                    >
                      <Ionicons name="trash-outline" size={18} color={Theme.danger} />
                    </TouchableOpacity>
                  )}
                </View>
                );
              }}
            />
          </View>

          {/* TOTALS RECEIPT CARD */}
          <View
            style={[
              styles.receiptContainer,
              isLandscape && styles.receiptContainerLandscape,
              isPhone && isLandscape && { width: 320 },
            ]}
          >
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={
                isLandscape && !isTablet && { paddingBottom: 20 }
              }
              style={isPhone && !isLandscape && { maxHeight: SCREEN_H * 0.45 }}
            >
              <View
                style={[
                  styles.receiptCard,
                  isLandscape && !isTablet && { padding: 16 },
                  isPhone && !isLandscape && { padding: 12, borderRadius: 16 },
                ]}
              >
                <View
                  style={[
                    styles.receiptHeader,
                    isLandscape && !isTablet && { marginBottom: 10 },
                    isPhone && !isLandscape && { marginBottom: 8 },
                  ]}
                >
                  <View
                    style={[
                      {
                        backgroundColor: Theme.primaryLight,
                        padding: 5,
                        borderRadius: 8,
                      },
                      isPhone && !isLandscape && { padding: 3 },
                    ]}
                  >
                    <Ionicons
                      name="receipt"
                      size={isPhone && !isLandscape ? 18 : 24}
                      color={Theme.primary}
                    />
                  </View>
                  <Text
                    style={[
                      styles.receiptHeaderText,
                      isPhone && !isLandscape && { fontSize: 14 },
                    ]}
                  >
                    Bill Summary
                  </Text>
                  <View style={styles.itemCountChip}>
                    <Text style={styles.itemCountChipText}>
                      {totalItems} items
                    </Text>
                  </View>
                </View>

                <View
                  style={[
                    styles.receiptDivider,
                    isLandscape && !isTablet && { marginBottom: 10 },
                    isPhone && !isLandscape && { marginBottom: 8 },
                  ]}
                />

                {loyaltyCustomer && (
                  <View style={{
                    backgroundColor: Theme.bgNav,
                    borderColor: Theme.border,
                    borderWidth: 1,
                    borderRadius: 10,
                    padding: 12,
                    marginBottom: 12,
                    gap: 4
                  }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <Ionicons name="ribbon" size={16} color={Theme.success || "#16a34a"} />
                      <Text style={{ fontSize: 13, fontFamily: Fonts.black, color: Theme.textPrimary }}>
                        Loyalty Member: {loyaltyCustomer.isNew ? "New Customer" : (loyaltyCustomer.Name || "Guest")}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 12, fontFamily: Fonts.bold, color: Theme.textSecondary, marginLeft: 22 }}>
                      Visit Progress: {loyaltyCustomer.isNew ? "New Enrollment" : `${loyaltyCustomer.VisitCount} (Lifetime: ${loyaltyCustomer.TotalVisits || 0})`}
                    </Text>
                    <Text style={{ fontSize: 12, fontFamily: Fonts.medium, color: Theme.textSecondary, marginLeft: 22 }}>
                      Reward Status: {loyaltyCustomer.isNew
                        ? "Enrolling on Checkout"
                        : (loyaltyCustomer.RewardPending === 1 || loyaltyCustomer.VisitCount === 9)
                          ? "Reward Available! 🎉"
                          : `Next Reward in ${9 - loyaltyCustomer.VisitCount} Visits`}
                    </Text>
                    {loyaltyDiscountAmount > 0 && (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6, padding: 8, backgroundColor: Theme.successBg || '#dcfce7', borderRadius: 8, marginLeft: 22 }}>
                        <MaterialCommunityIcons name="gift" size={14} color={Theme.success || "#16a34a"} />
                        <Text style={{ fontSize: 12, fontFamily: Fonts.bold, color: Theme.success || "#16a34a", flex: 1 }}>
                          Dish Loyalty Applied: Saved {currencySymbol}{loyaltyDiscountAmount.toFixed(2)} 🎉
                        </Text>
                      </View>
                    )}
                  </View>
                )}

                {/* 🏆 REWARD POINTS MEMBER DISPLAY */}
                {rewardMember && (() => {
                  const symbol = settings?.currencySymbol || "$";
                  const rewardCreditVal = parseFloat(rewardMember.RewardCredit) || 0;
                  return (
                    <View
                      style={{
                        backgroundColor: "#FFF7ED",
                        borderColor: "#F97316",
                        borderWidth: 1,
                        borderRadius: 10,
                        padding: 12,
                        marginBottom: 12,
                        gap: 4
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Ionicons name="gift" size={16} color="#F97316" />
                        <Text style={{ fontSize: 13, fontFamily: Fonts.black, color: Theme.textPrimary, flex: 1 }}>
                          Reward Member: {rewardMember.Name}
                        </Text>
                      </View>

                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginLeft: 22, marginVertical: 4 }}>
                        <TouchableOpacity
                          onPress={() => setShowRewardModal(true)}
                          style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "#FFEDD5" }}
                        >
                          <Text style={{ fontSize: 11, fontFamily: Fonts.bold, color: "#F97316" }}>Change</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => {
                            // If the current discount was applied as a reward discount, clear it too
                            if (discountInfo?.applied && discountInfo?.label?.startsWith("Reward:")) {
                              const cleared = { applied: false, type: "fixed" as const, value: 0, label: "" };
                              applyDiscount(cleared);
                              const ctx = getOrderContext();
                              if (ctx) updateOrderDiscount(ctx, cleared);
                            }
                            setRewardMember(null);
                          }}
                          style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: "#FEE2E2" }}
                        >
                          <Text style={{ fontSize: 11, fontFamily: Fonts.bold, color: "#DC2626" }}>Remove</Text>
                        </TouchableOpacity>
                      </View>

                      <Text style={{ fontSize: 12, fontFamily: Fonts.bold, color: Theme.textSecondary, marginLeft: 22 }}>
                        Phone: {rewardMember.Phone}
                      </Text>

                      <Text style={{ fontSize: 12, fontFamily: Fonts.bold, color: "#D97706", marginLeft: 22 }}>
                        Reward Balance: {currencySymbol}{rewardCreditVal.toFixed(2)}
                      </Text>

                      {rewardCreditVal > 0 && (
                        <TouchableOpacity
                          style={{
                            marginTop: 8,
                            marginLeft: 22,
                            backgroundColor: "#FFFBEB",
                            borderColor: "#FDE68A",
                            borderWidth: 1,
                            borderRadius: 8,
                            paddingVertical: 6,
                            paddingHorizontal: 12,
                            alignSelf: "flex-start",
                            flexDirection: "row",
                            alignItems: "center",
                            gap: 6
                          }}
                          onPress={() => {
                            const discountData = {
                              applied: true,
                              type: "fixed" as const,
                              value: rewardCreditVal,
                              label: `Reward: ${rewardMember.Name}`,
                            };
                            applyDiscount(discountData);
                            const currentContext = getOrderContext();
                            if (currentContext) {
                              updateOrderDiscount(currentContext, discountData);
                            }

                            // Update local rewardMember state to reflect zero credit immediately in UI
                            setRewardMember((prev: any) =>
                              prev ? { ...prev, RewardCredit: 0 } : prev
                            );

                            showToast({
                              type: "success",
                              message: "Reward Applied",
                              subtitle: `Redeemed ${currencySymbol}${rewardCreditVal.toFixed(2)} reward credit as discount`
                            });
                          }}
                        >
                          <Ionicons name="pricetag" size={14} color="#D97706" />
                          <Text style={{ fontFamily: Fonts.bold, fontSize: 12, color: "#D97706" }}>
                            Redeem Reward Discount
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })()}

                {/* 👤 CUSTOMER INFO DISPLAY (for guest / QR / non-member diners) */}
                {!loyaltyCustomer && !rewardMember && effectiveCustomerName && effectiveCustomerName.toLowerCase() !== "guest" && (
                  <View
                    style={{
                      backgroundColor: "#FFF7ED",
                      borderColor: "#FDBA74",
                      borderWidth: 1,
                      borderRadius: 10,
                      padding: 12,
                      marginBottom: 12,
                      gap: 4,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Ionicons name="person-circle" size={18} color="#EA580C" />
                      <Text style={{ fontSize: 13, fontFamily: Fonts.black, color: Theme.textPrimary, flex: 1 }}>
                        Customer: {effectiveCustomerName}
                      </Text>
                      <View style={{ backgroundColor: "#FFEDD5", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                        <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: "#EA580C" }}>QR Diner</Text>
                      </View>
                    </View>
                  </View>
                )}

                <View
                  style={[
                    styles.summaryRow,
                    ((isLandscape && !isTablet) ||
                      (isPhone && !isLandscape)) && { marginBottom: 6 },
                  ]}
                >
                  <Text
                    style={[
                      styles.summaryLabel,
                      isPhone && !isLandscape && { fontSize: 13 },
                    ]}
                  >
                    Subtotal
                  </Text>
                  <Text
                    style={[
                      styles.summaryValue,
                      isPhone && !isLandscape && { fontSize: 13 },
                    ]}
                  >
                    {currencySymbol}
                    {(totalItemDiscount > 0 ? grossTotal : subtotal).toFixed(2)}
                  </Text>
                </View>

                {totalItemDiscount > 0 && (
                  <View
                    style={[
                      styles.summaryRow,
                      ((isLandscape && !isTablet) ||
                        (isPhone && !isLandscape)) && { marginBottom: 6 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.summaryLabel,
                        { color: Theme.danger },
                        isPhone && !isLandscape && { fontSize: 13 },
                      ]}
                    >
                      Item Discounts
                    </Text>
                    <Text
                      style={[
                        styles.summaryValue,
                        { color: Theme.danger },
                        isPhone && !isLandscape && { fontSize: 13 },
                      ]}
                    >
                      -{currencySymbol}
                      {totalItemDiscount.toFixed(2)}
                    </Text>
                  </View>
                )}

                {discountAmount > 0 && (
                  <View
                    style={[
                      styles.summaryRow,
                      ((isLandscape && !isTablet) ||
                        (isPhone && !isLandscape)) && { marginBottom: 6 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.summaryLabel,
                        { color: Theme.danger },
                        isPhone && !isLandscape && { fontSize: 13 },
                      ]}
                    >
                      {discountInfo?.type === "percentage"
                        ? `Whole Bill Discount (${discountInfo.value}%)`
                        : discountInfo?.type === "fixed"
                        ? `Whole Bill Discount (-${currencySymbol}${discountInfo.value})`
                        : discountInfo?.label
                        ? `Whole Bill Discount (${discountInfo.label})`
                        : "Whole Bill Discount"}
                    </Text>
                    <Text
                      style={[
                        styles.summaryValue,
                        { color: Theme.danger },
                        isPhone && !isLandscape && { fontSize: 13 },
                      ]}
                    >
                      -{currencySymbol}
                      {discountAmount.toFixed(2)}
                    </Text>
                  </View>
                )}

                {(discountAmount > 0 || totalItemDiscount > 0) && (
                  <>
                    <View
                      style={[
                        styles.dashedDivider,
                        ((isLandscape && !isTablet) ||
                          (isPhone && !isLandscape)) && { marginVertical: 8 },
                      ]}
                    >
                      <View
                        style={[styles.dashLine, { borderColor: Theme.border }]}
                      />
                    </View>

                    <View
                      style={[
                        styles.summaryRow,
                        ((isLandscape && !isTablet) ||
                          (isPhone && !isLandscape)) && { marginBottom: 6 },
                      ]}
                    >
                      <Text
                        style={[
                          styles.summaryLabel,
                          isPhone && !isLandscape && { fontSize: 13 },
                        ]}
                      >
                        Net Amount
                      </Text>
                      <Text
                        style={[
                          styles.summaryValue,
                          isPhone && !isLandscape && { fontSize: 13 },
                        ]}
                      >
                        {currencySymbol}
                        {netAfterDiscount.toFixed(2)}
                      </Text>
                    </View>
                  </>
                )}

                {scRate > 0 && dineInServiceChargeAmt > 0 && (
                  <View
                    style={[
                      styles.summaryRow,
                      ((isLandscape && !isTablet) ||
                        (isPhone && !isLandscape)) && { marginBottom: 6 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.summaryLabel,
                        isPhone && !isLandscape && { fontSize: 13 },
                      ]}
                    >
                      {allItemsHaveSC ? "Service Charge" : "Item Service Charge"} ({settings.serviceChargePercentage || 0}%)
                    </Text>
                    <Text
                      style={[
                        styles.summaryValue,
                        isPhone && !isLandscape && { fontSize: 13 },
                      ]}
                    >
                      {currencySymbol}
                      {dineInServiceChargeAmt.toFixed(2)}
                    </Text>
                  </View>
                )}

                {twScRate > 0 && twServiceChargeAmt > 0 && (
                  <View
                    style={[
                      styles.summaryRow,
                      ((isLandscape && !isTablet) ||
                        (isPhone && !isLandscape)) && { marginBottom: 6 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.summaryLabel,
                        isPhone && !isLandscape && { fontSize: 13 },
                      ]}
                    >
                      TW Service Charge ({settings.twServiceChargePercentage || 0}%)
                    </Text>
                    <Text
                      style={[
                        styles.summaryValue,
                        isPhone && !isLandscape && { fontSize: 13 },
                      ]}
                    >
                      {currencySymbol}
                      {twServiceChargeAmt.toFixed(2)}
                    </Text>
                  </View>
                )}

                {currentTakeawayCharge > 0 && (
                  <View
                    style={[
                      styles.summaryRow,
                      ((isLandscape && !isTablet) ||
                        (isPhone && !isLandscape)) && { marginBottom: 6 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.summaryLabel,
                        isPhone && !isLandscape && { fontSize: 13 },
                      ]}
                    >
                      Takeaway Charges
                    </Text>
                    <Text
                      style={[
                        styles.summaryValue,
                        isPhone && !isLandscape && { fontSize: 13 },
                      ]}
                    >
                      {currencySymbol}
                      {currentTakeawayCharge.toFixed(2)}
                    </Text>
                  </View>
                )}

                {gstRate > 0 && gstAmount > 0 && (
                  <View
                    style={[
                      styles.summaryRow,
                      ((isLandscape && !isTablet) ||
                        (isPhone && !isLandscape)) && { marginBottom: 6 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.summaryLabel,
                        isPhone && !isLandscape && { fontSize: 13 },
                      ]}
                    >
                      GST ({settings.gstPercentage}%)
                    </Text>
                    <Text
                      style={[
                        styles.summaryValue,
                        isPhone && !isLandscape && { fontSize: 13 },
                      ]}
                    >
                      {currencySymbol}
                      {gstAmount.toFixed(2)}
                    </Text>
                  </View>
                )}

                <View
                  style={[
                    styles.dashedDivider,
                    ((isLandscape && !isTablet) ||
                      (isPhone && !isLandscape)) && { marginVertical: 8 },
                  ]}
                >
                  <View
                    style={[styles.dashLine, { borderColor: Theme.border }]}
                  />
                </View>



                {/* SERVER SELECTION & BILL BUTTON */}
                <View
                  style={{ marginBottom: isPhone && !isLandscape ? 10 : 15 }}
                >
                  <Text
                    style={[
                      styles.grandLabel,
                      { fontSize: 11, marginBottom: 8, opacity: 0.7 },
                    ]}
                  >
                    Assigned Waiter
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <View style={{ position: "relative", flex: 1 }}>
                      <TouchableOpacity
                        style={[
                          styles.serverSelector,
                          !context.serverId &&
                            settings.waiterRequired && {
                              borderColor: Theme.danger,
                              borderStyle: "dashed",
                            },
                          isPhone &&
                            !isLandscape && { minHeight: 44, padding: 6 },
                        ]}
                        onPress={() => setShowServerModal(true)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.serverInfoRow}>
                          <View
                            style={[
                              styles.serverIcon,
                              {
                                backgroundColor: context.serverId
                                  ? Theme.primaryLight
                                  : settings.waiterRequired
                                    ? Theme.dangerBg
                                    : Theme.bgMuted,
                              },
                            ]}
                          >
                            <Ionicons
                              name="person"
                              size={16}
                              color={
                                context.serverId
                                  ? Theme.primary
                                  : settings.waiterRequired
                                    ? Theme.danger
                                    : Theme.textMuted
                              }
                            />
                          </View>
                          <Text
                            style={[
                              styles.serverNameText,
                              !context.serverId &&
                                settings.waiterRequired && {
                                  color: Theme.danger,
                                },
                              isPhone && !isLandscape && { fontSize: 13 },
                            ]}
                            numberOfLines={1}
                          >
                            {context.serverName ||
                              (settings.waiterRequired
                                ? "Select Waiter"
                                : "Select Waiter (Optional)")}
                          </Text>
                          {!context.serverId && (
                            <Ionicons
                              name="chevron-forward"
                              size={14}
                              color={Theme.textMuted}
                            />
                          )}
                        </View>
                      </TouchableOpacity>

                      {context.serverId && (
                        <TouchableOpacity
                          onPress={() => {
                            setOrderContext({
                              ...context,
                              serverId: undefined,
                              serverName: undefined,
                            });
                          }}
                          style={{
                            position: "absolute",
                            top: -8,
                            right: -8,
                            backgroundColor: "#fff",
                            borderRadius: 12,
                            elevation: 2,
                            shadowColor: "#000",
                            shadowOffset: { width: 0, height: 1 },
                            shadowOpacity: 0.2,
                            shadowRadius: 2,
                          }}
                          activeOpacity={0.7}
                        >
                          <Ionicons
                            name="close-circle"
                            size={24}
                            color={Theme.danger}
                          />
                        </TouchableOpacity>
                      )}
                    </View>

                    <TouchableOpacity
                      style={[
                        styles.billBtn,
                        isPhone &&
                          !isLandscape && {
                            minHeight: 44,
                            paddingHorizontal: 10,
                          },
                      ]}
                      onPress={() => setShowBillOptions(true)}
                      activeOpacity={0.7}
                    >
                      <Ionicons
                        name="receipt-outline"
                        size={20}
                        color={Theme.primary}
                      />
                      <Text
                        style={[
                          styles.billBtnText,
                          isPhone && !isLandscape && { fontSize: 13 },
                        ]}
                      >
                        Bill
                      </Text>
                    </TouchableOpacity>
                  </View>
                  {!context.serverId && settings.waiterRequired && (
                    <Text
                      style={{
                        color: Theme.danger,
                        fontSize: 10,
                        marginTop: 4,
                        fontFamily: Fonts.bold,
                      }}
                    >
                      * Required to proceed
                    </Text>
                  )}
                </View>

                <View
                  style={[
                    styles.grandRow,
                    ((isLandscape && !isTablet) ||
                      (isPhone && !isLandscape)) && { marginBottom: 12 },
                  ]}
                >
                  <View>
                    <Text
                      style={[
                        styles.grandLabel,
                        ((isLandscape && !isTablet) ||
                          (isPhone && !isLandscape)) && { fontSize: 11 },
                      ]}
                    >
                      Total Amount
                    </Text>
                    <Text
                      style={[
                        styles.grandSub,
                        isPhone && !isLandscape && { fontSize: 10 },
                      ]}
                    >
                      Including all taxes
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.grandValue,
                      isLandscape && !isTablet && { fontSize: 24 },
                      isPhone && !isLandscape && { fontSize: 22 },
                    ]}
                  >
                    {currencySymbol}
                    {grandTotal.toFixed(2)}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.proceedBtn,
                    isLandscape &&
                      !isTablet && { height: 48, borderRadius: 12 },
                    isPhone && !isLandscape && { height: 44, borderRadius: 12 },
                    !context.serverId &&
                      settings.waiterRequired && {
                        opacity: 0.5,
                        backgroundColor: Theme.textMuted,
                      },
                  ]}
                  onPress={() => {
                    if (!context.serverId && settings.waiterRequired) {
                      showToast({
                        type: "warning",
                        message: "Select Waiter",
                        subtitle: "Please assign a waiter before proceeding",
                      });
                      setShowServerModal(true);
                      return;
                    }
                    if (isWaiter()) {
                      router.replace("/(tabs)/category");
                      return;
                    }
                    const canPay = permissions["OPRSET"]?.canAdd;
                    if (!canPay) {
                      if (Platform.OS === 'web') {
                        router.replace("/(tabs)/category");
                      } else {
                        Alert.alert(
                          "Access Denied",
                          "You are not authorized to process payments.",
                          [{ text: "OK", onPress: () => router.replace("/(tabs)/category") }]
                        );
                      }
                      return;
                    }
                    router.push({
                      pathname: "/payment",
                      params: {
                        mobileNo: loyaltyPhone ? `${selectedCountry.code} ${loyaltyPhone.trim()}` : "",
                        customerName: loyaltyName || "",
                        rewardMemberId: rewardMember?.MemberId || "",
                      },
                    });
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="card-outline" size={22} color="#fff" />
                  <Text
                    style={[
                      styles.proceedText,
                      isLandscape && !isTablet && { fontSize: 16 },
                      isPhone && !isLandscape && { fontSize: 14 },
                    ]}
                  >
                    Proceed to Payment
                  </Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </View>

      {/* DISCOUNT TYPE SELECTION MODAL */}
      <Modal
        visible={showDiscountTypeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDiscountTypeModal(false)}
      >
        <TouchableOpacity
          style={{
            flex: 1,
            backgroundColor: "rgba(15, 23, 42, 0.4)",
            justifyContent: "center",
            alignItems: "center",
            padding: 16,
          }}
          activeOpacity={1}
          onPress={() => setShowDiscountTypeModal(false)}
        >
          <View
            style={[
              {
                backgroundColor: Theme.bgCard,
                padding: 24,
                borderRadius: 20,
                width: "90%",
                maxWidth: 400,
                alignItems: "stretch",
                borderWidth: 1,
                borderColor: Theme.border,
                ...Theme.shadowLg,
              },
            ]}
          >
            {/* Header */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View
                  style={{
                    backgroundColor: Theme.primaryLight,
                    padding: 8,
                    borderRadius: 10,
                  }}
                >
                  <Ionicons name="pricetags" size={18} color={Theme.primary} />
                </View>
                <Text
                  style={{
                    fontFamily: Fonts.bold,
                    fontSize: 18,
                    color: Theme.textPrimary,
                  }}
                >
                  Select Discount Type
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowDiscountTypeModal(false)}
                style={{ padding: 4 }}
              >
                <Ionicons name="close" size={20} color={Theme.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Options */}
            <View style={{ gap: 12 }}>
              {/* Option 1: Order Discount */}
              <TouchableOpacity
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 16,
                  backgroundColor: Theme.bgMuted || "#F8FAFC",
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: Theme.border,
                  gap: 12,
                }}
                activeOpacity={0.7}
                onPress={() => {
                  setShowDiscountTypeModal(false);
                  setShowDiscount(true);
                }}
              >
                <View
                  style={{
                    backgroundColor: "#EFF6FF",
                    padding: 10,
                    borderRadius: 10,
                  }}
                >
                  <Ionicons name="receipt-outline" size={22} color="#3B82F6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontFamily: Fonts.bold,
                      fontSize: 15,
                      color: Theme.textPrimary,
                    }}
                  >
                    Order Discount
                  </Text>
                  <Text
                    style={{
                      fontFamily: Fonts.regular,
                      fontSize: 12,
                      color: Theme.textSecondary,
                      marginTop: 2,
                    }}
                  >
                    Apply discount to the entire bill
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Theme.textMuted} />
              </TouchableOpacity>

              {/* Option 2: Item Discount */}
              <TouchableOpacity
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  padding: 16,
                  backgroundColor: Theme.bgMuted || "#F8FAFC",
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: Theme.border,
                  gap: 12,
                }}
                activeOpacity={0.7}
                onPress={() => {
                  setShowDiscountTypeModal(false);
                  setShowItemDiscount(true);
                }}
              >
                <View
                  style={{
                    backgroundColor: "#FDF2F8",
                    padding: 10,
                    borderRadius: 10,
                  }}
                >
                  <Ionicons name="pricetag-outline" size={22} color="#EC4899" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontFamily: Fonts.bold,
                      fontSize: 15,
                      color: Theme.textPrimary,
                    }}
                  >
                    Item Discount
                  </Text>
                  <Text
                    style={{
                      fontFamily: Fonts.regular,
                      fontSize: 12,
                      color: Theme.textSecondary,
                      marginTop: 2,
                    }}
                  >
                    Apply discount to specific menu items
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Theme.textMuted} />
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      <DiscountModal
        visible={showDiscount}
        onClose={() => setShowDiscount(false)}
        currentTotal={subtotal}
      />

      <ItemDiscountModal
        visible={showItemDiscount}
        onClose={() => setShowItemDiscount(false)}
      />

      <CancelOrderModal
        visible={showCancelModal}
        onClose={() => {
          setShowCancelModal(false);
          setSelectedCancelReason(null);
          setCustomCancelReason("");
        }}
        onConfirm={(reason, password) => {
          handleCancelOrder(reason, password);
        }}
        cancelReasons={cancelReasons}
        loadingReasons={loadingReasons}
        isCancelling={isCancellingOrder}
      />

      {/* PROMO CODE MODAL */}
      <Modal
        visible={showPromoModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPromoModal(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowPromoModal(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.modalContent, { maxWidth: 420, maxHeight: "85%" }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Promo Codes</Text>
                  <TouchableOpacity onPress={() => setShowPromoModal(false)}>
                    <Ionicons name="close" size={24} color={Theme.textPrimary} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.modalDesc}>
                  Select a saved promo code or search/type to apply.
                </Text>

                <View style={[styles.searchWrap, { width: "100%", marginTop: 5, marginBottom: 15 }]}>
                  <Ionicons name="search-outline" size={20} color={Theme.textMuted} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search promo or type code manually..."
                    placeholderTextColor={Theme.textMuted}
                    value={promoCodeInput}
                    onChangeText={setPromoCodeInput}
                    autoCapitalize="characters"
                    autoFocus
                  />
                  {promoCodeInput.length > 0 && (
                    <TouchableOpacity onPress={() => setPromoCodeInput("")}>
                      <Ionicons name="close-circle" size={20} color={Theme.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>

                {loadingPromos ? (
                  <ActivityIndicator size="small" color={Theme.primary} style={{ marginVertical: 20 }} />
                ) : (
                  <ScrollView style={{ maxHeight: 220, marginBottom: 20 }} showsVerticalScrollIndicator={true}>
                    {filteredPromos.length === 0 ? (
                      <Text style={{ textAlign: "center", color: Theme.textMuted, marginVertical: 15, fontFamily: Fonts.regular }}>
                        No active promo codes found
                      </Text>
                    ) : (
                      filteredPromos.map((item) => (
                        <TouchableOpacity
                          key={item.MemberId}
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: 12,
                            borderRadius: 12,
                            backgroundColor: Theme.bgMuted,
                            marginBottom: 8,
                            borderWidth: 1,
                            borderColor: Theme.border,
                          }}
                          onPress={() => handlePromoCode(item.Promocode)}
                        >
                          <View style={{ flex: 1, marginRight: 10 }}>
                            <Text style={{ fontFamily: Fonts.bold, fontSize: 15, color: Theme.textPrimary }}>
                              {item.Promocode}
                            </Text>
                            <Text style={{ fontFamily: Fonts.medium, fontSize: 12, color: Theme.textSecondary, marginTop: 2 }}>
                              {item.Name} ({item.Phone})
                            </Text>
                          </View>
                          <Text style={{ fontFamily: Fonts.black, fontSize: 16, color: Theme.primary }}>
                            {currencySymbol}{Number(item.Promoamount || 0).toFixed(2)}
                          </Text>
                        </TouchableOpacity>
                      ))
                    )}
                  </ScrollView>
                )}

                <View style={{ flexDirection: "row", gap: 12, width: "100%" }}>
                  <TouchableOpacity
                    style={[
                      styles.mergeConfirmBtn,
                      styles.mergeConfirmBtnCancel,
                      { paddingVertical: 12 },
                    ]}
                    onPress={() => {
                      setShowPromoModal(false);
                      setPromoCodeInput("");
                    }}
                  >
                    <Text style={styles.mergeConfirmBtnCancelText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.mergeConfirmBtn,
                      styles.mergeConfirmBtnPrimary,
                      { paddingVertical: 12 },
                      (!promoCodeInput.trim() || isApplyingPromo) && { opacity: 0.6 },
                    ]}
                    onPress={() => handlePromoCode(promoCodeInput)}
                    disabled={!promoCodeInput.trim() || isApplyingPromo}
                  >
                    {isApplyingPromo ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.mergeConfirmBtnPrimaryText}>Apply</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      <VoidItemModal
        visible={showVoidModal}
        onClose={() => {
          setShowVoidModal(false);
          setItemToVoid(null);
          setVoidPassword("");
        }}
        itemName={itemToVoid?.name || "Item"}
        onConfirm={async (password) => {
          const verifyRes = await fetch(`${API_URL}/api/auth/verify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password, role: "Void,ADMIN" }),
          });
          const verifyData = await verifyRes.json();

          if (verifyData.success) {
            const hasDbOrder = displayOrderId && displayOrderId !== "NEW" && displayOrderId !== "PENDING" && !displayOrderId.startsWith("TEMP-");
            if (hasDbOrder && itemToVoid) {
              try {
                const token = useAuthStore.getState().token;
                const res = await fetch(`${API_URL}/api/orders/remove-item`, {
                  method: "POST",
                  headers: { 
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                  },
                  body: JSON.stringify({
                    tableId: context.tableId,
                    itemId: itemToVoid.lineItemId,
                    qtyToVoid: itemToVoid.qty,
                    userId: user?.userId,
                  }),
                });
                if (!res.ok) {
                  const errorData = await res.json().catch(() => ({}));
                  throw new Error(errorData.error || `Server returned ${res.status}`);
                }
                voidOrderItem(displayOrderId, itemToVoid.lineItemId);
                useCartStore.getState().voidCartItem(itemToVoid.lineItemId);
                showToast({ type: "success", message: "Item Voided" });
              } catch (err) {
                console.error("Void Error:", err);
                showToast({ type: "error", message: "Failed to void item" });
              }
            } else {
              // Local only if no active order context
              if (context.tableId && itemToVoid) {
                const storeState = useCartStore.getState() as any;
                const currentCart = storeState.carts[currentContextId] || [];
                const updatedCart = currentCart.filter((it: any) => it.lineItemId !== itemToVoid.lineItemId);
                storeState.setCartItems(context.tableId, updatedCart);
              }
            }

            setShowVoidModal(false);
            setItemToVoid(null);
            setVoidPassword("");
          } else {
            showToast({
              type: "error",
              message: "Incorrect Password",
              subtitle: "Void or Admin password required",
            });
          }
        }}
      />

      <ServerSelectionModal
        visible={showServerModal}
        onClose={() => setShowServerModal(false)}
        servers={servers}
        loading={loadingServers}
        selectedServerId={context.serverId}
        onSelect={(server) => {
          setOrderContext({
            ...context,
            serverId: server?.SER_ID,
            serverName: server?.SER_NAME,
          });
          setShowServerModal(false);
        }}
      />

      {/* 🏆 REWARD POINTS MEMBER LOOKUP MODAL */}
      <Modal
        visible={showRewardModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRewardModal(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowRewardModal(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.modalContent, { maxWidth: 450, maxHeight: "85%" }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Reward Member Lookup</Text>
                  <TouchableOpacity onPress={() => setShowRewardModal(false)}>
                    <Ionicons name="close" size={24} color={Theme.textPrimary} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.modalDesc}>
                  Link a member number or name to award reward wallet points.
                </Text>

                <View style={[styles.searchWrap, { width: "100%", marginTop: 5, marginBottom: 15 }]}>
                  <Ionicons name="search-outline" size={20} color={Theme.textMuted} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Enter phone or customer name..."
                    placeholderTextColor={Theme.textMuted}
                    value={rewardSearchText}
                    onChangeText={handleRewardSearch}
                  />
                  {rewardSearchText.length > 0 && (
                    <TouchableOpacity onPress={() => {
                      setRewardSearchText("");
                      setRewardSearchResults([]);
                    }}>
                      <Ionicons name="close-circle" size={20} color={Theme.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>

                {isSearchingRewards ? (
                  <ActivityIndicator size="small" color={Theme.primary} style={{ marginVertical: 20 }} />
                ) : (
                  <ScrollView style={{ maxHeight: 220, marginBottom: 20 }} showsVerticalScrollIndicator={true}>
                    {rewardSearchResults.length === 0 ? (
                      <Text style={{ textAlign: "center", color: Theme.textMuted, marginVertical: 15, fontFamily: Fonts.regular }}>
                        {rewardSearchText ? "No matching members found" : "Type to search members"}
                      </Text>
                    ) : (
                      rewardSearchResults.map((item) => (
                        <TouchableOpacity
                          key={item.MemberId}
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                            padding: 12,
                            borderRadius: 12,
                            backgroundColor: Theme.bgMuted,
                            marginBottom: 8,
                            borderWidth: 1,
                            borderColor: Theme.border,
                          }}
                          onPress={() => {
                            setRewardMember(item);
                            setShowRewardModal(false);
                            setRewardSearchText("");
                            setRewardSearchResults([]);
                          }}
                        >
                          <View style={{ flex: 1, marginRight: 10 }}>
                            <Text style={{ fontFamily: Fonts.bold, fontSize: 15, color: Theme.textPrimary }}>
                              {item.Name}
                            </Text>
                            <Text style={{ fontFamily: Fonts.medium, fontSize: 12, color: Theme.textSecondary, marginTop: 2 }}>
                              Phone: {item.Phone}
                            </Text>
                          </View>
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={{ fontFamily: Fonts.black, fontSize: 14, color: "#D97706" }}>
                              {currencySymbol}{(parseFloat(item.RewardCredit) || 0).toFixed(2)} Rewards
                            </Text>
                            <Text style={{ fontFamily: Fonts.medium, fontSize: 11, color: Theme.textSecondary, marginTop: 2 }}>
                              Credit: {currencySymbol}{(parseFloat(item.AvailableCredit) || 0).toFixed(2)}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      ))
                    )}
                  </ScrollView>
                )}

                {rewardMember && (
                  <TouchableOpacity
                    style={{
                      backgroundColor: Theme.dangerBg,
                      padding: 12,
                      borderRadius: 12,
                      alignItems: "center",
                      marginBottom: 15,
                      borderWidth: 1,
                      borderColor: Theme.dangerBorder
                    }}
                    onPress={() => {
                      setRewardMember(null);
                      setShowRewardModal(false);
                    }}
                  >
                    <Text style={{ fontFamily: Fonts.bold, color: Theme.danger, fontSize: 14 }}>
                      Unlink Current Member ({rewardMember.Name})
                    </Text>
                  </TouchableOpacity>
                )}

                <View style={{ flexDirection: "row", gap: 12, width: "100%" }}>
                  <TouchableOpacity
                    style={[
                      styles.mergeConfirmBtn,
                      styles.mergeConfirmBtnCancel,
                      { paddingVertical: 12, flex: 1 },
                    ]}
                    onPress={() => {
                      setShowRewardModal(false);
                      setRewardSearchText("");
                      setRewardSearchResults([]);
                    }}
                  >
                    <Text style={styles.mergeConfirmBtnCancelText}>Close</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* BILL OPTIONS MODAL */}
      <Modal transparent visible={showBillOptions} animationType="fade">
        <TouchableWithoutFeedback onPress={() => setShowBillOptions(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback>
              <View style={[styles.modalContent, { maxWidth: 350, maxHeight: "85%" }]}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Bill Options</Text>
                  <TouchableOpacity onPress={() => setShowBillOptions(false)}>
                    <Ionicons
                      name="close"
                      size={24}
                      color={Theme.textPrimary}
                    />
                  </TouchableOpacity>
                </View>

                <Text style={styles.modalDesc}>
                  Select an action for this bill
                </Text>

                <ScrollView style={{ maxHeight: 350 }} showsVerticalScrollIndicator={false}>
                  <TouchableOpacity
                    style={styles.billOptionItem}
                    onPress={handleSplitBill}
                  >
                    <View
                      style={[
                        styles.billOptionIcon,
                        { backgroundColor: Theme.infoBg },
                      ]}
                    >
                      <Ionicons
                        name="git-branch-outline"
                        size={20}
                        color={Theme.info}
                      />
                    </View>
                    <Text style={styles.billOptionText}>Split Bill</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.billOptionItem}
                    onPress={handleMergeBill}
                  >
                    <View
                      style={[
                        styles.billOptionIcon,
                        { backgroundColor: Theme.warningBg },
                      ]}
                    >
                      <Ionicons
                        name="layers-outline"
                        size={20}
                        color={Theme.warning}
                      />
                    </View>
                    <Text style={styles.billOptionText}>Merge Bill</Text>
                  </TouchableOpacity>




                  <TouchableOpacity
                    style={styles.billOptionItem}
                    onPress={handlePrintCheckoutBill}
                  >
                    <View
                      style={[
                        styles.billOptionIcon,
                        { backgroundColor: Theme.successBg },
                      ]}
                    >
                      <Ionicons
                        name="receipt-outline"
                        size={20}
                        color={Theme.success}
                      />
                    </View>
                    <Text style={styles.billOptionText}>Print Bill</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.billOptionItem}
                    onPress={handleReprintKOT}
                  >
                    <View
                      style={[
                        styles.billOptionIcon,
                        { backgroundColor: Theme.primaryLight },
                      ]}
                    >
                      <Ionicons
                        name="print-outline"
                        size={20}
                        color={Theme.primary}
                      />
                    </View>
                    <Text style={styles.billOptionText}>Reprint KOT</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.billOptionItem}
                    onPress={handleReduceServiceCharge}
                    disabled={isReducingSC}
                  >
                    <View
                      style={[
                        styles.billOptionIcon,
                        { backgroundColor: scReduced ? "#f0fdf4" : "#fef9c3" },
                      ]}
                    >
                      {isReducingSC ? (
                        <ActivityIndicator size={18} color="#ca8a04" />
                      ) : (
                        <MaterialCommunityIcons
                          name="percent-outline"
                          size={20}
                          color={scReduced ? "#16a34a" : "#ca8a04"}
                        />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.billOptionText}>
                        {scReduced ? "Restore Service Charge" : "Remove Service Charge"}
                      </Text>
                      {scReduced && (
                        <Text style={{ fontSize: 11, color: "#16a34a", marginTop: 2, fontFamily: Fonts.medium }}>
                          Service charge set to 0.00 (Tap to restore)
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.billOptionItem}
                    onPress={handleToggleTakeawayCharge}
                    disabled={isApplyingTakeaway}
                  >
                    <View
                      style={[
                        styles.billOptionIcon,
                        { backgroundColor: takeawayChargeApplied ? "#f0fdf4" : "#fef9c3" },
                      ]}
                    >
                      {isApplyingTakeaway ? (
                        <ActivityIndicator size={18} color="#ca8a04" />
                      ) : (
                        <Ionicons
                          name="bicycle-outline"
                          size={20}
                          color={takeawayChargeApplied ? "#16a34a" : "#ca8a04"}
                        />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.billOptionText}>
                        {takeawayChargeApplied ? "Remove Takeaway Charge" : "Add Takeaway Charge"}
                      </Text>
                      {takeawayChargeApplied && (
                        <Text style={{ fontSize: 11, color: "#16a34a", marginTop: 2, fontFamily: Fonts.medium }}>
                          Takeaway charge set to {currencySymbol}{takeawayChargeAmt.toFixed(2)}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* SPLIT BILL MODAL */}
      <Modal transparent visible={showSplitModal} animationType="slide">
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              { maxHeight: "95%", maxWidth: 600, width: "90%" },
            ]}
          >
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Split Bill</Text>
                <Text style={styles.modalSubTitle}>
                  Order #{displayOrderId} •{" "}
                  {context.orderType === "DINE_IN"
                    ? `Table ${context.tableNo}`
                    : `Takeaway ${context.takeawayNo}`}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowSplitModal(false)}>
                <Ionicons name="close" size={28} color={Theme.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Mode Toggle Bar for Split Method */}
            <View style={styles.modeToggleBar}>
              <TouchableOpacity
                style={[
                  styles.modeToggleBtn,
                  splitType === "items" && styles.activeModeToggleBtn,
                ]}
                onPress={() => setSplitType("items")}
              >
                <Text
                  style={[
                    styles.modeToggleText,
                    splitType === "items" && styles.activeModeToggleText,
                  ]}
                >
                  Split by Items
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modeToggleBtn,
                  splitType === "parts" && styles.activeModeToggleBtn,
                ]}
                onPress={() => setSplitType("parts")}
              >
                <Text
                  style={[
                    styles.modeToggleText,
                    splitType === "parts" && styles.activeModeToggleText,
                  ]}
                >
                  Split by Parts
                </Text>
              </TouchableOpacity>
            </View>

            {splitType === "items" ? (
              <View style={{ flexShrink: 1 }}>
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>
                    Select Items from Cart
                  </Text>
                  {cart
                    .filter((i: any) => i.status !== "VOIDED")
                    .map((item: any) => (
                      <View key={item.lineItemId} style={styles.splitItemRow}>
                        <View style={styles.splitItemInfo}>
                          <Text style={styles.splitItemName}>{item.name}</Text>
                          <Text
                            style={[
                              styles.splitItemPrice,
                              { color: Theme.primary, fontFamily: Fonts.bold },
                            ]}
                          >
                            {currencySymbol}
                            {item.price?.toFixed(2)}
                          </Text>
                        </View>

                        <View style={styles.splitQtyControls}>
                          <TouchableOpacity
                            style={styles.splitQtyBtn}
                            onPress={() => {
                              const current =
                                splitQuantities[item.lineItemId] || 0;
                              if (current > 0) {
                                setSplitQuantities((prev) => ({
                                  ...prev,
                                  [item.lineItemId]: current - 1,
                                }));
                              }
                            }}
                          >
                            <Ionicons
                              name="remove"
                              size={16}
                              color={Theme.primary}
                            />
                          </TouchableOpacity>

                          <Text style={styles.splitQtyText}>
                            {splitQuantities[item.lineItemId] || 0}
                          </Text>

                          <TouchableOpacity
                            style={styles.splitQtyBtn}
                            onPress={() => {
                              const current =
                                splitQuantities[item.lineItemId] || 0;
                              if (current < item.qty) {
                                setSplitQuantities((prev) => ({
                                  ...prev,
                                  [item.lineItemId]: current + 1,
                                }));
                              }
                            }}
                          >
                            <Ionicons
                              name="add"
                              size={16}
                              color={Theme.primary}
                            />
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}

                  {extraSplitItems.length > 0 && (
                    <>
                      <Text
                        style={[
                          styles.sectionLabel,
                          { marginTop: 20, marginBottom: 10 },
                        ]}
                      >
                        Extra Items Added
                      </Text>
                      {extraSplitItems.map((item, idx) => (
                        <View
                          key={`extra-${idx}`}
                          style={[
                            styles.splitItemRow,
                            { borderColor: Theme.success },
                          ]}
                        >
                          <View style={styles.splitItemInfo}>
                            <Text style={styles.splitItemName}>{item.name}</Text>
                            <Text
                              style={[
                                styles.splitItemPrice,
                                { color: Theme.success, fontFamily: Fonts.bold },
                              ]}
                            >
                              {currencySymbol}
                              {item.price?.toFixed(2)}
                            </Text>
                          </View>
                          <View style={styles.splitQtyControls}>
                            <TouchableOpacity
                              style={styles.splitQtyBtn}
                              onPress={() => {
                                const newExtras = [...extraSplitItems];
                                if (newExtras[idx].qty > 1) {
                                  newExtras[idx].qty -= 1;
                                  setExtraSplitItems(newExtras);
                                } else {
                                  newExtras.splice(idx, 1);
                                  setExtraSplitItems(newExtras);
                                }
                              }}
                            >
                              <Ionicons
                                name="remove"
                                size={16}
                                color={Theme.danger}
                              />
                            </TouchableOpacity>
                            <Text style={styles.splitQtyText}>{item.qty}</Text>
                            <TouchableOpacity
                              style={styles.splitQtyBtn}
                              onPress={() => {
                                const newExtras = [...extraSplitItems];
                                newExtras[idx].qty += 1;
                                setExtraSplitItems(newExtras);
                              }}
                            >
                              <Ionicons
                                name="add"
                                size={16}
                                color={Theme.success}
                              />
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))}
                    </>
                  )}

                  <View
                    style={{
                      marginTop: 20,
                      paddingTop: 20,
                      borderTopWidth: 1,
                      borderTopColor: Theme.border,
                    }}
                  >
                    <Text style={styles.sectionLabel}>Add Extra Items</Text>
                    <View style={[styles.searchWrap, { marginTop: 10 }]}>
                      <Ionicons name="search" size={20} color={Theme.textMuted} />
                      <TextInput
                        style={styles.searchInput}
                        placeholder="Search dish to add..."
                        value={searchDishText}
                        onChangeText={setSearchDishText}
                      />
                      {searchDishText.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchDishText("")}>
                          <Ionicons
                            name="close-circle"
                            size={20}
                            color={Theme.textMuted}
                          />
                        </TouchableOpacity>
                      )}
                    </View>

                    {searchDishText.length > 0 && (
                      <View style={styles.searchResults}>
                        {allDishes
                          .filter((d) =>
                            (d.Name || d.DishName || "")
                              .toLowerCase()
                              .includes(searchDishText.toLowerCase()),
                          )
                          .slice(0, 5)
                          .map((dish) => (
                            <TouchableOpacity
                              key={dish.DishId}
                              style={styles.searchResultItem}
                              onPress={() => {
                                const existingIdx = extraSplitItems.findIndex(
                                  (i) => i.id === dish.DishId,
                                );
                                if (existingIdx > -1) {
                                  const newExtras = [...extraSplitItems];
                                  newExtras[existingIdx].qty += 1;
                                  setExtraSplitItems(newExtras);
                                } else {
                                  setExtraSplitItems([
                                    ...extraSplitItems,
                                    {
                                      lineItemId: `extra-${Date.now()}`,
                                      id: dish.DishId,
                                      name: dish.Name || dish.DishName,
                                      price: dish.Price || 0,
                                      qty: 1,
                                    },
                                  ]);
                                }
                                setSearchDishText("");
                                Keyboard.dismiss();
                              }}
                            >
                              <Text style={styles.searchResultName}>
                                {dish.Name || dish.DishName}
                              </Text>
                              <Text style={styles.searchResultPrice}>
                                {currencySymbol}
                                {dish.Price?.toFixed(2)}
                              </Text>
                            </TouchableOpacity>
                          ))}
                      </View>
                    )}
                  </View>
                </ScrollView>
              </View>
            ) : (
              <View style={{ paddingVertical: 20, alignItems: "center" }}>
                <Text style={[styles.sectionLabel, { marginBottom: 15 }]}>
                  Select Number of Parts
                </Text>
                <View style={{ flexDirection: "row", gap: 10, justifyContent: "center", width: "100%", flexWrap: "wrap" }}>
                  {[2, 3, 4, 5].map((num) => (
                    <TouchableOpacity
                      key={num}
                      style={[
                        styles.chip,
                        { paddingHorizontal: 20, paddingVertical: 12 },
                        partCount === num && styles.activeChip,
                      ]}
                      onPress={() => setPartCount(num)}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          partCount === num && styles.activeChipText,
                          { fontSize: 16 },
                        ]}
                      >
                        {num} Parts
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={{ marginTop: 24, color: Theme.textSecondary, fontFamily: Fonts.bold, fontSize: 14, textAlign: "center", lineHeight: 22 }}>
                  Total Bill: {currencySymbol}{grandTotal.toFixed(2)}{"\n"}
                  Each Part: <Text style={{ color: Theme.primary, fontFamily: Fonts.black }}>{currencySymbol}{(grandTotal / partCount).toFixed(2)}</Text>
                </Text>
              </View>
            )}

            <View style={styles.splitFooter}>
              <View style={styles.splitTotalRow}>
                <View>
                  <Text style={styles.splitTotalLabel}>Selected Total</Text>
                  <Text style={styles.grandSub}>Dish + Price Summary</Text>
                </View>
                <Text style={styles.splitTotalValue}>
                  {currencySymbol}
                  {splitType === "items"
                    ? (
                        Object.entries(splitQuantities).reduce(
                          (sum, [lineItemId, qty]: [string, any]) => {
                            const item = cart.find(
                              (i: any) => i.lineItemId === lineItemId,
                            );
                            return sum + (item?.price || 0) * qty;
                          },
                          0,
                        ) +
                        extraSplitItems.reduce(
                          (sum, item) => sum + (item.price || 0) * item.qty,
                          0,
                        )
                      ).toFixed(2)
                    : (grandTotal / partCount).toFixed(2)}
                </Text>
              </View>

              <View style={splitType === "parts" ? { flexDirection: "row", gap: 10, width: "100%" } : {}}>
                {splitType === "parts" && (
                  <TouchableOpacity
                    style={[styles.proceedBtn, { flex: 1, backgroundColor: "#4A5568" }]}
                    onPress={handlePrintSplitPartsBills}
                  >
                    <Ionicons name="print-outline" size={22} color="#fff" />
                    <Text style={styles.proceedText}>Print Split Bills</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[
                    styles.proceedBtn,
                    splitType === "parts" && { flex: 1 },
                    splitType === "items" &&
                      Object.values(splitQuantities).every((q) => q === 0) &&
                      extraSplitItems.length === 0 && { opacity: 0.5 },
                  ]}
                  disabled={
                    splitType === "items" &&
                    Object.values(splitQuantities).every((q) => q === 0) &&
                    extraSplitItems.length === 0
                  }
                  onPress={() => {
                    if (isWaiter()) {
                      setShowSplitModal(false);
                      router.replace("/(tabs)/category");
                      return;
                    }
                    const canPay = permissions["OPRSET"]?.canAdd;
                    if (!canPay) {
                      if (Platform.OS === 'web') {
                        router.replace("/(tabs)/category");
                      } else {
                        Alert.alert(
                          "Access Denied",
                          "You are not authorized to process payments.",
                          [{ text: "OK", onPress: () => router.replace("/(tabs)/category") }]
                        );
                      }
                      return;
                    }
                    const selectedItems = splitType === "items"
                      ? [
                          ...cart
                            .map((item: any) => ({
                              ...item,
                              qty: splitQuantities[item.lineItemId] || 0,
                            }))
                            .filter((i: any) => i.qty > 0),
                          ...extraSplitItems,
                        ]
                      : cart.map((item: any) => ({
                          ...item,
                          qty: Math.round((item.qty / partCount) * 1000) / 1000,
                        }));

                    if (splitType === "parts") {
                      useCartStore.getState().setSplitPartsCount(partCount);
                    } else {
                      useCartStore.getState().setSplitPartsCount(null);
                    }
                    useCartStore.getState().setActiveSplitItems(selectedItems);
                    setShowSplitModal(false);
                    router.push({
                      pathname: "/payment",
                      params: {
                        mobileNo: loyaltyPhone ? `${selectedCountry.code} ${loyaltyPhone.trim()}` : "",
                        customerName: loyaltyName || "",
                      },
                    });
                  }}
                >
                  <Ionicons name="card-outline" size={22} color="#fff" />
                  <Text style={styles.proceedText}>Pay Separate Amount</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* MERGE BILL MODAL */}
      <Modal transparent visible={showMergeModal} animationType="slide">
        <View style={styles.modalOverlay}>
          <View
            style={[styles.modalContent, { maxHeight: "80%", maxWidth: 500 }]}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Merge Bills</Text>
              <TouchableOpacity onPress={() => { setShowMergeModal(false); setSelectedMergeOrderIds([]); }}>
                <Ionicons name="close" size={24} color={Theme.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDesc}>
              Select orders to merge into current bill
            </Text>

            <FlatList
              style={{ flexShrink: 1, marginBottom: 15 }}
              data={activeSessions.filter(
                (o: any) => 
                  o.context?.orderType === "DINE_IN" && 
                  o.context?.tableId && 
                  String(o.context.tableId).replace(/^\{|\}$/g, "").trim().toLowerCase() !== 
                  String(context?.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase()
              )}
              extraData={[selectedMergeOrderIds, activeSessions]}
              keyExtractor={(item) => item.orderId}
              renderItem={({ item }) => {
                const isSelected = selectedMergeOrderIds.includes(item.orderId);
                return (
                  <TouchableOpacity
                    style={[
                      styles.mergeItem,
                      isSelected && styles.mergeItemSelected,
                    ]}
                    onPress={() => toggleMergeSelection(item.orderId)}
                  >
                    <Ionicons
                      name={isSelected ? "checkbox" : "square-outline"}
                      size={22}
                      color={isSelected ? Theme.primary : Theme.textMuted}
                    />
                    <View
                      style={[
                        styles.mergeIcon,
                        { backgroundColor: isSelected ? Theme.primary : Theme.primaryLight },
                      ]}
                    >
                      <Ionicons
                        name="receipt-outline"
                        size={20}
                        color={isSelected ? "#fff" : Theme.primary}
                      />
                    </View>
                    <View style={styles.mergeInfo}>
                      <Text style={styles.mergeTitle}>
                        {item.context.orderType === "DINE_IN"
                          ? `Table ${item.context.tableNo}`
                          : `Takeaway #${item.context.takeawayNo || item.orderId.slice(-4)}`}
                      </Text>
                      <Text style={styles.mergeSub} numberOfLines={1}>
                        {item.items
                          .filter((i: any) => i.status !== "VOIDED")
                          .map((i: any) => `${i.name} x${formatQty(i.qty)}`)
                          .join(", ") || "No items"}
                      </Text>
                      <Text style={{ color: Theme.textMuted, fontSize: 11, fontFamily: Fonts.regular }}>
                        Order #{item.orderId}
                      </Text>
                    </View>
                    <Text style={styles.mergePrice}>
                      {currencySymbol}
                      {item.items
                        .reduce((s: number, i: any) => s + (i.price || 0) * i.qty, 0)
                        .toFixed(2)}
                    </Text>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={() => (
                <View style={{ padding: 40, alignItems: "center" }}>
                  <Text
                    style={{ color: Theme.textMuted, fontFamily: Fonts.medium }}
                  >
                    No other active orders found
                  </Text>
                </View>
              )}
            />

            {/* STICKY BOTTOM BUTTONS */}
            <View style={styles.mergeFooter}>
              <TouchableOpacity
                style={[
                  styles.mergeActionBtn,
                  selectedMergeOrderIds.length === 0 && styles.mergeActionBtnDisabled,
                ]}
                onPress={() => {
                  if (selectedMergeOrderIds.length === 0) {
                    showToast({ type: "error", message: "Please select at least one bill to merge" });
                    return;
                  }
                  setConfirmMergeVisible(true);
                }}
              >
                <Ionicons name="git-merge-outline" size={20} color="#fff" />
                <Text style={styles.mergeActionBtnText}>
                  Merge Selected Bills ({selectedMergeOrderIds.length})
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ✅ CUSTOM MERGE CONFIRMATION MODAL - No window.confirm, APK + Web safe */}
      <Modal
        transparent
        visible={confirmMergeVisible && selectedMergeOrderIds.length > 0}
        animationType="fade"
        onRequestClose={() => { if (!isMerging) setConfirmMergeVisible(false); }}
      >
        <View style={styles.mergeConfirmOverlay}>
          <View style={styles.mergeConfirmBox}>
            <View style={styles.mergeConfirmIconWrap}>
              <Ionicons name="git-merge-outline" size={32} color={Theme.primary} />
            </View>
            <Text style={styles.mergeConfirmTitle}>Confirm Merge</Text>
            <Text style={styles.mergeConfirmDesc}>
              Merge{" "}
              <Text style={{ color: Theme.primary, fontFamily: Fonts.black }}>
                {selectedTablesText}
              </Text>
              {" "}order(s) into{" "}
              <Text style={{ color: Theme.primary, fontFamily: Fonts.black }}>
                Table {context?.tableNo || "current"}
              </Text>
              ?{"\n"}All items will be combined.
            </Text>
            <View style={styles.mergeConfirmBtnRow}>
              <TouchableOpacity
                style={[styles.mergeConfirmBtn, styles.mergeConfirmBtnCancel]}
                onPress={() => setConfirmMergeVisible(false)}
                disabled={isMerging}
              >
                <Text style={styles.mergeConfirmBtnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.mergeConfirmBtn, styles.mergeConfirmBtnPrimary, isMerging && { opacity: 0.7 }]}
                onPress={performMerge}
                disabled={isMerging}
              >
                {isMerging ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="git-merge-outline" size={16} color="#fff" />
                    <Text style={styles.mergeConfirmBtnPrimaryText}>Merge Now</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* WALK-IN LOYALTY MODAL */}
      <Modal
        transparent
        visible={showLoyaltyModal}
        animationType="slide"
        onRequestClose={() => setShowLoyaltyModal(false)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={[styles.modalOverlay, { justifyContent: "center", padding: 20 }]}>
            <TouchableWithoutFeedback>
              <View style={{ backgroundColor: Theme.bgCard, borderRadius: 20, maxHeight: "90%", width: "100%", maxWidth: 460, alignSelf: "center", overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.3, shadowRadius: 20, elevation: 20 }}>
                {/* Modal Header */}
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, borderBottomWidth: 1, borderBottomColor: Theme.border, backgroundColor: Theme.bgNav }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: Theme.successBg || "#dcfce7", justifyContent: "center", alignItems: "center" }}>
                      <Ionicons name="ribbon-outline" size={22} color={Theme.success || "#16a34a"} />
                    </View>
                    <View>
                      <Text style={{ fontFamily: Fonts.black, fontSize: 16, color: Theme.textPrimary }}>Walk-in Loyalty</Text>
                      <Text style={{ fontFamily: Fonts.regular, fontSize: 11, color: Theme.textSecondary }}>Search & manage loyalty customers</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => setShowLoyaltyModal(false)}
                    style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: Theme.bgMuted, justifyContent: "center", alignItems: "center" }}
                  >
                    <Ionicons name="close" size={18} color={Theme.textPrimary} />
                  </TouchableOpacity>
                </View>

                {/* Scrollable Content Area */}
                <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20 }}>
                  {loyaltyCustomer && !loyaltyCustomer.isNew ? (
                    /* SELECTED CUSTOMER DASHBOARD */
                    <View>
                      <View style={{ alignItems: "center", paddingVertical: 15 }}>
                        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: Theme.primaryLight, justifyContent: "center", alignItems: "center", marginBottom: 10, borderWidth: 2, borderColor: Theme.primaryBorder }}>
                          <Text style={{ fontFamily: Fonts.black, fontSize: 26, color: Theme.primary }}>{getInitials(loyaltyCustomer.Name)}</Text>
                        </View>
                        <Text style={{ fontFamily: Fonts.black, fontSize: 20, color: Theme.textPrimary }}>{loyaltyCustomer.Name || "Guest"}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                          <Ionicons name="call-outline" size={12} color={Theme.textSecondary} />
                          <Text style={{ fontFamily: Fonts.medium, fontSize: 13, color: Theme.textSecondary }}>{loyaltyCustomer.Phone}</Text>
                        </View>
                      </View>

                      {/* 9-visit visual progress tracker */}
                      <View style={{ marginBottom: 16, padding: 16, backgroundColor: Theme.bgNav, borderRadius: 14, borderWidth: 1, borderColor: Theme.border }}>
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                          <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: Theme.textSecondary }}>Visit Progress</Text>
                          <View style={{ backgroundColor: Theme.primaryLight, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, borderWidth: 1, borderColor: Theme.primaryBorder }}>
                            <Text style={{ fontFamily: Fonts.black, fontSize: 13, color: Theme.primary }}>{loyaltyCustomer.VisitCount} (Lifetime: {loyaltyCustomer.TotalVisits || 0})</Text>
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                          {Array.from({ length: 9 }).map((_, i) => {
                            const isCompleted = i < loyaltyCustomer.VisitCount;
                            return (
                              <View
                                key={i}
                                style={{
                                  width: 28,
                                  height: 28,
                                  borderRadius: 14,
                                  backgroundColor: isCompleted ? (Theme.success || "#16a34a") : Theme.bgMuted,
                                  justifyContent: "center",
                                  alignItems: "center",
                                  borderWidth: 1,
                                  borderColor: isCompleted ? (Theme.success || "#16a34a") : Theme.border,
                                }}
                              >
                                {isCompleted ? (
                                  <Ionicons name="checkmark" size={14} color="#fff" />
                                ) : (
                                  <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.textMuted }}>{i + 1}</Text>
                                )}
                              </View>
                            );
                          })}
                        </View>
                      </View>

                      {/* Reward Status Banner */}
                      <View style={{ marginBottom: 10 }}>
                        {loyaltyCustomer.RewardPending === 1 || loyaltyCustomer.VisitCount === 9 ? (
                          <View style={{ backgroundColor: Theme.successBg || '#dcfce7', padding: 16, borderRadius: 14, borderWidth: 1, borderColor: Theme.successBorder || '#bbf7d0', flexDirection: "row", alignItems: "center", gap: 12 }}>
                            <Ionicons name="gift-outline" size={28} color={Theme.success || "#16a34a"} />
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 15, fontFamily: Fonts.black, color: Theme.success || '#16a34a' }}>🎉 Reward Available!</Text>
                              <Text style={{ fontSize: 12, fontFamily: Fonts.medium, color: Theme.success || '#16a34a', marginTop: 2 }}>Customer is eligible for a free food reward!</Text>
                            </View>
                          </View>
                        ) : (
                          <View style={{ backgroundColor: Theme.bgNav, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: Theme.border, flexDirection: "row", alignItems: "center", gap: 12 }}>
                            <Ionicons name="time-outline" size={28} color={Theme.primary} />
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 15, fontFamily: Fonts.black, color: Theme.textPrimary }}>Next Reward in {9 - loyaltyCustomer.VisitCount} Visits</Text>
                              <Text style={{ fontSize: 12, fontFamily: Fonts.medium, color: Theme.textSecondary, marginTop: 2 }}>{9 - loyaltyCustomer.VisitCount} more visits to complete reward cycle.</Text>
                            </View>
                          </View>
                        )}
                      </View>
                    </View>
                  ) : (
                    /* SEARCH & REGISTER FLOW */
                    <View>
                      <Text style={{ fontFamily: Fonts.medium, fontSize: 13, color: Theme.textSecondary, marginBottom: 16 }}>
                        Search and select customers, check visit counts, and redeem rewards.
                      </Text>

                      {/* Tab selectors */}
                      <View style={{ flexDirection: "row", backgroundColor: Theme.bgMuted, borderRadius: 14, padding: 4, marginBottom: 18 }}>
                        <TouchableOpacity
                          style={{ flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 11, backgroundColor: activeLoyaltyTab === "search" ? Theme.bgCard : "transparent" }}
                          onPress={() => setActiveLoyaltyTab("search")}
                        >
                          <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: activeLoyaltyTab === "search" ? Theme.primary : Theme.textSecondary }}>Select Customer</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 11, backgroundColor: activeLoyaltyTab === "register" ? Theme.bgCard : "transparent" }}
                          onPress={() => setActiveLoyaltyTab("register")}
                        >
                          <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: activeLoyaltyTab === "register" ? Theme.primary : Theme.textSecondary }}>New Registration</Text>
                        </TouchableOpacity>
                      </View>

                      {activeLoyaltyTab === "search" ? (
                        /* SELECT CUSTOMER TAB */
                        <View>
                          {/* Unified Search Input */}
                          <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: Theme.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Theme.bgCard, gap: 8, marginBottom: 14 }}>
                            <Ionicons name="search-outline" size={18} color={Theme.textSecondary} />
                            <TextInput
                              style={{ flex: 1, fontSize: 14, fontFamily: Fonts.regular, color: Theme.textPrimary, paddingVertical: 2, ...Platform.select({ web: { outlineStyle: "none" } as any }) }}
                              placeholder="Search by Name or Mobile..."
                              placeholderTextColor={Theme.textMuted}
                              value={loyaltySearchText}
                              onChangeText={handleSearchTextChange}
                              autoCorrect={false}
                              autoCapitalize="none"
                            />
                            {loyaltySearchText.length > 0 && (
                              <TouchableOpacity onPress={() => handleSearchTextChange("")}>
                                <Ionicons name="close-circle" size={18} color={Theme.textSecondary} />
                              </TouchableOpacity>
                            )}
                          </View>

                          {/* Members List */}
                          <Text style={{ fontSize: 11, fontFamily: Fonts.bold, color: Theme.textSecondary, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>
                            {loyaltySearchText.trim() === "" ? "All Loyalty Members" : "Search Results"}
                          </Text>
                          <View style={{ borderWidth: 1, borderColor: Theme.border, borderRadius: 14, overflow: "hidden", backgroundColor: Theme.bgCard, marginBottom: 16 }}>
                            {(loyaltySearchText.trim() === "" ? defaultLoyaltyMembers : searchResults).map((cust, index) => {
                              const list = loyaltySearchText.trim() === "" ? defaultLoyaltyMembers : searchResults;
                              return (
                                <TouchableOpacity
                                  key={index}
                                  style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    padding: 14,
                                    borderBottomWidth: index === list.length - 1 ? 0 : 1,
                                    borderBottomColor: Theme.border,
                                    gap: 12,
                                  }}
                                  onPress={() => {
                                    handleSelectCustomer(cust);
                                    setLoyaltySearchText("");
                                  }}
                                >
                                  <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: Theme.primaryLight, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: Theme.primaryBorder }}>
                                    <Text style={{ fontFamily: Fonts.black, fontSize: 14, color: Theme.primary }}>{getInitials(cust.Name)}</Text>
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Text style={{ fontFamily: Fonts.bold, fontSize: 14, color: Theme.textPrimary }}>{cust.Name || "Guest"}</Text>
                                    <Text style={{ fontFamily: Fonts.medium, fontSize: 12, color: Theme.textSecondary, marginTop: 2 }}>{cust.Phone}</Text>
                                  </View>
                                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                                    <View style={{ backgroundColor: cust.VisitCount >= 9 ? (Theme.successBg || "#dcfce7") : Theme.bgNav, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, borderColor: cust.VisitCount >= 9 ? (Theme.successBorder || "#bbf7d0") : Theme.border }}>
                                      <Text style={{ fontFamily: Fonts.bold, fontSize: 11, color: cust.VisitCount >= 9 ? (Theme.success || "#16a34a") : Theme.primary }}>{cust.VisitCount || 0} visits (Lifetime: {cust.TotalVisits || 0})</Text>
                                    </View>
                                    <Ionicons name="chevron-forward" size={14} color={Theme.textSecondary} />
                                  </View>
                                </TouchableOpacity>
                              );
                            })}
                            {(loyaltySearchText.trim() !== "" && searchResults.length === 0) && (
                              <View style={{ padding: 24, alignItems: "center" }}>
                                <Ionicons name="search-outline" size={28} color={Theme.textMuted} />
                                <Text style={{ color: Theme.textMuted, fontFamily: Fonts.medium, marginTop: 8 }}>No matching members found</Text>
                              </View>
                            )}
                            {(loyaltySearchText.trim() === "" && defaultLoyaltyMembers.length === 0) && (
                              <View style={{ padding: 24, alignItems: "center" }}>
                                <Ionicons name="people-outline" size={28} color={Theme.textMuted} />
                                <Text style={{ color: Theme.textMuted, fontFamily: Fonts.medium, marginTop: 8 }}>No loyalty members yet</Text>
                                <Text style={{ color: Theme.textMuted, fontFamily: Fonts.regular, fontSize: 12, marginTop: 4 }}>Register customers using the New Registration tab</Text>
                              </View>
                            )}
                          </View>
                        </View>
                      ) : (
                        /* REGISTER NEW TAB */
                        <View>
                          <View style={{ gap: 14, padding: 16, borderWidth: 1, borderColor: Theme.border, borderRadius: 14, backgroundColor: Theme.bgNav, marginBottom: 12 }}>
                            <View>
                              <Text style={{ fontSize: 12, fontFamily: Fonts.bold, color: Theme.textSecondary, marginBottom: 8 }}>Mobile Number *</Text>
                              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                                <TouchableOpacity
                                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: Theme.border, borderRadius: 10, paddingHorizontal: 10, height: 44, backgroundColor: Theme.bgCard, gap: 4 }}
                                  onPress={() => setShowCountryPicker(true)}
                                >
                                  <Text style={{ fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary }}>{selectedCountry.code}</Text>
                                  <Ionicons name="chevron-down" size={12} color={Theme.textSecondary} />
                                </TouchableOpacity>
                                <TextInput
                                  style={{ flex: 1, height: 44, borderWidth: 1, borderColor: Theme.border, borderRadius: 10, paddingHorizontal: 12, backgroundColor: Theme.bgCard, fontSize: 14, fontFamily: Fonts.regular, color: Theme.textPrimary }}
                                  placeholder="Phone number..."
                                  placeholderTextColor={Theme.textMuted}
                                  keyboardType="phone-pad"
                                  value={loyaltyPhone}
                                  onChangeText={(txt) => {
                                    setLoyaltyPhone(txt);
                                    if (loyaltyCustomer) setLoyaltyCustomer(null);
                                  }}
                                />
                                <TouchableOpacity
                                  style={{ height: 44, paddingHorizontal: 16, backgroundColor: Theme.primary, borderRadius: 10, justifyContent: "center", alignItems: "center" }}
                                  onPress={() => handleLoyaltyLookup()}
                                  disabled={isSearchingLoyalty}
                                >
                                  {isSearchingLoyalty ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                  ) : (
                                    <Text style={{ color: "#fff", fontFamily: Fonts.bold, fontSize: 13 }}>Lookup</Text>
                                  )}
                                </TouchableOpacity>
                              </View>
                            </View>

                            <View>
                              <Text style={{ fontSize: 12, fontFamily: Fonts.bold, color: Theme.textSecondary, marginBottom: 8 }}>Customer Name (Optional)</Text>
                              <TextInput
                                style={{ height: 44, borderWidth: 1, borderColor: Theme.border, borderRadius: 10, paddingHorizontal: 12, backgroundColor: Theme.bgCard, fontSize: 14, fontFamily: Fonts.regular, color: Theme.textPrimary }}
                                placeholder="Enter customer name..."
                                placeholderTextColor={Theme.textMuted}
                                value={loyaltyName}
                                onChangeText={setLoyaltyName}
                              />
                            </View>
                          </View>

                          {loyaltyCustomer && loyaltyCustomer.isNew && (
                            <View style={{ padding: 14, backgroundColor: Theme.successBg || '#dcfce7', borderRadius: 12, borderWidth: 1, borderColor: Theme.successBorder || '#bbf7d0', flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
                              <Ionicons name="checkmark-circle" size={20} color={Theme.success || "#16a34a"} />
                              <Text style={{ flex: 1, fontSize: 13, fontFamily: Fonts.bold, color: Theme.success || '#16a34a' }}>
                                Customer will be enrolled upon checkout!
                              </Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  )}
                </ScrollView>

                {/* Sticky Action Footer */}
                <View style={{ padding: 20, borderTopWidth: 1, borderTopColor: Theme.border, backgroundColor: Theme.bgCard }}>
                  {loyaltyCustomer && !loyaltyCustomer.isNew ? (
                    <View style={{ flexDirection: "row", gap: 12 }}>
                      <TouchableOpacity
                        style={{ flex: 1, height: 48, borderRadius: 12, backgroundColor: Theme.dangerBg || '#fee2e2', borderWidth: 1, borderColor: Theme.dangerBorder || '#fecaca', justifyContent: "center", alignItems: "center" }}
                        onPress={() => {
                          setLoyaltyCustomer(null);
                          setLoyaltyPhone("");
                          setLoyaltyName("");
                        }}
                      >
                        <Text style={{ fontFamily: Fonts.bold, fontSize: 14, color: Theme.danger || '#ef4444' }}>Change Customer</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ flex: 1, height: 48, borderRadius: 12, backgroundColor: Theme.primary, justifyContent: "center", alignItems: "center" }}
                        onPress={() => setShowLoyaltyModal(false)}
                      >
                        <Text style={{ fontFamily: Fonts.bold, fontSize: 14, color: "#fff" }}>Done</Text>
                      </TouchableOpacity>
                    </View>
                  ) : activeLoyaltyTab === "search" ? (
                    <TouchableOpacity
                      style={{ height: 48, borderRadius: 12, backgroundColor: Theme.bgMuted, borderWidth: 1, borderColor: Theme.border, justifyContent: "center", alignItems: "center" }}
                      onPress={() => setShowLoyaltyModal(false)}
                    >
                      <Text style={{ fontFamily: Fonts.bold, fontSize: 14, color: Theme.textSecondary }}>Close</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <TouchableOpacity
                        style={{ flex: 1, height: 48, borderRadius: 12, borderWidth: 1, borderColor: Theme.border, backgroundColor: Theme.bgMuted, justifyContent: "center", alignItems: "center" }}
                        onPress={() => setShowLoyaltyModal(false)}
                      >
                        <Text style={{ fontFamily: Fonts.bold, fontSize: 14, color: Theme.textSecondary }}>Close</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={{ flex: 2, flexDirection: "row", height: 48, borderRadius: 12, backgroundColor: isRegisteringLoyalty ? Theme.bgMuted : (Theme.success || "#16a34a"), justifyContent: "center", alignItems: "center", gap: 8, opacity: isRegisteringLoyalty ? 0.7 : 1 }}
                        onPress={handleLoyaltyRegister}
                        disabled={isRegisteringLoyalty}
                      >
                        {isRegisteringLoyalty ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Ionicons name="person-add-outline" size={18} color="#fff" />
                        )}
                        <Text style={{ fontFamily: Fonts.black, fontSize: 14, color: "#fff" }}>
                          {isRegisteringLoyalty ? "Registering..." : "Add Customer"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* COUNTRY PICKER MODAL */}
      <Modal transparent visible={showCountryPicker} animationType="fade">
        <TouchableWithoutFeedback onPress={() => setShowCountryPicker(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxWidth: 300, padding: 15 }]}>
              <Text style={[styles.modalTitle, { fontSize: 16, marginBottom: 15 }]}>Select Country</Text>
              {COUNTRIES.map((country) => (
                <TouchableOpacity
                  key={country.code}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 12,
                    paddingHorizontal: 8,
                    borderRadius: 8,
                    backgroundColor: selectedCountry.code === country.code ? Theme.bgNav : "transparent",
                    gap: 12
                  }}
                  onPress={() => {
                    setSelectedCountry(country);
                    setShowCountryPicker(false);
                    if (loyaltyCustomer) {
                      setLoyaltyCustomer(null);
                      setLoyaltyName("");
                    }
                  }}
                >
                  <Text style={{ fontSize: 20 }}>{country.flag}</Text>
                  <Text style={{ fontSize: 14, fontFamily: Fonts.bold, color: Theme.textPrimary }}>{country.code}</Text>
                  <Text style={{ fontSize: 13, fontFamily: Fonts.regular, color: Theme.textSecondary, flex: 1 }}>{country.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableWithoutFeedback>
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
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  headerBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 60,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    marginBottom: 5,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconBtn: {
    backgroundColor: Theme.bgMuted,
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 12,
    marginRight: 15,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  headerTitleContainer: {
    flex: 1,
  },
  title: {
    color: Theme.textPrimary,
    fontFamily: Fonts.black,
    fontSize: 16,
  },
  orderBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  typeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 9,
    fontFamily: Fonts.black,
  },
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
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    gap: 6,
  },
  actionBtnText: {
    fontFamily: Fonts.bold,
    fontSize: 12,
  },
  contextText: {
    color: Theme.primaryDark,
    fontFamily: Fonts.bold,
    fontSize: 12,
    marginTop: 2,
  },
  mainContent: {
    flex: 1,
  },
  mainContentLandscape: {
    flexDirection: "row",
    marginTop: 10,
  },
  listContainer: {
    flex: 1,
    marginTop: 10,
  },
  listContainerLandscape: {
    marginRight: 20,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.bgCard,
    paddingVertical: 15,
    paddingHorizontal: 15,
    borderRadius: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Theme.border,
    borderLeftWidth: 4,
    borderLeftColor: Theme.primary,
    gap: 15,
    ...Theme.shadowSm,
  },
  qtyBadge: {
    backgroundColor: Theme.primaryLight,
    borderRadius: 10,
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.primaryBorder,
  },
  qtyBadgeText: {
    color: Theme.primary,
    fontFamily: Fonts.black,
    fontSize: 16,
  },
  rowContent: {
    flex: 1,
  },
  name: {
    color: Theme.textPrimary,
    fontFamily: Fonts.extraBold,
    fontSize: 16,
    marginBottom: 4,
  },
  sub: {
    color: Theme.textSecondary,
    fontSize: 12,
    fontFamily: Fonts.medium,
  },
  textVoided: {
    textDecorationLine: "line-through",
    color: Theme.textMuted,
    opacity: 0.7,
  },
  priceBlock: {
    alignItems: "flex-end",
  },
  price: {
    color: Theme.textPrimary,
    fontFamily: Fonts.black,
    fontSize: 17,
  },
  itemTrashBtn: {
    padding: 8,
    backgroundColor: Theme.bgMuted,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.border,
    marginLeft: 10,
  },
  receiptContainer: {
    width: "100%",
  },
  receiptContainerLandscape: {
    width: 380,
  },
  receiptCard: {
    backgroundColor: Theme.bgCard,
    borderRadius: 24,
    padding: 24,
    marginTop: 10,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowLg,
  },
  receiptHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 15,
  },
  receiptHeaderText: {
    color: Theme.textPrimary,
    fontFamily: Fonts.black,
    fontSize: 16,
    flex: 1,
  },
  itemCountChip: {
    backgroundColor: Theme.bgMuted,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  itemCountChipText: {
    color: Theme.textSecondary,
    fontFamily: Fonts.bold,
    fontSize: 12,
  },
  receiptDivider: {
    height: 1,
    backgroundColor: Theme.border,
    marginBottom: 15,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  summaryLabel: {
    color: Theme.textSecondary,
    fontFamily: Fonts.semiBold,
    fontSize: 15,
  },
  summaryValue: {
    color: Theme.textPrimary,
    fontFamily: Fonts.extraBold,
    fontSize: 15,
  },
  dashedDivider: {
    height: 1,
    width: "100%",
    overflow: "hidden",
    marginVertical: 15,
  },
  dashLine: {
    borderStyle: "dashed",
    borderWidth: 1,
    margin: -1,
  },
  grandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  grandLabel: {
    color: Theme.textPrimary,
    fontFamily: Fonts.black,
    fontSize: 14,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  grandSub: {
    color: Theme.textMuted,
    fontFamily: Fonts.medium,
    fontSize: 11,
    marginTop: 2,
  },
  grandValue: {
    color: Theme.primary,
    fontFamily: Fonts.black,
    fontSize: 32,
  },
  gstBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    marginTop: 4,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: Theme.primaryLight,
    borderRadius: 8,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: Theme.primaryBorder,
  },
  gstBtnText: { color: Theme.primary, fontSize: 13, fontFamily: Fonts.bold },
  proceedBtn: {
    flexDirection: "row",
    backgroundColor: Theme.primary,
    height: 60,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 16,
    gap: 12,
    ...Theme.shadowMd,
  },
  proceedText: {
    color: "#fff",
    fontFamily: Fonts.black,
    fontSize: 18,
  },
  secondaryActionBtn: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  secondaryActionText: {
    fontFamily: Fonts.black,
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: Theme.bgCard,
    padding: 24,
    borderRadius: 24,
    width: "100%",
    maxWidth: 400,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowLg,
  },
  modalTitle: {
    color: Theme.textPrimary,
    fontSize: 22,
    fontFamily: Fonts.black,
    marginBottom: 8,
  },
  modalDesc: {
    color: Theme.textSecondary,
    fontSize: 14,
    marginBottom: 20,
    fontFamily: Fonts.regular,
  },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 15,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: Theme.bgMuted,
    gap: 12,
  },
  reasonRowSelected: {
    backgroundColor: Theme.primaryLight,
    borderWidth: 1,
    borderColor: Theme.primaryBorder,
  },
  reasonRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: Theme.border,
    justifyContent: "center",
    alignItems: "center",
  },
  reasonRadioSelected: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  reasonName: {
    color: Theme.textPrimary,
    fontSize: 15,
    fontFamily: Fonts.medium,
  },
  customReasonInput: {
    backgroundColor: Theme.bgInput,
    borderRadius: 12,
    padding: 15,
    color: Theme.textPrimary,
    fontSize: 15,
    marginTop: 10,
    minHeight: 80,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: Theme.border,
    fontFamily: Fonts.regular,
    ...Platform.select({
      web: {
        outlineStyle: "none",
      } as any,
    }),
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 15,
    marginTop: 25,
  },
  modalBtnCancel: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    backgroundColor: Theme.bgMuted,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  modalBtnTextCancel: {
    color: Theme.textPrimary,
    fontFamily: Fonts.bold,
  },
  modalBtnConfirm: {
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 12,
    minWidth: 100,
    alignItems: "center",
  },
  modalBtnTextConfirm: {
    color: "#fff",
    fontFamily: Fonts.bold,
  },
  serverSelector: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: Theme.bgMuted,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    minHeight: 50,
  },
  serverInfoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  serverIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  serverNameText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  serverItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 15,
    backgroundColor: Theme.bgCard,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Theme.border,
    gap: 15,
  },
  serverItemSelected: {
    borderColor: Theme.primary,
    backgroundColor: Theme.primaryLight,
  },
  serverAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  serverAvatarText: {
    fontFamily: Fonts.black,
    fontSize: 16,
  },
  serverItemName: {
    flex: 1,
    fontSize: 16,
    color: Theme.textPrimary,
    fontFamily: Fonts.medium,
  },
  billBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.primaryLight,
    paddingHorizontal: 15,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.primaryBorder,
    gap: 6,
    minHeight: 50,
  },
  billBtnText: {
    color: Theme.primary,
    fontFamily: Fonts.bold,
    fontSize: 14,
  },
  billOptionItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    backgroundColor: Theme.bgMuted,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    gap: 16,
  },
  billOptionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  billOptionText: {
    fontSize: 16,
    color: Theme.textPrimary,
    fontFamily: Fonts.extraBold,
  },
  splitItemRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    backgroundColor: Theme.bgCard,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  splitItemInfo: {
    flex: 1,
  },
  splitItemName: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    color: Theme.textPrimary,
  },
  splitItemPrice: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    color: Theme.textSecondary,
    marginTop: 2,
  },
  splitQtyControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: Theme.bgMuted,
    padding: 6,
    borderRadius: 10,
  },
  splitQtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
  },
  splitQtyText: {
    fontFamily: Fonts.black,
    fontSize: 14,
    minWidth: 20,
    textAlign: "center",
  },
  splitFooter: {
    marginTop: 20,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: Theme.border,
  },
  splitTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  splitTotalLabel: {
    fontFamily: Fonts.bold,
    fontSize: 16,
    color: Theme.textSecondary,
  },
  splitTotalValue: {
    fontFamily: Fonts.black,
    fontSize: 20,
    color: Theme.primary,
  },
  mergeItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 15,
    backgroundColor: Theme.bgCard,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Theme.border,
    gap: 15,
  },
  mergeItemSelected: {
    borderColor: Theme.primary,
    backgroundColor: Theme.primaryLight,
  },
  mergeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  mergeInfo: {
    flex: 1,
  },
  mergeTitle: {
    fontFamily: Fonts.bold,
    fontSize: 15,
    color: Theme.textPrimary,
  },
  mergeSub: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    color: Theme.textSecondary,
    marginTop: 2,
  },
  mergePrice: {
    fontFamily: Fonts.black,
    fontSize: 16,
    color: Theme.primary,
  },
  modalSubTitle: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: Theme.textSecondary,
    marginTop: 2,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.bgMuted,
    paddingHorizontal: 12,
    borderRadius: 12,
    height: 48,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontFamily: Fonts.medium,
    fontSize: 15,
    color: Theme.textPrimary,
  },
  searchResults: {
    marginTop: 8,
    backgroundColor: Theme.bgCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    overflow: "hidden",
  },
  searchResultItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
  },
  searchResultName: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    color: Theme.textPrimary,
  },
  searchResultPrice: {
    fontFamily: Fonts.black,
    fontSize: 14,
    color: Theme.primary,
  },
  sectionLabel: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    color: Theme.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  // ── Custom Merge Confirm Modal ──────────────────────────────────────────
  mergeConfirmOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  mergeConfirmBox: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 28,
    alignItems: "center",
    ...Theme.shadowLg,
  },
  mergeConfirmIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Theme.primaryLight,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
    borderWidth: 2,
    borderColor: Theme.primaryBorder,
  },
  mergeConfirmTitle: {
    fontFamily: Fonts.black,
    fontSize: 22,
    color: Theme.textPrimary,
    marginBottom: 10,
    textAlign: "center",
  },
  mergeConfirmDesc: {
    fontFamily: Fonts.medium,
    fontSize: 15,
    color: Theme.textSecondary,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 28,
  },
  mergeConfirmBtnRow: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  mergeConfirmBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 14,
    minHeight: 50,
  },
  mergeConfirmBtnCancel: {
    backgroundColor: Theme.bgMuted,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  mergeConfirmBtnCancelText: {
    fontFamily: Fonts.black,
    fontSize: 15,
    color: Theme.textPrimary,
  },
  mergeConfirmBtnPrimary: {
    backgroundColor: Theme.primary,
  },
  mergeConfirmBtnPrimaryText: {
    fontFamily: Fonts.black,
    fontSize: 15,
    color: "#fff",
  },
  mergeFooter: {
    borderTopWidth: 1,
    borderColor: Theme.border,
    paddingTop: 15,
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  mergeActionBtn: {
    backgroundColor: Theme.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    gap: 8,
    flex: 1,
  },
  mergeActionBtnDisabled: {
    backgroundColor: Theme.border,
    opacity: 0.6,
  },
  mergeActionBtnText: {
    fontFamily: Fonts.bold,
    fontSize: 16,
    color: "#fff",
  },
  modeToggleBar: {
    flexDirection: "row",
    backgroundColor: Theme.bgNav,
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  modeToggleBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 8,
  },
  activeModeToggleBtn: {
    backgroundColor: Theme.bgCard,
    ...Theme.shadowSm,
  },
  modeToggleText: {
    fontSize: 10,
    fontFamily: Fonts.black,
    color: Theme.textMuted,
  },
  activeModeToggleText: {
    color: Theme.primary,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Theme.bgMuted,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  activeChip: { backgroundColor: Theme.primary, borderColor: Theme.primary },
  chipText: {
    color: Theme.textSecondary,
    fontFamily: Fonts.bold,
    fontSize: 12,
  },
  activeChipText: { color: "#fff" },
});
