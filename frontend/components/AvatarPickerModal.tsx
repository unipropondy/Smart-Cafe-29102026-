import React, { useState, useMemo } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { AVATARS, AvatarItem, getAvatarSource } from "../constants/avatars";
import { Theme } from "../constants/theme";
import { Fonts } from "../constants/Fonts";

interface AvatarPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (url: string | null) => void;
  currentAvatarUrl: string | null;
}

const CATEGORIES = [
  "All",
  "Male",
  "Female",
  "Chef",
  "Waiter",
  "Cashier",
  "Manager",
  "Bartender",
  "Receptionist",
  "Business Professional",
  "Office Staff",
  "Modern Casual",
  "Formal",
  "Marvel",
];

export default function AvatarPickerModal({
  visible,
  onClose,
  onSelect,
  currentAvatarUrl,
}: AvatarPickerModalProps) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const isTablet = windowWidth > 768;
  const modalWidth = isTablet ? 560 : windowWidth;

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  // Filtered avatars based on search & category
  const filteredAvatars = useMemo(() => {
    return AVATARS.filter((avatar) => {
      const matchesCategory =
        selectedCategory === "All" ||
        avatar.categories.some((c) => c.toLowerCase() === selectedCategory.toLowerCase());
      
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        query === "" ||
        avatar.tags.some((tag) => tag.includes(query)) ||
        avatar.categories.some((c) => c.toLowerCase().includes(query));

      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory]);

  const handleSelect = (url: string | null) => {
    onSelect(url);
    onClose();
  };

  const handleRandom = () => {
    const randomIndex = Math.floor(Math.random() * AVATARS.length);
    handleSelect(AVATARS[randomIndex].url);
  };

  const renderAvatarItem = ({ item }: { item: AvatarItem }) => {
    const isSelected = currentAvatarUrl === item.url;
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => handleSelect(item.url)}
        style={[
          styles.avatarCard,
          isSelected && styles.avatarCardSelected,
        ]}
      >
        <Image
          source={getAvatarSource(item.url)}
          style={styles.avatarImage}
          placeholder={require("../assets/images/logo_pos.png")} // Fallback logic / loader placeholder
          transition={200}
        />
        {isSelected && (
          <View style={styles.selectedBadge}>
            <Ionicons name="checkmark-circle" size={20} color="#10B981" />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType={isTablet ? "fade" : "slide"}
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.modalOverlay, isTablet && styles.modalOverlayTablet]}>
        <View
          style={[
            styles.modalContent,
            isTablet && styles.modalContentTablet,
            { height: isTablet ? windowHeight * 0.75 : "85%" },
          ]}
        >
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Avatar Gallery</Text>
              <Text style={styles.subtitle}>Choose your profile picture</Text>
            </View>
            <TouchableOpacity activeOpacity={0.7} onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={Theme.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Quick Actions (Random & Default) */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={handleRandom}
              style={[styles.actionBtn, styles.randomBtn]}
            >
              <Ionicons name="dice-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.actionBtnText}>Random Avatar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => handleSelect(null)}
              style={[styles.actionBtn, styles.defaultBtn]}
            >
              <Ionicons name="refresh-outline" size={18} color={Theme.primary} style={{ marginRight: 6 }} />
              <Text style={[styles.actionBtnText, { color: Theme.primary }]}>Default Avatar</Text>
            </TouchableOpacity>
          </View>

          {/* Search Box */}
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={20} color={Theme.textMuted} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search by hair, glasses, beard, style..."
              placeholderTextColor={Theme.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity activeOpacity={0.7} onPress={() => setSearchQuery("")}>
                <Ionicons name="close-circle" size={18} color={Theme.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Categories Horizontal Scroll */}
          <View style={styles.categoryWrapper}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryContainer}
            >
              {CATEGORIES.map((cat) => {
                const isActive = selectedCategory === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    activeOpacity={0.7}
                    onPress={() => setSelectedCategory(cat)}
                    style={[
                      styles.categoryTab,
                      isActive && styles.categoryTabActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.categoryText,
                        isActive && styles.categoryTextActive,
                      ]}
                    >
                      {cat}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Avatars Grid */}
          {filteredAvatars.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="search-outline" size={48} color={Theme.textMuted} />
              <Text style={styles.emptyText}>No avatars match your search</Text>
            </View>
          ) : (
            <FlatList
              data={filteredAvatars}
              renderItem={renderAvatarItem}
              keyExtractor={(item) => item.id}
              numColumns={4}
              key={"avatar_grid_4"}
              contentContainerStyle={styles.gridContainer}
              showsVerticalScrollIndicator={true}
              getItemLayout={(data, index) => ({
                length: (modalWidth - 48) / 4,
                offset: ((modalWidth - 48) / 4) * index,
                index,
              })}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalOverlayTablet: {
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  modalContent: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    width: "100%",
    paddingBottom: 24,
  },
  modalContentTablet: {
    width: 560,
    borderRadius: 24,
    elevation: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 15,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  title: {
    fontSize: 20,
    fontFamily: Fonts.bold || "System",
    color: Theme.textPrimary,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: Fonts.medium || "System",
    color: Theme.textMuted,
    marginTop: 2,
  },
  closeButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: "#F3F4F6",
  },
  actionRow: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    elevation: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  randomBtn: {
    backgroundColor: Theme.primary,
  },
  defaultBtn: {
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: Theme.primary,
  },
  actionBtnText: {
    fontSize: 14,
    fontFamily: Fonts.bold || "System",
    color: "#fff",
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3F4F6",
    marginHorizontal: 20,
    marginTop: 16,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: Fonts.regular || "System",
    color: Theme.textPrimary,
  },
  categoryWrapper: {
    marginTop: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    paddingBottom: 12,
  },
  categoryContainer: {
    paddingHorizontal: 20,
    gap: 8,
  },
  categoryTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  categoryTabActive: {
    backgroundColor: Theme.primary + "15",
    borderColor: Theme.primary,
  },
  categoryText: {
    fontSize: 13,
    fontFamily: Fonts.semiBold || "System",
    color: Theme.textSecondary,
  },
  categoryTextActive: {
    color: Theme.primary,
  },
  gridContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  avatarCard: {
    flex: 1,
    margin: 6,
    aspectRatio: 1,
    borderRadius: 16,
    backgroundColor: "#F9FAFB",
    borderWidth: 2,
    borderColor: "#F3F4F6",
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
    overflow: "hidden",
  },
  avatarCardSelected: {
    borderColor: "#10B981",
    backgroundColor: "#ECFDF5",
  },
  avatarImage: {
    width: "80%",
    height: "80%",
    borderRadius: 12,
  },
  selectedBadge: {
    position: "absolute",
    top: 4,
    right: 4,
    backgroundColor: "#fff",
    borderRadius: 10,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 40,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: Fonts.medium || "System",
    color: Theme.textMuted,
    marginTop: 12,
  },
});
