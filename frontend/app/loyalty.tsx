import { API_URL } from "@/constants/Config";
import { useAuthStore } from "@/stores/authStore";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useToast } from "../components/Toast";
import { Fonts } from "../constants/Fonts";
import { Theme } from "../constants/theme";
import {
  formatToSingaporeDate,
  formatToSingaporeTime,
} from "../utils/timezoneHelper";

const COUNTRIES = [
  { code: "+65", name: "Singapore" },
  { code: "+91", name: "India" },
  { code: "+60", name: "Malaysia" },
];

export default function LoyaltyScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  const [searchText, setSearchText] = useState("");
  const [members, setMembers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Enrollment Modal States
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollPhone, setEnrollPhone] = useState("");
  const [enrollName, setEnrollName] = useState("");
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState(COUNTRIES[0]);
  const [showCountryPicker, setShowCountryPicker] = useState(false);

  // Visitor Details & Order History States
  const [selectedVisitor, setSelectedVisitor] = useState<any | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [dishProgress, setDishProgress] = useState<any[]>([]);
  const [dishProgressLoading, setDishProgressLoading] = useState(false);

  // Order Details States
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [showOrderDetailModal, setShowOrderDetailModal] = useState(false);
  const [orderDetailData, setOrderDetailData] = useState<any | null>(null);
  const [orderDetailLoading, setOrderDetailLoading] = useState(false);

  // Delete Confirmation States
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [visitorToDelete, setVisitorToDelete] = useState<{
    phone: string;
    name: string;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchMembers = async (query = "") => {
    setIsLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/loyalty/search?q=${encodeURIComponent(query)}`,
      );
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setMembers(data);
      } else {
        setMembers([]);
      }
    } catch (err: any) {
      console.error("Fetch loyalty members error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchMembers(searchText);
    setRefreshing(false);
  };

  useEffect(() => {
    fetchMembers("");
  }, []);

  const handleSearch = (text: string) => {
    setSearchText(text);
    fetchMembers(text);
  };

  const handleEnroll = async () => {
    if (!enrollPhone.trim()) {
      showToast({ type: "error", message: "Please enter a mobile number." });
      return;
    }
    setIsEnrolling(true);
    try {
      const fullPhone = `${selectedCountry.code} ${enrollPhone.trim()}`;
      const res = await fetch(`${API_URL}/api/loyalty/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: fullPhone, name: enrollName.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to enroll member");
      }
      showToast({
        type: "success",
        message: data.message || "Customer enrolled successfully!",
      });
      setShowEnrollModal(false);
      setEnrollPhone("");
      setEnrollName("");
      fetchMembers(searchText);
    } catch (err: any) {
      showToast({ type: "error", message: err.message });
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleDeleteMember = (phone: string, name: string) => {
    setVisitorToDelete({ phone, name });
    setShowDeleteConfirm(true);
  };

  const executeDeleteVisitor = async () => {
    if (!visitorToDelete) return;
    setIsDeleting(true);
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(
        `${API_URL}/api/loyalty/customer/${encodeURIComponent(visitorToDelete.phone)}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to delete visitor");
      }

      showToast({ type: "success", message: "Visitor deleted successfully" });

      setShowDeleteConfirm(false);
      setVisitorToDelete(null);
      fetchMembers(searchText);
    } catch (err: any) {
      showToast({ type: "error", message: err.message });
    } finally {
      setIsDeleting(false);
    }
  };

  const fetchDishProgress = async (phone: string) => {
    setDishProgressLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/loyalty/customer/${encodeURIComponent(phone)}/dish-progress`,
      );
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setDishProgress(data);
      } else {
        setDishProgress([]);
      }
    } catch (err) {
      console.error("Fetch dish progress error:", err);
      setDishProgress([]);
    } finally {
      setDishProgressLoading(false);
    }
  };

  const handleOpenHistory = async (visitor: any) => {
    setSelectedVisitor(visitor);
    setShowHistoryModal(true);
    setOrdersLoading(true);
    fetchDishProgress(visitor.Phone);
    try {
      const res = await fetch(
        `${API_URL}/api/loyalty/customer/${encodeURIComponent(visitor.Phone)}/orders`,
      );
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setOrders(data);
      } else {
        setOrders([]);
      }
    } catch (err: any) {
      console.error("Fetch visitor orders error:", err);
      setOrders([]);
    } finally {
      setOrdersLoading(false);
    }
  };

  const handleOpenOrderDetail = async (settlementId: string) => {
    setSelectedOrderId(settlementId);
    setShowOrderDetailModal(true);
    setOrderDetailLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/loyalty/order/${settlementId}`);
      const data = await res.json();
      if (res.ok) {
        setOrderDetailData(data);
      } else {
        setOrderDetailData(null);
      }
    } catch (err: any) {
      console.error("Fetch order detail error:", err);
      setOrderDetailData(null);
    } finally {
      setOrderDetailLoading(false);
    }
  };

  const renderMemberItem = ({ item }: { item: any }) => {
    const hasReward = item.RewardPending === 1 || item.RewardPending === true;
    return (
      <TouchableOpacity
        style={styles.memberCard}
        onPress={() => handleOpenHistory(item)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {item.Name ? item.Name.charAt(0).toUpperCase() : "?"}
            </Text>
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.memberName}>
              {item.Name || "Unnamed Customer"}
            </Text>
            <Text style={styles.memberPhone}>{item.Phone}</Text>
          </View>
          <View style={styles.headerRightActions}>
            {hasReward && (
              <View style={styles.rewardBadge}>
                <MaterialCommunityIcons
                  name="gift"
                  size={12}
                  color="#FFF"
                  style={{ marginRight: 3 }}
                />
                <Text style={styles.rewardBadgeText}>Reward</Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={(e) => {
                e.stopPropagation();
                handleDeleteMember(item.Phone, item.Name);
              }}
            >
              <Ionicons name="trash-outline" size={18} color={Theme.danger} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.cardStats}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Current Cycle</Text>
            <Text style={styles.statValue}>{item.VisitCount || 0} visits</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Lifetime Total</Text>
            <Text style={styles.statValue}>{item.TotalVisits || 0} visits</Text>
          </View>
          <View style={styles.viewHistoryTip}>
            <Text style={styles.viewHistoryTipText}>View History </Text>
            <Ionicons name="chevron-forward" size={14} color={Theme.primary} />
          </View>
        </View>
      </TouchableOpacity>
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
          <Ionicons name="arrow-back" size={20} color={Theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Loyalty Visitors</Text>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
          <TouchableOpacity
            style={[
              styles.enrollBtnHeader,
              {
                backgroundColor: Theme.bgInput,
                borderWidth: 1,
                borderColor: Theme.border,
              },
            ]}
            onPress={() => router.push("/loyaltyConfig" as any)}
          >
            <Ionicons
              name="settings-outline"
              size={16}
              color={Theme.textPrimary}
              style={{ marginRight: 4 }}
            />
            <Text
              style={[styles.enrollBtnHeaderText, { color: Theme.textPrimary }]}
            >
              Config
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.enrollBtnHeader}
            onPress={() => setShowEnrollModal(true)}
          >
            <Ionicons
              name="add-circle-outline"
              size={18}
              color="#FFF"
              style={{ marginRight: 4 }}
            />
            <Text style={styles.enrollBtnHeaderText}>Enroll</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Ionicons
            name="search-outline"
            size={18}
            color={Theme.textSecondary}
            style={styles.searchIcon}
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name or mobile number..."
            value={searchText}
            onChangeText={handleSearch}
            placeholderTextColor={Theme.textMuted}
            autoCapitalize="none"
          />
          {searchText ? (
            <TouchableOpacity onPress={() => handleSearch("")}>
              <Ionicons
                name="close-circle"
                size={18}
                color={Theme.textSecondary}
              />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* Content */}
      {isLoading && !refreshing ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color={Theme.primary} />
        </View>
      ) : (
        <FlatList
          data={members}
          keyExtractor={(item, index) => item.Phone + index}
          renderItem={renderMemberItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Theme.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons
                name="account-search-outline"
                size={48}
                color={Theme.textMuted}
              />
              <Text style={styles.emptyText}>No loyalty members found</Text>
            </View>
          }
        />
      )}

      {/* Enrollment Modal */}
      <Modal
        visible={showEnrollModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowEnrollModal(false)}
      >
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalContent}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>🎉 Enroll New Member</Text>
              <TouchableOpacity onPress={() => setShowEnrollModal(false)}>
                <Ionicons name="close" size={24} color={Theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.inputLabel}>Mobile Number *</Text>
              <View style={styles.inputWrapper}>
                <TouchableOpacity
                  style={styles.countrySelectorBtn}
                  onPress={() => setShowCountryPicker(true)}
                >
                  <Text style={styles.countryCodeText}>
                    {selectedCountry.code}
                  </Text>
                  <Ionicons
                    name="chevron-down"
                    size={12}
                    color={Theme.textSecondary}
                  />
                </TouchableOpacity>
                <View style={styles.verticalDivider} />
                <TextInput
                  style={styles.input}
                  placeholder="91234567"
                  value={enrollPhone}
                  onChangeText={setEnrollPhone}
                  keyboardType="phone-pad"
                  placeholderTextColor={Theme.textMuted}
                />
              </View>

              <Text style={styles.inputLabel}>Customer Name (Optional)</Text>
              <View style={styles.inputWrapper}>
                <Ionicons
                  name="person-outline"
                  size={18}
                  color={Theme.textSecondary}
                  style={{ marginRight: 8 }}
                />
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Javith Doe"
                  value={enrollName}
                  onChangeText={setEnrollName}
                  placeholderTextColor={Theme.textMuted}
                />
              </View>

              <TouchableOpacity
                style={styles.submitBtn}
                onPress={handleEnroll}
                disabled={isEnrolling}
              >
                {isEnrolling ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.submitBtnText}>Enrol Member</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Order History Modal */}
      <Modal
        visible={showHistoryModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowHistoryModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.largeModal]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>📜 Order History</Text>
                <Text style={styles.modalSubtitle}>
                  {selectedVisitor?.Name || "Unnamed"} ({selectedVisitor?.Phone}
                  )
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowHistoryModal(false)}>
                <Ionicons name="close" size={24} color={Theme.textSecondary} />
              </TouchableOpacity>
            </View>

            {ordersLoading ? (
              <View style={styles.modalLoaderContainer}>
                <ActivityIndicator size="large" color={Theme.primary} />
              </View>
            ) : (
              <FlatList
                data={orders}
                keyExtractor={(item) => item.SettlementID}
                contentContainerStyle={styles.historyList}
                ListHeaderComponent={
                  dishProgress.length > 0 ? (
                    <View style={styles.dishProgressSection}>
                      <Text style={styles.sectionLabel}>
                        🍽️ DISH LOYALTY PROGRESS
                      </Text>
                      {dishProgress.map((prog) => {
                        const progressPercent = Math.min(
                          100,
                          Math.round(
                            (prog.CurrentCount / prog.RequiredBills) * 100,
                          ),
                        );
                        return (
                          <View
                            key={prog.RuleId}
                            style={styles.dishProgressCard}
                          >
                            <View style={styles.dishProgressHeader}>
                              <Text style={styles.dishProgressName}>
                                {prog.CampaignName} ({prog.LoyaltyType === "DishGroup" ? `${prog.PurchaseDishName} (Group)` : prog.PurchaseDishName})
                              </Text>
                              {prog.RewardsAvailable > 0 && (
                                <View style={styles.dishRewardBadge}>
                                  <MaterialCommunityIcons
                                    name="gift"
                                    size={12}
                                    color="#FFF"
                                    style={{ marginRight: 3 }}
                                  />
                                  <Text style={styles.dishRewardBadgeText}>
                                    {prog.RewardsAvailable} Free
                                  </Text>
                                </View>
                              )}
                            </View>
                            <View style={styles.progressBarBg}>
                              <View
                                style={[
                                  styles.progressBarFill,
                                  { width: `${progressPercent}%` },
                                ]}
                              />
                            </View>
                            <View style={styles.dishProgressFooter}>
                              <Text style={styles.dishProgressText}>
                                {prog.CurrentCount} / {prog.RequiredBills}{" "}
                                quantities purchased
                              </Text>
                              <Text style={styles.dishRewardTarget}>
                                Reward: Free {prog.LoyaltyType === "DishGroup" ? `${prog.RewardDishName} (Group)` : prog.RewardDishName}
                              </Text>
                            </View>
                          </View>
                        );
                      })}
                      <View
                        style={[styles.detailsDivider, { marginVertical: 16 }]}
                      />
                      <Text style={styles.sectionLabel}>📜 ORDER HISTORY</Text>
                    </View>
                  ) : null
                }
                renderItem={({ item }) => {
                  const isCancelled =
                    item.IsCancelled === 1 || item.IsCancelled === true;
                  return (
                    <TouchableOpacity
                      style={styles.orderRowCard}
                      onPress={() => handleOpenOrderDetail(item.SettlementID)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.orderRowHeader}>
                        {/* Left: Order Info */}
                        <View style={{ flex: 1.5 }}>
                          <Text style={styles.orderNumberText}>
                            Order: {item.BillNo}
                          </Text>
                          <Text style={styles.orderTimeText}>
                            {formatToSingaporeDate(item.OrderDateTime)} •{" "}
                            {formatToSingaporeTime(item.OrderDateTime)}
                          </Text>
                        </View>

                        {/* Center: Status Badge */}
                        <View
                          style={{
                            flex: 1,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <View
                            style={[
                              styles.statusBadge,
                              {
                                backgroundColor: isCancelled
                                  ? Theme.danger
                                  : Theme.success,
                              },
                            ]}
                          >
                            <Text style={styles.statusBadgeText}>
                              {isCancelled ? "Cancelled" : "Completed"}
                            </Text>
                          </View>
                        </View>

                        {/* Right: Price & PayMode */}
                        <View style={{ flex: 1.2, alignItems: "flex-end" }}>
                          <Text style={styles.orderAmountText}>
                            ${parseFloat(item.TotalAmount || 0).toFixed(2)}
                          </Text>
                          {item.PayMode && (
                            <View
                              style={[
                                styles.payModeBadge,
                                {
                                  backgroundColor: Theme.primaryLight,
                                  marginTop: 6,
                                },
                              ]}
                            >
                              <Text style={styles.payModeBadgeText}>
                                {item.PayMode}
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <View style={styles.emptyContainer}>
                    <MaterialCommunityIcons
                      name="receipt"
                      size={40}
                      color={Theme.textMuted}
                    />
                    <Text style={styles.emptyText}>
                      No orders recorded for this customer
                    </Text>
                  </View>
                }
              />
            )}
          </View>
        </View>
      </Modal>

      {/* Order Detail Modal */}
      <Modal
        visible={showOrderDetailModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowOrderDetailModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, styles.detailsModal]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>📦 Order Details</Text>
                <Text style={styles.modalSubtitle}>
                  Order #{orderDetailData?.order?.BillNo || ""}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setShowOrderDetailModal(false)}>
                <Ionicons name="close" size={24} color={Theme.textSecondary} />
              </TouchableOpacity>
            </View>

            {orderDetailLoading ? (
              <View style={styles.modalLoaderContainer}>
                <ActivityIndicator size="large" color={Theme.primary} />
              </View>
            ) : orderDetailData ? (
              <View style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={styles.detailsScrollView}>
                  {/* Items List */}
                  <Text style={styles.sectionLabel}>ITEMS</Text>
                  {orderDetailData.items.map((item: any, idx: number) => {
                    const lineTotal = (item.Qty || 0) * (item.Price || 0);
                    return (
                      <View key={idx} style={styles.detailItemRow}>
                        <View style={{ flex: 2 }}>
                          <Text style={styles.dishNameText}>
                            {item.DishName}
                          </Text>
                          <Text style={styles.dishPriceText}>
                            {item.Qty} x $
                            {parseFloat(item.Price || 0).toFixed(2)}
                          </Text>
                        </View>
                        <Text style={styles.dishTotalText}>
                          ${lineTotal.toFixed(2)}
                        </Text>
                      </View>
                    );
                  })}

                  <View style={styles.detailsDivider} />

                  {/* Summary / Totals */}
                  <View style={styles.summaryRow}>
                    <Text style={styles.summaryLabel}>Subtotal</Text>
                    <Text style={styles.summaryValue}>
                      $
                      {parseFloat(orderDetailData.order.SubTotal || 0).toFixed(
                        2,
                      )}
                    </Text>
                  </View>

                  {parseFloat(orderDetailData.order.DiscountAmount || 0) >
                    0 && (
                    <View style={styles.summaryRow}>
                      <Text
                        style={[styles.summaryLabel, { color: Theme.danger }]}
                      >
                        Discount
                      </Text>
                      <Text
                        style={[styles.summaryValue, { color: Theme.danger }]}
                      >
                        -$
                        {parseFloat(
                          orderDetailData.order.DiscountAmount || 0,
                        ).toFixed(2)}
                      </Text>
                    </View>
                  )}

                  {parseFloat(orderDetailData.order.ServiceCharge || 0) > 0 && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Service Charge</Text>
                      <Text style={styles.summaryValue}>
                        $
                        {parseFloat(
                          orderDetailData.order.ServiceCharge || 0,
                        ).toFixed(2)}
                      </Text>
                    </View>
                  )}

                  {parseFloat(orderDetailData.order.TotalTax || 0) > 0 && (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Taxes</Text>
                      <Text style={styles.summaryValue}>
                        $
                        {parseFloat(
                          orderDetailData.order.TotalTax || 0,
                        ).toFixed(2)}
                      </Text>
                    </View>
                  )}

                  <View style={styles.detailsDivider} />

                  <View style={styles.totalRow}>
                    <Text style={styles.totalLabel}>Grand Total</Text>
                    <Text style={styles.totalValue}>
                      $
                      {parseFloat(
                        orderDetailData.order.TotalAmount || 0,
                      ).toFixed(2)}
                    </Text>
                  </View>
                </ScrollView>
              </View>
            ) : (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>
                  Failed to load order details
                </Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
      {/* Custom Delete Confirmation Modal */}
      <Modal
        visible={showDeleteConfirm}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setShowDeleteConfirm(false);
          setVisitorToDelete(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.deleteModalContent}>
            <View style={styles.deleteModalHeader}>
              <Text style={styles.deleteModalTitle}>Delete Visitor</Text>
            </View>

            <View style={styles.deleteModalBody}>
              <Text style={styles.deleteModalText}>
                Are you sure you want to delete this loyalty visitor? This
                action cannot be undone.
              </Text>
            </View>

            <View style={styles.deleteModalActions}>
              <TouchableOpacity
                style={styles.deleteCancelBtn}
                onPress={() => {
                  setShowDeleteConfirm(false);
                  setVisitorToDelete(null);
                }}
                disabled={isDeleting}
              >
                <Text style={styles.deleteCancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.deleteConfirmBtn}
                onPress={executeDeleteVisitor}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.deleteConfirmBtnText}>Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* COUNTRY PICKER MODAL */}
      <Modal transparent visible={showCountryPicker} animationType="fade">
        <TouchableWithoutFeedback onPress={() => setShowCountryPicker(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalContent, { maxWidth: 300, padding: 15 }]}>
              <Text
                style={[styles.modalTitle, { fontSize: 16, marginBottom: 15 }]}
              >
                Select Country
              </Text>
              {COUNTRIES.map((country) => (
                <TouchableOpacity
                  key={country.code}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 12,
                    paddingHorizontal: 8,
                    borderRadius: 8,
                    backgroundColor:
                      selectedCountry.code === country.code
                        ? Theme.bgNav
                        : "transparent",
                    gap: 12,
                  }}
                  onPress={() => {
                    setSelectedCountry(country);
                    setShowCountryPicker(false);
                  }}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      fontFamily: Fonts.bold,
                      color: Theme.textPrimary,
                    }}
                  >
                    {country.code}
                  </Text>
                  <Text
                    style={{
                      fontSize: 13,
                      fontFamily: Fonts.regular,
                      color: Theme.textSecondary,
                      flex: 1,
                    }}
                  >
                    {country.name}
                  </Text>
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
  container: {
    flex: 1,
    backgroundColor: Theme.bgMain,
  },
  dishProgressSection: {
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  dishProgressCard: {
    backgroundColor: Theme.bgCard,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  dishProgressHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  dishProgressName: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  dishRewardBadge: {
    flexDirection: "row",
    backgroundColor: Theme.success,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 4,
    alignItems: "center",
  },
  dishRewardBadgeText: {
    color: "#FFF",
    fontSize: 10,
    fontFamily: Fonts.bold,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: Theme.bgInput,
    borderRadius: 4,
    overflow: "hidden",
    marginBottom: 6,
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: Theme.primary,
    borderRadius: 4,
  },
  dishProgressFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  dishProgressText: {
    fontSize: 11,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
  },
  dishRewardTarget: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.primary,
  },
  header: {
    flexDirection: "row",
    height: 56,
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    backgroundColor: Theme.bgCard,
  },
  backBtn: {
    padding: 8,
    borderRadius: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  enrollBtnHeader: {
    flexDirection: "row",
    backgroundColor: Theme.primary,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center",
    ...Theme.shadowSm,
  },
  enrollBtnHeaderText: {
    color: "#FFF",
    fontSize: 13,
    fontFamily: Fonts.bold,
  },
  searchContainer: {
    padding: 12,
    backgroundColor: Theme.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.bgInput,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 40,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
    ...Platform.select({ web: { outlineStyle: "none" } as any }),
  },
  loaderContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  listContent: {
    padding: 12,
    paddingBottom: 24,
  },
  memberCard: {
    backgroundColor: Theme.bgCard,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowSm,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Theme.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarText: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: Theme.primary,
  },
  cardInfo: {
    flex: 1,
    justifyContent: "center",
  },
  memberName: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  memberPhone: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginTop: 2,
  },
  headerRightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rewardBadge: {
    flexDirection: "row",
    backgroundColor: Theme.primary,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    alignItems: "center",
  },
  rewardBadgeText: {
    color: "#FFF",
    fontSize: 10,
    fontFamily: Fonts.bold,
  },
  deleteBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: Theme.dangerBg,
  },
  divider: {
    height: 1,
    backgroundColor: Theme.border,
    marginVertical: 12,
  },
  cardStats: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statBox: {
    flex: 1,
  },
  statLabel: {
    fontSize: 11,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  viewHistoryTip: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 8,
  },
  viewHistoryTipText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.primary,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 64,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textMuted,
    marginTop: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: Theme.bgCard,
    borderRadius: 16,
    width: "100%",
    maxWidth: 400,
    padding: 20,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowLg,
  },
  largeModal: {
    maxWidth: 600,
    height: "80%",
  },
  detailsModal: {
    maxWidth: 500,
    height: "70%",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    paddingBottom: 12,
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  modalSubtitle: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginTop: 2,
  },
  modalBody: {
    gap: 12,
  },
  inputLabel: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.bgInput,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 48,
    borderWidth: 1,
    borderColor: Theme.border,
    marginBottom: 4,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
    ...Platform.select({ web: { outlineStyle: "none" } as any }),
  },
  submitBtn: {
    backgroundColor: Theme.primary,
    borderRadius: 10,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
    ...Theme.shadowSm,
  },
  submitBtnText: {
    color: "#FFF",
    fontSize: 16,
    fontFamily: Fonts.bold,
  },
  modalLoaderContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  historyList: {
    paddingBottom: 12,
    paddingHorizontal: 8,
  },
  orderRowCard: {
    backgroundColor: Theme.bgMain,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  orderRowHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  orderNumberText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  orderTimeText: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginTop: 4,
  },
  orderRightBox: {
    alignItems: "flex-end",
  },
  orderAmountText: {
    fontSize: 15,
    fontFamily: Fonts.black,
    color: Theme.primary,
  },
  badgeRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
    alignItems: "center",
  },
  statusBadge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  statusBadgeText: {
    color: "#FFF",
    fontSize: 10,
    fontFamily: Fonts.bold,
    lineHeight: 12,
  },
  payModeBadge: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  payModeBadgeText: {
    color: Theme.primary,
    fontSize: 10,
    fontFamily: Fonts.bold,
    lineHeight: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontFamily: Fonts.black,
    color: Theme.textSecondary,
    marginBottom: 8,
  },
  detailsScrollView: {
    paddingBottom: 20,
  },
  detailItemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Theme.bgInput,
  },
  dishNameText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  dishPriceText: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginTop: 2,
  },
  dishTotalText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  detailsDivider: {
    height: 1,
    backgroundColor: Theme.border,
    marginVertical: 12,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginVertical: 4,
  },
  summaryLabel: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
  },
  summaryValue: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  totalLabel: {
    fontSize: 16,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  totalValue: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: Theme.primary,
  },
  deleteModalContent: {
    backgroundColor: Theme.bgCard,
    borderRadius: 16,
    width: "100%",
    maxWidth: 360,
    padding: 20,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowLg,
  },
  deleteModalHeader: {
    paddingBottom: 10,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
  },
  deleteModalTitle: {
    fontSize: 16,
    fontFamily: Fonts.black,
    color: Theme.danger,
  },
  deleteModalBody: {
    marginBottom: 20,
  },
  deleteModalText: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
    lineHeight: 20,
  },
  deleteModalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  deleteCancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: Theme.bgInput,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  deleteCancelBtnText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  deleteConfirmBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: Theme.danger,
  },
  deleteConfirmBtnText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: "#FFF",
  },
  countrySelectorBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
    height: "100%",
    justifyContent: "center",
  },
  countryFlagText: {
    fontSize: 18,
  },
  countryCodeText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  verticalDivider: {
    width: 1,
    height: 24,
    backgroundColor: Theme.border,
    marginHorizontal: 12,
  },
});
