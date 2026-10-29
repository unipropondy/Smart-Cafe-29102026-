import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StatusBar,
} from "react-native";

import { useActiveOrdersStore } from "../stores/activeOrdersStore";
import { useCartStore } from "../stores/cartStore";
import { getOrderContext } from "../stores/orderContextStore";
import { API_URL } from "@/constants/Config";
import { Fonts } from "../constants/Fonts";
import { Theme } from "../constants/theme";

export default function DiscountModal({
  visible,
  onClose,
  currentTotal,
}: {
  visible: boolean;
  onClose: () => void;
  currentTotal: number;
}) {
  const applyDiscount = useCartStore((s) => s.applyDiscount);
  const clearDiscount = useCartStore((s) => s.clearDiscount);
  const currentDiscounts = useCartStore((s) => s.discounts);
  const currentContextId = useCartStore((s) => s.currentContextId);
  const updateOrderDiscount = useActiveOrdersStore((s) => s.updateOrderDiscount);

  const hasAppliedDiscount = !!(currentContextId && currentDiscounts[currentContextId]?.applied);

  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("percentage");
  const [inputValue, setInputValue] = useState("");
  const [previewDiscount, setPreviewDiscount] = useState(0);
  const [dbDiscounts, setDbDiscounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const isFetchingRef = useRef(false);

  const fetchDiscounts = async () => {
    if (isFetchingRef.current) return; // Prevent double-fetch
    isFetchingRef.current = true;
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/admin/discounts`);
      const data = await res.json();
      if (Array.isArray(data)) setDbDiscounts(data);
    } catch (err) {
      console.error("Fetch discounts error:", err);
    } finally {
      setLoading(false);
      isFetchingRef.current = false;
    }
  };

  useEffect(() => {
    // Only fetch once — cache in state for lifetime of the component
    if (visible && dbDiscounts.length === 0) fetchDiscounts();
  }, [visible]);

  const handleApplyDbDiscount = (disc: any) => {
    let type: "percentage" | "fixed" = "percentage";
    let value = 0;

    const pct = parseFloat(disc.DiscountPercentage) || 0;
    const isGuest = disc.isGuestMeal === true || parseInt(disc.isGuestMeal) === 1;
    const fixedAmt = parseFloat(disc.DiscountAmount) || 0;

    if (isGuest) {
      type = "percentage";
      value = 100;
    } else if (pct > 0) {
      type = "percentage";
      value = pct;
    } else if (fixedAmt > 0) {
      type = "fixed";
      value = fixedAmt;
    } else {
      return; // No valid discount value — do nothing
    }

    const discountData = { 
      applied: true, 
      type, 
      value, 
      label: disc.Description || disc.DiscountCode,
      discountId: disc.DiscountId || disc.discountId || null,
      discountCode: disc.DiscountCode || disc.discountCode || null
    };
    applyDiscount(discountData);
    const currentContext = getOrderContext();
    if (currentContext) updateOrderDiscount(currentContext, discountData);
    onClose();
  };

  useEffect(() => {
    if (!visible) return;
    const value = parseFloat(inputValue);
    if (!value || isNaN(value)) {
      setPreviewDiscount(0);
      return;
    }
    let discount = 0;
    if (discountType === "percentage") {
      discount = (currentTotal * value) / 100;
      if (value > 100) discount = currentTotal;
    } else {
      discount = value;
      if (value > currentTotal) discount = currentTotal;
    }
    setPreviewDiscount(discount);
  }, [inputValue, discountType, currentTotal, visible]);

  const handleApply = () => {
    let value = parseFloat(inputValue);
    if (!value || isNaN(value) || value <= 0) return;
    if (discountType === "percentage" && value > 100) {
      value = 100;
    }
    const discountData = { applied: true, type: discountType, value: value };
    applyDiscount(discountData);
    const currentContext = getOrderContext();
    if (currentContext) updateOrderDiscount(currentContext, discountData);
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

  return (
    <Modal visible={visible} transparent animationType="fade">
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <View style={styles.iconCircle}><Ionicons name="pricetag" size={18} color={Theme.primary} /></View>
              <Text style={styles.title}>Apply Discount</Text>
            </View>
            <TouchableOpacity onPress={handleCancel} style={styles.closeBtn}><Ionicons name="close" size={24} color={Theme.textSecondary} /></TouchableOpacity>
          </View>

          {hasAppliedDiscount && (
            <TouchableOpacity 
              style={styles.clearBadge} 
              onPress={() => {
                clearDiscount();
                const currentContext = getOrderContext();
                if (currentContext) updateOrderDiscount(currentContext, { applied: false, type: "fixed", value: 0 });
                onClose();
              }}
            >
              <Ionicons name="trash-outline" size={14} color={Theme.danger} />
              <Text style={styles.clearBadgeText}>Remove Applied Discount</Text>
            </TouchableOpacity>
          )}

          <View style={styles.segmentedControl}>
            <TouchableOpacity style={[styles.segmentBtn, discountType === "percentage" && styles.segmentActive]} onPress={() => { setDiscountType("percentage"); setInputValue(""); }}>
              <Text style={[styles.segmentText, discountType === "percentage" && styles.segmentTextActive]}>Percentage (%)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.segmentBtn, discountType === "fixed" && styles.segmentActive]} onPress={() => { setDiscountType("fixed"); setInputValue(""); }}>
              <Text style={[styles.segmentText, discountType === "fixed" && styles.segmentTextActive]}>Fixed Amount ({require("../stores/companySettingsStore").useCompanySettingsStore.getState().settings.currencySymbol || "$"})</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionLabel}>Available Promotions</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.promoScroll}>
            {discountType === "percentage" ? (
              <>
                <TouchableOpacity style={styles.discountCard} onPress={() => { setInputValue("10"); setPreviewDiscount((currentTotal * 10) / 100); }}>
                  <Text style={styles.discountCardLabel}>10%</Text>
                  <Text style={styles.discountCardSmall}>Promo 10%</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.discountCard} onPress={() => { setInputValue("25"); setPreviewDiscount((currentTotal * 25) / 100); }}>
                  <Text style={styles.discountCardLabel}>25%</Text>
                  <Text style={styles.discountCardSmall}>Promo 25%</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.discountCard} onPress={() => { setInputValue("50"); setPreviewDiscount((currentTotal * 50) / 100); }}>
                  <Text style={styles.discountCardLabel}>50%</Text>
                  <Text style={styles.discountCardSmall}>Promo 50%</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.discountCard} onPress={() => { setInputValue("100"); setPreviewDiscount(currentTotal); }}>
                  <Text style={styles.discountCardLabel}>100%</Text>
                  <Text style={styles.discountCardSmall}>FOC 100%</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity style={styles.discountCard} onPress={() => { setInputValue("5"); setPreviewDiscount(Math.min(currentTotal, 5)); }}>
                  <Text style={styles.discountCardLabel}>{require("../stores/companySettingsStore").useCompanySettingsStore.getState().settings.currencySymbol || "$"}5</Text>
                  <Text style={styles.discountCardSmall}>{require("../stores/companySettingsStore").useCompanySettingsStore.getState().settings.currencySymbol || "$"}5 Off</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.discountCard} onPress={() => { setInputValue("10"); setPreviewDiscount(Math.min(currentTotal, 10)); }}>
                  <Text style={styles.discountCardLabel}>{require("../stores/companySettingsStore").useCompanySettingsStore.getState().settings.currencySymbol || "$"}10</Text>
                  <Text style={styles.discountCardSmall}>{require("../stores/companySettingsStore").useCompanySettingsStore.getState().settings.currencySymbol || "$"}10 Off</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.discountCard} onPress={() => { setInputValue("25"); setPreviewDiscount(Math.min(currentTotal, 25)); }}>
                  <Text style={styles.discountCardLabel}>{require("../stores/companySettingsStore").useCompanySettingsStore.getState().settings.currencySymbol || "$"}25</Text>
                  <Text style={styles.discountCardSmall}>{require("../stores/companySettingsStore").useCompanySettingsStore.getState().settings.currencySymbol || "$"}25 Off</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.discountCard} onPress={() => { setInputValue("50"); setPreviewDiscount(Math.min(currentTotal, 50)); }}>
                  <Text style={styles.discountCardLabel}>{require("../stores/companySettingsStore").useCompanySettingsStore.getState().settings.currencySymbol || "$"}50</Text>
                  <Text style={styles.discountCardSmall}>{require("../stores/companySettingsStore").useCompanySettingsStore.getState().settings.currencySymbol || "$"}50 Off</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>



          <Text style={styles.sectionLabel}>Custom Value</Text>
          <View style={styles.inputWrapper}>
            <Text style={styles.inputPrefix}>{discountType === "fixed" ? (require("../stores/companySettingsStore").useCompanySettingsStore.getState().settings.currencySymbol || "$") : "%"}</Text>
            <TextInput style={styles.input} placeholder="0.00" placeholderTextColor={Theme.textMuted} keyboardType="decimal-pad" value={inputValue} onChangeText={handleInputChange} maxLength={8} />
          </View>

          {previewDiscount > 0 && (
            <View style={styles.previewContainer}>
              <Text style={styles.previewLabel}>Total Discount:</Text>
              <Text style={styles.previewValue}>-{require("../stores/companySettingsStore").useCompanySettingsStore.getState().settings.currencySymbol || "$"}{previewDiscount.toFixed(2)}</Text>
            </View>
          )}

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.cancelActionBtn} onPress={handleCancel}><Text style={styles.cancelActionText}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.applyBtn, previewDiscount <= 0 && { opacity: 0.5 }]} onPress={handleApply} disabled={previewDiscount <= 0}><Text style={styles.applyBtnText}>Apply Discount</Text></TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", alignItems: "center", padding: 20 },
  container: { width: "100%", maxWidth: 400, backgroundColor: Theme.bgCard, borderRadius: 24, padding: 24, borderWidth: 1, borderColor: Theme.border, ...Theme.shadowLg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  headerTitleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconCircle: { width: 36, height: 36, borderRadius: 12, backgroundColor: Theme.primary + "15", justifyContent: "center", alignItems: "center" },
  title: { color: Theme.textPrimary, fontSize: 20, fontFamily: Fonts.black },
  closeBtn: { padding: 6, backgroundColor: Theme.bgMuted, borderRadius: 12 },
  segmentedControl: { flexDirection: "row", backgroundColor: Theme.bgMuted, borderRadius: 14, padding: 4, marginBottom: 20, borderWidth: 1, borderColor: Theme.border },
  segmentBtn: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: 10 },
  segmentActive: { backgroundColor: Theme.bgCard, ...Theme.shadowSm, borderWidth: 1, borderColor: Theme.border },
  segmentText: { color: Theme.textSecondary, fontFamily: Fonts.black, fontSize: 13 },
  segmentTextActive: { color: Theme.primary },
  sectionLabel: { color: Theme.textMuted, fontSize: 10, fontFamily: Fonts.black, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 },
  quickRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: 8, marginBottom: 20 },
  quickBtn: { width: "31.5%", backgroundColor: Theme.bgCard, paddingVertical: 14, alignItems: "center", borderRadius: 12, borderWidth: 1, borderColor: Theme.border, ...Theme.shadowSm },
  quickBtnActive: { backgroundColor: Theme.primary + "10", borderColor: Theme.primary },
  quickText: { color: Theme.textSecondary, fontFamily: Fonts.black, fontSize: 15 },
  quickTextActive: { color: Theme.primary },
  promoScroll: { marginBottom: 20, marginHorizontal: -24, paddingHorizontal: 24 },
  discountCard: { backgroundColor: Theme.success + "10", borderWidth: 1, borderColor: Theme.success + "30", borderRadius: 12, padding: 14, marginRight: 10, minWidth: 110, alignItems: "center" },
  discountCardLabel: { color: Theme.success, fontSize: 18, fontFamily: Fonts.black },
  discountCardSmall: { color: Theme.textMuted, fontSize: 10, fontFamily: Fonts.bold, marginTop: 4 },
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
