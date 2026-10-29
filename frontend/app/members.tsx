import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  ScrollView,
  RefreshControl,
  Platform,
  StatusBar,
  Linking,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useRouter } from "expo-router";
import { usePathname } from "expo-router";
import { API_URL } from "@/constants/Config";
import { Fonts } from "../constants/Fonts";
import { Theme } from "../constants/theme";
import { useAuthStore } from "@/stores/authStore";
import { formatToSingaporeDate, formatToSingaporeTime } from "../utils/timezoneHelper";
import SplitPaymentComponent from "../components/payment/SplitPaymentComponent";



// Low-balance threshold (must match backend utils/whatsappService.js)
const LOW_BALANCE_THRESHOLD_PCT = 0.10; // 10% of CreditLimit
const LOW_BALANCE_THRESHOLD_FIXED = 100; // fallback when CreditLimit = 0
const getLowBalanceThreshold = (creditLimit: number) =>
  creditLimit > 0 ? creditLimit * LOW_BALANCE_THRESHOLD_PCT : LOW_BALANCE_THRESHOLD_FIXED;

type MemberType = {
  MemberId: string;
  Name: string;
  Phone: string;
  Email?: string;
  Address?: string;
  IsActive?: boolean | number;
  CreditLimit?: number;
  CurrentBalance?: number;
  Balance?: number;
  LowBalanceAlertSent?: boolean | number;
  Promocode?: string;
  Promoamount?: number;
  AvailableCredit?: number;
  RewardCredit?: number;
};

const formatMoney = (amount: number) => {
  try {
    return `$${(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  } catch (e) {
    return `$${(amount || 0).toFixed(2)}`;
  }
};

const COUNTRIES = [
  { code: "+65", label: "🇸🇬 +65", name: "Singapore" },
  { code: "+60", label: "🇲🇾 +60", name: "Malaysia" },
  { code: "+971", label: "🇦🇪 +971", name: "UAE" },
  { code: "+91", label: "🇮🇳 +91", name: "India" },
  { code: "+1", label: "🇺🇸 +1", name: "USA" },
  { code: "+44", label: "🇬🇧 +44", name: "UK" },
  { code: "+61", label: "🇦🇺 +61", name: "Australia" },
  { code: "+62", label: "🇮🇩 +62", name: "Indonesia" },
  { code: "+66", label: "🇹🇭 +66", name: "Thailand" },
];

function parsePhoneNumber(rawPhone: string) {
  const clean = String(rawPhone || "").trim();
  for (const country of COUNTRIES) {
    if (clean.startsWith(country.code)) {
      return {
        countryCode: country.code,
        localNumber: clean.slice(country.code.length)
      };
    }
    const codeNoPlus = country.code.slice(1);
    if (clean.startsWith(codeNoPlus)) {
      return {
        countryCode: country.code,
        localNumber: clean.slice(codeNoPlus.length)
      };
    }
  }
  return {
    countryCode: "+65",
    localNumber: clean.startsWith("+") ? clean.slice(1) : clean
  };
}

export default function MembersScreen() {
  const router = useRouter();
  const { user, token } = useAuthStore();
  const pathname = usePathname();
  const isFocused = pathname === "/members";
  const { width: screenWidth } = useWindowDimensions();
  const isMobile = screenWidth < 768;
  const [members, setMembers] = useState<MemberType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [stats, setStats] = useState<{
    totalOutstanding: number;
    totalOverdue: number;
    totalCustomersWithCredit: number;
    collectionsToday: number;
    collectionsThisMonth: number;
    totalCredit: number;
    totalPaid: number;
  } | null>(null);

  // Modal State
  const [modalMode, setModalMode] = useState<"ADD" | "EDIT" | "NONE">("NONE");
  const [editingMember, setEditingMember] = useState<MemberType | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Country Code Selector States
  const [selectedCountryCode, setSelectedCountryCode] = useState("+65");
  const [localPhone, setLocalPhone] = useState("");
  const [showCountryPicker, setShowCountryPicker] = useState(false);

  // Recharge Modal State
  const [showRechargeModal, setShowRechargeModal] = useState(false);
  const [rechargeMember, setRechargeMember] = useState<MemberType | null>(null);
  const [rechargeAmount, setRechargeAmount] = useState("");
  const [isRecharging, setIsRecharging] = useState(false);

  // Usage Modal State
  const [showUsageModal, setShowUsageModal] = useState(false);
  const [usageMember, setUsageMember] = useState<MemberType | null>(null);
  const [usageTab, setUsageTab] = useState<"bills" | "rewards" | "qr">("bills");
  const [usageData, setUsageData] = useState<any>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);

  // Usage Modal Filter States
  const [filterSearch, setFilterSearch] = useState("");
  const [filterDatePreset, setFilterDatePreset] = useState<"ALL" | "TODAY" | "7DAYS" | "30DAYS" | "CUSTOM">("ALL");
  const [filterStartDate, setFilterStartDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");
  const [filterOrderType, setFilterOrderType] = useState<string>("ALL");
  const [filterTableNo, setFilterTableNo] = useState<string>("ALL");
  const [filterPayMode, setFilterPayMode] = useState<string>("ALL");
  const [filterPointsType, setFilterPointsType] = useState<"ALL" | "EARNED" | "REDEEMED" | "OPENING">("ALL");
  const [filterQRStatus, setFilterQRStatus] = useState<string>("ALL");
  const [showFilterPanel, setShowFilterPanel] = useState(false);

  const resetModalFilters = useCallback(() => {
    setFilterSearch("");
    setFilterDatePreset("ALL");
    setFilterStartDate("");
    setFilterEndDate("");
    setFilterOrderType("ALL");
    setFilterTableNo("ALL");
    setFilterPayMode("ALL");
    setFilterPointsType("ALL");
    setFilterQRStatus("ALL");
  }, []);

  const closeUsageModal = useCallback(() => {
    setShowUsageModal(false);
    setUsageMember(null);
    setUsageData(null);
    setShowFilterPanel(false);
    resetModalFilters();
  }, [resetModalFilters]);

  // Dynamic filter options based on actual loaded data
  const availableOrderTypes = useMemo(() => {
    if (!usageData?.transactions) return [];
    const types = new Set<string>();
    usageData.transactions.forEach((tx: any) => {
      const type = (tx.OrderType || 'DINE-IN').trim().toUpperCase();
      if (type) types.add(type);
    });
    return Array.from(types).sort();
  }, [usageData?.transactions]);

  const availableTables = useMemo(() => {
    const tables = new Set<string>();
    usageData?.transactions?.forEach((tx: any) => {
      if (tx.TableNo && String(tx.TableNo).trim()) {
        tables.add(String(tx.TableNo).trim());
      }
    });
    usageData?.qrOrders?.forEach((qr: any) => {
      if (qr.TableNo && String(qr.TableNo).trim()) {
        tables.add(String(qr.TableNo).trim());
      }
    });
    return Array.from(tables).sort((a, b) => {
      const numA = parseInt(a, 10);
      const numB = parseInt(b, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });
  }, [usageData?.transactions, usageData?.qrOrders]);

  const availablePayModes = useMemo(() => {
    if (!usageData?.transactions) return [];
    const modes = new Set<string>();
    usageData.transactions.forEach((tx: any) => {
      if (tx.PayMode && String(tx.PayMode).trim()) {
        modes.add(String(tx.PayMode).trim().toUpperCase());
      }
    });
    return Array.from(modes).sort();
  }, [usageData?.transactions]);

  const availableQRStatuses = useMemo(() => {
    const statuses = new Set<string>(['SETTLED', 'CLOSED', 'OPEN / KITCHEN']);
    usageData?.qrOrders?.forEach((qr: any) => {
      if (qr.BillStatus && String(qr.BillStatus).trim()) {
        statuses.add(String(qr.BillStatus).trim().toUpperCase());
      }
    });
    return Array.from(statuses);
  }, [usageData?.qrOrders]);

  const isDateInFilterRange = useCallback((dateValue: any) => {
    if (!dateValue || filterDatePreset === "ALL") return true;
    const d = new Date(dateValue);
    if (isNaN(d.getTime())) return true;

    // Convert date to YYYY-MM-DD using Singapore timezone
    let itemDateStr = "";
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Singapore',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(d);
      const year = parts.find(p => p.type === 'year')?.value;
      const month = parts.find(p => p.type === 'month')?.value;
      const day = parts.find(p => p.type === 'day')?.value;
      itemDateStr = `${year}-${month}-${day}`;
    } catch (e) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      itemDateStr = `${y}-${m}-${day}`;
    }

    const now = new Date();
    let todayStr = "";
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Singapore',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(now);
      const year = parts.find(p => p.type === 'year')?.value;
      const month = parts.find(p => p.type === 'month')?.value;
      const day = parts.find(p => p.type === 'day')?.value;
      todayStr = `${year}-${month}-${day}`;
    } catch (e) {
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      todayStr = `${y}-${m}-${day}`;
    }

    if (filterDatePreset === "TODAY") {
      return itemDateStr === todayStr;
    }

    if (filterDatePreset === "7DAYS") {
      const diffTime = now.getTime() - d.getTime();
      const diffDays = diffTime / (1000 * 3600 * 24);
      return diffDays >= -0.5 && diffDays <= 7.5;
    }

    if (filterDatePreset === "30DAYS") {
      const diffTime = now.getTime() - d.getTime();
      const diffDays = diffTime / (1000 * 3600 * 24);
      return diffDays >= -0.5 && diffDays <= 30.5;
    }

    if (filterDatePreset === "CUSTOM") {
      if (filterStartDate.trim() && itemDateStr < filterStartDate.trim()) return false;
      if (filterEndDate.trim() && itemDateStr > filterEndDate.trim()) return false;
      return true;
    }

    return true;
  }, [filterDatePreset, filterStartDate, filterEndDate]);

  const renderFilterEmptyState = (title: string, subtitle: string) => (
    <View style={{ backgroundColor: Theme.bgInput, borderRadius: 16, padding: 24, alignItems: 'center', justifyContent: 'center', marginVertical: 10 }}>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: Theme.border, alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
        <Ionicons name="funnel-outline" size={22} color={Theme.textSecondary} />
      </View>
      <Text style={{ fontFamily: Fonts.black, fontSize: 14, color: Theme.textPrimary }}>
        {title}
      </Text>
      <Text style={{ fontFamily: Fonts.medium, fontSize: 12, color: Theme.textMuted, textAlign: 'center', marginTop: 4, marginBottom: 12 }}>
        {subtitle}
      </Text>
      <TouchableOpacity
        onPress={resetModalFilters}
        style={{
          backgroundColor: Theme.primary,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: 10,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Ionicons name="refresh-outline" size={14} color="#fff" />
        <Text style={{ fontFamily: Fonts.bold, fontSize: 12, color: "#fff" }}>Clear Filters & Show All</Text>
      </TouchableOpacity>
    </View>
  );

  // ── Tab 1 Filtered: Bills ──
  const filteredBills = useMemo(() => {
    if (!usageData?.transactions) return [];
    return usageData.transactions.filter((tx: any) => {
      if (!isDateInFilterRange(tx.LastSettlementDate)) return false;

      if (filterOrderType !== "ALL") {
        const type = (tx.OrderType || 'DINE-IN').trim().toUpperCase();
        if (type !== filterOrderType.toUpperCase()) return false;
      }

      if (filterTableNo !== "ALL") {
        if (String(tx.TableNo || '').trim().toLowerCase() !== filterTableNo.trim().toLowerCase()) {
          return false;
        }
      }

      if (filterPayMode !== "ALL") {
        const pm = String(tx.PayMode || '').trim().toUpperCase();
        if (pm !== filterPayMode.toUpperCase()) return false;
      }

      if (filterSearch.trim()) {
        const q = filterSearch.trim().toLowerCase();
        const billNo = String(tx.BillNo || '').toLowerCase();
        const table = String(tx.TableNo || '').toLowerCase();
        const payMode = String(tx.PayMode || '').toLowerCase();
        const type = String(tx.OrderType || '').toLowerCase();
        const amount = String(tx.SysAmount || '').toLowerCase();
        const matches = billNo.includes(q) || table.includes(q) || payMode.includes(q) || type.includes(q) || amount.includes(q);
        if (!matches) return false;
      }

      return true;
    });
  }, [usageData?.transactions, isDateInFilterRange, filterOrderType, filterTableNo, filterPayMode, filterSearch]);

  // ── Tab 2 Filtered: Reward Points History ──
  const filteredRewards = useMemo(() => {
    if (!usageData?.rewardHistory) return [];
    return usageData.rewardHistory.filter((item: any) => {
      if (!isDateInFilterRange(item.Date)) return false;

      if (filterPointsType !== "ALL") {
        const isOpening = item.Type === 'OPENING' || item.BillNo === 'OPENING-BALANCE' || item.BillNo === 'WALLET';
        const isRedeem = item.Type === 'REDEEMED' || item.Type === 'REDEEM' || Number(item.Points) < 0;
        const isEarn = item.Type === 'EARNED' || (!isOpening && !isRedeem && Number(item.Points) > 0);

        if (filterPointsType === "EARNED" && !isEarn) return false;
        if (filterPointsType === "REDEEMED" && !isRedeem) return false;
        if (filterPointsType === "OPENING" && !isOpening) return false;
      }

      if (filterSearch.trim()) {
        const q = filterSearch.trim().toLowerCase();
        const billNo = String(item.BillNo || '').toLowerCase();
        const remarks = String(item.Remarks || '').toLowerCase();
        const points = String(item.Points || '').toLowerCase();
        const amount = String(item.Amount || '').toLowerCase();
        const table = String(item.TableNo || '').toLowerCase();
        const matches = billNo.includes(q) || remarks.includes(q) || points.includes(q) || amount.includes(q) || table.includes(q);
        if (!matches) return false;
      }

      return true;
    });
  }, [usageData?.rewardHistory, isDateInFilterRange, filterPointsType, filterSearch]);

  // ── Tab 3 Filtered: QR Orders ──
  const filteredQROrders = useMemo(() => {
    if (!usageData?.qrOrders) return [];
    return usageData.qrOrders.filter((qr: any) => {
      if (!isDateInFilterRange(qr.OrderDateTime)) return false;

      if (filterQRStatus !== "ALL") {
        const status = String(qr.BillStatus || 'SETTLED').trim().toUpperCase();
        if (status !== filterQRStatus.toUpperCase()) return false;
      }

      if (filterSearch.trim()) {
        const q = filterSearch.trim().toLowerCase();
        const orderNo = String(qr.OrderNumber || '').toLowerCase();
        const table = String(qr.TableNo || '').toLowerCase();
        const status = String(qr.BillStatus || '').toLowerCase();
        const amount = String(qr.TotalAmount ?? qr.SettledAmount ?? '').toLowerCase();
        const matches = orderNo.includes(q) || table.includes(q) || status.includes(q) || amount.includes(q);
        if (!matches) return false;
      }

      return true;
    });
  }, [usageData?.qrOrders, isDateInFilterRange, filterQRStatus, filterSearch]);

  const currentTabActiveFilterCount = useMemo(() => {
    let count = 0;
    if (filterSearch.trim()) count++;
    if (filterDatePreset !== "ALL") count++;

    if (usageTab === "bills") {
      if (filterOrderType !== "ALL") count++;
      if (filterTableNo !== "ALL") count++;
      if (filterPayMode !== "ALL") count++;
    } else if (usageTab === "rewards") {
      if (filterPointsType !== "ALL") count++;
    } else if (usageTab === "qr") {
      if (filterQRStatus !== "ALL") count++;
    }
    return count;
  }, [usageTab, filterSearch, filterDatePreset, filterOrderType, filterTableNo, filterPayMode, filterPointsType, filterQRStatus]);

  const isAnyFilterActive = currentTabActiveFilterCount > 0;

  // Bill Details State
  const [selectedBill, setSelectedBill] = useState<any>(null);
  const [billDetails, setBillDetails] = useState<any[]>([]);
  const [loadingBillDetails, setLoadingBillDetails] = useState(false);
  const [showBillDetailsModal, setShowBillDetailsModal] = useState(false);

  const handleBillPress = async (tx: any) => {
    const fullTx = usageData?.transactions?.find((t: any) => 
      (t.SettlementID && tx.SettlementID && t.SettlementID === tx.SettlementID) || 
      (t.BillNo && (t.BillNo === tx.BillNo || t.BillNo === tx.OrderNumber))
    ) || {};

    const qrTx = usageData?.qrOrders?.find((q: any) => 
      (q.SettlementID && tx.SettlementID && q.SettlementID === tx.SettlementID) || 
      (q.OrderNumber && (q.OrderNumber === tx.BillNo || q.OrderNumber === tx.OrderNumber))
    ) || {};

    const mergedBill = {
      ...tx,
      ...qrTx,
      ...fullTx,
      SettlementID: tx.SettlementID || fullTx.SettlementID || qrTx.SettlementID,
      BillNo: fullTx.BillNo || tx.BillNo || tx.OrderNumber || qrTx.OrderNumber,
      LastSettlementDate: fullTx.LastSettlementDate || tx.LastSettlementDate || qrTx.OrderDateTime || tx.OrderDateTime,
      SysAmount: Number(fullTx.SysAmount ?? tx.SysAmount ?? qrTx.TotalAmount ?? tx.TotalAmount ?? 0),
      TableNo: fullTx.TableNo || tx.TableNo || qrTx.TableNo || '',
      OrderType: fullTx.OrderType || tx.OrderType || 'DINE-IN',
      isQROrder: fullTx.isQROrder || tx.isQROrder || qrTx.isQROrder || 0
    };

    setSelectedBill(mergedBill);
    setShowBillDetailsModal(true);
    setLoadingBillDetails(true);
    setBillDetails([]);
    try {
      if (mergedBill.SettlementID) {
        const res = await fetch(`${API_URL}/api/sales/detail/${mergedBill.SettlementID}`, {
          headers: { Authorization: token ? `Bearer ${token}` : "" }
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) {
            setBillDetails(data);
            if (!mergedBill.SysAmount || mergedBill.SysAmount === 0) {
              const calcTotal = data.reduce((sum: number, it: any) => sum + ((Number(it.Price) || 0) * (Number(it.Qty) || 1)), 0);
              if (calcTotal > 0) {
                setSelectedBill((prev: any) => ({ ...prev, SysAmount: calcTotal }));
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("[BILL DETAIL FETCH ERROR]", err);
    } finally {
      setLoadingBillDetails(false);
    }
  };

  // ── Recharge handler ────────────────────────────────────────────────────
  const openRechargeModal = (member: MemberType) => {
    setRechargeMember(member);
    setRechargeAmount("");
    setShowRechargeModal(true);
  };

  const handleRecharge = async () => {
    const amt = parseFloat(rechargeAmount);
    if (!rechargeMember || isNaN(amt) || amt <= 0) {
      Alert.alert("Invalid", "Please enter a valid positive amount.");
      return;
    }
    setIsRecharging(true);
    try {
      const res = await fetch(`${API_URL}/api/members/recharge`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ memberId: rechargeMember.MemberId, amount: amt }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMembers(prev =>
          prev.map(m =>
            m.MemberId === rechargeMember.MemberId
              ? {
                  ...m,
                  Balance: data.Balance,
                  CurrentBalance: data.CurrentBalance,
                  LowBalanceAlertSent: data.LowBalanceAlertSent,
                }
              : m
          )
        );
        setShowRechargeModal(false);
        Alert.alert("✅ Recharged", `RM ${amt.toFixed(2)} added to ${rechargeMember.Name}'s balance.`);
      } else {
        Alert.alert("Error", data.error || "Recharge failed.");
      }
    } catch (err) {
      Alert.alert("Error", "Connection problem.");
    } finally {
      setIsRecharging(false);
    }
  };

  // ── WhatsApp low-balance reminder (manual trigger) ───────────────────────
  const handleSendLowBalanceReminder = (member: MemberType) => {
    const outstanding = member.CurrentBalance || 0;
    const hasPlus = member.Phone.trim().startsWith("+");
    const cleanPhone = member.Phone.replace(/[^0-9]/g, "");
    const phoneWithCountry = hasPlus ? cleanPhone : (cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone);
    const message =
      `Dear ${member.Name}, your prepaid balance is low (RM ${outstanding.toFixed(2)}). ` +
      `Please recharge to continue ordering. Thank you! 🙏`;
    const url = `whatsapp://send?phone=${phoneWithCountry}&text=${encodeURIComponent(message)}`;
    Linking.canOpenURL(url).then(supported => {
      if (supported) {
        Linking.openURL(url);
      } else {
        Linking.openURL(`https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(message)}`);
      }
    }).catch(() => {
      Linking.openURL(`https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(message)}`);
    });
  };

  const handleViewUsage = async (member: MemberType) => {
    setUsageMember(member);
    setShowUsageModal(true);
    setLoadingUsage(true);
    setUsageData(null);
    setShowFilterPanel(false);
    resetModalFilters();
    try {
      const res = await fetch(`${API_URL}/api/members/usage/${member.MemberId}`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setUsageData(data);
        }
      }
    } catch (err) {
      console.error("[USAGE FETCH ERROR]", err);
    } finally {
      setLoadingUsage(false);
    }
  };

  const handleCollectPayment = (member: MemberType) => {
    router.push({
      pathname: "/payment" as any,
      params: {
        memberId: member.MemberId,
        collectAmount: String(Math.max(0, member.CurrentBalance || 0)),
        memberName: member.Name,
        memberPhone: member.Phone,
        isMember: "true"
      }
    });
  };

  const handleSendWhatsApp = (member: MemberType) => {
    // Clean phone number (remove spaces, symbols)
    const hasPlus = member.Phone.trim().startsWith("+");
    const cleanPhone = member.Phone.replace(/[^0-9]/g, "");
    const phoneWithCountry = hasPlus ? cleanPhone : (cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone);
    
    const creditLimit = member.CreditLimit || 0;
    const currentBalance = member.CurrentBalance || 0;
    const availableBalance = creditLimit > 0 ? (creditLimit - currentBalance) : currentBalance;

    const formattedAvailable = availableBalance.toFixed(2);
    const formattedCreditLimit = creditLimit.toFixed(2);
    const formattedConsumed = currentBalance.toFixed(2);

    let message = "";
    if (availableBalance < 50) {
      message = `Hi ${member.Name},\n\nYour available balance is $${formattedAvailable}, which is below the minimum threshold of $50.\n\nPlease top up your account to continue enjoying uninterrupted service.\n\nThank you.`;
    } else {
      message = `Hi ${member.Name},\n\nYour current available balance is $${formattedAvailable}.\n\nPrepaid Amount: $${formattedCreditLimit}\nConsumed Amount: $${formattedConsumed}\n\nThank you for being a valued member.`;
    }

    const url = `whatsapp://send?phone=${phoneWithCountry}&text=${encodeURIComponent(message)}`;
    
    Linking.canOpenURL(url).then((supported) => {
      if (supported) {
        Linking.openURL(url);
      } else {
        const webUrl = `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(message)}`;
        Linking.openURL(webUrl);
      }
    }).catch(() => {
      const webUrl = `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(message)}`;
      Linking.openURL(webUrl);
    });
  };

  // Form State
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    isActive: true,
    creditLimit: "1000",
    currentBalance: "0",
    balance: "0",
    promocode: "",
    promoamount: "",
  });

  const fetchMembers = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/members`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMembers(Array.isArray(data) ? data : []);

      // Fetch dashboard stats
      const statsRes = await fetch(`${API_URL}/api/credit-customers/receivables/dashboard`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      if (statsRes.ok) {
        const statsJson = await statsRes.json();
        if (statsJson.success && statsJson.stats) {
          setStats({
            totalOutstanding: Number(statsJson.stats.totalOutstanding || 0),
            totalOverdue: Number(statsJson.stats.totalOverdue || 0),
            totalCustomersWithCredit: Number(statsJson.stats.totalCustomersWithCredit || 0),
            collectionsToday: Number(statsJson.stats.collectionsToday || 0),
            collectionsThisMonth: Number(statsJson.stats.collectionsThisMonth || 0),
            totalCredit: Number(statsJson.stats.totalCredit || 0),
            totalPaid: Number(statsJson.stats.totalPaid || 0)
          });
        }
      }
    } catch (err) {
      console.error("[FETCH ERROR]", err);
    } finally {
      setLoading(false);
    }
  }, [token]);


  useEffect(() => {
    if (isFocused) {
      fetchMembers();
    }
  }, [isFocused, fetchMembers]);

  const openAddModal = () => {
    setFormData({ 
      name: "", 
      phone: "", 
      email: "", 
      address: "",
      isActive: true,
      creditLimit: "1000", 
      currentBalance: "0", 
      balance: "0",
      promocode: "",
      promoamount: ""
    });
    setSelectedCountryCode("+65");
    setLocalPhone("");
    setEditingMember(null);
    setModalMode("ADD");
  };

  const openEditModal = (member: MemberType) => {
    setEditingMember(member);
    const parsed = parsePhoneNumber(member.Phone);
    setSelectedCountryCode(parsed.countryCode);
    setLocalPhone(parsed.localNumber);
    setFormData({
      name: member.Name,
      phone: member.Phone,
      email: member.Email || "",
      address: member.Address || "",
      isActive: member.IsActive === true || member.IsActive === 1,
      creditLimit: String(member.CreditLimit ?? 0),
      currentBalance: String(member.CurrentBalance ?? 0),
      balance: String(member.Balance ?? 0),
      promocode: member.Promocode || "",
      promoamount: String(member.Promoamount ?? 0),
    });
    setModalMode("EDIT");
  };

  const handleSaveMember = async () => {
    if (!formData.name.trim() || !localPhone.trim()) {
      Alert.alert("Required", "Please fill Name and Phone.");
      return;
    }

    setIsSaving(true);
    try {
      const isEdit = modalMode === "EDIT";
      const url = isEdit ? `${API_URL}/api/members/update` : `${API_URL}/api/members/add`;
      const fullPhone = `${selectedCountryCode}${localPhone.trim()}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          memberId: editingMember?.MemberId,
          name: formData.name.trim(),
          phone: fullPhone,
          email: formData.email.trim(),
          address: formData.address.trim(),
          isActive: formData.isActive,
          creditLimit: parseFloat(formData.creditLimit) || 0,
          currentBalance: parseFloat(formData.currentBalance) || 0,
          balance: editingMember ? (editingMember.Balance ?? 0) : 0,
          userId: user?.userId,
          promocode: formData.promocode.trim() || null,
          promoamount: parseFloat(formData.promoamount) || 0,
        }),
      });

      if (res.ok) {
        setModalMode("NONE");
        fetchMembers();
        Alert.alert("Success", isEdit ? "Member updated." : "Member added.");
      } else {
        Alert.alert("Error", "Save failed.");
      }
    } catch (err) {
      Alert.alert("Error", "Connection problem.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteMember = (member: MemberType) => {
    setEditingMember(member);
    setShowDeleteModal(true);
  };

  const filteredMembers = useMemo(() => {
    const query = searchQuery.toLowerCase();
    return members.filter(m =>
      m.Name.toLowerCase().includes(query) ||
      m.Phone.includes(searchQuery)
    );
  }, [members, searchQuery]);

  const MemberCard = React.memo(({ item, onEdit, onDelete, onViewUsage, onCollectPayment, onSendWhatsApp, onRecharge, onSendLowBalanceReminder }: { item: MemberType; onEdit: (m: MemberType) => void; onDelete: (m: MemberType) => void; onViewUsage: (m: MemberType) => void; onCollectPayment: (m: MemberType) => void; onSendWhatsApp: (m: MemberType) => void; onRecharge: (m: MemberType) => void; onSendLowBalanceReminder: (m: MemberType) => void }) => {
    const creditLimit    = item.CreditLimit    || 0;
    const currentBalance = item.CurrentBalance || 0;
    const totalBalance   = item.Balance        || 0;
    const availableCredit = item.AvailableCredit !== undefined ? item.AvailableCredit : (creditLimit > 0 ? (creditLimit - currentBalance) : currentBalance);
    const isLowCredit    = availableCredit < 50;
    const alertSent      = item.LowBalanceAlertSent === true || item.LowBalanceAlertSent === 1;

    return (
      <View style={styles.memberCard}>
        {/* ── Card Header ── */}
        <View style={styles.cardHeader}>
          <View style={[styles.avatarCircle, isLowCredit && { backgroundColor: Theme.danger + '15' }]}>
            <Text style={[styles.avatarLetter, isLowCredit && { color: Theme.danger }]}>{item.Name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.memberName}>{item.Name}</Text>
            <View style={styles.phoneRow}>
              <Ionicons name="call-outline" size={12} color={Theme.textSecondary} />
              <Text style={styles.memberPhone}>{item.Phone}</Text>
            </View>
          </View>
          <View style={styles.cardActions}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => onSendWhatsApp(item)}
              style={[styles.actionBtn, { backgroundColor: "#25D366" + "15" }]}
            >
              <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => onViewUsage(item)}
              style={[styles.actionBtn, { backgroundColor: Theme.success + "15" }]}
            >
              <Ionicons name="stats-chart" size={18} color={Theme.success} />
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => onEdit(item)}
              style={[styles.actionBtn, { backgroundColor: Theme.primary + "15" }]}
            >
              <Ionicons name="create-outline" size={18} color={Theme.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => onDelete(item)}
              style={[styles.actionBtn, { backgroundColor: Theme.danger + "15" }]}
            >
              <Ionicons name="trash-outline" size={18} color={Theme.danger} />
            </TouchableOpacity>
          </View>
        </View>



        <View style={styles.cardDivider} />

        <View style={styles.contactDetailsRow}>
          <View style={styles.contactItem}>
            <Ionicons name="mail-outline" size={14} color={Theme.textSecondary} />
            <Text style={styles.contactText} numberOfLines={1}>{item.Email || "—"}</Text>
          </View>
          <View style={[styles.contactItem, { justifyContent: 'flex-end', flex: 0.6 }]}>
            <View style={[styles.badge, (item.IsActive === true || item.IsActive === 1) ? styles.badgeActive : styles.badgeInactive]}>
              <Text style={[styles.badgeText, (item.IsActive === true || item.IsActive === 1) ? styles.textActive : styles.textInactive]}>
                {(item.IsActive === true || item.IsActive === 1) ? "ACTIVE" : "INACTIVE"}
              </Text>
            </View>
          </View>
        </View>

        {item.Address ? (
          <View style={styles.addressRow}>
            <Ionicons name="location-outline" size={14} color={Theme.textSecondary} style={{ marginTop: 2 }} />
            <Text style={styles.addressText} numberOfLines={2}>{item.Address}</Text>
          </View>
        ) : null}

        {item.Promocode ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 15, marginTop: 6 }}>
            <Ionicons name="gift-outline" size={14} color={Theme.primary} />
            <Text style={{ fontSize: 13, fontFamily: Fonts.bold, color: Theme.textSecondary }}>
              Promo Code: <Text style={{ color: Theme.primary }}>{item.Promocode}</Text>
              {item.Promoamount ? ` (${formatMoney(item.Promoamount)})` : ''}
            </Text>
          </View>
        ) : null}

        {/* ── Low Credit Warning Badge ── */}
        {isLowCredit && (
          <View style={styles.lowCreditWarningBadge}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="alert-circle" size={16} color={Theme.danger} />
              <Text style={styles.lowCreditWarningTitle}>⚠ Low Credit Balance</Text>
            </View>
            <Text style={styles.lowCreditWarningStatus}>
              {alertSent ? "WhatsApp Alert Sent" : "Pending Alert"}
            </Text>
          </View>
        )}

        {/* ── Prepaid Balance Card ── */}
        <View style={styles.financialSummaryBlock}>
          <View style={styles.financialCol}>
            <Text style={styles.financialLabel}>PREPAID AMOUNT</Text>
            <Text style={[styles.financialVal, { color: Theme.success }]}>
              {formatMoney(creditLimit)}
            </Text>
          </View>
          <View style={[styles.financialCol, { borderLeftWidth: 1, borderRightWidth: 1, borderColor: Theme.border + '50' }]}>
            <Text style={styles.financialLabel}>CONSUMED</Text>
            <Text style={[styles.financialVal, { color: Theme.textPrimary }]}>
              {formatMoney(currentBalance)}
            </Text>
          </View>
          <View style={styles.financialCol}>
            <Text style={styles.financialLabel}>AVAILABLE BALANCE</Text>
            <Text style={[
              styles.financialVal,
              { color: isLowCredit ? Theme.danger : Theme.success }
            ]}>
              {formatMoney(availableCredit)}
            </Text>
          </View>
        </View>
      </View>
    );
  });

  const renderMember = useCallback(({ item }: { item: MemberType }) => {
    return (
      <MemberCard
        item={item}
        onEdit={openEditModal}
        onDelete={handleDeleteMember}
        onViewUsage={handleViewUsage}
        onCollectPayment={handleCollectPayment}
        onSendWhatsApp={handleSendWhatsApp}
        onRecharge={openRechargeModal}
        onSendLowBalanceReminder={handleSendLowBalanceReminder}
      />
    );
  }, [openEditModal, handleDeleteMember, handleViewUsage, handleCollectPayment, handleSendWhatsApp, openRechargeModal, handleSendLowBalanceReminder]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.headerBar}>
          <TouchableOpacity
            onPress={() => {
              router.replace("/(tabs)/category" as any);
            }}
            style={styles.circularBack}
          >
            <Ionicons name="chevron-back" size={24} color={Theme.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Member Management</Text>
          <TouchableOpacity onPress={openAddModal} style={styles.addBtn}>
            <Text style={styles.addBtnText}>+ Add Member</Text>
          </TouchableOpacity>
        </View>


        <View style={styles.searchWrapper}>
          <View style={styles.searchInner}>
            <Ionicons name="search" size={20} color={Theme.textMuted} />
            <TextInput
              placeholder="Search members..."
              placeholderTextColor={Theme.textMuted}
              style={styles.searchField}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={Theme.primary} /></View>
        ) : (
          <FlatList
            data={filteredMembers}
            keyExtractor={(item) => item.MemberId}
            renderItem={renderMember}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchMembers} tintColor={Theme.primary} />}
          />
        )}

        {/* Form Modal */}
        <Modal visible={modalMode !== "NONE"} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.formSheet}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{modalMode === "EDIT" ? "Edit Member" : "Add Member"}</Text>
                <TouchableOpacity onPress={() => setModalMode("NONE")} style={styles.sheetClose}>
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>NAME</Text>
                  <TextInput style={styles.sheetInput} value={formData.name} onChangeText={v => setFormData({ ...formData, name: v })} placeholder="Full Name" placeholderTextColor={Theme.textMuted} />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>PHONE</Text>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <TouchableOpacity
                      style={styles.countrySelector}
                      onPress={() => setShowCountryPicker(true)}
                    >
                      <Text style={styles.countrySelectorText}>
                        {selectedCountryCode}
                      </Text>
                      <Ionicons name="chevron-down" size={12} color={Theme.textSecondary} />
                    </TouchableOpacity>
                    <TextInput
                      style={[styles.sheetInput, { flex: 1 }]}
                      keyboardType="phone-pad"
                      value={localPhone}
                      onChangeText={v => setLocalPhone(v.replace(/[^0-9]/g, ""))}
                      placeholder="Contact Number"
                      placeholderTextColor={Theme.textMuted}
                    />
                  </View>
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>EMAIL</Text>
                  <TextInput style={styles.sheetInput} keyboardType="email-address" value={formData.email} onChangeText={v => setFormData({ ...formData, email: v })} placeholder="Email Address" placeholderTextColor={Theme.textMuted} />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>ADDRESS</Text>
                  <TextInput style={[styles.sheetInput, { height: 80, textAlignVertical: 'top', paddingTop: 12 }]} multiline value={formData.address} onChangeText={v => setFormData({ ...formData, address: v })} placeholder="Member Address" placeholderTextColor={Theme.textMuted} />
                </View>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>STATUS</Text>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity 
                      style={[styles.statusToggle, formData.isActive && styles.activeToggle]} 
                      onPress={() => setFormData({ ...formData, isActive: true })}
                    >
                      <Text style={[styles.statusText, formData.isActive && styles.activeStatusText]}>Active</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.statusToggle, !formData.isActive && styles.inactiveToggle]} 
                      onPress={() => setFormData({ ...formData, isActive: false })}
                    >
                      <Text style={[styles.statusText, !formData.isActive && styles.inactiveStatusText]}>Inactive</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.inputRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>PREPAID AMOUNT</Text>
                    <TextInput style={styles.sheetInput} keyboardType="numeric" value={formData.creditLimit} onChangeText={v => setFormData({ ...formData, creditLimit: v })} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>CONSUMED</Text>
                    <TextInput style={styles.sheetInput} keyboardType="numeric" value={formData.currentBalance} onChangeText={v => setFormData({ ...formData, currentBalance: v })} />
                  </View>
                </View>

                <View style={styles.inputRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>PROMO CODE</Text>
                    <TextInput style={styles.sheetInput} value={formData.promocode} onChangeText={v => setFormData({ ...formData, promocode: v })} placeholder="Promo Code" placeholderTextColor={Theme.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>PROMO AMOUNT</Text>
                    <TextInput style={styles.sheetInput} keyboardType="numeric" value={formData.promoamount} onChangeText={v => setFormData({ ...formData, promoamount: v })} placeholder="0.00" placeholderTextColor={Theme.textMuted} />
                  </View>
                </View>

                <TouchableOpacity style={styles.submitBtn} onPress={handleSaveMember} disabled={isSaving}>
                  {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>{modalMode === "EDIT" ? "Update Record" : "Add Member"}</Text>}
                </TouchableOpacity>
                <View style={{ height: 40 }} />
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Country Picker Modal */}
        <Modal
          visible={showCountryPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowCountryPicker(false)}
        >
          <TouchableOpacity 
            style={styles.pickerOverlay} 
            activeOpacity={1} 
            onPress={() => setShowCountryPicker(false)}
          >
            <View style={[styles.formSheet, { maxHeight: '60%', width: '80%' }]}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>Select Country Code</Text>
                <TouchableOpacity onPress={() => setShowCountryPicker(false)} style={styles.sheetClose}>
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>
              <ScrollView style={{ padding: 25 }} showsVerticalScrollIndicator={false}>
                {COUNTRIES.map((c) => (
                  <TouchableOpacity
                    key={c.code}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 14,
                      borderBottomWidth: 0.5,
                      borderBottomColor: Theme.border
                    }}
                    onPress={() => {
                      setSelectedCountryCode(c.code);
                      setShowCountryPicker(false);
                    }}
                  >
                    <Text style={{ fontSize: 15, fontFamily: Fonts.bold, color: Theme.textPrimary }}>
                      {c.label}  {c.name}
                    </Text>
                    {selectedCountryCode === c.code && (
                      <Ionicons name="checkmark" size={20} color={Theme.primary} />
                    )}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </TouchableOpacity>
        </Modal>

        {/* Delete Modal */}
        <Modal visible={showDeleteModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.alertCard}>
              <View style={styles.alertIconBg}>
                <Ionicons name="alert-circle" size={40} color={Theme.danger} />
              </View>
              <Text style={styles.alertTitle}>Delete Customer</Text>
              <Text style={styles.alertMessage}>
                Do you want to delete this customer?{"\n"}
                <Text style={{ color: Theme.primary, fontSize: 16, fontFamily: Fonts.black }}>{editingMember?.Name}</Text>
              </Text>
              
              <View style={styles.alertActions}>
                <TouchableOpacity 
                  style={[styles.alertBtn, styles.cancelBtn]} 
                  onPress={() => { setEditingMember(null); setShowDeleteModal(false); }}
                >
                  <Text style={styles.btnLabel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.alertBtn, styles.confirmDeleteBtn]} 
                  onPress={async () => {
                    const member = editingMember;
                    if (!member) return;
                    setIsSaving(true);
                    try {
                      const res = await fetch(`${API_URL}/api/members/delete`, {
                        method: "POST",
                        headers: { 
                          "Content-Type": "application/json",
                          Authorization: token ? `Bearer ${token}` : ""
                        },
                        body: JSON.stringify({ memberId: member.MemberId }),
                      });
                      const data = await res.json();
                      if (res.ok && data.success) {
                        setMembers(prev => prev.filter(m => m.MemberId !== member.MemberId));
                        setEditingMember(null);
                        setShowDeleteModal(false);
                      }
                    } catch (err) {
                      console.error(err);
                    } finally {
                      setIsSaving(false);
                    }
                  }}
                >
                  <Text style={[styles.btnLabel, { color: '#fff' }]}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
        {/* ── Recharge Modal ── */}
        <Modal visible={showRechargeModal} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={[styles.formSheet, { maxHeight: 'auto' as any }]}>
              <View style={styles.sheetHeader}>
                <View>
                  <Text style={styles.sheetTitle}>Recharge Balance</Text>
                  <Text style={{ fontFamily: Fonts.bold, color: Theme.textSecondary, fontSize: 13, marginTop: 4 }}>
                    {rechargeMember?.Name}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => { setShowRechargeModal(false); setRechargeMember(null); setRechargeAmount(''); }} style={styles.sheetClose}>
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>
              <View style={{ padding: 25 }}>
                {/* Current balance info */}
                {rechargeMember && (
                  <View style={{ flexDirection: 'row', gap: 12, marginBottom: 24 }}>
                    <View style={{ flex: 1, backgroundColor: Theme.bgInput, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Theme.border }}>
                      <Text style={{ fontSize: 9, fontFamily: Fonts.black, color: Theme.textMuted, marginBottom: 4 }}>CURRENT BALANCE</Text>
                      <Text style={{ fontSize: 20, fontFamily: Fonts.black, color: Theme.primary }}>
                        {formatMoney(rechargeMember.CurrentBalance || 0)}
                      </Text>
                    </View>
                    <View style={{ flex: 1, backgroundColor: Theme.bgInput, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Theme.border }}>
                      <Text style={{ fontSize: 9, fontFamily: Fonts.black, color: Theme.textMuted, marginBottom: 4 }}>TOTAL PREPAID</Text>
                      <Text style={{ fontSize: 20, fontFamily: Fonts.black, color: Theme.textPrimary }}>
                        {formatMoney(rechargeMember.Balance || 0)}
                      </Text>
                    </View>
                  </View>
                )}

                <Text style={styles.inputLabel}>RECHARGE AMOUNT (RM)</Text>
                <TextInput
                  style={[styles.sheetInput, { marginBottom: 20 }]}
                  keyboardType="numeric"
                  placeholder="Enter amount..."
                  placeholderTextColor={Theme.textMuted}
                  value={rechargeAmount}
                  onChangeText={setRechargeAmount}
                />

                {/* Quick amount buttons */}
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
                  {[50, 100, 200, 500].map(amt => (
                    <TouchableOpacity
                      key={amt}
                      style={{ flex: 1, height: 40, borderRadius: 10, backgroundColor: Theme.bgInput, borderWidth: 1, borderColor: Theme.border, justifyContent: 'center', alignItems: 'center' }}
                      onPress={() => setRechargeAmount(String(amt))}
                    >
                      <Text style={{ fontFamily: Fonts.bold, color: Theme.textPrimary, fontSize: 13 }}>RM {amt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity
                  style={[styles.submitBtn, { backgroundColor: '#F59E0B' }]}
                  onPress={handleRecharge}
                  disabled={isRecharging}
                >
                  {isRecharging
                    ? <ActivityIndicator color="#fff" />
                    : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Ionicons name="add-circle" size={20} color="#fff" />
                        <Text style={styles.submitBtnText}>Confirm Recharge</Text>
                      </View>
                    )
                  }
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Usage/Monthly History Modal */}
        <Modal visible={showUsageModal} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={[styles.formSheet, { maxHeight: '96%', height: isMobile ? '96%' : '92%', width: isMobile ? '96%' : '100%', maxWidth: 620, display: 'flex', flexDirection: 'column' }]}>
              {/* Compact Header */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: isMobile ? 12 : 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Theme.border }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: isMobile ? 15 : 16, fontFamily: Fonts.black, color: Theme.textPrimary }}>Order History & Details</Text>
                  <Text style={{ fontFamily: Fonts.bold, color: Theme.textSecondary, fontSize: 10.5, marginTop: 1 }}>
                    {usageMember?.Name} • {usageMember?.Phone}
                  </Text>
                </View>
                <TouchableOpacity onPress={closeUsageModal} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: Theme.bgMuted, justifyContent: 'center', alignItems: 'center' }}>
                  <Ionicons name="close" size={18} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>

              {loadingUsage ? (
                <View style={[styles.center, { padding: 40 }]}>
                  <ActivityIndicator size="large" color={Theme.primary} />
                </View>
              ) : (
                <>
                  {/* Compact Top Metric Cards */}
                  <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: isMobile ? 10 : 16, paddingTop: 6, paddingBottom: 6 }}>
                    <View style={{ flex: 1, backgroundColor: Theme.primary + '12', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 9, borderLeftWidth: 3, borderLeftColor: Theme.primary, justifyContent: 'center' }}>
                      <Text style={{ fontSize: 7.5, fontFamily: Fonts.black, color: Theme.primary, marginBottom: 1 }}>TOTAL BILLS</Text>
                      <Text numberOfLines={1} style={{ fontSize: isMobile ? 13 : 15, fontFamily: Fonts.black, color: Theme.textPrimary }}>
                        {usageData?.summary?.TotalOrders || usageData?.transactions?.length || 0}
                      </Text>
                    </View>
                    <View style={{ flex: 1.15, backgroundColor: Theme.success + '12', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 9, borderLeftWidth: 3, borderLeftColor: Theme.success, justifyContent: 'center' }}>
                      <Text style={{ fontSize: 7.5, fontFamily: Fonts.black, color: Theme.success, marginBottom: 1 }}>TOTAL SPENT</Text>
                      <Text numberOfLines={1} style={{ fontSize: isMobile ? 13 : 15, fontFamily: Fonts.black, color: Theme.textPrimary }}>
                        ${(usageData?.summary?.TotalSpent || 0).toFixed(2)}
                      </Text>
                    </View>
                    <View style={{ flex: 1.3, backgroundColor: '#8B5CF6' + '15', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 9, borderLeftWidth: 3, borderLeftColor: '#8B5CF6', justifyContent: 'center' }}>
                      <Text style={{ fontSize: 7.5, fontFamily: Fonts.black, color: '#8B5CF6', marginBottom: 1 }}>REWARD POINTS</Text>
                      <Text numberOfLines={1} style={{ fontSize: isMobile ? 12 : 14, fontFamily: Fonts.black, color: Theme.textPrimary }}>
                        🎁 {(usageData?.summary?.RewardCredit ?? usageMember?.RewardCredit ?? 0).toFixed(2)}
                        <Text style={{ fontSize: 9.5, fontFamily: Fonts.bold, color: '#8B5CF6' }}> pts</Text>
                      </Text>
                    </View>
                  </View>

                  {/* Compact Horizontal Segmented Tabs */}
                  <View style={{ borderBottomWidth: 1, borderBottomColor: Theme.border, backgroundColor: Theme.bgCard }}>
                    <ScrollView 
                      horizontal 
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ 
                        paddingHorizontal: isMobile ? 10 : 16, 
                        paddingVertical: 5, 
                        gap: 6,
                        flexDirection: 'row',
                        alignItems: 'center'
                      }}
                    >
                      <TouchableOpacity
                        onPress={() => setUsageTab("bills")}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 5,
                          paddingHorizontal: 11,
                          paddingVertical: 5,
                          borderRadius: 8,
                          backgroundColor: usageTab === "bills" ? Theme.primary : Theme.bgInput,
                        }}
                      >
                        <Text style={{ fontSize: 13 }}>📋</Text>
                        <Text style={{ fontFamily: Fonts.bold, fontSize: 11.5, color: usageTab === "bills" ? "#fff" : Theme.textSecondary, whiteSpace: 'nowrap' } as any}>
                          Bills ({usageData?.transactions?.length || 0})
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => setUsageTab("rewards")}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 5,
                          paddingHorizontal: 11,
                          paddingVertical: 5,
                          borderRadius: 8,
                          backgroundColor: usageTab === "rewards" ? "#8B5CF6" : Theme.bgInput,
                        }}
                      >
                        <Text style={{ fontSize: 13 }}>🎁</Text>
                        <Text style={{ fontFamily: Fonts.bold, fontSize: 11.5, color: usageTab === "rewards" ? "#fff" : Theme.textSecondary, whiteSpace: 'nowrap' } as any}>
                          Points History
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => setUsageTab("qr")}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 5,
                          paddingHorizontal: 11,
                          paddingVertical: 5,
                          borderRadius: 8,
                          backgroundColor: usageTab === "qr" ? Theme.primary : Theme.bgInput,
                        }}
                      >
                        <Text style={{ fontSize: 13 }}>📱</Text>
                        <Text style={{ fontFamily: Fonts.bold, fontSize: 11.5, color: usageTab === "qr" ? "#fff" : Theme.textSecondary, whiteSpace: 'nowrap' } as any}>
                          QR ({usageData?.qrOrders?.length || 0})
                        </Text>
                      </TouchableOpacity>
                    </ScrollView>
                  </View>

                  {/* Compact Search, Filter & Clear Bar */}
                  <View style={{ backgroundColor: Theme.bgCard, borderBottomWidth: 1, borderBottomColor: Theme.border, paddingHorizontal: isMobile ? 10 : 16, paddingVertical: 5 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {/* Compact Search Box */}
                      <View style={{
                        flex: 1,
                        height: 31,
                        backgroundColor: Theme.bgInput,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: Theme.border,
                        flexDirection: 'row',
                        alignItems: 'center',
                        paddingHorizontal: 8,
                      }}>
                        <Ionicons name="search" size={13} color={Theme.textSecondary} style={{ marginRight: 5 }} />
                        <TextInput
                          style={{
                            flex: 1,
                            height: '100%',
                            fontFamily: Fonts.medium,
                            fontSize: 11,
                            color: Theme.textPrimary,
                            ...Platform.select({ web: { outlineStyle: 'none' } as any }),
                          }}
                          placeholder={
                            usageTab === "bills" 
                              ? "Search bill #, table, pay mode..." 
                              : usageTab === "rewards" 
                                ? "Search bill #, remarks, points..." 
                                : "Search order #, table, status..."
                          }
                          placeholderTextColor={Theme.textMuted}
                          value={filterSearch}
                          onChangeText={setFilterSearch}
                        />
                        {filterSearch.length > 0 && (
                          <TouchableOpacity onPress={() => setFilterSearch("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                            <Ionicons name="close-circle" size={14} color={Theme.textMuted} />
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Compact Filter Toggle Button */}
                      <TouchableOpacity
                        onPress={() => setShowFilterPanel(prev => !prev)}
                        style={{
                          height: 31,
                          paddingHorizontal: 9,
                          borderRadius: 8,
                          backgroundColor: showFilterPanel ? Theme.primary : (currentTabActiveFilterCount > 0 ? Theme.primary + '18' : Theme.bgInput),
                          borderWidth: 1,
                          borderColor: (showFilterPanel || currentTabActiveFilterCount > 0) ? Theme.primary : Theme.border,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <Ionicons 
                          name="funnel" 
                          size={12} 
                          color={showFilterPanel ? "#fff" : (currentTabActiveFilterCount > 0 ? Theme.primary : Theme.textSecondary)} 
                        />
                        <Text style={{ 
                          fontFamily: Fonts.bold, 
                          fontSize: 11, 
                          color: showFilterPanel ? "#fff" : (currentTabActiveFilterCount > 0 ? Theme.primary : Theme.textSecondary) 
                        }}>
                          Filter
                        </Text>
                        {currentTabActiveFilterCount > 0 && (
                          <View style={{
                            backgroundColor: showFilterPanel ? "#fff" : Theme.primary,
                            minWidth: 16,
                            height: 16,
                            borderRadius: 8,
                            justifyContent: 'center',
                            alignItems: 'center',
                            paddingHorizontal: 3,
                          }}>
                            <Text style={{
                              fontSize: 9,
                              fontFamily: Fonts.black,
                              color: showFilterPanel ? Theme.primary : "#fff",
                            }}>
                              {currentTabActiveFilterCount}
                            </Text>
                          </View>
                        )}
                      </TouchableOpacity>

                      {/* Compact Clear Button */}
                      {isAnyFilterActive && (
                        <TouchableOpacity
                          onPress={resetModalFilters}
                          style={{
                            height: 31,
                            paddingHorizontal: 8,
                            borderRadius: 8,
                            backgroundColor: Theme.danger + '12',
                            borderWidth: 1,
                            borderColor: Theme.danger + '30',
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 3,
                          }}
                        >
                          <Ionicons name="refresh-outline" size={12} color={Theme.danger} />
                          <Text style={{ fontFamily: Fonts.bold, fontSize: 10.5, color: Theme.danger }}>Clear</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Active Filter Badges Bar */}
                    {isAnyFilterActive && !showFilterPanel && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                        <Text style={{ fontSize: 10, fontFamily: Fonts.black, color: Theme.textSecondary, textTransform: 'uppercase' }}>
                          Filtered:
                        </Text>
                        {filterSearch.trim().length > 0 && (
                          <TouchableOpacity
                            onPress={() => setFilterSearch("")}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Theme.primary + '15', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}
                          >
                            <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.primary }}>"{filterSearch}"</Text>
                            <Ionicons name="close" size={12} color={Theme.primary} />
                          </TouchableOpacity>
                        )}
                        {filterDatePreset !== "ALL" && (
                          <TouchableOpacity
                            onPress={() => { setFilterDatePreset("ALL"); setFilterStartDate(""); setFilterEndDate(""); }}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Theme.primary + '15', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}
                          >
                            <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.primary }}>
                              📅 {filterDatePreset === "TODAY" ? "Today" : filterDatePreset === "7DAYS" ? "Last 7 Days" : filterDatePreset === "30DAYS" ? "Last 30 Days" : `${filterStartDate || 'start'} to ${filterEndDate || 'end'}`}
                            </Text>
                            <Ionicons name="close" size={12} color={Theme.primary} />
                          </TouchableOpacity>
                        )}
                        {usageTab === "bills" && filterOrderType !== "ALL" && (
                          <TouchableOpacity
                            onPress={() => setFilterOrderType("ALL")}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Theme.primary + '15', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}
                          >
                            <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.primary }}>🍽️ {filterOrderType}</Text>
                            <Ionicons name="close" size={12} color={Theme.primary} />
                          </TouchableOpacity>
                        )}
                        {usageTab === "bills" && filterTableNo !== "ALL" && (
                          <TouchableOpacity
                            onPress={() => setFilterTableNo("ALL")}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Theme.primary + '15', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}
                          >
                            <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.primary }}>🪑 Table {filterTableNo}</Text>
                            <Ionicons name="close" size={12} color={Theme.primary} />
                          </TouchableOpacity>
                        )}
                        {usageTab === "bills" && filterPayMode !== "ALL" && (
                          <TouchableOpacity
                            onPress={() => setFilterPayMode("ALL")}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#3B82F618', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}
                          >
                            <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: '#2563EB' }}>💳 {filterPayMode}</Text>
                            <Ionicons name="close" size={12} color="#2563EB" />
                          </TouchableOpacity>
                        )}
                        {usageTab === "rewards" && filterPointsType !== "ALL" && (
                          <TouchableOpacity
                            onPress={() => setFilterPointsType("ALL")}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#8B5CF618', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}
                          >
                            <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: '#7C3AED' }}>
                              🎁 {filterPointsType === "EARNED" ? "Earned Only" : filterPointsType === "REDEEMED" ? "Redeemed Only" : "Opening Balance"}
                            </Text>
                            <Ionicons name="close" size={12} color="#7C3AED" />
                          </TouchableOpacity>
                        )}
                        {usageTab === "qr" && filterQRStatus !== "ALL" && (
                          <TouchableOpacity
                            onPress={() => setFilterQRStatus("ALL")}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#8B5CF618', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 }}
                          >
                            <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: '#7C3AED' }}>📱 {filterQRStatus}</Text>
                            <Ionicons name="close" size={12} color="#7C3AED" />
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </View>

                  {/* Expandable Filter Drawer Panel */}
                  {showFilterPanel && (
                    <View style={{
                      backgroundColor: '#F8FAFC',
                      borderBottomWidth: 1,
                      borderBottomColor: Theme.border,
                      paddingHorizontal: isMobile ? 12 : 20,
                      paddingVertical: 12,
                    }}>
                      <ScrollView style={{ maxHeight: 220 }} showsVerticalScrollIndicator={true} nestedScrollEnabled={true}>
                        {/* 1. Date Range Filter */}
                        <View style={{ marginBottom: 12 }}>
                          <Text style={{ fontSize: 10, fontFamily: Fonts.black, color: Theme.textSecondary, marginBottom: 6, letterSpacing: 0.5 }}>
                            📅 DATE RANGE
                          </Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                            {[
                              { id: "ALL", label: "All Time" },
                              { id: "TODAY", label: "Today" },
                              { id: "7DAYS", label: "Last 7 Days" },
                              { id: "30DAYS", label: "Last 30 Days" },
                              { id: "CUSTOM", label: "Custom" },
                            ].map((preset) => {
                              const isSelected = filterDatePreset === preset.id;
                              return (
                                <TouchableOpacity
                                  key={preset.id}
                                  onPress={() => setFilterDatePreset(preset.id as any)}
                                  style={{
                                    paddingHorizontal: 10,
                                    paddingVertical: 5,
                                    borderRadius: 8,
                                    backgroundColor: isSelected ? Theme.primary : Theme.bgInput,
                                    borderWidth: 1,
                                    borderColor: isSelected ? Theme.primary : Theme.border,
                                  }}
                                >
                                  <Text style={{
                                    fontSize: 11,
                                    fontFamily: Fonts.bold,
                                    color: isSelected ? "#fff" : Theme.textPrimary,
                                  }}>
                                    {preset.label}
                                  </Text>
                                </TouchableOpacity>
                              );
                            })}
                          </ScrollView>

                          {filterDatePreset === "CUSTOM" && (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 9, fontFamily: Fonts.bold, color: Theme.textMuted, marginBottom: 2 }}>From Date</Text>
                                <TextInput
                                  style={{
                                    height: 34,
                                    backgroundColor: Theme.bgInput,
                                    borderRadius: 8,
                                    paddingHorizontal: 8,
                                    fontSize: 12,
                                    fontFamily: Fonts.bold,
                                    color: Theme.textPrimary,
                                    borderWidth: 1,
                                    borderColor: Theme.border,
                                    ...Platform.select({ web: { outlineStyle: 'none' } as any }),
                                  }}
                                  placeholder="YYYY-MM-DD"
                                  placeholderTextColor={Theme.textMuted}
                                  value={filterStartDate}
                                  onChangeText={setFilterStartDate}
                                />
                              </View>
                              <Text style={{ fontSize: 12, fontFamily: Fonts.bold, color: Theme.textMuted, marginTop: 14 }}>to</Text>
                              <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 9, fontFamily: Fonts.bold, color: Theme.textMuted, marginBottom: 2 }}>To Date</Text>
                                <TextInput
                                  style={{
                                    height: 34,
                                    backgroundColor: Theme.bgInput,
                                    borderRadius: 8,
                                    paddingHorizontal: 8,
                                    fontSize: 12,
                                    fontFamily: Fonts.bold,
                                    color: Theme.textPrimary,
                                    borderWidth: 1,
                                    borderColor: Theme.border,
                                    ...Platform.select({ web: { outlineStyle: 'none' } as any }),
                                  }}
                                  placeholder="YYYY-MM-DD"
                                  placeholderTextColor={Theme.textMuted}
                                  value={filterEndDate}
                                  onChangeText={setFilterEndDate}
                                />
                              </View>
                            </View>
                          )}
                        </View>

                        {/* 2. Bills Tab Specific Filters */}
                        {usageTab === "bills" && (
                          <>
                            {/* Order Type */}
                            <View style={{ marginBottom: 10 }}>
                              <Text style={{ fontSize: 10, fontFamily: Fonts.black, color: Theme.textSecondary, marginBottom: 6, letterSpacing: 0.5 }}>
                                🍽️ ORDER TYPE
                              </Text>
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                                {["ALL", ...availableOrderTypes].map((type) => {
                                  const isSelected = filterOrderType === type;
                                  return (
                                    <TouchableOpacity
                                      key={type}
                                      onPress={() => setFilterOrderType(type)}
                                      style={{
                                        paddingHorizontal: 10,
                                        paddingVertical: 5,
                                        borderRadius: 8,
                                        backgroundColor: isSelected ? Theme.primary : Theme.bgInput,
                                        borderWidth: 1,
                                        borderColor: isSelected ? Theme.primary : Theme.border,
                                      }}
                                    >
                                      <Text style={{
                                        fontSize: 11,
                                        fontFamily: Fonts.bold,
                                        color: isSelected ? "#fff" : Theme.textPrimary,
                                      }}>
                                        {type === "ALL" ? "All Types" : type}
                                      </Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </ScrollView>
                            </View>

                            {/* Table Number */}
                            {availableTables.length > 0 && (
                              <View style={{ marginBottom: 10 }}>
                                <Text style={{ fontSize: 10, fontFamily: Fonts.black, color: Theme.textSecondary, marginBottom: 6, letterSpacing: 0.5 }}>
                                  🪑 TABLE NUMBER
                                </Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                                  {["ALL", ...availableTables].map((tbl) => {
                                    const isSelected = filterTableNo === tbl;
                                    return (
                                      <TouchableOpacity
                                        key={tbl}
                                        onPress={() => setFilterTableNo(tbl)}
                                        style={{
                                          paddingHorizontal: 10,
                                          paddingVertical: 5,
                                          borderRadius: 8,
                                          backgroundColor: isSelected ? Theme.primary : Theme.bgInput,
                                          borderWidth: 1,
                                          borderColor: isSelected ? Theme.primary : Theme.border,
                                        }}
                                      >
                                        <Text style={{
                                          fontSize: 11,
                                          fontFamily: Fonts.bold,
                                          color: isSelected ? "#fff" : Theme.textPrimary,
                                        }}>
                                          {tbl === "ALL" ? "All Tables" : `Table ${tbl}`}
                                        </Text>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </ScrollView>
                              </View>
                            )}

                            {/* Payment Mode */}
                            {availablePayModes.length > 0 && (
                              <View style={{ marginBottom: 10 }}>
                                <Text style={{ fontSize: 10, fontFamily: Fonts.black, color: Theme.textSecondary, marginBottom: 6, letterSpacing: 0.5 }}>
                                  💳 PAYMENT MODE
                                </Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                                  {["ALL", ...availablePayModes].map((pm) => {
                                    const isSelected = filterPayMode === pm;
                                    return (
                                      <TouchableOpacity
                                        key={pm}
                                        onPress={() => setFilterPayMode(pm)}
                                        style={{
                                          paddingHorizontal: 10,
                                          paddingVertical: 5,
                                          borderRadius: 8,
                                          backgroundColor: isSelected ? '#2563EB' : Theme.bgInput,
                                          borderWidth: 1,
                                          borderColor: isSelected ? '#2563EB' : Theme.border,
                                        }}
                                      >
                                        <Text style={{
                                          fontSize: 11,
                                          fontFamily: Fonts.bold,
                                          color: isSelected ? "#fff" : Theme.textPrimary,
                                        }}>
                                          {pm === "ALL" ? "All Modes" : pm}
                                        </Text>
                                      </TouchableOpacity>
                                    );
                                  })}
                                </ScrollView>
                              </View>
                            )}
                          </>
                        )}

                        {/* 3. Points History Specific Filters */}
                        {usageTab === "rewards" && (
                          <View style={{ marginBottom: 10 }}>
                            <Text style={{ fontSize: 10, fontFamily: Fonts.black, color: Theme.textSecondary, marginBottom: 6, letterSpacing: 0.5 }}>
                              🎁 POINTS ACTIVITY & TRANSACTION TYPE
                            </Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                              {[
                                { id: "ALL", label: "All Activities" },
                                { id: "EARNED", label: "Points Earned (+1%)" },
                                { id: "REDEEMED", label: "Points Redeemed" },
                                { id: "OPENING", label: "Opening Balance" },
                              ].map((item) => {
                                const isSelected = filterPointsType === item.id;
                                return (
                                  <TouchableOpacity
                                    key={item.id}
                                    onPress={() => setFilterPointsType(item.id as any)}
                                    style={{
                                      paddingHorizontal: 10,
                                      paddingVertical: 5,
                                      borderRadius: 8,
                                      backgroundColor: isSelected ? '#8B5CF6' : Theme.bgInput,
                                      borderWidth: 1,
                                      borderColor: isSelected ? '#8B5CF6' : Theme.border,
                                    }}
                                  >
                                    <Text style={{
                                      fontSize: 11,
                                      fontFamily: Fonts.bold,
                                      color: isSelected ? "#fff" : Theme.textPrimary,
                                    }}>
                                      {item.label}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </ScrollView>
                          </View>
                        )}

                        {/* 4. QR Specific Filters */}
                        {usageTab === "qr" && (
                          <View style={{ marginBottom: 10 }}>
                            <Text style={{ fontSize: 10, fontFamily: Fonts.black, color: Theme.textSecondary, marginBottom: 6, letterSpacing: 0.5 }}>
                              📱 QR ORDER STATUS
                            </Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                              {["ALL", ...availableQRStatuses].map((status) => {
                                const isSelected = filterQRStatus === status;
                                return (
                                  <TouchableOpacity
                                    key={status}
                                    onPress={() => setFilterQRStatus(status)}
                                    style={{
                                      paddingHorizontal: 10,
                                      paddingVertical: 5,
                                      borderRadius: 8,
                                      backgroundColor: isSelected ? Theme.primary : Theme.bgInput,
                                      borderWidth: 1,
                                      borderColor: isSelected ? Theme.primary : Theme.border,
                                    }}
                                  >
                                    <Text style={{
                                      fontSize: 11,
                                      fontFamily: Fonts.bold,
                                      color: isSelected ? "#fff" : Theme.textPrimary,
                                    }}>
                                      {status === "ALL" ? "All Status" : status}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </ScrollView>
                          </View>
                        )}
                      </ScrollView>

                      {/* Filter Footer Buttons: Reset All and Apply / Close */}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: Theme.border }}>
                        <TouchableOpacity
                          onPress={resetModalFilters}
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 6 }}
                        >
                          <Ionicons name="refresh-outline" size={13} color={Theme.textSecondary} />
                          <Text style={{ fontSize: 12, fontFamily: Fonts.bold, color: Theme.textSecondary }}>Reset All</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() => setShowFilterPanel(false)}
                          style={{
                            backgroundColor: Theme.primary,
                            paddingHorizontal: 14,
                            paddingVertical: 6,
                            borderRadius: 8,
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          <Ionicons name="checkmark" size={14} color="#fff" />
                          <Text style={{ fontSize: 12, fontFamily: Fonts.black, color: "#fff" }}>Apply & Close</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ padding: isMobile ? 8 : 12, paddingBottom: 10 }}
                    showsVerticalScrollIndicator={true}
                  >
                    {/* ── TAB 1: ALL BILLS ─────────────────────────────────────── */}
                    {usageTab === "bills" && (
                      <View>
                        <Text style={{ fontFamily: Fonts.black, fontSize: 11, color: Theme.textSecondary, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                          Settled Bills & Receipts ({filteredBills.length}{isAnyFilterActive ? ` of ${usageData?.transactions?.length || 0}` : ''})
                        </Text>
                        {filteredBills.length > 0 ? (
                          <View style={{ gap: 5 }}>
                            {filteredBills.map((tx: any) => (
                              <TouchableOpacity 
                                key={tx.SettlementID} 
                                activeOpacity={0.7}
                                onPress={() => handleBillPress(tx)}
                                style={{
                                  backgroundColor: Theme.bgInput,
                                  paddingHorizontal: 10,
                                  paddingVertical: 6,
                                  borderRadius: 8,
                                  borderWidth: 1,
                                  borderColor: Theme.border,
                                }}
                              >
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <View style={{ flex: 1, marginRight: 8 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                                      <Text style={{ fontFamily: Fonts.black, fontSize: 12.5, color: Theme.textPrimary }}>Bill #{tx.BillNo}</Text>
                                      {tx.isQROrder === 1 && (
                                        <View style={{ backgroundColor: '#8B5CF6' + '20', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 5 }}>
                                          <Text style={{ fontSize: 8.5, fontFamily: Fonts.bold, color: '#7C3AED' }}>📱 QR</Text>
                                        </View>
                                      )}
                                      {tx.TableNo && (
                                        <View style={{ backgroundColor: Theme.primary + '15', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 5 }}>
                                          <Text style={{ fontSize: 8.5, fontFamily: Fonts.bold, color: Theme.primary }}>T-{tx.TableNo}</Text>
                                        </View>
                                      )}
                                      <View style={{ backgroundColor: Theme.border, paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 5 }}>
                                        <Text style={{ fontSize: 8.5, fontFamily: Fonts.bold, color: Theme.textSecondary }}>{tx.OrderType || 'DINE-IN'}</Text>
                                      </View>
                                      {tx.PayMode && (
                                        <View style={{ backgroundColor: '#3B82F618', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 5 }}>
                                          <Text style={{ fontSize: 8.5, fontFamily: Fonts.bold, color: '#2563EB' }}>💳 {tx.PayMode}</Text>
                                        </View>
                                      )}
                                    </View>
                                    <Text style={{ fontFamily: Fonts.medium, fontSize: 9.5, color: Theme.textMuted, marginTop: 2 }}>
                                      {formatToSingaporeDate(tx.LastSettlementDate)} • {formatToSingaporeTime(tx.LastSettlementDate)}
                                    </Text>
                                  </View>

                                  <View style={{ alignItems: 'flex-end' }}>
                                    <Text style={{ fontFamily: Fonts.black, fontSize: 14, color: Theme.textPrimary }}>
                                      ${(tx.SysAmount || 0).toFixed(2)}
                                    </Text>
                                  </View>
                                </View>
                              </TouchableOpacity>
                            ))}
                          </View>
                        ) : (
                          isAnyFilterActive ? (
                            renderFilterEmptyState("No Matching Bills", "No settled bills match your active filters or search.")
                          ) : (
                            <Text style={{ fontFamily: Fonts.medium, fontSize: 12, color: Theme.textMuted, fontStyle: 'italic', textAlign: 'center', marginVertical: 14 }}>
                              No settled bills found for this member.
                            </Text>
                          )
                        )}
                      </View>
                    )}

                    {/* ── TAB 2: REWARD POINTS & WALLET ────────────────────────── */}
                    {usageTab === "rewards" && (
                      <View>
                        {/* Compact Reward Wallet Card */}
                        <View style={{ backgroundColor: '#FAF5FF', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#E9D5FF', marginBottom: 10 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <View>
                              <Text style={{ fontSize: 9.5, fontFamily: Fonts.black, color: '#7C3AED', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                                REWARD POINTS WALLET
                              </Text>
                              <Text style={{ fontSize: 20, fontFamily: Fonts.black, color: '#6D28D9', marginTop: 2 }}>
                                ${(usageData?.summary?.RewardCredit ?? usageMember?.RewardCredit ?? 0).toFixed(2)}
                                <Text style={{ fontSize: 11, fontFamily: Fonts.bold, color: '#8B5CF6' }}> pts</Text>
                              </Text>
                            </View>
                            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#DDD6FE', alignItems: 'center', justifyContent: 'center' }}>
                              <Ionicons name="gift" size={18} color="#7C3AED" />
                            </View>
                          </View>

                          {/* Breakdown of balance */}
                          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, backgroundColor: '#fff', borderRadius: 8, padding: 6, borderWidth: 1, borderColor: '#F3E8FF' }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 8, fontFamily: Fonts.black, color: '#6B7280', textTransform: 'uppercase' }}>
                                OPENING BALANCE
                              </Text>
                              <Text style={{ fontSize: 11, fontFamily: Fonts.black, color: '#4B5563', marginTop: 1 }}>
                                ${(usageData?.summary?.OpeningPoints ?? 97.59).toFixed(2)} pts
                              </Text>
                            </View>

                            <View style={{ width: 1, backgroundColor: '#E9D5FF' }} />

                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 8, fontFamily: Fonts.black, color: Theme.success, textTransform: 'uppercase' }}>
                                EARNED FROM ORDERS
                              </Text>
                              <Text style={{ fontSize: 11, fontFamily: Fonts.black, color: Theme.success, marginTop: 1 }}>
                                +${(usageData?.summary?.EarnedFromBills ?? 8.04).toFixed(2)} pts
                              </Text>
                            </View>
                          </View>

                          <View style={{ height: 1, backgroundColor: '#E9D5FF', marginVertical: 6 }} />

                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Text style={{ fontSize: 9.5, fontFamily: Fonts.medium, color: '#6B7280' }}>
                              Cashback Rule: 1% points on every $1 spent ($100 = $1 pt)
                            </Text>
                            <Text style={{ fontSize: 9.5, fontFamily: Fonts.bold, color: '#059669' }}>
                              Active
                            </Text>
                          </View>
                        </View>

                        {/* Points Activity History Header */}
                        <Text style={{ fontFamily: Fonts.black, fontSize: 11, color: Theme.textSecondary, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                          Reward Points Order History ({filteredRewards.length}{isAnyFilterActive ? ` of ${usageData?.rewardHistory?.length || 0}` : ''})
                        </Text>

                        {filteredRewards.length > 0 ? (
                          <View style={{ gap: 5 }}>
                            {filteredRewards.map((item: any, idx: number) => {
                              const isOpening = item.Type === 'OPENING' || item.BillNo === 'OPENING-BALANCE' || item.BillNo === 'WALLET';
                              return (
                                <TouchableOpacity 
                                  key={idx}
                                  activeOpacity={isOpening ? 1 : 0.7}
                                  onPress={() => {
                                    if (!isOpening && item.SettlementID) {
                                      handleBillPress({
                                        SettlementID: item.SettlementID,
                                        BillNo: item.BillNo,
                                        LastSettlementDate: item.Date,
                                        SysAmount: item.Amount,
                                        TableNo: item.TableNo,
                                        OrderType: item.OrderType || 'DINE-IN',
                                        isQROrder: item.isQROrder || 0
                                      });
                                    }
                                  }}
                                  style={{
                                    backgroundColor: Theme.bgInput,
                                    paddingHorizontal: 10,
                                    paddingVertical: 6,
                                    borderRadius: 8,
                                    borderWidth: 1,
                                    borderColor: isOpening ? '#E9D5FF' : Theme.border,
                                  }}
                                >
                                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <View style={{ flex: 1, paddingRight: 8 }}>
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                                        <Text style={{ fontFamily: Fonts.bold, fontSize: 12, color: Theme.textPrimary }}>
                                          {isOpening ? 'Member Registration' : `Bill #${item.BillNo}`}
                                        </Text>
                                        <View style={{ backgroundColor: isOpening ? '#8B5CF620' : Theme.success + '20', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 5 }}>
                                          <Text style={{ fontSize: 8.5, fontFamily: Fonts.bold, color: isOpening ? '#7C3AED' : Theme.success }}>
                                            {isOpening ? 'INITIAL' : '+1% CASHBACK'}
                                          </Text>
                                        </View>
                                        {item.isQROrder === 1 && (
                                          <View style={{ backgroundColor: '#8B5CF620', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 5 }}>
                                            <Text style={{ fontSize: 8.5, fontFamily: Fonts.bold, color: '#7C3AED' }}>📱 QR</Text>
                                          </View>
                                        )}
                                        {item.TableNo && (
                                          <View style={{ backgroundColor: Theme.primary + '15', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 5 }}>
                                            <Text style={{ fontSize: 8.5, fontFamily: Fonts.bold, color: Theme.primary }}>T-{item.TableNo}</Text>
                                          </View>
                                        )}
                                      </View>

                                      <Text style={{ fontFamily: Fonts.medium, fontSize: 9.5, color: Theme.textMuted, marginTop: 1 }}>
                                        {isOpening 
                                          ? 'Initial points on signup'
                                          : `Spent $${(Number(item.Amount) || 0).toFixed(2)} • 1% pts`
                                        }
                                        {' • '}{formatToSingaporeDate(item.Date)} {formatToSingaporeTime(item.Date)}
                                      </Text>
                                    </View>

                                    <View style={{ alignItems: 'flex-end' }}>
                                      <Text style={{ fontFamily: Fonts.black, fontSize: 13.5, color: isOpening ? '#7C3AED' : Theme.success }}>
                                        +{Number(item.Points || 0).toFixed(2)}
                                      </Text>
                                      <Text style={{ fontSize: 8.5, fontFamily: Fonts.bold, color: Theme.textMuted }}>pts</Text>
                                    </View>
                                  </View>
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                        ) : (
                          isAnyFilterActive ? (
                            renderFilterEmptyState("No Matching Points Records", "No points transactions match your active filters or search.")
                          ) : (
                            <Text style={{ fontFamily: Fonts.medium, fontSize: 12, color: Theme.textMuted, fontStyle: 'italic', textAlign: 'center', marginVertical: 14 }}>
                              No reward points history found.
                            </Text>
                          )
                        )}
                      </View>
                    )}

                    {/* ── TAB 3: QR ORDERS ─────────────────────────────────────── */}
                    {usageTab === "qr" && (
                      <View>
                        <Text style={{ fontFamily: Fonts.black, fontSize: 11, color: Theme.textSecondary, marginBottom: 6, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                          Orders Placed via Mobile QR Code ({filteredQROrders.length}{isAnyFilterActive ? ` of ${usageData?.qrOrders?.length || 0}` : ''})
                        </Text>

                        {filteredQROrders.length > 0 ? (
                          <View style={{ gap: 5 }}>
                            {filteredQROrders.map((qr: any, idx: number) => (
                              <TouchableOpacity
                                key={idx}
                                activeOpacity={0.7}
                                onPress={() => {
                                  if (qr.SettlementID) {
                                    handleBillPress({
                                      SettlementID: qr.SettlementID,
                                      BillNo: qr.OrderNumber,
                                      LastSettlementDate: qr.OrderDateTime,
                                      SysAmount: Number(qr.TotalAmount || qr.SettledAmount || 0),
                                      TableNo: qr.TableNo,
                                      OrderType: 'DINE-IN',
                                      isQROrder: 1
                                    });
                                  }
                                }}
                                style={{
                                  backgroundColor: Theme.bgInput,
                                  paddingHorizontal: 10,
                                  paddingVertical: 6,
                                  borderRadius: 8,
                                  borderWidth: 1,
                                  borderColor: Theme.border,
                                }}
                              >
                                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <View style={{ flex: 1, marginRight: 8 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                                      <Text style={{ fontFamily: Fonts.black, fontSize: 12.5, color: Theme.textPrimary }}>
                                        Order #{qr.OrderNumber}
                                      </Text>
                                      <View style={{ backgroundColor: '#8B5CF6' + '20', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 5 }}>
                                        <Text style={{ fontSize: 8.5, fontFamily: Fonts.bold, color: '#7C3AED' }}>📱 QR</Text>
                                      </View>
                                      {qr.TableNo && (
                                        <View style={{ backgroundColor: Theme.primary + '15', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 5 }}>
                                          <Text style={{ fontSize: 8.5, fontFamily: Fonts.bold, color: Theme.primary }}>T-{qr.TableNo}</Text>
                                        </View>
                                      )}
                                      <View style={{ backgroundColor: qr.BillStatus === 'SETTLED' ? Theme.success + '15' : Theme.warning + '15', paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 5 }}>
                                        <Text style={{ fontSize: 8.5, fontFamily: Fonts.bold, color: qr.BillStatus === 'SETTLED' ? Theme.success : Theme.warning }}>
                                          {qr.BillStatus || 'SETTLED'}
                                        </Text>
                                      </View>
                                    </View>

                                    <Text style={{ fontFamily: Fonts.medium, fontSize: 9.5, color: Theme.textMuted, marginTop: 2 }}>
                                      {formatToSingaporeDate(qr.OrderDateTime)} • {formatToSingaporeTime(qr.OrderDateTime)}
                                    </Text>
                                  </View>

                                  <View style={{ alignItems: 'flex-end' }}>
                                    <Text style={{ fontFamily: Fonts.black, fontSize: 14, color: Theme.textPrimary }}>
                                      ${(qr.TotalAmount || qr.SettledAmount || 0).toFixed(2)}
                                    </Text>
                                    {qr.SettlementID && (
                                      <Text style={{ fontSize: 9.5, fontFamily: Fonts.bold, color: Theme.primary, marginTop: 2 }}>
                                        View Receipt →
                                      </Text>
                                    )}
                                  </View>
                                </View>
                              </TouchableOpacity>
                            ))}
                          </View>
                        ) : (
                          isAnyFilterActive ? (
                            renderFilterEmptyState("No Matching QR Orders", "No mobile QR orders match your active filters or search.")
                          ) : (
                            <View style={{ backgroundColor: Theme.bgInput, borderRadius: 10, padding: 18, alignItems: 'center', justifyContent: 'center' }}>
                              <Ionicons name="qr-code-outline" size={32} color={Theme.textMuted} />
                              <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: Theme.textPrimary, marginTop: 8 }}>
                                No QR Orders Found
                              </Text>
                              <Text style={{ fontFamily: Fonts.medium, fontSize: 11, color: Theme.textMuted, textAlign: 'center', marginTop: 3 }}>
                                Orders placed through the Table or Takeaway QR code will appear here.
                              </Text>
                            </View>
                          )
                        )}
                      </View>
                    )}
                  </ScrollView>

                  {/* Fixed Footer with Done button */}
                  <View style={{ paddingHorizontal: isMobile ? 12 : 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: Theme.border, backgroundColor: Theme.bgCard, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 }}>
                    <TouchableOpacity style={[styles.submitBtn, { marginTop: 0, height: 38, borderRadius: 10 }]} onPress={closeUsageModal}>
                      <Text style={[styles.submitBtnText, { fontSize: 13.5 }]}>Done</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* Bill Details Modal */}
        <Modal visible={showBillDetailsModal} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={[styles.formSheet, { maxWidth: 460, maxHeight: '88%', height: '88%', display: 'flex', flexDirection: 'column' }]}>
              {/* Sheet Header */}
              <View style={styles.sheetHeader}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={styles.sheetTitle}>Bill Receipt & Details</Text>
                  {selectedBill && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                      <Text style={{ fontFamily: Fonts.black, color: Theme.primary, fontSize: 13 }}>
                        Bill #{selectedBill.BillNo}
                      </Text>
                      {selectedBill.isQROrder === 1 && (
                        <View style={{ backgroundColor: '#8B5CF620', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 }}>
                          <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: '#7C3AED' }}>📱 QR Order</Text>
                        </View>
                      )}
                      {selectedBill.TableNo ? (
                        <View style={{ backgroundColor: Theme.primary + '15', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 }}>
                          <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.primary }}>Table {selectedBill.TableNo}</Text>
                        </View>
                      ) : null}
                      <View style={{ backgroundColor: Theme.border, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 }}>
                        <Text style={{ fontSize: 9, fontFamily: Fonts.bold, color: Theme.textSecondary }}>{selectedBill.OrderType || 'DINE-IN'}</Text>
                      </View>
                    </View>
                  )}
                </View>
                <TouchableOpacity onPress={() => { setShowBillDetailsModal(false); setSelectedBill(null); setBillDetails([]); }} style={styles.sheetClose}>
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>

              {loadingBillDetails ? (
                <View style={[styles.center, { padding: 40 }]}>
                  <ActivityIndicator size="large" color={Theme.primary} />
                </View>
              ) : (
                (() => {
                  const itemSum = (billDetails || []).reduce((sum, it) => sum + ((Number(it.Price) || 0) * (Number(it.Qty) || 1)), 0);
                  const billTotal = Number(selectedBill?.SysAmount || 0) > 0 ? Number(selectedBill.SysAmount) : itemSum;
                  const dateRaw = selectedBill?.LastSettlementDate || selectedBill?.OrderDateTime;
                  const sDate = dateRaw ? formatToSingaporeDate(dateRaw, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
                  const sTime = dateRaw ? formatToSingaporeTime(dateRaw) : '';
                  const fullDateTime = (sDate && sTime) ? `${sDate} • ${sTime}` : (sDate || sTime || 'Settled Bill');

                  return (
                    <>
                      {/* Meta Information Bar */}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, backgroundColor: Theme.bgInput, borderBottomWidth: 1, borderBottomColor: Theme.border }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Ionicons name="calendar-outline" size={14} color={Theme.textMuted} />
                          <Text style={{ fontFamily: Fonts.bold, fontSize: 12, color: Theme.textPrimary }}>
                            {fullDateTime}
                          </Text>
                        </View>
                        <Text style={{ fontFamily: Fonts.bold, fontSize: 11, color: Theme.textMuted }}>
                          {billDetails.length} {billDetails.length === 1 ? 'item' : 'items'}
                        </Text>
                      </View>

                      {/* Scrollable Item List */}
                      <ScrollView
                        style={{ flex: 1 }}
                        contentContainerStyle={{ padding: 20, paddingBottom: 15 }}
                        showsVerticalScrollIndicator={true}
                      >
                        <Text style={{ fontFamily: Fonts.black, fontSize: 12, color: Theme.textSecondary, marginBottom: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                          Items Ordered
                        </Text>

                        {billDetails && billDetails.length > 0 ? (
                          <View style={{ backgroundColor: Theme.bgCard, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: Theme.border }}>
                            {billDetails.map((item, idx) => {
                              const lineTotal = (Number(item.Price) || 0) * (Number(item.Qty) || 1);
                              return (
                                <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 10, borderBottomWidth: idx < billDetails.length - 1 ? 1 : 0, borderBottomColor: Theme.border }}>
                                  <View style={{ flex: 1, paddingRight: 10 }}>
                                    <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: Theme.textPrimary }}>
                                      {item.DishName}
                                    </Text>
                                    {item.modifiers && item.modifiers.length > 0 && (
                                      <Text style={{ fontFamily: Fonts.medium, fontSize: 11, color: Theme.textMuted, marginTop: 2 }}>
                                        + {item.modifiers.map((m: any) => m.ModifierName).join(", ")}
                                      </Text>
                                    )}
                                    <Text style={{ fontFamily: Fonts.medium, fontSize: 11, color: Theme.textMuted, marginTop: 2 }}>
                                      Qty: <Text style={{ fontFamily: Fonts.bold, color: Theme.textPrimary }}>{item.Qty}</Text> × {formatMoney(item.Price)}
                                    </Text>
                                  </View>
                                  <Text style={{ fontFamily: Fonts.black, fontSize: 14, color: Theme.textPrimary }}>
                                    {formatMoney(lineTotal)}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        ) : (
                          <View style={{ backgroundColor: Theme.bgInput, borderRadius: 14, padding: 20, alignItems: 'center' }}>
                            <Text style={{ fontFamily: Fonts.medium, fontSize: 13, color: Theme.textMuted, fontStyle: 'italic' }}>
                              No items recorded for this settlement.
                            </Text>
                          </View>
                        )}
                      </ScrollView>

                      {/* Fixed Sticky Footer with Total Amount & Close Button */}
                      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, borderTopWidth: 1, borderTopColor: Theme.border, backgroundColor: Theme.bgCard, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Theme.primary + '12', padding: 14, borderRadius: 14, borderLeftWidth: 4, borderLeftColor: Theme.primary, marginBottom: 12 }}>
                          <View>
                            <Text style={{ fontFamily: Fonts.black, fontSize: 10, color: Theme.primary, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                              TOTAL AMOUNT
                            </Text>
                            <Text style={{ fontFamily: Fonts.medium, fontSize: 11, color: Theme.textSecondary, marginTop: 2 }}>
                              Settled / Paid
                            </Text>
                          </View>
                          <Text style={{ fontFamily: Fonts.black, fontSize: 20, color: Theme.textPrimary }}>
                            {formatMoney(billTotal)}
                          </Text>
                        </View>

                        <TouchableOpacity 
                          style={[styles.submitBtn, { marginTop: 0, height: 46 }]} 
                          onPress={() => { setShowBillDetailsModal(false); setSelectedBill(null); setBillDetails([]); }}
                        >
                          <Text style={styles.submitBtnText}>Close</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  );
                })()
              )}
            </View>
          </View>
        </Modal>


      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  kpiContainer: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 20, gap: 12, marginBottom: 15 },
  kpiCard: { flex: 1, minWidth: 150, padding: 15, borderRadius: 16, borderWidth: 1, ...Theme.shadowSm },
  kpiLabel: { fontSize: 9, fontFamily: Fonts.black, letterSpacing: 0.5 },
  kpiVal: { fontSize: 18, fontFamily: Fonts.black, marginTop: 4 },
  container: { flex: 1, backgroundColor: Theme.bgMain },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 20, gap: 15 },
  circularBack: { width: 44, height: 44, borderRadius: 12, backgroundColor: Theme.bgCard, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: Theme.border },
  screenTitle: { flex: 1, color: Theme.textPrimary, fontSize: 20, fontFamily: Fonts.black },
  addBtn: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: Theme.primary, borderRadius: 12, ...Theme.shadowSm },
  addBtnText: { color: "#fff", fontFamily: Fonts.bold, fontSize: 13 },
  searchWrapper: { marginHorizontal: 20, marginBottom: 20 },
  searchInner: { 
    flexDirection: "row", alignItems: "center", paddingHorizontal: 16, height: 56, 
    borderRadius: 16, backgroundColor: Theme.bgCard, borderWidth: 1, borderColor: Theme.border,
    ...Theme.shadowSm 
  },
  searchField: { flex: 1, color: Theme.textPrimary, fontFamily: Fonts.medium, fontSize: 16, marginLeft: 12, ...Platform.select({ web: { outlineStyle: "none" } as any }) },
  listContainer: { paddingHorizontal: 20, paddingBottom: 40, gap: 16 },
  memberCard: { 
    backgroundColor: Theme.bgCard, borderRadius: 20, padding: 20, 
    borderLeftWidth: 5, borderLeftColor: Theme.primary, ...Theme.shadowMd,
    borderWidth: 1, borderColor: Theme.border
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  avatarCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: Theme.primaryLight, justifyContent: "center", alignItems: "center" },
  avatarLetter: { color: Theme.primary, fontSize: 18, fontFamily: Fonts.black },
  memberName: { color: Theme.textPrimary, fontSize: 18, fontFamily: Fonts.bold },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  memberPhone: { color: Theme.textSecondary, fontSize: 13 },
  cardActions: { flexDirection: 'row', gap: 10 },
  actionBtn: { width: 38, height: 38, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  cardDivider: { height: 1, backgroundColor: Theme.border, marginVertical: 15 },
  contactDetailsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  contactItem: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  contactText: { fontSize: 13, color: Theme.textPrimary, fontFamily: Fonts.medium },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8 },
  addressText: { fontSize: 13, color: Theme.textSecondary, fontFamily: Fonts.medium, flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeActive: { backgroundColor: Theme.success + '15' },
  badgeInactive: { backgroundColor: Theme.danger + '15' },
  badgeText: { fontSize: 11, fontFamily: Fonts.bold },
  textActive: { color: Theme.success },
  textInactive: { color: Theme.danger },
  financialSummaryBlock: {
    flexDirection: 'row',
    backgroundColor: Theme.bgInput,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginTop: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    justifyContent: 'space-between',
  },
  financialCol: { flex: 1, alignItems: 'center' },
  financialLabel: { fontSize: 9, fontFamily: Fonts.black, color: Theme.textSecondary, marginBottom: 4, letterSpacing: 0.5 },
  financialVal: { fontSize: 13, fontFamily: Fonts.black },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 20 },
  formSheet: { backgroundColor: Theme.bgCard, borderRadius: 24, width: '100%', maxWidth: 500, ...Theme.shadowLg, maxHeight: '90%' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 25, borderBottomWidth: 1, borderBottomColor: Theme.border },
  sheetTitle: { color: Theme.textPrimary, fontSize: 22, fontFamily: Fonts.black },
  sheetClose: { width: 40, height: 40, borderRadius: 20, backgroundColor: Theme.bgMuted, justifyContent: 'center', alignItems: 'center' },
  sheetBody: { padding: 25 },
  inputGroup: { marginBottom: 20 },
  inputRow: { flexDirection: 'row', gap: 15, marginBottom: 20 },
  inputLabel: { color: Theme.textMuted, fontSize: 10, fontFamily: Fonts.black, marginBottom: 8, letterSpacing: 0.5 },
  sheetInput: { 
    height: 56, backgroundColor: Theme.bgInput, borderRadius: 14, color: Theme.textPrimary, 
    paddingHorizontal: 16, fontSize: 15, fontFamily: Fonts.bold, borderWidth: 1, borderColor: Theme.border,
    ...Platform.select({ web: { outlineStyle: "none" } as any })
  },
  statusToggle: { flex: 1, height: 50, borderRadius: 12, backgroundColor: Theme.bgInput, borderWidth: 1, borderColor: Theme.border, justifyContent: 'center', alignItems: 'center' },
  activeToggle: { backgroundColor: Theme.success + '15', borderColor: Theme.success },
  inactiveToggle: { backgroundColor: Theme.danger + '15', borderColor: Theme.danger },
  statusText: { fontFamily: Fonts.bold, color: Theme.textSecondary, fontSize: 14 },
  activeStatusText: { color: Theme.success },
  inactiveStatusText: { color: Theme.danger },
  submitBtn: { backgroundColor: Theme.primary, height: 60, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 15, ...Theme.shadowMd },
  submitBtnText: { color: "#fff", fontFamily: Fonts.black, fontSize: 16 },
  alertCard: { width: '100%', maxWidth: 360, backgroundColor: Theme.bgCard, borderRadius: 24, padding: 30, alignItems: 'center', ...Theme.shadowLg, borderWidth: 1, borderColor: Theme.border },
  alertIconBg: { width: 80, height: 80, borderRadius: 40, backgroundColor: Theme.danger + '15', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  alertTitle: { color: Theme.textPrimary, fontSize: 22, fontFamily: Fonts.black, marginBottom: 10 },
  alertMessage: { color: Theme.textSecondary, fontSize: 15, fontFamily: Fonts.medium, textAlign: 'center', lineHeight: 22, marginBottom: 30 },
  alertActions: { flexDirection: 'row', gap: 15, width: '100%' },
  alertBtn: { flex: 1, height: 56, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  cancelBtn: { backgroundColor: Theme.bgMuted, borderWidth: 1, borderColor: Theme.border },
  confirmDeleteBtn: { backgroundColor: Theme.danger },
  // Low-balance banner
  lowBalanceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F59E0B' + '15',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#F59E0B' + '40',
    gap: 8,
  },
  lowBalanceText: { flex: 1, fontSize: 12, fontFamily: Fonts.bold, color: '#B45309' },
  lowBalanceWABtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#25D366',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  lowBalanceWAText: { fontSize: 11, fontFamily: Fonts.bold, color: '#fff' },
  btnLabel: { color: Theme.textSecondary, fontSize: 15, fontFamily: Fonts.bold },
  countrySelector: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 56,
    backgroundColor: Theme.bgInput,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Theme.border,
    paddingHorizontal: 16,
    gap: 8,
  },
  countrySelectorText: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lowCreditWarningBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Theme.danger + '15',
    borderColor: Theme.danger + '40',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 12,
  },
  lowCreditWarningTitle: {
    fontSize: 12,
    fontFamily: Fonts.black,
    color: Theme.danger,
  },
  lowCreditWarningStatus: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
});
