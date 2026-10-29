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
  Dimensions,
  BackHandler,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, usePathname, useLocalSearchParams } from "expo-router";
import { API_URL } from "@/constants/Config";
import { Fonts } from "@/constants/Fonts";
import { Theme } from "@/constants/theme";
import { useAuthStore } from "@/stores/authStore";
import { useCompanySettingsStore } from "@/stores/companySettingsStore";
import { formatToSingaporeDate, formatToSingaporeTime } from "../utils/timezoneHelper";

type CustomerAgingType = {
  MemberId: string;
  Name: string;
  Phone: string;
  OutstandingBalance: number;
  Bucket0to30: number;
  Bucket31to60: number;
  Bucket61to90: number;
  Bucket90Plus: number;
  CustomerType: "MEMBER" | "CREDIT";
  CreditLimit?: number;
  Email?: string;
  Address?: string;
  IsActive?: boolean;
};

type CreditTransactionType = {
  TransactionId: string;
  SettlementId?: string;
  BillNo?: string;
  TransactionType: "CREDIT_SALE" | "PAYMENT" | "DEBIT" | "CREDIT" | "ADJUSTMENT" | string;
  Amount: number;
  BillAmount?: number;
  PaidAmount?: number;
  PaymentMethod?: string;
  Remarks?: string;
  CreatedDate: string;
  runningBalance: number;
};

type OutstandingBillType = {
  TransactionId: string;
  SettlementId: string;
  BillNo: string;
  GrossAmount: number;
  PaidAmount: number;
  OutstandingAmount: number;
  InvoiceDate: string;
};

type DashboardStats = {
  totalOutstanding: number;
  totalOverdue: number;
  totalCustomersWithCredit: number;
  collectionsToday: number;
  collectionsThisMonth: number;
  totalCredit: number;
  totalPaid: number;
};

type CollectionTransactionType = {
  TransactionId: string;
  MemberId: string;
  BillNo?: string;
  Amount: number;
  PaymentMethod?: string;
  ReferenceNo?: string;
  Remarks?: string;
  CreatedDate: string;
  CustomerName: string;
  CustomerPhone: string;
  CustomerType: "MEMBER" | "CREDIT";
};

type BillSettlementType = {
  AllocationId: string;
  PaymentTransactionId: string;
  AllocatedAmount: number;
  CreatedDate: string;
  PaymentMethod?: string;
  ReferenceNo?: string;
  Remarks?: string;
};

export default function ReceivablesScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const fromScreen = params?.from;
  const { user, token } = useAuthStore();
  const pathname = usePathname();
  const isFocused = pathname === "/receivables";
  const settingsStore = useCompanySettingsStore((state: any) => state.settings);
  const currencySymbol = settingsStore?.currencySymbol || "$";
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isMobile = screenWidth < 768;

  const handleBackPress = useCallback(() => {
    if (fromScreen === "sales-report" || user?.userGroupId === "DFCF23EE-F6F4-4885-8D26-0056C657595F") {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/sales-report" as any);
      }
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/(tabs)/category" as any);
    }
  }, [fromScreen, router, user?.userGroupId]);

  // Diagnostics states
  const [sheetDiagHeight, setSheetDiagHeight] = useState<number>(0);
  const [footerDiagHeight, setFooterDiagHeight] = useState<number>(0);

  // Tab state
  const [activeTab, setActiveTab] = useState<"DASHBOARD" | "AGING" | "REPORTS">("DASHBOARD");

  // Data states
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [agingData, setAgingData] = useState<CustomerAgingType[]>([]);
  const [recentCollections, setRecentCollections] = useState<CollectionTransactionType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Modal States
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerAgingType | null>(null);
  const [showLedgerModal, setShowLedgerModal] = useState(false);
  const [ledgerTab, setLedgerTab] = useState<"LEDGER" | "BILLS">("LEDGER");

  // Invoice-level settlements expand state
  const [expandedBillId, setExpandedBillId] = useState<string | null>(null);
  const [billSettlements, setBillSettlements] = useState<Record<string, BillSettlementType[]>>({});
  const [loadingSettlements, setLoadingSettlements] = useState(false);

  // Ledger and Outstanding details
  const [transactions, setTransactions] = useState<CreditTransactionType[]>([]);
  const [outstandingBills, setOutstandingBills] = useState<OutstandingBillType[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Add/Edit Credit Customer Modal States
  const [modalMode, setModalMode] = useState<"ADD" | "EDIT" | "NONE" >("NONE");
  const [editingCustomer, setEditingCustomer] = useState<CustomerAgingType | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  
  // Country Code Picker States
  const [selectedCountryCode, setSelectedCountryCode] = useState("+65");
  const [localPhone, setLocalPhone] = useState("");
  const [showCountryPicker, setShowCountryPicker] = useState(false);

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
  });

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

  const openAddModal = () => {
    setFormData({ 
      name: "", 
      phone: "", 
      email: "", 
      address: "",
      isActive: true,
      creditLimit: "1000", 
      currentBalance: "0", 
      balance: "0" 
    });
    setSelectedCountryCode("+65");
    setLocalPhone("");
    setEditingCustomer(null);
    setModalMode("ADD");
  };

  const openEditModal = (cust: CustomerAgingType) => {
    setEditingCustomer(cust);
    const parsed = parsePhoneNumber(cust.Phone);
    setSelectedCountryCode(parsed.countryCode);
    setLocalPhone(parsed.localNumber);
    setFormData({
      name: cust.Name,
      phone: cust.Phone,
      email: cust.Email || "",
      address: cust.Address || "", 
      isActive: cust.IsActive !== false,
      creditLimit: cust.CreditLimit !== undefined ? String(cust.CreditLimit) : "1000",
      currentBalance: "0",
      balance: "0",
    });
    setModalMode("EDIT");
  };

  const handleSaveCustomer = async () => {
    if (!formData.name.trim() || !localPhone.trim()) {
      Alert.alert("Required", "Please fill Name and Phone.");
      return;
    }

    setIsSaving(true);
    try {
      const isEdit = modalMode === "EDIT";
      const url = isEdit 
        ? `${API_URL}/api/credit-customers/update` 
        : `${API_URL}/api/credit-customers/add`;
      const fullPhone = `${selectedCountryCode}${localPhone.trim()}`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: editingCustomer?.MemberId,
          name: formData.name.trim(),
          phone: fullPhone,
          email: formData.email.trim(),
          address: formData.address.trim(),
          isActive: formData.isActive,
          creditLimit: parseFloat(formData.creditLimit) || 0,
          currentBalance: parseFloat(formData.currentBalance) || 0,
          balance: 0,
          userId: user?.userId,
        }),
      });

      if (res.ok) {
        setModalMode("NONE");
        fetchData();
        Alert.alert("Success", isEdit ? "Customer updated." : "Customer added.");
      } else {
        const errJson = await res.json().catch(() => ({}));
        Alert.alert("Error", errJson.error || "Save failed.");
      }
    } catch (err) {
      Alert.alert("Error", "Connection problem.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteCustomer = async () => {
    if (!editingCustomer) return;
    setIsSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/credit-customers/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: editingCustomer.MemberId,
          customerType: editingCustomer.CustomerType, // pass type so backend knows which table
        }),
      });
      const resJson = await res.json().catch(() => ({}));
      if (res.ok && resJson.success) {
        setShowDeleteModal(false);
        setEditingCustomer(null);
        fetchData();
        Alert.alert("Deleted", "Customer has been removed.");
      } else {
        Alert.alert("Error", resJson.error || "Delete failed.");
      }
    } catch (err) {
      Alert.alert("Error", "Connection problem.");
    } finally {
      setIsSaving(false);
    }
  };

  // Fetch Dashboard Stats and Aging data
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);

      // ✅ Clear previous data first — prevents stale UI when DB is empty
      setStats(null);
      setAgingData([]);
      setRecentCollections([]);

      // 1. Fetch dashboard stats
      const statsRes = await fetch(`${API_URL}/api/credit-customers/receivables/dashboard`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
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

      // 2. Fetch customer aging report
      const agingRes = await fetch(`${API_URL}/api/credit-customers/receivables/aging`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      const agingJson = await agingRes.json();
      if (agingJson.success) {
        // If DB has no rows → agingJson.customers is [] → agingData becomes [] → UI shows placeholder
        const parsed = (agingJson.customers || []).map((c: any) => ({
          ...c,
          OutstandingBalance: Number(c.OutstandingBalance || 0),
          Bucket0to30: Number(c.Bucket0to30 || 0),
          Bucket31to60: Number(c.Bucket31to60 || 0),
          Bucket61to90: Number(c.Bucket61to90 || 0),
          Bucket90Plus: Number(c.Bucket90Plus || 0)
        }));
        setAgingData(parsed);
      }

      // 3. Fetch recent collections
      const recentRes = await fetch(`${API_URL}/api/credit-customers/receivables/recent-collections`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      const recentJson = await recentRes.json();
      if (recentJson.success) {
        setRecentCollections(recentJson.collections || []);
      }
    } catch (err) {
      console.error("[FETCH RECEIVABLES DATA ERROR]", err);
      Alert.alert("Error", "Could not fetch credit statement dashboard.");
      // ✅ Clean UI on error too — no ghost data
      setStats(null);
      setAgingData([]);
      setRecentCollections([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (isFocused) {
      fetchData();
    }
  }, [isFocused, fetchData]);

  // Handle hardware back button on Android
  useEffect(() => {
    const backAction = () => {
      if (showLedgerModal) {
        setShowLedgerModal(false);
        setSelectedCustomer(null);
        setTransactions([]);
        setOutstandingBills([]);
        setExpandedBillId(null);
        setBillSettlements({});
        return true;
      }
      handleBackPress();
      return true;
    };

    const backHandler = BackHandler.addEventListener("hardwareBackPress", backAction);
    return () => backHandler.remove();
  }, [showLedgerModal, handleBackPress]);

  const handleToggleBillExpansion = async (invoiceTransactionId: string) => {
    if (expandedBillId === invoiceTransactionId) {
      setExpandedBillId(null);
      return;
    }
    setExpandedBillId(invoiceTransactionId);
    if (billSettlements[invoiceTransactionId]) return;

    setLoadingSettlements(true);
    try {
      const res = await fetch(`${API_URL}/api/credit-customers/invoice-settlements/${invoiceTransactionId}`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      const json = await res.json();
      if (json.success) {
        setBillSettlements(prev => ({
          ...prev,
          [invoiceTransactionId]: json.settlements || []
        }));
      }
    } catch (err) {
      console.error("[FETCH BILL SETTLEMENTS ERROR]", err);
    } finally {
      setLoadingSettlements(false);
    }
  };

  // Fetch individual customer statements and unpaid bills
  const fetchCustomerDetails = async (customer: CustomerAgingType) => {
    setLoadingDetails(true);
    setLedgerTab("LEDGER");
    try {
      // 1. Fetch ledger statement
      const ledgerRes = await fetch(`${API_URL}/api/credit-customers/statement/${customer.MemberId}`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      const ledgerJson = await ledgerRes.json();
      if (ledgerJson.success) {
        const parsedTx = (ledgerJson.transactions || []).map((t: any) => ({
          ...t,
          Amount: Number(t.Amount || 0),
          runningBalance: Number(t.runningBalance || 0)
        }));
        setTransactions(parsedTx);
      }

      // 2. Fetch outstanding bills
      const billsRes = await fetch(`${API_URL}/api/credit-customers/outstanding/${customer.MemberId}`, {
        headers: { Authorization: token ? `Bearer ${token}` : "" }
      });
      const billsJson = await billsRes.json();
      if (billsJson.success) {
        const parsedBills = (billsJson.outstandingBills || []).map((b: any) => ({
          ...b,
          GrossAmount: Number(b.GrossAmount || 0),
          PaidAmount: Number(b.PaidAmount || 0),
          OutstandingAmount: Number(b.OutstandingAmount || 0)
        }));
        setOutstandingBills(parsedBills);
      }
    } catch (err) {
      console.error("[FETCH CUSTOMER DETAILS ERROR]", err);
      Alert.alert("Error", "Failed to fetch statement details.");
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleOpenCustomer = (customer: CustomerAgingType) => {
    setSelectedCustomer(customer);
    setShowLedgerModal(true);
    fetchCustomerDetails(customer);
  };



  // Send WhatsApp Reminder Link
  const handleSendWhatsAppReminder = () => {
    if (!selectedCustomer) return;
    
    // Clean phone number (remove spaces, symbols)
    const hasPlus = selectedCustomer.Phone.trim().startsWith("+");
    const cleanPhone = selectedCustomer.Phone.replace(/[^0-9]/g, "");
    const phoneWithCountry = hasPlus ? cleanPhone : (cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone);
    
    let message = `Hi ${selectedCustomer.Name},\n\nThis is a friendly reminder that you have a pending outstanding balance of *${currencySymbol}${selectedCustomer.OutstandingBalance.toFixed(2)}* with us.`;
    
    if (outstandingBills.length > 0) {
      message += `\n\nPending Bills Breakdown:\n`;
      outstandingBills.forEach((bill) => {
        const dateStr = formatToSingaporeDate(bill.InvoiceDate);
        message += `• *${bill.BillNo}* (${dateStr}) : ${currencySymbol}${bill.OutstandingAmount.toFixed(2)}\n`;
      });
    }
    
    message += `\nKindly settle the pending dues at your earliest convenience. Thank you!`;

    const url = `whatsapp://send?phone=${phoneWithCountry}&text=${encodeURIComponent(message)}`;
    
    Linking.canOpenURL(url).then((supported) => {
      if (supported) {
        Linking.openURL(url);
      } else {
        // Fallback to web link
        const webUrl = `https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(message)}`;
        Linking.openURL(webUrl);
      }
    });
  };

  const handlePayBillInFull = (bill: any) => {
    if (!selectedCustomer) return;
    setShowLedgerModal(false);
    router.push({
      pathname: "/payment",
      params: {
        memberId: selectedCustomer.MemberId,
        collectAmount: String(Math.max(0, bill.OutstandingAmount || 0)),
        memberName: selectedCustomer.Name,
        memberPhone: selectedCustomer.Phone,
        isMember: selectedCustomer.CustomerType === "MEMBER" ? "true" : "false",
        remarks: `Payment for Bill #${bill.BillNo}`,
        allocations: JSON.stringify([{ settlementId: bill.SettlementId, amount: bill.OutstandingAmount }])
      }
    });
  };

  // Filter customers by search query
  const filteredCustomers = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return agingData;
    return agingData.filter((c) =>
      c.Name.toLowerCase().includes(query) || c.Phone.includes(query)
    );
  }, [agingData, searchQuery]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        {/* --- Header --- */}
        <View style={styles.headerBar}>
          <TouchableOpacity
            onPress={handleBackPress}
            style={styles.circularBack}
          >
            <Ionicons name="chevron-back" size={24} color={Theme.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.screenTitle}>Credit & Receivables</Text>
            <Text style={styles.screenSubtitle}>Ledger-based accounting & collections</Text>
          </View>
          <TouchableOpacity onPress={openAddModal} style={[styles.refreshBtn, { backgroundColor: Theme.primary, borderColor: Theme.primary, paddingHorizontal: 12, width: 'auto', flexDirection: 'row', gap: 6 }]}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={{ color: '#fff', fontFamily: Fonts.bold, fontSize: 13 }}>Add Credit</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={fetchData} style={styles.refreshBtn} disabled={loading}>
            {loading ? (
              <ActivityIndicator size="small" color={Theme.primary} />
            ) : (
              <Ionicons name="refresh" size={20} color={Theme.textPrimary} />
            )}
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          refreshControl = {
            <RefreshControl refreshing={loading} onRefresh={fetchData} tintColor={Theme.primary} />
          }
        >
          {/* --- KPI Stats section --- */}
          {isMobile ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 15 }}
            >
              <View style={[styles.kpiCard, { width: 220, backgroundColor: Theme.bgDark, borderColor: Theme.borderDark }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Text style={[styles.kpiLabel, { color: Theme.textMuted }]}>TOTAL OUTSTANDING</Text>
                  <Ionicons name="alert-circle" size={18} color={Theme.warning} />
                </View>
                <Text style={[styles.kpiVal, { color: "#FFF" }]}>
                  {currencySymbol}{(stats?.totalOutstanding || 0).toFixed(2)}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.textMuted, marginTop: 4 }}>
                  Active Accounts: {stats?.totalCustomersWithCredit || 0}
                </Text>
              </View>

              <View style={[styles.kpiCard, { width: 220, backgroundColor: Theme.danger + "10", borderColor: Theme.danger }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Text style={[styles.kpiLabel, { color: Theme.danger }]}>OVERDUE (30+ DAYS)</Text>
                  <Ionicons name="warning" size={18} color={Theme.danger} />
                </View>
                <Text style={[styles.kpiVal, { color: Theme.danger }]}>
                  {currencySymbol}{(stats?.totalOverdue || 0).toFixed(2)}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.textSecondary, marginTop: 4 }}>
                  Action required immediately
                </Text>
              </View>

              <View style={[styles.kpiCard, { width: 220, backgroundColor: Theme.success + "10", borderColor: Theme.success }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Text style={[styles.kpiLabel, { color: Theme.success }]}>COLLECTED THIS MONTH</Text>
                  <Ionicons name="checkmark-done" size={18} color={Theme.success} />
                </View>
                <Text style={[styles.kpiVal, { color: Theme.success }]}>
                  {currencySymbol}{(stats?.collectionsThisMonth || 0).toFixed(2)}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.textSecondary, marginTop: 4 }}>
                  Today: {currencySymbol}{(stats?.collectionsToday || 0).toFixed(2)}
                </Text>
              </View>
            </ScrollView>
          ) : (
            <View style={styles.kpiContainer}>
              <View style={[styles.kpiCard, { backgroundColor: Theme.bgDark, borderColor: Theme.borderDark }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Text style={[styles.kpiLabel, { color: Theme.textMuted }]}>TOTAL OUTSTANDING</Text>
                  <Ionicons name="alert-circle" size={18} color={Theme.warning} />
                </View>
                <Text style={[styles.kpiVal, { color: "#FFF" }]}>
                  {currencySymbol}{(stats?.totalOutstanding || 0).toFixed(2)}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.textMuted, marginTop: 4 }}>
                  Active Accounts: {stats?.totalCustomersWithCredit || 0}
                </Text>
              </View>

              <View style={[styles.kpiCard, { backgroundColor: Theme.danger + "10", borderColor: Theme.danger }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Text style={[styles.kpiLabel, { color: Theme.danger }]}>OVERDUE (30+ DAYS)</Text>
                  <Ionicons name="warning" size={18} color={Theme.danger} />
                </View>
                <Text style={[styles.kpiVal, { color: Theme.danger }]}>
                  {currencySymbol}{(stats?.totalOverdue || 0).toFixed(2)}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.textSecondary, marginTop: 4 }}>
                  Action required immediately
                </Text>
              </View>

              <View style={[styles.kpiCard, { backgroundColor: Theme.success + "10", borderColor: Theme.success }]}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <Text style={[styles.kpiLabel, { color: Theme.success }]}>COLLECTED THIS MONTH</Text>
                  <Ionicons name="checkmark-done" size={18} color={Theme.success} />
                </View>
                <Text style={[styles.kpiVal, { color: Theme.success }]}>
                  {currencySymbol}{(stats?.collectionsThisMonth || 0).toFixed(2)}
                </Text>
                <Text style={{ fontSize: 10, fontFamily: Fonts.bold, color: Theme.textSecondary, marginTop: 4 }}>
                  Today: {currencySymbol}{(stats?.collectionsToday || 0).toFixed(2)}
                </Text>
              </View>
            </View>
          )}

          {/* --- Navigation Tabs --- */}
          {/* --- Navigation Tabs --- */}
          {isMobile ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 5 }}
            >
              <TouchableOpacity
                style={[
                  styles.tabBtnMobile,
                  activeTab === "DASHBOARD" && styles.activeTabBtn,
                ]}
                onPress={() => setActiveTab("DASHBOARD")}
              >
                <Ionicons
                  name="people"
                  size={14}
                  color={
                    activeTab === "DASHBOARD" ? "#FFF" : Theme.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.tabTextMobile,
                    activeTab === "DASHBOARD" && styles.activeTabText,
                  ]}
                >
                  Credit Accounts
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.tabBtnMobile,
                  activeTab === "AGING" && styles.activeTabBtn,
                ]}
                onPress={() => setActiveTab("AGING")}
              >
                <Ionicons
                  name="hourglass-outline"
                  size={14}
                  color={activeTab === "AGING" ? "#FFF" : Theme.textSecondary}
                />
                <Text
                  style={[
                    styles.tabTextMobile,
                    activeTab === "AGING" && styles.activeTabText,
                  ]}
                >
                  Aging Analysis
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.tabBtnMobile,
                  activeTab === "REPORTS" && styles.activeTabBtn,
                ]}
                onPress={() => setActiveTab("REPORTS")}
              >
                <Ionicons
                  name="document-text-outline"
                  size={14}
                  color={activeTab === "REPORTS" ? "#FFF" : Theme.textSecondary}
                />
                <Text
                  style={[
                    styles.tabTextMobile,
                    activeTab === "REPORTS" && styles.activeTabText,
                  ]}
                >
                  Reports
                </Text>
              </TouchableOpacity>
            </ScrollView>
          ) : (
            <View style={styles.tabsWrapper}>
              <TouchableOpacity
                style={[
                  styles.tabBtn,
                  activeTab === "DASHBOARD" && styles.activeTabBtn,
                ]}
                onPress={() => setActiveTab("DASHBOARD")}
              >
                <Ionicons
                  name="people"
                  size={16}
                  color={
                    activeTab === "DASHBOARD" ? "#FFF" : Theme.textSecondary
                  }
                />
                <Text
                  style={[
                    styles.tabText,
                    activeTab === "DASHBOARD" && styles.activeTabText,
                  ]}
                >
                  Credit Accounts
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.tabBtn,
                  activeTab === "AGING" && styles.activeTabBtn,
                ]}
                onPress={() => setActiveTab("AGING")}
              >
                <Ionicons
                  name="hourglass-outline"
                  size={16}
                  color={activeTab === "AGING" ? "#FFF" : Theme.textSecondary}
                />
                <Text
                  style={[
                    styles.tabText,
                    activeTab === "AGING" && styles.activeTabText,
                  ]}
                >
                  Aging Analysis
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.tabBtn,
                  activeTab === "REPORTS" && styles.activeTabBtn,
                ]}
                onPress={() => setActiveTab("REPORTS")}
              >
                <Ionicons
                  name="document-text-outline"
                  size={16}
                  color={activeTab === "REPORTS" ? "#FFF" : Theme.textSecondary}
                />
                <Text
                  style={[
                    styles.tabText,
                    activeTab === "REPORTS" && styles.activeTabText,
                  ]}
                >
                  Reports
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {/* --- Search Bar --- */}
          <View style={styles.searchWrapper}>
            <View style={styles.searchInner}>
              <Ionicons name="search" size={20} color={Theme.textMuted} />
              <TextInput
                placeholder="Search customers..."
                placeholderTextColor={Theme.textMuted}
                style={styles.searchField}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
          </View>

          {/* --- Main Contents depending on Tab --- */}
          {activeTab === "DASHBOARD" ? (
            <View style={styles.listContainer}>
              {filteredCustomers.length === 0 ? (
                <View style={styles.centerBlock}>
                  <Ionicons name="people-outline" size={48} color={Theme.textMuted} />
                  <Text style={styles.emptyText}>No customer credit records found</Text>
                </View>
              ) : (
                filteredCustomers.map((item) => (
                  <View
                     key={item.MemberId}
                     style={styles.customerCard}
                  >
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => handleOpenCustomer(item)}
                      style={styles.cardHeader}
                    >
                      <View style={styles.avatarCircle}>
                        <Text style={styles.avatarLetter}>{item.Name.charAt(0).toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.customerName}>{item.Name}</Text>
                        <Text style={styles.customerPhone}>{item.Phone}</Text>
                        {item.CreditLimit !== undefined && (
                          <Text style={{ color: Theme.textSecondary, fontSize: 12, fontFamily: Fonts.bold, marginTop: 2 }}>
                            Credit Limit: {currencySymbol}{Number(item.CreditLimit).toFixed(2)}
                          </Text>
                        )}
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={styles.outstandingLabel}>OUTSTANDING</Text>
                        <Text style={styles.outstandingValue}>
                          {currencySymbol}{item.OutstandingBalance.toFixed(2)}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {/* Aging summary preview bar */}
                    <View style={styles.agingBarContainer}>
                      <Text style={styles.agingBarTitle}>Aging Buckets:</Text>
                      <View style={styles.agingBarRow}>
                        {item.Bucket0to30 > 0 && (
                          <View style={[styles.agingBarSegment, { flex: item.Bucket0to30, backgroundColor: Theme.success }]}>
                            <Text style={styles.segmentText}>0-30d</Text>
                          </View>
                        )}
                        {item.Bucket31to60 > 0 && (
                          <View style={[styles.agingBarSegment, { flex: item.Bucket31to60, backgroundColor: Theme.warning }]}>
                            <Text style={styles.segmentText}>31-60d</Text>
                          </View>
                        )}
                        {item.Bucket61to90 > 0 && (
                          <View style={[styles.agingBarSegment, { flex: item.Bucket61to90, backgroundColor: Theme.primary }]}>
                            <Text style={styles.segmentText}>61-90d</Text>
                          </View>
                        )}
                        {item.Bucket90Plus > 0 && (
                          <View style={[styles.agingBarSegment, { flex: item.Bucket90Plus, backgroundColor: Theme.danger }]}>
                            <Text style={styles.segmentText}>90d+</Text>
                          </View>
                        )}
                      </View>
                    </View>

                    {/* Actions Row: Edit / Delete */}
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Theme.border + '50' }}>
                      <TouchableOpacity 
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Theme.primary + '10', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
                        onPress={() => openEditModal(item)}
                      >
                        <Ionicons name="create-outline" size={16} color={Theme.primary} />
                        <Text style={{ fontSize: 12, fontFamily: Fonts.bold, color: Theme.primary }}>Edit</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Theme.danger + '10', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 }}
                        onPress={() => {
                          setEditingCustomer(item);
                          setShowDeleteModal(true);
                        }}
                      >
                        <Ionicons name="trash-outline" size={16} color={Theme.danger} />
                        <Text style={{ fontSize: 12, fontFamily: Fonts.bold, color: Theme.danger }}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ))
              )}
            </View>
          ) : activeTab === "AGING" ? (
            /* --- Aging Analysis View --- */
            <View style={styles.listContainer}>
              {filteredCustomers.length === 0 ? (
                <View style={styles.centerBlock}>
                  <Ionicons name="hourglass-outline" size={48} color={Theme.textMuted} />
                  <Text style={styles.emptyText}>No aging metrics found</Text>
                </View>
              ) : (
                filteredCustomers.map((item) => (
                  <View key={item.MemberId} style={styles.agingCard}>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => handleOpenCustomer(item)}
                      style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}
                    >
                      <View>
                        <Text style={styles.customerName}>{item.Name}</Text>
                        <Text style={styles.customerPhone}>{item.Phone}</Text>
                        {item.CreditLimit !== undefined && (
                          <Text style={{ color: Theme.textSecondary, fontSize: 12, fontFamily: Fonts.bold, marginTop: 2 }}>
                            Credit Limit: {currencySymbol}{Number(item.CreditLimit).toFixed(2)}
                          </Text>
                        )}
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={styles.outstandingLabel}>TOTAL</Text>
                        <Text style={[styles.outstandingValue, { fontSize: 16 }]}>
                          {currencySymbol}{item.OutstandingBalance.toFixed(2)}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    <View style={styles.agingGrid}>
                      <View style={styles.agingGridItem}>
                        <Text style={styles.agingGridLabel}>0-30 days</Text>
                        <Text style={[styles.agingGridValue, item.Bucket0to30 > 0 && { color: Theme.success }]}>
                          {currencySymbol}{item.Bucket0to30.toFixed(0)}
                        </Text>
                      </View>
                      <View style={styles.agingGridItem}>
                        <Text style={styles.agingGridLabel}>31-60 days</Text>
                        <Text style={[styles.agingGridValue, item.Bucket31to60 > 0 && { color: Theme.warning }]}>
                          {currencySymbol}{item.Bucket31to60.toFixed(0)}
                        </Text>
                      </View>
                      <View style={styles.agingGridItem}>
                        <Text style={styles.agingGridLabel}>61-90 days</Text>
                        <Text style={[styles.agingGridValue, item.Bucket61to90 > 0 && { color: Theme.primary }]}>
                          {currencySymbol}{item.Bucket61to90.toFixed(0)}
                        </Text>
                      </View>
                      <View style={styles.agingGridItem}>
                        <Text style={styles.agingGridLabel}>90+ days</Text>
                        <Text style={[styles.agingGridValue, item.Bucket90Plus > 0 && { color: Theme.danger, fontFamily: Fonts.black }]}>
                          {currencySymbol}{item.Bucket90Plus.toFixed(0)}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))
              )}
            </View>
          ) : (
            /* --- Reports View --- */
            <View style={styles.listContainer}>
              <View style={styles.reportSummaryCard}>
                <Text style={styles.reportSummaryTitle}>Unified Ledger Summary</Text>
                
                <View style={styles.reportSummaryGrid}>
                  <View style={styles.reportSummaryItem}>
                    <Text style={styles.reportSummaryLabel}>Total Credit Issued</Text>
                    <Text style={[styles.reportSummaryVal, { color: Theme.danger }]}>
                      {currencySymbol}{(stats?.totalCredit || 0).toFixed(2)}
                    </Text>
                  </View>
                  <View style={styles.reportSummaryItem}>
                    <Text style={styles.reportSummaryLabel}>Total Paid</Text>
                    <Text style={[styles.reportSummaryVal, { color: Theme.success }]}>
                      {currencySymbol}{(stats?.totalPaid || 0).toFixed(2)}
                    </Text>
                  </View>
                  <View style={styles.reportSummaryItem}>
                    <Text style={styles.reportSummaryLabel}>Net Outstanding</Text>
                    <Text style={[styles.reportSummaryVal, { color: Theme.warning }]}>
                      {currencySymbol}{(stats?.totalOutstanding || 0).toFixed(2)}
                    </Text>
                  </View>
                </View>
              </View>

              <Text style={styles.reportHeader}>Recent Collections</Text>
              {recentCollections.length === 0 ? (
                <View style={styles.centerBlock}>
                  <Ionicons name="receipt-outline" size={48} color={Theme.textMuted} />
                  <Text style={styles.emptyText}>No recent payments recorded</Text>
                </View>
              ) : (
                recentCollections.map((col) => {
                  const formattedColDate = formatToSingaporeDate(col.CreatedDate, { day: "numeric", month: "short", year: "numeric" }) + " " + formatToSingaporeTime(col.CreatedDate, { hour: "2-digit", minute: "2-digit", hour12: false });
                  return (
                    <View key={col.TransactionId} style={styles.collectionRowCard}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.collectionCustomerName}>{col.CustomerName}</Text>
                        <Text style={styles.collectionCustomerType}>{col.CustomerType} • {col.PaymentMethod || "CASH"}</Text>
                        {col.Remarks && <Text style={styles.collectionRemarks}>{col.Remarks}</Text>}
                        <Text style={styles.collectionDate}>{formattedColDate}</Text>
                      </View>
                      <View style={{ alignItems: "flex-end", justifyContent: "center" }}>
                        <Text style={styles.collectionAmount}>
                          {currencySymbol}{col.Amount.toFixed(2)}
                        </Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          )}

          <View style={{ height: 60 }} />
        </ScrollView>

        {/* ================= LEDGER STATEMENT VIEW MODAL ================= */}
        <Modal 
          visible={showLedgerModal} 
          transparent 
          animationType="slide"
          onRequestClose={() => {
            setShowLedgerModal(false);
            setSelectedCustomer(null);
            setTransactions([]);
            setOutstandingBills([]);
          }}
        >
          <View style={styles.modalOverlay}>
            <View 
              onLayout={(e) => setSheetDiagHeight(e.nativeEvent.layout.height)}
              style={[
                styles.ledgerSheet,
                isMobile && {
                  maxHeight: "85%",
                  borderRadius: 16,
                  width: "95%",
                }
              ]}
            >
              {/* Header */}
              <View style={styles.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sheetTitle}>Account Ledger</Text>
                  <Text style={styles.sheetSubtitle}>
                    {selectedCustomer?.Name} • {selectedCustomer?.Phone}
                    {selectedCustomer?.CreditLimit !== undefined && ` • Credit Limit: ${currencySymbol}${Number(selectedCustomer.CreditLimit).toFixed(2)}`}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    setShowLedgerModal(false);
                    setSelectedCustomer(null);
                    setTransactions([]);
                    setOutstandingBills([]);
                  }}
                  style={styles.sheetClose}
                >
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>

              {loadingDetails ? (
                <View style={[styles.centerBlock, { padding: 40 }]}>
                  <ActivityIndicator size="large" color={Theme.primary} />
                  <Text style={{ marginTop: 12, fontFamily: Fonts.bold, color: Theme.textSecondary }}>
                    Fetching ledger rows...
                  </Text>
                </View>
              ) : (
                /* ── scrollable body: tabs + content ── flex:1 so footer stays below ── */
                <View style={{ flex: 1, minHeight: 0 }}>
                  {/* Ledger navigation tabs */}
                  <View style={styles.ledgerTabs}>
                    <TouchableOpacity
                      style={[styles.ledgerTabBtn, ledgerTab === "LEDGER" && styles.activeLedgerTabBtn]}
                      onPress={() => setLedgerTab("LEDGER")}
                    >
                      <Text style={[styles.ledgerTabText, ledgerTab === "LEDGER" && styles.activeLedgerTabText, isMobile && { fontSize: 11 }]}>
                        Transaction Statement
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.ledgerTabBtn, ledgerTab === "BILLS" && styles.activeLedgerTabBtn]}
                      onPress={() => setLedgerTab("BILLS")}
                    >
                      <Text style={[styles.ledgerTabText, ledgerTab === "BILLS" && styles.activeLedgerTabText, isMobile && { fontSize: 11 }]}>
                        Open Invoices ({outstandingBills.length})
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <ScrollView style={{ flex: 1, padding: isMobile ? 12 : 20 }} showsVerticalScrollIndicator={false}>
                    {ledgerTab === "LEDGER" ? (
                      /* --- Ledger transaction statement history --- */
                      <View style={{ paddingBottom: 20 }}>
                        {transactions.length === 0 ? (
                          <Text style={styles.noHistoryText}>No credit transaction history.</Text>
                        ) : (
                          <View style={styles.ledgerTable}>
                            {/* Table Header */}
                            <View style={styles.ledgerRowHeader}>
                              <Text style={[styles.ledgerColHeader, { flex: 1.1 }]} numberOfLines={1} adjustsFontSizeToFit>DATE/TIME</Text>
                              <Text style={[styles.ledgerColHeader, { flex: 1.2 }]} numberOfLines={1} adjustsFontSizeToFit>REF/REMARKS</Text>
                              <Text style={[styles.ledgerColHeader, { flex: 0.8, textAlign: "right" }]} numberOfLines={1} adjustsFontSizeToFit>AMT</Text>
                              <Text style={[styles.ledgerColHeader, { flex: 0.9, textAlign: "right" }]} numberOfLines={1} adjustsFontSizeToFit>BAL</Text>
                            </View>

                            {/* Table Rows */}
                            {transactions.map((tx, idx) => {
                              const formattedDate = formatToSingaporeDate(tx.CreatedDate, { day: "numeric", month: "short" }) + " " + formatToSingaporeTime(tx.CreatedDate, { hour: "2-digit", minute: "2-digit", hour12: false });
                              const typeUpper = (tx.TransactionType || "").toUpperCase();
                              const isCharge = typeUpper === "CREDIT_SALE" || typeUpper === "DEBIT" || (typeUpper === "ADJUSTMENT" && (Number(tx.BillAmount) > 0 || Number(tx.Amount) > 0));
                              return (
                                <View key={tx.TransactionId || idx} style={styles.ledgerRow}>
                                  <Text style={[styles.ledgerCol, { flex: 1.1, fontSize: 10 }]} numberOfLines={1} adjustsFontSizeToFit>{formattedDate}</Text>
                                  <View style={{ flex: 1.2, paddingRight: 4 }}>
                                    <Text style={[styles.ledgerCol, { fontFamily: Fonts.bold, fontSize: 11 }]} numberOfLines={1} adjustsFontSizeToFit>
                                      {tx.TransactionType} {tx.BillNo ? `#${tx.BillNo}` : ""}
                                    </Text>
                                    {tx.Remarks && (
                                      <Text style={styles.ledgerRowRemarks} numberOfLines={1} adjustsFontSizeToFit>
                                        {tx.Remarks}
                                      </Text>
                                    )}
                                  </View>
                                  <Text style={[styles.ledgerCol, { flex: 0.8, textAlign: "right", fontFamily: Fonts.bold, color: isCharge ? Theme.danger : Theme.success, fontSize: 11 }]} numberOfLines={1} adjustsFontSizeToFit>
                                    {isCharge ? "+" : "-"}{currencySymbol}{Math.abs(tx.Amount).toFixed(2)}
                                  </Text>
                                  <Text style={[styles.ledgerCol, { flex: 0.9, textAlign: "right", fontFamily: Fonts.black, fontSize: 11 }]} numberOfLines={1} adjustsFontSizeToFit>
                                    {currencySymbol}{tx.runningBalance.toFixed(2)}
                                  </Text>
                                </View>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    ) : (
                      /* --- Outstanding Bills list --- */
                      <View style={{ paddingBottom: 20 }}>
                        {outstandingBills.length === 0 ? (
                          <Text style={styles.noHistoryText}>No pending invoices found.</Text>
                        ) : (
                          <View style={{ gap: 10 }}>
                            {outstandingBills.map((bill) => {
                              const formattedBillDate = formatToSingaporeDate(bill.InvoiceDate, { day: "numeric", month: "short", year: "numeric" });
                              return (
                                <View key={bill.SettlementId} style={styles.billItemCard}>
                                  <TouchableOpacity 
                                    activeOpacity={0.8}
                                    onPress={() => handleToggleBillExpansion(bill.TransactionId)}
                                    style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}
                                  >
                                    <View style={{ flex: 1, paddingRight: 8 }}>
                                      <Text style={styles.billItemTitle} numberOfLines={1} adjustsFontSizeToFit>Bill #{bill.BillNo}</Text>
                                      <Text style={styles.billItemSub} numberOfLines={1} adjustsFontSizeToFit>{formattedBillDate}</Text>
                                    </View>
                                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                      <View style={styles.billItemBadge}>
                                        <Text style={styles.billItemBadgeText}>DUE</Text>
                                      </View>
                                      <Ionicons 
                                        name={expandedBillId === bill.TransactionId ? "chevron-up" : "chevron-down"} 
                                        size={18} 
                                        color={Theme.textSecondary} 
                                      />
                                    </View>
                                  </TouchableOpacity>
                                  <View style={styles.billDivider} />
                                  <View style={styles.billBreakdown}>
                                    <View style={{ flex: 1 }}>
                                      <Text style={styles.billBreakLabel} numberOfLines={1} adjustsFontSizeToFit>GROSS AMT</Text>
                                      <Text style={styles.billBreakValue} numberOfLines={1} adjustsFontSizeToFit>{currencySymbol}{bill.GrossAmount.toFixed(2)}</Text>
                                    </View>
                                    <View style={{ flex: 1, alignItems: "center", paddingHorizontal: 4 }}>
                                      <Text style={styles.billBreakLabel} numberOfLines={1} adjustsFontSizeToFit>PAID AMT</Text>
                                      <Text style={[styles.billBreakValue, { color: Theme.success }]} numberOfLines={1} adjustsFontSizeToFit>{currencySymbol}{bill.PaidAmount.toFixed(2)}</Text>
                                    </View>
                                    <View style={{ flex: 1, alignItems: "flex-end" }}>
                                      <Text style={styles.billBreakLabel} numberOfLines={1} adjustsFontSizeToFit>OUTSTANDING</Text>
                                      <Text style={[styles.billBreakValue, { color: Theme.danger, fontFamily: Fonts.black }]} numberOfLines={1} adjustsFontSizeToFit>
                                        {currencySymbol}{bill.OutstandingAmount.toFixed(2)}
                                      </Text>
                                    </View>
                                  </View>

                                  {bill.OutstandingAmount > 0.01 && (
                                    <TouchableOpacity
                                      onPress={() => handlePayBillInFull(bill)}
                                      style={styles.payBillInFullBtn}
                                      activeOpacity={0.8}
                                    >
                                      <Ionicons name="card-outline" size={14} color="#fff" />
                                      <Text style={styles.payBillInFullText}>Pay Bill in Full</Text>
                                    </TouchableOpacity>
                                  )}

                                  {/* Expanded Settlement History */}
                                  {expandedBillId === bill.TransactionId && (
                                    <View style={styles.billSettlementsContainer}>
                                      <Text style={styles.billSettlementsTitle}>Settlement History</Text>
                                      {loadingSettlements && !billSettlements[bill.TransactionId] ? (
                                        <ActivityIndicator size="small" color={Theme.primary} style={{ marginVertical: 8 }} />
                                      ) : (billSettlements[bill.TransactionId] || []).length === 0 ? (
                                        <Text style={styles.billSettlementsEmpty}>No payments allocated to this invoice yet.</Text>
                                      ) : (
                                        (billSettlements[bill.TransactionId] || []).map((setl) => {
                                          const formattedSd = formatToSingaporeDate(setl.CreatedDate, { day: "numeric", month: "short" }) + " " + formatToSingaporeTime(setl.CreatedDate, { hour: "2-digit", minute: "2-digit", hour12: false });
                                          return (
                                            <View key={setl.AllocationId} style={styles.billSettlementRow}>
                                              <View style={{ flex: 1 }}>
                                                <Text style={styles.billSettlementMethod}>{setl.PaymentMethod || "CASH"} {setl.ReferenceNo ? `(${setl.ReferenceNo})` : ""}</Text>
                                                <Text style={styles.billSettlementDate}>{formattedSd}</Text>
                                              </View>
                                              <View style={{ alignItems: "flex-end" }}>
                                                <Text style={styles.billSettlementAmount}>
                                                  {currencySymbol}{setl.AllocatedAmount.toFixed(2)}
                                                </Text>
                                              </View>
                                            </View>
                                          );
                                        })
                                      )}
                                    </View>
                                  )}
                                </View>
                              );
                            })}
                          </View>
                        )}
                      </View>
                    )}
                  </ScrollView>
                </View>
              )}

              {/* ── sticky action footer: direct child of ledgerSheet, NEVER clipped ── */}
              {!loadingDetails && (
                <View 
                  onLayout={(e) => setFooterDiagHeight(e.nativeEvent.layout.height)}
                  style={styles.ledgerActions}
                >
                  <TouchableOpacity
                    onPress={handleSendWhatsAppReminder}
                    style={[styles.actionButton, { backgroundColor: Theme.bgInput, borderWidth: 1, borderColor: Theme.border }]}
                  >
                    <Ionicons name="logo-whatsapp" size={20} color={Theme.success} />
                    <Text 
                      style={[styles.actionButtonText, { color: Theme.textPrimary }, isMobile && { fontSize: 11 }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                    >
                      WhatsApp Reminder
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      if (!selectedCustomer) return;
                      setShowLedgerModal(false);
                      router.push({
                        pathname: "/payment",
                        params: {
                          memberId: selectedCustomer.MemberId,
                          collectAmount: String(Math.max(0, selectedCustomer.OutstandingBalance || 0)),
                          memberName: selectedCustomer.Name,
                          memberPhone: selectedCustomer.Phone,
                          isMember: selectedCustomer.CustomerType === "MEMBER" ? "true" : "false"
                        }
                      });
                    }}
                    style={[styles.actionButton, { backgroundColor: Theme.primary }]}
                    disabled={!selectedCustomer || selectedCustomer.OutstandingBalance <= 0.01}
                  >
                    <Ionicons name="wallet-outline" size={20} color="#fff" />
                    <Text 
                      style={[styles.actionButtonText, { color: "#fff" }, isMobile && { fontSize: 11 }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                    >
                      Record Collection
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
        </Modal>



        {/* Form Modal */}
        <Modal visible={modalMode !== "NONE"} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.formSheet}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{modalMode === "EDIT" ? "Edit Credit Customer" : "Add Credit Customer"}</Text>
                <TouchableOpacity onPress={() => setModalMode("NONE")} style={styles.sheetClose}>
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>
              <ScrollView style={{ paddingHorizontal: 24, paddingVertical: 16 }} showsVerticalScrollIndicator={false}>
                <>
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
                    <TextInput style={[styles.sheetInput, { height: 80, textAlignVertical: 'top', paddingTop: 12 }]} multiline value={formData.address} onChangeText={v => setFormData({ ...formData, address: v })} placeholder="Address" placeholderTextColor={Theme.textMuted} />
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
                </>

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.inputLabel}>CREDIT LIMIT</Text>
                    <TextInput style={styles.sheetInput} keyboardType="numeric" value={formData.creditLimit} onChangeText={v => setFormData({ ...formData, creditLimit: v })} />
                  </View>
                  {modalMode !== "EDIT" && (
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inputLabel}>CONSUMED OUTSTANDING</Text>
                      <TextInput style={styles.sheetInput} keyboardType="numeric" value={formData.currentBalance} onChangeText={v => setFormData({ ...formData, currentBalance: v })} />
                    </View>
                  )}
                </View>

                <TouchableOpacity 
                  style={[styles.submitBtn, isSaving && { opacity: 0.7 }]} 
                  onPress={handleSaveCustomer} 
                  disabled={isSaving}
                >
                  {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>{modalMode === "EDIT" ? "Update Customer" : "Add Customer"}</Text>}
                </TouchableOpacity>
                <View style={{ height: 16 }} />
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
                Do you want to delete this credit customer account?{"\n"}
                <Text style={{ color: Theme.primary, fontSize: 16, fontFamily: Fonts.black }}>{editingCustomer?.Name}</Text>
              </Text>
              
              <View style={styles.alertActions}>
                <TouchableOpacity 
                  style={[styles.alertBtn, styles.cancelBtn]} 
                  onPress={() => { setEditingCustomer(null); setShowDeleteModal(false); }}
                >
                  <Text style={styles.btnLabel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.alertBtn, styles.confirmDeleteBtn]} 
                  onPress={handleDeleteCustomer}
                  disabled={isSaving}
                >
                  {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={[styles.btnLabel, { color: '#FFF' }]}>Delete</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.bgMain },
  headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 20, gap: 15 },
  circularBack: { width: 44, height: 44, borderRadius: 12, backgroundColor: Theme.bgCard, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: Theme.border },
  screenTitle: { color: Theme.textPrimary, fontSize: 20, fontFamily: Fonts.black },
  screenSubtitle: { color: Theme.textSecondary, fontSize: 11, fontFamily: Fonts.medium },
  refreshBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: Theme.bgCard, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: Theme.border },
  
  // KPI Stats
  kpiContainer: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 20, gap: 12, marginBottom: 15 },
  kpiCard: { flex: 1, minWidth: 150, padding: 15, borderRadius: 16, borderWidth: 1, ...Theme.shadowSm },
  kpiLabel: { fontSize: 9, fontFamily: Fonts.black, letterSpacing: 0.5 },
  kpiVal: { fontSize: 18, fontFamily: Fonts.black, marginTop: 4 },

  // Tabs navigation
  tabsWrapper: { flexDirection: "row", paddingHorizontal: 20, gap: 10, marginVertical: 10 },
  tabBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 48, borderRadius: 12, backgroundColor: Theme.bgCard, borderWidth: 1, borderColor: Theme.border },
  activeTabBtn: { backgroundColor: Theme.primary, borderColor: Theme.primary },
  tabText: { fontFamily: Fonts.bold, color: Theme.textSecondary, fontSize: 13 },
  activeTabText: { color: "#FFF" },
  tabBtnMobile: {
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 40,
    borderRadius: 10,
    backgroundColor: Theme.bgCard,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  tabTextMobile: {
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    fontSize: 12,
  },

  // Search Bar
  searchWrapper: { marginHorizontal: 20, marginBottom: 15 },
  searchInner: { 
    flexDirection: "row", alignItems: "center", paddingHorizontal: 16, height: 50, 
    borderRadius: 12, backgroundColor: Theme.bgCard, borderWidth: 1, borderColor: Theme.border,
    ...Theme.shadowSm 
  },
  searchField: { flex: 1, color: Theme.textPrimary, fontFamily: Fonts.medium, fontSize: 14, marginLeft: 10, ...Platform.select({ web: { outlineStyle: "none" } as any }) },
  
  // Customer List
  listContainer: { paddingHorizontal: 20, gap: 12 },
  customerCard: { backgroundColor: Theme.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Theme.border, ...Theme.shadowSm },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: Theme.primaryLight, justifyContent: "center", alignItems: "center" },
  avatarLetter: { color: Theme.primary, fontSize: 16, fontFamily: Fonts.black },
  customerName: { color: Theme.textPrimary, fontSize: 16, fontFamily: Fonts.bold },
  customerPhone: { color: Theme.textSecondary, fontSize: 12, fontFamily: Fonts.medium, marginTop: 2 },
  outstandingLabel: { color: Theme.textMuted, fontSize: 8, fontFamily: Fonts.black, letterSpacing: 0.5 },
  outstandingValue: { color: Theme.danger, fontSize: 16, fontFamily: Fonts.black, marginTop: 2 },
  
  // Aging segment bar
  agingBarContainer: { marginTop: 12, borderTopWidth: 1, borderTopColor: Theme.border, paddingTop: 10 },
  agingBarTitle: { fontSize: 10, fontFamily: Fonts.bold, color: Theme.textSecondary, marginBottom: 6 },
  agingBarRow: { flexDirection: "row", height: 18, borderRadius: 9, overflow: "hidden", backgroundColor: Theme.bgInput },
  agingBarSegment: { height: "100%", justifyContent: "center", alignItems: "center" },
  segmentText: { color: "#FFF", fontSize: 8, fontFamily: Fonts.black },

  // Aging Cards
  agingCard: { backgroundColor: Theme.bgCard, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Theme.border, ...Theme.shadowSm },
  agingGrid: { flexDirection: "row", borderTopWidth: 1, borderTopColor: Theme.border, paddingTop: 12, marginTop: 4 },
  agingGridItem: { flex: 1, alignItems: "center" },
  agingGridLabel: { fontSize: 9, fontFamily: Fonts.bold, color: Theme.textMuted },
  agingGridValue: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary, marginTop: 4 },

  // Ledger sheets
  modalOverlay: {
    flex: 1,
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 10,
  },
  ledgerSheet: { backgroundColor: Theme.bgCard, borderRadius: 24, width: "100%", maxWidth: 650, flex: 1, flexShrink: 1, maxHeight: "90%", ...Theme.shadowLg, overflow: "hidden" },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: Theme.border },
  sheetTitle: { color: Theme.textPrimary, fontSize: 20, fontFamily: Fonts.black },
  sheetSubtitle: { color: Theme.textSecondary, fontSize: 12, fontFamily: Fonts.medium, marginTop: 2 },
  sheetClose: { width: 38, height: 38, borderRadius: 19, backgroundColor: Theme.bgMuted, justifyContent: "center", alignItems: "center" },
  
  // Ledger inner tabs
  ledgerTabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: Theme.border, backgroundColor: Theme.bgMain },
  ledgerTabBtn: { flex: 1, paddingVertical: 14, alignItems: "center" },
  activeLedgerTabBtn: { borderBottomWidth: 3, borderBottomColor: Theme.primary, backgroundColor: Theme.bgCard },
  ledgerTabText: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.textSecondary },
  activeLedgerTabText: { color: Theme.primary },

  // Ledger statement list
  ledgerTable: { borderBottomWidth: 1, borderBottomColor: Theme.border },
  ledgerRowHeader: { flexDirection: "row", paddingVertical: 10, borderBottomWidth: 1.5, borderBottomColor: Theme.border, backgroundColor: Theme.bgInput, paddingHorizontal: 10 },
  ledgerColHeader: { color: Theme.textPrimary, fontSize: 10, fontFamily: Fonts.black },
  ledgerRow: { flexDirection: "row", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Theme.border, paddingHorizontal: 10, alignItems: "center" },
  ledgerCol: { color: Theme.textPrimary, fontSize: 12, fontFamily: Fonts.medium },
  ledgerRowRemarks: { color: Theme.textMuted, fontSize: 10, fontFamily: Fonts.regular, marginTop: 2 },
  noHistoryText: { color: Theme.textMuted, fontSize: 13, fontFamily: Fonts.medium, textAlign: "center", paddingVertical: 40, fontStyle: "italic" },

  // Outstanding bill cards
  billItemCard: { backgroundColor: Theme.bgCard, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: Theme.border, ...Theme.shadowSm },
  billItemTitle: { fontSize: 14, fontFamily: Fonts.bold, color: Theme.textPrimary },
  billItemSub: { fontSize: 11, fontFamily: Fonts.medium, color: Theme.textSecondary, marginTop: 2 },
  billItemBadge: { backgroundColor: Theme.danger + "15", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: Theme.danger },
  billItemBadgeText: { fontSize: 9, fontFamily: Fonts.black, color: Theme.danger },
  billDivider: { height: 1, backgroundColor: Theme.border, marginVertical: 10 },
  billBreakdown: { flexDirection: "row", justifyContent: "space-between" },
  billBreakLabel: { fontSize: 8, fontFamily: Fonts.black, color: Theme.textMuted, letterSpacing: 0.5, marginBottom: 2 },
  billBreakValue: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary },
  payBillInFullBtn: {
    backgroundColor: Theme.success,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 12,
    gap: 6,
  },
  payBillInFullText: {
    color: "#fff",
    fontFamily: Fonts.bold,
    fontSize: 12,
  },
  
  // Expanded Bill Settlements
  billSettlementsContainer: { marginTop: 12, borderTopWidth: 1, borderTopColor: Theme.border, paddingTop: 10 },
  billSettlementsTitle: { fontSize: 11, fontFamily: Fonts.bold, color: Theme.textPrimary, marginBottom: 8 },
  billSettlementsEmpty: { fontSize: 10, fontFamily: Fonts.medium, color: Theme.textMuted, fontStyle: "italic", marginVertical: 4 },
  billSettlementRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: Theme.border },
  billSettlementMethod: { fontSize: 11, fontFamily: Fonts.bold, color: Theme.textPrimary },
  billSettlementDate: { fontSize: 9, fontFamily: Fonts.regular, color: Theme.textMuted, marginTop: 2 },
  billSettlementAmount: { fontSize: 11, fontFamily: Fonts.black, color: Theme.success },

  // Report Styles
  reportSummaryCard: { backgroundColor: Theme.bgCard, borderRadius: 16, padding: 18, borderWidth: 1, borderColor: Theme.border, ...Theme.shadowSm, marginBottom: 15 },
  reportSummaryTitle: { fontSize: 14, fontFamily: Fonts.black, color: Theme.textPrimary, marginBottom: 12 },
  reportSummaryGrid: { flexDirection: "row", gap: 10 },
  reportSummaryItem: { flex: 1, backgroundColor: Theme.bgInput, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: Theme.border },
  reportSummaryLabel: { fontSize: 9, fontFamily: Fonts.bold, color: Theme.textMuted },
  reportSummaryVal: { fontSize: 14, fontFamily: Fonts.black, marginTop: 6 },
  reportHeader: { fontSize: 15, fontFamily: Fonts.black, color: Theme.textPrimary, marginTop: 10, marginBottom: 12 },
  collectionRowCard: { backgroundColor: Theme.bgCard, borderRadius: 12, padding: 14, flexDirection: "row", borderWidth: 1, borderColor: Theme.border, ...Theme.shadowSm, marginBottom: 10 },
  collectionCustomerName: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary },
  collectionCustomerType: { fontSize: 10, fontFamily: Fonts.medium, color: Theme.textSecondary, marginTop: 2 },
  collectionRemarks: { fontSize: 11, fontFamily: Fonts.regular, color: Theme.textMuted, marginTop: 4 },
  collectionDate: { fontSize: 9, fontFamily: Fonts.regular, color: Theme.textMuted, marginTop: 6 },
  collectionAmount: { fontSize: 15, fontFamily: Fonts.black, color: Theme.success },

  // Ledger action footer
  ledgerActions: {
    flexDirection: "row",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Theme.border,
    gap: 12,
    backgroundColor: Theme.bgCard,
    // Ensure footer is always visible and never clipped
    flexShrink: 0,
    minHeight: 72,
    zIndex: 10,
  },
  actionButton: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    // Explicit min dimensions so production builds can't collapse them
    minWidth: 120,
    minHeight: 52,
  },
  actionButtonText: { fontSize: 13, fontFamily: Fonts.bold },

  // Collection modal
  collectCard: { backgroundColor: Theme.bgCard, borderRadius: 24, width: "100%", maxWidth: 500, flexShrink: 1, maxHeight: "90%", ...Theme.shadowLg, overflow: "hidden" },
  adjustModalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 20, borderBottomWidth: 1, borderBottomColor: Theme.border },
  adjustModalTitle: { color: Theme.textPrimary, fontSize: 18, fontFamily: Fonts.black },
  inputGroup: { marginBottom: 16 },
  inputLabel: { color: Theme.textMuted, fontSize: 10, fontFamily: Fonts.black, marginBottom: 8, letterSpacing: 0.5 },
  inputHelper: { fontSize: 11, color: Theme.textSecondary, fontFamily: Fonts.medium, marginTop: 4 },
  sheetInput: { 
    height: 50, backgroundColor: Theme.bgInput, borderRadius: 10, color: Theme.textPrimary, 
    paddingHorizontal: 16, fontSize: 14, fontFamily: Fonts.bold, borderWidth: 1, borderColor: Theme.border,
    ...Platform.select({ web: { outlineStyle: "none" } as any })
  },
  
  // Payment methods selection
  methodGroup: { flexDirection: "row", gap: 10 },
  methodToggle: { flex: 1, height: 44, borderRadius: 10, backgroundColor: Theme.bgInput, borderWidth: 1, borderColor: Theme.border, justifyContent: "center", alignItems: "center" },
  activeMethodToggle: { backgroundColor: Theme.primary + "15", borderColor: Theme.primary },
  methodToggleText: { fontFamily: Fonts.bold, color: Theme.textSecondary, fontSize: 13 },
  activeMethodToggleText: { color: Theme.primary },
  
  // Allocation toggle selection
  allocToggle: { flex: 1, height: 44, borderRadius: 10, backgroundColor: Theme.bgInput, borderWidth: 1, borderColor: Theme.border, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6 },
  activeAllocToggle: { backgroundColor: Theme.primary, borderColor: Theme.primary },
  allocToggleText: { fontFamily: Fonts.bold, color: Theme.textSecondary, fontSize: 12 },
  activeAllocToggleText: { color: "#FFF" },

  // Manual allocation table
  manualAllocBlock: { marginTop: 10, borderTopWidth: 1, borderTopColor: Theme.border, paddingTop: 14 },
  manualAllocTitle: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary, marginBottom: 8 },
  liveAllocSummary: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12, backgroundColor: Theme.bgInput, padding: 10, borderRadius: 8 },
  liveAllocText: { fontSize: 12, fontFamily: Fonts.medium, color: Theme.textSecondary },
  manualAllocRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Theme.border },
  manualRowBillNo: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary },
  manualRowBillDue: { fontSize: 11, fontFamily: Fonts.medium, color: Theme.textSecondary, marginTop: 2 },
  
  cashInputBox: { 
    flexDirection: "row", alignItems: "center", height: 48, 
    borderRadius: 8, backgroundColor: Theme.bgInput, borderWidth: 1, borderColor: Theme.border,
    paddingHorizontal: 12, marginVertical: 8 
  },
  currencyPrefix: { fontSize: 16, fontFamily: Fonts.bold, color: Theme.textSecondary, marginRight: 4 },
  cashInput: { flex: 1, fontSize: 16, fontFamily: Fonts.bold, color: Theme.textPrimary, padding: 0, ...Platform.select({ web: { outlineStyle: "none" } as any }) },

  // Button submits
  submitBtn: { backgroundColor: Theme.primary, height: 52, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 20, ...Theme.shadowMd },
  submitBtnText: { color: "#fff", fontFamily: Fonts.black, fontSize: 14 },

  centerBlock: { flex: 1, justifyContent: "center", alignItems: "center", paddingVertical: 40 },
  emptyText: { fontFamily: Fonts.medium, fontSize: 14, color: Theme.textMuted, marginTop: 10 },

  // New CRUD modals styling
  formSheet: { backgroundColor: Theme.bgCard, borderRadius: 24, width: '100%', maxWidth: 500, maxHeight: '90%', flexShrink: 1, overflow: 'hidden', ...Theme.shadowLg },
  countrySelector: { width: 70, height: 50, borderRadius: 10, backgroundColor: Theme.bgInput, borderWidth: 1, borderColor: Theme.border, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 4 },
  countrySelectorText: { fontSize: 14, fontFamily: Fonts.bold, color: Theme.textPrimary },
  statusToggle: { flex: 1, height: 50, borderRadius: 12, backgroundColor: Theme.bgInput, borderWidth: 1, borderColor: Theme.border, justifyContent: "center", alignItems: "center" },
  activeToggle: { backgroundColor: Theme.success + '15', borderColor: Theme.success },
  inactiveToggle: { backgroundColor: Theme.danger + '15', borderColor: Theme.danger },
  statusText: { fontSize: 14, fontFamily: Fonts.bold, color: Theme.textSecondary },
  activeStatusText: { color: Theme.success },
  inactiveStatusText: { color: Theme.danger },
  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center" },
  alertCard: { width: '100%', maxWidth: 360, backgroundColor: Theme.bgCard, borderRadius: 24, padding: 30, alignItems: 'center', borderWidth: 1, borderColor: Theme.border, ...Theme.shadowLg },
  alertIconBg: { width: 80, height: 80, borderRadius: 40, backgroundColor: Theme.danger + '15', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  alertTitle: { fontSize: 20, fontFamily: Fonts.black, color: Theme.textPrimary, marginBottom: 10 },
  alertMessage: { fontSize: 14, fontFamily: Fonts.medium, color: Theme.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 25 },
  alertActions: { flexDirection: 'row', gap: 12, width: '100%' },
  alertBtn: { flex: 1, height: 50, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
  cancelBtn: { backgroundColor: Theme.bgMuted, borderWidth: 1, borderColor: Theme.border },
  confirmDeleteBtn: { backgroundColor: Theme.danger },
  btnLabel: { fontSize: 14, fontFamily: Fonts.bold, color: Theme.textPrimary }
});
