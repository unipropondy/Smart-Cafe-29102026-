import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
} from "react-native";
import { Theme } from "../constants/theme";
import { Fonts } from "../constants/Fonts";

interface VoidItemModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (password: string) => void;
  itemName: string;
}

const VoidItemModal = ({
  visible,
  onClose,
  onConfirm,
  itemName,
}: VoidItemModalProps) => {
  const [password, setPassword] = useState("");

  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { maxWidth: 350 }]}>
          <Text style={styles.modalTitle}>Void Item?</Text>
          <Text style={styles.modalDesc}>
            Enter password to void "{itemName}". This will mark the item as cancelled.
          </Text>

          <TextInput
            style={styles.passwordInput}
            placeholder="Void Password"
            placeholderTextColor={Theme.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            keyboardType="number-pad"
            autoFocus
          />

          <View style={styles.modalActions}>
            <TouchableOpacity style={styles.modalBtnCancel} onPress={onClose}>
              <Text style={styles.modalBtnTextCancel}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtnConfirm, { backgroundColor: Theme.danger }]}
              onPress={() => {
                onConfirm(password);
                setPassword("");
              }}
            >
              <Text style={styles.modalBtnTextConfirm}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
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
  passwordInput: {
    backgroundColor: Theme.bgNav,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    fontFamily: Fonts.semiBold,
    color: Theme.textPrimary,
    borderWidth: 1,
    borderColor: Theme.border,
    minHeight: 50,
    textAlign: "center",
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
});

export default VoidItemModal;
