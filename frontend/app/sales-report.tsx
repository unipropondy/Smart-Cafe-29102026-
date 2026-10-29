import { API_URL } from "@/constants/Config";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfYear, endOfYear } from "date-fns";
import { BlurView } from "expo-blur";
import * as FileSystemLegacy from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
  Alert,
  Switch,
} from "react-native";
import { PieChart } from "react-native-gifted-charts";
import { SafeAreaView } from "react-native-safe-area-context";
import BillPrompt from "../components/BillPrompt";
import CalendarPicker from "../components/CalendarPicker";
import { useToast } from "../components/Toast";
import TransactionCard from "../components/TransactionCard";
import UniversalPrinter from "../components/UniversalPrinter";
import { Fonts } from "../constants/Fonts";
import { Theme } from "../constants/theme";
import { getSingaporeDateString, parseDatabaseDate, formatToSingaporeDate } from "../utils/timezoneHelper";
import { useAuthStore } from "../stores/authStore";

type FilterType = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | "CUSTOM";
type DetailReportType = "CATEGORY" | "DISH" | "SETTLEMENT" | "ARTIST_TARGET";
type EmailValidationResult = {
  normalized: string;
  isValid: boolean;
  error?: string;
  suggestion?: string;
};

const parseLocalDate = (dateStr: string | null | undefined): Date => {
  if (!dateStr) return new Date();
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    return new Date(year, month, day);
  }
  return new Date(dateStr);
};

const formatDateDMY = (dateStr: string | null | undefined): string => {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
};

const getTodayDateStr = (): string => getSingaporeDateString(new Date());

const calculatePeriodRange = (
  filter: FilterType,
  refDateStr: string,
  maxAllowedDateStr?: string
): { startDate: string; endDate: string } => {
  const maxDateStr = maxAllowedDateStr || getTodayDateStr();
  const ref = parseLocalDate(refDateStr);

  if (filter === "DAILY") {
    const clampedDate = refDateStr > maxDateStr ? maxDateStr : refDateStr;
    return { startDate: clampedDate, endDate: clampedDate };
  }

  if (filter === "WEEKLY") {
    const startObj = startOfWeek(ref, { weekStartsOn: 1 });
    const endObj = endOfWeek(ref, { weekStartsOn: 1 });
    const startStr = format(startObj, "yyyy-MM-dd");
    let endStr = format(endObj, "yyyy-MM-dd");

    if (endStr > maxDateStr) {
      endStr = maxDateStr;
    }
    const finalStart = startStr > maxDateStr ? maxDateStr : startStr;
    const finalEnd = endStr < finalStart ? finalStart : endStr;
    return { startDate: finalStart, endDate: finalEnd };
  }

  if (filter === "MONTHLY") {
    const startObj = startOfMonth(ref);
    const endObj = endOfMonth(ref);
    const startStr = format(startObj, "yyyy-MM-dd");
    let endStr = format(endObj, "yyyy-MM-dd");

    if (endStr > maxDateStr) {
      endStr = maxDateStr;
    }
    const finalStart = startStr > maxDateStr ? maxDateStr : startStr;
    const finalEnd = endStr < finalStart ? finalStart : endStr;
    return { startDate: finalStart, endDate: finalEnd };
  }

  if (filter === "YEARLY") {
    const startObj = startOfYear(ref);
    const endObj = endOfYear(ref);
    const startStr = format(startObj, "yyyy-MM-dd");
    let endStr = format(endObj, "yyyy-MM-dd");

    if (endStr > maxDateStr) {
      endStr = maxDateStr;
    }
    const finalStart = startStr > maxDateStr ? maxDateStr : startStr;
    const finalEnd = endStr < finalStart ? finalStart : endStr;
    return { startDate: finalStart, endDate: finalEnd };
  }

  return { startDate: refDateStr, endDate: refDateStr };
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const COMMON_EMAIL_DOMAINS = [
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "protonmail.com",
];
const KNOWN_DOMAIN_TYPOS: Record<string, string> = {
  "gamil.com": "gmail.com",
  "gmial.com": "gmail.com",
  "yaho.com": "yahoo.com",
  "yhoo.com": "yahoo.com",
  "outlok.com": "outlook.com",
  "outllok.com": "outlook.com",
  "hotnail.com": "hotmail.com",
};

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost,
      );
    }
  }
  return dp[m]![n]!;
}

function suggestEmailDomain(email: string): string | undefined {
  const at = email.indexOf("@");
  if (at <= 0 || at === email.length - 1) return undefined;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (COMMON_EMAIL_DOMAINS.includes(domain)) return undefined;
  if (KNOWN_DOMAIN_TYPOS[domain]) return `${local}@${KNOWN_DOMAIN_TYPOS[domain]}`;
  let bestDomain = "";
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of COMMON_EMAIL_DOMAINS) {
    const distance = levenshteinDistance(domain, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestDomain = candidate;
    }
  }
  if (!bestDomain || bestDistance > 2) return undefined;
  return `${local}@${bestDomain}`;
}

function validateRecipientEmail(raw: string): EmailValidationResult {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return { normalized, isValid: false, error: "Email address is required." };
  }
  const at = normalized.indexOf("@");
  const domain = at > 0 ? normalized.slice(at + 1) : "";
  if (KNOWN_DOMAIN_TYPOS[domain]) {
    return {
      normalized,
      isValid: false,
      error: "Email domain looks misspelled.",
      suggestion: `${normalized.slice(0, at)}@${KNOWN_DOMAIN_TYPOS[domain]}`,
    };
  }
  if (!EMAIL_REGEX.test(normalized)) {
    return {
      normalized,
      isValid: false,
      error: "Please enter a valid email address.",
      suggestion: suggestEmailDomain(normalized),
    };
  }
  return {
    normalized,
    isValid: true,
    suggestion: suggestEmailDomain(normalized),
  };
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function SalesReport() {
  const router = useRouter();
  const { showToast } = useToast();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const isSalesReportUser = user?.userGroupId === "DFCF23EE-F6F4-4885-8D26-0056C657595F";
  const { width: SCREEN_W } = useWindowDimensions();
  const [breakdownRowWidth, setBreakdownRowWidth] = useState(0);
  const [sales, setSales] = useState<any[]>([]);
  const [dbPaymentModes, setDbPaymentModes] = useState<any[]>([
    { payMode: "CASH", description: "CASH" },
    { payMode: "CARD", description: "CARD" },
    { payMode: "NETS", description: "NETS" },
    { payMode: "PAYNOW", description: "PAY NOW" },
    { payMode: "YEAHPAY PAYNOW", description: "YEAHPAY PAYNOW" },
    { payMode: "YEAHPAY CARD", description: "YEAHPAY CARD" },
    { payMode: "GRAB", description: "GRAB" },
    { payMode: "FOODPANDA", description: "FOODPANDA" },
    { payMode: "MEMBER", description: "MEMBER" },
    { payMode: "CREDIT", description: "CREDIT" },
  ]);
  const [summary, setSummary] = useState<any>(null);
  const todayDate = getSingaporeDateString();
  const [selectedDate, setSelectedDate] = useState(todayDate);
  const [activeBusinessDate, setActiveBusinessDate] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<FilterType>("DAILY");
  const [, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [orderDetails, setOrderDetails] = useState<any[]>([]);
  const [orderPayments, setOrderPayments] = useState<any[]>([]);
  const [orderRewards, setOrderRewards] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [activePaymentModes, setActivePaymentModes] = useState<string[]>([
    "CASH",
    "CARD",
    "NETS",
    "PAYNOW",
    "YEAHPAY PAYNOW",
    "YEAHPAY CARD",
    "GRAB",
    "FOODPANDA",
    "VOID",
    "MEMBER",
    "CREDIT",
  ]);
  const [activeOrderTypes, setActiveOrderTypes] = useState<string[]>([
    "DINE-IN",
    "TAKEAWAY",
  ]);
  const [sortOrder, setSortOrder] = useState<"NEWEST" | "HIGHEST">("NEWEST");
  const [detailReportType, setDetailReportType] =
    useState<DetailReportType | null>(null);
  const [categoryReport, setCategoryReport] = useState<any[]>([]);
  const [dishReport, setDishReport] = useState<any[]>([]);
  const [settlementReport, setSettlementReport] = useState<any[]>([]);
  const [artistTargetReport, setArtistTargetReport] = useState<any[]>([]);
  const [selectedCashierId, setSelectedCashierId] = useState<string>("ALL");
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [operatorsList, setOperatorsList] = useState<any[]>([]);

  const availableOperators = useMemo(() => {
    if (operatorsList.length > 0) return operatorsList;
    const map = new Map();
    sales.forEach((s) => {
      if (s.CashierId && !map.has(String(s.CashierId))) {
        map.set(String(s.CashierId), {
          CashierId: String(s.CashierId),
          CashierName: s.UserName || s.CashierName || `User ${s.CashierId}`,
          UserLogin: s.UserLogin || "-",
          RoleName: s.RoleName || "Cashier",
          TotalSales: 0,
        });
      }
    });
    return Array.from(map.values());
  }, [operatorsList, sales]);

  const [loadingReport, setLoadingReport] = useState(false);
  const [showPrintPrompt, setShowPrintPrompt] = useState(false);
  const [isReprinting, setIsReprinting] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [pickerMode, setPickerMode] = useState<"SINGLE" | "START" | "END">(
    "SINGLE",
  );
  const [showCancelledOrders, setShowCancelledOrders] = useState(true);

  // Computes the active start and end dates based on current filter & selected date
  const effectiveDateRange = useMemo(() => {
    const maxDateStr = activeBusinessDate || getTodayDateStr();
    if (selectedFilter === "DAILY") {
      const d = selectedDate > maxDateStr ? maxDateStr : selectedDate;
      return {
        startDate: d,
        endDate: d,
      };
    }
    if (rangeStart && rangeEnd) {
      const clampedEnd = rangeEnd > maxDateStr ? maxDateStr : rangeEnd;
      return {
        startDate: rangeStart,
        endDate: clampedEnd,
      };
    }
    return calculatePeriodRange(selectedFilter, selectedDate, maxDateStr);
  }, [selectedFilter, selectedDate, rangeStart, rangeEnd, activeBusinessDate]);

  const isAtLatestPeriod = useMemo(() => {
    const maxDateStr = activeBusinessDate || getTodayDateStr();
    if (selectedFilter === "DAILY") {
      return selectedDate >= maxDateStr;
    }
    return effectiveDateRange.endDate >= maxDateStr;
  }, [selectedFilter, selectedDate, effectiveDateRange, activeBusinessDate]);

  useEffect(() => {
    const maxDateStr = activeBusinessDate || getTodayDateStr();
    const { startDate, endDate } = calculatePeriodRange(selectedFilter, selectedDate, maxDateStr);
    setRangeStart(startDate);
    setRangeEnd(endDate);
  }, [selectedFilter, selectedDate, activeBusinessDate]);

  // --- ORDER SETTINGS & DIALOG STATES ---
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [showChangePaymentModal, setShowChangePaymentModal] = useState(false);
  const [showVoidItemModal, setShowVoidItemModal] = useState(false);
  const [showVoidItemConfirm, setShowVoidItemConfirm] = useState(false);
  const [selectedVoidItemIds, setSelectedVoidItemIds] = useState<string[]>([]);
  const [itemToVoid, setItemToVoid] = useState<any>(null);
  const [showCancelOrderConfirm, setShowCancelOrderConfirm] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  
  // Split payment mode in Change Payment Modal
  const [isSplitMode, setIsSplitMode] = useState(false);
  const [selectedGridMode, setSelectedGridMode] = useState<string>("");
  const [changePaymentSplits, setChangePaymentSplits] = useState<{ payMode: string; amount: string }[]>([]);

  // Member selection states for payment change
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [isMemberSearch, setIsMemberSearch] = useState(true); // true for MEMBER, false for CREDIT
  const [memberQuery, setMemberQuery] = useState("");
  const [membersList, setMembersList] = useState<any[]>([]);
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [selectedMemberForPay, setSelectedMemberForPay] = useState<any | null>(null);
  const [selectedCreditForPay, setSelectedCreditForPay] = useState<any | null>(null);
  const [currentSelectionStep, setCurrentSelectionStep] = useState<"MEMBER" | "CREDIT" | null>(null);
  const [activeModalSelection, setActiveModalSelection] = useState<any | null>(null);
  const [pendingPayMode, setPendingPayMode] = useState<string | null>(null);
  const [pendingSplits, setPendingSplits] = useState<any[] | null>(null);

  const searchMembers = async (q: string, isMemberType: boolean) => {
    try {
      setSearchingMembers(true);
      const url = isMemberType
        ? `${API_URL}/api/members/search?query=${encodeURIComponent(q)}`
        : `${API_URL}/api/credit-customers/search?query=${encodeURIComponent(q)}`;
      const res = await fetch(url);
      const data = await res.json();
      setMembersList(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Search error:", err);
    } finally {
      setSearchingMembers(false);
    }
  };

  useEffect(() => {
    if (showMemberModal) {
      searchMembers(memberQuery, isMemberSearch);
    }
  }, [memberQuery, showMemberModal, isMemberSearch]);

  // Supervisor Password Verification State
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordValue, setPasswordValue] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordAction, setPasswordAction] = useState<{
    onSuccess: () => void;
    title: string;
    description: string;
    role: string;
  } | null>(null);

  const promptPassword = (title: string, description: string, role: string, onSuccess: () => void) => {
    setPasswordValue("");
    setPasswordError("");
    setPasswordAction({ onSuccess, title, description, role });
    setShowPasswordModal(true);
  };

  const finalBillAmount = selectedOrder
    ? Number(selectedOrder.SubTotal || 0) -
      Number(selectedOrder.DiscountAmount || 0) +
      Number(selectedOrder.ServiceCharge || 0) +
      Number(selectedOrder.TakeawayCharge || 0) +
      Number(selectedOrder.TotalTax || 0)
    : 0;

  const allocatedSplitsSum = useMemo(() => {
    return changePaymentSplits.reduce((sum, s) => sum + (parseFloat(s.amount) || 0), 0);
  }, [changePaymentSplits]);

  const remainingSplitsBalance = useMemo(() => {
    return finalBillAmount - allocatedSplitsSum;
  }, [finalBillAmount, allocatedSplitsSum]);

  // --- DOWNLOAD MODAL STATES ---
  const [showDownloadPanel, setShowDownloadPanel] = useState(false);
  const [downloadFilter, setDownloadFilter] = useState<FilterType>("DAILY");
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadRangeStart, setDownloadRangeStart] = useState<string | null>(null);
  const [downloadRangeEnd, setDownloadRangeEnd] = useState<string | null>(null);
  const [showDownloadDatePicker, setShowDownloadDatePicker] = useState(false);
  const [downloadPickerMode, setDownloadPickerMode] = useState<"START" | "END">("START");
  const [emailAddress, setEmailAddress] = useState("");
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailFieldTouched, setEmailFieldTouched] = useState(false);
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);

  const emailValidation = useMemo(
    () => validateRecipientEmail(emailAddress),
    [emailAddress],
  );
  const showEmailValidationError =
    emailFieldTouched && !!emailAddress && !emailValidation.isValid;

  useEffect(() => {
    const loadState = async () => {
      try {
        const savedFilter = await AsyncStorage.getItem("sales_selected_filter");
        const savedModes = await AsyncStorage.getItem("sales_payment_modes");
        const savedTypes = await AsyncStorage.getItem("sales_order_types");
        const savedSort = await AsyncStorage.getItem("sales_sort_order");
        const savedDownloadFilter = await AsyncStorage.getItem("sales_download_filter");
        const savedBusinessDate = await AsyncStorage.getItem("selected_business_date");

        if (savedBusinessDate) {
          setSelectedDate(savedBusinessDate);
          setActiveBusinessDate(savedBusinessDate);
        }

        if (savedFilter && ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(savedFilter)) {
          setSelectedFilter(savedFilter as FilterType);
        }
        const savedDate = await AsyncStorage.getItem("sales_selected_date");
        if (savedDate) {
          setSelectedDate(savedDate);
        }
        const savedRangeStart = await AsyncStorage.getItem("sales_range_start");
        const savedRangeEnd = await AsyncStorage.getItem("sales_range_end");
        if (savedRangeStart) setRangeStart(savedRangeStart);
        if (savedRangeEnd) setRangeEnd(savedRangeEnd);

        const savedCashier = await AsyncStorage.getItem("sales_cashier_id");
        if (savedCashier) setSelectedCashierId(savedCashier);

        if (
          savedDownloadFilter &&
          ["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "CUSTOM"].includes(savedDownloadFilter)
        ) {
          setDownloadFilter(savedDownloadFilter as FilterType);
        }
        if (savedModes) setActivePaymentModes(JSON.parse(savedModes));
        if (savedTypes) setActiveOrderTypes(JSON.parse(savedTypes));
        if (savedSort) setSortOrder(savedSort as "NEWEST" | "HIGHEST");

        try {
          const res = await fetch(`${API_URL}/api/settlement/active-day`);
          const data = await res.json();
          if (data.success && data.active && data.startDate) {
            setActiveBusinessDate(data.startDate);
            if (!savedDate) {
              setSelectedDate(data.startDate);
            }
            await AsyncStorage.setItem("selected_business_date", data.startDate);
          } else {
            setActiveBusinessDate(null);
            await AsyncStorage.removeItem("selected_business_date");
          }
        } catch (err) {
          console.error("Failed to fetch active business day:", err);
        }
      } catch (e) {
        console.error("Load state error:", e);
      }
    };
    loadState();
  }, []);

  useEffect(() => {
    if (activeBusinessDate && !selectedDate) {
      setSelectedDate(activeBusinessDate);
    }
  }, [activeBusinessDate]);

  useEffect(() => {
    if (!showVoidItemModal) {
      setSelectedVoidItemIds([]);
    }
  }, [showVoidItemModal]);

  useEffect(() => {
    if (!showChangePaymentModal) {
      setIsSplitMode(false);
      setChangePaymentSplits([]);
    }
  }, [showChangePaymentModal]);

  useEffect(() => {
    const saveState = async () => {
      try {
        await AsyncStorage.setItem("sales_selected_filter", selectedFilter);
        await AsyncStorage.setItem("sales_selected_date", selectedDate);
        if (rangeStart) await AsyncStorage.setItem("sales_range_start", rangeStart);
        if (rangeEnd) await AsyncStorage.setItem("sales_range_end", rangeEnd);
        await AsyncStorage.setItem("sales_cashier_id", selectedCashierId);
        await AsyncStorage.setItem("sales_download_filter", downloadFilter);
        await AsyncStorage.setItem("sales_payment_modes", JSON.stringify(activePaymentModes));
        await AsyncStorage.setItem("sales_order_types", JSON.stringify(activeOrderTypes));
        await AsyncStorage.setItem("sales_sort_order", sortOrder);
      } catch (e) {
        console.error("Save state error:", e);
      }
    };
    saveState();
  }, [selectedFilter, selectedDate, rangeStart, rangeEnd, selectedCashierId, downloadFilter, activePaymentModes, activeOrderTypes, sortOrder]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, [selectedDate, selectedFilter, rangeStart, rangeEnd])
  );

  const fetchPaymentMethods = async () => {
    try {
      const res = await fetch(`${API_URL}/api/sales/payment-methods`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setDbPaymentModes(data);
        const stored = await AsyncStorage.getItem("sales_payment_modes");
        const defaultModes = data.map((m: any) => m.payMode.toUpperCase().trim());
        if (!defaultModes.includes("VOID")) {
          defaultModes.push("VOID");
        }
        if (stored) {
          try {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const merged = [...parsed];
              defaultModes.forEach(mode => {
                if (!merged.includes(mode)) {
                  merged.push(mode);
                }
              });
              setActivePaymentModes((prev) => {
                if (JSON.stringify(prev) === JSON.stringify(merged)) return prev;
                return merged;
              });
              return;
            }
          } catch (e) {}
        }
        setActivePaymentModes((prev) => {
          if (JSON.stringify(prev) === JSON.stringify(defaultModes)) return prev;
          return defaultModes;
        });
      }
    } catch (error) {
      console.error("Failed to fetch payment methods in report:", error);
    }
  };

  const fetchOperators = async () => {
    try {
      const { startDate: startStr, endDate: endStr } = effectiveDateRange;
      const res = await fetch(
        `${API_URL}/api/reports/login-wise-sales?filter=${selectedFilter.toLowerCase()}&date=${selectedDate}&startDate=${startStr}&endDate=${endStr}`
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setOperatorsList(data);
        }
      }
    } catch (e) {
      console.error("Failed to fetch operators list:", e);
    }
  };

  const fetchData = async () => {
    try {
      if (sales.length === 0) setLoading(true);

      try {
        const res = await fetch(`${API_URL}/api/settlement/active-day`);
        const data = await res.json();
        if (data.success && data.active && data.startDate) {
          setActiveBusinessDate(data.startDate);
          if (selectedDate === todayDate && selectedDate !== data.startDate) {
            setSelectedDate(data.startDate);
            return;
          }
        } else {
          setActiveBusinessDate(null);
        }
      } catch (err) {
        console.error("Failed to fetch active business day in fetchData:", err);
      }

      await Promise.all([
        fetchSales(), 
        fetchSummary(), 
        fetchPaymentMethods(),
        fetchOperators(),
        detailReportType ? fetchDetailReport(detailReportType, selectedFilter) : Promise.resolve()
      ]);
    } catch (error) {
      console.error("Error:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchDetailReport = useCallback(
    async (reportType: DetailReportType, filterType = selectedFilter) => {
      try {
        setLoadingReport(true);
        const reportFilter = filterType.toLowerCase();
        const { startDate: startStr, endDate: endStr } = effectiveDateRange;
        const params = new URLSearchParams({
          filter: reportFilter,
          date: selectedDate,
          startDate: startStr,
          endDate: endStr,
          t: Date.now().toString(),
        });

        const endpoint =
          reportType === "CATEGORY"
            ? "category"
            : reportType === "DISH"
              ? "dish"
              : reportType === "ARTIST_TARGET"
                ? "artist-target"
                : "settlement";
        console.log("[SalesReport] Fetching report", {
          reportType,
          filterType: reportFilter,
        });
        const token = useAuthStore.getState().token;
        const response = await fetch(
          `${API_URL}/api/reports/${endpoint}?${params.toString()}`,
          {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          }
        );

        if (!response.ok) {
          throw new Error(`Unable to load ${endpoint} report`);
        }

        const data = await response.json();
        console.log("[SalesReport] API response", {
          reportType,
          filterType: reportFilter,
          rows: Array.isArray(data) ? data.length : 0,
          data,
        });

         if (reportType === "CATEGORY") {
          setCategoryReport(
            Array.isArray(data)
              ? data.map((row: any) => ({
                CategoryName:
                  row.categoryName || row.CategoryName || "Unmapped",
                Sold: row.totalQty ?? row.totalQuantitySold ?? 0,
                Voided: row.voidQty ?? 0,
                DiscountAmount: row.discountAmount ?? 0,
                TakeawayCharge: row.takeawayCharge ?? 0,
                SalesAmount: row.totalAmount ?? row.totalSalesAmount ?? 0,
              }))
              : [],
          );
          setDishReport([]);
          setSettlementReport([]);
          setArtistTargetReport([]);
        } else if (reportType === "DISH") {
          setDishReport(
            Array.isArray(data)
              ? data.map((row: any) => ({
                DishName: row.dishName || row.DishName || "Unknown Dish",
                CategoryName:
                  row.categoryName || row.CategoryName || "Unmapped",
                SubCategoryName:
                  row.subCategoryName || row.SubCategoryName || "Unmapped",
                Sold: row.totalQty ?? row.quantitySold ?? 0,
                Voided: row.voidQty ?? 0,
                DiscountAmount: row.discountAmount ?? 0,
                TakeawayCharge: row.takeawayCharge ?? 0,
                SalesAmount: row.totalAmount ?? row.totalSalesAmount ?? 0,
              }))
              : [],
          );
          setCategoryReport([]);
          setSettlementReport([]);
          setArtistTargetReport([]);
        } else if (reportType === "ARTIST_TARGET") {
          setArtistTargetReport(
            Array.isArray(data)
              ? data.map((row: any) => ({
                CustomerName: row.CustomerName || "Unknown Artist",
                Amount: row.Amount ?? 0,
                FromDate: row.FromDate,
                ToDate: row.ToDate,
                TargetAmount: row.TargetAmount ?? 0,
                Achieved: row.Achieved ?? 0,
                Left: row.Left ?? 0,
                Status: row.Status || "Not Achieved",
              }))
              : [],
          );
          setCategoryReport([]);
          setDishReport([]);
          setSettlementReport([]);
        } else {
          setSettlementReport(
            Array.isArray(data)
              ? data.map((row: any) => ({
                Paymode: row.Paymode || "Unknown",
                SysAmount: row.SysAmount ?? 0,
                ManualAmount: row.ManualAmount ?? 0,
                SortageOrExces: row.SortageOrExces ?? 0,
                ReceiptCount: row.ReceiptCount ?? 0,
              }))
              : [],
          );
          setCategoryReport([]);
          setDishReport([]);
          setArtistTargetReport([]);
        }
      } catch (error) {
        console.error("Detail report fetch error:", error);
        setCategoryReport([]);
        setDishReport([]);
        setSettlementReport([]);
        setArtistTargetReport([]);
      } finally {
        setLoadingReport(false);
      }
    },
    [selectedFilter, selectedDate, effectiveDateRange],
  );

  const handleReportPress = (reportType: DetailReportType) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (detailReportType === reportType) {
      fetchDetailReport(reportType);
      return;
    }
    setDetailReportType(reportType);
  };

  useEffect(() => {
    if (detailReportType) {
      fetchDetailReport(detailReportType, selectedFilter);
    }
  }, [selectedFilter, selectedDate, detailReportType, fetchDetailReport]);

  const fetchSales = async () => {
    try {
      const { startDate: startStr, endDate: endStr } = effectiveDateRange;
      const token = useAuthStore.getState().token;
      const response = await fetch(`${API_URL}/api/sales/all?startDate=${startStr}&endDate=${endStr}`, {
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!response.ok) throw new Error("Failed to fetch sales");
      const data = await response.json();
      if (Array.isArray(data)) {
        setSales(data);
      } else {
        setSales([]);
      }
    } catch (error) {
      console.error("Sales fetch error:", error);
      setSales([]);
    }
  };

  const fetchSummary = async () => {
    try {
      const { startDate: startStr, endDate: endStr } = effectiveDateRange;
      const token = useAuthStore.getState().token;
      const url = `${API_URL}/api/sales/range?startDate=${startStr}&endDate=${endStr}`;
      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await response.json();
      setSummary(Array.isArray(data) ? data[0] : data);
    } catch (error) {
      console.error("Summary fetch error:", error);
      setSummary(null);
    }
  };

  const fetchReportData = async () => {
    const endObj = new Date();
    const startObj = new Date();

    if (downloadFilter === "DAILY") {
      // Use the active business date (e.g. 2026-09-29), not today's calendar date,
      // because settlement data is keyed to the business day, not the wall clock date.
      const bizDate = activeBusinessDate || getSingaporeDateString(new Date());
      startObj.setTime(new Date(bizDate).getTime());
      endObj.setTime(new Date(bizDate).getTime());
    } else if (downloadFilter === "WEEKLY") {
      startObj.setDate(startObj.getDate() - 6);
    } else if (downloadFilter === "MONTHLY") {
      startObj.setDate(1);
      const today = new Date();
      const endOfMonth = new Date(endObj.getFullYear(), endObj.getMonth() + 1, 0);
      if (endOfMonth > today) {
        endObj.setTime(today.getTime());
      } else {
        endObj.setTime(endOfMonth.getTime());
      }
    } else if (downloadFilter === "YEARLY") {
      startObj.setFullYear(startObj.getFullYear() - 1);
    } else if (downloadFilter === "CUSTOM" && downloadRangeStart && downloadRangeEnd) {
      startObj.setTime(new Date(downloadRangeStart).getTime());
      endObj.setTime(new Date(downloadRangeEnd).getTime());
    }

    const startStr = getSingaporeDateString(startObj);
    const endStr = getSingaporeDateString(endObj);

    const userName = await AsyncStorage.getItem("userName") || "SR";
    const token = useAuthStore.getState().token;
    const authHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const summaryUrl = `${API_URL}/api/sales/day-end-summary?startDate=${startStr}&endDate=${endStr}`;
    const summaryRes = await fetch(summaryUrl, { headers: authHeaders });
    const summaryData = await summaryRes.json();

    if (!summaryData.success) {
      console.warn("[fetchReportData] day-end-summary returned non-success:", summaryData?.error || summaryRes.status);
      // Don't throw — fall through with empty summaryData so the backend PDF generator still runs
    }

    // We fetch dish report for item-wise data
    let items: any[] = [];
    try {
      const dishFilter = downloadFilter === "CUSTOM" ? "daily" : downloadFilter.toLowerCase();
      const dRes = await fetch(`${API_URL}/api/reports/dish?filter=${dishFilter}&date=${startStr}`, { headers: authHeaders });
      const dData = await dRes.json();
      if (Array.isArray(dData)) {
        items = dData.map((d: any) => ({
          name: d.dishName || d.DishName,
          quantity: d.totalQty,
          price: d.totalAmount / (d.totalQty || 1),
          revenue: d.totalAmount,
          category: d.categoryName || d.CategoryName || "Unmapped",
          subcategory: d.subCategoryName || d.SubCategoryName || "Unmapped",
          voidQty: d.voidQty || 0,
        }));
      }
    } catch (e) {
      console.warn("Failed to fetch item wise data for report", e);
    }

    const paymentBreakdown: any[] = [];
    let memberPaymentsCollected = 0;
    let creditPaymentsCollected = 0;
    // Track credit *sales* (deferred revenue — not yet collected at point of sale)
    // so they can be excluded from Total Collections to prevent double-counting
    // when the same credit bill is also paid within the report period.
    let creditSalesTotal = 0;
    summaryData.paymodeDetail?.forEach((p: any) => {
      const paymodeName = String(p.Paymode || 'CASH').toUpperCase();
      if (paymodeName.startsWith('MEMBER PAYMENT')) {
        memberPaymentsCollected += p.Amount || 0;
        paymentBreakdown.push({
          name: p.Paymode,
          qty: p.ReceiptCount || 0,
          amount: p.Amount || 0
        });
      } else if (paymodeName.startsWith('CREDIT PAYMENT')) {
        creditPaymentsCollected += p.Amount || 0;
        paymentBreakdown.push({
          name: p.Paymode,
          qty: p.ReceiptCount || 0,
          amount: p.Amount || 0
        });
      } else {
        // Capture credit sales (paymode = 'CREDIT') separately
        if (paymodeName === 'CREDIT') {
          creditSalesTotal += p.Amount || 0;
        }
        paymentBreakdown.push({
          name: p.Paymode,
          qty: p.ReceiptCount || 0,
          amount: p.Amount || 0
        });
      }
    });

    const sa = summaryData.salesAnalysis || {};
    const vd = summaryData.voidDetail || {};

    const selectedUserObj = availableOperators.find(op => String(op.CashierId) === String(selectedCashierId));
    const formattedCashierName = selectedCashierId === "ALL"
      ? "Whole Sales (All Users)"
      : (selectedUserObj
          ? `${selectedUserObj.CashierName || ''} ${selectedUserObj.UserLogin && selectedUserObj.UserLogin !== '-' ? `(@${selectedUserObj.UserLogin})` : ''}`.trim()
          : String(selectedCashierId));

    return {
      filterType: downloadFilter,
      period: downloadFilter === "DAILY" ? startStr : `${startStr} to ${endStr}`,
      companyName: summaryData.orgInfo?.Name || 'AL-HAZIMA RESTAURANT PTE LTD',
      companyAddress: summaryData.orgInfo?.Address1_Line1 || 'No 4, Cheong Chin Nam Road, SINGAPORE 599729',
      companyPhone: summaryData.orgInfo?.Address1_Telephone1 || '65130000',
      selectedCashierId,
      cashierName: formattedCashierName,
      printedBy: userName,

      // Match backend generatePdfDocDefinition expectations
      netSales: sa.baseSales || 0,
      serviceCharge: sa.totalServiceCharge || 0,
      taxCollected: sa.totalTax || 0,
      roundedBy: sa.roundOff || 0,
      totalRevenue: sa.totalSales || 0,
      totalSales: sa.totalSales || 0,
      focSales: sa.focSales || 0,
      totalDiscount: sa.totalDiscount || 0,
      memberPaymentsCollected: Number(memberPaymentsCollected),
      creditPaymentsCollected: Number(creditPaymentsCollected),
      // Total Collections = actual cash/card received.
      // Credit *sales* are deferred revenue (not collected at point of sale),
      // so subtract them before adding credit payment collections.
      totalCollections: (Number(sa.totalSales || 0) - creditSalesTotal - Number(sa.focSales || 0)) + Number(memberPaymentsCollected) + Number(creditPaymentsCollected),

      totalOrders: sa.billCount || 0,
      totalItems: items.reduce((acc, curr) => acc + curr.quantity, 0),

      voidQty: vd.voidQty || 0,
      voidAmount: vd.voidAmount || 0,

      cancelledCount: summaryData.cancelledDetail?.count || 0,
      cancelledAmount: summaryData.cancelledDetail?.amount || 0,

      paymentBreakdown,
      cancelledOrders: summaryData.cancelledOrders || [],
      items: items.length > 0 ? items.map(i => ({
        name: i.name,
        qty: i.quantity,
        amount: i.revenue,
        category: i.category,
        subcategory: i.subcategory,
        voidQty: i.voidQty,
      })) : undefined
    };
  };

  const handleDownloadPdf = async () => {
    try {
      setIsDownloading(true);
      const reportData = await fetchReportData();
      const filename = `Sales_Report_${downloadFilter}_${format(new Date(), "yyyy-MM-dd")}.pdf`;

      const response = await fetch(`${API_URL}/api/export/download-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportData }),
      });
      if (!response.ok) throw new Error("Failed to generate PDF");

      const arrayBuffer = await response.arrayBuffer();

      if (Platform.OS === "web") {
        const blob = new Blob([arrayBuffer], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const uri = `${FileSystemLegacy.documentDirectory}${filename}`;
        await FileSystemLegacy.writeAsStringAsync(uri, arrayBufferToBase64(arrayBuffer), {
          encoding: FileSystemLegacy.EncodingType.Base64,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri);
        } else {
          alert("Downloaded to: " + uri);
        }
      }

      setShowDownloadPanel(false);
    } catch (error) {
      console.error("Download error:", error);
      alert("An error occurred while generating the PDF.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleEmailPdf = async () => {
    const emailCheck = validateRecipientEmail(emailAddress);
    if (!emailCheck.isValid) {
      setEmailFieldTouched(true);
      setEmailSuggestion(emailCheck.suggestion || null);
      showToast({
        type: "error",
        message: emailCheck.error || "Please enter a valid email address",
        subtitle: emailCheck.suggestion
          ? `Did you mean ${emailCheck.suggestion} ?`
          : undefined,
      });
      return;
    }

    try {
      setIsSendingEmail(true);
      const reportData = await fetchReportData();

      const response = await fetch(`${API_URL}/api/export/email-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportData, email: emailCheck.normalized }),
      });

      const rawText = await response.text();
      let data: {
        success?: boolean;
        error?: string;
        details?: string;
        message?: string;
        email?: string;
        status?: string;
        code?: string;
        suggestion?: string;
      } = {};
      if (rawText) {
        try {
          data = JSON.parse(rawText) as typeof data;
        } catch {
          showToast({
            type: "error",
            message: "Server returned an invalid response",
            subtitle: rawText.slice(0, 220),
            duration: 6000,
          });
          return;
        }
      }

      if (!response.ok || !data.success) {
        const mailNotConfigured =
          response.status === 503 && data.code === "MAIL_NOT_CONFIGURED";
        const invalidRecipient =
          response.status === 400 && data.code === "INVALID_RECIPIENT";
        if (data.suggestion) {
          setEmailSuggestion(data.suggestion);
        }
        showToast({
          type: "error",
          message:
            mailNotConfigured
              ? "Email not configured on server"
              : invalidRecipient
                ? "Recipient email address does not exist."
                : data.error || `Request failed (${response.status})`,
          subtitle: mailNotConfigured
            ? data.details ||
            "Add EMAIL_USER + EMAIL_PASS (or SMTP_*) in Railway Variables, then redeploy."
            : invalidRecipient
              ? data.details || data.suggestion
              : data.details,
          duration: mailNotConfigured ? 12000 : 7000,
        });
        return;
      }

      const effectiveEmail = data.email || emailCheck.normalized;
      showToast({
        type: "success",
        message: "Sales report sent successfully",
        subtitle: effectiveEmail ? `Sent to: ${effectiveEmail}` : undefined,
        duration: 5000,
      });
      setShowDownloadPanel(false);
      setEmailAddress("");
      setEmailFieldTouched(false);
      setEmailSuggestion(null);
    } catch (error: unknown) {
      console.error("Email error:", error);
      const msg =
        error instanceof Error
          ? error.message
          : "Network or server error while sending the email.";
      showToast({ type: "error", message: msg, duration: 5500 });
    } finally {
      setIsSendingEmail(false);
    }
  };

  const onRefresh = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setRefreshing(true);
    await fetchData();
    if (detailReportType) {
      await fetchDetailReport(detailReportType);
    }
  };

  const formatOrderId = (order: any) => {
    if (!order) return "";
    if (order.OrderType === "LEDGER" && order.CreditOrderNo) {
      return order.CreditOrderNo;
    }
    const rawId = String(order.OrderId || order.BillNo || "");
    // If the ID already has a dash or contains alphabetical/special characters (like ORD270524), return it as-is
    if (rawId.includes("-") || !/^\d+$/.test(rawId)) return rawId;

    const d = order.SettlementDate
      ? parseDatabaseDate(order.SettlementDate)
      : new Date();
    const datePart =
      d.getFullYear().toString() +
      (d.getMonth() + 1).toString().padStart(2, "0") +
      d.getDate().toString().padStart(2, "0");
    return `${datePart}-${rawId.padStart(4, "0")}`;
  };

  const formatCurrency = (amount: number) => {
    if (amount === undefined || amount === null) return "$0.00";
    const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
    return `$${rounded.toFixed(2)}`;
  };

  const changeDate = (direction: number) => {
    const maxDateStr = activeBusinessDate || getTodayDateStr();
    const current = parseLocalDate(selectedDate);
    let newRef = new Date(current);

    if (direction > 0) {
      if (selectedFilter === "DAILY" && selectedDate >= maxDateStr) return;
      const curRange = calculatePeriodRange(selectedFilter, selectedDate, maxDateStr);
      if (curRange.endDate >= maxDateStr) return;
    }

    if (selectedFilter === "DAILY") {
      newRef.setDate(newRef.getDate() + direction);
    } else if (selectedFilter === "WEEKLY") {
      newRef.setDate(newRef.getDate() + (direction * 7));
    } else if (selectedFilter === "MONTHLY") {
      newRef.setMonth(newRef.getMonth() + direction);
    } else if (selectedFilter === "YEARLY") {
      newRef.setFullYear(newRef.getFullYear() + direction);
    }

    let newDateStr = format(newRef, "yyyy-MM-dd");
    if (newDateStr > maxDateStr) {
      newDateStr = maxDateStr;
    }

    const { startDate, endDate } = calculatePeriodRange(selectedFilter, newDateStr, maxDateStr);
    setSelectedDate(newDateStr);
    setRangeStart(startDate);
    setRangeEnd(endDate);
  };


  const dateScopedSales = useMemo(() => {
    let result = sales;

    const extractYYYYMMDD = (dateVal: any): string => {
      if (!dateVal) return "";
      if (typeof dateVal === "string") {
        const match = dateVal.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) return `${match[1]}-${match[2]}-${match[3]}`;
      }
      return getSingaporeDateString(parseDatabaseDate(dateVal));
    };

    const { startDate, endDate } = effectiveDateRange;

    result = sales.filter((s) => {
      const dateToUse = s.BusinessDate || s.SettlementDate;
      if (!dateToUse) return false;
      const saleDateStr = extractYYYYMMDD(dateToUse);
      return saleDateStr >= startDate && saleDateStr <= endDate;
    });

    return result;
  }, [sales, effectiveDateRange]);

  const groupedSales = useMemo(() => {
    const groups: Record<string, any[]> = {};
    const orderOfSettlements: string[] = [];
    dateScopedSales.forEach((row) => {
      if (!row.SettlementID) return;
      if (!groups[row.SettlementID]) {
        groups[row.SettlementID] = [];
        orderOfSettlements.push(row.SettlementID);
      }
      groups[row.SettlementID].push(row);
    });

    const grouped: any[] = [];
    orderOfSettlements.forEach((settlementId) => {
      const group = groups[settlementId];
      let row = { ...group[0] };

      if (group.length > 1) {
        const totalSysAmount = group.reduce((sum, r) => {
          return sum + (r.SysAmount || 0);
        }, 0);
        const totalManualAmount = group.reduce((sum, r) => {
          return sum + (r.ManualAmount || 0);
        }, 0);
        const payModes = group.map((r) => String(r.PayMode || "CASH").trim()).filter(Boolean);
        const uniquePayModes = Array.from(new Set(payModes));

        row.PayMode = uniquePayModes.join(" + ");
        row.SysAmount = totalSysAmount;
        row.ManualAmount = totalManualAmount;
        row.isSplit = false;
        row.splitNo = "";
      } else {
        const splitMatch = row.BillNo && row.BillNo.match(/-S(\d+)$/i);
        if (splitMatch) {
          row.isSplit = true;
          row.splitNo = 'S' + splitMatch[1];
        } else {
          row.isSplit = false;
          row.splitNo = "";
        }
      }
      grouped.push(row);
    });
    return grouped;
  }, [dateScopedSales]);

  const baseFilteredSales = useMemo(() => {
    const norm = (str: string) => (str || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

    return groupedSales.filter((s) => {
      const modeUpper = s.PayMode?.toUpperCase().trim() || "";
      const isUpiMode = modeUpper.includes("UPI") || modeUpper.includes("GPAY");
      const typeUpper = s.OrderType?.toUpperCase().trim() || "";

      // Support checking components of combined payment modes (e.g. "CASH + NETS")
      const splitModes = modeUpper.includes("+") ? modeUpper.split("+").map((m: string) => m.trim()) : [modeUpper];

      const isModeSelected = (mode: string) => {
        if (activePaymentModes.length === 0) return true;
        const cleanM = norm(mode);
        if (!cleanM) return true;
        return activePaymentModes.some(ap => {
          const cleanAp = norm(ap);
          return cleanAp === cleanM || cleanM.includes(cleanAp) || cleanAp.includes(cleanM);
        });
      };

      const modeMatch =
        splitModes.some(isModeSelected) ||
        (activePaymentModes.some(ap => norm(ap) === "UPI") && isUpiMode) ||
        (showCancelledOrders && s.IsCancelled) ||
        (typeUpper === 'LEDGER');

      const typeMatch =
        !s.OrderType ||
        typeUpper === 'LEDGER' ||
        activeOrderTypes.length === 0 ||
        activeOrderTypes.length === 2 ||
        activeOrderTypes.some(at => norm(at) === norm(typeUpper));

      return modeMatch && typeMatch;
    });
  }, [
    groupedSales,
    activePaymentModes,
    activeOrderTypes,
    showCancelledOrders,
  ]);

  const filteredSales = useMemo(() => {
    const filtered = baseFilteredSales.filter((s) => {
      const cashierMatch = selectedCashierId === "ALL" || String(s.CashierId) === String(selectedCashierId);
      return (showCancelledOrders || !s.IsCancelled) && cashierMatch;
    });

    if (sortOrder === "NEWEST") {
      return [...filtered].sort(
        (a, b) =>
          new Date(b.SettlementDate).getTime() -
          new Date(a.SettlementDate).getTime(),
      );
    } else {
      return [...filtered].sort((a, b) => b.SysAmount - a.SysAmount);
    }
  }, [baseFilteredSales, showCancelledOrders, sortOrder, selectedCashierId]);

  const filteredMetrics = useMemo(() => {
    const processedBills = new Set<string>();
    const scoped = selectedCashierId === "ALL" ? dateScopedSales : dateScopedSales.filter(s => String(s.CashierId) === String(selectedCashierId));
    return scoped.reduce(
      (acc, s) => {
        const isSubsequentSplit = s.SettlementID && s.SettlementID.includes("-") && s.SettlementID.split("-").length > 5 && s.SettlementID.split("-").pop().match(/^\d+$/);

        if (s.IsCancelled) {
          if (!isSubsequentSplit && !processedBills.has(s.SettlementID)) {
            processedBills.add(s.SettlementID);
            acc.CancelledCount += 1;
            acc.CancelledAmount += s.VoidAmount || 0;
          }
          return acc;
        }

        const roundedSysAmount = Math.round(((s.SysAmount || 0) + Number.EPSILON) * 100) / 100;

        if (s.OrderType === 'LEDGER') {
          if (s.OrderId === 'Credit Payment Collected' || s.CustomerType === 'CREDIT') {
            acc.CreditPaymentsCollected += roundedSysAmount;
          } else {
            acc.MemberPaymentsCollected += roundedSysAmount;
          }
          return acc;
        }

        const mode = s.PayMode?.trim().toUpperCase() || "";

        acc.TotalSales += roundedSysAmount;
        const isUpi = mode.includes("UPI") || mode.includes("GPAY");
        if (mode === "CASH") acc.Cash += roundedSysAmount;
        else if (mode === "CARD") acc.Card += roundedSysAmount;
        else if (mode === "NETS") acc.Nets += roundedSysAmount;
        else if (mode === "PAYNOW") acc.PayNow += roundedSysAmount;
        else if (mode === "GRAB") acc.Grab += roundedSysAmount;
        else if (mode === "FOODPANDA") acc.Foodpanda += roundedSysAmount;
        else if (isUpi) acc.Upi += roundedSysAmount;
        else if (mode === "MEMBER") {
          acc.Member += roundedSysAmount;
        } else if (mode === "CREDIT") {
          acc.Credit += roundedSysAmount;
          acc.CreditOutstanding += Math.round(((Number(s.OutstandingAmount) || 0) + Number.EPSILON) * 100) / 100;
        } else if (mode === "FOC" || mode === "4" || mode.includes("FOC") || mode.includes("FREE")) {
          acc.FocSales += roundedSysAmount;
        }

        if (!isSubsequentSplit && !processedBills.has(s.SettlementID)) {
          processedBills.add(s.SettlementID);
          acc.TotalTransactions += 1;
          if (s.entryStatus === "q" || s.entry_status === "q" || s.isQROrder) {
            acc.QROrderCount += 1;
          }
          acc.TotalItems += (s.ReceiptCount || 0);
          acc.TotalVoids += s.VoidQty || 0;
          acc.TotalVoidAmount += Math.round(((s.VoidAmount || 0) + Number.EPSILON) * 100) / 100;
          acc.ServiceCharge += Math.round(((Number(s.ServiceCharge) || 0) + Number.EPSILON) * 100) / 100;
          acc.TotalTax += Math.round(((Number(s.TotalTax) || 0) + Number.EPSILON) * 100) / 100;
          acc.TotalDiscount += Math.round(((Number(s.DiscountAmount) || 0) + Number.EPSILON) * 100) / 100;
          acc.TakeawayCharge += Math.round(((Number(s.TakeawayCharge) || 0) + Number.EPSILON) * 100) / 100;
        }

        return acc;
      },
      {
        TotalSales: 0,
        TotalTransactions: 0,
        QROrderCount: 0,
        TotalItems: 0,
        Cash: 0,
        Card: 0,
        Nets: 0,
        PayNow: 0,
        Grab: 0,
        Foodpanda: 0,
        Upi: 0,
        Member: 0,
        Credit: 0,
        FocSales: 0,
        TotalVoids: 0,
        TotalVoidAmount: 0,
        CancelledCount: 0,
        CancelledAmount: 0,
        MemberPaymentsCollected: 0,
        CreditPaymentsCollected: 0,
        MemberOutstanding: 0,
        CreditOutstanding: 0,
        ServiceCharge: 0,
        TotalTax: 0,
        TotalDiscount: 0,
        TakeawayCharge: 0,
      },
    );
  }, [dateScopedSales, selectedCashierId]);

  const avgOrder = useMemo(() => {
    if (!filteredMetrics.TotalTransactions) return 0;
    return filteredMetrics.TotalSales / filteredMetrics.TotalTransactions;
  }, [filteredMetrics]);

  const PAYMODE_COLORS: Record<string, string> = {
    CASH: "#22c55e",
    CARD: "#818cf8",
    NETS: "#3b82f6",
    PAYNOW: "#f59e0b",
    GRAB: "#00b14f",
    FOODPANDA: "#d70f64",
    UPI: "#f59e0b",
    MEMBER: "#ec4899",
    CREDIT: "#e11d48",
  };

  const getPayModeColor = (mode: string) => {
    const m = mode.toUpperCase().trim();
    if (PAYMODE_COLORS[m]) return PAYMODE_COLORS[m];
    let hash = 0;
    for (let i = 0; i < m.length; i++) {
      hash = m.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00ffffff).toString(16).toUpperCase();
    return "#" + "00000".substring(0, 6 - c.length) + c;
  };

  // Distinct Ionicons per payment mode
  const getPayModeIoniconName = (mode: string): any => {
    const m = mode.toUpperCase().trim();
    if (m === 'CASH' || m === 'CAS') return 'cash-outline';
    if (m === 'CARD' || m === 'YEAHPAYCARD') return 'card-outline';
    if (m === 'NETS') return 'layers-outline';
    if (m.includes('PAYNOW') || m.includes('PAY NOW') || m === 'UPI' || m === 'GPAY') return 'qr-code-outline';
    if (m === 'GRAB') return 'car-outline';
    if (m.includes('PANDA') || m.includes('FOODPANDA')) return 'bicycle-outline';
    if (m === 'MEMBER') return 'person-circle-outline';
    if (m === 'CREDIT') return 'pricetag-outline';
    if (m === 'ONLINE' || m.includes('ONLINE')) return 'globe-outline';
    if (m === 'CATERING' || m.includes('CATERING')) return 'restaurant-outline';
    if (m === 'FOC') return 'gift-outline';
    if (m.includes('BILLING') || m.includes('OLD')) return 'document-text-outline';
    if (m.includes('YEAH')) return 'scan-outline';
    return 'wallet-outline';
  };

  const paymentBreakdownMetrics = useMemo<Record<string, number>>(() => {
    const filteredByTypes = dateScopedSales.filter((s) => {
      const typeUpper = s.OrderType?.toUpperCase().trim() || "";
      const typeMatch =
        activeOrderTypes.length === 2 ||
        (s.OrderType
          ? activeOrderTypes.includes(typeUpper) || typeUpper === 'LEDGER'
          : activeOrderTypes.includes("DINE-IN"));
      return typeMatch;
    });

    const initialAcc: Record<string, number> = {};
    dbPaymentModes.forEach((m) => {
      initialAcc[m.payMode.toUpperCase().trim()] = 0;
    });
    initialAcc["CREDIT_OUTSTANDING"] = 0;

    return filteredByTypes.reduce(
      (acc, s) => {
        if (s.IsCancelled) {
          return acc;
        }

        if (s.OrderType === 'LEDGER') {
          return acc;
        }

        const salePayMode = s.PayMode?.trim().toUpperCase() || "";

        // First pass: try exact match
        let matchedMode = dbPaymentModes.find((m) => {
          const dbName = String(m.payMode || "").toUpperCase().trim();
          const dbDesc = String(m.description || "").toUpperCase().trim();
          const dbPos = String(m.position || m.Position || "").trim();
          return salePayMode === dbName || salePayMode === dbDesc || salePayMode === dbPos;
        });

        // Second pass: if no exact match, try greedy/wildcard match
        if (!matchedMode) {
          matchedMode = dbPaymentModes.find((m) => {
            const dbName = String(m.payMode || "").toUpperCase().trim();
            const dbDesc = String(m.description || "").toUpperCase().trim();
            if ((dbName === "FOC" || dbDesc === "FOC" || dbName.includes("FREE") || dbDesc.includes("FREE")) &&
                (salePayMode.includes("FOC") || salePayMode === "4" || salePayMode.includes("FREE"))) {
              return true;
            }
            if ((dbName === "PAYNOW" || dbName === "PAY NOW" || dbName === "UPI" || dbName === "GPAY") &&
                (salePayMode.includes("PAYNOW") || salePayMode.includes("PAY NOW") || salePayMode.includes("UPI") || salePayMode.includes("GPAY"))) {
              return true;
            }
            if ((dbName === "CASH" || dbName === "CAS") && (salePayMode === "CASH" || salePayMode === "CAS")) {
              return true;
            }
            return false;
          });
        }

        if (matchedMode) {
          const key = matchedMode.payMode.toUpperCase().trim();
          acc[key] = (acc[key] || 0) + s.SysAmount;
          if (key === "CREDIT") {
            acc["CREDIT_OUTSTANDING"] = (acc["CREDIT_OUTSTANDING"] || 0) + (Number(s.OutstandingAmount) || 0);
          }
        } else {
          const key = salePayMode || "CASH";
          acc[key] = (acc[key] || 0) + s.SysAmount;
        }

        return acc;
      },
      initialAcc
    );
  }, [dateScopedSales, activeOrderTypes, dbPaymentModes]);

  const displayedBreakdownModes = useMemo(() => {
    const modes = dbPaymentModes.filter(m => m.active === 1 || m.Active === 1 || m.active === true || m.Active === true);
    Object.entries(paymentBreakdownMetrics).forEach(([key, val]) => {
      if (key === "CREDIT_OUTSTANDING") return;
      if (val > 0) {
        const alreadyExists = modes.some(m => m.payMode.toUpperCase().trim() === key);
        if (!alreadyExists) {
          const matchedDbMode = dbPaymentModes.find(m => m.payMode.toUpperCase().trim() === key);
          if (matchedDbMode) {
            modes.push(matchedDbMode);
          } else {
            modes.push({
              payMode: key,
              description: key,
            });
          }
        }
      }
    });
    return modes;
  }, [dbPaymentModes, paymentBreakdownMetrics]);

  const paymentBreakdownTotal = useMemo(() => {
    return Object.entries(paymentBreakdownMetrics).reduce((sum, [key, val]) => {
      if (key === "CREDIT_OUTSTANDING") return sum;
      return sum + val;
    }, 0);
  }, [paymentBreakdownMetrics]);

  const paymentMix = useMemo(() => {
    const mix: Record<string, number> = {};
    if (!paymentBreakdownTotal) return mix;
    Object.entries(paymentBreakdownMetrics).forEach(([key, val]) => {
      if (key !== "CREDIT_OUTSTANDING") {
        mix[key] = (val / paymentBreakdownTotal) * 100;
      }
    });
    return mix;
  }, [paymentBreakdownMetrics, paymentBreakdownTotal]);

  const paymentMixCenterRows = useMemo(() => {
    const rows: { key: string; pct: number; color: string }[] = [];
    displayedBreakdownModes.forEach((m) => {
      const key = m.payMode.toUpperCase().trim();
      const val = paymentBreakdownMetrics[key] || 0;
      if (val > 0) {
        rows.push({
          key,
          pct: paymentMix[key] || 0,
          color: getPayModeColor(key),
        });
      }
    });
    return rows.sort((a, b) => b.pct - a.pct);
  }, [displayedBreakdownModes, paymentBreakdownMetrics, paymentMix]);

  const togglePaymentMode = (mode: string) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setActivePaymentModes((prev) =>
      prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode],
    );
  };

  const handleBreakdownPress = (payMode: string) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    const modeKey = payMode.toUpperCase().trim();
    const isOnlyActive = activePaymentModes.length === 1 && activePaymentModes[0] === modeKey;
    if (isOnlyActive) {
      setActivePaymentModes([...displayedBreakdownModes.map(m => m.payMode.toUpperCase().trim()), "VOID"]);
    } else {
      setActivePaymentModes([modeKey]);
    }
  };

  const toggleOrderType = (type: string) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    setActiveOrderTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  const displayedPayments = useMemo(() => {
    if (!orderPayments || orderPayments.length === 0) return [];

    // Calculate total of payments
    const totalPayments = orderPayments.reduce((sum, p) => sum + Number(p.Amount || 0), 0);
    const targetTotal = Number(selectedOrder?.SysAmount || 0);

    // If there is a discrepancy within 0.10, adjust the last row to prevent rounding discrepancies in display
    const diff = targetTotal - totalPayments;
    if (Math.abs(diff) > 0 && Math.abs(diff) < 0.10 && orderPayments.length > 0) {
      const adjusted = [...orderPayments];
      const lastIndex = adjusted.length - 1;
      adjusted[lastIndex] = {
        ...adjusted[lastIndex],
        Amount: Number((Number(adjusted[lastIndex].Amount || 0) + diff).toFixed(2))
      };
      return adjusted;
    }

    return orderPayments;
  }, [orderPayments, selectedOrder]);

  const payModeText = useMemo(() => {
    if (selectedOrder?.IsCancelled) return "CANCELLED";
    if (displayedPayments && displayedPayments.length > 0) {
      const names = displayedPayments.map(p => (p.PayModeName || 'CASH').trim().toUpperCase());
      const uniqueNames = Array.from(new Set(names));
      return uniqueNames.join(" + ");
    }
    return (selectedOrder?.PayMode || "CASH").toUpperCase();
  }, [displayedPayments, selectedOrder]);

  const fetchOrderDetails = async (settlementId: string, currentOrder: any) => {
    try {
      setLoadingDetails(true);
      setOrderPayments([]);
      setOrderRewards(null);
      const [itemsRes, paymentsRes, rewardsRes] = await Promise.all([
        fetch(`${API_URL}/api/sales/detail/${settlementId}`),
        fetch(`${API_URL}/api/sales/detail/${settlementId}/payments`),
        fetch(`${API_URL}/api/sales/detail/${settlementId}/rewards`),
      ]);

      if (itemsRes.ok) {
        const data = await itemsRes.json();
        if (Array.isArray(data) && data.length > 0) {
          const parsedData = data.map((item: any) => {
            let comboSelections = undefined;
            const comboJson = item.ComboDetailsJSON || item.comboDetailsJSON;
            if (comboJson) {
              try {
                const parsed = typeof comboJson === "string" ? JSON.parse(comboJson) : comboJson;
                comboSelections = Array.isArray(parsed) ? parsed : parsed?.groups;
              } catch (e) {
                console.error("Error parsing ComboDetailsJSON:", e);
              }
            }
            return {
              ...item,
              comboSelections,
              isCombo: !!comboSelections && comboSelections.length > 0,
            };
          });
          setOrderDetails(parsedData);
        } else {
          setOrderDetails([
            {
              DishName: currentOrder?.IsCancelled
                ? "Items not captured (Legacy Cancelled Order)"
                : (currentOrder?.OrderType === 'LEDGER' ? (currentOrder?.OrderId || "Member Outstanding Payment") : "Item info not available"),
              Qty: currentOrder?.OrderType === 'LEDGER' ? 1 : 0,
              Price: currentOrder?.OrderType === 'LEDGER' ? currentOrder?.SysAmount : 0
            },
          ]);
        }
      }

      if (paymentsRes.ok) {
        const pData = await paymentsRes.json();
        if (Array.isArray(pData)) {
          setOrderPayments(pData);
        }
      }

      if (rewardsRes.ok) {
        const rData = await rewardsRes.json();
        if (rData) {
          setOrderRewards(rData);
        }
      }
    } catch (e) {
      console.error("Detail fetch error:", e);
      setOrderDetails([]);
      setOrderPayments([]);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleOrderPress = (order: any) => {
    setSelectedVoidItemIds([]);
    setOrderDetails([]);
    setOrderPayments([]);
    setOrderRewards(null);
    setSelectedOrder(order);
    fetchOrderDetails(order.SettlementID, order);
  };

  const refreshOrder = async (settlementId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/sales/settlement/${settlementId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.header) {
          setSelectedOrder(data.header);
        }
        await fetchOrderDetails(settlementId, data.header);
      }
    } catch (e) {
      console.error("Refresh order error:", e);
    }
  };

  const handleConfirmChangePayment = async (newPayMode: string, splits?: any[], memberId?: string, creditCustomerId?: string) => {
    if (!selectedOrder) return;
    promptPassword(
      "Admin Password Required",
      "Enter Admin password to save payment mode change:",
      "ADMIN",
      async () => {
        try {
          setShowChangePaymentModal(false);
          setShowMemberModal(false);
          setLoadingDetails(true);
          const res = await fetch(`${API_URL}/api/sales/settlement/${selectedOrder.SettlementID}/change-payment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ payMode: newPayMode, splits, memberId, creditCustomerId }),
          });
          const data = await res.json();
          if (res.ok && data.success) {
            showToast({ type: "success", message: "Payment mode updated successfully" });
            await refreshOrder(selectedOrder.SettlementID);
            fetchSales();
          } else {
            showToast({ type: "error", message: data.error || "Failed to update payment mode" });
          }
        } catch (err: any) {
          console.error(err);
          showToast({ type: "error", message: err.message || "An error occurred" });
        } finally {
          setLoadingDetails(false);
        }
      }
    );
  };

  const toggleVoidItemSelection = (id: string) => {
    setSelectedVoidItemIds((prev) =>
      prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id]
    );
  };

  const runVoidItems = async (itemIds: string[]) => {
    if (!selectedOrder || itemIds.length === 0) return;
    const names = orderDetails
      .filter(item => itemIds.includes(item.OrderDetailId || item.DishId))
      .map(item => item.DishName)
      .join(", ");

    promptPassword(
      "Enter Password to Void",
      `Verify supervisor credentials to void: "${names}"`,
      "VOID",
      async () => {
        try {
          setShowVoidItemModal(false);
          setLoadingDetails(true);
          const res = await fetch(`${API_URL}/api/sales/settlement/${selectedOrder.SettlementID}/void-item`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderDetailIds: itemIds }),
          });
          const data = await res.json();
          if (res.ok && data.success) {
            showToast({ type: "success", message: "Items voided successfully" });
            await refreshOrder(selectedOrder.SettlementID);
            fetchSales();
          } else {
            showToast({ type: "error", message: data.error || "Failed to void items" });
          }
        } catch (err: any) {
          console.error(err);
          showToast({ type: "error", message: err.message || "An error occurred" });
        } finally {
          setLoadingDetails(false);
          setSelectedVoidItemIds([]);
        }
      }
    );
  };

  const handleConfirmCancelOrder = async () => {
    if (!selectedOrder) return;
    promptPassword(
      "Admin Password Required",
      `Verify Admin credentials to cancel Order #${formatOrderId(selectedOrder)}`,
      "ADMIN",
      async () => {
        try {
          setShowCancelOrderConfirm(false);
          setLoadingDetails(true);
          const res = await fetch(`${API_URL}/api/sales/settlement/${selectedOrder.SettlementID}/cancel`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: cancellationReason }),
          });
          const data = await res.json();
          if (res.ok && data.success) {
            showToast({ type: "success", message: "Order cancelled successfully" });
            setCancellationReason("");
            await refreshOrder(selectedOrder.SettlementID);
            fetchSales();
          } else {
            showToast({ type: "error", message: data.error || "Failed to cancel order" });
          }
        } catch (err: any) {
          console.error(err);
          showToast({ type: "error", message: err.message || "An error occurred" });
        } finally {
          setLoadingDetails(false);
        }
      }
    );
  };


  const handleReprint = async () => {
    if (!selectedOrder || orderDetails.length === 0) return;

    setIsReprinting(true);
    setShowPrintPrompt(false);

    try {
      const userId = (await AsyncStorage.getItem("userId")) || "1";

      const mappedItems = orderDetails.map((item) => ({
        name: item.DishName,
        price: item.Price,
        qty: item.Qty,
        status: item.Status || "NORMAL",
        discountAmount: item.DiscountAmount || 0,
        discountType: item.DiscountType || "fixed",
        modifiers: item.modifiers || [],
        comboSelections: item.comboSelections,
        ComboDetailsJSON: item.ComboDetailsJSON || item.comboDetailsJSON,
        isCombo: item.isCombo,
      }));

      const isPercentage = selectedOrder.DiscountType === "percentage";
      const discountValue = isPercentage
        ? Number(selectedOrder.DiscountPercentage ?? 0)
        : Number(selectedOrder.DiscountAmount ?? 0);

      const discountInfo = {
        applied: Number(selectedOrder.DiscountAmount ?? 0) > 0,
        type: (selectedOrder.DiscountType || "fixed") as "fixed" | "percentage",
        value: discountValue,
        amount: Number(selectedOrder.DiscountAmount ?? 0),
        subtotal: Number(selectedOrder.SubTotal ?? 0),
      };

      // ✅ Reprint Fix: Resolve paymentMethod from displayedPayments for multi-split orders
      const reprintPayMode = displayedPayments.length > 0
        ? (displayedPayments.length === 1
            ? (displayedPayments[0].PayModeName || selectedOrder.PayMode || "CASH")
            : "SPLIT")
        : (selectedOrder.PayMode || "CASH");

      const saleData = {
        invoiceNumber: formatOrderId(selectedOrder),
        tableNo: selectedOrder.TableNo ?? "",
        total: selectedOrder.SysAmount,
        paymentMethod: reprintPayMode,
        cashPaid: selectedOrder.SysAmount,
        change: 0,
        items: mappedItems,
        roundOff: Number(selectedOrder.RoundedBy ?? 0),
        // ✅ Reprint Fix: use originalDate so the receipt shows the original bill date not today.
        // Prefer SettlementDate (already +08:00 formatted by the backend).
        // Fall back to LastSettlementDate: Tedious serialises MSSQL local-time datetimes as
        // "...Z" (falsely UTC), so we must re-attach +08:00 before handing it to parseDatabaseDate,
        // otherwise the old dist-bundle code adds +8 hours a second time → wrong time on receipt.
        ...(() => {
          const raw = selectedOrder.SettlementDate || selectedOrder.LastSettlementDate;
          if (!raw) return { date: new Date(), originalDate: null };
          // If it already carries an explicit timezone offset leave it alone; otherwise treat as SGT.
          let dateStr: string;
          if (typeof raw === 'string') {
            dateStr = /[+-]\d{2}:\d{2}$/.test(raw)
              ? raw
              : raw.replace(/Z$/i, '') + '+08:00';
          } else if (raw instanceof Date) {
            // Tedious Date: UTC wall-clock IS the SGT local value → replace Z with +08:00
            dateStr = raw.toISOString().replace(/Z$/, '+08:00');
          } else {
            dateStr = String(raw).replace(/Z$/i, '') + '+08:00';
          }
          return { date: dateStr, originalDate: dateStr };
        })(),
        isReprint: true,
        // ✅ Reprint Fix: waiterName was missing — add it for receipt display
        waiterName: selectedOrder.WaiterName || selectedOrder.ServerName || selectedOrder.CashierName || "",
        // Sunmi template details
        discountAmount: Number(selectedOrder.DiscountAmount ?? 0),
        discountType: selectedOrder.DiscountType || null,
        discountValue: discountValue,
        subTotal: Number(selectedOrder.SubTotal ?? 0),
        serviceCharge: Number(selectedOrder.ServiceCharge ?? 0),
        takeawayCharge: Number(selectedOrder.TakeawayCharge ?? 0),
        payments: displayedPayments.map(p => ({
          payMode: p.PayModeName,
          payModeName: p.PayModeName,
          amount: p.Amount,
          referenceNo: p.ReferenceNo
        })),
        rewardPointsEarned: String(orderRewards?.PointsEarned || 0),
        memberRewardBalance: String(orderRewards?.RewardCredit || 0),
      };

      await UniversalPrinter.smartPrint(saleData, userId, {}, discountInfo, undefined, true);
    } catch (error) {
      console.error("Reprint error:", error);
    } finally {
      setIsReprinting(false);
    }
  };

  // ✅ Settlement Report Printing
  const handlePrintSettlementReport = async () => {
    try {
      const company = await (async () => {
        const { useCompanySettingsStore } = await import("../stores/companySettingsStore");
        return useCompanySettingsStore.getState().settings;
      })();
      const period = rangeStart && rangeEnd
        ? `${rangeStart} – ${rangeEnd}`
        : selectedDate
          ? `Date: ${selectedDate}`
          : "Current Period";

      // ✅ Z-Report Fix: Try silent Z-report printing via bridge first
      const printedDirect = await UniversalPrinter.printSettlementReportDirect(settlementReport, company, period);
      if (printedDirect) return;

      const html = UniversalPrinter.generateSettlementReportHTML(settlementReport, company, period);

      if (Platform.OS === "web") {
        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        document.body.appendChild(iframe);
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc) {
          doc.open(); doc.write(html); doc.close();
          setTimeout(() => {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
            setTimeout(() => document.body.removeChild(iframe), 2000);
          }, 400);
        }
      } else {
        const Print = await import("expo-print");
        await Print.printAsync({ html });
      }
    } catch (err) {
      console.error("Settlement report print error:", err);
    }
  };

  const renderMetricTile = (
    label: string,
    value: string | number,
    icon: any,
    color: string,
    fullWidth?: boolean,
    subtitle?: string,
    onPress?: () => void,
  ) => {
    const isMobile = SCREEN_W < 600;
    const isTablet = SCREEN_W >= 600 && SCREEN_W < 1024;

    const tilePaddingH = isMobile ? 10 : isTablet ? 12 : 16;
    const tilePaddingV = isMobile ? 10 : isTablet ? 12 : 16;
    const iconBoxSize = isMobile ? 36 : isTablet ? 42 : 48;
    const iconSize = isMobile ? 18 : isTablet ? 22 : 24;
    const tileGap = isMobile ? 8 : isTablet ? 10 : 12;
    const labelFontSize = isMobile ? 10 : isTablet ? 11 : 12;
    const valueFontSize = isMobile ? 16 : isTablet ? 18 : 22;

    const TileWrapper = onPress ? TouchableOpacity : View;

    return (
      <TileWrapper
        onPress={onPress}
        activeOpacity={onPress ? 0.75 : 1}
        style={[
          styles.metricTile,
          {
            borderLeftColor: color,
            borderLeftWidth: isMobile ? 4 : 5,
            paddingHorizontal: tilePaddingH,
            paddingVertical: tilePaddingV,
            gap: tileGap,
            width: fullWidth
              ? "100%"
              : SCREEN_W >= 600
              ? "31.5%"
              : undefined,
            flex: fullWidth ? undefined : SCREEN_W >= 600 ? undefined : 1,
            cursor: onPress ? "pointer" : undefined,
          },
        ]}
      >
        <View
          style={[
            styles.tileIconContainer,
            {
              backgroundColor: color + "15",
              width: iconBoxSize,
              height: iconBoxSize,
              borderRadius: isMobile ? 10 : 14,
            },
          ]}
        >
          <Ionicons name={icon} size={iconSize} color={color} />
        </View>

        <View style={styles.tileContent}>
          <Text
            style={[styles.tileLabel, { fontSize: labelFontSize }]}
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            {label}
          </Text>
          <Text
            style={[styles.tileValue, { color, fontSize: valueFontSize }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.55}
          >
            {value}
          </Text>
          {subtitle ? (
            <Text
              style={[styles.tileSubtitle, { fontSize: isMobile ? 9 : 10 }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </TileWrapper>
    );
  };

  const renderDetailReport = () => {
    if (!detailReportType) {
      return null;
    }



    const isSettlement = detailReportType === "SETTLEMENT";
    const isArtistTarget = detailReportType === "ARTIST_TARGET";
    const rows = isSettlement
      ? settlementReport
      : isArtistTarget
        ? artistTargetReport
        : detailReportType === "CATEGORY"
          ? categoryReport
          : dishReport;
    const isDishReport = detailReportType === "DISH";

    return (
      <View style={styles.detailReportCard}>
        <View style={styles.detailReportHeader}>
          {/* Spacer to balance the actions on the right for exact centering */}
          <View style={{ width: 62 }} />
          <View style={styles.reportTitleContainer}>
            <Text style={styles.cardTitle}>
              {isSettlement
                ? "SETTLEMENT DETAILS REPORT"
                : isArtistTarget
                  ? "ARTIST TARGET REPORT"
                  : isDishReport
                    ? "ITEM SALES REPORT"
                    : "CATEGORY SALES REPORT"}
            </Text>
            <Text style={styles.reportSubText}>
              {rows.length} rows for the selected period
            </Text>
          </View>
          <View style={styles.reportHeaderActions}>
            <Ionicons
              name={
                isSettlement
                  ? "wallet-outline"
                  : isArtistTarget
                    ? "ribbon-outline"
                    : isDishReport
                      ? "restaurant-outline"
                      : "albums-outline"
              }
              size={18}
              color={Theme.primary}
            />
            {/* ✅ Settlement Report Print Button */}
            {isSettlement && rows.length > 0 && (
              <TouchableOpacity
                onPress={handlePrintSettlementReport}
                style={[styles.reportCloseBtn, { marginRight: 4, backgroundColor: Theme.primary + "15" }]}
              >
                <Ionicons name="print-outline" size={17} color={Theme.primary} />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => {
                if (Platform.OS !== "web") {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
                setDetailReportType(null);
                setCategoryReport([]);
                setDishReport([]);
                setSettlementReport([]);
                setArtistTargetReport([]);
              }}
              style={styles.reportCloseBtn}
            >
              <Ionicons name="close" size={18} color="#dc2626" />
            </TouchableOpacity>
          </View>
        </View>

        {loadingReport ? (
          <View style={styles.reportLoading}>
            <ActivityIndicator color={Theme.primary} />
            <Text style={styles.reportSubText}>Loading report...</Text>
          </View>
        ) : rows.length === 0 ? (
          <View style={styles.emptyReport}>
            <Ionicons
              name="document-text-outline"
              size={32}
              color={Theme.textMuted}
            />
            <Text style={styles.emptyChartText}>No report data</Text>
          </View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ minWidth: "100%" }}
          >
            <View style={[styles.reportTable, isArtistTarget && { minWidth: 700 }, isDishReport ? { minWidth: 690 } : { minWidth: 500 }]}>
              <View style={styles.reportTableHeader}>
                <Text style={[styles.reportCell, styles.snoCell]}>S/N</Text>
                {isSettlement ? (
                  <>
                    <Text style={[styles.reportCell, styles.paymodeCell]}>
                      Paymode
                    </Text>
                    <Text style={[styles.reportCell, styles.sysAmtCell]}>
                      Sys Amt
                    </Text>
                    <Text style={[styles.reportCell, styles.manualAmtCell]}>
                      Manual Amt
                    </Text>
                    <Text style={[styles.reportCell, styles.diffCell]}>
                      Diff
                    </Text>
                    <Text style={[styles.reportCell, styles.qtyCell]}>Qty</Text>
                  </>
                ) : isArtistTarget ? (
                  <>
                    <Text style={[styles.reportCell, styles.dishNameCell, { textAlign: "left" }]}>
                      Artist Name
                    </Text>
                    <Text style={[styles.reportCell, styles.paymodeCell, { textAlign: "center" }]}>
                      From Date
                    </Text>
                    <Text style={[styles.reportCell, styles.paymodeCell, { textAlign: "center" }]}>
                      To Date
                    </Text>
                    <Text style={[styles.reportCell, styles.sysAmtCell, { textAlign: "right" }]}>
                      Target
                    </Text>
                    <Text style={[styles.reportCell, styles.sysAmtCell, { textAlign: "right" }]}>
                      Achieved
                    </Text>
                    <Text style={[styles.reportCell, styles.sysAmtCell, { textAlign: "right" }]}>
                      Left
                    </Text>
                    <Text style={[styles.reportCell, styles.paymodeCell, { textAlign: "center" }]}>
                      Status
                    </Text>
                  </>
                ) : (
                  <>
                    <Text
                      style={[
                        styles.reportCell,
                        isDishReport
                          ? styles.dishNameCell
                          : styles.categoryNameCell,
                      ]}
                    >
                      {isDishReport ? "Item" : "Category"}
                    </Text>

                    {isDishReport && (
                      <Text
                        style={[
                          styles.reportCell,
                          styles.categoryNameCell,
                        ]}
                      >
                        Category
                      </Text>
                    )}

                    <Text
                      style={[
                        styles.reportCell,
                        styles.qtyCell,
                        { textAlign: "center" },
                      ]}
                    >
                      QTY
                    </Text>
                    <Text
                      style={[
                        styles.reportCell,
                        styles.qtyCell,
                        { textAlign: "center", color: "#ef4444" },
                      ]}
                    >
                      VOID
                    </Text>
                    <Text
                      style={[
                        styles.reportCell,
                        styles.discountCell,
                        { color: "#f59e0b" },
                      ]}
                    >
                      Discount
                    </Text>
                    <Text style={[styles.reportCell, styles.amountCell]}>
                      Sales
                    </Text>
                  </>
                )}
              </View>
              {(() => {
                if (isArtistTarget) {
                  return rows.slice(0, 100).map((row, idx) => (
                    <View
                      key={`artist-target-${idx}`}
                      style={[
                        styles.reportTableRow,
                        idx % 2 === 0 && styles.reportTableRowAlt,
                      ]}
                    >
                      <Text
                        style={[
                          styles.reportCell,
                          styles.reportCellText,
                          styles.snoCell,
                        ]}
                      >
                        {idx + 1}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.reportCell,
                          styles.reportCellText,
                          styles.dishNameCell,
                          { textAlign: "left" }
                        ]}
                      >
                        {row.CustomerName}
                      </Text>
                      <Text
                        style={[
                          styles.reportCell,
                          styles.reportCellText,
                          styles.paymodeCell,
                          { textAlign: "center" }
                        ]}
                      >
                        {row.FromDate ? formatToSingaporeDate(row.FromDate, { day: "numeric", month: "numeric", year: "numeric" }) : "N/A"}
                      </Text>
                      <Text
                        style={[
                          styles.reportCell,
                          styles.reportCellText,
                          styles.paymodeCell,
                          { textAlign: "center" }
                        ]}
                      >
                        {row.ToDate ? formatToSingaporeDate(row.ToDate, { day: "numeric", month: "numeric", year: "numeric" }) : "N/A"}
                      </Text>
                      <Text
                        style={[
                          styles.reportCell,
                          styles.reportCellText,
                          styles.sysAmtCell,
                          { color: Theme.success, fontWeight: "bold", textAlign: "right" }
                        ]}
                      >
                        {formatCurrency(Number(row.Amount || 0))}
                      </Text>
                      <Text
                        style={[
                          styles.reportCell,
                          styles.reportCellText,
                          styles.sysAmtCell,
                          { color: Theme.primary, fontWeight: "600", textAlign: "right" }
                        ]}
                      >
                        {formatCurrency(Number(row.Achieved || 0))}
                      </Text>
                      <Text
                        style={[
                          styles.reportCell,
                          styles.reportCellText,
                          styles.sysAmtCell,
                          { color: Number(row.Left || 0) > 0 ? "#dc2626" : Theme.success, fontWeight: "600", textAlign: "right" }
                        ]}
                      >
                        {formatCurrency(Number(row.Left || 0))}
                      </Text>
                      <Text
                        style={[
                          styles.reportCell,
                          styles.reportCellText,
                          styles.paymodeCell,
                          { 
                            color: row.Status === "Achieved" ? Theme.success : "#dc2626", 
                            fontWeight: "bold", 
                            textAlign: "center" 
                          }
                        ]}
                      >
                        {row.Status || "Not Achieved"}
                      </Text>
                    </View>
                   ));
                }

                if (isSettlement || !isDishReport) {
                  return rows.slice(0, 100).map((row, idx) => (
                    <View
                      key={`${detailReportType}-${idx}`}
                      style={[
                        styles.reportTableRow,
                        idx % 2 === 0 && styles.reportTableRowAlt,
                      ]}
                    >
                      <Text
                        style={[
                          styles.reportCell,
                          styles.reportCellText,
                          styles.snoCell,
                        ]}
                      >
                        {idx + 1}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.reportCell,
                          styles.reportCellText,
                          styles.categoryNameCell,
                        ]}
                      >
                        {row.CategoryName}
                      </Text>
                      <Text
                        style={[
                          styles.reportCell,
                          styles.reportCellText,
                          styles.qtyCell,
                        ]}
                      >
                        {Number(row.Sold || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </Text>
                      <Text
                        style={[
                          styles.reportCell,
                          styles.reportCellText,
                          styles.qtyCell,
                          { color: "#dc2626" },
                        ]}
                      >
                        {Number(row.Voided || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </Text>
                      <Text
                        style={[
                          styles.reportCell,
                          styles.reportCellText,
                          styles.discountCell,
                          { color: "#f59e0b", fontWeight: "600" },
                        ]}
                      >
                        {formatCurrency(Number(row.DiscountAmount || 0))}
                      </Text>
                      <Text
                        style={[
                          styles.reportCell,
                          styles.reportCellText,
                          styles.amountCell,
                          { color: Theme.success, fontWeight: "bold" },
                        ]}
                      >
                        {formatCurrency(Number(row.SalesAmount || 0))}
                      </Text>
                    </View>
                  ));
                }

                // Group dishReport by category
                const groups: { [key: string]: any[] } = {};
                rows.forEach((row) => {
                  const cat = row.CategoryName || "Unmapped";
                  if (!groups[cat]) {
                    groups[cat] = [];
                  }
                  groups[cat].push(row);
                });

                // Sort category names alphabetically
                const sortedCategories = Object.keys(groups).sort((a, b) =>
                  a.localeCompare(b, undefined, { sensitivity: "base" })
                );

                let globalIdx = 0;
                return sortedCategories.map((category) => {
                  const groupRows = groups[category]!;
                  const catQty = groupRows.reduce((sum, r) => sum + Number(r.Sold || 0), 0);
                  const catVoid = groupRows.reduce((sum, r) => sum + Number(r.Voided || 0), 0);
                  const catDiscount = groupRows.reduce((sum, r) => sum + Number(r.DiscountAmount || 0), 0);
                  const catTakeaway = groupRows.reduce((sum, r) => sum + Number(r.TakeawayCharge || 0), 0);
                  const catSales = groupRows.reduce((sum, r) => sum + Number(r.SalesAmount || 0), 0);

                  return (
                    <View key={`cat-group-${category}`} style={{ width: "100%" }}>
                      {/* Sticky-like Category Header Row */}
                      <View
                        style={{
                          flexDirection: "row",
                          backgroundColor: Theme.primary + "12",
                          borderBottomWidth: 1.5,
                          borderBottomColor: Theme.primary + "40",
                          alignItems: "center",
                        }}
                      >
                        <View style={styles.snoCell} />
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.reportCell,
                            styles.reportCellText,
                            styles.dishNameCell,
                            {
                              fontFamily: Fonts.black,
                              fontSize: 13,
                              color: Theme.primary,
                              textAlign: "left",
                              textTransform: "uppercase",
                            },
                          ]}
                        >
                          ▼ {category}
                        </Text>

                        <Text
                          style={[
                            styles.reportCell,
                            styles.reportCellText,
                            styles.categoryNameCell,
                            { fontFamily: Fonts.black, fontSize: 13, color: Theme.textMuted },
                          ]}
                        >
                          -
                        </Text>

                        <Text
                          style={[
                            styles.reportCell,
                            styles.reportCellText,
                            styles.qtyCell,
                            { fontFamily: Fonts.black, fontSize: 13, color: Theme.textPrimary },
                          ]}
                        >
                          {Number(catQty || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </Text>
                        <Text
                          style={[
                            styles.reportCell,
                            styles.reportCellText,
                            styles.qtyCell,
                            { fontFamily: Fonts.black, fontSize: 13, color: "#dc2626" },
                          ]}
                        >
                          {Number(catVoid || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </Text>
                        <Text
                          style={[
                            styles.reportCell,
                            styles.reportCellText,
                            styles.discountCell,
                            { fontFamily: Fonts.black, fontSize: 13, color: "#f59e0b" },
                          ]}
                        >
                          {formatCurrency(catDiscount)}
                        </Text>
                        <Text
                          style={[
                            styles.reportCell,
                            styles.reportCellText,
                            styles.amountCell,
                            { fontFamily: Fonts.black, fontSize: 13, color: Theme.success },
                          ]}
                        >
                          {formatCurrency(catSales)}
                        </Text>
                      </View>

                      {groupRows.map((row, rowIdx) => {
                        const currentSno = ++globalIdx;
                        return (
                          <View
                            key={`dish-${category}-${rowIdx}`}
                            style={[
                              styles.reportTableRow,
                              rowIdx % 2 === 0 && styles.reportTableRowAlt,
                            ]}
                          >
                            <Text
                              style={[
                                styles.reportCell,
                                styles.reportCellText,
                                styles.snoCell,
                              ]}
                            >
                              {currentSno}
                            </Text>
                            <Text
                              numberOfLines={1}
                              style={[
                                styles.reportCell,
                                styles.reportCellText,
                                styles.dishNameCell,
                              ]}
                            >
                              {row.DishName}
                            </Text>

                            <Text
                              numberOfLines={1}
                              style={[
                                styles.reportCell,
                                styles.reportCellText,
                                styles.categoryNameCell,
                              ]}
                            >
                              {row.SubCategoryName}
                            </Text>

                            <Text
                              style={[
                                styles.reportCell,
                                styles.reportCellText,
                                styles.qtyCell,
                              ]}
                            >
                              {Number(row.Sold || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </Text>
                            <Text
                              style={[
                                styles.reportCell,
                                styles.reportCellText,
                                styles.qtyCell,
                                { color: "#dc2626" },
                              ]}
                            >
                              {Number(row.Voided || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                            </Text>
                            <Text
                              style={[
                                styles.reportCell,
                                styles.reportCellText,
                                styles.discountCell,
                                { color: "#f59e0b", fontWeight: "600" },
                              ]}
                            >
                              {formatCurrency(Number(row.DiscountAmount || 0))}
                            </Text>
                            <Text
                              style={[
                                styles.reportCell,
                                styles.reportCellText,
                                styles.amountCell,
                                { color: Theme.success, fontWeight: "bold" },
                              ]}
                            >
                              {formatCurrency(Number(row.SalesAmount || 0))}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  );
                });
              })()}
            </View>
          </ScrollView>
        )}
      </View>
    );
  };

  const renderHeader = () => (
    <>
      {/* Dashboard Header moved here for better scroll integration */}
      <View style={styles.dashboardHeader}>
        {isSalesReportUser ? (
          <TouchableOpacity onPress={() => logout()} style={styles.backBtn}>
            <Ionicons name="log-out" size={20} color={Theme.danger} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity 
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/(tabs)/category" as any);
              }
            }} 
            style={styles.backBtn}
          >
            <Ionicons name="arrow-back" size={20} color={Theme.textPrimary} />
          </TouchableOpacity>
        )}
        <View style={styles.headerContent}>
          <Text style={styles.dashboardYear}>{new Date().getFullYear()}</Text>
          <Text style={styles.dashboardTitle}>SALES ANALYTICS 📊</Text>
          <Text style={styles.dashboardSubtitle}>
            Real-time insights for better sales analytics 🚀
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => setShowDownloadPanel(true)}
            style={styles.filterMenuBtn}
          >
            <Ionicons name="download-outline" size={20} color={Theme.primary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowFilterPanel(true)}
            style={styles.filterMenuBtn}
          >
            <Ionicons name="filter-outline" size={20} color={Theme.primary} />
          </TouchableOpacity>
        </View>
      </View>



      {/* Filter Toggles */}
      <View style={styles.filterBar}>
        {(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as FilterType[]).map(
          (f) => (
            <Pressable
              key={f}
              onPress={() => {
                const nextFilter = f as FilterType;
                setSelectedFilter(nextFilter);
                setPickerMode('SINGLE');
                const maxDateStr = activeBusinessDate || getTodayDateStr();
                const { startDate, endDate } = calculatePeriodRange(nextFilter, selectedDate, maxDateStr);
                setRangeStart(startDate);
                setRangeEnd(endDate);
              }}
              style={({ pressed }) => [
                styles.filterBtn,
                selectedFilter === f && styles.activeFilterBtn,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Text
                style={[
                  styles.filterText,
                  selectedFilter === f && styles.activeFilterText,
                ]}
              >
                {f}
              </Text>
            </Pressable>
          ),
        )}
      </View>

      {/* Date Navigation */}
      <View style={styles.dateControl}>
        <TouchableOpacity onPress={() => changeDate(-1)} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={20} color={Theme.textPrimary} />
        </TouchableOpacity>

        {selectedFilter === "DAILY" ? (
          <TouchableOpacity
            onPress={() => {
              setPickerMode("SINGLE");
              setShowDatePicker(true);
            }}
            style={styles.dateDisplay}
          >
            <Text style={styles.dateText}>{formatDateDMY(selectedDate)}</Text>
            <Ionicons
              name="calendar-outline"
              size={16}
              color={Theme.primary}
              style={{ marginLeft: 8 }}
            />
          </TouchableOpacity>
        ) : (
          <View style={{ flex: 1, flexDirection: "row", gap: 10 }}>
            <TouchableOpacity
              onPress={() => {
                setPickerMode("START");
                setShowDatePicker(true);
              }}
              style={[
                styles.dateDisplay,
                { flexDirection: "column", justifyContent: "center", paddingVertical: 2 },
                pickerMode === "START" && showDatePicker && { borderColor: Theme.primary },
              ]}
            >
              <Text style={styles.rangeLabel}>FROM DATE</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 1 }}>
                <Text style={[styles.dateText, { fontSize: 14 }]}>{formatDateDMY(effectiveDateRange.startDate)}</Text>
                <Ionicons name="calendar-outline" size={14} color={Theme.primary} />
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setPickerMode("END");
                setShowDatePicker(true);
              }}
              style={[
                styles.dateDisplay,
                { flexDirection: "column", justifyContent: "center", paddingVertical: 2 },
                pickerMode === "END" && showDatePicker && { borderColor: Theme.primary },
              ]}
            >
              <Text style={styles.rangeLabel}>TO DATE</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 1 }}>
                <Text style={[styles.dateText, { fontSize: 14 }]}>{formatDateDMY(effectiveDateRange.endDate)}</Text>
                <Ionicons name="calendar-outline" size={14} color={Theme.primary} />
              </View>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          onPress={() => changeDate(1)}
          disabled={isAtLatestPeriod}
          style={[styles.navBtn, isAtLatestPeriod && { opacity: 0.35 }]}
        >
          <Ionicons
            name="chevron-forward"
            size={20}
            color={Theme.textPrimary}
          />
        </TouchableOpacity>
      </View>





      {/* ── USER / CASHIER SHIFT FILTER BAR (DROPDOWN - LIKE SETTLEMENT SCREEN) ── */}
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: Theme.bgCard,
        padding: 10,
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: Theme.border,
        marginBottom: 15,
        gap: 12,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="people-outline" size={18} color={Theme.primary} />
          <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: Theme.textPrimary }}>
            SALES REPORT VIEW:
          </Text>
        </View>

        {/* Dropdown Trigger */}
        <TouchableOpacity
          onPress={() => setShowUserDropdown(true)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: Theme.bgInput,
            paddingHorizontal: 16,
            paddingVertical: 10,
            borderRadius: 10,
            borderWidth: 1.5,
            borderColor: Theme.primary,
            minWidth: 260,
            maxWidth: '100%',
            gap: 10
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            {selectedCashierId === "ALL" ? (
              <>
                <Ionicons name="globe-outline" size={16} color={Theme.primary} />
                <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: Theme.textPrimary }}>
                  Whole Sales (All Users)
                </Text>
              </>
            ) : (
              (() => {
                const sel = availableOperators.find(op => String(op.CashierId) === String(selectedCashierId));
                return (
                  <>
                    <Ionicons name="person-circle-outline" size={18} color={Theme.primary} />
                    <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: Theme.textPrimary }} numberOfLines={1}>
                      {sel ? `${sel.CashierName} ${sel.UserLogin && sel.UserLogin !== '-' ? `(@${sel.UserLogin})` : ''}` : `User ID: ${selectedCashierId}`}
                    </Text>
                  </>
                );
              })()
            )}
          </View>
          <Ionicons name="chevron-down" size={18} color={Theme.primary} />
        </TouchableOpacity>
      </View>

      {/* Operator Dropdown Options Modal */}
      <Modal
        visible={showUserDropdown}
        transparent
        animationType="fade"
        onRequestClose={() => setShowUserDropdown(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowUserDropdown(false)}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.4)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 20
          }}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={{
              width: SCREEN_W >= 600 ? 420 : '95%',
              maxHeight: '70%',
              backgroundColor: Theme.bgCard,
              borderRadius: 16,
              padding: 16,
              borderWidth: 1.5,
              borderColor: Theme.border,
              ...Platform.select({
                web: { boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }
              }) as any
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: Theme.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="filter-outline" size={20} color={Theme.primary} />
                <Text style={{ fontFamily: Fonts.bold, fontSize: 15, color: Theme.textPrimary }}>
                  Select User Sales View
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowUserDropdown(false)}>
                <Ionicons name="close" size={20} color={Theme.textMuted} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 350 }}>
              {/* Whole Sales Option */}
              <TouchableOpacity
                onPress={() => {
                  setSelectedCashierId("ALL");
                  setShowUserDropdown(false);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 12,
                  borderRadius: 10,
                  backgroundColor: selectedCashierId === "ALL" ? (Theme.primary + '15') : 'transparent',
                  marginBottom: 6,
                  borderWidth: 1,
                  borderColor: selectedCashierId === "ALL" ? Theme.primary : 'transparent'
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="globe-outline" size={18} color={selectedCashierId === "ALL" ? Theme.primary : Theme.textSecondary} />
                  <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: selectedCashierId === "ALL" ? Theme.primary : Theme.textPrimary }}>
                    Whole Sales (All Users)
                  </Text>
                </View>
                {selectedCashierId === "ALL" && (
                  <Ionicons name="checkmark-circle" size={18} color={Theme.primary} />
                )}
              </TouchableOpacity>

              {/* Individual Users Options */}
              {availableOperators
                .filter((op) => {
                  const role = String(op.RoleName || op.RoleCode || op.UserGroupName || '').toUpperCase();
                  const login = String(op.UserLogin || op.UserName || '').toUpperCase();
                  const name = String(op.CashierName || op.FullName || '').toUpperCase();
                  // Exclude waiter, void, kds user groups / usernames
                  if (role.includes('WAITER') || role.includes('KDS') || role.includes('VOID') || role.includes('KITCHEN')) return false;
                  if (login.startsWith('WAITER') || login.startsWith('KDS') || login.startsWith('VOID') || login.startsWith('LOKI')) return false;
                  if (name.includes('WAITER') || name.includes('KDS') || name.includes('VOID')) return false;
                  return true;
                })
                .map((op) => {
                const isSel = String(selectedCashierId) === String(op.CashierId);
                const userNetSales = Number(op.TotalSales ?? op.TotalNetSales ?? op.TotalSubTotal ?? 0);
                return (
                  <TouchableOpacity
                    key={`sales-dropdown-op-${op.CashierId}`}
                    onPress={() => {
                      setSelectedCashierId(String(op.CashierId));
                      setShowUserDropdown(false);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: 12,
                      borderRadius: 10,
                      backgroundColor: isSel ? (Theme.primary + '15') : 'transparent',
                      marginBottom: 6,
                      borderWidth: 1,
                      borderColor: isSel ? Theme.primary : 'transparent'
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <Ionicons name="person-circle-outline" size={20} color={isSel ? Theme.primary : Theme.textSecondary} />
                      <View>
                        <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: isSel ? Theme.primary : Theme.textPrimary }}>
                          {op.CashierName} {op.UserLogin && op.UserLogin !== '-' ? `(@${op.UserLogin})` : ''}
                        </Text>
                        <Text style={{ fontFamily: Fonts.regular, fontSize: 11, color: Theme.textMuted }}>
                          Role: {op.RoleName || op.RoleCode || 'Cashier'} {userNetSales > 0 ? `• Sales: ₹${userNetSales.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : ''}
                        </Text>
                      </View>
                    </View>
                    {isSel && (
                      <Ionicons name="checkmark-circle" size={18} color={Theme.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Metrics Grid */}
      <View style={styles.metricsGrid}>
        {SCREEN_W >= 600 ? (
          <>
            {/* Row 1 */}
            <View style={styles.metricsRow}>
              {renderMetricTile("Total Sales", formatCurrency(filteredMetrics.TotalSales), "card-outline", Theme.success)}
              {renderMetricTile(
                "Total Collections",
                formatCurrency(
                  (filteredMetrics.TotalSales - filteredMetrics.Credit - filteredMetrics.FocSales) +
                  filteredMetrics.MemberPaymentsCollected +
                  filteredMetrics.CreditPaymentsCollected
                ),
                "wallet-outline",
                "#22c55e",
              )}
              {renderMetricTile("FOC Sales", formatCurrency(filteredMetrics.FocSales), "gift-outline", "#2563eb")}
            </View>

            {/* Row 2 */}
            <View style={styles.metricsRow}>
              {renderMetricTile("Service Charge", formatCurrency(filteredMetrics.ServiceCharge), "calculator-outline", Theme.primary)}
              {renderMetricTile("GST", formatCurrency(filteredMetrics.TotalTax), "receipt-outline", Theme.warning)}
              {renderMetricTile("Takeaway Charge", formatCurrency(filteredMetrics.TakeawayCharge), "basket-outline", "#ec4899")}
            </View>

            {/* Row 3 */}
            <View style={styles.metricsRow}>
              {renderMetricTile("Discount Sales", formatCurrency(filteredMetrics.TotalDiscount), "pricetag-outline", "#f97316")}
              {renderMetricTile(
                "Credit Collections",
                formatCurrency(filteredMetrics.CreditPaymentsCollected),
                "cash-outline",
                Theme.warning,
                false,
                undefined,
                () => router.push({ pathname: "/receivables", params: { from: "sales-report" } } as any)
              )}
              {renderMetricTile("Member Collections", formatCurrency(filteredMetrics.Member + filteredMetrics.MemberPaymentsCollected), "cash-outline", Theme.primary)}
            </View>

            {/* Row 4 */}
            <View style={styles.metricsRow}>
              {renderMetricTile("Total Orders", filteredMetrics.TotalTransactions + filteredMetrics.CancelledCount, "receipt-outline", Theme.warning)}
              {renderMetricTile("QR Orders Count", filteredMetrics.QROrderCount, "qr-code-outline", "#8b5cf6")}
              {renderMetricTile("Items Sold", filteredMetrics.TotalItems, "fast-food-outline", "#ec4899")}
            </View>

            {/* Row 5 (Centered 2 cards) */}
            <View style={[styles.metricsRow, styles.metricsRowCentered]}>
              {renderMetricTile("Total Voids", `${filteredMetrics.TotalVoids} (${formatCurrency(filteredMetrics.TotalVoidAmount)})`, "trash-outline", "#ef4444")}
              {renderMetricTile("Cancelled Orders", `${filteredMetrics.CancelledCount} (${formatCurrency(filteredMetrics.CancelledAmount)})`, "close-circle-outline", Theme.danger)}
            </View>
          </>
        ) : (
          <>
            <View style={styles.metricsRow}>
              {renderMetricTile("Total Sales", formatCurrency(filteredMetrics.TotalSales), "card-outline", Theme.success)}
              {renderMetricTile(
                "Total Collections",
                formatCurrency(
                  (filteredMetrics.TotalSales - filteredMetrics.Credit - filteredMetrics.FocSales) +
                  filteredMetrics.MemberPaymentsCollected +
                  filteredMetrics.CreditPaymentsCollected
                ),
                "wallet-outline",
                "#22c55e",
              )}
            </View>

            <View style={styles.metricsRow}>
              {renderMetricTile("FOC Sales", formatCurrency(filteredMetrics.FocSales), "gift-outline", "#2563eb")}
              {renderMetricTile("Service Charge", formatCurrency(filteredMetrics.ServiceCharge), "calculator-outline", Theme.primary)}
            </View>

            <View style={styles.metricsRow}>
              {renderMetricTile("GST", formatCurrency(filteredMetrics.TotalTax), "receipt-outline", Theme.warning)}
              {renderMetricTile("Takeaway Charge", formatCurrency(filteredMetrics.TakeawayCharge), "basket-outline", "#ec4899")}
            </View>

            <View style={styles.metricsRow}>
              {renderMetricTile("Discount Sales", formatCurrency(filteredMetrics.TotalDiscount), "pricetag-outline", "#f97316")}
              {renderMetricTile(
                "Credit Collections",
                formatCurrency(filteredMetrics.CreditPaymentsCollected),
                "cash-outline",
                Theme.warning,
                false,
                undefined,
                () => router.push({ pathname: "/receivables", params: { from: "sales-report" } } as any)
              )}
            </View>

            <View style={styles.metricsRow}>
              {renderMetricTile("Member Collections", formatCurrency(filteredMetrics.Member + filteredMetrics.MemberPaymentsCollected), "cash-outline", Theme.primary)}
              {renderMetricTile("Total Orders", filteredMetrics.TotalTransactions + filteredMetrics.CancelledCount, "receipt-outline", Theme.warning)}
            </View>

            <View style={styles.metricsRow}>
              {renderMetricTile("QR Orders Count", filteredMetrics.QROrderCount, "qr-code-outline", "#8b5cf6")}
              {renderMetricTile("Items Sold", filteredMetrics.TotalItems, "fast-food-outline", "#ec4899")}
            </View>

            <View style={styles.metricsRow}>
              {renderMetricTile("Total Voids", `${filteredMetrics.TotalVoids} (${formatCurrency(filteredMetrics.TotalVoidAmount)})`, "trash-outline", "#ef4444")}
              {renderMetricTile("Cancelled Orders", `${filteredMetrics.CancelledCount} (${formatCurrency(filteredMetrics.CancelledAmount)})`, "close-circle-outline", Theme.danger)}
            </View>
          </>
        )}
      </View>

      <View style={styles.reportSwitchRow}>
        <TouchableOpacity
          onPress={() => handleReportPress("CATEGORY")}
          style={[
            styles.reportSwitchBtn,
            detailReportType === "CATEGORY" && styles.activeReportSwitchBtn,
          ]}
        >
          <Ionicons
            name="albums-outline"
            size={16}
            color={detailReportType === "CATEGORY" ? "#fff" : Theme.primary}
          />
          <Text
            style={[
              styles.reportSwitchText,
              detailReportType === "CATEGORY" && styles.activeReportSwitchText,
            ]}
          >
            Category Sales Report
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => handleReportPress("DISH")}
          style={[
            styles.reportSwitchBtn,
            detailReportType === "DISH" && styles.activeReportSwitchBtn,
          ]}
        >
          <Ionicons
            name="restaurant-outline"
            size={16}
            color={detailReportType === "DISH" ? "#fff" : Theme.primary}
          />
          <Text
            style={[
              styles.reportSwitchText,
              detailReportType === "DISH" && styles.activeReportSwitchText,
            ]}
          >
            Item Sales Report
          </Text>
        </TouchableOpacity>

      </View>

      {renderDetailReport()}

      {/* Charts Section */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chartsScrollContent}
      >
        <View style={styles.chartsContainer}>
          <View
            style={[
              styles.chartCard,
              {
                width:
                  SCREEN_W > 768 ? Math.max(300, (SCREEN_W - 64) / 3) : 300,
              },
            ]}
          >
            <View style={styles.chartCardHeader}>
              <Text style={styles.cardTitle}>PAYMENT CHANNEL MIX</Text>
              <Ionicons name="pie-chart" size={14} color={Theme.primary} />
            </View>
            <View style={styles.chartContainer}>
              {paymentBreakdownTotal > 0 ? (
                <View style={styles.pieChartWrapper}>
                  <PieChart
                    data={displayedBreakdownModes.map((m) => {
                      const key = m.payMode.toUpperCase().trim();
                      return {
                        value: paymentBreakdownMetrics[key] || 0,
                        color: getPayModeColor(key),
                        label: key,
                      };
                    }).filter((d) => d.value > 0)}
                    donut
                    radius={70}
                    innerRadius={50}
                    innerCircleColor={Theme.bgCard}
                    strokeColor={Theme.bgCard}
                    strokeWidth={2}
                    centerLabelComponent={() => (
                      <View style={{ alignItems: "center", justifyContent: "center" }}>
                        <Text style={{ fontSize: 9, fontFamily: Fonts.bold, color: Theme.textMuted, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          Total
                        </Text>
                        <Text style={{ fontSize: 13, fontFamily: Fonts.black, color: Theme.textPrimary, marginTop: 2 }}>
                          {formatCurrency(paymentBreakdownTotal)}
                        </Text>
                      </View>
                    )}
                  />

                  {/* Legend below the chart */}
                  <View style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    justifyContent: "center",
                    gap: 6,
                    marginTop: 16,
                    paddingHorizontal: 4
                  }}>
                    {paymentMixCenterRows.map((row) => (
                      <View
                        key={row.key}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          backgroundColor: Theme.bgMuted,
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          borderRadius: 6,
                          borderWidth: 1,
                          borderColor: Theme.border,
                          gap: 4
                        }}
                      >
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: row.color }} />
                        <Text style={{ fontSize: 9, fontFamily: Fonts.bold, color: Theme.textPrimary }}>
                          {row.key}
                        </Text>
                        <Text style={{ fontSize: 9, fontFamily: Fonts.medium, color: row.color }}>
                          {row.pct.toFixed(0)}%
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : (
                <View style={styles.emptyChartPlaceholder}>
                  <Ionicons
                    name="pie-chart-outline"
                    size={40}
                    color={Theme.textMuted}
                  />
                  <Text style={styles.emptyChartText}>No sales data</Text>
                </View>
              )}
            </View>
          </View>
          <View
            style={[
              styles.chartCard,
              {
                width:
                  SCREEN_W > 768 ? Math.max(300, (SCREEN_W - 64) / 3) : 300,
              },
            ]}
          >
            <View style={styles.chartCardHeader}>
              <Text style={styles.cardTitle}>ORDER TYPES</Text>
              <Ionicons name="layers-outline" size={14} color={Theme.primary} />
            </View>
            <View style={styles.orderTypeStats}>
              {(() => {
                // Use dateScopedSales (date-only filtered) so payment mode filters
                // don't distort the order type split counts
                const activeSales = dateScopedSales.filter(s => !s.IsCancelled);
                const isTakeaway = (s: any) =>
                  s.OrderType === "TAKEAWAY" ||
                  s.Section === "TAKEAWAY" ||
                  (!s.OrderType && s.TableNo && String(s.TableNo).startsWith("TW-"));
                const isQR = (s: any) => s.entryStatus === "q" || s.entry_status === "q" || s.isQROrder;
                const takeaway = activeSales.filter(isTakeaway).length;
                const dineIn = activeSales.filter(
                  (s) => !isTakeaway(s),
                ).length;
                const totalOrderTypes = dineIn + takeaway;
                return (
                  <>
                    <View style={styles.statRow}>
                      <View style={styles.statLabel}>
                        <Text style={styles.statIcon}>🪑</Text>
                        <Text style={styles.statName}>Dine-In</Text>
                      </View>
                      <Text
                        style={[styles.statValue, { color: Theme.primary }]}
                      >
                        {totalOrderTypes > 0 ? ((dineIn / totalOrderTypes) * 100).toFixed(0) : 0}% ({dineIn})
                      </Text>
                    </View>
                    <View style={styles.statRow}>
                      <View style={styles.statLabel}>
                        <Text style={styles.statIcon}>🛍️</Text>
                        <Text style={styles.statName}>Takeaway</Text>
                      </View>
                      <Text
                        style={[styles.statValue, { color: Theme.warning }]}
                      >
                        {totalOrderTypes > 0 ? ((takeaway / totalOrderTypes) * 100).toFixed(0) : 0}% ({takeaway})
                      </Text>
                    </View>
                  </>
                );
              })()}
            </View>
          </View>

          <View
            style={[
              styles.chartCard,
              {
                width:
                  SCREEN_W > 768 ? Math.max(300, (SCREEN_W - 64) / 3) : 300,
              },
            ]}
          >
            <View style={styles.chartCardHeader}>
              <Text style={styles.cardTitle}>KEY METRICS</Text>
              <Ionicons
                name="bar-chart-outline"
                size={14}
                color={Theme.primary}
              />
            </View>
            <View style={styles.metricsStats}>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Avg Check</Text>
                <Text style={styles.metricValueSmall}>
                  {formatCurrency(avgOrder)}
                </Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Conversion</Text>
                <Text style={styles.metricValueSmall}>
                  {filteredMetrics.TotalTransactions}
                </Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>QR Orders</Text>
                <Text style={styles.metricValueSmall}>
                  {filteredMetrics.QROrderCount}
                </Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Avg Items</Text>
                <Text style={styles.metricValueSmall}>
                  {filteredMetrics.TotalTransactions > 0
                    ? (
                      filteredMetrics.TotalItems /
                      filteredMetrics.TotalTransactions
                    ).toFixed(1)
                    : 0}
                </Text>
              </View>
              <View style={styles.metricRow}>
                <Text style={styles.metricLabel}>Per Item</Text>
                <Text style={styles.metricValueSmall}>
                  {formatCurrency(
                    filteredMetrics.TotalItems > 0
                      ? filteredMetrics.TotalSales / filteredMetrics.TotalItems
                      : 0,
                  )}
                </Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Breakdown */}
      <View style={[styles.breakdownCard, SCREEN_W < 480 && { padding: 12, borderRadius: 16 }]}>
        <View style={styles.chartCardHeader}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={styles.cardTitle}>PAYMENT BREAKDOWN</Text>
            <Ionicons name="wallet-outline" size={14} color={Theme.primary} />
          </View>
          {activePaymentModes.length < (displayedBreakdownModes.length + 1) && (
            <TouchableOpacity
              onPress={() => {
                if (Platform.OS !== "web") {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
                setActivePaymentModes([...displayedBreakdownModes.map(m => m.payMode.toUpperCase().trim()), "VOID"]);
              }}
              style={{
                backgroundColor: Theme.primary + "15",
                paddingHorizontal: 8,
                paddingVertical: 4,
                borderRadius: 6,
                borderWidth: 1,
                borderColor: Theme.primary + "30",
              }}
            >
              <Text style={{ color: Theme.primary, fontFamily: Fonts.black, fontSize: 10, letterSpacing: 0.5 }}>
                SHOW ALL
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <View
          style={[
            styles.breakdownRow,
            {
              flexWrap: "wrap",
              justifyContent: "flex-start",
              width: "100%",
              rowGap: SCREEN_W < 480 ? 10 : 12,
              columnGap: SCREEN_W < 480 ? 10 : 12,
            }
          ]}
          onLayout={(e) => setBreakdownRowWidth(e.nativeEvent.layout.width)}
        >
          {displayedBreakdownModes.map((item, idx) => {
            const key = item.payMode.toUpperCase().trim();
            const label = item.description || item.payMode;
            const val = paymentBreakdownMetrics[key] || 0;
            const outstanding = key === "CREDIT" ? paymentBreakdownMetrics["CREDIT_OUTSTANDING"] : undefined;
            const color = getPayModeColor(key);
            const iconName = getPayModeIoniconName(key);

            // Responsive column grid: 2 cols on mobile (<480), 4 on tablet (480-900), 7 on laptop/desktop (>=900)
            const numCols = SCREEN_W >= 900 ? 7 : SCREEN_W >= 480 ? 4 : 2;
            const gap = SCREEN_W < 480 ? 10 : 12;
            const containerW = breakdownRowWidth > 0 ? breakdownRowWidth : Math.max(SCREEN_W - 56, 280);
            const itemW = Math.floor((containerW - (numCols - 1) * gap) / numCols);

            const isSomeFilterApplied = activePaymentModes.length < (displayedBreakdownModes.length + 1);
            const isThisActive = activePaymentModes.includes(key);
            const isActive = isSomeFilterApplied && isThisActive;
            const isInactive = isSomeFilterApplied && !isThisActive;

            return (
              <TouchableOpacity
                key={idx}
                activeOpacity={0.7}
                onPress={() => handleBreakdownPress(item.payMode)}
                style={[
                  styles.breakdownItem,
                  {
                    width: itemW,
                    paddingVertical: SCREEN_W < 480 ? 12 : 14,
                    paddingHorizontal: SCREEN_W < 480 ? 8 : 10,
                  },
                  {
                    borderColor: hexToRgba(color, 0.22),
                    borderWidth: 1.5,
                    backgroundColor: "#ffffff",
                  },
                  isActive && {
                    borderColor: color,
                    borderWidth: 2,
                    backgroundColor: hexToRgba(color, 0.05),
                    ...Theme.shadowSm,
                  },
                  isInactive && {
                    opacity: 0.35,
                    borderColor: Theme.border,
                  }
                ]}
              >
                {/* Icon circle */}
                <View style={[
                  styles.breakdownIconCircle,
                  {
                    backgroundColor: hexToRgba(color, 0.12),
                    width: SCREEN_W < 480 ? 36 : 40,
                    height: SCREEN_W < 480 ? 36 : 40,
                    borderRadius: SCREEN_W < 480 ? 18 : 20,
                  }
                ]}>
                  <Ionicons name={iconName} size={SCREEN_W < 480 ? 18 : 20} color={color} />
                </View>
                <Text
                  style={[styles.breakdownLabel, { fontSize: SCREEN_W < 480 ? 10 : 11 }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                >
                  {label}
                </Text>
                <Text
                  style={[styles.breakdownValue, { color, fontSize: SCREEN_W < 480 ? 14 : 16 }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >
                  {formatCurrency(val)}
                </Text>
                {outstanding !== undefined && (
                  <Text
                    style={{ fontSize: SCREEN_W < 480 ? 9 : 10, fontFamily: Fonts.bold, color: Theme.textMuted, marginTop: 1 }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                  >
                    Pending: {formatCurrency(outstanding)}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={{ height: 1, backgroundColor: Theme.border, marginVertical: 16, opacity: 0.5 }} />

        <View style={{
          backgroundColor: Theme.bgCard,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: Theme.border,
          padding: SCREEN_W < 480 ? 12 : 16,
          gap: SCREEN_W < 480 ? 10 : 12,
          ...Theme.shadowSm
        }}>
          <Text style={{ fontFamily: Fonts.black, fontSize: SCREEN_W < 480 ? 10 : 11, color: Theme.textSecondary, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 2 }}>
            Reconciliation Summary
          </Text>

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontFamily: Fonts.extraBold, fontSize: SCREEN_W < 480 ? 12 : 13, color: Theme.textPrimary }}>Total Sales Volume</Text>
            <Text 
              style={{ fontFamily: Fonts.black, fontSize: SCREEN_W < 480 ? 13 : 14, color: Theme.textPrimary, textAlign: "right" }}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {formatCurrency(paymentBreakdownTotal)}
            </Text>
          </View>

          <View style={{ height: 1, backgroundColor: Theme.border, opacity: 0.3 }} />

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={{ fontFamily: Fonts.bold, fontSize: SCREEN_W < 480 ? 12 : 13, color: "#ec4899" }}>Member Accounts</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text 
                style={{ fontFamily: Fonts.bold, fontSize: SCREEN_W < 480 ? 11 : 12, color: Theme.success, textAlign: "right" }}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                Sales: {formatCurrency(paymentBreakdownMetrics.MEMBER || 0)}
              </Text>
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: Theme.border, opacity: 0.3 }} />

          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={{ fontFamily: Fonts.bold, fontSize: SCREEN_W < 480 ? 12 : 13, color: "#e11d48" }}>Credit Customers</Text>
              <Text style={{ fontFamily: Fonts.medium, fontSize: SCREEN_W < 480 ? 8 : 9, color: Theme.textMuted, marginTop: 1 }}>Collections vs New Outstanding</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text 
                style={{ fontFamily: Fonts.bold, fontSize: SCREEN_W < 480 ? 11 : 12, color: Theme.success, textAlign: "right" }}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                Collected: {formatCurrency(filteredMetrics.CreditPaymentsCollected)}
              </Text>
              <Text 
                style={{ fontFamily: Fonts.bold, fontSize: SCREEN_W < 480 ? 11 : 12, color: "#e11d48", marginTop: 1, textAlign: "right" }}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                Pending: {formatCurrency(filteredMetrics.CreditOutstanding)}
              </Text>
            </View>
          </View>

          <View style={{ backgroundColor: Theme.success + "10", borderRadius: 12, padding: SCREEN_W < 480 ? 10 : 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4, borderWidth: 1, borderColor: Theme.success + "20" }}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={{ fontFamily: Fonts.black, fontSize: SCREEN_W < 480 ? 11.5 : 13, color: Theme.success }}>Total Collections Volume</Text>
              <Text style={{ fontFamily: Fonts.medium, fontSize: SCREEN_W < 480 ? 8 : 9, color: Theme.textMuted, marginTop: 1 }}>Cash Received (excl. Credit Sales) + Payments Collected</Text>
            </View>
            <Text 
              style={{ fontFamily: Fonts.black, fontSize: SCREEN_W < 480 ? 15 : 18, color: Theme.success, textAlign: "right" }}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {formatCurrency(
                (paymentBreakdownTotal - (paymentBreakdownMetrics.CREDIT || 0)) +
                filteredMetrics.MemberPaymentsCollected +
                filteredMetrics.CreditPaymentsCollected
              )}
            </Text>
          </View>
        </View>
      </View>

      {/* Recent Transactions Header */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>RECENT TRANSACTIONS</Text>
        <TouchableOpacity onPress={() => fetchData()}>
          <Text style={styles.seeAllText}>REFRESH</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: Theme.bgMain }}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.overlay}>

          <FlatList
            data={filteredSales}
            renderItem={({ item }: { item: any }) => (
              <TransactionCard
                item={item}
                onPress={handleOrderPress}
                formatOrderId={formatOrderId}
                formatCurrency={formatCurrency}
              />
            )}
            keyExtractor={(item: any) => item.SettlementID}
            ListHeaderComponent={renderHeader}
            contentContainerStyle={{ paddingBottom: 10, paddingHorizontal: 8 }}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={Theme.primary}
              />
            }
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={Platform.OS !== "web"}
          />

          {/* Modal Overlay */}
          <Modal visible={!!selectedOrder} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <TouchableOpacity
                activeOpacity={1}
                style={styles.modalDismiss}
                onPress={() => {
                  setSelectedOrder(null);
                  setOrderDetails([]);
                }}
              />
              <View style={styles.modalContent}>
                <View
                  style={[styles.modalHeader, { alignItems: "flex-start" }]}
                >
                  <View style={{ flex: 1 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        flexWrap: "wrap",
                        gap: 8,
                      }}
                    >
                      <Text
                        style={[
                          styles.modalTitle,
                          { fontSize: SCREEN_W < 450 ? 14 : 16 },
                        ]}
                      >
                        Order #{formatOrderId(selectedOrder)}
                      </Text>
                      <View
                        style={[
                          styles.paidBadgeSmall,
                          {
                            backgroundColor: selectedOrder?.IsCancelled ? Theme.danger + "15" : Theme.primary + "15",
                            borderColor: selectedOrder?.IsCancelled ? Theme.danger + "30" : Theme.primary + "30",
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            borderRadius: 6,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: selectedOrder?.IsCancelled ? Theme.danger : Theme.primary,
                            fontFamily: Fonts.black,
                            fontSize: 9,
                          }}
                        >
                          {payModeText}
                        </Text>
                      </View>
                    </View>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        flexWrap: "wrap",
                        marginTop: 6,
                        gap: 10,
                      }}
                    >
                      <Text style={[styles.modalSub, { fontSize: 10 }]}>
                        {(() => {
                          const dateObj = parseDatabaseDate(selectedOrder?.SettlementDate || selectedOrder?.LastSettlementDate);
                          if (!dateObj || isNaN(dateObj.getTime())) return "N/A";
                          const datePart = new Intl.DateTimeFormat('en-GB', {
                            timeZone: 'Asia/Singapore',
                            day: 'numeric',
                            month: 'numeric',
                            year: 'numeric'
                          }).format(dateObj);
                          const timePart = new Intl.DateTimeFormat('en-US', {
                            timeZone: 'Asia/Singapore',
                            hour: 'numeric',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: true
                          }).format(dateObj);
                          return `${datePart}, ${timePart}`;
                        })()}
                      </Text>
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <Ionicons
                          name={
                            selectedOrder?.OrderType === "TAKEAWAY"
                              ? "bag-handle"
                              : "restaurant"
                          }
                          size={11}
                          color={Theme.textMuted}
                        />
                        <Text
                          style={[
                            styles.modalSub,
                            {
                              color: Theme.textPrimary,
                              fontFamily: Fonts.bold,
                              fontSize: 10,
                            },
                          ]}
                        >
                          {selectedOrder?.OrderType === "TAKEAWAY"
                            ? "Takeaway"
                            : `Table ${selectedOrder?.TableNo || "N/A"}${selectedOrder?.Section ? ` • ${selectedOrder.Section}` : ""}`}
                        </Text>
                        {selectedOrder?.SER_NAME && (
                          <View
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 4,
                              backgroundColor: Theme.primaryLight,
                              paddingHorizontal: 6,
                              paddingVertical: 2,
                              borderRadius: 4,
                            }}
                          >
                            <Ionicons
                              name="person"
                              size={9}
                              color={Theme.primary}
                            />
                            <Text
                              style={{
                                color: Theme.primary,
                                fontFamily: Fonts.bold,
                                fontSize: 9,
                              }}
                            >
                              {selectedOrder.SER_NAME}
                            </Text>
                          </View>
                        )}
                      </View>
                      {(selectedOrder?.GuestName || selectedOrder?.Pax) && (
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            flexWrap: "wrap",
                            marginTop: 6,
                            gap: 10,
                          }}
                        >
                          {selectedOrder?.GuestName && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              <Ionicons name="person-outline" size={11} color={Theme.textSecondary} />
                              <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.textPrimary }}>
                                Guest: {selectedOrder.GuestName}
                              </Text>
                            </View>
                          )}
                          {selectedOrder?.Pax && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                              <Ionicons name="people-outline" size={11} color={Theme.textSecondary} />
                              <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.textPrimary }}>
                                {selectedOrder.Pax} Pax
                              </Text>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={() => setSelectedOrder(null)}
                    style={{ marginLeft: 10 }}
                  >
                    <Ionicons
                      name="close"
                      size={24}
                      color={Theme.textMuted}
                    />
                  </TouchableOpacity>
                </View>

                {/* 🚨 CANCELLED BANNER - Compact Version */}
                {selectedOrder?.IsCancelled ? (
                  <View style={styles.cancelledOrderBadge}>
                    <View style={styles.cancelledBadgeMain}>
                      <Ionicons name="alert-circle" size={16} color={Theme.danger} />
                      <Text style={styles.cancelledBadgeText}>ORDER CANCELLED</Text>
                      <View style={styles.cancelledReasonBadge}>
                        <Text style={styles.cancelledReasonText}>{selectedOrder.CancellationReason || "No reason"}</Text>
                      </View>
                    </View>
                    <View style={styles.cancelledDetailRow}>
                      <Text style={styles.cancelledDetailText}>By: {selectedOrder.CancelledByUserName || "SYSTEM"}</Text>
                      <Text style={styles.cancelledDetailText}>
                        Date: {(() => {
                          if (!selectedOrder.CancelledDate) return "N/A";
                          const dateObj = parseDatabaseDate(selectedOrder.CancelledDate);
                          const datePart = new Intl.DateTimeFormat('en-GB', {
                            timeZone: 'Asia/Singapore',
                            day: 'numeric',
                            month: 'numeric',
                            year: 'numeric'
                          }).format(dateObj);
                          const timePart = new Intl.DateTimeFormat('en-US', {
                            timeZone: 'Asia/Singapore',
                            hour: 'numeric',
                            minute: '2-digit',
                            second: '2-digit',
                            hour12: true
                          }).format(dateObj);
                          return `${datePart}, ${timePart}`;
                        })()}
                      </Text>
                    </View>
                  </View>
                ) : null}
                <View style={styles.modalDivider} />
                <ScrollView
                  style={styles.itemsList}
                  showsVerticalScrollIndicator={false}
                >
                  {selectedOrder?.isMerged && (
                    <View style={styles.detailMergeContainer}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                        <Ionicons name="git-merge-outline" size={14} color="#ea580c" />
                        <Text style={styles.detailMergeTitle}>Merged Tables & Bills</Text>
                      </View>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={{ gap: 6, paddingBottom: 2 }}
                        style={{ width: '100%' }}
                      >
                        {selectedOrder.mergedDetails?.split(', ').filter(Boolean).map((detail: string, index: number) => (
                          <View key={index} style={styles.childBillBadge}>
                            <Text style={styles.childBillBadgeText}>{detail}</Text>
                          </View>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                  {selectedOrder?.isSplit && (
                    <View style={styles.detailSplitContainer}>
                      <Ionicons name="cut-outline" size={14} color="#2563eb" />
                      <Text style={styles.detailSplitText}>
                        Split Bill Payment: <Text style={{ fontFamily: Fonts.black }}>{selectedOrder.splitNo}</Text>
                      </Text>
                    </View>
                  )}
                  {loadingDetails ? (
                    <View style={{ paddingVertical: 20 }}>
                      <ActivityIndicator color={Theme.primary} />
                    </View>
                  ) : (
                    orderDetails.map((item, idx) => (
                      <View
                        key={idx}
                        style={[
                          styles.orderItemRow,
                          idx !== orderDetails.length - 1 && {
                            borderBottomWidth: 1,
                            borderBottomColor: Theme.border + "30",
                            paddingBottom: 12,
                          },
                          item.Status === "VOIDED" && {
                            backgroundColor: "#fff1f2",
                            marginHorizontal: -12,
                            paddingHorizontal: 12,
                            borderRadius: 8,
                            opacity: 0.8,
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.qtyBadgeSmall,
                            {
                              backgroundColor:
                                item.Status === "VOIDED"
                                  ? "#fecaca"
                                  : Theme.primary + "10",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.orderItemQty,
                              {
                                width: "auto",
                                color:
                                  item.Status === "VOIDED"
                                    ? "#991b1b"
                                    : Theme.primary,
                              },
                            ]}
                          >
                            {item.Qty}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text
                            numberOfLines={1}
                            style={[
                              styles.orderItemName,
                              item.Status === "VOIDED" && {
                                textDecorationLine: "line-through",
                                color: "#991b1b",
                              },
                            ]}
                          >
                            {item.DishName}
                            {item.Status === "VOIDED" && (
                              <Text
                                style={{
                                  color: "#dc2626",
                                  fontSize: 9,
                                  fontFamily: Fonts.black,
                                  textDecorationLine: "none",
                                }}
                              >
                                {" "}[VOID]
                              </Text>
                            )}
                          </Text>
                          {item.SongName ? (
                            <Text
                              style={{
                                fontSize: 11,
                                color: "#666",
                                marginTop: 2,
                              }}
                            >
                              🎵 {item.SongName}
                            </Text>
                          ) : null}
                          {item.modifiers &&
                            Array.isArray(item.modifiers) &&
                            item.modifiers.filter((m: any) => {
                              const name = (m.ModifierName || m.modifierName || m.name || "").trim();
                              return name.length > 0;
                            }).length > 0 && (
                              <View style={styles.modifierPillsContainer}>
                                {item.modifiers
                                  .filter((m: any) => {
                                    const name = (m.ModifierName || m.modifierName || m.name || "").trim();
                                    return name.length > 0;
                                  })
                                  .map((m: any, mIdx: number) => {
                                    const amt = Number(m.Amount || m.amount || 0);
                                    const displayName = (m.ModifierName || m.name || "").replace(/^INSTR:\s*/i, "").trim();
                                    return (
                                      <View key={mIdx} style={styles.modifierPill}>
                                        <Text style={styles.modifierPillText}>
                                          + {displayName}
                                          {amt > 0 ? ` ($${amt.toFixed(2)})` : ""}
                                        </Text>
                                      </View>
                                    );
                                  })}
                              </View>
                            )}
                          {item.isCombo && item.comboSelections && Array.isArray(item.comboSelections) && (
                            <View style={{ marginTop: 6, gap: 4, paddingLeft: 4 }}>
                              {item.comboSelections
                                .filter((group: any) => group.items && group.items.length > 0)
                                .map((group: any, gIdx: number) => (
                                  <View key={`g-${gIdx}`} style={{ marginTop: 2 }}>
                                    <Text style={{ fontSize: 11, fontFamily: Fonts.bold, color: Theme.primary }}>
                                      {group.groupName}:
                                    </Text>
                                    {(group.items || []).map((opt: any, oIdx: number) => {
                                      const effectiveAdd = (parseFloat(opt.surcharge || 0) + parseFloat(opt.dishPrice || 0));
                                      return (
                                        <Text key={`o-${oIdx}`} style={{ fontSize: 11, color: Theme.textSecondary || "#666", paddingLeft: 8, marginTop: 1 }}>
                                          ↳ {opt.name}{effectiveAdd > 0 ? ` (+$${effectiveAdd.toFixed(2)})` : ""}
                                        </Text>
                                      );
                                    })}
                                  </View>
                                ))}
                            </View>
                          )}
                          {/* Unit price row — strikethrough if item has discount */}
                          {item.DiscountType === "FOC" ? (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <Text style={{ color: Theme.textMuted, fontSize: 10, fontFamily: Fonts.bold, textDecorationLine: "line-through" }}>
                                UNIT: ${(item.Price || 0).toFixed(2)}
                              </Text>
                              <Text style={{ color: "#3b82f6", fontSize: 10, fontFamily: Fonts.black }}>
                                $0.00
                              </Text>
                              <View style={{ backgroundColor: "#3b82f615", borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
                                <Text style={{ color: "#3b82f6", fontSize: 9, fontFamily: Fonts.black }}>FOC</Text>
                              </View>
                            </View>
                          ) : item.DiscountAmount > 0 ? (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <Text style={{ color: Theme.textMuted, fontSize: 10, fontFamily: Fonts.bold, textDecorationLine: "line-through" }}>
                                UNIT: ${(item.Price || 0).toFixed(2)}
                              </Text>
                              {/* Discounted unit price */}
                              {(() => {
                                const discountedUnit =
                                  item.DiscountType === "percentage"
                                    ? item.Price * (1 - item.DiscountAmount / 100)
                                    : Math.max(0, item.Price - item.DiscountAmount);
                                const badge =
                                  item.DiscountType === "percentage"
                                    ? `-${item.DiscountAmount}%`
                                    : `-$${item.DiscountAmount.toFixed(2)}`;
                                return (
                                  <>
                                    <Text style={{ color: Theme.success, fontSize: 10, fontFamily: Fonts.black }}>
                                      ${discountedUnit.toFixed(2)}
                                    </Text>
                                    <View style={{ backgroundColor: Theme.success + "15", borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
                                      <Text style={{ color: Theme.success, fontSize: 9, fontFamily: Fonts.black }}>{badge}</Text>
                                    </View>
                                  </>
                                );
                              })()}
                            </View>
                          ) : (
                            <Text style={{ color: Theme.textMuted, fontSize: 10, fontFamily: Fonts.bold }}>
                              UNIT: ${(item.Price || 0).toFixed(2)}
                            </Text>
                          )}
                        </View>
                        {/* Line total */}
                        {item.DiscountType === "FOC" ? (
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={{ color: Theme.textMuted, fontSize: 10, fontFamily: Fonts.bold, textDecorationLine: "line-through" }}>
                              ${(item.Price * item.Qty).toFixed(2)}
                            </Text>
                            <Text style={[styles.orderItemPrice, { color: "#3b82f6" }]}>
                              $0.00
                            </Text>
                          </View>
                        ) : item.DiscountAmount > 0 ? (
                          <View style={{ alignItems: "flex-end" }}>
                            <Text style={{ color: Theme.textMuted, fontSize: 10, fontFamily: Fonts.bold, textDecorationLine: "line-through" }}>
                              ${(item.Price * item.Qty).toFixed(2)}
                            </Text>
                            <Text style={[styles.orderItemPrice, { color: Theme.success }]}>
                              {item.DiscountType === "percentage"
                                ? `$${(item.Price * (1 - item.DiscountAmount / 100) * item.Qty).toFixed(2)}`
                                : `$${(Math.max(0, item.Price - item.DiscountAmount) * item.Qty).toFixed(2)}`}
                            </Text>
                          </View>
                        ) : (
                          <Text
                            style={[
                              styles.orderItemPrice,
                              item.Status === "VOIDED" && {
                                textDecorationLine: "line-through",
                                color: "#991b1b",
                              },
                            ]}
                          >
                            ${(item.Price * item.Qty).toFixed(2)}
                          </Text>
                        )}
                      </View>
                    ))
                  )}
                </ScrollView>

                {/* Member / Credit Customer Info */}
                {selectedOrder?.CustomerName && (
                  <View style={{ marginBottom: 12, paddingHorizontal: 4 }}>
                    <Text style={{ fontSize: 13, fontFamily: Fonts.black, color: Theme.textPrimary }}>
                      {String(selectedOrder.PayMode || '').toUpperCase().includes("MEMBER") ? "Member" : "Credit Customer"}: {selectedOrder.CustomerName}
                    </Text>
                  </View>
                )}

                {/* Payment Details Breakdown */}
                {displayedPayments.length > 0 && (
                  <View style={{ marginTop: 12, marginBottom: 4, paddingHorizontal: 4 }}>
                    <Text style={{ fontSize: 12, fontFamily: Fonts.bold, color: Theme.textSecondary, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      Payment Details
                    </Text>
                    {displayedPayments.map((pm, idx) => (
                      <View key={idx} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 }}>
                        <Text style={{ fontSize: 13, fontFamily: Fonts.semiBold, color: Theme.textPrimary }}>
                          {pm.PayModeName || 'CASH'}
                          {pm.ReferenceNo ? ` (${pm.ReferenceNo})` : ''}
                        </Text>
                        <Text style={{ fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary }}>
                          {formatCurrency(pm.Amount)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                <View style={styles.modalDivider} />
                {/* Bill-level breakdown: Subtotal → Discount → Total */}
                <View style={{ backgroundColor: Theme.primary + "05", padding: 12, borderRadius: 12, marginBottom: 16, gap: 6 }}>
                  {/* Show subtotal + discount rows only when a bill discount was applied */}
                  {/* Show subtotal row when discount, service charge, or tax is applied */}
                  {(selectedOrder?.DiscountAmount > 0 || Number(selectedOrder?.ServiceCharge) > 0 || Number(selectedOrder?.TotalTax) > 0 || Number(selectedOrder?.TakeawayCharge) > 0) && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ fontSize: 12, fontFamily: Fonts.semiBold, color: Theme.textSecondary }}>Subtotal</Text>
                      <Text style={{ fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary }}>
                        {formatCurrency(selectedOrder?.SubTotal)}
                      </Text>
                    </View>
                  )}
                  {(() => {
                    const regularDiscountAmt = Number(selectedOrder?.DiscountAmount || 0);

                    return (
                      <>
                        {regularDiscountAmt > 0 && (
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                              <Text style={{ fontSize: 12, fontFamily: Fonts.semiBold, color: Theme.success }}>Discount</Text>
                              {selectedOrder?.DiscountType && (
                                <View style={{ backgroundColor: Theme.success + "15", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                                  <Text style={{ fontSize: 9, fontFamily: Fonts.black, color: Theme.success }}>
                                    {selectedOrder.DiscountType === "percentage"
                                      ? `${selectedOrder.DiscountPercentage}%`
                                      : "FIXED"}
                                  </Text>
                                </View>
                              )}
                            </View>
                            <Text style={{ fontSize: 13, fontFamily: Fonts.bold, color: Theme.success }}>
                              -{formatCurrency(regularDiscountAmt)}
                            </Text>
                          </View>
                        )}
                      </>
                    );
                  })()}
                  {Number(selectedOrder?.ServiceCharge) > 0 && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ fontSize: 12, fontFamily: Fonts.semiBold, color: Theme.textSecondary }}>{String(selectedOrder?.OrderType || selectedOrder?.orderType || "").toUpperCase().includes("TAKEAWAY") || String(selectedOrder?.TableNo || selectedOrder?.tableNo || "").toUpperCase().startsWith("TW") ? "TW Service Charge" : "Item Service Charge"}</Text>
                      <Text style={{ fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary }}>
                        {formatCurrency(selectedOrder?.ServiceCharge)}
                      </Text>
                    </View>
                  )}
                  {Number(selectedOrder?.TakeawayCharge) > 0 && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ fontSize: 12, fontFamily: Fonts.semiBold, color: Theme.textSecondary }}>Takeaway Charge</Text>
                      <Text style={{ fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary }}>
                        {formatCurrency(selectedOrder?.TakeawayCharge)}
                      </Text>
                    </View>
                  )}
                  {Number(selectedOrder?.TotalTax) > 0 && (
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <Text style={{ fontSize: 12, fontFamily: Fonts.semiBold, color: Theme.textSecondary }}>GST</Text>
                      <Text style={{ fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary }}>
                        {formatCurrency(selectedOrder?.TotalTax)}
                      </Text>
                    </View>
                  )}
                  {(selectedOrder?.DiscountAmount > 0 || Number(selectedOrder?.ServiceCharge) > 0 || Number(selectedOrder?.TotalTax) > 0 || Number(selectedOrder?.TakeawayCharge) > 0) && (
                    <View style={{ height: 1, backgroundColor: Theme.border + "50", marginVertical: 2 }} />
                  )}
                  {/* Final total + paid badge */}
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <View>
                      <Text style={[styles.totalLabel, { fontSize: 10, color: Theme.textSecondary, textTransform: "uppercase", letterSpacing: 1 }]}>
                        Total Amount
                      </Text>
                      <Text style={[styles.totalValue, { fontSize: 22 }]}>
                        {formatCurrency(finalBillAmount)}
                      </Text>
                    </View>
                    {(() => {
                      const isMemberOrder = String(selectedOrder?.PayMode || "").toUpperCase().trim() === "MEMBER";
                      return (
                        <View style={[
                          styles.paidBadgeSmall,
                          {
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            backgroundColor: selectedOrder?.IsCancelled
                              ? Theme.danger + "20"
                              : isMemberOrder
                                ? Theme.success + "20"
                                : selectedOrder?.OutstandingAmount !== undefined && Number(selectedOrder.OutstandingAmount) > 0
                                  ? Number(selectedOrder.OutstandingAmount) === Number(finalBillAmount)
                                    ? "#ef444420"
                                    : "#f59e0b20"
                                  : Theme.success + "20",
                            borderColor: selectedOrder?.IsCancelled
                              ? Theme.danger + "40"
                              : isMemberOrder
                                ? Theme.success + "40"
                                : selectedOrder?.OutstandingAmount !== undefined && Number(selectedOrder.OutstandingAmount) > 0
                                  ? Number(selectedOrder.OutstandingAmount) === Number(finalBillAmount)
                                    ? "#ef444440"
                                    : "#f59e0b40"
                                  : Theme.success + "40"
                          }
                        ]}>
                          <Ionicons
                            name={
                              selectedOrder?.IsCancelled
                                ? "close-circle"
                                : isMemberOrder
                                  ? "checkmark-circle"
                                  : selectedOrder?.OutstandingAmount !== undefined && Number(selectedOrder.OutstandingAmount) > 0
                                    ? Number(selectedOrder.OutstandingAmount) === Number(finalBillAmount)
                                      ? "alert-circle"
                                      : "time"
                                    : "checkmark-circle"
                            }
                            size={14}
                            color={
                              selectedOrder?.IsCancelled
                                ? Theme.danger
                                : isMemberOrder
                                  ? Theme.success
                                  : selectedOrder?.OutstandingAmount !== undefined && Number(selectedOrder.OutstandingAmount) > 0
                                    ? Number(selectedOrder.OutstandingAmount) === Number(finalBillAmount)
                                      ? "#ef4444"
                                      : "#f59e0b"
                                    : Theme.success
                            }
                          />
                          <Text style={{
                            color: selectedOrder?.IsCancelled
                              ? Theme.danger
                              : isMemberOrder
                                ? Theme.success
                                : selectedOrder?.OutstandingAmount !== undefined && Number(selectedOrder.OutstandingAmount) > 0
                                  ? Number(selectedOrder.OutstandingAmount) === Number(finalBillAmount)
                                    ? "#ef4444"
                                    : "#f59e0b"
                                  : Theme.success,
                            fontFamily: Fonts.black,
                            fontSize: 10,
                            marginLeft: 4
                          }}>
                            {selectedOrder?.IsCancelled
                              ? "CANCELLED"
                              : isMemberOrder
                                ? "PAID"
                                : selectedOrder?.OutstandingAmount !== undefined && Number(selectedOrder.OutstandingAmount) > 0
                                  ? Number(selectedOrder.OutstandingAmount) === Number(finalBillAmount)
                                    ? "UNPAID"
                                    : "PARTIAL"
                                  : "PAID"}
                          </Text>
                        </View>
                      );
                    })()}
                  </View>
                  {/* Paid / Pending details inside the modal */}
                  {(() => {
                    const isMemberOrder = String(selectedOrder?.PayMode || "").toUpperCase().trim() === "MEMBER";
                    if (selectedOrder?.OutstandingAmount !== undefined && Number(selectedOrder.OutstandingAmount) > 0 && !selectedOrder?.IsCancelled && !isMemberOrder) {
                      return (
                        <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: Theme.border + "40", flexDirection: "row", justifyContent: "space-between" }}>
                          <Text style={{ fontSize: 11, fontFamily: Fonts.bold, color: Theme.textSecondary }}>
                            Paid: <Text style={{ color: Theme.success, fontFamily: Fonts.black }}>{formatCurrency(Number(finalBillAmount) - Number(selectedOrder.OutstandingAmount))}</Text>
                          </Text>
                          <Text style={{ fontSize: 11, fontFamily: Fonts.bold, color: Theme.textSecondary }}>
                            Pending: <Text style={{ color: "#ef4444", fontFamily: Fonts.black }}>{formatCurrency(Number(selectedOrder.OutstandingAmount))}</Text>
                          </Text>
                        </View>
                      );
                    }
                    return null;
                  })()}
                </View>

                <View style={{ flexDirection: "row", gap: 12 }}>
                  {!selectedOrder?.IsCancelled && (
                    <TouchableOpacity
                      onPress={() => setShowSettingsMenu(true)}
                      style={[
                        styles.premiumSecondaryBtn,
                        { width: 48, paddingVertical: 12, justifyContent: "center", alignItems: "center" },
                      ]}
                    >
                      <Ionicons name="settings-outline" size={20} color={Theme.primary} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => {
                      setSelectedOrder(null);
                      setOrderDetails([]);
                    }}
                    style={[
                      styles.premiumPrimaryBtn,
                      { flex: 1, paddingVertical: 12 },
                    ]}
                  >
                    <Text
                      style={[styles.premiumPrimaryBtnText, { fontSize: 14 }]}
                    >
                      CLOSE
                    </Text>
                  </TouchableOpacity>

                  {!selectedOrder?.IsCancelled && (
                    <TouchableOpacity
                      disabled={loadingDetails || orderDetails.length === 0}
                      onPress={() => setShowPrintPrompt(true)}
                      style={[
                        styles.premiumSecondaryBtn,
                        { flex: 1.2, paddingVertical: 12 },
                        (loadingDetails || orderDetails.length === 0) && { opacity: 0.5 }
                      ]}
                    >
                      <Ionicons name="print" size={16} color={Theme.primary} />
                      <Text
                        style={[styles.premiumSecondaryBtnText, { fontSize: 14 }]}
                      >
                        {loadingDetails ? "LOADING..." : "REPRINT"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          </Modal>

          {/* Sidebar Modal */}
          <Modal visible={showFilterPanel} transparent animationType="none">
            <View style={styles.sidebarOverlay}>
              <TouchableOpacity
                activeOpacity={1}
                style={styles.sidebarDismiss}
                onPress={() => setShowFilterPanel(false)}
              />
              <View style={styles.sidebarContent}>
                <View style={styles.sidebarHeader}>
                  <Text style={styles.sidebarTitle}>ADVANCED FILTERS</Text>
                  <TouchableOpacity onPress={() => setShowFilterPanel(false)}>
                    <Ionicons
                      name="close"
                      size={24}
                      color={Theme.textPrimary}
                    />
                  </TouchableOpacity>
                </View>
                <ScrollView>
                  <View style={styles.sidebarSection}>
                    <Text style={styles.sectionLabel}>PAYMENT MODES</Text>
                    <View style={styles.chipRow}>
                      {["CASH", "CARD", "NETS", "PAYNOW", "VOID", "MEMBER", "CREDIT"].map((m) => (
                        <TouchableOpacity
                          key={m}
                          onPress={() => togglePaymentMode(m)}
                          style={[
                            styles.chip,
                            activePaymentModes.includes(m) && styles.activeChip,
                          ]}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              activePaymentModes.includes(m) &&
                              styles.activeChipText,
                            ]}
                          >
                            {m}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  <View style={styles.sidebarSection}>
                    <Text style={styles.sectionLabel}>ORDER TYPE</Text>
                    <View style={styles.chipRow}>
                      {["DINE-IN", "TAKEAWAY"].map((t) => (
                        <TouchableOpacity
                          key={t}
                          onPress={() => toggleOrderType(t)}
                          style={[
                            styles.chip,
                            activeOrderTypes.includes(t) && styles.activeChip,
                          ]}
                        >
                          <Text
                            style={[
                              styles.chipText,
                              activeOrderTypes.includes(t) &&
                              styles.activeChipText,
                            ]}
                          >
                            {t}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  <View style={styles.sidebarSection}>
                    <Text style={styles.sectionLabel}>SORT BY</Text>
                    {[
                      {
                        id: "NEWEST",
                        label: "Newest First",
                        icon: "time-outline",
                      },
                      {
                        id: "HIGHEST",
                        label: "Highest Amount",
                        icon: "trending-up-outline",
                      },
                    ].map((s) => (
                      <TouchableOpacity
                        key={s.id}
                        onPress={() => setSortOrder(s.id as any)}
                        style={[
                          styles.sortBtn,
                          sortOrder === s.id && styles.activeSortBtn,
                        ]}
                      >
                        <Ionicons
                          name={s.icon as any}
                          size={18}
                          color={
                            sortOrder === s.id ? Theme.primary : Theme.textMuted
                          }
                        />
                        <Text
                          style={[
                            styles.sortText,
                            sortOrder === s.id && styles.activeSortText,
                          ]}
                        >
                          {s.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <View style={styles.sidebarSection}>
                    <Text style={styles.sectionLabel}>VISIBILITY</Text>
                    <TouchableOpacity
                      onPress={() => setShowCancelledOrders(!showCancelledOrders)}
                      style={[
                        styles.sortBtn,
                        showCancelledOrders && styles.activeSortBtn,
                      ]}
                    >
                      <Ionicons
                        name={showCancelledOrders ? "eye-outline" : "eye-off-outline"}
                        size={18}
                        color={showCancelledOrders ? Theme.primary : Theme.textMuted}
                      />
                      <Text
                        style={[
                          styles.sortText,
                          showCancelledOrders && styles.activeSortText,
                        ]}
                      >
                        {showCancelledOrders ? "Showing Cancelled Orders" : "Hidden Cancelled Orders"}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
                <View style={styles.sidebarFooter}>
                  <TouchableOpacity
                    onPress={() => {
                      setActivePaymentModes(["CASH", "CARD", "NETS", "PAYNOW", "VOID", "MEMBER", "CREDIT"]);
                      setActiveOrderTypes(["DINE-IN", "TAKEAWAY"]);
                      setSortOrder("NEWEST");
                      setShowCancelledOrders(true);
                    }}
                    style={styles.resetBtn}
                  >
                    <Text style={styles.resetText}>RESET ALL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setShowFilterPanel(false)}
                    style={styles.applyBtn}
                  >
                    <Text style={styles.applyText}>APPLY</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          <BillPrompt
            visible={showPrintPrompt}
            onClose={() => setShowPrintPrompt(false)}
            onSkip={() => setShowPrintPrompt(false)}
            onPrintBill={handleReprint}
            theme={Theme}
            t={{
              printBillReceipt: "Reprint Receipt?",
              totalAmount: "Total",
              printBillMessage:
                "Would you like to reprint the receipt for this order?",
              skipBill: "Cancel",
              printBill: "Print",
            }}
            total={String(selectedOrder?.SysAmount || 0)}
          />

          {/* Settings Options Modal */}
          <Modal visible={showSettingsMenu} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
              <View style={[styles.modalContent, { width: 340, padding: 20 }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <Text style={{ fontSize: 16, fontFamily: Fonts.black, color: Theme.textPrimary }}>Order Settings</Text>
                  <TouchableOpacity onPress={() => setShowSettingsMenu(false)}>
                    <Ionicons name="close" size={20} color={Theme.textPrimary} />
                  </TouchableOpacity>
                </View>
                
                <TouchableOpacity
                  onPress={() => {
                    setShowSettingsMenu(false);
                    const currentMode = (selectedOrder?.PayMode || '').toUpperCase().trim();
                    setSelectedGridMode(currentMode);
                    const isSplit = currentMode === "SPLIT";
                    setIsSplitMode(isSplit);
                    if (isSplit) {
                      const splitsMapped = orderPayments.map(p => ({
                        payMode: (p.Paymode || p.PayMode || 'CASH').toUpperCase().trim(),
                        amount: Number(p.Amount || 0).toFixed(2)
                      }));
                      setChangePaymentSplits(splitsMapped.length > 0 ? splitsMapped : [{ payMode: "CASH", amount: finalBillAmount.toFixed(2) }]);
                    } else {
                      setChangePaymentSplits([{ payMode: "CASH", amount: finalBillAmount.toFixed(2) }]);
                    }
                    setShowChangePaymentModal(true);
                  }}
                  style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Theme.border + "40", gap: 12 }}
                >
                  <Ionicons name="card-outline" size={20} color={Theme.primary} />
                  <Text style={{ fontSize: 14, fontFamily: Fonts.bold, color: Theme.textPrimary }}>Change Payment Mode</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setShowSettingsMenu(false);
                    setShowVoidItemModal(true);
                  }}
                  style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Theme.border + "40", gap: 12 }}
                >
                  <Ionicons name="trash-outline" size={20} color="#ef4444" />
                  <Text style={{ fontSize: 14, fontFamily: Fonts.bold, color: Theme.textPrimary }}>Void Item</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => {
                    setShowSettingsMenu(false);
                    setShowCancelOrderConfirm(true);
                  }}
                  style={{ flexDirection: "row", alignItems: "center", paddingVertical: 14, gap: 12 }}
                >
                  <Ionicons name="close-circle-outline" size={20} color="#ef4444" />
                  <Text style={{ fontSize: 14, fontFamily: Fonts.bold, color: "#ef4444" }}>Cancel Order</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>

          {/* Change Payment Mode Modal */}
          <Modal visible={showChangePaymentModal} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
              <View style={{
                backgroundColor: "#ffffff",
                borderRadius: 16,
                padding: 20,
                width: 360,
                maxHeight: "85%",
                borderWidth: 1,
                borderColor: Theme.border + "40",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.1,
                shadowRadius: 10,
                elevation: 10,
              }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <Text style={{ fontSize: 16, fontFamily: Fonts.black, color: Theme.textPrimary }}>
                    Change Payment Mode
                  </Text>
                  <TouchableOpacity onPress={() => setShowChangePaymentModal(false)}>
                    <Ionicons name="close" size={20} color={Theme.textPrimary} />
                  </TouchableOpacity>
                </View>

                {/* Enable Split Payment Row */}
                <View style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  backgroundColor: Theme.border + "15",
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 16,
                }}>
                  <Text style={{ fontSize: 14, fontFamily: Fonts.bold, color: Theme.textPrimary }}>
                    Enable Split Payment
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      const nextVal = !isSplitMode;
                      setIsSplitMode(nextVal);
                      if (nextVal && changePaymentSplits.length === 0) {
                        setChangePaymentSplits([
                          { payMode: "CASH", amount: finalBillAmount.toFixed(2) }
                        ]);
                      }
                    }}
                    style={{
                      width: 48,
                      height: 26,
                      borderRadius: 13,
                      backgroundColor: isSplitMode ? Theme.primary : "#e5e7eb",
                      padding: 2,
                      justifyContent: "center"
                    }}
                  >
                    <View style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: "#ffffff",
                      alignSelf: isSplitMode ? "flex-end" : "flex-start",
                      shadowColor: "#000",
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 0.2,
                      shadowRadius: 1.5,
                      elevation: 2
                    }} />
                  </TouchableOpacity>
                </View>
                
                {!isSplitMode ? (
                  <>
                    <Text style={{
                      fontSize: 11,
                      fontFamily: Fonts.black,
                      color: Theme.textSecondary,
                      letterSpacing: 1.2,
                      textTransform: "uppercase",
                      marginBottom: 12,
                      marginTop: 8
                    }}>
                      SELECT PAYMENT METHOD
                    </Text>

                    <ScrollView style={{ maxHeight: 280, marginBottom: 15 }}>
                      <View style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        justifyContent: "space-between",
                        gap: 10,
                        paddingBottom: 5
                      }}>
                        {(() => {
                          const activeModes = dbPaymentModes
                            .map((m: any) => (m.payMode || m.PayMode || '').toUpperCase().trim())
                            .filter((mode: string) => mode.length > 0);
                          const displayModes = activeModes.length > 0 ? activeModes : ["CASH", "CARD", "NETS", "PAYNOW", "MEMBER", "CREDIT"];
                          const uniqueModes = Array.from(new Set(displayModes));

                          return uniqueModes.map((mode) => {
                            const isSelected = selectedGridMode === mode;
                            return (
                              <TouchableOpacity
                                key={mode}
                                onPress={() => setSelectedGridMode(mode)}
                                style={{
                                  width: "48%",
                                  height: 52,
                                  borderRadius: 10,
                                  borderWidth: 1.5,
                                  borderColor: isSelected ? Theme.primary : Theme.border + "60",
                                  backgroundColor: isSelected ? Theme.primary + "15" : "transparent",
                                  justifyContent: "center",
                                  alignItems: "center"
                                }}
                              >
                                <Text style={{
                                  fontSize: 14,
                                  fontFamily: Fonts.black,
                                  color: isSelected ? Theme.primary : Theme.textPrimary
                                }}>
                                  {mode}
                                </Text>
                              </TouchableOpacity>
                            );
                          });
                        })()}
                      </View>
                    </ScrollView>

                    <TouchableOpacity
                      onPress={() => {
                        if (!selectedGridMode) return;
                        if (selectedGridMode === "MEMBER" || selectedGridMode === "CREDIT") {
                          setIsMemberSearch(selectedGridMode === "MEMBER");
                          setCurrentSelectionStep(selectedGridMode === "MEMBER" ? "MEMBER" : "CREDIT");
                          setPendingPayMode(selectedGridMode);
                          setPendingSplits(null);
                          setMemberQuery("");
                          setSelectedMemberForPay(null);
                          setSelectedCreditForPay(null);
                          setActiveModalSelection(null);
                          setMembersList([]);
                          setShowMemberModal(true);
                        } else {
                          handleConfirmChangePayment(selectedGridMode);
                        }
                      }}
                      style={{
                        backgroundColor: selectedGridMode ? Theme.primary : Theme.textMuted,
                        borderRadius: 12,
                        paddingVertical: 14,
                        alignItems: "center",
                        opacity: selectedGridMode ? 1 : 0.6
                      }}
                      disabled={!selectedGridMode}
                    >
                      <Text style={{ color: "#ffffff", fontSize: 14, fontFamily: Fonts.black }}>
                        SAVE PAYMENT MODE
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <View style={{ flexShrink: 1 }}>
                    <ScrollView style={{ maxHeight: 250, marginBottom: 15 }} keyboardShouldPersistTaps="handled">
                      {changePaymentSplits.map((split, idx) => {
                        const nextMode = () => {
                          const activeModes = dbPaymentModes
                            .map((m: any) => (m.payMode || m.PayMode || '').toUpperCase().trim())
                            .filter((mode: string) => mode.length > 0);
                          const displayModes = activeModes.length > 0 ? activeModes : ["CASH", "CARD", "NETS", "PAYNOW", "MEMBER", "CREDIT"];
                          const modes = Array.from(new Set(displayModes));

                          const currentIdx = modes.indexOf(split.payMode);
                          const next = modes[currentIdx !== -1 ? (currentIdx + 1) % modes.length : 0]!;
                          const newSplits = [...changePaymentSplits];
                          newSplits[idx] = { ...split, payMode: next };
                          setChangePaymentSplits(newSplits);
                        };

                        const handleAmountChange = (text: string) => {
                          const newSplits = [...changePaymentSplits];
                          newSplits[idx] = { ...split, amount: text };
                          setChangePaymentSplits(newSplits);
                        };

                        const handleDeleteRow = () => {
                          setChangePaymentSplits(changePaymentSplits.filter((_, i) => i !== idx));
                        };

                        return (
                          <View key={idx} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
                            <TouchableOpacity
                              onPress={nextMode}
                              style={{
                                width: 90,
                                height: 40,
                                borderWidth: 1,
                                borderColor: Theme.border + "60",
                                borderRadius: 8,
                                justifyContent: "center",
                                alignItems: "center",
                                backgroundColor: Theme.border + "10"
                              }}
                            >
                              <Text style={{ fontSize: 13, fontFamily: Fonts.black, color: Theme.primary }}>
                                {split.payMode}
                              </Text>
                            </TouchableOpacity>

                            <TextInput
                              placeholder="Amount"
                              placeholderTextColor={Theme.textSecondary + "70"}
                              value={split.amount}
                              onChangeText={handleAmountChange}
                              keyboardType="numeric"
                              style={{
                                flex: 1,
                                height: 40,
                                borderWidth: 1,
                                borderColor: Theme.border + "60",
                                borderRadius: 8,
                                paddingHorizontal: 10,
                                fontSize: 14,
                                color: Theme.textPrimary,
                                fontFamily: Fonts.bold,
                                backgroundColor: "#ffffff"
                              }}
                            />

                            {changePaymentSplits.length > 1 && (
                              <TouchableOpacity onPress={handleDeleteRow} style={{ padding: 4 }}>
                                <Ionicons name="trash-outline" size={20} color="#ef4444" />
                              </TouchableOpacity>
                            )}
                          </View>
                        );
                      })}

                      <TouchableOpacity
                        onPress={() => setChangePaymentSplits([...changePaymentSplits, { payMode: "NETS", amount: "" }])}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                          paddingVertical: 10,
                          borderWidth: 1.5,
                          borderColor: Theme.primary + "50",
                          borderRadius: 8,
                          borderStyle: "dashed",
                          marginTop: 5
                        }}
                      >
                        <Ionicons name="add" size={18} color={Theme.primary} />
                        <Text style={{ fontSize: 13, fontFamily: Fonts.black, color: Theme.primary }}>
                          ADD PAYMENT METHOD
                        </Text>
                      </TouchableOpacity>
                    </ScrollView>

                    <View style={{ backgroundColor: Theme.border + "15", padding: 12, borderRadius: 10, marginBottom: 15, gap: 4 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ fontSize: 12, fontFamily: Fonts.bold, color: Theme.textSecondary }}>Bill Total:</Text>
                        <Text style={{ fontSize: 12, fontFamily: Fonts.black, color: Theme.textPrimary }}>${finalBillAmount.toFixed(2)}</Text>
                      </View>
                      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                        <Text style={{ fontSize: 12, fontFamily: Fonts.bold, color: Theme.textSecondary }}>Allocated:</Text>
                        <Text style={{ fontSize: 12, fontFamily: Fonts.black, color: Theme.textPrimary }}>${allocatedSplitsSum.toFixed(2)}</Text>
                      </View>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: Theme.border + "30", paddingTop: 4 }}>
                        <Text style={{ fontSize: 12, fontFamily: Fonts.bold, color: Theme.textSecondary }}>Remaining:</Text>
                        <Text style={{ fontSize: 12, fontFamily: Fonts.black, color: Math.abs(remainingSplitsBalance) < 0.02 ? Theme.success : "#ef4444" }}>
                          ${remainingSplitsBalance.toFixed(2)}
                        </Text>
                      </View>
                    </View>

                    <TouchableOpacity
                      disabled={Math.abs(remainingSplitsBalance) >= 0.02}
                      onPress={() => {
                        const hasMemberSplit = changePaymentSplits.some(s => s.payMode === "MEMBER");
                        const hasCreditSplit = changePaymentSplits.some(s => s.payMode === "CREDIT");

                        setPendingPayMode("SPLIT");
                        setPendingSplits(changePaymentSplits);
                        setSelectedMemberForPay(null);
                        setSelectedCreditForPay(null);
                        setActiveModalSelection(null);
                        setMemberQuery("");
                        setMembersList([]);

                        if (hasMemberSplit) {
                          setCurrentSelectionStep("MEMBER");
                          setIsMemberSearch(true);
                          setShowMemberModal(true);
                        } else if (hasCreditSplit) {
                          setCurrentSelectionStep("CREDIT");
                          setIsMemberSearch(false);
                          setShowMemberModal(true);
                        } else {
                          handleConfirmChangePayment("SPLIT", changePaymentSplits);
                        }
                      }}
                      style={{
                        backgroundColor: Math.abs(remainingSplitsBalance) < 0.02 ? Theme.primary : Theme.textMuted,
                        borderRadius: 12,
                        paddingVertical: 14,
                        alignItems: "center",
                        opacity: Math.abs(remainingSplitsBalance) < 0.02 ? 1 : 0.6
                      }}
                    >
                      <Text style={{ color: "#ffffff", fontSize: 14, fontFamily: Fonts.black }}>
                        SAVE PAYMENT MODE
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>
          </Modal>

          {/* Member Selection Modal */}
          <Modal visible={showMemberModal} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
              <View style={[styles.modalContent, { width: 360, padding: 20 }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
                  <Text style={{ fontSize: 16, fontFamily: Fonts.black, color: Theme.textPrimary }}>
                    {isMemberSearch ? "Select Member" : "Select Credit Customer"}
                  </Text>
                  <TouchableOpacity onPress={() => setShowMemberModal(false)}>
                    <Ionicons name="close" size={20} color={Theme.textPrimary} />
                  </TouchableOpacity>
                </View>

                {/* Search Type Selector (Member vs Credit Customer) */}
                <View style={{ flexDirection: "row", backgroundColor: Theme.border + "15", borderRadius: 8, padding: 4, marginBottom: 12 }}>
                  <TouchableOpacity
                    onPress={() => {
                      setIsMemberSearch(true);
                      setSelectedMemberForPay(null);
                      setMemberQuery("");
                      setMembersList([]);
                    }}
                    style={{
                      flex: 1,
                      paddingVertical: 8,
                      alignItems: "center",
                      backgroundColor: isMemberSearch ? "#fff" : "transparent",
                      borderRadius: 6,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontFamily: Fonts.bold, color: isMemberSearch ? Theme.primary : Theme.textSecondary }}>Member</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setIsMemberSearch(false);
                      setSelectedMemberForPay(null);
                      setMemberQuery("");
                      setMembersList([]);
                    }}
                    style={{
                      flex: 1,
                      paddingVertical: 8,
                      alignItems: "center",
                      backgroundColor: !isMemberSearch ? "#fff" : "transparent",
                      borderRadius: 6,
                    }}
                  >
                    <Text style={{ fontSize: 12, fontFamily: Fonts.bold, color: !isMemberSearch ? Theme.primary : Theme.textSecondary }}>Credit Customer</Text>
                  </TouchableOpacity>
                </View>

                <TextInput
                  placeholder={isMemberSearch ? "Search Member (Name or Phone)" : "Search Credit Customer (Name)"}
                  placeholderTextColor={Theme.textSecondary + "70"}
                  value={memberQuery}
                  onChangeText={setMemberQuery}
                  style={{
                    height: 40,
                    borderWidth: 1.5,
                    borderColor: Theme.border + "60",
                    borderRadius: 8,
                    paddingHorizontal: 12,
                    fontSize: 13,
                    color: Theme.textPrimary,
                    fontFamily: Fonts.medium,
                    backgroundColor: "#FAF7F2",
                    marginBottom: 12
                  }}
                />

                {searchingMembers ? (
                  <View style={{ height: 180, justifyContent: "center", alignItems: "center" }}>
                    <ActivityIndicator size="small" color={Theme.primary} />
                  </View>
                ) : (
                  <ScrollView style={{ maxHeight: 180, marginBottom: 15 }}>
                    {membersList.length === 0 ? (
                      <Text style={{ textAlign: "center", color: Theme.textSecondary, fontFamily: Fonts.medium, fontSize: 12, paddingVertical: 20 }}>
                        No matches found.
                      </Text>
                    ) : (
                      membersList.map((m: any) => {
                        const isSelected = !!activeModalSelection && (
                          (m.MemberId && activeModalSelection.MemberId === m.MemberId) ||
                          (m.CustomerId && activeModalSelection.CustomerId === m.CustomerId)
                        );
                        return (
                          <TouchableOpacity
                            key={m.MemberId || m.CustomerId}
                            onPress={() => setActiveModalSelection(m)}
                            style={{
                              paddingVertical: 10,
                              paddingHorizontal: 12,
                              borderRadius: 8,
                              backgroundColor: isSelected ? Theme.primary + "10" : "transparent",
                              borderWidth: 1,
                              borderColor: isSelected ? Theme.primary : "transparent",
                              marginBottom: 4,
                              flexDirection: "row",
                              justifyContent: "space-between",
                              alignItems: "center"
                            }}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 13, fontFamily: Fonts.bold, color: isSelected ? Theme.primary : Theme.textPrimary }}>
                                {m.Name}
                              </Text>
                              <Text style={{ fontSize: 11, color: Theme.textSecondary, marginTop: 2 }}>
                                {m.Phone || m.MobileNo || "No phone"}
                              </Text>
                            </View>
                            {isSelected && (
                              <Ionicons name="checkmark" size={16} color={Theme.primary} />
                            )}
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </ScrollView>
                )}

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity
                    onPress={() => setShowMemberModal(false)}
                    style={[styles.premiumSecondaryBtn, { flex: 1, paddingVertical: 10 }]}
                  >
                    <Text style={styles.premiumSecondaryBtnText}>CANCEL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={!activeModalSelection}
                    onPress={() => {
                      if (currentSelectionStep === "MEMBER") {
                        const chosenMember = activeModalSelection;
                        setSelectedMemberForPay(chosenMember);
                        
                        // Check if we also need to select a Credit Customer
                        const hasCredit = pendingPayMode === "SPLIT" && pendingSplits?.some(s => s.payMode === "CREDIT");
                        if (hasCredit) {
                          setCurrentSelectionStep("CREDIT");
                          setIsMemberSearch(false);
                          setActiveModalSelection(null);
                          setMemberQuery("");
                          setMembersList([]);
                        } else {
                          setShowMemberModal(false);
                          handleConfirmChangePayment(pendingPayMode || "", pendingSplits || undefined, chosenMember.MemberId);
                        }
                      } else if (currentSelectionStep === "CREDIT") {
                        const chosenCredit = activeModalSelection;
                        setSelectedCreditForPay(chosenCredit);
                        setShowMemberModal(false);
                        
                        // Pass both IDs if it's a split with member and credit
                        const hasMember = pendingPayMode === "SPLIT" && pendingSplits?.some(s => s.payMode === "MEMBER");
                        const mId = hasMember ? selectedMemberForPay?.MemberId : null;
                        
                        handleConfirmChangePayment(pendingPayMode || "", pendingSplits || undefined, mId || undefined, chosenCredit.CustomerId);
                      } else {
                        // Fallback for single modes
                        setShowMemberModal(false);
                        const id = activeModalSelection.MemberId || activeModalSelection.CustomerId;
                        handleConfirmChangePayment(pendingPayMode || "", undefined, id);
                      }
                    }}
                    style={{
                      flex: 1.5,
                      backgroundColor: activeModalSelection ? Theme.primary : Theme.textMuted,
                      borderRadius: 10,
                      justifyContent: "center",
                      alignItems: "center",
                      paddingVertical: 10,
                      opacity: activeModalSelection ? 1 : 0.6
                    }}
                  >
                    <Text style={{ color: "#fff", fontSize: 13, fontFamily: Fonts.black }}>CONFIRM</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* Void Item Modal */}
          <Modal visible={showVoidItemModal} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
              <View style={[styles.modalContent, { width: 360, padding: 20 }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                  <Text style={{ fontSize: 16, fontFamily: Fonts.black, color: Theme.textPrimary }}>Select Items to Void</Text>
                  <TouchableOpacity onPress={() => setShowVoidItemModal(false)}>
                    <Ionicons name="close" size={20} color={Theme.textPrimary} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ maxHeight: 250 }}>
                  {orderDetails
                    .filter((item) => item.Status !== "VOIDED")
                    .map((item) => {
                      const itemId = item.OrderDetailId || item.DishId;
                      const isSelected = selectedVoidItemIds.includes(itemId);
                      return (
                        <TouchableOpacity
                          key={itemId}
                          onPress={() => toggleVoidItemSelection(itemId)}
                          style={{
                            paddingVertical: 12,
                            paddingHorizontal: 10,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: isSelected ? Theme.primary : Theme.border + "30",
                            backgroundColor: isSelected ? Theme.primary + "08" : "transparent",
                            marginBottom: 8,
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center"
                          }}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", flex: 1, marginRight: 10 }}>
                            <Ionicons
                              name={isSelected ? "checkbox" : "square-outline"}
                              size={20}
                              color={isSelected ? Theme.primary : Theme.textSecondary}
                              style={{ marginRight: 8 }}
                            />
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary }}>
                                {item.DishName}
                              </Text>
                              <Text style={{ fontSize: 11, color: Theme.textSecondary, marginTop: 2 }}>
                                Qty: {item.Qty} • Unit: ${(item.Price || 0).toFixed(2)}
                              </Text>
                            </View>
                          </View>
                          <Text style={{ fontSize: 13, fontFamily: Fonts.black, color: Theme.textPrimary }}>
                            ${((item.Price || 0) * (item.Qty || 1)).toFixed(2)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  {orderDetails.filter((item) => item.Status !== "VOIDED").length === 0 && (
                    <Text style={{ textAlign: "center", color: Theme.textSecondary, marginVertical: 20 }}>
                      No active items to void
                    </Text>
                  )}
                </ScrollView>

                {selectedVoidItemIds.length > 0 && (
                  <TouchableOpacity
                    onPress={() => {
                      setShowVoidItemConfirm(true);
                    }}
                    style={{
                      backgroundColor: "#ef4444",
                      borderRadius: 10,
                      paddingVertical: 12,
                      alignItems: "center",
                      marginTop: 15
                    }}
                  >
                    <Text style={{ color: "#fff", fontSize: 14, fontFamily: Fonts.black }}>
                      VOID SELECTED ({selectedVoidItemIds.length})
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </Modal>

          {/* Void Item Confirm Modal */}
          <Modal visible={showVoidItemConfirm} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
              <View style={[styles.modalContent, { width: 340, padding: 20 }]}>
                <Text style={{ fontSize: 16, fontFamily: Fonts.black, color: "#ef4444", marginBottom: 10 }}>
                  Void Selected Items?
                </Text>
                <Text style={{ fontSize: 13, fontFamily: Fonts.bold, color: Theme.textSecondary, marginBottom: 20 }}>
                  Are you sure you want to void the {selectedVoidItemIds.length} selected item(s)? This action requires supervisor credentials.
                </Text>

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity
                    onPress={() => {
                      setShowVoidItemConfirm(false);
                    }}
                    style={[styles.premiumSecondaryBtn, { flex: 1, paddingVertical: 10 }]}
                  >
                    <Text style={styles.premiumSecondaryBtnText}>CANCEL</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      setShowVoidItemConfirm(false);
                      runVoidItems(selectedVoidItemIds);
                    }}
                    style={{
                      flex: 1,
                      backgroundColor: "#ef4444",
                      borderRadius: 10,
                      justifyContent: "center",
                      alignItems: "center",
                      paddingVertical: 10
                    }}
                  >
                    <Text style={{ color: "#fff", fontSize: 13, fontFamily: Fonts.black }}>YES, VOID</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* Cancel Order Confirm Modal */}
          <Modal visible={showCancelOrderConfirm} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
              <View style={[styles.modalContent, { width: 340, padding: 20 }]}>
                <Text style={{ fontSize: 16, fontFamily: Fonts.black, color: "#ef4444", marginBottom: 10 }}>
                  Cancel Order?
                </Text>
                <Text style={{ fontSize: 13, fontFamily: Fonts.bold, color: Theme.textSecondary, marginBottom: 15 }}>
                  Are you sure you want to cancel Order #{selectedOrder ? formatOrderId(selectedOrder) : ""}? This action cannot be undone.
                </Text>

                <TextInput
                  placeholder="Reason for cancellation"
                  placeholderTextColor={Theme.textSecondary + "90"}
                  value={cancellationReason}
                  onChangeText={setCancellationReason}
                  style={{
                    borderWidth: 1,
                    borderColor: Theme.border + "50",
                    borderRadius: 8,
                    padding: 10,
                    fontSize: 13,
                    color: Theme.textPrimary,
                    fontFamily: Fonts.bold,
                    backgroundColor: Theme.border + "10",
                    marginBottom: 20,
                    minHeight: 40
                  }}
                />

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity
                    onPress={() => {
                      setShowCancelOrderConfirm(false);
                      setCancellationReason("");
                    }}
                    style={[styles.premiumSecondaryBtn, { flex: 1, paddingVertical: 10 }]}
                  >
                    <Text style={styles.premiumSecondaryBtnText}>NO, KEEP</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleConfirmCancelOrder}
                    style={{
                      flex: 1,
                      backgroundColor: "#ef4444",
                      borderRadius: 10,
                      justifyContent: "center",
                      alignItems: "center",
                      paddingVertical: 10
                    }}
                  >
                    <Text style={{ color: "#fff", fontSize: 13, fontFamily: Fonts.black }}>YES, CANCEL</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          {/* SUPERVISOR PASSWORD VERIFICATION MODAL */}
          <Modal
            visible={showPasswordModal}
            transparent
            animationType="fade"
            onRequestClose={() => setShowPasswordModal(false)}
          >
            <View style={styles.modalOverlay}>
              <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
              <View style={[styles.modalContent, { width: 340, padding: 20 }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
                  <Text style={{ fontSize: 16, fontFamily: Fonts.black, color: Theme.textPrimary }}>
                    {passwordAction?.title || "Verification Required"}
                  </Text>
                  <TouchableOpacity onPress={() => setShowPasswordModal(false)}>
                    <Ionicons name="close" size={20} color={Theme.textPrimary} />
                  </TouchableOpacity>
                </View>

                <Text style={{ fontSize: 13, fontFamily: Fonts.bold, color: Theme.textSecondary, marginBottom: 15 }}>
                  {passwordAction?.description || "Please enter the supervisor/admin password:"}
                </Text>

                <TextInput
                  placeholder="Enter Password"
                  placeholderTextColor={Theme.textSecondary + "90"}
                  secureTextEntry
                  autoFocus
                  value={passwordValue}
                  onChangeText={(val) => {
                    setPasswordValue(val);
                    if (passwordError) setPasswordError("");
                  }}
                  style={{
                    borderWidth: 1,
                    borderColor: passwordError ? "#EF4444" : Theme.border + "50",
                    borderRadius: 8,
                    padding: 10,
                    fontSize: 14,
                    color: Theme.textPrimary,
                    fontFamily: Fonts.bold,
                    backgroundColor: Theme.border + "10",
                    marginBottom: passwordError ? 6 : 20,
                    textAlign: "center",
                    minHeight: 40
                  }}
                />

                {!!passwordError && (
                  <Text style={{ color: "#EF4444", fontSize: 12, fontFamily: Fonts.bold, textAlign: "center", marginBottom: 15 }}>
                    {passwordError}
                  </Text>
                )}

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TouchableOpacity
                    onPress={() => setShowPasswordModal(false)}
                    style={[styles.premiumSecondaryBtn, { flex: 1, paddingVertical: 10 }]}
                  >
                    <Text style={styles.premiumSecondaryBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={{
                      flex: 1,
                      backgroundColor: Theme.primary,
                      borderRadius: 10,
                      justifyContent: "center",
                      alignItems: "center",
                      paddingVertical: 10
                    }}
                    onPress={async () => {
                      try {
                        setPasswordError("");
                        const verifyRes = await fetch(`${API_URL}/api/auth/verify`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ password: passwordValue, role: passwordAction?.role || "ADMIN" }),
                        });
                        const verifyData = await verifyRes.json();
                        if (!verifyData.success) {
                          setPasswordError("Incorrect password. Please try again.");
                          showToast({ type: "error", message: "The password you entered is incorrect." });
                          return;
                        }
                        setShowPasswordModal(false);
                        if (passwordAction?.onSuccess) {
                          passwordAction.onSuccess();
                        }
                      } catch (err) {
                        console.error("Password verification error:", err);
                        setPasswordError("Failed to verify password.");
                        showToast({ type: "error", message: "Failed to verify password" });
                      }
                    }}
                  >
                    <Text style={{ color: "#fff", fontSize: 13, fontFamily: Fonts.black }}>Confirm</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>

          <Modal visible={showDownloadPanel} transparent animationType="fade">
            <View style={styles.modalOverlay}>
              <BlurView intensity={20} tint="dark" style={StyleSheet.absoluteFill} />
              <TouchableOpacity
                activeOpacity={1}
                style={styles.modalDismiss}
                onPress={() => !isDownloading && setShowDownloadPanel(false)}
              />
              <View style={[styles.downloadModalContent, { width: SCREEN_W > 600 ? 380 : "92%" }]}>
                <View style={styles.modalHeader}>
                  <View>
                    <Text style={styles.modalTitle}>Sales Report</Text>
                    <Text style={styles.modalSub}>Select period and download format</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => !isDownloading && setShowDownloadPanel(false)}
                    style={styles.modalCloseBtn}
                  >
                    <Ionicons name="close" size={20} color={Theme.textPrimary} />
                  </TouchableOpacity>
                </View>

                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
                  {/* Period Selection Card */}
                  <View style={styles.downloadSectionCard}>
                    <Text style={styles.downloadSectionLabel}>SELECT TIME PERIOD</Text>
                    <View style={styles.periodGrid}>
                      {(["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "CUSTOM"] as FilterType[]).map((f) => (
                        <TouchableOpacity
                          key={f}
                          onPress={() => {
                            setDownloadFilter(f);
                            setDownloadPickerMode("START");
                            if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          }}
                          style={[
                            styles.periodBtn,
                            downloadFilter === f && styles.activePeriodBtn,
                          ]}
                        >
                          <MaterialCommunityIcons
                            name={
                              f === "DAILY" ? "calendar-today" :
                                f === "WEEKLY" ? "calendar-week" :
                                  f === "MONTHLY" ? "calendar-month" :
                                    f === "YEARLY" ? "calendar-star" : "calendar-range"
                            }
                            size={18}
                            color={downloadFilter === f ? "#fff" : Theme.textSecondary}
                          />
                          <Text style={[styles.periodText, downloadFilter === f && styles.activePeriodText]}>
                            {f.charAt(0) + f.slice(1).toLowerCase()}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {downloadFilter === "CUSTOM" && (
                      <View style={styles.customDateRow}>
                        <TouchableOpacity
                          onPress={() => {
                            setDownloadPickerMode("START");
                            setShowDownloadDatePicker(true);
                          }}
                          style={[styles.dateInput, downloadPickerMode === "START" && styles.activeDateInput]}
                        >
                          <Text style={styles.dateInputLabel}>FROM</Text>
                          <Text style={styles.dateInputValue}>
                            {downloadRangeStart ? format(new Date(downloadRangeStart), "dd MMM yyyy") : "Select"}
                          </Text>
                        </TouchableOpacity>
                        <Ionicons name="arrow-forward" size={16} color={Theme.textMuted} />
                        <TouchableOpacity
                          onPress={() => {
                            setDownloadPickerMode("END");
                            setShowDownloadDatePicker(true);
                          }}
                          style={[styles.dateInput, downloadPickerMode === "END" && styles.activeDateInput]}
                        >
                          <Text style={styles.dateInputLabel}>TO</Text>
                          <Text style={styles.dateInputValue}>
                            {downloadRangeEnd ? format(new Date(downloadRangeEnd), "dd MMM yyyy") : "Select"}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>

                  {/* Option A: Direct Download */}
                  <View style={styles.downloadOptionCard}>
                    <View style={styles.optionHeader}>
                      <View style={styles.optionIconBox}>
                        <Ionicons name="document-text" size={20} color={Theme.primary} />
                      </View>
                      <View>
                        <Text style={styles.optionTitle}>Direct Download</Text>
                        <Text style={styles.optionDesc}>Generate PDF and save to device</Text>
                      </View>
                    </View>

                    <TouchableOpacity
                      onPress={handleDownloadPdf}
                      disabled={isDownloading || isSendingEmail || (downloadFilter === "CUSTOM" && (!downloadRangeStart || !downloadRangeEnd || new Date(downloadRangeEnd) < new Date(downloadRangeStart)))}
                      activeOpacity={0.8}
                    >
                      <LinearGradient
                        colors={[Theme.primary, "#ff8c42"]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[
                          styles.premiumActionBtn,
                          (isDownloading || isSendingEmail || (downloadFilter === "CUSTOM" && (!downloadRangeStart || !downloadRangeEnd || new Date(downloadRangeEnd) < new Date(downloadRangeStart)))) && { opacity: 0.5 }
                        ]}
                      >
                        {isDownloading ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <>
                            <Ionicons name="cloud-download" size={20} color="#fff" style={{ marginRight: 8 }} />
                            <Text style={styles.premiumActionBtnText}>Download PDF</Text>
                          </>
                        )}
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>

                  {/* Option B: Send to Email */}
                  <View style={styles.downloadOptionCard}>
                    <View style={styles.optionHeader}>
                      <View style={[styles.optionIconBox, { backgroundColor: '#e0f2fe' }]}>
                        <Ionicons name="mail" size={20} color="#0284c7" />
                      </View>
                      <View>
                        <Text style={styles.optionTitle}>Send via Email</Text>
                        <Text style={styles.optionDesc}>Receive report in your inbox</Text>
                      </View>
                    </View>

                    <View style={styles.emailInputWrapper}>
                      <Ionicons name="at" size={18} color={Theme.textMuted} style={styles.inputIcon} />
                      <TextInput
                        style={[
                          styles.modernEmailInput,
                          showEmailValidationError && { borderColor: '#ef4444' },
                        ]}
                        placeholder="recipient@example.com"
                        placeholderTextColor={Theme.textMuted}
                        value={emailAddress}
                        onChangeText={(value) => {
                          setEmailAddress(value.toLowerCase());
                          if (!emailFieldTouched) setEmailFieldTouched(true);
                          const next = validateRecipientEmail(value);
                          setEmailSuggestion(next.suggestion || null);
                        }}
                        onBlur={() => {
                          setEmailFieldTouched(true);
                          const normalized = emailAddress.trim().toLowerCase();
                          if (normalized !== emailAddress) setEmailAddress(normalized);
                          const next = validateRecipientEmail(normalized);
                          setEmailSuggestion(next.suggestion || null);
                        }}
                        keyboardType="email-address"
                        autoCapitalize="none"
                      />
                    </View>

                    {showEmailValidationError && (
                      <Text style={styles.errorHint}>{emailValidation.error}</Text>
                    )}

                    {!!emailSuggestion && !emailValidation.isValid && (
                      <TouchableOpacity
                        onPress={() => {
                          setEmailAddress(emailSuggestion);
                          setEmailFieldTouched(true);
                          setEmailSuggestion(null);
                        }}
                        style={styles.suggestionBox}
                      >
                        <Text style={styles.suggestionText}>Did you mean <Text style={{ color: Theme.primary, textDecorationLine: 'underline' }}>{emailSuggestion}</Text>?</Text>
                      </TouchableOpacity>
                    )}

                    <TouchableOpacity
                      onPress={handleEmailPdf}
                      disabled={isDownloading || isSendingEmail || !emailValidation.isValid || (downloadFilter === "CUSTOM" && (!downloadRangeStart || !downloadRangeEnd || new Date(downloadRangeEnd) < new Date(downloadRangeStart)))}
                      activeOpacity={0.8}
                    >
                      <LinearGradient
                        colors={["#0284c7", "#38bdf8"]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={[
                          styles.premiumActionBtn,
                          (isDownloading || isSendingEmail || !emailValidation.isValid || (downloadFilter === "CUSTOM" && (!downloadRangeStart || !downloadRangeEnd || new Date(downloadRangeEnd) < new Date(downloadRangeStart)))) && { opacity: 0.5 }
                        ]}
                      >
                        {isSendingEmail ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <>
                            <Ionicons name="send" size={18} color="#fff" style={{ marginRight: 8 }} />
                            <Text style={styles.premiumActionBtnText}>Send to Email</Text>
                          </>
                        )}
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              </View>
            </View>
          </Modal>

          {showDownloadDatePicker && (
            <Modal transparent visible={showDownloadDatePicker} animationType="fade">
              <View style={styles.modalOverlay}>
                <TouchableOpacity
                  style={styles.modalDismiss}
                  onPress={() => setShowDownloadDatePicker(false)}
                />
                <View
                  style={[
                    styles.modalContent,
                    { width: SCREEN_W > 600 ? 330 : "85%" },
                  ]}
                >
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>
                      {downloadPickerMode === "START" ? "Select From Date" : "Select To Date"}
                    </Text>
                    <TouchableOpacity onPress={() => setShowDownloadDatePicker(false)}>
                      <Ionicons name="close" size={24} color={Theme.danger} />
                    </TouchableOpacity>
                  </View>
                  <CalendarPicker
                    selectedDate={
                      downloadPickerMode === "START" && downloadRangeStart
                        ? downloadRangeStart
                        : downloadPickerMode === "END" && downloadRangeEnd
                          ? downloadRangeEnd
                          : new Date().toISOString().split("T")[0]
                    }
                    rangeStart={downloadRangeStart}
                    rangeEnd={downloadRangeEnd}
                    isRangeMode={false}
                    onDateChange={(date) => {
                      if (downloadPickerMode === "START") {
                        setDownloadRangeStart(date);
                      } else {
                        setDownloadRangeEnd(date);
                      }
                      setShowDownloadDatePicker(false);
                    }}
                  />
                  <TouchableOpacity
                    onPress={() => {
                      const today = new Date().toISOString().split("T")[0];
                      if (downloadPickerMode === "START") {
                        setDownloadRangeStart(today);
                      } else {
                        setDownloadRangeEnd(today);
                      }
                      setShowDownloadDatePicker(false);
                    }}
                    style={{ alignSelf: "center", marginTop: 15, paddingBottom: 5 }}
                  >
                    <Text style={{ color: Theme.primary, fontFamily: Fonts.black, fontSize: 13, textDecorationLine: "underline" }}>GO TO TODAY</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
          )}

          {showDatePicker && (
            <Modal transparent visible={showDatePicker} animationType="fade">
              <View style={styles.modalOverlay}>
                <TouchableOpacity
                  style={styles.modalDismiss}
                  onPress={() => setShowDatePicker(false)}
                />
                <View
                  style={[
                    styles.modalContent,
                    { width: SCREEN_W > 600 ? 330 : "85%" },
                  ]}
                >
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>
                      {selectedFilter === "DAILY"
                        ? "Select Date"
                        : selectedFilter === "WEEKLY"
                          ? "Select Week"
                          : selectedFilter === "MONTHLY"
                            ? "Select Month"
                            : selectedFilter === "YEARLY"
                              ? "Select Year"
                              : "Select Date"}
                    </Text>
                    <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                      <Ionicons name="close" size={24} color={Theme.danger} />
                    </TouchableOpacity>
                  </View>
                  <CalendarPicker
                    selectedDate={
                      pickerMode === "START" && rangeStart
                        ? rangeStart
                        : pickerMode === "END" && rangeEnd
                          ? rangeEnd
                          : selectedDate
                    }
                    rangeStart={selectedFilter === "DAILY" ? null : effectiveDateRange.startDate}
                    rangeEnd={selectedFilter === "DAILY" ? null : effectiveDateRange.endDate}
                    isRangeMode={false}
                    disableFutureDates={true}
                    maxDate={activeBusinessDate || undefined}
                    onDateChange={(date) => {
                      const maxDateStr = activeBusinessDate || getTodayDateStr();
                      const clampedDate = date > maxDateStr ? maxDateStr : date;
                      setSelectedDate(clampedDate);
                      const { startDate, endDate } = calculatePeriodRange(selectedFilter, clampedDate, maxDateStr);
                      setRangeStart(startDate);
                      setRangeEnd(endDate);
                      setShowDatePicker(false);
                    }}
                  />
                  <TouchableOpacity
                    onPress={() => {
                      const maxDateStr = activeBusinessDate || getTodayDateStr();
                      setSelectedDate(maxDateStr);
                      const { startDate, endDate } = calculatePeriodRange(selectedFilter, maxDateStr, maxDateStr);
                      setRangeStart(startDate);
                      setRangeEnd(endDate);
                      setShowDatePicker(false);
                    }}
                    style={{ alignSelf: "center", marginTop: 15, paddingBottom: 5 }}
                  >
                    <Text style={{ color: Theme.primary, fontFamily: Fonts.black, fontSize: 13, textDecorationLine: "underline" }}>GO TO TODAY</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  overlay: { flex: 1, paddingHorizontal: 16 },
  dashboardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    gap: 12,
  },
  headerContent: { flex: 1 },
  dashboardYear: {
    color: Theme.primary,
    fontFamily: Fonts.black,
    fontSize: 11,
    marginBottom: 2,
    letterSpacing: 2,
    textTransform: "uppercase",
    opacity: 0.8,
  },
  dashboardTitle: {
    color: Theme.textPrimary,
    fontFamily: Fonts.black,
    fontSize: 23,
  },
  dashboardSubtitle: {
    color: Theme.textSecondary,
    fontFamily: Fonts.semiBold,
    fontSize: 11,
    marginTop: 3,
  },
  headerActions: { flexDirection: "row", gap: 10, alignItems: "center" },
  filterMenuBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Theme.primary + "18",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1.5,
    borderColor: Theme.primary + "35",
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: Theme.bgCard,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowSm,
  },
  backBtnLabel: {
    color: Theme.textPrimary,
    fontFamily: Fonts.semiBold,
    fontSize: 14,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  activeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: Theme.bgCard,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  badgeText: {
    color: Theme.textSecondary,
    fontFamily: Fonts.bold,
    fontSize: 10,
  },
  filterBar: {
    flexDirection: "row",
    borderRadius: 16,
    padding: 5,
    backgroundColor: Theme.bgNav,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowSm,
  },
  filterBtn: {
    flex: 1,
    paddingVertical: 11,
    alignItems: "center",
    borderRadius: 12,
  },
  activeFilterBtn: {
    backgroundColor: Theme.primary,
    shadowColor: Theme.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 6,
  },
  filterText: {
    color: Theme.textSecondary,
    fontFamily: Fonts.black,
    fontSize: 11,
    letterSpacing: 0.5,
  },
  activeFilterText: { color: "#fff" },
  dateControl: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
    gap: 12,
  },
  navBtn: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Theme.bgCard,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
  },
  dateDisplay: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
    backgroundColor: Theme.bgCard,
  },
  dateText: { color: Theme.textPrimary, fontFamily: Fonts.black, fontSize: 16 },
  rangeLabel: {
    fontSize: 9,
    fontFamily: Fonts.bold,
    color: Theme.textMuted,
    marginBottom: -2,
  },
  selectRangeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: Theme.primary + "10",
    borderWidth: 1,
    borderColor: Theme.primary + "20",
    marginLeft: 4,
  },
  selectRangeText: {
    color: Theme.primary,
    fontFamily: Fonts.black,
    fontSize: 11,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 24,
    gap: 12,
  },
  metricsRow: {
    flexDirection: "row",
    width: "100%",
    justifyContent: "space-between",
    gap: 12,
  },
  metricsRowCentered: {
    justifyContent: "center",
    gap: 16,
  },
  metricTile: {
    padding: 16,
    borderRadius: 20,
    borderLeftWidth: 5,
    backgroundColor: Theme.bgCard,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  tileIconContainer: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  tileContent: {
    flex: 1,
    justifyContent: "center",
  },
  tileLabel: {
    color: Theme.textSecondary,
    fontFamily: Fonts.black,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  tileValue: {
    fontFamily: Fonts.black,
    fontSize: 22,
    letterSpacing: -0.3,
  },
  tileSubtitle: {
    color: Theme.textMuted,
    fontFamily: Fonts.medium,
    fontSize: 10,
    marginTop: 2,
  },
  reportSwitchRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 16,
  },
  reportSwitchBtn: {
    flex: 1,
    minWidth: 140,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: Theme.bgCard,
    borderWidth: 1,
    borderColor: Theme.primaryBorder,
    ...Theme.shadowSm,
  },
  activeReportSwitchBtn: {
    backgroundColor: Theme.primary,
    borderColor: Theme.primary,
  },
  reportSwitchText: {
    color: Theme.primary,
    fontFamily: Fonts.black,
    fontSize: 13,
  },
  activeReportSwitchText: { color: "#fff" },
  detailReportCard: {
    padding: 20,
    borderRadius: 20,
    marginBottom: 24,
    backgroundColor: Theme.bgCard,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowMd,
  },
  detailReportHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 14,
  },
  reportTitleContainer: { flex: 1, alignItems: "center" },
  reportHeaderActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  reportCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fee2e2", // Light red background
    borderWidth: 1,
    borderColor: "#fecaca", // Light red border
  },
  reportSubText: {
    color: Theme.textMuted,
    fontFamily: Fonts.semiBold,
    fontSize: 12,
    marginTop: 4,
  },
  reportLoading: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  emptyReport: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  emptyContainer: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 24,
  },
  emptyText: {
    color: Theme.textMuted,
    fontFamily: Fonts.medium,
    fontSize: 13,
  },
  reportTable: {
    width: "100%",
    minWidth: 360,
    borderWidth: 1,
    borderColor: Theme.border,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: Theme.bgCard,
  },
  reportTableHeader: {
    flexDirection: "row",
    backgroundColor: Theme.bgMuted,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
  },
  reportTableRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
  },
  reportTableRowAlt: {
    backgroundColor: Theme.bgMain,
  },
  reportCell: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: Theme.textMuted,
    fontFamily: Fonts.black,
    fontSize: 11,
    textTransform: "uppercase",
    textAlign: "center",
  },
  reportCellText: {
    color: Theme.textPrimary,
    fontFamily: Fonts.bold,
    fontSize: 13,
    textTransform: "none",
    textAlign: "center",
  },
  snoCell: {
    width: 45,
    textAlign: "center",
    flexShrink: 0,
  },
  dishNameCell: {
    minWidth: 150,
    flex: 2,
    textAlign: "center",
  },
  categoryNameCell: {
    minWidth: 120,
    flex: 1.5,
    textAlign: "center",
  },
  subCategoryNameCell: {
    minWidth: 100,
    flex: 1,
    textAlign: "center",
  },
  qtyCell: {
    width: 70,
    textAlign: "center",
    flexShrink: 0,
  },
  amountCell: {
    width: 130,
    textAlign: "right",
    flexShrink: 0,
  },
  discountCell: {
    width: 90,
    textAlign: "right",
    flexShrink: 0,
  },
  paymodeCell: {
    minWidth: 100,
    flex: 1,
    textAlign: "left",
  },
  sysAmtCell: {
    width: 90,
    textAlign: "right",
    flexShrink: 0,
  },
  manualAmtCell: {
    width: 90,
    textAlign: "right",
    flexShrink: 0,
  },
  diffCell: {
    width: 80,
    textAlign: "right",
    flexShrink: 0,
  },
  tableHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  tableHeaderCell: {
    color: Theme.textSecondary,
    fontFamily: Fonts.bold,
    fontSize: 12,
    textTransform: "uppercase",
  },
  tableDataRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border + "40",
  },
  tableCellPrimary: {
    color: Theme.textPrimary,
    fontFamily: Fonts.bold,
    fontSize: 13,
  },
  tableCellSecondary: {
    color: Theme.textMuted,
    fontFamily: Fonts.regular,
    fontSize: 11,
    marginTop: 2,
  },
  tableCellNum: {
    color: Theme.textPrimary,
    fontFamily: Fonts.bold,
    fontSize: 13,
    textAlign: "right",
  },
  chartsScrollContent: {
    paddingRight: 16,
    marginBottom: 12,
  },
  chartsContainer: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 12,
  },
  chartCard: {
    flex: 1,
    padding: 20,
    borderRadius: 24,
    backgroundColor: Theme.bgCard,
    borderWidth: 1,
    borderColor: Theme.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.13,
    shadowRadius: 14,
    elevation: 6,
  },
  chartCardWide: { width: "100%" },
  chartCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  cardTitle: {
    color: Theme.textSecondary,
    fontFamily: Fonts.black,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  chartContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  pieChartWrapper: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },
  pieDonutCenter: { alignItems: "center", justifyContent: "center", gap: 4 },
  pieDonutCenterLine: { textAlign: "center" },
  pieDonutCenterPct: { fontFamily: Fonts.black, fontSize: 13 },
  pieDonutCenterTag: {
    color: Theme.textMuted,
    fontFamily: Fonts.bold,
    fontSize: 10,
  },
  emptyChartPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
    gap: 12,
  },
  emptyChartText: {
    color: Theme.textMuted,
    fontFamily: Fonts.semiBold,
    fontSize: 13,
  },
  orderTypeStats: { gap: 12 },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
  },
  statLabel: { flexDirection: "row", alignItems: "center", gap: 8 },
  statIcon: { fontSize: 20 },
  statName: { color: Theme.textPrimary, fontFamily: Fonts.bold, fontSize: 13 },
  statValue: { fontFamily: Fonts.black, fontSize: 16 },
  metricsStats: { gap: 10 },
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
  },
  metricLabel: {
    color: Theme.textSecondary,
    fontFamily: Fonts.bold,
    fontSize: 12,
  },
  metricValueSmall: {
    color: Theme.textPrimary,
    fontFamily: Fonts.black,
    fontSize: 15,
  },
  breakdownCard: {
    padding: 20,
    borderRadius: 24,
    marginBottom: 16,
    backgroundColor: Theme.bgCard,
    borderWidth: 1,
    borderColor: Theme.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.13,
    shadowRadius: 14,
    elevation: 6,
  },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  breakdownItem: {
    alignItems: "center",
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 14,
    backgroundColor: "#ffffff",
    borderWidth: 1.5,
    borderColor: Theme.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  breakdownIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 2,
  },
  breakdownLabel: {
    color: Theme.textSecondary,
    fontFamily: Fonts.bold,
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    textAlign: "center",
  },
  breakdownValue: { fontFamily: Fonts.black, fontSize: 13, textAlign: "center" },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 12,
    marginTop: 8,
  },
  sectionHeaderText: {
    color: Theme.textSecondary,
    fontFamily: Fonts.black,
    fontSize: 13,
    letterSpacing: 1,
  },
  seeAllText: { color: Theme.primary, fontFamily: Fonts.black, fontSize: 12 },
  transactionCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 18,
    marginBottom: 10,
    backgroundColor: Theme.bgCard,
    borderWidth: 1,
    borderColor: Theme.border,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 6,
    elevation: 2,
  },
  txIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: Theme.primary + "18",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.primary + "25",
  },
  txOrderInfo: { flex: 4, paddingRight: 10 },
  txTitle: { color: Theme.textPrimary, fontFamily: Fonts.bold, fontSize: 13 },
  txSmall: {
    color: Theme.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 10,
    marginTop: 3,
  },
  txTimeInfo: { flex: 2.7, alignItems: "center" },
  txDatetime: {
    color: Theme.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 11,
    textAlign: "center",
  },
  txRightInfo: {
    flex: 2.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
  },
  txAmount: {
    color: Theme.textPrimary,
    fontFamily: Fonts.black,
    fontSize: 15,
    minWidth: 55,
    textAlign: "right",
  },
  voidTag: {
    backgroundColor: "#fee2e2",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  voidTagText: { color: "#dc2626", fontSize: 10, fontFamily: Fonts.black },
  paidBadgeSmall: {
    backgroundColor: Theme.success + "20",
    padding: 5,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.success + "40",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalDismiss: { ...StyleSheet.absoluteFillObject },
  modalContent: {
    width: "92%",
    maxWidth: 400,
    maxHeight: "85%",
    backgroundColor: Theme.bgCard,
    borderRadius: 20,
    padding: 14,
    ...Theme.shadowLg,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: {
    color: Theme.textPrimary,
    fontFamily: Fonts.black,
    fontSize: 16,
  },
  modalSub: {
    color: Theme.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 11,
    marginTop: 2,
  },
  modalDivider: {
    height: 1,
    backgroundColor: Theme.border,
    marginVertical: 12,
  },
  itemsList: { maxHeight: 220 },
  orderItemRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    gap: 8,
  },
  orderItemQty: {
    color: Theme.primary,
    fontFamily: Fonts.black,
    fontSize: 13,
    width: 25,
  },
  orderItemName: {
    flex: 1,
    color: Theme.textPrimary,
    fontFamily: Fonts.bold,
    fontSize: 13,
  },
  orderItemPrice: {
    color: Theme.textPrimary,
    fontFamily: Fonts.black,
    fontSize: 13,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
  },
  totalLabel: {
    color: Theme.textPrimary,
    fontFamily: Fonts.black,
    fontSize: 16,
  },
  totalValue: { color: Theme.primary, fontFamily: Fonts.black, fontSize: 22 },
  doneBtn: {
    backgroundColor: Theme.primary,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    ...Theme.shadowMd,
  },
  doneBtnText: { color: "#fff", fontFamily: Fonts.black, fontSize: 14 },
  qtyBadgeSmall: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    minWidth: 32,
  },
  searchInput: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: Fonts.semiBold,
    fontSize: 14,
    color: Theme.textPrimary,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  inputErrorBorder: {
    borderColor: "#ef4444",
  },
  inputErrorText: {
    color: "#ef4444",
    fontFamily: Fonts.semiBold,
    fontSize: 12,
    marginTop: 8,
  },
  emailSuggestionText: {
    color: Theme.primary,
    fontFamily: Fonts.semiBold,
    fontSize: 12,
    marginTop: 6,
    textDecorationLine: "underline",
  },
  premiumPrimaryBtn: {
    backgroundColor: Theme.primary,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    ...Theme.shadowMd,
  },
  premiumPrimaryBtnText: {
    color: "#fff",
    fontFamily: Fonts.black,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  premiumSecondaryBtn: {
    backgroundColor: Theme.primary + "10",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    borderWidth: 1.5,
    borderColor: Theme.primary + "20",
  },
  premiumSecondaryBtnText: {
    color: Theme.primary,
    fontFamily: Fonts.black,
    fontSize: 13,
  },
  sidebarOverlay: {
    flex: 1,
    flexDirection: "row-reverse",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sidebarDismiss: { flex: 1 },
  sidebarContent: {
    width: 320,
    height: "100%",
    backgroundColor: Theme.bgCard,
    padding: 24,
    paddingTop: 60,
    borderLeftWidth: 1,
    borderLeftColor: Theme.border,
  },
  sidebarHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 30,
  },
  sidebarTitle: {
    color: Theme.textPrimary,
    fontFamily: Fonts.black,
    fontSize: 16,
  },
  sidebarSection: { marginBottom: 24 },
  sectionLabel: {
    color: Theme.textMuted,
    fontFamily: Fonts.black,
    fontSize: 10,
    letterSpacing: 1,
    marginBottom: 12,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
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
  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: Theme.bgMuted,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  activeSortBtn: {
    backgroundColor: Theme.primary + "10",
    borderColor: Theme.primary,
  },
  sortText: {
    color: Theme.textSecondary,
    fontFamily: Fonts.bold,
    fontSize: 13,
  },
  activeSortText: { color: Theme.primary },
  sidebarFooter: { marginTop: "auto", gap: 12 },
  applyBtn: {
    backgroundColor: Theme.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    ...Theme.shadowMd,
  },
  applyText: { color: "#fff", fontFamily: Fonts.black, fontSize: 14 },
  resetBtn: { paddingVertical: 14, alignItems: "center" },
  resetText: { color: Theme.textMuted, fontFamily: Fonts.bold, fontSize: 12 },
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
  inRangeDay: {
    backgroundColor: Theme.primary + "20",
    borderRadius: 0,
  },
  customCalendar: {
    paddingTop: 5,
  },
  pickerGrid: {
    paddingVertical: 10,
  },
  pickerHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 15,
    paddingHorizontal: 5,
  },
  pickerTitle: {
    fontSize: 14,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  pickerSubtitle: {
    fontSize: 14,
    fontFamily: Fonts.black,
    color: Theme.primary,
    backgroundColor: Theme.primary + "10",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  gridRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  pickerItem: {
    width: "30%",
    paddingVertical: 12,
    alignItems: "center",
    borderRadius: 10,
    backgroundColor: Theme.bgNav,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  activePickerItem: {
    backgroundColor: Theme.primary,
    borderColor: Theme.primary,
  },
  pickerItemText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  activePickerItemText: {
    color: "#fff",
    fontFamily: Fonts.black,
  },
  calendarHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  calendarNavBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Theme.bgMuted,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
  },
  calendarMonthText: {
    fontSize: 16,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  calendarWeekRow: {
    flexDirection: "row",
    marginBottom: 10,
  },
  calendarWeekText: {
    flex: 1,
    textAlign: "center",
    color: Theme.textMuted,
    fontFamily: Fonts.bold,
    fontSize: 12,
  },
  calendarRow: {
    flexDirection: "row",
    marginBottom: 5,
  },
  calendarDay: {
    flex: 1,
    aspectRatio: 1,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 8,
    margin: 1,
  },
  calendarDayText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  selectedDay: {
    backgroundColor: Theme.primary,
    ...Theme.shadowSm,
  },
  selectedDayText: {
    color: "#fff",
    fontFamily: Fonts.black,
  },
  todayDay: {
    backgroundColor: Theme.primary + "10",
    borderWidth: 1,
    borderColor: Theme.primary + "30",
  },
  otherMonthDay: {
    opacity: 0.3,
  },
  otherMonthDayText: {
    color: Theme.textMuted,
  },
  cancelledOrderBadge: {
    backgroundColor: Theme.danger + "08",
    borderRadius: 10,
    marginTop: 4,
    marginBottom: 8,
    borderWidth: 1.2,
    borderColor: Theme.danger + "25",
    padding: 12,
  },
  cancelledBadgeMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  cancelledBadgeText: {
    color: Theme.danger,
    fontFamily: Fonts.black,
    fontSize: 13,
    letterSpacing: 0.5,
  },
  cancelledReasonBadge: {
    backgroundColor: Theme.danger + "15",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  cancelledReasonText: {
    color: Theme.danger,
    fontFamily: Fonts.extraBold,
    fontSize: 10,
  },
  cancelledDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: Theme.danger + "15",
    paddingTop: 8,
  },
  cancelledDetailText: {
    color: Theme.textMuted,
    fontFamily: Fonts.bold,
    fontSize: 10,
  },
  downloadModalContent: {
    backgroundColor: Theme.bgCard,
    borderRadius: 20,
    padding: 12,
    ...Theme.shadowLg,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  modalCloseBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Theme.bgNav,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Theme.border,
  },
  downloadSectionCard: {
    backgroundColor: Theme.bgNav,
    borderRadius: 14,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  downloadSectionLabel: {
    color: Theme.textMuted,
    fontFamily: Fonts.black,
    fontSize: 7,
    letterSpacing: 1,
    marginBottom: 6,
  },
  periodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  periodBtn: {
    flex: 1,
    minWidth: '18%',
    paddingVertical: 6,
    paddingHorizontal: 2,
    borderRadius: 8,
    backgroundColor: Theme.bgCard,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  activePeriodBtn: {
    backgroundColor: Theme.primary,
    borderColor: Theme.primary,
    ...Theme.shadowSm,
  },
  periodText: {
    fontSize: 8,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  activePeriodText: {
    color: '#fff',
    fontFamily: Fonts.black,
  },
  customDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Theme.border,
  },
  dateInput: {
    flex: 1,
    padding: 6,
    borderRadius: 6,
    backgroundColor: Theme.bgCard,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  activeDateInput: {
    borderColor: Theme.primary,
  },
  dateInputLabel: {
    fontSize: 6,
    fontFamily: Fonts.black,
    color: Theme.textMuted,
    marginBottom: 0,
  },
  dateInputValue: {
    fontSize: 9,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  downloadOptionCard: {
    backgroundColor: Theme.bgCard,
    borderRadius: 14,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowSm,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  optionIconBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: Theme.primary + '10',
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionTitle: {
    fontSize: 11,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  optionDesc: {
    fontSize: 8,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
  },
  premiumActionBtn: {
    height: 34,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...Theme.shadowMd,
  },
  premiumActionBtnText: {
    color: '#fff',
    fontFamily: Fonts.black,
    fontSize: 12,
  },
  emailInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.bgNav,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.border,
    marginBottom: 6,
    paddingHorizontal: 8,
  },
  inputIcon: {
    marginRight: 4,
  },
  modernEmailInput: {
    flex: 1,
    height: 32,
    fontFamily: Fonts.semiBold,
    fontSize: 12,
    color: Theme.textPrimary,
  },
  errorHint: {
    color: '#ef4444',
    fontSize: 9,
    fontFamily: Fonts.medium,
    marginLeft: 4,
    marginBottom: 6,
  },
  suggestionBox: {
    backgroundColor: Theme.primary + '08',
    padding: 6,
    borderRadius: 6,
    marginBottom: 6,
    borderLeftWidth: 2,
    borderLeftColor: Theme.primary,
  },
  suggestionText: {
    fontSize: 10,
    color: Theme.textSecondary,
    fontFamily: Fonts.medium,
  },
  detailMergeContainer: {
    backgroundColor: '#fff7ed',
    borderColor: '#ffedd5',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
  },
  detailMergeTitle: {
    color: '#ea580c',
    fontSize: 11,
    fontFamily: Fonts.black,
  },
  childBillBadge: {
    backgroundColor: '#ffedd5',
    borderColor: '#fed7aa',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  childBillBadgeText: {
    color: '#c2410c',
    fontSize: 10,
    fontFamily: Fonts.bold,
  },
  detailSplitContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderColor: '#dbeafe',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 12,
    gap: 8,
  },
  detailSplitText: {
    color: '#2563eb',
    fontSize: 11,
    fontFamily: Fonts.bold,
  },
  modifierPillsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
    marginLeft: 8,
  },
  modifierPill: {
    backgroundColor: '#fafafa',
    borderColor: '#e4e4e7',
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  modifierPillText: {
    fontSize: 10,
    color: '#52525b',
    fontFamily: Fonts.semiBold,
  },
  mainFilterBar: {
    flexDirection: 'row',
    paddingVertical: 4,
    paddingHorizontal: 4,
    gap: 8,
  },
  mainFilterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Theme.bgCard,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  activeMainFilterBtn: {
    backgroundColor: Theme.primary,
    borderColor: Theme.primary,
    ...Theme.shadowSm,
  },
  mainFilterText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  activeMainFilterText: {
    color: '#fff',
    fontFamily: Fonts.black,
  },
});
