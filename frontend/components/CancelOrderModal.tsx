import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import { Theme } from "../constants/theme";
import { Fonts } from "../constants/Fonts";

interface CancelOrderModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (reason: string, password: string, qty?: number) => void;
  cancelReasons: any[];
  loadingReasons: boolean;
  isCancelling: boolean;
  maxQty?: number;
}

const CancelOrderModal = ({
  visible,
  onClose,
  onConfirm,
  cancelReasons,
  loadingReasons,
  isCancelling,
  maxQty,
}: CancelOrderModalProps) => {
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [customReason, setCustomReason] = useState("");
  const [password, setPassword] = useState("");
  const [voidQty, setVoidQty] = useState("1");
  const passwordInputRef = React.useRef<any>(null);

  const QUICK_REASONS = [
    "Customer changed mind",
    "Incorrect dish",
    "Item out of stock",
    "Test Order"
  ];

  const handleReasonSelect = (reason: string) => {
    setSelectedReason(reason);
    setCustomReason("");
    // Small delay to ensure state updates before focus
    setTimeout(() => {
        passwordInputRef.current?.focus();
    }, 100);
  };

  const handleConfirm = () => {
    const finalReason = selectedReason === "OTHER" ? customReason : selectedReason;
    if (finalReason && password) {
      onConfirm(finalReason, password, maxQty ? parseInt(voidQty) : undefined);
    }
  };

  return (
    <Modal transparent visible={visible} animationType="fade">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.modalOverlay}
      >
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>Cancel Order?</Text>
          <Text style={styles.modalDesc}>Select a reason or enter custom one.</Text>

          {loadingReasons ? (
            <View style={{ paddingVertical: 40, alignItems: "center" }}>
              <ActivityIndicator size="large" color={Theme.primary} />
            </View>
          ) : (
            <ScrollView
              style={{ maxHeight: 350 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {maxQty !== undefined && maxQty > 1 && (
                <View style={{ marginBottom: 16 }}>
                  <Text style={[styles.modalDesc, { marginBottom: 8, fontWeight: "bold", color: Theme.textPrimary, textAlign: 'left' }]}>
                    Quantity to Void (max {maxQty}):
                  </Text>
                  <TextInput
                    style={[styles.customReasonInput, { minHeight: 50, marginTop: 0 }]}
                    keyboardType="numeric"
                    value={voidQty}
                    onChangeText={(val) => {
                        const num = parseInt(val) || 0;
                        if (num <= maxQty) setVoidQty(val);
                    }}
                    placeholder="Qty"
                  />
                </View>
              )}

              <View style={[styles.quickReasonsContainer, { marginBottom: 16 }]}>
                {(cancelReasons && cancelReasons.length > 0 ? cancelReasons.map((r: any) => r.CRName) : QUICK_REASONS).map((r) => (
                  <TouchableOpacity
                    key={r}
                    style={[
                      styles.quickReasonChip,
                      selectedReason === r && styles.quickReasonChipSelected,
                    ]}
                    onPress={() => handleReasonSelect(r)}
                  >
                    <Text
                      style={[
                        styles.quickReasonText,
                        selectedReason === r && styles.quickReasonTextSelected,
                      ]}
                    >
                      {r}
                    </Text>
                  </TouchableOpacity>
                ))}
                
                <TouchableOpacity
                  style={[
                    styles.quickReasonChip,
                    selectedReason === "OTHER" && styles.quickReasonChipSelected,
                  ]}
                  onPress={() => handleReasonSelect("OTHER")}
                >
                  <Text
                    style={[
                      styles.quickReasonText,
                      selectedReason === "OTHER" && styles.quickReasonTextSelected,
                    ]}
                  >
                    Other (Custom)
                  </Text>
                </TouchableOpacity>
              </View>

              {selectedReason === "OTHER" && (
                <TextInput
                  style={styles.customReasonInput}
                  placeholder="Enter cancellation reason..."
                  placeholderTextColor={Theme.textMuted}
                  value={customReason}
                  onChangeText={setCustomReason}
                  multiline
                />
              )}

              <View style={{ height: 10 }} />
              <Text
                style={[
                  styles.modalDesc,
                  { marginBottom: 10, fontWeight: "bold", color: Theme.textPrimary, textAlign: 'left' },
                ]}
              >
                Enter Void Password
              </Text>
              <TextInput
                ref={passwordInputRef}
                style={[styles.customReasonInput, { minHeight: 50, marginTop: 0 }]}
                placeholder="Void Password"
                placeholderTextColor={Theme.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                keyboardType="number-pad"
              />
            </ScrollView>
          )}

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalBtnCancel} onPress={onClose}>
              <Text style={styles.modalBtnTextCancel}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtnConfirm, { backgroundColor: Theme.danger }]}
              disabled={isCancelling || !password || !selectedReason}
              onPress={handleConfirm}
            >
              {isCancelling ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalBtnTextConfirm}>Confirm</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: Theme.bgCard,
    borderRadius: 24,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    ...Theme.shadowLg,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    marginBottom: 8,
    textAlign: "center",
  },
  modalDesc: {
    fontSize: 14,
    fontFamily: Fonts.semiBold,
    color: Theme.textSecondary,
    marginBottom: 20,
    textAlign: "center",
  },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    backgroundColor: Theme.bgNav,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  reasonRowSelected: {
    backgroundColor: Theme.primary + "10",
    borderColor: Theme.primary,
  },
  reasonRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Theme.textMuted,
    marginRight: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  reasonRadioSelected: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  reasonName: {
    fontSize: 14,
    fontFamily: Fonts.semiBold,
    color: Theme.textPrimary,
  },
  customReasonInput: {
    backgroundColor: Theme.bgNav,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    fontFamily: Fonts.semiBold,
    color: Theme.textPrimary,
    borderWidth: 1,
    borderColor: Theme.border,
    minHeight: 80,
    textAlignVertical: "top",
    marginTop: 8,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
  },
  modalBtnCancel: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: Theme.bgNav,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
  },
  modalBtnTextCancel: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  modalBtnConfirm: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    ...Theme.shadowSm,
  },
  modalBtnTextConfirm: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: "#fff",
  },
  quickReasonsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 20,
    justifyContent: "center",
  },
  quickReasonChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Theme.bgNav,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  quickReasonChipSelected: {
    backgroundColor: Theme.primary,
    borderColor: Theme.primary,
  },
  quickReasonText: {
    fontSize: 12,
    fontFamily: Fonts.semiBold,
    color: Theme.textPrimary,
  },
  quickReasonTextSelected: {
    color: "#fff",
  },
});

export default CancelOrderModal;
