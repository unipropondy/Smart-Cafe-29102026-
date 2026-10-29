import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  FlatList,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { Theme } from "../constants/theme";
import { Fonts } from "../constants/Fonts";
import { useToast } from "../components/Toast";
import { API_URL } from "../constants/Config";
import { useTerminalStore } from "../stores/terminalStore";

interface Terminal {
  TerminalCode: string;
  TerminalName: string;
  LocationCode: string;
  ComputerName: string;
  TillAmount: number;
  TerminalType: string;
  PrintType: string;
  ImagePath: string;
  IdleTime: number;
  isCustDisplayAttached: boolean;
  isSecondDisplayAttached?: boolean;
  SecondDisplayPort?: string;
  DisplayType?: string;
  PrinterRequired?: boolean;
}

export default function TerminalManagementScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  const currentTerminalCode = useTerminalStore((s: any) => s.terminalCode);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  
  // Modal configurations
  const [editorModalVisible, setEditorModalVisible] = useState(false);
  const [isEditing, setIsEditing] = useState(false); // true if editing, false if adding

  // Form states
  const [terminalCode, setTerminalCode] = useState("");
  const [terminalName, setTerminalName] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [computerName, setComputerName] = useState("");
  const [tillAmount, setTillAmount] = useState("0");
  const [terminalType, setTerminalType] = useState("");
  const [printType, setPrintType] = useState("");
  const [imagePath, setImagePath] = useState("");
  const [idleTime, setIdleTime] = useState("0");

  const [isCustDisplayAttached, setIsCustDisplayAttached] = useState(false);
  const [displayType, setDisplayType] = useState("SOCKET");
  const [isSecondDisplayAttached, setIsSecondDisplayAttached] = useState(false);
  const [secondDisplayPort, setSecondDisplayPort] = useState("");
  const [printerRequired, setPrinterRequired] = useState(true);

  const loadTerminalsList = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/terminal`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTerminals(Array.isArray(data) ? data : []);
    } catch (e) {
      showToast({ type: "error", message: "Failed to load terminals list" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTerminalsList();
  }, []);

  const openAddModal = () => {
    setIsEditing(false);
    setTerminalCode("");
    setTerminalName("");
    setLocationCode("");
    setComputerName("");
    setTillAmount("0");
    setTerminalType("");
    setPrintType("");
    setImagePath("");
    setIdleTime("0");

    setIsCustDisplayAttached(false);
    setDisplayType("SOCKET");
    setIsSecondDisplayAttached(false);
    setSecondDisplayPort("");
    setPrinterRequired(true);
    setEditorModalVisible(true);
  };

  const openEditModal = (t: Terminal) => {
    setIsEditing(true);
    setTerminalCode(t.TerminalCode);
    setTerminalName(t.TerminalName);
    setLocationCode(t.LocationCode || "");
    setComputerName(t.ComputerName || "");
    setTillAmount(String(t.TillAmount ?? 0));
    setTerminalType(t.TerminalType || "");
    setPrintType(t.PrintType || "");
    setImagePath(t.ImagePath || "");
    setIdleTime(String(t.IdleTime ?? 0));

    setIsCustDisplayAttached(!!t.isCustDisplayAttached);
    setDisplayType(t.DisplayType || "SOCKET");
    setIsSecondDisplayAttached(!!t.isSecondDisplayAttached);
    setSecondDisplayPort(t.SecondDisplayPort || "");
    setPrinterRequired(t.PrinterRequired !== undefined ? !!t.PrinterRequired : true);
    setEditorModalVisible(true);
  };

  const handleSave = async () => {
    if (!terminalCode.trim() || !terminalName.trim()) {
      showToast({ type: "error", message: "Terminal Code and Name are required." });
      return;
    }

    try {
      setSaving(true);
      const url = isEditing
        ? `${API_URL}/api/terminal/${terminalCode.trim()}`
        : `${API_URL}/api/terminal`;
      
      const method = isEditing ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          TerminalCode: terminalCode.trim(),
          TerminalName: terminalName.trim(),
          LocationCode: locationCode.trim(),
          ComputerName: computerName.trim() || terminalCode.trim(),
          TillAmount: parseFloat(tillAmount) || 0,
          TerminalType: terminalType.trim(),
          PrintType: printType.trim(),
          ImagePath: imagePath.trim(),
          IdleTime: parseInt(idleTime) || 0,
          isCustDisplayAttached,
          isSecondDisplayAttached,
          DisplayType: displayType.trim(),
          SecondDisplayPort: secondDisplayPort.trim(),
          PrinterRequired: printerRequired,
        }),
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || "Failed to save terminal settings.");
      }

      showToast({ 
        type: "success", 
        message: isEditing ? "Terminal updated successfully!" : "Terminal created successfully!" 
      });

      // Update terminalStore if this device is paired to the updated terminal
      if (currentTerminalCode === terminalCode.trim()) {
        useTerminalStore.getState().setTerminal(terminalCode.trim(), terminalName.trim());
      }

      setEditorModalVisible(false);
      loadTerminalsList();
    } catch (err: any) {
      showToast({ type: "error", message: err.message || "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  };

  if (loading && terminals.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Theme.primary} />
        <Text style={styles.loadingText}>Loading Terminals...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)/category");
          }}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color={Theme.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Terminal Management</Text>
        <TouchableOpacity style={styles.addButton} onPress={openAddModal}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.addButtonText}>Add Terminal</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={terminals}
        keyExtractor={(item) => item.TerminalCode}
        contentContainerStyle={styles.listContainer}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="hardware-chip-outline" size={64} color={Theme.textMuted} />
            <Text style={styles.emptyTitle}>No terminals configured.</Text>
            <Text style={styles.emptySubtitle}>Create your first terminal.</Text>
            <TouchableOpacity style={styles.emptyAddBtn} onPress={openAddModal}>
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={styles.emptyAddBtnText}>Add Terminal</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.terminalCard}>
            <View style={styles.terminalCardHeader}>
              <View>
                <Text style={styles.terminalNameText}>{item.TerminalName}</Text>
                <Text style={styles.terminalCodeText}>Code: {item.TerminalCode}</Text>
                {item.TerminalType ? (
                  <Text style={styles.terminalMetaText}>Type: {item.TerminalType}</Text>
                ) : null}
              </View>
              <TouchableOpacity style={styles.editButton} onPress={() => openEditModal(item)}>
                <Ionicons name="create-outline" size={16} color={Theme.primary} />
                <Text style={styles.editButtonText}>Edit</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.badgeRow}>
              <View style={[styles.badge, item.isCustDisplayAttached ? styles.badgeActive : styles.badgeInactive]}>
                <Text style={[styles.badgeText, item.isCustDisplayAttached ? styles.badgeTextActive : styles.badgeTextInactive]}>
                  Display: {item.isCustDisplayAttached ? "Enabled" : "Disabled"}
                </Text>
              </View>
              {item.PrinterRequired ? (
                <View style={[styles.badge, styles.badgeActive]}>
                  <Text style={[styles.badgeText, styles.badgeTextActive]}>Printer Required</Text>
                </View>
              ) : null}
            </View>
          </View>
        )}
      />

      {/* Editor Modal (Add/Edit) */}
      <Modal visible={editorModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : "height"}
            style={styles.modalContentWrapper}
          >
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {isEditing ? "Edit Terminal" : "Create Terminal"}
                </Text>
                <TouchableOpacity onPress={() => setEditorModalVisible(false)}>
                  <Ionicons name="close" size={24} color={Theme.textPrimary} />
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.modalForm} showsVerticalScrollIndicator={false}>
                <View style={styles.formRow}>
                  {/* Code Field (Locked if editing) */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Terminal Code *</Text>
                    <TextInput
                      style={[styles.input, isEditing && styles.inputDisabled]}
                      value={terminalCode}
                      onChangeText={setTerminalCode}
                      editable={!isEditing}
                      placeholder="e.g. COUNTER_1"
                      placeholderTextColor={Theme.textMuted}
                      autoCapitalize="characters"
                    />
                  </View>

                  {/* Name Field */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Terminal Name *</Text>
                    <TextInput
                      style={styles.input}
                      value={terminalName}
                      onChangeText={setTerminalName}
                      placeholder="e.g. Main Counter"
                      placeholderTextColor={Theme.textMuted}
                    />
                  </View>

                  {/* Location Code */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Location Code</Text>
                    <TextInput
                      style={styles.input}
                      value={locationCode}
                      onChangeText={setLocationCode}
                      placeholder="e.g. LOC_1"
                      placeholderTextColor={Theme.textMuted}
                    />
                  </View>

                  {/* Computer Name */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Computer Name</Text>
                    <TextInput
                      style={styles.input}
                      value={computerName}
                      onChangeText={setComputerName}
                      placeholder="e.g. LAPTOP-POS"
                      placeholderTextColor={Theme.textMuted}
                    />
                  </View>

                  {/* Till Amount */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Till Amount</Text>
                    <TextInput
                      style={styles.input}
                      value={tillAmount}
                      onChangeText={setTillAmount}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={Theme.textMuted}
                    />
                  </View>

                  {/* Terminal Type */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Terminal Type</Text>
                    <TextInput
                      style={styles.input}
                      value={terminalType}
                      onChangeText={setTerminalType}
                      placeholder="e.g. CASHIER"
                      placeholderTextColor={Theme.textMuted}
                    />
                  </View>

                  {/* Print Type */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Printer Type</Text>
                    <TextInput
                      style={styles.input}
                      value={printType}
                      onChangeText={setPrintType}
                      placeholder="e.g. T"
                      placeholderTextColor={Theme.textMuted}
                      maxLength={1}
                    />
                  </View>

                  {/* Image Path */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Image Path</Text>
                    <TextInput
                      style={styles.input}
                      value={imagePath}
                      onChangeText={setImagePath}
                      placeholder="e.g. /images/pos.png"
                      placeholderTextColor={Theme.textMuted}
                    />
                  </View>

                  {/* Idle Time */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Idle Time</Text>
                    <TextInput
                      style={styles.input}
                      value={idleTime}
                      onChangeText={setIdleTime}
                      keyboardType="numeric"
                      placeholder="0"
                      placeholderTextColor={Theme.textMuted}
                    />
                  </View>

                  {/* Cust Display */}
                  <TouchableOpacity
                    style={styles.checkboxRow}
                    activeOpacity={0.8}
                    onPress={() => setIsCustDisplayAttached(!isCustDisplayAttached)}
                  >
                    <Ionicons
                      name={isCustDisplayAttached ? "checkbox" : "square-outline"}
                      size={24}
                      color={isCustDisplayAttached ? Theme.primary : Theme.textSecondary}
                    />
                    <Text style={styles.checkboxLabel}>Enable Customer Display</Text>
                  </TouchableOpacity>

                  {isCustDisplayAttached && (
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Display Type</Text>
                      <TextInput
                        style={styles.input}
                        value={displayType}
                        onChangeText={setDisplayType}
                        placeholder="e.g. SOCKET"
                        placeholderTextColor={Theme.textMuted}
                      />
                    </View>
                  )}

                  {/* Second Display */}
                  <TouchableOpacity
                    style={styles.checkboxRow}
                    activeOpacity={0.8}
                    onPress={() => setIsSecondDisplayAttached(!isSecondDisplayAttached)}
                  >
                    <Ionicons
                      name={isSecondDisplayAttached ? "checkbox" : "square-outline"}
                      size={24}
                      color={isSecondDisplayAttached ? Theme.primary : Theme.textSecondary}
                    />
                    <Text style={styles.checkboxLabel}>Enable Second Display</Text>
                  </TouchableOpacity>

                  {isSecondDisplayAttached && (
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Second Display Port</Text>
                      <TextInput
                        style={styles.input}
                        value={secondDisplayPort}
                        onChangeText={setSecondDisplayPort}
                        placeholder="e.g. COM3 (Optional)"
                        placeholderTextColor={Theme.textMuted}
                      />
                    </View>
                  )}

                  {/* Printer */}
                  <TouchableOpacity
                    style={styles.checkboxRow}
                    activeOpacity={0.8}
                    onPress={() => setPrinterRequired(!printerRequired)}
                  >
                    <Ionicons
                      name={printerRequired ? "checkbox" : "square-outline"}
                      size={24}
                      color={printerRequired ? Theme.primary : Theme.textSecondary}
                    />
                    <Text style={styles.checkboxLabel}>Printer Required</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>

              <TouchableOpacity
                style={[styles.saveButtonMain, saving && { opacity: 0.7 }]}
                disabled={saving}
                onPress={handleSave}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.saveButtonMainText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.bgMain,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Theme.bgMain,
  },
  loadingText: {
    marginTop: 20,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    backgroundColor: Theme.bgCard,
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  addButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Theme.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addButtonText: {
    color: "#fff",
    fontFamily: Fonts.bold,
    fontSize: 13,
  },
  listContainer: {
    padding: 16,
    gap: 12,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 80,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginBottom: 24,
  },
  emptyAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Theme.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  emptyAddBtnText: {
    color: "#fff",
    fontFamily: Fonts.bold,
    fontSize: 14,
  },
  terminalCard: {
    backgroundColor: Theme.bgCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Theme.border,
    padding: 16,
  },
  terminalCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  terminalNameText: {
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  terminalCodeText: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginTop: 2,
  },
  terminalMetaText: {
    fontSize: 12,
    fontFamily: Fonts.regular,
    color: Theme.textMuted,
    marginTop: 1,
  },
  editButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: Theme.primaryBorder,
    backgroundColor: Theme.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  editButtonText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.primary,
  },
  badgeRow: {
    flexDirection: "row",
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgeActive: {
    backgroundColor: "#ECFDF5",
  },
  badgeInactive: {
    backgroundColor: "#F1F5F9",
  },
  badgeText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
  },
  badgeTextActive: {
    color: "#10B981",
  },
  badgeTextInactive: {
    color: "#64748B",
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  modalContentWrapper: {
    width: "95%",
    maxWidth: 600,
    maxHeight: "90%",
  },
  modalContent: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#EEE",
  },
  modalTitle: {
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  modalForm: {
    padding: 12,
  },
  formRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
  },
  inputGroup: {
    width: "48%",
    marginBottom: 8,
  },
  inputLabel: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: Theme.border,
    borderRadius: 8,
    padding: 8,
    fontSize: 14,
    backgroundColor: "#FAF9F6",
    color: Theme.textPrimary,
    fontFamily: Fonts.medium,
  },
  inputDisabled: {
    backgroundColor: "#E2E8F0",
    color: Theme.textSecondary,
  },
  checkboxRow: {
    width: "48%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
  },
  checkboxLabel: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
  },
  saveButtonMain: {
    backgroundColor: Theme.primary,
    padding: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonMainText: {
    color: "#fff",
    fontFamily: Fonts.bold,
    fontSize: 14,
  },
});
