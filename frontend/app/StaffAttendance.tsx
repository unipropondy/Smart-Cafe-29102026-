import { API_URL } from "@/constants/Config";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState, useRef } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StatusBar,
  Animated,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Theme } from "../constants/theme";
import { Fonts } from "../constants/Fonts";
import { formatToSingaporeDate, formatToSingaporeTime } from "../utils/timezoneHelper";

export default function StaffAttendanceScreen() {
  const [userName, setUserName] = useState("");
  const [password, setPassword] = useState("");
  const [userId, setUserId] = useState("");
  const [staffName, setStaffName] = useState("");
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [todaySummary, setTodaySummary] = useState<any>(null);
  const [todayLogs, setTodayLogs] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Admin Logs feature states
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminUser, setAdminUser] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [logsList, setLogsList] = useState<any[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [adminToken, setAdminToken] = useState<string | null>(null);

  // Drilldown & filter states
  const [selectedStaff, setSelectedStaff] = useState<{ id: string; name: string } | null>(null);
  const [dateFilter, setDateFilter] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>('all');
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  const getUniqueStaffList = () => {
    const staffMap: { [key: string]: { id: string; name: string; count: number } } = {};
    logsList.forEach(log => {
      if (log.UserId && log.StaffName) {
        if (!staffMap[log.UserId]) {
          staffMap[log.UserId] = {
            id: log.UserId,
            name: log.StaffName,
            count: 0
          };
        }
        staffMap[log.UserId].count += 1;
      }
    });
    return Object.values(staffMap);
  };

  const getFilteredLogs = () => {
    if (!selectedStaff) return [];
    let list = logsList.filter(log => log.UserId === selectedStaff.id);
    const now = new Date();

    const getStartOfDay = (d: Date) => {
      const copy = new Date(d);
      copy.setHours(0, 0, 0, 0);
      return copy;
    };

    if (dateFilter === 'today') {
      const todayStart = getStartOfDay(now).getTime();
      const tomorrowStart = todayStart + 24 * 60 * 60 * 1000;
      list = list.filter(log => {
        const time = new Date(log.LoginTime).getTime();
        return time >= todayStart && time < tomorrowStart;
      });
    } else if (dateFilter === 'week') {
      const oneWeekAgo = getStartOfDay(now).getTime() - 7 * 24 * 60 * 60 * 1000;
      list = list.filter(log => {
        const time = new Date(log.LoginTime).getTime();
        return time >= oneWeekAgo;
      });
    } else if (dateFilter === 'month') {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      list = list.filter(log => {
        const time = new Date(log.LoginTime).getTime();
        return time >= startOfMonth;
      });
    } else if (dateFilter === 'custom') {
      const start = customStartDate ? getStartOfDay(new Date(customStartDate)).getTime() : 0;
      const end = customEndDate ? getStartOfDay(new Date(customEndDate)).getTime() + 24 * 60 * 60 * 1000 : Infinity;
      list = list.filter(log => {
        const time = new Date(log.LoginTime).getTime();
        return time >= start && time < end;
      });
    }

    return list;
  };


  const handleAdminAuth = async () => {
    if (!adminUser.trim() || !adminPin.trim()) {
      Alert.alert("Error", "Please enter Admin ID and PIN");
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userName: adminUser.trim(), password: adminPin.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Authentication failed");
      }
      
      if (data.user.role !== "ADMIN") {
        throw new Error("Access denied. Only Admin users can view logs.");
      }

      setAdminToken(data.token);
      setShowAdminLogin(false);
      setAdminUser("");
      setAdminPin("");
      
      fetchLogs(data.token);
    } catch (err: any) {
      Alert.alert("Authentication Failed", err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchLogs = async (token: string) => {
    setLogsLoading(true);
    setShowLogsModal(true);
    try {
      const res = await fetch(`${API_URL}/api/attendance/logs`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch time logs");
      }
      setLogsList(data);
    } catch (err: any) {
      Alert.alert("Error", err.message);
      setShowLogsModal(false);
    } finally {
      setLogsLoading(false);
    }
  };


  // Animation values for hover/press effect
  const btnScales: { [key: number]: Animated.Value } = {
    0: useRef(new Animated.Value(1)).current,
    1: useRef(new Animated.Value(1)).current,
    3: useRef(new Animated.Value(1)).current,
    4: useRef(new Animated.Value(1)).current,
  };

  const handlePressIn = (id: number) => {
    Animated.spring(btnScales[id], { toValue: 0.96, useNativeDriver: true }).start();
  };
  const handlePressOut = (id: number) => {
    Animated.spring(btnScales[id], { toValue: 1, friction: 3, tension: 40, useNativeDriver: true }).start();
  };

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    loadSavedCredentials();
  }, []);

  useEffect(() => {
    if (userId) fetchTodaySummary();
  }, [userId]);

  useEffect(() => {
    if (userName.length > 0) {
      const delayFetch = setTimeout(() => fetchStaffName(userName), 500);
      return () => clearTimeout(delayFetch);
    } else {
      setStaffName("");
      setUserId("");
    }
  }, [userName]);

  const loadSavedCredentials = async () => {
    try {
      const savedUser = await AsyncStorage.getItem("lastUserName");
      const savedUserId = await AsyncStorage.getItem("lastUserId");
      if (savedUser) setUserName(savedUser);
      if (savedUserId) setUserId(savedUserId);
    } catch (_) {}
  };

  const fetchStaffName = async (name: string) => {
    try {
      const res = await fetch(`${API_URL}/api/attendance/getUser`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userName: name }),
      });
      const data = await res.json();
      if (res.ok) {
        setStaffName(data.FullName);
        setUserId(data.UserId);
        await AsyncStorage.setItem("lastUserName", name);
        await AsyncStorage.setItem("lastUserId", data.UserId);
      } else {
        setStaffName("");
        setUserId("");
      }
    } catch (_) {
      setStaffName("");
      setUserId("");
    }
  };

  const fetchTodayLogs = async (id: string) => {
    try {
      const response = await fetch(`${API_URL}/api/attendance/today/${id}`);
      const data = await response.json();
      if (response.ok) setTodayLogs(data);
    } catch (_) {}
  };

  const fetchTodaySummary = async () => {
    if (!userId) return;
    try {
      const response = await fetch(`${API_URL}/api/attendance/summary/${userId}`);
      const data = await response.json();
      if (response.ok && data.summary) {
        setTodaySummary(data.summary);
        await fetchTodayLogs(userId);
      }
    } catch (_) {}
  };

  const handleAction = async (status: number) => {
    if (!userId || !password) {
      Alert.alert("Error", "Enter ID & Password");
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/attendance/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, status, userName, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed");
      if (status !== 1) setPassword("");
      Alert.alert("Success", data.message);
      await fetchTodaySummary();
      if (status === 0) {
        setUserName(""); setPassword(""); setStaffName(""); setUserId("");
        setTodaySummary(null); setTodayLogs([]);
      }
    } catch (err: any) {
      Alert.alert("Error", err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const lastStatus = todaySummary?.lastStatus;
  const canLogin = userId ? (todaySummary ? todaySummary.canClockIn : (lastStatus === 0 || lastStatus === null)) : true;
  const canOut = userId ? (todaySummary ? todaySummary.canClockOut : (lastStatus === 1 || lastStatus === 4)) : false;
  const canBreakIn = userId ? (todaySummary ? todaySummary.canStartBreak : (lastStatus === 1 || lastStatus === 4)) : false;
  const canBreakOut = userId ? (todaySummary ? todaySummary.canEndBreak : (lastStatus === 3)) : false;

  const getStatus = () => {
    switch (lastStatus) {
      case 1: return { text: "ACTIVE", color: "#22c55e" };
      case 3: return { text: "BREAK", color: "#f59e0b" };
      case 4: return { text: "ACTIVE", color: "#3b82f6" };
      default: return { text: "OFF", color: "#6b7280" };
    }
  };

  const formatActiveDuration = (hours: number) => {
    if (hours < 24) {
      return `${hours.toFixed(2)}h`;
    }
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days} day${days > 1 ? 's' : ''} ${remainingHours.toFixed(1)}h`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
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
        <Text style={styles.headerTitle}>Staff Attendance</Text>
        <Text style={styles.headerTime}>{formatToSingaporeTime(currentTime)}</Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView 
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchTodaySummary} tintColor={Theme.primary} />}
        >
          {/* USER CARD (Based on Snippet) */}
          <View style={styles.userCard}>
            <View>
              <Text style={styles.userName}>{staffName || "Select Staff"}</Text>
              <View style={styles.statusRow}>
                <Text style={[styles.statusText, { color: getStatus().color }]}>● {getStatus().text}</Text>
                {todaySummary && <Text style={styles.hoursText}> • {formatActiveDuration(todaySummary.netHours)}</Text>}
              </View>
            </View>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{staffName ? staffName.charAt(0) : "?"}</Text>
            </View>
          </View>

          {/* INPUTS (Compact Row) */}
          <View style={styles.inputRow}>
            <View style={styles.inputField}>
              <Ionicons name="person-outline" size={16} color={Theme.textMuted} style={{ marginRight: 8 }} />
              <TextInput
                style={styles.textInput}
                value={userName}
                onChangeText={setUserName}
                placeholder="User ID"
                placeholderTextColor={Theme.textMuted}
                autoCapitalize="none"
              />
            </View>
            <View style={styles.inputField}>
              <Ionicons name="lock-closed-outline" size={16} color={Theme.textMuted} style={{ marginRight: 8 }} />
              <TextInput
                style={styles.textInput}
                value={password}
                onChangeText={setPassword}
                placeholder="PIN"
                placeholderTextColor={Theme.textMuted}
                secureTextEntry
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* ACTION BUTTONS (With Icons & Clear Labels) */}
          <View style={styles.grid}>
            {[
              { id: 1, label: "CLOCK IN", icon: "enter", color: "#22c55e", active: canLogin },
              { id: 3, label: "BREAK IN", icon: "cafe", color: "#f97316", active: canBreakIn },
              { id: 4, label: "BREAK OUT", icon: "play", color: "#3b82f6", active: canBreakOut },
              { id: 0, label: "CLOCK OUT", icon: "power", color: "#ef4444", active: canOut },
            ].map((btn) => (
              <Animated.View key={btn.id} style={{ flex: 1, transform: [{ scale: btnScales[btn.id] }] }}>
                <TouchableOpacity
                  disabled={!btn.active}
                  onPressIn={() => handlePressIn(btn.id)}
                  onPressOut={() => handlePressOut(btn.id)}
                  onPress={() => handleAction(btn.id)}
                  style={[
                    styles.actionBtn, 
                    { backgroundColor: btn.active ? btn.color : "#e2e8f0" }
                  ]}
                >
                  <Ionicons name={btn.icon as any} size={24} color={btn.active ? "#fff" : "#94a3b8"} style={{ marginBottom: 4 }} />
                  <Text style={[styles.btnText, { color: btn.active ? "#fff" : "#94a3b8" }]}>
                    {btn.label}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            ))}
          </View>

          {/* DETAILED HISTORY SECTION */}
          <View style={styles.historySection}>
            <View style={styles.historyHeader}>
              <Text style={styles.sectionTitle}>RECENT RECORDS</Text>
              <TouchableOpacity 
                style={styles.viewLogsHeaderBtn} 
                onPress={() => setShowAdminLogin(true)}
              >
                <Ionicons name="eye-outline" size={16} color={Theme.primary} style={{ marginRight: 4 }} />
                <Text style={styles.viewLogsHeaderText}>View Time Logs</Text>
              </TouchableOpacity>
            </View>
            
            {todayLogs.length > 0 ? (
              todayLogs.slice(0, 6).map((log, i) => {
                const isClockIn = log.ActionName.toLowerCase().includes('in');
                const isOut = log.ActionName.toLowerCase().includes('out');
                const isBreak = log.ActionName.toLowerCase().includes('break');
                
                let iconName = "time-outline";
                let iconColor = "#6b7280";
                if (isClockIn) { iconName = "checkmark-circle"; iconColor = "#22c55e"; }
                if (isOut) { iconName = "power"; iconColor = "#ef4444"; }
                if (isBreak) { iconName = "cafe"; iconColor = "#f97316"; }

                return (
                  <View key={i} style={[styles.historyRow, { borderLeftColor: iconColor }]}>
                    <View style={styles.historyDetailLeft}>
                      <View style={[styles.historyIconBox, { backgroundColor: iconColor + '15' }]}>
                        <Ionicons name={iconName as any} size={20} color={iconColor} />
                      </View>
                      <View>
                        <Text style={styles.historyAction}>{log.ActionName}</Text>
                        <Text style={styles.historyStatusText}>Staff activity recorded successfully</Text>
                      </View>
                    </View>
                    <View style={styles.historyDetailRight}>
                      <Text style={styles.historyTime}>{formatToSingaporeTime(log.ClockinTime)}</Text>
                      <Text style={styles.historyDate}>{formatToSingaporeDate(log.ClockinTime, { month: 'short', day: 'numeric' })}</Text>
                    </View>
                  </View>
                );
              })
            ) : (
              <Text style={styles.emptyText}>No records recorded for today</Text>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Admin Login Modal */}
      <Modal
        visible={showAdminLogin}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowAdminLogin(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.loginModalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>🔑 Admin Authentication</Text>
              <TouchableOpacity onPress={() => setShowAdminLogin(false)}>
                <Ionicons name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>
            
            <Text style={styles.modalSubtitle}>Enter admin credentials to view history</Text>

            <View style={styles.modalInputBox}>
              <Ionicons name="person-outline" size={18} color="#9ca3af" style={{ marginRight: 8 }} />
              <TextInput
                style={styles.modalInput}
                placeholder="Admin User ID"
                value={adminUser}
                onChangeText={setAdminUser}
                autoCapitalize="none"
              />
            </View>

            <View style={styles.modalInputBox}>
              <Ionicons name="lock-closed-outline" size={18} color="#9ca3af" style={{ marginRight: 8 }} />
              <TextInput
                style={styles.modalInput}
                placeholder="Admin PIN"
                value={adminPin}
                onChangeText={setAdminPin}
                secureTextEntry
                autoCapitalize="none"
              />
            </View>

            <TouchableOpacity style={styles.modalSubmitBtn} onPress={handleAdminAuth}>
              <Text style={styles.modalSubmitText}>Authenticate</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Logs View Modal */}
      <Modal
        visible={showLogsModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => {
          setShowLogsModal(false);
          setSelectedStaff(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.logsModalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {selectedStaff && (
                  <TouchableOpacity 
                    style={{ marginRight: 8, padding: 4 }} 
                    onPress={() => {
                      setSelectedStaff(null);
                      setDateFilter('all');
                      setCustomStartDate("");
                      setCustomEndDate("");
                    }}
                  >
                    <Ionicons name="arrow-back" size={20} color={Theme.primary} />
                  </TouchableOpacity>
                )}
                <Text style={styles.modalTitle}>
                  {selectedStaff ? `📋 History: ${selectedStaff.name}` : "👥 Staff Directory"}
                </Text>
              </View>
              <TouchableOpacity onPress={() => {
                setShowLogsModal(false);
                setSelectedStaff(null);
              }}>
                <Ionicons name="close" size={24} color="#6b7280" />
              </TouchableOpacity>
            </View>

            {logsLoading ? (
              <ActivityIndicator size="large" color={Theme.primary} style={{ marginVertical: 40 }} />
            ) : !selectedStaff ? (
              /* --- STAFF LIST DIRECTORY VIEW --- */
              <ScrollView style={{ maxHeight: 500, marginVertical: 12 }}>
                <Text style={styles.modalSubtitle}>Select a staff member to view their complete attendance history.</Text>
                {getUniqueStaffList().length > 0 ? (
                  getUniqueStaffList().map((staff) => (
                    <TouchableOpacity
                      key={staff.id}
                      style={styles.staffListItem}
                      onPress={() => setSelectedStaff(staff)}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={styles.staffAvatar}>
                          <Text style={styles.staffAvatarText}>{staff.name.charAt(0).toUpperCase()}</Text>
                        </View>
                        <View>
                          <Text style={styles.staffNameText}>{staff.name}</Text>
                          <Text style={styles.staffLogCount}>{staff.count} logged shift{staff.count !== 1 ? 's' : ''}</Text>
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
                    </TouchableOpacity>
                  ))
                ) : (
                  <Text style={styles.emptyText}>No staff records found</Text>
                )}
              </ScrollView>
            ) : (
              /* --- INDIVIDUAL STAFF LOG HISTORY VIEW --- */
              <View style={{ flex: 1, maxHeight: 550 }}>
                {/* Horizontal Date Filter Bar */}
                <View style={styles.filterBar}>
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'today', label: 'Today' },
                    { id: 'week', label: 'This Week' },
                    { id: 'month', label: 'This Month' },
                    { id: 'custom', label: 'Custom Range' },
                  ].map((filter) => (
                    <TouchableOpacity
                      key={filter.id}
                      style={[styles.filterTab, dateFilter === filter.id && styles.filterTabActive]}
                      onPress={() => setDateFilter(filter.id as any)}
                    >
                      <Text style={[styles.filterTabText, dateFilter === filter.id && styles.filterTabTextActive]}>
                        {filter.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Custom Date Range Picker Inputs */}
                {dateFilter === 'custom' && (
                  <View style={styles.customDateInputs}>
                    <View style={styles.dateInputWrapper}>
                      <Text style={styles.dateLabel}>Start Date</Text>
                      <TextInput
                        style={styles.dateTextInput}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor="#9ca3af"
                        value={customStartDate}
                        onChangeText={setCustomStartDate}
                      />
                    </View>
                    <View style={styles.dateInputWrapper}>
                      <Text style={styles.dateLabel}>End Date</Text>
                      <TextInput
                        style={styles.dateTextInput}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor="#9ca3af"
                        value={customEndDate}
                        onChangeText={setCustomEndDate}
                      />
                    </View>
                  </View>
                )}

                <ScrollView style={{ flex: 1, marginVertical: 12 }}>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.tableHeaderCell, { flex: 1.5 }]}>Date</Text>
                    <Text style={[styles.tableHeaderCell, { flex: 1.8 }]}>Login Time</Text>
                    <Text style={[styles.tableHeaderCell, { flex: 1.8 }]}>Logout Time</Text>
                    <Text style={[styles.tableHeaderCell, { flex: 1.2, textAlign: 'right' }]}>Duration</Text>
                    <Text style={[styles.tableHeaderCell, { flex: 1.2, textAlign: 'right' }]}>Status</Text>
                  </View>

                  {getFilteredLogs().length > 0 ? (
                    getFilteredLogs().map((log, index) => {
                      const dateStr = log.LoginTime ? formatToSingaporeDate(log.LoginTime, { year: 'numeric', month: 'short', day: 'numeric' }) : "-";
                      const formattedLogin = log.LoginTime ? formatToSingaporeTime(log.LoginTime) : "-";
                      const formattedLogout = log.LogoutTime ? formatToSingaporeTime(log.LogoutTime) : "-";
                      const durationStr = log.TotalDuration !== null && log.TotalDuration !== undefined ? `${parseFloat(log.TotalDuration).toFixed(2)}h` : "-";
                      const isCompleted = log.LogoutTime !== null;
                      const statusStr = isCompleted ? "Completed" : "Active";
                      const statusColor = isCompleted ? "#10b981" : "#3b82f6";

                      return (
                        <View key={index} style={[styles.tableRow, index % 2 === 0 ? styles.rowEven : styles.rowOdd]}>
                          <Text style={[styles.tableCell, { flex: 1.5, fontFamily: Fonts.bold }]}>{dateStr}</Text>
                          <Text style={[styles.tableCell, { flex: 1.8 }]}>{formattedLogin}</Text>
                          <Text style={[styles.tableCell, { flex: 1.8 }]}>{formattedLogout}</Text>
                          <Text style={[styles.tableCell, { flex: 1.2, textAlign: 'right', fontFamily: Fonts.bold, color: Theme.primary }]}>{durationStr}</Text>
                          <View style={{ flex: 1.2, alignItems: 'flex-end' }}>
                            <View style={[styles.statusBadge, { backgroundColor: statusColor + '15' }]}>
                              <Text style={[styles.statusBadgeText, { color: statusColor }]}>{statusStr}</Text>
                            </View>
                          </View>
                        </View>
                      );
                    })
                  ) : (
                    <Text style={styles.emptyText}>No logs found for this filter selection</Text>
                  )}
                </ScrollView>
              </View>
            )}

            <TouchableOpacity 
              style={[styles.modalSubmitBtn, { backgroundColor: "#6b7280" }]} 
              onPress={() => {
                setShowLogsModal(false);
                setSelectedStaff(null);
              }}
            >
              <Text style={styles.modalSubmitText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>


      {isLoading && <View style={styles.loader}><ActivityIndicator color={Theme.primary} /></View>}
    </SafeAreaView>
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
    borderBottomColor: Theme.border
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: Fonts.black, color: Theme.textPrimary },
  headerTime: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.primary },
  
  content: { padding: 16 },
  
  userCard: {
    backgroundColor: Theme.bgCard,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowSm,
  },
  userName: { fontSize: 18, fontFamily: Fonts.black, color: Theme.textPrimary },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  statusText: { fontSize: 13, fontFamily: Fonts.bold },
  hoursText: { fontSize: 13, fontFamily: Fonts.medium, color: Theme.textSecondary },
  avatar: { 
    width: 44, 
    height: 44, 
    borderRadius: 12, 
    backgroundColor: Theme.primaryLight, 
    alignItems: "center", 
    justifyContent: "center" 
  },
  avatarText: { fontSize: 20, fontFamily: Fonts.black, color: Theme.primary },

  inputRow: { flexDirection: "row", gap: 12, marginBottom: 20 },
  inputField: { 
    flex: 1, 
    flexDirection: "row", 
    alignItems: "center", 
    backgroundColor: Theme.bgInput, 
    height: 56, 
    borderRadius: 14, 
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Theme.border
  },
  textInput: { 
    flex: 1, 
    fontSize: 16, 
    fontFamily: Fonts.bold, 
    color: Theme.textPrimary,
    ...Platform.select({ web: { outlineStyle: "none" } as any })
  },

  grid: { flexDirection: "row", gap: 12, marginBottom: 24 },
  actionBtn: { 
    flex: 1, 
    height: 100, 
    borderRadius: 20, 
    alignItems: "center", 
    justifyContent: "center",
    paddingVertical: 10,
    ...Theme.shadowMd,
    overflow: 'hidden'
  },
  btnText: { fontSize: 13, fontFamily: Fonts.black, textAlign: "center", includeFontPadding: false },

  historySection: { 
    backgroundColor: Theme.bgCard, 
    borderRadius: 16, 
    padding: 16,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowSm,
    marginBottom: 40,
  },
  historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontFamily: Fonts.black, color: Theme.textSecondary, textTransform: "uppercase" },
  viewLogsHeaderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: Theme.primaryLight,
    borderWidth: 1,
    borderColor: Theme.primaryBorder,
  },
  viewLogsHeaderText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.primary,
  },
  historyRow: { 
    flexDirection: "row", 
    justifyContent: "space-between", 
    alignItems: "center",
    borderLeftWidth: 4,
    paddingLeft: 12,
    paddingRight: 12,
    paddingVertical: 15,
    marginBottom: 10,
    backgroundColor: Theme.bgMain,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  historyDetailLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  historyIconBox: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  historyAction: { fontSize: 15, fontFamily: Fonts.bold, color: Theme.textPrimary, includeFontPadding: false },
  historyStatusText: { fontSize: 11, fontFamily: Fonts.medium, color: Theme.textSecondary, marginTop: 2 },
  historyDetailRight: { alignItems: 'flex-end' },
  historyTime: { fontSize: 14, fontFamily: Fonts.black, color: Theme.textPrimary, includeFontPadding: false },
  historyDate: { fontSize: 11, fontFamily: Fonts.medium, color: Theme.textSecondary, marginTop: 2 },
  emptyText: { textAlign: "center", color: Theme.textSecondary, fontSize: 13, fontFamily: Fonts.medium, paddingVertical: 20 },

  loader: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(250,247,242,0.7)", alignItems: "center", justifyContent: "center" },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)', // Slate overlay
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loginModalContent: {
    backgroundColor: Theme.bgCard,
    borderRadius: 16,
    width: '100%',
    maxWidth: 400,
    padding: 20,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowLg,
  },
  logsModalContent: {
    backgroundColor: Theme.bgCard,
    borderRadius: 16,
    width: '100%',
    maxWidth: 800,
    padding: 20,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowLg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    paddingBottom: 12,
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  modalSubtitle: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginBottom: 16,
  },
  modalInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Theme.bgInput,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 48,
    borderWidth: 1,
    borderColor: Theme.border,
    marginBottom: 12,
  },
  modalInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
    ...Platform.select({ web: { outlineStyle: "none" } as any })
  },
  modalSubmitBtn: {
    backgroundColor: Theme.primary,
    borderRadius: 10,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  modalSubmitText: {
    color: '#fff',
    fontSize: 16,
    fontFamily: Fonts.bold,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: Theme.bgMuted,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginBottom: 6,
  },
  tableHeaderCell: {
    fontSize: 13,
    fontFamily: Fonts.black,
    color: Theme.textSecondary,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    alignItems: 'center',
  },
  rowEven: {
    backgroundColor: Theme.bgCard,
  },
  rowOdd: {
    backgroundColor: Theme.bgMain,
  },
  tableCell: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
  },
  staffListItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: Theme.bgMain,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    marginBottom: 10,
  },
  staffAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Theme.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  staffAvatarText: {
    fontSize: 16,
    fontFamily: Fonts.black,
    color: Theme.primary,
  },
  staffNameText: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  staffLogCount: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginTop: 2,
  },
  filterBar: {
    flexDirection: 'row',
    backgroundColor: Theme.bgMuted,
    padding: 4,
    borderRadius: 10,
    marginBottom: 16,
    gap: 4,
  },
  filterTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  filterTabActive: {
    backgroundColor: Theme.bgCard,
    ...Theme.shadowSm,
  },
  filterTabText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  filterTabTextActive: {
    color: Theme.primary,
  },
  customDateInputs: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  dateInputWrapper: {
    flex: 1,
  },
  dateLabel: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    marginBottom: 4,
  },
  dateTextInput: {
    height: 40,
    borderWidth: 1,
    borderColor: Theme.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
    backgroundColor: Theme.bgInput,
    ...Platform.select({ web: { outlineStyle: "none" } as any })
  },
  statusBadge: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
  },
});
