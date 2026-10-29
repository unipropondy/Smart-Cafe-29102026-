import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View, StatusBar } from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";

import { Theme } from "../constants/theme";
import { Fonts } from "../constants/Fonts";
import { addToCartGlobal, clearCart } from "../stores/cartStore";
import { getHeldOrders, removeHeldOrder } from "../stores/heldOrdersStore";

const getHeldTime = (time: number) => {
  const diff = Date.now() - time;

  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);

  if (minutes > 0) {
    return `Held ${minutes} min ago`;
  }

  return `Held ${seconds} sec ago`;
};

export default function HeldOrdersScreen() {
  const router = useRouter();


  const [orders, setOrders] = useState(
    [...getHeldOrders()].sort((a, b) => a.time - b.time),
  );

  const refresh = () => {
    const sorted = [...getHeldOrders()].sort((a, b) => a.time - b.time);
    setOrders(sorted);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      refresh();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={Theme.bgMain} />
      
      <View style={styles.container}>
        <View style={styles.topBar}>
          <Pressable 
            style={styles.backBtn} 
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace("/(tabs)/category" as any);
              }
            }}
          >
            <Ionicons name="arrow-back" size={20} color={Theme.textPrimary} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>

          <Text style={styles.title}>Held Orders</Text>

          <View style={{ width: 80 }} />
        </View>

        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: 30 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="cart-outline" size={64} color={Theme.border} />
              <Text style={styles.emptyText}>No Held Orders</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.orderLabelContainer}>
                  <Text style={styles.header}>
                    Order #{typeof item.orderId === "object" ? "Unknown" : item.orderId}
                  </Text>
                  {item.context?.orderType === "DINE_IN" && (
                    <Text style={styles.subHeader}>
                      {item.context.section} • Table {item.context.tableNo}
                    </Text>
                  )}
                  {item.context?.orderType === "TAKEAWAY" && (
                    <Text style={styles.subHeader}>
                      Takeaway {item.context.takeawayNo}
                    </Text>
                  )}
                </View>
                <View style={styles.timeBadge}>
                  <Ionicons name="time-outline" size={14} color={Theme.primary} />
                  <Text style={styles.time}>{getHeldTime(item.time)}</Text>
                </View>
              </View>

              <View style={styles.divider} />

              <View style={styles.itemsList}>
                {item.cart.map((food, i) => (
                  <View key={i} style={styles.itemRow}>
                    <Text style={styles.itemText}>
                      <Text style={styles.itemQty}>{food.qty}x</Text> {food.name}
                    </Text>

                    <View style={styles.modsContainer}>
                      {food.spicy && food.spicy !== "Medium" && (
                        <Text style={styles.mod}>🌶 {food.spicy}</Text>
                      )}
                      {food.note && <Text style={styles.mod}>📝 {food.note}</Text>}
                    </View>
                  </View>
                ))}
              </View>

              <Pressable
                style={styles.openBtn}
                onPress={() => {
                  clearCart();
                  item.cart.forEach((food) => {
                    for (let i = 0; i < food.qty; i++) {
                      addToCartGlobal(food);
                    }
                  });
                  removeHeldOrder(item.id);
                  refresh();
                  router.replace("/(tabs)/category" as any);
                }}
              >
                <Ionicons name="cart-outline" size={18} color="#fff" style={{marginRight: 8}} />
                <Text style={styles.btnText}>Open Order</Text>
              </Pressable>
            </View>
          )}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Theme.bgMain,
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: Theme.border,
    marginBottom: 20,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.bgMuted,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Theme.border,
    gap: 5,
  },
  backText: {
    color: Theme.textPrimary,
    fontFamily: Fonts.bold,
    fontSize: 14,
  },
  title: {
    color: Theme.textPrimary,
    fontSize: 22,
    fontFamily: Fonts.black,
  },
  card: {
    backgroundColor: Theme.bgCard,
    padding: 20,
    borderRadius: 20,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: Theme.border,
    ...Theme.shadowMd,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  orderLabelContainer: {
    flex: 1,
  },
  header: {
    color: Theme.textPrimary,
    fontFamily: Fonts.black,
    fontSize: 18,
    marginBottom: 4,
  },
  subHeader: {
    color: Theme.primaryDark,
    fontFamily: Fonts.bold,
    fontSize: 13,
  },
  timeBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Theme.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  time: {
    color: Theme.primary,
    fontSize: 11,
    fontFamily: Fonts.bold,
  },
  divider: {
    height: 1,
    backgroundColor: Theme.border,
    marginVertical: 15,
    borderStyle: "dashed",
    borderWidth: 1,
    borderRadius: 1,
  },
  itemsList: {
    marginBottom: 15,
  },
  itemRow: {
    marginBottom: 8,
  },
  itemText: {
    color: Theme.textPrimary,
    fontFamily: Fonts.medium,
    fontSize: 15,
  },
  itemQty: {
    color: Theme.primary,
    fontFamily: Fonts.black,
  },
  modsContainer: {
    flexDirection: "row",
    gap: 10,
    marginTop: 2,
    paddingLeft: 22,
  },
  mod: {
    color: Theme.textSecondary,
    fontSize: 12,
    fontFamily: Fonts.regular,
  },
  openBtn: {
    flexDirection: "row",
    backgroundColor: Theme.primary,
    paddingVertical: 14,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    ...Theme.shadowSm,
  },
  btnText: {
    color: "#fff",
    fontFamily: Fonts.black,
    fontSize: 15,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 80,
  },
  emptyText: {
    color: Theme.textMuted,
    fontSize: 18,
    fontFamily: Fonts.medium,
    marginTop: 15,
  },
});
