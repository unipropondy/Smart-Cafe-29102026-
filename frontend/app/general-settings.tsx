import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
    ActivityIndicator,
    Animated,
    Easing,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    useWindowDimensions,
    View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useToast } from "../components/Toast";
import { API_URL } from "../constants/Config";
import { Fonts } from "../constants/Fonts";
import { Theme } from "../constants/theme";
import { useAuthStore } from "../stores/authStore";
import { useGeneralSettingsStore } from "../stores/generalSettingsStore";
import AuditLogModal from "../components/AuditLogModal";

// ── SLEEK COMPACT ANIMATED SWITCH COMPONENT ──
interface CustomSwitchProps {
  value: boolean;
  onValueChange: (val: boolean) => void;
  disabled?: boolean;
}

const CustomSwitch = ({
  value,
  onValueChange,
  disabled = false,
}: CustomSwitchProps) => {
  const animatedValue = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: value ? 1 : 0,
      duration: 180,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: false,
    }).start();
  }, [value]);

  const translateX = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: [3, 25],
  });

  const backgroundColor = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["#E2E8F0", Theme.primary],
  });

  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.8}
      onPress={() => !disabled && onValueChange(!value)}
      style={styles.switchTouchArea}
    >
      <Animated.View
        style={[
          styles.switchContainer,
          { backgroundColor },
          disabled && { opacity: 0.5 },
        ]}
      >
        <Animated.View
          style={[styles.switchThumb, { transform: [{ translateX }] }]}
        />
      </Animated.View>
    </TouchableOpacity>
  );
};

export default function GeneralSettingsScreen() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const router = useRouter();
  const { showToast } = useToast();
  const { user } = useAuthStore();

  const { settings, loading, fetchSettings, updateSettings } =
    useGeneralSettingsStore();

  // Local setting states
  const [enableKOT, setEnableKOT] = useState(settings.enableKOT);
  const [enableKDS, setEnableKDS] = useState(settings.enableKDS);
  const [enableCheckoutBill, setEnableCheckoutBill] = useState(
    settings.enableCheckoutBill,
  );
  const [enableCheckoutFlow, setEnableCheckoutFlow] = useState(
    settings.enableCheckoutFlow,
  );
  const [enableDirectProcessToPay, setEnableDirectProcessToPay] = useState(
    settings.enableDirectProcessToPay,
  );
  const [customerSideDisplay, setCustomerSideDisplay] = useState(
    settings.customerSideDisplay,
  );
  const [enableGuestDetailsPopup, setEnableGuestDetailsPopup] = useState(
    settings.enableGuestDetailsPopup,
  );
  const [enableCashDrawer, setEnableCashDrawer] = useState(
    settings.enableCashDrawer !== undefined ? settings.enableCashDrawer : true,
  );
  const [SVCIdentification, setSVCIdentification] = useState(
    settings.SVCIdentification !== undefined
      ? settings.SVCIdentification
      : true,
  );
  const [enableKDSPrint, setEnableKDSPrint] = useState(
    settings.enableKDSPrint !== undefined ? settings.enableKDSPrint : true,
  );
  const [enableCombo, setEnableCombo] = useState(
    settings.enableCombo !== undefined ? settings.enableCombo : true,
  );
  const [enableQuickServe, setEnableQuickServe] = useState(
    settings.enableQuickServe !== undefined ? settings.enableQuickServe : true,
  );
  const [showLoyalty, setShowLoyalty] = useState(
    settings.showLoyalty !== undefined ? settings.showLoyalty : true,
  );
  const [showRewardPoints, setShowRewardPoints] = useState(
    settings.showRewardPoints !== undefined ? settings.showRewardPoints : true,
  );
  const [showPromoCode, setShowPromoCode] = useState(
    settings.showPromoCode !== undefined ? settings.showPromoCode : true,
  );
  const [enableOnlinePayment, setEnableOnlinePayment] = useState(
    settings.enableOnlinePayment !== undefined
      ? settings.enableOnlinePayment
      : true,
  );
  const [enableQROrderAutoPrint, setEnableQROrderAutoPrint] = useState(
    settings.enableQROrderAutoPrint !== undefined
      ? settings.enableQROrderAutoPrint
      : true,
  );
  const [enableComboPrint, setEnableComboPrint] = useState(
    settings.enableComboPrint !== undefined ? settings.enableComboPrint : false,
  );
  const [enableRequestService, setEnableRequestService] = useState(
    settings.enableRequestService !== undefined
      ? settings.enableRequestService
      : true,
  );
  const [enableCookingInstructions, setEnableCookingInstructions] = useState(
    settings.enableCookingInstructions !== undefined
      ? settings.enableCookingInstructions
      : true,
  );
  const [enableDirectPaymentToProcess, setEnableDirectPaymentToProcess] =
    useState(
      settings.enableDirectPaymentToProcess !== undefined
        ? settings.enableDirectPaymentToProcess
        : false,
    );
  const [enableSkipSummaryScreen, setEnableSkipSummaryScreen] = useState(
    settings.enableSkipSummaryScreen !== undefined
      ? settings.enableSkipSummaryScreen
      : false,
  );
  const [enableReceiptPrint, setEnableReceiptPrint] = useState(
    settings.enableReceiptPrint !== undefined
      ? settings.enableReceiptPrint
      : true,
  );
  const [enableVoiceSuccess, setEnableVoiceSuccess] = useState(
    settings.enableVoiceSuccess !== undefined
      ? settings.enableVoiceSuccess
      : true,
  );
  const [enableNotificationSound, setEnableNotificationSound] = useState(
    settings.enableNotificationSound !== undefined
      ? settings.enableNotificationSound
      : true,
  );
  const [enableQRTWPayAtCashier, setEnableQRTWPayAtCashier] = useState(
    settings.enableQRTWPayAtCashier !== undefined
      ? settings.enableQRTWPayAtCashier
      : true,
  );

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [passwordValue, setPasswordValue] = useState("");
  const [verifyingPassword, setVerifyingPassword] = useState(false);
  const [pendingCashDrawerValue, setPendingCashDrawerValue] = useState<
    boolean | null
  >(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  useEffect(() => {
    setEnableKOT(settings.enableKOT);
    setEnableKDS(settings.enableKDS);
    setEnableCheckoutBill(settings.enableCheckoutBill);
    setCustomerSideDisplay(settings.customerSideDisplay);
    setEnableGuestDetailsPopup(
      settings.enableGuestDetailsPopup !== undefined
        ? settings.enableGuestDetailsPopup
        : true,
    );
    setEnableCashDrawer(
      settings.enableCashDrawer !== undefined
        ? settings.enableCashDrawer
        : true,
    );
    setSVCIdentification(
      settings.SVCIdentification !== undefined
        ? settings.SVCIdentification
        : true,
    );
    setEnableKDSPrint(
      settings.enableKDSPrint !== undefined ? settings.enableKDSPrint : true,
    );
    setEnableCombo(
      settings.enableCombo !== undefined ? settings.enableCombo : true,
    );
    setEnableQuickServe(
      settings.enableQuickServe !== undefined ? settings.enableQuickServe : true,
    );
    setShowLoyalty(
      settings.showLoyalty !== undefined ? settings.showLoyalty : true,
    );
    setShowRewardPoints(
      settings.showRewardPoints !== undefined
        ? settings.showRewardPoints
        : true,
    );
    setShowPromoCode(
      settings.showPromoCode !== undefined ? settings.showPromoCode : true,
    );
    setEnableOnlinePayment(
      settings.enableOnlinePayment !== undefined
        ? settings.enableOnlinePayment
        : true,
    );
    setEnableQROrderAutoPrint(
      settings.enableQROrderAutoPrint !== undefined
        ? settings.enableQROrderAutoPrint
        : true,
    );
    setEnableComboPrint(
      settings.enableComboPrint !== undefined
        ? settings.enableComboPrint
        : false,
    );
    setEnableRequestService(
      settings.enableRequestService !== undefined
        ? settings.enableRequestService
        : true,
    );
    setEnableCookingInstructions(
      settings.enableCookingInstructions !== undefined
        ? settings.enableCookingInstructions
        : true,
    );
    let initialCheckoutFlow =
      settings.enableCheckoutFlow !== undefined
        ? settings.enableCheckoutFlow
        : true;
    let initialDirectProcess =
      settings.enableDirectProcessToPay !== undefined
        ? settings.enableDirectProcessToPay
        : false;
    let initialDirectPayment =
      settings.enableDirectPaymentToProcess !== undefined
        ? settings.enableDirectPaymentToProcess
        : false;

    // Enforce mutual exclusivity on load: if more than one is true, resolve conflict
    if (initialCheckoutFlow) {
      initialDirectProcess = false;
      initialDirectPayment = false;
    } else if (initialDirectProcess) {
      initialCheckoutFlow = false;
      initialDirectPayment = false;
    } else if (initialDirectPayment) {
      initialCheckoutFlow = false;
      initialDirectProcess = false;
    } else {
      // If all are false, default to standard Checkout Flow
      initialCheckoutFlow = true;
      initialDirectProcess = false;
      initialDirectPayment = false;
    }

    setEnableCheckoutFlow(initialCheckoutFlow);
    setEnableDirectProcessToPay(initialDirectProcess);
    setEnableDirectPaymentToProcess(initialDirectPayment);
    setEnableSkipSummaryScreen(
      settings.enableSkipSummaryScreen !== undefined
        ? settings.enableSkipSummaryScreen
        : false,
    );
    setEnableReceiptPrint(
      settings.enableReceiptPrint !== undefined
        ? settings.enableReceiptPrint
        : true,
    );
    setEnableVoiceSuccess(
      settings.enableVoiceSuccess !== undefined
        ? settings.enableVoiceSuccess
        : true,
    );
    setEnableNotificationSound(
      settings.enableNotificationSound !== undefined
        ? settings.enableNotificationSound
        : true,
    );
    setEnableQRTWPayAtCashier(
      settings.enableQRTWPayAtCashier !== undefined
        ? settings.enableQRTWPayAtCashier
        : true,
    );
  }, [settings]);

  const [passwordAction, setPasswordAction] = useState<
    "CASHDRAWER" | "SAVE" | null
  >(null);
  const [passwordError, setPasswordError] = useState("");

  const handleToggleCheckoutFlow = (val: boolean) => {
    if (val) {
      setEnableCheckoutFlow(true);
      setEnableDirectProcessToPay(false);
      setEnableDirectPaymentToProcess(false);
    }
  };

  const handleToggleDirectProcessToPay = (val: boolean) => {
    if (val) {
      setEnableDirectProcessToPay(true);
      setEnableCheckoutFlow(false);
      setEnableDirectPaymentToProcess(false);
    }
  };

  const handleToggleDirectPaymentToProcess = (val: boolean) => {
    if (val) {
      setEnableDirectPaymentToProcess(true);
      setEnableCheckoutFlow(false);
      setEnableDirectProcessToPay(false);
    }
  };

  const handleToggleCashDrawer = (val: boolean) => {
    setPendingCashDrawerValue(val);
    setPasswordValue("");
    setPasswordError("");
    setPasswordAction("CASHDRAWER");
    setShowPasswordModal(true);
  };

  const executeSave = async () => {
    setSaving(true);
    const success = await updateSettings(
      {
        enableKOT,
        enableKDS,
        enableCheckoutBill,
        enableCheckoutFlow,
        enableDirectProcessToPay,
        customerSideDisplay,
        enableGuestDetailsPopup,
        enableCashDrawer,
        SVCIdentification,
        enableKDSPrint,
        enableCombo,
        enableQuickServe,
        showLoyalty,
        showRewardPoints,
        showPromoCode,
        enableOnlinePayment,
        enableQROrderAutoPrint,
        enableComboPrint,
        enableRequestService,
        enableCookingInstructions,
        enableDirectPaymentToProcess,
        enableSkipSummaryScreen,
        enableReceiptPrint,
        enableVoiceSuccess,
        enableNotificationSound,
        enableQRTWPayAtCashier,
      },
      {
        userName: user?.userName || user?.fullName || "",
        userId: user?.userId || "",
        userRole: user?.roleName || user?.role || "",
      },
    );
    setSaving(false);

    if (success) {
      showToast({ type: "success", message: "Settings saved successfully." });
      router.back();
    } else {
      showToast({
        type: "error",
        message: "Failed to save settings. Please try again.",
      });
    }
  };

  const handlePasswordVerify = async () => {
    if (!passwordValue) {
      setPasswordError("Please enter password");
      return;
    }
    setVerifyingPassword(true);
    setPasswordError("");
    try {
      const verifyRes = await fetch(`${API_URL}/api/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordValue, role: "ADMIN" }),
      });
      const verifyData = await verifyRes.json();
      if (verifyData.success) {
        setShowPasswordModal(false);
        if (
          passwordAction === "CASHDRAWER" &&
          pendingCashDrawerValue !== null
        ) {
          setEnableCashDrawer(pendingCashDrawerValue);
          showToast({ type: "success", message: "Access Unlocked" });
        } else if (passwordAction === "SAVE") {
          await executeSave();
        }
      } else {
        setPasswordError("Incorrect admin password");
      }
    } catch (err) {
      setPasswordError("Could not verify password. Check connection.");
    } finally {
      setVerifyingPassword(false);
    }
  };

  const handleSavePrompt = () => {
    setPasswordValue("");
    setPasswordError("");
    setPasswordAction("SAVE");
    setShowPasswordModal(true);
  };

  const sections = [
    {
      title: "QR Ordering & Payments",
      icon: "qr-code-outline",
      items: [
        {
          title: "QR Order Auto Print Bill",
          desc: "Automatically print the guest checkout bill/invoice on the cashier printer when a customer requests bill/checkout from QR menu.",
          icon: "print-outline",
          value: enableQROrderAutoPrint,
          onToggle: setEnableQROrderAutoPrint,
        },
        {
          title: "QR Online Payment",
          desc: "Allow QR ordering customers to pay online (PayNow). When OFF, orders use Pay at Cashier.",
          icon: "card-outline",
          value: enableOnlinePayment,
          onToggle: setEnableOnlinePayment,
        },
        {
          title: "Request Service",
          desc: "Show the Request Service section (Call Waiter, Water, Cutlery, Tissue, Request Bill) on the customer QR order-status page.",
          icon: "notifications-outline",
          value: enableRequestService,
          onToggle: setEnableRequestService,
        },
        {
          title: "Cooking Instructions",
          desc: "Show the Cooking Instructions input section on the customer QR order cart page.",
          icon: "pencil-outline",
          value: enableCookingInstructions,
          onToggle: setEnableCookingInstructions,
        },
      ],
    },
    {
      title: "QR - TW Ordering & Payments",
      icon: "bag-handle-outline",
      items: [
        {
          title: "Pay at Cashier",
          desc: "Allow QR Takeaway customers to choose 'Pay at Cashier'. When disabled, only online payment is available.",
          icon: "storefront-outline",
          value: enableQRTWPayAtCashier,
          onToggle: setEnableQRTWPayAtCashier,
        },
      ],
    },
    {
      title: "Kitchen & Order Routing",
      icon: "restaurant-outline",
      items: [
        {
          title: "KOT (Kitchen Order Ticket)",
          desc: "Enable kitchen ticket printing.",
          icon: "receipt-outline",
          value: enableKOT,
          onToggle: setEnableKOT,
        },
        {
          title: "KDS (Kitchen Display System)",
          desc: "Show kitchen display screen.",
          icon: "desktop-outline",
          value: enableKDS,
          onToggle: setEnableKDS,
        },
        {
          title: "KDS Printer Button",
          desc: "Show the PRINT button on every order card in KDS screen.",
          icon: "print-outline",
          value: enableKDSPrint,
          onToggle: setEnableKDSPrint,
        },
        {
          title: "Disable Combo Print",
          desc: "If ON, do not print combo sub-items on kitchen printers. If OFF, print them.",
          icon: "close-circle-outline",
          value: enableComboPrint,
          onToggle: setEnableComboPrint,
        },
      ],
    },
    {
      title: "Billing & Cash Control",
      icon: "wallet-outline",
      items: [
        {
          title: "Checkout Bill",
          desc: "Enable checkout receipt printing.",
          icon: "wallet-outline",
          value: enableCheckoutBill,
          onToggle: setEnableCheckoutBill,
        },
        {
          title: "Enable Checkout Flow",
          desc: "Enable order summary checkout step.",
          icon: "git-compare-outline",
          value: enableCheckoutFlow,
          onToggle: handleToggleCheckoutFlow,
        },
        {
          title: "Enable Direct Process To Pay",
          desc: "Show 'Process To Pay' shortcut button in Cart Sidebar.",
          icon: "card-outline",
          value: enableDirectProcessToPay,
          onToggle: handleToggleDirectProcessToPay,
        },
        {
          title: "Enable Direct Payment to Process",
          desc: "Skip the Checkout screen and directly proceed to Process Payment.",
          icon: "arrow-forward-outline",
          value: enableDirectPaymentToProcess,
          onToggle: handleToggleDirectPaymentToProcess,
        },
        {
          title: "Skip Summary Screen",
          desc: "Skip the Summary screen and continue directly to the checkout/payment flow.",
          icon: "play-forward-outline",
          value: enableSkipSummaryScreen,
          onToggle: setEnableSkipSummaryScreen,
        },
        {
          title: "Enable Cash Drawer Module",
          desc: "Enable checkout cashbox opening triggers.",
          icon: "cash-outline",
          value: enableCashDrawer,
          onToggle: handleToggleCashDrawer,
        },
        {
          title: "Print Receipt",
          desc: "Automatically print receipt on payment without showing prompt. If OFF, skip printing and prompt.",
          icon: "print-outline",
          value: enableReceiptPrint,
          onToggle: setEnableReceiptPrint,
        },
      ],
    },
    {
      title: "App Features & Display",
      icon: "apps-outline",
      items: [
        {
          title: "Customer-Side Display",
          desc: "Enable/disable secondary customer screen sync.",
          icon: "tv-outline",
          value: customerSideDisplay,
          onToggle: setCustomerSideDisplay,
        },
        {
          title: "Guest Details Popup",
          desc: "Show guest info details popup before entering order screen.",
          icon: "people-outline",
          value: enableGuestDetailsPopup,
          onToggle: setEnableGuestDetailsPopup,
        },
        {
          title: "SVC Identification",
          desc: "Highlight Service (SVC) items with red identification.",
          icon: "pricetag-outline",
          value: SVCIdentification,
          onToggle: setSVCIdentification,
        },
        {
          title: "Combo Feature",
          desc: "Enable combo menu items and selections wizard.",
          icon: "fast-food-outline",
          value: enableCombo,
          onToggle: setEnableCombo,
        },
        {
          title: "Loyalty Feature",
          desc: "Show the Loyalty button in the POS Summary screen.",
          icon: "ribbon-outline",
          value: showLoyalty,
          onToggle: setShowLoyalty,
        },
        {
          title: "Reward Points Feature",
          desc: "Show the Reward Points button in the POS Summary screen.",
          icon: "gift-outline",
          value: showRewardPoints,
          onToggle: setShowRewardPoints,
        },
        {
          title: "Promo Code Feature",
          desc: "Show the Promo Code button in the POS Summary screen.",
          icon: "pricetag-outline",
          value: showPromoCode,
          onToggle: setShowPromoCode,
        },
      ],
    },
    {
      title: "Audio & Voice Alerts",
      icon: "volume-high-outline",
      items: [
        {
          title: "Voice Announcements",
          desc: "Play customer success 'Thank you' voice message on successful payment.",
          icon: "mic-outline",
          value: enableVoiceSuccess,
          onToggle: setEnableVoiceSuccess,
        },
        {
          title: "Notification Sounds",
          desc: "Play chime sounds when new orders or notifications are received.",
          icon: "notifications-outline",
          value: enableNotificationSound,
          onToggle: setEnableNotificationSound,
        },
      ],
    },
  ];

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/menu/settlement" as any);
            }
          }}
          style={styles.backBtn}
          activeOpacity={0.7}
        >
          <Ionicons name="arrow-back" size={24} color={Theme.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerLeft}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="settings" size={22} color={Theme.primary} />
            <Text style={styles.headerTitle}>General Settings</Text>
          </View>
        </View>
      </View>

      {/* Body Grid */}
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {sections.map((section, sIdx) => (
          <View key={sIdx} style={styles.sectionContainer}>
            <View style={styles.sectionHeader}>
              <Ionicons
                name={section.icon as any}
                size={20}
                color={Theme.primary}
              />
              <Text style={styles.sectionTitleText}>{section.title}</Text>
            </View>
            <View style={styles.gridContainer}>
              {section.items.map((item, index) => (
                <View
                  key={index}
                  style={[
                    styles.settingCard,
                    item.value && styles.settingCardActive,
                    isTablet ? styles.cardTablet : styles.cardMobile,
                  ]}
                >
                  <View style={styles.cardLeft}>
                    <View style={styles.cardHeaderRow}>
                      <View
                        style={[
                          styles.iconWrapper,
                          item.value
                            ? styles.iconWrapperActive
                            : styles.iconWrapperInactive,
                        ]}
                      >
                        <Ionicons
                          name={item.icon as any}
                          size={18}
                          color={
                            item.value ? Theme.primary : Theme.textSecondary
                          }
                        />
                      </View>
                      <Text style={styles.settingTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                    </View>
                    <Text style={styles.settingDesc}>{item.desc}</Text>
                  </View>
                  <CustomSwitch
                    value={item.value}
                    onValueChange={item.onToggle}
                  />
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={styles.cancelBtn}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/menu/settlement" as any);
            }
          }}
          disabled={saving || loading}
          activeOpacity={0.7}
        >
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.saveBtn, (saving || loading) && { opacity: 0.7 }]}
          onPress={handleSavePrompt}
          disabled={saving || loading}
          activeOpacity={0.8}
        >
          {saving || loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.saveBtnText}>Save Settings</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Admin Password Modal for settings verification */}
      <Modal
        visible={showPasswordModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPasswordModal(false)}
      >
        <View style={styles.modalOverlay}>
          <BlurView
            intensity={25}
            tint="dark"
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.modalContent,
              { width: 360, padding: 24, borderRadius: 20 },
            ]}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
              >
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    backgroundColor: Theme.primary + "15",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Ionicons
                    name="lock-closed"
                    size={18}
                    color={Theme.primary}
                  />
                </View>
                <Text
                  style={{
                    fontSize: 16,
                    fontFamily: Fonts.black,
                    color: Theme.textPrimary,
                  }}
                >
                  Admin Verification
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowPasswordModal(false)}
                style={{ padding: 4 }}
              >
                <Ionicons name="close" size={20} color={Theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text
              style={{
                fontSize: 13,
                fontFamily: Fonts.medium,
                color: Theme.textSecondary,
                marginBottom: 18,
                lineHeight: 18,
              }}
            >
              {passwordAction === "SAVE"
                ? "Please enter admin password to save General Settings changes."
                : "Please enter admin password to unlock Cash Drawer settings."}
            </Text>

            <TextInput
              style={{
                height: 46,
                borderWidth: 1.5,
                borderColor: passwordError ? "#EF4444" : Theme.border + "60",
                borderRadius: 12,
                paddingHorizontal: 14,
                fontSize: 15,
                color: Theme.textPrimary,
                fontFamily: Fonts.bold,
                backgroundColor: "#FAF7F2",
                marginBottom: passwordError ? 6 : 20,
                textAlign: "center",
              }}
              secureTextEntry
              placeholder="••••••••"
              placeholderTextColor={Theme.textSecondary + "60"}
              value={passwordValue}
              onChangeText={(val) => {
                setPasswordValue(val);
                if (passwordError) setPasswordError("");
              }}
              onSubmitEditing={handlePasswordVerify}
              autoFocus
            />

            {!!passwordError && (
              <Text
                style={{
                  color: "#EF4444",
                  fontSize: 12,
                  fontFamily: Fonts.bold,
                  textAlign: "center",
                  marginBottom: 16,
                }}
              >
                {passwordError}
              </Text>
            )}

            <View style={{ flexDirection: "row", gap: 12 }}>
              <TouchableOpacity
                onPress={() => setShowPasswordModal(false)}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  borderWidth: 1.5,
                  borderColor: Theme.border + "80",
                  backgroundColor: "#fff",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    fontSize: 13,
                    fontFamily: Fonts.bold,
                    color: Theme.textSecondary,
                  }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{
                  flex: 1.2,
                  backgroundColor: Theme.primary,
                  borderRadius: 12,
                  justifyContent: "center",
                  alignItems: "center",
                  paddingVertical: 12,
                  shadowColor: Theme.primary,
                  shadowOffset: { width: 0, height: 3 },
                  shadowOpacity: 0.3,
                  shadowRadius: 6,
                  elevation: 3,
                }}
                onPress={handlePasswordVerify}
                disabled={verifyingPassword}
                activeOpacity={0.8}
              >
                {verifyingPassword ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text
                    style={{
                      color: "#fff",
                      fontSize: 13,
                      fontFamily: Fonts.black,
                    }}
                  >
                    Confirm
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <AuditLogModal
        visible={showAuditModal}
        onClose={() => setShowAuditModal(false)}
        defaultCategory="GENERAL_SETTINGS"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FAF7F2",
  },
  header: {
    height: 72,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    backgroundColor: "#FAF7F2",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    position: "relative",
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  backBtn: {
    position: "absolute",
    left: 24,
    padding: 8,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    zIndex: 10,
  },
  auditBtn: {
    position: "absolute",
    right: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    zIndex: 10,
  },
  headerTitleContainer: {
    alignItems: "center",
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    textAlign: "center",
  },
  headerSubtitle: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
    marginTop: 2,
    textAlign: "center",
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
  },
  sectionContainer: {
    marginBottom: 28,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    paddingBottom: 8,
  },
  sectionTitleText: {
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  gridContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  settingCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    shadowColor: "#172B4D",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  settingCardActive: {
    backgroundColor: "#FFFDFB",
    borderWidth: 1,
    borderColor: "#FF6B00",
    shadowColor: "#FF6B00",
    shadowOpacity: 0.05,
    shadowRadius: 10,
  },
  cardMobile: {
    width: "100%",
  },
  cardTablet: {
    width: "49%",
    minHeight: 110,
  },
  cardLeft: {
    flex: 1,
    paddingRight: 16,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 6,
  },
  iconWrapper: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapperActive: {
    backgroundColor: "#FFF7ED",
  },
  iconWrapperInactive: {
    backgroundColor: "#F3F4F6",
  },
  settingTitle: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
    flex: 1,
  },
  settingDesc: {
    fontSize: 12,
    fontFamily: Fonts.regular,
    color: Theme.textSecondary,
    lineHeight: 16,
  },
  switchTouchArea: {
    paddingVertical: 4,
  },
  switchContainer: {
    width: 50,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
    elevation: 2,
  },
  footer: {
    padding: 20,
    backgroundColor: "#FAF7F2",
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  cancelBtn: {
    height: 46,
    paddingHorizontal: 24,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  cancelBtnText: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textSecondary,
  },
  saveBtn: {
    height: 46,
    paddingHorizontal: 28,
    borderRadius: 10,
    backgroundColor: "#FF6B00",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 140,
    shadowColor: "#FF6B00",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  saveBtnText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: "#fff",
  },
  pwOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  pwModalContent: {
    width: 380,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
  pwHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  pwTitle: {
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  pwClose: {
    padding: 4,
  },
  pwBody: {
    gap: 16,
  },
  pwDesc: {
    fontSize: 13,
    fontFamily: Fonts.regular,
    color: Theme.textSecondary,
    lineHeight: 18,
  },
  pwInput: {
    height: 44,
    borderWidth: 0,
    backgroundColor: "#F3F4F6",
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    fontFamily: Fonts.regular,
    color: Theme.textPrimary,
    outlineWidth: 0,
  },
  pwBtn: {
    height: 44,
    backgroundColor: Theme.primary,
    borderRadius: 8,
    alignItems: "center",
    shadowRadius: 6,
    elevation: 3,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
});
