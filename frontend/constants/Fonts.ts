/**
 * Global font family constants for Smart Cafe POS.
 * Always use these instead of hardcoding fontFamily strings.
 *
 * Weight mapping:
 *  Inter_400Regular  → normal body text
 *  Inter_500Medium   → labels, secondary text
 *  Inter_600SemiBold → strong labels, buttons
 *  Inter_700Bold     → headings
 *  Inter_800ExtraBold→ section titles, totals
 *  Inter_900Black    → hero numbers, grand total
 */

export const Fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semiBold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  extraBold: "Inter_800ExtraBold",
  black: "Inter_900Black",
} as const;

export type FontKey = keyof typeof Fonts;
