import { API_URL } from "@/constants/Config";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
  StatusBar,
  Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Fonts } from "../constants/Fonts";
import { Theme } from "../constants/theme";
import { setOrderContext } from "../stores/orderContextStore";
import { useTableStatusStore } from "../stores/tableStatusStore";
import { useAuthStore } from "@/stores/authStore";
import { socket } from "@/constants/socket";



type TableType = {
  tableId: string;
  tableNumber: string;
  isLocked?: boolean;
  diningSection?: number;
  status: number;
};

const getStatusUI = (status: number) => {
  const s = Number(status);
  switch (s) {
    case 1: return { text: "DINING", color: "#22c55e", lightBg: "#F0FDF4" };
    case 2: return { text: "CHECKOUT", color: "#F59E0B", lightBg: "#FFFBEB" };
    case 3: return { text: "HOLD", color: "#3b82f6", lightBg: "#F0F9FF" };
    case 4: return { text: "OVERTIME", color: "#8b5cf6", lightBg: "#F5F3FF" };
    case 5: return { text: "RESERVED", color: "#ef4444", lightBg: "#FEF2F2" };
    case 0:
    default: return { text: "AVAILABLE", color: "#94A3B8", lightBg: "transparent" };
  }
};

const SECTIONS = ["SECTION_1", "SECTION_2", "SECTION_3", "TAKEAWAY"];
const SECTION_LABELS: Record<string, string> = {
  SECTION_1: "Section-1",
  SECTION_2: "Section-2",
  SECTION_3: "Section-3",
  TAKEAWAY: "Takeaway",
};

const formatSection = (sec: string) => {
  if (!sec) return "";
  if (sec === "TAKEAWAY") return "Takeaway";
  return sec.replace("_", "-").replace("SECTION", "Section");
};

// --- MOBILE SOLID COLORS ---
const SOLID_LIGHT_GREEN = '#F0FDF4'; 
const SOLID_LIGHT_AMBER = '#FFFBEB';
const SOLID_LIGHT_RED   = '#FEF2F2';

export default function LockedTablesScreen() {
  const { user } = useAuthStore();
  const tables = useTableStatusStore((s: any) => s.tables);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const IS_MOBILE = Platform.OS !== 'web';
  const [lockedTables, setLockedTables] = useState<TableType[]>([]);
  const [allTables, setAllTables] = useState<TableType[]>([]);
  const [activeSection, setActiveSection] = useState<string>("SECTION_1");
  const [loading, setLoading] = useState(true);
  const [lockingLoading, setLockingLoading] = useState(false);
  const [lockModalVisible, setLockModalVisible] = useState(false);
  const [lockModalName, setLockModalName] = useState("");
  const [lockingTableId, setLockingTableId] = useState("");
  const [lockingTableNumber, setLockingTableNumber] = useState("");
  const [unlockModalVisible, setUnlockModalVisible] = useState(false);
  const [unlockingTableId, setUnlockingTableId] = useState("");
  const [unlockingTableNumber, setUnlockingTableNumber] = useState("");
  const [unlockingLoading, setUnlockingLoading] = useState(false);

  useEffect(() => {
    fetchData();

    // 🔔 Real-time sync listener for table status
    const handleStatusUpdate = () => {
      console.log("🔄 [LockedTables] Table status changed. Refreshing data...");
      fetchData();
    };

    socket.on("table_status_updated", handleStatusUpdate);
    return () => {
      socket.off("table_status_updated", handleStatusUpdate);
    };
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      fetchData();
    }, []),
  );

  const fetchData = async () => {
    try {
      setLoading(true);
      const tablesRes = await fetch(`${API_URL}/api/tables/all`);
      if (!tablesRes.ok) throw new Error("Failed to fetch tables");
      const tablesData = await tablesRes.json();

      const lockedRes = await fetch(`${API_URL}/api/tables/locked`);
      if (!lockedRes.ok) throw new Error("Failed to fetch locked tables");
      const lockedData = await lockedRes.json();
      const locked = Array.isArray(lockedData) ? lockedData : [];

      setLockedTables(locked);

        const availableTables: TableType[] = Array.isArray(tablesData)
          ? tablesData.map((table: any) => {
              const tId = String(table.id || table.TableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
            const tNum = table.label || table.TableNumber;
            const status = Number(table.Status) || 0;
            const isLocked = status === 5;

            return {
              tableId: tId,
              tableNumber: tNum,
              diningSection: Number(table.DiningSection) || 1,
              status,
              isLocked,
              lockedByName: table.lockedByName,
            };
          })
          : [];

        // 🟢 Deduplicate tables by tableId
        const uniqueTables = availableTables.filter((item, index, self) =>
          index === self.findIndex(t => t.tableId === item.tableId)
        );

        setAllTables(uniqueTables);
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Failed to fetch tables");
    } finally {
      setLoading(false);
    }
  };

  const getSectionFromDiningSection = (diningSection?: number): string => {
    switch (diningSection) {
      case 1: return "SECTION_1";
      case 2: return "SECTION_2";
      case 3: return "SECTION_3";
      case 4: return "TAKEAWAY";
      default: return "SECTION_1";
    }
  };

  const continueWithOrder = async (tableId: string, tableNumber: string, diningSection?: number) => {
    try {
      const cleanId = String(tableId).replace(/^\{|\}$/g, "").trim();
      
      // Hit the official 'send' API to transition from Locked (4) to Dining (1)
      await fetch(`${API_URL}/api/orders/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: cleanId, userId: user?.userId }),
      });

      // Update store immediately
      const section = getSectionFromDiningSection(diningSection);
      useTableStatusStore.getState().updateTableStatus(
        tableId,
        section,
        tableNumber,
        "SYNC", 
        'SENT',
        Date.now()
      );

      // 3. Set context and navigate
      setOrderContext({
        orderType: "DINE_IN",
        section: section,
        tableNo: tableNumber,
        tableId: tableId,
      });
      router.push("/menu/thai_kitchen");
    } catch (err) {
      console.error("Failed to transition locked table:", err);
      // Fallback
      const section = getSectionFromDiningSection(diningSection);
      setOrderContext({
        orderType: "DINE_IN",
        section: section,
        tableNo: tableNumber,
        tableId: tableId,
      });
      router.push("/menu/thai_kitchen");
    }
  };

  const lockTable = (tableId: string, tableNumber: string) => {
    const cleanId = String(tableId).replace(/^\{|\}$/g, "").trim();
    setLockingTableId(cleanId);
    setLockingTableNumber(tableNumber);
    setLockModalName("");
    setLockModalVisible(true);
  };

  const confirmLockTable = async () => {
    try {
      setLockingLoading(true);
      const payload = { tableId: lockingTableId, lockedByName: lockModalName.trim(), userId: user?.userId };
      const res = await fetch(`${API_URL}/api/tables/lock-persistent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setLockModalVisible(false);
        setAllTables((prev) => prev.map((t) => t.tableId === lockingTableId ? { ...t, isLocked: true, status: 5 } : t));
        setLockedTables((prev) => [...prev, { tableId: lockingTableId, tableNumber: lockingTableNumber, status: 5 }]);
        
        // Optimistic store update
        const targetTable = allTables.find((t) => t.tableId === lockingTableId);
        if (targetTable) {
          const section = getSectionFromDiningSection(targetTable.diningSection);
          useTableStatusStore.getState().updateTableStatus(
            lockingTableId,
            section,
            lockingTableNumber,
            "SYNC",
            "LOCKED",
            undefined,
            lockModalName.trim(),
            0
          );
        }
        
        fetchData();
      } else {
        const data = await res.json();
        Alert.alert("Error", data.error || "Failed to lock table");
      }
    } catch (err) {
      Alert.alert("Error", "Failed to lock table");
    } finally {
      setLockingLoading(false);
    }
  };

  const unlockTable = (tableId: string, tableNumber: string) => {
    const cleanId = String(tableId).replace(/^\{|\}$/g, "").trim();
    setUnlockingTableId(cleanId);
    setUnlockingTableNumber(tableNumber);
    setUnlockModalVisible(true);
  };

  const confirmUnlockTable = async () => {
    try {
      setUnlockingLoading(true);
      const res = await fetch(`${API_URL}/api/tables/unlock-persistent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableId: unlockingTableId, userId: user?.userId }),
      });

      if (res.ok) {
        setUnlockModalVisible(false);
        setAllTables((prev) => prev.map((t) => t.tableId === unlockingTableId ? { ...t, isLocked: false } : t));
        
        // Optimistic store update
        const targetTable = allTables.find((t) => t.tableId === unlockingTableId);
        if (targetTable) {
          const section = getSectionFromDiningSection(targetTable.diningSection);
          useTableStatusStore.getState().updateTableStatus(
            unlockingTableId,
            section,
            unlockingTableNumber,
            "SYNC",
            "EMPTY",
            undefined,
            undefined,
            0
          );
        }
        
        fetchData();
      } else {
        Alert.alert("Error", "Failed to unlock table");
      }
    } catch (err) {
      Alert.alert("Error", "Failed to unlock table");
    } finally {
      setUnlockingLoading(false);
    }
  };

  const isTablet = Math.min(width, height) >= 500;
  const isLandscape = width > height;

  let columns = 3;
  if (isTablet) {
    if (width < 768) columns = 4;
    else if (width < 1024) columns = 6;
    else columns = 8;
  } else {
    columns = isLandscape ? 5 : 3;
  }

  const GAP = 12; // Slightly tighter gap for better 3-col fit
  const PADDING = 20;
  const availableWidth = width - (PADDING * 2) - insets.left - insets.right;
  const itemSize = Math.floor((availableWidth - (GAP * (columns - 1))) / columns);

  const sectionTables = React.useMemo(() => {
    return allTables.filter((t) => getSectionFromDiningSection(t.diningSection) === activeSection);
  }, [allTables, activeSection]);

  const renderTableItem = ({ item }: { item: TableType }) => {
    const tableStatusData = tables.find((t: any) => 
      t.section === getSectionFromDiningSection(item.diningSection) && t.tableNo === item.tableNumber
    );
    
    const status = tableStatusData
      ? (tableStatusData.status === 'SENT' ? 1 : tableStatusData.status === 'BILL_REQUESTED' ? 2 : tableStatusData.status === 'HOLD' ? 3 : tableStatusData.status === 'LOCKED' ? 5 : 0)
      : Number(item.status);
    const ui = getStatusUI(status);
    
    const iconSize = Math.max(22, itemSize * 0.18);
    const numberSize = Math.max(18, itemSize * 0.22);
    const statusSize = Math.max(9, itemSize * 0.08);

    const cardBg = (Platform.OS !== 'web' && status !== 0) ? ui.lightBg : Theme.bgCard;
    const borderColor = status === 0 ? Theme.border : ui.color;
    const lockedName = tableStatusData?.lockedByName || "";

    return (
      <View style={[
        styles.tableCard, 
        { 
          width: itemSize,
          height: itemSize * 1.15, 
          backgroundColor: cardBg,
          elevation: status !== 0 ? 0 : 2, 
          borderWidth: status !== 0 ? 2 : 1.5,
          borderColor: borderColor
        }
      ]}>
        <TouchableOpacity
          style={styles.tableContent}
          onPress={() => {
            if (status === 5) {
              Alert.alert("Locked Table", `Table ${item.tableNumber} is locked. Continue order processing?`, [
                { text: "Cancel", style: "cancel" },
                { text: "Continue Order", onPress: () => continueWithOrder(item.tableId, item.tableNumber, item.diningSection) },
              ]);
            } else if (status === 4) {
              Alert.alert("Overtime Table", `Table ${item.tableNumber} is in overtime. Continue order processing?`, [
                { text: "Cancel", style: "cancel" },
                { text: "Continue Order", onPress: () => continueWithOrder(item.tableId, item.tableNumber, item.diningSection) },
              ]);
            } else if (status !== 0) {
              Alert.alert("Table In Use", `Table ${item.tableNumber} currently has an active order and cannot be locked.`);
            } else {
              lockTable(item.tableId, item.tableNumber);
            }
          }}
        >
          <Ionicons
            name={status === 5 ? "lock-closed" : status === 4 ? "time" : status !== 0 ? "restaurant" : "lock-open-outline"}
            size={iconSize}
            color={status === 0 ? Theme.textSecondary : ui.color}
          />
          <Text style={[styles.tableNumber, { fontSize: numberSize }]}>{item.tableNumber}</Text>
          <Text style={[styles.tableStatus, (status === 5 || status === 4) && { color: "#F44336" }, status !== 0 && styles.activeStatus, { fontSize: statusSize, color: status === 0 ? Theme.textMuted : ui.color }]}>
            {ui.text}
          </Text>
          {(status === 5 || status === 4) && lockedName ? (
            <Text style={{ fontSize: statusSize - 1, color: ui.color, fontWeight: 'bold', marginTop: 4 }} numberOfLines={1}>
              {lockedName}
            </Text>
          ) : null}
        </TouchableOpacity>

        {(status === 5 || status === 4) && (
          <TouchableOpacity
            style={styles.unlockBtn}
            onPress={() => unlockTable(item.tableId, item.tableNumber)}
            activeOpacity={0.7}
          >
            <Ionicons name="close-circle" size={18} color="#F44336" />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      {/* Header */}
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
          <Ionicons name="arrow-back" size={24} color={Theme.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Lock Table</Text>
          <Text style={styles.headerSubtitle}>Reserve or manage tables</Text>
        </View>
        <TouchableOpacity onPress={fetchData} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={20} color={Theme.success} />
        </TouchableOpacity>
      </View>

      {/* Locked Preview */}
      {lockedTables.length > 0 && (
        <View style={styles.lockedPreviewContainer}>
          <Text style={styles.lockedPreviewTitle}>🔒 RESERVED TABLES ({lockedTables.length})</Text>
          <ScrollView 
            horizontal 
            showsHorizontalScrollIndicator={false} 
            contentContainerStyle={styles.lockedTablesScrollContent}
            style={styles.lockedTablesScroll}
          >
            {lockedTables.map((table, index) => (
              <View key={`${table.tableId}-${index}`} style={styles.lockedTablePreview}>
                <View style={styles.lockedTablePreviewIcon}>
                  <Ionicons name="lock-closed" size={14} color={Theme.danger} />
                </View>
                <Text style={styles.lockedTablePreviewNo}>Table {table.tableNumber}</Text>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Section Tabs - Scrollable */}
      <View style={styles.sectionTabsContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.sectionTabsScrollContent}
        >
          {SECTIONS.map((section) => {
            const isActive = activeSection === section;
            const lockedCount = allTables.filter((t) => getSectionFromDiningSection(t.diningSection) === section && t.isLocked).length;
            
            return (
              <TouchableOpacity
                key={section}
                style={[styles.sectionTab, isActive && styles.activeSectionTab]}
                onPress={() => setActiveSection(section)}
                activeOpacity={0.7}
              >
                <Text style={[styles.sectionTabText, isActive && styles.activeSectionTabText]}>
                  {SECTION_LABELS[section]}
                </Text>
                {lockedCount > 0 && (
                  <View style={[styles.sectionTabBadge, isActive && styles.activeSectionTabBadge]}>
                    <Text style={[styles.sectionTabBadgeText, isActive && styles.activeSectionTabBadgeText]}>
                      {lockedCount}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Theme.primary} />
          <Text style={styles.loadingText}>Loading tables...</Text>
        </View>
      ) : (
        <FlatList
          data={sectionTables}
          keyExtractor={(item) => item.tableId}
          renderItem={renderTableItem}
          key={columns}
          numColumns={columns}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={5}
          removeClippedSubviews={Platform.OS !== 'web'}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="grid-outline" size={48} color={Theme.border} />
              <Text style={styles.emptyText}>No tables in this section</Text>
            </View>
          }
        />
      )}

      {/* Info Footer */}
      <View style={styles.footer}>
        <View style={styles.infoRow}>
          <View style={styles.infoBadge}>
            <View style={[styles.dot, { backgroundColor: Theme.warning }]} />
            <Text style={styles.infoText}>Tap to lock table</Text>
          </View>
          <View style={styles.infoBadge}>
            <View style={[styles.dot, { backgroundColor: Theme.success }]} />
            <Text style={styles.infoText}>Tap locked to continue</Text>
          </View>
        </View>
      </View>

      {/* Modals */}
      <Modal transparent visible={lockModalVisible} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Lock Table {lockingTableNumber}</Text>
            <Text style={styles.modalSubtitle}>Enter customer name (optional)</Text>
            <TextInput
              style={styles.nameInput}
              placeholder="Customer Name"
              placeholderTextColor={Theme.textMuted}
              value={lockModalName}
              onChangeText={setLockModalName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.cancelBtn]} onPress={() => setLockModalVisible(false)} disabled={lockingLoading}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.confirmBtn]} onPress={confirmLockTable} disabled={lockingLoading}>
                <Text style={styles.confirmBtnText}>{lockingLoading ? "Locking..." : "Lock Table"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent visible={unlockModalVisible} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={[styles.modalTitle, { color: Theme.danger }]}>Unlock Table {unlockingTableNumber}</Text>
            <Text style={styles.modalSubtitle}>Release this reservation?</Text>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, styles.cancelBtn]} onPress={() => setUnlockModalVisible(false)} disabled={unlockingLoading}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: Theme.danger }]} onPress={confirmUnlockTable} disabled={unlockingLoading}>
                <Text style={styles.confirmBtnText}>{unlockingLoading ? "Unlocking..." : "Unlock Table"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.bgMain },
  header: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 15, gap: 15,
    borderBottomWidth: 1, borderBottomColor: Theme.border, backgroundColor: Theme.bgCard,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: Theme.bgMuted,
    justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: Theme.border,
  },
  headerTitle: { color: Theme.textPrimary, fontFamily: Fonts.black, fontSize: 20 },
  headerSubtitle: { color: Theme.textSecondary, fontFamily: Fonts.semiBold, fontSize: 12 },
  refreshBtn: {
    marginLeft: "auto", width: 44, height: 44, borderRadius: 10,
    backgroundColor: Theme.success + "15", justifyContent: "center", alignItems: "center",
    borderWidth: 1, borderColor: Theme.success + "30",
  },
  lockedPreviewContainer: { padding: 20, backgroundColor: Theme.bgCard, borderBottomWidth: 1, borderBottomColor: Theme.border },
  lockedPreviewTitle: { color: Theme.textSecondary, fontFamily: Fonts.black, fontSize: 13, marginBottom: 15, letterSpacing: 0.5 },
  lockedTablesScroll: { flexDirection: "row" },
  lockedTablesScrollContent: { paddingRight: 20 },
  lockedTablePreview: {
    flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: Theme.danger + "08", borderRadius: 14, marginRight: 12, borderWidth: 1, borderColor: Theme.danger + "20",
  },
  lockedTablePreviewIcon: {
    width: 28, height: 28, borderRadius: 8, backgroundColor: Theme.danger + "10",
    justifyContent: "center", alignItems: "center",
  },
  lockedTablePreviewNo: { color: Theme.danger, fontFamily: Fonts.bold, fontSize: 14 },
  sectionTabsContainer: { paddingVertical: 15, backgroundColor: Theme.bgMain },
  sectionTabsScrollContent: { paddingHorizontal: 20, gap: 10 },
  sectionTab: {
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: 100, backgroundColor: Theme.bgCard,
    borderWidth: 1, borderColor: Theme.border, flexDirection: "row", alignItems: "center", gap: 8,
    ...Theme.shadowSm,
  },
  activeSectionTab: { backgroundColor: Theme.primary, borderColor: Theme.primary, ...Theme.shadowMd },
  sectionTabText: { color: Theme.textSecondary, fontFamily: Fonts.bold, fontSize: 12 },
  activeSectionTabText: { color: "#fff" },
  sectionTabBadge: { backgroundColor: Theme.bgMuted, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, minWidth: 22, alignItems: "center" },
  activeSectionTabBadge: { backgroundColor: "rgba(255,255,255,0.25)" },
  sectionTabBadgeText: { color: Theme.textPrimary, fontFamily: Fonts.black, fontSize: 10 },
  activeSectionTabBadgeText: { color: "#fff" },
  loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  loadingText: { color: Theme.textSecondary, fontFamily: Fonts.medium, fontSize: 14, marginTop: 12 },
  gridContent: { paddingHorizontal: 20, paddingBottom: 100 },
  gridRow: { gap: 12, marginBottom: 12 }, // Use 12 to match GAP
  tableCard: {
    position: "relative",
    borderRadius: 28, // Rounder for premium feel
    backgroundColor: Theme.bgCard,
    borderWidth: 1.5,
    borderColor: Theme.border,
    ...Theme.shadowSm,
  },
  lockedCard: { backgroundColor: Theme.warning + "10", borderColor: Theme.warning + "40" },
  tableContent: { flex: 1, padding: 12, alignItems: "center", justifyContent: "center" },
  tableIcon: {
    width: 56, height: 56, borderRadius: 18, backgroundColor: Theme.bgMuted,
    justifyContent: "center", alignItems: "center", marginBottom: 14, borderWidth: 1, borderColor: Theme.border,
  },
  lockedIcon: { backgroundColor: Theme.danger + "10", borderColor: Theme.danger + "20" },
  tableNumber: { color: "#000000", fontWeight: "900", letterSpacing: 0.8 },
  tableStatus: { color: Theme.textMuted, fontFamily: Fonts.bold, marginTop: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  lockedStatus: { color: Theme.danger },
  activeCard: { backgroundColor: Theme.success + "05", borderColor: Theme.success + "30" },
  activeIcon: { backgroundColor: Theme.success + "10", borderColor: Theme.success + "20" },
  activeStatus: { color: Theme.success },
  unlockBtn: {
    position: "absolute", 
    top: -10, 
    right: -10, 
    width: 32, 
    height: 32, 
    borderRadius: 16,
    backgroundColor: Theme.bgCard, 
    justifyContent: "center", 
    alignItems: "center", 
    borderWidth: 1.5, 
    borderColor: Theme.danger + "40",
    ...Theme.shadowMd,
    zIndex: 10,
  },
  footer: {
    position: "absolute", bottom: 0, left: 0, right: 0, padding: 15,
    backgroundColor: Theme.bgCard, borderTopWidth: 1, borderTopColor: Theme.border,
    paddingBottom: Platform.OS === 'ios' ? 30 : 15,
  },
  infoRow: { flexDirection: "row", justifyContent: "center", gap: 20 },
  infoBadge: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  infoText: { color: Theme.textSecondary, fontFamily: Fonts.medium, fontSize: 13 },
  modalOverlay: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "rgba(0,0,0,0.4)", padding: 20 },
  modalContent: {
    width: "100%", maxWidth: 400, backgroundColor: Theme.bgCard, borderRadius: 24, padding: 30,
    ...Theme.shadowLg, borderWidth: 1, borderColor: Theme.border,
  },
  modalTitle: { color: Theme.textPrimary, fontFamily: Fonts.black, fontSize: 22, textAlign: "center", marginBottom: 10 },
  modalSubtitle: { color: Theme.textSecondary, fontFamily: Fonts.medium, fontSize: 14, textAlign: "center", marginBottom: 25 },
  nameInput: {
    height: 60, backgroundColor: Theme.bgInput, borderRadius: 16, color: Theme.textPrimary,
    paddingHorizontal: 20, fontSize: 16, fontFamily: Fonts.bold, borderWidth: 1, borderColor: Theme.border, marginBottom: 25,
    ...Platform.select({ web: { outlineStyle: "none" } as any }),
  },
  modalActions: { flexDirection: "row", gap: 15 },
  modalBtn: { flex: 1, height: 56, borderRadius: 16, justifyContent: "center", alignItems: "center", ...Theme.shadowMd },
  cancelBtn: { backgroundColor: Theme.bgMuted, borderWidth: 1, borderColor: Theme.border },
  confirmBtn: { backgroundColor: Theme.primary },
  cancelBtnText: { color: Theme.textSecondary, fontFamily: Fonts.black, fontSize: 15 },
  confirmBtnText: { color: "#fff", fontFamily: Fonts.black, fontSize: 15 },
  confirmBtnDisabled: { opacity: 0.6 },
  emptyContainer: { alignItems: "center", marginTop: 100, gap: 15 },
  emptyText: { color: Theme.textMuted, fontFamily: Fonts.bold, fontSize: 16 },
});
