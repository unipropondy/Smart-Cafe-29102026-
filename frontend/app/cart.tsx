import { useRouter } from "expo-router";
import React from "react";
import { View, ActivityIndicator } from "react-native";

/**
 * 🗄️ ARCHIVED CART COMPONENT
 * This page has been disabled in favor of the Professional Cart Sidebar.
 * The original code is preserved in comments below for future reference.
 * 
 * To restore this page, remove the redirect logic and uncomment the code below.
 */

export default function CartScreen() {
  const router = useRouter();

  React.useEffect(() => {
    // 🚀 Safety Redirect: Always send users back to the Category/Sidebar view
    // Since the Sidebar is the primary interface now, we don't want users 
    // getting confused by the old fullscreen cart.
    router.replace("/(tabs)/category");
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: "#1a1a1a", alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="large" color="#fbbf24" />
    </View>
  );
}

/* 
================================================================================
📜 ORIGINAL ARCHIVED CODE BELOW (Commented out for safety)
================================================================================

import { Ionicons, Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  SectionList,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Fonts } from "../constants/Fonts";
import { Theme } from "../constants/theme";
import { useToast } from "../components/Toast";
import UniversalPrinter from "../components/UniversalPrinter";

import { API_URL } from "../constants/Config";
import { useActiveOrdersStore, voidOrderItem } from "../stores/activeOrdersStore";
import { CartItem, useCartStore, isItemSent } from "../stores/cartStore";
import { useOrderContextStore } from "../stores/orderContextStore";
import { useTableStatusStore } from "../stores/tableStatusStore";
import { useAuthStore } from "@/stores/authStore";
import { holdOrder } from "../stores/heldOrdersStore";
import EditDishModal from "../components/EditDishModal";
import VoidItemModal from "../components/VoidItemModal";
import { socket } from "../constants/socket";
import { useCompanySettingsStore } from "../stores/companySettingsStore";

const EMPTY_ARRAY: any[] = [];

const CartItemCard = React.memo(
  ({
    item,
    onMinus,
    onPlus,
    onEdit,
    onVoid,
    index,
  }: {
    item: any;
    onMinus?: (id: string) => void;
    onPlus?: (id: string) => void;
    onEdit: (item: any) => void;
    onVoid?: (item: any) => void;
    index?: number;
  }) => {
    const isSent = isItemSent(item);
    const isVoided = item.status === "VOIDED";

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => onEdit(item)}
        style={[styles.cartItem, isVoided && styles.voidedItem]}
      >
        <View style={styles.itemTop}>
          <View style={styles.itemImageContainer}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Ionicons name="chevron-forward" size={14} color={Theme.textMuted} />
              <Text style={{ fontSize: 16, fontFamily: Fonts.black, color: Theme.textPrimary }}>
                {index !== undefined ? index + 1 : ""}
              </Text>
            </View>
          </View>

          <View style={styles.itemInfo}>
            <View style={styles.itemNameRow}>
              <Text style={[styles.itemName, isVoided && styles.voidedText]} numberOfLines={1}>
                {item.name}
              </Text>
              {isVoided && <View style={styles.voidTag}><Text style={styles.voidTagText}>VOID</Text></View>}
            </View>

            {(item.modifiers?.length > 0 || item.note || item.notes || item.isTakeaway) && (
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                {(item.modifiers?.length > 0 || item.note || item.notes) && (
                  <View style={styles.customizationPill}>
                    <Text style={styles.customText} numberOfLines={1}>
                      • {item.modifiers?.filter((m: any) => {
                        const id = m.ModifierId || m.modifierId || m.ModifierID || m.modifierID;
                        const name = (m.ModifierName || m.modifierName || "").trim().toUpperCase();
                        const price = Number(m.Price || m.price || m.Amount || m.amount || 0);
                        if (price > 0) return true;
                        return id !== "00000000-0000-0000-0000-000000000001" && !name.startsWith("INSTR:");
                      }).map((m: any) => m.ModifierName || m.modifierName).join(", ") || (item.note || item.notes)}
                    </Text>
                  </View>
                )}
                {item.isTakeaway && (
                  <View style={[styles.twBadge, { backgroundColor: Theme.danger + '15', borderColor: Theme.danger + '30' }]}>
                    <Text style={[styles.twBadgeText, { color: Theme.danger }]}>TW</Text>
                  </View>
                )}
              </View>
            )}

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
              {item.discount > 0 ? (
                <>
                  <Text style={[styles.itemPrice, { color: "#10b981" }, isVoided && styles.voidedText]}>
                    ${((item.price || 0) * item.qty * (1 - (item.discount || 0) / 100)).toFixed(2)}
                  </Text>
                  <View style={styles.discountBadge}>
                    <Text style={styles.discountBadgeText}>-{item.discount}%</Text>
                  </View>
                  <Text style={[styles.itemPrice, { fontSize: 13, textDecorationLine: 'line-through', color: Theme.textMuted }]}>
                    ${((item.price || 0) * item.qty).toFixed(2)}
                  </Text>
                </>
              ) : (
                <Text style={[styles.itemPrice, isVoided && styles.voidedText]}>
                  ${((item.price || 0) * item.qty).toFixed(2)}
                </Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.itemControls}>
          {isVoided ? (
            <View style={styles.sentStatusPill}>
              <Ionicons name="close-circle" size={14} color={Theme.danger} />
              <Text style={[styles.sentStatusText, { color: Theme.danger }]}>
                {item.qty}x VOIDED
              </Text>
            </View>
          ) : isSent ? (
            <View style={[styles.sentStatusPill, { backgroundColor: Theme.success + '10', borderColor: Theme.success + '30', borderWidth: 1 }]}>
              <Ionicons name="checkmark-circle" size={14} color={Theme.success} />
              <Text style={[styles.sentStatusText, { color: Theme.success, fontFamily: Fonts.black }]}>
                QTY: {item.qty} (SENT)
              </Text>
            </View>
          ) : (
            <View style={styles.quantityControls}>
              <TouchableOpacity onPress={(e) => { e.stopPropagation(); onMinus?.(item.lineItemId); }} style={styles.qtyBtn}>
                <Feather name="minus" size={16} color="#1a1a1a" />
              </TouchableOpacity>
              <Text style={styles.qtyDisplay}>{item.qty}</Text>
              <TouchableOpacity onPress={(e) => { e.stopPropagation(); onPlus?.(item.lineItemId); }} style={styles.qtyBtn}>
                <Feather name="plus" size={16} color="#1a1a1a" />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.actionButtons}>
            {isSent && !isVoided && (
              <TouchableOpacity onPress={(e) => { e.stopPropagation(); onVoid?.(item); }} style={styles.deleteBtnIcon}>
                <Feather name="trash-2" size={18} color={Theme.danger} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  }
);

export default function CartScreen() {
  const { width, height } = useWindowDimensions();
  const router = useRouter();
  const { showToast } = useToast();
  const { user, isWaiter } = useAuthStore();

  const isTablet = width > 768;
  const isDesktop = width > 1200;
  const isLandscape = width > height;

  const numColumns = useMemo(() => {
    if (isDesktop) return 4;
    if (isTablet) return isLandscape ? 3 : 2;
    if (isLandscape) return 2;
    return 1;
  }, [width, height, isTablet, isDesktop, isLandscape]);

  const horizontalPadding = 20; 
  const gap = 12;
  const itemWidth = useMemo(() => {
    if (numColumns === 1) return '100%';
    const totalGaps = (numColumns - 1) * gap;
    const totalPadding = horizontalPadding * 2;
    return (width - totalPadding - totalGaps) / numColumns;
  }, [width, numColumns]);

  const [showCancelModal, setShowCancelModal] = React.useState(false);
  const [cancelPassword, setCancelPassword] = React.useState("");
  const [voidQty, setVoidQty] = React.useState("1");
  const [editingItem, setEditingItem] = React.useState<CartItem | null>(null);

  const orderContext = useOrderContextStore((state: any) => state.currentOrder);

  const currentContextId = useCartStore((state: any) => state.currentContextId);
  const cart = useCartStore((state: any) => (currentContextId ? state.carts[currentContextId] : undefined) || EMPTY_ARRAY);
  const currentDiscount = useCartStore((state: any) => state.discounts[currentContextId || ""]);

  const removeFromCartGlobal = useCartStore((state: any) => state.removeFromCartGlobal);
  const addToCartGlobal = useCartStore((state: any) => state.addToCartGlobal);
  const clearCart = useCartStore((state: any) => state.clearCart);
  const pendingSync = useCartStore((state: any) => state.pendingSync);

  const settings = useCompanySettingsStore((state: any) => state.settings);
  const currencySymbol = settings?.currencySymbol || "$";
  const gstRate = (settings?.gstPercentage || 0) / 100;

  const activeOrders = useActiveOrdersStore((state: any) => state.activeOrders);
  const appendOrder = useActiveOrdersStore((state: any) => state.appendOrder);
  const markItemsSent = useActiveOrdersStore((state: any) => state.markItemsSent);
  const closeActiveOrder = useActiveOrdersStore((state: any) => state.closeActiveOrder);
  const voidOrderItem = useActiveOrdersStore((state: any) => state.voidOrderItem);

  const tables = useTableStatusStore((s: any) => s.tables);
  const updateTableStatus = useTableStatusStore((s: any) => s.updateTableStatus);

  const activeOrder = useMemo(() => {
    if (!orderContext) return undefined;
    return activeOrders.find((o: any) => {
      if (orderContext.orderType === "DINE_IN") {
        return o.context.orderType === "DINE_IN" && o.context.section === orderContext.section && o.context.tableNo === orderContext.tableNo;
      }
      return o.context.orderType === "TAKEAWAY" && o.context.takeawayNo === orderContext.takeawayNo;
    });
  }, [activeOrders, orderContext]);

  const displayItems = useMemo(() => {
    return cart
      .filter((i: any) => i.status !== "VOIDED" && i.StatusCode !== 0 && i.statusCode !== 0)
      .sort((a, b) => {
        const timeA = a.DateCreated ? new Date(a.DateCreated).getTime() : 0;
        const timeB = b.DateCreated ? new Date(b.DateCreated).getTime() : 0;
        if (timeA !== timeB && !isNaN(timeA) && !isNaN(timeB)) { return timeA - timeB; }
        return String(a.lineItemId).localeCompare(String(b.lineItemId));
      });
  }, [cart]);

  const globalIndexMap = useMemo(() => {
    const map = new Map();
    displayItems.forEach((item, index) => map.set(item.lineItemId, index));
    return map;
  }, [displayItems]);

  const sections = useMemo(() => {
    const newItems = displayItems.filter(i => !isItemSent(i));
    const sentItems = displayItems.filter(i => isItemSent(i));
    const chunk = (arr: any[], size: number) => {
      const chunks = [];
      for (let i = 0; i < arr.length; i += size) { chunks.push(arr.slice(i, i + size)); }
      return chunks;
    };
    const finalSections = [];
    if (sentItems.length > 0) finalSections.push({ title: 'SENT ITEMS', count: sentItems.reduce((acc, i) => acc + i.qty, 0), data: chunk(sentItems, numColumns) });
    if (newItems.length > 0) finalSections.push({ title: 'NEW ITEMS', count: newItems.reduce((acc, i) => acc + i.qty, 0), data: chunk(newItems, numColumns) });
    return finalSections;
  }, [displayItems, numColumns]);

  const unsentCount = useMemo(() => cart.filter((i: any) => !isItemSent(i)).length, [cart]);

  const { grossTotal, totalDiscount } = useMemo(() => {
    return displayItems.reduce(
      (acc, item) => {
        if (!item || item.status === "VOIDED") return acc;
        const baseTotal = (item.price || 0) * item.qty;
        return { grossTotal: acc.grossTotal + baseTotal, totalDiscount: acc.totalDiscount + (baseTotal * ((item.discount || 0) / 100)) };
      },
      { grossTotal: 0, totalDiscount: 0 },
    );
  }, [displayItems]);

  const subtotal = grossTotal - totalDiscount;
  const taxAmount = subtotal * gstRate;
  const payableAmount = subtotal + taxAmount;

  const currentTableData = useMemo(() => {
    if (orderContext?.orderType !== "DINE_IN") return undefined;
    return tables.find((t: any) => t.section === orderContext.section && t.tableNo === orderContext.tableNo);
  }, [orderContext, tables]);

  const currentTableStatus = useMemo(() => {
    if (!currentTableData) return "EMPTY";
    const s = currentTableData.status;
    if (typeof s === "number" || typeof (currentTableData as any).Status === "number") {
      const val = typeof s === "number" ? s : (currentTableData as any).Status;
      const statusMap: Record<number, string> = {
        0: "EMPTY", 1: "SENT", 2: "BILL_REQUESTED", 3: "HOLD", 4: "LOCKED", 5: "SENT"
      };
      return statusMap[val] || "EMPTY";
    }
    return s || "EMPTY";
  }, [currentTableData]);

  React.useEffect(() => {
    const tableId = orderContext?.tableId || currentTableData?.tableId;
    if (tableId) useCartStore.getState().fetchCartFromDB(tableId);
  }, [orderContext?.tableId, currentTableData?.tableId, currentContextId]);

  React.useEffect(() => {
    const tableId = orderContext?.tableId || currentTableData?.tableId;
    if (!tableId) return;
    const handleCartUpdate = (data: { tableId: string }) => {
      if (String(data.tableId) === String(tableId)) useCartStore.getState().fetchCartFromDB(tableId);
    };
    socket.on("cart_updated", handleCartUpdate);
    return () => { socket.off("cart_updated", handleCartUpdate); };
  }, [orderContext?.tableId, currentTableData?.tableId]);

  React.useEffect(() => {
    const tableId = orderContext?.tableId || currentTableData?.tableId;
    if (tableId) {
      fetch(`${API_URL}/api/tables/${tableId}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.table?.CurrentOrderId) {
            useCartStore.getState().setTableOrderId(tableId, data.table.CurrentOrderId);
          }
        })
        .catch(err => console.error("Cart ID sync error:", err));
    }
  }, [orderContext?.tableId, currentTableData?.tableId]);

  const currentTableOrderId = useCartStore((state: any) => orderContext?.tableId ? state.tableOrderIds[orderContext.tableId] : undefined);

  if (!orderContext) return <View style={styles.center}><Text style={styles.emptyText}>No Active Order Context</Text></View>;

  const [itemToVoid, setItemToVoid] = React.useState<any>(null);

  const handleCancelOrder = async () => {
    const verifyRes = await fetch(`${API_URL}/api/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: cancelPassword })
    });
    const verifyData = await verifyRes.json();
    if (!verifyData.success) {
      showToast({ type: "error", message: "Incorrect Password" });
      return;
    }

    setShowCancelModal(false);
    setCancelPassword("");

    if (itemToVoid && orderContext?.tableId) {
      try {
        const res = await fetch(`${API_URL}/api/orders/remove-item`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tableId: orderContext.tableId,
            itemId: itemToVoid.lineItemId,
            qtyToVoid: parseInt(voidQty) || itemToVoid.qty,
            userId: user?.userId
          })
        });

        if (res.ok) {
          if (activeOrder) voidOrderItem(activeOrder.orderId, itemToVoid.lineItemId);
          setTimeout(() => {
             useCartStore.getState().fetchCartFromDB(orderContext.tableId);
          }, 300);
          showToast({ type: "success", message: "Item Voided" });
        }
      } catch (err) {
        console.error("Void Error:", err);
        showToast({ type: "error", message: "Failed to void item" });
        useCartStore.getState().fetchCartFromDB(orderContext.tableId);
      }
    } else {
      if (activeOrder) closeActiveOrder(activeOrder.orderId);
      clearCart();
      router.replace("/(tabs)/category");
    }
    setVoidQty("1");
    setItemToVoid(null);
  };

  const handleHoldOrder = async () => {
    if (!orderContext || cart.length === 0) return;
    const targetOrderId = activeOrder?.orderId || "HOLD";
    const tableId = orderContext.tableId;
    if (tableId) {
      try {
        await fetch(`${API_URL}/api/orders/save-cart`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tableId, orderId: targetOrderId === "HOLD" ? null : targetOrderId, items: cart }) });
        const holdRes = await fetch(`${API_URL}/api/orders/hold`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tableId }) });
        const holdData = await holdRes.json();
        updateTableStatus(tableId, orderContext.section || "TAKEAWAY", orderContext.orderType === "DINE_IN" ? orderContext.tableNo! : orderContext.takeawayNo!, targetOrderId, "HOLD", holdData.StartTime, undefined, payableAmount);
      } catch (err) { console.error(err); }
    }
    holdOrder(targetOrderId, cart, orderContext);
    showToast({ type: 'success', message: 'Order Held' });
    router.replace(`/(tabs)/category?section=${orderContext.section || "TAKEAWAY"}`);
  };

  const handlePlus = React.useCallback((lineItemId: string) => {
    const item = cart.find((i: any) => i.lineItemId === lineItemId);
    if (item) addToCartGlobal(item);
  }, [cart, addToCartGlobal]);

  const handleMinus = React.useCallback((lineItemId: string) => {
    const item = cart.find((i: any) => i.lineItemId === lineItemId);
    if (!item) return;
    if (item.qty > 1) {
      useCartStore.getState().updateCartItemQty(lineItemId, item.qty - 1);
    } else {
      removeFromCartGlobal(lineItemId);
    }
  }, [cart, removeFromCartGlobal]);

  const handleEdit = React.useCallback((item: any) => { setEditingItem(item); }, []);

  const handleVoidItem = React.useCallback((item: any) => {
    setCancelPassword("");
    setVoidQty(String(item.qty || 1));
    setItemToVoid(item);
    setShowCancelModal(true);
  }, []);

  const handleCheckout = async () => {
    if (!orderContext) return;
    if (orderContext.orderType === "DINE_IN") {
      const tableId = orderContext.tableId || currentTableData?.tableId || currentTableData?.TableId;
      if (!tableId) {
        showToast({ type: "error", message: "Error", subtitle: "Table ID not found." });
        return;
      }
      const currentOrderId = activeOrder?.orderId || currentTableOrderId || "PAYMENT";
      (async () => {
        const printData = {
          id: currentOrderId,
          invoiceNumber: currentOrderId,
          date: new Date(),
          items: cart.filter((i: any) => !i.isVoided),
          total: payableAmount,
          totalAmount: payableAmount,
          subTotal: grossTotal,
          taxAmount: taxAmount,
          discountAmount: totalDiscount,
          tableNo: orderContext.tableNo,
          section: orderContext.section,
          serverName: user?.userName || "Staff",
          paymentMethod: "CASH",
        };
        try { UniversalPrinter.printCheckoutBill(printData, user?.userId); } catch (e) {}
      })();

      useCartStore.getState().checkoutOrder(tableId);
      showToast({ type: "success", message: "Success", subtitle: "Order finalized & Printing...", duration: 800 });
      router.replace(`/(tabs)/category?section=${orderContext.section}`);
      return;
    } else {
      router.push("/summary");
    }
  };

  const sendOrder = async () => {
    const context = orderContext;
    if (!context || cart.length === 0) return;
    let targetOrderId = activeOrder?.orderId || currentTableOrderId;
    appendOrder(targetOrderId || "NEW", context, cart);
    markItemsSent(targetOrderId || "NEW");
    useCartStore.getState().markAllAsSent(true);

    if (context.orderType === "DINE_IN") {
      const tableId = context.tableId || currentTableData?.tableId;
      if (tableId) {
        try {
          const sendRes = await (await fetch(`${API_URL}/api/orders/send`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tableId, userId: user?.userId, items: cart.map((item: CartItem) => ({ ...item, status: (item.status === 'VOIDED') ? 'VOIDED' : 'SENT' })) })
          })).json();

          if (sendRes.success) {
            const officialOrderId = sendRes.orderId || sendRes.currentOrderId || sendRes.CurrentOrderId || targetOrderId;
            if (officialOrderId) {
              useCartStore.getState().setTableOrderId(tableId, officialOrderId);
              useActiveOrdersStore.getState().updateOrderId(targetOrderId || "NEW", officialOrderId);
              updateTableStatus(tableId, context.section!, context.tableNo!, officialOrderId, 'SENT', sendRes.StartTime || new Date().toISOString(), undefined, payableAmount);
              socket.emit("new_order", { orderId: officialOrderId, context, items: cart, createdAt: Date.now() });
              showToast({ type: "success", message: "Order Sent", subtitle: `Kitchen notified. Order #${officialOrderId}`, duration: 800 });
              router.replace(`/(tabs)/category?section=${context.section}`);
              try {
                const kitchenGroups: Record<string, any[]> = {};
                const expandedItems: any[] = [];
                cart.filter((i: any) => i.status !== 'VOIDED' && !i.isVoided).forEach((item: any) => {
                  expandedItems.push(item);
                  if (item.comboSelections && item.comboSelections.length > 0) {
                    item.comboSelections.forEach((g: any) => {
                      if (Array.isArray(g.items)) {
                        g.items.forEach((opt: any) => {
                          const optKitchenCode = opt.KitchenTypeCode || opt.kitchenCode || opt.kitchenTypeCode;
                          const parentKitchenCode = item.KitchenTypeCode || item.kitchenCode || item.kitchenTypeCode || "0";
                          if (optKitchenCode && optKitchenCode !== parentKitchenCode) {
                            expandedItems.push({
                              ...opt,
                              id: opt.dishId,
                              qty: item.quantity || item.qty || 1,
                              price: 0,
                              name: `${opt.name} (Combo - ${item.name})`,
                              KitchenTypeCode: optKitchenCode,
                              KitchenTypeName: opt.KitchenTypeName || opt.kitchenTypeName,
                              PrinterIP: opt.PrinterIP || opt.printerIp,
                            });
                          }
                        });
                      }
                    });
                  }
                });
                expandedItems.forEach((item: any) => {
                  const kCode = item.KitchenTypeCode || "0";
                  if (!kitchenGroups[kCode]) kitchenGroups[kCode] = [];
                  kitchenGroups[kCode].push(item);
                });
                for (const [kCode, items] of Object.entries(kitchenGroups)) {
                  const printerIp = items[0].PrinterIP;
                  const effectiveTable = context.orderType === "DINE_IN"
                    ? context.tableNo
                    : (context.takeawayNo && String(context.takeawayNo) !== "undefined" ? `TW-${context.takeawayNo}` : "Takeaway");
                  const kotData = {
                    orderId: officialOrderId,
                    orderNo: officialOrderId,
                    orderType: context.orderType,
                    takeawayNo: context.takeawayNo,
                    tableNo: effectiveTable,
                    deviceNo: "1",
                    waiterName: user?.userName || "Staff",
                    items: items,
                    kitchenName: items[0].KitchenTypeName || "KITCHEN"
                  };
                  const isAdditional = cart.some((i: any) => isItemSent(i));
                  await UniversalPrinter.printKOT(kotData, "SYSTEM", isAdditional ? "ADDITIONAL" : "NEW", printerIp);
                }

                // 🚀 KDS Auto-Print Copy
                const enableKDSPrint = useGeneralSettingsStore.getState().settings.enableKDSPrint !== false;
                if (enableKDSPrint) {
                  const effectiveTable = context.orderType === "DINE_IN"
                    ? context.tableNo
                    : (context.takeawayNo && String(context.takeawayNo) !== "undefined" ? `TW-${context.takeawayNo}` : "Takeaway");
                  const kdsData = {
                    orderId: officialOrderId,
                    orderNo: officialOrderId,
                    orderType: context.orderType,
                    takeawayNo: context.takeawayNo,
                    tableNo: effectiveTable,
                    deviceNo: "1",
                    waiterName: user?.userName || "Staff",
                    items: cart.filter((i: any) => i.status !== 'VOIDED' && !i.isVoided),
                    kitchenName: "KDS",
                  };
                  await UniversalPrinter.printKDSOrder(kdsData, "SYSTEM");
                }
              } catch (printErr) { console.error(printErr); }
            }
          }
        } catch (err) { console.error(err); }
      }
    }
    const sectionPath = context.section || "TAKEAWAY";
    router.replace(`/(tabs)/category?section=${sectionPath}`);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <View style={styles.container}>
        <LinearGradient colors={["#1a1a1a", "#2d2d2d"]} style={styles.header}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}><Ionicons name="chevron-back" size={22} color="#FFF" /></TouchableOpacity>
            <View>
              <Text style={styles.headerTitle}>{orderContext.orderType === "DINE_IN" ? `Table ${orderContext.tableNo}` : `Takeaway #${orderContext.takeawayNo}`}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.headerSub}>{orderContext.orderType === "DINE_IN" ? orderContext.section?.replace("_", "-") : "Standard Queue"}</Text>
                {orderContext.tableId && currentTableOrderId && <Text style={[styles.headerSub, { color: '#fbbf24' }]}>• ID: {currentTableOrderId}</Text>}
              </View>
            </View>
          </View>
        </LinearGradient>
        <SectionList
          sections={sections}
          keyExtractor={(item, index) => (item[0] as any)?.lineItemId || index.toString()}
          contentContainerStyle={styles.listContent}
          renderItem={({ item: rowItems }) => (
            <View style={styles.gridRow}>
              {rowItems.map((item: any) => (
                <View key={item.lineItemId} style={{ width: itemWidth }}>
                  <CartItemCard item={item} index={globalIndexMap.get(item.lineItemId)} onPlus={handlePlus} onMinus={handleMinus} onEdit={handleEdit} onVoid={handleVoidItem} />
                </View>
              ))}
            </View>
          )}
        />
        <View style={styles.footer}>
           <Text style={styles.totalValue}>{currencySymbol}{payableAmount.toFixed(2)}</Text>
           <TouchableOpacity onPress={handleCheckout} style={styles.sendBtn}><Text style={styles.btnText}>CHECKOUT</Text></TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#fdf8f3" },
  container: { flex: 1 },
  header: { padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  headerTitle: { fontSize: 22, fontFamily: Fonts.black, color: "#FFF" },
  headerSub: { fontSize: 13, fontFamily: Fonts.bold, color: "rgba(255,255,255,0.8)" },
  backBtn: { width: 42, height: 42, borderRadius: 12, backgroundColor: "rgba(255,255,255,0.12)", justifyContent: "center", alignItems: "center" },
  listContent: { padding: 10, paddingBottom: 200 },
  gridRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  footer: { backgroundColor: "#FFF", padding: 20, borderTopLeftRadius: 30, borderTopRightRadius: 30, ...Theme.shadowLg },
  totalValue: { fontSize: 32, fontFamily: Fonts.black, color: "#1a1a1a", textAlign: 'center' },
  sendBtn: { backgroundColor: "#f59e0b", padding: 16, borderRadius: 12, marginTop: 12, alignItems: 'center' },
  btnText: { fontSize: 18, fontFamily: Fonts.black, color: "#FFF" },
  cartItem: { backgroundColor: "#FFF", borderRadius: 16, padding: 12, borderWidth: 1, borderColor: "#f3f4f6" },
  voidedItem: { opacity: 0.6 },
  itemTop: { flexDirection: 'row', gap: 12 },
  itemImageContainer: { width: 60, height: 60, borderRadius: 12, backgroundColor: "#fff7ed", justifyContent: "center", alignItems: "center" },
  itemInfo: { flex: 1 },
  itemName: { fontSize: 15, fontFamily: Fonts.black, color: "#1a1a1a" },
  itemPrice: { fontSize: 18, fontFamily: Fonts.black, color: "#f59e0b" },
  itemControls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, marginTop: 8, borderTopWidth: 1, borderTopColor: "#f3f4f6" },
  quantityControls: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: "#f9fafb", padding: 4, borderRadius: 12 },
  qtyBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: "#FFF", justifyContent: "center", alignItems: "center" },
  qtyDisplay: { fontSize: 16, fontFamily: Fonts.black, color: "#1a1a1a" },
  sentStatusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#f0fdf4" },
  sentStatusText: { fontSize: 12, fontFamily: Fonts.bold, color: "#16a34a" },
  actionButtons: { flexDirection: 'row', gap: 8 },
  deleteBtnIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: "#fee2e2", justifyContent: "center", alignItems: "center" },
  emptyText: { fontSize: 16, color: Theme.textMuted, textAlign: 'center' },
});

*/
