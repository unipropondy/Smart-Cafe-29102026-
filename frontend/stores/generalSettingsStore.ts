import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL } from "../constants/Config";
import { useAuthStore } from "./authStore";

export interface GeneralSettings {
  enableKOT: boolean;
  enableKDS: boolean;
  enableCheckoutBill: boolean;
  enableCheckoutFlow: boolean;
  enableDirectProcessToPay: boolean;
  customerSideDisplay: boolean;
  enableGuestDetailsPopup: boolean;
  enableCashDrawer: boolean;
  SVCIdentification: boolean;
  enableKDSPrint: boolean;
  enableCombo: boolean;
  enableQuickServe: boolean;
  showLoyalty: boolean;
  showRewardPoints: boolean;
  showPromoCode: boolean;
  enableOnlinePayment: boolean;
  enableQROrderAutoPrint: boolean;
  enableComboPrint: boolean;
  enableRequestService: boolean;
  enableCookingInstructions: boolean;
  enableDirectPaymentToProcess: boolean;
  enableSkipSummaryScreen: boolean;
  enableReceiptPrint: boolean;
  enableVoiceSuccess: boolean;
  enableNotificationSound: boolean;
  enableQRTWPayAtCashier: boolean;
}

interface GeneralSettingsState {
  settings: GeneralSettings;
  loading: boolean;
  fetchSettings: () => Promise<void>;
  updateSettings: (newSettings: Partial<GeneralSettings>, userInfo?: { userName?: string; userId?: string; userRole?: string }) => Promise<boolean>;
}

export const useGeneralSettingsStore = create<GeneralSettingsState>()(
  persist(
    (set, get) => ({
      settings: {
        enableKOT: true,
        enableKDS: true,
        enableCheckoutBill: true,
        enableCheckoutFlow: true,
        enableDirectProcessToPay: false,
        customerSideDisplay: true,
        enableGuestDetailsPopup: true,
        enableCashDrawer: true,
        SVCIdentification: true,
        enableKDSPrint: true,
        enableCombo: true,
        enableQuickServe: true,
        showLoyalty: true,
        showRewardPoints: true,
        showPromoCode: true,
        enableOnlinePayment: true,
        enableQROrderAutoPrint: true,
        enableComboPrint: false,
        enableRequestService: true,
        enableCookingInstructions: true,
        enableDirectPaymentToProcess: false,
        enableSkipSummaryScreen: false,
        enableReceiptPrint: true,
        enableVoiceSuccess: true,
        enableNotificationSound: true,
        enableQRTWPayAtCashier: true,
      },
      loading: false,

      fetchSettings: async () => {
        set({ loading: true });
        try {
          const response = await fetch(`${API_URL}/api/settings`);
          const data = await response.json();
          
          if (data) {
            set((state) => ({
              settings: {
                ...state.settings,
                enableKOT: data.EnableKOT !== undefined ? Boolean(data.EnableKOT) : true,
                enableKDS: data.EnableKDS !== undefined ? Boolean(data.EnableKDS) : true,
                enableCheckoutBill: data.EnableCheckoutBill !== undefined ? Boolean(data.EnableCheckoutBill) : true,
                enableCheckoutFlow: data.EnableCheckoutFlow !== undefined ? Boolean(data.EnableCheckoutFlow) : true,
                enableDirectProcessToPay: data.EnableDirectProcessToPay !== undefined ? Boolean(data.EnableDirectProcessToPay) : false,
                customerSideDisplay: data.CustomerSideDisplay !== undefined ? Boolean(data.CustomerSideDisplay) : true,
                enableGuestDetailsPopup: data.EnableGuestDetailsPopup !== undefined ? Boolean(data.EnableGuestDetailsPopup) : true,
                enableCashDrawer: data.EnableCashDrawer !== undefined ? Boolean(data.EnableCashDrawer) : true,
                SVCIdentification: data.SVCIdentification !== undefined ? Boolean(data.SVCIdentification) : true,
                enableKDSPrint: data.EnableKDSPrint !== undefined ? Boolean(data.EnableKDSPrint) : true,
                enableCombo: data.EnableCombo !== undefined ? Boolean(data.EnableCombo) : true,
                enableQuickServe: data.EnableQuickServe !== undefined ? Boolean(data.EnableQuickServe) : true,
                showLoyalty: data.ShowLoyalty !== undefined ? Boolean(data.ShowLoyalty) : true,
                showRewardPoints: data.ShowRewardPoints !== undefined ? Boolean(data.ShowRewardPoints) : true,
                showPromoCode: data.ShowPromoCode !== undefined ? Boolean(data.ShowPromoCode) : true,
                enableOnlinePayment: data.EnableOnlinePayment !== undefined ? Boolean(data.EnableOnlinePayment) : true,
                enableQROrderAutoPrint: data.EnableQROrderAutoPrint !== undefined ? Boolean(data.EnableQROrderAutoPrint) : true,
                enableComboPrint: data.EnableComboPrint !== undefined ? Boolean(data.EnableComboPrint) : false,
                enableRequestService: data.EnableRequestService !== undefined ? Boolean(data.EnableRequestService) : true,
                enableCookingInstructions: data.EnableCookingInstructions !== undefined ? Boolean(data.EnableCookingInstructions) : true,
                enableDirectPaymentToProcess: data.EnableDirectPaymentToProcess !== undefined ? Boolean(data.EnableDirectPaymentToProcess) : false,
                enableSkipSummaryScreen: data.EnableSkipSummaryScreen !== undefined ? Boolean(data.EnableSkipSummaryScreen) : false,
                enableReceiptPrint: data.EnableReceiptPrint !== undefined ? Boolean(data.EnableReceiptPrint) : true,
                enableVoiceSuccess: data.EnableVoiceSuccess !== undefined ? Boolean(data.EnableVoiceSuccess) : true,
                enableNotificationSound: data.EnableNotificationSound !== undefined ? Boolean(data.EnableNotificationSound) : true,
                enableQRTWPayAtCashier: data.EnableQRTWPayAtCashier !== undefined ? Boolean(data.EnableQRTWPayAtCashier) : true,
              },
            }));
          }
        } catch (error) {
          console.error("❌ [GeneralSettingsStore] Fetch Error:", error);
        } finally {
          set({ loading: false });
        }
      },

      updateSettings: async (newSettings, userInfo?: { userName?: string; userId?: string; userRole?: string }) => {
        const previousSettings = get().settings;
        const updatedSettings = { ...previousSettings, ...newSettings };
        
        // Optimistic UI update
        set({ settings: updatedSettings, loading: true });

        try {
          // Fetch existing payment settings so we don't overwrite them with null in the API call
          const getRes = await fetch(`${API_URL}/api/settings`);
          const currentData = await getRes.json();
          
          const payload = {
            upiId: currentData.UPI_ID,
            shopName: currentData.ShopName,
            qrCodeUrl: currentData.PayNow_QR_Url,
            enableKOT: updatedSettings.enableKOT,
            enableKDS: updatedSettings.enableKDS,
            enableCheckoutBill: updatedSettings.enableCheckoutBill,
            enableCheckoutFlow: updatedSettings.enableCheckoutFlow,
            enableDirectProcessToPay: updatedSettings.enableDirectProcessToPay,
            customerSideDisplay: updatedSettings.customerSideDisplay,
            enableGuestDetailsPopup: updatedSettings.enableGuestDetailsPopup,
            enableCashDrawer: updatedSettings.enableCashDrawer,
            SVCIdentification: updatedSettings.SVCIdentification,
            enableKDSPrint: updatedSettings.enableKDSPrint,
            enableCombo: updatedSettings.enableCombo,
            enableQuickServe: updatedSettings.enableQuickServe,
            showLoyalty: updatedSettings.showLoyalty,
            showRewardPoints: updatedSettings.showRewardPoints,
            showPromoCode: updatedSettings.showPromoCode,
            enableOnlinePayment: updatedSettings.enableOnlinePayment,
            enableQROrderAutoPrint: updatedSettings.enableQROrderAutoPrint,
            enableComboPrint: updatedSettings.enableComboPrint,
            enableRequestService: updatedSettings.enableRequestService,
            enableCookingInstructions: updatedSettings.enableCookingInstructions,
            enableDirectPaymentToProcess: updatedSettings.enableDirectPaymentToProcess,
            enableSkipSummaryScreen: updatedSettings.enableSkipSummaryScreen,
            enableReceiptPrint: updatedSettings.enableReceiptPrint,
            enableVoiceSuccess: updatedSettings.enableVoiceSuccess,
            enableNotificationSound: updatedSettings.enableNotificationSound,
            enableQRTWPayAtCashier: updatedSettings.enableQRTWPayAtCashier,
            userName: userInfo?.userName || useAuthStore.getState().user?.userName || useAuthStore.getState().user?.fullName || "",
            userId: userInfo?.userId || useAuthStore.getState().user?.userId || "",
            userRole: userInfo?.userRole || useAuthStore.getState().user?.roleName || useAuthStore.getState().user?.role || ""
          };

          const res = await fetch(`${API_URL}/api/settings/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          
          if (!res.ok) throw new Error("Failed to update settings");
          
          set({ loading: false });
          return true;
        } catch (error) {
          console.error("❌ [GeneralSettingsStore] Update Error:", error);
          // Revert on failure
          set({ settings: previousSettings, loading: false });
          return false;
        }
      },
    }),
    {
      name: "general-settings-storage",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);
