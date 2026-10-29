import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Modal,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Theme } from "@/constants/theme";
import { useAuthStore } from "@/stores/authStore";
import { API_URL } from "@/constants/Config";
import { formatToSingaporeTime } from "../utils/timezoneHelper";

interface Message {
  id: string;
  sender: "USER" | "ASSISTANT";
  text: string;
  visuals?: {
    type: "bar" | "pie";
    data: any[];
    keys: string[];
  } | null;
  structuredData?: any;
  intent?: string;
  timestamp: Date;
}

const QUICK_PROMPTS = [
  { text: "Sales Report", icon: "bar-chart-outline", type: "Sales", emoji: "📊" },
  { text: "Top Menu Items", icon: "restaurant-outline", type: "Top Items", emoji: "🏆" },
  { text: "Unsold / Slow Items", icon: "trending-down-outline", type: "Unsold Items", emoji: "📉" },
  { text: "Staff Performance", icon: "people-outline", type: "Staff", emoji: "👤" },
  { text: "Discount Analysis", icon: "pricetag-outline", type: "Discounts", emoji: "🎟️" },
  { text: "Cancelled Orders", icon: "close-circle-outline", type: "Cancelled", emoji: "❌" },
  { text: "Void Items", icon: "trash-outline", type: "Void", emoji: "🗑️" },
  { text: "Payment", icon: "card-outline", type: "Payments", emoji: "💳" },
];

export default function AIChatScreen() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const { width } = useWindowDimensions();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Filter popup modal states
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [activeReportType, setActiveReportType] = useState<string | null>(null);
  const [showCustomInputs, setShowCustomInputs] = useState(false);
  const [startDateInput, setStartDateInput] = useState("");
  const [endDateInput, setEndDateInput] = useState("");
  
  const flatListRef = useRef<FlatList>(null);

  const isTabletOrDesktop = width > 768;

  const getAiEndpoint = () => {
    // If API_URL is a hosted/production URL, always point directly to backend's integrated AI route
    if (!API_URL.includes("localhost") && !API_URL.includes("127.0.0.1") && !API_URL.includes("192.168.")) {
      return `${API_URL}/api/ai/chat`;
    }

    try {
      const Constants = require("expo-constants").default;
      const hostUri = Constants.expoConfig?.hostUri || Constants.manifest?.debuggerHost;
      if (hostUri) {
        const hostIp = hostUri.split(":")[0];
        if (hostIp && hostIp !== "localhost" && hostIp !== "127.0.0.1") {
          console.log(`📱 Dynamic AI service host IP resolved (dev): ${hostIp}`);
          return `http://${hostIp}:3000/api/ai/chat`;
        }
      }
    } catch (e) {
      console.warn("Could not resolve host URI via expo-constants:", e);
    }

    return `${API_URL}/api/ai/chat`;
  };

  useEffect(() => {
    setMessages([
      {
        id: "welcome",
        sender: "ASSISTANT",
        text: "👋 Welcome to your Enterprise AI BI Dashboard. I can dynamically fetch and analyze restaurant sales, staff productivity, and customer purchase trends. Click a report category below to start.",
        timestamp: new Date(),
      },
    ]);
  }, []);

  const handleSendMessage = async (textToSend: string) => {
    const text = textToSend.trim();
    if (!text) return;

    setInputText("");
    const userMsgId = Date.now().toString();
    const userMsg: Message = {
      id: userMsgId,
      sender: "USER",
      text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const response = await fetch(getAiEndpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          sessionId: sessionId,
        }),
      });

      const data = await response.json();
      
      if (data.sessionId) {
        setSessionId(data.sessionId);
      }

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: "ASSISTANT",
        text: data.answer || "No response details generated.",
        visuals: data.visuals,
        structuredData: data.insights?.keyFindings,
        intent: data.intent,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (error: any) {
      console.error("❌ AI Service connection error:", error);
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: "ASSISTANT",
        text: "⚠️ Connection to AI BI Assistant service failed. Make sure the backend service is running.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 250);
    }
  };

  const handleQuickPromptClick = (type: string) => {
    setActiveReportType(type);
    setStartDateInput("");
    setEndDateInput("");
    setShowCustomInputs(false);
    setFilterModalVisible(true);
  };

  const handleFilterSelect = (period: string) => {
    setFilterModalVisible(false);
    setShowCustomInputs(false);
    
    let prompt = "";
    if (activeReportType === "Sales") {
      prompt = `Show sales metrics for the past ${period}`;
    } else if (activeReportType === "Top Items") {
      prompt = `Show top 5 menu items for the past ${period}`;
    } else if (activeReportType === "Staff") {
      prompt = `Show staff performance for the past ${period}`;
    } else if (activeReportType === "Discounts") {
      prompt = `Show discount analysis for the past ${period}`;
    } else if (activeReportType === "Cancelled") {
      prompt = `Show cancelled orders for the past ${period}`;
    } else if (activeReportType === "Void") {
      prompt = `Show voided and refunded orders for the past ${period}`;
    } else if (activeReportType === "Unsold Items") {
      prompt = `Show unsold items for the past ${period}`;
    } else if (activeReportType === "Tax") {
      prompt = `Show tax and GST report for the past ${period}`;
    } else if (activeReportType === "Payments") {
      prompt = `Show payment methods analysis for the past ${period}`;
    }
    
    handleSendMessage(prompt);
  };

  const handleCustomConfirm = () => {
    if (!startDateInput || !endDateInput) return;
    setFilterModalVisible(false);
    setShowCustomInputs(false);

    let prompt = "";
    if (activeReportType === "Sales") {
      prompt = `Show sales metrics from ${startDateInput} to ${endDateInput}`;
    } else if (activeReportType === "Top Items") {
      prompt = `Show top 5 menu items from ${startDateInput} to ${endDateInput}`;
    } else if (activeReportType === "Staff") {
      prompt = `Show staff performance from ${startDateInput} to ${endDateInput}`;
    } else if (activeReportType === "Discounts") {
      prompt = `Show discount analysis from ${startDateInput} to ${endDateInput}`;
    } else if (activeReportType === "Cancelled") {
      prompt = `Show cancelled orders from ${startDateInput} to ${endDateInput}`;
    } else if (activeReportType === "Void") {
      prompt = `Show voided and refunded orders from ${startDateInput} to ${endDateInput}`;
    } else if (activeReportType === "Unsold Items") {
      prompt = `Show unsold items from ${startDateInput} to ${endDateInput}`;
    } else if (activeReportType === "Tax") {
      prompt = `Show tax and GST report from ${startDateInput} to ${endDateInput}`;
    } else if (activeReportType === "Payments") {
      prompt = `Show payment methods analysis from ${startDateInput} to ${endDateInput}`;
    }

    handleSendMessage(prompt);
  };

  const renderDashboardVisuals = (visuals: any) => {
    if (!visuals || !visuals.data || visuals.data.length === 0) return null;

    try {
      if (visuals.type === "bar" || visuals.type === "pie") {
        const maxValue = Math.max(...visuals.data.map((item: any) => item.revenue || item.quantity || item.value || 1));
        const isMobile = width < 480;
        
        return (
          <View style={[styles.dashboardCard, isMobile && { padding: 8, marginTop: 10 }]}>
            <View style={styles.cardHeaderRow}>
              <Ionicons name="stats-chart" size={isMobile ? 12 : 16} color={Theme.primary} />
              <Text style={[styles.cardHeaderTitle, isMobile && { fontSize: 9 }]}>Visual Analytics Breakdown</Text>
            </View>
            
            <View style={styles.barListContainer}>
              {visuals.data.map((item: any, idx: number) => {
                const val = item.revenue || item.quantity || item.value || 0;
                const percentage = maxValue > 0 ? (val / maxValue) * 100 : 0;
                const color = idx % 2 === 0 ? Theme.primary : Theme.info;
                
                return (
                  <View key={idx} style={styles.barRow}>
                    <View style={styles.barLabelRow}>
                      <Text style={[styles.barLabelText, isMobile && { fontSize: 10 }]} numberOfLines={1}>
                        {item.name || item.item_name || item.staff_name || "Detail"}
                      </Text>
                      <Text style={[styles.barValueText, isMobile && { fontSize: 10 }]}>
                        {item.revenue ? `SGD ${Number(val).toFixed(2)}` : val}
                      </Text>
                    </View>
                    <View style={styles.barBg}>
                      <View style={[styles.barFill, { width: `${percentage}%`, backgroundColor: color }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        );
      }
    } catch (err) {
      console.warn("Analytics rendering error:", err);
    }
    return null;
  };

  const renderKPIGrid = (item: Message) => {
    const data = Array.isArray(item.structuredData) ? item.structuredData[0] : item.structuredData;
    if (!data || typeof data !== 'object') return null;

    const isSales = (data.TotalRevenue !== undefined || data.TotalOrders !== undefined) &&
                    data.item_name === undefined &&
                    data.staff_name === undefined &&
                    data.mode === undefined;

    const isDiscount = data.DiscountedBills !== undefined || data.TotalDiscountGiven !== undefined;

    const isMobile = width < 480;

    if (isSales) {
      return (
        <View style={styles.kpiContainer}>
          <View style={[styles.kpiCard, isMobile && { minWidth: '47%', padding: 6 }]}>
            <View style={[styles.kpiIconWrapper, { backgroundColor: Theme.success + "15" }, isMobile && { width: 22, height: 22, marginBottom: 4 }]}>
              <Ionicons name="cash-outline" size={isMobile ? 12 : 18} color={Theme.success} />
            </View>
            <Text style={styles.kpiLabel}>Revenue</Text>
            <Text style={[styles.kpiValue, isMobile && { fontSize: 10 }]} numberOfLines={1} adjustsFontSizeToFit>SGD {Number(data.TotalRevenue || 0).toFixed(2)}</Text>
          </View>
          
          <View style={[styles.kpiCard, isMobile && { minWidth: '47%', padding: 6 }]}>
            <View style={[styles.kpiIconWrapper, { backgroundColor: Theme.primary + "15" }, isMobile && { width: 22, height: 22, marginBottom: 4 }]}>
              <Ionicons name="receipt-outline" size={isMobile ? 12 : 18} color={Theme.primary} />
            </View>
            <Text style={styles.kpiLabel}>Bills Count</Text>
            <Text style={[styles.kpiValue, isMobile && { fontSize: 10 }]} numberOfLines={1} adjustsFontSizeToFit>{data.TotalOrders || 0}</Text>
          </View>

          <View style={[styles.kpiCard, isMobile && { minWidth: '47%', padding: 6 }]}>
            <View style={[styles.kpiIconWrapper, { backgroundColor: Theme.info + "15" }, isMobile && { width: 22, height: 22, marginBottom: 4 }]}>
              <Ionicons name="analytics-outline" size={isMobile ? 12 : 18} color={Theme.info} />
            </View>
            <Text style={styles.kpiLabel}>Avg Ticket</Text>
            <Text style={[styles.kpiValue, isMobile && { fontSize: 10 }]} numberOfLines={1} adjustsFontSizeToFit>SGD {Number(data.AvgTicketSize || 0).toFixed(2)}</Text>
          </View>

          <View style={[styles.kpiCard, isMobile && { minWidth: '47%', padding: 6 }]}>
            <View style={[styles.kpiIconWrapper, { backgroundColor: Theme.warning + "15" }, isMobile && { width: 22, height: 22, marginBottom: 4 }]}>
              <Ionicons name="pricetag-outline" size={isMobile ? 12 : 18} color={Theme.warning} />
            </View>
            <Text style={styles.kpiLabel}>Discounts</Text>
            <Text style={[styles.kpiValue, isMobile && { fontSize: 10 }]} numberOfLines={1} adjustsFontSizeToFit>SGD {Number(data.TotalDiscount || 0).toFixed(2)}</Text>
          </View>
        </View>
      );
    }

    if (isDiscount) {
      return (
        <View style={styles.kpiContainer}>
          <View style={[styles.kpiCard, isMobile && { minWidth: '47%', padding: 8 }]}>
            <View style={[styles.kpiIconWrapper, { backgroundColor: Theme.warning + "15" }, isMobile && { width: 22, height: 22, marginBottom: 4 }]}>
              <Ionicons name="gift-outline" size={isMobile ? 12 : 18} color={Theme.warning} />
            </View>
            <Text style={styles.kpiLabel}>Total Discounts</Text>
            <Text style={[styles.kpiValue, isMobile && { fontSize: 11 }]} numberOfLines={1} adjustsFontSizeToFit>SGD {Number(data.TotalDiscountGiven || 0).toFixed(2)}</Text>
          </View>

          <View style={[styles.kpiCard, isMobile && { minWidth: '47%', padding: 8 }]}>
            <View style={[styles.kpiIconWrapper, { backgroundColor: Theme.primary + "15" }, isMobile && { width: 22, height: 22, marginBottom: 4 }]}>
              <Ionicons name="ticket-outline" size={isMobile ? 12 : 18} color={Theme.primary} />
            </View>
            <Text style={styles.kpiLabel}>Discounted Bills</Text>
            <Text style={[styles.kpiValue, isMobile && { fontSize: 11 }]} numberOfLines={1} adjustsFontSizeToFit>{data.DiscountedBills || 0}</Text>
          </View>
        </View>
      );
    }

    return null;
  };

  const renderPaymentBreakdown = (item: Message) => {
    const rawList = Array.isArray(item.structuredData) ? item.structuredData : [];
    if (rawList.length === 0) return null;

    // Define standard groups
    const paymentGroups = {
      CASH: { name: "Cash", amount: 0, count: 0 },
      PAYNOW: { name: "PayNow", amount: 0, count: 0 },
      NETS: { name: "NETS", amount: 0, count: 0 },
      MEMBER: { name: "Member", amount: 0, count: 0 },
      UPI: { name: "UPI", amount: 0, count: 0 },
      CARD: { name: "Card", amount: 0, count: 0 },
      FOC: { name: "FOC", amount: 0, count: 0 },
      OTHER: { name: "Other payment methods", amount: 0, count: 0 },
    };

    let grandTotalAmount = 0;
    let grandTotalCount = 0;

    rawList.forEach((row: any) => {
      const mode = String(row.mode || row.PayMode || "").toUpperCase().trim();
      const amount = Number(row.TotalRevenue || row.Amount || row.SysAmount || 0);
      const count = Number(row.TotalBills || row.ReceiptCount || 0);

      grandTotalAmount += amount;
      grandTotalCount += count;

      if (mode.includes("CASH")) {
        paymentGroups.CASH.amount += amount;
        paymentGroups.CASH.count += count;
      } else if (mode.includes("FOC")) {
        paymentGroups.FOC.amount += amount;
        paymentGroups.FOC.count += count;
      } else if (mode.includes("PAYNOW")) {
        paymentGroups.PAYNOW.amount += amount;
        paymentGroups.PAYNOW.count += count;
      } else if (mode.includes("NETS")) {
        paymentGroups.NETS.amount += amount;
        paymentGroups.NETS.count += count;
      } else if (mode.includes("MEMBER")) {
        paymentGroups.MEMBER.amount += amount;
        paymentGroups.MEMBER.count += count;
      } else if (mode.includes("UPI")) {
        paymentGroups.UPI.amount += amount;
        paymentGroups.UPI.count += count;
      } else if (
        mode.includes("CARD") ||
        mode.includes("CREDIT") ||
        mode.includes("DEBIT") ||
        mode.includes("VISA") ||
        mode.includes("MASTER")
      ) {
        paymentGroups.CARD.amount += amount;
        paymentGroups.CARD.count += count;
      } else {
        paymentGroups.OTHER.amount += amount;
        paymentGroups.OTHER.count += count;
      }
    });

    const displayRows = Object.values(paymentGroups)
      .map((group) => {
        const percentage = grandTotalAmount > 0 ? (group.amount / grandTotalAmount) * 100 : 0;
        return {
          ...group,
          percentage,
        };
      })
      .sort((a, b) => b.amount - a.amount); // Show highest revenue first

    const isMobile = width < 480;

    return (
      <View style={[styles.paymentCard, isMobile && { padding: 6 }]}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="card" size={12} color={Theme.primary} />
          <Text style={[styles.cardHeaderTitle, isMobile && { fontSize: 9 }]}>Payment Sales Breakdown</Text>
        </View>

        {/* Table Header */}
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.tableHeaderCell, { flex: isMobile ? 1.5 : 2 }, isMobile && { fontSize: 9 }]}>Method</Text>
          <Text style={[styles.tableHeaderCell, { flex: 0.8, textAlign: "right" }, isMobile && { fontSize: 9 }]}>Bills</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.5, textAlign: "right" }, isMobile && { fontSize: 9 }]}>Amount</Text>
          <Text style={[styles.tableHeaderCell, { flex: 1.2, textAlign: "right" }, isMobile && { fontSize: 9 }]}>Contrib</Text>
        </View>

        {/* Rows */}
        {displayRows.map((row, index) => {
          if (row.amount === 0 && row.count === 0) return null; // Hide empty payment modes
          return (
            <View key={index} style={[styles.tableRow, index % 2 === 1 && styles.tableRowAlt]}>
              <Text style={[styles.tableCellText, { flex: isMobile ? 1.5 : 2, fontWeight: "700" }, isMobile && { fontSize: 9 }]}>{row.name}</Text>
              <Text style={[styles.tableCellText, { flex: 0.8, textAlign: "right" }, isMobile && { fontSize: 9 }]}>{row.count}</Text>
              <Text style={[styles.tableCellText, { flex: 1.5, textAlign: "right", color: Theme.success, fontWeight: "700" }, isMobile && { fontSize: 9 }]}>
                SGD {row.amount.toFixed(2)}
              </Text>
              <Text style={[styles.tableCellText, { flex: 1.2, textAlign: "right", fontWeight: "800", color: Theme.primary }, isMobile && { fontSize: 9 }]}>
                {row.percentage.toFixed(1)}%
              </Text>
            </View>
          );
        })}

        {/* Summary Footer */}
        <View style={styles.tableSummaryRow}>
          <Text style={[styles.tableSummaryText, { flex: isMobile ? 1.5 : 2 }, isMobile && { fontSize: 10 }]}>Total</Text>
          <Text style={[styles.tableSummaryText, { flex: 0.8, textAlign: "right" }, isMobile && { fontSize: 10 }]}>{grandTotalCount}</Text>
          <Text style={[styles.tableSummaryText, { flex: 1.5, textAlign: "right", color: Theme.success }, isMobile && { fontSize: 10 }]}>
            SGD {grandTotalAmount.toFixed(2)}
          </Text>
          <Text style={[styles.tableSummaryText, { flex: 1.2, textAlign: "right" }, isMobile && { fontSize: 10 }]}>100%</Text>
        </View>
      </View>
    );
  };

  const renderMessageItem = ({ item }: { item: Message }) => {
    const isUser = item.sender === "USER";
    const isMobile = width < 480;
    return (
      <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
        {!isUser && (
          <View style={[styles.assistantAvatar, isMobile && { width: 20, height: 20, borderRadius: 10 }]}>
            <Ionicons name="sparkles" size={isMobile ? 10 : 14} color="#fff" />
          </View>
        )}
        <View style={[
          styles.bubble,
          isUser ? styles.userBubble : styles.assistantBubble,
          isMobile && { paddingHorizontal: 10, paddingVertical: 8 }
        ]}>
          <Text style={[styles.messageText, isUser ? styles.userText : styles.assistantText, isMobile && { fontSize: 12, lineHeight: 18 }]}>
            {item.text}
          </Text>

          {item.intent === "get_payment_distribution" && renderPaymentBreakdown(item)}
          {item.structuredData && item.intent !== "get_payment_distribution" && renderKPIGrid(item)}
          {item.visuals && renderDashboardVisuals(item.visuals)}

          <Text style={styles.timestamp}>
            {formatToSingaporeTime(item.timestamp)}
          </Text>
        </View>
      </View>
    );
  };
  const isMobile = width < 480;

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/category')}>
          <Ionicons name="arrow-back" size={24} color={Theme.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>AI Analytics Hub</Text>
          <View style={styles.statusRow}>
            <View style={styles.activeDot} />
            <Text style={styles.statusText}>Enterprise Cloud DB Replica Connected</Text>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1, width: "100%", maxWidth: isTabletOrDesktop ? 1000 : undefined, alignSelf: "center" }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        {/* Messages List */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessageItem}
          contentContainerStyle={[styles.listContent, isMobile && { padding: 8, gap: 12 }]}
          ListFooterComponent={
            loading ? (
              <View style={styles.loadingBubbleContainer}>
                <View style={[styles.assistantAvatar, isMobile && { width: 20, height: 20, borderRadius: 10 }]}>
                  <Ionicons name="sparkles" size={isMobile ? 10 : 14} color="#fff" />
                </View>
                <View style={[
                  styles.bubble,
                  styles.assistantBubble,
                  styles.loadingBubble,
                  isMobile && { paddingHorizontal: 10, paddingVertical: 8 }
                ]}>
                  <ActivityIndicator size="small" color={Theme.primary} />
                  <Text style={[styles.loadingText, isMobile && { fontSize: 11 }]}>Running secure dynamic analysis...</Text>
                </View>
              </View>
            ) : null
          }
        />

        {/* Quick Prompts with Responsive Layout */}
        <View style={[styles.quickPromptsWrapper, isMobile && { paddingVertical: 8 }]}>
          {isTabletOrDesktop ? (
            <View style={styles.quickPromptsDesktopRow}>
              {QUICK_PROMPTS.map((p, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={styles.promptBtn}
                  onPress={() => handleQuickPromptClick(p.type)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.promptEmoji}>{p.emoji}</Text>
                  <Text style={styles.promptBtnText}>{p.text}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.quickPromptsScroll, isMobile && { gap: 6, paddingHorizontal: 8 }]}
            >
              {QUICK_PROMPTS.map((p, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[styles.promptBtn, isMobile && { paddingHorizontal: 10, paddingVertical: 6, minWidth: 100 }]}
                  onPress={() => handleQuickPromptClick(p.type)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.promptEmoji}>{p.emoji}</Text>
                  <Text style={[styles.promptBtnText, isMobile && { fontSize: 10 }]}>{p.text}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Dynamic User Input Bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder="Type your custom analytical query..."
            placeholderTextColor="#868E96"
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={() => handleSendMessage(inputText)}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !inputText.trim() && styles.sendBtnDisabled]}
            onPress={() => handleSendMessage(inputText)}
            disabled={!inputText.trim()}
          >
            <Ionicons name="send" size={16} color="#fff" />
          </TouchableOpacity>
        </View>

      </KeyboardAvoidingView>

      {/* Filter Options Modal */}
      <Modal
        visible={filterModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setFilterModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setFilterModalVisible(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Set Analytics Scope: {activeReportType}</Text>
            
            <View style={styles.filterGrid}>
              {["1 Day", "3 Days", "5 Days", "10 Days", "15 Days", "20 Days", "30 Days"].map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={styles.filterBtn}
                  onPress={() => handleFilterSelect(opt)}
                >
                  <Text style={styles.filterBtnText}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={styles.closeModalBtn}
              onPress={() => {
                setFilterModalVisible(false);
                setShowCustomInputs(false);
              }}
            >
              <Text style={styles.closeModalBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8F9FA",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E9ECEF",
    backgroundColor: "#fff",
  },
  backBtn: {
    marginRight: 16,
    padding: 4,
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#212529",
    letterSpacing: -0.3,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#2B8A3E",
    marginRight: 6,
  },
  statusText: {
    fontSize: 10,
    color: "#868E96",
    fontWeight: "600",
  },
  listContent: {
    padding: 12,
    gap: 16,
  },
  // Row wrapper for each message — user rows right-align, assistant rows use full width
  messageRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    width: "100%",
  },
  userRow: {
    justifyContent: "flex-end",
  },
  assistantRow: {
    justifyContent: "flex-start",
    // Allow full-width so analytics cards get all available space
  },
  assistantAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#4C6EF5",
    alignItems: "center",
    justifyContent: "center",
  },
  bubble: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
  },
  userBubble: {
    backgroundColor: "#4C6EF5",
    borderColor: "#4C6EF5",
    borderBottomRightRadius: 2,
    maxWidth: "80%",        // User messages stay capped at 80%
  },
  assistantBubble: {
    backgroundColor: "#fff",
    borderColor: "#E9ECEF",
    borderBottomLeftRadius: 2,
    flex: 1,               // Assistant bubbles take up all remaining space in the row
    minWidth: 0,           // Allow flex to shrink below content width (RN web fix)
  },
  messageText: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "500",
  },
  userText: {
    color: "#fff",
  },
  assistantText: {
    color: "#343A40",
  },
  timestamp: {
    fontSize: 9,
    color: "#ADB5BD",
    alignSelf: "flex-end",
    marginTop: 6,
  },
  loadingBubbleContainer: {
    flexDirection: "row",
    alignSelf: "flex-start",
    gap: 8,
    width: "100%",
  },
  loadingBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  loadingText: {
    fontSize: 12,
    color: "#868E96",
  },
  quickPromptsWrapper: {
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: "#E9ECEF",
    backgroundColor: "#fff",
    alignItems: "center",
  },
  quickPromptsDesktopRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 12,
    width: "100%",
    paddingHorizontal: 24,
  },
  quickPromptsScroll: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
  },
  promptBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5DBFF",
    backgroundColor: "#F3F0FF",
    minWidth: 120,
  },
  promptBtnWide: {
    minWidth: 140,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  promptEmoji: {
    fontSize: 14,
    marginRight: 6,
  },
  promptBtnText: {
    fontSize: 11,
    color: "#7048E8",
    fontWeight: "700",
  },
  inputBar: {
    flexDirection: "row",
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "#E9ECEF",
    backgroundColor: "#fff",
    gap: 8,
  },
  input: {
    flex: 1,
    height: 40,
    backgroundColor: "#F1F3F5",
    borderRadius: 8,
    paddingHorizontal: 16,
    fontSize: 13,
    color: "#212529",
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: "#4C6EF5",
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: {
    backgroundColor: "#CED4DA",
  },
  dashboardCard: {
    marginTop: 14,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E9ECEF",
    padding: 12,
    width: "100%",
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F3F5",
    paddingBottom: 8,
    marginBottom: 10,
  },
  cardHeaderTitle: {
    fontSize: 11,
    fontWeight: "800",
    color: "#495057",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  barListContainer: {
    gap: 10,
  },
  barRow: {
    width: "100%",
  },
  barLabelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  barLabelText: {
    fontSize: 11,
    color: "#495057",
    fontWeight: "700",
  },
  barValueText: {
    fontSize: 11,
    color: "#212529",
    fontWeight: "800",
  },
  barBg: {
    height: 6,
    backgroundColor: "#F1F3F5",
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 3,
  },
  kpiContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
    width: "100%",
  },
  kpiCard: {
    flex: 1,
    minWidth: 110,
    backgroundColor: "#F8F9FA",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E9ECEF",
    padding: 10,
  },
  kpiIconWrapper: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  kpiLabel: {
    fontSize: 10,
    color: "#868E96",
    fontWeight: "600",
    marginBottom: 2,
  },
  kpiValue: {
    fontSize: 12,
    color: "#212529",
    fontWeight: "800",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(33, 37, 41, 0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E9ECEF",
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#212529",
    marginBottom: 16,
    textAlign: "center",
  },
  filterGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
    width: "100%",
  },
  filterBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: "#F1F3F5",
    borderWidth: 1,
    borderColor: "#E9ECEF",
    minWidth: 70,
    alignItems: "center",
  },
  filterBtnText: {
    fontSize: 11,
    color: "#495057",
    fontWeight: "700",
  },
  customRangeBtn: {
    backgroundColor: "#E8F0FE",
    borderColor: "#D2E3FC",
    minWidth: 150,
  },
  customRangeBtnText: {
    fontSize: 11,
    color: "#1A73E8",
    fontWeight: "800",
  },
  customDateContainer: {
    marginTop: 16,
    width: "100%",
    gap: 8,
  },
  dateInput: {
    width: "100%",
    height: 38,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#CED4DA",
    paddingHorizontal: 12,
    color: "#212529",
    fontSize: 12,
    backgroundColor: "#F8F9FA",
  },
  confirmBtn: {
    width: "100%",
    height: 38,
    borderRadius: 6,
    backgroundColor: "#4C6EF5",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  confirmBtnText: {
    color: "white",
    fontSize: 12,
    fontWeight: "800",
  },
  closeModalBtn: {
    marginTop: 16,
    paddingVertical: 10,
    width: "100%",
    alignItems: "center",
    borderRadius: 6,
    backgroundColor: "#F1F3F5",
  },
  closeModalBtnText: {
    color: "#495057",
    fontSize: 13,
    fontWeight: "700",
  },
  paymentCard: {
    marginTop: 14,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E9ECEF",
    padding: 12,
    width: "100%",
  },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 2,
    borderBottomColor: "#E9ECEF",
    paddingBottom: 6,
    marginBottom: 6,
  },
  tableHeaderCell: {
    fontSize: 11,
    fontWeight: "800",
    color: "#495057",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F3F5",
    alignItems: "center",
  },
  tableRowAlt: {
    backgroundColor: "#F8F9FA",
  },
  tableCellText: {
    fontSize: 11,
    color: "#343A40",
  },
  tableSummaryRow: {
    flexDirection: "row",
    borderTopWidth: 2,
    borderTopColor: "#CED4DA",
    paddingTop: 8,
    marginTop: 6,
    alignItems: "center",
  },
  tableSummaryText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#212529",
  },
});
