import { create, StateCreator } from "zustand";
import { Platform } from "react-native";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CartItem, DiscountInfo, getContextId, useCartStore } from "./cartStore";
import { OrderContext } from "./orderContextStore";
import { API_URL } from "../constants/Config";
import { socket } from "../constants/socket";
import { useAuthStore } from "./authStore";


/* ================= TYPES ================= */

export type OrderItem = CartItem & {
  status: "NEW" | "SENT" | "VOIDED" | "READY" | "SERVED" | "HOLD";
  sentAt?: number;
  readyAt?: number;
  dishGroupName?: string; // 🔥 Added
};


export type ActiveOrder = {
  orderId: string;
  context: OrderContext;
  items: OrderItem[];
  discount?: DiscountInfo; // 🔥 ADDED
  createdAt: number;
};

const normalizeKitchenItem = (item: any) => {
  const note = item?.note ?? item?.Note ?? item?.notes ?? item?.Remarks ?? "";
  const isTakeaway = !!(
    item?.isTakeaway ??
    item?.IsTakeaway ??
    item?.isTakeAway ??
    item?.IsTakeAway ??
    false
  );
  const modifiers =
    Array.isArray(item?.modifiers) ? item.modifiers :
    typeof item?.ModifiersJSON === "string"
      ? (() => {
          try {
            return JSON.parse(item.ModifiersJSON);
          } catch {
            return [];
          }
        })()
      : [];

  let comboSelections = undefined;
  const comboJson = item?.ComboDetailsJSON ?? item?.comboDetailsJSON ?? item?.comboSelections;
  if (comboJson) {
    try {
      const parsed = typeof comboJson === "string" ? JSON.parse(comboJson) : comboJson;
      comboSelections = Array.isArray(parsed) ? parsed : parsed?.groups;
    } catch {
      comboSelections = undefined;
    }
  }

  return {
    ...item,
    lineItemId: item.lineItemId ? String(item.lineItemId).toLowerCase() : undefined,
    note,
    isTakeaway,
    spicy: item?.spicy ?? item?.Spicy ?? "",
    salt: item?.salt ?? item?.Salt ?? "",
    oil: item?.oil ?? item?.Oil ?? "",
    sugar: item?.sugar ?? item?.Sugar ?? "",
    modifiers,
    comboSelections,
  };
};

type ActiveOrdersState = {
  _hasHydrated: boolean;
  setHasHydrated: (state: boolean) => void;
  activeOrders: ActiveOrder[];

  appendOrder: (
    orderId: string,
    context: OrderContext,
    cartItems: CartItem[],
    createdAt?: number,
  ) => void;

  markItemsSent: (orderId: string) => void;
  closeActiveOrder: (orderId: string) => void;

  // 🔥 NEW FUNCTIONS
  updateOrderDiscount: (context: OrderContext, discount: DiscountInfo) => void;
  voidOrderItem: (orderId: string, lineItemId: string) => void;
  markItemReady: (orderId: string, lineItemId: string, skipSync?: boolean) => void;
  markItemServed: (orderId: string, lineItemId: string, skipSync?: boolean) => void;
  fetchActiveKitchenOrders: () => Promise<void>;
  isFetching: boolean;
  updateOrderId: (oldId: string, newId: string) => void;
  initializeSocketListeners: () => void;
};

/* ================= STORE ================= */

const storeCreator: StateCreator<
  ActiveOrdersState,
  [["zustand/persist", unknown]]
> = (set, get) => ({
  _hasHydrated: false,
  setHasHydrated: (state) => set({ _hasHydrated: state }),
  activeOrders: [],
      isFetching: false,

  /* ================= APPEND ORDER ================= */

  appendOrder: (orderId, context, cartItems, createdAt) => {
    const { activeOrders } = get();

    const contextId = getContextId(context);

    // 🔥 GET DISCOUNT FROM CART STORE
    const discount = contextId && useCartStore.getState().discounts[contextId];

    const existingOrderIndex = activeOrders.findIndex((o) => {
      if (context.orderType === "DINE_IN") {
        return (
          o.context.orderType === "DINE_IN" &&
          String(o.context.section || "").trim().toLowerCase() === String(context.section || "").trim().toLowerCase() &&
          String(o.context.tableNo || "").trim().toLowerCase() === String(context.tableNo || "").trim().toLowerCase()
        );
      }

      if (context.orderType === "TAKEAWAY") {
        return (
          o.context.orderType === "TAKEAWAY" &&
          String(o.context.takeawayNo || "").trim().toLowerCase() === String(context.takeawayNo || "").trim().toLowerCase()
        );
      }

      return false;
    });

    /* ================= CREATE NEW ORDER ================= */

    if (existingOrderIndex === -1) {
      const newOrder: ActiveOrder = {
        orderId,
        context,
        items: cartItems.map((i) => ({
          ...normalizeKitchenItem(i),
          status: i.status || "NEW",
        })),
        discount: discount || undefined,
        createdAt: createdAt ? (typeof createdAt === 'number' ? createdAt : new Date(createdAt).getTime()) : Date.now(),
      };

      set({ activeOrders: [...activeOrders, newOrder] });
      return;
    }

    /* ================= UPDATE EXISTING ORDER ================= */

    const updatedOrders = [...activeOrders];
    const existingOrder = { ...updatedOrders[existingOrderIndex], orderId };

    existingOrder.items = [...existingOrder.items];

    cartItems.forEach((cartItem) => {
      const cleanLineItemId = String(cartItem.lineItemId || "").toLowerCase();
      const itemIndex = existingOrder.items.findIndex(
        (i) => String(i.lineItemId || "").toLowerCase() === cleanLineItemId
      );

      if (itemIndex > -1) {
        const existingItem = existingOrder.items[itemIndex];
        existingOrder.items[itemIndex] = {
          ...existingItem,
          qty: cartItem.qty || existingItem.qty,
          status: existingItem.status, // Keep the existing KDS status unchanged
          note: cartItem.note || existingItem.note || "",
          modifiers: cartItem.modifiers?.length ? cartItem.modifiers : (existingItem.modifiers || []),
        };
      } else {
        existingOrder.items.push({
          ...normalizeKitchenItem(cartItem),
          status: cartItem.status || "NEW",
        });
      }
    });

    // 🔥 UPDATE DISCOUNT ALSO
    existingOrder.discount = discount || existingOrder.discount;

    updatedOrders[existingOrderIndex] = existingOrder;

    set({ activeOrders: updatedOrders });
  },

  /* ================= UPDATE DISCOUNT ================= */

  updateOrderDiscount: (context, discount) => {
    const { activeOrders } = get();

    const updated = activeOrders.map((order) => {
      if (context.orderType === "DINE_IN") {
        if (
          order.context.orderType === "DINE_IN" &&
          String(order.context.section || "").trim().toLowerCase() === String(context.section || "").trim().toLowerCase() &&
          String(order.context.tableNo || "").trim().toLowerCase() === String(context.tableNo || "").trim().toLowerCase()
        ) {
          return { ...order, discount };
        }
      }

      if (context.orderType === "TAKEAWAY") {
        if (
          order.context.orderType === "TAKEAWAY" &&
          String(order.context.takeawayNo || "").trim().toLowerCase() === String(context.takeawayNo || "").trim().toLowerCase()
        ) {
          return { ...order, discount };
        }
      }

      return order;
    });

    set({ activeOrders: updated });
  },

  /* ================= MARK ITEMS SENT ================= */

  markItemsSent: (orderId) => {
    const { activeOrders } = get();
    const now = Date.now();

    set({
      activeOrders: activeOrders.map((order) => {
        if (order.orderId !== orderId) return order;

        return {
          ...order,
          items: order.items.map((item) => {
            if (item.status === "NEW") {
              return {
                ...item,
                status: "SENT",
                sentAt: now,
              };
            }
            return item;
          }),
        };
      }),
    });
  },
  closeActiveOrder: (orderId) => {
    const { activeOrders } = get();

    set({
      activeOrders: activeOrders.filter((o) => o.orderId !== orderId),
    });
  },

  voidOrderItem: (orderId, lineItemId) => {
    const { activeOrders } = get();

    set({
      activeOrders: activeOrders.map((order) => {
        if (order.orderId !== orderId) return order;

        return {
          ...order,
          items: order.items.map((item) => {
            if (String(item.lineItemId || "").toLowerCase() === String(lineItemId || "").toLowerCase()) {
              return { ...item, status: "VOIDED" };
            }
            return item;
          }),
        };
      }),
    });
  },

  /* ================= MARK ITEM READY ================= */
  markItemReady: async (orderId, lineItemId, skipSync) => {
    const { activeOrders } = get();
    const now = Date.now();

    const order = activeOrders.find((o) => o.orderId === orderId);
    const tableId = order?.context?.tableId || "";

    // 1. Update Local State
    set({
      activeOrders: activeOrders.map((order) => {
        if (order.orderId !== orderId) return order;
        return {
          ...order,
          items: order.items.map((item) => {
            if (String(item.lineItemId || "").toLowerCase() === String(lineItemId || "").toLowerCase()) {
              return { ...item, status: "READY", readyAt: now };
            }
            return item;
          }),
        };
      }),
    });

    // 2. Persist to Backend (unless already synced from socket)
    if (!skipSync) {
      try {
        await fetch(`${API_URL}/api/orders/update-item-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, lineItemId, status: "READY", tableId }),
        });
      } catch (err) {
        console.error("❌ [Store] markItemReady sync failed:", err);
      }
    }
  },

  /* ================= MARK ITEM SERVED ================= */
  markItemServed: async (orderId, lineItemId, skipSync) => {
    const { activeOrders } = get();

    const order = activeOrders.find((o) => o.orderId === orderId);
    const tableId = order?.context?.tableId || "";

    // 1. Update Local State
    set({
      activeOrders: activeOrders.map((order) => {
        if (order.orderId !== orderId) return order;
        return {
          ...order,
          items: order.items.map((item) => {
            if (String(item.lineItemId || "").toLowerCase() === String(lineItemId || "").toLowerCase()) {
              return { ...item, status: "SERVED" };
            }
            return item;
          }),
        };
      }),
    });

    // 2. Persist to Backend
    if (!skipSync) {
      try {
        await fetch(`${API_URL}/api/orders/update-item-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId, lineItemId, status: "SERVED", tableId }),
        });
      } catch (err) {
        console.error("❌ [Store] markItemServed sync failed:", err);
      }
    }
  },

  /* ================= FETCH FROM DB ================= */
  fetchActiveKitchenOrders: async () => {
    // 🚀 DEBOUNCE: Clear existing timeout to catch rapid-fire socket events
    if ((get() as any)._fetchTimeout) {
      clearTimeout((get() as any)._fetchTimeout);
    }

    const timeout = setTimeout(async () => {
      const { isFetching } = get();
      const lastFetchTs = (get() as any)._lastFetchTs || 0;
      const isStuck = isFetching && (Date.now() - lastFetchTs > 3000);

      if (isFetching && !isStuck) {
        if ((get() as any)._fetchRetryTimeout) {
          clearTimeout((get() as any)._fetchRetryTimeout);
        }
        (get() as any)._fetchRetryTimeout = setTimeout(() => {
          get().fetchActiveKitchenOrders();
        }, 150);
        return;
      }
      
      // Do not fetch if not logged in to prevent 401 errors
      const token = useAuthStore.getState().token;
      if (!token) {
        set({ isFetching: false });
        return;
      }
      
      set({ isFetching: true, _lastFetchTs: Date.now() } as any);
      try {
        const res = await fetch(`${API_URL}/api/orders/active-kitchen`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (!res.ok) throw new Error("Failed to fetch active kitchen orders");
        const result = await res.json();
        const ordersFromApi = result.orders || (Array.isArray(result) ? result : []);
        
        const currentOrders = get().activeOrders;
        const updatedApiOrders = ordersFromApi.map((apiOrder: any) => {
          const apiContext = apiOrder.context || {};
          const cleanContext = {
            ...apiContext,
            tableId: apiContext.tableId ? String(apiContext.tableId).replace(/^\{|\}$/g, "").trim().toLowerCase() : undefined,
            tableNo: apiContext.tableNo ? String(apiContext.tableNo).trim() : apiContext.tableNo,
            section: apiContext.section ? String(apiContext.section).trim() : apiContext.section,
            takeawayNo: apiContext.takeawayNo ? String(apiContext.takeawayNo).trim() : apiContext.takeawayNo,
          };
          const normalizedApiOrder = {
            ...apiOrder,
            context: cleanContext,
            items: (apiOrder.items || []).map((i: any) => normalizeKitchenItem(i))
          };
          
          const localOrder = currentOrders.find(lo => {
            const cleanIncomingId = apiOrder.orderId ? String(apiOrder.orderId).replace('#', '').trim() : '';
            const cleanLocalId = lo.orderId ? String(lo.orderId).replace('#', '').trim() : '';
            if (cleanLocalId === cleanIncomingId) return true;
            
            if (lo.context.orderType === "DINE_IN" && cleanContext.orderType === "DINE_IN") {
              const sec1 = String(lo.context.section || "").trim().toUpperCase().replace(/[- ]+/g, "_");
              const sec2 = String(cleanContext.section || "").trim().toUpperCase().replace(/[- ]+/g, "_");
              const normSec1 = sec1.startsWith("SECTION") ? sec1.replace(/SECTION[-_ ]*/i, "SECTION_") : (sec1 === "1" ? "SECTION_1" : sec1);
              const normSec2 = sec2.startsWith("SECTION") ? sec2.replace(/SECTION[-_ ]*/i, "SECTION_") : (sec2 === "1" ? "SECTION_1" : sec2);
              const tbl1 = String(lo.context.tableNo || "").trim().toLowerCase();
              const tbl2 = String(cleanContext.tableNo || "").trim().toLowerCase();
              return normSec1 === normSec2 && tbl1 === tbl2;
            }
            if (lo.context.orderType === "TAKEAWAY" && cleanContext.orderType === "TAKEAWAY") {
              return String(lo.context.takeawayNo || "").trim().toLowerCase() === String(cleanContext.takeawayNo || "").trim().toLowerCase();
            }
            return false;
          });
          
          if (!localOrder) {
            return {
              ...normalizedApiOrder,
              items: normalizedApiOrder.items.map((apiItem: any) => ({
                ...apiItem,
                readyAt: apiItem.status === "READY" ? (apiItem.readyAt || Date.now()) : apiItem.readyAt
              }))
            };
          }
          
          return {
            ...normalizedApiOrder,
            createdAt: (localOrder && localOrder.createdAt) ? localOrder.createdAt : normalizedApiOrder.createdAt,
            items: normalizedApiOrder.items.map((apiItem: any) => {
              const localItem = localOrder.items.find(li => li.lineItemId === apiItem.lineItemId);
              if (localItem && localItem.status !== apiItem.status) {
                const localUpdateRecent = (Date.now() - (localItem.readyAt || 0)) < 5000;
                if (localUpdateRecent) return localItem;
              }
              const readyAt = apiItem.status === "READY" 
                ? (localItem?.readyAt || apiItem.readyAt || Date.now()) 
                : undefined;
              if (!localItem) return { ...apiItem, readyAt };
              return {
                ...localItem,
                ...apiItem,
                readyAt,
                note: apiItem.note ?? localItem.note ?? "",
                isTakeaway: Boolean(apiItem.isTakeaway ?? apiItem.IsTakeaway ?? apiItem.isTakeAway ?? apiItem.IsTakeAway ?? localItem.isTakeaway ?? false),
                modifiers: apiItem.modifiers?.length ? apiItem.modifiers : (localItem.modifiers || []),
              };
            })
          };
        });

        // 🚀 SERVER IS TRUTH: If an order is gone from the server, it should be gone from the KDS
        // We only keep local orders if they are REALLY new (not yet synced to DB)
        const merged = [...updatedApiOrders];
        currentOrders.forEach(local => {
          // Only keep local orders that have never reached the server (TEMP- IDs or #NEW)
          const isUnsynced = local.orderId.startsWith('TEMP-') || local.orderId === 'NEW' || local.orderId === '#NEW';
          if (isUnsynced && !merged.find(m => m.orderId === local.orderId)) {
            merged.push(local);
          }
        });

        set({ activeOrders: merged });
      } catch (err) {
        if (__DEV__) {
          console.warn("⚠️ [ActiveOrdersStore] Fetch error (expected if network is re-connecting):", err);
        }
      } finally {
        set({ isFetching: false });
      }
    }, 100);

    set({ _fetchTimeout: timeout } as any);
  },

  /* ================= UPDATE ORDER ID ================= */
  updateOrderId: (oldId, newId) => {
    const { activeOrders } = get();
    console.log(`🔄 [Store] Updating Order ID: ${oldId} -> ${newId}`);
    
    set({
      activeOrders: activeOrders.map((o) => 
        o.orderId === oldId ? { ...o, orderId: newId } : o
    )
  });
},

/* ================= SOCKET LISTENERS ================= */
initializeSocketListeners: () => {
  if ((get() as any)._socketInitialized) return;

  console.log("🔌 [ActiveOrdersStore] Socket listeners removed - now handled globally via useGlobalSocketSync");
  
  (set as any)({ _socketInitialized: true });
},
});

export const useActiveOrdersStore = create<ActiveOrdersState>()(
  persist(
    storeCreator,
    {
      name: "active-orders-storage",
      storage: createJSONStorage(() => 
        Platform.OS === 'web' ? window.localStorage : AsyncStorage
      ),
      partialize: (state) => ({
        activeOrders: state.activeOrders,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHasHydrated(true);
          (state as any).isFetching = false;
        }
      },
    }
  )
);

/* ================= HELPERS ================= */

export const getActiveOrders = () =>
  useActiveOrdersStore.getState().activeOrders;

export const findActiveOrder = (context: OrderContext) => {
  return useActiveOrdersStore.getState().activeOrders.find((o) => {
    if (context.orderType === "DINE_IN") {
      return (
        o.context.orderType === "DINE_IN" &&
        String(o.context.section || "").trim().toLowerCase() === String(context.section || "").trim().toLowerCase() &&
        String(o.context.tableNo || "").trim().toLowerCase() === String(context.tableNo || "").trim().toLowerCase()
      );
    }

    if (context.orderType === "TAKEAWAY") {
      return (
        o.context.orderType === "TAKEAWAY" &&
        String(o.context.takeawayNo || "").trim().toLowerCase() === String(context.takeawayNo || "").trim().toLowerCase()
      );
    }

    return false;
  });
};
export const voidOrderItem = (orderId: string, lineItemId: string) =>
  useActiveOrdersStore.getState().voidOrderItem(orderId, lineItemId);
