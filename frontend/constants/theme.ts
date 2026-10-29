import { Platform } from 'react-native';

/**
 * Light Warm Food POS Theme
 * Primary: Orange #F97316
 * Background: Warm Cream #FAF7F2
 */

export const Theme = {
  // ── Primary Brand ──
  primary: '#FF5E1A',
  primaryDark: '#E04D10',
  primaryLight: '#FFF4EC',
  primaryBorder: 'rgba(255,94,26,0.35)',

  // ── Backgrounds ──
  bgMain: '#FAF7F2',
  bgCard: '#FFFFFF',
  bgInput: '#F5F0E8',
  bgNav: '#FFFFFF',
  bgMuted: '#F0EBE3',
  bgOverlay: 'rgba(250,247,242,0.95)',

  // ── Dark/Professional Palette ──
  bgDark: '#0F172A',     // Midnight Slate
  cardDark: '#1E293B',   // Shadow Slate
  borderDark: '#334155', // Slate Border
  bgDarkMuted: '#1E293B',

  // ── Text ──
  textPrimary: '#1C1C1E',
  textSecondary: '#6B6B6B',
  textMuted: '#9CA3AF',
  textInverse: '#FFFFFF',
  textOrange: '#FF5E1A',

  // ── Borders ──
  border: '#E8E0D5',
  borderStrong: '#D6CBBC',
  borderOrange: 'rgba(255,94,26,0.3)',

  // ── Shadows ──
  shadowSm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: Platform.OS === 'android' ? 0 : 2,
  },
  shadowMd: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
    elevation: Platform.OS === 'android' ? 0 : 4,
  },
  shadowLg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: Platform.OS === 'android' ? 0 : 8,
  },

  // ── Semantic Status Colors (kept for table grid) ──
  success: '#22C55E',
  successBg: '#F0FDF4',
  successBorder: 'rgba(34,197,94,0.35)',

  warning: '#F59E0B',
  warningBg: '#FFFBEB',
  warningBorder: 'rgba(245,158,11,0.35)',

  danger: '#EF4444',
  dangerBg: '#FEF2F2',
  dangerBorder: 'rgba(239,68,68,0.35)',

  info: '#3B82F6',
  infoBg: '#F0F9FF',
  infoBorder: 'rgba(59,130,246,0.35)',

  // ── Table status backgrounds (light versions) ──
  tableLocked: { bg: 'rgba(239,68,68,0.15)', border: '#EF4444' }, // Red for Reserved
  tableHold: { bg: 'rgba(59,130,246,0.15)', border: '#3B82F6' },
  tableSent: { bg: 'rgba(34,197,94,0.15)', border: '#22C55E' }, // Green for Sent/Dining
  tableSentOld: { bg: 'rgba(255,94,26,0.15)', border: '#FF5E1A' },
  tableBillRequest: { bg: 'rgba(245,158,11,0.15)', border: '#F59E0B' }, // Amber for Checkout/Bill
  tableEmpty: { bg: '#FFFFFF', border: '#E8E0D5' },

  // ── Radius ──
  radiusSm: 8,
  radiusMd: 12,
  radiusLg: 16,
  radiusXl: 24,
  radiusFull: 999,
};

// Legacy Colors export to avoid breaking imports
export const Colors = {
  light: {
    text: Theme.textPrimary,
    background: Theme.bgMain,
    tint: Theme.primary,
    icon: Theme.textSecondary,
    tabIconDefault: Theme.textSecondary,
    tabIconSelected: Theme.primary,
  },
  dark: {
    text: Theme.textPrimary,
    background: Theme.bgMain,
    tint: Theme.primary,
    icon: Theme.textSecondary,
    tabIconDefault: Theme.textSecondary,
    tabIconSelected: Theme.primary,
  },
};
