import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  PanResponder,
  ImageBackground,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { socket } from "@/constants/socket";
import { API_URL } from "@/constants/Config";
import { Fonts } from "@/constants/Fonts";
import { Theme } from "@/constants/theme";
import { FloorPlanTable } from "@/components/FloorPlanTable";

type TableItem = {
  id: string;
  label: string;
  Seats: number;
  TableType: string;
  XSize: number;
  YSize: number;
  DiningSection: number;
  XPos: number;
  YPos: number;
};

const woodFloorTexture = require("../assets/images/wood_floor_texture.jpg");

// --- CANVAS BACKGROUND COMPONENT ---
const CanvasBackground = ({ theme, children, style, isCategory = false }: { theme: string; children: React.ReactNode; style: any; isCategory?: boolean }) => {
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

// ─────────────────────────────────────────
// Grid snap helper
// ─────────────────────────────────────────
const GRID_SIZE = 30; // px on the 780-wide base canvas
const snapToGrid = (value: number, scale: number) => {
  const g = GRID_SIZE * scale;
  return Math.round(value / g) * g;
};

// ─────────────────────────────────────────
// --- DRAGGABLE TABLE ITEM COMPONENT ---
const DraggableTable = ({
  table,
  initialX,
  initialY,
  onDragEnd,
  onDragMove,
  onPress,
  isSelected,
  canvasHeight = 650,
  layoutScale = 1,
  backgroundTheme = "wood",
}: {
  table: TableItem;
  initialX: number;
  initialY: number;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDragMove?: (id: string | null, x: number, y: number, w: number, h: number) => void;
  onPress: () => void;
  isSelected: boolean;
  canvasHeight?: number;
  layoutScale?: number;
  backgroundTheme?: string;
}) => {
  const [posX, setPosX] = useState(initialX);
  const [posY, setPosY] = useState(initialY);

  useEffect(() => {
    setPosX(initialX);
    setPosY(initialY);
  }, [initialX, initialY]);

  const xSize = table.XSize !== undefined && table.XSize !== null && Number(table.XSize) > 0 ? Number(table.XSize) : 100;
  const ySize = table.YSize !== undefined && table.YSize !== null && Number(table.YSize) > 0 ? Number(table.YSize) : 80;

  let tableW = (xSize * 0.6) * layoutScale;
  let tableH = (ySize * 0.6) * layoutScale;

  // Handle dragging using PanResponder
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: () => {
          onPress();
        },
        onPanResponderMove: (evt, gestureState) => {
          const limitX = 780 * layoutScale;
          const limitY = canvasHeight * layoutScale;
          const rawX = Math.max(10, Math.min(limitX - tableW, initialX + gestureState.dx));
          const rawY = Math.max(10, Math.min(limitY - tableH, initialY + gestureState.dy));
          const snappedX = snapToGrid(rawX, layoutScale);
          const snappedY = snapToGrid(rawY, layoutScale);
          setPosX(snappedX);
          setPosY(snappedY);
          onDragMove?.(table.id, snappedX, snappedY, tableW, tableH);
        },
        onPanResponderRelease: (evt, gestureState) => {
          const limitX = 780 * layoutScale;
          const limitY = canvasHeight * layoutScale;
          const rawX = Math.max(10, Math.min(limitX - tableW, initialX + gestureState.dx));
          const rawY = Math.max(10, Math.min(limitY - tableH, initialY + gestureState.dy));
          const snappedX = snapToGrid(rawX, layoutScale);
          const snappedY = snapToGrid(rawY, layoutScale);
          onDragMove?.(null, 0, 0, 0, 0); // clear guide
          onDragEnd(table.id, snappedX, snappedY);
        },
      }),
    [initialX, initialY, canvasHeight, layoutScale, tableW, tableH]
  );

  const tableType = table.TableType ? String(table.TableType).trim().toLowerCase() : "rectangular";
  const seatsCount = table.Seats !== undefined && table.Seats !== null ? Number(table.Seats) : 4;

  let borderRadius = 8;
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
  }

  const tx = 0;
  const ty = 0;
  const cx = tableW / 2;
  const cy = tableH / 2;

  let chairSize = Math.max(16, 90 * 0.13 * layoutScale);
  if (seatsCount > 10) {
    chairSize = Math.max(10, chairSize * (10 / seatsCount) * 1.4);
  }

  const offset = 5;
  const activeColor = isSelected ? "#FF5E1A" : (backgroundTheme === "light" ? "#22C55E" : "#D1C7BD");
  const activeBg = isSelected ? "#FFF4EC" : (backgroundTheme === "light" ? "#FFFFFF" : "#FAF8F5");

  const chairColor = activeColor;
  const chairBg = "#FFFFFF";

  const chairPositions: { x: number; y: number; rotate?: string; backrestStyle?: any }[] = [];
  if (seatsCount > 0) {
    if (tableType === "round" || tableType === "oval") {
      const rx = tableW / 2;
      const ry = tableH / 2;
      const radiusOffset = chairSize / 2 + offset;
      for (let i = 0; i < seatsCount; i++) {
        const angle = (i * 2 * Math.PI) / seatsCount - Math.PI / 2;
        const x = cx + (rx + radiusOffset) * Math.cos(angle) - chairSize / 2;
        const y = cy + (ry + radiusOffset) * Math.sin(angle) - chairSize / 2;
        const rotationAngle = angle + Math.PI / 2;
        chairPositions.push({ 
          x, 
          y, 
          rotate: `${rotationAngle}rad`,
          backrestStyle: { top: 0, left: 0, right: 0, height: 2.2, borderTopLeftRadius: 1.5, borderTopRightRadius: 1.5 }
        });
      }
    } else {
      let topCount = 0, bottomCount = 0, leftCount = 0, rightCount = 0;
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

      for (let i = 0; i < topCount; i++) {
        chairPositions.push({ 
          x: tx + (i + 0.5) * (tableW / topCount) - chairSize / 2, 
          y: ty - chairSize - offset,
          // no rotate — backrest at top faces away from table
        });
      }
      for (let i = 0; i < bottomCount; i++) {
        chairPositions.push({ 
          x: tx + (i + 0.5) * (tableW / bottomCount) - chairSize / 2, 
          y: ty + tableH + offset,
          rotate: '180deg',
        });
      }
      for (let i = 0; i < leftCount; i++) {
        chairPositions.push({ 
          x: tx - chairSize - offset, 
          y: ty + (i + 0.5) * (tableH / leftCount) - chairSize / 2,
          rotate: '-90deg',
        });
      }
      for (let i = 0; i < rightCount; i++) {
        chairPositions.push({ 
          x: tx + tableW + offset, 
          y: ty + (i + 0.5) * (tableH / rightCount) - chairSize / 2,
          rotate: '90deg',
        });
      }
    }
  }

  const gradientColors: [string, string] = isSelected 
    ? ["#FFF4EC", "#FFEEDB"] 
    : (backgroundTheme === "light" ? ["#FFFFFF", "#FFFFFF"] : ["#FAF8F5", "#F0EAE1"]);
  const tableBorderColor = activeColor;

  const platePositions: { x: number; y: number }[] = [];
  if (seatsCount > 0) {
    if (tableType === "round" || tableType === "oval") {
      const plateRadiusOffset = Math.max(6, (tableW / 2) - 8);
      for (let i = 0; i < seatsCount; i++) {
        const angle = (i * 2 * Math.PI) / seatsCount - Math.PI / 2;
        platePositions.push({ 
          x: tableW / 2 + plateRadiusOffset * Math.cos(angle), 
          y: tableH / 2 + plateRadiusOffset * Math.sin(angle) 
        });
      }
    } else {
      let topCount = 0, bottomCount = 0, leftCount = 0, rightCount = 0;
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

      for (let i = 0; i < topCount; i++) platePositions.push({ x: (i + 0.5) * (tableW / topCount), y: distFromEdge });
      for (let i = 0; i < bottomCount; i++) platePositions.push({ x: (i + 0.5) * (tableW / bottomCount), y: tableH - distFromEdge });
      for (let i = 0; i < leftCount; i++) platePositions.push({ x: distFromEdgeH, y: (i + 0.5) * (tableH / leftCount) });
      for (let i = 0; i < rightCount; i++) platePositions.push({ x: tableW - distFromEdgeH, y: (i + 0.5) * (tableH / rightCount) });
    }
  }

  return (
    <View
      {...panResponder.panHandlers}
      style={{
        position: "absolute",
        left: posX,
        top: posY,
        width: tableW,
        height: tableH,
        backgroundColor: "transparent",
        padding: 8,
        ...Platform.select({
          web: { 
            cursor: "move",
            userSelect: "none",
            touchAction: "none",
          } as any,
        }),
      }}
    >
      {/* ── Shared FloorPlanTable: table body + chairs ── */}
      <FloorPlanTable
        tableW={tableW}
        tableH={tableH}
        borderRadius={borderRadius}
        seatsCount={seatsCount}
        status={0}
        activeColor={isSelected ? "#FF5E1A" : "#9E8570"}
        activeBg={"#F2EDE4"}
        labelColor={isSelected ? "#FF5E1A" : "#3D2B1A"}
        textColor={isSelected ? "#CC4A10" : "#6B5242"}
        label={table.label}
        uiText={""}
        paxCount={seatsCount}
        timeText={""}
        billAmount={-1}
        chairSize={chairSize}
        chairPositions={chairPositions}
        tx={tx}
        ty={ty}
        smallFont={8}
        numberFont={13}
        itemSize={Math.max(tableW, tableH)}
      />
    </View>
  );
};

export default function TableMasterScreen() {
  const router = useRouter();
  
  // Loading & State
  const [tables, setTables] = useState<TableItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTable, setSelectedTable] = useState<TableItem | null>(null);
  const [activeSection, setActiveSection] = useState("1"); // Active Section selection state
  const [isEditingLayout, setIsEditingLayout] = useState(false);

  // Edit fields (for selected table update config)
  const [seats, setSeats] = useState(4);
  const [tableType, setTableType] = useState("Rectangular");
  const [xSize, setXSize] = useState(100);
  const [ySize, setYSize] = useState(80);
  const [saving, setSaving] = useState(false);

  // Add Table Modal Fields
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [newTableNo, setNewTableNo] = useState("");
  const [newSection, setNewSection] = useState("1");
  const [newSeats, setNewSeats] = useState(4);
  const [newShape, setNewShape] = useState("Rectangular");
  const [newWidth, setNewWidth] = useState(100);
  const [newHeight, setNewHeight] = useState(80);
  const [creating, setCreating] = useState(false);

  const [availableWidth, setAvailableWidth] = useState(780);

  // Snap guide state — set while a table is being dragged
  const [snapGuide, setSnapGuide] = useState<{
    id: string; x: number; y: number; w: number; h: number;
  } | null>(null);

  const handleDragMove = (
    id: string | null, x: number, y: number, w: number, h: number
  ) => {
    if (id === null) { setSnapGuide(null); return; }
    setSnapGuide({ id, x, y, w, h });
  };

  // Custom alert & confirmation modal states
  const [confirmModalVisible, setConfirmModalVisible] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState("");
  const [confirmMessage, setConfirmMessage] = useState("");
  const [confirmOnSuccess, setConfirmOnSuccess] = useState<(() => void) | null>(null);
  const [isConfirmAlertOnly, setIsConfirmAlertOnly] = useState(false);

  const showCustomConfirm = (title: string, message: string, onConfirm: () => void, isAlertOnly = false) => {
    setConfirmTitle(title);
    setConfirmMessage(message);
    setConfirmOnSuccess(() => onConfirm);
    setIsConfirmAlertOnly(isAlertOnly);
    setConfirmModalVisible(true);
  };

  const onContainerLayout = (event: any) => {
    const { width } = event.nativeEvent.layout;
    if (width > 0) {
      setAvailableWidth(width - 32); // 16px padding on left/right
    }
  };

  const [backgroundTheme, setBackgroundTheme] = useState("champagne_fizz");

  const loadBackgroundTheme = async () => {
    try {
      const saved = await AsyncStorage.getItem(`layout_background_theme_${activeSection}`);
      if (saved === "champagne" || saved === "champagne_fizz" || saved === "citrine" || saved === "champagne_glass" || saved === "cloud_nine") {
        setBackgroundTheme(saved);
      } else {
        setBackgroundTheme("champagne_fizz");
      }
    } catch (e) {
      console.error(e);
    }
  };

  const updateBackgroundTheme = async (themeName: string) => {
    try {
      await AsyncStorage.setItem(`layout_background_theme_${activeSection}`, themeName);
      setBackgroundTheme(themeName);
      if (socket) {
        socket.emit("table_config_updated", {});
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadBackgroundTheme();
  }, [activeSection]);

  // Load tables
  const fetchTables = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/tables/all`);
      if (!res.ok) throw new Error("Failed to fetch tables");
      const data = await res.json();
      
      const mapped: TableItem[] = (Array.isArray(data) ? data : []).map((t: any) => ({
        id: String(t.TableId || t.id || "").replace(/^\{|\}$/g, "").trim().toLowerCase(),
        label: t.TableNumber || t.label,
        Seats: t.Seats !== undefined && t.Seats !== null ? Number(t.Seats) : 4,
        TableType: t.TableType || "Rectangular",
        XSize: t.XSize !== undefined && t.XSize !== null ? Number(t.XSize) : 100,
        YSize: t.YSize !== undefined && t.YSize !== null ? Number(t.YSize) : 80,
        DiningSection: Number(t.DiningSection) || 1,
        XPos: t.XPos !== undefined && t.XPos !== null ? Number(t.XPos) : 0,
        YPos: t.YPos !== undefined && t.YPos !== null ? Number(t.YPos) : 0,
      }));
      
      setTables(mapped);
      return mapped;
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not load tables.");
      return [];
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTables();
  }, []);

  const selectAndLoadTable = (table: TableItem) => {
    setSelectedTable(table);
    setSeats(table.Seats);
    setTableType(table.TableType || "Rectangular");
    setXSize(table.XSize);
    setYSize(table.YSize);
  };

  // Section tables filter
  const sectionTables = useMemo(() => {
    return tables.filter((t) => String(t.DiningSection) === activeSection);
  }, [tables, activeSection]);

  // Check if any table in the active section has customized layout coordinates saved
  const hasCustomLayout = useMemo(() => {
    return sectionTables.some((t) => t.XPos > 0 || t.YPos > 0);
  }, [sectionTables]);
  // Dynamic Canvas Height based on tables coordinates in active section
  const canvasHeight = useMemo(() => {
    const maxY = sectionTables.reduce((max, t) => Math.max(max, t.YPos), 0);
    return Math.max(650, maxY + 140);
  }, [sectionTables]);
  // Section search filter (left panel list)
  const filteredTables = useMemo(() => {
    return sectionTables.filter(
      (t) =>
        t.label.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [sectionTables, searchQuery]);

  // Section capacity calculations
  const totalSeats = useMemo(() => {
    return sectionTables.reduce((acc, t) => acc + t.Seats, 0);
  }, [sectionTables]);

  // Handle Drag Position Updates
  const handleDragEnd = (id: string, x: number, y: number) => {
    const layoutScale = availableWidth / 780;
    const baseX = Math.round(x / layoutScale);
    const baseY = Math.round(y / layoutScale);

    setTables((prev) =>
      prev.map((t) => (t.id === id ? { ...t, XPos: baseX, YPos: baseY } : t))
    );
    // Sync active selection details if it's the one being dragged
    if (selectedTable && selectedTable.id === id) {
      setSelectedTable((prev) => (prev ? { ...prev, XPos: baseX, YPos: baseY } : null));
    }
  };

  // Handle Save Layout (bulk positions save)
  const handleSaveLayout = async () => {
    try {
      setSaving(true);
      // Prepare positions array for backend
      const positions = sectionTables.map((t) => ({
        id: t.id,
        xPos: t.XPos,
        yPos: t.YPos,
        tableType: t.TableType,
        xSize: t.XSize,
        ySize: t.YSize,
      }));

      const response = await fetch(`${API_URL}/api/tables/save-positions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions }),
      });

      if (!response.ok) throw new Error("Failed to save layout positions");
      
      Alert.alert("Success", `Section ${activeSection} layout saved successfully.`);
      fetchTables();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not save layout positions.");
    } finally {
      setSaving(false);
    }
  };

  // Handle Reset Layout (discard custom positions, reset to standard grid layout)
  const handleResetToPrevious = () => {
    console.log("👉 [Reset Clicked] activeSection:", activeSection);

    const performReset = async () => {
      try {
        setSaving(true);
        console.log("🔄 [Reset Action] Mapping and resetting tables to 0...");
        const updatedTables = tables.map((t) =>
          String(t.DiningSection) === activeSection
            ? { ...t, XPos: 0, YPos: 0, TableType: "Rectangular", Seats: 4, XSize: 100, YSize: 80 }
            : t
        );
        setTables(updatedTables);
        setIsEditingLayout(false);

        const sectionTablesToReset = updatedTables.filter(t => String(t.DiningSection) === activeSection);
        console.log("📦 [Reset Action] Payload size:", sectionTablesToReset.length);
        const positions = sectionTablesToReset.map((t) => ({
          id: t.id,
          xPos: 0,
          yPos: 0,
          tableType: "Rectangular",
          xSize: 100,
          ySize: 80,
          seats: 4,
        }));

        const url = `${API_URL}/api/tables/save-positions`;
        console.log("🌐 [Reset Action] Fetching PUT URL:", url);
        const response = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ positions }),
        });

        console.log("💾 [Reset Action] Response status:", response.status);
        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Failed to reset layout on database: ${text}`);
        }

        if (socket) {
          console.log("🔌 [Reset Action] Emitting table_config_updated via socket...");
          socket.emit("table_config_updated", {});
        }

        // Fetch tables again to refresh local state/UI from DB
        await fetchTables();

        showCustomConfirm("Success", "Section layout reset to standard grid successfully!", () => {}, true);
      } catch (err: any) {
        console.error("❌ [Reset Action] Error:", err);
        showCustomConfirm("Error", err.message || "Could not save reset configuration.", () => {}, true);
      } finally {
        setSaving(false);
      }
    };

    showCustomConfirm(
      "Reset Layout",
      "Do you want to reset this section back to the standard grid layout?",
      performReset
    );
  };

  // Handle Save Config (single table updates shape, seats, width/height)
  const handleSaveConfig = async () => {
    if (!selectedTable) return;
    
    try {
      setSaving(true);
      const response = await fetch(`${API_URL}/api/tables/update-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: selectedTable.id,
          seats: Number(seats),
          tableType,
          xSize: Number(xSize),
          ySize: Number(ySize),
        }),
      });

      if (!response.ok) throw new Error("Failed to save config changes");
      
      Alert.alert("Success", `Table ${selectedTable.label} config saved successfully!`);
      fetchTables();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not save configuration.");
    } finally {
      setSaving(false);
    }
  };

  // Handle Create Table
  const handleCreateTable = async () => {
    if (!newTableNo.trim()) {
      Alert.alert("Validation Error", "Table Number/Name is required.");
      return;
    }
    
    try {
      setCreating(true);
      const response = await fetch(`${API_URL}/api/tables/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableNumber: newTableNo.trim(),
          diningSection: newSection,
          seats: newSeats,
          tableType: newShape,
          xSize: newWidth,
          ySize: newHeight,
        }),
      });

      if (!response.ok) throw new Error("Failed to create table");

      Alert.alert("Success", `Table ${newTableNo} created successfully!`);
      setIsAddModalVisible(false);
      
      // Reset fields
      setNewTableNo("");
      setNewSeats(4);
      setNewShape("Rectangular");
      setNewWidth(100);
      setNewHeight(80);
      
      fetchTables();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not create table.");
    } finally {
      setCreating(false);
    }
  };

  // Optimistic real-time local table state updates
  const updateSeats = (val: number) => {
    const finalVal = Math.max(1, val);
    setSeats(finalVal);
    if (selectedTable) {
      setTables((prev) =>
        prev.map((t) => (t.id === selectedTable.id ? { ...t, Seats: finalVal } : t))
      );
    }
  };

  const updateTableType = (val: string) => {
    setTableType(val);
    if (selectedTable) {
      setSelectedTable((prev) => (prev ? { ...prev, TableType: val } : null));
      setTables((prev) =>
        prev.map((t) => (t.id === selectedTable.id ? { ...t, TableType: val } : t))
      );
    }
  };

  const updateXSize = (val: number) => {
    setXSize(val);
    if (selectedTable) {
      setSelectedTable((prev) => (prev ? { ...prev, XSize: val } : null));
      setTables((prev) =>
        prev.map((t) => (t.id === selectedTable.id ? { ...t, XSize: val } : t))
      );
    }
  };

  const updateYSize = (val: number) => {
    setYSize(val);
    if (selectedTable) {
      setSelectedTable((prev) => (prev ? { ...prev, YSize: val } : null));
      setTables((prev) =>
        prev.map((t) => (t.id === selectedTable.id ? { ...t, YSize: val } : t))
      );
    }
  };

  // Apply visual preset sizes
  const applyPreset = (presetType: string) => {
    if (!selectedTable) return;
    let s = 4, t = "Rectangular", w = 100, h = 80;
    switch (presetType) {
      case "2pax-round":
        s = 2; t = "Round"; w = 80; h = 80;
        break;
      case "4pax-square":
        s = 4; t = "Square"; w = 90; h = 90;
        break;
      case "6pax-rectangular":
        s = 6; t = "Rectangular"; w = 120; h = 80;
        break;
      case "8pax-rectangular":
        s = 8; t = "Rectangular"; w = 150; h = 90;
        break;
    }
    setSeats(s);
    setTableType(t);
    setXSize(w);
    setYSize(h);
    setSelectedTable((prev) => (prev ? { ...prev, Seats: s, TableType: t, XSize: w, YSize: h } : null));

    setTables((prev) =>
      prev.map((item) => (item.id === selectedTable.id ? { ...item, Seats: s, TableType: t, XSize: w, YSize: h } : item))
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/(tabs)/category");
              }
            }}
            style={styles.backButton}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={20} color="#1E293B" />
          </TouchableOpacity>
          <View style={{ marginLeft: 12 }}>
            <Text style={styles.headerTitle}>Table Master visual editor</Text>
            <Text style={styles.headerSubtitle}>Drag & drop tables to rearrange section layouts visually</Text>
          </View>
        </View>
        
        {/* Quick layout status badge */}
        <View style={styles.layoutStatsBadge}>
          <View style={styles.pulsingGreen} />
          <Text style={styles.layoutStatusText}>Interactive Floor Editor</Text>
        </View>
      </View>

      {/* Section Selection Bar */}
      <View style={styles.sectionTabsBar}>
        {[
          { key: "1", label: "Section 1" },
          { key: "2", label: "Section 2" },
          { key: "3", label: "Section 3" },
          { key: "4", label: "Takeaway" },
        ].map((sec) => (
          <TouchableOpacity
            key={sec.key}
            style={[
              styles.sectionTabBtn,
              activeSection === sec.key && styles.sectionTabBtnActive,
            ]}
            onPress={() => {
              setActiveSection(sec.key);
              setSelectedTable(null); // Clear selected
              setIsEditingLayout(false); // Reset layout edit mode
            }}
            activeOpacity={0.75}
          >
            <Text
              style={[
                styles.sectionTabText,
                activeSection === sec.key && styles.sectionTabTextActive,
              ]}
            >
              {sec.label}
            </Text>
            {activeSection === sec.key && <View style={styles.sectionTabLine} />}
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Theme.primary} />
          <Text style={styles.loadingText}>Loading configurations...</Text>
        </View>
      ) : (
        <View style={styles.mainLayout}>
          {/* Center Floor Workspace Area */}
          <View style={styles.floorWorkspaceArea}>
            <View style={{ flex: 1 }}>
                <View style={styles.workspaceHeader}>
                  <View style={{ flexDirection: "row", alignItems: "center", flex: 1, gap: 8 }}>
                    <Ionicons name="cube-outline" size={18} color="#FF5E1A" />
                    <Text style={styles.workspaceTitle}>INTERACTIVE VISUAL CANVAS</Text>
                    <Text style={styles.workspaceInstruction}>Drag tables directly to change layout positions</Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    {/* Background Floor Themes Selector */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginRight: 8 }}>
                      <Text style={{ fontFamily: Fonts.medium, fontSize: 10, color: "#64748B", marginRight: 2 }}>FLOOR:</Text>
                      {[
                        { id: "champagne_fizz", label: "Champagne Fizz", color: "#FAF7F2" },
                        { id: "citrine", label: "Citrine Mesh", color: "#FACC15" },
                        { id: "champagne", label: "Champagne Grain", color: "#FCD34D" },
                        { id: "champagne_glass", label: "Champagne Glass", color: "#F59E0B" },
                        { id: "cloud_nine", label: "Cloud Nine", color: "#FED7AA" }
                      ].map((theme) => {
                        const isThemeActive = backgroundTheme === theme.id;
                        return (
                          <TouchableOpacity
                            key={theme.id}
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 9,
                              backgroundColor: theme.color,
                              borderWidth: isThemeActive ? 2 : 0.5,
                              borderColor: isThemeActive ? "#FF5E1A" : "#CBD5E1",
                              justifyContent: "center",
                              alignItems: "center"
                            }}
                            onPress={() => updateBackgroundTheme(theme.id)}
                            activeOpacity={0.8}
                          />
                        );
                      })}
                    </View>
                    {/* Reset Button */}
                    <TouchableOpacity
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        backgroundColor: "#F5F0E8",
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: "#E8E0D5",
                      }}
                      onPress={handleResetToPrevious}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="refresh-outline" size={14} color="#6B6B6B" style={{ marginRight: 4 }} />
                      <Text style={{ fontFamily: Fonts.bold, fontSize: 11, color: "#6B6B6B" }}>Reset to Grid</Text>
                    </TouchableOpacity>
                    {/* Grid Snap indicator */}
                    <View style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: snapGuide ? "rgba(255,94,26,0.12)" : "#F5F0E8",
                      paddingHorizontal: 9,
                      paddingVertical: 5,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: snapGuide ? "#FF5E1A" : "#E8E0D5",
                      gap: 4,
                    }}>
                      <Ionicons
                        name="magnet-outline"
                        size={13}
                        color={snapGuide ? "#FF5E1A" : "#94A3B8"}
                      />
                      <Text style={{
                        fontFamily: Fonts.bold,
                        fontSize: 10,
                        color: snapGuide ? "#FF5E1A" : "#94A3B8",
                        letterSpacing: 0.5,
                      }}>
                        {snapGuide ? "SNAPPING" : "SNAP ON"}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={{ flex: 1 }} onLayout={onContainerLayout}>
                  <ScrollView 
                    contentContainerStyle={{ padding: 16, paddingBottom: 80 }}
                    showsVerticalScrollIndicator={false}
                    style={{ flex: 1 }}
                  >
                    <CanvasBackground
                      theme={backgroundTheme}
                      style={[styles.floorWorkspaceCanvas, { width: availableWidth, height: canvasHeight * (availableWidth / 780) }]}
                    >
                      {/* Subtle floor plan blueprint grids (edit mode only) */}
                      {(() => {
                        let gridLineColor = "rgba(232, 224, 213, 0.4)";
                        if (backgroundTheme === "dark") gridLineColor = "rgba(255, 255, 255, 0.04)";
                        if (backgroundTheme === "emerald") gridLineColor = "rgba(255, 255, 255, 0.05)";
                        if (backgroundTheme === "grey") gridLineColor = "rgba(0, 0, 0, 0.06)";
                        if (backgroundTheme === "wood") gridLineColor = "rgba(255, 255, 255, 0.07)";
                        if (backgroundTheme === "light") gridLineColor = "rgba(0, 0, 0, 0.04)";

                        return (
                          <View style={styles.blueprintGrid} pointerEvents="none">
                            {Array.from({ length: Math.ceil((canvasHeight * (availableWidth / 780)) / (30 * (availableWidth / 780))) }).map((_, i) => (
                              <View key={`grid-h-${i}`} style={[styles.gridLineH, { top: (i + 1) * 30 * (availableWidth / 780), backgroundColor: gridLineColor }]} />
                            ))}
                            {Array.from({ length: 32 }).map((_, i) => (
                              <View key={`grid-v-${i}`} style={[styles.gridLineV, { left: (i + 1) * 30 * (availableWidth / 780), backgroundColor: gridLineColor }]} />
                            ))}
                          </View>
                        );
                      })()}

                      {/* Render Draggable Tables */}
                      {(() => {
                        const layoutScale = availableWidth / 780;

                        return sectionTables.map((t, index) => {
                          // Default coordinates layout if not yet set
                          const defaultX = (t.XPos || 30 + (index % 4) * 170) * layoutScale;
                          const defaultY = (t.YPos || 30 + Math.floor(index / 4) * 120) * layoutScale;

                          return (
                            <DraggableTable
                              key={t.id}
                              table={t}
                              initialX={defaultX}
                              initialY={defaultY}
                              onDragEnd={handleDragEnd}
                              onDragMove={handleDragMove}
                              onPress={() => selectAndLoadTable(t)}
                              isSelected={selectedTable?.id === t.id}
                              canvasHeight={canvasHeight}
                              layoutScale={layoutScale}
                              backgroundTheme={backgroundTheme}
                            />
                          );
                        });
                      })()}

                      {/* ── Snap Alignment Guides ── */}
                      {snapGuide && (() => {
                        const cx = snapGuide.x + snapGuide.w / 2;
                        const cy = snapGuide.y + snapGuide.h / 2;
                        const guideColor = "rgba(255,94,26,0.65)";
                        const canW = availableWidth;
                        const canH = canvasHeight * (availableWidth / 780);
                        return (
                          <View
                            style={{ position: "absolute", inset: 0 }}
                            pointerEvents="none"
                          >
                            {/* Horizontal guide line */}
                            <View style={{
                              position: "absolute",
                              left: 0, right: 0,
                              top: cy - 0.75,
                              height: 1.5,
                              backgroundColor: guideColor,
                            }} />
                            {/* Vertical guide line */}
                            <View style={{
                              position: "absolute",
                              top: 0, bottom: 0,
                              left: cx - 0.75,
                              width: 1.5,
                              backgroundColor: guideColor,
                            }} />
                            {/* Center dot */}
                            <View style={{
                              position: "absolute",
                              left: cx - 5,
                              top: cy - 5,
                              width: 10, height: 10,
                              borderRadius: 5,
                              backgroundColor: "#FF5E1A",
                              borderWidth: 2,
                              borderColor: "#fff",
                              shadowColor: "#FF5E1A",
                              shadowOpacity: 0.6,
                              shadowRadius: 4,
                              shadowOffset: { width: 0, height: 0 },
                              elevation: 6,
                            }} />
                            {/* Edge tick — top */}
                            <View style={{
                              position: "absolute",
                              left: cx - 3,
                              top: snapGuide.y - 6,
                              width: 6, height: 6,
                              borderRadius: 3,
                              backgroundColor: guideColor,
                            }} />
                            {/* Edge tick — bottom */}
                            <View style={{
                              position: "absolute",
                              left: cx - 3,
                              top: snapGuide.y + snapGuide.h,
                              width: 6, height: 6,
                              borderRadius: 3,
                              backgroundColor: guideColor,
                            }} />
                            {/* Coordinate pill */}
                            <View style={{
                              position: "absolute",
                              left: Math.min(cx + 8, canW - 80),
                              top: Math.max(cy - 26, 4),
                              backgroundColor: "rgba(255,94,26,0.9)",
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                              borderRadius: 6,
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 4,
                            }}>
                              <Text style={{
                                fontFamily: Fonts.bold,
                                fontSize: 10,
                                color: "#fff",
                                letterSpacing: 0.3,
                              }}>
                                {`X:${Math.round(snapGuide.x / (availableWidth / 780))}  Y:${Math.round(snapGuide.y / (availableWidth / 780))}`}
                              </Text>
                            </View>
                          </View>
                        );
                      })()}
                    </CanvasBackground>
                  </ScrollView>
                </View>
              </View>
          </View>

          {/* Right sidebar: Configurator (for selected table metadata changes) */}
          <View style={styles.rightSidebarPanel}>
            {selectedTable ? (
              <ScrollView contentContainerStyle={styles.editorScroll} showsVerticalScrollIndicator={false}>
                <View style={styles.editorCard}>
                  <View style={styles.editorHeadingRow}>
                    <Ionicons name="options-outline" size={18} color="#FF5E1A" />
                    <Text style={styles.editorHeader}>
                      Properties: Table {selectedTable.label}
                    </Text>
                  </View>

                  <View style={styles.inputDivider} />
                  
                  {/* Table shape selector */}
                  <View style={styles.inputGroup}>
                    <Text style={styles.label}>TABLE SHAPE</Text>
                    <View style={styles.shapesRow}>
                      {[
                        { name: "Rectangular", icon: "square-outline" },
                        { name: "Square", icon: "stop-outline" },
                        { name: "Round", icon: "ellipse-outline" },
                        { name: "Oval", icon: "egg-outline" }
                      ].map((item) => {
                        const isActive = tableType.toLowerCase() === item.name.toLowerCase();
                        return (
                          <TouchableOpacity
                            key={item.name}
                            style={[
                              styles.shapeSelectBtn,
                              isActive && styles.shapeSelectActive,
                            ]}
                            onPress={() => updateTableType(item.name)}
                            activeOpacity={0.7}
                          >
                            <Ionicons 
                              name={item.icon as any} 
                              size={14} 
                              color={isActive ? "#FFFFFF" : "#475569"} 
                              style={{ marginRight: 4 }} 
                            />
                            <Text
                              style={[
                                styles.shapeSelectText,
                                isActive && styles.shapeSelectTextActive,
                              ]}
                            >
                              {item.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>

                  <View style={styles.inputDivider} />

                  {/* Width & Height Dimensions */}
                  <Text style={styles.label}>PHYSICAL FLOOR SIZE</Text>
                  <View style={styles.dimensionsGrid}>
                    <View style={styles.dimensionField}>
                      <Text style={styles.fieldLabel}>Width (px)</Text>
                      <View style={styles.sizeInputWrapper}>
                        <TextInput
                          style={styles.sizeInput}
                          keyboardType="numeric"
                          value={String(xSize)}
                          onChangeText={(txt) => updateXSize(Number(txt) || 0)}
                        />
                      </View>
                    </View>

                    <View style={styles.dimensionField}>
                      <Text style={styles.fieldLabel}>Height (px)</Text>
                      <View style={styles.sizeInputWrapper}>
                        <TextInput
                          style={styles.sizeInput}
                          keyboardType="numeric"
                          value={String(ySize)}
                          onChangeText={(txt) => updateYSize(Number(txt) || 0)}
                        />
                      </View>
                    </View>
                  </View>

                  {/* Save Layout & Reset buttons */}
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 24 }}>
                    <TouchableOpacity
                      style={{
                        flex: 1,
                        backgroundColor: "#F1F5F9",
                        borderWidth: 1,
                        borderColor: "#CBD5E1",
                        paddingVertical: 12,
                        borderRadius: 8,
                        justifyContent: "center",
                        alignItems: "center"
                      }}
                      onPress={handleResetToPrevious}
                      activeOpacity={0.7}
                    >
                      <Text style={{ fontFamily: Fonts.bold, fontSize: 11, color: "#475569", textAlign: "center" }}>Reset</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={{
                        flex: 1,
                        backgroundColor: "#FF5E1A",
                        paddingVertical: 12,
                        borderRadius: 8,
                        justifyContent: "center",
                        alignItems: "center"
                      }}
                      onPress={handleSaveLayout}
                      disabled={saving}
                      activeOpacity={0.8}
                    >
                      {saving ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={{ fontFamily: Fonts.bold, fontSize: 11, color: "#FFFFFF", textAlign: "center" }}>Save Layout</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </ScrollView>
            ) : (
              <View style={styles.unselectedSidebarState}>
                <Ionicons name="information-circle-outline" size={32} color="#CBD5E1" />
                <Text style={styles.unselectedSidebarText}>
                  Click on any table in the visual canvas or sidebar list to modify its seats, shape, or dimensions.
                </Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* ADD NEW TABLE CONFIG MODAL */}
      <Modal visible={isAddModalVisible} transparent animationType="fade" onRequestClose={() => setIsAddModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Ionicons name="add-circle-outline" size={22} color="#FF5E1A" style={{ marginRight: 8 }} />
                <Text style={styles.modalTitle}>Add New Table</Text>
              </View>
              <TouchableOpacity onPress={() => setIsAddModalVisible(false)}>
                <Ionicons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Table Number / Name</Text>
              <TextInput
                style={styles.modalInput}
                value={newTableNo}
                onChangeText={setNewTableNo}
                placeholder="e.g. 21, D22, TW3"
                placeholderTextColor="#94A3B8"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Dining Section</Text>
              <View style={styles.modalSectionRow}>
                {["1", "2", "3", "4"].map((sec) => (
                  <TouchableOpacity
                    key={sec}
                    style={[
                      styles.modalSecBtn,
                      newSection === sec && styles.modalSecBtnActive,
                    ]}
                    onPress={() => setNewSection(sec)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.modalSecText,
                        newSection === sec && styles.modalSecTextActive,
                      ]}
                    >
                      {sec === "4" ? "Takeaway" : `Sec ${sec}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Seats (Chairs)</Text>
              <View style={styles.seatsRow}>
                <TouchableOpacity
                  style={styles.seatsBtn}
                  onPress={() => setNewSeats(Math.max(1, newSeats - 1))}
                  activeOpacity={0.7}
                >
                  <Ionicons name="remove" size={18} color="#FFFFFF" />
                </TouchableOpacity>
                <Text style={styles.seatsValue}>{newSeats}</Text>
                <TouchableOpacity
                  style={styles.seatsBtn}
                  onPress={() => setNewSeats(newSeats + 1)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add" size={18} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Table Shape</Text>
              <View style={styles.shapesRow}>
                {["Rectangular", "Square", "Round", "Oval"].map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.shapeSelectBtn,
                      newShape.toLowerCase() === type.toLowerCase() && styles.shapeSelectActive,
                    ]}
                    onPress={() => setNewShape(type)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.shapeSelectText,
                        newShape.toLowerCase() === type.toLowerCase() && styles.shapeSelectTextActive,
                      ]}
                    >
                      {type}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setIsAddModalVisible(false)}
                disabled={creating}
                activeOpacity={0.7}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalCreateBtn}
                onPress={handleCreateTable}
                disabled={creating}
                activeOpacity={0.8}
              >
                {creating ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalCreateText}>Create Table</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* BEAUTIFUL CUSTOM CONFIRM / ALERT MODAL */}
      <Modal
        visible={confirmModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={{
            width: 380,
            backgroundColor: "#FFFFFF",
            borderRadius: 24,
            padding: 24,
            alignItems: "center",
            borderWidth: 1,
            borderColor: "#E8E0D5",
            ...Platform.select({
              ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.12, shadowRadius: 16 },
              android: { elevation: 8 },
              web: { boxShadow: "0px 12px 30px rgba(15, 23, 42, 0.12)" } as any,
            }),
          }}>
            {/* Header Icon */}
            <View style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: confirmTitle.toLowerCase().includes("success") ? "#E6F4EA" : "#FFF4EC",
              justifyContent: "center",
              alignItems: "center",
              marginBottom: 16,
            }}>
              <Ionicons 
                name={isConfirmAlertOnly ? (confirmTitle.toLowerCase().includes("success") ? "checkmark-circle" : "alert-circle") : "help-circle"} 
                size={32} 
                color={confirmTitle.toLowerCase().includes("success") ? "#137333" : "#FF5E1A"} 
              />
            </View>

            {/* Title */}
            <Text style={{
              fontFamily: Fonts.bold,
              fontSize: 18,
              color: "#1C1C1E",
              marginBottom: 8,
              textAlign: "center",
            }}>
              {confirmTitle}
            </Text>

            {/* Message Body */}
            <Text style={{
              fontFamily: Fonts.medium,
              fontSize: 13,
              color: "#5F6368",
              lineHeight: 18,
              textAlign: "center",
              marginBottom: 24,
              paddingHorizontal: 8,
            }}>
              {confirmMessage}
            </Text>

            {/* Buttons Row */}
            <View style={{
              flexDirection: "row",
              gap: 12,
              width: "100%",
            }}>
              {!isConfirmAlertOnly && (
                <TouchableOpacity
                  style={{
                    flex: 1,
                    paddingVertical: 11,
                    borderRadius: 12,
                    borderWidth: 1.5,
                    borderColor: "#E8E0D5",
                    backgroundColor: "#FFFFFF",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                  onPress={() => setConfirmModalVisible(false)}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: "#5F6368" }}>Cancel</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={{
                  flex: 1,
                  paddingVertical: 11,
                  borderRadius: 12,
                  backgroundColor: confirmTitle.toLowerCase().includes("success") ? "#10B981" : "#FF5E1A",
                  justifyContent: "center",
                  alignItems: "center",
                  ...Platform.select({
                    web: { boxShadow: confirmTitle.toLowerCase().includes("success") ? "0 2px 4px rgba(16,185,129,0.2)" : "0 2px 4px rgba(255,94,26,0.2)" } as any,
                  }),
                }}
                onPress={() => {
                  setConfirmModalVisible(false);
                  if (confirmOnSuccess) confirmOnSuccess();
                }}
                activeOpacity={0.8}
              >
                <Text style={{ fontFamily: Fonts.bold, fontSize: 13, color: "#FFFFFF" }}>
                  {isConfirmAlertOnly ? "OK" : "Yes"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FAF7F2",
  },
  header: {
    height: 70,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E8E0D5",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 3 },
      android: { elevation: 3 },
      web: { boxShadow: "0 2px 4px rgba(0,0,0,0.03)" } as any,
    }),
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    padding: 10,
    borderRadius: 10,
    backgroundColor: "#F5F0E8",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontFamily: Fonts.bold,
    fontSize: 18,
    color: "#1C1C1E",
  },
  headerSubtitle: {
    fontFamily: Fonts.regular,
    fontSize: 12,
    color: "#6B6B6B",
    marginTop: 1,
  },
  layoutStatsBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF4EC",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#FFBB9E",
  },
  pulsingGreen: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#FF5E1A",
    marginRight: 6,
  },
  layoutStatusText: {
    fontFamily: Fonts.medium,
    fontSize: 12,
    color: "#FF5E1A",
  },
  sectionTabsBar: {
    height: 48,
    flexDirection: "row",
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E8E0D5",
    paddingHorizontal: 16,
  },
  sectionTabBtn: {
    paddingHorizontal: 20,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  sectionTabBtnActive: {},
  sectionTabText: {
    fontFamily: Fonts.medium,
    fontSize: 14,
    color: "#6B6B6B",
  },
  sectionTabTextActive: {
    fontFamily: Fonts.bold,
    color: "#FF5E1A",
  },
  sectionTabLine: {
    position: "absolute",
    bottom: 0,
    left: 20,
    right: 20,
    height: 3,
    backgroundColor: "#FF5E1A",
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  loadingText: {
    marginTop: 12,
    fontFamily: Fonts.medium,
    fontSize: 14,
    color: "#6B6B6B",
  },
  mainLayout: {
    flex: 1,
    flexDirection: "row",
  },
  leftPanel: {
    width: 320,
    borderRightWidth: 1,
    borderRightColor: "#E8E0D5",
    backgroundColor: "#FFFFFF",
    padding: 16,
    flexDirection: "column",
  },
  statsCard: {
    flexDirection: "row",
    backgroundColor: "#FAF7F2",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E8E0D5",
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    alignItems: "center",
    justifyContent: "space-around",
  },
  statBox: {
    alignItems: "center",
  },
  statVal: {
    fontFamily: Fonts.bold,
    fontSize: 18,
    color: "#FF5E1A",
  },
  statLbl: {
    fontFamily: Fonts.medium,
    fontSize: 10,
    color: "#6B6B6B",
    marginTop: 2,
    letterSpacing: 0.5,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: "#E8E0D5",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 14,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F0E8",
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
  },
  searchInput: {
    flex: 1,
    marginLeft: 8,
    fontFamily: Fonts.regular,
    fontSize: 13,
    color: "#1C1C1E",
  },
  addButton: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: "#FF5E1A",
    justifyContent: "center",
    alignItems: "center",
    ...Platform.select({
      web: { boxShadow: "0 2px 5px rgba(255,94,26,0.25)" } as any,
    }),
  },
  listScrollView: {
    flex: 1,
  },
  emptyListState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  emptyListText: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: "#9CA3AF",
    marginTop: 10,
  },
  tableListItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: "#E8E0D5",
  },
  tableListSelected: {
    backgroundColor: "#FFF4EC",
    borderColor: "#FF5E1A",
  },
  tableListItemTextCol: {
    flex: 1,
  },
  tableListItemLabel: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    color: "#1C1C1E",
  },
  tableListTextSelected: {
    color: "#FF5E1A",
  },
  tableListItemSub: {
    fontFamily: Fonts.medium,
    fontSize: 11,
    color: "#6B6B6B",
    marginTop: 2,
  },
  badgeContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  seatsPillBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FAF7F2",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "#E8E0D5",
    gap: 4,
  },
  seatsPillText: {
    fontFamily: Fonts.bold,
    fontSize: 11,
    color: "#6B6B6B",
  },
  saveLayoutBox: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#E8E0D5",
    marginTop: 8,
  },
  saveLayoutBtn: {
    flexDirection: "row",
    backgroundColor: "#FF5E1A",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      web: { boxShadow: "0 2px 5px rgba(255,94,26,0.3)" } as any,
    }),
  },
  saveLayoutBtnText: {
    fontFamily: Fonts.bold,
    fontSize: 13,
    color: "#FFFFFF",
  },
  floorWorkspaceArea: {
    flex: 1,
    padding: 20,
    flexDirection: "column",
    backgroundColor: "#FAF7F2",
  },
  workspaceHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  },
  workspaceTitle: {
    fontFamily: Fonts.bold,
    fontSize: 12,
    color: "#1C1C1E",
    letterSpacing: 0.5,
  },
  workspaceInstruction: {
    fontFamily: Fonts.regular,
    fontSize: 11,
    color: "#6B6B6B",
    marginLeft: 8,
  },
  floorWorkspaceCanvas: {
    backgroundColor: "#FAF7F2", // Clean neutral floor tile background
    borderRadius: 16,
    position: "relative",
    overflow: "hidden",
  },
  blueprintGrid: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  gridLineH: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(232, 224, 213, 0.4)",
  },
  gridLineV: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: "rgba(232, 224, 213, 0.4)",
  },
  rightSidebarPanel: {
    width: 320,
    borderLeftWidth: 1,
    borderLeftColor: "#E8E0D5",
    backgroundColor: "#FFFFFF",
  },
  editorScroll: {
    padding: 16,
    paddingBottom: 40,
  },
  editorCard: {
    backgroundColor: "#FFFFFF",
  },
  editorHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  editorHeader: {
    fontFamily: Fonts.bold,
    fontSize: 15,
    color: "#1C1C1E",
  },
  inputDivider: {
    height: 1,
    backgroundColor: "#F5F0E8",
    marginVertical: 14,
  },
  inputGroup: {
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  label: {
    fontFamily: Fonts.semiBold,
    fontSize: 11,
    color: "#1C1C1E",
    letterSpacing: 0.3,
  },
  labelSubText: {
    fontFamily: Fonts.medium,
    fontSize: 11,
    color: "#6B6B6B",
  },
  seatsStepperContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FAF7F2",
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#E8E0D5",
    padding: 3,
    justifyContent: "space-between",
  },
  stepperBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E8E0D5",
    justifyContent: "center",
    alignItems: "center",
  },
  stepperValueContainer: {
    alignItems: "center",
    flex: 1,
  },
  stepperValueText: {
    fontFamily: Fonts.black,
    fontSize: 16,
    color: "#FF5E1A",
  },
  shapesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  shapeSelectBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: "#FAF7F2",
    borderWidth: 1.5,
    borderColor: "#E8E0D5",
    minWidth: 80,
    justifyContent: "center",
  },
  shapeSelectActive: {
    backgroundColor: "#FF5E1A",
    borderColor: "#FF5E1A",
  },
  shapeSelectText: {
    fontFamily: Fonts.semiBold,
    fontSize: 11,
    color: "#475569",
  },
  shapeSelectTextActive: {
    color: "#FFFFFF",
  },
  presetsWrapper: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  presetBadge: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: "#F5F0E8",
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "#E8E0D5",
  },
  presetBadgeText: {
    fontFamily: Fonts.semiBold,
    fontSize: 10,
    color: "#5C3E21",
  },
  dimensionsGrid: {
    flexDirection: "row",
    gap: 10,
    marginTop: 6,
  },
  dimensionField: {
    flex: 1,
  },
  fieldLabel: {
    fontFamily: Fonts.medium,
    fontSize: 11,
    color: "#6B6B6B",
    marginBottom: 4,
  },
  sizeInputWrapper: {
    backgroundColor: "#FAF7F2",
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "#E8E0D5",
    paddingHorizontal: 10,
    height: 38,
    justifyContent: "center",
  },
  sizeInput: {
    fontFamily: Fonts.bold,
    fontSize: 13,
    color: "#1C1C1E",
    padding: 0,
  },
  saveConfigBtn: {
    backgroundColor: "#FF5E1A",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
    ...Platform.select({
      web: { boxShadow: "0 2px 4px rgba(255,94,26,0.2)" } as any,
    }),
  },
  saveConfigBtnText: {
    fontFamily: Fonts.bold,
    fontSize: 13,
    color: "#FFFFFF",
  },
  unselectedSidebarState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  unselectedSidebarText: {
    fontFamily: Fonts.regular,
    fontSize: 12,
    color: "#6B6B6B",
    lineHeight: 18,
    textAlign: "center",
    marginTop: 10,
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: 400,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: "#E8E0D5",
    ...Platform.select({
      ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.15, shadowRadius: 10 },
      android: { elevation: 8 },
      web: { boxShadow: "0px 10px 25px rgba(15,23,42,0.15)" } as any,
    }),
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: "#F5F0E8",
    paddingBottom: 10,
  },
  modalTitle: {
    fontFamily: Fonts.bold,
    fontSize: 18,
    color: "#1C1C1E",
  },
  modalInput: {
    height: 42,
    borderWidth: 1.5,
    borderColor: "#E8E0D5",
    borderRadius: 10,
    paddingHorizontal: 14,
    fontFamily: Fonts.medium,
    color: "#1C1C1E",
    backgroundColor: "#FAF7F2",
  },
  modalSectionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  modalSecBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#FAF7F2",
    borderWidth: 1.5,
    borderColor: "#E8E0D5",
  },
  modalSecBtnActive: {
    backgroundColor: "#FF5E1A",
    borderColor: "#FF5E1A",
  },
  modalSecText: {
    fontFamily: Fonts.semiBold,
    fontSize: 12,
    color: "#6B6B6B",
  },
  modalSecTextActive: {
    color: "#FFFFFF",
  },
  seatsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  seatsBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#FF5E1A",
    justifyContent: "center",
    alignItems: "center",
  },
  seatsValue: {
    fontFamily: Fonts.bold,
    fontSize: 18,
    color: "#1C1C1E",
    minWidth: 20,
    textAlign: "center",
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 12,
  },
  modalCancelBtn: {
    paddingVertical: 11,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: "#F5F0E8",
  },
  modalCancelText: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    color: "#6B6B6B",
  },
  modalCreateBtn: {
    paddingVertical: 11,
    paddingHorizontal: 22,
    borderRadius: 10,
    backgroundColor: "#FF5E1A",
    alignItems: "center",
    minWidth: 130,
    ...Platform.select({
      ios: { shadowColor: "#FF5E1A", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3 },
      android: { elevation: 3 },
      web: { boxShadow: "0 2px 5px rgba(255,94,26,0.25)" } as any,
    }),
  },
  modalCreateText: {
    fontFamily: Fonts.bold,
    fontSize: 14,
    color: "#FFFFFF",
  },
});
