import { create } from 'zustand';
import { parseDatabaseDate } from '../utils/timezoneHelper';
export type TableStatusType = 'EMPTY' | 'HOLD' | 'SENT' | 'BILL_REQUESTED' | 'LOCKED' | 'CART' | 'DELIVERY';

export type TableStatus = {
  tableId: string;
  section: string;
  tableNo: string;
  orderId: string;
  startTime: number;
  status: TableStatusType | number;
  lockedByName?: string;
  totalAmount?: number;
  isHoldOvertime?: boolean;
  lastModified?: string;
  entryStatus?: string;
  paymentStatus?: number;
  customerName?: string;
  pax?: number;
};

type TableStatusState = {
  tables: TableStatus[];
  tableMap: Record<string, TableStatus>; // 🚀 O(1) Lookup Optimization
  lockedTables: string[];
  lockedTableNames: Record<string, string>; // Map tableNo to locked person name
  lastLocalUpdate: Record<string, number>;
  updateTableStatus: (
    tableId: string,
    section: string,
    tableNo: string,
    orderId: string,
    status: TableStatusType,
    startTime?: number | string,
    lockedByName?: string,
    totalAmount?: number,
    isExternal?: boolean,
    isHoldOvertime?: boolean,
    modifiedOn?: string,
    entryStatus?: string,
    customerName?: string,
    pax?: number,
    paymentStatus?: number
  ) => void;
  clearTable: (section: string, tableNo: string) => void;
  lockTable: (tableId: string, lockedByName?: string) => void;
  unlockTable: (tableId: string) => void;
  isTableLocked: (tableId: string) => boolean;
  getLockedName: (tableNo: string, section?: string) => string | undefined;
  setLockedName: (tableNo: string, name: string) => void;
  syncLockedTables: (lockedTables: Array<{ tableId: string; tableNo: string; section: string; lockedByName?: string }>) => void;
  batchUpdateTableStatus: (updates: TableStatus[]) => void;
  getTables: () => TableStatus[];
};

export const useTableStatusStore = create<TableStatusState>((set, get) => ({
  tables: [],
  tableMap: {},
  lockedTables: [],
  lockedTableNames: {},
  lastLocalUpdate: {},

  updateTableStatus: (tableId, section, tableNo, orderId, status, startTime, lockedByName, totalAmount, isExternal, isHoldOvertime, modifiedOn, entryStatus, customerName, pax, paymentStatus) => {
    const cleanTableId = String(tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
    const key = `${section}_${tableNo}`;
    set((state) => {
      const lastModified = state.tableMap[cleanTableId]?.lastModified || "";
      const now = Date.now();
      const lastEdit = state.lastLocalUpdate[key] || 0;

      // 🛡️ SYNC SHIELD: Prioritize modifiedOn (Version Check) over simple timer
      if (isExternal) {
        // If we have timestamps, use them for definitive versioning (never block EMPTY status)
        if (status !== 'EMPTY' && (status as any) !== 0 && modifiedOn && lastModified && modifiedOn < lastModified) {
          return state; // Stale update
        }
        // 🚀 FIX: Strictly ignore external updates if recently edited locally (< 3s)
        // This prevents flicker when background fetches return stale data before DB catches up.
        // UNLESS the status is EMPTY (0) or LOCKED (5), which should sync instantly.
        if (now - lastEdit < 3000 && status !== 'EMPTY' && (status as any) !== 0 && status !== 'LOCKED' && (status as any) !== 5) return state;
      }

      const parsedStartTime = typeof startTime === 'string' 
        ? parseDatabaseDate(startTime).getTime() 
        : startTime;

      let existingIndex = -1;
      let existingTable: TableStatus | undefined = cleanTableId ? state.tableMap[cleanTableId] : undefined;

      const normTableNo = String(tableNo ?? "").trim().toLowerCase();
      const normSection = String(section ?? "").trim().toLowerCase();

      if (cleanTableId) {
        existingIndex = state.tables.findIndex((t) => {
          const tId = String(t.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
          return tId === cleanTableId;
        });
      }
      if (existingIndex === -1 && normTableNo) {
        existingIndex = state.tables.findIndex((t) => {
          const tId = String(t.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
          if (cleanTableId && tId === cleanTableId) return true;
          const tNo = String(t.tableNo ?? "").trim().toLowerCase();
          const tSec = String(t.section ?? "").trim().toLowerCase();
          return tNo === normTableNo && (!normSection || tSec === normSection || tSec.replace(/[-_]/g, "") === normSection.replace(/[-_]/g, ""));
        });
      }
      if (existingIndex > -1 && !existingTable) {
        existingTable = state.tables[existingIndex];
      }

      const updateTimestamp = isExternal ? state.lastLocalUpdate[key] : now;
      const updatedTable: TableStatus = {
        tableId: cleanTableId || existingTable?.tableId || "",
        section,
        tableNo,
        orderId,
        status,
        startTime: parsedStartTime || existingTable?.startTime || Date.now(),
        lockedByName,
        totalAmount: status === 'EMPTY' ? 0 : (totalAmount !== undefined ? totalAmount : (existingTable?.totalAmount ?? 0)),
        isHoldOvertime: status === 'EMPTY' ? false : (isHoldOvertime !== undefined ? isHoldOvertime : (existingTable?.isHoldOvertime ?? false)),
        lastModified: modifiedOn || existingTable?.lastModified || "",
        entryStatus: status === 'EMPTY' ? undefined : (entryStatus !== undefined ? entryStatus : existingTable?.entryStatus),
        paymentStatus: status === 'EMPTY' ? 0 : (paymentStatus !== undefined ? Number(paymentStatus) : (existingTable?.paymentStatus ?? 0)),
        customerName: status === 'EMPTY' ? undefined : (customerName !== undefined ? customerName : existingTable?.customerName),
        pax: status === 'EMPTY' ? undefined : (pax !== undefined ? pax : existingTable?.pax),
      };

      const newTables = [...state.tables];
      if (existingIndex > -1) newTables[existingIndex] = updatedTable;
      else newTables.push(updatedTable);

      const newMap = { ...state.tableMap };
      if (updatedTable.tableId) {
        const cleanKey = String(updatedTable.tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
        newMap[cleanKey] = updatedTable;
      }
      if (updatedTable.tableNo) {
        newMap[String(updatedTable.tableNo).trim().toLowerCase()] = updatedTable;
      }

      return {
        ...state,
        tables: newTables,
        tableMap: newMap,
        lastLocalUpdate: { ...state.lastLocalUpdate, [key]: updateTimestamp }
      };
    });
  },

  clearTable: (section, tableNo) => {
    set((state) => {
      const { [tableNo]: _, ...rest } = state.lockedTableNames;
      const newTables = state.tables.map((t) => {
        if (t.section === section && t.tableNo === tableNo) {
          return { ...t, status: 'EMPTY' as TableStatusType, totalAmount: 0, startTime: 0, orderId: '', isHoldOvertime: false, customerName: undefined, pax: undefined };
        }
        return t;
      });
      const newMap = { ...state.tableMap };
      newTables.forEach((t) => {
        if (t.tableId) newMap[t.tableId.toLowerCase()] = t;
      });
      return {
        tables: newTables,
        tableMap: newMap,
        lockedTableNames: rest,
      };
    });
  },

  lockTable: (tableId, lockedByName) => {
    set((state) => {
      const normalizedId = tableId.toLowerCase();
      if (!state.lockedTables.includes(normalizedId)) {
        const newState: any = { lockedTables: [...state.lockedTables, normalizedId] };
        if (lockedByName) {
          newState.lockedTableNames = { ...state.lockedTableNames, [normalizedId]: lockedByName };
        }
        return newState;
      }
      return state;
    });
  },

  unlockTable: (tableId) => {
    set((state) => {
      const normalizedId = tableId.toLowerCase();
      const { [normalizedId]: _, ...rest } = state.lockedTableNames;
      return {
        lockedTables: state.lockedTables.filter((id) => id !== normalizedId),
        lockedTableNames: rest,
      };
    });
  },

  isTableLocked: (tableId) => {
    return get().lockedTables.includes(tableId.toLowerCase());
  },

  getLockedName: (tableNo, section) => {
    const normalize = (n: any) => n?.toString().replace(/^T/i, "").trim();
    const sTableNo = normalize(tableNo);

    if (section) {
      const name = get().lockedTableNames[`${section}_${sTableNo}`] || get().lockedTableNames[`${section}_${tableNo}`];
      if (name) return name;
    }

    // Fallback search in tables array
    const table = get().tables.find(t => 
      (normalize(t.tableNo) === sTableNo || t.tableNo === tableNo) && 
      (!section || t.section === section)
    );
    return table?.lockedByName;
  },

  setLockedName: (tableNo, name) => {
    set((state) => ({
      lockedTableNames: { ...state.lockedTableNames, [tableNo]: name },
    }));
  },

  syncLockedTables: (lockedList) => {
    set((state) => {
      const lockedMap: Record<string, { name: string; section: string }> = {};
      lockedList.forEach((t) => {
        const key = `${t.section}_${t.tableNo}`;
        lockedMap[key] = { name: t.lockedByName || "", section: t.section };
      });

      // 1. Update existing tables in state
      const updatedTables = state.tables.map((t) => {
        const key = `${t.section}_${t.tableNo}`;
        const lockedData = lockedMap[key];
        if (lockedData !== undefined) {
          return { ...t, status: "LOCKED" as TableStatusType, lockedByName: lockedData.name };
        } else if (t.status === "LOCKED") {
          return { ...t, status: "EMPTY" as TableStatusType, lockedByName: undefined };
        }
        return t;
      });

      // 2. Add tables that are locked but were not in the store
      lockedList.forEach((lockedItem) => {
        const exists = updatedTables.find(t => t.tableId === lockedItem.tableId.toLowerCase());
        if (!exists) {
          updatedTables.push({
            tableId: lockedItem.tableId.toLowerCase(),
            section: lockedItem.section,
            tableNo: lockedItem.tableNo,
            orderId: "RESERVED",
            startTime: 0,
            status: "LOCKED",
            lockedByName: lockedItem.lockedByName
          });
        }
      });

      const finalTables = updatedTables.filter(t => t.status !== 'EMPTY');
      const nameMap: Record<string, string> = {};
      lockedList.forEach(t => {
        const key = `${t.section}_${t.tableNo}`;
        nameMap[key] = t.lockedByName || "";
      });

      return {
        tables: finalTables,
        lockedTableNames: { ...state.lockedTableNames, ...nameMap },
      };
    });
  },

  batchUpdateTableStatus: (updates) => {
    set((state) => {
      const now = Date.now();
      const newTables = [...state.tables];
      const newMap = { ...state.tableMap };

      updates.forEach((update) => {
        const cleanUpdateId = String(update.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase();
        const existingTable = newMap[cleanUpdateId];
        const isStatusEmpty = update.status === 'EMPTY' || (update.status as any) === 0;

        // 🛡️ SYNC SHIELD: Only update if incoming data is NEWER (never block EMPTY status)
        if (!isStatusEmpty && update.lastModified && existingTable?.lastModified && update.lastModified < existingTable.lastModified) {
          return;
        }

        const key = `${update.section}_${update.tableNo}`;
        const lastEdit = state.lastLocalUpdate[key] || 0;

        // 🛡️ SYNC SHIELD: Ignore stale background updates if recently edited locally
        if (now - lastEdit < 3000 && !isStatusEmpty && update.status !== 'LOCKED' && (update.status as any) !== 5) return;

        const existingIndex = newTables.findIndex(
          (t) => (String(t.tableId || "").replace(/^\{|\}$/g, "").trim().toLowerCase() === cleanUpdateId && !!cleanUpdateId) || (t.section === update.section && t.tableNo === update.tableNo)
        );

        const updatedTable: TableStatus = {
          ...(existingIndex > -1 ? newTables[existingIndex] : {}),
          ...update,
          tableId: cleanUpdateId || (existingIndex > -1 ? newTables[existingIndex].tableId : ""),
          status: update.status,
          orderId: isStatusEmpty ? "" : (update.orderId || (existingIndex > -1 ? newTables[existingIndex].orderId : "")),
          startTime: isStatusEmpty ? 0 : (update.startTime || (existingIndex > -1 ? newTables[existingIndex].startTime : 0) || Date.now()),
          totalAmount: isStatusEmpty ? 0 : (update.totalAmount !== undefined ? update.totalAmount : (existingIndex > -1 ? newTables[existingIndex].totalAmount : 0)),
          isHoldOvertime: isStatusEmpty ? false : (update.isHoldOvertime !== undefined ? update.isHoldOvertime : (existingIndex > -1 ? newTables[existingIndex].isHoldOvertime : false)),
          customerName: isStatusEmpty ? undefined : update.customerName,
          pax: isStatusEmpty ? undefined : update.pax,
          entryStatus: isStatusEmpty ? undefined : update.entryStatus,
        };

        if (existingIndex > -1) newTables[existingIndex] = updatedTable;
        else newTables.push(updatedTable);
        
        if (updatedTable.tableId) {
          const cleanKey = String(updatedTable.tableId).replace(/^\{|\}$/g, "").trim().toLowerCase();
          newMap[cleanKey] = updatedTable;
        }
      });

      return { ...state, tables: newTables, tableMap: newMap };
    });
  },

  getTables: () => get().tables,
}));

// Legacy wrappers for compatibility if needed, but components should use useTableStatusStore
export const getTables = () => useTableStatusStore.getState().getTables();
export const updateTableStatus = (
  tableId: string,
  section: string,
  tableNo: string,
  orderId: string,
  status: TableStatusType,
  startTime?: number | string,
  lockedByName?: string,
  totalAmount?: number,
  isExternal?: boolean,
  isHoldOvertime?: boolean,
  modifiedOn?: string,
  entryStatus?: string,
  customerName?: string,
  pax?: number
) => useTableStatusStore.getState().updateTableStatus(tableId, section, tableNo, orderId, status, startTime, lockedByName, totalAmount, isExternal, isHoldOvertime, modifiedOn, entryStatus, customerName, pax);
export const clearTable = (section: string, tableNo: string) => 
  useTableStatusStore.getState().clearTable(section, tableNo);

export const setTableActive = (
  tableId: string,
  section: string,
  tableNo: string,
  orderId: string,
) => {
  updateTableStatus(tableId, section, tableNo, orderId, 'SENT', Date.now());
};

export const setTableHold = (
  tableId: string,
  section: string,
  tableNo: string,
  orderId: string,
) => {
  updateTableStatus(tableId, section, tableNo, orderId, 'HOLD', Date.now());
};

