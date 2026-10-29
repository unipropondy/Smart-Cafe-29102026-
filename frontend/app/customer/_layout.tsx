import React from "react";
import { Stack } from "expo-router";

export default function CustomerLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="menu" />
      <Stack.Screen name="item-details" />
      <Stack.Screen name="cart" />
      <Stack.Screen name="order-status" />
    </Stack>
  );
}
