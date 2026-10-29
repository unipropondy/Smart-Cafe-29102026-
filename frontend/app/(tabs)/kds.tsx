import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  Modal,
  Pressable,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Fonts } from "../../constants/Fonts";
import { Theme } from "../../constants/theme";
import { OrderItem, useActiveOrdersStore } from "../../stores/activeOrdersStore";
import { useAuthStore } from "../../stores/authStore";
import { API_URL } from "../../constants/Config";
import { useGeneralSettingsStore } from "../../stores/generalSettingsStore";

const URGENCY_FRESH = 15;
const URGENCY_WARN = 30;

type UrgencyLevel = "fresh" | "warn" | "critical";

function getUrgency(minutes: number): UrgencyLevel {
  if (minutes < URGENCY_FRESH) return "fresh";
  if (minutes < URGENCY_WARN) return "warn";
  return "critical";
}

const formatSection = (sec: string) => {
  if (!sec) return "";
  if (sec === "TAKEAWAY") return "Takeaway";
  return sec.replace("_", "-").replace("SECTION", "Section");
};

const getTasteModifierText = (item: any) =>
  [
    item?.spicy && item.spicy !== "Medium" ? `Spicy: ${item.spicy}` : "",
    item?.salt && item.salt !== "Normal" ? `Salt: ${item.salt}` : "",
    item?.oil && item.oil !== "Normal" ? `Oil: ${item.oil}` : "",
    item?.sugar && item.sugar !== "Normal" ? `Sugar: ${item.sugar}` : "",
  ]
    .filter(Boolean)
    .join(" • ");

const URGENCY_UI: Record<UrgencyLevel, { primary: string; label: string; icon: keyof typeof Ionicons.glyphMap }> = {
  fresh: { primary: Theme.success, label: "ON TRACK", icon: "checkmark-circle-outline" },
  warn: { primary: Theme.warning, label: "RUNNING LONG", icon: "time-outline" },
  critical: { primary: Theme.danger, label: "OVERDUE", icon: "alert-circle-outline" },
};
// Per-card component so each card can track its own scroll state
const OrderCard = React.memo(function OrderCard({ item, cardHeight, pulseAnim, groups, now }: any) {
  const [hasMore, setHasMore] = useState(false);
  const contentH = useRef(0);
  const viewH = useRef(0);
  const enableKDSPrint = useGeneralSettingsStore((s: any) => s.settings.enableKDSPrint !== false);

  const getTs = (val: any) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    const d = new Date(val);
    const ts = d.getTime();
    return isNaN(ts) ? 0 : ts;
  };

  const itemTs = getTs(item.createdAt);
  const itemsMaxTs = (item.items && item.items.length > 0)
    ? Math.max(...item.items.map((i: any) => getTs(i.sentAt || item.createdAt)))
    : 0;
  const latestSent = itemsMaxTs || itemTs;
  const isValidTs = latestSent > 1000000;
  const rawElapsed = isValidTs ? Math.max(0, now - latestSent) : 0;
  // 🛡️ SANITY CAP: Maximum 12 hours (43,200,000ms) to prevent multi-day stale DB dates
  const elapsed = rawElapsed > 43200000 ? 0 : rawElapsed;
  const minutes = Math.floor(elapsed / 60000);
  const seconds = Math.floor((elapsed % 60000) / 1000);
  const urgency = getUrgency(minutes);
  const ui = URGENCY_UI[urgency];
  const timerOpacity = urgency === "critical" ? pulseAnim : 1;

  // 🚀 LIVE ITEM COUNTS — derived from pre-computed groups, zero extra API calls
  const { totalQty, totalUniqueDishes } = useMemo(() => {
    let qty = 0;
    let dishes = 0;
    Object.values(groups || {}).forEach((catItems: any) => {
      catItems.forEach((i: any) => {
        if (i.status !== 'VOIDED' && !String(i.note || '').toUpperCase().includes('VOID')) {
          qty += Number(i.qty) || 0;
          dishes++;
        }
      });
    });
    return { totalQty: qty, totalUniqueDishes: dishes };
  }, [groups]);

  const checkMore = () => {
    setHasMore(contentH.current > viewH.current + 5);
  };

  return (
    <Pressable
      style={[styles.cardContainer, { height: cardHeight }]}
      onPress={() => item.onPress?.(item)}
    >
      <View style={[styles.urgencyBar, { backgroundColor: ui.primary }]} />
      <View style={styles.cardHeader}>
        <View style={styles.headerRow}>
          <Text style={styles.tableInfo} numberOfLines={1}>
            {item.context.orderType === "DINE_IN"
              ? `${formatSection(item.context.section)} • Table ${item.context.tableNo}`
              : (() => {
                  const tbl = item.context.tableNo || item.context.takeawayNo || "";
                  const cleanTbl = String(tbl).trim();
                  const formattedTbl = cleanTbl.toUpperCase().startsWith("TW") ? cleanTbl.toUpperCase() : (cleanTbl ? `TW${cleanTbl}` : "TW");
                  const shortOrd = item.orderId ? `#${String(item.orderId).slice(-4)}` : "";
                  return `TW - ${formattedTbl} ${shortOrd}`.trim();
                })()}
          </Text>
          <Animated.Text style={[styles.timer, { color: ui.primary, opacity: timerOpacity }]}>
            {minutes}:{seconds.toString().padStart(2, "00")}
          </Animated.Text>
        </View>
        <View style={styles.headerRow}>
          <Text style={styles.orderIdText}>#{item.orderId}</Text>
          <View style={[styles.statusBadge, { borderColor: ui.primary + "40" }]}>
            <Ionicons name={ui.icon} size={10} color={ui.primary} />
            <Text style={[styles.statusBadgeText, { color: ui.primary }]}>{ui.label}</Text>
          </View>
        </View>
        
        {/* 🍽️ LIVE ITEM COUNT & ACTIONS ROW */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, flexWrap: 'wrap', gap: 6 }}>
          {/* Left Side: Badges */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={styles.itemCountBadge}>
              <Ionicons name="layers-outline" size={11} color={ui.primary} />
              <Text style={[styles.itemCountText, { color: ui.primary }]}>
                {totalQty} item{totalQty !== 1 ? 's' : ''}
              </Text>
            </View>
            <View style={styles.itemCountBadgeMuted}>
              <Ionicons name="restaurant-outline" size={11} color="#666" />
              <Text style={styles.itemCountMutedText}>
                {totalUniqueDishes} dish{totalUniqueDishes !== 1 ? 'es' : ''}
              </Text>
            </View>
          </View>

          {/* Right Side: PRINT & READY ALL */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {enableKDSPrint && (
              <Pressable
                style={({ pressed }) => [
                  styles.cardHeaderPrintBtn,
                  pressed && { opacity: 0.7 },
                  { marginRight: 0 }
                ]}
                onPress={(e) => {
                  e.stopPropagation();
                  item.onPrint?.(item);
                }}
              >
                <Ionicons name="print-outline" size={12} color="#FFF" />
                <Text style={styles.cardHeaderPrintBtnText}>PRINT</Text>
              </Pressable>
            )}
            {item.items?.some((i: any) => i.status === "SENT" || i.status === "NEW") && (
              <Pressable
                style={({ pressed }) => [
                  styles.cardHeaderReadyBtn,
                  pressed && { opacity: 0.7 },
                  { marginRight: 0 }
                ]}
                onPress={(e) => {
                  e.stopPropagation();
                  item.onMarkAllReady?.(item);
                }}
              >
                <Text style={styles.cardHeaderReadyBtnText}>READY ALL</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>

      <View style={styles.divider} />
      <View style={{ flex: 1 }}>
        <ScrollView
          style={[styles.itemsScroll, !cardHeight && { maxHeight: 400 }]}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={(_, h) => { contentH.current = h; checkMore(); }}
          onLayout={(e) => { viewH.current = e.nativeEvent.layout.height; checkMore(); }}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            setHasMore(contentOffset.y + layoutMeasurement.height < contentSize.height - 10);
          }}
          scrollEventThrottle={16}
        >
          {Object.entries(groups).map(([catName, items]: any) => (
            <View key={catName} style={styles.categorySection}>
              <Text style={styles.categoryHeader}>{catName}</Text>
              {items.map((i: any) => (
                <View
                  key={i.lineItemId}
                  style={[
                    styles.itemRow,
                    (now - (i.sentAt || item.createdAt) < 15000) && styles.itemFlash,
                    i.status === "READY" && styles.itemReadyFlash
                  ]}
                >
                  <View style={styles.qtyPill}>
                    <Text style={styles.itemQtyPrefix}>{i.qty}x</Text>
                  </View>

                  <View style={[styles.itemTextWrap, { marginLeft: 10 }]}>
                    <View style={styles.itemTitleRow}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, flexWrap: 'wrap' }}>
                        <Text 
                          style={[
                            styles.itemName, 
                            (i.status === "VOIDED" || String(i.note || "").toUpperCase().includes("VOID")) && styles.itemVoided
                          ]} 
                          numberOfLines={2}
                        >
                          {i.name}
                        </Text>
                        {(!!i.isTakeaway || !!i.IsTakeaway || !!i.isTakeAway || !!i.IsTakeAway) && (
                          <View style={styles.takeawayBadge}>
                            <Ionicons name="bag-handle" size={12} color="#FFF" />
                            <Text style={styles.takeawayBadgeText}>PARCEL / TW</Text>
                          </View>
                        )}
                      </View>
                      {(i.status === "VOIDED" || String(i.note || "").toUpperCase().includes("VOID") || i.status === "READY" || now - (i.sentAt || item.createdAt) < 150000) && (
                        <View style={[
                          styles.itemStatusBadge,
                          { backgroundColor: i.status === "READY" ? Theme.success : Theme.danger }
                        ]}>
                          <Text style={styles.itemStatusText}>
                            {(i.status === "VOIDED" || String(i.note || "").toUpperCase().includes("VOID")) ? "VOID" : i.status === "READY" ? "READY" : "NEW"}
                          </Text>
                        </View>
                      )}
                    </View>

                    {i.modifiers?.filter((mod: any) => {
                      const id = mod.ModifierId || mod.modifierId || mod.ModifierID || mod.modifierID;
                      const name = (mod.ModifierName || "").trim().toUpperCase();
                      const price = Number(mod.Price || mod.price || mod.Amount || mod.amount || 0);
                      if (price > 0) return true;
                      return id !== "00000000-0000-0000-0000-000000000001" && !name.startsWith("INSTR:");
                    }).map((mod: any, idx: number) => (
                      <Text key={idx} style={styles.modifierText}>• {mod.ModifierName}</Text>
                    ))}

                    {i.comboSelections && Array.isArray(i.comboSelections) && i.comboSelections
                      .filter((group: any) => group.items && group.items.length > 0)
                      .map((group: any, gIdx: number) => (
                        <View key={`g-${gIdx}`} style={{ marginTop: 2, paddingLeft: 4 }}>
                          <Text style={[styles.modifierText, { fontFamily: Fonts.bold, color: Theme.primary }]}>
                            {group.groupName}:
                          </Text>
                          {group.items?.map((opt: any, oIdx: number) => (
                            <Text key={`o-${oIdx}`} style={[styles.modifierText, { paddingLeft: 6 }]}>
                              ↳ {opt.name}
                            </Text>
                          ))}
                        </View>
                      ))}

                    {getTasteModifierText(i) ? (
                      <Text style={styles.modifierText}>{getTasteModifierText(i)}</Text>
                    ) : null}

                    {(i.note || i.Note || i.notes || i.Notes || i.remarks || i.Remarks) && (
                      <View style={styles.noteWrapper}>
                        <Ionicons name="pencil" size={10} color={Theme.primary} />
                        <Text style={styles.simpleNoteText}>{i.note || i.Note || i.notes || i.Notes || i.remarks || i.Remarks}</Text>
                      </View>
                    )}
                  </View>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>

        {hasMore && (
          <View style={styles.floatingMore} pointerEvents="none">
            <Ionicons name="chevron-down" size={16} color={Theme.primary} />
          </View>
        )}
      </View>
    </Pressable>
  );
}, (prev, next) => {
  // Also check total qty sum so badge updates when item quantities change
  const prevQty = prev.item.items.reduce((s: number, i: any) => s + (Number(i.qty) || 0), 0);
  const nextQty = next.item.items.reduce((s: number, i: any) => s + (Number(i.qty) || 0), 0);
  return (
    prev.item.orderId === next.item.orderId &&
    prevQty === nextQty &&
    prev.item.items.length === next.item.items.length &&
    prev.groups === next.groups &&
    Math.floor(prev.now / 1000) === Math.floor(next.now / 1000)
  );
});

export default function KDSScreen() {
  const { width, height } = useWindowDimensions();
  const router = useRouter();
  const activeOrders = useActiveOrdersStore((s) => s.activeOrders);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const isKDSUser = user?.userName?.toUpperCase() === "KDS";

  const flatListRef = useRef<FlatList>(null);
  const scrollOffset = useRef(0);
  const [time, setTime] = useState(Date.now());
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [kdsPrinterIp, setKdsPrinterIp] = useState("");
  const markItemReady = useActiveOrdersStore((s) => s.markItemReady);
 
  const pulseAnim = useRef(new Animated.Value(1)).current;
 
  useEffect(() => {
    const store = useActiveOrdersStore.getState();
    store.fetchActiveKitchenOrders();
    store.initializeSocketListeners();
    
    // Fetch KDS Printer IP configuration
    const fetchKdsPrinter = async () => {
      try {
        const res = await fetch(`${API_URL}/api/settings/kitchen-printers`);
        const printers = await res.json();
        if (Array.isArray(printers)) {
          const kds = printers.find((p: any) => p.PrinterType === 4);
          const ip = kds?.PrinterPath || kds?.PrinterIP;
          if (ip) {
            setKdsPrinterIp(ip.trim());
          }
        }
      } catch (e) {
        console.warn("Failed to fetch KDS printer IP on KDS screen:", e);
      }
    };
    fetchKdsPrinter();
     
    const interval = setInterval(() => setTime(Date.now()), 1000);
    // 🔄 Periodic refresh to ensure KDS never falls out of sync
    const pollInterval = setInterval(() => {
      useActiveOrdersStore.getState().fetchActiveKitchenOrders();
    }, 10000);

    return () => {
      clearInterval(interval);
      clearInterval(pollInterval);
    };
  }, []);

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.6, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  const kitchenOrders = useMemo(() => {
    // 1. Group items by Table/Section instead of raw OrderId to prevent "Two Column" issue
    const tableGroups: Record<string, any> = {};

    activeOrders.forEach((order) => {
      const { context } = order;
      const secStr = String(context.section || "").trim().toUpperCase().replace(/[- ]+/g, "_");
      const normSec = secStr.startsWith("SECTION") ? secStr.replace(/SECTION[-_ ]*/i, "SECTION_") : (secStr === "1" ? "SECTION_1" : secStr);
      const tblStr = String(context.tableNo || "").trim();
      const groupKey = context.orderType === "DINE_IN" 
        ? `TABLE_${normSec}_${tblStr}`
        : `TAKEAWAY_${context.takeawayNo}`;

      if (!tableGroups[groupKey]) {
        tableGroups[groupKey] = {
          ...order,
          groupKey,
          items: [],
          // Keep track of latest timestamp for sorting
          maxTs: 0
        };
      }

      // Add items that are not SERVED or are recently READY
      order.items.forEach((i: any) => {
        let shouldShow = false;
        // 🚀 SHOW SENT, NEW, HOLD or recently READY items (excluding VOIDED/SERVED)
        if (i.status === "SENT" || i.status === "NEW" || i.status === "HOLD") shouldShow = true;
        if (i.status === "READY") {
          shouldShow = !i.readyAt || (time - i.readyAt < 60000); // Stay for 60 seconds
        }

        if (shouldShow) {
          // 🚀 DEDUPLICATION & MERGE: Force into single card per table
          const existingIdx = tableGroups[groupKey].items.findIndex((ei: any) => ei.lineItemId === i.lineItemId);
          if (existingIdx > -1) {
            const existing = tableGroups[groupKey].items[existingIdx];
            // 🛡️ SYNC SHIELD: Keep the most informative metadata
            tableGroups[groupKey].items[existingIdx] = { 
              ...existing,
              ...i,
              note: i.note || existing.note || i.remarks || "",
              isTakeaway: i.isTakeaway ?? existing.isTakeaway,
              parentOrderId: order.orderId 
            };
          } else {
            tableGroups[groupKey].items.push({ ...i, parentOrderId: order.orderId });
          }

          const itemTs = i.sentAt || order.createdAt || 0;
          if (itemTs > tableGroups[groupKey].maxTs) {
            tableGroups[groupKey].maxTs = itemTs;
          }
        }
      });
    });

    // 2. Pre-calculate "Kitchen Groups" (Categories) here to ensure stable references for memoization
    return Object.values(tableGroups)
      .filter(group => group.items.length > 0)
      .map(group => {
        const itemGroups: Record<string, OrderItem[]> = {};
        group.items.forEach((i: any) => {
          if (i.status === "VOIDED") return; // ✂️ Skip voided/cancelled items — don't show on KDS
          const cat = (i.KitchenTypeName || i.kitchenTypeName || i.dishGroupName || i.categoryName || "KITCHEN").toUpperCase();
          if (!itemGroups[cat]) itemGroups[cat] = [];
          itemGroups[cat].push(i);
        });

        return {
          ...group,
          itemGroups // 🚀 Stable reference for OrderCard
        };
      })
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }, [activeOrders, time]);

  const selectedOrder = useMemo(() => {
    return kitchenOrders.find((o: any) => o.orderId === selectedOrderId);
  }, [kitchenOrders, selectedOrderId]);

  const isWeb = Platform.OS === "web";
  const numColumns = width > 900 ? 3 : width > 600 ? 2 : 1;
  // Use fixed height only for multi-column grid; let mobile cards be dynamic
  const cardHeight = numColumns > 1 ? height * 0.55 : undefined;

  const stats = useMemo(() => {
    let fresh = 0, warn = 0, critical = 0;
    kitchenOrders.forEach((order: any) => {
      const getSafeTs = (v: any) => {
        if (!v) return 0;
        const d = new Date(v);
        const ts = d.getTime();
        return isNaN(ts) ? 0 : (ts > 1577836800000 ? ts : 0);
      };
      
      const itemTs = getSafeTs(order.createdAt);
      const itemsMaxTs = order.items && order.items.length > 0 
        ? Math.max(...order.items.map((i: any) => getSafeTs(i.sentAt || order.createdAt)))
        : 0;
      
      const latestSent = itemsMaxTs || itemTs || time;
      const mins = Math.floor(Math.max(0, time - latestSent) / 60000);
      const u = getUrgency(mins);
      if (u === "fresh") fresh++;
      else if (u === "warn") warn++;
      else critical++;
    });
    return { fresh, warn, critical, total: kitchenOrders.length };
  }, [kitchenOrders, time]);

  const scrollStep = (dir: "up" | "down") => {
    const step = height * 0.7;
    const next = dir === "down" ? scrollOffset.current + step : scrollOffset.current - step;
    const clamped = Math.max(0, next);
    flatListRef.current?.scrollToOffset({ offset: clamped, animated: true });
    scrollOffset.current = clamped;
  };

  const handleScroll = (e: any) => {
    scrollOffset.current = e.nativeEvent.contentOffset.y;
  };

  const handleMarkAllReady = async (order: any) => {
    if (!order?.items) return;
    const pendingItems = order.items.filter((i: any) => i.status === "SENT" || i.status === "NEW");
    for (const item of pendingItems) {
      const targetOrderId = item.parentOrderId || order.orderId;
      await markItemReady(targetOrderId, item.lineItemId);
    }
  };

  const handlePrintOrder = async (order: any) => {
    try {
      const isQuick = !!(order.context?.isQuickServe || order.context?.isQuick || order.context?.isQuickServeMode || order.isQuickServe);
      const effectiveTable = order.context?.orderType === "DINE_IN"
        ? order.context?.tableNo
        : (order.context?.takeawayNo && String(order.context?.takeawayNo) !== "undefined" ? `TW-${order.context.takeawayNo}` : "Takeaway");
      const orderData = {
        orderId: order.orderId,
        orderNo: order.orderId,
        orderType: order.context?.orderType,
        takeawayNo: order.context?.takeawayNo,
        tableNo: effectiveTable,
        deviceNo: "1",
        waiterName: user?.userName || "Staff",
        isQuickServe: false,
        items: order.items,
        kitchenName: "KDS"
      };

      const { default: UniversalPrinter } = await import("../../components/UniversalPrinter");
      await UniversalPrinter.printKDSOrder(orderData, undefined, kdsPrinterIp);
    } catch (err) {
      console.error("Print order error from KDS card:", err);
    }
  };

  const renderOrder = ({ item }: any) => {
    return (
      <OrderCard
        item={{
          ...item,
          onPress: (o: any) => setSelectedOrderId(o.orderId),
          onMarkAllReady: handleMarkAllReady,
          onPrint: handlePrintOrder,
        }}
        cardHeight={cardHeight}
        pulseAnim={pulseAnim}
        groups={item.itemGroups}
        now={time}
      />
    );
  };

  const handleMarkReady = (lineItemId: string) => {
    if (!selectedOrder) return;
    const item = selectedOrder.items.find((i: any) => i.lineItemId === lineItemId);
    const targetOrderId = item?.parentOrderId || selectedOrder.orderId;
    markItemReady(targetOrderId, lineItemId);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF" />
      <View style={styles.container}>

        {/* ITEM SELECTION MODAL */}
        <Modal
          visible={!!selectedOrderId}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedOrderId(null)}
        >
          <BlurView intensity={20} tint="dark" style={styles.modalOverlay}>
            <Pressable style={styles.modalBackdrop} onPress={() => setSelectedOrderId(null)} />
            <View style={[styles.modalContent, { maxHeight: height * 0.85 }]}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>
                    {selectedOrder?.context.orderType === "DINE_IN"
                      ? `Table ${selectedOrder.context.tableNo}`
                      : (() => {
                          const tbl = selectedOrder?.context.tableNo || selectedOrder?.context.takeawayNo || "";
                          const cleanTbl = String(tbl).trim();
                          const formattedTbl = cleanTbl.toUpperCase().startsWith("TW") ? cleanTbl.toUpperCase() : (cleanTbl ? `TW${cleanTbl}` : "TW");
                          const shortOrd = selectedOrder?.orderId ? `#${String(selectedOrder.orderId).slice(-4)}` : "";
                          return `TW - ${formattedTbl} ${shortOrd}`.trim();
                        })()}
                  </Text>
                  <Text style={styles.modalOrderId}>Order #{selectedOrder?.orderId}</Text>
                </View>
                <Pressable onPress={() => setSelectedOrderId(null)} style={styles.modalCloseBtn}>
                  <Ionicons name="close" size={24} color={Theme.danger} />
                </Pressable>
              </View>
              <View style={styles.modalHeaderDivider} />

              <ScrollView style={styles.modalItemsList} contentContainerStyle={{ paddingBottom: 10 }}>
                {selectedOrder?.items.map((i: any) => {
                  const isReady = i.status === "READY";
                  return (
                    <View key={i.lineItemId} style={[styles.modalItemRow, isReady && styles.modalItemReady]}>
                      <View style={styles.modalItemInfo}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Text style={styles.modalItemQty}>{i.qty}x</Text>
                          <Text style={[styles.modalItemName, (i.status === "VOIDED" || String(i.note || "").toUpperCase().includes("VOID")) && styles.itemVoided]}>{i.name}</Text>
                          {(!!i.isTakeaway || !!i.IsTakeaway || !!i.isTakeAway || !!i.IsTakeAway) && (
                            <View style={styles.takeawayBadge}>
                              <Ionicons name="bag-handle" size={12} color="#FFF" />
                              <Text style={styles.takeawayBadgeText}>PARCEL / TW</Text>
                            </View>
                          )}
                        </View>
                        {i.modifiers?.filter((m: any) => {
                          const id = m.ModifierId || m.modifierId || m.ModifierID || m.modifierID;
                          const name = (m.ModifierName || "").trim().toUpperCase();
                          const price = Number(m.Price || m.price || m.Amount || m.amount || 0);
                          if (price > 0) return true;
                          return id !== "00000000-0000-0000-0000-000000000001" && !name.startsWith("INSTR:");
                        }).map((m: any, idx: number) => (
                          <Text key={idx} style={styles.modalModifierText}>• {m.ModifierName}</Text>
                        ))}
                        {getTasteModifierText(i) ? (
                          <Text style={styles.modalModifierText}>{getTasteModifierText(i)}</Text>
                        ) : null}
                        {(i.note || i.notes) ? (
                          <Text style={styles.modalModifierText}>Note: {i.note || i.notes}</Text>
                        ) : null}
                      </View>

                      {i.status !== "VOIDED" && (
                        <Pressable
                          style={[styles.readyBtn, isReady && styles.readyBtnActive]}
                          onPress={() => !isReady && handleMarkReady(i.lineItemId)}
                        >
                          <Ionicons
                            name={isReady ? "checkmark-circle" : "restaurant-outline"}
                            size={18}
                            color="#FFF"
                          />
                          <Text style={styles.readyBtnText}>{isReady ? "READY" : "MARK READY"}</Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })}
              </ScrollView>

              <View style={{ flexDirection: "row", gap: 12, marginTop: 20 }}>
                {selectedOrder?.items?.some((i: any) => i.status === "SENT" || i.status === "NEW") && (
                  <Pressable
                    style={[styles.modalDoneBtn, { flex: 1, backgroundColor: Theme.success + "15", marginTop: 0 }]}
                    onPress={async () => {
                      if (selectedOrder) {
                        await handleMarkAllReady(selectedOrder);
                        setSelectedOrderId(null);
                      }
                    }}
                  >
                    <Text style={[styles.modalDoneText, { color: Theme.success }]}>Mark All Ready</Text>
                  </Pressable>
                )}
                <Pressable style={[styles.modalDoneBtn, { flex: 1, marginTop: 0 }]} onPress={() => setSelectedOrderId(null)}>
                  <Text style={styles.modalDoneText}>Done</Text>
                </Pressable>
              </View>
            </View>
          </BlurView>
        </Modal>

        {/* HEADER */}
        <View style={styles.topBar}>
          <View style={styles.headerLeftSection}>
            {!isKDSUser && (
              <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/category')} style={styles.backBtn}>
                <Ionicons name="arrow-back" size={22} color={Theme.textPrimary} />
              </Pressable>
            )}
            <View style={styles.logoAndTitle}>
              <Ionicons name="fast-food" size={30} color={Theme.primary} />
              <Text style={styles.screenTitle}>KDS</Text>
            </View>
          </View>

          <View style={styles.headerRightSection}>
            <Text style={styles.totalOrdersCount}>{stats.total} orders</Text>
            {kitchenOrders.some(order => order.items.some((i: any) => i.status === "SENT" || i.status === "NEW")) && (
              <TouchableOpacity
                onPress={async () => {
                  for (const order of kitchenOrders) {
                    await handleMarkAllReady(order);
                  }
                }}
                style={styles.globalReadyBtn}
              >
                <Ionicons name="checkmark-done-circle" size={20} color="#FFF" />
                <Text style={styles.globalReadyBtnText}>Mark All Ready</Text>
              </TouchableOpacity>
            )}
            {isKDSUser && (
              <TouchableOpacity
                onPress={() => {
                  logout();
                  router.replace("/(tabs)/category");
                }}
                style={styles.logoutBtn}
              >
                <Ionicons name="log-out-outline" size={20} color={Theme.danger} />
                <Text style={styles.logoutBtnText}>Logout</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* LEGEND BAR */}
        <View style={styles.legendBar}>
          <View style={styles.legendItem}>
            <View style={[styles.statChip, { borderColor: Theme.success + "50" }]}>
              <View style={[styles.statDot, { backgroundColor: Theme.success }]} />
              <Text style={styles.statChipText}>{stats.fresh}</Text>
            </View>
            <Text style={styles.legendText}>0–15m Fresh</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.statChip, { borderColor: Theme.warning + "50" }]}>
              <View style={[styles.statDot, { backgroundColor: Theme.warning }]} />
              <Text style={styles.statChipText}>{stats.warn}</Text>
            </View>
            <Text style={styles.legendText}>15–30m Running Long</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.statChip, { borderColor: Theme.danger + "50" }]}>
              <View style={[styles.statDot, { backgroundColor: Theme.danger }]} />
              <Text style={styles.statChipText}>{stats.critical}</Text>
            </View>
            <Text style={styles.legendText}>30m+ Overdue</Text>
          </View>
        </View>

        {/* GRID + SCROLL BTNS */}
        <View style={styles.gridRow}>
          <FlatList
            ref={flatListRef}
            data={kitchenOrders}
            renderItem={renderOrder}
            keyExtractor={(item: any) => item.orderId}
            numColumns={numColumns}
            key={numColumns}
            extraData={time}
            contentContainerStyle={styles.listContainer}
            columnWrapperStyle={numColumns > 1 ? styles.columnWrapper : undefined}
            showsVerticalScrollIndicator={false}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            initialNumToRender={6}
            maxToRenderPerBatch={6}
            windowSize={5}
            removeClippedSubviews={Platform.OS !== 'web'}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="checkmark-circle-outline" size={100} color={Theme.success + "40"} />
                <Text style={styles.emptyText}>All Clear!</Text>
                <Text style={styles.emptySub}>No pending kitchen orders</Text>
              </View>
            }
          />

          {/* SIDE SCROLL BUTTONS */}
          {isWeb && (
            <View style={styles.sideScrollArea}>
              <Pressable style={({ pressed }) => [styles.sideBtn, pressed && styles.sideBtnPressed]} onPress={() => scrollStep("up")}>
                <Ionicons name="chevron-up" size={24} color={Theme.textPrimary} />
              </Pressable>
              <Pressable style={({ pressed }) => [styles.sideBtn, pressed && styles.sideBtnPressed]} onPress={() => scrollStep("down")}>
                <Ionicons name="chevron-down" size={24} color={Theme.textPrimary} />
              </Pressable>
            </View>
          )}
        </View>

      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Theme.bgMain },
  container: { flex: 1 },

  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 25, paddingVertical: 8,
    backgroundColor: "#FFF", borderBottomWidth: 1, borderBottomColor: Theme.border,
    ...Theme.shadowSm,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: Theme.bgMuted, justifyContent: "center", alignItems: "center",
  },
  logoAndTitle: { flexDirection: "row", alignItems: "center", gap: 10 },
  screenTitle: { fontSize: 24, fontFamily: Fonts.black, color: Theme.textPrimary },
  totalOrdersCount: { fontSize: 14, fontFamily: Fonts.bold, color: Theme.textSecondary },

  legendBar: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: 15, paddingVertical: 8,
    backgroundColor: Theme.bgMuted,
    borderBottomWidth: 1, borderBottomColor: Theme.border,
    flexWrap: 'wrap',
    gap: 10,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendText: { fontSize: 12, fontFamily: Fonts.bold, color: Theme.textSecondary },
  statChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#FFF", borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1,
  },
  statDot: { width: 9, height: 9, borderRadius: 5 },
  statChipText: { fontSize: 15, fontFamily: Fonts.black, color: Theme.textPrimary },

  headerLeftSection: { flexDirection: "row", alignItems: "center", gap: 15 },
  headerRightSection: { flexDirection: "row", alignItems: "center", gap: 20 },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Theme.danger + "10",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.danger + "30",
  },
  logoutBtnText: {
    color: Theme.danger,
    fontFamily: Fonts.bold,
    fontSize: 13,
  },

  gridRow: { flex: 1, flexDirection: "row", backgroundColor: Theme.bgMain },

  listContainer: { padding: 20, paddingBottom: 100 },
  columnWrapper: { gap: 20 },

  cardContainer: {
    flex: 1, backgroundColor: Theme.bgCard, borderRadius: 24, overflow: "hidden",
    borderWidth: 1, borderColor: Theme.border, marginBottom: 20, ...Theme.shadowMd,
    minHeight: 250, minWidth: 280,
  },
  urgencyBar: { height: 6, width: "100%" },
  cardHeader: { padding: 18, paddingBottom: 12 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4, gap: 10 },
  tableInfo: { fontSize: 18, fontFamily: Fonts.extraBold, color: Theme.textPrimary, flex: 1, lineHeight: 22 },
  timer: { fontSize: 18, fontFamily: Fonts.extraBold },
  orderIdText: { fontSize: 12, fontFamily: Fonts.bold, color: Theme.textMuted },
  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  statusBadgeText: { fontSize: 9, fontFamily: Fonts.black },
  divider: { height: 1, backgroundColor: Theme.border, marginHorizontal: 15 },

  // Item count badges
  itemCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    flexWrap: 'wrap',
  },
  itemCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: Theme.primary + '12',
    borderWidth: 1,
    borderColor: Theme.primary + '30',
  },
  itemCountText: {
    fontSize: 11,
    fontFamily: Fonts.black,
    letterSpacing: 0.3,
  },
  itemCountBadgeMuted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: '#F0F0F0',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  itemCountMutedText: {
    fontSize: 11,
    fontFamily: Fonts.black,
    color: '#666',
    letterSpacing: 0.3,
  },

  itemsScroll: { flex: 1, paddingHorizontal: 15 },
  categorySection: { marginTop: 6 },
  categoryHeader: { fontSize: 10, fontFamily: Fonts.black, color: Theme.primary, marginBottom: 2, letterSpacing: 1 },
  itemRow: { flexDirection: "row", marginBottom: 8, paddingVertical: 4, alignItems: 'center' },
  itemFlash: { backgroundColor: Theme.success + "12", borderRadius: 10, marginHorizontal: -6, paddingHorizontal: 6 },
  itemReadyFlash: { backgroundColor: Theme.success + "30", borderRadius: 10, marginHorizontal: -6, paddingHorizontal: 6 },
  itemTextWrap: { flex: 1 },
  itemTitleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  itemStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  itemStatusText: { color: "#FFF", fontSize: 10, fontFamily: Fonts.black },
  itemName: { fontSize: 17, fontFamily: Fonts.extraBold, color: Theme.textPrimary, lineHeight: 22 },
  itemVoided: { color: Theme.danger, textDecorationLine: "line-through", opacity: 0.6 },
  modifierText: { fontSize: 14, fontFamily: Fonts.medium, color: Theme.textSecondary, marginTop: 2, marginLeft: 4 },

  noteWrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
    paddingLeft: 4,
  },
  simpleNoteText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.primary,
    fontStyle: "italic",
    flex: 1,
  },

  itemQtyPrefix: { fontSize: 16, fontFamily: Fonts.black, color: Theme.primary },
  qtyPill: { backgroundColor: Theme.primary + "12", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, justifyContent: "center", alignItems: "center" },

  emptyContainer: { flex: 1, justifyContent: "center", alignItems: "center", marginTop: 150, gap: 20 },
  emptyText: { fontSize: 32, fontFamily: Fonts.black, color: Theme.textPrimary },
  emptySub: { fontSize: 16, fontFamily: Fonts.bold, color: Theme.textMuted },

  sideScrollArea: {
    width: 50,
    backgroundColor: Theme.bgCard,
    borderLeftWidth: 1,
    borderLeftColor: Theme.border,
    paddingVertical: 20,
    justifyContent: "center",
    alignItems: "center",
    gap: 20,
  },
  sideBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: Theme.bgMuted,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
  },
  sideBtnPressed: { backgroundColor: Theme.border },
  spacer: { flex: 1 },

  floatingMore: {
    position: "absolute",
    bottom: 5,
    alignSelf: "center",
    backgroundColor: "#FFF",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    ...Theme.shadowSm,
    borderWidth: 1,
    borderColor: Theme.border,
    zIndex: 10,
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 10,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  modalContent: {
    width: "100%",
    maxWidth: 600,
    backgroundColor: "#FFF",
    borderRadius: 24,
    padding: 20,
    ...Theme.shadowLg,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 28,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    lineHeight: 32,
  },
  modalOrderId: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    marginTop: 2,
  },
  modalHeaderDivider: {
    height: 1,
    backgroundColor: Theme.border + "80",
    marginBottom: 15,
  },
  modalCloseBtn: {
    padding: 5,
    backgroundColor: Theme.danger + "10",
    borderRadius: 12,
  },
  modalItemsList: {
    flexShrink: 1,
  },
  modalItemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border + "60",
  },
  modalItemReady: {
    backgroundColor: Theme.success + "08",
  },
  modalItemInfo: {
    flex: 1,
    marginRight: 10,
  },
  modalItemQty: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: Theme.primary,
  },
  modalItemName: {
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
    flexShrink: 1,
  },
  modalModifierText: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginLeft: 30,
  },
  readyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Theme.success,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    justifyContent: "center",
  },
  readyBtnActive: {
    backgroundColor: Theme.success,
  },
  readyBtnText: {
    color: "#FFF",
    fontSize: 14,
    fontFamily: Fonts.black,
  },
  modalDoneBtn: {
    backgroundColor: Theme.primary + "15",
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: "center",
    marginTop: 20,
  },
  modalDoneText: {
    color: Theme.primary,
    fontSize: 18,
    fontFamily: Fonts.black,
  },

  // Takeaway Styles
  takeawayBadge: {
    backgroundColor: Theme.danger,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  takeawayBadgeText: {
    color: "#FFF",
    fontSize: 10,
    fontFamily: Fonts.black,
  },
  cardHeaderReadyBtn: {
    backgroundColor: Theme.success,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 10,
    ...Theme.shadowSm,
  },
  cardHeaderReadyBtnText: {
    color: "#FFF",
    fontSize: 10,
    fontFamily: Fonts.black,
  },
  cardHeaderPrintBtn: {
    backgroundColor: Theme.primary,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    ...Theme.shadowSm,
  },
  cardHeaderPrintBtnText: {
    color: "#FFF",
    fontSize: 10,
    fontFamily: Fonts.black,
  },
  globalReadyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Theme.success,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    ...Theme.shadowSm,
  },
  globalReadyBtnText: {
    color: "#FFF",
    fontFamily: Fonts.bold,
    fontSize: 13,
  },
});
