import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Platform } from 'react-native';
import { API_URL } from '../constants/Config';

/**
 * Platform-aware persistent storage.
 * - Android / iOS: AsyncStorage (React Native)
 * - Web / Electron:  localStorage (browser)
 *
 * This is the only platform-specific line in the entire store.
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

export interface CompanySettings {
  name: string;
  address: string;
  gstNo: string;
  gstPercentage: number;
  phone: string;
  email: string;
  reportEmail: string;
  cashierName: string;
  currency: string;
  currencySymbol: string;
  companyLogo: string;
  halalLogo: string;
  printerIp: string;
  showCompanyLogo: boolean;
  showHalalLogo: boolean;
  taxMode: 'exclusive' | 'inclusive';
  waiterRequired: boolean;
  holdOvertimeMinutes: number;
  serviceChargePercentage: number;
  twServiceChargePercentage: number;
  takeawayCharges: number;
}

interface CompanySettingsState {
  settings: CompanySettings;
  loading: boolean;
  fetchSettings: (userId?: string) => Promise<void>;
  updateSettings: (newSettings: Partial<CompanySettings>, userId?: string) => Promise<boolean>;
}

const DEFAULT_SETTINGS: CompanySettings = {
  name: '',
  address: '',
  gstNo: '',
  gstPercentage: 0,
  phone: '',
  email: '',
  reportEmail: '',
  cashierName: '',
  currency: 'SGD',
  currencySymbol: '$',
  companyLogo: '',
  halalLogo: '',
  printerIp: '',
  showCompanyLogo: false,
  showHalalLogo: false,
  taxMode: 'exclusive',
  waiterRequired: true,
  holdOvertimeMinutes: 30,
  serviceChargePercentage: 0,
  twServiceChargePercentage: 0,
  takeawayCharges: 0,
};

export const useCompanySettingsStore = create<CompanySettingsState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      loading: false,

      fetchSettings: async (userId: string = "1") => {
        set({ loading: true });
        try {
          const response = await fetch(`${API_URL}/api/company-settings/1`);
          const data = await response.json();

          if (data && data.success && data.settings) {
            const s = data.settings;
            set({
              settings: {
                name: s.CompanyName || '',
                address: s.Address || '',
                gstNo: s.GSTNo || '',
                gstPercentage: parseFloat(s.GSTPercentage) || 0,
                phone: s.Phone || '',
                email: s.Email || '',
                reportEmail: s.ReportEmail || '',
                cashierName: s.CashierName || '',
                currency: s.Currency || 'SGD',
                currencySymbol: s.CurrencySymbol || '$',
                companyLogo: s.CompanyLogoUrl || '',
                halalLogo: s.HalalLogoUrl || '',
                printerIp: s.PrinterIP || '',
                showCompanyLogo: !!s.ShowCompanyLogo && !!s.CompanyLogoUrl,
                showHalalLogo: !!s.ShowHalalLogo && !!s.HalalLogoUrl,
                taxMode: s.TaxMode || 'exclusive',
                waiterRequired: s.WaiterRequired !== undefined ? !!s.WaiterRequired : true,
                holdOvertimeMinutes: parseInt(s.HoldOvertimeMinutes) || 30,
                serviceChargePercentage: parseFloat(s.ServiceChargePercentage) || 0,
                twServiceChargePercentage: parseFloat(s.TWServiceChargePercentage) || 0,
                takeawayCharges: parseFloat(s.TakeawayCharges) || 0,
              },
            });
          }
        } catch (error) {
          console.error('❌ [CompanySettingsStore] Fetch Error:', error);
        } finally {
          set({ loading: false });
        }
      },

      updateSettings: async (newSettings: Partial<CompanySettings>, userId?: string) => {
        const current = get().settings;
        const updated = { ...current, ...newSettings };
        set({ settings: updated });

        if (!userId) return true;

        try {
          const response = await fetch(`${API_URL}/api/company-settings/1`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              CompanyName: updated.name,
              Address: updated.address,
              GSTNo: updated.gstNo,
              GSTPercentage: updated.gstPercentage,
              Phone: updated.phone,
              Email: updated.email,
              ReportEmail: updated.reportEmail,
              CashierName: updated.cashierName,
              Currency: updated.currency,
              CurrencySymbol: updated.currencySymbol,
              CompanyLogoUrl: updated.companyLogo,
              HalalLogoUrl: updated.halalLogo,
              PrinterIP: updated.printerIp,
              ShowCompanyLogo: updated.showCompanyLogo,
              ShowHalalLogo: updated.showHalalLogo,
              TaxMode: updated.taxMode,
              WaiterRequired: updated.waiterRequired,
              HoldOvertimeMinutes: updated.holdOvertimeMinutes,
              ServiceChargePercentage: updated.serviceChargePercentage,
              TWServiceChargePercentage: updated.twServiceChargePercentage,
              TakeawayCharges: updated.takeawayCharges,
            }),
          });
          const result = await response.json();
          return !!result?.success;
        } catch (error) {
          console.error('❌ [CompanySettingsStore] Save Error:', error);
          return false;
        }
      },
    }),
    {
      name: 'company-settings-storage',
      storage: createJSONStorage(getStorage),
    },
  ),
);
