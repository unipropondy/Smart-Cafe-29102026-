import * as Crypto from "expo-crypto";
import { create } from "zustand";
import { Alert, Platform } from "react-native";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_URL } from "@/constants/Config";
import { useOrderContextStore } from "./orderContextStore";
import { useAuthStore } from "./authStore";
import { socket } from "../constants/socket";


/* ================= TYPES ================= */

export type Modifier = {
  ModifierId: string;
  ModifierName: string;
  Price?: number;
};

export type CartItem = {
  lineItemId: string;
  id: string;
  name: string;
  songName?: string;
  price?: number;
  qty: number;
 
  splitMembers?: {
    CustomerName: string;
    Amount: number;
  }[];

  spicy?: string;
  oil?: string;
  salt?: string;
  sugar?: string;
  note?: string;

  modifiers?: Modifier[];
  discount?: number;        // legacy alias — kept for cart UI compatibility
  discountAmount?: number;  // actual persisted discount value (% or fixed $)
  discountType?: string;    // 'percentage' | 'fixed' | null
  basePrice?: number;
  isTakeaway?: boolean;
  takeawayCharge?: number;
  isVoided?: boolean;
  categoryName?: string; 
  status?: "NEW" | "SENT" | "VOIDED" | "READY" | "SERVED" | "HOLD";
  DateCreated?: string | number;
  KitchenTypeName?: string;
  PrinterIP?: string;
  KitchenTypeCode?: string;
  sent?: number;
  sentDate?: string | number;
  IsOpenItem?: boolean | number | string;
  isServiceCharge?: number | boolean;
  isCombo?: boolean;
  comboSelections?: any[];
  IsDiscountAllowed?: number | boolean;
  isFoc?: boolean;
  Image?: string;
  image?: string;
};

export type DiscountInfo = {
  applied: boolean;
  type: "percentage" | "fixed";
  value: number;
  label?: string;
  discountId?: string;
  discountCode?: string;
};


const getModifierKey = (mods?: any[]) => {
  if (!mods || mods.length === 0) return "";
  // 🚀 OPTIMIZATION: Avoid sorting/joining for single modifiers
  if (mods.length === 1) return String(mods[0].ModifierId || mods[0].ModifierID || "");
  
  return mods
    .map((m) => String(m?.ModifierId || m?.ModifierID || ""))
    .sort()
    .join("|");
};

export const getComboKey = (comboSelections?: any[]) => {
  if (!comboSelections) return "";
  let itemsList: any[] = [];
  if (Array.isArray(comboSelections)) {
    comboSelections.forEach((g: any) => {
      const opts = g.items || g.options || [];
      if (Array.isArray(opts)) {
        opts.forEach((o: any) => {
          itemsList.push(String(o.dishId || o.id || o.name || ""));
        });
      }
    });
  } else if (typeof comboSelections === "object") {
    const groups = (comboSelections as any).groups || [];
    if (Array.isArray(groups)) {
      groups.forEach((g: any) => {
        const opts = g.items || g.options || [];
        if (Array.isArray(opts)) {
          opts.forEach((o: any) => {
            itemsList.push(String(o.dishId || o.id || o.name || ""));
          });
        }
      });
    }
  }
  if (itemsList.length === 0) return "";
  return itemsList.sort().join("|");
};

const isOpenPriceItem = (item?: any) => {
  if (!item) return false;
  return Number(item.IsOpenItem) === 1 || item.IsOpenItem === true || item.IsOpenItem === 'true' || item.IsOpenItem === '1';
};

const getNormalizedText = (...values: any[]) => {
  for (const v of values) {
    if (v !== undefined && v !== null) return String(v);
  }
  return "";
};

const getNormalizedBoolean = (...values: any[]) => {
  for (const v of values) {
    if (v !== undefined && v !== null) return !!v;
  }
  return false;
};

const getNormalizedModifiers = (item: any): Modifier[] => {
  if (Array.isArray(item?.modifiers)) return item.modifiers;
  if (typeof item?.ModifiersJSON === "string") {
    try {
      return JSON.parse(item.ModifiersJSON);
    } catch {
      return [];
    }
  }
  return [];
};

/* ================= HELPERS ================= */

// 🔁 RETRY FETCH: Handles Railway cold-starts (server sleeps after inactivity)
// Retries up to `maxRetries` times with a 15s timeout per attempt.
const fetchWithRetry = async (
  url: string,
  options: RequestInit,
  maxRetries = 3,
  timeoutMs = 30000
): Promise<Response> => {
  let lastErr: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      if (__DEV__) console.log(`[fetchWithRetry] Attempt ${attempt}/${maxRetries}: ${url}`);
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err: any) {
      clearTimeout(timer);
      lastErr = err;
      const isAbort = err?.name === 'AbortError';
      if (__DEV__) console.warn(`[fetchWithRetry] Attempt ${attempt} ${isAbort ? 'TIMED OUT' : 'FAILED'}: ${err?.message}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000 * attempt)); // 2s, 4s back-off
      }
    }
  }
  throw lastErr;
};

// 🚀 HIGH-PERFORMANCE ID GENERATOR: Replaces Crypto.randomUUID() for hot paths
const fastId = () => {
  try {
    return Crypto.randomUUID();
  } catch {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  }
};

const updateCartItemInArray = (items: CartItem[], lineItemId: string, updates: Partial<CartItem>) => {
  return items.map(item => item.lineItemId === lineItemId ? { ...item, ...updates } : item);
};

const normalizeCartItem = (item: any, fallback: Partial<CartItem> = {}): CartItem => {
  // Parse ComboDetailsJSON once — handles both old array format and new { basePrice, groups } format
  let _parsedCombo: { basePrice?: number; groups?: any[] } | any[] | null = null;
  if (typeof item.ComboDetailsJSON === 'string' && item.ComboDetailsJSON) {
    try { _parsedCombo = JSON.parse(item.ComboDetailsJSON); } catch { _parsedCombo = null; }
  } else if (Array.isArray(item.ComboDetailsJSON)) {
    _parsedCombo = item.ComboDetailsJSON;
  }
  // Extract groups array from parsed combo (backward-compatible)
  const _comboGroups: any[] | undefined = _parsedCombo
    ? (Array.isArray(_parsedCombo) ? _parsedCombo : (_parsedCombo as any).groups)
    : undefined;
  // Extract stored basePrice from parsed combo (prevents double-counting on re-sync)
  const _comboBasePrice: number | undefined = (!Array.isArray(_parsedCombo) && _parsedCombo && (_parsedCombo as any).basePrice !== undefined)
    ? Number((_parsedCombo as any).basePrice)
    : undefined;

  // If item.comboSelections was already parsed by backend/other layers and passed as the wrapper object, extract the array
  let incomingComboSelections = item.comboSelections || item.ComboSelections;
  if (incomingComboSelections && !Array.isArray(incomingComboSelections) && typeof incomingComboSelections === 'object') {
    if (Array.isArray((incomingComboSelections as any).groups)) {
      incomingComboSelections = (incomingComboSelections as any).groups;
    }
  }
  const qty = Number(item.qty ?? item.Quantity ?? item.quantity ?? fallback.qty ?? 1);
  const originalPrice = Number(item.price ?? item.Cost ?? item.Price ?? fallback.price ?? 0);
  const note = getNormalizedText(item.note, item.Note, item.notes, item.Notes, item.Remarks, item.remarks, fallback.note);
  const isTakeaway = getNormalizedBoolean(item.isTakeaway, item.IsTakeaway, item.isTakeAway, item.IsTakeAway, fallback.isTakeaway);
  const discount = Number(item.discount ?? item.DiscountAmount ?? item.Discount ?? fallback.discount ?? 0);
  let modifiers = getNormalizedModifiers(item).length ? getNormalizedModifiers(item) : (fallback.modifiers || []);
  
  let splitMembers = item.splitMembers || [];
 
  if (splitMembers.length === 0) {
    const normalMods: any[] = [];
    modifiers.forEach(mod => {
      if (mod.ModifierName && mod.ModifierName.startsWith("[SPLIT] ")) {
        splitMembers.push({
          CustomerName: mod.ModifierName.replace("[SPLIT] ", ""),
          Amount: mod.Price || 0
        });
      } else {
        normalMods.push(mod);
      }
    });
    modifiers = normalMods;
  }

  const isCombo = getNormalizedBoolean(item.isCombo, item.IsCombo, item.ComboDetailsJSON, fallback.isCombo);
  const comboSelections = incomingComboSelections || _comboGroups || fallback.comboSelections || undefined;

  let finalBasePrice = Number(item.basePrice ?? _comboBasePrice ?? fallback.basePrice ?? 0);
  let finalPrice = Number(item.price ?? item.Price ?? item.Cost ?? fallback.price ?? 0);

  if (finalPrice === 0) {
    let surchargeTotal = 0;
    if (isCombo && Array.isArray(comboSelections)) {
      comboSelections.forEach((group: any) => {
        const itemsList = group.items || group.options || [];
        if (Array.isArray(itemsList)) {
          itemsList.forEach((opt: any) => {
            surchargeTotal += Number(opt.surcharge || 0) + Number(opt.dishPrice || 0);
          });
        }
      });
    }

    let modifierTotal = 0;
    if (Array.isArray(modifiers)) {
      modifiers.forEach((m: any) => {
        modifierTotal += Number(m.Price ?? m.price ?? 0);
      });
    }

    finalPrice = finalBasePrice + surchargeTotal + modifierTotal;
  }
 
  // 🚀 PERFORMANCE FIX: Construct cleanly instead of using 'delete' loop
  return {
    lineItemId: String(item.lineItemId || item.ItemId || fallback.lineItemId || fastId()),
    id: String(item.id || item.ProductId || fallback.id || ""),
    name: String(item.name || item.ProductName || item.DishName || fallback.name || "Dish"),
    songName: String(
      item.songName ||
      item.SongName ||
      fallback.songName ||
      ""
    ),
    qty,
    price: finalPrice,
    basePrice: finalBasePrice,
    note,
    isTakeaway,
    takeawayCharge: Number(item.takeawayCharge ?? item.TakeawayCharge ?? fallback.takeawayCharge ?? 0),
    discount,
    modifiers,
    splitMembers,
    spicy: getNormalizedText(item.spicy, item.Spicy, fallback.spicy),
    salt: getNormalizedText(item.salt, item.Salt, fallback.salt),
    oil: getNormalizedText(item.oil, item.Oil, fallback.oil),
    sugar: getNormalizedText(item.sugar, item.Sugar, fallback.sugar),
    isVoided: getNormalizedBoolean(item.isVoided, item.IsVoided, fallback.isVoided),
    status: (item.StatusCode === 0 || item.statusCode === 0) ? "VOIDED" : 
            (item.StatusCode === 3 || item.statusCode === 3) ? "READY" :
            (item.StatusCode === 4 || item.statusCode === 4) ? "SERVED" :
            (item.StatusCode === 5 || item.statusCode === 5) ? "HOLD" :
            (item.StatusCode === 2 || item.statusCode === 2) ? "SENT" :
            (item.status || item.Status || fallback.status || "NEW"),
    DateCreated: item.DateCreated || fallback.DateCreated,
    categoryName: item.categoryName || fallback.categoryName,
    KitchenTypeName: item.KitchenTypeName || fallback.KitchenTypeName,
    PrinterIP: item.PrinterIP || fallback.PrinterIP,
    KitchenTypeCode: item.KitchenTypeCode || fallback.KitchenTypeCode,
    IsOpenItem: item.IsOpenItem !== undefined ? item.IsOpenItem : fallback.IsOpenItem,
    isServiceCharge: (item.isServiceCharge !== undefined || (item as any).IsServiceCharge !== undefined)
      ? (Number(item.isServiceCharge ?? (item as any).IsServiceCharge) === 1 || (item.isServiceCharge ?? (item as any).IsServiceCharge) === true ? 1 : 0)
      : (fallback.isServiceCharge !== undefined || (fallback as any).IsServiceCharge !== undefined)
        ? (Number(fallback.isServiceCharge ?? (fallback as any).IsServiceCharge) === 1 || (fallback.isServiceCharge ?? (fallback as any).IsServiceCharge) === true ? 1 : 0)
        : 1,
    isCombo: getNormalizedBoolean(item.isCombo, item.IsCombo, item.ComboDetailsJSON, fallback.isCombo),
    comboSelections: incomingComboSelections || _comboGroups || fallback.comboSelections || undefined,
    IsDiscountAllowed: item.IsDiscountAllowed !== undefined ? item.IsDiscountAllowed : (fallback.IsDiscountAllowed !== undefined ? fallback.IsDiscountAllowed : 1),
    discountAmount: Number(item.discount ?? item.discountAmount ?? item.DiscountAmount ?? fallback.discountAmount ?? discount),
    discountType: item.discountType || item.DiscountType || fallback.discountType || "percentage",
    isFoc: getNormalizedBoolean(item.isFoc, item.IsFoc, fallback.isFoc),
    Image: item.Image || item.image || item.DishImage || fallback.Image || fallback.image,
    image: item.Image || item.image || item.DishImage || fallback.Image || fallback.image,
  };
};

const canMergeCartItems = (left: CartItem, right: CartItem) => {
  if (left.id !== right.id) return false;
  if (isOpenPriceItem(left) || isOpenPriceItem(right)) {
    if (left.price !== right.price) return false;
  }
  if (left.isCombo || right.isCombo) {
    // Never merge combo items unless they are identical, or simply never merge to keep orders clean
    if (left.isCombo !== right.isCombo) return false;
    if (JSON.stringify(left.comboSelections) !== JSON.stringify(right.comboSelections)) return false;
  }
  if ((left.discountAmount || 0) !== (right.discountAmount || 0)) return false;
  if ((left.discountType || "") !== (right.discountType || "")) return false;
  return (
    (left.status || "NEW") === "NEW" &&
    (right.status || "NEW") === "NEW" &&
    !!left.isTakeaway === !!right.isTakeaway &&
    !!left.isFoc === !!right.isFoc &&
    (left.note || "") === (right.note || "") &&
    (left.spicy || "") === (right.spicy || "") &&
    (left.salt || "") === (right.salt || "") &&
    (left.oil || "") === (right.oil || "") &&
    (left.sugar || "") === (right.sugar || "") &&
    getModifierKey(left.modifiers) === getModifierKey(right.modifiers)
  );
};

const mergeCartItems = (items: CartItem[]) => {
  const merged: CartItem[] = [];
  items.forEach((rawItem) => {
    const item = normalizeCartItem(rawItem);
    const existingIndex = merged.findIndex((candidate) => canMergeCartItems(candidate, item));
    if (existingIndex > -1) {
      merged[existingIndex] = { ...merged[existingIndex], qty: merged[existingIndex].qty + item.qty };
    } else {
      merged.push({ ...item });
    }
  });
  return merged;
};

type CartState = {
  carts: Record<string, CartItem[]>;
  discounts: Record<string, DiscountInfo>;
  tableOrderIds: Record<string, string | null>;
  tablePaymentStatus: Record<string, { isPaid: boolean; paymentStatus: string }>;
  orderCustomers: Record<string, { customerId?: string; customerName?: string; mobileNo?: string }>;

  currentContextId: string | null;
  pendingSync: boolean;
  lastLocalUpdate: Record<string, number>; // 🛡️ SYNC SHIELD: Per-context timestamps
  lastServerSync: Record<string, number>; // 🛡️ SYNC SHIELD: Per-context last success
  deletedItemsShield: Record<string, number>; // 🛡️ DELETION SHIELD: lineItemId -> expiry timestamp
  operationVersion: Record<string, number>; // 🛡️ VERSION SHIELD: Per-context operation counter
  isClearing: Record<string, boolean>; // 🛡️ CLEAR LOCK: Block fetches during clear
  deletingItems: Set<string>; // 🛡️ DELETE LOCK: Block interactions for specific lineItemIds
  cartQtyMap: Record<string, Record<string, number>>; // 🚀 PERFORMANCE: contextId -> dishId -> totalQty
  activeSplitItems: any[] | null;
  setActiveSplitItems: (items: any[] | null) => void;
  splitPartsCount: number | null;
  setSplitPartsCount: (count: number | null) => void;

  setCurrentContext: (contextId: string | null) => void;

  getCart: () => CartItem[];

  addToCartGlobal: (item: Omit<CartItem, "qty" | "lineItemId">) => Promise<string>;
  removeFromCartGlobal: (lineItemId: string) => Promise<void>;
  clearCart: () => Promise<void>;
  clearAllCarts: () => void;

  applyDiscount: (discount: DiscountInfo) => void;
  clearDiscount: () => void;

  setCartItemsGlobal: (items: CartItem[]) => void;
  setCartItems: (contextId: string, items: CartItem[], skipSync?: boolean, source?: string) => void;
  updateCartItemQty: (
    lineItemId: string,
    newQty: number,
    discount?: number,
  ) => void;
  updateCartItemModifiers: (lineItemId: string, modifiers: Modifier[]) => void;
  updateCartItemTakeaway: (lineItemId: string, isTakeaway: boolean) => void;
  updateCartItemDiscount: (lineItemId: string, discount: number) => void;
  voidCartItem: (lineItemId: string) => void;
  updateCartItemFull: (
    lineItemId: string,
    updates: {
      qty?: number;
      note?: string;
      spicy?: string;
      salt?: string;
      oil?: string;
      sugar?: string;
      discount?: number;
      discountAmount?: number;
      discountType?: string;
      isVoided?: boolean;
      isTakeaway?: boolean;
      isFoc?: boolean;
    },
  ) => void;
  applyBulkItemDiscount: (value: number, type: "percentage" | "fixed") => void;

  syncCartWithDB: (contextId: string, isImmediate?: boolean) => Promise<void>;
  fetchCartFromDB: (tableId: string, force?: boolean) => Promise<void>;
  setTableOrderId: (tableId: string, orderId: string | null) => void;
  checkoutOrder: (tableId: string) => Promise<{ success: boolean; orderId?: string }>;
  completeOrder: (tableId: string) => Promise<{ success: boolean }>;
  markAllAsSent: (skipSync?: boolean) => void;
  combineDuplicates: () => void;
  clearTableSession: (tableId: string, section?: string, tableNo?: string) => void;
  cancelPendingSync: () => void;

  // 🛡️ Implementation Details (Internal use)
  _syncTimeout?: any;
  _fetchTimeout?: any;
  _syncAbortControllers: Record<string, AbortController>;
};

/* ================= STORE ================= */

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      carts: {},
      discounts: {},
      tableOrderIds: {},
      tablePaymentStatus: {},
      orderCustomers: {},
      currentContextId: null,
      pendingSync: false,
      lastLocalUpdate: {},
      lastServerSync: {},
      deletedItemsShield: {},
      operationVersion: {},
      isClearing: {},
      deletingItems: new Set(),
      cartQtyMap: {},
      _syncAbortControllers: {},
      activeSplitItems: null,
      splitPartsCount: null,
 
      setCurrentContext: (contextId) => set({ 
        currentContextId: contextId,
        activeSplitItems: null,
        splitPartsCount: null
      }),
      setActiveSplitItems: (items) => set({ activeSplitItems: items }),
      setSplitPartsCount: (count) => set({ splitPartsCount: count }),

      getCart: () => {
        const { carts, currentContextId } = get();
        if (!currentContextId) return [];
        return carts[currentContextId] || [];
      },

      /* ================= DISCOUNT ================= */

      setCartItemsGlobal: (items: CartItem[]) => {
        const { currentContextId } = get();
        if (!currentContextId) return;
        
        if (__DEV__) console.log(`[TRACE] [${Date.now()}] [SOCKET_QUANTITY_SYNC] Received ${items.length} items for Context: ${currentContextId}`);

        // Update qty map
        const newQtyMap: Record<string, number> = {};
        items.forEach(item => {
          newQtyMap[item.id] = (newQtyMap[item.id] || 0) + item.qty;
        });

        set((state) => ({
          carts: { ...state.carts, [currentContextId]: items },
          cartQtyMap: { ...state.cartQtyMap, [currentContextId]: newQtyMap },
          lastLocalUpdate: { ...state.lastLocalUpdate, [currentContextId]: Date.now() }
        }));
      },

      applyDiscount: (discount: DiscountInfo) => {
        const { currentContextId } = get();
        if (!currentContextId) return;

        set((state) => ({
          discounts: {
            ...state.discounts,
            [currentContextId]: discount,
          },
          lastLocalUpdate: { ...state.lastLocalUpdate, [currentContextId]: Date.now() }
        }));
      },

      clearDiscount: () => {
        const { currentContextId } = get();
        if (!currentContextId) return;

        set((state) => {
          const updated = { ...state.discounts };
          delete updated[currentContextId];
          return { 
            discounts: updated, 
            lastLocalUpdate: { ...state.lastLocalUpdate, [currentContextId]: Date.now() } 
          };
        });
      },

      /* ================= ADD ================= */

      addToCartGlobal: async (item) => {
        const { fetchCartFromDB, carts } = get();
        const orderContext = useOrderContextStore.getState().currentOrder;
        const tableId = orderContext?.tableId;
        
        if (!tableId) return "";

        let currentContextId = get().currentContextId;
        if (!currentContextId && orderContext) {
          currentContextId = getContextId(orderContext);
          if (currentContextId) {
            set({ currentContextId });
          }
        }

        if (!currentContextId) return "";

        const isTakeawayDefault = orderContext?.orderType === "TAKEAWAY";
        const targetLineItemId = fastId();
        
        // 🚀 OPTIMIZATION: Normalize ONCE
        const normalizedIncoming = normalizeCartItem(item, {
          lineItemId: targetLineItemId,
          qty: 1,
          status: "NEW",
          isTakeaway: item.isTakeaway !== undefined ? item.isTakeaway : isTakeawayDefault,
        });

        // 🚀 OPTIMIZATION: Compute key ONCE outside the loop
        const newItemModKey = getModifierKey(normalizedIncoming.modifiers);

        const newVersion = (get().operationVersion[currentContextId!] || 0) + 1;
        const now = Date.now();
        // 🚀 OPTIMISTIC UPDATE: Update local state immediately (Merged into one set call)
        if (currentContextId) {
          const currentCart = carts[currentContextId] || [];
          let updatedCart: CartItem[];
          let finalLineItemId = targetLineItemId;

          const existingIndex = currentCart.findIndex(p => {
            if (p.id !== normalizedIncoming.id || 
                p.songName !== normalizedIncoming.songName ||
                p.status !== "NEW" || 
                p.isTakeaway !== normalizedIncoming.isTakeaway || 
                (p.discountAmount || 0) !== (normalizedIncoming.discountAmount || 0) ||
                (p.discountType || "") !== (normalizedIncoming.discountType || "") ||
                (p.note || "") !== (normalizedIncoming.note || "") ||
                (p.spicy || "") !== (normalizedIncoming.spicy || "") ||
                (p.salt || "") !== (normalizedIncoming.salt || "") ||
                (p.oil || "") !== (normalizedIncoming.oil || "") ||
                (p.sugar || "") !== (normalizedIncoming.sugar || "")) return false;
            
            const pSplitStr = JSON.stringify(p.splitMembers || []);
            const newSplitStr = JSON.stringify(normalizedIncoming.splitMembers || []);
            if (pSplitStr !== newSplitStr) return false;

            if (isOpenPriceItem(p) || isOpenPriceItem(normalizedIncoming)) {
              if (p.price !== normalizedIncoming.price) return false;
            }

            if (p.isCombo || normalizedIncoming.isCombo) {
              if (p.isCombo !== normalizedIncoming.isCombo) return false;
              if (getComboKey(p.comboSelections) !== getComboKey(normalizedIncoming.comboSelections)) return false;
            }

            return getModifierKey(p.modifiers) === newItemModKey;
          });

          if (existingIndex > -1) {
            updatedCart = [...currentCart];
            const newQty = (updatedCart[existingIndex].qty || 0) + 1;
            updatedCart[existingIndex] = { 
              ...updatedCart[existingIndex], 
              qty: newQty,
              songName:
                normalizedIncoming.songName ||
                updatedCart[existingIndex].songName
            };
            finalLineItemId = updatedCart[existingIndex].lineItemId;
          } else {
            const latestTimestamp = currentCart.reduce((max, i) => {
              const t = i.DateCreated ? new Date(i.DateCreated).getTime() : 0;
              return t > max ? t : max;
            }, 0);
            
            // 🚀 SOLID ID: Use valid UUID format for SQL compatibility
            const generateUUID = () => {
              return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                return v.toString(16);
              });
            };

            const newItem: CartItem = {
              ...normalizedIncoming,
              songName: normalizedIncoming.songName,
              lineItemId: generateUUID(),
              DateCreated: Math.max(now, latestTimestamp + 1)
            };
            finalLineItemId = newItem.lineItemId;
            updatedCart = [...currentCart, newItem];
          }

          set((state) => {
            const newQtyMap = { ...(state.cartQtyMap[currentContextId] || {}) };
            newQtyMap[normalizedIncoming.id] = (newQtyMap[normalizedIncoming.id] || 0) + 1;

            return { 
              operationVersion: { ...state.operationVersion, [currentContextId]: newVersion },
              carts: { 
                ...state.carts, 
                [currentContextId]: updatedCart 
              }, 
              cartQtyMap: {
                ...state.cartQtyMap,
                [currentContextId]: newQtyMap
              },
              lastLocalUpdate: { ...state.lastLocalUpdate, [currentContextId]: now } 
            };
          });

          // 🚀 INSTANT SYNC: Tell other tablets immediately (Socket-First)
          socket.emit("cart_change", { 
            tableId, 
            contextId: currentContextId, 
            items: updatedCart, 
            lastUpdate: Date.now() 
          });

          // 🚀 DB SYNC: If it's a brand new table, sync faster to get the real Order ID
          const currentOrderId = get().tableOrderIds[tableId];
          const isNewTable = !currentOrderId || currentOrderId === "NEW";
          
          if (isNewTable) {
             // Non-debounced sync for first item to get ID fast
             get().syncCartWithDB(currentContextId, true);
          } else {
             // Normal 5s debounced sync for subsequent items
             get().syncCartWithDB(currentContextId);
          }
          
          return finalLineItemId;
        }

        return targetLineItemId;
      },

      markAllAsSent: (skipSync?: boolean) => {
        const { currentContextId, carts } = get();
        if (!currentContextId || !carts[currentContextId]) return;
        
        const updatedCart = carts[currentContextId].map(item => ({
          ...item,
          sent: 1,
          status: "SENT" as const
        }));

        set((state) => {
          const newQtyMap: Record<string, number> = {};
          updatedCart.forEach(item => {
            newQtyMap[item.id] = (newQtyMap[item.id] || 0) + item.qty;
          });

          return { 
            carts: { 
              ...state.carts, 
              [currentContextId]: updatedCart 
            }, 
            cartQtyMap: { ...state.cartQtyMap, [currentContextId]: newQtyMap },
            lastLocalUpdate: { ...state.lastLocalUpdate, [currentContextId]: Date.now() } 
          };
        });
        
        // 🚀 IMMEDIATE SYNC: Don't wait for debounce when sending to kitchen
        if (!skipSync) {
          const tableId = useOrderContextStore.getState().currentOrder?.tableId;
          if (tableId) {
            get().syncCartWithDB(currentContextId);
          }
        }
      },

      combineDuplicates: () => {
        const { currentContextId, carts } = get();
        if (!currentContextId || !carts[currentContextId]) return;

        set((state) => {
          const updatedItems = mergeCartItems(state.carts[currentContextId]);
          const newQtyMap: Record<string, number> = {};
          updatedItems.forEach(item => {
            newQtyMap[item.id] = (newQtyMap[item.id] || 0) + item.qty;
          });

          return {
            carts: {
              ...state.carts,
              [currentContextId]: updatedItems
            },
            cartQtyMap: { ...state.cartQtyMap, [currentContextId]: newQtyMap },
            lastLocalUpdate: { ...state.lastLocalUpdate, [currentContextId]: Date.now() }
          };
        });

        get().syncCartWithDB(currentContextId);
      },

      /* ================= REMOVE ================= */

      removeFromCartGlobal: async (lineItemId) => {
        const { fetchCartFromDB, currentContextId, _syncTimeout, _syncAbortControllers } = get();
        const orderContext = useOrderContextStore.getState().currentOrder;
        const tableId = orderContext?.tableId;
        
        if (!tableId || !currentContextId) return;
        if (get().deletingItems.has(lineItemId)) return; // 🛡️ Double-click protection

        const newVersion = (get().operationVersion[currentContextId] || 0) + 1;
        const now = Date.now();
        if (__DEV__) console.log(`[TRACE] [${now}] [${currentContextId}] DELETE_START | ID: ${lineItemId} | Version: ${newVersion}`);

        // 🛡️ LOCK & SHIELD
        set((state) => {
          const nextDeleting = new Set(state.deletingItems);
          nextDeleting.add(lineItemId);
          return {
            deletingItems: nextDeleting,
            deletedItemsShield: { ...state.deletedItemsShield, [lineItemId]: now + 120000 }, // 2 minute shield
            operationVersion: { ...state.operationVersion, [currentContextId]: newVersion },
            lastLocalUpdate: { ...state.lastLocalUpdate, [currentContextId]: now }
          };
        });

        // 🛑 STOP PENDING SAVES
        if (_syncTimeout) clearTimeout(_syncTimeout);
        if (_syncAbortControllers[currentContextId]) _syncAbortControllers[currentContextId].abort();

        // 🚀 OPTIMISTIC UPDATE: Remove instantly from UI
        const previousCart = get().carts[currentContextId] || [];
        set((state) => {
          const updatedCart = previousCart.filter(p => p.lineItemId !== lineItemId);
          
          const newQtyMap: Record<string, number> = {};
          updatedCart.forEach(item => {
            newQtyMap[item.id] = (newQtyMap[item.id] || 0) + item.qty;
          });

          return { 
            carts: { ...state.carts, [currentContextId]: updatedCart },
            cartQtyMap: { ...state.cartQtyMap, [currentContextId]: newQtyMap }
          };
        });

        try {
          socket.emit("cart_change", { 
            tableId, contextId: currentContextId, 
            items: (get().carts[currentContextId] || []), 
            lastUpdate: now,
            version: newVersion
          });

          const token = useAuthStore.getState().token;
          const res = await fetch(`${API_URL}/api/orders/remove-item`, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              ...(token ? { "Authorization": `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ 
              tableId, 
              itemId: lineItemId, 
              version: newVersion,
              userId: useAuthStore.getState().user?.userId 
            })
          });

          if (!res.ok) throw new Error("Delete failed on server");

          if (__DEV__) console.log(`[TRACE] [${Date.now()}] [${currentContextId}] DELETE_DB_SUCCESS | ID: ${lineItemId}`);
          
          set((state) => {
            const nextDeleting = new Set(state.deletingItems);
            nextDeleting.delete(lineItemId);
            return { deletingItems: nextDeleting };
          });
          
          // Emit socket sync for others
          socket.emit("cart_updated", { tableId: tableId.toLowerCase() });
          
        } catch (err) {
          console.error("❌ [CartStore] DELETE_FAILED:", err);
          // 🔄 ROLLBACK
          set((state) => {
            const nextDeleting = new Set(state.deletingItems);
            nextDeleting.delete(lineItemId);
            const newQtyMap: Record<string, number> = {};
            previousCart.forEach(item => {
              newQtyMap[item.id] = (newQtyMap[item.id] || 0) + item.qty;
            });
            return { 
              carts: { ...state.carts, [currentContextId]: previousCart },
              cartQtyMap: { ...state.cartQtyMap, [currentContextId]: newQtyMap },
              deletingItems: nextDeleting
            };
          });
          if ((err as any).name !== 'AbortError') await fetchCartFromDB(tableId);
        }
      },

      /* ================= CLEAR ================= */

      clearCart: async () => {
        const { fetchCartFromDB, currentContextId, _syncTimeout, _syncAbortControllers } = get();
        const orderContext = useOrderContextStore.getState().currentOrder;
        const tableId = orderContext?.tableId;
        
        if (!tableId || !currentContextId) return;

        const newVersion = (get().operationVersion[currentContextId] || 0) + 1;
        const now = Date.now();
        if (__DEV__) console.log(`[TRACE] [${now}] [${currentContextId}] Mutate: CLEAR_CART | START | NewVersion: ${newVersion}`);

        // 🛡️ LOCK & SHIELD
        set((state) => ({
          isClearing: { ...state.isClearing, [currentContextId]: true },
          operationVersion: { ...state.operationVersion, [currentContextId]: newVersion },
          lastLocalUpdate: { ...state.lastLocalUpdate, [currentContextId]: now + 10000 } // 10s hard shield
        }));

        // 🛑 STOP EVERYTHING
        if (_syncTimeout) clearTimeout(_syncTimeout);
        if (_syncAbortControllers[currentContextId]) _syncAbortControllers[currentContextId].abort();

        const currentCart = (get().carts[currentContextId] || []).filter(i => !!i);
        const sentItems = currentCart.filter(i => isItemSent(i));
        const unsentItems = currentCart.filter(i => !isItemSent(i));

        // 🛡️ SHIELD UNSENT PERMANENTLY (for this session)
        const newShield = { ...get().deletedItemsShield };
        unsentItems.forEach(it => {
          if (it.lineItemId) newShield[it.lineItemId] = now + 120000; // 2 minute shield
        });

        // 🚀 IMMEDIATE UPDATE
        set((state) => {
          const newQtyMap: Record<string, number> = {};
          sentItems.forEach(item => {
            newQtyMap[item.id] = (newQtyMap[item.id] || 0) + item.qty;
          });

          return { 
            carts: { ...state.carts, [currentContextId]: sentItems }, 
            cartQtyMap: { ...state.cartQtyMap, [currentContextId]: newQtyMap },
            deletedItemsShield: newShield,
          };
        });

        try {
          socket.emit("cart_change", { 
            tableId, contextId: currentContextId, 
            items: sentItems, 
            lastUpdate: now + 10000,
            version: newVersion
          });

          const token = useAuthStore.getState().token;
          const res = await fetchWithRetry(`${API_URL}/api/orders/save-cart`, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              ...(token ? { "Authorization": `Bearer ${token}` } : {})
            },
            body: JSON.stringify({
              tableId,
              orderId: get().tableOrderIds[tableId],
              lastUpdate: now + 10000,
              version: newVersion,
              items: sentItems
            })
          });

          // Wait for DB to settle
          if (__DEV__) console.log(`[TRACE] [${Date.now()}] [${currentContextId}] Mutate: CLEAR_CART | DB request finished. Waiting 5s before unlocking...`);
          setTimeout(async () => {
            if (__DEV__) console.log(`[TRACE] [${Date.now()}] [${currentContextId}] Mutate: CLEAR_CART | UNLOCKING & FETCHING`);
            set((state) => ({ isClearing: { ...state.isClearing, [currentContextId]: false } }));
            await fetchCartFromDB(tableId);
          }, 5000);
        } catch (err: any) {
          set((state) => ({ isClearing: { ...state.isClearing, [currentContextId]: false } }));
          if (err?.name !== 'AbortError') {
            console.error(`❌ [CartStore] Clear failed (all retries exhausted):`, err);
          }
        }
      },

      clearAllCarts: () =>
        set({ carts: {}, discounts: {}, tableOrderIds: {}, currentContextId: null, lastLocalUpdate: {}, lastServerSync: {} }),

      clearTableSession: (tableId, section, tableNo) => {
        set((state) => {
          const newCarts = { ...state.carts };
          const newDiscounts = { ...state.discounts };
          const newTableOrderIds = { ...state.tableOrderIds };
          const newLastLocalUpdate = { ...state.lastLocalUpdate };
          const newLastServerSync = { ...state.lastServerSync };

          // 🚀 Clean up tableOrderIds
          if (tableId) delete newTableOrderIds[tableId];
          if (tableNo) delete newTableOrderIds[tableNo];

          const cleanTargetId = String(tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
          const { useTableStatusStore } = require("./tableStatusStore");
          const tables = useTableStatusStore.getState().tables || [];
          const targetTable = tables.find((t: any) => {
            const tId = String(t.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
            return (cleanTargetId && tId === cleanTargetId) || (tableNo && String(t.tableNo) === String(tableNo)) || (String(t.tableNo) === String(tableId));
          });

          const effSection = section || targetTable?.section;
          const effTableNo = tableNo || targetTable?.tableNo || (tableId && tableId.length < 10 ? tableId : undefined);

          const matchContextSuffixes: string[] = [];
          if (effTableNo) {
            matchContextSuffixes.push(`_${effTableNo}`);
            if (effSection) {
              matchContextSuffixes.push(`_${effSection}_${effTableNo}`);
              const altSec = effSection.replace(/^SECTION_/i, "");
              matchContextSuffixes.push(`_${altSec}_${effTableNo}`);
              matchContextSuffixes.push(`_SECTION_${altSec}_${effTableNo}`);
            }
          }

          const matchKey = (ctx: string) => {
            const matchesId = cleanTargetId && cleanTargetId.length > 5 ? ctx.toLowerCase().includes(cleanTargetId) : false;
            const matchesSuffix = matchContextSuffixes.some(suffix => ctx.endsWith(suffix));
            return matchesId || matchesSuffix;
          };

          const now = Date.now();
          Object.keys(newCarts).forEach(ctx => {
            if (matchKey(ctx)) {
              delete newCarts[ctx];
              newLastLocalUpdate[ctx] = now;
            }
          });
          Object.keys(newDiscounts).forEach(ctx => { if (matchKey(ctx)) delete newDiscounts[ctx]; });
          Object.keys(newLastServerSync).forEach(ctx => { if (matchKey(ctx)) delete newLastServerSync[ctx]; });

          if (__DEV__) console.log(`🧹 [CartStore] Table session cleared: tableId=${tableId}, section=${effSection}, tableNo=${effTableNo}`);

          return {
            carts: newCarts,
            discounts: newDiscounts,
            tableOrderIds: newTableOrderIds,
            lastLocalUpdate: newLastLocalUpdate,
            lastServerSync: newLastServerSync,
            activeSplitItems: null,
            splitPartsCount: null,
          };
        });
      },

      /* ================= SET ================= */

      setCartItems: (contextId, items, skipSync = false, source = "INTERNAL") => {
        const now = Date.now();
        const state = get();
        const currentVersion = state.operationVersion[contextId] || 0;
        
        // 🛡️ CLEAR LOCK: Reject updates during a manual clear
        if (state.isClearing[contextId]) {
          if (__DEV__) console.log(`🛡️ [TRACE] [${now}] [${contextId}] setCartItems: BLOCKED (Clear Lock active) | SOURCE: ${source}`);
          return;
        }

        if (__DEV__) console.log(`[TRACE] [${now}] [${contextId}] setCartItems: SOURCE: ${source} | Items: ${items.length} | CurrentVersion: ${currentVersion}`);

        // 🛡️ DELETION SHIELD FILTER: Ensure no ghost items slip through any setCartItems call
        const { deletedItemsShield } = get();
        const filteredItems = items.filter(item => {
          const shieldExpiry = deletedItemsShield[item.lineItemId];
          if (shieldExpiry && now < shieldExpiry) {
            if (__DEV__) console.log(`🛡️ [TRACE] [${now}] [${contextId}] BLOCKED GHOST RESTORE: ${item.name} (${item.lineItemId}) from ${source}`);
            return false;
          }
          return true;
        });

        set((state) => {
          const updatedItems = mergeCartItems(filteredItems.map((item) => normalizeCartItem(item)));
          const newQtyMap: Record<string, number> = {};
          updatedItems.forEach(item => {
            newQtyMap[item.id] = (newQtyMap[item.id] || 0) + item.qty;
          });

          return {
            carts: { ...state.carts, [contextId]: updatedItems },
            cartQtyMap: { ...state.cartQtyMap, [contextId]: newQtyMap },
            lastLocalUpdate: { ...state.lastLocalUpdate, [contextId]: Date.now() }
          };
        });

        if (!skipSync) {
          get().syncCartWithDB(contextId);
        }
      },

      updateCartItemQty: (lineItemId, newQty, discount) => {
        const { currentContextId } = get();
        if (!currentContextId) return;

        const currentCart = get().carts[currentContextId] || [];
        const item = currentCart.find(i => i.lineItemId === lineItemId);
        if (item && __DEV__) {
          const type = newQty < item.qty ? "DECREMENT" : "INCREMENT";
          console.log(`[TRACE] [${Date.now()}] [QUANTITY_${type}] Product: ${item.name} | NewQty: ${newQty}`);
        }

        set((state) => {
          const updatedCart = updateCartItemInArray(state.carts[currentContextId] || [], lineItemId, {
            qty: Math.max(0, newQty),
            discount: discount !== undefined ? discount : undefined
          }).filter(i => i.qty > 0);

          const newQtyMap: Record<string, number> = {};
          updatedCart.forEach(item => {
            newQtyMap[item.id] = (newQtyMap[item.id] || 0) + item.qty;
          });

          return {
            carts: { 
              ...state.carts, 
              [currentContextId]: updatedCart
            },
            cartQtyMap: { ...state.cartQtyMap, [currentContextId]: newQtyMap },
            lastLocalUpdate: { ...state.lastLocalUpdate, [currentContextId]: Date.now() }
          };
        });

        const tableId = useOrderContextStore.getState().currentOrder?.tableId;
        if (tableId) {
          socket.emit("cart_change", {
            tableId,
            contextId: currentContextId,
            items: get().carts[currentContextId] || [],
            lastUpdate: Date.now()
          });
        }

        get().syncCartWithDB(currentContextId);
      },

      updateCartItemModifiers: (lineItemId, modifiers) => {
        const { currentContextId } = get();
        if (!currentContextId) return;

        set((state) => {
          const currentCart = state.carts[currentContextId] || [];
          const sourceItem = currentCart.find((i) => i.lineItemId === lineItemId);
          if (!sourceItem) return state;

          const base = sourceItem.basePrice || sourceItem.price || 0;
          const extra = modifiers.reduce((sum, m) => sum + (m.Price || 0), 0);
          const newPrice = base + extra;

          return {
            carts: {
              ...state.carts,
              [currentContextId]: updateCartItemInArray(currentCart, lineItemId, {
                modifiers,
                price: newPrice
              })
            },
            lastLocalUpdate: { ...state.lastLocalUpdate, [currentContextId]: Date.now() }
          };
        });

        const tableId = useOrderContextStore.getState().currentOrder?.tableId;
        if (tableId) {
          socket.emit("cart_change", {
            tableId,
            contextId: currentContextId,
            items: get().carts[currentContextId] || [],
            lastUpdate: Date.now()
          });
        }

        get().syncCartWithDB(currentContextId);
      },

      updateCartItemTakeaway: (lineItemId, isTakeaway) => {
        const { currentContextId } = get();
        if (!currentContextId) return;

        set((state) => ({
          carts: {
            ...state.carts,
            [currentContextId]: updateCartItemInArray(state.carts[currentContextId] || [], lineItemId, { isTakeaway }),
          },
          lastLocalUpdate: { ...state.lastLocalUpdate, [currentContextId]: Date.now() }
        }));

        const tableId = useOrderContextStore.getState().currentOrder?.tableId;
        if (tableId) {
          socket.emit("cart_change", {
            tableId,
            contextId: currentContextId,
            items: get().carts[currentContextId] || [],
            lastUpdate: Date.now()
          });
        }

        get().syncCartWithDB(currentContextId);
      },

      updateCartItemDiscount: (lineItemId, discount) => {
        const { currentContextId } = get();
        if (!currentContextId) return;

        set((state) => ({
          carts: {
            ...state.carts,
            [currentContextId]: updateCartItemInArray(state.carts[currentContextId] || [], lineItemId, { discount }),
          },
          lastLocalUpdate: { ...state.lastLocalUpdate, [currentContextId]: Date.now() }
        }));

        const tableId = useOrderContextStore.getState().currentOrder?.tableId;
        if (tableId) {
          socket.emit("cart_change", {
            tableId,
            contextId: currentContextId,
            items: get().carts[currentContextId] || [],
            lastUpdate: Date.now()
          });
        }

        get().syncCartWithDB(currentContextId);
      },

      voidCartItem: (lineItemId: string) => {
        const { currentContextId } = get();
        if (!currentContextId) return;

        set((state) => ({
          carts: {
            ...state.carts,
            [currentContextId]: updateCartItemInArray(state.carts[currentContextId] || [], lineItemId, { 
              status: "VOIDED",
              isVoided: true
            }),
          },
          lastLocalUpdate: { ...state.lastLocalUpdate, [currentContextId]: Date.now() }
        }));
      },

      updateCartItemFull: (lineItemId, updates) => {
        const { currentContextId } = get();
        if (!currentContextId) return;

        set((state) => {
          const updatedCart = updateCartItemInArray(state.carts[currentContextId] || [], lineItemId, updates);
          
          // 🚀 SURGICAL: Recompute only if qty changed
          const newQtyMap = { ...(state.cartQtyMap[currentContextId] || {}) };
          if (updates.qty !== undefined) {
             // Reset qty map for this context and recompute
             // (More robust than partial updates for nested items)
             const tempMap: Record<string, number> = {};
             updatedCart.forEach(i => {
                tempMap[i.id] = (tempMap[i.id] || 0) + (i.qty || 0);
             });
             return {
                carts: { ...state.carts, [currentContextId]: updatedCart },
                cartQtyMap: { ...state.cartQtyMap, [currentContextId]: tempMap },
                lastLocalUpdate: { ...state.lastLocalUpdate, [currentContextId]: Date.now() }
             };
          }

          return {
            carts: { ...state.carts, [currentContextId]: updatedCart },
            lastLocalUpdate: { ...state.lastLocalUpdate, [currentContextId]: Date.now() }
          };
        });
        
        const tableId = useOrderContextStore.getState().currentOrder?.tableId;
        if (tableId) {
          socket.emit("cart_change", { 
            tableId, 
            contextId: currentContextId, 
            items: get().carts[currentContextId], 
            lastUpdate: Date.now() 
          });
        }

        get().syncCartWithDB(currentContextId, true);
      },

      applyBulkItemDiscount: (value, type) => {
        const { currentContextId } = get();
        if (!currentContextId) return;

        set((state) => {
          const currentCart = state.carts[currentContextId] || [];
          const updatedCart = currentCart.map((item) => {
            const isAllowed = item.IsDiscountAllowed === true || item.IsDiscountAllowed === 1 || Number(item.IsDiscountAllowed) === 1;
            if (isAllowed) {
              return {
                ...item,
                discount: value,
                discountAmount: value,
                discountType: type,
              };
            }
            return item;
          });

          return {
            carts: { ...state.carts, [currentContextId]: updatedCart },
            lastLocalUpdate: { ...state.lastLocalUpdate, [currentContextId]: Date.now() }
          };
        });

        const tableId = useOrderContextStore.getState().currentOrder?.tableId;
        if (tableId) {
          socket.emit("cart_change", { 
            tableId, 
            contextId: currentContextId, 
            items: get().carts[currentContextId], 
            lastUpdate: Date.now() 
          });
        }

        get().syncCartWithDB(currentContextId, true);
      },

      syncCartWithDB: async (contextId, isImmediate = false) => {
        const orderContext = useOrderContextStore.getState().currentOrder;
        const tableId = orderContext?.tableId;
        if (!tableId) return;

        const { _syncTimeout, _syncAbortControllers } = get();

        // 🚀 ATOMIC DEBOUNCE: Clear existing timeout
        if (_syncTimeout) {
          clearTimeout(_syncTimeout);
        }

        // 🛑 ABORT PREVIOUS IN-FLIGHT: If we're already saving for this context, stop it
        if (_syncAbortControllers[contextId]) {
          if (__DEV__) console.log(`🛑 [CartStore] ABORTING stale save request for ${contextId}`);
          _syncAbortControllers[contextId].abort();
        }
        
        const timeout = setTimeout(async () => {
          const currentState = get();
          const lastLocal = currentState.lastLocalUpdate[contextId] || 0;
          const lastSync = currentState.lastServerSync[contextId] || 0;

          if (lastLocal > 0 && lastSync >= lastLocal) {
            if (__DEV__) console.log(`🛡️ [CartStore] Skipping redundant save-cart sync for ${contextId}. Local: ${lastLocal}, Sync: ${lastSync}`);
            set({ pendingSync: false, _syncTimeout: null });
            return;
          }

          const syncStartTime = Date.now();
          set({ pendingSync: true });

          // 🆕 Create new controller for this request
          const controller = new AbortController();
          set(state => ({
            _syncAbortControllers: { ...state._syncAbortControllers, [contextId]: controller }
          }));

          if (__DEV__) console.log(`💾 [CartStore] SYNC START for ${contextId}...`);

          try {
            const items = currentState.carts[contextId] || [];
            const orderId = currentState.tableOrderIds[tableId] || null;
            
            const token = useAuthStore.getState().token;
            const res = await fetch(`${API_URL}/api/orders/save-cart`, {
              method: "POST",
              headers: { 
                "Content-Type": "application/json",
                ...(token ? { "Authorization": `Bearer ${token}` } : {})
              },
              signal: controller.signal,
              body: JSON.stringify({
                tableId,
                orderId,
                userId: useAuthStore.getState().user?.userId,
                lastUpdate: currentState.lastLocalUpdate[contextId] || Date.now(),
                entryStatus: useAuthStore.getState().user ? null : "q",
                skipTableStatusSync: true,
                items: items.map(item => {
                  const normalized = normalizeCartItem(item);
                  const backendMods = [...(normalized.modifiers || [])];
                  if (normalized.splitMembers && normalized.splitMembers.length > 0) {
                    normalized.splitMembers.forEach(sm => {
                      backendMods.push({
                        ModifierId: "00000000-0000-0000-0000-000000000001",
                        ModifierName: "[SPLIT] " + sm.CustomerName,
                        Price: sm.Amount || 0,
                        qty: 1
                      } as any);
                    });
                  }
                  return {
                    ...normalized,
                    modifiers: backendMods,
                    status: item.status || "NEW"
                  };
                })
              })
            });
            
            if (res.ok) {
                const data = await res.json();
                if (__DEV__) console.log(`✅ [CartStore] SYNC SUCCESS for ${contextId}`);
                
                set(state => {
                  // Only remove the controller if it's still THIS one
                  const newControllers = { ...state._syncAbortControllers };
                  if (newControllers[contextId] === controller) {
                    delete newControllers[contextId];
                  }

                  return {
                    lastServerSync: { ...state.lastServerSync, [contextId]: syncStartTime },
                    tableOrderIds: data.orderId !== orderId 
                      ? { ...state.tableOrderIds, [tableId]: data.orderId }
                      : state.tableOrderIds,
                    pendingSync: false,
                    _syncTimeout: null,
                    _syncAbortControllers: newControllers
                  };
                });
            }
          } catch (err) {
            if ((err as any).name === 'AbortError') {
              if (__DEV__) console.log(`ℹ️ [CartStore] SYNC ABORTED for ${contextId}`);
            } else {
              console.error("❌ [CartStore] Sync Exception:", err);
            }
            set({ pendingSync: false, _syncTimeout: null });
          }
        }, isImmediate ? 0 : 400); // 🚀 FASTER SYNC: Reduced to 400ms for blazingly fast responsiveness
        
        set({ _syncTimeout: timeout } as any);
      },

      fetchCartFromDB: async (tableId, force) => {
        // 🚀 SMART DEBOUNCE: Prevent multiple fetches in rapid succession
        if ((get() as any)._fetchTimeout) clearTimeout((get() as any)._fetchTimeout);
        const fetchStartTime = Date.now();
        
        const doFetch = async () => {
          try {
            const now = Date.now();
            const state = get();
            // 🚀 SMART CONTEXT MATCHING: Find context associated with table first
            const cleanTableId = String(tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
            let currentContext = state.currentContextId;
            const activeOrderObj = useOrderContextStore.getState().currentOrder;

            if (activeOrderObj) {
              const cleanActiveTableId = String(activeOrderObj.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
              if (cleanActiveTableId === cleanTableId || (activeOrderObj.section && activeOrderObj.tableNo)) {
                currentContext = getContextId(activeOrderObj) || currentContext;
              }
            }

            if (!currentContext && cleanTableId) {
              const { useTableStatusStore } = require("./tableStatusStore");
              const tableStatus = useTableStatusStore.getState().tableMap[cleanTableId];
              if (tableStatus?.section && tableStatus?.tableNo) {
                currentContext = getContextId({ orderType: "DINE_IN", section: tableStatus.section, tableNo: tableStatus.tableNo }) || currentContext;
              }
            }

            if (!currentContext) {
              const allContexts = Object.keys(state.carts);
              currentContext = allContexts.find(ctx => ctx.includes(tableId)) || null;
            }

            if (!currentContext) {
              if (__DEV__) console.warn(`⚠️ [CartStore] Could not resolve context for tableId: ${tableId}`);
              return;
            }

            // 🛡️ CLEAR LOCK: Reject fetches during a manual clear
            if (state.isClearing[currentContext]) {
              if (__DEV__) console.log(`🛡️ [TRACE] [${now}] [${currentContext}] fetchCartFromDB: BLOCKED (Clear Lock active)`);
              return;
            }

            const lastEdit = state.lastLocalUpdate[currentContext] || 0;
            const timeSinceLastEdit = now - lastEdit;

            if (__DEV__) console.log(`[TRACE] [${now}] [${currentContext}] fetchCartFromDB: START | Table: ${tableId} | LastEdit: ${timeSinceLastEdit}ms ago`);

            // 🛡️ DYNAMIC SHIELD: Latency protection (bypassed if force is true)
            if (!force && (timeSinceLastEdit < 600 || lastEdit > fetchStartTime)) {
               if (__DEV__) console.log(`🛡️ [TRACE] [${now}] [${currentContext}] fetchCartFromDB: ABORTED (Latency Shield)`);
               return;
            }

            const token = useAuthStore.getState().token;
            const res = await fetch(`${API_URL}/api/orders/cart/${tableId}`, {
              headers: token ? { "Authorization": `Bearer ${token}` } : {}
            });
            const data = await res.json();

            // 🛡️ FINAL CHECK: Ensure no edits happened DURING the network request
            const latestState = get();
            if (!force && latestState.lastLocalUpdate[currentContext] > fetchStartTime) {
              if (__DEV__) console.log(`🛡️ [TRACE] [${now}] [${currentContext}] fetchCartFromDB: ABORTED (Newer local edit detected during fetch)`);
              return;
            }

            const rawItems = Array.isArray(data) ? data : (data.items || []);
            const orderId = data.currentOrderId || null;
            // 🔥 QR PROMO SYNC: Restore order-level discount applied from QR app
            const serverOrderDiscount = data.orderDiscount || null;

            const dbItems = rawItems.map((item: any) => normalizeCartItem(item));

            // 🚀 SMART CONTEXT MATCHING: Find the context associated with this table
            let resolvedContextId: string | null = currentContext;

            if (!resolvedContextId && cleanTableId) {
              const { useTableStatusStore } = require("./tableStatusStore");
              const tableStatus = useTableStatusStore.getState().tableMap[cleanTableId];
              if (tableStatus?.section && tableStatus?.tableNo) {
                resolvedContextId = getContextId({ orderType: "DINE_IN", section: tableStatus.section, tableNo: tableStatus.tableNo });
              }
            }

            const serverCustomerId = data.customerId || null;
            const serverCustomerName = data.customerName || null;
            const serverMobileNo = data.mobileNo || null;

            if (resolvedContextId && (serverCustomerId || serverMobileNo || serverCustomerName)) {
              set((state) => ({
                orderCustomers: {
                  ...state.orderCustomers,
                  [resolvedContextId!]: {
                    customerId: serverCustomerId,
                    customerName: serverCustomerName,
                    mobileNo: serverMobileNo,
                  }
                }
              }));
            }

            if (resolvedContextId && (!state.currentContextId || state.currentContextId !== resolvedContextId)) {
              set({ currentContextId: resolvedContextId });
            }

            if (!resolvedContextId) {
              return;
            }

            // 🔥 QR PROMO SYNC: If the server tells us there's an active order-level discount
            // (applied by the QR customer), automatically apply it to the discounts store
            // so the POS summary screen shows the correct totals.
            if (serverOrderDiscount && serverOrderDiscount.amount > 0) {
              const existingDiscount = get().discounts[resolvedContextId];
              // Only apply if there's no existing POS-side discount already applied
              if (!existingDiscount?.applied) {
                const promoLabel = serverOrderDiscount.remarks
                  ? serverOrderDiscount.remarks.replace('Applied Promo Code: ', 'Promo: ')
                  : `Promo (QR)`;
                set((state) => ({
                  discounts: {
                    ...state.discounts,
                    [resolvedContextId!]: {
                      applied: true,
                      type: 'fixed' as const,
                      value: serverOrderDiscount.amount,
                      label: promoLabel,
                    }
                  }
                }));
              }
            }

            // 🚀 SAFETY MERGE: Never let the server clear local "NEW" or recently "SENT" items
            // Also, strictly filter out items that are currently in the Deletion Shield.
            const currentLocalCart = state.carts[resolvedContextId] || [];
            const localPendingItems = currentLocalCart.filter(item => {
               const isPending = item.status === "NEW" || !item.status;
               return isPending;
            });
            
            const { deletedItemsShield } = state;

            // 🛡️ DELETION SHIELD FILTER: Remove items that were explicitly deleted locally
            const filteredDbItems = dbItems.filter((dbItem: CartItem) => {
               const shieldExpiry = deletedItemsShield[dbItem.lineItemId];
               if (shieldExpiry && now < shieldExpiry) {
                  if (__DEV__) console.log(`🛡️ [CartStore] DELETION SHIELD: Ignored stale DB item ${dbItem.name} (${dbItem.lineItemId})`);
                  return false;
               }
               return true;
            });

            // 🚀 SMART MERGE: Favor local edits (Note, TW, Qty) over stale server data
            const mergedItems = filteredDbItems.map((dbItem: CartItem) => {
              const localMatch = localPendingItems.find(li => 
                li.lineItemId === dbItem.lineItemId ||
                (li.id === dbItem.id &&
                 getModifierKey(li.modifiers) === getModifierKey(dbItem.modifiers) &&
                 getComboKey(li.comboSelections) === getComboKey(dbItem.comboSelections) &&
                 (!isOpenPriceItem(dbItem) || dbItem.price === li.price))
              );
              
              // 🛡️ SYNC SHIELD: If we have a local version that was modified recently,
              // we MUST preserve the local Qty/Note/TW even for SENT items.
              const timeSinceLastEdit = now - (state.lastLocalUpdate[resolvedContextId!] || 0);
              const isRecentlyEdited = timeSinceLastEdit < 5000; // 🛡️ Increased to 5s for slower networks

              if (localMatch && (localMatch.status === 'NEW' || !localMatch.status || isRecentlyEdited)) {
                // Determine the most "advanced" status (SENT is more advanced than NEW)
                const isSent = localMatch.status === 'SENT' || dbItem.status === 'SENT' || !!localMatch.sent;
                
                const finalStatus = (dbItem.status === 'READY' || dbItem.status === 'SERVED' || dbItem.status === 'VOIDED' || dbItem.status === 'HOLD')
                  ? dbItem.status
                  : (isSent ? 'SENT' : (localMatch.status || dbItem.status));
                const finalSent = (finalStatus === 'SENT' || finalStatus === 'READY' || finalStatus === 'SERVED' || finalStatus === 'HOLD') ? 1 : 0;

                return {
                  ...dbItem,
                  qty: localMatch.qty,
                  note: isRecentlyEdited 
                    ? (localMatch.note ?? dbItem.note) 
                    : (dbItem.note ?? localMatch.note ?? ""),
                  isTakeaway: isRecentlyEdited 
                    ? (localMatch.isTakeaway ?? dbItem.isTakeaway) 
                    : (dbItem.isTakeaway ?? localMatch.isTakeaway ?? false),
                  discount: isRecentlyEdited 
                    ? (localMatch.discount ?? dbItem.discount) 
                    : (dbItem.discount ?? localMatch.discount ?? 0),
                  discountAmount: isRecentlyEdited 
                    ? (localMatch.discountAmount ?? dbItem.discountAmount ?? localMatch.discount) 
                    : (dbItem.discountAmount ?? localMatch.discountAmount ?? dbItem.discount ?? 0),
                  discountType: isRecentlyEdited 
                    ? (localMatch.discountType ?? dbItem.discountType) 
                    : (dbItem.discountType ?? localMatch.discountType ?? "percentage"),
                  modifiers: localMatch.modifiers,
                  status: finalStatus,
                  sent: finalSent
                };
              }
              return dbItem;
            });

            // Add any purely local items that don't exist on server at all (NEWly added)
            localPendingItems.forEach(localItem => {
              const existsOnServer = filteredDbItems.some((dbItem: CartItem) => {
                if (dbItem.lineItemId === localItem.lineItemId) return true;
                if (
                  dbItem.id === localItem.id &&
                  getModifierKey(dbItem.modifiers) === getModifierKey(localItem.modifiers) &&
                  getComboKey(dbItem.comboSelections) === getComboKey(localItem.comboSelections)
                ) {
                  if (isOpenPriceItem(dbItem) || isOpenPriceItem(localItem)) {
                    return dbItem.price === localItem.price;
                  }
                  return true;
                }
                return false;
              });
              
              if (!existsOnServer) {
                const shieldExpiry = deletedItemsShield[localItem.lineItemId];
                if (!shieldExpiry || now >= shieldExpiry) {
                   mergedItems.push(localItem);
                }
              }
            });

            if (__DEV__) console.log(`[TRACE] [${Date.now()}] [${resolvedContextId}] fetchCartFromDB: APPLYING | Items: ${mergedItems.length}`);

            set((state) => {
              const newQtyMap: Record<string, number> = {};
              mergedItems.forEach((item: CartItem) => {
                newQtyMap[item.id] = (newQtyMap[item.id] || 0) + item.qty;
              });
              return {
                carts: { ...state.carts, [resolvedContextId!]: mergedItems },
                cartQtyMap: { ...state.cartQtyMap, [resolvedContextId!]: newQtyMap },
                tableOrderIds: { ...state.tableOrderIds, [tableId]: orderId },
                tablePaymentStatus: {
                  ...state.tablePaymentStatus,
                  [tableId]: {
                    isPaid: Boolean(data.isPaid),
                    paymentStatus: data.paymentStatus || (data.isPaid ? "PAID" : "UNPAID"),
                  },
                },
                lastServerSync: { ...state.lastServerSync, [resolvedContextId!]: Date.now() },
                pendingSync: false
              };
            });
          } catch (err) {
            console.error("❌ [CartStore] Fetch failed:", err);
          }
        };

        if (force) {
          await doFetch();
        } else {
          const timeout = setTimeout(doFetch, 100); // 🚀 FASTER FETCH: Reduced from 300ms
          set({ _fetchTimeout: timeout } as any);
        }
      },
      setTableOrderId: (tableId, orderId) => {
        const { tableOrderIds } = get();
        set({
          tableOrderIds: {
            ...tableOrderIds,
            [tableId]: orderId,
          },
        });
      },

      checkoutOrder: async (tableId) => {
        try {
          if (__DEV__) console.log(`🚀 [CartStore] Initiating Checkout for Table: ${tableId}`);
          if ((get() as any)._fetchTimeout) clearTimeout((get() as any)._fetchTimeout);
          const token = useAuthStore.getState().token;
          const response = await fetchWithRetry(`${API_URL}/api/orders/checkout`, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              ...(token ? { "Authorization": `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ tableId }),
          });
          
          if (!response.ok) {
            const errorText = await response.text();
            if (__DEV__) console.error(`❌ [CartStore] Checkout API Error (${response.status}):`, errorText);
            return { success: false };
          }

          const data = await response.json();
          if (__DEV__) console.log("✅ [CartStore] Checkout Success:", data);
          return { success: true };
        } catch (err: any) {
          if (__DEV__) console.error(`❌ [CartStore] Checkout failed (all retries exhausted):`, err);
          return { success: false };
        }
      },

      completeOrder: async (tableId) => {
        try {
          if (__DEV__) console.log(`🚀 [CartStore] Completing Order for Table: ${tableId}`);
          const token = useAuthStore.getState().token;
          const response = await fetchWithRetry(`${API_URL}/api/orders/complete`, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              ...(token ? { "Authorization": `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ tableId }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            if (__DEV__) console.error(`❌ [CartStore] Complete API Error (${response.status}):`, errorText);
            return { success: false };
          }

          const data = await response.json();
          if (__DEV__) console.log(`✅ [CartStore] Complete Success:`, data);

          if (data.success) {
            // 🚀 INSTANT LOCAL RESET: Wipe everything related to this table immediately
            get().clearTableSession(tableId);
            
            // Clean up the order ID mapping
            set((state) => {
              const updatedIds = { ...state.tableOrderIds };
              delete updatedIds[tableId];
              return { tableOrderIds: updatedIds };
            });

            // Final fetch to ensure state matches DB (force=true to bypass Latency Shield)
            await get().fetchCartFromDB(tableId, true);
            return { success: true };
          }
          return { success: false };
        } catch (err: any) {
          if (__DEV__) console.error(`❌ [CartStore] Complete failed (all retries exhausted):`, err);
          return { success: false };
        }
      },
      cancelPendingSync: () => {
        const { _syncTimeout, currentContextId, _syncAbortControllers } = get();
        if (_syncTimeout) {
          clearTimeout(_syncTimeout);
          set({ _syncTimeout: null });
        }
        if (currentContextId && _syncAbortControllers[currentContextId]) {
          if (__DEV__) console.log(`🛑 [CartStore] cancelPendingSync: Aborting sync for ${currentContextId}`);
          _syncAbortControllers[currentContextId].abort();
        }
      },
    }),
    {
      name: "cart-storage",
      storage: createJSONStorage(() =>
        Platform.OS === 'web' ? window.localStorage : AsyncStorage
      ),
      // Persist session-critical fields + cart items/discounts so checkout
      // survives a page refresh on web
      partialize: (state) => ({
        tableOrderIds: state.tableOrderIds,
        currentContextId: state.currentContextId,
        carts: state.carts,
        discounts: state.discounts,
      }),
      merge: (persistedState: any, currentState) => {
        const merged = { ...currentState, ...persistedState };
        // 🛡️ RECOVERY: Ensure deletingItems is always a Set (not a plain object from storage)
        if (!(merged.deletingItems instanceof Set)) {
          merged.deletingItems = new Set();
        }

        // 🚀 RECOMPUTE QTY MAP: Compute cartQtyMap from hydrated carts to ensure badges display on refresh
        const cartQtyMap: Record<string, Record<string, number>> = {};
        if (merged.carts) {
          Object.keys(merged.carts).forEach((contextId) => {
            const items = merged.carts[contextId] || [];
            const qtyMap: Record<string, number> = {};
            items.forEach((item: any) => {
              const dishId = item.id || item.DishId;
              if (dishId) {
                qtyMap[dishId] = (qtyMap[dishId] || 0) + (item.qty || 0);
              }
            });
            cartQtyMap[contextId] = qtyMap;
          });
        }
        merged.cartQtyMap = cartQtyMap;

        return merged;
      },
    }
  )
);

/* ================= HELPERS ================= */

export const isItemSent = (item: any) => {
  if (!item) return false;
  const status = item.status || item.Status;
  const code = item.StatusCode || item.statusCode || item.status_code;

  // 🚀 PERSISTENT ITEMS: Anything that isn't brand new
  // Includes: SENT, READY, SERVED, HOLD, and VOIDED
  return (
    item.sent === 1 || 
    !!item.sentDate || 
    (status !== undefined && status !== "NEW" && status !== null) ||
    (code !== undefined && code !== 1 && code !== null)
  );
};

export const getContextId = (
  context?: {
    orderType: string;
    section?: string;
    tableNo?: string;
    takeawayNo?: string;
  } | null,
) => {
  if (!context) return null;

  if (context.orderType === "DINE_IN") {
    return `DINE_IN_${context.section}_${context.tableNo}`;
  }

  if (context.orderType === "TAKEAWAY") {
    return `TAKEAWAY_${context.takeawayNo}`;
  }

  return null;
};

export const getCart = () => useCartStore.getState().getCart();

export const addToCartGlobal = (item: Omit<CartItem, "qty" | "lineItemId">) =>
  useCartStore.getState().addToCartGlobal(item);

export const removeFromCartGlobal = (lineItemId: string) =>
  useCartStore.getState().removeFromCartGlobal(lineItemId);

export const clearCart = () => useCartStore.getState().clearCart();

export const setCurrentContext = (contextId: string | null) =>
  useCartStore.getState().setCurrentContext(contextId);

export const setCartItemsGlobal = (contextId: string, items: CartItem[], skipSync?: boolean) =>
  useCartStore.getState().setCartItems(contextId, items, skipSync);

export const subscribeCart = (listener: () => void) =>
  useCartStore.subscribe(listener);

export const updateCartItemFullGlobal = (
  lineItemId: string,
  updates: {
    qty?: number;
    note?: string;
    spicy?: string;
    salt?: string;
    oil?: string;
    sugar?: string;
    discount?: number;
    isTakeaway?: boolean;
    isVoided?: boolean;
    isFoc?: boolean;
  },
) => useCartStore.getState().updateCartItemFull(lineItemId, updates);

export const voidCartItemGlobal = (lineItemId: string) =>
  useCartStore.getState().voidCartItem(lineItemId);

export const fetchCartFromDBGlobal = (tableId: string, force?: boolean) =>
  useCartStore.getState().fetchCartFromDB(tableId, force);

// 🚀 LIVE SYNC: Now handled globally via useGlobalSocketSync.ts
