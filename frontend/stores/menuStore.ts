import { create } from 'zustand';
import { API_URL } from '@/constants/Config';
import { socket } from '@/constants/socket';

interface MenuState {
  kitchens: any[];
  dishGroups: Record<string, any[]>;
  dishesByGroup: Record<string, any[]>;
  allDishes: any[];
  modifierCache: Record<string, any[]>;
  lastFetched: number | null;
  isLoading: boolean;

  fetchMenu: (force?: boolean) => Promise<void>;
  fetchGroups: (kitchenId: string) => Promise<any[]>;
  fetchDishes: (groupId: string) => Promise<any[]>;
  fetchModifiersForGroup: (groupId: string) => Promise<void>;
  clearCache: () => void;
  forceRefreshMenu: () => Promise<void>;
}

let inflightMenuPromise: Promise<void> | null = null;
const inflightGroupPromises = new Map<string, Promise<any[]>>();

export const useMenuStore = create<MenuState>((set, get) => ({
  kitchens: [],
  dishGroups: {},
  dishesByGroup: {},
  allDishes: [],
  modifierCache: {},
  lastFetched: null,
  isLoading: false,

  fetchMenu: async (force = false) => {
    const { lastFetched, kitchens, allDishes } = get();
    // Cache for 10 minutes unless forced
    if (!force && lastFetched && kitchens.length > 0 && allDishes.length > 0 && Date.now() - lastFetched < 600000) {
      return;
    }

    // Reuse in-flight request to avoid duplicate parallel fetches
    if (inflightMenuPromise) {
      return inflightMenuPromise;
    }

    set({ isLoading: true });
    inflightMenuPromise = (async () => {
      try {
        // ⚡ Parallel fetch: load kitchens and all dishes concurrently
        const [kRes, dRes] = await Promise.all([
          fetch(`${API_URL}/api/menu/kitchens`),
          fetch(`${API_URL}/api/menu/dishes/all`),
        ]);

        const [kData, dData] = await Promise.all([
          kRes.json(),
          dRes.json(),
        ]);

        const rawKitchens = Array.isArray(kData) ? kData.filter((k: any) => k.KitchenTypeName && !k.KitchenTypeName.includes("TEST")) : [];
        const kitchensData = Array.from(
          new Map(rawKitchens.map((k: any) => [k.CategoryId, k])).values()
        );

        const allDishesRaw = Array.isArray(dData) ? dData : [];
        const allDishesData = Array.from(
          new Map(allDishesRaw.map((d: any) => [d.DishId || d.id, d])).values()
        );

        set({ 
          kitchens: kitchensData, 
          allDishes: allDishesData,
          lastFetched: Date.now(),
          isLoading: false 
        });
      } catch (error) {
        console.error("Failed to fetch menu:", error);
        set({ isLoading: false });
      } finally {
        inflightMenuPromise = null;
      }
    })();

    return inflightMenuPromise;
  },

  fetchGroups: async (kitchenId) => {
    const { dishGroups } = get();
    if (dishGroups[kitchenId]) return dishGroups[kitchenId];
    if (inflightGroupPromises.has(kitchenId)) {
      return inflightGroupPromises.get(kitchenId)!;
    }

    const groupPromise = (async () => {
      try {
        const res = await fetch(`${API_URL}/api/menu/dishgroups/${kitchenId}`);
        const data = await res.json();
        const rawGroups = Array.isArray(data) ? data : [];
        // 🟢 Deduplicate groups by DishGroupId
        const groups = Array.from(
          new Map(rawGroups.map((g: any) => [g.DishGroupId || g.id, g])).values()
        );
        
        set((state) => ({
          dishGroups: { ...state.dishGroups, [kitchenId]: groups }
        }));
        return groups;
      } catch (error) {
        console.error(`Failed to fetch groups for kitchen ${kitchenId}:`, error);
        return [];
      } finally {
        inflightGroupPromises.delete(kitchenId);
      }
    })();

    inflightGroupPromises.set(kitchenId, groupPromise);
    return groupPromise;
  },

  fetchDishes: async (groupId) => {
    const { dishesByGroup, modifierCache } = get();
    if (dishesByGroup[groupId]) {
      const groupDishes = dishesByGroup[groupId];
      const hasAnyModifierCached = groupDishes.some(d => modifierCache[d.DishId || d.id] !== undefined);
      if (!hasAnyModifierCached) {
        get().fetchModifiersForGroup(groupId);
      }
      return dishesByGroup[groupId];
    }

    try {
      const res = await fetch(`${API_URL}/api/menu/dishes/group/${groupId}`);
      const data = await res.json();
      const dishesRaw = Array.isArray(data) ? data : [];
      
      // Deduplicate dishes by DishId
      const dishes = Array.from(
        new Map(dishesRaw.map((d: any) => [d.DishId || d.id, d])).values()
      );

      set((state) => ({
        dishesByGroup: { ...state.dishesByGroup, [groupId]: dishes }
      }));

      // 🚀 BACKGROUND PRE-FETCH: Load all modifiers for this group
      get().fetchModifiersForGroup(groupId);

      return dishes;
    } catch (error) {
      console.error(`Failed to fetch dishes for group ${groupId}:`, error);
      return [];
    }
  },

  fetchModifiersForGroup: async (groupId) => {
    try {
      const res = await fetch(`${API_URL}/api/menu/modifiers/group/${groupId}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        const newModifiers: Record<string, any[]> = {};
        data.forEach(m => {
          if (!newModifiers[m.DishId]) newModifiers[m.DishId] = [];
          newModifiers[m.DishId].push(m);
        });
        
        set(state => ({
          modifierCache: { ...state.modifierCache, ...newModifiers }
        }));
      }
    } catch (err) {
      console.error("Failed to fetch group modifiers:", err);
    }
  },

  clearCache: () => set({ kitchens: [], dishGroups: {}, dishesByGroup: {}, allDishes: [], modifierCache: {}, lastFetched: null }),

  forceRefreshMenu: async () => {
    set({ isLoading: true });
    try {
      await fetch(`${API_URL}/api/menu/clear-cache`, { method: 'POST' });
    } catch (err) {
      console.warn("Backend cache clear failed:", err);
    }
    get().clearCache();
    await get().fetchMenu(true);
  },
}));

// 🔌 Real-time Socket Listener for Menu Updates (e.g. IsPublished toggle = 1 or 0)
socket.on('menu_updated', (data) => {
  console.log('⚡ [MenuStore] Received menu_updated socket event:', data);
  useMenuStore.getState().clearCache();
  useMenuStore.getState().fetchMenu(true);
});
