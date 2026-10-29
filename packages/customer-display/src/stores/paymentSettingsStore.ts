import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Platform } from 'react-native';
import { API_URL } from '../constants/Config';

/**
 * Platform-aware persistent storage — same pattern as companySettingsStore.
 */
const getStorage = () => {
  if (Platform.OS === 'web') {
    return {
      getItem: (key: string) => Promise.resolve(localStorage.getItem(key)),
      setItem: (key: string, value: string) =>
        Promise.resolve(localStorage.setItem(key, value)),
      removeItem: (key: string) =>
        Promise.resolve(localStorage.removeItem(key)),
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('@react-native-async-storage/async-storage').default;
};

export interface PaymentSettings {
  upiId: string | null;
  payNowQrUrl: string | null;
  shopName: string;
  customerSideDisplay: boolean;
}

export interface CachedPaymentMethod {
  payMode: string;
  description: string;
  position: number;
  active: any;
  commission: number;
  serviceCharge: number;
  isEntertainment: boolean;
  isVoucher: boolean;
  yeahPayEnabled: boolean;
  deviceSn: string | null;
  deviceSalt: string | null;
}

interface PaymentSettingsState {
  settings: PaymentSettings;
  loading: boolean;
  paymentMethods: CachedPaymentMethod[];
  hasLoadedMethods: boolean;
  fetchSettings: () => Promise<void>;
  fetchPaymentMethods: () => Promise<void>;
  updateSettings: (newSettings: Partial<PaymentSettings>) => void;
}

export const usePaymentSettingsStore = create<PaymentSettingsState>()(
  persist(
    (set) => ({
      settings: {
        upiId: null,
        payNowQrUrl: null,
        shopName: 'My Restaurant',
        customerSideDisplay: true,
      },
      loading: false,
      paymentMethods: [],
      hasLoadedMethods: false,

       fetchSettings: async () => {
        set({ loading: true });
        try {
          let token: string | null = null;
          try {
            const storage = getStorage();
            const authData = await storage.getItem('auth-storage');
            if (authData) {
              const parsed = JSON.parse(authData);
              token = parsed.state?.token || null;
            }
          } catch (e) {}

          const response = await fetch(`${API_URL}/api/settings`, {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            }
          });
          const data = await response.json();
          if (data) {
            set({
              settings: {
                upiId: data.UPI_ID || null,
                payNowQrUrl: data.PayNow_QR_Url || null,
                shopName: data.ShopName || 'My Restaurant',
                customerSideDisplay:
                  data.CustomerSideDisplay !== undefined
                    ? Boolean(data.CustomerSideDisplay)
                    : true,
              },
            });
          }
        } catch (error) {
          console.error('❌ [PaymentSettingsStore] Fetch Error:', error);
        } finally {
          set({ loading: false });
        }
      },

      fetchPaymentMethods: async () => {
        try {
          let token: string | null = null;
          try {
            const storage = getStorage();
            const authData = await storage.getItem('auth-storage');
            if (authData) {
              const parsed = JSON.parse(authData);
              token = parsed.state?.token || null;
            }
          } catch (e) {}

          const res = await fetch(`${API_URL}/api/sales/payment-methods`, {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {})
            }
          });
          if (!res.ok) return;
          const data: any[] = await res.json();
          const mapped: CachedPaymentMethod[] = data.map((d) => ({
            payMode: (d.payMode || '').trim(),
            description: (d.description || d.payMode || '').trim(),
            position: d.Position || d.position || 0,
            active: d.active,
            commission: parseFloat(d.commission) || 0,
            serviceCharge: parseFloat(d.serviceCharge) || 0,
            isEntertainment: d.isEntertainment === 1 || d.isEntertainment === true,
            isVoucher: d.isVoucher === 1 || d.isVoucher === true,
            yeahPayEnabled: d.YeahPayEnabled === 1 || d.YeahPayEnabled === true || d.yeahPayEnabled === 1 || d.yeahPayEnabled === true,
            deviceSn: (d.DeviceSN || d.deviceSn || '').trim() || null,
            deviceSalt: (d.DeviceSalt || d.deviceSalt || '').trim() || null,
          }));
          set({ paymentMethods: mapped, hasLoadedMethods: true });
        } catch (error) {
          console.error('❌ [PaymentSettingsStore] fetchPaymentMethods Error:', error);
        }
      },

      updateSettings: (newSettings) => {
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        }));
      },
    }),
    {
      name: 'payment-settings-storage',
      storage: createJSONStorage(getStorage),
      partialize: (state) => ({
        settings: state.settings,
        paymentMethods: state.paymentMethods,
        hasLoadedMethods: state.hasLoadedMethods,
      }),
    },
  ),
);
