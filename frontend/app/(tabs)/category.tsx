import CalendarPicker from "@/components/CalendarPicker";
import { FloorPlanTable } from "@/components/FloorPlanTable";
import { Skeleton } from "@/components/ui/Skeleton";
import { API_URL } from "@/constants/Config";
import { Fonts } from "@/constants/Fonts";
import { socket } from "@/constants/socket";
import { Theme } from "@/constants/theme";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  useWindowDimensions,
  View
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useToast } from "../../components/Toast";
import WindowControls from "../../components/WindowControls";
import {
  formatToSingaporeTime,
  getSingaporeDateString,
  parseDatabaseDate,
} from "../../utils/timezoneHelper";

import AvatarPickerModal from "@/components/AvatarPickerModal";
import StoreSettingsModal from "@/components/payment/StoreSettingsModal";
import { getAvatarSource } from "@/constants/avatars";
import { useActiveOrdersStore } from "@/stores/activeOrdersStore";
import { useAuthStore } from "@/stores/authStore";
import {
  fetchCartFromDBGlobal,
  getContextId,
  setCartItemsGlobal,
  setCurrentContext,
  useCartStore,
} from "@/stores/cartStore";
import { useCompanySettingsStore } from "@/stores/companySettingsStore";
import { useGeneralSettingsStore } from "@/stores/generalSettingsStore";
import { getHeldOrders } from "@/stores/heldOrdersStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { clearOrderContext, OrderContext, setOrderContext, useOrderContextStore } from "@/stores/orderContextStore";
import { usePaymentSettingsStore } from "@/stores/paymentSettingsStore";
import { Image } from "expo-image";
import {
  TableStatusType,
  useTableStatusStore,
} from "../../stores/tableStatusStore";
import { useTerminalPaymentStore } from "../../stores/terminalPaymentStore";

const getSectionFromDiningSection = (ds: number) => {
  if (ds === 1) return "SECTION_1";
  if (ds === 2) return "SECTION_2";
  if (ds === 3) return "SECTION_3";
  return "TAKEAWAY";
};

const isTWTable = (t: any) => {
  if (!t) return false;
  const lbl = String(t.label || t.TableNumber || t.tableNo || "").trim().toUpperCase();
  return lbl.startsWith("TW");
};

const getSectionTables = (section: string, list: any[]) => {
  if (!Array.isArray(list)) return [];
  if (section === "TAKEAWAY") {
    return list.filter((t: any) => t.DiningSection === 4 || isTWTable(t));
  } else if (section === "SECTION_1") {
    return list.filter((t: any) => t.DiningSection === 1 && !isTWTable(t));
  } else if (section === "SECTION_2") {
    return list.filter((t: any) => t.DiningSection === 2 && !isTWTable(t));
  } else if (section === "SECTION_3") {
    return list.filter((t: any) => t.DiningSection === 3 && !isTWTable(t));
  }
  return [];
};

// --- MOBILE SOLID COLORS ---
const SOLID_LIGHT_GREEN = "#F0FDF4";

let lastTablesFetchTime = 0;
const SOLID_LIGHT_RED = "#FEF2F2";
const SOLID_LIGHT_BLUE = "#F0F9FF";
const SOLID_LIGHT_AMBER = "#FFFBEB";
const SOLID_LIGHT_VIOLET = "#F5F3FF";

const woodFloorTexture = require("../../assets/images/wood_floor_texture.jpg");

// --- CANVAS BACKGROUND COMPONENT ---
// --- CANVAS BACKGROUND COMPONENT ---
const CanvasBackground = ({ theme, children, style, isCategory = true }: { theme: string; children: React.ReactNode; style: any; isCategory?: boolean }) => {
  if (theme === "cloud_nine") {
    return (
      <View style={[{ backgroundColor: "#faf8f2", position: "relative", overflow: "hidden" }, style]}>
        {Platform.OS === "web" ? (
          <>
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "radial-gradient(ellipse 55% 45% at 30% 50%, rgba(253,186,116,0.6) 0%, transparent 60%)",
                mixBlendMode: "normal",
                filter: "blur(150px)",
                pointerEvents: "none",
                transform: "translateZ(0)",
              }}
              aria-hidden="true"
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "radial-gradient(ellipse 45% 55% at 65% 40%, rgba(251,146,60,0.45) 0%, transparent 55%)",
                mixBlendMode: "normal",
                filter: "blur(163px)",
                pointerEvents: "none",
                transform: "translateZ(0)",
              }}
              aria-hidden="true"
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "radial-gradient(ellipse 40% 35% at 50% 70%, rgba(254,215,170,0.5) 0%, transparent 50%)",
                mixBlendMode: "normal",
                filter: "blur(138px)",
                pointerEvents: "none",
                transform: "translateZ(0)",
              }}
              aria-hidden="true"
            />
          </>
        ) : (
          <>
            <LinearGradient
              colors={["rgba(253,186,116,0.6)", "rgba(251,146,60,0.45)", "transparent"]}
              locations={[0, 0.5, 1]}
              style={StyleSheet.absoluteFill}
            />
            <LinearGradient
              colors={["transparent", "rgba(254,215,170,0.5)", "transparent"]}
              locations={[0, 0.7, 1]}
              style={StyleSheet.absoluteFill}
            />
          </>
        )}
        <View style={{ flex: 1, zIndex: 1 }}>{children}</View>
      </View>
    );
  }

  if (theme === "champagne_glass") {
    return (
      <View style={[{ backgroundColor: "#faf8f2", position: "relative", overflow: "hidden" }, style]}>
        {Platform.OS === "web" ? (
          <>
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(135deg, rgba(255,251,235,0.95) 0%, rgba(254,243,199,0.62) 50%, rgba(253,230,138,0.34) 100%)",
                mixBlendMode: "normal",
                pointerEvents: "none",
                transform: "translateZ(0)",
              }}
              aria-hidden="true"
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "radial-gradient(ellipse 50% 45% at 32% 42%, rgba(251,191,36,0.26) 0%, transparent 68%)",
                mixBlendMode: "multiply",
                filter: "blur(125px)",
                pointerEvents: "none",
                transform: "translateZ(0)",
              }}
              aria-hidden="true"
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "radial-gradient(ellipse 42% 50% at 72% 60%, rgba(245,158,11,0.20) 0%, transparent 70%)",
                mixBlendMode: "multiply",
                filter: "blur(138px)",
                pointerEvents: "none",
                transform: "translateZ(0)",
              }}
              aria-hidden="true"
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(120deg, rgba(255,255,255,0.65), transparent 42%, rgba(255,255,255,0.30) 72%)",
                mixBlendMode: "multiply",
                filter: "blur(45px)",
                pointerEvents: "none",
                transform: "translateZ(0)",
              }}
              aria-hidden="true"
            />
          </>
        ) : (
          <>
            <LinearGradient
              colors={["rgba(255,251,235,0.95)", "rgba(254,243,199,0.62)", "rgba(253,230,138,0.34)"]}
              locations={[0, 0.5, 1.0]}
              style={StyleSheet.absoluteFill}
            />
            <LinearGradient
              colors={["rgba(251,191,36,0.26)", "transparent"]}
              locations={[0, 0.68]}
              style={StyleSheet.absoluteFill}
            />
            <LinearGradient
              colors={["transparent", "rgba(245,158,11,0.20)"]}
              locations={[0, 0.70]}
              style={StyleSheet.absoluteFill}
            />
          </>
        )}
        <View style={{ flex: 1, zIndex: 1 }}>{children}</View>
      </View>
    );
  }

  if (theme === "champagne") {
    return (
      <View style={[{ backgroundColor: "#faf8f2", position: "relative", overflow: "hidden" }, style]}>
        {Platform.OS === "web" ? (
          <>
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "linear-gradient(145deg, #fffbeb 0%, #fef3c7 38%, #fde68a 68%, #fcd34d 100%)",
                mixBlendMode: "normal",
                pointerEvents: "none",
                transform: "translateZ(0)",
              }}
              aria-hidden="true"
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "radial-gradient(ellipse 55% 40% at 55% 38%, rgba(255,255,255,0.42) 0%, transparent 65%)",
                mixBlendMode: "multiply",
                filter: "blur(80px)",
                pointerEvents: "none",
                transform: "translateZ(0)",
              }}
              aria-hidden="true"
            />
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                mixBlendMode: "overlay",
                opacity: 0.85,
                pointerEvents: "none",
              }}
            >
              <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
                <filter id="grain">
                  <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="4" stitchTiles="stitch" />
                  <feColorMatrix
                    type="matrix"
                    values="0.181 0.608 0.061 0 0.075
                          0.181 0.608 0.061 0 0.075
                          0.181 0.608 0.061 0 0.075
                          0     0     0     1 0"
                  />
                </filter>
                <rect width="100%" height="100%" filter="url(#grain)" />
              </svg>
            </div>
          </>
        ) : (
          <>
            <LinearGradient
              colors={["#fffbeb", "#fef3c7", "#fde68a", "#fcd34d"]}
              locations={[0, 0.38, 0.68, 1.0]}
              style={StyleSheet.absoluteFill}
            />
            <LinearGradient
              colors={["rgba(255,255,255,0.42)", "transparent"]}
              locations={[0, 0.65]}
              style={StyleSheet.absoluteFill}
            />
          </>
        )}
        <View style={{ flex: 1, zIndex: 1 }}>{children}</View>
      </View>
    );
  }

  if (theme === "citrine") {
    return (
      <View style={[{ backgroundColor: "#faf8f2", position: "relative", overflow: "hidden" }, style]}>
        {Platform.OS === "web" ? (
          <>
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "radial-gradient(circle at 22% 28%, rgba(250,204,21,0.6) 0%, transparent 45%)",
                mixBlendMode: "normal",
                filter: "blur(175px)",
                pointerEvents: "none",
                transform: "translateZ(0)",
              }}
              aria-hidden="true"
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "radial-gradient(circle at 78% 32%, rgba(253,224,71,0.5) 0%, transparent 40%)",
                mixBlendMode: "normal",
                filter: "blur(200px)",
                pointerEvents: "none",
                transform: "translateZ(0)",
              }}
              aria-hidden="true"
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "radial-gradient(circle at 50% 78%, rgba(234,179,8,0.4) 0%, transparent 50%)",
                mixBlendMode: "normal",
                filter: "blur(200px)",
                pointerEvents: "none",
                transform: "translateZ(0)",
              }}
              aria-hidden="true"
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "radial-gradient(circle at 85% 75%, rgba(202,138,4,0.3) 0%, transparent 35%)",
                mixBlendMode: "multiply",
                filter: "blur(138px)",
                pointerEvents: "none",
                transform: "translateZ(0)",
              }}
              aria-hidden="true"
            />
          </>
        ) : (
          <>
            <LinearGradient
              colors={["rgba(250,204,21,0.4)", "rgba(253,224,71,0.3)", "transparent"]}
              locations={[0, 0.4, 1]}
              style={StyleSheet.absoluteFill}
            />
            <LinearGradient
              colors={["transparent", "rgba(234,179,8,0.25)", "rgba(202,138,4,0.15)"]}
              locations={[0, 0.7, 1]}
              style={StyleSheet.absoluteFill}
            />
          </>
        )}
        <View style={{ flex: 1, zIndex: 1 }}>{children}</View>
      </View>
    );
  }

  // Default / champagne_fizz - Champagne Fizz
  return (
    <View style={[{ backgroundColor: "#faf8f2", position: "relative", overflow: "hidden" }, style]}>
      {/* Layer 1 - Champagne Fizz Aura */}
      <LinearGradient
        colors={[
          "transparent",
          "rgba(255, 230, 180, 0.12)",
          "rgba(255, 255, 255, 0.18)",
          "rgba(255, 200, 140, 0.68)",
          "rgba(230, 170, 100, 0.90)"
        ]}
        locations={[0, 0.28, 0.48, 0.68, 1.0]}
        style={[
          StyleSheet.absoluteFill,
          Platform.OS === "web" ? {
            mixBlendMode: "multiply",
            filter: "blur(90px)",
            transform: "translateZ(0)",
          } as any : {}
        ]}
      />
      {/* Layer 2 - Champagne Fizz Aura */}
      <LinearGradient
        colors={[
          "transparent",
          "rgba(255, 230, 180, 0.22)",
          "rgba(255, 255, 255, 0.66)",
          "rgba(255, 200, 140, 0.82)",
          "rgba(230, 170, 100, 1.0)"
        ]}
        locations={[0, 0.34, 0.66, 0.82, 1.0]}
        style={[
          StyleSheet.absoluteFill,
          Platform.OS === "web" ? {
            mixBlendMode: "multiply",
            filter: "blur(90px)",
            transform: "translateZ(0)",
          } as any : {}
        ]}
      />
      {/* Content wrapper */}
      <View style={{ flex: 1, zIndex: 1 }}>
        {children}
      </View>
    </View>
  );
};

const formatSectionGlobal = (sec: string) => {
  if (!sec) return "";
  if (sec === "TAKEAWAY" || sec === "Takeaway") return "Takeaway";
  // Convert SECTION_1 -> Section 1 or "Section-1" -> Section 1
  return sec.replace("_", " ").replace("-", " ").replace("SECTION", "Section");
};

const getStatusUI = (status: number, diningSection?: number) => {
  const s = Number(status);
  switch (s) {
    case 1:
      if (diningSection === 4) {
        return { text: "PREPARING", color: "#22c55e", lightBg: "#F0FDF4" };
      }
      return { text: "DINING", color: "#22c55e", lightBg: "#F0FDF4" };
    case 2:
      return { text: "CHECKOUT", color: "#F59E0B", lightBg: "#FFFBEB" };
    case 3:
      return { text: "HOLD", color: "#3b82f6", lightBg: "#F0F9FF" };
    case 4:
      return { text: "OVERTIME", color: "#8b5cf6", lightBg: "#F5F3FF" };
    case 5:
      return { text: "RESERVED", color: "#ef4444", lightBg: "#FEF2F2" };
    case 0:
    default:
      return { text: "AVAILABLE", color: "#C2A580", lightBg: "#FAF6F0" }; // Tan/Beige
  }
};

// --- APPROVED POS BRANDING COMPONENT (RESTAURANT BILLING SYSTEM) ---
interface POSBrandProps {
  onPress?: () => void;
  compact?: boolean;
  hideWordmark?: boolean;
}

const POSBrand: React.FC<POSBrandProps> = ({
  onPress,
  compact = false,
  hideWordmark = false,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);

  // Exact proportions matching the flat reference logo (media_1793016426703.png):
  // Icon: 192x180 px (~1.067 aspect ratio)
  // Wordmark: 574x179 px (~3.207 aspect ratio)
  const iconHeight = compact ? 30 : 36;
  const iconWidth = Math.round(iconHeight * (192 / 180));
  const dividerHeight = Math.round(iconHeight * (160 / 180));
  const dividerMargin = compact ? 8 : 10;
  const wordmarkHeight = compact ? 28 : 34;
  const wordmarkWidth = Math.round(wordmarkHeight * (574 / 179));

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setIsHovered(true)}
      onHoverOut={() => setIsHovered(false)}
      onPressIn={() => setIsPressed(true)}
      onPressOut={() => setIsPressed(false)}
      accessibilityLabel="POS - Restaurant Billing System"
      accessibilityRole="button"
      style={({ hovered, pressed }: any) => {
        const hover = isHovered || hovered;
        const press = isPressed || pressed;

        return [
          {
            flexDirection: "row",
            alignItems: "center",
            paddingVertical: 2,
            paddingRight: hideWordmark ? 0 : 4,
            cursor: onPress ? "pointer" : "default",
            opacity: press ? 0.88 : hover ? 0.94 : 1,
            transform: [{ scale: press ? 0.98 : hover ? 1.01 : 1 }],
            ...(Platform.OS === "web"
              ? {
                  transition: "opacity 0.15s ease, transform 0.15s ease",
                  userSelect: "none",
                }
              : {}),
          } as any,
        ];
      }}
    >
      {/* 1. Flat Solid Orange Rounded-Square Icon with White Receipt, Fork & Spoon */}
      <Image
        source={require("@/assets/images/pos_flat_icon.png")}
        style={{
          width: iconWidth,
          height: iconHeight,
        }}
        contentFit="contain"
      />

      {/* 2. Thin Light-Gray Vertical Divider & Flat Wordmark */}
      {!hideWordmark && (
        <>
          {/* Thin Light-Gray Vertical Divider */}
          <View
            style={{
              width: 1,
              height: dividerHeight,
              backgroundColor: "#CBD5E1",
              marginHorizontal: dividerMargin,
            }}
          />

          {/* Solid Orange POS + Dark Charcoal Restaurant Billing System */}
          <Image
            source={require("@/assets/images/pos_flat_wordmark.png")}
            style={{
              width: wordmarkWidth,
              height: wordmarkHeight,
            }}
            contentFit="contain"
          />
        </>
      )}
    </Pressable>
  );
};

// Backwards compatibility alias for QSButton
const QSButton: React.FC<{
  onPress: () => void;
  size?: number;
  disabled?: boolean;
}> = ({ onPress, size = 36 }) => (
  <POSBrand onPress={onPress} compact={size < 36} />
);

// --- ROTATING SYNC ICON COMPONENT ---
const RotatingSyncIcon = ({ size = 16, color = "#3b82f6" }: { size?: number; color?: string }) => {
  const spinValue = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    anim.start();
    return () => anim.stop();
  }, [spinValue]);

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <Animated.View style={{ transform: [{ rotate: spin }] }}>
      <Ionicons name="sync" size={size} color={color} />
    </Animated.View>
  );
};

// --- MEMOIZED TABLE COMPONENT ---
const TableItemComponent = React.memo(
  ({
    tableId,
    item,
    itemSize,
    activeTab,
    onPress,
    numberFont,
    smallFont,
    isTabletPortrait,
    isAbsoluteLayout,
    layoutScale = 1,
    backgroundTheme = "wood",
  }: {
    tableId: string;
    item: TableItem;
    itemSize: number;
    activeTab: string;
    onPress: (item: TableItem, tableData: any, isCheckout?: boolean) => void;
    numberFont: number;
    smallFont: number;
    isTabletPortrait?: boolean;
    isAbsoluteLayout?: boolean;
    layoutScale?: number;
    backgroundTheme?: string;
  }) => {
    // 🚀 O(1) Store Subscription: Only re-renders when THIS table changes
    const cleanId = String(tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
    const tableData = useTableStatusStore((state) =>
      state.tableMap[cleanId] ||
      state.tables.find(t => String(t.tableNo) === String(item.label) && t.section === getSectionFromDiningSection(item.DiningSection))
    );

    // Subscribe to terminal payment session — re-renders only when this table's session changes
    const terminalStatus = useTerminalPaymentStore(
      (state) => state.sessions[tableId]?.status
    );

    // 🚀 SYNC-FIRST: Prioritize real-time data from the global store
    const status = tableData
      ? tableData.status === "SENT"
        ? 1
        : tableData.status === "BILL_REQUESTED"
          ? 2
          : tableData.status === "HOLD"
            ? 3
            : tableData.status === "LOCKED"
              ? 5
              : 0
      : Number(item.Status);

    const billAmount =
      status === 0 || tableData?.status === "EMPTY"
        ? 0
        : (tableData?.totalAmount !== undefined
          ? tableData.totalAmount
          : Number(item.totalAmount) || 0);

    const rawStartTime =
      status === 0 || tableData?.status === "EMPTY"
        ? 0
        : (tableData?.startTime ||
          (item.StartTime
            ? typeof item.StartTime === "string"
              ? parseDatabaseDate(item.StartTime).getTime()
              : item.StartTime
            : 0));

    const isOvertime =
      status !== 0 &&
      (tableData?.isHoldOvertime ||
        Number(item.isOvertime) === 1 ||
        Number(item.isHoldOvertime) === 1);

    let ui = getStatusUI(status, item.DiningSection);

    // Dynamic Overtime: If occupied (Dining/Hold) and flagged as overtime, override UI
    if ((status === 1 || status === 3) && isOvertime) {
      ui = getStatusUI(4, item.DiningSection);
    }

    // 🌹 QR PAID: entryStatus='q' + paymentStatus=1 → Rose card + "Paid" label
    const rawEntryStatus =
      (tableData?.entryStatus !== undefined && tableData?.entryStatus !== null)
        ? tableData.entryStatus
        : item.entryStatus;
    const rawPaymentStatus =
      (tableData as any)?.paymentStatus !== undefined
        ? (tableData as any).paymentStatus
        : item.paymentStatus;
    const isPaid = rawEntryStatus === "q" && Number(rawPaymentStatus) === 1;

    if (isPaid) {
      ui = { text: "PAID", color: "#f43f5e", lightBg: "#fff1f2" };
    }

    let borderColor = status === 0 ? Theme.border : ui.color;
    let borderWidth = status !== 0 ? 2 : 1.5;

    if (terminalStatus === "processing") {
      borderColor = "#3b82f6";
      borderWidth = 3;
    } else if (terminalStatus === "failed" || terminalStatus === "cancelled") {
      borderColor = "#ef4444";
      borderWidth = 3;
    }

    const bgColor = status !== 0 ? ui.lightBg : Theme.bgCard;
    const textColor = status === 0 ? Theme.textPrimary : ui.color;
    let labelColor = Theme.textPrimary;


    let timeText = "";
    if (rawStartTime && status !== 0 && status !== 5) {
      timeText = formatToSingaporeTime(rawStartTime, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    }

    // Shape logic
    const tableType = item.TableType ? String(item.TableType).trim().toLowerCase() : "rectangular";
    const seatsCount = item.Seats !== undefined && item.Seats !== null ? Number(item.Seats) : 4;
    const xSize = item.XSize !== undefined && item.XSize !== null && Number(item.XSize) > 0 ? Number(item.XSize) : 100;
    const ySize = item.YSize !== undefined && item.YSize !== null && Number(item.YSize) > 0 ? Number(item.YSize) : 80;

    // Outer table size calculations (leaving space for chairs)
    const maxTableDim = itemSize - 28; // Padding on all sides for chairs
    const maxDimension = Math.max(xSize, ySize) || 100;

    let tableW = isAbsoluteLayout ? (xSize * 0.6) * layoutScale : Math.max(itemSize * 0.45, (xSize / maxDimension) * maxTableDim);
    let tableH = isAbsoluteLayout ? (ySize * 0.6) * layoutScale : Math.max(itemSize * 0.45, (ySize / maxDimension) * maxTableDim);

    let borderRadius = 8; // rectangular default
    if (tableType === "square") {
      const size = Math.max(tableW, tableH);
      tableW = size;
      tableH = size;
      borderRadius = 8;
    } else if (tableType === "round") {
      const size = Math.max(tableW, tableH);
      tableW = size;
      tableH = size;
      borderRadius = size / 2;
    } else if (tableType === "oval") {
      borderRadius = Math.min(tableW, tableH) / 2;
    } else if (tableType === "rectangular") {
      borderRadius = 8;
    } else {
      borderRadius = 12;
    }

    const tx = isAbsoluteLayout ? 0 : (itemSize - tableW) / 2;
    const ty = isAbsoluteLayout ? 0 : (itemSize - tableH) / 2;
    const cx = isAbsoluteLayout ? tableW / 2 : itemSize / 2;
    const cy = isAbsoluteLayout ? tableH / 2 : itemSize / 2;

    // Chair size — bigger base so they're clearly visible
    let chairSize = Math.max(16, itemSize * 0.13);
    if (seatsCount > 10) {
      chairSize = Math.max(10, chairSize * (10 / seatsCount) * 1.4);
    }

    const offset = 5; // gap between table edge and chair

    // Override AVAILABLE colors for premium beige look matching reference
    let activeColor = status === 0 ? "#D1C7BD" : ui.color;
    let activeBg = status === 0 ? "#FAF8F5" : ui.lightBg;

    if (backgroundTheme === "light") {
      if (status === 0) {
        activeColor = "#22C55E"; // Free -> clean emerald green
        activeBg = "#FFFFFF";
      } else if (isPaid) {
        activeColor = "#F43F5E";
        activeBg = "#FFFFFF";
      } else {
        const effectiveStatus = ((status === 1 || status === 3) && isOvertime) ? 4 : status;
        switch (effectiveStatus) {
          case 1: // Dining
            activeColor = "#22C55E";
            activeBg = "#FFFFFF";
            break;
          case 2: // Checkout
            activeColor = "#F59E0B";
            activeBg = "#FFFFFF";
            break;
          case 3: // Hold
            activeColor = "#3B82F6";
            activeBg = "#FFFFFF";
            break;
          case 4: // Overtime
            activeColor = "#8B5CF6";
            activeBg = "#FFFFFF";
            break;
          case 5: // Reserved
            activeColor = "#3B82F6";
            activeBg = "#FFFFFF";
            break;
        }
      }
    }

    // Label color mapping for high-readability text
    if (backgroundTheme === "light") {
      labelColor = "#000000";
    } else if (status === 0) {
      labelColor = "#000000";
    } else if (isPaid) {
      labelColor = "#9E1F4B";
    } else {
      switch (status) {
        case 1: labelColor = "#1B5E20"; break; // Dark green
        case 2: labelColor = "#B66000"; break; // Dark yellow/orange
        case 3: labelColor = "#0D47A1"; break; // Dark blue
        case 4:
        case 5: labelColor = "#B71C1C"; break; // Dark red
        default: labelColor = activeColor;
      }
    }

    // Chair styling (white background with matching color border, top-down chair backrest design!)
    const chairColor = status === 0 ? (backgroundTheme === "light" ? "#22C55E" : "#D1C7BD") : activeColor;
    const chairBg = "#FFFFFF";

    // Chair placement calculation
    const chairPositions: { x: number; y: number; rotate?: string; backrestStyle?: any }[] = [];
    if (seatsCount > 0) {
      if (tableType === "round" || tableType === "oval") {
        const rx = tableW / 2;
        const ry = tableH / 2;
        const radiusOffset = chairSize / 2 + offset;
        for (let i = 0; i < seatsCount; i++) {
          const angle = (i * 2 * Math.PI) / seatsCount - Math.PI / 2; // start from top
          const x = cx + (rx + radiusOffset) * Math.cos(angle) - chairSize / 2;
          const y = cy + (ry + radiusOffset) * Math.sin(angle) - chairSize / 2;

          // Rotation so backrest (top border) faces outwards
          const rotationAngle = angle + Math.PI / 2;
          chairPositions.push({
            x,
            y,
            rotate: `${rotationAngle}rad`,
            backrestStyle: { top: 0, left: 0, right: 0, height: 2.2, borderTopLeftRadius: 1.5, borderTopRightRadius: 1.5 }
          });
        }
      } else {
        // Rectangular / Square logic
        let topCount = 0;
        let bottomCount = 0;
        let leftCount = 0;
        let rightCount = 0;

        if (seatsCount === 2) {
          leftCount = 1;
          rightCount = 1;
        } else {
          const base = Math.floor(seatsCount / 4);
          const rem = seatsCount % 4;
          topCount = base + (rem > 0 ? 1 : 0);
          bottomCount = base + (rem > 1 ? 1 : 0);
          leftCount = base + (rem > 2 ? 1 : 0);
          rightCount = base;
        }

        // Top chairs — backrest faces UP (away from table), no rotation
        for (let i = 0; i < topCount; i++) {
          const x = tx + (i + 0.5) * (tableW / topCount) - chairSize / 2;
          const y = ty - chairSize - offset;
          chairPositions.push({ x, y });
        }
        // Bottom chairs — backrest faces DOWN (away from table)
        for (let i = 0; i < bottomCount; i++) {
          const x = tx + (i + 0.5) * (tableW / bottomCount) - chairSize / 2;
          const y = ty + tableH + offset;
          chairPositions.push({ x, y, rotate: '180deg' });
        }
        // Left chairs — backrest faces LEFT (away from table)
        for (let i = 0; i < leftCount; i++) {
          const x = tx - chairSize - offset;
          const y = ty + (i + 0.5) * (tableH / leftCount) - chairSize / 2;
          chairPositions.push({ x, y, rotate: '-90deg' });
        }
        // Right chairs — backrest faces RIGHT (away from table)
        for (let i = 0; i < rightCount; i++) {
          const x = tx + tableW + offset;
          const y = ty + (i + 0.5) * (tableH / rightCount) - chairSize / 2;
          chairPositions.push({ x, y, rotate: '90deg' });
        }
      }
    }

    // Dynamic color gradient for the table body
    let gradientColors: [string, string] = ["#FFFFFF", "#FFFFFF"];
    let tableBorderColor = activeColor;
    if (backgroundTheme === "light") {
      gradientColors = ["#FFFFFF", "#FFFFFF"];
      tableBorderColor = activeColor;
    } else if (status === 0) {
      gradientColors = ["#FAF8F5", "#F0EAE1"]; // Subtle blonde-wood / warm linen look
      tableBorderColor = "#D1C7BD";
    } else if (isPaid) {
      gradientColors = ["#FFF1F2", "#FFE4E6"];
      tableBorderColor = "#FDA4AF";
    } else {
      const effectiveStatus = ((status === 1 || status === 3) && isOvertime) ? 4 : status;
      switch (effectiveStatus) {
        case 1: // Dining (Subtle Green)
          gradientColors = ["#F0FDF4", "#DCFCE7"];
          tableBorderColor = "#22c55e";
          break;
        case 2: // Checkout (Subtle Yellow/Amber)
          gradientColors = ["#FFFBEB", "#FEF3C7"];
          tableBorderColor = "#F59E0B";
          break;
        case 3: // Hold (Subtle Blue)
          gradientColors = ["#F0F9FF", "#E0F2FE"];
          tableBorderColor = "#3b82f6";
          break;
        case 4: // Overtime (Subtle Purple)
          gradientColors = ["#F5F3FF", "#EDE9FE"];
          tableBorderColor = "#8b5cf6";
          break;
        case 5: // Reserved (Subtle Red)
          gradientColors = ["#FEF2F2", "#FEE2E2"];
          tableBorderColor = "#ef4444";
          break;
      }
    }

    // Placings/plates coordinates inside table body
    const platePositions: { x: number; y: number }[] = [];
    if (seatsCount > 0) {
      if (tableType === "round" || tableType === "oval") {
        const plateRadiusOffset = Math.max(6, (tableW / 2) - 8);
        for (let i = 0; i < seatsCount; i++) {
          const angle = (i * 2 * Math.PI) / seatsCount - Math.PI / 2;
          const px = tableW / 2 + plateRadiusOffset * Math.cos(angle);
          const py = tableH / 2 + plateRadiusOffset * Math.sin(angle);
          platePositions.push({ x: px, y: py });
        }
      } else {
        let topCount = 0;
        let bottomCount = 0;
        let leftCount = 0;
        let rightCount = 0;

        if (seatsCount === 2) {
          leftCount = 1;
          rightCount = 1;
        } else {
          const base = Math.floor(seatsCount / 4);
          const rem = seatsCount % 4;
          topCount = base + (rem > 0 ? 1 : 0);
          bottomCount = base + (rem > 1 ? 1 : 0);
          leftCount = base + (rem > 2 ? 1 : 0);
          rightCount = base;
        }

        const distFromEdge = Math.min(8, tableH * 0.18);
        const distFromEdgeH = Math.min(8, tableW * 0.18);

        for (let i = 0; i < topCount; i++) {
          platePositions.push({ x: (i + 0.5) * (tableW / topCount), y: distFromEdge });
        }
        for (let i = 0; i < bottomCount; i++) {
          platePositions.push({ x: (i + 0.5) * (tableW / bottomCount), y: tableH - distFromEdge });
        }
        for (let i = 0; i < leftCount; i++) {
          platePositions.push({ x: distFromEdgeH, y: (i + 0.5) * (tableH / leftCount) });
        }
        for (let i = 0; i < rightCount; i++) {
          platePositions.push({ x: tableW - distFromEdgeH, y: (i + 0.5) * (tableH / rightCount) });
        }
      }
    }

    if (!isAbsoluteLayout) {
      return (
        <TouchableOpacity
          activeOpacity={isPaid ? 1 : 0.8}
          disabled={isPaid}
          style={[
            styles.tableBox,
            {
              width: itemSize,
              height: itemSize,
              borderColor,
              backgroundColor: bgColor,
              borderWidth,
              elevation: status !== 0 ? 0 : 2,
              opacity: isPaid ? 0.92 : 1,
              justifyContent: "center",
              alignItems: "center",
              borderRadius: 12,
              position: "relative",
            },
          ]}
          onPress={() => onPress(item, tableData)}
        >
          {/* 🚀 HOLD OVERTIME INDICATOR (H) */}
          {status === 3 && !!tableData?.isHoldOvertime && (
            <View style={styles.holdOvertimeBadge}>
              <MaterialCommunityIcons
                name="alpha-h-circle"
                size={Math.max(14, itemSize * 0.18)}
                color={Theme.primary}
              />
            </View>
          )}

          {/* 🚀 QR ORDER INDICATOR (QR badge) */}
          {((tableData?.entryStatus !== undefined && tableData?.entryStatus !== null)
            ? tableData.entryStatus
            : item.entryStatus) === "q" &&
            status !== 0 && (
              <View style={styles.qrBadge}>
                <Ionicons
                  name="qr-code"
                  size={Math.max(14, itemSize * 0.18)}
                  color={ui.color}
                />
              </View>
            )}

          <Text
            style={[
              styles.tableNumber,
              {
                fontSize: numberFont,
                color: "#000000",
                fontWeight: "900"
              },
            ]}
          >
            {item.label}
          </Text>

          {status !== 0 && (
            <View style={[styles.tableInfo, { gap: 1 }]}>
              <View
                style={[
                  styles.statusChip,
                  {
                    backgroundColor: activeBg,
                    borderColor: activeColor,
                    paddingHorizontal: 4,
                    paddingVertical: 2,
                    borderRadius: 6,
                    marginBottom: 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statusChipText,
                    { color: activeColor, fontSize: smallFont },
                  ]}
                  numberOfLines={1}
                >
                  {tableData?.customerName ? tableData.customerName : ui.text}
                </Text>
              </View>

              {status !== 5 && (
                <View style={styles.tableStats}>
                  {timeText ? (
                    <Text style={[styles.timeText, { fontSize: smallFont - 1, color: textColor }]}>
                      <Ionicons name="time-outline" size={smallFont - 1} color={textColor} /> {timeText}
                    </Text>
                  ) : null}
                  {billAmount >= 0 && (
                    <Text style={[styles.billText, { fontSize: smallFont + 1, color: textColor, fontWeight: "800" }]}>
                      {(useCompanySettingsStore.getState().settings.currencySymbol || "$")}{billAmount.toFixed(2)}
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}

          {status === 5 && (
            <View style={[styles.lockedOverlay, { marginTop: 1, gap: 1 }]}>
              <Ionicons name="lock-closed" size={16} color={ui.color} />
              {tableData?.lockedByName ? (
                <Text style={[styles.lockedNameText, { fontSize: smallFont - 1 }]}>
                  {tableData.lockedByName}
                </Text>
              ) : null}
            </View>
          )}
        </TouchableOpacity>
      );
    }

    return (
      <TouchableOpacity
        activeOpacity={isPaid ? 1 : 0.8}
        disabled={isPaid}
        style={isAbsoluteLayout ? {
          width: itemSize,
          height: itemSize,
          position: "relative",
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "transparent",
          borderColor: "transparent",
          borderWidth: 0,
          borderRadius: 14,
          padding: 8,
          opacity: isPaid ? 0.92 : 1,
        } : [
          styles.tableBox,
          {
            width: itemSize,
            height: itemSize,
            borderColor,
            backgroundColor: bgColor,
            borderWidth,
            elevation: status !== 0 ? 0 : 2,
            opacity: isPaid ? 0.92 : 1,
          },
        ]}
        onPress={() => onPress(item, tableData)}
      >
        {/* ── Shared FloorPlanTable: table body + chairs ── */}
        <FloorPlanTable
          tableW={tableW}
          tableH={tableH}
          borderRadius={borderRadius}
          seatsCount={seatsCount}
          status={status}
          activeColor={activeColor}
          activeBg={activeBg}
          labelColor={labelColor}
          textColor={textColor}
          label={item.label}
          uiText={ui.text}
          paxCount={seatsCount}
          timeText={timeText}
          billAmount={billAmount}
          customerName={tableData?.customerName}
          lockedByName={tableData?.lockedByName}
          chairSize={chairSize}
          chairPositions={chairPositions}
          tx={tx}
          ty={ty}
          smallFont={smallFont}
          numberFont={numberFont}
          itemSize={itemSize}
        />


        {/* 🟢 LIVE TERMINAL INDICATOR: top-left spinner for processing, circular red error badge when cancelled/failed */}
        {terminalStatus && terminalStatus !== "idle" && (
          <TouchableOpacity
            style={[
              styles.terminalProcessingBadge,
              (terminalStatus === "cancelled" || terminalStatus === "failed") &&
              styles.terminalErrorBadge,
            ]}
            onPress={(e) => {
              e.stopPropagation();
              useTerminalPaymentStore.getState().clearSession(tableId);
            }}
          >
            {terminalStatus === "processing" ? (
              <RotatingSyncIcon size={20} color="#3b82f6" />
            ) : (
              <Ionicons name="alert" size={16} color="#ffffff" />
            )}
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  },
);

const TableGridSkeleton = ({
  itemSize,
  columns,
  gap,
  padding,
  insets,
}: any) => {
  const items = Array.from({ length: columns * 5 });
  return (
    <View
      style={{
        paddingHorizontal: padding,
        paddingTop: padding,
        paddingLeft: padding + insets.left,
        paddingRight: padding + insets.right,
        flexDirection: "row",
        flexWrap: "wrap",
        gap: gap,
      }}
    >
      {items.map((_, i) => (
        <Skeleton
          key={i}
          width={itemSize}
          height={itemSize}
          borderRadius={12}
        />
      ))}
    </View>
  );
};

type TableItem = {
  id: string;
  label: string;
  DiningSection: number;
  Status: number;
  StartTime?: string | number | Date;
  totalAmount?: number;
  currentOrderId?: string;
  lockedByName?: string;
  isOvertime?: number;
  isHoldOvertime?: number;
  entryStatus?: string;
  paymentStatus?: number;
  customerName?: string;
  pax?: number;
  TableType?: string;
  Seats?: number;
  XSize?: number;
  YSize?: number;
  XPos?: number;
  YPos?: number;
};

const SECTIONS = ["SECTION_1", "SECTION_2", "SECTION_3", "TAKEAWAY"];

const SECTION_LABELS: Record<string, string> = {
  SECTION_1: "Section 1",
  SECTION_2: "Section 2",
  SECTION_3: "Section 3",
  TAKEAWAY: "Takeaway",
};

const SECTION_SHORT: Record<string, string> = {
  SECTION_1: "S1",
  SECTION_2: "S2",
  SECTION_3: "S3",
  TAKEAWAY: "TW",
};

const SECTION_ICONS: Record<string, string> = {
  SECTION_1: "restaurant-outline",
  SECTION_2: "restaurant-outline",
  SECTION_3: "restaurant-outline",
  TAKEAWAY: "bag-handle-outline",
};

const getResponsiveSectionLabel = (section: string, isMobile: boolean) => {
  if (isMobile) {
    switch (section) {
      case "SECTION_1":
        return "S-1";
      case "SECTION_2":
        return "S-2";
      case "SECTION_3":
        return "S-3";
      case "TAKEAWAY":
        return "TW";
      default:
        return section.replace("SECTION_", "S-").replace("Section ", "S-");
    }
  } else {
    switch (section) {
      case "SECTION_1":
        return "SEC-1";
      case "SECTION_2":
        return "SEC-2";
      case "SECTION_3":
        return "SEC-3";
      case "TAKEAWAY":
        return "TW";
      default:
        return section.replace("SECTION_", "SEC-").replace("Section ", "SEC-");
    }
  }
};

// Track the last table that was opened with guest details.
// If the user exits the menu without sending items, we clean this guest data.
let lastGuestOpenedTable: {
  tableId: string;
  customerName: string | null;
  pax: number | null;
} | null = null;

export default function Category() {
  const { width, height } = useWindowDimensions();
  const router = useRouter();
  const [availableWidth, setAvailableWidth] = useState(780);
  const { settings, fetchSettings } = useGeneralSettingsStore();

  useFocusEffect(
    React.useCallback(() => {
      fetchSettings();
    }, [])
  );

  const onContainerLayout = (event: any) => {
    const { width } = event.nativeEvent.layout;
    if (width > 0) {
      setAvailableWidth(width - 32); // 16px padding on left/right
    }
  };

  const [backgroundTheme, setBackgroundTheme] = useState("champagne_fizz");

  const { section: urlSection } = useLocalSearchParams<{ section?: string }>();
  const orderContext = useOrderContextStore((state) => state.currentOrder);
  const serviceModeStore = useOrderContextStore((state) => state.serviceMode);
  const activeSectionStore = useOrderContextStore((state) => state.activeSection);
  const setActiveSectionStore = useOrderContextStore((state) => state.setActiveSection);

  const effectiveMode = useMemo(() => {
    if (orderContext?.orderType === "TAKEAWAY" || urlSection === "TAKEAWAY") return "TAKEAWAY";
    if (orderContext?.orderType === "DINE_IN" || (urlSection && urlSection.startsWith("SECTION_"))) return "DINE_IN";
    if (serviceModeStore) return serviceModeStore;
    if (activeSectionStore === "TAKEAWAY") return "TAKEAWAY";
    return "DINE_IN";
  }, [orderContext?.orderType, urlSection, serviceModeStore, activeSectionStore]);

  const [activeTab, setActiveTab] = useState<string>(() => {
    if (urlSection && SECTIONS.includes(urlSection)) return urlSection;
    return "SECTION_1";
  });

  // Ensure SEC-1 is always default on fresh mount / page refresh
  useEffect(() => {
    if (!urlSection) {
      setActiveTab("SECTION_1");
      setActiveSectionStore("SECTION_1");
    }
  }, []);

  const visibleSections = useMemo(() => {
    return SECTIONS;
  }, []);

  const getSectionNum = (tab: string) => {
    if (tab === "TAKEAWAY") return "4";
    if (tab === "SECTION_1") return "1";
    if (tab === "SECTION_2") return "2";
    if (tab === "SECTION_3") return "3";
    return "1";
  };

  const loadBackgroundTheme = async () => {
    try {
      const sectionNum = getSectionNum(activeTab);
      const savedTheme = await AsyncStorage.getItem(`layout_background_theme_${sectionNum}`);
      if (savedTheme === "champagne" || savedTheme === "champagne_fizz" || savedTheme === "citrine" || savedTheme === "champagne_glass" || savedTheme === "cloud_nine") {
        setBackgroundTheme(savedTheme);
      } else {
        setBackgroundTheme("champagne_fizz");
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadBackgroundTheme();
  }, [activeTab]);

  const { showToast } = useToast();
  const isWindows = Platform.OS === "windows" || (Platform.OS === "web" && typeof navigator !== "undefined" && /win/i.test(navigator.platform || navigator.userAgent));
  const [allTables, setAllTables] = useState<TableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isMenuVisible, setIsMenuVisible] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isAvatarModalVisible, setIsAvatarModalVisible] = useState(false);
  const [isSettingsVisible, setIsSettingsVisible] = useState(false);
  const [isSettingsExpanded, setIsSettingsExpanded] = useState(false);
  const [isTablesExpanded, setIsTablesExpanded] = useState(false);
  const [isTableMasterExpanded, setIsTableMasterExpanded] = useState(false);
  const [isStaffExpanded, setIsStaffExpanded] = useState(false);
  const [isCustomerExpanded, setIsCustomerExpanded] = useState(false);
  const [isReportsExpanded, setIsReportsExpanded] = useState(false);
  const [isQrExpanded, setIsQrExpanded] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isQRModalVisible, setIsQRModalVisible] = useState(false);
  const sectionScrollRef = useRef<ScrollView>(null);

  // Customer guest name + pax modal states
  const [guestModalVisible, setGuestModalVisible] = useState(false);
  const [pendingGuestItem, setPendingGuestItem] = useState<TableItem | null>(
    null,
  );
  const [guestNameInput, setGuestNameInput] = useState("");
  const [guestPaxInput, setGuestPaxInput] = useState("");
  const [isSavingGuest, setIsSavingGuest] = useState(false);
  const [selectedBusinessDate, setSelectedBusinessDate] = useState<
    string | null
  >(null);
  const [modalSelectedDate, setModalSelectedDate] = useState<string>(
    getSingaporeDateString(),
  );
  const [showBusinessCalendar, setShowBusinessCalendar] = useState(false);
  const [isDayStarted, setIsDayStarted] = useState(false);
  const [activeBusinessDay, setActiveBusinessDay] = useState<string | null>(
    null,
  );
  const [isStartingDay, setIsStartingDay] = useState(false);
  const [companyInfo, setCompanyInfo] = useState<any>(null);

  useEffect(() => {
    fetch(`${API_URL}/api/company-settings/1`)
      .then((res) => res.json())
      .then((data) => {
        if (data && data.success && data.settings) {
          setCompanyInfo(data.settings);
        }
      })
      .catch((err) => console.log("Error fetching company settings for license:", err));
  }, [isMenuVisible]);



  // ──── Move Table modal states ────────────────────────────────────────────
  const [isMoveTableVisible, setIsMoveTableVisible] = useState(false);
  const [moveSourceTable, setMoveSourceTable] = useState<TableItem | null>(
    null,
  );
  const [moveDestTable, setMoveDestTable] = useState<TableItem | null>(null);
  const [moveStep, setMoveStep] = useState<"source" | "dest">("source");
  const [moveSearchQuery, setMoveSearchQuery] = useState("");
  const [moveActiveSection, setMoveActiveSection] = useState("SECTION_1");
  const [isMovingTable, setIsMovingTable] = useState(false);

  const checkActiveBusinessDay = async () => {
    try {
      const res = await fetch(`${API_URL}/api/settlement/active-day`);
      const data = await res.json();
      if (data.success && data.active && data.startDate) {
        setIsDayStarted(true);
        setActiveBusinessDay(data.startDate);
        setSelectedBusinessDate(data.startDate);
        setModalSelectedDate(data.startDate);
        await AsyncStorage.setItem("selected_business_date", data.startDate);
      } else {
        setIsDayStarted(false);
        setActiveBusinessDay(null);
        const savedDate = await AsyncStorage.getItem("selected_business_date");
        const defaultDate = savedDate || getSingaporeDateString();
        setSelectedBusinessDate(defaultDate);
        setModalSelectedDate(defaultDate);
      }
    } catch (err) {
      console.error("Failed to check active business day:", err);
    }
  };

  useEffect(() => {
    checkActiveBusinessDay();
  }, []);

  const handleStartDay = async (dateOverride?: string): Promise<boolean> => {
    const todaySingapore = getSingaporeDateString();
    const targetDate = dateOverride || modalSelectedDate || selectedBusinessDate || todaySingapore;
    if (!targetDate) {
      showToast({
        type: "warning",
        message: "No Date Selected",
        subtitle: "Please select a date from the calendar first.",
      });
      return false;
    }

    if (targetDate !== todaySingapore) {
      showToast({
        type: "warning",
        message: "Invalid Business Date",
        subtitle: "Start Day is only allowed for the present date (today).",
      });
      return false;
    }

    setIsStartingDay(true);
    try {
      const res = await fetch(`${API_URL}/api/settlement/day-start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: targetDate,
          username: user?.userName || user?.username || "admin",
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSelectedBusinessDate(targetDate);
        setModalSelectedDate(targetDate);
        await AsyncStorage.setItem(
          "selected_business_date",
          targetDate,
        );
        setIsDayStarted(true);
        setActiveBusinessDay(targetDate);
        showToast({
          type: "success",
          message: "Day Started",
          subtitle: `Business day successfully started for ${formatDateToDMY(targetDate)}.`,
        });
        return true;
      } else {
        showToast({
          type: "error",
          message: "Day Start Failed",
          subtitle: data.error || "Could not start business day.",
        });
        return false;
      }
    } catch (err) {
      console.error("Failed to start day:", err);
      showToast({
        type: "error",
        message: "Network Error",
        subtitle: "Failed to connect to the server.",
      });
      return false;
    } finally {
      setIsStartingDay(false);
    }
  };

  const formatDateToDMY = (dateStr: string) => {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  };

  const formatDateToDotDMY = (dateStr: string) => {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  };

  const BusinessDatePill: React.FC<{
    date: string | null;
    isDayStarted: boolean;
    isStartingDay?: boolean;
    onPress: () => void;
    compact?: boolean;
  }> = ({ date, isDayStarted, isStartingDay = false, onPress, compact = false }) => {
    const displayDate = date
      ? formatDateToDotDMY(date)
      : formatDateToDotDMY(getSingaporeDateString());

    return (
      <TouchableOpacity
        activeOpacity={isDayStarted ? 0.9 : 0.75}
        onPress={onPress}
        style={[
          {
            backgroundColor: "#FFFFFF",
            borderRadius: 24,
            borderWidth: 1,
            borderColor: "#E5E9F0",
            flexDirection: "row",
            alignItems: "center",
            paddingLeft: compact ? 4 : 6,
            paddingRight: compact ? 6 : 10,
            paddingVertical: compact ? 3.5 : 5,
            marginHorizontal: compact ? 0 : 6,
            shadowColor: "#94A3B8",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.16,
            shadowRadius: 5,
            elevation: 3,
            ...(Platform.OS === "web"
              ? {
                  boxShadow:
                    "0 2px 8px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.03), inset 0 1px 1px rgba(255, 255, 255, 0.8)",
                  cursor: isDayStarted ? "default" : "pointer",
                  transition: "all 0.15s ease",
                }
              : {}),
          } as any,
        ]}
      >
        {/* Left: Neumorphic Inset Well with Centered Orange Gradient Square */}
        <View
          style={{
            width: compact ? 34 : 40,
            height: compact ? 34 : 40,
            borderRadius: compact ? 12 : 14,
            backgroundColor: "#F1F4F9",
            justifyContent: "center",
            alignItems: "center",
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.08,
            shadowRadius: 3,
            elevation: 1,
            ...(Platform.OS === "web"
              ? {
                  boxShadow:
                    "inset 0 2px 4px rgba(0, 0, 0, 0.08), inset 0 -1px 2px rgba(255, 255, 255, 0.9), 0 1px 2px rgba(0,0,0,0.03)",
                }
              : {}),
          } as any}
        >
          <View
            style={{
              shadowColor: "#FF5900",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.35,
              shadowRadius: 5,
              elevation: 4,
              borderRadius: compact ? 8 : 10,
              overflow: "hidden",
              ...(Platform.OS === "web"
                ? {
                    boxShadow: "0 3px 8px rgba(255, 89, 0, 0.38)",
                  }
                : {}),
            } as any}
          >
            <LinearGradient
              colors={["#FF9526", "#FF5900"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                width: compact ? 26 : 30,
                height: compact ? 26 : 30,
                borderRadius: compact ? 8 : 10,
                justifyContent: "center",
                alignItems: "center",
              }}
            >
              <Ionicons
                name="calendar"
                size={compact ? 15 : 17}
                color="#FFFFFF"
              />
            </LinearGradient>
          </View>
        </View>

        {/* Middle: Business Date in Bold Dark Navy Text (shown only when day is started) */}
        {isDayStarted ? (
          <>
            <Text
              style={{
                fontFamily: Fonts.bold,
                fontSize: compact ? 12 : 14.5,
                color: "#0F172A",
                letterSpacing: 0.2,
                marginLeft: compact ? 5 : 8,
                marginRight: compact ? 5 : 9,
              }}
            >
              {displayDate}
            </Text>

            {/* Thin, Light-Grey Vertical Divider */}
            <View
              style={{
                width: 1,
                height: compact ? 14 : 19,
                backgroundColor: "#E2E8F0",
                marginRight: compact ? 5 : 9,
              }}
            />
          </>
        ) : (
          <View style={{ width: compact ? 6 : 8 }} />
        )}

        {/* Right: Status Badge */}
        {isStartingDay ? (
          <View
            style={{
              backgroundColor: "#E8FDF0",
              borderWidth: 1,
              borderColor: "#A7F3D0",
              borderRadius: compact ? 12 : 14,
              paddingHorizontal: compact ? 5 : 9,
              paddingVertical: compact ? 2 : 3.5,
              flexDirection: "row",
              alignItems: "center",
              gap: compact ? 3 : 4,
            }}
          >
            <ActivityIndicator
              size="small"
              color="#059669"
              style={{ transform: [{ scale: compact ? 0.6 : 0.65 }] }}
            />
            <Text
              style={{
                fontFamily: Fonts.bold,
                fontSize: compact ? 9.5 : 11.5,
                color: "#059669",
                letterSpacing: 0.1,
              }}
            >
              Starting...
            </Text>
          </View>
        ) : isDayStarted ? (
          <View
            style={{
              backgroundColor: "#E8FDF0",
              borderWidth: 1,
              borderColor: "#A7F3D0",
              borderRadius: compact ? 12 : 14,
              paddingHorizontal: compact ? 5 : 9,
              paddingVertical: compact ? 2 : 3.5,
              flexDirection: "row",
              alignItems: "center",
              gap: compact ? 3 : 4,
            }}
          >
            <Ionicons
              name="checkmark-circle"
              size={compact ? 12.5 : 16}
              color="#10B981"
            />
            <Text
              style={{
                fontFamily: Fonts.bold,
                fontSize: compact ? 9.5 : 12,
                color: "#059669",
                letterSpacing: 0.1,
              }}
            >
              Day Started
            </Text>
          </View>
        ) : (
          <View
            style={{
              backgroundColor: "#FFF7ED",
              borderWidth: 1,
              borderColor: "#FED7AA",
              borderRadius: compact ? 12 : 14,
              paddingHorizontal: compact ? 5 : 9,
              paddingVertical: compact ? 2 : 3.5,
              flexDirection: "row",
              alignItems: "center",
              gap: compact ? 3 : 4,
            }}
          >
            <Ionicons
              name="play-circle"
              size={compact ? 12.5 : 16}
              color="#EA580C"
            />
            <Text
              style={{
                fontFamily: Fonts.bold,
                fontSize: compact ? 9.5 : 12,
                color: "#EA580C",
                letterSpacing: 0.1,
              }}
            >
              Start Day
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  // Removed global 'tables' selector for performance
  const getLockedName = useTableStatusStore((s: any) => s.getLockedName);

  const insets = useSafeAreaInsets();
  const isTablet = Math.min(width, height) >= 500;
  const isLandscape = width > height;

  const { itemSize, numberFont, smallFont, columns, GAP, PADDING } =
    useMemo(() => {
      const insetsValue = insets; // Access insets from outside closure

      const gapVal = !isTablet && isLandscape ? 8 : 10;
      const paddingVal = isTablet ? 24 : isLandscape ? 12 : 16;
      const availableGridWidth =
        width - paddingVal * 2 - insetsValue.left - insetsValue.right - 2;

      let cols = 3;
      if (isTablet) {
        if (width < 768) cols = 4;
        else if (width < 1024) cols = 6;
        else if (width < 1280) cols = 8;
        else if (width < 1920) cols = 10;
        else cols = 12;
      } else {
        if (isLandscape) {
          cols = Math.max(5, Math.floor(availableGridWidth / 115));
        } else {
          cols = 3;
        }
      }

      const size = Math.floor(
        (availableGridWidth - gapVal * (cols - 1)) / cols,
      );
      const nFont = Math.max(12, Math.min(isTablet ? 24 : 20, size * 0.32));
      const sFont = Math.max(8, Math.min(isTablet ? 14 : 11, size * 0.18));

      return {
        itemSize: size,
        numberFont: nFont,
        smallFont: sFont,
        columns: cols,
        GAP: gapVal,
        PADDING: paddingVal,
      };
    }, [width, height, insets]);

  const user = useAuthStore((s: any) => s.user);
  const { notifications, unreadCount, markAllAsRead } = useNotificationStore();
  const [isNotifModalVisible, setIsNotifModalVisible] = useState(false);
  const logout = useAuthStore((s: any) => s.logout);
  const canAccessSalesReport = useAuthStore((s: any) => s.canAccessSalesReport);
  const canAccessMembers = useAuthStore((s: any) => s.canAccessMembers);
  const canAccessStaffAttendance = useAuthStore(
    (s: any) => s.canAccessStaffAttendance,
  );
  const canAccessLockTables = useAuthStore((s: any) => s.canAccessLockTables);
  const canAccessKDS = useAuthStore((s: any) => s.canAccessKDS);
  const canAccessDayEnd = useAuthStore((s: any) => s.canAccessDayEnd);
  const canAccessStoreSettings = useAuthStore(
    (s: any) => s.canAccessStoreSettings,
  );
  const canAccessReceiptSettings = useAuthStore(
    (s: any) => s.canAccessReceiptSettings,
  );
  const isWaiter = useAuthStore((s: any) => s.isWaiter);
  const enableKDS = useGeneralSettingsStore((s: any) => s.settings.enableKDS);
  const enableGuestDetailsPopup = useGeneralSettingsStore((s: any) =>
    s.settings.enableGuestDetailsPopup !== undefined
      ? s.settings.enableGuestDetailsPopup
      : true,
  );

  const activeOrders = useActiveOrdersStore((s) => s.activeOrders);
  const readyItemsCount = useMemo(() => {
    let count = 0;
    const tableGroups: Record<string, any> = {};

    activeOrders.forEach((order) => {
      const { context } = order;
      const groupKey =
        context.orderType === "DINE_IN"
          ? `TABLE_${context.section}_${context.tableNo}`
          : `TAKEAWAY_${context.takeawayNo}`;

      if (!tableGroups[groupKey]) {
        tableGroups[groupKey] = {
          items: [],
        };
      }

      order.items.forEach((i: any) => {
        if (i.status === "READY") {
          const exists = tableGroups[groupKey].items.find(
            (ei: any) => ei.lineItemId === i.lineItemId,
          );
          if (!exists) {
            tableGroups[groupKey].items.push(i);
            count++;
          }
        }
      });
    });

    return count;
  }, [activeOrders]);

  // 🔔 Real-time sync now handled globally via useGlobalSocketSync

  // ——— Route guard: redirect to login if not authenticated ———
  useFocusEffect(
    React.useCallback(() => {
      checkActiveBusinessDay();
      const { user: currentUser, loginDate, logout } = useAuthStore.getState();
      if (!currentUser) {
        router.replace("/login");
        return;
      }

      const currentDate = new Date().toISOString().split("T")[0];
      if (loginDate && currentDate !== loginDate) {
        logout();
        router.replace("/login");
        return;
      }

      // ✅ KDS Guard: Prevent KDS role from accessing table selection
      if (currentUser.role === "KDS") {
        router.replace("/kds" as any);
        return;
      }
    }, []),
  );

  useEffect(() => {
    const loadAvatar = async () => {
      if (user?.userId) {
        try {
          const savedAvatar = await AsyncStorage.getItem(`user_avatar_${user.userId}`);
          setAvatarUrl(savedAvatar);
        } catch (e) {
          console.error("Failed to load user avatar:", e);
        }
      } else {
        setAvatarUrl(null);
      }
    };
    loadAvatar();
  }, [user?.userId]);

  const handleSelectAvatar = async (url: string | null) => {
    setAvatarUrl(url);
    if (user?.userId) {
      try {
        if (url) {
          await AsyncStorage.setItem(`user_avatar_${user.userId}`, url);
        } else {
          await AsyncStorage.removeItem(`user_avatar_${user.userId}`);
        }
      } catch (e) {
        console.error("Failed to save user avatar:", e);
      }
    }
  };

  useEffect(() => {
    // Initial load
    fetchTables();

    // Only fetch settings if not already loaded
    usePaymentSettingsStore.getState().fetchSettings();
    import("@/stores/generalSettingsStore").then((m) =>
      m.useGeneralSettingsStore.getState().fetchSettings(),
    );
    import("@/stores/companySettingsStore").then((m) =>
      m.useCompanySettingsStore.getState().fetchSettings("1"),
    );
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      // If the user previously entered guest details, but exited without placing an order (status is still EMPTY/0),
      // we clear those guest details.
      if (lastGuestOpenedTable) {
        const { tableId } = lastGuestOpenedTable;
        const store = useTableStatusStore.getState();
        const tableData = store.tableMap[tableId];
        const status = tableData
          ? tableData.status === "SENT"
            ? 1
            : tableData.status === "BILL_REQUESTED"
              ? 2
              : tableData.status === "HOLD"
                ? 3
                : tableData.status === "LOCKED"
                  ? 5
                  : 0
          : 0;

        if (status === 0) {
          console.log(
            `[Category] Table ${tableId} exited without adding items. Clearing guest data...`,
          );

          // Clear guest details in the database
          fetch(`${API_URL}/api/tables/save-guest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tableId,
              customerName: null,
              pax: null,
              userId: useAuthStore.getState().user?.userId,
            }),
          }).catch((err) =>
            console.warn("Failed to clear guest details on exit:", err),
          );

          // Optimistically clear in the local state store
          const targetTable = store.tables.find((t) => t.tableId === tableId);
          const section = targetTable ? targetTable.section : "SECTION_1";
          const label = targetTable ? targetTable.tableNo : "";

          store.updateTableStatus(
            tableId,
            section,
            label,
            "EMPTY",
            "EMPTY",
            undefined,
            undefined,
            0,
            false,
            false,
            undefined,
            undefined,
            null as any, // clear customerName
            null as any, // clear pax
          );
        }

        // Clear the tracker
        lastGuestOpenedTable = null;
      }

      // Re-fetch only if data is likely stale (older than 30s)
      if (Date.now() - lastTablesFetchTime > 30000) {
        fetchTables();
      }
    }, []),
  );

  // --- Real-time Sync (Polling every 15s as backup) ---
  useEffect(() => {
    const interval = setInterval(() => {
      fetchTables();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleTableConfigUpdated = () => {
      fetchTables();
      loadBackgroundTheme();
    };

    const handleTableStatusUpdated = (data: any) => {
      if (!data) return;
      const cleanTableId = String(data.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
      const cleanTableNo = data.tableNo ? String(data.tableNo).trim().toLowerCase() : "";

      setAllTables((prev) =>
        prev.map((tbl) => {
          const matchId = tbl.id && String(tbl.id).replace(/^\{|\}$/g, "").trim().toLowerCase() === cleanTableId;
          const matchNo = cleanTableNo && String(tbl.label).trim().toLowerCase() === cleanTableNo;
          if (matchId || matchNo) {
            const rawSec = data.section || tbl.DiningSection;
            const secStr = getSectionFromDiningSection(rawSec);
            const numStatus = data.status !== undefined ? Number(data.status) : tbl.Status;
            const mappedStatus = (numStatus === 5 ? "LOCKED" : (numStatus === 1 || numStatus === 4) ? "SENT" : numStatus === 2 ? "BILL_REQUESTED" : numStatus === 3 ? "HOLD" : "EMPTY");
            useTableStatusStore.getState().updateTableStatus(
              tbl.id,
              secStr,
              tbl.label,
              (data.currentOrderId !== undefined ? data.currentOrderId : tbl.currentOrderId) || "SYNC",
              mappedStatus as any,
              data.startTime || (numStatus === 0 ? 0 : undefined),
              data.lockedByName,
              data.totalAmount !== undefined ? Number(data.totalAmount) : tbl.totalAmount,
              false,
              false,
              data.modifiedOn || data.ModifiedOn,
              data.entryStatus !== undefined ? (data.entryStatus || undefined) : (numStatus === 0 ? undefined : tbl.entryStatus),
              data.customerName !== undefined ? (data.customerName || undefined) : (numStatus === 0 ? undefined : tbl.customerName),
              data.pax !== undefined ? Number(data.pax) : (numStatus === 0 ? undefined : tbl.pax),
              data.paymentStatus !== undefined && data.paymentStatus !== null ? Number(data.paymentStatus) : (numStatus === 0 ? 0 : tbl.paymentStatus)
            );

            return {
              ...tbl,
              Status: numStatus,
              totalAmount: data.totalAmount !== undefined ? Number(data.totalAmount) : tbl.totalAmount,
              entryStatus: data.entryStatus !== undefined ? data.entryStatus : (numStatus === 0 ? null : tbl.entryStatus),
              paymentStatus: data.paymentStatus !== undefined && data.paymentStatus !== null ? Number(data.paymentStatus) : (numStatus === 0 ? 0 : tbl.paymentStatus),
              currentOrderId: data.currentOrderId !== undefined ? data.currentOrderId : (numStatus === 0 ? null : tbl.currentOrderId),
              customerName: data.customerName !== undefined ? data.customerName : (numStatus === 0 ? null : tbl.customerName),
              pax: data.pax !== undefined ? data.pax : (numStatus === 0 ? null : tbl.pax),
            };
          }
          return tbl;
        })
      );
    };

    const handleQrPaymentConfirmed = (data: any) => {
      if (!data) return;
      const cleanTableId = String(data.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
      const cleanTableNo = data.tableNo ? String(data.tableNo).trim().toLowerCase() : "";

      setAllTables((prev) =>
        prev.map((tbl) => {
          const matchId = tbl.id && String(tbl.id).replace(/^\{|\}$/g, "").trim().toLowerCase() === cleanTableId;
          const matchNo = cleanTableNo && String(tbl.label).trim().toLowerCase() === cleanTableNo;
          if (matchId || matchNo) {
            return {
              ...tbl,
              paymentStatus: 1,
              entryStatus: data.entryStatus || tbl.entryStatus || 'q',
            };
          }
          return tbl;
        })
      );
    };

    const handleTablesUpdated = () => {
      fetchTables();
    };

    const handleSettlementUpdate = () => {
      checkActiveBusinessDay();
    };

    socket.on("table_config_updated", handleTableConfigUpdated);
    socket.on("table_status_updated", handleTableStatusUpdated);
    socket.on("qr_payment_confirmed", handleQrPaymentConfirmed);
    socket.on("tables_updated", handleTablesUpdated);
    socket.on("settlement_updated", handleSettlementUpdate);

    return () => {
      socket.off("table_config_updated", handleTableConfigUpdated);
      socket.off("table_status_updated", handleTableStatusUpdated);
      socket.off("qr_payment_confirmed", handleQrPaymentConfirmed);
      socket.off("tables_updated", handleTablesUpdated);
      socket.off("settlement_updated", handleSettlementUpdate);
    };
  }, []);

  // fetchLockedTables consolidated into fetchTables

  const fetchTables = async () => {
    lastTablesFetchTime = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(`${API_URL}/api/tables/all`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeoutId);

      if (!response.ok)
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const data = await response.json();
      let tablesArray: any[] = [];
      if (Array.isArray(data)) tablesArray = data;
      else if (data?.data && Array.isArray(data.data)) tablesArray = data.data;
      else if (data?.recordset && Array.isArray(data.recordset))
        tablesArray = data.recordset;

      if (tablesArray.length > 0) {
        const convertedData: TableItem[] = tablesArray.map((item: any) => ({
          id: String(item.TableId || item.id || "")
            .replace(/^\{|\}$/g, "")
            .trim()
            .toLowerCase(),
          label: item.TableNumber || item.label,
          DiningSection: Number(item.DiningSection) || 1,
          Status: Number(item.Status) || 0,
          StartTime: item.StartTime,
          lockedByName: item.lockedByName,
          totalAmount: Number(item.totalAmount) || 0,
          currentOrderId: item.currentOrderId,
          isOvertime: Number(item.isOvertime) || 0,
          isHoldOvertime: Number(item.isHoldOvertime) || 0,
          lastModified: item.ModifiedOn,
          entryStatus: item.entryStatus || item.entry_status,
          paymentStatus: Number(item.paymentStatus) || 0,
          customerName: item.customerName || item.CustomerName || null,
          pax: item.pax || item.Pax || null,
          TableType: item.TableType,
          Seats: item.Seats !== undefined && item.Seats !== null ? Number(item.Seats) : undefined,
          XSize: item.XSize !== undefined && item.XSize !== null ? Number(item.XSize) : undefined,
          YSize: item.YSize !== undefined && item.YSize !== null ? Number(item.YSize) : undefined,
          XPos: item.XPos !== undefined && item.XPos !== null ? Number(item.XPos) : undefined,
          YPos: item.YPos !== undefined && item.YPos !== null ? Number(item.YPos) : undefined,
        }));

        const uniqueTables = convertedData.filter(
          (item, index, self) =>
            index === self.findIndex((t) => t.id === item.id),
        );

        setAllTables((prev) => {
          if (prev.length !== uniqueTables.length) return uniqueTables;
          const isSame = prev.every(
            (t, i) =>
              t.id === uniqueTables[i].id &&
              t.label === uniqueTables[i].label &&
              t.XPos === uniqueTables[i].XPos &&
              t.YPos === uniqueTables[i].YPos &&
              t.XSize === uniqueTables[i].XSize &&
              t.YSize === uniqueTables[i].YSize &&
              t.TableType === uniqueTables[i].TableType &&
              t.Status === uniqueTables[i].Status &&
              t.Seats === uniqueTables[i].Seats &&
              t.totalAmount === uniqueTables[i].totalAmount &&
              t.paymentStatus === uniqueTables[i].paymentStatus &&
              t.entryStatus === uniqueTables[i].entryStatus
          );
          return isSame ? prev : uniqueTables;
        });

        // 🚀 BATCH SYNC to global store (MUCH FASTER)
        const updates = uniqueTables.map((t) => {
          let finalStartTime = 0;
          if (t.StartTime) {
            const parsed = parseDatabaseDate(t.StartTime).getTime();
            if (!isNaN(parsed)) finalStartTime = parsed;
          }

          return {
            tableId: t.id,
            section: getSectionFromDiningSection(t.DiningSection),
            tableNo: t.label,
            orderId: (t as any).currentOrderId || "EMPTY",
            status: (t.Status === 5
              ? "LOCKED"
              : t.Status === 1
                ? "SENT"
                : t.Status === 2
                  ? "BILL_REQUESTED"
                  : t.Status === 3
                    ? "HOLD"
                    : "EMPTY") as TableStatusType,
            startTime: finalStartTime,
            lockedByName: t.lockedByName,
            totalAmount: t.totalAmount,
            isHoldOvertime: t.isHoldOvertime === 1 || !!t.isHoldOvertime,
            lastModified: (t as any).lastModified,
            entryStatus: t.entryStatus ?? undefined,
            paymentStatus: t.paymentStatus ?? 0,
            customerName: t.customerName ?? undefined,
            pax: t.pax ?? undefined,
          };
        });

        useTableStatusStore.getState().batchUpdateTableStatus(updates);
      } else {
        throw new Error("No tables returned from API");
      }
    } catch (error) {
      Alert.alert(
        "Connection Error",
        `Failed to connect to server at ${API_URL}\n\nPlease ensure the backend server is running.`,
        [{ text: "OK" }],
      );
      setAllTables([]);
    } finally {
      setLoading(false);
    }
  };

  const confirmUnlock = (tableId: string, tableLabel: string) => {
    Alert.alert(
      "Unlock Table",
      `Are you sure you want to unlock Table ${tableLabel}?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Unlock Now",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await fetch(
                `${API_URL}/api/tables/unlock-persistent`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ tableId, userId: user?.userId }),
                },
              );
              const data = await res.json();
              if (res.ok && data.success) {
                // Optimistic store update
                const targetTable = allTables.find((t) => t.id === tableId);
                if (targetTable) {
                  const section = getSectionFromDiningSection(
                    targetTable.DiningSection,
                  );
                  useTableStatusStore
                    .getState()
                    .updateTableStatus(
                      tableId,
                      section,
                      tableLabel,
                      "SYNC",
                      "EMPTY",
                      undefined,
                      undefined,
                      0,
                    );
                }
                fetchTables();
                Alert.alert("Success", `Table ${tableLabel} unlocked.`);
              } else {
                Alert.alert("Error", data.error || "Failed to unlock");
              }
            } catch (err) {
              Alert.alert("Error", "Network error while unlocking");
            }
          },
        },
      ],
    );
  };

  useEffect(() => {
    if (urlSection && SECTIONS.includes(urlSection)) {
      setActiveTab(urlSection);
    }
  }, [urlSection]);

  useEffect(() => {
    const index = SECTIONS.indexOf(activeTab);
    if (index !== -1 && sectionScrollRef.current) {
      sectionScrollRef.current.scrollTo({ x: index * 120, animated: true });
    }
  }, [activeTab]);

  // 🚀 PERFORMANCE FIX: Removed direct dependency on 'tables' array to prevent full screen re-renders.
  // Individual TableItemComponents now subscribe to their own status.

  const currentTables = useMemo(() => {
    const filtered = getSectionTables(activeTab, allTables);

    return [...filtered].sort((a, b) => {
      const aLocked = a.Status === 5;
      const bLocked = b.Status === 5;
      if (aLocked && !bLocked) return -1;
      if (!aLocked && bLocked) return 1;

      return a.label.localeCompare(b.label, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  }, [allTables, activeTab]);

  // Check if any table in the current section has saved layout positions (XPos > 0 or YPos > 0)
  const hasCustomLayout = useMemo(() => {
    return currentTables.some((t) => (t.XPos && t.XPos > 0) || (t.YPos && t.YPos > 0));
  }, [currentTables]);

  // Dynamic Canvas Height based on table positions in current section
  const canvasHeight = useMemo(() => {
    const maxY = currentTables.reduce((max, t) => Math.max(max, t.YPos || 0), 0);
    return Math.max(650, maxY + 140);
  }, [currentTables]);

  // 🚀 Optimized Occupied Count: Only re-renders when the count changes
  const occupiedCount = useTableStatusStore(
    (state) =>
      state.tables.filter(
        (t) => t.status !== "EMPTY" && t.status !== 0,
      ).length,
  );

  const tableMap = useTableStatusStore((state) => state.tableMap);

  // ———— STATUS HANDLERS (OPTIMISTIC) ————
  const updateTableStatus = async (
    tableId: string,
    status: number,
    lockedByName?: string,
    totalAmount?: number,
  ): Promise<boolean> => {
    // 1. Optimistic UI update
    const previousTables = [...allTables];
    setAllTables((prev: TableItem[]) =>
      prev.map((t: TableItem) =>
        t.id === tableId ? { ...t, Status: status } : t,
      ),
    );

    // Update global store
    const table = allTables.find((t: TableItem) => t.id === tableId);
    if (table) {
      const statusStrMap: Record<number, TableStatusType> = {
        0: "EMPTY",
        1: "SENT",
        2: "BILL_REQUESTED",
        3: "HOLD",
        4: "SENT", // Overtime is technically still an active order (SENT)
        5: "LOCKED",
      };

      useTableStatusStore.getState().updateTableStatus(
        tableId,
        getSectionFromDiningSection(table.DiningSection),
        table.label,
        "SYNC", // Generic orderId
        statusStrMap[status],
        undefined,
        lockedByName,
        totalAmount,
      );
    }

    try {
      const res = await fetch(`${API_URL}/api/tables/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId,
          status,
          lockedByName,
          userId: user?.userId,
        }),
      });
      if (!res.ok) throw new Error("Failed to update status");

      // Successfully updated backend
      fetchTables(); // 🔥 refresh after update
      return true;
    } catch (err) {
      console.error("Status update failed:", err);
      Alert.alert(
        "Sync Error",
        "Could not sync status with server. Reverting UI.",
      );
      setAllTables(previousTables);
      return false;
    }
  };

  const getSectionFromDiningSection = (ds: number) => {
    if (ds === 1) return "SECTION_1";
    if (ds === 2) return "SECTION_2";
    if (ds === 3) return "SECTION_3";
    return "TAKEAWAY";
  };

  const handleDining = (id: string) => updateTableStatus(id, 1); // Dining
  const handleCheckout = async (id: string) => {
    if (isCheckingOut) return;

    const tableStatus = useTableStatusStore.getState().tableMap[id];
    const effectiveStatus = tableStatus
      ? tableStatus.status === "SENT"
        ? 1
        : tableStatus.status === "BILL_REQUESTED"
          ? 2
          : 1
      : 0;

    if (effectiveStatus === 0) return;

    const checkoutFlowEnabled =
      useGeneralSettingsStore.getState().settings.enableCheckoutFlow !== false;

    setIsCheckingOut(true);
    try {
      const res = await useCartStore.getState().checkoutOrder(id);
      if (res && res.success) {
        // Rely on socket sync for status updates
        // fetchTables();
        const targetTable = allTables.find((t) => t.id === id);
        if (targetTable) {
          const isTakeaway = isTWTable(targetTable) || targetTable.DiningSection === 4 || activeTab === "TAKEAWAY";
          const section = isTakeaway ? "TAKEAWAY" : getSectionFromDiningSection(targetTable.DiningSection);
          setOrderContext(
            isTakeaway
              ? {
                  orderType: "TAKEAWAY",
                  section: "TAKEAWAY",
                  takeawayNo: targetTable.label,
                  tableId: id,
                }
              : {
                  orderType: "DINE_IN",
                  section: section,
                  tableNo: targetTable.label,
                  tableId: id,
                }
          );
          if (checkoutFlowEnabled) {
            const checkoutSection = section; // section is already computed above
            clearOrderContext();
            router.replace({ pathname: "/(tabs)/category", params: { section: checkoutSection } });
          } else {
            router.push("/payment");
          }
        }
      }
    } catch (err) {
      console.error("Checkout flow error:", err);
    } finally {
      setIsCheckingOut(false);
    }
  };

  const handleCompleteOrder = async (id: string) => {
    if (isCompleting) return;

    const tableData = useTableStatusStore.getState().tableMap[id];
    const effectiveStatus =
      tableData && tableData.status !== "EMPTY"
        ? tableData.status === "SENT"
          ? 1
          : tableData.status === "BILL_REQUESTED"
            ? 2
            : tableData.status === "HOLD"
              ? 3
              : tableData.status === "LOCKED"
                ? 5
                : 1
        : 0;

    if (effectiveStatus !== 2) return;

    setIsCompleting(true);
    try {
      const res = await (useCartStore.getState() as any).completeOrder(id);
      if (res && res.success) {
        // Rely on socket sync for status updates
        // fetchTables();
        useActiveOrdersStore.getState().fetchActiveKitchenOrders();
        showToast({
          type: "success",
          message: "Completed",
          subtitle: "Table is now available.",
        });
      }
    } catch (err) {
      console.error("Complete flow error:", err);
    } finally {
      setIsCompleting(false);
    }
  };

  const handleHold = (id: string) => updateTableStatus(id, 3); // Hold
  const handleReserved = (id: string, name: string) =>
    updateTableStatus(id, 5, name); // Reserved (Use 5 for red locked/reserved state)
  const handleComplete = (id: string) => updateTableStatus(id, 0); // Available

  const handleTablePress = React.useCallback(
    async (item: TableItem, tableData: any, isCheckoutAction?: boolean) => {
      // Check if user license is expired (skip for waiter)
      const userLicenseToDate = user?.licenseToDate || companyInfo?.LicenseToDate;
      if (user?.role !== "WAITER" && userLicenseToDate) {
        const today = new Date();
        const licDate = new Date(userLicenseToDate);
        today.setHours(0, 0, 0, 0);
        licDate.setHours(0, 0, 0, 0);
        if (today > licDate) {
          showToast({
            type: "error",
            message: "License Expired",
            subtitle: "Your POS license has expired. Please contact administrator.",
          });
          return;
        }
      }

      if (!isDayStarted) {
        showToast({
          type: "warning",
          message: "Day Not Started",
          subtitle: "Please select a date and click Start Day first.",
        });
        return;
      }

      // 🌹 PAID QR TABLE: Block entry — table is paid and waiting for kitchen to serve
      const tablePaymentStatus =
        (tableData as any)?.paymentStatus !== undefined
          ? Number((tableData as any).paymentStatus)
          : Number(item.paymentStatus) || 0;
      const tableEntryStatus =
        tableData?.entryStatus !== undefined
          ? tableData.entryStatus
          : item.entryStatus;
      if (tableEntryStatus === "q" && tablePaymentStatus === 1) {
        Alert.alert(
          "Order Already Paid",
          `Table ${item.label} order has been paid. What would you like to do?`,
          [
            {
              text: "Clear Table (Reset)",
              style: "destructive",
              onPress: async () => {
                await updateTableStatus(item.id, 0);
                (useCartStore.getState() as any).clearTableSession(item.id);
                showToast({
                  type: "success",
                  message: "Table Cleared",
                  subtitle: `Table ${item.label} has been reset.`,
                });
              },
            },
            {
              text: "Go to KDS",
              onPress: () => {
                router.push("/kds" as any);
              },
            },
            {
              text: "Cancel",
              style: "cancel",
            },
          ]
        );
        return;
      }

      const isTakeawayTable = isTWTable(item) || item.DiningSection === 4 || activeTab === "TAKEAWAY";

      // 🚀 RESTORE FLOW: If there is a live terminal session for this table, bypass all
      // popups and route directly to /payment so staff can monitor the ongoing transaction.
      const activeTerminalSession = useTerminalPaymentStore.getState().getSession(item.id);
      // Only use the explicit toggle flag — NOT session.isSplit, which persists after terminal resolves
      const isSplitPersisted = useTerminalPaymentStore.getState().activeSplitTables[item.id] === true;
      if (
        (activeTerminalSession && (activeTerminalSession.status === "processing" || activeTerminalSession.status === "cancelled" || activeTerminalSession.status === "failed")) ||
        isSplitPersisted
      ) {
        const section = isTakeawayTable ? "TAKEAWAY" : getSectionFromDiningSection(item.DiningSection);
        setOrderContext(
          isTakeawayTable
            ? {
                orderType: "TAKEAWAY",
                section: "TAKEAWAY",
                takeawayNo: item.label,
                tableId: item.id,
              }
            : {
                orderType: "DINE_IN",
                section,
                tableNo: item.label,
                tableId: item.id,
              }
        );
        router.push({
          pathname: "/payment",
          params: isSplitPersisted ? { isSplit: "true" } : {},
        });
        return;
      }

      const effectiveStatus =
        tableData && tableData.status !== "EMPTY"
          ? tableData.status === "SENT"
            ? 1
            : tableData.status === "BILL_REQUESTED"
              ? 2
              : tableData.status === "HOLD"
                ? 3
                : tableData.status === "LOCKED"
                  ? 5
                  : 1
          : Number(item.Status);

      if (isCheckoutAction) {
        if (effectiveStatus !== 2) {
          handleCheckout(item.id);
          return;
        }
        // For status 2 (Checkout), clicking "PAY" now follows the regular cart flow
      }

      const status = effectiveStatus;

      if (status === 1 || status === 2 || status === 3 || status === 4) {
        // For occupied tables, set context and go to summary/menu
        const section = isTakeawayTable ? "TAKEAWAY" : getSectionFromDiningSection(item.DiningSection);
        const existingContext: OrderContext = isTakeawayTable
          ? {
              orderType: "TAKEAWAY",
              section: "TAKEAWAY",
              takeawayNo: item.label,
              tableId: item.id,
              status: status === 2 ? "BILL_REQUESTED" : status === 3 ? "HOLD" : status === 1 ? "SENT" : undefined,
            }
          : {
              orderType: "DINE_IN",
              section: section,
              tableNo: item.label,
              tableId: item.id,
              status: status === 2 ? "BILL_REQUESTED" : status === 3 ? "HOLD" : status === 1 ? "SENT" : undefined,
            };
        setOrderContext(existingContext);
        const contextId = getContextId(existingContext);
        if (contextId) {
          setCurrentContext(contextId);
        }
        try {
          await fetchCartFromDBGlobal(item.id, true);
        } catch (err) {
          console.error(
            "❌ [Category] Failed to fetch occupied table cart:",
            err,
          );
        }

        // Check if there is a saved screen for this table
        const { useTableNavigationStore } = require("../../stores/tableNavigationStore");
        const tableIdStr = item.id ? String(item.id) : "";
        const lastScreen = tableIdStr ? useTableNavigationStore.getState().tableScreens[tableIdStr] : null;

        const tableCartItems = contextId ? useCartStore.getState().carts[contextId] || [] : [];
        const terminalSession = tableIdStr ? useTerminalPaymentStore.getState().sessions[tableIdStr] : undefined;

        if (lastScreen === "payment") {
          if (tableCartItems.length > 0 || (terminalSession && terminalSession.status === "processing")) {
            router.push("/payment");
          } else {
            if (tableIdStr) {
              useTableNavigationStore.getState().clearTableLastScreen(tableIdStr);
              useTableNavigationStore.getState().clearSelectedMethod(tableIdStr);
            }
            router.push("/menu/thai_kitchen");
          }
        } else if (lastScreen === "summary") {
          router.push("/summary");
        } else {
          router.push("/menu/thai_kitchen");
        }
        return;
      }

      if (status === 5) {
        Alert.alert(
          "Table Locked",
          `Table ${item.label} is reserved. What would you like to do?`,
          [
            {
              text: "Unlock Table",
              style: "destructive",
              onPress: () => handleComplete(item.id),
            },
            {
              text: "Go to Lock Tables",
              onPress: () => router.push("/locked-tables"),
            },
            { text: "Cancel", style: "cancel" },
          ],
        );
        return;
      }

      if (status === 0) {
        if (enableGuestDetailsPopup) {
          // Intercept empty table tap to show Guest Name & Pax popup
          setGuestNameInput("");
          setGuestPaxInput("");
          setPendingGuestItem(item);
          setGuestModalVisible(true);
          return;
        } else {
          // Skip the popup completely and go directly to the order screen when a table is selected.
          await proceedWithTable(item, tableData);
          return;
        }
      }

      await proceedWithTable(item, tableData);
    },
    [
      activeTab,
      router,
      isWaiter,
      enableGuestDetailsPopup,
      selectedBusinessDate,
      isDayStarted,
      companyInfo,
    ],
  );

  const proceedWithTable = async (item: TableItem, tableData: any) => {
    const effectiveStatus =
      tableData && tableData.status !== "EMPTY"
        ? tableData.status === "SENT"
          ? 1
          : tableData.status === "BILL_REQUESTED"
            ? 2
            : tableData.status === "HOLD"
              ? 3
              : tableData.status === "LOCKED"
                ? 5
                : 1
        : Number(item.Status);
    const status = effectiveStatus;

    let newContext: any;
    const computedStatus = status === 2 ? "BILL_REQUESTED" : status === 3 ? "HOLD" : status === 1 ? "SENT" : undefined;
    const isTakeaway = isTWTable(item) || item.DiningSection === 4 || activeTab === "TAKEAWAY";
    if (!isTakeaway) {
      newContext = {
        orderType: "DINE_IN" as const,
        section: activeTab,
        tableNo: item.label,
        tableId: item.id,
        status: computedStatus,
      };
    } else {
      newContext = {
        orderType: "TAKEAWAY" as const,
        section: "TAKEAWAY",
        takeawayNo: item.label,
        tableId: item.id,
        status: computedStatus,
      };
    }

    setOrderContext(newContext);
    const contextId = getContextId(newContext);
    if (contextId) {
      setCurrentContext(contextId);
      // 🚀 BUG FIX: If table is empty, clear local cart immediately to prevent "popping" stale data
      if (status === 0) {
        setCartItemsGlobal(contextId, [], true); // skipSync=true to avoid double sync
        try {
          const { useTableNavigationStore } = require("../../stores/tableNavigationStore");
          if (newContext.tableId) {
            useTableNavigationStore.getState().clearTableLastScreen(newContext.tableId);
          }
        } catch (err) {
          console.warn("Failed to clear table navigation state:", err);
        }
      }
    }

    if (newContext.tableId) {
      try {
        await fetchCartFromDBGlobal(newContext.tableId, true);
      } catch (err) {
        console.error("❌ [Category] Failed to fetch shared cart:", err);
      }
    } else if (tableData && tableData.status === "HOLD") {
      const helds = getHeldOrders();
      const held = helds.find((h: any) => h.orderId === tableData.orderId);
      if (held && contextId) {
        setCartItemsGlobal(contextId, held.cart);
      }
    }

    // Check if there is a saved screen for this table
    const { useTableNavigationStore } = require("../../stores/tableNavigationStore");
    const tableIdStr = newContext.tableId ? String(newContext.tableId) : "";
    const lastScreen = tableIdStr ? useTableNavigationStore.getState().tableScreens[tableIdStr] : null;

    const tableCartItems = contextId ? useCartStore.getState().carts[contextId] || [] : [];
    const terminalSession = tableIdStr ? useTerminalPaymentStore.getState().sessions[tableIdStr] : undefined;

    if (lastScreen === "payment") {
      if (status !== 0 && (tableCartItems.length > 0 || (terminalSession && terminalSession.status === "processing"))) {
        router.push("/payment");
      } else {
        if (tableIdStr) {
          useTableNavigationStore.getState().clearTableLastScreen(tableIdStr);
          useTableNavigationStore.getState().clearSelectedMethod(tableIdStr);
        }
        router.push("/menu/thai_kitchen");
      }
    } else if (lastScreen === "summary" && status !== 0) {
      router.push("/summary");
    } else {
      if (tableIdStr && status === 0) {
        useTableNavigationStore.getState().clearTableLastScreen(tableIdStr);
        useTableNavigationStore.getState().clearSelectedMethod(tableIdStr);
      }
      router.push("/menu/thai_kitchen");
    }
  };

  const handleGuestSubmit = async () => {
    if (!pendingGuestItem) return;
    setIsSavingGuest(true);
    try {
      const cleanName = guestNameInput.trim().substring(0, 9);
      const cleanPax = guestPaxInput.trim()
        ? parseInt(guestPaxInput.trim())
        : null;

      // Track this table for potential cleanup if user exits without adding items
      lastGuestOpenedTable = {
        tableId: pendingGuestItem.id,
        customerName: cleanName || null,
        pax: cleanPax || null,
      };

      const res = await fetch(`${API_URL}/api/tables/save-guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: pendingGuestItem.id,
          customerName: cleanName || null,
          pax: cleanPax || null,
          userId: user?.userId,
        }),
      });

      if (res.ok) {
        // Optimistically update table status store
        const section = getSectionFromDiningSection(
          pendingGuestItem.DiningSection,
        );
        useTableStatusStore
          .getState()
          .updateTableStatus(
            pendingGuestItem.id,
            section,
            pendingGuestItem.label,
            "EMPTY",
            "EMPTY",
            undefined,
            undefined,
            0,
            false,
            false,
            undefined,
            undefined,
            cleanName || undefined,
            cleanPax || undefined,
          );
        fetchTables();
      } else {
        const errData = await res.json();
        console.warn("Error saving guest:", errData.error);
      }
    } catch (err) {
      console.warn("Network error saving guest:", err);
    } finally {
      setIsSavingGuest(false);
      setGuestModalVisible(false);
      const itemToOpen = pendingGuestItem;
      setPendingGuestItem(null);
      // Proceed to menu selection
      proceedWithTable(itemToOpen, null);
    }
  };

  // ──── Move Table handler ──────────────────────────────────────────────────
  const handleMoveTable = async () => {
    if (!moveSourceTable || !moveDestTable) return;
    if (isMovingTable) return;
    setIsMovingTable(true);
    try {
      const res = await fetch(`${API_URL}/api/tables/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceTableId: moveSourceTable.id,
          destTableId: moveDestTable.id,
          userId: user?.userId,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        // Optimistic: clear source cart context in store
        const srcSection = getSectionFromDiningSection(
          moveSourceTable.DiningSection,
        );
        const dstSection = getSectionFromDiningSection(
          moveDestTable.DiningSection,
        );

        // Update local state (allTables) optimistically
        setAllTables((prev: TableItem[]) =>
          prev.map((t: TableItem) => {
            if (t.id === moveSourceTable.id) {
              return {
                ...t,
                Status: 0,
                totalAmount: 0,
                currentOrderId: undefined,
                customerName: undefined,
                pax: undefined,
              };
            }
            if (t.id === moveDestTable.id) {
              return {
                ...t,
                Status: moveSourceTable.Status,
                totalAmount:
                  data.totalAmount || moveSourceTable.totalAmount || 0,
                currentOrderId: data.orderId || moveSourceTable.currentOrderId,
                customerName: moveSourceTable.customerName,
                pax: moveSourceTable.pax,
              };
            }
            return t;
          }),
        );

        // Update tableStatusStore for source → Available
        useTableStatusStore
          .getState()
          .updateTableStatus(
            moveSourceTable.id,
            srcSection,
            moveSourceTable.label,
            "SYNC",
            "EMPTY",
            undefined,
            undefined,
            0,
            false,
            false,
            undefined,
            undefined,
            null as any,
            null as any,
          );

        // Update tableStatusStore for destination → copy source status
        const srcStatusType: TableStatusType =
          moveSourceTable.Status === 5
            ? "LOCKED"
            : moveSourceTable.Status === 1
              ? "SENT"
              : moveSourceTable.Status === 2
                ? "BILL_REQUESTED"
                : moveSourceTable.Status === 3
                  ? "HOLD"
                  : "EMPTY";
        useTableStatusStore
          .getState()
          .updateTableStatus(
            moveDestTable.id,
            dstSection,
            moveDestTable.label,
            data.orderId || "SYNC",
            srcStatusType,
            undefined,
            undefined,
            data.totalAmount || moveSourceTable.totalAmount || 0,
          );

        // Clear cart store for source context
        const srcContext = {
          orderType: "DINE_IN" as const,
          section: srcSection,
          tableNo: moveSourceTable.label,
          tableId: moveSourceTable.id,
        };
        const srcContextId = getContextId(srcContext);
        if (srcContextId) setCartItemsGlobal(srcContextId, [], true);

        setIsMoveTableVisible(false);
        setMoveSourceTable(null);
        setMoveDestTable(null);
        setMoveStep("source");
        setMoveSearchQuery("");

        showToast({
          type: "success",
          message: "Table Moved",
          subtitle: `Table ${data.sourceTableNo} → Table ${data.destTableNo} ✓`,
        });
        fetchTables();
      } else {
        showToast({
          type: "error",
          message: "Move Failed",
          subtitle: data.error || "Could not move the table.",
        });
      }
    } catch (err) {
      showToast({
        type: "error",
        message: "Network Error",
        subtitle: "Failed to connect to server.",
      });
    } finally {
      setIsMovingTable(false);
    }
  };

  // 🚀 Memoized Render Function for Table Grid

  // 🚀 Memoized Render Function for Table Grid
  const renderItem = React.useCallback(
    ({ item }: { item: TableItem }) => {
      return (
        <TableItemComponent
          tableId={item.id}
          item={item}
          itemSize={itemSize}
          activeTab={activeTab}
          onPress={handleTablePress}
          numberFont={numberFont}
          smallFont={smallFont}
          isTabletPortrait={!isLandscape && isTablet}
          backgroundTheme={backgroundTheme}
        />
      );
    },
    [
      itemSize,
      activeTab,
      handleTablePress,
      numberFont,
      smallFont,
      width,
      height,
      backgroundTheme,
    ],
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" backgroundColor={Theme.bgNav} />
        {/* Placeholder Nav Bar */}
        <View style={styles.topNavContainer}>
          <Skeleton
            width={120}
            height={32}
            borderRadius={16}
            style={{ marginLeft: 20 }}
          />
          <View style={{ flex: 1 }} />
          <Skeleton
            width={40}
            height={40}
            borderRadius={20}
            style={{ marginRight: 20 }}
          />
        </View>
        <TableGridSkeleton
          itemSize={itemSize}
          columns={columns}
          gap={GAP}
          padding={PADDING}
          insets={insets}
        />
      </SafeAreaView>
    );
  }
  const renderLicenseSection = () => {
    if (user?.role === "WAITER") {
      return null;
    }
    const fromDateStr = user?.licenseFromDate || companyInfo?.LicenseFromDate;
    const toDateStr = user?.licenseToDate || companyInfo?.LicenseToDate;
    const fromDate = fromDateStr ? String(fromDateStr).split("T")[0] : "2026-06-01";
    const toDate = toDateStr ? String(toDateStr).split("T")[0] : "2028-07-28";
    const isExpired = toDateStr ? new Date(toDateStr).getTime() < Date.now() : false;

    const companyName = companyInfo?.CompanyName || "My Restaurant";
    const address = companyInfo?.Address || "123 ABC SINGAPORE";

    return (
      <LinearGradient
        colors={["#FF7A00", "#FFA959", "#FED7AA", "#FF7A00"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.licCardWrapperGradient}
      >
        <View style={styles.licCardInnerWhite}>
          {/* Subtle warm tint wave in top corner */}
          <LinearGradient
            colors={["rgba(255, 122, 0, 0.12)", "rgba(255, 169, 89, 0.04)", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0.6, y: 0.6 }}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />

          {/* Top Row: Logo + Restaurant Info + ACTIVE Badge */}
          <View style={styles.licTopRow}>
            <View style={styles.licLogoContainer}>
              {companyInfo?.CompanyLogoUrl ? (
                <Image
                  source={{ uri: companyInfo.CompanyLogoUrl }}
                  style={styles.licLogoImage}
                  contentFit="contain"
                />
              ) : (
                <Image
                  source={require("../../assets/images/logo_pos.png")}
                  style={styles.licLogoImage}
                  contentFit="contain"
                />
              )}
            </View>

            <View style={styles.licInfoGroup}>
              <Text style={styles.licTitleText} numberOfLines={1}>
                {companyName}
              </Text>
              <View style={styles.licAddressGroup}>
                <Ionicons name="location-sharp" size={10} color="#64748B" />
                <Text style={styles.licAddressText} numberOfLines={1}>
                  {address}
                </Text>
              </View>
            </View>

            <View
              style={[
                styles.licActiveBadge,
                {
                  backgroundColor: isExpired ? "#FEE2E2" : "#E8FDF0",
                  borderColor: isExpired ? "#FCA5A5" : "#A7F3D0",
                },
              ]}
            >
              <View
                style={[
                  styles.licActiveDot,
                  { backgroundColor: isExpired ? "#DC2626" : "#16A34A" },
                ]}
              />
              <Text
                style={[
                  styles.licActiveText,
                  { color: isExpired ? "#DC2626" : "#16A34A" },
                ]}
              >
                {isExpired ? "EXPIRED" : "ACTIVE"}
              </Text>
            </View>
          </View>

          {/* Middle Row: Compact Validity Capsule */}
          <View style={styles.licMiddleCapsule}>
            <View style={styles.licCapsuleCol}>
              <Ionicons name="calendar-outline" size={12} color="#FF7A00" />
              <View>
                <Text style={styles.licCapsuleSub}>Valid From</Text>
                <Text style={styles.licCapsuleDate}>{fromDate}</Text>
              </View>
            </View>

            <Ionicons name="arrow-forward" size={10} color="#CBD5E1" />

            <View style={styles.licCapsuleCol}>
              <Ionicons name="calendar" size={12} color="#16A34A" />
              <View>
                <Text style={styles.licCapsuleSub}>Valid Until</Text>
                <Text style={styles.licCapsuleDate}>{toDate}</Text>
              </View>
            </View>
          </View>

          {/* Footer: Copyright */}
          <View style={styles.licFooterRow}>
            <Text style={styles.licFooterCopyright} numberOfLines={1}>
              © {new Date().getFullYear()} UNIPRO POS. All rights reserved.
            </Text>
          </View>
        </View>
      </LinearGradient>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Theme.bgNav} />

      {/* 〰〰〰〰〰〰〰〰〰〰〰 TOP NAV BAR 〰〰〰〰〰〰〰〰〰〰〰 */}
      {!isTablet ? (
        // --- MOBILE HEADER (TWO ROWS) ---
        <View
          style={{
            backgroundColor: Theme.bgNav,
            borderBottomWidth: 1,
            borderBottomColor: Theme.border,
            paddingBottom: 6,
          }}
        >
          {/* Row 1: Section Tabs & Menu Button */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 12,
              paddingVertical: 6,
              gap: 8,
            }}
          >
            {settings?.enableQuickServe !== false && (
              <QSButton
                size={32}
                onPress={() => {
                  if (user?.role === "WAITER") {
                    showToast({
                      type: "warning",
                      message: "Access Restricted",
                      subtitle: "Quick Serve is not allowed for Waiters.",
                    });
                    return;
                  }
                  router.push("/quick-serve" as any);
                }}
              />
            )}
            <ScrollView
              ref={sectionScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ alignItems: "center" }}
              style={{ flex: 1 }}
            >
              <View style={[styles.tabsWrapper, { gap: width < 380 ? 4 : 5 }]}>
                {visibleSections.map((section) => {
                  const isActive = activeTab === section;
                  const sectionTables = getSectionTables(section, allTables);
                  const occupied = sectionTables.filter((t: TableItem) => {
                    const tableData = tableMap[t.id];
                    const status = tableData
                      ? (tableData.status === "SENT"
                        ? 1
                        : tableData.status === "BILL_REQUESTED"
                          ? 2
                          : tableData.status === "HOLD"
                            ? 3
                            : tableData.status === "LOCKED"
                              ? 5
                              : 0)
                      : Number(t.Status);
                    return status !== 0;
                  }).length;

                  return (
                    <TouchableOpacity
                      key={section}
                      onPress={() => {
                        setActiveTab(section);
                        setActiveSectionStore(section);
                      }}
                      activeOpacity={0.75}
                      style={[
                        styles.tabBtn,
                        isActive && styles.activeTabBtn,
                        {
                          paddingVertical: 5,
                          paddingHorizontal: width < 380 ? 8 : 10,
                        },
                      ]}
                    >
                      <Ionicons
                        name={SECTION_ICONS[section] as any}
                        size={12}
                        color={isActive ? "#fff" : Theme.textSecondary}
                        style={{ marginRight: 4 }}
                      />
                      <Text
                        style={[
                          styles.tabText,
                          isActive && styles.activeTabText,
                          { fontSize: 12, fontFamily: Fonts.bold },
                        ]}
                      >
                        {getResponsiveSectionLabel(section, true)}
                      </Text>
                      {occupied > 0 && (
                        <View
                          style={[
                            styles.tabBadge,
                            isActive && styles.activeTabBadge,
                            { marginLeft: 4, height: 16, minWidth: 16 },
                          ]}
                        >
                          <Text
                            style={[
                              styles.tabBadgeText,
                              isActive && styles.activeTabBadgeText,
                              { fontSize: 9 },
                            ]}
                          >
                            {occupied}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          {/* Row 2: Date Picker, Day Start, and Status Buttons */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 12,
              paddingTop: 4,
            }}
          >
            {/* Date & Day Start Unified Button (Design 1 - Modern Green) */}
            <BusinessDatePill
              date={selectedBusinessDate}
              isDayStarted={isDayStarted}
              isStartingDay={isStartingDay}
              onPress={() => {
                if (!isDayStarted) {
                  setModalSelectedDate(getSingaporeDateString());
                  setShowBusinessCalendar(true);
                }
              }}
              compact
            />

            {/* Right side status icons */}
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
            >
              {enableKDS && (
                <TouchableOpacity
                  style={[
                    styles.headerActionBtn,
                    {
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      position: "relative",
                    },
                  ]}
                  onPress={() => router.push("/kitchen-status")}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name="restaurant-outline"
                    size={18}
                    color={Theme.success}
                  />
                  {readyItemsCount > 0 && (
                    <View
                      style={{
                        position: "absolute",
                        top: -4,
                        right: -4,
                        backgroundColor: Theme.danger || "#ef4444",
                        borderRadius: 8,
                        minWidth: 16,
                        height: 16,
                        justifyContent: "center",
                        alignItems: "center",
                        paddingHorizontal: 3,
                        borderWidth: 1,
                        borderColor: "#FFF",
                      }}
                    >
                      <Text
                        style={{
                          color: "#fff",
                          fontSize: 8,
                          fontFamily: Fonts.black || "System",
                          lineHeight: 10,
                          textAlign: "center",
                        }}
                      >
                        {readyItemsCount}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              )}

              {canAccessKDS() && enableKDS && (
                <TouchableOpacity
                  style={[
                    styles.headerActionBtn,
                    { paddingHorizontal: 10, paddingVertical: 6 },
                  ]}
                  onPress={() => router.push("/kds" as any)}
                  activeOpacity={0.75}
                >
                  <Ionicons name="tv-outline" size={18} color={Theme.info} />
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[
                  styles.headerActionBtn,
                  { paddingHorizontal: 10, paddingVertical: 6 },
                ]}
                onPress={() => setIsNotifModalVisible(true)}
                activeOpacity={0.75}
              >
                <View style={{ position: "relative" }}>
                  <Ionicons name="notifications-outline" size={18} color={Theme.primary} />
                  {unreadCount > 0 && (
                    <View style={{
                      position: "absolute",
                      top: -6,
                      right: -6,
                      backgroundColor: Theme.danger || "#ef4444",
                      borderRadius: 7,
                      minWidth: 14,
                      height: 14,
                      justifyContent: "center",
                      alignItems: "center",
                      borderWidth: 1,
                      borderColor: "#FFF",
                    }}>
                      <Text style={{ color: "#fff", fontSize: 8, fontFamily: Fonts.bold }}>
                        {unreadCount}
                      </Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>

              <WindowControls buttonStyle={{ height: 32, width: 32, borderRadius: 8 }} iconSize={16} hideHome={true} />

              <TouchableOpacity
                style={[
                  styles.headerActionBtn,
                  {
                    backgroundColor: Theme.primaryLight,
                    borderColor: Theme.primaryBorder,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                  },
                ]}
                onPress={() => setIsMenuVisible(true)}
                activeOpacity={0.75}
              >
                <Ionicons name="menu-outline" size={20} color={Theme.primary} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (width < 1280 || Platform.OS === "android" || Platform.OS === "ios" || !isWindows) ? (
        // --- TABLET / TOUCH HEADER (TWO ROWS MATCHING REFERENCE DESIGN) ---
        <View
          style={{
            backgroundColor: Theme.bgNav,
            borderBottomWidth: 1,
            borderBottomColor: Theme.border,
            paddingBottom: 8,
            ...Theme.shadowSm,
          }}
        >
          {/* Row 1: Left = POS Logo & Wordmark, Right = Date & Day Started */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: isTablet ? 16 : 12,
              paddingTop: 8,
              paddingBottom: 6,
            }}
          >
            {/* Left: POS Logo + Wordmark */}
            <POSBrand
              onPress={() => {
                if (user?.role === "WAITER") {
                  showToast({
                    type: "warning",
                    message: "Access Restricted",
                    subtitle: "Quick Serve is not allowed for Waiters.",
                  });
                  return;
                }
                router.push("/quick-serve" as any);
              }}
            />

            {/* Right: Date & Day Start Unified Button (Design 1 - Modern Green) */}
            <BusinessDatePill
              date={selectedBusinessDate}
              isDayStarted={isDayStarted}
              isStartingDay={isStartingDay}
              onPress={() => {
                if (!isDayStarted) {
                  setModalSelectedDate(getSingaporeDateString());
                  setShowBusinessCalendar(true);
                }
              }}
            />
          </View>

          {/* Row 2: Left = Section Tabs (SEC-1, SEC-2, SEC-3, TW), Right = Action Icons */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: isTablet ? 16 : 12,
              paddingTop: 4,
            }}
          >
            {/* Left: Section Tabs */}
            <ScrollView
              ref={sectionScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ alignItems: "center" }}
              style={{ flex: 1, marginRight: 8 }}
            >
              <View style={[styles.tabsWrapper, { gap: 6 }]}>
                {visibleSections.map((section) => {
                  const isActive = activeTab === section;
                  const sectionTables = getSectionTables(section, allTables);
                  const occupied = sectionTables.filter((t: TableItem) => {
                    const tableData = tableMap[t.id];
                    const status = tableData
                      ? tableData.status === "SENT"
                        ? 1
                        : tableData.status === "BILL_REQUESTED"
                          ? 2
                          : tableData.status === "HOLD"
                            ? 3
                            : tableData.status === "LOCKED"
                              ? 5
                              : 0
                      : Number(t.Status);
                    return status !== 0;
                  }).length;

                  return (
                    <TouchableOpacity
                      key={section}
                      onPress={() => {
                        setActiveTab(section);
                        setActiveSectionStore(section);
                      }}
                      activeOpacity={0.75}
                      style={[
                        styles.tabBtn,
                        isActive && styles.activeTabBtn,
                        { paddingVertical: 6, paddingHorizontal: 12 },
                      ]}
                    >
                      <Ionicons
                        name={SECTION_ICONS[section] as any}
                        size={14}
                        color={isActive ? "#fff" : Theme.textSecondary}
                        style={{ marginRight: 5 }}
                      />
                      <Text
                        style={[
                          styles.tabText,
                          isActive && styles.activeTabText,
                          { fontSize: 13, fontFamily: Fonts.bold },
                        ]}
                      >
                        {getResponsiveSectionLabel(section, false)}
                      </Text>
                      {occupied > 0 && (
                        <View
                          style={[
                            styles.tabBadge,
                            isActive && styles.activeTabBadge,
                            { marginLeft: 6, height: 18, minWidth: 18, paddingHorizontal: 4, borderRadius: 9 },
                          ]}
                        >
                          <Text
                            style={[
                              styles.tabBadgeText,
                              isActive && styles.activeTabBadgeText,
                              { fontSize: 10 },
                            ]}
                          >
                            {occupied}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>

            {/* Right: Kitchen Status, KDS, Notifications, WindowControls, Menu */}
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}
            >
              {/* Kitchen Status / Serve */}
              {enableKDS && (
                <TouchableOpacity
                  style={[
                    styles.headerActionBtn,
                    {
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      position: "relative",
                    },
                  ]}
                  onPress={() => router.push("/kitchen-status")}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name="restaurant-outline"
                    size={18}
                    color={Theme.success}
                  />
                  {readyItemsCount > 0 && (
                    <View
                      style={{
                        position: "absolute",
                        top: -4,
                        right: -4,
                        backgroundColor: Theme.danger || "#ef4444",
                        borderRadius: 8,
                        minWidth: 16,
                        height: 16,
                        justifyContent: "center",
                        alignItems: "center",
                        paddingHorizontal: 3,
                        borderWidth: 1,
                        borderColor: "#FFF",
                      }}
                    >
                      <Text
                        style={{
                          color: "#fff",
                          fontSize: 8,
                          fontFamily: Fonts.black || "System",
                          lineHeight: 10,
                          textAlign: "center",
                        }}
                      >
                        {readyItemsCount}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              )}

              {/* KDS */}
              {canAccessKDS() && enableKDS && (
                <TouchableOpacity
                  style={[
                    styles.headerActionBtn,
                    { paddingHorizontal: 10, paddingVertical: 6 },
                  ]}
                  onPress={() => router.push("/kds" as any)}
                  activeOpacity={0.75}
                >
                  <Ionicons name="tv-outline" size={18} color={Theme.info} />
                </TouchableOpacity>
              )}

              {/* Notifications */}
              <TouchableOpacity
                style={[
                  styles.headerActionBtn,
                  { paddingHorizontal: 10, paddingVertical: 6 },
                ]}
                onPress={() => setIsNotifModalVisible(true)}
                activeOpacity={0.75}
              >
                <View style={{ position: "relative" }}>
                  <Ionicons
                    name="notifications-outline"
                    size={18}
                    color={Theme.primary}
                  />
                  {unreadCount > 0 && (
                    <View
                      style={{
                        position: "absolute",
                        top: -6,
                        right: -6,
                        backgroundColor: Theme.danger || "#ef4444",
                        borderRadius: 7,
                        minWidth: 14,
                        height: 14,
                        justifyContent: "center",
                        alignItems: "center",
                        borderWidth: 1,
                        borderColor: "#FFF",
                      }}
                    >
                      <Text
                        style={{
                          color: "#fff",
                          fontSize: 8,
                          fontFamily: Fonts.bold,
                        }}
                      >
                        {unreadCount}
                      </Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>

              <WindowControls
                buttonStyle={{ height: 32, width: 32, borderRadius: 8 }}
                iconSize={16}
                hideHome={true}
              />

              {/* Menu */}
              <TouchableOpacity
                style={[
                  styles.headerActionBtn,
                  {
                    backgroundColor: Theme.primaryLight,
                    borderColor: Theme.primaryBorder,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                  },
                ]}
                onPress={() => setIsMenuVisible(true)}
                activeOpacity={0.75}
              >
                <Ionicons
                  name="menu-outline"
                  size={20}
                  color={Theme.primary}
                />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
        // --- LAPTOP/WINDOWS HEADER (SINGLE ROW) ---
        <View
          style={[
            styles.topNavContainer,
            { paddingHorizontal: isTablet ? 20 : 12 },
            !isTablet &&
            isLandscape && { height: 42, paddingVertical: 2, gap: 8 },
          ]}
        >
          {/* LEFT CORNER — Quick Serve Button */}
          {settings?.enableQuickServe !== false && (
            <QSButton
              size={36}
              onPress={() => {
                if (user?.role === "WAITER") {
                  showToast({
                    type: "warning",
                    message: "Access Restricted",
                    subtitle: "Quick Serve is not allowed for Waiters.",
                  });
                  return;
                }
                router.push("/quick-serve" as any);
              }}
            />
          )}

          {/* CENTER — Section Tabs */}
          <ScrollView
            ref={sectionScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsScrollContent}
            style={styles.tabsScrollView}
          >
            <View style={[styles.tabsWrapper, { gap: 6 }]}>
              {visibleSections.map((section) => {
                const isActive = activeTab === section;
                const sectionTables = getSectionTables(section, allTables);
                const occupied = sectionTables.filter((t: TableItem) => {
                  const tableData = tableMap[t.id];
                  const status = tableData
                    ? (tableData.status === "SENT"
                      ? 1
                      : tableData.status === "BILL_REQUESTED"
                        ? 2
                        : tableData.status === "HOLD"
                          ? 3
                          : tableData.status === "LOCKED"
                            ? 5
                            : 0)
                    : Number(t.Status);
                  return status !== 0;
                }).length;

                return (
                  <TouchableOpacity
                    key={section}
                    onPress={() => {
                      setActiveTab(section);
                      setActiveSectionStore(section);
                    }}
                    activeOpacity={0.75}
                    style={[
                      styles.tabBtn,
                      isActive && styles.activeTabBtn,
                      {
                        paddingVertical: 6,
                        paddingHorizontal: 12,
                      },
                    ]}
                  >
                    <Ionicons
                      name={SECTION_ICONS[section] as any}
                      size={14}
                      color={isActive ? "#fff" : Theme.textSecondary}
                      style={{ marginRight: 5 }}
                    />
                    <Text
                      style={[
                        styles.tabText,
                        isActive && styles.activeTabText,
                        { fontSize: 13, fontFamily: Fonts.bold },
                      ]}
                    >
                      {getResponsiveSectionLabel(section, width < 600)}
                    </Text>
                    {occupied > 0 && (
                      <View
                        style={[
                          styles.tabBadge,
                          isActive && styles.activeTabBadge,
                        ]}
                      >
                        <Text
                          style={[
                            styles.tabBadgeText,
                            isActive && styles.activeTabBadgeText,
                          ]}
                        >
                          {occupied}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          {/* DATE PICKER & DAY START UNIFIED BUTTON (Design 1 - Modern Green) */}
          <BusinessDatePill
            date={selectedBusinessDate}
            isDayStarted={isDayStarted}
            isStartingDay={isStartingDay}
            onPress={() => {
              if (!isDayStarted) {
                setModalSelectedDate(getSingaporeDateString());
                setShowBusinessCalendar(true);
              }
            }}
          />

          {/* RIGHT — Action Buttons */}
          <View style={[styles.navRightGroup, { gap: isTablet ? 8 : 6 }]}>
            {/* Kitchen Status — moved from menu */}
            {enableKDS && (
              <TouchableOpacity
                style={[styles.headerActionBtn, { position: "relative" }]}
                onPress={() => router.push("/kitchen-status")}
                activeOpacity={0.75}
              >
                <Ionicons
                  name="restaurant-outline"
                  size={20}
                  color={Theme.success}
                />
                {isTablet && isLandscape && (
                  <Text
                    style={[styles.headerActionText, { color: Theme.success }]}
                  >
                    Status
                  </Text>
                )}
                {readyItemsCount > 0 && (
                  <View
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -6,
                      backgroundColor: Theme.danger || "#ef4444",
                      borderRadius: 9,
                      minWidth: 18,
                      height: 18,
                      justifyContent: "center",
                      alignItems: "center",
                      paddingHorizontal: 4,
                      borderWidth: 1.5,
                      borderColor: "#FFF",
                      shadowColor: "#000",
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: 0.2,
                      shadowRadius: 1,
                      elevation: 2,
                    }}
                  >
                    <Text
                      style={{
                        color: "#fff",
                        fontSize: 9,
                        fontFamily: Fonts.black || "System",
                        lineHeight: 11,
                        textAlign: "center",
                      }}
                    >
                      {readyItemsCount}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            )}

            {/* KDS — gated by OPRSTK and General Settings */}
            {canAccessKDS() && enableKDS && (
              <TouchableOpacity
                style={styles.headerActionBtn}
                onPress={() => router.push("/kds" as any)}
                activeOpacity={0.75}
              >
                <Ionicons name="tv-outline" size={20} color={Theme.info} />
                {isTablet && isLandscape && (
                  <Text
                    style={[styles.headerActionText, { color: Theme.info }]}
                  >
                    KDS
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* Alerts/Notifications Button */}
            <TouchableOpacity
              style={[styles.headerActionBtn, { width: 40, height: 40, justifyContent: "center", paddingHorizontal: 0 }]}
              onPress={() => setIsNotifModalVisible(true)}
              activeOpacity={0.75}
            >
              <Ionicons name="notifications-outline" size={20} color={Theme.primary} />
              {unreadCount > 0 && (
                <View style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  backgroundColor: Theme.danger || "#ef4444",
                  borderRadius: 6,
                  minWidth: 12,
                  height: 12,
                  justifyContent: "center",
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: "#FFF",
                }} />
              )}
            </TouchableOpacity>

            <WindowControls buttonStyle={[styles.headerActionBtn, { width: 40, height: 40, justifyContent: "center", paddingHorizontal: 0 }]} iconSize={20} hideHome={true} />

            {/* NEW CONSOLIDATED MENU BUTTON */}
            <TouchableOpacity
              style={[
                styles.headerActionBtn,
                {
                  backgroundColor: Theme.primaryLight,
                  borderColor: Theme.primaryBorder,
                },
              ]}
              onPress={() => setIsMenuVisible(true)}
              activeOpacity={0.75}
            >
              <Ionicons name="menu-outline" size={24} color={Theme.primary} />
              {isTablet && (
                <Text
                  style={[styles.headerActionText, { color: Theme.primary }]}
                >
                  Menu
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* 〰〰〰〰〰〰〰〰〰〰〰 QR ORDER MODAL 〰〰〰〰〰〰〰〰〰〰〰 */}
      <Modal
        visible={isQRModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsQRModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={() => setIsQRModalVisible(false)}
        >
          <View
            style={[
              {
                backgroundColor: Theme.bgCard,
                padding: 32,
                borderRadius: Theme.radiusLg,
                alignItems: "center",
                justifyContent: "center",
                elevation: 10,
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.15,
                shadowRadius: 12,
              },
            ]}
          >
            <Text
              style={{
                fontSize: 22,
                fontWeight: "bold",
                color: Theme.textPrimary,
                marginBottom: 8,
              }}
            >
              QR Order
            </Text>
            <Text
              style={{
                fontSize: 14,
                color: Theme.textSecondary,
                marginBottom: 24,
                textAlign: "center",
              }}
            >
              Scan this code to view the menu and place orders.
            </Text>
            <View
              style={{ padding: 16, backgroundColor: "#fff", borderRadius: 8 }}
            >
              <QRCode
                value="https://example.com/menu"
                size={200}
                color="black"
                backgroundColor="white"
              />
            </View>
            <TouchableOpacity
              style={{
                marginTop: 24,
                paddingVertical: 12,
                paddingHorizontal: 24,
                backgroundColor: Theme.primary,
                borderRadius: Theme.radiusMd,
                width: "100%",
                alignItems: "center",
              }}
              onPress={() => setIsQRModalVisible(false)}
            >
              <Text style={{ color: "#fff", fontWeight: "bold", fontSize: 16 }}>
                Close
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 〰〰〰〰〰〰〰〰〰〰〰 MORE MENU MODAL 〰〰〰〰〰〰〰〰〰〰〰 */}
      <Modal
        visible={isMenuVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={() => setIsMenuVisible(false)}
        >
          <View
            style={[
              styles.menuContent,
              isTablet && { width: 300, right: 20 },
              { maxHeight: height * 0.9 },
            ]}
          >
            {/* User Info Header */}
            {user && (
              <LinearGradient
                colors={["#FFF8F3", "#FFF0E6"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.menuUserSectionGradient}
              >
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => setIsAvatarModalVisible(true)}
                  style={styles.menuAvatarWrapper}
                >
                  <View style={styles.menuAvatarContainer}>
                    {avatarUrl ? (
                      <Image
                        source={getAvatarSource(avatarUrl)}
                        style={{ width: "100%", height: "100%" }}
                        placeholder={require("../../assets/images/logo_pos.png")}
                      />
                    ) : (
                      <Ionicons name="person" size={22} color={Theme.primary} />
                    )}
                  </View>
                  <View style={styles.menuAvatarEditBadge}>
                    <Ionicons name="camera" size={9} color="#FFFFFF" />
                  </View>
                </TouchableOpacity>

                <View style={styles.menuUserInfo}>
                  <Text style={styles.menuUserNamePremium} numberOfLines={1}>
                    {user.fullName || user.userName || "UNIPRO"}
                  </Text>
                  <View style={styles.menuRoleBadge}>
                    <Ionicons name="shield-checkmark" size={11} color={Theme.primary} />
                    <Text style={styles.menuUserRolePremium}>
                      {user.roleName || user.role || "ADMIN"}
                    </Text>
                  </View>
                </View>
              </LinearGradient>
            )}

            <View style={styles.menuDivider} />

            {/* Menu Options */}
            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingBottom: 6 }}
              showsVerticalScrollIndicator={true}
            >
              {/* 1. Tables Dropdown */}
              <TouchableOpacity
                activeOpacity={0.7}
                style={[
                  styles.menuItem,
                  isTablesExpanded && {
                    backgroundColor: "#F3F4F6",
                    borderBottomLeftRadius: 0,
                    borderBottomRightRadius: 0,
                    borderBottomWidth: 0,
                  },
                ]}
                onPress={() => setIsTablesExpanded(!isTablesExpanded)}
              >
                <View
                  style={[
                    styles.menuIconContainer,
                    { backgroundColor: Theme.primary + "10" },
                  ]}
                >
                  <Ionicons
                    name="grid-outline"
                    size={18}
                    color={Theme.primary}
                  />
                </View>
                <Text style={[styles.menuItemText, { flex: 1 }]}>
                  Tables
                </Text>
                <Ionicons
                  name={
                    isTablesExpanded ? "chevron-down" : "chevron-forward"
                  }
                  size={18}
                  color={Theme.textSecondary}
                />
              </TouchableOpacity>

              {isTablesExpanded && (
                <View style={styles.subMenuContainer}>
                  {canAccessLockTables() && (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={styles.subMenuItem}
                      onPress={() => {
                        setIsMenuVisible(false);
                        router.push("/locked-tables");
                      }}
                    >
                      <View
                        style={[
                          styles.menuIconContainer,
                          { backgroundColor: Theme.warning + "10" },
                        ]}
                      >
                        <Ionicons
                          name="lock-closed-outline"
                          size={18}
                          color={Theme.warning}
                        />
                      </View>
                      <Text style={styles.subMenuItemText}>Locked Tables</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.subMenuItem}
                    onPress={() => {
                      setIsMenuVisible(false);
                      // Auto-select source step; pre-pick source if only one occupied table exists
                      const statusMap: Record<string, number> = {
                        EMPTY: 0,
                        SENT: 1,
                        BILL_REQUESTED: 2,
                        HOLD: 3,
                        LOCKED: 5,
                      };
                      const occupied = allTables
                        .map((t) => {
                          const sd = useTableStatusStore.getState().tableMap[t.id];
                          const freshStatus = sd ? statusMap[sd.status] : t.Status;
                          return {
                            ...t,
                            Status:
                              freshStatus !== undefined ? freshStatus : t.Status,
                          };
                        })
                        .filter((t) => [1, 2, 3].includes(Number(t.Status)));

                      if (occupied.length === 1) {
                        setMoveSourceTable(occupied[0]);
                        setMoveStep("dest");
                        setMoveActiveSection(
                          getSectionFromDiningSection(occupied[0].DiningSection),
                        );
                      } else {
                        setMoveSourceTable(null);
                        setMoveStep("source");
                      }
                      setMoveDestTable(null);
                      setMoveSearchQuery("");
                      setIsMoveTableVisible(true);
                    }}
                  >
                    <View
                      style={[
                        styles.menuIconContainer,
                        { backgroundColor: Theme.primaryLight },
                      ]}
                    >
                      <Ionicons
                        name="swap-horizontal-outline"
                        size={18}
                        color={Theme.primary}
                      />
                    </View>
                    <Text style={styles.subMenuItemText}>Transfer Table</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.subMenuItem}
                    onPress={() => {
                      setIsMenuVisible(false);
                      router.push("/table-master");
                    }}
                  >
                    <View
                      style={[
                        styles.menuIconContainer,
                        { backgroundColor: Theme.primary + "10" },
                      ]}
                    >
                      <Ionicons
                        name="create-outline"
                        size={18}
                        color={Theme.primary}
                      />
                    </View>
                    <Text style={styles.subMenuItemText}>Table Master</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* 2. Staff Dropdown */}
              <TouchableOpacity
                activeOpacity={0.7}
                style={[
                  styles.menuItem,
                  isStaffExpanded && {
                    backgroundColor: "#F3F4F6",
                    borderBottomLeftRadius: 0,
                    borderBottomRightRadius: 0,
                    borderBottomWidth: 0,
                  },
                ]}
                onPress={() => setIsStaffExpanded(!isStaffExpanded)}
              >
                <View
                  style={[
                    styles.menuIconContainer,
                    { backgroundColor: Theme.primary + "10" },
                  ]}
                >
                  <Ionicons
                    name="people-outline"
                    size={18}
                    color={Theme.primary}
                  />
                </View>
                <Text style={[styles.menuItemText, { flex: 1 }]}>
                  Staff
                </Text>
                <Ionicons
                  name={
                    isStaffExpanded ? "chevron-down" : "chevron-forward"
                  }
                  size={18}
                  color={Theme.textSecondary}
                />
              </TouchableOpacity>

              {isStaffExpanded && (
                <View style={styles.subMenuContainer}>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.subMenuItem}
                    onPress={() => {
                      setIsMenuVisible(false);
                      router.push("/waiters");
                    }}
                  >
                    <View
                      style={[
                        styles.menuIconContainer,
                        { backgroundColor: Theme.primary + "10" },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name="account-group"
                        size={18}
                        color={Theme.primary}
                      />
                    </View>
                    <Text style={styles.subMenuItemText}>Waiters</Text>
                  </TouchableOpacity>

                  {canAccessStaffAttendance() && (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={styles.subMenuItem}
                      onPress={() => {
                        setIsMenuVisible(false);
                        router.push("/StaffAttendance");
                      }}
                    >
                      <View
                        style={[
                          styles.menuIconContainer,
                          { backgroundColor: Theme.primary + "10" },
                        ]}
                      >
                        <MaterialCommunityIcons
                          name="calendar-clock"
                          size={18}
                          color={Theme.primary}
                        />
                      </View>
                      <Text style={styles.subMenuItemText}>Staff Attendance</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* 3. Customer Dropdown */}
              <TouchableOpacity
                activeOpacity={0.7}
                style={[
                  styles.menuItem,
                  isCustomerExpanded && {
                    backgroundColor: "#F3F4F6",
                    borderBottomLeftRadius: 0,
                    borderBottomRightRadius: 0,
                    borderBottomWidth: 0,
                  },
                ]}
                onPress={() => setIsCustomerExpanded(!isCustomerExpanded)}
              >
                <View
                  style={[
                    styles.menuIconContainer,
                    { backgroundColor: Theme.primary + "10" },
                  ]}
                >
                  <Ionicons
                    name="person-add-outline"
                    size={18}
                    color={Theme.primary}
                  />
                </View>
                <Text style={[styles.menuItemText, { flex: 1 }]}>
                  Customer
                </Text>
                <Ionicons
                  name={
                    isCustomerExpanded ? "chevron-down" : "chevron-forward"
                  }
                  size={18}
                  color={Theme.textSecondary}
                />
              </TouchableOpacity>

              {isCustomerExpanded && (
                <View style={styles.subMenuContainer}>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.subMenuItem}
                    onPress={() => {
                      setIsMenuVisible(false);
                      router.push("/loyalty");
                    }}
                  >
                    <View
                      style={[
                        styles.menuIconContainer,
                        { backgroundColor: "#16a34a15" },
                      ]}
                    >
                      <MaterialCommunityIcons
                        name="medal-outline"
                        size={18}
                        color="#16a34a"
                      />
                    </View>
                    <Text style={styles.subMenuItemText}>Loyalty</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.subMenuItem}
                    onPress={() => {
                      setIsMenuVisible(false);
                      router.push("/menu/rewardMaster");
                    }}
                  >
                    <View
                      style={[
                        styles.menuIconContainer,
                        { backgroundColor: Theme.primary + "10" },
                      ]}
                    >
                      <Ionicons
                        name="gift-outline"
                        size={18}
                        color={Theme.primary}
                      />
                    </View>
                    <Text style={styles.subMenuItemText}>Reward Points Master</Text>
                  </TouchableOpacity>

                  {canAccessMembers() && (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={styles.subMenuItem}
                      onPress={() => {
                        setIsMenuVisible(false);
                        router.push("/members");
                      }}
                    >
                      <View
                        style={[
                          styles.menuIconContainer,
                          { backgroundColor: Theme.info + "10" },
                        ]}
                      >
                        <Ionicons
                          name="people-outline"
                          size={18}
                          color={Theme.info}
                        />
                      </View>
                      <Text style={styles.subMenuItemText}>Members</Text>
                    </TouchableOpacity>
                  )}

                  {canAccessMembers() && (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={styles.subMenuItem}
                      onPress={() => {
                        setIsMenuVisible(false);
                        router.push("/receivables");
                      }}
                    >
                      <View
                        style={[
                          styles.menuIconContainer,
                          { backgroundColor: Theme.primary + "10" },
                        ]}
                      >
                        <Ionicons
                          name="wallet-outline"
                          size={18}
                          color={Theme.primary}
                        />
                      </View>
                      <Text style={styles.subMenuItemText}>Receivables</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* 4. Settlement */}
              {canAccessDayEnd() && (
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.menuItem}
                  onPress={() => {
                    setIsMenuVisible(false);
                    router.push("/menu/settlement");
                  }}
                >
                  <View
                    style={[
                      styles.menuIconContainer,
                      { backgroundColor: Theme.primary + "10" },
                    ]}
                  >
                    <Ionicons
                      name="calculator-outline"
                      size={18}
                      color={Theme.primary}
                    />
                  </View>
                  <Text style={styles.menuItemText}>Settlement</Text>
                </TouchableOpacity>
              )}

              {/* 5. Reports Dropdown */}
              {(canAccessSalesReport() || canAccessDayEnd()) && (
                <>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={[
                      styles.menuItem,
                      isReportsExpanded && {
                        backgroundColor: "#F3F4F6",
                        borderBottomLeftRadius: 0,
                        borderBottomRightRadius: 0,
                        borderBottomWidth: 0,
                      },
                    ]}
                    onPress={() => setIsReportsExpanded(!isReportsExpanded)}
                  >
                    <View
                      style={[
                        styles.menuIconContainer,
                        { backgroundColor: Theme.primary + "10" },
                      ]}
                    >
                      <Ionicons
                        name="document-text-outline"
                        size={18}
                        color={Theme.primary}
                      />
                    </View>
                    <Text style={[styles.menuItemText, { flex: 1 }]}>
                      Reports
                    </Text>
                    <Ionicons
                      name={
                        isReportsExpanded ? "chevron-down" : "chevron-forward"
                      }
                      size={18}
                      color={Theme.textSecondary}
                    />
                  </TouchableOpacity>

                  {isReportsExpanded && (
                    <View style={styles.subMenuContainer}>
                      {canAccessSalesReport() && (
                        <TouchableOpacity
                          activeOpacity={0.7}
                          style={styles.subMenuItem}
                          onPress={() => {
                            setIsMenuVisible(false);
                            router.push("/sales-report");
                          }}
                        >
                          <View
                            style={[
                              styles.menuIconContainer,
                              { backgroundColor: Theme.primary + "10" },
                            ]}
                          >
                            <Ionicons
                              name="bar-chart-outline"
                              size={18}
                              color={Theme.primary}
                            />
                          </View>
                          <Text style={styles.subMenuItemText}>Sales Report</Text>
                        </TouchableOpacity>
                      )}

                      {canAccessDayEnd() && (
                        <TouchableOpacity
                          activeOpacity={0.7}
                          style={styles.subMenuItem}
                          onPress={() => {
                            setIsMenuVisible(false);
                            router.push("/day-end");
                          }}
                        >
                          <View
                            style={[
                              styles.menuIconContainer,
                              { backgroundColor: Theme.warning + "10" },
                            ]}
                          >
                            <MaterialCommunityIcons
                              name="calendar-clock"
                              size={18}
                              color={Theme.warning}
                            />
                          </View>
                          <Text style={styles.subMenuItemText}>Day End Report</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </>
              )}

              {/* QR Codes Dropdown */}
              <TouchableOpacity
                activeOpacity={0.7}
                style={[
                  styles.menuItem,
                  isQrExpanded && {
                    backgroundColor: "#F3F4F6",
                    borderBottomLeftRadius: 0,
                    borderBottomRightRadius: 0,
                    borderBottomWidth: 0,
                  },
                ]}
                onPress={() => setIsQrExpanded(!isQrExpanded)}
              >
                <View
                  style={[
                    styles.menuIconContainer,
                    { backgroundColor: "#f9731615" },
                  ]}
                >
                  <Ionicons
                    name="qr-code-outline"
                    size={18}
                    color="#f97316"
                  />
                </View>
                <Text style={[styles.menuItemText, { flex: 1 }]}>
                  QR Codes
                </Text>
                <Ionicons
                  name={
                    isQrExpanded ? "chevron-down" : "chevron-forward"
                  }
                  size={18}
                  color={Theme.textSecondary}
                />
              </TouchableOpacity>

              {isQrExpanded && (
                <View style={styles.subMenuContainer}>
                  {/* Table QR Code */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.subMenuItem}
                    onPress={() => {
                      setIsMenuVisible(false);
                      router.push("/qr-generator" as any);
                    }}
                  >
                    <View
                      style={[
                        styles.menuIconContainer,
                        { backgroundColor: "#f9731615" },
                      ]}
                    >
                      <Ionicons name="grid-outline" size={18} color="#f97316" />
                    </View>
                    <Text style={styles.subMenuItemText}>Table QR Code</Text>
                  </TouchableOpacity>

                  {/* Qr for Takeaway */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.subMenuItem}
                    onPress={() => {
                      setIsMenuVisible(false);
                      router.push("/takeaway-qr" as any);
                    }}
                  >
                    <View
                      style={[
                        styles.menuIconContainer,
                        { backgroundColor: "#ea580c15" },
                      ]}
                    >
                      <Ionicons name="bag-handle-outline" size={18} color="#ea580c" />
                    </View>
                    <Text style={styles.subMenuItemText}>Qr for Takeaway</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* 6. Settings Dropdown */}
              <TouchableOpacity
                activeOpacity={0.7}
                style={[
                  styles.menuItem,
                  isSettingsExpanded && {
                    backgroundColor: "#F3F4F6",
                    borderBottomLeftRadius: 0,
                    borderBottomRightRadius: 0,
                    borderBottomWidth: 0,
                  },
                ]}
                onPress={() => setIsSettingsExpanded(!isSettingsExpanded)}
              >
                <View
                  style={[
                    styles.menuIconContainer,
                    { backgroundColor: Theme.textSecondary + "10" },
                  ]}
                >
                  <Ionicons
                    name="settings-outline"
                    size={18}
                    color={Theme.textSecondary}
                  />
                </View>
                <Text style={[styles.menuItemText, { flex: 1 }]}>
                  Settings
                </Text>
                <Ionicons
                  name={
                    isSettingsExpanded ? "chevron-down" : "chevron-forward"
                  }
                  size={18}
                  color={Theme.textSecondary}
                />
              </TouchableOpacity>

              {isSettingsExpanded && (
                <View style={styles.subMenuContainer}>
                  {canAccessStoreSettings() && (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={styles.subMenuItem}
                      onPress={() => {
                        setIsMenuVisible(false);
                        setIsSettingsVisible(true);
                      }}
                    >
                      <View
                        style={[
                          styles.menuIconContainer,
                          { backgroundColor: Theme.textSecondary + "10" },
                        ]}
                      >
                        <Ionicons
                          name="storefront-outline"
                          size={18}
                          color={Theme.textSecondary}
                        />
                      </View>
                      <Text style={styles.subMenuItemText}>
                        Store Settings
                      </Text>
                    </TouchableOpacity>
                  )}

                  {canAccessStoreSettings() && (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={styles.subMenuItem}
                      onPress={() => {
                        setIsMenuVisible(false);
                        router.push("/general-settings" as any);
                      }}
                    >
                      <View
                        style={[
                          styles.menuIconContainer,
                          { backgroundColor: Theme.primary + "10" },
                        ]}
                      >
                        <Ionicons
                          name="options-outline"
                          size={18}
                          color={Theme.primary}
                        />
                      </View>
                      <Text style={styles.subMenuItemText}>
                        General Settings
                      </Text>
                    </TouchableOpacity>
                  )}

                  {canAccessReceiptSettings() && (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={styles.subMenuItem}
                      onPress={() => {
                        setIsMenuVisible(false);
                        router.push("/company-settings" as any);
                      }}
                    >
                      <View
                        style={[
                          styles.menuIconContainer,
                          { backgroundColor: Theme.primary + "10" },
                        ]}
                      >
                        <Ionicons
                          name="receipt-outline"
                          size={18}
                          color={Theme.primary}
                        />
                      </View>
                      <Text style={styles.subMenuItemText}>
                        Receipt Settings
                      </Text>
                    </TouchableOpacity>
                  )}

                  {canAccessStoreSettings() && (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={styles.subMenuItem}
                      onPress={() => {
                        setIsMenuVisible(false);
                        router.push("/terminal-settings" as any);
                      }}
                    >
                      <View
                        style={[
                          styles.menuIconContainer,
                          { backgroundColor: Theme.primary + "10" },
                        ]}
                      >
                        <Ionicons
                          name="hardware-chip-outline"
                          size={18}
                          color={Theme.primary}
                        />
                      </View>
                      <Text style={styles.subMenuItemText}>
                        Terminal Management
                      </Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.subMenuItem}
                    onPress={() => {
                      setIsMenuVisible(false);
                      router.push("/cash-drawer" as any);
                    }}
                  >
                    <View
                      style={[
                        styles.menuIconContainer,
                        { backgroundColor: "#16A34A10" },
                      ]}
                    >
                      <Ionicons name="cash-outline" size={18} color="#16A34A" />
                    </View>
                    <Text style={styles.subMenuItemText}>Cash Drawer</Text>
                  </TouchableOpacity>



                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.subMenuItem}
                    onPress={() => {
                      setIsMenuVisible(false);
                      router.push("/customer-display" as any);
                    }}
                  >
                    <View
                      style={[
                        styles.menuIconContainer,
                        { backgroundColor: Theme.primary + "10" },
                      ]}
                    >
                      <Ionicons
                        name="desktop-outline"
                        size={18}
                        color={Theme.primary}
                      />
                    </View>
                    <Text style={styles.subMenuItemText}>Customer Display</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Legend in Menu for Mobile */}
              {!isTablet && (
                <>
                  <View style={styles.menuDivider} />
                  <View style={{ padding: 12 }}>
                    <Text
                      style={[
                        styles.menuUserRolePremium,
                        { marginBottom: 10, color: Theme.textPrimary },
                      ]}
                    >
                      Table Legend
                    </Text>
                    <View style={{ gap: 8 }}>
                      {[
                        { color: "#81C995", label: "Dining" },
                        { color: "#93C5FD", label: "Hold" },
                        { color: "#FCD34D", label: "Checkout" },
                        { color: "#FCA5A5", label: "Reserved" },
                        { color: "#C084FC", label: "Overtime" },
                      ].map((item) => (
                        <View key={item.label} style={styles.legendItem}>
                          <View
                            style={[
                              styles.legendDot,
                              {
                                backgroundColor: item.color,
                                width: 10,
                                height: 10,
                              },
                            ]}
                          />
                          <Text style={[styles.legendText, { fontSize: 12 }]}>
                            {item.label}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                </>
              )}

              <View style={styles.menuDivider} />

              <TouchableOpacity
                activeOpacity={0.7}
                style={[styles.menuItem, styles.logoutMenuItem]}
                onPress={() => {
                  setIsMenuVisible(false);
                  logout();
                  router.replace("/login");
                }}
              >
                <View
                  style={[
                    styles.menuIconContainer,
                    { backgroundColor: Theme.danger + "10" },
                  ]}
                >
                  <Ionicons
                    name="log-out-outline"
                    size={18}
                    color={Theme.danger}
                  />
                </View>
                <Text style={[styles.menuItemText, { color: Theme.danger }]}>
                  Logout
                </Text>
              </TouchableOpacity>
            </ScrollView>

            {user?.role !== "WAITER" && (
              <>
                <View style={[styles.menuDivider, { marginVertical: 6 }]} />
                {/* License Details Section */}
                {renderLicenseSection()}
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Avatar Picker Modal */}
      <AvatarPickerModal
        visible={isAvatarModalVisible}
        onClose={() => setIsAvatarModalVisible(false)}
        onSelect={handleSelectAvatar}
        currentAvatarUrl={avatarUrl}
      />

      {/* 〰〰 Section Header Row (Hidden on Mobile Landscape) 〰〰 */}
      {(!isLandscape || isTablet) && (
        <View
          style={[
            styles.sectionHeader,
            !isTablet &&
            isLandscape && { paddingVertical: 4, paddingHorizontal: 14 },
          ]}
        >
          <View style={styles.sectionHeaderLeft}>
            <View
              style={[
                styles.sectionAccentBar,
                !isTablet && isLandscape && { height: 14 },
              ]}
            />
            <Text
              style={[
                styles.sectionHeaderTitle,
                !isTablet && isLandscape && { fontSize: 13 },
              ]}
            >
              {SECTION_LABELS[activeTab]}
            </Text>
            <View
              style={[
                styles.sectionCountBadge,
                !isTablet && isLandscape && { paddingVertical: 1 },
              ]}
            >
              <Text style={styles.sectionCountText}>
                {currentTables.length} tables
              </Text>
            </View>
            {occupiedCount > 0 && (
              <View
                style={[
                  styles.occupiedBadge,
                  !isTablet && isLandscape && { paddingVertical: 1 },
                ]}
              >
                <View style={styles.occupiedDot} />
                <Text style={styles.occupiedText}>
                  {occupiedCount} occupied
                </Text>
              </View>
            )}
          </View>

          {/* Legend - Only show on tablets directly on screen */}
          {isTablet && (
            <View style={styles.legend}>
              {[
                { color: "#81C995", label: "Dining" },
                { color: "#93C5FD", label: "Hold" },
                { color: "#FCD34D", label: "Checkout" },
                { color: "#FCA5A5", label: "Reserved" },
                { color: "#C084FC", label: "Overtime" },
              ].map((item) => (
                <View key={item.label} style={styles.legendItem}>
                  <View
                    style={[styles.legendDot, { backgroundColor: item.color }]}
                  />
                  <Text style={styles.legendText}>{item.label}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* â•â•â•â•â•â•â•â•â•â•â• TABLE GRID â•â•â•â•â•â•â•â•â•â•â• */}
      {/* ═════════════ TABLE VISUAL FLOOR MAP ═════════════ */}
      {/* ═════════════ TABLE LAYOUT RENDERER ═════════════ */}
      {!hasCustomLayout ? (
        <FlatList
          data={currentTables}
          key={columns}
          numColumns={columns}
          keyExtractor={(item: TableItem) => item.id}
          renderItem={renderItem}
          columnWrapperStyle={{ gap: GAP }}
          getItemLayout={(data, index) => ({
            length: itemSize + GAP,
            offset: (itemSize + GAP) * Math.floor(index / columns),
            index,
          })}
          removeClippedSubviews={Platform.OS !== "web"}
          maxToRenderPerBatch={isTablet ? 20 : 10}
          windowSize={3}
          initialNumToRender={isTablet ? 30 : 15}
          contentContainerStyle={{
            gap: GAP,
            paddingHorizontal: PADDING,
            paddingBottom: isTablet ? 160 : 100,
            paddingTop: 8,
          }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="grid-outline" size={48} color={Theme.border} />
              <Text style={styles.emptyText}>No tables found</Text>
              <TouchableOpacity onPress={fetchTables} style={styles.retryBtn}>
                <Ionicons
                  name="refresh-outline"
                  size={16}
                  color={Theme.primary}
                />
                <Text style={styles.retryText}>Refresh</Text>
              </TouchableOpacity>
            </View>
          }
        />
      ) : (
        <View style={{ flex: 1 }}>
          {currentTables.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="grid-outline" size={48} color={Theme.border} />
              <Text style={styles.emptyText}>No tables found</Text>
              <TouchableOpacity onPress={fetchTables} style={styles.retryBtn}>
                <Ionicons
                  name="refresh-outline"
                  size={16}
                  color={Theme.primary}
                />
                <Text style={styles.retryText}>Refresh</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ flex: 1 }} onLayout={onContainerLayout}>
              <ScrollView
                contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
                showsVerticalScrollIndicator={false}
                style={{ flex: 1 }}
              >
                <CanvasBackground
                  theme={backgroundTheme}
                  style={{
                    width: availableWidth,
                    height: canvasHeight * (availableWidth / 780),
                    borderRadius: 16,
                    position: "relative",
                    overflow: "hidden",
                  }}
                  isCategory={true}
                >
                  {/* Render each Table component placed absolute */}
                  {(() => {
                    const layoutScale = availableWidth / 780;

                    return currentTables.map((item, index) => {
                      const defaultX = (item.XPos || 30 + (index % 4) * 170) * layoutScale;
                      const defaultY = (item.YPos || 30 + Math.floor(index / 4) * 130) * layoutScale;

                      return (
                        <View
                          key={item.id}
                          style={{
                            position: "absolute",
                            left: defaultX,
                            top: defaultY,
                          }}
                        >
                          <TableItemComponent
                            tableId={item.id}
                            item={item}
                            itemSize={90}
                            activeTab={activeTab}
                            onPress={handleTablePress}
                            numberFont={numberFont}
                            smallFont={smallFont}
                            isTabletPortrait={!isLandscape && isTablet}
                            isAbsoluteLayout={true}
                            layoutScale={layoutScale}
                            backgroundTheme={backgroundTheme}
                          />
                        </View>
                      );
                    });
                  })()}
                </CanvasBackground>
              </ScrollView>
            </View>
          )}
        </View>
      )}
      {/* 〰〰〰〰〰〰〰〰〰〰〰 CUSTOMER GUEST & PAX MODAL 〰〰〰〰〰〰〰〰〰〰〰 */}
      <Modal
        visible={guestModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setGuestModalVisible(false);
          setPendingGuestItem(null);
        }}
      >
        <TouchableOpacity
          style={styles.centerOverlay}
          activeOpacity={1}
          onPress={() => {
            setGuestModalVisible(false);
            setPendingGuestItem(null);
          }}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => { }} // Stop propagation
            style={{
              backgroundColor: Theme.bgCard,
              padding: 24,
              borderRadius: Theme.radiusLg,
              width: isTablet ? 350 : "80%",
              elevation: 10,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 12,
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontFamily: Fonts.bold,
                color: Theme.textPrimary,
                marginBottom: 16,
              }}
            >
              Table {pendingGuestItem?.label} details
            </Text>

            <Text
              style={{
                fontSize: 13,
                fontFamily: Fonts.semiBold,
                color: Theme.textSecondary,
                marginBottom: 6,
              }}
            >
              Enter Name (Optional - Max 9 chars)
            </Text>
            <TextInput
              style={{
                borderWidth: 1.5,
                borderColor: Theme.border,
                borderRadius: Theme.radiusMd,
                padding: 10,
                fontSize: 14,
                fontFamily: Fonts.regular,
                color: Theme.textPrimary,
                marginBottom: 16,
                backgroundColor: Theme.bgInput,
                outlineStyle: "none",
              } as any}
              placeholder="Guest Name"
              placeholderTextColor={Theme.textMuted}
              value={guestNameInput}
              onChangeText={setGuestNameInput}
              maxLength={9}
            />

            <Text
              style={{
                fontSize: 13,
                fontFamily: Fonts.semiBold,
                color: Theme.textSecondary,
                marginBottom: 6,
              }}
            >
              Pax / Persons (Optional)
            </Text>
            <TextInput
              style={{
                borderWidth: 1.5,
                borderColor: Theme.border,
                borderRadius: Theme.radiusMd,
                padding: 10,
                fontSize: 14,
                fontFamily: Fonts.regular,
                color: Theme.textPrimary,
                marginBottom: 24,
                backgroundColor: Theme.bgInput,
                outlineStyle: "none",
              } as any}
              placeholder="Number of persons"
              placeholderTextColor={Theme.textMuted}
              value={guestPaxInput}
              onChangeText={(text) =>
                setGuestPaxInput(text.replace(/[^0-9]/g, ""))
              }
              keyboardType="numeric"
            />

            <View
              style={{
                flexDirection: "row",
                justifyContent: "flex-end",
                gap: 12,
              }}
            >
              <TouchableOpacity
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: Theme.radiusMd,
                  borderWidth: 1.5,
                  borderColor: Theme.border,
                }}
                disabled={isSavingGuest}
                onPress={() => {
                  setGuestModalVisible(false);
                  if (pendingGuestItem) {
                    lastGuestOpenedTable = null;
                    proceedWithTable(pendingGuestItem, null);
                    setPendingGuestItem(null);
                  }
                }}
              >
                <Text
                  style={{
                    color: Theme.textSecondary,
                    fontFamily: Fonts.semiBold,
                    fontSize: 14,
                  }}
                >
                  Skip
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 20,
                  backgroundColor: Theme.primary,
                  borderRadius: Theme.radiusMd,
                  alignItems: "center",
                  justifyContent: "center",
                }}
                disabled={isSavingGuest}
                onPress={handleGuestSubmit}
              >
                <Text
                  style={{
                    color: "#FFF",
                    fontFamily: Fonts.bold,
                    fontSize: 14,
                  }}
                >
                  {isSavingGuest ? "Saving..." : "Enter"}
                </Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* ════════════════════════════════════════════════════════════
           MOVE TABLE MODAL
      ════════════════════════════════════════════════════════════ */}
      <Modal
        visible={isMoveTableVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (!isMovingTable) {
            setIsMoveTableVisible(false);
            setMoveSourceTable(null);
            setMoveDestTable(null);
            setMoveStep("source");
            setMoveSearchQuery("");
          }
        }}
      >
        <View style={styles.moveModalRoot}>
          {/* ── Header ── */}
          <View style={styles.moveModalHeader}>
            <TouchableOpacity
              style={styles.moveModalBackBtn}
              onPress={() => {
                if (
                  moveStep === "dest" &&
                  allTables.filter((t) => [1, 2, 3].includes(Number(t.Status)))
                    .length > 1
                ) {
                  setMoveStep("source");
                  setMoveDestTable(null);
                } else {
                  setIsMoveTableVisible(false);
                  setMoveSourceTable(null);
                  setMoveDestTable(null);
                  setMoveStep("source");
                  setMoveSearchQuery("");
                }
              }}
              disabled={isMovingTable}
            >
              <Ionicons name="arrow-back" size={22} color={Theme.textPrimary} />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={styles.moveModalTitle}>
                {moveStep === "source"
                  ? "Select Source Table"
                  : "Select Destination"}
              </Text>
              <Text style={styles.moveModalSubtitle}>
                {moveStep === "source"
                  ? "Which table are you moving FROM?"
                  : "Which table are you moving TO?"}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.moveModalBackBtn}
              onPress={() => {
                setIsMoveTableVisible(false);
                setMoveSourceTable(null);
                setMoveDestTable(null);
                setMoveStep("source");
                setMoveSearchQuery("");
              }}
              disabled={isMovingTable}
            >
              <Ionicons name="close" size={22} color={Theme.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* ── Source chip (shown in dest step) ── */}
          {moveStep === "dest" && moveSourceTable && (
            <TouchableOpacity
              activeOpacity={0.85}
              style={styles.moveSourceChip}
              onPress={() => {
                // Tap the FROM chip to go back and change source table
                if (!isMovingTable) {
                  setMoveStep("source");
                  setMoveDestTable(null);
                  setMoveSearchQuery("");
                }
              }}
            >
              <View style={styles.moveSourceChipInner}>
                <Ionicons
                  name="swap-horizontal-outline"
                  size={15}
                  color="#fff"
                />
                <Text style={styles.moveSourceChipLabel}>FROM</Text>
                <Text style={styles.moveSourceChipTable}>
                  Table {moveSourceTable.label}
                </Text>
                {moveSourceTable.totalAmount ? (
                  <Text style={styles.moveSourceChipAmt}>
                    ${Number(moveSourceTable.totalAmount).toFixed(2)}
                  </Text>
                ) : null}
                <Ionicons
                  name="chevron-down"
                  size={13}
                  color="rgba(255,255,255,0.75)"
                />
              </View>
              {moveDestTable && (
                <View style={styles.moveDestChipInner}>
                  <Ionicons
                    name="arrow-forward"
                    size={14}
                    color={Theme.primary}
                  />
                  <Text style={styles.moveDestChipLabel}>TO</Text>
                  <Text style={styles.moveDestChipTable}>
                    Table {moveDestTable.label}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          )}

          {/* ── Search bar ── */}
          <View style={styles.moveSearchBar}>
            <Ionicons name="search-outline" size={18} color={Theme.textMuted} />
            <TextInput
              style={styles.moveSearchInput}
              placeholder={
                moveStep === "source"
                  ? "Search occupied table..."
                  : "Search available table..."
              }
              placeholderTextColor={Theme.textMuted}
              value={moveSearchQuery}
              onChangeText={setMoveSearchQuery}
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
            {moveSearchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setMoveSearchQuery("")}>
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={Theme.textMuted}
                />
              </TouchableOpacity>
            )}
          </View>

          {/* ── Section tabs (only shown in dest step) ── */}
          {moveStep === "dest" && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.moveSectionTabsContent}
              style={styles.moveSectionTabsRow}
            >
              {SECTIONS.map((sec) => {
                const isAct = moveActiveSection === sec;
                return (
                  <TouchableOpacity
                    key={sec}
                    style={[
                      styles.moveSectionTab,
                      isAct && styles.moveSectionTabActive,
                    ]}
                    onPress={() => {
                      setMoveActiveSection(sec);
                      setMoveSearchQuery("");
                    }}
                    activeOpacity={0.75}
                  >
                    <Ionicons
                      name={SECTION_ICONS[sec] as any}
                      size={13}
                      color={isAct ? "#fff" : Theme.textSecondary}
                    />
                    <Text
                      style={[
                        styles.moveSectionTabText,
                        isAct && styles.moveSectionTabTextActive,
                      ]}
                    >
                      {SECTION_SHORT[sec]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {/* ── Table grid ── */}
          <FlatList
            style={{ flex: 1 }}
            contentContainerStyle={styles.moveTableGrid}
            numColumns={columns}
            key={
              moveStep === "source"
                ? `src-${columns}`
                : `dst-${moveActiveSection}-${columns}`
            }
            data={(() => {
              const q = moveSearchQuery.toLowerCase().trim();

              // Helper to get fresh data from our global reactive store for the modal list
              const getRealTimeTable = (t: TableItem): TableItem => {
                const tableData = useTableStatusStore.getState().tableMap[t.id];
                if (!tableData) return t;
                const statusMap: Record<string, number> = {
                  EMPTY: 0,
                  SENT: 1,
                  BILL_REQUESTED: 2,
                  HOLD: 3,
                  LOCKED: 5,
                };
                return {
                  ...t,
                  Status:
                    statusMap[tableData.status] !== undefined
                      ? statusMap[tableData.status]
                      : t.Status,
                  totalAmount:
                    tableData.totalAmount !== undefined
                      ? tableData.totalAmount
                      : t.totalAmount,
                  customerName:
                    tableData.customerName !== undefined
                      ? tableData.customerName
                      : t.customerName,
                  pax: tableData.pax !== undefined ? tableData.pax : t.pax,
                  currentOrderId:
                    tableData.orderId !== "EMPTY" &&
                      tableData.orderId !== "SYNC"
                      ? tableData.orderId
                      : t.currentOrderId,
                };
              };

              const realTimeTables = allTables.map(getRealTimeTable);

              if (moveStep === "source") {
                // Show only occupied tables (1=Dining, 2=Checkout, 3=Hold)
                let list = realTimeTables.filter((t) =>
                  [1, 2, 3].includes(Number(t.Status)),
                );
                if (q)
                  list = list.filter((t) => t.label.toLowerCase().includes(q));
                return list.sort((a, b) =>
                  a.label.localeCompare(b.label, undefined, { numeric: true }),
                );
              } else {
                // Show only available tables in selected section
                let list = getSectionTables(moveActiveSection, realTimeTables).filter(
                  (t) => Number(t.Status) === 0 && t.id !== moveSourceTable?.id,
                );
                if (q)
                  list = list.filter((t) => t.label.toLowerCase().includes(q));
                return list.sort((a, b) =>
                  a.label.localeCompare(b.label, undefined, { numeric: true }),
                );
              }
            })()}
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <View style={styles.moveEmptyState}>
                <Ionicons
                  name={
                    moveStep === "source"
                      ? "restaurant-outline"
                      : "checkmark-circle-outline"
                  }
                  size={44}
                  color={Theme.textMuted}
                />
                <Text style={styles.moveEmptyText}>
                  {moveStep === "source"
                    ? "No occupied tables found"
                    : "No available tables in this section"}
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const isSelectedSrc = item.id === moveSourceTable?.id;
              const isSelectedDst = item.id === moveDestTable?.id;
              const occupied = moveStep === "source";
              const statusUi = getStatusUI(Number(item.Status), item.DiningSection);

              return (
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={[
                    styles.moveTableCard,
                    occupied && {
                      borderColor: statusUi.color,
                      borderWidth: 2,
                      backgroundColor: statusUi.lightBg,
                    },
                    isSelectedSrc && styles.moveTableCardSelectedSrc,
                    isSelectedDst && styles.moveTableCardSelectedDst,
                  ]}
                  onPress={() => {
                    if (moveStep === "source") {
                      // Toggle: tap same card to deselect, tap another to select & advance
                      if (isSelectedSrc) {
                        setMoveSourceTable(null);
                      } else {
                        setMoveSourceTable(item);
                        setMoveStep("dest");
                        setMoveDestTable(null);
                        setMoveSearchQuery("");
                        setMoveActiveSection(
                          getSectionFromDiningSection(item.DiningSection),
                        );
                      }
                    } else {
                      setMoveDestTable(isSelectedDst ? null : item);
                    }
                  }}
                >
                  {/* Selection ring */}
                  {(isSelectedSrc || isSelectedDst) && (
                    <View
                      style={[
                        styles.moveTableCheckBadge,
                        isSelectedDst && { backgroundColor: Theme.primary },
                      ]}
                    >
                      <Ionicons name="checkmark" size={12} color="#fff" />
                    </View>
                  )}

                  <Text
                    style={[
                      styles.moveTableCardNumber,
                      occupied && { color: statusUi.color },
                      isSelectedDst && { color: Theme.primary },
                    ]}
                  >
                    {item.label}
                  </Text>

                  {/* Status chip (source step) */}
                  {occupied && (
                    <View
                      style={[
                        styles.moveTableStatusChip,
                        { borderColor: statusUi.color },
                      ]}
                    >
                      <Text
                        style={[
                          styles.moveTableStatusText,
                          { color: statusUi.color },
                        ]}
                      >
                        {statusUi.text}
                      </Text>
                    </View>
                  )}

                  {/* Amount (source step) */}
                  {occupied && Number(item.totalAmount) > 0 && (
                    <Text
                      style={[styles.moveTableAmt, { color: statusUi.color }]}
                    >
                      ${Number(item.totalAmount).toFixed(2)}
                    </Text>
                  )}

                  {/* Available indicator (dest step) */}
                  {!occupied && <View style={styles.moveAvailDot} />}

                  {/* Section label (source step — cross-section visibility) */}
                  {occupied && (
                    <Text style={styles.moveTableSection}>
                      {
                        SECTION_SHORT[
                        getSectionFromDiningSection(item.DiningSection)
                        ]
                      }
                    </Text>
                  )}
                </TouchableOpacity>
              );
            }}
          />

          {/* ── Bottom confirm bar ── */}
          {moveStep === "dest" && moveDestTable && (
            <View style={styles.moveConfirmBar}>
              <View style={styles.moveConfirmInfo}>
                <Text style={styles.moveConfirmLabel}>Transfer</Text>
                <View style={styles.moveConfirmRoute}>
                  <View style={styles.moveConfirmTableChip}>
                    <Ionicons
                      name="grid-outline"
                      size={13}
                      color={Theme.primary}
                    />
                    <Text style={styles.moveConfirmTableNo}>
                      Table {moveSourceTable?.label}
                    </Text>
                  </View>
                  <Ionicons
                    name="arrow-forward"
                    size={18}
                    color={Theme.textMuted}
                  />
                  <View
                    style={[
                      styles.moveConfirmTableChip,
                      {
                        backgroundColor: Theme.primaryLight,
                        borderColor: Theme.primaryBorder,
                      },
                    ]}
                  >
                    <Ionicons
                      name="grid-outline"
                      size={13}
                      color={Theme.primary}
                    />
                    <Text
                      style={[
                        styles.moveConfirmTableNo,
                        { color: Theme.primary },
                      ]}
                    >
                      Table {moveDestTable.label}
                    </Text>
                  </View>
                </View>
              </View>
              <TouchableOpacity
                style={[
                  styles.moveConfirmBtn,
                  isMovingTable && { opacity: 0.65 },
                ]}
                disabled={isMovingTable}
                onPress={handleMoveTable}
                activeOpacity={0.8}
              >
                {isMovingTable ? (
                  <Text style={styles.moveConfirmBtnText}>Transferring...</Text>
                ) : (
                  <>
                    <Text style={styles.moveConfirmBtnText}>Transfer Now</Text>
                    <Ionicons name="arrow-forward" size={18} color="#fff" />
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>

      <StoreSettingsModal
        visible={isSettingsVisible}
        onClose={() => setIsSettingsVisible(false)}
      />

      {/* Notifications Modal */}
      <Modal
        visible={isNotifModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          useNotificationStore.getState().clearNotifications();
          setIsNotifModalVisible(false);
        }}
      >
        <TouchableWithoutFeedback onPress={() => {
          useNotificationStore.getState().clearNotifications();
          setIsNotifModalVisible(false);
        }}>
          <View style={{
            flex: 1,
            backgroundColor: "rgba(15, 23, 42, 0.3)",
            justifyContent: "flex-start",
            alignItems: isTablet ? "flex-end" : "center",
            paddingTop: isTablet ? 70 : 100,
            paddingRight: isTablet ? 24 : 0,
          }}>
            <TouchableWithoutFeedback>
              <View style={{
                backgroundColor: "#FFFFFF",
                borderRadius: 16,
                width: isTablet ? 380 : "90%",
                maxHeight: 500,
                elevation: 10,
                shadowColor: "#0F172A",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.15,
                shadowRadius: 16,
                borderWidth: 1,
                borderColor: "#E2E8F0",
                overflow: "hidden",
              }}>
                {/* Modal Header */}
                <View style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: 16,
                  borderBottomWidth: 1,
                  borderBottomColor: "#F1F5F9",
                  backgroundColor: "#F8FAFC",
                }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="notifications-outline" size={20} color={Theme.primary} />
                    <Text style={{ fontSize: 16, fontFamily: Fonts.bold, color: "#0F172A" }}>
                      Notifications
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    {unreadCount > 0 && (
                      <TouchableOpacity onPress={() => {
                        markAllAsRead();
                        showToast({ type: "success", message: "All Read", subtitle: "Notifications marked as read." });
                      }}>
                        <Text style={{ fontSize: 12, fontFamily: Fonts.semiBold, color: Theme.primary }}>
                          Read All
                        </Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => {
                      useNotificationStore.getState().clearNotifications();
                      setIsNotifModalVisible(false);
                    }}>
                      <Ionicons name="close" size={22} color="#64748B" />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Modal Content */}
                <ScrollView
                  contentContainerStyle={{ padding: 16, gap: 10 }}
                  showsVerticalScrollIndicator={false}
                >
                  {notifications.length === 0 ? (
                    <View style={{
                      paddingVertical: 40,
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 12,
                    }}>
                      <View style={{
                        width: 56,
                        height: 56,
                        borderRadius: 28,
                        backgroundColor: "#F1F5F9",
                        alignItems: "center",
                        justifyContent: "center",
                      }}>
                        <Ionicons name="notifications-off-outline" size={26} color="#94A3B8" />
                      </View>
                      <Text style={{ fontSize: 14, fontFamily: Fonts.medium, color: "#64748B" }}>
                        No new notifications
                      </Text>
                    </View>
                  ) : (
                    notifications.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        onPress={() => {
                          // If it is a QR order, we can close modal and help them locate the table
                          setIsNotifModalVisible(false);
                          if (item.tableNo && item.section) {
                            const sectionMap: Record<string, string> = { "1": "SECTION_1", "2": "SECTION_2", "3": "SECTION_3", "4": "TAKEAWAY" };
                            const normalizedSection = sectionMap[String(item.section)] || item.section;
                            setActiveTab(normalizedSection);
                            showToast({
                              type: "info",
                              message: item.title,
                              subtitle: `Viewing ${normalizedSection.replace("_", " ")} Table ${item.tableNo}`,
                            });
                          }
                        }}
                        activeOpacity={0.8}
                        style={{
                          backgroundColor: item.read ? "#F8FAFC" : "#FFF7ED",
                          borderWidth: 1.2,
                          borderColor: item.read ? "#E2E8F0" : "#FED7AA",
                          borderRadius: 12,
                          padding: 12,
                          flexDirection: "row",
                          gap: 10,
                        }}
                      >
                        <View style={{
                          width: 36,
                          height: 36,
                          borderRadius: 18,
                          backgroundColor: item.read ? "#F1F5F9" : "#FFEDD5",
                          alignItems: "center",
                          justifyContent: "center",
                        }}>
                          <Ionicons
                            name={item.type === "QR_ORDER" ? "qr-code-outline" : "information-circle-outline"}
                            size={18}
                            color={item.read ? "#64748B" : Theme.primary}
                          />
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                            <Text style={{ fontSize: 13, fontFamily: Fonts.bold, color: "#0F172A" }}>
                              {item.title}
                            </Text>
                            <Text style={{ fontSize: 10, fontFamily: Fonts.medium, color: "#94A3B8" }}>
                              {item.time}
                            </Text>
                          </View>
                          {item.type === "QR_ORDER" ? (
                            <View style={{ gap: 4, marginTop: 2, alignItems: "flex-start" }}>
                              <Text style={{ fontSize: 11, fontFamily: Fonts.medium, color: "#64748B" }}>
                                Order #{item.orderId ? item.orderId.split("-").pop() : "Order"}
                              </Text>
                              <View style={{ flexDirection: "row", alignItems: "center" }}>
                                <Text style={{
                                  fontSize: 15,
                                  fontFamily: Fonts.bold,
                                  color: Theme.primary,
                                  backgroundColor: "#FFF7ED",
                                  paddingHorizontal: 8,
                                  paddingVertical: 4,
                                  borderRadius: 6,
                                  borderWidth: 1,
                                  borderColor: "#FFEDD5",
                                }}>
                                  {item.tableNo ? `${item.section || "DINING"} • Table ${item.tableNo}` : item.message.split("submitted for")[1]?.trim() || item.message}
                                </Text>
                              </View>
                            </View>
                          ) : (
                            <Text style={{ fontSize: 11, fontFamily: Fonts.medium, color: "#475569" }} numberOfLines={2}>
                              {item.message}
                            </Text>
                          )}
                        </View>
                        <TouchableOpacity
                          onPress={(e) => {
                            e.stopPropagation();
                            useNotificationStore.getState().removeNotification(item.id);
                          }}
                          style={{
                            padding: 4,
                            alignSelf: "flex-start",
                          }}
                        >
                          <Ionicons name="close" size={16} color="#94A3B8" />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    ))
                  )}
                </ScrollView>

                {/* Modal Footer */}
                {notifications.length > 0 && (
                  <View style={{
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderTopWidth: 1,
                    borderTopColor: "#F1F5F9",
                    backgroundColor: "#F8FAFC",
                    alignItems: "center",
                  }}>
                    <TouchableOpacity
                      onPress={() => {
                        useNotificationStore.getState().clearNotifications();
                        showToast({ type: "success", message: "Cleared", subtitle: "All notifications cleared." });
                      }}
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 16,
                        borderRadius: 8,
                        backgroundColor: "#F1F5F9",
                      }}
                    >
                      <Text style={{ fontSize: 12, fontFamily: Fonts.bold, color: "#ef4444" }}>
                        Clear All
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* General Settings Modal */}

      {/* Floating AI Chat Assistant Button */}
      {user?.role === "ADMIN" && (
        <TouchableOpacity
          style={[
            styles.floatingAiBtn,
            {
              bottom: Math.max(insets.bottom, 16) + 16,
              right: Math.max(insets.right, 16) + 16,
            },
          ]}
          onPress={() => router.push("/ai-chat")}
          activeOpacity={0.8}
        >
          <Ionicons name="sparkles" size={24} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Calendar Modal for Business Date */}
      <Modal
        visible={showBusinessCalendar}
        transparent
        animationType="fade"
        onRequestClose={() => setShowBusinessCalendar(false)}
      >
        <TouchableWithoutFeedback
          onPress={() => setShowBusinessCalendar(false)}
        >
          <View style={styles.centerOverlay}>
            <TouchableWithoutFeedback>
              <View
                style={{
                  backgroundColor: Theme.bgCard,
                  padding: 20,
                  borderRadius: Theme.radiusLg,
                  width: 350,
                  elevation: 10,
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.15,
                  shadowRadius: 12,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 15,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 16,
                      fontFamily: Fonts.bold,
                      color: Theme.textPrimary,
                    }}
                  >
                    Select Business Date
                  </Text>
                  <TouchableOpacity
                    onPress={() => setShowBusinessCalendar(false)}
                  >
                    <Ionicons
                      name="close"
                      size={24}
                      color={Theme.textPrimary}
                    />
                  </TouchableOpacity>
                </View>
                <CalendarPicker
                  selectedDate={
                    modalSelectedDate || selectedBusinessDate || getSingaporeDateString()
                  }
                  onDateChange={(date) => {
                    setModalSelectedDate(date);
                  }}
                  onlyAllowToday={true}
                />

                {/* Orange Start Day Button */}
                <TouchableOpacity
                  style={{
                    backgroundColor: Theme.primary || "#fd7e14",
                    borderRadius: 12,
                    paddingVertical: 13,
                    alignItems: "center",
                    justifyContent: "center",
                    marginTop: 16,
                    opacity: isStartingDay ? 0.7 : 1,
                    shadowColor: Theme.primary || "#fd7e14",
                    shadowOffset: { width: 0, height: 3 },
                    shadowOpacity: 0.3,
                    shadowRadius: 6,
                    elevation: 4,
                  }}
                  activeOpacity={0.8}
                  disabled={isStartingDay || isDayStarted}
                  onPress={async () => {
                    const dateToStart = modalSelectedDate || selectedBusinessDate || getSingaporeDateString();
                    const success = await handleStartDay(dateToStart);
                    if (success) {
                      setShowBusinessCalendar(false);
                    }
                  }}
                >
                  {isStartingDay ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text
                      style={{
                        color: "#fff",
                        fontFamily: Fonts.bold,
                        fontSize: 15,
                        letterSpacing: 0.3,
                      }}
                    >
                      {isDayStarted ? "Day Already Started" : "Start Day"}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>


    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Theme.bgMain },
  floatingAiBtn: {
    position: "absolute",
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Theme.primary,
    alignItems: "center",
    justifyContent: "center",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    zIndex: 9999,
  },

  /* â”€â”€ Loading â”€â”€ */
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: Theme.bgMain,
  },
  loadingText: {
    color: Theme.textSecondary,
    marginTop: 12,
    fontFamily: Fonts.medium,
    fontSize: 15,
  },

  /* â”€â”€ Top Nav â”€â”€ */
  topNavContainer: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    backgroundColor: Theme.bgNav,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    gap: 12,
    ...Theme.shadowSm,
  },

  /* Tabs */
  tabsScrollView: { flex: 1, minWidth: 180 },
  tabsScrollContent: { alignItems: "center", paddingLeft: 0, paddingRight: 12 },
  tabsWrapper: { flexDirection: "row", alignItems: "center" },
  backBtnCorner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F1F5F9",
    borderColor: "#CBD5E1",
    borderWidth: 1,
    justifyContent: "center",
    alignItems: "center",
    flexShrink: 0,
  },
  qsBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#0F172A",
    textAlign: "center",
    includeFontPadding: false,
    letterSpacing: 0.2,
  },
  tabBtn: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: Theme.radiusFull,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Theme.bgMuted,
    borderWidth: 1,
    borderColor: Theme.border,
    flexShrink: 0,
  },
  activeTabBtn: {
    backgroundColor: Theme.primary,
    borderColor: Theme.primary,
  },
  tabText: {
    color: Theme.textSecondary,
    fontFamily: Fonts.semiBold,
    letterSpacing: 0.2,
  },
  activeTabText: { color: "#fff", fontFamily: Fonts.extraBold },

  tabBadge: {
    marginLeft: 6,
    backgroundColor: "rgba(0,0,0,0.1)",
    borderRadius: 8,
    minWidth: 18,
    height: 18,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  activeTabBadge: { backgroundColor: "rgba(255,255,255,0.3)" },
  tabBadgeText: {
    color: Theme.textSecondary,
    fontFamily: Fonts.bold,
    fontSize: 10,
  },
  activeTabBadgeText: { color: "#fff" },

  /* Right Action Buttons */
  navRightGroup: { flexDirection: "row", alignItems: "center" },
  headerActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: Theme.radiusMd,
    backgroundColor: Theme.bgMuted,
    borderWidth: 1,
    borderColor: Theme.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  salesBtn: {
    backgroundColor: Theme.primaryLight,
    borderColor: Theme.primaryBorder,
  },
  logoutBtn: {
    backgroundColor: Theme.dangerBg,
    borderColor: Theme.dangerBorder,
  },
  headerActionText: {
    color: Theme.textSecondary,
    fontFamily: Fonts.extraBold,
    fontSize: 14,
  },

  /* â”€â”€ Section Header Row â”€â”€ */
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: Theme.bgMain,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
  },
  sectionHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sectionAccentBar: {
    width: 3,
    height: 18,
    borderRadius: 2,
    backgroundColor: Theme.primary,
  },
  sectionHeaderTitle: {
    color: Theme.textPrimary,
    fontFamily: Fonts.extraBold,
    fontSize: 15,
    letterSpacing: 0.3,
  },
  sectionCountBadge: {
    backgroundColor: Theme.bgMuted,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  sectionCountText: {
    color: Theme.textSecondary,
    fontFamily: Fonts.medium,
    fontSize: 11,
  },
  occupiedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: Theme.successBg,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Theme.successBorder,
  },
  occupiedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Theme.success,
  },
  occupiedText: { color: "#15803D", fontFamily: Fonts.semiBold, fontSize: 11 },

  /* Legend */
  legend: { flexDirection: "row", alignItems: "center", gap: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: {
    color: Theme.textMuted,
    fontSize: 10,
    fontFamily: Fonts.medium,
  },

  /* â”€â”€ Table Card â”€â”€ */
  tableBox: {
    borderRadius: 12,
    borderWidth: 1.5,
    overflow: "hidden",
    position: "relative",
    ...Theme.shadowSm,
  },
  tableContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 10,
  },
  tableNumber: {
    fontWeight: "900",
    color: Theme.textPrimary,
    marginTop: 4,
    marginBottom: 2,
  },
  tableInfo: { alignItems: "center", gap: 2 },
  statusChip: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginBottom: 1,
  },
  statusChipText: { fontFamily: Fonts.bold, letterSpacing: 0.3 },
  tableStats: { alignItems: "center", gap: 1 },
  timeText: { color: Theme.textSecondary, fontFamily: Fonts.medium },
  orderText: { color: Theme.textMuted, fontFamily: Fonts.regular },
  billText: { fontFamily: Fonts.black },
  lockedOverlay: { alignItems: "center", gap: 3, marginTop: 4 },
  lockedNameText: {
    color: "#B91C1C",
    fontFamily: Fonts.bold,
    marginTop: 1,
    textAlign: "center",
  },

  /* â”€â”€ Empty State â”€â”€ */
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 50,
    gap: 12,
  },
  emptyText: {
    color: Theme.textSecondary,
    fontSize: 16,
    marginBottom: 4,
    fontFamily: Fonts.medium,
  },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Theme.primaryLight,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.primaryBorder,
  },
  retryText: { color: Theme.primary, fontFamily: Fonts.bold, fontSize: 14 },

  /* â”€â”€ User Chip â”€â”€ */
  userChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Theme.primaryLight,
    borderRadius: Theme.radiusMd,
    borderWidth: 1,
    borderColor: Theme.primaryBorder,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 2,
  },
  userChipAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Theme.primary + "20",
    justifyContent: "center",
    alignItems: "center",
  },
  userChipName: {
    color: Theme.primary,
    fontFamily: Fonts.bold,
    fontSize: 12,
    maxWidth: 100,
  },
  userChipRole: {
    color: Theme.textMuted,
    fontFamily: Fonts.medium,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },

  /* ———— More Menu Modal ———— */
  menuOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 60,
    paddingRight: 20,
  },
  centerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  menuContent: {
    width: 260,
    backgroundColor: "#FFF",
    borderRadius: 20,
    padding: 10,
    ...Theme.shadowLg,
  },
  menuUserSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  menuUserSectionGradient: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255, 94, 26, 0.2)",
    marginBottom: 4,
    shadowColor: Theme.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  menuAvatarWrapper: {
    position: "relative",
  },
  menuAvatarContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#FFF",
    borderWidth: 2,
    borderColor: "rgba(255, 94, 26, 0.3)",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  menuAvatarEditBadge: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 17,
    height: 17,
    borderRadius: 8.5,
    backgroundColor: Theme.primary,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
  },
  menuUserInfo: {
    flex: 1,
    justifyContent: "center",
  },
  menuAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Theme.primary + "15",
    justifyContent: "center",
    alignItems: "center",
  },
  menuAvatarPremium: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#FFF",
    borderWidth: 2,
    borderColor: "rgba(255, 94, 26, 0.3)",
    justifyContent: "center",
    alignItems: "center",
    ...Theme.shadowMd,
  },
  menuUserName: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: "#1E293B",
  },
  menuUserNamePremium: {
    fontSize: 15,
    fontFamily: Fonts.bold,
    color: "#1E293B",
    letterSpacing: 0.2,
  },
  menuRoleBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255, 94, 26, 0.25)",
    gap: 4,
    alignSelf: "flex-start",
    marginTop: 4,
  },
  menuUserRole: {
    fontSize: 11,
    fontFamily: Fonts.medium,
    color: Theme.textMuted,
    textTransform: "uppercase",
  },
  menuUserRolePremium: {
    fontSize: 10.5,
    fontFamily: Fonts.bold,
    color: Theme.primaryDark || "#E04D10",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  menuDivider: {
    height: 1,
    backgroundColor: Theme.border,
    marginVertical: 8,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  menuIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
  },
  menuItemText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  subMenuContainer: {
    paddingLeft: 12,
    borderLeftWidth: 1.5,
    borderLeftColor: Theme.border,
    marginLeft: 26,
    marginVertical: 4,
    gap: 2,
  },
  subMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  subMenuItemText: {
    fontSize: 13,
    fontFamily: Fonts.semiBold,
    color: Theme.textSecondary,
  },
  logoutMenuItem: {
    marginTop: 4,
  },

  /* ———— Premium License Card Reference UI ———— */
  /* ———— Compact Premium License Card ———— */
  licCardWrapperGradient: {
    borderRadius: 14,
    padding: 1.2,
    shadowColor: "#FF7A00",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 5,
    elevation: 2,
  },
  licCardInnerWhite: {
    backgroundColor: "#FFFFFF",
    borderRadius: 13,
    paddingVertical: 7,
    paddingHorizontal: 8,
    gap: 5,
    overflow: "hidden",
  },
  licTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  licLogoContainer: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FED7AA",
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  licLogoImage: {
    width: "100%",
    height: "100%",
  },
  licInfoGroup: {
    flex: 1,
    justifyContent: "center",
  },
  licTitleText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#0F172A",
    lineHeight: 15,
  },
  licAddressGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2.5,
    marginTop: 0.5,
  },
  licAddressText: {
    fontSize: 9,
    fontFamily: Fonts.medium,
    color: "#64748B",
  },

  licActiveBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 0.8,
    gap: 4,
  },
  licActiveDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  licActiveText: {
    fontSize: 9,
    fontFamily: Fonts.bold,
    letterSpacing: 0.2,
  },
  licMiddleCapsule: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFF9F4",
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "#FEEAD9",
    paddingVertical: 4,
    paddingHorizontal: 8,
    gap: 12,
  },
  licCapsuleCol: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  licCapsuleSub: {
    fontSize: 7.5,
    fontFamily: Fonts.medium,
    color: "#94A3B8",
    lineHeight: 9,
  },
  licCapsuleDate: {
    fontSize: 9.5,
    fontFamily: Fonts.bold,
    color: "#0F172A",
    lineHeight: 12,
  },
  licFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 1,
  },
  licFooterCopyright: {
    fontSize: 7.8,
    fontFamily: Fonts.medium,
    color: "#94A3B8",
    textAlign: "center",
  },
  inlineCheckoutBtn: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: "#F59E0B",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    ...Theme.shadowSm,
  },
  inlineCheckoutText: {
    color: "#FFF",
    fontSize: 10,
    fontFamily: Fonts.black,
  },
  holdOvertimeBadge: {
    position: "absolute",
    top: 4,
    left: 4,
    padding: 2,
    zIndex: 10,
    ...Theme.shadowSm,
  },
  qrBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    padding: 2,
    zIndex: 10,
    ...Theme.shadowSm,
  },
  terminalProcessingBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    width: 26,
    height: 26,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 11,
  },
  terminalErrorBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#ef4444",
    justifyContent: "center",
    alignItems: "center",
  },

  /* ──────────────────────────────────────────────────────────────────
   *  MOVE TABLE MODAL STYLES
   * ────────────────────────────────────────────────────────────────── */
  moveModalRoot: {
    flex: 1,
    backgroundColor: Theme.bgMain,
  },
  moveModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Theme.bgNav,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    gap: 8,
  },
  moveModalBackBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Theme.bgMuted,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Theme.border,
  },
  moveModalTitle: {
    fontSize: 17,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    textAlign: "center",
  },
  moveModalSubtitle: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textMuted,
    textAlign: "center",
    marginTop: 1,
  },

  /* Source chip banner */
  moveSourceChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Theme.bgNav,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    gap: 10,
    flexWrap: "wrap",
  },
  moveSourceChipInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Theme.primary,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  moveSourceChipLabel: {
    fontSize: 10,
    fontFamily: Fonts.bold,
    color: "rgba(255,255,255,0.7)",
    letterSpacing: 0.8,
  },
  moveSourceChipTable: {
    fontSize: 14,
    fontFamily: Fonts.black,
    color: "#fff",
  },
  moveSourceChipAmt: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "rgba(255,255,255,0.85)",
  },
  moveDestChipInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Theme.primaryLight,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1.5,
    borderColor: Theme.primaryBorder,
  },
  moveDestChipLabel: {
    fontSize: 10,
    fontFamily: Fonts.bold,
    color: Theme.primary,
    letterSpacing: 0.8,
  },
  moveDestChipTable: {
    fontSize: 14,
    fontFamily: Fonts.black,
    color: Theme.primary,
  },

  /* Search bar */
  moveSearchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: Theme.bgNav,
    borderRadius: 14,

    paddingHorizontal: 14,
    paddingVertical: 10,
    ...Theme.shadowSm,
  },
  moveSearchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: Fonts.regular,
    color: Theme.textPrimary,
    padding: 0,
    outlineStyle: "none",
  } as any,

  /* Section tabs */
  moveSectionTabsRow: {
    flexGrow: 0,
    marginBottom: 4,
  },
  moveSectionTabsContent: {
    paddingHorizontal: 16,
    gap: 8,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
  },
  moveSectionTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Theme.bgMuted,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  moveSectionTabActive: {
    backgroundColor: Theme.primary,
    borderColor: Theme.primary,
  },
  moveSectionTabText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
  },
  moveSectionTabTextActive: {
    color: "#fff",
  },

  /* Table grid */
  moveTableGrid: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 120,
    gap: 10,
  },
  moveTableCard: {
    flex: 1,
    margin: 4,
    minHeight: 90,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Theme.border,
    backgroundColor: Theme.bgCard,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    position: "relative",
    ...Theme.shadowSm,
  },
  moveTableCardSelectedSrc: {
    borderColor: Theme.primary,
    borderWidth: 2,
    backgroundColor: "#FFEFE2", // Solid light orange to fix Android elevation bug
    shadowColor: Theme.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  moveTableCardSelectedDst: {
    borderColor: Theme.primary,
    borderWidth: 2.2,
    backgroundColor: "#FFF2E6", // Solid light orange to fix Android elevation bug
    shadowColor: Theme.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
  moveTableCheckBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Theme.success,
    justifyContent: "center",
    alignItems: "center",
  },
  moveTableCardNumber: {
    fontSize: 20,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    marginBottom: 2,
  },
  moveTableStatusChip: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginTop: 2,
  },
  moveTableStatusText: {
    fontSize: 9,
    fontFamily: Fonts.bold,
    letterSpacing: 0.4,
  },
  moveTableAmt: {
    fontSize: 11,
    fontFamily: Fonts.black,
    marginTop: 2,
  },
  moveTableSection: {
    fontSize: 9,
    fontFamily: Fonts.medium,
    color: Theme.textMuted,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  moveAvailDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Theme.success,
    marginTop: 3,
  },

  /* Empty state */
  moveEmptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    gap: 12,
  },
  moveEmptyText: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textMuted,
    textAlign: "center",
  },

  /* Confirm bottom bar */
  moveConfirmBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    paddingBottom: 28,
    backgroundColor: Theme.bgNav,
    borderTopWidth: 1.5,
    borderTopColor: Theme.border,
    gap: 14,
    ...Theme.shadowLg,
  },
  moveConfirmInfo: {
    flex: 1,
    gap: 4,
  },
  moveConfirmLabel: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.textMuted,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  moveConfirmRoute: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  moveConfirmTableChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: Theme.bgMuted,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: Theme.border,
  },
  moveConfirmTableNo: {
    fontSize: 14,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  moveConfirmBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Theme.primary,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
    elevation: 4,
    shadowColor: Theme.primary,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  moveConfirmBtnText: {
    fontSize: 15,
    fontFamily: Fonts.black,
    color: "#fff",
    letterSpacing: 0.3,
  },
});
