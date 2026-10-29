import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Modal,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  StatusBar,
  ScrollView,
  TouchableWithoutFeedback,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { Theme } from "../constants/theme";
import { Fonts } from "../constants/Fonts";
import { API_URL } from "@/constants/Config";
import { useAuthStore } from "@/stores/authStore";
import { useToast } from "../components/Toast";

export default function LoyaltyConfigScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  const [configs, setConfigs] = useState<any[]>([]);
  const [dishes, setDishes] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

  // Modal States
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [ruleId, setRuleId] = useState<string | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [purchaseDishId, setPurchaseDishId] = useState("");
  const [rewardDishId, setRewardDishId] = useState("");
  const [requiredBills, setRequiredBills] = useState("9");
  const [isActive, setIsActive] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Search dropdowns inside modal
  const [showPurchaseDropdown, setShowPurchaseDropdown] = useState(false);
  const [showRewardDropdown, setShowRewardDropdown] = useState(false);
  const [purchaseSearch, setPurchaseSearch] = useState("");
  const [rewardSearch, setRewardSearch] = useState("");

  // Dish Group Loyalty states
  const [loyaltyType, setLoyaltyType] = useState<"Dish" | "DishGroup">("Dish");
  const [purchaseDishGroupId, setPurchaseDishGroupId] = useState("");
  const [rewardDishGroupId, setRewardDishGroupId] = useState("");
  const [dishGroups, setDishGroups] = useState<any[]>([]);
  const [showDishGroupDropdown, setShowDishGroupDropdown] = useState(false);
  const [showRewardGroupDropdown, setShowRewardGroupDropdown] = useState(false);
  const [dishGroupSearch, setDishGroupSearch] = useState("");
  const [rewardGroupSearch, setRewardGroupSearch] = useState("");

  const fetchConfigs = async () => {
    setIsLoading(true);
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(`${API_URL}/api/loyalty/configs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setConfigs(data);
      } else {
        setConfigs([]);
      }
    } catch (err: any) {
      console.error("Fetch loyalty configs error:", err);
      showToast({ type: "error", message: "Failed to load loyalty configurations" });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDishes = async () => {
    try {
      const res = await fetch(`${API_URL}/api/menu/dishes/all`);
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setDishes(data);
      }
    } catch (err) {
      console.error("Fetch dishes error:", err);
    }
  };

  const fetchDishGroups = async () => {
    try {
      const res = await fetch(`${API_URL}/api/menu/dishgroups/all`);
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setDishGroups(data);
      }
    } catch (err) {
      console.error("Fetch dish groups error:", err);
    }
  };

  useEffect(() => {
    fetchConfigs();
    fetchDishes();
    fetchDishGroups();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchConfigs();
    setRefreshing(false);
  };

  const handleSave = async () => {
    if (!campaignName.trim()) {
      showToast({ type: "error", message: "Please enter a campaign name." });
      return;
    }
    if (loyaltyType === "Dish" && !purchaseDishId) {
      showToast({ type: "error", message: "Please select a purchase dish." });
      return;
    }
    if (loyaltyType === "DishGroup" && !purchaseDishGroupId) {
      showToast({ type: "error", message: "Please select a purchase dish group." });
      return;
    }
    if (loyaltyType === "Dish" && !rewardDishId) {
      showToast({ type: "error", message: "Please select a reward dish." });
      return;
    }
    if (loyaltyType === "DishGroup" && !rewardDishGroupId) {
      showToast({ type: "error", message: "Please select a reward dish group." });
      return;
    }
    const bills = parseInt(requiredBills);
    if (isNaN(bills) || bills <= 0) {
      showToast({ type: "error", message: "Required bills must be a positive number greater than 0." });
      return;
    }

    setIsSaving(true);
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(`${API_URL}/api/loyalty/configs/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ruleId,
          campaignName,
          loyaltyType,
          purchaseDishId: loyaltyType === "Dish" ? purchaseDishId : null,
          purchaseDishGroupId: loyaltyType === "DishGroup" ? purchaseDishGroupId : null,
          rewardDishId: loyaltyType === "Dish" ? rewardDishId : null,
          rewardDishGroupId: loyaltyType === "DishGroup" ? rewardDishGroupId : null,
          requiredBills: bills,
          isActive,
          startDate: startDate ? new Date(startDate).toISOString() : null,
          endDate: endDate ? new Date(endDate).toISOString() : null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save configuration");
      }

      showToast({ type: "success", message: "Loyalty configuration saved successfully." });
      setShowSaveModal(false);
      resetForm();
      fetchConfigs();
    } catch (err: any) {
      showToast({ type: "error", message: err.message });
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (id: string, currentStatus: boolean) => {
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(`${API_URL}/api/loyalty/configs/${id}/toggle`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ isActive: !currentStatus }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to toggle status");
      }

      showToast({ type: "success", message: data.message });
      fetchConfigs();
    } catch (err: any) {
      showToast({ type: "error", message: err.message });
    }
  };

  const handleDelete = (id: string) => {
    setDeleteConfirmId(id);
  };

  const performDelete = async (id: string) => {
    try {
      const token = useAuthStore.getState().token;
      const res = await fetch(`${API_URL}/api/loyalty/configs/${id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to delete configuration");
      }

      showToast({ type: "success", message: "Loyalty configuration deleted successfully." });
      setDeleteConfirmId(null);
      fetchConfigs();
    } catch (err: any) {
      showToast({ type: "error", message: err.message });
    }
  };

  const openEditModal = (config: any) => {
    setRuleId(config.RuleId);
    setCampaignName(config.CampaignName);
    const type = config.LoyaltyType || "Dish";
    setLoyaltyType(type);
    
    setPurchaseDishId(config.PurchaseDishId || "");
    setPurchaseDishGroupId(config.PurchaseDishGroupId || "");
    setRewardDishId(config.RewardDishId || "");
    setRewardDishGroupId(config.RewardDishGroupId || "");
    setRequiredBills(String(config.RequiredBills));
    setIsActive(config.IsActive === 1 || config.IsActive === true);
    setStartDate(config.StartDate ? config.StartDate.split("T")[0] : "");
    setEndDate(config.EndDate ? config.EndDate.split("T")[0] : "");
    
    if (type === "Dish") {
      const pDish = dishes.find(d => d.DishId === config.PurchaseDishId);
      setPurchaseSearch(pDish ? pDish.Name : "");
      setDishGroupSearch("");

      const rDish = dishes.find(d => d.DishId === config.RewardDishId);
      setRewardSearch(rDish ? rDish.Name : "");
      setRewardGroupSearch("");
    } else {
      const pGroup = dishGroups.find(dg => dg.DishGroupId === config.PurchaseDishGroupId);
      setDishGroupSearch(pGroup ? pGroup.DishGroupName : "");
      setPurchaseSearch("");

      const rGroup = dishGroups.find(dg => dg.DishGroupId === config.RewardDishGroupId);
      setRewardGroupSearch(rGroup ? rGroup.DishGroupName : "");
      setRewardSearch("");
    }

    setShowSaveModal(true);
  };

  const resetForm = () => {
    setRuleId(null);
    setCampaignName("");
    setLoyaltyType("Dish");
    setPurchaseDishId("");
    setPurchaseDishGroupId("");
    setRewardDishId("");
    setRewardDishGroupId("");
    setRequiredBills("9");
    setIsActive(true);
    setStartDate("");
    setEndDate("");
    setPurchaseSearch("");
    setDishGroupSearch("");
    setRewardSearch("");
    setRewardGroupSearch("");
  };

  const getFilteredConfigs = () => {
    return configs.filter(c => {
      const matchesSearch =
        c.CampaignName?.toLowerCase().includes(searchText.toLowerCase()) ||
        c.PurchaseDishName?.toLowerCase().includes(searchText.toLowerCase()) ||
        c.PurchaseDishGroupName?.toLowerCase().includes(searchText.toLowerCase()) ||
        c.RewardDishName?.toLowerCase().includes(searchText.toLowerCase()) ||
        c.RewardDishGroupName?.toLowerCase().includes(searchText.toLowerCase());

      const isActiveBool = c.IsActive === 1 || c.IsActive === true;
      if (statusFilter === "active") return matchesSearch && isActiveBool;
      if (statusFilter === "inactive") return matchesSearch && !isActiveBool;
      return matchesSearch;
    });
  };

  const purchaseDishesFiltered = dishes.filter(d =>
    d.Name?.toLowerCase().includes(purchaseSearch.toLowerCase())
  );

  const rewardDishesFiltered = dishes.filter(d =>
    d.Name?.toLowerCase().includes(rewardSearch.toLowerCase())
  );

  const dishGroupsFiltered = dishGroups.filter(dg =>
    dg.DishGroupName?.toLowerCase().includes(dishGroupSearch.toLowerCase())
  );

  const rewardGroupsFiltered = dishGroups.filter(dg =>
    dg.DishGroupName?.toLowerCase().includes(rewardGroupSearch.toLowerCase())
  );

  const getPurchaseDishName = () => {
    const dish = dishes.find(d => d.DishId === purchaseDishId);
    return dish ? dish.Name : "Select Purchase Dish";
  };

  const getPurchaseGroupName = () => {
    const group = dishGroups.find(dg => dg.DishGroupId === purchaseDishGroupId);
    return group ? group.DishGroupName : "Select Purchase Dish Group";
  };

  const getRewardDishName = () => {
    const dish = dishes.find(d => d.DishId === rewardDishId);
    return dish ? dish.Name : "Select Reward Dish";
  };

  const getRewardGroupName = () => {
    const group = dishGroups.find(dg => dg.DishGroupId === rewardDishGroupId);
    return group ? group.DishGroupName : "Select Reward Dish Group";
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
              router.replace("/loyalty" as any);
            }
          }} 
          style={styles.backBtn}
        >
          <Ionicons name="arrow-back" size={20} color={Theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Loyalty Programs</Text>
        <TouchableOpacity 
          style={styles.createBtn}
          onPress={() => {
            resetForm();
            setShowSaveModal(true);
          }}
        >
          <Ionicons name="add" size={18} color="#FFF" style={{ marginRight: 4 }} />
          <Text style={styles.createBtnText}>Create Rule</Text>
        </TouchableOpacity>
      </View>

      {/* Search & Filters */}
      <View style={styles.searchFilterContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={18} color={Theme.textSecondary} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search campaigns or dishes..."
            value={searchText}
            onChangeText={setSearchText}
            placeholderTextColor={Theme.textMuted}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.filterBar}>
          {(["all", "active", "inactive"] as const).map((filter) => (
            <TouchableOpacity
              key={filter}
              style={[styles.filterTab, statusFilter === filter && styles.filterTabActive]}
              onPress={() => setStatusFilter(filter)}
            >
              <Text style={[styles.filterTabText, statusFilter === filter && styles.filterTabTextActive]}>
                {filter.toUpperCase()}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* List */}
      {isLoading && !refreshing ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color={Theme.primary} />
        </View>
      ) : (
        <FlatList
          data={getFilteredConfigs()}
          keyExtractor={(item) => item.RuleId}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Theme.primary} />
          }
          renderItem={({ item }) => {
            const active = item.IsActive === 1 || item.IsActive === true;
            return (
              <View style={[styles.card, !active && styles.inactiveCard]}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.campaignName}>{item.CampaignName}</Text>
                    <Text style={styles.dateRange}>
                      {item.StartDate ? item.StartDate.split("T")[0] : ""} to {item.EndDate ? item.EndDate.split("T")[0] : ""}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, active ? styles.activeBadge : styles.inactiveBadge]}>
                    <Text style={[styles.statusBadgeText, active ? styles.activeBadgeText : styles.inactiveBadgeText]}>
                      {active ? "Active" : "Inactive"}
                    </Text>
                  </View>
                </View>

                <View style={styles.cardDetails}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Buy Item:</Text>
                    <Text style={styles.detailValue}>
                      {item.LoyaltyType === "DishGroup" 
                        ? `${item.PurchaseDishGroupName || "Unknown"} (Group)` 
                        : item.PurchaseDishName || "Unknown"}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Free Reward:</Text>
                    <Text style={styles.detailValue}>
                      {item.LoyaltyType === "DishGroup" 
                        ? `${item.RewardDishGroupName || "Unknown"} (Group)` 
                        : item.RewardDishName || "Unknown"}
                    </Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Required Qty:</Text>
                    <Text style={styles.detailValue}>{item.RequiredBills} Quantities Purchased</Text>
                  </View>
                </View>

                <View style={styles.cardActions}>
                  <TouchableOpacity style={styles.editBtn} onPress={() => openEditModal(item)}>
                    <Ionicons name="create-outline" size={16} color={Theme.primary} style={{ marginRight: 4 }} />
                    <Text style={styles.editBtnText}>Edit</Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={[styles.toggleBtn, active ? styles.deactivateBtn : styles.activateBtn]} 
                    onPress={() => handleToggleActive(item.RuleId, active)}
                  >
                    <Ionicons 
                      name={active ? "pause-outline" : "play-outline"} 
                      size={16} 
                      color={active ? Theme.danger : Theme.success} 
                      style={{ marginRight: 4 }} 
                    />
                    <Text style={[styles.toggleBtnText, { color: active ? Theme.danger : Theme.success }]}>
                      {active ? "Deactivate" : "Activate"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity 
                    style={styles.deleteBtn} 
                    onPress={() => handleDelete(item.RuleId)}
                  >
                    <Ionicons 
                      name="trash-outline" 
                      size={16} 
                      color={Theme.danger} 
                      style={{ marginRight: 4 }} 
                    />
                    <Text style={styles.deleteBtnText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="playlist-remove" size={48} color={Theme.textMuted} />
              <Text style={styles.emptyText}>No loyalty rules configured</Text>
            </View>
          }
        />
      )}

      {/* Save Config Modal */}
      <Modal visible={showSaveModal} transparent animationType="fade" onRequestClose={() => setShowSaveModal(false)}>
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{ruleId ? "✏️ Edit Loyalty Program" : "🎉 New Loyalty Program"}</Text>
              <TouchableOpacity onPress={() => setShowSaveModal(false)}>
                <Ionicons name="close" size={24} color={Theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ flexShrink: 1, width: "100%" }} contentContainerStyle={{ gap: 14 }} showsVerticalScrollIndicator={false}>
              {/* Campaign Name */}
              <View>
                <Text style={styles.inputLabel}>Campaign Name *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Coffee Lovers Special"
                  value={campaignName}
                  onChangeText={setCampaignName}
                  placeholderTextColor={Theme.textMuted}
                />
              </View>
              {/* Loyalty Type Selection */}
              <View>
                <Text style={styles.inputLabel}>Loyalty Type *</Text>
                <View style={{ flexDirection: "row", gap: 10, marginTop: 4, marginBottom: 12 }}>
                  <TouchableOpacity
                    style={[
                      styles.typeBtn,
                      loyaltyType === "Dish" ? styles.typeBtnActive : null
                    ]}
                    onPress={() => {
                      setLoyaltyType("Dish");
                      setShowPurchaseDropdown(false);
                      setShowDishGroupDropdown(false);
                    }}
                  >
                    <Text style={[
                      styles.typeBtnText,
                      loyaltyType === "Dish" ? styles.typeBtnTextActive : null
                    ]}>Dish Based</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.typeBtn,
                      loyaltyType === "DishGroup" ? styles.typeBtnActive : null
                    ]}
                    onPress={() => {
                      setLoyaltyType("DishGroup");
                      setShowPurchaseDropdown(false);
                      setShowDishGroupDropdown(false);
                    }}
                  >
                    <Text style={[
                      styles.typeBtnText,
                      loyaltyType === "DishGroup" ? styles.typeBtnTextActive : null
                    ]}>Dish Group Based</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Purchase Selection */}
              {loyaltyType === "Dish" ? (
                <View style={{ zIndex: 100 }}>
                  <Text style={styles.inputLabel}>Purchase Dish *</Text>
                  <TouchableOpacity 
                    style={styles.dropdownTrigger}
                    onPress={() => {
                      setShowPurchaseDropdown(!showPurchaseDropdown);
                      setShowRewardDropdown(false);
                      setShowDishGroupDropdown(false);
                    }}
                  >
                    <Text style={[styles.dropdownTriggerText, purchaseDishId ? styles.dropdownSelected : null]}>
                      {getPurchaseDishName()}
                    </Text>
                    <Ionicons name="chevron-down" size={14} color={Theme.textSecondary} />
                  </TouchableOpacity>

                  {showPurchaseDropdown && (
                    <View style={styles.dropdownContainer}>
                      <TextInput
                        style={styles.dropdownSearch}
                        placeholder="Search dish..."
                        value={purchaseSearch}
                        onChangeText={setPurchaseSearch}
                        placeholderTextColor={Theme.textMuted}
                      />
                      <ScrollView style={{ maxHeight: 150 }} keyboardShouldPersistTaps="handled">
                        {purchaseDishesFiltered.map((dish) => (
                          <TouchableOpacity
                            key={dish.DishId}
                            style={styles.dropdownItem}
                            onPress={() => {
                              setPurchaseDishId(dish.DishId);
                              setPurchaseSearch(dish.Name);
                              setShowPurchaseDropdown(false);
                            }}
                          >
                            <Text style={styles.dropdownItemText}>{dish.Name}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </View>
              ) : (
                <View style={{ zIndex: 100 }}>
                  <Text style={styles.inputLabel}>Purchase Dish Group *</Text>
                  <TouchableOpacity 
                    style={styles.dropdownTrigger}
                    onPress={() => {
                      setShowDishGroupDropdown(!showDishGroupDropdown);
                      setShowRewardDropdown(false);
                      setShowPurchaseDropdown(false);
                    }}
                  >
                    <Text style={[styles.dropdownTriggerText, purchaseDishGroupId ? styles.dropdownSelected : null]}>
                      {getPurchaseGroupName()}
                    </Text>
                    <Ionicons name="chevron-down" size={14} color={Theme.textSecondary} />
                  </TouchableOpacity>

                  {showDishGroupDropdown && (
                    <View style={styles.dropdownContainer}>
                      <TextInput
                        style={styles.dropdownSearch}
                        placeholder="Search group..."
                        value={dishGroupSearch}
                        onChangeText={setDishGroupSearch}
                        placeholderTextColor={Theme.textMuted}
                      />
                      <ScrollView style={{ maxHeight: 150 }} keyboardShouldPersistTaps="handled">
                        {dishGroupsFiltered.map((group) => (
                          <TouchableOpacity
                            key={group.DishGroupId}
                            style={styles.dropdownItem}
                            onPress={() => {
                              setPurchaseDishGroupId(group.DishGroupId);
                              setDishGroupSearch(group.DishGroupName);
                              setShowDishGroupDropdown(false);
                            }}
                          >
                            <Text style={styles.dropdownItemText}>{group.DishGroupName}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </View>
              )}

              {/* Reward Selection */}
              {loyaltyType === "Dish" ? (
                <View style={{ zIndex: 90 }}>
                  <Text style={styles.inputLabel}>Reward Dish (Free Item) *</Text>
                  <TouchableOpacity 
                    style={styles.dropdownTrigger}
                    onPress={() => {
                      setShowRewardDropdown(!showRewardDropdown);
                      setShowPurchaseDropdown(false);
                      setShowDishGroupDropdown(false);
                      setShowRewardGroupDropdown(false);
                    }}
                  >
                    <Text style={[styles.dropdownTriggerText, rewardDishId ? styles.dropdownSelected : null]}>
                      {getRewardDishName()}
                    </Text>
                    <Ionicons name="chevron-down" size={14} color={Theme.textSecondary} />
                  </TouchableOpacity>

                  {showRewardDropdown && (
                    <View style={styles.dropdownContainer}>
                      <TextInput
                        style={styles.dropdownSearch}
                        placeholder="Search dish..."
                        value={rewardSearch}
                        onChangeText={setRewardSearch}
                        placeholderTextColor={Theme.textMuted}
                      />
                      <ScrollView style={{ maxHeight: 150 }} keyboardShouldPersistTaps="handled">
                        {rewardDishesFiltered.map((dish) => (
                          <TouchableOpacity
                            key={dish.DishId}
                            style={styles.dropdownItem}
                            onPress={() => {
                              setRewardDishId(dish.DishId);
                              setRewardSearch(dish.Name);
                              setShowRewardDropdown(false);
                            }}
                          >
                            <Text style={styles.dropdownItemText}>{dish.Name}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </View>
              ) : (
                <View style={{ zIndex: 90 }}>
                  <Text style={styles.inputLabel}>Reward Dish Group (Free Item Group) *</Text>
                  <TouchableOpacity 
                    style={styles.dropdownTrigger}
                    onPress={() => {
                      setShowRewardGroupDropdown(!showRewardGroupDropdown);
                      setShowPurchaseDropdown(false);
                      setShowDishGroupDropdown(false);
                      setShowRewardDropdown(false);
                    }}
                  >
                    <Text style={[styles.dropdownTriggerText, rewardDishGroupId ? styles.dropdownSelected : null]}>
                      {getRewardGroupName()}
                    </Text>
                    <Ionicons name="chevron-down" size={14} color={Theme.textSecondary} />
                  </TouchableOpacity>

                  {showRewardGroupDropdown && (
                    <View style={styles.dropdownContainer}>
                      <TextInput
                        style={styles.dropdownSearch}
                        placeholder="Search group..."
                        value={rewardGroupSearch}
                        onChangeText={setRewardGroupSearch}
                        placeholderTextColor={Theme.textMuted}
                      />
                      <ScrollView style={{ maxHeight: 150 }} keyboardShouldPersistTaps="handled">
                        {rewardGroupsFiltered.map((group) => (
                          <TouchableOpacity
                            key={group.DishGroupId}
                            style={styles.dropdownItem}
                            onPress={() => {
                              setRewardDishGroupId(group.DishGroupId);
                              setRewardGroupSearch(group.DishGroupName);
                              setShowRewardGroupDropdown(false);
                            }}
                          >
                            <Text style={styles.dropdownItemText}>{group.DishGroupName}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </View>
              )}

              {/* Required Quantity & Status */}
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Required Quantity *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 9"
                    value={requiredBills}
                    onChangeText={setRequiredBills}
                    keyboardType="numeric"
                    placeholderTextColor={Theme.textMuted}
                  />
                </View>
                <View style={{ flex: 1, justifyContent: "center" }}>
                  <Text style={styles.inputLabel}>Status</Text>
                  <TouchableOpacity 
                    style={[styles.statusToggleBtn, isActive ? styles.statusToggleBtnActive : null]}
                    onPress={() => setIsActive(!isActive)}
                  >
                    <Text style={[styles.statusToggleText, isActive ? styles.statusToggleTextActive : null]}>
                      {isActive ? "Active" : "Inactive"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Dates */}
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Start Date (Optional)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    value={startDate}
                    onChangeText={setStartDate}
                    placeholderTextColor={Theme.textMuted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>End Date (Optional)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    value={endDate}
                    onChangeText={setEndDate}
                    placeholderTextColor={Theme.textMuted}
                  />
                </View>
              </View>

              {/* Save Button */}
              <TouchableOpacity 
                style={styles.submitBtn} 
                onPress={handleSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.submitBtnText}>Save Configuration</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      {/* Custom Delete Confirmation Modal */}
      <Modal
        visible={!!deleteConfirmId}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteConfirmId(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.confirmModalContent}>
            <View style={styles.confirmIconContainer}>
              <Ionicons name="alert-circle-outline" size={48} color={Theme.danger} />
            </View>
            <Text style={styles.confirmTitle}>Delete Campaign</Text>
            <Text style={styles.confirmMessage}>
              Are you sure you want to delete this loyalty configuration? This action cannot be undone.
            </Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity
                style={styles.confirmCancelBtn}
                onPress={() => setDeleteConfirmId(null)}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.confirmDeleteBtn}
                onPress={() => deleteConfirmId && performDelete(deleteConfirmId)}
              >
                <Text style={styles.confirmDeleteText}>Delete</Text>
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
    flexDirection: "row",
    height: 56,
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    backgroundColor: Theme.bgCard,
  },
  backBtn: { padding: 8, borderRadius: 8 },
  headerTitle: { fontSize: 17, fontFamily: Fonts.black, color: Theme.textPrimary },
  createBtn: {
    flexDirection: "row",
    backgroundColor: Theme.primary,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  createBtnText: { color: "#FFF", fontSize: 13, fontFamily: Fonts.bold },
  searchFilterContainer: {
    padding: 12,
    backgroundColor: Theme.bgCard,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    gap: 10,
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
  searchIcon: { marginRight: 8 },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
    ...Platform.select({ web: { outlineStyle: "none" } as any }),
  },
  filterBar: { flexDirection: "row", gap: 8 },
  filterTab: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: Theme.bgInput,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  filterTabActive: { backgroundColor: Theme.primaryLight, borderColor: Theme.primaryBorder },
  filterTabText: { fontSize: 11, fontFamily: Fonts.bold, color: Theme.textSecondary },
  filterTabTextActive: { color: Theme.primary },
  loaderContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  listContent: { padding: 12, paddingBottom: 24 },
  card: {
    backgroundColor: Theme.bgCard,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowSm,
  },
  inactiveCard: { opacity: 0.7 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
  campaignName: { fontSize: 16, fontFamily: Fonts.bold, color: Theme.textPrimary },
  dateRange: { fontSize: 12, fontFamily: Fonts.medium, color: Theme.textSecondary, marginTop: 2 },
  statusBadge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 6 },
  activeBadge: { backgroundColor: "#dcfce7" },
  inactiveBadge: { backgroundColor: Theme.bgInput },
  statusBadgeText: { fontSize: 10, fontFamily: Fonts.bold },
  activeBadgeText: { color: "#16a34a" },
  inactiveBadgeText: { color: Theme.textSecondary },
  cardDetails: { gap: 6, marginBottom: 16, padding: 12, backgroundColor: Theme.bgNav, borderRadius: 8 },
  detailRow: { flexDirection: "row", justifyContent: "space-between" },
  detailLabel: { fontSize: 13, fontFamily: Fonts.medium, color: Theme.textSecondary },
  detailValue: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.textPrimary },
  cardActions: { flexDirection: "row", justifyContent: "flex-end", gap: 12 },
  editBtn: { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: Theme.primaryBorder },
  editBtnText: { fontSize: 12, fontFamily: Fonts.bold, color: Theme.primary },
  toggleBtn: { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1 },
  deactivateBtn: { borderColor: "#fecaca" },
  activateBtn: { borderColor: "#bbf7d0" },
  toggleBtnText: { fontSize: 12, fontFamily: Fonts.bold },
  deleteBtn: { flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: "#fecaca" },
  deleteBtnText: { fontSize: 12, fontFamily: Fonts.bold, color: Theme.danger },
  emptyContainer: { alignItems: "center", justifyContent: "center", paddingVertical: 64 },
  emptyText: { fontSize: 14, fontFamily: Fonts.medium, color: Theme.textMuted, marginTop: 12 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.4)", justifyContent: "center", alignItems: "center", padding: 20 },
  modalContent: { backgroundColor: Theme.bgCard, borderRadius: 16, width: "100%", maxWidth: 400, padding: 20, maxHeight: "90%", borderWidth: 1, borderColor: Theme.border, ...Theme.shadowLg },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: Theme.border, paddingBottom: 12, marginBottom: 16 },
  modalTitle: { fontSize: 18, fontFamily: Fonts.black, color: Theme.textPrimary },
  inputLabel: { fontSize: 13, fontFamily: Fonts.bold, color: Theme.textSecondary, marginBottom: 6 },
  input: { height: 44, borderWidth: 1, borderColor: Theme.border, borderRadius: 8, paddingHorizontal: 12, fontSize: 14, fontFamily: Fonts.medium, color: Theme.textPrimary, backgroundColor: Theme.bgInput, marginBottom: 12, ...Platform.select({ web: { outlineStyle: "none" } as any }) },
  dropdownTrigger: { height: 44, borderWidth: 1, borderColor: Theme.border, borderRadius: 8, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: Theme.bgInput, marginBottom: 12 },
  dropdownTriggerText: { fontSize: 14, fontFamily: Fonts.medium, color: Theme.textMuted },
  dropdownSelected: { color: Theme.textPrimary },
  dropdownContainer: { borderWidth: 1, borderColor: Theme.border, borderRadius: 8, backgroundColor: Theme.bgCard, padding: 8, marginBottom: 12, position: "absolute", top: 62, left: 0, right: 0, zIndex: 1000, ...Theme.shadowMd },
  dropdownSearch: { height: 36, borderWidth: 1, borderColor: Theme.border, borderRadius: 6, paddingHorizontal: 10, fontSize: 13, fontFamily: Fonts.medium, color: Theme.textPrimary, marginBottom: 8 },
  dropdownItem: { paddingVertical: 10, paddingHorizontal: 8, borderRadius: 4 },
  dropdownItemText: { fontSize: 13, fontFamily: Fonts.medium, color: Theme.textPrimary },
  statusToggleBtn: { height: 44, borderWidth: 1, borderColor: Theme.border, borderRadius: 8, justifyContent: "center", alignItems: "center", backgroundColor: Theme.bgInput },
  statusToggleBtnActive: { backgroundColor: Theme.successBg, borderColor: "#bbf7d0" },
  statusToggleText: { fontSize: 14, fontFamily: Fonts.bold, color: Theme.textSecondary },
  statusToggleTextActive: { color: Theme.success },
  submitBtn: { backgroundColor: Theme.primary, borderRadius: 8, height: 48, alignItems: "center", justifyContent: "center", marginTop: 16 },
  submitBtnText: { color: "#FFF", fontSize: 15, fontFamily: Fonts.bold },
  confirmModalContent: {
    backgroundColor: Theme.bgCard,
    borderRadius: 16,
    width: "100%",
    maxWidth: 340,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowLg,
  },
  confirmIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#fee2e2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  confirmTitle: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    marginBottom: 8,
  },
  confirmMessage: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 20,
  },
  confirmActions: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
  },
  confirmCancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Theme.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.bgInput,
  },
  confirmCancelText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  confirmDeleteBtn: {
    flex: 1,
    height: 44,
    borderRadius: 8,
    backgroundColor: Theme.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmDeleteText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: "#FFF",
  },
  typeBtn: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: Theme.border,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Theme.bgInput,
  },
  typeBtnActive: {
    backgroundColor: Theme.primaryLight,
    borderColor: Theme.primaryBorder,
  },
  typeBtnText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  typeBtnTextActive: {
    color: Theme.primary,
  },
});
