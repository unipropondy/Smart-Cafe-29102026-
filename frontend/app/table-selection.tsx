import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  StatusBar,
  useWindowDimensions,
  Pressable,
  Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Fonts } from "@/constants/Fonts";
import { API_URL } from "@/constants/Config";
import { useAuthStore } from "@/stores/authStore";
import { useOrderContextStore } from "@/stores/orderContextStore";
import { useCartStore } from "@/stores/cartStore";
import { socket } from "@/constants/socket";

type TableItem = {
  id: string;
  label: string;
  DiningSection: number;
  Status: number;
  Seats?: number;
  totalAmount?: number;
  currentOrderId?: string;
  lockedByName?: string;
  customerName?: string;
  StartTime?: string | number;
};

const SECTIONS = [
  { id: 0, label: "All Sections" },
  { id: 1, label: "Section 1" },
  { id: 2, label: "Section 2" },
  { id: 3, label: "Section 3" },
];

export default function TableSelectionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const { user, logout } = useAuthStore();

  const [tables, setTables] = useState<TableItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedSection, setSelectedSection] = useState<number>(0); // 0 = All
  const [statusFilter, setStatusFilter] = useState<string>("ALL"); // ALL, AVAILABLE, OCCUPIED, RESERVED
  const [menuOpen, setMenuOpen] = useState(false);

  const [currentTime, setCurrentTime] = useState<string>("");
  const [currentDate, setCurrentDate] = useState<string>("");

  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      setCurrentDate(
        now.toLocaleDateString("en-US", {
          weekday: "short",
          day: "2-digit",
          month: "short",
          year: "numeric",
        })
      );
      setCurrentTime(
        now.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
      );
    };
    updateDateTime();
    const interval = setInterval(updateDateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchTables = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/tables/all`);
      if (!res.ok) throw new Error("Failed to fetch tables");
      const data = await res.json();
      const rawArray = Array.isArray(data) ? data : (data?.data || []);

      const formattedTables: TableItem[] = rawArray.map((item: any) => ({
        id: String(item.id || item.TableId || "")
          .replace(/^\{|\}$/g, "")
          .trim()
          .toLowerCase(),
        label: item.label || item.TableNumber || `T-${item.id}`,
        DiningSection: Number(item.DiningSection) || 1,
        Status: Number(item.Status) || 0,
        Seats: item.Seats ? Number(item.Seats) : 4,
        totalAmount: Number(item.totalAmount) || 0,
        currentOrderId: item.currentOrderId,
        lockedByName: item.lockedByName,
        customerName: item.customerName || item.CustomerName,
        StartTime: item.StartTime,
      }));

      // Deduplicate
      const uniqueTables = formattedTables.filter(
        (t, idx, self) => idx === self.findIndex((tbl) => tbl.id === t.id)
      );

      setTables(uniqueTables);
    } catch (err) {
      console.error("❌ TableSelection fetch error:", err);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchTables();
    }, [])
  );

  useEffect(() => {
    const handleTableSync = () => {
      fetchTables();
    };
    socket.on("table_status_updated", handleTableSync);
    socket.on("table_config_updated", handleTableSync);
    return () => {
      socket.off("table_status_updated", handleTableSync);
      socket.off("table_config_updated", handleTableSync);
    };
  }, []);

  // Filter Logic
  const filteredTables = tables.filter((t) => {
    // Search query filter
    const matchesSearch =
      t.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.customerName && t.customerName.toLowerCase().includes(searchQuery.toLowerCase()));

    // Section filter
    const matchesSection = selectedSection === 0 || t.DiningSection === selectedSection;

    // Status filter
    let matchesStatus = true;
    if (statusFilter === "AVAILABLE") {
      matchesStatus = t.Status === 0;
    } else if (statusFilter === "OCCUPIED") {
      matchesStatus = t.Status >= 1 && t.Status <= 4;
    } else if (statusFilter === "RESERVED") {
      matchesStatus = t.Status === 5;
    }

    return matchesSearch && matchesSection && matchesStatus;
  });

  // Select Table Handler
  const handleSelectTable = (table: TableItem) => {
    const sectionName = `SECTION_${table.DiningSection}`;
    useOrderContextStore.getState().setOrderContext({
      orderType: "DINE_IN",
      tableId: table.id,
      tableNo: table.label,
      section: sectionName,
    });
    useCartStore.getState().setCurrentContext(table.id);
    router.push("/(tabs)/category");
  };

  const getStatusBadge = (status: number) => {
    switch (status) {
      case 1:
      case 2:
      case 3:
      case 4:
        return { label: "Occupied", bg: "#FEF2F2", text: "#EF4444", border: "#FCA5A5" };
      case 5:
        return { label: "Reserved", bg: "#F5F3FF", text: "#8B5CF6", border: "#C4B5FD" };
      case 0:
      default:
        return { label: "Available", bg: "#F0FDF4", text: "#22C55E", border: "#86EFAC" };
    }
  };

  const handleMenuNavigate = (route: string) => {
    setMenuOpen(false);
    if (route === "logout") {
      logout();
      router.replace("/login");
    } else {
      router.push(route as any);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* HEADER BAR */}
      <View style={styles.header}>
        {/* Left: Back Button & Brand */}
        <View style={styles.headerLeft}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-back" size={20} color="#1E293B" />
          </TouchableOpacity>
          <View style={styles.logoBadge}>
            <Ionicons name="restaurant" size={20} color="#FFFFFF" />
          </View>
          <View style={styles.brandTitleContainer}>
            <Text style={styles.brandTitle}>FOOD POS</Text>
            <Text style={styles.brandSubtitle}>TABLE SELECTION</Text>
          </View>
        </View>

        {/* Center: Date & Time */}
        <View style={styles.headerCenter}>
          <View style={styles.dateTimeBadge}>
            <Ionicons name="calendar-outline" size={16} color="#FF4D5E" />
            <Text style={styles.dateTimeText}>{currentDate}</Text>
            <View style={styles.dateTimeDivider} />
            <Ionicons name="time-outline" size={16} color="#FF4D5E" />
            <Text style={styles.dateTimeText}>{currentTime}</Text>
          </View>
        </View>

        {/* Right: User Profile & Menu Button */}
        <View style={styles.headerRight}>
          <View style={styles.userInfo}>
            <View style={styles.avatarCircle}>
              <Ionicons name="person-outline" size={18} color="#475569" />
            </View>
            <View style={styles.userTextContainer}>
              <Text style={styles.userName}>{user?.userName || "John Doe"}</Text>
              <Text style={styles.userRole}>{user?.role || "Cashier"}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.menuButton, menuOpen && styles.menuButtonActive]}
            activeOpacity={0.8}
            onPress={() => setMenuOpen(!menuOpen)}
          >
            <Ionicons name={menuOpen ? "close-outline" : "menu-outline"} size={22} color="#FFFFFF" />
            <Text style={styles.menuButtonText}>Menu</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* DROPDOWN MENU */}
      {menuOpen && (
        <Pressable style={styles.menuOverlay} onPress={() => setMenuOpen(false)}>
          <View style={[styles.dropdownMenu, { top: insets.top + 65 }]}>
            <TouchableOpacity
              style={styles.dropdownItem}
              onPress={() => handleMenuNavigate("/general-settings")}
            >
              <Ionicons name="settings-outline" size={20} color="#475569" />
              <Text style={styles.dropdownItemText}>Settings</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.dropdownItem}
              onPress={() => handleMenuNavigate("/heldOrders")}
            >
              <Ionicons name="clipboard-outline" size={20} color="#475569" />
              <Text style={styles.dropdownItemText}>Orders</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.dropdownItem}
              onPress={() => handleMenuNavigate("/table-selection")}
            >
              <Ionicons name="grid-outline" size={20} color="#475569" />
              <Text style={styles.dropdownItemText}>Tables</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.dropdownItem}
              onPress={() => handleMenuNavigate("/(tabs)/category")}
            >
              <Ionicons name="restaurant-outline" size={20} color="#475569" />
              <Text style={styles.dropdownItemText}>Menu Master</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.dropdownItem}
              onPress={() => handleMenuNavigate("/sales-report")}
            >
              <Ionicons name="bar-chart-outline" size={20} color="#475569" />
              <Text style={styles.dropdownItemText}>Reports</Text>
            </TouchableOpacity>

            <View style={styles.dropdownDivider} />

            <TouchableOpacity
              style={[styles.dropdownItem, styles.dropdownItemLogout]}
              onPress={() => handleMenuNavigate("logout")}
            >
              <Ionicons name="log-out-outline" size={20} color="#EF4444" />
              <Text style={[styles.dropdownItemText, styles.logoutText]}>Logout</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      )}

      {/* CONTROLS BAR: SEARCH, SECTIONS, STATUS FILTERS */}
      <View style={styles.controlsBar}>
        {/* Search Input */}
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color="#64748B" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search table number..."
            placeholderTextColor="#94A3B8"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <Ionicons name="close-circle" size={18} color="#94A3B8" />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Section Tabs */}
        <View style={styles.sectionTabs}>
          {SECTIONS.map((sec) => (
            <TouchableOpacity
              key={sec.id}
              style={[
                styles.sectionTab,
                selectedSection === sec.id && styles.sectionTabActive,
              ]}
              onPress={() => setSelectedSection(sec.id)}
            >
              <Text
                style={[
                  styles.sectionTabText,
                  selectedSection === sec.id && styles.sectionTabTextActive,
                ]}
              >
                {sec.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Status Filter Chips */}
        <View style={styles.statusChips}>
          {[
            { id: "ALL", label: "All" },
            { id: "AVAILABLE", label: "Available" },
            { id: "OCCUPIED", label: "Occupied" },
            { id: "RESERVED", label: "Reserved" },
          ].map((st) => (
            <TouchableOpacity
              key={st.id}
              style={[
                styles.statusChip,
                statusFilter === st.id && styles.statusChipActive,
              ]}
              onPress={() => setStatusFilter(st.id)}
            >
              <Text
                style={[
                  styles.statusChipText,
                  statusFilter === st.id && styles.statusChipTextActive,
                ]}
              >
                {st.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* TABLES GRID */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FF4D5E" />
          <Text style={styles.loadingText}>Loading restaurant tables...</Text>
        </View>
      ) : filteredTables.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="grid-outline" size={48} color="#CBD5E1" />
          <Text style={styles.emptyTitle}>No tables found</Text>
          <Text style={styles.emptySubtitle}>Try changing your search or section filter</Text>
        </View>
      ) : (
        <FlatList
          data={filteredTables}
          keyExtractor={(item) => item.id}
          numColumns={isLandscape ? 5 : 2}
          key={isLandscape ? "grid-5" : "grid-2"}
          contentContainerStyle={styles.gridContent}
          renderItem={({ item }) => {
            const badge = getStatusBadge(item.Status);
            const isAvailable = item.Status === 0;

            return (
              <TouchableOpacity
                style={[
                  styles.tableCard,
                  { borderColor: badge.border },
                  isAvailable && styles.availableTableCard,
                ]}
                activeOpacity={0.85}
                onPress={() => handleSelectTable(item)}
              >
                {/* Table Header */}
                <View style={styles.tableCardHeader}>
                  <View style={styles.tableNumberContainer}>
                    <Text style={styles.tableNumberText}>Table {item.label}</Text>
                    <Text style={styles.tableSectionSub}>Section {item.DiningSection}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                    <View style={[styles.statusDot, { backgroundColor: badge.text }]} />
                    <Text style={[styles.statusBadgeText, { color: badge.text }]}>
                      {badge.label}
                    </Text>
                  </View>
                </View>

                {/* Table Details */}
                <View style={styles.tableCardBody}>
                  <View style={styles.seatsInfo}>
                    <Ionicons name="people-outline" size={16} color="#64748B" />
                    <Text style={styles.seatsText}>{item.Seats || 4} Seats</Text>
                  </View>

                  {!isAvailable && item.totalAmount ? (
                    <Text style={styles.totalAmountText}>
                      ${item.totalAmount.toFixed(2)}
                    </Text>
                  ) : null}

                  {!isAvailable && item.customerName ? (
                    <Text style={styles.customerNameText} numberOfLines={1}>
                      👤 {item.customerName}
                    </Text>
                  ) : null}
                </View>

                {/* Card Action Banner */}
                <View
                  style={[
                    styles.cardActionBanner,
                    { backgroundColor: isAvailable ? "#F0FDF4" : "#F8FAFC" },
                  ]}
                >
                  <Text
                    style={[
                      styles.cardActionText,
                      { color: isAvailable ? "#16A34A" : "#475569" },
                    ]}
                  >
                    {isAvailable ? "Select Table →" : "Open Order →"}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  header: {
    height: 64,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    zIndex: 100,
    elevation: 4,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  logoBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FF4D5E",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },
  brandTitleContainer: {
    justifyContent: "center",
  },
  brandTitle: {
    fontFamily: Fonts.extraBold || "System",
    fontSize: 16,
    color: "#0F172A",
  },
  brandSubtitle: {
    fontFamily: Fonts.semiBold || "System",
    fontSize: 9,
    color: "#64748B",
    letterSpacing: 1.2,
    marginTop: -2,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  dateTimeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 18,
  },
  dateTimeText: {
    fontFamily: Fonts.medium || "System",
    fontSize: 12,
    color: "#334155",
    marginLeft: 6,
  },
  dateTimeDivider: {
    width: 1,
    height: 12,
    backgroundColor: "#CBD5E1",
    marginHorizontal: 8,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
  },
  userInfo: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 14,
  },
  avatarCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#E2E8F0",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 6,
  },
  userTextContainer: {
    justifyContent: "center",
  },
  userName: {
    fontFamily: Fonts.bold || "System",
    fontSize: 12,
    color: "#1E293B",
  },
  userRole: {
    fontFamily: Fonts.regular || "System",
    fontSize: 10,
    color: "#64748B",
  },
  menuButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FF4D5E",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 4,
  },
  menuButtonActive: {
    backgroundColor: "#DC2626",
  },
  menuButtonText: {
    fontFamily: Fonts.semiBold || "System",
    fontSize: 13,
    color: "#FFFFFF",
  },
  menuOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 999,
  },
  dropdownMenu: {
    position: "absolute",
    right: 20,
    width: 220,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    paddingVertical: 8,
    elevation: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  dropdownItemText: {
    fontFamily: Fonts.medium || "System",
    fontSize: 14,
    color: "#334155",
  },
  dropdownDivider: {
    height: 1,
    backgroundColor: "#F1F5F9",
    marginVertical: 4,
  },
  dropdownItemLogout: {
    backgroundColor: "#FEF2F2",
  },
  logoutText: {
    color: "#EF4444",
    fontFamily: Fonts.semiBold || "System",
  },
  controlsBar: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
    gap: 12,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 42,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontFamily: Fonts.regular || "System",
    fontSize: 14,
    color: "#0F172A",
  },
  sectionTabs: {
    flexDirection: "row",
    gap: 8,
  },
  sectionTab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#F1F5F9",
  },
  sectionTabActive: {
    backgroundColor: "#0F172A",
  },
  sectionTabText: {
    fontFamily: Fonts.medium || "System",
    fontSize: 13,
    color: "#475569",
  },
  sectionTabTextActive: {
    color: "#FFFFFF",
    fontFamily: Fonts.semiBold || "System",
  },
  statusChips: {
    flexDirection: "row",
    gap: 8,
  },
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  statusChipActive: {
    backgroundColor: "#FF4D5E",
    borderColor: "#FF4D5E",
  },
  statusChipText: {
    fontFamily: Fonts.medium || "System",
    fontSize: 12,
    color: "#64748B",
  },
  statusChipTextActive: {
    color: "#FFFFFF",
    fontFamily: Fonts.semiBold || "System",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    marginTop: 12,
    fontFamily: Fonts.medium || "System",
    fontSize: 14,
    color: "#64748B",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  emptyTitle: {
    fontFamily: Fonts.bold || "System",
    fontSize: 18,
    color: "#334155",
    marginTop: 12,
  },
  emptySubtitle: {
    fontFamily: Fonts.regular || "System",
    fontSize: 14,
    color: "#94A3B8",
    marginTop: 4,
  },
  gridContent: {
    padding: 16,
    gap: 16,
  },
  tableCard: {
    flex: 1,
    margin: 6,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: 1.5,
    overflow: "hidden",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  availableTableCard: {
    backgroundColor: "#FFFFFF",
  },
  tableCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#F1F5F9",
  },
  tableNumberContainer: {},
  tableNumberText: {
    fontFamily: Fonts.bold || "System",
    fontSize: 18,
    color: "#0F172A",
  },
  tableSectionSub: {
    fontFamily: Fonts.medium || "System",
    fontSize: 11,
    color: "#64748B",
  },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusBadgeText: {
    fontFamily: Fonts.semiBold || "System",
    fontSize: 11,
  },
  tableCardBody: {
    padding: 14,
    gap: 6,
  },
  seatsInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  seatsText: {
    fontFamily: Fonts.regular || "System",
    fontSize: 13,
    color: "#64748B",
  },
  totalAmountText: {
    fontFamily: Fonts.extraBold || "System",
    fontSize: 16,
    color: "#EF4444",
  },
  customerNameText: {
    fontFamily: Fonts.medium || "System",
    fontSize: 12,
    color: "#475569",
  },
  cardActionBanner: {
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: 1,
    borderTopColor: "#F1F5F9",
  },
  cardActionText: {
    fontFamily: Fonts.bold || "System",
    fontSize: 13,
  },
});
