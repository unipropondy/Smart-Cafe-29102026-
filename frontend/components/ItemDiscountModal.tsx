import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StatusBar,
  Alert,
} from "react-native";

import { useCartStore } from "../stores/cartStore";
import { API_URL } from "@/constants/Config";
import { Fonts } from "../constants/Fonts";
import { Theme } from "../constants/theme";

export default function ItemDiscountModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
  item?: any | null;
}) {
  const applyBulkItemDiscount = useCartStore((s) => s.applyBulkItemDiscount);
  const cart = useCartStore((s) => s.getCart());

  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("percentage");
  const [inputValue, setInputValue] = useState("");
  const [previewDiscount, setPreviewDiscount] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setInputValue("");
    setDiscountType("percentage");
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const value = parseFloat(inputValue);
    if (!value || isNaN(value)) {
      setPreviewDiscount(0);
      return;
    }
    let totalDiscount = 0;
    cart.forEach((item: any) => {
      const isAllowed = item.IsDiscountAllowed === true || item.IsDiscountAllowed === 1 || Number(item.IsDiscountAllowed) === 1;
      if (isAllowed && item.status !== "VOIDED") {
        const isCombo = item.isCombo === true || String(item.isCombo) === "1" || item.isCombo === 1;
        const discountBasis = isCombo ? (item.basePrice ?? item.price ?? 0) : (item.price ?? 0);
        
        if (discountType === "percentage") {
          let disc = (discountBasis * (item.qty || 1) * value) / 100;
          if (value > 100) disc = discountBasis * (item.qty || 1);
          totalDiscount += disc;
        } else {
          let disc = Math.min(value, discountBasis) * (item.qty || 1);
          totalDiscount += disc;
        }
      }
    });
    setPreviewDiscount(totalDiscount);
  }, [inputValue, discountType, cart, visible]);

  const handleApply = () => {
    let value = parseFloat(inputValue);
    if (!value || isNaN(value) || value <= 0) return;

    if (discountType === "percentage" && value > 100) {
      value = 100;
    }

    applyBulkItemDiscount(value, discountType);
    setInputValue("");
    setDiscountType("percentage");
    onClose();
  };

  const handleCancel = () => {
    setInputValue("");
    setDiscountType("percentage");
    setPreviewDiscount(0);
    onClose();
  };

  const handleRemoveDiscount = () => {
    applyBulkItemDiscount(0, "percentage");
    onClose();
  };

  const handleInputChange = (text: string) => {
    let cleaned = text.replace(/[^0-9.]/g, '');
    const parts = cleaned.split('.');
    if (parts.length > 2) cleaned = parts[0] + '.' + parts.slice(1).join('');
    if (discountType === "percentage") {
      const num = parseFloat(cleaned);
      if (!isNaN(num) && num > 100) {
        cleaned = "100";
      }
    }
    setInputValue(cleaned);
  };

  const hasAnyDiscount = cart.some(item => {
    const isAllowed = item.IsDiscountAllowed === true || item.IsDiscountAllowed === 1 || Number(item.IsDiscountAllowed) === 1;
    return isAllowed && (Number(item.discountAmount ?? 0) > 0 || Number(item.discount ?? 0) > 0);
  });

  return (
    <Modal visible={visible} transparent animationType="fade">
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={styles.iconCircle}><Ionicons name="pricetag" size={18} color={Theme.primary} /></View>
              <Text style={styles.title}>Item Discount</Text>
            </View>
            <TouchableOpacity onPress={handleCancel} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={Theme.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.itemName}>
            Apply discount to all eligible items
          </Text>

          {hasAnyDiscount && (
            <TouchableOpacity 
              style={styles.clearBadge} 
              onPress={handleRemoveDiscount}
            >
              <Ionicons name="trash-outline" size={14} color={Theme.danger} />
              <Text style={styles.clearBadgeText}>Remove All Item Discounts</Text>
            </TouchableOpacity>
          )}

          <View style={styles.segmentedControl}>
            <TouchableOpacity 
              style={[styles.segmentBtn, discountType === "percentage" && styles.segmentActive]} 
              onPress={() => { setDiscountType("percentage"); setInputValue(""); }}
            >
              <Text style={[styles.segmentText, discountType === "percentage" && styles.segmentTextActive]}>Percentage (%)</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.segmentBtn, discountType === "fixed" && styles.segmentActive]} 
              onPress={() => { setDiscountType("fixed"); setInputValue(""); }}
            >
              <Text style={[styles.segmentText, discountType === "fixed" && styles.segmentTextActive]}>Fixed Amount ({useCartStore.getState() ? (require("../stores/companySettingsStore").useCompanySettingsStore.getState().settings.currencySymbol || "$") : "$"})</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionLabel}>Custom Value</Text>
          <View style={styles.inputWrapper}>
            <Text style={styles.inputPrefix}>{discountType === "fixed" ? (require("../stores/companySettingsStore").useCompanySettingsStore.getState().settings.currencySymbol || "$") : "%"}</Text>
            <TextInput 
              style={styles.input} 
              placeholder="0.00" 
              placeholderTextColor={Theme.textMuted} 
              keyboardType="decimal-pad" 
              value={inputValue} 
              onChangeText={handleInputChange} 
              maxLength={8}
            />
          </View>

          {previewDiscount > 0 && (
            <View style={styles.previewContainer}>
              <Text style={styles.previewLabel}>Total Est. Discount:</Text>
              <Text style={styles.previewValue}>-{require("../stores/companySettingsStore").useCompanySettingsStore.getState().settings.currencySymbol || "$"}{previewDiscount.toFixed(2)}</Text>
            </View>
          )}

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.cancelActionBtn} onPress={handleCancel}>
              <Text style={styles.cancelActionText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.applyBtn, previewDiscount <= 0 && { opacity: 0.5 }]} 
              onPress={handleApply} 
              disabled={previewDiscount <= 0}
            >
              <Text style={styles.applyBtnText}>Apply Discount</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 20 },
  container: { width: "100%", maxWidth: 400, backgroundColor: Theme.bgCard, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: Theme.border, ...Theme.shadowLg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconCircle: { width: 36, height: 36, borderRadius: 12, backgroundColor: Theme.primary + "15", justifyContent: "center", alignItems: "center" },
  title: { color: Theme.textPrimary, fontSize: 20, fontFamily: Fonts.black },
  closeBtn: { padding: 6, backgroundColor: Theme.bgMuted, borderRadius: 12 },
  itemName: { color: Theme.textSecondary, fontSize: 14, fontFamily: Fonts.bold, marginBottom: 16 },
  segmentedControl: { flexDirection: "row", backgroundColor: Theme.bgMuted, borderRadius: 14, padding: 4, marginBottom: 20, borderWidth: 1, borderColor: Theme.border },
  segmentBtn: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: 10 },
  segmentActive: { backgroundColor: Theme.bgCard, ...Theme.shadowSm, borderWidth: 1, borderColor: Theme.border },
  segmentText: { color: Theme.textSecondary, fontFamily: Fonts.black, fontSize: 13 },
  segmentTextActive: { color: Theme.primary },
  sectionLabel: { color: Theme.textMuted, fontSize: 10, fontFamily: Fonts.black, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 },
  inputWrapper: { flexDirection: "row", alignItems: "center", backgroundColor: Theme.bgInput, borderWidth: 1, borderColor: Theme.border, borderRadius: 16, paddingHorizontal: 16, height: 60, marginBottom: 20 },
  inputPrefix: { color: Theme.textSecondary, fontSize: 20, fontFamily: Fonts.black, marginRight: 10 },
  input: { flex: 1, color: Theme.textPrimary, fontSize: 22, fontFamily: Fonts.black, ...Platform.select({ web: { outlineStyle: "none" } as any }) },
  previewContainer: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: Theme.primary + "10", padding: 16, borderRadius: 16, borderWidth: 1, borderColor: Theme.primary + "30", marginBottom: 20 },
  previewLabel: { color: Theme.primary, fontSize: 14, fontFamily: Fonts.black },
  previewValue: { color: Theme.primary, fontSize: 22, fontFamily: Fonts.black },
  actionRow: { flexDirection: "row", gap: 12 },
  cancelActionBtn: { flex: 1, height: 60, borderRadius: 16, backgroundColor: Theme.bgMuted, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: Theme.border },
  cancelActionText: { color: Theme.textSecondary, fontSize: 16, fontFamily: Fonts.black },
  applyBtn: { flex: 2, backgroundColor: Theme.primary, height: 60, borderRadius: 16, justifyContent: "center", alignItems: "center", ...Theme.shadowMd },
  applyBtnText: { color: "#fff", fontSize: 16, fontFamily: Fonts.black },
  clearBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.danger + "10",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 6,
    marginBottom: 20,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: Theme.danger + "30",
  },
  clearBadgeText: {
    color: Theme.danger,
    fontSize: 12,
    fontFamily: Fonts.black,
  },
});
