import React from "react";
import { View, TouchableOpacity, Text, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, usePathname } from "expo-router";
import { Theme } from "../constants/theme";
import { useToast } from "./Toast";
import * as IntentLauncher from "expo-intent-launcher";

interface WindowControlsProps {
  buttonStyle?: any;
  iconSize?: number;
  showText?: boolean;
  hideHome?: boolean;
}

export default function WindowControls({ buttonStyle, iconSize = 20, showText = false, hideHome = false }: WindowControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();

  const isHome = pathname === "/(tabs)/category" || pathname === "/category";
  const showHome = !hideHome;

  const isElectron =
    typeof window !== "undefined" &&
    ((window as any).electron ||
      (typeof navigator === "object" &&
        typeof navigator.userAgent === "string" &&
        navigator.userAgent.indexOf("Electron") >= 0));

  const showMinimize = Platform.OS === "android" || isElectron;

  const handleHome = () => {
    if (isHome) return;
    try {
      const { getOrderContext } = require("../stores/orderContextStore");
      const { useTableNavigationStore } = require("../stores/tableNavigationStore");
      const context = getOrderContext();
      if (context && context.tableId) {
        const tblIdStr = String(context.tableId);
        if (pathname.includes("summary")) {
          useTableNavigationStore.getState().setTableLastScreen(tblIdStr, "summary");
        } else if (pathname.includes("payment")) {
          useTableNavigationStore.getState().setTableLastScreen(tblIdStr, "payment");
        }
      }
    } catch (err) {
      console.warn("Failed to save table navigation state:", err);
    }
    router.replace("/(tabs)/category");
  };

  const handleMinimize = async () => {
    if (Platform.OS === "android") {
      try {
        await IntentLauncher.startActivityAsync("android.intent.action.MAIN", {
          category: "android.intent.category.HOME",
        });
      } catch (err) {
        console.warn("Failed to minimize app:", err);
      }
    } else if (isElectron) {
      try {
        if ((window as any).electron && (window as any).electron.minimize) {
          (window as any).electron.minimize();
          return;
        }
        // @ts-ignore
        const ipc = window.require ? window.require("electron").ipcRenderer : null;
        if (ipc) {
          ipc.send("minimize");
          return;
        }
      } catch (err) {
        console.warn("Electron minimize failed:", err);
      }
    }
  };

  return (
    <View style={styles.container}>
      {showHome && (
        <TouchableOpacity
          style={[styles.btn, buttonStyle]}
          onPress={handleHome}
          activeOpacity={0.7}
        >
          <Ionicons name="home" size={iconSize} color={Theme.primary} />
          {showText && <Text style={styles.btnText}>Home</Text>}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  btn: {
    height: 40,
    width: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.border,
    backgroundColor: Theme.bgCard,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: {
    fontSize: 12,
    color: Theme.primary,
    marginLeft: 4,
  },
});
