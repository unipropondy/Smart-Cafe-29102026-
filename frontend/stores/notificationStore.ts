import { create } from "zustand";

import { playNotificationSound } from "../utils/soundHelper";

export type NotificationItem = {
  id: string;
  title: string;
  message: string;
  time: string;
  type: "QR_ORDER" | "GENERAL";
  read: boolean;
  orderId?: string;
  tableNo?: string;
  section?: string;
};

type NotificationState = {
  notifications: NotificationItem[];
  unreadCount: number;
  addNotification: (notification: Omit<NotificationItem, "id" | "time" | "read">) => void;
  removeNotification: (id: string) => void;
  markAllAsRead: () => void;
  clearNotifications: () => void;
};

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  unreadCount: 0,
  addNotification: (notif) => {
    playNotificationSound().catch(() => {});
    set((state) => {
      const newNotif: NotificationItem = {
        ...notif,
        id: Math.random().toString(36).substring(2, 9),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        read: false,
      };
      return {
        notifications: [newNotif, ...state.notifications],
        unreadCount: state.unreadCount + 1,
      };
    });
  },
  removeNotification: (id) => set((state) => {
    const item = state.notifications.find((n) => n.id === id);
    const wasUnread = item ? !item.read : false;
    return {
      notifications: state.notifications.filter((n) => n.id !== id),
      unreadCount: wasUnread ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
    };
  }),
  markAllAsRead: () => set((state) => ({
    notifications: state.notifications.map((n) => ({ ...n, read: true })),
    unreadCount: 0,
  })),
  clearNotifications: () => set({ notifications: [], unreadCount: 0 }),
}));
