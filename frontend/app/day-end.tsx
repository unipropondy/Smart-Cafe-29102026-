import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  ActivityIndicator,
  Alert,
  StatusBar,
  Platform,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Theme } from "@/constants/theme";
import { Fonts } from "@/constants/Fonts";
import { API_URL } from "@/constants/Config";
import { useAuthStore } from "@/stores/authStore";
import CalendarPicker from "../components/CalendarPicker";
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  startOfYear, 
  endOfYear,
  subDays 
} from "date-fns";
import { getSingaporeDate, getSingaporeDateString } from "../utils/timezoneHelper";

function parseLocalDate(dateStr: string): Date {
  const parts = dateStr.split("-");
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
}


export default function DayEndScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<"DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | "CUSTOM">("DAILY");
  const [dateRange, setDateRange] = useState({
    start: getSingaporeDateString(),
    end: getSingaporeDateString(),
  });

  useEffect(() => {
    fetchDaySummary();
    
    // Auto-update date if the day changes while the app is open
    const interval = setInterval(() => {
      const now = getSingaporeDateString();
      if (now !== dateRange.start && selectedFilter === "DAILY") {
        setDateRange({ start: now, end: now });
      }
    }, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [dateRange, selectedFilter]);

  const fetchDaySummary = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/sales/day-end-summary?startDate=${dateRange.start}&endDate=${dateRange.end}`);
      const json = await res.json();
      if (json.success) {
        setData(json);
      }
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to fetch summary");
    } finally {
      setLoading(false);
    }
  };

  const [showCalendar, setShowCalendar] = useState(false);
  const [isRangeMode, setIsRangeMode] = useState(false);
  const [tempRange, setTempRange] = useState({ start: "", end: "" });

  useEffect(() => {
    if (showCalendar) {
      setTempRange({ start: dateRange.start, end: dateRange.end });
    }
  }, [showCalendar, dateRange]);

  const handleFilterChange = (filter: typeof selectedFilter) => {
    setSelectedFilter(filter);
    const today = getSingaporeDate();
    let start = today;
    let end = today;

    if (filter === "DAILY") {
      start = today;
      end = today;
    } else if (filter === "WEEKLY") {
      start = startOfWeek(today);
      end = endOfWeek(today);
    } else if (filter === "MONTHLY") {
      start = startOfMonth(today);
      end = endOfMonth(today);
    } else if (filter === "YEARLY") {
      start = startOfYear(today);
      end = endOfYear(today);
    }

    if (filter !== "CUSTOM") {
      setDateRange({
        start: format(start, "yyyy-MM-dd"),
        end: format(end, "yyyy-MM-dd"),
      });
    }
  };

  const changeDate = (amount: number) => {
    const currentStart = parseLocalDate(dateRange.start);
    let newStart = currentStart;
    let newEnd = currentStart;

    if (selectedFilter === "DAILY") {
      newStart.setDate(newStart.getDate() + amount);
      newEnd = new Date(newStart);
    } else if (selectedFilter === "WEEKLY") {
      newStart.setDate(newStart.getDate() + (amount * 7));
      newStart = startOfWeek(newStart);
      newEnd = endOfWeek(newStart);
    } else if (selectedFilter === "MONTHLY") {
      newStart.setMonth(newStart.getMonth() + amount);
      newStart = startOfMonth(newStart);
      newEnd = endOfMonth(newStart);
    } else if (selectedFilter === "YEARLY") {
      newStart.setFullYear(newStart.getFullYear() + amount);
      newStart = startOfYear(newStart);
      newEnd = endOfYear(newStart);
    }

    setDateRange({
      start: format(newStart, "yyyy-MM-dd"),
      end: format(newEnd, "yyyy-MM-dd"),
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const executeDayEnd = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/settlement/day-end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: user?.userName || "admin"
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        // Clear selected business date from AsyncStorage to reset
        await AsyncStorage.removeItem("selected_business_date");
        if (Platform.OS === 'web') {
          alert("Day ended successfully. Report generated.");
          router.replace("/(tabs)/category"); // Go back to Category
        } else {
          Alert.alert("Success", "Day ended successfully. Report generated.", [
            {
              text: "OK",
              onPress: () => {
                router.replace("/(tabs)/category"); // Go back to Category
              }
            }
          ]);
        }
      } else {
        if (Platform.OS === 'web') {
          alert(data.error || "Failed to complete Day End.");
        } else {
          Alert.alert("Error", data.error || "Failed to complete Day End.");
        }
      }
    } catch (err) {
      console.error("Day End Error:", err);
      if (Platform.OS === 'web') {
        alert("Network error while completing Day End.");
      } else {
        Alert.alert("Error", "Network error while completing Day End.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDayEnd = () => {
    setShowConfirmModal(true);
  };

  if (loading) {
    return (
      <View style={[styles.container, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator size="large" color={Theme.primary} />
        <Text style={{ marginTop: 10, fontFamily: Fonts.medium, color: Theme.textSecondary }}>Fetching Summary...</Text>
      </View>
    );
  }

  const analysis = data?.salesAnalysis;
  const paymodes = data?.paymodeDetail || [];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.replace("/(tabs)/category" as any)} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={Theme.textPrimary} />
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.headerTitle}>Day End Report</Text>
            {(data?.terminalCode || data?.refNo) && (
              <Text style={styles.headerSubtitle}>
                {data.terminalCode ? `Terminal: ${data.terminalCode}` : ""}
                {data.terminalCode && data.refNo ? "  •  " : ""}
                {data.refNo ? `Ref: ${data.refNo}` : ""}
              </Text>
            )}
          </View>
          <View style={{ width: 44 }} />
        </View>

        <View style={styles.filterContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
            {(["DAILY", "WEEKLY", "MONTHLY", "YEARLY", "CUSTOM"] as const).map((f) => (
              <TouchableOpacity
                key={f}
                style={[styles.filterBtn, selectedFilter === f && styles.filterBtnActive]}
                onPress={() => handleFilterChange(f)}
              >
                <Text style={[styles.filterBtnText, selectedFilter === f && styles.filterBtnTextActive]}>
                  {f}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {selectedFilter === "CUSTOM" && (
            <View style={styles.customDateContainer}>
              <TouchableOpacity style={styles.dateInput} onPress={() => setShowCalendar(true)}>
                <Text style={styles.dateInputLabel}>From:</Text>
                <Text style={styles.dateInputValue}>{dateRange.start}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dateInput} onPress={() => setShowCalendar(true)}>
                <Text style={styles.dateInputLabel}>To:</Text>
                <Text style={styles.dateInputValue}>{dateRange.end}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Date Navigation / Display */}
          {selectedFilter !== "CUSTOM" ? (
            <View style={styles.dateControl}>
              <TouchableOpacity onPress={() => changeDate(-1)} style={styles.navBtn}>
                <Ionicons name="chevron-back" size={20} color={Theme.textPrimary} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  setIsRangeMode(false);
                  setShowCalendar(true);
                }}
                style={styles.dateDisplay}
              >
                <Text style={styles.dateText}>
                  {dateRange.start === dateRange.end 
                    ? format(parseLocalDate(dateRange.start), "dd MMM yyyy")
                    : `${format(parseLocalDate(dateRange.start), "dd MMM")} - ${format(parseLocalDate(dateRange.end), "dd MMM yyyy")}`
                  }
                </Text>
                <Ionicons
                  name="calendar-outline"
                  size={16}
                  color={Theme.primary}
                  style={{ marginLeft: 8 }}
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => changeDate(1)} style={styles.navBtn}>
                <Ionicons
                  name="chevron-forward"
                  size={20}
                  color={Theme.textPrimary}
                />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.dateDisplayContainer}>
              <Ionicons name="calendar-outline" size={16} color={Theme.textSecondary} />
              <Text style={styles.dateDisplayText}>
                {`${format(parseLocalDate(dateRange.start), "dd MMM")} - ${format(parseLocalDate(dateRange.end), "dd MMM yyyy")}`}
              </Text>
            </View>
          )}

          {showCalendar && tempRange.start ? (
            <Modal
              visible={showCalendar}
              transparent={true}
              animationType="fade"
              onRequestClose={() => setShowCalendar(false)}
            >
              <TouchableOpacity 
                style={{
                  flex: 1,
                  backgroundColor: "rgba(0,0,0,0.5)",
                  justifyContent: "center",
                  alignItems: "center",
                  padding: 20
                }}
                activeOpacity={1}
                onPress={() => setShowCalendar(false)}
              >
                <TouchableOpacity 
                  activeOpacity={1} 
                  style={{
                    width: "100%",
                    maxWidth: 400,
                    backgroundColor: Theme.bgCard,
                    borderRadius: 20,
                    overflow: "hidden"
                  }}
                >
                  <CalendarPicker
                    selectedDate={tempRange.start}
                    onDateChange={(date) => {
                      if (selectedFilter !== "CUSTOM") {
                        const clicked = parseLocalDate(date);
                        let start = clicked;
                        let end = clicked;
                        if (selectedFilter === "DAILY") {
                          start = clicked;
                          end = clicked;
                        } else if (selectedFilter === "WEEKLY") {
                          start = startOfWeek(clicked);
                          end = endOfWeek(clicked);
                        } else if (selectedFilter === "MONTHLY") {
                          start = startOfMonth(clicked);
                          end = endOfMonth(clicked);
                        } else if (selectedFilter === "YEARLY") {
                          start = startOfYear(clicked);
                          end = endOfYear(clicked);
                        }
                        setDateRange({
                          start: format(start, "yyyy-MM-dd"),
                          end: format(end, "yyyy-MM-dd"),
                        });
                        setShowCalendar(false);
                      } else {
                        setTempRange({ start: date, end: date });
                      }
                    }}
                    isRangeMode={isRangeMode}
                    rangeStart={tempRange.start}
                    rangeEnd={tempRange.end}
                    onRangeChange={(start, end) => {
                      setTempRange({ start, end });
                    }}
                    onModeChange={selectedFilter === "CUSTOM" ? undefined : (mode) => setIsRangeMode(mode)}
                  />
                  
                  {/* Confirm Button */}
                  <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: Theme.border, backgroundColor: Theme.bgCard }}>
                    <TouchableOpacity
                      style={{
                        backgroundColor: Theme.primary,
                        borderRadius: 12,
                        height: 48,
                        justifyContent: "center",
                        alignItems: "center",
                      }}
                      onPress={() => {
                        if (tempRange.start) {
                          setDateRange({
                            start: tempRange.start,
                            end: tempRange.end || tempRange.start
                          });
                          setShowCalendar(false);
                        }
                      }}
                    >
                      <Text style={{ color: "#fff", fontFamily: Fonts.bold, fontSize: 15 }}>Confirm</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              </TouchableOpacity>
            </Modal>
          ) : null}

          {/* CUSTOM CONFIRM DAY END MODAL */}
          <Modal
            visible={showConfirmModal}
            transparent={true}
            animationType="fade"
            onRequestClose={() => setShowConfirmModal(false)}
          >
            <TouchableOpacity 
              style={{
                flex: 1,
                backgroundColor: "rgba(0,0,0,0.6)",
                justifyContent: "center",
                alignItems: "center",
                padding: 20
              }}
              activeOpacity={1}
              onPress={() => setShowConfirmModal(false)}
            >
              <TouchableWithoutFeedback>
                <View 
                  style={{
                    width: "100%",
                    maxWidth: 420,
                    backgroundColor: Theme.bgCard || "#ffffff",
                    borderRadius: 24,
                    padding: 24,
                    alignItems: "center",
                    shadowColor: "#000",
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.15,
                    shadowRadius: 12,
                    elevation: 5
                  }}
                >
                  <View style={{
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: "#fee2e2",
                    justifyContent: "center",
                    alignItems: "center",
                    marginBottom: 16
                  }}>
                    <Ionicons name="warning-outline" size={28} color="#ef4444" />
                  </View>

                  <Text style={{
                    fontFamily: Fonts.black,
                    fontSize: 20,
                    color: Theme.textPrimary || "#1c2d42",
                    marginBottom: 10,
                    textAlign: "center"
                  }}>
                    Confirm Day End
                  </Text>

                  <Text style={{
                    fontFamily: Fonts.medium,
                    fontSize: 14,
                    color: Theme.textSecondary || "#556e8a",
                    textAlign: "center",
                    lineHeight: 20,
                    marginBottom: 24
                  }}>
                    Are you sure you want to close the day? This will finalize all transactions and prepare for the next business day.
                  </Text>

                  <View style={{ flexDirection: "row", gap: 12, width: "100%" }}>
                    <TouchableOpacity
                      style={{
                        flex: 1,
                        height: 48,
                        borderRadius: 14,
                        backgroundColor: Theme.bgMuted || "#f1f5f9",
                        justifyContent: "center",
                        alignItems: "center"
                      }}
                      onPress={() => setShowConfirmModal(false)}
                    >
                      <Text style={{ fontFamily: Fonts.bold, fontSize: 15, color: Theme.textPrimary || "#1c2d42" }}>
                        Cancel
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={{
                        flex: 1,
                        height: 48,
                        borderRadius: 14,
                        backgroundColor: "#ef4444",
                        justifyContent: "center",
                        alignItems: "center"
                      }}
                      onPress={() => {
                        setShowConfirmModal(false);
                        executeDayEnd();
                      }}
                    >
                      <Text style={{ fontFamily: Fonts.bold, fontSize: 15, color: "#fff" }}>
                        Confirm
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </TouchableOpacity>
          </Modal>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {/* Main Stats Cards */}
          <View style={styles.statsGrid}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Total Sales</Text>
              <Text style={styles.statValue}>{formatCurrency(analysis?.totalSales || 0)}</Text>
            </View>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Total Bills</Text>
              <Text style={styles.statValue}>{analysis?.billCount || 0}</Text>
            </View>
          </View>

          {/* Paymode Detail Table */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <MaterialCommunityIcons name="credit-card-outline" size={20} color={Theme.primary} />
              <Text style={styles.sectionTitle}>Paymode Detail</Text>
            </View>
            
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderText, { flex: 2 }]}>Particulars</Text>
              <Text style={[styles.tableHeaderText, { flex: 1, textAlign: "center" }]}>Qty</Text>
              <Text style={[styles.tableHeaderText, { flex: 1.5, textAlign: "right" }]}>Amount</Text>
            </View>

            {paymodes.length > 0 ? (
              paymodes.map((pm: any, idx: number) => (
                <View key={idx} style={styles.tableRow}>
                  <Text style={[styles.tableCellText, { flex: 2, fontFamily: Fonts.bold }]}>{pm.Paymode}</Text>
                  <Text style={[styles.tableCellText, { flex: 1, textAlign: "center" }]}>{pm.Count}</Text>
                  <Text style={[styles.tableCellText, { flex: 1.5, textAlign: "right", color: Theme.success }]}>
                    {formatCurrency(pm.Amount)}
                  </Text>
                </View>
              ))
            ) : (
              <Text style={styles.emptyText}>No transactions yet</Text>
            )}
            
            <View style={styles.tableFooter}>
              <Text style={[styles.footerText, { flex: 2 }]}>Total</Text>
              <Text style={[styles.footerText, { flex: 1, textAlign: "center" }]}>
                {paymodes.reduce((acc: number, curr: any) => acc + curr.Count, 0)}
              </Text>
              <Text style={[styles.footerText, { flex: 1.5, textAlign: "right" }]}>
                {formatCurrency(paymodes.reduce((acc: number, curr: any) => acc + curr.Amount, 0))}
              </Text>
            </View>
          </View>

          {/* Settlement Detail Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <MaterialCommunityIcons name="bank-outline" size={20} color={Theme.primary} />
              <Text style={styles.sectionTitle}>Settlement Detail</Text>
            </View>
            
            <View style={styles.analysisRow}>
              <Text style={styles.analysisLabel}>Cash Total</Text>
              <Text style={styles.analysisValue}>{formatCurrency(data?.settlementDetail?.cashTotal || 0)}</Text>
            </View>
            <View style={styles.analysisRow}>
              <Text style={styles.analysisLabel}>Other Total</Text>
              <Text style={styles.analysisValue}>{formatCurrency(data?.settlementDetail?.otherTotal || 0)}</Text>
            </View>
            <View style={styles.analysisRow}>
              <Text style={styles.analysisLabel}>FOC Total</Text>
              <Text style={styles.analysisValue}>{formatCurrency(data?.settlementDetail?.focTotal || 0)}</Text>
            </View>
          </View>

          {/* Analysis Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <MaterialCommunityIcons name="chart-line" size={20} color={Theme.primary} />
              <Text style={styles.sectionTitle}>Analysis</Text>
            </View>
            
            <View style={styles.analysisRow}>
              <Text style={styles.analysisLabel}>Sales Amount</Text>
              <Text style={styles.analysisValue}>{formatCurrency(analysis?.totalSales || 0)}</Text>
            </View>
            <View style={styles.analysisRow}>
              <Text style={styles.analysisLabel}>FOC Sales</Text>
              <Text style={styles.analysisValue}>{formatCurrency(analysis?.focSales || 0)}</Text>
            </View>
            <View style={styles.analysisRow}>
              <Text style={styles.analysisLabel}>Total Tax</Text>
              <Text style={styles.analysisValue}>{formatCurrency(analysis?.totalTax || 0)}</Text>
            </View>
            <View style={styles.analysisRow}>
              <Text style={styles.analysisLabel}>Discount</Text>
              <Text style={styles.analysisValue}>{formatCurrency(analysis?.totalDiscount || 0)}</Text>
            </View>
            <View style={styles.analysisRow}>
              <Text style={styles.analysisLabel}>Service Charge</Text>
              <Text style={styles.analysisValue}>{formatCurrency(analysis?.totalServiceCharge || 0)}</Text>
            </View>
            <View style={styles.analysisRow}>
              <Text style={styles.analysisLabel}>Round Off</Text>
              <Text style={styles.analysisValue}>{formatCurrency(analysis?.roundOff || 0)}</Text>
            </View>
            <View style={[styles.analysisRow, { borderTopWidth: 1, borderTopColor: Theme.border, paddingTop: 8, marginTop: 4 }]}>
              <Text style={[styles.analysisLabel, { fontFamily: Fonts.black, color: Theme.primary }]}>Net Total</Text>
              <Text style={[styles.analysisValue, { fontFamily: Fonts.black, color: Theme.primary }]}>{formatCurrency(analysis?.netTotal || 0)}</Text>
            </View>
            <View style={[styles.analysisRow, { marginTop: 12 }]}>
              <Text style={styles.analysisLabel}>No of Bills</Text>
              <Text style={styles.analysisValue}>{analysis?.billCount || 0}</Text>
            </View>
            <View style={styles.analysisRow}>
              <Text style={styles.analysisLabel}>Avg/Bill</Text>
              <Text style={styles.analysisValue}>{formatCurrency(analysis?.avgPerBill || 0)}</Text>
            </View>
          </View>

          {/* Void Detail Section */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <MaterialCommunityIcons name="close-circle-outline" size={20} color="#ff4444" />
              <Text style={styles.sectionTitle}>Void Detail</Text>
            </View>
            
            <View style={styles.analysisRow}>
              <Text style={styles.analysisLabel}>Void Item Qty</Text>
              <Text style={[styles.analysisValue, { color: "#ff4444" }]}>{data?.voidDetail?.voidQty || 0}</Text>
            </View>
            <View style={styles.analysisRow}>
              <Text style={styles.analysisLabel}>Void Item Amount</Text>
              <Text style={[styles.analysisValue, { color: "#ff4444" }]}>{formatCurrency(data?.voidDetail?.voidAmount || 0)}</Text>
            </View>
          </View>

          <View style={{ height: 40 }} />

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.bgMain },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Theme.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Theme.bgMuted,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  headerSubtitle: {
    fontSize: 10,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    textTransform: 'uppercase',
    marginTop: -2,
  },
  filterContainer: {
    backgroundColor: Theme.bgCard,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
  },
  filterScroll: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
  },
  filterBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Theme.bgMuted,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  filterBtnActive: {
    backgroundColor: Theme.primary,
    borderColor: Theme.primary,
  },
  filterBtnText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  filterBtnTextActive: {
    color: "#fff",
  },
  customDateContainer: {
    flexDirection: "row",
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
  },
  dateInput: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.bgMuted,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 8,
  },
  dateInputLabel: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textMuted,
  },
  dateInputValue: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  dateControl: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
    gap: 12,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Theme.bgCard,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
  },
  dateDisplay: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
    backgroundColor: Theme.bgCard,
  },
  dateText: { 
    color: Theme.textPrimary, 
    fontFamily: Fonts.bold, 
    fontSize: 14 
  },
  dateDisplayContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 4,
  },
  dateDisplayText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  content: {
    padding: 16,
    gap: 20,
  },
  statsGrid: {
    flexDirection: "row",
    gap: 12,
  },
  statItem: {
    flex: 1,
    backgroundColor: Theme.bgCard,
    padding: 16,
    borderRadius: 16,
    ...Theme.shadowSm,
  },
  statLabel: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  sectionCard: {
    backgroundColor: Theme.bgCard,
    borderRadius: 20,
    padding: 16,
    ...Theme.shadowSm,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  tableHeader: {
    flexDirection: "row",
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    marginBottom: 8,
  },
  tableHeaderText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: Theme.border,
  },
  tableCellText: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
  },
  tableFooter: {
    flexDirection: "row",
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 2,
    borderTopColor: Theme.border,
  },
  footerText: {
    fontSize: 14,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  analysisRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: Theme.border,
  },
  analysisLabel: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
  },
  analysisValue: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  actionBtn: {
    backgroundColor: Theme.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 56,
    borderRadius: 16,
    marginTop: 10,
    ...Theme.shadowMd,
  },
  actionBtnText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: Fonts.black,
  },
  infoText: {
    textAlign: "center",
    color: Theme.textMuted,
    fontSize: 12,
    fontFamily: Fonts.medium,
    lineHeight: 18,
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  emptyText: {
    textAlign: "center",
    paddingVertical: 20,
    fontFamily: Fonts.medium,
    color: Theme.textMuted,
    fontStyle: "italic",
  },
});
