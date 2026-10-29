import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  useWindowDimensions
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons, FontAwesome5 } from "@expo/vector-icons";
import axios from "axios";
import { API_URL } from "@/constants/Config";
import { useAuthStore } from "@/stores/authStore";
import { Theme } from "@/constants/theme";
import { Fonts } from "@/constants/Fonts";
import { SafeAreaView } from "react-native-safe-area-context";

export default function RewardMasterScreen() {
  const router = useRouter();
  const { token } = useAuthStore();
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;

  // Admin access validation states
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [passwordValue, setPasswordValue] = useState("");
  const [verifyingPassword, setVerifyingPassword] = useState(false);

  // Rule configuration states
  const [spendAmount, setSpendAmount] = useState("100");
  const [creditAmount, setCreditAmount] = useState("1");
  const [description, setDescription] = useState("");
  const [isSavingRule, setIsSavingRule] = useState(false);

  // Member search states
  const [searchText, setSearchText] = useState("");
  const [members, setMembers] = useState<any[]>([]);
  const [isSearchingMembers, setIsSearchingMembers] = useState(false);

  // Selected member history states
  const [selectedMember, setSelectedMember] = useState<any | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Fetch active rule on load (after admin validation passes)
  useEffect(() => {
    if (isAdminUnlocked) {
      fetchActiveRule();
    }
  }, [isAdminUnlocked]);

  const fetchActiveRule = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/rewards/master`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data) {
        setSpendAmount(String(res.data.SpendAmount || 100));
        setCreditAmount(String(res.data.CreditAmount || 1));
        setDescription(res.data.Description || "");
      }
    } catch (err: any) {
      console.error("Error fetching reward rule:", err);
      Alert.alert("Error", "Failed to load active reward configurations.");
    }
  };

  const handlePasswordVerify = async () => {
    if (!passwordValue) {
      Alert.alert("Required", "Please enter password");
      return;
    }
    setVerifyingPassword(true);
    try {
      const verifyRes = await fetch(`${API_URL}/api/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordValue }),
      });
      const verifyData = await verifyRes.json();
      if (verifyData.success) {
        setIsAdminUnlocked(true);
      } else {
        Alert.alert("Access Denied", "Incorrect admin password");
      }
    } catch (err) {
      Alert.alert("Error", "Could not verify password. Check connection.");
    } finally {
      setVerifyingPassword(false);
    }
  };

  const handleSaveRule = async () => {
    const spend = parseFloat(spendAmount);
    const credit = parseFloat(creditAmount);
    if (isNaN(spend) || spend <= 0 || isNaN(credit) || credit <= 0) {
      Alert.alert("Invalid Input", "Please enter positive numbers for spend and credit amounts.");
      return;
    }

    setIsSavingRule(true);
    try {
      await axios.put(
        `${API_URL}/api/rewards/master`,
        { spendAmount: spend, creditAmount: credit, description },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      Alert.alert("Success", "Reward earn configurations updated successfully.");
      fetchActiveRule();
    } catch (err: any) {
      console.error("Error updating rule:", err);
      Alert.alert("Error", "Failed to update reward rule configurations.");
    } finally {
      setIsSavingRule(false);
    }
  };

  const handleSearchMembers = async (text: string) => {
    setSearchText(text);
    const clean = text.trim();
    if (!clean) {
      setMembers([]);
      return;
    }

    setIsSearchingMembers(true);
    try {
      const res = await axios.get(`${API_URL}/api/rewards/members/search?q=${encodeURIComponent(clean)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMembers(res.data || []);
    } catch (err: any) {
      console.error("Error searching members:", err);
    } finally {
      setIsSearchingMembers(false);
    }
  };

  const handleSelectMember = async (member: any) => {
    setSelectedMember(member);
    setIsLoadingHistory(true);
    try {
      const res = await axios.get(`${API_URL}/api/rewards/history/${member.MemberId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setHistory(res.data || []);
    } catch (err: any) {
      console.error("Error fetching history:", err);
      Alert.alert("Error", "Failed to load history.");
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/menu/settlement" as any);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
          <Ionicons name="arrow-back" size={24} color={Theme.textPrimary} />
        </TouchableOpacity>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <FontAwesome5 name="gift" size={18} color="#FF6B00" style={{ marginRight: 8 }} />
          <Text style={styles.headerTitle}>Reward Points Master</Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContent}>
          
          {/* Rule Configuration Section */}
          <View style={[styles.card, styles.premiumCard]}>
            <View style={styles.cardHeaderRow}>
              <View style={styles.iconCircle}>
                <FontAwesome5 name="cog" size={18} color="#FF6B00" />
              </View>
              <View style={{ marginLeft: 12 }}>
                <Text style={styles.cardTitle}>Reward Configuration Rule</Text>
                <Text style={styles.cardSubtitle}>
                  Configure how much reward wallet cashback points members earn.
                </Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.row}>
              <View style={[styles.inputGroup, { flex: 1 }]}>
                <Text style={styles.inputLabel}>Every spent amount ($)</Text>
                <View style={styles.inputWrapper}>
                  <FontAwesome5 name="shopping-bag" size={14} color="#9CA3AF" style={styles.inputIcon} />
                  <TextInput
                    style={styles.premiumInput}
                    keyboardType="numeric"
                    value={spendAmount}
                    onChangeText={setSpendAmount}
                    placeholder="e.g. 100"
                  />
                </View>
              </View>

              <View style={[styles.inputGroup, { flex: 1, marginLeft: 15 }]}>
                <Text style={styles.inputLabel}>Earns credit reward ($)</Text>
                <View style={styles.inputWrapper}>
                  <FontAwesome5 name="gift" size={14} color="#9CA3AF" style={styles.inputIcon} />
                  <TextInput
                    style={styles.premiumInput}
                    keyboardType="numeric"
                    value={creditAmount}
                    onChangeText={setCreditAmount}
                    placeholder="e.g. 1.00"
                  />
                </View>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Description / Notes</Text>
              <View style={styles.inputWrapper}>
                <FontAwesome5 name="pen" size={14} color="#9CA3AF" style={styles.inputIcon} />
                <TextInput
                  style={styles.premiumInput}
                  value={description}
                  onChangeText={setDescription}
                  placeholder="e.g. Standard 1% Loyalty Cashback Points"
                />
              </View>
            </View>

            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveRule} disabled={isSavingRule}>
              {isSavingRule ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>Update Reward Config Rule</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Member Search & History Section */}
          <View style={[styles.row, { marginTop: 24, alignItems: "flex-start" }]}>
            
            {/* Left Column: Member Search */}
            <View style={{ flex: isTablet ? 1 : undefined, width: isTablet ? undefined : "100%" }}>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Member Reward Wallet Lookup</Text>
                
                <View style={styles.searchBar}>
                  <Ionicons name="search" size={20} color="#9CA3AF" style={{ marginRight: 8 }} />
                  <TextInput
                    style={styles.searchInput}
                    value={searchText}
                    onChangeText={handleSearchMembers}
                    placeholder="Search members..."
                  />
                  {isSearchingMembers && <ActivityIndicator size="small" color={Theme.primary} />}
                </View>

                <FlatList
                  data={members}
                  keyExtractor={(item) => item.MemberId}
                  scrollEnabled={false}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[
                        styles.memberItem,
                        selectedMember?.MemberId === item.MemberId && styles.memberItemSelected
                      ]}
                      onPress={() => handleSelectMember(item)}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.memberName}>{item.Name}</Text>
                        <View style={styles.phoneRow}>
                          <Ionicons name="call" size={12} color="#9CA3AF" style={{ marginRight: 4 }} />
                          <Text style={styles.memberPhone}>{item.Phone}</Text>
                        </View>
                      </View>
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>
                          ${(parseFloat(item.RewardCredit) || 0).toFixed(2)} pts
                        </Text>
                      </View>
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={() => (
                    <View style={styles.emptyContainer}>
                      <FontAwesome5 name="users" size={32} color="#D1D5DB" />
                      <Text style={styles.emptyText}>
                        {searchText ? "No matching members found." : "Search members to check wallets."}
                      </Text>
                    </View>
                  )}
                />
              </View>
            </View>

            {/* Right Column: Reward History Logs */}
            {isTablet && (
              <View style={{ flex: 1, marginLeft: 20 }}>
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Point History & Logs</Text>
                  {selectedMember ? (
                    <View>
                      <View style={styles.memberSummary}>
                        <View style={styles.summaryTopRow}>
                          <View>
                            <Text style={styles.summaryName}>{selectedMember.Name}</Text>
                            <Text style={styles.summaryPhone}>{selectedMember.Phone}</Text>
                          </View>
                          <View style={styles.walletTotalContainer}>
                            <Text style={styles.walletTotalLabel}>Points Balance</Text>
                            <Text style={styles.walletTotalVal}>
                              ${(parseFloat(selectedMember.RewardCredit) || 0).toFixed(2)}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {isLoadingHistory ? (
                        <ActivityIndicator size="large" color={Theme.primary} style={{ marginTop: 24 }} />
                      ) : (
                        <FlatList
                          data={history}
                          keyExtractor={(item) => item.Id || String(Math.random())}
                          scrollEnabled={false}
                          renderItem={({ item }) => {
                            const isRedeemed = item.TransType === "REDEEM" || parseFloat(item.PointsUsed) > 0;
                            return (
                              <View style={[
                                styles.historyCard, 
                                isRedeemed ? styles.historyCardRedeemed : styles.historyCardEarned
                              ]}>
                                <View style={styles.historyCardHeader}>
                                  <View style={styles.billBadge}>
                                    <Text style={styles.billBadgeText}>Bill: {item.BillNo || "N/A"}</Text>
                                  </View>
                                  <Text style={styles.historyDate}>
                                    {new Date(item.CreatedOn).toLocaleDateString()} {new Date(item.CreatedOn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </Text>
                                </View>
                                
                                <View style={styles.historyCardBody}>
                                  <View style={{ flex: 1, paddingRight: 10 }}>
                                    <Text style={styles.historyRemarks}>{item.Remarks || (isRedeemed ? "Redeemed points" : "Earned points")}</Text>
                                    <View style={styles.paymodeRow}>
                                      <FontAwesome5 name="wallet" size={10} color="#9CA3AF" style={{ marginRight: 4 }} />
                                      <Text style={styles.paymodeText}>Paymode: {item.PayMode || "CASH"}</Text>
                                    </View>
                                  </View>
                                  
                                  <View style={styles.pointsActionContainer}>
                                    <Text 
                                      style={[
                                        styles.historyPointsVal, 
                                        isRedeemed ? styles.pointsRedeemedText : styles.pointsEarnedText
                                      ]}
                                    >
                                      {isRedeemed ? "-" : "+"}${isRedeemed ? (parseFloat(item.PointsUsed) || 0).toFixed(2) : (parseFloat(item.PointsEarned) || 0).toFixed(2)}
                                    </Text>
                                  </View>
                                </View>
                              </View>
                            );
                          }}
                          ListEmptyComponent={() => (
                            <View style={styles.emptyContainer}>
                              <FontAwesome5 name="history" size={28} color="#D1D5DB" />
                              <Text style={styles.emptyText}>No transaction history logs found.</Text>
                            </View>
                          )}
                        />
                      )}
                    </View>
                  ) : (
                    <View style={styles.emptyContainer}>
                      <FontAwesome5 name="hand-pointer" size={32} color="#D1D5DB" />
                      <Text style={styles.emptyText}>Select a member to view reward history logs.</Text>
                    </View>
                  )}
                </View>
              </View>
            )}

          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Access Verification Modal */}
      <Modal
        visible={!isAdminUnlocked}
        transparent
        animationType="fade"
        onRequestClose={handleBack}
      >
        <View style={styles.pwOverlay}>
          <View style={styles.pwModalContentContainer}>
            <View style={styles.pwIconContainer}>
              <FontAwesome5 name="lock" size={32} color="#FF6B00" />
            </View>
            <Text style={styles.pwHeaderTitleCentered}>🔒 Admin Verification</Text>
            <Text style={styles.pwSubtitleCentered}>
              Enter admin password to access Shop Settings
            </Text>

            <TextInput
              style={styles.pwInputContainer}
              secureTextEntry
              placeholder="Enter Password"
              placeholderTextColor="#9CA3AF"
              value={passwordValue}
              onChangeText={setPasswordValue}
              onSubmitEditing={handlePasswordVerify}
              autoFocus
            />

            <View style={styles.pwModalButtonsRow}>
              <TouchableOpacity style={styles.pwCancelBtn} onPress={handleBack}>
                <Text style={styles.pwCancelBtnText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.pwVerifyBtn} 
                onPress={handlePasswordVerify}
                disabled={verifyingPassword}
              >
                {verifyingPassword ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.pwVerifyBtnText}>Verify</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#FAF7F2",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    backgroundColor: "#FAF7F2",
    position: "relative",
  },
  backBtn: {
    position: "absolute",
    left: 16,
    padding: 8,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    zIndex: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    textAlign: "center",
  },
  scrollContent: {
    padding: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    shadowColor: "#172B4D",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  premiumCard: {
    borderTopWidth: 4,
    borderTopColor: "#FF6B00",
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#FFF7ED",
    alignItems: "center",
    justifyContent: "center",
  },
  divider: {
    height: 1,
    backgroundColor: "#E5E7EB",
    marginVertical: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  cardSubtitle: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: "#6B7280",
    marginTop: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 0,
    borderRadius: 8,
    backgroundColor: "#F3F4F6",
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 10,
  },
  premiumInput: {
    flex: 1,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
    outlineWidth: 0,
  },
  saveBtn: {
    backgroundColor: "#FF6B00",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    shadowColor: "#FF6B00",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 14,
    fontFamily: Fonts.black,
    letterSpacing: 0.3,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 0,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#F3F4F6",
    marginBottom: 16,
    marginTop: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
    outlineWidth: 0,
  },
  memberItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    borderRadius: 8,
    marginVertical: 2,
  },
  memberItemSelected: {
    backgroundColor: "#FFF7ED",
    borderLeftWidth: 4,
    borderLeftColor: "#FF6B00",
  },
  memberName: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  phoneRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  memberPhone: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: "#6B7280",
  },
  badge: {
    backgroundColor: "#EFF6FF",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    fontFamily: Fonts.bold,
    color: "#1D4ED8",
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
  },
  emptyText: {
    textAlign: "center",
    color: "#9CA3AF",
    fontSize: 13,
    fontFamily: Fonts.medium,
    marginTop: 10,
  },
  memberSummary: {
    padding: 14,
    backgroundColor: "#F3F4F6",
    borderRadius: 8,
    marginBottom: 16,
  },
  summaryTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryName: {
    fontSize: 15,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  summaryPhone: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: "#6B7280",
    marginTop: 2,
  },
  walletTotalContainer: {
    alignItems: "flex-end",
  },
  walletTotalLabel: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Theme.textSecondary,
    textTransform: "uppercase",
  },
  walletTotalVal: {
    fontSize: 18,
    fontFamily: Fonts.black,
    color: Theme.success,
    marginTop: 2,
  },
  historyCard: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  historyCardEarned: {
    borderColor: "#DEF7EC",
    backgroundColor: "#F3FAF7",
    borderLeftWidth: 4,
    borderLeftColor: "#31C48D",
  },
  historyCardRedeemed: {
    borderColor: "#FDE8E8",
    backgroundColor: "#FDF2F2",
    borderLeftWidth: 4,
    borderLeftColor: "#F98080",
  },
  historyCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.03)",
    paddingBottom: 6,
    marginBottom: 6,
  },
  billBadge: {
    backgroundColor: "rgba(0,0,0,0.05)",
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  billBadgeText: {
    fontSize: 10,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  historyCardBody: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  historyRemarks: {
    fontSize: 13,
    fontFamily: Fonts.bold,
    color: Theme.textPrimary,
  },
  paymodeRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  paymodeText: {
    fontSize: 11,
    fontFamily: Fonts.medium,
    color: "#6B7280",
  },
  historyDate: {
    fontSize: 10,
    fontFamily: Fonts.medium,
    color: "#9CA3AF",
  },
  pointsActionContainer: {
    alignItems: "flex-end",
    justifyContent: "center",
  },
  historyPointsVal: {
    fontSize: 15,
    fontFamily: Fonts.black,
  },
  pointsEarnedText: {
    color: "#0E9F6E",
  },
  pointsRedeemedText: {
    color: "#E02424",
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
  pwModalContentContainer: {
    width: 380,
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 32,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 5,
  },
  pwIconContainer: {
    marginBottom: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  pwHeaderTitleCentered: {
    fontSize: 20,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
    textAlign: "center",
    marginBottom: 8,
  },
  pwSubtitleCentered: {
    fontSize: 13,
    fontFamily: Fonts.medium,
    color: "#6B7280",
    textAlign: "center",
    marginBottom: 24,
  },
  pwInputContainer: {
    width: "100%",
    height: 48,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Theme.textPrimary,
    backgroundColor: "#FAF7F2",
    marginBottom: 24,
    textAlign: "center",
    outlineWidth: 0,
  },
  pwModalButtonsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    width: "100%",
    gap: 12,
  },
  pwCancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  pwCancelBtnText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: "#6B7280",
  },
  pwVerifyBtn: {
    flex: 1,
    height: 46,
    borderRadius: 12,
    backgroundColor: "#FF6B00",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#FF6B00",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  pwVerifyBtnText: {
    fontSize: 14,
    fontFamily: Fonts.bold,
    color: "#fff",
  },
});
