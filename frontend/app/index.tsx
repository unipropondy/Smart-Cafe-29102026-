import { useEffect } from "react";
import { Redirect } from "expo-router";
import { useAuthStore } from "../stores/authStore";
import { useGeneralSettingsStore } from "../stores/generalSettingsStore";

export default function Index() {
  const { user, loginDate, logout } = useAuthStore();
  const { settings, fetchSettings } = useGeneralSettingsStore();

  useEffect(() => {
    fetchSettings();
  }, []);

  if (user) {
    const currentDate = new Date().toISOString().split("T")[0];
    if (loginDate && currentDate !== loginDate) {
      logout();
      return <Redirect href="/login" />;
    }

    const userName = (user.userName || "").trim().toUpperCase();
    if (user.userGroupId === "DFCF23EE-F6F4-4885-8D26-0056C657595F") {
      return <Redirect href="/sales-report" />;
    }
    if (userName === "KDS") {
      return <Redirect href="/(tabs)/kds" />;
    }
    return <Redirect href="/(tabs)/category" />;
  }

  return <Redirect href="/login" />;
}
