import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";


import { API_URL } from "@/constants/Config";
import { Fonts } from "@/constants/Fonts";
import { useAuthStore } from "@/stores/authStore";
import AsyncStorage from "@react-native-async-storage/async-storage";

/* ================= BRANDING ASSETS ================= */

/** Decorative Matrix Dot Grid */
const DotGrid = ({ style }: { style?: any }) => (
  <View style={[styles.dotGrid, style]} pointerEvents="none">
    {[0, 1, 2, 3].map((row) => (
      <View key={row} style={styles.dotRow}>
        {[0, 1, 2, 3, 4].map((col) => (
          <View key={col} style={styles.dotItem} />
        ))}
      </View>
    ))}
  </View>
);

/* ================= MAIN LOGIN COMPONENT ================= */

export default function LoginScreen() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const setPermissions = useAuthStore((s) => s.setPermissions);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;

  const { width } = useWindowDimensions();
  const isDesktop = width >= 960;

  const [companyCode, setCompanyCode] = useState("");
  const [availableCompanies, setAvailableCompanies] = useState<string[]>([]);
  const [isCompanyFocused, setIsCompanyFocused] = useState(false);

  const [userName, setUserName] = useState("");
  const [isUserFocused, setIsUserFocused] = useState(false);

  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isPassFocused, setIsPassFocused] = useState(false);

  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Prevent unwanted horizontal scrollbars in browser
  useEffect(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      const origBodyOverflowX = document.body.style.overflowX;
      const origHtmlOverflowX = document.documentElement.style.overflowX;
      document.body.style.overflowX = "hidden";
      document.documentElement.style.overflowX = "hidden";
      return () => {
        document.body.style.overflowX = origBodyOverflowX;
        document.documentElement.style.overflowX = origHtmlOverflowX;
      };
    }
  }, []);

  // Dynamically load company codes on mount
  useEffect(() => {
    let isMounted = true;
    const fetchCompanies = async () => {
      try {
        const res = await fetch(`${API_URL}/api/auth/company-codes`);
        if (res.ok) {
          const data = await res.json();
          const list: string[] = (data.companies || data.data || [])
            .map((c: any) => String(c.companyCode || c.branchCode || "").trim())
            .filter((c: string) => c.length > 0);

          if (isMounted && list.length > 0) {
            setAvailableCompanies(list);
          }
        }
      } catch (err) {
        console.warn("Could not load company codes:", err);
      }
    };
    fetchCompanies();
    return () => {
      isMounted = false;
    };
  }, []);

  const filteredCompanies = useMemo(() => {
    if (!companyCode.trim()) return availableCompanies;
    const q = companyCode.trim().toUpperCase();
    return availableCompanies.filter((c) => c.toUpperCase().includes(q));
  }, [availableCompanies, companyCode]);

  useFocusEffect(
    useCallback(() => {
      // Check active session & role
      const { user, loginDate, logout } = useAuthStore.getState();
      if (user) {
        const currentDate = new Date().toISOString().split("T")[0];
        if (loginDate && currentDate !== loginDate) {
          logout();
        } else {
          const uName = (user.userName || "").trim().toUpperCase();
          if (user.userGroupId === "DFCF23EE-F6F4-4885-8D26-0056C657595F") {
            router.replace("/sales-report");
          } else if (uName === "KDS") {
            router.replace("/kds" as any);
          } else {
            router.replace("/(tabs)/category" as any);
          }
          return;
        }
      }

      setError("");
      setLoading(false);

      // Load remembered credentials
      const loadRemembered = async () => {
        try {
          const saved = await AsyncStorage.getItem("remembered_creds");
          if (saved) {
            const { c, u, p } = JSON.parse(saved);
            if (u && p) {
              if (c) setCompanyCode(c);
              setUserName(u);
              setPassword(p);
              setRememberMe(true);
            }
          }
        } catch (e) {}
      };
      loadRemembered();

      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ]).start();
    }, [fadeAnim, slideAnim]),
  );

  const shakeError = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 5, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -5, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleLogin = async () => {
    if (loading) return;

    if (!companyCode.trim()) {
      setError("Please enter Company Code");
      shakeError();
      return;
    }

    if (!userName.trim() || !password.trim()) {
      setError("Please enter both User ID and Password.");
      shakeError();
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyCode: companyCode.trim(),
          userName: userName.trim(),
          password,
        }),
      });
      const data = await response.json();

      if (data.success && data.user) {
        if (
          !data.user.userGroupId ||
          String(data.user.userGroupId).trim() === "" ||
          String(data.user.userGroupId).trim().toUpperCase() === "NULL"
        ) {
          setError("User has no valid group assigned.");
          shakeError();
          setLoading(false);
          return;
        }
        setUser(data.user, data.token);

        try {
          if (rememberMe) {
            await AsyncStorage.setItem(
              "remembered_creds",
              JSON.stringify({
                c: companyCode.trim(),
                u: userName.trim(),
                p: password,
              }),
            );
          } else {
            await AsyncStorage.removeItem("remembered_creds");
          }
        } catch (e) {}

        try {
          const permRes = await fetch(`${API_URL}/api/auth/permissions/${data.user.role}`);
          if (permRes.ok) {
            const permData = await permRes.json();
            setPermissions(permData);
          }
        } catch {
          setPermissions({});
        }

        const role = data.user.role;
        if (data.user.userGroupId === "DFCF23EE-F6F4-4885-8D26-0056C657595F") {
          router.replace("/sales-report");
        } else if (role === "KDS") {
          router.replace("/(tabs)/kds" as any);
        } else {
          router.replace("/(tabs)/category" as any);
        }
      } else {
        setError(data.message || "Login failed. Please try again.");
        shakeError();
      }
    } catch (err: any) {
      console.error("❌ [Login Error]:", err);
      setError("Cannot connect to server. Check your network.");
      shakeError();
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* Background Decorative Layer clipped safely to prevent scrollbars */}
      <View style={styles.backgroundLayer} pointerEvents="none">
        <View style={styles.abstractBlobTopCenter} />
        <View style={styles.abstractBlobTopRight} />
        <View style={styles.abstractBlobBottomRight} />

        <DotGrid style={styles.dotGridTopCenter} />
        <DotGrid style={styles.dotGridTopRight} />
        <DotGrid style={styles.dotGridBottomRight} />
        <DotGrid style={styles.dotGridFarLeft} />
      </View>

      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboardView}
        >
          <ScrollView
            contentContainerStyle={[
              styles.scrollContent,
              isDesktop ? styles.scrollContentDesktop : styles.scrollContentMobile,
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Animated.View
              style={[
                styles.layoutContainer,
                { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
                isDesktop ? styles.layoutWide : styles.layoutStacked,
              ]}
            >
              {/* ════════════ LEFT PROMOTIONAL & HARDWARE SECTION ════════════ */}
              <View style={[styles.leftPromotionalSection, isDesktop ? styles.leftWide : styles.leftStacked]}>
                {/* 1. Unipro Logo Badge with ambient glowing aura */}
                <View style={[styles.brandLogoRow, !isDesktop && styles.brandLogoRowMobile]}>
                  <View style={styles.brandLogoContainer}>
                    <View style={styles.brandLogoAura} />
                    <View style={[styles.brandLogoBox, !isDesktop && styles.brandLogoBoxMobile]}>
                      <Image
                        source={require("@/assets/images/logo_pos.png")}
                        style={[styles.brandLogoImage, !isDesktop && styles.brandLogoImageMobile]}
                        resizeMode="contain"
                      />
                    </View>
                  </View>
                </View>

                {/* 2. Smart Cafe Headings with sleek category pill */}
                <View style={[styles.brandTitleWrap, !isDesktop && styles.brandTitleWrapMobile]}>
                  
                  <Text style={[styles.brandTitle, !isDesktop && styles.brandTitleMobile]}>
                    Smart <Text style={{ color: "#FF5900" }}>Cafe</Text>
                  </Text>
                  <Text style={[styles.brandSubtitle, !isDesktop && styles.brandSubtitleMobile]}>Point of Sale System</Text>
                </View>

                {/* 3. Three Feature Items in modern tactile cards */}
                <View style={[styles.featuresRow, !isDesktop && styles.featuresRowMobile]}>
                  {/* Feature 1: Fast Billing */}
                  <View style={[styles.featureCol, !isDesktop && styles.featureCardMobile]}>
                    <View style={[styles.featureIconBox, !isDesktop && styles.featureIconBoxMobile, { backgroundColor: "#FFF0E6" }]}>
                      <Ionicons name="flash" size={isDesktop ? 18 : 16} color="#FF7315" />
                    </View>
                    <Text style={[styles.featureTitle, !isDesktop && styles.featureTitleMobile]}>Fast Billing</Text>
                    <Text style={[styles.featureDesc, !isDesktop && styles.featureDescMobile]}>Simple & Secure</Text>
                  </View>

                  {/* Feature 2: Easy Reports */}
                  <View style={[styles.featureCol, !isDesktop && styles.featureCardMobile]}>
                    <View style={[styles.featureIconBox, !isDesktop && styles.featureIconBoxMobile, { backgroundColor: "#FFE9EE" }]}>
                      <Ionicons name="bar-chart" size={isDesktop ? 18 : 16} color="#FF3B62" />
                    </View>
                    <Text style={[styles.featureTitle, !isDesktop && styles.featureTitleMobile]}>Easy Reports</Text>
                    <Text style={[styles.featureDesc, !isDesktop && styles.featureDescMobile]}>Business Insights</Text>
                  </View>

                  {/* Feature 3: Better Control */}
                  <View style={[styles.featureCol, !isDesktop && styles.featureCardMobile]}>
                    <View style={[styles.featureIconBox, !isDesktop && styles.featureIconBoxMobile, { backgroundColor: "#F3E8FF" }]}>
                      <Ionicons name="settings" size={isDesktop ? 18 : 16} color="#8E44EC" />
                    </View>
                    <Text style={[styles.featureTitle, !isDesktop && styles.featureTitleMobile]}>Better Control</Text>
                    <Text style={[styles.featureDesc, !isDesktop && styles.featureDescMobile]}>Manage Business</Text>
                  </View>
                </View>

                {/* 4. Desktop Hardware Scene with Monitor, Plant & Printer (Laptop / Desktop only) */}
                {isDesktop && (
                  <View style={styles.hardwareContainer}>
                    <Image
                      source={require("@/assets/images/pos_hardware_desk.png")}
                      style={styles.hardwareImage}
                      resizeMode="contain"
                    />
                  </View>
                )}
              </View>

              {/* ════════════ RIGHT FLOATING SIGN IN CARD ════════════ */}
              <Animated.View
                style={[
                  styles.rightLoginCard,
                  { transform: [{ translateX: shakeAnim }] },
                  isDesktop ? styles.rightWide : styles.rightStacked,
                  !isDesktop && styles.rightCardMobile,
                ]}
              >
                {/* Top Orange Horizontal Accent Pill */}
                <View style={[styles.cardTopAccent, !isDesktop && styles.cardTopAccentMobile]} />

                <Text style={[styles.headingTitle, !isDesktop && styles.headingTitleMobile]}>Sign In</Text>
                <Text style={[styles.headingSubtitle, !isDesktop && styles.headingSubtitleMobile]}>Enter your credentials to continue</Text>

                {/* Error Banner */}
                {error !== "" && (
                  <View style={styles.errorBanner}>
                    <Ionicons name="alert-circle" size={16} color="#DC2626" />
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                )}

                {/* 1. Company Code (Orange Border) */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>COMPANY CODE</Text>
                  <View
                    style={[
                      styles.inputFieldContainer,
                      styles.companyFieldContainer,
                      isCompanyFocused && styles.inputFocused,
                    ]}
                  >
                    <Ionicons
                      name="business-outline"
                      size={19}
                      color="#FF7A1A"
                      style={styles.fieldIcon}
                    />
                    <TextInput
                      style={[styles.textInput, { color: "#111827", fontWeight: "600" }]}
                      placeholder="Enter Company Code"
                      placeholderTextColor="#9CA3AF"
                      value={companyCode}
                      onChangeText={(t) => {
                        setCompanyCode(t);
                        setError("");
                      }}
                      onFocus={() => setIsCompanyFocused(true)}
                      onBlur={() => setIsCompanyFocused(false)}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      returnKeyType="next"
                    />
                  </View>
                </View>

                {/* 2. User ID */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>USER ID</Text>
                  <View
                    style={[
                      styles.inputFieldContainer,
                      isUserFocused && styles.inputFocused,
                    ]}
                  >
                    <Ionicons
                      name="person-outline"
                      size={19}
                      color={isUserFocused ? "#FF5E14" : "#9CA3AF"}
                      style={styles.fieldIcon}
                    />
                    <TextInput
                      style={styles.textInput}
                      placeholder="Enter User Name"
                      placeholderTextColor="#9CA3AF"
                      value={userName}
                      onChangeText={(t) => {
                        setUserName(t);
                        setError("");
                      }}
                      onFocus={() => setIsUserFocused(true)}
                      onBlur={() => setIsUserFocused(false)}
                      autoCapitalize="none"
                      autoCorrect={false}
                      returnKeyType="next"
                    />
                  </View>
                </View>

                {/* 3. Password */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>PASSWORD</Text>
                  <View
                    style={[
                      styles.inputFieldContainer,
                      isPassFocused && styles.inputFocused,
                    ]}
                  >
                    <Ionicons
                      name="lock-closed-outline"
                      size={19}
                      color={isPassFocused ? "#FF5E14" : "#9CA3AF"}
                      style={styles.fieldIcon}
                    />
                    <TextInput
                      style={[styles.textInput, { flex: 1 }]}
                      placeholder="Enter Password"
                      placeholderTextColor="#9CA3AF"
                      value={password}
                      onChangeText={(t) => {
                        setPassword(t);
                        setError("");
                      }}
                      secureTextEntry={!showPassword}
                      onFocus={() => setIsPassFocused(true)}
                      onBlur={() => setIsPassFocused(false)}
                      autoCapitalize="none"
                      returnKeyType="done"
                      onSubmitEditing={handleLogin}
                    />
                    <Pressable
                      onPress={() => setShowPassword(!showPassword)}
                      style={styles.eyeBtn}
                    >
                      <Ionicons
                        name={showPassword ? "eye-off-outline" : "eye-outline"}
                        size={18}
                        color="#9CA3AF"
                      />
                    </Pressable>
                  </View>
                </View>

                {/* 4. Remember Me */}
                <TouchableOpacity
                  style={styles.rememberRow}
                  onPress={() => setRememberMe(!rememberMe)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.checkbox, rememberMe && styles.checkboxActive]}>
                    {rememberMe && <Ionicons name="checkmark" size={12} color="#FFF" />}
                  </View>
                  <Text style={styles.rememberText}>Remember Me</Text>
                </TouchableOpacity>

                {/* 5. Full-width Orange Gradient Sign In Button */}
                <TouchableOpacity
                  style={[styles.signInBtnWrap, loading && { opacity: 0.8 }]}
                  onPress={handleLogin}
                  disabled={loading}
                  activeOpacity={0.88}
                >
                  <LinearGradient
                    colors={["#FF7A28", "#FF4300"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={styles.signInGradient}
                  >
                    {loading ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <>
                        <Ionicons name="log-in-outline" size={20} color="#FFF" />
                        <Text style={styles.signInBtnText}>Sign In</Text>
                      </>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </Animated.View>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

/* ================= STYLES ================= */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFF7F0",
    ...Platform.select({
      web: {
        minHeight: "100vh",
        height: "100vh",
        width: "100%",
        overflowX: "hidden",
        overflowY: "auto",
      } as any,
    }),
  },
  safeArea: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
  },
  scrollContentDesktop: {
    paddingVertical: 16,
    paddingHorizontal: 20,
    ...Platform.select({
      web: {
        minHeight: "100%",
        display: "flex",
        justifyContent: "center",
      } as any,
      default: {
        justifyContent: "center",
      },
    }),
  },
  scrollContentMobile: {
    justifyContent: "center",
    paddingTop: 24,
    paddingBottom: 32,
    paddingHorizontal: 16,
    ...Platform.select({
      web: {
        minHeight: "100%",
        display: "flex",
      } as any,
    }),
  },

  /* Clipped Background Layer to Prevent Horizontal Scrollbars */
  backgroundLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  abstractBlobTopCenter: {
    position: "absolute",
    top: -120,
    left: "28%",
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: "#FFDEC5",
    opacity: 0.55,
  },
  abstractBlobTopRight: {
    position: "absolute",
    top: -60,
    right: -40,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "#FFE5D1",
    opacity: 0.5,
  },
  abstractBlobBottomRight: {
    position: "absolute",
    bottom: -90,
    right: -50,
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: "#FFE8D6",
    opacity: 0.5,
  },

  /* Dot Grid Matrices */
  dotGrid: {
    position: "absolute",
    gap: 7,
  },
  dotGridTopCenter: {
    top: 40,
    left: "45%",
  },
  dotGridTopRight: {
    top: 50,
    right: 28,
  },
  dotGridBottomRight: {
    bottom: 30,
    right: 36,
  },
  dotGridFarLeft: {
    top: "34%",
    left: 20,
  },
  dotRow: {
    flexDirection: "row",
    gap: 7,
  },
  dotItem: {
    width: 3.5,
    height: 3.5,
    borderRadius: 1.75,
    backgroundColor: "#E4C5AF",
  },

  /* Main Responsive Two Column Layout */
  layoutContainer: {
    width: "100%",
    maxWidth: 1120,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: "auto",
  },
  layoutWide: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 36,
  },
  layoutStacked: {
    flexDirection: "column",
    alignItems: "center",
    gap: 18,
    width: "100%",
    maxWidth: 440,
  },

  /* ════════ LEFT PROMOTIONAL SECTION ════════ */
  leftPromotionalSection: {
    justifyContent: "center",
  },
  leftWide: {
    flex: 1.15,
    maxWidth: 510,
    justifyContent: "center",
  },
  leftStacked: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
    alignSelf: "center",
  },

  /* Brand Logo */
  brandLogoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 0,
  },
  brandLogoRowMobile: {
    justifyContent: "center",
    alignSelf: "center",
  },
  brandLogoContainer: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  brandLogoAura: {
    position: "absolute",
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "rgba(255, 122, 26, 0.16)",
    ...Platform.select({
      web: {
        filter: "blur(18px)",
      } as any,
    }),
  },
  brandLogoBox: {
    width: 76,
    height: 76,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#EFE8DF",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
    ...Platform.select({
      web: { boxShadow: "0 4px 16px rgba(0,0,0,0.06)" } as any,
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 3,
      },
    }),
  },
  brandLogoBoxMobile: {
    width: 90,
    height: 90,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: "rgba(255, 218, 190, 0.9)",
    ...Platform.select({
      web: { boxShadow: "0 8px 24px rgba(255, 94, 20, 0.14), 0 2px 6px rgba(0,0,0,0.04)" } as any,
      default: {
        shadowColor: "#FF7A1A",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.14,
        shadowRadius: 12,
        elevation: 5,
      },
    }),
  },
  brandLogoImage: {
    width: 66,
    height: 66,
  },
  brandLogoImageMobile: {
    width: 78,
    height: 78,
  },

  /* App Headings */
  proTagPill: {
    backgroundColor: "#FFF3EB",
    paddingHorizontal: 11,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#FFD5BA",
    marginBottom: 5,
    alignSelf: "center",
  },
  proTagPillText: {
    fontFamily: Fonts.bold,
    fontSize: 9.5,
    color: "#FF5900",
    letterSpacing: 0.8,
  },
  brandTitleWrap: {
    marginTop: 12,
  },
  brandTitleWrapMobile: {
    alignItems: "center",
    marginTop: 8,
  },
  brandTitle: {
    fontFamily: Fonts.black,
    fontSize: 32,
    color: "#18212D",
    letterSpacing: -0.5,
    lineHeight: 38,
  },
  brandTitleMobile: {
    textAlign: "center",
    fontSize: 27,
    lineHeight: 32,
  },
  brandSubtitle: {
    fontFamily: Fonts.medium,
    fontSize: 14,
    color: "#6B7A90",
    marginTop: 2,
  },
  brandSubtitleMobile: {
    textAlign: "center",
    fontSize: 12.5,
    marginTop: 2,
    color: "#6B7A90",
  },

  /* Horizontal 3 Feature Cards */
  featuresRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginTop: 14,
    width: "100%",
    maxWidth: 490,
    gap: 10,
  },
  featuresRowMobile: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    maxWidth: 420,
    marginTop: 12,
    gap: 8,
  },
  featureCol: {
    alignItems: "flex-start",
    flex: 1,
  },
  featureCardMobile: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.88)",
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(255, 222, 195, 0.8)",
    paddingVertical: 9,
    paddingHorizontal: 6,
    ...Platform.select({
      web: {
        boxShadow: "0 3px 10px rgba(255, 100, 20, 0.05), 0 1px 2px rgba(0,0,0,0.03)",
      } as any,
      default: {
        shadowColor: "#FF7A1A",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
        elevation: 2,
      },
    }),
  },
  featureIconBox: {
    width: 38,
    height: 38,
    borderRadius: 11,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 5,
  },
  featureIconBoxMobile: {
    width: 32,
    height: 32,
    borderRadius: 9,
    marginBottom: 4,
  },
  featureTitle: {
    fontFamily: Fonts.bold,
    fontSize: 13,
    color: "#18212D",
  },
  featureTitleMobile: {
    textAlign: "center",
    fontSize: 11.5,
    color: "#18212D",
  },
  featureDesc: {
    fontFamily: Fonts.regular,
    fontSize: 11,
    color: "#728096",
    marginTop: 1,
  },
  featureDescMobile: {
    textAlign: "center",
    fontSize: 9.5,
    color: "#728096",
    marginTop: 1,
  },

  /* Hardware Illustration Container */
  hardwareContainer: {
    width: "100%",
    maxWidth: 510,
    marginTop: 16,
    borderRadius: 16,
    overflow: "hidden",
    alignSelf: "flex-start",
    ...Platform.select({
      web: { aspectRatio: "540 / 325" } as any,
    }),
  },
  hardwareContainerMobile: {
    width: "100%",
    maxWidth: 320,
    maxHeight: 180,
    alignSelf: "center",
    marginTop: 10,
    borderRadius: 14,
  },
  hardwareImage: {
    width: "100%",
    aspectRatio: 540 / 325,
    borderRadius: 16,
  },
  hardwareImageMobile: {
    borderRadius: 14,
  },

  /* ════════ RIGHT FLOATING SIGN IN CARD ════════ */
  rightLoginCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 30,
    paddingHorizontal: 32,
    paddingVertical: 30,
    borderWidth: 1,
    borderColor: "rgba(255, 226, 204, 0.7)",
    ...Platform.select({
      web: {
        boxShadow: "0 18px 48px rgba(0, 0, 0, 0.07), 0 4px 16px rgba(255, 100, 20, 0.04)",
      } as any,
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.07,
        shadowRadius: 18,
        elevation: 8,
      },
    }),
  },
  rightCardMobile: {
    paddingHorizontal: 22,
    paddingVertical: 24,
    borderRadius: 24,
    marginTop: 0,
    borderWidth: 1.5,
    borderColor: "rgba(255, 218, 190, 0.85)",
    ...Platform.select({
      web: {
        boxShadow: "0 14px 40px rgba(0, 0, 0, 0.06), 0 4px 18px rgba(255, 100, 20, 0.05)",
      } as any,
      default: {
        shadowColor: "#FF7A1A",
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 18,
        elevation: 6,
      },
    }),
  },
  rightWide: {
    flex: 0.95,
    maxWidth: 425,
    minWidth: 330,
  },
  rightStacked: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
  },

  cardTopAccent: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#FF5E14",
    marginBottom: 12,
  },
  cardTopAccentMobile: {
    alignSelf: "center",
  },
  headingTitle: {
    fontFamily: Fonts.black,
    fontSize: 29,
    color: "#111827",
    letterSpacing: -0.5,
  },
  headingTitleMobile: {
    textAlign: "center",
    fontSize: 25,
  },
  headingSubtitle: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: "#6B7280",
    marginTop: 2,
    marginBottom: 18,
  },
  headingSubtitleMobile: {
    textAlign: "center",
    fontSize: 12.5,
    marginBottom: 14,
  },

  /* Error Banner */
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  errorText: {
    color: "#DC2626",
    fontSize: 12,
    fontFamily: Fonts.medium,
    flex: 1,
  },

  /* Input Fields */
  inputGroup: {
    marginBottom: 11,
    position: "relative",
  },
  inputLabel: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: "#4B5563",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 5,
  },
  inputFieldContainer: {
    flexDirection: "row",
    alignItems: "center",
    height: 46,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: "#E5E7EB",
    backgroundColor: "#F9F9FB",
    paddingHorizontal: 13,
  },
  companyFieldContainer: {
    borderColor: "#FF7A1A",
    backgroundColor: "#FFFFFF",
  },
  inputFocused: {
    borderColor: "#FF5E14",
    backgroundColor: "#FFFFFF",
    ...Platform.select({
      web: {
        boxShadow: "0 0 0 3px rgba(255, 94, 20, 0.12)",
      } as any,
    }),
  },
  fieldIcon: {
    marginRight: 9,
  },
  textInput: {
    flex: 1,
    color: "#111827",
    fontSize: 14.5,
    fontFamily: Fonts.medium,
    ...Platform.select({ web: { outlineStyle: "none" } as any }),
  },
  dropdownToggleBtn: {
    padding: 4,
  },
  eyeBtn: {
    padding: 4,
  },

  /* Dropdown Autocomplete Menu */
  companyDropdown: {
    position: "absolute",
    top: 70,
    left: 0,
    right: 0,
    zIndex: 1000,
    backgroundColor: "#FFFFFF",
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    ...Platform.select({
      web: {
        boxShadow: "0 10px 28px rgba(0, 0, 0, 0.12)",
      } as any,
      default: {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.12,
        shadowRadius: 16,
        elevation: 8,
      },
    }),
  },
  dropdownItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  dropdownItemSelected: {
    backgroundColor: "#FFF7ED",
  },
  dropdownItemContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dropdownItemText: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: "#374151",
  },
  dropdownItemTextSelected: {
    fontFamily: Fonts.bold,
    color: "#FF5E14",
  },

  /* Remember Me */
  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 3,
    marginBottom: 16,
    paddingLeft: 2,
  },
  checkbox: {
    width: 19,
    height: 19,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  checkboxActive: {
    backgroundColor: "#FF5E14",
    borderColor: "#FF5E14",
  },
  rememberText: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: "#4B5563",
  },

  /* Sign In Button */
  signInBtnWrap: {
    borderRadius: 13,
    overflow: "hidden",
    shadowColor: "#FF5E14",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 6,
  },
  signInGradient: {
    height: 48,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  signInBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontFamily: Fonts.black,
    letterSpacing: 0.2,
  },
});
