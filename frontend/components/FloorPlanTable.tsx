/**
 * FloorPlanTable — shared table + chair visual component.
 * Used by both the Home / Floor-Plan screen and the Table Master visual editor.
 */

import React from "react";
import { View, Text, Platform } from "react-native";
import { Fonts } from "@/constants/Fonts";
import { Ionicons } from "@expo/vector-icons";

export interface ChairPosition {
  x: number;
  y: number;
  rotate?: string;
}

export interface FloorPlanTableProps {
  tableW: number;
  tableH: number;
  borderRadius: number;
  seatsCount: number;
  status: number;
  activeColor: string;
  activeBg: string;
  labelColor: string;
  textColor: string;
  label: string;
  uiText: string;
  paxCount: number;
  timeText: string;
  billAmount: number;
  customerName?: string;
  lockedByName?: string;
  chairSize: number;
  chairPositions: ChairPosition[];
  tx: number;
  ty: number;
  smallFont: number;
  numberFont: number;
  itemSize: number;
  overlayBadges?: React.ReactNode;
}

// ─────────────────────────────────────────────────────────────────
// Top-down chair: Backrest, Seat Cushion, and Front Legs
// ─────────────────────────────────────────────────────────────────
const ChairView = React.memo(({
  size,
  color,
  rotate,
}: {
  size: number;
  color: string;
  rotate?: string;
}) => {
  const dim      = Math.round(size);
  const backH    = Math.round(dim * 0.32); // backrest height
  const seatPad  = Math.round(dim * 0.12);
  const legS     = Math.max(3, Math.round(dim * 0.18));
  const br       = Math.round(dim * 0.25);

  return (
    <View
      style={{
        width: dim,
        height: dim,
        transform: rotate ? [{ rotate }] : undefined,
      }}
    >
      {/* Backrest — curved top band */}
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 2,
          right: 2,
          height: backH,
          backgroundColor: color,
          borderTopLeftRadius: br,
          borderTopRightRadius: br,
          borderBottomLeftRadius: 2,
          borderBottomRightRadius: 2,
          borderWidth: 1,
          borderColor: "rgba(0,0,0,0.12)",
        }}
      />
      {/* Seat cushion — directly touching the backrest */}
      <View
        style={{
          position: "absolute",
          top: Math.round(dim * 0.26),
          left: 0,
          right: 0,
          bottom: Math.round(dim * 0.18),
          backgroundColor: color,
          borderRadius: Math.round(dim * 0.18),
          opacity: 0.8,
          borderWidth: 1,
          borderColor: "rgba(0,0,0,0.12)",
        }}
      />
      {/* Front left leg */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: seatPad,
          width: legS,
          height: legS,
          borderRadius: 1.5,
          backgroundColor: color,
          opacity: 0.7,
        }}
      />
      {/* Front right leg */}
      <View
        style={{
          position: "absolute",
          bottom: 0,
          right: seatPad,
          width: legS,
          height: legS,
          borderRadius: 1.5,
          backgroundColor: color,
          opacity: 0.7,
        }}
      />
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────
// Main FloorPlanTable
// ─────────────────────────────────────────────────────────────────
export const FloorPlanTable = React.memo(({
  tableW,
  tableH,
  borderRadius,
  seatsCount,
  status,
  activeColor,
  activeBg,
  labelColor,
  textColor,
  label,
  uiText,
  paxCount,
  timeText,
  billAmount,
  customerName,
  lockedByName,
  chairSize,
  chairPositions,
  tx,
  ty,
  smallFont,
  numberFont,
  itemSize,
  overlayBadges,
}: FloorPlanTableProps) => {

  const isAvailable = status === 0;

  const tableBg     = isAvailable ? "#F2EDE4" : activeBg;
  const tableBorder = isAvailable ? "#C8BBA8" : activeColor;
  const borderW     = isAvailable ? 1.5 : 2;
  const chairColor  = isAvailable ? "#9E8570" : activeColor;

  // Original color: black for available, dark status color for occupied
  const numColor    = isAvailable ? "#1A1A1A" : labelColor;

  // Use the same scale formula as original: tableW / itemSize
  const scale = tableW / Math.max(itemSize, 1);

  return (
    <>
      {/* Chairs */}
      {chairPositions.map((pos, idx) => (
        <View
          key={`chair-${idx}`}
          style={{ position: "absolute", left: pos.x, top: pos.y }}
        >
          <ChairView size={chairSize} color={chairColor} rotate={pos.rotate} />
        </View>
      ))}

      {/* Table body */}
      <View
        style={{
          position: "absolute",
          left: tx,
          top: ty,
          width: tableW,
          height: tableH,
          borderRadius,
          backgroundColor: tableBg,
          borderColor: tableBorder,
          borderWidth: borderW,
          justifyContent: "center",
          alignItems: "center",
          overflow: "hidden",
          ...Platform.select({
            ios: {
              shadowColor: isAvailable ? "#7A6552" : activeColor,
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: isAvailable ? 0.12 : 0.18,
              shadowRadius: 5,
            },
            android: { elevation: 3 },
            web: {
              boxShadow: isAvailable
                ? "0 2px 8px rgba(100,80,60,0.14)"
                : ("0 2px 8px " + activeColor + "38"),
            } as any,
          }),
        }}
      >
        <View style={{ alignItems: "center", paddingHorizontal: 3 }}>

          {/* Table number */}
          <Text
            style={{
              fontFamily: Fonts.black,
              fontWeight: "900",
              fontSize: Math.max(13, numberFont * scale * 0.9),
              color: numColor,
              lineHeight: Math.max(14, numberFont * scale * 0.9) + 2,
            }}
            numberOfLines={1}
          >
            {label}
          </Text>

          {/* Status badge (occupied) */}
          {!isAvailable && (
            <View style={{
              marginTop: 2,
              paddingHorizontal: 5,
              paddingVertical: 1.5,
              borderRadius: 4,
              backgroundColor: activeColor,
              maxWidth: tableW - 8,
            }}>
              <Text
                style={{
                  fontFamily: Fonts.bold,
                  fontSize: Math.max(6, smallFont * scale * 0.78),
                  color: "#ffffff",
                  letterSpacing: 0.4,
                }}
                numberOfLines={1}
              >
                {uiText}
              </Text>
            </View>
          )}

          {/* Customer name */}
          {!isAvailable && customerName ? (
            <Text
              style={{
                fontFamily: Fonts.medium,
                fontSize: Math.max(6, (smallFont - 1) * scale * 0.75),
                color: textColor,
                marginTop: 1,
                opacity: 0.85,
              }}
              numberOfLines={1}
            >
              {customerName}
            </Text>
          ) : null}



          {/* Time + Amount (occupied, non-reserved) */}
          {status !== 0 && status !== 5 && (timeText || billAmount >= 0) ? (
            <View style={{ alignItems: "center", marginTop: 2, gap: 1 }}>
              {timeText ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                  <Ionicons
                    name="time-outline"
                    size={Math.max(7, (smallFont - 2) * scale * 0.8)}
                    color={textColor}
                  />
                  <Text
                    style={{
                      fontFamily: Fonts.medium,
                      fontSize: Math.max(6, (smallFont - 2) * scale * 0.8),
                      color: textColor,
                    }}
                  >
                    {timeText}
                  </Text>
                </View>
              ) : null}
              {billAmount >= 0 ? (
                <Text
                  style={{
                    fontFamily: Fonts.bold,
                    fontWeight: "800",
                    fontSize: Math.max(7, smallFont * scale * 0.85),
                    color: textColor,
                  }}
                >
                  {(require("../stores/companySettingsStore").useCompanySettingsStore.getState().settings.currencySymbol || "$") + billAmount.toFixed(2)}
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Reserved lock */}
          {status === 5 && (
            <View style={{ alignItems: "center", marginTop: 2 }}>
              <Ionicons name="lock-closed" size={Math.max(10, tableW * 0.14)} color={activeColor} />
              {lockedByName ? (
                <Text
                  style={{
                    fontFamily: Fonts.medium,
                    fontSize: Math.max(6, (smallFont - 2) * scale),
                    color: numColor,
                    opacity: 0.85,
                    marginTop: 1,
                  }}
                  numberOfLines={1}
                >
                  {lockedByName}
                </Text>
              ) : null}
            </View>
          )}

        </View>
      </View>

      {/* Overlay badges */}
      {overlayBadges}
    </>
  );
});

export default FloorPlanTable;
