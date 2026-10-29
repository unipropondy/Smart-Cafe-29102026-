import React, { useEffect, useRef, createContext, useContext, useCallback, useState } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Fonts } from "../constants/Fonts";
import { BlurView } from "expo-blur";

// ─── Types ──────────────────────────────────────────────────────────────────
export type ToastType = "success" | "error" | "info" | "warning";

interface ToastConfig {
  message: string;
  type?: ToastType;
  duration?: number; // ms, default 3000
  subtitle?: string;
}

interface ToastContextValue {
  showToast: (config: ToastConfig) => void;
}

// ─── Config per type ─────────────────────────────────────────────────────────
const TYPE_CONFIG: Record<ToastType, {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
  border: string;
}> = {
  success: {
    icon:   "checkmark-circle",
    color:  "#10B981",
    bg:     "rgba(255, 255, 255, 0.98)",
    border: "rgba(226, 232, 240, 0.8)",
  },
  error: {
    icon:   "close-circle",
    color:  "#EF4444",
    bg:     "rgba(255, 255, 255, 0.98)",
    border: "rgba(226, 232, 240, 0.8)",
  },
  warning: {
    icon:   "warning",
    color:  "#F59E0B",
    bg:     "rgba(255, 255, 255, 0.98)",
    border: "rgba(226, 232, 240, 0.8)",
  },
  info: {
    icon:   "information-circle",
    color:  "#3B82F6",
    bg:     "rgba(255, 255, 255, 0.98)",
    border: "rgba(226, 232, 240, 0.8)",
  },
};

// ─── Context ─────────────────────────────────────────────────────────────────
const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

// ─── Single Toast Item ────────────────────────────────────────────────────────
function ToastItem({
  message,
  subtitle,
  type = "info",
  onDone,
  duration = 3000,
}: ToastConfig & { onDone: () => void }) {
  const slideY  = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const tc = TYPE_CONFIG[type];

  useEffect(() => {
    // Slide in
    Animated.parallel([
      Animated.spring(slideY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 18,
        stiffness: 220,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto dismiss
    const timer = setTimeout(() => dismiss(), duration);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(slideY, {
        toValue: -120,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => onDone());
  };

  return (
    <Animated.View
      style={[
        styles.toastWrap,
        {
          transform: [{ translateY: slideY }],
          opacity,
        },
      ]}
    >
      <View style={[styles.toast, { borderColor: tc.border, backgroundColor: "#ffffff" }]}>
        {/* Color accent strip on left */}
        <View style={[styles.accentStrip, { backgroundColor: tc.color }]} />

        {/* Icon */}
        <View style={[styles.iconWrap, { backgroundColor: `${tc.color}15` }]}>
          <Ionicons name={tc.icon} size={22} color={tc.color} />
        </View>

        {/* Text */}
        <View style={styles.textBlock}>
          <Text style={[styles.toastMsg, { color: "#0F172A" }]} numberOfLines={3}>
            {message}
          </Text>
          {subtitle ? (
            <Text style={[styles.toastSub, { color: "#475569" }]} numberOfLines={5}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {/* Dismiss */}
        <TouchableOpacity onPress={dismiss} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={18} color="#94A3B8" />
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

// ─── Provider ─────────────────────────────────────────────────────────────────
let _id = 0;

interface ToastEntry extends ToastConfig {
  id: number;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);

  const showToast = useCallback((config: ToastConfig) => {
    const id = ++_id;
    setToasts((prev) => [...prev, { ...config, id }]);
  }, []);

  const remove = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Render at top of screen */}
      <View style={styles.container} pointerEvents="box-none">
        {toasts.slice(0, 4).map((t) => (
          <ToastItem
            key={t.id}
            {...t}
            onDone={() => remove(t.id)}
          />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useToast() {
  return useContext(ToastContext);
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: Platform.OS === "ios" ? 60 : 40,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9999,
    pointerEvents: "box-none",
  },
  toastWrap: {
    width: "90%",
    maxWidth: 480,
    marginBottom: 8,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 4,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    paddingRight: 12,
    paddingVertical: 12,
    gap: 10,
  },
  accentStrip: {
    width: 4,
    alignSelf: "stretch",
    borderRadius: 0,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 4,
  },
  textBlock: {
    flex: 1,
  },
  toastMsg: {
    fontFamily: Fonts.extraBold,
    fontSize: 14,
    letterSpacing: 0.1,
  },
  toastSub: {
    color: "rgba(255,255,255,0.55)",
    fontFamily: Fonts.regular,
    fontSize: 12,
    marginTop: 2,
  },
  
  closeBtn: {
    padding: 4,
  },
});
