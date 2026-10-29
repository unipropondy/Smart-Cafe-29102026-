import React, { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  StatusBar,
  Switch,
  TextInput,
  Modal,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { API_URL } from "@/constants/Config";
import { Fonts } from "../constants/Fonts";
import { Theme } from "../constants/theme";
import { useAuthStore } from "@/stores/authStore";
import { useCompanySettingsStore } from "@/stores/companySettingsStore";

type WaiterType = {
  SER_ID: number;
  SER_NAME: string;
  CreatedBy?: string;
  CreatorName?: string;
  CreatedDate?: string;
};

export default function WaitersScreen() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { settings, updateSettings } = useCompanySettingsStore();
  
  const [waiters, setWaiters] = useState<WaiterType[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const toggleWaiterRequired = async () => {
    const newVal = !settings.waiterRequired;
    await updateSettings({ waiterRequired: newVal }, "1");
  };

  // Modal State
  const [modalMode, setModalMode] = useState<"ADD" | "EDIT" | "NONE">("NONE");
  const [editingWaiter, setEditingWaiter] = useState<WaiterType | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    name: "",
  });

  const fetchWaiters = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/servers`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      const rawWaiters = Array.isArray(data) ? data : [];
      const uniqueWaiters = rawWaiters.filter((item, index, self) =>
        index === self.findIndex(w => w.SER_ID === item.SER_ID)
      );
      setWaiters(uniqueWaiters);
    } catch (err) {
      console.error("[FETCH ERROR]", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWaiters();
  }, [fetchWaiters]);

  const openAddModal = () => {
    setFormData({ name: "" });
    setEditingWaiter(null);
    setModalMode("ADD");
  };

  const openEditModal = (waiter: WaiterType) => {
    setEditingWaiter(waiter);
    setFormData({ name: waiter.SER_NAME });
    setModalMode("EDIT");
  };

  const handleSaveWaiter = async () => {
    if (!formData.name.trim()) {
      Alert.alert("Required", "Please enter the Waiter Name.");
      return;
    }

    setIsSaving(true);
    try {
      const isEdit = modalMode === "EDIT";
      const url = isEdit ? `${API_URL}/api/servers/update` : `${API_URL}/api/servers/add`;

      // Be resilient: check both userId, id, and UserId (just in case of casing issues)
      const currentUserId = user?.userId || (user as any)?.id || (user as any)?.UserId;

      if (!currentUserId) {
        Alert.alert("Debug", "User ID is missing from your session. Please Log Out and Log In again.");
        setIsSaving(false);
        return;
      }

      const body = isEdit 
        ? { SER_ID: editingWaiter?.SER_ID, SER_NAME: formData.name.trim(), userId: currentUserId }
        : { SER_NAME: formData.name.trim(), userId: currentUserId };

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setModalMode("NONE");
        fetchWaiters();
        Alert.alert("Success", isEdit ? "Waiter updated." : "Waiter added.");
      } else {
        const errorData = await res.json();
        Alert.alert("Error", errorData.error || "Save failed.");
      }
    } catch (err) {
      Alert.alert("Error", "Connection problem.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteWaiter = (waiter: WaiterType) => {
    setEditingWaiter(waiter);
    setShowDeleteModal(true);
  };

  const filteredWaiters = waiters.filter(w =>
    w.SER_NAME.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderWaiter = ({ item }: { item: WaiterType }) => {
    return (
      <View style={styles.waiterCard}>
        <View style={styles.cardHeader}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarLetter}>{item.SER_NAME.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.waiterName}>{item.SER_NAME}</Text>
            <View style={styles.idRow}>
              <Text style={styles.waiterId}>ID: {item.SER_ID}</Text>
              {item.CreatorName && (
                <>
                  <Text style={styles.dot}>•</Text>
                  <Text style={styles.waiterId}>By: {item.CreatorName}</Text>
                </>
              )}
            </View>
          </View>
          <View style={styles.cardActions}>
            <TouchableOpacity 
              activeOpacity={0.7}
              onPress={() => openEditModal(item)} 
              style={[styles.actionBtn, { backgroundColor: Theme.primary + "15" }]}
            >
              <Ionicons name="create-outline" size={18} color={Theme.primary} />
            </TouchableOpacity>
            <TouchableOpacity 
              activeOpacity={0.7}
              onPress={() => handleDeleteWaiter(item)} 
              style={[styles.actionBtn, { backgroundColor: Theme.danger + "15" }]}
            >
              <Ionicons name="trash-outline" size={18} color={Theme.danger} />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.headerBar}>
          <TouchableOpacity onPress={() => router.replace("/(tabs)/category" as any)} style={styles.circularBack}>
            <Ionicons name="chevron-back" size={24} color={Theme.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Waiters</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity onPress={() => router.push("/waiter-history" as any)} style={styles.historyBtn}>
              <Ionicons name="time-outline" size={18} color={Theme.primary} />
              <Text style={styles.historyBtnText}>History</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={openAddModal} style={styles.addBtn}>
              <Text style={styles.addBtnText}>+ Add</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.searchWrapper}>
          <View style={styles.searchInner}>
            <Ionicons name="search" size={20} color={Theme.textMuted} />
            <TextInput
              placeholder="Search waiters..."
              placeholderTextColor={Theme.textMuted}
              style={styles.searchField}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
        </View>

        <View style={styles.configCard}>
          <View style={styles.configInfo}>
            <MaterialCommunityIcons name="account-check-outline" size={24} color={Theme.primary} />
            <View style={{ marginLeft: 12 }}>
              <Text style={styles.configTitle}>Waiter Mandatory</Text>
              <Text style={styles.configDesc}>Require waiter selection before payment</Text>
            </View>
          </View>
          <Switch
            trackColor={{ false: "#E2E8F0", true: Theme.primary + "80" }}
            thumbColor={settings.waiterRequired ? Theme.primary : "#94A3B8"}
            onValueChange={toggleWaiterRequired}
            value={settings.waiterRequired}
          />
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={Theme.primary} /></View>
        ) : (
          <FlatList
            data={filteredWaiters}
            keyExtractor={(item) => String(item.SER_ID)}
            renderItem={renderWaiter}
            contentContainerStyle={styles.listContainer}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchWaiters} tintColor={Theme.primary} />}
          />
        )}

        {/* Form Modal */}
        <Modal visible={modalMode !== "NONE"} transparent animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.formSheet}>
              <View style={styles.sheetHeader}>
                <Text style={styles.sheetTitle}>{modalMode === "EDIT" ? "Edit Waiter" : "Add Waiter"}</Text>
                <TouchableOpacity onPress={() => setModalMode("NONE")} style={styles.sheetClose}>
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>WAITER NAME</Text>
                  <TextInput 
                    style={styles.sheetInput} 
                    value={formData.name} 
                    onChangeText={v => setFormData({ ...formData, name: v })} 
                    placeholder="Enter Full Name" 
                    placeholderTextColor={Theme.textMuted} 
                    autoFocus
                  />
                </View>

                <TouchableOpacity style={styles.submitBtn} onPress={handleSaveWaiter} disabled={isSaving}>
                  {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>{modalMode === "EDIT" ? "Update Waiter" : "Add Waiter"}</Text>}
                </TouchableOpacity>
                <View style={{ height: 40 }} />
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Delete Modal */}
        <Modal visible={showDeleteModal} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.alertCard}>
              <View style={styles.alertIconBg}>
                <Ionicons name="alert-circle" size={40} color={Theme.danger} />
              </View>
              <Text style={styles.alertTitle}>Delete Waiter</Text>
              <Text style={styles.alertMessage}>
                Do you want to delete this waiter?{"\n"}
                <Text style={{ color: Theme.primary, fontSize: 16, fontFamily: Fonts.black }}>{editingWaiter?.SER_NAME}</Text>
              </Text>
              
              <View style={styles.alertActions}>
                <TouchableOpacity 
                  style={[styles.alertBtn, styles.cancelBtn]} 
                  onPress={() => { setEditingWaiter(null); setShowDeleteModal(false); }}
                >
                  <Text style={styles.btnLabel}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.alertBtn, styles.confirmDeleteBtn]} 
                  onPress={async () => {
                    const waiter = editingWaiter;
                    if (!waiter) return;
                    setIsSaving(true);
                    try {
                      const res = await fetch(`${API_URL}/api/servers/delete`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ SER_ID: waiter.SER_ID }),
                      });
                      const data = await res.json();
                      if (res.ok && data.success) {
                        setWaiters(prev => prev.filter(w => w.SER_ID !== waiter.SER_ID));
                        setEditingWaiter(null);
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
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Theme.bgMain },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  headerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 20, gap: 15 },
  circularBack: { width: 44, height: 44, borderRadius: 12, backgroundColor: Theme.bgCard, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: Theme.border },
  screenTitle: { flex: 1, color: Theme.textPrimary, fontSize: 20, fontFamily: Fonts.black },
  addBtn: { paddingHorizontal: 16, paddingVertical: 12, backgroundColor: Theme.primary, borderRadius: 12, ...Theme.shadowSm },
  addBtnText: { color: "#fff", fontFamily: Fonts.bold, fontSize: 13 },
  historyBtn: { 
    flexDirection: 'row', alignItems: 'center', gap: 6, 
    paddingHorizontal: 12, paddingVertical: 10, 
    backgroundColor: Theme.primary + "15", borderRadius: 12,
    borderWidth: 1, borderColor: Theme.primary + "30"
  },
  historyBtnText: { color: Theme.primary, fontFamily: Fonts.bold, fontSize: 13 },
  searchWrapper: { marginHorizontal: 20, marginBottom: 20 },
  searchInner: { 
    flexDirection: "row", alignItems: "center", paddingHorizontal: 16, height: 56, 
    borderRadius: 16, backgroundColor: Theme.bgCard, borderWidth: 1, borderColor: Theme.border,
    ...Theme.shadowSm 
  },
  searchField: { flex: 1, color: Theme.textPrimary, fontFamily: Fonts.medium, fontSize: 16, marginLeft: 12, ...Platform.select({ web: { outlineStyle: "none" } as any }) },
  configCard: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: 20, marginBottom: 20, padding: 16, 
    backgroundColor: Theme.bgCard, borderRadius: 20, borderWidth: 1, borderColor: Theme.border,
    ...Theme.shadowSm
  },
  configInfo: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  configTitle: { color: Theme.textPrimary, fontSize: 15, fontFamily: Fonts.bold },
  configDesc: { color: Theme.textMuted, fontSize: 11, fontFamily: Fonts.medium, marginTop: 2 },
  listContainer: { paddingHorizontal: 20, paddingBottom: 40, gap: 16 },
  waiterCard: { 
    backgroundColor: Theme.bgCard, borderRadius: 20, padding: 20, 
    borderLeftWidth: 5, borderLeftColor: Theme.primary, ...Theme.shadowMd,
    borderWidth: 1, borderColor: Theme.border
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 15 },
  avatarCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: Theme.primaryLight, justifyContent: "center", alignItems: "center" },
  avatarLetter: { color: Theme.primary, fontSize: 18, fontFamily: Fonts.black },
  waiterName: { color: Theme.textPrimary, fontSize: 18, fontFamily: Fonts.bold },
  idRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  waiterId: { color: Theme.textMuted, fontSize: 12, fontFamily: Fonts.medium },
  dot: { color: Theme.textMuted, fontSize: 12, marginHorizontal: 4 },
  cardActions: { flexDirection: 'row', gap: 10 },
  actionBtn: { width: 38, height: 38, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 20 },
  formSheet: { backgroundColor: Theme.bgCard, borderRadius: 24, width: '100%', maxWidth: 500, ...Theme.shadowLg, maxHeight: '90%' },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 25, borderBottomWidth: 1, borderBottomColor: Theme.border },
  sheetTitle: { color: Theme.textPrimary, fontSize: 22, fontFamily: Fonts.black },
  sheetClose: { width: 40, height: 40, borderRadius: 20, backgroundColor: Theme.bgMuted, justifyContent: 'center', alignItems: 'center' },
  sheetBody: { padding: 25 },
  inputGroup: { marginBottom: 20 },
  inputLabel: { color: Theme.textMuted, fontSize: 10, fontFamily: Fonts.black, marginBottom: 8, letterSpacing: 0.5 },
  sheetInput: { 
    height: 56, backgroundColor: Theme.bgInput, borderRadius: 14, color: Theme.textPrimary, 
    paddingHorizontal: 16, fontSize: 15, fontFamily: Fonts.bold, borderWidth: 1, borderColor: Theme.border,
    ...Platform.select({ web: { outlineStyle: "none" } as any })
  },
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
  btnLabel: { color: Theme.textSecondary, fontSize: 15, fontFamily: Fonts.bold },
});
