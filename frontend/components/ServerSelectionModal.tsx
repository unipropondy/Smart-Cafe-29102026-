import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Theme } from "../constants/theme";
import { Fonts } from "../constants/Fonts";

interface Server {
  SER_ID: number;
  SER_NAME: string;
}

interface ServerSelectionModalProps {
  visible: boolean;
  onClose: () => void;
  servers: Server[];
  loading: boolean;
  selectedServerId?: number;
  onSelect: (server?: Server) => void;
}

const ServerSelectionModal = ({
  visible,
  onClose,
  servers,
  loading,
  selectedServerId,
  onSelect,
}: ServerSelectionModalProps) => {
  return (
    <Modal transparent visible={visible} animationType="slide">
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { maxHeight: "80%" }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Select Waiter</Text>
            <TouchableOpacity onPress={onClose}>
              <Ionicons name="close" size={24} color={Theme.textPrimary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.modalDesc}>Who is serving this table?</Text>

          {loading ? (
            <ActivityIndicator color={Theme.primary} style={{ margin: 20 }} />
          ) : (
            <FlatList
              data={servers}
              keyExtractor={(item) => item.SER_ID.toString()}
              ListHeaderComponent={
                selectedServerId ? (
                  <TouchableOpacity
                    style={[
                      styles.serverItem,
                      {
                        borderBottomWidth: 1,
                        borderBottomColor: Theme.border,
                        marginBottom: 10,
                      },
                    ]}
                    onPress={() => onSelect(undefined)}
                  >
                    <View
                      style={[
                        styles.serverAvatar,
                        { backgroundColor: Theme.danger + "15" },
                      ]}
                    >
                      <Ionicons name="close" size={20} color={Theme.danger} />
                    </View>
                    <Text
                      style={[
                        styles.serverItemName,
                        { color: Theme.danger, fontFamily: Fonts.bold },
                      ]}
                    >
                      Clear Selection (No Waiter)
                    </Text>
                  </TouchableOpacity>
                ) : null
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.serverItem,
                    selectedServerId === item.SER_ID && styles.serverItemSelected,
                  ]}
                  onPress={() => onSelect(item)}
                >
                  <View
                    style={[
                      styles.serverAvatar,
                      {
                        backgroundColor:
                          selectedServerId === item.SER_ID
                            ? Theme.primary
                            : Theme.bgNav,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.serverAvatarText,
                        {
                          color:
                            selectedServerId === item.SER_ID
                              ? "#fff"
                              : Theme.textPrimary,
                        },
                      ]}
                    >
                      {item.SER_NAME.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.serverItemName,
                      selectedServerId === item.SER_ID && {
                        color: Theme.primary,
                        fontFamily: Fonts.bold,
                      },
                    ]}
                  >
                    {item.SER_NAME}
                  </Text>
                  {selectedServerId === item.SER_ID && (
                    <Ionicons
                      name="checkmark-circle"
                      size={22}
                      color={Theme.primary}
                    />
                  )}
                </TouchableOpacity>
              )}
              contentContainerStyle={{ paddingBottom: 20 }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalContent: {
    backgroundColor: Theme.bgCard,
    borderRadius: 24,
    padding: 24,
    width: "100%",
    maxWidth: 400,
    ...Theme.shadowLg,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: Fonts.black,
    color: Theme.textPrimary,
  },
  modalDesc: {
    fontSize: 14,
    fontFamily: Fonts.semiBold,
    color: Theme.textSecondary,
    marginBottom: 20,
  },
  serverItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  serverItemSelected: {
    backgroundColor: Theme.primary + "10",
  },
  serverAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  serverAvatarText: {
    fontSize: 16,
    fontFamily: Fonts.black,
  },
  serverItemName: {
    flex: 1,
    fontSize: 16,
    fontFamily: Fonts.semiBold,
    color: Theme.textPrimary,
  },
});

export default ServerSelectionModal;
