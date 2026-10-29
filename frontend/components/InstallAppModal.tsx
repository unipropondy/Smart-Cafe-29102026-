import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  Platform,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useInstallPrompt, APP_VERSION } from "../hooks/useInstallPrompt";
import { Theme } from "../constants/theme";

export const InstallAppModal: React.FC = () => {
  return null; // Permanently disabled as requested by the user.

  const {
    isVisible,
    deviceType,
    canPromptPwa,
    triggerPwaInstall,
    dismissPrompt,
    downloadApk,
  } = useInstallPrompt();

  if (!isVisible) return null;

  const renderContent = () => {
    if (deviceType === "android") {
      return (
        <>
          <View style={styles.badgeContainer}>
            <Ionicons name="logo-android" size={18} color="#10B981" />
            <Text style={styles.badgeText}>Android Application</Text>
          </View>

          <Text style={styles.title}>Install Smart POS</Text>
          <Text style={styles.description}>
            Get the full native experience with offline support, instant launch, and receipt printing optimization.
          </Text>

          <View style={styles.actionColumn}>
            {canPromptPwa && (
              <TouchableOpacity
                style={styles.primaryButton}
                activeOpacity={0.8}
                onPress={triggerPwaInstall}
              >
                <Ionicons name="download-outline" size={20} color="#FFFFFF" />
                <Text style={styles.primaryButtonText}>Install App (Native PWA)</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={canPromptPwa ? styles.secondaryButton : styles.primaryButton}
              activeOpacity={0.8}
              onPress={downloadApk}
            >
              <Ionicons
                name="logo-android"
                size={20}
                color={canPromptPwa ? Theme.primary || "#FF8C00" : "#FFFFFF"}
              />
              <Text
                style={
                  canPromptPwa ? styles.secondaryButtonText : styles.primaryButtonText
                }
              >
                Download Android APK (Direct)
              </Text>
            </TouchableOpacity>
          </View>
        </>
      );
    }

    if (deviceType === "ios") {
      return (
        <>
          <View style={styles.badgeContainer}>
            <Ionicons name="logo-apple" size={18} color="#38BDF8" />
            <Text style={styles.badgeText}>iPhone / iPad</Text>
          </View>

          <Text style={styles.title}>Install Smart POS</Text>
          <Text style={styles.description}>
            Add Smart POS to your Home Screen for quick full-screen access.
          </Text>

          <View style={styles.stepsContainer}>
            <View style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>1</Text>
              </View>
              <Text style={styles.stepText}>
                Tap the <Ionicons name="share-outline" size={18} color="#38BDF8" />{" "}
                <Text style={styles.boldText}>Share</Text> button in Safari menu bar
              </Text>
            </View>

            <View style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>2</Text>
              </View>
              <Text style={styles.stepText}>
                Scroll down and select{" "}
                <Ionicons name="add-circle-outline" size={18} color="#10B981" />{" "}
                <Text style={styles.boldText}>Add to Home Screen</Text>
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            activeOpacity={0.8}
            onPress={dismissPrompt}
          >
            <Text style={styles.primaryButtonText}>Got It!</Text>
          </TouchableOpacity>
        </>
      );
    }

    // Desktop
    return (
      <>
        <View style={styles.badgeContainer}>
          <Ionicons name="desktop-outline" size={18} color={Theme.primary || "#FF8C00"} />
          <Text style={styles.badgeText}>Desktop Web App</Text>
        </View>

        <Text style={styles.title}>Install Smart POS App</Text>
        <Text style={styles.description}>
          Install Smart POS on your desktop for dedicated window experience, faster loading, and seamless workflow.
        </Text>

        <View style={styles.actionColumn}>
          {canPromptPwa ? (
            <TouchableOpacity
              style={styles.primaryButton}
              activeOpacity={0.8}
              onPress={triggerPwaInstall}
            >
              <Ionicons name="desktop-outline" size={20} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>Install Desktop App</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.primaryButton}
              activeOpacity={0.8}
              onPress={downloadApk}
            >
              <Ionicons name="logo-android" size={20} color="#FFFFFF" />
              <Text style={styles.primaryButtonText}>Download Android APK</Text>
            </TouchableOpacity>
          )}
        </View>
      </>
    );
  };

  return (
    <Modal
      transparent
      visible={isVisible}
      animationType="fade"
      onRequestClose={dismissPrompt}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header Icon + Close Button */}
          <View style={styles.headerRow}>
            <View style={styles.logoBox}>
              <Image
                source={require("../assets/images/logo_pos.png")}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={dismissPrompt}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={22} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Body Content */}
          {renderContent()}

          {/* Footer Dismiss / Version */}
          <View style={styles.footerRow}>
            <Text style={styles.versionText}>Version {APP_VERSION}</Text>
            <TouchableOpacity onPress={dismissPrompt} activeOpacity={0.7}>
              <Text style={styles.dismissText}>Not Now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const windowWidth = Dimensions.get("window").width;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    zIndex: 99999,
  },
  card: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: "#1E293B",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: "#334155",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 20,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  logoBox: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: "rgba(255, 140, 0, 0.12)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 140, 0, 0.25)",
  },
  logoImage: {
    width: 42,
    height: 42,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#334155",
    justifyContent: "center",
    alignItems: "center",
  },
  badgeContainer: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#0F172A",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: "#334155",
  },
  badgeText: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "600",
  },
  title: {
    color: "#F8FAFC",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 8,
  },
  description: {
    color: "#94A3B8",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
  },
  actionColumn: {
    gap: 10,
    marginBottom: 20,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Theme.primary || "#FF8C00",
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    gap: 10,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0F172A",
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: Theme.primary || "#FF8C00",
  },
  secondaryButtonText: {
    color: Theme.primary || "#FF8C00",
    fontSize: 15,
    fontWeight: "700",
  },
  stepsContainer: {
    backgroundColor: "#0F172A",
    padding: 16,
    borderRadius: 16,
    gap: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#334155",
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Theme.primary || "#FF8C00",
    justifyContent: "center",
    alignItems: "center",
  },
  stepBadgeText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  stepText: {
    color: "#CBD5E1",
    fontSize: 13,
    flex: 1,
    lineHeight: 18,
  },
  boldText: {
    color: "#F8FAFC",
    fontWeight: "700",
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#334155",
    paddingTop: 14,
    marginTop: 4,
  },
  versionText: {
    color: "#64748B",
    fontSize: 12,
  },
  dismissText: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "600",
  },
});
