import { useEffect, useState } from "react";
import { Platform } from "react-native";

export const APP_VERSION = "5.0.0";
const STORAGE_KEY = "pos_install_prompt_dismissed_version";

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const [deviceType, setDeviceType] = useState<"android" | "ios" | "desktop">("desktop");
  const [isStandalone, setIsStandalone] = useState<boolean>(false);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;

    // Detect standalone PWA mode
    const inStandaloneMode =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true ||
      document.referrer.includes("android-app://");
    setIsStandalone(inStandaloneMode);

    if (inStandaloneMode) {
      return; // Already installed as PWA, do not prompt
    }

    // Device detection
    const ua = navigator.userAgent || navigator.vendor || (window as any).opera || "";
    let detectedDevice: "android" | "ios" | "desktop" = "desktop";

    if (/android/i.test(ua)) {
      detectedDevice = "android";
    } else if (/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream) {
      detectedDevice = "ios";
    } else if (
      navigator.platform === "MacIntel" &&
      navigator.maxTouchPoints > 1 // iPadOS detection
    ) {
      detectedDevice = "ios";
    }

    setDeviceType(detectedDevice);

    // Check localStorage dismissal state for current version
    const dismissedVersion = localStorage.getItem(STORAGE_KEY);
    const hasBeenDismissedForCurrentVersion = dismissedVersion === APP_VERSION;

    if (hasBeenDismissedForCurrentVersion) {
      return;
    }

    // Listen for PWA beforeinstallprompt event
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // For iOS or browsers where beforeinstallprompt isn't fired, show modal automatically after short delay if not dismissed
    const timer = setTimeout(() => {
      if (!hasBeenDismissedForCurrentVersion) {
        setIsVisible(true);
      }
    }, 1500);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      clearTimeout(timer);
    };
  }, []);

  const triggerPwaInstall = async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choiceResult = await deferredPrompt.userChoice;
        if (choiceResult.outcome === "accepted") {
          dismissPrompt();
        }
      } catch (err) {
        console.warn("PWA install prompt error:", err);
      }
      setDeferredPrompt(null);
    }
  };

  const dismissPrompt = () => {
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.setItem(STORAGE_KEY, APP_VERSION);
    }
    setIsVisible(false);
  };

  const downloadApk = () => {
    dismissPrompt();
    if (typeof window !== "undefined") {
      const link = document.createElement("a");
      link.href = "/download/Restaurant.apk";
      link.download = "Restaurant.apk";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return {
    isVisible,
    deviceType,
    isStandalone,
    canPromptPwa: !!deferredPrompt,
    triggerPwaInstall,
    dismissPrompt,
    downloadApk,
  };
}
