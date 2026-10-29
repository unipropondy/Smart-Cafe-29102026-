/**
 * DisplayState — the canonical customer display state type.
 *
 * This is the single source of truth for the shape of data flowing from
 * CustomerDisplaySync.ts (Web POS) into CustomerDisplayContent.tsx (UI).
 * It is identical whether the display is running on Android (Sunmi) or
 * Windows (Electron via React Native Web).
 */

export interface DisplayItem {
  lineItemId: string;
  name: string;
  qty: number;
  price: number;
  originalPrice: number;
  finalPrice: number;
  discountAmount: number;
  discountPercent: number;
  isVoided: boolean;
  note: string;
  modifiers: Array<{ ModifierName: string }>;
  isServiceCharge?: boolean;
}

export interface DisplayState {
  active: boolean;
  paymentSuccess: boolean;
  orderId?: string;
  tableNo?: string;
  orderType?: 'DINE_IN' | 'TAKEAWAY' | 'MANUAL';
  section?: string;
  items: DisplayItem[];
  grossTotal: number;
  itemDiscounts: number;
  subTotal: number;
  orderDiscountAmount: number;
  gstAmount: number;
  serviceChargeAmount?: number;
  serviceChargePercentage?: number;
  roundOff: number;
  netTotal: number;
  waiterName?: string;
  paid?: number;
  change?: number;
  paymentMethod?: string;
  memberName?: string;
  isSplit?: boolean;
  splitPayments?: Array<{
    payMode: string;
    amount: number;
    status: string;
  }>;
  // Quick Serve Screen Mirroring Fields
  isQuickServe?: boolean;
  quickServeGroups?: Array<{
    id: string | number;
    name: string;
    count?: number;
    isActive?: boolean;
  }>;
  quickServeDishes?: Array<{
    id: string | number;
    name: string;
    price: number;
    image?: string;
    qtyInCart?: number;
    isSoldOut?: boolean;
  }>;
  quickServeCategoryTitle?: string;
  quickServePaymodes?: Array<{
    key: string;
    label: string;
    isSelected?: boolean;
  }>;
}

export const DEFAULT_STATE: DisplayState = {
  active: false,
  paymentSuccess: false,
  items: [],
  grossTotal: 0,
  itemDiscounts: 0,
  subTotal: 0,
  orderDiscountAmount: 0,
  gstAmount: 0,
  roundOff: 0,
  netTotal: 0,
  isSplit: false,
  splitPayments: [],
};
