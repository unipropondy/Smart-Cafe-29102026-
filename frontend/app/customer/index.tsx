import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Image,
  Modal,
  Dimensions,
  Pressable,
  ImageBackground,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { API_URL } from "../../constants/Config";
import { useOrderContextStore } from "../../stores/orderContextStore";
import { useCartStore } from "../../stores/cartStore";
import { useCompanySettingsStore } from "../../stores/companySettingsStore";
import { Theme } from "../../constants/theme";
import { Ionicons } from "@expo/vector-icons";

const { width } = Dimensions.get("window");

// ─── Premium Design System Tokens (Mapped to Global POS Theme) ──────────────
const C = {
  orangePrimary: Theme.primary,
  orangeDark:    Theme.primaryDark,
  orangeLight:   Theme.primary,
  orangeBg:      Theme.primary,
  bg:            Theme.bgMain,     // Warm Cream background
  cardSurface:   Theme.bgCard,     // White card surfaces
  inputBg:       Theme.bgInput,    // Warm input backgrounds
  border:        Theme.border,     // Warm border colors
  borderFocus:   Theme.primary,
  textDark:      Theme.textPrimary,
  textMedium:    Theme.textSecondary,
  textMuted:     Theme.textMuted,
  textPlaceholder: Theme.textMuted,
  orangeTint:    Theme.primaryLight,
  orangeSoft:    Theme.primaryLight,
  error:         Theme.danger,
  success:       Theme.success,
};

export default function CustomerWelcomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const settings = useCompanySettingsStore((s: any) => s.settings);

  const [scannedTable, setScannedTable] = useState<{
    tableId: string;
    tableNo: string;
    section: string;
  } | null>(null);

  const [activeTab, setActiveTab] = useState<"splash" | "signin" | "signup">("signin");

  // Sign In
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Sign Up
  const [regUsername, setRegUsername] = useState("");
  const [regCountryCode, setRegCountryCode] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [regPromoCode, setRegPromoCode] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(true);

  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegConfirmPassword, setShowRegConfirmPassword] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [popupConfig, setPopupConfig] = useState<{ title: string; message: string } | null>(null);
  const [promoImages, setPromoImages] = useState<any[]>([]);
  const [currentPromoIndex, setCurrentPromoIndex] = useState<number>(0);
  const [showPromoModal, setShowPromoModal] = useState<boolean>(false);
  const [promoModalDismissed, setPromoModalDismissed] = useState<boolean>(false);
  const [isCloseHovered, setIsCloseHovered] = useState(false);

  const [authLoading, setAuthLoading] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [foodIndex, setFoodIndex] = useState(0);
  const [imageAspectRatio, setImageAspectRatio] = useState<number>(9 / 16);

  // Pax Selection Pop-up states
  const [tempUser, setTempUser] = useState<any>(null);
  const [showPaxModal, setShowPaxModal] = useState(false);
  const [selectedPax, setSelectedPax] = useState<number>(2);
  const [customPax, setCustomPax] = useState("");
  const [isCustomPax, setIsCustomPax] = useState(false);
  const [savingGuest, setSavingGuest] = useState(false);

  // Animations
  const spinValue = useRef(new Animated.Value(0)).current;
  const scaleValue = useRef(new Animated.Value(1)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(25)).current;
  const tabAnim   = useRef(new Animated.Value(0)).current;
  const closeScale = useRef(new Animated.Value(1)).current;
  const imageScale = useRef(new Animated.Value(1)).current;
  const imageFadeAnim = useRef(new Animated.Value(1)).current;
  const imageTransitionScale = useRef(new Animated.Value(1)).current;

  const handleCloseHover = (hovered: boolean) => {
    Animated.timing(closeScale, {
      toValue: hovered ? 1.15 : 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  };

  const handleImageHover = (hovered: boolean) => {
    Animated.timing(imageScale, {
      toValue: hovered ? 1.04 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  const touchStartX = useRef<number | null>(null);

  const goToNextPromo = () => {
    if (promoImages.length <= 1) return;
    Animated.parallel([
      Animated.timing(imageFadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(imageTransitionScale, {
        toValue: 0.94,
        duration: 150,
        useNativeDriver: true,
      })
    ]).start(() => {
      setCurrentPromoIndex((prev) => (prev + 1) % promoImages.length);
      Animated.parallel([
        Animated.timing(imageFadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(imageTransitionScale, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        })
      ]).start();
    });
  };

  const goToPrevPromo = () => {
    if (promoImages.length <= 1) return;
    Animated.parallel([
      Animated.timing(imageFadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(imageTransitionScale, {
        toValue: 0.94,
        duration: 150,
        useNativeDriver: true,
      })
    ]).start(() => {
      setCurrentPromoIndex((prev) => (prev - 1 + promoImages.length) % promoImages.length);
      Animated.parallel([
        Animated.timing(imageFadeAnim, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(imageTransitionScale, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        })
      ]).start();
    });
  };

  const handleTouchStart = (e: any) => {
    touchStartX.current = e.nativeEvent.pageX;
  };

  const handleTouchEnd = (e: any) => {
    if (touchStartX.current === null) return;
    const touchEndX = e.nativeEvent.pageX;
    const distance = touchEndX - touchStartX.current;

    // Minimum swipe distance threshold (50px)
    if (Math.abs(distance) > 50) {
      if (distance > 0) {
        goToPrevPromo();
      } else {
        goToNextPromo();
      }
    }
    touchStartX.current = null;
  };

  const foodEmojis = ["🍕", "🍔", "🌮", "🍜", "🍰", "☕"];

  // Continuous subtle floating & pulsing animation
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: -8, duration: 2200, useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0, duration: 2200, useNativeDriver: true }),
      ])
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.06, duration: 1600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1600, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  useEffect(() => {
    let interval: any;
    if (transitioning) {
      interval = setInterval(() => {
        setFoodIndex((prev) => (prev + 1) % foodEmojis.length);
      }, 150);

      spinValue.setValue(0);
      Animated.loop(
        Animated.timing(spinValue, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        })
      ).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(scaleValue, { toValue: 1.25, duration: 250, useNativeDriver: true }),
          Animated.timing(scaleValue, { toValue: 0.85, duration: 250, useNativeDriver: true }),
        ])
      ).start();
    } else {
      setFoodIndex(0);
      scaleValue.setValue(1);
    }
    return () => clearInterval(interval);
  }, [transitioning]);

  const spinRotation = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  useEffect(() => {
    useCompanySettingsStore.getState().fetchSettings?.();
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 450, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 450, useNativeDriver: true }),
    ]).start();

    // Fetch active promo images
    const fetchPromoImages = async () => {
      try {
        const res = await fetch(`${API_URL}/api/members/active-promo-image`);
        const data = await res.json();
        if (data.success) {
          if (data.promoImages && data.promoImages.length > 0) {
            // Prefetch the first image so it loads instantly
            const firstImg = data.promoImages[0]?.promoImage;
            if (firstImg) {
              Image.prefetch(firstImg).catch(() => {});
            }
            setPromoImages(data.promoImages);
            setShowPromoModal(true);
          } else if (data.promoImage) {
            if (data.promoImage) {
              Image.prefetch(data.promoImage).catch(() => {});
            }
            setPromoImages([{
              promoImage: data.promoImage,
              promoCode: data.promoCode || "",
              promoName: data.promoName || ""
            }]);
            setShowPromoModal(true);
          }
        }
      } catch (err) {
        console.warn("Failed to fetch active promo images:", err);
      }
    };
    fetchPromoImages();
  }, []);

  // Slideshow rotation effect (every 2 seconds) with fade transition
  useEffect(() => {
    if (!showPromoModal || promoImages.length <= 1) return;

    const interval = setInterval(() => {
      goToNextPromo();
    }, 2000);

    return () => clearInterval(interval);
  }, [showPromoModal, promoImages, currentPromoIndex]);

  useEffect(() => {
    if (promoImages.length > 0 && promoImages[currentPromoIndex]?.promoImage) {
      Image.getSize(
        promoImages[currentPromoIndex].promoImage,
        (w, h) => {
          if (w && h) {
            setImageAspectRatio(w / h);
          }
        },
        () => {
          setImageAspectRatio(9 / 16);
        }
      );
    }
  }, [promoImages, currentPromoIndex]);

  useEffect(() => {
    if (scannedTable) return;
    const { tableId, tableNo, section } = params;
    if (tableId && tableNo) {
      const scanned = {
        tableId: String(tableId),
        tableNo: String(tableNo),
        section: section ? String(section) : "SECTION_1",
      };
      setScannedTable(scanned);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("tableId", String(tableId));
        localStorage.setItem("tableNo", String(tableNo));
        localStorage.setItem("section", section ? String(section) : "SECTION_1");
      }
    } else {
      if (typeof localStorage !== "undefined") {
        const storedTableId = localStorage.getItem("tableId");
        const storedTableNo = localStorage.getItem("tableNo");
        const storedSection = localStorage.getItem("section") || "SECTION_1";
        if (storedTableId && storedTableNo) {
          setScannedTable({
            tableId: storedTableId,
            tableNo: storedTableNo,
            section: storedSection,
          });
          return;
        }
      }
      setScannedTable({
        tableId: "1",
        tableNo: "1",
        section: "SECTION_1",
      });
    }
  }, [params, scannedTable]);

  const selectCountryCode = () => {
    setShowPicker(true);
  };

  const showPopup = (title: string, message: string) => {
    setPopupConfig({ title, message });
  };

  const switchTab = (tab: "splash" | "signin" | "signup") => {
    setActiveTab(tab);
    if (tab !== "splash") {
      fadeAnim.setValue(0);
      slideAnim.setValue(25);
      Animated.parallel([
        Animated.timing(fadeAnim,  { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
    }
  };

  const proceedToMenu = (user: { customerId?: string; memberId?: string; userId?: string; userName: string; fullName?: string; phone?: string; email?: string; promoCode?: string; promoAmount?: number }) => {
    if (!scannedTable) {
      Alert.alert("No Table", "Please scan a table QR code first.");
      return;
    }
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("isLoggedIn", "true");
      localStorage.setItem("qr_pos_user", JSON.stringify({
        CustomerId: user.customerId || user.memberId || user.userId || "",
        MemberId: user.memberId || user.customerId || user.userId || "",
        UserId: user.userId || user.memberId || user.customerId || "",
        UserName: user.userName,
        FullName: user.fullName || user.userName,
        Phone: user.phone || "",
        Email: user.email || "",
        PromoCode: user.promoCode || "",
        PromoAmount: user.promoAmount || 0,
      }));
    }
    useOrderContextStore.getState().setOrderContext({
      orderType: "DINE_IN",
      tableId: scannedTable.tableId,
      tableNo: scannedTable.tableNo,
      section: scannedTable.section,
    });
    const contextId = `DINE_IN_${scannedTable.section}_${scannedTable.tableNo}`;
    useCartStore.getState().setCurrentContext(contextId);
    useCartStore.getState().fetchCartFromDB(scannedTable.tableId);
    router.replace("/customer/menu" as any);
  };

  const handlePaxConfirm = async () => {
    const finalPax = isCustomPax ? parseInt(customPax) : selectedPax;
    if (isNaN(finalPax) || finalPax < 1 || finalPax > 100) {
      Alert.alert("Invalid Pax", "Please enter a valid number of guests (1-100).");
      return;
    }

    if (!scannedTable) {
      Alert.alert("No Table", "Please scan a table QR code first.");
      return;
    }

    setSavingGuest(true);
    try {
      await fetch(`${API_URL}/api/tables/save-guest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableId: scannedTable.tableId,
          customerName: tempUser?.fullName || tempUser?.userName || "Guest",
          pax: finalPax,
        }),
      });
    } catch (e) {
      console.warn("Failed to save guest info to backend:", e);
    } finally {
      setSavingGuest(false);
      setShowPaxModal(false);
      proceedToMenu(tempUser);
    }
  };

  const handleSignIn = async () => {
    if (promoImages.length > 0 && !promoModalDismissed) {
      setShowPromoModal(true);
      return;
    }
    if (!loginUsername.trim() || !loginPassword.trim()) {
      showPopup("Error", "Please enter your Email/Mobile Number and Password.");
      return;
    }
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userName: loginUsername.trim(), password: loginPassword.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setTransitioning(true);
        setTimeout(() => {
          const loggedInUser = {
            customerId: data.user.memberId || data.user.userId || data.user.id || "",
            memberId: data.user.memberId || data.user.userId || data.user.id || "",
            userId: data.user.userId || data.user.memberId || data.user.id || "",
            userName: data.user.userName,
            fullName: data.user.fullName || data.user.userName,
            phone: data.user.phone,
            email: data.user.email,
            promoCode: data.user.Promocode,
            promoAmount: data.user.Promoamount,
          };
          setTempUser(loggedInUser);
          setTransitioning(false);
          proceedToMenu(loggedInUser);
        }, 1000);
      } else {
        showPopup("Sign In Failed", data.message || "Invalid name or password.");
      }
    } catch {
      showPopup("Error", "Cannot connect to server. Please check your connection.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignUp = async () => {
    if (promoImages.length > 0 && !promoModalDismissed) {
      setShowPromoModal(true);
      return;
    }
    if (!regUsername.trim() || !regPhone.trim() || !regPassword.trim()) {
      showPopup("Error", "Please fill out all required fields.");
      return;
    }
    if (regPassword !== regConfirmPassword) {
      showPopup("Error", "Passwords do not match.");
      return;
    }
    if (!agreedToTerms) {
      showPopup("Terms Required", "Please accept the Terms & Conditions to proceed.");
      return;
    }
    setAuthLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: regUsername.trim(),
          mobileNumber: regCountryCode + regPhone.trim(),
          email: regEmail.trim(),
          password: regPassword.trim(),
          promoCode: regPromoCode.trim()
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTransitioning(true);
        setTimeout(() => {
          const newMemberId = data.user?.MemberId || data.user?.memberId || data.user?.id || "";
          const registeredUser = { 
            customerId: newMemberId,
            memberId: newMemberId,
            userId: newMemberId,
            userName: regUsername.trim(), 
            fullName: regUsername.trim(),
            phone: regCountryCode + regPhone.trim(), 
            email: regEmail.trim(),
            promoCode: data.user?.Promocode || "",
            promoAmount: data.user?.Promoamount || 0,
          };
          setTempUser(registeredUser);
          setTransitioning(false);
          proceedToMenu(registeredUser);
        }, 1000);
      } else {
        showPopup("Registration Failed", data.message || "Registration failed. Please try again.");
      }
    } catch {
      showPopup("Error", "Cannot connect to server. Please check your connection.");
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGuest = () => {
    if (promoImages.length > 0 && !promoModalDismissed) {
      setShowPromoModal(true);
      return;
    }
    setTransitioning(true);
    setTimeout(() => {
      const guestUser = { userName: "Guest", fullName: "Guest Customer" };
      setTempUser(guestUser);
      setTransitioning(false);
      proceedToMenu(guestUser);
    }, 1000);
  };

  const getLogoUri = (logo?: string) => {
    if (!logo) return undefined;
    if (logo.startsWith('data:image')) return logo;
    if (logo.startsWith('http')) return logo;
    return `${API_URL}${logo.startsWith('/') ? '' : '/'}${logo}`;
  };

  const logoUri = getLogoUri(settings?.companyLogo);

  return (
    <ImageBackground 
      source={require("../../assets/images/login_bg_pattern.jpg")} 
      style={styles.webContainer}
      resizeMode="cover"
    >
      <View style={styles.root}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        
        {activeTab === "splash" ? (
          <ScrollView contentContainerStyle={styles.splashScroll} showsVerticalScrollIndicator={false} bounces={false}>
            {/* Top Header Bar */}
            <View style={styles.topBar}>
              <View style={{ width: 20 }} />
              {scannedTable && (
                <View style={styles.tablePill}>
                  <Ionicons name="location-sharp" size={13} color="#FFFFFF" />
                  <Text style={styles.tablePillText}>Table {scannedTable.tableNo}</Text>
                </View>
              )}
            </View>

            <View style={styles.splashContent}>
              <View style={styles.splashTextCard}>
                {/* Logo Section */}
                <Animated.View style={[styles.logoBadgeContainer, { transform: [{ scale: pulseAnim }], alignSelf: "center", marginBottom: 16 }]}>
                  <View style={styles.logoBadgeInner}>
                    {logoUri ? (
                      <Image source={{ uri: logoUri }} style={styles.logoImage} />
                    ) : (
                      <View style={styles.foodIllustration}>
                        <Ionicons name="restaurant" size={32} color={C.orangePrimary} />
                      </View>
                    )}
                  </View>
                </Animated.View>

                <Text style={[styles.splashWelcome, { textAlign: "center" }]}>Welcome to</Text>
                <Text style={[styles.splashTitle, { textAlign: "center" }]}>{settings?.name || "Smart POS"}</Text>
                <Text style={[styles.splashSubtitle, { textAlign: "center" }]}>Scan, Order & Enjoy your meal</Text>
              </View>

              <View style={styles.splashBtnGroupCard}>
                <TouchableOpacity 
                  activeOpacity={0.8} 
                  style={styles.splashBtnSignIn} 
                  onPress={() => switchTab("signin")}
                >
                  <Text style={styles.splashBtnSignInText}>Sign In</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  activeOpacity={0.8} 
                  style={styles.splashBtnSignUp} 
                  onPress={() => switchTab("signup")}
                >
                  <Text style={styles.splashBtnSignUpText}>Sign Up</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  activeOpacity={0.85} 
                  style={styles.splashBtnGuest} 
                  onPress={handleGuest}
                >
                  <Text style={styles.splashBtnGuestText}>Continue as Guest</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} bounces={false}>
            {/* Top Header Bar with Back Button */}
            <View style={styles.topBar}>
              <TouchableOpacity 
                activeOpacity={0.7} 
                style={styles.backBtnCircle} 
                onPress={() => switchTab("splash")}
              >
                <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
              </TouchableOpacity>

              {scannedTable && (
                <View style={styles.tablePill}>
                  <Ionicons name="location-sharp" size={13} color="#FFFFFF" />
                  <Text style={styles.tablePillText}>Table {scannedTable.tableNo}</Text>
                </View>
              )}
            </View>

            {/* Logo and Shop Name on Top Center */}
            <View style={styles.headerLogoContainer}>
              <Animated.View style={[styles.logoBadgeContainer, { transform: [{ scale: pulseAnim }], marginBottom: 6 }]}>
                <View style={styles.logoBadgeInner}>
                  {logoUri ? (
                    <Image source={{ uri: logoUri }} style={styles.logoImage} />
                  ) : (
                    <View style={styles.foodIllustration}>
                      <Ionicons name="restaurant" size={32} color={C.orangePrimary} />
                    </View>
                  )}
                </View>
              </Animated.View>
              <View style={styles.shopNameCapsule}>
                <Text style={styles.headerShopNameRestaurant}>{settings?.name || "Restaurant"}</Text>
              </View>
              
              {/* Slogan with orange side lines */}
              <View style={styles.sloganContainer}>
                <View style={styles.sloganLine} />
                <Text style={styles.sloganText}>Good Food • Good Mood</Text>
                <View style={styles.sloganLine} />
              </View>
            </View>

            <Animated.View style={[styles.containerCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }], marginTop: 16 }]}>
              
              {/* Title Header matching the Welcome style */}
              <Text style={styles.mockupCardTitle}>
                {activeTab === "signin" ? (
                  <Text>Welcome <Text style={{ color: C.orangePrimary }}>Back!</Text></Text>
                ) : (
                  <Text>Register <Text style={{ color: C.orangePrimary }}>Now!</Text></Text>
                )}
              </Text>
              <Text style={styles.mockupCardSubtitle}>
                {activeTab === "signin" ? "Please sign in to your account" : "Please create an account to proceed"}
              </Text>

          {/* ═══════════════ SIGN IN ═══════════════ */}
          {activeTab === "signin" && (
            <View style={styles.formContainer}>
               <CardField
                label="Email ID or Mobile Number*"
                placeholder="Email or Mobile Number"
                value={loginUsername}
                onChangeText={setLoginUsername}
                icon="mail-outline"
                autoCapitalize="none"
              />
              <CardField
                label="Password*"
                placeholder="••••••••••••"
                value={loginPassword}
                onChangeText={setLoginPassword}
                icon="lock-closed-outline"
                secureTextEntry={!showLoginPassword}
                rightIcon={showLoginPassword ? "eye-off-outline" : "eye-outline"}
                onRightIconPress={() => setShowLoginPassword(!showLoginPassword)}
              />

              <TouchableOpacity activeOpacity={0.7} style={styles.forgotBtn} onPress={() => showPopup("Password Reset", "Please contact store staff to reset your login password.")}>
                <Text style={styles.forgotText}>Forgot your Password?</Text>
              </TouchableOpacity>

              <TouchableOpacity activeOpacity={0.85} style={styles.primaryPillBtn} onPress={handleSignIn} disabled={authLoading}>
                {authLoading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="person-outline" size={18} color="#FFFFFF" />
                    <Text style={styles.primaryPillBtnText}>Login</Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* Continue as Guest Button */}
              <View style={styles.guestSection}>
                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or</Text>
                  <View style={styles.dividerLine} />
                </View>
                <TouchableOpacity activeOpacity={0.8} style={styles.guestPillBtn} onPress={handleGuest}>
                  <Ionicons name="person-outline" size={18} color={C.orangePrimary} />
                  <Text style={styles.guestPillBtnText}>Continue as Guest</Text>
                </TouchableOpacity>
              </View>

              {/* Switch to Register */}
              <View style={styles.switchAuthRow}>
                <Text style={styles.switchAuthText}>Don't have an account? </Text>
                <TouchableOpacity activeOpacity={0.7} onPress={() => switchTab("signup")}>
                  <Text style={styles.switchAuthLink}>Register Now</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ═══════════════ SIGN UP ═══════════════ */}
          {activeTab === "signup" && (
            <View style={styles.formContainer}>
              <CardField
                label="User Name*"
                placeholder="Valentino Morose"
                value={regUsername}
                onChangeText={setRegUsername}
                icon="person-outline"
              />

              {/* Phone Field with Country Code Selection */}
              <View style={cardFieldStyles.fieldBox}>
                <Text style={cardFieldStyles.fieldLabel}>Phone Number*</Text>
                <View style={cardFieldStyles.inputWrap}>
                  <View style={cardFieldStyles.iconBadge}>
                    <Ionicons name="call-outline" size={18} color={C.orangePrimary} />
                  </View>
                  <TextInput
                    style={cardFieldStyles.input}
                    placeholder="Enter phone number"
                    placeholderTextColor={C.textPlaceholder}
                    value={regPhone}
                    onChangeText={(t) => setRegPhone(t.replace(/[^0-9+]/g, ''))}
                    keyboardType="phone-pad"
                  />
                </View>
              </View>

              <CardField
                label="Email ID*"
                placeholder="valentino@gmail.com"
                value={regEmail}
                onChangeText={setRegEmail}
                icon="mail-outline"
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <CardField
                label="Password*"
                placeholder="••••••••••••"
                value={regPassword}
                onChangeText={setRegPassword}
                icon="lock-closed-outline"
                secureTextEntry={!showRegPassword}
                rightIcon={showRegPassword ? "eye-off-outline" : "eye-outline"}
                onRightIconPress={() => setShowRegPassword(!showRegPassword)}
              />

              <CardField
                label="Confirm Password*"
                placeholder="••••••••••••"
                value={regConfirmPassword}
                onChangeText={setRegConfirmPassword}
                icon="shield-checkmark-outline"
                secureTextEntry={!showRegConfirmPassword}
                rightIcon={showRegConfirmPassword ? "eye-off-outline" : "eye-outline"}
                onRightIconPress={() => setShowRegConfirmPassword(!showRegConfirmPassword)}
              />

              <CardField
                label="Promo Code"
                placeholder="Optional promo code"
                value={regPromoCode}
                onChangeText={setRegPromoCode}
                icon="pricetag-outline"
                autoCapitalize="characters"
              />

              {/* Terms & Conditions Checkbox */}
              <TouchableOpacity 
                activeOpacity={0.8}
                style={styles.termsRow}
                onPress={() => setAgreedToTerms(!agreedToTerms)}
              >
                <View style={[styles.checkbox, agreedToTerms && styles.checkboxActive]}>
                  {agreedToTerms && <Ionicons name="checkmark" size={13} color="#FFFFFF" />}
                </View>
                <Text style={styles.termsText}>
                  I Read and agree to <Text style={styles.termsLink}>Terms & Conditions</Text>
                </Text>
              </TouchableOpacity>

              <TouchableOpacity activeOpacity={0.85} style={styles.primaryPillBtn} onPress={handleSignUp} disabled={authLoading}>
                {authLoading ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="person-add-outline" size={18} color="#FFFFFF" />
                    <Text style={styles.primaryPillBtnText}>Register Now</Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* Continue as Guest Button */}
              <View style={styles.guestSection}>
                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or</Text>
                  <View style={styles.dividerLine} />
                </View>
                <TouchableOpacity activeOpacity={0.8} style={styles.guestPillBtn} onPress={handleGuest}>
                  <Ionicons name="person-outline" size={18} color={C.orangePrimary} />
                  <Text style={styles.guestPillBtnText}>Continue as Guest</Text>
                </TouchableOpacity>
              </View>

              {/* Switch to Sign In */}
              <View style={styles.switchAuthRow}>
                <Text style={styles.switchAuthText}>Already have an account? </Text>
                <TouchableOpacity activeOpacity={0.7} onPress={() => switchTab("signin")}>
                  <Text style={styles.switchAuthLink}>Login</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

        </Animated.View>
      </ScrollView>
    )}


      {/* Popup Alert Modal */}
      {popupConfig && (
        <Modal transparent visible={!!popupConfig} animationType="fade">
          <TouchableOpacity 
            style={styles.modalOverlay} 
            activeOpacity={1}
            onPress={() => setPopupConfig(null)}
          >
            <View style={styles.alertModalContent}>
              <View style={styles.alertIconBadge}>
                <Ionicons name="alert-circle-outline" size={32} color={C.orangePrimary} />
              </View>
              <Text style={styles.alertModalTitle}>{popupConfig.title}</Text>
              <Text style={styles.alertModalMessage}>{popupConfig.message}</Text>
              <TouchableOpacity 
                style={styles.alertOkBtn}
                onPress={() => setPopupConfig(null)}
              >
                <Text style={styles.alertOkText}>OK</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Modal>
      )}

      {/* Promo Code Image Modal */}
      {showPromoModal && promoImages.length > 0 && (
        <Modal transparent visible={showPromoModal} animationType="slide">
          <View style={styles.modalOverlay}>
            <View style={styles.promoModalContent}>
              <Animated.View 
                style={{ transform: [{ scale: imageScale }], width: "100%", alignItems: "center" }}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                <Pressable
                  onHoverIn={() => handleImageHover(true)}
                  onHoverOut={() => handleImageHover(false)}
                  style={[{ width: "100%" }, Platform.select({ web: { outlineStyle: "none" } as any })]}
                >
                  <Animated.View style={{ opacity: imageFadeAnim, transform: [{ scale: imageTransitionScale }], width: "100%", position: "relative" }}>
                    <Image 
                      source={{ uri: promoImages[currentPromoIndex]?.promoImage }} 
                      style={[styles.promoImage, { aspectRatio: imageAspectRatio }]} 
                      resizeMode="cover"
                    />

                    {/* Close Button on Top Right (Inside the Image Wrapper) */}
                    <Animated.View style={{ transform: [{ scale: closeScale }], position: "absolute", top: 12, right: 12, zIndex: 30 }}>
                      <Pressable
                        onHoverIn={() => {
                          handleCloseHover(true);
                          setIsCloseHovered(true);
                        }}
                        onHoverOut={() => {
                          handleCloseHover(false);
                          setIsCloseHovered(false);
                        }}
                        style={({ hovered }) => [
                          styles.promoTopCloseBtn,
                          hovered && styles.promoTopCloseBtnHover
                        ]}
                        onPress={() => {
                          setShowPromoModal(false);
                          setPromoModalDismissed(true);
                        }}
                      >
                        <Ionicons name="close" size={20} color={isCloseHovered ? "#FFFFFF" : "#E2E8F0"} />
                      </Pressable>
                    </Animated.View>
                  </Animated.View>
                </Pressable>
              </Animated.View>

              {/* Pagination Dots */}
              {promoImages.length > 1 && (
                <View style={styles.promoPagination}>
                  {promoImages.map((_, idx) => (
                    <View 
                      key={idx} 
                      style={[
                        styles.promoDot, 
                        idx === currentPromoIndex && styles.promoDotActive
                      ]} 
                    />
                  ))}
                </View>
              )}
            </View>
          </View>
        </Modal>
      )}

      {/* Transition Screen Overlay */}
      {transitioning && (
        <View style={styles.transitionScreen}>
          <View style={{ width: 92, height: 92, justifyContent: "center", alignItems: "center", marginBottom: 20 }}>
            <Animated.View style={{ position: "absolute", transform: [{ rotate: spinRotation }] }}>
              <View style={styles.transitionSpinnerOuter} />
            </Animated.View>
            <View style={styles.transitionEmojiBadge}>
              <Animated.Text style={{ fontSize: 28, transform: [{ scale: scaleValue }] }}>
                {foodEmojis[foodIndex]}
              </Animated.Text>
            </View>
          </View>
          <Text style={styles.transitionTitle}>Entering Restaurant...</Text>
          <Text style={styles.transitionSubtitle}>Setting up your digital menu</Text>
        </View>
      )}
        </KeyboardAvoidingView>
      </View>
    </ImageBackground>
  );
}

// ─── Modern Card Input Field Component ─────────────────────────────────────
interface CardFieldProps {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  icon?: any;
  secureTextEntry?: boolean;
  rightIcon?: any;
  onRightIconPress?: () => void;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: any;
}

function CardField({
  label,
  placeholder,
  value,
  onChangeText,
  icon,
  secureTextEntry,
  rightIcon,
  onRightIconPress,
  autoCapitalize,
  keyboardType,
}: CardFieldProps) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={cardFieldStyles.fieldBox}>
      <Text style={cardFieldStyles.fieldLabel}>{label}</Text>
      <View style={[cardFieldStyles.inputWrap, isFocused && cardFieldStyles.inputWrapFocused]}>
        {icon && (
          <View style={cardFieldStyles.iconBadge}>
            <Ionicons name={icon} size={18} color={C.orangePrimary} />
          </View>
        )}
        <TextInput
          style={cardFieldStyles.input}
          placeholder={placeholder}
          placeholderTextColor={C.textPlaceholder}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry}
          autoCapitalize={autoCapitalize}
          keyboardType={keyboardType}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
        />
        {rightIcon && (
          <TouchableOpacity onPress={onRightIconPress} style={cardFieldStyles.rightIconTouch}>
            <Ionicons name={rightIcon} size={19} color={isFocused ? C.orangePrimary : C.textMuted} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const cardFieldStyles = StyleSheet.create({
  fieldBox: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: "800",
    color: C.orangePrimary,
    marginBottom: 6,
    letterSpacing: 0.2,
  },
  inputWrap: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF9F6",
    borderRadius: 14,
    borderWidth: 1.2,
    borderColor: "rgba(255, 94, 26, 0.25)",
    paddingHorizontal: 16,
  },
  inputWrapFocused: {
    borderColor: C.orangePrimary,
    backgroundColor: "#FFF5F0",
  },
  iconBadge: {
    width: 24,
    height: 32,
    alignItems: "flex-start",
    justifyContent: "center",
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: "#0F172A",
    height: "100%",
  },
  rightIconTouch: {
    padding: 6,
  },
  countryPicker: {
    paddingRight: 8,
    marginRight: 6,
    borderRightWidth: 1.5,
    borderRightColor: "#CBD5E1",
  },
  countryText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
  },
});

// ─── Main StyleSheet ──────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  webContainer: {
    flex: 1,
    backgroundColor: "#F5EBE1",
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    height: "100%",
  },
  root: {
    flex: 1,
    width: "100%",
    maxWidth: 440,
    backgroundColor: "transparent",
    alignSelf: "center",
    ...Platform.select({
      web: {
        height: "100vh",
        overflow: "hidden",
      } as any,
    }),
  },
  scroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingBottom: 40,
  },

  // Decorative header background wave
  headerWaveBackground: {
    position: "absolute",
    top: -50,
    left: -40,
    right: -40,
    height: 340,
    backgroundColor: C.orangePrimary,
    borderBottomLeftRadius: 160,
    borderBottomRightRadius: 180,
    overflow: "hidden",
  },
  headerWaveCircleLarge: {
    position: "absolute",
    top: -40,
    right: -20,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: C.orangeLight,
    opacity: 0.6,
  },
  headerWaveCircleSmall: {
    position: "absolute",
    top: 70,
    right: 90,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: C.orangeBg,
    opacity: 0.4,
  },
  floatingGeo: {
    position: "absolute",
    backgroundColor: "rgba(255,255,255,0.5)",
  },
  floatingGeoRing: {
    position: "absolute",
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.6)",
  },

  // Top header bar
  topBar: {
    width: "100%",
    maxWidth: 440,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: Platform.OS === "ios" ? 52 : 36,
    paddingBottom: 16,
    zIndex: 10,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.15)",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  tablePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(15, 23, 42, 0.65)",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "rgba(255, 255, 255, 0.2)",
  },
  tablePillText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  // Main Card Container (Ultra-Elevated Modern Card)
  containerCard: {
    width: "92%",
    maxWidth: 410,
    backgroundColor: C.cardSurface,
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 34,
    marginTop: 8,
    shadowColor: C.orangePrimary,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.15,
    shadowRadius: 30,
    elevation: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 94, 26, 0.12)",
  },

  // Brand Logo
  logoSection: {
    alignItems: "center",
    marginBottom: 20,
  },
  logoBadgeContainer: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: "#000000",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 4,
    borderColor: C.orangePrimary,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 5,
  },
  logoBadgeInner: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },
  logoImage: {
    width: "100%",
    height: "100%",
    borderRadius: 35,
    resizeMode: "cover",
  },
  foodIllustration: {
    alignItems: "center",
    justifyContent: "center",
  },
  brandTitle: {
    fontSize: 26,
    fontWeight: "900",
    color: C.textDark,
    fontStyle: "italic",
    letterSpacing: -0.5,
  },

  // Segmented Tab Switcher
  tabBar: {
    flexDirection: "row",
    backgroundColor: "transparent",
    marginBottom: 22,
    borderBottomWidth: 1.5,
    borderBottomColor: "#E2E8F0",
    paddingBottom: 0,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
  },
  tabBtnActive: {
    borderBottomColor: C.orangePrimary,
  },
  tabText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#64748B",
  },
  tabTextActive: {
    color: C.orangePrimary,
    fontWeight: "800",
  },

  // Auth Header Text
  authHeaderBox: {
    alignItems: "center",
    marginBottom: 22,
  },
  authTitle: {
    fontSize: 24,
    fontWeight: "900",
    color: C.textDark,
    marginBottom: 4,
  },
  authSubtitle: {
    fontSize: 14,
    fontWeight: "600",
    color: C.textMuted,
  },

  // Form Container
  formContainer: {
    width: "100%",
  },

  forgotBtn: {
    alignSelf: "flex-end",
    marginTop: -2,
    marginBottom: 22,
    paddingVertical: 4,
  },
  forgotText: {
    fontSize: 13,
    fontWeight: "800",
    color: C.orangePrimary,
  },

  // Primary Orange Pill Button
  primaryPillBtn: {
    height: 52,
    borderRadius: 26,
    backgroundColor: C.orangePrimary,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: C.orangePrimary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.38,
    shadowRadius: 12,
    elevation: 6,
    marginBottom: 22,
  },
  primaryPillBtnText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },

  // Guest Option & Divider Styles
  guestSection: {
    alignItems: "center",
    marginBottom: 22,
    width: "100%",
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    width: "100%",
    marginBottom: 16,
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1.5,
    backgroundColor: "#E2E8F0",
  },
  dividerText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#64748B",
  },
  guestPillBtn: {
    width: "100%",
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: C.orangePrimary,
    backgroundColor: C.orangeTint,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  guestPillBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: C.orangePrimary,
  },

  // Terms & Conditions Checkbox
  termsRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 22,
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "#94A3B8",
    justifyContent: "center",
    alignItems: "center",
  },
  checkboxActive: {
    backgroundColor: C.orangePrimary,
    borderColor: C.orangePrimary,
  },
  termsText: {
    fontSize: 13,
    color: C.textMedium,
    fontWeight: "600",
  },
  termsLink: {
    color: C.orangePrimary,
    fontWeight: "800",
  },

  // Switch Auth Row
  switchAuthRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  switchAuthText: {
    fontSize: 14,
    color: C.textMuted,
    fontWeight: "600",
  },
  switchAuthLink: {
    fontSize: 14,
    fontWeight: "800",
    color: C.orangePrimary,
  },

  // Modals & Overlay
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
  },
  pickerModalContent: {
    width: 300,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 22,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  pickerModalTitle: {
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 14,
    color: C.textDark,
  },
  pickerItem: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  pickerItemText: {
    fontSize: 16,
    fontWeight: "700",
    color: C.textDark,
  },
  pickerCancelBtn: {
    marginTop: 14,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: C.bg,
    borderRadius: 12,
  },
  pickerCancelText: {
    fontSize: 15,
    fontWeight: "800",
    color: C.textMuted,
  },

  alertModalContent: {
    width: "85%",
    maxWidth: 340,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 26,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  alertIconBadge: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: C.orangeTint,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
  },
  alertModalTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: C.textDark,
    marginBottom: 8,
    textAlign: "center",
  },
  alertModalMessage: {
    fontSize: 14,
    color: C.textMuted,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 20,
  },
  alertOkBtn: {
    width: "100%",
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: C.orangePrimary,
    borderRadius: 24,
  },
  alertOkText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#FFFFFF",
  },

  promoModalContent: {
    width: "90%",
    maxWidth: 400,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    ...Platform.select({
      web: { outlineStyle: "none" } as any,
    }),
  },
  promoImage: {
    width: "100%",
    borderRadius: 24,
    backgroundColor: "transparent",
  },
  promoTopCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  promoTopCloseBtnHover: {
    backgroundColor: C.orangePrimary,
    borderColor: "#FFFFFF",
  },
  promoPagination: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
  },
  promoDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255, 255, 255, 0.3)",
  },
  promoDotActive: {
    backgroundColor: C.orangePrimary,
    width: 22,
  },

  // Transition Screen Overlay
  transitionScreen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 99999,
  },
  transitionSpinnerOuter: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 4,
    borderColor: C.orangePrimary,
    borderTopColor: "transparent",
    borderRightColor: "transparent",
  },
  transitionEmojiBadge: {
    position: "absolute",
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#FFF2EC",
    justifyContent: "center",
    alignItems: "center",
  },
  transitionTitle: {
    marginTop: 8,
    fontSize: 19,
    fontWeight: "800",
    color: C.textDark,
    letterSpacing: 0.5,
  },
  transitionSubtitle: {
    marginTop: 6,
    fontSize: 14,
    color: C.textMuted,
  },

  splashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
  },
  splashScroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingBottom: 24,
  },
  splashContent: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 16,
    marginTop: 10,
  },
  splashTextCard: {
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 26,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 4,
    marginTop: 36,
  },
  splashWelcome: {
    fontSize: 14,
    fontWeight: "700",
    color: C.orangePrimary,
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  splashTitle: {
    fontSize: 34,
    fontWeight: "900",
    color: "#0F172A",
    lineHeight: 42,
  },
  splashSubtitle: {
    fontSize: 15,
    color: "#475569",
    marginTop: 8,
    fontWeight: "500",
  },
  splashBtnGroupCard: {
    backgroundColor: "rgba(255, 255, 255, 0.94)",
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingVertical: 24,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 4,
    marginTop: 20,
    gap: 14,
  },
  splashBtnSignIn: {
    height: 52,
    backgroundColor: C.orangePrimary,
    borderRadius: 26,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: C.orangePrimary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  splashBtnSignInText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.3,
  },
  splashBtnSignUp: {
    height: 52,
    backgroundColor: "transparent",
    borderRadius: 26,
    borderWidth: 2,
    borderColor: C.orangePrimary,
    justifyContent: "center",
    alignItems: "center",
  },
  splashBtnSignUpText: {
    fontSize: 16,
    fontWeight: "800",
    color: C.orangePrimary,
    letterSpacing: 0.3,
  },
  splashBtnGuest: {
    alignSelf: "center",
    paddingVertical: 10,
  },
  splashBtnGuestText: {
    color: "#475569",
    fontWeight: "700",
    fontSize: 14,
    textDecorationLine: "underline",
  },
  backBtnCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0, 0, 0, 0.3)",
    justifyContent: "center",
    alignItems: "center",
  },
  mockupCardTitle: {
    fontSize: 28,
    fontWeight: "900",
    color: "#0F172A",
    marginBottom: 8,
  },
  mockupCardSubtitle: {
    fontSize: 14,
    color: C.textMuted,
    marginBottom: 24,
  },
  headerLogoContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    marginBottom: 12,
    width: "100%",
  },
  headerShopNameMy: {
    fontSize: 26,
    fontWeight: "700",
    color: C.orangePrimary,
    fontStyle: "italic",
    fontFamily: Platform.select({ ios: "Georgia", android: "serif", web: "Georgia, serif" }),
    lineHeight: 28,
    marginTop: 4,
  },
  shopNameCapsule: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 22,
    paddingVertical: 7,
    borderRadius: 22,
    marginTop: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
    alignSelf: "center",
  },
  headerShopNameRestaurant: {
    fontSize: 22,
    fontWeight: "900",
    color: C.orangePrimary,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  sloganContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    gap: 8,
  },
  sloganLine: {
    width: 20,
    height: 1.5,
    backgroundColor: C.orangePrimary,
  },
  sloganText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#4A3E3D",
    letterSpacing: 0.3,
  },
});
