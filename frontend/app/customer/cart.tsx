import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
  Animated,
  Dimensions,
  Easing,
} from "react-native";
import { useRouter } from "expo-router";
import { Theme } from "../../constants/theme";
import { useCartStore } from "../../stores/cartStore";
import { useOrderContextStore } from "../../stores/orderContextStore";
import { useCompanySettingsStore } from "../../stores/companySettingsStore";
import { useGeneralSettingsStore } from "../../stores/generalSettingsStore";
import { API_URL } from "../../constants/Config";
import { Ionicons } from "@expo/vector-icons";

// 🍕 Food particle config — each floats on its own arc trajectory
const FOOD_PARTICLES = [
  { emoji: "🍕", startX: 0,   startY: 0,  endX: -110, endY: -90,  delay: 0,    duration: 2200 },
  { emoji: "🍜", startX: 0,   startY: 0,  endX:  110, endY: -85,  delay: 300,  duration: 2000 },
  { emoji: "🍗", startX: 0,   startY: 0,  endX: -130, endY:  20,  delay: 600,  duration: 2400 },
  { emoji: "🥗", startX: 0,   startY: 0,  endX:  130, endY:  25,  delay: 900,  duration: 2100 },
  { emoji: "🍰", startX: 0,   startY: 0,  endX: -70,  endY:  110, delay: 1200, duration: 2300 },
  { emoji: "🧆", startX: 0,   startY: 0,  endX:  70,  endY:  115, delay: 1500, duration: 2000 },
];

const FoodParticle = ({ emoji, endX, endY, delay, duration }: any) => {
  const x = useRef(new Animated.Value(0)).current;
  const y = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.3)).current;
  const rotate = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const run = () => {
      x.setValue(0); y.setValue(0); opacity.setValue(0); scale.setValue(0.3); rotate.setValue(0);
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1.2, duration: 400, easing: Easing.out(Easing.back(1.5)), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(x, { toValue: endX, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(y, { toValue: endY, duration, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(rotate, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }),
          Animated.sequence([
            Animated.delay(duration * 0.55),
            Animated.timing(opacity, { toValue: 0, duration: duration * 0.45, useNativeDriver: true }),
          ]),
          Animated.sequence([
            Animated.delay(duration * 0.3),
            Animated.timing(scale, { toValue: 0.7, duration: duration * 0.7, useNativeDriver: true }),
          ]),
        ]),
      ]).start(() => run());
    };
    run();
  }, []);

  const spin = rotate.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <Animated.View
      style={{
        position: "absolute",
        transform: [{ translateX: x }, { translateY: y }, { scale }, { rotate: spin }],
        opacity,
      }}
    >
      <Text style={{ fontSize: 28 }}>{emoji}</Text>
    </Animated.View>
  );
};

const SpeederLoader = () => {
  const floatY = useRef(new Animated.Value(0)).current;
  const rotateVal = useRef(new Animated.Value(0)).current;
  const glowScale = useRef(new Animated.Value(1)).current;
  const plateScale = useRef(new Animated.Value(1)).current;

  // Subtitle cycling
  const subtitles = [
    "Flipping pans and firing up the kitchen...",
    "Gathering the freshest ingredients...",
    "Your order is on its way! 🔥",
  ];
  const [subtitleIdx, setSubtitleIdx] = useState(0);
  const subtitleOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Floating bob
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatY, { toValue: -14, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(floatY, { toValue: 0, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();

    // Spinning orbit ring
    Animated.loop(
      Animated.timing(rotateVal, { toValue: 1, duration: 3200, easing: Easing.linear, useNativeDriver: true })
    ).start();

    // Glow pulse
    Animated.loop(
      Animated.sequence([
        Animated.timing(glowScale, { toValue: 1.18, duration: 900, useNativeDriver: true }),
        Animated.timing(glowScale, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    ).start();

    // Plate heartbeat
    Animated.loop(
      Animated.sequence([
        Animated.timing(plateScale, { toValue: 1.08, duration: 700, useNativeDriver: true }),
        Animated.timing(plateScale, { toValue: 0.96, duration: 600, useNativeDriver: true }),
        Animated.timing(plateScale, { toValue: 1, duration: 400, useNativeDriver: true }),
      ])
    ).start();

    // Subtitle crossfade cycle
    const cycleSubtitle = () => {
      Animated.sequence([
        Animated.timing(subtitleOpacity, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start(() => {
        setSubtitleIdx(prev => (prev + 1) % subtitles.length);
        Animated.timing(subtitleOpacity, { toValue: 1, duration: 400, useNativeDriver: true }).start();
      });
    };
    const interval = setInterval(cycleSubtitle, 2200);
    return () => clearInterval(interval);
  }, []);

  const spin = rotateVal.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const { width: windowWidth, height: windowHeight } = Dimensions.get("window");

  return (
    <View style={[styles.speederOverlay, { width: windowWidth, height: windowHeight }]}>
      {/* Center floating plate container */}
      <Animated.View style={{ transform: [{ translateY: floatY }], alignItems: "center", justifyContent: "center", marginBottom: 28, position: "relative", width: 200, height: 200 }}>
        
        {/* Flying food particles — centered relative to the plate container */}
        <View style={{ position: "absolute", width: 28, height: 28, alignItems: "center", justifyContent: "center", zIndex: 10 }}>
          {FOOD_PARTICLES.map((p, i) => (
            <FoodParticle key={i} {...p} />
          ))}
        </View>

        {/* Outer glow ring */}
        <Animated.View style={[styles.loaderGlow, { transform: [{ scale: glowScale }] }]} />

        {/* Spinning dashed orbit */}
        <Animated.View style={[styles.loaderRing, { transform: [{ rotate: spin }] }]}>
          <View style={styles.ringDot} />
          <View style={[styles.ringDot, { bottom: -4, top: undefined }]} />
          <View style={[styles.ringDot, { top: undefined, left: -4, right: undefined, bottom: "50%" }]} />
        </Animated.View>

        {/* Plate icon */}
        <Animated.View style={[styles.loaderPlatter, { transform: [{ scale: plateScale }] }]}>
          <Text style={{ fontSize: 38 }}>🍽️</Text>
        </Animated.View>
      </Animated.View>

      <Text style={styles.loaderTitleText}>Sending to Kitchen</Text>
      <Animated.Text style={[styles.loaderSubtitleText, { opacity: subtitleOpacity }]}>
        {subtitles[subtitleIdx]}
      </Animated.Text>
    </View>
  );
};

export default function CustomerCartScreen() {
  const router = useRouter();
  const { carts, currentContextId, updateCartItemQty, syncCartWithDB, checkoutOrder, cancelPendingSync } = useCartStore();
  const orderContext = useOrderContextStore((state) => state.currentOrder);
  const settings = useCompanySettingsStore((state: any) => state.settings);
  const generalSettings = useGeneralSettingsStore((state) => state.settings);
  
  // 🌟 Premium Micro-Animation refs & state
  const [isAnimating, setIsAnimating] = useState(false);
  const animButtonScale = useRef(new Animated.Value(1)).current;
  const animTextOpacity = useRef(new Animated.Value(1)).current;
  const animRocketScale = useRef(new Animated.Value(0)).current;
  const animRocketY = useRef(new Animated.Value(40)).current; // starts below
  const animShake = useRef(new Animated.Value(0)).current; // shakes left-right
  const animSuccessOpacity = useRef(new Animated.Value(0)).current;
  const animButtonColor = useRef(new Animated.Value(0)).current; // 0 = brand, 1 = emerald success
  const animButtonWidth = useRef(new Animated.Value(1)).current; // 1 = full width, 0 = circular capsule
  const animLoaderOpacity = useRef(new Animated.Value(1)).current; // Smooth overlay fade-out
  const animLoaderScale = useRef(new Animated.Value(1)).current;  // Scale-up on smooth exit
  
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isSendingRef = useRef(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [userInfo, setUserInfo] = useState<any>(null);
  const [applyPromo, setApplyPromo] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [validatingPromo, setValidatingPromo] = useState(false);
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; amount: number; discountType?: string } | null>(null);

  React.useEffect(() => {
    if (typeof localStorage !== "undefined") {
      const stored = localStorage.getItem("qr_pos_user");
      let userObj: any = null;
      if (stored) {
        try {
          userObj = JSON.parse(stored);
          setUserInfo(userObj);
        } catch (e) {}
      }
      const savedPromo = localStorage.getItem("promoCode");
      if (savedPromo) {
        const amount = Number(userObj?.PromoAmount ?? userObj?.Promoamount ?? userObj?.promoAmount ?? 0);
        setAppliedPromo({ code: savedPromo, amount, discountType: "AMOUNT" });
        setApplyPromo(true);
      }
    }
    useGeneralSettingsStore.getState().fetchSettings();
  }, []);

  // 🔄 REAL-TIME SYNC: If another person on the same table places an order while this
  // customer is on the cart screen, clear local NEW items and re-fetch from the server
  // so "Place Order" disappears and the cart reflects the confirmed order.
  useEffect(() => {
    if (!orderContext?.tableId) return;
    const tableId = String(orderContext.tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
    const { socket: sharedSocket } = require("../../constants/socket");
    sharedSocket.emit("join_table", { tableId });

    const handleCartUpdated = (data: { tableId: string; source?: string }) => {
      const incomingId = String(data.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
      if (incomingId === tableId) {
        useCartStore.getState().fetchCartFromDB(orderContext.tableId!, true);
      }
    };

    sharedSocket.on("cart_updated", handleCartUpdated);
    return () => { sharedSocket.off("cart_updated", handleCartUpdated); };
  }, [orderContext?.tableId]);

  const currentCart = (currentContextId ? carts[currentContextId] || [] : []).filter(item => item.status === "NEW" || !item.status);
  const totalItems = currentCart.reduce((sum, item) => sum + (item.qty || 0), 0);
  const subtotal = currentCart.reduce((sum, item) => sum + (item.price || 0) * (item.qty || 0), 0);

  const serviceChargePercentage = Number(settings?.serviceChargePercentage ?? settings?.ServiceChargePercentage ?? 0);
  const gstPercentage = Number(settings?.gstPercentage ?? settings?.GSTPercentage ?? 0);
  const takeawayChargeRate = Number(settings?.takeawayCharges ?? settings?.TakeawayCharges ?? settings?.takeawayCharge ?? settings?.TakeawayCharge ?? 0);
  const currencySymbol = settings?.currencySymbol ?? settings?.CurrencySymbol ?? "$";
  const showPromoCodeFeature = settings?.showPromoCode !== false && settings?.ShowPromoCode !== false;

  const memberCode = userInfo?.PromoCode || userInfo?.Promocode || userInfo?.promoCode || "";
  const memberAmount = Number(userInfo?.PromoAmount ?? userInfo?.Promoamount ?? userInfo?.promoAmount ?? 0);

  const activePromoCode = appliedPromo?.code || (applyPromo && memberCode ? memberCode : "") || (typeof localStorage !== "undefined" ? localStorage.getItem("promoCode") || "" : "");
  const activePromoAmount = appliedPromo?.amount ?? (memberCode ? memberAmount : 0);
  const activeDiscountType = (appliedPromo?.discountType || "AMOUNT").toUpperCase();
  const isPercentageDiscount = activeDiscountType === "PERCENTAGE" || activeDiscountType === "PERCENT";

  let rawDiscount = 0;
  if (applyPromo && activePromoCode && activePromoAmount > 0) {
    if (isPercentageDiscount) {
      rawDiscount = subtotal * (activePromoAmount / 100);
    } else {
      rawDiscount = Math.min(subtotal, activePromoAmount);
    }
  }
  const discountAmt = Math.max(0, Math.min(subtotal, rawDiscount));
  const netSubtotal = Math.max(0, subtotal - discountAmt);

  // Calculate service charge eligible subtotal (all dine-in items that are not takeaway)
  const scEligibleSubtotal = currentCart.reduce((sum, item) => {
    const isTakeaway = item.isTakeaway === true || String(item.isTakeaway) === "1" || String(item.isTakeaway).toLowerCase() === "true" || (item as any).IsTakeaway === true || String((item as any).IsTakeaway) === "1" || String((item as any).IsTakeaway).toLowerCase() === "true";
    const isSC = !isTakeaway && (Number(item.isServiceCharge) === 1 || item.isServiceCharge === true || Number((item as any).IsServiceCharge) === 1 || (item as any).IsServiceCharge === true);
    if (isSC) {
      return sum + (item.price || 0) * (item.qty || 0);
    }
    return sum;
  }, 0);

  // Calculate takeaway items quantity and charge
  const takeawayItemsQty = currentCart.reduce((sum, item) => {
    const isTakeaway = item.isTakeaway === true || String(item.isTakeaway) === "1" || String(item.isTakeaway).toLowerCase() === "true" || (item as any).IsTakeaway === true || String((item as any).IsTakeaway) === "1" || String((item as any).IsTakeaway).toLowerCase() === "true";
    if (isTakeaway) {
      return sum + (item.qty || 0);
    }
    return sum;
  }, 0);
  const takeawayChargeAmt = takeawayItemsQty * takeawayChargeRate;

  // Pro-rate service charge if discount is applied
  const serviceChargeAmt = Math.max(0, scEligibleSubtotal - discountAmt) * (serviceChargePercentage / 100);
  const totalBeforeGst = netSubtotal + serviceChargeAmt + takeawayChargeAmt;
  const gstAmt = totalBeforeGst * (gstPercentage / 100);
  const grandTotal = totalBeforeGst + gstAmt;

  const handleQtyChange = (lineItemId: string, currentQty: number, change: number) => {
    const newQty = currentQty + change;
    updateCartItemQty(lineItemId, newQty);
  };

  const handleApplyPromoCode = async () => {
    const codeToVerify = promoInput.trim().toUpperCase();
    if (!codeToVerify) {
      Alert.alert("Invalid Code", "Please enter a promo code.");
      return;
    }
    setValidatingPromo(true);
    try {
      const res = await fetch(`${API_URL}/api/members/promocode/${encodeURIComponent(codeToVerify)}`);
      const data = await res.json();
      if (res.ok && data.Promocode) {
        const amt = Number(data.Promoamount || data.DiscountValue || 0);
        if (amt <= 0) {
          Alert.alert("Invalid Promo", "This promo code has no remaining balance.");
          return;
        }
        const discType = (data.DiscountType || "AMOUNT").toUpperCase();
        setAppliedPromo({ code: data.Promocode, amount: amt, discountType: discType });
        setApplyPromo(true);
        setPromoInput("");
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("promoCode", data.Promocode);
        }

        // 🚀 Deduct promo amount in backend MemberMaster
        fetch(`${API_URL}/api/members/deduct-promo`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            promoCode: data.Promocode,
            amount: amt,
          }),
        }).catch((e) => console.error("Error deducting promo balance:", e));

        const discLabel = discType === "PERCENTAGE" || discType === "PERCENT" ? `${amt}%` : `${currencySymbol}${amt.toFixed(2)}`;
        Alert.alert("Promo Applied!", `Promo code ${data.Promocode} (${discLabel} off) applied successfully.`);
      } else {
        Alert.alert("Invalid Code", data.error || "Invalid or inactive promo code.");
      }
    } catch (err) {
      console.error("Promo verification error:", err);
      Alert.alert("Error", "Could not verify promo code. Please try again.");
    } finally {
      setValidatingPromo(false);
    }
  };

  const handleRemovePromo = () => {
    setAppliedPromo(null);
    setApplyPromo(false);
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("promoCode");
    }
  };

  const handlePlaceOrder = async () => {
    if (isSendingRef.current || submitting || isAnimating) return;
    isSendingRef.current = true;

    if (currentCart.length === 0) {
      Alert.alert("Cart Empty", "Please add items to your cart first.");
      isSendingRef.current = false;
      return;
    }
    if (!orderContext?.tableId) {
      Alert.alert("Error", "Table session not found. Please restart.");
      isSendingRef.current = false;
      return;
    }

    setIsAnimating(true);
    setSubmitting(true);

    try {
      const sendResponse = await fetch(`${API_URL}/api/orders/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          tableId: orderContext.tableId,
          orderType: "DINE_IN",
          entryStatus: "q",
          discountAmount: discountAmt,
          discountRemarks: applyPromo && activePromoCode ? `Applied Promo Code: ${activePromoCode}` : null,
          mobileNo: userInfo?.Phone || null,
          customerName: userInfo?.FullName || userInfo?.UserName || null,
          customerId: userInfo?.CustomerId || userInfo?.MemberId || userInfo?.UserId || null,
          memberId: userInfo?.MemberId || userInfo?.CustomerId || null,
          items: currentCart.map(item => ({
            id: item.id,
            lineItemId: item.lineItemId || item.id,
            name: item.name,
            qty: item.qty,
            price: item.price,
            modifiers: item.modifiers || [],
            status: "SENT",
            note: notes,
            isCombo: item.isCombo,
            comboSelections: item.comboSelections || [],
          }))
        })
      });

      if (sendResponse.ok) {
        // Update local storage promo amount on successful send
        if (applyPromo && activePromoCode) {
          const updatedAmount = Math.max(0, activePromoAmount - discountAmt);
          if (userInfo && typeof localStorage !== "undefined") {
            const updatedUser = { 
              ...userInfo, 
              PromoCode: activePromoCode, 
              PromoAmount: updatedAmount,
              Promocode: activePromoCode,
              Promoamount: updatedAmount 
            };
            localStorage.setItem("qr_pos_user", JSON.stringify(updatedUser));
            setUserInfo(updatedUser);
          }
          if (appliedPromo) {
            setAppliedPromo({ code: activePromoCode, amount: updatedAmount });
          }
          if (updatedAmount <= 0) {
            setApplyPromo(false);
          }
        }

        // 🛑 CANCEL any pending debounced syncCartWithDB FIRST
        cancelPendingSync();

        // ✅ MARK SENT: Update local "NEW" draft items to "SENT" status immediately
        const ctxId = currentContextId;
        if (ctxId) {
          useCartStore.setState((state) => {
            const existing = state.carts[ctxId] || [];
            const updatedCart = existing.map(item => ({
              ...item,
              status: (item.status === "NEW" || !item.status) ? ("SENT" as const) : item.status,
              sent: 1
            }));
            const newQtyMap: Record<string, number> = {};
            updatedCart.forEach(item => { newQtyMap[item.id] = (newQtyMap[item.id] || 0) + item.qty; });
            return {
              carts: { ...state.carts, [ctxId]: updatedCart },
              cartQtyMap: { ...state.cartQtyMap, [ctxId]: newQtyMap },
              lastLocalUpdate: { ...state.lastLocalUpdate, [ctxId]: 0 },
            };
          });
        }

        // Hydrate from DB to ensure state is synchronized with server
        if (orderContext?.tableId) {
          try {
            await useCartStore.getState().fetchCartFromDB(orderContext.tableId, true);
          } catch (err) {
            console.warn("Post-send fetchCartFromDB warning:", err);
          }
        }

        setSubmitting(false);
        setIsAnimating(false);
        setShowSuccessModal(true);
      } else {
        const errText = await sendResponse.text();
        console.error("Kitchen Send Error:", errText);
        Alert.alert("Order Failed", "Failed to send items to the kitchen. Please contact staff.");
        setIsAnimating(false);
        setSubmitting(false);
        isSendingRef.current = false;
      }
    } catch (err) {
      console.error("Error placing order:", err);
      Alert.alert("Network Error", "Failed to contact order server. Please try again.");
      setIsAnimating(false);
      setSubmitting(false);
      isSendingRef.current = false;
    }
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Cart</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Cart Items List */}
      <FlatList
        data={currentCart}
        keyExtractor={(item) => item.lineItemId}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="cart-outline" size={64} color="#94A3B8" />
            <Text style={styles.emptyText}>Your cart is empty.</Text>
            <TouchableOpacity style={styles.shopBtn} onPress={() => router.push("/customer/menu" as any)}>
              <Text style={styles.shopBtnText}>Browse Menu</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.cartItem}>
            <View style={styles.itemInfo}>
              <Text style={styles.itemName}>{item.name}</Text>

              {/* Combo Selections */}
              {item.isCombo && item.comboSelections && item.comboSelections.length > 0 && (
                <View style={styles.comboSelectionsContainer}>
                  {item.comboSelections.map((group: any, gIdx: number) => {
                    const groupItemsText = group.items?.map((opt: any) => {
                      return opt.name + (Number(opt.surcharge) > 0 ? ` (+${currencySymbol}${Number(opt.surcharge).toFixed(2)})` : "");
                    }).join(", ");
                    return (
                      <Text key={gIdx} style={styles.comboSelectionText}>
                        {group.groupName}: {groupItemsText}
                      </Text>
                    );
                  })}
                </View>
              )}

              {/* Regular Modifiers */}
              {item.modifiers && item.modifiers.length > 0 && (
                <View style={styles.modifierContainer}>
                  {item.modifiers.map((m: any, idx: number) => {
                    const name = m.ModifierName || m.modifierName || m.name || "";
                    const price = Number(m.Price || m.price || 0);
                    return (
                      <View key={idx} style={styles.modifierTag}>
                        <Text style={styles.modifierBullet}>•</Text>
                        <Text style={styles.modifierName}>{name}</Text>
                        {price > 0 && (
                          <Text style={styles.modifierPrice}> (+{currencySymbol}{price.toFixed(2)})</Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}

              <Text style={styles.itemPrice}>{currencySymbol}{(Number(item.price || 0) * (item.qty || 1)).toFixed(2)}</Text>
            </View>

            {/* Quantity control */}
            <View style={styles.qtyControls}>
              <TouchableOpacity
                style={styles.qtyBtn}
                onPress={() => handleQtyChange(item.lineItemId, item.qty, -1)}
              >
                <Ionicons name="remove" size={16} color="#0F172A" />
              </TouchableOpacity>
              <Text style={styles.qtyText}>{item.qty}</Text>
              <TouchableOpacity
                style={styles.qtyBtn}
                onPress={() => handleQtyChange(item.lineItemId, item.qty, 1)}
              >
                <Ionicons name="add" size={16} color="#0F172A" />
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListFooterComponent={
          currentCart.length > 0 ? (
            <View style={styles.footerContainer}>
              {/* Cooking Instructions */}
              {generalSettings.enableCookingInstructions !== false && (
                <>
                  <Text style={styles.sectionTitle}>Cooking Instructions</Text>
                  <TextInput
                    style={styles.notesInput}
                    placeholder="E.g., No onions, extra spicy, less salt..."
                    value={notes}
                    onChangeText={setNotes}
                    multiline
                    placeholderTextColor="#94A3B8"
                  />
                </>
              )}



              {/* Bill Details */}
              <Text style={styles.sectionTitle}>Bill Details</Text>
              <View style={styles.billRow}>
                <Text style={styles.billLabel}>Gross Total</Text>
                <Text style={styles.billValue}>{currencySymbol}{subtotal.toFixed(2)}</Text>
              </View>
              
              {applyPromo && discountAmt > 0 && (
                <View style={styles.billRow}>
                  <Text style={[styles.billLabel, { color: "#FF5E1A", fontWeight: "700" }]}>Promo Discount ({activePromoCode})</Text>
                  <Text style={[styles.billValue, { color: "#FF5E1A", fontWeight: "700" }]}>-{currencySymbol}{discountAmt.toFixed(2)}</Text>
                </View>
              )}
              {serviceChargePercentage > 0 && (
                <View style={styles.billRow}>
                  <Text style={styles.billLabel}>Item SVC ({serviceChargePercentage}%)</Text>
                  <Text style={styles.billValue}>{currencySymbol}{serviceChargeAmt.toFixed(2)}</Text>
                </View>
              )}
              {takeawayChargeAmt > 0 && (
                <View style={styles.billRow}>
                  <Text style={styles.billLabel}>Takeaway Charge</Text>
                  <Text style={styles.billValue}>{currencySymbol}{takeawayChargeAmt.toFixed(2)}</Text>
                </View>
              )}
              {gstPercentage > 0 && (
                <View style={styles.billRow}>
                  <Text style={styles.billLabel}>GST ({gstPercentage}%)</Text>
                  <Text style={styles.billValue}>{currencySymbol}{gstAmt.toFixed(2)}</Text>
                </View>
              )}
              <View style={[styles.billRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Grand Total</Text>
                <Text style={styles.totalValue}>{currencySymbol}{grandTotal.toFixed(2)}</Text>
              </View>
            </View>
          ) : null
        }
      />

      {/* Place Order Bar */}
      {currentCart.length > 0 && (
        <Animated.View 
          style={[
            styles.checkoutBar, 
            { 
              transform: [{ scale: animButtonScale }],
              backgroundColor: animButtonColor.interpolate({
                inputRange: [0, 1],
                outputRange: [Theme.primary, "#059669"], // Emerald success green
              }),
            }
          ]}
        >
            <TouchableOpacity style={styles.orderBtn} onPress={handlePlaceOrder} disabled={isAnimating || submitting}>
              {/* Sleek fluid progress loading bar overlay */}
              <Animated.View 
                style={[
                  styles.progressBarOverlay,
                  {
                    width: animButtonWidth.interpolate({
                      inputRange: [0, 1],
                      outputRange: ["0%", "100%"]
                    })
                  }
                ]}
              />

              {/* Default text state */}
              <Animated.View style={[styles.btnTextContainer, { opacity: animTextOpacity }]}>
                <Text style={styles.orderBtnText}>Place Order • {currencySymbol}{grandTotal.toFixed(2)}</Text>
              </Animated.View>

              {/* Loader / progress text state */}
              <Animated.View 
                style={[
                  styles.loaderTextContainer, 
                  { 
                    opacity: animTextOpacity.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 0]
                    }),
                    display: submitting ? "flex" : "none"
                  }
                ]}
              >
                <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.orderBtnText}>Sending...</Text>
              </Animated.View>

              {/* Confirmed / success state */}
              <Animated.View style={[styles.successContainer, { opacity: animSuccessOpacity }]}>
                <Ionicons name="checkmark-circle-outline" size={22} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.orderBtnText}>Confirmed!</Text>
              </Animated.View>
            </TouchableOpacity>
        </Animated.View>
      )}

      {/* Flying Food Loading Animation Screen (smooth scale-fade exit) */}
      {submitting && (
        <Animated.View 
          style={[
            StyleSheet.absoluteFill, 
            { 
              opacity: animLoaderOpacity, 
              transform: [{ scale: animLoaderScale }], 
              zIndex: 99999,
              justifyContent: "center",
              alignItems: "center",
              backgroundColor: "rgba(15, 23, 42, 0.96)"
            }
          ]}
        >
          <SpeederLoader />
        </Animated.View>
      )}

      {/* Beautiful Premium Custom Success Modal */}
      {showSuccessModal && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.iconContainer}>
              <Ionicons name="checkmark-circle" size={64} color="#10B981" />
            </View>
            <Text style={styles.modalTitle}>Order Placed!</Text>
            <Text style={styles.modalSubtitle}>Your delicious selection has been sent straight to the kitchen.</Text>
            <TouchableOpacity 
              style={styles.modalButton} 
              onPress={() => {
                setShowSuccessModal(false);
                router.replace("/customer/order-status" as any);
              }}
            >
              <Text style={styles.modalButtonText}>Track Order Status</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 48,
    paddingBottom: 16,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderColor: "#E2E8F0",
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#0F172A",
  },
  listContent: {
    padding: 16,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 100,
  },
  emptyText: {
    fontSize: 16,
    color: "#64748B",
    marginTop: 16,
  },
  shopBtn: {
    marginTop: 20,
    backgroundColor: Theme.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
  },
  shopBtnText: {
    color: "#fff",
    fontWeight: "bold",
    fontSize: 15,
  },
  cartItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 4,
    elevation: 1,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#0F172A",
  },
  itemMods: {
    fontSize: 12,
    color: "#64748B",
    marginTop: 4,
  },
  comboSelectionsContainer: {
    marginTop: 4,
    marginBottom: 4,
  },
  comboSelectionText: {
    fontSize: 12,
    color: "#64748B",
    lineHeight: 16,
  },
  itemPrice: {
    fontSize: 14,
    fontWeight: "600",
    color: Theme.primary,
    marginTop: 6,
  },
  qtyControls: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
    padding: 2,
  },
  qtyBtn: {
    padding: 8,
    backgroundColor: "#fff",
    borderRadius: 8,
  },
  qtyText: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#0F172A",
    marginHorizontal: 12,
  },
  footerContainer: {
    marginTop: 24,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 100,
  },
  modifierContainer: {
    marginTop: 6,
    marginBottom: 4,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  modifierTag: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: Theme.primary,
  },
  modifierBullet: {
    fontSize: 12,
    color: Theme.primary,
    marginRight: 4,
    fontWeight: "bold",
  },
  modifierName: {
    fontSize: 12,
    fontWeight: "700",
    color: "#0F172A",
  },
  modifierPrice: {
    fontSize: 11,
    fontWeight: "600",
    color: "#64748B",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#0F172A",
    marginBottom: 12,
    marginTop: 8,
  },
  notesInput: {
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 12,
    padding: 12,
    height: 80,
    color: "#0F172A",
    textAlignVertical: "top",
    fontSize: 14,
    marginBottom: 16,
  },
  billRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  billLabel: {
    color: "#64748B",
    fontSize: 14,
  },
  billValue: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "500",
  },
  totalRow: {
    borderTopWidth: 1,
    borderColor: "#F1F5F9",
    marginTop: 8,
    paddingTop: 12,
  },
  totalLabel: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "bold",
  },
  totalValue: {
    color: Theme.primary,
    fontSize: 18,
    fontWeight: "bold",
  },
  checkoutBar: {
    position: "absolute",
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: Theme.primary,
    borderRadius: 16,
    height: 56,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: Theme.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
    overflow: "hidden", // 🔑 CLIPS THE ROLL-OFF ANIMATION WITHIN BUTTON BOUNDS
  },
  orderBtn: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
  },
  orderBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  modalOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 9999,
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 32,
    width: "85%",
    maxWidth: 400,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
  iconContainer: {
    backgroundColor: "#E6F4EA",
    padding: 16,
    borderRadius: 50,
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 8,
    textAlign: "center",
  },
  modalSubtitle: {
    fontSize: 14,
    color: "#64748B",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 24,
  },
  modalButton: {
    backgroundColor: Theme.primary,
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 16,
    width: "100%",
    alignItems: "center",
    shadowColor: Theme.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  modalButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "bold",
  },
  btnTextContainer: {
    position: "absolute",
    alignSelf: "center",
  },
  loaderTextContainer: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  animatedItem: {
    position: "absolute",
    alignSelf: "center",
  },
  successContainer: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  progressBarOverlay: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(255, 255, 255, 0.18)", // Sleek white translucent progress overlay
  },
  speederOverlay: {
    flex: 1,
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 99999,
  },
  loaderCenterWrapper: {
    width: 160,
    height: 160,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 24,
  },
  loaderPlatter: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "rgba(249, 115, 22, 0.15)",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: Theme.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 8,
    borderWidth: 2,
    borderColor: "rgba(249, 115, 22, 0.4)",
  },
  loaderGlow: {
    position: "absolute",
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: "rgba(249, 115, 22, 0.08)",
  },
  loaderRing: {
    position: "absolute",
    width: 136,
    height: 136,
    borderRadius: 68,
    borderWidth: 2,
    borderColor: "rgba(249, 115, 22, 0.35)",
    borderStyle: "dashed",
    justifyContent: "center",
    alignItems: "center",
  },
  ringDot: {
    position: "absolute",
    top: -5,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Theme.primary,
    shadowColor: Theme.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
  },
  loaderTitleText: {
    fontFamily: Platform.OS === "ios" ? "Arial" : "sans-serif-medium",
    fontWeight: "800",
    fontSize: 22,
    color: "#FFFFFF",
    marginTop: 8,
    letterSpacing: 0.5,
    textAlign: "center",
  },
  loaderSubtitleText: {
    fontFamily: Platform.OS === "ios" ? "Arial" : "sans-serif",
    fontWeight: "400",
    fontSize: 14,
    color: "#94A3B8", // Muted slate gray
    marginTop: 10,
    textAlign: "center",
    paddingHorizontal: 32,
  },
});
