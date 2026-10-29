import React, { useState, useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { API_URL } from "../../constants/Config";
import { Theme } from "../../constants/theme";
import { useAuthStore } from "../../stores/authStore";
import { usePaymentSettingsStore } from "../../stores/paymentSettingsStore";

interface StoreSettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

const StoreSettingsModal: React.FC<StoreSettingsModalProps> = ({
  visible,
  onClose,
}) => {
  const { settings, fetchSettings, updateSettings } = usePaymentSettingsStore();
  const { user } = useAuthStore();

  const [shopName, setShopName] = useState(settings.shopName || "");
  const [qrCodeUrl, setQrCodeUrl] = useState(settings.payNowQrUrl || "");

  const [password, setPassword] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (visible) {
      setShopName(settings.shopName || "");
      setQrCodeUrl(settings.payNowQrUrl || "");
      setPassword("");
      setIsUnlocked(false);
    }
  }, [visible, settings]);

  const handleUnlock = async () => {
    if (!user?.userName) return;

    setSaving(true); // Reuse saving state for loader
    try {
      const response = await fetch(`${API_URL}/api/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userName: user.userName,
          password: password,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setIsUnlocked(true);
      } else {
        Alert.alert("Access Denied", "Incorrect Password");
      }
    } catch (error) {
      Alert.alert("Error", "Could not verify password. Check connection.");
    } finally {
      setSaving(false);
    }
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert(
        "Permission Needed",
        "We need access to your photos to upload the QR code.",
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6, // Compressed for DB storage
      base64: true, // ⚡️ GET BASE64 DATA
    });

    if (!result.canceled && result.assets[0]) {
      const base64Data = `data:image/jpeg;base64,${result.assets[0].base64}`;
      setQrCodeUrl(base64Data);
      Alert.alert(
        "Ready",
        "QR Screenshot processed. Click 'Save All' to apply.",
      );
    }
  };

  // We no longer need the separate uploadImage function as we save base64 directly

  const handleSave = async () => {
    setSaving(true);
    try {
      // Fetch current settings first to avoid overwriting general settings with defaults
      let currentData: any = {};
      try {
        const getRes = await fetch(`${API_URL}/api/settings`);
        if (getRes.ok) {
          currentData = await getRes.json();
        }
      } catch (err) {
        console.warn("Failed to fetch current settings for merge:", err);
      }

      const response = await fetch(`${API_URL}/api/settings/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopName: shopName.trim(),
          qrCodeUrl: qrCodeUrl,
          enableKOT: currentData.EnableKOT !== undefined ? currentData.EnableKOT : 1,
          enableKDS: currentData.EnableKDS !== undefined ? currentData.EnableKDS : 1,
          enableCheckoutBill: currentData.EnableCheckoutBill !== undefined ? currentData.EnableCheckoutBill : 1,
          enableCheckoutFlow: currentData.EnableCheckoutFlow !== undefined ? currentData.EnableCheckoutFlow : 1,
          enableDirectProcessToPay: currentData.EnableDirectProcessToPay !== undefined ? currentData.EnableDirectProcessToPay : 0,
          customerSideDisplay: currentData.CustomerSideDisplay !== undefined ? currentData.CustomerSideDisplay : 1,
          enableGuestDetailsPopup: currentData.EnableGuestDetailsPopup !== undefined ? currentData.EnableGuestDetailsPopup : 1,
          enableCashDrawer: currentData.EnableCashDrawer !== undefined ? currentData.EnableCashDrawer : 1,
          SVCIdentification: currentData.SVCIdentification !== undefined ? currentData.SVCIdentification : 1,
          enableKDSPrint: currentData.EnableKDSPrint !== undefined ? currentData.EnableKDSPrint : 1,
          enableCombo: currentData.EnableCombo !== undefined ? currentData.EnableCombo : 1,
          userName: user?.userName || user?.fullName || "",
          userId: user?.userId || "",
          userRole: user?.roleName || user?.role || "",
        }),
      });

      const data = await response.json();
      if (data.success) {
        updateSettings({ shopName, payNowQrUrl: qrCodeUrl });
        Alert.alert("Success", "Settings updated successfully!");
        onClose();
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      Alert.alert("Error", error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        {!isUnlocked ? (
          <View style={styles.passwordBox}>
            <Text style={styles.title}>🔐 Admin Access</Text>
            <Text style={styles.subtitle}>
              Enter password to edit payment settings
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Enter Password"
              placeholderTextColor="#A0AEC0"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              keyboardType="default"
              onSubmitEditing={handleUnlock}
              returnKeyType="done"
              autoFocus
            />
            <View style={styles.row}>
              <TouchableOpacity
                style={[styles.btn, styles.cancelBtn]}
                onPress={onClose}
              >
                <Text style={styles.btnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.unlockBtn]}
                onPress={handleUnlock}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.unlockText}>Unlock</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.content}>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>⚙️ Store Settings</Text>
              <TouchableOpacity onPress={onClose}>
                <Ionicons name="close" size={28} color={Theme.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.scroll}>
              <Text style={styles.sectionTitle}>Business Info</Text>
              <View style={styles.field}>
                <Text style={styles.label}>Shop Name (Display on QR)</Text>
                <TextInput
                  style={styles.input}
                  value={shopName}
                  onChangeText={setShopName}
                  placeholder="e.g. My Awesome Restaurant"
                  placeholderTextColor="#A0AEC0"
                />
              </View>


              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: 20,
                  marginBottom: 15,
                }}
              >
                <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>
                  PayNow Configuration
                </Text>
                {qrCodeUrl ? (
                  <View style={styles.successBadge}>
                    <Ionicons
                      name="checkmark-circle"
                      size={14}
                      color="#059669"
                    />
                    <Text style={styles.successBadgeText}>QR Uploaded</Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.field}>
                <Text style={styles.label}>Static QR Image (PayNow)</Text>
                {qrCodeUrl ? (
                  <View style={styles.previewContainer}>
                    <Image
                      source={{
                        uri:
                          qrCodeUrl.startsWith("data:") ||
                          qrCodeUrl.startsWith("http")
                            ? qrCodeUrl
                            : `${API_URL}${qrCodeUrl}`,
                      }}
                      style={styles.qrPreview}
                    />
                    <TouchableOpacity
                      style={styles.removeBtn}
                      onPress={() => setQrCodeUrl("")}
                    >
                      <Ionicons name="trash-outline" size={20} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.uploadBtn}
                    onPress={pickImage}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <ActivityIndicator color={Theme.primary} />
                    ) : (
                      <>
                        <Ionicons
                          name="cloud-upload-outline"
                          size={32}
                          color={Theme.primary}
                        />
                        <Text style={styles.uploadText}>
                          Upload QR Screenshot
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>

            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveText}>Save All Settings</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
  },
  passwordBox: {
    backgroundColor: "#fff",
    padding: 25,
    borderRadius: 16,
    width: "85%",
    maxWidth: 400,
  },
  content: {
    backgroundColor: "#fff",
    width: "90%",
    height: "80%",
    borderRadius: 24,
    padding: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  headerTitle: { fontSize: 22, fontWeight: "800", color: Theme.textPrimary },
  title: {
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 10,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 20,
  },
  scroll: { flex: 1 },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Theme.primary,
    marginBottom: 15,
  },
  field: { marginBottom: 15 },
  label: { fontSize: 14, color: "#444", marginBottom: 8, fontWeight: "600" },
  input: {
    borderWidth: 1.5,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: Theme.textPrimary || "#000",
  },
  helper: { fontSize: 12, color: "#718096", marginTop: 5 },
  row: { flexDirection: "row", gap: 10, marginTop: 10 },
  btn: { flex: 1, padding: 15, borderRadius: 12, alignItems: "center" },
  cancelBtn: { backgroundColor: "#F1F5F9" },
  unlockBtn: { backgroundColor: Theme.primary },
  btnText: { fontWeight: "700", color: "#64748B" },
  unlockText: { fontWeight: "700", color: "#fff" },
  successBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#10B981",
    gap: 4,
  },
  successBadgeText: { fontSize: 12, fontWeight: "700", color: "#059669" },
  saveBtn: {
    backgroundColor: Theme.primary,
    padding: 18,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 20,
  },
  saveText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  uploadBtn: {
    height: 180,
    borderStyle: "dashed",
    borderWidth: 2,
    borderColor: Theme.primary,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F0F9FF",
  },
  uploadText: { marginTop: 10, color: Theme.primary, fontWeight: "700" },
  previewContainer: { position: "relative", alignItems: "center" },
  qrPreview: {
    width: 200,
    height: 200,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#eee",
  },
  removeBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    backgroundColor: "#ef4444",
    padding: 8,
    borderRadius: 10,
  },
});

export default StoreSettingsModal;
